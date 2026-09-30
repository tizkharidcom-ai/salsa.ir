'use strict';

const { allowedOrderTransitions } = require('./command-center');
const { orderCancellationGuard } = require('./order-cancellation-guard');

function orderWithCanonicalFulfillment(order) {
  if (!order || typeof order !== 'object' || Array.isArray(order)) return order;
  const fulfillment = String(order.fulfillment || '').trim().toLowerCase();
  if (!['delivery', 'dine_in', 'pickup'].includes(fulfillment) || fulfillment === order.fulfillment) return order;
  return { ...order, fulfillment };
}

function exposeOperationalOrderActions(order) {
  // Historical/imported records may vary in casing or surrounding whitespace.
  // Normalize only the projection passed to the transition policy so a
  // delivery can never fall through to the policy's legacy pickup default.
  const transitions = allowedOrderTransitions(orderWithCanonicalFulfillment(order));
  const cancellation = orderCancellationGuard(order);
  const cancellationIsStateEligible = transitions.includes('cancelled');
  return {
    ...order,
    allowedStatusTransitions: transitions.filter((status) => status !== 'cancelled' || cancellation.ok),
    cancellationBlocked: cancellationIsStateEligible && !cancellation.ok
      ? { code: cancellation.code, message: cancellation.message }
      : null,
  };
}

module.exports = { exposeOperationalOrderActions };
