'use strict';

const KITCHEN_STATUSES = new Set(['sent_to_kitchen', 'paid', 'preparing']);
const PAYMENT_STATUSES = new Set(['pending_online', 'awaiting_confirmation', 'pay_at_cashier']);
const HANDOFF_STATUSES = new Set(['ready', 'dispatched']);

function timestamp(value) {
  if (value == null || value === '') return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function orderStageStartedAt(order, now = Date.now()) {
  const status = String(order?.status || '');
  const history = Array.isArray(order?.statusHistory) ? order.statusHistory : [];
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const entry = history[index];
    if (String(entry?.status || '') !== status) continue;
    const at = timestamp(entry.at);
    if (at !== null) return at;
  }

  const statusFields = {
    paid: ['paidAt'],
    preparing: ['startedAt'],
    ready: ['readyAt'],
    dispatched: ['dispatchedAt'],
    picked_up: ['doneAt'],
    delivered: ['doneAt'],
    done: ['doneAt'],
  };
  for (const field of statusFields[status] || []) {
    const at = timestamp(order?.[field]);
    if (at !== null) return at;
  }
  return timestamp(order?.statusAt) ?? timestamp(order?.createdAt) ?? now;
}

function getOrderAging(order, now = Date.now(), thresholdMinutes = 20) {
  const createdAt = timestamp(order?.createdAt) ?? now;
  const stageStartedAt = orderStageStartedAt(order, now);
  const ageMinutes = Math.max(0, Math.floor((now - createdAt) / 60000));
  const stageAgeMinutes = Math.max(0, Math.floor((now - stageStartedAt) / 60000));
  const status = String(order?.status || '');
  const attentionType = stageAgeMinutes < thresholdMinutes
    ? null
    : KITCHEN_STATUSES.has(status)
      ? 'kitchen'
      : PAYMENT_STATUSES.has(status)
        ? 'payment'
        : HANDOFF_STATUSES.has(status)
          ? 'handoff'
          : null;

  return { ageMinutes, stageAgeMinutes, attentionType };
}

module.exports = { getOrderAging, orderStageStartedAt };
