'use strict';

const CANCELLABLE_PRE_KITCHEN_STATUSES = new Set([
  'pending_online',
  'awaiting_confirmation',
  'pay_at_cashier',
]);

const CANCELLABLE_KITCHEN_STATUSES = new Set([
  'sent_to_kitchen',
  'preparing',
  'ready',
  'dispatched',
]);

function positiveAmount(value) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
}

function isSafeAmount(value, { positive = false } = {}) {
  if (typeof value === 'string' && !/^\d+$/u.test(value.trim())) return false;
  if (typeof value !== 'number' && typeof value !== 'string') return false;
  const amount = Number(value);
  return Number.isSafeInteger(amount) && (positive ? amount > 0 : amount >= 0);
}

function receivedAmount(order) {
  if (!order || typeof order !== 'object' || Array.isArray(order)) return 0;
  // Other guards also use this projection as a simple `> 0` safety check.
  // It represents historical receipts, not the current net balance: a refund
  // must not make a previously paid order editable or splittable.
  if (hasInvalidPaymentEvidence(order)) return Number.POSITIVE_INFINITY;
  const paymentRowsTotal = (Array.isArray(order?.partialPayments) ? order.partialPayments : [])
    .reduce((sum, payment) => sum + positiveAmount(payment?.amount), 0);
  return Math.max(positiveAmount(order?.amountPaid), paymentRowsTotal);
}

function netReceivedAmount(order) {
  if (!order || typeof order !== 'object' || Array.isArray(order)) return 0;
  // Malformed refund evidence is not proof of a reversal. Return a positive
  // sentinel so callers fail closed instead of making the order look unpaid.
  if (hasInvalidPaymentEvidence(order)) return Number.POSITIVE_INFINITY;
  const netPaymentRows = (Array.isArray(order.partialPayments) ? order.partialPayments : [])
    .reduce((sum, payment) => sum + Math.max(
      0,
      positiveAmount(payment?.amount) - positiveAmount(payment?.refundedAmount),
    ), 0);
  return Math.max(positiveAmount(order.amountPaid), netPaymentRows);
}

function hasInvalidPaymentEvidence(order) {
  if (Object.hasOwn(order, 'amountPaid') && order.amountPaid !== undefined && order.amountPaid !== null) {
    if (!isSafeAmount(order.amountPaid)) return true;
  }

  if (!Object.hasOwn(order, 'partialPayments')) return false;
  if (!Array.isArray(order.partialPayments)) return true;
  return order.partialPayments.some((payment) => {
    if (!payment || typeof payment !== 'object' || Array.isArray(payment)) return true;
    if (!isSafeAmount(payment.amount, { positive: true })) return true;

    if (payment.refundedAmount === undefined || payment.refundedAmount === null) return false;
    if (!isSafeAmount(payment.refundedAmount)) return true;
    const refundedAmount = Number(payment.refundedAmount);
    const amount = Number(payment.amount);
    return !Number.isSafeInteger(refundedAmount)
      || refundedAmount < 0
      || refundedAmount > amount;
  });
}

function deny(code, message) {
  return { ok: false, code, message };
}

function orderCancellationGuard(order) {
  if (!order || typeof order !== 'object' || Array.isArray(order)) {
    return deny(
      'order_state_reconciliation_required',
      'وضعیت سفارش معتبر نیست؛ پیش از لغو، سفارش را بررسی کنید.',
    );
  }

  const orderStatus = String(order.status || '').trim().toLowerCase();
  const hasPaymentStatus = order.paymentStatus !== undefined
    && order.paymentStatus !== null
    && String(order.paymentStatus).trim() !== '';
  let paymentStatus = hasPaymentStatus
    ? String(order.paymentStatus).trim().toLowerCase()
    : '';

  if (hasInvalidPaymentEvidence(order)) {
    return deny(
      'payment_status_reconciliation_required',
      'سابقهٔ مبلغ پرداخت معتبر نیست؛ پیش از لغو، وضعیت پرداخت را تطبیق دهید.',
    );
  }

  if (!paymentStatus) {
    if (orderStatus === 'pay_at_cashier') paymentStatus = 'unpaid';
    else if (orderStatus) paymentStatus = 'unknown';
  }

  // Payment evidence takes precedence over all lifecycle shortcuts: it must
  // never be hidden by a repeated-cancel or kitchen-state check.
  if (paymentStatus === 'paid'
      || paymentStatus === 'partial'
      || orderStatus === 'paid'
      || netReceivedAmount(order) > 0) {
    return deny(
      'order_refund_required',
      'برای جلوگیری از مغایرت مالی، سفارش دارای دریافت ثبت‌شده را بدون فرایند بازپرداخت نمی‌توان لغو کرد.',
    );
  }

  // A summary status on the order is not authoritative evidence that an
  // online gateway attempt can no longer capture funds. Until the provider
  // attempt is reconciled, cancelling here could race a late capture and leave
  // a paid order marked cancelled. The payment-attempt boundary must perform
  // reconciliation before it can authorize cancellation.
  if (String(order.paymentMethod || '').trim().toLowerCase() === 'online') {
    return deny(
      'payment_status_reconciliation_required',
      'پرداخت آنلاین باید پیش از لغو با وضعیت نهایی درگاه تطبیق داده شود.',
    );
  }

  if (['pending', 'unknown', 'cancelled', 'refunded'].includes(paymentStatus)) {
    return deny(
      'payment_status_reconciliation_required',
      'وضعیت پرداخت روشن نیست؛ پیش از لغو، وضعیت تراکنش را تطبیق دهید.',
    );
  }

  // Only explicitly unpaid/failed records have a known no-funds state. Future
  // or misspelled payment states must not silently inherit cancellation rights.
  if (!['unpaid', 'failed'].includes(paymentStatus)) {
    return deny(
      'payment_status_reconciliation_required',
      'وضعیت پرداخت روشن نیست؛ پیش از لغو، وضعیت تراکنش را تطبیق دهید.',
    );
  }

  if (orderStatus === 'cancelled') {
    return deny(
      'order_already_cancelled',
      'این سفارش قبلاً لغو شده است و نباید دوباره پردازش شود.',
    );
  }

  if (CANCELLABLE_KITCHEN_STATUSES.has(orderStatus)) {
    return {
      ok: true,
      receivedAmount: 0,
      cancellationStage: 'kitchen_started',
      inventoryReleaseAllowed: false,
    };
  }

  if (!CANCELLABLE_PRE_KITCHEN_STATUSES.has(orderStatus)) {
    return deny(
      'order_state_reconciliation_required',
      'وضعیت فعلی سفارش برای لغو شناخته‌شده نیست؛ پیش از هر تغییری آن را بررسی کنید.',
    );
  }

  const kitchenStarted = Boolean(order.startedAt);
  return {
    ok: true,
    receivedAmount: 0,
    cancellationStage: kitchenStarted ? 'kitchen_started' : 'pre_kitchen',
    inventoryReleaseAllowed: !kitchenStarted,
  };
}

function shouldReleaseOrderInventory(order) {
  // The existing order state machine permits cancelling some tickets after
  // they reach the kitchen. Do not make ingredients sellable again then.
  const cancellation = orderCancellationGuard(order);
  return cancellation.ok && cancellation.inventoryReleaseAllowed === true;
}

module.exports = { orderCancellationGuard, receivedAmount, netReceivedAmount, shouldReleaseOrderInventory };
