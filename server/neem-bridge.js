/*
 * WESTO → NEEM bridge.
 *
 * This module deliberately knows nothing about the public menu UI.  It only
 * mirrors completed operational facts (orders, payments, customers and point
 * balances) to NEEM's server-to-server endpoint.  Failed deliveries stay in
 * WESTO's JSON outbox and never delay a customer checkout.
 */
const crypto = require('crypto');

const DEFAULT_ENDPOINT = 'http://127.0.0.1:4300/api/integrations/westo/events';
const MAX_EVENTS = 5000;

function normalizedIntegrationState(db) {
  if (!db.neemIntegration || typeof db.neemIntegration !== 'object') {
    db.neemIntegration = {};
  }
  const state = db.neemIntegration;
  if (!Array.isArray(state.outbox)) state.outbox = [];
  if (typeof state.enabled !== 'boolean') state.enabled = true;
  if (typeof state.endpoint !== 'string') state.endpoint = '';
  if (typeof state.lastError !== 'string') state.lastError = '';
  return state;
}

function stableEventId(order, payment) {
  const revision = [
    order.id,
    order.status,
    order.statusAt,
    order.paymentStatus,
    payment?.id || '',
    payment?.status || '',
    payment?.updatedAt || '',
    order.loyaltyPoints || 0,
  ].join('|');
  return `westo-order-${order.id}-${crypto.createHash('sha256').update(revision).digest('hex').slice(0, 20)}`;
}

function compactOrder(order) {
  return {
    id: Number(order.id),
    orderNo: String(order.orderNo || ''),
    tableNo: String(order.tableNo || ''),
    branchId: Number(order.branchId),
    fulfillment: String(order.fulfillment || 'dine_in'),
    paymentMethod: String(order.paymentMethod || 'cashier'),
    paymentStatus: String(order.paymentStatus || 'unpaid'),
    status: String(order.status || 'new'),
    subtotal: Number(order.subtotal || 0),
    deliveryFee: Number(order.deliveryFee || 0),
    total: Number(order.total || 0),
    note: String(order.note || '').slice(0, 240),
    createdAt: order.createdAt || new Date().toISOString(),
    statusAt: order.statusAt || order.createdAt || new Date().toISOString(),
    items: (Array.isArray(order.items) ? order.items : []).map((item) => ({
      menuItemId: Number(item.menuItemId),
      name: String(item.name || ''),
      price: Number(item.price || 0),
      qty: Number(item.qty || 0),
      lineTotal: Number(item.lineTotal || 0),
    })),
  };
}

function compactPayment(payment) {
  if (!payment) return null;
  return {
    id: Number(payment.id),
    provider: String(payment.provider || 'cashier'),
    mode: String(payment.mode || ''),
    amount: Number(payment.amount || 0),
    status: String(payment.status || 'pending'),
    reference: String(payment.reference || ''),
    createdAt: payment.createdAt || new Date().toISOString(),
    updatedAt: payment.updatedAt || payment.createdAt || new Date().toISOString(),
  };
}

function createNeemBridge({ getDb, persist, logger = console }) {
  let flushing = false;

  function configuration() {
    const db = getDb();
    const state = normalizedIntegrationState(db);
    return {
      state,
      endpoint: process.env.NEEM_BRIDGE_URL || state.endpoint || DEFAULT_ENDPOINT,
      secret: process.env.WESTO_NEEM_BRIDGE_SECRET || '',
      enabled: state.enabled !== false && process.env.NEEM_BRIDGE_ENABLED !== 'false',
    };
  }

  function enqueueOrder(order, payment = null) {
    if (!order || !Number.isFinite(Number(order.id))) return null;
    const db = getDb();
    const state = normalizedIntegrationState(db);
    const user = (db.users || []).find((candidate) => candidate.phone === order.phone) || null;
    const branch = (db.branches || []).find((candidate) => Number(candidate.id) === Number(order.branchId)) || null;
    const eventId = stableEventId(order, payment);
    if (state.outbox.some((event) => event.id === eventId)) return eventId;

    state.outbox.push({
      id: eventId,
      type: 'westo.order.upsert',
      payload: {
        eventId,
        type: 'westo.order.upsert',
        occurredAt: new Date().toISOString(),
        source: 'WESTO-v1.2',
        order: compactOrder(order),
        payment: compactPayment(payment),
        branch: branch ? {
          id: Number(branch.id),
          code: String(branch.slug || `branch-${branch.id}`),
          name: String(branch.name || `شعبه ${branch.id}`),
          address: String(branch.address || ''),
          phone: String(branch.phone || ''),
        } : { id: Number(order.branchId || 1), code: `branch-${order.branchId || 1}`, name: 'شعبه WESTO' },
        customer: order.phone ? {
          phone: String(order.phone),
          name: String(order.name || user?.name || '').slice(0, 120),
          points: Number(user?.points || 0),
          lastOrderId: Number(order.id),
        } : null,
      },
      queuedAt: new Date().toISOString(),
      attempts: 0,
      deliveredAt: null,
      lastError: '',
    });
    if (state.outbox.length > MAX_EVENTS) state.outbox.splice(0, state.outbox.length - MAX_EVENTS);
    persist();
    void flush();
    return eventId;
  }

  function queueBackfill() {
    const db = getDb();
    let queued = 0;
    for (const order of db.orders || []) {
      const payment = (db.paymentAttempts || []).find((candidate) => Number(candidate.orderId) === Number(order.id)) || null;
      const before = normalizedIntegrationState(db).outbox.length;
      enqueueOrder(order, payment);
      if (normalizedIntegrationState(db).outbox.length > before) queued++;
    }
    return queued;
  }

  async function deliver(event, endpoint, secret) {
    const raw = JSON.stringify(event.payload);
    const timestamp = String(Date.now());
    const signature = crypto.createHmac('sha256', secret).update(`${timestamp}.${raw}`).digest('hex');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-westo-bridge-timestamp': timestamp,
          'x-westo-bridge-signature': signature,
        },
        body: raw,
        signal: controller.signal,
      });
      const body = await response.text();
      if (!response.ok) throw new Error(`NEEM پاسخ ${response.status}: ${body.slice(0, 240)}`);
      return body;
    } finally {
      clearTimeout(timeout);
    }
  }

  async function flush() {
    if (flushing) return;
    flushing = true;
    try {
      const { state, endpoint, secret, enabled } = configuration();
      if (!enabled) return;
      if (!secret) {
        state.lastError = 'WESTO_NEEM_BRIDGE_SECRET تنظیم نشده است.';
        persist();
        return;
      }
      const pending = state.outbox.filter((event) => !event.deliveredAt).slice(0, 20);
      for (const event of pending) {
        try {
          await deliver(event, endpoint, secret);
          event.deliveredAt = new Date().toISOString();
          event.lastError = '';
          state.lastSuccessAt = event.deliveredAt;
          state.lastError = '';
        } catch (error) {
          event.attempts = Number(event.attempts || 0) + 1;
          event.lastError = error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300);
          state.lastError = event.lastError;
          logger.warn?.(`[neem-bridge] delivery failed for ${event.id}: ${event.lastError}`);
          break; // preserve event order for accounting consistency
        }
      }
      // Delivered events are retained briefly for auditability, then pruned.
      const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
      state.outbox = state.outbox.filter((event) => !event.deliveredAt || new Date(event.deliveredAt).getTime() >= cutoff);
      persist();
    } finally {
      flushing = false;
    }
  }

  function retry() {
    const { state } = configuration();
    for (const event of state.outbox) {
      if (!event.deliveredAt) event.lastError = '';
    }
    state.lastError = '';
    persist();
    void flush();
  }

  function status() {
    const { state, endpoint, enabled } = configuration();
    const pending = state.outbox.filter((event) => !event.deliveredAt);
    return {
      enabled,
      endpoint,
      queued: pending.length,
      deliveredRetained: state.outbox.length - pending.length,
      lastSuccessAt: state.lastSuccessAt || null,
      lastError: state.lastError || null,
      recentFailures: pending.filter((event) => event.lastError).slice(0, 5).map((event) => ({ id: event.id, attempts: event.attempts, error: event.lastError })),
    };
  }

  return { enqueueOrder, queueBackfill, retry, status, flush };
}

module.exports = { createNeemBridge };
