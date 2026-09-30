'use strict';

const KITCHEN_ACTIVE_ORDER_STATUSES = new Set(['sent_to_kitchen', 'preparing', 'ready']);
const SERVED_DINE_IN_STATUSES = new Set(['done', 'completed']);

function orderSplitLifecycleGuard(order) {
  const status = String(order?.status || '').trim().toLowerCase();
  if (status === 'cancelled') {
    return {
      ok: false,
      code: 'order_split_status_locked',
      message: 'سفارش لغوشده قابل تفکیک نیست.',
    };
  }

  const kitchenActive = KITCHEN_ACTIVE_ORDER_STATUSES.has(status)
    || (Boolean(order?.startedAt) && !SERVED_DINE_IN_STATUSES.has(status));
  if (kitchenActive) {
    return {
      ok: false,
      code: 'order_split_kitchen_active',
      message: 'تفکیک از ارسال سفارش به آشپزخانه تا پایان سرو ممکن نیست؛ پس از تحویل، فاکتور را جدا کنید.',
    };
  }

  return { ok: true, code: null, message: null };
}

module.exports = { orderSplitLifecycleGuard };
