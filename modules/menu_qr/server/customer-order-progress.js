'use strict';

const CUSTOMER_PAYMENT_STATES = new Set([
  'unpaid', 'partial', 'pending', 'paid', 'failed', 'cancelled', 'refunded', 'unknown',
]);
const CUSTOMER_DELIVERY_ACCEPTANCE_STATES = new Set([
  'pending', 'awaiting_acceptance', 'accepted', 'rejected',
]);

// Customer history may show the progress needed to understand an order, but it
// must not expose who decided, internal rejection notes, or payment evidence.
function customerOrderProgress(order) {
  if (!order || typeof order !== 'object' || Array.isArray(order)) return {};

  const progress = {};
  if (typeof order.paymentStatus === 'string') {
    const status = order.paymentStatus.trim().toLowerCase();
    if (CUSTOMER_PAYMENT_STATES.has(status)) progress.paymentStatus = status;
    else if (status === 'reconciliation_required') progress.paymentStatus = 'unknown';
  }

  if (order.fulfillment === 'delivery') {
    const status = String(order.deliveryAcceptance?.status || '').trim().toLowerCase();
    if (CUSTOMER_DELIVERY_ACCEPTANCE_STATES.has(status)) {
      progress.deliveryAcceptance = { status };
    }
  }

  return progress;
}

module.exports = { customerOrderProgress };
