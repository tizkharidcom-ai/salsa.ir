'use strict';

const crypto = require('crypto');

const QUOTE_TTL_MS = 15 * 60 * 1000;
const QUOTE_AMOUNT_FIELDS = Object.freeze(['subtotal', 'deliveryFee', 'discount', 'total']);
const QUOTE_FULFILLMENTS = new Set(['dine_in', 'pickup', 'delivery']);
const QUOTE_PAYMENT_METHODS = new Set(['cashier', 'online']);

function validCheckoutTaxSnapshot(snapshot, intent) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)
      || snapshot.schemaVersion !== 1 || snapshot.currency !== 'IRR' || snapshot.inclusive !== true
      || Number(snapshot.branchId) !== intent.branchId || snapshot.fulfillment !== intent.fulfillment
      || typeof snapshot.effectiveDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(snapshot.effectiveDate)
      || !Array.isArray(snapshot.lines) || snapshot.lines.length !== intent.items.length) return false;
  const safe = (value) => Number.isSafeInteger(value) && value >= 0;
  const toRial = (value) => Number.isSafeInteger(value) && value >= 0 && Number.isSafeInteger(value * 10) ? value * 10 : null;
  const grossIrr = toRial(intent.subtotal + intent.deliveryFee);
  const discountIrr = toRial(intent.discount);
  const payableIrr = toRial(intent.total);
  if (grossIrr === null || discountIrr === null || payableIrr === null
      || !['totalTaxIrr', 'grossIrr', 'discountIrr', 'totalPayableIrr'].every((key) => safe(snapshot[key]))
      || snapshot.grossIrr !== grossIrr || snapshot.discountIrr !== discountIrr
      || snapshot.totalPayableIrr !== payableIrr || snapshot.grossIrr - snapshot.discountIrr !== snapshot.totalPayableIrr
      || snapshot.totalTaxIrr > snapshot.totalPayableIrr) return false;

  const validRule = (rule) => rule && typeof rule === 'object'
    && String(rule.locationId ?? '') === String(intent.branchId)
    && (typeof rule.id === 'string' || Number.isSafeInteger(rule.id)) && String(rule.id).trim()
    && typeof rule.code === 'string' && rule.code.trim()
    && typeof rule.legalSource === 'string' && rule.legalSource.trim()
    && Number.isSafeInteger(Number(rule.version)) && Number(rule.version) > 0
    && Number.isFinite(Number(rule.rate)) && Number(rule.rate) >= 0 && Number(rule.rate) <= 1
    && rule.inclusive === true;
  let lineGross = 0;
  let lineDiscount = 0;
  let lineTax = 0;
  let lineBase = 0;
  for (let index = 0; index < snapshot.lines.length; index += 1) {
    const line = snapshot.lines[index];
    if (line?.type !== 'menu' || Number(line.menuItemId) !== intent.items[index].menuItemId
        || !String(line.taxCategory || '').trim() || !validRule(line.ruleSnapshot)
        || !['grossIrr', 'discountIrr', 'taxableBaseIrr', 'taxAmountIrr'].every((key) => safe(line[key]))
        || line.grossIrr - line.discountIrr !== line.taxableBaseIrr + line.taxAmountIrr) return false;
    lineGross += line.grossIrr;
    lineDiscount += line.discountIrr;
    lineTax += line.taxAmountIrr;
    lineBase += line.taxableBaseIrr;
  }

  let deliveryGross = 0;
  let deliveryTax = 0;
  let deliveryBase = 0;
  if (intent.deliveryFee > 0) {
    const fee = snapshot.deliveryFee;
    if (!fee || !String(fee.taxCategory || '').trim() || !validRule(fee.ruleSnapshot)
        || !['grossIrr', 'taxableBaseIrr', 'taxAmountIrr'].every((key) => safe(fee[key]))
        || fee.grossIrr !== fee.taxableBaseIrr + fee.taxAmountIrr
        || fee.grossIrr !== toRial(intent.deliveryFee)) return false;
    deliveryGross = fee.grossIrr;
    deliveryTax = fee.taxAmountIrr;
    deliveryBase = fee.taxableBaseIrr;
  } else if (snapshot.deliveryFee != null) {
    return false;
  }
  const values = [lineGross, lineDiscount, lineTax, lineBase, deliveryGross, deliveryTax, deliveryBase];
  if (!values.every(Number.isSafeInteger)) return false;
  const combinedGross = lineGross + deliveryGross;
  const combinedTax = lineTax + deliveryTax;
  const combinedBase = lineBase + deliveryBase;
  const reconciledPayable = combinedBase + snapshot.totalTaxIrr;
  return [combinedGross, combinedTax, combinedBase, reconciledPayable].every(Number.isSafeInteger)
    && combinedGross === snapshot.grossIrr
    && lineDiscount === snapshot.discountIrr
    && combinedTax === snapshot.totalTaxIrr
    && reconciledPayable === snapshot.totalPayableIrr;
}

function validateCheckoutQuoteIntent(intent) {
  if (!intent || typeof intent !== 'object' || Array.isArray(intent)) {
    return { valid: false, reason: 'invalid_intent' };
  }
  // The signature must represent the exact snapshot that JSON APIs can carry.
  // JSON.stringify drops undefined object properties and serializes undefined
  // or sparse array slots as null; getters can also change values between calls.
  // Reject those shapes so distinct snapshots cannot share a canonical string.
  try {
    canonical(intent);
  } catch {
    return { valid: false, reason: 'invalid_intent' };
  }

  // Keep compatibility with the generic token fixtures/consumers that do not
  // carry a checkout price snapshot. Real checkout quote intents always have
  // these four fields (see checkoutQuoteIntent in server.js); once any is
  // present, all must be present and valid.
  const hasSubtotal = Object.hasOwn(intent, 'subtotal');
  const hasOtherQuoteAmount = ['deliveryFee', 'discount'].some((field) => Object.hasOwn(intent, field));
  // Historical generic token fixtures contain only a `total`; this is not the
  // checkout quote schema. Other partial price snapshots are malformed.
  if (!hasSubtotal && !hasOtherQuoteAmount) return { valid: true };
  if (!QUOTE_AMOUNT_FIELDS.every((field) => Object.hasOwn(intent, field))) {
    return { valid: false, reason: 'invalid_intent' };
  }
  if (typeof intent.tenantId !== 'string' || !/^[a-z][a-z0-9-]{1,62}$/u.test(intent.tenantId)
    || !Number.isSafeInteger(intent.branchId) || intent.branchId <= 0
    || (Object.hasOwn(intent, 'fulfillment') && !QUOTE_FULFILLMENTS.has(intent.fulfillment))
    || (Object.hasOwn(intent, 'paymentMethod') && !QUOTE_PAYMENT_METHODS.has(intent.paymentMethod))) {
    return { valid: false, reason: 'invalid_intent' };
  }

  // New checkout quotes always carry both the selected tender and catalog
  // lines. Preserve the older, deliberately generic token contract used by
  // historical internal consumers that carry neither field.
  const hasCheckoutLineContract = Object.hasOwn(intent, 'paymentMethod') || Object.hasOwn(intent, 'items');
  if (hasCheckoutLineContract) {
    if (!QUOTE_FULFILLMENTS.has(intent.fulfillment)
      || !QUOTE_PAYMENT_METHODS.has(intent.paymentMethod)
      || !Array.isArray(intent.items) || intent.items.length === 0) {
      return { valid: false, reason: 'invalid_intent' };
    }
    if (!validCheckoutTaxSnapshot(intent.taxSnapshot, intent)) {
      return { valid: false, reason: 'invalid_intent' };
    }

    for (const item of intent.items) {
      if (!item || typeof item !== 'object' || Array.isArray(item)
        || !Number.isSafeInteger(item.menuItemId) || item.menuItemId <= 0
        || !Number.isSafeInteger(item.qty) || item.qty < 1 || item.qty > 99
        || (Object.hasOwn(item, 'modifiers') && !Array.isArray(item.modifiers))
        || (Object.hasOwn(item, 'complements') && !Array.isArray(item.complements))) {
        return { valid: false, reason: 'invalid_intent' };
      }
      for (const modifier of item.modifiers || []) {
        if (!modifier || typeof modifier !== 'object' || Array.isArray(modifier)
          || !Number.isSafeInteger(modifier.price) || modifier.price < 0) {
          return { valid: false, reason: 'invalid_intent' };
        }
      }
      for (const complement of item.complements || []) {
        if (!complement || typeof complement !== 'object' || Array.isArray(complement)
          || !Number.isSafeInteger(complement.price) || complement.price < 0
          || !Number.isSafeInteger(complement.qty) || complement.qty < 1) {
          return { valid: false, reason: 'invalid_intent' };
        }
      }
    }
  }

  for (const field of QUOTE_AMOUNT_FIELDS) {
    if (!Number.isSafeInteger(intent[field]) || intent[field] < 0) {
      return { valid: false, reason: 'invalid_intent' };
    }
  }

  // Checkout prices menu lines and discounts in whole Tomans; the signed tax
  // snapshot records the inclusive tax share in integer Rials without changing
  // the customer payable amount.
  const undiscounted = intent.subtotal + intent.deliveryFee;
  if (!Number.isSafeInteger(undiscounted)
    || intent.discount > intent.subtotal
    || intent.total !== undiscounted - intent.discount) {
    return { valid: false, reason: 'invalid_intent' };
  }
  return { valid: true };
}

function canonical(value, ancestors = new Set()) {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (typeof value !== 'object') throw new TypeError('checkout quote intent is not JSON-safe');
  if (ancestors.has(value)) throw new TypeError('checkout quote intent cannot contain cycles');

  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
    throw new TypeError('checkout quote intent objects must be plain');
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new TypeError('checkout quote intent cannot contain symbol keys');
  }

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const ownKeys = Reflect.ownKeys(value);
      if (ownKeys.length !== value.length + 1 || !ownKeys.includes('length')) {
        throw new TypeError('checkout quote intent arrays must be dense');
      }
      const entries = [];
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
          throw new TypeError('checkout quote intent arrays must contain JSON values');
        }
        entries.push(canonical(descriptor.value, ancestors));
      }
      return `[${entries.join(',')}]`;
    }

    const keys = Reflect.ownKeys(value);
    const entries = keys.map((key) => {
      if (typeof key !== 'string') throw new TypeError('checkout quote intent keys must be strings');
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
        throw new TypeError('checkout quote intent properties must be enumerable data values');
      }
      return [key, descriptor.value];
    }).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry, ancestors)}`).join(',')}}`;
  } finally {
    ancestors.delete(value);
  }
}

function digestIntent(intent) {
  return crypto.createHash('sha256').update(canonical(intent)).digest('hex');
}

function quoteHmac(secret, payload) {
  const emptySecret = secret == null
    || (typeof secret === 'string' && Buffer.byteLength(secret, 'utf8') === 0)
    || ((Buffer.isBuffer(secret) || ArrayBuffer.isView(secret)) && secret.byteLength === 0)
    || (secret instanceof ArrayBuffer && secret.byteLength === 0)
    || (secret?.type === 'secret' && secret.symmetricKeySize === 0);
  if (emptySecret) {
    throw Object.assign(new TypeError('checkout quote signing secret is invalid'), {
      code: 'checkout_quote_secret_invalid',
    });
  }
  try {
    return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  } catch {
    throw Object.assign(new TypeError('checkout quote signing secret is invalid'), {
      code: 'checkout_quote_secret_invalid',
    });
  }
}

function createCheckoutQuoteToken(secret, intent, issuedAt = Date.now()) {
  const validation = validateCheckoutQuoteIntent(intent);
  if (!validation.valid) {
    throw Object.assign(new TypeError('checkout quote intent is invalid'), {
      code: 'checkout_quote_intent_invalid',
    });
  }
  if (!Number.isSafeInteger(issuedAt) || issuedAt < 0) {
    throw Object.assign(new TypeError('checkout quote issue time is invalid'), {
      code: 'checkout_quote_issue_time_invalid',
    });
  }
  const digest = digestIntent(intent);
  const signature = quoteHmac(secret, `${issuedAt}.${digest}`);
  return `${issuedAt}.${digest}.${signature}`;
}

function verifyCheckoutQuoteToken(token, secret, intent, now = Date.now()) {
  const validation = validateCheckoutQuoteIntent(intent);
  if (!validation.valid) return { valid: false, reason: validation.reason };
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return { valid: false, reason: 'missing_or_malformed' };
  const [issuedAtRaw, suppliedDigest, suppliedSignature] = parts;
  if (!/^(0|[1-9]\d*)$/.test(issuedAtRaw)
    || !/^[a-f0-9]{64}$/.test(suppliedDigest)
    || !/^[A-Za-z0-9_-]{43}$/.test(suppliedSignature)) {
    return { valid: false, reason: 'missing_or_malformed' };
  }
  const issuedAt = Number(issuedAtRaw);
  if (!Number.isSafeInteger(issuedAt) || issuedAt > now || now - issuedAt >= QUOTE_TTL_MS) {
    return { valid: false, reason: 'expired' };
  }
  const digest = digestIntent(intent);
  let expectedSignature;
  try {
    expectedSignature = quoteHmac(secret, `${issuedAt}.${digest}`);
  } catch {
    return { valid: false, reason: 'secret_invalid' };
  }
  const supplied = Buffer.from(suppliedSignature);
  const expected = Buffer.from(expectedSignature);
  if (suppliedDigest !== digest || supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) {
    return { valid: false, reason: 'intent_mismatch' };
  }
  return { valid: true, issuedAt };
}

module.exports = {
  QUOTE_TTL_MS,
  createCheckoutQuoteToken,
  verifyCheckoutQuoteToken,
  validateCheckoutQuoteIntent,
};
