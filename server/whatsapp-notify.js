/* WhatsApp order/reservation notify helpers */

const DEFAULT_WEBHOOK_TIMEOUT_MS = 2500;
const MIN_WEBHOOK_TIMEOUT_MS = 500;
const MAX_WEBHOOK_TIMEOUT_MS = 10000;
const MAX_LOG_ENTRIES = 200;

function toWaDigits(phone) {
  let d = String(phone || '').replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('0') && d.length === 11) d = `98${d.slice(1)}`;
  if (d.length === 10 && d.startsWith('9')) d = `98${d}`;
  return d;
}

function waMeUrl(phone, text) {
  const digits = toWaDigits(phone);
  if (!digits) return null;
  const q = text ? `?text=${encodeURIComponent(text)}` : '';
  return `https://wa.me/${digits}${q}`;
}

function formatMoney(n) {
  return `${Number(n || 0).toLocaleString('fa-IR')} تومان`;
}

function buildOrderMessage(order, ctx = {}) {
  const brand = ctx.brand || 'وستو';
  const branch = ctx.branchName ? ` · ${ctx.branchName}` : '';
  const lines = (order.items || []).map((i) => `• ${i.qty}× ${i.name}`).join('\n');
  const pay = order.paymentMethod === 'online' ? 'آنلاین' : 'صندوق';
  return (
    `🛎️ سفارش جدید — ${brand}${branch}\n` +
    `#${order.id} · میز ${order.tableNo}\n` +
    `${order.name ? `مهمان: ${order.name}\n` : ''}` +
    `موبایل: ${order.phone}\n` +
    `پرداخت: ${pay}\n` +
    `${lines}\n` +
    `جمع: ${formatMoney(order.total)}`
  );
}

function buildReservationMessage(res, ctx = {}) {
  const brand = ctx.brand || 'وستو';
  const branch = ctx.branchName ? ` · ${ctx.branchName}` : '';
  return (
    `📅 رزرو جدید — ${brand}${branch}\n` +
    `#${res.id} · ${res.date} ${res.time}\n` +
    `${res.name} · ${res.partySize} نفر\n` +
    `موبایل: ${res.phone}` +
    (res.note ? `\nیادداشت: ${res.note}` : '')
  );
}

function resolveNotifyPhone(db, branchId) {
  const s = db.whatsappNotify || {};
  if (s.phone) return s.phone;
  const branch = (db.branches || []).find((b) => b.id === Number(branchId));
  if (branch?.whatsapp) return branch.whatsapp;
  if (db.restaurant?.whatsapp) return db.restaurant.whatsapp;
  return db.restaurant?.phone || '';
}

function webhookTimeoutMs() {
  const configured = Number(process.env.WHATSAPP_WEBHOOK_TIMEOUT_MS);
  if (!Number.isFinite(configured) || configured <= 0) {
    return DEFAULT_WEBHOOK_TIMEOUT_MS;
  }
  return Math.max(
    MIN_WEBHOOK_TIMEOUT_MS,
    Math.min(MAX_WEBHOOK_TIMEOUT_MS, Math.round(configured)),
  );
}

function makeAbortController(timeoutMs) {
  if (typeof AbortController !== 'function') {
    return { controller: null, timer: null };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  return { controller, timer };
}

async function releaseResponseBody(response) {
  // We never consume webhook response content. Cancelling the body avoids
  // retaining an unread stream if a provider returns a large payload.
  try {
    await response?.body?.cancel?.();
  } catch (_) {}
}

async function pushWebhook(payload) {
  const url = String(process.env.WHATSAPP_WEBHOOK_URL || '').trim();
  if (!url) return { sent: false, reason: 'no_webhook' };

  const timeoutMs = webhookTimeoutMs();
  const { controller, timer } = makeAbortController(timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/plain, */*',
      },
      body: JSON.stringify(payload),
      signal: controller?.signal,
    });

    const result = { sent: response.ok, status: response.status };
    await releaseResponseBody(response);
    return result;
  } catch (error) {
    if (error?.name === 'AbortError') {
      return {
        sent: false,
        reason: 'timeout',
        error: `webhook_timeout_${timeoutMs}ms`,
      };
    }
    return { sent: false, error: String(error?.message || error) };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function nextNotifyId(db) {
  let maxId = 0;
  for (const entry of db.whatsappLog || []) {
    const id = Number(entry?.id) || 0;
    if (id > maxId) maxId = id;
  }
  return maxId + 1;
}

function recordNotify(db, entry) {
  if (!Array.isArray(db.whatsappLog)) db.whatsappLog = [];
  db.whatsappLog.unshift(entry);
  if (db.whatsappLog.length > MAX_LOG_ENTRIES) {
    db.whatsappLog.length = MAX_LOG_ENTRIES;
  }
}

function branchFor(db, branchId) {
  const id = Number(branchId);
  return (db.branches || []).find((branch) => branch.id === id);
}

async function notifyOrderWhatsApp(db, order) {
  const settings = db.whatsappNotify || {};
  if (settings.enabled === false || settings.onOrder === false) {
    return { skipped: true };
  }

  const branch = branchFor(db, order.branchId);
  const text = buildOrderMessage(order, {
    brand: db.restaurant?.name || 'وستو',
    branchName: branch?.name,
  });
  const phone = resolveNotifyPhone(db, order.branchId);
  const digits = toWaDigits(phone);
  const url = waMeUrl(digits, text);
  const webhookAt = new Date().toISOString();

  const webhook = await pushWebhook({
    type: 'order',
    phone: digits,
    text,
    orderId: order.id,
    at: webhookAt,
  });

  const entry = {
    id: nextNotifyId(db),
    type: 'order',
    refId: order.id,
    phone: digits,
    url,
    webhook,
    createdAt: new Date().toISOString(),
  };
  recordNotify(db, entry);

  return { url, phone: digits, webhook, logId: entry.id };
}

async function notifyReservationWhatsApp(db, reservation) {
  const settings = db.whatsappNotify || {};
  if (settings.enabled === false || settings.onReservation === false) {
    return { skipped: true };
  }

  const branch = branchFor(db, reservation.branchId);
  const text = buildReservationMessage(reservation, {
    brand: db.restaurant?.name || 'وستو',
    branchName: branch?.name,
  });
  const phone = resolveNotifyPhone(db, reservation.branchId);
  const digits = toWaDigits(phone);
  const url = waMeUrl(digits, text);
  const webhookAt = new Date().toISOString();

  const webhook = await pushWebhook({
    type: 'reservation',
    phone: digits,
    text,
    reservationId: reservation.id,
    at: webhookAt,
  });

  const entry = {
    id: nextNotifyId(db),
    type: 'reservation',
    refId: reservation.id,
    phone: digits,
    url,
    webhook,
    createdAt: new Date().toISOString(),
  };
  recordNotify(db, entry);

  return { url, phone: digits, webhook, logId: entry.id };
}

module.exports = {
  toWaDigits,
  waMeUrl,
  notifyOrderWhatsApp,
  notifyReservationWhatsApp,
  buildOrderMessage,
  resolveNotifyPhone,
};
