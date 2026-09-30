'use strict';

const crypto = require('crypto');
const restaurantIntelligence = require('../../inventory/server/finance/restaurant-intelligence.js');
const breakEvenDefaults = require('../../analytics/server/finance/break-even-defaults.js');
const breakEvenEngine = require('../../analytics/server/finance/break-even-engine.js');
const orderCosting = require('../../inventory/server/finance/order-costing.js');
const inventoryOperations = require('../../inventory/server/finance/inventory-operations.js');
const legacyClassifier = require('./finance/legacy-classifier.js');
const { RESTAURANT_COST_BEHAVIOR } = require('../../analytics/server/finance/restaurant-cost-classifier.js');
const financeContracts = require('../../platform_core/server/finance/domain-contracts.js');
const valueContracts = require('../../platform_core/server/finance/value-contracts.js');
const { buildCutoverRunbook } = require('./finance/cutover-runbook.js');
const financeAuditEngine = require('../../platform_core/server/finance/audit-engine.js');
const { buildRefundReconciliationMatch, normalizeIdempotencyKey } = require('../../payments/server/settlement-reference.js');
const { branchScopeForUser } = require('../../platform_core/server/command-center.js');

const PAID_STATUSES = new Set(['paid', 'preparing', 'ready', 'dispatched', 'picked_up', 'delivered', 'done']);
const FINAL_ENTRY_STATUSES = new Set(['posted', 'reversed']);
const PNL_TYPES = new Set(['revenue', 'contra_revenue', 'cogs', 'expense']);
const TENDER_ACCOUNTS = Object.freeze({
  cash: '1110',
  card: '1320',
  manual_card: '1320',
  card_on_file: '1320',
  online: '1310',
  gateway: '1310',
  credit: '1510',
  // Customer wallet balances are a customer-deposit liability, not a gift
  // card liability. Keep the V2 mapping aligned with the canonical COA and
  // the legacy accounting engine (2500). Gift cards remain on 2400.
  wallet: '2500',
  customer_wallet: '2500',
  gift_card: '2400',
});
// Wallet top-ups are deposits, not sales.  The debit side is selected from a
// closed allow-list so a client cannot redirect a top-up to an arbitrary COA
// account.  Online PSP receipts remain a clearing asset until settlement;
// settlement reconciliation can subsequently move them to the bank account.
const WALLET_TOPUP_PAYMENT_ACCOUNTS = Object.freeze({
  cash: '1110',
  cash_in_store: '1110',
  in_store_staff: '1110',
  pos: '1320',
  card: '1320',
  manual_card: '1320',
  pos_card: '1320',
  online: '1310',
  online_gateway: '1310',
  gateway: '1310',
  bank: '1210',
  // Non-cash campaign credits are funded by marketing expense, never by a
  // fictitious bank receipt. They still increase the same customer-deposit
  // liability and therefore require an official journal.
  marketing_bonus: '6400',
  referral_bonus: '6400',
  referral_welcome: '6400',
  birthday_gift: '6400',
  winback_incentive: '6400',
});
const WALLET_LIABILITY_ACCOUNT = '2500';
// The bonus is a customer-acquisition/promotion cost incurred when credit is
// granted.  Keeping it explicit makes the policy auditable and prevents the
// bonus from being mistaken for cash received or restaurant revenue.
const WALLET_BONUS_EXPENSE_ACCOUNT = '6400';
const SALES_ACCOUNTS = new Set(['4110', '4120', '4130', '4140', '4210', '4220', '4300', '4400', '4500']);
const DEFAULT_BANK_ACCOUNTS = Object.freeze([
  { code: '1210', name: 'بانک جاری اصلی' },
  { code: '1220', name: 'حساب بانکی ذخیره' },
]);
const FIXED_ASSET_ACCOUNTS = Object.freeze({
  kitchen_bar: { label: 'تجهیزات آشپزخانه و بار', accountCode: '1810' },
  furniture_decor: { label: 'مبلمان و دکوراسیون', accountCode: '1820' },
  pos_it: { label: 'صندوق، شبکه و تجهیزات IT', accountCode: '1830' },
});
const ASSET_FUNDING_METHODS = Object.freeze({
  bank: { label: 'پرداخت از بانک', accountCode: '1210' },
  cash: { label: 'پرداخت نقدی', accountCode: '1110' },
});
const PAYROLL_LIABILITY_TYPES = Object.freeze({
  net_salary: { label: 'خالص حقوق کارکنان', accountCode: '2600' },
  social_security: { label: 'بیمه کارکنان و کارفرما', accountCode: '2230' },
  payroll_tax: { label: 'مالیات تکلیفی حقوق', accountCode: '2220' },
  other_deductions: { label: 'سایر کسورات پرداختنی', accountCode: '2700' },
});
const COST_COMMITMENT_TYPES = Object.freeze({
  rent: { label: 'اجاره', expenseAccount: '6200', liabilityAccount: '2700', behavior: 'fixed' },
  payroll_kitchen: { label: 'حقوق آشپزخانه و بار', expenseAccount: '6110', liabilityAccount: '2600', behavior: 'fixed' },
  payroll_service: { label: 'حقوق سالن و صندوق', expenseAccount: '6120', liabilityAccount: '2600', behavior: 'fixed' },
  payroll_bonus: { label: 'اضافه‌کاری، پاداش و عیدی', expenseAccount: '6130', liabilityAccount: '2600', behavior: 'fixed' },
  payroll_insurance: { label: 'بیمه سهم کارفرما', expenseAccount: '6140', liabilityAccount: '2230', behavior: 'fixed' },
  utilities: { label: 'آب، برق، گاز و اینترنت', expenseAccount: '6300', liabilityAccount: '2700', behavior: 'fixed' },
  marketing: { label: 'تبلیغات و بازاریابی', expenseAccount: '6400', liabilityAccount: '2700', behavior: 'fixed' },
  maintenance: { label: 'تعمیرات و نگهداری', expenseAccount: '6500', liabilityAccount: '2700', behavior: 'fixed' },
  hygiene: { label: 'نظافت و بهداشت', expenseAccount: '6600', liabilityAccount: '2700', behavior: 'variable' },
  office: { label: 'ملزومات اداری', expenseAccount: '6700', liabilityAccount: '2700', behavior: 'fixed' },
  business_insurance: { label: 'بیمه کسب‌وکار', expenseAccount: '6800', liabilityAccount: '2700', behavior: 'fixed' },
  permits: { label: 'مجوزها و عوارض', expenseAccount: '6900', liabilityAccount: '2700', behavior: 'fixed' },
});
const OPERATING_EXPENSE_CATEGORIES = Object.freeze({
  rent: { label: 'اجاره', expenseAccount: '6200' },
  payroll_kitchen: { label: 'حقوق آشپزخانه و بار', expenseAccount: '6110' },
  payroll_service: { label: 'حقوق سالن و صندوق', expenseAccount: '6120' },
  utilities: { label: 'آب، برق، گاز و اینترنت', expenseAccount: '6300' },
  marketing: { label: 'تبلیغات و بازاریابی', expenseAccount: '6400' },
  maintenance: { label: 'تعمیرات و نگهداری', expenseAccount: '6500' },
  hygiene: { label: 'نظافت و بهداشت', expenseAccount: '6600' },
  office: { label: 'ملزومات اداری', expenseAccount: '6700' },
  business_insurance: { label: 'بیمه کسب‌وکار', expenseAccount: '6800' },
  permits: { label: 'مجوزها و عوارض', expenseAccount: '6900' },
  bank_fees: { label: 'کارمزد بانکی و کارتخوان', expenseAccount: '6950' },
  other: { label: 'سایر هزینه‌ها', expenseAccount: '6990' },
});
const TEHRAN_DATE_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit',
});

function list(value) { return Array.isArray(value) ? value : []; }
function numeric(value) {
  try {
    return valueContracts.parseDecimal(value, { emptyValue: 0, label: 'عدد' });
  } catch {
    return NaN;
  }
}
function int(value) { const parsed = numeric(value); return Number.isFinite(parsed) ? Math.round(parsed) : 0; }
function strictLegacyTomanIrr(value, code) {
  const toman = numeric(value);
  if (!Number.isSafeInteger(toman) || toman < 0 || !Number.isSafeInteger(toman * 10)) {
    throw Object.assign(new Error('مبلغ ذخیره‌شده به تومان باید عدد صحیح و در محدودهٔ امن باشد.'), { code, status: 409 });
  }
  return toman * 10;
}
function safeIrr(value, code = 'amount_irr_invalid') {
  try {
    return valueContracts.parseIrr(value, { allowNegative: false });
  } catch {
    throw Object.assign(new Error('مبلغ ریالی باید عدد صحیح نامنفی و در محدودهٔ امن باشد.'), { code });
  }
}
function irrFromLegacyToman(value) { return int(value) * 10; }
function orderTaxAmountIrr(order) {
  const taxSnapshot = order?.taxSnapshot ?? order?.tax_snapshot;
  const snapshotAmount = (snapshot) => {
    if (Array.isArray(snapshot)) {
      return snapshot.reduce((sum, row) => {
        const raw = row?.taxAmountIrr ?? row?.tax_amount_irr ?? row?.taxAmount ?? row?.tax_amount;
        if (raw == null) throw Object.assign(new Error('ردیف تصویر مالیاتی فاقد مبلغ مالیات است.'), { code: 'tax_snapshot_invalid', status: 409 });
        const next = sum + safeIrr(raw, 'tax_total_invalid');
        if (!Number.isSafeInteger(next)) throw Object.assign(new Error('جمع تصویر مالیاتی از محدودهٔ امن خارج است.'), { code: 'tax_total_invalid', status: 409 });
        return next;
      }, 0);
    }
    if (snapshot && typeof snapshot === 'object') {
      const raw = snapshot.totalTaxIrr ?? snapshot.total_tax_irr ?? snapshot.totalTax ?? snapshot.total_tax;
      if (raw == null) throw Object.assign(new Error('تصویر مالیاتی قطعی فاقد مبلغ کل مالیات است.'), { code: 'tax_snapshot_invalid', status: 409 });
      return safeIrr(raw, 'tax_total_invalid');
    }
    if (snapshot == null) return null;
    throw Object.assign(new Error('ساختار تصویر مالیاتی قطعی معتبر نیست.'), { code: 'tax_snapshot_invalid', status: 409 });
  };
  const snapIrr = snapshotAmount(taxSnapshot);
  const explicitIrr = order?.taxAmountIrr ?? order?.totalTaxIrr ?? order?.total_tax_irr;
  const legacyToman = order?.taxAmount ?? order?.tax ?? order?.vatAmount;
  let legacyIrr = null;
  if (legacyToman != null) {
    legacyIrr = strictLegacyTomanIrr(legacyToman, 'tax_total_invalid');
  }
  if (snapIrr != null) {
    if (explicitIrr != null && safeIrr(explicitIrr, 'tax_total_invalid') !== snapIrr) {
      throw Object.assign(new Error('مبلغ مالیات با تصویر مالیاتی قطعی سفارش یکسان نیست.'), {
        code: 'tax_snapshot_conflict', status: 409,
      });
    }
    if (legacyIrr != null && legacyIrr !== snapIrr) {
      throw Object.assign(new Error('مبلغ مالیات تاریخی با تصویر مالیاتی قطعی سفارش یکسان نیست.'), {
        code: 'tax_snapshot_conflict', status: 409,
      });
    }
    return snapIrr;
  }
  if (explicitIrr != null) return safeIrr(explicitIrr, 'tax_total_invalid');
  return legacyIrr ?? 0;
}
function now() { return new Date().toISOString(); }
function isoDateOnly(value) {
  const text = valueContracts.parseDateOnly(value);
  return text ? new Date(`${text}T12:00:00.000Z`) : null;
}
function isoTimestamp(value, code, message) {
  try {
    return valueContracts.requireTimestamp(value, { code, message });
  } catch (error) {
    throw Object.assign(error, { code, status: 400 });
  }
}
function optionalCalendarDate(value, code, message) {
  if (value == null || String(value).trim() === '') return null;
  const dateOnly = valueContracts.parseDateOnly(value);
  if (dateOnly) return dateOnly;
  const timestamp = isoTimestamp(value, code, message);
  return tehranDateKey(timestamp);
}
function tehranDateKey(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = Object.fromEntries(TEHRAN_DATE_FORMATTER.formatToParts(date)
    .filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
function monthStartDate(dateKey) { return `${String(dateKey).slice(0, 7)}-01`; }
function monthEndDate(dateKey) {
  const year = Number(String(dateKey).slice(0, 4));
  const month = Number(String(dateKey).slice(5, 7));
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}
function compareDateKeys(left, right) { return String(left).localeCompare(String(right)); }
function id() { return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${crypto.randomBytes(12).toString('hex')}`; }
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value === undefined ? null : value);
}
function sha256(value) { return crypto.createHash('sha256').update(String(value)).digest('hex'); }
function financeEventPayloadFingerprint(event) {
  const payload = event?.payload && typeof event.payload === 'object' ? event.payload : {};
  return sha256(canonicalJson({
    source: String(event?.source || '').trim(),
    sourceId: String(event?.sourceId || '').trim(),
    sourceVersion: Number(event?.sourceVersion ?? 1),
    branchId: branchDimension(event),
    occurredAt: event?.occurredAt || null,
    amountIrr: safeIrr(event?.amountIrr == null ? 0 : event.amountIrr, 'finance_event_amount_invalid'),
    payload,
  }));
}
function accountCodesForDb(db) {
  const accounts = list(db?.accounting?.accounts);
  return accounts.length ? new Set(accounts.map((account) => String(account?.code || account?.accountCode || '').trim()).filter(Boolean)) : null;
}
function paid(order) {
  if (typeof order?.paymentStatus === 'string') return order.paymentStatus === 'paid';
  return PAID_STATUSES.has(String(order?.status || ''));
}
function sameBranch(row, branchId) { return !branchId || Number(row?.branchId) === Number(branchId); }
function branchDimension(value) {
  const raw = value && typeof value === 'object' ? value.branchId : value;
  const branchId = Number(raw);
  return Number.isFinite(branchId) && branchId > 0 ? branchId : null;
}
function sameExactBranch(left, right) { return branchDimension(left) === branchDimension(right); }

function inventoryQuantityExceeds(requested, available) {
  // Ignore only floating-point representation noise. A fixed 1e-9 allowance
  // becomes a real stock overdraft for small decimal quantities.
  const tolerance = Math.min(
    1e-9,
    Number.EPSILON * Math.max(Math.abs(requested), Math.abs(available)) * 4,
  );
  return requested - available > tolerance;
}

function strictBranchRouteId(value) {
  const raw = String(value ?? '').trim();
  const branchId = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(branchId) || branchId <= 0) {
    throw Object.assign(new Error('شناسهٔ شعبه معتبر نیست.'), { code: 'finance_branch_id_invalid', status: 400 });
  }
  return branchId;
}

// A malformed or unknown branch query must not look like a valid empty
// workspace.  The UI uses an empty result to mean "no activity", so accepting
// branchId=999 here would hide a broken/stale branch link and make operators
// believe the selected branch has no data.  Keep fixtures without a branch
// catalog usable, but enforce the operational catalog whenever it exists.
function assertFinanceBranchQuery(db, req) {
  const raw = req.query?.branchId;
  if (raw == null || raw === '') return;
  const branchId = Number(raw);
  if (!Number.isSafeInteger(branchId) || branchId <= 0) {
    throw Object.assign(new Error('شناسهٔ شعبه معتبر نیست.'), { code: 'finance_branch_id_invalid', status: 400 });
  }
  const branches = list(db?.branches);
  if (branches.length && !branches.some((branch) => Number(branch?.id) === branchId && branch?.active !== false)) {
    throw Object.assign(new Error('شعبهٔ انتخاب‌شده یافت نشد یا غیرفعال است.'), { code: 'finance_branch_not_found', status: 404 });
  }
}

// Mutation responses must advertise the same effective branch scope that was
// validated for the operation. Most Finance V2 writes carry branchId in the
// JSON body (while reads carry it in the query string); leaving req.query
// untouched made the otherwise standard envelope report meta.branchId=null.
// Normalize only a single, positive integer scope so malformed or mixed
// branch payloads remain governed by their domain validators.
function applyFinanceResponseScope(req) {
  const query = req.query || (req.query = {});
  if (query.branchId != null && query.branchId !== '') return;
  const candidates = [req.body?.branchId, req.params?.branchId]
    .map((value) => Number(value))
    .filter((value) => Number.isSafeInteger(value) && value > 0);
  const unique = [...new Set(candidates)];
  if (unique.length === 1) query.branchId = unique[0];
}

function cloneForRollback(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function restoreArray(target, snapshot) {
  if (!Array.isArray(target) || !Array.isArray(snapshot)) return false;
  const existing = target.slice(0, snapshot.length);
  target.length = snapshot.length;
  snapshot.forEach((value, index) => {
    const current = existing[index];
    if (current && value && typeof current === 'object' && typeof value === 'object') restoreObject(current, value);
    else target[index] = cloneForRollback(value);
  });
  return true;
}

function restoreObject(target, snapshot) {
  if (!target || !snapshot || typeof target !== 'object' || typeof snapshot !== 'object') return;
  for (const key of Object.keys(target)) {
    if (!Object.prototype.hasOwnProperty.call(snapshot, key)) delete target[key];
  }
  for (const [key, value] of Object.entries(snapshot)) {
    if (Array.isArray(target[key]) && Array.isArray(value)) restoreArray(target[key], value);
    else if (target[key] && value && typeof target[key] === 'object' && typeof value === 'object' && !Array.isArray(target[key]) && !Array.isArray(value)) restoreObject(target[key], value);
    else target[key] = cloneForRollback(value);
  }
}

function restoreRollbackValue(target, snapshot) {
  if (Array.isArray(target) && Array.isArray(snapshot)) return restoreArray(target, snapshot);
  if (target && snapshot && typeof target === 'object' && typeof snapshot === 'object') {
    restoreObject(target, snapshot);
    return true;
  }
  return false;
}

function withFinanceAtomicity(db, operation, { keys = null, objects = [] } = {}) {
  const hadFinanceState = Object.prototype.hasOwnProperty.call(db, 'financeV2') && db.financeV2 !== undefined;
  const state = db.financeV2;
  const snapshotKeys = keys || Object.keys(state || {});
  const financeTargets = Object.fromEntries(snapshotKeys.map((key) => [key, state?.[key]]));
  const financeSnapshot = Object.fromEntries(snapshotKeys.map((key) => [
    key,
    Object.prototype.hasOwnProperty.call(state || {}, key) ? cloneForRollback(state[key]) : undefined,
  ]));
  const objectSnapshots = objects
    .filter((target) => target && typeof target === 'object')
    .map((target) => ({ target, snapshot: cloneForRollback(target) }));
  try {
    return operation();
  } catch (error) {
    if (hadFinanceState) {
      if (!db.financeV2 || typeof db.financeV2 !== 'object') db.financeV2 = state;
      for (const [key, before] of Object.entries(financeSnapshot)) {
        if (before === undefined) delete db.financeV2[key];
        else if (financeTargets[key] && restoreRollbackValue(financeTargets[key], before)) db.financeV2[key] = financeTargets[key];
        else db.financeV2[key] = cloneForRollback(before);
      }
    } else {
      delete db.financeV2;
    }
    for (const { target, snapshot } of objectSnapshots) restoreObject(target, snapshot);
    throw error;
  }
}

function approvalEntityBranch(state, approval) {
  if (!approval) return null;
  const collectionByType = {
    journal_entry: 'journalEntries',
    finance_event: 'events',
    finance_refund: 'refunds',
    purchase_order: 'purchaseOrders',
    vendor_invoice_match: 'vendorInvoices',
    supplier_payment: 'supplierPayments',
    cost_payment: 'costPayments',
    payroll_payment: 'payrollPayments',
    recipe_version: 'recipeVersions',
    finance_branch_rollout: 'branchRollouts',
    fiscal_period: 'fiscalPeriods',
  };
  const collection = collectionByType[approval.entityType];
  return collection ? list(state?.[collection]).find((row) => row.id === approval.entityId)?.branchId ?? null : null;
}

function approvalMatchesBranch(state, approval, branchId) {
  if (!branchId) return true;
  const entityBranchId = approvalEntityBranch(state, approval);
  return entityBranchId != null && Number(entityBranchId) === Number(branchId);
}

function assertApprovalBranchScope(state, approval, branchId) {
  if (branchId == null || branchId === '') return;
  const entityBranchId = approvalEntityBranch(state, approval);
  if (entityBranchId == null) {
    throw Object.assign(new Error('شعبهٔ درخواست تأیید مشخص نیست؛ تصمیم‌گیری متوقف شد.'), {
      code: 'approval_branch_missing', status: 409,
    });
  }
  if (Number(entityBranchId) !== Number(branchId)) {
    throw Object.assign(new Error('درخواست تأیید به شعبهٔ انتخاب‌شده تعلق ندارد.'), {
      code: 'approval_branch_mismatch', status: 409,
      details: { approvalBranchId: Number(entityBranchId), selectedBranchId: Number(branchId) },
    });
  }
}

function requestFingerprint(req) {
  const routePath = req.route?.path || String(req.originalUrl || req.path || 'unknown').split('?')[0];
  const kind = `${String(req.method || 'POST').toUpperCase()}:${routePath}`;
  const actor = req.user ? {
    id: String(req.user.id ?? req.user.userId ?? req.user.phone ?? ''),
    phone: String(req.user.phone ?? ''),
    role: String(req.user.role ?? ''),
    branchScope: branchScopeForUser(req.user, { role: req.user.role }),
  } : null;
  const fingerprint = crypto.createHash('sha256').update(canonicalJson({
    kind, actor, params: req.params || {}, query: req.query || {}, body: req.body || {},
  })).digest('hex');
  return { kind, fingerprint };
}
function inRange(row, from, to, field = 'occurredAt') {
  const value = new Date(row?.[field] || row?.date || row?.createdAt || 0).getTime();
  if (!Number.isFinite(value)) return false;
  const fromDate = from && /^\d{4}-\d{2}-\d{2}$/.test(String(from).trim())
    ? `${String(from).trim()}T00:00:00.000Z` : from;
  const toDate = to && /^\d{4}-\d{2}-\d{2}$/.test(String(to).trim())
    ? `${String(to).trim()}T23:59:59.999Z` : to;
  if (fromDate && value < new Date(fromDate).getTime()) return false;
  if (toDate && value > new Date(toDate).getTime()) return false;
  return true;
}

// Finance V2 posts an order sale at paidAt (the event's occurredAt), so
// period reports must use the same accounting timestamp as the ledger. The
// operational createdAt is still useful for intake/queue views, but using it
// for financial reconciliation splits orders paid across a period boundary.
function orderAccountingDate(order) {
  return order?.paidAt || order?.createdAt || order?.date || null;
}

function orderInAccountingRange(order, from, to) {
  return inRange({ occurredAt: orderAccountingDate(order) }, from, to);
}

function ensureFinanceV2(db) {
  if (!db.financeV2 || typeof db.financeV2 !== 'object') {
    db.financeV2 = {
      schemaVersion: 2,
      eventContractVersion: financeContracts.EVENT_CONTRACT_VERSION,
      mode: 'shadow',
      createdAt: now(),
      cutover: { status: 'shadow', startedAt: null, approvedAt: null, approvedBy: null },
      rollout: { captureEnabled: true, enabledBranchIds: [], cutoverBranchIds: [] },
      settings: {
        canonicalCurrency: 'IRR',
        displayCurrency: 'TOMAN',
        legacyAmountUnit: 'TOMAN',
        requireOpenPeriod: true,
      },
      events: [],
      payments: [],
      refunds: [],
      journalEntries: [],
      approvals: [],
      fiscalPeriods: [],
      reconciliationItems: [],
      orderItemCostSnapshots: [],
      inventoryMovements: [],
      inventoryMovementValuations: [],
      productionBatches: [],
      recipeVersions: [],
      purchaseOrders: [],
      goodsReceipts: [],
      vendorInvoices: [],
      threeWayMatches: [],
      supplierPayments: [],
      costCommitments: [],
      costAccruals: [],
      costPayments: [],
      fixedAssets: [],
      depreciationRuns: [],
      payrollRuns: [],
      payrollPayments: [],
      openingBalanceBatches: [],
      branchRollouts: [],
      migrationBaselines: [],
      legacyArchive: [],
      operatingExpenses: [],
      breakEvenPlans: [],
      idempotency: {},
      idempotencyRequests: {},
    };
  }
  const state = db.financeV2;
  state.schemaVersion = 2;
  state.eventContractVersion = financeContracts.EVENT_CONTRACT_VERSION;
  state.valueContractVersion = valueContracts.VALUE_CONTRACT_VERSION;
  state.mode = state.mode || 'shadow';
  state.cutover = state.cutover || { status: 'shadow' };
  state.rollout = { captureEnabled: true, enabledBranchIds: [], cutoverBranchIds: [], ...(state.rollout || {}) };
  state.settings = { canonicalCurrency: 'IRR', displayCurrency: 'TOMAN', legacyAmountUnit: 'TOMAN', requireOpenPeriod: true, ...(state.settings || {}) };
  for (const key of ['events', 'payments', 'refunds', 'journalEntries', 'approvals', 'fiscalPeriods', 'reconciliationItems', 'orderItemCostSnapshots', 'inventoryMovements', 'inventoryMovementValuations', 'productionBatches', 'recipeVersions', 'purchaseOrders', 'goodsReceipts', 'vendorInvoices', 'threeWayMatches', 'supplierPayments', 'costCommitments', 'costAccruals', 'costPayments', 'fixedAssets', 'depreciationRuns', 'payrollRuns', 'payrollPayments', 'openingBalanceBatches', 'branchRollouts', 'migrationBaselines', 'legacyArchive', 'operatingExpenses', 'breakEvenPlans']) {
    if (!Array.isArray(state[key])) state[key] = [];
  }
  if (!state.idempotency || typeof state.idempotency !== 'object') state.idempotency = {};
  if (!state.idempotencyRequests || typeof state.idempotencyRequests !== 'object') state.idempotencyRequests = {};
  return state;
}

function validateRecipeVersionInput(db, input = {}, { ignoreRecipeVersionId = null } = {}) {
  const state = ensureFinanceV2(db);
  const branchId = Number(input.branchId) || null;
  if (!branchId) throw Object.assign(new Error('شعبهٔ دستور تهیه الزامی است.'), { code: 'recipe_branch_required', status: 400 });
  if (list(db.branches).length && !list(db.branches).some((branch) => Number(branch.id) === branchId && branch.active !== false)) {
    throw Object.assign(new Error('شعبهٔ دستور تهیه یافت نشد یا غیرفعال است.'), { code: 'recipe_branch_not_found', status: 404 });
  }
  const menuItemId = String(input.menuItemId || '').trim();
  const menuItem = list(db.menuItems).find((row) => String(row.id) === menuItemId && row.active !== false);
  if (!menuItem) throw Object.assign(new Error('محصول فعال منو برای دستور تهیه یافت نشد.'), { code: 'recipe_menu_item_not_found', status: 404 });
  const recipeId = `menu:${menuItemId}:branch:${branchId}`;
  // Stored recipe versions use an ISO timestamp; accept its date portion on
  // approval-time revalidation while still validating the calendar date.
  const effectiveDate = valueContracts.requireDateOnly(String(input.effectiveFrom || '').slice(0, 10), {
    code: 'recipe_effective_date_invalid', message: 'تاریخ شروع اثر دستور تهیه معتبر نیست.',
  });
  const yieldQuantity = numeric(input.yieldQuantity ?? input.servings);
  if (!Number.isFinite(yieldQuantity) || yieldQuantity <= 0 || yieldQuantity > 100000) {
    throw Object.assign(new Error('تعداد خروجی یا پرس دستور تهیه باید بزرگ‌تر از صفر باشد.'), { code: 'recipe_yield_invalid', status: 400 });
  }
  const rawIngredients = list(input.ingredients);
  if (!rawIngredients.length || rawIngredients.length > 100) {
    throw Object.assign(new Error('دستور تهیه باید بین ۱ تا ۱۰۰ ماده داشته باشد.'), { code: 'recipe_ingredients_invalid', status: 400 });
  }
  const itemIds = new Set();
  const ingredients = rawIngredients.map((ingredient, index) => {
    const itemId = String(ingredient?.itemId || '').trim();
    if (!itemId || itemIds.has(itemId)) {
      throw Object.assign(new Error(`مادهٔ ردیف ${index + 1} نامعتبر یا تکراری است.`), { code: itemId ? 'recipe_ingredient_duplicate' : 'recipe_ingredient_item_required', status: 409, details: { lineNo: index + 1, itemId: itemId || null } });
    }
    itemIds.add(itemId);
    const item = inventoryOperations.resolveInventoryItemForBranch(db.accounting?.inventoryItems, itemId, branchId);
    if (!item) throw Object.assign(new Error(`کالای انبار ردیف ${index + 1} در این شعبه یافت نشد.`), { code: 'recipe_ingredient_item_not_found', status: 404, details: { lineNo: index + 1, itemId } });
    const quantity = numeric(ingredient.quantity ?? ingredient.qty);
    const unit = restaurantIntelligence.canonicalUnit(ingredient.unit || item.unit) || '';
    const converted = restaurantIntelligence.convertQuantity(quantity, unit, item.unit, item.conversions);
    if (!converted.ok || quantity <= 0) {
      throw Object.assign(new Error(`مقدار یا واحد مادهٔ ردیف ${index + 1} با واحد پایه انبار سازگار نیست.`), { code: converted.code || 'recipe_ingredient_quantity_invalid', status: 400, details: { lineNo: index + 1, itemId, unit } });
    }
    const quantityBasis = String(ingredient.quantityBasis || 'raw');
    if (!['raw', 'usable'].includes(quantityBasis)) throw Object.assign(new Error('مبنای مقدار دستور تهیه معتبر نیست.'), { code: 'recipe_quantity_basis_invalid', status: 400, details: { lineNo: index + 1 } });
    const yieldPercent = numeric(ingredient.yieldPercent ?? 100);
    if (!Number.isFinite(yieldPercent) || yieldPercent <= 0 || yieldPercent > 100) {
      throw Object.assign(new Error(`درصد بازده مادهٔ ردیف ${index + 1} باید بین صفر و صد باشد.`), { code: 'recipe_ingredient_yield_invalid', status: 400, details: { lineNo: index + 1 } });
    }
    return {
      id: ingredient.id || id(), lineNo: index + 1, itemId: item.id, itemName: item.name || itemId,
      quantity, unit, quantityBasis, yieldPercent, baseUnit: restaurantIntelligence.canonicalUnit(item.unit) || item.unit,
      convertedQuantityBase: converted.value,
    };
  });
  const outputItemId = input.outputItemId == null || input.outputItemId === '' ? null : String(input.outputItemId);
  if (outputItemId) {
    const output = inventoryOperations.resolveInventoryItemForBranch(db.accounting?.inventoryItems, outputItemId, branchId);
    if (!output) throw Object.assign(new Error('کالای خروجی دستور تولید در این شعبه یافت نشد.'), { code: 'recipe_output_item_not_found', status: 404 });
    if (itemIds.has(outputItemId) || itemIds.has(output.id)) throw Object.assign(new Error('کالای خروجی نمی‌تواند هم‌زمان مادهٔ مصرفی همان دستور تهیه باشد.'), { code: 'recipe_output_is_ingredient', status: 409 });
  }
  const siblings = state.recipeVersions.filter((row) => row.id !== ignoreRecipeVersionId && row.recipeId === recipeId);
  if (siblings.some((row) => row.status === 'pending_approval')) {
    throw Object.assign(new Error('برای این محصول منو یک نسخهٔ دستور تهیه منتظر تأیید وجود دارد.'), { code: 'recipe_version_pending_exists', status: 409 });
  }
  const version = siblings.reduce((max, row) => Math.max(max, int(row.version)), 0) + 1;
  return {
    recipeId, menuItemId, menuItemName: menuItem.name || menuItem.title || menuItemId,
    name: String(input.name || menuItem.name || menuItem.title || `دستور تهیه ${menuItemId}`).trim().slice(0, 180),
    branchId, version, yieldQuantity, servings: yieldQuantity,
    effectiveFrom: `${effectiveDate}T00:00:00.000Z`, effectiveTo: null,
    outputItemId, ingredients,
    notes: input.notes ? String(input.notes).slice(0, 1000) : null,
  };
}

function requestRecipeVersion(db, input, actor) {
  const state = ensureFinanceV2(db);
  const normalized = validateRecipeVersionInput(db, input);
  const recipeVersion = {
    id: id(), ...normalized, status: 'pending_approval', approvalId: null,
    createdBy: actor, createdAt: now(), approvedBy: null, approvedAt: null,
    rejectedBy: null, rejectedAt: null, retiredBy: null, retiredAt: null,
    history: [{ action: 'submitted', by: actor, at: now(), comment: null }],
  };
  const approval = {
    id: id(), operation: 'approve_recipe_version', entityType: 'recipe_version', entityId: recipeVersion.id,
    amountIrr: 0, status: 'pending', createdBy: actor, createdAt: now(), decidedBy: null, decidedAt: null,
    history: [{ action: 'submitted', by: actor, at: now(), comment: `menu_item:${recipeVersion.menuItemId}` }],
  };
  recipeVersion.approvalId = approval.id;
  state.recipeVersions.push(recipeVersion);
  state.approvals.push(approval);
  return { recipeVersion, approval };
}

function inventoryItemsView(db, query = {}, { hideFinancial = false } = {}) {
  const state = ensureFinanceV2(db);
  const branchId = query.branchId ? Number(query.branchId) : null;
  const items = list(db.accounting?.inventoryItems).filter((row) => sameBranch(row, branchId));
  return {
    items: items.map((item) => {
      const available = orderCosting.physicalAvailable(item, state, branchId);
      const recipeCount = restaurantIntelligence.recipeCatalog(db, branchId, { includePending: true })
        .filter((recipe) => list(recipe.ingredients).some((ingredient) => {
          const ingId = String(ingredient.itemId || '');
          const itemId = String(item.id || '');
          return ingId === itemId || ingId === itemId.replace(/-b\d+$/, '');
        })).length;
      const safeItem = { ...item };
      if (hideFinancial) {
        delete safeItem.avgCostIrr;
        delete safeItem.unitCostIrr;
        delete safeItem.avgCost;
        delete safeItem.unitCost;
        delete safeItem.cost;
        delete safeItem.accountCode;
        delete safeItem.inventoryAccountCode;
        delete safeItem.expenseAccountCode;
      }
      return {
        ...safeItem,
        availableQuantity: available.ok ? available.value : null,
        availabilityStatus: available.ok ? (available.value < 0 ? 'negative' : 'known') : 'unknown',
        recipeCount,
      };
    }),
    units: ['عدد', 'گرم', 'کیلوگرم', 'میلی‌لیتر', 'لیتر'],
    categories: [...new Set(items.map((item) => String(item.category || '').trim()).filter(Boolean))],
  };
}

function createInventoryItemV2(db, input = {}, actor = 'system') {
  const state = ensureFinanceV2(db);
  const branchId = Number(input.branchId) || null;
  if (!branchId) throw Object.assign(new Error('شعبهٔ مادهٔ انبار الزامی است.'), { code: 'inventory_branch_required', status: 400 });
  if (list(db.branches).length && !list(db.branches).some((branch) => Number(branch.id) === branchId && branch.active !== false)) {
    throw Object.assign(new Error('شعبهٔ مادهٔ انبار یافت نشد یا غیرفعال است.'), { code: 'inventory_branch_not_found', status: 404 });
  }
  const name = String(input.name || '').trim().slice(0, 180);
  const rawUnit = String(input.unit ?? '').trim();
  const unit = restaurantIntelligence.canonicalUnit(rawUnit) || '';
  const sku = String(input.sku || '').trim().slice(0, 80);
  const category = String(input.category || '').trim().slice(0, 80) || 'سایر';
  if (name.length < 2) throw Object.assign(new Error('نام مادهٔ انبار الزامی است.'), { code: 'inventory_name_required', status: 400 });
  if (rawUnit.length < 1) throw Object.assign(new Error('واحد پایهٔ مادهٔ انبار الزامی است.'), { code: 'inventory_unit_required', status: 400 });
  if (unit.length < 1) throw Object.assign(new Error('واحد پایهٔ مادهٔ انبار پشتیبانی نمی‌شود؛ گرم، کیلوگرم، میلی‌لیتر، لیتر یا عدد را انتخاب کنید.'), { code: 'inventory_unit_invalid', status: 400 });
  const items = list(db.accounting?.inventoryItems);
  if (items.some((item) => sameBranch(item, branchId) && String(item.name || '').trim().toLowerCase() === name.toLowerCase())) {
    throw Object.assign(new Error('ماده‌ای با این نام در شعبهٔ انتخاب‌شده وجود دارد.'), { code: 'inventory_name_duplicate', status: 409 });
  }
  if (sku && items.some((item) => sameBranch(item, branchId) && String(item.sku || '').trim().toLowerCase() === sku.toLowerCase())) {
    throw Object.assign(new Error('کد کالا در این شعبه تکراری است.'), { code: 'inventory_sku_duplicate', status: 409 });
  }
  const qtyOnHand = numeric(input.qtyOnHand ?? input.openingQuantity ?? 0);
  const minStock = numeric(input.minStock ?? 0);
  const rawCost = input.avgCostIrr ?? input.unitCostIrr;
  const hasCost = rawCost !== undefined && rawCost !== null && String(rawCost).trim() !== '';
  let avgCostIrr = null;
  if (hasCost) {
    try { avgCostIrr = valueContracts.parseIrr(rawCost, { allowNegative: false }); } catch {
      throw Object.assign(new Error('بهای میانگین باید عدد صحیح ریالی نامنفی باشد.'), { code: 'inventory_cost_invalid', status: 400 });
    }
  }
  if (!Number.isFinite(qtyOnHand) || qtyOnHand < 0) throw Object.assign(new Error('موجودی اولیه معتبر نیست.'), { code: 'inventory_quantity_invalid', status: 400 });
  if (!Number.isFinite(minStock) || minStock < 0) throw Object.assign(new Error('حداقل موجودی معتبر نیست.'), { code: 'inventory_min_stock_invalid', status: 400 });
  if (hasCost && (!Number.isSafeInteger(avgCostIrr) || avgCostIrr < 0)) throw Object.assign(new Error('بهای میانگین باید عدد صحیح ریالی نامنفی باشد.'), { code: 'inventory_cost_invalid', status: 400 });
  const item = {
    id: id('inv'), sku: sku || `INV-${String(items.length + 1).padStart(4, '0')}`,
    name, category, unit, qtyOnHand, avgCostIrr, minStock, branchId,
    createdAt: now(), updatedAt: now(), createdBy: actor,
  };
  if (!db.accounting || typeof db.accounting !== 'object') db.accounting = {};
  if (!Array.isArray(db.accounting.inventoryItems)) db.accounting.inventoryItems = [];
  db.accounting.inventoryItems.push(item);
  return { item, idempotentReplay: false };
}

function updateInventoryItemV2(db, itemId, input = {}, actor = 'system') {
  const branchId = Number(input.branchId) || null;
  const item = list(db.accounting?.inventoryItems).find((row) => String(row.id) === String(itemId) && sameBranch(row, branchId));
  if (!item) throw Object.assign(new Error('مادهٔ انبار در شعبهٔ انتخاب‌شده یافت نشد.'), { code: 'inventory_item_not_found', status: 404 });
  const nextName = input.name === undefined ? item.name : String(input.name || '').trim().slice(0, 180);
  const nextSku = input.sku === undefined ? item.sku : String(input.sku || '').trim().slice(0, 80);
  const nextCategory = input.category === undefined ? item.category : String(input.category || '').trim().slice(0, 80) || 'سایر';
  const nextMinStock = input.minStock === undefined ? numeric(item.minStock || 0) : numeric(input.minStock);
  if (nextName.length < 2) throw Object.assign(new Error('نام مادهٔ انبار الزامی است.'), { code: 'inventory_name_required', status: 400 });
  if (!Number.isFinite(nextMinStock) || nextMinStock < 0) throw Object.assign(new Error('حداقل موجودی معتبر نیست.'), { code: 'inventory_min_stock_invalid', status: 400 });
  const items = list(db.accounting?.inventoryItems);
  if (items.some((row) => row.id !== item.id && sameBranch(row, branchId) && String(row.name || '').trim().toLowerCase() === nextName.toLowerCase())) {
    throw Object.assign(new Error('ماده‌ای با این نام در این شعبه وجود دارد.'), { code: 'inventory_name_duplicate', status: 409 });
  }
  if (nextSku && items.some((row) => row.id !== item.id && sameBranch(row, branchId) && String(row.sku || '').trim().toLowerCase() === nextSku.toLowerCase())) {
    throw Object.assign(new Error('کد کالا در این شعبه تکراری است.'), { code: 'inventory_sku_duplicate', status: 409 });
  }
  item.name = nextName; item.sku = nextSku || item.sku; item.category = nextCategory;
  item.minStock = nextMinStock; item.updatedAt = now(); item.updatedBy = actor;
  return { item, idempotentReplay: false };
}

function operatingExpensesView(db, query = {}) {
  const state = ensureFinanceV2(db);
  const branchId = query.branchId ? Number(query.branchId) : null;
  const rows = state.operatingExpenses
    .filter((row) => sameBranch(row, branchId) && inRange(row, query.from, query.to, 'date'))
    .map((row) => ({
      ...row,
      journalEntry: row.journalEntryId ? state.journalEntries.find((entry) => entry.id === row.journalEntryId) || null : null,
      approval: row.approvalId ? state.approvals.find((approval) => approval.id === row.approvalId) || null : null,
    }))
    .sort((a, b) => new Date(b.date || b.createdAt) - new Date(a.date || a.createdAt));
  return {
    expenses: rows,
    categories: Object.entries(OPERATING_EXPENSE_CATEGORIES).map(([id, value]) => ({ id, ...value })),
    summary: {
      count: rows.length,
      totalIrr: rows.reduce((sum, row) => sum + int(row.amountIrr), 0),
      pendingApproval: rows.filter((row) => row.status === 'pending_approval').length,
      posted: rows.filter((row) => row.status === 'posted').length,
    },
  };
}

function createOperatingExpenseV2(db, input = {}, actor = 'system') {
  const state = ensureFinanceV2(db);
  const branchId = Number(input.branchId) || null;
  if (!branchId) throw Object.assign(new Error('شعبهٔ هزینه الزامی است.'), { code: 'expense_branch_required', status: 400 });
  const subject = String(input.subject || input.description || '').trim().slice(0, 240);
  if (subject.length < 2) throw Object.assign(new Error('شرح هزینه الزامی است.'), { code: 'expense_subject_required', status: 400 });
  if (String(input.expenseType || 'operating') === 'capital') {
    throw Object.assign(new Error('هزینهٔ سرمایه‌ای را باید از بخش دارایی ثابت ثبت کنید تا استهلاک و سند آن درست ثبت شود.'), { code: 'capital_expense_use_fixed_asset', status: 409 });
  }
  let amountIrr;
  try {
    amountIrr = input.amountIrr !== undefined && input.amountIrr !== ''
      ? valueContracts.parseIrr(input.amountIrr, { allowNegative: false })
      : valueContracts.parseToman(input.amountToman, { allowNegative: false });
  } catch {
    throw Object.assign(new Error('مبلغ هزینه باید عدد صحیح ریالی بزرگ‌تر از صفر باشد.'), { code: 'expense_amount_invalid', status: 400 });
  }
  if (amountIrr <= 0) throw Object.assign(new Error('مبلغ هزینه باید عدد صحیح ریالی بزرگ‌تر از صفر باشد.'), { code: 'expense_amount_invalid', status: 400 });
  const dateOnly = valueContracts.requireDateOnly(String(input.date || now()).slice(0, 10), {
    code: 'expense_date_invalid', message: 'تاریخ هزینه معتبر نیست.',
  });
  const dateAt = isoDateOnly(dateOnly);
  if (!dateAt) throw Object.assign(new Error('تاریخ هزینه معتبر نیست.'), { code: 'expense_date_invalid', status: 400 });
  const periodCheck = validateOpenPeriod(db, dateAt.toISOString(), branchId);
  if (!periodCheck.ok) throw Object.assign(new Error(periodCheck.message), { code: periodCheck.code, status: 409 });
  const category = Object.prototype.hasOwnProperty.call(OPERATING_EXPENSE_CATEGORIES, String(input.category || ''))
    ? String(input.category) : 'other';
  const requestedAccount = String(input.expenseAccount || OPERATING_EXPENSE_CATEGORIES[category].expenseAccount);
  const account = list(db.accounting?.accounts).find((row) => String(row.code) === requestedAccount);
  if (!account || account.type !== 'expense' || account.isPostingAccount === false) {
    throw Object.assign(new Error('حساب هزینهٔ انتخاب‌شده در طرح حساب‌ها معتبر نیست.'), { code: 'expense_account_invalid', status: 400 });
  }
  const paymentMethod = String(input.paymentMethod || 'cash');
  const paymentAccounts = { cash: '1110', petty_cash: '1120', bank: '1210', credit: '2700' };
  const paymentAccount = paymentAccounts[paymentMethod];
  if (!paymentAccount) throw Object.assign(new Error('روش پرداخت هزینه معتبر نیست.'), { code: 'expense_payment_method_invalid', status: 400 });
  const expenseId = id('fex');
  const entry = createDraft(db, {
    date: dateAt.toISOString(), branchId, costCenter: `branch:${branchId}`,
    description: `هزینه: ${subject}`,
    lines: [
      { accountCode: requestedAccount, accountType: 'expense', debitIrr: amountIrr, creditIrr: 0, branchId, costCenter: `branch:${branchId}`, paymentMethod, memo: subject },
      { accountCode: paymentAccount, accountType: paymentMethod === 'credit' ? 'liability' : 'asset', debitIrr: 0, creditIrr: amountIrr, branchId, costCenter: `branch:${branchId}`, paymentMethod, memo: `پرداخت/تعهد هزینهٔ ${subject}` },
    ],
  }, actor);
  entry.source = 'expense.manual'; entry.sourceId = expenseId;
  const submitted = submitDraft(db, entry.id, actor);
  const expense = {
    id: expenseId, branchId, category, expenseAccount: requestedAccount, expenseAccountName: account.nameFa || account.name,
    subject, description: subject, amountIrr, amountToman: Math.round(amountIrr / 10), paymentMethod,
    date: dateAt.toISOString(), status: 'pending_approval', journalEntryId: entry.id, approvalId: submitted.approval.id,
    vendorName: String(input.vendorName || input.counterparty || '').trim().slice(0, 160) || null,
    reference: String(input.reference || '').trim().slice(0, 120) || null,
    createdBy: actor, createdAt: now(), decidedBy: null, decidedAt: null,
  };
  state.operatingExpenses.push(expense);
  return { expense, journalEntry: entry, approval: submitted.approval, idempotentReplay: false };
}

function financeV2CaptureEnabledForBranch(db, branchId) {
  const rollout = ensureFinanceV2(db).rollout;
  const enabledBranchIds = Array.isArray(rollout.enabledBranchIds) ? rollout.enabledBranchIds.map(Number) : [];
  return rollout.captureEnabled !== false
    && (!enabledBranchIds.length || enabledBranchIds.includes(Number(branchId)));
}

function menuItemUsesInventoryV2(db, menuItemId, branchId, soldAt = now()) {
  if (!financeV2CaptureEnabledForBranch(db, branchId)) return false;
  const recipe = restaurantIntelligence.effectiveRecipeForSale(
    restaurantIntelligence.recipeCatalog(db, branchId), menuItemId, soldAt,
  );
  return Boolean(recipe);
}

function recipeIngredientRequirements(db, recipe, branchId) {
  const items = list(db.accounting?.inventoryItems).filter((row) => sameBranch(row, branchId));
  const numBranch = Number(branchId);
  const branchSuffix = numBranch ? `-b${numBranch}`.toLowerCase() : null;
  const itemMap = new Map();
  for (const item of items) {
    const idStr = String(item.id || '').trim();
    const skuStr = String(item.sku || '').trim();
    if (idStr) {
      itemMap.set(idStr, item);
      itemMap.set(idStr.toLowerCase(), item);
      if (branchSuffix && idStr.toLowerCase().endsWith(branchSuffix)) {
        const base = idStr.slice(0, -branchSuffix.length);
        if (base && !itemMap.has(base)) {
          itemMap.set(base, item);
          itemMap.set(base.toLowerCase(), item);
        }
      }
    }
    if (skuStr) {
      itemMap.set(skuStr, item);
      itemMap.set(skuStr.toLowerCase(), item);
      itemMap.set(`sku:${skuStr}`, item);
      itemMap.set(`sku:${skuStr.toLowerCase()}`, item);
      if (branchSuffix && skuStr.toLowerCase().endsWith(branchSuffix)) {
        const baseSku = skuStr.slice(0, -branchSuffix.length);
        if (baseSku && !itemMap.has(`sku:${baseSku}`)) {
          itemMap.set(`sku:${baseSku}`, item);
          itemMap.set(`sku:${baseSku.toLowerCase()}`, item);
          itemMap.set(baseSku, item);
          itemMap.set(baseSku.toLowerCase(), item);
        }
      }
    }
  }
  const requirements = new Map();
  const issues = [];
  for (const ingredient of list(recipe.ingredients)) {
    const key = String(ingredient.itemId || '').trim();
    const item = itemMap.get(key)
      || itemMap.get(key.toLowerCase())
      || itemMap.get(`sku:${key}`)
      || itemMap.get(`sku:${key.toLowerCase()}`)
      || (branchSuffix ? (itemMap.get(`${key}${branchSuffix}`) || itemMap.get(`${key.toLowerCase()}${branchSuffix}`)) : null);
    if (!item) { issues.push({ code: 'ingredient_item_missing', itemId: ingredient.itemId || null }); continue; }
    const required = restaurantIntelligence.ingredientRequirement(ingredient, recipe, item);
    if (!required.ok || !Number.isFinite(required.value) || required.value <= 0) {
      issues.push({ code: required.code || 'ingredient_quantity_invalid', itemId: item.id });
      continue;
    }
    const row = requirements.get(String(item.id)) || { item, requiredPerSale: 0, recipeVersionIds: new Set() };
    row.requiredPerSale += required.value;
    row.recipeVersionIds.add(String(recipe.id ?? recipe.versionId ?? recipe.version ?? 'unknown'));
    requirements.set(String(item.id), row);
  }
  if (!requirements.size && !issues.length) issues.push({ code: 'recipe_ingredients_missing' });
  return { requirements, issues };
}

function buildOrderInventoryReservationSnapshot(db, lines, branchId, reservedAt = now()) {
  const aggregated = new Map();
  const issues = [];
  if (!Number.isSafeInteger(Number(branchId)) || Number(branchId) <= 0) {
    return { ok: false, version: 1, branchId: null, reservedAt, items: [], issues: [{ code: 'branch_missing' }] };
  }
  const at = new Date(reservedAt);
  if (!Number.isFinite(at.getTime())) {
    return { ok: false, version: 1, branchId: Number(branchId), reservedAt: null, items: [], issues: [{ code: 'inventory_reservation_date_invalid' }] };
  }
  for (const [index, line] of list(lines).entries()) {
    const quantity = Number(line?.qty ?? line?.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      issues.push({ code: 'order_line_quantity_invalid', line: index + 1 });
      continue;
    }
    if (!financeV2CaptureEnabledForBranch(db, branchId)) continue;
    const recipe = restaurantIntelligence.effectiveRecipeForSale(
      restaurantIntelligence.recipeCatalog(db, branchId), line?.menuItemId ?? line?.itemId, reservedAt,
    );
    if (!recipe) continue;
    const resolved = recipeIngredientRequirements(db, recipe, branchId);
    issues.push(...resolved.issues.map((issue) => ({ ...issue, line: index + 1 })));
    for (const [itemId, row] of resolved.requirements) {
      const requiredQuantity = row.requiredPerSale * quantity;
      if (!Number.isFinite(requiredQuantity) || requiredQuantity <= 0) {
        issues.push({ code: 'inventory_reservation_quantity_invalid', itemId, line: index + 1 });
        continue;
      }
      const aggregate = aggregated.get(itemId) || {
        itemId, quantityBase: 0, unit: row.item.unit || null, recipeVersionIds: new Set(),
      };
      aggregate.quantityBase += requiredQuantity;
      row.recipeVersionIds.forEach((versionId) => aggregate.recipeVersionIds.add(versionId));
      aggregated.set(itemId, aggregate);
    }
  }
  const items = [...aggregated.values()].map((row) => ({
    itemId: row.itemId,
    quantityBase: row.quantityBase,
    unit: row.unit,
    recipeVersionIds: [...row.recipeVersionIds].sort(),
  }));
  if (items.some((row) => !Number.isFinite(row.quantityBase) || row.quantityBase <= 0)) {
    issues.push({ code: 'inventory_reservation_quantity_invalid' });
  }
  return {
    ok: issues.length === 0,
    version: 1,
    branchId: Number(branchId),
    reservedAt: at.toISOString(),
    items,
    issues,
  };
}

function committedOrderInventoryConsumption(db, order) {
  const state = ensureFinanceV2(db);
  return state.events.some((event) => {
    if (event.source !== 'order.cogs' || String(event.sourceId) !== String(order?.id)
      || !sameExactBranch(event, order) || event.status !== 'posted' || !event.journalEntryId) return false;
    const entry = state.journalEntries.find((row) => String(row.id) === String(event.journalEntryId));
    return entry?.status === 'posted' && !entry.reversedById;
  });
}

function openOrderInventoryReservations(db, branchId, { excludeOrderId = null } = {}) {
  const quantities = new Map();
  const issues = [];
  const seen = new Set();
  for (const order of list(db.orders)) {
    const orderId = String(order?.id ?? '');
    if (!orderId || seen.has(orderId) || String(excludeOrderId ?? '') === orderId
      || Number(order?.branchId) !== Number(branchId)
      || ['cancelled', 'rejected'].includes(String(order?.status || '').toLowerCase())) continue;
    seen.add(orderId);
    if (committedOrderInventoryConsumption(db, order)) continue;

    let reservationItems;
    const snapshot = order.inventoryReservationSnapshot;
    if (snapshot !== undefined) {
      if (!snapshot || snapshot.version !== 1 || Number(snapshot.branchId) !== Number(order.branchId)
        || !Array.isArray(snapshot.items)) {
        issues.push({ code: 'inventory_reservation_invalid', orderId });
        continue;
      }
      reservationItems = snapshot.items;
    } else {
      // Compatibility for orders created before reservation snapshots existed:
      // derive a hold from the recipe version effective when the order was placed.
      const derived = buildOrderInventoryReservationSnapshot(db, order.items, order.branchId, order.createdAt || now());
      if (!derived.ok) {
        issues.push({ code: 'inventory_reservation_unresolved', orderId });
        continue;
      }
      reservationItems = derived.items;
    }

    for (const reservation of reservationItems) {
      const itemId = String(reservation?.itemId || '').trim();
      const quantity = Number(reservation?.quantityBase);
      if (!itemId || !Number.isFinite(quantity) || quantity <= 0) {
        issues.push({ code: 'inventory_reservation_invalid', orderId });
        break;
      }
      const next = (quantities.get(itemId) || 0) + quantity;
      if (!Number.isFinite(next)) {
        issues.push({ code: 'inventory_reservation_quantity_invalid', orderId, itemId });
        break;
      }
      quantities.set(itemId, next);
    }
  }
  return { quantities, issues };
}

function menuItemAvailability(db, menuItemId, branchId, requestedQuantity = 1, soldAt = now(), { excludeOrderId = null } = {}) {
  if (!financeV2CaptureEnabledForBranch(db, branchId)) {
    return { ok: true, available: true, tracked: false, reason: 'finance_v2_feature_flag_disabled', capacity: null, issues: [] };
  }
  const recipe = restaurantIntelligence.effectiveRecipeForSale(
    restaurantIntelligence.recipeCatalog(db, branchId), menuItemId, soldAt,
  );
  if (!recipe) return { ok: true, available: true, tracked: false, reason: 'recipe_missing', capacity: null, issues: [] };
  const state = ensureFinanceV2(db);
  const quantity = Number(requestedQuantity);
  const requested = Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
  const { requirements, issues } = recipeIngredientRequirements(db, recipe, branchId);
  const reservations = openOrderInventoryReservations(db, branchId, { excludeOrderId });
  issues.push(...reservations.issues);
  let capacity = Infinity;
  for (const [itemId, { item, requiredPerSale }] of requirements) {
    const available = orderCosting.physicalAvailable(item, state, branchId);
    if (!available.ok) { issues.push({ code: available.code, itemId: item.id }); continue; }
    const reserved = reservations.quantities.get(itemId) || 0;
    const reservationExceedsAvailable = inventoryQuantityExceeds(reserved, available.value);
    const rawSellable = available.value - reserved;
    const sellable = reservationExceedsAvailable ? rawSellable : Math.max(0, rawSellable);
    if (reservationExceedsAvailable) {
      issues.push({ code: 'inventory_reservations_exceed_available', itemId: item.id, reservedQuantity: reserved, availableQuantity: available.value });
    }
    const needed = requiredPerSale * requested;
    const itemCapacity = Math.max(0, Math.floor(Math.max(0, sellable) / requiredPerSale));
    capacity = Math.min(capacity, itemCapacity);
    if (inventoryQuantityExceeds(needed, sellable)) {
      issues.push({ code: 'inventory_shortage', itemId: item.id, itemName: item.name, requiredQuantity: needed, availableQuantity: Math.max(0, sellable), reservedQuantity: reserved });
    }
  }
  if (!requirements.size && !issues.length) issues.push({ code: 'recipe_ingredients_missing' });
  const ok = issues.length === 0;
  return {
    ok, available: ok, tracked: true, recipeId: recipe.id || null, capacity: Number.isFinite(capacity) ? capacity : 0,
    issues, reason: ok ? 'inventory_available' : issues[0]?.code || 'inventory_unavailable',
  };
}

function periodForDate(db, date, branchId = null) {
  const at = new Date(date);
  if (!Number.isFinite(at.getTime())) return null;
  const v2Periods = ensureFinanceV2(db).fiscalPeriods;
  const periods = v2Periods.length ? v2Periods : list(db.accounting?.fiscalPeriods);
  const candidates = periods.filter((period) => {
    const start = new Date(`${String(period.startDate || '').slice(0, 10)}T00:00:00.000Z`);
    const end = new Date(`${String(period.endDate || '').slice(0, 10)}T23:59:59.999Z`);
    return Number.isFinite(start.getTime()) && Number.isFinite(end.getTime()) && start <= at && end >= at
      && (branchId == null || period.branchId == null || Number(period.branchId) === Number(branchId));
  });
  if (!candidates.length) return null;
  // A branch-specific period wins over a global fallback. Ambiguous periods
  // fail closed instead of silently selecting whichever row was inserted first.
  const specific = branchId == null ? [] : candidates.filter((period) => period.branchId != null);
  const selected = specific.length ? specific : candidates.filter((period) => period.branchId == null);
  return selected.length === 1 ? selected[0] : null;
}

function createFiscalPeriod(db, input, actor) {
  const state = ensureFinanceV2(db);
  const branchId = input.branchId == null || input.branchId === '' ? null : Number(input.branchId);
  if (branchId != null && (!Number.isSafeInteger(branchId) || branchId <= 0)) {
    throw Object.assign(new Error('شعبهٔ دورهٔ مالی معتبر نیست.'), { code: 'fiscal_period_branch_invalid', status: 400 });
  }
  const startDate = valueContracts.requireDateOnly(input.startDate, {
    code: 'fiscal_period_date_invalid', message: 'تاریخ شروع دوره معتبر نیست.',
  });
  const endDate = valueContracts.requireDateOnly(input.endDate, {
    code: 'fiscal_period_date_invalid', message: 'تاریخ پایان دوره معتبر نیست.',
  });
  const start = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start > end) throw Object.assign(new Error('محدودهٔ دوره معتبر نیست.'), { code: 'fiscal_period_range_invalid' });
  const scopedPeriods = state.fiscalPeriods.filter((period) => period.branchId == null || branchId == null || Number(period.branchId) === branchId);
  const overlapping = scopedPeriods.find((period) => new Date(period.startDate) <= end && new Date(period.endDate) >= start);
  if (overlapping) throw Object.assign(new Error(`دوره با «${overlapping.name}» هم‌پوشانی دارد.`), { code: 'fiscal_period_overlap', status: 409 });
  const sorted = scopedPeriods.slice().sort((a, b) => new Date(a.startDate) - new Date(b.startDate));
  const previous = sorted.filter((period) => new Date(period.endDate) < start).at(-1);
  const next = sorted.find((period) => new Date(period.startDate) > end);
  const dayMs = 86400000;
  if (previous && Math.round((start - new Date(previous.endDate)) / dayMs) !== 1) throw Object.assign(new Error('بین دورهٔ قبلی و دورهٔ جدید فاصله وجود دارد.'), { code: 'fiscal_period_gap', status: 409 });
  if (next && Math.round((new Date(next.startDate) - end) / dayMs) !== 1) throw Object.assign(new Error('بین دورهٔ جدید و دورهٔ بعدی فاصله وجود دارد.'), { code: 'fiscal_period_gap', status: 409 });
  const period = { id: id(), name: String(input.name || '').trim().slice(0, 120) || `${startDate} تا ${endDate}`, startDate, endDate, branchId, status: 'open', createdBy: actor, createdAt: now(), closedBy: null, closedAt: null, reopenedBy: null, reopenedAt: null };
  state.fiscalPeriods.push(period);
  return period;
}

function closeFiscalPeriod(db, periodId, actor, { preliminary = true, branchId = null } = {}) {
  const state = ensureFinanceV2(db);
  const period = state.fiscalPeriods.find((item) => String(item.id) === String(periodId));
  if (!period) throw Object.assign(new Error('دورهٔ مالی یافت نشد.'), { code: 'fiscal_period_not_found', status: 404 });
  if (branchId != null && period.branchId != null && Number(period.branchId) !== Number(branchId)) {
    throw Object.assign(new Error('دسترسی به دورهٔ مالی این شعبه مجاز نیست.'), { code: 'fiscal_period_branch_mismatch', status: 403 });
  }
  const allowedStatuses = preliminary ? ['open', 'reopened'] : ['open', 'reopened', 'soft_closed'];
  if (!allowedStatuses.includes(period.status)) throw Object.assign(new Error('این دوره در وضعیت قابل بستن نیست.'), { code: 'fiscal_period_not_open', status: 409 });
  if (preliminary) {
    period.status = 'soft_closed';
    period.preliminaryClosedBy = actor;
    period.preliminaryClosedAt = now();
    return { period, checklist: null };
  }
  const review = ledgerClose(db, {
    periodId: period.id,
    branchId: period.branchId ?? branchId,
    from: `${period.startDate}T00:00:00.000Z`,
    to: `${period.endDate}T23:59:59.999Z`,
    page: 1,
    pageSize: 100,
    allowSoftClosed: true,
  });
  const blockers = review.closeChecklist.filter((item) => !item.passed);
  if (blockers.length) {
    const error = Object.assign(new Error('دوره تا رفع تمام موانع چک‌لیست قابل بستن نهایی نیست.'), { code: 'period_close_blocked', status: 409 });
    error.details = { blockers };
    throw error;
  }
  period.status = 'closed';
  period.closedBy = actor;
  period.closedAt = now();
  return { period, checklist: review.closeChecklist };
}

function requestPeriodReopen(db, periodId, actor, reason) {
  const state = ensureFinanceV2(db);
  const period = state.fiscalPeriods.find((item) => String(item.id) === String(periodId));
  if (!period) throw Object.assign(new Error('دورهٔ مالی یافت نشد.'), { code: 'fiscal_period_not_found', status: 404 });
  if (!['closed', 'soft_closed'].includes(period.status)) throw Object.assign(new Error('فقط دورهٔ بسته قابل درخواست بازگشایی است.'), { code: 'fiscal_period_not_closed', status: 409 });
  const normalizedReason = String(reason || '').trim();
  if (normalizedReason.length < 3) throw Object.assign(new Error('علت بازگشایی دوره باید حداقل ۳ کاراکتر داشته باشد.'), { code: 'period_reopen_reason_required', status: 400 });
  const existing = state.approvals.find((item) => item.entityType === 'fiscal_period' && String(item.entityId) === String(period.id) && item.operation === 'reopen_fiscal_period' && item.status === 'pending');
  if (existing) return { approval: existing, idempotentReplay: true };
  const approval = {
    id: id(), operation: 'reopen_fiscal_period', entityType: 'fiscal_period', entityId: period.id,
    amountIrr: null, status: 'pending', createdBy: actor, createdAt: now(), decidedBy: null, decidedAt: null,
    history: [{ action: 'submitted', by: actor, at: now(), comment: normalizedReason.slice(0, 300) }],
  };
  state.approvals.push(approval);
  return { approval, idempotentReplay: false };
}

function validateOpenPeriod(db, date, branchId = null) {
  const period = periodForDate(db, date, branchId);
  if (!period) return { ok: false, code: 'fiscal_period_missing', message: 'برای تاریخ رویداد، دورهٔ مالی تعریف نشده است.' };
  if (!['open', 'reopened'].includes(period.status)) {
    return { ok: false, code: 'fiscal_period_closed', message: `دورهٔ «${period.name || period.id}» باز نیست.`, period };
  }
  return { ok: true, period };
}

function normalizeTenderRows(order) {
  const sourcePayments = list(order?.partialPayments);
  if (sourcePayments.length) {
    return sourcePayments.map((payment) => {
      let grossAmountIrr = null;
      let refundedAmountIrr = null;
      try {
        grossAmountIrr = strictLegacyTomanIrr(payment.amount, 'order_payment_amount_invalid');
        refundedAmountIrr = strictLegacyTomanIrr(payment.refundedAmount ?? 0, 'order_payment_refund_invalid');
        if (refundedAmountIrr > grossAmountIrr) throw new RangeError('Refund exceeds payment');
      } catch (_) {
        grossAmountIrr = null;
        refundedAmountIrr = null;
      }
      if (grossAmountIrr != null && grossAmountIrr === refundedAmountIrr) return null;
      return {
        tender: String(payment.tender || '').trim(),
        amountIrr: grossAmountIrr == null ? null : grossAmountIrr - refundedAmountIrr,
        grossAmountIrr,
        refundedAmountIrr,
        paymentId: payment.id == null ? null : String(payment.id),
        occurredAt: payment.at || order.paidAt || order.createdAt,
        provider: payment.provider || null,
        providerReference: payment.reference || payment.providerReference || null,
        cashSessionId: payment.cashSessionId || null,
        receiptEventId: payment.financeReceiptEventId || null,
        receiptJournalEntryId: payment.financeReceiptJournalEntryId || null,
      };
    }).filter(Boolean);
  }
  const tender = String(order?.paymentTender || order?.paymentMethod || '').trim();
  if (!TENDER_ACCOUNTS[tender] || tender === 'cashier') return [];
  return [{ tender, amountIrr: irrFromLegacyToman(order.total), paymentId: null, occurredAt: order.paidAt || order.createdAt, provider: null, providerReference: null }];
}

function reliableTenderRows(rows, totalIrr) {
  const total = Number(totalIrr);
  const tenderRows = list(rows).map((row) => ({
    tender: String(row?.tender || '').trim(), amountIrr: Number(row?.amountIrr),
    grossAmountIrr: row?.grossAmountIrr == null ? Number(row?.amountIrr) : Number(row.grossAmountIrr),
    refundedAmountIrr: Number(row?.refundedAmountIrr || 0),
  }));
  const sum = tenderRows.reduce((amount, row) => amount + row.amountIrr, 0);
  return Number.isSafeInteger(total) && total >= 0 && tenderRows.length > 0
    && tenderRows.every((row) => TENDER_ACCOUNTS[row.tender] && Number.isSafeInteger(row.amountIrr) && row.amountIrr > 0
      && Number.isSafeInteger(row.grossAmountIrr) && row.grossAmountIrr >= row.amountIrr
      && Number.isSafeInteger(row.refundedAmountIrr) && row.grossAmountIrr - row.amountIrr === row.refundedAmountIrr)
    && Number.isSafeInteger(sum) && sum === total;
}

function reliableTenderSnapshot(rows, totalIrr) {
  if (!reliableTenderRows(rows, totalIrr)) return null;
  return list(rows).map((row) => ({
    tender: String(row?.tender || '').trim(), amountIrr: int(row?.amountIrr),
    ...(row?.grossAmountIrr == null ? {} : { grossAmountIrr: int(row.grossAmountIrr) }),
    ...(row?.refundedAmountIrr == null ? {} : { refundedAmountIrr: int(row.refundedAmountIrr) }),
    paymentId: row?.paymentId == null ? null : String(row.paymentId),
    occurredAt: row?.occurredAt || null, provider: row?.provider || null,
    providerReference: row?.providerReference || null,
    cashSessionId: row?.cashSessionId || null,
    ...(row?.receiptEventId ? { receiptEventId: String(row.receiptEventId) } : {}),
    ...(row?.receiptJournalEntryId ? { receiptJournalEntryId: String(row.receiptJournalEntryId) } : {}),
  }));
}

function orderPaymentIdentity(order, row, index) {
  const operationalPaymentId = row?.paymentId == null ? null : String(row.paymentId);
  const sourceKey = operationalPaymentId || `tender-${index + 1}`;
  return {
    idempotencyKey: `order:${order.id}:payment:${sourceKey}`,
    orderId: String(order.id),
    branchId: branchDimension(order),
    tender: String(row?.tender || '').trim(),
    amountIrr: safeIrr(row?.grossAmountIrr == null ? row?.amountIrr : row.grossAmountIrr),
    operationalPaymentId,
    provider: row?.provider == null || String(row.provider).trim() === '' ? null : String(row.provider).trim(),
    providerReference: row?.providerReference == null || String(row.providerReference).trim() === ''
      ? null : String(row.providerReference).trim(),
  };
}

function assertOrderPaymentIdentity(payment, identity) {
  const storedOperationalPaymentId = payment?.payload?.operationalPaymentId == null
    ? null : String(payment.payload.operationalPaymentId);
  const storedProvider = payment?.provider == null || String(payment.provider).trim() === '' ? null : String(payment.provider).trim();
  const storedProviderReference = payment?.providerReference == null || String(payment.providerReference).trim() === ''
    ? null : String(payment.providerReference).trim();
  const matches = payment
    && String(payment.orderId) === identity.orderId
    && sameExactBranch(payment, { branchId: identity.branchId })
    && String(payment.tender || '').trim() === identity.tender
    && Number(payment.amountIrr) === identity.amountIrr
    && (storedOperationalPaymentId == null || storedOperationalPaymentId === identity.operationalPaymentId)
    && (!storedProvider || !identity.provider || storedProvider === identity.provider)
    && (!storedProviderReference || !identity.providerReference || storedProviderReference === identity.providerReference);
  if (!matches) {
    throw Object.assign(new Error('شناسهٔ پرداخت سفارش قبلاً با مبلغ، روش یا شعبهٔ دیگری ثبت شده است.'), {
      code: 'order_payment_identity_conflict', status: 409,
    });
  }
  // Optional processor metadata can arrive on a later callback. Enrich an
  // empty field, but never overwrite a known value with a different one.
  if (!storedProvider && identity.provider) payment.provider = identity.provider;
  if (!storedProviderReference && identity.providerReference) payment.providerReference = identity.providerReference;
}

function eventTenderSnapshot(event) {
  return reliableTenderSnapshot(event?.payload?.reviewedTenderSnapshot, event?.amountIrr)
    || reliableTenderSnapshot(event?.payload?.tenderSnapshot, event?.amountIrr);
}

function materializeOrderPayments(db, order, tenderRows) {
  const state = ensureFinanceV2(db);
  const branchId = branchDimension(order);
  const identities = list(tenderRows).map((row, index) => orderPaymentIdentity(order, row, index));
  const identityKeys = new Set();
  for (const identity of identities) {
    if (identityKeys.has(identity.idempotencyKey)) {
      throw Object.assign(new Error('شناسهٔ یک پرداخت بیش از یک بار در سفارش ثبت شده است.'), {
        code: 'order_payment_identity_duplicate', status: 409,
      });
    }
    identityKeys.add(identity.idempotencyKey);
  }
  return identities.map((identity, index) => {
    const row = list(tenderRows)[index];
    const { idempotencyKey } = identity;
    if (identity.operationalPaymentId != null) {
      // Cash and manual-card leg ids are allocated inside one order's
      // partialPayments list; they are not tenant-global identifiers. Provider
      // attempts and wallet ledger ids remain globally unique within their own
      // tender namespace and must not be rebound to another order.
      const orderLocalPaymentId = ['cash', 'manual_card'].includes(identity.tender);
      const operationalMatches = state.payments.filter((item) =>
        String(item?.payload?.operationalPaymentId ?? '') === identity.operationalPaymentId
        && String(item?.tender || '').trim() === identity.tender
        && (!orderLocalPaymentId || String(item?.orderId) === identity.orderId));
      if (operationalMatches.some((item) => String(item.orderId) !== identity.orderId
        || item.idempotencyKey !== idempotencyKey || !sameExactBranch(item, { branchId: identity.branchId }))) {
        throw Object.assign(new Error('شناسهٔ عملیاتی پرداخت قبلاً به سفارش یا شعبهٔ دیگری متصل شده است.'), {
          code: 'order_payment_source_identity_conflict', status: 409,
        });
      }
      if (operationalMatches.length > 1) {
        throw Object.assign(new Error('شناسهٔ عملیاتی پرداخت به چند ردیف مالی متصل است.'), {
          code: 'order_payment_source_identity_ambiguous', status: 409,
        });
      }
    }
    const existing = state.payments.filter((item) => item.idempotencyKey === idempotencyKey);
    if (existing.length > 1) {
      throw Object.assign(new Error('برای شناسهٔ پرداخت سفارش چند ردیف مالی وجود دارد.'), {
        code: 'order_payment_identity_ambiguous', status: 409,
      });
    }
    let payment = existing[0] || null;
    if (!payment) {
      payment = {
        id: id(), orderId: order.id, branchId, tender: identity.tender, amountIrr: identity.amountIrr,
        status: 'succeeded', provider: identity.provider, providerReference: identity.providerReference,
        cashSessionId: row.cashSessionId || null,
        idempotencyKey, paidAt: row.occurredAt || order.paidAt || order.createdAt,
        refundedIrr: 0, payload: { operationalPaymentId: identity.operationalPaymentId, orderNo: order.orderNo || null }, createdAt: now(),
      };
      state.payments.push(payment);
    } else assertOrderPaymentIdentity(payment, identity);
    if (['card', 'manual_card', 'card_on_file', 'online', 'gateway'].includes(payment.tender)) {
      const reconciliationItem = state.reconciliationItems.find((item) => item.kind === 'payment' && item.paymentId === payment.id);
      if (reconciliationItem) {
        if (!reconciliationItem.bankReference && payment.providerReference) reconciliationItem.bankReference = payment.providerReference;
        if (!reconciliationItem.psp && payment.provider) reconciliationItem.psp = payment.provider;
      } else state.reconciliationItems.push({
        id: id(), kind: 'payment', branchId, orderId: order.id, paymentId: payment.id, cashSessionId: row.cashSessionId || payment.cashSessionId || null,
        bankReference: payment.providerReference || null, settlementReference: null, psp: payment.provider || null,
        terminalId: null, batchNo: null, journalEntryId: null, amountIrr: payment.amountIrr,
        status: 'unmatched', matchedAt: null, matchedBy: null,
        details: { tender: payment.tender, orderNo: order.orderNo || null, occurredAt: payment.paidAt || order.paidAt || order.createdAt || null }, createdAt: now(),
      });
    }
    return payment;
  });
}

function paymentReceiptEvidence(db, order, row) {
  const state = db?.financeV2 || {};
  const paymentId = row?.paymentId == null ? null : String(row.paymentId);
  const expectedSourceId = paymentId == null ? null : `${String(order?.id)}:${paymentId}`;
  const relatedEvents = list(state.events).filter((event) => event.source === 'order.payment_received'
    && String(event.sourceId) === expectedSourceId && sameExactBranch(event, order));
  const eventId = row?.receiptEventId == null ? null : String(row.receiptEventId);
  const journalEntryId = row?.receiptJournalEntryId == null ? null : String(row.receiptJournalEntryId);
  if (!eventId && !journalEntryId) {
    if (relatedEvents.length) return { ok: false, code: 'order_payment_receipt_marker_missing' };
    return { ok: true, recorded: false };
  }
  if (!eventId || !journalEntryId || relatedEvents.length !== 1) {
    return { ok: false, code: 'order_payment_receipt_evidence_invalid' };
  }
  const event = relatedEvents[0];
  const entry = list(state.journalEntries).find((item) => String(item.id) === journalEntryId);
  const grossAmountIrr = Number(row?.grossAmountIrr ?? row?.amountIrr);
  const tender = String(row?.tender || '').trim();
  const tenderAccount = TENDER_ACCOUNTS[tender];
  if (event.id !== eventId || event.status !== 'posted' || !entry || entry.status !== 'posted'
    || event.journalEntryId !== entry.id || entry.sourceEventId !== event.id
    || entry.source !== 'order.payment_received' || String(entry.sourceId) !== expectedSourceId
    || !sameExactBranch(event, order) || !sameExactBranch(entry, order)
    || String(event.payload?.orderId) !== String(order?.id)
    || String(event.payload?.paymentId) !== paymentId
    || String(event.payload?.tender) !== tender
    || Number(event.amountIrr) !== grossAmountIrr
    || !Number.isSafeInteger(grossAmountIrr) || grossAmountIrr <= 0
    || !tenderAccount || !Array.isArray(entry.lines) || entry.lines.length !== 2) {
    return { ok: false, code: 'order_payment_receipt_evidence_invalid' };
  }
  const debit = entry.lines.find((line) => line.accountCode === tenderAccount && int(line.debitIrr) === grossAmountIrr && int(line.creditIrr) === 0);
  const credit = entry.lines.find((line) => line.accountCode === WALLET_LIABILITY_ACCOUNT && int(line.creditIrr) === grossAmountIrr && int(line.debitIrr) === 0);
  if (!debit || !credit) return { ok: false, code: 'order_payment_receipt_evidence_invalid' };
  return { ok: true, recorded: true, event, journalEntry: entry };
}

function paymentReceiptDebitLines(db, order, tenderRows, branchId, costCenter) {
  const lines = [];
  for (const row of list(tenderRows)) {
    const receipt = paymentReceiptEvidence(db, order, row);
    if (!receipt.ok) return { ok: false, code: receipt.code, message: 'مدرک پیش‌دریافت سفارش با دفتر مالی هم‌خوان نیست.' };
    const alreadyReceived = Boolean(receipt.recorded);
    lines.push({
      accountCode: alreadyReceived ? WALLET_LIABILITY_ACCOUNT : TENDER_ACCOUNTS[row.tender],
      debitIrr: row.amountIrr,
      creditIrr: 0,
      branchId,
      costCenter,
      paymentMethod: alreadyReceived ? 'customer_deposit' : row.tender,
      counterpartyId: null,
      itemId: null,
      recipeVersionId: null,
      memo: alreadyReceived
        ? `مصرف پیش‌دریافت سفارش ${order.orderNo || order.id}`
        : `دریافت سفارش ${order.orderNo || order.id}`,
    });
  }
  return { ok: true, lines };
}

function preSaleRefundOperationalLeg(db, order, payment) {
  const operationalPaymentId = payment?.payload?.operationalPaymentId == null
    ? null : String(payment.payload.operationalPaymentId);
  const leg = operationalPaymentId == null ? null : list(order?.partialPayments)
    .find((row) => String(row?.id) === operationalPaymentId);
  if (!leg) {
    throw Object.assign(new Error('پرداخت پیش از فروش به ردیف دریافت عملیاتی سفارش متصل نیست.'), {
      code: 'refund_order_payment_link_missing', status: 409,
    });
  }
  const normalized = normalizeTenderRows({ ...order, partialPayments: [leg] })[0];
  const evidence = normalized && paymentReceiptEvidence(db, order, normalized);
  if (!normalized || !evidence?.ok || !evidence.recorded
    || !payment.receiptFinanceEventId || payment.receiptFinanceEventId !== evidence.event.id
    || payment.receiptJournalEntryId !== evidence.journalEntry.id
    || normalized.tender !== String(payment.tender || '').trim()
    || normalized.grossAmountIrr !== int(payment.amountIrr)) {
    throw Object.assign(new Error('برای برگشت پیش‌فروش، رسید و ردیف عملیاتی باید دقیقاً با سند پیش‌دریافت تطبیق داشته باشند.'), {
      code: evidence?.code || 'refund_order_payment_receipt_missing', status: 409,
    });
  }
  return leg;
}

function linkOrderPaymentsToSaleEvent(payments, event, journalEntry = null) {
  for (const payment of list(payments)) {
    payment.financeEventId = event?.id || null;
    payment.financeEventVersion = event?.sourceVersion || null;
    payment.journalEntryId = journalEntry?.id || null;
    payment.saleFinanceEventId = event?.id || null;
    payment.saleJournalEntryId = journalEntry?.id || null;
    payment.payload = {
      ...(payment.payload || {}),
      financeEventId: event?.id || null,
      financeEventVersion: event?.sourceVersion || null,
      journalEntryId: journalEntry?.id || null,
      saleFinanceEventId: event?.id || null,
      saleJournalEntryId: journalEntry?.id || null,
      source: event?.source || 'order.paid',
    };
  }
  return payments;
}

function orderPaymentsMatch(state, orderId, branchId, tenderRows) {
  const expected = list(tenderRows).map((row, index) => orderPaymentIdentity(
    { id: orderId, branchId }, row, index,
  ));
  const actual = list(state.payments).filter((payment) => String(payment.orderId) === String(orderId)
    && sameBranch(payment, branchId) && ['succeeded', 'refunded'].includes(payment.status)
    && int(payment.amountIrr) > int(payment.refundedIrr));
  if (expected.length !== actual.length) return false;

  const actualByKey = new Map();
  for (const payment of actual) {
    if (!payment.idempotencyKey || actualByKey.has(payment.idempotencyKey)) return false;
    actualByKey.set(payment.idempotencyKey, payment);
  }
  return expected.every((identity) => {
    const payment = actualByKey.get(identity.idempotencyKey);
    if (!payment || String(payment.orderId) !== identity.orderId
      || !sameExactBranch(payment, { branchId: identity.branchId })
      || String(payment.tender || '').trim() !== identity.tender
      || Number(payment.amountIrr) !== identity.amountIrr) return false;
    const operationalPaymentId = payment?.payload?.operationalPaymentId == null
      ? null : String(payment.payload.operationalPaymentId);
    const provider = payment?.provider == null || String(payment.provider).trim() === ''
      ? null : String(payment.provider).trim();
    const providerReference = payment?.providerReference == null || String(payment.providerReference).trim() === ''
      ? null : String(payment.providerReference).trim();
    return (operationalPaymentId == null || operationalPaymentId === identity.operationalPaymentId)
      && (!provider || !identity.provider || provider === identity.provider)
      && (!providerReference || !identity.providerReference || providerReference === identity.providerReference);
  });
}

function repairPostedOrderEventPayments(db, event) {
  if (event?.source !== 'order.paid') return [];
  const state = ensureFinanceV2(db);
  const order = list(db.orders).find((item) => String(item.id) === String(event.sourceId) && sameBranch(item, event.branchId));
  const tenders = eventTenderSnapshot(event);
  if (!order || !tenders) return [];
  const existing = list(state.payments).filter((payment) => String(payment.orderId) === String(order.id) && sameBranch(payment, event.branchId));
  // A partial or contradictory payment set requires an explicit accountant
  // investigation; never add rows that could hide an existing discrepancy.
  if (existing.length && !orderPaymentsMatch(state, order.id, event.branchId, tenders)) return [];
  return materializeOrderPayments(db, order, tenders);
}

function salesLines(order, db = null) {
  let totalIrr;
  try {
    totalIrr = strictLegacyTomanIrr(order.total, 'order_total_invalid');
  } catch (error) {
    return { ok: false, code: error.code, message: 'مبلغ قطعی سفارش باید تومان صحیح و در محدودهٔ امن باشد.' };
  }
  const tenders = normalizeTenderRows(order);
  if (!tenders.length) return { ok: false, code: 'payment_tender_missing', message: 'روش پرداخت قابل اتکا ثبت نشده است.' };
  const validTenderAmounts = tenders.every((row) => {
    const amountIrr = Number(row?.amountIrr);
    const grossAmountIrr = Number(row?.grossAmountIrr ?? row?.amountIrr);
    const refundedAmountIrr = Number(row?.refundedAmountIrr ?? 0);
    return TENDER_ACCOUNTS[row?.tender]
      && Number.isSafeInteger(amountIrr) && amountIrr > 0
      && Number.isSafeInteger(grossAmountIrr) && grossAmountIrr >= amountIrr
      && Number.isSafeInteger(refundedAmountIrr) && refundedAmountIrr >= 0
      && grossAmountIrr - amountIrr === refundedAmountIrr;
  });
  if (!validTenderAmounts) return { ok: false, code: 'payment_tender_invalid', message: 'مبلغ یا روش یکی از پرداخت‌های سفارش معتبر نیست.' };
  const receivedIrr = tenders.reduce((sum, row) => sum + row.amountIrr, 0);
  if (!Number.isSafeInteger(receivedIrr) || receivedIrr !== totalIrr) {
    return { ok: false, code: 'payment_total_mismatch', message: 'جمع پرداخت‌ها با مبلغ قطعی سفارش برابر نیست.', details: { totalIrr, receivedIrr } };
  }
  const branchId = Number(order.branchId) || null;
  if (!branchId) return { ok: false, code: 'branch_missing', message: 'شعبهٔ سفارش مشخص نیست.' };
  const costCenter = `branch:${branchId}`;
  const paymentDebits = paymentReceiptDebitLines(db, order, tenders, branchId, costCenter);
  if (!paymentDebits.ok) return paymentDebits;
  const debitLines = paymentDebits.lines;
  const taxIrr = orderTaxAmountIrr(order);
  if (taxIrr > totalIrr) return { ok: false, code: 'tax_total_invalid', message: 'مالیات ذخیره‌شده از مبلغ سفارش بیشتر است.' };
  const salesIrr = totalIrr - taxIrr;
  const salesAccount = order.fulfillment === 'pickup' ? '4120' : order.fulfillment === 'delivery' ? '4130' : '4110';
  const creditLines = [{
    accountCode: salesAccount,
    debitIrr: 0,
    creditIrr: salesIrr,
    branchId,
    costCenter,
    paymentMethod: null,
    counterpartyId: null,
    itemId: null,
    recipeVersionId: null,
    memo: `فروش سفارش ${order.orderNo || order.id}`,
  }];
  if (taxIrr) creditLines.push({
    accountCode: '2210', debitIrr: 0, creditIrr: taxIrr, branchId, costCenter,
    paymentMethod: null, counterpartyId: null, itemId: null, recipeVersionId: null,
    memo: `مالیات ذخیره‌شده سفارش ${order.orderNo || order.id}`,
  });
  return { ok: true, totalIrr, tenders, lines: [...debitLines, ...creditLines], taxSource: taxIrr ? 'order_snapshot' : 'not_recorded' };
}

function assertBalanced(lines, accountCodes = null) {
  const normalized = list(lines).map((line, index) => ({
    ...line,
    debitIrr: safeIrr(line.debitIrr, `journal_line_${index + 1}_debit_invalid`),
    creditIrr: safeIrr(line.creditIrr, `journal_line_${index + 1}_credit_invalid`),
  }));
  const debitIrr = normalized.reduce((sum, line) => sum + line.debitIrr, 0);
  const creditIrr = normalized.reduce((sum, line) => sum + line.creditIrr, 0);
  if (!Number.isSafeInteger(debitIrr) || !Number.isSafeInteger(creditIrr)) {
    throw Object.assign(new Error('جمع سند از محدودهٔ امن ریال خارج است.'), { code: 'journal_total_unsafe' });
  }
  if (debitIrr <= 0 || debitIrr !== creditIrr) {
    const error = new Error('سند دوبل تراز نیست.');
    error.code = 'journal_unbalanced';
    error.details = { debitIrr, creditIrr };
    throw error;
  }
  for (const [index, line] of normalized.entries()) {
    if (!line.accountCode) throw Object.assign(new Error(`کد حساب ردیف ${index + 1} الزامی است.`), { code: 'account_missing' });
    if (accountCodes && !accountCodes.has(String(line.accountCode).trim())) {
      throw Object.assign(new Error(`کد حساب ${line.accountCode} در طرح حساب‌ها (COA) تعریف نشده است.`), { code: 'account_unknown', details: { line: index + 1, accountCode: line.accountCode } });
    }
    if (!((int(line.debitIrr) > 0 && int(line.creditIrr) === 0) || (int(line.creditIrr) > 0 && int(line.debitIrr) === 0))) {
      throw Object.assign(new Error(`مبلغ ردیف ${index + 1} معتبر نیست.`), { code: 'journal_line_invalid' });
    }
    if (!line.branchId || (PNL_TYPES.has(line.accountType) && !line.costCenter)) {
      throw Object.assign(new Error(`شعبه و مرکز هزینهٔ ردیف ${index + 1} الزامی است.`), { code: 'journal_dimension_missing' });
    }
  }
  return { debitIrr, creditIrr };
}

function recordEvent(db, input) {
  const state = ensureFinanceV2(db);
  const source = String(input.source || '').trim();
  const sourceId = String(input.sourceId || '').trim();
  const sourceContract = financeContracts.eventSourceContract(source);
  const sourceVersion = input.sourceVersion == null ? 1 : Number(input.sourceVersion);
  if (!Number.isSafeInteger(sourceVersion) || sourceVersion < 1) {
    throw Object.assign(new Error('نسخهٔ رویداد مالی باید عدد صحیح مثبت و امن باشد.'), { code: 'finance_event_version_invalid' });
  }
  const branchId = branchDimension(input);
  const idempotencyKey = String(input.idempotencyKey || `${branchId || 'unscoped'}:${source}:${sourceId}:v${sourceVersion}`).trim();
  if (!source || !sourceId) throw Object.assign(new Error('منبع و شناسهٔ رویداد الزامی است.'), { code: 'finance_event_source_missing' });
  const keyMatch = state.events.find((event) => event.idempotencyKey === idempotencyKey);
  if (keyMatch) {
    if (keyMatch.source !== source || keyMatch.sourceId !== sourceId || keyMatch.sourceVersion !== sourceVersion) {
      throw Object.assign(new Error('کلید تکرارنشدنی رویداد مالی قبلاً برای منبع دیگری مصرف شده است.'), { code: 'finance_event_idempotency_conflict' });
    }
    if (!sameExactBranch(keyMatch, { branchId })) {
      throw Object.assign(new Error('رویداد مالی با همین کلید در شعبهٔ دیگری ثبت شده است.'), { code: 'finance_event_source_branch_conflict', status: 409 });
    }
  }
  const sourceMatch = state.events.find((event) => event.source === source && event.sourceId === sourceId && event.sourceVersion === sourceVersion);
  if (sourceMatch) {
    if (!sameExactBranch(sourceMatch, { branchId })) {
      throw Object.assign(new Error('رویداد مالی با همین منبع و نسخه در شعبهٔ دیگری ثبت شده است.'), { code: 'finance_event_source_branch_conflict', status: 409 });
    }
  }
  const replay = keyMatch || sourceMatch;
  // When occurredAt was implicit on the original write, use the persisted
  // timestamp for a retry; generating a fresh `now()` would make an otherwise
  // identical replay conflict. Explicitly changed timestamps remain part of
  // the event's immutable payload and are rejected below.
  const occurredAt = input.occurredAt || replay?.occurredAt || now();
  const amountIrr = safeIrr(input.amountIrr == null ? 0 : input.amountIrr, 'finance_event_amount_invalid');
  const payload = input.payload && typeof input.payload === 'object' ? input.payload : {};
  const payloadFingerprint = financeEventPayloadFingerprint({
    source, sourceId, sourceVersion, branchId, occurredAt, amountIrr, payload,
  });
  if (replay) {
    const originalFingerprint = replay.payloadFingerprint || financeEventPayloadFingerprint(replay);
    if (originalFingerprint !== payloadFingerprint) {
      throw Object.assign(new Error('هویت این رویداد مالی قبلاً با مبلغ یا جزئیات دیگری ثبت شده است.'), {
        code: 'finance_event_payload_conflict', status: 409,
      });
    }
    return { event: replay, idempotentReplay: true };
  }
  const event = {
    id: id('fev'), source, sourceId, sourceVersion, idempotencyKey,
    payloadFingerprint,
    eventContractVersion: financeContracts.EVENT_CONTRACT_VERSION,
    entityType: sourceContract.entityType,
    eventType: sourceContract.eventType,
    sourceRegistered: sourceContract.registered !== false,
    sourceRef: { type: source, id: sourceId, version: sourceVersion, branchId },
    branchId,
    occurredAt,
    amountIrr,
    payload,
    status: input.status || 'pending',
    error: input.error || null,
    journalEntryId: null,
    createdAt: now(), processedAt: null,
  };
  state.events.push(event);
  state.idempotency[idempotencyKey] = { kind: 'finance_event', id: event.id, at: event.createdAt };
  return { event, idempotentReplay: false };
}

function postEventJournal(db, event, lines, description, actor) {
  const state = ensureFinanceV2(db);
  const eventBranchId = branchDimension(event);
  if (list(lines).some((line) => branchDimension(line) !== eventBranchId)) {
    throw Object.assign(new Error('شعبهٔ هر ردیف سند باید با شعبهٔ رویداد مالی یکسان باشد.'), {
      code: 'journal_line_branch_mismatch', status: 409,
    });
  }
  if (event.journalEntryId) return state.journalEntries.find((entry) => entry.id === event.journalEntryId) || null;
  const periodCheck = validateOpenPeriod(db, event.occurredAt, event.branchId);
  if (!periodCheck.ok) {
    event.status = 'blocked';
    event.error = { code: periodCheck.code, message: periodCheck.message };
    return null;
  }
  const totals = assertBalanced(lines, accountCodesForDb(db));
  const duplicate = state.journalEntries.find((entry) => sameExactBranch(entry, event)
    && entry.sourceEventId === event.id && FINAL_ENTRY_STATUSES.has(entry.status));
  const conflicting = state.journalEntries.find((entry) => !sameExactBranch(entry, event)
    && (entry.sourceEventId === event.id || (entry.source === event.source && entry.sourceId === event.sourceId && FINAL_ENTRY_STATUSES.has(entry.status))));
  if (conflicting) {
    throw Object.assign(new Error('سند مالی با همین منبع در شعبهٔ دیگری وجود دارد.'), { code: 'finance_journal_source_branch_conflict' });
  }
  const priorSourceEntry = state.journalEntries.find((entry) => sameExactBranch(entry, event)
    && entry.source === event.source && entry.sourceId === event.sourceId
    && FINAL_ENTRY_STATUSES.has(entry.status) && entry.sourceEventId !== event.id);
  if (priorSourceEntry) {
    const priorEvent = list(state.events).find((item) => item.id === priorSourceEntry.sourceEventId);
    throw Object.assign(new Error('برای این منبع قبلاً سند قطعی وجود دارد؛ نسخهٔ جدید رویداد نمی‌تواند به سند قبلی متصل شود.'), {
      code: 'finance_journal_source_version_conflict', status: 409,
      details: {
        source: event.source,
        sourceId: event.sourceId,
        postedEventVersion: priorEvent?.sourceVersion ?? null,
        requestedEventVersion: event.sourceVersion ?? null,
        journalEntryId: priorSourceEntry.id,
      },
    });
  }
  if (duplicate) {
    event.journalEntryId = duplicate.id;
    event.status = 'posted';
    return duplicate;
  }
  const entry = {
    id: id('fje'), number: `F2-${String(state.journalEntries.length + 1).padStart(6, '0')}`,
    periodId: periodCheck.period.id, sourceEventId: event.id, source: event.source, sourceId: event.sourceId,
    date: event.occurredAt, description: String(description || '').slice(0, 280), status: 'posted',
    debitIrr: totals.debitIrr, creditIrr: totals.creditIrr,
    branchId: event.branchId, reversalOfId: null, reversedById: null,
    lines: list(lines).map((line, index) => ({ id: id('fjl'), lineNo: index + 1, ...line, debitIrr: int(line.debitIrr), creditIrr: int(line.creditIrr) })),
    createdAt: now(), createdBy: actor || 'system', postedAt: now(), postedBy: actor || 'system',
  };
  state.journalEntries.push(entry);
  event.status = 'posted'; event.error = null; event.journalEntryId = entry.id; event.processedAt = now();
  return entry;
}

/**
 * Record a wallet deposit as an official Finance V2 event and posted journal.
 * Wallet credit is a customer-deposit liability; the cash/card/PSP side is
 * the asset received. Promotional credit is recognised explicitly as a
 * marketing expense so it cannot be mistaken for revenue.
 */
function recordWalletTopup(db, {
  branchId,
  amountToman,
  bonusToman = 0,
  paymentMethod = 'online_gateway',
  reference,
  actor = 'system',
  occurredAt,
  idempotencyKey,
} = {}) {
  const branch = branchDimension({ branchId });
  if (!branch) throw Object.assign(new Error('شعبهٔ شارژ کیف پول الزامی است.'), { code: 'wallet_topup_branch_required', status: 400 });
  const amount = Math.round(Number(amountToman));
  const bonus = Math.round(Number(bonusToman) || 0);
  if (!Number.isSafeInteger(amount) || amount <= 0) throw Object.assign(new Error('مبلغ شارژ کیف پول معتبر نیست.'), { code: 'wallet_topup_amount_invalid', status: 400 });
  if (!Number.isSafeInteger(bonus) || bonus < 0) throw Object.assign(new Error('مبلغ هدیهٔ کیف پول معتبر نیست.'), { code: 'wallet_topup_bonus_invalid', status: 400 });
  const paymentAccount = WALLET_TOPUP_PAYMENT_ACCOUNTS[String(paymentMethod || '').toLowerCase()];
  if (!paymentAccount) throw Object.assign(new Error('روش دریافت وجه شارژ کیف پول پشتیبانی نمی‌شود.'), { code: 'wallet_topup_payment_method_invalid', status: 400 });
  const sourceId = String(reference || '').trim();
  if (!sourceId) throw Object.assign(new Error('مرجع شارژ کیف پول الزامی است.'), { code: 'wallet_topup_reference_required', status: 400 });
  const totalIrr = (amount + bonus) * 10;
  const lines = [
    { accountCode: paymentAccount, debitIrr: amount * 10, creditIrr: 0, branchId: branch, paymentMethod, memo: `دریافت شارژ کیف پول ${sourceId}` },
    { accountCode: WALLET_LIABILITY_ACCOUNT, debitIrr: 0, creditIrr: totalIrr, branchId: branch, paymentMethod: 'customer_wallet', memo: `تعهد کیف پول مشتری ${sourceId}` },
  ];
  if (bonus > 0) lines.splice(1, 0, {
    accountCode: WALLET_BONUS_EXPENSE_ACCOUNT, debitIrr: bonus * 10, creditIrr: 0,
    branchId: branch, costCenter: 'marketing', paymentMethod: 'wallet_bonus', memo: `هدیهٔ تبلیغاتی شارژ کیف پول ${sourceId}`,
  });
  const recorded = recordEvent(db, {
    source: 'wallet.topup', sourceId, sourceVersion: 1,
    idempotencyKey: idempotencyKey || `wallet-topup:${branch}:${sourceId}`,
    branchId: branch, occurredAt: occurredAt || now(), amountIrr: totalIrr,
    payload: { amountToman: amount, bonusToman: bonus, paymentMethod, reference: sourceId },
  });
  const journalEntry = postEventJournal(db, recorded.event, lines, `شارژ کیف پول مشتری ${sourceId}`, actor);
  if (!journalEntry || journalEntry.status !== 'posted') {
    throw Object.assign(new Error('شارژ کیف پول تا ثبت سند مالی قابل تکمیل نیست.'), {
      code: recorded.event.error?.code || 'wallet_topup_finance_blocked', status: 409,
      details: recorded.event.error || null,
    });
  }
  return { event: recorded.event, journalEntry, idempotentReplay: recorded.idempotentReplay };
}

function capturePaidOrder(db, order, { actor = 'system', idempotencyKey } = {}) {
  if (paid(order)) ensureFinanceV2(db);
  return withFinanceAtomicity(db, () => capturePaidOrderAtomic(db, order, { actor, idempotencyKey }), {
    keys: ['events', 'payments', 'reconciliationItems', 'journalEntries', 'orderItemCostSnapshots', 'inventoryMovements', 'idempotency'],
  });
}

function captureOrderPaymentReceipt(db, order, operationalPayment, {
  actor = 'system', cashSessionId = null,
} = {}) {
  const branchId = branchDimension(order);
  if (order?.id == null || !branchId) {
    throw Object.assign(new Error('سفارش و شعبه برای ثبت پیش‌دریافت معتبر نیست.'), { code: 'order_payment_receipt_source_invalid', status: 409 });
  }
  const paymentId = operationalPayment?.id == null ? '' : String(operationalPayment.id).trim();
  if (!paymentId) throw Object.assign(new Error('شناسهٔ پرداخت عملیاتی برای ثبت مالی الزامی است.'), { code: 'order_payment_receipt_identity_missing', status: 409 });
  const tender = String(operationalPayment?.tender || '').trim();
  if (!['cash', 'manual_card', 'online'].includes(tender)) {
    throw Object.assign(new Error('روش دریافت برای ثبت پیش‌دریافت Finance V2 معتبر نیست.'), { code: 'order_payment_receipt_tender_invalid', status: 409 });
  }
  if (tender === 'manual_card' && !String(operationalPayment.reference || operationalPayment.providerReference || '').trim()) {
    throw Object.assign(new Error('مرجع رسید کارت‌خوان برای ثبت مالی الزامی است.'), { code: 'order_payment_receipt_reference_required', status: 409 });
  }
  let amountIrr;
  try { amountIrr = strictLegacyTomanIrr(operationalPayment.amount, 'order_payment_amount_invalid'); }
  catch (error) { throw Object.assign(error, { code: 'order_payment_amount_invalid', status: 409 }); }
  if (amountIrr <= 0) throw Object.assign(new Error('مبلغ دریافت‌شده باید بزرگ‌تر از صفر باشد.'), { code: 'order_payment_amount_invalid', status: 409 });
  const occurredAt = operationalPayment.at || order.paidAt || order.createdAt || now();
  if (!valueContracts.parseTimestamp(occurredAt)) {
    throw Object.assign(new Error('زمان دریافت وجه معتبر نیست.'), { code: 'order_payment_receipt_timestamp_invalid', status: 409 });
  }
  const resolvedCashSessionId = tender === 'cash'
    ? (cashSessionId || operationalPayment.cashSessionId || null)
    : null;
  const sourceId = `${String(order.id)}:${paymentId}`;

  return withFinanceAtomicity(db, () => {
    const state = ensureFinanceV2(db);
    if (state.rollout.captureEnabled === false
      || (state.rollout.enabledBranchIds.length && !state.rollout.enabledBranchIds.map(Number).includes(branchId))) {
      throw Object.assign(new Error('ثبت پیش‌دریافت تا فعال‌شدن Finance V2 برای این شعبه مجاز نیست.'), {
        code: 'finance_v2_feature_flag_disabled', status: 409,
      });
    }
    const recorded = recordEvent(db, {
      source: 'order.payment_received', sourceId, sourceVersion: 1,
      idempotencyKey: `order:${order.id}:payment:${paymentId}:receipt:v1`,
      branchId, occurredAt, amountIrr,
      payload: {
        orderId: String(order.id), orderNo: order.orderNo || null,
        paymentId, tender, cashSessionId: resolvedCashSessionId,
        providerReference: operationalPayment.reference || operationalPayment.providerReference || null,
      },
    });
    const event = recorded.event;
    const tenderLabel = tender === 'cash' ? 'نقدی' : tender === 'online' ? 'درگاه آنلاین' : 'کارت‌خوان';
    const lines = [
      { accountCode: TENDER_ACCOUNTS[tender], debitIrr: amountIrr, creditIrr: 0, branchId, costCenter: `branch:${branchId}`, paymentMethod: tender, memo: `دریافت ${tenderLabel} سفارش ${order.orderNo || order.id}` },
      { accountCode: WALLET_LIABILITY_ACCOUNT, debitIrr: 0, creditIrr: amountIrr, branchId, costCenter: `branch:${branchId}`, paymentMethod: 'customer_deposit', memo: `پیش‌دریافت سفارش ${order.orderNo || order.id}` },
    ];
    const journalEntry = postEventJournal(db, event, lines, `دریافت قسط سفارش ${order.orderNo || order.id}`, actor);
    if (!journalEntry || journalEntry.status !== 'posted') {
      throw Object.assign(new Error('دریافت وجه تا ثبت سند پیش‌دریافت در دفتر مالی قابل تکمیل نیست.'), {
        code: event.error?.code || 'order_payment_receipt_finance_blocked', status: 409,
        details: event.error || null,
      });
    }
    const tenderRow = {
      tender, amountIrr, grossAmountIrr: amountIrr, paymentId,
      provider: operationalPayment.provider || null,
      occurredAt, providerReference: operationalPayment.reference || operationalPayment.providerReference || null,
      cashSessionId: resolvedCashSessionId,
    };
    const [financePayment] = materializeOrderPayments(db, order, [tenderRow]);
    const receiptRow = {
      ...tenderRow, receiptEventId: event.id, receiptJournalEntryId: journalEntry.id,
    };
    const evidence = paymentReceiptEvidence(db, order, receiptRow);
    if (!evidence.ok || !evidence.recorded) {
      throw Object.assign(new Error('زنجیرهٔ رویداد و سند پیش‌دریافت پس از ثبت قابل تأیید نیست.'), {
        code: evidence.code || 'order_payment_receipt_evidence_invalid', status: 409,
      });
    }
    if ((operationalPayment.financeReceiptEventId && operationalPayment.financeReceiptEventId !== event.id)
      || (operationalPayment.financeReceiptJournalEntryId && operationalPayment.financeReceiptJournalEntryId !== journalEntry.id)) {
      throw Object.assign(new Error('شناسهٔ رسید مالی پرداخت با رویداد ثبت‌شده هم‌خوان نیست.'), { code: 'order_payment_receipt_identity_conflict', status: 409 });
    }
    operationalPayment.cashSessionId = resolvedCashSessionId;
    operationalPayment.financeReceiptEventId = event.id;
    operationalPayment.financeReceiptJournalEntryId = journalEntry.id;
    operationalPayment.financePaymentId = financePayment.id;
    financePayment.financeEventId = event.id;
    financePayment.financeEventVersion = event.sourceVersion;
    financePayment.journalEntryId = journalEntry.id;
    financePayment.receiptFinanceEventId = event.id;
    financePayment.receiptJournalEntryId = journalEntry.id;
    financePayment.payload = {
      ...(financePayment.payload || {}),
      financeEventId: event.id,
      financeEventVersion: event.sourceVersion,
      journalEntryId: journalEntry.id,
      source: event.source,
      receiptFinanceEventId: event.id,
      receiptJournalEntryId: journalEntry.id,
      cashSessionId: resolvedCashSessionId,
    };
    const reconciliationItem = state.reconciliationItems.find((item) => item.kind === 'payment' && item.paymentId === financePayment.id);
    if (reconciliationItem) {
      reconciliationItem.journalEntryId = journalEntry.id;
      reconciliationItem.cashSessionId = resolvedCashSessionId;
    }
    return { event, journalEntry, payment: financePayment, idempotentReplay: recorded.idempotentReplay };
  }, {
    keys: ['events', 'payments', 'reconciliationItems', 'journalEntries', 'idempotency'],
    objects: [operationalPayment],
  });
}

/**
 * Record a customer-wallet top-up as a Finance V2 event and posted journal,
 * then apply the wallet credit as one atomic user-visible operation.
 *
 * A top-up is not a sale: actual cash/PSP consideration is debited, the
 * customer-deposit liability (2500) is credited, and any promotional bonus is
 * debited to the explicit marketing account (6400) while also increasing the
 * same liability.  The callback is intentionally supplied by the HTTP layer
 * so Finance V2 does not own customer-wallet storage.  It is called only after
 * an open-period journal has been posted; blocked events never credit a wallet.
 */
function captureWalletTopup(db, input = {}, { actor = 'system', idempotencyKey, applyWallet } = {}) {
  const state = ensureFinanceV2(db);
  const branchId = branchDimension(input);
  if (!branchId) throw Object.assign(new Error('شعبهٔ شارژ کیف پول الزامی است.'), { code: 'wallet_topup_branch_required', status: 400 });
  const sourceId = String(input.sourceId || input.requestId || '').trim();
  if (!sourceId) throw Object.assign(new Error('شناسهٔ درخواست شارژ کیف پول الزامی است.'), { code: 'wallet_topup_source_required', status: 400 });
  const amountToman = Math.max(0, Math.round(Number(input.amountToman) || 0));
  const bonusToman = Math.max(0, Math.round(Number(input.bonusToman) || 0));
  if (!amountToman) throw Object.assign(new Error('مبلغ شارژ کیف پول معتبر نیست.'), { code: 'wallet_topup_amount_invalid', status: 400 });
  if (bonusToman > amountToman * 2) {
    throw Object.assign(new Error('مبلغ هدیهٔ کیف پول خارج از سیاست مجاز است.'), { code: 'wallet_topup_bonus_invalid', status: 400 });
  }
  const method = String(input.paymentMethod || input.paymentTender || '').trim().toLowerCase();
  const debitAccountCode = WALLET_TOPUP_PAYMENT_ACCOUNTS[method];
  if (!debitAccountCode) {
    throw Object.assign(new Error('روش دریافت وجه شارژ کیف پول معتبر نیست.'), { code: 'wallet_topup_payment_method_invalid', status: 400 });
  }
  const amountIrr = safeIrr(irrFromLegacyToman(amountToman), 'wallet_topup_amount_invalid');
  const bonusIrr = safeIrr(irrFromLegacyToman(bonusToman), 'wallet_topup_bonus_invalid');
  const totalIrr = safeIrr(amountIrr + bonusIrr, 'wallet_topup_total_invalid');
  const occurredAt = input.occurredAt || now();
  const key = String(idempotencyKey || `wallet:${branchId}:${sourceId}:topup:v1`).trim();
  if (!key) throw Object.assign(new Error('کلید تکرارنشدنی شارژ کیف پول الزامی است.'), { code: 'wallet_topup_idempotency_required', status: 400 });
  const costCenter = `branch:${branchId}`;
  const lines = [
    {
      accountCode: debitAccountCode, debitIrr: amountIrr, creditIrr: 0,
      branchId, costCenter, paymentMethod: method,
      counterpartyId: String(input.phone || '').trim() || null,
      itemId: null, recipeVersionId: null,
      memo: `دریافت شارژ کیف پول مشتری ${String(input.reference || sourceId).slice(0, 80)}`,
    },
  ];
  if (bonusIrr > 0) lines.push({
    accountCode: WALLET_BONUS_EXPENSE_ACCOUNT, debitIrr: bonusIrr, creditIrr: 0,
    branchId, costCenter, paymentMethod: null,
    counterpartyId: String(input.phone || '').trim() || null,
    itemId: null, recipeVersionId: null,
    memo: `هزینهٔ اعتبار هدیهٔ شارژ کیف پول (${String(input.packageId || 'tier').slice(0, 60)})`,
  });
  lines.push({
    accountCode: WALLET_LIABILITY_ACCOUNT, debitIrr: 0, creditIrr: totalIrr,
    branchId, costCenter, paymentMethod: null,
    counterpartyId: String(input.phone || '').trim() || null,
    itemId: null, recipeVersionId: null,
    memo: `افزایش تعهد کیف پول مشتری ${String(input.phone || '').slice(0, 40)}`,
  });

  // Include the arrays mutated by the callback in the rollback boundary.  A
  // journal that cannot be posted, or a durable wallet mutation failure, must
  // leave both projections unchanged.
  db.users = Array.isArray(db.users) ? db.users : [];
  db.walletLedger = Array.isArray(db.walletLedger) ? db.walletLedger : [];
  return withFinanceAtomicity(db, () => {
    const recorded = recordEvent(db, {
      source: 'wallet.topup', sourceId, sourceVersion: 1, idempotencyKey: key,
      branchId, occurredAt, amountIrr: totalIrr,
      payload: {
        phone: String(input.phone || '').trim() || null,
        amountToman, bonusToman, amountIrr, bonusIrr, totalIrr,
        paymentMethod: method, paymentAccountCode: debitAccountCode,
        walletLiabilityAccountCode: WALLET_LIABILITY_ACCOUNT,
        bonusExpenseAccountCode: bonusIrr > 0 ? WALLET_BONUS_EXPENSE_ACCOUNT : null,
        reference: input.reference || null, packageId: input.packageId || null,
        policy: 'cash_or_psp_debit_plus_marketing_bonus_to_customer_deposit_liability',
      },
      status: 'pending', error: null,
    });
    const event = recorded.event;
    const existingJournal = event.journalEntryId
      ? state.journalEntries.find((entry) => entry.id === event.journalEntryId) || null
      : null;
    let journalEntry = existingJournal;
    if (!journalEntry) journalEntry = postEventJournal(db, event, lines, `شارژ کیف پول مشتری ${String(input.phone || sourceId).slice(0, 60)}`, actor);
    if (!journalEntry || journalEntry.status !== 'posted') {
      return { event, journalEntry: null, walletResult: null, idempotentReplay: recorded.idempotentReplay, blocked: true };
    }

    // A retry after a successful persisted application must never double-credit
    // the customer.  The wallet callback receives the event identity and is
    // expected to put it in its ledger metadata.
    const alreadyApplied = event.payload?.walletAppliedAt
      || db.walletLedger.some((row) => row?.meta?.financeEventId === event.id);
    let walletResult = null;
    if (!alreadyApplied && typeof applyWallet === 'function') {
      walletResult = applyWallet({ event, journalEntry });
      event.payload = {
        ...event.payload,
        walletAppliedAt: now(),
        walletLedgerIds: [walletResult?.topupEntry?.id, walletResult?.bonusEntry?.id].filter(Boolean),
      };
    }
    return { event, journalEntry, walletResult, idempotentReplay: recorded.idempotentReplay, blocked: false };
  }, {
    keys: ['events', 'payments', 'reconciliationItems', 'journalEntries', 'idempotency'],
    objects: [db.users, db.walletLedger],
  });
}

/**
 * Post a controlled manual wallet correction and apply it to the customer
 * projection atomically. A positive correction is treated as an explicit
 * promotion/adjustment expense (6400) against the customer-deposit liability
 * (2500); a negative correction reverses that same effect. The HTTP layer is
 * required to provide an Idempotency-Key so a retry cannot mint a second
 * correction.
 */
function captureWalletAdjustment(db, input = {}, { actor = 'system', idempotencyKey, applyWallet } = {}) {
  const state = ensureFinanceV2(db);
  const branchId = branchDimension(input);
  if (!branchId) throw Object.assign(new Error('شعبهٔ تعدیل کیف پول الزامی است.'), { code: 'wallet_adjust_branch_required', status: 400 });
  const sourceId = String(input.sourceId || input.reference || '').trim();
  if (!sourceId) throw Object.assign(new Error('مرجع تعدیل کیف پول الزامی است.'), { code: 'wallet_adjust_source_required', status: 400 });
  const phone = String(input.phone || '').trim();
  if (!phone) throw Object.assign(new Error('شماره مشتری برای تعدیل کیف پول الزامی است.'), { code: 'wallet_adjust_phone_required', status: 400 });
  const user = list(db.users).find((item) => String(item?.phone || '').trim() === phone);
  if (!user) throw Object.assign(new Error('کاربر کیف پول یافت نشد.'), { code: 'wallet_adjust_user_not_found', status: 404 });
  const deltaToman = Math.round(Number(input.deltaToman));
  if (!Number.isSafeInteger(deltaToman) || deltaToman === 0) {
    throw Object.assign(new Error('مبلغ تعدیل کیف پول معتبر نیست.'), { code: 'wallet_adjust_amount_invalid', status: 400 });
  }
  const currentBalance = Math.max(0, Math.round(Number(user.walletBalanceToman ?? user.walletBalance) || 0));
  if (currentBalance + deltaToman < 0) {
    throw Object.assign(new Error('کاهش تعدیل از موجودی کیف پول بیشتر است.'), { code: 'wallet_adjust_insufficient_balance', status: 409, details: { currentBalance, requestedDelta: deltaToman } });
  }
  const key = String(idempotencyKey || '').trim();
  if (!key) throw Object.assign(new Error('کلید تکرارنشدنی تعدیل کیف پول الزامی است.'), { code: 'wallet_adjust_idempotency_required', status: 400 });
  const amountIrr = safeIrr(Math.abs(deltaToman) * 10, 'wallet_adjust_amount_invalid');
  const costCenter = `branch:${branchId}`;
  const positive = deltaToman > 0;
  const lines = positive
    ? [
      { accountCode: WALLET_BONUS_EXPENSE_ACCOUNT, accountType: 'expense', debitIrr: amountIrr, creditIrr: 0, branchId, costCenter, paymentMethod: 'wallet_adjustment', counterpartyId: phone, memo: `افزایش دستی تعهد کیف پول ${phone}` },
      { accountCode: WALLET_LIABILITY_ACCOUNT, accountType: 'liability', debitIrr: 0, creditIrr: amountIrr, branchId, costCenter, paymentMethod: 'customer_wallet', counterpartyId: phone, memo: `افزایش تعهد کیف پول ${phone}` },
    ]
    : [
      { accountCode: WALLET_LIABILITY_ACCOUNT, accountType: 'liability', debitIrr: amountIrr, creditIrr: 0, branchId, costCenter, paymentMethod: 'customer_wallet', counterpartyId: phone, memo: `کاهش تعهد کیف پول ${phone}` },
      { accountCode: WALLET_BONUS_EXPENSE_ACCOUNT, accountType: 'expense', debitIrr: 0, creditIrr: amountIrr, branchId, costCenter, paymentMethod: 'wallet_adjustment_reversal', counterpartyId: phone, memo: `برگشت هزینه تعدیل کیف پول ${phone}` },
    ];
  return withFinanceAtomicity(db, () => {
    const recorded = recordEvent(db, {
      source: 'wallet.adjustment', sourceId, sourceVersion: 1, idempotencyKey: key,
      branchId, occurredAt: input.occurredAt || now(), amountIrr,
      payload: { phone, deltaToman, amountIrr, direction: positive ? 'increase' : 'decrease', reason: String(input.reason || '').trim().slice(0, 160) || null },
      status: 'pending', error: null,
    });
    const event = recorded.event;
    const oldDelta = event.payload?.deltaToman;
    const oldPhone = String(event.payload?.phone || '').trim();
    if (recorded.idempotentReplay && (
      (oldDelta != null && Number(oldDelta) !== deltaToman)
      || (oldPhone && oldPhone !== phone)
      || Number(event.branchId) !== branchId
    )) {
      throw Object.assign(new Error('کلید تعدیل کیف پول قبلاً برای مبلغ دیگری مصرف شده است.'), { code: 'wallet_adjust_idempotency_conflict', status: 409 });
    }
    let journalEntry = event.journalEntryId
      ? state.journalEntries.find((entry) => entry.id === event.journalEntryId) || null
      : null;
    if (!journalEntry) journalEntry = postEventJournal(db, event, lines, `تعدیل کیف پول ${phone}`, actor);
    if (!journalEntry || journalEntry.status !== 'posted') return { event, journalEntry: null, walletResult: null, blocked: true, idempotentReplay: recorded.idempotentReplay };
    const alreadyApplied = event.payload?.walletAppliedAt
      || list(db.walletLedger).some((row) => row?.meta?.financeEventId === event.id);
    let walletResult = null;
    if (!alreadyApplied && typeof applyWallet === 'function') {
      walletResult = applyWallet({ event, journalEntry });
      event.payload = { ...event.payload, walletAppliedAt: now(), walletLedgerId: walletResult?.adjustEntry?.id || null };
    }
    return { event, journalEntry, walletResult, blocked: false, idempotentReplay: recorded.idempotentReplay };
  }, { keys: ['events', 'payments', 'reconciliationItems', 'journalEntries', 'idempotency'], objects: [db.users, db.walletLedger] });
}

function capturePaidOrderAtomic(db, order, { actor = 'system', idempotencyKey } = {}) {
  if (!paid(order)) return { skipped: true, reason: 'order_not_paid' };
  const rollout = ensureFinanceV2(db).rollout;
  if (rollout.captureEnabled === false || (rollout.enabledBranchIds.length && !rollout.enabledBranchIds.map(Number).includes(Number(order.branchId)))) {
    return { skipped: true, reason: 'finance_v2_feature_flag_disabled' };
  }
  const built = salesLines(order, db);
  // Keep the payment projection coupled to the posted sale journal.  A
  // closed/missing fiscal period can block the event without throwing; in
  // that case materializing a succeeded finance payment would make the
  // payment side look complete while the ledger is still empty.  Resolution
  // (or a later retry) materializes the rows after the journal is posted.
  let payments = [];
  const recorded = recordEvent(db, {
    source: 'order.paid', sourceId: order.id, sourceVersion: Math.max(1, int(order.paymentRevision || order.editRevision) || 1),
    idempotencyKey, branchId: order.branchId, occurredAt: order.paidAt || order.createdAt,
    amountIrr: irrFromLegacyToman(order.total), payload: {
      orderNo: order.orderNo || null,
      tenderSnapshot: built.ok ? built.tenders : [],
      calculation: built.ok ? { taxSource: built.taxSource } : null,
    },
    status: built.ok ? 'pending' : 'blocked',
    error: built.ok ? null : { code: built.code, message: built.message, details: built.details || null },
  });
  if (built.ok && !recorded.event.journalEntryId) {
    recorded.event.amountIrr = built.totalIrr;
    recorded.event.payload = {
      ...recorded.event.payload,
      orderNo: order.orderNo || null,
      tenderSnapshot: built.tenders,
      calculation: { taxSource: built.taxSource },
    };
    recorded.event.status = 'pending';
    recorded.event.error = null;
    postEventJournal(db, recorded.event, built.lines, `فروش قطعی سفارش ${order.orderNo || order.id}`, actor);
  }
  const journalEntry = recorded.event.journalEntryId ? ensureFinanceV2(db).journalEntries.find((entry) => entry.id === recorded.event.journalEntryId) : null;
  if (journalEntry && built.ok) payments = materializeOrderPayments(db, order, built.tenders);
  linkOrderPaymentsToSaleEvent(payments, recorded.event, journalEntry);
  // This function is already running inside capturePaidOrder's atomic
  // boundary. Keep the inner operation unwrapped so a single sale/payment/
  // COGS transaction rolls back as one unit.
  const costing = journalEntry ? captureOrderCogsAtomic(db, order, { actor }) : { skipped: true, reason: 'sales_journal_not_posted' };
  if (journalEntry) {
    try {
      const accountingEngine = require('./accounting-engine.js');
      accountingEngine.syncOrderSalesJournal(db, order);
    } catch (_) {}
  }
  return { ...recorded, journalEntry, costing, payments };
}

function captureOrderCogs(db, order, { actor = 'system' } = {}) {
  ensureFinanceV2(db);
  return withFinanceAtomicity(db, () => captureOrderCogsAtomic(db, order, { actor }), {
    keys: ['events', 'journalEntries', 'orderItemCostSnapshots', 'inventoryMovements', 'idempotency'],
  });
}

function captureOrderCogsAtomic(db, order, { actor = 'system' } = {}) {
  const state = ensureFinanceV2(db);
  const sourceId = String(order.id);
  const branchId = branchDimension(order);
  const sourceEvents = state.events.filter((event) => event.source === 'order.cogs' && String(event.sourceId) === sourceId);
  const conflicting = sourceEvents.find((event) => !sameExactBranch(event, { branchId }));
  if (conflicting) {
    throw Object.assign(new Error('رویداد بهای تمام‌شدهٔ سفارش در شعبهٔ دیگری وجود دارد.'), { code: 'order_cogs_source_branch_conflict' });
  }
  const branchEvents = sourceEvents.filter((event) => sameExactBranch(event, { branchId }));
  const journaledEvents = branchEvents.filter((event) => event.journalEntryId);
  if (journaledEvents.length > 1) {
    throw Object.assign(new Error('برای سفارش بیش از یک رویداد بهای تمام‌شده به سند دفتر وصل است.'), {
      code: 'order_cogs_event_identity_ambiguous', status: 409,
    });
  }
  if (journaledEvents.length === 1) {
    const postedEvent = journaledEvents[0];
    return {
      event: postedEvent,
      journalEntry: state.journalEntries.find((entry) => entry.id === postedEvent.journalEntryId) || null,
      snapshots: state.orderItemCostSnapshots.filter((row) => String(row.orderId) === sourceId && sameExactBranch(row, { branchId })),
      movements: state.inventoryMovements.filter((row) => row.source === 'order.cogs' && String(row.sourceId) === sourceId && sameExactBranch(row, { branchId })),
      idempotentReplay: true,
    };
  }
  const latestVersion = branchEvents.reduce((latest, event) => Math.max(latest, Number(event.sourceVersion) || 1), 0);
  const latestEvents = branchEvents.filter((event) => (Number(event.sourceVersion) || 1) === latestVersion);
  if (latestEvents.length > 1) {
    throw Object.assign(new Error('برای نسخهٔ جاری بهای تمام‌شدهٔ سفارش چند رویداد وجود دارد.'), {
      code: 'order_cogs_event_identity_ambiguous', status: 409,
    });
  }
  const existing = latestEvents[0] || null;
  const salesEvent = state.events.find((event) => event.source === 'order.paid' && String(event.sourceId) === sourceId && sameExactBranch(event, { branchId }));
  if (salesEvent?.status !== 'posted' || !salesEvent.journalEntryId) {
    throw Object.assign(new Error('بهای تمام‌شده فقط پس از ثبت قطعی فروش همان سفارش قابل ثبت است.'), {
      code: 'order_cogs_sales_journal_required', status: 409,
    });
  }

  const built = orderCosting.buildOrderCosting(db, order);
  const occurredAt = order.paidAt || order.createdAt || existing?.occurredAt || now();
  const eventPayload = {
    orderNo: order.orderNo || null,
    salesEventId: salesEvent.id,
    salesJournalEntryId: salesEvent.journalEntryId,
    coverage: { coveredLines: built.snapshots.length, totalLines: list(order.items).length },
    issues: built.issues,
  };
  let sourceVersion = existing ? latestVersion : 1;
  let eventInput = {
    source: 'order.cogs', sourceId, sourceVersion,
    idempotencyKey: `order:${branchId || 'unscoped'}:${sourceId}:cogs:v${sourceVersion}`, branchId,
    occurredAt, amountIrr: built.totalCogsIrr || 0,
    payload: eventPayload,
    status: built.ok ? 'pending' : 'blocked',
    error: built.ok ? null : { code: built.code, message: built.message, details: { issues: built.issues } },
  };
  let supersededEvents = [];
  if (existing) {
    const nextFingerprint = financeEventPayloadFingerprint(eventInput);
    const existingFingerprint = existing.payloadFingerprint || financeEventPayloadFingerprint(existing);
    if (nextFingerprint !== existingFingerprint) {
      if (!Number.isSafeInteger(latestVersion + 1)) {
        throw Object.assign(new Error('نسخهٔ رویداد بهای تمام‌شده از محدودهٔ امن خارج است.'), {
          code: 'order_cogs_event_version_invalid', status: 409,
        });
      }
      supersededEvents = branchEvents.filter((event) => !event.journalEntryId
        && ['pending', 'blocked', 'failed'].includes(String(event.status)));
      sourceVersion = latestVersion + 1;
      eventInput = {
        ...eventInput,
        sourceVersion,
        idempotencyKey: `order:${branchId || 'unscoped'}:${sourceId}:cogs:v${sourceVersion}`,
        payload: { ...eventPayload, retryOfEventId: existing.id },
      };
    }
  }
  const recorded = recordEvent(db, eventInput);
  if (supersededEvents.length && !recorded.idempotentReplay) {
    for (const supersededEvent of supersededEvents) {
      // `quarantined` is the schema-supported terminal status for an older
      // blocked attempt once a new immutable COGS event version replaces it.
      supersededEvent.status = 'quarantined';
      supersededEvent.error = {
        code: 'order_cogs_attempt_superseded',
        message: 'این تلاش مسدود با نسخهٔ جدیدتر رویداد بهای تمام‌شده جایگزین شد.',
      };
      supersededEvent.processedAt = now();
      supersededEvent.payload = { ...supersededEvent.payload, supersededByEventId: recorded.event.id };
    }
  }

  if (!built.ok) {
    recorded.event.status = 'blocked';
    recorded.event.error = { code: built.code, message: built.message, details: { issues: built.issues } };
    recorded.event.payload = { ...recorded.event.payload, coverage: { coveredLines: built.snapshots.length, totalLines: list(order.items).length }, issues: built.issues };
    return { ...recorded, journalEntry: null, snapshots: [], movements: [], costing: built };
  }

  recorded.event.amountIrr = built.totalCogsIrr;
  recorded.event.status = 'pending';
  recorded.event.error = null;
  recorded.event.payload = {
    ...recorded.event.payload,
    totalCogsIrr: built.totalCogsIrr,
    coverage: { coveredLines: built.snapshots.length, totalLines: list(order.items).length },
    recipeVersionIds: [...new Set(built.snapshots.map((row) => row.recipeVersionId))],
    salesEventId: salesEvent.id,
    salesJournalEntryId: salesEvent.journalEntryId,
  };
  const costCenter = `branch:${branchId}`;
  const lines = [{
    accountCode: '5100', accountType: 'cogs', debitIrr: built.totalCogsIrr, creditIrr: 0,
    branchId, costCenter, itemId: null, recipeVersionId: null,
    memo: `بهای تمام‌شده سفارش ${order.orderNo || order.id}`,
  }, ...built.movements.map((movement) => ({
    accountCode: '1610', debitIrr: 0, creditIrr: movement.totalCostIrr,
    branchId, costCenter, itemId: movement.itemId, recipeVersionId: movement.recipeVersionIds.length === 1 ? movement.recipeVersionIds[0] : null,
    memo: `مصرف دستور تهیهٔ سفارش ${order.orderNo || order.id}`,
  }))];
  const entry = postEventJournal(db, recorded.event, lines, `بهای تمام‌شده و مصرف دستور تهیهٔ سفارش ${order.orderNo || order.id}`, actor);
  if (!entry) return { ...recorded, journalEntry: null, snapshots: [], movements: [], costing: built };

  const existingSnapshots = state.orderItemCostSnapshots.filter((row) => String(row.orderId) === sourceId && sameExactBranch(row, { branchId }));
  if (!existingSnapshots.length) {
    for (const snapshot of built.snapshots) state.orderItemCostSnapshots.push({ ...snapshot, journalEntryId: entry.id });
    for (const movement of built.movements) state.inventoryMovements.push({ ...movement, journalEntryId: entry.id });
  }
  const snapshots = state.orderItemCostSnapshots.filter((row) => String(row.orderId) === sourceId && sameExactBranch(row, { branchId }));
  const movements = state.inventoryMovements.filter((row) => row.source === 'order.cogs' && String(row.sourceId) === sourceId && sameExactBranch(row, { branchId }));
  recorded.event.payload.snapshotIds = snapshots.map((row) => row.id);
  recorded.event.payload.inventoryMovementIds = movements.map((row) => row.id);
  return { ...recorded, journalEntry: entry, snapshots, movements, costing: built };
}

function retryReadyOrderCogs(db, input = {}, actor = 'system') {
  const branchId = branchDimension(input);
  if (!branchId) {
    throw Object.assign(new Error('شعبهٔ سفارش‌ها برای بازآزمایی بهای تمام‌شده الزامی است.'), {
      code: 'order_cogs_retry_branch_required', status: 400,
    });
  }
  if (input.confirmed !== true) {
    throw Object.assign(new Error('پیش از بازآزمایی، ایجاد احتمالی سند بهای تمام‌شده و مصرف انبار را تأیید کنید.'), {
      code: 'order_cogs_retry_confirmation_required', status: 400,
    });
  }

  const state = ensureFinanceV2(db);
  const candidates = state.events
    .filter((event) => event.source === 'order.cogs' && event.status === 'blocked' && sameExactBranch(event, { branchId }))
    .sort((left, right) => new Date(left.occurredAt) - new Date(right.occurredAt))
    .slice(0, 100);
  const result = {
    branchId,
    candidateCount: candidates.length,
    processed: 0,
    posted: 0,
    stillBlocked: 0,
    skipped: 0,
    remainingBlocked: 0,
    rows: [],
  };

  for (const event of candidates) {
    const order = list(db.orders).find((row) => String(row.id) === String(event.sourceId) && sameExactBranch(row, { branchId }));
    if (!order) {
      result.skipped += 1;
      result.rows.push({ eventId: event.id, orderId: String(event.sourceId), status: 'skipped', reason: 'order_not_found' });
      continue;
    }
    if (!paid(order)) {
      result.skipped += 1;
      result.rows.push({ eventId: event.id, orderId: String(order.id), orderNo: order.orderNo || null, status: 'skipped', reason: 'order_not_paid' });
      continue;
    }
    const salesEvent = state.events.find((row) => row.source === 'order.paid' && String(row.sourceId) === String(order.id) && sameExactBranch(row, { branchId }));
    if (salesEvent?.status !== 'posted' || !salesEvent.journalEntryId) {
      result.skipped += 1;
      result.rows.push({ eventId: event.id, orderId: String(order.id), orderNo: order.orderNo || null, status: 'skipped', reason: 'sales_journal_not_posted' });
      continue;
    }
    try {
      const retried = withFinanceAtomicity(db, () => captureOrderCogsAtomic(db, order, { actor }), {
        keys: ['events', 'journalEntries', 'orderItemCostSnapshots', 'inventoryMovements', 'idempotency'],
      });
      result.processed += 1;
      if (retried.event?.status === 'posted' && retried.journalEntry) {
        result.posted += 1;
        result.rows.push({
          eventId: retried.event.id, orderId: String(order.id), orderNo: order.orderNo || null,
          status: 'posted', journalEntryId: retried.journalEntry.id,
        });
      } else {
        result.stillBlocked += 1;
        result.rows.push({
          eventId: retried.event?.id || event.id, orderId: String(order.id), orderNo: order.orderNo || null,
          status: 'blocked', errorCode: retried.event?.error?.code || retried.costing?.code || 'order_costing_incomplete',
        });
      }
    } catch (error) {
      result.processed += 1;
      result.stillBlocked += 1;
      result.rows.push({
        eventId: event.id, orderId: String(order.id), orderNo: order.orderNo || null,
        status: 'blocked', errorCode: error.code || 'order_cogs_retry_failed',
      });
    }
  }
  result.remainingBlocked = state.events
    .filter((event) => event.source === 'order.cogs' && event.status === 'blocked' && sameExactBranch(event, { branchId })).length;
  return result;
}

function reverseOrderCogsAndInventory(db, orderId, actor = 'system', reason = 'لغو سفارش و بازگشت به انبار', occurredAt = now()) {
  ensureFinanceV2(db);
  return withFinanceAtomicity(db, () => reverseOrderCogsAndInventoryAtomic(db, orderId, actor, reason, occurredAt), {
    keys: ['events', 'journalEntries', 'inventoryMovements', 'idempotency'],
  });
}

function reverseOrderCogsAndInventoryAtomic(db, orderId, actor = 'system', reason = 'لغو سفارش و بازگشت به انبار', occurredAt = now()) {
  const state = ensureFinanceV2(db);
  const sourceId = String(orderId);
  const cogsEvents = state.events.filter((event) => event.source === 'order.cogs' && String(event.sourceId) === sourceId);
  let reversedJournalEntry = null;

  for (const cogsEvent of cogsEvents) {
    if (cogsEvent.journalEntryId) {
      const entry = state.journalEntries.find((row) => row.id === cogsEvent.journalEntryId);
      if (entry && entry.status === 'posted' && !entry.reversedById) {
        // Physical stock and its COGS journal form one business operation.
        // If accounting refuses the reversal (for example, because the
        // posting period is closed), propagate the error so the surrounding
        // finance atomicity boundary rolls back instead of restoring stock
        // while leaving the posted expense untouched.
        reversedJournalEntry = reverseEntry(db, entry.id, actor, String(reason || 'لغو سفارش').slice(0, 180), occurredAt);
      }
    }
  }

  const movements = state.inventoryMovements.filter((row) => row.source === 'order.cogs' && String(row.sourceId) === sourceId);
  const returnMovements = [];

  for (const movement of movements) {
    if (Number(movement.quantityBase) >= 0) continue;
    const alreadyReversed = state.inventoryMovements.some((row) => row.reversalOfId === movement.id);
    if (alreadyReversed) continue;

    const returnMovement = {
      ...movement,
      id: id(),
      movementType: 'return',
      quantityBase: -Number(movement.quantityBase),
      source: 'order.cogs.reversal',
      sourceId,
      reversalOfId: movement.id,
      reason: String(reason || 'لغو سفارش و بازگشت مواد مصرفی به انبار').slice(0, 180),
      occurredAt,
      createdAt: now(),
      createdBy: actor,
    };
    state.inventoryMovements.push(returnMovement);
    returnMovements.push(returnMovement);

    if (Array.isArray(db.accounting?.inventoryItems)) {
      const invItem = inventoryOperations.resolveInventoryItemForBranch(db.accounting?.inventoryItems, movement.itemId, movement.branchId);
      if (invItem) {
        const avail = orderCosting.physicalAvailable(invItem, state, movement.branchId);
        if (avail.ok) invItem.availableQuantity = avail.value;
      }
    }
  }

  if (returnMovements.length > 0 || reversedJournalEntry) {
    const recorded = recordEvent(db, {
      source: 'order.cogs.reversal',
      sourceId,
      sourceVersion: 1,
      idempotencyKey: `order:cogs:reversal:${sourceId}:${Date.now()}`,
      branchId: cogsEvents[0]?.branchId || null,
      occurredAt,
      amountIrr: reversedJournalEntry ? (reversedJournalEntry.lines?.[0]?.debitIrr || 0) : 0,
      payload: {
        orderId: sourceId,
        reversedJournalEntryId: reversedJournalEntry?.id || null,
        returnMovementIds: returnMovements.map((row) => row.id),
        reason,
      },
      status: 'posted',
    });
    return { ok: true, reversedJournalEntry, returnMovements, event: recorded.event };
  }

  return { ok: true, reversedJournalEntry: null, returnMovements: [], event: null };
}

function inventoryOperationLines(kind, movements, branchId) {
  const costCenter = `branch:${branchId}`;
  // A production output carries the allocated value of its consumed inputs.
  // Counting both sides here would double the batch value and overstate stock.
  const consumedTotal = movements
    .filter((movement) => movement.direction !== 'produce')
    .reduce((sum, movement) => sum + int(movement.effectiveTotalCostIrr ?? movement.totalCostIrr), 0);
  if (kind === 'waste') {
    const movement = movements[0];
    const amount = int(movement.effectiveTotalCostIrr ?? movement.totalCostIrr);
    return [
      { accountCode: '5110', accountType: 'cogs', debitIrr: amount, creditIrr: 0, branchId, costCenter, itemId: movement.itemId, memo: `ضایعات ${movement.itemName}` },
      { accountCode: '1610', debitIrr: 0, creditIrr: amount, branchId, costCenter, itemId: movement.itemId, memo: `خروج ضایعات ${movement.itemName}` },
    ];
  }
  if (kind === 'stock_count') {
    if (!movements.length) return [];
    const movement = movements[0];
    const amount = int(movement.effectiveTotalCostIrr ?? movement.totalCostIrr);
    return movement.quantityBase < 0
      ? [
        { accountCode: '5120', accountType: 'cogs', debitIrr: amount, creditIrr: 0, branchId, costCenter, itemId: movement.itemId, memo: `کسری شمارش ${movement.itemName}` },
        { accountCode: '1610', debitIrr: 0, creditIrr: amount, branchId, costCenter, itemId: movement.itemId, memo: `اصلاح کسری ${movement.itemName}` },
      ]
      : [
        { accountCode: '1610', debitIrr: amount, creditIrr: 0, branchId, costCenter, itemId: movement.itemId, memo: `اصلاح مازاد ${movement.itemName}` },
        { accountCode: '4520', accountType: 'revenue', debitIrr: 0, creditIrr: amount, branchId, costCenter, itemId: movement.itemId, memo: `مازاد شمارش ${movement.itemName}` },
      ];
  }
  if (kind === 'production_batch') {
    const consumed = movements.filter((movement) => movement.direction === 'consume');
    const produced = movements.find((movement) => movement.direction === 'produce');
    const credits = consumed.map((movement) => ({
      accountCode: '1610', debitIrr: 0, creditIrr: int(movement.effectiveTotalCostIrr ?? movement.totalCostIrr),
      branchId, costCenter, itemId: movement.itemId, recipeVersionId: movement.recipeId || null,
      memo: `مصرف دسته تولید ${movement.itemName}`,
    }));
    const debit = produced
      ? { accountCode: '1610', debitIrr: consumedTotal, creditIrr: 0, branchId, costCenter, itemId: produced.itemId, recipeVersionId: produced.recipeId || null, memo: `محصول دسته تولید ${produced.itemName}` }
      : { accountCode: '5130', accountType: 'cogs', debitIrr: consumedTotal, creditIrr: 0, branchId, costCenter, memo: 'افت کامل دسته تولید' };
    return [debit, ...credits];
  }
  if (kind === 'stock_issue') {
    const movement = movements[0];
    const amount = int(movement.effectiveTotalCostIrr ?? movement.totalCostIrr);
    return [
      { accountCode: '5130', accountType: 'cogs', debitIrr: amount, creditIrr: 0, branchId, costCenter, itemId: movement.itemId, memo: `خروج موجودی ${movement.itemName}` },
      { accountCode: '1610', debitIrr: 0, creditIrr: amount, branchId, costCenter, itemId: movement.itemId, memo: `کسر موجودی ${movement.itemName}` },
    ];
  }
  if (kind === 'stock_transfer') return [];
  throw Object.assign(new Error('قاعدهٔ مالی عملیات انبار تعریف نشده است.'), { code: 'inventory_operation_rule_missing' });
}

function recordInventoryOperationV2(db, kind, input, actor, idempotencyKey) {
  ensureFinanceV2(db);
  return withFinanceAtomicity(db, () => recordInventoryOperationV2Atomic(db, kind, input, actor, idempotencyKey), {
    keys: ['events', 'journalEntries', 'inventoryMovements', 'productionBatches', 'reconciliationItems', 'idempotency'],
  });
}

function recordInventoryOperationV2Atomic(db, kind, input, actor, idempotencyKey) {
  const state = ensureFinanceV2(db);
  const existing = state.events.find((event) => event.idempotencyKey === idempotencyKey);
  if (existing) return {
    event: existing,
    journalEntry: existing.journalEntryId ? state.journalEntries.find((entry) => entry.id === existing.journalEntryId) || null : null,
    movements: state.inventoryMovements.filter((movement) => list(existing.payload?.movementIds).includes(movement.id)),
    idempotentReplay: true,
  };
  const builder = kind === 'waste' ? inventoryOperations.buildWaste
    : kind === 'stock_count' ? inventoryOperations.buildStockCount
      : kind === 'production_batch' ? inventoryOperations.buildProductionBatch
        : kind === 'stock_issue' ? inventoryOperations.buildStockIssue
          : kind === 'stock_transfer' ? inventoryOperations.buildStockTransfer : null;
  if (!builder) throw Object.assign(new Error('نوع عملیات انبار معتبر نیست.'), { code: 'inventory_operation_kind_invalid' });
  const result = builder(db, state, input, actor);
  if (!result.ok) throw Object.assign(new Error(result.message || 'عملیات انبار معتبر نیست.'), { code: result.code, status: 409, details: { issues: result.issues || [] } });
  for (const movement of result.movements) state.inventoryMovements.push(movement);
  if (kind === 'production_batch') state.productionBatches.push({
    id: result.operationId, branchId: result.branchId, recipeVersionId: String(result.recipe.id),
    outputItemId: String(result.outputItem.id), plannedYield: result.plannedYield, actualYield: result.actualYield,
    status: 'completed', producedAt: result.occurredAt, createdBy: actor, idempotencyKey, createdAt: now(),
  });
  const source = ({ waste: 'inventory.waste', stock_count: 'inventory.stock_count', production_batch: 'inventory.production_batch', stock_issue: 'inventory.stock_issue', stock_transfer: 'inventory.stock_transfer' })[kind];
  const valued = result.movements.every((movement) => movement.totalCostIrr != null);
  const zeroValueNoJournal = valued && result.movements.length > 0 && int(result.totalCostIrr) === 0;
  const recorded = recordEvent(db, {
    source, sourceId: result.operationId, sourceVersion: 1, idempotencyKey,
    branchId: result.branchId, occurredAt: result.occurredAt, amountIrr: result.totalCostIrr || 0,
    payload: {
      kind, reason: result.reason || null, itemId: result.item?.id || null, recipeId: result.recipe?.id || null,
      movementIds: result.movements.map((movement) => movement.id), issues: result.issues,
      countedQuantityBase: result.countedQuantityBase ?? null, expectedQuantityBase: result.expectedQuantityBase ?? null,
      deltaBase: result.deltaBase ?? null, plannedYield: result.plannedYield ?? null, actualYield: result.actualYield ?? null,
      physicalRecorded: true, valuationStatus: valued ? 'valued' : 'unvalued', zeroValueNoJournal,
    },
    status: result.movements.length === 0 || zeroValueNoJournal ? 'posted' : valued ? 'pending' : 'blocked',
    error: valued ? null : { code: 'inventory_cost_unit_ambiguous', message: 'واقعیت فیزیکی ثبت شد، اما برای سند مالی قیمت معتبر کالا لازم است.' },
  });
  let journalEntry = null;
  if (!result.movements.length || zeroValueNoJournal) {
    recorded.event.processedAt = now();
  } else if (valued) {
    const lines = inventoryOperationLines(kind, result.movements, result.branchId);
    journalEntry = postEventJournal(db, recorded.event, lines, `عملیات انبار: ${source} / ${result.operationId}`, actor);
  }
  const reviewIssues = result.issues.filter((issue) => ['waste_exceeds_available', 'stock_count_material_variance', 'inventory_shortage'].includes(issue.code));
  if (reviewIssues.length) state.reconciliationItems.push({
    id: id(), kind: 'inventory_exception', branchId: result.branchId, orderId: null, paymentId: null, cashSessionId: null,
    bankReference: null, settlementReference: null, psp: null, terminalId: null, batchNo: null,
    journalEntryId: journalEntry?.id || null, amountIrr: result.totalCostIrr || 0, status: 'exception',
    matchedAt: null, matchedBy: null, details: { financeEventId: recorded.event.id, operationId: result.operationId, issues: reviewIssues }, createdAt: now(),
  });
  return { ...result, event: recorded.event, journalEntry, physicalRecorded: true, idempotentReplay: false };
}

function valueAndResolveInventoryEvent(db, event, actor) {
  const state = ensureFinanceV2(db);
  const movements = list(event.payload?.movementIds).map((movementId) => state.inventoryMovements.find((movement) => movement.id === movementId)).filter(Boolean);
  if (!movements.length) throw Object.assign(new Error('گردش فیزیکی رویداد یافت نشد.'), { code: 'inventory_event_movements_missing', status: 409 });
  const candidates = [];
  const effective = movements.map((movement) => {
    if (movement.totalCostIrr != null) return { ...movement, effectiveTotalCostIrr: movement.totalCostIrr };
    if (movement.direction === 'produce') return { ...movement, effectiveTotalCostIrr: null };
    const item = inventoryOperations.inventoryItem(db, movement.itemId, movement.branchId);
    const cost = orderCosting.unitCostIrr(item, null, state.settings);
    if (!cost.ok) throw Object.assign(new Error(`قیمت معتبر برای «${movement.itemName || movement.itemId}» ثبت نشده است.`), { code: cost.code, status: 409 });
    const totalCostIrr = Math.round(Math.abs(movement.quantityBase) * cost.amountIrr);
    candidates.push({ id: id(), movementId: movement.id, unitCostIrr: cost.amountIrr, totalCostIrr, source: cost.source, createdBy: actor, createdAt: now() });
    return { ...movement, effectiveTotalCostIrr: totalCostIrr };
  });
  const productionCost = effective.filter((movement) => movement.direction === 'consume').reduce((sum, movement) => sum + int(movement.effectiveTotalCostIrr), 0);
  effective.forEach((movement) => {
    if (movement.direction === 'produce' && movement.effectiveTotalCostIrr == null) {
      movement.effectiveTotalCostIrr = productionCost;
      const unitCostIrr = movement.quantityBase > 0 ? Math.round(productionCost / movement.quantityBase) : 0;
      candidates.push({ id: id(), movementId: movement.id, unitCostIrr, totalCostIrr: productionCost, source: 'production_batch_allocation', createdBy: actor, createdAt: now() });
    }
  });
  const lines = inventoryOperationLines(event.payload.kind, effective, Number(event.branchId));
  event.amountIrr = effective.filter((movement) => movement.direction !== 'produce').reduce((sum, movement) => sum + int(movement.effectiveTotalCostIrr), 0)
    || effective.reduce((sum, movement) => sum + int(movement.effectiveTotalCostIrr), 0);
  if (event.amountIrr === 0) {
    event.status = 'posted'; event.error = null; event.processedAt = now();
    event.payload.resolvedBy = actor; event.payload.resolvedAt = now(); event.payload.zeroValueNoJournal = true;
    state.inventoryMovementValuations.push(...candidates);
    event.payload.valuationIds = candidates.map((row) => row.id);
    return { event, entry: null, valuations: candidates };
  }
  event.status = 'pending'; event.error = null; event.payload.resolvedBy = actor; event.payload.resolvedAt = now();
  const entry = postEventJournal(db, event, lines, `ارزش‌گذاری و ثبت مالی ${event.source} / ${event.sourceId}`, actor);
  if (entry) {
    state.inventoryMovementValuations.push(...candidates);
    event.payload.valuationIds = candidates.map((row) => row.id);
  }
  return { event, entry, valuations: entry ? candidates : [] };
}

function captureOnlinePaidOrder(db, order, payment, { actor = 'system', occurredAt } = {}) {
  return withFinanceAtomicity(db, () => captureOnlinePaidOrderAtomic(db, order, payment, { actor, occurredAt }), {
    keys: ['events', 'payments', 'reconciliationItems', 'journalEntries', 'orderItemCostSnapshots', 'inventoryMovements', 'idempotency'],
    objects: [order, payment],
  });
}

function captureOnlinePaidOrderAtomic(db, order, payment, { actor = 'system', occurredAt } = {}) {
  if (!order || !payment || String(payment.orderId) !== String(order.id)) {
    throw Object.assign(new Error('پرداخت آنلاین به سفارش معتبر متصل نیست.'), { code: 'online_payment_order_mismatch' });
  }
  const branchId = branchDimension(order);
  if (!branchId || payment.branchId == null || !sameExactBranch(payment, order)) {
    throw Object.assign(new Error('پرداخت آنلاین و سفارش به یک شعبه تعلق ندارند.'), { code: 'online_payment_branch_mismatch' });
  }
  if (payment.status !== 'paid') return { skipped: true, reason: 'online_payment_not_paid' };
  if (String(order.paymentMethod || '').trim() !== 'online'
    || [payment.tender, payment.paymentMethod, payment.method].some((value) => value != null && String(value).trim() !== 'online')) {
    throw Object.assign(new Error('روش پرداخت capture با سفارش آنلاین هم‌خوان نیست.'), {
      code: 'online_payment_tender_invalid', status: 409,
    });
  }
  const paymentId = payment.id == null ? '' : String(payment.id).trim();
  if (!paymentId) {
    throw Object.assign(new Error('شناسهٔ capture آنلاین الزامی است.'), {
      code: 'online_payment_identity_missing', status: 409,
    });
  }
  let paymentAmountIrr;
  try { paymentAmountIrr = strictLegacyTomanIrr(payment.amount, 'online_payment_amount_invalid'); }
  catch (error) {
    throw Object.assign(error, { code: 'online_payment_amount_invalid', status: 409 });
  }
  const paymentAmount = paymentAmountIrr / 10;
  if (paymentAmount <= 0) {
    throw Object.assign(new Error('مبلغ پرداخت آنلاین تأییدشده معتبر نیست.'), {
      code: 'online_payment_amount_invalid', status: 409,
    });
  }
  let orderTotalIrr;
  try { orderTotalIrr = strictLegacyTomanIrr(order.total, 'online_order_total_invalid'); }
  catch (error) {
    throw Object.assign(error, { code: 'online_order_total_invalid', status: 409 });
  }
  const orderTotal = orderTotalIrr / 10;
  if (orderTotal <= 0) {
    throw Object.assign(new Error('مبلغ کل سفارش آنلاین معتبر نیست.'), {
      code: 'online_order_total_invalid', status: 409,
    });
  }
  const paidAt = occurredAt || payment.updatedAt || payment.createdAt || now();
  if (!valueContracts.parseTimestamp(paidAt)) {
    throw Object.assign(new Error('زمان capture آنلاین معتبر نیست.'), {
      code: 'online_payment_timestamp_invalid', status: 409,
    });
  }
  if (order.partialPayments != null && !Array.isArray(order.partialPayments)) {
    throw Object.assign(new Error('ساختار سابقهٔ پرداخت سفارش معتبر نیست.'), {
      code: 'online_payment_projection_invalid', status: 409,
    });
  }
  if (!Array.isArray(order.partialPayments)) order.partialPayments = [];
  const matchingRows = order.partialPayments.filter((row) => row && typeof row === 'object'
    && String(row.paymentAttemptId ?? row.id ?? '') === paymentId);
  if (matchingRows.length > 1) {
    throw Object.assign(new Error('پرداخت آنلاین با این شناسه چند بار به سفارش پیوند خورده است.'), {
      code: 'online_payment_identity_ambiguous', status: 409,
    });
  }
  const seenCaptureIds = new Set();
  let acceptedAmount = 0;
  for (const row of order.partialPayments) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      throw Object.assign(new Error('سابقهٔ پرداخت سفارش معتبر نیست.'), { code: 'online_payment_projection_invalid', status: 409 });
    }
    const rowId = String(row.paymentAttemptId ?? row.id ?? '').trim();
    if (row.paymentAttemptId != null && row.id != null && String(row.paymentAttemptId) !== String(row.id)) {
      throw Object.assign(new Error('شناسهٔ پرداخت عملیاتی و شناسهٔ capture یکسان نیست.'), {
        code: 'online_payment_projection_invalid', status: 409,
      });
    }
    if (rowId) {
      if (seenCaptureIds.has(rowId)) {
        throw Object.assign(new Error('شناسهٔ پرداخت در سابقهٔ سفارش تکراری است.'), { code: 'online_payment_identity_ambiguous', status: 409 });
      }
      seenCaptureIds.add(rowId);
    }
    const rowTender = String(row.tender || '').trim();
    if (!TENDER_ACCOUNTS[rowTender] || rowTender === 'cashier') {
      throw Object.assign(new Error('روش یکی از پرداخت‌های قبلی سفارش معتبر نیست.'), { code: 'online_payment_projection_invalid', status: 409 });
    }
    let rowAmountIrr;
    try { rowAmountIrr = strictLegacyTomanIrr(row.amount, 'online_payment_projection_invalid'); }
    catch (error) {
      throw Object.assign(error, { code: 'online_payment_projection_invalid', status: 409 });
    }
    if (rowAmountIrr <= 0 || !Number.isSafeInteger(acceptedAmount + rowAmountIrr / 10)) {
      throw Object.assign(new Error('جمع سابقهٔ پرداخت سفارش معتبر نیست.'), { code: 'online_payment_projection_invalid', status: 409 });
    }
    acceptedAmount += rowAmountIrr / 10;
  }
  if (order.amountPaid != null) {
    let projectedAmountIrr;
    try { projectedAmountIrr = strictLegacyTomanIrr(order.amountPaid, 'online_payment_projection_invalid'); }
    catch (error) {
      throw Object.assign(error, { code: 'online_payment_projection_invalid', status: 409 });
    }
    if (projectedAmountIrr / 10 !== acceptedAmount) {
      throw Object.assign(new Error('جمع پرداخت‌های سفارش با مبلغ پرداخت‌شدهٔ ثبت‌شده هم‌خوان نیست.'), {
        code: 'online_payment_projection_mismatch', status: 409,
      });
    }
  }
  let tenderRow = matchingRows[0] || null;
  if (tenderRow) {
    const incomingProvider = payment.provider == null || String(payment.provider).trim() === '' ? null : String(payment.provider).trim();
    const incomingReference = payment.reference == null || String(payment.reference).trim() === ''
      ? (payment.providerReference == null || String(payment.providerReference).trim() === '' ? null : String(payment.providerReference).trim())
      : String(payment.reference).trim();
    const storedProvider = tenderRow.provider == null || String(tenderRow.provider).trim() === '' ? null : String(tenderRow.provider).trim();
    const storedReference = tenderRow.reference == null || String(tenderRow.reference).trim() === ''
      ? (tenderRow.providerReference == null || String(tenderRow.providerReference).trim() === '' ? null : String(tenderRow.providerReference).trim())
      : String(tenderRow.reference).trim();
    if (strictLegacyTomanIrr(tenderRow.amount, 'online_payment_identity_conflict') !== paymentAmountIrr
      || String(tenderRow.tender || '') !== 'online'
      || (storedProvider && incomingProvider && storedProvider !== incomingProvider)
      || (storedReference && incomingReference && storedReference !== incomingReference)) {
      throw Object.assign(new Error('شناسهٔ پرداخت آنلاین قبلاً با مبلغ یا مرجع دیگری ثبت شده است.'), {
        code: 'online_payment_identity_conflict', status: 409,
      });
    }
    if (!storedProvider && incomingProvider) tenderRow.provider = incomingProvider;
    if (!storedReference && incomingReference) tenderRow.reference = incomingReference;
  } else {
    acceptedAmount += paymentAmount;
  }
  if (!tenderRow) {
    tenderRow = {
      id: payment.id, paymentAttemptId: payment.id, tender: 'online', amount: paymentAmount,
      reference: payment.reference || payment.providerReference || null,
      provider: payment.provider || null, at: paidAt, by: 'payment_gateway',
    };
    order.partialPayments.push(tenderRow);
    order.paymentRevision = Math.max(1, int(order.paymentRevision) + 1);
  }
  order.paymentMethod = 'online';
  order.paymentTender = 'online';
  order.paymentTenders = [...new Set(order.partialPayments.map((row) => row.tender).filter(Boolean))];
  if (acceptedAmount > orderTotal) {
    throw Object.assign(new Error('مجموع captureها از مبلغ سفارش بیشتر است.'), {
      code: 'online_payment_amount_exceeds_due', status: 409,
      details: { total: orderTotal, captured: acceptedAmount },
    });
  }
  order.amountPaid = acceptedAmount;
  order.paymentStatus = acceptedAmount === orderTotal ? 'paid' : 'partial';
  if (order.paymentStatus === 'paid' && !order.paidAt) order.paidAt = paidAt;
  const receipt = captureOrderPaymentReceipt(db, order, tenderRow, { actor });
  payment.financeReceiptEventId = receipt.event.id;
  payment.financeReceiptJournalEntryId = receipt.journalEntry.id;
  payment.financePaymentId = receipt.payment.id;
  return capturePaidOrder(db, order, { actor, idempotencyKey: `order:${branchDimension(order) || 'unscoped'}:${order.id}:online-payment:${payment.id}` });
}

function positiveQuantity(value, code = 'quantity_invalid') {
  const quantity = numeric(value);
  if (!Number.isFinite(quantity) || quantity <= 0) throw Object.assign(new Error('مقدار باید عددی بزرگ‌تر از صفر باشد.'), { code });
  return quantity;
}

function createPurchaseOrderV2(db, input, actor) {
  const state = ensureFinanceV2(db);
  const branchId = Number(input.branchId) || null;
  const vendorId = String(input.vendorId || '').trim();
  if (!branchId) throw Object.assign(new Error('شعبهٔ سفارش خرید الزامی است.'), { code: 'branch_missing' });
  if (!vendorId) throw Object.assign(new Error('تأمین‌کننده الزامی است.'), { code: 'vendor_missing' });
  const branches = list(db.branches);
  if (branches.length && !branches.some((branch) => Number(branch.id) === branchId && branch.active !== false)) {
    throw Object.assign(new Error('شعبهٔ سفارش خرید یافت نشد یا فعال نیست.'), { code: 'purchase_branch_not_found', status: 409 });
  }
  const vendors = list(db.accounting?.vendors);
  if (vendors.length) {
    const vendor = vendors.find((row) => String(row.id) === vendorId);
    if (!vendor) throw Object.assign(new Error('تأمین‌کنندهٔ سفارش خرید یافت نشد.'), { code: 'purchase_vendor_not_found', status: 404 });
    if (vendor.active === false) {
      throw Object.assign(new Error('تأمین‌کنندهٔ غیرفعال قابل استفاده برای سفارش خرید نیست.'), { code: 'purchase_vendor_inactive', status: 409 });
    }
    if (vendor.branchId != null && Number(vendor.branchId) !== branchId) {
      throw Object.assign(new Error('تأمین‌کننده به شعبهٔ سفارش خرید تعلق ندارد.'), { code: 'purchase_vendor_branch_mismatch', status: 409 });
    }
  }
  const rawLines = list(input.lines);
  if (!rawLines.length) throw Object.assign(new Error('حداقل یک ردیف خرید الزامی است.'), { code: 'purchase_order_lines_missing' });
  const inventoryItems = list(db.accounting?.inventoryItems);
  let subtotalIrr = 0;
  const lines = rawLines.map((line, index) => {
    const itemId = String(line.itemId || '').trim();
    if (!itemId) throw Object.assign(new Error(`کالای ردیف ${index + 1} مشخص نیست.`), { code: 'purchase_item_missing' });
    const item = inventoryOperations.resolveInventoryItemForBranch(inventoryItems, itemId, branchId);
    if (!item) throw Object.assign(new Error(`کالای ردیف ${index + 1} در انبار شعبه یافت نشد.`), { code: 'purchase_item_not_found' });
    const baseUnit = restaurantIntelligence.canonicalUnit(item.unit);
    if (!baseUnit) throw Object.assign(new Error(`واحد پایهٔ کالای ردیف ${index + 1} در انبار مشخص نیست یا پشتیبانی نمی‌شود.`), { code: 'purchase_item_unit_missing' });
    const requestedUnit = line.unit == null || line.unit === '' ? null : restaurantIntelligence.canonicalUnit(line.unit);
    if (line.unit && (!requestedUnit || requestedUnit !== baseUnit)) throw Object.assign(new Error(`واحد ردیف ${index + 1} باید واحد پایهٔ «${baseUnit}» باشد.`), { code: 'purchase_item_unit_mismatch' });
    const quantity = positiveQuantity(line.quantity ?? line.qty);
    const unitPriceIrr = safeIrr(line.unitPriceIrr, 'unit_price_irr_invalid');
    if (unitPriceIrr <= 0) throw Object.assign(new Error(`قیمت واحد ردیف ${index + 1} باید بزرگ‌تر از صفر باشد.`), { code: 'purchase_unit_price_invalid' });
    const taxIrr = safeIrr(line.taxIrr ?? 0, 'tax_irr_invalid');
    const discountIrr = safeIrr(line.discountIrr ?? 0, 'discount_irr_invalid');
    const grossIrr = Math.round(quantity * unitPriceIrr);
    const lineTotalIrr = grossIrr + taxIrr - discountIrr;
    if (!Number.isSafeInteger(lineTotalIrr) || lineTotalIrr < 0) throw Object.assign(new Error(`جمع ریالی ردیف ${index + 1} معتبر نیست.`), { code: 'purchase_line_total_invalid' });
    subtotalIrr += lineTotalIrr;
    return {
      id: id(), lineNo: index + 1, itemId, description: String(line.description || '').trim().slice(0, 180) || String(item.name || itemId),
      quantity, receivedQuantity: 0, unit: baseUnit, unitPriceIrr, taxIrr, discountIrr, lineTotalIrr,
    };
  });
  if (!Number.isSafeInteger(subtotalIrr)) throw Object.assign(new Error('جمع سفارش خرید از محدودهٔ امن ریال خارج است.'), { code: 'purchase_total_unsafe' });
  const issueDate = input.issueDate == null || String(input.issueDate).trim() === ''
    ? now()
    : isoTimestamp(input.issueDate, 'purchase_issue_date_invalid', 'زمان سفارش خرید باید تاریخ ISO معتبر همراه منطقهٔ زمانی باشد.');
  const expectedDate = optionalCalendarDate(input.expectedDate, 'purchase_expected_date_invalid', 'تاریخ تحویل مورد انتظار باید تاریخ تقویمی معتبر یا timestamp ISO همراه منطقهٔ زمانی باشد.');
  const po = {
    id: id(), number: `F2-PO-${String(state.purchaseOrders.length + 1).padStart(6, '0')}`,
    branchId, vendorId, status: 'draft', issueDate, expectedDate,
    subtotalIrr, totalIrr: subtotalIrr, notes: String(input.notes || '').trim().slice(0, 300), lines,
    createdBy: actor, createdAt: now(), approvedBy: null, approvedAt: null,
  };
  state.purchaseOrders.push(po);
  return po;
}

function submitPurchaseOrderV2(db, poId, actor) {
  ensureFinanceV2(db);
  return withFinanceAtomicity(db, () => submitPurchaseOrderV2Atomic(db, poId, actor), { keys: ['purchaseOrders', 'approvals'] });
}

function submitPurchaseOrderV2Atomic(db, poId, actor) {
  const state = ensureFinanceV2(db);
  const po = state.purchaseOrders.find((row) => row.id === poId);
  if (!po) throw Object.assign(new Error('سفارش خرید یافت نشد.'), { code: 'purchase_order_not_found', status: 404 });
  if (po.status !== 'draft') throw Object.assign(new Error('فقط سفارش خرید پیش‌نویس قابل ارسال است.'), { code: 'purchase_order_not_draft', status: 409 });
  const existing = state.approvals.find((row) => row.entityType === 'purchase_order' && row.entityId === po.id && row.status === 'pending');
  if (existing) return { approval: existing, purchaseOrder: po, idempotentReplay: true };
  po.status = 'pending_approval';
  const approval = {
    id: id(), operation: 'approve_purchase_order', entityType: 'purchase_order', entityId: po.id,
    amountIrr: po.totalIrr, status: 'pending', createdBy: actor, createdAt: now(), decidedBy: null, decidedAt: null,
    history: [{ action: 'submitted', by: actor, at: now(), comment: null }],
  };
  state.approvals.push(approval);
  return { approval, purchaseOrder: po, idempotentReplay: false };
}

function receiveGoodsV2(db, input, actor) {
  ensureFinanceV2(db);
  return withFinanceAtomicity(db, () => receiveGoodsV2Atomic(db, input, actor), {
    keys: ['purchaseOrders', 'goodsReceipts', 'events', 'journalEntries', 'inventoryMovements', 'idempotency'],
  });
}

function receiveGoodsV2Atomic(db, input, actor) {
  const state = ensureFinanceV2(db);
  let po = state.purchaseOrders.find((row) => row.id === String(input.purchaseOrderId || input.poId || ''));
  const isSpot = !po && (!input.purchaseOrderId || ['spot', 'direct', 'daily'].includes(String(input.purchaseOrderId).toLowerCase()));
  if (!po && !isSpot) throw Object.assign(new Error('سفارش خرید V2 یافت نشد.'), { code: 'purchase_order_not_found', status: 404 });

  const rawLines = list(input.lines);
  if (!rawLines.length) throw Object.assign(new Error('حداقل یک ردیف دریافت الزامی است.'), { code: 'goods_receipt_lines_missing' });

  const requestedBranchId = Number(input.branchId) || (po ? Number(po.branchId) : 1);
  if (po && requestedBranchId && Number(po.branchId) !== requestedBranchId) {
    throw Object.assign(new Error('سفارش خرید متعلق به شعبهٔ فعال نیست.'), { code: 'goods_receipt_branch_mismatch', status: 409 });
  }

  if (isSpot) {
    const vendorId = String(input.vendorId || '').trim() || (list(db.accounting?.vendors)[0]?.id || 'vendor-spot');
    const poLines = rawLines.map((line, index) => {
      const invItem = inventoryOperations.resolveInventoryItemForBranch(db.accounting?.inventoryItems, line.itemId, requestedBranchId);
      if (!invItem) throw Object.assign(new Error(`کالای ردیف ${index + 1} در انبار شعبه یافت نشد.`), { code: 'purchase_item_not_found' });
      const qty = positiveQuantity(line.quantity ?? line.receivedQuantity ?? line.qty);
      const unitCostIrr = safeIrr(line.unitCostIrr ?? line.unitPriceIrr ?? invItem.avgCostIrr ?? invItem.unitCostIrr, 'unit_price_irr_invalid');
      const grossIrr = Math.round(qty * unitCostIrr);
      const poLineId = id();
      line.purchaseOrderLineId = poLineId;
      line.receivedQuantity = qty;
      return {
        id: poLineId,
        lineNo: index + 1,
        itemId: invItem.id,
        quantity: qty,
        unit: line.unit || invItem.unit || 'kg',
        unitPriceIrr: unitCostIrr,
        taxIrr: 0,
        discountIrr: 0,
        lineTotalIrr: grossIrr,
        receivedQuantity: 0,
        invoicedQuantity: 0,
      };
    });
    const subtotalIrr = poLines.reduce((sum, l) => sum + l.lineTotalIrr, 0);
    po = {
      id: id(),
      number: `F2-PO-SPOT-${String(state.purchaseOrders.length + 1).padStart(6, '0')}`,
      branchId: requestedBranchId,
      vendorId,
      status: 'approved',
      subtotalIrr,
      totalIrr: subtotalIrr,
      notes: String(input.notes || 'خرید مستقیم / روزانه').trim().slice(0, 300),
      lines: poLines,
      createdBy: actor,
      createdAt: now(),
      approvedBy: actor,
      approvedAt: now(),
    };
    state.purchaseOrders.push(po);
  }

  if (!['approved', 'partially_received'].includes(po.status)) throw Object.assign(new Error('سفارش خرید هنوز برای دریافت کالا تأیید نشده است.'), { code: 'purchase_order_not_approved', status: 409 });
  const deliveryNoteNumber = String(input.deliveryNoteNumber || '').trim().slice(0, 120);
  if (deliveryNoteNumber && state.goodsReceipts.some((row) => row.vendorId === po.vendorId && row.deliveryNoteNumber === deliveryNoteNumber)) {
    throw Object.assign(new Error('شماره حوالهٔ تأمین‌کننده قبلاً ثبت شده است.'), { code: 'goods_receipt_duplicate', status: 409 });
  }
  const seenPurchaseOrderLineIds = new Set();
  let totalValueIrr = 0;
  const lines = rawLines.map((line, index) => {
    const poLine = po.lines.find((row) => row.id === String(line.purchaseOrderLineId || line.poLineId || ''));
    if (!poLine) throw Object.assign(new Error(`ردیف ${index + 1} به سفارش خرید متصل نیست.`), { code: 'purchase_order_line_not_found' });
    if (seenPurchaseOrderLineIds.has(poLine.id)) throw Object.assign(new Error(`ردیف ${index + 1} در همین دریافت تکرار شده است.`), { code: 'goods_receipt_duplicate_purchase_order_line' });
    seenPurchaseOrderLineIds.add(poLine.id);
    const receivedQuantity = positiveQuantity(line.receivedQuantity ?? line.quantity ?? line.qty);
    const remaining = poLine.quantity - poLine.receivedQuantity;
    if (receivedQuantity > remaining + 1e-9) throw Object.assign(new Error(`دریافت ردیف ${index + 1} از مانده سفارش بیشتر است.`), { code: 'goods_receipt_over_quantity' });
    const lineValueIrr = Math.round(receivedQuantity * poLine.unitPriceIrr);
    if (!Number.isSafeInteger(lineValueIrr)) throw Object.assign(new Error('ارزش ریالی دریافت از محدودهٔ امن خارج است.'), { code: 'goods_receipt_value_unsafe' });
    totalValueIrr += lineValueIrr;
    return {
      id: id(), lineNo: index + 1, purchaseOrderLineId: poLine.id, itemId: poLine.itemId,
      receivedQuantity, acceptedQuantity: receivedQuantity, rejectedQuantity: 0, unit: poLine.unit,
      unitCostIrr: poLine.unitPriceIrr, lineValueIrr,
    };
  });
  const receivedAt = input.receivedAt || input.receivedDate ? isoTimestamp(input.receivedAt || input.receivedDate, 'goods_receipt_date_invalid', 'زمان دریافت کالا باید تاریخ ISO معتبر همراه منطقهٔ زمانی باشد.') : now();
  const grn = {
    id: id(), number: `F2-GRN-${String(state.goodsReceipts.length + 1).padStart(6, '0')}`,
    purchaseOrderId: po.id, purchaseOrderNumber: po.number, branchId: po.branchId, vendorId: po.vendorId,
    deliveryNoteNumber, receivedAt, totalValueIrr, status: 'completed', lines,
    notes: String(input.notes || '').trim().slice(0, 300), createdBy: actor, createdAt: now(),
  };
  state.goodsReceipts.push(grn);
  for (const line of lines) {
    const poLine = po.lines.find((row) => row.id === line.purchaseOrderLineId);
    poLine.receivedQuantity += line.receivedQuantity;
    state.inventoryMovements.push({
      id: id(), branchId: po.branchId, itemId: line.itemId, movementType: 'goods_receipt', quantityBase: line.acceptedQuantity,
      unitCostIrr: line.unitCostIrr, totalCostIrr: line.lineValueIrr, goodsReceiptId: grn.id,
      source: 'purchase.goods_received', sourceId: grn.id, occurredAt: receivedAt, createdAt: now(), reversalOfId: null,
    });
    if (Array.isArray(db.accounting?.inventoryItems)) {
      const invItem = inventoryOperations.resolveInventoryItemForBranch(db.accounting?.inventoryItems, line.itemId, po.branchId);
      if (invItem) {
        const availBefore = orderCosting.physicalAvailable(invItem, state, po.branchId);
        const receivedQty = Number(line.acceptedQuantity || line.receivedQuantity || 0) || 0;
        const currentAvail = availBefore.ok ? availBefore.value : (Number(invItem.qtyOnHand || 0) + receivedQty);
        const prevQty = Math.max(0, currentAvail - receivedQty);
        const prevAvg = Number(invItem.avgCostIrr ?? invItem.unitCostIrr ?? invItem.cost ?? 0) || 0;
        const receivedCost = Number(line.lineValueIrr || (line.unitCostIrr * receivedQty) || 0) || 0;
        invItem.availableQuantity = currentAvail;
        if (currentAvail > 0 && receivedCost > 0) {
          invItem.avgCostIrr = Math.round(((prevQty * prevAvg) + receivedCost) / (prevQty + receivedQty));
        }
      }
    }
  }
  po.status = po.lines.every((line) => line.receivedQuantity >= line.quantity - 1e-9) ? 'received' : 'partially_received';
  const recorded = recordEvent(db, {
    source: 'purchase.goods_received', sourceId: grn.id, sourceVersion: 1, idempotencyKey: `grn:${grn.id}:v1`,
    branchId: po.branchId, occurredAt: receivedAt, amountIrr: totalValueIrr,
    payload: { purchaseOrderId: po.id, goodsReceiptNumber: grn.number, movementIds: state.inventoryMovements.filter((row) => row.goodsReceiptId === grn.id).map((row) => row.id) },
  });
  const costCenter = `branch:${po.branchId}`;
  const entry = postEventJournal(db, recorded.event, [
    { accountCode: '1610', debitIrr: totalValueIrr, creditIrr: 0, branchId: po.branchId, costCenter, memo: `دریافت کالا ${grn.number}` },
    { accountCode: '2120', debitIrr: 0, creditIrr: totalValueIrr, branchId: po.branchId, costCenter, counterpartyId: po.vendorId, memo: `کالای دریافت‌شده فاکتورنشده ${grn.number}` },
  ], `دریافت کالا از تأمین‌کننده ${po.vendorId} ـ ${grn.number}`, actor);
  return { goodsReceipt: grn, purchaseOrder: po, event: recorded.event, journalEntry: entry };
}

function vendorInvoiceJournalLines(invoice, goodsReceipt) {
  const costCenter = `branch:${invoice.branchId}`;
  const receiptValueIrr = list(invoice.lines).reduce((sum, line) => sum + Math.round(Number(line.invoicedQuantity) * int(line.receiptUnitCostIrr)), 0);
  const priceVarianceIrr = int(invoice.netAmountIrr) - receiptValueIrr;
  return [
    { accountCode: '2120', debitIrr: receiptValueIrr, creditIrr: 0, branchId: invoice.branchId, costCenter, counterpartyId: invoice.vendorId, memo: `تسویه کالای فاکتورنشده ${goodsReceipt.number}` },
    ...(priceVarianceIrr > 0 ? [{ accountCode: '5150', accountType: 'cogs', debitIrr: priceVarianceIrr, creditIrr: 0, branchId: invoice.branchId, costCenter, memo: 'اختلاف قیمت خرید تأییدشده' }] : []),
    ...(priceVarianceIrr < 0 ? [{ accountCode: '5150', accountType: 'cogs', debitIrr: 0, creditIrr: Math.abs(priceVarianceIrr), branchId: invoice.branchId, costCenter, memo: 'اختلاف قیمت خرید تأییدشده' }] : []),
    ...(invoice.vatIrr ? [{ accountCode: '1450', debitIrr: invoice.vatIrr, creditIrr: 0, branchId: invoice.branchId, costCenter, memo: `اعتبار مالیاتی فاکتور ${invoice.invoiceNumber}` }] : []),
    { accountCode: '2110', debitIrr: 0, creditIrr: invoice.totalIrr, branchId: invoice.branchId, costCenter, counterpartyId: invoice.vendorId, memo: `پرداختنی فاکتور ${invoice.invoiceNumber}` },
  ];
}

function postVendorInvoiceV2(db, invoice, actor) {
  const state = ensureFinanceV2(db);
  const goodsReceipt = state.goodsReceipts.find((row) => row.id === invoice.goodsReceiptId);
  const match = state.threeWayMatches.find((row) => row.vendorInvoiceId === invoice.id);
  const event = state.events.find((row) => row.source === 'purchase.vendor_invoice' && row.sourceId === invoice.id);
  if (!goodsReceipt || !match || !event) throw Object.assign(new Error('زنجیرهٔ تطبیق فاکتور کامل نیست.'), { code: 'three_way_match_chain_invalid', status: 409 });
  const periodCheck = validateOpenPeriod(db, invoice.invoiceDate, invoice.branchId);
  if (!periodCheck.ok) throw Object.assign(new Error(periodCheck.message), { code: periodCheck.code, status: 409 });
  event.status = 'pending';
  event.error = null;
  const entry = postEventJournal(db, event, vendorInvoiceJournalLines(invoice, goodsReceipt), `ثبت فاکتور تأمین‌کننده ${invoice.invoiceNumber}`, actor);
  if (!entry) throw Object.assign(new Error('سند فاکتور تأمین‌کننده پست نشد.'), { code: 'vendor_invoice_post_failed', status: 409 });
  invoice.journalEntryId = entry.id;
  return { journalEntry: entry, event, match };
}

function createVendorInvoiceV2(db, input, actor) {
  ensureFinanceV2(db);
  return withFinanceAtomicity(db, () => createVendorInvoiceV2Atomic(db, input, actor), {
    keys: ['vendorInvoices', 'threeWayMatches', 'events', 'journalEntries', 'idempotency'],
  });
}

function createVendorInvoiceV2Atomic(db, input, actor) {
  const state = ensureFinanceV2(db);
  const grn = state.goodsReceipts.find((row) => row.id === String(input.goodsReceiptId || input.grnId || ''));
  if (!grn) throw Object.assign(new Error('رسید کالای V2 یافت نشد.'), { code: 'goods_receipt_not_found', status: 404 });
  const po = state.purchaseOrders.find((row) => row.id === grn.purchaseOrderId);
  if (!po) throw Object.assign(new Error('سفارش خرید متصل یافت نشد.'), { code: 'purchase_order_not_found', status: 404 });
  if (Number(po.branchId) !== Number(grn.branchId)) {
    throw Object.assign(new Error('شعبهٔ سفارش خرید و رسید کالا یکسان نیست.'), { code: 'purchase_chain_branch_mismatch', status: 409 });
  }
  const invoiceNumber = String(input.invoiceNumber || '').trim().slice(0, 120);
  if (!invoiceNumber) throw Object.assign(new Error('شماره فاکتور تأمین‌کننده الزامی است.'), { code: 'vendor_invoice_number_missing' });
  if (state.vendorInvoices.some((row) => row.vendorId === grn.vendorId && row.invoiceNumber.toLowerCase() === invoiceNumber.toLowerCase())) {
    throw Object.assign(new Error('این شماره فاکتور برای تأمین‌کننده قبلاً ثبت شده است.'), { code: 'vendor_invoice_duplicate', status: 409 });
  }
  const rawLines = list(input.lines);
  if (!rawLines.length) throw Object.assign(new Error('ردیف‌های فاکتور الزامی است.'), { code: 'vendor_invoice_lines_missing' });
  let netAmountIrr = 0;
  let receiptValueIrr = 0;
  let quantityVariance = 0;
  let unbilledReceiptQuantity = 0;
  const seenReceiptLineIds = new Set();
  const lines = rawLines.map((line, index) => {
    const receiptLine = grn.lines.find((row) => row.id === String(line.goodsReceiptLineId || line.receiptLineId || ''));
    if (!receiptLine) throw Object.assign(new Error(`ردیف ${index + 1} به رسید کالا متصل نیست.`), { code: 'goods_receipt_line_not_found' });
    if (seenReceiptLineIds.has(receiptLine.id)) throw Object.assign(new Error(`ردیف رسید ${index + 1} در همین فاکتور تکرار شده است.`), { code: 'vendor_invoice_duplicate_receipt_line' });
    seenReceiptLineIds.add(receiptLine.id);
    const invoicedQuantity = positiveQuantity(line.invoicedQuantity ?? line.quantity ?? line.qty);
    const previouslyInvoiced = state.vendorInvoices
      .filter((row) => !['match_rejected', 'cancelled', 'reversed'].includes(row.status))
      .flatMap((row) => row.lines || []).filter((row) => row.goodsReceiptLineId === receiptLine.id)
      .reduce((sum, row) => sum + Number(row.invoicedQuantity || 0), 0);
    const remainingReceived = receiptLine.acceptedQuantity - previouslyInvoiced;
    if (invoicedQuantity > remainingReceived + 1e-9) throw Object.assign(new Error(`مقدار فاکتور ردیف ${index + 1} از دریافت فاکتورنشده بیشتر است.`), { code: 'vendor_invoice_over_received_quantity' });
    const unitPriceIrr = safeIrr(line.unitPriceIrr, 'unit_price_irr_invalid');
    if (unitPriceIrr <= 0) throw Object.assign(new Error(`قیمت واحد فاکتور ردیف ${index + 1} باید بزرگ‌تر از صفر باشد.`), { code: 'vendor_invoice_unit_price_invalid' });
    const lineTotalIrr = Math.round(invoicedQuantity * unitPriceIrr);
    if (!Number.isSafeInteger(lineTotalIrr)) throw Object.assign(new Error('جمع ردیف فاکتور از محدودهٔ امن خارج است.'), { code: 'vendor_invoice_line_total_unsafe' });
    const receiptLineValueIrr = Math.round(invoicedQuantity * receiptLine.unitCostIrr);
    const lineQuantityVariance = 0;
    netAmountIrr += lineTotalIrr;
    receiptValueIrr += receiptLineValueIrr;
    quantityVariance += lineQuantityVariance;
    const remainingAfterInvoice = Math.max(0, remainingReceived - invoicedQuantity);
    unbilledReceiptQuantity += remainingAfterInvoice;
    return {
      id: id(), lineNo: index + 1, goodsReceiptLineId: receiptLine.id, purchaseOrderLineId: receiptLine.purchaseOrderLineId,
      itemId: receiptLine.itemId, invoicedQuantity, unit: receiptLine.unit, unitPriceIrr, lineTotalIrr,
      receivedQuantity: receiptLine.acceptedQuantity, previouslyInvoicedQuantity: previouslyInvoiced, receiptUnitCostIrr: receiptLine.unitCostIrr,
      quantityVariance: lineQuantityVariance, remainingUnbilledQuantity: remainingAfterInvoice, priceVarianceIrr: lineTotalIrr - receiptLineValueIrr,
    };
  });
  const vatIrr = safeIrr(input.vatIrr ?? 0, 'vat_irr_invalid');
  const totalIrr = netAmountIrr + vatIrr;
  const suppliedTotal = input.totalIrr == null ? totalIrr : safeIrr(input.totalIrr, 'invoice_total_irr_invalid');
  if (suppliedTotal !== totalIrr) throw Object.assign(new Error('جمع فاکتور با ردیف‌ها و مالیات برابر نیست.'), { code: 'vendor_invoice_total_mismatch' });
  const invoiceDate = input.invoiceDate || input.date
    ? isoTimestamp(input.invoiceDate || input.date, 'vendor_invoice_date_invalid', 'زمان فاکتور تأمین‌کننده باید تاریخ ISO معتبر همراه منطقهٔ زمانی باشد.')
    : now();
  const dueDate = optionalCalendarDate(input.dueDate, 'vendor_invoice_due_date_invalid', 'سررسید فاکتور تأمین‌کننده باید تاریخ تقویمی معتبر یا timestamp ISO همراه منطقهٔ زمانی باشد.');
  if (dueDate && dueDate < tehranDateKey(invoiceDate)) {
    throw Object.assign(new Error('سررسید فاکتور نمی‌تواند قبل از تاریخ فاکتور باشد.'), { code: 'vendor_invoice_due_date_before_invoice', status: 400 });
  }
  const priceVarianceIrr = netAmountIrr - receiptValueIrr;
  const matched = Math.abs(quantityVariance) <= 1e-9 && priceVarianceIrr === 0;
  const invoice = {
    id: id(), number: `F2-INV-${String(state.vendorInvoices.length + 1).padStart(6, '0')}`,
    invoiceNumber, vendorId: grn.vendorId, branchId: grn.branchId, purchaseOrderId: po.id, goodsReceiptId: grn.id,
    invoiceDate, dueDate,
    netAmountIrr, vatIrr, totalIrr, paidAmountIrr: 0, status: matched ? 'open' : 'match_exception',
    matchStatus: matched ? 'matched' : 'exception', quantityVariance, unbilledReceiptQuantity, quantityCoverage: unbilledReceiptQuantity > 1e-9 ? 'partial_invoice' : 'fully_invoiced_receipt', priceVarianceIrr, lines,
    journalEntryId: null, reversalJournalEntryId: null, reversedBy: null, reversedAt: null,
    createdBy: actor, createdAt: now(),
  };
  state.vendorInvoices.push(invoice);
  const match = {
    id: id(), purchaseOrderId: po.id, goodsReceiptId: grn.id, vendorInvoiceId: invoice.id,
    status: invoice.matchStatus, quantityVariance, unbilledReceiptQuantity, quantityCoverage: invoice.quantityCoverage, priceVarianceIrr, receiptValueIrr, invoiceNetIrr: netAmountIrr,
    calculatedAt: now(),
  };
  state.threeWayMatches.push(match);
  const recorded = recordEvent(db, {
    source: 'purchase.vendor_invoice', sourceId: invoice.id, sourceVersion: 1, idempotencyKey: `vendor-invoice:${invoice.id}:v1`,
    branchId: invoice.branchId, occurredAt: invoice.invoiceDate, amountIrr: totalIrr,
    payload: { purchaseOrderId: po.id, goodsReceiptId: grn.id, invoiceNumber, match },
    status: matched ? 'pending' : 'blocked',
    error: matched ? null : { code: 'three_way_match_variance', message: 'اختلاف مقدار یا قیمت باید قبل از ثبت پرداختنی بررسی شود.', details: match },
  });
  let entry = null;
  if (matched) {
    entry = postVendorInvoiceV2(db, invoice, actor).journalEntry;
  }
  return { vendorInvoice: invoice, threeWayMatch: match, event: recorded.event, journalEntry: entry };
}

function requestVendorInvoiceMatchReview(db, invoiceId, input, actor) {
  ensureFinanceV2(db);
  return withFinanceAtomicity(db, () => requestVendorInvoiceMatchReviewAtomic(db, invoiceId, input, actor), { keys: ['vendorInvoices', 'threeWayMatches', 'approvals'] });
}

function requestVendorInvoiceMatchReviewAtomic(db, invoiceId, input, actor) {
  const state = ensureFinanceV2(db);
  const invoice = state.vendorInvoices.find((row) => row.id === String(invoiceId));
  if (!invoice) throw Object.assign(new Error('فاکتور تأمین‌کننده یافت نشد.'), { code: 'vendor_invoice_not_found', status: 404 });
  if (invoice.status !== 'match_exception' || invoice.matchStatus !== 'exception') throw Object.assign(new Error('این فاکتور اختلاف باز برای بررسی ندارد.'), { code: 'three_way_match_not_reviewable', status: 409 });
  const match = state.threeWayMatches.find((row) => row.vendorInvoiceId === invoice.id);
  if (!match || match.status !== 'exception') throw Object.assign(new Error('رکورد اختلاف تطبیق یافت نشد.'), { code: 'three_way_match_not_found', status: 404 });
  const existing = state.approvals.find((row) => row.entityType === 'vendor_invoice_match' && row.entityId === invoice.id && row.status === 'pending');
  if (existing) return { vendorInvoice: invoice, threeWayMatch: match, approval: existing, idempotentReplay: true };
  const reason = String(input.reason || input.comment || '').trim().slice(0, 300);
  if (reason.length < 5) throw Object.assign(new Error('علت درخواست بررسی اختلاف الزامی است.'), { code: 'three_way_match_reason_required' });
  const evidenceReference = String(input.evidenceReference || '').trim().slice(0, 160) || null;
  const approval = {
    id: id(), operation: 'resolve_three_way_match_variance', entityType: 'vendor_invoice_match', entityId: invoice.id,
    amountIrr: Math.abs(int(invoice.priceVarianceIrr)), status: 'pending', createdBy: actor, createdAt: now(), decidedBy: null, decidedAt: null,
    history: [{ action: 'submitted', by: actor, at: now(), comment: reason, evidenceReference }],
  };
  state.approvals.push(approval);
  invoice.matchReview = { status: 'pending_approval', approvalId: approval.id, requestedBy: actor, requestedAt: approval.createdAt, reason, evidenceReference };
  match.reviewStatus = 'pending_approval';
  match.reviewApprovalId = approval.id;
  return { vendorInvoice: invoice, threeWayMatch: match, approval, idempotentReplay: false };
}

function requestSupplierPaymentV2(db, invoiceId, input, actor) {
  ensureFinanceV2(db);
  return withFinanceAtomicity(db, () => requestSupplierPaymentV2Atomic(db, invoiceId, input, actor), { keys: ['vendorInvoices', 'supplierPayments', 'approvals'] });
}

function requestSupplierPaymentV2Atomic(db, invoiceId, input, actor) {
  const state = ensureFinanceV2(db);
  const invoice = state.vendorInvoices.find((row) => String(row.id) === String(invoiceId));
  if (!invoice) throw Object.assign(new Error('فاکتور تأمین‌کننده یافت نشد.'), { code: 'vendor_invoice_not_found', status: 404 });
  if (!['open', 'partially_paid'].includes(invoice.status)) throw Object.assign(new Error('فاکتور در وضعیت قابل پرداخت نیست؛ اختلاف تطبیق باید ابتدا تعیین تکلیف شود.'), { code: invoice.status === 'match_exception' ? 'three_way_match_required' : 'vendor_invoice_not_payable', status: 409 });
  const invoiceBranchId = branchDimension(invoice);
  const requestedBranchId = branchDimension(input?.branchId);
  if (!invoiceBranchId) throw Object.assign(new Error('شعبهٔ فاکتور تأمین‌کننده مشخص نیست.'), { code: 'supplier_payment_branch_missing', status: 409 });
  if (requestedBranchId && requestedBranchId !== invoiceBranchId) {
    throw Object.assign(new Error('فاکتور تأمین‌کننده به شعبهٔ فعال تعلق ندارد.'), { code: 'supplier_payment_branch_mismatch', status: 409 });
  }
  const invoiceTotalIrr = safeIrr(invoice.totalIrr, 'vendor_invoice_total_invalid');
  const paidAmountIrr = safeIrr(invoice.paidAmountIrr ?? 0, 'vendor_invoice_paid_amount_invalid');
  if (paidAmountIrr > invoiceTotalIrr) throw Object.assign(new Error('مبلغ پرداخت‌شدهٔ فاکتور از مبلغ کل بیشتر است.'), { code: 'vendor_invoice_paid_amount_exceeds_total', status: 409 });
  const pendingAmountIrr = state.supplierPayments.filter((row) => row.vendorInvoiceId === invoice.id && row.status === 'pending_approval')
    .reduce((sum, row) => sum + safeIrr(row.amountIrr, 'supplier_payment_existing_amount_invalid'), 0);
  const remainingIrr = invoiceTotalIrr - paidAmountIrr - pendingAmountIrr;
  const amountIrr = safeIrr(input.amountIrr, 'payment_amount_irr_invalid');
  if (amountIrr <= 0 || amountIrr > remainingIrr) throw Object.assign(new Error('مبلغ پرداخت از ماندهٔ قابل پرداخت بیشتر است یا معتبر نیست.'), { code: 'supplier_payment_amount_invalid' });
  const method = String(input.paymentMethod || 'bank').toLowerCase();
  if (!['bank', 'cash', 'petty_cash'].includes(method)) throw Object.assign(new Error('روش پرداخت معتبر نیست.'), { code: 'supplier_payment_method_invalid' });
  const paymentDate = input.paymentDate || input.date
    ? isoTimestamp(input.paymentDate || input.date, 'supplier_payment_date_invalid', 'زمان پرداخت تأمین‌کننده باید تاریخ ISO معتبر همراه منطقهٔ زمانی باشد.')
    : now();
  const payment = {
    id: id(), vendorInvoiceId: invoice.id, vendorId: invoice.vendorId, branchId: invoice.branchId,
    amountIrr, paymentMethod: method, paymentDate, reference: String(input.reference || '').trim().slice(0, 160) || null,
    status: 'pending_approval', createdBy: actor, createdAt: now(), approvedBy: null, approvedAt: null, journalEntryId: null, approvalId: null,
    reversalJournalEntryId: null, reversedBy: null, reversedAt: null,
  };
  state.supplierPayments.push(payment);
  const approval = {
    id: id(), operation: 'approve_supplier_payment', entityType: 'supplier_payment', entityId: payment.id,
    amountIrr, status: 'pending', createdBy: actor, createdAt: now(), decidedBy: null, decidedAt: null,
    history: [{ action: 'submitted', by: actor, at: now(), comment: input.note || null }],
  };
  state.approvals.push(approval);
  return { supplierPayment: payment, approval };
}

function createCostCommitment(db, input, actor) {
  ensureFinanceV2(db);
  return withFinanceAtomicity(db, () => createCostCommitmentAtomic(db, input, actor), {
    keys: ['costCommitments'],
  });
}

function createCostCommitmentAtomic(db, input, actor) {
  const state = ensureFinanceV2(db);
  const branchId = Number(input.branchId) || null;
  if (!branchId) throw Object.assign(new Error('شعبهٔ تعهد هزینه الزامی است.'), { code: 'cost_commitment_branch_required' });
  const branches = list(db.branches);
  if (branches.length && !branches.some((branch) => Number(branch.id) === branchId && branch.active !== false)) {
    throw Object.assign(new Error('شعبهٔ تعهد هزینه یافت نشد یا فعال نیست.'), { code: 'cost_commitment_branch_not_found', status: 404 });
  }
  const name = String(input.name || '').trim().slice(0, 160);
  if (name.length < 2) throw Object.assign(new Error('عنوان تعهد هزینه الزامی است.'), { code: 'cost_commitment_name_required' });
  const type = String(input.type || '');
  const policy = COST_COMMITMENT_TYPES[type];
  if (!policy) throw Object.assign(new Error('نوع هزینهٔ دوره‌ای معتبر نیست.'), { code: 'cost_commitment_type_invalid' });
  const monthlyAmountIrr = safeIrr(input.monthlyAmountIrr, 'cost_commitment_amount_invalid');
  if (!monthlyAmountIrr) throw Object.assign(new Error('مبلغ ماهانه باید بزرگ‌تر از صفر باشد.'), { code: 'cost_commitment_amount_invalid' });
  const startDate = valueContracts.requireDateOnly(input.startDate, {
    code: 'cost_commitment_date_invalid', message: 'بازهٔ فعال تعهد هزینه معتبر نیست.',
  });
  const endDate = input.endDate ? valueContracts.requireDateOnly(input.endDate, {
    code: 'cost_commitment_date_invalid', message: 'بازهٔ فعال تعهد هزینه معتبر نیست.',
  }) : null;
  const start = new Date(`${startDate}T12:00:00.000Z`);
  const end = endDate ? new Date(`${endDate}T12:00:00.000Z`) : null;
  if (!Number.isFinite(start.getTime()) || (end && (!Number.isFinite(end.getTime()) || end < start))) {
    throw Object.assign(new Error('بازهٔ فعال تعهد هزینه معتبر نیست.'), { code: 'cost_commitment_date_invalid' });
  }
  const commitment = {
    id: id(), branchId, name, type, frequency: 'monthly', monthlyAmountIrr,
    expenseAccount: policy.expenseAccount, liabilityAccount: policy.liabilityAccount, behavior: policy.behavior,
    counterpartyId: String(input.counterpartyId || '').trim().slice(0, 160) || null,
    startDate, endDate, status: 'active', notes: String(input.notes || '').trim().slice(0, 300) || null,
    createdBy: actor, createdAt: now(), deactivatedBy: null, deactivatedAt: null,
  };
  state.costCommitments.push(commitment);
  return commitment;
}

function deactivateCostCommitment(db, commitmentId, actor) {
  ensureFinanceV2(db);
  return withFinanceAtomicity(db, () => deactivateCostCommitmentAtomic(db, commitmentId, actor), {
    keys: ['costCommitments'],
  });
}

function deactivateCostCommitmentAtomic(db, commitmentId, actor) {
  const commitment = ensureFinanceV2(db).costCommitments.find((row) => row.id === commitmentId);
  if (!commitment) throw Object.assign(new Error('تعهد هزینه یافت نشد.'), { code: 'cost_commitment_not_found', status: 404 });
  if (commitment.status === 'inactive') return { commitment, idempotentReplay: true };
  commitment.status = 'inactive'; commitment.deactivatedBy = actor; commitment.deactivatedAt = now();
  return { commitment, idempotentReplay: false };
}

function createCostAccrual(db, commitmentId, input, actor) {
  ensureFinanceV2(db);
  return withFinanceAtomicity(db, () => createCostAccrualAtomic(db, commitmentId, input, actor), {
    keys: ['journalEntries', 'approvals', 'costAccruals'],
  });
}

function createCostAccrualAtomic(db, commitmentId, input, actor) {
  const state = ensureFinanceV2(db);
  const commitment = state.costCommitments.find((row) => row.id === commitmentId);
  if (!commitment) throw Object.assign(new Error('تعهد هزینه یافت نشد.'), { code: 'cost_commitment_not_found', status: 404 });
  if (commitment.status !== 'active') throw Object.assign(new Error('تعهد هزینه غیرفعال است.'), { code: 'cost_commitment_inactive', status: 409 });
  const postingDate = valueContracts.requireDateOnly(input.postingDate, {
    code: 'cost_accrual_date_invalid', message: 'تاریخ ثبت دوره‌ای معتبر نیست.',
  });
  const postingAt = new Date(`${postingDate}T12:00:00.000Z`);
  if (!Number.isFinite(postingAt.getTime())) throw Object.assign(new Error('تاریخ ثبت دوره‌ای معتبر نیست.'), { code: 'cost_accrual_date_invalid' });
  if (postingDate < commitment.startDate || (commitment.endDate && postingDate > commitment.endDate)) {
    throw Object.assign(new Error('تاریخ ثبت خارج از بازهٔ فعال تعهد است.'), { code: 'cost_accrual_outside_commitment_range', status: 409 });
  }
  const serviceMonth = postingDate.slice(0, 7);
  if (state.costAccruals.some((row) => row.costCommitmentId === commitment.id && row.serviceMonth === serviceMonth && !['rejected', 'reversed'].includes(row.status))) {
    throw Object.assign(new Error('این تعهد برای ماه انتخاب‌شده قبلاً ثبت یا ارسال شده است.'), { code: 'cost_accrual_period_duplicate', status: 409 });
  }
  if (!state.fiscalPeriods.length) {
    throw Object.assign(new Error('برای ثبت هزینهٔ دوره‌ای باید دورهٔ مالی V2 تعریف شده باشد؛ دورهٔ میراثی فقط خواندنی است.'), { code: 'cost_accrual_v2_period_required', status: 409 });
  }
  const periodCheck = validateOpenPeriod(db, postingAt.toISOString(), commitment.branchId);
  if (!periodCheck.ok) throw Object.assign(new Error(periodCheck.message), { code: periodCheck.code, status: 409 });
  const amountIrr = input.amountIrr == null ? commitment.monthlyAmountIrr : safeIrr(input.amountIrr, 'cost_accrual_amount_invalid');
  if (!amountIrr) throw Object.assign(new Error('مبلغ ثبت دوره‌ای باید بزرگ‌تر از صفر باشد.'), { code: 'cost_accrual_amount_invalid' });
  const overrideReason = String(input.overrideReason || '').trim().slice(0, 300) || null;
  if (amountIrr !== commitment.monthlyAmountIrr && !overrideReason) {
    throw Object.assign(new Error('برای مبلغ متفاوت با تعهد ماهانه، علت تغییر الزامی است.'), { code: 'cost_accrual_override_reason_required' });
  }
  const accrualId = id();
  const description = `ثبت دوره‌ای ${commitment.name} ـ ${serviceMonth}`;
  const costCenter = `branch:${commitment.branchId}`;
  const journalEntry = createDraft(db, {
    date: postingAt.toISOString(), branchId: commitment.branchId, costCenter, description,
    lines: [
      { accountCode: commitment.expenseAccount, accountType: 'expense', debitIrr: amountIrr, creditIrr: 0, branchId: commitment.branchId, costCenter, counterpartyId: commitment.counterpartyId, memo: description },
      { accountCode: commitment.liabilityAccount, debitIrr: 0, creditIrr: amountIrr, branchId: commitment.branchId, costCenter, counterpartyId: commitment.counterpartyId, memo: `تعهد پرداخت ${commitment.name}` },
    ],
  }, actor);
  journalEntry.source = 'expense.accrual'; journalEntry.sourceId = accrualId;
  const submitted = submitDraft(db, journalEntry.id, actor);
  submitted.approval.operation = 'approve_cost_accrual';
  const accrual = {
    id: accrualId, costCommitmentId: commitment.id, branchId: commitment.branchId, serviceMonth,
    postingDate: postingAt.toISOString(), fiscalPeriodId: periodCheck.period.id, amountIrr,
    expenseAccount: commitment.expenseAccount, liabilityAccount: commitment.liabilityAccount,
    overrideReason, status: 'pending_approval', paidAmountIrr: 0,
    journalEntryId: journalEntry.id, approvalId: submitted.approval.id,
    createdBy: actor, createdAt: now(), postedBy: null, postedAt: null,
  };
  state.costAccruals.push(accrual);
  return { commitment, accrual, journalEntry, approval: submitted.approval };
}

function requestCostAccrualPayment(db, accrualId, input, actor) {
  ensureFinanceV2(db);
  return withFinanceAtomicity(db, () => requestCostAccrualPaymentAtomic(db, accrualId, input, actor), {
    keys: ['costPayments', 'approvals'],
  });
}

function requestCostAccrualPaymentAtomic(db, accrualId, input, actor) {
  const state = ensureFinanceV2(db);
  const accrual = state.costAccruals.find((row) => row.id === accrualId);
  if (!accrual) throw Object.assign(new Error('ثبت دوره‌ای هزینه یافت نشد.'), { code: 'cost_accrual_not_found', status: 404 });
  if (!['posted', 'partially_paid'].includes(accrual.status)) throw Object.assign(new Error('فقط هزینهٔ قطعی و پرداخت‌نشده قابل پرداخت است.'), { code: 'cost_accrual_not_payable', status: 409 });
  const pendingIrr = state.costPayments.filter((row) => row.costAccrualId === accrual.id && row.status === 'pending_approval').reduce((sum, row) => sum + int(row.amountIrr), 0);
  const remainingIrr = accrual.amountIrr - int(accrual.paidAmountIrr) - pendingIrr;
  const amountIrr = safeIrr(input.amountIrr, 'cost_payment_amount_invalid');
  if (!amountIrr || amountIrr > remainingIrr) throw Object.assign(new Error('مبلغ پرداخت از ماندهٔ تعهد بیشتر است یا معتبر نیست.'), { code: 'cost_payment_amount_invalid' });
  const paymentMethod = String(input.paymentMethod || 'bank').toLowerCase();
  if (!['bank', 'cash', 'petty_cash'].includes(paymentMethod)) throw Object.assign(new Error('روش پرداخت معتبر نیست.'), { code: 'cost_payment_method_invalid' });
  const paymentDate = input.paymentDate
    ? isoTimestamp(input.paymentDate, 'cost_payment_date_invalid', 'زمان پرداخت هزینه باید تاریخ ISO معتبر همراه منطقهٔ زمانی باشد.')
    : now();
  const payment = {
    id: id(), costAccrualId: accrual.id, costCommitmentId: accrual.costCommitmentId, branchId: accrual.branchId,
    amountIrr, paymentMethod, paymentDate, reference: String(input.reference || '').trim().slice(0, 160) || null,
    status: 'pending_approval', createdBy: actor, createdAt: now(), approvedBy: null, approvedAt: null, journalEntryId: null,
  };
  state.costPayments.push(payment);
  const approval = {
    id: id(), operation: 'approve_cost_payment', entityType: 'cost_payment', entityId: payment.id,
    amountIrr, status: 'pending', createdBy: actor, createdAt: now(), decidedBy: null, decidedAt: null,
    history: [{ action: 'submitted', by: actor, at: now(), comment: input.note || null }],
  };
  state.approvals.push(approval);
  payment.approvalId = approval.id;
  return { payment, approval, accrual };
}

function createFixedAssetV2(db, input, actor) {
  ensureFinanceV2(db);
  return withFinanceAtomicity(db, () => createFixedAssetV2Atomic(db, input, actor), {
    keys: ['journalEntries', 'approvals', 'fixedAssets'],
  });
}

function createFixedAssetV2Atomic(db, input, actor) {
  const state = ensureFinanceV2(db);
  const branchId = Number(input.branchId) || null;
  if (!branchId) throw Object.assign(new Error('شعبهٔ دارایی الزامی است.'), { code: 'fixed_asset_branch_required' });
  const branches = list(db.branches);
  if (branches.length && !branches.some((branch) => Number(branch.id) === branchId && branch.active !== false)) {
    throw Object.assign(new Error('شعبهٔ دارایی یافت نشد یا فعال نیست.'), { code: 'fixed_asset_branch_not_found', status: 404 });
  }
  if (!state.fiscalPeriods.length) throw Object.assign(new Error('برای ثبت دارایی باید دورهٔ مالی V2 تعریف شده باشد؛ دادهٔ دارایی میراثی فقط خواندنی است.'), { code: 'fixed_asset_v2_period_required', status: 409 });
  const name = String(input.name || '').trim().slice(0, 160);
  if (name.length < 2) throw Object.assign(new Error('نام دارایی الزامی است.'), { code: 'fixed_asset_name_required' });
  const category = String(input.category || 'kitchen_bar');
  const categoryPolicy = FIXED_ASSET_ACCOUNTS[category];
  if (!categoryPolicy) throw Object.assign(new Error('گروه دارایی معتبر نیست.'), { code: 'fixed_asset_category_invalid' });
  const fundingMethod = String(input.fundingMethod || 'bank');
  const fundingPolicy = ASSET_FUNDING_METHODS[fundingMethod];
  if (!fundingPolicy) throw Object.assign(new Error('روش تأمین وجه دارایی معتبر نیست.'), { code: 'fixed_asset_funding_invalid' });
  const purchaseCostIrr = safeIrr(input.purchaseCostIrr, 'fixed_asset_cost_invalid');
  const salvageValueIrr = safeIrr(input.salvageValueIrr || 0, 'fixed_asset_salvage_invalid');
  if (!purchaseCostIrr || salvageValueIrr >= purchaseCostIrr) throw Object.assign(new Error('بهای خرید باید مثبت و ارزش اسقاط کمتر از بهای خرید باشد.'), { code: 'fixed_asset_cost_invalid' });
  const usefulLifeMonths = Number(input.usefulLifeMonths);
  if (!Number.isInteger(usefulLifeMonths) || usefulLifeMonths < 1 || usefulLifeMonths > 600) throw Object.assign(new Error('عمر مفید باید بین ۱ تا ۶۰۰ ماه باشد.'), { code: 'fixed_asset_life_invalid' });
  const purchaseDate = String(input.purchaseDate || '').slice(0, 10);
  const inServiceDate = String(input.inServiceDate || purchaseDate).slice(0, 10);
  const purchasedAt = new Date(`${purchaseDate}T12:00:00.000Z`);
  const serviceAt = new Date(`${inServiceDate}T12:00:00.000Z`);
  if (!Number.isFinite(purchasedAt.getTime()) || !Number.isFinite(serviceAt.getTime()) || serviceAt < purchasedAt) throw Object.assign(new Error('تاریخ خرید/بهره‌برداری معتبر نیست.'), { code: 'fixed_asset_date_invalid' });
  const periodCheck = validateOpenPeriod(db, purchasedAt.toISOString(), branchId);
  if (!periodCheck.ok) throw Object.assign(new Error(periodCheck.message), { code: periodCheck.code, status: 409 });
  const sourceReference = String(input.sourceReference || '').trim().slice(0, 160);
  if (sourceReference.length < 3) throw Object.assign(new Error('شماره فاکتور، قرارداد یا مرجع خرید الزامی است.'), { code: 'fixed_asset_source_reference_required' });
  const assetCode = String(input.assetCode || `AST-F2-${String(state.fixedAssets.length + 1).padStart(4, '0')}`).trim().toUpperCase().slice(0, 40);
  if (!/^[A-Z0-9_-]{3,40}$/.test(assetCode)) throw Object.assign(new Error('کد دارایی باید ۳ تا ۴۰ نویسهٔ لاتین، عدد، خط تیره یا زیرخط باشد.'), { code: 'fixed_asset_code_invalid' });
  if (state.fixedAssets.some((row) => row.branchId === branchId && row.assetCode === assetCode && row.status !== 'rejected')) {
    throw Object.assign(new Error('کد دارایی در این شعبه تکراری است.'), { code: 'fixed_asset_code_duplicate', status: 409 });
  }
  const assetId = id();
  const description = `خرید دارایی ${assetCode} ـ ${name}`;
  const costCenter = `branch:${branchId}`;
  const journalEntry = createDraft(db, {
    date: purchasedAt.toISOString(), branchId, costCenter, description,
    lines: [
      { accountCode: categoryPolicy.accountCode, accountType: 'asset', debitIrr: purchaseCostIrr, creditIrr: 0, branchId, costCenter, assetId, memo: `${description} · مرجع ${sourceReference}` },
      { accountCode: fundingPolicy.accountCode, accountType: 'asset', debitIrr: 0, creditIrr: purchaseCostIrr, branchId, costCenter, paymentMethod: fundingMethod, assetId, memo: fundingPolicy.label },
    ],
  }, actor);
  journalEntry.source = 'asset.acquisition'; journalEntry.sourceId = assetId;
  const submitted = submitDraft(db, journalEntry.id, actor);
  submitted.approval.operation = 'approve_asset_acquisition';
  const asset = {
    id: assetId, branchId, assetCode, name, category, assetAccount: categoryPolicy.accountCode,
    fundingMethod, fundingAccount: fundingPolicy.accountCode, sourceReference,
    purchaseDate, inServiceDate, purchaseCostIrr, salvageValueIrr, usefulLifeMonths,
    depreciationMethod: 'straight_line', depreciationConvention: 'full_month', accumulatedDepreciationIrr: 0,
    status: 'pending_approval', acquisitionJournalEntryId: journalEntry.id, acquisitionApprovalId: submitted.approval.id,
    createdBy: actor, createdAt: now(), approvedBy: null, approvedAt: null,
  };
  state.fixedAssets.push(asset);
  return { asset, journalEntry, approval: submitted.approval };
}

function previewDepreciationV2(db, input = {}) {
  const state = ensureFinanceV2(db);
  const branchId = input.branchId ? Number(input.branchId) : null;
  const postingDate = String(input.postingDate || now()).slice(0, 10);
  const postingAt = new Date(`${postingDate}T12:00:00.000Z`);
  if (!Number.isFinite(postingAt.getTime())) throw Object.assign(new Error('تاریخ محاسبه استهلاک معتبر نیست.'), { code: 'depreciation_date_invalid' });
  const serviceMonth = postingDate.slice(0, 7);
  const alreadyProcessedAssetIds = new Set(state.depreciationRuns
    .filter((run) => run.serviceMonth === serviceMonth && !['rejected', 'reversed'].includes(run.status))
    .flatMap((run) => list(run.lines).map((line) => line.assetId)));
  const lines = state.fixedAssets
    .filter((asset) => asset.status === 'active' && sameBranch(asset, branchId) && asset.inServiceDate.slice(0, 7) <= serviceMonth && !alreadyProcessedAssetIds.has(asset.id))
    .map((asset) => {
      const depreciableBaseIrr = int(asset.purchaseCostIrr) - int(asset.salvageValueIrr);
      const remainingIrr = Math.max(0, depreciableBaseIrr - int(asset.accumulatedDepreciationIrr));
      const scheduledIrr = Math.max(1, Math.round(depreciableBaseIrr / Number(asset.usefulLifeMonths)));
      const amountIrr = Math.min(scheduledIrr, remainingIrr);
      return { assetId: asset.id, assetCode: asset.assetCode, assetName: asset.name, amountIrr, accumulatedBeforeIrr: int(asset.accumulatedDepreciationIrr), remainingBeforeIrr: remainingIrr };
    })
    .filter((line) => line.amountIrr > 0);
  return {
    status: lines.length ? 'available' : 'insufficient_data', branchId, postingDate, serviceMonth,
    method: 'straight_line', convention: 'full_month', lines,
    totalDepreciationIrr: lines.reduce((sum, line) => sum + int(line.amountIrr), 0),
    skippedAlreadyProcessed: alreadyProcessedAssetIds.size,
    message: lines.length ? null : 'دارایی فعال و مستهلک‌نشده‌ای برای این ماه وجود ندارد یا ماه قبلاً ثبت شده است.',
  };
}

function createDepreciationRunV2(db, input, actor) {
  ensureFinanceV2(db);
  return withFinanceAtomicity(db, () => createDepreciationRunV2Atomic(db, input, actor), {
    keys: ['journalEntries', 'approvals', 'depreciationRuns'],
  });
}

function createDepreciationRunV2Atomic(db, input, actor) {
  const state = ensureFinanceV2(db);
  if (!Number(input.branchId)) throw Object.assign(new Error('شعبهٔ ثبت استهلاک الزامی است.'), { code: 'depreciation_branch_required' });
  const branchId = Number(input.branchId);
  const branches = list(db.branches);
  if (branches.length && !branches.some((branch) => Number(branch.id) === branchId && branch.active !== false)) {
    throw Object.assign(new Error('شعبهٔ ثبت استهلاک یافت نشد یا فعال نیست.'), { code: 'depreciation_branch_not_found', status: 404 });
  }
  if (!state.fiscalPeriods.length) throw Object.assign(new Error('برای ثبت استهلاک باید دورهٔ مالی V2 تعریف شده باشد.'), { code: 'depreciation_v2_period_required', status: 409 });
  const preview = previewDepreciationV2(db, input);
  if (preview.status !== 'available' || !preview.lines.length) throw Object.assign(new Error(preview.message), { code: 'depreciation_no_eligible_assets', status: 409 });
  const periodCheck = validateOpenPeriod(db, `${preview.postingDate}T12:00:00.000Z`, preview.branchId);
  if (!periodCheck.ok) throw Object.assign(new Error(periodCheck.message), { code: periodCheck.code, status: 409 });
  const runId = id();
  const costCenter = `branch:${preview.branchId}`;
  const description = `استهلاک ماهانه دارایی‌ها ـ ${preview.serviceMonth}`;
  const journalLines = preview.lines.flatMap((line) => [
    { accountCode: '6980', accountType: 'expense', debitIrr: line.amountIrr, creditIrr: 0, branchId: preview.branchId, costCenter, assetId: line.assetId, memo: `هزینه استهلاک ${line.assetCode} · ${line.assetName}` },
    { accountCode: '1890', accountType: 'asset', debitIrr: 0, creditIrr: line.amountIrr, branchId: preview.branchId, costCenter, assetId: line.assetId, memo: `استهلاک انباشته ${line.assetCode}` },
  ]);
  const journalEntry = createDraft(db, { date: `${preview.postingDate}T12:00:00.000Z`, branchId: preview.branchId, costCenter, description, lines: journalLines }, actor);
  journalEntry.source = 'asset.depreciation'; journalEntry.sourceId = runId;
  const submitted = submitDraft(db, journalEntry.id, actor);
  submitted.approval.operation = 'approve_asset_depreciation';
  const run = {
    id: runId, branchId: preview.branchId, serviceMonth: preview.serviceMonth, postingDate: journalEntry.date,
    fiscalPeriodId: periodCheck.period.id, method: preview.method, convention: preview.convention,
    totalDepreciationIrr: preview.totalDepreciationIrr, lines: preview.lines.map((line) => ({ ...line, id: id() })),
    status: 'pending_approval', journalEntryId: journalEntry.id, approvalId: submitted.approval.id,
    createdBy: actor, createdAt: now(), postedBy: null, postedAt: null, reversalJournalEntryId: null,
  };
  state.depreciationRuns.push(run);
  return { run, journalEntry, approval: submitted.approval, preview };
}

function previewPayrollRunV2(input = {}) {
  const branchId = Number(input.branchId) || null;
  if (!branchId) throw Object.assign(new Error('شعبهٔ لیست حقوق الزامی است.'), { code: 'payroll_branch_required' });
  const postingDate = String(input.postingDate || '').slice(0, 10);
  const postingAt = new Date(`${postingDate}T12:00:00.000Z`);
  if (!Number.isFinite(postingAt.getTime())) throw Object.assign(new Error('تاریخ ثبت لیست حقوق معتبر نیست.'), { code: 'payroll_date_invalid' });
  const serviceMonth = String(input.serviceMonth || postingDate.slice(0, 7)).slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(serviceMonth)) throw Object.assign(new Error('ماه خدمت لیست حقوق معتبر نیست.'), { code: 'payroll_service_month_invalid' });
  if (serviceMonth !== postingDate.slice(0, 7)) throw Object.assign(new Error('در نسخهٔ فعلی، ماه خدمت و ماه تاریخ ثبت لیست حقوق باید یکسان باشند.'), { code: 'payroll_service_month_posting_mismatch', status: 409 });
  const headcount = Number(input.headcount);
  if (!Number.isInteger(headcount) || headcount < 1 || headcount > 10000) throw Object.assign(new Error('تعداد کارکنان لیست حقوق معتبر نیست.'), { code: 'payroll_headcount_invalid' });
  const kitchenGrossIrr = safeIrr(input.kitchenGrossIrr || 0, 'payroll_amount_invalid');
  const serviceGrossIrr = safeIrr(input.serviceGrossIrr || 0, 'payroll_amount_invalid');
  const employerInsuranceIrr = safeIrr(input.employerInsuranceIrr || 0, 'payroll_amount_invalid');
  const employeeInsuranceIrr = safeIrr(input.employeeInsuranceIrr || 0, 'payroll_amount_invalid');
  const payrollTaxIrr = safeIrr(input.payrollTaxIrr || 0, 'payroll_amount_invalid');
  const otherDeductionsIrr = safeIrr(input.otherDeductionsIrr || 0, 'payroll_amount_invalid');
  const netPayIrr = safeIrr(input.netPayIrr || 0, 'payroll_amount_invalid');
  const totalGrossIrr = kitchenGrossIrr + serviceGrossIrr;
  if (!totalGrossIrr) throw Object.assign(new Error('جمع حقوق ناخالص باید بزرگ‌تر از صفر باشد.'), { code: 'payroll_gross_required' });
  const expectedNetPayIrr = totalGrossIrr - employeeInsuranceIrr - payrollTaxIrr - otherDeductionsIrr;
  if (expectedNetPayIrr <= 0 || netPayIrr !== expectedNetPayIrr) {
    const error = Object.assign(new Error('خالص حقوق با ناخالص منهای بیمه کارمند، مالیات و سایر کسورات برابر نیست.'), { code: 'payroll_net_reconciliation_failed' });
    error.details = { totalGrossIrr, employeeInsuranceIrr, payrollTaxIrr, otherDeductionsIrr, expectedNetPayIrr, netPayIrr };
    throw error;
  }
  const totalInsuranceIrr = employeeInsuranceIrr + employerInsuranceIrr;
  const totalExpenseIrr = totalGrossIrr + employerInsuranceIrr;
  const liabilities = { net_salary: netPayIrr, social_security: totalInsuranceIrr, payroll_tax: payrollTaxIrr, other_deductions: otherDeductionsIrr };
  const costCenter = `branch:${branchId}`;
  const lines = [
    ...(kitchenGrossIrr ? [{ accountCode: '6110', accountType: 'expense', debitIrr: kitchenGrossIrr, creditIrr: 0, branchId, costCenter, memo: `حقوق ناخالص آشپزخانه و بار ـ ${serviceMonth}` }] : []),
    ...(serviceGrossIrr ? [{ accountCode: '6120', accountType: 'expense', debitIrr: serviceGrossIrr, creditIrr: 0, branchId, costCenter, memo: `حقوق ناخالص سالن و صندوق ـ ${serviceMonth}` }] : []),
    ...(employerInsuranceIrr ? [{ accountCode: '6140', accountType: 'expense', debitIrr: employerInsuranceIrr, creditIrr: 0, branchId, costCenter, memo: `بیمه سهم کارفرما ـ ${serviceMonth}` }] : []),
    ...(payrollTaxIrr ? [{ accountCode: '2220', accountType: 'liability', debitIrr: 0, creditIrr: payrollTaxIrr, branchId, costCenter, memo: `مالیات تکلیفی حقوق ـ ${serviceMonth}` }] : []),
    ...(totalInsuranceIrr ? [{ accountCode: '2230', accountType: 'liability', debitIrr: 0, creditIrr: totalInsuranceIrr, branchId, costCenter, memo: `بیمه پرداختنی کارکنان و کارفرما ـ ${serviceMonth}` }] : []),
    ...(otherDeductionsIrr ? [{ accountCode: '2700', accountType: 'liability', debitIrr: 0, creditIrr: otherDeductionsIrr, branchId, costCenter, memo: `سایر کسورات پرداختنی ـ ${serviceMonth}` }] : []),
    { accountCode: '2600', accountType: 'liability', debitIrr: 0, creditIrr: netPayIrr, branchId, costCenter, memo: `خالص حقوق پرداختنی ـ ${serviceMonth}` },
  ];
  assertBalanced(lines);
  return {
    status: 'available', branchId, postingDate, serviceMonth, headcount,
    sourceReference: String(input.sourceReference || '').trim().slice(0, 160) || null,
    kitchenGrossIrr, serviceGrossIrr, totalGrossIrr, employerInsuranceIrr, employeeInsuranceIrr,
    totalInsuranceIrr, payrollTaxIrr, otherDeductionsIrr, netPayIrr, totalExpenseIrr,
    liabilities, lines,
    calculationPolicy: 'accountant_confirmed_totals_no_automatic_statutory_rate',
  };
}

function createPayrollRunV2(db, input, actor) {
  ensureFinanceV2(db);
  return withFinanceAtomicity(db, () => createPayrollRunV2Atomic(db, input, actor), {
    keys: ['journalEntries', 'approvals', 'payrollRuns'],
  });
}

function createPayrollRunV2Atomic(db, input, actor) {
  const state = ensureFinanceV2(db);
  const branchId = Number(input.branchId) || null;
  const branches = list(db.branches);
  if (branchId && branches.length && !branches.some((branch) => Number(branch.id) === branchId && branch.active !== false)) {
    throw Object.assign(new Error('شعبهٔ لیست حقوق یافت نشد یا فعال نیست.'), { code: 'payroll_branch_not_found', status: 404 });
  }
  if (!state.fiscalPeriods.length) throw Object.assign(new Error('برای ثبت لیست حقوق باید دورهٔ مالی V2 تعریف شده باشد.'), { code: 'payroll_v2_period_required', status: 409 });
  const sourceReference = String(input.sourceReference || '').trim().slice(0, 160);
  if (sourceReference.length < 3) throw Object.assign(new Error('مرجع لیست حقوق تأییدشده الزامی است.'), { code: 'payroll_source_reference_required' });
  const preview = previewPayrollRunV2({ ...input, sourceReference });
  if (state.payrollRuns.some((run) => run.branchId === preview.branchId && run.serviceMonth === preview.serviceMonth && !['rejected', 'reversed'].includes(run.status))) {
    throw Object.assign(new Error('برای این شعبه و ماه، لیست حقوق فعال قبلاً ثبت یا ارسال شده است.'), { code: 'payroll_branch_period_duplicate', status: 409 });
  }
  const periodCheck = validateOpenPeriod(db, `${preview.postingDate}T12:00:00.000Z`, preview.branchId);
  if (!periodCheck.ok) throw Object.assign(new Error(periodCheck.message), { code: periodCheck.code, status: 409 });
  const runId = id();
  const description = `لیست حقوق ${preview.serviceMonth} · ${preview.headcount} نفر · مرجع ${sourceReference}`;
  const journalEntry = createDraft(db, { date: `${preview.postingDate}T12:00:00.000Z`, branchId: preview.branchId, costCenter: `branch:${preview.branchId}`, description, lines: preview.lines }, actor);
  journalEntry.source = 'payroll.run'; journalEntry.sourceId = runId;
  const submitted = submitDraft(db, journalEntry.id, actor);
  submitted.approval.operation = 'approve_payroll_run';
  const run = {
    id: runId, branchId: preview.branchId, serviceMonth: preview.serviceMonth, postingDate: journalEntry.date,
    fiscalPeriodId: periodCheck.period.id, sourceReference, headcount: preview.headcount,
    kitchenGrossIrr: preview.kitchenGrossIrr, serviceGrossIrr: preview.serviceGrossIrr, totalGrossIrr: preview.totalGrossIrr,
    employerInsuranceIrr: preview.employerInsuranceIrr, employeeInsuranceIrr: preview.employeeInsuranceIrr,
    totalInsuranceIrr: preview.totalInsuranceIrr, payrollTaxIrr: preview.payrollTaxIrr,
    otherDeductionsIrr: preview.otherDeductionsIrr, netPayIrr: preview.netPayIrr, totalExpenseIrr: preview.totalExpenseIrr,
    liabilities: preview.liabilities, paidByLiability: { net_salary: 0, social_security: 0, payroll_tax: 0, other_deductions: 0 },
    calculationPolicy: preview.calculationPolicy, status: 'pending_approval', journalEntryId: journalEntry.id,
    approvalId: submitted.approval.id, createdBy: actor, createdAt: now(), postedBy: null, postedAt: null,
  };
  state.payrollRuns.push(run);
  return { run, journalEntry, approval: submitted.approval, preview };
}

function requestPayrollPaymentV2(db, runId, input, actor) {
  ensureFinanceV2(db);
  return withFinanceAtomicity(db, () => requestPayrollPaymentV2Atomic(db, runId, input, actor), {
    keys: ['payrollPayments', 'approvals'],
  });
}

function requestPayrollPaymentV2Atomic(db, runId, input, actor) {
  const state = ensureFinanceV2(db);
  const run = state.payrollRuns.find((row) => row.id === runId);
  if (!run) throw Object.assign(new Error('لیست حقوق V2 یافت نشد.'), { code: 'payroll_run_not_found', status: 404 });
  if (!['posted', 'partially_paid'].includes(run.status)) throw Object.assign(new Error('فقط لیست حقوق قطعی و پرداخت‌نشده قابل پرداخت است.'), { code: 'payroll_run_not_payable', status: 409 });
  const liabilityType = String(input.liabilityType || 'net_salary');
  const liabilityPolicy = PAYROLL_LIABILITY_TYPES[liabilityType];
  if (!liabilityPolicy) throw Object.assign(new Error('نوع بدهی حقوق معتبر نیست.'), { code: 'payroll_liability_type_invalid' });
  const ceilingIrr = int(run.liabilities?.[liabilityType]);
  if (!ceilingIrr) throw Object.assign(new Error('برای این نوع بدهی در لیست، مبلغی ثبت نشده است.'), { code: 'payroll_liability_empty', status: 409 });
  const pendingIrr = state.payrollPayments.filter((payment) => payment.payrollRunId === run.id && payment.liabilityType === liabilityType && payment.status === 'pending_approval').reduce((sum, payment) => sum + int(payment.amountIrr), 0);
  const remainingIrr = ceilingIrr - int(run.paidByLiability?.[liabilityType]) - pendingIrr;
  const amountIrr = safeIrr(input.amountIrr, 'payroll_payment_amount_invalid');
  if (!amountIrr || amountIrr > remainingIrr) throw Object.assign(new Error('مبلغ پرداخت از ماندهٔ بدهی انتخاب‌شده بیشتر است یا معتبر نیست.'), { code: 'payroll_payment_amount_invalid' });
  const paymentMethod = String(input.paymentMethod || 'bank');
  if (!['bank', 'cash'].includes(paymentMethod)) throw Object.assign(new Error('روش پرداخت حقوق معتبر نیست.'), { code: 'payroll_payment_method_invalid' });
  const paymentDate = input.paymentDate
    ? isoTimestamp(input.paymentDate, 'payroll_payment_date_invalid', 'زمان پرداخت حقوق باید تاریخ ISO معتبر همراه منطقهٔ زمانی باشد.')
    : now();
  const payment = {
    id: id(), payrollRunId: run.id, branchId: run.branchId, liabilityType, liabilityAccount: liabilityPolicy.accountCode,
    amountIrr, paymentMethod, paymentDate, reference: String(input.reference || '').trim().slice(0, 160) || null,
    status: 'pending_approval', approvalId: null, journalEntryId: null, reversalJournalEntryId: null,
    createdBy: actor, createdAt: now(), approvedBy: null, approvedAt: null, reversedAt: null,
  };
  state.payrollPayments.push(payment);
  const approval = {
    id: id(), operation: 'approve_payroll_payment', entityType: 'payroll_payment', entityId: payment.id,
    amountIrr, status: 'pending', createdBy: actor, createdAt: now(), decidedBy: null, decidedAt: null,
    history: [{ action: 'submitted', by: actor, at: now(), comment: input.note || null }],
  };
  state.approvals.push(approval); payment.approvalId = approval.id;
  return { run, payment, approval };
}

function captureCashMovement(db, session, movement, { actor = 'system' } = {}) {
  ensureFinanceV2(db);
  return withFinanceAtomicity(db, () => captureCashMovementAtomic(db, session, movement, { actor }), {
    keys: ['events', 'approvals', 'idempotency'],
  });
}

function captureCashMovementAtomic(db, session, movement, { actor = 'system' } = {}) {
  const branchId = branchDimension(session);
  if (!branchId) throw Object.assign(new Error('شعبهٔ نشست صندوق مشخص نیست.'), { code: 'cash_session_branch_missing', status: 409 });
  if (!movement?.id) throw Object.assign(new Error('شناسهٔ حرکت صندوق الزامی است.'), { code: 'cash_movement_id_missing' });
  if (!['pay_in', 'pay_out'].includes(String(movement.type))) throw Object.assign(new Error('نوع حرکت صندوق معتبر نیست.'), { code: 'cash_movement_type_invalid' });
  const rawAmount = numeric(movement.amount);
  if (!Number.isSafeInteger(rawAmount) || rawAmount === 0) throw Object.assign(new Error('مبلغ حرکت صندوق باید عدد صحیح و غیرصفر باشد.'), { code: 'cash_movement_amount_invalid' });
  const amountIrr = safeIrr(Math.abs(rawAmount) * 10, 'cash_movement_amount_invalid');
  const occurredAt = isoTimestamp(movement.at, 'cash_movement_date_invalid', 'زمان حرکت صندوق باید تاریخ ISO معتبر همراه منطقهٔ زمانی باشد.');
  const recorded = recordEvent(db, {
    source: 'cash.movement', sourceId: `${session.id}:${movement.id}`, sourceVersion: 1,
    branchId, occurredAt, amountIrr,
    payload: { sessionId: session.id, movementId: movement.id, type: movement.type, note: movement.note || null },
    status: 'blocked',
    error: { code: 'cash_counteraccount_required', message: 'حساب مقابل باید توسط حسابدار تعیین و قابل‌ردیابی تأیید شود.' },
  });
  const state = ensureFinanceV2(db);
  if (movement.type === 'pay_out' && !state.approvals.some((item) => item.entityType === 'finance_event' && item.entityId === recorded.event.id)) {
    state.approvals.push({
      id: id(), operation: 'approve_cash_pay_out', entityType: 'finance_event', entityId: recorded.event.id,
      amountIrr, status: 'pending', createdBy: actor, createdAt: now(), decidedBy: null, decidedAt: null,
      history: [{ action: 'submitted', by: actor, at: now(), comment: movement.note || null }],
    });
  }
  return recorded;
}

function captureCashClose(db, session, { actor = 'system' } = {}) {
  ensureFinanceV2(db);
  return withFinanceAtomicity(db, () => captureCashCloseAtomic(db, session, { actor }), {
    keys: ['events', 'journalEntries', 'idempotency'],
  });
}

function captureCashCloseAtomic(db, session, { actor = 'system' } = {}) {
  const branchId = branchDimension(session);
  if (!branchId) throw Object.assign(new Error('شعبهٔ نشست صندوق مشخص نیست.'), { code: 'cash_session_branch_missing', status: 409 });
  const varianceToman = numeric(session.variance);
  if (!Number.isSafeInteger(varianceToman)) throw Object.assign(new Error('اختلاف صندوق باید عدد صحیح معتبر باشد.'), { code: 'cash_variance_invalid' });
  const closedAt = session.closedAt ? isoTimestamp(session.closedAt, 'cash_close_date_invalid', 'زمان بستن صندوق باید تاریخ ISO معتبر همراه منطقهٔ زمانی باشد.') : now();
  const countedAmount = session.countedAmount == null ? null : numeric(session.countedAmount);
  if (countedAmount != null && !Number.isSafeInteger(countedAmount)) throw Object.assign(new Error('مبلغ شمارش‌شدهٔ صندوق معتبر نیست.'), { code: 'cash_counted_amount_invalid' });
  const varianceIrr = safeIrr(Math.abs(varianceToman) * 10, 'cash_variance_invalid');
  const recorded = recordEvent(db, {
    source: 'cash_session.closed', sourceId: session.id, sourceVersion: 1,
    branchId, occurredAt: closedAt, amountIrr: varianceIrr,
    payload: { sessionId: session.id, countedAmountIrr: countedAmount == null ? null : safeIrr(countedAmount * 10, 'cash_counted_amount_invalid'), varianceIrr },
    status: varianceToman === 0 ? 'posted' : 'pending',
  });
  if (!recorded.idempotentReplay && varianceToman !== 0) {
    const costCenter = `branch:${branchId}`;
    const lines = varianceToman > 0
      ? [
        { accountCode: '1110', debitIrr: varianceIrr, creditIrr: 0, branchId, costCenter, memo: `مازاد صندوق نشست ${session.id}` },
        { accountCode: '4500', debitIrr: 0, creditIrr: varianceIrr, branchId, costCenter, accountType: 'revenue', memo: `مازاد صندوق نشست ${session.id}` },
      ]
      : [
        { accountCode: '5500', debitIrr: varianceIrr, creditIrr: 0, branchId, costCenter, accountType: 'cogs', memo: `کسری صندوق نشست ${session.id}` },
        { accountCode: '1110', debitIrr: 0, creditIrr: varianceIrr, branchId, costCenter, memo: `کسری صندوق نشست ${session.id}` },
      ];
    const entry = postEventJournal(db, recorded.event, lines, `کسری/مازاد بستن صندوق نشست ${session.id}`, actor);
    if (!entry) throw Object.assign(new Error('سند اختلاف بستن صندوق پست نشد.'), { code: recorded.event.error?.code || 'cash_close_journal_post_failed', status: 409 });
  }
  return recorded;
}

function resolveEvent(db, eventId, input, actor) {
  ensureFinanceV2(db);
  return withFinanceAtomicity(db, () => resolveEventAtomic(db, eventId, input, actor));
}

function resolveEventAtomic(db, eventId, input, actor) {
  const state = ensureFinanceV2(db);
  const event = state.events.find((item) => item.id === eventId);
  if (!event) throw Object.assign(new Error('رویداد مالی یافت نشد.'), { code: 'finance_event_not_found', status: 404 });
  if (event.status === 'posted') {
    const payments = repairPostedOrderEventPayments(db, event);
    return {
      event,
      entry: event.journalEntryId ? state.journalEntries.find((entry) => entry.id === event.journalEntryId) || null : null,
      payments,
      idempotentReplay: true,
    };
  }
  if (['inventory.waste', 'inventory.stock_count', 'inventory.production_batch'].includes(event.source)) {
    return { ...valueAndResolveInventoryEvent(db, event, actor), idempotentReplay: false };
  }
  const branchId = Number(event.branchId);
  const costCenter = `branch:${branchId}`;
  let lines;
  let paymentRows = null;
  if (event.source === 'cash.movement') {
    const counterpartAccount = String(input.counterpartAccount || '').trim();
    if (!/^\d{4,10}$/.test(counterpartAccount)) throw Object.assign(new Error('حساب مقابل معتبر الزامی است.'), { code: 'cash_counteraccount_invalid' });
    const outgoing = event.payload?.type === 'pay_out';
    if (outgoing) {
      const approval = state.approvals.find((item) => item.entityType === 'finance_event' && item.entityId === event.id && item.operation === 'approve_cash_pay_out');
      if (!approval || approval.status !== 'approved') throw Object.assign(new Error('پرداخت از صندوق هنوز تأیید مدیر/مالک را ندارد.'), { code: 'finance_approval_required', status: 409 });
    }
    lines = outgoing
      ? [
        { accountCode: counterpartAccount, debitIrr: event.amountIrr, creditIrr: 0, branchId, costCenter, memo: event.payload.note || 'پرداخت از صندوق' },
        { accountCode: '1110', debitIrr: 0, creditIrr: event.amountIrr, branchId, costCenter, memo: event.payload.note || 'پرداخت از صندوق' },
      ]
      : [
        { accountCode: '1110', debitIrr: event.amountIrr, creditIrr: 0, branchId, costCenter, memo: event.payload.note || 'دریافت در صندوق' },
        { accountCode: counterpartAccount, debitIrr: 0, creditIrr: event.amountIrr, branchId, costCenter, memo: event.payload.note || 'دریافت در صندوق' },
      ];
  } else if (event.source === 'order.paid') {
    const order = list(db.orders).find((item) => String(item.id) === String(event.sourceId) && sameBranch(item, event.branchId));
    if (!order) throw Object.assign(new Error('سفارش منبع یافت نشد.'), { code: 'order_not_found', status: 404 });
    const sourceTenders = list(event.payload?.tenderSnapshot).map((row) => ({
      ...row, tender: String(row.tender || ''), amountIrr: int(row.amountIrr),
    }));
    const sourceTenderIsReliable = reliableTenderRows(sourceTenders, event.amountIrr);
    const reviewedTenders = list(input.tenders).map((row) => ({
      ...row, tender: String(row.tender || ''), amountIrr: int(row.amountIrr),
    }));
    const usesAccountantReview = reviewedTenders.length > 0 || !sourceTenderIsReliable;
    const tenders = usesAccountantReview ? reviewedTenders : sourceTenders;
    if (!tenders.length || tenders.some((row) => !TENDER_ACCOUNTS[row.tender]) || tenders.reduce((sum, row) => sum + row.amountIrr, 0) !== event.amountIrr) {
      throw Object.assign(new Error('روش‌ها و جمع پرداخت تأییدشده با مبلغ رویداد برابر نیست.'), { code: 'reviewed_tenders_invalid' });
    }
    if (usesAccountantReview) {
      const evidenceReference = String(input.evidenceReference || '').trim().slice(0, 160);
      if (evidenceReference.length < 3) {
        throw Object.assign(new Error('برای تعیین روش پرداخت تاریخی، مرجع مدرک مانند شماره رسید، تراکنش یا گزارش صندوق الزامی است.'), { code: 'tender_evidence_reference_required' });
      }
      event.payload.reviewEvidenceReference = evidenceReference;
      event.payload.reviewedTenderSnapshot = tenders;
    }
    paymentRows = (usesAccountantReview ? tenders : normalizeTenderRows(order).length ? normalizeTenderRows(order) : sourceTenders)
      .map((row, index) => ({
        ...row,
        paymentId: row.paymentId || `${usesAccountantReview ? 'review' : 'event'}:${event.id}:${index + 1}`,
        occurredAt: event.occurredAt,
        providerReference: row.providerReference || event.payload.reviewEvidenceReference || null,
      }));
    const paymentDebits = paymentReceiptDebitLines(db, order, tenders, branchId, costCenter);
    if (!paymentDebits.ok) throw Object.assign(new Error(paymentDebits.message), { code: paymentDebits.code, status: 409 });
    lines = paymentDebits.lines;
    const salesAccount = order.fulfillment === 'pickup' ? '4120' : order.fulfillment === 'delivery' ? '4130' : '4110';
    lines.push({ accountCode: salesAccount, debitIrr: 0, creditIrr: event.amountIrr, branchId, costCenter, accountType: 'revenue', memo: `فروش سفارش ${order.orderNo || order.id}` });
  } else {
    throw Object.assign(new Error('برای این نوع رویداد قاعدهٔ رفع مغایرت تعریف نشده است.'), { code: 'finance_event_rule_missing' });
  }
  event.status = 'pending'; event.error = null; event.payload.resolvedBy = actor; event.payload.resolvedAt = now();
  const entry = postEventJournal(db, event, lines, `رفع مغایرت رویداد ${event.source} / ${event.sourceId}`, actor);
  const payments = entry && event.source === 'order.paid' && paymentRows
    ? materializeOrderPayments(db, list(db.orders).find((order) => String(order.id) === String(event.sourceId) && sameBranch(order, event.branchId)), paymentRows)
    : [];
  if (entry && event.source === 'order.paid') linkOrderPaymentsToSaleEvent(payments, event, entry);
  return { event, entry, payments, idempotentReplay: false };
}

function legacyArchiveSummary(db, branchId = null, { includeUnscoped = true } = {}) {
  const rows = ensureFinanceV2(db).legacyArchive.filter((row) => {
    if (!branchId) return true;
    if (row.branchId == null) return includeUnscoped;
    return Number(row.branchId) === Number(branchId);
  });
  return rows.reduce((summary, row) => {
    summary.total += 1;
    if (Object.hasOwn(summary.byTrust, row.trustStatus)) summary.byTrust[row.trustStatus] += 1;
    if (Object.hasOwn(summary.byDecision, row.decision)) summary.byDecision[row.decision] += 1;
    return summary;
  }, {
    total: 0,
    byTrust: { verified: 0, inferred_needs_approval: 0, quarantined: 0 },
    byDecision: { pending: 0, approved_for_backfill: 0, keep_quarantined: 0, not_financial: 0 },
  });
}

function legacySourceKey(row) { return `${row.sourceTable}:${row.sourceId}`; }

function legacySourceFingerprint(row) {
  return sha256(canonicalJson({
    sourceTable: row.sourceTable, sourceId: String(row.sourceId), trustStatus: row.trustStatus,
    reason: row.reason, sourcePayload: row.sourcePayload, branchId: row.branchId,
    amountIrr: row.amountIrr, occurredAt: row.occurredAt, classificationDetails: row.classificationDetails,
  }));
}

function activeMigrationBaseline(state, branchId) {
  return state.migrationBaselines
    .filter((row) => row.status === 'active' && Number(row.branchId) === Number(branchId))
    .sort((a, b) => new Date(b.scannedAt) - new Date(a.scannedAt))[0] || null;
}

function postBaselineOperationalOrder(state, candidate, baseline) {
  if (!baseline || candidate.sourceTable !== 'orders') return false;
  const event = state.events.find((row) => row.source === 'order.paid'
    && String(row.sourceId) === String(candidate.sourceId)
    && sameBranch(row, candidate.branchId));
  return Boolean(event && new Date(event.createdAt || event.occurredAt).getTime() >= new Date(baseline.scannedAt).getTime());
}

function legacyMigrationReadiness(db, branchId = null) {
  const state = ensureFinanceV2(db);
  const numericBranchId = Number(branchId) || Number(list(db.branches)[0]?.id) || null;
  const baseline = numericBranchId ? activeMigrationBaseline(state, numericBranchId) : null;
  const classification = legacyClassifier.classifyLegacyFinance(db, { analyzeSale: salesLines });
  const candidates = classification.rows.filter((row) => !numericBranchId || row.branchId == null || Number(row.branchId) === numericBranchId);
  const baselineKeys = new Set(list(baseline?.sourceKeys).map(String));
  const archiveByKey = new Map(state.legacyArchive
    .filter((row) => !numericBranchId || row.branchId == null || Number(row.branchId) === numericBranchId)
    .map((row) => [legacySourceKey(row), row]));
  const missingArchiveKeys = [...baselineKeys].filter((key) => !archiveByKey.has(key));
  const archiveSnapshotMismatches = [...baselineKeys].filter((key) => {
    const record = archiveByKey.get(key);
    const expected = baseline?.sourceFingerprints?.[key];
    return Boolean(record && expected && legacySourceFingerprint(record) !== expected);
  });
  const unscopedNewKeys = candidates
    .filter((candidate) => !baselineKeys.has(legacySourceKey(candidate)) && !postBaselineOperationalOrder(state, candidate, baseline))
    .map(legacySourceKey);
  const unresolved = [...baselineKeys].map((key) => archiveByKey.get(key)).filter((record) => record && (
    record.decision === 'pending'
    || (record.decision === 'approved_for_backfill' && !['posted', 'reversed'].includes(record.backfillStatus))
  ));
  const complete = Boolean(baseline)
    && missingArchiveKeys.length === 0
    && archiveSnapshotMismatches.length === 0
    && unscopedNewKeys.length === 0
    && unresolved.length === 0;
  return {
    status: complete ? 'complete' : 'incomplete', branchId: numericBranchId, baseline,
    expectedRecords: baselineKeys.size, archivedRecords: baselineKeys.size - missingArchiveKeys.length,
    missingArchiveRecords: missingArchiveKeys.length, archiveSnapshotMismatches: archiveSnapshotMismatches.length,
    newUnscopedRecords: unscopedNewKeys.length, unresolvedRecords: unresolved.length,
    missingArchiveKeys: missingArchiveKeys.slice(0, 25), mismatchKeys: archiveSnapshotMismatches.slice(0, 25),
    newUnscopedKeys: unscopedNewKeys.slice(0, 25), unresolvedIds: unresolved.slice(0, 25).map((row) => row.id),
    policy: { baselineRequired: true, archiveSnapshotImmutable: true, postBaselineOperationalOrdersUseFinanceEvents: true },
  };
}

function classifyAndArchiveLegacy(db, actor = 'system', branchId = null) {
  const state = ensureFinanceV2(db);
  const classification = legacyClassifier.classifyLegacyFinance(db, { analyzeSale: salesLines });
  const numericBranchId = Number(branchId) || Number(list(db.branches)[0]?.id) || null;
  if (!numericBranchId) throw Object.assign(new Error('شعبه برای ثبت خط مبنای مهاجرت الزامی است.'), { code: 'legacy_migration_branch_required', status: 400 });
  const activeBaseline = activeMigrationBaseline(state, numericBranchId);
  const activeKeys = new Set(list(activeBaseline?.sourceKeys).map(String));
  const scopedCandidates = classification.rows.filter((candidate) => candidate.branchId == null || Number(candidate.branchId) === numericBranchId);
  const newCandidates = scopedCandidates.filter((candidate) => !activeKeys.has(legacySourceKey(candidate)) && !postBaselineOperationalOrder(state, candidate, activeBaseline));
  const scopeKeys = new Set([...activeKeys, ...newCandidates.map(legacySourceKey)]);
  const existingBySource = new Map(state.legacyArchive
    .filter((row) => row.branchId == null || Number(row.branchId) === numericBranchId)
    .map((row) => [`${row.sourceTable}:${row.sourceId}`, row]));
  const archivedAt = now();
  let created = 0;
  for (const candidate of scopedCandidates.filter((row) => scopeKeys.has(legacySourceKey(row)))) {
    const key = `${candidate.sourceTable}:${candidate.sourceId}`;
    if (existingBySource.has(key)) continue;
    const record = {
      ...candidate,
      decisionNotes: null,
      evidenceReference: null,
      decisionHistory: [{ action: 'classified', by: actor, at: archivedAt, trustStatus: candidate.trustStatus, reason: candidate.reason }],
      decidedBy: candidate.decision === 'pending' ? null : 'system:classifier',
      decidedAt: candidate.decision === 'pending' ? null : archivedAt,
      archivedBy: actor,
      archivedAt,
    };
    state.legacyArchive.push(record); existingBySource.set(key, record); created += 1;
  }
  let baseline = activeBaseline;
  let baselineCreated = false;
  if (!activeBaseline || newCandidates.length) {
    if (activeBaseline) {
      activeBaseline.status = 'superseded';
      activeBaseline.supersededAt = archivedAt;
    }
    const sourceKeys = [...scopeKeys].sort();
    const sourceFingerprints = { ...(activeBaseline?.sourceFingerprints || {}) };
    for (const candidate of newCandidates) sourceFingerprints[legacySourceKey(candidate)] = legacySourceFingerprint(candidate);
    if (!activeBaseline) {
      for (const candidate of scopedCandidates) sourceFingerprints[legacySourceKey(candidate)] = legacySourceFingerprint(candidate);
    }
    const trustSummary = sourceKeys.reduce((summary, key) => {
      const row = existingBySource.get(key);
      if (row && Object.hasOwn(summary, row.trustStatus)) summary[row.trustStatus] += 1;
      return summary;
    }, { verified: 0, inferred_needs_approval: 0, quarantined: 0 });
    baseline = {
      id: id(), branchId: numericBranchId, status: 'active', scannedBy: actor, scannedAt: archivedAt,
      sourceCount: sourceKeys.length, sourceKeys, sourceFingerprints,
      sourceSha256: sha256(canonicalJson(sourceFingerprints)), trustSummary,
      supersededAt: null,
    };
    state.migrationBaselines.push(baseline);
    baselineCreated = true;
  }
  return {
    created,
    unchanged: scopeKeys.size - created,
    classification: classification.summary,
    archive: legacyArchiveSummary(db),
    baseline,
    baselineCreated,
    readiness: legacyMigrationReadiness(db, numericBranchId),
    policy: classification.policy,
  };
}

function decideLegacyArchive(db, archiveId, input, actor, role) {
  const state = ensureFinanceV2(db);
  const record = state.legacyArchive.find((row) => row.id === archiveId);
  if (!record) throw Object.assign(new Error('رکورد آرشیو مهاجرت یافت نشد.'), { code: 'legacy_archive_not_found', status: 404 });
  const decision = String(input?.decision || '').trim();
  const allowed = new Set(['approved_for_backfill', 'keep_quarantined', 'not_financial']);
  if (!allowed.has(decision)) throw Object.assign(new Error('تصمیم مهاجرت معتبر نیست.'), { code: 'legacy_archive_decision_invalid' });
  if (record.trustStatus === 'quarantined' && decision === 'approved_for_backfill') {
    throw Object.assign(new Error('رکورد قرنطینه‌شده از مسیر عادی قابل تأیید برای بازسازی دفتر نیست.'), { code: 'quarantined_backfill_forbidden', status: 409 });
  }
  const decisionNotes = String(input?.decisionNotes || '').trim().slice(0, 500);
  if (decisionNotes.length < 3) throw Object.assign(new Error('یادداشت تصمیم با علت روشن الزامی است.'), { code: 'legacy_archive_decision_notes_required' });
  const evidenceReference = String(input?.evidenceReference || '').trim().slice(0, 160);
  let reviewedTenders = null;
  if (decision === 'approved_for_backfill') {
    if (!['owner', 'manager'].includes(String(role || ''))) throw Object.assign(new Error('تأیید برای بازسازی دفتر فقط توسط مالک یا مدیر مالی مجاز است.'), { code: 'legacy_backfill_approver_required', status: 403 });
    if (evidenceReference.length < 3) throw Object.assign(new Error('مرجع مدرک برای تأیید بازسازی دفتر الزامی است.'), { code: 'legacy_backfill_evidence_required' });
    if (record.trustStatus === 'inferred_needs_approval') {
      reviewedTenders = list(input?.reviewedTenders).map((row) => ({ tender: String(row?.tender || '').trim(), amountIrr: safeIrr(row?.amountIrr, 'legacy_backfill_tender_amount_invalid') }));
      if (!reviewedTenders.length || reviewedTenders.some((row) => !TENDER_ACCOUNTS[row.tender] || row.amountIrr <= 0)) {
        throw Object.assign(new Error('برای سفارش استنتاجی، حداقل یک روش پرداخت معتبر الزامی است.'), { code: 'legacy_backfill_tenders_required' });
      }
      const reviewedTotalIrr = reviewedTenders.reduce((sum, row) => sum + row.amountIrr, 0);
      if (reviewedTotalIrr !== int(record.amountIrr)) {
        throw Object.assign(new Error('جمع روش‌های پرداخت بررسی‌شده با مبلغ سفارش برابر نیست.'), { code: 'legacy_backfill_tenders_mismatch', details: { expectedIrr: record.amountIrr, reviewedTotalIrr } });
      }
    }
  }
  const decidedAt = now();
  record.decision = decision;
  record.decisionNotes = decisionNotes;
  record.evidenceReference = evidenceReference || null;
  if (reviewedTenders) record.reviewedTenders = reviewedTenders;
  record.decidedBy = actor;
  record.decidedAt = decidedAt;
  record.decisionHistory = list(record.decisionHistory);
  record.decisionHistory.push({ action: decision, by: actor, role: role || null, at: decidedAt, decisionNotes, evidenceReference: evidenceReference || null, reviewedTenders: reviewedTenders || null });
  return { record, policy: { journalPosted: false, sourceDeleted: false, automaticBackfill: false } };
}

function legacyBackfillTenders(record) {
  const raw = record?.trustStatus === 'verified' ? record.classificationDetails?.tenderSnapshot : record?.reviewedTenders;
  const tenders = list(raw).map((row) => ({ tender: String(row?.tender || '').trim(), amountIrr: safeIrr(row?.amountIrr, 'legacy_backfill_tender_amount_invalid') }));
  if (!tenders.length || tenders.some((row) => !TENDER_ACCOUNTS[row.tender] || row.amountIrr <= 0)) {
    throw Object.assign(new Error('روش‌های پرداخت تأییدشده برای بازسازی سفارش کامل نیست.'), { code: 'legacy_backfill_tenders_required', status: 409 });
  }
  const totalIrr = tenders.reduce((sum, row) => sum + row.amountIrr, 0);
  if (totalIrr !== int(record.amountIrr)) throw Object.assign(new Error('جمع روش‌های پرداخت بازسازی با مبلغ آرشیو برابر نیست.'), { code: 'legacy_backfill_tenders_mismatch', status: 409, details: { expectedIrr: record.amountIrr, reviewedTotalIrr: totalIrr } });
  if (tenders.some((row) => row.amountIrr % 10 !== 0)) throw Object.assign(new Error('مبلغ تاریخی به تومان صحیح قابل بازگردانی نیست و نیازمند سند افتتاحیهٔ جداگانه است.'), { code: 'legacy_backfill_toman_boundary_invalid', status: 409 });
  return tenders;
}

function legacyOrderBackfillPreview(db, archiveId, { forApproval = false } = {}) {
  const state = ensureFinanceV2(db);
  const record = state.legacyArchive.find((row) => row.id === archiveId);
  if (!record) throw Object.assign(new Error('رکورد آرشیو مهاجرت یافت نشد.'), { code: 'legacy_archive_not_found', status: 404 });
  const blockers = [];
  if (record.sourceTable !== 'orders') blockers.push({ code: 'legacy_backfill_source_not_supported', message: 'در این مرحله فقط سفارش عملیاتی قابل بازسازی است.' });
  if (record.trustStatus === 'quarantined') blockers.push({ code: 'quarantined_backfill_forbidden', message: 'رکورد قرنطینه‌شده قابل بازسازی مستقیم نیست.' });
  if (record.decision !== 'approved_for_backfill') blockers.push({ code: 'legacy_backfill_decision_required', message: 'مجوز مستند مالک/مدیر برای بازسازی ثبت نشده است.' });
  if (record.backfillStatus === 'posted') blockers.push({ code: 'legacy_backfill_already_posted', message: 'این رکورد قبلاً در دفتر بازسازی شده است.' });
  if (record.backfillStatus === 'reversed') blockers.push({ code: 'legacy_backfill_reversed', message: 'ثبت بازسازی این رکورد قبلاً با سند معکوس اصلاح شده و قابل ارسال مجدد خودکار نیست.' });
  if (!forApproval && record.backfillStatus === 'pending_approval') blockers.push({ code: 'legacy_backfill_request_pending', message: 'درخواست بازسازی قبلاً در صف تأیید است.' });
  const order = record.sourcePayload && typeof record.sourcePayload === 'object' ? record.sourcePayload : null;
  if (!order || !paid(order)) blockers.push({ code: 'legacy_backfill_order_snapshot_invalid', message: 'snapshot سفارش پرداخت‌شده معتبر نیست.' });
  const duplicateEvent = state.events.find((event) => event.source === 'order.paid'
    && String(event.sourceId) === String(record.sourceId)
    && sameBranch(event, record.branchId));
  const duplicateEntry = state.journalEntries.find((entry) => entry.source === 'order.paid'
    && String(entry.sourceId) === String(record.sourceId)
    && sameBranch(entry, record.branchId)
    && FINAL_ENTRY_STATUSES.has(entry.status));
  if (duplicateEvent || duplicateEntry) blockers.push({ code: 'legacy_backfill_source_already_captured', message: 'برای این سفارش رویداد یا سند مالی قبلاً وجود دارد.' });
  let tenders = [];
  let built = null;
  if (order) {
    try {
      tenders = legacyBackfillTenders(record);
      const reviewedOrder = {
        ...order,
        partialPayments: tenders.map((row, index) => ({ id: `legacy:${record.id}:${index + 1}`, tender: row.tender, amount: row.amountIrr / 10, at: record.occurredAt || order.paidAt || order.createdAt, reference: record.evidenceReference || null })),
        paymentTender: null,
        paymentMethod: null,
      };
      built = salesLines(reviewedOrder, db);
      if (!built.ok) blockers.push({ code: built.code, message: built.message });
    } catch (error) {
      blockers.push({ code: error.code || 'legacy_backfill_tender_invalid', message: error.message });
    }
  }
  const periodCheck = validateOpenPeriod(db, record.occurredAt || order?.paidAt || order?.createdAt, record.branchId || order?.branchId);
  if (!periodCheck.ok) blockers.push({ code: periodCheck.code, message: periodCheck.message });
  const totals = built?.ok ? assertBalanced(built.lines) : { debitIrr: 0, creditIrr: 0 };
  return {
    archiveId: record.id, sourceTable: record.sourceTable, sourceId: record.sourceId, branchId: record.branchId,
    occurredAt: record.occurredAt, orderNo: order?.orderNo || null, amountIrr: record.amountIrr,
    tenders, lines: built?.ok ? built.lines : [], totals, taxSource: built?.ok ? built.taxSource : null,
    period: periodCheck.ok ? { id: periodCheck.period.id, name: periodCheck.period.name, status: periodCheck.period.status } : null,
    blockers, ready: blockers.length === 0,
    policy: { previewOnly: true, journalPosted: false, sourceDeleted: false },
  };
}

function requestLegacyOrderBackfill(db, archiveId, actor) {
  const state = ensureFinanceV2(db);
  const record = state.legacyArchive.find((row) => row.id === archiveId);
  if (!record) throw Object.assign(new Error('رکورد آرشیو مهاجرت یافت نشد.'), { code: 'legacy_archive_not_found', status: 404 });
  const existingApproval = record.backfillApprovalId ? state.approvals.find((approval) => approval.id === record.backfillApprovalId && approval.status === 'pending') : null;
  if (existingApproval) return { record, entry: state.journalEntries.find((entry) => entry.id === record.backfillJournalEntryId) || null, approval: existingApproval, idempotentReplay: true };
  const preview = legacyOrderBackfillPreview(db, archiveId);
  if (!preview.ready) throw Object.assign(new Error('پیش‌شرط‌های بازسازی سفارش کامل نیست.'), { code: 'legacy_backfill_blocked', status: 409, details: { blockers: preview.blockers } });
  const entry = {
    id: id('fje'), number: `F2-BF-${String(state.journalEntries.length + 1).padStart(6, '0')}`,
    periodId: null, sourceEventId: null, source: 'legacy_backfill.order_paid', sourceId: record.id,
    date: record.occurredAt, description: `بازسازی کنترل‌شده فروش سفارش ${preview.orderNo || record.sourceId}`, status: 'pending_approval',
    debitIrr: preview.totals.debitIrr, creditIrr: preview.totals.creditIrr, branchId: Number(record.branchId),
    reversalOfId: null, reversedById: null,
    lines: preview.lines.map((line, index) => ({ id: id('fjl'), lineNo: index + 1, ...line })),
    createdAt: now(), createdBy: actor, postedAt: null, postedBy: null,
  };
  const approval = {
    id: id('fap'), operation: 'post_legacy_order_backfill', entityType: 'journal_entry', entityId: entry.id,
    amountIrr: entry.debitIrr, status: 'pending', createdBy: actor, createdAt: now(), decidedBy: null, decidedAt: null,
    history: [{ action: 'submitted', by: actor, at: now(), comment: `archive:${record.id}; evidence:${record.evidenceReference}` }],
  };
  state.journalEntries.push(entry); state.approvals.push(approval);
  record.backfillStatus = 'pending_approval'; record.backfillJournalEntryId = entry.id; record.backfillApprovalId = approval.id;
  record.backfillRequestedBy = actor; record.backfillRequestedAt = now();
  return { record, entry, approval, preview, idempotentReplay: false };
}

function duplicateGroups(rows, keyFor) {
  const groups = new Map();
  for (const row of rows) {
    const key = keyFor(row);
    if (!key) continue;
    const bucket = groups.get(key) || [];
    bucket.push(row);
    groups.set(key, bucket);
  }
  return [...groups.entries()].filter(([, bucket]) => bucket.length > 1).map(([key, bucket]) => ({ key, count: bucket.length, ids: bucket.map((row) => row.id) }));
}

function dataQuality(db, branchId, options = {}) {
  const state = ensureFinanceV2(db);
  const scopedByDate = options.from != null || options.to != null;
  const withinScope = (row, field = 'occurredAt') => !scopedByDate || inRange(row, options.from, options.to, field);
  // A row explicitly assigned to another branch must not affect this
  // branch's gate. An unscoped legacy row remains visible as a global
  // exception until an authorized reviewer assigns or resolves it.
  const qualityScope = (row) => !branchId || row?.branchId == null || Number(row.branchId) === Number(branchId);
  // Accounting-period quality checks must use the same payment/accounting date
  // as reports and reconciliation. Using createdAt here could silently omit a
  // paid order created before the period but captured inside it.
  const orderInScope = options.orderDateField === 'createdAt'
    ? (order) => withinScope(order, 'createdAt')
    : (order) => orderInAccountingRange(order, options.from, options.to);
  const orders = list(db.orders).filter((order) => paid(order) && sameBranch(order, branchId) && orderInScope(order));
  const paidOrderIds = new Set(orders.map((order) => String(order.id)));
  const saleEvents = state.events.filter((event) => event.source === 'order.paid' && qualityScope(event) && withinScope(event));
  const cogsEvents = state.events.filter((event) => event.source === 'order.cogs' && qualityScope(event) && withinScope(event));
  const orphanedSaleEvents = saleEvents.filter((event) => !paidOrderIds.has(String(event.sourceId)));
  const orphanedCogsEvents = cogsEvents.filter((event) => !paidOrderIds.has(String(event.sourceId)));
  const capturedIds = new Set(saleEvents.map((event) => String(event.sourceId)));
  const postedSaleIds = new Set(saleEvents.filter((event) => event.status === 'posted').map((event) => String(event.sourceId)));
  const cogsEventIds = new Set(cogsEvents.map((event) => String(event.sourceId)));
  const legacyPostedIds = new Set(list(db.accounting?.journalEntries).filter((entry) => entry.source === 'sale' && qualityScope(entry) && withinScope(entry, 'date')).map((entry) => String(entry.sourceId)));
  const uncaptured = orders.filter((order) => !capturedIds.has(String(order.id)) && !legacyPostedIds.has(String(order.id)));
  const uncapturedCogs = orders.filter((order) => postedSaleIds.has(String(order.id)) && !cogsEventIds.has(String(order.id)));
  const postedSaleTenderEvidenceMissing = saleEvents.filter((event) => event.status === 'posted' && event.journalEntryId).filter((event) => {
    const order = orders.find((item) => String(item.id) === String(event.sourceId));
    return Boolean(order && !eventTenderSnapshot(event));
  });
  const postedSalePaymentGaps = saleEvents.filter((event) => event.status === 'posted' && event.journalEntryId).filter((event) => {
    const order = orders.find((item) => String(item.id) === String(event.sourceId));
    const tenders = eventTenderSnapshot(event);
    const paymentRows = state.payments.filter((payment) => String(payment.orderId) === String(event.sourceId)
      && sameBranch(payment, event.branchId) && ['succeeded', 'refunded'].includes(payment.status));
    return Boolean(order && (!tenders ? paymentRows.length === 0 : !orderPaymentsMatch(state, order.id, event.branchId, tenders)));
  });
  const ambiguousTender = orders.filter((order) => {
    if (salesLines(order, db).ok) return false;
    const resolvedEvent = saleEvents.find((event) => event.status === 'posted' && String(event.sourceId) === String(order.id));
    return !reliableTenderRows(resolvedEvent?.payload?.reviewedTenderSnapshot, resolvedEvent?.amountIrr);
  });
  const settlementDuplicates = duplicateGroups(
    list(db.accounting?.settlements).filter((row) => qualityScope(row) && withinScope(row, 'settledAt')),
    legacyClassifier.settlementDuplicateKey,
  );
  const expenseDuplicates = duplicateGroups(
    list(db.accounting?.expenses).filter((row) => qualityScope(row) && withinScope(row, 'date')),
    legacyClassifier.expenseDuplicateKey,
  );
  const depreciationDuplicates = duplicateGroups(
    list(db.accounting?.journalEntries).filter((entry) => entry.source === 'depreciation' && entry.status !== 'reversed' && qualityScope(entry) && withinScope(entry, 'date')),
    legacyClassifier.depreciationDuplicateKey,
  );
  const knownBranchIds = new Set(list(db.branches).map((branch) => Number(branch.id)).filter(Number.isFinite));
  // Invalid master-data references are a global cutover blocker. Do not hide
  // an orphaned item merely because the current report is scoped to branch 1;
  // otherwise a second, undefined branch can leak into a later rollout.
  const orphanedInventoryItems = list(db.accounting?.inventoryItems).filter((item) => (
    item?.branchId != null && !knownBranchIds.has(Number(item.branchId))
  ));
  // Fiscal periods are also branch-scoped master data after migration 019.
  // Report invalid legacy references before the PostgreSQL FK rejects a sync;
  // silently waiting for the migration error makes the cutover diagnosis
  // needlessly opaque and can leave the operator with no repair queue.
  const fiscalPeriodsForQuality = state.fiscalPeriods.length ? state.fiscalPeriods : list(db.accounting?.fiscalPeriods);
  const orphanedFiscalPeriods = fiscalPeriodsForQuality.filter((period) => (
    period?.branchId != null && !knownBranchIds.has(Number(period.branchId))
  ));
  const currentDate = now();
  const currentDay = currentDate.slice(0, 10);
  const currentServiceMonth = currentDay.slice(0, 7);
  const currentPeriod = periodForDate(db, currentDate, branchId);
  const unmatchedV2Payments = state.reconciliationItems.filter((item) => item.kind === 'payment' && item.status === 'unmatched' && sameBranch(item, branchId) && withinScope(item));
  const unmatchedBankStatementLines = state.reconciliationItems.filter((item) => item.kind === 'bank_statement_line' && item.status === 'unmatched' && sameBranch(item, branchId) && withinScope(item, 'occurredAt'));
  const dueCostCommitments = !scopedByDate && state.costCommitments.filter((item) => item.status === 'active' && sameBranch(item, branchId)
    && item.startDate <= currentDay && (!item.endDate || item.endDate >= currentDay)
    && !state.costAccruals.some((accrual) => accrual.costCommitmentId === item.id && accrual.serviceMonth === currentServiceMonth && !['rejected', 'reversed'].includes(accrual.status))) || [];
  const dueDepreciationAssets = scopedByDate ? [] : previewDepreciationV2(db, { branchId, postingDate: currentDay }).lines;
  const recipeApprovalById = new Map(state.approvals.map((approval) => [String(approval.id), approval]));
  const recipesMissingApprovalEvidence = state.recipeVersions.filter((recipe) => {
    if (!qualityScope(recipe) || !['approved', 'retired'].includes(recipe.status)) return false;
    const approval = recipe.approvalId == null ? null : recipeApprovalById.get(String(recipe.approvalId));
    return !recipe.approvedBy || !recipe.approvedAt
      || !approval
      || approval.entityType !== 'recipe_version'
      || String(approval.entityId) !== String(recipe.id)
      || approval.operation !== 'approve_recipe_version'
      || approval.status !== 'approved';
  });
  const issues = [];
  if (uncaptured.length) issues.push({ code: 'paid_orders_without_finance_event', severity: 'critical', count: uncaptured.length, amountIrr: uncaptured.reduce((sum, order) => sum + irrFromLegacyToman(order.total), 0), title: 'سفارش پرداخت‌شده بدون رویداد مالی' });
  if (uncapturedCogs.length) issues.push({ code: 'posted_sales_without_cogs_event', severity: 'critical', count: uncapturedCogs.length, amountIrr: null, title: 'فروش ثبت‌شده بدون رویداد بهای تمام‌شده' });
  if (orphanedSaleEvents.length) issues.push({ code: 'orphaned_finance_sale_events', severity: 'critical', count: orphanedSaleEvents.length, amountIrr: orphanedSaleEvents.reduce((sum, event) => sum + int(event.amountIrr), 0), title: 'رویداد فروش بدون سفارش منبع معتبر' });
  if (orphanedCogsEvents.length) issues.push({ code: 'orphaned_finance_cogs_events', severity: 'critical', count: orphanedCogsEvents.length, amountIrr: orphanedCogsEvents.reduce((sum, event) => sum + int(event.amountIrr), 0), title: 'رویداد بهای تمام‌شده بدون سفارش منبع معتبر' });
  if (postedSaleTenderEvidenceMissing.length) issues.push({ code: 'posted_sale_tender_evidence_missing', severity: 'critical', count: postedSaleTenderEvidenceMissing.length, amountIrr: postedSaleTenderEvidenceMissing.reduce((sum, event) => sum + int(event.amountIrr), 0), title: 'فروش قطعی بدون snapshot معتبر روش پرداخت' });
  if (postedSalePaymentGaps.length) issues.push({ code: 'posted_sale_payment_records_missing', severity: 'critical', count: postedSalePaymentGaps.length, amountIrr: postedSalePaymentGaps.reduce((sum, event) => sum + int(event.amountIrr), 0), title: 'فروش قطعی بدون رکورد پرداخت متناظر' });
  if (ambiguousTender.length) issues.push({ code: 'payment_tender_missing', severity: 'critical', count: ambiguousTender.length, amountIrr: ambiguousTender.reduce((sum, order) => sum + irrFromLegacyToman(order.total), 0), title: 'روش پرداخت نامطمئن یا جمع پرداخت ناسازگار' });
  if (!scopedByDate && (!currentPeriod || !['open', 'reopened'].includes(currentPeriod.status))) issues.push({ code: 'current_fiscal_period_not_open', severity: 'critical', count: 1, amountIrr: null, title: 'دورهٔ مالی جاری باز و معتبر نیست' });
  if (settlementDuplicates.length) issues.push({ code: 'duplicate_settlement_batch', severity: 'critical', count: settlementDuplicates.length, amountIrr: null, title: 'دسته تسویهٔ تکراری' });
  if (expenseDuplicates.length) issues.push({ code: 'duplicate_expense_candidate', severity: 'critical', count: expenseDuplicates.length, amountIrr: null, title: 'هزینهٔ احتمالی تکراری' });
  if (depreciationDuplicates.length) issues.push({ code: 'duplicate_depreciation_period', severity: 'critical', count: depreciationDuplicates.length, amountIrr: null, title: 'استهلاک تکراری دارایی/دوره' });
  if (orphanedInventoryItems.length) issues.push({ code: 'inventory_branch_reference_invalid', severity: 'critical', count: orphanedInventoryItems.length, amountIrr: null, title: 'اقلام انبار به شعبهٔ نامعتبر متصل‌اند' });
  if (orphanedFiscalPeriods.length) issues.push({ code: 'fiscal_period_branch_reference_invalid', severity: 'critical', count: orphanedFiscalPeriods.length, amountIrr: null, title: 'دوره‌های مالی به شعبهٔ نامعتبر متصل‌اند' });
  if (recipesMissingApprovalEvidence.length) issues.push({ code: 'recipe_approval_audit_missing', severity: 'critical', count: recipesMissingApprovalEvidence.length, amountIrr: null, title: 'نسخه‌های دستور تهیه بدون زنجیرهٔ تأیید مستقل' });
  const cashSessions = list(db.cashSessions);
  const legacyCashDrawers = list(db.accounting?.cashDrawers);
  // An empty legacy collection is not a parallel model: it is the expected
  // state after cashSessions becomes the sole operational source of truth.
  // Report a migration conflict only when both models contain records.
  const scopedCashSessions = cashSessions.filter(qualityScope);
  const scopedLegacyCashDrawers = legacyCashDrawers.filter(qualityScope);
  if (scopedCashSessions.length && scopedLegacyCashDrawers.length) {
    issues.push({ code: 'parallel_cash_models', severity: 'warning', count: scopedLegacyCashDrawers.length, amountIrr: null, title: 'دو مدل دارای رکورد صندوق هم‌زمان فعال‌اند' });
  }
  const scopedBlockedEvents = state.events.filter((event) => event.status === 'blocked' && qualityScope(event));
  if (scopedBlockedEvents.length) issues.push({ code: 'blocked_finance_events', severity: 'critical', count: scopedBlockedEvents.length, amountIrr: null, title: 'رویداد مالی مسدودشده' });
  if (unmatchedV2Payments.length) issues.push({ code: 'unmatched_card_gateway_payments', severity: 'warning', count: unmatchedV2Payments.length, amountIrr: unmatchedV2Payments.reduce((sum, item) => sum + int(item.amountIrr), 0), title: 'پرداخت کارت/درگاه منتظر تطبیق تسویه' });
  if (unmatchedBankStatementLines.length) issues.push({ code: 'unmatched_bank_statement_lines', severity: 'warning', count: unmatchedBankStatementLines.length, amountIrr: unmatchedBankStatementLines.reduce((sum, item) => sum + int(item.amountIrr), 0), title: 'گردش صورت‌حساب بانک منتظر تطبیق دفتر' });
  if (dueCostCommitments.length) issues.push({ code: 'periodic_cost_accrual_due', severity: 'warning', count: dueCostCommitments.length, amountIrr: dueCostCommitments.reduce((sum, item) => sum + int(item.monthlyAmountIrr), 0), title: 'تعهد هزینهٔ ماه جاری هنوز ثبت دوره‌ای ندارد' });
  if (dueDepreciationAssets.length) issues.push({ code: 'asset_depreciation_due', severity: 'warning', count: dueDepreciationAssets.length, amountIrr: dueDepreciationAssets.reduce((sum, item) => sum + int(item.amountIrr), 0), title: 'استهلاک ماه جاری دارایی‌های V2 هنوز ثبت نشده است' });
  return { issues, uncaptured, uncapturedCogs, orphanedSaleEvents, orphanedCogsEvents, postedSaleTenderEvidenceMissing, postedSalePaymentGaps, ambiguousTender, settlementDuplicates, expenseDuplicates, depreciationDuplicates, orphanedInventoryItems, orphanedFiscalPeriods, recipesMissingApprovalEvidence, unmatchedV2Payments, unmatchedBankStatementLines, dueCostCommitments, dueDepreciationAssets, currentPeriod };
}

function reportSnapshot(db, { branchId, from, to } = {}) {
  const state = ensureFinanceV2(db);
  const orders = list(db.orders).filter((order) => paid(order) && sameBranch(order, branchId) && orderInAccountingRange(order, from, to));
  const refunds = state.refunds.filter((refund) => refund.status === 'succeeded'
    && refund.recognitionState !== 'customer_deposit'
    && sameBranch(refund, branchId) && inRange(refund, from, to, 'refundDate'));
  const entries = state.journalEntries.filter((entry) => entry.status === 'posted' && sameBranch(entry, branchId) && inRange(entry, from, to, 'date'));
  const grossSalesIrr = orders.reduce((sum, order) => sum + irrFromLegacyToman(order.total), 0);
  const refundsIrr = refunds.reduce((sum, refund) => sum + int(refund.amountIrr), 0);
  const operationalSalesIrr = grossSalesIrr - refundsIrr;
  const receiptAccounts = new Set(Object.values(TENDER_ACCOUNTS));
  const ledgerNetSalesIrr = entries.flatMap((entry) => entry.lines).filter((line) => SALES_ACCOUNTS.has(line.accountCode)).reduce((sum, line) => sum + int(line.creditIrr) - int(line.debitIrr), 0);
  const ledgerTaxIrr = entries.flatMap((entry) => entry.lines).filter((line) => line.accountCode === '2210').reduce((sum, line) => sum + int(line.creditIrr) - int(line.debitIrr), 0);
  const ledgerSalesIrr = entries
    .filter((entry) => {
      if (['order.paid', 'order.refund'].includes(entry.source)) return true;
      if (entry.source !== 'reversal' || !entry.reversalOfId) return false;
      const original = state.journalEntries.find((item) => item.id === entry.reversalOfId);
      return Boolean(original && ['order.paid', 'order.refund'].includes(original.source));
    })
    .flatMap((entry) => entry.lines)
    .filter((line) => receiptAccounts.has(line.accountCode))
    .reduce((sum, line) => sum + int(line.debitIrr) - int(line.creditIrr), 0);
  const debitIrr = entries.reduce((sum, entry) => sum + int(entry.debitIrr), 0);
  const creditIrr = entries.reduce((sum, entry) => sum + int(entry.creditIrr), 0);
  return {
    operational: { paidOrders: orders.length, grossSalesIrr, refundsIrr, salesIrr: operationalSalesIrr, source: 'orders + financeV2.refunds(succeeded)' },
    ledger: { postedEntries: entries.length, salesIrr: ledgerSalesIrr, netRevenueIrr: ledgerNetSalesIrr, taxIrr: ledgerTaxIrr, debitIrr, creditIrr, source: 'finance_v2_journal payment-side reconciliation' },
    reconciliation: { salesDifferenceIrr: operationalSalesIrr - ledgerSalesIrr, balanced: debitIrr === creditIrr },
  };
}

function tehranDay(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function shadowRunReadiness(db, branchId = null, runtime = {}) {
  const state = ensureFinanceV2(db);
  const storage = runtime.storageStatus || null;
  const quality = dataQuality(db, branchId);
  const snapshot = reportSnapshot(db, { branchId });
  const paidOrderIds = new Set(list(db.orders).filter((order) => paid(order) && sameBranch(order, branchId)).map((order) => String(order.id)));
  const saleEvents = state.events.filter((event) => event.source === 'order.paid' && event.status === 'posted' && event.journalEntryId && sameBranch(event, branchId) && paidOrderIds.has(String(event.sourceId)));
  const postedCogsIds = new Set(state.events.filter((event) => event.source === 'order.cogs' && event.status === 'posted' && event.journalEntryId && sameBranch(event, branchId) && paidOrderIds.has(String(event.sourceId))).map((event) => String(event.sourceId)));
  const completeOrders = saleEvents.filter((event) => {
    if (!postedCogsIds.has(String(event.sourceId))) return false;
    const succeededPayments = state.payments.filter((payment) => payment.status === 'succeeded'
      && sameBranch(payment, branchId) && String(payment.orderId) === String(event.sourceId));
    return succeededPayments.length > 0 && succeededPayments.reduce((sum, payment) => sum + Math.max(0, int(payment.amountIrr) - int(payment.refundedIrr)), 0) === int(event.amountIrr);
  });
  const completeDayKeys = [...new Set(completeOrders.map((event) => tehranDay(event.occurredAt)).filter(Boolean))].sort();
  const migration = legacyMigrationReadiness(db, branchId);
  const currentPeriod = state.fiscalPeriods.length ? dataQuality(db, branchId).currentPeriod : null;
  const pendingApprovals = state.approvals.filter((approval) => approval.status === 'pending'
    && approval.id !== runtime.ignoreApprovalId
    && approvalMatchesBranch(state, approval, branchId));
  const unresolvedEvents = state.events.filter((event) => ['pending', 'blocked', 'failed'].includes(event.status) && sameBranch(event, branchId));
  const gates = [
    { id: 'postgres_required', label: 'PostgreSQL مرجع اجباری و schema نرمال فعال', passed: storage?.available === true && storage?.required === true, value: storage?.available ? (storage.required ? 'required' : 'optional') : (storage?.reason || 'inactive') },
    { id: 'complete_orders', label: 'حداقل ۱۰۰ سفارش کامل فروش/پرداخت/COGS', passed: completeOrders.length >= 100, value: completeOrders.length, target: 100 },
    { id: 'operating_days', label: 'حداقل ۷ روز عملیاتی دارای سفارش کامل', passed: completeDayKeys.length >= 7, value: completeDayKeys.length, target: 7 },
    { id: 'sales_reconciliation', label: 'اختلاف فروش عملیاتی و دفتر صفر و دفتر متوازن', passed: snapshot.reconciliation.salesDifferenceIrr === 0 && snapshot.reconciliation.balanced, value: snapshot.reconciliation.salesDifferenceIrr },
    { id: 'data_quality', label: 'هیچ مغایرت داده‌ای برای انتقال باقی نمانده', passed: quality.issues.length === 0, value: quality.issues.map((issue) => ({ code: issue.code, severity: issue.severity, count: issue.count ?? null })) },
    { id: 'open_period', label: 'دوره مالی جاری باز', passed: Boolean(currentPeriod && ['open', 'reopened'].includes(currentPeriod.status)), value: currentPeriod?.status || 'missing' },
    { id: 'unresolved_events', label: 'رویداد مالی pending، blocked یا failed باقی نمانده', passed: unresolvedEvents.length === 0, value: unresolvedEvents.length },
    { id: 'pending_approvals', label: 'تأیید معطل باقی نمانده', passed: pendingApprovals.length === 0, value: pendingApprovals.length },
    { id: 'migration_baseline', label: 'خط مبنای مهاجرت شعبه ثبت شده', passed: Boolean(migration.baseline), value: migration.baseline ? migration.expectedRecords : 'missing' },
    { id: 'migration_archive_coverage', label: 'تمام اقلام خط مبنا در آرشیو تغییرناپذیر حفظ شده‌اند', passed: migration.missingArchiveRecords === 0 && migration.archiveSnapshotMismatches === 0 && migration.newUnscopedRecords === 0, value: { missing: migration.missingArchiveRecords, mismatched: migration.archiveSnapshotMismatches, newUnscoped: migration.newUnscopedRecords } },
    { id: 'migration_decisions', label: 'پرونده مهاجرت تصمیم‌نشده یا backfill نیمه‌کاره ندارد', passed: migration.unresolvedRecords === 0, value: migration.unresolvedRecords },
  ];
  return {
    status: gates.every((gate) => gate.passed) ? 'READY_FOR_CUTOVER_REVIEW' : 'NO_GO',
    generatedAt: now(), branchId: branchId ? Number(branchId) : null,
    completeOrders: completeOrders.length, operatingDays: completeDayKeys.length, migration,
    firstCompleteDay: completeDayKeys[0] || null, lastCompleteDay: completeDayKeys.at(-1) || null,
    gates,
    policy: { minimumCompleteOrders: 100, minimumOperatingDays: 7, bothThresholdsRequired: true, automaticCutover: false },
  };
}

function branchRolloutStatus(db, branchId, runtime = {}) {
  const state = ensureFinanceV2(db);
  const numericBranchId = Number(branchId) || null;
  if (!numericBranchId) throw Object.assign(new Error('شعبه برای وضعیت انتقال الزامی است.'), { code: 'finance_rollout_branch_required', status: 400 });
  const rows = state.branchRollouts.filter((row) => Number(row.branchId) === numericBranchId).sort((a, b) => new Date(b.requestedAt) - new Date(a.requestedAt));
  const active = rows.find((row) => row.status === 'active') || null;
  const pending = rows.find((row) => row.status === 'pending_approval') || null;
  const captureEnabled = state.rollout.captureEnabled !== false
    && (!state.rollout.enabledBranchIds.length || state.rollout.enabledBranchIds.map(Number).includes(numericBranchId));
  return {
    branchId: numericBranchId,
    status: active ? 'cutover_active' : pending ? 'pending_approval' : 'shadow',
    captureEnabled,
    cutoverActive: Boolean(active || state.rollout.cutoverBranchIds.map(Number).includes(numericBranchId)),
    active, pending, history: rows,
    readiness: runtime.readiness || shadowRunReadiness(db, numericBranchId, runtime),
    policy: {
      directActivation: false,
      independentApprovalRequired: true,
      revalidateAtApproval: true,
      automaticCutover: false,
      jsonFallbackAfterActivation: false,
    },
  };
}

function requestBranchCutover(db, branchId, actor, runtime = {}) {
  const state = ensureFinanceV2(db);
  const numericBranchId = strictBranchRouteId(branchId);
  if (list(db.branches).length && !list(db.branches).some((branch) => Number(branch.id) === numericBranchId)) {
    throw Object.assign(new Error('شعبهٔ درخواست‌شده یافت نشد.'), { code: 'finance_rollout_branch_not_found', status: 404 });
  }
  const current = branchRolloutStatus(db, numericBranchId, runtime);
  if (current.cutoverActive) throw Object.assign(new Error('این شعبه قبلاً به مرجع مالی PostgreSQL منتقل شده و قابل بازگشت به JSON نیست.'), { code: 'finance_rollout_already_active', status: 409 });
  if (current.pending) return { rollout: current.pending, approval: state.approvals.find((row) => row.id === current.pending.approvalId) || null, readiness: current.readiness, idempotentReplay: true };
  if (current.readiness.status !== 'READY_FOR_CUTOVER_REVIEW') {
    throw Object.assign(new Error('گیت‌های اجرای سایه هنوز برای درخواست انتقال کامل نیستند.'), {
      code: 'finance_cutover_not_ready', status: 409,
      details: { failedGates: current.readiness.gates.filter((gate) => !gate.passed) },
    });
  }
  const rolloutId = id();
  const approval = {
    id: id(), operation: 'activate_finance_branch_cutover', entityType: 'finance_branch_rollout', entityId: rolloutId,
    amountIrr: 0, status: 'pending', createdBy: actor, createdAt: now(), decidedBy: null, decidedAt: null,
    history: [{ action: 'submitted', by: actor, at: now(), comment: `branch:${numericBranchId}` }],
  };
  const rollout = {
    id: rolloutId, branchId: numericBranchId, status: 'pending_approval', approvalId: approval.id,
    requestedBy: actor, requestedAt: now(), decidedBy: null, decidedAt: null, activatedBy: null, activatedAt: null,
    readinessSnapshot: current.readiness,
  };
  state.approvals.push(approval);
  state.branchRollouts.push(rollout);
  return { rollout, approval, readiness: current.readiness, idempotentReplay: false };
}

function workbench(db, query = {}, runtime = {}) {
  const state = ensureFinanceV2(db);
  const branchId = query.branchId ? Number(query.branchId) : null;
  const branchEvents = state.events.filter((event) => sameBranch(event, branchId));
  const branchApprovals = state.approvals.filter((approval) => approvalMatchesBranch(state, approval, branchId));
  const quality = dataQuality(db, branchId);
  const storage = runtime.storageStatus || null;
  if (storage && !storage.available) quality.issues.push({ code: 'normalized_postgres_not_active', severity: 'critical', count: 1, amountIrr: null, title: 'مرجع نرمال PostgreSQL هنوز فعال نیست' });
  const snapshot = reportSnapshot(db, { branchId, from: query.from, to: query.to });
  const actions = [];
  if (quality.uncaptured.length) actions.push({ id: 'review-orders', label: 'ثبت مالی سفارش‌های جاافتاده', operation: 'events' });
  if (quality.uncapturedCogs.length || branchEvents.some((event) => event.source === 'order.cogs' && event.status === 'blocked')) actions.push({ id: 'review-cogs', label: 'رفع نقص دستور تهیه و بهای تمام‌شده', operation: 'events' });
  if (!quality.currentPeriod || !['open', 'reopened'].includes(quality.currentPeriod.status)) actions.push({ id: 'open-period', label: 'رفع مانع دورهٔ مالی', operation: 'periods' });
  if (quality.settlementDuplicates.length) actions.push({ id: 'review-settlements', label: 'بررسی تسویهٔ تکراری', operation: 'events' });
  if (quality.expenseDuplicates.length) actions.push({ id: 'review-expense-duplicates', label: 'بررسی هزینه‌های احتمالی تکراری', operation: 'events' });
  if (quality.depreciationDuplicates.length) actions.push({ id: 'review-depreciation-duplicates', label: 'بررسی استهلاک تکراری', operation: 'events' });
  if (quality.orphanedInventoryItems.length) actions.push({ id: 'review-inventory-branches', label: 'تعیین شعبهٔ اقلام انبار', operation: 'inventory' });
  if (quality.recipesMissingApprovalEvidence.length) actions.push({
    id: 'review-recipe-approvals', label: 'بازبینی زنجیرهٔ تأیید دستورهای تهیه', workspace: 'costing',
  });
  if (quality.ambiguousTender.length) actions.push({ id: 'review-payment-tenders', label: 'بررسی روش پرداخت سفارش‌ها', operation: 'events' });
  if (branchEvents.some((event) => event.status === 'blocked')) actions.push({ id: 'review-blocked-events', label: 'رفع رویدادهای مالی مسدودشده', operation: 'events' });
  if (quality.unmatchedV2Payments.length) actions.push({ id: 'reconcile-payments', label: 'تطبیق پرداخت‌های کارت و درگاه', workspace: 'sales_bank' });
  if (quality.unmatchedBankStatementLines.length) actions.push({ id: 'reconcile-bank', label: 'تطبیق صورت‌حساب بانک با دفتر', workspace: 'sales_bank' });
  if (quality.dueCostCommitments.length) actions.push({ id: 'accrue-costs', label: 'ثبت اجاره، حقوق و هزینه‌های ماه', workspace: 'purchases' });
  if (quality.dueDepreciationAssets.length) actions.push({ id: 'depreciate-assets', label: 'پیش‌نمایش و ثبت استهلاک ماه', workspace: 'ledger_close' });
  if (branchApprovals.some((item) => item.status === 'pending')) actions.push({ id: 'pending-approvals', label: 'رسیدگی به تأییدهای منتظر', operation: 'approvals' });
  const migration = legacyMigrationReadiness(db, branchId);
  if (migration.status !== 'complete') actions.push({ id: 'migration-baseline', label: 'تکمیل خط مبنا و پرونده‌های مهاجرت', operation: 'events' });
  // Keep the operational queue self-describing for every role.  The action
  // list is consumed by multiple clients (the admin shell, audit tooling and
  // future mobile views), so a free-text label alone is not enough to decide
  // whether the current user can actually perform the next step.  These
  // fields are advisory metadata; the API capability guards remain the
  // source of truth and must still reject unauthorized mutations.
  const actionPolicies = {
    'review-orders': { requiredCapability: 'finance.events.manage', audience: 'accountant_manager' },
    'review-cogs': { requiredCapability: 'finance.events.manage', audience: 'accountant_manager' },
    'open-period': { requiredCapability: 'finance.period.close', audience: 'accountant_manager' },
    'review-settlements': { requiredCapability: 'finance.reconcile', audience: 'accountant_manager' },
    'review-expense-duplicates': { requiredCapability: 'finance.events.manage', audience: 'accountant_manager' },
    'review-depreciation-duplicates': { requiredCapability: 'finance.events.manage', audience: 'accountant_manager' },
    'review-inventory-branches': { requiredCapability: 'finance.events.manage', audience: 'accountant_manager' },
    // The costing workspace exposes the immutable review queue. Creating or
    // approving a recipe still requires its own kitchen/finance capability;
    // this action only takes an authorized viewer to the evidence.
    'review-recipe-approvals': { requiredCapability: 'inventory.view', audience: 'kitchen_manager' },
    'review-payment-tenders': { requiredCapability: 'finance.events.manage', audience: 'accountant_manager' },
    'review-blocked-events': { requiredCapability: 'finance.events.manage', audience: 'accountant_manager' },
    'reconcile-payments': { requiredCapability: 'finance.reconcile', audience: 'accountant_manager' },
    'reconcile-bank': { requiredCapability: 'finance.reconcile', audience: 'accountant_manager' },
    'accrue-costs': { requiredCapability: 'finance.journal.create', audience: 'accountant_manager' },
    'depreciate-assets': { requiredCapability: 'finance.journal.create', audience: 'accountant_manager' },
    'pending-approvals': { requiredCapability: 'finance.approve', audience: 'manager_owner' },
    'migration-baseline': { requiredCapability: 'finance.events.manage', audience: 'accountant_manager' },
  };
  const describedActions = actions.map((action) => ({
    ...action,
    requiredCapability: actionPolicies[action.id]?.requiredCapability || 'finance.view',
    audience: actionPolicies[action.id]?.audience || 'accountant_manager',
  }));
  const shadowReadiness = shadowRunReadiness(db, branchId, runtime);
  const rollout = branchId || list(db.branches)[0]?.id
    ? branchRolloutStatus(db, branchId || list(db.branches)[0].id, { ...runtime, readiness: shadowReadiness })
    : null;
  const expenseRows = list(db.accounting?.expenses);
  const recipeApprovalById = new Map(state.approvals.map((approval) => [String(approval.id), approval]));
  const recipeApprovalReview = quality.recipesMissingApprovalEvidence.map((recipe) => {
    const approval = recipe.approvalId == null ? null : recipeApprovalById.get(String(recipe.approvalId));
    const missingEvidence = [];
    if (!recipe.approvedBy) missingEvidence.push('approved_by');
    if (!recipe.approvedAt) missingEvidence.push('approved_at');
    if (!approval) missingEvidence.push('approval_record');
    else {
      if (approval.entityType !== 'recipe_version') missingEvidence.push('approval_entity');
      if (String(approval.entityId) !== String(recipe.id)) missingEvidence.push('approval_entity_id');
      if (approval.operation !== 'approve_recipe_version') missingEvidence.push('approval_operation');
      if (approval.status !== 'approved') missingEvidence.push('approval_decision');
    }
    return {
      id: recipe.id,
      recipeId: recipe.recipeId || null,
      menuItemId: recipe.menuItemId == null ? null : String(recipe.menuItemId),
      menuItemName: recipe.menuItemName || recipe.name || null,
      branchId: recipe.branchId ?? null,
      version: recipe.version ?? null,
      status: recipe.status || null,
      effectiveFrom: recipe.effectiveFrom || null,
      approvalId: recipe.approvalId || null,
      approvalStatus: approval?.status || null,
      missingEvidence,
    };
  });
  const reviewQueues = {
    duplicateExpenses: quality.expenseDuplicates.map((group) => ({
      key: group.key,
      count: group.count,
      records: group.ids.map((expenseId) => expenseRows.find((row) => String(row.id) === String(expenseId))).filter(Boolean).map((row) => ({
        id: row.id,
        branchId: row.branchId ?? null,
        date: String(row.date || row.createdAt || '').slice(0, 10),
        amount: row.amount ?? row.amountToman ?? row.amountIrr ?? null,
        description: row.description || row.subject || '',
        category: row.category || row.categoryId || null,
      })),
    })),
    invalidInventoryBranches: quality.orphanedInventoryItems.map((item) => ({
      id: item.id,
      branchId: item.branchId ?? null,
      name: item.name || '',
      sku: item.sku || '',
      unit: item.unit || '',
    })),
    recipeApprovalReview: recipeApprovalReview.sort((left, right) =>
      String(left.menuItemName || left.menuItemId || left.id).localeCompare(String(right.menuItemName || right.menuItemId || right.id), 'fa')),
  };
  return {
    status: quality.issues.some((issue) => issue.severity === 'critical') ? 'NO_GO' : 'READY_FOR_SHADOW',
    mode: state.cutover?.status || state.mode,
    metrics: {
      operationalSalesIrr: snapshot.operational.salesIrr,
      ledgerSalesIrr: snapshot.ledger.salesIrr,
      unexplainedDifferenceIrr: snapshot.reconciliation.salesDifferenceIrr,
      paidOrders: snapshot.operational.paidOrders,
      blockedEvents: branchEvents.filter((event) => event.status === 'blocked').length,
      blockedCogsEvents: branchEvents.filter((event) => event.source === 'order.cogs' && event.status === 'blocked').length,
      pendingApprovals: branchApprovals.filter((item) => item.status === 'pending').length,
    },
    // The workbench is an operational queue. Do not silently discard a real
    // exception after an arbitrary visual-card limit; the renderer can group
    // or paginate these actions without losing the source issue.
    actions: describedActions,
    actionSummary: { total: describedActions.length, hasMore: false },
    issues: quality.issues,
    reviewQueues,
    sources: {
      operationalSales: 'سفارش‌های عملیاتی', cash: 'نشست‌های صندوق', ledger: 'دفتر مالی جدید', legacyLedger: 'دفتر قدیمی (فقط خواندنی در اجرای آزمایشی)',
      persistence: storage?.available ? 'PostgreSQL normalized transaction mirror + durable snapshot' : `snapshot only (${storage?.reason || 'runtime status unavailable'})`,
    },
    storage,
    shadowReadiness, rollout,
    currentPeriod: quality.currentPeriod,
    operations: dailyOperations(db, query),
  };
}

function dailyOperations(db, query = {}) {
  const state = ensureFinanceV2(db);
  const branchId = query.branchId ? Number(query.branchId) : null;
  // Operational queues follow the selected calendar scope. The workbench's
  // top-level actions/readiness intentionally remain all-history controls,
  // but an uncaptured order from outside `from/to` must not leak into a
  // date-filtered daily queue or its counters.
  // This queue is an operational daily view, so its order list follows the
  // order creation day. Accounting reports/gates use the payment day.
  const quality = dataQuality(db, branchId, { from: query.from, to: query.to, orderDateField: 'createdAt' });
  const branchEvents = state.events
    .filter((row) => sameBranch(row, branchId) && inRange(row, query.from, query.to))
    .sort((a, b) => new Date(b.occurredAt) - new Date(a.occurredAt));
  const journalRows = state.journalEntries
    .filter((row) => sameBranch(row, branchId) && inRange(row, query.from, query.to, 'date'))
    .sort((a, b) => new Date(b.date) - new Date(a.date));
  const approvals = state.approvals
    .filter((row) => approvalMatchesBranch(state, row, branchId)
      && (!query.from && !query.to || inRange(row, query.from, query.to, 'createdAt')))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const periods = (state.fiscalPeriods.length ? state.fiscalPeriods : list(db.accounting?.fiscalPeriods))
    .filter((row) => !branchId || row.branchId == null || Number(row.branchId) === branchId);
  const actionableEvents = branchEvents.filter((row) => ['blocked', 'pending'].includes(row.status));
  const actionableEventPage = page(actionableEvents, { ...query, page: query.eventPage || query.page, pageSize: 25 });
  // Each operational queue has its own cursor. Returning only the first
  // 25 rows made the counters look complete while silently hiding real work
  // from the accountant. Keep the source collections independently pageable
  // so one long queue cannot starve the others.
  const uncapturedOrderPage = page(quality.uncaptured, { ...query, page: query.uncapturedPage || 1, pageSize: 25 });
  const journalDraftRows = journalRows.filter((row) => ['draft', 'pending_approval'].includes(row.status));
  const journalDraftPage = page(journalDraftRows, { ...query, page: query.journalPage || 1, pageSize: 25 });
  const approvalRows = approvals.filter((row) => row.status === 'pending');
  const approvalPage = page(approvalRows, { ...query, page: query.approvalPage || 1, pageSize: 25 });
  const legacyArchiveRows = state.legacyArchive
    .filter((row) => !branchId || (row.branchId != null && Number(row.branchId) === branchId))
    .slice().sort((a, b) => new Date(b.archivedAt) - new Date(a.archivedAt));
  const legacyArchivePage = page(legacyArchiveRows, { ...query, page: query.migrationPage || 1, pageSize: 25 });
  return {
    counters: {
      blockedEvents: branchEvents.filter((row) => row.status === 'blocked').length,
      blockedCogsEvents: branchEvents.filter((row) => row.source === 'order.cogs' && row.status === 'blocked').length,
      uncapturedOrders: quality.uncaptured.length,
      uncapturedCogs: quality.uncapturedCogs.length,
      draftJournals: journalRows.filter((row) => row.status === 'draft').length,
      pendingApprovals: approvals.filter((row) => row.status === 'pending').length,
      unmatchedBankStatementLines: quality.unmatchedBankStatementLines.length,
      dueCostCommitments: quality.dueCostCommitments.length,
    },
    events: actionableEventPage.rows.map((row) => ({
      id: row.id, source: row.source, sourceId: row.sourceId, occurredAt: row.occurredAt, amountIrr: row.amountIrr,
      status: row.status, error: row.error ? { code: row.error.code, message: row.error.message } : null,
      payload: row.source === 'order.paid' ? { tenderSnapshot: list(row.payload?.tenderSnapshot) } : undefined,
    })),
    eventsPagination: {
      page: actionableEventPage.page, pageSize: actionableEventPage.pageSize,
      total: actionableEventPage.total, pages: actionableEventPage.pages,
    },
    uncapturedOrders: uncapturedOrderPage.rows.map((order) => ({
      id: order.id, orderNo: order.orderNo || null, createdAt: order.createdAt, branchId: order.branchId,
      amountIrr: irrFromLegacyToman(order.total), tenderKnown: normalizeTenderRows(order).length > 0,
    })),
    uncapturedOrdersPagination: {
      page: uncapturedOrderPage.page, pageSize: uncapturedOrderPage.pageSize,
      total: uncapturedOrderPage.total, pages: uncapturedOrderPage.pages,
    },
    journalDrafts: journalDraftPage.rows,
    journalDraftsPagination: {
      page: journalDraftPage.page, pageSize: journalDraftPage.pageSize,
      total: journalDraftPage.total, pages: journalDraftPage.pages,
    },
    approvals: approvalPage.rows,
    approvalsPagination: {
      page: approvalPage.page, pageSize: approvalPage.pageSize,
      total: approvalPage.total, pages: approvalPage.pages,
    },
    legacyArchive: legacyArchivePage.rows,
    legacyArchivePagination: {
      page: legacyArchivePage.page, pageSize: legacyArchivePage.pageSize,
      total: legacyArchivePage.total, pages: legacyArchivePage.pages,
    },
    legacyArchiveSummary: legacyArchiveSummary(db, branchId, { includeUnscoped: branchId == null }),
    migrationReadiness: legacyMigrationReadiness(db, branchId),
    periods: periods.slice().sort((a, b) => new Date(b.startDate) - new Date(a.startDate)),
    periodSource: state.fiscalPeriods.length ? 'finance_v2' : 'legacy_read_only',
    currentPeriod: quality.currentPeriod,
    reconciliation: {
      summary: reportSnapshot(db, query),
      settlementDuplicates: quality.settlementDuplicates,
    },
  };
}

function bankPostingAccounts(db) {
  const configured = list(db.accounting?.accounts)
    .filter((account) => account?.subtype === 'bank' && account?.isPostingAccount !== false && /^12\d{2}$/.test(String(account.code || '')))
    .map((account) => ({ code: String(account.code), name: String(account.nameFa || account.name || account.code) }));
  return configured.length ? configured : DEFAULT_BANK_ACCOUNTS.map((account) => ({ ...account }));
}

function bankJournalCandidates(db, branchId, query = {}) {
  const bankCodes = new Set(bankPostingAccounts(db).map((account) => account.code));
  return ensureFinanceV2(db).journalEntries
    .filter((entry) => entry.status === 'posted' && sameBranch(entry, branchId) && inRange(entry, query.from, query.to, 'date'))
    .flatMap((entry) => [...bankCodes].map((accountCode) => {
      const bankLines = list(entry.lines).filter((line) => String(line.accountCode) === accountCode);
      const debitIrr = bankLines.reduce((sum, line) => sum + int(line.debitIrr), 0);
      const creditIrr = bankLines.reduce((sum, line) => sum + int(line.creditIrr), 0);
      const netIrr = debitIrr - creditIrr;
      if (!netIrr) return null;
      return {
        journalEntryId: entry.id,
        journalNumber: entry.number,
        branchId: entry.branchId,
        occurredAt: entry.date,
        description: entry.description,
        accountCode,
        direction: netIrr > 0 ? 'inflow' : 'outflow',
        amountIrr: Math.abs(netIrr),
      };
    }).filter(Boolean))
    .sort((a, b) => new Date(b.occurredAt) - new Date(a.occurredAt));
}

function reconciliationItemInRange(item, query = {}) {
  const occurredAt = item?.details?.occurredAt
    || item?.details?.settledAt
    || item?.payment?.paidAt
    || item?.createdAt;
  return inRange({ occurredAt }, query.from, query.to);
}

function cashSessionView(session) {
  const movements = list(session?.movements);
  const openingToman = Number(session?.openingAmount || 0);
  const movementToman = movements.reduce((sum, movement) => sum + Number(movement.amount || 0), 0);
  const expectedToman = openingToman + movementToman;
  const countedToman = session?.countedAmount == null ? null : Number(session.countedAmount);
  const varianceToman = countedToman == null ? null : countedToman - expectedToman;
  return {
    id: session.id,
    branchId: session.branchId,
    openedAt: session.openedAt || null,
    closedAt: session.closedAt || null,
    status: session.closedAt ? 'closed' : 'open',
    openingAmountIrr: irrFromLegacyToman(openingToman),
    expectedAmountIrr: irrFromLegacyToman(expectedToman),
    countedAmountIrr: countedToman == null ? null : irrFromLegacyToman(countedToman),
    varianceIrr: varianceToman == null ? null : irrFromLegacyToman(varianceToman),
    reconciliationStatus: countedToman == null ? 'awaiting_count' : varianceToman === 0 ? 'balanced' : 'difference',
  };
}

function recordBankStatementLine(db, input, actor) {
  const state = ensureFinanceV2(db);
  const branchId = Number(input.branchId) || null;
  if (!branchId) throw Object.assign(new Error('شعبهٔ گردش بانک الزامی است.'), { code: 'bank_statement_branch_required' });
  const branches = list(db.branches);
  if (branches.length && !branches.some((branch) => Number(branch.id) === branchId && branch.active !== false)) {
    throw Object.assign(new Error('شعبهٔ گردش بانک یافت نشد یا فعال نیست.'), { code: 'bank_statement_branch_not_found', status: 404 });
  }
  const bankReference = String(input.bankReference || '').trim().slice(0, 160);
  if (!bankReference) throw Object.assign(new Error('شناسهٔ یکتای تراکنش بانک الزامی است.'), { code: 'bank_statement_reference_required' });
  const normalizedReference = bankReference.toLocaleUpperCase('en-US');
  if (state.reconciliationItems.some((row) => row.kind === 'bank_statement_line' && Number(row.branchId) === branchId
    && String(row.bankReference || '').trim().toLocaleUpperCase('en-US') === normalizedReference)) {
    throw Object.assign(new Error('این شناسهٔ بانکی قبلاً برای همین شعبه ثبت شده است.'), { code: 'bank_statement_reference_duplicate', status: 409 });
  }
  const amountIrr = safeIrr(input.amountIrr, 'bank_statement_amount_invalid');
  if (!amountIrr) throw Object.assign(new Error('مبلغ گردش بانک باید بزرگ‌تر از صفر باشد.'), { code: 'bank_statement_amount_invalid' });
  const direction = String(input.direction || '');
  if (!['inflow', 'outflow'].includes(direction)) throw Object.assign(new Error('نوع گردش بانک باید واریز یا برداشت باشد.'), { code: 'bank_statement_direction_invalid' });
  const bankAccountCode = String(input.bankAccountCode || '1210').trim();
  if (!bankPostingAccounts(db).some((account) => account.code === bankAccountCode)) {
    throw Object.assign(new Error('حساب بانکی انتخاب‌شده، حساب معین بانکی معتبر نیست.'), { code: 'bank_statement_account_invalid' });
  }
  const occurredAt = isoTimestamp(input.occurredAt, 'bank_statement_date_invalid', 'زمان گردش بانک باید تاریخ ISO معتبر همراه منطقهٔ زمانی باشد.');
  const statementLine = {
    id: id(), kind: 'bank_statement_line', branchId, orderId: null, paymentId: null, cashSessionId: null,
    bankReference, settlementReference: null, psp: null, terminalId: null, batchNo: null, journalEntryId: null,
    amountIrr, status: 'unmatched', matchedAt: null, matchedBy: null,
    details: {
      direction, bankAccountCode, occurredAt,
      description: String(input.description || '').trim().slice(0, 300) || null,
      evidenceSource: 'manual_bank_statement_line', matchPolicy: 'exact_one_to_one',
    },
    createdBy: actor, createdAt: now(),
  };
  state.reconciliationItems.push(statementLine);
  return statementLine;
}

function matchBankStatementLine(db, statementLineId, input, actor) {
  const state = ensureFinanceV2(db);
  const statementLine = state.reconciliationItems.find((row) => row.kind === 'bank_statement_line' && row.id === statementLineId);
  if (!statementLine) throw Object.assign(new Error('ردیف صورت‌حساب بانک یافت نشد.'), { code: 'bank_statement_line_not_found', status: 404 });
  if (statementLine.status !== 'unmatched') throw Object.assign(new Error('این ردیف بانک قبلاً تطبیق شده یا در وضعیت قابل تطبیق نیست.'), { code: 'bank_statement_line_already_matched', status: 409 });
  const journalEntryId = String(input.journalEntryId || '').trim();
  if (!journalEntryId) throw Object.assign(new Error('سند دفتر برای تطبیق الزامی است.'), { code: 'bank_match_journal_required' });
  if (state.reconciliationItems.some((row) => row.kind === 'bank_statement_line' && row.status === 'matched' && row.journalEntryId === journalEntryId
    && row.details?.bankAccountCode === statementLine.details.bankAccountCode)) {
    throw Object.assign(new Error('گردش این حساب در سند قبلاً با یک ردیف صورت‌حساب بانک تطبیق شده است.'), { code: 'bank_match_journal_already_used', status: 409 });
  }
  const journal = state.journalEntries.find((entry) => entry.id === journalEntryId);
  if (!journal || journal.status !== 'posted') throw Object.assign(new Error('فقط سند قطعی دفتر قابل تطبیق است.'), { code: 'bank_match_posted_journal_required', status: 409 });
  if (Number(journal.branchId) !== Number(statementLine.branchId)) throw Object.assign(new Error('شعبهٔ سند و صورت‌حساب بانک یکسان نیست.'), { code: 'bank_match_branch_mismatch', status: 409 });
  const candidate = bankJournalCandidates(db, statementLine.branchId).find((row) => row.journalEntryId === journalEntryId
    && row.accountCode === statementLine.details.bankAccountCode);
  if (!candidate) throw Object.assign(new Error('سند انتخاب‌شده گردش خالصی در حساب بانکی این ردیف ندارد.'), { code: 'bank_match_account_movement_missing', status: 409 });
  if (candidate.direction !== statementLine.details.direction || candidate.amountIrr !== statementLine.amountIrr) {
    throw Object.assign(new Error('مبلغ یا جهت گردش بانک با سند دفتر برابر نیست؛ تطبیق اجباری انجام نشد.'), {
      code: 'bank_match_amount_direction_mismatch', status: 409,
      details: {
        statement: { direction: statementLine.details.direction, amountIrr: statementLine.amountIrr },
        journal: { direction: candidate.direction, amountIrr: candidate.amountIrr },
      },
    });
  }
  statementLine.journalEntryId = journal.id;
  statementLine.status = 'matched';
  statementLine.matchedAt = now();
  statementLine.matchedBy = actor;
  statementLine.details = {
    ...statementLine.details,
    matchedJournalNumber: journal.number,
    matchedJournalDate: journal.date,
    matchedAmountIrr: candidate.amountIrr,
    matchMode: 'exact_amount_direction_account_branch',
  };
  return { statementLine, journalEntry: journal, candidate };
}

function salesCashBank(db, query = {}) {
  const branchId = query.branchId ? Number(query.branchId) : null;
  const state = ensureFinanceV2(db);
  // Every surfaced reconciliation warning must use the same accounting
  // period as orders, payments, refunds and bank rows.  Passing no range here
  // made duplicate settlement warnings all-history while the rest of this
  // workspace was period-scoped.
  const quality = dataQuality(db, branchId, { from: query.from, to: query.to });
  const orders = list(db.orders).filter((order) => paid(order) && sameBranch(order, branchId) && orderInAccountingRange(order, query.from, query.to));
  const tenders = new Map();
  for (const order of orders) {
    const rows = normalizeTenderRows(order);
    if (!rows.length) {
      tenders.set('unknown', (tenders.get('unknown') || 0) + irrFromLegacyToman(order.total));
      continue;
    }
    for (const row of rows) tenders.set(row.tender, (tenders.get(row.tender) || 0) + row.amountIrr);
  }
  const refunds = state.refunds
    .filter((row) => sameBranch(row, branchId) && inRange(row, query.from, query.to, 'refundDate'))
    .sort((a, b) => new Date(b.refundDate) - new Date(a.refundDate));
  for (const refund of refunds.filter((row) => row.status === 'succeeded')) {
    const payment = state.payments.find((row) => row.id === refund.paymentId);
    if (payment) tenders.set(payment.tender, (tenders.get(payment.tender) || 0) - refund.amountIrr);
  }
  const sessions = list(db.cashSessions)
    .filter((row) => sameBranch(row, branchId) && inRange(row, query.from, query.to, 'openedAt'))
    .map(cashSessionView);
  const mappedOrders = orders.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).map((order) => ({
    id: order.id, orderNo: order.orderNo || null, branchId: order.branchId, createdAt: order.createdAt,
    paidAt: order.paidAt || null, accountingDate: order.paidAt || order.createdAt || null,
    paymentStatus: order.paymentStatus, fulfillment: order.fulfillment, amountIrr: irrFromLegacyToman(order.total),
    tenders: normalizeTenderRows(order).map((row) => row.tender),
    financeStatus: state.events.find((event) => event.source === 'order.paid' && String(event.sourceId) === String(order.id))?.status || 'unregistered',
  }));
  const orderPage = page(mappedOrders, query);
  const scopedPayments = state.payments
    .filter((row) => sameBranch(row, branchId) && inRange({ occurredAt: row.paidAt || row.createdAt }, query.from, query.to));
  const reconciliationPayments = state.reconciliationItems
    .filter((row) => row.kind === 'payment' && sameBranch(row, branchId) && row.status === 'unmatched')
    .map((row) => ({ ...row, payment: state.payments.find((payment) => payment.id === row.paymentId) || null }))
    .filter((row) => row.payment && reconciliationItemInRange(row, query));
  const bankAccounts = bankPostingAccounts(db);
  const bankStatementLines = state.reconciliationItems
    .filter((row) => row.kind === 'bank_statement_line' && sameBranch(row, branchId) && inRange({ occurredAt: row.details?.occurredAt }, query.from, query.to))
    .sort((a, b) => new Date(b.details?.occurredAt || b.createdAt) - new Date(a.details?.occurredAt || a.createdAt))
    .map((row) => ({
      ...row,
      matchedJournal: row.journalEntryId ? state.journalEntries.find((entry) => entry.id === row.journalEntryId) || null : null,
    }));
  const bankCandidates = bankJournalCandidates(db, branchId, query)
    .filter((candidate) => !state.reconciliationItems.some((row) => row.kind === 'bank_statement_line' && row.status === 'matched'
      && row.journalEntryId === candidate.journalEntryId && row.details?.bankAccountCode === candidate.accountCode));
  return {
    summary: reportSnapshot(db, query),
    tenders: [...tenders.entries()].map(([tender, amountIrr]) => ({ tender, amountIrr })),
    orders: orderPage.rows,
    pagination: { page: orderPage.page, pageSize: orderPage.pageSize, total: orderPage.total, pages: orderPage.pages },
    cashSessions: sessions,
    settlementDuplicates: quality.settlementDuplicates,
    payments: scopedPayments,
    refunds,
    refundablePayments: scopedPayments.filter((row) => row.amountIrr > int(row.refundedIrr)),
    reconciliation: {
      unmatchedPayments: reconciliationPayments,
      settlements: state.reconciliationItems
        .filter((row) => row.kind === 'settlement' && sameBranch(row, branchId) && reconciliationItemInRange(row, query))
        .sort((a, b) => new Date(b.details?.settledAt || b.createdAt) - new Date(a.details?.settledAt || a.createdAt)),
      bankAccounts,
      bankStatementLines,
      bankCandidates,
    },
  };
}

function financeOrderChain(db, orderId, branchId = null) {
  const state = ensureFinanceV2(db);
  const order = list(db.orders).find((row) => String(row.id) === String(orderId));
  if (!order) throw Object.assign(new Error('سفارش یافت نشد.'), { code: 'order_not_found', status: 404 });
  const requestedBranchId = branchDimension(branchId);
  if (requestedBranchId && !sameExactBranch(order, { branchId: requestedBranchId })) {
    throw Object.assign(new Error('سفارش به شعبهٔ انتخاب‌شده تعلق ندارد.'), { code: 'order_branch_mismatch', status: 409 });
  }
  const orderBranchId = branchDimension(order);
  if (!orderBranchId) throw Object.assign(new Error('شعبهٔ سفارش برای بررسی زنجیره مشخص نیست.'), { code: 'order_branch_missing', status: 409 });

  const saleEvents = state.events
    .filter((event) => event.source === 'order.paid' && String(event.sourceId) === String(order.id) && sameExactBranch(event, order))
    .sort((left, right) => (int(right.sourceVersion) - int(left.sourceVersion)) || (new Date(right.createdAt || 0) - new Date(left.createdAt || 0)));
  const saleEvent = saleEvents[0] || null;
  const saleJournalEntry = saleEvent?.journalEntryId
    ? state.journalEntries.find((entry) => entry.id === saleEvent.journalEntryId) || null
    : null;
  const payments = state.payments
    .filter((payment) => String(payment.orderId) === String(order.id) && sameExactBranch(payment, order))
    .sort((left, right) => new Date(left.paidAt || left.createdAt || 0) - new Date(right.paidAt || right.createdAt || 0));
  const capturedPayments = payments.filter((payment) => ['succeeded', 'refunded'].includes(payment.status));
  const capturedAmountIrr = capturedPayments.reduce((sum, payment) => sum + Math.max(0, int(payment.amountIrr) - int(payment.refundedIrr)), 0);
  const totalToman = numeric(order.total);
  const expectedAmountIrr = Number.isSafeInteger(totalToman) && totalToman >= 0 && totalToman <= Number.MAX_SAFE_INTEGER / 10
    ? totalToman * 10 : null;
  const tenderSnapshot = eventTenderSnapshot(saleEvent);
  const cogsEvents = state.events
    .filter((event) => event.source === 'order.cogs' && String(event.sourceId) === String(order.id) && sameExactBranch(event, order))
    .sort((left, right) => new Date(right.createdAt || 0) - new Date(left.createdAt || 0));
  const cogsEvent = cogsEvents[0] || null;
  const cogsJournalEntry = cogsEvent?.journalEntryId
    ? state.journalEntries.find((entry) => entry.id === cogsEvent.journalEntryId) || null
    : null;
  const refunds = state.refunds
    .filter((refund) => String(refund.orderId) === String(order.id) && sameExactBranch(refund, order))
    .sort((left, right) => new Date(right.refundDate || right.createdAt || 0) - new Date(left.refundDate || left.createdAt || 0))
    .map((refund) => ({
      ...refund,
      approval: state.approvals.find((approval) => approval.entityType === 'finance_refund'
        && String(approval.entityId) === String(refund.id)) || null,
      journalEntry: refund.journalEntryId ? state.journalEntries.find((entry) => entry.id === refund.journalEntryId) || null : null,
    }));
  const reconciliationItems = state.reconciliationItems
    .filter((item) => String(item.orderId) === String(order.id) && sameExactBranch(item, order))
    .sort((left, right) => new Date(right.createdAt || 0) - new Date(left.createdAt || 0));
  const nonCashPayments = capturedPayments.filter((payment) => ['card', 'manual_card', 'card_on_file', 'online', 'gateway'].includes(payment.tender));
  const paymentReconciliation = reconciliationItems.filter((item) => item.kind === 'payment');
  const unresolvedPaymentReconciliation = nonCashPayments.filter((payment) => {
    const item = paymentReconciliation.find((candidate) => candidate.paymentId === payment.id);
    return !item || item.status !== 'matched';
  });

  const issues = [];
  if (paid(order)) {
    if (!saleEvent) issues.push({ code: 'finance_event_missing', message: 'فروش پرداخت‌شده هنوز در Finance V2 ثبت نشده است.' });
    else if (saleEvent.status !== 'posted' || !saleJournalEntry) {
      issues.push({ code: saleEvent.error?.code || 'sales_journal_missing', message: saleEvent.error?.message || 'سند فروش هنوز قطعی نشده است.' });
    }
    if (!capturedPayments.length) issues.push({ code: 'payment_records_missing', message: 'رکورد پرداخت معتبر برای سفارش پیدا نشد.' });
    else if (saleEvent && capturedAmountIrr !== int(saleEvent.amountIrr)) {
      issues.push({
        code: 'payment_chain_amount_mismatch', message: 'جمع پرداخت‌ها با مبلغ فروش قطعی برابر نیست.',
        details: { capturedAmountIrr, saleAmountIrr: int(saleEvent.amountIrr) },
      });
    }
    if (!tenderSnapshot) issues.push({ code: 'tender_snapshot_missing', message: 'جزئیات معتبر روش پرداخت برای فروش ثبت نشده است.' });
    if (!cogsEvent || cogsEvent.status !== 'posted' || !cogsJournalEntry) {
      issues.push({ code: cogsEvent?.error?.code || 'cogs_missing', message: cogsEvent?.error?.message || 'بهای تمام‌شدهٔ این سفارش هنوز قطعی نشده است.' });
    }
  }
  const pendingRefunds = refunds.filter((refund) => ['pending_approval', 'approved', 'processing'].includes(refund.status));
  if (pendingRefunds.length) issues.push({ code: 'refund_approval_pending', message: 'یک یا چند درخواست برگشت وجه منتظر تصمیم مستقل است.', details: { count: pendingRefunds.length } });
  const failedRefunds = refunds.filter((refund) => refund.status === 'failed');
  if (failedRefunds.length) issues.push({ code: 'refund_failed', message: 'یک یا چند برگشت وجه ناموفق نیازمند بررسی است.', details: { count: failedRefunds.length } });

  const reconciliationStatus = !nonCashPayments.length
    ? 'not_required'
    : unresolvedPaymentReconciliation.length ? 'needs_action' : 'matched';
  const status = !paid(order) ? 'not_paid' : !saleEvent ? 'not_captured' : issues.length ? 'needs_action' : 'complete';
  const statusLabels = {
    not_paid: 'هنوز پرداخت نشده', not_captured: 'ثبت مالی نشده', needs_action: 'نیازمند اقدام', complete: 'کامل',
  };
  return {
    status, statusLabel: statusLabels[status], reconciliationStatus,
    order: {
      id: order.id, orderNo: order.orderNo || null, branchId: orderBranchId, status: order.status || null,
      paymentStatus: order.paymentStatus || null, fulfillment: order.fulfillment || null,
      totalIrr: expectedAmountIrr, createdAt: order.createdAt || null, paidAt: order.paidAt || null,
      paymentRevision: int(order.paymentRevision || order.editRevision) || 1,
    },
    sales: {
      event: saleEvent, eventHistory: saleEvents, journalEntry: saleJournalEntry,
      expectedAmountIrr, capturedAmountIrr, tenderSnapshot,
      payments, capturedPayments,
    },
    costing: {
      event: cogsEvent, eventHistory: cogsEvents, journalEntry: cogsJournalEntry,
      snapshots: state.orderItemCostSnapshots.filter((row) => String(row.orderId) === String(order.id) && sameExactBranch(row, order)),
      movements: state.inventoryMovements.filter((row) => row.source === 'order.cogs' && String(row.sourceId) === String(order.id) && sameExactBranch(row, order)),
    },
    refunds, reconciliation: { items: reconciliationItems, unresolvedPaymentIds: unresolvedPaymentReconciliation.map((payment) => payment.id) },
    issues,
  };
}

function purchasesPayables(db, query = {}) {
  const acc = db.accounting || {};
  const state = ensureFinanceV2(db);
  const branchId = query.branchId ? Number(query.branchId) : null;
  const vendors = list(acc.vendors).filter((row) => branchId == null || sameBranch(row, branchId));
  const inventoryItems = list(acc.inventoryItems).filter((row) => sameBranch(row, branchId));
  const inPurchaseRange = (row, field) => inRange(row, query.from, query.to, field);
  const bills = list(acc.vendorBills).filter((row) => (branchId == null || sameBranch(row, branchId)) && inPurchaseRange(row, 'date'));
  const expenses = list(acc.expenses).filter((row) => sameBranch(row, branchId) && inPurchaseRange(row, 'date'));
  const orders = list(acc.purchaseOrders).filter((row) => (!branchId || Number(row.branchId ?? row.locationId) === Number(branchId)) && inPurchaseRange(row, 'issueDate'));
  const receipts = list(acc.goodsReceipts).filter((row) => sameBranch(row, branchId) && inPurchaseRange(row, 'receivedAt'));
  const v2Orders = state.purchaseOrders.filter((row) => sameBranch(row, branchId) && inPurchaseRange(row, 'issueDate'));
  const v2Receipts = state.goodsReceipts.filter((row) => sameBranch(row, branchId) && inPurchaseRange(row, 'receivedAt'));
  const v2Invoices = state.vendorInvoices.filter((row) => sameBranch(row, branchId) && inPurchaseRange(row, 'invoiceDate'));
  const v2InvoiceIds = new Set(v2Invoices.map((row) => row.id));
  const v2Payments = state.supplierPayments.filter((row) => sameBranch(row, branchId) && inPurchaseRange(row, 'paymentDate'));
  const operatingExpenses = state.operatingExpenses.filter((row) => sameBranch(row, branchId) && inPurchaseRange(row, 'date'));
  const costCommitments = state.costCommitments.filter((row) => sameBranch(row, branchId) && inPurchaseRange(row, 'startDate'));
  const costAccruals = state.costAccruals.filter((row) => sameBranch(row, branchId) && inPurchaseRange(row, 'postingDate')).map((row) => ({
    ...row,
    commitment: costCommitments.find((commitment) => commitment.id === row.costCommitmentId) || null,
    journalEntry: state.journalEntries.find((entry) => entry.id === row.journalEntryId) || null,
    payments: state.costPayments.filter((payment) => payment.costAccrualId === row.id && inPurchaseRange(payment, 'paymentDate')),
  }));
  const costPayments = state.costPayments.filter((row) => sameBranch(row, branchId) && inPurchaseRange(row, 'paymentDate'));
  const duplicateExpenses = duplicateGroups(expenses, (row) => {
    const day = String(row.date || row.createdAt || '').slice(0, 10);
    const amountValue = row.amount ?? row.totalAmount;
    return day && amountValue != null ? `${day}:${int(amountValue)}:${String(row.description || row.title || '').trim().toLowerCase()}` : '';
  });
  return {
    vendors, inventoryItems, bills, purchaseOrders: orders, goodsReceipts: receipts, expenses,
    v2: {
      purchaseOrders: v2Orders, goodsReceipts: v2Receipts, vendorInvoices: v2Invoices, supplierPayments: v2Payments,
      threeWayMatches: state.threeWayMatches.filter((row) => {
        const invoice = state.vendorInvoices.find((candidate) => candidate.id === row.vendorInvoiceId);
        return Boolean(invoice && v2InvoiceIds.has(invoice.id));
      }), costCommitments, costAccruals, costPayments,
      operatingExpenses,
      costCommitmentTypes: Object.entries(COST_COMMITMENT_TYPES).map(([id, policy]) => ({ id, ...policy })),
    },
    summary: {
      vendors: vendors.length, openBills: bills.filter((row) => !['paid', 'cancelled'].includes(String(row.status || ''))).length,
      payableIrr: bills.filter((row) => !['paid', 'cancelled'].includes(String(row.status || ''))).reduce((sum, row) => sum + irrFromLegacyToman(row.balance ?? row.amount ?? row.totalAmount), 0),
      purchaseOrders: orders.length, goodsReceipts: receipts.length, duplicateExpenseGroups: duplicateExpenses.length,
      v2PurchaseOrders: v2Orders.length, v2GoodsReceipts: v2Receipts.length,
      v2OpenInvoices: v2Invoices.filter((row) => !['paid', 'cancelled'].includes(row.status)).length,
      v2PayableIrr: v2Invoices.reduce((sum, row) => sum + Math.max(0, row.totalIrr - row.paidAmountIrr), 0),
      pendingSupplierPayments: v2Payments.filter((row) => row.status === 'pending_approval').length,
      matchExceptions: v2Invoices.filter((row) => row.matchStatus === 'exception').length,
      activeCostCommitments: costCommitments.filter((row) => row.status === 'active').length,
      committedMonthlyCostIrr: costCommitments.filter((row) => row.status === 'active').reduce((sum, row) => sum + int(row.monthlyAmountIrr), 0),
      pendingCostAccruals: costAccruals.filter((row) => row.status === 'pending_approval').length,
      accruedCostPayableIrr: costAccruals.filter((row) => ['posted', 'partially_paid'].includes(row.status)).reduce((sum, row) => sum + Math.max(0, int(row.amountIrr) - int(row.paidAmountIrr)), 0),
      operatingExpenses: operatingExpenses.length,
      pendingOperatingExpenses: operatingExpenses.filter((row) => row.status === 'pending_approval').length,
    },
    dataQuality: { duplicateExpenses, trust: 'legacy_unverified', scope: { from: query.from || null, to: query.to || null } },
  };
}

function actualBreakEvenFromLedger(db, query = {}) {
  const state = ensureFinanceV2(db);
  const branchId = query.branchId ? Number(query.branchId) : null;
  const entries = state.journalEntries.filter((entry) => entry.status === 'posted' && sameBranch(entry, branchId) && inRange(entry, query.from, query.to, 'date'));
  const lines = entries.flatMap((entry) => list(entry.lines).map((line) => ({ ...line, journalEntryId: entry.id, journalNumber: entry.number })));
  const netSalesIrr = lines.filter((line) => SALES_ACCOUNTS.has(line.accountCode)).reduce((sum, line) => sum + int(line.creditIrr) - int(line.debitIrr), 0);
  const classified = lines.filter((line) => RESTAURANT_COST_BEHAVIOR[line.accountCode]).map((line) => ({
    ...line,
    behavior: RESTAURANT_COST_BEHAVIOR[line.accountCode].behavior,
    classificationLabel: RESTAURANT_COST_BEHAVIOR[line.accountCode].label,
    netCostIrr: int(line.debitIrr) - int(line.creditIrr),
  }));
  const variableCostIrr = classified.filter((line) => line.behavior === 'variable').reduce((sum, line) => sum + line.netCostIrr, 0);
  const fixedCostIrr = classified.filter((line) => line.behavior === 'fixed').reduce((sum, line) => sum + line.netCostIrr, 0);
  const expenseLines = lines.filter((line) => {
    const code = Number(line.accountCode);
    return Number.isFinite(code) && code >= 5000 && code < 7000 && (int(line.debitIrr) || int(line.creditIrr));
  });
  const unclassified = expenseLines.filter((line) => !RESTAURANT_COST_BEHAVIOR[line.accountCode]).map((line) => ({
    journalEntryId: line.journalEntryId, journalNumber: line.journalNumber, accountCode: line.accountCode,
    amountIrr: int(line.debitIrr) - int(line.creditIrr), memo: line.memo || null,
  }));
  const totalExpenseIrr = expenseLines.reduce((sum, line) => sum + int(line.debitIrr) - int(line.creditIrr), 0);
  const classifiedExpenseIrr = fixedCostIrr + variableCostIrr;
  const coveragePercent = totalExpenseIrr > 0 ? Math.round((classifiedExpenseIrr / totalExpenseIrr) * 10000) / 100 : 0;
  const missing = [];
  if (netSalesIrr <= 0) missing.push('net_sales');
  if (!classified.some((line) => line.behavior === 'variable')) missing.push('variable_cost');
  if (!classified.some((line) => line.behavior === 'fixed')) missing.push('fixed_cost');
  const calculation = restaurantIntelligence.calculateBreakEven({
    fixedCostsIrr: [fixedCostIrr],
    sales: [{ revenueIrr: netSalesIrr, variableCostIrr }],
    realizedNetSalesIrr: netSalesIrr,
  });
  const base = {
    source: 'posted Finance V2 journal lines', netSalesIrr, variableCostIrr, fixedCostIrr,
    classifiedExpenseIrr, totalExpenseIrr, coveragePercent, unclassified,
    classifications: Object.entries(RESTAURANT_COST_BEHAVIOR).map(([accountCode, value]) => ({ accountCode, ...value })),
    missing,
  };
  if (missing.length || calculation.status !== 'available') {
    return { ...base, status: 'insufficient_data', reason: missing.length ? 'required_posted_accounts_missing' : calculation.reason, breakEvenSalesIrr: null };
  }
  if (unclassified.some((line) => line.amountIrr !== 0)) return { ...base, ...calculation, status: 'partial_coverage', official: false };
  return { ...base, ...calculation, status: 'available', official: true };
}

function plannedBreakEvenFromCommitments(db, query = {}) {
  const state = ensureFinanceV2(db);
  const branchId = query.branchId ? Number(query.branchId) : null;
  const referenceDate = String(query.to || now()).slice(0, 10);
  const reference = new Date(`${referenceDate}T00:00:00.000Z`);
  const defaultFrom = `${reference.getUTCFullYear()}-${String(reference.getUTCMonth() + 1).padStart(2, '0')}-01`;
  const defaultTo = new Date(Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
  const reportFrom = String(query.from || defaultFrom).slice(0, 10);
  const reportTo = String(query.to || defaultTo).slice(0, 10);
  const reportFromAt = new Date(`${reportFrom}T00:00:00.000Z`);
  const reportToAt = new Date(`${reportTo}T00:00:00.000Z`);
  if (!Number.isFinite(reportFromAt.getTime()) || !Number.isFinite(reportToAt.getTime()) || reportFromAt > reportToAt) {
    return { status: 'insufficient_data', source: 'active cost commitments + posted Finance V2 contribution', committedFixedCostIrr: 0, commitmentCount: 0, commitments: [], missing: ['reporting_period_invalid'], breakEvenSalesIrr: null };
  }
  const commitments = state.costCommitments.filter((row) => row.status === 'active' && sameBranch(row, branchId)
    && row.startDate <= reportTo && (!row.endDate || row.endDate >= reportFrom));
  const fixedCommitments = commitments.filter((row) => row.behavior === 'fixed');
  const allocationFor = (commitment) => {
    const activeFrom = new Date(`${commitment.startDate > reportFrom ? commitment.startDate : reportFrom}T00:00:00.000Z`);
    const activeToKey = commitment.endDate && commitment.endDate < reportTo ? commitment.endDate : reportTo;
    const activeTo = new Date(`${activeToKey}T00:00:00.000Z`);
    let cursor = new Date(Date.UTC(activeFrom.getUTCFullYear(), activeFrom.getUTCMonth(), 1));
    let allocatedIrr = 0;
    const months = [];
    while (cursor <= activeTo) {
      const year = cursor.getUTCFullYear();
      const month = cursor.getUTCMonth();
      const monthStart = new Date(Date.UTC(year, month, 1));
      const monthEnd = new Date(Date.UTC(year, month + 1, 0));
      const sliceStart = activeFrom > monthStart ? activeFrom : monthStart;
      const sliceEnd = activeTo < monthEnd ? activeTo : monthEnd;
      const daysInMonth = monthEnd.getUTCDate();
      const activeDays = sliceStart <= sliceEnd ? Math.floor((sliceEnd - sliceStart) / 86400000) + 1 : 0;
      const amountIrr = Math.round(int(commitment.monthlyAmountIrr) * activeDays / daysInMonth);
      if (activeDays) { allocatedIrr += amountIrr; months.push({ month: monthStart.toISOString().slice(0, 7), activeDays, daysInMonth, amountIrr }); }
      cursor = new Date(Date.UTC(year, month + 1, 1));
    }
    return { ...commitment, allocatedIrr, months };
  };
  const allocatedCommitments = fixedCommitments.map(allocationFor);
  const committedFixedCostIrr = allocatedCommitments.reduce((sum, row) => sum + row.allocatedIrr, 0);
  const actual = actualBreakEvenFromLedger(db, query);
  const missing = [];
  if (!committedFixedCostIrr) missing.push('fixed_cost_commitments');
  if (actual.netSalesIrr <= 0) missing.push('net_sales');
  if (actual.missing.includes('variable_cost')) missing.push('variable_cost');
  const base = {
    source: 'active cost commitments + posted Finance V2 contribution', committedFixedCostIrr,
    commitmentCount: fixedCommitments.length, netSalesIrr: actual.netSalesIrr, variableCostIrr: actual.variableCostIrr,
    reportingPeriod: { from: reportFrom, to: reportTo, proration: 'calendar_days_per_month' },
    commitments: allocatedCommitments.map((row) => ({ id: row.id, name: row.name, type: row.type, monthlyAmountIrr: row.monthlyAmountIrr, allocatedIrr: row.allocatedIrr, months: row.months, expenseAccount: row.expenseAccount })),
    missing,
  };
  if (missing.length) return { ...base, status: 'insufficient_data', breakEvenSalesIrr: null };
  const calculation = restaurantIntelligence.calculateBreakEven({
    fixedCostsIrr: [committedFixedCostIrr],
    sales: [{ revenueIrr: actual.netSalesIrr, variableCostIrr: actual.variableCostIrr }],
    realizedNetSalesIrr: actual.netSalesIrr,
  });
  return { ...base, ...calculation };
}

function activeBreakEvenPlan(state, branchId) {
  return state.breakEvenPlans
    .filter((plan) => plan.status === 'active' && Number(plan.branchId) === Number(branchId))
    .sort((left, right) => new Date(right.updatedAt || right.createdAt || 0) - new Date(left.updatedAt || left.createdAt || 0))[0] || null;
}

function suggestedBreakEvenPlan(branchId, asOfDate = tehranDateKey()) {
  const startDate = monthStartDate(asOfDate);
  const deadlineDate = monthEndDate(asOfDate);
  const scenario = breakEvenDefaults.createBreakEvenPlanningDefaults({ branchId });
  return {
    ...scenario,
    id: null,
    name: 'مبنای برنامهٔ سودآوری',
    status: 'suggested',
    startDate,
    deadlineDate,
    deadline: {
      ...scenario.deadline,
      targetDate: deadlineDate,
      status: 'suggested',
      label: 'ددلاین پیشنهادی تا زمان تأیید کاربر',
      isSuggested: true,
      isConfirmed: false,
      confirmedAt: null,
      confirmedBy: null,
    },
    monthlyFixedCostIrr: breakEvenDefaults.getMonthlyPlanningCostSummary(scenario).totalAmountIrr,
  };
}

function planText(value, fallback, limit = 160) {
  const text = String(value ?? '').trim().slice(0, limit);
  return text || fallback;
}

function optionalPlanInteger(value, code) {
  if (value == null || value === '') return null;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw Object.assign(new Error('جزئیات هزینهٔ برنامه باید عدد صحیح نامنفی باشد.'), { code, status: 400 });
  return number;
}

function deadlineWasConfirmed(input = {}) {
  const value = input.deadlineConfirmed ?? input.deadline?.isConfirmed ?? input.deadline?.confirmed;
  return value === true || value === 1 || value === '1' || value === 'true' || value === 'on';
}

function normalizeBreakEvenPlanAssumptions(input, suggested, existingPlan = null) {
  const proposed = Array.isArray(input?.assumptions) && input.assumptions.length
    ? input.assumptions
    : Array.isArray(existingPlan?.assumptions) && existingPlan.assumptions.length
      ? existingPlan.assumptions : suggested.assumptions;
  const defaultsById = new Map(suggested.assumptions.map((row) => [String(row.id), row]));
  const seen = new Set();
  const assumptions = proposed.map((row, index) => {
    const fallback = defaultsById.get(String(row?.id || '')) || {};
    const assumptionId = planText(row?.id, fallback.id || `planning-fixed-${index + 1}`, 120);
    if (seen.has(assumptionId)) {
      throw Object.assign(new Error('شناسهٔ هزینه‌های ثابت برنامه نباید تکراری باشد.'), { code: 'break_even_plan_assumption_duplicate', status: 400 });
    }
    seen.add(assumptionId);
    const amountIrr = safeIrr(row?.monthlyAmountIrr ?? row?.amountIrr ?? fallback.amountIrr, 'break_even_plan_amount_invalid');
    const headcount = optionalPlanInteger(row?.headcount ?? fallback.headcount, 'break_even_plan_headcount_invalid');
    const salaryPerPersonIrr = optionalPlanInteger(row?.salaryPerPersonIrr ?? fallback.salaryPerPersonIrr, 'break_even_plan_salary_invalid');
    return {
      id: assumptionId,
      name: planText(row?.name, fallback.name || `هزینهٔ ثابت ${index + 1}`),
      categoryId: planText(row?.categoryId, fallback.categoryId || 'other_fixed', 80),
      categoryCode: planText(row?.categoryCode ?? row?.category, fallback.categoryCode || 'other_fixed', 80),
      categoryName: planText(row?.categoryName, fallback.categoryName || 'سایر هزینه ثابت', 120),
      amountIrr,
      monthlyAmountIrr: amountIrr,
      amountToman: amountIrr / 10,
      monthlyAmountToman: amountIrr / 10,
      period: { unit: 'month', interval: 1, label: 'ماهانه' },
      status: breakEvenDefaults.PLANNING_ASSUMPTION_STATUS,
      statusLabel: breakEvenDefaults.PLANNING_ASSUMPTION_LABEL,
      source: breakEvenDefaults.PLANNING_ASSUMPTION_SOURCE,
      sourceLabel: breakEvenDefaults.PLANNING_ASSUMPTION_SOURCE_LABEL,
      actualRecord: false,
      isSampleData: false,
      editable: true,
      writePolicy: 'non_destructive',
      ...(headcount == null ? {} : { headcount }),
      ...(salaryPerPersonIrr == null ? {} : { salaryPerPersonIrr, salaryPerPersonToman: salaryPerPersonIrr / 10 }),
    };
  });
  if (!assumptions.length || !assumptions.some((row) => row.amountIrr > 0)) {
    throw Object.assign(new Error('حداقل یک هزینهٔ ثابت ماهانه با مبلغ بزرگ‌تر از صفر لازم است.'), { code: 'break_even_plan_fixed_cost_missing', status: 400 });
  }
  return assumptions;
}

function breakEvenPlanView(plan) {
  if (!plan) return null;
  const summary = breakEvenDefaults.getMonthlyPlanningCostSummary(plan);
  return {
    id: plan.id,
    branchId: plan.branchId,
    name: plan.name,
    status: plan.status,
    source: plan.source,
    sourceLabel: plan.sourceLabel,
    actualRecord: false,
    isSampleData: false,
    writePolicy: 'non_destructive',
    actualsPolicy: 'exclude_from_actual_expenses_and_ledger',
    startDate: plan.startDate,
    deadlineDate: plan.deadlineDate,
    deadline: {
      ...(plan.deadline || {}),
      targetDate: plan.deadlineDate,
      status: 'configured',
      isSuggested: false,
      isConfirmed: plan.deadline?.isConfirmed === true,
      confirmedAt: plan.deadline?.confirmedAt || null,
      confirmedBy: plan.deadline?.confirmedBy || null,
    },
    assumptions: list(plan.assumptions).map((row) => ({ ...row })),
    monthlyFixedCostIrr: summary.totalAmountIrr,
    createdAt: plan.createdAt,
    updatedAt: plan.updatedAt,
    version: plan.version || 1,
  };
}

function upsertBreakEvenPlan(db, input = {}, actor = null) {
  const state = ensureFinanceV2(db);
  const branchId = Number(input.branchId);
  if (!Number.isSafeInteger(branchId) || branchId <= 0) {
    throw Object.assign(new Error('شعبهٔ برنامهٔ سودآوری الزامی است.'), { code: 'break_even_plan_branch_required', status: 400 });
  }
  const requestedPlanId = String(input.planId || input.id || '').trim();
  const byId = requestedPlanId ? state.breakEvenPlans.find((row) => row.id === requestedPlanId) : null;
  if (requestedPlanId && !byId) throw Object.assign(new Error('برنامهٔ سودآوری یافت نشد.'), { code: 'break_even_plan_not_found', status: 404 });
  if (byId && Number(byId.branchId) !== branchId) throw Object.assign(new Error('برنامهٔ انتخاب‌شده متعلق به این شعبه نیست.'), { code: 'break_even_plan_branch_mismatch', status: 409 });
  const existing = byId || activeBreakEvenPlan(state, branchId);
  const asOfDate = tehranDateKey();
  const suggested = suggestedBreakEvenPlan(branchId, asOfDate);
  const startDate = breakEvenEngine.dateKey(input.startDate || existing?.startDate || suggested.startDate, 'break_even_plan_start_date_invalid');
  const deadlineDate = breakEvenEngine.dateKey(input.deadlineDate || input.deadline?.targetDate || existing?.deadlineDate || suggested.deadlineDate, 'break_even_plan_deadline_invalid');
  breakEvenEngine.dateRange(startDate, deadlineDate);
  if (!deadlineWasConfirmed(input)) {
    throw Object.assign(new Error('پیش از ذخیرهٔ برنامه، ددلاین واقعی سوددهی را تأیید کنید.'), { code: 'break_even_plan_deadline_confirmation_required', status: 400 });
  }
  const assumptions = normalizeBreakEvenPlanAssumptions(input, suggested, existing);
  const at = now();
  const plan = {
    id: existing?.id || id(),
    branchId,
    name: planText(input.name, existing?.name || suggested.name),
    status: 'active',
    source: breakEvenDefaults.PLANNING_ASSUMPTION_SOURCE,
    sourceLabel: breakEvenDefaults.PLANNING_ASSUMPTION_SOURCE_LABEL,
    actualRecord: false,
    isSampleData: false,
    writePolicy: 'non_destructive',
    actualsPolicy: 'exclude_from_actual_expenses_and_ledger',
    startDate,
    deadlineDate,
    deadline: {
      targetDate: deadlineDate,
      status: 'configured',
      targetMetric: 'cumulative_operating_profit_irr',
      comparison: 'gte',
      targetAmountIrr: 0,
      label: 'ددلاین رسیدن به سوددهی',
      editable: true,
      isConfirmed: true,
      confirmedAt: at,
      confirmedBy: actor || null,
    },
    assumptions,
    createdBy: existing?.createdBy || actor,
    createdAt: existing?.createdAt || at,
    updatedBy: actor,
    updatedAt: at,
    version: (existing?.version || 0) + 1,
  };
  if (existing) Object.assign(existing, plan);
  else state.breakEvenPlans.push(plan);
  return { plan: breakEvenPlanView(plan), created: !existing };
}

function contributionRowsSummary(rows) {
  return list(rows).reduce((summary, row) => ({
    netSalesIrr: summary.netSalesIrr + int(row.salesIrr),
    variableCostIrr: summary.variableCostIrr + int(row.variableCostIrr),
    rowCount: summary.rowCount + 1,
  }), { netSalesIrr: 0, variableCostIrr: 0, rowCount: 0 });
}

function isUsableContributionSource(candidate) {
  const summary = candidate.summary;
  return summary.netSalesIrr > 0
    && summary.variableCostIrr > 0
    && summary.netSalesIrr > summary.variableCostIrr;
}

function postedLedgerContributionRows(db, { branchId, startDate, asOfDate }) {
  const state = ensureFinanceV2(db);
  const byDate = new Map();
  for (const entry of state.journalEntries) {
    if (entry.status !== 'posted' || !sameBranch(entry, branchId)) continue;
    const date = tehranDateKey(entry.date || entry.postedAt || entry.createdAt);
    if (!date || compareDateKeys(date, startDate) < 0 || compareDateKeys(date, asOfDate) > 0) continue;
    const row = byDate.get(date) || { date, salesIrr: 0, variableCostIrr: 0 };
    for (const line of list(entry.lines)) {
      const accountCode = String(line.accountCode || '');
      if (SALES_ACCOUNTS.has(accountCode)) row.salesIrr += int(line.creditIrr) - int(line.debitIrr);
      if (RESTAURANT_COST_BEHAVIOR[accountCode]?.behavior === 'variable') row.variableCostIrr += int(line.debitIrr) - int(line.creditIrr);
    }
    byDate.set(date, row);
  }
  const rows = [...byDate.values()].sort((left, right) => compareDateKeys(left.date, right.date));
  return {
    source: { type: 'posted_ledger', label: 'اسناد قطعی دفتر مالی', official: true, coverage: 'posted_journal_lines' },
    rows,
    summary: contributionRowsSummary(rows),
  };
}

function recipeSnapshotContributionRows(db, { branchId, startDate, asOfDate }) {
  const state = ensureFinanceV2(db);
  const byDate = new Map();
  for (const snapshot of state.orderItemCostSnapshots) {
    if (!sameBranch(snapshot, branchId)) continue;
    const date = tehranDateKey(snapshot.capturedAt || snapshot.createdAt || snapshot.date);
    if (!date || compareDateKeys(date, startDate) < 0 || compareDateKeys(date, asOfDate) > 0) continue;
    const row = byDate.get(date) || { date, salesIrr: 0, variableCostIrr: 0 };
    row.salesIrr += int(snapshot.netSalesIrr);
    row.variableCostIrr += int(snapshot.theoreticalCogsIrr);
    byDate.set(date, row);
  }
  const rows = [...byDate.values()].sort((left, right) => compareDateKeys(left.date, right.date));
  return {
    source: { type: 'recipe_cost_snapshots', label: 'دستور تهیهٔ نسخه‌دار و ثبت لحظه‌ای بهای تمام‌شدهٔ فروش', official: false, coverage: 'recipe_snapshot_backed' },
    rows,
    summary: contributionRowsSummary(rows),
  };
}

function chooseContributionSource(db, options) {
  const ledger = postedLedgerContributionRows(db, options);
  const snapshots = recipeSnapshotContributionRows(db, options);
  const selected = isUsableContributionSource(ledger) ? ledger
    : isUsableContributionSource(snapshots) ? snapshots
      : ledger.summary.rowCount ? ledger : snapshots.summary.rowCount ? snapshots : ledger;
  return {
    selected,
    candidates: [ledger, snapshots].map((candidate) => ({
      source: candidate.source,
      ...candidate.summary,
      usable: isUsableContributionSource(candidate),
    })),
  };
}

function breakEvenChartPayload(plan, projection) {
  const period = projection.period || {};
  return {
    status: projection.status,
    amountUnit: 'IRR',
    title: 'نقطهٔ سربه‌سر و مسیر سوددهی',
    subtitle: 'فروش تجمعی در برابر هزینهٔ برنامه‌ای تا ددلاین؛ هزینهٔ ثابت برنامه از عملکرد واقعی جدا نگه‌داری شده است.',
    totalFixedCostsIrr: projection.totalFixedCostsIrr || projection.fixedCostTotalIrr || 0,
    realizedNetSalesIrr: projection.realizedNetSalesIrr || 0,
    variableCostIrr: projection.variableCostIrr || 0,
    contributionMarginRatio: projection.contributionMarginRatio,
    breakEvenSalesIrr: projection.breakEvenSalesIrr,
    targetSalesIrr: projection.breakEvenSalesIrr,
    gapIrr: projection.gapIrr,
    requiredDailySalesIrr: projection.requiredDailySalesIrr,
    deadline: plan.deadlineDate,
    periodStart: plan.startDate,
    asOf: period.asOfDate,
    periodDays: period.calendarDays,
    daysElapsed: period.elapsedCalendarDays,
    remainingOpenDays: period.remainingOpenDays,
    breakEvenDay: projection.forecast?.breakEvenDay ?? null,
    source: projection.source,
    deadlineStatus: projection.forecast?.deadlineStatus || null,
    series: list(projection.series),
  };
}

function breakEvenDataSources(sourceChoice) {
  return {
    selected: sourceChoice.selected.source,
    candidates: sourceChoice.candidates,
    policy: 'فروش و هزینهٔ متغیر فقط از یک منبع هم‌مبنای انتخاب می‌شوند؛ دادهٔ برنامه‌ای وارد دفتر واقعی نمی‌شود.',
  };
}

function breakEvenDashboard(db, query = {}) {
  const state = ensureFinanceV2(db);
  const branchId = Number(query.branchId);
  const asOfDate = query.asOfDate
    ? breakEvenEngine.dateKey(query.asOfDate, 'break_even_dashboard_as_of_invalid')
    : tehranDateKey();
  if (!Number.isSafeInteger(branchId) || branchId <= 0) {
    return {
      status: 'needs_branch',
      asOfDate,
      plan: null,
      suggestedPlan: null,
      chart: { status: 'insufficient_data', title: 'نقطهٔ سربه‌سر و مسیر سوددهی' },
      message: 'برای تحلیل نقطهٔ سربه‌سر، شعبه را مشخص کنید.',
    };
  }
  const plan = activeBreakEvenPlan(state, branchId);
  const suggestedPlan = suggestedBreakEvenPlan(branchId, asOfDate);
  const basis = plan || suggestedPlan;
  const sourceChoice = chooseContributionSource(db, { branchId, startDate: basis.startDate, asOfDate });
  if (!plan) {
    return {
      status: 'needs_plan',
      asOfDate,
      plan: null,
      suggestedPlan,
      dataSources: breakEvenDataSources(sourceChoice),
      chart: { status: 'insufficient_data', title: 'نقطهٔ سربه‌سر و مسیر سوددهی' },
      message: 'مبنای برنامه‌ای هنوز ثبت نشده است؛ مبالغ پیشنهادی فقط برای بازبینی هستند و وارد دفتر مالی نشده‌اند.',
    };
  }
  const projection = breakEvenEngine.buildBreakEvenProjection({
    startDate: plan.startDate,
    deadlineDate: plan.deadlineDate,
    asOfDate,
    fixedCostLines: list(plan.assumptions).map((row) => ({ id: row.id, name: row.name, category: row.categoryCode, monthlyAmountIrr: row.monthlyAmountIrr ?? row.amountIrr })),
    actualDaily: sourceChoice.selected.rows,
    source: sourceChoice.selected.source,
  });
  return {
    status: projection.status,
    asOfDate,
    plan: breakEvenPlanView(plan),
    suggestedPlan,
    dataSources: breakEvenDataSources(sourceChoice),
    projection,
    chart: breakEvenChartPayload(plan, projection),
  };
}

function costingInventory(db, query = {}) {
  const acc = db.accounting || {};
  const state = ensureFinanceV2(db);
  const branchId = query.branchId ? Number(query.branchId) : null;
  // Keep the approval-evidence queue visible in the costing workspace.  A
  // recipe can be structurally versioned yet still be ineligible for official
  // COGS when its independent approval chain is missing; hiding that fact
  // behind the generic "recipe count" would make the release gate opaque.
  const quality = dataQuality(db, branchId);
  const approvalById = new Map(state.approvals.map((approval) => [String(approval.id), approval]));
  const recipeApprovalReviewQueue = quality.recipesMissingApprovalEvidence
    .map((recipe) => {
      const approval = recipe.approvalId == null ? null : approvalById.get(String(recipe.approvalId));
      const missingEvidence = [];
      if (!recipe.approvedBy) missingEvidence.push('approved_by');
      if (!recipe.approvedAt) missingEvidence.push('approved_at');
      if (!approval) missingEvidence.push('approval_record');
      else {
        if (approval.entityType !== 'recipe_version') missingEvidence.push('approval_entity');
        if (String(approval.entityId) !== String(recipe.id)) missingEvidence.push('approval_entity_id');
        if (approval.operation !== 'approve_recipe_version') missingEvidence.push('approval_operation');
        if (approval.status !== 'approved') missingEvidence.push('approval_decision');
      }
      return {
        id: recipe.id,
        recipeId: recipe.recipeId || null,
        menuItemId: recipe.menuItemId == null ? null : String(recipe.menuItemId),
        menuItemName: recipe.menuItemName || recipe.name || null,
        branchId: recipe.branchId ?? null,
        version: recipe.version ?? null,
        status: recipe.status || null,
        effectiveFrom: recipe.effectiveFrom || null,
        approvalId: recipe.approvalId || null,
        approvalStatus: approval?.status || null,
        missingEvidence,
      };
    })
    .sort((left, right) => String(left.menuItemName || left.menuItemId || left.id)
      .localeCompare(String(right.menuItemName || right.menuItemId || right.id), 'fa'));
  const items = list(acc.inventoryItems).filter((row) => sameBranch(row, branchId));
  const recipes = restaurantIntelligence.recipeCatalog(db, branchId);
  const transactions = list(acc.inventoryTransactions).filter((row) => sameBranch(row, branchId) && inRange(row, query.from, query.to, 'date'));
  const waste = list(acc.wasteLog).filter((row) => sameBranch(row, branchId) && inRange(row, query.from, query.to, 'date'));
  const invalidCostItems = items.filter((row) => {
    const cost = row.unitCostIrr ?? row.avgCostIrr ?? row.unitCost ?? row.avgCost ?? row.cost;
    return !Number.isFinite(Number(cost)) || Number(cost) < 0;
  });
  const recipeWithoutVersion = recipes.filter((row) => !row.version && !row.versionId && !row.effectiveFrom);
  const intelligence = restaurantIntelligence.deriveRestaurantIntelligence(db, query);
  const costSnapshots = state.orderItemCostSnapshots.filter((row) => sameBranch(row, branchId) && inRange(row, query.from, query.to, 'capturedAt'));
  const shadowMovements = state.inventoryMovements.filter((row) => sameBranch(row, branchId) && inRange(row, query.from, query.to, 'occurredAt'));
  const actualConsumeMovements = shadowMovements.filter((row) => (
    row.movementType === 'sale_consumption'
    || row.movementType === 'waste'
    || row.movementType === 'count_adjustment' && Number(row.quantityBase) < 0
  ));
  const movementValue = (movement) => {
    if (movement.totalCostIrr != null) return int(movement.totalCostIrr);
    const valuation = state.inventoryMovementValuations.find((row) => row.movementId === movement.id);
    return valuation ? int(valuation.totalCostIrr) : null;
  };
  const valuedActualMovements = actualConsumeMovements.map((movement) => ({ movement, value: movementValue(movement) }));
  const valuedMovementAmount = (movementType, predicate = () => true) => {
    const rows = valuedActualMovements.filter((row) => row.movement.movementType === movementType && predicate(row.movement));
    return rows.length && rows.every((row) => row.value != null) ? rows.reduce((sum, row) => sum + row.value, 0) : rows.length ? null : 0;
  };
  const postedCogsIrr = state.journalEntries
    .filter((entry) => entry.source === 'order.cogs' && entry.status === 'posted' && sameBranch(entry, branchId) && inRange(entry, query.from, query.to, 'date'))
    .reduce((sum, entry) => sum + int(entry.debitIrr), 0);
  const profitabilityMap = new Map();
  for (const snapshot of costSnapshots) {
    const key = String(snapshot.menuItemId || snapshot.itemName || snapshot.recipeVersionId || 'unknown');
    const row = profitabilityMap.get(key) || {
      menuItemId: snapshot.menuItemId || null, name: snapshot.itemName || snapshot.menuItemId || 'محصول نامشخص',
      quantity: 0, netSalesIrr: 0, theoreticalCogsIrr: 0, snapshotCount: 0,
    };
    row.quantity += Number(snapshot.quantity) || 0;
    row.netSalesIrr += int(snapshot.netSalesIrr);
    row.theoreticalCogsIrr += int(snapshot.theoreticalCogsIrr);
    row.snapshotCount += 1;
    profitabilityMap.set(key, row);
  }
  const scopedRefunds = state.refunds.filter((row) => row.status === 'succeeded'
    && row.recognitionState !== 'customer_deposit'
    && sameBranch(row, branchId) && inRange(row, query.from, query.to, 'refundDate'));
  const itemProfitability = [...profitabilityMap.values()].map((row) => {
    const contributionIrr = row.netSalesIrr - row.theoreticalCogsIrr;
    const contributionMarginPercent = row.netSalesIrr > 0 ? Math.round(contributionIrr / row.netSalesIrr * 10000) / 100 : null;
    return {
      ...row, theoreticalGrossProfitIrr: contributionIrr, theoreticalGrossMarginPercent: contributionMarginPercent,
      contributionIrr, contributionMarginPercent,
      status: scopedRefunds.length ? 'partial_coverage' : 'snapshot_backed',
      action: contributionIrr < 0 ? 'stop_and_review' : contributionMarginPercent != null && contributionMarginPercent < 40 ? 'review_cost_or_price' : 'monitor',
      limitation: scopedRefunds.length ? 'refunds_not_allocated_to_order_lines' : null,
    };
  }).sort((a, b) => a.contributionMarginPercent - b.contributionMarginPercent || b.netSalesIrr - a.netSalesIrr);
  const stockoutActions = list(intelligence.stockoutForecast?.items).map((forecast) => {
    const item = items.find((row) => String(row.id) === String(forecast.itemId));
    const leadTimeDays = Number(forecast.leadTimeDays ?? item?.leadTimeDays ?? item?.supplierLeadTimeDays);
    if (forecast.forecastStatus === 'beyond_horizon' || !forecast.forecastDate) {
      return { ...forecast, actionStatus: 'monitor', reorderByDate: null, suggestedOrderQuantity: 0, inboundUsedInSuggestion: 0 };
    }
    if (!Number.isFinite(leadTimeDays) || leadTimeDays < 0) return { ...forecast, actionStatus: 'lead_time_missing', reorderByDate: null, suggestedOrderQuantity: null };
    const safetyDays = Number.isFinite(Number(forecast.safetyDays)) ? Math.max(0, Number(forecast.safetyDays)) : 0;
    const forecastAt = new Date(`${forecast.forecastDate}T00:00:00.000Z`);
    const reorderBy = forecast.reorderByDate
      ? new Date(`${forecast.reorderByDate}T00:00:00.000Z`)
      : new Date(forecastAt.getTime() - (leadTimeDays + safetyDays) * 86400000);
    const targetCoverageDays = leadTimeDays + safetyDays + 7;
    const targetDate = new Date(`${intelligence.stockoutForecast.asOfDate || forecast.forecastDate}T00:00:00.000Z`);
    targetDate.setUTCDate(targetDate.getUTCDate() + Math.ceil(targetCoverageDays));
    const inboundUsedInSuggestion = list(forecast.inboundSchedule)
      .filter((row) => new Date(`${row.expectedDate}T00:00:00.000Z`) <= targetDate)
      .reduce((sum, row) => sum + Number(row.quantity || 0), 0);
    const targetQuantity = forecast.averageDailyUsage * targetCoverageDays + Math.max(0, Number(forecast.reorderPoint) || 0);
    const suggestedOrderQuantity = Math.max(0, Math.ceil((targetQuantity - forecast.availableQuantity - inboundUsedInSuggestion) * 1000) / 1000);
    const asOf = new Date(`${intelligence.stockoutForecast.asOfDate || new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
    return {
      ...forecast, leadTimeDays, safetyDays, actionStatus: reorderBy.getTime() <= asOf.getTime() ? 'order_now' : 'scheduled',
      reorderByDate: reorderBy.toISOString().slice(0, 10), suggestedOrderQuantity, inboundUsedInSuggestion,
    };
  });
  const coverageByMenuItem = new Map();
  for (const issue of list(intelligence.stockoutForecast?.coverageIssues)) {
    const menuItemId = issue.menuItemId == null ? 'unknown' : String(issue.menuItemId);
    const row = coverageByMenuItem.get(menuItemId) || {
      menuItemId: menuItemId === 'unknown' ? null : menuItemId,
      menuItemName: null,
      affectedSaleLines: 0,
      issueCounts: {},
      latestOrderIds: [],
    };
    row.affectedSaleLines += 1;
    row.issueCounts[issue.code || 'unknown'] = int(row.issueCounts[issue.code || 'unknown']) + 1;
    if (issue.orderId != null && !row.latestOrderIds.includes(String(issue.orderId)) && row.latestOrderIds.length < 5) row.latestOrderIds.push(String(issue.orderId));
    coverageByMenuItem.set(menuItemId, row);
  }
  const menuNames = new Map(list(db.menuItems).map((row) => [String(row.id), row.name || row.title || String(row.id)]));
  const recipeCoverageQueue = [...coverageByMenuItem.values()]
    .map((row) => ({ ...row, menuItemName: row.menuItemId ? menuNames.get(row.menuItemId) || `محصول ${row.menuItemId}` : 'محصول نامشخص' }))
    .sort((a, b) => b.affectedSaleLines - a.affectedSaleLines || String(a.menuItemName).localeCompare(String(b.menuItemName), 'fa'));
  return {
    items, recipes, transactions, waste, orderItemCostSnapshots: costSnapshots, shadowInventoryMovements: shadowMovements,
    summary: {
      inventoryItems: items.length, recipes: recipes.length, movements: transactions.length,
      shadowMovements: shadowMovements.length, costSnapshots: costSnapshots.length,
      wasteEvents: waste.length, invalidCostItems: invalidCostItems.length,
      unversionedRecipes: recipeWithoutVersion.length,
      recipeApprovalAuditMissing: recipeApprovalReviewQueue.length,
    },
    theoreticalCogs: { status: costSnapshots.length ? 'snapshot_backed' : 'insufficient_data', amountIrr: costSnapshots.length ? costSnapshots.reduce((sum, row) => sum + int(row.theoreticalCogsIrr), 0) : null },
    actualConsumption: {
      status: actualConsumeMovements.length
        ? valuedActualMovements.every((row) => row.value != null) ? 'movement_backed' : 'partial_valuation'
        : 'insufficient_data',
      amountIrr: actualConsumeMovements.length && valuedActualMovements.every((row) => row.value != null)
        ? valuedActualMovements.reduce((sum, row) => sum + row.value, 0) : null,
      postedCogsIrr: actualConsumeMovements.length ? postedCogsIrr : null,
      movementCount: actualConsumeMovements.length,
      unvaluedMovementIds: valuedActualMovements.filter((row) => row.value == null).map((row) => row.movement.id),
      components: {
        theoreticalSaleConsumptionIrr: valuedMovementAmount('sale_consumption'),
        wasteIrr: valuedMovementAmount('waste'),
        negativeCountAdjustmentIrr: valuedMovementAmount('count_adjustment', (movement) => Number(movement.quantityBase) < 0),
      },
    },
    itemProfitability: {
      status: itemProfitability.length ? scopedRefunds.length ? 'partial_coverage' : 'snapshot_backed' : 'insufficient_data',
      rows: itemProfitability, refundCountNotAllocated: scopedRefunds.length,
    },
    stockoutActions, recipeCoverageQueue, recipeApprovalReviewQueue,
    dataQuality: {
      invalidCostItemIds: invalidCostItems.map((row) => row.id),
      unversionedRecipeIds: recipeWithoutVersion.map((row) => row.id),
      recipeApprovalAuditMissingIds: recipeApprovalReviewQueue.map((row) => row.id),
    },
    intelligence,
    actualBreakEven: actualBreakEvenFromLedger(db, query),
    plannedBreakEven: plannedBreakEvenFromCommitments(db, query),
    breakEvenDashboard: breakEvenDashboard(db, query),
    operationalEntryPoints: { waste: '/admin/kitchen', receiving: '/admin/kitchen', stockCount: '/admin/kitchen' },
  };
}

function kitchenInventory(db, query = {}) {
  const state = ensureFinanceV2(db);
  const branchId = Number(query.branchId) || null;
  if (!branchId) throw Object.assign(new Error('شعبه مشخص نیست.'), { code: 'branch_missing', status: 400 });
  const intelligence = restaurantIntelligence.deriveRestaurantIntelligence(db, { ...query, branchId });
  const items = list(db.accounting?.inventoryItems)
    .filter((row) => sameBranch(row, branchId))
    .map((row) => {
      const available = orderCosting.physicalAvailable(row, state, branchId);
      const quantity = available.ok ? available.value : null;
      const reorderPoint = Number.isFinite(Number(row.minStock ?? row.reorderPoint)) ? Number(row.minStock ?? row.reorderPoint) : null;
      return {
        id: String(row.id), sku: row.sku || null, name: row.name || String(row.id), unit: row.unit || null,
        availableQuantity: quantity, openingQuantity: available.openingOnHand ?? null,
        movementQuantity: available.shadowMovement ?? null, reorderPoint,
        status: !available.ok ? 'insufficient_data' : quantity < 0 ? 'negative' : reorderPoint != null && quantity <= reorderPoint ? 'reorder' : 'available',
        issue: available.ok ? null : available.code,
      };
    })
    .sort((a, b) => String(a.name).localeCompare(String(b.name), 'fa'));
  const productionRecipes = restaurantIntelligence.recipeCatalog(db, branchId)
    .filter((row) => row.outputItemId)
    .map((row) => ({
      id: String(row.id), name: row.name || String(row.id), version: row.version || row.versionId || null,
      outputItemId: String(row.outputItemId), outputUnit: inventoryOperations.inventoryItem(db, row.outputItemId, branchId)?.unit || null,
      defaultPlannedYield: Number(row.batchYield ?? row.servings ?? row.yieldQuantity) || 1,
    }));
  const menuItems = list(db.menuItems)
    .filter((row) => row.active !== false && (row.branchId == null || sameBranch(row, branchId)))
    .map((row) => ({ id: String(row.id), name: row.name || row.title || String(row.id), category: row.category || row.categoryName || null }))
    .sort((a, b) => String(a.name).localeCompare(String(b.name), 'fa'));
  const recipeVersions = state.recipeVersions
    .filter((row) => sameBranch(row, branchId))
    .slice()
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map((row) => ({
      id: row.id, recipeId: row.recipeId, menuItemId: String(row.menuItemId), menuItemName: row.menuItemName,
      name: row.name, version: row.version, yieldQuantity: row.yieldQuantity, effectiveFrom: row.effectiveFrom,
      effectiveTo: row.effectiveTo || null, outputItemId: row.outputItemId || null, status: row.status,
      approvalId: row.approvalId, createdBy: row.createdBy, createdAt: row.createdAt,
      approvedBy: row.approvedBy || null, approvedAt: row.approvedAt || null,
      rejectedBy: row.rejectedBy || null, rejectedAt: row.rejectedAt || null,
      ingredients: list(row.ingredients).map((ingredient) => ({
        id: ingredient.id, lineNo: ingredient.lineNo, itemId: ingredient.itemId, itemName: ingredient.itemName,
        quantity: ingredient.quantity, unit: ingredient.unit, baseUnit: ingredient.baseUnit,
        quantityBasis: ingredient.quantityBasis, yieldPercent: ingredient.yieldPercent,
      })),
    }));
  const allVendors = list(db.accounting?.vendors);
  const spotVendorExists = allVendors.some((row) => row.id === 'vendor-spot' || row.isSpot);
  const defaultSpot = {
    id: 'vendor-spot',
    name: 'خرید آزاد / بازار روز',
    nameFa: 'خرید آزاد / بازار روز',
    category: 'آزاد',
    phone: '',
    contactPerson: 'خرید متفرقه و حضوری',
    termsDays: 0,
    isSpot: true,
    itemIds: [],
    active: true,
    balance: 0,
  };
  const vendorsList = spotVendorExists ? allVendors : [defaultSpot, ...allVendors];
  const vendors = vendorsList
    .filter((row) => row.branchId == null || sameBranch(row, branchId))
    .map((row) => ({
      id: String(row.id),
      name: row.name || row.nameFa || String(row.id),
      nameFa: row.nameFa || row.name || String(row.id),
      category: row.category || 'عمومی',
      phone: row.phone || '',
      contactPerson: row.contactPerson || '',
      termsDays: Number(row.termsDays) || 0,
      isSpot: Boolean(row.isSpot || row.category === 'آزاد' || row.id === 'vendor-spot'),
      itemIds: list(row.itemIds || row.materialIds).map(String),
      notes: row.notes || '',
      active: row.active !== false,
      balance: Number(row.balance || 0),
    }));
  const vendorNames = new Map(vendorsList.map((row) => [String(row.id), row.nameFa || row.name || String(row.id)]));
  const receivablePurchaseOrders = state.purchaseOrders
    .filter((row) => sameBranch(row, branchId) && ['approved', 'partially_received'].includes(row.status))
    .map((row) => ({
      id: row.id,
      number: row.number,
      vendorName: vendorNames.get(String(row.vendorId)) || 'تأمین‌کننده ثبت‌شده',
      expectedDate: row.expectedDate || null,
      lines: list(row.lines)
        .filter((line) => Number(line.receivedQuantity || 0) < Number(line.quantity || 0))
        .map((line) => ({
          id: line.id,
          itemId: line.itemId,
          description: line.description || line.itemId,
          unit: line.unit || null,
          orderedQuantity: Number(line.quantity),
          receivedQuantity: Number(line.receivedQuantity || 0),
          remainingQuantity: Math.max(0, Number(line.quantity) - Number(line.receivedQuantity || 0)),
        })),
    }))
    .filter((row) => row.lines.length);
  const inventorySources = new Set(['inventory.waste', 'inventory.stock_count', 'inventory.production_batch', 'inventory.stock_issue', 'inventory.stock_transfer', 'inventory.reversal', 'purchase.goods_received']);
  const recentOperations = state.events
    .filter((row) => inventorySources.has(row.source) && sameBranch(row, branchId))
    .sort((a, b) => new Date(b.occurredAt) - new Date(a.occurredAt))
    .slice(0, 25)
    .map((row) => {
      const movementRows = list(row.payload?.movementIds)
        .map((movementId) => state.inventoryMovements.find((movement) => movement.id === movementId))
        .filter(Boolean);
      const quantities = movementRows.map((movement) => Number(movement.quantityBase));
      const costs = movementRows.map((movement) => movement.totalCostIrr == null ? null : Number(movement.totalCostIrr));
      const totalCostIrr = costs.length && costs.every((value) => Number.isFinite(value))
        ? costs.reduce((sum, value) => sum + Math.abs(value), 0) : null;
      return {
        id: row.id, source: row.source, sourceId: row.sourceId, occurredAt: row.occurredAt, status: row.status,
        itemId: row.payload?.itemId || movementRows[0]?.itemId || null, recipeId: row.payload?.recipeId || null, reason: row.payload?.reason || null,
        quantity: quantities.every((value) => Number.isFinite(value)) ? quantities.reduce((sum, value) => sum + Math.abs(value), 0) : null,
        unit: movementRows[0]?.baseUnit || null, totalCostIrr, movementType: movementRows[0]?.movementType || null,
        issues: list(row.payload?.issues).map((issue) => ({ code: issue.code, itemId: issue.itemId || null })),
        physicalRecorded: row.payload?.physicalRecorded === true,
      };
    });
  const exceptions = state.reconciliationItems
    .filter((row) => row.kind === 'inventory_exception' && sameBranch(row, branchId) && row.status === 'exception')
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 25)
    .map((row) => ({ id: row.id, createdAt: row.createdAt, operationId: row.details?.operationId || null, issues: list(row.details?.issues) }));
  return {
    items, menuItems, recipeVersions, productionRecipes, receivablePurchaseOrders, recentOperations, exceptions,
    vendors,
    recipeCapacity: intelligence.recipeCapacity,
    stockoutForecast: intelligence.stockoutForecast,
    summary: {
      items: items.length,
      lowStock: items.filter((row) => ['reorder', 'negative'].includes(row.status)).length,
      unvaluedEvents: recentOperations.filter((row) => row.status === 'blocked').length,
      exceptions: exceptions.length,
      productionRecipes: productionRecipes.length,
      approvedRecipeVersions: recipeVersions.filter((row) => row.status === 'approved').length,
      pendingRecipeVersions: recipeVersions.filter((row) => row.status === 'pending_approval').length,
      receivablePurchaseOrderLines: receivablePurchaseOrders.reduce((sum, row) => sum + row.lines.length, 0),
    },
    policy: {
      physicalQuantityIsRecordedImmediately: true,
      financialAccountsHiddenFromOperator: true,
      purchasePricesHiddenFromOperator: true,
      receivingRequiresApprovedPurchaseOrder: true,
      correctionMethod: 'reversal_only',
    },
  };
}

function financialReports(db, query = {}) {
  const state = ensureFinanceV2(db);
  const branchId = query.branchId ? Number(query.branchId) : null;
  const accountDefinitions = new Map(list(db.accounting?.accounts).map((row) => [String(row.code || row.accountCode), row]));
  const accountNames = new Map([...accountDefinitions.entries()].map(([code, row]) => [code, row.nameFa || row.name || null]));
  const entries = state.journalEntries
    .filter((entry) => entry.status === 'posted' && sameBranch(entry, branchId) && inRange(entry, query.from, query.to, 'date'))
    .sort((a, b) => new Date(a.date) - new Date(b.date) || String(a.number).localeCompare(String(b.number)));
  const lines = entries.flatMap((entry) => list(entry.lines).map((line) => ({
    id: line.id, entryId: entry.id, entryNumber: entry.number, date: entry.date, source: entry.source,
    sourceId: entry.sourceId, description: entry.description, accountCode: String(line.accountCode),
    accountName: accountNames.get(String(line.accountCode)) || null, debitIrr: int(line.debitIrr), creditIrr: int(line.creditIrr),
    branchId: line.branchId, costCenter: line.costCenter || null, counterpartyId: line.counterpartyId || null,
    paymentMethod: line.paymentMethod || null, itemId: line.itemId || null, memo: line.memo || null,
  })));
  const byAccount = new Map();
  for (const line of lines) {
    const row = byAccount.get(line.accountCode) || { accountCode: line.accountCode, accountName: line.accountName, debitIrr: 0, creditIrr: 0, lineCount: 0 };
    row.debitIrr += line.debitIrr; row.creditIrr += line.creditIrr; row.lineCount += 1;
    byAccount.set(line.accountCode, row);
  }
  const trialRows = [...byAccount.values()].map((row) => ({ ...row, balanceIrr: row.debitIrr - row.creditIrr })).sort((a, b) => a.accountCode.localeCompare(b.accountCode));
  const debitIrr = trialRows.reduce((sum, row) => sum + row.debitIrr, 0);
  const creditIrr = trialRows.reduce((sum, row) => sum + row.creditIrr, 0);
  const accountNet = (prefix, normal = 'debit') => trialRows
    .filter((row) => row.accountCode.startsWith(prefix))
    .reduce((sum, row) => sum + (normal === 'debit' ? row.debitIrr - row.creditIrr : row.creditIrr - row.debitIrr), 0);
  const revenueIrr = accountNet('4', 'credit');
  const cogsIrr = accountNet('5', 'debit');
  const operatingExpenseIrr = accountNet('6', 'debit');
  const netProfitIrr = revenueIrr - cogsIrr - operatingExpenseIrr;
  const pnlRows = trialRows.filter((row) => /^[456]/.test(row.accountCode)).map((row) => ({
    ...row,
    category: row.accountCode.startsWith('4') ? 'revenue' : row.accountCode.startsWith('5') ? 'cogs' : 'operating_expense',
    amountIrr: row.accountCode.startsWith('4') ? row.creditIrr - row.debitIrr : row.debitIrr - row.creditIrr,
  }));
  const assetsIrr = accountNet('1', 'debit');
  const liabilitiesIrr = accountNet('2', 'credit');
  const equityBeforeCurrentIrr = accountNet('3', 'credit');
  const equityIrr = equityBeforeCurrentIrr + netProfitIrr;
  const equationDifferenceIrr = assetsIrr - liabilitiesIrr - equityIrr;
  const balanceRows = trialRows.filter((row) => /^[123]/.test(row.accountCode)).map((row) => ({
    ...row,
    category: row.accountCode.startsWith('1') ? 'asset' : row.accountCode.startsWith('2') ? 'liability' : 'equity',
    amountIrr: row.accountCode.startsWith('1') ? row.debitIrr - row.creditIrr : row.creditIrr - row.debitIrr,
  }));
  const abnormalBalanceRows = balanceRows.filter((row) => {
    const configuredSide = String(accountDefinitions.get(row.accountCode)?.normalSide || '').toLowerCase();
    const normalSide = ['debit', 'credit'].includes(configuredSide)
      ? configuredSide
      : row.category === 'asset' ? 'debit' : 'credit';
    return normalSide === 'debit' ? row.balanceIrr < 0 : row.balanceIrr > 0;
  }).map((row) => ({
    accountCode: row.accountCode, accountName: row.accountName, category: row.category,
    balanceIrr: row.balanceIrr, amountIrr: row.amountIrr,
  }));
  const scopedSaleEvents = state.events.filter((event) => event.source === 'order.paid' && event.status === 'posted'
    && sameBranch(event, branchId) && inRange(event, query.from, query.to));
  const scopedCogsEvents = state.events.filter((event) => event.source === 'order.cogs'
    && sameBranch(event, branchId) && inRange(event, query.from, query.to));
  const postedCogsSourceIds = new Set(scopedCogsEvents.filter((event) => event.status === 'posted').map((event) => String(event.sourceId)));
  const missingCogsSourceIds = [...new Set(scopedSaleEvents.map((event) => String(event.sourceId)))]
    .filter((sourceId) => !postedCogsSourceIds.has(sourceId));
  const blockedCogsEvents = scopedCogsEvents.filter((event) => event.status === 'blocked');
  const snapshot = reportSnapshot(db, query);
  const salesDifferenceIrr = int(snapshot.reconciliation.salesDifferenceIrr);
  const pnlControls = {
    salesReconciled: salesDifferenceIrr === 0,
    cogsComplete: missingCogsSourceIds.length === 0 && blockedCogsEvents.length === 0,
    expectedSaleEvents: scopedSaleEvents.length,
    postedCogsEvents: postedCogsSourceIds.size,
    missingCogsEvents: missingCogsSourceIds.length,
    blockedCogsEvents: blockedCogsEvents.length,
    salesDifferenceIrr,
  };
  const cashAccounts = new Set(['1110', '1120', '1210']);
  const classifyCash = (entry) => {
    const counterpartCodes = list(entry.lines).map((line) => String(line.accountCode)).filter((code) => !cashAccounts.has(code));
    if (counterpartCodes.some((code) => code.startsWith('18'))) return 'investing';
    if (counterpartCodes.some((code) => code.startsWith('3') || code.startsWith('25'))) return 'financing';
    if (counterpartCodes.length && counterpartCodes.every((code) => /^[2456]/.test(code) || ['1310', '1320', '1510', '1610'].includes(code))) return 'operating';
    return 'unclassified';
  };
  const cashRows = entries.map((entry) => {
    const cashLines = list(entry.lines).filter((line) => cashAccounts.has(String(line.accountCode)));
    const amountIrr = cashLines.reduce((sum, line) => sum + int(line.debitIrr) - int(line.creditIrr), 0);
    if (!amountIrr) return null;
    return { entryId: entry.id, entryNumber: entry.number, date: entry.date, source: entry.source, description: entry.description, category: classifyCash(entry), amountIrr };
  }).filter(Boolean);
  const cashTotals = Object.fromEntries(['operating', 'investing', 'financing', 'unclassified'].map((category) => [category, cashRows.filter((row) => row.category === category).reduce((sum, row) => sum + row.amountIrr, 0)]));
  const linePage = page(lines, query);
  const cashPage = page(cashRows.slice().sort((a, b) => new Date(b.date) - new Date(a.date)), query);
  const pnlHasRows = entries.length && pnlRows.length;
  const pnlStatus = !pnlHasRows ? 'insufficient_data'
    : pnlControls.salesReconciled && pnlControls.cogsComplete ? 'available' : 'partial_coverage';
  const balanceStatus = !entries.length ? 'insufficient_data'
    : equationDifferenceIrr !== 0 ? 'unbalanced'
      : abnormalBalanceRows.length ? 'partial_coverage' : 'balanced';
  return {
    source: 'posted Finance V2 journal lines',
    generatedAt: now(),
    generalLedger: { status: entries.length ? 'available' : 'insufficient_data', rows: linePage.rows, pagination: { page: linePage.page, pageSize: linePage.pageSize, total: linePage.total, pages: linePage.pages } },
    trialBalance: { status: entries.length ? debitIrr === creditIrr ? 'balanced' : 'unbalanced' : 'insufficient_data', rows: trialRows, debitIrr, creditIrr, differenceIrr: debitIrr - creditIrr },
    profitAndLoss: {
      status: pnlStatus,
      activityStatus: entries.length ? 'active' : 'empty_period',
      rows: pnlRows, revenueIrr, cogsIrr, operatingExpenseIrr, netProfitIrr, controls: pnlControls,
    },
    balanceSheet: { status: balanceStatus, rows: balanceRows, assetsIrr, liabilitiesIrr, equityBeforeCurrentIrr, currentPeriodEarningsIrr: netProfitIrr, equityIrr, equationDifferenceIrr, abnormalBalanceRows },
    cashFlow: {
      status: !cashRows.length ? 'insufficient_data' : cashTotals.unclassified ? 'partial_coverage' : 'rule_based',
      activityStatus: entries.length ? 'active' : 'empty_period',
      method: 'direct_rule_based', rows: cashPage.rows, pagination: { page: cashPage.page, pageSize: cashPage.pageSize, total: cashPage.total, pages: cashPage.pages },
      operatingIrr: cashTotals.operating, investingIrr: cashTotals.investing, financingIrr: cashTotals.financing,
      unclassifiedIrr: cashTotals.unclassified, netChangeIrr: cashRows.reduce((sum, row) => sum + row.amountIrr, 0),
    },
  };
}

function reverseInventoryOperationV2(db, eventId, input, actor, idempotencyKey) {
  const state = ensureFinanceV2(db);
  const replay = state.events.find((row) => row.idempotencyKey === idempotencyKey);
  if (replay) return {
    event: replay,
    journalEntry: replay.journalEntryId ? state.journalEntries.find((row) => row.id === replay.journalEntryId) || null : null,
    movements: state.inventoryMovements.filter((row) => row.source === 'inventory.reversal' && String(row.sourceId) === String(replay.sourceId)),
    idempotentReplay: true,
  };
  const original = state.events.find((row) => row.id === eventId && ['inventory.waste', 'inventory.stock_count', 'inventory.production_batch'].includes(row.source));
  if (!original) throw Object.assign(new Error('رویداد عملیاتی انبار یافت نشد.'), { code: 'inventory_event_not_found', status: 404 });
  if (state.events.some((row) => row.source === 'inventory.reversal' && row.payload?.originalEventId === original.id)) {
    throw Object.assign(new Error('این عملیات قبلاً معکوس شده است.'), { code: 'inventory_event_already_reversed', status: 409 });
  }
  if (original.status !== 'posted' || (!original.journalEntryId && !original.payload?.zeroValueNoJournal)) {
    throw Object.assign(new Error('فقط عملیات انبار قطعی قابل معکوس‌سازی است.'), { code: 'inventory_event_not_reversible', status: 409 });
  }
  const reason = String(input.reason || '').trim().slice(0, 300);
  if (reason.length < 3) throw Object.assign(new Error('علت معکوس‌سازی الزامی است.'), { code: 'reversal_reason_required', status: 400 });
  const occurredAt = input.occurredAt || now();
  const originals = list(original.payload?.movementIds)
    .map((movementId) => state.inventoryMovements.find((movement) => movement.id === movementId))
    .filter(Boolean);
  if (!originals.length) throw Object.assign(new Error('گردش فیزیکی قابل معکوس‌سازی یافت نشد.'), { code: 'inventory_event_movements_missing', status: 409 });
  // Validate the target period before recording physical corrections so a
  // reversal cannot leave the physical and financial ledgers out of sync.
  if (original.journalEntryId) {
    const periodCheck = validateOpenPeriod(db, occurredAt, original.branchId);
    if (!periodCheck.ok) throw Object.assign(new Error(periodCheck.message), { code: periodCheck.code, status: 409 });
  }
  const journalEntry = original.journalEntryId ? reverseEntry(db, original.journalEntryId, actor, reason, occurredAt) : null;
  const operationId = id();
  const movements = originals.map((movement) => ({
    ...movement, id: id(), quantityBase: -Number(movement.quantityBase), movementType: 'return',
    source: 'inventory.reversal', sourceId: operationId, occurredAt, createdAt: now(), createdBy: actor,
    reversalOfId: movement.id, reason,
  }));
  state.inventoryMovements.push(...movements);
  const recorded = recordEvent(db, {
    source: 'inventory.reversal', sourceId: operationId, sourceVersion: 1, idempotencyKey,
    branchId: original.branchId, occurredAt, amountIrr: original.amountIrr,
    payload: { originalEventId: original.id, originalJournalEntryId: original.journalEntryId, movementIds: movements.map((row) => row.id), reason, physicalRecorded: true },
    status: 'posted',
  });
  recorded.event.journalEntryId = journalEntry?.id || null;
  recorded.event.processedAt = now();
  return { event: recorded.event, journalEntry, movements, idempotentReplay: false };
}

function ledgerClose(db, query = {}) {
  const state = ensureFinanceV2(db);
  const snapshot = reportSnapshot(db, query);
  // Keep the ledger-close page order identical to the journal endpoint and
  // finance search targetPage calculation. Otherwise a search result can
  // navigate to a page that does not contain the selected journal entry.
  const entries = state.journalEntries
    .filter((entry) => sameBranch(entry, query.branchId) && inRange(entry, query.from, query.to, 'date'))
    .sort((a, b) => new Date(b.date) - new Date(a.date));
  const entryPage = page(entries, query);
  const usingV2Periods = state.fiscalPeriods.length > 0;
  const periods = usingV2Periods ? state.fiscalPeriods : list(db.accounting?.fiscalPeriods);
  const selectedPeriod = query.periodId
    ? periods.find((period) => String(period.id) === String(query.periodId)
      && (query.branchId == null || period.branchId == null || Number(period.branchId) === Number(query.branchId))) || null
    : periodForDate(db, now(), query.branchId ? Number(query.branchId) : null);
  const qualityFrom = query.from || (query.periodId && selectedPeriod ? `${selectedPeriod.startDate}T00:00:00.000Z` : null);
  const qualityTo = query.to || (query.periodId && selectedPeriod ? `${selectedPeriod.endDate}T23:59:59.999Z` : null);
  const quality = dataQuality(db, query.branchId ? Number(query.branchId) : null, { from: qualityFrom, to: qualityTo });
  const inSelectedRange = (row, field) => !qualityFrom && !qualityTo || inRange(row, qualityFrom, qualityTo, field);
  const fixedAssets = state.fixedAssets.filter((asset) => sameBranch(asset, query.branchId)
    && (!qualityFrom && !qualityTo || (new Date(asset.purchaseDate || asset.createdAt || 0).getTime() <= new Date(qualityTo).getTime()
      && (!asset.disposalDate || new Date(asset.disposalDate).getTime() >= new Date(qualityFrom).getTime()))));
  const depreciationRuns = state.depreciationRuns.filter((run) => sameBranch(run, query.branchId) && inSelectedRange(run, 'postingDate')).map((run) => ({
    ...run, journalEntry: state.journalEntries.find((entry) => entry.id === run.journalEntryId) || null,
  }));
  // A period-only ledger-close request has no explicit `to`, but its
  // specialist previews must still use the selected period rather than the
  // current wall-clock month. Otherwise opening a historical period can show
  // a depreciation preview for a later month.
  const depreciationPostingDate = query.to || selectedPeriod?.endDate || now();
  const depreciationPreview = previewDepreciationV2(db, { branchId: query.branchId, postingDate: String(depreciationPostingDate).slice(0, 10) });
  const payrollRuns = state.payrollRuns.filter((run) => sameBranch(run, query.branchId) && inSelectedRange(run, 'postingDate')).map((run) => ({
    ...run,
    journalEntry: state.journalEntries.find((entry) => entry.id === run.journalEntryId) || null,
    payments: state.payrollPayments.filter((payment) => payment.payrollRunId === run.id),
  }));
  const payrollPayments = state.payrollPayments.filter((payment) => sameBranch(payment, query.branchId) && inSelectedRange(payment, 'paymentDate'));
  const openingBalanceBatches = state.openingBalanceBatches
    .filter((batch) => sameBranch(batch, query.branchId) && inSelectedRange(batch, 'asOfDate'))
    .map((batch) => ({
      ...batch,
      journalEntry: state.journalEntries.find((entry) => entry.id === batch.journalEntryId) || null,
      approval: state.approvals.find((approval) => approval.id === batch.approvalId) || null,
    }))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const reports = financialReports(db, query);
  const pnlRows = reports.profitAndLoss?.rows || [];
  const pnlControls = reports.profitAndLoss?.controls || {};
  const hasRevenueOrCogs = pnlRows.some((row) => ['revenue', 'cogs'].includes(row.category));
  const hasNoSalesOrCogsActivity = !hasRevenueOrCogs
    && Number(pnlControls.expectedSaleEvents || 0) === 0
    && Number(pnlControls.missingCogsEvents || 0) === 0
    && Number(pnlControls.blockedCogsEvents || 0) === 0;
  const hasHealthyBalances = Number(reports.balanceSheet?.equationDifferenceIrr || 0) === 0
    && !(reports.balanceSheet?.abnormalBalanceRows || []).length;
  const reportsReliable = (reports.profitAndLoss.status === 'available' && reports.balanceSheet.status === 'balanced')
    || (hasNoSalesOrCogsActivity && hasHealthyBalances);
  const hasPostedActivity = reports.generalLedger.status === 'available'
    || Number(snapshot.operational?.paidOrders || 0) > 0;
  const reportingState = !hasPostedActivity && reportsReliable
    ? { status: 'empty_period', hasActivity: false, message: 'این دوره سالم است اما هنوز فعالیت قطعی در آن ثبت نشده است.' }
    : reportsReliable
      ? { status: 'available', hasActivity: true, message: 'گزارش‌ها از اسناد قطعی دفتر مالی ساخته شده‌اند.' }
      : { status: 'needs_action', hasActivity: hasPostedActivity, message: 'برای گزارش رسمی، کنترل‌های فروش، بهای تمام‌شده و تراز باید تکمیل شوند.' };
  return {
    snapshot, entries: entryPage.rows, pagination: { page: entryPage.page, pageSize: entryPage.pageSize, total: entryPage.total, pages: entryPage.pages }, periods, selectedPeriod, periodSource: usingV2Periods ? 'finance_v2' : 'legacy_read_only',
    closeChecklist: [
      { id: 'balanced-ledger', label: 'تراز بودن کل بدهکار و بستانکار', passed: snapshot.reconciliation.balanced },
      { id: 'sales-reconciled', label: 'تطبیق فروش عملیاتی و دفتر', passed: snapshot.reconciliation.salesDifferenceIrr === 0 },
      { id: 'events-clear', label: 'نبود رویداد مسدود یا ثبت‌نشده', passed: !quality.issues.some((issue) => ['blocked_finance_events', 'paid_orders_without_finance_event'].includes(issue.code)) },
      { id: 'period-open', label: 'وجود دورهٔ معتبر در وضعیت قابل بستن', passed: Boolean(selectedPeriod && (['open', 'reopened'].includes(selectedPeriod.status) || (query.allowSoftClosed && selectedPeriod.status === 'soft_closed'))) },
      { id: 'duplicates-clear', label: 'نبود تسویه، هزینه یا استهلاک تکراری', passed: !quality.settlementDuplicates.length && !quality.expenseDuplicates.length && !quality.depreciationDuplicates.length },
      { id: 'approvals-clear', label: 'نبود عملیات مالی منتظر تأیید', passed: !state.approvals.some((approval) => approval.status === 'pending' && approvalMatchesBranch(state, approval, query.branchId)) },
      { id: 'reports-reliable', label: 'کامل بودن بهای تمام‌شده و نبود مانده با ماهیت غیرعادی', passed: reportsReliable },
    ],
    reports,
    reportingState,
    fixedAssets, depreciationRuns, depreciationPreview,
    assetPolicies: {
      categories: Object.entries(FIXED_ASSET_ACCOUNTS).map(([id, policy]) => ({ id, ...policy })),
      fundingMethods: Object.entries(ASSET_FUNDING_METHODS).map(([id, policy]) => ({ id, ...policy })),
      depreciationMethod: 'straight_line', depreciationConvention: 'full_month',
    },
    legacyAssets: { count: list(db.accounting?.fixedAssets).length, trust: 'legacy_quarantined_read_only' },
    payrollRuns, payrollPayments,
    payrollPolicies: {
      calculation: 'accountant_confirmed_totals_no_automatic_statutory_rate',
      liabilityTypes: Object.entries(PAYROLL_LIABILITY_TYPES).map(([id, policy]) => ({ id, ...policy })),
      serviceMonthConvention: 'posting_month_only',
    },
    legacyPayroll: { count: list(db.accounting?.payrollRuns).length, trust: 'legacy_quarantined_read_only' },
    openingBalanceBatches,
    openingBalanceAccounts: openingBalanceAccounts(db),
    scope: { from: qualityFrom ? String(qualityFrom).slice(0, 10) : null, to: qualityTo ? String(qualityTo).slice(0, 10) : null },
    openingBalancePolicy: {
      scope: 'posting_balance_sheet_accounts_only', currentYearProfitLossExcluded: true,
      explicitBalancingLineRequired: true, automaticPlugAccount: false,
      approvalRequired: true, correctionMethod: 'reversal_only', oneActiveBatchPerBranch: true,
    },
    integrityControl: { label: 'کنترل یکپارچگی اسناد', status: entries.length ? 'available_for_v2_entries' : 'no_v2_entries' },
    taxpayerIntegration: { status: 'not_connected', exportReady: false, message: 'ارسال واقعی سامانه مؤدیان در دامنهٔ این نسخه نیست.' },
  };
}

function refundRequestFingerprint(refund) {
  return sha256(canonicalJson({
    orderId: String(refund?.orderId ?? ''),
    branchId: branchDimension(refund),
    paymentId: String(refund?.paymentId ?? ''),
    amountIrr: safeIrr(refund?.amountIrr, 'refund_amount_invalid'),
    reason: String(refund?.reason || '').trim().slice(0, 300),
    refundDate: String(refund?.refundDate || ''),
  }));
}

function recordRefundAudit(db, refund, action, actor, metadata = {}) {
  const accounting = db.accounting && typeof db.accounting === 'object'
    ? db.accounting : (db.accounting = {});
  return financeAuditEngine.recordAuditLog(accounting, {
    action: `finance_refund_${action}`,
    entityType: 'finance_refund',
    entityId: String(refund.id),
    userId: String(actor || '').trim(),
    branchId: branchDimension(refund),
    message: String(metadata.reason || `رویداد برگشت وجه: ${action}`).slice(0, 300),
    metadata: {
      ...metadata,
      orderId: String(refund.orderId),
      paymentId: String(refund.paymentId),
      approvalId: refund.approvalId || null,
      amountIrr: safeIrr(refund.amountIrr, 'refund_amount_invalid'),
    },
    idempotencyKey: `finance-refund:${refund.id}:${action}`,
  });
}

function requestOrderRefund(db, orderId, input, actor, idempotencyKey) {
  const state = ensureFinanceV2(db);
  const order = list(db.orders).find((item) => String(item.id) === String(orderId));
  if (!order) throw Object.assign(new Error('سفارش یافت نشد.'), { code: 'order_not_found', status: 404 });
  const requestedBranchId = input?.branchId == null ? null : strictBranchRouteId(input.branchId);
  if (requestedBranchId && !sameExactBranch(order, { branchId: requestedBranchId })) {
    throw Object.assign(new Error('سفارش به شعبهٔ انتخاب‌شده تعلق ندارد.'), { code: 'refund_order_branch_mismatch', status: 409 });
  }
  if (!branchDimension(order)) throw Object.assign(new Error('شعبهٔ سفارش برای برگشت وجه مشخص نیست.'), { code: 'refund_order_branch_missing', status: 409 });
  const linkedPayments = state.payments.filter((item) => String(item.orderId) === String(order.id) && ['succeeded', 'refunded'].includes(item.status));
  if (linkedPayments.some((item) => !sameExactBranch(item, order))) {
    throw Object.assign(new Error('پرداخت سفارش به شعبهٔ دیگری تعلق دارد.'), { code: 'refund_payment_branch_mismatch', status: 409 });
  }
  const orderPayments = linkedPayments.filter((item) => sameExactBranch(item, order));
  if (!orderPayments.length) throw Object.assign(new Error('برای سفارش، پرداخت معتبر Finance V2 ثبت نشده است.'), { code: 'finance_payment_missing', status: 409 });
  const payment = input.paymentId
    ? orderPayments.find((item) => String(item.id) === String(input.paymentId))
    : orderPayments.length === 1 ? orderPayments[0] : null;
  if (!payment) throw Object.assign(new Error('برای سفارش چند روش پرداخت وجود دارد؛ روش بازگشت وجه را مشخص کنید.'), { code: 'refund_payment_required', status: 400 });
  const saleRecognized = state.journalEntries.some((entry) => entry.source === 'order.paid'
    && String(entry.sourceId) === String(order.id) && sameExactBranch(entry, order));
  if (!saleRecognized) {
    if (!['cash', 'manual_card'].includes(String(payment.tender || ''))) {
      throw Object.assign(new Error('برای برگشت این روش پرداخت، ابتدا مسیر بازپرداخت کیف پول/درگاه باید آماده باشد.'), {
        code: 'refund_pre_sale_tender_unsupported', status: 409,
      });
    }
    preSaleRefundOperationalLeg(db, order, payment);
  }
  const amountIrr = safeIrr(input.amountIrr, 'refund_amount_invalid');
  if (amountIrr <= 0) throw Object.assign(new Error('مبلغ برگشت وجه باید بزرگ‌تر از صفر باشد.'), { code: 'refund_amount_invalid' });
  const reason = String(input.reason || '').trim().slice(0, 300);
  if (reason.length < 3) throw Object.assign(new Error('علت برگشت وجه الزامی است.'), { code: 'refund_reason_required' });
  const normalizedIdempotencyKey = normalizeIdempotencyKey(idempotencyKey);
  const existingByKey = normalizedIdempotencyKey
    ? state.refunds.find((item) => item.idempotencyKey === normalizedIdempotencyKey)
    : null;
  // Reuse the original timestamp for a retry that omits refundDate. An
  // explicitly changed date remains part of the immutable request identity.
  const refundDate = input.refundDate
    ? valueContracts.parseTimestamp(input.refundDate)
    : existingByKey?.refundDate || now();
  if (!refundDate) throw Object.assign(new Error('زمان برگشت وجه باید ISO معتبر و همراه منطقهٔ زمانی باشد.'), { code: 'refund_date_invalid' });
  const requestFingerprint = refundRequestFingerprint({
    orderId: order.id, branchId: branchDimension(order), paymentId: payment.id,
    amountIrr, reason, refundDate,
  });
  if (existingByKey) {
    const storedFingerprint = existingByKey.requestFingerprint || refundRequestFingerprint(existingByKey);
    if (!sameExactBranch(existingByKey, order) || storedFingerprint !== requestFingerprint) {
      throw Object.assign(new Error('کلید تکرارنشدنی قبلاً برای درخواست برگشت وجه دیگری مصرف شده است.'), { code: 'refund_idempotency_conflict', status: 409 });
    }
    return {
      refund: existingByKey,
      approval: state.approvals.find((item) => item.entityType === 'finance_refund' && item.entityId === existingByKey.id) || null,
      idempotentReplay: true,
    };
  }
  const committedIrr = state.refunds
    .filter((item) => item.paymentId === payment.id && !['failed', 'cancelled'].includes(item.status))
    .reduce((sum, item) => sum + int(item.amountIrr), 0);
  if (committedIrr + amountIrr > payment.amountIrr) {
    throw Object.assign(new Error('جمع برگشت‌های ثبت‌شده از مبلغ این پرداخت بیشتر می‌شود.'), {
      code: 'refund_total_exceeds_payment', status: 409,
      details: { paymentAmountIrr: payment.amountIrr, committedIrr, requestedIrr: amountIrr },
    });
  }
  const refund = {
    id: id(), orderId: order.id, paymentId: payment.id, branchId: payment.branchId,
    amountIrr, reason, refundDate, status: 'pending_approval', idempotencyKey: normalizedIdempotencyKey || null,
    requestFingerprint,
    createdBy: actor, createdAt: now(), approvedBy: null, approvedAt: null,
    journalEntryId: null, taxRefundIrr: null, revenueRefundIrr: null,
    inventoryEffect: 'none_financial_refund_only',
  };
  state.refunds.push(refund);
  const approval = {
    id: id(), operation: 'approve_customer_refund', entityType: 'finance_refund', entityId: refund.id,
    amountIrr, status: 'pending', createdBy: actor, createdAt: now(), decidedBy: null, decidedAt: null,
    history: [{ action: 'submitted', by: actor, at: now(), comment: reason }],
  };
  refund.approvalId = approval.id;
  state.approvals.push(approval);
  recordRefundAudit(db, refund, 'requested', actor, {
    reason, requestFingerprint, approvalId: approval.id,
  });
  return { refund, approval, idempotentReplay: false };
}

function postApprovedRefund(db, refund, actor, evidenceId) {
  const state = ensureFinanceV2(db);
  const persistedRefund = state.refunds.find((item) => String(item.id) === String(refund?.id));
  if (!persistedRefund) throw Object.assign(new Error('درخواست برگشت وجه یافت نشد.'), { code: 'finance_refund_not_found', status: 404 });
  const payment = state.payments.find((item) => String(item.id) === String(persistedRefund.paymentId));
  const order = list(db.orders).find((item) => String(item.id) === String(persistedRefund.orderId));
  if (!payment) throw Object.assign(new Error('پرداخت مبنای برگشت وجه یافت نشد.'), { code: 'refund_source_chain_missing', status: 409 });
  const match = buildRefundReconciliationMatch({
    refund: { ...persistedRefund, paymentReference: payment.providerReference || persistedRefund.paymentReference || null },
    evidenceId,
    loadEvidence: (requestedId) => {
      const row = state.reconciliationItems.find((item) => String(item.id) === String(requestedId));
      return row ? refundEvidenceFromPersistedItem(row) : null;
    },
    existingMatches: state.reconciliationItems.filter((item) => item.kind === 'refund').map(refundEvidenceFromPersistedItem),
    actor,
    matchedAt: now(),
  });
  return withFinanceAtomicity(db, () => postApprovedRefundAtomic(db, persistedRefund, actor, match), {
    keys: ['events', 'payments', 'refunds', 'reconciliationItems', 'journalEntries', 'idempotency'],
    objects: [order],
  });
}

function refundEvidenceFromPersistedItem(item) {
  const details = item?.details && typeof item.details === 'object' ? item.details : {};
  const direction = item?.direction ?? details.direction;
  return {
    ...item,
    direction: direction === 'outflow' ? 'outgoing' : direction,
    sourceRecordId: item?.sourceRecordId ?? details.sourceRecordId,
    sourcePaymentId: item?.sourcePaymentId ?? details.sourcePaymentId,
    verifiedAt: item?.verifiedAt ?? details.verifiedAt,
    refundReference: item?.refundReference ?? details.refundReference,
    bankReference: item?.bankReference ?? details.bankReference,
    disbursementReference: item?.disbursementReference ?? details.disbursementReference,
    refundId: item?.refundId ?? details.refundId,
    evidenceId: item?.evidenceId ?? details.evidenceId,
    outgoingReference: item?.outgoingReference ?? details.outgoingReference,
    matchedAt: item?.matchedAt ?? details.matchedAt,
  };
}

function postApprovedRefundAtomic(db, refund, actor, match) {
  const state = ensureFinanceV2(db);
  if (refund.status === 'succeeded') {
    const existingMatch = state.reconciliationItems.map(refundEvidenceFromPersistedItem)
      .find((item) => item.kind === 'refund' && String(item.refundId || '') === String(refund.id));
    const existingEntry = refund.journalEntryId ? state.journalEntries.find((item) => item.id === refund.journalEntryId) || null : null;
    if (!existingMatch || !existingEntry || String(existingMatch.evidenceId || '') !== String(match.evidenceId)
      || String(existingMatch.outgoingReference || '') !== String(match.outgoingReference)) {
      throw Object.assign(new Error('برگشت وجه قبلاً با هویت دیگری نهایی شده است.'), { code: 'refund_match_identity_conflict', status: 409 });
    }
    return existingEntry;
  }
  if (!refund || !['approved', 'processing'].includes(refund.status)) {
    throw Object.assign(new Error('درخواست برگشت وجه هنوز تأیید مستقل نشده یا در وضعیت پرداخت نیست.'), { code: 'refund_status_invalid', status: 409 });
  }
  const approval = state.approvals.find((item) => item.entityType === 'finance_refund'
    && String(item.entityId) === String(refund.id)
    && (refund.approvalId == null || String(item.id) === String(refund.approvalId)));
  if (!approval || approval.operation !== 'approve_customer_refund' || approval.status !== 'approved'
    || !approval.decidedBy || String(approval.createdBy) === String(approval.decidedBy)
    || String(refund.approvedBy || '') !== String(approval.decidedBy)
    || safeIrr(approval.amountIrr, 'refund_approval_amount_invalid') !== safeIrr(refund.amountIrr, 'refund_amount_invalid')) {
    throw Object.assign(new Error('پرداخت برگشت وجه فقط پس از تأیید مستقل درخواست مجاز است.'), { code: 'refund_independent_approval_required', status: 409 });
  }
  if (!match || match.status !== 'matched' || match.refundId !== String(refund.id)) {
    throw Object.assign(new Error('مدرک خروجی تأییدشده برای نهایی‌کردن برگشت وجه الزامی است.'), { code: 'refund_match_evidence_required', status: 409 });
  }
  const payment = state.payments.find((item) => item.id === refund.paymentId);
  const order = list(db.orders).find((item) => String(item.id) === String(refund.orderId));
  if (!payment || !order) throw Object.assign(new Error('زنجیرهٔ سفارش و پرداخت برگشت وجه کامل نیست.'), { code: 'refund_source_chain_missing', status: 409 });
  if (!['succeeded', 'refunded'].includes(String(payment.status))) {
    throw Object.assign(new Error('فقط پرداخت قطعی و موفق می‌تواند مبنای بازپرداخت باشد.'), { code: 'refund_payment_not_succeeded', status: 409 });
  }
  if (!sameExactBranch(payment, order) || !sameExactBranch(refund, order)) {
    throw Object.assign(new Error('زنجیرهٔ سفارش، پرداخت و برگشت وجه بین شعبه‌ها ناسازگار است.'), { code: 'refund_payment_branch_mismatch', status: 409 });
  }
  const tenderAccount = TENDER_ACCOUNTS[payment.tender];
  if (!tenderAccount) throw Object.assign(new Error('حساب روش پرداخت برای برگشت وجه تعریف نشده است.'), { code: 'refund_tender_account_missing', status: 409 });
  const originalSale = state.journalEntries.find((entry) => entry.source === 'order.paid'
    && String(entry.sourceId) === String(order.id) && sameExactBranch(entry, order));
  const refundsAgainstCustomerDeposit = !originalSale;
  let preSaleLeg = null;
  if (refundsAgainstCustomerDeposit) {
    if (!['cash', 'manual_card'].includes(String(payment.tender || ''))) {
      throw Object.assign(new Error('برگشت پرداخت پیش از فروش برای این روش پرداخت هنوز مسیر عملیاتی امن ندارد.'), {
        code: 'refund_pre_sale_tender_unsupported', status: 409,
      });
    }
    if (int(refund.amountIrr) % 10 !== 0) {
      throw Object.assign(new Error('مبلغ برگشت پیش از فروش باید با واحد عملیاتی تومان قابل ثبت باشد.'), {
        code: 'refund_pre_sale_amount_precision_unsupported', status: 409,
      });
    }
    preSaleLeg = preSaleRefundOperationalLeg(db, order, payment);
    const refundedBeforeIrr = state.refunds
      .filter((item) => String(item.paymentId) === String(payment.id) && item.status === 'succeeded')
      .reduce((sum, item) => sum + safeIrr(item.amountIrr, 'refund_amount_invalid'), 0);
    if (int(preSaleLeg.refundedAmount || 0) * 10 !== refundedBeforeIrr) {
      throw Object.assign(new Error('ماندهٔ پرداخت عملیاتی با بازپرداخت‌های قطعی دفتر مالی هم‌خوان نیست.'), {
        code: 'refund_order_payment_balance_mismatch', status: 409,
      });
    }
  }
  const periodCheck = validateOpenPeriod(db, refund.refundDate, refund.branchId);
  if (!periodCheck.ok) throw Object.assign(new Error(periodCheck.message), { code: periodCheck.code, status: 409 });
  let orderTotalIrr;
  try {
    orderTotalIrr = strictLegacyTomanIrr(order.total, 'refund_order_total_invalid');
  } catch (error) {
    throw Object.assign(error, { code: 'refund_order_total_invalid', status: 409 });
  }
  if (orderTotalIrr <= 0) throw Object.assign(new Error('مبلغ قطعی سفارش برای تسهیم برگشت معتبر نیست.'), { code: 'refund_order_total_invalid', status: 409 });
  const reservedOnPaymentIrr = state.refunds
    .filter((item) => String(item.paymentId) === String(payment.id) && String(item.id) !== String(refund.id)
      && !['failed', 'cancelled'].includes(String(item.status)))
    .reduce((sum, item) => sum + safeIrr(item.amountIrr, 'refund_amount_invalid'), 0);
  const requestedRefundIrr = safeIrr(refund.amountIrr, 'refund_amount_invalid');
  const paymentAmountIrr = safeIrr(payment.amountIrr, 'refund_payment_amount_invalid');
  if (reservedOnPaymentIrr + requestedRefundIrr > paymentAmountIrr) {
    throw Object.assign(new Error('جمع بازپرداخت‌های فعال از مبلغ قطعی پرداخت بیشتر است.'), {
      code: 'refund_total_exceeds_payment', status: 409,
      details: { paymentAmountIrr, committedIrr: reservedOnPaymentIrr, requestedIrr: requestedRefundIrr },
    });
  }
  const orderTaxIrr = refundsAgainstCustomerDeposit ? 0 : orderTaxAmountIrr(order);
  if (orderTaxIrr > orderTotalIrr) throw Object.assign(new Error('مالیات ذخیره‌شده سفارش نامعتبر است.'), { code: 'tax_total_invalid', status: 409 });
  const priorSucceeded = state.refunds.filter((item) => item.id !== refund.id && String(item.orderId) === String(order.id)
    && item.status === 'succeeded' && item.recognitionState !== 'customer_deposit');
  const priorRefundIrr = priorSucceeded.reduce((sum, item) => {
    const next = sum + safeIrr(item.amountIrr, 'refund_amount_invalid');
    if (!Number.isSafeInteger(next)) throw Object.assign(new Error('جمع بازپرداخت‌های سفارش از محدودهٔ امن خارج است.'), { code: 'refund_total_unsafe', status: 409 });
    return next;
  }, 0);
  const priorTaxIrr = priorSucceeded.reduce((sum, item) => {
    const next = sum + (item.taxRefundIrr == null ? 0 : safeIrr(item.taxRefundIrr, 'tax_total_invalid'));
    if (!Number.isSafeInteger(next)) throw Object.assign(new Error('جمع مالیات برگشتی از محدودهٔ امن خارج است.'), { code: 'tax_total_invalid', status: 409 });
    return next;
  }, 0);
  const cumulativeRefundIrr = priorRefundIrr + requestedRefundIrr;
  if (!Number.isSafeInteger(cumulativeRefundIrr)) throw Object.assign(new Error('جمع بازپرداخت سفارش از محدودهٔ امن خارج است.'), { code: 'refund_total_unsafe', status: 409 });
  if (!refundsAgainstCustomerDeposit && cumulativeRefundIrr > orderTotalIrr) throw Object.assign(new Error('جمع برگشت وجه از مبلغ سفارش بیشتر می‌شود.'), { code: 'refund_total_exceeds_order', status: 409 });
  // Keep proportional tax allocation in integer arithmetic. The numerator can
  // exceed Number.MAX_SAFE_INTEGER even when each input amount is itself a
  // valid safe integer, making Math.round() silently add or lose a rial.
  const cumulativeTaxIrr = refundsAgainstCustomerDeposit ? 0 : cumulativeRefundIrr === orderTotalIrr
    ? orderTaxIrr
    : Number((BigInt(orderTaxIrr) * BigInt(cumulativeRefundIrr) + BigInt(orderTotalIrr) / 2n) / BigInt(orderTotalIrr));
  if (!Number.isSafeInteger(cumulativeTaxIrr) || cumulativeTaxIrr < 0 || cumulativeTaxIrr > orderTaxIrr) {
    throw Object.assign(new Error('سهم مالیات برگشتی از محدودهٔ امن خارج است.'), { code: 'tax_total_invalid', status: 409 });
  }
  const taxRefundIrr = Math.max(0, cumulativeTaxIrr - priorTaxIrr);
  const revenueRefundIrr = refundsAgainstCustomerDeposit ? 0 : refund.amountIrr - taxRefundIrr;
  const branchId = Number(order.branchId) || payment.branchId;
  const costCenter = `branch:${branchId}`;
  const salesAccount = originalSale?.lines?.find((line) => ['4110', '4120', '4130'].includes(line.accountCode))?.accountCode
    || (order.fulfillment === 'pickup' ? '4120' : order.fulfillment === 'delivery' ? '4130' : '4110');
  const recorded = recordEvent(db, {
    source: refundsAgainstCustomerDeposit ? 'order.payment_refund' : 'order.refund', sourceId: refund.id, sourceVersion: 1,
    idempotencyKey: `refund:${refund.id}:v1`, branchId, occurredAt: refund.refundDate,
    amountIrr: refund.amountIrr,
    payload: {
      orderId: order.id, paymentId: payment.id, tender: payment.tender, reason: refund.reason,
      taxRefundIrr, revenueRefundIrr, inventoryEffect: refund.inventoryEffect,
      recognitionState: refundsAgainstCustomerDeposit ? 'customer_deposit' : 'sale',
      disbursementEvidenceId: match.evidenceId, outgoingReference: match.outgoingReference,
      evidenceSourceRecordId: match.sourceRecordId, evidenceKind: match.evidenceKind,
    },
  });
  const lines = [];
  if (refundsAgainstCustomerDeposit) {
    lines.push({ accountCode: WALLET_LIABILITY_ACCOUNT, accountType: 'liability', debitIrr: refund.amountIrr, creditIrr: 0, branchId, costCenter, memo: `آزادسازی پیش‌دریافت برگشتی سفارش ${order.orderNo || order.id}` });
  } else {
    if (revenueRefundIrr) lines.push({ accountCode: salesAccount, accountType: 'contra_revenue', debitIrr: revenueRefundIrr, creditIrr: 0, branchId, costCenter, memo: `برگشت فروش سفارش ${order.orderNo || order.id}` });
    if (taxRefundIrr) lines.push({ accountCode: '2210', debitIrr: taxRefundIrr, creditIrr: 0, branchId, costCenter, memo: `برگشت مالیات سفارش ${order.orderNo || order.id}` });
  }
  lines.push({ accountCode: tenderAccount, debitIrr: 0, creditIrr: refund.amountIrr, branchId, costCenter, paymentMethod: payment.tender, memo: `خروج وجه برگشت سفارش ${order.orderNo || order.id}` });
  const entry = postEventJournal(db, recorded.event, lines, `برگشت وجه تأییدشده سفارش ${order.orderNo || order.id}`, actor);
  if (!entry) throw Object.assign(new Error('سند برگشت وجه پست نشد.'), { code: recorded.event.error?.code || 'refund_journal_post_failed', status: 409 });
  refund.status = 'succeeded'; refund.disbursedBy = actor; refund.disbursedAt = match.matchedAt;
  refund.disbursementEvidenceId = match.evidenceId; refund.disbursementReference = match.outgoingReference;
  refund.journalEntryId = entry.id;
  refund.taxRefundIrr = taxRefundIrr; refund.revenueRefundIrr = revenueRefundIrr;
  refund.recognitionState = refundsAgainstCustomerDeposit ? 'customer_deposit' : 'sale';
  payment.refundedIrr = state.refunds.filter((item) => item.paymentId === payment.id && item.status === 'succeeded').reduce((sum, item) => sum + int(item.amountIrr), 0);
  payment.status = payment.refundedIrr >= payment.amountIrr ? 'refunded' : 'succeeded';
  if (refundsAgainstCustomerDeposit) {
    const refundedToman = payment.refundedIrr / 10;
    if (!Number.isSafeInteger(refundedToman) || refundedToman > int(preSaleLeg.amount)) {
      throw Object.assign(new Error('بازپرداخت ریالی با ماندهٔ تومانی پرداخت عملیاتی سازگار نیست.'), {
        code: 'refund_order_payment_balance_mismatch', status: 409,
      });
    }
    preSaleLeg.refundedAmount = refundedToman;
    const paidToman = list(order.partialPayments).reduce((sum, row) => {
      const gross = Number(row?.amount);
      const refunded = Number(row?.refundedAmount || 0);
      if (!Number.isSafeInteger(gross) || gross < 0 || !Number.isSafeInteger(refunded) || refunded < 0 || refunded > gross) {
        throw Object.assign(new Error('تاریخچهٔ پرداخت سفارش هنگام ثبت بازپرداخت نامعتبر است.'), { code: 'refund_order_payment_history_invalid', status: 409 });
      }
      return sum + gross - refunded;
    }, 0);
    if (!Number.isSafeInteger(paidToman) || paidToman > Number(order.total)) {
      throw Object.assign(new Error('جمع پرداخت خالص سفارش برای محاسبهٔ مانده نامعتبر است.'), { code: 'refund_order_payment_balance_mismatch', status: 409 });
    }
    order.amountPaid = paidToman;
    order.balanceDue = Math.max(0, Number(order.total) - paidToman);
    order.paymentStatus = paidToman >= Number(order.total) ? 'paid' : paidToman > 0 ? 'partial' : 'unpaid';
  }
  const reconciliation = {
    id: id(), kind: 'refund', refundId: refund.id, evidenceId: match.evidenceId,
    outgoingReference: match.outgoingReference, sourceRecordId: match.sourceRecordId,
    branchId, orderId: order.id, paymentId: payment.id, cashSessionId: null,
    bankReference: match.outgoingReference, settlementReference: null, psp: payment.provider || null,
    terminalId: null, batchNo: null, journalEntryId: entry.id, amountIrr: refund.amountIrr,
    status: 'matched', matchedAt: match.matchedAt, matchedBy: actor,
    details: {
      refundId: refund.id, evidenceId: match.evidenceId, evidenceKind: match.evidenceKind,
      sourceRecordId: match.sourceRecordId, outgoingReference: match.outgoingReference,
      financialOnly: false,
    }, createdAt: now(),
  };
  const evidence = state.reconciliationItems.find((item) => String(item.id) === String(match.evidenceId));
  if (!evidence) throw Object.assign(new Error('مدرک خروجی پس از اعتبارسنجی یافت نشد.'), { code: 'refund_match_evidence_unverified', status: 409 });
  evidence.status = 'matched'; evidence.refundId = refund.id; evidence.matchedAt = match.matchedAt;
  evidence.matchedBy = actor; evidence.refundReconciliationId = reconciliation.id;
  const verifiedEvidence = refundEvidenceFromPersistedItem(evidence);
  evidence.details = {
    ...(evidence.details || {}), direction: 'outgoing', sourceRecordId: match.sourceRecordId,
    sourcePaymentId: match.paymentId, verifiedAt: verifiedEvidence.verifiedAt,
    refundId: refund.id, evidenceId: match.evidenceId, outgoingReference: match.outgoingReference,
    refundReconciliationId: reconciliation.id, matchedAt: match.matchedAt,
  };
  state.reconciliationItems.push(reconciliation);
  recordRefundAudit(db, refund, 'disbursed_reconciled', actor, {
    approvalId: approval.id,
    evidenceId: match.evidenceId,
    evidenceKind: match.evidenceKind,
    sourceRecordId: match.sourceRecordId,
    outgoingReference: match.outgoingReference,
    journalEntryId: entry.id,
    reconciledAt: match.matchedAt,
  });
  return entry;
}

function recordSettlementV2(db, input, actor) {
  ensureFinanceV2(db);
  return withFinanceAtomicity(db, () => recordSettlementV2Atomic(db, input, actor), {
    keys: ['events', 'payments', 'reconciliationItems', 'journalEntries', 'idempotency'],
  });
}

function recordSettlementV2Atomic(db, input, actor) {
  const state = ensureFinanceV2(db);
  const branchId = Number(input.branchId) || null;
  if (!branchId) throw Object.assign(new Error('شعبهٔ تسویه الزامی است.'), { code: 'settlement_branch_required' });
  const branches = list(db.branches);
  if (branches.length && !branches.some((branch) => Number(branch.id) === branchId && branch.active !== false)) {
    throw Object.assign(new Error('شعبهٔ تسویه یافت نشد یا فعال نیست.'), { code: 'settlement_branch_not_found', status: 404 });
  }
  const psp = String(input.psp || '').trim().slice(0, 120);
  const terminalId = String(input.terminalId || '').trim().slice(0, 120);
  const batchNo = String(input.batchNo || '').trim().slice(0, 120);
  if (!psp || !terminalId || !batchNo) throw Object.assign(new Error('PSP، پایانه و شماره دسته تسویه الزامی است.'), { code: 'settlement_identity_required' });
  if (state.reconciliationItems.some((item) => item.kind === 'settlement' && sameExactBranch(item, { branchId })
    && item.psp === psp && item.terminalId === terminalId && item.batchNo === batchNo && item.status !== 'exception')) {
    throw Object.assign(new Error('این دسته تسویه قبلاً ثبت شده است.'), { code: 'settlement_batch_duplicate', status: 409 });
  }
  const paymentIds = [...new Set(list(input.paymentIds).map(String).filter(Boolean))];
  if (!paymentIds.length) throw Object.assign(new Error('حداقل یک پرداخت برای تطبیق انتخاب کنید.'), { code: 'settlement_payments_required' });
  const payments = paymentIds.map((paymentId) => state.payments.find((item) => item.id === paymentId));
  if (payments.some((payment) => !payment)) throw Object.assign(new Error('یکی از پرداخت‌های انتخاب‌شده یافت نشد.'), { code: 'settlement_payment_not_found', status: 404 });
  if (payments.some((payment) => Number(payment.branchId) !== branchId)) throw Object.assign(new Error('پرداخت‌های چند شعبه را نمی‌توان در یک دسته تسویه کرد.'), { code: 'settlement_branch_mismatch', status: 409 });
  if (payments.some((payment) => !['succeeded', 'refunded'].includes(String(payment.status)))) {
    throw Object.assign(new Error('فقط پرداخت‌های موفق قابل تسویه هستند.'), { code: 'settlement_payment_not_succeeded', status: 409 });
  }
  if (payments.some((payment) => !safeIrr(payment.amountIrr, 'settlement_payment_amount_invalid'))) {
    throw Object.assign(new Error('مبلغ یکی از پرداخت‌ها برای تسویه معتبر نیست.'), { code: 'settlement_payment_amount_invalid', status: 409 });
  }
  const clearingAccounts = new Set(payments.map((payment) => TENDER_ACCOUNTS[payment.tender]));
  if (clearingAccounts.size !== 1 || !['1310', '1320'].includes([...clearingAccounts][0])) {
    throw Object.assign(new Error('هر دسته باید فقط پرداخت‌های یک حساب واسط کارتخوان یا درگاه را شامل شود.'), { code: 'settlement_tender_mismatch', status: 409 });
  }
  const paymentItems = payments.map((payment) => state.reconciliationItems.find((item) => item.kind === 'payment' && item.paymentId === payment.id));
  if (paymentItems.some((item) => !item || item.status !== 'unmatched')) throw Object.assign(new Error('یکی از پرداخت‌ها قبلاً تطبیق شده یا در صف تطبیق نیست.'), { code: 'settlement_payment_already_matched', status: 409 });
  if (paymentItems.some((item, index) => !sameExactBranch(item, payments[index]))) {
    throw Object.assign(new Error('رکورد تطبیق پرداخت و خود پرداخت به یک شعبه تعلق ندارند.'), { code: 'settlement_reconciliation_branch_mismatch', status: 409 });
  }
  // A refund credits the clearing account immediately.  Settling the original
  // payment amount again would therefore over-credit the clearing account
  // (and would book a bank inflow for a fully refunded payment).  Use the
  // still-outstanding amount for this batch and reject zero-net payments so a
  // settlement can never manufacture cash after a customer refund.
  const settlementPayments = payments.map((payment) => {
    const grossIrr = safeIrr(payment.amountIrr, 'settlement_payment_amount_invalid');
    const refundedIrr = safeIrr(payment.refundedIrr || 0, 'settlement_refunded_amount_invalid');
    if (refundedIrr > grossIrr) {
      throw Object.assign(new Error('مبلغ بازپرداخت‌شده از مبلغ پرداخت بیشتر است.'), {
        code: 'settlement_refund_exceeds_payment', status: 409,
      });
    }
    const outstandingIrr = grossIrr - refundedIrr;
    if (outstandingIrr <= 0) {
      throw Object.assign(new Error('پرداخت کاملاً برگشت‌خورده قابل تسویه نیست.'), {
        code: 'settlement_payment_fully_refunded', status: 409,
      });
    }
    return { payment, grossIrr, refundedIrr, outstandingIrr };
  });
  const grossAmountIrr = settlementPayments.reduce((sum, row) => sum + row.outstandingIrr, 0);
  const feeIrr = safeIrr(input.feeIrr || 0, 'settlement_fee_invalid');
  if (feeIrr > grossAmountIrr) throw Object.assign(new Error('کارمزد از مبلغ ناخالص تسویه بیشتر است.'), { code: 'settlement_fee_exceeds_gross' });
  const bankAmountIrr = grossAmountIrr - feeIrr;
  if (input.bankAmountIrr != null && safeIrr(input.bankAmountIrr, 'settlement_bank_amount_invalid') !== bankAmountIrr) {
    throw Object.assign(new Error('خالص واریزی با ناخالص پرداخت‌ها منهای کارمزد برابر نیست.'), {
      code: 'settlement_amount_mismatch', status: 409,
      details: { grossAmountIrr, feeIrr, expectedBankAmountIrr: bankAmountIrr, suppliedBankAmountIrr: input.bankAmountIrr },
    });
  }
  const bankAccountCode = String(input.bankAccountCode || '1210').trim();
  if (!bankPostingAccounts(db).some((account) => account.code === bankAccountCode)) {
    throw Object.assign(new Error('حساب بانکی تسویه در طرح حساب‌ها تعریف نشده است.'), { code: 'settlement_bank_account_invalid', status: 409 });
  }
  const settledAt = input.settledAt
    ? isoTimestamp(input.settledAt, 'settlement_date_invalid', 'زمان تسویه باید تاریخ ISO معتبر همراه منطقهٔ زمانی باشد.')
    : now();
  const periodCheck = validateOpenPeriod(db, settledAt, branchId);
  if (!periodCheck.ok) throw Object.assign(new Error(periodCheck.message), { code: periodCheck.code, status: 409 });
  const settlementId = id();
  const clearingAccount = [...clearingAccounts][0];
  const costCenter = `branch:${branchId}`;
  const recorded = recordEvent(db, {
    source: 'settlement.received', sourceId: settlementId, sourceVersion: 1,
    idempotencyKey: `settlement:${branchId}:${psp}:${terminalId}:${batchNo}`, branchId, occurredAt: settledAt,
    amountIrr: grossAmountIrr,
    payload: {
      psp, terminalId, batchNo, bankReference: input.bankReference || null, bankAccountCode, paymentIds,
      grossAmountIrr, feeIrr, bankAmountIrr,
      refundedAmountIrr: settlementPayments.reduce((sum, row) => sum + row.refundedIrr, 0),
      paymentAmounts: settlementPayments.map((row) => ({ paymentId: row.payment.id, originalAmountIrr: row.grossIrr, refundedIrr: row.refundedIrr, settledAmountIrr: row.outstandingIrr })),
    },
  });
  const lines = [];
  if (bankAmountIrr) lines.push({ accountCode: bankAccountCode, debitIrr: bankAmountIrr, creditIrr: 0, branchId, costCenter, memo: `واریز دسته ${batchNo}` });
  if (feeIrr) lines.push({ accountCode: '6710', accountType: 'expense', debitIrr: feeIrr, creditIrr: 0, branchId, costCenter, counterpartyId: psp, memo: `کارمزد دسته ${batchNo}` });
  lines.push({ accountCode: clearingAccount, debitIrr: 0, creditIrr: grossAmountIrr, branchId, costCenter, paymentMethod: payments[0].tender, counterpartyId: psp, memo: `تسویه حساب واسط دسته ${batchNo}` });
  const entry = postEventJournal(db, recorded.event, lines, `تسویه ${psp} / پایانه ${terminalId} / دسته ${batchNo}`, actor);
  if (!entry) throw Object.assign(new Error('سند تسویه پست نشد.'), { code: recorded.event.error?.code || 'settlement_journal_post_failed', status: 409 });
  const settlement = {
    id: settlementId, kind: 'settlement', branchId, orderId: null, paymentId: null, cashSessionId: null,
    bankReference: String(input.bankReference || '').trim().slice(0, 160) || null,
    settlementReference: batchNo, psp, terminalId, batchNo, journalEntryId: entry.id,
    amountIrr: bankAmountIrr, status: 'matched', matchedAt: now(), matchedBy: actor,
    details: {
      paymentIds, grossAmountIrr, feeIrr, bankAmountIrr, bankAccountCode, clearingAccount, settledAt,
      refundedAmountIrr: settlementPayments.reduce((sum, row) => sum + row.refundedIrr, 0),
      paymentAmounts: settlementPayments.map((row) => ({ paymentId: row.payment.id, originalAmountIrr: row.grossIrr, refundedIrr: row.refundedIrr, settledAmountIrr: row.outstandingIrr })),
    }, createdAt: now(),
  };
  state.reconciliationItems.push(settlement);
  paymentItems.forEach((item) => {
    item.status = 'matched'; item.matchedAt = settlement.matchedAt; item.matchedBy = actor;
    item.settlementReference = batchNo; item.journalEntryId = entry.id; item.details = { ...item.details, settlementId };
  });
  return { settlement, event: recorded.event, journalEntry: entry, payments };
}

function openingBalanceAccounts(db) {
  return list(db.accounting?.accounts)
    .filter((account) => account?.isPostingAccount === true
      && ['asset', 'liability', 'equity'].includes(String(account.type || ''))
      && /^[123]/.test(String(account.code || account.accountCode || ''))
      && String(account.code || account.accountCode) !== '3900')
    .map((account) => ({
      code: String(account.code || account.accountCode),
      name: account.nameFa || account.name || String(account.code || account.accountCode),
      type: String(account.type),
      subtype: account.subtype || null,
      normalSide: account.type === 'asset' && account.subtype !== 'contra_asset' ? 'debit' : 'credit',
    }))
    .sort((a, b) => a.code.localeCompare(b.code));
}

function openingBalancePreview(db, input = {}) {
  const branchId = Number(input.branchId) || null;
  if (!branchId) throw Object.assign(new Error('شعبهٔ مانده افتتاحیه الزامی است.'), { code: 'opening_balance_branch_required', status: 400 });
  if (list(db.branches).length && !list(db.branches).some((branch) => Number(branch.id) === branchId)) {
    throw Object.assign(new Error('شعبهٔ انتخاب‌شده یافت نشد.'), { code: 'opening_balance_branch_not_found', status: 404 });
  }
  const asOfDate = String(input.asOfDate || '').slice(0, 10);
  const asOf = new Date(`${asOfDate}T12:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOfDate) || !Number.isFinite(asOf.getTime()) || asOf.toISOString().slice(0, 10) !== asOfDate) {
    throw Object.assign(new Error('تاریخ مانده افتتاحیه معتبر نیست.'), { code: 'opening_balance_date_invalid', status: 400 });
  }
  const sourceReference = String(input.sourceReference || '').trim().slice(0, 160);
  if (sourceReference.length < 3) throw Object.assign(new Error('مرجع صورت‌مانده یا صورتجلسه حداقل سه نویسه لازم دارد.'), { code: 'opening_balance_reference_required', status: 400 });
  const rawLines = list(input.lines);
  if (rawLines.length < 2 || rawLines.length > 1000) {
    throw Object.assign(new Error('مانده افتتاحیه باید بین ۲ تا ۱۰۰۰ ردیف داشته باشد.'), { code: 'opening_balance_lines_invalid', status: 400 });
  }
  const accounts = openingBalanceAccounts(db);
  if (!accounts.length) throw Object.assign(new Error('کدینگ حساب‌های ترازنامه‌ای در دسترس نیست.'), { code: 'opening_balance_accounts_missing', status: 409 });
  const accountMap = new Map(accounts.map((account) => [account.code, account]));
  const seen = new Set();
  const costCenter = `branch:${branchId}`;
  const lines = rawLines.map((line, index) => {
    const accountCode = String(line?.accountCode || '').trim();
    const account = accountMap.get(accountCode);
    if (!account) throw Object.assign(new Error(`حساب ردیف ${index + 1} برای مانده افتتاحیه مجاز یا تفصیلی نیست.`), { code: 'opening_balance_account_invalid', status: 400, details: { lineNo: index + 1, accountCode } });
    if (seen.has(accountCode)) throw Object.assign(new Error(`حساب ${accountCode} در مانده افتتاحیه تکرار شده است.`), { code: 'opening_balance_account_duplicate', status: 409, details: { accountCode } });
    seen.add(accountCode);
    const debitIrr = safeIrr(line?.debitIrr || 0, 'opening_balance_amount_invalid');
    const creditIrr = safeIrr(line?.creditIrr || 0, 'opening_balance_amount_invalid');
    if ((debitIrr > 0) === (creditIrr > 0)) {
      throw Object.assign(new Error(`در ردیف ${index + 1} دقیقاً یکی از بدهکار یا بستانکار باید بزرگ‌تر از صفر باشد.`), { code: 'opening_balance_line_side_invalid', status: 400, details: { lineNo: index + 1 } });
    }
    return {
      accountCode, accountName: account.name, accountType: account.type,
      debitIrr, creditIrr, branchId, costCenter,
      counterpartyId: line?.counterpartyId == null ? null : String(line.counterpartyId).slice(0, 160),
      paymentMethod: null, itemId: null, recipeVersionId: null,
      memo: String(line?.memo || `مانده افتتاحیه ${account.name}`).trim().slice(0, 300),
    };
  });
  const totals = assertBalanced(lines, accountCodesForDb(db));
  // Resolve the period with the same branch-aware, ambiguity-safe selector
  // used by every other posting path. A date-only lookup could otherwise
  // select another branch's period for an opening balance.
  const period = periodForDate(db, asOfDate, branchId);
  if (!period) throw Object.assign(new Error('برای تاریخ مانده افتتاحیه، دورهٔ مالی V2 تعریف نشده است.'), { code: 'opening_balance_fiscal_period_missing', status: 409 });
  if (!['open', 'reopened'].includes(period.status)) throw Object.assign(new Error(`دورهٔ «${period.name || period.id}» باز نیست.`), { code: 'fiscal_period_closed', status: 409 });
  return {
    ready: true, branchId, asOfDate, sourceReference, fiscalPeriodId: period.id,
    period, lines, totals, accounts,
    policy: {
      balanceSheetAccountsOnly: true,
      currentYearProfitLossExcluded: true,
      automaticBalancingAccount: false,
      explicitEquityLineRequired: true,
      approvalRequired: true,
      correctionMethod: 'reversal_only',
    },
  };
}

function requestOpeningBalance(db, input, actor) {
  const state = ensureFinanceV2(db);
  const preview = openingBalancePreview(db, input);
  const active = state.openingBalanceBatches.find((batch) => Number(batch.branchId) === preview.branchId && ['pending_approval', 'posted'].includes(batch.status));
  if (active) throw Object.assign(new Error('برای این شعبه یک مانده افتتاحیه فعال یا منتظر تأیید وجود دارد؛ اصلاح فقط پس از رد یا سند معکوس ممکن است.'), { code: 'opening_balance_active_batch_exists', status: 409, details: { batchId: active.id, status: active.status } });
  const batchId = id();
  const entry = createDraft(db, {
    date: `${preview.asOfDate}T12:00:00.000Z`, branchId: preview.branchId, costCenter: `branch:${preview.branchId}`,
    description: `مانده افتتاحیه شعبه ${preview.branchId} · مرجع ${preview.sourceReference}`,
    lines: preview.lines,
  }, actor);
  entry.source = 'opening_balance';
  entry.sourceId = batchId;
  const submitted = submitDraft(db, entry.id, actor);
  submitted.approval.operation = 'post_opening_balance';
  const batch = {
    id: batchId, branchId: preview.branchId, asOfDate: preview.asOfDate,
    fiscalPeriodId: preview.fiscalPeriodId, sourceReference: preview.sourceReference,
    debitIrr: preview.totals.debitIrr, creditIrr: preview.totals.creditIrr,
    lines: preview.lines.map((line) => ({ ...line })), status: 'pending_approval',
    journalEntryId: entry.id, approvalId: submitted.approval.id, reversalJournalEntryId: null,
    createdBy: actor, createdAt: now(), decidedBy: null, decidedAt: null,
    postedBy: null, postedAt: null, reversedBy: null, reversedAt: null,
  };
  state.openingBalanceBatches.push(batch);
  return { preview, batch, journalEntry: entry, approval: submitted.approval };
}

function createDraft(db, input, actor) {
  const state = ensureFinanceV2(db);
  const headerBranchId = Number(input.branchId) || null;
  const lines = list(input.lines).map((line) => ({
    accountCode: String(line.accountCode || '').trim(), accountType: String(line.accountType || '').trim() || null,
    debitIrr: safeIrr(line.debitIrr), creditIrr: safeIrr(line.creditIrr), branchId: Number(line.branchId || input.branchId) || null,
    costCenter: String(line.costCenter || input.costCenter || '').trim() || null,
    counterpartyId: line.counterpartyId == null ? null : String(line.counterpartyId), paymentMethod: line.paymentMethod || null,
    itemId: line.itemId == null ? null : String(line.itemId), recipeVersionId: line.recipeVersionId == null ? null : String(line.recipeVersionId),
    memo: String(line.memo || '').slice(0, 300),
  }));
  const lineBranches = [...new Set(lines.map((line) => line.branchId).filter((branchId) => branchId != null))];
  if (lineBranches.length > 1) {
    throw Object.assign(new Error('تمام ردیف‌های سند باید متعلق به یک شعبه باشند.'), { code: 'journal_line_branch_mismatch', status: 400 });
  }
  if (headerBranchId == null && lineBranches.length) {
    throw Object.assign(new Error('سند دارای ردیف شعبه‌ای باید شعبهٔ سرسند را نیز مشخص کند.'), { code: 'journal_header_branch_required', status: 400 });
  }
  if (headerBranchId != null && lineBranches.length && lineBranches[0] !== headerBranchId) {
    throw Object.assign(new Error('شعبهٔ سرسند با شعبهٔ ردیف‌های سند یکسان نیست.'), { code: 'journal_header_line_branch_mismatch', status: 400 });
  }
  const totals = assertBalanced(lines, accountCodesForDb(db));
  const entry = {
    id: id('fje'), number: `F2-D-${String(state.journalEntries.length + 1).padStart(6, '0')}`,
    periodId: null, sourceEventId: null, source: 'manual', sourceId: null,
    date: input.date || now(), description: String(input.description || 'سند دستی').slice(0, 280), status: 'draft',
    debitIrr: totals.debitIrr, creditIrr: totals.creditIrr, branchId: headerBranchId,
    reversalOfId: null, reversedById: null,
    lines: lines.map((line, index) => ({ id: id('fjl'), lineNo: index + 1, ...line })),
    createdAt: now(), createdBy: actor, postedAt: null, postedBy: null,
  };
  state.journalEntries.push(entry);
  return entry;
}

function submitDraft(db, entryId, actor) {
  const state = ensureFinanceV2(db);
  const entry = state.journalEntries.find((item) => item.id === entryId);
  if (!entry) throw Object.assign(new Error('سند یافت نشد.'), { code: 'journal_not_found', status: 404 });
  if (entry.status !== 'draft') throw Object.assign(new Error('فقط سند پیش‌نویس قابل ارسال است.'), { code: 'journal_not_draft', status: 409 });
  const existing = state.approvals.find((item) => item.entityType === 'journal_entry' && item.entityId === entryId && item.status === 'pending');
  if (existing) return { approval: existing, idempotentReplay: true };
  entry.status = 'pending_approval';
  const approval = {
    id: id('fap'), operation: 'post_manual_journal', entityType: 'journal_entry', entityId: entry.id,
    amountIrr: entry.debitIrr, status: 'pending', createdBy: actor, createdAt: now(), decidedBy: null, decidedAt: null,
    history: [{ action: 'submitted', by: actor, at: now(), comment: null }],
  };
  state.approvals.push(approval);
  return { approval, idempotentReplay: false };
}

function decideApproval(db, approvalId, decision, actor, comment, runtime = {}) {
  ensureFinanceV2(db);
  return withFinanceAtomicity(db, () => decideApprovalAtomic(db, approvalId, decision, actor, comment, runtime));
}

function decideApprovalAtomic(db, approvalId, decision, actor, comment, runtime = {}) {
  const state = ensureFinanceV2(db);
  const approval = state.approvals.find((item) => item.id === approvalId);
  if (!approval) throw Object.assign(new Error('درخواست تأیید یافت نشد.'), { code: 'approval_not_found', status: 404 });
  assertApprovalBranchScope(state, approval, runtime.branchId);
  if (approval.status !== 'pending') throw Object.assign(new Error('این درخواست قبلاً تصمیم‌گیری شده است.'), { code: 'approval_already_decided', status: 409 });
  if (!['approved', 'rejected'].includes(decision)) throw Object.assign(new Error('تصمیم معتبر نیست.'), { code: 'approval_decision_invalid', status: 400 });
  if (String(approval.createdBy) === String(actor)) throw Object.assign(new Error('ایجادکننده نمی‌تواند درخواست خودش را تأیید کند.'), { code: 'segregation_of_duties', status: 409 });
  const entry = approval.entityType === 'journal_entry' ? state.journalEntries.find((item) => item.id === approval.entityId) : null;
  const period = approval.entityType === 'fiscal_period' ? state.fiscalPeriods.find((item) => item.id === approval.entityId) : null;
  const purchaseOrder = approval.entityType === 'purchase_order' ? state.purchaseOrders.find((item) => item.id === approval.entityId) : null;
  const vendorInvoiceMatch = approval.entityType === 'vendor_invoice_match' ? state.vendorInvoices.find((item) => item.id === approval.entityId) : null;
  const threeWayMatch = vendorInvoiceMatch ? state.threeWayMatches.find((item) => item.vendorInvoiceId === vendorInvoiceMatch.id) : null;
  const supplierPayment = approval.entityType === 'supplier_payment' ? state.supplierPayments.find((item) => item.id === approval.entityId) : null;
  const costPayment = approval.entityType === 'cost_payment' ? state.costPayments.find((item) => item.id === approval.entityId) : null;
  const payrollPayment = approval.entityType === 'payroll_payment' ? state.payrollPayments.find((item) => item.id === approval.entityId) : null;
  const recipeVersion = approval.entityType === 'recipe_version' ? state.recipeVersions.find((item) => item.id === approval.entityId) : null;
  const financeRefund = approval.entityType === 'finance_refund' ? state.refunds.find((item) => item.id === approval.entityId) : null;
  const costAccrual = entry ? state.costAccruals.find((item) => item.journalEntryId === entry.id) || null : null;
  const operatingExpense = entry ? state.operatingExpenses.find((item) => item.journalEntryId === entry.id) || null : null;
  const fixedAsset = entry ? state.fixedAssets.find((item) => item.acquisitionJournalEntryId === entry.id) || null : null;
  const depreciationRun = entry ? state.depreciationRuns.find((item) => item.journalEntryId === entry.id) || null : null;
  const payrollRun = entry
    ? state.payrollRuns.find((item) => item.journalEntryId === entry.id) || null
    : payrollPayment ? state.payrollRuns.find((item) => item.id === payrollPayment.payrollRunId) || null : null;
  const legacyBackfill = entry?.source === 'legacy_backfill.order_paid'
    ? state.legacyArchive.find((item) => item.id === entry.sourceId) || null
    : null;
  const openingBalanceBatch = entry?.source === 'opening_balance'
    ? state.openingBalanceBatches.find((item) => item.id === entry.sourceId) || null
    : null;
  const branchRollout = approval.entityType === 'finance_branch_rollout'
    ? state.branchRollouts.find((item) => item.id === approval.entityId) || null
    : null;
  if (approval.entityType === 'recipe_version') {
    if (!recipeVersion || approval.operation !== 'approve_recipe_version'
      || recipeVersion.approvalId !== approval.id || recipeVersion.status !== 'pending_approval') {
      throw Object.assign(new Error('زنجیرهٔ درخواست نسخهٔ دستور تهیه معتبر نیست.'), { code: 'recipe_version_approval_chain_invalid', status: 409 });
    }
    if (decision === 'approved') {
      const normalized = validateRecipeVersionInput(db, recipeVersion, { ignoreRecipeVersionId: recipeVersion.id });
      const shape = (row) => ({
        recipeId: row.recipeId, menuItemId: String(row.menuItemId), branchId: Number(row.branchId), version: int(row.version),
        yieldQuantity: Number(row.yieldQuantity), effectiveFrom: row.effectiveFrom, outputItemId: row.outputItemId || null,
        ingredients: list(row.ingredients).map((ingredient) => ({
          itemId: String(ingredient.itemId), quantity: Number(ingredient.quantity), unit: String(ingredient.unit),
          quantityBasis: String(ingredient.quantityBasis), yieldPercent: Number(ingredient.yieldPercent),
        })),
      });
      if (canonicalJson(shape(recipeVersion)) !== canonicalJson(shape(normalized))) {
        throw Object.assign(new Error('نسخهٔ دستور تهیه از زمان درخواست تغییر کرده و تأیید متوقف شد.'), { code: 'recipe_version_revalidation_failed', status: 409 });
      }
      const earlierVersions = state.recipeVersions
        .filter((row) => row.id !== recipeVersion.id && row.recipeId === recipeVersion.recipeId && ['approved', 'retired'].includes(row.status))
        .sort((a, b) => new Date(b.effectiveFrom) - new Date(a.effectiveFrom));
      if (earlierVersions.some((row) => new Date(row.effectiveFrom) >= new Date(recipeVersion.effectiveFrom))) {
        throw Object.assign(new Error('نسخهٔ تازه باید پس از آخرین تاریخ شروع نسخهٔ تأییدشده اثر کند.'), { code: 'recipe_version_effective_order_invalid', status: 409 });
      }
      const openPrevious = earlierVersions.find((row) => !row.effectiveTo);
      if (openPrevious) {
        openPrevious.status = 'retired';
        openPrevious.effectiveTo = recipeVersion.effectiveFrom;
        openPrevious.retiredBy = actor;
        openPrevious.retiredAt = now();
        openPrevious.history = list(openPrevious.history);
        openPrevious.history.push({ action: 'retired_by_new_version', by: actor, at: openPrevious.retiredAt, replacementId: recipeVersion.id });
      }
    }
  }
  if (approval.entityType === 'vendor_invoice_match') {
    if (!vendorInvoiceMatch || !threeWayMatch || approval.operation !== 'resolve_three_way_match_variance'
      || vendorInvoiceMatch.matchReview?.approvalId !== approval.id || vendorInvoiceMatch.matchReview?.status !== 'pending_approval'
      || vendorInvoiceMatch.status !== 'match_exception' || vendorInvoiceMatch.matchStatus !== 'exception') {
      throw Object.assign(new Error('زنجیرهٔ درخواست بررسی اختلاف معتبر نیست.'), { code: 'three_way_match_review_chain_invalid', status: 409 });
    }
    if (String(comment || '').trim().length < 5) {
      throw Object.assign(new Error('علت تصمیم درباره اختلاف تطبیق الزامی است.'), { code: 'three_way_match_decision_comment_required', status: 400 });
    }
  }
  let branchRolloutReadiness = null;
  if (approval.entityType === 'finance_branch_rollout') {
    if (!branchRollout || approval.operation !== 'activate_finance_branch_cutover' || branchRollout.approvalId !== approval.id || branchRollout.status !== 'pending_approval') {
      throw Object.assign(new Error('زنجیرهٔ درخواست انتقال شعبه معتبر نیست.'), { code: 'finance_rollout_chain_invalid', status: 409 });
    }
    if (decision === 'approved') {
      branchRolloutReadiness = shadowRunReadiness(db, branchRollout.branchId, { ...runtime, ignoreApprovalId: approval.id });
      if (branchRolloutReadiness.status !== 'READY_FOR_CUTOVER_REVIEW') {
        throw Object.assign(new Error('گیت‌های انتقال از زمان درخواست تغییر کرده‌اند و فعال‌سازی متوقف شد.'), {
          code: 'finance_cutover_revalidation_failed', status: 409,
          details: { failedGates: branchRolloutReadiness.gates.filter((gate) => !gate.passed) },
        });
      }
    }
  }
  let legacyBackfillPreviewResult = null;
  if (decision === 'approved' && entry?.source === 'legacy_backfill.order_paid') {
    if (!legacyBackfill || approval.operation !== 'post_legacy_order_backfill') throw Object.assign(new Error('زنجیرهٔ درخواست بازسازی تاریخی معتبر نیست.'), { code: 'legacy_backfill_chain_invalid', status: 409 });
    legacyBackfillPreviewResult = legacyOrderBackfillPreview(db, legacyBackfill.id, { forApproval: true });
    if (!legacyBackfillPreviewResult.ready) throw Object.assign(new Error('شرایط بازسازی از زمان درخواست تغییر کرده است.'), { code: 'legacy_backfill_revalidation_failed', status: 409, details: { blockers: legacyBackfillPreviewResult.blockers } });
  }
  let openingBalancePreviewResult = null;
  if (entry?.source === 'opening_balance') {
    if (!openingBalanceBatch || approval.operation !== 'post_opening_balance' || openingBalanceBatch.journalEntryId !== entry.id || openingBalanceBatch.approvalId !== approval.id) {
      throw Object.assign(new Error('زنجیرهٔ مانده افتتاحیه معتبر نیست.'), { code: 'opening_balance_chain_invalid', status: 409 });
    }
    if (decision === 'approved') {
      openingBalancePreviewResult = openingBalancePreview(db, {
        branchId: openingBalanceBatch.branchId, asOfDate: openingBalanceBatch.asOfDate,
        sourceReference: openingBalanceBatch.sourceReference, lines: openingBalanceBatch.lines,
      });
      const shape = (line) => ({
        accountCode: String(line.accountCode), debitIrr: int(line.debitIrr), creditIrr: int(line.creditIrr),
        branchId: Number(line.branchId), costCenter: String(line.costCenter || ''),
      });
      const canonicalLines = openingBalancePreviewResult.lines.map(shape);
      const entryLines = list(entry.lines).map(shape);
      if (entry.status !== 'pending_approval'
        || entry.date.slice(0, 10) !== openingBalanceBatch.asOfDate
        || Number(entry.branchId) !== openingBalanceBatch.branchId
        || entry.debitIrr !== openingBalanceBatch.debitIrr
        || entry.creditIrr !== openingBalanceBatch.creditIrr
        || JSON.stringify(entryLines) !== JSON.stringify(canonicalLines)) {
        throw Object.assign(new Error('محتوای سند با پیش‌نمایش تأییدشدهٔ مانده افتتاحیه یکسان نیست.'), { code: 'opening_balance_revalidation_failed', status: 409 });
      }
    }
  }
  if (decision === 'approved' && entry) {
    const periodCheck = validateOpenPeriod(db, entry.date, entry.branchId);
    if (!periodCheck.ok) throw Object.assign(new Error(periodCheck.message), { code: periodCheck.code, status: 409 });
    assertBalanced(entry.lines);
    entry.periodId = periodCheck.period.id;
  }
  if (decision === 'approved' && approval.entityType === 'fiscal_period' && !period) {
    throw Object.assign(new Error('دورهٔ مالی درخواست‌شده یافت نشد.'), { code: 'fiscal_period_not_found', status: 404 });
  }
  if (decision === 'approved' && approval.entityType === 'purchase_order' && !purchaseOrder) {
    throw Object.assign(new Error('سفارش خرید درخواست‌شده یافت نشد.'), { code: 'purchase_order_not_found', status: 404 });
  }
  if (decision === 'approved' && depreciationRun) {
    const duplicatedAsset = depreciationRun.lines.find((line) => state.depreciationRuns.some((run) => run.id !== depreciationRun.id
      && run.serviceMonth === depreciationRun.serviceMonth && !['rejected', 'reversed'].includes(run.status)
      && list(run.lines).some((candidate) => candidate.assetId === line.assetId)));
    if (duplicatedAsset) throw Object.assign(new Error(`استهلاک دارایی ${duplicatedAsset.assetCode} برای این ماه قبلاً ثبت شده است.`), { code: 'depreciation_asset_period_duplicate', status: 409 });
    const invalidAsset = depreciationRun.lines.find((line) => {
      const asset = state.fixedAssets.find((item) => item.id === line.assetId);
      if (!asset || asset.status !== 'active') return true;
      const remainingIrr = int(asset.purchaseCostIrr) - int(asset.salvageValueIrr) - int(asset.accumulatedDepreciationIrr);
      return remainingIrr < int(line.amountIrr);
    });
    if (invalidAsset) throw Object.assign(new Error('دارایی فعال یا ماندهٔ استهلاک کافی برای ثبت یافت نشد.'), { code: 'depreciation_asset_not_active', status: 409 });
  }
  let vendorInvoiceEntry = null;
  if (approval.entityType === 'vendor_invoice_match') {
    const event = state.events.find((row) => row.source === 'purchase.vendor_invoice' && row.sourceId === vendorInvoiceMatch.id);
    if (!event) throw Object.assign(new Error('رویداد مالی فاکتور یافت نشد.'), { code: 'vendor_invoice_event_not_found', status: 404 });
    if (decision === 'approved') {
      const posted = postVendorInvoiceV2(db, vendorInvoiceMatch, actor);
      vendorInvoiceEntry = posted.journalEntry;
      vendorInvoiceMatch.status = 'open';
      vendorInvoiceMatch.matchStatus = 'accepted_variance';
      vendorInvoiceMatch.matchReview = { ...vendorInvoiceMatch.matchReview, status: 'approved', decidedBy: actor, decidedAt: now(), decisionComment: String(comment).trim().slice(0, 300) };
      threeWayMatch.status = 'accepted_variance';
      threeWayMatch.reviewStatus = 'approved';
      threeWayMatch.decidedBy = actor;
      threeWayMatch.decidedAt = vendorInvoiceMatch.matchReview.decidedAt;
      event.payload = { ...event.payload, varianceDecision: { decision: 'approved', by: actor, at: threeWayMatch.decidedAt, comment: vendorInvoiceMatch.matchReview.decisionComment } };
    } else {
      vendorInvoiceMatch.status = 'match_rejected';
      vendorInvoiceMatch.matchStatus = 'rejected';
      vendorInvoiceMatch.matchReview = { ...vendorInvoiceMatch.matchReview, status: 'rejected', decidedBy: actor, decidedAt: now(), decisionComment: String(comment).trim().slice(0, 300) };
      threeWayMatch.status = 'rejected';
      threeWayMatch.reviewStatus = 'rejected';
      threeWayMatch.decidedBy = actor;
      threeWayMatch.decidedAt = vendorInvoiceMatch.matchReview.decidedAt;
      event.status = 'blocked';
      event.error = { code: 'three_way_match_rejected', message: 'فاکتور دارای اختلاف توسط تأییدکننده رد شد و قابل پرداخت نیست.' };
      event.payload = { ...event.payload, varianceDecision: { decision: 'rejected', by: actor, at: threeWayMatch.decidedAt, comment: vendorInvoiceMatch.matchReview.decisionComment } };
    }
  }
  let supplierPaymentEntry = null;
  if (decision === 'approved' && approval.entityType === 'supplier_payment') {
    if (!supplierPayment) throw Object.assign(new Error('درخواست پرداخت تأمین‌کننده یافت نشد.'), { code: 'supplier_payment_not_found', status: 404 });
    const invoice = state.vendorInvoices.find((item) => item.id === supplierPayment.vendorInvoiceId);
    if (!invoice) throw Object.assign(new Error('فاکتور پرداختنی یافت نشد.'), { code: 'vendor_invoice_not_found', status: 404 });
    const remainingIrr = invoice.totalIrr - invoice.paidAmountIrr;
    if (supplierPayment.amountIrr > remainingIrr) throw Object.assign(new Error('مبلغ تأییدشده از ماندهٔ فعلی فاکتور بیشتر است.'), { code: 'supplier_payment_exceeds_remaining', status: 409 });
    const periodCheck = validateOpenPeriod(db, supplierPayment.paymentDate, supplierPayment.branchId);
    if (!periodCheck.ok) throw Object.assign(new Error(periodCheck.message), { code: periodCheck.code, status: 409 });
    const creditAccount = supplierPayment.paymentMethod === 'cash' ? '1110' : supplierPayment.paymentMethod === 'petty_cash' ? '1120' : '1210';
    const costCenter = `branch:${supplierPayment.branchId}`;
    const recorded = recordEvent(db, {
      source: 'purchase.supplier_payment', sourceId: supplierPayment.id, sourceVersion: 1,
      idempotencyKey: `supplier-payment:${supplierPayment.id}:v1`, branchId: supplierPayment.branchId,
      occurredAt: supplierPayment.paymentDate, amountIrr: supplierPayment.amountIrr,
      payload: { vendorInvoiceId: invoice.id, vendorId: invoice.vendorId, paymentMethod: supplierPayment.paymentMethod, reference: supplierPayment.reference },
    });
    supplierPaymentEntry = postEventJournal(db, recorded.event, [
      { accountCode: '2110', debitIrr: supplierPayment.amountIrr, creditIrr: 0, branchId: supplierPayment.branchId, costCenter, counterpartyId: invoice.vendorId, memo: `تسویه فاکتور ${invoice.invoiceNumber}` },
      { accountCode: creditAccount, debitIrr: 0, creditIrr: supplierPayment.amountIrr, branchId: supplierPayment.branchId, costCenter, paymentMethod: supplierPayment.paymentMethod, memo: `پرداخت تأمین‌کننده ${invoice.vendorId}` },
    ], `پرداخت تأمین‌کننده برای فاکتور ${invoice.invoiceNumber}`, actor);
    if (!supplierPaymentEntry) throw Object.assign(new Error('سند پرداخت تأمین‌کننده پست نشد.'), { code: 'supplier_payment_post_failed', status: 409 });
    supplierPayment.status = 'paid'; supplierPayment.approvedBy = actor; supplierPayment.approvedAt = now(); supplierPayment.journalEntryId = supplierPaymentEntry.id;
    invoice.paidAmountIrr += supplierPayment.amountIrr;
    invoice.status = invoice.paidAmountIrr >= invoice.totalIrr ? 'paid' : 'partially_paid';
  }
  let refundEntry = null;
  if (decision === 'approved' && approval.entityType === 'finance_refund') {
    if (!financeRefund) throw Object.assign(new Error('درخواست برگشت وجه یافت نشد.'), { code: 'finance_refund_not_found', status: 404 });
    // Approval authorizes a future disbursement; it is not evidence that funds
    // have left the restaurant. The reconciliation endpoint performs the
    // disbursement transition only after persisted outgoing evidence is proven.
  }
  let costPaymentEntry = null;
  if (decision === 'approved' && approval.entityType === 'cost_payment') {
    if (!costPayment) throw Object.assign(new Error('درخواست پرداخت هزینه یافت نشد.'), { code: 'cost_payment_not_found', status: 404 });
    const accrual = state.costAccruals.find((item) => item.id === costPayment.costAccrualId);
    const commitment = accrual ? state.costCommitments.find((item) => item.id === accrual.costCommitmentId) : null;
    if (!accrual || !commitment || !['posted', 'partially_paid'].includes(accrual.status)) {
      throw Object.assign(new Error('تعهد هزینهٔ قطعی و قابل پرداخت یافت نشد.'), { code: 'cost_accrual_not_payable', status: 409 });
    }
    const pendingOtherIrr = state.costPayments.filter((item) => item.id !== costPayment.id && item.costAccrualId === accrual.id && item.status === 'pending_approval').reduce((sum, item) => sum + int(item.amountIrr), 0);
    const remainingIrr = accrual.amountIrr - int(accrual.paidAmountIrr) - pendingOtherIrr;
    if (costPayment.amountIrr > remainingIrr) throw Object.assign(new Error('مبلغ پرداخت از ماندهٔ فعلی تعهد بیشتر است.'), { code: 'cost_payment_exceeds_remaining', status: 409 });
    const periodCheck = validateOpenPeriod(db, costPayment.paymentDate, costPayment.branchId);
    if (!periodCheck.ok) throw Object.assign(new Error(periodCheck.message), { code: periodCheck.code, status: 409 });
    const creditAccount = costPayment.paymentMethod === 'cash' ? '1110' : costPayment.paymentMethod === 'petty_cash' ? '1120' : '1210';
    const costCenter = `branch:${costPayment.branchId}`;
    const recorded = recordEvent(db, {
      source: 'expense.cost_payment', sourceId: costPayment.id, sourceVersion: 1,
      idempotencyKey: `cost-payment:${costPayment.id}:v1`, branchId: costPayment.branchId,
      occurredAt: costPayment.paymentDate, amountIrr: costPayment.amountIrr,
      payload: { costAccrualId: accrual.id, costCommitmentId: commitment.id, paymentMethod: costPayment.paymentMethod, reference: costPayment.reference },
    });
    costPaymentEntry = postEventJournal(db, recorded.event, [
      { accountCode: accrual.liabilityAccount, debitIrr: costPayment.amountIrr, creditIrr: 0, branchId: accrual.branchId, costCenter, counterpartyId: commitment.counterpartyId, memo: `تسویه تعهد ${commitment.name}` },
      { accountCode: creditAccount, debitIrr: 0, creditIrr: costPayment.amountIrr, branchId: accrual.branchId, costCenter, paymentMethod: costPayment.paymentMethod, memo: `پرداخت ${commitment.name}` },
    ], `پرداخت هزینهٔ دوره‌ای ${commitment.name}`, actor);
    if (!costPaymentEntry) throw Object.assign(new Error('سند پرداخت هزینه پست نشد.'), { code: 'cost_payment_post_failed', status: 409 });
    costPayment.status = 'paid'; costPayment.approvedBy = actor; costPayment.approvedAt = now(); costPayment.journalEntryId = costPaymentEntry.id;
    accrual.paidAmountIrr = int(accrual.paidAmountIrr) + costPayment.amountIrr;
    accrual.status = accrual.paidAmountIrr >= accrual.amountIrr ? 'paid' : 'partially_paid';
  }
  let payrollPaymentEntry = null;
  if (decision === 'approved' && approval.entityType === 'payroll_payment') {
    if (!payrollPayment) throw Object.assign(new Error('درخواست پرداخت حقوق یافت نشد.'), { code: 'payroll_payment_not_found', status: 404 });
    const run = state.payrollRuns.find((item) => item.id === payrollPayment.payrollRunId);
    if (!run || !['posted', 'partially_paid'].includes(run.status)) throw Object.assign(new Error('لیست حقوق قطعی و قابل پرداخت یافت نشد.'), { code: 'payroll_run_not_payable', status: 409 });
    const ceilingIrr = int(run.liabilities?.[payrollPayment.liabilityType]);
    const pendingOtherIrr = state.payrollPayments.filter((item) => item.id !== payrollPayment.id && item.payrollRunId === run.id && item.liabilityType === payrollPayment.liabilityType && item.status === 'pending_approval').reduce((sum, item) => sum + int(item.amountIrr), 0);
    const remainingIrr = ceilingIrr - int(run.paidByLiability?.[payrollPayment.liabilityType]) - pendingOtherIrr;
    if (payrollPayment.amountIrr > remainingIrr) throw Object.assign(new Error('مبلغ پرداخت از ماندهٔ فعلی بدهی حقوق بیشتر است.'), { code: 'payroll_payment_exceeds_remaining', status: 409 });
    const periodCheck = validateOpenPeriod(db, payrollPayment.paymentDate, run.branchId);
    if (!periodCheck.ok) throw Object.assign(new Error(periodCheck.message), { code: periodCheck.code, status: 409 });
    const creditAccount = payrollPayment.paymentMethod === 'cash' ? '1110' : '1210';
    const costCenter = `branch:${run.branchId}`;
    const recorded = recordEvent(db, {
      source: 'payroll.payment', sourceId: payrollPayment.id, sourceVersion: 1,
      idempotencyKey: `payroll-payment:${payrollPayment.id}:v1`, branchId: run.branchId,
      occurredAt: payrollPayment.paymentDate, amountIrr: payrollPayment.amountIrr,
      payload: { payrollRunId: run.id, serviceMonth: run.serviceMonth, liabilityType: payrollPayment.liabilityType, paymentMethod: payrollPayment.paymentMethod, reference: payrollPayment.reference },
    });
    payrollPaymentEntry = postEventJournal(db, recorded.event, [
      { accountCode: payrollPayment.liabilityAccount, accountType: 'liability', debitIrr: payrollPayment.amountIrr, creditIrr: 0, branchId: run.branchId, costCenter, memo: `تسویه ${PAYROLL_LIABILITY_TYPES[payrollPayment.liabilityType].label} · ${run.serviceMonth}` },
      { accountCode: creditAccount, accountType: 'asset', debitIrr: 0, creditIrr: payrollPayment.amountIrr, branchId: run.branchId, costCenter, paymentMethod: payrollPayment.paymentMethod, memo: `پرداخت حقوق/کسورات · ${run.serviceMonth}` },
    ], `پرداخت ${PAYROLL_LIABILITY_TYPES[payrollPayment.liabilityType].label} ـ ${run.serviceMonth}`, actor);
    if (!payrollPaymentEntry) throw Object.assign(new Error('سند پرداخت حقوق پست نشد.'), { code: 'payroll_payment_post_failed', status: 409 });
    payrollPayment.status = 'paid'; payrollPayment.approvedBy = actor; payrollPayment.approvedAt = now(); payrollPayment.journalEntryId = payrollPaymentEntry.id;
    run.paidByLiability[payrollPayment.liabilityType] = int(run.paidByLiability[payrollPayment.liabilityType]) + payrollPayment.amountIrr;
    const totalLiabilityIrr = Object.values(run.liabilities).reduce((sum, value) => sum + int(value), 0);
    const totalPaidIrr = Object.values(run.paidByLiability).reduce((sum, value) => sum + int(value), 0);
    run.status = totalPaidIrr >= totalLiabilityIrr ? 'paid' : 'partially_paid';
  }
  approval.status = decision; approval.decidedBy = actor; approval.decidedAt = now();
  approval.history.push({ action: decision, by: actor, at: approval.decidedAt, comment: String(comment || '').slice(0, 300) || null });
  if (entry) {
    if (decision === 'rejected') {
      entry.status = 'rejected';
      if (costAccrual) costAccrual.status = 'rejected';
      if (operatingExpense) {
        operatingExpense.status = 'rejected'; operatingExpense.decidedBy = actor; operatingExpense.decidedAt = approval.decidedAt;
      }
      if (fixedAsset) fixedAsset.status = 'rejected';
      if (depreciationRun) depreciationRun.status = 'rejected';
      if (payrollRun) payrollRun.status = 'rejected';
      if (openingBalanceBatch) {
        openingBalanceBatch.status = 'rejected';
        openingBalanceBatch.decidedBy = actor;
        openingBalanceBatch.decidedAt = approval.decidedAt;
      }
      if (legacyBackfill) {
        legacyBackfill.backfillStatus = 'rejected';
        legacyBackfill.decisionHistory = list(legacyBackfill.decisionHistory);
        legacyBackfill.decisionHistory.push({ action: 'backfill_rejected', by: actor, at: now(), comment: String(comment || '').slice(0, 300) || null });
      }
    }
    else {
      entry.status = 'posted'; entry.postedAt = now(); entry.postedBy = actor;
      if (costAccrual) { costAccrual.status = 'posted'; costAccrual.postedAt = entry.postedAt; costAccrual.postedBy = actor; }
      if (operatingExpense) {
        operatingExpense.status = 'posted'; operatingExpense.decidedBy = actor; operatingExpense.decidedAt = approval.decidedAt;
        operatingExpense.postedAt = entry.postedAt; operatingExpense.postedBy = actor;
      }
      if (fixedAsset) { fixedAsset.status = 'active'; fixedAsset.approvedAt = entry.postedAt; fixedAsset.approvedBy = actor; }
      if (depreciationRun) {
        depreciationRun.status = 'posted'; depreciationRun.postedAt = entry.postedAt; depreciationRun.postedBy = actor;
        depreciationRun.lines.forEach((line) => {
          const asset = state.fixedAssets.find((item) => item.id === line.assetId);
          asset.accumulatedDepreciationIrr = int(asset.accumulatedDepreciationIrr) + int(line.amountIrr);
          asset.lastDepreciationMonth = depreciationRun.serviceMonth;
          asset.lastDepreciationAt = entry.postedAt;
        });
      }
      if (payrollRun) { payrollRun.status = 'posted'; payrollRun.postedAt = entry.postedAt; payrollRun.postedBy = actor; }
      if (openingBalanceBatch) {
        openingBalanceBatch.status = 'posted';
        openingBalanceBatch.fiscalPeriodId = openingBalancePreviewResult.fiscalPeriodId;
        openingBalanceBatch.decidedBy = actor;
        openingBalanceBatch.decidedAt = approval.decidedAt;
        openingBalanceBatch.postedBy = actor;
        openingBalanceBatch.postedAt = entry.postedAt;
      }
    }
  }
  let legacyBackfillEvent = null;
  let legacyBackfillPayments = [];
  let legacyBackfillCosting = null;
  if (decision === 'approved' && legacyBackfill) {
    const order = legacyBackfill.sourcePayload;
    const tenderRows = legacyBackfillPreviewResult.tenders.map((row, index) => ({
      ...row, paymentId: `legacy:${legacyBackfill.id}:${index + 1}`,
      occurredAt: legacyBackfill.occurredAt || order.paidAt || order.createdAt,
      providerReference: legacyBackfill.evidenceReference || null,
    }));
    const recorded = recordEvent(db, {
      source: 'order.paid', sourceId: String(legacyBackfill.sourceId), sourceVersion: 1,
      idempotencyKey: `legacy-backfill:${legacyBackfill.id}:v1`, branchId: legacyBackfill.branchId,
      occurredAt: legacyBackfill.occurredAt, amountIrr: legacyBackfill.amountIrr,
      payload: {
        orderNo: order.orderNo || null, tenderSnapshot: tenderRows,
        calculation: { taxSource: legacyBackfillPreviewResult.taxSource },
        legacyArchiveId: legacyBackfill.id, evidenceReference: legacyBackfill.evidenceReference,
      },
    });
    legacyBackfillEvent = recorded.event;
    legacyBackfillEvent.status = 'posted'; legacyBackfillEvent.error = null; legacyBackfillEvent.journalEntryId = entry.id; legacyBackfillEvent.processedAt = now();
    entry.source = 'order.paid'; entry.sourceId = String(legacyBackfill.sourceId); entry.sourceEventId = legacyBackfillEvent.id;
    legacyBackfillPayments = materializeOrderPayments(db, order, tenderRows);
    legacyBackfillCosting = captureOrderCogs(db, order, { actor });
    legacyBackfill.backfillStatus = 'posted'; legacyBackfill.backfilledBy = actor; legacyBackfill.backfilledAt = now();
    legacyBackfill.backfillEventId = legacyBackfillEvent.id; legacyBackfill.backfillJournalEntryId = entry.id;
    legacyBackfill.decisionHistory = list(legacyBackfill.decisionHistory);
    legacyBackfill.decisionHistory.push({ action: 'backfill_posted', by: actor, at: legacyBackfill.backfilledAt, journalEntryId: entry.id, eventId: legacyBackfillEvent.id });
  }
  if (period && decision === 'approved') {
    period.status = 'reopened'; period.reopenedBy = actor; period.reopenedAt = now();
  }
  if (purchaseOrder) {
    purchaseOrder.status = decision === 'approved' ? 'approved' : 'rejected';
    if (decision === 'approved') { purchaseOrder.approvedBy = actor; purchaseOrder.approvedAt = now(); }
  }
  if (supplierPayment && decision === 'rejected') supplierPayment.status = 'rejected';
  if (costPayment && decision === 'rejected') costPayment.status = 'rejected';
  if (payrollPayment && decision === 'rejected') payrollPayment.status = 'rejected';
  if (financeRefund) {
    if (decision === 'rejected') financeRefund.status = 'cancelled';
    else {
      financeRefund.status = 'approved';
      financeRefund.approvedBy = actor;
      financeRefund.approvedAt = approval.decidedAt;
    }
  }
  if (recipeVersion) {
    recipeVersion.status = decision === 'approved' ? 'approved' : 'rejected';
    recipeVersion.history = list(recipeVersion.history);
    recipeVersion.history.push({ action: decision, by: actor, at: approval.decidedAt, comment: String(comment || '').slice(0, 300) || null });
    if (decision === 'approved') {
      recipeVersion.approvedBy = actor;
      recipeVersion.approvedAt = approval.decidedAt;
    } else {
      recipeVersion.rejectedBy = actor;
      recipeVersion.rejectedAt = approval.decidedAt;
    }
  }
  if (branchRollout) {
    branchRollout.status = decision === 'approved' ? 'active' : 'rejected';
    branchRollout.decidedBy = actor;
    branchRollout.decidedAt = approval.decidedAt;
    if (decision === 'approved') {
      branchRollout.activatedBy = actor;
      branchRollout.activatedAt = approval.decidedAt;
      branchRollout.readinessAtActivation = branchRolloutReadiness;
      if (!state.rollout.enabledBranchIds.map(Number).includes(Number(branchRollout.branchId))) state.rollout.enabledBranchIds.push(Number(branchRollout.branchId));
      if (!state.rollout.cutoverBranchIds.map(Number).includes(Number(branchRollout.branchId))) state.rollout.cutoverBranchIds.push(Number(branchRollout.branchId));
      state.cutover = {
        ...(state.cutover || {}), status: 'branch_cutover_active',
        startedAt: state.cutover?.startedAt || branchRollout.activatedAt,
        approvedAt: branchRollout.activatedAt, approvedBy: actor,
      };
    }
  }
  if (financeRefund) {
    recordRefundAudit(db, financeRefund, decision === 'approved' ? 'approved' : 'rejected', actor, {
      approvalId: approval.id,
      comment: String(comment || '').trim().slice(0, 300) || null,
      decidedAt: approval.decidedAt,
    });
  }
  return { approval, entry, period, purchaseOrder, vendorInvoiceMatch, threeWayMatch, vendorInvoiceEntry, supplierPayment, supplierPaymentEntry, costAccrual, costPayment, costPaymentEntry, financeRefund, refundEntry, fixedAsset, depreciationRun, payrollRun, payrollPayment, payrollPaymentEntry, recipeVersion, openingBalanceBatch, branchRollout, branchRolloutReadiness, legacyBackfill, legacyBackfillEvent, legacyBackfillPayments, legacyBackfillCosting };
}

function reverseEntry(db, entryId, actor, reason, date = now()) {
  const state = ensureFinanceV2(db);
  const original = state.journalEntries.find((entry) => entry.id === entryId);
  if (!original) throw Object.assign(new Error('سند یافت نشد.'), { code: 'journal_not_found', status: 404 });
  if (original.status !== 'posted' || original.reversedById) throw Object.assign(new Error('این سند قابل معکوس‌سازی نیست.'), { code: 'journal_not_reversible', status: 409 });
  const reversalReason = String(reason || '').trim().slice(0, 180);
  if (reversalReason.length < 3) throw Object.assign(new Error('علت سند معکوس حداقل سه نویسه لازم دارد.'), { code: 'reversal_reason_required', status: 400 });
  const linkedCostAccrual = state.costAccruals.find((row) => row.journalEntryId === original.id);
  const linkedOperatingExpense = state.operatingExpenses.find((row) => row.journalEntryId === original.id);
  const linkedFixedAsset = state.fixedAssets.find((row) => row.acquisitionJournalEntryId === original.id);
  const linkedDepreciationRun = state.depreciationRuns.find((row) => row.journalEntryId === original.id);
  const linkedPayrollRun = state.payrollRuns.find((row) => row.journalEntryId === original.id);
  const linkedPayrollPayment = state.payrollPayments.find((row) => row.journalEntryId === original.id && row.status === 'paid');
  const linkedSupplierPayment = state.supplierPayments.find((row) => row.journalEntryId === original.id && row.status === 'paid');
  const linkedVendorInvoice = state.vendorInvoices.find((row) => row.journalEntryId === original.id)
    || (original.source === 'purchase.vendor_invoice' ? state.vendorInvoices.find((row) => row.id === original.sourceId) : null);
  const linkedOpeningBalance = state.openingBalanceBatches.find((row) => row.journalEntryId === original.id && row.status === 'posted');
  const linkedLegacyBackfill = state.legacyArchive.find((row) => row.backfillJournalEntryId === original.id && row.backfillStatus === 'posted');
  const linkedLegacyPayments = linkedLegacyBackfill
    ? state.payments.filter((payment) => String(payment.payload?.operationalPaymentId || '').startsWith(`legacy:${linkedLegacyBackfill.id}:`))
    : [];
  if (linkedCostAccrual && (int(linkedCostAccrual.paidAmountIrr) > 0 || state.costPayments.some((row) => row.costAccrualId === linkedCostAccrual.id && row.status === 'pending_approval'))) {
    throw Object.assign(new Error('ثبت هزینه پس از پرداخت یا درخواست پرداخت مستقیم معکوس نمی‌شود؛ ابتدا زنجیره پرداخت باید با سند معکوس کنترل‌شده اصلاح شود.'), { code: 'cost_accrual_has_payment_activity', status: 409 });
  }
  if (linkedFixedAsset && state.depreciationRuns.some((run) => run.status === 'posted' && list(run.lines).some((line) => line.assetId === linkedFixedAsset.id))) {
    throw Object.assign(new Error('خرید دارایی پس از ثبت استهلاک مستقیم معکوس نمی‌شود؛ ابتدا تمام ثبت‌های استهلاک باید به ترتیب معکوس شوند.'), { code: 'fixed_asset_has_depreciation', status: 409 });
  }
  if (linkedDepreciationRun && linkedDepreciationRun.lines.some((line) => state.depreciationRuns.some((run) => run.id !== linkedDepreciationRun.id
    && run.status === 'posted' && run.serviceMonth > linkedDepreciationRun.serviceMonth
    && list(run.lines).some((candidate) => candidate.assetId === line.assetId)))) {
    throw Object.assign(new Error('استهلاک ماه‌های جدیدتر ابتدا باید معکوس شود.'), { code: 'depreciation_reversal_order_invalid', status: 409 });
  }
  if (linkedPayrollRun && (Object.values(linkedPayrollRun.paidByLiability || {}).some((amount) => int(amount) > 0)
    || state.payrollPayments.some((payment) => payment.payrollRunId === linkedPayrollRun.id && payment.status === 'pending_approval'))) {
    throw Object.assign(new Error('ثبت حقوق پس از پرداخت یا درخواست پرداخت مستقیم معکوس نمی‌شود؛ ابتدا زنجیرهٔ پرداخت باید با سند معکوس کنترل‌شده اصلاح شود.'), { code: 'payroll_run_has_payment_activity', status: 409 });
  }
  if (linkedVendorInvoice && (int(linkedVendorInvoice.paidAmountIrr) > 0
    || state.supplierPayments.some((payment) => payment.vendorInvoiceId === linkedVendorInvoice.id && payment.status === 'pending_approval'))) {
    throw Object.assign(new Error('فاکتور تأمین‌کننده پس از پرداخت یا درخواست پرداخت مستقیم معکوس نمی‌شود؛ ابتدا زنجیرهٔ پرداخت باید با سند معکوس کنترل‌شده اصلاح شود.'), { code: 'vendor_invoice_has_payment_activity', status: 409 });
  }
  if (linkedLegacyBackfill) {
    const paymentIds = new Set(linkedLegacyPayments.map((payment) => payment.id));
    const reconciled = state.reconciliationItems.some((item) => paymentIds.has(item.paymentId) && item.status !== 'unmatched');
    if (reconciled) throw Object.assign(new Error('پرداخت بازسازی‌شده پس از تطبیق مستقیم معکوس نمی‌شود؛ ابتدا تطبیق یا تسویه باید کنترل‌شده برگشت داده شود.'), { code: 'legacy_backfill_has_reconciliation_activity', status: 409 });
    const refunded = state.refunds.some((refund) => paymentIds.has(refund.paymentId) && !['cancelled', 'failed'].includes(refund.status));
    if (refunded) throw Object.assign(new Error('فروش بازسازی‌شده پس از ثبت بازپرداخت مستقیم معکوس نمی‌شود؛ ابتدا زنجیرهٔ refund باید اصلاح شود.'), { code: 'legacy_backfill_has_refund_activity', status: 409 });
    const cogsEvent = state.events.find((event) => event.source === 'order.cogs'
      && String(event.sourceId) === String(linkedLegacyBackfill.sourceId) && sameExactBranch(event, linkedLegacyBackfill));
    const cogsEntry = cogsEvent?.journalEntryId ? state.journalEntries.find((entry) => entry.id === cogsEvent.journalEntryId) : null;
    if (cogsEntry?.status === 'posted' && !cogsEntry.reversedById) throw Object.assign(new Error('پیش از برگشت فروش بازسازی‌شده، مصرف انبار و بهای تمام‌شدهٔ وابسته باید کنترل‌شده معکوس شود.'), { code: 'legacy_backfill_has_posted_cogs', status: 409 });
  }
  const periodCheck = validateOpenPeriod(db, date, original.branchId);
  if (!periodCheck.ok) throw Object.assign(new Error(periodCheck.message), { code: periodCheck.code, status: 409 });
  const reversal = {
    ...original, id: id('fje'), number: `F2-R-${String(state.journalEntries.length + 1).padStart(6, '0')}`,
    periodId: periodCheck.period.id, sourceEventId: null, source: 'reversal', sourceId: original.id,
    date, description: `معکوس ${original.number}: ${reversalReason}`,
    status: 'posted', reversalOfId: original.id, reversedById: null,
    lines: original.lines.map((line, index) => ({ ...line, id: id('fjl'), lineNo: index + 1, debitIrr: int(line.creditIrr), creditIrr: int(line.debitIrr) })),
    createdAt: now(), createdBy: actor, postedAt: now(), postedBy: actor,
  };
  state.journalEntries.push(reversal);
  original.reversedById = reversal.id; original.reversedAt = now();
  try {
    const accountingEngine = require('./accounting-engine.js');
    const linkedEvent = (state.events || []).find((ev) => ev.journalEntryId === original.id && ev.source === 'order.paid');
    if (linkedEvent?.sourceId) {
      accountingEngine.reverseOrderSalesJournal(db, linkedEvent.sourceId, {
        reason: reversalReason || 'برگشت سند در فینانس',
        userId: actor,
      });
    }
  } catch (_) {}
  if (linkedCostAccrual) linkedCostAccrual.status = 'reversed';
  if (linkedOperatingExpense) {
    linkedOperatingExpense.status = 'reversed'; linkedOperatingExpense.reversalJournalEntryId = reversal.id;
    linkedOperatingExpense.reversedBy = actor; linkedOperatingExpense.reversedAt = now();
  }
  if (linkedFixedAsset) { linkedFixedAsset.status = 'reversed'; linkedFixedAsset.reversalJournalEntryId = reversal.id; linkedFixedAsset.reversedAt = now(); }
  if (linkedDepreciationRun) {
    linkedDepreciationRun.status = 'reversed'; linkedDepreciationRun.reversalJournalEntryId = reversal.id; linkedDepreciationRun.reversedAt = now();
    linkedDepreciationRun.lines.forEach((line) => {
      const asset = state.fixedAssets.find((row) => row.id === line.assetId);
      if (asset) {
        asset.accumulatedDepreciationIrr = Math.max(0, int(asset.accumulatedDepreciationIrr) - int(line.amountIrr));
        const latest = state.depreciationRuns
          .filter((run) => run.id !== linkedDepreciationRun.id && run.status === 'posted' && list(run.lines).some((candidate) => candidate.assetId === asset.id))
          .sort((a, b) => String(b.serviceMonth).localeCompare(String(a.serviceMonth)))[0];
        asset.lastDepreciationMonth = latest?.serviceMonth || null;
        asset.lastDepreciationAt = latest?.postedAt || null;
      }
    });
  }
  if (linkedPayrollRun) {
    linkedPayrollRun.status = 'reversed'; linkedPayrollRun.reversalJournalEntryId = reversal.id; linkedPayrollRun.reversedAt = now();
  }
  if (linkedOpeningBalance) {
    linkedOpeningBalance.status = 'reversed';
    linkedOpeningBalance.reversalJournalEntryId = reversal.id;
    linkedOpeningBalance.reversedBy = actor;
    linkedOpeningBalance.reversedAt = now();
  }
  const linkedCostPayment = state.costPayments.find((row) => row.journalEntryId === original.id && row.status === 'paid');
  if (linkedCostPayment) {
    linkedCostPayment.status = 'reversed'; linkedCostPayment.reversalJournalEntryId = reversal.id; linkedCostPayment.reversedAt = now();
    const accrual = state.costAccruals.find((row) => row.id === linkedCostPayment.costAccrualId);
    if (accrual) {
      accrual.paidAmountIrr = Math.max(0, int(accrual.paidAmountIrr) - int(linkedCostPayment.amountIrr));
      accrual.status = accrual.paidAmountIrr > 0 ? 'partially_paid' : 'posted';
    }
  }
  if (linkedPayrollPayment) {
    linkedPayrollPayment.status = 'reversed'; linkedPayrollPayment.reversalJournalEntryId = reversal.id; linkedPayrollPayment.reversedAt = now();
    const run = state.payrollRuns.find((row) => row.id === linkedPayrollPayment.payrollRunId);
    if (run) {
      run.paidByLiability[linkedPayrollPayment.liabilityType] = Math.max(0, int(run.paidByLiability?.[linkedPayrollPayment.liabilityType]) - int(linkedPayrollPayment.amountIrr));
      const totalLiabilityIrr = Object.values(run.liabilities || {}).reduce((sum, value) => sum + int(value), 0);
      const totalPaidIrr = Object.values(run.paidByLiability || {}).reduce((sum, value) => sum + int(value), 0);
      run.status = totalPaidIrr <= 0 ? 'posted' : totalPaidIrr >= totalLiabilityIrr ? 'paid' : 'partially_paid';
    }
  }
  if (linkedSupplierPayment) {
    linkedSupplierPayment.status = 'reversed';
    linkedSupplierPayment.reversalJournalEntryId = reversal.id;
    linkedSupplierPayment.reversedBy = actor;
    linkedSupplierPayment.reversedAt = now();
    const invoice = state.vendorInvoices.find((row) => row.id === linkedSupplierPayment.vendorInvoiceId);
    if (invoice) {
      invoice.paidAmountIrr = Math.max(0, int(invoice.paidAmountIrr) - int(linkedSupplierPayment.amountIrr));
      invoice.status = invoice.paidAmountIrr <= 0 ? 'open' : invoice.paidAmountIrr >= invoice.totalIrr ? 'paid' : 'partially_paid';
    }
    const linkedEvent = state.events.find((event) => event.source === 'purchase.supplier_payment' && event.sourceId === linkedSupplierPayment.id);
    if (linkedEvent) linkedEvent.payload = { ...(linkedEvent.payload || {}), reversalJournalEntryId: reversal.id, reversedAt: linkedSupplierPayment.reversedAt, reversedBy: actor };
  }
  if (linkedVendorInvoice) {
    linkedVendorInvoice.status = 'reversed';
    linkedVendorInvoice.matchStatus = 'reversed';
    linkedVendorInvoice.reversalJournalEntryId = reversal.id;
    linkedVendorInvoice.reversedBy = actor;
    linkedVendorInvoice.reversedAt = now();
    const match = state.threeWayMatches.find((row) => row.vendorInvoiceId === linkedVendorInvoice.id);
    if (match) { match.status = 'reversed'; match.reversedBy = actor; match.reversedAt = linkedVendorInvoice.reversedAt; match.reversalJournalEntryId = reversal.id; }
    const linkedEvent = state.events.find((event) => event.source === 'purchase.vendor_invoice' && event.sourceId === linkedVendorInvoice.id);
    if (linkedEvent) linkedEvent.payload = { ...(linkedEvent.payload || {}), reversalJournalEntryId: reversal.id, reversedAt: linkedVendorInvoice.reversedAt, reversedBy: actor };
  }
  state.reconciliationItems.filter((item) => item.journalEntryId === original.id && item.status === 'matched').forEach((item) => {
    item.details = {
      ...(item.details || {}), previousMatch: { journalEntryId: original.id, matchedAt: item.matchedAt || null, matchedBy: item.matchedBy || null },
      unmatchReason: 'journal_reversed', reversalJournalEntryId: reversal.id, unmatchedAt: now(), unmatchedBy: actor,
    };
    item.status = 'unmatched'; item.journalEntryId = null; item.matchedAt = null; item.matchedBy = null;
  });
  if (linkedLegacyBackfill) {
    linkedLegacyPayments.forEach((payment) => {
      payment.status = 'cancelled';
      payment.payload = { ...(payment.payload || {}), reversalJournalEntryId: reversal.id, reversedAt: now(), reversedBy: actor };
      const reconciliationItem = state.reconciliationItems.find((item) => item.paymentId === payment.id);
      if (reconciliationItem) {
        reconciliationItem.status = 'exception';
        reconciliationItem.details = { ...(reconciliationItem.details || {}), reason: 'legacy_backfill_reversed', reversalJournalEntryId: reversal.id };
      }
    });
    linkedLegacyBackfill.backfillStatus = 'reversed';
    linkedLegacyBackfill.backfillReversalJournalEntryId = reversal.id;
    linkedLegacyBackfill.backfillReversedBy = actor;
    linkedLegacyBackfill.backfillReversedAt = now();
    linkedLegacyBackfill.decisionHistory = list(linkedLegacyBackfill.decisionHistory);
    linkedLegacyBackfill.decisionHistory.push({ action: 'backfill_reversed', by: actor, at: linkedLegacyBackfill.backfillReversedAt, journalEntryId: reversal.id, reason: String(reason || '').slice(0, 180) || null });
    const linkedEvent = state.events.find((event) => event.id === linkedLegacyBackfill.backfillEventId);
    if (linkedEvent) linkedEvent.payload = { ...(linkedEvent.payload || {}), reversalJournalEntryId: reversal.id, reversedAt: linkedLegacyBackfill.backfillReversedAt };
  }
  return reversal;
}

function envelope(data, query = {}, extraMeta = {}) {
  return {
    data,
    meta: {
      generatedAt: now(), calculatedAt: now(), currency: 'IRR', displayCurrency: 'TOMAN',
      apiContractVersion: financeContracts.API_CONTRACT_VERSION,
      valueContractVersion: valueContracts.VALUE_CONTRACT_VERSION,
      responseShape: '{ data, meta, error }',
      branchId: query.branchId ? Number(query.branchId) : null, from: query.from || null, to: query.to || null,
      source: 'WESTO Finance V2', ...extraMeta,
    },
    error: null,
  };
}

function errorBody(error, query = {}) {
  return {
    data: null,
    meta: {
      generatedAt: now(), currency: 'IRR', apiContractVersion: financeContracts.API_CONTRACT_VERSION,
      valueContractVersion: valueContracts.VALUE_CONTRACT_VERSION,
      responseShape: '{ data, meta, error }', branchId: query.branchId ? Number(query.branchId) : null,
    },
    error: { code: error.code || 'finance_error', message: error.message || 'خطای مالی', details: error.details || null },
  };
}

function page(rows, query) {
  const pageNo = Math.max(1, int(query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, int(query.pageSize) || 25));
  const total = rows.length;
  return { rows: rows.slice((pageNo - 1) * pageSize, pageNo * pageSize), page: pageNo, pageSize, total, pages: Math.ceil(total / pageSize) };
}

function financeRequestBranchCandidates(db, req) {
  const state = db.financeV2 || {};
  const candidates = [];
  const add = (value) => {
    if (value == null || value === '') return;
    const branchId = Number(value);
    if (Number.isSafeInteger(branchId) && branchId > 0) candidates.push(branchId);
  };
  add(req.query?.branchId);
  add(req.body?.branchId);
  add(req.params?.branchId);
  list(req.body?.lines).forEach((line) => add(line?.branchId));

  // Express normally exposes req.route.path, but a few adapters and test
  // harnesses only preserve params/path.  Entity scope must not disappear in
  // that case: an inferred branch for a scoped actor must still be checked
  // against the order being captured.
  if (req.params?.orderId != null) {
    add(list(db.orders).find((row) => String(row.id) === String(req.params.orderId))?.branchId);
  }

  const findBranch = (collection, entityId) => {
    if (entityId == null || entityId === '') return;
    add(list(state[collection]).find((row) => String(row.id) === String(entityId))?.branchId);
  };
  const routePath = String(req.route?.path || req.path || '').split('?')[0];
  if (routePath.includes('/orders/:orderId')) {
    add(list(db.orders).find((row) => String(row.id) === String(req.params?.orderId))?.branchId);
  } else if (routePath.includes('/purchase-orders/:id')) findBranch('purchaseOrders', req.params?.id);
  else if (routePath.includes('/vendor-invoices/:id')) findBranch('vendorInvoices', req.params?.id);
  else if (routePath.includes('/cost-commitments/:id')) findBranch('costCommitments', req.params?.id);
  else if (routePath.includes('/cost-accruals/:id')) findBranch('costAccruals', req.params?.id);
  else if (routePath.includes('/inventory-operations/:eventId')) findBranch('events', req.params?.eventId);
  else if (routePath.includes('/payroll-runs/:id')) findBranch('payrollRuns', req.params?.id);
  else if (routePath.includes('/events/:id')) findBranch('events', req.params?.id);
  else if (routePath.includes('/migration/archive/:id')) findBranch('legacyArchive', req.params?.id);
  else if (routePath.includes('/journal-entries/:id')) findBranch('journalEntries', req.params?.id);
  else if (routePath.includes('/reconciliation/refunds/:id')) findBranch('refunds', req.params?.id);
  else if (routePath.includes('/bank-statement-lines/:id')) findBranch('reconciliationItems', req.params?.id);
  else if (routePath.includes('/approvals/:id')) {
    add(approvalEntityBranch(state, list(state.approvals).find((row) => row.id === req.params?.id)));
  }
  if (routePath.includes('/fiscal-periods/:id')) findBranch('fiscalPeriods', req.params?.id);

  findBranch('purchaseOrders', req.body?.purchaseOrderId || req.body?.poId);
  findBranch('goodsReceipts', req.body?.goodsReceiptId || req.body?.grnId);
  findBranch('journalEntries', req.body?.journalEntryId);
  list(req.body?.paymentIds).forEach((paymentId) => findBranch('payments', paymentId));
  return [...new Set(candidates)];
}

function assertOrderBranchScope(db, req, selectedBranchId) {
  if (req.params?.orderId == null || selectedBranchId == null) return;
  const order = list(db.orders).find((row) => String(row.id) === String(req.params.orderId));
  // Preserve the route's canonical 404 for an unknown order.  The handler
  // below owns that response; this guard only validates an existing entity.
  if (!order) return;
  const orderBranchId = branchDimension(order);
  if (orderBranchId == null) {
    throw Object.assign(new Error('شعبهٔ سفارش برای ثبت مالی مشخص نیست.'), {
      code: 'order_branch_missing', status: 409,
    });
  }
  if (orderBranchId !== Number(selectedBranchId)) {
    throw Object.assign(new Error('سفارش به شعبهٔ انتخاب‌شده تعلق ندارد.'), {
      code: 'order_branch_mismatch', status: 409,
      details: { orderBranchId, selectedBranchId: Number(selectedBranchId) },
    });
  }
}

// An owner is allowed to inspect multiple branches, but an explicit branch
// selector on a mutation is still a hard target.  The scope guard above only
// rejects branches outside a scoped user's assignment; without this second
// check an owner could send `?branchId=2` while the route entity (for example
// a vendor invoice or goods receipt) belongs to branch 1 and the domain
// handler would silently mutate that other entity.  Keep this generic so new
// branch-aware routes inherit the invariant as their entity candidates are
// added to financeRequestBranchCandidates().
function assertSelectedBranchMatchesCandidates(selectedBranchId, candidates) {
  if (selectedBranchId == null || selectedBranchId === '') return;
  const selected = Number(selectedBranchId);
  if (!Number.isSafeInteger(selected) || selected <= 0) return;
  const mismatched = list(candidates).find((candidate) => Number(candidate) !== selected);
  if (mismatched == null) return;
  throw Object.assign(new Error('رکورد مالی به شعبهٔ انتخاب‌شده تعلق ندارد.'), {
    code: 'finance_branch_entity_mismatch', status: 409,
    details: { entityBranchId: Number(mismatched), selectedBranchId: selected },
  });
}

function financeRouteIsBranchNeutral(req) {
  const routePath = String(req.route?.path || req.path || '').split('?')[0];
  // Fiscal periods are branch-scoped for every non-owner actor.  Keeping the
  // create route neutral let a manager with one allowed branch create a
  // global period by omitting branchId, which then became visible to other
  // branches as a fallback period.  Owners may still create global periods;
  // scoped actors are handled by the normal branch inference/requirement.
  return routePath.includes('/planning/break-even/preview');
}

function registerFinanceV2Routes({ app, getDb, save, requireCapability, effectiveRole, getStorageStatus = () => null }) {
  let mutationTail = Promise.resolve();
  const runHandler = async (handler, req, res) => {
    const mutating = req.method !== 'GET';
    const db = getDb();
    const mutationSnapshot = mutating ? Object.fromEntries(['financeV2', 'accounting', 'orders', 'cashSessions'].map((key) => [
      key,
      Object.prototype.hasOwnProperty.call(db, key) && db[key] !== undefined ? JSON.parse(JSON.stringify(db[key])) : undefined,
    ])) : null;
    try {
      assertFinanceBranchQuery(db, req);
      const allowedBranchIds = branchScopeForUser(req.user, { role: effectiveRole(req.user) });
      const requestedBranchIds = financeRequestBranchCandidates(db, req);
      if (allowedBranchIds !== null) {
        if (!allowedBranchIds.length) {
          throw Object.assign(new Error('برای این کاربر هیچ شعبهٔ مالی مجازی تعریف نشده است.'), { code: 'finance_branch_scope_empty', status: 403 });
        }
        const deniedBranchId = requestedBranchIds.find((branchId) => !allowedBranchIds.includes(branchId));
        if (deniedBranchId) {
          throw Object.assign(new Error('دسترسی مالی به شعبهٔ انتخاب‌شده مجاز نیست.'), {
            code: 'finance_branch_access_denied', status: 403, details: { branchId: deniedBranchId },
          });
        }
        if (!requestedBranchIds.length && !financeRouteIsBranchNeutral(req)) {
          if (allowedBranchIds.length !== 1) {
            throw Object.assign(new Error('برای این عملیات باید یکی از شعب مجاز به‌صورت صریح انتخاب شود.'), {
              code: 'finance_branch_required_for_scoped_user', status: 400,
            });
          }
          const query = req.query || {};
          query.branchId = allowedBranchIds[0];
        }
      }
      // Validate entity-vs-selection after scoped-user inference.  Without
      // this check, an adapter that omitted req.route.path could turn a
      // branch-1 inferred request into a capture of a branch-2 order.
      const selectedBranchId = req.query?.branchId ?? req.body?.branchId ?? null;
      assertOrderBranchScope(db, req, selectedBranchId);
      if (mutating) assertSelectedBranchMatchesCandidates(selectedBranchId, requestedBranchIds);
      applyFinanceResponseScope(req);
      let key = '';
      let state = null;
      if (mutating) {
        key = String(req.get?.('Idempotency-Key') || '').trim();
        if (key) {
          state = ensureFinanceV2(db);
          const signature = requestFingerprint(req);
          const existingRequest = state.idempotencyRequests[key];
          if (existingRequest && (existingRequest.kind !== signature.kind || existingRequest.fingerprint !== signature.fingerprint)) {
            throw Object.assign(new Error('این Idempotency-Key قبلاً برای عملیات یا بدنهٔ دیگری استفاده شده است؛ درخواست با کلید تازه ارسال شود.'), {
              code: 'idempotency_key_payload_mismatch', status: 409,
            });
          }
          if (!existingRequest && state.idempotency[key]) {
            throw Object.assign(new Error('اثر انگشت درخواست قدیمی برای این کلید موجود نیست؛ برای retry امن از کلید تازه استفاده کنید.'), {
              code: 'idempotency_key_legacy_unverifiable', status: 409,
            });
          }
          if (!existingRequest) state.idempotencyRequests[key] = { ...signature, at: now() };
        }
      }
      const result = await handler(req, res);
      if (key && state && !state.idempotency[key]) delete state.idempotencyRequests[key];
      return result;
    } catch (error) {
      if (mutating) {
        for (const [key, before] of Object.entries(mutationSnapshot || {})) {
          if (before === undefined) delete db[key];
          else db[key] = before;
        }
      }
      throw error;
    }
  };
  const guard = (handler) => (req, res) => {
    const execute = () => runHandler(handler, req, res);
    const task = req.method === 'GET' ? execute() : mutationTail.then(execute, execute);
    if (req.method !== 'GET') mutationTail = task.catch(() => undefined);
    return task.catch((error) => {
      if (res.headersSent) return undefined;
      return res.status(error.status || 400).json(errorBody(error, req.query));
    });
  };
  const operatorReceiptPayload = (result, idempotentReplay) => {
    const receipt = result?.goodsReceipt || null;
    return {
      goodsReceipt: receipt ? {
        id: receipt.id,
        number: receipt.number,
        purchaseOrderId: receipt.purchaseOrderId,
        purchaseOrderNumber: receipt.purchaseOrderNumber,
        branchId: receipt.branchId,
        deliveryNoteNumber: receipt.deliveryNoteNumber || null,
        receivedAt: receipt.receivedAt,
        status: receipt.status,
        lines: list(receipt.lines).map((line) => ({
          id: line.id,
          purchaseOrderLineId: line.purchaseOrderLineId,
          itemId: line.itemId,
          receivedQuantity: line.receivedQuantity,
          acceptedQuantity: line.acceptedQuantity,
          rejectedQuantity: line.rejectedQuantity,
          unit: line.unit || null,
        })),
      } : null,
      purchaseOrder: result?.purchaseOrder ? { id: result.purchaseOrder.id, number: result.purchaseOrder.number, status: result.purchaseOrder.status } : null,
      event: result?.event ? { id: result.event.id, status: result.event.status, errorCode: result.event.error?.code || null } : null,
      idempotentReplay,
      policy: { financialAccountsHiddenFromOperator: true, purchasePricesHiddenFromOperator: true, correctionMethod: 'reversal_only' },
    };
  };
  const goodsReceiptMutation = (operatorAudience = false) => guard(async (req, res) => {
    const key = String(req.get('Idempotency-Key') || '').trim();
    if (!key) throw Object.assign(new Error('کلید Idempotency-Key الزامی است.'), { code: 'idempotency_key_required', status: 400 });
    const db = getDb(); const state = ensureFinanceV2(db); const replay = state.idempotency[key];
    if (replay) {
      const goodsReceipt = state.goodsReceipts.find((row) => row.id === replay.id) || null;
      const purchaseOrder = goodsReceipt ? state.purchaseOrders.find((row) => row.id === goodsReceipt.purchaseOrderId) || null : null;
      const event = goodsReceipt ? state.events.find((row) => row.source === 'purchase.goods_received' && row.sourceId === goodsReceipt.id) || null : null;
      const payload = { goodsReceipt, purchaseOrder, event };
      return res.json(envelope(operatorAudience ? operatorReceiptPayload(payload, true) : { ...payload, idempotentReplay: true }, req.query, operatorAudience ? { audience: 'kitchen_inventory_operator' } : {}));
    }
    const result = receiveGoodsV2(db, req.body || {}, req.user.phone);
    state.idempotency[key] = { kind: 'goods_receipt', id: result.goodsReceipt.id, at: now() };
    await save({ requireDurable: true });
    res.status(201).json(envelope(operatorAudience ? operatorReceiptPayload(result, false) : { ...result, idempotentReplay: false }, req.query, operatorAudience ? { audience: 'kitchen_inventory_operator' } : {}));
  });
  const archiveScopeOptions = (req) => {
    const role = effectiveRole(req.user);
    const scoped = branchScopeForUser(req.user, { role }) !== null;
    const branchId = req.query?.branchId ? Number(req.query.branchId) : null;
    return { branchId, includeUnscoped: !scoped && branchId == null };
  };
  const assertArchiveRouteScope = (req, archiveId) => {
    const { branchId } = archiveScopeOptions(req);
    if (branchId == null) return;
    const record = ensureFinanceV2(getDb()).legacyArchive.find((row) => String(row.id) === String(archiveId));
    if (!record) return;
    if (record.branchId == null || Number(record.branchId) !== branchId) {
      throw Object.assign(new Error('رکورد مهاجرت به شعبهٔ انتخاب‌شده تخصیص ندارد.'), {
        code: 'legacy_archive_branch_scope_denied', status: 403,
      });
    }
  };
  app.get('/api/admin/v2/finance/contracts', requireCapability('finance.view'), guard((req, res) => {
    res.json(envelope(financeContracts.contractDocument(), req.query));
  }));
  app.get('/api/admin/v2/finance/workbench', requireCapability('finance.view'), guard((req, res) => res.json(envelope(workbench(getDb(), req.query, { storageStatus: getStorageStatus() }), req.query))));
  app.get('/api/admin/v2/finance/cutover-readiness', requireCapability('finance.reports.view'), guard((req, res) => res.json(envelope(shadowRunReadiness(getDb(), req.query.branchId ? Number(req.query.branchId) : null, { storageStatus: getStorageStatus() }), req.query))));
  app.get('/api/admin/v2/finance/cutover-runbook', requireCapability('finance.reports.view'), guard((req, res) => {
    const branchId = req.query.branchId ? Number(req.query.branchId) : null;
    const storageStatus = getStorageStatus();
    const readiness = shadowRunReadiness(getDb(), branchId, { storageStatus });
    const qualityGate = readiness.gates.find((gate) => gate.id === 'data_quality');
    const runbook = buildCutoverRunbook({
      shadowReadiness: readiness,
      destination: { available: storageStatus?.available === true },
      qualityIssues: Array.isArray(qualityGate?.value) ? qualityGate.value : [],
    });
    res.json(envelope({ ...runbook, readiness }, { ...req.query, branchId }));
  }));
  app.get('/api/admin/v2/finance/rollout', requireCapability('finance.view'), guard((req, res) => {
    const branchId = Number(req.query.branchId) || Number(getDb().branches?.[0]?.id) || null;
    res.json(envelope(branchRolloutStatus(getDb(), branchId, { storageStatus: getStorageStatus() }), req.query));
  }));
  app.post('/api/admin/v2/finance/rollout/:branchId/cutover-request', requireCapability('finance.settings.manage'), guard(async (req, res) => {
    const key = String(req.get('Idempotency-Key') || '').trim();
    if (!key) throw Object.assign(new Error('کلید Idempotency-Key الزامی است.'), { code: 'idempotency_key_required', status: 400 });
    const db = getDb(); const state = ensureFinanceV2(db); const replay = state.idempotency[key];
    if (replay) return res.json(envelope({ rollout: state.branchRollouts.find((row) => row.id === replay.id) || null, idempotentReplay: true }, req.query));
    const result = requestBranchCutover(db, req.params.branchId, req.user.phone, { storageStatus: getStorageStatus() });
    state.idempotency[key] = { kind: 'finance_branch_cutover_request', id: result.rollout.id, at: now() };
    await save({ requireDurable: true });
    res.status(result.idempotentReplay ? 200 : 201).json(envelope(result, req.query));
  }));
  app.get('/api/admin/v2/finance/sales-cash-bank', requireCapability('finance.view'), guard((req, res) => res.json(envelope(salesCashBank(getDb(), req.query), req.query))));
  app.get('/api/admin/v2/finance/orders/:orderId/chain', requireCapability('finance.view'), guard((req, res) => {
    const branchId = req.query.branchId ? Number(req.query.branchId) : null;
    res.json(envelope(financeOrderChain(getDb(), req.params.orderId, branchId), req.query));
  }));
  app.get('/api/admin/v2/finance/inventory-items', requireCapability('inventory.view'), guard((req, res) => {
    const operatorAudience = effectiveRole(req.user) === 'kitchen';
    res.json(envelope(inventoryItemsView(getDb(), req.query, { hideFinancial: operatorAudience }), req.query, operatorAudience ? { audience: 'kitchen_inventory_operator' } : {}));
  }));
  app.post('/api/admin/v2/finance/inventory-items', requireCapability('inventory.manage'), guard(async (req, res) => {
    const key = String(req.get('Idempotency-Key') || '').trim();
    if (!key) throw Object.assign(new Error('کلید Idempotency-Key الزامی است.'), { code: 'idempotency_key_required', status: 400 });
    const db = getDb(); const state = ensureFinanceV2(db); const replay = state.idempotency[key];
    if (replay) return res.json(envelope({ item: list(db.accounting?.inventoryItems).find((row) => row.id === replay.id), idempotentReplay: true }, req.query));
    const item = createInventoryItemV2(db, { ...(req.body || {}), branchId: req.body?.branchId || req.query.branchId }, req.user.phone).item;
    state.idempotency[key] = { kind: 'inventory_item_create', id: item.id, at: now() };
    await save({ requireDurable: true });
    res.status(201).json(envelope({ item, idempotentReplay: false }, req.query));
  }));
  if (typeof app.patch === 'function') app.patch('/api/admin/v2/finance/inventory-items/:id', requireCapability('inventory.manage'), guard(async (req, res) => {
    const key = String(req.get('Idempotency-Key') || '').trim();
    if (!key) throw Object.assign(new Error('کلید Idempotency-Key الزامی است.'), { code: 'idempotency_key_required', status: 400 });
    const db = getDb(); const state = ensureFinanceV2(db); const replay = state.idempotency[key];
    if (replay) return res.json(envelope({ item: list(db.accounting?.inventoryItems).find((row) => row.id === replay.id), idempotentReplay: true }, req.query));
    const result = updateInventoryItemV2(db, req.params.id, { ...(req.body || {}), branchId: req.body?.branchId || req.query.branchId }, req.user.phone);
    state.idempotency[key] = { kind: 'inventory_item_update', id: result.item.id, at: now() };
    await save({ requireDurable: true });
    res.json(envelope(result, req.query));
  }));
  app.get('/api/admin/v2/finance/operating-expenses', requireCapability('finance.view'), guard((req, res) => {
    res.json(envelope(operatingExpensesView(getDb(), req.query), req.query));
  }));
  app.post('/api/admin/v2/finance/operating-expenses', requireCapability('finance.journal.create'), guard(async (req, res) => {
    const key = String(req.get('Idempotency-Key') || '').trim();
    if (!key) throw Object.assign(new Error('کلید Idempotency-Key الزامی است.'), { code: 'idempotency_key_required', status: 400 });
    const db = getDb(); const state = ensureFinanceV2(db); const replay = state.idempotency[key];
    if (replay) {
      const expense = state.operatingExpenses.find((row) => row.id === replay.id) || null;
      const journalEntry = expense ? state.journalEntries.find((row) => row.id === expense.journalEntryId) || null : null;
      const approval = expense ? state.approvals.find((row) => row.id === expense.approvalId) || null : null;
      return res.json(envelope({ expense, journalEntry, approval, idempotentReplay: true }, req.query));
    }
    const result = createOperatingExpenseV2(db, { ...(req.body || {}), branchId: req.body?.branchId || req.query.branchId }, req.user.phone);
    state.idempotency[key] = { kind: 'operating_expense_create', id: result.expense.id, at: now() };
    await save({ requireDurable: true });
    res.status(201).json(envelope(result, req.query));
  }));
  // Cashiers/accountants may request a refund, but the separate approval and
  // disbursement routes retain their stricter capabilities and controls.
  app.post('/api/admin/v2/finance/orders/:orderId/refund-requests', requireCapability(['payments.refund.request', 'finance.events.manage']), guard(async (req, res) => {
    const rawKey = String(req.get('Idempotency-Key') || '');
    if (!rawKey.trim()) throw Object.assign(new Error('کلید Idempotency-Key الزامی است.'), { code: 'idempotency_key_required', status: 400 });
    const key = normalizeIdempotencyKey(rawKey);
    const db = getDb(); const state = ensureFinanceV2(db); const replay = state.idempotency[key];
    if (replay) {
      if (replay.kind !== 'customer_refund_request') {
        throw Object.assign(new Error('این Idempotency-Key قبلاً برای عملیات دیگری مصرف شده است؛ برای درخواست بازپرداخت از کلید تازه استفاده کنید.'), {
          code: 'idempotency_key_payload_mismatch', status: 409,
        });
      }
      const refund = state.refunds.find((row) => row.id === replay.id);
      if (!refund || String(refund.idempotencyKey || '') !== key) {
        throw Object.assign(new Error('رکورد تکرارنشدنی بازپرداخت با درخواست ثبت‌شده سازگار نیست؛ از ثبت دوباره خودداری کنید.'), {
          code: 'refund_idempotency_record_inconsistent', status: 409,
        });
      }
      const approval = state.approvals.find((row) => row.entityType === 'finance_refund' && row.entityId === refund.id) || null;
      return res.json(envelope({ refund, approval, idempotentReplay: true }, req.query));
    }
    const result = requestOrderRefund(db, req.params.orderId, req.body || {}, req.user.phone, key);
    state.idempotency[key] = { kind: 'customer_refund_request', id: result.refund.id, at: now() };
    await save({ requireDurable: true }); res.status(201).json(envelope({ ...result, idempotentReplay: false }, req.query));
  }));
  app.get('/api/admin/v2/finance/purchases-payables', requireCapability('finance.payables.manage'), guard((req, res) => res.json(envelope(purchasesPayables(getDb(), req.query), req.query))));
  app.post('/api/admin/v2/finance/purchase-orders', requireCapability('finance.payables.manage'), guard(async (req, res) => {
    const key = String(req.get('Idempotency-Key') || '').trim();
    if (!key) throw Object.assign(new Error('کلید Idempotency-Key الزامی است.'), { code: 'idempotency_key_required', status: 400 });
    const db = getDb(); const state = ensureFinanceV2(db); const replay = state.idempotency[key];
    if (replay) return res.json(envelope({ purchaseOrder: state.purchaseOrders.find((row) => row.id === replay.id), idempotentReplay: true }, req.query));
    // The branch guard may infer a single allowed branch from the authenticated
    // user and expose it through the query.  Carry that decision into the
    // mutation payload; otherwise a scoped cashier/manager can be rejected by
    // the domain validator even though the request is safely branch-scoped.
    const purchaseOrder = createPurchaseOrderV2(db, { ...(req.body || {}), branchId: req.body?.branchId || req.query.branchId }, req.user.phone);
    state.idempotency[key] = { kind: 'purchase_order', id: purchaseOrder.id, at: now() }; await save({ requireDurable: true });
    res.status(201).json(envelope({ purchaseOrder, idempotentReplay: false }, req.query));
  }));
  app.post('/api/admin/v2/finance/purchase-orders/:id/submit', requireCapability('finance.payables.manage'), guard(async (req, res) => {
    const key = String(req.get('Idempotency-Key') || '').trim();
    if (!key) throw Object.assign(new Error('کلید Idempotency-Key الزامی است.'), { code: 'idempotency_key_required', status: 400 });
    const db = getDb(); const state = ensureFinanceV2(db); const replay = state.idempotency[key];
    if (replay) return res.json(envelope({ approval: state.approvals.find((row) => row.id === replay.id), idempotentReplay: true }, req.query));
    const result = submitPurchaseOrderV2(db, req.params.id, req.user.phone);
    state.idempotency[key] = { kind: 'purchase_order_submit', id: result.approval.id, at: now() }; await save({ requireDurable: true });
    res.json(envelope(result, req.query));
  }));
  app.post('/api/admin/v2/finance/goods-receipts', requireCapability('inventory.receiving'), goodsReceiptMutation(false));
  app.post('/api/admin/v2/finance/vendor-invoices', requireCapability('finance.payables.manage'), guard(async (req, res) => {
    const key = String(req.get('Idempotency-Key') || '').trim();
    if (!key) throw Object.assign(new Error('کلید Idempotency-Key الزامی است.'), { code: 'idempotency_key_required', status: 400 });
    const db = getDb(); const state = ensureFinanceV2(db); const replay = state.idempotency[key];
    if (replay) return res.json(envelope({ vendorInvoice: state.vendorInvoices.find((row) => row.id === replay.id), idempotentReplay: true }, req.query));
    const result = createVendorInvoiceV2(db, req.body || {}, req.user.phone);
    state.idempotency[key] = { kind: 'vendor_invoice', id: result.vendorInvoice.id, at: now() }; await save({ requireDurable: true });
    res.status(201).json(envelope({ ...result, idempotentReplay: false }, req.query));
  }));
  app.post('/api/admin/v2/finance/vendor-invoices/:id/match-review', requireCapability('finance.payables.manage'), guard(async (req, res) => {
    const key = String(req.get('Idempotency-Key') || '').trim();
    if (!key) throw Object.assign(new Error('کلید Idempotency-Key الزامی است.'), { code: 'idempotency_key_required', status: 400 });
    const db = getDb(); const state = ensureFinanceV2(db); const replay = state.idempotency[key];
    if (replay) {
      const approval = state.approvals.find((row) => row.id === replay.id) || null;
      const vendorInvoice = state.vendorInvoices.find((row) => row.id === req.params.id) || null;
      const threeWayMatch = vendorInvoice ? state.threeWayMatches.find((row) => row.vendorInvoiceId === vendorInvoice.id) || null : null;
      return res.json(envelope({ vendorInvoice, threeWayMatch, approval, idempotentReplay: true }, req.query));
    }
    const result = requestVendorInvoiceMatchReview(db, req.params.id, req.body || {}, req.user.phone);
    state.idempotency[key] = { kind: 'vendor_invoice_match_review', id: result.approval.id, at: now() };
    await save({ requireDurable: true });
    res.status(result.idempotentReplay ? 200 : 201).json(envelope(result, req.query));
  }));
  app.post('/api/admin/v2/finance/vendor-invoices/:id/payment-request', requireCapability('finance.payables.manage'), guard(async (req, res) => {
    const key = String(req.get('Idempotency-Key') || '').trim();
    if (!key) throw Object.assign(new Error('کلید Idempotency-Key الزامی است.'), { code: 'idempotency_key_required', status: 400 });
    const db = getDb(); const state = ensureFinanceV2(db); const replay = state.idempotency[key];
    if (replay) return res.json(envelope({ supplierPayment: state.supplierPayments.find((row) => row.id === replay.id), idempotentReplay: true }, req.query));
    const result = requestSupplierPaymentV2(db, req.params.id, req.body || {}, req.user.phone);
    state.idempotency[key] = { kind: 'supplier_payment_request', id: result.supplierPayment.id, at: now() }; await save({ requireDurable: true });
    res.status(201).json(envelope({ ...result, idempotentReplay: false }, req.query));
  }));
  app.post('/api/admin/v2/finance/cost-commitments', requireCapability('finance.payables.manage'), guard(async (req, res) => {
    const key = String(req.get('Idempotency-Key') || '').trim();
    if (!key) throw Object.assign(new Error('کلید Idempotency-Key الزامی است.'), { code: 'idempotency_key_required', status: 400 });
    const db = getDb(); const state = ensureFinanceV2(db); const replay = state.idempotency[key];
    if (replay) return res.json(envelope({ commitment: state.costCommitments.find((row) => row.id === replay.id), idempotentReplay: true }, req.query));
    const commitment = createCostCommitment(db, { ...(req.body || {}), branchId: req.body?.branchId || req.query.branchId }, req.user.phone);
    state.idempotency[key] = { kind: 'cost_commitment', id: commitment.id, at: now() }; await save({ requireDurable: true });
    res.status(201).json(envelope({ commitment, idempotentReplay: false }, req.query));
  }));
  app.post('/api/admin/v2/finance/cost-commitments/:id/deactivate', requireCapability('finance.payables.manage'), guard(async (req, res) => {
    const key = String(req.get('Idempotency-Key') || '').trim();
    if (!key) throw Object.assign(new Error('کلید Idempotency-Key الزامی است.'), { code: 'idempotency_key_required', status: 400 });
    const db = getDb(); const state = ensureFinanceV2(db); const replay = state.idempotency[key];
    if (replay) return res.json(envelope({ commitment: state.costCommitments.find((row) => row.id === replay.id), idempotentReplay: true }, req.query));
    const result = deactivateCostCommitment(db, req.params.id, req.user.phone);
    state.idempotency[key] = { kind: 'cost_commitment_deactivate', id: result.commitment.id, at: now() }; await save({ requireDurable: true });
    res.json(envelope(result, req.query));
  }));
  app.post('/api/admin/v2/finance/cost-commitments/:id/accruals', requireCapability('finance.payables.manage'), guard(async (req, res) => {
    const key = String(req.get('Idempotency-Key') || '').trim();
    if (!key) throw Object.assign(new Error('کلید Idempotency-Key الزامی است.'), { code: 'idempotency_key_required', status: 400 });
    const db = getDb(); const state = ensureFinanceV2(db); const replay = state.idempotency[key];
    if (replay) return res.json(envelope({ accrual: state.costAccruals.find((row) => row.id === replay.id), idempotentReplay: true }, req.query));
    const result = createCostAccrual(db, req.params.id, req.body || {}, req.user.phone);
    state.idempotency[key] = { kind: 'cost_accrual', id: result.accrual.id, at: now() }; await save({ requireDurable: true });
    res.status(201).json(envelope({ ...result, idempotentReplay: false }, req.query));
  }));
  app.post('/api/admin/v2/finance/cost-accruals/:id/payment-request', requireCapability('finance.payables.manage'), guard(async (req, res) => {
    const key = String(req.get('Idempotency-Key') || '').trim();
    if (!key) throw Object.assign(new Error('کلید Idempotency-Key الزامی است.'), { code: 'idempotency_key_required', status: 400 });
    const db = getDb(); const state = ensureFinanceV2(db); const replay = state.idempotency[key];
    if (replay) return res.json(envelope({ payment: state.costPayments.find((row) => row.id === replay.id), idempotentReplay: true }, req.query));
    const result = requestCostAccrualPayment(db, req.params.id, req.body || {}, req.user.phone);
    state.idempotency[key] = { kind: 'cost_payment_request', id: result.payment.id, at: now() }; await save({ requireDurable: true });
    res.status(201).json(envelope({ ...result, idempotentReplay: false }, req.query));
  }));
  app.get('/api/kitchen/inventory', requireCapability('inventory.view'), guard((req, res) => {
    res.json(envelope(kitchenInventory(getDb(), req.query), req.query, { audience: 'kitchen_inventory_operator' }));
  }));
  app.post('/api/kitchen/inventory/goods-receipts', requireCapability('inventory.receiving'), goodsReceiptMutation(true));
  app.post('/api/kitchen/inventory/recipe-versions', requireCapability('inventory.operations'), guard(async (req, res) => {
    const key = String(req.get('Idempotency-Key') || '').trim();
    if (!key) throw Object.assign(new Error('کلید Idempotency-Key الزامی است.'), { code: 'idempotency_key_required', status: 400 });
    const db = getDb(); const state = ensureFinanceV2(db); const replay = state.idempotency[key];
    if (replay) {
      const recipeVersion = state.recipeVersions.find((row) => row.id === replay.id) || null;
      const approval = recipeVersion ? state.approvals.find((row) => row.id === recipeVersion.approvalId) || null : null;
      return res.json(envelope({ recipeVersion, approval, idempotentReplay: true }, req.query, { audience: 'kitchen_inventory_operator' }));
    }
    const result = requestRecipeVersion(db, { ...(req.body || {}), branchId: req.body?.branchId || req.query.branchId }, req.user.phone);
    state.idempotency[key] = { kind: 'recipe_version_request', id: result.recipeVersion.id, at: now() };
    await save({ requireDurable: true });
    res.status(201).json(envelope({ ...result, idempotentReplay: false }, req.query, { audience: 'kitchen_inventory_operator' }));
  }));
  const inventoryMutation = (kind) => guard(async (req, res) => {
    const key = String(req.get('Idempotency-Key') || '').trim();
    if (!key) throw Object.assign(new Error('کلید Idempotency-Key الزامی است.'), { code: 'idempotency_key_required', status: 400 });
    const result = recordInventoryOperationV2(getDb(), kind, { ...(req.body || {}), branchId: req.body?.branchId || req.query.branchId }, req.user.phone, key);
    await save({ requireDurable: true });
    res.status(result.idempotentReplay ? 200 : 201).json(envelope(result, req.query, { audience: 'kitchen_inventory_operator' }));
  });
  app.post('/api/kitchen/inventory/waste', requireCapability('inventory.operations'), inventoryMutation('waste'));
  app.post('/api/kitchen/inventory/stock-counts', requireCapability('inventory.operations'), inventoryMutation('stock_count'));
  app.post('/api/kitchen/inventory/production-batches', requireCapability('inventory.operations'), inventoryMutation('production_batch'));
  app.post('/api/admin/v2/finance/inventory-movements', requireCapability('inventory.operations'), guard(async (req, res) => {
    const key = String(req.get('Idempotency-Key') || '').trim();
    if (!key) throw Object.assign(new Error('کلید Idempotency-Key الزامی است.'), { code: 'idempotency_key_required', status: 400 });
    const mode = String(req.body?.mode || 'OUT').toUpperCase();
    if (!['OUT', 'TRANSFER'].includes(mode)) throw Object.assign(new Error('نوع خروج یا انتقال معتبر نیست.'), { code: 'inventory_movement_mode_invalid', status: 400 });
    const kind = mode === 'TRANSFER' ? 'stock_transfer' : 'stock_issue';
    const result = recordInventoryOperationV2(getDb(), kind, { ...(req.body || {}), branchId: req.body?.branchId || req.query.branchId }, req.user.phone, key);
    await save({ requireDurable: true });
    res.status(result.idempotentReplay ? 200 : 201).json(envelope(result, req.query));
  }));
  app.post('/api/admin/v2/finance/inventory-operations/:eventId/reversal', requireCapability('finance.approve'), guard(async (req, res) => {
    const key = String(req.get('Idempotency-Key') || '').trim();
    if (!key) throw Object.assign(new Error('کلید Idempotency-Key الزامی است.'), { code: 'idempotency_key_required', status: 400 });
    const role = effectiveRole(req.user);
    if (!['owner', 'manager'].includes(role)) throw Object.assign(new Error('معکوس‌سازی عملیات انبار فقط برای مالک یا مدیر مالی مجاز است.'), { code: 'finance_approver_required', status: 403 });
    const result = reverseInventoryOperationV2(getDb(), req.params.eventId, req.body || {}, req.user.phone, key);
    await save({ requireDurable: true }); res.status(result.idempotentReplay ? 200 : 201).json(envelope(result, req.query));
  }));
  app.get('/api/admin/v2/finance/costing-inventory', requireCapability('finance.view'), guard((req, res) => res.json(envelope(costingInventory(getDb(), req.query), req.query))));
  app.get('/api/admin/v2/finance/costing-intelligence', requireCapability('finance.view'), guard((req, res) => res.json(envelope(restaurantIntelligence.deriveRestaurantIntelligence(getDb(), req.query), req.query))));
  app.get('/api/admin/v2/finance/planning/break-even/dashboard', requireCapability('finance.view'), guard((req, res) => {
    res.json(envelope(breakEvenDashboard(getDb(), req.query), req.query, { source: 'WESTO Finance V2: posted ledger or recipe-cost snapshots + non-ledger planning baseline' }));
  }));
  app.post('/api/admin/v2/finance/planning/break-even/plans', requireCapability('finance.payables.manage'), guard(async (req, res) => {
    const key = String(req.get('Idempotency-Key') || '').trim();
    if (!key) throw Object.assign(new Error('کلید Idempotency-Key الزامی است.'), { code: 'idempotency_key_required', status: 400 });
    const db = getDb(); const state = ensureFinanceV2(db); const replay = state.idempotency[key];
    if (replay) {
      const plan = state.breakEvenPlans.find((row) => row.id === replay.id);
      if (!plan) throw Object.assign(new Error('نتیجهٔ قبلی برنامهٔ سودآوری یافت نشد.'), { code: 'break_even_plan_idempotency_missing', status: 409 });
      return res.json(envelope({ plan: breakEvenPlanView(plan), idempotentReplay: true }, req.query));
    }
    const result = upsertBreakEvenPlan(db, { ...(req.body || {}), branchId: req.body?.branchId || req.query.branchId }, req.user?.phone || null);
    state.idempotency[key] = { kind: 'break_even_plan_upsert', id: result.plan.id, at: now() };
    await save({ requireDurable: true });
    res.status(result.created ? 201 : 200).json(envelope({ ...result, idempotentReplay: false }, req.query));
  }));
  app.post('/api/admin/v2/finance/planning/break-even/preview', requireCapability('finance.view'), guard((req, res) => {
    const preview = restaurantIntelligence.calculateBreakEven(req.body || {});
    res.json(envelope(preview, req.query, { source: 'WESTO Finance V2 break-even preview; not persisted' }));
  }));
  app.get('/api/admin/v2/finance/ledger-close', requireCapability('finance.reports.view'), guard((req, res) => res.json(envelope(ledgerClose(getDb(), req.query), req.query))));
  app.post('/api/admin/v2/finance/opening-balances/preview', requireCapability('finance.reports.view'), guard((req, res) => {
    const preview = openingBalancePreview(getDb(), { ...(req.body || {}), branchId: req.body?.branchId || req.query.branchId });
    res.json(envelope(preview, req.query, { source: 'WESTO Finance V2 opening balance preview; not persisted' }));
  }));
  app.post('/api/admin/v2/finance/opening-balances', requireCapability('finance.journal.create'), guard(async (req, res) => {
    const key = String(req.get('Idempotency-Key') || '').trim();
    if (!key) throw Object.assign(new Error('کلید Idempotency-Key الزامی است.'), { code: 'idempotency_key_required', status: 400 });
    const db = getDb(); const state = ensureFinanceV2(db); const replay = state.idempotency[key];
    if (replay) return res.json(envelope({ batch: state.openingBalanceBatches.find((batch) => batch.id === replay.id), idempotentReplay: true }, req.query));
    const result = requestOpeningBalance(db, { ...(req.body || {}), branchId: req.body?.branchId || req.query.branchId }, req.user.phone);
    state.idempotency[key] = { kind: 'opening_balance_request', id: result.batch.id, at: now() };
    await save({ requireDurable: true });
    res.status(201).json(envelope({ ...result, idempotentReplay: false }, req.query));
  }));
  app.post('/api/admin/v2/finance/fixed-assets', requireCapability('finance.journal.create'), guard(async (req, res) => {
    const key = String(req.get('Idempotency-Key') || '').trim();
    if (!key) throw Object.assign(new Error('کلید Idempotency-Key الزامی است.'), { code: 'idempotency_key_required', status: 400 });
    const db = getDb(); const state = ensureFinanceV2(db); const replay = state.idempotency[key];
    if (replay) return res.json(envelope({ asset: state.fixedAssets.find((asset) => asset.id === replay.id), idempotentReplay: true }, req.query));
    const result = createFixedAssetV2(db, { ...(req.body || {}), branchId: req.body?.branchId || req.query.branchId }, req.user.phone);
    state.idempotency[key] = { kind: 'fixed_asset_create', id: result.asset.id, at: now() }; await save({ requireDurable: true });
    res.status(201).json(envelope({ ...result, idempotentReplay: false }, req.query));
  }));
  app.post('/api/admin/v2/finance/depreciation-runs/preview', requireCapability('finance.reports.view'), guard((req, res) => {
    const preview = previewDepreciationV2(getDb(), { ...(req.body || {}), branchId: req.body?.branchId || req.query.branchId });
    res.json(envelope(preview, req.query, { source: 'WESTO Finance V2 depreciation preview; not persisted' }));
  }));
  app.post('/api/admin/v2/finance/depreciation-runs', requireCapability('finance.journal.create'), guard(async (req, res) => {
    const key = String(req.get('Idempotency-Key') || '').trim();
    if (!key) throw Object.assign(new Error('کلید Idempotency-Key الزامی است.'), { code: 'idempotency_key_required', status: 400 });
    const db = getDb(); const state = ensureFinanceV2(db); const replay = state.idempotency[key];
    if (replay) return res.json(envelope({ run: state.depreciationRuns.find((run) => run.id === replay.id), idempotentReplay: true }, req.query));
    const result = createDepreciationRunV2(db, { ...(req.body || {}), branchId: req.body?.branchId || req.query.branchId }, req.user.phone);
    state.idempotency[key] = { kind: 'depreciation_run_create', id: result.run.id, at: now() }; await save({ requireDurable: true });
    res.status(201).json(envelope({ ...result, idempotentReplay: false }, req.query));
  }));
  app.post('/api/admin/v2/finance/payroll-runs/preview', requireCapability('finance.reports.view'), guard((req, res) => {
    const preview = previewPayrollRunV2({ ...(req.body || {}), branchId: req.body?.branchId || req.query.branchId });
    res.json(envelope(preview, req.query, { source: 'WESTO Finance V2 payroll preview; not persisted' }));
  }));
  app.post('/api/admin/v2/finance/payroll-runs', requireCapability('finance.journal.create'), guard(async (req, res) => {
    const key = String(req.get('Idempotency-Key') || '').trim();
    if (!key) throw Object.assign(new Error('کلید Idempotency-Key الزامی است.'), { code: 'idempotency_key_required', status: 400 });
    const db = getDb(); const state = ensureFinanceV2(db); const replay = state.idempotency[key];
    if (replay) return res.json(envelope({ run: state.payrollRuns.find((run) => run.id === replay.id), idempotentReplay: true }, req.query));
    const result = createPayrollRunV2(db, { ...(req.body || {}), branchId: req.body?.branchId || req.query.branchId }, req.user.phone);
    state.idempotency[key] = { kind: 'payroll_run_create', id: result.run.id, at: now() }; await save({ requireDurable: true });
    res.status(201).json(envelope({ ...result, idempotentReplay: false }, req.query));
  }));
  app.post('/api/admin/v2/finance/payroll-runs/:id/payment-request', requireCapability('finance.payables.manage'), guard(async (req, res) => {
    const key = String(req.get('Idempotency-Key') || '').trim();
    if (!key) throw Object.assign(new Error('کلید Idempotency-Key الزامی است.'), { code: 'idempotency_key_required', status: 400 });
    const db = getDb(); const state = ensureFinanceV2(db); const replay = state.idempotency[key];
    if (replay) return res.json(envelope({ payment: state.payrollPayments.find((payment) => payment.id === replay.id), idempotentReplay: true }, req.query));
    const result = requestPayrollPaymentV2(db, req.params.id, req.body || {}, req.user.phone);
    state.idempotency[key] = { kind: 'payroll_payment_request', id: result.payment.id, at: now() }; await save({ requireDurable: true });
    res.status(201).json(envelope({ ...result, idempotentReplay: false }, req.query));
  }));
  app.post('/api/admin/v2/finance/fiscal-periods', requireCapability('finance.settings.manage'), guard(async (req, res) => {
    const key = String(req.get('Idempotency-Key') || '').trim();
    if (!key) throw Object.assign(new Error('کلید Idempotency-Key الزامی است.'), { code: 'idempotency_key_required', status: 400 });
    const db = getDb(); const state = ensureFinanceV2(db); const replay = state.idempotency[key];
    if (replay) return res.json(envelope({ period: state.fiscalPeriods.find((period) => period.id === replay.id), idempotentReplay: true }, req.query));
    // The branch guard may infer a single allowed branch into the query when
    // a scoped actor omits branchId. Carry that resolved scope into the
    // persisted period; otherwise the period would be stored as global even
    // though the request was authorized only for one branch.
    const period = createFiscalPeriod(db, {
      ...(req.body || {}),
      branchId: req.body?.branchId ?? req.query?.branchId ?? null,
    }, req.user.phone);
    state.idempotency[key] = { kind: 'fiscal_period_create', id: period.id, at: now() };
    await save({ requireDurable: true }); res.status(201).json(envelope({ period, idempotentReplay: false }, req.query));
  }));
  app.post('/api/admin/v2/finance/fiscal-periods/:id/close', requireCapability('finance.period.close'), guard(async (req, res) => {
    const key = String(req.get('Idempotency-Key') || '').trim();
    if (!key) throw Object.assign(new Error('کلید Idempotency-Key الزامی است.'), { code: 'idempotency_key_required', status: 400 });
    const preliminary = req.body?.preliminary !== false;
    const role = effectiveRole(req.user);
    if (!preliminary && !['owner', 'manager'].includes(role)) throw Object.assign(new Error('بستن نهایی فقط برای مالک یا مدیر مالی مجاز است.'), { code: 'finance_final_close_approver_required', status: 403 });
    const db = getDb(); const state = ensureFinanceV2(db); const replay = state.idempotency[key];
    if (replay) return res.json(envelope({ period: state.fiscalPeriods.find((period) => period.id === replay.id), idempotentReplay: true }, req.query));
    const result = closeFiscalPeriod(db, req.params.id, req.user.phone, {
      preliminary,
      branchId: req.body?.branchId || req.query?.branchId || null,
    });
    state.idempotency[key] = { kind: preliminary ? 'fiscal_period_preliminary_close' : 'fiscal_period_final_close', id: result.period.id, at: now() };
    await save({ requireDurable: true }); res.json(envelope({ ...result, idempotentReplay: false }, req.query));
  }));
  app.post('/api/admin/v2/finance/fiscal-periods/:id/reopen-request', requireCapability('finance.period.reopen'), guard(async (req, res) => {
    const key = String(req.get('Idempotency-Key') || '').trim();
    if (!key) throw Object.assign(new Error('کلید Idempotency-Key الزامی است.'), { code: 'idempotency_key_required', status: 400 });
    const db = getDb(); const state = ensureFinanceV2(db); const replay = state.idempotency[key];
    if (replay) return res.json(envelope({ approval: state.approvals.find((approval) => approval.id === replay.id), idempotentReplay: true }, req.query));
    const result = requestPeriodReopen(db, req.params.id, req.user.phone, req.body?.reason);
    state.idempotency[key] = { kind: 'fiscal_period_reopen_request', id: result.approval.id, at: now() };
    await save({ requireDurable: true }); res.status(result.idempotentReplay ? 200 : 201).json(envelope(result, req.query));
  }));
  app.get('/api/admin/v2/finance/events', requireCapability('finance.view'), guard((req, res) => {
    const state = ensureFinanceV2(getDb());
    let rows = state.events.filter((row) => sameBranch(row, req.query.branchId) && inRange(row, req.query.from, req.query.to));
    if (req.query.status) rows = rows.filter((row) => row.status === req.query.status);
    rows.sort((a, b) => new Date(b.occurredAt) - new Date(a.occurredAt));
    const result = page(rows, req.query); res.json(envelope(result.rows, req.query, { pagination: result }));
  }));
  app.post('/api/admin/v2/finance/events/orders/:orderId/capture', requireCapability('finance.events.manage'), guard(async (req, res) => {
    const key = String(req.get('Idempotency-Key') || '').trim();
    if (!key) throw Object.assign(new Error('کلید Idempotency-Key الزامی است.'), { code: 'idempotency_key_required', status: 400 });
    const db = getDb(); const order = list(db.orders).find((item) => String(item.id) === String(req.params.orderId));
    if (!order) throw Object.assign(new Error('سفارش یافت نشد.'), { code: 'order_not_found', status: 404 });
    const result = capturePaidOrder(db, order, { actor: req.user.phone, idempotencyKey: key });
    if (!result?.journalEntry || result.journalEntry.status !== 'posted') {
      const captureCode = result?.event?.error?.code || result?.reason || 'finance_capture_blocked';
      throw Object.assign(new Error('ثبت پرداخت انجام نشد چون سند فروش در دفتر مالی ثبت نشد.'), {
        code: captureCode,
        status: 409,
        details: result?.event?.error || null,
      });
    }
    await save({ requireDurable: true }); res.status(result.idempotentReplay ? 200 : 201).json(envelope(result, req.query));
  }));
  app.post('/api/admin/v2/finance/events/cogs/retry-ready', requireCapability('finance.events.manage'), guard(async (req, res) => {
    const key = String(req.get('Idempotency-Key') || '').trim();
    if (!key) throw Object.assign(new Error('کلید Idempotency-Key الزامی است.'), { code: 'idempotency_key_required', status: 400 });
    const body = req.body || {};
    const branchId = branchDimension(body);
    if (!branchId) throw Object.assign(new Error('شعبهٔ سفارش‌ها برای بازآزمایی بهای تمام‌شده الزامی است.'), { code: 'order_cogs_retry_branch_required', status: 400 });
    if (body.confirmed !== true) {
      throw Object.assign(new Error('پیش از بازآزمایی، ایجاد احتمالی سند بهای تمام‌شده و مصرف انبار را تأیید کنید.'), {
        code: 'order_cogs_retry_confirmation_required', status: 400,
      });
    }
    const db = getDb(); const state = ensureFinanceV2(db); const replay = state.idempotency[key];
    if (replay) {
      if (replay.kind !== 'order_cogs_retry_ready' || Number(replay.branchId) !== branchId || !replay.response) {
        throw Object.assign(new Error('این کلید تکرارنشدنی برای بازآزمایی دیگری مصرف شده است.'), { code: 'order_cogs_retry_idempotency_conflict', status: 409 });
      }
      return res.json(envelope({ ...replay.response, idempotentReplay: true }, { ...req.query, branchId }));
    }
    const result = retryReadyOrderCogs(db, body, req.user.phone);
    const response = { ...result, idempotentReplay: false };
    state.idempotency[key] = { kind: 'order_cogs_retry_ready', id: `branch:${branchId}`, branchId, response, at: now() };
    await save({ requireDurable: true });
    res.status(result.posted > 0 ? 201 : 200).json(envelope(response, { ...req.query, branchId }));
  }));
  app.post('/api/admin/v2/finance/events/:id/resolve', requireCapability('finance.events.manage'), guard(async (req, res) => {
    const key = String(req.get('Idempotency-Key') || '').trim(); if (!key) throw Object.assign(new Error('کلید Idempotency-Key الزامی است.'), { code: 'idempotency_key_required' });
    const db = getDb(); const state = ensureFinanceV2(db); const replay = state.idempotency[key];
    if (replay) return res.json(envelope({ event: state.events.find((event) => event.id === replay.id), idempotentReplay: true }, req.query));
    const result = resolveEvent(db, req.params.id, req.body || {}, req.user.phone); state.idempotency[key] = { kind: 'event_resolution', id: result.event.id, at: now() }; await save({ requireDurable: true });
    res.json(envelope(result, req.query));
  }));
  app.get('/api/admin/v2/finance/migration/archive', requireCapability('finance.view'), guard((req, res) => {
    const state = ensureFinanceV2(getDb());
    const archiveScope = archiveScopeOptions(req);
    let rows = state.legacyArchive.filter((row) => {
      if (archiveScope.branchId == null) return true;
      if (row.branchId == null) return archiveScope.includeUnscoped;
      return Number(row.branchId) === archiveScope.branchId;
    });
    if (req.query.trustStatus) rows = rows.filter((row) => row.trustStatus === req.query.trustStatus);
    if (req.query.decision) rows = rows.filter((row) => row.decision === req.query.decision);
    rows.sort((a, b) => new Date(b.archivedAt) - new Date(a.archivedAt));
    const result = page(rows, req.query);
    res.json(envelope(result.rows, req.query, { pagination: result, summary: legacyArchiveSummary(getDb(), archiveScope.branchId, archiveScope) }));
  }));
  app.post('/api/admin/v2/finance/migration/classify', requireCapability('finance.events.manage'), guard(async (req, res) => {
    const key = String(req.get('Idempotency-Key') || '').trim();
    if (!key) throw Object.assign(new Error('کلید Idempotency-Key الزامی است.'), { code: 'idempotency_key_required', status: 400 });
    const db = getDb(); const state = ensureFinanceV2(db); const replay = state.idempotency[key];
    const archiveScope = archiveScopeOptions(req);
    if (replay) return res.json(envelope({ archive: legacyArchiveSummary(db, archiveScope.branchId, archiveScope), idempotentReplay: true }, req.query));
    const result = classifyAndArchiveLegacy(db, req.user.phone, req.query.branchId);
    result.archive = legacyArchiveSummary(db, archiveScope.branchId, archiveScope);
    state.idempotency[key] = { kind: 'legacy_classification', id: 'legacy_archive', at: now() }; await save({ requireDurable: true });
    res.status(201).json(envelope({ ...result, idempotentReplay: false }, req.query));
  }));
  app.post('/api/admin/v2/finance/migration/archive/:id/decision', requireCapability('finance.events.manage'), guard(async (req, res) => {
    const key = String(req.get('Idempotency-Key') || '').trim();
    if (!key) throw Object.assign(new Error('کلید Idempotency-Key الزامی است.'), { code: 'idempotency_key_required', status: 400 });
    const db = getDb(); const state = ensureFinanceV2(db); const replay = state.idempotency[key];
    assertArchiveRouteScope(req, req.params.id);
    if (replay) return res.json(envelope({ record: state.legacyArchive.find((row) => row.id === replay.id), idempotentReplay: true }, req.query));
    const result = decideLegacyArchive(db, req.params.id, req.body || {}, req.user.phone, effectiveRole(req.user));
    state.idempotency[key] = { kind: 'legacy_archive_decision', id: result.record.id, at: now() }; await save({ requireDurable: true });
    res.json(envelope({ ...result, idempotentReplay: false }, req.query));
  }));
  app.post('/api/admin/v2/finance/migration/archive/:id/backfill-preview', requireCapability('finance.view'), guard((req, res) => {
    assertArchiveRouteScope(req, req.params.id);
    res.json(envelope(legacyOrderBackfillPreview(getDb(), req.params.id), req.query, { source: 'read-only legacy backfill preview' }));
  }));
  app.post('/api/admin/v2/finance/migration/archive/:id/backfill-request', requireCapability('finance.journal.create'), guard(async (req, res) => {
    const key = String(req.get('Idempotency-Key') || '').trim();
    if (!key) throw Object.assign(new Error('کلید Idempotency-Key الزامی است.'), { code: 'idempotency_key_required', status: 400 });
    const db = getDb(); const state = ensureFinanceV2(db); const replay = state.idempotency[key];
    assertArchiveRouteScope(req, req.params.id);
    if (replay) return res.json(envelope({ entry: state.journalEntries.find((entry) => entry.id === replay.id), idempotentReplay: true }, req.query));
    const result = requestLegacyOrderBackfill(db, req.params.id, req.user.phone);
    state.idempotency[key] = { kind: 'legacy_order_backfill_request', id: result.entry.id, at: now() }; await save({ requireDurable: true });
    res.status(result.idempotentReplay ? 200 : 201).json(envelope(result, req.query));
  }));
  app.get('/api/admin/v2/finance/journal-entries', requireCapability('finance.view'), guard((req, res) => {
    const state = ensureFinanceV2(getDb()); let rows = state.journalEntries.filter((row) => sameBranch(row, req.query.branchId) && inRange(row, req.query.from, req.query.to, 'date'));
    if (req.query.status) rows = rows.filter((row) => row.status === req.query.status);
    rows.sort((a, b) => new Date(b.date) - new Date(a.date)); const result = page(rows, req.query);
    res.json(envelope(result.rows, req.query, { pagination: result }));
  }));
  app.post('/api/admin/v2/finance/journal-entries', requireCapability('finance.journal.create'), guard(async (req, res) => {
    const key = String(req.get('Idempotency-Key') || '').trim(); if (!key) throw Object.assign(new Error('کلید Idempotency-Key الزامی است.'), { code: 'idempotency_key_required', status: 400 });
    const db = getDb(); const state = ensureFinanceV2(db); const replay = state.idempotency[key];
    if (replay) return res.json(envelope({ entry: state.journalEntries.find((entry) => entry.id === replay.id), idempotentReplay: true }, req.query));
    const entry = createDraft(db, req.body || {}, req.user.phone); state.idempotency[key] = { kind: 'journal_draft', id: entry.id, at: now() }; await save({ requireDurable: true });
    res.status(201).json(envelope({ entry, idempotentReplay: false }, req.query));
  }));
  app.post('/api/admin/v2/finance/journal-entries/:id/submit', requireCapability('finance.journal.create'), guard(async (req, res) => {
    const key = String(req.get('Idempotency-Key') || '').trim();
    if (!key) throw Object.assign(new Error('کلید Idempotency-Key الزامی است.'), { code: 'idempotency_key_required', status: 400 });
    const db = getDb(); const state = ensureFinanceV2(db); const replay = state.idempotency[key];
    if (replay) return res.json(envelope({ approval: state.approvals.find((approval) => approval.id === replay.id), idempotentReplay: true }, req.query));
    const result = submitDraft(db, req.params.id, req.user.phone); state.idempotency[key] = { kind: 'journal_submit', id: result.approval.id, at: now() };
    await save({ requireDurable: true }); res.json(envelope(result, req.query));
  }));
  app.post('/api/admin/v2/finance/journal-entries/:id/reversal', requireCapability('finance.journal.post'), guard(async (req, res) => {
    const key = String(req.get('Idempotency-Key') || '').trim();
    if (!key) throw Object.assign(new Error('کلید Idempotency-Key الزامی است.'), { code: 'idempotency_key_required', status: 400 });
    const db = getDb(); const state = ensureFinanceV2(db); const replay = state.idempotency[key];
    if (replay) return res.json(envelope({ entry: state.journalEntries.find((entry) => entry.id === replay.id), idempotentReplay: true }, req.query));
    const entry = reverseEntry(db, req.params.id, req.user.phone, req.body?.reason, req.body?.date); state.idempotency[key] = { kind: 'journal_reversal', id: entry.id, at: now() };
    await save({ requireDurable: true }); res.status(201).json(envelope({ entry, idempotentReplay: false }, req.query));
  }));
  app.get('/api/admin/v2/finance/reconciliation', requireCapability('finance.reconcile'), guard((req, res) => {
    const db = getDb();
    // Keep the unmatched-order queue on the same accounting-period scope as
    // the summary. Without from/to here, a selected period could show every
    // historical uncaptured order while its totals correctly showed only the
    // selected dates.
    const quality = dataQuality(db, req.query.branchId ? Number(req.query.branchId) : null, req.query);
    const sessions = list(db.cashSessions).filter((row) => sameBranch(row, req.query.branchId));
    res.json(envelope({ summary: reportSnapshot(db, req.query), cashSessions: sessions, settlementDuplicates: quality.settlementDuplicates, unmatchedOrders: quality.uncaptured.map((order) => ({ id: order.id, orderNo: order.orderNo, branchId: order.branchId, amountIrr: irrFromLegacyToman(order.total), createdAt: order.createdAt, paidAt: order.paidAt || null, accountingDate: orderAccountingDate(order) })) }, req.query));
  }));
  app.post('/api/admin/v2/finance/reconciliation/refunds/:id/match', requireCapability('finance.reconcile'), guard(async (req, res) => {
    const rawKey = String(req.get('Idempotency-Key') || '');
    if (!rawKey.trim()) throw Object.assign(new Error('کلید Idempotency-Key الزامی است.'), { code: 'idempotency_key_required', status: 400 });
    const key = normalizeIdempotencyKey(rawKey);
    const db = getDb(); const state = ensureFinanceV2(db); const replay = state.idempotency[key];
    if (replay) {
      if (replay.kind !== 'refund_disbursement_reconciliation') {
        throw Object.assign(new Error('این کلید برای عملیات دیگری مصرف شده است.'), { code: 'idempotency_key_payload_mismatch', status: 409 });
      }
      const reconciliation = state.reconciliationItems.find((row) => row.id === replay.id) || null;
      const refundId = reconciliation?.refundId || reconciliation?.details?.refundId;
      const refund = refundId ? state.refunds.find((row) => String(row.id) === String(refundId)) || null : null;
      const journalEntryId = refund?.journalEntryId
        || state.events.find((row) => row.source === 'order.refund' && String(row.sourceId) === String(refundId))?.journalEntryId;
      const journalEntry = journalEntryId ? state.journalEntries.find((row) => row.id === journalEntryId) || null : null;
      return res.json(envelope({ refund, reconciliation, journalEntry, idempotentReplay: true }, req.query));
    }
    const refund = state.refunds.find((row) => String(row.id) === String(req.params.id));
    if (!refund) throw Object.assign(new Error('درخواست برگشت وجه یافت نشد.'), { code: 'finance_refund_not_found', status: 404 });
    const journalEntry = postApprovedRefund(db, refund, req.user.phone, req.body?.evidenceId);
    const reconciliation = state.reconciliationItems.find((row) => row.kind === 'refund' && String(row.refundId || '') === String(refund.id)) || null;
    if (!journalEntry || !reconciliation || reconciliation.status !== 'matched') {
      throw Object.assign(new Error('برگشت وجه بدون ثبت تطبیق خروجی قطعی نشد.'), { code: 'refund_disbursement_reconciliation_incomplete', status: 409 });
    }
    state.idempotency[key] = { kind: 'refund_disbursement_reconciliation', id: reconciliation.id, at: now() };
    await save({ requireDurable: true });
    res.status(201).json(envelope({ refund, reconciliation, journalEntry, idempotentReplay: false }, req.query));
  }));
  app.post('/api/admin/v2/finance/reconciliation/settlements', requireCapability('finance.reconcile'), guard(async (req, res) => {
    const key = String(req.get('Idempotency-Key') || '').trim();
    if (!key) throw Object.assign(new Error('کلید Idempotency-Key الزامی است.'), { code: 'idempotency_key_required', status: 400 });
    const db = getDb(); const state = ensureFinanceV2(db); const replay = state.idempotency[key];
    if (replay) return res.json(envelope({ settlement: state.reconciliationItems.find((row) => row.id === replay.id), idempotentReplay: true }, req.query));
    const result = recordSettlementV2(db, { ...(req.body || {}), branchId: req.body?.branchId || req.query.branchId }, req.user.phone);
    state.idempotency[key] = { kind: 'settlement_reconciliation', id: result.settlement.id, at: now() };
    await save({ requireDurable: true }); res.status(201).json(envelope({ ...result, idempotentReplay: false }, req.query));
  }));
  app.post('/api/admin/v2/finance/reconciliation/bank-statement-lines', requireCapability('finance.reconcile'), guard(async (req, res) => {
    const key = String(req.get('Idempotency-Key') || '').trim();
    if (!key) throw Object.assign(new Error('کلید Idempotency-Key الزامی است.'), { code: 'idempotency_key_required', status: 400 });
    const db = getDb(); const state = ensureFinanceV2(db); const replay = state.idempotency[key];
    if (replay) return res.json(envelope({ statementLine: state.reconciliationItems.find((row) => row.id === replay.id), idempotentReplay: true }, req.query));
    const statementLine = recordBankStatementLine(db, { ...(req.body || {}), branchId: req.body?.branchId || req.query.branchId }, req.user.phone);
    state.idempotency[key] = { kind: 'bank_statement_line', id: statementLine.id, at: now() };
    await save({ requireDurable: true }); res.status(201).json(envelope({ statementLine, idempotentReplay: false }, req.query));
  }));
  app.post('/api/admin/v2/finance/reconciliation/bank-statement-lines/:id/match', requireCapability('finance.reconcile'), guard(async (req, res) => {
    const key = String(req.get('Idempotency-Key') || '').trim();
    if (!key) throw Object.assign(new Error('کلید Idempotency-Key الزامی است.'), { code: 'idempotency_key_required', status: 400 });
    const db = getDb(); const state = ensureFinanceV2(db); const replay = state.idempotency[key];
    if (replay) {
      const statementLine = state.reconciliationItems.find((row) => row.id === replay.id);
      const journalEntry = statementLine?.journalEntryId ? state.journalEntries.find((entry) => entry.id === statementLine.journalEntryId) || null : null;
      return res.json(envelope({ statementLine, journalEntry, idempotentReplay: true }, req.query));
    }
    const result = matchBankStatementLine(db, req.params.id, req.body || {}, req.user.phone);
    state.idempotency[key] = { kind: 'bank_statement_match', id: result.statementLine.id, at: now() };
    await save({ requireDurable: true }); res.json(envelope({ ...result, idempotentReplay: false }, req.query));
  }));
  app.get('/api/admin/v2/finance/reports', requireCapability('finance.reports.view'), guard((req, res) => {
    const db = getDb(); const reports = financialReports(db, req.query); const type = req.query.type || 'all';
    const reportByType = {
      general_ledger: reports.generalLedger, trial_balance: reports.trialBalance,
      profit_and_loss: reports.profitAndLoss, balance_sheet: reports.balanceSheet, cash_flow: reports.cashFlow,
    };
    if (type !== 'all' && !reportByType[type]) throw Object.assign(new Error('نوع گزارش مالی معتبر نیست.'), { code: 'finance_report_type_invalid', status: 400 });
    res.json(envelope({
      type, report: type === 'all' ? reports : reportByType[type] || null,
      sufficientHistory: reports.generalLedger.status === 'available',
      taxpayerIntegration: { status: 'not_connected', exportReady: false },
    }, req.query));
  }));
  app.get('/api/admin/v2/finance/approvals', requireCapability('finance.view'), guard((req, res) => {
    const state = ensureFinanceV2(getDb());
    const branchId = req.query.branchId ? Number(req.query.branchId) : null;
    let rows = state.approvals.filter((row) => approvalMatchesBranch(state, row, branchId));
    if (req.query.status) rows = rows.filter((row) => row.status === req.query.status);
    rows.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)); const result = page(rows, req.query); res.json(envelope(result.rows, req.query, { pagination: result }));
  }));
  app.post('/api/admin/v2/finance/approvals/:id/decision', requireCapability('finance.approve'), guard(async (req, res) => {
    const key = String(req.get('Idempotency-Key') || '').trim();
    if (!key) throw Object.assign(new Error('کلید Idempotency-Key الزامی است.'), { code: 'idempotency_key_required', status: 400 });
    const role = effectiveRole(req.user); if (!['owner', 'manager'].includes(role)) throw Object.assign(new Error('تأیید فقط برای مالک یا مدیر مالی مجاز است.'), { code: 'finance_approver_required', status: 403 });
    const db = getDb(); const state = ensureFinanceV2(db); const replay = state.idempotency[key];
    if (replay) return res.json(envelope({ approval: state.approvals.find((approval) => approval.id === replay.id), idempotentReplay: true }, req.query));
    const result = decideApproval(db, req.params.id, String(req.body?.decision || ''), req.user.phone, req.body?.comment, {
      storageStatus: getStorageStatus(),
      branchId: req.query?.branchId ?? req.body?.branchId ?? null,
    });
    state.idempotency[key] = { kind: 'approval_decision', id: result.approval.id, at: now() }; await save({ requireDurable: true }); res.json(envelope({ ...result, idempotentReplay: false }, req.query));
  }));
  app.get('/api/admin/v2/finance/search', requireCapability('finance.view'), guard((req, res) => {
    const db = getDb(); const state = ensureFinanceV2(db); const term = String(req.query.q || '').trim().toLowerCase();
    const branchId = req.query.branchId ? Number(req.query.branchId) : null;
    if (term.length < 2) return res.json(envelope([], req.query));
    const matches = [];
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 25));
    // Search results deep-link into the sales/finance workspace, whose
    // canonical collection is paid orders only. Do not route open, partial,
    // cancelled or otherwise unpaid operational orders to a misleading
    // accounting detail page.
    const searchableOrders = list(db.orders)
      .filter((row) => sameBranch(row, branchId) && paid(row) && orderInAccountingRange(row, req.query.from, req.query.to))
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    searchableOrders.forEach((row, index) => {
      if (`${row.id} ${row.orderNo || ''} ${row.total || ''}`.toLowerCase().includes(term)) {
        matches.push({
          kind: 'order', id: row.id, branchId: row.branchId, label: row.orderNo || `سفارش ${row.id}`,
          amountIrr: irrFromLegacyToman(row.total), targetPage: Math.floor(index / pageSize) + 1,
        });
      }
    });
    state.journalEntries
      .filter((row) => sameBranch(row, branchId) && inRange(row, req.query.from, req.query.to, 'date'))
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .forEach((row, index) => {
        if (`${row.id} ${row.number} ${row.description} ${row.debitIrr}`.toLowerCase().includes(term)) {
          matches.push({
            kind: 'journal_entry', id: row.id, branchId: row.branchId, label: row.number,
            amountIrr: row.debitIrr, targetPage: Math.floor(index / pageSize) + 1,
          });
        }
      });
    list(db.accounting?.vendors).filter((row) => branchId == null || sameBranch(row, branchId)).forEach((row) => { if (`${row.id} ${row.name || ''} ${row.nameFa || ''} ${row.balance || ''}`.toLowerCase().includes(term)) matches.push({ kind: 'vendor', id: row.id, branchId: row.branchId ?? null, label: row.nameFa || row.name, amountIrr: irrFromLegacyToman(row.balance) }); });
    res.json(envelope(matches.slice(0, 50), req.query));
  }));
}

module.exports = {
  registerFinanceV2Routes,
  ensureFinanceV2,
  captureOrderPaymentReceipt,
  capturePaidOrder,
  captureOrderCogs,
  retryReadyOrderCogs,
  captureOnlinePaidOrder,
  createPurchaseOrderV2,
  submitPurchaseOrderV2,
  receiveGoodsV2,
  createVendorInvoiceV2,
  requestVendorInvoiceMatchReview,
  requestSupplierPaymentV2,
  createCostCommitment,
  deactivateCostCommitment,
  createCostAccrual,
  requestCostAccrualPayment,
  createFixedAssetV2,
  previewDepreciationV2,
  createDepreciationRunV2,
  previewPayrollRunV2,
  createPayrollRunV2,
  requestPayrollPaymentV2,
  requestOrderRefund,
  postApprovedRefund,
  recordSettlementV2,
  openingBalanceAccounts,
  openingBalancePreview,
  requestOpeningBalance,
  branchRolloutStatus,
  requestBranchCutover,
  recordBankStatementLine,
  matchBankStatementLine,
  captureCashMovement,
  captureCashClose,
  recordInventoryOperationV2,
  reverseInventoryOperationV2,
  reverseOrderCogsAndInventory,
  resolveEvent,
  classifyAndArchiveLegacy,
  legacyMigrationReadiness,
  decideLegacyArchive,
  legacyArchiveSummary,
  legacyOrderBackfillPreview,
  requestLegacyOrderBackfill,
  recordEvent,
  recordWalletTopup,
  captureWalletTopup,
  captureWalletAdjustment,
  createDraft,
  submitDraft,
  decideApproval,
  reverseEntry,
  createFiscalPeriod,
  closeFiscalPeriod,
  requestPeriodReopen,
  validateOpenPeriod,
  workbench,
  dailyOperations,
  dataQuality,
  reportSnapshot,
  shadowRunReadiness,
  salesCashBank,
  financeOrderChain,
  purchasesPayables,
  inventoryItemsView,
  createInventoryItemV2,
  updateInventoryItemV2,
  operatingExpensesView,
  createOperatingExpenseV2,
  menuItemUsesInventoryV2,
  menuItemAvailability,
  buildOrderInventoryReservationSnapshot,
  costingInventory,
  kitchenInventory,
  requestRecipeVersion,
  actualBreakEvenFromLedger,
  plannedBreakEvenFromCommitments,
  upsertBreakEvenPlan,
  breakEvenDashboard,
  ledgerClose,
  financialReports,
  salesLines,
  envelope,
  contractDocument: financeContracts.contractDocument,
  eventSourceContract: financeContracts.eventSourceContract,
  __test: {
    irrFromLegacyToman, normalizeTenderRows, assertBalanced, periodForDate, postEventJournal,
    suggestedBreakEvenPlan, chooseContributionSource, recordWalletTopup, captureWalletTopup,
    captureWalletAdjustment, materializeOrderPayments, refundRequestFingerprint,
    paymentReceiptEvidence, paymentReceiptDebitLines,
  },
};
