'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  QUOTE_TTL_MS,
  createCheckoutQuoteToken,
  validateCheckoutQuoteIntent,
  verifyCheckoutQuoteToken,
} = require('../server/checkout-quote');

const SECRET = 'isolated-checkout-quote-contract-secret';
const ISSUED_AT = 1_800_000_000_000;

function productionQuoteIntent() {
  const intent = {
    tenantId: 'westo-production',
    branchId: 12,
    fulfillment: 'delivery',
    tableNo: '',
    zoneId: 8,
    phone: '09120000000',
    paymentMethod: 'cashier',
    items: [{
      menuItemId: 41,
      name: 'غذای اصلی',
      price: 120_000,
      qty: 2,
      modifiers: [{ groupId: 'size', id: 'large', name: 'بزرگ', price: 20_000 }],
      complements: [{ id: 'sauce', name: 'سس اضافه', price: 5_000, qty: 2 }],
      note: 'بدون فلفل',
      seat: 1,
      course: 'entrees',
      courseStatus: 'fired',
    }],
    subtotal: 290_000,
    deliveryFee: 15_000,
    discount: 10_000,
    total: 295_000,
  };
  const lineGrossIrr = intent.subtotal * 10;
  const lineDiscountIrr = intent.discount * 10;
  const deliveryGrossIrr = intent.deliveryFee * 10;
  const ruleSnapshot = {
    id: 'test-branch-12-vat-v1', code: 'VAT_TEST_BRANCH_12', rate: 0,
    inclusive: true, version: 1, locationId: intent.branchId,
    legalSource: 'test fixture only',
  };
  intent.taxSnapshot = {
    schemaVersion: 1,
    currency: 'IRR',
    branchId: intent.branchId,
    fulfillment: intent.fulfillment,
    inclusive: true,
    effectiveDate: '2026-09-24',
    totalTaxIrr: 0,
    grossIrr: (intent.subtotal + intent.deliveryFee) * 10,
    discountIrr: lineDiscountIrr,
    totalPayableIrr: intent.total * 10,
    lines: [{
      type: 'menu', menuItemId: intent.items[0].menuItemId, taxCategory: 'standard_1405',
      grossIrr: lineGrossIrr, discountIrr: lineDiscountIrr,
      taxableBaseIrr: lineGrossIrr - lineDiscountIrr, taxAmountIrr: 0,
      ruleSnapshot,
    }],
    deliveryFee: {
      taxCategory: 'standard_1405', grossIrr: deliveryGrossIrr,
      taxableBaseIrr: deliveryGrossIrr, taxAmountIrr: 0, ruleSnapshot,
    },
  };
  return intent;
}

test('server price snapshot binds tenant, fulfillment, selected add-ons, discount and payable amount', () => {
  const intent = productionQuoteIntent();
  const token = createCheckoutQuoteToken(SECRET, intent, ISSUED_AT);

  assert.equal(validateCheckoutQuoteIntent(intent).valid, true);
  assert.equal(verifyCheckoutQuoteToken(token, SECRET, intent, ISSUED_AT + 1_000).valid, true);

  const changedSnapshots = [
    { ...intent, tenantId: 'another-tenant' },
    { ...intent, branchId: 13 },
    { ...intent, fulfillment: 'pickup' },
    { ...intent, deliveryFee: intent.deliveryFee + 1, total: intent.total + 1 },
    { ...intent, discount: intent.discount - 1, total: intent.total + 1 },
    { ...intent, items: [{ ...intent.items[0], modifiers: [{ ...intent.items[0].modifiers[0], price: 0 }] }] },
    { ...intent, items: [{ ...intent.items[0], complements: [{ ...intent.items[0].complements[0], qty: 1 }] }] },
    { ...intent, taxSnapshot: { ...intent.taxSnapshot, totalTaxIrr: 1 } },
    { ...intent, taxSnapshot: { ...intent.taxSnapshot, branchId: 13 } },
  ];
  for (const changed of changedSnapshots) {
    assert.equal(verifyCheckoutQuoteToken(token, SECRET, changed, ISSUED_AT + 1_000).valid, false);
  }
});

test('production checkout token requires an exact inclusive branch tax snapshot', () => {
  const intent = productionQuoteIntent();
  const { taxSnapshot, ...withoutTaxSnapshot } = intent;
  assert.equal(validateCheckoutQuoteIntent(withoutTaxSnapshot).valid, false);
  assert.equal(validateCheckoutQuoteIntent({
    ...intent,
    taxSnapshot: { ...taxSnapshot, discountIrr: taxSnapshot.discountIrr + 1 },
  }).valid, false);
  assert.equal(validateCheckoutQuoteIntent({
    ...intent,
    taxSnapshot: {
      ...taxSnapshot,
      lines: [{ ...taxSnapshot.lines[0], ruleSnapshot: { ...taxSnapshot.lines[0].ruleSnapshot, locationId: 99 } }],
    },
  }).valid, false);
});

test('quote totals accept only safe integer Toman amounts that reconcile exactly', () => {
  const intent = productionQuoteIntent();
  const invalid = [
    { ...intent, subtotal: 290_000.5 },
    { ...intent, deliveryFee: -1 },
    { ...intent, discount: intent.subtotal + 1, total: intent.deliveryFee - 1 },
    { ...intent, total: intent.total + 1 },
    { ...intent, subtotal: Number.MAX_SAFE_INTEGER, deliveryFee: 1, discount: 0, total: Number.MAX_SAFE_INTEGER + 1 },
  ];

  for (const snapshot of invalid) {
    assert.deepEqual(validateCheckoutQuoteIntent(snapshot), { valid: false, reason: 'invalid_intent' });
    assert.throws(() => createCheckoutQuoteToken(SECRET, snapshot, ISSUED_AT), {
      code: 'checkout_quote_intent_invalid',
    });
  }
});

test('priced quote intents require a supported fulfillment, tender, and concrete catalog lines', () => {
  const intent = productionQuoteIntent();
  const malformed = [
    { ...intent, fulfillment: 'unknown' },
    { ...intent, paymentMethod: 'manual_card' },
    { ...intent, items: [] },
    { ...intent, items: [{ ...intent.items[0], menuItemId: 0 }] },
    { ...intent, items: [{ ...intent.items[0], qty: 100 }] },
    { ...intent, items: [{ ...intent.items[0], modifiers: [{ ...intent.items[0].modifiers[0], price: 1.5 }] }] },
    { ...intent, items: [{ ...intent.items[0], complements: [{ ...intent.items[0].complements[0], qty: 0 }] }] },
  ];
  const missingTender = { ...intent };
  delete missingTender.paymentMethod;
  malformed.push(missingTender);
  const missingFulfillment = { ...intent };
  delete missingFulfillment.fulfillment;
  malformed.push(missingFulfillment);

  for (const snapshot of malformed) {
    assert.deepEqual(validateCheckoutQuoteIntent(snapshot), { valid: false, reason: 'invalid_intent' });
    assert.throws(() => createCheckoutQuoteToken(SECRET, snapshot, ISSUED_AT), {
      code: 'checkout_quote_intent_invalid',
    });
  }
});

test('signature canonicalization rejects non-JSON snapshots instead of collapsing distinct values', () => {
  const invalidSnapshots = [];
  const undefinedArrayEntry = productionQuoteIntent();
  undefinedArrayEntry.items[0].modifiers = [undefined];
  invalidSnapshots.push(undefinedArrayEntry);

  const sparseArrayEntry = productionQuoteIntent();
  sparseArrayEntry.items[0].modifiers = Array(1);
  invalidSnapshots.push(sparseArrayEntry);

  const nonFiniteAmount = productionQuoteIntent();
  nonFiniteAmount.items[0].price = Number.NaN;
  invalidSnapshots.push(nonFiniteAmount);

  const accessorSnapshot = productionQuoteIntent();
  Object.defineProperty(accessorSnapshot.items[0], 'unstable', {
    enumerable: true,
    get() { return 'changed while signing'; },
  });
  invalidSnapshots.push(accessorSnapshot);

  for (const snapshot of invalidSnapshots) {
    assert.deepEqual(validateCheckoutQuoteIntent(snapshot), { valid: false, reason: 'invalid_intent' });
    assert.throws(() => createCheckoutQuoteToken(SECRET, snapshot, ISSUED_AT), {
      code: 'checkout_quote_intent_invalid',
    });
    assert.equal(
      verifyCheckoutQuoteToken(`${ISSUED_AT}.${'a'.repeat(64)}.${'A'.repeat(43)}`, SECRET, snapshot, ISSUED_AT + 1).reason,
      'invalid_intent',
    );
  }

  // A historical generic token consumer remains supported when its intent is
  // JSON-safe; it does not represent the complete checkout pricing schema.
  const legacyIntent = { branchId: 1, items: [{ menuItemId: 7, qty: 2 }], total: 1200 };
  const legacyToken = createCheckoutQuoteToken(SECRET, legacyIntent, ISSUED_AT);
  assert.equal(verifyCheckoutQuoteToken(legacyToken, SECRET, legacyIntent, ISSUED_AT + 1).valid, true);
});

test('quote tokens fail closed when signing configuration is empty or unusable', () => {
  const intent = productionQuoteIntent();
  const token = createCheckoutQuoteToken(SECRET, intent, ISSUED_AT);

  assert.throws(() => createCheckoutQuoteToken('', intent, ISSUED_AT), {
    code: 'checkout_quote_secret_invalid',
  });
  assert.throws(() => createCheckoutQuoteToken(null, intent, ISSUED_AT), {
    code: 'checkout_quote_secret_invalid',
  });
  assert.equal(verifyCheckoutQuoteToken(token, '', intent, ISSUED_AT + 1).reason, 'secret_invalid');
  assert.equal(verifyCheckoutQuoteToken(token, {}, intent, ISSUED_AT + 1).reason, 'secret_invalid');
});

test('quote signatures are stable across object-key order and expire at the declared TTL', () => {
  const intent = productionQuoteIntent();
  const reordered = {
    total: intent.total,
    discount: intent.discount,
    deliveryFee: intent.deliveryFee,
    subtotal: intent.subtotal,
    paymentMethod: intent.paymentMethod,
    phone: intent.phone,
    zoneId: intent.zoneId,
    tableNo: intent.tableNo,
    fulfillment: intent.fulfillment,
    branchId: intent.branchId,
    tenantId: intent.tenantId,
    items: intent.items,
    taxSnapshot: intent.taxSnapshot,
  };
  const token = createCheckoutQuoteToken(SECRET, intent, ISSUED_AT);

  assert.equal(verifyCheckoutQuoteToken(token, SECRET, reordered, ISSUED_AT + 1).valid, true);
  assert.equal(verifyCheckoutQuoteToken(token, SECRET, intent, ISSUED_AT + QUOTE_TTL_MS - 1).valid, true);
  assert.equal(verifyCheckoutQuoteToken(token, SECRET, intent, ISSUED_AT + QUOTE_TTL_MS).reason, 'expired');
  assert.equal(verifyCheckoutQuoteToken(token, SECRET, intent, ISSUED_AT - 1).reason, 'expired');
});
