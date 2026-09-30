// server/salsa/control-plane/support/crypto-pii.js
'use strict';

const crypto = require('crypto');
const config = require('../config');

// Ephemeral / Injected versioned key store
const KEY_RING = new Map();
let CURRENT_KEY_VERSION = null;

function loadConfiguredKeyring() {
  KEY_RING.clear();
  CURRENT_KEY_VERSION = null;

  if (config.piiKeyring && typeof config.piiKeyring === 'object') {
    for (const [version, rawHex] of Object.entries(config.piiKeyring)) {
      const buf = Buffer.isBuffer(rawHex) ? rawHex : Buffer.from(String(rawHex), 'hex');
      if (buf.length !== 32) {
        throw new Error(`FAIL-CLOSED: PII keyring key '${version}' must be exactly 32 bytes.`);
      }
      KEY_RING.set(version, buf);
      if (!CURRENT_KEY_VERSION) {
        CURRENT_KEY_VERSION = version;
      }
    }
  } else if (config.isTest) {
    // In test environment only: allow ephemeral random keys if not yet injected
    const testKey1 = crypto.randomBytes(32);
    const testKey2 = crypto.randomBytes(32);
    KEY_RING.set('v1', testKey1);
    KEY_RING.set('v2', testKey2);
    CURRENT_KEY_VERSION = 'v1';
  } else {
    // Production and Development without test: Fail Closed!
    throw new Error('FAIL-CLOSED: PII encryption keyring is not configured. Hardcoded keys are strictly prohibited.');
  }
}

// Initial load
try {
  loadConfiguredKeyring();
} catch (err) {
  // If startup validation is deferred or test, will fail-closed upon first crypto operation if not initialized
}

class CryptoPiiService {
  constructor() {
    this._ensureKeyringReady();
  }

  _ensureKeyringReady() {
    if (KEY_RING.size === 0) {
      loadConfiguredKeyring();
    }
  }

  getCurrentVersion() {
    this._ensureKeyringReady();
    return CURRENT_KEY_VERSION;
  }

  initKeyring(keyMap, defaultVersion = null) {
    KEY_RING.clear();
    for (const [version, key] of Object.entries(keyMap)) {
      const buf = Buffer.isBuffer(key) ? key : Buffer.from(String(key), 'hex');
      if (buf.length !== 32) {
        throw new Error(`KEY_ERROR: Injected key '${version}' must be 32 bytes.`);
      }
      KEY_RING.set(version, buf);
    }
    CURRENT_KEY_VERSION = defaultVersion || Object.keys(keyMap)[0] || null;
  }

  setMasterKey(version, keyBuffer) {
    const buf = Buffer.isBuffer(keyBuffer) ? keyBuffer : Buffer.from(String(keyBuffer), 'hex');
    if (buf.length !== 32) {
      throw new Error(`KEY_ERROR: Key for '${version}' must be exactly 32 bytes.`);
    }
    KEY_RING.set(version, buf);
    if (!CURRENT_KEY_VERSION) {
      CURRENT_KEY_VERSION = version;
    }
  }

  setCurrentVersion(version) {
    if (!KEY_RING.has(version)) {
      throw new Error(`KEY_ERROR: Version '${version}' does not exist in key ring.`);
    }
    CURRENT_KEY_VERSION = version;
  }

  resetKeyring() {
    KEY_RING.clear();
    CURRENT_KEY_VERSION = null;
  }

  getKeyRingSize() {
    return KEY_RING.size;
  }

  /**
   * Encrypts plaintext PII using AES-256-GCM with authentication tag
   */
  encrypt(plaintext, version = null) {
    if (!plaintext) return '';
    this._ensureKeyringReady();
    const targetVersion = version || CURRENT_KEY_VERSION;
    const key = KEY_RING.get(targetVersion);
    if (!key) throw new Error(`KEY_ERROR: No key found for version '${targetVersion}'`);

    const iv = crypto.randomBytes(12); // GCM standard 12-byte IV
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

    const encrypted = Buffer.concat([
      cipher.update(String(plaintext), 'utf8'),
      cipher.final()
    ]);
    const tag = cipher.getAuthTag();

    return `enc:${targetVersion}:${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
  }

  /**
   * Decrypts ciphertext PII using the corresponding key version
   */
  decrypt(payload) {
    if (!payload || !payload.startsWith('enc:')) return payload;
    this._ensureKeyringReady();

    const parts = payload.split(':');
    if (parts.length !== 5) {
      throw new Error('DECRYPT_ERROR: Malformed encrypted payload structure.');
    }

    const [, version, ivHex, tagHex, dataHex] = parts;
    const key = KEY_RING.get(version);
    if (!key) {
      throw new Error(`KEY_ERROR: Unknown key version '${version}'. Cannot decrypt.`);
    }

    const iv = Buffer.from(ivHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');
    const data = Buffer.from(dataHex, 'hex');

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);

    const decrypted = Buffer.concat([
      decipher.update(data),
      decipher.final()
    ]);

    return decrypted.toString('utf8');
  }

  /**
   * Rotates ciphertext to a new key version without data corruption
   */
  rotateCiphertext(payload, targetVersion = 'v2') {
    const plain = this.decrypt(payload);
    return this.encrypt(plain, targetVersion);
  }

  /**
   * Registers a new key version into the keyring and sets it as active
   * Never leaks or stores plaintext keys in insecure logs
   */
  rotateKeyring(newVersion, newKeyHex = null) {
    this._ensureKeyringReady();
    if (!newVersion || typeof newVersion !== 'string') {
      throw new Error('KEY_ERROR: Valid key version string (e.g. "v2") is required.');
    }
    let buf;
    if (newKeyHex) {
      buf = Buffer.isBuffer(newKeyHex) ? newKeyHex : Buffer.from(String(newKeyHex), 'hex');
    } else {
      buf = crypto.randomBytes(32);
    }
    if (buf.length !== 32) {
      throw new Error(`KEY_ERROR: New key for '${newVersion}' must be exactly 32 bytes.`);
    }
    KEY_RING.set(newVersion, buf);
    CURRENT_KEY_VERSION = newVersion;
    return {
      currentVersion: CURRENT_KEY_VERSION,
      versions: Array.from(KEY_RING.keys()),
      totalKeys: KEY_RING.size
    };
  }

  /**
   * Returns safe metadata about the keyring without exposing any plaintext secret keys
   */
  getKeyringStatus() {
    this._ensureKeyringReady();
    return {
      currentVersion: CURRENT_KEY_VERSION,
      versions: Array.from(KEY_RING.keys()),
      totalKeys: KEY_RING.size,
      algorithm: 'aes-256-gcm'
    };
  }

  /**
   * Computes a deterministic HMAC-SHA256 for exact phone number search within tenant scope
   */
  computePhoneHash(phone, salt = 'neem-pii-search-salt') {
    if (!phone) return '';
    const cleanPhone = String(phone).replace(/\D/g, '');
    return crypto.createHmac('sha256', salt).update(cleanPhone).digest('hex');
  }

  /**
   * Gradual batch re-encryption of records with cursor pagination and error tracking
   */
  reencryptBatch({ items = [], targetVersion = null, batchSize = 50, cursor = 0 }) {
    this._ensureKeyringReady();
    const effectiveTarget = targetVersion || CURRENT_KEY_VERSION;
    if (!KEY_RING.has(effectiveTarget)) {
      throw new Error(`KEY_ERROR: Target version '${effectiveTarget}' does not exist in keyring.`);
    }

    const startIndex = Math.max(0, parseInt(cursor, 10) || 0);
    const slice = items.slice(startIndex, startIndex + batchSize);

    let reencrypted = 0;
    let failed = 0;
    const reencryptedItems = [];

    for (const item of slice) {
      try {
        const currentCipher = item.ciphertext || item.phone_encrypted || item;
        const plain = this.decrypt(currentCipher);
        const newCipher = this.encrypt(plain, effectiveTarget);
        reencrypted++;
        reencryptedItems.push({
          id: item.id,
          originalCipher: currentCipher,
          newCipher,
          success: true
        });
      } catch (err) {
        failed++;
        reencryptedItems.push({
          id: item.id,
          success: false,
          error: err.message
        });
      }
    }

    const nextIndex = startIndex + slice.length;
    const isComplete = nextIndex >= items.length;

    return {
      reencrypted,
      failed,
      processed: slice.length,
      totalRecords: items.length,
      currentCursor: String(startIndex),
      nextCursor: isComplete ? null : String(nextIndex),
      isComplete,
      targetVersion: effectiveTarget,
      results: reencryptedItems
    };
  }

  // --- Masking Utilities for General Public Logs ---
  maskPhone(phone) {
    if (!phone || phone.length < 7) return '***';
    return phone.slice(0, 4) + '***' + phone.slice(-4);
  }

  maskCard(pan) {
    const clean = String(pan).replace(/\D/g, '');
    if (clean.length < 10) return '****-****-****-****';
    return clean.slice(0, 4) + '-****-****-' + clean.slice(-4);
  }

  maskNationalCode(code) {
    if (!code || code.length < 5) return '***';
    return code.slice(0, 3) + '****' + code.slice(-3);
  }

  maskNationalId(code) {
    return this.maskNationalCode(code);
  }

  maskEmail(email) {
    if (!email || !email.includes('@')) return '***@***';
    const [name, domain] = email.split('@');
    if (name.length <= 1) return '*@' + domain;
    return `${name[0]}***${name.slice(-1)}@${domain}`;
  }
}

module.exports = new CryptoPiiService();
