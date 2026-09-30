'use strict';

const crypto = require('crypto');

function normalizeDigits(value) {
  return String(value ?? '')
    .replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
    .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)));
}

function normalizePhone(value) {
  const digits = normalizeDigits(value).replace(/\D/g, '');
  if (digits.startsWith('00')) return digits.slice(2);
  if (digits.startsWith('0') && digits.length === 11) return `98${digits.slice(1)}`;
  return digits;
}

function keyFrom(value) {
  const text = String(value || '').trim();
  const key = /^[a-f0-9]{64}$/i.test(text) ? Buffer.from(text, 'hex') : Buffer.from(text, 'base64');
  if (key.length !== 32) {
    const error = new Error('A 32-byte NEEM customer-directory key is required.');
    error.code = 'customer_directory_key_required';
    throw error;
  }
  return key;
}

function phoneHash(phone, key) {
  const normalized = normalizePhone(phone);
  if (!normalized) return null;
  return crypto.createHmac('sha256', keyFrom(key)).update(`neem-customer-phone:v1|${normalized}`).digest('hex');
}

function encryptPhone(phone, key) {
  const normalized = normalizePhone(phone);
  if (!normalized) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyFrom(key), iv);
  const ciphertext = Buffer.concat([cipher.update(normalized, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString('base64url')}.${tag.toString('base64url')}.${ciphertext.toString('base64url')}`;
}

function decryptPhone(encoded, key) {
  const parts = String(encoded || '').split('.');
  if (parts.length !== 4 || parts[0] !== 'v1') {
    const error = new Error('Invalid NEEM customer phone ciphertext.');
    error.code = 'customer_directory_ciphertext_invalid';
    throw error;
  }
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', keyFrom(key), Buffer.from(parts[1], 'base64url'));
    decipher.setAuthTag(Buffer.from(parts[2], 'base64url'));
    return `${decipher.update(Buffer.from(parts[3], 'base64url'), undefined, 'utf8')}${decipher.final('utf8')}`;
  } catch (cause) {
    const error = new Error('Unable to decrypt NEEM customer phone.');
    error.code = 'customer_directory_decrypt_failed';
    error.cause = cause;
    throw error;
  }
}

function maskPhone(phone) {
  const normalized = normalizePhone(phone);
  return normalized ? `••••••${normalized.slice(-4)}` : '';
}

module.exports = { normalizePhone, phoneHash, encryptPhone, decryptPhone, maskPhone };

