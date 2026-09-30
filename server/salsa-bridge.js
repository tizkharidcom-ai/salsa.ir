/*
 * WESTO → SALSA bridge.
 *
 * This module deliberately knows nothing about the public menu UI.  It only
 * mirrors completed operational facts (orders, payments, customers and point
 * balances) to SALSA's server-to-server endpoint.  Failed deliveries stay in
 * WESTO's JSON outbox and never delay a customer checkout.
 */
const crypto = require('crypto');

const MAX_EVENTS = 5000;

function normalizeDigits(val) {
  return String(val || '')
    .replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d))
    .replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
}

function toNum(val, fallback = 0) {
  if (val === null || val === undefined || val === '') return fallback;
  const normalized = normalizeDigits(val);
  const n = Number(normalized);
  return Number.isFinite(n) ? n : fallback;
}

function normalizedIntegrationState(db) {
  if (!db.salsaIntegration && db.neemIntegration) {
    db.salsaIntegration = db.neemIntegration;
  }
  if (!db.salsaIntegration || typeof db.salsaIntegration !== 'object') {
    db.salsaIntegration = db.neemIntegration && typeof db.neemIntegration === 'object' ? db.neemIntegration : {};
  }
  const state = db.salsaIntegration;
  db.neemIntegration = state; // backwards compatibility alias
  if (!Array.isArray(state.outbox)) state.outbox = [];
  if (typeof state.enabled !== 'boolean') state.enabled = true;
  if (typeof state.endpoint !== 'string') state.endpoint = '';
  if (typeof state.lastError !== 'string') state.lastError = '';
  return state;
}

function stableEventId(order, payment) {
  const normId = toNum(order.id);
  const revision = [
    normId,
    order.status,
    order.statusAt,
    order.paymentStatus,
    payment?.id || '',
    payment?.status || '',
    payment?.updatedAt || '',
    order.loyaltyPoints || 0,
  ].join('|');
  return `westo-order-${normId}-${crypto.createHash('sha256').update(revision).digest('hex').slice(0, 20)}`;
}

function compactOrder(order) {
  return {
    id: toNum(order.id),
    orderNo: String(order.orderNo || ''),
    tableNo: String(order.tableNo || ''),
    branchId: toNum(order.branchId, 1),
    fulfillment: String(order.fulfillment || 'dine_in'),
    paymentMethod: String(order.paymentMethod || 'cashier'),
    paymentStatus: String(order.paymentStatus || 'unpaid'),
    status: String(order.status || 'new'),
    subtotal: toNum(order.subtotal || 0),
    deliveryFee: toNum(order.deliveryFee || 0),
    total: toNum(order.total || 0),
    note: String(order.note || '').slice(0, 240),
    createdAt: order.createdAt || new Date().toISOString(),
    statusAt: order.statusAt || order.createdAt || new Date().toISOString(),
    items: (Array.isArray(order.items) ? order.items : []).map((item) => ({
      menuItemId: toNum(item.menuItemId),
      name: String(item.name || ''),
      price: toNum(item.price || 0),
      qty: toNum(item.qty || 0),
      lineTotal: toNum(item.lineTotal || 0),
    })),
  };
}

function compactPayment(payment) {
  if (!payment) return null;
  return {
    id: toNum(payment.id),
    provider: String(payment.provider || 'cashier'),
    mode: String(payment.mode || ''),
    amount: toNum(payment.amount || 0),
    status: String(payment.status || 'pending'),
    reference: String(payment.reference || ''),
    createdAt: payment.createdAt || new Date().toISOString(),
    updatedAt: payment.updatedAt || payment.createdAt || new Date().toISOString(),
  };
}

function createSalsaBridge({ getDb, persist, logger = console, tenantConfig = null } = {}) {
  let flushing = false;

  function configuration() {
    const db = getDb();
    const state = normalizedIntegrationState(db);
    const controlPort = process.env.SALSA_CONTROL_PORT || process.env.NEEM_CONTROL_PORT || '3061';
    const defaultEndpoint = `http://127.0.0.1:${controlPort}/api/control/integrations/westo/events`;
    return {
      state,
      endpoint: process.env.SALSA_BRIDGE_URL || process.env.NEEM_BRIDGE_URL || state.endpoint || defaultEndpoint,
      secret: process.env.WESTO_SALSA_BRIDGE_SECRET || process.env.WESTO_NEEM_BRIDGE_SECRET || '',
      enabled: state.enabled !== false && (process.env.SALSA_BRIDGE_ENABLED || process.env.NEEM_BRIDGE_ENABLED) !== 'false',
    };
  }

  function enqueueOrder(order, payment = null) {
    if (!order) return null;
    const normId = toNum(order.id, null);
    if (normId === null || !Number.isFinite(normId)) return null;
    const db = getDb();
    const state = normalizedIntegrationState(db);
    const user = (db.users || []).find((candidate) => candidate.phone === order.phone) || null;
    const branch = (db.branches || []).find((candidate) => Number(candidate.id) === Number(toNum(order.branchId))) || null;
    const eventId = stableEventId(order, payment);
    if (state.outbox.some((event) => event.id === eventId)) return eventId;

    const tenantId = tenantConfig?.tenantId || state.tenantId || 'westo';
    const sequence = (state.outbox.length > 0 ? (state.outbox[state.outbox.length - 1].sequence || 0) : 0) + 1;

    const orderPayload = compactOrder(order);
    const paymentPayload = compactPayment(payment);
    const branchPayload = branch ? {
      id: Number(branch.id),
      code: String(branch.slug || `branch-${branch.id}`),
      name: String(branch.name || `شعبه ${branch.id}`),
      address: String(branch.address || ''),
      phone: String(branch.phone || ''),
    } : { id: Number(toNum(order.branchId, 1)), code: `branch-${toNum(order.branchId, 1)}`, name: 'شعبه WESTO' };
    const customerPayload = order.phone ? {
      phone: String(order.phone),
      name: String(order.name || user?.name || '').slice(0, 120),
      points: Number(user?.points || 0),
      lastOrderId: normId,
    } : null;

    const payloadBody = {
      eventId,
      type: 'westo.order.upsert',
      occurredAt: new Date().toISOString(),
      source: 'WESTO-v1.2',
      order: orderPayload,
      payment: paymentPayload,
      branch: branchPayload,
      customer: customerPayload,
    };

    state.outbox.push({
      id: eventId,
      type: 'westo.order.upsert',
      tenantId,
      sequence,
      payload: {
        ...payloadBody,
        schemaVersion: 1,
        tenantId,
        payload: payloadBody,
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
    const tenantId = tenantConfig?.tenantId || event.tenantId || 'westo';
    const payloadObj = { ...(event.payload || {}) };
    if (!payloadObj.tenantId) {
      payloadObj.tenantId = tenantId;
    }
    const raw = JSON.stringify(payloadObj);
    const timestamp = String(Date.now());
    const signature = crypto.createHmac('sha256', secret).update(`${timestamp}.${raw}`).digest('hex');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-salsa-tenant-id': tenantId,
          'x-neem-tenant-id': tenantId,
          'x-salsa-sync-version': String(payloadObj.schemaVersion || 1),
          'x-neem-sync-version': String(payloadObj.schemaVersion || 1),
          'x-westo-bridge-timestamp': timestamp,
          'x-westo-bridge-signature': signature,
        },
        body: raw,
        signal: controller.signal,
      });
      const body = await response.text();
      if (!response.ok) throw new Error(`SALSA پاسخ ${response.status}: ${body.slice(0, 240)}`);
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
        state.lastError = 'WESTO_SALSA_BRIDGE_SECRET تنظیم نشده است.';
        persist();
        return;
      }
      const pending = state.outbox.filter((event) => !event.deliveredAt).slice(0, 20);
      let deliveredCount = 0;
      for (const event of pending) {
        try {
          await deliver(event, endpoint, secret);
          event.deliveredAt = new Date().toISOString();
          event.lastError = '';
          state.lastSuccessAt = event.deliveredAt;
          state.lastError = '';
          deliveredCount++;
        } catch (error) {
          event.attempts = Number(event.attempts || 0) + 1;
          event.lastError = error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300);
          state.lastError = event.lastError;
          logger.warn?.(`[salsa-bridge] delivery failed for ${event.id}: ${event.lastError}`);
          break; // preserve event order for accounting consistency
        }
      }
      // Delivered events are retained briefly for auditability, then pruned.
      const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
      state.outbox = state.outbox.filter((event) => !event.deliveredAt || new Date(event.deliveredAt).getTime() >= cutoff);
      persist();
      if (deliveredCount > 0 && state.outbox.some((event) => !event.deliveredAt)) {
        setImmediate(() => { void flush(); });
      }
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

const createNeemBridge = createSalsaBridge;

module.exports = {
  createSalsaBridge,
  createNeemBridge,
};
