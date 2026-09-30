/*
 * Command-center domain primitives.
 *
 * This module deliberately has no HTTP or storage dependency so the same
 * permission, fulfillment and audit rules can be used by Express, migration
 * scripts and tests.  Legacy `admin` accounts normalize to `owner` instead of
 * losing access during the RBAC rollout.
 */
'use strict';

const crypto = require('crypto');
const { formatNumber } = require('./finance/money.js');

const ROLE_CAPABILITIES = Object.freeze({
  owner: ['*'],
  manager: [
    'admin.access',
    'command.view',
    'ops.view',
    'ops.manage',
    'orders.view',
    'orders.create',
    'orders.manage',
    'orders.course.manage',
    'orders.split',
    'orders.move_table',
    'payments.manage',
    'payments.collect',
    'cash.manage',
    'tables.view',
    'tables.manage',
    'service.manage',
    'kitchen.view',
    'kitchen.manage',
    'reservations.view',
    'reservations.manage',
    'reservations.receive',
    'menu.view',
    'menu.manage',
    'inventory.view',
    'inventory.manage',
    'inventory.operations',
    'inventory.receiving',
    'reports.view',
    'analytics.view',
    'delivery.view',
    'delivery.manage',
    'promotions.manage',
    'content.manage',
    'role.preview',
    'finance.view',
    'finance.export',
    'finance.events.manage',
    'finance.journal.create',
    'finance.journal.post',
    'finance.reconcile',
    'finance.payables.manage',
    'finance.reports.view',
    'finance.approve',
    'finance.period.close',
    'finance.period.reopen',
    'finance.settings.manage',
    'payments.refund.request',
    // Granular PII / staff / settings caps (NEEM TPEL)
    'pii.view',
    'staff.view',
    'staff.manage',
    'settings.manage',
    'audit.view',
    'menu.price.update',
    'pii.view',
    'customers.phone.masked',
    'customers.directory.manage',
    'messaging.send',
    'messaging.settings.manage',
  ],
  accountant: [
    'command.view',
    'finance.view',
    'finance.export',
    'finance.events.manage',
    'finance.journal.create',
    'finance.reconcile',
    'finance.payables.manage',
    'finance.reports.view',
    'finance.period.close',
    'payments.refund.request',
    'inventory.view',
    'reports.view',
    // accountants need audit trail visibility but NOT PII or staff management
    'audit.view',
  ],
  cashier: [
    'command.view',
    'ops.view',
    'orders.view',
    'orders.create',
    'orders.manage',
    'payments.manage',
    'payments.collect',
    'payments.refund.request',
    'cash.manage',
    'reservations.view',
    'reservations.manage',
    'reservations.receive',
    'delivery.view',
    'delivery.manage',
    'tables.view',
    // cashier can see staff list (e.g. for shift assignment) but cannot manage
    'staff.view',
  ],
  waiter: [
    'ops.view',
    'orders.view',
    'orders.create',
    'orders.course.manage',
    'orders.split',
    'orders.move_table',
    'payments.collect',
    'tables.view',
    'service.manage',
    'reservations.view',
    'reservations.receive',
  ],
  kitchen: ['ops.view', 'kitchen.view', 'kitchen.manage', 'inventory.view', 'inventory.operations', 'inventory.receiving'],
  // Authenticated customer accounts keep a separate own_records surface.
  // These are not staff permissions and must never grant tenant/branch data.
  guest: ['profile.self.manage', 'wallet.self.view', 'wallet.topup', 'loyalty.self.view', 'orders.self.pay', 'campaigns.self.claim'],
});

for (const capabilities of Object.values(ROLE_CAPABILITIES)) Object.freeze(capabilities);

const ROLE_CAPABILITY_SETS = Object.freeze(
  Object.fromEntries(
    Object.entries(ROLE_CAPABILITIES).map(([role, capabilities]) => [role, new Set(capabilities)]),
  ),
);

const FULFILLMENTS = Object.freeze(['dine_in', 'pickup', 'delivery']);
const PAYMENT_STATUSES = Object.freeze(['unpaid', 'partial', 'pending', 'paid', 'failed', 'cancelled', 'refunded', 'unknown']);
const DELIVERY_ACCEPTANCE_ACTOR_ROLES = new Set(['owner', 'manager', 'cashier']);
const DELIVERY_KITCHEN_STATUSES = new Set(['sent_to_kitchen', 'preparing', 'ready', 'dispatched', 'delivered']);
const PRE_KITCHEN_EDIT_STATUSES = new Set(['pay_at_cashier', 'awaiting_confirmation', 'sent_to_kitchen']);
const KITCHEN_ELIGIBLE_PAYMENT_STATUSES = new Set(['unpaid', 'partial', 'failed', 'paid']);
const SETTLEABLE_ORDER_STATUSES = new Set([
  'pay_at_cashier', 'awaiting_confirmation', 'sent_to_kitchen', 'preparing', 'ready', 'done',
  'picked_up', 'delivered',
]);

function canEditOrderBeforeKitchen(order) {
  if (!order || order.startedAt || order.paymentMethod === 'online') return false;
  if (['partial', 'pending', 'paid', 'refunded', 'unknown'].includes(paymentStatusFor(order))) return false;
  const received = Math.max(
    Number(order.amountPaid) || 0,
    (Array.isArray(order.partialPayments) ? order.partialPayments : [])
      .reduce((sum, payment) => sum + Math.max(0, Number(payment?.amount) || 0), 0),
  );
  if (received > 0) return false;
  return PRE_KITCHEN_EDIT_STATUSES.has(String(order.status || ''));
}

function canSettleOrder(order) {
  if (!order || !SETTLEABLE_ORDER_STATUSES.has(String(order.status || ''))) return false;
  // An outstanding gateway attempt or unreconciled/reversed payment cannot
  // safely accept another tender. Partial and failed attempts remain payable.
  if (['paid', 'pending', 'refunded', 'unknown'].includes(paymentStatusFor(order))) return false;
  const fulfillment = String(order.fulfillment || '').toLowerCase();
  if (order.status === 'delivered' && fulfillment !== 'delivery') return false;
  if (order.status === 'picked_up' && fulfillment !== 'pickup') return false;
  if (order.status === 'done' && fulfillment !== 'dine_in') return false;
  return true;
}

function normalizeRole(role, adminPhones = [], phone = '') {
  if (Array.isArray(adminPhones) && adminPhones.includes(phone)) return 'owner';
  if (typeof role !== 'string') return 'guest';
  const value = role.trim().toLowerCase();
  if (value === 'admin') return 'owner';
  if (Object.prototype.hasOwnProperty.call(ROLE_CAPABILITIES, value)) return value;
  return 'guest';
}

function capabilitiesFor(user, settings = {}) {
  const role = normalizeRole(user?.role, settings.adminPhones || [], user?.phone || '');
  return ROLE_CAPABILITIES[role] || [];
}

function branchScopeForUser(user, { adminPhones = [], role = null } = {}) {
  const effective = normalizeRole(role || user?.role, adminPhones, user?.phone || '');
  if (effective === 'owner') return null;
  const hasExplicitList = Array.isArray(user?.allowedBranchIds) || Array.isArray(user?.branchIds);
  const raw = Array.isArray(user?.allowedBranchIds)
    ? user.allowedBranchIds
    : Array.isArray(user?.branchIds)
      ? user.branchIds
      : user?.branchId == null || user.branchId === '' ? null : [user.branchId];
  // An omitted branch assignment is not an implicit all-branch grant. Only
  // owners are global; staff must receive an explicit branch scope.
  if (raw === null) return [];
  const branchIds = [...new Set(raw.map(Number).filter((value) => Number.isSafeInteger(value) && value > 0))];
  return hasExplicitList || branchIds.length ? branchIds : [];
}

function can(user, capability, settings = {}) {
  if (!user || typeof user !== 'object' || Array.isArray(user)) return false;
  const role = normalizeRole(user?.role, settings.adminPhones || [], user?.phone || '');
  const capabilities = ROLE_CAPABILITY_SETS[role] || ROLE_CAPABILITY_SETS.guest;
  return capabilities.has('*') || capabilities.has(capability);
}

function roleLabel(role) {
  return (
    {
      owner: 'مالک',
      manager: 'مدیر',
      accountant: 'حسابدار',
      cashier: 'صندوق',
      waiter: 'گارسون',
      kitchen: 'آشپزخانه',
      guest: 'مهمان',
    }[normalizeRole(role)] || 'مهمان'
  );
}

function fulfillmentLabel(kind) {
  return (
    {
      dine_in: 'داخل مجموعه',
      pickup: 'تحویل حضوری',
      delivery: 'ارسال با پیک',
    }[kind] || 'نامشخص'
  );
}

function normalizeFulfillment(value, { tableNo = '' } = {}) {
  const kind = String(value || '').trim();
  if (FULFILLMENTS.includes(kind)) return kind;
  return tableNo ? 'dine_in' : 'pickup';
}

function paymentStatusFor(order) {
  if (PAYMENT_STATUSES.includes(order?.paymentStatus)) return order.paymentStatus;
  if (order?.status === 'pending_online') return 'pending';
  if (['paid', 'sent_to_kitchen', 'preparing', 'ready', 'dispatched', 'picked_up', 'delivered', 'done', 'cancelled'].includes(String(order?.status || ''))) return 'unknown';
  return 'unpaid';
}

function initialOrderStatus({ paymentMethod = 'cashier', fulfillment = 'dine_in' } = {}) {
  if (paymentMethod === 'online') return 'pending_online';
  if (fulfillment === 'delivery') return 'awaiting_confirmation';
  return 'pay_at_cashier';
}

function hasAcceptedDelivery(order) {
  if (normalizeFulfillment(order?.fulfillment, { tableNo: order?.tableNo }) !== 'delivery') return true;
  const acceptance = order?.deliveryAcceptance;
  const acceptedAt = isValidDeliveryAcceptanceTimestamp(acceptance?.acceptedAt)
    ? Date.parse(acceptance.acceptedAt)
    : NaN;
  const acceptedBy = acceptance?.acceptedBy;
  return acceptance?.status === 'accepted'
    && acceptance.source === 'restaurant'
    && Number.isFinite(acceptedAt)
    && acceptedAt > 0
    && acceptedAt <= Date.now()
    && typeof acceptance.reference === 'string'
    && /^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$/.test(acceptance.reference)
    && typeof acceptedBy?.phone === 'string'
    && acceptedBy.phone.trim().length > 0
    && acceptedBy.phone.trim().length <= 64
    && DELIVERY_ACCEPTANCE_ACTOR_ROLES.has(String(acceptedBy.role || '').trim().toLowerCase())
    && deliveryAcceptancePrecedesKitchen(order, acceptedAt);
}

function isValidDeliveryAcceptanceTimestamp(value) {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/u.exec(value);
  if (!match || !Number.isFinite(Date.parse(value))) return false;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth[month - 1]
    && hour <= 23 && minute <= 59 && second <= 59;
}

function deliveryAcceptancePrecedesKitchen(order, acceptedAt) {
  if (!Number.isFinite(acceptedAt)) return false;
  const handoffEvents = (Array.isArray(order?.statusHistory) ? order.statusHistory : [])
    .filter((entry) => DELIVERY_KITCHEN_STATUSES.has(String(entry?.status || '').trim().toLowerCase()));
  const startTimes = [];
  for (const event of handoffEvents) {
    const at = isValidDeliveryAcceptanceTimestamp(event?.at) ? Date.parse(event.at) : NaN;
    if (!Number.isFinite(at) || at <= 0 || at > Date.now()) return false;
    startTimes.push(at);
  }
  if (order?.startedAt != null && order.startedAt !== '') {
    const startedAt = isValidDeliveryAcceptanceTimestamp(order.startedAt) ? Date.parse(order.startedAt) : NaN;
    if (!Number.isFinite(startedAt) || startedAt <= 0 || startedAt > Date.now()) return false;
    startTimes.push(startedAt);
  }
  const currentStatus = String(order?.status || '').trim().toLowerCase();
  if (DELIVERY_KITCHEN_STATUSES.has(currentStatus)
    && !handoffEvents.some((event) => String(event?.status || '').trim().toLowerCase() === currentStatus)
    && !order?.startedAt) {
    const statusAt = isValidDeliveryAcceptanceTimestamp(order.statusAt) ? Date.parse(order.statusAt) : NaN;
    if (!Number.isFinite(statusAt) || statusAt <= 0 || statusAt > Date.now()) return false;
    startTimes.push(statusAt);
  }
  return startTimes.every((at) => acceptedAt <= at);
}

function nextOrderStatusAfterPayment(order) {
  if (!order || paymentStatusFor(order) !== 'paid') return null;
  const status = String(order.status || '');
  const fulfillment = normalizeFulfillment(order.fulfillment, { tableNo: order.tableNo });
  if (fulfillment === 'delivery') {
    if (['pending_online', 'awaiting_confirmation', 'pay_at_cashier'].includes(status)) {
      if (hasAcceptedDelivery(order)) return 'sent_to_kitchen';
      return status === 'pending_online' ? 'awaiting_confirmation' : null;
    }
    return null;
  }
  return ['pending_online', 'awaiting_confirmation', 'pay_at_cashier'].includes(status) ? 'paid' : null;
}

function nextOrderStatusAfterDeliveryAcceptance(order) {
  if (!order || normalizeFulfillment(order.fulfillment, { tableNo: order.tableNo }) !== 'delivery') return null;
  if (!hasAcceptedDelivery(order) || !KITCHEN_ELIGIBLE_PAYMENT_STATUSES.has(paymentStatusFor(order))) return null;
  return ['pending_online', 'awaiting_confirmation', 'pay_at_cashier', 'paid'].includes(String(order.status || ''))
    ? 'sent_to_kitchen'
    : null;
}

function allowedOrderTransitions(order) {
  const status = String(order?.status || 'pending_online');
  const fulfillment = normalizeFulfillment(order?.fulfillment, { tableNo: order?.tableNo });
  const payment = paymentStatusFor(order);
  const canMarkPaid = payment === 'paid';
  const acceptedDelivery = hasAcceptedDelivery(order);
  const deliveryNextAfterPayment = nextOrderStatusAfterPayment(order);
  const deliveryNextAfterAcceptance = nextOrderStatusAfterDeliveryAcceptance(order);
  const map = {
    pending_online: fulfillment === 'delivery'
      ? [...new Set([deliveryNextAfterPayment, deliveryNextAfterAcceptance, 'cancelled'].filter(Boolean))]
      : payment === 'paid' ? ['paid', 'cancelled'] : ['cancelled'],
    // `paid` is a financial state, not a status-only operator action. The
    // status endpoints also validate settlement; keep this helper's contract
    // aligned so unpaid/partial orders never advertise the transition.
    awaiting_confirmation: fulfillment === 'delivery'
      ? [...new Set([deliveryNextAfterPayment, deliveryNextAfterAcceptance, 'cancelled'].filter(Boolean))]
      : canMarkPaid ? ['paid', 'cancelled'] : ['cancelled'],
    pay_at_cashier: fulfillment === 'delivery'
      ? [...new Set([deliveryNextAfterPayment, deliveryNextAfterAcceptance, 'cancelled'].filter(Boolean))]
      : canMarkPaid ? ['paid', 'sent_to_kitchen', 'cancelled'] : ['sent_to_kitchen', 'cancelled'],
    sent_to_kitchen: fulfillment === 'delivery' && !acceptedDelivery ? ['cancelled'] : ['preparing', 'cancelled'],
    paid: fulfillment === 'delivery'
      ? acceptedDelivery ? ['sent_to_kitchen', 'preparing', 'cancelled'] : ['cancelled']
      : canMarkPaid ? ['preparing', 'cancelled'] : ['cancelled'],
    preparing: fulfillment === 'delivery' && !acceptedDelivery ? ['cancelled'] : ['ready', 'cancelled'],
    ready:
      fulfillment === 'delivery' && !acceptedDelivery
        ? ['cancelled']
        : fulfillment === 'delivery'
        ? ['dispatched', 'cancelled']
        : fulfillment === 'pickup'
          ? ['picked_up', 'cancelled']
          : ['done', 'cancelled'],
    // Dispatch is a delivery-only handoff. Corrupt/legacy records with a
    // different fulfillment may still be cancelled, but cannot be marked
    // delivered through this state machine.
    dispatched: fulfillment === 'delivery' && acceptedDelivery ? ['delivered', 'cancelled'] : ['cancelled'],
    picked_up: [],
    delivered: [],
    done: [],
    cancelled: [],
  };
  return map[status] || [];
}

function canTransitionOrder(order, nextStatus) {
  const next = String(nextStatus || '');
  const fulfillment = normalizeFulfillment(order?.fulfillment, { tableNo: order?.tableNo });
  if (fulfillment === 'delivery' && DELIVERY_KITCHEN_STATUSES.has(next) && !hasAcceptedDelivery(order)) return false;
  return allowedOrderTransitions(order).includes(next);
}

function quoteFulfillment({ fulfillment, subtotal, zone, branchId } = {}) {
  const kind = normalizeFulfillment(fulfillment);
  const amount = parseNonnegativeSafeInteger(subtotal);
  if (amount === null) {
    return { ok: false, code: 'order_amount_invalid', message: 'مبلغ سفارش معتبر نیست' };
  }
  if (kind !== 'delivery') {
    return {
      ok: true,
      fulfillment: kind,
      deliveryFee: 0,
      total: amount,
      zone: null,
      etaMinutes: kind === 'pickup' ? 20 : 0,
    };
  }
  if (!zone || zone.active === false || (branchId && Number(zone.branchId) !== Number(branchId))) {
    return { ok: false, code: 'delivery_zone_unavailable', message: 'محدودهٔ ارسال انتخاب‌شده فعال نیست' };
  }
  const minimum = zone.minOrder == null ? 0 : parseNonnegativeSafeInteger(zone.minOrder);
  if (minimum === null) {
    return { ok: false, code: 'delivery_zone_invalid', message: 'تنظیمات محدودهٔ ارسال معتبر نیست' };
  }
  if (amount < minimum) {
    return {
      ok: false,
      code: 'delivery_minimum_not_met',
      message: `حداقل سفارش برای این محدوده ${formatNumber(minimum)} تومان است`,
      minimum,
    };
  }
  const deliveryFee = parseNonnegativeSafeInteger(zone.fee);
  if (deliveryFee === null) {
    return { ok: false, code: 'delivery_fee_invalid', message: 'هزینهٔ ارسال معتبر نیست' };
  }
  if (!Number.isSafeInteger(amount + deliveryFee)) {
    return { ok: false, code: 'order_amount_unsafe', message: 'مبلغ سفارش از محدودهٔ مجاز بیشتر است' };
  }
  return {
    ok: true,
    fulfillment: kind,
    deliveryFee,
    total: amount + deliveryFee,
    zone: {
      id: zone.id,
      name: zone.name,
      minimum,
      fee: deliveryFee,
      etaMinutes: Math.max(0, Number(zone.etaMinutes) || 0),
    },
    etaMinutes: Math.max(0, Number(zone.etaMinutes) || 0),
  };
}

function parseNonnegativeSafeInteger(value) {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0 ? value : null;
  if (typeof value !== 'string' || !/^\d+$/u.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function nextId(items) {
  return Math.max(0, ...(items || []).map((item) => Number(item?.id) || 0)) + 1;
}

function createAuditEntry({ actor, action, targetType, targetId, branchId, meta, at = new Date().toISOString() } = {}) {
  return {
    id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
    at,
    actor: actor
      ? {
          phone: String(actor.phone || ''),
          role: normalizeRole(actor.role, [], actor.phone),
          name: String(actor.name || ''),
        }
      : null,
    action: String(action || 'unknown').slice(0, 120),
    targetType: String(targetType || 'system').slice(0, 80),
    targetId: targetId == null ? null : String(targetId).slice(0, 120),
    branchId: branchId == null ? null : Number(branchId),
    meta: meta && typeof meta === 'object' ? meta : {},
  };
}

function createEventHub({ heartbeatMs = 25000 } = {}) {
  const clients = new Set();
  const intervalMs = Math.max(5000, Number(heartbeatMs) || 25000);

  const isWritable = (client) => {
    const res = client?.res;
    return !!res && !client.closed && !res.destroyed && !res.writableEnded;
  };

  const cleanup = (client) => {
    if (!client || client.closed) return;
    client.closed = true;
    if (client.heartbeat) {
      clearInterval(client.heartbeat);
      client.heartbeat = null;
    }
    clients.delete(client);
  };

  const write = (client, chunk) => {
    if (!isWritable(client)) {
      cleanup(client);
      return false;
    }
    try {
      client.res.write(chunk);
      return true;
    } catch (_) {
      cleanup(client);
      return false;
    }
  };

  const send = (client, event) => {
    if (!isWritable(client)) {
      cleanup(client);
      return false;
    }

    try {
      if (client.filter && !client.filter(event)) return true;
    } catch (_) {
      // A malformed per-client filter must never break publication for every
      // connected admin. Treat it as a non-match for this client/event only.
      return true;
    }

    const type = String(event?.type || 'message').replace(/[\r\n]+/g, ' ').slice(0, 120) || 'message';
    let payload;
    try {
      payload = JSON.stringify(event);
    } catch (_) {
      return true;
    }
    return write(client, `event: ${type}\ndata: ${payload}\n\n`);
  };

  return {
    subscribe(req, res, filter) {
      res.status(200);
      res.set({
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      res.flushHeaders?.();
      res.socket?.setKeepAlive?.(true);

      const client = {
        res,
        filter: typeof filter === 'function' ? filter : null,
        heartbeat: null,
        closed: false,
      };
      clients.add(client);

      const close = () => cleanup(client);
      req.once('aborted', close);
      req.once('close', close);
      res.once('close', close);
      res.once('error', close);

      if (!send(client, { type: 'connected', at: new Date().toISOString() })) {
        return close;
      }

      client.heartbeat = setInterval(() => {
        write(client, ': ping\n\n');
      }, intervalMs);
      client.heartbeat.unref?.();

      return close;
    },

    publish(type, payload = {}, permission = 'ops.view') {
      const event = { type, permission, at: new Date().toISOString(), payload };
      // Snapshot iteration keeps delivery deterministic even when a failed
      // write removes a client during this publication pass.
      Array.from(clients).forEach((client) => send(client, event));
      return event;
    },

    size() {
      return clients.size;
    },
  };
}

function isOwnerActor(db, user) {
  if (!user) return false;
  const adminPhones = Array.isArray(db?.settings?.adminPhones)
    ? db.settings.adminPhones.map(String)
    : [];
  const normalized = normalizeRole(user.role, adminPhones, user.phone || '');
  return normalized === 'owner';
}

function assertStaffMutationBoundary(db, actorOrReq, target, { allowSelf = false } = {}) {
  const actor = (actorOrReq && actorOrReq.user) ? actorOrReq.user : actorOrReq;
  const actorIsOwner = isOwnerActor(db, actor);
  const targetIsOwner = isOwnerActor(db, target);
  if (targetIsOwner && !actorIsOwner) {
    const error = new Error('حساب مالک فقط توسط مالک قابل مدیریت است.');
    error.code = 'staff_owner_protected';
    error.status = 403;
    throw error;
  }
  const targetRole = String(target?.role || '').toLowerCase();
  if (!actorIsOwner && targetRole === 'manager') {
    const error = new Error('حساب مدیر فقط توسط مالک قابل مدیریت است.');
    error.code = 'staff_manager_protected';
    error.status = 403;
    throw error;
  }
  if (!allowSelf && actor?.phone && target?.phone && String(actor.phone) === String(target.phone)) {
    const error = new Error('کاربر جاری را نمی‌توان از مسیر مدیریت کارکنان حذف یا مسدود کرد.');
    error.code = 'staff_self_protected';
    error.status = 400;
    throw error;
  }
}

module.exports = {
  ROLE_CAPABILITIES,
  FULFILLMENTS,
  PAYMENT_STATUSES,
  normalizeRole,
  capabilitiesFor,
  branchScopeForUser,
  can,
  roleLabel,
  fulfillmentLabel,
  normalizeFulfillment,
  paymentStatusFor,
  initialOrderStatus,
  hasAcceptedDelivery,
  nextOrderStatusAfterPayment,
  nextOrderStatusAfterDeliveryAcceptance,
  allowedOrderTransitions,
  canTransitionOrder,
  canEditOrderBeforeKitchen,
  canSettleOrder,
  quoteFulfillment,
  nextId,
  createAuditEntry,
  createEventHub,
  isOwnerActor,
  assertStaffMutationBoundary,
};
