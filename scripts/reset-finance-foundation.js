#!/usr/bin/env node
'use strict';

/*
 * One-time, explicit cleanup for the local JSON runtime.
 *
 * The allowlists below intentionally separate transactional data from the
 * master data required to keep menu, inventory and recipe workflows usable.
 * Run only with WESTO_RESET_FINANCE_FOUNDATION=CONFIRM.
 */

const fs = require('node:fs');
const path = require('node:path');

if (process.env.WESTO_RESET_FINANCE_FOUNDATION !== 'CONFIRM') {
  throw new Error('برای اجرای پاک‌سازی باید WESTO_RESET_FINANCE_FOUNDATION=CONFIRM تنظیم شود.');
}

const dbPath = path.resolve(process.env.WESTO_DB_PATH || path.join(__dirname, '..', 'server', 'data', 'db.json'));
if (!fs.existsSync(dbPath)) throw new Error(`فایل داده یافت نشد: ${dbPath}`);

const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
if (!db || typeof db !== 'object' || !Array.isArray(db.orders) || !db.accounting || !db.financeV2) {
  throw new Error('ساختار دادهٔ مورد انتظار برای پاک‌سازی پیدا نشد؛ هیچ تغییری انجام نشد.');
}

const startDate = String(process.env.WESTO_FOUNDATION_DATE || new Date().toISOString().slice(0, 10));
if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) throw new Error('WESTO_FOUNDATION_DATE باید به شکل YYYY-MM-DD باشد.');

function addOneMonthMinusOneDay(isoDate) {
  const [year, month, day] = isoDate.split('-').map(Number);
  const nextMonth = new Date(Date.UTC(year, month, 1));
  nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
  nextMonth.setUTCDate(nextMonth.getUTCDate() - 1);
  return nextMonth.toISOString().slice(0, 10);
}

function count(value) {
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === 'object') return Object.keys(value).length;
  return value == null ? 0 : 1;
}

const before = {};
function clearArray(target, key, scope) {
  if (!Array.isArray(target[key])) target[key] = [];
  before[`${scope}.${key}`] = count(target[key]);
  target[key] = [];
}
function clearObject(target, key, scope) {
  if (!target[key] || typeof target[key] !== 'object' || Array.isArray(target[key])) target[key] = {};
  before[`${scope}.${key}`] = count(target[key]);
  target[key] = {};
}

// Order-derived and payment/tax transaction records in the operational DB.
for (const key of [
  'orders', 'cashSessions', 'paymentAttempts', 'posSales', 'posRefunds',
  'taxInvoices', 'taxSubmissions', 'loyaltyLedger', 'walletTopupRequests',
]) clearArray(db, key, 'db');
clearObject(db, 'checkoutIdempotency', 'db');

// Finance V2 transactions. Recipe versions are deliberately preserved as
// approved master data; idempotency and migration/quarantine records are not.
const finance = db.financeV2;
for (const key of [
  'events', 'payments', 'refunds', 'journalEntries', 'approvals',
  'reconciliationItems', 'orderItemCostSnapshots', 'inventoryMovements',
  'inventoryMovementValuations', 'productionBatches', 'purchaseOrders',
  'goodsReceipts', 'vendorInvoices', 'threeWayMatches', 'supplierPayments',
  'costCommitments', 'costAccruals', 'costPayments', 'fixedAssets',
  'depreciationRuns', 'payrollRuns', 'payrollPayments', 'openingBalanceBatches',
  'branchRollouts', 'migrationBaselines', 'legacyArchive', 'operatingExpenses',
  'breakEvenPlans',
]) clearArray(finance, key, 'financeV2');
clearObject(finance, 'idempotency', 'financeV2');
clearObject(finance, 'idempotencyRequests', 'financeV2');

// Legacy accounting transactions. The chart of accounts, settings, vendor
// directory, employees, inventory definitions and recipes remain available
// as the foundation for new real entries.
const accounting = db.accounting;
for (const key of [
  'journalEntries', 'cashDrawers', 'settlements', 'vendorBills',
  'customerAccounts', 'expenses', 'pettyCash', 'fixedAssets', 'giftCards',
  'reimbursements', 'payrollRuns', 'inventoryTransactions', 'inventoryCounts',
  'wasteLog', 'assetDisposals', 'assetTransfers', 'approvalQueue', 'accruals',
  'prepaids', 'purchaseOrders', 'goodsReceipts', 'threeWayMatches',
  'bankTransactions', 'auditLogs', 'periodAudit', 'depreciationRuns',
  'accrualPayments', 'vendorPayments', 'vendorBillPayments',
  'procurementReversals',
]) clearArray(accounting, key, 'accounting');
clearObject(accounting, 'procurementIdempotency', 'accounting');

// Keep ingredient definitions and standard costs, but remove old physical
// stock and purchase timestamps so opening inventory is entered deliberately.
let inventoryItemsReset = 0;
for (const item of Array.isArray(accounting.inventoryItems) ? accounting.inventoryItems : []) {
  for (const key of [
    'qtyOnHand', 'onHand', 'quantity', 'reservedQty', 'qtyReserved',
    'quarantinedQty', 'qtyQuarantined', 'expiredQty', 'qtyExpired',
  ]) if (Object.prototype.hasOwnProperty.call(item, key)) item[key] = 0;
  if (Object.prototype.hasOwnProperty.call(item, 'lastPurchaseDate')) delete item.lastPurchaseDate;
  inventoryItemsReset += 1;
}

// Vendor balances were derived from the deleted bills/payments; reset only
// that derived field while retaining the vendor master directory.
for (const vendor of Array.isArray(accounting.vendors) ? accounting.vendors : []) {
  if (Object.prototype.hasOwnProperty.call(vendor, 'balance')) vendor.balance = 0;
}

// A single empty open period makes the clean foundation immediately usable.
const periodId = `foundation-${startDate}`;
const endDate = addOneMonthMinusOneDay(startDate);
const period = {
  id: periodId,
  name: 'دورهٔ افتتاحیه',
  startDate,
  endDate,
  status: 'open',
  createdBy: 'system:foundation-reset',
  createdAt: new Date().toISOString(),
};
accounting.fiscalPeriods = [{ ...period }];
finance.fiscalPeriods = [{ ...period }];

// Keep the unified finance engine in its safe pre-cutover state and reset its
// transient revision counter without touching unrelated operational history.
finance.mode = 'shadow';
finance.cutover = { status: 'shadow', startedAt: null, approvedAt: null, approvedBy: null };
finance.rollout = { captureEnabled: true, enabledBranchIds: [], cutoverBranchIds: [] };
if (db.commandCenter && typeof db.commandCenter === 'object') db.commandCenter.eventRevision = 0;

const backupDir = path.resolve(
  process.env.WESTO_BACKUP_DIR || path.join(path.dirname(dbPath), '..', '..', '..', `${path.basename(path.resolve(__dirname, '..'))}-backups`),
);
fs.mkdirSync(backupDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupPath = path.join(backupDir, `db-before-finance-foundation-${stamp}.json`);
fs.copyFileSync(dbPath, backupPath);

const tempPath = `${dbPath}.foundation-reset-${process.pid}.tmp`;
try {
  fs.writeFileSync(tempPath, `${JSON.stringify(db, null, 2)}\n`, 'utf8');
  fs.renameSync(tempPath, dbPath);
} catch (error) {
  try { fs.unlinkSync(tempPath); } catch (_) {}
  throw error;
}

const after = {
  'db.orders': count(db.orders),
  'financeV2.events': count(finance.events),
  'financeV2.journalEntries': count(finance.journalEntries),
  'financeV2.payments': count(finance.payments),
  'financeV2.inventoryMovements': count(finance.inventoryMovements),
  'financeV2.recipeVersions': count(finance.recipeVersions),
  'accounting.journalEntries': count(accounting.journalEntries),
  'accounting.expenses': count(accounting.expenses),
  'accounting.inventoryItems': count(accounting.inventoryItems),
  'accounting.recipes': count(accounting.recipes),
  'accounting.fiscalPeriods': count(accounting.fiscalPeriods),
  'financeV2.fiscalPeriods': count(finance.fiscalPeriods),
};

console.log(JSON.stringify({ ok: true, dbPath, backupPath, startDate, endDate, inventoryItemsReset, before, after }, null, 2));
