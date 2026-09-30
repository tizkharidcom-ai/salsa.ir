'use strict';

const { settlementReferenceIdentity } = require('./settlement-reference.js');

function finiteIntegerAmount(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !/^[+-]?\d+$/u.test(value.trim())) return null;
  const amount = Number(typeof value === 'string' ? value.trim() : value);
  return Number.isSafeInteger(amount) ? amount : null;
}

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$/u;
const PRODUCTION_SPLIT_TENDERS = new Set(['cash', 'manual_card']);

function resolveSettlementAmounts(input = {}, options = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || !options || typeof options !== 'object' || Array.isArray(options)) {
    return { ok: false, error: 'settlement_input_invalid' };
  }
  const environment = options.environment ?? (() => process.env.NODE_ENV);
  if (typeof environment !== 'function') return { ok: false, error: 'settlement_environment_unavailable' };
  const {
    total,
    amountPaid,
    payments,
    paymentAmount,
    amountTendered,
    tender,
  } = input;
  const orderTotal = finiteIntegerAmount(total);
  if (orderTotal === null || orderTotal < 0) return { ok: false, error: 'order_total_invalid' };

  if (payments !== null && payments !== undefined && !Array.isArray(payments)) {
    return { ok: false, error: 'payment_history_invalid' };
  }
  let recordedPayments = 0;
  let hasUnsupportedEffectiveTender = false;
  const paymentIds = new Set();
  const idempotencyKeys = new Set();
  const references = new Set();
  for (const payment of Array.isArray(payments) ? payments : []) {
    if (!payment || typeof payment !== 'object' || Array.isArray(payment)) {
      return { ok: false, error: 'payment_history_invalid' };
    }
    const grossAmount = finiteIntegerAmount(payment?.amount);
    const refundedAmount = payment?.refundedAmount == null ? 0 : finiteIntegerAmount(payment.refundedAmount);
    if (grossAmount === null || grossAmount <= 0 || refundedAmount === null
      || refundedAmount < 0 || refundedAmount > grossAmount) return { ok: false, error: 'payment_history_invalid' };
    const amount = grossAmount - refundedAmount;
    if (amount > 0 && !PRODUCTION_SPLIT_TENDERS.has(payment.tender)) {
      hasUnsupportedEffectiveTender = true;
    }

    if (payment.id !== null && payment.id !== undefined) {
      if ((typeof payment.id !== 'string' && !(Number.isSafeInteger(payment.id) && payment.id > 0))
        || !String(payment.id).trim() || String(payment.id).trim().length > 120
        || /[\p{Cc}\p{Cf}]/u.test(String(payment.id))) {
        return { ok: false, error: 'payment_history_invalid' };
      }
      const paymentId = String(payment.id).trim();
      if (paymentIds.has(paymentId)) return { ok: false, error: 'payment_history_duplicate_id' };
      paymentIds.add(paymentId);
    }
    if (payment.idempotencyKey !== null && payment.idempotencyKey !== undefined) {
      if (typeof payment.idempotencyKey !== 'string' || !IDEMPOTENCY_KEY_PATTERN.test(payment.idempotencyKey)) {
        return { ok: false, error: 'payment_history_invalid' };
      }
      const key = payment.idempotencyKey.trim();
      if (idempotencyKeys.has(key)) return { ok: false, error: 'payment_history_duplicate_idempotency_key' };
      idempotencyKeys.add(key);
    }
    if (payment.reference !== null && payment.reference !== undefined) {
      let reference;
      try { reference = settlementReferenceIdentity(payment.reference); }
      catch (_) { return { ok: false, error: 'payment_history_invalid' }; }
      if (reference) {
        if (references.has(reference)) return { ok: false, error: 'payment_history_duplicate_reference' };
        references.add(reference);
      }
    }
    if (amount > orderTotal - recordedPayments) {
      return { ok: false, error: 'payment_history_exceeds_order_total' };
    }
    recordedPayments += amount;
  }

  let projectedPaid = 0;
  if (amountPaid !== null && amountPaid !== undefined) {
    projectedPaid = finiteIntegerAmount(amountPaid);
    if (projectedPaid === null || projectedPaid < 0) {
      return { ok: false, error: 'payment_history_invalid' };
    }
    if (projectedPaid > orderTotal) {
      return { ok: false, error: 'payment_history_exceeds_order_total' };
    }
  }
  // When both representations exist, neither is safe to prefer: a stale high
  // projection can hide a due balance and a stale low projection can invite a
  // duplicate collection. Require reconciliation instead of guessing.
  if (amountPaid !== null && amountPaid !== undefined && payments?.length
    && projectedPaid !== recordedPayments) {
    return { ok: false, error: 'payment_history_inconsistent' };
  }
  const alreadyPaid = Math.max(projectedPaid, recordedPayments);
  const outstanding = Math.max(0, orderTotal - alreadyPaid);
  if (!outstanding) {
    return { ok: true, orderTotal, alreadyPaid, outstanding, requestedAmount: 0, amountTendered: 0 };
  }
  let production;
  try { production = environment() === 'production'; }
  catch (_) { return { ok: false, error: 'settlement_environment_unavailable' }; }

  const parsedPaymentAmount = finiteIntegerAmount(paymentAmount);
  const requestedAmount = paymentAmount === null || paymentAmount === undefined
    ? outstanding
    : parsedPaymentAmount;
  if (requestedAmount === null || requestedAmount <= 0) {
    return { ok: false, error: 'payment_amount_invalid', outstanding };
  }
  if (requestedAmount > outstanding) {
    return { ok: false, error: 'payment_amount_exceeds_due', outstanding };
  }
  const isSplitSettlement = alreadyPaid > 0 || requestedAmount < outstanding;
  if (production && isSplitSettlement) {
    const history = Array.isArray(payments) ? payments : [];
    const incomingTenderAllowed = PRODUCTION_SPLIT_TENDERS.has(tender);
    // A split is safe only when every effective tender is a cashier-recorded
    // cash/card leg. Fully refunded history remains auditable but contributes
    // no effective tender; positive online/gateway/wallet receipts still fail
    // closed and keep their own settlement lifecycle.
    if (!incomingTenderAllowed || hasUnsupportedEffectiveTender || (alreadyPaid > 0 && !history.length)) {
      return { ok: false, error: 'partial_settlement_not_approved', outstanding, requestedAmount };
    }
  }

  let normalizedTendered = requestedAmount;
  if (tender === 'cash' && amountTendered !== null && amountTendered !== undefined) {
    normalizedTendered = finiteIntegerAmount(amountTendered);
    if (normalizedTendered === null || normalizedTendered <= 0) {
      return { ok: false, error: 'cash_received_invalid', outstanding, requestedAmount };
    }
  }
  if (tender === 'cash' && normalizedTendered < requestedAmount) {
    return { ok: false, error: 'cash_received_insufficient', outstanding, requestedAmount, minimum: requestedAmount };
  }

  return {
    ok: true,
    orderTotal,
    alreadyPaid,
    outstanding,
    requestedAmount,
    amountTendered: normalizedTendered,
  };
}

module.exports = { resolveSettlementAmounts };
