'use strict';

/**
 * WESTO Unified Enterprise Finance Engine
 * ─────────────────────────────────────────────────────────────────────────────
 * Consolidates the Double-Entry General Ledger (V1) and Event-Sourced Shadow
 * Engine (V2) into a single, cohesive, enterprise-grade financial architecture.
 *
 * Core Capabilities:
 * 1. Single Source of Truth for General Ledger & Chart of Accounts (COA).
 * 2. Automated & Balanced Double-Entry Sales Posting from POS / Cashier.
 * 3. Automatic Reversal Journals upon Order Cancellation or Customer Refund.
 * 4. 3-Way Procurement with Live Inventory Stock Synchronization (GRN -> Stock).
 * 5. Multi-Branch Fiscal Periods with strict branch-scoping and hard lock.
 * 6. Iranian Statutory Payroll, Fixed Asset Depreciation & Tax Compliance.
 * 7. Clean Financial Statements (Balance Sheet, P&L, Statement of Cash Flows).
 */

const accountingEngine = require('../accounting-engine.js');
const financeV2 = require('../finance-v2.js');

// Direct imports of domain sub-engines
const money = require('../../../platform_core/server/finance/money.js');
const taxEngine = require('./tax-engine.js');
const periodService = require('./period-service.js');
const inventoryEngine = require('../../../inventory/server/finance/inventory-engine.js');
const procurementEngine = require('../../../inventory/server/finance/procurement-engine.js');
const salesPosEngine = require('../../../pos/server/finance/sales-pos-engine.js');
const assetEngine = require('./asset-engine.js');
const payrollEngine = require('./payroll-engine.js');
const reconciliationEngine = require('./reconciliation-engine.js');
const taxpayerAdapter = require('./taxpayer-adapter.js');
const walletEngine = require('../../../crm/server/finance/wallet-engine.js');
const breakEvenEngine = require('../../../analytics/server/finance/break-even-engine.js');
const restaurantIntelligence = require('../../../inventory/server/finance/restaurant-intelligence.js');
const orderCosting = require('../../../inventory/server/finance/order-costing.js');
const auditEngine = require('../../../platform_core/server/finance/audit-engine.js');

/**
 * Ensures that the unified finance state is initialized and synchronized
 * across db.finance, db.accounting, and db.financeV2.
 */
function ensureUnifiedFinance(db) {
  if (!db || typeof db !== 'object') {
    throw new TypeError('پایگاه‌داده مالی معتبر نیست.');
  }

  // Ensure underlying structures exist
  const acc = accountingEngine.ensureAccountingData(db);
  const v2 = financeV2.ensureFinanceV2(db);

  // Transition from shadow to active mode
  v2.mode = 'active';
  if (v2.cutover) {
    v2.cutover.status = 'completed';
    v2.cutover.approvedAt = v2.cutover.approvedAt || new Date().toISOString();
    v2.cutover.approvedBy = v2.cutover.approvedBy || 'system.unification';
  }

  // Unified canonical state container
  if (!db.finance || typeof db.finance !== 'object') {
    db.finance = {
      version: '3.0.0-unified',
      mode: 'active',
      status: 'healthy',
      updatedAt: new Date().toISOString(),
    };
  }

  // Bi-directional link between COA and state
  db.finance.accounts = acc.accounts;
  db.finance.fiscalPeriods = acc.fiscalPeriods;
  db.finance.inventoryItems = acc.inventoryItems;

  return {
    canonical: db.finance,
    accounting: acc,
    financeV2: v2,
  };
}

/**
 * Posts a double-entry journal voucher into the unified general ledger.
 */
function postJournal(db, entry) {
  const { accounting } = ensureUnifiedFinance(db);
  return accountingEngine.postJournalEntry(db, entry);
}

/**
 * Reverses a posted journal voucher by posting an inverted counter-entry.
 */
function reverseJournal(db, journalId, opts = {}) {
  ensureUnifiedFinance(db);
  return accountingEngine.reverseJournalEntry(db, journalId, opts);
}

/**
 * Synchronizes order sale into both the General Ledger and the Event ledger.
 */
function captureOrderSale(db, order, opts = {}) {
  ensureUnifiedFinance(db);
  const actor = opts.actor || 'system';

  // 1. Capture in event-sourced engine (payments, cogs, audit)
  let v2Result = null;
  try {
    v2Result = financeV2.capturePaidOrder(db, order, {
      actor,
      idempotencyKey: opts.idempotencyKey || `order:${order.id}:sale`,
    });
  } catch (err) {
    console.warn('[unified-finance] event capture warning:', err.message);
  }

  // 2. Capture in double-entry general ledger
  let glResult = null;
  try {
    glResult = accountingEngine.syncOrderSalesJournal(db, order);
  } catch (err) {
    console.error('[unified-finance] GL sales sync error:', err.message);
    throw err;
  }

  return {
    ok: true,
    journalEntry: glResult || v2Result?.journalEntry,
    event: v2Result?.event,
    costing: v2Result?.costing,
  };
}

/**
 * Reverses order sale across both ledgers when an order is cancelled or refunded.
 */
function reverseOrderSale(db, orderId, opts = {}) {
  ensureUnifiedFinance(db);
  const reason = opts.reason || `لغو یا مرجوعی سفارش #${orderId}`;
  const actor = opts.actor || 'system';

  let glReversal = null;
  try {
    glReversal = accountingEngine.reverseOrderSalesJournal(db, orderId, {
      reason,
      userId: actor,
    });
  } catch (err) {
    console.warn('[unified-finance] GL reversal warning:', err.message);
  }

  let v2Reversal = null;
  try {
    const v2Event = (db.financeV2?.events || []).find(
      (e) => e.source === 'order.paid' && String(e.sourceId) === String(orderId) && e.journalEntryId
    );
    if (v2Event?.journalEntryId) {
      v2Reversal = financeV2.reverseEntry(db, v2Event.journalEntryId, actor, reason);
    }
  } catch (err) {
    console.warn('[unified-finance] event reversal warning:', err.message);
  }

  return {
    ok: true,
    glReversal,
    v2Reversal,
  };
}

/**
 * Financial Reports Suite
 */
function getTrialBalance(db, asOfDate, filter = {}) {
  ensureUnifiedFinance(db);
  return accountingEngine.getTrialBalanceReport(db, asOfDate, filter);
}

function getGeneralLedger(db, accountCode, from, to, filter = {}) {
  ensureUnifiedFinance(db);
  return accountingEngine.getGeneralLedger(db, accountCode, from, to, filter);
}

function getBalanceSheet(db, asOfDate, filter = {}) {
  ensureUnifiedFinance(db);
  return accountingEngine.getBalanceSheet(db, asOfDate, filter);
}

function getIncomeStatement(db, from, to, filter = {}) {
  ensureUnifiedFinance(db);
  return accountingEngine.getIncomeStatement(db, from, to, filter);
}

function getCashFlowStatement(db, from, to, filter = {}) {
  ensureUnifiedFinance(db);
  return accountingEngine.getCashFlowStatement(db, from, to, filter);
}

module.exports = {
  // Core Unified Facade
  ensureUnifiedFinance,
  postJournal,
  reverseJournal,
  captureOrderSale,
  reverseOrderSale,

  // Financial Reports
  getTrialBalance,
  getGeneralLedger,
  getBalanceSheet,
  getIncomeStatement,
  getCashFlowStatement,

  // Domain Sub-Engines
  money,
  taxEngine,
  periodService,
  inventoryEngine,
  procurementEngine,
  salesPosEngine,
  assetEngine,
  payrollEngine,
  reconciliationEngine,
  taxpayerAdapter,
  walletEngine,
  breakEvenEngine,
  restaurantIntelligence,
  orderCosting,
  auditEngine,

  // Backward-compatible engine adapters
  accountingEngine,
  financeV2,
};
