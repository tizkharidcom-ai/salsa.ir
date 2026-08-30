'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const salesPos = require('../server/finance/sales-pos-engine');
const taxEngine = require('../server/finance/tax-engine');

function taxSettings() {
  return {
    defaultCategory: 'standard_1405',
    categories: [
      { code: 'standard_1405', defaultRate: 0.10, exempt: false, effectiveFrom: '2026-03-21' },
      { code: 'standard_historical_9', defaultRate: 0.09, exempt: false, effectiveFrom: '2022-01-01', effectiveTo: '2026-03-20' },
      { code: 'exempt_staple', defaultRate: 0, exempt: true, effectiveFrom: '2022-01-01' },
    ],
    rules: [
      { id: 'vat-10', code: 'VAT_STD_1405', taxCategory: 'standard_1405', rate: 0.10, inclusive: false, effectiveFrom: '2026-03-21', version: 2, status: 'active', legalSource: 'test' },
      { id: 'vat-9', code: 'VAT_STD_9', taxCategory: 'standard_historical_9', rate: 0.09, inclusive: false, effectiveFrom: '2022-01-01', effectiveTo: '2026-03-20', version: 1, status: 'active', legalSource: 'test' },
      { id: 'vat-0', code: 'VAT_EXEMPT', taxCategory: 'exempt_staple', rate: 0, inclusive: false, effectiveFrom: '2022-01-01', version: 1, status: 'active', legalSource: 'test' },
    ],
  };
}

function fixture() {
  return {
    posSales: [],
    posRefunds: [],
    accounting: { taxSettings: taxSettings(), auditLogs: [] },
  };
}

function makeSale(overrides = {}) {
  return {
    external_id: 'POS-100',
    legal_entity_id: 'le-1',
    branch_id: 1,
    status: 'paid',
    occurred_at: '2026-08-27T10:00:00.000Z',
    lines: [{ menu_item_id: 'burger', quantity: 1, unit_price_irr: 100000, discount_irr: 10000 }],
    tip_irr: 5000,
    payments: [
      { method: 'CASH', amount_irr: 40000 },
      { method: 'CARD', amount_irr: 64000 },
    ],
    ...overrides,
  };
}

function ledgerStub() {
  const entries = [];
  return {
    entries,
    postJournalFn(input) {
      const debit = input.lines.reduce((sum, line) => sum + line.debit, 0);
      const credit = input.lines.reduce((sum, line) => sum + line.credit, 0);
      assert.equal(debit, credit, `نامترازی سند ${input.source}`);
      entries.push(input);
      return { id: `${input.source}-${entries.length}`, number: `T-${entries.length}` };
    },
  };
}

test('tax resolution uses the effective historical rule and allocates global discount exactly', () => {
  const historical = taxEngine.calculateTax(taxSettings(), [{ quantity: 1, unitPrice: 100000, taxCategory: 'standard_1405' }], { date: '2026-03-20' });
  assert.equal(historical.totalTax, 9000);
  const defaultSettings = {};
  const ensured = taxEngine.ensureTaxSettings(defaultSettings);
  assert.equal(taxEngine.resolveTaxRule(ensured, { taxCategory: 'standard_1405', date: '2026-03-20' }).rate, 0.09);

  const discounted = taxEngine.calculateTax(taxSettings(), [
    { quantity: 1, unitPrice: 100000 },
    { quantity: 1, unitPrice: 100000 },
  ], { date: '2026-08-27', globalDiscount: 101 });
  assert.equal(discounted.totalDiscounts, 101);
  assert.equal(discounted.totalTaxableBase, 199899);
});

test('POS accepts paid split tender exactly and rejects cancelled or over-ceiling payments', () => {
  const db = fixture();
  const ledger = ledgerStub();
  const ledgerOpts = { postJournalFn: ledger.postJournalFn };
  const result = salesPos.ingestPOSSale(db, makeSale(), ledgerOpts);
  assert.equal(result.sale.status, 'COMPLETED');
  assert.deepEqual(result.sale.payments.map((payment) => payment.amount_irr), [40000, 64000]);
  assert.equal(ledger.entries.length, 1);
  assert.equal(ledger.entries[0].lines.every((line) => line.branchId === 1), true);

  assert.throws(
    () => salesPos.ingestPOSSale(fixture(), makeSale({ external_id: 'POS-CANCELLED', status: 'cancelled' }), ledgerOpts),
    (error) => error.code === 'sale_cancelled',
  );
  assert.throws(
    () => salesPos.ingestPOSSale(fixture(), makeSale({ external_id: 'POS-MISSING-STATUS', status: undefined }), ledgerOpts),
    (error) => error.code === 'sale_not_paid',
  );
  assert.throws(
    () => salesPos.ingestPOSSale(fixture(), makeSale({ external_id: 'POS-OVER', payments: [{ method: 'CARD', amount_irr: 104001 }] }), ledgerOpts),
    (error) => error.code === 'payment_total_mismatch',
  );
});

test('POS idempotency is branch-scoped and rejects a changed retry payload', () => {
  const db = fixture();
  const ledger = ledgerStub();
  const ledgerOpts = { postJournalFn: ledger.postJournalFn };
  const first = salesPos.ingestPOSSale(db, makeSale(), ledgerOpts);
  const replay = salesPos.ingestPOSSale(db, makeSale(), ledgerOpts);
  assert.equal(replay.idempotentReplay, true);
  const branchTwo = salesPos.ingestPOSSale(db, makeSale({ branch_id: 2 }), ledgerOpts);
  assert.equal(first.idempotentReplay, false);
  assert.equal(branchTwo.idempotentReplay, false);
  assert.equal(db.posSales.length, 2);
  assert.throws(
    () => salesPos.ingestPOSSale(db, makeSale({ tip_irr: 6000 }), ledgerOpts),
    (error) => error.code === 'idempotency_key_payload_mismatch',
  );
});

test('refund requires approval when requested, respects split-tender ceiling, balances exact tax, and is retry-safe', () => {
  const db = fixture();
  const ledger = ledgerStub();
  const ledgerOpts = { postJournalFn: ledger.postJournalFn };
  const sale = salesPos.ingestPOSSale(db, makeSale(), ledgerOpts).sale;

  assert.throws(
    () => salesPos.refundPOSSale(db, sale.id, { amount_irr: 33333, refund_method: 'CARD', requires_approval: true, idempotency_key: 'refund-1' }, ledgerOpts),
    (error) => error.code === 'refund_approval_required',
  );
  assert.throws(
    () => salesPos.refundPOSSale(db, sale.id, { amount_irr: 64001, refund_method: 'CARD', approved_by: 'owner-1', createdById: 'cashier-1' }, ledgerOpts),
    (error) => error.code === 'refund_tender_ceiling_exceeded',
  );

  const first = salesPos.refundPOSSale(db, sale.id, {
    amount_irr: 33333,
    refund_method: 'CARD',
    approval_status: 'approved',
    approved_by: 'owner-1',
    createdById: 'cashier-1',
    idempotency_key: 'refund-1',
  }, ledgerOpts);
  const refundJournal = ledger.entries.at(-1);
  assert.equal(refundJournal.source, 'pos_refund');
  assert.equal(refundJournal.lines.reduce((sum, line) => sum + line.debit, 0), 33333);
  assert.equal(refundJournal.lines.reduce((sum, line) => sum + line.credit, 0), 33333);
  assert.equal(first.refund.tax_refund_irr, 2885);
  assert.equal(first.refund.approval_status, 'APPROVED');

  const replay = salesPos.refundPOSSale(db, sale.id, {
    amount_irr: 33333,
    refund_method: 'CARD',
    approval_status: 'approved',
    approved_by: 'owner-1',
    createdById: 'cashier-1',
    idempotency_key: 'refund-1',
  }, ledgerOpts);
  assert.equal(replay.idempotentReplay, true);
  assert.equal(db.posRefunds.length, 1);
  assert.equal(ledger.entries.filter((entry) => entry.source === 'pos_refund').length, 1);
});

test('tax engine rejects unsafe or negative monetary inputs instead of silently rounding them', () => {
  assert.throws(
    () => taxEngine.calculateTax(taxSettings(), [{ quantity: 1, unitPrice: 100.5 }]),
    (error) => error.code === 'tax_amount_invalid',
  );
  assert.throws(
    () => taxEngine.calculateTax(taxSettings(), [{ quantity: 1, unitPrice: 100000, discount: -1 }]),
    (error) => error.code === 'tax_discount_invalid',
  );
});

test('tax rule scope never falls through to another branch/channel or an unrelated exempt rule', () => {
  const scoped = {
    defaultCategory: 'standard',
    categories: [{ code: 'standard', defaultRate: 0.10, exempt: false, effectiveFrom: '2020-01-01' }],
    rules: [
      { id: 'generic', taxCategory: 'standard', rate: 0.10, inclusive: false, effectiveFrom: '2020-01-01', status: 'active' },
      { id: 'branch-2', taxCategory: 'standard', rate: 0.20, inclusive: false, effectiveFrom: '2020-01-01', status: 'active', locationId: 2 },
      { id: 'delivery', taxCategory: 'standard', rate: 0.30, inclusive: false, effectiveFrom: '2020-01-01', status: 'active', fulfillmentType: 'DELIVERY' },
    ],
  };
  assert.equal(taxEngine.resolveTaxRule(scoped, { taxCategory: 'standard', date: '2026-08-27', locationId: 1 }).id, 'generic');
  assert.equal(taxEngine.resolveTaxRule(scoped, { taxCategory: 'standard', date: '2026-08-27', locationId: 2 }).id, 'branch-2');
  assert.equal(taxEngine.resolveTaxRule(scoped, { taxCategory: 'standard', date: '2026-08-27', fulfillmentType: 'delivery', locationId: 1 }).id, 'delivery');

  const noGeneric = { ...scoped, rules: scoped.rules.slice(1, 2) };
  assert.equal(taxEngine.resolveTaxRule(noGeneric, { taxCategory: 'standard', date: '2026-08-27', locationId: 1 }), null);
  assert.throws(
    () => taxEngine.calculateTax(noGeneric, [{ quantity: 1, unitPrice: 100000 }], { date: '2026-08-27', locationId: 1 }),
    (error) => error.code === 'tax_rule_missing',
  );

  const futureOnly = {
    defaultCategory: 'standard',
    categories: [
      { code: 'standard', defaultRate: 0.10, exempt: false, effectiveFrom: '2027-01-01' },
      { code: 'exempt', defaultRate: 0, exempt: true, effectiveFrom: '2020-01-01' },
    ],
    rules: [
      { id: 'future-standard', taxCategory: 'standard', rate: 0.20, inclusive: false, effectiveFrom: '2027-01-01', status: 'active' },
      { id: 'unrelated-exempt', taxCategory: 'exempt', rate: 0, inclusive: false, effectiveFrom: '2020-01-01', status: 'active' },
    ],
  };
  assert.equal(taxEngine.resolveTaxRule(futureOnly, { taxCategory: 'standard', date: '2026-08-27' }), null);
  assert.throws(
    () => taxEngine.calculateTax(futureOnly, [{ quantity: 1, unitPrice: 100000 }], { date: '2026-08-27' }),
    (error) => error.code === 'tax_rule_missing',
  );
});

test('inclusive VAT uses exact integer half-even arithmetic and exclusive VAT remains exact', () => {
  const inclusiveSettings = {
    defaultCategory: 'standard',
    categories: [{ code: 'standard', defaultRate: 0.20, exempt: false, effectiveFrom: '2020-01-01' }],
    rules: [{ id: 'inclusive-20', taxCategory: 'standard', rate: 0.20, inclusive: true, effectiveFrom: '2020-01-01', status: 'active' }],
  };
  const tie = taxEngine.calculateTax(inclusiveSettings, [{ quantity: 1, unitPrice: 3 }], { date: '2026-08-27' });
  assert.equal(tie.items[0].taxableBase, 2);
  assert.equal(tie.items[0].taxAmount, 1);
  assert.equal(tie.grandTotal, 3);

  const exclusive = taxEngine.calculateTax({
    ...inclusiveSettings,
    rules: [{ ...inclusiveSettings.rules[0], id: 'exclusive-20', inclusive: false }],
  }, [{ quantity: 1, unitPrice: 5 }], { date: '2026-08-27' });
  assert.equal(exclusive.items[0].taxableBase, 5);
  assert.equal(exclusive.items[0].taxAmount, 1);
  assert.equal(exclusive.grandTotal, 6);

  assert.throws(
    () => taxEngine.calculateTax({ ...inclusiveSettings, rules: [{ ...inclusiveSettings.rules[0], inclusive: 'not-a-boolean' }] }, [{ unitPrice: 100 }]),
    (error) => error.code === 'tax_inclusive_invalid',
  );
});

test('POS state and split-tender controls reject contradictory, fractional, duplicate and unsupported inputs', () => {
  const ledger = ledgerStub();
  const opts = { postJournalFn: ledger.postJournalFn };
  assert.throws(
    () => salesPos.ingestPOSSale(fixture(), makeSale({ external_id: 'POS-CANCELLED-PAID', status: 'cancelled', paymentStatus: 'paid' }), opts),
    (error) => error.code === 'sale_cancelled',
  );
  assert.throws(
    () => salesPos.ingestPOSSale(fixture(), makeSale({ external_id: 'POS-PENDING', status: 'pending', paymentStatus: 'pending' }), opts),
    (error) => error.code === 'sale_not_paid',
  );
  assert.throws(
    () => salesPos.ingestPOSSale(fixture(), makeSale({ external_id: 'POS-DUP-PAY', payments: [
      { id: 'same', method: 'CASH', amount_irr: 40000 },
      { id: 'same', method: 'CARD', amount_irr: 64000 },
    ] }), opts),
    (error) => error.code === 'payment_id_duplicate',
  );
  assert.throws(
    () => salesPos.ingestPOSSale(fixture(), makeSale({ external_id: 'POS-FRACTIONAL-PAY', payments: [
      { method: 'CARD', amount_irr: 104000.5 },
    ] }), opts),
    (error) => error.code === 'payment_amount_invalid',
  );
  assert.throws(
    () => salesPos.ingestPOSSale(fixture(), makeSale({ external_id: 'POS-UNKNOWN-TENDER', payments: [
      { method: 'CRYPTO', amount_irr: 104000 },
    ] }), opts),
    (error) => error.code === 'payment_method_invalid',
  );
});

test('refund uses the original tender account, validates approval flags, supports inclusive sales, and replays full refunds', () => {
  const inclusiveSettings = {
    defaultCategory: 'standard',
    categories: [{ code: 'standard', defaultRate: 0.20, exempt: false, effectiveFrom: '2020-01-01' }],
    rules: [{ id: 'inclusive-20', taxCategory: 'standard', rate: 0.20, inclusive: true, effectiveFrom: '2020-01-01', status: 'active' }],
  };
  const db = fixture();
  db.accounting.taxSettings = inclusiveSettings;
  const ledger = ledgerStub();
  const opts = { postJournalFn: ledger.postJournalFn };
  const sale = salesPos.ingestPOSSale(db, {
    external_id: 'POS-INCLUSIVE-REFUND',
    branch_id: 1,
    status: 'paid',
    occurred_at: '2026-08-27T10:00:00.000Z',
    lines: [{ menu_item_id: 'tea', quantity: 1, unit_price_irr: 100000 }],
    payments: [{ method: 'CARD', amount_irr: 100000 }],
  }, opts).sale;
  assert.equal(sale.totals.taxable_base_irr, 83333);
  assert.equal(sale.totals.tax_irr, 16667);

  const refund = salesPos.refundPOSSale(db, sale.id, {
    amount_irr: 100000,
    refund_method: 'CARD',
    idempotency_key: 'inclusive-refund-1',
  }, opts);
  assert.equal(refund.refund.net_sales_refund_irr, 83333);
  assert.equal(refund.refund.tax_refund_irr, 16667);
  assert.equal(ledger.entries.at(-1).lines.at(-1).accountCode, '1320');
  const replay = salesPos.refundPOSSale(db, sale.id, {
    amount_irr: 100000,
    refund_method: 'CARD',
    idempotency_key: 'inclusive-refund-1',
  }, opts);
  assert.equal(replay.idempotentReplay, true);
  assert.equal(ledger.entries.filter((entry) => entry.source === 'pos_refund').length, 1);

  const approvalDb = fixture();
  const approvalSale = salesPos.ingestPOSSale(approvalDb, makeSale({ external_id: 'POS-APPROVAL-FLAG' }), opts).sale;
  const noApproval = salesPos.refundPOSSale(approvalDb, approvalSale.id, {
    amount_irr: 1,
    refund_method: 'CARD',
    requires_approval: 'false',
  }, opts);
  assert.equal(noApproval.refund.approval_status, 'NOT_REQUIRED');
  assert.throws(
    () => salesPos.refundPOSSale(approvalDb, approvalSale.id, { amount_irr: 1, refund_method: 'CARD', requires_approval: 'maybe' }, opts),
    (error) => error.code === 'refund_approval_invalid',
  );
});

test('discount allocation remains integer, exact and bounded across lines', () => {
  const result = taxEngine.calculateTax(taxSettings(), [
    { quantity: 1, unitPrice: 10, discount: 3 },
    { quantity: 1, unitPrice: 100, discount: 0 },
    { quantity: 1, unitPrice: 50, discount: 7 },
  ], { date: '2026-08-27', globalDiscount: 101 });
  assert.equal(result.totalDiscounts, 111);
  assert.equal(result.items.reduce((sum, item) => sum + item.discountAmount, 0), 111);
  assert.equal(result.items.every((item) => item.discountAmount <= item.grossAmount), true);
  assert.throws(
    () => taxEngine.calculateTax(taxSettings(), [{ unitPrice: 100 }], { date: '2026-08-27', globalDiscount: 101 }),
    (error) => error.code === 'tax_global_discount_exceeds_gross',
  );
  assert.throws(
    () => taxEngine.calculateTax(taxSettings(), [{ unitPrice: 100 }], { date: '2026-08-27', globalDiscount: 0.5 }),
    (error) => error.code === 'tax_global_discount_invalid',
  );
});
