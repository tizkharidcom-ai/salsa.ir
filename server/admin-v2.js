'use strict';

/*
 * Unified WESTO administration read model.
 *
 * The public menu keeps its established JSON-facing contract while this layer
 * gives the React admin one stable, domain-oriented API.  All values are
 * derived from WESTO's live state, never from SALSA demo fixtures.
 */

const ACTIVE_ORDER_STATUSES = new Set(['sent_to_kitchen', 'paid', 'preparing', 'ready', 'dispatched']);
const PAID_ORDER_STATUSES = new Set(['paid', 'preparing', 'ready', 'dispatched', 'picked_up', 'delivered', 'done']);
const KITCHEN_STATUSES = new Set(['sent_to_kitchen', 'paid', 'preparing', 'ready']);
const TABLE_SERVICE_MINUTES = 45;
const TABLE_SERVICE_MS = TABLE_SERVICE_MINUTES * 60 * 1000;
const ACTIVE_RESERVATION_STATUSES = new Set(['pending', 'confirmed', 'seated']);
const accountingEngine = require('./accounting-engine');
const { createDesktopReleaseService } = require('./desktop-releases');
const { isOwnerOnlySettingsCategory } = require('./salsa/westo-policy-enforcement');
const waitlist = require('./waitlist');
const commandCenter = require('./command-center');
const { isKitchenOrderPaymentEligible } = require('./waiter-order-invariants');
const { exposeOperationalOrderActions } = require('./operational-order-actions');

function asArray(value) { return Array.isArray(value) ? value : []; }
function asNumber(value) { return Number.isFinite(Number(value)) ? Number(value) : 0; }
function byNewest(a, b) { return new Date(b.createdAt || b.at || 0) - new Date(a.createdAt || a.at || 0); }
function startOfToday() { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); }
function isPaid(order) {
  if (typeof order?.paymentStatus === 'string') return order.paymentStatus === 'paid';
  return PAID_ORDER_STATUSES.has(String(order?.status || ''));
}
function branchFilter(rows, branchId) { return branchId ? rows.filter((row) => Number(row.branchId) === Number(branchId)) : rows; }
const OPERATIONAL_ORDER_TRANSITIONS = new Set([
  'pending_online', 'awaiting_confirmation', 'pay_at_cashier', 'sent_to_kitchen',
  'paid', 'preparing', 'ready', 'dispatched', 'picked_up', 'delivered', 'done', 'cancelled',
]);

function adminOrderDto(order, {
  includePii = false,
  includePaymentReferences = false,
  includeDeliveryReason = false,
  includeOperationalActions = false,
} = {}) {
  // Derive authorization from the full persisted record before projecting it:
  // delivery transitions depend on acceptance provenance that must not leave
  // the server in the operational DTO.
  const operationalActions = includeOperationalActions ? exposeOperationalOrderActions(order) : null;
  const dto = {
    id: order.id,
    orderNo: order.orderNo || null,
    branchId: order.branchId ?? null,
    status: order.status || null,
    fulfillment: order.fulfillment || null,
    tableNo: order.tableNo || null,
    checkNo: order.checkNo || null,
    items: asArray(order.items).map((item) => ({
      id: item?.id ?? null,
      menuItemId: item?.menuItemId ?? null,
      name: String(item?.name || ''),
      qty: item?.qty ?? item?.count ?? null,
      price: item?.price ?? null,
      lineTotal: item?.lineTotal ?? null,
      complements: asArray(item?.complements).map((complement) => ({
        id: complement?.id ?? null,
        name: String(complement?.name || ''),
        qty: complement?.qty ?? null,
        price: complement?.price ?? null,
      })),
      course: item?.course || null,
      courseStatus: item?.courseStatus || null,
    })),
    subtotal: order.subtotal ?? null,
    discount: order.discount ?? 0,
    total: order.total ?? null,
    currency: order.currency || 'IRR',
    createdAt: order.createdAt || null,
    updatedAt: order.updatedAt || null,
    statusAt: order.statusAt || null,
    paymentStatus: order.paymentStatus || 'unknown',
    paymentMethod: order.paymentMethod || null,
    amountPaid: order.amountPaid ?? null,
    balanceDue: order.balanceDue ?? null,
    partialPayments: asArray(order.partialPayments).map((payment) => ({
      id: payment?.id ?? null,
      amount: payment?.amount ?? null,
      tender: payment?.tender || null,
      at: payment?.at || payment?.createdAt || null,
      ...(includePaymentReferences && payment?.reference ? { reference: String(payment.reference) } : {}),
    })),
    deliveryAcceptance: (() => {
      const acceptance = order.deliveryAcceptance;
      const status = String(
        acceptance && typeof acceptance === 'object' ? acceptance.status || '' : acceptance || '',
      ).trim().toLowerCase();
      const safeStatus = ['accepted', 'rejected'].includes(status) ? status : null;
      if (!safeStatus) return null;
      return {
        status: safeStatus,
        ...(includeDeliveryReason && safeStatus === 'rejected' && typeof acceptance?.reason === 'string'
          ? { reason: acceptance.reason.slice(0, 500) }
          : {}),
      };
    })(),
    statusHistory: asArray(order.statusHistory).map((entry) => ({
      status: entry?.status || null,
      at: entry?.at || null,
      source: entry?.source || null,
    })),
    allowed: orderAllowed(order.status),
  };

  if (operationalActions) {
    dto.allowedStatusTransitions = asArray(operationalActions.allowedStatusTransitions)
      .filter((status) => OPERATIONAL_ORDER_TRANSITIONS.has(status));
    dto.cancellationBlocked = operationalActions.cancellationBlocked
      ? {
        code: String(operationalActions.cancellationBlocked.code || '').slice(0, 100),
        message: String(operationalActions.cancellationBlocked.message || '').slice(0, 240),
      }
      : null;
  }

  if (order.delivery && typeof order.delivery === 'object') {
    dto.delivery = {
      zoneId: order.delivery.zoneId ?? null,
      zoneName: order.delivery.zoneName || null,
      fee: order.delivery.fee ?? null,
      etaMinutes: order.delivery.etaMinutes ?? null,
      ...(includePii ? {
        address: order.delivery.address || null,
        recipient: order.delivery.recipient || null,
        phone: order.delivery.phone || null,
        latitude: order.delivery.latitude ?? null,
        longitude: order.delivery.longitude ?? null,
      } : {}),
    };
  }
  if (includePii) {
    // Keep the legacy orders endpoint's field names while preserving the same
    // capability boundary as the newer customer DTO.
    dto.name = order.name || order.customerName || null;
    dto.phone = order.phone || order.customerPhone || null;
    dto.email = order.email || null;
    dto.customer = {
      name: order.name || order.customerName || null,
      phone: order.phone || order.customerPhone || null,
      email: order.email || null,
    };
    dto.note = order.note || null;
  }
  return dto;
}

function operationalOrderDto(order, options = {}) {
  return adminOrderDto(order, { ...options, includeOperationalActions: true });
}

function adminPaymentDto(payment, { includePaymentReferences = false } = {}) {
  if (!payment || typeof payment !== 'object' || Array.isArray(payment)) return null;
  return {
    id: payment.id ?? null,
    tender: payment.tender || null,
    amount: payment.amount ?? null,
    amountTendered: payment.amountTendered ?? null,
    changeDue: payment.changeDue ?? null,
    at: payment.at || payment.createdAt || null,
    ...(payment.cashSessionId != null ? { cashSessionId: payment.cashSessionId } : {}),
    // The operational client uses this request key to verify a replay. It is
    // not a processor/receipt reference and carries no authority by itself.
    ...(payment.idempotencyKey ? { idempotencyKey: String(payment.idempotencyKey) } : {}),
    ...(includePaymentReferences && payment.reference ? { reference: String(payment.reference) } : {}),
  };
}
function floorLayoutRevision(db, branchId) {
  if (branchId === null || branchId === undefined) return null;
  const revisions = db?.floorLayoutRevisions;
  if (revisions === undefined) return 0;
  if (!revisions || typeof revisions !== 'object' || Array.isArray(revisions)) return null;
  const revision = revisions[String(Number(branchId))];
  if (revision === undefined) return 0;
  return Number.isSafeInteger(revision) && revision >= 0 ? revision : null;
}
function localDateKey(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const pad = (part) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

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
    recentLogins: asArray(db.loginLog).slice(0, 50).map((entry, index) => ({ id: `${entry.phone || 'unknown'}-${entry.at || index}`, phone: entry.phone || '—', at: entry.at || null, device: '—', status: 'ورود ثبت‌شده' })),
    alerts,
    generatedAt: new Date().toISOString(),
  };
}

function floor(db, branchId, at = Date.now()) {
  const nowDate = at instanceof Date ? at : new Date(at);
  const now = nowDate.getTime();
  const orders = branchFilter(asArray(db.orders), branchId);
  const tables = branchFilter(asArray(db.tables), branchId);
  const calls = branchFilter(asArray(db.waiterCalls), branchId);
  // Reservation dates are entered and evaluated in the restaurant's local
  // wall-clock calendar (the same basis as waitlist.localDateTime), not UTC.
  const todayKey = localDateKey(nowDate);
  const slotMinutes = db.reservationSettings?.slotMinutes;
  const allReservations = branchFilter(asArray(db.reservations), branchId);
  const reservations = allReservations.filter((item) => item.source !== 'walk_in'
    && item.date === todayKey
    && ACTIVE_RESERVATION_STATUSES.has(String(item.status || ''))
    && waitlist.reservationBlocksTable(item, nowDate, slotMinutes));
  const seatedWalkIns = new Set(allReservations
    .filter((item) => item.source === 'walk_in' && item.status === 'seated' && item.tableNo != null)
    .map((item) => String(item.tableNo)));
  const services = tableServices(orders, now);
  const reserved = new Set(reservations.map((item) => String(item.tableNo || '')).filter(Boolean));
  const openCallItems = calls.filter((item) => item.status === 'open' || item.status === 'new');
  const findTableCall = (table) => {
    const tId = String(table.id || '').replace(/\D/g, '');
    const tNum = tId ? Number(tId) : null;
    const tLabel = String(table.label || '').trim();
    return openCallItems.find((c) => {
      const cNo = String(c.tableNo || '').trim();
      const cDigits = cNo.replace(/\D/g, '');
      const cNum = cDigits ? Number(cDigits) : null;
      return (tNum !== null && cNum === tNum) || (cDigits && cDigits === tId) || cNo === tLabel || cNo === `میز ${tId}` || cNo === `میز ${tNum}` || cNo === tId;
    }) || null;
  };

  const DEFAULT_FLOOR_SETTINGS = {
    widthM: 20,
    lengthM: 25,
    gridStep: 0.5,
    bgTheme: 'blueprint',
    wallThickness: 0.4,
    showRulers: true,
    showGrid: true,
  };

  const mapped = tables.map((table) => {
    const key = String(table.id);
    const service = services.get(key) || (table.mergedInto ? services.get(String(table.mergedInto)) : null) || null;
    const autoReleased = Boolean(service?.expired);
    const activeCall = findTableCall(table) || (table.mergedInto ? findTableCall({ id: table.mergedInto }) : null);
    const hasCall = Boolean(activeCall);
    const state = !table.active ? 'inactive' : hasCall ? 'attention' : service && !autoReleased ? 'busy' : seatedWalkIns.has(key) ? 'busy' : reserved.has(key) ? 'reserved' : 'available';
    const isMergedSub = Boolean(table.mergedInto);
    const mergedParent = isMergedSub ? tables.find((p) => String(p.id) === String(table.mergedInto)) : null;
    const mergedParentLabel = mergedParent ? (mergedParent.label || `میز ${mergedParent.id}`) : (table.mergedInto ? `میز ${table.mergedInto}` : null);
    return {
      ...table,
      state,
      stateLabel: isMergedSub
        ? `متصل به ${mergedParentLabel}`
        : { inactive: 'غیرفعال', attention: 'نیازمند رسیدگی', busy: 'در حال سرویس', reserved: 'رزرو', available: 'آزاد' }[state],
      waiterCallId: activeCall?.id || null,
      serviceOrderId: service?.orderId || null,
      serviceStartedAt: service?.startedAt || null,
      serviceEndsAt: service?.endsAt || null,
      serviceRemainingSec: service?.remainingSec || 0,
      autoReleased,
      floorId: table.floorId || null,
      mergedWith: Array.isArray(table.mergedWith) ? table.mergedWith : [],
      mergedInto: table.mergedInto || null,
      tags: Array.isArray(table.tags) ? table.tags : [],
    };
  });
  const branchZones = branchFilter(asArray(db.floorZones), branchId);
  const branchFixtures = branchFilter(asArray(db.floorFixtures), branchId);
  const branchFloors = branchFilter(asArray(db.floors), branchId);
  const zones = branchZones;
  const fixtures = branchFixtures;
  const floors = branchFloors;
  const branchSettingsList = branchFilter(asArray(db.floorSettingsList), branchId);
  const settings = branchSettingsList[0] || { ...DEFAULT_FLOOR_SETTINGS, branchId: branchId || 1 };

  return {
    tables: mapped,
    zones,
    fixtures,
    floors,
    settings,
    layoutRevision: floorLayoutRevision(db, branchId),
    summary: {
      total: mapped.length,
      busy: mapped.filter((item) => item.state === 'busy').length,
      reservations: reservations.length,
      waiterCalls: openCallItems.length,
      autoReleased: mapped.filter((item) => item.autoReleased).length,
      serviceMinutes: TABLE_SERVICE_MINUTES,
      totalSeats: mapped.reduce((acc, t) => acc + (Number(t.seats) || 0), 0),
      totalFloors: floors.length,
      totalZones: zones.length,
      totalFixtures: fixtures.length,
    }
  };
}

function kitchen(db, branchId) {
  const now = Date.now();
  const active = branchFilter(asArray(db.orders), branchId)
    .filter((order) => KITCHEN_STATUSES.has(String(order?.status || '').trim().toLowerCase()))
    .filter((order) => isKitchenOrderPaymentEligible(order, commandCenter.paymentStatusFor(order)));
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
  const branchScoped = branchId !== null && branchId !== undefined;
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
  // User, loyalty and wallet records have no branch ownership today. Joining
  // them to branch orders would expose tenant-wide PII and balances to a branch
  // operator, so only an explicitly unscoped owner view may include them.
  if (!branchScoped) {
    for (const user of asArray(db.users)) {
      const phone = String(user.phone || '').trim();
      if (!phone) continue;
      const profile = profiles.get(phone) || { phone, name: user.name || '', orders: 0, total: 0, points: 0, lastOrderAt: null };
      profile.name = profile.name || user.name || '';
      profile.points = Math.max(profile.points, asNumber(user.points));
      profile.tags = Array.isArray(user.tags) ? user.tags : (profile.tags || []);
      profile.vipNote = user.vipNote || profile.vipNote || '';
      profile.birthdate = user.birthdate || profile.birthdate || '';
      profiles.set(phone, profile);
    }
    for (const entry of asArray(db.loyaltyLedger)) {
      const phone = String(entry.phone || '').trim();
      if (!phone) continue;
      const profile = profiles.get(phone) || { phone, name: '', orders: 0, total: 0, points: 0, lastOrderAt: null };
      profile.points = asNumber(entry.balance);
      profiles.set(phone, profile);
    }
  }

  const now = Date.now();
  const rawCustomers = [...profiles.values()].sort((a, b) => b.total - a.total || b.points - a.points);
  const tiers = branchScoped ? [] : loyaltyEngine.summarizeTiersMembership(db, rawCustomers);
  const walletSummary = branchScoped ? null : walletEngine.summarizeWallet(db);

  let totalOrderSpendToman = 0;
  let totalPaidOrders = 0;
  let atRiskCount = 0;
  let championsCount = 0;
  let upcomingBirthdaysCount = 0;

  const customers = rawCustomers.map((c) => {
    const tierInfo = loyaltyEngine.resolveCustomerTier(db, c);
    const recencyDays = c.lastOrderAt ? Math.max(0, Math.floor((now - new Date(c.lastOrderAt).getTime()) / (1000 * 3600 * 24))) : null;
    const monetaryToman = Math.round(c.total / 10);
    totalOrderSpendToman += monetaryToman;
    totalPaidOrders += c.orders;

    // RFM Segmentation rules:
    let rfmSegment = 'new';
    let rfmLabel = 'مشتری جدید 🌱';
    if (c.orders >= 6 && recencyDays != null && recencyDays <= 30) {
      rfmSegment = 'champion';
      rfmLabel = 'قهرمان 🏆';
      championsCount++;
    } else if (c.orders >= 3 && recencyDays != null && recencyDays <= 45) {
      rfmSegment = 'loyal';
      rfmLabel = 'وفادار 💎';
    } else if (c.orders >= 2 && recencyDays != null && recencyDays <= 60) {
      rfmSegment = 'potential';
      rfmLabel = 'مستعد رشد 🚀';
    } else if (c.orders >= 2 && recencyDays != null && recencyDays > 60) {
      rfmSegment = 'at_risk';
      rfmLabel = 'در معرض ریزش ⚠️';
      atRiskCount++;
    } else if (recencyDays != null && recencyDays > 90) {
      rfmSegment = 'churned';
      rfmLabel = 'خواب‌رفته 💤';
    } else if (c.orders <= 1 && recencyDays != null && recencyDays <= 30) {
      rfmSegment = 'new';
      rfmLabel = 'مشتری جدید 🌱';
    }

    if (!branchScoped && c.birthdate) {
      upcomingBirthdaysCount++;
    }

    return {
      ...c,
      points: branchScoped ? null : c.points,
      tags: branchScoped ? [] : (Array.isArray(c.tags) ? c.tags : []),
      vipNote: branchScoped ? '' : (c.vipNote || ''),
      birthdate: branchScoped ? undefined : c.birthdate,
      recencyDays,
      monetaryToman,
      rfmSegment,
      rfmLabel,
      walletBalanceToman: branchScoped ? null : walletEngine.getWalletBalance(db, c.phone),
      // Keep the API row-safe for table renderers. The loyalty engine returns
      // the full tier object, but AdminV2 needs its display label here.
      tier: branchScoped ? null : (tierInfo.tier?.name || tierInfo.tier?.id || '—'),
      tierId: branchScoped ? null : (tierInfo.tier?.id || null),
      nextTier: branchScoped ? null : tierInfo.nextTier,
      progressPct: branchScoped ? null : tierInfo.progressPct,
      pointsToNext: branchScoped ? null : tierInfo.pointsToNext,
      spendToNext: branchScoped ? null : tierInfo.spendToNext,
      multiplier: branchScoped ? null : tierInfo.multiplier,
      discountPct: branchScoped ? null : tierInfo.discountPct,
      badge: branchScoped ? null : tierInfo.badge,
    };
  });
  const feedback = branchFilter(asArray(db.feedback), branchId).sort(byNewest);
  const newsletter = branchScoped ? [] : asArray(db.newsletter);
  return {
    customers,
    customerDetailsAvailable: !branchScoped,
    tiers,
    walletSummary,
    loyaltySettings: db.loyalty || {},
    feedback,
    newsletter,
    summary: {
      customers: customers.length,
      points: branchScoped ? null : customers.reduce((sum, customer) => sum + customer.points, 0),
      walletTotalToman: branchScoped ? null : (walletSummary.totalLiabilityToman || 0),
      activeWallets: branchScoped ? null : (walletSummary.activeWalletsCount || 0),
      avgLtvToman: customers.length ? Math.round(totalOrderSpendToman / customers.length) : 0,
      avgOrderToman: totalPaidOrders ? Math.round(totalOrderSpendToman / totalPaidOrders) : 0,
      atRiskCount,
      championsCount,
      upcomingBirthdaysCount,
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
  ['theme', 'تم رنگی', 'پوسته و رنگ‌های پنل'], ['sliders', 'تصاویر اسلایدر', 'تصاویر و لینک‌های نمایشی'], ['notices-list', 'اطلاع‌رسانی', 'پیام‌های عمومی سامانه'], ['working-hours', 'ساعت کاری', 'زمان فعالیت مجموعه'], ['delivery-hours', 'ساعت تحویل', 'زمان‌بندی تحویل سفارش'], ['shifts', 'شیفت کاری', 'زمان‌های ارائه خدمات'], ['online-menu', 'منوی آنلاین', 'رفتار سایت و سفارش آنلاین'], ['terminal-categories', 'دسته‌بندی جایگاه', 'گروه‌بندی جایگاه‌ها'], ['terminals', 'جایگاه', 'میزها و جایگاه‌های فروش'], ['couriers', 'پیک', 'پیک‌های فعال مجموعه'], ['printers', 'چاپگر', 'مقصد و تنظیمات چاپ'], ['funds', 'صندوق', 'صندوق‌ها و روش دریافت'], ['scale', 'ترازو', 'اتصال و واحد ترازو'], ['delivery-zones', 'محدوده‌های تحویل', 'محدوده و هزینه ارسال'], ['billing-settings', 'تنظیمات صورت‌حساب', 'قواعد ثبت و پرداخت'], ['general-info', 'مشخصات عمومی', 'اطلاعات برند و تماس'], ['base-info', 'اطلاعات پایه', 'مقادیر پایه فروش'], ['external-systems', 'سیستم‌های خارجی', 'توکن‌ها و اتصال‌ها'], ['tax-info', 'اطلاعات مالیاتی', 'شناسه‌های مالیاتی'], ['localization', 'محلی‌سازی', 'زبان، تقویم و واحد پول'], ['sms-settings', 'تنظیمات پیامک', 'پیام‌ها و ارسال خودکار'], ['staff', 'کارکنان', 'کاربران عملیاتی'], ['notification-settings', 'اعلان و صدا', 'صداها و اعلان‌ها'], ['sessions', 'نشست‌ها', 'نشست‌های فعال'], ['kiosk', 'کیوسک', 'تنظیمات کیوسک'], ['tara', 'تنظیمات تارا', 'اتصال تارا'], ['club-settings', 'باشگاه مشتریان', 'امتیازها و وضعیت باشگاه'],
];

// Some legacy admin screens do not have a corresponding WESTO API resource
// yet.  Keep their records in an explicit AdminV2 namespace instead of
// silently rendering demo rows or pretending that a read-only source is
// editable.  This also leaves a clean migration seam for a future database
// table without coupling the new UI to the legacy JSON shape.
const ADMIN_V2_RESOURCE_KEYS = Object.freeze([
  'customer-params', 'messages', 'credit-cards', 'survey-settings',
  'warehouses', 'notices-list', 'shifts', 'terminal-categories', 'couriers',
  'funds', 'event-reservation',
]);
const ADMIN_STAFF_ROLES = new Set(['owner', 'manager', 'cashier', 'waiter', 'kitchen', 'guest']);

function isAdminV2Resource(resource) {
  return ADMIN_V2_RESOURCE_KEYS.includes(String(resource || ''));
}

function resourceStore(db) {
  if (!db.adminV2Resources || typeof db.adminV2Resources !== 'object' || Array.isArray(db.adminV2Resources)) db.adminV2Resources = {};
  for (const key of ADMIN_V2_RESOURCE_KEYS) if (!Array.isArray(db.adminV2Resources[key])) db.adminV2Resources[key] = [];
  return db.adminV2Resources;
}

function cleanResourceValue(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value.slice(0, 1200);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => cleanResourceValue(item));
  return String(value).slice(0, 1200);
}

function normalizeResourceRow(resource, input, current = {}) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const result = { ...current };
  for (const [key, value] of Object.entries(source)) {
    if (['id', '__id', 'createdAt', 'updatedAt', '__proto__', 'constructor', 'prototype'].includes(key)) continue;
    result[String(key).slice(0, 120)] = cleanResourceValue(value);
  }
  if (resource === 'credit-cards' && result['شماره کارت']) {
    const digits = String(result['شماره کارت']).replace(/\D/g, '');
    if (digits.length === 16) result['شماره کارت'] = `************${digits.slice(-4)}`;
  }
  return result;
}

function publicResourceRow(row) {
  const { id, createdAt, updatedAt, ...values } = row;
  return { id: String(id), ...values, createdAt, updatedAt };
}

function isOwnerActor(db, user) {
  return String(user?.role || '').toLowerCase() === 'owner'
    || asArray(db?.settings?.adminPhones).map(String).includes(String(user?.phone || ''));
}

function assertStaffMutationBoundary(db, req, target, { allowSelf = false } = {}) {
  const actorIsOwner = isOwnerActor(db, req.user);
  const targetIsOwner = String(target?.role || '').toLowerCase() === 'owner'
    || asArray(db?.settings?.adminPhones).map(String).includes(String(target?.phone || ''));
  if (targetIsOwner && !actorIsOwner) {
    const error = new Error('حساب مالک فقط توسط مالک قابل مدیریت است.');
    error.code = 'staff_owner_protected'; error.status = 403; throw error;
  }
  if (!actorIsOwner && String(target?.role || '').toLowerCase() === 'manager') {
    const error = new Error('حساب مدیر فقط توسط مالک قابل مدیریت است.');
    error.code = 'staff_manager_protected'; error.status = 403; throw error;
  }
  if (!allowSelf && String(req.user?.phone || '') === String(target?.phone || '')) {
    const error = new Error('کاربر جاری را نمی‌توان از مسیر مدیریت کارکنان حذف یا مسدود کرد.');
    error.code = 'staff_self_protected'; error.status = 400; throw error;
  }
}

function settings(db) {
  const branch = asArray(db.branches)[0] || {};
  const restaurant = db.restaurant || {};
  const v2 = db.adminV2Settings || {};
  const known = {
    restaurant: [{ key: 'name', label: 'نام مجموعه', value: restaurant.name || restaurant.title || '' }, { key: 'phone', label: 'تلفن', value: restaurant.phone || branch.phone || '', dir: 'ltr' }, { key: 'address', label: 'آدرس', value: restaurant.address || branch.address || '' }],
    branches: [{ key: 'name', label: 'نام شعبه اصلی', value: branch.name || '' }, { key: 'address', label: 'آدرس شعبه', value: branch.address || '' }, { key: 'phone', label: 'تلفن شعبه', value: branch.phone || '', dir: 'ltr' }],
    users: [{ key: 'adminPhones', label: 'شماره مدیران (با کاما)', value: asArray(db.settings?.adminPhones).join(', '), dir: 'ltr' }],
    appearance: [{ key: 'accent', label: 'رنگ اصلی', value: db.theme?.accent || '#7357ce', dir: 'ltr' }],
    theme: [{ key: 'theme', label: 'انتخاب پوسته', value: db.theme?.fontDisplay || 'شخصی‌سازی' }, { key: 'primary', label: 'رنگ اصلی', value: db.theme?.accent || '#7357ce', dir: 'ltr' }, { key: 'secondary', label: 'رنگ ثانویه', value: db.theme?.surface || '#ffffff', dir: 'ltr' }, { key: 'background', label: 'رنگ پس‌زمینه', value: db.theme?.bg || '#f5f7fb', dir: 'ltr' }],
    'general-info': [{ key: 'name', label: 'نام مجموعه', value: restaurant.name || '' }, { key: 'englishName', label: 'نام انگلیسی مجموعه', value: restaurant.brandName || '' }, { key: 'phone', label: 'شماره تماس', value: restaurant.phone || '', dir: 'ltr' }, { key: 'shopUrl', label: 'آدرس سایت', value: restaurant.website || '', dir: 'ltr' }, { key: 'instagram', label: 'آدرس اینستاگرام', value: restaurant.instagram || '', dir: 'ltr' }, { key: 'address', label: 'آدرس کامل', value: restaurant.address || '' }, { key: 'about', label: 'درباره برند', value: restaurant.about || '' }],
    'club-settings': [{ key: 'active', label: 'باشگاه مشتریان فعال', value: db.loyalty?.enabled === false ? 'false' : 'true' }, { key: 'invite', label: 'امتیاز دعوت دوستان', value: String(db.loyalty?.welcomePoints || 0) }, { key: 'online', label: 'امتیاز پرداخت آنلاین', value: String(db.loyalty?.pointsPerToman || 0) }, { key: 'offline', label: 'امتیاز پرداخت خارج از وستو', value: String(db.loyalty?.redeemValue || 0) }],
    'sms-settings': [{ key: 'enabled', label: 'ارسال خودکار', value: db.smsConfig?.enabled === false ? 'false' : 'true' }, { key: 'welcome', label: 'پیام خوش‌آمدگویی', value: db.smsConfig?.templates?.welcome?.text || '' }, { key: 'invoice', label: 'پیام ثبت فاکتور', value: db.smsConfig?.templates?.invoice?.text || '' }],
  };
  return { categories: SETTINGS_CATEGORIES.map(([id, label, description]) => {
    const storedFields = Object.entries(v2[id] || {}).filter(([key]) => key !== 'updatedAt').map(([key, value]) => ({ key, label: key, value: String(value ?? '') }));
    return { id, label, description, fields: Object.prototype.hasOwnProperty.call(known, id) ? known[id] : id === 'desktop' ? [] : storedFields.length ? storedFields : [{ key: 'note', label: 'یادداشت عملیاتی', value: '' }] };
  }) };
}

function registerAdminV2Routes({ app, getDb, save, requireCapability, requireAdmin, parseBranchId, requestBranchValue, effectiveRole, normalizeDigits, phoneRe, recordAudit: audit, appendAudit: appendCommittedAudit, desktopReleaseService = createDesktopReleaseService() }) {
  // Serialize floor snapshots within this process. Cross-process database CAS
  // is still required before running multiple writers against shared storage.
  const floorLayoutMutationTails = new Map();
  const withFloorLayoutLock = async (key, task) => {
    const previous = floorLayoutMutationTails.get(key) || Promise.resolve();
    let release;
    const tail = new Promise((resolve) => { release = resolve; });
    floorLayoutMutationTails.set(key, tail);
    await previous;
    try { return await task(); }
    finally {
      release();
      if (floorLayoutMutationTails.get(key) === tail) floorLayoutMutationTails.delete(key);
    }
  };
  app.get('/api/admin/v2/overview', requireCapability('command.view'), (req, res) => res.json(overview(getDb(), parseBranchId(req))));
  app.get('/api/admin/v2/orders', requireCapability('orders.view'), (req, res) => {
    const db = getDb();
    const settings = db.settings || {};
    const includePii = commandCenter.can(req.user, 'pii.view', settings);
    const includePaymentReferences = commandCenter.can(req.user, 'payments.manage', settings);
    const includeDeliveryReason = commandCenter.can(req.user, 'delivery.manage', settings);
    const orders = branchFilter(asArray(db.orders), parseBranchId(req)).slice().sort(byNewest)
      .map((order) => operationalOrderDto(order, { includePii, includePaymentReferences, includeDeliveryReason }));
    res.json({ orders, serverTime: new Date().toISOString() });
  });
  app.get('/api/admin/v2/staff', requireCapability('staff.view'), (req, res) => {
    const users = asArray(getDb().users).filter((user) => ADMIN_STAFF_ROLES.has(String(user.role || 'guest'))).map((user) => ({
      phone: user.phone, name: user.name || user.phone, role: user.role || 'guest', blocked: !!user.blocked, email: user.email || '', birthdate: user.birthdate || '',
    }));
    res.json({ users });
  });
  app.post('/api/admin/v2/staff', requireCapability('staff.manage'), (req, res) => {
    const db = getDb();
    const phone = normalizeDigits(req.body?.phone || '').trim();
    const name = String(req.body?.name || '').trim().slice(0, 120);
    const role = String(req.body?.role || 'guest').trim().toLowerCase();
    if (!phoneRe.test(phone)) return res.status(400).json({ error: 'شماره موبایل معتبر نیست.' });
    if (!name) return res.status(400).json({ error: 'نام کارمند لازم است.' });
    if (!ADMIN_STAFF_ROLES.has(role) || role === 'owner') return res.status(400).json({ error: 'نقش کارمند معتبر نیست.' });
    if (role === 'manager' && !isOwnerActor(db, req.user)) return res.status(403).json({ error: 'staff_manager_protected' });
    if (asArray(db.users).some((user) => user.phone === phone)) return res.status(409).json({ error: 'کاربری با این شماره قبلاً ثبت شده است.' });
    const user = { phone, name, email: String(req.body?.email || '').trim().slice(0, 160), role, points: 0, createdAt: new Date().toISOString(), blocked: false, birthdate: String(req.body?.birthdate || '').trim().slice(0, 50) };
    db.users.push(user);
    if (typeof audit === 'function') audit(req, 'admin_v2.staff_created', 'user', phone, { role });
    save();
    res.status(201).json({ ok: true, user });
  });
  app.patch('/api/admin/v2/staff/:phone', requireCapability('staff.manage'), (req, res) => {
    const db = getDb();
    const user = asArray(db.users).find((candidate) => candidate.phone === req.params.phone);
    if (!user || !ADMIN_STAFF_ROLES.has(String(user.role || 'guest'))) return res.status(404).json({ error: 'staff_not_found' });
    try { assertStaffMutationBoundary(db, req, user); } catch (error) { return res.status(error.status || 403).json({ error: error.code || 'staff_mutation_forbidden' }); }
    if (typeof req.body?.name === 'string' && req.body.name.trim()) user.name = req.body.name.trim().slice(0, 120);
    if (typeof req.body?.birthdate === 'string') user.birthdate = req.body.birthdate.trim().slice(0, 50);
    if (typeof req.body?.blocked === 'boolean') user.blocked = req.body.blocked;
    const role = String(req.body?.role || '').trim().toLowerCase();
    if (role) {
      if (!ADMIN_STAFF_ROLES.has(role) || role === 'owner') return res.status(400).json({ error: 'نقش کارمند معتبر نیست.' });
      if (role === 'manager' && !isOwnerActor(db, req.user)) return res.status(403).json({ error: 'staff_manager_protected' });
      user.role = role;
    }
    if (typeof audit === 'function') audit(req, 'admin_v2.staff_updated', 'user', user.phone, { role: user.role, blocked: !!user.blocked });
    save();
    res.json({ ok: true, user });
  });
  app.delete('/api/admin/v2/staff/:phone', requireCapability('staff.manage'), (req, res) => {
    const db = getDb();
    const user = asArray(db.users).find((candidate) => candidate.phone === req.params.phone);
    if (!user || !ADMIN_STAFF_ROLES.has(String(user.role || 'guest'))) return res.status(404).json({ error: 'staff_not_found' });
    try { assertStaffMutationBoundary(db, req, user); } catch (error) { return res.status(error.status || 403).json({ error: error.code || 'staff_mutation_forbidden' }); }
    db.users = db.users.filter((candidate) => candidate.phone !== req.params.phone);
    if (typeof audit === 'function') audit(req, 'admin_v2.staff_deleted', 'user', user.phone, { role: user.role });
    save();
    res.json({ ok: true });
  });
  app.get('/api/admin/v2/floor', requireCapability('tables.view'), (req, res) => res.json(floor(getDb(), parseBranchId(req))));
  app.put('/api/admin/v2/floor/layout', requireCapability('tables.manage'), async (req, res) => {
    const branchId = parseBranchId(req);
    const branchNumber = Number(branchId);
    if (!Number.isSafeInteger(branchNumber) || branchNumber <= 0) {
      return res.status(400).json({ error: 'floor_layout_branch_required', message: 'برای ذخیرهٔ چیدمان، ابتدا یک شعبهٔ مشخص را انتخاب کنید.' });
    }
    const body = req.body || {};
    if (body.expectedLayoutRevision === undefined) {
      return res.status(428).json({ error: 'floor_layout_revision_required', message: 'نسخهٔ نقشه دریافت نشد؛ صفحه را تازه کنید و تغییرات را دوباره اعمال کنید.' });
    }
    if (!Number.isSafeInteger(body.expectedLayoutRevision) || body.expectedLayoutRevision < 0) {
      return res.status(400).json({ error: 'floor_layout_revision_invalid', message: 'نسخهٔ نقشه معتبر نیست؛ صفحه را تازه کنید.' });
    }
    const collectionInputIsValid = (value) => value === undefined || (Array.isArray(value) && value.every((item) => item && typeof item === 'object' && !Array.isArray(item)));
    if (!Array.isArray(body.tables) || !collectionInputIsValid(body.zones) || !collectionInputIsValid(body.fixtures) || !collectionInputIsValid(body.floors)) {
      return res.status(400).json({ error: 'floor_layout_payload_invalid', message: 'اطلاعات چیدمان کامل و معتبر نیست؛ هیچ تغییری ذخیره نشد.' });
    }

    const tenantKey = String(req.tenantId || req.tenant?.tenantId || 'westo');
    return withFloorLayoutLock(`${tenantKey}:${branchNumber}`, async () => {
    const db = getDb();
    const branchKey = String(branchNumber);
    const currentRevision = floorLayoutRevision(db, branchNumber);
    if (currentRevision === null) return res.status(503).json({ error: 'floor_layout_revision_unavailable', message: 'نسخهٔ ذخیره‌شدهٔ نقشه معتبر نیست؛ تا بررسی مدیر تغییری ذخیره نمی‌شود.' });
    if (body.expectedLayoutRevision !== currentRevision) {
      return res.status(409).json({
        error: 'floor_layout_revision_conflict',
        message: 'نقشه در دستگاه دیگری تغییر کرده است؛ تغییرات شما ذخیره نشد. نقشهٔ تازه را بارگیری و تغییرات را دوباره اعمال کنید.',
        layoutRevision: currentRevision,
      });
    }

    const foreignTableIds = body.tables
      .filter((incoming) => incoming.id !== undefined && incoming.id !== null)
      .filter((incoming) => {
        const sameId = asArray(db.tables).filter((existing) => String(existing.id) === String(incoming.id));
        return sameId.some((existing) => Number(existing.branchId) !== branchNumber)
          && !sameId.some((existing) => Number(existing.branchId) === branchNumber);
      })
      .map((incoming) => String(incoming.id));
    if (foreignTableIds.length) {
      return res.status(409).json({
        error: 'floor_layout_table_branch_conflict',
        message: 'شناسهٔ یکی از میزها به شعبهٔ دیگری تعلق دارد؛ نقشه ذخیره نشد.',
        tableIds: [...new Set(foreignTableIds)],
      });
    }

    const defaultBranchId = Number(asArray(db.branches)[0]?.id) || 1;
    const belongsToBranch = (row) => Number(row?.branchId || defaultBranchId) === branchNumber;
    const branchTables = asArray(db.tables).filter(belongsToBranch);
    const relatedTableIds = (table) => {
      const ids = new Set([String(Number(table.id))]);
      let changed = true;
      while (changed) {
        changed = false;
        for (const candidate of branchTables) {
          const candidateId = String(Number(candidate.id));
          const parentId = candidate.mergedInto == null ? '' : String(Number(candidate.mergedInto));
          const children = Array.isArray(candidate.mergedWith) ? candidate.mergedWith.map((id) => String(Number(id))) : [];
          const linked = (ids.has(candidateId) && children.some((id) => !ids.has(id)))
            || (parentId && ids.has(parentId) && !ids.has(candidateId))
            || (children.some((id) => ids.has(id)) && !ids.has(candidateId));
          if (linked) {
            ids.add(candidateId);
            if (parentId) ids.add(parentId);
            children.forEach((id) => ids.add(id));
            changed = true;
          }
        }
      }
      return ids;
    };
    const activeUseReason = (table) => {
      const relatedIds = relatedTableIds(table);
      const relatedTables = branchTables.filter((candidate) => relatedIds.has(String(Number(candidate.id))));
      const hasActiveDineInOrder = asArray(db.orders).filter(belongsToBranch).some((order) => {
        const tableNo = String(order.tableNo || '');
        if (!tableNo || commandCenter.normalizeFulfillment(order.fulfillment, { tableNo }) !== 'dine_in') return false;
        if (![...relatedIds].some((id) => waitlist.tableIdsOverlap(tableNo, id))) return false;
        const status = String(order.status || '');
        if (status === 'cancelled') return false;
        const serviceComplete = ['done', 'picked_up', 'delivered'].includes(status);
        const paymentNeedsAttention = ['unpaid', 'partial', 'pending', 'failed', 'unknown'].includes(commandCenter.paymentStatusFor(order));
        return !serviceComplete || paymentNeedsAttention;
      });
      if (hasActiveDineInOrder) return 'table_in_active_use';

      const relatedLabels = new Set(relatedTables.map((candidate) => String(candidate.label || '').trim()).filter(Boolean));
      const hasOpenWaiterCall = asArray(db.waiterCalls).filter(belongsToBranch).some((call) => {
        if (!['open', 'new'].includes(String(call.status || ''))) return false;
        const reference = String(call.tableNo || '').trim();
        return relatedLabels.has(reference) || [...relatedIds].some((id) => waitlist.tableIdsOverlap(reference, id));
      });
      if (hasOpenWaiterCall) return 'open_waiter_call';

      const now = new Date();
      const todayKey = localDateKey(now);
      const slotMinutes = db.reservationSettings?.slotMinutes;
      const hasActiveReservation = asArray(db.reservations).filter(belongsToBranch).some((reservation) => {
        if (![...relatedIds].some((id) => waitlist.tableIdsOverlap(reservation.tableNo, id))) return false;
        if (waitlist.isWaitlist(reservation)) return waitlist.isActive(reservation);
        if (!ACTIVE_RESERVATION_STATUSES.has(String(reservation.status || ''))) return false;
        if (reservation.status === 'seated') return true;
        const reservationDate = String(reservation.date || '').slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/u.test(reservationDate) || !todayKey) return true;
        if (reservationDate > todayKey) return true;
        if (reservationDate < todayKey) return false;
        return waitlist.reservationBlocksTable(reservation, now, slotMinutes);
      });
      return hasActiveReservation ? 'table_reserved' : null;
    };
    const physicalLayoutFields = [
      'x', 'y', 'floorId', 'zone', 'label', 'shape', 'chairModel', 'chairScale', 'tableScale', 'tableScaleX', 'tableScaleY', 'rotation',
      'seats', 'minSeats', 'maxSeats', 'active', 'mergedWith', 'mergedInto',
    ];
    const busyTableChanges = body.tables.flatMap((incoming) => {
      const existing = branchTables.find((table) => String(table.id) === String(incoming.id));
      if (!existing) return [];
      const changesPhysicalLayout = physicalLayoutFields.some((field) => {
        if (incoming[field] === undefined) return false;
        if (field === 'mergedWith' && !Array.isArray(incoming[field])) return false;
        return JSON.stringify(existing[field] ?? null) !== JSON.stringify(incoming[field] ?? null);
      });
      if (!changesPhysicalLayout) return [];
      const reason = activeUseReason(existing);
      return reason ? [{ id: String(existing.id), reason }] : [];
    });
    if (busyTableChanges.length) {
      return res.status(409).json({
        error: 'floor_layout_table_in_use',
        message: 'چیدمان فیزیکی میزهای در حال سرویس، دارای تماس باز یا رزرو فعال تغییر نکرد؛ پس از پایان سرویس دوباره تلاش کنید.',
        tables: busyTableChanges,
        layoutRevision: currentRevision,
      });
    }

    const branchCollections = ['tables', 'floorZones', 'floorFixtures', 'floors', 'floorSettingsList'];
    const snapshot = Object.fromEntries(branchCollections.map((key) => [key,
      asArray(db[key]).filter((item) => Number(item.branchId) === branchNumber).map((item) => JSON.parse(JSON.stringify(item)))
    ]));
    const priorRevision = db.floorLayoutRevisions?.[branchKey];
    const layout = body.tables;
    try {
    if (!Array.isArray(db.tables)) db.tables = [];
    layout.forEach((incoming) => {
      let existing = db.tables.find((t) => String(t.id) === String(incoming.id) && (branchId == null || Number(t.branchId) === Number(branchId)));
      if (!existing && incoming.id) {
        existing = {
          id: Number(incoming.id) || incoming.id,
          label: incoming.label || `میز ${incoming.id}`,
          seats: Number(incoming.seats) || 4,
          zone: incoming.zone || 'سالن',
          active: true,
          branchId: branchId || 1,
        };
        db.tables.push(existing);
      }
      if (existing) {
        if (typeof incoming.x === 'number') existing.x = Math.max(0, Math.min(100, Math.round(incoming.x * 10) / 10));
        if (typeof incoming.y === 'number') existing.y = Math.max(0, Math.min(100, Math.round(incoming.y * 10) / 10));
        if (incoming.shape) existing.shape = String(incoming.shape).slice(0, 20);
        if (incoming.chairModel) existing.chairModel = String(incoming.chairModel).slice(0, 25);
        if (typeof incoming.chairScale === 'number') existing.chairScale = Math.max(0.6, Math.min(2.0, Math.round(incoming.chairScale * 100) / 100));
        if (typeof incoming.tableScale === 'number') existing.tableScale = Math.max(0.6, Math.min(2.5, Math.round(incoming.tableScale * 100) / 100));
        if (typeof incoming.tableScaleX === 'number') existing.tableScaleX = Math.max(0.5, Math.min(3, Math.round(incoming.tableScaleX * 100) / 100));
        if (typeof incoming.tableScaleY === 'number') existing.tableScaleY = Math.max(0.5, Math.min(3, Math.round(incoming.tableScaleY * 100) / 100));
        if (typeof incoming.rotation === 'number') existing.rotation = Math.round(incoming.rotation) % 360;
        if (typeof incoming.seats === 'number') existing.seats = Math.max(1, Math.min(24, Math.round(incoming.seats)));
        if (incoming.zone) existing.zone = String(incoming.zone).slice(0, 50);
        if (incoming.label) existing.label = String(incoming.label).slice(0, 50);
        if (typeof incoming.active === 'boolean') existing.active = incoming.active;
        if (incoming.floorId) existing.floorId = String(incoming.floorId).slice(0, 40);
        if (Array.isArray(incoming.mergedWith)) existing.mergedWith = incoming.mergedWith.map((id) => Number(id) || String(id));
        if (incoming.mergedInto !== undefined) existing.mergedInto = incoming.mergedInto ? (Number(incoming.mergedInto) || String(incoming.mergedInto)) : null;
        if (Array.isArray(incoming.tags)) existing.tags = incoming.tags.slice(0, 10).map((tag) => String(tag).slice(0, 30));
        if (typeof incoming.minSeats === 'number') existing.minSeats = Math.max(1, Math.min(20, Math.round(incoming.minSeats)));
        if (typeof incoming.maxSeats === 'number') existing.maxSeats = Math.max(1, Math.min(30, Math.round(incoming.maxSeats)));
      }
    });
    if (Array.isArray(req.body?.zones)) {
      if (!Array.isArray(db.floorZones)) db.floorZones = [];
      const sanitizedZones = req.body.zones.map((z, idx) => {
        const lengthM = typeof z.lengthM === 'number' && z.lengthM > 0
          ? Math.max(1, Math.min(500, Math.round(z.lengthM * 10) / 10))
          : (z.w ? Math.max(1, Math.round(z.w * 0.25 * 10) / 10) : 10);
        const widthM = typeof z.widthM === 'number' && z.widthM > 0
          ? Math.max(1, Math.min(500, Math.round(z.widthM * 10) / 10))
          : (z.h ? Math.max(1, Math.round(z.h * 0.25 * 10) / 10) : 6);
        const areaSqM = typeof z.areaSqM === 'number' && z.areaSqM > 0
          ? Math.round(z.areaSqM * 10) / 10
          : Math.round(lengthM * widthM * 10) / 10;
        return {
          id: String(z.id || `zone-${Date.now()}-${idx}`),
          name: String(z.name || 'بخش سالن').trim().slice(0, 50),
          x: Math.max(0, Math.min(100, Math.round((Number(z.x) || 0) * 10) / 10)),
          y: Math.max(0, Math.min(100, Math.round((Number(z.y) || 0) * 10) / 10)),
          w: Math.max(5, Math.min(100, Math.round((Number(z.w) || 20) * 10) / 10)),
          h: Math.max(5, Math.min(100, Math.round((Number(z.h) || 20) * 10) / 10)),
          color: String(z.color || 'blue').slice(0, 20),
          icon: String(z.icon || '🏷️').slice(0, 10),
          lengthM,
          widthM,
          areaSqM,
          shape: String(z.shape || 'rectangle').slice(0, 30),
          ...(z.floorId && String(z.floorId) !== '__unassigned__' ? { floorId: String(z.floorId).slice(0, 40) } : {}),
          branchId: branchId || 1,
        };
      });
      db.floorZones = db.floorZones
        .filter((z) => branchId != null && Number(z.branchId) !== Number(branchId))
        .concat(sanitizedZones);
    }
    if (Array.isArray(req.body?.fixtures)) {
      if (!Array.isArray(db.floorFixtures)) db.floorFixtures = [];
      const sanitizedFixtures = req.body.fixtures.map((f, idx) => ({
        id: String(f.id || `fix-${Date.now()}-${idx}`),
        type: String(f.type || 'fixture').slice(0, 30),
        name: String(f.name || 'المان سالن').trim().slice(0, 50),
        x: Math.max(0, Math.min(100, Math.round((Number(f.x) || 0) * 10) / 10)),
        y: Math.max(0, Math.min(100, Math.round((Number(f.y) || 0) * 10) / 10)),
        w: Math.max(2, Math.min(100, Math.round((Number(f.w) || 10) * 10) / 10)),
        h: Math.max(2, Math.min(100, Math.round((Number(f.h) || 10) * 10) / 10)),
        rotation: (Math.round(Number(f.rotation) || 0)) % 360,
        color: String(f.color || 'slate').slice(0, 20),
        icon: String(f.icon || '🏷️').slice(0, 10),
        ...(f.floorId && String(f.floorId) !== '__unassigned__' ? { floorId: String(f.floorId).slice(0, 40) } : {}),
        branchId: branchId || 1,
      }));
      db.floorFixtures = db.floorFixtures
        .filter((f) => branchId != null && Number(f.branchId) !== Number(branchId))
        .concat(sanitizedFixtures);
    }
    if (Array.isArray(req.body?.floors)) {
      if (!Array.isArray(db.floors)) db.floors = [];
      const sanitizedFloors = req.body.floors.map((fl, idx) => ({
        id: String(fl.id || `floor-${idx}`),
        name: String(fl.name || `طبقه ${idx + 1}`).trim().slice(0, 50),
        level: Number(fl.level) || idx,
        icon: String(fl.icon || '🏛️').slice(0, 10),
        isDefault: Boolean(fl.isDefault),
        branchId: branchId || 1,
      }));
      db.floors = db.floors
        .filter((fl) => branchId != null && Number(fl.branchId) !== Number(branchId))
        .concat(sanitizedFloors);
    }
    if (req.body?.settings && typeof req.body.settings === 'object') {
      if (!Array.isArray(db.floorSettingsList)) db.floorSettingsList = [];
      const sanitizedSettings = {
        branchId: branchId || 1,
        widthM: Math.max(5, Math.min(200, Number(req.body.settings.widthM) || 20)),
        lengthM: Math.max(5, Math.min(200, Number(req.body.settings.lengthM) || 25)),
        gridStep: [0.5, 1, 2, 5].includes(Number(req.body.settings.gridStep)) ? Number(req.body.settings.gridStep) : 0.5,
        bgTheme: String(req.body.settings.bgTheme || 'blueprint').slice(0, 30),
        wallThickness: Math.max(0.1, Math.min(2, Number(req.body.settings.wallThickness) || 0.4)),
        showRulers: req.body.settings.showRulers !== false,
        showGrid: req.body.settings.showGrid !== false,
      };
      db.floorSettingsList = db.floorSettingsList
        .filter((s) => branchId != null && Number(s.branchId) !== Number(branchId))
        .concat([sanitizedSettings]);
    }
    db.floorLayoutRevisions = { ...(db.floorLayoutRevisions || {}), [branchKey]: currentRevision + 1 };
    if (typeof save !== 'function' || await save({ requireDurable: true }) !== true) {
      throw Object.assign(new Error('floor_layout_persistence_failed'), { code: 'floor_layout_persistence_failed' });
    }
    const savedFloor = floor(db, branchNumber);
    return res.json({ ok: true, floor: savedFloor, layoutRevision: currentRevision + 1 });
    } catch (error) {
      for (const key of branchCollections) {
        const untouched = asArray(db[key]).filter((item) => Number(item.branchId) !== branchNumber);
        db[key] = untouched.concat(snapshot[key]);
      }
      const revisions = { ...(db.floorLayoutRevisions || {}) };
      if (priorRevision === undefined) delete revisions[branchKey];
      else revisions[branchKey] = priorRevision;
      db.floorLayoutRevisions = revisions;
      return res.status(error.status || 503).json({
        error: error.code || 'floor_layout_persistence_failed',
        message: 'ذخیرهٔ چیدمان تأیید نشد؛ تغییرات قبلی حفظ شد. وضعیت ذخیره را دوباره بررسی کنید.',
      });
    }
    });
  });

  app.post('/api/admin/v2/floor/tables/delete', requireCapability('tables.manage'), async (req, res) => {
    const branchId = parseBranchId(req);
    const branchNumber = Number(branchId);
    if (!Number.isSafeInteger(branchNumber) || branchNumber <= 0) {
      return res.status(400).json({ error: 'floor_layout_branch_required', message: 'برای حذف میز، ابتدا یک شعبهٔ مشخص را انتخاب کنید.' });
    }
    const body = req.body || {};
    if (!Number.isSafeInteger(body.expectedLayoutRevision) || body.expectedLayoutRevision < 0) {
      return res.status(body.expectedLayoutRevision === undefined ? 428 : 400).json({
        error: body.expectedLayoutRevision === undefined ? 'floor_layout_revision_required' : 'floor_layout_revision_invalid',
        message: 'نسخهٔ نقشه دریافت نشد یا معتبر نیست؛ صفحه را تازه کنید.',
      });
    }
    if (!Array.isArray(body.tableIds) || body.tableIds.length < 1 || body.tableIds.length > 200) {
      return res.status(400).json({ error: 'floor_table_delete_ids_invalid', message: 'فهرست میزهای انتخاب‌شده معتبر نیست.' });
    }
    const requestedIds = body.tableIds.map((raw) => {
      const normalized = String(normalizeDigits(String(raw ?? ''))).trim();
      const id = Number(normalized);
      return /^\d+$/u.test(normalized) && Number.isSafeInteger(id) && id > 0 ? String(id) : null;
    });
    if (requestedIds.some((id) => id === null) || new Set(requestedIds).size !== requestedIds.length) {
      return res.status(400).json({ error: 'floor_table_delete_ids_invalid', message: 'شناسهٔ میز نامعتبر یا تکراری است.' });
    }
    if (typeof audit !== 'function' || typeof appendCommittedAudit !== 'function') {
      return res.status(503).json({ error: 'floor_table_delete_audit_unavailable', message: 'ثبت ردپای حسابرسی در دسترس نیست؛ هیچ میزی حذف نشد.' });
    }

    const tenantKey = String(req.tenantId || req.tenant?.tenantId || 'westo');
    return withFloorLayoutLock(`${tenantKey}:${branchNumber}`, async () => {
      const db = getDb();
      const branchKey = String(branchNumber);
      const currentRevision = floorLayoutRevision(db, branchNumber);
      if (currentRevision === null) return res.status(503).json({ error: 'floor_layout_revision_unavailable', message: 'نسخهٔ ذخیره‌شدهٔ نقشه معتبر نیست؛ تا بررسی مدیر تغییری انجام نمی‌شود.' });
      if (body.expectedLayoutRevision !== currentRevision) {
        return res.status(409).json({
          error: 'floor_layout_revision_conflict',
          message: 'نقشه در دستگاه دیگری تغییر کرده است؛ هیچ میزی حذف نشد. نسخهٔ تازه را بارگیری کنید.',
          layoutRevision: currentRevision,
        });
      }

      const defaultBranchId = Number(asArray(db.branches)[0]?.id) || 1;
      const belongsToBranch = (row) => Number(row?.branchId || defaultBranchId) === branchNumber;
      const branchTables = asArray(db.tables).filter(belongsToBranch);
      const relatedTableIds = (table) => {
        const ids = new Set([String(Number(table.id))]);
        let changed = true;
        while (changed) {
          changed = false;
          for (const candidate of branchTables) {
            const candidateId = String(Number(candidate.id));
            const parentId = candidate.mergedInto == null ? '' : String(Number(candidate.mergedInto));
            const children = Array.isArray(candidate.mergedWith) ? candidate.mergedWith.map((id) => String(Number(id))) : [];
            const linked = ids.has(candidateId) && children.some((id) => !ids.has(id))
              || parentId && ids.has(parentId) && !ids.has(candidateId)
              || children.some((id) => ids.has(id)) && !ids.has(candidateId);
            if (linked) {
              ids.add(candidateId);
              if (parentId) ids.add(parentId);
              children.forEach((id) => ids.add(id));
              changed = true;
            }
          }
        }
        return ids;
      };
      const activeUseReason = (table) => {
        const relatedIds = relatedTableIds(table);
        const relatedTables = branchTables.filter((candidate) => relatedIds.has(String(Number(candidate.id))));
        const orders = asArray(db.orders).filter(belongsToBranch);
        const hasActiveDineInOrder = orders.some((order) => {
          const tableNo = String(order.tableNo || '');
          if (!tableNo || commandCenter.normalizeFulfillment(order.fulfillment, { tableNo }) !== 'dine_in') return false;
          if (![...relatedIds].some((id) => waitlist.tableIdsOverlap(tableNo, id))) return false;
          const status = String(order.status || '');
          if (status === 'cancelled') return false;
          const serviceComplete = ['done', 'picked_up', 'delivered'].includes(status);
          const paymentNeedsAttention = ['unpaid', 'partial', 'pending', 'failed', 'unknown'].includes(commandCenter.paymentStatusFor(order));
          return !serviceComplete || paymentNeedsAttention;
        });
        if (hasActiveDineInOrder) return 'table_in_active_use';

        const relatedLabels = new Set(relatedTables
          .map((candidate) => String(candidate.label || '').trim())
          .filter(Boolean));
        const hasOpenWaiterCall = asArray(db.waiterCalls).filter(belongsToBranch).some((call) => {
          if (!['open', 'new'].includes(String(call.status || ''))) return false;
          const reference = String(call.tableNo || '').trim();
          return relatedLabels.has(reference)
            || [...relatedIds].some((id) => waitlist.tableIdsOverlap(reference, id));
        });
        if (hasOpenWaiterCall) return 'open_waiter_call';

        const now = new Date();
        const todayKey = localDateKey(now);
        const slotMinutes = db.reservationSettings?.slotMinutes;
        const hasActiveReservation = asArray(db.reservations).filter(belongsToBranch).some((reservation) => {
          if (![...relatedIds].some((id) => waitlist.tableIdsOverlap(reservation.tableNo, id))) return false;
          if (waitlist.isWaitlist(reservation)) return waitlist.isActive(reservation);
          if (!ACTIVE_RESERVATION_STATUSES.has(String(reservation.status || ''))) return false;
          if (reservation.status === 'seated') return true;
          const reservationDate = String(reservation.date || '').slice(0, 10);
          if (!/^\d{4}-\d{2}-\d{2}$/u.test(reservationDate) || !todayKey) return true;
          if (reservationDate > todayKey) return true;
          if (reservationDate < todayKey) return false;
          return waitlist.reservationBlocksTable(reservation, now, slotMinutes);
        });
        return hasActiveReservation ? 'table_reserved' : null;
      };

      const deleted = [];
      const alreadyAbsentIds = [];
      const rejected = [];
      for (const id of requestedIds) {
        const table = branchTables.find((candidate) => String(Number(candidate.id)) === id);
        if (!table) {
          if (asArray(db.tables).some((candidate) => String(Number(candidate.id)) === id && !belongsToBranch(candidate))) {
            rejected.push({ id, reason: 'table_not_found' });
          } else {
            alreadyAbsentIds.push(id);
          }
          continue;
        }
        const reason = activeUseReason(table);
        if (reason) rejected.push({ id, reason });
        else deleted.push(table);
      }

      if (!deleted.length) {
        return res.json({
          ok: true,
          deletedIds: [],
          alreadyAbsentIds,
          rejected,
          layoutRevision: currentRevision,
          floor: floor(db, branchNumber),
        });
      }

      const deletedIds = new Set(deleted.map((table) => String(Number(table.id))));
      const branchSnapshot = branchTables.map((table) => JSON.parse(JSON.stringify(table)));
      const priorRevision = db.floorLayoutRevisions?.[branchKey];
      const hadAuditLog = Array.isArray(db.auditLog);
      const auditEntries = [];
      try {
        db.tables = asArray(db.tables).filter((table) => !belongsToBranch(table) || !deletedIds.has(String(Number(table.id))));
        asArray(db.tables).filter(belongsToBranch).forEach((table) => {
          if (deletedIds.has(String(Number(table.mergedInto)))) table.mergedInto = null;
          if (Array.isArray(table.mergedWith)) table.mergedWith = table.mergedWith.filter((id) => !deletedIds.has(String(Number(id))));
        });
        db.floorLayoutRevisions = { ...(db.floorLayoutRevisions || {}), [branchKey]: currentRevision + 1 };
        for (const table of deleted) {
          const entry = audit(req, 'admin_v2.floor_table_deleted', 'table', table.id, {
            label: String(table.label || '').slice(0, 80), layoutRevision: currentRevision + 1,
          }, branchNumber, { deferAppend: true });
          if (entry) auditEntries.push(entry);
        }
        if (await save({ requireDurable: true }) !== true) {
          throw Object.assign(new Error('floor_table_delete_persistence_failed'), { code: 'floor_table_delete_persistence_failed' });
        }
      } catch (error) {
        db.tables = asArray(db.tables).filter((table) => !belongsToBranch(table)).concat(branchSnapshot);
        const revisions = { ...(db.floorLayoutRevisions || {}) };
        if (priorRevision === undefined) delete revisions[branchKey];
        else revisions[branchKey] = priorRevision;
        db.floorLayoutRevisions = revisions;
        if (Array.isArray(db.auditLog)) {
          const entries = new Set(auditEntries);
          const ids = new Set(auditEntries.map((entry) => String(entry.id ?? '')));
          db.auditLog = db.auditLog.filter((entry) => !entries.has(entry) && !ids.has(String(entry.id ?? '')));
          if (!hadAuditLog && db.auditLog.length === 0) delete db.auditLog;
        }
        return res.status(503).json({
          error: error.code || 'floor_table_delete_persistence_failed',
          message: 'حذف میز پایدار نشد؛ تغییرات قبلی حفظ شد و هیچ حذفی تأیید نمی‌شود.',
        });
      }

      auditEntries.forEach((entry) => appendCommittedAudit(entry));
      return res.json({
        ok: true,
        deletedIds: [...deletedIds],
        alreadyAbsentIds,
        rejected,
        layoutRevision: currentRevision + 1,
        floor: floor(db, branchNumber),
      });
    });
  });

  app.get('/api/admin/v2/kitchen', requireCapability('kitchen.view'), (req, res) => res.json(kitchen(getDb(), parseBranchId(req))));
  app.get('/api/admin/v2/catalog', requireCapability('inventory.view'), (req, res) => res.json(catalog(getDb(), parseBranchId(req))));
  // pii.view: tighter than admin.access — manager-level users cannot see CRM data unless explicitly granted pii.view
  app.get('/api/admin/v2/crm', requireCapability('pii.view'), (req, res) => {
    const requestedBranch = requestBranchValue(req);
    if (String(requestedBranch || '').toLowerCase() === 'all') {
      if (effectiveRole(req.user) !== 'owner') return res.status(403).json({ error: 'crm_all_branches_owner_only' });
      return res.json(crm(getDb(), null));
    }
    return res.json(crm(getDb(), parseBranchId(req)));
  });
  // finance.view: separate from admin.access so accountants/managers can be granularly scoped
  app.get('/api/admin/v2/finance', requireCapability('finance.view'), (req, res) => res.json(finance(getDb(), parseBranchId(req))));
  app.get('/api/admin/v2/settings', requireAdmin, (req, res) => res.json(settings(getDb())));
  app.get('/api/admin/v2/desktop/releases', requireAdmin, (req, res) => res.json(desktopReleaseService.list()));
  app.get('/api/admin/v2/desktop/releases/:platform/:arch/:format/download', requireAdmin, (req, res) => {
    const artifact = desktopReleaseService.resolve(req.params.platform, req.params.arch, req.params.format);
    if (!artifact) return res.status(404).json({ error: 'desktop_release_not_found', message: 'فایل نصب‌کنندهٔ این سیستم‌عامل هنوز منتشر نشده است.' });
    return res.download(artifact.absolutePath, artifact.fileName, { dotfiles: 'deny', maxAge: 0 }, (error) => {
      if (error && !res.headersSent) res.status(error.statusCode || 500).json({ error: 'desktop_release_download_failed' });
    });
  });
  app.patch('/api/admin/v2/settings', requireCapability('settings.manage'), (req, res) => {
    const db = getDb(); const category = String(req.body?.category || ''); const values = req.body?.values || {};
    if (!SETTINGS_CATEGORIES.some(([id]) => id === category)) return res.status(400).json({ error: 'settings_category_invalid' });
    // Owner-only settings categories require the settings.manage cap AND owner role
    if (isOwnerOnlySettingsCategory(category) && !isOwnerActor(db, req.user)) {
      return res.status(403).json({ error: 'settings_owner_only', category, message: 'این تنظیمات فقط توسط مالک قابل تغییر است.' });
    }
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
      const sanitized = Object.fromEntries(Object.entries(values).map(([key, value]) => [String(key), String(value ?? '').slice(0, 500)]));
      db.adminV2Settings = { ...(db.adminV2Settings || {}), [category]: { ...sanitized, updatedAt: new Date().toISOString() } };
    }
    save(); res.json({ ok: true, settings: settings(db) });
  });

  app.get('/api/admin/v2/resources', requireAdmin, (req, res) => {
    const store = resourceStore(getDb());
    const resources = Object.fromEntries(ADMIN_V2_RESOURCE_KEYS.map((key) => [key, store[key].map(publicResourceRow)]));
    res.json({ resources });
  });

  app.get('/api/admin/v2/resources/:resource', requireAdmin, (req, res) => {
    const resource = String(req.params.resource || '');
    if (!isAdminV2Resource(resource)) return res.status(404).json({ error: 'admin_v2_resource_not_found' });
    res.json({ resource, rows: resourceStore(getDb())[resource].map(publicResourceRow) });
  });

  app.post('/api/admin/v2/resources/:resource', requireAdmin, (req, res) => {
    const resource = String(req.params.resource || '');
    if (!isAdminV2Resource(resource)) return res.status(404).json({ error: 'admin_v2_resource_not_found' });
    const row = normalizeResourceRow(resource, req.body?.row || req.body);
    if (!Object.values(row).some((value) => String(value || '').trim())) return res.status(400).json({ error: 'admin_v2_resource_row_empty' });
    const now = new Date().toISOString();
    const item = { id: `v2-${resource}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`, ...row, createdAt: now, updatedAt: now };
    const store = resourceStore(getDb());
    store[resource].unshift(item);
    if (typeof audit === 'function') audit(req, 'admin_v2.resource_created', resource, item.id, { keys: Object.keys(row) });
    save();
    res.status(201).json({ ok: true, row: publicResourceRow(item) });
  });

  app.patch('/api/admin/v2/resources/:resource/:id', requireAdmin, (req, res) => {
    const resource = String(req.params.resource || '');
    if (!isAdminV2Resource(resource)) return res.status(404).json({ error: 'admin_v2_resource_not_found' });
    const store = resourceStore(getDb());
    const item = store[resource].find((candidate) => String(candidate.id) === String(req.params.id));
    if (!item) return res.status(404).json({ error: 'admin_v2_resource_row_not_found' });
    Object.assign(item, normalizeResourceRow(resource, req.body?.row || req.body, item), { updatedAt: new Date().toISOString() });
    if (typeof audit === 'function') audit(req, 'admin_v2.resource_updated', resource, item.id, { keys: Object.keys(req.body?.row || req.body || {}) });
    save();
    res.json({ ok: true, row: publicResourceRow(item) });
  });

  app.delete('/api/admin/v2/resources/:resource/:id', requireAdmin, (req, res) => {
    const resource = String(req.params.resource || '');
    if (!isAdminV2Resource(resource)) return res.status(404).json({ error: 'admin_v2_resource_not_found' });
    const store = resourceStore(getDb());
    const before = store[resource].length;
    store[resource] = store[resource].filter((candidate) => String(candidate.id) !== String(req.params.id));
    if (store[resource].length === before) return res.status(404).json({ error: 'admin_v2_resource_row_not_found' });
    if (typeof audit === 'function') audit(req, 'admin_v2.resource_deleted', resource, req.params.id);
    save();
    res.json({ ok: true });
  });
}

module.exports = {
  registerAdminV2Routes,
  adminOrderDto,
  operationalOrderDto,
  adminPaymentDto,
  __test: {
    overview, floor, kitchen, catalog, crm, finance, settings,
    SETTINGS_CATEGORIES, ADMIN_V2_RESOURCE_KEYS, normalizeResourceRow,
    adminOrderDto, operationalOrderDto, adminPaymentDto, isOwnerActor,
    assertStaffMutationBoundary, localDateKey,
  },
};
