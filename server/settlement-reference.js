'use strict';

const { createHash } = require('node:crypto');

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$/u;
const ACTIVE_REFUND_STATUSES = new Set(['pending_approval', 'approved', 'processing', 'succeeded']);

function failure(code, message, status = 409) {
  return Object.assign(new Error(message), { code, status });
}

function normalizeSettlementReference(value) {
  let raw;
  if (value == null) raw = '';
  else if (typeof value === 'string') raw = value;
  else if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) raw = String(value);
  else {
    throw Object.assign(new Error('کد پیگیری کارت‌خوان معتبر نیست.'), {
      code: 'settlement_reference_invalid',
      status: 400,
    });
  }
  if (raw.length > 120 || /[\p{Cc}\p{Cf}]/u.test(raw)) {
    throw Object.assign(new Error('کد پیگیری کارت‌خوان معتبر نیست.'), {
      code: 'settlement_reference_invalid',
      status: 400,
    });
  }
  return raw.trim().replace(/\s+/gu, ' ') || null;
}

function normalizeIdempotencyKey(value) {
  if (typeof value !== 'string' || !IDEMPOTENCY_KEY_PATTERN.test(value)) {
    throw failure('refund_idempotency_key_invalid', 'کلید تکرارنشدنی بازپرداخت باید یک شناسهٔ ثابت و معتبر باشد.', 400);
  }
  return value;
}

function normalizeRefundReference(value, originalPaymentReference = null) {
  const reference = normalizeSettlementReference(value);
  if (!reference) {
    throw failure('refund_outgoing_reference_required', 'شناسهٔ خروجی واقعی بازپرداخت الزامی است.', 409);
  }
  const original = normalizeSettlementReference(originalPaymentReference);
  if (original && referenceComparisonKey(reference) === referenceComparisonKey(original)) {
    throw failure('refund_reference_is_payment_reference', 'مرجع پرداخت ورودی را نمی‌توان به‌عنوان مرجع خروجی بازپرداخت ثبت کرد.', 409);
  }
  return reference;
}

function referenceComparisonKey(value) {
  return String(value).normalize('NFKC').toLocaleUpperCase('en-US');
}

function settlementReferenceIdentity(value) {
  const reference = normalizeSettlementReference(value);
  return reference ? referenceComparisonKey(reference) : null;
}

/**
 * Keep a payment attempt bound to one provider transaction reference. A
 * provider retry may omit a reference or repeat it with harmless Unicode /
 * whitespace differences, but it must not replace an already-recorded ref.
 */
function resolvePaymentAttemptReference(existingReference, incomingReference, { required = false } = {}) {
  const existing = normalizeSettlementReference(existingReference);
  const incoming = normalizeSettlementReference(incomingReference);
  if (required && !existing && !incoming) {
    throw failure('payment_attempt_reference_required', 'شناسهٔ تراکنش پرداخت برای تأیید این تلاش الزامی است.', 409);
  }
  if (existing && incoming && referenceComparisonKey(existing) !== referenceComparisonKey(incoming)) {
    throw failure('payment_reference_conflict', 'شناسهٔ تراکنش با مرجع ثبت‌شدهٔ این پرداخت یکسان نیست.', 409);
  }
  return {
    reference: existing || incoming,
    reusedExistingReference: !!existing,
  };
}

function refundRequestIdentity(input = {}) {
  const orderId = requiredIdentityPart(input.orderId, 'refund_order_identity_required');
  const paymentId = requiredIdentityPart(input.paymentId, 'refund_payment_identity_required');
  const branchId = safeInteger(input.branchId);
  if (!Number.isSafeInteger(branchId) || branchId <= 0) {
    throw failure('refund_branch_identity_required', 'شناسهٔ شعبه برای هویت بازپرداخت معتبر نیست.', 400);
  }
  const amountIrr = safeInteger(input.amountIrr);
  if (!Number.isSafeInteger(amountIrr) || amountIrr <= 0) {
    throw failure('refund_amount_identity_invalid', 'مبلغ بازپرداخت باید عدد صحیح مثبت و امن باشد.', 400);
  }
  const reason = typeof input.reason === 'string'
    ? input.reason.normalize('NFKC').trim().replace(/\s+/gu, ' ')
    : '';
  if (reason.length < 3 || reason.length > 300) {
    throw failure('refund_reason_identity_invalid', 'علت بازپرداخت باید بین ۳ تا ۳۰۰ نویسه باشد.', 400);
  }
  const canonical = JSON.stringify({ orderId, branchId, paymentId, amountIrr, reason });
  return {
    orderId, branchId, paymentId, amountIrr, reason,
    fingerprint: createHash('sha256').update(canonical, 'utf8').digest('hex'),
  };
}

function requiredIdentityPart(value, code) {
  if (typeof value !== 'string' && !(typeof value === 'number' && Number.isSafeInteger(value))) {
    throw failure(code, 'هویت سفارش یا پرداخت برای درخواست بازپرداخت کامل نیست.', 400);
  }
  const raw = String(value);
  const normalized = raw.trim();
  if (!normalized || raw.length > 120 || normalized.length > 120) {
    throw failure(code, 'هویت سفارش یا پرداخت برای درخواست بازپرداخت کامل نیست.', 400);
  }
  return normalized;
}

function safeInteger(value) {
  if (typeof value === 'number') return Number.isSafeInteger(value) ? value : null;
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!/^[+-]?\d+$/u.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

/**
 * Resolve a retry against persisted refund requests. The stable business
 * fingerprint catches a client that silently rotates its idempotency key.
 * Callers must persist the returned fingerprint with the original request.
 */
function resolveRefundRequestRetry(refunds, input = {}) {
  const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);
  const identity = refundRequestIdentity(input);
  const rows = Array.isArray(refunds) ? refunds : [];
  const byKey = rows.filter((refund) => refund?.idempotencyKey === idempotencyKey);
  if (byKey.length > 1) throw failure('refund_idempotency_identity_ambiguous', 'این کلید به بیش از یک درخواست بازپرداخت متصل است.');
  if (byKey.length === 1) {
    const refund = byKey[0];
    const storedFingerprint = refund.requestFingerprint || refundRequestIdentity(refund).fingerprint;
    if (storedFingerprint !== identity.fingerprint) {
      throw failure('refund_idempotency_conflict', 'این کلید قبلاً برای درخواست بازپرداخت دیگری استفاده شده است.');
    }
    return { idempotencyKey, requestFingerprint: identity.fingerprint, refund, idempotentReplay: true };
  }

  const sameIntent = rows.find((refund) => ACTIVE_REFUND_STATUSES.has(String(refund?.status || 'pending_approval'))
    && refundRequestIdentity(refund).fingerprint === identity.fingerprint);
  if (sameIntent) {
    throw failure('refund_idempotency_key_rotated', 'این بازپرداخت قبلاً ثبت شده است؛ retry باید همان کلید اولیه را استفاده کند.');
  }
  return { idempotencyKey, requestFingerprint: identity.fingerprint, refund: null, idempotentReplay: false };
}

/**
 * Build a reconciliation result only from a persisted, verified outgoing
 * evidence row. A user-supplied string or the original payment reference is
 * never sufficient proof of a refund payout.
 */
function buildRefundReconciliationMatch({ refund, evidenceId, loadEvidence, existingMatches = [], actor, matchedAt } = {}) {
  const branchId = safeInteger(refund?.branchId);
  if (!refund?.id || !refund?.paymentId || !Number.isSafeInteger(branchId) || branchId <= 0) {
    throw failure('refund_match_identity_missing', 'هویت سفارش، پرداخت، شعبه و بازپرداخت برای تطبیق کامل نیست.');
  }
  const amountIrr = safeInteger(refund.amountIrr);
  if (!Number.isSafeInteger(amountIrr) || amountIrr <= 0) {
    throw failure('refund_match_amount_invalid', 'مبلغ بازپرداخت برای تطبیق معتبر نیست.');
  }
  if (typeof loadEvidence !== 'function' || evidenceId == null || !String(evidenceId).trim()) {
    throw failure('refund_match_evidence_required', 'برای تطبیق بازپرداخت باید مدرک خروجیِ ذخیره‌شده ارائه شود.');
  }
  if (!String(actor || '').trim() || !validTimestamp(matchedAt)) {
    throw failure('refund_match_audit_required', 'ثبت‌کننده و زمان تطبیق برای ردگیری حسابرسی الزامی است.', 400);
  }
  const evidence = loadEvidence(String(evidenceId));
  if (!evidence || String(evidence.id) !== String(evidenceId)
    || !String(evidence.sourceRecordId || '').trim()
    || !validTimestamp(evidence.verifiedAt)) {
    throw failure('refund_match_evidence_unverified', 'مدرک خروجی پیدا نشد یا منبع آن به‌طور پایدار تأیید نشده است.');
  }
  if (!['provider_refund', 'bank_statement_line', 'cash_disbursement'].includes(String(evidence.kind))
    || evidence.direction !== 'outgoing') {
    throw failure('refund_match_evidence_not_outgoing', 'مدرک انتخاب‌شده، خروج وجه بازپرداخت را اثبات نمی‌کند.');
  }
  // Do not let JavaScript coercion turn booleans, decimal/scientific strings,
  // or unsafe values into apparently exact financial evidence.
  const evidenceBranchId = safeInteger(evidence.branchId);
  const evidenceAmountIrr = safeInteger(evidence.amountIrr);
  if (String(evidence.sourcePaymentId || '') !== String(refund.paymentId)
    || evidenceBranchId !== branchId
    || evidenceAmountIrr !== amountIrr) {
    throw failure('refund_match_evidence_mismatch', 'مدرک خروجی با پرداخت، شعبه یا مبلغ همین بازپرداخت منطبق نیست.');
  }
  const referenceValue = evidence.kind === 'provider_refund' ? evidence.refundReference
    : evidence.kind === 'bank_statement_line' ? evidence.bankReference
      : evidence.disbursementReference;
  const outgoingReference = normalizeRefundReference(referenceValue, refund.paymentReference);
  const savedMatches = (Array.isArray(existingMatches) ? existingMatches : [])
    .filter((item) => item?.status === 'matched');
  const sameRefundMatch = savedMatches.find((item) => String(item.refundId || '') === String(refund.id));
  if (sameRefundMatch && (String(sameRefundMatch.evidenceId || '') !== String(evidence.id)
    || referenceComparisonKey(sameRefundMatch.outgoingReference || '') !== referenceComparisonKey(outgoingReference))) {
    throw failure('refund_match_identity_conflict', 'مرجع یا مدرک خروجی این بازپرداخت قبلاً ثبت شده و قابل تعویض نیست.');
  }
  const previousMatch = savedMatches.find((item) => String(item?.evidenceId || '') === String(evidence.id)
    || (item?.outgoingReference && referenceComparisonKey(item.outgoingReference) === referenceComparisonKey(outgoingReference)));
  if (previousMatch && String(previousMatch.refundId) !== String(refund.id)) {
    throw failure('refund_match_evidence_already_used', 'این مدرک یا مرجع خروجی قبلاً برای بازپرداخت دیگری مصرف شده است.');
  }
  if (evidence.status === 'matched' && String(evidence.refundId || '') !== String(refund.id)) {
    throw failure('refund_match_evidence_already_used', 'مدرک خروجی قبلاً به بازپرداخت دیگری متصل شده است.');
  }
  if (evidence.status === 'matched' && !validTimestamp(evidence.matchedAt)) {
    throw failure('refund_match_evidence_unverified', 'زمان تطبیق ذخیره‌شدهٔ مدرک خروجی معتبر نیست.');
  }
  if (!['unmatched', 'matched'].includes(String(evidence.status))) {
    throw failure('refund_match_evidence_unavailable', 'وضعیت مدرک خروجی برای تطبیق قابل استفاده نیست.');
  }
  return {
    id: String(evidence.id), evidenceId: String(evidence.id), kind: 'refund',
    refundId: String(refund.id), paymentId: String(refund.paymentId), branchId,
    amountIrr, outgoingReference, evidenceKind: String(evidence.kind),
    sourceRecordId: String(evidence.sourceRecordId), status: 'matched',
    matchedBy: String(actor).trim(), matchedAt: evidence.status === 'matched' ? evidence.matchedAt : matchedAt,
  };
}

function validTimestamp(value) {
  return typeof value === 'string' && value.length > 0 && Number.isFinite(Date.parse(value));
}

module.exports = {
  normalizeSettlementReference,
  settlementReferenceIdentity,
  resolvePaymentAttemptReference,
  normalizeIdempotencyKey,
  normalizeRefundReference,
  refundRequestIdentity,
  resolveRefundRequestRetry,
  buildRefundReconciliationMatch,
};
