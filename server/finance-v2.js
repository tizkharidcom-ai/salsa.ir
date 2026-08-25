'use strict';

const crypto = require('crypto');
const restaurantIntelligence = require('./finance/restaurant-intelligence');
const orderCosting = require('./finance/order-costing');
const inventoryOperations = require('./finance/inventory-operations');
const legacyClassifier = require('./finance/legacy-classifier');

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
  gift_card: '2400',
});
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
const RESTAURANT_COST_BEHAVIOR = Object.freeze({
  5100: { behavior: 'variable', label: 'مواد اولیه و بهای فروش' },
  5200: { behavior: 'variable', label: 'مواد اولیه نوشیدنی و قهوه' },
  5300: { behavior: 'variable', label: 'ظروف و ملزومات بیرون‌بر' },
  5400: { behavior: 'variable', label: 'ضایعات آشپزخانه' },
  5500: { behavior: 'variable', label: 'کسری و مازاد صندوق' },
  5110: { behavior: 'variable', label: 'ضایعات مواد اولیه' },
  5120: { behavior: 'variable', label: 'کسری شمارش موجودی' },
  5130: { behavior: 'variable', label: 'افت تولید بچ' },
  6100: { behavior: 'fixed', label: 'حقوق و دستمزد' },
  6110: { behavior: 'fixed', label: 'حقوق آشپزخانه و بار' },
  6120: { behavior: 'fixed', label: 'حقوق سالن و صندوق' },
  6130: { behavior: 'fixed', label: 'اضافه‌کاری، پاداش و عیدی' },
  6140: { behavior: 'fixed', label: 'بیمه سهم کارفرما' },
  6200: { behavior: 'fixed', label: 'اجاره' },
  6300: { behavior: 'fixed', label: 'آب، برق، گاز و اینترنت' },
  6400: { behavior: 'fixed', label: 'تبلیغات و بازاریابی' },
  6500: { behavior: 'fixed', label: 'تعمیرات و نگهداری' },
  6600: { behavior: 'variable', label: 'نظافت و بهداشت' },
  6700: { behavior: 'fixed', label: 'ملزومات اداری' },
  6800: { behavior: 'fixed', label: 'بیمه کسب‌وکار' },
  6900: { behavior: 'fixed', label: 'مجوز و عوارض' },
  6950: { behavior: 'variable', label: 'کارمزد بانکی و کارتخوان' },
  6970: { behavior: 'variable', label: 'کمیسیون پلتفرم فروش' },
  6980: { behavior: 'fixed', label: 'استهلاک' },
});

function list(value) { return Array.isArray(value) ? value : []; }
function int(value) { return Number.isFinite(Number(value)) ? Math.round(Number(value)) : 0; }
function safeIrr(value, code = 'amount_irr_invalid') {
  const amount = Number(value);
  if (!Number.isSafeInteger(amount) || amount < 0) throw Object.assign(new Error('مبلغ ریالی باید عدد صحیح نامنفی و در محدودهٔ امن باشد.'), { code });
  return amount;
}
function irrFromLegacyToman(value) { return int(value) * 10; }
function now() { return new Date().toISOString(); }
function id() { return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${crypto.randomBytes(12).toString('hex')}`; }
function paid(order) { return order?.paymentStatus === 'paid' || PAID_STATUSES.has(String(order?.status || '')); }
function sameBranch(row, branchId) { return !branchId || Number(row?.branchId) === Number(branchId); }
function inRange(row, from, to, field = 'occurredAt') {
  const value = new Date(row?.[field] || row?.date || row?.createdAt || 0).getTime();
  if (!Number.isFinite(value)) return false;
  if (from && value < new Date(from).getTime()) return false;
  if (to && value > new Date(to).getTime()) return false;
  return true;
}

function ensureFinanceV2(db) {
  if (!db.financeV2 || typeof db.financeV2 !== 'object') {
    db.financeV2 = {
      schemaVersion: 2,
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
      legacyArchive: [],
      idempotency: {},
    };
  }
  const state = db.financeV2;
  state.schemaVersion = 2;
  state.mode = state.mode || 'shadow';
  state.cutover = state.cutover || { status: 'shadow' };
  state.rollout = { captureEnabled: true, enabledBranchIds: [], cutoverBranchIds: [], ...(state.rollout || {}) };
  state.settings = { canonicalCurrency: 'IRR', displayCurrency: 'TOMAN', legacyAmountUnit: 'TOMAN', requireOpenPeriod: true, ...(state.settings || {}) };
  for (const key of ['events', 'payments', 'refunds', 'journalEntries', 'approvals', 'fiscalPeriods', 'reconciliationItems', 'orderItemCostSnapshots', 'inventoryMovements', 'inventoryMovementValuations', 'productionBatches', 'purchaseOrders', 'goodsReceipts', 'vendorInvoices', 'threeWayMatches', 'supplierPayments', 'costCommitments', 'costAccruals', 'costPayments', 'fixedAssets', 'depreciationRuns', 'payrollRuns', 'payrollPayments', 'openingBalanceBatches', 'legacyArchive']) {
    if (!Array.isArray(state[key])) state[key] = [];
  }
  if (!state.idempotency || typeof state.idempotency !== 'object') state.idempotency = {};
  return state;
}

function periodForDate(db, date) {
  const at = new Date(date);
  if (!Number.isFinite(at.getTime())) return null;
  const v2Periods = ensureFinanceV2(db).fiscalPeriods;
  const periods = v2Periods.length ? v2Periods : list(db.accounting?.fiscalPeriods);
  return periods.find((period) => {
    const start = new Date(period.startDate);
    const end = new Date(period.endDate);
    return Number.isFinite(start.getTime()) && Number.isFinite(end.getTime()) && start <= at && end >= at;
  }) || null;
}

function createFiscalPeriod(db, input, actor) {
  const state = ensureFinanceV2(db);
  const startDate = String(input.startDate || '').slice(0, 10);
  const endDate = String(input.endDate || '').slice(0, 10);
  const start = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start > end) throw Object.assign(new Error('محدودهٔ دوره معتبر نیست.'), { code: 'fiscal_period_range_invalid' });
  const overlapping = state.fiscalPeriods.find((period) => new Date(period.startDate) <= end && new Date(period.endDate) >= start);
  if (overlapping) throw Object.assign(new Error(`دوره با «${overlapping.name}» هم‌پوشانی دارد.`), { code: 'fiscal_period_overlap', status: 409 });
  const sorted = state.fiscalPeriods.slice().sort((a, b) => new Date(a.startDate) - new Date(b.startDate));
  const previous = sorted.filter((period) => new Date(period.endDate) < start).at(-1);
  const next = sorted.find((period) => new Date(period.startDate) > end);
  const dayMs = 86400000;
  if (previous && Math.round((start - new Date(previous.endDate)) / dayMs) !== 1) throw Object.assign(new Error('بین دورهٔ قبلی و دورهٔ جدید فاصله وجود دارد.'), { code: 'fiscal_period_gap', status: 409 });
  if (next && Math.round((new Date(next.startDate) - end) / dayMs) !== 1) throw Object.assign(new Error('بین دورهٔ جدید و دورهٔ بعدی فاصله وجود دارد.'), { code: 'fiscal_period_gap', status: 409 });
  const period = { id: id(), name: String(input.name || '').trim().slice(0, 120) || `${startDate} تا ${endDate}`, startDate, endDate, status: 'open', createdBy: actor, createdAt: now(), closedBy: null, closedAt: null, reopenedBy: null, reopenedAt: null };
  state.fiscalPeriods.push(period);
  return period;
}

function closeFiscalPeriod(db, periodId, actor, { preliminary = true } = {}) {
  const state = ensureFinanceV2(db);
  const period = state.fiscalPeriods.find((item) => String(item.id) === String(periodId));
  if (!period) throw Object.assign(new Error('دورهٔ مالی یافت نشد.'), { code: 'fiscal_period_not_found', status: 404 });
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
  const existing = state.approvals.find((item) => item.entityType === 'fiscal_period' && String(item.entityId) === String(period.id) && item.operation === 'reopen_fiscal_period' && item.status === 'pending');
  if (existing) return { approval: existing, idempotentReplay: true };
  const approval = {
    id: id(), operation: 'reopen_fiscal_period', entityType: 'fiscal_period', entityId: period.id,
    amountIrr: null, status: 'pending', createdBy: actor, createdAt: now(), decidedBy: null, decidedAt: null,
    history: [{ action: 'submitted', by: actor, at: now(), comment: String(reason || '').trim().slice(0, 300) || null }],
  };
  state.approvals.push(approval);
  return { approval, idempotentReplay: false };
}

function validateOpenPeriod(db, date) {
  const period = periodForDate(db, date);
  if (!period) return { ok: false, code: 'fiscal_period_missing', message: 'برای تاریخ رویداد، دورهٔ مالی تعریف نشده است.' };
  if (!['open', 'reopened'].includes(period.status)) {
    return { ok: false, code: 'fiscal_period_closed', message: `دورهٔ «${period.name || period.id}» باز نیست.`, period };
  }
  return { ok: true, period };
}

function normalizeTenderRows(order) {
  const payments = list(order?.partialPayments)
    .filter((payment) => int(payment.amount) > 0)
    .map((payment) => ({
      tender: String(payment.tender || '').trim(),
      amountIrr: irrFromLegacyToman(payment.amount),
      paymentId: payment.id == null ? null : String(payment.id),
      occurredAt: payment.at || order.paidAt || order.createdAt,
      provider: payment.provider || null,
      providerReference: payment.reference || payment.providerReference || null,
    }));
  if (payments.length) return payments;
  const tender = String(order?.paymentTender || order?.paymentMethod || '').trim();
  if (!TENDER_ACCOUNTS[tender] || tender === 'cashier') return [];
  return [{ tender, amountIrr: irrFromLegacyToman(order.total), paymentId: null, occurredAt: order.paidAt || order.createdAt, provider: null, providerReference: null }];
}

function materializeOrderPayments(db, order, tenderRows) {
  const state = ensureFinanceV2(db);
  const branchId = Number(order.branchId) || null;
  return list(tenderRows).map((row, index) => {
    const sourceKey = row.paymentId || `tender-${index + 1}`;
    const idempotencyKey = `order:${order.id}:payment:${sourceKey}`;
    let payment = state.payments.find((item) => item.idempotencyKey === idempotencyKey);
    if (!payment) {
      payment = {
        id: id(), orderId: order.id, branchId, tender: row.tender, amountIrr: safeIrr(row.amountIrr),
        status: 'succeeded', provider: row.provider || null, providerReference: row.providerReference || null,
        idempotencyKey, paidAt: row.occurredAt || order.paidAt || order.createdAt,
        refundedIrr: 0, payload: { operationalPaymentId: row.paymentId, orderNo: order.orderNo || null }, createdAt: now(),
      };
      state.payments.push(payment);
    }
    if (['card', 'manual_card', 'card_on_file', 'online', 'gateway'].includes(payment.tender)
      && !state.reconciliationItems.some((item) => item.kind === 'payment' && item.paymentId === payment.id)) {
      state.reconciliationItems.push({
        id: id(), kind: 'payment', branchId, orderId: order.id, paymentId: payment.id, cashSessionId: null,
        bankReference: payment.providerReference || null, settlementReference: null, psp: payment.provider || null,
        terminalId: null, batchNo: null, journalEntryId: null, amountIrr: payment.amountIrr,
        status: 'unmatched', matchedAt: null, matchedBy: null,
        details: { tender: payment.tender, orderNo: order.orderNo || null }, createdAt: now(),
      });
    }
    return payment;
  });
}

function salesLines(order) {
  const totalIrr = irrFromLegacyToman(order.total);
  const tenders = normalizeTenderRows(order);
  if (!tenders.length) return { ok: false, code: 'payment_tender_missing', message: 'روش پرداخت قابل اتکا ثبت نشده است.' };
  const receivedIrr = tenders.reduce((sum, row) => sum + row.amountIrr, 0);
  if (receivedIrr !== totalIrr) {
    return { ok: false, code: 'payment_total_mismatch', message: 'جمع پرداخت‌ها با مبلغ قطعی سفارش برابر نیست.', details: { totalIrr, receivedIrr } };
  }
  const branchId = Number(order.branchId) || null;
  if (!branchId) return { ok: false, code: 'branch_missing', message: 'شعبهٔ سفارش مشخص نیست.' };
  const costCenter = `branch:${branchId}`;
  const debitLines = tenders.map((row) => ({
    accountCode: TENDER_ACCOUNTS[row.tender],
    debitIrr: row.amountIrr,
    creditIrr: 0,
    branchId,
    costCenter,
    paymentMethod: row.tender,
    counterpartyId: null,
    itemId: null,
    recipeVersionId: null,
    memo: `دریافت سفارش ${order.orderNo || order.id}`,
  }));
  const storedTaxToman = order.taxAmount ?? order.tax ?? order.vatAmount;
  const taxIrr = storedTaxToman == null ? 0 : Math.max(0, irrFromLegacyToman(storedTaxToman));
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

function assertBalanced(lines) {
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
  const sourceVersion = Math.max(1, int(input.sourceVersion) || 1);
  const idempotencyKey = String(input.idempotencyKey || `${source}:${sourceId}:v${sourceVersion}`).trim();
  if (!source || !sourceId) throw Object.assign(new Error('منبع و شناسهٔ رویداد الزامی است.'), { code: 'finance_event_source_missing' });
  const existing = state.events.find((event) => event.idempotencyKey === idempotencyKey || (event.source === source && event.sourceId === sourceId && event.sourceVersion === sourceVersion));
  if (existing) return { event: existing, idempotentReplay: true };
  const event = {
    id: id('fev'), source, sourceId, sourceVersion, idempotencyKey,
    branchId: Number(input.branchId) || null,
    occurredAt: input.occurredAt || now(),
    amountIrr: int(input.amountIrr),
    payload: input.payload && typeof input.payload === 'object' ? input.payload : {},
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
  if (event.journalEntryId) return state.journalEntries.find((entry) => entry.id === event.journalEntryId) || null;
  const periodCheck = validateOpenPeriod(db, event.occurredAt);
  if (!periodCheck.ok) {
    event.status = 'blocked';
    event.error = { code: periodCheck.code, message: periodCheck.message };
    return null;
  }
  const totals = assertBalanced(lines);
  const duplicate = state.journalEntries.find((entry) => entry.sourceEventId === event.id || (entry.source === event.source && entry.sourceId === event.sourceId && FINAL_ENTRY_STATUSES.has(entry.status)));
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

function capturePaidOrder(db, order, { actor = 'system', idempotencyKey } = {}) {
  if (!paid(order)) return { skipped: true, reason: 'order_not_paid' };
  const rollout = ensureFinanceV2(db).rollout;
  if (rollout.captureEnabled === false || (rollout.enabledBranchIds.length && !rollout.enabledBranchIds.map(Number).includes(Number(order.branchId)))) {
    return { skipped: true, reason: 'finance_v2_feature_flag_disabled' };
  }
  const built = salesLines(order);
  const payments = built.ok ? materializeOrderPayments(db, order, built.tenders) : [];
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
  const costing = journalEntry ? captureOrderCogs(db, order, { actor }) : { skipped: true, reason: 'sales_journal_not_posted' };
  return { ...recorded, journalEntry, costing, payments };
}

function captureOrderCogs(db, order, { actor = 'system' } = {}) {
  const state = ensureFinanceV2(db);
  const sourceId = String(order.id);
  const existing = state.events.find((event) => event.source === 'order.cogs' && String(event.sourceId) === sourceId);
  if (existing?.journalEntryId) {
    return {
      event: existing,
      journalEntry: state.journalEntries.find((entry) => entry.id === existing.journalEntryId) || null,
      snapshots: state.orderItemCostSnapshots.filter((row) => String(row.orderId) === sourceId),
      movements: state.inventoryMovements.filter((row) => row.source === 'order.cogs' && String(row.sourceId) === sourceId),
      idempotentReplay: true,
    };
  }

  const built = orderCosting.buildOrderCosting(db, order);
  const recorded = existing
    ? { event: existing, idempotentReplay: true }
    : recordEvent(db, {
      source: 'order.cogs', sourceId, sourceVersion: 1,
      idempotencyKey: `order:${sourceId}:cogs:v1`, branchId: order.branchId,
      occurredAt: order.paidAt || order.createdAt, amountIrr: built.totalCogsIrr || 0,
      payload: { orderNo: order.orderNo || null, coverage: { coveredLines: built.snapshots.length, totalLines: list(order.items).length }, issues: built.issues },
      status: built.ok ? 'pending' : 'blocked',
      error: built.ok ? null : { code: built.code, message: built.message, details: { issues: built.issues } },
    });

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
  };
  const branchId = Number(order.branchId);
  const costCenter = `branch:${branchId}`;
  const lines = [{
    accountCode: '5100', accountType: 'cogs', debitIrr: built.totalCogsIrr, creditIrr: 0,
    branchId, costCenter, itemId: null, recipeVersionId: null,
    memo: `بهای تمام‌شده سفارش ${order.orderNo || order.id}`,
  }, ...built.movements.map((movement) => ({
    accountCode: '1610', debitIrr: 0, creditIrr: movement.totalCostIrr,
    branchId, costCenter, itemId: movement.itemId, recipeVersionId: movement.recipeVersionIds.length === 1 ? movement.recipeVersionIds[0] : null,
    memo: `مصرف رسپی سفارش ${order.orderNo || order.id}`,
  }))];
  const entry = postEventJournal(db, recorded.event, lines, `بهای تمام‌شده و مصرف رسپی سفارش ${order.orderNo || order.id}`, actor);
  if (!entry) return { ...recorded, journalEntry: null, snapshots: [], movements: [], costing: built };

  const existingSnapshots = state.orderItemCostSnapshots.filter((row) => String(row.orderId) === sourceId);
  if (!existingSnapshots.length) {
    for (const snapshot of built.snapshots) state.orderItemCostSnapshots.push({ ...snapshot, journalEntryId: entry.id });
    for (const movement of built.movements) state.inventoryMovements.push({ ...movement, journalEntryId: entry.id });
  }
  const snapshots = state.orderItemCostSnapshots.filter((row) => String(row.orderId) === sourceId);
  const movements = state.inventoryMovements.filter((row) => row.source === 'order.cogs' && String(row.sourceId) === sourceId);
  recorded.event.payload.snapshotIds = snapshots.map((row) => row.id);
  recorded.event.payload.inventoryMovementIds = movements.map((row) => row.id);
  return { ...recorded, journalEntry: entry, snapshots, movements, costing: built };
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
      memo: `مصرف بچ تولید ${movement.itemName}`,
    }));
    const debit = produced
      ? { accountCode: '1610', debitIrr: consumedTotal, creditIrr: 0, branchId, costCenter, itemId: produced.itemId, recipeVersionId: produced.recipeId || null, memo: `محصول بچ ${produced.itemName}` }
      : { accountCode: '5130', accountType: 'cogs', debitIrr: consumedTotal, creditIrr: 0, branchId, costCenter, memo: 'افت کامل بچ تولید' };
    return [debit, ...credits];
  }
  throw Object.assign(new Error('قاعدهٔ مالی عملیات انبار تعریف نشده است.'), { code: 'inventory_operation_rule_missing' });
}

function recordInventoryOperationV2(db, kind, input, actor, idempotencyKey) {
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
      : kind === 'production_batch' ? inventoryOperations.buildProductionBatch : null;
  if (!builder) throw Object.assign(new Error('نوع عملیات انبار معتبر نیست.'), { code: 'inventory_operation_kind_invalid' });
  const result = builder(db, state, input, actor);
  if (!result.ok) throw Object.assign(new Error(result.message || 'عملیات انبار معتبر نیست.'), { code: result.code, status: 409, details: { issues: result.issues || [] } });
  for (const movement of result.movements) state.inventoryMovements.push(movement);
  if (kind === 'production_batch') state.productionBatches.push({
    id: result.operationId, branchId: result.branchId, recipeVersionId: String(result.recipe.id),
    outputItemId: String(result.outputItem.id), plannedYield: result.plannedYield, actualYield: result.actualYield,
    status: 'completed', producedAt: result.occurredAt, createdBy: actor, idempotencyKey, createdAt: now(),
  });
  const source = ({ waste: 'inventory.waste', stock_count: 'inventory.stock_count', production_batch: 'inventory.production_batch' })[kind];
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
  if (!order || !payment || String(payment.orderId) !== String(order.id)) {
    throw Object.assign(new Error('پرداخت آنلاین به سفارش معتبر متصل نیست.'), { code: 'online_payment_order_mismatch' });
  }
  if (payment.status !== 'paid') return { skipped: true, reason: 'online_payment_not_paid' };
  const paidAt = occurredAt || payment.updatedAt || payment.createdAt || now();
  order.partialPayments = list(order.partialPayments);
  const paymentId = String(payment.id);
  let tenderRow = order.partialPayments.find((row) => String(row.paymentAttemptId ?? row.id) === paymentId);
  if (!tenderRow) {
    tenderRow = {
      id: payment.id, paymentAttemptId: payment.id, tender: 'online', amount: int(payment.amount),
      reference: payment.reference || null, provider: payment.provider || null, at: paidAt, by: 'payment_gateway',
    };
    order.partialPayments.push(tenderRow);
    order.paymentRevision = Math.max(1, int(order.paymentRevision) + 1);
  }
  order.paymentMethod = 'online';
  order.paymentTender = 'online';
  order.paymentTenders = [...new Set(order.partialPayments.map((row) => row.tender).filter(Boolean))];
  order.amountPaid = order.partialPayments.reduce((sum, row) => sum + int(row.amount), 0);
  order.paymentStatus = order.amountPaid >= int(order.total) ? 'paid' : 'partial';
  if (order.paymentStatus === 'paid' && !order.paidAt) order.paidAt = paidAt;
  return capturePaidOrder(db, order, { actor, idempotencyKey: `order:${order.id}:online-payment:${payment.id}` });
}

function positiveQuantity(value, code = 'quantity_invalid') {
  const quantity = Number(value);
  if (!Number.isFinite(quantity) || quantity <= 0) throw Object.assign(new Error('مقدار باید عددی بزرگ‌تر از صفر باشد.'), { code });
  return quantity;
}

function createPurchaseOrderV2(db, input, actor) {
  const state = ensureFinanceV2(db);
  const branchId = Number(input.branchId) || null;
  const vendorId = String(input.vendorId || '').trim();
  if (!branchId) throw Object.assign(new Error('شعبهٔ سفارش خرید الزامی است.'), { code: 'branch_missing' });
  if (!vendorId) throw Object.assign(new Error('تأمین‌کننده الزامی است.'), { code: 'vendor_missing' });
  const rawLines = list(input.lines);
  if (!rawLines.length) throw Object.assign(new Error('حداقل یک ردیف خرید الزامی است.'), { code: 'purchase_order_lines_missing' });
  let subtotalIrr = 0;
  const lines = rawLines.map((line, index) => {
    const itemId = String(line.itemId || '').trim();
    if (!itemId) throw Object.assign(new Error(`کالای ردیف ${index + 1} مشخص نیست.`), { code: 'purchase_item_missing' });
    const quantity = positiveQuantity(line.quantity ?? line.qty);
    const unitPriceIrr = safeIrr(line.unitPriceIrr, 'unit_price_irr_invalid');
    const taxIrr = safeIrr(line.taxIrr ?? 0, 'tax_irr_invalid');
    const discountIrr = safeIrr(line.discountIrr ?? 0, 'discount_irr_invalid');
    const grossIrr = Math.round(quantity * unitPriceIrr);
    const lineTotalIrr = grossIrr + taxIrr - discountIrr;
    if (!Number.isSafeInteger(lineTotalIrr) || lineTotalIrr < 0) throw Object.assign(new Error(`جمع ریالی ردیف ${index + 1} معتبر نیست.`), { code: 'purchase_line_total_invalid' });
    subtotalIrr += lineTotalIrr;
    return {
      id: id(), lineNo: index + 1, itemId, description: String(line.description || '').trim().slice(0, 180) || itemId,
      quantity, receivedQuantity: 0, unit: String(line.unit || '').trim(), unitPriceIrr, taxIrr, discountIrr, lineTotalIrr,
    };
  });
  if (!Number.isSafeInteger(subtotalIrr)) throw Object.assign(new Error('جمع سفارش خرید از محدودهٔ امن ریال خارج است.'), { code: 'purchase_total_unsafe' });
  const po = {
    id: id(), number: `F2-PO-${String(state.purchaseOrders.length + 1).padStart(6, '0')}`,
    branchId, vendorId, status: 'draft', issueDate: input.issueDate || now(), expectedDate: input.expectedDate || null,
    subtotalIrr, totalIrr: subtotalIrr, notes: String(input.notes || '').trim().slice(0, 300), lines,
    createdBy: actor, createdAt: now(), approvedBy: null, approvedAt: null,
  };
  state.purchaseOrders.push(po);
  return po;
}

function submitPurchaseOrderV2(db, poId, actor) {
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
  const state = ensureFinanceV2(db);
  const po = state.purchaseOrders.find((row) => row.id === String(input.purchaseOrderId || input.poId || ''));
  if (!po) throw Object.assign(new Error('سفارش خرید V2 یافت نشد.'), { code: 'purchase_order_not_found', status: 404 });
  if (!['approved', 'partially_received'].includes(po.status)) throw Object.assign(new Error('سفارش خرید هنوز برای دریافت کالا تأیید نشده است.'), { code: 'purchase_order_not_approved', status: 409 });
  const deliveryNoteNumber = String(input.deliveryNoteNumber || '').trim().slice(0, 120);
  if (deliveryNoteNumber && state.goodsReceipts.some((row) => row.vendorId === po.vendorId && row.deliveryNoteNumber === deliveryNoteNumber)) {
    throw Object.assign(new Error('شماره حوالهٔ تأمین‌کننده قبلاً ثبت شده است.'), { code: 'goods_receipt_duplicate', status: 409 });
  }
  const rawLines = list(input.lines);
  if (!rawLines.length) throw Object.assign(new Error('حداقل یک ردیف دریافت الزامی است.'), { code: 'goods_receipt_lines_missing' });
  let totalValueIrr = 0;
  const lines = rawLines.map((line, index) => {
    const poLine = po.lines.find((row) => row.id === String(line.purchaseOrderLineId || line.poLineId || ''));
    if (!poLine) throw Object.assign(new Error(`ردیف ${index + 1} به سفارش خرید متصل نیست.`), { code: 'purchase_order_line_not_found' });
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
  const receivedAt = input.receivedAt || input.receivedDate || now();
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

function createVendorInvoiceV2(db, input, actor) {
  const state = ensureFinanceV2(db);
  const grn = state.goodsReceipts.find((row) => row.id === String(input.goodsReceiptId || input.grnId || ''));
  if (!grn) throw Object.assign(new Error('رسید کالای V2 یافت نشد.'), { code: 'goods_receipt_not_found', status: 404 });
  const po = state.purchaseOrders.find((row) => row.id === grn.purchaseOrderId);
  if (!po) throw Object.assign(new Error('سفارش خرید متصل یافت نشد.'), { code: 'purchase_order_not_found', status: 404 });
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
  const lines = rawLines.map((line, index) => {
    const receiptLine = grn.lines.find((row) => row.id === String(line.goodsReceiptLineId || line.receiptLineId || ''));
    if (!receiptLine) throw Object.assign(new Error(`ردیف ${index + 1} به رسید کالا متصل نیست.`), { code: 'goods_receipt_line_not_found' });
    const invoicedQuantity = positiveQuantity(line.invoicedQuantity ?? line.quantity ?? line.qty);
    const previouslyInvoiced = state.vendorInvoices.flatMap((row) => row.lines || []).filter((row) => row.goodsReceiptLineId === receiptLine.id).reduce((sum, row) => sum + Number(row.invoicedQuantity || 0), 0);
    const remainingReceived = receiptLine.acceptedQuantity - previouslyInvoiced;
    if (invoicedQuantity > remainingReceived + 1e-9) throw Object.assign(new Error(`مقدار فاکتور ردیف ${index + 1} از دریافت فاکتورنشده بیشتر است.`), { code: 'vendor_invoice_over_received_quantity' });
    const unitPriceIrr = safeIrr(line.unitPriceIrr, 'unit_price_irr_invalid');
    const lineTotalIrr = Math.round(invoicedQuantity * unitPriceIrr);
    if (!Number.isSafeInteger(lineTotalIrr)) throw Object.assign(new Error('جمع ردیف فاکتور از محدودهٔ امن خارج است.'), { code: 'vendor_invoice_line_total_unsafe' });
    const receiptLineValueIrr = Math.round(invoicedQuantity * receiptLine.unitCostIrr);
    const lineQuantityVariance = 0;
    netAmountIrr += lineTotalIrr;
    receiptValueIrr += receiptLineValueIrr;
    quantityVariance += lineQuantityVariance;
    return {
      id: id(), lineNo: index + 1, goodsReceiptLineId: receiptLine.id, purchaseOrderLineId: receiptLine.purchaseOrderLineId,
      itemId: receiptLine.itemId, invoicedQuantity, unit: receiptLine.unit, unitPriceIrr, lineTotalIrr,
      receivedQuantity: receiptLine.acceptedQuantity, previouslyInvoicedQuantity: previouslyInvoiced, receiptUnitCostIrr: receiptLine.unitCostIrr,
      quantityVariance: lineQuantityVariance, priceVarianceIrr: lineTotalIrr - receiptLineValueIrr,
    };
  });
  const vatIrr = safeIrr(input.vatIrr ?? 0, 'vat_irr_invalid');
  const totalIrr = netAmountIrr + vatIrr;
  const suppliedTotal = input.totalIrr == null ? totalIrr : safeIrr(input.totalIrr, 'invoice_total_irr_invalid');
  if (suppliedTotal !== totalIrr) throw Object.assign(new Error('جمع فاکتور با ردیف‌ها و مالیات برابر نیست.'), { code: 'vendor_invoice_total_mismatch' });
  const priceVarianceIrr = netAmountIrr - receiptValueIrr;
  const matched = Math.abs(quantityVariance) <= 1e-9 && priceVarianceIrr === 0;
  const invoice = {
    id: id(), number: `F2-INV-${String(state.vendorInvoices.length + 1).padStart(6, '0')}`,
    invoiceNumber, vendorId: grn.vendorId, branchId: grn.branchId, purchaseOrderId: po.id, goodsReceiptId: grn.id,
    invoiceDate: input.invoiceDate || input.date || now(), dueDate: input.dueDate || null,
    netAmountIrr, vatIrr, totalIrr, paidAmountIrr: 0, status: matched ? 'open' : 'match_exception',
    matchStatus: matched ? 'matched' : 'exception', quantityVariance, priceVarianceIrr, lines,
    createdBy: actor, createdAt: now(),
  };
  state.vendorInvoices.push(invoice);
  const match = {
    id: id(), purchaseOrderId: po.id, goodsReceiptId: grn.id, vendorInvoiceId: invoice.id,
    status: invoice.matchStatus, quantityVariance, priceVarianceIrr, receiptValueIrr, invoiceNetIrr: netAmountIrr,
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
    const costCenter = `branch:${invoice.branchId}`;
    entry = postEventJournal(db, recorded.event, [
      { accountCode: '2120', debitIrr: receiptValueIrr, creditIrr: 0, branchId: invoice.branchId, costCenter, counterpartyId: invoice.vendorId, memo: `تسویه کالای فاکتورنشده ${grn.number}` },
      ...(priceVarianceIrr > 0 ? [{ accountCode: '5150', accountType: 'cogs', debitIrr: priceVarianceIrr, creditIrr: 0, branchId: invoice.branchId, costCenter, memo: 'اختلاف قیمت خرید' }] : []),
      ...(priceVarianceIrr < 0 ? [{ accountCode: '5150', accountType: 'cogs', debitIrr: 0, creditIrr: Math.abs(priceVarianceIrr), branchId: invoice.branchId, costCenter, memo: 'اختلاف قیمت خرید' }] : []),
      ...(vatIrr ? [{ accountCode: '1450', debitIrr: vatIrr, creditIrr: 0, branchId: invoice.branchId, costCenter, memo: `اعتبار مالیاتی فاکتور ${invoiceNumber}` }] : []),
      { accountCode: '2110', debitIrr: 0, creditIrr: totalIrr, branchId: invoice.branchId, costCenter, counterpartyId: invoice.vendorId, memo: `پرداختنی فاکتور ${invoiceNumber}` },
    ], `ثبت فاکتور تأمین‌کننده ${invoiceNumber}`, actor);
  }
  return { vendorInvoice: invoice, threeWayMatch: match, event: recorded.event, journalEntry: entry };
}

function requestSupplierPaymentV2(db, invoiceId, input, actor) {
  const state = ensureFinanceV2(db);
  const invoice = state.vendorInvoices.find((row) => row.id === invoiceId);
  if (!invoice) throw Object.assign(new Error('فاکتور تأمین‌کننده یافت نشد.'), { code: 'vendor_invoice_not_found', status: 404 });
  if (invoice.status === 'match_exception') throw Object.assign(new Error('تا رفع اختلاف تطبیق سه‌سویه، پرداخت مجاز نیست.'), { code: 'three_way_match_required', status: 409 });
  const remainingIrr = invoice.totalIrr - invoice.paidAmountIrr - state.supplierPayments.filter((row) => row.vendorInvoiceId === invoice.id && row.status === 'pending_approval').reduce((sum, row) => sum + row.amountIrr, 0);
  const amountIrr = safeIrr(input.amountIrr, 'payment_amount_irr_invalid');
  if (amountIrr <= 0 || amountIrr > remainingIrr) throw Object.assign(new Error('مبلغ پرداخت از ماندهٔ قابل پرداخت بیشتر است یا معتبر نیست.'), { code: 'supplier_payment_amount_invalid' });
  const method = String(input.paymentMethod || 'bank').toLowerCase();
  if (!['bank', 'cash', 'petty_cash'].includes(method)) throw Object.assign(new Error('روش پرداخت معتبر نیست.'), { code: 'supplier_payment_method_invalid' });
  const payment = {
    id: id(), vendorInvoiceId: invoice.id, vendorId: invoice.vendorId, branchId: invoice.branchId,
    amountIrr, paymentMethod: method, paymentDate: input.paymentDate || input.date || now(), reference: String(input.reference || '').trim().slice(0, 160) || null,
    status: 'pending_approval', createdBy: actor, createdAt: now(), approvedBy: null, approvedAt: null, journalEntryId: null, approvalId: null,
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
  const state = ensureFinanceV2(db);
  const branchId = Number(input.branchId) || null;
  if (!branchId) throw Object.assign(new Error('شعبهٔ تعهد هزینه الزامی است.'), { code: 'cost_commitment_branch_required' });
  const name = String(input.name || '').trim().slice(0, 160);
  if (name.length < 2) throw Object.assign(new Error('عنوان تعهد هزینه الزامی است.'), { code: 'cost_commitment_name_required' });
  const type = String(input.type || '');
  const policy = COST_COMMITMENT_TYPES[type];
  if (!policy) throw Object.assign(new Error('نوع هزینهٔ دوره‌ای معتبر نیست.'), { code: 'cost_commitment_type_invalid' });
  const monthlyAmountIrr = safeIrr(input.monthlyAmountIrr, 'cost_commitment_amount_invalid');
  if (!monthlyAmountIrr) throw Object.assign(new Error('مبلغ ماهانه باید بزرگ‌تر از صفر باشد.'), { code: 'cost_commitment_amount_invalid' });
  const startDate = String(input.startDate || '').slice(0, 10);
  const endDate = input.endDate ? String(input.endDate).slice(0, 10) : null;
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
  const commitment = ensureFinanceV2(db).costCommitments.find((row) => row.id === commitmentId);
  if (!commitment) throw Object.assign(new Error('تعهد هزینه یافت نشد.'), { code: 'cost_commitment_not_found', status: 404 });
  if (commitment.status === 'inactive') return { commitment, idempotentReplay: true };
  commitment.status = 'inactive'; commitment.deactivatedBy = actor; commitment.deactivatedAt = now();
  return { commitment, idempotentReplay: false };
}

function createCostAccrual(db, commitmentId, input, actor) {
  const state = ensureFinanceV2(db);
  const commitment = state.costCommitments.find((row) => row.id === commitmentId);
  if (!commitment) throw Object.assign(new Error('تعهد هزینه یافت نشد.'), { code: 'cost_commitment_not_found', status: 404 });
  if (commitment.status !== 'active') throw Object.assign(new Error('تعهد هزینه غیرفعال است.'), { code: 'cost_commitment_inactive', status: 409 });
  const postingDate = String(input.postingDate || '').slice(0, 10);
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
  const periodCheck = validateOpenPeriod(db, postingAt.toISOString());
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
  const paymentDate = input.paymentDate || now();
  if (!Number.isFinite(new Date(paymentDate).getTime())) throw Object.assign(new Error('تاریخ پرداخت معتبر نیست.'), { code: 'cost_payment_date_invalid' });
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
  const state = ensureFinanceV2(db);
  const branchId = Number(input.branchId) || null;
  if (!branchId) throw Object.assign(new Error('شعبهٔ دارایی الزامی است.'), { code: 'fixed_asset_branch_required' });
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
  const periodCheck = validateOpenPeriod(db, purchasedAt.toISOString());
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
  const state = ensureFinanceV2(db);
  if (!Number(input.branchId)) throw Object.assign(new Error('شعبهٔ ثبت استهلاک الزامی است.'), { code: 'depreciation_branch_required' });
  if (!state.fiscalPeriods.length) throw Object.assign(new Error('برای ثبت استهلاک باید دورهٔ مالی V2 تعریف شده باشد.'), { code: 'depreciation_v2_period_required', status: 409 });
  const preview = previewDepreciationV2(db, input);
  if (preview.status !== 'available' || !preview.lines.length) throw Object.assign(new Error(preview.message), { code: 'depreciation_no_eligible_assets', status: 409 });
  const periodCheck = validateOpenPeriod(db, `${preview.postingDate}T12:00:00.000Z`);
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
  const state = ensureFinanceV2(db);
  if (!state.fiscalPeriods.length) throw Object.assign(new Error('برای ثبت لیست حقوق باید دورهٔ مالی V2 تعریف شده باشد.'), { code: 'payroll_v2_period_required', status: 409 });
  const sourceReference = String(input.sourceReference || '').trim().slice(0, 160);
  if (sourceReference.length < 3) throw Object.assign(new Error('مرجع لیست حقوق تأییدشده الزامی است.'), { code: 'payroll_source_reference_required' });
  const preview = previewPayrollRunV2({ ...input, sourceReference });
  if (state.payrollRuns.some((run) => run.branchId === preview.branchId && run.serviceMonth === preview.serviceMonth && !['rejected', 'reversed'].includes(run.status))) {
    throw Object.assign(new Error('برای این شعبه و ماه، لیست حقوق فعال قبلاً ثبت یا ارسال شده است.'), { code: 'payroll_branch_period_duplicate', status: 409 });
  }
  const periodCheck = validateOpenPeriod(db, `${preview.postingDate}T12:00:00.000Z`);
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
  const paymentDate = input.paymentDate || now();
  if (!Number.isFinite(new Date(paymentDate).getTime())) throw Object.assign(new Error('تاریخ پرداخت حقوق معتبر نیست.'), { code: 'payroll_payment_date_invalid' });
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
  const amountIrr = Math.abs(irrFromLegacyToman(movement?.amount));
  const recorded = recordEvent(db, {
    source: 'cash.movement', sourceId: `${session.id}:${movement.id}`, sourceVersion: 1,
    branchId: session.branchId, occurredAt: movement.at, amountIrr,
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
  const varianceToman = int(session.variance);
  const recorded = recordEvent(db, {
    source: 'cash_session.closed', sourceId: session.id, sourceVersion: 1,
    branchId: session.branchId, occurredAt: session.closedAt || now(), amountIrr: Math.abs(irrFromLegacyToman(varianceToman)),
    payload: { sessionId: session.id, countedAmountIrr: irrFromLegacyToman(session.countedAmount), varianceIrr: irrFromLegacyToman(varianceToman) },
    status: varianceToman === 0 ? 'posted' : 'pending',
  });
  if (!recorded.idempotentReplay && varianceToman !== 0) {
    const branchId = Number(session.branchId);
    const costCenter = `branch:${branchId}`;
    const varianceIrr = Math.abs(irrFromLegacyToman(varianceToman));
    const lines = varianceToman > 0
      ? [
        { accountCode: '1110', debitIrr: varianceIrr, creditIrr: 0, branchId, costCenter, memo: `مازاد صندوق نشست ${session.id}` },
        { accountCode: '4500', debitIrr: 0, creditIrr: varianceIrr, branchId, costCenter, accountType: 'revenue', memo: `مازاد صندوق نشست ${session.id}` },
      ]
      : [
        { accountCode: '5500', debitIrr: varianceIrr, creditIrr: 0, branchId, costCenter, accountType: 'cogs', memo: `کسری صندوق نشست ${session.id}` },
        { accountCode: '1110', debitIrr: 0, creditIrr: varianceIrr, branchId, costCenter, memo: `کسری صندوق نشست ${session.id}` },
      ];
    postEventJournal(db, recorded.event, lines, `کسری/مازاد بستن صندوق نشست ${session.id}`, actor);
  }
  return recorded;
}

function resolveEvent(db, eventId, input, actor) {
  const state = ensureFinanceV2(db);
  const event = state.events.find((item) => item.id === eventId);
  if (!event) throw Object.assign(new Error('رویداد مالی یافت نشد.'), { code: 'finance_event_not_found', status: 404 });
  if (event.status === 'posted') return { event, entry: event.journalEntryId ? state.journalEntries.find((entry) => entry.id === event.journalEntryId) || null : null, idempotentReplay: true };
  if (['inventory.waste', 'inventory.stock_count', 'inventory.production_batch'].includes(event.source)) {
    return { ...valueAndResolveInventoryEvent(db, event, actor), idempotentReplay: false };
  }
  const branchId = Number(event.branchId);
  const costCenter = `branch:${branchId}`;
  let lines;
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
    const order = list(db.orders).find((item) => String(item.id) === String(event.sourceId));
    if (!order) throw Object.assign(new Error('سفارش منبع یافت نشد.'), { code: 'order_not_found', status: 404 });
    const sourceTenders = list(event.payload?.tenderSnapshot).map((row) => ({ tender: String(row.tender || ''), amountIrr: int(row.amountIrr) }));
    const sourceTenderIsReliable = sourceTenders.length > 0
      && sourceTenders.every((row) => TENDER_ACCOUNTS[row.tender] && row.amountIrr > 0)
      && sourceTenders.reduce((sum, row) => sum + row.amountIrr, 0) === event.amountIrr;
    const reviewedTenders = list(input.tenders).map((row) => ({ tender: String(row.tender || ''), amountIrr: int(row.amountIrr) }));
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
    lines = tenders.map((row) => ({ accountCode: TENDER_ACCOUNTS[row.tender], debitIrr: row.amountIrr, creditIrr: 0, branchId, costCenter, paymentMethod: row.tender, memo: `دریافت سفارش ${order.orderNo || order.id}` }));
    const salesAccount = order.fulfillment === 'pickup' ? '4120' : order.fulfillment === 'delivery' ? '4130' : '4110';
    lines.push({ accountCode: salesAccount, debitIrr: 0, creditIrr: event.amountIrr, branchId, costCenter, accountType: 'revenue', memo: `فروش سفارش ${order.orderNo || order.id}` });
  } else {
    throw Object.assign(new Error('برای این نوع رویداد قاعدهٔ رفع مغایرت تعریف نشده است.'), { code: 'finance_event_rule_missing' });
  }
  event.status = 'pending'; event.error = null; event.payload.resolvedBy = actor; event.payload.resolvedAt = now();
  const entry = postEventJournal(db, event, lines, `رفع مغایرت رویداد ${event.source} / ${event.sourceId}`, actor);
  return { event, entry, idempotentReplay: false };
}

function legacyArchiveSummary(db, branchId = null) {
  const rows = ensureFinanceV2(db).legacyArchive.filter((row) => !branchId || row.branchId == null || Number(row.branchId) === Number(branchId));
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

function classifyAndArchiveLegacy(db, actor = 'system') {
  const state = ensureFinanceV2(db);
  const classification = legacyClassifier.classifyLegacyFinance(db, { analyzeSale: salesLines });
  const existingBySource = new Map(state.legacyArchive.map((row) => [`${row.sourceTable}:${row.sourceId}`, row]));
  const archivedAt = now();
  let created = 0;
  for (const candidate of classification.rows) {
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
  return {
    created,
    unchanged: classification.rows.length - created,
    classification: classification.summary,
    archive: legacyArchiveSummary(db),
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
  const duplicateEvent = state.events.find((event) => event.source === 'order.paid' && String(event.sourceId) === String(record.sourceId));
  const duplicateEntry = state.journalEntries.find((entry) => entry.source === 'order.paid' && String(entry.sourceId) === String(record.sourceId) && FINAL_ENTRY_STATUSES.has(entry.status));
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
      built = salesLines(reviewedOrder);
      if (!built.ok) blockers.push({ code: built.code, message: built.message });
    } catch (error) {
      blockers.push({ code: error.code || 'legacy_backfill_tender_invalid', message: error.message });
    }
  }
  const periodCheck = validateOpenPeriod(db, record.occurredAt || order?.paidAt || order?.createdAt);
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

function dataQuality(db, branchId) {
  const state = ensureFinanceV2(db);
  const orders = list(db.orders).filter((order) => paid(order) && sameBranch(order, branchId));
  const capturedIds = new Set(state.events.filter((event) => event.source === 'order.paid').map((event) => String(event.sourceId)));
  const postedSaleIds = new Set(state.events.filter((event) => event.source === 'order.paid' && event.status === 'posted').map((event) => String(event.sourceId)));
  const cogsEventIds = new Set(state.events.filter((event) => event.source === 'order.cogs').map((event) => String(event.sourceId)));
  const legacyPostedIds = new Set(list(db.accounting?.journalEntries).filter((entry) => entry.source === 'sale').map((entry) => String(entry.sourceId)));
  const uncaptured = orders.filter((order) => !capturedIds.has(String(order.id)) && !legacyPostedIds.has(String(order.id)));
  const uncapturedCogs = orders.filter((order) => postedSaleIds.has(String(order.id)) && !cogsEventIds.has(String(order.id)));
  const ambiguousTender = orders.filter((order) => !salesLines(order).ok);
  const settlementDuplicates = duplicateGroups(list(db.accounting?.settlements), (row) => {
    const provider = row.provider || row.psp || row.gateway;
    const batch = row.batchNo || row.batchNumber || row.reference;
    return provider && batch ? `${provider}:${batch}` : '';
  });
  const depreciationDuplicates = duplicateGroups(list(db.accounting?.journalEntries).filter((entry) => entry.source === 'depreciation'), (entry) => {
    const asset = entry.sourceId || String(entry.description || '').match(/AST-\d+|fa-\d+/i)?.[0] || 'batch';
    const period = String(entry.date || '').slice(0, 7);
    return asset && period ? `${asset}:${period}` : '';
  });
  const currentDate = now();
  const currentDay = currentDate.slice(0, 10);
  const currentServiceMonth = currentDay.slice(0, 7);
  const currentPeriod = periodForDate(db, currentDate);
  const unmatchedV2Payments = state.reconciliationItems.filter((item) => item.kind === 'payment' && item.status === 'unmatched' && sameBranch(item, branchId));
  const unmatchedBankStatementLines = state.reconciliationItems.filter((item) => item.kind === 'bank_statement_line' && item.status === 'unmatched' && sameBranch(item, branchId));
  const dueCostCommitments = state.costCommitments.filter((item) => item.status === 'active' && sameBranch(item, branchId)
    && item.startDate <= currentDay && (!item.endDate || item.endDate >= currentDay)
    && !state.costAccruals.some((accrual) => accrual.costCommitmentId === item.id && accrual.serviceMonth === currentServiceMonth && !['rejected', 'reversed'].includes(accrual.status)));
  const dueDepreciationAssets = previewDepreciationV2(db, { branchId, postingDate: currentDay }).lines;
  const issues = [];
  if (uncaptured.length) issues.push({ code: 'paid_orders_without_finance_event', severity: 'critical', count: uncaptured.length, amountIrr: uncaptured.reduce((sum, order) => sum + irrFromLegacyToman(order.total), 0), title: 'سفارش پرداخت‌شده بدون رویداد مالی' });
  if (uncapturedCogs.length) issues.push({ code: 'posted_sales_without_cogs_event', severity: 'critical', count: uncapturedCogs.length, amountIrr: null, title: 'فروش ثبت‌شده بدون رویداد بهای تمام‌شده' });
  if (ambiguousTender.length) issues.push({ code: 'payment_tender_missing', severity: 'critical', count: ambiguousTender.length, amountIrr: ambiguousTender.reduce((sum, order) => sum + irrFromLegacyToman(order.total), 0), title: 'روش پرداخت نامطمئن یا جمع پرداخت ناسازگار' });
  if (!currentPeriod || !['open', 'reopened'].includes(currentPeriod.status)) issues.push({ code: 'current_fiscal_period_not_open', severity: 'critical', count: 1, amountIrr: null, title: 'دورهٔ مالی جاری باز و معتبر نیست' });
  if (settlementDuplicates.length) issues.push({ code: 'duplicate_settlement_batch', severity: 'critical', count: settlementDuplicates.length, amountIrr: null, title: 'بچ تسویهٔ تکراری' });
  if (depreciationDuplicates.length) issues.push({ code: 'duplicate_depreciation_period', severity: 'critical', count: depreciationDuplicates.length, amountIrr: null, title: 'استهلاک تکراری دارایی/دوره' });
  if (list(db.cashSessions).length && !list(db.accounting?.cashDrawers).length) issues.push({ code: 'parallel_cash_models', severity: 'warning', count: list(db.cashSessions).length, amountIrr: null, title: 'مدل موازی صندوق شناسایی شد؛ cashSessions مرجع عملیاتی است' });
  if (state.events.some((event) => event.status === 'blocked')) issues.push({ code: 'blocked_finance_events', severity: 'critical', count: state.events.filter((event) => event.status === 'blocked').length, amountIrr: null, title: 'رویداد مالی مسدودشده' });
  if (unmatchedV2Payments.length) issues.push({ code: 'unmatched_card_gateway_payments', severity: 'warning', count: unmatchedV2Payments.length, amountIrr: unmatchedV2Payments.reduce((sum, item) => sum + int(item.amountIrr), 0), title: 'پرداخت کارت/درگاه منتظر تطبیق تسویه' });
  if (unmatchedBankStatementLines.length) issues.push({ code: 'unmatched_bank_statement_lines', severity: 'warning', count: unmatchedBankStatementLines.length, amountIrr: unmatchedBankStatementLines.reduce((sum, item) => sum + int(item.amountIrr), 0), title: 'گردش صورت‌حساب بانک منتظر تطبیق دفتر' });
  if (dueCostCommitments.length) issues.push({ code: 'periodic_cost_accrual_due', severity: 'warning', count: dueCostCommitments.length, amountIrr: dueCostCommitments.reduce((sum, item) => sum + int(item.monthlyAmountIrr), 0), title: 'تعهد هزینهٔ ماه جاری هنوز ثبت دوره‌ای ندارد' });
  if (dueDepreciationAssets.length) issues.push({ code: 'asset_depreciation_due', severity: 'warning', count: dueDepreciationAssets.length, amountIrr: dueDepreciationAssets.reduce((sum, item) => sum + int(item.amountIrr), 0), title: 'استهلاک ماه جاری دارایی‌های V2 هنوز ثبت نشده است' });
  return { issues, uncaptured, uncapturedCogs, ambiguousTender, settlementDuplicates, depreciationDuplicates, unmatchedV2Payments, unmatchedBankStatementLines, dueCostCommitments, dueDepreciationAssets, currentPeriod };
}

function reportSnapshot(db, { branchId, from, to } = {}) {
  const state = ensureFinanceV2(db);
  const orders = list(db.orders).filter((order) => paid(order) && sameBranch(order, branchId) && inRange(order, from, to, 'createdAt'));
  const refunds = state.refunds.filter((refund) => refund.status === 'succeeded' && sameBranch(refund, branchId) && inRange(refund, from, to, 'refundDate'));
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
  const snapshot = reportSnapshot(db, { branchId });
  const saleEvents = state.events.filter((event) => event.source === 'order.paid' && event.status === 'posted' && event.journalEntryId && sameBranch(event, branchId));
  const postedCogsIds = new Set(state.events.filter((event) => event.source === 'order.cogs' && event.status === 'posted' && event.journalEntryId && sameBranch(event, branchId)).map((event) => String(event.sourceId)));
  const completeOrders = saleEvents.filter((event) => {
    if (!postedCogsIds.has(String(event.sourceId))) return false;
    const succeededPayments = state.payments.filter((payment) => payment.status === 'succeeded' && String(payment.orderId) === String(event.sourceId));
    return succeededPayments.length > 0 && succeededPayments.reduce((sum, payment) => sum + int(payment.amountIrr), 0) === int(event.amountIrr);
  });
  const completeDayKeys = [...new Set(completeOrders.map((event) => tehranDay(event.occurredAt)).filter(Boolean))].sort();
  const unresolvedMigration = state.legacyArchive.filter((record) => record.decision === 'pending'
    || (record.decision === 'approved_for_backfill' && !['posted', 'reversed'].includes(record.backfillStatus)));
  const currentPeriod = dataQuality(db, branchId).currentPeriod;
  const gates = [
    { id: 'postgres_required', label: 'PostgreSQL مرجع اجباری و schema نرمال فعال', passed: storage?.available === true && storage?.required === true, value: storage?.available ? (storage.required ? 'required' : 'optional') : (storage?.reason || 'inactive') },
    { id: 'complete_orders', label: 'حداقل ۱۰۰ سفارش کامل فروش/پرداخت/COGS', passed: completeOrders.length >= 100, value: completeOrders.length, target: 100 },
    { id: 'operating_days', label: 'حداقل ۷ روز عملیاتی دارای سفارش کامل', passed: completeDayKeys.length >= 7, value: completeDayKeys.length, target: 7 },
    { id: 'sales_reconciliation', label: 'اختلاف فروش عملیاتی و دفتر صفر و دفتر متوازن', passed: snapshot.reconciliation.salesDifferenceIrr === 0 && snapshot.reconciliation.balanced, value: snapshot.reconciliation.salesDifferenceIrr },
    { id: 'open_period', label: 'دوره مالی جاری باز', passed: Boolean(currentPeriod && ['open', 'reopened'].includes(currentPeriod.status)), value: currentPeriod?.status || 'missing' },
    { id: 'blocked_events', label: 'رویداد مالی مسدود باقی نمانده', passed: !state.events.some((event) => event.status === 'blocked' && sameBranch(event, branchId)), value: state.events.filter((event) => event.status === 'blocked' && sameBranch(event, branchId)).length },
    { id: 'pending_approvals', label: 'تأیید معطل باقی نمانده', passed: !state.approvals.some((approval) => approval.status === 'pending'), value: state.approvals.filter((approval) => approval.status === 'pending').length },
    { id: 'migration_decisions', label: 'پرونده مهاجرت تصمیم‌نشده یا backfill نیمه‌کاره ندارد', passed: unresolvedMigration.length === 0, value: unresolvedMigration.length },
  ];
  return {
    status: gates.every((gate) => gate.passed) ? 'READY_FOR_CUTOVER_REVIEW' : 'NO_GO',
    generatedAt: now(), branchId: branchId ? Number(branchId) : null,
    completeOrders: completeOrders.length, operatingDays: completeDayKeys.length,
    firstCompleteDay: completeDayKeys[0] || null, lastCompleteDay: completeDayKeys.at(-1) || null,
    gates,
    policy: { minimumCompleteOrders: 100, minimumOperatingDays: 7, bothThresholdsRequired: true, automaticCutover: false },
  };
}

function workbench(db, query = {}, runtime = {}) {
  const state = ensureFinanceV2(db);
  const branchId = query.branchId ? Number(query.branchId) : null;
  const quality = dataQuality(db, branchId);
  const storage = runtime.storageStatus || null;
  if (storage && !storage.available) quality.issues.push({ code: 'normalized_postgres_not_active', severity: 'critical', count: 1, amountIrr: null, title: 'مرجع نرمال PostgreSQL هنوز فعال نیست' });
  const snapshot = reportSnapshot(db, { branchId, from: query.from, to: query.to });
  const actions = [];
  if (quality.uncaptured.length) actions.push({ id: 'review-orders', label: 'ثبت مالی سفارش‌های جاافتاده', operation: 'events' });
  if (quality.uncapturedCogs.length || state.events.some((event) => event.source === 'order.cogs' && event.status === 'blocked')) actions.push({ id: 'review-cogs', label: 'رفع نقص رسپی و بهای تمام‌شده', operation: 'events' });
  if (!quality.currentPeriod || !['open', 'reopened'].includes(quality.currentPeriod.status)) actions.push({ id: 'open-period', label: 'رفع مانع دورهٔ مالی', operation: 'periods' });
  if (quality.settlementDuplicates.length) actions.push({ id: 'review-settlements', label: 'بررسی تسویهٔ تکراری', operation: 'events' });
  if (quality.unmatchedV2Payments.length) actions.push({ id: 'reconcile-payments', label: 'تطبیق پرداخت‌های کارت و درگاه', workspace: 'sales_bank' });
  if (quality.unmatchedBankStatementLines.length) actions.push({ id: 'reconcile-bank', label: 'تطبیق صورت‌حساب بانک با دفتر', workspace: 'sales_bank' });
  if (quality.dueCostCommitments.length) actions.push({ id: 'accrue-costs', label: 'ثبت اجاره، حقوق و هزینه‌های ماه', workspace: 'purchases' });
  if (quality.dueDepreciationAssets.length) actions.push({ id: 'depreciate-assets', label: 'پیش‌نمایش و ثبت استهلاک ماه', workspace: 'ledger_close' });
  if (state.approvals.some((item) => item.status === 'pending')) actions.push({ id: 'pending-approvals', label: 'رسیدگی به تأییدهای منتظر', operation: 'approvals' });
  const shadowReadiness = shadowRunReadiness(db, branchId, runtime);
  return {
    status: quality.issues.some((issue) => issue.severity === 'critical') ? 'NO_GO' : 'READY_FOR_SHADOW',
    mode: state.cutover?.status || state.mode,
    metrics: {
      operationalSalesIrr: snapshot.operational.salesIrr,
      ledgerSalesIrr: snapshot.ledger.salesIrr,
      unexplainedDifferenceIrr: snapshot.reconciliation.salesDifferenceIrr,
      paidOrders: snapshot.operational.paidOrders,
      blockedEvents: state.events.filter((event) => event.status === 'blocked').length,
      blockedCogsEvents: state.events.filter((event) => event.source === 'order.cogs' && event.status === 'blocked').length,
      pendingApprovals: state.approvals.filter((item) => item.status === 'pending').length,
    },
    actions: actions.slice(0, 3),
    issues: quality.issues,
    sources: {
      operationalSales: 'orders', cash: 'cashSessions', ledger: 'financeV2.journalEntries', legacyLedger: 'accounting.journalEntries (read-only during shadow)',
      persistence: storage?.available ? 'PostgreSQL normalized transaction mirror + durable snapshot' : `snapshot only (${storage?.reason || 'runtime status unavailable'})`,
    },
    storage,
    shadowReadiness,
    currentPeriod: quality.currentPeriod,
    operations: dailyOperations(db, query),
  };
}

function dailyOperations(db, query = {}) {
  const state = ensureFinanceV2(db);
  const branchId = query.branchId ? Number(query.branchId) : null;
  const quality = dataQuality(db, branchId);
  const branchEvents = state.events
    .filter((row) => sameBranch(row, branchId) && inRange(row, query.from, query.to))
    .sort((a, b) => new Date(b.occurredAt) - new Date(a.occurredAt));
  const journalRows = state.journalEntries
    .filter((row) => sameBranch(row, branchId) && inRange(row, query.from, query.to, 'date'))
    .sort((a, b) => new Date(b.date) - new Date(a.date));
  const entityBranch = (approval) => {
    if (approval.entityType === 'journal_entry') return state.journalEntries.find((row) => row.id === approval.entityId)?.branchId;
    if (approval.entityType === 'finance_event') return state.events.find((row) => row.id === approval.entityId)?.branchId;
    if (approval.entityType === 'finance_refund') return state.refunds.find((row) => row.id === approval.entityId)?.branchId;
    if (approval.entityType === 'purchase_order') return state.purchaseOrders.find((row) => row.id === approval.entityId)?.branchId;
    if (approval.entityType === 'supplier_payment') return state.supplierPayments.find((row) => row.id === approval.entityId)?.branchId;
    if (approval.entityType === 'cost_payment') return state.costPayments.find((row) => row.id === approval.entityId)?.branchId;
    return null;
  };
  const approvals = state.approvals
    .filter((row) => !branchId || !entityBranch(row) || Number(entityBranch(row)) === branchId)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const periods = state.fiscalPeriods.length ? state.fiscalPeriods : list(db.accounting?.fiscalPeriods);
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
    events: branchEvents.filter((row) => ['blocked', 'pending'].includes(row.status)).slice(0, 25).map((row) => ({
      id: row.id, source: row.source, sourceId: row.sourceId, occurredAt: row.occurredAt, amountIrr: row.amountIrr,
      status: row.status, error: row.error ? { code: row.error.code, message: row.error.message } : null,
      payload: row.source === 'order.paid' ? { tenderSnapshot: list(row.payload?.tenderSnapshot) } : undefined,
    })),
    uncapturedOrders: quality.uncaptured.slice(0, 25).map((order) => ({
      id: order.id, orderNo: order.orderNo || null, createdAt: order.createdAt, branchId: order.branchId,
      amountIrr: irrFromLegacyToman(order.total), tenderKnown: normalizeTenderRows(order).length > 0,
    })),
    journalDrafts: journalRows.filter((row) => ['draft', 'pending_approval'].includes(row.status)).slice(0, 25),
    approvals: approvals.filter((row) => row.status === 'pending').slice(0, 25),
    legacyArchive: state.legacyArchive
      .filter((row) => !branchId || row.branchId == null || Number(row.branchId) === branchId)
      .slice().sort((a, b) => new Date(b.archivedAt) - new Date(a.archivedAt)).slice(0, 50),
    legacyArchiveSummary: legacyArchiveSummary(db, branchId),
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

function recordBankStatementLine(db, input, actor) {
  const state = ensureFinanceV2(db);
  const branchId = Number(input.branchId) || null;
  if (!branchId) throw Object.assign(new Error('شعبهٔ گردش بانک الزامی است.'), { code: 'bank_statement_branch_required' });
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
  const occurredAt = String(input.occurredAt || '');
  if (!Number.isFinite(new Date(occurredAt).getTime())) throw Object.assign(new Error('تاریخ گردش بانک معتبر نیست.'), { code: 'bank_statement_date_invalid' });
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
  const quality = dataQuality(db, branchId);
  const orders = list(db.orders).filter((order) => paid(order) && sameBranch(order, branchId) && inRange(order, query.from, query.to, 'createdAt'));
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
  const sessions = list(db.cashSessions).filter((row) => sameBranch(row, branchId) && inRange(row, query.from, query.to, 'openedAt'));
  const mappedOrders = orders.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).map((order) => ({
    id: order.id, orderNo: order.orderNo || null, branchId: order.branchId, createdAt: order.createdAt,
    paymentStatus: order.paymentStatus, fulfillment: order.fulfillment, amountIrr: irrFromLegacyToman(order.total),
    tenders: normalizeTenderRows(order).map((row) => row.tender),
    financeStatus: state.events.find((event) => event.source === 'order.paid' && String(event.sourceId) === String(order.id))?.status || 'unregistered',
  }));
  const orderPage = page(mappedOrders, query);
  const reconciliationPayments = state.reconciliationItems
    .filter((row) => row.kind === 'payment' && sameBranch(row, branchId) && row.status === 'unmatched')
    .map((row) => ({ ...row, payment: state.payments.find((payment) => payment.id === row.paymentId) || null }))
    .filter((row) => row.payment);
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
    settlements: list(db.accounting?.settlements),
    settlementDuplicates: quality.settlementDuplicates,
    payments: state.payments.filter((row) => sameBranch(row, branchId)),
    refunds,
    refundablePayments: state.payments.filter((row) => sameBranch(row, branchId) && row.amountIrr > int(row.refundedIrr)),
    reconciliation: {
      unmatchedPayments: reconciliationPayments,
      settlements: state.reconciliationItems.filter((row) => row.kind === 'settlement' && sameBranch(row, branchId)).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)),
      bankAccounts,
      bankStatementLines,
      bankCandidates,
    },
  };
}

function purchasesPayables(db, query = {}) {
  const acc = db.accounting || {};
  const state = ensureFinanceV2(db);
  const branchId = query.branchId ? Number(query.branchId) : null;
  const vendors = list(acc.vendors).filter((row) => row.branchId == null || sameBranch(row, branchId));
  const inventoryItems = list(acc.inventoryItems).filter((row) => sameBranch(row, branchId));
  const bills = list(acc.vendorBills).filter((row) => row.branchId == null || sameBranch(row, branchId));
  const expenses = list(acc.expenses).filter((row) => sameBranch(row, branchId));
  const orders = list(acc.purchaseOrders).filter((row) => !branchId || Number(row.branchId ?? row.locationId) === Number(branchId));
  const receipts = list(acc.goodsReceipts).filter((row) => sameBranch(row, branchId));
  const v2Orders = state.purchaseOrders.filter((row) => sameBranch(row, branchId));
  const v2Receipts = state.goodsReceipts.filter((row) => sameBranch(row, branchId));
  const v2Invoices = state.vendorInvoices.filter((row) => sameBranch(row, branchId));
  const v2Payments = state.supplierPayments.filter((row) => sameBranch(row, branchId));
  const costCommitments = state.costCommitments.filter((row) => sameBranch(row, branchId));
  const costAccruals = state.costAccruals.filter((row) => sameBranch(row, branchId)).map((row) => ({
    ...row,
    commitment: costCommitments.find((commitment) => commitment.id === row.costCommitmentId) || null,
    journalEntry: state.journalEntries.find((entry) => entry.id === row.journalEntryId) || null,
    payments: state.costPayments.filter((payment) => payment.costAccrualId === row.id),
  }));
  const costPayments = state.costPayments.filter((row) => sameBranch(row, branchId));
  const duplicateExpenses = duplicateGroups(expenses, (row) => {
    const day = String(row.date || row.createdAt || '').slice(0, 10);
    const amountValue = row.amount ?? row.totalAmount;
    return day && amountValue != null ? `${day}:${int(amountValue)}:${String(row.description || row.title || '').trim().toLowerCase()}` : '';
  });
  return {
    vendors, inventoryItems, bills, purchaseOrders: orders, goodsReceipts: receipts, expenses,
    v2: {
      purchaseOrders: v2Orders, goodsReceipts: v2Receipts, vendorInvoices: v2Invoices, supplierPayments: v2Payments,
      threeWayMatches: state.threeWayMatches, costCommitments, costAccruals, costPayments,
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
    },
    dataQuality: { duplicateExpenses, trust: 'legacy_unverified' },
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
  const commitments = state.costCommitments.filter((row) => row.status === 'active' && sameBranch(row, branchId)
    && row.startDate <= referenceDate && (!row.endDate || row.endDate >= referenceDate));
  const fixedCommitments = commitments.filter((row) => row.behavior === 'fixed');
  const committedFixedCostIrr = fixedCommitments.reduce((sum, row) => sum + int(row.monthlyAmountIrr), 0);
  const actual = actualBreakEvenFromLedger(db, query);
  const missing = [];
  if (!committedFixedCostIrr) missing.push('fixed_cost_commitments');
  if (actual.netSalesIrr <= 0) missing.push('net_sales');
  if (actual.missing.includes('variable_cost')) missing.push('variable_cost');
  const base = {
    source: 'active cost commitments + posted Finance V2 contribution', committedFixedCostIrr,
    commitmentCount: fixedCommitments.length, netSalesIrr: actual.netSalesIrr, variableCostIrr: actual.variableCostIrr,
    commitments: fixedCommitments.map((row) => ({ id: row.id, name: row.name, type: row.type, monthlyAmountIrr: row.monthlyAmountIrr, expenseAccount: row.expenseAccount })),
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

function costingInventory(db, query = {}) {
  const acc = db.accounting || {};
  const state = ensureFinanceV2(db);
  const branchId = query.branchId ? Number(query.branchId) : null;
  const items = list(acc.inventoryItems).filter((row) => sameBranch(row, branchId));
  const recipes = list(acc.recipes).filter((row) => row.branchId == null || sameBranch(row, branchId));
  const transactions = list(acc.inventoryTransactions).filter((row) => sameBranch(row, branchId));
  const waste = list(acc.wasteLog).filter((row) => sameBranch(row, branchId));
  const invalidCostItems = items.filter((row) => {
    const cost = row.unitCostIrr ?? row.avgCostIrr ?? row.unitCost ?? row.avgCost ?? row.cost;
    return !Number.isFinite(Number(cost)) || Number(cost) < 0;
  });
  const recipeWithoutVersion = recipes.filter((row) => !row.version && !row.versionId && !row.effectiveFrom);
  const intelligence = restaurantIntelligence.deriveRestaurantIntelligence(db, query);
  const costSnapshots = state.orderItemCostSnapshots.filter((row) => sameBranch(row, branchId));
  const shadowMovements = state.inventoryMovements.filter((row) => sameBranch(row, branchId));
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
  const postedCogsIrr = state.journalEntries
    .filter((entry) => entry.source === 'order.cogs' && entry.status === 'posted' && sameBranch(entry, branchId))
    .reduce((sum, entry) => sum + int(entry.debitIrr), 0);
  const profitabilityMap = new Map();
  for (const snapshot of costSnapshots.filter((row) => inRange(row, query.from, query.to, 'capturedAt'))) {
    const key = String(snapshot.menuItemId || snapshot.itemName || snapshot.recipeVersionId || 'unknown');
    const row = profitabilityMap.get(key) || {
      menuItemId: snapshot.menuItemId || null, name: snapshot.itemName || snapshot.menuItemId || 'آیتم نامشخص',
      quantity: 0, netSalesIrr: 0, theoreticalCogsIrr: 0, snapshotCount: 0,
    };
    row.quantity += Number(snapshot.quantity) || 0;
    row.netSalesIrr += int(snapshot.netSalesIrr);
    row.theoreticalCogsIrr += int(snapshot.theoreticalCogsIrr);
    row.snapshotCount += 1;
    profitabilityMap.set(key, row);
  }
  const scopedRefunds = state.refunds.filter((row) => row.status === 'succeeded' && sameBranch(row, branchId) && inRange(row, query.from, query.to, 'refundDate'));
  const itemProfitability = [...profitabilityMap.values()].map((row) => {
    const contributionIrr = row.netSalesIrr - row.theoreticalCogsIrr;
    const contributionMarginPercent = row.netSalesIrr > 0 ? Math.round(contributionIrr / row.netSalesIrr * 10000) / 100 : null;
    return {
      ...row, contributionIrr, contributionMarginPercent,
      status: scopedRefunds.length ? 'partial_coverage' : 'snapshot_backed',
      action: contributionIrr < 0 ? 'stop_and_review' : contributionMarginPercent != null && contributionMarginPercent < 40 ? 'review_cost_or_price' : 'monitor',
      limitation: scopedRefunds.length ? 'refunds_not_allocated_to_order_lines' : null,
    };
  }).sort((a, b) => a.contributionMarginPercent - b.contributionMarginPercent || b.netSalesIrr - a.netSalesIrr);
  const stockoutActions = list(intelligence.stockoutForecast?.items).map((forecast) => {
    const item = items.find((row) => String(row.id) === String(forecast.itemId));
    const leadTimeDays = Number(item?.leadTimeDays ?? item?.supplierLeadTimeDays);
    if (!Number.isFinite(leadTimeDays) || leadTimeDays < 0) return { ...forecast, actionStatus: 'lead_time_missing', reorderByDate: null, suggestedOrderQuantity: null };
    const forecastAt = new Date(`${forecast.forecastDate}T00:00:00.000Z`);
    const reorderBy = new Date(forecastAt.getTime() - leadTimeDays * 86400000);
    const targetCoverageDays = leadTimeDays + 7;
    const suggestedOrderQuantity = Math.max(0, Math.ceil((forecast.averageDailyUsage * targetCoverageDays - forecast.availableQuantity) * 1000) / 1000);
    return {
      ...forecast, leadTimeDays, actionStatus: reorderBy.getTime() <= Date.now() ? 'order_now' : 'scheduled',
      reorderByDate: reorderBy.toISOString().slice(0, 10), suggestedOrderQuantity,
    };
  });
  return {
    items, recipes, transactions, waste, orderItemCostSnapshots: costSnapshots, shadowInventoryMovements: shadowMovements,
    summary: { inventoryItems: items.length, recipes: recipes.length, movements: transactions.length, shadowMovements: shadowMovements.length, costSnapshots: costSnapshots.length, wasteEvents: waste.length, invalidCostItems: invalidCostItems.length, unversionedRecipes: recipeWithoutVersion.length },
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
    },
    itemProfitability: {
      status: itemProfitability.length ? scopedRefunds.length ? 'partial_coverage' : 'snapshot_backed' : 'insufficient_data',
      rows: itemProfitability, refundCountNotAllocated: scopedRefunds.length,
    },
    stockoutActions,
    dataQuality: { invalidCostItemIds: invalidCostItems.map((row) => row.id), unversionedRecipeIds: recipeWithoutVersion.map((row) => row.id) },
    intelligence, actualBreakEven: actualBreakEvenFromLedger(db, query), plannedBreakEven: plannedBreakEvenFromCommitments(db, query),
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
  const productionRecipes = list(db.accounting?.recipes)
    .filter((row) => sameBranch(row, branchId) && row.outputItemId)
    .map((row) => ({
      id: String(row.id), name: row.name || String(row.id), version: row.version || row.versionId || null,
      outputItemId: String(row.outputItemId), outputUnit: inventoryOperations.inventoryItem(db, row.outputItemId, branchId)?.unit || null,
      defaultPlannedYield: Number(row.batchYield ?? row.servings ?? row.yieldQuantity) || 1,
    }));
  const inventorySources = new Set(['inventory.waste', 'inventory.stock_count', 'inventory.production_batch', 'inventory.reversal']);
  const recentOperations = state.events
    .filter((row) => inventorySources.has(row.source) && sameBranch(row, branchId))
    .sort((a, b) => new Date(b.occurredAt) - new Date(a.occurredAt))
    .slice(0, 25)
    .map((row) => ({
      id: row.id, source: row.source, sourceId: row.sourceId, occurredAt: row.occurredAt, status: row.status,
      itemId: row.payload?.itemId || null, recipeId: row.payload?.recipeId || null, reason: row.payload?.reason || null,
      issues: list(row.payload?.issues).map((issue) => ({ code: issue.code, itemId: issue.itemId || null })),
      physicalRecorded: row.payload?.physicalRecorded === true,
    }));
  const exceptions = state.reconciliationItems
    .filter((row) => row.kind === 'inventory_exception' && sameBranch(row, branchId) && row.status === 'exception')
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 25)
    .map((row) => ({ id: row.id, createdAt: row.createdAt, operationId: row.details?.operationId || null, issues: list(row.details?.issues) }));
  return {
    items, productionRecipes, recentOperations, exceptions,
    recipeCapacity: intelligence.recipeCapacity,
    stockoutForecast: intelligence.stockoutForecast,
    summary: {
      items: items.length,
      lowStock: items.filter((row) => ['reorder', 'negative'].includes(row.status)).length,
      unvaluedEvents: recentOperations.filter((row) => row.status === 'blocked').length,
      exceptions: exceptions.length,
      productionRecipes: productionRecipes.length,
    },
    policy: {
      physicalQuantityIsRecordedImmediately: true,
      financialAccountsHiddenFromOperator: true,
      correctionMethod: 'reversal_only',
    },
  };
}

function financialReports(db, query = {}) {
  const state = ensureFinanceV2(db);
  const branchId = query.branchId ? Number(query.branchId) : null;
  const accountNames = new Map(list(db.accounting?.accounts).map((row) => [String(row.code || row.accountCode), row.nameFa || row.name || null]));
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
  return {
    source: 'posted Finance V2 journal lines',
    generatedAt: now(),
    generalLedger: { status: entries.length ? 'available' : 'insufficient_data', rows: linePage.rows, pagination: { page: linePage.page, pageSize: linePage.pageSize, total: linePage.total, pages: linePage.pages } },
    trialBalance: { status: entries.length ? debitIrr === creditIrr ? 'balanced' : 'unbalanced' : 'insufficient_data', rows: trialRows, debitIrr, creditIrr, differenceIrr: debitIrr - creditIrr },
    profitAndLoss: { status: entries.length && pnlRows.length ? 'available' : 'insufficient_data', rows: pnlRows, revenueIrr, cogsIrr, operatingExpenseIrr, netProfitIrr },
    balanceSheet: { status: entries.length ? equationDifferenceIrr === 0 ? 'balanced' : 'unbalanced' : 'insufficient_data', rows: balanceRows, assetsIrr, liabilitiesIrr, equityBeforeCurrentIrr, currentPeriodEarningsIrr: netProfitIrr, equityIrr, equationDifferenceIrr },
    cashFlow: {
      status: !cashRows.length ? 'insufficient_data' : cashTotals.unclassified ? 'partial_coverage' : 'rule_based',
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
    const periodCheck = validateOpenPeriod(db, occurredAt);
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
  const quality = dataQuality(db, query.branchId ? Number(query.branchId) : null);
  const snapshot = reportSnapshot(db, query);
  const entries = state.journalEntries.filter((entry) => sameBranch(entry, query.branchId) && inRange(entry, query.from, query.to, 'date'));
  const entryPage = page(entries, query);
  const usingV2Periods = state.fiscalPeriods.length > 0;
  const periods = usingV2Periods ? state.fiscalPeriods : list(db.accounting?.fiscalPeriods);
  const selectedPeriod = query.periodId
    ? periods.find((period) => String(period.id) === String(query.periodId)) || null
    : quality.currentPeriod;
  const fixedAssets = state.fixedAssets.filter((asset) => sameBranch(asset, query.branchId));
  const depreciationRuns = state.depreciationRuns.filter((run) => sameBranch(run, query.branchId)).map((run) => ({
    ...run, journalEntry: state.journalEntries.find((entry) => entry.id === run.journalEntryId) || null,
  }));
  const depreciationPreview = previewDepreciationV2(db, { branchId: query.branchId, postingDate: String(query.to || now()).slice(0, 10) });
  const payrollRuns = state.payrollRuns.filter((run) => sameBranch(run, query.branchId)).map((run) => ({
    ...run,
    journalEntry: state.journalEntries.find((entry) => entry.id === run.journalEntryId) || null,
    payments: state.payrollPayments.filter((payment) => payment.payrollRunId === run.id),
  }));
  const payrollPayments = state.payrollPayments.filter((payment) => sameBranch(payment, query.branchId));
  const openingBalanceBatches = state.openingBalanceBatches
    .filter((batch) => sameBranch(batch, query.branchId))
    .map((batch) => ({
      ...batch,
      journalEntry: state.journalEntries.find((entry) => entry.id === batch.journalEntryId) || null,
      approval: state.approvals.find((approval) => approval.id === batch.approvalId) || null,
    }))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return {
    snapshot, entries: entryPage.rows, pagination: { page: entryPage.page, pageSize: entryPage.pageSize, total: entryPage.total, pages: entryPage.pages }, periods, selectedPeriod, periodSource: usingV2Periods ? 'finance_v2' : 'legacy_read_only',
    closeChecklist: [
      { id: 'balanced-ledger', label: 'تراز بودن کل بدهکار و بستانکار', passed: snapshot.reconciliation.balanced },
      { id: 'sales-reconciled', label: 'تطبیق فروش عملیاتی و دفتر', passed: snapshot.reconciliation.salesDifferenceIrr === 0 },
      { id: 'events-clear', label: 'نبود رویداد مسدود یا ثبت‌نشده', passed: !quality.issues.some((issue) => ['blocked_finance_events', 'paid_orders_without_finance_event'].includes(issue.code)) },
      { id: 'period-open', label: 'وجود دورهٔ معتبر در وضعیت قابل بستن', passed: Boolean(selectedPeriod && (['open', 'reopened'].includes(selectedPeriod.status) || (query.allowSoftClosed && selectedPeriod.status === 'soft_closed'))) },
      { id: 'duplicates-clear', label: 'نبود تسویه یا استهلاک تکراری', passed: !quality.settlementDuplicates.length && !quality.depreciationDuplicates.length },
      { id: 'approvals-clear', label: 'نبود عملیات مالی منتظر تأیید', passed: !state.approvals.some((approval) => approval.status === 'pending') },
    ],
    reports: financialReports(db, query),
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
    openingBalancePolicy: {
      scope: 'posting_balance_sheet_accounts_only', currentYearProfitLossExcluded: true,
      explicitBalancingLineRequired: true, automaticPlugAccount: false,
      approvalRequired: true, correctionMethod: 'reversal_only', oneActiveBatchPerBranch: true,
    },
    integrityControl: { label: 'کنترل یکپارچگی اسناد', status: entries.length ? 'available_for_v2_entries' : 'no_v2_entries' },
    taxpayerIntegration: { status: 'not_connected', exportReady: false, message: 'ارسال واقعی سامانه مؤدیان در دامنهٔ این نسخه نیست.' },
  };
}

function requestOrderRefund(db, orderId, input, actor, idempotencyKey) {
  const state = ensureFinanceV2(db);
  const order = list(db.orders).find((item) => String(item.id) === String(orderId));
  if (!order) throw Object.assign(new Error('سفارش یافت نشد.'), { code: 'order_not_found', status: 404 });
  const orderPayments = state.payments.filter((item) => String(item.orderId) === String(order.id) && ['succeeded', 'refunded'].includes(item.status));
  if (!orderPayments.length) throw Object.assign(new Error('برای سفارش، پرداخت معتبر Finance V2 ثبت نشده است.'), { code: 'finance_payment_missing', status: 409 });
  const payment = input.paymentId
    ? orderPayments.find((item) => String(item.id) === String(input.paymentId))
    : orderPayments.length === 1 ? orderPayments[0] : null;
  if (!payment) throw Object.assign(new Error('برای سفارش چند روش پرداخت وجود دارد؛ روش بازگشت وجه را مشخص کنید.'), { code: 'refund_payment_required', status: 400 });
  const amountIrr = safeIrr(input.amountIrr, 'refund_amount_invalid');
  if (amountIrr <= 0) throw Object.assign(new Error('مبلغ برگشت وجه باید بزرگ‌تر از صفر باشد.'), { code: 'refund_amount_invalid' });
  const reason = String(input.reason || '').trim().slice(0, 300);
  if (reason.length < 3) throw Object.assign(new Error('علت برگشت وجه الزامی است.'), { code: 'refund_reason_required' });
  const refundDate = input.refundDate || now();
  if (!Number.isFinite(new Date(refundDate).getTime())) throw Object.assign(new Error('تاریخ برگشت وجه معتبر نیست.'), { code: 'refund_date_invalid' });
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
    amountIrr, reason, refundDate, status: 'pending_approval', idempotencyKey,
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
  state.approvals.push(approval);
  return { refund, approval };
}

function postApprovedRefund(db, refund, actor) {
  const state = ensureFinanceV2(db);
  if (refund.journalEntryId) return state.journalEntries.find((item) => item.id === refund.journalEntryId) || null;
  const payment = state.payments.find((item) => item.id === refund.paymentId);
  const order = list(db.orders).find((item) => String(item.id) === String(refund.orderId));
  if (!payment || !order) throw Object.assign(new Error('زنجیرهٔ سفارش و پرداخت برگشت وجه کامل نیست.'), { code: 'refund_source_chain_missing', status: 409 });
  const tenderAccount = TENDER_ACCOUNTS[payment.tender];
  if (!tenderAccount) throw Object.assign(new Error('حساب روش پرداخت برای برگشت وجه تعریف نشده است.'), { code: 'refund_tender_account_missing', status: 409 });
  const periodCheck = validateOpenPeriod(db, refund.refundDate);
  if (!periodCheck.ok) throw Object.assign(new Error(periodCheck.message), { code: periodCheck.code, status: 409 });
  const orderTotalIrr = irrFromLegacyToman(order.total);
  if (orderTotalIrr <= 0) throw Object.assign(new Error('مبلغ قطعی سفارش برای تسهیم برگشت معتبر نیست.'), { code: 'refund_order_total_invalid', status: 409 });
  const storedTaxToman = order.taxAmount ?? order.tax ?? order.vatAmount;
  const orderTaxIrr = storedTaxToman == null ? 0 : Math.max(0, irrFromLegacyToman(storedTaxToman));
  if (orderTaxIrr > orderTotalIrr) throw Object.assign(new Error('مالیات ذخیره‌شده سفارش نامعتبر است.'), { code: 'tax_total_invalid', status: 409 });
  const priorSucceeded = state.refunds.filter((item) => item.id !== refund.id && String(item.orderId) === String(order.id) && item.status === 'succeeded');
  const priorRefundIrr = priorSucceeded.reduce((sum, item) => sum + int(item.amountIrr), 0);
  const priorTaxIrr = priorSucceeded.reduce((sum, item) => sum + int(item.taxRefundIrr), 0);
  const cumulativeRefundIrr = priorRefundIrr + refund.amountIrr;
  if (cumulativeRefundIrr > orderTotalIrr) throw Object.assign(new Error('جمع برگشت وجه از مبلغ سفارش بیشتر می‌شود.'), { code: 'refund_total_exceeds_order', status: 409 });
  const cumulativeTaxIrr = cumulativeRefundIrr === orderTotalIrr
    ? orderTaxIrr
    : Math.round((orderTaxIrr * cumulativeRefundIrr) / orderTotalIrr);
  const taxRefundIrr = Math.max(0, cumulativeTaxIrr - priorTaxIrr);
  const revenueRefundIrr = refund.amountIrr - taxRefundIrr;
  const branchId = Number(order.branchId) || payment.branchId;
  const costCenter = `branch:${branchId}`;
  const originalSale = state.journalEntries.find((entry) => entry.source === 'order.paid' && String(entry.sourceId) === String(order.id));
  const salesAccount = originalSale?.lines?.find((line) => ['4110', '4120', '4130'].includes(line.accountCode))?.accountCode
    || (order.fulfillment === 'pickup' ? '4120' : order.fulfillment === 'delivery' ? '4130' : '4110');
  const recorded = recordEvent(db, {
    source: 'order.refund', sourceId: refund.id, sourceVersion: 1,
    idempotencyKey: `refund:${refund.id}:v1`, branchId, occurredAt: refund.refundDate,
    amountIrr: refund.amountIrr,
    payload: { orderId: order.id, paymentId: payment.id, tender: payment.tender, reason: refund.reason, taxRefundIrr, revenueRefundIrr, inventoryEffect: refund.inventoryEffect },
  });
  const lines = [];
  if (revenueRefundIrr) lines.push({ accountCode: salesAccount, accountType: 'contra_revenue', debitIrr: revenueRefundIrr, creditIrr: 0, branchId, costCenter, memo: `برگشت فروش سفارش ${order.orderNo || order.id}` });
  if (taxRefundIrr) lines.push({ accountCode: '2210', debitIrr: taxRefundIrr, creditIrr: 0, branchId, costCenter, memo: `برگشت مالیات سفارش ${order.orderNo || order.id}` });
  lines.push({ accountCode: tenderAccount, debitIrr: 0, creditIrr: refund.amountIrr, branchId, costCenter, paymentMethod: payment.tender, memo: `خروج وجه برگشت سفارش ${order.orderNo || order.id}` });
  const entry = postEventJournal(db, recorded.event, lines, `برگشت وجه تأییدشده سفارش ${order.orderNo || order.id}`, actor);
  if (!entry) throw Object.assign(new Error('سند برگشت وجه پست نشد.'), { code: recorded.event.error?.code || 'refund_journal_post_failed', status: 409 });
  refund.status = 'succeeded'; refund.approvedBy = actor; refund.approvedAt = now(); refund.journalEntryId = entry.id;
  refund.taxRefundIrr = taxRefundIrr; refund.revenueRefundIrr = revenueRefundIrr;
  payment.refundedIrr = state.refunds.filter((item) => item.paymentId === payment.id && item.status === 'succeeded').reduce((sum, item) => sum + int(item.amountIrr), 0);
  payment.status = payment.refundedIrr >= payment.amountIrr ? 'refunded' : 'succeeded';
  state.reconciliationItems.push({
    id: id(), kind: 'refund', branchId, orderId: order.id, paymentId: payment.id, cashSessionId: null,
    bankReference: payment.providerReference || null, settlementReference: null, psp: payment.provider || null,
    terminalId: null, batchNo: null, journalEntryId: entry.id, amountIrr: refund.amountIrr,
    status: 'matched', matchedAt: now(), matchedBy: actor,
    details: { refundId: refund.id, financialOnly: true }, createdAt: now(),
  });
  return entry;
}

function recordSettlementV2(db, input, actor) {
  const state = ensureFinanceV2(db);
  const branchId = Number(input.branchId) || null;
  if (!branchId) throw Object.assign(new Error('شعبهٔ تسویه الزامی است.'), { code: 'settlement_branch_required' });
  const psp = String(input.psp || '').trim().slice(0, 120);
  const terminalId = String(input.terminalId || '').trim().slice(0, 120);
  const batchNo = String(input.batchNo || '').trim().slice(0, 120);
  if (!psp || !terminalId || !batchNo) throw Object.assign(new Error('PSP، پایانه و شماره بچ تسویه الزامی است.'), { code: 'settlement_identity_required' });
  if (state.reconciliationItems.some((item) => item.kind === 'settlement' && item.psp === psp && item.terminalId === terminalId && item.batchNo === batchNo && item.status !== 'exception')) {
    throw Object.assign(new Error('این بچ تسویه قبلاً ثبت شده است.'), { code: 'settlement_batch_duplicate', status: 409 });
  }
  const paymentIds = [...new Set(list(input.paymentIds).map(String).filter(Boolean))];
  if (!paymentIds.length) throw Object.assign(new Error('حداقل یک پرداخت برای تطبیق انتخاب کنید.'), { code: 'settlement_payments_required' });
  const payments = paymentIds.map((paymentId) => state.payments.find((item) => item.id === paymentId));
  if (payments.some((payment) => !payment)) throw Object.assign(new Error('یکی از پرداخت‌های انتخاب‌شده یافت نشد.'), { code: 'settlement_payment_not_found', status: 404 });
  if (payments.some((payment) => Number(payment.branchId) !== branchId)) throw Object.assign(new Error('پرداخت‌های چند شعبه را نمی‌توان در یک بچ تسویه کرد.'), { code: 'settlement_branch_mismatch', status: 409 });
  const clearingAccounts = new Set(payments.map((payment) => TENDER_ACCOUNTS[payment.tender]));
  if (clearingAccounts.size !== 1 || !['1310', '1320'].includes([...clearingAccounts][0])) {
    throw Object.assign(new Error('هر بچ باید فقط پرداخت‌های یک حساب واسط کارتخوان یا درگاه را شامل شود.'), { code: 'settlement_tender_mismatch', status: 409 });
  }
  const paymentItems = payments.map((payment) => state.reconciliationItems.find((item) => item.kind === 'payment' && item.paymentId === payment.id));
  if (paymentItems.some((item) => !item || item.status !== 'unmatched')) throw Object.assign(new Error('یکی از پرداخت‌ها قبلاً تطبیق شده یا در صف تطبیق نیست.'), { code: 'settlement_payment_already_matched', status: 409 });
  const grossAmountIrr = payments.reduce((sum, payment) => sum + int(payment.amountIrr), 0);
  const feeIrr = safeIrr(input.feeIrr || 0, 'settlement_fee_invalid');
  if (feeIrr > grossAmountIrr) throw Object.assign(new Error('کارمزد از مبلغ ناخالص تسویه بیشتر است.'), { code: 'settlement_fee_exceeds_gross' });
  const bankAmountIrr = grossAmountIrr - feeIrr;
  if (input.bankAmountIrr != null && safeIrr(input.bankAmountIrr, 'settlement_bank_amount_invalid') !== bankAmountIrr) {
    throw Object.assign(new Error('خالص واریزی با ناخالص پرداخت‌ها منهای کارمزد برابر نیست.'), {
      code: 'settlement_amount_mismatch', status: 409,
      details: { grossAmountIrr, feeIrr, expectedBankAmountIrr: bankAmountIrr, suppliedBankAmountIrr: input.bankAmountIrr },
    });
  }
  const settledAt = input.settledAt || now();
  const periodCheck = validateOpenPeriod(db, settledAt);
  if (!periodCheck.ok) throw Object.assign(new Error(periodCheck.message), { code: periodCheck.code, status: 409 });
  const settlementId = id();
  const clearingAccount = [...clearingAccounts][0];
  const costCenter = `branch:${branchId}`;
  const recorded = recordEvent(db, {
    source: 'settlement.received', sourceId: settlementId, sourceVersion: 1,
    idempotencyKey: `settlement:${psp}:${terminalId}:${batchNo}`, branchId, occurredAt: settledAt,
    amountIrr: grossAmountIrr,
    payload: { psp, terminalId, batchNo, bankReference: input.bankReference || null, paymentIds, grossAmountIrr, feeIrr, bankAmountIrr },
  });
  const lines = [];
  if (bankAmountIrr) lines.push({ accountCode: '1210', debitIrr: bankAmountIrr, creditIrr: 0, branchId, costCenter, memo: `واریز بچ ${batchNo}` });
  if (feeIrr) lines.push({ accountCode: '6710', accountType: 'expense', debitIrr: feeIrr, creditIrr: 0, branchId, costCenter, counterpartyId: psp, memo: `کارمزد بچ ${batchNo}` });
  lines.push({ accountCode: clearingAccount, debitIrr: 0, creditIrr: grossAmountIrr, branchId, costCenter, paymentMethod: payments[0].tender, counterpartyId: psp, memo: `تسویه حساب واسط بچ ${batchNo}` });
  const entry = postEventJournal(db, recorded.event, lines, `تسویه ${psp} / پایانه ${terminalId} / بچ ${batchNo}`, actor);
  if (!entry) throw Object.assign(new Error('سند تسویه پست نشد.'), { code: recorded.event.error?.code || 'settlement_journal_post_failed', status: 409 });
  const settlement = {
    id: settlementId, kind: 'settlement', branchId, orderId: null, paymentId: null, cashSessionId: null,
    bankReference: String(input.bankReference || '').trim().slice(0, 160) || null,
    settlementReference: batchNo, psp, terminalId, batchNo, journalEntryId: entry.id,
    amountIrr: bankAmountIrr, status: 'matched', matchedAt: now(), matchedBy: actor,
    details: { paymentIds, grossAmountIrr, feeIrr, bankAmountIrr, clearingAccount }, createdAt: now(),
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
  const totals = assertBalanced(lines);
  const period = list(db.financeV2?.fiscalPeriods).find((candidate) => {
    const start = new Date(candidate.startDate);
    const end = new Date(candidate.endDate);
    return Number.isFinite(start.getTime()) && Number.isFinite(end.getTime()) && start <= asOf && end >= asOf;
  }) || null;
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
  const lines = list(input.lines).map((line) => ({
    accountCode: String(line.accountCode || '').trim(), accountType: String(line.accountType || '').trim() || null,
    debitIrr: safeIrr(line.debitIrr), creditIrr: safeIrr(line.creditIrr), branchId: Number(line.branchId || input.branchId) || null,
    costCenter: String(line.costCenter || input.costCenter || '').trim() || null,
    counterpartyId: line.counterpartyId == null ? null : String(line.counterpartyId), paymentMethod: line.paymentMethod || null,
    itemId: line.itemId == null ? null : String(line.itemId), recipeVersionId: line.recipeVersionId == null ? null : String(line.recipeVersionId),
    memo: String(line.memo || '').slice(0, 300),
  }));
  const totals = assertBalanced(lines);
  const entry = {
    id: id('fje'), number: `F2-D-${String(state.journalEntries.length + 1).padStart(6, '0')}`,
    periodId: null, sourceEventId: null, source: 'manual', sourceId: null,
    date: input.date || now(), description: String(input.description || 'سند دستی').slice(0, 280), status: 'draft',
    debitIrr: totals.debitIrr, creditIrr: totals.creditIrr, branchId: Number(input.branchId) || null,
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

function decideApproval(db, approvalId, decision, actor, comment) {
  const state = ensureFinanceV2(db);
  const approval = state.approvals.find((item) => item.id === approvalId);
  if (!approval) throw Object.assign(new Error('درخواست تأیید یافت نشد.'), { code: 'approval_not_found', status: 404 });
  if (approval.status !== 'pending') throw Object.assign(new Error('این درخواست قبلاً تصمیم‌گیری شده است.'), { code: 'approval_already_decided', status: 409 });
  if (!['approved', 'rejected'].includes(decision)) throw Object.assign(new Error('تصمیم معتبر نیست.'), { code: 'approval_decision_invalid', status: 400 });
  if (String(approval.createdBy) === String(actor)) throw Object.assign(new Error('ایجادکننده نمی‌تواند درخواست خودش را تأیید کند.'), { code: 'segregation_of_duties', status: 409 });
  const entry = approval.entityType === 'journal_entry' ? state.journalEntries.find((item) => item.id === approval.entityId) : null;
  const period = approval.entityType === 'fiscal_period' ? state.fiscalPeriods.find((item) => item.id === approval.entityId) : null;
  const purchaseOrder = approval.entityType === 'purchase_order' ? state.purchaseOrders.find((item) => item.id === approval.entityId) : null;
  const supplierPayment = approval.entityType === 'supplier_payment' ? state.supplierPayments.find((item) => item.id === approval.entityId) : null;
  const costPayment = approval.entityType === 'cost_payment' ? state.costPayments.find((item) => item.id === approval.entityId) : null;
  const payrollPayment = approval.entityType === 'payroll_payment' ? state.payrollPayments.find((item) => item.id === approval.entityId) : null;
  const financeRefund = approval.entityType === 'finance_refund' ? state.refunds.find((item) => item.id === approval.entityId) : null;
  const costAccrual = entry ? state.costAccruals.find((item) => item.journalEntryId === entry.id) || null : null;
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
    const periodCheck = validateOpenPeriod(db, entry.date);
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
  let supplierPaymentEntry = null;
  if (decision === 'approved' && approval.entityType === 'supplier_payment') {
    if (!supplierPayment) throw Object.assign(new Error('درخواست پرداخت تأمین‌کننده یافت نشد.'), { code: 'supplier_payment_not_found', status: 404 });
    const invoice = state.vendorInvoices.find((item) => item.id === supplierPayment.vendorInvoiceId);
    if (!invoice) throw Object.assign(new Error('فاکتور پرداختنی یافت نشد.'), { code: 'vendor_invoice_not_found', status: 404 });
    const remainingIrr = invoice.totalIrr - invoice.paidAmountIrr;
    if (supplierPayment.amountIrr > remainingIrr) throw Object.assign(new Error('مبلغ تأییدشده از ماندهٔ فعلی فاکتور بیشتر است.'), { code: 'supplier_payment_exceeds_remaining', status: 409 });
    const periodCheck = validateOpenPeriod(db, supplierPayment.paymentDate);
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
    refundEntry = postApprovedRefund(db, financeRefund, actor);
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
    const periodCheck = validateOpenPeriod(db, costPayment.paymentDate);
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
    const periodCheck = validateOpenPeriod(db, payrollPayment.paymentDate);
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
  if (financeRefund && decision === 'rejected') financeRefund.status = 'cancelled';
  return { approval, entry, period, purchaseOrder, supplierPayment, supplierPaymentEntry, costAccrual, costPayment, costPaymentEntry, financeRefund, refundEntry, fixedAsset, depreciationRun, payrollRun, payrollPayment, payrollPaymentEntry, openingBalanceBatch, legacyBackfill, legacyBackfillEvent, legacyBackfillPayments, legacyBackfillCosting };
}

function reverseEntry(db, entryId, actor, reason, date = now()) {
  const state = ensureFinanceV2(db);
  const original = state.journalEntries.find((entry) => entry.id === entryId);
  if (!original) throw Object.assign(new Error('سند یافت نشد.'), { code: 'journal_not_found', status: 404 });
  if (original.status !== 'posted' || original.reversedById) throw Object.assign(new Error('این سند قابل معکوس‌سازی نیست.'), { code: 'journal_not_reversible', status: 409 });
  const linkedCostAccrual = state.costAccruals.find((row) => row.journalEntryId === original.id);
  const linkedFixedAsset = state.fixedAssets.find((row) => row.acquisitionJournalEntryId === original.id);
  const linkedDepreciationRun = state.depreciationRuns.find((row) => row.journalEntryId === original.id);
  const linkedPayrollRun = state.payrollRuns.find((row) => row.journalEntryId === original.id);
  const linkedPayrollPayment = state.payrollPayments.find((row) => row.journalEntryId === original.id && row.status === 'paid');
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
  if (linkedLegacyBackfill) {
    const paymentIds = new Set(linkedLegacyPayments.map((payment) => payment.id));
    const reconciled = state.reconciliationItems.some((item) => paymentIds.has(item.paymentId) && item.status !== 'unmatched');
    if (reconciled) throw Object.assign(new Error('پرداخت بازسازی‌شده پس از تطبیق مستقیم معکوس نمی‌شود؛ ابتدا تطبیق یا تسویه باید کنترل‌شده برگشت داده شود.'), { code: 'legacy_backfill_has_reconciliation_activity', status: 409 });
    const refunded = state.refunds.some((refund) => paymentIds.has(refund.paymentId) && !['cancelled', 'failed'].includes(refund.status));
    if (refunded) throw Object.assign(new Error('فروش بازسازی‌شده پس از ثبت بازپرداخت مستقیم معکوس نمی‌شود؛ ابتدا زنجیرهٔ refund باید اصلاح شود.'), { code: 'legacy_backfill_has_refund_activity', status: 409 });
    const cogsEvent = state.events.find((event) => event.source === 'order.cogs' && String(event.sourceId) === String(linkedLegacyBackfill.sourceId));
    const cogsEntry = cogsEvent?.journalEntryId ? state.journalEntries.find((entry) => entry.id === cogsEvent.journalEntryId) : null;
    if (cogsEntry?.status === 'posted' && !cogsEntry.reversedById) throw Object.assign(new Error('پیش از برگشت فروش بازسازی‌شده، مصرف انبار و بهای تمام‌شدهٔ وابسته باید کنترل‌شده معکوس شود.'), { code: 'legacy_backfill_has_posted_cogs', status: 409 });
  }
  const periodCheck = validateOpenPeriod(db, date);
  if (!periodCheck.ok) throw Object.assign(new Error(periodCheck.message), { code: periodCheck.code, status: 409 });
  const reversal = {
    ...original, id: id('fje'), number: `F2-R-${String(state.journalEntries.length + 1).padStart(6, '0')}`,
    periodId: periodCheck.period.id, sourceEventId: null, source: 'reversal', sourceId: original.id,
    date, description: `معکوس ${original.number}: ${String(reason || 'اصلاح').slice(0, 180)}`,
    status: 'posted', reversalOfId: original.id, reversedById: null,
    lines: original.lines.map((line, index) => ({ ...line, id: id('fjl'), lineNo: index + 1, debitIrr: int(line.creditIrr), creditIrr: int(line.debitIrr) })),
    createdAt: now(), createdBy: actor, postedAt: now(), postedBy: actor,
  };
  state.journalEntries.push(reversal);
  original.reversedById = reversal.id; original.reversedAt = now();
  if (linkedCostAccrual) linkedCostAccrual.status = 'reversed';
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
      branchId: query.branchId ? Number(query.branchId) : null, from: query.from || null, to: query.to || null,
      source: 'WESTO Finance V2', ...extraMeta,
    },
    error: null,
  };
}

function errorBody(error, query = {}) {
  return { data: null, meta: { generatedAt: now(), currency: 'IRR', branchId: query.branchId ? Number(query.branchId) : null }, error: { code: error.code || 'finance_error', message: error.message || 'خطای مالی', details: error.details || null } };
}

function page(rows, query) {
  const pageNo = Math.max(1, int(query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, int(query.pageSize) || 25));
  const total = rows.length;
  return { rows: rows.slice((pageNo - 1) * pageSize, pageNo * pageSize), page: pageNo, pageSize, total, pages: Math.ceil(total / pageSize) };
}

function registerFinanceV2Routes({ app, getDb, save, requireCapability, effectiveRole, getStorageStatus = () => null }) {
  let mutationTail = Promise.resolve();
  const runHandler = async (handler, req, res) => {
    const mutating = req.method !== 'GET';
    const db = mutating ? getDb() : null;
    const financeBefore = mutating && db.financeV2 !== undefined ? JSON.parse(JSON.stringify(db.financeV2)) : undefined;
    try {
      return await handler(req, res);
    } catch (error) {
      if (mutating) {
        if (financeBefore === undefined) delete db.financeV2;
        else db.financeV2 = financeBefore;
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
  app.get('/api/admin/v2/finance/workbench', requireCapability('finance.view'), guard((req, res) => res.json(envelope(workbench(getDb(), req.query, { storageStatus: getStorageStatus() }), req.query))));
  app.get('/api/admin/v2/finance/cutover-readiness', requireCapability('finance.reports.view'), guard((req, res) => res.json(envelope(shadowRunReadiness(getDb(), req.query.branchId ? Number(req.query.branchId) : null, { storageStatus: getStorageStatus() }), req.query))));
  app.get('/api/admin/v2/finance/sales-cash-bank', requireCapability('finance.view'), guard((req, res) => res.json(envelope(salesCashBank(getDb(), req.query), req.query))));
  app.post('/api/admin/v2/finance/orders/:orderId/refund-requests', requireCapability('finance.events.manage'), guard(async (req, res) => {
    const key = String(req.get('Idempotency-Key') || '').trim();
    if (!key) throw Object.assign(new Error('کلید Idempotency-Key الزامی است.'), { code: 'idempotency_key_required', status: 400 });
    const db = getDb(); const state = ensureFinanceV2(db); const replay = state.idempotency[key];
    if (replay) {
      const refund = state.refunds.find((row) => row.id === replay.id);
      const approval = refund ? state.approvals.find((row) => row.entityType === 'finance_refund' && row.entityId === refund.id) : null;
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
    const purchaseOrder = createPurchaseOrderV2(db, req.body || {}, req.user.phone);
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
  app.post('/api/admin/v2/finance/goods-receipts', requireCapability('finance.payables.manage'), guard(async (req, res) => {
    const key = String(req.get('Idempotency-Key') || '').trim();
    if (!key) throw Object.assign(new Error('کلید Idempotency-Key الزامی است.'), { code: 'idempotency_key_required', status: 400 });
    const db = getDb(); const state = ensureFinanceV2(db); const replay = state.idempotency[key];
    if (replay) return res.json(envelope({ goodsReceipt: state.goodsReceipts.find((row) => row.id === replay.id), idempotentReplay: true }, req.query));
    const result = receiveGoodsV2(db, req.body || {}, req.user.phone);
    state.idempotency[key] = { kind: 'goods_receipt', id: result.goodsReceipt.id, at: now() }; await save({ requireDurable: true });
    res.status(201).json(envelope({ ...result, idempotentReplay: false }, req.query));
  }));
  app.post('/api/admin/v2/finance/vendor-invoices', requireCapability('finance.payables.manage'), guard(async (req, res) => {
    const key = String(req.get('Idempotency-Key') || '').trim();
    if (!key) throw Object.assign(new Error('کلید Idempotency-Key الزامی است.'), { code: 'idempotency_key_required', status: 400 });
    const db = getDb(); const state = ensureFinanceV2(db); const replay = state.idempotency[key];
    if (replay) return res.json(envelope({ vendorInvoice: state.vendorInvoices.find((row) => row.id === replay.id), idempotentReplay: true }, req.query));
    const result = createVendorInvoiceV2(db, req.body || {}, req.user.phone);
    state.idempotency[key] = { kind: 'vendor_invoice', id: result.vendorInvoice.id, at: now() }; await save({ requireDurable: true });
    res.status(201).json(envelope({ ...result, idempotentReplay: false }, req.query));
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
  const inventoryMutation = (kind) => guard(async (req, res) => {
    const key = String(req.get('Idempotency-Key') || '').trim();
    if (!key) throw Object.assign(new Error('کلید Idempotency-Key الزامی است.'), { code: 'idempotency_key_required', status: 400 });
    const result = recordInventoryOperationV2(getDb(), kind, req.body || {}, req.user.phone, key);
    await save({ requireDurable: true });
    res.status(result.idempotentReplay ? 200 : 201).json(envelope(result, req.query, { audience: 'kitchen_inventory_operator' }));
  });
  app.post('/api/kitchen/inventory/waste', requireCapability('inventory.operations'), inventoryMutation('waste'));
  app.post('/api/kitchen/inventory/stock-counts', requireCapability('inventory.operations'), inventoryMutation('stock_count'));
  app.post('/api/kitchen/inventory/production-batches', requireCapability('inventory.operations'), inventoryMutation('production_batch'));
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
    const period = createFiscalPeriod(db, req.body || {}, req.user.phone);
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
    const result = closeFiscalPeriod(db, req.params.id, req.user.phone, { preliminary });
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
    await save({ requireDurable: true }); res.status(result.idempotentReplay ? 200 : 201).json(envelope(result, req.query));
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
    let rows = state.legacyArchive.filter((row) => !req.query.branchId || row.branchId == null || Number(row.branchId) === Number(req.query.branchId));
    if (req.query.trustStatus) rows = rows.filter((row) => row.trustStatus === req.query.trustStatus);
    if (req.query.decision) rows = rows.filter((row) => row.decision === req.query.decision);
    rows.sort((a, b) => new Date(b.archivedAt) - new Date(a.archivedAt));
    const result = page(rows, req.query);
    res.json(envelope(result.rows, req.query, { pagination: result, summary: legacyArchiveSummary(getDb(), req.query.branchId) }));
  }));
  app.post('/api/admin/v2/finance/migration/classify', requireCapability('finance.events.manage'), guard(async (req, res) => {
    const key = String(req.get('Idempotency-Key') || '').trim();
    if (!key) throw Object.assign(new Error('کلید Idempotency-Key الزامی است.'), { code: 'idempotency_key_required', status: 400 });
    const db = getDb(); const state = ensureFinanceV2(db); const replay = state.idempotency[key];
    if (replay) return res.json(envelope({ archive: legacyArchiveSummary(db, req.query.branchId), idempotentReplay: true }, req.query));
    const result = classifyAndArchiveLegacy(db, req.user.phone);
    state.idempotency[key] = { kind: 'legacy_classification', id: 'legacy_archive', at: now() }; await save({ requireDurable: true });
    res.status(201).json(envelope({ ...result, idempotentReplay: false }, req.query));
  }));
  app.post('/api/admin/v2/finance/migration/archive/:id/decision', requireCapability('finance.events.manage'), guard(async (req, res) => {
    const key = String(req.get('Idempotency-Key') || '').trim();
    if (!key) throw Object.assign(new Error('کلید Idempotency-Key الزامی است.'), { code: 'idempotency_key_required', status: 400 });
    const db = getDb(); const state = ensureFinanceV2(db); const replay = state.idempotency[key];
    if (replay) return res.json(envelope({ record: state.legacyArchive.find((row) => row.id === replay.id), idempotentReplay: true }, req.query));
    const result = decideLegacyArchive(db, req.params.id, req.body || {}, req.user.phone, effectiveRole(req.user));
    state.idempotency[key] = { kind: 'legacy_archive_decision', id: result.record.id, at: now() }; await save({ requireDurable: true });
    res.json(envelope({ ...result, idempotentReplay: false }, req.query));
  }));
  app.post('/api/admin/v2/finance/migration/archive/:id/backfill-preview', requireCapability('finance.view'), guard((req, res) => {
    res.json(envelope(legacyOrderBackfillPreview(getDb(), req.params.id), req.query, { source: 'read-only legacy backfill preview' }));
  }));
  app.post('/api/admin/v2/finance/migration/archive/:id/backfill-request', requireCapability('finance.journal.create'), guard(async (req, res) => {
    const key = String(req.get('Idempotency-Key') || '').trim();
    if (!key) throw Object.assign(new Error('کلید Idempotency-Key الزامی است.'), { code: 'idempotency_key_required', status: 400 });
    const db = getDb(); const state = ensureFinanceV2(db); const replay = state.idempotency[key];
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
    const db = getDb(); const quality = dataQuality(db, req.query.branchId ? Number(req.query.branchId) : null);
    const sessions = list(db.cashSessions).filter((row) => sameBranch(row, req.query.branchId));
    res.json(envelope({ summary: reportSnapshot(db, req.query), cashSessions: sessions, settlementDuplicates: quality.settlementDuplicates, unmatchedOrders: quality.uncaptured.map((order) => ({ id: order.id, orderNo: order.orderNo, branchId: order.branchId, amountIrr: irrFromLegacyToman(order.total), createdAt: order.createdAt })) }, req.query));
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
    const state = ensureFinanceV2(getDb()); let rows = [...state.approvals]; if (req.query.status) rows = rows.filter((row) => row.status === req.query.status);
    rows.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)); const result = page(rows, req.query); res.json(envelope(result.rows, req.query, { pagination: result }));
  }));
  app.post('/api/admin/v2/finance/approvals/:id/decision', requireCapability('finance.approve'), guard(async (req, res) => {
    const key = String(req.get('Idempotency-Key') || '').trim();
    if (!key) throw Object.assign(new Error('کلید Idempotency-Key الزامی است.'), { code: 'idempotency_key_required', status: 400 });
    const role = effectiveRole(req.user); if (!['owner', 'manager'].includes(role)) throw Object.assign(new Error('تأیید فقط برای مالک یا مدیر مالی مجاز است.'), { code: 'finance_approver_required', status: 403 });
    const db = getDb(); const state = ensureFinanceV2(db); const replay = state.idempotency[key];
    if (replay) return res.json(envelope({ approval: state.approvals.find((approval) => approval.id === replay.id), idempotentReplay: true }, req.query));
    const result = decideApproval(db, req.params.id, String(req.body?.decision || ''), req.user.phone, req.body?.comment);
    state.idempotency[key] = { kind: 'approval_decision', id: result.approval.id, at: now() }; await save({ requireDurable: true }); res.json(envelope({ ...result, idempotentReplay: false }, req.query));
  }));
  app.get('/api/admin/v2/finance/search', requireCapability('finance.view'), guard((req, res) => {
    const db = getDb(); const state = ensureFinanceV2(db); const term = String(req.query.q || '').trim().toLowerCase();
    if (term.length < 2) return res.json(envelope([], req.query));
    const matches = [];
    list(db.orders).forEach((row) => { if (`${row.id} ${row.orderNo || ''} ${row.total || ''}`.toLowerCase().includes(term)) matches.push({ kind: 'order', id: row.id, label: row.orderNo || `سفارش ${row.id}`, amountIrr: irrFromLegacyToman(row.total) }); });
    state.journalEntries.forEach((row) => { if (`${row.id} ${row.number} ${row.description} ${row.debitIrr}`.toLowerCase().includes(term)) matches.push({ kind: 'journal_entry', id: row.id, label: row.number, amountIrr: row.debitIrr }); });
    list(db.accounting?.vendors).forEach((row) => { if (`${row.id} ${row.name || ''} ${row.nameFa || ''} ${row.balance || ''}`.toLowerCase().includes(term)) matches.push({ kind: 'vendor', id: row.id, label: row.nameFa || row.name, amountIrr: irrFromLegacyToman(row.balance) }); });
    res.json(envelope(matches.slice(0, 50), req.query));
  }));
}

module.exports = {
  registerFinanceV2Routes,
  ensureFinanceV2,
  capturePaidOrder,
  captureOrderCogs,
  captureOnlinePaidOrder,
  createPurchaseOrderV2,
  submitPurchaseOrderV2,
  receiveGoodsV2,
  createVendorInvoiceV2,
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
  recordBankStatementLine,
  matchBankStatementLine,
  captureCashMovement,
  captureCashClose,
  recordInventoryOperationV2,
  reverseInventoryOperationV2,
  resolveEvent,
  classifyAndArchiveLegacy,
  decideLegacyArchive,
  legacyArchiveSummary,
  legacyOrderBackfillPreview,
  requestLegacyOrderBackfill,
  recordEvent,
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
  purchasesPayables,
  costingInventory,
  kitchenInventory,
  actualBreakEvenFromLedger,
  plannedBreakEvenFromCommitments,
  ledgerClose,
  financialReports,
  salesLines,
  envelope,
  __test: { irrFromLegacyToman, normalizeTenderRows, assertBalanced, periodForDate },
};
