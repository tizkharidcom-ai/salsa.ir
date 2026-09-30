'use strict';

const valueContracts = require('./value-contracts');

// Finance V2 keeps the operational source and the accounting effect linked by
// one explicit identity. This registry is intentionally small and additive:
// unknown sources remain readable for migration, but are marked as unregistered
// instead of silently pretending to be a canonical domain event.
const API_CONTRACT_VERSION = 'finance-v2/1';
const EVENT_CONTRACT_VERSION = 1;

const DOMAIN_ENTITIES = Object.freeze({
  order: { label: 'سفارش', sourceCollection: 'orders' },
  payment: { label: 'پرداخت', sourceCollection: 'payments' },
  sale: { label: 'فروش', sourceCollection: 'journalEntries' },
  refund: { label: 'برگشت وجه', sourceCollection: 'refunds' },
  inventory: { label: 'موجودی', sourceCollection: 'inventoryMovements' },
  recipe: { label: 'دستور تهیه', sourceCollection: 'recipeVersions' },
  purchase: { label: 'خرید', sourceCollection: 'purchaseOrders' },
  expense: { label: 'هزینه', sourceCollection: 'operatingExpenses' },
  payroll: { label: 'حقوق', sourceCollection: 'payrollRuns' },
  asset: { label: 'دارایی', sourceCollection: 'fixedAssets' },
  cash: { label: 'صندوق', sourceCollection: 'cashSessions' },
  settlement: { label: 'تسویه', sourceCollection: 'reconciliationItems' },
  journal_entry: { label: 'سند مالی', sourceCollection: 'journalEntries' },
  fiscal_period: { label: 'دوره مالی', sourceCollection: 'fiscalPeriods' },
});

const EVENT_SOURCES = Object.freeze({
  'order.paid': { entityType: 'order', eventType: 'order_paid', effect: 'sale_and_receivable' },
  'order.payment_received': { entityType: 'payment', eventType: 'order_payment_received', effect: 'customer_deposit_and_cash_receipt' },
  'order.payment_refund': { entityType: 'payment', eventType: 'order_payment_refunded', effect: 'customer_deposit_refund' },
  // A wallet top-up is a cash/bank inflow that increases the customer-deposit
  // liability.  It is deliberately separate from `order.paid`: the customer
  // has not consumed goods yet, so no revenue or COGS may be recognised here.
  'wallet.topup': { entityType: 'payment', eventType: 'wallet_topup', effect: 'cash_and_wallet_liability' },
  // Manual wallet corrections are controlled accounting events rather than
  // an unjournaled mutation of the customer projection. Positive corrections
  // recognise promotion/adjustment expense; negative corrections reduce the
  // customer-deposit liability and reverse that expense.
  'wallet.adjustment': { entityType: 'payment', eventType: 'wallet_adjustment', effect: 'wallet_liability_correction' },
  'order.cogs': { entityType: 'order', eventType: 'order_costed', effect: 'cogs_and_inventory' },
  'order.refund': { entityType: 'refund', eventType: 'order_refunded', effect: 'reversal' },
  'cash.movement': { entityType: 'cash', eventType: 'cash_movement_recorded', effect: 'cash_and_counterpart' },
  'cash_session.closed': { entityType: 'cash', eventType: 'cash_session_closed', effect: 'cash_reconciliation' },
  'purchase.goods_received': { entityType: 'purchase', eventType: 'goods_received', effect: 'inventory_and_grni' },
  'purchase.vendor_invoice': { entityType: 'purchase', eventType: 'vendor_invoice_recorded', effect: 'payable' },
  'purchase.supplier_payment': { entityType: 'purchase', eventType: 'supplier_paid', effect: 'payable_and_cash' },
  'inventory.waste': { entityType: 'inventory', eventType: 'inventory_waste_recorded', effect: 'inventory_and_cogs' },
  'inventory.stock_count': { entityType: 'inventory', eventType: 'inventory_count_recorded', effect: 'inventory_adjustment' },
  'inventory.production_batch': { entityType: 'inventory', eventType: 'production_batch_recorded', effect: 'inventory_transfer' },
  'inventory.stock_issue': { entityType: 'inventory', eventType: 'stock_issue_recorded', effect: 'inventory_and_cogs' },
  'inventory.stock_transfer': { entityType: 'inventory', eventType: 'stock_transfer_recorded', effect: 'inventory_transfer' },
  'inventory.reversal': { entityType: 'inventory', eventType: 'inventory_reversed', effect: 'reversal' },
  'settlement.received': { entityType: 'settlement', eventType: 'settlement_received', effect: 'bank_reconciliation' },
  'expense.cost_accrual': { entityType: 'expense', eventType: 'expense_accrued', effect: 'expense_and_payable' },
  'expense.cost_payment': { entityType: 'expense', eventType: 'expense_paid', effect: 'payable_and_cash' },
  'payroll.run': { entityType: 'payroll', eventType: 'payroll_recorded', effect: 'expense_and_payable' },
  'payroll.payment': { entityType: 'payroll', eventType: 'payroll_paid', effect: 'payable_and_cash' },
  'opening_balance': { entityType: 'journal_entry', eventType: 'opening_balance_recorded', effect: 'opening_entry' },
  'legacy_backfill.order_paid': { entityType: 'order', eventType: 'legacy_order_backfill', effect: 'controlled_backfill' },
});

function eventSourceContract(source) {
  const key = String(source || '').trim();
  return EVENT_SOURCES[key] || {
    entityType: 'journal_entry', eventType: 'unregistered_source', effect: 'requires_review', registered: false,
  };
}

function contractDocument() {
  return {
    apiVersion: API_CONTRACT_VERSION,
    eventVersion: EVENT_CONTRACT_VERSION,
    responseShape: '{ data, meta, error }',
    canonicalCurrency: 'IRR',
    displayCurrency: 'TOMAN',
    valueContractVersion: valueContracts.VALUE_CONTRACT_VERSION,
    valueRules: {
      moneyStorage: 'integer_irr_only',
      moneyDisplay: 'toman_with_persian_grouping',
      acceptedDigits: ['latin', 'persian', 'arabic_indic'],
      acceptedMoneyGrouping: ['comma', 'persian_group_separator'],
      dateStorage: 'gregorian_iso',
      timestampRequiresTimezone: true,
      units: Object.keys(valueContracts.UNIT_META),
      compatibleDimensions: Object.fromEntries(Object.entries(valueContracts.UNIT_META).map(([unit, meta]) => [unit, meta.dimension])),
    },
    entities: Object.fromEntries(Object.entries(DOMAIN_ENTITIES).map(([id, value]) => [id, { id, ...value }])),
    eventSources: Object.fromEntries(Object.entries(EVENT_SOURCES).map(([source, value]) => [source, { source, ...value }])),
    writePolicy: {
      canonicalWriter: 'Finance V2',
      legacyApis: 'read_only_compatibility',
      postedCorrection: 'reversal_only',
      duplicateProtection: 'source + sourceVersion + branchId + Idempotency-Key',
    },
  };
}

module.exports = { API_CONTRACT_VERSION, EVENT_CONTRACT_VERSION, DOMAIN_ENTITIES, EVENT_SOURCES, eventSourceContract, contractDocument };
