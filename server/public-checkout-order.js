'use strict';

const PUBLIC_FULFILLMENTS = new Set(['dine_in', 'pickup', 'delivery']);
const PUBLIC_ACCEPTANCE_STATES = new Set(['pending', 'awaiting_acceptance', 'accepted', 'rejected']);
const PUBLIC_ORDER_STATUSES = new Set([
  'unknown', 'pending', 'pending_online', 'pending_cashier', 'pay_at_cashier',
  'awaiting_confirmation', 'prep', 'preparing', 'kitchen', 'sent_to_kitchen',
  'ready', 'dispatched', 'delivering', 'delivered', 'picked_up', 'paid', 'done',
  'cancelled', 'rejected',
]);
const PUBLIC_PAYMENT_STATUSES = new Set([
  'unpaid', 'partial', 'pending', 'paid', 'failed', 'cancelled', 'refunded', 'unknown',
]);

// The guest order acknowledgement is not an operational order DTO. Expose only
// values needed to confirm the receipt and explain its next customer-facing step.
function publicCheckoutOrderView(order) {
  if (!order || typeof order !== 'object' || Array.isArray(order)) return null;

  const view = {};
  if (Number.isSafeInteger(order.id) && order.id > 0) view.id = order.id;
  if (typeof order.orderNo === 'string' && order.orderNo.trim()) view.orderNo = order.orderNo.slice(0, 80);
  if (Number.isSafeInteger(order.total) && order.total >= 0) view.total = order.total;
  const taxSnapshot = order.taxSnapshot ?? order.tax_snapshot;
  const taxAmountIrr = taxSnapshot?.totalTaxIrr ?? taxSnapshot?.total_tax_irr;
  const payableIrr = Number(order.total) * 10;
  if (taxSnapshot?.schemaVersion === 1 && taxSnapshot?.currency === 'IRR'
      && taxSnapshot?.inclusive === true && Number(taxSnapshot.branchId) === Number(order.branchId)
      && Number.isSafeInteger(payableIrr) && Number.isSafeInteger(Number(taxAmountIrr))
      && Number(taxAmountIrr) >= 0 && Number(taxAmountIrr) <= payableIrr) {
    view.tax = { inclusive: true, totalTaxIrr: Number(taxAmountIrr) };
  }
  if (typeof order.status === 'string' && order.status.length <= 40) {
    const status = order.status.trim().toLowerCase();
    view.status = PUBLIC_ORDER_STATUSES.has(status) ? status : 'unknown';
  }
  if (typeof order.paymentStatus === 'string' && order.paymentStatus.length <= 40) {
    const paymentStatus = order.paymentStatus.trim().toLowerCase();
    if (paymentStatus === 'reconciliation_required') view.paymentStatus = 'unknown';
    else if (PUBLIC_PAYMENT_STATUSES.has(paymentStatus)) view.paymentStatus = paymentStatus;
  }

  const fulfillment = PUBLIC_FULFILLMENTS.has(order.fulfillment) ? order.fulfillment : null;
  if (fulfillment) view.fulfillment = fulfillment;
  if (fulfillment === 'dine_in' && typeof order.tableNo === 'string' && order.tableNo.trim().length <= 20) {
    view.tableNo = order.tableNo;
  }
  if (fulfillment === 'delivery') {
    const acceptance = order.deliveryAcceptance;
    if (acceptance && PUBLIC_ACCEPTANCE_STATES.has(acceptance.status)) {
      view.deliveryAcceptance = { status: acceptance.status };
      if (acceptance.status === 'accepted' && acceptance.source === 'restaurant') {
        view.deliveryAcceptance.source = 'restaurant';
      }
    }
    const etaMinutes = order.delivery?.etaMinutes;
    if (Number.isSafeInteger(etaMinutes) && etaMinutes > 0 && etaMinutes <= 1440) {
      view.delivery = { etaMinutes };
    }
  }
  return view;
}

module.exports = { publicCheckoutOrderView };
