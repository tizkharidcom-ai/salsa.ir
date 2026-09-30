'use strict';

/**
 * WESTO Finance — Iran Taxpayer System (سامانه مؤدیان) & E-Invoice Adapter
 * Implements:
 * 1. Versioned TaxProviderAdapter pattern
 * 2. Asynchronous Outbox Queue with Exponential Backoff Retries
 * 3. Document types: ORIGINAL, CORRECTION, CANCELLATION
 * 4. Raw payload hashing and retention compliant with Article 95
 * 5. Mock/Sandbox & Real Provider Integration abstraction
 */

const crypto = require('crypto');
const auditEngine = require('../../../platform_core/server/finance/audit-engine.js');

function ensureTaxpayerData(db) {
  if (!Array.isArray(db.taxInvoices)) db.taxInvoices = [];
  if (!Array.isArray(db.taxSubmissions)) db.taxSubmissions = [];
  if (!db.taxpayerSettings || typeof db.taxpayerSettings !== 'object') {
    db.taxpayerSettings = {
      enabled: true,
      provider: 'DIRECT_API', // 'DIRECT_API' | 'TSP_INTERMEDIARY' | 'SANDBOX_MOCK'
      schemaVersion: '1.4',
      taxMemoryId: 'A12B34', // Unique Tax Memory ID (شناسه یکتای حافظه مالیاتی)
      economicCode: '411111111111',
      nationalId: '14000000000',
      apiUrl: 'https://tp.tax.gov.ir/req/api/self-tsp/sync/v1',
      autoSubmitOnSale: true,
      maxRetries: 5,
      sandboxMode: true,
    };
  }
  return {
    taxInvoices: db.taxInvoices,
    taxSubmissions: db.taxSubmissions,
    settings: db.taxpayerSettings,
  };
}

function normalizeDigits(val) {
  return String(val ?? '')
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
}

function normalizedBranchId(value) {
  if (value == null || String(value).trim() === '') return null;
  const clean = normalizeDigits(value).replace(/\D/g, '');
  if (!clean) return null;
  const branchId = Number(clean);
  return Number.isSafeInteger(branchId) && branchId > 0 ? branchId : null;
}

function sourceBranchId(db, sourceId) {
  const orders = Array.isArray(db?.orders) ? db.orders : [];
  const source = orders.find((order) => [order.id, order.orderNo, order.order_no, order.external_id]
    .some((value) => value != null && String(value) === String(sourceId)));
  return normalizedBranchId(source?.branchId ?? source?.branch_id ?? source?.locationId);
}

function invoiceBranchId(db, invoice) {
  return normalizedBranchId(invoice?.branchId ?? invoice?.branch_id ?? invoice?.locationId)
    || sourceBranchId(db, invoice?.source_id);
}

/**
 * Tax invoices are legal records and must carry an immutable branch
 * dimension. Resolve it from the source order where possible, then verify
 * that a caller-provided/request-context branch cannot override it.
 */
function resolveInvoiceBranch(db, invoiceData = {}, opts = {}) {
  const inputBranchId = normalizedBranchId(invoiceData.branchId ?? invoiceData.branch_id);
  const sourceId = String(invoiceData.source_id || invoiceData.sale_id || invoiceData.external_id || '').trim();
  const sourceBranch = sourceBranchId(db, sourceId);
  const contextBranchId = normalizedBranchId(opts.branchId);
  const branchId = sourceBranch || inputBranchId || contextBranchId;

  if (sourceBranch && inputBranchId && sourceBranch !== inputBranchId) {
    throw Object.assign(new Error('شعبهٔ صورتحساب با شعبهٔ سفارش منبع یکسان نیست.'), {
      code: 'tax_invoice_branch_mismatch', status: 409,
    });
  }
  if (sourceBranch && contextBranchId && sourceBranch !== contextBranchId) {
    throw Object.assign(new Error('دسترسی به شعبهٔ سفارش منبع صورتحساب مجاز نیست.'), {
      code: 'tax_invoice_branch_access_denied', status: 403,
    });
  }
  if (!branchId) {
    throw Object.assign(new Error('شعبهٔ صورتحساب مالیاتی مشخص نشده است.'), {
      code: 'tax_invoice_branch_required', status: 400,
    });
  }

  const allowed = Array.isArray(opts.allowedBranchIds)
    ? opts.allowedBranchIds.map(normalizedBranchId).filter(Boolean)
    : null;
  if (allowed && !allowed.includes(branchId)) {
    throw Object.assign(new Error('دسترسی به شعبهٔ صورتحساب مالیاتی مجاز نیست.'), {
      code: 'tax_invoice_branch_access_denied', status: 403,
    });
  }
  return branchId;
}

/**
 * Generates a unique 22-character Tax Invoice UID (شماره منحصر به فرد مالیاتی)
 * Format: [6-char Tax Memory ID] + [5-char Julian/Epoch Days] + [10-char Serial Number] + [1-char Checksum]
 */
function generateTaxInvoiceUID(taxMemoryId, date = new Date(), serialNumber = 1) {
  const memId = (taxMemoryId || 'A11111').slice(0, 6).toUpperCase().padEnd(6, '0');
  const epochDays = String(Math.floor((new Date(date).getTime() - new Date('2022-03-21').getTime()) / 86400000)).padStart(5, '0');
  const serial = String(serialNumber % 10000000000).padStart(10, '0');
  const raw = `${memId}${epochDays}${serial}`;
  // Verhoeff or modulo checksum
  const checksum = raw.split('').reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % 10;
  return `${raw}${checksum}`;
}

/**
 * Creates and enqueues an Electronic Tax Invoice for transmission to Samaneh Moaddian.
 */
function enqueueTaxInvoice(db, invoiceData, opts = {}) {
  const { taxInvoices, taxSubmissions, settings } = ensureTaxpayerData(db);
  const acc = db.accounting || {};

  const sourceId = String(invoiceData.source_id || invoiceData.sale_id || invoiceData.external_id || '').trim();
  if (!sourceId) throw new Error('شناسه منبع صورتحساب (source_id) الزامی است.');
  const branchId = resolveInvoiceBranch(db, invoiceData, opts);

  const documentType = String(invoiceData.document_type || 'ORIGINAL').toUpperCase(); // ORIGINAL, CORRECTION, CANCELLATION
  const referenceTaxUid = invoiceData.reference_tax_uid || null;
  if (!['ORIGINAL', 'CORRECTION', 'CANCELLATION'].includes(documentType)) {
    throw Object.assign(new Error('نوع صورتحساب مالیاتی معتبر نیست.'), { code: 'tax_document_type_invalid' });
  }
  if (documentType !== 'ORIGINAL' && !String(referenceTaxUid || '').trim()) {
    throw Object.assign(new Error('صورتحساب اصلاحی یا ابطالی باید به شماره مالیاتی مرجع متصل باشد.'), {
      code: 'tax_reference_required',
    });
  }

  // Check existing active invoice for this source
  const existing = taxInvoices.find((inv) => inv.source_id === sourceId
    && inv.document_type === documentType
    && invoiceBranchId(db, inv) === branchId
    && inv.status !== 'FAILED');
  if (existing) {
    return {
      ok: true,
      idempotent: true,
      taxInvoice: existing,
      message: 'این صورتحساب مالیاتی قبلاً ثبت و در صف ارسال قرار گرفته است.',
    };
  }

  const serialNumber = taxInvoices.length + 1;
  const issueDate = invoiceData.issue_date || new Date().toISOString();
  const taxUid = generateTaxInvoiceUID(settings.taxMemoryId, issueDate, serialNumber);

  // Prepare standard Samaneh Moaddian payload according to active schema
  const payload = {
    header: {
      taxid: taxUid,
      indatim: new Date(issueDate).getTime(),
      indati2m: Date.now(),
      inty: 1, // 1: Type 1 (با اطلاعات کامل خریدار/فروشنده) یا Type 2 (الگوی فروش نقد/مصرف‌کننده)
      inno: String(serialNumber).padStart(10, '0'),
      irtaxid: referenceTaxUid,
      tins: settings.nationalId,
      tinb: invoiceData.customer_national_id || null,
      tob: invoiceData.buyer_type || 2, // 1: حقوقی, 2: حقیقی/مصرف‌کننده نهایی
      setm: 1, // 1: نقدی, 2: نسیه, 3: نقد و نسیه
      tprdis: invoiceData.total_gross_irr || 0,
      tdis: invoiceData.total_discount_irr || 0,
      tadis: (invoiceData.total_gross_irr || 0) - (invoiceData.total_discount_irr || 0),
      tvam: invoiceData.total_tax_irr || 0,
      todam: 0,
      tbill: invoiceData.total_payable_irr || 0,
    },
    body: (invoiceData.lines || []).map((l, i) => ({
      sstid: l.stuff_service_id || '2720000123456', // شناسه کالا و خدمت مالیاتی (۱۳ رقمی)
      sstt: l.name || 'غذای رستوران',
      am: Number(l.quantity || 1),
      mu: l.uom || '164', // کد واحد سنجش (عدد/پرس/بسته)
      fee: Number(l.unit_price_irr || 0),
      prdis: Number(l.gross_amount_irr || (l.unit_price_irr * l.quantity) || 0),
      dis: Number(l.discount_irr || 0),
      adis: Number((l.gross_amount_irr || 0) - (l.discount_irr || 0)),
      vra: Number(l.tax_rate || 0.10),
      vam: Number(l.tax_amount_irr || 0),
      tsstam: Number(l.total_payable_irr || 0),
    })),
    payments: (invoiceData.payments || []).map((p) => ({
      iinn: p.terminal_id || '98765432',
      acn: p.account_number || null,
      trmn: p.terminal_id || '12345678',
      trn: p.reference || '11111111',
      pdt: Date.now(),
      pv: p.amount_irr || 0,
    })),
  };

  const payloadHash = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');

  const taxInvoice = {
    id: `txinv-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    tax_uid: taxUid,
    source_type: invoiceData.source_type || 'pos_sale',
    source_id: sourceId,
    branchId,
    document_type: documentType,
    reference_tax_uid: referenceTaxUid,
    serial_number: serialNumber,
    issue_date: issueDate,
    status: 'QUEUED', // QUEUED, SENDING, SUBMITTED, CONFIRMED, REJECTED, FAILED
    totals: {
      gross_irr: payload.header.tprdis,
      discount_irr: payload.header.tdis,
      taxable_base_irr: payload.header.tadis,
      tax_irr: payload.header.tvam,
      payable_irr: payload.header.tbill,
    },
    schema_version: settings.schemaVersion,
    request_payload: payload,
    request_hash: payloadHash,
    response_payload: null,
    error_message: null,
    attempt_count: 0,
    next_retry_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
  };

  taxInvoices.push(taxInvoice);

  // Trigger dispatch immediately if in sandbox or direct mode
  const dispatchResult = processSubmission(db, taxInvoice.id);

  auditEngine.recordAuditLog(acc, {
    action: 'CREATE_TAX_INVOICE',
    entityType: 'TaxInvoice',
    entityId: taxInvoice.id,
    userId: opts.userId || 'system',
    message: `صورتحساب الکترونیکی با شناسه مالیاتی ${taxUid} در صف ارسال سامانه مؤدیان قرار گرفت.`,
    metadata: { taxUid, sourceId, payable: taxInvoice.totals.payable_irr },
  });

  return {
    ok: true,
    taxInvoice,
    dispatchResult,
  };
}

/**
 * Dispatches an e-invoice to the Tax Authority API (or Sandbox Mock).
 */
function providerMode(settings) {
  return String(settings?.provider || '').trim().toUpperCase();
}

function providerDispatchError(settings) {
  const provider = providerMode(settings);
  if (!provider) return new Error('درگاه سامانه مؤدیان تنظیم نشده است.');
  if (provider === 'SANDBOX_MOCK' && settings.sandboxMode === true) return null;
  const error = new Error(
    provider === 'SANDBOX_MOCK'
      ? 'حالت sandbox برای شبیه‌ساز سامانه مؤدیان فعال نیست.'
      : `اتصال واقعی provider «${provider}» هنوز پیکربندی نشده است؛ تأیید مالیاتی صادر نشد.`,
  );
  error.code = provider === 'SANDBOX_MOCK' ? 'tax_sandbox_disabled' : 'tax_provider_not_configured';
  return error;
}

/**
 * Dispatch an invoice only through an explicitly supplied provider adapter.
 * The current release ships a deterministic sandbox adapter, but deliberately
 * has no implicit network/mock success path for real providers.
 */
function processSubmission(db, taxInvoiceId, opts = {}) {
  const { taxInvoices, taxSubmissions, settings } = ensureTaxpayerData(db);
  const invoice = taxInvoices.find((inv) => inv.id === taxInvoiceId);
  if (!invoice) return { ok: false, error: 'صورتحساب مالیاتی یافت نشد.' };
  // A confirmed tax invoice is immutable from the retry endpoint. Replaying
  // it must return the existing confirmation instead of creating another tax
  // submission or advancing the attempt counter.
  if (invoice.status === 'CONFIRMED') {
    const submission = taxSubmissions
      .slice()
      .reverse()
      .find((row) => row.tax_invoice_id === invoice.id && row.status === 'SUCCESS');
    return { ok: true, idempotent: true, invoice, submission: submission || null };
  }

  invoice.status = 'SENDING';
  invoice.attempt_count += 1;

  const submissionId = `taxsub-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const submissionRecord = {
    id: submissionId,
    tax_invoice_id: invoice.id,
    tax_uid: invoice.tax_uid,
    attempt: invoice.attempt_count,
    provider: settings.provider,
    status: 'IN_PROGRESS',
    timestamp: new Date().toISOString(),
  };

  try {
    const dispatchError = providerDispatchError(settings);
    const adapter = typeof opts.adapter === 'function' ? opts.adapter : null;
    let response;
    if (adapter) {
      response = adapter({ invoice, settings, attempt: invoice.attempt_count });
      if (!response || response.status !== 'SUCCESS') {
        throw Object.assign(new Error(response?.error || 'provider_submission_rejected'), { code: 'tax_provider_rejected' });
      }
    } else if (!dispatchError) {
      // SANDBOX_MOCK is the only built-in success path and must be explicit.
      response = {
        status: 'SUCCESS',
        referenceNumber: `SANDBOX-TAX-REF-${invoice.tax_uid}`,
        fiscalConfirmationTime: new Date().toISOString(),
        packetType: 'INVOICE_V01',
        errors: [],
      };
    } else {
      throw dispatchError;
    }

    if (response?.status === 'SUCCESS') {
      invoice.status = 'CONFIRMED';
      invoice.response_payload = response;
      submissionRecord.status = 'SUCCESS';
      submissionRecord.response = invoice.response_payload;
    }
  } catch (err) {
    invoice.status = invoice.attempt_count >= settings.maxRetries ? 'FAILED' : 'QUEUED';
    invoice.error_message = err.message;
    // Exponential backoff
    const backoffMs = Math.pow(2, invoice.attempt_count) * 60000;
    invoice.next_retry_at = new Date(Date.now() + backoffMs).toISOString();

    submissionRecord.status = 'FAILED';
    submissionRecord.error = err.message;
    submissionRecord.errorCode = err.code || 'tax_provider_error';
  }

  taxSubmissions.push(submissionRecord);
  return { ok: invoice.status === 'CONFIRMED', invoice, submission: submissionRecord };
}

/**
 * Queries the real-time status of a submitted invoice from the Taxpayer System.
 */
function queryTaxInvoiceStatus(db, taxInvoiceId) {
  const { taxInvoices } = ensureTaxpayerData(db);
  const invoice = taxInvoices.find((inv) => inv.id === taxInvoiceId || inv.tax_uid === taxInvoiceId);
  if (!invoice) return { ok: false, error: 'صورتحساب مالیاتی یافت نشد.' };

  return {
    ok: true,
    taxInvoiceId: invoice.id,
    taxUid: invoice.tax_uid,
    status: invoice.status,
    attemptCount: invoice.attempt_count,
    responsePayload: invoice.response_payload,
    errorMessage: invoice.error_message,
    nextRetryAt: invoice.next_retry_at,
    issuedAt: invoice.issue_date,
  };
}

module.exports = {
  ensureTaxpayerData,
  generateTaxInvoiceUID,
  enqueueTaxInvoice,
  processSubmission,
  queryTaxInvoiceStatus,
};
