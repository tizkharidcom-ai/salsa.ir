'use strict';

/**
 * WESTO Finance — POS Sales Ingestion, Tips, Splits & Refunds Engine
 * High-performance, idempotent sales ingestion with:
 * 1. Idempotency & Replay Protection (Zero duplicated journal entries)
 * 2. Immutable Tax Snapshotting
 * 3. Split Payment Allocation (Multi-payment methods in single check)
 * 4. Pass-through Tip Liability Accounting (CR 2300)
 * 5. Partial & Full Refund Workflows with proportional VAT adjustment
 */

const crypto = require('crypto');
const { toEnDigits, formatNumber } = require('../../../platform_core/server/finance/money.js');
const taxEngine = require('../../../accounting/server/finance/tax-engine.js');
const auditEngine = require('../../../platform_core/server/finance/audit-engine.js');

function ensureSalesPOS(db) {
  if (!Array.isArray(db.posSales)) db.posSales = [];
  if (!Array.isArray(db.posRefunds)) db.posRefunds = [];
  return { posSales: db.posSales, posRefunds: db.posRefunds };
}

const TENDER_ACCOUNTS = Object.freeze({
  CASH: '1110',
  CARD: '1320',
  POS: '1320',
  MANUAL_CARD: '1320',
  CARD_ON_FILE: '1320',
  ONLINE: '1310',
  GATEWAY: '1310',
  ONLINE_GATEWAY: '1310',
  WALLET: '2500',
  USER_WALLET: '2500',
  CUSTOMER_WALLET: '2500',
  SNAPPFOOD: '1410',
  TAPSI: '1420',
  TAPSIFOOD: '1420',
  DELIVERY_PLATFORM: '1410',
  CREDIT: '1510',
  CUSTOMER_CREDIT: '1510',
  STAFF_CREDIT: '1510',
  VIP_CREDIT: '1510',
  GIFT_CARD: '2400',
  BANK: '1210',
  TRANSFER: '1210',
});

const PAID_SALE_STATES = new Set(['paid', 'completed', 'captured', 'settled']);
const CANCELLED_SALE_STATES = new Set(['cancelled', 'canceled', 'void', 'voided']);

function financeError(code, message, details) {
  const error = new Error(message);
  error.code = code;
  if (details) error.details = details;
  return error;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value === undefined ? null : value);
}

function payloadHash(value) {
  return crypto.createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function firstValue(input, keys, fallback) {
  for (const key of keys) {
    if (input && input[key] !== undefined && input[key] !== null && input[key] !== '') return input[key];
  }
  return fallback;
}

function booleanFlag(value, code, label) {
  if (value === undefined || value === null) return false;
  if (typeof value === 'boolean') return value;
  if (value === 0 || value === 1) return Boolean(value);
  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  throw financeError(code, `${label} باید true یا false باشد.`);
}

function integerMoney(value, code, label, { allowZero = true } = {}) {
  if (value === null || value === undefined || value === '') {
    if (allowZero) return 0;
    throw financeError(code, `${label} الزامی است.`);
  }
  let numberValue;
  if (typeof value === 'number') {
    numberValue = value;
  } else {
    const normalized = toEnDigits(String(value)).replace(/[,_\s]/g, '');
    if (!/^-?\d+$/.test(normalized)) throw financeError(code, `${label} باید عدد صحیح ریالی باشد.`);
    numberValue = Number(normalized);
  }
  if (!Number.isSafeInteger(numberValue)) throw financeError(code, `${label} باید عدد صحیح ریالی در محدودهٔ امن باشد.`);
  if (!allowZero && numberValue <= 0) throw financeError(code, `${label} باید بیشتر از صفر باشد.`);
  return numberValue;
}

function positiveBranch(value) {
  const branchId = integerMoney(value, 'branch_invalid', 'شناسه شعبه', { allowZero: false });
  return branchId;
}

function normalizedTender(value, code = 'payment_method_invalid') {
  const method = String(value || '').trim().toUpperCase();
  if (!TENDER_ACCOUNTS[method]) throw financeError(code, `روش پرداخت «${method || 'نامشخص'}» پشتیبانی نمی‌شود.`);
  return method;
}

function assertSaleState(saleInput) {
  const paymentStates = ['payment_status', 'paymentStatus']
    .map((key) => saleInput[key])
    .filter((value) => value !== undefined && value !== null && value !== '')
    .map((value) => String(value).trim().toLowerCase());
  const orderStates = ['status']
    .map((key) => saleInput[key])
    .filter((value) => value !== undefined && value !== null && value !== '')
    .map((value) => String(value).trim().toLowerCase());
  const states = [...paymentStates, ...orderStates];
  if (states.some((state) => CANCELLED_SALE_STATES.has(state))) {
    throw financeError('sale_cancelled', 'سفارش لغوشده قابل ثبت به‌عنوان فروش قطعی نیست.');
  }
  if (!states.length) {
    throw financeError('sale_not_paid', 'وضعیت پرداخت سفارش برای ثبت فروش POS الزامی است.');
  }
  if (paymentStates.length
    ? paymentStates.some((state) => !PAID_SALE_STATES.has(state))
    : orderStates.some((state) => !PAID_SALE_STATES.has(state))) {
    throw financeError('sale_not_paid', 'فقط سفارش پرداخت‌شده/قطعی قابل ثبت در فروش POS است.');
  }
}

function branchOf(row) {
  return Number(row?.branch_id ?? row?.branchId ?? 1);
}

function assertBalancedIntegerLines(lines, source) {
  const debit = lines.reduce((sum, line) => sum + line.debit, 0);
  const credit = lines.reduce((sum, line) => sum + line.credit, 0);
  if (!Number.isSafeInteger(debit) || !Number.isSafeInteger(credit) || debit <= 0 || debit !== credit) {
    throw financeError('journal_unbalanced', `سند ${source} تراز نیست.`, { debit, credit });
  }
}

/**
 * Ingests a POS Sale event idempotently and generates balanced GL journal entries.
 */
function ingestPOSSale(db, saleInput, opts = {}) {
  const { postJournalFn, ensureAccountingDataFn } = opts;
  if (!saleInput || typeof saleInput !== 'object' || Array.isArray(saleInput)) {
    throw financeError('sale_input_invalid', 'بدنه فروش POS معتبر نیست.');
  }
  const { posSales } = ensureSalesPOS(db);
  const acc = ensureAccountingDataFn ? ensureAccountingDataFn(db) : (db.accounting || {});

  const externalId = String(firstValue(saleInput, ['external_id', 'externalId', 'orderNo', 'id'], '')).trim();
  if (!externalId) {
    throw financeError('sale_external_id_required', 'فیلد شناسه یکتای فروش (external_id) الزامی است.');
  }

  const legalEntityId = String(firstValue(saleInput, ['legal_entity_id', 'legalEntityId'], 'le_default')).trim() || 'le_default';
  const rawBranchId = firstValue(saleInput, ['branch_id', 'branchId'], saleInput.branch?.id ?? 1);
  const branchId = positiveBranch(rawBranchId);
  const inputHash = payloadHash(saleInput);

  // 1. Idempotency Check
  const existingSale = posSales.find((s) => s.external_id === externalId
    && s.legal_entity_id === legalEntityId && branchOf(s) === branchId);
  if (existingSale) {
    if (existingSale.payload_hash && existingSale.payload_hash !== inputHash) {
      throw financeError('idempotency_key_payload_mismatch', 'تلاش تکراری با بدنه متفاوت برای همین شناسه فروش رد شد.');
    }
    return {
      ok: true,
      idempotentReplay: true,
      sale: existingSale,
      message: 'این تراکنش قبلاً با موفقیت پردازش و ثبت شده است.',
    };
  }

  assertSaleState(saleInput);

  // 2. Validate Lines & Calculate Tax Snapshot
  const lines = Array.isArray(saleInput.lines) && saleInput.lines.length > 0
    ? saleInput.lines
    : [{
        menu_item_id: 'generic',
        quantity: 1,
        unit_price_irr: integerMoney(firstValue(saleInput.totals, ['gross_irr'], firstValue(saleInput, ['total'], 0)), 'sale_amount_invalid', 'مبلغ ناخالص فروش'),
        gross_amount_irr: integerMoney(firstValue(saleInput.totals, ['gross_irr'], firstValue(saleInput, ['total'], 0)), 'sale_amount_invalid', 'مبلغ ناخالص فروش'),
        discount_irr: integerMoney(firstValue(saleInput.totals, ['discount_irr'], firstValue(saleInput, ['discount'], 0)), 'discount_amount_invalid', 'مبلغ تخفیف'),
      }];

  const occurredAt = saleInput.occurred_at || new Date().toISOString();
  const businessDate = saleInput.business_date || occurredAt.slice(0, 10);
  const channel = String(firstValue(saleInput, ['channel', 'fulfillmentType'], 'DINE_IN')).trim().toUpperCase() || 'DINE_IN';
  const taxSettings = acc.taxSettings || taxEngine.ensureTaxSettings({});

  const taxCalc = taxEngine.calculateTax(taxSettings, lines.map((l) => ({
    ...l,
    quantity: firstValue(l, ['quantity', 'qty'], 1),
    unitPrice: firstValue(l, ['unit_price_irr', 'unitPrice', 'price'], 0),
    discount: firstValue(l, ['discount_irr', 'discount'], 0),
    taxCategory: firstValue(l, ['tax_code', 'taxCategory'], taxSettings.defaultCategory || 'standard_1405'),
  })), {
    date: occurredAt,
    fulfillmentType: channel,
    locationId: branchId,
  });

  const grossSales = taxCalc.subtotalGross;
  const totalDiscounts = taxCalc.totalDiscounts;
  const taxableBase = taxCalc.totalTaxableBase;
  const totalTax = taxCalc.totalTax;
  const tipAmount = integerMoney(firstValue(saleInput, ['tip_irr', 'tip'], 0), 'tip_amount_invalid', 'مبلغ انعام');
  if (tipAmount < 0) throw financeError('tip_amount_invalid', 'مبلغ انعام نمی‌تواند منفی باشد.');
  const calculatedPayable = taxableBase + totalTax + tipAmount;
  if (!Number.isSafeInteger(calculatedPayable) || calculatedPayable <= 0) {
    throw financeError('sale_total_invalid', 'مبلغ قابل پرداخت فروش معتبر نیست.');
  }

  // 3. Validate Payments
  const rawPayments = Array.isArray(saleInput.payments) && saleInput.payments.length > 0
    ? saleInput.payments
    : [{
        method: firstValue(saleInput, ['paymentMethod', 'payment_method'], 'CARD'),
        amount_irr: calculatedPayable,
        provider: firstValue(saleInput, ['paymentProvider', 'payment_provider'], 'pos'),
      }];

  const payments = rawPayments.map((p, i) => {
    if (!p || typeof p !== 'object' || Array.isArray(p)) throw financeError('payment_invalid', 'ردیف پرداخت POS معتبر نیست.');
    return {
      id: String(p.id || `pay-${externalId}-${i + 1}`),
      method: normalizedTender(firstValue(p, ['method', 'tender'], 'CARD')),
      provider: p.provider || null,
      terminalId: p.terminal_id || p.terminalId || null,
      amount_irr: integerMoney(firstValue(p, ['amount_irr', 'amount'], 0), 'payment_amount_invalid', 'مبلغ پرداخت'),
      reference: p.reference || null,
    };
  });

  if (payments.some((payment) => payment.amount_irr <= 0)) {
    throw financeError('payment_amount_invalid', 'مبلغ هر روش پرداخت باید بیشتر از صفر باشد.');
  }
  if (new Set(payments.map((payment) => payment.id)).size !== payments.length) {
    throw financeError('payment_id_duplicate', 'شناسه پرداخت‌های split نباید تکراری باشد.');
  }
  const totalPaid = payments.reduce((sum, p) => sum + p.amount_irr, 0);
  if (!Number.isSafeInteger(totalPaid) || totalPaid !== calculatedPayable) {
    throw financeError('payment_total_mismatch', `جمع مبالغ پرداختی (${formatNumber(totalPaid)}) باید دقیقاً با مبلغ قابل پرداخت (${formatNumber(calculatedPayable)}) برابر باشد.`, {
      totalPaid,
      calculatedPayable,
    });
  }

  // 4. Construct Balanced Multi-Line Double-Entry Journal
  const journalLines = [];

  // Debit lines: One per payment method/clearing account
  payments.forEach((pay) => {
    const debitAccount = TENDER_ACCOUNTS[pay.method];

    journalLines.push({
      accountCode: debitAccount,
      debit: pay.amount_irr,
      credit: 0,
      memo: `دریافت وجه فروش ${externalId} (${pay.method})`,
      branchId,
    });
  });

  // Debit line: Discounts (if any)
  if (totalDiscounts > 0) {
    journalLines.push({
      accountCode: '4910', // Promotional Discounts
      debit: totalDiscounts,
      credit: 0,
      memo: `تخفیفات اعطایی فروش ${externalId}`,
      branchId,
    });
  }

  // Credit line: Gross Sales Revenue
  let salesAccount = '4110'; // Dine-in Food Sales
  if (channel === 'TAKEAWAY') salesAccount = '4120';
  else if (channel === 'DELIVERY') salesAccount = '4130';

  journalLines.push({
    accountCode: salesAccount,
    debit: 0,
    // Revenue excludes the tax component for both exclusive and inclusive
    // rules. Adding discounts back preserves the existing contra-discount
    // debit while keeping the journal balanced for inclusive prices.
    credit: taxableBase + totalDiscounts,
    memo: `درآمد فروش ناخالص ${externalId} (${channel})`,
    branchId,
  });

  // Credit line: Output VAT
  if (totalTax > 0) {
    journalLines.push({
      accountCode: '2210', // Output VAT Payable
      debit: 0,
      credit: totalTax,
      memo: `مالیات بر ارزش افزوده فروش ${externalId}`,
      branchId,
    });
  }

  // Credit line: Tips Payable (Pass-Through Liability)
  if (tipAmount > 0) {
    journalLines.push({
      accountCode: '2300', // Staff Tips Payable
      debit: 0,
      credit: tipAmount,
      memo: `انعام کارکنان فروش ${externalId}`,
      branchId,
    });
  }
  assertBalancedIntegerLines(journalLines, 'pos_sale');

  // 5. Post to General Ledger
  const postFn = postJournalFn || (acc.postJournalEntry ? acc.postJournalEntry.bind(acc, db) : null);
  let journalEntry = null;
  if (postFn) {
    journalEntry = postFn({
      source: 'pos_sale',
      sourceId: externalId,
      date: occurredAt,
      description: `ثبت فروش POS سفارش ${externalId} (${channel})`,
      lines: journalLines,
      createdById: saleInput.createdById || 'pos_terminal',
    });
    if (!journalEntry) throw financeError('ledger_post_failed', 'سند فروش POS ثبت نشد؛ رکورد فروش نیز ایجاد نشد.');
  } else if (opts.requireLedger) {
    throw financeError('ledger_posting_required', 'ثبت فروش POS بدون اتصال به دفتر کل مجاز نیست.');
  }

  // 6. Save Immutable Sale Record
  const posRecord = {
    id: `sale-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    external_id: externalId,
    legal_entity_id: legalEntityId,
    branch_id: branchId,
    terminal_id: saleInput.terminal_id || null,
    business_date: businessDate,
    occurred_at: occurredAt,
    channel,
    totals: {
      gross_irr: grossSales,
      discount_irr: totalDiscounts,
      taxable_base_irr: taxableBase,
      tax_irr: totalTax,
      tip_irr: tipAmount,
      payable_irr: calculatedPayable,
    },
    tax_snapshot: taxCalc.breakdown,
    lines: taxCalc.items,
    payments,
    status: 'COMPLETED',
    refunded_amount_irr: 0,
    journal_entry_id: journalEntry ? journalEntry.id : null,
    journal_number: journalEntry ? journalEntry.number : null,
    payload_hash: inputHash,
    created_at: new Date().toISOString(),
  };

  posSales.push(posRecord);

  auditEngine.recordAuditLog(acc, {
    action: 'INGEST_POS_SALE',
    entityType: 'POSSale',
    entityId: posRecord.id,
    userId: saleInput.createdById || 'pos_terminal',
    message: `فروش POS شماره ${externalId} به مبلغ ${formatNumber(calculatedPayable)} ریال با موفقیت ثبت شد.`,
    metadata: { externalId, totalPaid: calculatedPayable, journalNumber: journalEntry?.number },
  });

  return {
    ok: true,
    idempotentReplay: false,
    sale: posRecord,
    journalEntry,
  };
}

/**
 * Processes a Partial or Full Refund for an existing POS Sale.
 * Generates an inverted/proportional double entry without mutating the original sale.
 */
function refundPOSSale(db, saleExternalId, refundInput, opts = {}) {
  const { postJournalFn, ensureAccountingDataFn } = opts;
  if (!refundInput || typeof refundInput !== 'object' || Array.isArray(refundInput)) {
    throw financeError('refund_input_invalid', 'بدنه مرجوعی POS معتبر نیست.');
  }
  const { posSales, posRefunds } = ensureSalesPOS(db);
  const acc = ensureAccountingDataFn ? ensureAccountingDataFn(db) : (db.accounting || {});

  const requestedBranch = firstValue(refundInput, ['branch_id', 'branchId'], null);
  const branchId = requestedBranch == null ? null : positiveBranch(requestedBranch);
  const exactSale = posSales.find((s) => String(s.id) === String(saleExternalId));
  const saleMatches = exactSale
    ? [exactSale]
    : posSales.filter((s) => s.external_id === String(saleExternalId)
      && (branchId == null || branchOf(s) === branchId));
  if (saleMatches.length > 1) {
    throw financeError('refund_sale_ambiguous', 'شناسه فروش بین چند شعبه مشترک است؛ شناسه داخلی یا شعبه را مشخص کنید.');
  }
  const sale = saleMatches[0];
  if (!sale) {
    throw financeError('sale_not_found', `سفارش فروش با شناسه «${saleExternalId}» یافت نشد.`);
  }
  if (branchId != null && branchOf(sale) !== branchId) {
    throw financeError('refund_branch_mismatch', 'مرجوعی به شعبهٔ فروش متصل نیست.');
  }
  const refundKey = String(firstValue(refundInput, ['idempotency_key', 'idempotencyKey', 'refund_id'], '')).trim();
  const inputHash = payloadHash(refundInput);
  const existingRefund = refundKey
    ? posRefunds.find((row) => row.idempotency_key === refundKey && String(row.sale_id) === String(sale.id))
    : null;
  if (existingRefund) {
    if (existingRefund.payload_hash && existingRefund.payload_hash !== inputHash) {
      throw financeError('idempotency_key_payload_mismatch', 'تلاش تکراری مرجوعی با بدنه متفاوت رد شد.');
    }
    return { ok: true, idempotentReplay: true, refund: existingRefund, sale };
  }
  if (['CANCELLED', 'CANCELED', 'VOID', 'VOIDED'].includes(String(sale.status || '').toUpperCase())) {
    throw financeError('refund_cancelled_sale', 'برای سفارش لغوشده مرجوعی مالی ثبت نمی‌شود.');
  }
  const saleStatus = String(sale.status || '').trim().toUpperCase();
  if (!['COMPLETED', 'PARTIALLY_REFUNDED'].includes(saleStatus)) {
    throw financeError('refund_sale_not_paid', 'فقط فروش قطعی قابل مرجوعی است.');
  }

  const payable = integerMoney(sale.totals?.payable_irr, 'sale_total_invalid', 'مبلغ قابل پرداخت فروش');
  const gross = integerMoney(sale.totals?.gross_irr, 'sale_total_invalid', 'مبلغ ناخالص فروش');
  const discount = integerMoney(sale.totals?.discount_irr, 'sale_total_invalid', 'مبلغ تخفیف فروش');
  const tax = integerMoney(sale.totals?.tax_irr, 'sale_total_invalid', 'مبلغ مالیات فروش');
  const tip = integerMoney(sale.totals?.tip_irr, 'sale_total_invalid', 'مبلغ انعام فروش');
  const taxableBase = integerMoney(
    sale.totals?.taxable_base_irr ?? gross - discount,
    'sale_total_invalid',
    'پایه مشمول مالیات فروش',
  );
  if (payable <= 0 || gross < 0 || discount < 0 || tax < 0 || tip < 0 || gross < discount
    || taxableBase < 0 || taxableBase > gross - discount
    || taxableBase + tax + tip !== payable) {
    throw financeError('sale_totals_inconsistent', 'اجزای مبلغ فروش با مبلغ قابل پرداخت سازگار نیستند.');
  }
  const refundedAmount = integerMoney(sale.refunded_amount_irr ?? 0, 'refund_total_invalid', 'جمع مرجوعی قبلی');
  if (refundedAmount < 0 || refundedAmount > payable) {
    throw financeError('refund_total_invalid', 'جمع مرجوعی قبلی فروش معتبر نیست.');
  }
  const salePayments = Array.isArray(sale.payments) ? sale.payments : [];
  if (!salePayments.length) {
    throw financeError('sale_payments_invalid', 'فروش قابل مرجوعی باید حداقل یک روش پرداخت معتبر داشته باشد.');
  }
  const validatedSalePayments = salePayments.map((payment) => {
    if (!payment || typeof payment !== 'object' || Array.isArray(payment)) {
      throw financeError('sale_payments_invalid', 'روش پرداخت ذخیره‌شده فروش معتبر نیست.');
    }
    const method = normalizedTender(payment.method || payment.tender, 'payment_method_invalid');
    const amount = integerMoney(payment.amount_irr ?? payment.amount, 'payment_amount_invalid', 'مبلغ پرداخت');
    if (amount <= 0) throw financeError('payment_amount_invalid', 'مبلغ پرداخت ذخیره‌شده باید بیشتر از صفر باشد.');
    return { method, amount };
  });
  const storedPaymentTotal = validatedSalePayments.reduce((sum, payment) => sum + payment.amount, 0);
  if (!Number.isSafeInteger(storedPaymentTotal) || storedPaymentTotal !== payable) {
    throw financeError('sale_payments_inconsistent', 'جمع روش‌های پرداخت فروش با مبلغ قابل پرداخت برابر نیست.');
  }
  const priorRefunds = posRefunds.filter((row) => String(row.sale_id) === String(sale.id));
  let priorRefundTotal = 0;
  let priorTax = 0;
  let priorTip = 0;
  for (const row of priorRefunds) {
    const amount = integerMoney(row.refund_amount_irr, 'refund_total_invalid', 'مبلغ مرجوعی قبلی');
    const rowTax = integerMoney(row.tax_refund_irr, 'refund_tax_invalid', 'مالیات مرجوعی قبلی');
    const rowTip = integerMoney(row.tip_refund_irr, 'refund_tip_invalid', 'انعام مرجوعی قبلی');
    const rowNet = integerMoney(row.net_sales_refund_irr, 'refund_net_invalid', 'خالص مرجوعی قبلی');
    if (amount <= 0 || rowTax < 0 || rowTip < 0 || rowNet < 0 || rowTax + rowTip + rowNet !== amount) {
      throw financeError('refund_state_inconsistent', 'سوابق مرجوعی قبلی با مبلغ ثبت‌شده سازگار نیستند.');
    }
    normalizedTender(row.refund_method, 'refund_method_invalid');
    priorRefundTotal += amount;
    priorTax += rowTax;
    priorTip += rowTip;
  }
  if (!Number.isSafeInteger(priorRefundTotal) || priorRefundTotal !== refundedAmount) {
    throw financeError('refund_state_inconsistent', 'جمع مرجوعی‌های قبلی با خلاصه فروش برابر نیست.');
  }
  const requestedAmount = integerMoney(firstValue(refundInput, ['amount_irr', 'amount'], payable), 'refund_amount_invalid', 'مبلغ مرجوعی');
  const remainingRefundable = payable - refundedAmount;

  if (requestedAmount <= 0 || requestedAmount > remainingRefundable) {
    throw financeError('refund_total_exceeds_sale', `مبلغ مرجوعی (${formatNumber(requestedAmount)}) نامعتبر است یا از مانده قابل مرجوعی (${formatNumber(remainingRefundable)}) بیشتر است.`);
  }

  const suppliedRefundMethod = firstValue(refundInput, ['refund_method', 'refundMethod'], null);
  if (!suppliedRefundMethod && salePayments.length > 1) {
    throw financeError('refund_tender_required', 'برای فروش split باید روش پرداخت مرجوعی مشخص شود.');
  }
  const refundMethod = normalizedTender(suppliedRefundMethod || salePayments[0]?.method || 'CASH', 'refund_method_invalid');
  const methodCeiling = validatedSalePayments
    .filter((payment) => payment.method === refundMethod)
    .reduce((sum, payment) => sum + payment.amount, 0);
  const priorMethodRefunded = posRefunds
    .filter((row) => String(row.sale_id) === String(sale.id)
      && String(row.refund_method || '').toUpperCase() === refundMethod)
    .reduce((sum, row) => sum + integerMoney(row.refund_amount_irr, 'refund_total_invalid', 'مبلغ مرجوعی قبلی'), 0);
  if (methodCeiling <= 0 || priorMethodRefunded + requestedAmount > methodCeiling) {
    throw financeError('refund_tender_ceiling_exceeded', 'مبلغ مرجوعی از سقف پرداخت همان روش بیشتر است.');
  }

  const createdById = String(refundInput.createdById || refundInput.created_by || 'admin');
  const approvedBy = String(firstValue(refundInput, ['approved_by', 'approvedBy'], '')).trim();
  const requestedApproval = booleanFlag(
    firstValue(refundInput, ['requires_approval', 'requiresApproval'], null),
    'refund_approval_invalid',
    'درخواست تأیید مرجوعی',
  );
  const suppliedApprovalStatus = String(firstValue(refundInput, ['approval_status', 'approvalStatus'], '')).trim().toUpperCase();
  const approvalStatus = suppliedApprovalStatus || (approvedBy ? 'APPROVED' : 'NOT_REQUIRED');
  if (requestedApproval && approvalStatus !== 'APPROVED') {
    throw financeError('refund_approval_required', 'مرجوعی قبل از ثبت قطعی باید تأیید مستقل شود.');
  }
  if (approvalStatus !== 'NOT_REQUIRED' && approvalStatus !== 'APPROVED') {
    throw financeError('refund_approval_invalid', 'وضعیت تأیید مرجوعی معتبر نیست.');
  }
  if (approvalStatus === 'APPROVED' && !approvedBy) {
    throw financeError('refund_approver_required', 'شناسه تأییدکننده مرجوعی الزامی است.');
  }
  if (approvalStatus === 'APPROVED' && approvedBy === createdById) {
    throw financeError('refund_approval_segregation', 'ثبت‌کننده نمی‌تواند تأییدکننده همان مرجوعی باشد.');
  }

  // Calculate cumulative proportional VAT/tip and make the sales reversal the
  // balancing residual. This prevents one-rial drift across partial refunds.
  const cumulativeRefund = refundedAmount + requestedAmount;
  const cumulativeTax = cumulativeRefund === payable ? tax : Math.round(tax * cumulativeRefund / payable);
  const cumulativeTip = cumulativeRefund === payable ? tip : Math.round(tip * cumulativeRefund / payable);
  const reversedTax = cumulativeTax - priorTax;
  const reversedTip = cumulativeTip - priorTip;
  const reversedNet = requestedAmount - reversedTax - reversedTip;
  if (reversedTax < 0 || reversedTip < 0 || reversedNet < 0) {
    throw financeError('refund_proportional_allocation_invalid', 'تسهیم مالیات و انعام مرجوعی معتبر نیست.');
  }

  const creditAccount = TENDER_ACCOUNTS[refundMethod];

  const refundId = `ref-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const reason = refundInput.reason || 'مرجوعی مشتری';

  // Construct Balanced Reversal Double Entry
  const refundJournalLines = [
    // Debit: Sales Refund / Contra Revenue
    ...(reversedNet > 0 ? [{
      accountCode: '4940', // Customer Refunds
      debit: reversedNet,
      credit: 0,
      memo: `برگشت از فروش سفارش ${sale.external_id} (${reason})`,
      branchId: branchOf(sale),
    }] : []),
    // Debit: VAT Payable Reversal
    ...(reversedTax > 0 ? [{
      accountCode: '2210',
      debit: reversedTax,
      credit: 0,
      memo: `تعدیل و استرداد مالیات ارزش افزوده مرجوعی ${sale.external_id}`,
      branchId: branchOf(sale),
    }] : []),
    // Debit: Tip Payable Reversal (if tip was refunded)
    ...(reversedTip > 0 ? [{
      accountCode: '2300',
      debit: reversedTip,
      credit: 0,
      memo: `استرداد انعام سفارش ${sale.external_id}`,
      branchId: branchOf(sale),
    }] : []),
    // Credit: Payment / Cash Payout
    {
      accountCode: creditAccount,
      debit: 0,
      credit: requestedAmount,
      memo: `پرداخت وجه مرجوعی سفارش ${sale.external_id} به مشتری`,
      branchId: branchOf(sale),
    },
  ];
  assertBalancedIntegerLines(refundJournalLines, 'pos_refund');

  const postFn = postJournalFn || (acc.postJournalEntry ? acc.postJournalEntry.bind(acc, db) : null);
  let refundJournal = null;
  if (postFn) {
    refundJournal = postFn({
      source: 'pos_refund',
      sourceId: refundId,
      date: new Date().toISOString(),
      description: `ثبت مرجوعی سفارش ${sale.external_id}: ${reason}`,
      lines: refundJournalLines,
      createdById: refundInput.createdById || 'admin',
    });
    if (!refundJournal) throw financeError('ledger_post_failed', 'سند مرجوعی POS ثبت نشد؛ رکورد مرجوعی نیز ایجاد نشد.');
  } else if (opts.requireLedger) {
    throw financeError('ledger_posting_required', 'ثبت مرجوعی POS بدون اتصال به دفتر کل مجاز نیست.');
  }

  // Update Sale Summary
  sale.refunded_amount_irr = refundedAmount + requestedAmount;
  sale.status = sale.refunded_amount_irr >= payable ? 'FULLY_REFUNDED' : 'PARTIALLY_REFUNDED';

  const refundRecord = {
    id: refundId,
    sale_id: sale.id,
    external_id: sale.external_id,
    refund_amount_irr: requestedAmount,
    reason,
    refund_method: refundMethod,
    approval_status: approvalStatus,
    approved_by: approvedBy || null,
    tax_refund_irr: reversedTax,
    tip_refund_irr: reversedTip,
    net_sales_refund_irr: reversedNet,
    idempotency_key: refundKey || null,
    payload_hash: inputHash,
    inventory_effect: 'none_financial_refund_only',
    journal_entry_id: refundJournal ? refundJournal.id : null,
    journal_number: refundJournal ? refundJournal.number : null,
    created_at: new Date().toISOString(),
  };

  posRefunds.push(refundRecord);

  auditEngine.recordAuditLog(acc, {
    action: 'REFUND_POS_SALE',
    entityType: 'POSRefund',
    entityId: refundId,
    userId: createdById,
    message: `مرجوعی سفارش ${sale.external_id} به مبلغ ${formatNumber(requestedAmount)} ریال ثبت گردید. علت: ${reason}`,
    metadata: { refundId, amount: requestedAmount, reason, journalNumber: refundJournal?.number, approvalStatus, branchId: branchOf(sale) },
  });

  return {
    ok: true,
    idempotentReplay: false,
    refund: refundRecord,
    sale,
    journalEntry: refundJournal,
  };
}

/**
 * Generates and closes a Daily Z-Report for a branch.
 */
function generateZReport(db, input = {}, opts = {}) {
  const { postJournalFn, ensureAccountingDataFn } = opts;
  const acc = ensureAccountingDataFn ? ensureAccountingDataFn(db) : (db.accounting || {});
  if (!Array.isArray(acc.zReports)) acc.zReports = [];

  const branchId = Number(input.branchId || 1);
  const businessDate = input.businessDate || new Date().toISOString().slice(0, 10);
  const openingCash = Number(input.openingCash || 0);
  const actualCashCounted = input.actualCashCounted == null ? null : Number(input.actualCashCounted);
  const orders = Array.isArray(db.orders) ? db.orders : [];

  const dayOrders = orders.filter((o) => {
    const oDate = (o.createdAt || o.paidAt || '').slice(0, 10);
    const oBranch = Number(o.branchId || 1);
    const paid = o.paymentStatus !== 'unpaid' && o.paymentStatus !== 'pending' && (o.paymentStatus === 'paid' || ['paid', 'preparing', 'ready', 'done', 'delivered', 'picked_up'].includes(String(o.status || '')));
    return paid && oDate === businessDate && (oBranch === branchId || !branchId);
  });

  const totalGrossSales = dayOrders.reduce((s, o) => s + Number(o.total || 0), 0);
  const totalDiscounts = dayOrders.reduce((s, o) => s + Number(o.discount || 0), 0);
  const totalNetSales = Math.max(0, totalGrossSales - totalDiscounts);
  const taxRows = dayOrders.filter((order) => order.taxAmount != null || order.tax != null || order.vatAmount != null);
  const tipRows = dayOrders.filter((order) => order.tip != null || order.tipAmount != null);
  const totalVat = taxRows.length === dayOrders.length ? taxRows.reduce((sum, order) => sum + Number(order.taxAmount ?? order.tax ?? order.vatAmount ?? 0), 0) : null;
  const totalTips = tipRows.length === dayOrders.length ? tipRows.reduce((sum, order) => sum + Number(order.tip ?? order.tipAmount ?? 0), 0) : null;
  const tenders = { cash: 0, card: 0, online: 0, snappfood: 0 };
  let tenderCoveredOrders = 0;
  dayOrders.forEach((order) => {
    const rows = Array.isArray(order.partialPayments) && order.partialPayments.length
      ? order.partialPayments
      : (order.paymentTender || order.paymentMethod) ? [{ tender: order.paymentTender || order.paymentMethod, amount: order.total }] : [];
    if (!rows.length) return;
    const accepted = rows.every((row) => ['cash', 'card', 'manual_card', 'online', 'gateway', 'snappfood', 'snapp_food'].includes(String(row.tender || row.method || '').toLowerCase()));
    if (!accepted) return;
    tenderCoveredOrders += 1;
    rows.forEach((row) => {
      const tender = String(row.tender || row.method || '').toLowerCase();
      const key = tender === 'cash' ? 'cash' : ['card', 'manual_card'].includes(tender) ? 'card' : ['snappfood', 'snapp_food'].includes(tender) ? 'snappfood' : 'online';
      tenders[key] += Number(row.amount || 0);
    });
  });

  const cashSales = input.cashSales != null ? Number(input.cashSales) : tenders.cash;
  const posCardSales = input.posCardSales != null ? Number(input.posCardSales) : tenders.card;
  const onlineSales = input.onlineSales != null ? Number(input.onlineSales) : tenders.online;
  const snappFoodSales = input.snappFoodSales != null ? Number(input.snappFoodSales) : tenders.snappfood;

  const cashPayouts = Number(input.cashPayouts || 0);
  const expectedCash = openingCash + cashSales - cashPayouts;
  const cashVariance = actualCashCounted == null ? null : actualCashCounted - expectedCash;
  const dataQuality = {
    status: dayOrders.length && tenderCoveredOrders === dayOrders.length && totalVat != null && totalTips != null && actualCashCounted != null ? 'verified' : 'insufficient_data',
    paidOrders: dayOrders.length,
    tenderCoveredOrders,
    taxCoveredOrders: taxRows.length,
    tipCoveredOrders: tipRows.length,
    actualCashCounted: actualCashCounted != null,
  };

  const zNumber = `Z-${businessDate.replace(/-/g, '')}-${String(acc.zReports.length + 1).padStart(3, '0')}`;
  const zId = `zrep-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  const postFn = postJournalFn || (acc.postJournalEntry ? acc.postJournalEntry.bind(acc, db) : null);
  let zJournal = null;

  if (postFn && totalGrossSales > 0 && dataQuality.status === 'verified') {
    const lines = [
      ...(actualCashCounted > 0 ? [{ accountCode: '1110', debit: actualCashCounted, credit: 0, memo: `صندوق نقدی پایان شیفت ${zNumber}`, branchId }] : []),
      ...(posCardSales > 0 ? [{ accountCode: '1320', debit: posCardSales, credit: 0, memo: `تسویه کارتخوان‌های سالن ${zNumber}`, branchId }] : []),
      ...(onlineSales > 0 ? [{ accountCode: '1310', debit: onlineSales, credit: 0, memo: `درگاه آنلاین ${zNumber}`, branchId }] : []),
      ...(snappFoodSales > 0 ? [{ accountCode: '1410', debit: snappFoodSales, credit: 0, memo: `مطالبات اسنپ‌فود ${zNumber}`, branchId }] : []),
      ...(cashVariance != null && cashVariance < 0 ? [{ accountCode: '5500', debit: Math.abs(cashVariance), credit: 0, memo: `کسری صندوق ${zNumber}`, branchId }] : []),
      { accountCode: '4110', debit: 0, credit: Math.round(totalNetSales * 0.65), memo: `فروش غذا ${zNumber}`, branchId },
      { accountCode: '4210', debit: 0, credit: Math.round(totalNetSales * 0.35), memo: `فروش بار و نوشیدنی ${zNumber}`, branchId },
      ...(totalVat > 0 ? [{ accountCode: '2210', debit: 0, credit: totalVat, memo: `مالیات ارزش افزوده ${zNumber}`, branchId }] : []),
      ...(totalTips > 0 ? [{ accountCode: '2300', debit: 0, credit: totalTips, memo: `انعام کارکنان ${zNumber}`, branchId }] : []),
      ...(openingCash > 0 ? [{ accountCode: '1110', debit: 0, credit: openingCash, memo: `موجودی ابتدای شیفت ${zNumber}`, branchId }] : []),
      ...(cashVariance != null && cashVariance > 0 ? [{ accountCode: '4500', debit: 0, credit: cashVariance, memo: `مازاد صندوق ${zNumber}`, branchId }] : []),
    ];

    try {
      zJournal = postFn({
        source: 'z_report',
        sourceId: zId,
        date: new Date().toISOString(),
        description: `بستن شیفت و صدور گزارش رسمی Z روزانه ${zNumber}`,
        lines,
        createdById: input.createdById || 'cashier',
      });
    } catch (_) {}
  }

  const zReport = {
    id: zId,
    zNumber,
    branchId,
    businessDate,
    shift: input.shiftName || 'عصر / شام',
    closedAt: new Date().toISOString(),
    closedBy: input.closedBy || 'مدیر سالن / صندوقدار',
    openingCash,
    cashSales,
    posCardSales,
    onlineSales,
    snappFoodSales,
    cashPayouts,
    expectedCash,
    actualCashCounted,
    cashVariance,
    checksCount: dayOrders.length,
    guestsCount: dayOrders.length > 0 && dayOrders.every((order) => order.guestsCount != null || order.guestCount != null)
      ? dayOrders.reduce((sum, order) => sum + Number(order.guestsCount ?? order.guestCount ?? 0), 0) : null,
    totalGrossSales,
    totalDiscounts,
    totalNetSales,
    totalVat,
    totalTips,
    journalEntryId: zJournal ? zJournal.id : null,
    journalNumber: zJournal ? zJournal.number : null,
    status: dataQuality.status === 'verified' ? 'CLOSED' : 'INSUFFICIENT_DATA',
    dataQuality,
    notes: input.notes || '',
  };

  acc.zReports.unshift(zReport);
  return zReport;
}

/**
 * Calculates essential Cafe & Restaurant KPIs.
 */
function calculateRestaurantKPIs(db, opts = {}) {
  const branchId = opts.branchId ? Number(opts.branchId) : null;
  const orders = Array.isArray(db.orders) ? db.orders : [];
  const validOrders = orders.filter((o) => (!branchId || Number(o.branchId) === branchId)
    && o.paymentStatus !== 'unpaid' && o.paymentStatus !== 'pending'
    && (o.paymentStatus === 'paid' || ['paid', 'preparing', 'ready', 'done', 'delivered', 'picked_up'].includes(String(o.status || ''))));

  const totalRevenue = validOrders.reduce((sum, o) => sum + Number(o.total || 0), 0);
  const totalChecks = validOrders.length;
  const averageCheck = totalChecks ? Math.round(totalRevenue / totalChecks) : null;
  const buckets = [
    { name: 'صبحانه و برانچ (۸ الی ۱۲)', from: 8, to: 12, revenue: 0, orders: 0 },
    { name: 'ناهار کاری و سالن (۱۲ الی ۱۶)', from: 12, to: 16, revenue: 0, orders: 0 },
    { name: 'عصرانه و بار کافه (۱۶ الی ۱۹)', from: 16, to: 19, revenue: 0, orders: 0 },
    { name: 'شام و سفارش‌های شب (۱۹ الی ۲۴)', from: 19, to: 24, revenue: 0, orders: 0 },
  ];
  validOrders.forEach((order) => {
    const hour = new Date(order.paidAt || order.createdAt || '').getHours();
    const bucket = buckets.find((row) => Number.isFinite(hour) && hour >= row.from && hour < row.to);
    if (bucket) { bucket.revenue += Number(order.total || 0); bucket.orders += 1; }
  });
  const dayparts = buckets.map(({ from, to, ...row }) => ({ ...row, share: totalRevenue ? Math.round(row.revenue / totalRevenue * 10000) / 100 : null }));

  return {
    revenue: totalRevenue,
    checksCount: totalChecks,
    averageCheck,
    foodCost: null,
    foodCostPct: null,
    laborCost: null,
    laborCostPct: null,
    primeCost: null,
    primeCostPct: null,
    primeCostStatus: 'INSUFFICIENT_DATA',
    revPASH: null,
    dayparts,
    tableTurnover: null,
    status: totalChecks ? 'PARTIAL_COVERAGE' : 'INSUFFICIENT_DATA',
    missing: ['posted_cogs', 'posted_payroll', 'available_seat_hours', 'table_sessions'],
  };
}

/**
 * Distributes accumulated tip pool among active shift staff.
 */
function distributeTipPool(db, input = {}, opts = {}) {
  const { postJournalFn, ensureAccountingDataFn } = opts;
  const acc = ensureAccountingDataFn ? ensureAccountingDataFn(db) : (db.accounting || {});
  if (!Array.isArray(acc.tipDistributions)) acc.tipDistributions = [];

  const branchId = Number(input.branchId || 1);
  const totalTips = Number(input.totalTips || 0);
  const staffList = Array.isArray(input.staff) ? input.staff : [];

  if (totalTips <= 0) throw new Error('مبلغ انعام برای توزیع باید بیشتر از صفر باشد.');
  if (staffList.length === 0) throw new Error('لیست پرسنل دریافت‌کننده انعام الزامی است.');

  const totalPoints = staffList.reduce((s, st) => s + (Number(st.hours || 1) * Number(st.roleMultiplier || 1)), 0) || 1;
  const pointValue = Math.floor(totalTips / totalPoints);

  const allocations = staffList.map((st) => {
    const points = Number(st.hours || 1) * Number(st.roleMultiplier || 1);
    const amount = Math.floor(points * pointValue);
    return {
      staffId: st.id || st.name,
      name: st.name,
      role: st.role || 'گارسون',
      hours: Number(st.hours || 8),
      roleMultiplier: Number(st.roleMultiplier || 1),
      points,
      amount,
    };
  });

  const distId = `tipdist-${Date.now()}`;
  const record = {
    id: distId,
    branchId,
    businessDate: input.businessDate || new Date().toISOString().slice(0, 10),
    totalTips,
    totalPoints,
    pointValue,
    allocations,
    distributedBy: input.distributedBy || 'مدیر سالن',
    distributedAt: new Date().toISOString(),
  };

  acc.tipDistributions.unshift(record);
  return record;
}

module.exports = {
  ensureSalesPOS,
  ingestPOSSale,
  refundPOSSale,
  generateZReport,
  calculateRestaurantKPIs,
  distributeTipPool,
};
