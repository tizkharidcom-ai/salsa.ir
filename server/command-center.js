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
const { formatNumber } = require('./finance/money');

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
    'payments.manage',
    'cash.manage',
    'tables.view',
    'service.manage',
    'kitchen.view',
    'kitchen.manage',
    'reservations.view',
    'reservations.manage',
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
  ],
  accountant: [
    'command.view',
    'finance.view',
    'finance.events.manage',
    'finance.journal.create',
    'finance.reconcile',
    'finance.payables.manage',
    'finance.reports.view',
    'finance.period.close',
    'inventory.view',
    'reports.view',
  ],
  cashier: [
    'command.view',
    'ops.view',
    'orders.view',
    'orders.create',
    'orders.manage',
    'payments.manage',
    'cash.manage',
    'reservations.view',
    'reservations.manage',
    'delivery.view',
    'delivery.manage',
    'tables.view',
  ],
  waiter: [
    'ops.view',
    'orders.view',
    'orders.create',
    'tables.view',
    'service.manage',
    'reservations.view',
  ],
  kitchen: ['ops.view', 'kitchen.view', 'kitchen.manage', 'inventory.view', 'inventory.operations', 'inventory.receiving'],
  guest: [],
});

const ROLE_CAPABILITY_SETS = Object.freeze(
  Object.fromEntries(
    Object.entries(ROLE_CAPABILITIES).map(([role, capabilities]) => [role, new Set(capabilities)]),
  ),
);

const FULFILLMENTS = Object.freeze(['dine_in', 'pickup', 'delivery']);
const PAYMENT_STATUSES = Object.freeze(['unpaid', 'partial', 'pending', 'paid', 'failed', 'cancelled', 'refunded']);
const PRE_KITCHEN_EDIT_STATUSES = new Set(['pay_at_cashier', 'awaiting_confirmation', 'sent_to_kitchen', 'paid']);

function canEditOrderBeforeKitchen(order) {
  if (!order || order.startedAt || order.paymentMethod === 'online') return false;
  return PRE_KITCHEN_EDIT_STATUSES.has(String(order.status || ''));
}

function normalizeRole(role, adminPhones = [], phone = '') {
  if (Array.isArray(adminPhones) && adminPhones.includes(phone)) return 'owner';
  const value = String(role || '').trim().toLowerCase();
  if (value === 'admin') return 'owner';
  if (Object.prototype.hasOwnProperty.call(ROLE_CAPABILITIES, value)) return value;
  return 'guest';
}

function capabilitiesFor(user, settings = {}) {
  const role = normalizeRole(user?.role, settings.adminPhones || [], user?.phone || '');
  return ROLE_CAPABILITIES[role] || [];
}

function branchScopeForUser(user, { adminPhones = [], role = null } = {}) {
  const effective = role || normalizeRole(user?.role, adminPhones, user?.phone || '');
  if (effective === 'owner') return null;
  const hasExplicitList = Array.isArray(user?.allowedBranchIds) || Array.isArray(user?.branchIds);
  const raw = Array.isArray(user?.allowedBranchIds)
    ? user.allowedBranchIds
    : Array.isArray(user?.branchIds)
      ? user.branchIds
      : user?.branchId == null || user.branchId === '' ? null : [user.branchId];
  if (raw === null) return null;
  const branchIds = [...new Set(raw.map(Number).filter((value) => Number.isSafeInteger(value) && value > 0))];
  return hasExplicitList || branchIds.length ? branchIds : [];
}

function can(user, capability, settings = {}) {
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
  if (order?.status === 'paid' || order?.status === 'preparing' || order?.status === 'ready' || order?.status === 'done') return 'paid';
  if (order?.status === 'pending_online') return 'pending';
  return 'unpaid';
}

function initialOrderStatus({ paymentMethod = 'cashier', fulfillment = 'dine_in' } = {}) {
  if (paymentMethod === 'online') return 'pending_online';
  if (fulfillment === 'delivery') return 'awaiting_confirmation';
  return 'pay_at_cashier';
}

function allowedOrderTransitions(order) {
  const status = String(order?.status || 'pending_online');
  const fulfillment = normalizeFulfillment(order?.fulfillment, { tableNo: order?.tableNo });
  const payment = paymentStatusFor(order);
  const map = {
    pending_online: payment === 'paid' ? ['paid', 'cancelled'] : ['cancelled'],
    awaiting_confirmation: ['paid', 'cancelled'],
    pay_at_cashier: ['paid', 'cancelled'],
    sent_to_kitchen: ['preparing', 'cancelled'],
    paid: ['preparing', 'cancelled'],
    preparing: ['ready', 'cancelled'],
    ready:
      fulfillment === 'delivery'
        ? ['dispatched', 'cancelled']
        : fulfillment === 'pickup'
          ? ['picked_up', 'cancelled']
          : ['done', 'cancelled'],
    dispatched: ['delivered', 'cancelled'],
    picked_up: [],
    delivered: [],
    done: [],
    cancelled: [],
  };
  return map[status] || [];
}

function canTransitionOrder(order, nextStatus) {
  return allowedOrderTransitions(order).includes(String(nextStatus || ''));
}

function quoteFulfillment({ fulfillment, subtotal, zone, branchId } = {}) {
  const kind = normalizeFulfillment(fulfillment);
  const amount = Math.max(0, Number(subtotal) || 0);
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
  const minimum = Math.max(0, Number(zone.minOrder) || 0);
  if (amount < minimum) {
    return {
      ok: false,
      code: 'delivery_minimum_not_met',
      message: `حداقل سفارش برای این محدوده ${formatNumber(minimum)} تومان است`,
      minimum,
    };
  }
  const deliveryFee = Math.max(0, Number(zone.fee) || 0);
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
  allowedOrderTransitions,
  canTransitionOrder,
  canEditOrderBeforeKitchen,
  quoteFulfillment,
  nextId,
  createAuditEntry,
  createEventHub,
};
