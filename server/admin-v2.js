'use strict';

/*
 * Unified WESTO administration read model.
 *
 * The public menu keeps its established JSON-facing contract while this layer
 * gives the React admin one stable, domain-oriented API.  All values are
 * derived from WESTO's live state, never from NEEM demo fixtures.
 */

const ACTIVE_ORDER_STATUSES = new Set(['sent_to_kitchen', 'paid', 'preparing', 'ready', 'dispatched']);
const PAID_ORDER_STATUSES = new Set(['paid', 'preparing', 'ready', 'dispatched', 'picked_up', 'delivered', 'done']);
const KITCHEN_STATUSES = new Set(['sent_to_kitchen', 'paid', 'preparing', 'ready']);
const TABLE_SERVICE_MINUTES = 45;
const TABLE_SERVICE_MS = TABLE_SERVICE_MINUTES * 60 * 1000;
const accountingEngine = require('./accounting-engine');
const { createDesktopReleaseService } = require('./desktop-releases');

function asArray(value) { return Array.isArray(value) ? value : []; }
function asNumber(value) { return Number.isFinite(Number(value)) ? Number(value) : 0; }
function byNewest(a, b) { return new Date(b.createdAt || b.at || 0) - new Date(a.createdAt || a.at || 0); }
function startOfToday() { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); }
function isPaid(order) {
  if (typeof order?.paymentStatus === 'string') return order.paymentStatus === 'paid';
  return PAID_ORDER_STATUSES.has(String(order?.status || ''));
}
function branchFilter(rows, branchId) { return branchId ? rows.filter((row) => Number(row.branchId) === Number(branchId)) : rows; }

function tableServices(orders, now = Date.now()) {
  const services = new Map();
  orders.filter((order) => ACTIVE_ORDER_STATUSES.has(order.status)).forEach((order) => {
    const tableNo = String(order.tableNo || '').trim();
    if (!tableNo) return;
    const startedAtMs = new Date(order.tableServiceStartedAt || order.createdAt || now).getTime();
    const safeStartedAtMs = Number.isFinite(startedAtMs) ? startedAtMs : now;
    const current = services.get(tableNo);
    if (!current || safeStartedAtMs > current.startedAtMs) {
      const endsAtMs = safeStartedAtMs + TABLE_SERVICE_MS;
      services.set(tableNo, {
        orderId: order.id,
        startedAtMs: safeStartedAtMs,
        startedAt: new Date(safeStartedAtMs).toISOString(),
        endsAtMs,
        endsAt: new Date(endsAtMs).toISOString(),
        remainingSec: Math.max(0, Math.ceil((endsAtMs - now) / 1000)),
        expired: endsAtMs <= now,
      });
    }
  });
  return services;
}

function orderAllowed(status) {
  const map = {
    pending_online: ['cancelled'], awaiting_confirmation: ['paid', 'cancelled'], pay_at_cashier: ['paid', 'cancelled'],
    sent_to_kitchen: ['preparing', 'cancelled'],
    paid: ['preparing', 'cancelled'], preparing: ['ready', 'cancelled'], ready: ['picked_up', 'dispatched', 'cancelled'],
    dispatched: ['delivered', 'cancelled'], picked_up: [], delivered: [], done: [], cancelled: [],
  };
  return map[String(status || '')] || [];
}

function overview(db, branchId) {
  const orders = branchFilter(asArray(db.orders), branchId);
  const tables = branchFilter(asArray(db.tables), branchId);
  const reservations = branchFilter(asArray(db.reservations), branchId);
  const calls = branchFilter(asArray(db.waiterCalls), branchId);
  const today = startOfToday();
  const salesToday = orders.filter((order) => isPaid(order) && new Date(order.createdAt || 0).getTime() >= today).reduce((sum, order) => sum + asNumber(order.total), 0);
  const activeOrders = orders.filter((order) => ACTIVE_ORDER_STATUSES.has(order.status));
  const busyTableNumbers = new Set([...tableServices(orders).entries()].filter(([, service]) => !service.expired).map(([tableNo]) => tableNo));
  const kitchenTickets = orders.filter((order) => KITCHEN_STATUSES.has(order.status)).sort(byNewest).slice(0, 8);
  const alerts = [];
  if (calls.some((call) => call.status === 'open' || call.status === 'new')) alerts.push({ id: 'waiter-calls', title: 'فراخوان گارسون باز است', detail: `${calls.filter((call) => call.status === 'open' || call.status === 'new').length} درخواست نیازمند رسیدگی است.` });
  if (activeOrders.some((order) => Date.now() - new Date(order.createdAt || 0).getTime() > 20 * 60 * 1000)) alerts.push({ id: 'late-orders', title: 'سفارش دیرکرد دارد', detail: 'یک یا چند سفارش فعال بیش از ۲۰ دقیقه در جریان هستند.' });
  return {
    metrics: { salesToday, activeOrders: activeOrders.length, busyTables: busyTableNumbers.size, totalTables: tables.length, openWaiterCalls: calls.filter((call) => call.status === 'open' || call.status === 'new').length },
    kitchenTickets: kitchenTickets.map((order) => ({ id: order.id, orderNo: order.orderNo, tableNo: order.tableNo, fulfillment: order.fulfillment, status: order.status })),
    alerts,
    generatedAt: new Date().toISOString(),
  };
}

function floor(db, branchId) {
  const now = Date.now();
  const orders = branchFilter(asArray(db.orders), branchId);
  const tables = branchFilter(asArray(db.tables), branchId);
  const calls = branchFilter(asArray(db.waiterCalls), branchId);
  const todayKey = new Date().toISOString().slice(0, 10);
  const reservations = branchFilter(asArray(db.reservations), branchId).filter((item) => item.date === todayKey && !['cancelled', 'no_show'].includes(item.status));
  const services = tableServices(orders, now);
  const reserved = new Set(reservations.map((item) => String(item.tableNo || '')).filter(Boolean));
  const openCalls = new Set(calls.filter((item) => item.status === 'open' || item.status === 'new').map((item) => String(item.tableNo || '')).filter(Boolean));
  const mapped = tables.map((table) => {
    const key = String(table.id);
    const service = services.get(key) || null;
    const autoReleased = Boolean(service?.expired);
    const state = !table.active ? 'inactive' : openCalls.has(key) ? 'attention' : service && !autoReleased ? 'busy' : reserved.has(key) ? 'reserved' : 'available';
    return {
      ...table,
      state,
      stateLabel: { inactive: 'غیرفعال', attention: 'نیازمند رسیدگی', busy: 'در حال سرویس', reserved: 'رزرو', available: 'آزاد' }[state],
      serviceOrderId: service?.orderId || null,
      serviceStartedAt: service?.startedAt || null,
      serviceEndsAt: service?.endsAt || null,
      serviceRemainingSec: service?.remainingSec || 0,
      autoReleased,
    };
  });
  return { tables: mapped, summary: { total: mapped.length, busy: mapped.filter((item) => item.state === 'busy').length, reservations: reservations.length, waiterCalls: openCalls.size, autoReleased: mapped.filter((item) => item.autoReleased).length, serviceMinutes: TABLE_SERVICE_MINUTES } };
}

function kitchen(db, branchId) {
  const now = Date.now();
  const active = branchFilter(asArray(db.orders), branchId).filter((order) => KITCHEN_STATUSES.has(order.status));
  const toTicket = (order) => ({ ...order, ageMinutes: Math.max(0, Math.floor((now - new Date(order.createdAt || now).getTime()) / 60000)) });
  return { lanes: [
    { id: 'new', label: 'جدید', tickets: active.filter((order) => order.status === 'paid' || order.status === 'sent_to_kitchen').map(toTicket) },
    { id: 'preparing', label: 'در حال آماده‌سازی', tickets: active.filter((order) => order.status === 'preparing').map(toTicket) },
    { id: 'ready', label: 'آماده تحویل', tickets: active.filter((order) => order.status === 'ready').map(toTicket) },
  ] };
}

function catalog(db, branchId) {
  const orders = branchFilter(asArray(db.orders), branchId).filter(isPaid);
  const sales = orders.reduce((sum, order) => sum + asNumber(order.total), 0);
  const items = asArray(db.menuItems).map((item) => {
    const stock = typeof item.stock === 'number' ? item.stock : null;
    const lowStockAt = asNumber(item.lowStockAt || 5);
    return { id: item.id, name: item.name, stock, tracked: stock !== null, low: stock !== null && stock > 0 && stock <= lowStockAt, empty: stock === 0, available: item.available !== false };
  });
  // The source menu has no recipe costs yet. Keep the estimate explicit until
  // recipes/purchases are entered, rather than inventing a cost from demo data.
  const configuredCost = asArray(db.finance?.recipeCosts);
  const costByMenuItem = new Map(configuredCost.map((item) => [Number(item.menuItemId), asNumber(item.unitCost)]));
  const estimatedCogs = orders.reduce((sum, order) => sum + asArray(order.items).reduce((lineTotal, line) => lineTotal + (costByMenuItem.get(Number(line.menuItemId)) || 0) * asNumber(line.qty), 0), 0);
  const estimatedProfit = Math.max(0, sales - estimatedCogs);
  return { inventory: { items, low: items.filter((item) => item.low || item.empty).length }, cost: { sales, estimatedCogs, estimatedProfit, grossMarginPct: sales ? Math.round((estimatedProfit / sales) * 100) : 0 } };
}

const loyaltyEngine = require('./finance/loyalty-engine');
const walletEngine = require('./finance/wallet-engine');

function crm(db, branchId) {
  const profiles = new Map();
  for (const order of branchFilter(asArray(db.orders), branchId)) {
    const phone = String(order.phone || '').trim();
    if (!phone) continue;
    const profile = profiles.get(phone) || { phone, name: order.name || '', orders: 0, total: 0, points: 0, lastOrderAt: null };
    profile.name = profile.name || order.name || '';
    profile.orders += 1;
    if (isPaid(order)) profile.total += asNumber(order.total);
    if (!profile.lastOrderAt || new Date(order.createdAt || 0) > new Date(profile.lastOrderAt || 0)) profile.lastOrderAt = order.createdAt;
    profiles.set(phone, profile);
  }
  for (const user of asArray(db.users)) {
    const phone = String(user.phone || '').trim();
    if (!phone) continue;
    const profile = profiles.get(phone) || { phone, name: user.name || '', orders: 0, total: 0, points: 0, lastOrderAt: null };
    profile.name = profile.name || user.name || '';
    profile.points = Math.max(profile.points, asNumber(user.points));
    profiles.set(phone, profile);
  }
  for (const entry of asArray(db.loyaltyLedger)) {
    const phone = String(entry.phone || '').trim();
    if (!phone) continue;
    const profile = profiles.get(phone) || { phone, name: '', orders: 0, total: 0, points: 0, lastOrderAt: null };
    profile.points = asNumber(entry.balance);
    profiles.set(phone, profile);
  }
  const rawCustomers = [...profiles.values()].sort((a, b) => b.total - a.total || b.points - a.points);
  const tiers = loyaltyEngine.summarizeTiersMembership(db, rawCustomers);
  const walletSummary = walletEngine.summarizeWallet(db);
  const customers = rawCustomers.map((c) => {
    const tierInfo = loyaltyEngine.resolveCustomerTier(db, c);
    return {
      ...c,
      walletBalanceToman: walletEngine.getWalletBalance(db, c.phone),
      tier: tierInfo.tier,
      nextTier: tierInfo.nextTier,
      progressPct: tierInfo.progressPct,
      pointsToNext: tierInfo.pointsToNext,
      spendToNext: tierInfo.spendToNext,
      multiplier: tierInfo.multiplier,
      discountPct: tierInfo.discountPct,
      badge: tierInfo.badge,
    };
  });
  const feedback = branchFilter(asArray(db.feedback), branchId).sort(byNewest);
  const newsletter = asArray(db.newsletter);
  return {
    customers,
    tiers,
    walletSummary,
    loyaltySettings: db.loyalty || {},
    feedback,
    newsletter,
    summary: {
      customers: customers.length,
      points: customers.reduce((sum, customer) => sum + customer.points, 0),
      walletTotalToman: walletSummary.totalLiabilityToman || 0,
      activeWallets: walletSummary.activeWalletsCount || 0,
      newFeedback: feedback.filter((item) => item.status === 'new').length,
      newsletter: newsletter.length,
    },
  };
}

function finance(db, branchId) {
  const acc = accountingEngine.ensureAccountingData(db);
  const overview = accountingEngine.getOverview(db, { branchId });
  const journal = (acc.journalEntries || []).map((entry) => ({
    id: entry.id,
    number: entry.number,
    reference: entry.description || entry.number,
    at: entry.date,
    debit: entry.totalAmount,
    credit: entry.totalAmount,
    source: entry.source,
    linesCount: (entry.lines || []).length,
  })).sort(byNewest);
  const employees = asArray(db.users).filter((user) => ['owner', 'manager', 'kitchen', 'cashier', 'waiter'].includes(user.role)).map((user) => ({ id: user.phone, name: user.name || user.phone, role: user.role, status: user.blocked ? 'غیرفعال' : 'فعال' }));
  return {
    summary: {
      sales: overview.metrics.totalRevenue,
      paid: overview.metrics.totalRevenue - overview.metrics.totalAR,
      receivable: overview.metrics.totalAR,
      payable: overview.metrics.totalAP,
      grossProfit: overview.metrics.grossProfit,
      netIncome: overview.metrics.netIncome,
      totalCash: overview.metrics.totalCash,
      totalBank: overview.metrics.totalBank,
      entries: (acc.journalEntries || []).length,
      balancedEntries: (acc.journalEntries || []).filter((e) => e.status === 'posted').length,
    },
    journal,
    employees,
    overview,
  };
}

const SETTINGS_CATEGORIES = [
  ['restaurant', 'رستوران', 'نام، تماس و اطلاعات عمومی مجموعه'], ['branches', 'شعب', 'مشخصات و وضعیت شعب فعال'], ['users', 'کاربران', 'کاربران و شماره‌های مدیر'], ['permissions', 'مجوزها', 'نقش‌ها و سطوح دسترسی'], ['orders', 'سفارش‌ها', 'رفتار سفارش و تحویل'], ['tables', 'میزها', 'سالن، ظرفیت و رمزینه سفارش'], ['kitchen', 'آشپزخانه', 'نمایشگر آشپزخانه و زمان آماده‌سازی'], ['menu', 'منو', 'نمایش و دسترس‌پذیری منو'], ['payments', 'پرداخت‌ها', 'روش‌های پرداخت مجموعه'], ['taxes', 'مالیات', 'قواعد مالیاتی داخلی'], ['printing', 'چاپ', 'قالب و مقصد چاپ'], ['notifications', 'اعلان‌ها', 'اعلان‌های عملیاتی'], ['integrations', 'اتصال‌ها', 'پیام‌رسان و ارتباط با سامانه‌های دیگر'], ['appearance', 'ظاهر', 'تم و برندینگ'], ['security', 'امنیت', 'نشست و دسترسی'], ['logs', 'لاگ‌ها', 'رخدادها و ممیزی'], ['desktop', 'اپ دسکتاپ', 'دانلود و نصب اپ مدیریت وستو روی مک و ویندوز'],
];

function settings(db) {
  const branch = asArray(db.branches)[0] || {};
  const restaurant = db.restaurant || {};
  const v2 = db.adminV2Settings || {};
  const known = {
    restaurant: [{ key: 'name', label: 'نام مجموعه', value: restaurant.name || restaurant.title || '' }, { key: 'phone', label: 'تلفن', value: restaurant.phone || branch.phone || '', dir: 'ltr' }, { key: 'address', label: 'آدرس', value: restaurant.address || branch.address || '' }],
    branches: [{ key: 'name', label: 'نام شعبه اصلی', value: branch.name || '' }, { key: 'address', label: 'آدرس شعبه', value: branch.address || '' }, { key: 'phone', label: 'تلفن شعبه', value: branch.phone || '', dir: 'ltr' }],
    users: [{ key: 'adminPhones', label: 'شماره مدیران (با کاما)', value: asArray(db.settings?.adminPhones).join(', '), dir: 'ltr' }],
    appearance: [{ key: 'accent', label: 'رنگ اصلی', value: db.theme?.accent || '#7357ce', dir: 'ltr' }],
  };
  return { categories: SETTINGS_CATEGORIES.map(([id, label, description]) => ({ id, label, description, fields: Object.prototype.hasOwnProperty.call(known, id) ? known[id] : id === 'desktop' ? [] : [{ key: 'note', label: 'یادداشت عملیاتی', value: v2[id]?.note || '' }] })) };
}

function registerAdminV2Routes({ app, getDb, save, requireCapability, requireAdmin, parseBranchId, normalizeDigits, phoneRe, desktopReleaseService = createDesktopReleaseService() }) {
  app.get('/api/admin/v2/overview', requireCapability('command.view'), (req, res) => res.json(overview(getDb(), parseBranchId(req))));
  app.get('/api/admin/v2/orders', requireCapability('orders.view'), (req, res) => {
    const orders = branchFilter(asArray(getDb().orders), parseBranchId(req)).slice().sort(byNewest).map((order) => ({ ...order, allowed: orderAllowed(order.status) }));
    res.json({ orders, serverTime: new Date().toISOString() });
  });
  app.get('/api/admin/v2/floor', requireCapability('tables.view'), (req, res) => res.json(floor(getDb(), parseBranchId(req))));
  app.get('/api/admin/v2/kitchen', requireCapability('kitchen.view'), (req, res) => res.json(kitchen(getDb(), parseBranchId(req))));
  app.get('/api/admin/v2/catalog', requireCapability('inventory.view'), (req, res) => res.json(catalog(getDb(), parseBranchId(req))));
  app.get('/api/admin/v2/crm', requireAdmin, (req, res) => res.json(crm(getDb(), parseBranchId(req))));
  app.get('/api/admin/v2/finance', requireAdmin, (req, res) => res.json(finance(getDb(), parseBranchId(req))));
  app.get('/api/admin/v2/settings', requireAdmin, (req, res) => res.json(settings(getDb())));
  app.get('/api/admin/v2/desktop/releases', requireAdmin, (req, res) => res.json(desktopReleaseService.list()));
  app.get('/api/admin/v2/desktop/releases/:platform/:arch/:format/download', requireAdmin, (req, res) => {
    const artifact = desktopReleaseService.resolve(req.params.platform, req.params.arch, req.params.format);
    if (!artifact) return res.status(404).json({ error: 'desktop_release_not_found', message: 'فایل نصب‌کنندهٔ این سیستم‌عامل هنوز منتشر نشده است.' });
    return res.download(artifact.absolutePath, artifact.fileName, { dotfiles: 'deny', maxAge: 0 }, (error) => {
      if (error && !res.headersSent) res.status(error.statusCode || 500).json({ error: 'desktop_release_download_failed' });
    });
  });
  app.patch('/api/admin/v2/settings', requireAdmin, (req, res) => {
    const db = getDb(); const category = String(req.body?.category || ''); const values = req.body?.values || {};
    if (!SETTINGS_CATEGORIES.some(([id]) => id === category)) return res.status(400).json({ error: 'settings_category_invalid' });
    if (category === 'restaurant') {
      db.restaurant = { ...(db.restaurant || {}), name: String(values.name || '').slice(0, 120), phone: String(values.phone || '').slice(0, 32), address: String(values.address || '').slice(0, 300) };
    } else if (category === 'branches') {
      const branch = asArray(db.branches)[0]; if (branch) Object.assign(branch, { name: String(values.name || '').slice(0, 120), address: String(values.address || '').slice(0, 300), phone: String(values.phone || '').slice(0, 32) });
    } else if (category === 'users') {
      const phones = String(values.adminPhones || '').split(',').map((item) => normalizeDigits(item).trim()).filter((item) => phoneRe.test(item));
      if (phones.length) db.settings.adminPhones = [...new Set(phones)];
    } else if (category === 'appearance') {
      db.theme = { ...(db.theme || {}), accent: String(values.accent || '').slice(0, 32) };
    } else if (category === 'desktop') {
      return res.status(400).json({ error: 'desktop_settings_read_only', message: 'نسخه‌های اپ از مسیر انتشار مدیریت می‌شوند.' });
    } else {
      db.adminV2Settings = { ...(db.adminV2Settings || {}), [category]: { note: String(values.note || '').slice(0, 500), updatedAt: new Date().toISOString() } };
    }
    save(); res.json({ ok: true, settings: settings(db) });
  });
}

module.exports = { registerAdminV2Routes, __test: { overview, floor, kitchen, catalog, crm, finance, settings, SETTINGS_CATEGORIES } };
