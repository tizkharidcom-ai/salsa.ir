'use strict';

const PAYMENT_ATTEMPT_STATUSES = new Set([
  'pending',
  'unknown',
  'reconciliation_required',
  'paid',
  'failed',
  'cancelled',
  'refunded',
]);

const RECONCILIATION_RESOLUTION_STATUSES = new Set(['paid', 'failed', 'cancelled']);

function normalizePaymentAttemptStatus(status) {
  if (typeof status !== 'string') return '';
  return status.trim().toLowerCase();
}

function orderPaymentStatusForAttempt(status) {
  const normalized = normalizePaymentAttemptStatus(status);
  if (normalized === 'reconciliation_required') return 'unknown';
  return PAYMENT_ATTEMPT_STATUSES.has(normalized) && normalized !== 'refunded'
    ? normalized
    : null;
}

function paymentAttemptTransition(currentStatus, requestedStatus) {
  const current = normalizePaymentAttemptStatus(currentStatus);
  const requested = normalizePaymentAttemptStatus(requestedStatus);

  if (!PAYMENT_ATTEMPT_STATUSES.has(requested)) {
    return { ok: false, error: 'payment_status_invalid' };
  }
  if (!PAYMENT_ATTEMPT_STATUSES.has(current)) {
    return { ok: false, error: 'payment_current_status_invalid' };
  }

  // Replayed notifications must be safe even after a terminal result.
  if (current === requested) return { ok: true, idempotent: true };

  // Refunds are ledger reversals, not payment-attempt status transitions.
  if (requested === 'refunded') {
    return { ok: false, error: 'payment_refund_requires_reversal' };
  }
  if (current === 'refunded') {
    return { ok: false, error: 'payment_refund_terminal' };
  }
  if (current === 'paid') {
    return { ok: false, error: 'payment_paid_terminal' };
  }
  if (current === 'failed' || current === 'cancelled') {
    // A contradictory late provider event must be made explicit before it can
    // change a terminal attempt. This preserves the original result while
    // allowing a later, auditable reconciliation to record the financial fact.
    if (requested === 'reconciliation_required') return { ok: true, idempotent: false };
    return { ok: false, error: 'payment_terminal_conflict' };
  }

  // An ambiguous provider result must pass through an explicit reconciliation
  // state before it can be resolved to a terminal outcome. It is never treated
  // as pending, failed, or paid by default.
  if (current === 'unknown' && requested !== 'reconciliation_required') {
    return { ok: false, error: 'payment_status_reconciliation_required' };
  }
  if (current === 'reconciliation_required'
    && !RECONCILIATION_RESOLUTION_STATUSES.has(requested)) {
    return { ok: false, error: 'payment_reconciliation_regression' };
  }

  return { ok: true, idempotent: false };
}

module.exports = { paymentAttemptTransition, orderPaymentStatusForAttempt };
