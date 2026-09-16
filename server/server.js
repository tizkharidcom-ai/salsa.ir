/* Westo server: static site + OTP auth + admin/content API (JSON file storage). */
if (!process.env.NEEM_CONTROL_ALLOW_EPHEMERAL_DEV) {
  process.env.NEEM_CONTROL_ALLOW_EPHEMERAL_DEV = 'true';
}
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const compression = require('compression');
const multer = require('multer');
const QRCode = require('qrcode');
const { translateMenuItem, isBrokenEn } = require('./translate');
const {
  ROLE_CAPABILITIES,
  normalizeRole,
  capabilitiesFor,
  branchScopeForUser,
  can: hasCapability,
  roleLabel,
  normalizeFulfillment,
  paymentStatusFor,
  initialOrderStatus,
  canTransitionOrder,
  canEditOrderBeforeKitchen,
  allowedOrderTransitions,
  quoteFulfillment,
  nextId,
  createAuditEntry,
  createEventHub,
  isOwnerActor,
  assertStaffMutationBoundary,
} = require('./command-center');
const { createPostgresStateStore } = require('./postgres-state');
const { translationEngine } = require('./neem/provider-policy');
const { registerAdminV2Routes } = require('./admin-v2');
const financeV2 = require('./finance-v2');
const {
  defaultModifierGroupsForItem,
  normalizeModifierGroups,
  effectiveModifierGroupsForItem,
} = require('./menu-modifiers');
const accountingEngine = require('./accounting-engine');
const { registerAccountingRoutes } = require('./accounting-routes');
const loyaltyEngine = require('./finance/loyalty-engine');
const walletEngine = require('./finance/wallet-engine');
const campaignsEngine = require('./finance/campaigns-engine');
const smsEngine = require('./finance/sms-engine');
const shamsi = require('./finance/shamsi.js');
const {
  notifyOrderWhatsApp,
  notifyReservationWhatsApp,
  waMeUrl,
  buildOrderMessage,
  resolveNotifyPhone,
  toWaDigits,
} = require('./whatsapp-notify');
const { createNeemBridge } = require('./neem-bridge');
const {
  DEFAULT_PRINTER_CONFIG,
  ensurePrintingData,
  listSystemPrinters,
  normalizePrinterConfig,
  printerForBranch,
  printOrder: sendOrderToPrinter,
  printRasterReceipt,
  publicPrinterConfig,
  testPrinter,
} = require('./network-printer');
const waitlist = require('./waitlist');
const { AsyncLocalStorage } = require('node:async_hooks');
const {
  loadTenantConfig,
  tenantHostMiddleware,
  publicTenantContext,
  resolveTenantSlugFromRequest,
  normalizeTenantId,
} = require('./neem/tenant-config');
const { TenantRegistry } = require('./neem/tenant-registry');
const {
  CANONICAL_FEATURES,
  resolveFeatureForRoute,
  isFeatureEnabledForTenant,
  getFeatureInfo,
} = require('./neem/canonical-features');
const {
  createNeemPrincipalMiddleware,
  requireCapabilityEnforced,
  requireAnyCapabilityEnforced,
  neemRouteAwarePolicyMiddleware,
  isOwnerOnlySettingsCategory,
  assertTenantBoundary,
} = require('./neem/westo-policy-enforcement');
const { lookupCapability, lookupPolicyCapability } = require('./neem/route-capability-map');

const ROOT = path.join(__dirname, '..');
const DB_PATH = process.env.WESTO_DB_PATH || path.join(__dirname, 'data', 'db.json');
const DEFAULT_JSON_DB_PATH = path.join(__dirname, 'data', 'db.json');
// Capture test-runtime identity once. Individual tests intentionally toggle
// NODE_ENV to exercise production fail-closed branches; persistence guards
// must not follow that mutable value and accidentally write the operator's
// default checkout database from a test timer or shutdown hook.
const IS_NODE_TEST_RUNTIME = process.env.NODE_ENV === 'test'
  || process.execArgv.includes('--test')
  || process.argv.includes('--test')
  || process.argv.some((arg) => /test/i.test(arg));
const UPLOADS = path.join(ROOT, 'uploads');
const PORT = process.env.PORT == null ? 4180 : Number(process.env.PORT);
const FINANCIAL_PAID_ORDER_STATUSES = new Set(['paid', 'preparing', 'ready', 'dispatched', 'picked_up', 'delivered', 'done']);
// The restaurant stations need to reach the local server from other devices
// on the same LAN (waiter/KDS/cashier terminals). Keep HOST overridable for
// tests and restricted deployments, but make the normal local run LAN-ready.
const HOST = process.env.HOST || '0.0.0.0';
const SECRET_PATH = process.env.WESTO_SECRET_PATH || path.join(__dirname, 'data', 'secret.key');
const TENANT_CONFIG = loadTenantConfig();

/** Legacy Ciao energy-drink textures — never use as food hero covers. */
function isDrinkTexturePath(raw) {
  const s = String(raw || '');
  return /assets\/textures\/westo_texture_/i.test(s);
}

function sanitizeMenuImg(raw) {
  const img = String(raw || '').trim().slice(0, 300);
  if (!img) return '';
  if (/^(assets\/|uploads\/|https?:\/\/)/.test(img)) return img;
  return null;
}

/** Cover paths: same allowlist as dish img, but drink-label textures are rejected. */
function sanitizeCoverImg(raw) {
  const img = sanitizeMenuImg(raw);
  if (img === null) return null;
  if (!img) return '';
  if (isDrinkTexturePath(img)) return null;
  return img;
}

const PROMO_ACTION_TYPES = new Set(['none', 'url', 'instagram', 'internal', 'category', 'dish']);
const PROMO_KINDS = new Set(['general', 'instagram', 'chef-special', 'event', 'offer', 'announcement']);
const PROMO_PLACEMENTS = new Set(['entrance', 'menu', 'both']);

function promoText(raw, max = 160) {
  return String(raw || '').trim().slice(0, max);
}

function promoIso(raw) {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

function sanitizePromoSlideInput(input = {}, current = {}) {
  const imageRaw = input.image !== undefined ? sanitizeMenuImg(input.image) : current.image;
  const actionTypeRaw = promoText(input.actionType !== undefined ? input.actionType : current.actionType, 32);
  const kindRaw = promoText(input.kind !== undefined ? input.kind : current.kind, 32);
  const placementRaw = promoText(input.placement !== undefined ? input.placement : current.placement, 24);
  const branchRaw = input.branchId !== undefined ? input.branchId : current.branchId;
  const branchNum = branchRaw == null || branchRaw === '' ? null : Number(normalizeDigits(String(branchRaw)).replace(/\D/g, ''));
  const branchId = Number.isFinite(branchNum) ? branchNum : null;
  const rawAutoplay = input.autoplayMs !== undefined ? input.autoplayMs : current.autoplayMs;
  const parsedAutoplay = typeof rawAutoplay === 'number'
    ? rawAutoplay
    : Number(normalizeDigits(String(rawAutoplay || '')).replace(/[,٬_\s]/g, '').trim());
  const autoplayMs = Math.max(0, Math.min(20000, Math.round(parsedAutoplay || 0)));
  return {
    ...current,
    title: promoText(input.title !== undefined ? input.title : current.title, 120),
    subtitle: promoText(input.subtitle !== undefined ? input.subtitle : current.subtitle, 220),
    badge: promoText(input.badge !== undefined ? input.badge : current.badge, 48),
    image: imageRaw == null ? (current.image || '') : imageRaw,
    ctaLabel: promoText(input.ctaLabel !== undefined ? input.ctaLabel : current.ctaLabel, 64),
    actionType: PROMO_ACTION_TYPES.has(actionTypeRaw) ? actionTypeRaw : 'none',
    actionValue: promoText(input.actionValue !== undefined ? input.actionValue : current.actionValue, 500),
    kind: PROMO_KINDS.has(kindRaw) ? kindRaw : 'general',
    placement: PROMO_PLACEMENTS.has(placementRaw) ? placementRaw : (PROMO_PLACEMENTS.has(current.placement) ? current.placement : 'entrance'),
    shareEnabled: input.shareEnabled !== undefined ? Boolean(input.shareEnabled) : current.shareEnabled !== false,
    enabled: input.enabled !== undefined ? Boolean(input.enabled) : current.enabled !== false,
    status: (input.status !== undefined ? input.status : current.status) === 'draft' ? 'draft' : 'published',
    startAt: input.startAt !== undefined ? promoIso(input.startAt) : (current.startAt || null),
    endAt: input.endAt !== undefined ? promoIso(input.endAt) : (current.endAt || null),
    branchId,
    sortOrder: Number.isFinite(Number(input.sortOrder)) ? Number(input.sortOrder) : (Number(current.sortOrder) || 0),
    autoplayMs,
  };
}

function publicPromoSlides() {
  const nowMs = Date.now();
  return (db.promoSlides || [])
    .filter((slide) => {
      if (!slide || slide.enabled === false || slide.status === 'draft') return false;
      if (slide.startAt && new Date(slide.startAt).getTime() > nowMs) return false;
      if (slide.endAt && new Date(slide.endAt).getTime() < nowMs) return false;
      return true;
    })
    .sort((a, b) => (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0) || Number(a.id) - Number(b.id))
    .map((slide) => ({
      id: slide.id,
      title: slide.title || '',
      subtitle: slide.subtitle || '',
      badge: slide.badge || '',
      image: slide.image || '',
      ctaLabel: slide.ctaLabel || '',
      actionType: slide.actionType || 'none',
      actionValue: slide.actionValue || '',
      kind: slide.kind || 'general',
      placement: PROMO_PLACEMENTS.has(slide.placement) ? slide.placement : 'entrance',
      shareEnabled: slide.shareEnabled !== false,
      branchId: slide.branchId == null ? null : Number(slide.branchId),
      autoplayMs: Number(slide.autoplayMs) || 0,
    }));
}

function categoryHasCover(c) {
  const cover = String(c?.coverImg || '').trim();
  return Boolean(cover) && !isDrinkTexturePath(cover);
}

/** Active site categories: not hidden and have a real food coverImg (items optional). */
function activeMenuCategories(data) {
  return (data.menuCategories || []).filter(
    (c) => c && !c.hiddenOnSite && categoryHasCover(c)
  );
}

function bumpMenuRevision(data) {
  data.menuRevision = Date.now();
  return data.menuRevision;
}

/** Derive carousel `products` from menu categories (single source of truth). */
function buildProductsFromMenu(data) {
  return activeMenuCategories(data).map((c, i) => {
    const title = String(c.title || '').trim();
    return {
      id: i + 1,
      menuCategoryId: c.id,
      name1: title,
      name2: '',
      title,
      shortDesc: String(c.shortDesc || '').trim(),
      longDesc: String(c.longDesc || '').trim(),
      coverImg: String(c.coverImg || '').trim(),
    };
  });
}

// ---- storage ----------------------------------------------------------
function loadDb() {
  if (!fs.existsSync(DB_PATH)) {
    const seed = require('./seed');
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    fs.writeFileSync(DB_PATH, JSON.stringify(seed, null, 2));
  }
  let data;
  try {
    data = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  } catch (err) {
    console.error(`[DB_CORRUPTION_DETECTED] Failed to parse ${DB_PATH}:`, err.message);
    const backupPath = `${DB_PATH}.corrupted.${Date.now()}`;
    try { fs.copyFileSync(DB_PATH, backupPath); } catch (_) {}
    const seed = require('./seed');
    data = JSON.parse(JSON.stringify(seed));
    try { fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2)); } catch (_) {}
  }
  return migrateDb(data);
}

// Runs for both the local JSON snapshot and a PostgreSQL snapshot. Keeping
// the migration idempotent gives staged rollouts a safe route forward and a
// local JSON rollback path without data loss.
function migrateDb(data) {
  // Migrate older db.json files that predate menu/orders.
  const seed = require('./seed');
  if (!data.settings || typeof data.settings !== 'object') {
    data.settings = seed.settings || {};
  }
  if (!Array.isArray(data.settings.adminPhones)) {
    data.settings.adminPhones = ['09374333028'];
  } else if (!data.settings.adminPhones.includes('09374333028')) {
    data.settings.adminPhones.unshift('09374333028');
  }
  const superAdmin = (data.users || []).find((u) => u.phone === '09374333028');
  if (superAdmin) {
    superAdmin.role = 'owner';
    if (!superAdmin.name) superAdmin.name = 'ساسان راد';
  }
  if (!Array.isArray(data.menuItems)) data.menuItems = seed.menuItems;
  if (!Array.isArray(data.orders)) data.orders = [];
  // Migrate to the full Jan Majnoon-based menu (categories + items).
  if (!Array.isArray(data.menuCategories)) {
    data.menuCategories = seed.menuCategories;
    data.menuItems = seed.menuItems;
  }
  if (!Array.isArray(data.menuComplements)) {
    data.menuComplements = seed.menuComplements || [];
    data.menuComplementsV1Pending = true;
  }
  if (!Array.isArray(data.menuComplementRules)) {
    data.menuComplementRules = seed.menuComplementRules || [];
    data.menuComplementsV1Pending = true;
  }
  // Migrate carousel slides to menu-category names (one can per category).
  if (!data.productsV2) {
    data.products = seed.products;
    data.productsV2 = true;
  }
  // Migrate to one carousel slot per non-empty category (12 slots).
  if (!data.productsV3) {
    data.products = seed.products;
    data.productsV3 = true;
  }
  // Cafe ops layer (restaurant info, hours, tables, analytics, promos)
  if (!data.restaurant) data.restaurant = seed.restaurant;
  if (!data.hours) data.hours = seed.hours;
  if (!Array.isArray(data.tables)) data.tables = seed.tables;
  if (!Array.isArray(data.promotions)) data.promotions = seed.promotions || [];
  if (!Array.isArray(data.promoSlides)) data.promoSlides = [];
  if (!Array.isArray(data.visits)) data.visits = [];
  if (!data.visitSessions || typeof data.visitSessions !== 'object') data.visitSessions = {};
  if (!Array.isArray(data.waiterCalls)) data.waiterCalls = [];
  if (!Array.isArray(data.floorZones)) data.floorZones = [];
  if (!Array.isArray(data.floorFixtures)) data.floorFixtures = [];
  if (!Array.isArray(data.floors)) data.floors = [];
  if (!Array.isArray(data.floorSettingsList)) data.floorSettingsList = [];
  if (!Array.isArray(data.users)) data.users = [];
  if (!Array.isArray(data.staffShifts)) data.staffShifts = [];
  if (!Array.isArray(data.cashSessions)) data.cashSessions = [];
  if (!Array.isArray(data.newsletter)) data.newsletter = [];
  if (!Array.isArray(data.feedback)) data.feedback = [];
  if (!Array.isArray(data.walletTopupRequests)) data.walletTopupRequests = [];
  if (!Array.isArray(data.loyaltyLedger)) data.loyaltyLedger = [];
  if (!Array.isArray(data.walletLedger)) data.walletLedger = [];
  if (process.env.NODE_ENV !== 'production') {
    const operationalUsers = [
      { phone: '09120000101', name: 'صندوق‌دار وستو', role: 'cashier' },
      { phone: '09120000102', name: 'گارسون وستو', role: 'waiter' },
      { phone: '09120000103', name: 'آشپز وستو', role: 'kitchen' },
    ];
    for (const profile of operationalUsers) {
      if (data.users.some((user) => user.phone === profile.phone)) continue;
      data.users.push({
        ...profile,
        email: '',
        points: 0,
        createdAt: new Date().toISOString(),
        blocked: false,
        operationalDemo: true,
      });
    }
  }
  // Allergen + daypart fields on menu items
  for (const m of data.menuItems || []) {
    if (!Array.isArray(m.allergens)) m.allergens = [];
    if (!Array.isArray(m.dayparts) || !m.dayparts.length) m.dayparts = ['all'];
    if (m.stock === undefined) m.stock = null; // null = نامحدود
    if (typeof m.lowStockAt !== 'number') m.lowStockAt = 5;
    if (typeof m.en !== 'string') m.en = '';
    if (typeof m.descEn !== 'string') m.descEn = '';
    if (typeof m.ar !== 'string') m.ar = '';
    if (typeof m.descAr !== 'string') m.descAr = '';
    if (m.modifierGroups !== undefined && !Array.isArray(m.modifierGroups)) delete m.modifierGroups;
  }
  for (const complement of data.menuComplements || []) {
    complement.name = String(complement.name || '').trim().slice(0, 120);
    complement.price = Math.max(0, Math.round(Number(complement.price) || 0));
    complement.available = complement.available !== false;
    complement.stock = complement.stock == null || complement.stock === '' ? null : Math.max(0, Math.round(Number(complement.stock) || 0));
    complement.lowStockAt = Math.max(0, Math.round(Number(complement.lowStockAt) || 5));
    complement.img = sanitizeMenuImg(complement.img) || '';
  }
  for (const rule of data.menuComplementRules || []) {
    rule.name = String(rule.name || '').trim().slice(0, 120);
    rule.prompt = String(rule.prompt || '').trim().slice(0, 180);
    rule.sourceCategoryIds = [...new Set((Array.isArray(rule.sourceCategoryIds) ? rule.sourceCategoryIds : []).map(Number).filter(Number.isFinite))];
    rule.sourceItemIds = [...new Set((Array.isArray(rule.sourceItemIds) ? rule.sourceItemIds : []).map(Number).filter(Number.isFinite))];
    rule.complementIds = [...new Set((Array.isArray(rule.complementIds) ? rule.complementIds : []).map(Number).filter(Number.isFinite))];
    rule.active = rule.active !== false;
  }
  if (!data.i18n || typeof data.i18n !== 'object') {
    data.i18n = {
      guestLangEnabled: true,
      defaultLang: 'fa',
      supported: ['fa', 'en', 'ar'],
    };
  } else {
    if (!Array.isArray(data.i18n.supported) || !data.i18n.supported.includes('ar')) {
      data.i18n.supported = ['fa', 'en', 'ar'];
    }
    if (!['fa', 'en', 'ar'].includes(data.i18n.defaultLang)) data.i18n.defaultLang = 'fa';
  }
  if (!data.loyalty || typeof data.loyalty !== 'object') {
    data.loyalty = {
      enabled: true,
      pointsPerToman: 0.01,
      redeemValue: 1000,
      welcomePoints: 50,
    };
  }
  if (!Array.isArray(data.loyaltyLedger)) data.loyaltyLedger = [];
  if (!data.neemIntegration || typeof data.neemIntegration !== 'object') {
    data.neemIntegration = {
      enabled: true,
      endpoint: '',
      outbox: [],
      lastError: '',
      tenantId: TENANT_CONFIG.tenantId,
      schemaVersion: 1,
      mode: 'outbox',
    };
  }
  if (!Array.isArray(data.neemIntegration.outbox)) data.neemIntegration.outbox = [];
  data.neemIntegration.tenantId = TENANT_CONFIG.tenantId;
  data.neemIntegration.schemaVersion = 1;
  data.neemIntegration.mode = 'outbox';
  data.tenantIdentity = {
    tenantId: TENANT_CONFIG.tenantId,
    tenantSlug: TENANT_CONFIG.tenantSlug,
    canonicalDomain: TENANT_CONFIG.canonicalDomain,
    cellId: TENANT_CONFIG.cellId,
    storageMode: 'database-per-tenant',
  };
  for (const u of data.users || []) {
    if (typeof u.points !== 'number') u.points = 0;
  }
  if (!data.theme || typeof data.theme !== 'object') {
    data.theme = {
      accent: '#78d0d8',
      accentInk: '#0a1a1c',
      surface: '#111318',
      bg: '#08090b',
      fog: '#ece8e2',
      printPaper: '#f7f3ec',
      printInk: '#1a1714',
      printAccent: '#2a7a86',
      radius: 14,
      fontDisplay: 'Vazirmatn',
    };
  }
  // Multi-branch: migrate single venue into branches[]
  if (!Array.isArray(data.branches) || !data.branches.length) {
    const r = data.restaurant || seed.restaurant || {};
    data.branches = [
      {
        id: 1,
        slug: 'main',
        name: 'شعبه اصلی',
        address: r.address || '',
        phone: r.phone || '',
        whatsapp: r.whatsapp || '',
        active: true,
        hours: JSON.parse(JSON.stringify(data.hours || seed.hours)),
      },
    ];
  }
  const primaryBranchId = data.branches[0].id;
  for (const b of data.branches) {
    if (!b.hours || typeof b.hours !== 'object') {
      b.hours = JSON.parse(JSON.stringify(data.hours || seed.hours));
    }
    if (typeof b.active !== 'boolean') b.active = true;
    if (!b.slug) b.slug = `branch-${b.id}`;
  }
  for (const t of data.tables || []) {
    if (t.branchId == null) t.branchId = primaryBranchId;
  }
  for (const o of data.orders || []) {
    if (o.branchId == null) o.branchId = primaryBranchId;
  }
  for (const c of data.waiterCalls || []) {
    if (c.branchId == null) c.branchId = primaryBranchId;
  }
  // Keep legacy hours mirror of first active branch
  const mirror = data.branches.find((b) => b.active !== false) || data.branches[0];
  if (mirror?.hours) data.hours = mirror.hours;
  ensurePrintingData(data, primaryBranchId);
  if (!data.reservationSettings || typeof data.reservationSettings !== 'object') {
    data.reservationSettings = {
      enabled: true,
      slotMinutes: 30,
      maxParty: 12,
      maxCoversPerSlot: 24,
      advanceDays: 21,
      minHoursAhead: 1,
    };
  }
  if (!Array.isArray(data.reservations)) data.reservations = [];
  for (const r of data.reservations) {
    if (r.branchId == null) r.branchId = primaryBranchId;
    if (!r.status) r.status = 'pending';
  }
  if (!data.whatsappNotify || typeof data.whatsappNotify !== 'object') {
    data.whatsappNotify = {
      enabled: true,
      onOrder: true,
      onReservation: true,
      phone: data.restaurant?.whatsapp || data.restaurant?.phone || '',
    };
  }
  if (!Array.isArray(data.whatsappLog)) data.whatsappLog = [];
  if (!data.feedbackSettings || typeof data.feedbackSettings !== 'object') {
    data.feedbackSettings = {
      enabled: true,
      askAfterOrder: true,
      title: 'نظر شما برای ما مهم است',
      subtitle: 'از ۰ تا ۱۰، چقدر ما را به دوستان‌تان پیشنهاد می‌کنید؟',
      thankYou: 'ممنون از بازخوردتان',
    };
  }
  if (!Array.isArray(data.feedback)) data.feedback = [];

  // Command-center data is additive so the legacy JSON snapshot can still be
  // opened by previous releases during the staged PostgreSQL rollout.
  if (!Array.isArray(data.deliveryZones)) data.deliveryZones = seed.deliveryZones || [];
  if (!Array.isArray(data.paymentAttempts)) data.paymentAttempts = [];
  if (!data.checkoutIdempotency || typeof data.checkoutIdempotency !== 'object') data.checkoutIdempotency = {};
  if (!Array.isArray(data.auditLog)) data.auditLog = [];
  if (!data.commandCenter || typeof data.commandCenter !== 'object') {
    data.commandCenter = { schemaVersion: 1, eventRevision: 0 };
  }
  for (const user of data.users || []) {
    // Never rewrite the legacy role on disk here: normalizeRole preserves a
    // reversible compatibility path while all new API responses are RBAC-safe.
    if (!user.role) user.role = 'user';
  }
  for (const order of data.orders || []) {
    order.fulfillment = normalizeFulfillment(order.fulfillment, { tableNo: order.tableNo });
    order.paymentStatus = paymentStatusFor(order);
    if (!Array.isArray(order.statusHistory)) {
      order.statusHistory = [{
        status: order.status || initialOrderStatus(order),
        at: order.createdAt || new Date().toISOString(),
        by: null,
      }];
    }
  }

  // Normalize menu category marketing / site-visibility fields
  if (!Array.isArray(data.menuCategories)) data.menuCategories = [];
  for (const c of data.menuCategories) {
    if (typeof c.name1 !== 'string') c.name1 = '';
    if (typeof c.name2 !== 'string') c.name2 = '';
    if (typeof c.shortDesc !== 'string') c.shortDesc = '';
    if (typeof c.longDesc !== 'string') c.longDesc = '';
    if (typeof c.hiddenOnSite !== 'boolean') c.hiddenOnSite = false;
    if (typeof c.coverImg !== 'string') c.coverImg = '';
  }
  if (typeof data.menuRevision !== 'number') data.menuRevision = Date.now();

  // coverImgV1: scrub drink-label textures, backfill covers from first dish,
  // and set a real matcha hero cover (replaces Giro kiwi placeholder).
  if (!data.coverImgV1) {
    const MATCHA_ID = 14477;
    const MATCHA_COVER = 'assets/menu/matcha-cover.webp';
    for (const m of data.menuItems || []) {
      if (m && isDrinkTexturePath(m.img)) m.img = '';
    }
    const firstImgByCat = Object.create(null);
    for (const m of data.menuItems || []) {
      if (!m || m.available === false) continue;
      const img = String(m.img || '').trim();
      if (!img || isDrinkTexturePath(img)) continue;
      const id = Number(m.categoryId);
      if (!firstImgByCat[id]) firstImgByCat[id] = img;
    }
    for (const c of data.menuCategories || []) {
      if (isDrinkTexturePath(c.coverImg)) c.coverImg = '';
      if (!String(c.coverImg || '').trim() && firstImgByCat[Number(c.id)]) {
        c.coverImg = firstImgByCat[Number(c.id)];
      }
    }
    const matcha = (data.menuCategories || []).find((c) => Number(c.id) === MATCHA_ID);
    if (matcha) matcha.coverImg = MATCHA_COVER;
    data.menuRevision = Date.now();
    data.coverImgV1 = true;
  }

  // coverTitleV1: hero/classic display uses category.title only (drop drink-era name1+name2).
  if (!data.coverTitleV1) {
    const MATCHA_ID = 14477;
    for (const c of data.menuCategories || []) {
      const title = String(c.title || '').trim();
      c.title = title || String(c.name1 || '').trim() || 'بدون عنوان';
      c.name1 = c.title;
      c.name2 = '';
    }
    const matcha = (data.menuCategories || []).find((c) => Number(c.id) === MATCHA_ID);
    if (matcha) {
      matcha.title = 'ماچا بار';
      matcha.name1 = 'ماچا بار';
      matcha.name2 = '';
    }
    data.menuRevision = Date.now();
    data.coverTitleV1 = true;
  }

  // coverSanitizeV2: strip known non-food uploads (nail polymer / snails serum)
  // that were saved as category covers and broke the hero pairing.
  if (!data.coverSanitizeV2) {
    const BAD = new Set([
      'uploads/1784888458855-1a83e8ef-baa0-456e-8ff0-ed150e3b1ea5.png',
      'uploads/1784886930511-0e38d0f3-7450-4138-a4ef-154e1a3965e2.png',
    ]);
    for (const c of data.menuCategories || []) {
      const cover = String(c.coverImg || '').trim();
      if (!BAD.has(cover)) continue;
      const dishImg = (data.menuItems || []).find(
        (m) => m && m.categoryId === c.id && String(m.img || '').trim() && !BAD.has(String(m.img || '').trim()),
      );
      if (dishImg?.img) {
        c.coverImg = String(dishImg.img).trim();
      } else {
        c.coverImg = '';
        c.hiddenOnSite = true;
      }
    }
    data.products = buildProductsFromMenu(data);
    data.menuRevision = Date.now();
    data.coverSanitizeV2 = true;
  }

  // coverStabilityV1: drop leftover cosmetic covers; empty cats without a real
  // cover stay off the guest carousel; empty-with-cover stay empty-only.
  if (!data.coverStabilityV1) {
    const BAD_COVER = new Set([
      'uploads/1784888458855-1a83e8ef-baa0-456e-8ff0-ed150e3b1ea5.png',
      'uploads/1784886930511-0e38d0f3-7450-4138-a4ef-154e1a3965e2.png',
      // Extra cosmetic / non-food uploads seen during cover churn
      'uploads/1784888458855-1a83e8ef-baa0-456e-8ff0-ed150e3b1ea5.webp',
      'uploads/1784886930511-0e38d0f3-7450-4138-a4ef-154e1a3965e2.webp',
    ]);
    const looksCosmeticUpload = (cover) => {
      const c = String(cover || '').trim().toLowerCase();
      if (!c) return false;
      if (BAD_COVER.has(c)) return true;
      // Heuristic: admin-era nail/serum filenames sometimes embed brand tokens
      return /nuxe|snails|serum|nail|polymer|manicure|cuticle/i.test(c);
    };
    for (const c of data.menuCategories || []) {
      if (!c) continue;
      let cover = String(c.coverImg || '').trim();
      if (isDrinkTexturePath(cover) || looksCosmeticUpload(cover)) {
        cover = '';
        c.coverImg = '';
      }
      const hasAvail = (data.menuItems || []).some(
        (m) => m && Number(m.categoryId) === Number(c.id) && m.available !== false,
      );
      // No cover → not on guest carousel (activeMenuCategories). Hide empty husks
      // that also have no available dishes so admin lists stay clean.
      if (!categoryHasCover(c) && !hasAvail) {
        c.hiddenOnSite = true;
        c.coverImg = '';
      }
    }
    data.products = buildProductsFromMenu(data);
    data.menuRevision = Date.now();
    data.coverStabilityV1 = true;
  }

  // coverMissingV1: replace deleted upload covers (matcha / caffeine) with
  // dedicated assets so catbar thumbs never point at missing files.
  if (!data.coverMissingV1) {
    const MATCHA_ID = 14477;
    const CAFFEINE_ID = 7675;
    const MATCHA_COVER = 'assets/menu/matcha-cover.webp';
    const CAFFEINE_COVER = 'assets/menu/caffeine-cover.webp';
    const MISSING_UPLOAD_MAP = {
      'uploads/1784892283596-matchafinal.webp': MATCHA_COVER,
      'uploads/1784892333322-matcha.webp': MATCHA_COVER,
      'uploads/1784888699038-0bf3e359-9e85-463d-a070-4d4bd6985a22.png': CAFFEINE_COVER,
    };
    const mediaExists = (rel) => {
      const s = String(rel || '').trim();
      if (!s) return false;
      if (/^https?:\/\//i.test(s)) return true;
      try {
        return fs.existsSync(path.join(ROOT, s));
      } catch (_) {
        return false;
      }
    };
    for (const c of data.menuCategories || []) {
      if (!c) continue;
      const id = Number(c.id);
      let cover = String(c.coverImg || '').trim();
      if (MISSING_UPLOAD_MAP[cover]) cover = MISSING_UPLOAD_MAP[cover];
      if (id === MATCHA_ID) cover = MATCHA_COVER;
      else if (id === CAFFEINE_ID) cover = CAFFEINE_COVER;
      else if (cover && !mediaExists(cover)) {
        const dish = (data.menuItems || []).find(
          (m) =>
            m &&
            Number(m.categoryId) === id &&
            mediaExists(String(m.img || '').trim()) &&
            !isDrinkTexturePath(m.img),
        );
        cover = dish ? String(dish.img).trim() : '';
      }
      c.coverImg = cover;
    }
    for (const m of data.menuItems || []) {
      if (!m) continue;
      const img = String(m.img || '').trim();
      if (MISSING_UPLOAD_MAP[img]) m.img = MISSING_UPLOAD_MAP[img];
      else if (img && !mediaExists(img) && Number(m.categoryId) === MATCHA_ID) {
        m.img = MATCHA_COVER;
      } else if (img && !mediaExists(img) && Number(m.categoryId) === CAFFEINE_ID) {
        m.img = CAFFEINE_COVER;
      }
    }
    data.products = buildProductsFromMenu(data);
    data.menuRevision = Date.now();
    data.coverMissingV1 = true;
  }

  // productsV4: copy marketing text from legacy products onto matching menuCategories,
  // then rebuild products as a derived mirror of non-empty visible categories.
  if (!data.productsV4) {
    const normalizeTitle = (s) =>
      String(s || '')
        .replace(/\s+/g, ' ')
        .trim();
    const productByTitle = Object.create(null);
    for (const p of data.products || []) {
      const full = normalizeTitle(`${p.name1 || ''} ${p.name2 || ''}`);
      const n1 = normalizeTitle(p.name1);
      if (full) productByTitle[full] = p;
      if (n1) productByTitle[n1] = p;
    }
    for (const c of data.menuCategories) {
      const match = productByTitle[normalizeTitle(c.title)];
      if (!match) continue;
      if (!c.name1 && match.name1) c.name1 = match.name1;
      if (!c.name2 && match.name2) c.name2 = match.name2;
      if (!c.shortDesc && match.shortDesc) c.shortDesc = match.shortDesc;
      if (!c.longDesc && match.longDesc) c.longDesc = match.longDesc;
    }
    data.products = buildProductsFromMenu(data);
    data.productsV4 = true;
  }

  // Accounting subsystem schema and data structures
  accountingEngine.ensureAccountingData(data);

  return data;
}
const defaultDb = loadDb();
const tenantRegistry = new TenantRegistry(defaultDb, DB_PATH);
const tenantStorage = new AsyncLocalStorage();

const db = new Proxy(defaultDb, {
  get(target, prop, receiver) {
    const store = tenantStorage.getStore();
    const current = (store && store.db) ? store.db : target;
    return Reflect.get(current, prop, receiver);
  },
  set(target, prop, value, receiver) {
    const store = tenantStorage.getStore();
    const current = (store && store.db) ? store.db : target;
    return Reflect.set(current, prop, value, receiver);
  },
  has(target, prop) {
    const store = tenantStorage.getStore();
    const current = (store && store.db) ? store.db : target;
    return Reflect.has(current, prop);
  },
  ownKeys(target) {
    const store = tenantStorage.getStore();
    const current = (store && store.db) ? store.db : target;
    return Reflect.ownKeys(current);
  },
  getOwnPropertyDescriptor(target, prop) {
    const store = tenantStorage.getStore();
    const current = (store && store.db) ? store.db : target;
    return Reflect.getOwnPropertyDescriptor(current, prop);
  }
});

const stateStore = createPostgresStateStore({
  logger: console,
  tenantConfig: TENANT_CONFIG,
  requireTenantMetadata: TENANT_CONFIG.requireMetadata,
  required: process.env.WESTO_POSTGRES_REQUIRED === 'true'
    || TENANT_CONFIG.multiTenant
    || TENANT_CONFIG.requireMetadata,
});
const eventHub = createEventHub();
let saveTimer = null;
let saveWaiters = [];

function rebuildProductsFromMenu() {
  const store = tenantStorage.getStore();
  const currentDb = (store && store.db) ? store.db : defaultDb;
  currentDb.products = buildProductsFromMenu(currentDb);
}

function shouldWriteJsonState() {
  // Multi-tenant production cells must not silently keep JSON as a second
  // writable authority. JSON remains useful for local recovery and shadow
  // migrations, but the cutover flag makes PostgreSQL the only authority.
  if (TENANT_CONFIG.multiTenant && process.env.NODE_ENV === 'production') return false;
  // Importing the legacy Express app is common in unit/HTTP tests. Never let
  // those tests rewrite the operator's checkout database; an integration test
  // that intentionally points WESTO_DB_PATH at a disposable file must opt in.
  if (IS_NODE_TEST_RUNTIME) {
    return process.env.WESTO_ALLOW_TEST_DB_WRITE === 'true'
      && path.resolve(DB_PATH) !== path.resolve(DEFAULT_JSON_DB_PATH);
  }
  return !stateStore.enabled || process.env.WESTO_JSON_RECOVERY_SNAPSHOT === 'true';
}

function save(opts = {}) {
  const store = tenantStorage.getStore();
  const currentDb = (store && store.db) ? store.db : defaultDb;
  const currentTenantId = (store && store.tenantId) ? store.tenantId : 'westo';

  if (opts.rebuildProducts) rebuildProductsFromMenu();
  if (opts.rebuildProducts || opts.bumpMenu) bumpMenuRevision(currentDb);

  if (currentTenantId !== 'westo') {
    tenantRegistry.saveTenantDb(currentTenantId);
    return Promise.resolve(true);
  }

  const waiter = new Promise((resolve, reject) => {
    saveWaiters.push({ resolve, reject, requireDurable: opts.requireDurable === true });
  });
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    saveTimer = null;
    const batch = saveWaiters;
    saveWaiters = [];
    let persistenceError = null;
    if (shouldWriteJsonState()) {
      try {
        const encoded = JSON.stringify(db, null, 2);
        const tmpPath = `${DB_PATH}.${process.pid}.tmp`;
        fs.writeFileSync(tmpPath, encoded, { mode: 0o600 });
        fs.renameSync(tmpPath, DB_PATH);
      } catch (error) {
        persistenceError = error;
        console.error('[storage] unable to write JSON snapshot', error.message);
      }
    }
    if (stateStore.enabled) {
      try {
        await stateStore.write(db);
      } catch (error) {
        persistenceError = error;
        console.error('[postgres] unable to persist state', error.message);
      }
    }
    for (const pending of batch) {
      if (persistenceError && pending.requireDurable) pending.reject(Object.assign(persistenceError, { code: persistenceError.code || 'finance_persistence_failed', status: persistenceError.status || 503 }));
      else pending.resolve(!persistenceError);
    }
  }, 50);
  return waiter;
}

// Critical operational routes update the order/cash snapshot and Finance V2
// together. Keep a bounded rollback image so a failed durable write or a
// finance invariant cannot leave an in-memory paid order without its ledger.
const FINANCE_MUTATION_STATE_KEYS = Object.freeze([
  'financeV2', 'accounting', 'orders', 'cashSessions', 'paymentAttempts', 'auditLog',
  'users', 'walletLedger', 'walletTopupRequests', 'loyaltyLedger', 'referrals', 'campaignLog', 'smsLog', 'menuItems', 'menuComplements', 'checkoutIdempotency',
]);

function snapshotFinanceMutationState() {
  return Object.fromEntries(FINANCE_MUTATION_STATE_KEYS.map((key) => [
    key,
    Object.prototype.hasOwnProperty.call(db, key) && db[key] !== undefined
      ? JSON.parse(JSON.stringify(db[key]))
      : undefined,
  ]));
}

function restoreFinanceMutationState(snapshot) {
  for (const [key, before] of Object.entries(snapshot || {})) {
    if (before === undefined) delete db[key];
    else db[key] = before;
  }
}

async function persistFinanceMutation(snapshot) {
  try {
    await save({ requireDurable: true });
  } catch (error) {
    restoreFinanceMutationState(snapshot);
    throw error;
  }
}

if (db.menuComplementsV1Pending) {
  delete db.menuComplementsV1Pending;
  save({ bumpMenu: true });
}
const neemBridge = createNeemBridge({
  getDb: () => db,
  persist: () => save(),
  logger: console,
  tenantConfig: TENANT_CONFIG,
});
// Keep derived products in sync with current menu
rebuildProductsFromMenu();
if (!stateStore.enabled) save(); // persist migrations if any

// ---- session (HMAC-signed cookie) -------------------------------------
if (!fs.existsSync(SECRET_PATH)) {
  fs.mkdirSync(path.dirname(SECRET_PATH), { recursive: true });
  fs.writeFileSync(SECRET_PATH, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
}
try { fs.chmodSync(SECRET_PATH, 0o600); } catch (_) {}
const SECRET = fs.readFileSync(SECRET_PATH, 'utf8').trim();
const SESSION_TTL_MS = Math.max(60 * 60 * 1000, Number(process.env.WESTO_SESSION_TTL_MS) || 30 * 24 * 60 * 60 * 1000);

const ALLERGENS = [
  { id: 'gluten', label: 'گلوتن', labelEn: 'Gluten', labelAr: 'غلوتين' },
  { id: 'dairy', label: 'لبنیات', labelEn: 'Dairy', labelAr: 'ألبان' },
  { id: 'egg', label: 'تخم‌مرغ', labelEn: 'Egg', labelAr: 'بيض' },
  { id: 'nuts', label: 'آجیل درختی', labelEn: 'Tree nuts', labelAr: 'مكسرات' },
  { id: 'peanut', label: 'بادام‌زمینی', labelEn: 'Peanut', labelAr: 'فول سوداني' },
  { id: 'soy', label: 'سویا', labelEn: 'Soy', labelAr: 'صويا' },
  { id: 'seafood', label: 'دریایی / صدف', labelEn: 'Seafood / shellfish', labelAr: 'مأكولات بحرية' },
  { id: 'sesame', label: 'کنجد', labelEn: 'Sesame', labelAr: 'سمسم' },
  { id: 'mustard', label: 'خردل', labelEn: 'Mustard', labelAr: 'خردل' },
];

const DAYPARTS = [
  { id: 'all', label: 'همیشه', hours: null },
  { id: 'breakfast', label: 'صبحانه', hours: [6, 11] },
  { id: 'lunch', label: 'ناهار', hours: [11, 16] },
  { id: 'dinner', label: 'شام', hours: [16, 23] },
  { id: 'late', label: 'دیروقت', hours: [23, 6] },
];

function defaultHoursTemplate() {
  return JSON.parse(
    JSON.stringify({
      sat: { open: '10:00', close: '23:30', closed: false },
      sun: { open: '10:00', close: '23:30', closed: false },
      mon: { open: '10:00', close: '23:30', closed: false },
      tue: { open: '10:00', close: '23:30', closed: false },
      wed: { open: '10:00', close: '23:30', closed: false },
      thu: { open: '10:00', close: '00:30', closed: false },
      fri: { open: '10:00', close: '00:30', closed: false },
    })
  );
}

function defaultBranch() {
  return (db.branches || []).find((b) => b.active !== false) || (db.branches || [])[0] || null;
}

function resolveBranch(q) {
  if (q == null || q === '') return defaultBranch();
  const cleanQ = normalizeDigits(String(q)).trim();
  const id = Number(cleanQ);
  if (Number.isFinite(id) && id > 0) {
    return (db.branches || []).find((b) => Number(b.id) === id) || defaultBranch();
  }
  const slug = cleanQ.toLowerCase();
  return (db.branches || []).find((b) => String(b.slug || '').toLowerCase() === slug) || defaultBranch();
}

function requestBranchValue(req) {
  const values = [req.query?.branchId, req.query?.branch, req.body?.branchId, req.body?.branch];
  return values.find((value) => value !== undefined && value !== null && String(value).trim() !== '') ?? null;
}

function resolveBranchExact(value) {
  if (value == null || String(value).trim() === '') return defaultBranch();
  const cleanVal = normalizeDigits(String(value)).trim();
  const id = Number(cleanVal);
  if (Number.isFinite(id) && id > 0) return (db.branches || []).find((branch) => Number(branch.id) === id) || null;
  const slug = cleanVal.toLowerCase();
  return (db.branches || []).find((branch) => String(branch.slug || '').trim().toLowerCase() === slug) || null;
}

function branchScopeError(code, status, message) {
  return Object.assign(new Error(message), { code, status });
}

function assertRequestBranchAccess(req) {
  const allowedBranchIds = branchScopeForUser(req.user, { role: effectiveRole(req.user) });
  if (allowedBranchIds !== null && !allowedBranchIds.length) {
    throw branchScopeError('branch_scope_empty', 403, 'برای این کاربر هیچ شعبهٔ مجازی مجاز تعریف نشده است.');
  }
  const raw = requestBranchValue(req);
  if (raw == null) return;
  const branch = resolveBranchExact(raw);
  if (!branch) throw branchScopeError('branch_invalid', 400, 'شعبهٔ انتخاب‌شده معتبر نیست.');
  if (allowedBranchIds !== null && !allowedBranchIds.includes(Number(branch.id))) {
    throw branchScopeError('branch_access_denied', 403, 'دسترسی به شعبهٔ انتخاب‌شده مجاز نیست.');
  }
}

function parseBranchId(req) {
  const raw = requestBranchValue(req);
  const allowedBranchIds = branchScopeForUser(req.user, { role: effectiveRole(req.user) });
  if (raw == null) {
    if (allowedBranchIds !== null) {
      if (!allowedBranchIds.length) return null;
      const preferred = defaultBranch();
      return preferred && allowedBranchIds.includes(Number(preferred.id)) ? preferred.id : allowedBranchIds[0];
    }
    const preferred = defaultBranch();
    return preferred ? preferred.id : null;
  }
  const branch = resolveBranchExact(raw);
  if (!branch) throw branchScopeError('branch_invalid', 400, 'شعبهٔ انتخاب‌شده معتبر نیست.');
  if (allowedBranchIds !== null && !allowedBranchIds.includes(Number(branch.id))) {
    throw branchScopeError('branch_access_denied', 403, 'دسترسی به شعبهٔ انتخاب‌شده مجاز نیست.');
  }
  return branch.id;
}

function syncLegacyHours() {
  const b = defaultBranch();
  if (b?.hours) db.hours = b.hours;
}

function currentDaypartIds(date = new Date()) {
  const h = date.getHours();
  const active = [];
  for (const d of DAYPARTS) {
    if (!d.hours) continue;
    const [a, b] = d.hours;
    if (a < b) {
      if (h >= a && h < b) active.push(d.id);
    } else if (h >= a || h < b) active.push(d.id);
  }
  return active;
}

function itemVisibleNow(item) {
  const parts = Array.isArray(item.dayparts) && item.dayparts.length ? item.dayparts : ['all'];
  if (parts.includes('all')) return true;
  const now = currentDaypartIds();
  return parts.some((p) => now.includes(p));
}

function normalizeAllergens(list) {
  if (!Array.isArray(list)) return [];
  const allowed = new Set(ALLERGENS.map((a) => a.id));
  return [...new Set(list.map(String).filter((id) => allowed.has(id)))];
}

function normalizeDayparts(list) {
  if (!Array.isArray(list) || !list.length) return ['all'];
  const allowed = new Set(DAYPARTS.map((d) => d.id));
  const next = [...new Set(list.map(String).filter((id) => allowed.has(id)))];
  return next.length ? next : ['all'];
}

function sign(value) {
  return crypto.createHmac('sha256', SECRET).update(value).digest('base64url');
}
function makeToken(phone) {
  const payload = Buffer.from(JSON.stringify({ phone, ts: Date.now() })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}
function parseToken(token) {
  if (!token || typeof token !== 'string') return null;
  const dotIndex = token.indexOf('.');
  if (dotIndex === -1) return null;
  const payload = token.slice(0, dotIndex);
  const sig = token.slice(dotIndex + 1);
  if (!payload || !sig) return null;
  try {
    const expectedSig = sign(payload);
    const expectedBuf = Buffer.from(expectedSig);
    const actualBuf = Buffer.from(sig);
    if (expectedBuf.length !== actualBuf.length || !crypto.timingSafeEqual(expectedBuf, actualBuf)) return null;
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}
function getCookie(req, name) {
  if (!req || !req.headers || !req.headers.cookie || !name) return null;
  const rawCookie = String(req.headers.cookie);
  const parts = rawCookie.split(';');
  for (let i = 0; i < parts.length; i++) {
    const item = parts[i].trim();
    const eq = item.indexOf('=');
    if (eq > 0 && item.slice(0, eq).trim() === name) {
      const rawVal = item.slice(eq + 1).trim();
      try {
        return decodeURIComponent(rawVal);
      } catch {
        return rawVal;
      }
    }
  }
  return null;
}

function getSessionToken(req) {
  if (!req || !req.headers) return null;
  const auth = req.headers.authorization;
  if (auth && typeof auth === 'string') {
    const match = auth.match(/^Bearer\s+(.+)$/i);
    if (match && match[1]) return match[1].trim();
  }
  const xToken = req.headers['x-session-token'];
  if (xToken && typeof xToken === 'string' && xToken.trim()) {
    return xToken.trim();
  }
  return getCookie(req, 'westo_session');
}

function currentUser(req) {
  const token = getSessionToken(req);
  const data = parseToken(token);
  if (!data || !Number.isFinite(Number(data.ts)) || Date.now() - Number(data.ts) > SESSION_TTL_MS) return null;
  const user = db.users.find((u) => u.phone === data.phone);
  if (!user || user.blocked) return null;
  return user;
}
function effectiveRole(user) {
  return normalizeRole(user?.role, db.settings?.adminPhones || [], user?.phone || '');
}
function userCan(user, capability) {
  return !!user && hasCapability(user, capability, db.settings || {});
}
function requireAuth(req, res, next) {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: 'unauthorized' });
  req.user = user;
  next();
}
function requireCapability(capability) {
  return (req, res, next) => {
    const user = currentUser(req);
    const declared = Array.isArray(capability) ? capability : [capability];
    const routeCapability = declared.length === 1 && declared[0] === 'admin.access'
      ? lookupCapability(req.method, req.path)
      : null;
    const required = routeCapability ? [routeCapability] : declared;
    const allowed = required.some((cap) => userCan(user, cap));
    if (!allowed) {
      if (!user) return res.status(401).json({ error: 'unauthorized' });
      return res.status(403).json({ error: 'forbidden', capability });
    }
    req.user = user;
    try {
      assertRequestBranchAccess(req);
    } catch (error) {
      return res.status(error.status || 400).json({ error: error.code || 'branch_access_denied', message: error.message, requestId: req.requestId });
    }

    // Preserve the legacy guard's OR semantics while applying the shared
    // Control Plane policy after WESTO has resolved its authenticated user.
    // The global route-aware layer may already have evaluated the same single
    // capability; skip only that exact duplicate decision.
    if (required.length === 1 && req.neemShadowPolicy?.permissionKey === required[0]) return next();
    const policyMiddleware = required.length === 1
      ? requireCapabilityEnforced(required[0])
      : requireAnyCapabilityEnforced(required);
    return policyMiddleware(req, res, next);
  };
}
function assertUserBranchAccess(user, branchId) {
  const allowedBranchIds = branchScopeForUser(user, { role: effectiveRole(user) });
  if (allowedBranchIds !== null && !allowedBranchIds.includes(Number(branchId))) {
    throw branchScopeError('branch_access_denied', 403, 'دسترسی به شعبهٔ این سفارش مجاز نیست.');
  }
}
function requireAdmin(req, res, next) {
  const routeCapability = lookupPolicyCapability(req.method, req.path);
  return requireCapability(routeCapability || 'admin.access')(req, res, next);
}
function requireCommandCenterAccess(req, res, next) {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: 'unauthorized' });
  if (!userCan(user, 'ops.view') && !userCan(user, 'command.view') && !userCan(user, 'kitchen.view') && !userCan(user, 'admin.access')) {
    return res.status(403).json({ error: 'command_center_forbidden' });
  }
  req.user = user;
  try {
    assertRequestBranchAccess(req);
  } catch (error) {
    return res.status(error.status || 400).json({ error: error.code || 'branch_access_denied', message: error.message, requestId: req.requestId });
  }
  const routeCapability = lookupPolicyCapability(req.method, req.path) || 'command.view';
  return requireCapability(routeCapability)(req, res, next);
}
function requireKitchen(req, res, next) {
  return requireCapability('kitchen.view')(req, res, next);
}
function requireOwner(req, res, next) {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: 'unauthorized' });
  if (effectiveRole(user) !== 'owner') return res.status(403).json({ error: 'owner_required' });
  req.user = user;
  next();
}
function isBirthdateLocked(u) {
  if (!u || !u.birthdate) return false;
  if (!u.birthdateUpdatedAt) return true; // If birthdate is already set, lock by default until 1 year passes
  const elapsedMs = Date.now() - new Date(u.birthdateUpdatedAt).getTime();
  const oneYearMs = 365 * 24 * 60 * 60 * 1000;
  return elapsedMs < oneYearMs;
}

function publicUser(u) {
  const role = effectiveRole(u);
  const allowedBranchIds = branchScopeForUser(u, { role });
  const addresses = Array.isArray(u.addresses) ? u.addresses : (u.address ? [{
    id: 'addr_default',
    title: '🏠 منزل',
    city: u.city || '',
    district: '',
    address: u.address,
    plaque: '',
    unit: '',
    floor: '',
    receiverName: u.name || '',
    receiverPhone: u.phone || '',
    note: u.notes || '',
    isDefault: true,
    createdAt: u.createdAt || new Date().toISOString(),
  }] : []);

  return {
    phone: u.phone,
    name: u.name || '',
    email: u.email || '',
    role,
    roleLabel: roleLabel(role),
    capabilities: capabilitiesFor(u, db.settings || {}),
    allowedBranchIds,
    points: Math.max(0, Math.round(Number(u.points) || 0)),
    birthdate: u.birthdate || '',
    birthdateLocked: isBirthdateLocked(u),
    birthdateUpdatedAt: u.birthdateUpdatedAt || null,
    gender: u.gender || '',
    city: u.city || '',
    address: u.address || '',
    addresses,
    defaultAddress: addresses.find((a) => a.isDefault) || addresses[0] || null,
    avatar: u.avatar || '',
    preferences: Array.isArray(u.preferences) ? u.preferences : [],
    notes: u.notes || '',
    createdAt: u.createdAt,
    lastLoginAt: u.lastLoginAt,
    blocked: !!u.blocked,
  };
}

function publishOperationalEvent(type, payload = {}, permission = 'ops.view') {
  db.commandCenter = db.commandCenter || { schemaVersion: 1, eventRevision: 0 };
  db.commandCenter.eventRevision = Number(db.commandCenter.eventRevision || 0) + 1;
  eventHub.publish(type, { ...payload, revision: db.commandCenter.eventRevision }, permission);
}

function recordAudit(req, action, targetType, targetId, meta = {}, branchId = null) {
  if (req) req.auditRecorded = true;
  const entry = createAuditEntry({
    actor: req?.user || null,
    action,
    targetType,
    targetId,
    branchId,
    meta,
  });
  entry.tenantId = TENANT_CONFIG.tenantId;
  db.auditLog = Array.isArray(db.auditLog) ? db.auditLog : [];
  db.auditLog.unshift(entry);
  db.auditLog = db.auditLog.slice(0, 5000);
  if (stateStore.enabled) {
    stateStore.appendAudit(entry).catch((error) => console.error('[postgres] unable to append audit event', error.message));
  }
  return entry;
}

function awardLoyaltyPoints(phone, points, reason, meta = {}) {
  if (!db.loyalty?.enabled) return null;
  const pts = Math.round(Number(points) || 0);
  if (!pts || !phone) return null;
  let user = db.users.find((u) => u.phone === phone);
  if (!user) {
    user = {
      phone,
      name: '',
      email: '',
      role: 'user',
      points: 0,
      createdAt: new Date().toISOString(),
      blocked: false,
    };
    db.users.push(user);
  }
  if (typeof user.points !== 'number') user.points = 0;
  user.points = Math.max(0, user.points + pts);
  const entry = {
    id: Math.max(0, ...(db.loyaltyLedger || []).map((e) => e.id), 0) + 1,
    phone,
    delta: pts,
    balance: user.points,
    reason: String(reason || 'adjust').slice(0, 80),
    meta,
    at: new Date().toISOString(),
  };
  db.loyaltyLedger = db.loyaltyLedger || [];
  db.loyaltyLedger.unshift(entry);
  db.loyaltyLedger = db.loyaltyLedger.slice(0, 2000);
  return entry;
}

function pointsForOrderTotal(total, phone) {
  const user = phone ? db.users.find((u) => u.phone === phone) : null;
  const resolved = loyaltyEngine.resolveCustomerTier(db, user);
  return loyaltyEngine.calculateOrderPointsEarned(db, total, resolved.tier);
}

// ---- OTP & Cybersecurity Hardening ------------------------------------
const otps = new Map(); // phone -> { code, expiresAt, attempts, requestedAt }
const otpRequestTimestamps = new Map(); // phone -> lastRequestedEpochMs
const OTP_COOLDOWN_MS = Number(process.env.OTP_COOLDOWN_MS) || 60000;
const MAX_OTP_ATTEMPTS = 5;
const PHONE_RE = /^09\d{9}$/;

// Accept Persian (۰-۹) and Arabic (٠-٩) digits everywhere numbers come in.
function normalizeDigits(str) {
  return String(str ?? '')
    .replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d))
    .replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
}

function normalizePhoneKey(phone) {
  if (!phone) return '';
  let digits = normalizeDigits(String(phone)).replace(/\D/g, '');
  if (digits.startsWith('0098')) digits = digits.slice(4);
  else if (digits.startsWith('98') && digits.length === 12) digits = digits.slice(2);
  else if (digits.startsWith('0') && digits.length === 11) digits = digits.slice(1);
  return digits;
}

function phonesMatch(p1, p2) {
  const k1 = normalizePhoneKey(p1);
  const k2 = normalizePhoneKey(p2);
  return !!(k1 && k2 && k1 === k2);
}

// Public order mutations remain intentionally handler-controlled because they
// are customer flows, not staff capabilities. They still need production
// gates of their own: replay protection, abuse throttling and a commercial
// entitlement that is authoritative outside the WESTO JSON snapshot.
const PUBLIC_ORDER_RATE_WINDOW_MS = 60 * 1000;
const PUBLIC_ORDER_RATE_LIMIT = 30;
const publicOrderRateBuckets = new Map();

function publicMutationClientKey(req) {
  const ip = String(req.ip || req.socket?.remoteAddress || 'unknown').trim();
  return ip || 'unknown';
}

function hasActiveLocalEntitlement(featureKey) {
  const entitlements = db.neemEntitlements || db.featureEntitlements || null;
  const raw = entitlements && entitlements[featureKey];
  if (raw === true) return true;
  if (!raw || raw.active === false) return false;
  if (raw.active !== true && !['active', 'trialing', 'provisioning'].includes(String(raw.status || '').toLowerCase())) return false;
  if (raw.expiresAt && new Date(raw.expiresAt).getTime() <= Date.now()) return false;
  return true;
}

function productionPaymentProviderReady() {
  if (process.env.NODE_ENV !== 'production') return true;
  const provider = db.paymentProvider || {};
  return Boolean(provider.enabled !== false
    && String(provider.mode || '').toLowerCase() !== 'sandbox'
    && String(provider.provider || '').trim()
    && String(provider.provider || '').toLowerCase() !== 'sandbox');
}

function guardPublicOrderMutation(req, res, featureKey) {
  const now = Date.now();
  const key = publicMutationClientKey(req);
  const existing = publicOrderRateBuckets.get(key);
  const bucket = existing && now - existing.startedAt < PUBLIC_ORDER_RATE_WINDOW_MS
    ? existing
    : { startedAt: now, count: 0 };
  bucket.count += 1;
  publicOrderRateBuckets.set(key, bucket);
  if (publicOrderRateBuckets.size > 5000) {
    for (const [clientKey, candidate] of publicOrderRateBuckets) {
      if (now - candidate.startedAt >= PUBLIC_ORDER_RATE_WINDOW_MS) publicOrderRateBuckets.delete(clientKey);
    }
  }
  if (bucket.count > PUBLIC_ORDER_RATE_LIMIT) {
    res.setHeader('Retry-After', '60');
    res.status(429).json({ error: 'public_order_rate_limited', retryAfterSec: 60 });
    return false;
  }

  if (process.env.NODE_ENV !== 'production') return true;
  const idempotencyKey = String(req.get('Idempotency-Key') || req.body?.idempotencyKey || '').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$/.test(idempotencyKey)) {
    res.status(400).json({ error: 'idempotency_key_required', message: 'برای ثبت سفارش تولیدی، Idempotency-Key معتبر الزامی است.' });
    return false;
  }
  if (!hasActiveLocalEntitlement(featureKey)) {
    res.status(503).json({ error: 'feature_entitlement_unavailable', featureKey, message: 'حق استفادهٔ تجاری این مسیر از Control Plane تأیید نشده است.' });
    return false;
  }
  return true;
}

function publicOrderMutationGuard(featureKey) {
  return (req, res, next) => {
    if (!guardPublicOrderMutation(req, res, featureKey)) return;
    next();
  };
}

function sandboxPaymentGuard(req, res, next) {
  if (process.env.NODE_ENV === 'production') return res.status(409).json({ error: 'sandbox_disabled' });
  next();
}

// ---- app ----------------------------------------------------------------
const app = express();
app.disable('x-powered-by');
app.use(tenantHostMiddleware(TENANT_CONFIG, { logger: console }));
app.use((req, res, next) => {
  const tenantSlug = resolveTenantSlugFromRequest(req);
  req.tenantSlug = tenantSlug;
  req.tenantId = tenantSlug;
  const tenantDb = tenantRegistry.getTenantDb(tenantSlug);
  req.tenantDb = tenantDb;

  tenantStorage.run({ tenantId: tenantSlug, db: tenantDb }, () => {
    next();
  });
});
// ── NEEM Tenant Policy Enforcement Layer ───────────────────────────────────
// Attaches req.neemPrincipal on every request (non-blocking).
// Resolve WESTO's signed session before the route-aware policy layer so an
// authenticated operator is not evaluated as the anonymous guest.
app.use(createNeemPrincipalMiddleware({ resolveUser: currentUser }));
// Shadow-evaluates (or enforces, depending on NEEM_POLICY_MODE) policy for
// all routes listed in the route-capability-map. In shadow mode this never
// blocks; in enforce mode it returns 403 on DENY.
app.use(neemRouteAwarePolicyMiddleware());
// NEEM God Mode dynamic feature entitlement gate
app.use((req, res, next) => {
  const isFinance = req.path.startsWith('/api/admin/finance') || req.path.startsWith('/api/admin/v2/finance');
  if (isFinance) {
    const entitlements = db.featureEntitlements || db.neemEntitlements;
    const financeGrant = entitlements && entitlements['finance.workspace'];
    if (financeGrant && (financeGrant.active === false || financeGrant.status === 'disabled')) {
      return res.status(403).json({
        ok: false,
        error: 'feature_disabled',
        featureKey: 'finance.workspace',
        message: 'بخش حسابداری و امور مالی توسط کنترل‌پلن NEEM برای این مشتری غیرفعال شده است.'
      });
    }
  }

  // Universal route-to-feature mapping for all 12 operational domains
  const featureKey = resolveFeatureForRoute(req.path, req.method);
  if (featureKey) {
    const isEnabled = isFeatureEnabledForTenant(db, featureKey);
    if (!isEnabled) {
      const info = getFeatureInfo(featureKey);
      return res.status(403).json({
        ok: false,
        error: 'feature_disabled',
        featureKey,
        message: `قابلیت «${info.nameFa || featureKey}» توسط کنترل‌پلن NEEM برای این مشتری غیرفعال شده است.`
      });
    }
  }

  next();
});
if (process.env.TRUST_PROXY === 'true') app.set('trust proxy', 1);
app.use(compression({ threshold: 1024, level: 6 }));
app.use((req, res, next) => {
  const requestId = String(req.headers['x-request-id'] || crypto.randomUUID()).slice(0, 96);
  req.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  res.setHeader('Content-Security-Policy', "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'");
  if (/^\/api\/(?:admin|auth|kitchen)\b/.test(req.path)) res.setHeader('Cache-Control', 'no-store');
  next();
});
app.use(express.json({ limit: '1mb' }));
app.use((error, req, res, next) => {
  if (error?.type === 'entity.parse.failed' || (error instanceof SyntaxError && error.status === 400)) {
    return res.status(400).json({ error: 'invalid_json', requestId: req.requestId });
  }
  return next(error);
});
function sanitizePrototypeKeys(obj, seen = new WeakSet()) {
  if (!obj || typeof obj !== 'object') return;
  if (seen.has(obj)) return;
  seen.add(obj);
  for (const key of Object.getOwnPropertyNames(obj)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      delete obj[key];
    } else if (typeof obj[key] === 'object' && obj[key] !== null) {
      sanitizePrototypeKeys(obj[key], seen);
    }
  }
}
app.use((req, res, next) => {
  if (req.body) sanitizePrototypeKeys(req.body);
  if (req.query) sanitizePrototypeKeys(req.query);
  if (req.params) sanitizePrototypeKeys(req.params);
  next();
});
app.use((req, res, next) => {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  if (!/^\/api\/(?:admin|kitchen)\b/.test(req.path) && !/^\/api\/(?:content|menu|faq(?:-|\/|$)|v2\/orders(?:\/|$)|auth\/(?:logout|profile)$)/.test(req.path)) return next();
  const origin = String(req.headers.origin || '');
  if (!origin) return next(); // non-browser clients/tests
  let originHost = '';
  try { originHost = new URL(origin).host; } catch (_) { return res.status(403).json({ error: 'cross_origin_write_blocked', requestId: req.requestId }); }
  if (originHost !== String(req.get('host') || '')) {
    const isNeemGodMode = (req.path.startsWith('/api/admin/features') || req.path.startsWith('/api/admin/tenants')) && (originHost.includes(':3050') || originHost.includes(':3061'));
    if (!isNeemGodMode) {
      return res.status(403).json({ error: 'cross_origin_write_blocked', requestId: req.requestId });
    }
  }
  next();
});

// Sensitive operational writes that predate the command-center endpoints are
// recorded automatically. Newer routes record richer, domain-specific entries
// themselves; `auditRecorded` prevents a duplicate generic event.
app.use((req, res, next) => {
  const isWrite = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method);
  const isSensitivePath = /^(?:\/api\/admin\/|\/api\/kitchen\/|\/api\/content$|\/api\/menu\/|\/api\/faq(?:-|$))/.test(req.path);
  if (!isWrite || !isSensitivePath) return next();
  res.on('finish', () => {
    if (res.statusCode >= 400 || req.auditRecorded) return;
    const actor = req.user || currentUser(req);
    if (!actor) return;
    const target = req.path.replace(/^\/api\//, '').replace(/\//g, ':').slice(0, 180);
    const action = `mutation.${req.method.toLowerCase()}`;
    const branchId = Number(req.body?.branchId || req.query?.branchId) || null;
    recordAudit(req, action, 'api_route', target, { path: req.path }, branchId);
    publishOperationalEvent('admin.updated', { path: req.path, branchId }, 'command.view');
    save();
  });
  next();
});

function branchScoped(list, branchId) {
  if (!branchId) return list;
  return list.filter((item) => Number(item.branchId) === Number(branchId));
}

function commandCenterPayload(branchId = null) {
  const now = Date.now();
  const today = new Date().toISOString().slice(0, 10);
  const orders = branchScoped(db.orders || [], branchId);
  const reservations = branchScoped(db.reservations || [], branchId);
  const paymentAttempts = branchScoped(db.paymentAttempts || [], branchId);
  const tables = branchScoped(db.tables || [], branchId);
  const activeStatuses = new Set([
    'pending_online',
    'awaiting_confirmation',
    'pay_at_cashier',
    'sent_to_kitchen',
    'paid',
    'preparing',
    'ready',
    'dispatched',
  ]);
  const queue = orders
    .filter((order) => activeStatuses.has(order.status))
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
    .slice(0, 32)
    .map((order) => ({
      id: order.id,
      branchId: order.branchId,
      status: order.status,
      paymentStatus: paymentStatusFor(order),
      fulfillment: normalizeFulfillment(order.fulfillment, { tableNo: order.tableNo }),
      tableNo: order.tableNo || null,
      customerName: order.name || 'مهمان',
      total: order.total,
      createdAt: order.createdAt,
      ageMinutes: Math.max(0, Math.floor((now - new Date(order.createdAt).getTime()) / 60000)),
      items: (order.items || []).map((line) => ({ name: line.name, qty: line.qty })),
    }));
  const legacyLowStock = (db.menuItems || [])
    .filter((item) => !financeV2.menuItemUsesInventoryV2(db, item.id, branchId)
      && typeof item.stock === 'number' && item.stock <= Math.max(0, Number(item.lowStockAt) || 5))
    .map((item) => ({ id: item.id, name: item.name, stock: item.stock, lowStockAt: item.lowStockAt, kind: 'menu' }));
  const materialLowStock = financeV2.inventoryItemsView(db, { branchId }).items
    .filter((item) => Number(item.minStock || 0) > 0
      && Number(item.availableQuantity ?? item.qtyOnHand ?? item.onHand ?? item.quantity) <= Number(item.minStock))
    .map((item) => ({
      id: item.id, name: item.name, stock: Number(item.availableQuantity ?? item.qtyOnHand ?? item.onHand ?? item.quantity) || 0,
      lowStockAt: Number(item.minStock) || 0, unit: item.unit || null, kind: 'material',
    }));
  const lowStock = [...materialLowStock, ...legacyLowStock].slice(0, 12);
  const activeReservations = reservations.filter((item) => item.date === today && !['cancelled', 'no_show'].includes(item.status));
  const tableCapacity = tables.reduce((sum, table) => sum + (Number(table.seats) || 0), 0);
  const usedCapacity = activeReservations.reduce((sum, item) => sum + (Number(item.partySize) || 0), 0);
  const delayed = queue.filter((item) => item.ageMinutes >= 20 && !['ready', 'dispatched'].includes(item.status));
  return {
    generatedAt: new Date().toISOString(),
    revision: Number(db.commandCenter?.eventRevision || 0),
    branchId: branchId || null,
    summary: {
      queue: queue.length,
      delayed: delayed.length,
      lowStock: lowStock.length,
      reservationsToday: activeReservations.length,
      pendingPayments: paymentAttempts.filter((item) => item.status === 'pending').length + queue.filter((item) => item.paymentStatus === 'pending').length,
      capacity: { used: usedCapacity, total: tableCapacity, percent: tableCapacity ? Math.round((usedCapacity / tableCapacity) * 100) : 0 },
    },
    queue,
    delayed,
    lowStock,
    reservations: activeReservations.slice(0, 12),
    payments: paymentAttempts.filter((item) => ['pending', 'failed'].includes(item.status)).slice(0, 12),
    audit: (db.auditLog || []).slice(0, 12),
  };
}

app.get('/api/admin/session', requireCommandCenterAccess, (req, res) => {
  const allowedBranchIds = branchScopeForUser(req.user, { role: effectiveRole(req.user) });
  res.json({
    user: publicUser(req.user),
    branchId: parseBranchId(req),
    branches: (db.branches || []).filter((branch) => branch.active !== false
      && (allowedBranchIds === null || allowedBranchIds.includes(Number(branch.id)))),
  });
});

const STAFF_WORKSPACES = Object.freeze({
  cashier: { label: 'صندوق', path: '/admin/cashier', capability: 'cash.manage' },
  waiter: { label: 'سالن و گارسون', path: '/admin/waiter', capability: 'service.manage' },
  kitchen: { label: 'آشپزخانه', path: '/admin/kitchen', capability: 'kitchen.view' },
});

function canOpenWorkspace(user, workspace) {
  const target = STAFF_WORKSPACES[workspace];
  if (!target) return false;
  const role = effectiveRole(user);
  return role === workspace || role === 'owner' || role === 'manager';
}

function activeStaffShift(user, branchId) {
  return (db.staffShifts || []).find((shift) =>
    shift.phone === user.phone && Number(shift.branchId) === Number(branchId) && !shift.closedAt
  ) || null;
}

function activeCashSession(user, branchId) {
  return (db.cashSessions || []).find((session) =>
    session.phone === user.phone && Number(session.branchId) === Number(branchId) && !session.closedAt
  ) || null;
}

function cashSessionTotals(session) {
  const movements = Array.isArray(session?.movements) ? session.movements : [];
  const signed = movements.reduce((sum, movement) => sum + Number(movement.amount || 0), 0);
  return {
    opening: Number(session?.openingAmount || 0),
    sales: movements.filter((item) => item.type === 'sale').reduce((sum, item) => sum + Number(item.amount || 0), 0),
    payIn: movements.filter((item) => item.type === 'pay_in').reduce((sum, item) => sum + Number(item.amount || 0), 0),
    payOut: Math.abs(movements.filter((item) => item.type === 'pay_out').reduce((sum, item) => sum + Number(item.amount || 0), 0)),
    refunds: Math.abs(movements.filter((item) => item.type === 'refund').reduce((sum, item) => sum + Number(item.amount || 0), 0)),
    expected: Number(session?.openingAmount || 0) + signed,
  };
}

app.get('/api/admin/role-preview', requireCapability('role.preview'), (req, res) => {
  res.json({
    workspaces: Object.entries(STAFF_WORKSPACES).map(([role, item]) => ({
      role,
      label: item.label,
      path: item.path,
      capabilities: ROLE_CAPABILITIES[role] || [],
    })),
  });
});

app.get('/api/staff/session/:workspace', requireCommandCenterAccess, (req, res) => {
  const workspace = String(req.params.workspace || '');
  if (!canOpenWorkspace(req.user, workspace)) return res.status(403).json({ error: 'workspace_forbidden', workspace });
  const branchId = parseBranchId(req) || defaultBranch()?.id || null;
  const actualRole = effectiveRole(req.user);
  const allowedBranchIds = branchScopeForUser(req.user, { role: actualRole });
  res.json({
    user: publicUser(req.user),
    workspace: {
      role: workspace,
      label: STAFF_WORKSPACES[workspace].label,
      capabilities: ROLE_CAPABILITIES[workspace] || [],
      preview: actualRole !== workspace,
      returnPath: actualRole === 'owner' || actualRole === 'manager' ? '/admin' : null,
    },
    branchId,
    branches: (db.branches || []).filter((branch) => branch.active !== false
      && (allowedBranchIds === null || allowedBranchIds.includes(Number(branch.id)))),
    shift: activeStaffShift(req.user, branchId),
  });
});

app.post('/api/staff/shifts/open', requireCapability('ops.view'), (req, res) => {
  const branchId = parseBranchId(req) || defaultBranch()?.id || 1;
  const existing = activeStaffShift(req.user, branchId);
  if (existing) return res.json({ ok: true, idempotent: true, shift: existing });
  const shift = {
    id: nextId(db.staffShifts),
    phone: req.user.phone,
    role: effectiveRole(req.user),
    branchId,
    openedAt: new Date().toISOString(),
    closedAt: null,
  };
  db.staffShifts.unshift(shift);
  recordAudit(req, 'shift.opened', 'shift', shift.id, {}, branchId);
  save();
  res.status(201).json({ ok: true, shift });
});

app.post('/api/staff/shifts/close', requireCapability('ops.view'), (req, res) => {
  const branchId = parseBranchId(req) || defaultBranch()?.id || 1;
  const shift = activeStaffShift(req.user, branchId);
  if (!shift) return res.status(409).json({ error: 'shift_not_open' });
  if (activeCashSession(req.user, branchId)) return res.status(409).json({ error: 'cash_drawer_still_open' });
  shift.closedAt = new Date().toISOString();
  recordAudit(req, 'shift.closed', 'shift', shift.id, {}, branchId);
  save();
  res.json({ ok: true, shift });
});

app.get('/api/cashier/drawer', requireCapability('cash.manage'), (req, res) => {
  const branchId = parseBranchId(req) || defaultBranch()?.id || 1;
  const session = activeCashSession(req.user, branchId);
  res.json({ session, totals: session ? cashSessionTotals(session) : null });
});

app.post('/api/cashier/drawer/open', requireCapability('cash.manage'), async (req, res) => {
  const branchId = parseBranchId(req) || defaultBranch()?.id || 1;
  const existing = activeCashSession(req.user, branchId);
  if (existing) return res.json({ ok: true, idempotent: true, session: existing, totals: cashSessionTotals(existing) });
  const snapshot = snapshotFinanceMutationState();
  const openingAmount = Math.max(0, Math.round(Number(req.body?.openingAmount) || 0));
  const session = {
    id: nextId(db.cashSessions),
    phone: req.user.phone,
    branchId,
    openingAmount,
    openedAt: new Date().toISOString(),
    closedAt: null,
    movements: [],
  };
  try {
    db.cashSessions.unshift(session);
    recordAudit(req, 'cash_drawer.opened', 'cash_session', session.id, { openingAmount }, branchId);
    await persistFinanceMutation(snapshot);
    res.status(201).json({ ok: true, session, totals: cashSessionTotals(session) });
  } catch (error) {
    restoreFinanceMutationState(snapshot);
    return res.status(error.status || 503).json({ error: error.code || error.message });
  }
});

app.post('/api/cashier/drawer/movements', requireCapability('cash.manage'), async (req, res) => {
  const branchId = parseBranchId(req) || defaultBranch()?.id || 1;
  const session = activeCashSession(req.user, branchId);
  if (!session) return res.status(409).json({ error: 'cash_drawer_not_open' });
  const type = String(req.body?.type || '');
  if (!['pay_in', 'pay_out'].includes(type)) return res.status(400).json({ error: 'cash_movement_invalid' });
  const rawAmount = Math.max(1, Math.round(Number(req.body?.amount) || 0));
  const snapshot = snapshotFinanceMutationState();
  const movement = {
    id: nextId(session.movements),
    type,
    amount: type === 'pay_out' ? -rawAmount : rawAmount,
    note: String(req.body?.note || '').trim().slice(0, 160),
    at: new Date().toISOString(),
    by: req.user.phone,
  };
  try {
    session.movements.unshift(movement);
    recordAudit(req, `cash_drawer.${type}`, 'cash_session', session.id, { amount: movement.amount, note: movement.note }, branchId);
    const financeResult = financeV2.captureCashMovement(db, session, movement, { actor: req.user.phone });
    await persistFinanceMutation(snapshot);
    res.status(201).json({ ok: true, movement, session, totals: cashSessionTotals(session), finance: financeResult });
  } catch (error) {
    restoreFinanceMutationState(snapshot);
    return res.status(error.status || 503).json({ error: error.code || error.message });
  }
});

app.post('/api/cashier/drawer/close', requireCapability('cash.manage'), async (req, res) => {
  const branchId = parseBranchId(req) || defaultBranch()?.id || 1;
  const session = activeCashSession(req.user, branchId);
  if (!session) return res.status(409).json({ error: 'cash_drawer_not_open' });
  const totals = cashSessionTotals(session);
  const snapshot = snapshotFinanceMutationState();
  session.countedAmount = Math.max(0, Math.round(Number(req.body?.countedAmount) || 0));
  session.variance = session.countedAmount - totals.expected;
  session.closedAt = new Date().toISOString();
  recordAudit(req, 'cash_drawer.closed', 'cash_session', session.id, { countedAmount: session.countedAmount, variance: session.variance }, branchId);
  try {
    const financeResult = financeV2.captureCashClose(db, session, { actor: req.user.phone });
    await persistFinanceMutation(snapshot);
    res.json({ ok: true, session, totals: { ...totals, counted: session.countedAmount, variance: session.variance }, finance: financeResult });
  } catch (error) {
    restoreFinanceMutationState(snapshot);
    return res.status(error.status || 503).json({ error: error.code || error.message });
  }
});

registerAdminV2Routes({
  app,
  getDb: () => db,
  save,
  requireCapability,
  requireAdmin,
  parseBranchId,
  normalizeDigits,
  phoneRe: PHONE_RE,
  recordAudit,
});

financeV2.registerFinanceV2Routes({
  app,
  getDb: () => db,
  save,
  requireCapability,
  effectiveRole,
  getStorageStatus: () => stateStore.financeStatus(),
});

// Finance V1 remains a read-only compatibility adapter during the shadow
// ledger rollout. All new mutations must use the idempotent Finance V2 API.
app.use('/api/admin/finance', (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.path === '/vendors' || req.path.startsWith('/vendors/')) return next();
  return res.status(410).json({
    data: null,
    meta: { generatedAt: new Date().toISOString(), replacement: '/api/admin/v2/finance' },
    error: { code: 'finance_v1_read_only', message: 'عملیات نوشتنی مالی به Finance V2 منتقل شده است.' },
  });
});

// The remaining /v1 and taxpayer write aliases are legacy compatibility
// surfaces too. Keep their read routes available, but fail closed before any
// old accounting engine can create a parallel ledger outside Finance V2.
const blockLegacyFinanceWrites = (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.baseUrl === '/v1' && req.path === '/audit/validate-permission') return next();
  return res.status(410).json({
    data: null,
    meta: { generatedAt: new Date().toISOString(), replacement: '/api/admin/v2/finance' },
    error: { code: 'finance_v1_read_only', message: 'عملیات نوشتنی مالی به Finance V2 منتقل شده است.' },
  });
};
app.use('/v1', blockLegacyFinanceWrites);
app.use('/api/tax', blockLegacyFinanceWrites);

registerAccountingRoutes({
  app,
  getDb: () => db,
  save,
  requireCapability,
  requireAdmin,
  parseBranchId,
});

app.get('/api/tenant/context', (req, res) => {
  res.json({ ok: true, tenant: publicTenantContext(TENANT_CONFIG) });
});

// NEEM remains a separate operations application so its React runtime and
// finance database can never interfere with the public 3D menu runtime.
app.get('/api/admin/neem-integration', requireCapability('admin.access'), (req, res) => {
  res.json({ ok: true, integration: neemBridge.status() });
});

app.post('/api/admin/neem-integration/retry', requireCapability('admin.access'), (req, res) => {
  neemBridge.retry();
  res.json({ ok: true, integration: neemBridge.status() });
});

app.post('/api/admin/neem-integration/backfill', requireCapability('admin.access'), (req, res) => {
  const queued = neemBridge.queueBackfill();
  res.json({ ok: true, queued, integration: neemBridge.status() });
});

// Dynamic Feature Control from NEEM God Mode & Health Check
app.use((req, res, next) => {
  if (req.path === '/api/health') {
    const origin = String(req.headers.origin || '');
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Request-Id');
    }
    if (req.method === 'OPTIONS') {
      return res.sendStatus(204);
    }
    return res.json({
      ok: true,
      status: 'healthy',
      app: 'WESTO',
      version: '1.2.0',
      port: PORT,
      database: process.env.DATABASE_URL ? 'connected (postgresql:5433)' : 'memory',
      timestamp: new Date().toISOString()
    });
  }

  const applyAdminCors = () => {
    const origin = String(req.headers.origin || '');
    if (origin && (origin.includes(':3050') || origin.includes(':3061') || origin.includes('localhost') || origin.includes('127.0.0.1'))) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Request-Id, Authorization, X-Neem-Control-Secret, X-Tenant-Id, X-Tenant-Slug');
    }
  };

  if (req.path === '/api/admin/features' && req.method === 'GET') {
    applyAdminCors();
    const targetTenant = req.query.tenantId || req.tenantSlug || 'westo';
    const targetDb = tenantRegistry.getTenantDb(targetTenant);
    return res.json({
      ok: true,
      tenantId: targetTenant,
      features: targetDb.featureEntitlements || {}
    });
  }

  if (req.path === '/api/admin/features/toggle' && req.method === 'OPTIONS') {
    applyAdminCors();
    return res.sendStatus(204);
  }

  if (req.path === '/api/admin/features/toggle' && req.method === 'POST') {
    applyAdminCors();

    const origin = String(req.headers.origin || '');
    const originHost = (() => { try { return new URL(origin).host; } catch (_) { return ''; } })();
    const isFromNeemPlatform = originHost.includes(':3050') || originHost.includes(':3061');

    const user = currentUser(req);
    const authHeader = String(req.headers.authorization || '');
    const controlSecret = String(req.headers['x-neem-control-secret'] || '');
    const expectedSecret = process.env.NEEM_CONTROL_SECRET || SECRET;
    const isControlSecretValid = controlSecret && expectedSecret && controlSecret === expectedSecret;
    const isBearerSecretValid = authHeader && expectedSecret && authHeader.trim() === `Bearer ${expectedSecret}`;
    const isAdminUser = Boolean(user && (user.role === 'admin' || user.role === 'owner' || (db.settings?.adminPhones || []).includes(user.phone)));

    if (!isAdminUser && !isControlSecretValid && !isBearerSecretValid && !isFromNeemPlatform) {
      return res.status(401).json({
        ok: false,
        error: 'unauthorized',
        message: 'تغییر وضعیت قابلیت‌ها در کاتالوگ نیازمند احراز هویت مدیریتی معتبر است.'
      });
    }

    const { featureKey, enabled, tenantId } = req.body || {};
    if (!featureKey) {
      return res.status(400).json({ ok: false, error: 'featureKey_required' });
    }

    const targetTenant = tenantId || req.tenantSlug || 'westo';
    const targetDb = tenantRegistry.getTenantDb(targetTenant);
    if (!targetDb.featureEntitlements) targetDb.featureEntitlements = {};
    targetDb.featureEntitlements[featureKey] = {
      active: Boolean(enabled),
      status: enabled ? 'active' : 'disabled',
      updatedAt: new Date().toISOString()
    };
    tenantRegistry.saveTenantDb(targetTenant);

    return res.json({
      ok: true,
      tenantId: targetTenant,
      featureKey,
      enabled: Boolean(enabled),
      message: `قابلیت ${featureKey} برای مستأجر ${targetTenant} به وضعیت ${enabled ? 'فعال' : 'غیرفعال'} تغییر یافت.`
    });
  }

  if (req.path.startsWith('/api/admin/features') && req.method === 'OPTIONS') {
    applyAdminCors();
    return res.status(204).end();
  }

  // Multi-tenant provisioning & management APIs
  if (req.path.startsWith('/api/admin/tenants') && req.method === 'OPTIONS') {
    applyAdminCors();
    return res.status(204).end();
  }

  if (req.path === '/api/admin/tenants/provision' && req.method === 'POST') {
    applyAdminCors();

    const origin = String(req.headers.origin || '');
    const originHost = (() => { try { return new URL(origin).host; } catch (_) { return ''; } })();
    const isFromNeemPlatform = originHost.includes(':3050') || originHost.includes(':3061');

    const user = currentUser(req);
    const authHeader = String(req.headers.authorization || '');
    const controlSecret = String(req.headers['x-neem-control-secret'] || '');
    const expectedSecret = process.env.NEEM_CONTROL_SECRET || SECRET;
    const isControlSecretValid = controlSecret && expectedSecret && controlSecret === expectedSecret;
    const isBearerSecretValid = authHeader && expectedSecret && authHeader.trim() === `Bearer ${expectedSecret}`;
    const isAdminUser = Boolean(user && (user.role === 'admin' || user.role === 'owner' || (db.settings?.adminPhones || []).includes(user.phone)));

    if (!isAdminUser && !isControlSecretValid && !isBearerSecretValid && !isFromNeemPlatform) {
      return res.status(401).json({
        ok: false,
        error: 'unauthorized',
        message: 'ایجاد مستأجر جدید نیازمند احراز هویت معتبر است.'
      });
    }

    const { tenantId, name, brandName, domain, enabledFeatures } = req.body || {};
    if (!tenantId) {
      return res.status(400).json({ ok: false, error: 'tenantId_required' });
    }

    const cleanDb = tenantRegistry.createTenant(tenantId, {
      name: name || brandName || tenantId,
      brandName: brandName || name || tenantId,
      domain: domain || `${tenantId}.neem.ir`,
      enabledFeatures: Array.isArray(enabledFeatures) ? enabledFeatures : ['core.workspace', 'catalog.menu']
    });

    return res.status(201).json({
      ok: true,
      tenantId,
      name: cleanDb.settings?.restaurantName,
      domain: `${tenantId}.neem.ir`,
      message: `مستأجر خام «${tenantId}» با موفقیت ایجاد شد و آماده پیکربندی از مرکز فرماندهی NEEM است.`
    });
  }

  if (req.path === '/api/admin/tenants' && req.method === 'GET') {
    applyAdminCors();
    const list = tenantRegistry.listTenants();
    return res.json({
      ok: true,
      tenants: list
    });
  }

  next();
});

app.get('/ops', requireCapability('admin.access'), (req, res) => {
  const target = process.env.NEEM_OPS_URL || 'http://127.0.0.1:3061/console/';
  res.redirect(302, target);
});

// Deep links keep the relevant NEEM workspace reachable from the matching
// WESTO admin section while the two runtimes remain isolated.
const NEEM_OPERATION_VIEWS = new Set([
  'tables', 'customers', 'marketing', 'reservations', 'waiter-panel',
  'fin-overview', 'fin-sales', 'fin-cash-drawers', 'fin-settlements',
  'fin-journal', 'fin-gl', 'fin-coa', 'fin-trial-balance', 'fin-reports',
  'fin-period-close', 'fin-command-center', 'fin-expenses', 'fin-bank-feed',
  'fin-three-way-match', 'fin-tax-matrix',
]);

app.get('/ops/:view', requireCapability('admin.access'), (req, res) => {
  const view = String(req.params.view || '');
  if (!NEEM_OPERATION_VIEWS.has(view)) return res.status(404).json({ error: 'unknown_neem_view' });
  const base = (process.env.NEEM_OPS_URL || 'http://127.0.0.1:3061/console/').replace(/\/?(?:#.*)?$/, '');
  res.redirect(302, `${base}/#${encodeURIComponent(view)}`);
});

app.get('/api/admin/command-center', requireCapability('command.view'), (req, res) => {
  res.json(commandCenterPayload(parseBranchId(req)));
});

app.get('/api/admin/events', requireCapability('ops.view'), (req, res) => {
  const branchId = parseBranchId(req);
  eventHub.subscribe(req, res, (event) => {
    if (event.permission && !userCan(req.user, event.permission)) return false;
    const eventBranch = event.payload?.branchId;
    return !branchId || !eventBranch || Number(eventBranch) === Number(branchId);
  });
});

app.get('/api/admin/audit', requireCapability('admin.access'), (req, res) => {
  const branchId = parseBranchId(req);
  const limit = Math.max(1, Math.min(200, Number(req.query.limit) || 80));
  const log = branchScoped(db.auditLog || [], branchId).slice(0, limit);
  res.json({ audit: log, branchId: branchId || null });
});

// --- auth ---
app.post('/api/auth/request-otp', (req, res) => {
  const phone = normalizeDigits(req.body?.phone || '').trim();
  if (!PHONE_RE.test(phone)) return res.status(400).json({ error: 'شماره موبایل معتبر نیست' });

  // Anti-Spam & Rate-Limiting Cooldown Check
  const enforceCooldown = !IS_NODE_TEST_RUNTIME || req.headers['x-enforce-cooldown'] === 'true';
  const now = Date.now();
  const lastRequested = otpRequestTimestamps.get(phone) || 0;
  if (enforceCooldown && (now - lastRequested < OTP_COOLDOWN_MS)) {
    const retryAfter = Math.ceil((lastRequested + OTP_COOLDOWN_MS - now) / 1000);
    res.setHeader('Retry-After', String(retryAfter));
    return res.status(429).json({
      ok: false,
      error: 'rate_limited',
      message: `لطفاً پیش از درخواست مجدد کد، ${retryAfter} ثانیه صبر کنید.`,
      retryAfterSeconds: retryAfter
    });
  }

  const code = String(crypto.randomInt(10000, 99999));
  otps.set(phone, {
    code,
    expiresAt: now + (db.settings.otpTtlMs || 120000),
    attempts: 0,
    requestedAt: now
  });
  otpRequestTimestamps.set(phone, now);

  const demoOtp = process.env.OTP_DEMO_MODE === 'true' || process.env.NODE_ENV !== 'production';
  if (!demoOtp) {
    otps.delete(phone);
    return res.status(503).json({ error: 'ارسال OTP در محیط تولید هنوز پیکربندی نشده است' });
  }
  console.log(`[OTP:demo] ${phone} -> ${code}`);
  res.json({ ok: true, demo: true, code, ttlMs: db.settings.otpTtlMs || 120000 });
});

app.post('/api/auth/verify-otp', (req, res) => {
  const phone = normalizeDigits(req.body?.phone || '').trim();
  const code = normalizeDigits(req.body?.code || '').trim();
  const entry = otps.get(phone);
  if (!entry || entry.expiresAt < Date.now()) return res.status(400).json({ error: 'کد منقضی شده است؛ دوباره درخواست دهید' });

  // Anti-Brute-Force: Track attempts and destroy code after MAX_OTP_ATTEMPTS
  entry.attempts = (entry.attempts || 0) + 1;
  if (entry.attempts > MAX_OTP_ATTEMPTS) {
    otps.delete(phone);
    return res.status(429).json({
      error: 'تعداد تلاش‌های ناموفق بیش از حد مجاز بود؛ کد باطل شد. لطفاً دوباره درخواست کد دهید.',
      code: 'MAX_ATTEMPTS_EXCEEDED'
    });
  }

  if (entry.code !== code) {
    const remaining = MAX_OTP_ATTEMPTS - entry.attempts;
    return res.status(400).json({
      error: remaining > 0
        ? `کد واردشده درست نیست (${remaining} تلاش باقی‌مانده)`
        : 'کد واردشده درست نیست'
    });
  }
  otps.delete(phone);

  let user = db.users.find((u) => u.phone === phone);
  if (!user) {
    user = {
      phone,
      name: '',
      email: '',
      role: db.settings.adminPhones.includes(phone) ? 'admin' : 'user',
      points: 0,
      createdAt: new Date().toISOString(),
      blocked: false,
    };
    db.users.push(user);
    awardLoyaltyPoints(phone, db.loyalty.welcomePoints, 'welcome');
  }
  user.lastLoginAt = new Date().toISOString();
  db.loginLog.unshift({ phone, at: user.lastLoginAt });
  db.loginLog = db.loginLog.slice(0, 200);
  save();
  const secureCookie = req.secure || String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
  const token = makeToken(phone);
  res.setHeader('Set-Cookie', `westo_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}${secureCookie ? '; Secure' : ''}`);
  res.json({ ok: true, user: publicUser(user), token });
});

app.get('/api/auth/me', (req, res) => {
  const user = currentUser(req);
  // Guests get 200 + null (avoids Chrome "Failed to load resource" 401 noise)
  if (!user) return res.json({ user: null });
  res.json({ user: publicUser(user) });
});

app.post('/api/auth/logout', (req, res) => {
  res.setHeader('Set-Cookie', 'westo_session=; Path=/; HttpOnly; Max-Age=0');
  res.json({ ok: true });
});

app.patch('/api/auth/profile', requireAuth, (req, res) => {
  const { name, email, birthdate, gender, city, address, preferences, notes, avatar } = req.body || {};
  const user = (db.users || []).find((u) => u.phone === req.user.phone) || req.user;
  if (typeof name === 'string') user.name = name.trim().slice(0, 100);
  if (typeof email === 'string') user.email = email.trim().slice(0, 200);

  if (typeof birthdate === 'string' && birthdate.trim()) {
    const trimmedBday = birthdate.trim().slice(0, 50);
    if (trimmedBday !== (user.birthdate || '')) {
      if (isBirthdateLocked(user)) {
        return res.status(400).json({
          error: 'تاریخ تولد قبلاً ثبت شده و امکان تغییر آن تا ۱ سال وجود ندارد. برای تغییر، با مدیریت هماهنگ فرمایید.'
        });
      }
      user.birthdate = trimmedBday;
      user.birthdateUpdatedAt = new Date().toISOString();
      try {
        campaignsEngine.checkBirthdayEligibility(db, user);
      } catch (_) {}
    }
  }

  if (typeof gender === 'string') user.gender = gender.trim().slice(0, 20);
  if (typeof city === 'string') user.city = city.trim().slice(0, 100);
  if (typeof address === 'string') user.address = address.trim().slice(0, 300);
  if (Array.isArray(preferences)) user.preferences = preferences.map((p) => String(p).trim().slice(0, 50)).filter(Boolean);
  if (typeof notes === 'string') user.notes = notes.trim().slice(0, 500);
  if (typeof avatar === 'string') user.avatar = avatar.trim().slice(0, 200000);

  save();
  res.json({ ok: true, user: publicUser(user) });
});

// --- user avatar endpoints ---
const userAvatarUpload = multer({
  limits: { fileSize: 4 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!/^image\/(png|jpe?g|webp|gif|svg\+xml)$/i.test(file.mimetype)) {
      return cb(new Error('فقط فایل‌های تصویری (PNG, JPG, WebP, GIF) مجاز هستند.'));
    }
    cb(null, true);
  },
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = path.join(UPLOADS, 'avatars');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname || '.png') || '.png';
      cb(null, `avatar-${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`);
    },
  }),
});

app.post('/api/user/avatar/upload', requireAuth, (req, res) => {
  userAvatarUpload.single('avatar')(req, res, (err) => {
    if (err) {
      return res.status(400).json({ ok: false, error: err.message || 'خطا در آپلود تصویر' });
    }
    if (!req.file) {
      return res.status(400).json({ ok: false, error: 'فایل تصویری انتخاب نشده است.' });
    }
    const avatarUrl = `uploads/avatars/${req.file.filename}`;
    const user = (db.users || []).find((u) => phonesMatch(u.phone, req.user.phone)) || req.user;
    user.avatar = avatarUrl;
    save();
    res.json({ ok: true, avatar: avatarUrl, user: publicUser(user) });
  });
});

app.post('/api/user/avatar', requireAuth, (req, res) => {
  const { avatar } = req.body || {};
  const user = (db.users || []).find((u) => phonesMatch(u.phone, req.user.phone)) || req.user;
  user.avatar = typeof avatar === 'string' ? avatar.trim().slice(0, 200000) : '';
  save();
  res.json({ ok: true, avatar: user.avatar, user: publicUser(user) });
});

// --- user multi-addresses API ---
app.get('/api/user/addresses', requireAuth, (req, res) => {
  const user = (db.users || []).find((u) => u.phone === req.user.phone) || req.user;
  const addresses = Array.isArray(user.addresses) ? user.addresses : (user.address ? [{
    id: 'addr_default',
    title: '🏠 منزل',
    city: user.city || '',
    district: '',
    address: user.address,
    plaque: '',
    unit: '',
    floor: '',
    receiverName: user.name || '',
    receiverPhone: user.phone || '',
    note: user.notes || '',
    isDefault: true,
    createdAt: user.createdAt || new Date().toISOString(),
  }] : []);
  res.json({ ok: true, addresses });
});

app.post('/api/user/addresses', requireAuth, (req, res) => {
  const user = (db.users || []).find((u) => u.phone === req.user.phone) || req.user;
  user.addresses = Array.isArray(user.addresses) ? user.addresses : [];

  const {
    title = '🏠 منزل',
    city = '',
    district = '',
    address = '',
    plaque = '',
    unit = '',
    floor = '',
    receiverName = '',
    receiverPhone = '',
    note = '',
    isDefault = false,
  } = req.body || {};

  const cleanAddress = String(address).trim();
  if (!cleanAddress) {
    return res.status(400).json({ error: 'نشانی پستی الزامی است.' });
  }

  const newAddressId = `addr_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const shouldBeDefault = isDefault || user.addresses.length === 0;

  if (shouldBeDefault) {
    user.addresses.forEach((a) => { a.isDefault = false; });
  }

  const newAddr = {
    id: newAddressId,
    title: String(title).trim().slice(0, 50) || '🏠 منزل',
    city: String(city).trim().slice(0, 100),
    district: String(district).trim().slice(0, 100),
    address: cleanAddress.slice(0, 300),
    plaque: String(plaque).trim().slice(0, 20),
    unit: String(unit).trim().slice(0, 20),
    floor: String(floor).trim().slice(0, 20),
    receiverName: String(receiverName || user.name || '').trim().slice(0, 100),
    receiverPhone: String(receiverPhone || user.phone || '').trim().slice(0, 30),
    note: String(note).trim().slice(0, 300),
    isDefault: shouldBeDefault,
    createdAt: new Date().toISOString(),
  };

  user.addresses.unshift(newAddr);
  if (shouldBeDefault) {
    user.address = newAddr.address;
    user.city = newAddr.city;
    if (newAddr.note) user.notes = newAddr.note;
  }

  save();
  res.json({ ok: true, address: newAddr, addresses: user.addresses });
});

app.put('/api/user/addresses/:id', requireAuth, (req, res) => {
  const user = (db.users || []).find((u) => u.phone === req.user.phone) || req.user;
  user.addresses = Array.isArray(user.addresses) ? user.addresses : [];

  const addr = user.addresses.find((a) => a.id === req.params.id);
  if (!addr) return res.status(404).json({ error: 'نشانی یافت نشد.' });

  const {
    title,
    city,
    district,
    address,
    plaque,
    unit,
    floor,
    receiverName,
    receiverPhone,
    note,
    isDefault,
  } = req.body || {};

  if (typeof title === 'string') addr.title = title.trim().slice(0, 50);
  if (typeof city === 'string') addr.city = city.trim().slice(0, 100);
  if (typeof district === 'string') addr.district = district.trim().slice(0, 100);
  if (typeof address === 'string') {
    const trimmed = address.trim();
    if (!trimmed) return res.status(400).json({ error: 'نشانی پستی نمی‌تواند خالی باشد.' });
    addr.address = trimmed.slice(0, 300);
  }
  if (typeof plaque === 'string') addr.plaque = plaque.trim().slice(0, 20);
  if (typeof unit === 'string') addr.unit = unit.trim().slice(0, 20);
  if (typeof floor === 'string') addr.floor = floor.trim().slice(0, 20);
  if (typeof receiverName === 'string') addr.receiverName = receiverName.trim().slice(0, 100);
  if (typeof receiverPhone === 'string') addr.receiverPhone = receiverPhone.trim().slice(0, 30);
  if (typeof note === 'string') addr.note = note.trim().slice(0, 300);

  if (typeof isDefault === 'boolean' && isDefault) {
    user.addresses.forEach((a) => { a.isDefault = (a.id === addr.id); });
    user.address = addr.address;
    user.city = addr.city;
    if (addr.note) user.notes = addr.note;
  }

  save();
  res.json({ ok: true, address: addr, addresses: user.addresses });
});

app.delete('/api/user/addresses/:id', requireAuth, (req, res) => {
  const user = (db.users || []).find((u) => u.phone === req.user.phone) || req.user;
  user.addresses = Array.isArray(user.addresses) ? user.addresses : [];

  const wasDefault = user.addresses.find((a) => a.id === req.params.id)?.isDefault;
  user.addresses = user.addresses.filter((a) => a.id !== req.params.id);

  if (wasDefault && user.addresses.length > 0) {
    user.addresses[0].isDefault = true;
    user.address = user.addresses[0].address;
    user.city = user.addresses[0].city;
  } else if (user.addresses.length === 0) {
    user.address = '';
  }

  save();
  res.json({ ok: true, addresses: user.addresses });
});

app.post('/api/user/addresses/:id/default', requireAuth, (req, res) => {
  const user = (db.users || []).find((u) => u.phone === req.user.phone) || req.user;
  user.addresses = Array.isArray(user.addresses) ? user.addresses : [];

  const target = user.addresses.find((a) => a.id === req.params.id);
  if (!target) return res.status(404).json({ error: 'نشانی یافت نشد.' });

  user.addresses.forEach((a) => { a.isDefault = (a.id === target.id); });
  user.address = target.address;
  user.city = target.city;
  if (target.note) user.notes = target.note;

  save();
  res.json({ ok: true, addresses: user.addresses, defaultAddress: target });
});

// --- Customer Feedback & Reviews ---
app.post('/api/user/feedback', requireAuth, (req, res) => {
  const { rating, comment, tags, aspectRatings } = req.body || {};
  const user = (db.users || []).find((u) => u.phone === req.user.phone) || req.user;
  db.feedbacks = Array.isArray(db.feedbacks) ? db.feedbacks : [];

  const feedbackId = `fb_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const numRating = Math.min(5, Math.max(1, Number(rating) || 5));
  const newFeedback = {
    id: feedbackId,
    phone: user.phone,
    userName: user.name || 'مشتری وستو',
    rating: numRating,
    comment: typeof comment === 'string' ? comment.trim().slice(0, 1000) : '',
    tags: Array.isArray(tags) ? tags.map((t) => String(t).slice(0, 50)) : [],
    aspectRatings: typeof aspectRatings === 'object' && aspectRatings ? aspectRatings : {},
    createdAt: new Date().toISOString(),
  };

  db.feedbacks.unshift(newFeedback);

  let pointsAwarded = 0;
  const lastAwardTime = user.lastFeedbackRewardAt ? new Date(user.lastFeedbackRewardAt).getTime() : 0;
  const monthMs = 30 * 24 * 60 * 60 * 1000;
  if (Date.now() - lastAwardTime > monthMs) {
    pointsAwarded = 50;
    user.points = (Number(user.points) || 0) + pointsAwarded;
    user.lastFeedbackRewardAt = new Date().toISOString();
  }

  save();
  res.json({
    ok: true,
    message: 'با تشکر! بازخورد شما با موفقیت ثبت شد.',
    pointsAwarded,
    newPoints: user.points,
  });
});

// --- content ---
function menuCategoryTitleForItem(item) {
  const category = (db.menuCategories || []).find((entry) => Number(entry.id) === Number(item?.categoryId));
  return category?.title || category?.name || '';
}

// Keep the catalogue response self-contained so every consumer (public menu,
// admin editor, waiter and cashier) sees the same dish-specific choices.  A
// missing field receives a contextual suggestion; an explicit [] remains an
// intentional "no preferences" configuration.
function menuItemForResponse(item) {
  return {
    ...item,
    modifierGroups: effectiveModifierGroupsForItem(item, menuCategoryTitleForItem(item)),
  };
}

function publicGuestMenuPayload(query = {}) {
  let items = db.menuItems;
  const branch = resolveBranch(query.branchId || query.branch);
  const branchId = branch?.id || null;
  if (!query.all) {
    items = items.filter((m) => {
      if (m.available === false || !itemVisibleNow(m)) return false;
      if (typeof m.stock === 'number' && m.stock <= 0) return false;
      const availability = branchId ? financeV2.menuItemAvailability(db, m.id, branchId) : null;
      if (availability?.tracked && !availability.available && db.settings?.enforceInventoryStock) return false;
      return true;
    });
  }
  if (query.categoryId) {
    const cid = Number(query.categoryId);
    items = items.filter((m) => m.categoryId === cid);
  }
  if (query.excludeAllergen) {
    const exclude = String(query.excludeAllergen)
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    if (exclude.length) {
      items = items.filter((m) => !(m.allergens || []).some((allergen) => exclude.includes(allergen)));
    }
  }

  return {
    menuCategories: db.menuCategories,
    menuItems: items.map(menuItemForResponse),
    siteCategories: activeMenuCategories(db),
    menuRevision: db.menuRevision || 0,
    allergens: ALLERGENS,
    dayparts: DAYPARTS.map(({ id, label }) => ({ id, label })),
    activeDayparts: currentDaypartIds(),
    i18n: db.i18n || { guestLangEnabled: true, defaultLang: 'fa', supported: ['fa', 'en', 'ar'] },
  };
}

function publicRestaurantPayload(branchToken) {
  const branch = resolveBranch(branchToken);
  const tables = (db.tables || []).filter(
    (table) => table.active !== false && (!branch || Number(table.branchId) === branch.id),
  );

  return {
    restaurant: db.restaurant,
    hours: branch?.hours || db.hours,
    branch: branch
      ? {
          id: branch.id,
          slug: branch.slug,
          name: branch.name,
          address: branch.address,
          phone: branch.phone,
          whatsapp: branch.whatsapp,
        }
      : null,
    branches: (db.branches || [])
      .filter((item) => item.active !== false)
      .map((item) => ({ id: item.id, slug: item.slug, name: item.name })),
    tables,
    theme: db.theme,
  };
}

function publicContentPayload({ includeUnavailable = true } = {}) {
  // The public bootstrap is also the source for the static Sites publication
  // and the standalone checkout. Do not let an incomplete inventory snapshot
  // erase the catalogue before a guest can see it. The order endpoint still
  // enforces menu flags, dayparts and branch inventory at submission time.
  const menu = publicGuestMenuPayload(includeUnavailable ? { all: true } : {});
  const restaurantPayload = publicRestaurantPayload();
  return {
    content: db.content,
    products: db.products,
    // Keep the historical top-level fields for content-overrides.js and older
    // static builds while publishing exact current menu/restaurant payloads for
    // the performance loader. This removes two startup API round trips without
    // changing the public API contracts.
    menuCategories: db.menuCategories,
    menuItems: menu.menuItems,
    siteCategories: activeMenuCategories(db),
    menuRevision: db.menuRevision || 0,
    menu,
    restaurantPayload,
    promoSlides: publicPromoSlides(),
    faq: db.faq,
    settings: { siteTitle: db.settings.siteTitle, metaDescription: db.settings.metaDescription },
  };
}

// Parser-friendly bootstrap: its preload overlaps HTML parsing and replaces
// the old synchronous XHR without introducing a race with SplitText/Three.
app.get('/api/content-bootstrap.js', (req, res) => {
  const json = JSON.stringify(publicContentPayload())
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.send(`window.__WESTO_CONTENT__=${json};`);
});

app.get('/api/content', (req, res) => {
  res.json(publicContentPayload());
});

app.put('/api/content', requireAdmin, (req, res) => {
  const updates = req.body.content || {};
  for (const [k, v] of Object.entries(updates)) {
    if (typeof v === 'string') db.content[k] = v;
  }
  save();
  res.json({ ok: true, content: db.content });
});

// --- products: read-only derived view (writes go through /api/menu/categories) ---
app.put('/api/products/:id', requireAdmin, (req, res) => {
  res.status(410).json({
    error: 'این مسیر منسوخ است — از مدیریت دسته‌های کاروسل استفاده کنید',
  });
});

// --- menu items (orderable dishes) ---
app.get('/api/menu', (req, res) => {
  res.json(publicGuestMenuPayload(req.query || {}));
});

function complementRulesForMenuItem(menuItem) {
  if (!menuItem) return [];
  return (db.menuComplementRules || []).filter((rule) => rule.active !== false && (
    (rule.sourceItemIds || []).includes(Number(menuItem.id)) ||
    (rule.sourceCategoryIds || []).includes(Number(menuItem.categoryId))
  ));
}

function staffMenuPayload(branchToken = null) {
  const branch = resolveBranch(branchToken);
  const branchId = branch?.id || null;
  return {
    menuCategories: db.menuCategories || [],
    menuItems: (db.menuItems || []).map((item) => {
      const availability = branchId ? financeV2.menuItemAvailability(db, item.id, branchId) : null;
      const resp = menuItemForResponse(item);
      resp.available = item.available !== false;
      resp.inventoryTracked = Boolean(availability?.tracked);
      resp.inventoryAvailable = availability ? Boolean(availability.available) : true;
      resp.capacity = availability && Number.isFinite(availability.capacity) ? availability.capacity : null;
      resp.inventoryIssues = availability?.issues || [];
      return resp;
    }),
    menuComplements: (db.menuComplements || []).filter((item) => item.available !== false && (item.stock == null || Number(item.stock) > 0)),
    menuComplementRules: (db.menuComplementRules || []).filter((rule) => rule.active !== false),
    menuRevision: db.menuRevision || 0,
  };
}

app.get('/api/staff/menu', requireCapability('orders.create'), (req, res) => {
  res.json(staffMenuPayload(req.query.branchId || req.query.branch));
});

function normalizeComplementInput(input = {}, current = {}) {
  const parseNum = (v) => {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return isNaN(v) ? null : v;
    const n = Number(normalizeDigits(String(v)).replace(/[,٬_\s]/g, '').trim());
    return isNaN(n) ? null : n;
  };
  const img = input.img !== undefined ? sanitizeMenuImg(input.img) : (current.img || '');
  if (img === null) return { error: 'مسیر تصویر مکمل نامعتبر است' };
  const stockRaw = input.stock !== undefined ? input.stock : current.stock;
  const parsedStock = parseNum(stockRaw);
  const stock = stockRaw == null || stockRaw === '' ? null : Math.max(0, Math.round(parsedStock ?? 0));
  const rawPrice = parseNum(input.price !== undefined ? input.price : current.price);
  const rawLow = parseNum(input.lowStockAt !== undefined ? input.lowStockAt : current.lowStockAt);
  const complement = {
    ...current,
    name: String(input.name !== undefined ? input.name : current.name || '').trim().slice(0, 120),
    price: Math.max(0, Math.round(rawPrice ?? 0)),
    img: img || '',
    available: input.available !== undefined ? input.available !== false : current.available !== false,
    stock,
    lowStockAt: Math.max(0, Math.round(rawLow ?? 5)),
    description: String(input.description !== undefined ? input.description : current.description || '').trim().slice(0, 500),
  };
  if (!complement.name) return { error: 'نام مکمل را وارد کنید' };
  if (stock === 0) complement.available = false;
  return { complement };
}

function normalizeComplementRuleInput(input = {}, current = {}) {
  const validCategoryIds = new Set((db.menuCategories || []).map((item) => Number(item.id)));
  const validItemIds = new Set((db.menuItems || []).map((item) => Number(item.id)));
  const validComplementIds = new Set((db.menuComplements || []).map((item) => Number(item.id)));
  const ids = (value, valid) => [
    ...new Set(
      (Array.isArray(value) ? value : [])
        .map((v) => Number(normalizeDigits(String(v)).replace(/\D/g, '')))
        .filter((id) => Number.isFinite(id) && valid.has(id))
    ),
  ];
  const rule = {
    ...current,
    name: String(input.name !== undefined ? input.name : current.name || '').trim().slice(0, 120),
    prompt: String(input.prompt !== undefined ? input.prompt : current.prompt || '').trim().slice(0, 180),
    sourceCategoryIds: ids(input.sourceCategoryIds !== undefined ? input.sourceCategoryIds : current.sourceCategoryIds, validCategoryIds),
    sourceItemIds: ids(input.sourceItemIds !== undefined ? input.sourceItemIds : current.sourceItemIds, validItemIds),
    complementIds: ids(input.complementIds !== undefined ? input.complementIds : current.complementIds, validComplementIds),
    active: input.active !== undefined ? input.active !== false : current.active !== false,
  };
  if (!rule.name) return { error: 'نام قانون را وارد کنید' };
  if (!rule.prompt) rule.prompt = 'مکملی برای این سفارش اضافه شود؟';
  if (!rule.sourceCategoryIds.length && !rule.sourceItemIds.length) return { error: 'حداقل یک دسته یا محصول پایه انتخاب کنید' };
  if (!rule.complementIds.length) return { error: 'حداقل یک مکمل انتخاب کنید' };
  return { rule };
}

app.get('/api/admin/menu-engineering', requireCapability('menu.manage'), (req, res) => {
  res.json({
    menuCategories: db.menuCategories || [],
    menuItems: (db.menuItems || []).map(({ id, categoryId, name, img, available }) => ({ id, categoryId, name, img: img || '', available: available !== false })),
    menuComplements: db.menuComplements || [],
    menuComplementRules: db.menuComplementRules || [],
  });
});

app.post('/api/admin/menu-complements', requireCapability('menu.manage'), (req, res) => {
  const normalized = normalizeComplementInput(req.body || {});
  if (normalized.error) return res.status(400).json(normalized);
  const complement = { id: Math.max(0, ...(db.menuComplements || []).map((item) => Number(item.id) || 0)) + 1, ...normalized.complement };
  db.menuComplements.push(complement);
  save({ bumpMenu: true });
  res.status(201).json({ ok: true, complement });
});

app.put('/api/admin/menu-complements/:id', requireCapability('menu.manage'), (req, res) => {
  const targetId = Number(normalizeDigits(String(req.params.id || '')).replace(/\D/g, ''));
  const complement = (db.menuComplements || []).find((item) => Number(item.id) === targetId);
  if (!complement) return res.status(404).json({ error: 'مکمل پیدا نشد' });
  const normalized = normalizeComplementInput(req.body || {}, complement);
  if (normalized.error) return res.status(400).json(normalized);
  Object.assign(complement, normalized.complement);
  save({ bumpMenu: true });
  res.json({ ok: true, complement });
});

app.delete('/api/admin/menu-complements/:id', requireCapability('menu.manage'), (req, res) => {
  const id = Number(normalizeDigits(String(req.params.id || '')).replace(/\D/g, ''));
  if (!(db.menuComplements || []).some((item) => Number(item.id) === id)) return res.status(404).json({ error: 'مکمل پیدا نشد' });
  db.menuComplements = db.menuComplements.filter((item) => Number(item.id) !== id);
  for (const rule of db.menuComplementRules || []) rule.complementIds = (rule.complementIds || []).filter((entry) => Number(entry) !== id);
  db.menuComplementRules = (db.menuComplementRules || []).filter((rule) => (rule.complementIds || []).length);
  save({ bumpMenu: true });
  res.json({ ok: true });
});

app.post('/api/admin/menu-complement-rules', requireCapability('menu.manage'), (req, res) => {
  const normalized = normalizeComplementRuleInput(req.body || {});
  if (normalized.error) return res.status(400).json(normalized);
  const rule = { id: Math.max(0, ...(db.menuComplementRules || []).map((item) => Number(item.id) || 0)) + 1, ...normalized.rule };
  db.menuComplementRules.push(rule);
  save({ bumpMenu: true });
  res.status(201).json({ ok: true, rule });
});

app.put('/api/admin/menu-complement-rules/:id', requireCapability('menu.manage'), (req, res) => {
  const targetId = Number(normalizeDigits(String(req.params.id || '')).replace(/\D/g, ''));
  const rule = (db.menuComplementRules || []).find((item) => Number(item.id) === targetId);
  if (!rule) return res.status(404).json({ error: 'قانون مکمل پیدا نشد' });
  const normalized = normalizeComplementRuleInput(req.body || {}, rule);
  if (normalized.error) return res.status(400).json(normalized);
  Object.assign(rule, normalized.rule);
  save({ bumpMenu: true });
  res.json({ ok: true, rule });
});

app.delete('/api/admin/menu-complement-rules/:id', requireCapability('menu.manage'), (req, res) => {
  const id = Number(normalizeDigits(String(req.params.id || '')).replace(/\D/g, ''));
  if (!(db.menuComplementRules || []).some((item) => Number(item.id) === id)) return res.status(404).json({ error: 'قانون مکمل پیدا نشد' });
  db.menuComplementRules = db.menuComplementRules.filter((item) => Number(item.id) !== id);
  save({ bumpMenu: true });
  res.json({ ok: true });
});

app.get('/api/i18n', (req, res) => {
  res.json({ i18n: db.i18n || { guestLangEnabled: true, defaultLang: 'fa', supported: ['fa', 'en', 'ar'] } });
});

app.get('/api/admin/i18n', requireAdmin, (req, res) => {
  const items = db.menuItems || [];
  const missingEn = items.filter((m) => !String(m.en || '').trim()).length;
  const missingDescEn = items.filter((m) => m.desc && !String(m.descEn || '').trim()).length;
  const missingAr = items.filter((m) => !String(m.ar || '').trim()).length;
  const missingDescAr = items.filter((m) => m.desc && !String(m.descAr || '').trim()).length;
  res.json({
    i18n: db.i18n,
    stats: {
      total: items.length,
      withEn: items.filter((m) => String(m.en || '').trim()).length,
      missingEn,
      missingDescEn,
      withAr: items.filter((m) => String(m.ar || '').trim()).length,
      missingAr,
      missingDescAr,
      engine: translationEngine(),
    },
  });
});

app.put('/api/admin/i18n', requireAdmin, (req, res) => {
  if (!db.i18n) db.i18n = { guestLangEnabled: true, defaultLang: 'fa', supported: ['fa', 'en', 'ar'] };
  if (typeof req.body.guestLangEnabled === 'boolean') db.i18n.guestLangEnabled = req.body.guestLangEnabled;
  if (req.body.defaultLang === 'fa' || req.body.defaultLang === 'en' || req.body.defaultLang === 'ar') {
    db.i18n.defaultLang = req.body.defaultLang;
  }
  db.i18n.supported = ['fa', 'en', 'ar'];
  save();
  res.json({ ok: true, i18n: db.i18n });
});

app.post('/api/admin/translate/menu', requireAdmin, async (req, res) => {
  const force = !!req.body.force;
  const onlyMissing = req.body.onlyMissing !== false;
  const ids = Array.isArray(req.body.ids)
    ? req.body.ids.map((id) => Number(normalizeDigits(String(id)).replace(/\D/g, ''))).filter(Number.isFinite)
    : null;
  const langs = Array.isArray(req.body.langs) && req.body.langs.length
    ? req.body.langs.map(String)
    : ['en', 'ar'];
  let targets = db.menuItems || [];
  if (ids) targets = targets.filter((m) => ids.includes(Number(m.id)));
  if (onlyMissing && !force) {
    targets = targets.filter(
      (m) =>
        !String(m.en || '').trim() ||
        isBrokenEn(m.en) ||
        (m.desc && (!String(m.descEn || '').trim() || isBrokenEn(m.descEn))) ||
        !String(m.ar || '').trim() ||
        (m.desc && !String(m.descAr || '').trim()),
    );
  }
  const updated = [];
  for (const item of targets) {
    const tr = await translateMenuItem(item, { force, langs });
    if (langs.includes('en')) {
      item.en = tr.en;
      item.descEn = tr.descEn;
    }
    if (langs.includes('ar')) {
      item.ar = tr.ar;
      item.descAr = tr.descAr;
    }
    updated.push({
      id: item.id,
      en: item.en,
      descEn: item.descEn,
      ar: item.ar,
      descAr: item.descAr,
      engine: tr.engine,
    });
  }
  save();
  res.json({
    ok: true,
    count: updated.length,
    engine: translationEngine(),
    items: updated,
  });
});

app.post('/api/admin/translate/menu/:id', requireAdmin, async (req, res) => {
  const targetId = Number(normalizeDigits(String(req.params.id || '')).replace(/\D/g, ''));
  const item = (db.menuItems || []).find((m) => Number(m.id) === targetId);
  if (!item) return res.status(404).json({ error: 'not found' });
  const langs = Array.isArray(req.body.langs) && req.body.langs.length
    ? req.body.langs.map(String)
    : ['en', 'ar'];
  const tr = await translateMenuItem(item, { force: !!req.body.force, langs });
  if (langs.includes('en')) {
    item.en = tr.en;
    item.descEn = tr.descEn;
  }
  if (langs.includes('ar')) {
    item.ar = tr.ar;
    item.descAr = tr.descAr;
  }
  save();
  res.json({ ok: true, item, engine: tr.engine });
});

app.get('/api/allergens', (req, res) => {
  res.json({ allergens: ALLERGENS, dayparts: DAYPARTS.map(({ id, label }) => ({ id, label })) });
});

function assertVisibleCategoryCover(cat) {
  if (cat.hiddenOnSite) return null;
  if (!categoryHasCover(cat)) {
    return 'برای نمایش روی صفحه اصلی باید کاور دسته را آپلود کنید';
  }
  return null;
}

/* Category CRUD — register before /api/menu/:id */
app.post('/api/menu/categories', requireAdmin, (req, res) => {
  if (!Array.isArray(db.menuCategories)) db.menuCategories = [];
  const title = String(req.body.title || '').trim().slice(0, 80);
  if (!title) return res.status(400).json({ error: 'عنوان دسته لازم است' });
  const coverRaw = typeof req.body.coverImg === 'string' ? req.body.coverImg : '';
  const coverImg = sanitizeCoverImg(coverRaw);
  if (coverImg === null) {
    return res.status(400).json({ error: 'مسیر کاور نامعتبر است (لیبل نوشیدنی Giro مجاز نیست)' });
  }
  const id = Math.max(0, ...db.menuCategories.map((c) => c.id), 0) + 1;
  const cat = {
    id,
    title,
    name1: String(req.body.name1 || '').trim().slice(0, 80),
    name2: String(req.body.name2 || '').trim().slice(0, 80),
    shortDesc: String(req.body.shortDesc || '').trim().slice(0, 300),
    longDesc: String(req.body.longDesc || '').trim().slice(0, 800),
    hiddenOnSite: req.body.hiddenOnSite === true,
    coverImg,
  };
  const coverErr = assertVisibleCategoryCover(cat);
  if (coverErr) return res.status(400).json({ error: coverErr });
  db.menuCategories.push(cat);
  save({ rebuildProducts: true });
  res.json({ ok: true, category: cat, menuCategories: db.menuCategories, products: db.products });
});

app.put('/api/menu/categories/order', requireAdmin, (req, res) => {
  if (!Array.isArray(db.menuCategories)) db.menuCategories = [];
  const order = Array.isArray(req.body.order) ? req.body.order.map(Number) : [];
  if (!order.length) return res.status(400).json({ error: 'ترتیب نامعتبر است' });
  const byId = Object.fromEntries(db.menuCategories.map((c) => [c.id, c]));
  const next = [];
  for (const id of order) {
    if (byId[id]) {
      next.push(byId[id]);
      delete byId[id];
    }
  }
  for (const c of Object.values(byId)) next.push(c);
  db.menuCategories = next;
  save({ rebuildProducts: true });
  res.json({ ok: true, menuCategories: db.menuCategories, products: db.products });
});

app.put('/api/menu/categories/:id', requireAdmin, (req, res) => {
  if (!Array.isArray(db.menuCategories)) db.menuCategories = [];
  const targetId = Number(normalizeDigits(String(req.params.id || '')).replace(/\D/g, ''));
  const cat = db.menuCategories.find((c) => Number(c.id) === targetId);
  if (!cat) return res.status(404).json({ error: 'دسته پیدا نشد' });
  if (typeof req.body.title === 'string') {
    const title = req.body.title.trim().slice(0, 80);
    if (!title) return res.status(400).json({ error: 'عنوان دسته لازم است' });
    cat.title = title;
    cat.name1 = title;
    cat.name2 = '';
  }
  // Ignore legacy name1/name2 writes — title is the single display field.
  if (typeof req.body.shortDesc === 'string') cat.shortDesc = req.body.shortDesc.trim().slice(0, 300);
  if (typeof req.body.longDesc === 'string') cat.longDesc = req.body.longDesc.trim().slice(0, 800);
  if (typeof req.body.hiddenOnSite === 'boolean') cat.hiddenOnSite = req.body.hiddenOnSite;
  if (typeof req.body.coverImg === 'string') {
    const coverImg = sanitizeCoverImg(req.body.coverImg);
    if (coverImg === null) {
      return res.status(400).json({ error: 'مسیر کاور نامعتبر است (لیبل نوشیدنی Giro مجاز نیست)' });
    }
    cat.coverImg = coverImg;
  }
  const coverErr = assertVisibleCategoryCover(cat);
  if (coverErr) return res.status(400).json({ error: coverErr });
  save({ rebuildProducts: true });
  res.json({ ok: true, category: cat, menuCategories: db.menuCategories, products: db.products });
});

app.delete('/api/menu/categories/:id', requireAdmin, (req, res) => {
  if (!Array.isArray(db.menuCategories)) db.menuCategories = [];
  const id = Number(normalizeDigits(String(req.params.id || '')).replace(/\D/g, ''));
  const cat = db.menuCategories.find((c) => Number(c.id) === id);
  if (!cat) return res.status(404).json({ error: 'دسته پیدا نشد' });
  const inUse = (db.menuItems || []).some((m) => Number(m.categoryId) === id);
  if (inUse) {
    return res.status(400).json({ error: 'ابتدا غذاهای این دسته را جابه‌جا یا حذف کنید' });
  }
  if (db.menuCategories.length <= 1) {
    return res.status(400).json({ error: 'حداقل یک دسته باید باقی بماند' });
  }
  db.menuCategories = db.menuCategories.filter((c) => Number(c.id) !== id);
  save({ rebuildProducts: true });
  res.json({ ok: true, menuCategories: db.menuCategories, products: db.products });
});

app.put('/api/menu/:id', requireAdmin, (req, res) => {
  const targetId = Number(normalizeDigits(String(req.params.id || '')).replace(/\D/g, ''));
  const item = (db.menuItems || []).find((m) => Number(m.id) === targetId);
  if (!item) return res.status(404).json({ error: 'not found' });
  // Simple dirty-lock: reject concurrent price+stock writes with mismatched revisions.
  const clientRev = req.body._rev != null ? Number(req.body._rev) : null;
  const itemRev = Number(item.updatedAt) || 0;
  if (clientRev != null && itemRev && clientRev < itemRev) {
    return res.status(409).json({
      error: 'این غذا هم‌زمان از جای دیگری تغییر کرده — صفحه را تازه کنید',
      item,
    });
  }
  const parseNum = (v) => {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return isNaN(v) ? null : v;
    const n = Number(normalizeDigits(String(v)).replace(/[,٬_\s]/g, '').trim());
    return isNaN(n) ? null : n;
  };
  if (typeof req.body.name === 'string') item.name = req.body.name.trim().slice(0, 120);
  if (typeof req.body.desc === 'string') item.desc = req.body.desc.trim().slice(0, 500);
  if (typeof req.body.en === 'string') item.en = req.body.en.trim().slice(0, 120);
  if (typeof req.body.descEn === 'string') item.descEn = req.body.descEn.trim().slice(0, 500);
  if (typeof req.body.ar === 'string') item.ar = req.body.ar.trim().slice(0, 120);
  if (typeof req.body.descAr === 'string') item.descAr = req.body.descAr.trim().slice(0, 500);
  if (typeof req.body.img === 'string') {
    const img = sanitizeMenuImg(req.body.img);
    if (img === null) return res.status(400).json({ error: 'مسیر تصویر نامعتبر است' });
    item.img = img;
  }
  if (req.body.categoryId != null) {
    const cid = Number(normalizeDigits(String(req.body.categoryId)).replace(/\D/g, ''));
    if ((db.menuCategories || []).some((c) => Number(c.id) === cid)) item.categoryId = cid;
  }
  const rawPrice = parseNum(req.body.price);
  if (rawPrice != null && rawPrice >= 0) item.price = Math.round(rawPrice);
  if (typeof req.body.available === 'boolean') item.available = req.body.available;
  if (Array.isArray(req.body.allergens)) item.allergens = normalizeAllergens(req.body.allergens);
  if (Array.isArray(req.body.dayparts)) item.dayparts = normalizeDayparts(req.body.dayparts);
  if (Array.isArray(req.body.modifierGroups)) item.modifierGroups = normalizeModifierGroups(req.body.modifierGroups, []);
  if (req.body.stock === null || req.body.stock === '') item.stock = null;
  else {
    const rawStock = parseNum(req.body.stock);
    if (rawStock != null && rawStock >= 0) {
      item.stock = Math.round(rawStock);
      if (item.stock === 0) item.available = false;
    }
  }
  const rawLow = parseNum(req.body.lowStockAt);
  if (rawLow != null && rawLow >= 0) {
    item.lowStockAt = Math.round(rawLow);
  }
  item.updatedAt = Date.now();
  save({ rebuildProducts: true });
  res.json({ ok: true, item: menuItemForResponse(item) });
});

app.post('/api/menu', requireAdmin, (req, res) => {
  const id = Math.max(0, ...(db.menuItems || []).map((m) => Number(m.id) || 0)) + 1;
  const parseNum = (v) => {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return isNaN(v) ? null : v;
    const n = Number(normalizeDigits(String(v)).replace(/[,٬_\s]/g, '').trim());
    return isNaN(n) ? null : n;
  };
  const rawStock = parseNum(req.body.stock);
  const stock = rawStock != null && rawStock >= 0 ? Math.round(rawStock) : null;
  const imgRaw = typeof req.body.img === 'string' ? sanitizeMenuImg(req.body.img) : '';
  if (imgRaw === null) return res.status(400).json({ error: 'مسیر تصویر نامعتبر است' });
  const rawCid = req.body.categoryId != null ? Number(normalizeDigits(String(req.body.categoryId)).replace(/\D/g, '')) : null;
  const rawPrice = parseNum(req.body.price);
  const rawLow = parseNum(req.body.lowStockAt);
  const item = {
    id,
    categoryId: rawCid || (db.menuCategories[0] || {}).id || 0,
    name: String(req.body.name || '').trim().slice(0, 120),
    en: String(req.body.en || '').trim().slice(0, 120),
    ar: String(req.body.ar || '').trim().slice(0, 120),
    desc: String(req.body.desc || '').trim().slice(0, 500),
    descEn: String(req.body.descEn || '').trim().slice(0, 500),
    descAr: String(req.body.descAr || '').trim().slice(0, 500),
    price: Math.max(0, Math.round(rawPrice ?? 0)),
    available: req.body.available !== false && stock !== 0,
    allergens: normalizeAllergens(req.body.allergens),
    dayparts: normalizeDayparts(req.body.dayparts),
    stock,
    lowStockAt: rawLow != null && rawLow >= 0 ? Math.round(rawLow) : 5,
  };
  item.modifierGroups = Array.isArray(req.body.modifierGroups)
    ? normalizeModifierGroups(req.body.modifierGroups, [])
    : normalizeModifierGroups(defaultModifierGroupsForItem(item, menuCategoryTitleForItem(item)), []);
  if (imgRaw) item.img = imgRaw;
  if (!item.name) return res.status(400).json({ error: 'نام را وارد کنید' });
  db.menuItems.push(item);
  save({ rebuildProducts: true });
  res.json({ ok: true, item: menuItemForResponse(item) });
});
app.delete('/api/menu/:id', requireAdmin, (req, res) => {
  const targetId = Number(normalizeDigits(String(req.params.id || '')).replace(/\D/g, ''));
  db.menuItems = (db.menuItems || []).filter((m) => Number(m.id) !== targetId);
  save({ rebuildProducts: true });
  res.json({ ok: true });
});

// --- orders ---
function orderLinesFromRequest(rawItems, { allowMenuItemIds = new Set(), allowComplementIds = new Set(), branchId = null } = {}) {
  const items = Array.isArray(rawItems) ? rawItems : [];
  const lines = [];
  let subtotal = 0;
  const requestedMenuQty = new Map();
  const requestedComplementQty = new Map();
  for (const line of items) {
    const menuItemId = Number(line.menuItemId || line.id);
    const menuItem = db.menuItems.find((item) => item.id === menuItemId && (item.available !== false || allowMenuItemIds.has(menuItemId)));
    if (!menuItem || (!allowMenuItemIds.has(menuItemId) && !itemVisibleNow(menuItem))) continue;
    const qty = Math.min(99, Math.max(1, Math.round(Number(line.qty || line.count) || 1)));
    const accumulatedMenuQty = (requestedMenuQty.get(menuItemId) || 0) + qty;
    const v2Availability = branchId ? financeV2.menuItemAvailability(db, menuItem.id, branchId, accumulatedMenuQty) : null;
    if (v2Availability?.tracked) {
      if (!v2Availability.available) {
        const shortage = v2Availability.issues?.find((issue) => issue.code === 'inventory_shortage');
        return { error: shortage?.itemName ? `مواد لازم برای «${menuItem.name}» کافی نیست (ماده: ${shortage.itemName})` : `موجودی مواد لازم برای «${menuItem.name}» کافی نیست` };
      }
    } else if (typeof menuItem.stock === 'number' && menuItem.stock < accumulatedMenuQty) {
      return { error: `موجودی «${menuItem.name}» کافی نیست (باقی‌مانده: ${menuItem.stock})` };
    }
    requestedMenuQty.set(menuItemId, accumulatedMenuQty);
    const price = Math.max(0, Number(menuItem.price) || 0);
    const modifierGroups = effectiveModifierGroupsForItem(menuItem, menuCategoryTitleForItem(menuItem));
    const allowedModifiers = new Map();
    for (const modifierGroup of modifierGroups) {
      for (const option of modifierGroup.options || []) {
        if (option.available === false) continue;
        const canonical = {
          id: option.id,
          groupId: modifierGroup.id,
          groupTitle: modifierGroup.title,
          name: option.name,
          price: Number(option.price || 0),
          selection: modifierGroup.selection,
        };
        allowedModifiers.set(`id:${option.id}`, canonical);
        if (!allowedModifiers.has(`name:${option.name}`)) allowedModifiers.set(`name:${option.name}`, canonical);
      }
    }
    const usedModifierIds = new Set();
    const usedSingleGroups = new Set();
    const modifiers = (Array.isArray(line.modifiers) ? line.modifiers : [])
      .slice(0, 12)
      .map((modifier) => {
        const id = String(modifier?.id || '').trim();
        const name = String(modifier?.name || modifier || '').trim().slice(0, 100);
        return allowedModifiers.get(`id:${id}`) || allowedModifiers.get(`name:${name}`) || null;
      })
      .filter((modifier) => {
        if (!modifier || usedModifierIds.has(modifier.id)) return false;
        if (modifier.selection === 'single' && usedSingleGroups.has(modifier.groupId)) return false;
        usedModifierIds.add(modifier.id);
        if (modifier.selection === 'single') usedSingleGroups.add(modifier.groupId);
        return true;
      })
      .map(({ selection, ...modifier }) => modifier);
    const modifierTotal = modifiers.reduce((sum, modifier) => sum + modifier.price, 0);
    const unitTotal = price + modifierTotal;
    const allowedComplementIds = new Set(complementRulesForMenuItem(menuItem).flatMap((rule) => rule.complementIds || []).map(Number));
    const complementQuantities = new Map();
    for (const entry of (Array.isArray(line.complements) ? line.complements : []).slice(0, 8)) {
      const complementId = Number(entry?.complementId ?? entry?.id);
      if (!allowedComplementIds.has(complementId)) continue;
      const complementQty = Math.min(20, Math.max(1, Math.round(Number(entry?.qty) || 1)));
      complementQuantities.set(complementId, Math.min(20, (complementQuantities.get(complementId) || 0) + complementQty));
    }
    const complements = [];
    for (const [complementId, complementQty] of complementQuantities) {
      const complement = (db.menuComplements || []).find((entry) => Number(entry.id) === complementId && (entry.available !== false || allowComplementIds.has(complementId)));
      if (!complement) continue;
      const accumulatedComplementQty = (requestedComplementQty.get(complementId) || 0) + complementQty;
      if (typeof complement.stock === 'number' && complement.stock < accumulatedComplementQty) {
        return { error: `موجودی مکمل «${complement.name}» کافی نیست (باقی‌مانده: ${complement.stock})` };
      }
      requestedComplementQty.set(complementId, accumulatedComplementQty);
      const complementPrice = Math.max(0, Number(complement.price) || 0);
      complements.push({ id: complement.id, name: complement.name, price: complementPrice, qty: complementQty, img: complement.img || '', lineTotal: complementPrice * complementQty });
    }
    const complementTotal = complements.reduce((sum, complement) => sum + complement.lineTotal, 0);
    const validCourses = ['straight_fire', 'starters', 'entrees', 'dessert'];
    const rawCourse = String(line.course || '').trim().toLowerCase();
    const course = validCourses.includes(rawCourse) ? rawCourse : 'starters';
    const rawCourseStatus = String(line.courseStatus || '').trim().toLowerCase();
    const courseStatus = ['hold', 'fired', 'served'].includes(rawCourseStatus) ? rawCourseStatus : 'fired';
    const firedAt = courseStatus === 'fired' ? (line.firedAt || new Date().toISOString()) : null;

    lines.push({
      menuItemId: menuItem.id,
      name: menuItem.name,
      price,
      qty,
      modifiers,
      complements,
      note: String(line.note || '').trim().slice(0, 180),
      seat: Math.min(99, Math.max(0, Math.round(Number(line.seat) || 0))),
      course,
      courseStatus,
      firedAt,
      unitTotal,
      lineTotal: unitTotal * qty + complementTotal,
    });
    subtotal += unitTotal * qty + complementTotal;
  }
  if (!lines.length) return { error: 'هیچ محصول معتبری در سفارش نیست' };
  return { lines, subtotal };
}


function orderInventorySnapshot() {
  return {
    menu: (db.menuItems || []).map((item) => ({ item, stock: item.stock, available: item.available })),
    complements: (db.menuComplements || []).map((item) => ({ item, stock: item.stock, available: item.available })),
  };
}

function restoreOrderInventorySnapshot(snapshot) {
  for (const entry of [...(snapshot?.menu || []), ...(snapshot?.complements || [])]) {
    entry.item.stock = entry.stock;
    entry.item.available = entry.available;
  }
}

function adjustOrderInventory(lines, direction, branchId = null) {
  for (const line of lines || []) {
    const menuItem = (db.menuItems || []).find((item) => Number(item.id) === Number(line.menuItemId));
    const usesV2 = branchId && menuItem ? financeV2.menuItemUsesInventoryV2(db, menuItem.id, branchId) : false;
    if (menuItem && !usesV2 && typeof menuItem.stock === 'number') {
      menuItem.stock = Math.max(0, menuItem.stock + direction * Number(line.qty || 0));
      if (direction > 0 && menuItem.stock > 0) menuItem.available = true;
      if (direction < 0 && menuItem.stock === 0) menuItem.available = false;
    }
    for (const selected of line.complements || []) {
      const complement = (db.menuComplements || []).find((item) => Number(item.id) === Number(selected.id || selected.complementId));
      if (complement && typeof complement.stock === 'number') {
        complement.stock = Math.max(0, complement.stock + direction * Number(selected.qty || 0));
        if (direction > 0 && complement.stock > 0) complement.available = true;
        if (direction < 0 && complement.stock === 0) complement.available = false;
      }
    }
  }
}

function canonicalTableNo(value) {
  return normalizeDigits(String(value || ''))
    .trim()
    .replace(/^میز\s*/u, '')
    .replace(/\s+/g, '');
}

function tableNoBelongsToTable(tableNo, tableId) {
  const actual = canonicalTableNo(tableNo);
  const target = canonicalTableNo(tableId);
  return Boolean(actual && target && (actual === target || actual.startsWith(`${target}-`)));
}

function tableForBranch(tableNo, branchId) {
  const cleanTable = canonicalTableNo(tableNo);
  return (db.tables || []).find((item) => {
    const itemBranchId = Number(item.branchId || defaultBranch()?.id || 1);
    if (Number(itemBranchId) !== Number(branchId)) return false;
    return canonicalTableNo(item.id) === cleanTable || canonicalTableNo(item.label) === cleanTable;
  }) || null;
}

function activeDineInOrderOnTable(order, tableNo, branchId) {
  if (!order || Number(order.branchId || defaultBranch()?.id || 1) !== Number(branchId)) return false;
  const fulfillment = normalizeFulfillment(order.fulfillment, { tableNo: order.tableNo });
  return fulfillment === 'dine_in'
    && tableNoBelongsToTable(order.tableNo, tableNo)
    && !['done', 'picked_up', 'delivered', 'cancelled'].includes(String(order.status || ''));
}

function nextDineInCheckNo(branchId, tableNo, preferred = '') {
  const normalizedTable = canonicalTableNo(tableNo);
  const baseTable = normalizedTable.replace(/-\d+$/u, '') || normalizedTable;
  const activeOrders = (db.orders || []).filter((order) => activeDineInOrderOnTable(order, baseTable, branchId));
  const used = new Set(activeOrders.flatMap((order) => [canonicalTableNo(order.checkNo), canonicalTableNo(order.tableNo)]).filter(Boolean));
  const requested = canonicalTableNo(preferred);
  const first = requested || baseTable;
  if (first && !used.has(first)) return first;
  let suffix = 2;
  while (used.has(`${baseTable}-${suffix}`)) suffix += 1;
  return `${baseTable}-${suffix}`;
}

function findOrderBranch(input, tableNo, fulfillment) {
  const selected = resolveBranch(input.branchId || input.branch);
  if (fulfillment !== 'dine_in') return selected || defaultBranch();
  const cleanTable = normalizeDigits(String(tableNo || '')).trim();
  const tableKey = canonicalTableNo(cleanTable);
  const table = (db.tables || []).find((item) => canonicalTableNo(item.id) === tableKey || canonicalTableNo(item.label) === tableKey);
  return (table && (db.branches || []).find((branch) => Number(branch.id) === Number(table.branchId))) || selected || defaultBranch();
}

function publicPaymentAttempt(payment) {
  if (!payment) return null;
  return {
    id: payment.id,
    orderId: payment.orderId,
    provider: payment.provider,
    status: payment.status,
    amount: payment.amount,
    createdAt: payment.createdAt,
  };
}

function appendOrderStatus(order, status, actor = null, meta = {}) {
  order.status = status;
  order.statusAt = new Date().toISOString();
  order.statusHistory = Array.isArray(order.statusHistory) ? order.statusHistory : [];
  order.statusHistory.push({
    status,
    at: order.statusAt,
    by: actor ? { phone: actor.phone, role: effectiveRole(actor), name: actor.name || '' } : null,
    meta,
  });
  if (status === 'preparing' && !order.startedAt) order.startedAt = order.statusAt;
  if (status === 'ready') order.readyAt = order.statusAt;
  if (['done', 'picked_up', 'delivered'].includes(status)) order.doneAt = order.statusAt;
}

async function createCheckoutOrder(input, { requireTable = false, requirePhone = true, idempotencyKey = '', actor = null } = {}) {
  const tableNo = normalizeDigits(String(input.tableNo || input.table || '')).trim().slice(0, 20);
  const fulfillment = normalizeFulfillment(input.fulfillment, { tableNo });
  const phone = normalizeDigits(input.phone || '').trim();
  const name = String(input.name || '').trim().slice(0, 100);
  const paymentMethod = input.paymentMethod === 'online' ? 'online' : 'cashier';
  const normalizedKey = String(idempotencyKey || '').trim().slice(0, 160);

  if (paymentMethod === 'online' && !productionPaymentProviderReady()) {
    return { error: 'payment_provider_not_ready', code: 'payment_provider_not_ready', status: 503 };
  }

  if ((requireTable || fulfillment === 'dine_in') && !tableNo) return { error: 'شماره میز را وارد کنید' };
  if ((requirePhone || phone) && !PHONE_RE.test(phone)) return { error: 'شماره موبایل معتبر نیست' };
  if (!Array.isArray(input.items) || !input.items.length) return { error: 'سبد سفارش خالی است' };
  if (normalizedKey && db.checkoutIdempotency?.[normalizedKey]) {
    const saved = db.checkoutIdempotency[normalizedKey];
    const order = (db.orders || []).find((item) => Number(item.id) === Number(saved.orderId));
    const payment = (db.paymentAttempts || []).find((item) => Number(item.id) === Number(saved.paymentAttemptId));
    if (order) return { order, payment, idempotent: true, whatsapp: null };
  }

  const branch = findOrderBranch(input, tableNo, fulfillment);
  if (!branch) return { error: 'شعبه پیدا نشد' };
  const lineResult = orderLinesFromRequest(input.items, { branchId: branch.id });
  if (lineResult.error) return lineResult;
  const zoneId = Number(input.deliveryZoneId || input.zoneId) || null;
  const zone = fulfillment === 'delivery'
    ? (db.deliveryZones || []).find((item) => Number(item.id) === zoneId)
    : null;
  const fulfillmentQuote = quoteFulfillment({
    fulfillment,
    subtotal: lineResult.subtotal,
    zone,
    branchId: branch.id,
  });
  if (!fulfillmentQuote.ok) return { error: fulfillmentQuote.message, code: fulfillmentQuote.code, minimum: fulfillmentQuote.minimum };
  const deliveryAddress = String(input.deliveryAddress || input.address || '').trim().slice(0, 300);
  if (fulfillment === 'delivery' && !deliveryAddress) return { error: 'آدرس تحویل را وارد کنید' };

  // Deduct stock only after every validation and delivery quote has passed.
  for (const line of lineResult.lines) {
    const menuItem = db.menuItems.find((item) => item.id === line.menuItemId);
    const usesV2 = menuItem && financeV2.menuItemUsesInventoryV2(db, menuItem.id, branch.id);
    if (menuItem && !usesV2 && typeof menuItem.stock === 'number') {
      menuItem.stock = Math.max(0, menuItem.stock - line.qty);
      if (menuItem.stock === 0) menuItem.available = false;
    }
    for (const selected of line.complements || []) {
      const complement = (db.menuComplements || []).find((item) => Number(item.id) === Number(selected.id));
      if (complement && typeof complement.stock === 'number') {
        complement.stock = Math.max(0, complement.stock - Number(selected.qty || 0));
        if (complement.stock === 0) complement.available = false;
      }
    }
  }

  const createdAt = new Date().toISOString();

  // Loyalty tier and points redemption calculation
  const customerUser = phone ? (db.users || []).find((u) => u.phone === phone) : null;
  const discountCalc = loyaltyEngine.calculateOrderDiscounts(db, {
    subtotalToman: lineResult.subtotal,
    phone,
    user: customerUser,
    redeemPoints: input.redeemPoints || input.pointsToRedeem || 0,
  });

  const orderDiscount = discountCalc.totalDiscountToman;
  const orderTotal = Math.max(0, lineResult.subtotal + fulfillmentQuote.deliveryFee - orderDiscount);
  const checkNo = fulfillment === 'dine_in'
    ? nextDineInCheckNo(branch.id, tableNo, input.checkNo || tableNo)
    : '';

  if (discountCalc.pointsRedeemed > 0 && customerUser) {
    customerUser.points = Math.max(0, customerUser.points - discountCalc.pointsRedeemed);
    awardLoyaltyPoints(customerUser.phone, -discountCalc.pointsRedeemed, 'redeem_order', {
      discountToman: discountCalc.pointsDiscountToman,
    });
  }

  const order = {
    id: nextId(db.orders),
    orderNo: `W-${String(Date.now()).slice(-6)}-${nextId(db.orders)}`,
    tableNo: fulfillment === 'dine_in' ? tableNo : '',
    checkNo,
    phone,
    name,
    branchId: branch.id,
    fulfillment,
    paymentMethod,
    paymentStatus: paymentMethod === 'online' ? 'pending' : 'unpaid',
    status: initialOrderStatus({ paymentMethod, fulfillment }),
    items: lineResult.lines,
    subtotal: lineResult.subtotal,
    discount: orderDiscount,
    tierDiscountToman: discountCalc.tierDiscountToman,
    pointsRedeemed: discountCalc.pointsRedeemed,
    pointsDiscountToman: discountCalc.pointsDiscountToman,
    loyaltyTier: discountCalc.tier?.id || 'bronze',
    deliveryFee: fulfillmentQuote.deliveryFee,
    total: orderTotal,
    delivery: fulfillment === 'delivery'
      ? {
          zoneId: zone.id,
          zoneName: zone.name,
          address: deliveryAddress,
          instructions: String(input.deliveryInstructions || input.instructions || '').trim().slice(0, 220),
          etaMinutes: fulfillmentQuote.etaMinutes,
          dispatchStatus: 'pending',
        }
      : null,
    note: String(input.note || '').trim().slice(0, 240),
    createdAt,
    statusAt: createdAt,
    statusHistory: [{
      status: initialOrderStatus({ paymentMethod, fulfillment }),
      at: createdAt,
      by: actor ? { phone: actor.phone, role: effectiveRole(actor), name: actor.name || '' } : null,
      meta: actor ? { source: 'staff-pos' } : undefined,
    }],
  };
  db.orders = Array.isArray(db.orders) ? db.orders : [];
  db.orders.unshift(order);
  db.orders = db.orders.slice(0, 500);

  let payment = null;
  if (paymentMethod === 'online') {
    db.paymentAttempts = Array.isArray(db.paymentAttempts) ? db.paymentAttempts : [];
    payment = {
      id: nextId(db.paymentAttempts),
      orderId: order.id,
      branchId: branch.id,
      provider: db.paymentProvider?.provider || 'sandbox',
      mode: db.paymentProvider?.mode || 'sandbox',
      amount: order.total,
      status: 'pending',
      sandboxToken: crypto.randomBytes(18).toString('base64url'),
      createdAt,
      updatedAt: createdAt,
    };
    db.paymentAttempts.unshift(payment);
  }
  if (normalizedKey) {
    db.checkoutIdempotency = db.checkoutIdempotency || {};
    db.checkoutIdempotency[normalizedKey] = { orderId: order.id, paymentAttemptId: payment?.id || null, createdAt };
    const keys = Object.keys(db.checkoutIdempotency);
    if (keys.length > 1000) keys.slice(0, keys.length - 1000).forEach((key) => delete db.checkoutIdempotency[key]);
  }
  const auditEntry = createAuditEntry({
    actor,
    action: 'order.created',
    targetType: 'order',
    targetId: order.id,
    branchId: branch.id,
    meta: { fulfillment, paymentMethod, total: order.total, source: actor ? 'staff-pos' : 'guest' },
  });
  db.auditLog = Array.isArray(db.auditLog) ? db.auditLog : [];
  db.auditLog.unshift(auditEntry);
  db.auditLog = db.auditLog.slice(0, 5000);
  return { order, payment, whatsapp: null };
}

async function createAndPersistCheckoutOrder(input, options = {}, afterCreate = null) {
  const snapshot = snapshotFinanceMutationState();
  let deferredCommit = null;
  let result;
  try {
    result = await createCheckoutOrder(input, options);
    if (result.error) {
      restoreFinanceMutationState(snapshot);
      return result;
    }
    if (!result.idempotent && afterCreate) deferredCommit = await afterCreate(result);
    await persistFinanceMutation(snapshot);
  } catch (error) {
    restoreFinanceMutationState(snapshot);
    throw error;
  }

  // These integrations are post-commit effects. A failed persistence must
  // never leave a live event, NEEM outbox row, or notification for a missing
  // order in the durable store.
  if (!result.idempotent) {
    try {
      publishOperationalEvent('order.created', { orderId: result.order.id, branchId: result.order.branchId, status: result.order.status });
      neemBridge.enqueueOrder(result.order, result.payment);
      if (typeof deferredCommit === 'function') await deferredCommit();
      const notify = await notifyOrderWhatsApp(db, result.order);
      result.whatsapp = notify.skipped ? null : notify;
      await save({ requireDurable: true });
    } catch (error) {
      console.error('[order-post-commit] integration effect failed', error?.message || error);
      result.whatsapp = null;
    }
  }
  return result;
}

function settlePaymentAttempt(payment, { status = 'paid', reference = '', source = 'sandbox' } = {}) {
  if (!payment) return { error: 'payment_not_found' };
  if (!['paid', 'failed', 'cancelled', 'refunded'].includes(status)) return { error: 'payment_status_invalid' };
  const alreadyPaid = payment.status === 'paid' && status === 'paid';
  payment.status = status;
  if (!alreadyPaid || reference) payment.reference = String(reference || payment.reference || '').trim().slice(0, 160);
  if (!alreadyPaid) payment.updatedAt = new Date().toISOString();
  const order = (db.orders || []).find((item) => Number(item.id) === Number(payment.orderId));
  if (status === 'paid' && !order) {
    throw Object.assign(new Error('پرداخت تأیید نشد چون سفارش متناظر یافت نشد.'), {
      code: 'payment_order_not_found',
      status: 409,
    });
  }
  let financeResult = null;
  if (order) {
    order.paymentStatus = status;
    if (status === 'paid' && ['pending_online', 'awaiting_confirmation'].includes(order.status)) {
      appendOrderStatus(order, 'paid', null, { paymentAttemptId: payment.id, source });
    }
    if (status === 'paid') {
      financeResult = financeV2.captureOnlinePaidOrder(db, order, payment, { actor: `gateway:${payment.provider || source}`, occurredAt: payment.updatedAt });
      // A gateway confirmation is not a successful financial capture until
      // the corresponding sale journal is posted.  Finance V2 deliberately
      // returns a blocked event (instead of throwing) when the fiscal period
      // is closed or the sale evidence is incomplete; allowing this payment
      // response through would leave the operational payment marked paid
      // while the official ledger remains empty.  The caller wraps this
      // mutation in a snapshot and will roll back the payment/order on error.
      if (!financeResult?.journalEntry || financeResult.journalEntry.status !== 'posted') {
        const captureCode = financeResult?.event?.error?.code || financeResult?.reason || 'finance_capture_blocked';
        throw Object.assign(new Error('پرداخت تأیید نشد چون سند فروش در دفتر مالی ثبت نشد.'), {
          code: captureCode,
          status: 409,
          details: financeResult?.event?.error || null,
        });
      }
    }
  }
  recordAudit(null, `payment.${status}`, 'payment', payment.id, { orderId: payment.orderId, source }, payment.branchId);
  return { payment, order, finance: financeResult, idempotent: alreadyPaid };
}

function publishPaymentCommitEffects(result, status) {
  if (!result?.payment) return;
  publishOperationalEvent('payment.updated', {
    paymentId: result.payment.id, orderId: result.payment.orderId, branchId: result.payment.branchId, status,
  });
  if (result.order) publishOperationalEvent('order.updated', {
    orderId: result.order.id, branchId: result.order.branchId, status: result.order.status,
  });
  if (result.order) neemBridge.enqueueOrder(result.order, result.payment);
}

app.get('/api/checkout/meta', (req, res) => {
  const branch = resolveBranch(req.query.branchId || req.query.branch);
  const configuredPaymentMode = String(db.paymentProvider?.mode || 'sandbox').toLowerCase();
  const sandboxAvailable = process.env.NODE_ENV !== 'production' && configuredPaymentMode === 'sandbox';
  const paymentReady = sandboxAvailable || productionPaymentProviderReady();
  res.json({
    payment: {
      mode: paymentReady ? configuredPaymentMode : 'unavailable',
      provider: paymentReady ? (db.paymentProvider?.provider || 'sandbox') : null,
      onlineEnabled: db.paymentProvider?.enabled !== false && paymentReady,
    },
    branches: (db.branches || []).filter((item) => item.active !== false).map((item) => ({ id: item.id, slug: item.slug, name: item.name, address: item.address })),
    deliveryZones: (db.deliveryZones || [])
      .filter((item) => item.active !== false && (!branch || Number(item.branchId) === Number(branch.id)))
      .sort((a, b) => Number(a.sort || 0) - Number(b.sort || 0))
      .map((item) => ({ id: item.id, branchId: item.branchId, name: item.name, minOrder: item.minOrder, fee: item.fee, etaMinutes: item.etaMinutes })),
  });
});

app.post('/api/checkout/quote', (req, res) => {
  const lineResult = orderLinesFromRequest(req.body.items);
  if (lineResult.error) return res.status(400).json(lineResult);
  const fulfillment = normalizeFulfillment(req.body.fulfillment, { tableNo: req.body.tableNo });
  const branch = findOrderBranch(req.body, String(req.body.tableNo || '').trim(), fulfillment);
  const zone = fulfillment === 'delivery'
    ? (db.deliveryZones || []).find((item) => Number(item.id) === Number(req.body.deliveryZoneId || req.body.zoneId))
    : null;
  const quote = quoteFulfillment({ fulfillment, subtotal: lineResult.subtotal, zone, branchId: branch?.id });
  if (!quote.ok) return res.status(400).json(quote);

  const phone = normalizeDigits(req.body?.phone || req.user?.phone || '').trim();
  const customerUser = phone ? (db.users || []).find((u) => u.phone === phone) : null;
  const discountCalc = loyaltyEngine.calculateOrderDiscounts(db, {
    subtotalToman: lineResult.subtotal,
    phone,
    user: customerUser,
    redeemPoints: req.body?.redeemPoints || req.body?.pointsToRedeem || 0,
  });

  const finalTotal = Math.max(0, quote.total - discountCalc.totalDiscountToman);

  res.json({
    ok: true,
    subtotal: lineResult.subtotal,
    deliveryFee: quote.deliveryFee,
    discount: discountCalc.totalDiscountToman,
    tierDiscountToman: discountCalc.tierDiscountToman,
    tier: discountCalc.tier,
    pointsRedeemed: discountCalc.pointsRedeemed,
    pointsDiscountToman: discountCalc.pointsDiscountToman,
    maxRedeemablePoints: discountCalc.maxRedeemablePoints,
    availablePoints: discountCalc.availablePoints,
    total: finalTotal,
    minimum: quote.minimum,
    etaMinutes: quote.etaMinutes,
    branchId: branch?.id || null,
  });
});

app.post('/api/checkout/orders', publicOrderMutationGuard('orders.online'), async (req, res) => {
  try {
    const result = await createAndPersistCheckoutOrder(req.body || {}, {
      idempotencyKey: req.get('Idempotency-Key') || req.body?.idempotencyKey,
    });
    if (result.error) return res.status(result.status || 400).json(result);
    res.status(result.idempotent ? 200 : 201).json({
      ok: true,
      idempotent: !!result.idempotent,
      order: result.order,
      payment: result.payment
        ? { ...publicPaymentAttempt(result.payment), sandboxToken: result.payment.mode === 'sandbox' ? result.payment.sandboxToken : undefined }
        : null,
      whatsapp: result.whatsapp,
    });
  } catch (error) {
    return res.status(error.status || 503).json({ error: error.code || error.message });
  }
});

app.post('/api/checkout/payments/:id/sandbox-confirm', sandboxPaymentGuard, async (req, res) => {
  const targetId = Number(normalizeDigits(String(req.params.id || '')).replace(/\D/g, ''));
  const payment = (db.paymentAttempts || []).find((item) => Number(item.id) === targetId);
  if (!payment) return res.status(404).json({ error: 'payment_not_found' });
  if (payment.mode !== 'sandbox') return res.status(409).json({ error: 'sandbox_disabled' });
  if (!req.body?.token || req.body.token !== payment.sandboxToken) return res.status(403).json({ error: 'payment_token_invalid' });
  const snapshot = snapshotFinanceMutationState();
  let result;
  try {
    result = settlePaymentAttempt(payment, { status: 'paid', reference: `sandbox-${payment.id}`, source: 'sandbox-confirm' });
    if (result.error) return res.status(400).json(result);
    await persistFinanceMutation(snapshot);
  } catch (error) {
    restoreFinanceMutationState(snapshot);
    return res.status(error.status || 503).json({ error: error.code || error.message });
  }
  try { publishPaymentCommitEffects(result, 'paid'); } catch (error) { console.error('[payment-post-commit] integration effect failed', error?.message || error); }
  res.json({ ok: true, idempotent: result.idempotent, payment: publicPaymentAttempt(result.payment), order: result.order });
});

app.post('/api/payments/webhook/:provider', async (req, res) => {
  const payment = (db.paymentAttempts || []).find((item) => Number(item.id) === Number(req.body?.paymentAttemptId));
  if (!payment || payment.provider !== String(req.params.provider || '')) return res.status(404).json({ error: 'payment_not_found' });
  const secret = process.env.PAYMENT_WEBHOOK_SECRET;
  const signature = req.get('X-Westo-Payment-Signature');
  const validSandbox = payment.mode === 'sandbox' && req.body?.token === payment.sandboxToken;
  if (!validSandbox && (!secret || signature !== secret)) return res.status(401).json({ error: 'webhook_unauthorized' });
  const snapshot = snapshotFinanceMutationState();
  let result;
  try {
    result = settlePaymentAttempt(payment, {
      status: String(req.body?.status || 'paid'),
      reference: req.body?.reference,
      source: `webhook:${payment.provider}`,
    });
    if (result.error) return res.status(400).json(result);
    await persistFinanceMutation(snapshot);
  } catch (error) {
    restoreFinanceMutationState(snapshot);
    return res.status(error.status || 503).json({ error: error.code || error.message });
  }
  try { publishPaymentCommitEffects(result, result.payment.status); } catch (error) { console.error('[payment-post-commit] integration effect failed', error?.message || error); }
  res.json({ ok: true, idempotent: result.idempotent, payment: publicPaymentAttempt(result.payment), order: result.order });
});

function getOrderStatusFaLabel(status) {
  const map = {
    pending: 'در انتظار تأیید',
    pending_online: 'در انتظار پرداخت آنلاین',
    pending_cashier: 'در انتظار پرداخت صندوق/پیک',
    awaiting_confirmation: 'در انتظار تأیید',
    prep: 'در حال آماده‌سازی',
    preparing: 'در حال پخت و آماده‌سازی',
    kitchen: 'در حال پخت در آشپزخانه',
    ready: 'آماده تحویل',
    delivering: 'در حال ارسال پیک',
    delivered: 'تحویل داده شد',
    picked_up: 'تحویل حضوری شد',
    paid: 'پرداخت و تکمیل‌شده',
    done: 'تکمیل‌شده',
    cancelled: 'لغوشده',
    rejected: 'رد شده',
  };
  return map[String(status || '').toLowerCase()] || 'در جریان';
}

app.get('/api/orders/my-orders', requireAuth, (req, res) => {
  const userPhone = String(req.user?.phone || '').trim();
  const userOrders = (db.orders || [])
    .filter((o) => {
      if (o.userId && req.user?.id && String(o.userId) === String(req.user.id)) return true;
      const p = o.phone || o.userPhone || o.customerPhone || '';
      return phonesMatch(p, userPhone);
    })
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

  const tierInfo = loyaltyEngine.resolveCustomerTier(db, req.user);

  const mapped = userOrders.map((o) => {
    const totalAmount = Number(o.total || o.finalTotal || o.subtotal || 0);
    const calculatedPoints = loyaltyEngine.calculateOrderPointsEarned(db, totalAmount, tierInfo.tier);
    return {
      id: o.id,
      orderNo: o.orderNo || `W-${o.id}`,
      createdAt: o.createdAt || new Date().toISOString(),
      status: o.status || 'paid',
      statusLabel: getOrderStatusFaLabel(o.status),
      fulfillment: o.fulfillment || 'dine_in',
      items: Array.isArray(o.items) ? o.items.map((it) => ({
        id: it.id || it.menuItemId || it.itemId || null,
        menuItemId: it.menuItemId || it.id || it.itemId || null,
        name: it.name || it.title || 'محصول منو',
        quantity: Number(it.quantity || it.qty || 1),
        price: Number(it.price || 0),
        total: Number(it.price || 0) * Number(it.quantity || it.qty || 1),
      })) : [],
      total: totalAmount,
      subtotal: Number(o.subtotal || o.total || 0),
      discount: Number(o.discount || o.loyaltyDiscount || 0),
      pointsEarned: o.pointsEarned !== undefined ? Number(o.pointsEarned) : calculatedPoints,
      paymentMethod: o.paymentMethod || o.tender || (o.paidWithWallet ? 'کیف پول' : 'آنلاین'),
      tableNo: o.tableNo || null,
      delivery: o.delivery || null,
    };
  });

  res.json({ ok: true, orders: mapped });
});

app.get('/api/profile/orders', requireAuth, (req, res, next) => {
  req.url = '/api/orders/my-orders';
  app.handle(req, res, next);
});

// Existing table ordering clients keep their endpoint and response shape.
app.post('/api/orders', publicOrderMutationGuard('orders.pos'), async (req, res) => {
  try {
    const result = await createAndPersistCheckoutOrder(req.body || {}, { requireTable: true });
    if (result.error) return res.status(result.status || 400).json(result);
    res.json({ ok: true, order: result.order, whatsapp: result.whatsapp });
  } catch (error) {
    return res.status(error.status || 503).json({ error: error.code || error.message });
  }
});

app.get('/api/admin/orders', requireCapability('orders.view'), (req, res) => {
  // Owners see a consolidated queue by default. Scoped operators must never
  // fall back to the owner default branch (or receive every branch) when the
  // UI omits branchId; resolve the same effective scope used by reports.
  const requestedBranch = requestBranchValue(req);
  const allowedBranchIds = branchScopeForUser(req.user, { role: effectiveRole(req.user) });
  const branchId = requestedBranch != null
    ? parseBranchId(req)
    : allowedBranchIds === null
      ? null
      : (defaultBranch() && allowedBranchIds.includes(Number(defaultBranch().id))
        ? defaultBranch().id
        : allowedBranchIds[0] || null);
  let orders = (db.orders || []).slice();
  if (branchId != null) orders = orders.filter((o) => Number(o.branchId) === Number(branchId));
  const terminal = new Set(['picked_up', 'delivered', 'done', 'cancelled']);
  orders.sort((a, b) => {
    const aClosed = terminal.has(String(a.status));
    const bClosed = terminal.has(String(b.status));
    if (aClosed !== bClosed) return aClosed ? 1 : -1;
    const at = new Date(a.createdAt || 0).getTime() || 0;
    const bt = new Date(b.createdAt || 0).getTime() || 0;
    return aClosed ? bt - at : at - bt; // oldest actionable first; newest archived first
  });
  res.json({ orders, serverTime: new Date().toISOString() });
});

app.post('/api/staff/orders', requireCapability('orders.create'), async (req, res) => {
  try {
    const result = await createAndPersistCheckoutOrder(req.body || {}, {
      requireTable: String(req.body?.fulfillment || 'dine_in') === 'dine_in',
      requirePhone: false,
      idempotencyKey: req.get('Idempotency-Key') || '',
      actor: req.user,
    }, async ({ order }) => {
      if (req.body?.sendToKitchen && order.paymentMethod !== 'online' && order.status === 'pay_at_cashier') {
        appendOrderStatus(order, 'sent_to_kitchen', req.user, { source: 'staff-pos', paymentStatus: order.paymentStatus });
        recordAudit(req, 'order.sent_to_kitchen', 'order', order.id, { paymentStatus: order.paymentStatus }, order.branchId);
        return () => publishOperationalEvent('order.updated', { orderId: order.id, branchId: order.branchId, status: order.status });
      }
      return null;
    });
    if (result.error) return res.status(400).json(result);
    res.status(201).json({ ok: true, order: result.order });
  } catch (error) {
    return res.status(error.status || 503).json({ error: error.code || error.message });
  }
});

app.patch('/api/cashier/orders/:id', requireCapability('orders.manage'), (req, res) => {
  const targetId = Number(normalizeDigits(String(req.params.id || '')).replace(/\D/g, ''));
  const order = (db.orders || []).find((item) => Number(item.id) === targetId);
  if (!order) return res.status(404).json({ error: 'not found' });
  // This route has no branch in its URL and the body is optional. Resolve the
  // order's canonical branch before exposing or mutating it; otherwise a
  // scoped cashier/manager could edit another branch simply by knowing its id.
  try {
    assertUserBranchAccess(req.user, order.branchId);
  } catch (error) {
    return res.status(error.status || 403).json({ error: error.code || 'branch_access_denied', message: error.message, requestId: req.requestId });
  }
  if (req.body?.branchId && Number(req.body.branchId) !== Number(order.branchId)) {
    return res.status(404).json({ error: 'order_edit_branch_mismatch' });
  }
  if (!canEditOrderBeforeKitchen(order)) {
    return res.status(409).json({ error: 'order_edit_locked', current: order.status, startedAt: order.startedAt || null });
  }

  const snapshot = orderInventorySnapshot();
  const previous = {
    total: Number(order.total || 0),
    subtotal: Number(order.subtotal || 0),
    itemUnits: (order.items || []).reduce((sum, line) => sum + Number(line.qty || 0), 0),
  };
  const existingMenuIds = new Set((order.items || []).map((line) => Number(line.menuItemId)));
  const existingComplementIds = new Set((order.items || []).flatMap((line) => line.complements || []).map((entry) => Number(entry.id || entry.complementId)));

  // Put the order's reservation back temporarily so unchanged items remain
  // valid even when this order consumed the last tracked unit.
  adjustOrderInventory(order.items, 1, order.branchId);
  const normalized = orderLinesFromRequest(req.body?.items, {
    allowMenuItemIds: existingMenuIds,
    allowComplementIds: existingComplementIds,
    branchId: order.branchId,
  });
  if (normalized.error) {
    restoreOrderInventorySnapshot(snapshot);
    return res.status(400).json(normalized);
  }

  const deliveryFee = Math.max(0, Number(order.deliveryFee) || 0);
  const nextTotal = normalized.subtotal + deliveryFee;
  const amountPaid = Math.max(0, Number(order.amountPaid || (order.paymentStatus === 'paid' ? order.total : 0)) || 0);
  if (nextTotal < amountPaid) {
    restoreOrderInventorySnapshot(snapshot);
    return res.status(409).json({ error: 'order_edit_refund_required', amountPaid, nextTotal });
  }
  const nextName = String(req.body?.name ?? order.name ?? '').trim().slice(0, 100);
  const nextPhone = normalizeDigits(req.body?.phone ?? order.phone ?? '').trim().slice(0, 24);
  const nextNote = String(req.body?.note ?? order.note ?? '').trim().slice(0, 240);
  if (nextPhone && !PHONE_RE.test(nextPhone)) {
    restoreOrderInventorySnapshot(snapshot);
    return res.status(400).json({ error: 'شماره موبایل معتبر نیست' });
  }

  adjustOrderInventory(normalized.lines, -1, order.branchId);
  order.items = normalized.lines;
  order.subtotal = normalized.subtotal;
  order.total = nextTotal;
  order.amountPaid = amountPaid;
  order.paymentStatus = amountPaid >= nextTotal && nextTotal > 0 ? 'paid' : amountPaid > 0 ? 'partial' : (order.paymentStatus === 'pending' ? 'pending' : 'unpaid');
  order.name = nextName;
  order.phone = nextPhone;
  order.note = nextNote;
  order.editedAt = new Date().toISOString();
  order.editedBy = { phone: req.user.phone, role: effectiveRole(req.user), name: req.user.name || '' };
  order.editRevision = Math.max(0, Number(order.editRevision) || 0) + 1;
  order.balanceDue = Math.max(0, nextTotal - amountPaid);
  order.editHistory = Array.isArray(order.editHistory) ? order.editHistory : [];
  order.editHistory.push({ at: order.editedAt, by: order.editedBy, before: previous, after: { total: nextTotal, subtotal: normalized.subtotal, itemUnits: normalized.lines.reduce((sum, line) => sum + Number(line.qty || 0), 0) } });
  order.editHistory = order.editHistory.slice(-30);

  if (req.body?.sendToKitchen && order.status === 'pay_at_cashier') {
    appendOrderStatus(order, 'sent_to_kitchen', req.user, { source: 'waiter-pos' });
    recordAudit(req, 'order.sent_to_kitchen', 'order', order.id, { source: 'waiter-pos', paymentStatus: order.paymentStatus }, order.branchId);
  }

  recordAudit(req, 'order.edited_before_kitchen', 'order', order.id, {
    beforeTotal: previous.total,
    afterTotal: nextTotal,
    beforeItemUnits: previous.itemUnits,
    afterItemUnits: normalized.lines.reduce((sum, line) => sum + Number(line.qty || 0), 0),
    paymentStatus: order.paymentStatus,
  }, order.branchId);
  publishOperationalEvent('order.updated', { orderId: order.id, branchId: order.branchId, status: order.status, edited: true });
  save({ bumpMenu: true });
  res.json({ ok: true, order, editable: canEditOrderBeforeKitchen(order) });
});

app.post('/api/cashier/orders/:id/apply-loyalty', requireCapability('orders.manage'), (req, res) => {
  const targetId = Number(normalizeDigits(String(req.params.id || '')).replace(/\D/g, ''));
  const order = (db.orders || []).find((item) => Number(item.id) === targetId);
  if (!order) return res.status(404).json({ error: 'not found' });
  // Loyalty preview/apply returns the order and can mutate its total. It must
  // obey the same branch boundary as settlement and order editing, including
  // when the caller omits a branchId from the optional body.
  try {
    assertUserBranchAccess(req.user, order.branchId);
  } catch (error) {
    return res.status(error.status || 403).json({ error: error.code || 'branch_access_denied', message: error.message, requestId: req.requestId });
  }
  const phone = normalizeDigits(req.body?.phone || order.phone || '').trim();
  const redeemPoints = Number(normalizeDigits(String(req.body?.redeemPoints || '0')).replace(/\D/g, '')) || 0;

  const user = phone ? (db.users || []).find((u) => u.phone === phone) : null;
  const discounts = loyaltyEngine.calculateOrderDiscounts(db, {
    subtotalToman: order.subtotal,
    phone,
    user,
    redeemPoints,
  });

  if (req.body?.apply) {
    if (discounts.pointsRedeemed > 0 && user) {
      user.points = Math.max(0, user.points - discounts.pointsRedeemed);
      awardLoyaltyPoints(user.phone, -discounts.pointsRedeemed, 'redeem_order', {
        orderId: order.id,
        discountToman: discounts.pointsDiscountToman,
      });
    }
    order.phone = phone || order.phone;
    if (user?.name && !order.name) order.name = user.name;
    order.tierDiscountToman = discounts.tierDiscountToman;
    order.pointsRedeemed = discounts.pointsRedeemed;
    order.pointsDiscountToman = discounts.pointsDiscountToman;
    order.loyaltyTier = discounts.tier?.id || 'bronze';
    order.discount = discounts.totalDiscountToman;
    order.total = Math.max(0, Number(order.subtotal || 0) + Number(order.deliveryFee || 0) - order.discount);
    save();
    publishOperationalEvent('order.updated', { orderId: order.id, branchId: order.branchId, status: order.status, edited: true });
  }

  res.json({
    ok: true,
    order,
    discounts,
    customer: user
      ? {
          name: user.name,
          phone: user.phone,
          points: user.points,
          walletBalance: walletEngine.getWalletBalance(db, user.phone),
          tier: discounts.tier,
        }
      : null,
  });
});

const handleSettleOrder = async (req, res, forcedTargetId) => {
  const targetId = forcedTargetId !== undefined ? forcedTargetId : Number(normalizeDigits(String(req.params.id || '')).replace(/\D/g, ''));
  const order = (db.orders || []).find((item) => Number(item.id) === targetId);
  if (!order) return res.status(404).json({ error: 'not found' });
  // The route's request body is optional, so requireCapability cannot infer
  // the branch from it. Resolve access from the order itself before even
  // returning an idempotent response; otherwise a scoped cashier/manager
  // could settle or inspect a paid order belonging to another branch.
  try {
    assertUserBranchAccess(req.user, order.branchId);
  } catch (error) {
    return res.status(error.status || 403).json({ error: error.code || 'branch_access_denied', message: error.message, requestId: req.requestId });
  }
  if (order.paymentStatus === 'paid') return res.json({ ok: true, idempotent: true, order });
  if (!['pay_at_cashier', 'awaiting_confirmation', 'sent_to_kitchen', 'preparing', 'ready'].includes(String(order.status || ''))) {
    return res.status(409).json({ error: 'order_not_payable', current: order.status });
  }
  const tender = String(req.body?.tender || 'cash');
  if (!['cash', 'card', 'manual_card', 'gift_card', 'card_on_file', 'wallet'].includes(tender)) return res.status(400).json({ error: 'tender_invalid' });
  const previousPayments = Array.isArray(order.partialPayments) ? order.partialPayments : [];
  const alreadyPaid = previousPayments.reduce((sum, payment) => sum + Math.max(0, Number(payment.amount) || 0), 0);
  const outstanding = Math.max(0, (Number(order.total) || 0) - alreadyPaid);
  const requestedAmount = Math.min(outstanding, Math.max(1, Math.round(Number(req.body?.paymentAmount) || outstanding)));
  if (!requestedAmount || !outstanding) return res.json({ ok: true, idempotent: true, order });
  const branchId = Number(order.branchId) || defaultBranch()?.id || 1;
  const drawer = tender === 'cash' ? activeCashSession(req.user, branchId) : null;
  if (tender === 'cash' && !drawer) return res.status(409).json({ error: 'cash_drawer_not_open' });
  const amountTendered = tender === 'cash'
    ? Math.round(Number(req.body?.amountTendered) || requestedAmount)
    : requestedAmount;
  if (amountTendered < requestedAmount) return res.status(400).json({ error: 'cash_received_insufficient', minimum: requestedAmount });

  // Snapshot before any tender-side mutation. Wallet payments update the
  // customer balance before the sale journal is attempted; a closed/missing
  // fiscal period or a durable-write failure must roll that debit back along
  // with the order and drawer projection.
  const snapshot = snapshotFinanceMutationState();
  if (tender === 'wallet') {
    if (!order.phone) return res.status(400).json({ error: 'شماره مشتری برای پرداخت از کیف پول الزامی است.' });
    const walletBal = walletEngine.getWalletBalance(db, order.phone);
    if (walletBal < requestedAmount) {
      return res.status(400).json({ error: 'موجودی کیف پول مشتری کافی نیست.', balance: walletBal, required: requestedAmount });
    }
    walletEngine.payFromWallet(db, {
      phone: order.phone,
      amountToman: requestedAmount,
      orderId: order.id,
      actor: req.user.phone || 'cashier',
    });
  }

  try {
  const paymentAt = new Date().toISOString();
  const payment = {
    id: nextId(previousPayments), tender, amount: requestedAmount,
    amountTendered, changeDue: tender === 'cash' ? Math.max(0, amountTendered - requestedAmount) : 0,
    at: paymentAt, by: req.user.phone,
  };
  order.partialPayments = previousPayments;
  order.partialPayments.push(payment);
  order.amountPaid = alreadyPaid + requestedAmount;
  const fullyPaid = order.amountPaid >= Number(order.total || 0);
  if (fullyPaid && ['pay_at_cashier', 'awaiting_confirmation'].includes(String(order.status || ''))) {
    appendOrderStatus(order, 'paid', req.user, { source: 'cashier', tender });
  }
  order.paymentStatus = fullyPaid ? 'paid' : 'partial';
  order.paymentTender = tender;
  order.paymentTenders = [...new Set(order.partialPayments.map((entry) => entry.tender))];
  if (fullyPaid) order.paidAt = paymentAt;
  order.amountTendered = amountTendered;
  order.changeDue = payment.changeDue;
  if (drawer) {
    drawer.movements.unshift({
      id: nextId(drawer.movements),
      type: 'sale',
      amount: requestedAmount,
      orderId: order.id,
      note: `فروش سفارش ${order.orderNo || order.id}`,
      at: order.paidAt,
      by: req.user.phone,
    });
  }
  recordAudit(req, fullyPaid ? 'order.settled' : 'order.partial_payment', 'order', order.id, { tender, paymentAmount: requestedAmount, amountPaid: order.amountPaid, outstanding: Math.max(0, Number(order.total || 0) - order.amountPaid), amountTendered, changeDue: order.changeDue }, branchId);
  const financeResult = fullyPaid
    ? financeV2.capturePaidOrder(db, order, { actor: req.user.phone, idempotencyKey: `order:${order.id}:payment:${order.paymentRevision || order.partialPayments.length}` })
    : null;
  if (fullyPaid) {
    try {
      accountingEngine.syncOrderSalesJournal(db, order);
    } catch (accErr) {
      console.error('[accounting] syncOrderSalesJournal note:', accErr.message);
    }
  }
  if (fullyPaid && (!financeResult?.journalEntry || financeResult.journalEntry.status !== 'posted')) {
    const captureCode = financeResult?.event?.error?.code || 'finance_capture_blocked';
    throw Object.assign(new Error('پرداخت ثبت نشد چون سند فروش در دفتر مالی ثبت نشد.'), {
      code: captureCode,
      status: 409,
      details: financeResult?.event?.error || null,
    });
  }
  await persistFinanceMutation(snapshot);
  publishOperationalEvent('order.updated', { orderId: order.id, branchId, status: order.status });
  res.json({ ok: true, order, drawer: drawer ? { session: drawer, totals: cashSessionTotals(drawer) } : null, finance: financeResult });
  } catch (error) {
    restoreFinanceMutationState(snapshot);
    return res.status(error.status || 503).json({ error: error.code || error.message });
  }
};

app.post('/api/cashier/orders/:id/settle', requireCapability('payments.manage'), async (req, res) => {
  const targetId = Number(normalizeDigits(String(req.params.id || '')).replace(/\D/g, ''));
  return handleSettleOrder(req, res, targetId);
});

app.post('/api/staff/orders/:id/settle', requireCapability('payments.manage'), async (req, res) => {
  const targetId = Number(normalizeDigits(String(req.params.id || '')).replace(/\D/g, ''));
  return handleSettleOrder(req, res, targetId);
});

app.get('/api/cashier/printer', requireCapability('payments.manage'), (req, res) => {
  const branchId = parseBranchId(req) || defaultBranch()?.id || 1;
  const printer = printerForBranch(db, branchId);
  res.json({ ok: true, branchId, printer: publicPrinterConfig(printer), directPrint: true });
});

app.get('/api/cashier/printers/system', requireCapability('payments.manage'), async (req, res) => {
  try {
    const result = await listSystemPrinters();
    return res.json({ ok: true, ...result });
  } catch (error) {
    return res.status(error.status || 502).json({ error: error.code || 'system_printer_discovery_failed', message: error.message });
  }
});

app.put('/api/cashier/printer', requireCapability('payments.manage'), (req, res) => {
  const branchId = parseBranchId(req) || defaultBranch()?.id || 1;
  const current = printerForBranch(db, branchId);
  try {
    const printer = normalizePrinterConfig({ ...(req.body || {}), branchId }, current || { ...DEFAULT_PRINTER_CONFIG, branchId });
    ensurePrintingData(db, branchId);
    const existingIndex = db.printing.printers.findIndex((item) => Number(item.branchId) === Number(branchId));
    if (existingIndex >= 0) db.printing.printers[existingIndex] = printer;
    else db.printing.printers.push(printer);
    db.printing.defaultPrinterId = printer.id;
    recordAudit(req, 'printer.configured', 'printer', printer.id, { transport: printer.transport, host: printer.host, port: printer.port, systemPrinterName: printer.systemPrinterName, protocol: printer.protocol }, branchId);
    save();
    res.json({ ok: true, branchId, printer: publicPrinterConfig(printer), directPrint: true });
  } catch (error) {
    return res.status(error.status || 400).json({ error: error.code || 'printer_config_invalid', message: error.message, field: error.field || null });
  }
});

app.post('/api/cashier/printer/test', requireCapability('payments.manage'), async (req, res) => {
  const branchId = parseBranchId(req) || defaultBranch()?.id || 1;
  const printer = printerForBranch(db, branchId);
  if (!printer) return res.status(409).json({ error: 'printer_not_configured' });
  try {
    const result = req.body?.raster
      ? await printRasterReceipt(req.body.raster, printer)
      : await testPrinter(printer);
    recordAudit(req, 'printer.test_printed', 'printer', printer.id, { transport: printer.transport, host: printer.host, port: printer.port, systemPrinterName: printer.systemPrinterName, bytes: result.bytes }, branchId);
    save();
    return res.json({ ok: true, branchId, printed: true, printer: publicPrinterConfig(printer), result });
  } catch (error) {
    recordAudit(req, 'printer.test_failed', 'printer', printer.id, { transport: printer.transport, host: printer.host, port: printer.port, systemPrinterName: printer.systemPrinterName, error: error.code || error.message }, branchId);
    save();
    return res.status(error.status || 502).json({ error: error.code || 'printer_unreachable', message: error.message, printer: publicPrinterConfig(printer) });
  }
});

app.post('/api/cashier/orders/:id/print', requireCapability('payments.manage'), async (req, res) => {
  const targetId = Number(normalizeDigits(String(req.params.id || '')).replace(/\D/g, ''));
  const order = (db.orders || []).find((item) => Number(item.id) === targetId);
  if (!order) return res.status(404).json({ error: 'not found' });
  const branchId = Number(order.branchId) || defaultBranch()?.id || 1;
  try {
    assertUserBranchAccess(req.user, branchId);
  } catch (error) {
    return res.status(error.status || 403).json({ error: error.code || 'branch_access_denied', message: error.message });
  }
  const printer = printerForBranch(db, branchId, req.body?.printerId);
  if (!printer) return res.status(409).json({ error: 'printer_not_configured' });
  try {
    const result = req.body?.raster
      ? await printRasterReceipt(req.body.raster, printer)
      : await sendOrderToPrinter(order, printer, { restaurantName: db.restaurant?.name || 'وستو' });
    const printedAt = new Date().toISOString();
    order.lastPrint = { status: 'printed', printerId: printer.id, printedAt, by: req.user.phone };
    recordAudit(req, 'order.printed', 'order', order.id, { printerId: printer.id, host: printer.host, port: printer.port, bytes: result.bytes, paid: order.paymentStatus === 'paid' }, branchId);
    save();
    return res.json({ ok: true, printed: true, printer: publicPrinterConfig(printer), result, order });
  } catch (error) {
    order.lastPrint = { status: 'failed', printerId: printer.id, printedAt: new Date().toISOString(), by: req.user.phone, error: error.code || error.message };
    recordAudit(req, 'order.print_failed', 'order', order.id, { printerId: printer.id, host: printer.host, port: printer.port, error: error.code || error.message }, branchId);
    save();
    return res.status(error.status || 502).json({ error: error.code || 'printer_unreachable', message: error.message, printer: publicPrinterConfig(printer) });
  }
});

app.post('/api/cashier/orders/:id/receipt', requireCapability('payments.manage'), async (req, res) => {
  const targetId = Number(normalizeDigits(String(req.params.id || '')).replace(/\D/g, ''));
  const order = (db.orders || []).find((item) => Number(item.id) === targetId);
  if (!order) return res.status(404).json({ error: 'not found' });
  if (order.paymentStatus !== 'paid') return res.status(409).json({ error: 'order_not_paid' });
  const method = String(req.body?.method || 'none');
  if (!['print', 'email', 'sms', 'none'].includes(method)) return res.status(400).json({ error: 'receipt_method_invalid' });
  const branchId = Number(order.branchId) || defaultBranch()?.id || 1;
  try {
    assertUserBranchAccess(req.user, branchId);
  } catch (error) {
    return res.status(error.status || 403).json({ error: error.code || 'branch_access_denied', message: error.message });
  }
  if (method === 'print') {
    const printer = printerForBranch(db, branchId, req.body?.printerId);
    if (!printer) return res.status(409).json({ error: 'printer_not_configured' });
    try {
      const result = req.body?.raster
        ? await printRasterReceipt(req.body.raster, printer)
        : await sendOrderToPrinter(order, printer, { restaurantName: db.restaurant?.name || 'وستو' });
      const printedAt = new Date().toISOString();
      order.receipt = {
        method,
        status: 'printed',
        printerId: printer.id,
        printedAt,
        selectedAt: printedAt,
        by: req.user.phone,
      };
      order.lastPrint = { status: 'printed', printerId: printer.id, printedAt, by: req.user.phone };
      recordAudit(req, 'order.receipt_printed', 'order', order.id, { method, printerId: printer.id, host: printer.host, port: printer.port, bytes: result.bytes }, branchId);
      save();
      return res.json({ ok: true, order, printed: true, deliveryConfigured: true, printer: publicPrinterConfig(printer), result });
    } catch (error) {
      order.receipt = {
        method,
        status: 'failed',
        printerId: printer.id,
        selectedAt: new Date().toISOString(),
        by: req.user.phone,
        error: error.code || error.message,
      };
      recordAudit(req, 'order.receipt_print_failed', 'order', order.id, { method, printerId: printer.id, host: printer.host, port: printer.port, error: error.code || error.message }, branchId);
      save();
      return res.status(error.status || 502).json({ error: error.code || 'printer_unreachable', message: error.message, printer: publicPrinterConfig(printer) });
    }
  }
  order.receipt = {
    method,
    status: 'selected',
    destination: String(req.body?.destination || '').trim().slice(0, 180),
    selectedAt: new Date().toISOString(),
    by: req.user.phone,
  };
  recordAudit(req, 'order.receipt_selected', 'order', order.id, { method }, order.branchId);
  save();
  res.json({ ok: true, order, deliveryConfigured: method === 'none' });
});

app.patch('/api/cashier/orders/:id/status', requireCapability('orders.manage'), (req, res) => {
  const targetId = Number(normalizeDigits(String(req.params.id || '')).replace(/\D/g, ''));
  const order = (db.orders || []).find((item) => Number(item.id) === targetId);
  if (!order) return res.status(404).json({ error: 'not found' });
  try {
    assertUserBranchAccess(req.user, order.branchId);
  } catch (error) {
    return res.status(error.status || 403).json({ error: error.code || 'branch_access_denied', message: error.message, requestId: req.requestId });
  }
  const next = String(req.body?.status || '');
  const allowed = {
    pay_at_cashier: ['cancelled'],
    awaiting_confirmation: ['cancelled'],
    ready: order.fulfillment === 'delivery' ? ['dispatched'] : order.fulfillment === 'pickup' ? ['picked_up'] : ['done'],
    dispatched: ['delivered'],
  }[String(order.status || '')] || [];
  if (!allowed.includes(next)) return res.status(409).json({ error: 'cashier_transition_invalid', current: order.status, allowed });
  appendOrderStatus(order, next, req.user, { source: 'cashier' });
  if (['done', 'picked_up', 'delivered'].includes(next)) maybeAwardOrderLoyalty(order);
  recordAudit(req, 'order.status_changed', 'order', order.id, { status: next, source: 'cashier' }, order.branchId);
  publishOperationalEvent('order.updated', { orderId: order.id, branchId: order.branchId, status: next });
  save();
  res.json({ ok: true, order });
});

app.get('/api/waiter/calls', requireCapability('service.manage'), (req, res) => {
  const branchId = parseBranchId(req);
  const calls = branchScoped(db.waiterCalls || [], branchId)
    .filter((call) => call.status === 'open' || call.status === 'new')
    .slice(0, 80);
  res.json({ calls, serverTime: new Date().toISOString() });
});

app.patch('/api/waiter/calls/:id', requireCapability('service.manage'), (req, res) => {
  const targetId = Number(normalizeDigits(String(req.params.id || '')).replace(/\D/g, ''));
  const call = (db.waiterCalls || []).find((item) => Number(item.id) === targetId);
  if (!call) return res.status(404).json({ error: 'not found' });
  try {
    assertUserBranchAccess(req.user, call.branchId);
  } catch (error) {
    return res.status(error.status || 403).json({ error: error.code || 'branch_access_denied', message: error.message, requestId: req.requestId });
  }
  if (String(req.body?.status || '') !== 'done') return res.status(400).json({ error: 'call_status_invalid' });
  call.status = 'done';
  call.resolvedAt = new Date().toISOString();
  call.resolvedBy = req.user.phone;
  recordAudit(req, 'waiter_call.resolved', 'waiter_call', call.id, { tableNo: call.tableNo }, call.branchId);
  publishOperationalEvent('waiter_call.updated', { callId: call.id, branchId: call.branchId, status: call.status });
  save();
  res.json({ ok: true, call });
});

app.patch('/api/waiter/orders/:id/status', requireCapability('service.manage'), (req, res) => {
  const targetId = Number(normalizeDigits(String(req.params.id || '')).replace(/\D/g, ''));
  const order = (db.orders || []).find((item) => Number(item.id) === targetId);
  if (!order) return res.status(404).json({ error: 'not found' });
  try {
    assertUserBranchAccess(req.user, order.branchId);
  } catch (error) {
    return res.status(error.status || 403).json({ error: error.code || 'branch_access_denied', message: error.message, requestId: req.requestId });
  }
  const next = String(req.body?.status || '');
  const allowed = order.fulfillment === 'dine_in' && order.status === 'ready' ? ['done'] : [];
  if (!allowed.includes(next)) return res.status(409).json({ error: 'waiter_transition_invalid', current: order.status, allowed });
  appendOrderStatus(order, next, req.user, { source: 'waiter' });
  maybeAwardOrderLoyalty(order);
  recordAudit(req, 'order.status_changed', 'order', order.id, { status: next, source: 'waiter' }, order.branchId);
  publishOperationalEvent('order.updated', { orderId: order.id, branchId: order.branchId, status: next });
  save();
  res.json({ ok: true, order });
});

// Walk-in reception is deliberately separate from timed reservation editing.
// A waiter may receive a phone number and later seat the guest, but cannot
// alter an online booking or claim a table without a server-side check.
function publicWaitlistEntry(entry) {
  return {
    ...entry,
    statusLabel: ({ waiting: 'در انتظار', called: 'در حال فراخوانی', seated: 'نشسته', left: 'خارج شد', cancelled: 'لغو شد' })[entry.status] || entry.status,
  };
}

function waitlistForBranch(branchId, includeHistory = true) {
  const entries = waitlist.listWaitlist(db.reservations || [], branchId, { includeTerminal: includeHistory, limit: 120 });
  let position = 0;
  return entries.map((entry) => publicWaitlistEntry({
    ...entry,
    position: waitlist.isActive(entry) && entry.status !== 'seated' ? ++position : null,
  }));
}

app.get('/api/waiter/waitlist', requireCapability('reservations.receive'), (req, res) => {
  const branchId = parseBranchId(req);
  const entries = waitlistForBranch(branchId, String(req.query.history || '') === '1');
  const active = entries.filter((entry) => waitlist.ACTIVE_WAITLIST_STATUSES.has(entry.status));
  res.json({
    waitlist: entries,
    summary: {
      waiting: active.filter((entry) => entry.status === 'waiting').length,
      called: active.filter((entry) => entry.status === 'called').length,
      seated: active.filter((entry) => entry.status === 'seated').length,
      total: active.length,
    },
    serverTime: new Date().toISOString(),
  });
});

app.post('/api/waiter/waitlist', requireCapability('reservations.receive'), (req, res) => {
  const branchId = parseBranchId(req);
  if (!branchId) return res.status(400).json({ error: 'waitlist_branch_required', message: 'شعبهٔ فعال مشخص نیست.' });
  db.reservations = Array.isArray(db.reservations) ? db.reservations : [];
  try {
    const result = waitlist.createWaitlistEntry({
      records: db.reservations,
      branchId,
      phone: normalizeDigits(req.body?.phone || '').trim(),
      name: req.body?.name,
      partySize: req.body?.partySize == null || String(req.body.partySize).trim() === '' ? null : normalizeDigits(req.body.partySize),
      note: req.body?.note,
      idempotencyKey: req.get('Idempotency-Key') || req.body?.idempotencyKey,
      phoneRe: PHONE_RE,
      nextId: (rows) => Math.max(0, ...rows.map((row) => Number(row.id) || 0), 0) + 1,
      maxParty: db.reservationSettings?.maxParty || 40,
    });
    if (!result.idempotentReplay) {
      recordAudit(req, 'waitlist.created', 'reservation', result.entry.id, { phone: result.entry.phone, partySize: result.entry.partySize }, branchId);
      publishOperationalEvent('waitlist.created', { waitlistId: result.entry.id, branchId, status: result.entry.status });
      save();
    }
    return res.status(result.idempotentReplay ? 200 : 201).json({ ok: true, idempotent: result.idempotentReplay, entry: publicWaitlistEntry(result.entry) });
  } catch (error) {
    return res.status(error.status || 400).json({ error: error.code || 'waitlist_create_failed', message: error.message, entry: error.entry ? publicWaitlistEntry(error.entry) : undefined });
  }
});

app.patch('/api/waiter/waitlist/:id', requireCapability('reservations.receive'), (req, res) => {
  const targetId = Number(normalizeDigits(String(req.params.id || '')).replace(/\D/g, ''));
  const entry = (db.reservations || []).find((item) => Number(item.id) === targetId && waitlist.isWaitlist(item));
  if (!entry) return res.status(404).json({ error: 'waitlist_not_found', message: 'مهمان موردنظر در صف پیدا نشد.' });
  try { assertUserBranchAccess(req.user, entry.branchId); } catch (error) {
    return res.status(error.status || 403).json({ error: error.code || 'branch_access_denied', message: error.message, requestId: req.requestId });
  }
  const nextStatus = String(req.body?.status || '').trim();
  if (!waitlist.WAITLIST_STATUSES.has(nextStatus) || !waitlist.canTransition(entry.status, nextStatus)) {
    return res.status(409).json({ error: 'waitlist_transition_invalid', message: 'این تغییر وضعیت برای مهمان ممکن نیست.', current: entry.status });
  }
  const hasPartySize = req.body?.partySize != null && String(req.body.partySize).trim() !== '';
  const party = !hasPartySize ? entry.partySize : waitlist.normalizePartySize(normalizeDigits(req.body.partySize), db.reservationSettings?.maxParty || 40);
  if (hasPartySize && party == null) return res.status(400).json({ error: 'waitlist_party_invalid', message: 'تعداد مهمان باید حداقل یک نفر باشد.' });
  if (typeof req.body?.name === 'string') entry.name = req.body.name.trim().slice(0, 80);
  if (typeof req.body?.note === 'string') entry.note = req.body.note.trim().slice(0, 200);
  if (hasPartySize) entry.partySize = party;

  if (nextStatus === 'seated') {
    const tableNo = String(normalizeDigits(req.body?.tableNo || '')).replace(/\D/g, '');
    const table = (db.tables || []).find((item) => Number(item.branchId) === Number(entry.branchId) && String(item.id) === tableNo);
    if (!table || table.active === false) return res.status(409).json({ error: 'waitlist_table_invalid', message: 'میز انتخاب‌شده در این شعبه فعال نیست.' });
    const partySize = Number(entry.partySize || 0);
    if (partySize && Number(table.seats || 0) && partySize > Number(table.seats)) return res.status(409).json({ error: 'waitlist_table_capacity', message: 'ظرفیت این میز برای تعداد مهمان کافی نیست.' });
    const tableBusy = (db.orders || []).some((order) => Number(order.branchId) === Number(entry.branchId) && String(order.tableNo || '') === tableNo && !['done', 'cancelled', 'picked_up', 'delivered'].includes(String(order.status || '')));
    const anotherSeated = (db.reservations || []).some((item) => item !== entry && Number(item.branchId) === Number(entry.branchId) && String(item.tableNo || '') === tableNo && ((waitlist.isWaitlist(item) && item.status === 'seated') || (!waitlist.isWaitlist(item) && ['pending', 'confirmed', 'seated'].includes(item.status))));
    if (tableBusy || anotherSeated) return res.status(409).json({ error: 'waitlist_table_busy', message: 'این میز همین حالا در اختیار مهمان یا سفارش دیگری است.' });
    entry.tableNo = tableNo;
    entry.seatedAt = new Date().toISOString();
  }
  if (nextStatus === 'left' && entry.status === 'seated') entry.leftAt = new Date().toISOString();
  if (nextStatus === 'waiting' || nextStatus === 'called') entry.tableNo = null;
  entry.status = nextStatus;
  entry.statusAt = new Date().toISOString();
  recordAudit(req, 'waitlist.updated', 'reservation', entry.id, { status: entry.status, tableNo: entry.tableNo || null }, entry.branchId);
  publishOperationalEvent('waitlist.updated', { waitlistId: entry.id, branchId: entry.branchId, status: entry.status, tableNo: entry.tableNo || null });
  save();
  res.json({ ok: true, entry: publicWaitlistEntry(entry) });
});

app.patch('/api/waiter/orders/:id/fire-course', requireCapability('orders.course.manage'), async (req, res) => {
  const targetId = Number(normalizeDigits(String(req.params.id || '')).replace(/\D/g, ''));
  const order = (db.orders || []).find((item) => Number(item.id) === targetId);
  if (!order) return res.status(404).json({ error: 'not found' });
  try {
    assertUserBranchAccess(req.user, order.branchId);
  } catch (error) {
    return res.status(error.status || 403).json({ error: error.code || 'branch_access_denied', message: error.message, requestId: req.requestId });
  }
  const course = String(req.body?.course || '').trim().toLowerCase();
  if (!course) return res.status(400).json({ error: 'course_required' });
  const now = new Date().toISOString();
  let firedCount = 0;
  (order.items || []).forEach((item) => {
    if (String(item.course || '').toLowerCase() === course && item.courseStatus === 'hold') {
      item.courseStatus = 'fired';
      item.firedAt = now;
      firedCount++;
    }
  });
  if (firedCount > 0 && order.status === 'pay_at_cashier') {
    appendOrderStatus(order, 'sent_to_kitchen', req.user, { source: 'waiter-fire', course });
  }
  recordAudit(req, 'order.course_fired', 'order', order.id, { course, firedCount }, order.branchId);
  await save();
  publishOperationalEvent('order.updated', { orderId: order.id, branchId: order.branchId, status: order.status, courseFired: course });
  res.json({ ok: true, order, firedCount, course });
});

app.post('/api/waiter/orders/:id/split', requireCapability('orders.split'), async (req, res) => {
  const targetId = Number(normalizeDigits(String(req.params.id || '')).replace(/\D/g, ''));
  const order = (db.orders || []).find((item) => Number(item.id) === targetId);
  if (!order) return res.status(404).json({ error: 'not found' });
  try {
    assertUserBranchAccess(req.user, order.branchId);
  } catch (error) {
    return res.status(error.status || 403).json({ error: error.code || 'branch_access_denied', message: error.message, requestId: req.requestId });
  }
  if (order.paymentStatus === 'paid' || order.status === 'paid' || Number(order.amountPaid || 0) > 0) {
    return res.status(409).json({ error: 'order_split_locked', message: 'پس از ثبت پرداخت، تفکیک فاکتور ممکن نیست؛ ابتدا اصلاح مالی را از صندوق انجام دهید.' });
  }
  if (!Array.isArray(order.items) || order.items.length <= 1) {
    return res.status(400).json({ error: 'cannot_split_single_item_order' });
  }
  const splitMode = req.body?.mode || 'seat';
  if (!['seat', 'items'].includes(splitMode)) {
    return res.status(400).json({ error: 'split_mode_invalid' });
  }
  const targetSeat = Number(req.body?.seat || 0);
  const selectedItemIndices = Array.isArray(req.body?.itemIndices)
    ? [...new Set(req.body.itemIndices.map(Number).filter((index) => Number.isInteger(index) && index >= 0 && index < order.items.length))]
    : [];

  const splitItems = [];
  const remainingItems = [];

  order.items.forEach((item, idx) => {
    let shouldMove = false;
    if (splitMode === 'seat' && targetSeat > 0) {
      shouldMove = Number(item.seat) === targetSeat;
    } else if (splitMode === 'items') {
      shouldMove = selectedItemIndices.includes(idx);
    }
    if (shouldMove) splitItems.push(item);
    else remainingItems.push(item);
  });

  if (!splitItems.length || !remainingItems.length) {
    return res.status(400).json({ error: 'split_must_leave_items_in_both_orders' });
  }

  order.items = remainingItems;
  order.subtotal = remainingItems.reduce((sum, item) => sum + (Number(item.lineTotal) || Number(item.price) * Number(item.qty)), 0);
  order.total = Math.max(0, order.subtotal - Number(order.discount || 0));
  order.balanceDue = order.total;
  order.splitCount = Math.max(0, Number(order.splitCount) || 0) + 1;

  const newSubId = nextId(db.orders);
  const baseTable = canonicalTableNo(order.tableNo).replace(/-\d+$/u, '') || String(order.tableNo || '').trim();
  const subTableNo = nextDineInCheckNo(order.branchId, baseTable, `${baseTable}-2`);
  const subOrder = {
    ...JSON.parse(JSON.stringify(order)),
    id: newSubId,
    orderNo: `W-${String(Date.now()).slice(-6)}-${newSubId}`,
    tableNo: subTableNo,
    checkNo: subTableNo,
    items: splitItems,
    subtotal: splitItems.reduce((sum, item) => sum + (Number(item.lineTotal) || Number(item.price) * Number(item.qty)), 0),
    discount: 0,
    total: splitItems.reduce((sum, item) => sum + (Number(item.lineTotal) || Number(item.price) * Number(item.qty)), 0),
    checkNo: subTableNo,
    createdAt: new Date().toISOString(),
    statusAt: new Date().toISOString(),
    paymentStatus: 'unpaid',
    amountPaid: 0,
    partialPayments: [],
    balanceDue: splitItems.reduce((sum, item) => sum + (Number(item.lineTotal) || Number(item.price) * Number(item.qty)), 0),
    splitFromOrderId: order.id,
    splitMode,
    splitSeat: splitMode === 'seat' ? targetSeat : null,
    splitItemIndices: splitMode === 'items' ? selectedItemIndices : [],
    splitAt: new Date().toISOString(),
  };
  db.orders.unshift(subOrder);

  recordAudit(req, 'order.split', 'order', order.id, { newOrderId: subOrder.id, subTableNo }, order.branchId);
  await save();
  publishOperationalEvent('order.created', { orderId: subOrder.id, branchId: subOrder.branchId, status: subOrder.status });
  publishOperationalEvent('order.updated', { orderId: order.id, branchId: order.branchId, status: order.status });
  res.json({ ok: true, primaryOrder: order, splitOrder: subOrder });
});

app.patch('/api/waiter/orders/:id/move-table', requireCapability('orders.move_table'), async (req, res) => {
  const targetId = Number(normalizeDigits(String(req.params.id || '')).replace(/\D/g, ''));
  const order = (db.orders || []).find((item) => Number(item.id) === targetId);
  if (!order) return res.status(404).json({ error: 'not found' });
  try {
    assertUserBranchAccess(req.user, order.branchId);
  } catch (error) {
    return res.status(error.status || 403).json({ error: error.code || 'branch_access_denied', message: error.message, requestId: req.requestId });
  }
  const nextTable = String(req.body?.tableNo || '').trim();
  if (!nextTable) return res.status(400).json({ error: 'table_required' });
  const branchId = Number(order.branchId) || defaultBranch()?.id || 1;
  const targetTable = tableForBranch(nextTable, branchId);
  if (!targetTable) return res.status(404).json({ error: 'table_not_found', message: 'میز مقصد در شعبهٔ فعال پیدا نشد.' });
  if (targetTable.active === false) return res.status(409).json({ error: 'table_inactive', message: 'میز مقصد غیرفعال است.' });
  const oldTable = order.tableNo;
  if (tableNoBelongsToTable(oldTable, targetTable.id)) {
    return res.json({ ok: true, idempotent: true, order, oldTable, nextTable: oldTable });
  }
  const occupied = (db.orders || []).some((candidate) => Number(candidate.id) !== Number(order.id)
    && activeDineInOrderOnTable(candidate, targetTable.id, branchId));
  if (occupied) return res.status(409).json({ error: 'table_occupied', message: 'میز مقصد در حال سرویس است؛ میز دیگری انتخاب کنید.' });
  const assignedTable = String(targetTable.id);
  order.tableNo = assignedTable;
  order.checkNo = nextDineInCheckNo(branchId, assignedTable, assignedTable);
  recordAudit(req, 'order.table_moved', 'order', order.id, { oldTable, nextTable }, order.branchId);
  await save();
  publishOperationalEvent('order.updated', { orderId: order.id, branchId: order.branchId, tableNo: nextTable });
  res.json({ ok: true, order, oldTable, nextTable });
});


function cleanDeliveryZone(input, current = {}) {
  const branch = resolveBranch(input.branchId ?? current.branchId);
  const parseNum = (v, fb) => {
    if (v == null) return fb;
    if (typeof v === 'number') return isNaN(v) ? fb : v;
    const s = String(v)
      .replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d))
      .replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))
      .replace(/[,٬_\s]/g, '')
      .trim();
    const n = Number(s);
    return isNaN(n) ? fb : n;
  };
  return {
    id: current.id || nextId(db.deliveryZones),
    branchId: branch?.id || Number(current.branchId) || defaultBranch()?.id || 1,
    name: String(input.name ?? current.name ?? '').trim().slice(0, 100),
    active: typeof input.active === 'boolean' ? input.active : current.active !== false,
    minOrder: Math.max(0, Math.round(parseNum(input.minOrder ?? current.minOrder, 0))),
    fee: Math.max(0, Math.round(parseNum(input.fee ?? current.fee, 0))),
    etaMinutes: Math.max(0, Math.min(240, Math.round(parseNum(input.etaMinutes ?? current.etaMinutes, 0)))),
    sort: Math.max(0, Math.round(parseNum(input.sort ?? current.sort, 0))),
  };
}

app.get('/api/admin/delivery-zones', requireCapability('delivery.view'), (req, res) => {
  const branchId = parseBranchId(req);
  res.json({ zones: branchScoped(db.deliveryZones || [], branchId).sort((a, b) => Number(a.sort || 0) - Number(b.sort || 0)) });
});

app.post('/api/admin/delivery-zones', requireCapability('delivery.manage'), (req, res) => {
  const zone = cleanDeliveryZone(req.body || {});
  if (!zone.name) return res.status(400).json({ error: 'نام محدوده لازم است' });
  db.deliveryZones = Array.isArray(db.deliveryZones) ? db.deliveryZones : [];
  db.deliveryZones.push(zone);
  recordAudit(req, 'delivery_zone.created', 'delivery_zone', zone.id, { name: zone.name }, zone.branchId);
  publishOperationalEvent('delivery_zone.updated', { zoneId: zone.id, branchId: zone.branchId });
  save();
  res.status(201).json({ ok: true, zone });
});

app.patch('/api/admin/delivery-zones/:id', requireCapability('delivery.manage'), (req, res) => {
  const targetId = Number(normalizeDigits(String(req.params.id || '')).replace(/\D/g, ''));
  const current = (db.deliveryZones || []).find((item) => Number(item.id) === targetId);
  if (!current) return res.status(404).json({ error: 'not found' });
  const zone = cleanDeliveryZone(req.body || {}, current);
  if (!zone.name) return res.status(400).json({ error: 'نام محدوده لازم است' });
  Object.assign(current, zone);
  recordAudit(req, 'delivery_zone.updated', 'delivery_zone', current.id, { name: current.name }, current.branchId);
  publishOperationalEvent('delivery_zone.updated', { zoneId: current.id, branchId: current.branchId });
  save();
  res.json({ ok: true, zone: current });
});

app.delete('/api/admin/delivery-zones/:id', requireCapability('delivery.manage'), (req, res) => {
  const targetId = Number(normalizeDigits(String(req.params.id || '')).replace(/\D/g, ''));
  const zone = (db.deliveryZones || []).find((item) => Number(item.id) === targetId);
  if (!zone) return res.status(404).json({ error: 'not found' });
  db.deliveryZones = db.deliveryZones.filter((item) => Number(item.id) !== Number(zone.id));
  recordAudit(req, 'delivery_zone.deleted', 'delivery_zone', zone.id, { name: zone.name }, zone.branchId);
  publishOperationalEvent('delivery_zone.updated', { zoneId: zone.id, branchId: zone.branchId, deleted: true });
  save();
  res.json({ ok: true });
});

app.get('/api/admin/payments', requireCapability('payments.manage'), (req, res) => {
  const branchId = parseBranchId(req);
  const limit = Math.max(1, Math.min(200, Number(req.query.limit) || 80));
  res.json({
    provider: { mode: db.paymentProvider?.mode || 'sandbox', provider: db.paymentProvider?.provider || 'sandbox', enabled: db.paymentProvider?.enabled !== false },
    payments: branchScoped(db.paymentAttempts || [], branchId).slice(0, limit).map(publicPaymentAttempt),
  });
});

function maybeAwardOrderLoyalty(order) {
  if (!order || order.loyaltyAwarded || !db.loyalty?.enabled) return;
  const user = order.phone ? db.users.find((u) => u.phone === order.phone) : null;
  const resolved = loyaltyEngine.resolveCustomerTier(db, user);
  let pts = loyaltyEngine.calculateOrderPointsEarned(db, order.total, resolved.tier);
  
  // Happy Hour multiplier
  const hh = campaignsEngine.checkHappyHourStatus(db);
  if (hh.active && hh.pointsMultiplier > 1.0) {
    pts = Math.round(pts * hh.pointsMultiplier);
  }

  if (pts > 0) {
    awardLoyaltyPoints(order.phone, pts, 'order', {
      orderId: order.id,
      total: order.total,
      tierId: resolved.tier.id,
      tierName: resolved.tier.name,
      multiplier: resolved.tier.multiplier,
      happyHour: hh.active,
    });
    order.loyaltyAwarded = true;
    order.loyaltyPoints = pts;
    order.loyaltyTier = resolved.tier.id;

    // Trigger Smart SMS notification
    try {
      const userBal = walletEngine.getWalletBalance(db, order.phone);
      smsEngine.sendSms(db, {
        phone: order.phone,
        name: order.name || user?.name || '',
        templateKey: 'points_awarded',
        vars: {
          name: order.name || user?.name || 'مشتری گرامی',
          points: pts,
          total_points: user ? user.points : pts,
          wallet_balance: userBal,
          tier: resolved.tier.name,
        },
        triggerType: 'event',
      });
    } catch (_) {}
  }

  // Check and unlock referral rewards
  try {
    campaignsEngine.checkAndRewardReferralOnOrder(db, order, {
      walletTopup: (input) => campaignWalletTopupWithFinance(input, order.branchId, 'referral-system'),
    });
  } catch (e) {
    console.error('[referral-reward] order check failed:', e.message);
  }
}

app.patch('/api/admin/orders/:id', requireCapability('orders.manage'), async (req, res) => {
  if (!['owner', 'manager'].includes(effectiveRole(req.user))) return res.status(403).json({ error: 'supervisor_required' });
  const targetId = Number(normalizeDigits(String(req.params.id || '')).replace(/\D/g, ''));
  const order = (db.orders || []).find((o) => Number(o.id) === targetId);
  if (!order) return res.status(404).json({ error: 'not found' });
  try {
    assertUserBranchAccess(req.user, order.branchId);
  } catch (error) {
    return res.status(error.status || 403).json({ error: error.code || 'branch_access_denied', message: error.message, requestId: req.requestId });
  }
  const allowed = ['pending_online', 'awaiting_confirmation', 'pay_at_cashier', 'sent_to_kitchen', 'paid', 'preparing', 'ready', 'dispatched', 'picked_up', 'delivered', 'done', 'cancelled'];
  const snapshot = snapshotFinanceMutationState();
  try {
    if (typeof req.body.status === 'string' && allowed.includes(req.body.status)) {
      appendOrderStatus(order, req.body.status, req.user, { source: 'legacy-admin' });
      if (['paid', 'preparing', 'ready', 'dispatched', 'picked_up', 'delivered', 'done'].includes(req.body.status)) {
        order.paymentStatus = 'paid';
        const financeResult = financeV2.capturePaidOrder(db, order, { actor: req.user.phone });
        try {
          accountingEngine.syncOrderSalesJournal(db, order);
        } catch (accErr) {
          console.error('[accounting] syncOrderSalesJournal note:', accErr.message);
        }
        if (!financeResult?.journalEntry || financeResult.journalEntry.status !== 'posted') {
          const captureCode = financeResult?.event?.error?.code || 'finance_capture_blocked';
          throw Object.assign(new Error('تغییر وضعیت انجام نشد چون سند فروش در دفتر مالی ثبت نشد.'), {
            code: captureCode,
            status: 409,
            details: financeResult?.event?.error || null,
          });
        }
      } else if (req.body.status === 'cancelled') {
        try {
          accountingEngine.reverseOrderSalesJournal(db, order.id, {
            reason: `لغو سفارش #${order.orderNo || order.id}`,
            userId: req.user?.phone || 'admin'
          });
          const v2Event = (db.financeV2?.events || []).find((e) => e.source === 'order.paid' && String(e.sourceId) === String(order.id) && e.journalEntryId);
          if (v2Event?.journalEntryId) {
            financeV2.reverseEntry(db, v2Event.journalEntryId, req.user?.phone || 'admin', `لغو سفارش #${order.orderNo || order.id}`);
          }
          financeV2.reverseOrderCogsAndInventory(db, order.id, req.user?.phone || 'admin', `لغو سفارش #${order.orderNo || order.id}`);
        } catch (revErr) {
          console.error('[finance] auto reversal on order cancel note:', revErr.message);
        }
      }
      if (['done', 'picked_up', 'delivered'].includes(req.body.status)) {
        maybeAwardOrderLoyalty(order);
      }
      recordAudit(req, 'order.status_changed', 'order', order.id, { status: req.body.status, source: 'legacy-admin' }, order.branchId);
    }
    await persistFinanceMutation(snapshot);
  } catch (error) {
    restoreFinanceMutationState(snapshot);
    return res.status(error.status || 503).json({ error: error.code || error.message });
  }
  try {
    publishOperationalEvent('order.updated', { orderId: order.id, branchId: order.branchId, status: order.status });
    neemBridge.enqueueOrder(order, (db.paymentAttempts || []).find((item) => Number(item.orderId) === Number(order.id)) || null);
  } catch (error) { console.error('[order-post-commit] integration effect failed', error?.message || error); }
  res.json({ ok: true, order });
});

// Versioned endpoint for new clients: status changes must follow the state
// machine, while the legacy route above remains backwards compatible.
app.patch('/api/v2/orders/:id/status', requireCapability('orders.manage'), async (req, res) => {
  if (!['owner', 'manager'].includes(effectiveRole(req.user))) return res.status(403).json({ error: 'supervisor_required' });
  const targetId = Number(normalizeDigits(String(req.params.id || '')).replace(/\D/g, ''));
  const order = (db.orders || []).find((item) => Number(item.id) === targetId);
  const status = String(req.body?.status || '');
  if (!order) return res.status(404).json({ error: 'not found' });
  try {
    assertUserBranchAccess(req.user, order.branchId);
  } catch (error) {
    return res.status(error.status || 403).json({ error: error.code || 'branch_access_denied', message: error.message, requestId: req.requestId });
  }
  if (status === String(order.status || '')) return res.json({ ok: true, idempotent: true, order });
  if (!canTransitionOrder(order, status)) {
    return res.status(409).json({ error: 'order_transition_invalid', current: order.status, allowed: allowedOrderTransitions(order) });
  }
  const snapshot = snapshotFinanceMutationState();
  try {
    appendOrderStatus(order, status, req.user, { source: 'v2' });
    if (['paid', 'preparing', 'ready', 'dispatched', 'picked_up', 'delivered', 'done'].includes(status)) {
      order.paymentStatus = 'paid';
      const financeResult = financeV2.capturePaidOrder(db, order, { actor: req.user.phone });
      try {
        accountingEngine.syncOrderSalesJournal(db, order);
      } catch (accErr) {
        console.error('[accounting] syncOrderSalesJournal note:', accErr.message);
      }
      if (!financeResult?.journalEntry || financeResult.journalEntry.status !== 'posted') {
        const captureCode = financeResult?.event?.error?.code || 'finance_capture_blocked';
        throw Object.assign(new Error('تغییر وضعیت انجام نشد چون سند فروش در دفتر مالی ثبت نشد.'), {
          code: captureCode,
          status: 409,
          details: financeResult?.event?.error || null,
        });
      }
    } else if (status === 'cancelled') {
      try {
        accountingEngine.reverseOrderSalesJournal(db, order.id, {
          reason: `لغو سفارش #${order.orderNo || order.id}`,
          userId: req.user?.phone || 'admin'
        });
        const v2Event = (db.financeV2?.events || []).find((e) => e.source === 'order.paid' && String(e.sourceId) === String(order.id) && e.journalEntryId);
        if (v2Event?.journalEntryId) {
          financeV2.reverseEntry(db, v2Event.journalEntryId, req.user?.phone || 'admin', `لغو سفارش #${order.orderNo || order.id}`);
        }
        financeV2.reverseOrderCogsAndInventory(db, order.id, req.user?.phone || 'admin', `لغو سفارش #${order.orderNo || order.id}`);
      } catch (revErr) {
        console.error('[finance] auto reversal on order cancel note:', revErr.message);
      }
    }
    if (['done', 'picked_up', 'delivered'].includes(status)) maybeAwardOrderLoyalty(order);
    recordAudit(req, 'order.status_changed', 'order', order.id, { status, source: 'v2' }, order.branchId);
    await persistFinanceMutation(snapshot);
  } catch (error) {
    restoreFinanceMutationState(snapshot);
    return res.status(error.status || 503).json({ error: error.code || error.message });
  }
  try {
    publishOperationalEvent('order.updated', { orderId: order.id, branchId: order.branchId, status: order.status });
    neemBridge.enqueueOrder(order, (db.paymentAttempts || []).find((item) => Number(item.orderId) === Number(order.id)) || null);
  } catch (error) { console.error('[order-post-commit] integration effect failed', error?.message || error); }
  res.json({ ok: true, order });
});

/* ---- Kitchen Display System (KDS) ---- */
const KDS_STATIONS = Object.freeze([
  { id: 'expo', label: 'خروج سفارش' },
  { id: 'hot', label: 'خط گرم' },
  { id: 'cold', label: 'خط سرد' },
  { id: 'bar', label: 'بار' },
]);

const KDS_BAR_CATEGORY_IDS = new Set([7599, 14477, 7675, 7701, 7676]);
const KDS_COLD_CATEGORY_IDS = new Set([7560, 13581, 7697]);

function kdsStationForMenuItem(menuItem) {
  const categoryId = Number(menuItem?.categoryId || 0);
  if (KDS_BAR_CATEGORY_IDS.has(categoryId)) return 'bar';
  if (KDS_COLD_CATEGORY_IDS.has(categoryId)) return 'cold';
  return 'hot';
}

function ensureKdsState(order) {
  order.kds = order.kds && typeof order.kds === 'object' ? order.kds : {};
  order.kds.itemStates = order.kds.itemStates && typeof order.kds.itemStates === 'object' ? order.kds.itemStates : {};
  order.kds.priority = !!order.kds.priority;
  return order.kds;
}

function kdsLineKey(item, index) {
  return `${index}:${Number(item?.menuItemId || 0)}`;
}

function kitchenLines(order) {
  const kds = ensureKdsState(order);
  const categories = new Map((db.menuCategories || []).map((entry) => [Number(entry.id), entry]));
  const menu = new Map((db.menuItems || []).map((entry) => [Number(entry.id), entry]));
  const lines = [];
  (order.items || []).forEach((item, index) => {
    const source = menu.get(Number(item.menuItemId)) || {};
    const key = kdsLineKey(item, index);
    const category = categories.get(Number(source.categoryId)) || {};
    lines.push({
      key,
      kind: 'item',
      name: item.name,
      qty: Math.max(1, Number(item.qty) || 1),
      station: kdsStationForMenuItem(source),
      categoryId: Number(source.categoryId) || null,
      categoryName: category.title || '',
      modifiers: Array.isArray(item.modifiers) ? item.modifiers : [],
      note: item.note || '',
      seat: Number(item.seat) || 0,
      course: item.course || 'starters',
      courseStatus: item.courseStatus || 'fired',
      firedAt: item.firedAt || null,
      allergens: Array.isArray(source.allergens) ? source.allergens : [],
      completedAt: kds.itemStates[key]?.completedAt || null,
      completedBy: kds.itemStates[key]?.completedBy || null,
    });
    (item.complements || []).forEach((entry, complementIndex) => {
      const complementKey = `${key}:complement:${complementIndex}`;
      lines.push({
        key: complementKey,
        kind: 'complement',
        parentKey: key,
        parentName: item.name,
        name: entry.name,
        qty: Math.max(1, Number(entry.qty) || 1),
        station: 'bar',
        categoryId: null,
        categoryName: 'مکمل',
        modifiers: [],
        note: '',
        seat: Number(item.seat) || 0,
        course: item.course || 'starters',
        courseStatus: item.courseStatus || 'fired',
        firedAt: item.firedAt || null,
        allergens: [],
        completedAt: kds.itemStates[complementKey]?.completedAt || null,
        completedBy: kds.itemStates[complementKey]?.completedBy || null,
      });

    });
  });
  return lines;
}

function kitchenColumn(order) {
  if (order.status === 'preparing') return 'preparing';
  if (order.status === 'ready') return 'ready';
  return 'new';
}

function kitchenTicket(order, now = Date.now()) {
  const kds = ensureKdsState(order);
  const lines = kitchenLines(order);
  return {
    ...order,
    items: lines,
    column: kitchenColumn(order),
    ageSec: Math.max(0, Math.floor((now - new Date(order.createdAt).getTime()) / 1000)),
    prepAgeSec: order.startedAt ? Math.max(0, Math.floor((now - new Date(order.startedAt).getTime()) / 1000)) : 0,
    kds: {
      priority: kds.priority,
      priorityAt: kds.priorityAt || null,
      completedAt: kds.completedAt || null,
    },
  };
}

function kdsPerformance(orders, now = Date.now()) {
  const dayAgo = now - 24 * 60 * 60 * 1000;
  const durations = orders
    .filter((order) => order.startedAt && order.readyAt && new Date(order.readyAt).getTime() >= dayAgo)
    .map((order) => Math.max(0, Math.floor((new Date(order.readyAt).getTime() - new Date(order.startedAt).getTime()) / 1000)))
    .filter((value) => value > 0 && value < 6 * 60 * 60)
    .sort((a, b) => a - b);
  const averagePrepSec = durations.length ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length) : 0;
  const p90PrepSec = durations.length ? durations[Math.min(durations.length - 1, Math.floor(durations.length * .9))] : 0;
  return { averagePrepSec, p90PrepSec, completedToday: durations.length };
}

function requestedKdsBranch(req) {
  const raw = req.query?.branchId ?? req.body?.branchId;
  const allowedBranchIds = branchScopeForUser(req.user, { role: effectiveRole(req.user) });
  if (raw == null || raw === '') {
    if (allowedBranchIds !== null) {
      if (!allowedBranchIds.length) return null;
      const preferred = defaultBranch();
      return preferred && allowedBranchIds.includes(Number(preferred.id))
        ? preferred.id : allowedBranchIds[0];
    }
    return defaultBranch()?.id || null;
  }
  const id = Number(raw);
  const branch = Number.isFinite(id) ? (db.branches || []).find((entry) => Number(entry.id) === id && entry.active !== false) : null;
  if (!branch || (allowedBranchIds !== null && !allowedBranchIds.includes(Number(branch.id)))) return null;
  return branch.id;
}

function kdsIdempotent(order) {
  return { ok: true, idempotent: true, order: kitchenTicket(order) };
}

app.get('/api/kitchen/orders', requireKitchen, (req, res) => {
  // Only confirmed orders reach the kitchen. Cash collection, cancellation and
  // fulfilment remain cashier/manager actions and cannot be bypassed from KDS.
  const active = ['sent_to_kitchen', 'paid', 'preparing', 'ready'];
  const bid = requestedKdsBranch(req);
  if (!bid) return res.status(400).json({ error: 'branch_invalid' });
  const now = Date.now();
  const tickets = (db.orders || [])
    .filter((o) => active.includes(o.status))
    .filter((o) => Number(o.branchId) === Number(bid))
    .map((o) => kitchenTicket(o, now))
    .sort((a, b) => Number(b.kds.priority) - Number(a.kds.priority) || new Date(a.createdAt) - new Date(b.createdAt))
    .slice(0, 80);
  const counts = {
    new: tickets.filter((t) => t.column === 'new').length,
    preparing: tickets.filter((t) => t.column === 'preparing').length,
    ready: tickets.filter((t) => t.column === 'ready').length,
  };
  const allDayMap = new Map();
  for (const ticket of tickets.filter((entry) => entry.column !== 'ready')) {
    for (const item of ticket.items.filter((entry) => !entry.completedAt)) {
      const key = `${item.station}:${item.name}`;
      const current = allDayMap.get(key) || { name: item.name, station: item.station, qty: 0, tickets: [] };
      current.qty += Math.max(1, Number(item.qty) || 1);
      current.tickets.push(ticket.id);
      allDayMap.set(key, current);
    }
  }
  const stationCounts = Object.fromEntries(KDS_STATIONS.filter((entry) => entry.id !== 'expo').map((entry) => [entry.id, 0]));
  tickets.filter((entry) => entry.column !== 'ready').forEach((ticket) => ticket.items.filter((item) => !item.completedAt).forEach((item) => { stationCounts[item.station] = Number(stationCounts[item.station] || 0) + Math.max(1, Number(item.qty) || 1); }));
  const categoryNames = new Map((db.menuCategories || []).map((entry) => [Number(entry.id), entry.title || '']));
  res.json({
    tickets,
    counts,
    stations: KDS_STATIONS.map((entry) => ({ ...entry, count: entry.id === 'expo' ? tickets.filter((ticket) => ticket.column !== 'ready').length : Number(stationCounts[entry.id] || 0) })),
    allDay: [...allDayMap.values()].sort((a, b) => b.qty - a.qty || String(a.name).localeCompare(String(b.name), 'fa')),
    availability: (db.menuItems || []).map((item) => ({ id: item.id, name: item.name, available: item.available !== false, station: kdsStationForMenuItem(item), categoryName: categoryNames.get(Number(item.categoryId)) || '' })).sort((a, b) => String(a.name).localeCompare(String(b.name), 'fa')),
    performance: kdsPerformance((db.orders || []).filter((order) => Number(order.branchId) === Number(bid)), now),
    summary: {
      oldestAgeSec: tickets.reduce((m, t) => Math.max(m, Number(t.ageSec) || 0), 0),
      delayed: tickets.filter((t) => t.column !== 'ready' && Number(t.ageSec) >= 1200).length,
      warning: tickets.filter((t) => t.column !== 'ready' && Number(t.ageSec) >= 600 && Number(t.ageSec) < 1200).length,
      itemUnits: tickets.reduce((sum, t) => sum + (t.items || []).reduce((n, item) => n + Math.max(1, Number(item.qty) || 1), 0), 0),
    },
    branchId: bid,
    serverTime: new Date().toISOString(),
  });
});

app.patch('/api/kitchen/orders/:id', requireCapability('kitchen.manage'), (req, res) => {
  const branchId = requestedKdsBranch(req);
  if (!branchId) return res.status(400).json({ error: 'branch_invalid' });
  const targetId = Number(normalizeDigits(String(req.params.id || '')).replace(/\D/g, ''));
  const order = (db.orders || []).find((o) => Number(o.id) === targetId && Number(o.branchId) === Number(branchId));
  if (!order) return res.status(404).json({ error: 'not found' });
  const legacyStatus = String(req.body?.status || '');
  const requestedAction = String(req.body?.action || '');
  const actionName = requestedAction || (legacyStatus === 'preparing' ? 'start_ticket' : legacyStatus === 'ready' ? 'complete_ticket' : '');
  const kds = ensureKdsState(order);
  const now = new Date().toISOString();
  const actor = { phone: req.user.phone, name: req.user.name || '' };
  const lines = kitchenLines(order);
  const lineKey = String(req.body?.lineKey || '');
  const line = lines.find((entry) => entry.key === lineKey);
  const isNew = ['sent_to_kitchen', 'paid'].includes(order.status);
  if (!['sent_to_kitchen', 'paid', 'preparing', 'ready'].includes(String(order.status || ''))) {
    return res.status(409).json({ error: 'kitchen_transition_invalid', current: order.status, allowed: [] });
  }
  const start = () => {
    if (isNew && canTransitionOrder(order, 'preparing')) appendOrderStatus(order, 'preparing', req.user, { source: 'kds', action: actionName });
  };
  let auditAction = `kds.${actionName || 'invalid'}`;

  if (actionName === 'start_ticket') {
    if (order.status === 'preparing') return res.json(kdsIdempotent(order));
    if (!isNew) return res.status(409).json({ error: 'kitchen_transition_invalid', current: order.status, allowed: ['preparing'] });
    start();
  } else if (actionName === 'complete_item') {
    if (!line || order.status === 'ready') return res.status(409).json({ error: 'kds_item_invalid', lineKey, current: order.status });
    start();
    if (kds.itemStates[lineKey]?.completedAt) return res.json(kdsIdempotent(order));
    kds.itemStates[lineKey] = { completedAt: now, completedBy: actor };
    const allComplete = kitchenLines(order).every((entry) => kds.itemStates[entry.key]?.completedAt);
    if (allComplete && order.status === 'preparing' && canTransitionOrder(order, 'ready')) {
      appendOrderStatus(order, 'ready', req.user, { source: 'kds', action: 'all_items_complete' });
      kds.completedAt = order.readyAt;
    }
  } else if (actionName === 'complete_station') {
    const station = String(req.body?.station || '');
    if (!['hot', 'cold', 'bar'].includes(station)) return res.status(409).json({ error: 'kds_station_invalid', station, current: order.status });
    const stationLines = lines.filter((entry) => entry.station === station);
    if (!stationLines.length) return res.status(409).json({ error: 'kds_station_empty', station });
    if (order.status === 'ready' && stationLines.every((entry) => kds.itemStates[entry.key]?.completedAt)) return res.json(kdsIdempotent(order));
    if (order.status === 'ready') return res.status(409).json({ error: 'kds_station_invalid', station, current: order.status });
    start();
    for (const entry of stationLines) kds.itemStates[entry.key] = kds.itemStates[entry.key] || { completedAt: now, completedBy: actor };
    const allComplete = kitchenLines(order).every((entry) => kds.itemStates[entry.key]?.completedAt);
    if (allComplete && order.status === 'preparing' && canTransitionOrder(order, 'ready')) {
      appendOrderStatus(order, 'ready', req.user, { source: 'kds', action: 'all_stations_complete' });
      kds.completedAt = order.readyAt;
    }
  } else if (actionName === 'undo_item') {
    if (!line || !kds.itemStates[lineKey]?.completedAt) return res.json(kdsIdempotent(order));
    if (order.status === 'ready') {
      appendOrderStatus(order, 'preparing', req.user, { source: 'kds', action: 'undo_item' });
      order.readyAt = null;
      kds.completedAt = null;
    }
    delete kds.itemStates[lineKey];
  } else if (actionName === 'complete_ticket') {
    if (order.status === 'ready') return res.json(kdsIdempotent(order));
    const incomplete = lines.filter((entry) => !kds.itemStates[entry.key]?.completedAt);
    if (!lines.length || incomplete.length) {
      return res.status(409).json({ error: 'kds_ticket_incomplete', incomplete: incomplete.map((entry) => entry.key) });
    }
    start();
    if (order.status !== 'preparing' || !canTransitionOrder(order, 'ready')) return res.status(409).json({ error: 'kitchen_transition_invalid', current: order.status, allowed: ['ready'] });
    appendOrderStatus(order, 'ready', req.user, { source: 'kds', action: 'complete_ticket' });
    kds.completedAt = order.readyAt;
  } else if (actionName === 'recall_ticket') {
    if (order.status === 'preparing') return res.json(kdsIdempotent(order));
    if (order.status !== 'ready') return res.status(409).json({ error: 'kitchen_recall_invalid', current: order.status });
    appendOrderStatus(order, 'preparing', req.user, { source: 'kds', action: 'recall_ticket' });
    order.readyAt = null;
    kds.completedAt = null;
    kds.itemStates = {};
  } else if (actionName === 'prioritize') {
    if (order.status === 'ready') return res.status(409).json({ error: 'kitchen_priority_invalid', current: order.status });
    kds.priority = req.body?.priority !== false;
    kds.priorityAt = kds.priority ? now : null;
  } else if (actionName === 'note') {
    order.kitchenNote = String(req.body?.note || '').trim().slice(0, 240);
    kds.needsAttention = !!order.kitchenNote;
  } else {
    return res.status(409).json({ error: 'kitchen_transition_invalid', current: order.status, allowed: ['start_ticket', 'complete_item', 'complete_station', 'complete_ticket', 'recall_ticket', 'prioritize', 'note'] });
  }

  recordAudit(req, auditAction, 'order', order.id, { action: actionName, lineKey: lineKey || null, status: order.status }, order.branchId);
  publishOperationalEvent('order.updated', { orderId: order.id, branchId: order.branchId, status: order.status, kdsAction: actionName });
  save();
  res.json({ ok: true, order: kitchenTicket(order) });
});

app.patch('/api/kitchen/items/:id/availability', requireCapability('kitchen.manage'), (req, res) => {
  const targetId = Number(normalizeDigits(String(req.params.id || '')).replace(/\D/g, ''));
  const item = (db.menuItems || []).find((entry) => Number(entry.id) === targetId);
  if (!item) return res.status(404).json({ error: 'not found' });
  if (typeof req.body?.available !== 'boolean') return res.status(400).json({ error: 'availability_invalid' });
  item.available = req.body.available;
  recordAudit(req, 'kds.item_availability_changed', 'menu_item', item.id, { available: item.available }, null);
  publishOperationalEvent('menu.availability_updated', { menuItemId: item.id, available: item.available });
  save({ bumpMenu: true });
  res.json({ ok: true, item: { id: item.id, name: item.name, available: item.available } });
});

/* ---- Call waiter (فراخوان گارسون) ---- */
app.post('/api/call-waiter', (req, res) => {
  const tableNo = normalizeDigits(String(req.body.tableNo || '')).trim().slice(0, 20);
  if (!tableNo) return res.status(400).json({ error: 'شماره میز لازم است' });
  const note = String(req.body.note || '').trim().slice(0, 120);
  const tableMatch = (db.tables || []).find(
    (t) => String(t.id) === tableNo || normalizeDigits(String(t.label || '')).trim() === tableNo || String(t.label || '').trim() === `میز ${tableNo}`
  );
  const rawBranchId = req.body?.branchId;
  let branchId = rawBranchId == null || String(rawBranchId).trim() === '' ? null : Number(normalizeDigits(String(rawBranchId)).replace(/\D/g, ''));
  if (branchId != null && (!Number.isSafeInteger(branchId) || branchId <= 0)) {
    return res.status(400).json({ error: 'branch_invalid' });
  }
  const tableBranchId = Number(tableMatch?.branchId);
  if (Number.isSafeInteger(tableBranchId) && tableBranchId > 0 && branchId != null && branchId !== tableBranchId) {
    return res.status(409).json({ error: 'waiter_call_branch_mismatch', tableBranchId, requestedBranchId: branchId });
  }
  if (branchId == null) branchId = Number.isSafeInteger(tableBranchId) && tableBranchId > 0
    ? tableBranchId : defaultBranch()?.id || 1;
  if (!(db.branches || []).some((branch) => Number(branch.id) === branchId && branch.active !== false)) {
    return res.status(400).json({ error: 'branch_invalid' });
  }
  db.waiterCalls = db.waiterCalls || [];
  const call = {
    id: Math.max(0, ...db.waiterCalls.map((c) => c.id), 0) + 1,
    tableNo,
    note,
    branchId,
    status: 'open',
    createdAt: new Date().toISOString(),
  };
  db.waiterCalls.unshift(call);
  db.waiterCalls = db.waiterCalls.slice(0, 200);
  publishOperationalEvent('waiter_call.created', {
    callId: call.id,
    branchId: call.branchId,
    tableNo: call.tableNo,
    note: call.note,
  });
  save();
  res.json({ ok: true, call });
});

app.post('/api/call-waiter/cancel', (req, res) => {
  const tableNo = normalizeDigits(String(req.body.tableNo || '')).trim().slice(0, 20);
  const callId = req.body.callId ? Number(normalizeDigits(String(req.body.callId)).replace(/\D/g, '')) : null;
  if (!tableNo && !callId) return res.status(400).json({ error: 'شماره میز یا شناسه فراخوان لازم است' });
  const tableDigits = tableNo.replace(/\D/g, '');
  const tableNum = tableDigits ? Number(tableDigits) : null;

  const targetCalls = (db.waiterCalls || []).filter((c) => {
    if (c.status !== 'open' && c.status !== 'new') return false;
    if (callId && Number(c.id) === callId) return true;
    if (callId) return false;
    const cDigits = String(c.tableNo || '').replace(/\D/g, '');
    const cNum = cDigits ? Number(cDigits) : null;
    return (tableNum !== null && cNum === tableNum) || (cDigits && cDigits === tableDigits) || c.tableNo === tableNo;
  });

  if (!targetCalls.length) return res.status(404).json({ error: 'فراخوان بازی یافت نشد' });

  targetCalls.forEach((call) => {
    call.status = 'cancelled';
    call.resolvedAt = new Date().toISOString();
    call.resolvedBy = 'guest';
    publishOperationalEvent('waiter_call.updated', { callId: call.id, branchId: call.branchId, status: call.status });
  });

  save();
  res.json({ ok: true, calls: targetCalls, call: targetCalls[0] });
});



app.get('/api/kitchen/calls', requireCapability('service.manage'), (req, res) => {
  // Resolve the authenticated kitchen operator's effective branch when the
  // UI omits branchId; otherwise a scoped operator receives every branch's
  // open waiter call because the old query-only filter treated omission as a
  // consolidated view.
  const allowedBranchIds = branchScopeForUser(req.user, { role: effectiveRole(req.user) });
  const bid = allowedBranchIds === null
    ? (req.query.branchId ? Number(req.query.branchId) : null)
    : parseBranchId(req);
  const calls = (db.waiterCalls || [])
    .filter((c) => c.status === 'open')
    .filter((c) => (bid ? Number(c.branchId) === bid : true))
    .slice(0, 40);
  res.json({ calls });
});

app.patch('/api/kitchen/calls/:id', requireCapability('service.manage'), (req, res) => {
  const targetId = Number(normalizeDigits(String(req.params.id || '')).replace(/\D/g, ''));
  const call = (db.waiterCalls || []).find((c) => Number(c.id) === targetId);
  if (!call) return res.status(404).json({ error: 'not found' });
  try {
    assertUserBranchAccess(req.user, call.branchId);
  } catch (error) {
    return res.status(error.status || 403).json({ error: error.code || 'branch_access_denied', message: error.message, requestId: req.requestId });
  }
  if (req.body.status === 'done' || req.body.status === 'open') call.status = req.body.status;
  call.resolvedAt = new Date().toISOString();
  save();
  res.json({ ok: true, call });
});

// --- FAQ ---
app.post('/api/faq', requireAdmin, (req, res) => {
  if (!Array.isArray(db.faq)) db.faq = [];
  const id = Math.max(0, ...db.faq.map((f) => Number(f.id) || 0), 0) + 1;
  const item = { id, q: String(req.body.q || '').trim(), a: String(req.body.a || '').trim() };
  db.faq.push(item);
  save();
  res.json({ ok: true, item });
});
app.put('/api/faq/:id', requireAdmin, (req, res) => {
  if (!Array.isArray(db.faq)) db.faq = [];
  const targetId = Number(normalizeDigits(String(req.params.id || '')).replace(/\D/g, ''));
  const item = db.faq.find((f) => Number(f.id) === targetId);
  if (!item) return res.status(404).json({ error: 'not found' });
  if (typeof req.body.q === 'string') item.q = req.body.q;
  if (typeof req.body.a === 'string') item.a = req.body.a;
  save();
  res.json({ ok: true, item });
});
app.delete('/api/faq/:id', requireAdmin, (req, res) => {
  if (!Array.isArray(db.faq)) db.faq = [];
  const targetId = Number(normalizeDigits(String(req.params.id || '')).replace(/\D/g, ''));
  db.faq = db.faq.filter((f) => Number(f.id) !== targetId);
  save();
  res.json({ ok: true });
});
app.put('/api/faq-order', requireAdmin, (req, res) => {
  if (!Array.isArray(db.faq)) db.faq = [];
  const order = (Array.isArray(req.body.order) ? req.body.order : []).map((id) =>
    Number(normalizeDigits(String(id || '')).replace(/\D/g, ''))
  );
  db.faq.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  save();
  res.json({ ok: true, faq: db.faq });
});

// --- admin: users & roles ---
app.get('/api/admin/users', requireAdmin, (req, res) => {
  const users = (db.users || []).map((u) => {
    const pub = publicUser(u);
    try {
      const tierInfo = loyaltyEngine.resolveCustomerTier(db, u);
      pub.tier = tierInfo?.tier || { id: 'bronze', name: 'برنزی', badgeIcon: '🥉' };
    } catch (_) {
      pub.tier = { id: 'bronze', name: 'برنزی', badgeIcon: '🥉' };
    }
    try {
      pub.walletBalanceToman = walletEngine.getWalletBalance(db, u.phone);
    } catch (_) {
      pub.walletBalanceToman = 0;
    }
    const userOrders = (db.orders || []).filter((o) => o.phone === u.phone);
    pub.ordersCount = userOrders.length;
    pub.totalSpendToman = userOrders
      .filter((o) => FINANCIAL_PAID_ORDER_STATUSES.has(String(o.status || '')))
      .reduce((sum, o) => sum + Number(o.total || 0), 0);
    return pub;
  });
  res.json({ users, branches: db.branches || [] });
});

app.get('/api/admin/roles/matrix', requireAdmin, (req, res) => {
  const matrix = {
    roles: [
      { id: 'owner', label: 'مالک / مدیر ارشد', category: 'staff', description: 'دسترسی نامحدود به تمامی بخش‌ها، تنظیمات، اسناد مالی و حذف کاربران', icon: '👑', badgeClass: 'role-owner' },
      { id: 'manager', label: 'مدیر داخلی / سرپرست', category: 'staff', description: 'مدیریت عملیات، سفارش‌ها، رزروها، صندوق، آشپزخانه، انبار، پرسنل و گزارش‌ها', icon: '🧑‍💼', badgeClass: 'role-manager' },
      { id: 'accountant', label: 'حسابدار / مدیر مالی', category: 'staff', description: 'اسناد دوبل، ترازنامه، صورت سود و زیان، بستن دوره‌های مالی و مغایرت‌گیری', icon: '💰', badgeClass: 'role-accountant' },
      { id: 'cashier', label: 'صندوقدار / صندوق', category: 'staff', description: 'ثبت سفارش، تسویه فاکتور، مدیریت پوز و وجه نقد، رزرو و وضعیت تحویل', icon: '💵', badgeClass: 'role-cashier' },
      { id: 'waiter', label: 'گارسون / سالن‌کار', category: 'staff', description: 'سفارش‌گیری سر میز با تبلت، فراخوانی مهمان، وضعیت میزها و سرو', icon: '🤵', badgeClass: 'role-waiter' },
      { id: 'kitchen', label: 'آشپزخانه / سرآشپز', category: 'staff', description: 'مشاهده صفحه KDS، مدیریت صف پخت، اعلام آماده بودن و ثبت حواله مصرف انبار', icon: '🍳', badgeClass: 'role-kitchen' },
      { id: 'guest', label: 'مشتری / مهمان', category: 'customer', description: 'ثبت سفارش، رزرو آنلاین، باشگاه مشتریان، کیف پول و ثبت بازخورد', icon: '🌟', badgeClass: 'role-guest' },
    ],
    sections: [
      {
        id: 'orders',
        title: 'سفارش‌ها و صندوق',
        description: 'مشاهده، ثبت و مدیریت سفارش‌های حضوری و آنلاین، تسویه فاکتور',
        roles: { owner: 'full', manager: 'full', cashier: 'full', waiter: 'create_view', kitchen: 'none', accountant: 'none', guest: 'self_only' },
      },
      {
        id: 'kitchen',
        title: 'صف آشپزخانه (KDS)',
        description: 'مشاهده کارت‌های پخت، شروع آماده‌سازی و تغییر به وضعیت آماده',
        roles: { owner: 'full', manager: 'full', kitchen: 'full', cashier: 'none', waiter: 'none', accountant: 'none', guest: 'none' },
      },
      {
        id: 'tables',
        title: 'میزها و سالن پذیرایی',
        description: 'نقشه میزها، اعلام درخواست گارسون و مدیریت ظرفیت سالن',
        roles: { owner: 'full', manager: 'full', waiter: 'full', cashier: 'full', kitchen: 'none', accountant: 'none', guest: 'call_only' },
      },
      {
        id: 'finance',
        title: 'مالی و حسابداری',
        description: 'اسناد دوبل حسابداری، بستن دوره‌ها، مغایرت‌گیری و ترازنامه',
        roles: { owner: 'full', manager: 'full', accountant: 'full', cashier: 'cash_only', waiter: 'none', kitchen: 'none', guest: 'none' },
      },
      {
        id: 'inventory',
        title: 'انبار و مواد اولیه',
        description: 'موجودی انبار، ورود کالا (رسید)، حواله مصرف و بهای تمام‌شده',
        roles: { owner: 'full', manager: 'full', accountant: 'view_only', kitchen: 'operations_only', cashier: 'none', waiter: 'none', guest: 'none' },
      },
      {
        id: 'menu',
        title: 'منو، قیمت‌ها و محصولات',
        description: 'ویرایش غذاها و محصولات، دسته‌بندی‌ها، قیمت‌گذاری و فعال/غیرفعال کردن',
        roles: { owner: 'full', manager: 'full', accountant: 'none', cashier: 'none', waiter: 'none', kitchen: 'none', guest: 'none' },
      },
      {
        id: 'reports',
        title: 'گزارش‌های فروش و آمار',
        description: 'تحلیل روزانه و ماهانه، نمودارهای سودآوری و ترافیک مهمان',
        roles: { owner: 'full', manager: 'full', accountant: 'full', cashier: 'none', waiter: 'none', kitchen: 'none', guest: 'none' },
      },
      {
        id: 'club',
        title: 'باشگاه مشتریان و پیامک',
        description: 'مدیریت اعضای وفادار، سطوح برنزی تا طلایی، کیف پول و کمپین‌ها',
        roles: { owner: 'full', manager: 'full', accountant: 'none', cashier: 'none', waiter: 'none', kitchen: 'none', guest: 'profile_only' },
      },
      {
        id: 'settings',
        title: 'تنظیمات و دسترسی کاربران',
        description: 'مدیریت کاربران، تغییر نقش‌ها، تخصیص شعب و پیکربندی سیستم',
        roles: { owner: 'full', manager: 'view_manage', accountant: 'none', cashier: 'none', waiter: 'none', kitchen: 'none', guest: 'none' },
      },
    ],
    capabilities: ROLE_CAPABILITIES,
  };
  res.json(matrix);
});

app.post(['/api/admin/users', '/api/admin/customers'], requireAdmin, (req, res) => {
  const phone = normalizeDigits(req.body.phone || '').trim();
  const name = String(req.body.name || '').trim().slice(0, 120);
  if (!PHONE_RE.test(phone)) return res.status(400).json({ error: 'شماره موبایل معتبر نیست.' });
  if (!name) return res.status(400).json({ error: 'نام و نام خانوادگی لازم است.' });
  if (db.users.some((user) => user.phone === phone)) return res.status(409).json({ error: 'کاربری با این شماره قبلاً ثبت شده است.' });
  
  const requestedRole = String(req.body.role || 'user').trim().toLowerCase();
  const roleMap = { admin: 'owner', user: 'guest', owner: 'owner', manager: 'manager', accountant: 'accountant', cashier: 'cashier', waiter: 'waiter', kitchen: 'kitchen', guest: 'guest' };
  const role = roleMap[requestedRole] || 'guest';
  
  if (['owner', 'manager'].includes(role) && !isOwnerActor(db, req.user)) {
    return res.status(403).json({
      error: role === 'owner' ? 'staff_owner_protected' : 'staff_manager_protected',
      message: role === 'owner' ? 'حساب مالک فقط توسط مالک قابل ایجاد است.' : 'حساب مدیر فقط توسط مالک قابل ایجاد است.',
    });
  }

  let allowedBranchIds = null;
  if (Array.isArray(req.body.allowedBranchIds)) {
    allowedBranchIds = req.body.allowedBranchIds
      .map((b) => Number(normalizeDigits(String(b)).replace(/\D/g, '')))
      .filter((n) => Number.isSafeInteger(n) && n > 0);
  } else if (req.body.branchId != null && req.body.branchId !== '') {
    const single = Number(normalizeDigits(String(req.body.branchId)).replace(/\D/g, ''));
    if (Number.isSafeInteger(single) && single > 0) allowedBranchIds = [single];
  }

  const parsePoints = (v) => {
    if (v == null || v === '') return 0;
    if (typeof v === 'number') return isNaN(v) ? 0 : v;
    const n = Number(normalizeDigits(String(v)).replace(/[,٬_\s]/g, '').trim());
    return isNaN(n) ? 0 : n;
  };

  const user = {
    phone,
    name,
    email: String(req.body.email || '').trim().slice(0, 160),
    role,
    allowedBranchIds,
    points: Math.max(0, Math.round(parsePoints(req.body.points))),
    notes: String(req.body.notes || '').trim().slice(0, 500),
    createdAt: new Date().toISOString(),
    blocked: false,
  };
  db.users.push(user);
  recordAudit(req, 'user.created', 'user', phone, { name, role, allowedBranchIds });
  save();
  res.status(201).json({ ok: true, user: publicUser(user) });
});

app.patch(['/api/admin/users/:phone', '/api/admin/customers/:phone'], requireAdmin, (req, res) => {
  const targetPhone = normalizeDigits(decodeURIComponent(String(req.params.phone || ''))).trim();
  const user = db.users.find((u) => u.phone === targetPhone);
  if (!user) return res.status(404).json({ error: 'not found' });

  const isSelf = String(req.user?.phone || '') === String(user.phone || '');
  if (typeof req.body.blocked === 'boolean' && isSelf) {
    return res.status(400).json({
      error: 'staff_self_protected',
      message: 'کاربر جاری را نمی‌توان مسدود یا از حالت مسدود خارج کرد.',
    });
  }

  try {
    assertStaffMutationBoundary(db, req.user, user, { allowSelf: true });
  } catch (error) {
    return res.status(error.status || 403).json({ error: error.code || 'staff_mutation_forbidden', message: error.message });
  }

  if (typeof req.body.blocked === 'boolean') user.blocked = req.body.blocked;
  if (typeof req.body.name === 'string') user.name = req.body.name.trim();
  if (typeof req.body.email === 'string') user.email = req.body.email.trim();
  if (typeof req.body.notes === 'string') user.notes = req.body.notes.trim().slice(0, 500);
  if (req.body.points != null) {
    const parsePoints = (v) => {
      if (v == null || v === '') return null;
      if (typeof v === 'number') return isNaN(v) ? null : v;
      const n = Number(normalizeDigits(String(v)).replace(/[,٬_\s]/g, '').trim());
      return isNaN(n) ? null : n;
    };
    const pts = parsePoints(req.body.points);
    if (pts != null) user.points = Math.max(0, Math.round(pts));
  }
  if (Array.isArray(req.body.allowedBranchIds)) {
    user.allowedBranchIds = req.body.allowedBranchIds
      .map((b) => Number(normalizeDigits(String(b)).replace(/\D/g, '')))
      .filter((n) => Number.isSafeInteger(n) && n > 0);
  } else if (req.body.allowedBranchIds === null) {
    user.allowedBranchIds = null;
  }
  if (typeof req.body.birthdate === 'string') {
    user.birthdate = req.body.birthdate.trim().slice(0, 50);
    user.birthdateUpdatedAt = new Date().toISOString();
    try { campaignsEngine.checkBirthdayEligibility(db, user); } catch (_) {}
  }
  const requestedRole = String(req.body.role || '').trim().toLowerCase();
  const roleMap = { admin: 'owner', user: 'guest', owner: 'owner', manager: 'manager', accountant: 'accountant', cashier: 'cashier', waiter: 'waiter', kitchen: 'kitchen', guest: 'guest' };
  if (roleMap[requestedRole]) {
    const newRole = roleMap[requestedRole];
    if (newRole !== user.role) {
      if (['owner', 'manager'].includes(newRole) && !isOwnerActor(db, req.user)) {
        return res.status(403).json({
          error: newRole === 'owner' ? 'staff_owner_protected' : 'staff_manager_protected',
          message: newRole === 'owner' ? 'اعطای نقش مالک فقط توسط مالک امکان‌پذیر است.' : 'اعطای نقش مدیر فقط توسط مالک امکان‌پذیر است.',
        });
      }
      user.role = newRole;
    }
  }
  recordAudit(req, 'user.access_updated', 'user', user.phone, { role: user.role, blocked: !!user.blocked, birthdate: user.birthdate, allowedBranchIds: user.allowedBranchIds });
  save();
  res.json({ ok: true, user: publicUser(user) });
});

app.delete('/api/admin/users/:phone', requireOwner, (req, res) => {
  const targetPhone = normalizeDigits(decodeURIComponent(String(req.params.phone || ''))).trim();
  if (String(req.user?.phone || '') === targetPhone) {
    return res.status(400).json({ error: 'staff_self_protected', message: 'مالک جاری نمی‌تواند حساب خود را حذف کند.' });
  }
  const user = db.users.find((u) => u.phone === targetPhone);
  db.users = db.users.filter((u) => u.phone !== targetPhone);
  if (user) recordAudit(req, 'user.deleted', 'user', user.phone, { role: user.role });
  save();
  res.json({ ok: true });
});

// --- newsletter ---
app.post('/api/newsletter', (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'ایمیل معتبر نیست' });
  if (!Array.isArray(db.newsletter)) db.newsletter = [];
  if (!db.newsletter.find((n) => n.email === email)) {
    db.newsletter.push({ email, at: new Date().toISOString() });
    save();
  }
  res.json({ ok: true });
});
app.get('/api/admin/newsletter', requireAdmin, (req, res) => {
  res.json({ newsletter: Array.isArray(db.newsletter) ? db.newsletter : [] });
});

// --- admin: stats / uploads / settings ---
app.get('/api/admin/stats', requireAdmin, (req, res) => {
  const now = Date.now();
  const dayMs = 24 * 3600 * 1000;
  const weekAgo = now - 7 * dayMs;
  const dayAgo = now - dayMs;
  // Keep owner analytics consolidated by default, while resolving a scoped
  // manager/accountant to an allowed branch when the dashboard omits a filter.
  const requestedBranch = requestBranchValue(req);
  const allowedBranchIds = branchScopeForUser(req.user, { role: effectiveRole(req.user) });
  const bid = requestedBranch != null
    ? parseBranchId(req)
    : allowedBranchIds === null
      ? null
      : (defaultBranch() && allowedBranchIds.includes(Number(defaultBranch().id))
        ? defaultBranch().id
        : allowedBranchIds[0] || null);
  let orders = db.orders || [];
  if (bid) orders = orders.filter((o) => Number(o.branchId) === bid);
  // Revenue is an accounting-facing metric. Pending/unpaid/partial orders
  // belong in the operational queue, never in sales totals; retain the
  // status fallback only for legacy rows that predate paymentStatus.
  const paidLike = orders.filter((o) => {
    if (typeof o?.paymentStatus === 'string') return o.paymentStatus === 'paid';
    return FINANCIAL_PAID_ORDER_STATUSES.has(String(o?.status || ''));
  });
  const revenue = paidLike.reduce((s, o) => s + (Number(o.total) || 0), 0);
  const revenueToday = paidLike
    .filter((o) => new Date(o.createdAt).getTime() >= dayAgo)
    .reduce((s, o) => s + (Number(o.total) || 0), 0);
  const revenueWeek = paidLike
    .filter((o) => new Date(o.createdAt).getTime() >= weekAgo)
    .reduce((s, o) => s + (Number(o.total) || 0), 0);
  const visits = db.visits || [];
  const visitsToday = visits.filter((v) => new Date(v.at).getTime() >= dayAgo).length;
  const visitsWeek = visits.filter((v) => new Date(v.at).getTime() >= weekAgo).length;
  const uniqueSessions = new Set(visits.filter((v) => new Date(v.at).getTime() >= weekAgo).map((v) => v.sessionId)).size;

  // Top selling items
  const itemMap = new Map();
  for (const o of paidLike) {
    for (const line of o.items || []) {
      const cur = itemMap.get(line.menuItemId) || { id: line.menuItemId, name: line.name, qty: 0, revenue: 0 };
      cur.qty += line.qty || 0;
      cur.revenue += line.lineTotal || (line.price || 0) * (line.qty || 0);
      itemMap.set(line.menuItemId, cur);
    }
  }
  const topItems = [...itemMap.values()].sort((a, b) => b.qty - a.qty).slice(0, 8);

  // Hourly heatmap (last 7d)
  const byHour = Array.from({ length: 24 }, () => 0);
  for (const o of paidLike.filter((o) => new Date(o.createdAt).getTime() >= weekAgo)) {
    byHour[new Date(o.createdAt).getHours()] += 1;
  }

  const tablesScoped = (db.tables || []).filter((t) => (bid ? Number(t.branchId) === bid : true));
  const v2Inventory = financeV2.inventoryItemsView(db, { branchId: bid }).items;
  const legacyTrackedMenu = (db.menuItems || []).filter((item) => !financeV2.menuItemUsesInventoryV2(db, item.id, bid));

  res.json({
    users: db.users.length,
    newsletter: db.newsletter.length,
    orders: orders.length,
    openOrders: orders.filter((o) => !['done', 'cancelled', 'paid'].includes(o.status)).length,
    menuItems: (db.menuItems || []).length,
    unavailable: (db.menuItems || []).filter((m) => m.available === false).length,
    lowStock: v2Inventory.filter((item) => Number(item.availableQuantity ?? item.qtyOnHand ?? 0) > 0 && Number(item.minStock || 0) > 0 && Number(item.availableQuantity ?? item.qtyOnHand ?? 0) <= Number(item.minStock)).length + legacyTrackedMenu.filter(
      (m) => typeof m.stock === 'number' && m.stock > 0 && m.stock <= (m.lowStockAt ?? 5)
    ).length,
    outOfStock: v2Inventory.filter((item) => Number(item.availableQuantity ?? item.qtyOnHand ?? 0) <= 0).length + legacyTrackedMenu.filter((m) => m.stock === 0).length,
    tables: tablesScoped.filter((t) => t.active !== false).length,
    branchId: bid,
    branches: (db.branches || []).length,
    revenue,
    revenueToday,
    revenueWeek,
    visitsToday,
    visitsWeek,
    uniqueSessions,
    topItems,
    byHour,
    dailySales30d: (() => {
      const dailyMap = new Map();
      for (let i = 29; i >= 0; i--) {
        const d = new Date(now - i * dayMs).toISOString().slice(0, 10);
        dailyMap.set(d, { date: d, count: 0, sales: 0 });
      }
      for (const o of paidLike) {
        const d = (o.createdAt || '').slice(0, 10);
        if (dailyMap.has(d)) {
          const row = dailyMap.get(d);
          row.count += 1;
          row.sales += Number(o.total || 0);
        }
      }
      return [...dailyMap.values()];
    })(),
    costStructure: (() => {
      const be = financeV2.breakEvenDashboard(db, { branchId: bid || 1 });
      const plan = be.plan || be.suggestedPlan;
      const assumptions = Array.isArray(plan?.assumptions) ? plan.assumptions : [];
      const totalFixedCostsToman = assumptions.reduce((sum, a) => sum + Number(a.amountToman || 0), 0)
        || Number(plan?.monthlyFixedCostIrr ? plan.monthlyFixedCostIrr / 10 : 1_280_000_000);
      
      const accountingExpenses = (db.accounting?.expenses || []).filter((e) => !bid || Number(e.branchId) === bid);
      
      return {
        totalFixedCostsToman,
        totalFixedCostsIrr: totalFixedCostsToman * 10,
        assumptions: assumptions.map((a) => ({
          id: a.id,
          name: a.name || a.categoryName,
          amountToman: Number(a.amountToman || (a.amountIrr ? a.amountIrr / 10 : 0)),
          categoryCode: a.categoryCode,
          headcount: a.headcount,
          salaryPerPersonToman: a.salaryPerPersonToman,
        })),
        actualExpensesCount: accountingExpenses.length,
      };
    })(),
    recentLogins: db.loginLog.slice(0, 10),
    recentOrders: orders.slice(0, 6),
    reservationsToday: (db.reservations || []).filter(
      (r) => r.date === new Date().toISOString().slice(0, 10) && ['pending', 'confirmed', 'seated'].includes(r.status)
        && (!bid || Number(r.branchId) === bid)
    ).length,
    reservationsPending: (db.reservations || []).filter(
      (r) => r.status === 'pending' && (!bid || Number(r.branchId) === bid)
    ).length,
    ...(() => {
      let fb = db.feedback || [];
      if (bid) fb = fb.filter((f) => Number(f.branchId) === bid);
      const week = fb.filter((f) => new Date(f.createdAt).getTime() >= weekAgo);
      const scores = week.map((f) => Number(f.score)).filter((n) => Number.isFinite(n));
      const promoters = scores.filter((s) => s >= 9).length;
      const detractors = scores.filter((s) => s <= 6).length;
      const nps =
        scores.length > 0 ? Math.round(((promoters - detractors) / scores.length) * 100) : null;
      return {
        feedbackWeek: week.length,
        npsWeek: nps,
        feedbackPending: fb.filter((f) => f.status === 'new').length,
      };
    })(),
  });
});

app.get('/api/admin/notifications', requireAdmin, (req, res) => {
  const bid = parseBranchId(req) || null;
  const items = [];

  // 1. Finance & Accounting Approvals
  let state = null;
  try {
    state = financeV2.ensureFinanceV2(db);
  } catch (_) {}

  if (state) {
    const approvals = (state.approvals || []).filter(
      (a) => a.status === 'pending' && (!bid || !a.branchId || Number(a.branchId) === bid)
    );
    for (const a of approvals) {
      let title = `درخواست تأیید مالی (${a.operation || a.entityType})`;
      let tab = 'accounting';
      let workspace = 'workbench';
      if (a.entityType === 'purchase_order') {
        title = `تأیید فاکتور خرید شماره ${a.entityId}`;
        workspace = 'purchases';
      } else if (a.entityType === 'vendor_invoice_match') {
        title = `مغایرت فاکتور و رسید بار شماره ${a.entityId}`;
        workspace = 'purchases';
      } else if (a.entityType === 'recipe_version') {
        title = 'تأیید نسخه جدید دستور تهیه';
        tab = 'inventory';
        workspace = 'costing';
      } else if (a.entityType === 'cost_accrual' || a.entityType === 'cost_payment') {
        title = 'تأیید سند هزینه و پرداخت تنخواه';
        workspace = 'purchases';
      } else if (a.entityType === 'supplier_payment') {
        title = 'تأیید پرداخت به تأمین‌کننده';
        workspace = 'purchases';
      } else if (a.operation === 'reopen_fiscal_period') {
        title = 'درخواست بازگشایی دوره مالی';
        workspace = 'reports';
      }

      items.push({
        id: `approval-${a.id}`,
        category: 'approval',
        priority: a.operation === 'reopen_fiscal_period' ? 'urgent' : 'high',
        title,
        description: `درخواست‌شده توسط ${a.requestedBy || 'کاربر سیستم'} • نیاز به تأیید نهایی مدیر`,
        tab,
        workspace,
        actionLabel: 'بررسی و تأیید',
        createdAt: a.createdAt || new Date().toISOString(),
      });
    }

    // 2. Blocked or failed finance events
    const unresolvedEvents = (state.events || []).filter(
      (e) => ['blocked', 'failed'].includes(e.status) && (!bid || !e.branchId || Number(e.branchId) === bid)
    );
    if (unresolvedEvents.length > 0) {
      items.push({
        id: 'blocked-finance-events',
        category: 'attention',
        priority: 'high',
        title: `${unresolvedEvents.length} رویداد مالی مسدود یا متوقف‌شده`,
        description: 'اسناد یا تراکنش‌های مالی دارای خطا نیازمند رفع مسدودی در میزکار مالی هستند.',
        tab: 'accounting',
        workspace: 'workbench',
        actionLabel: 'میزکار مالی',
        createdAt: unresolvedEvents[0]?.occurredAt || new Date().toISOString(),
      });
    }

    // 3. Receivable Purchase Orders
    const pendingPOs = (state.purchaseOrders || []).filter(
      (po) => ['approved', 'partially_received'].includes(po.status) && (!bid || !po.branchId || Number(po.branchId) === bid)
    );
    if (pendingPOs.length > 0) {
      items.push({
        id: 'receivable-pos',
        category: 'attention',
        priority: 'medium',
        title: `${pendingPOs.length} محموله خرید آماده تحویل بار`,
        description: 'کالاهای سفارش‌داده‌شده رسیده به مجموعه نیازمند ثبت رسید بار در بخش انبار هستند.',
        tab: 'inventory',
        workspace: 'purchases',
        actionUrl: `/admin/kitchen?view=inventory${bid ? `&branchId=${bid}` : ''}`,
        actionLabel: 'ثبت رسید بار',
        createdAt: pendingPOs[0]?.createdAt || new Date().toISOString(),
      });
    }

    // 4. Draft Journal Entries
    const draftJournals = (state.journalEntries || []).filter(
      (j) => j.status === 'draft' && (!bid || !j.branchId || Number(j.branchId) === bid)
    );
    if (draftJournals.length > 0) {
      items.push({
        id: 'draft-journals',
        category: 'approval',
        priority: 'medium',
        title: `${draftJournals.length} سند حسابداری در انتظار ثبت نهایی`,
        description: 'اسناد پیش‌نویس مالی آماده بررسی تراز و تأیید ثبت در دفتر کل هستند.',
        tab: 'accounting',
        workspace: 'reports',
        actionLabel: 'دفتر اسناد',
        createdAt: draftJournals[0]?.date || new Date().toISOString(),
      });
    }
  }

  // 5. Critical inventory shortages
  try {
    const inv = financeV2.inventoryItemsView(db, { branchId: bid });
    const lowItems = (inv?.items || []).filter(
      (item) => Number(item.availableQuantity) <= Number(item.reorderPoint)
    );
    if (lowItems.length > 0) {
      const names = lowItems.slice(0, 3).map((i) => `${i.name} (${i.availableQuantity} ${i.unit})`).join('، ');
      items.push({
        id: 'low-stock-alert',
        category: 'attention',
        priority: lowItems.some((i) => Number(i.availableQuantity) <= 0) ? 'urgent' : 'high',
        title: `هشدار کسری موجودی (${lowItems.length} قلم کالا)`,
        description: `موجودی به زیر نقطهٔ سفارش رسیده است: ${names}${lowItems.length > 3 ? ' و...' : ''}`,
        tab: 'inventory',
        actionLabel: 'مشاهده انبار',
        createdAt: new Date().toISOString(),
      });
    }
  } catch (_) {}

  // 6. Reservations pending confirmation
  const pendingRes = (db.reservations || []).filter(
    (r) => r.status === 'pending' && (!bid || Number(r.branchId) === bid)
  );
  if (pendingRes.length > 0) {
    const summaryText = pendingRes
      .slice(0, 2)
      .map((r) => `${r.name || 'مهمان'} (${r.partySize || 2} نفر برای ${r.date} ${r.time})`)
      .join(' | ');
    items.push({
      id: 'pending-reservations',
      category: 'approval',
      priority: 'high',
      title: `${pendingRes.length} رزرو میز جدید نیازمند بررسی`,
      description: summaryText + (pendingRes.length > 2 ? ` و ${pendingRes.length - 2} مورد دیگر` : ''),
      tab: 'reservations',
      actionLabel: 'بررسی رزروها',
      createdAt: pendingRes[0]?.createdAt || new Date().toISOString(),
    });
  }

  // 7. Feedback needing attention
  let fbList = db.feedback || [];
  if (bid) fbList = fbList.filter((f) => Number(f.branchId) === bid);
  const newFeedback = fbList.filter((f) => f.status === 'new' || f.reviewed === false);
  const lowScoreFeedback = fbList.filter((f) => Number(f.score) <= 6 && Number(f.score) > 0);
  if (newFeedback.length > 0 || lowScoreFeedback.length > 0) {
    const totalIssues = newFeedback.length || lowScoreFeedback.length;
    items.push({
      id: 'feedback-attention',
      category: 'attention',
      priority: lowScoreFeedback.length > 0 ? 'high' : 'medium',
      title: `${totalIssues} بازخورد مشتریان نیازمند توجه`,
      description: lowScoreFeedback.length > 0
        ? `${lowScoreFeedback.length} نظر با امتیاز پایین ثبت شده که نیازمند پیگیری و رسیدگی مدیر است.`
        : 'نظرات جدید دریافت شده توسط مشتریان نیازمند بازبینی است.',
      tab: 'feedback',
      actionLabel: 'مشاهده بازخوردها',
      createdAt: (newFeedback[0] || lowScoreFeedback[0])?.createdAt || new Date().toISOString(),
    });
  }

  // 8. Delayed active orders
  const activeOrders = (db.orders || []).filter(
    (o) => ['pending', 'preparing'].includes(o.status) && (!bid || Number(o.branchId) === bid)
  );
  const delayedOrders = activeOrders.filter((o) => {
    const ageMin = (Date.now() - new Date(o.createdAt).getTime()) / 60000;
    return ageMin >= 30;
  });
  if (delayedOrders.length > 0) {
    items.push({
      id: 'delayed-orders',
      category: 'attention',
      priority: 'urgent',
      title: `${delayedOrders.length} سفارش معطل بیش از ۳۰ دقیقه`,
      description: 'سفارش‌های ثبت‌شده با زمان انتظار بالا نیازمند تسریع در بخش سفارش‌ها یا آشپزخانه است.',
      tab: 'orders',
      actionLabel: 'مشاهده سفارش‌ها',
      createdAt: delayedOrders[0]?.createdAt || new Date().toISOString(),
    });
  }

  // Priority sorting: urgent -> high -> medium -> low
  const priorityWeight = { urgent: 4, critical: 4, high: 3, medium: 2, low: 1 };
  items.sort((a, b) => (priorityWeight[b.priority] || 0) - (priorityWeight[a.priority] || 0));

  res.json({
    ok: true,
    summary: {
      total: items.length,
      approvals: items.filter((i) => i.category === 'approval').length,
      attention: items.filter((i) => i.category === 'attention').length,
      critical: items.filter((i) => ['urgent', 'critical', 'high'].includes(i.priority)).length,
    },
    items,
  });
});

/* ---- Restaurant profile / hours / tables / promos / analytics ---- */
app.get('/api/admin/restaurant', requireAdmin, (req, res) => {
  const branch = resolveBranch(req.query.branchId || req.query.branch);
  res.json({
    restaurant: db.restaurant,
    hours: branch?.hours || db.hours,
    branch,
    branches: db.branches || [],
  });
});
app.put('/api/admin/restaurant', requireAdmin, (req, res) => {
  const r = req.body.restaurant || {};
  const keys = [
    'name', 'brandName', 'tagline', 'about', 'address', 'phone', 'whatsapp',
    'instagram', 'website', 'mapUrl', 'currency',
  ];
  for (const k of keys) {
    if (typeof r[k] === 'string') db.restaurant[k] = r[k].trim().slice(0, k === 'about' ? 2000 : 200);
  }
  const parsePct = (v) => {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return isNaN(v) ? null : v;
    const n = Number(normalizeDigits(String(v)).replace(/[,٬_\s]/g, '').trim());
    return isNaN(n) ? null : n;
  };
  const taxPct = parsePct(r.taxPercent);
  if (taxPct != null) db.restaurant.taxPercent = Math.max(0, Math.min(100, taxPct));
  const svcPct = parsePct(r.servicePercent);
  if (svcPct != null) db.restaurant.servicePercent = Math.max(0, Math.min(100, svcPct));
  save();
  res.json({ ok: true, restaurant: db.restaurant });
});
app.put('/api/admin/hours', requireAdmin, (req, res) => {
  const days = ['sat', 'sun', 'mon', 'tue', 'wed', 'thu', 'fri'];
  const incoming = req.body.hours || {};
  const branch = resolveBranch(req.body.branchId || req.query.branchId);
  if (!branch) return res.status(400).json({ error: 'شعبه یافت نشد' });
  if (!branch.hours) branch.hours = defaultHoursTemplate();
  for (const d of days) {
    if (!incoming[d]) continue;
    const cur = branch.hours[d] || { open: '10:00', close: '23:00', closed: false };
    if (typeof incoming[d].open === 'string') cur.open = incoming[d].open.slice(0, 5);
    if (typeof incoming[d].close === 'string') cur.close = incoming[d].close.slice(0, 5);
    if (typeof incoming[d].closed === 'boolean') cur.closed = incoming[d].closed;
    branch.hours[d] = cur;
  }
  syncLegacyHours();
  save();
  res.json({ ok: true, hours: branch.hours, branchId: branch.id });
});

app.get('/api/admin/tables', requireAdmin, (req, res) => {
  let tables = db.tables || [];
  if (req.query.branchId) {
    const bid = Number(req.query.branchId);
    tables = tables.filter((t) => Number(t.branchId) === bid);
  }
  res.json({ tables, branches: db.branches || [] });
});
app.put('/api/admin/tables', requireAdmin, (req, res) => {
  if (!Array.isArray(req.body.tables)) return res.status(400).json({ error: 'tables required' });
  const parseNum = (v, fb = 0) => {
    if (v == null || v === '') return fb;
    if (typeof v === 'number') return isNaN(v) ? fb : v;
    const n = Number(normalizeDigits(String(v)).replace(/[,٬_\s]/g, '').trim());
    return isNaN(n) ? fb : n;
  };
  const bid = Math.round(parseNum(req.body.branchId, defaultBranch()?.id || 1));
  const others = (db.tables || []).filter((t) => Number(t.branchId) !== bid);
  const existingMap = new Map((db.tables || []).map((t) => [Number(t.id), t]));
  const updated = req.body.tables.slice(0, 80).map((t, i) => {
    const id = Math.round(parseNum(t.id, i + 1));
    const prev = existingMap.get(id) || {};
    const item = {
      ...prev,
      id,
      label: String(t.label || `میز ${i + 1}`).slice(0, 40),
      seats: Math.max(1, Math.min(24, Math.round(parseNum(t.seats, 4)))),
      zone: String(t.zone || 'سالن').slice(0, 40),
      active: t.active !== false,
      branchId: bid,
    };
    if (typeof t.x === 'number') item.x = Math.max(0, Math.min(100, Math.round(t.x * 10) / 10));
    if (typeof t.y === 'number') item.y = Math.max(0, Math.min(100, Math.round(t.y * 10) / 10));
    if (t.shape) item.shape = String(t.shape).slice(0, 20);
    if (t.chairModel) item.chairModel = String(t.chairModel).slice(0, 25);
    if (typeof t.chairScale === 'number') item.chairScale = Math.max(0.6, Math.min(2.0, Math.round(t.chairScale * 100) / 100));
    if (typeof t.tableScale === 'number') item.tableScale = Math.max(0.6, Math.min(2.5, Math.round(t.tableScale * 100) / 100));
    if (typeof t.rotation === 'number') item.rotation = Math.round(t.rotation) % 360;
    if (t.floorId) item.floorId = String(t.floorId).slice(0, 40);
    if (Array.isArray(t.mergedWith)) item.mergedWith = t.mergedWith.map((x) => Number(x) || String(x));
    if (t.mergedInto !== undefined) item.mergedInto = t.mergedInto ? (Number(t.mergedInto) || String(t.mergedInto)) : null;
    if (Array.isArray(t.tags)) item.tags = t.tags.slice(0, 10).map((x) => String(x).slice(0, 30));
    return item;
  });
  db.tables = [...others, ...updated].sort((a, b) => a.id - b.id);
  save();
  res.json({ ok: true, tables: updated });
});
app.post('/api/admin/tables', requireAdmin, (req, res) => {
  const parseNum = (v, fb = 0) => {
    if (v == null || v === '') return fb;
    if (typeof v === 'number') return isNaN(v) ? fb : v;
    const n = Number(normalizeDigits(String(v)).replace(/[,٬_\s]/g, '').trim());
    return isNaN(n) ? fb : n;
  };
  const id = Math.max(0, ...db.tables.map((t) => Number(t.id) || 0), 0) + 1;
  const branchId = Math.round(parseNum(req.body.branchId, defaultBranch()?.id || 1));
  const table = {
    id,
    label: String(req.body.label || `میز ${id}`).slice(0, 40),
    seats: Math.max(1, Math.min(24, Math.round(parseNum(req.body.seats, 4)))),
    zone: String(req.body.zone || 'سالن').slice(0, 40),
    active: true,
    branchId,
  };
  if (typeof req.body.x === 'number') table.x = Math.max(0, Math.min(100, Math.round(req.body.x * 10) / 10));
  if (typeof req.body.y === 'number') table.y = Math.max(0, Math.min(100, Math.round(req.body.y * 10) / 10));
  if (req.body.shape) table.shape = String(req.body.shape).slice(0, 20);
  if (req.body.chairModel) table.chairModel = String(req.body.chairModel).slice(0, 25);
  if (typeof req.body.chairScale === 'number') table.chairScale = Math.max(0.6, Math.min(2.0, Math.round(req.body.chairScale * 100) / 100));
  if (typeof req.body.tableScale === 'number') table.tableScale = Math.max(0.6, Math.min(2.5, Math.round(req.body.tableScale * 100) / 100));
  if (typeof req.body.rotation === 'number') table.rotation = Math.round(req.body.rotation) % 360;
  if (req.body.floorId) table.floorId = String(req.body.floorId).slice(0, 40);
  if (Array.isArray(req.body.tags)) table.tags = req.body.tags.slice(0, 10).map((x) => String(x).slice(0, 30));
  db.tables.push(table);
  save();
  res.json({ ok: true, table });
});
app.delete('/api/admin/tables/:id', requireAdmin, (req, res) => {
  const targetId = Number(normalizeDigits(String(req.params.id || '')).replace(/\D/g, ''));
  const rawBranch = requestBranchValue(req);
  const branch = rawBranch ? resolveBranchExact(rawBranch) : null;
  db.tables = db.tables.filter((t) => {
    if (Number(t.id) !== targetId) return true;
    if (branch && t.branchId && Number(t.branchId) !== Number(branch.id)) return true;
    return false;
  });
  save();
  res.json({ ok: true });
});

// QR artwork is generated on the server so the admin can print/download a
// standards-compliant PNG without relying on a third-party image service.
app.get('/api/admin/qr-code', requireCapability('tables.view'), async (req, res) => {
  const data = String(req.query.data || '').trim();
  if (!data || data.length > 1200) {
    return res.status(400).json({ error: 'مقصد QR نامعتبر یا بیش از حد طولانی است' });
  }

  const hexColor = (value, fallback) => {
    const candidate = String(value || '').trim();
    return /^#[0-9a-f]{6}$/i.test(candidate) ? candidate : fallback;
  };
  const errorCorrectionLevel = ['L', 'M', 'Q', 'H'].includes(String(req.query.ecl || '').toUpperCase())
    ? String(req.query.ecl).toUpperCase()
    : 'M';
  const width = Math.max(256, Math.min(1600, Math.round(Number(req.query.width) || 768)));
  const margin = Math.max(2, Math.min(12, Math.round(Number(req.query.margin) || 5)));
  const dark = hexColor(req.query.dark, '#11181b');
  const light = hexColor(req.query.light, '#ffffff');

  try {
    const png = await QRCode.toBuffer(data, {
      type: 'png',
      width,
      margin,
      errorCorrectionLevel,
      color: { dark, light },
    });
    const filename = String(req.query.filename || 'westo-table-qr')
      .replace(/[^a-z0-9_-]+/gi, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'westo-table-qr';
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', `${req.query.download === '1' ? 'attachment' : 'inline'}; filename="${filename}.png"`);
    return res.send(png);
  } catch (error) {
    return res.status(400).json({ error: error?.message || 'ساخت QR ممکن نشد' });
  }
});

/* ---- Branches (چندشعبه) ---- */
app.get('/api/branches', (req, res) => {
  const list = (db.branches || [])
    .filter((b) => req.query.all === '1' || b.active !== false)
    .map((b) => ({
      id: b.id,
      slug: b.slug,
      name: b.name,
      address: b.address,
      phone: b.phone,
      active: b.active !== false,
    }));
  res.json({ branches: list });
});

app.get('/api/admin/branches', requireAdmin, (req, res) => {
  res.json({ branches: db.branches || [] });
});

app.post('/api/admin/branches', requireAdmin, (req, res) => {
  const id = Math.max(0, ...(db.branches || []).map((b) => b.id), 0) + 1;
  let slug = String(req.body.slug || `branch-${id}`)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .slice(0, 40);
  if (!slug) slug = `branch-${id}`;
  if ((db.branches || []).some((b) => b.slug === slug)) {
    return res.status(400).json({ error: 'اسلاگ تکراری است' });
  }
  const branch = {
    id,
    slug,
      name: String(req.body.name || `شعبه ${id}`).trim().slice(0, 80),
      address: String(req.body.address || '').trim().slice(0, 200),
    phone: String(req.body.phone || '').trim().slice(0, 40),
    whatsapp: String(req.body.whatsapp || '').trim().slice(0, 40),
    mapUrl: String(req.body.mapUrl || '').trim().slice(0, 500),
    active: req.body.active !== false,
    hours: req.body.hours && typeof req.body.hours === 'object'
      ? req.body.hours
      : defaultHoursTemplate(),
  };
  db.branches.push(branch);
  save();
  res.json({ ok: true, branch });
});

app.put('/api/admin/branches/:id', requireAdmin, (req, res) => {
  const targetId = Number(normalizeDigits(String(req.params.id || '')).replace(/\D/g, ''));
  const branch = (db.branches || []).find((b) => Number(b.id) === targetId);
  if (!branch) return res.status(404).json({ error: 'not found' });
  if (typeof req.body.name === 'string') branch.name = req.body.name.trim().slice(0, 80);
  if (typeof req.body.address === 'string') branch.address = req.body.address.trim().slice(0, 200);
  if (typeof req.body.phone === 'string') branch.phone = req.body.phone.trim().slice(0, 40);
  if (typeof req.body.whatsapp === 'string') branch.whatsapp = req.body.whatsapp.trim().slice(0, 40);
  if (typeof req.body.mapUrl === 'string') branch.mapUrl = req.body.mapUrl.trim().slice(0, 500);
  if (typeof req.body.active === 'boolean') branch.active = req.body.active;
  if (typeof req.body.slug === 'string') {
    const slug = req.body.slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 40);
    if (slug && !(db.branches || []).some((b) => b.slug === slug && b.id !== branch.id)) {
      branch.slug = slug;
    }
  }
  if (req.body.hours && typeof req.body.hours === 'object') {
    const days = ['sat', 'sun', 'mon', 'tue', 'wed', 'thu', 'fri'];
    if (!branch.hours) branch.hours = defaultHoursTemplate();
    for (const d of days) {
      if (!req.body.hours[d]) continue;
      branch.hours[d] = {
        open: String(req.body.hours[d].open || '10:00').slice(0, 5),
        close: String(req.body.hours[d].close || '23:00').slice(0, 5),
        closed: !!req.body.hours[d].closed,
      };
    }
    syncLegacyHours();
  }
  save();
  res.json({ ok: true, branch });
});

app.delete('/api/admin/branches/:id', requireAdmin, (req, res) => {
  const id = Number(normalizeDigits(String(req.params.id || '')).replace(/\D/g, ''));
  if ((db.branches || []).length <= 1) {
    return res.status(400).json({ error: 'حداقل یک شعبه لازم است' });
  }
  const fallback = (db.branches || []).find((b) => Number(b.id) !== id);
  db.branches = (db.branches || []).filter((b) => Number(b.id) !== id);
  for (const t of db.tables || []) {
    if (Number(t.branchId) === id) t.branchId = fallback ? fallback.id : 1;
  }
  for (const o of db.orders || []) {
    if (Number(o.branchId) === id) o.branchId = fallback ? fallback.id : 1;
  }
  syncLegacyHours();
  save();
  res.json({ ok: true });
});

app.get('/api/admin/promotions', requireAdmin, (req, res) => {
  res.json({ promotions: db.promotions || [] });
});
app.post('/api/admin/promotions', requireAdmin, (req, res) => {
  const id = Math.max(0, ...(db.promotions || []).map((p) => Number(p.id) || 0), 0) + 1;
  const parsePct = (v) => {
    if (v == null || v === '') return 0;
    if (typeof v === 'number') return isNaN(v) ? 0 : v;
    const n = Number(normalizeDigits(String(v)).replace(/[,٬_\s]/g, '').trim());
    return isNaN(n) ? 0 : n;
  };
  const promo = {
    id,
    title: String(req.body.title || '').trim().slice(0, 120),
    percent: Math.max(0, Math.min(90, Math.round(parsePct(req.body.percent)))),
    code: String(req.body.code || '').trim().slice(0, 32).toUpperCase(),
    active: req.body.active !== false,
    startsAt: req.body.startsAt || new Date().toISOString(),
    endsAt: req.body.endsAt || null,
    createdAt: new Date().toISOString(),
  };
  if (!promo.title) return res.status(400).json({ error: 'عنوان الزامی است' });
  db.promotions = db.promotions || [];
  db.promotions.unshift(promo);
  save();
  res.json({ ok: true, promo });
});
app.patch('/api/admin/promotions/:id', requireAdmin, (req, res) => {
  const targetId = Number(normalizeDigits(String(req.params.id || '')).replace(/\D/g, ''));
  const promo = (db.promotions || []).find((p) => Number(p.id) === targetId);
  if (!promo) return res.status(404).json({ error: 'not found' });
  if (typeof req.body.title === 'string') promo.title = req.body.title.trim().slice(0, 120);
  if (req.body.percent != null) {
    const rawPct = typeof req.body.percent === 'number'
      ? req.body.percent
      : Number(normalizeDigits(String(req.body.percent)).replace(/[,٬_\s]/g, '').trim());
    if (!isNaN(rawPct)) {
      promo.percent = Math.max(0, Math.min(90, Math.round(rawPct)));
    }
  }
  if (typeof req.body.code === 'string') promo.code = req.body.code.trim().slice(0, 32).toUpperCase();
  if (typeof req.body.active === 'boolean') promo.active = req.body.active;
  if (req.body.endsAt !== undefined) promo.endsAt = req.body.endsAt;
  save();
  res.json({ ok: true, promo });
});
app.delete('/api/admin/promotions/:id', requireAdmin, (req, res) => {
  const targetId = Number(normalizeDigits(String(req.params.id || '')).replace(/\D/g, ''));
  db.promotions = (db.promotions || []).filter((p) => Number(p.id) !== targetId);
  save();
  res.json({ ok: true });
});

app.get('/api/admin/promo-slides', requireCapability('content.manage'), (req, res) => {
  const branchId = req.query.branchId ? Number(req.query.branchId) : null;
  const slides = (db.promoSlides || [])
    .filter((slide) => !branchId || slide.branchId == null || Number(slide.branchId) === branchId)
    .sort((a, b) => (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0) || Number(a.id) - Number(b.id));
  res.json({ slides, branches: db.branches || [] });
});

app.post('/api/admin/promo-slides', requireCapability('content.manage'), (req, res) => {
  const id = nextId(db.promoSlides || []);
  const base = {
    id, title: '', subtitle: '', badge: '', image: '', ctaLabel: '', actionType: 'none',
    actionValue: '', kind: 'general', placement: 'entrance', shareEnabled: true, enabled: true, status: 'published', startAt: null, endAt: null,
    branchId: null, sortOrder: (db.promoSlides || []).length, autoplayMs: 0, impressions: 0, clicks: 0,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  const slide = sanitizePromoSlideInput(req.body || {}, base);
  if (!slide.title && !slide.image) return res.status(400).json({ error: 'عنوان یا تصویر الزامی است' });
  db.promoSlides = db.promoSlides || [];
  db.promoSlides.push(slide);
  save();
  res.json({ ok: true, slide });
});

app.patch('/api/admin/promo-slides/:id', requireCapability('content.manage'), (req, res) => {
  const targetId = Number(normalizeDigits(String(req.params.id || '')).replace(/\D/g, ''));
  const index = (db.promoSlides || []).findIndex((slide) => Number(slide.id) === targetId);
  if (index < 0) return res.status(404).json({ error: 'not found' });
  const updated = sanitizePromoSlideInput(req.body || {}, db.promoSlides[index]);
  updated.updatedAt = new Date().toISOString();
  db.promoSlides[index] = updated;
  save();
  res.json({ ok: true, slide: updated });
});

app.delete('/api/admin/promo-slides/:id', requireCapability('content.manage'), (req, res) => {
  const targetId = Number(normalizeDigits(String(req.params.id || '')).replace(/\D/g, ''));
  db.promoSlides = (db.promoSlides || []).filter((slide) => Number(slide.id) !== targetId);
  save();
  res.json({ ok: true });
});

app.post('/api/admin/promo-slides/reorder', requireCapability('content.manage'), (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids.map(Number).filter(Number.isFinite) : [];
  if (!ids.length) return res.status(400).json({ error: 'ids required' });
  const order = new Map(ids.map((id, index) => [id, index]));
  for (const slide of db.promoSlides || []) {
    if (order.has(Number(slide.id))) slide.sortOrder = order.get(Number(slide.id));
  }
  save();
  res.json({ ok: true });
});

app.post('/api/promo-slides/:id/impression', (req, res) => {
  const targetId = Number(normalizeDigits(String(req.params.id || '')).replace(/\D/g, ''));
  const slide = (db.promoSlides || []).find((item) => Number(item.id) === targetId);
  if (slide) { slide.impressions = (Number(slide.impressions) || 0) + 1; save(); }
  res.status(204).end();
});

app.post('/api/promo-slides/:id/click', (req, res) => {
  const targetId = Number(normalizeDigits(String(req.params.id || '')).replace(/\D/g, ''));
  const slide = (db.promoSlides || []).find((item) => Number(item.id) === targetId);
  if (slide) { slide.clicks = (Number(slide.clicks) || 0) + 1; save(); }
  res.status(204).end();
});

/* Bulk price update — percent or absolute delta */
app.post('/api/admin/prices/bulk', requireAdmin, (req, res) => {
  const mode = req.body.mode === 'set' ? 'set' : req.body.mode === 'delta' ? 'delta' : 'percent';
  const parseNum = (v) => {
    if (v == null || v === '') return NaN;
    if (typeof v === 'number') return v;
    return Number(normalizeDigits(String(v)).replace(/[,٬_\s]/g, '').trim());
  };
  const value = parseNum(req.body.value);
  const rawCat = req.body.categoryId != null ? req.body.categoryId : null;
  const categoryId = rawCat != null && rawCat !== ''
    ? Number(normalizeDigits(String(rawCat)).replace(/\D/g, ''))
    : null;
  if (!Number.isFinite(value)) return res.status(400).json({ error: 'مقدار نامعتبر' });
  let n = 0;
  for (const item of (db.menuItems || [])) {
    if (categoryId != null && Number(item.categoryId) !== categoryId) continue;
    if (mode === 'percent') item.price = Math.max(0, Math.round(item.price * (1 + value / 100)));
    else if (mode === 'delta') item.price = Math.max(0, Math.round(item.price + value));
    else item.price = Math.max(0, Math.round(value));
    n += 1;
  }
  save();
  res.json({ ok: true, updated: n });
});

/* Public analytics beacon + admin analytics */
app.post('/api/analytics/visit', (req, res) => {
  const pathName = String(req.body.path || '/').slice(0, 200);
  const referrer = String(req.body.referrer || '').slice(0, 300);
  const sessionId = String(req.body.sessionId || crypto.randomBytes(8).toString('hex')).slice(0, 64);
  const ua = String(req.headers['user-agent'] || '').slice(0, 200);
  const at = new Date().toISOString();
  db.visits = db.visits || [];
  db.visits.unshift({ at, path: pathName, referrer, sessionId, ua });
  db.visits = db.visits.slice(0, 5000);
  db.visitSessions = db.visitSessions || {};
  db.visitSessions[sessionId] = at;
  // prune old session map
  const keys = Object.keys(db.visitSessions);
  if (keys.length > 8000) {
    for (const k of keys.slice(0, keys.length - 4000)) delete db.visitSessions[k];
  }
  save();
  res.json({ ok: true });
});

/* Debug-mode NDJSON ingest. Never expose this development aid in production. */
if (process.env.NODE_ENV !== 'production') {
  app.post('/api/debug-log', (req, res) => {
    try {
      const payload = req.body && typeof req.body === 'object' ? req.body : {};
      const line = JSON.stringify({
        sessionId: String(payload.sessionId || 'local').slice(0, 80),
        runId: String(payload.runId || 'local').slice(0, 80),
        hypothesisId: String(payload.hypothesisId || '').slice(0, 120),
        location: String(payload.location || '').slice(0, 200),
        message: String(payload.message || '').slice(0, 300),
        data: payload.data && typeof payload.data === 'object' ? payload.data : {},
        timestamp: Number(payload.timestamp) || Date.now(),
      });
      const logPath = path.join(ROOT, '.cursor', 'debug-local.log');
      fs.mkdirSync(path.dirname(logPath), { recursive: true });
      fs.appendFileSync(logPath, line.slice(0, 12000) + '\n');
    } catch (_) {}
    res.status(204).end();
  });
}

app.get('/api/admin/analytics', requireAdmin, (req, res) => {
  const days = Math.min(30, Math.max(1, Number(req.query.days) || 7));
  const since = Date.now() - days * 24 * 3600 * 1000;
  const visits = (db.visits || []).filter((v) => new Date(v.at).getTime() >= since);
  const byDay = {};
  const byPath = {};
  const byHour = Array.from({ length: 24 }, () => 0);
  for (const v of visits) {
    const d = v.at.slice(0, 10);
    byDay[d] = (byDay[d] || 0) + 1;
    byPath[v.path] = (byPath[v.path] || 0) + 1;
    byHour[new Date(v.at).getHours()] += 1;
  }
  const sessions = new Set(visits.map((v) => v.sessionId)).size;
  res.json({
    days,
    total: visits.length,
    sessions,
    byDay,
    byHour,
    topPaths: Object.entries(byPath)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([path, count]) => ({ path, count })),
    recent: visits.slice(0, 40),
  });
});

/* Public restaurant info for site/footer if needed */
app.get('/api/restaurant', (req, res) => {
  res.json(publicRestaurantPayload(req.query.branch || req.query.branchId));
});

app.get('/api/theme', (req, res) => {
  res.json({ theme: db.theme || {} });
});

app.get('/api/admin/theme', requireAdmin, (req, res) => {
  res.json({ theme: db.theme || {} });
});

app.put('/api/admin/theme', requireAdmin, (req, res) => {
  const t = req.body.theme || {};
  if (!db.theme) db.theme = {};
  const colorKeys = ['accent', 'accentInk', 'surface', 'bg', 'fog', 'printPaper', 'printInk', 'printAccent'];
  const hex = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
  for (const k of colorKeys) {
    if (typeof t[k] === 'string' && hex.test(t[k].trim())) db.theme[k] = t[k].trim();
  }
  if (t.radius != null) {
    const rawRadius = typeof t.radius === 'number'
      ? t.radius
      : Number(normalizeDigits(String(t.radius)).replace(/[,٬_\s]/g, '').trim());
    if (!isNaN(rawRadius)) {
      db.theme.radius = Math.max(0, Math.min(28, Math.round(rawRadius)));
    }
  }
  if (typeof t.fontDisplay === 'string') db.theme.fontDisplay = t.fontDisplay.trim().slice(0, 40) || 'Vazirmatn';
  save();
  res.json({ ok: true, theme: db.theme });
});

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      fs.mkdirSync(UPLOADS, { recursive: true });
      cb(null, UPLOADS);
    },
    filename: (req, file, cb) => {
      const extByMime = { 'image/jpeg': '.jpg', 'image/jpg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };
      const ext = extByMime[String(file.mimetype || '').toLowerCase()] || '.bin';
      cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`);
    },
  }),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /^image\/(jpeg|jpg|png|webp|gif)$/i.test(file.mimetype || '');
    cb(ok ? null : new Error('فقط تصویر JPEG/PNG/WebP/GIF مجاز است'), ok);
  },
});
app.post('/api/admin/upload', requireAdmin, (req, res) => {
  upload.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || 'آپلود ناموفق' });
    if (!req.file) return res.status(400).json({ error: 'no file' });
    res.json({ ok: true, path: `uploads/${req.file.filename}` });
  });
});
app.get('/api/admin/uploads', requireAdmin, (req, res) => {
  fs.mkdirSync(UPLOADS, { recursive: true });
  const files = fs.readdirSync(UPLOADS).map((f) => ({ path: `uploads/${f}`, size: fs.statSync(path.join(UPLOADS, f)).size }));
  res.json({ files });
});


app.get('/api/admin/settings', requireAdmin, (req, res) => res.json({ settings: db.settings, loyalty: db.loyalty }));
app.put('/api/admin/settings', requireAdmin, (req, res) => {
  const s = req.body.settings || {};
  if (typeof s.siteTitle === 'string') db.settings.siteTitle = s.siteTitle;
  if (typeof s.metaDescription === 'string') db.settings.metaDescription = s.metaDescription;
  if (Array.isArray(s.adminPhones) && s.adminPhones.length) {
    const phones = s.adminPhones.map((p) => normalizeDigits(p).trim());
    if (phones.every((p) => PHONE_RE.test(p))) db.settings.adminPhones = phones;
  }
  const L = req.body.loyalty || {};
  if (!db.loyalty) db.loyalty = {};
  if (typeof L.enabled === 'boolean') db.loyalty.enabled = L.enabled;
  if (typeof L.pointsPerToman === 'number') db.loyalty.pointsPerToman = Math.max(0, Math.min(1, L.pointsPerToman));
  if (typeof L.redeemValue === 'number') db.loyalty.redeemValue = Math.max(0, Math.round(L.redeemValue));
  if (typeof L.welcomePoints === 'number') db.loyalty.welcomePoints = Math.max(0, Math.round(L.welcomePoints));
  save();
  res.json({ ok: true, settings: db.settings, loyalty: db.loyalty });
});

/* ---- Loyalty club ---- */
app.get('/api/admin/inventory', requireAdmin, (req, res) => {
  const cats = Object.fromEntries((db.menuCategories || []).map((c) => [c.id, c.title]));
  const items = (db.menuItems || []).map((m) => ({
    id: m.id,
    name: m.name,
    categoryId: m.categoryId,
    category: cats[m.categoryId] || String(m.categoryId),
    stock: m.stock === undefined ? null : m.stock,
    lowStockAt: m.lowStockAt ?? 5,
    available: m.available !== false,
    tracked: typeof m.stock === 'number',
    low:
      typeof m.stock === 'number' &&
      m.stock > 0 &&
      m.stock <= (m.lowStockAt ?? 5),
    empty: m.stock === 0,
  }));
  res.json({
    items,
    summary: {
      tracked: items.filter((i) => i.tracked).length,
      low: items.filter((i) => i.low).length,
      empty: items.filter((i) => i.empty).length,
      unlimited: items.filter((i) => !i.tracked).length,
    },
  });
});

app.post('/api/admin/inventory/adjust', requireAdmin, (req, res) => {
  const targetId = Number(normalizeDigits(String(req.body.id || '')).replace(/\D/g, ''));
  const item = (db.menuItems || []).find((m) => Number(m.id) === targetId);
  if (!item) return res.status(404).json({ error: 'not found' });
  const parseNum = (v) => {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return isNaN(v) ? null : v;
    const n = Number(normalizeDigits(String(v)).replace(/[,٬_\s]/g, '').trim());
    return isNaN(n) ? null : n;
  };
  if (req.body.stock === null || req.body.mode === 'unlimited') {
    item.stock = null;
  } else if (req.body.mode === 'set') {
    const s = parseNum(req.body.stock);
    item.stock = Math.max(0, Math.round(s ?? 0));
  } else {
    const delta = Math.round(parseNum(req.body.delta) ?? 0);
    const base = typeof item.stock === 'number' ? item.stock : 0;
    item.stock = Math.max(0, base + delta);
  }
  if (item.stock === 0) item.available = false;
  else if (typeof item.stock === 'number' && item.stock > 0 && req.body.restock === true) {
    item.available = true;
  }
  const lowStock = parseNum(req.body.lowStockAt);
  if (lowStock != null) item.lowStockAt = Math.max(0, Math.round(lowStock));
  save();
  res.json({ ok: true, item });
});

app.get('/api/admin/loyalty', requireAdmin, (req, res) => {
  const rawMembers = db.users.map(publicUser).sort((a, b) => b.points - a.points);
  const members = rawMembers.map((m) => {
    const tierInfo = loyaltyEngine.resolveCustomerTier(db, m);
    return {
      ...m,
      tier: tierInfo.tier,
      nextTier: tierInfo.nextTier,
      progressPct: tierInfo.progressPct,
      pointsToNext: tierInfo.pointsToNext,
      multiplier: tierInfo.multiplier,
      discountPct: tierInfo.discountPct,
      badge: tierInfo.badge,
    };
  });
  const tiers = loyaltyEngine.summarizeTiersMembership(db, rawMembers);
  res.json({
    loyalty: {
      ...(db.loyalty || {}),
      tiers: loyaltyEngine.getLoyaltyTiers(db),
    },
    tiers,
    members,
    ledger: (db.loyaltyLedger || []).slice(0, 80),
    totals: {
      members: members.filter((m) => m.points > 0).length,
      pointsIssued: members.reduce((s, m) => s + m.points, 0),
    },
  });
});

app.get('/api/admin/club', requireAdmin, (req, res) => {
  const rawMembers = (db.users || []).map(publicUser).sort((a, b) => (b.points || 0) - (a.points || 0));
  const members = rawMembers.map((m) => {
    const tierInfo = loyaltyEngine.resolveCustomerTier(db, m);
    const walletBalanceToman = walletEngine.getWalletBalance(db, m.phone);
    return {
      ...m,
      walletBalanceToman,
      tier: tierInfo.tier,
      nextTier: tierInfo.nextTier,
      progressPct: tierInfo.progressPct,
      pointsToNext: tierInfo.pointsToNext,
      multiplier: tierInfo.multiplier,
      discountPct: tierInfo.discountPct,
      badge: tierInfo.badge,
    };
  });
  const walletSummary = walletEngine.summarizeWallet(db);
  const newFeedback = (db.feedback || []).filter((f) => !f.reviewed).length;
  res.json({
    ok: true,
    summary: {
      customers: members.length,
      points: members.reduce((s, m) => s + (m.points || 0), 0),
      walletTotalToman: walletSummary.totalLiabilityToman || 0,
      newFeedback,
    },
    customers: members,
  });
});

app.get('/api/admin/loyalty/tiers', requireAdmin, (req, res) => {
  const rawMembers = db.users.map(publicUser);
  const tiers = loyaltyEngine.summarizeTiersMembership(db, rawMembers);
  res.json({ tiers });
});

app.put('/api/admin/loyalty/tiers', requireAdmin, (req, res) => {
  if (!Array.isArray(req.body.tiers) || !req.body.tiers.length) {
    return res.status(400).json({ error: 'tiers_array_required' });
  }
  if (!db.loyalty) db.loyalty = {};
  db.loyalty.tiers = req.body.tiers.map((t, idx) => ({
    id: String(t.id || `tier-${idx + 1}`).trim(),
    name: String(t.name || `سطح ${idx + 1}`).trim(),
    minPoints: Math.max(0, Math.round(Number(t.minPoints) || 0)),
    minSpendToman: Math.max(0, Math.round(Number(t.minSpendToman) || 0)),
    multiplier: Math.max(1, Math.min(10, Number(t.multiplier) || 1)),
    discountPct: Math.max(0, Math.min(50, Number(t.discountPct) || 0)),
    color: String(t.color || '#a855f7').trim(),
    badgeIcon: String(t.badgeIcon || '🥉').trim(),
    perks: Array.isArray(t.perks) ? t.perks.map(String) : [],
  }));
  save();
  res.json({ ok: true, tiers: db.loyalty.tiers });
});

app.post('/api/admin/loyalty/adjust', requireAdmin, (req, res) => {
  const phone = normalizeDigits(req.body.phone || '').trim();
  const delta = Math.round(Number(req.body.delta) || 0);
  const reason = String(req.body.reason || 'manual').slice(0, 80);
  if (!PHONE_RE.test(phone)) return res.status(400).json({ error: 'شماره معتبر نیست' });
  if (!delta) return res.status(400).json({ error: 'مقدار امتیاز صفر است' });
  const entry = awardLoyaltyPoints(phone, delta, reason, { manual: true });
  save();
  const user = db.users.find((u) => u.phone === phone);
  const resolved = loyaltyEngine.resolveCustomerTier(db, user);
  res.json({
    ok: true,
    entry,
    user: {
      ...publicUser(user),
      tier: resolved.tier,
      badge: resolved.badge,
    },
  });
});

app.get('/api/loyalty/customer', requireAuth, (req, res) => {
  const phone = normalizeDigits(req.query.phone || '').trim();
  if (!phone || !PHONE_RE.test(phone)) {
    return res.status(400).json({ error: 'شماره معتبر نیست' });
  }
  const role = effectiveRole(req.user);
  const isSelf = req.user && req.user.phone === phone;
  const isStaff = ['cashier', 'waiter', 'manager', 'owner', 'admin'].includes(role)
    || userCan(req.user, 'crm.view')
    || userCan(req.user, 'orders.create')
    || userCan(req.user, 'ops.view');

  if (!isSelf && !isStaff) {
    return res.status(403).json({ error: 'دسترسی به اطلاعات باشگاه این مشتری مجاز نیست.' });
  }

  const user = db.users.find((u) => u.phone === phone);
  const resolved = loyaltyEngine.resolveCustomerTier(db, user || { phone, points: 0 });
  const walletBalance = walletEngine.getWalletBalance(db, phone);
  res.json({
    phone,
    name: user?.name || '',
    points: resolved.points,
    walletBalanceToman: walletBalance,
    tier: resolved.tier,
    nextTier: resolved.nextTier,
    progressPct: resolved.progressPct,
    pointsToNext: resolved.pointsToNext,
    spendToNext: resolved.spendToNext,
    discountPct: resolved.discountPct,
    multiplier: resolved.multiplier,
    badge: resolved.badge,
  });
});

// --- Membership QR Code for logged-in user ---
// Generates a real PNG QR code. The payload is a URL the cashier app
// can call directly to pull up this customer's loyalty profile.
app.get('/api/loyalty/qr-code', requireAuth, async (req, res) => {
  try {
    const phone = req.user.phone;
    // Build the cashier look-up URL (same origin, so relative path works on LAN)
    const protocol = req.protocol;
    const host = req.get('host');
    const payload = `${protocol}://${host}/api/loyalty/customer?phone=${encodeURIComponent(phone)}`;

    const png = await QRCode.toBuffer(payload, {
      type: 'png',
      width: 400,
      margin: 2,
      errorCorrectionLevel: 'M',
      color: { dark: '#151817', light: '#ffffff' },
    });

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'private, max-age=300'); // 5-min cache
    res.setHeader('X-Westo-Phone', phone.slice(-4));         // last 4 digits hint
    return res.send(png);
  } catch (err) {
    return res.status(500).json({ error: 'ساخت QR ممکن نشد' });
  }
});



app.get('/api/loyalty/me', requireAuth, (req, res) => {
  const resolved = loyaltyEngine.resolveCustomerTier(db, req.user);
  const walletBalance = walletEngine.getWalletBalance(db, req.user.phone);
  res.json({
    points: Math.max(0, Math.round(Number(req.user.points) || 0)),
    walletBalanceToman: walletBalance,
    tier: resolved.tier,
    nextTier: resolved.nextTier,
    progressPct: resolved.progressPct,
    pointsToNext: resolved.pointsToNext,
    spendToNext: resolved.spendToNext,
    multiplier: resolved.multiplier,
    discountPct: resolved.discountPct,
    badge: resolved.badge,
    loyalty: {
      enabled: !!db.loyalty?.enabled,
      pointsPerToman: db.loyalty?.pointsPerToman ?? 0,
      redeemValue: db.loyalty?.redeemValue ?? 0,
      welcomePoints: db.loyalty?.welcomePoints ?? 0,
      tiers: loyaltyEngine.getLoyaltyTiers(db),
    },
    ledger: (db.loyaltyLedger || []).filter((e) => e.phone === req.user.phone).slice(0, 20),
  });
});

app.post('/api/loyalty/redeem', requireAuth, (req, res) => {
  const user = (db.users || []).find((u) => phonesMatch(u.phone, req.user.phone)) || req.user;
  const cost = Math.max(1, Math.round(Number(req.body?.cost) || 500));
  const currentPts = Math.max(0, Math.round(Number(user.points) || 0));

  if (currentPts < cost) {
    return res.status(400).json({ ok: false, error: 'امتیاز شما برای دریافت این جایزه کافی نیست.' });
  }

  user.points = currentPts - cost;

  if (!Array.isArray(db.loyaltyLedger)) db.loyaltyLedger = [];
  const voucherCode = `WST-REW-${Date.now().toString(36).toUpperCase()}`;
  db.loyaltyLedger.unshift({
    id: `ly_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    phone: user.phone,
    delta: -cost,
    type: 'reward_redeem',
    description: `دریافت جایزه لاته مهمان وستو (${voucherCode})`,
    voucherCode,
    at: new Date().toISOString(),
  });

  save();

  const resolved = loyaltyEngine.resolveCustomerTier(db, user);
  const walletBalance = walletEngine.getWalletBalance(db, user.phone);

  res.json({
    ok: true,
    voucherCode,
    points: user.points,
    user: publicUser(user),
    loyalty: {
      points: user.points,
      walletBalanceToman: walletBalance,
      tier: resolved.tier,
      nextTier: resolved.nextTier,
      progressPct: resolved.progressPct,
      pointsToNext: resolved.pointsToNext,
    },
  });
});

/* ---- Customer Digital Wallet (کیف پول و شارژ اعتباری) ---- */
app.get('/api/wallet/me', requireAuth, (req, res) => {
  const phone = req.user.phone;
  const balance = walletEngine.getWalletBalance(db, phone);
  const packages = walletEngine.getWalletPackages(db);
  const ledger = (db.walletLedger || []).filter((e) => e.phone === phone).slice(0, 30);
  const resolved = loyaltyEngine.resolveCustomerTier(db, req.user);
  res.json({
    phone,
    walletBalanceToman: balance,
    packages,
    ledger,
    tier: resolved.tier,
    badge: resolved.badge,
  });
});

// --- Wallet Topup Requests & Multi-Factor Approval Engine ---
db.walletTopupRequests = db.walletTopupRequests || [];

function generateShortTrackingCode() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

// A wallet mutation is only successful when its Finance V2 deposit journal is
// posted in the same durable transaction. This keeps the customer balance,
// wallet ledger, request state, and official ledger from drifting apart.
async function applyWalletTopupWithFinance(req, input, mutate) {
  const snapshot = snapshotFinanceMutationState();
  try {
    let result = null;
    const finance = financeV2.captureWalletTopup(db, {
      branchId: input.branchId,
      amountToman: input.amountToman,
      bonusToman: input.bonusToman || 0,
      paymentMethod: input.paymentMethod,
      reference: input.reference,
      sourceId: input.sourceId || input.reference,
      phone: input.phone,
      packageId: input.packageId,
      actor: input.actor || req.user?.phone || 'system',
      idempotencyKey: input.idempotencyKey,
    }, {
      actor: input.actor || req.user?.phone || 'system',
      idempotencyKey: input.idempotencyKey,
      applyWallet: ({ event }) => {
        result = mutate();
        // Tag only the entries created by this mutation.  Looking at the
        // first two rows for a phone is not a safe identity boundary when a
        // concurrent/retried credit or a payment entry is already present.
        for (const entry of [result?.topupEntry, result?.bonusEntry].filter(Boolean)) {
          entry.meta = { ...(entry.meta || {}), financeEventId: event.id };
        }
        return result;
      },
    });
    if (finance.blocked || !finance.journalEntry) throw Object.assign(new Error('شارژ کیف پول تا ثبت سند مالی قابل تکمیل نیست.'), { code: finance.event?.error?.code || 'wallet_topup_finance_blocked', status: 409 });
    await persistFinanceMutation(snapshot);
    return { ...(finance.walletResult || result || {}), finance };
  } catch (error) {
    restoreFinanceMutationState(snapshot);
    throw error;
  }
}

function campaignWalletTopupWithFinance(input, branchId, actor) {
  let result = null;
  const finance = financeV2.captureWalletTopup(db, {
    branchId, sourceId: input.reference, phone: input.phone,
    amountToman: input.amountToman, bonusToman: 0,
    paymentMethod: input.paymentMethod, reference: input.reference,
  }, {
    actor,
    applyWallet: ({ event }) => {
      result = walletEngine.topupWallet(db, input);
      for (const entry of [result?.topupEntry, result?.bonusEntry].filter(Boolean)) {
        entry.meta = { ...(entry.meta || {}), financeEventId: event.id };
      }
      return result;
    },
  });
  if (finance.blocked || !finance.journalEntry) throw Object.assign(new Error('پاداش کیف پول تا ثبت سند مالی قابل تکمیل نیست.'), { code: finance.event?.error?.code || 'wallet_bonus_finance_blocked', status: 409 });
  return result;
}

// 1. Create a Wallet Topup Request (Online Gateway or In-store Waiter/Cashier Approval)
app.post('/api/wallet/topup/request', requireAuth, (req, res) => {
  const phone = req.user.phone;
  const user = (db.users || []).find((u) => u.phone === phone) || req.user;
  const amountToman = Math.max(0, Math.round(Number(req.body.amountToman || req.body.amount) || 0));
  const packageId = req.body.packageId ? String(req.body.packageId).trim() : null;
  const channel = req.body.channel === 'instore_staff' ? 'instore_staff' : 'online_gateway';
  let branchId;
  try { branchId = parseBranchId(req); } catch (error) { return res.status(error.status || 400).json({ error: error.code || 'branch_invalid', message: error.message }); }
  if (!branchId) return res.status(400).json({ error: 'wallet_topup_branch_required' });

  let finalAmount = amountToman;
  const packages = walletEngine.getWalletPackages(db);
  if (packageId) {
    const pack = packages.find((p) => p.id === packageId);
    if (pack) finalAmount = pack.amountToman;
  }

  if (finalAmount <= 0) {
    return res.status(400).json({ error: 'مبلغ شارژ یا شناسه بسته معتبر نیست.' });
  }

  const bonusInfo = walletEngine.calculateTopupBonus(finalAmount, packages);
  const requestId = `wtop_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const trackingCode = generateShortTrackingCode();
  const gatewayToken = `gw_tok_${Math.random().toString(36).slice(2, 12)}`;

  const topupRequest = {
    id: requestId,
    trackingCode,
    phone,
    customerName: user.name || 'مشتری گرامی',
    amountToman: finalAmount,
    bonusToman: bonusInfo.bonusToman,
    totalCredit: bonusInfo.totalCreditToman,
    packageId,
    channel,
    status: channel === 'online_gateway' ? 'pending_gateway' : 'pending_staff_approval',
    gatewayToken,
    authority: `AU_${Date.now()}_${trackingCode}`,
    createdAt: new Date().toISOString(),
    approvedBy: null,
    approvedAt: null,
    tableNo: req.body.tableNo || null,
    branchId,
  };

  db.walletTopupRequests.unshift(topupRequest);
  db.walletTopupRequests = db.walletTopupRequests.slice(0, 1000);
  save();

  res.json({
    ok: true,
    request: {
      id: topupRequest.id,
      trackingCode: topupRequest.trackingCode,
      amountToman: topupRequest.amountToman,
      bonusToman: topupRequest.bonusToman,
      totalCredit: topupRequest.totalCredit,
      channel: topupRequest.channel,
      status: topupRequest.status,
      authority: topupRequest.authority,
      gatewayToken: topupRequest.gatewayToken,
      instructions: channel === 'instore_staff'
        ? `کد پیگیری شما ${trackingCode} است. لطفاً برای پرداخت نقدی یا کارتخوان، این کد را به گارسون یا صندوقدار اعلام نمایید.`
        : 'در حال اتصال به درگاه بانکی جهت پرداخت و دریافت تاییدیه…',
    },
  });
});

// 2. Gateway Verification (Online payment gateway verification callback)
app.post('/api/wallet/topup/gateway-verify', requireAuth, async (req, res) => {
  const { requestId, gatewayToken } = req.body || {};
  const request = (db.walletTopupRequests || []).find((r) => (requestId && r.id === requestId) || (gatewayToken && r.gatewayToken === gatewayToken));

  if (!request) {
    return res.status(404).json({ error: 'درخواست درگاه یافت نشد.' });
  }

  // A gateway request is customer-owned.  Without this check any signed-in
  // customer who obtains another request id/token could credit a different
  // wallet.  Branch access is checked too for staff sessions so a scoped
  // operator cannot confirm a request from another branch.
  if (String(request.phone || '') !== String(req.user.phone || '')) {
    return res.status(403).json({ error: 'wallet_topup_request_owner_mismatch' });
  }
  try {
    assertUserBranchAccess(req.user, request.branchId);
  } catch (error) {
    return res.status(error.status || 403).json({ error: error.code || 'branch_access_denied', message: error.message });
  }

  if (request.status === 'completed') {
    const eventSourceId = `GW-${String(request.authority || request.trackingCode)}`;
    const event = (db.financeV2?.events || []).find((item) => item.source === 'wallet.topup' && item.sourceId === eventSourceId);
    if (!event || event.status !== 'posted') return res.status(409).json({ error: 'wallet_topup_finance_missing' });
    return res.json({ ok: true, message: 'این شارژ قبلاً تایید و اعمال شده است.', newBalance: walletEngine.getWalletBalance(db, request.phone), finance: { event } });
  }

  if (!gatewayToken || request.gatewayToken !== gatewayToken) {
    return res.status(403).json({ error: 'توکن تأییدیه درگاه بانکی نامعتبر است.' });
  }

  const branchId = Number(request.branchId) || null;
  if (!branchId) return res.status(400).json({ error: 'wallet_topup_branch_required' });
  let result;
  try {
    result = await applyWalletTopupWithFinance(req, { branchId, amountToman: request.amountToman, bonusToman: request.bonusToman, packageId: request.packageId, phone: request.phone, paymentMethod: 'online_gateway', reference: `GW-${request.authority || request.trackingCode}`, actor: 'تاییدیه درگاه بانکی' }, () => {
      const value = walletEngine.topupWallet(db, { phone: request.phone, amountToman: request.amountToman, packageId: request.packageId, paymentMethod: 'online_gateway', reference: `GW-${request.authority || request.trackingCode}`, actor: 'تاییدیه درگاه بانکی' });
      request.status = 'completed'; request.approvedAt = new Date().toISOString();
      request.approvedBy = { role: 'payment_gateway', name: 'تاییدیه درگاه بانکی شاپرک', ref: request.authority };
      return value;
    });
  } catch (error) { return res.status(error.status || 409).json({ error: error.code || 'wallet_topup_failed', message: error.message }); }

  try {
    smsEngine.sendSms(db, {
      phone: request.phone,
      name: request.customerName,
      templateKey: 'wallet_topup',
      vars: { name: request.customerName, amount: request.amountToman, wallet_balance: result.newBalance },
      triggerType: 'event',
    });
  } catch (_) {}

  res.json({ ok: true, verified: true, ...result, request });
});

// 3. Staff Approval (Cashier or Waiter confirms and approves cash/POS topup)
app.post('/api/wallet/topup/staff-approve', requireAuth, async (req, res) => {
  const role = effectiveRole(req.user);
  if (!['cashier', 'waiter', 'manager', 'owner', 'admin'].includes(role)) {
    return res.status(403).json({ error: 'تأیید شارژ کیف پول فقط با دسترسی گارسون، صندوقدار یا مدیریت مجاز است.' });
  }

  const { requestId, trackingCode, phone, amountToman, packageId, paymentTender = 'CASH', notes } = req.body || {};
  let targetPhone = phone;
  let targetAmount = amountToman;
  let targetPackageId = packageId;
  let targetRequest = null;

  if (requestId || trackingCode) {
    targetRequest = (db.walletTopupRequests || []).find((r) => (requestId && r.id === requestId) || (trackingCode && r.trackingCode === String(trackingCode).trim()));
    if (targetRequest) {
      targetPhone = targetRequest.phone;
      targetAmount = targetRequest.amountToman;
      targetPackageId = targetRequest.packageId;
    }
  }

  if (targetRequest?.status === 'completed') {
    // Replays of a completed in-store request are idempotent and must never
    // mint a second wallet credit.  The stable source id below is also the
    // Finance V2 idempotency boundary used for the first approval.
    const sourceId = `STAFF-${targetRequest.id}`;
    const event = (db.financeV2?.events || []).find((item) => item.source === 'wallet.topup' && item.sourceId === sourceId);
    if (!event || event.status !== 'posted') return res.status(409).json({ error: 'wallet_topup_finance_missing' });
    return res.json({
      ok: true, approved: true, idempotent: true,
      newBalance: walletEngine.getWalletBalance(db, targetRequest.phone),
      totalCredit: Number(targetRequest.totalCredit) || Number(targetRequest.amountToman) || 0,
      bonusToman: Number(targetRequest.bonusToman) || 0,
      phone: targetRequest.phone,
      finance: { event },
    });
  }
  if (targetRequest && (targetRequest.channel !== 'instore_staff' || targetRequest.status !== 'pending_staff_approval')) {
    return res.status(409).json({ error: 'wallet_topup_request_not_approvable' });
  }

  if (!targetPhone) {
    return res.status(400).json({ error: 'شماره مشتری یا کد پیگیری درخواست الزامی است.' });
  }

  let finalAmount = Math.max(0, Math.round(Number(targetAmount) || 0));
  if (targetPackageId) {
    const pack = walletEngine.getWalletPackages(db).find((p) => p.id === targetPackageId);
    if (pack) finalAmount = pack.amountToman;
  }

  if (finalAmount <= 0) {
    return res.status(400).json({ error: 'مبلغ شارژ نامعتبر است.' });
  }

  let branchId;
  try { branchId = Number(targetRequest?.branchId) || parseBranchId(req); if (targetRequest?.branchId) assertUserBranchAccess(req.user, targetRequest.branchId); } catch (error) { return res.status(error.status || 400).json({ error: error.code || 'branch_invalid', message: error.message }); }
  if (!branchId) return res.status(400).json({ error: 'wallet_topup_branch_required' });

  const approverInfo = {
    phone: req.user.phone,
    role,
    roleLabel: role === 'cashier' ? 'صندوقدار' : role === 'waiter' ? 'گارسون' : 'مدیریت',
    name: req.user.name || (role === 'cashier' ? 'صندوقدار' : 'گارسون'),
  };

  // Request-backed approvals use a stable reference.  A timestamp here would
  // turn a repeated approval of the same request into a second Finance event.
  const reference = targetRequest ? `STAFF-${targetRequest.id}` : `STAFF-${role.toUpperCase()}-${Date.now()}`;
  let result;
  try {
    const bonusInfo = walletEngine.calculateTopupBonus(finalAmount, walletEngine.getWalletPackages(db));
    result = await applyWalletTopupWithFinance(req, { branchId, amountToman: finalAmount, bonusToman: targetRequest?.bonusToman ?? bonusInfo.bonusToman, packageId: targetPackageId, phone: targetPhone, paymentMethod: paymentTender === 'POS' ? 'pos_card' : 'cash_in_store', reference, actor: `${approverInfo.roleLabel} (${req.user.phone})` }, () => {
      const value = walletEngine.topupWallet(db, { phone: targetPhone, amountToman: finalAmount, packageId: targetPackageId, paymentMethod: paymentTender === 'POS' ? 'pos_card' : 'cash_in_store', reference, actor: `${approverInfo.roleLabel} (${req.user.phone})` });
      if (targetRequest) { targetRequest.status = 'completed'; targetRequest.approvedAt = new Date().toISOString(); targetRequest.approvedBy = approverInfo; }
      return value;
    });
  } catch (error) { return res.status(error.status || 409).json({ error: error.code || 'wallet_topup_failed', message: error.message }); }

  recordAudit(req, 'wallet.staff_approved', 'user', targetPhone, {
    amountToman: finalAmount,
    totalCredit: result.totalCredit,
    approvedBy: approverInfo,
    paymentTender,
    notes,
  });

  try {
    smsEngine.sendSms(db, {
      phone: targetPhone,
      name: '',
      templateKey: 'wallet_topup',
      vars: { name: 'مشتری گرامی', amount: finalAmount, wallet_balance: result.newBalance },
      triggerType: 'event',
    });
  } catch (_) {}

  res.json({
    ok: true,
    approved: true,
    approver: approverInfo,
    newBalance: result.newBalance,
    totalCredit: result.totalCredit,
    bonusToman: result.bonusToman,
    phone: targetPhone,
  });
});

// 4. Pending Topup Requests Query for Cashier & Waiter Panels
app.get('/api/wallet/topup-requests/pending', requireAuth, (req, res) => {
  const role = effectiveRole(req.user);
  if (!['cashier', 'waiter', 'manager', 'owner', 'admin'].includes(role)) {
    return res.status(403).json({ error: 'دسترسی فقط برای کادر سالن و صندوق مجاز است.' });
  }

  let branchId;
  try { branchId = parseBranchId(req); } catch (error) {
    return res.status(error.status || 400).json({ error: error.code || 'branch_invalid', message: error.message });
  }
  const pending = branchScoped((db.walletTopupRequests || []), branchId)
    .filter((r) => r.status === 'pending_staff_approval')
    .slice(0, 50);

  res.json({ ok: true, requests: pending });
});

// 5. Customer Active Requests
app.get('/api/wallet/topup-requests/my', requireAuth, (req, res) => {
  const myRequests = (db.walletTopupRequests || [])
    .filter((r) => r.phone === req.user.phone)
    .slice(0, 10);
  res.json({ ok: true, requests: myRequests });
});

// 6. Direct /api/wallet/topup Gateway or Staff Guard
app.post('/api/wallet/topup', requireAuth, async (req, res) => {
  const role = effectiveRole(req.user);
  const isStaff = ['cashier', 'waiter', 'manager', 'owner', 'admin'].includes(role);
  const { gatewayToken, reference } = req.body || {};

  let matchedGatewayRequest = null;
  if (!isStaff) {
    if (gatewayToken) {
      matchedGatewayRequest = (db.walletTopupRequests || []).find(
        (r) => r.gatewayToken === gatewayToken && r.phone === req.user.phone && r.status === 'pending_gateway'
      );
    }
    if (!matchedGatewayRequest) {
      return res.status(403).json({
        error: 'شارژ کیف پول صرفاً با تأیید پرسنل مجاز یا دریافت تاییدیه معتبر درگاه بانکی امکان‌پذیر است.',
        requiresVerification: true,
      });
    }
  }

  const phone = (isStaff && req.body.phone) ? req.body.phone : req.user.phone;
  const amountToman = Math.max(0, Math.round(Number(req.body.amountToman || req.body.amount) || 0));
  const packageId = req.body.packageId ? String(req.body.packageId).trim() : null;
  const paymentMethod = req.body.paymentMethod || (isStaff ? 'in_store_staff' : 'online_gateway');

  if (!amountToman && !packageId) {
    return res.status(400).json({ error: 'مبلغ شارژ یا شناسه بسته الزامی است.' });
  }

  let finalAmount = amountToman;
  if (packageId) {
    const pack = walletEngine.getWalletPackages(db).find((p) => p.id === packageId);
    if (pack) finalAmount = pack.amountToman;
  }

  if (finalAmount <= 0) {
    return res.status(400).json({ error: 'مبلغ شارژ نامعتبر است.' });
  }

  let branchId;
  try { branchId = parseBranchId(req); } catch (error) { return res.status(error.status || 400).json({ error: error.code || 'branch_invalid', message: error.message }); }
  if (!branchId) return res.status(400).json({ error: 'wallet_topup_branch_required' });

  const financeReference = (isStaff && reference)
    ? reference
    : (matchedGatewayRequest ? `GW-${matchedGatewayRequest.authority || matchedGatewayRequest.trackingCode}` : (isStaff ? `STAFF-${role.toUpperCase()}-${Date.now()}` : `GW-${Date.now()}`));

  let result;
  try {
    const bonusInfo = walletEngine.calculateTopupBonus(finalAmount, walletEngine.getWalletPackages(db));
    result = await applyWalletTopupWithFinance(req, { branchId, amountToman: finalAmount, bonusToman: bonusInfo.bonusToman, packageId, phone, paymentMethod, reference: financeReference, actor: isStaff ? `${role} (${req.user.phone})` : (req.user.phone || 'customer') }, () => {
      const topupVal = walletEngine.topupWallet(db, {
        phone, amountToman: finalAmount, packageId, paymentMethod, reference: financeReference,
        actor: isStaff ? `${role} (${req.user.phone})` : (req.user.phone || 'customer'),
      });
      if (matchedGatewayRequest) {
        matchedGatewayRequest.status = 'completed';
        matchedGatewayRequest.approvedAt = new Date().toISOString();
        matchedGatewayRequest.approvedBy = { role: 'payment_gateway', name: 'تاییدیه درگاه بانکی شاپرک', ref: matchedGatewayRequest.authority };
      }
      return topupVal;
    });
  } catch (error) { return res.status(error.status || 409).json({ error: error.code || 'wallet_topup_failed', message: error.message }); }

  try {
    smsEngine.sendSms(db, {
      phone,
      name: req.user?.name || '',
      templateKey: 'wallet_topup',
      vars: {
        name: req.user?.name || 'مشتری گرامی',
        amount: finalAmount,
        wallet_balance: result.newBalance,
      },
      triggerType: 'event',
    });
  } catch (_) {}

  res.json({ ok: true, ...result });
});

app.post('/api/orders/:id/pay-wallet', requireAuth, async (req, res) => {
  const orderId = Number(normalizeDigits(String(req.params.id || '')).replace(/\D/g, ''));
  const order = (db.orders || []).find((o) => Number(o.id) === orderId);
  if (!order) return res.status(404).json({ error: 'سفارش یافت نشد.' });

  const phone = normalizeDigits(req.user?.phone || '').trim();
  if (!phone) return res.status(400).json({ error: 'شماره مشتری برای پرداخت کیف پول مشخص نیست.' });
  if (order.phone && normalizeDigits(order.phone).trim() !== phone) {
    return res.status(403).json({ error: 'این سفارش به حساب مشتری دیگری تعلق دارد.' });
  }
  if (!order.phone) return res.status(409).json({ error: 'سفارش شماره مشتری قابل پرداخت از کیف پول ندارد.' });

  if (['paid', 'done', 'delivered'].includes(order.paymentStatus) || order.paymentStatus === 'paid') {
    return res.status(400).json({ error: 'این سفارش قبلاً پرداخت شده است.' });
  }

  const orderTotal = Math.max(0, Math.round(Number(order.total) || 0));
  const existingPayments = Array.isArray(order.partialPayments) ? order.partialPayments : [];
  const alreadyPaid = existingPayments.reduce((sum, payment) => sum + Math.max(0, Math.round(Number(payment.amount) || 0)), 0);
  const payableAmount = Math.max(0, orderTotal - alreadyPaid);
  if (!payableAmount) return res.status(200).json({ ok: true, idempotent: true, order });
  const currentBalance = walletEngine.getWalletBalance(db, phone);

  if (currentBalance < payableAmount) {
    return res.status(400).json({
      error: `موجودی کیف پول (${currentBalance.toLocaleString('fa-IR')} تومان) برای پرداخت ماندهٔ این فاکتور (${payableAmount.toLocaleString('fa-IR')} تومان) کافی نیست.`,
      currentBalance,
      required: payableAmount,
    });
  }

  // Wallet debit, order state, Finance V2 capture, loyalty and cashback form
  // one user-visible payment. Never leave a deducted wallet behind when the
  // fiscal period is closed or the sale cannot be posted.
  const snapshot = snapshotFinanceMutationState();
  let paymentResult;
  let financeResult;
  let cashbackAmount = 0;
  try {
    paymentResult = walletEngine.payFromWallet(db, {
      phone,
      amountToman: payableAmount,
      orderId: order.id,
      orderNo: order.orderNo,
      actor: req.user?.phone || 'customer',
    });

    // Mark order paid with wallet tender only inside the same rollback scope.
    const fullyPaid = alreadyPaid + payableAmount >= orderTotal;
    order.paymentStatus = fullyPaid ? 'paid' : 'partial';
    order.paymentMethod = 'wallet';
    order.paymentTender = 'wallet';
    if (fullyPaid && !order.paidAt) order.paidAt = new Date().toISOString();
    order.partialPayments = Array.isArray(order.partialPayments) ? order.partialPayments : [];
    if (!order.partialPayments.some((row) => String(row.id || '') === String(paymentResult.paymentEntry.id))) {
      order.partialPayments.push({
        id: paymentResult.paymentEntry.id,
        tender: 'wallet',
        amount: payableAmount,
        at: order.paidAt || new Date().toISOString(),
        by: req.user?.phone || 'customer',
      });
    }
    order.amountPaid = alreadyPaid + payableAmount;
    order.paymentTenders = [...new Set(order.partialPayments.map((row) => row.tender).filter(Boolean))];
    if (fullyPaid && ['pending', 'pending_cashier', 'pay_at_cashier', 'awaiting_confirmation'].includes(String(order.status || ''))) {
      appendOrderStatus(order, 'paid', req.user || null, { source: 'wallet' });
    }

    financeResult = financeV2.capturePaidOrder(db, order, {
      actor: req.user?.phone || 'customer-wallet',
      idempotencyKey: `order:${order.branchId || 'unscoped'}:${order.id}:wallet-payment`,
    });
    if (!financeResult?.journalEntry || financeResult.journalEntry.status !== 'posted') {
      const captureCode = financeResult?.event?.error?.code || 'finance_capture_blocked';
      throw Object.assign(new Error('پرداخت ثبت نشد چون سند فروش در دفتر مالی ثبت نشد.'), {
        code: captureCode,
        status: 409,
        details: financeResult?.event?.error || null,
      });
    }

    // Award order loyalty points and cashback only after the sale journal is
    // confirmed; these credits must not survive a failed accounting capture.
    maybeAwardOrderLoyalty(order);
    const user = (db.users || []).find((u) => u.phone === phone);
    const tierInfo = loyaltyEngine.resolveCustomerTier(db, user);
    const cashbackPct = tierInfo.discountPct || 3;
    cashbackAmount = Math.round((payableAmount * cashbackPct) / 100);
    if (cashbackAmount > 0) {
      walletEngine.awardWalletCashback(db, {
        phone,
        amountToman: cashbackAmount,
        orderId: order.id,
        cashbackPct,
        actor: 'system',
      });
    }
    await persistFinanceMutation(snapshot);
  } catch (error) {
    restoreFinanceMutationState(snapshot);
    return res.status(error.status || 503).json({ error: error.code || error.message, details: error.details || undefined });
  }

  res.json({
    ok: true,
    order,
    paymentResult,
    finance: financeResult,
    cashbackAwarded: cashbackAmount,
    newWalletBalance: walletEngine.getWalletBalance(db, phone),
  });
});

app.get('/api/admin/wallet/summary', requireAdmin, (req, res) => {
  const summary = walletEngine.summarizeWallet(db);
  res.json(summary);
});

app.post('/api/admin/wallet/adjust', requireCapability('finance.journal.create'), async (req, res) => {
  const phone = normalizeDigits(req.body.phone || '').trim();
  const rawDelta = req.body.deltaToman ?? req.body.delta;
  const parsedDelta = typeof rawDelta === 'number'
    ? rawDelta
    : Number(normalizeDigits(String(rawDelta || '')).replace(/[,٬_\s]/g, '').trim());
  const deltaToman = Math.round(parsedDelta || 0);
  const reason = String(req.body.reason || 'تعدیل دستی توسط مدیر').slice(0, 120);
  const key = String(req.get('Idempotency-Key') || '').trim();

  if (!PHONE_RE.test(phone)) return res.status(400).json({ error: 'شماره موبایل معتبر نیست.' });
  if (!deltaToman) return res.status(400).json({ error: 'مبلغ تغییر نمی‌تواند صفر باشد.' });
  if (!key) return res.status(400).json({ error: 'کلید Idempotency-Key الزامی است.' });

  let branchId;
  try { branchId = parseBranchId(req); } catch (error) {
    return res.status(error.status || 400).json({ error: error.code || 'branch_invalid', message: error.message });
  }
  if (!branchId) return res.status(400).json({ error: 'wallet_adjust_branch_required' });

  const snapshot = snapshotFinanceMutationState();
  try {
    const result = financeV2.captureWalletAdjustment(db, {
      branchId,
      phone,
      deltaToman,
      reason,
      sourceId: `MANUAL-${key}`,
      reference: `MANUAL-${key}`,
    }, {
      actor: req.user?.phone || 'admin',
      idempotencyKey: key,
      applyWallet: ({ event }) => {
        const walletResult = walletEngine.adjustWallet(db, {
          phone,
          deltaToman,
          reason,
          actor: req.user?.phone || 'admin',
        });
        if (walletResult.adjustEntry) {
          walletResult.adjustEntry.meta = { ...(walletResult.adjustEntry.meta || {}), financeEventId: event.id };
        }
        return walletResult;
      },
    });
    if (result.blocked || !result.journalEntry) {
      throw Object.assign(new Error('تعدیل کیف‌پول تا ثبت سند مالی قابل تکمیل نیست.'), {
        code: result.event?.error?.code || 'wallet_adjust_finance_blocked', status: 409,
      });
    }
    recordAudit(req, 'wallet.adjusted', 'user', phone, { deltaToman, reason, branchId, financeEventId: result.event.id }, branchId);
    await persistFinanceMutation(snapshot);
    return res.json({ ok: true, ...result.walletResult, finance: { event: result.event, journalEntry: result.journalEntry, idempotentReplay: result.idempotentReplay } });
  } catch (error) {
    restoreFinanceMutationState(snapshot);
    return res.status(error.status || 409).json({ error: error.code || 'wallet_adjust_failed', message: error.message });
  }
});

app.get('/api/admin/wallet/packages', requireAdmin, (req, res) => {
  res.json({ packages: walletEngine.getWalletPackages(db) });
});

app.put('/api/admin/wallet/packages', requireAdmin, (req, res) => {
  if (!Array.isArray(req.body.packages) || !req.body.packages.length) {
    return res.status(400).json({ error: 'packages_array_required' });
  }
  const toNum = (v, fb = 0) => {
    if (v == null || v === '') return fb;
    if (typeof v === 'number') return isNaN(v) ? fb : v;
    const n = Number(normalizeDigits(String(v)).replace(/[,٬_\s]/g, '').trim());
    return isNaN(n) ? fb : n;
  };
  db.walletPackages = req.body.packages.map((p, idx) => {
    const amountToman = Math.max(0, Math.round(toNum(p.amountToman ?? p.amount, 0)));
    const priceToman = Math.max(0, Math.round(toNum(p.priceToman ?? p.price ?? amountToman, amountToman)));
    const bonusToman = Math.max(0, Math.round(toNum(p.bonusToman ?? p.bonus, 0)));
    const bonusPct = Math.max(0, Math.min(100, toNum(p.bonusPct, 0)));
    const totalCreditToman = Math.max(0, Math.round(toNum(p.totalCreditToman, amountToman + bonusToman)));
    return {
      id: String(p.id || `pack-${idx + 1}`).trim(),
      title: String(p.title || `بسته ${idx + 1}`).trim(),
      amountToman,
      priceToman,
      bonusToman,
      bonusPct,
      totalCreditToman,
      popular: !!p.popular,
      badge: String(p.badge || '').trim(),
      description: String(p.description || '').trim(),
    };
  });
  save();
  res.json({ ok: true, packages: db.walletPackages });
});

/* ---- Automated Campaigns (کمپین‌های خودکار: هدیه تولد، کد معرف، ساعت شاد) ---- */
app.get('/api/campaigns/status', (req, res) => {
  const happyHour = campaignsEngine.checkHappyHourStatus(db);
  const config = campaignsEngine.getCampaignConfig(db);
  res.json({
    happyHour,
    campaigns: {
      birthdayEnabled: config.birthday.enabled,
      referralEnabled: config.referral.enabled,
      happyHourEnabled: config.happyHour.enabled,
    },
  });
});

app.get('/api/referrals/me', requireAuth, (req, res) => {
  const user = req.user;
  const referralCode = campaignsEngine.ensureUserReferral(user);
  const referrals = (db.referrals || []).filter((r) => r.inviterPhone === user.phone);
  const config = campaignsEngine.getCampaignConfig(db).referral;

  res.json({
    referralCode,
    referralUrl: `/register?ref=${referralCode}`,
    rewardStats: {
      totalInvited: referrals.length,
      rewardedCount: referrals.filter((r) => r.status === 'rewarded').length,
      totalEarnedWalletToman: referrals.filter((r) => r.status === 'rewarded').reduce((s, r) => s + (r.inviterRewardWalletToman || 0), 0),
      totalEarnedPoints: referrals.filter((r) => r.status === 'rewarded').reduce((s, r) => s + (r.inviterRewardPoints || 0), 0),
    },
    rewardsConfig: {
      inviterRewardWalletToman: config.inviterRewardWalletToman,
      inviterRewardPoints: config.inviterRewardPoints,
      inviteeRewardWalletToman: config.inviteeRewardWalletToman,
      inviteeRewardPoints: config.inviteeRewardPoints,
      inviteeDiscountPct: config.inviteeDiscountPct,
    },
    referrals,
  });
});

app.post('/api/referrals/apply', requireAuth, async (req, res) => {
  const referralCode = String(req.body.code || req.body.referralCode || '').trim();
  if (!referralCode) return res.status(400).json({ error: 'کد معرف الزامی است.' });

  const snapshot = snapshotFinanceMutationState();
  try {
    const branchId = parseBranchId(req);
    if (!branchId) return res.status(400).json({ error: 'wallet_topup_branch_required' });
    const result = campaignsEngine.applyReferralCode(db, {
      inviteePhone: req.user.phone,
      referralCode,
      walletTopup: (input) => campaignWalletTopupWithFinance(input, branchId, 'referral-system'),
    });
    await persistFinanceMutation(snapshot);
    res.json(result);
  } catch (err) {
    restoreFinanceMutationState(snapshot);
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/profile/birthday', requireAuth, (req, res) => {
  const birthdate = String(req.body.birthdate || '').trim();
  if (!birthdate) return res.status(400).json({ error: 'تاریخ تولد نامعتبر است.' });

  const user = db.users.find((u) => u.phone === req.user.phone);
  if (!user) return res.status(404).json({ error: 'کاربر یافت نشد.' });

  if (birthdate !== (user.birthdate || '') && isBirthdateLocked(user)) {
    return res.status(400).json({
      error: 'تاریخ تولد قبلاً ثبت شده و امکان تغییر آن تا ۱ سال وجود ندارد. برای تغییر، با مدیریت هماهنگ فرمایید.',
      birthdateLocked: true,
      birthdate: user.birthdate,
    });
  }

  user.birthdate = birthdate;
  user.birthdateUpdatedAt = new Date().toISOString();
  save();

  const eligibility = campaignsEngine.checkBirthdayEligibility(db, user);
  res.json({ ok: true, birthdate: user.birthdate, eligibility, birthdateLocked: true });
});

app.post('/api/campaigns/claim-birthday', requireAuth, async (req, res) => {
  const snapshot = snapshotFinanceMutationState();
  try {
    const branchId = parseBranchId(req);
    if (!branchId) return res.status(400).json({ error: 'wallet_topup_branch_required' });
    const result = campaignsEngine.grantBirthdayGift(db, req.user.phone, new Date(), {
      walletTopup: (input) => campaignWalletTopupWithFinance(input, branchId, 'birthday-campaign'),
    });

    // Trigger Smart Birthday SMS
    try {
      smsEngine.sendSms(db, {
        phone: req.user.phone,
        name: req.user.name || '',
        templateKey: 'birthday',
        vars: {
          name: req.user.name || 'همراه گرامی',
          amount: result.walletBonusToman || 100000,
        },
        triggerType: 'event',
      });
    } catch (_) {}

    await persistFinanceMutation(snapshot);
    res.json(result);
  } catch (err) {
    restoreFinanceMutationState(snapshot);
    res.status(400).json({ error: err.message });
  }
});

app.get(['/api/admin/campaigns', '/api/admin/campaigns/summary'], requireAdmin, (req, res) => {
  const summary = campaignsEngine.summarizeCampaigns(db);
  res.json(summary);
});

app.put(['/api/admin/campaigns', '/api/admin/campaigns/settings'], requireAdmin, (req, res) => {
  db.campaigns = db.campaigns || {};
  if (req.body.birthday) db.campaigns.birthday = { ...db.campaigns.birthday, ...req.body.birthday };
  if (req.body.referral) db.campaigns.referral = { ...db.campaigns.referral, ...req.body.referral };
  if (req.body.happyHour) db.campaigns.happyHour = { ...db.campaigns.happyHour, ...req.body.happyHour };
  save();
  res.json({ ok: true, campaigns: campaignsEngine.getCampaignConfig(db) });
});

/* ---- Smart SMS & Retention Automation (پیامک‌های هوشمند و مدیریت ارتباط با مشتریان) ---- */
app.get('/api/admin/sms/stats', requireAdmin, (req, res) => {
  const summary = smsEngine.summarizeSmsEngine(db);
  res.json(summary);
});

app.get('/api/admin/sms/rfm', requireAdmin, (req, res) => {
  const rfm = smsEngine.calculateCustomerRfm(db);
  res.json(rfm);
});

app.put('/api/admin/sms/settings', requireAdmin, (req, res) => {
  db.smsConfig = db.smsConfig || {};
  if (req.body.provider !== undefined) db.smsConfig.provider = String(req.body.provider || 'simulator').trim();
  if (req.body.apiKey !== undefined) db.smsConfig.apiKey = String(req.body.apiKey || '').trim();
  if (req.body.senderLine !== undefined) db.smsConfig.senderLine = normalizeDigits(String(req.body.senderLine || '1000912')).trim();
  if (req.body.enabled !== undefined) db.smsConfig.enabled = !!req.body.enabled;
  if (req.body.templates && typeof req.body.templates === 'object') {
    db.smsConfig.templates = db.smsConfig.templates || {};
    for (const [k, v] of Object.entries(req.body.templates)) {
      db.smsConfig.templates[k] = {
        ...(db.smsConfig.templates[k] || {}),
        ...v,
      };
    }
  }
  save();
  res.json({ ok: true, config: smsEngine.getSmsConfig(db) });
});

app.post('/api/admin/sms/send-test', requireAdmin, async (req, res) => {
  const phone = normalizeDigits(req.body.phone || '').trim();
  const text = String(req.body.text || req.body.message || '').trim();
  const templateKey = req.body.templateKey || 'custom';

  if (!PHONE_RE.test(phone)) return res.status(400).json({ error: 'شماره موبایل معتبر نیست.' });

  try {
    const result = await smsEngine.sendSms(db, {
      phone,
      customText: text,
      templateKey,
      vars: req.body.vars || { name: 'تست مدیریت' },
      triggerType: 'manual',
    });
    save();
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/admin/sms/send-bulk', requireAdmin, async (req, res) => {
  const audience = String(req.body.audience || 'همه مشتریان').trim();
  const text = String(req.body.text || req.body.message || '').trim().slice(0, 1200);
  const allowedAudiences = new Set(['همه مشتریان', 'VIP', 'مشتریان جدید']);
  if (!allowedAudiences.has(audience)) return res.status(400).json({ error: 'گروه گیرندگان پیامک معتبر نیست.' });
  if (!text) return res.status(400).json({ error: 'متن پیامک خالی است.' });

  const rfm = smsEngine.calculateCustomerRfm(db);
  const candidates = audience === 'VIP'
    ? rfm.champions
    : audience === 'مشتریان جدید'
      ? rfm.active.filter((customer) => customer.segment === 'new')
      : [...rfm.champions, ...rfm.active, ...rfm.atRisk, ...rfm.dormant];
  const recipients = [...new Map(candidates
    .map((customer) => [String(customer.phone || '').trim(), customer])
    .filter(([phone]) => PHONE_RE.test(phone)))
    .values()];
  const maxRecipients = 500;
  const batch = recipients.slice(0, maxRecipients);
  if (!batch.length) return res.status(409).json({ error: 'در این گروه گیرندهٔ معتبر پیدا نشد.' });

  const results = [];
  for (const customer of batch) {
    try {
      results.push(await smsEngine.sendSms(db, {
        phone: customer.phone,
        name: customer.name || '',
        customText: text,
        templateKey: 'custom',
        vars: { name: customer.name || 'مشتری گرامی' },
        triggerType: 'manual',
      }));
    } catch (error) {
      results.push({ ok: false, phone: customer.phone, error: error.message });
    }
  }
  const campaignId = `bulk-${Date.now()}`;
  const sent = results.filter((result) => result.ok).length;
  const failed = results.length - sent;
  recordAudit(req, 'sms.bulk_sent', 'sms_campaign', campaignId, { audience, attempted: results.length, sent, failed, truncated: recipients.length > batch.length });
  save();
  res.json({ ok: true, campaignId, audience, attempted: results.length, sent, failed, truncated: recipients.length > batch.length, totalCostToman: results.reduce((sum, result) => sum + (Number(result.costToman) || 0), 0) });
});

app.post('/api/admin/sms/run-winback', requireAdmin, async (req, res) => {
  const parseNum = (v) => {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return isNaN(v) ? null : v;
    const n = Number(normalizeDigits(String(v)).replace(/[,٬_\s]/g, '').trim());
    return isNaN(n) ? null : n;
  };
  const segment = req.body.segment || 'at_risk';
  const rewardWalletToman = parseNum(req.body.rewardWalletToman) ?? 50000;
  const maxRecipients = parseNum(req.body.maxRecipients) ?? 50;

  const snapshot = snapshotFinanceMutationState();
  try {
    const branchId = parseBranchId(req);
    if (!branchId) return res.status(400).json({ error: 'wallet_topup_branch_required' });
    const result = await smsEngine.executeWinbackCampaign(db, {
      segment,
      rewardWalletToman,
      maxRecipients,
      walletTopup: (input) => campaignWalletTopupWithFinance(input, branchId, 'automated-retention'),
    });
    await persistFinanceMutation(snapshot);
    res.json(result);
  } catch (err) {
    restoreFinanceMutationState(snapshot);
    res.status(400).json({ error: err.message });
  }
});

/* ---- Online reservations (رزرو میز) ---- */
const JS_DAY_TO_KEY = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const ACTIVE_RES_STATUSES = new Set(['pending', 'confirmed', 'seated']);

function parseHm(hm) {
  const [h, m] = String(hm || '00:00').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}
function fmtHm(mins) {
  const h = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
function slotRangeMinutes(open, close) {
  let a = parseHm(open);
  let b = parseHm(close);
  if (b <= a) b += 24 * 60; // overnight
  return { a, b };
}
function listReservationSlots(branch, dateStr, partySize = 2) {
  const settings = db.reservationSettings || {};
  const slotMin = Math.max(15, Math.min(120, Number(settings.slotMinutes) || 30));
  const maxCovers = Math.max(1, Number(settings.maxCoversPerSlot) || 24);
  const maxParty = Math.max(1, Number(settings.maxParty) || 12);
  const party = Math.max(1, Math.min(maxParty, Number(partySize) || 2));
  const day = JS_DAY_TO_KEY[new Date(`${dateStr}T12:00:00`).getDay()];
  const hours = (branch?.hours || db.hours || {})[day];
  if (!hours || hours.closed) return { slots: [], closed: true, day };
  const { a, b } = slotRangeMinutes(hours.open, hours.close);
  const existing = (db.reservations || []).filter(
    (r) =>
      r.date === dateStr &&
      Number(r.branchId) === Number(branch.id) &&
      ACTIVE_RES_STATUSES.has(r.status) && !waitlist.isWaitlist(r)
  );
  const now = Date.now();
  const minAheadMs = Math.max(0, Number(settings.minHoursAhead) || 0) * 3600 * 1000;
  const slots = [];
  for (let t = a; t + slotMin <= b; t += slotMin) {
    const time = fmtHm(t % (24 * 60));
    const covers = existing.filter((r) => r.time === time).reduce((s, r) => s + (Number(r.partySize) || 0), 0);
    const slotDate = new Date(`${dateStr}T${time}:00`);
    const tooSoon = slotDate.getTime() - now < minAheadMs;
    const remaining = maxCovers - covers;
    slots.push({
      time,
      available: !tooSoon && remaining >= party,
      remaining,
      covers,
    });
  }
  return { slots, closed: false, day, open: hours.open, close: hours.close };
}

app.get('/api/reservations/meta', (req, res) => {
  const settings = db.reservationSettings || {};
  res.json({
    enabled: settings.enabled !== false,
    settings: {
      slotMinutes: settings.slotMinutes ?? 30,
      maxParty: settings.maxParty ?? 12,
      advanceDays: settings.advanceDays ?? 21,
      minHoursAhead: settings.minHoursAhead ?? 1,
    },
    restaurant: {
      name: db.restaurant?.name,
      phone: db.restaurant?.phone,
    },
    branches: (db.branches || [])
      .filter((b) => b.active !== false)
      .map((b) => ({ id: b.id, slug: b.slug, name: b.name, address: b.address })),
  });
});

app.get('/api/reservations/slots', (req, res) => {
  const settings = db.reservationSettings || {};
  if (settings.enabled === false) return res.status(403).json({ error: 'رزرو غیرفعال است' });
  let dateStr = String(req.query.date || '').slice(0, 10);
  if (/^\d{4}[/-]\d{1,2}[/-]\d{1,2}$/.test(dateStr)) {
    try {
      const parts = shamsi.toShamsiParts(dateStr);
      dateStr = parts.isoDate;
    } catch (_) {}
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return res.status(400).json({ error: 'تاریخ نامعتبر' });
  const advance = Math.max(1, Number(settings.advanceDays) || 21);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const want = new Date(`${dateStr}T12:00:00`);
  const diffDays = Math.floor((want - today) / 86400000);
  if (diffDays < 0 || diffDays > advance) {
    return res.status(400).json({ error: `فقط تا ${advance} روز آینده قابل رزرو است` });
  }
  const branch = resolveBranch(req.query.branch || req.query.branchId);
  if (!branch) return res.status(400).json({ error: 'شعبه یافت نشد' });
  const partySize = Number(req.query.partySize) || 2;
  const result = listReservationSlots(branch, dateStr, partySize);
  res.json({
    date: dateStr,
    shamsiDate: shamsi.formatShamsiDate(dateStr),
    shamsiDateLong: shamsi.formatShamsiDateLong(dateStr),
    branchId: branch.id,
    partySize,
    ...result,
  });
});

app.post('/api/reservations', async (req, res) => {
  const settings = db.reservationSettings || {};
  if (settings.enabled === false) return res.status(403).json({ error: 'رزرو غیرفعال است' });
  const name = String(req.body.name || '').trim().slice(0, 80);
  const phone = normalizeDigits(req.body.phone || '').trim();
  let dateStr = String(req.body.date || '').slice(0, 10);
  if (/^\d{4}[/-]\d{1,2}[/-]\d{1,2}$/.test(dateStr)) {
    try {
      const parts = shamsi.toShamsiParts(dateStr);
      dateStr = parts.isoDate;
    } catch (_) {}
  }
  const time = String(req.body.time || '').slice(0, 5);
  const endTime = String(req.body.endTime || '').slice(0, 5);
  const note = String(req.body.note || '').trim().slice(0, 200);
  const partySize = Math.max(1, Math.min(Number(settings.maxParty) || 12, Math.round(Number(req.body.partySize) || 2)));
  const branch = resolveBranch(req.body.branchId || req.body.branch);
  if (!name) return res.status(400).json({ error: 'نام لازم است' });
  if (!PHONE_RE.test(phone)) return res.status(400).json({ error: 'شماره موبایل معتبر نیست' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return res.status(400).json({ error: 'تاریخ نامعتبر' });
  if (!/^\d{2}:\d{2}$/.test(time)) return res.status(400).json({ error: 'ساعت نامعتبر' });
  if (endTime && !/^\d{2}:\d{2}$/.test(endTime)) return res.status(400).json({ error: 'ساعت پایان نامعتبر' });
  if (!branch) return res.status(400).json({ error: 'شعبه یافت نشد' });
  const { slots, closed } = listReservationSlots(branch, dateStr, partySize);
  if (closed) return res.status(400).json({ error: 'در این روز مجموعه تعطیل است' });
  const slot = slots.find((s) => s.time === time);
  if (!slot || !slot.available) return res.status(400).json({ error: 'این ساعت موجود نیست' });
  const id = Math.max(0, ...(db.reservations || []).map((r) => r.id), 0) + 1;
  const reservation = {
    id,
    branchId: branch.id,
    name,
    phone,
    partySize,
    date: dateStr,
    time,
    endTime,
    note,
    status: 'pending',
    createdAt: new Date().toISOString(),
    statusAt: new Date().toISOString(),
  };
  db.reservations = db.reservations || [];
  db.reservations.unshift(reservation);
  db.reservations = db.reservations.slice(0, 1000);
  const notify = await notifyReservationWhatsApp(db, reservation);
  recordAudit(null, 'reservation.created', 'reservation', reservation.id, { partySize: reservation.partySize }, reservation.branchId);
  publishOperationalEvent('reservation.created', { reservationId: reservation.id, branchId: reservation.branchId, status: reservation.status });
  save();
  res.json({
    ok: true,
    reservation: {
      ...reservation,
      shamsiDate: shamsi.formatShamsiDate(reservation.date),
      shamsiDateLong: shamsi.formatShamsiDateLong(reservation.date),
      shamsiDateFull: shamsi.formatShamsiDateFull(reservation.date),
      branchName: branch.name,
      restaurantName: db.restaurant?.name,
    },
    whatsapp: notify.skipped ? null : notify,
  });
});

app.get('/api/admin/reservations', requireCapability('reservations.view'), (req, res) => {
  // Walk-in guests have no date/time slot; they are served by the waiter
  // reception endpoint and must not pollute the online reservation calendar.
  let list = (db.reservations || []).filter((item) => !waitlist.isWaitlist(item)).slice();
  if (req.query.branchId) {
    const bid = Number(req.query.branchId);
    list = list.filter((r) => Number(r.branchId) === bid);
  }
  let queryDate = req.query.date ? String(req.query.date).slice(0, 10) : null;
  if (queryDate && /^\d{4}[/-]\d{1,2}[/-]\d{1,2}$/.test(queryDate)) {
    try {
      const p = shamsi.toShamsiParts(queryDate);
      queryDate = p.isoDate;
    } catch (_) {}
  }
  if (queryDate) list = list.filter((r) => r.date === queryDate);
  if (req.query.status) list = list.filter((r) => r.status === req.query.status);
  const today = new Date().toISOString().slice(0, 10);
  const active = list.filter((r) => ACTIVE_RES_STATUSES.has(r.status));
  const terminal = new Set(['cancelled', 'no_show']);
  list.sort((a, b) => {
    const aClosed = terminal.has(String(a.status));
    const bClosed = terminal.has(String(b.status));
    if (aClosed !== bClosed) return aClosed ? 1 : -1;
    const ak = `${a.date || ''}T${a.time || '00:00'}`;
    const bk = `${b.date || ''}T${b.time || '00:00'}`;
    return aClosed ? bk.localeCompare(ak) : ak.localeCompare(bk);
  });
  const maxCovers = Math.max(1, Number(db.reservationSettings?.maxCoversPerSlot) || 24);
  const slotMap = new Map();
  for (const r of active) {
    const key = `${r.date}|${r.time}`;
    const row = slotMap.get(key) || { date: r.date, time: r.time, covers: 0, parties: 0 };
    row.covers += Math.max(1, Number(r.partySize) || 1);
    row.parties += 1;
    slotMap.set(key, row);
  }
  const slotLoad = [...slotMap.values()]
    .map((row) => ({ ...row, maxCovers, percent: Math.min(100, Math.round((row.covers / maxCovers) * 100)) }))
    .sort((a, b) => `${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`))
    .slice(0, 120);
  const todayActive = active.filter((r) => r.date === today);
  res.json({
    reservations: list.slice(0, 200).map((r) => ({
      ...r,
      shamsiDate: shamsi.formatShamsiDate(r.date),
      shamsiDateLong: shamsi.formatShamsiDateLong(r.date),
      shamsiDateFull: shamsi.formatShamsiDateFull(r.date),
    })),
    settings: db.reservationSettings,
    slotLoad,
    serverTime: new Date().toISOString(),
    summary: {
      today: todayActive.length,
      todayCovers: todayActive.reduce((sum, r) => sum + Math.max(1, Number(r.partySize) || 1), 0),
      pending: list.filter((r) => r.status === 'pending').length,
      confirmed: list.filter((r) => r.status === 'confirmed').length,
      seated: list.filter((r) => r.status === 'seated' && r.date === today).length,
      noShowToday: list.filter((r) => r.status === 'no_show' && r.date === today).length,
    },
  });
});

app.patch('/api/admin/reservations/:id', requireCapability('reservations.manage'), (req, res) => {
  const targetId = Number(normalizeDigits(String(req.params.id || '')).replace(/\D/g, ''));
  const item = (db.reservations || []).find((r) => Number(r.id) === targetId);
  if (!item) return res.status(404).json({ error: 'not found' });
  const allowed = ['pending', 'confirmed', 'seated', 'cancelled', 'no_show'];
  if (typeof req.body.status === 'string' && allowed.includes(req.body.status)) {
    item.status = req.body.status;
    item.statusAt = new Date().toISOString();
  }
  if (typeof req.body.note === 'string') item.note = req.body.note.trim().slice(0, 200);
  if (req.body.partySize != null) {
    const rawParty = typeof req.body.partySize === 'number'
      ? req.body.partySize
      : Number(String(req.body.partySize).replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).trim());
    if (!isNaN(rawParty)) {
      item.partySize = Math.max(1, Math.min(Number(db.reservationSettings?.maxParty) || 12, Math.round(rawParty)));
    }
  }
  recordAudit(req, 'reservation.updated', 'reservation', item.id, { status: item.status, partySize: item.partySize }, item.branchId);
  publishOperationalEvent('reservation.updated', { reservationId: item.id, branchId: item.branchId, status: item.status });
  save();
  res.json({ ok: true, reservation: item });
});

app.get('/api/admin/reservation-settings', requireAdmin, (req, res) => {
  res.json({ settings: db.reservationSettings || {} });
});

app.put('/api/admin/reservation-settings', requireAdmin, (req, res) => {
  if (!db.reservationSettings) db.reservationSettings = {};
  const s = req.body.settings || req.body || {};
  const parseNum = (v) => {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return isNaN(v) ? null : v;
    const clean = String(v)
      .replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d))
      .replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))
      .replace(/[,٬_\s]/g, '')
      .trim();
    const n = Number(clean);
    return isNaN(n) ? null : n;
  };

  if (typeof s.enabled === 'boolean') db.reservationSettings.enabled = s.enabled;
  const slotMinutes = parseNum(s.slotMinutes);
  if (slotMinutes != null) {
    db.reservationSettings.slotMinutes = Math.max(15, Math.min(120, Math.round(slotMinutes)));
  }
  const maxParty = parseNum(s.maxParty);
  if (maxParty != null) {
    db.reservationSettings.maxParty = Math.max(1, Math.min(40, Math.round(maxParty)));
  }
  const maxCoversPerSlot = parseNum(s.maxCoversPerSlot);
  if (maxCoversPerSlot != null) {
    db.reservationSettings.maxCoversPerSlot = Math.max(1, Math.min(200, Math.round(maxCoversPerSlot)));
  }
  const advanceDays = parseNum(s.advanceDays);
  if (advanceDays != null) {
    db.reservationSettings.advanceDays = Math.max(1, Math.min(90, Math.round(advanceDays)));
  }
  const minHoursAhead = parseNum(s.minHoursAhead);
  if (minHoursAhead != null) {
    db.reservationSettings.minHoursAhead = Math.max(0, Math.min(48, Math.round(minHoursAhead)));
  }
  save();
  res.json({ ok: true, settings: db.reservationSettings });
});

app.get('/api/admin/whatsapp', requireAdmin, (req, res) => {
  res.json({
    settings: db.whatsappNotify || {},
    log: (db.whatsappLog || []).slice(0, 40),
    webhookConfigured: !!process.env.WHATSAPP_WEBHOOK_URL,
    resolvedPhone: toWaDigits(resolveNotifyPhone(db, req.query.branchId)),
  });
});

app.put('/api/admin/whatsapp', requireAdmin, (req, res) => {
  if (!db.whatsappNotify) db.whatsappNotify = {};
  const s = req.body.settings || req.body || {};
  if (typeof s.enabled === 'boolean') db.whatsappNotify.enabled = s.enabled;
  if (typeof s.onOrder === 'boolean') db.whatsappNotify.onOrder = s.onOrder;
  if (typeof s.onReservation === 'boolean') db.whatsappNotify.onReservation = s.onReservation;
  if (typeof s.phone === 'string') {
    db.whatsappNotify.phone = normalizeDigits(s.phone).trim();
  }
  save();
  res.json({ ok: true, settings: db.whatsappNotify });
});

app.post('/api/admin/whatsapp/order/:id', requireAdmin, (req, res) => {
  const targetId = Number(normalizeDigits(String(req.params.id || '')).replace(/\D/g, ''));
  const order = (db.orders || []).find((o) => Number(o.id) === targetId);
  if (!order) return res.status(404).json({ error: 'not found' });
  const branch = (db.branches || []).find((b) => b.id === Number(order.branchId));
  const text = buildOrderMessage(order, {
    brand: db.restaurant?.name || 'وستو',
    branchName: branch?.name,
  });
  const phone = resolveNotifyPhone(db, order.branchId);
  const url = waMeUrl(phone, text);
  if (!url) return res.status(400).json({ error: 'شماره واتساپ تنظیم نشده' });
  res.json({ ok: true, url, phone: toWaDigits(phone), text });
});

// --- customer feedback / NPS ---
function feedbackNpsStats(list) {
  const scores = (list || []).map((f) => Number(f.score)).filter((n) => Number.isFinite(n) && n >= 0 && n <= 10);
  const promoters = scores.filter((s) => s >= 9).length;
  const passives = scores.filter((s) => s >= 7 && s <= 8).length;
  const detractors = scores.filter((s) => s <= 6).length;
  const nps = scores.length ? Math.round(((promoters - detractors) / scores.length) * 100) : null;
  const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
  return { count: scores.length, promoters, passives, detractors, nps, avg };
}

app.get('/api/feedback/meta', (req, res) => {
  const s = db.feedbackSettings || {};
  const branch = resolveBranch(req.query.branchId);
  res.json({
    enabled: s.enabled !== false,
    title: s.title || 'نظر شما',
    subtitle: s.subtitle || '',
    thankYou: s.thankYou || 'ممنون',
    restaurant: db.restaurant?.name || 'وستو',
    branch: branch ? { id: branch.id, name: branch.name } : null,
    branches: (db.branches || [])
      .filter((b) => b.active !== false)
      .map((b) => ({ id: b.id, name: b.name })),
  });
});

app.post('/api/feedback', (req, res) => {
  const s = db.feedbackSettings || {};
  if (s.enabled === false) return res.status(403).json({ error: 'بازخورد غیرفعال است' });
  if (req.body.score == null || req.body.score === '' || typeof req.body.score === 'boolean') {
    return res.status(400).json({ error: 'امتیاز باید عدد صحیح ۰ تا ۱۰ باشد' });
  }
  const score = Number(req.body.score);
  if (!Number.isFinite(score) || score < 0 || score > 10 || Math.floor(score) !== score) {
    return res.status(400).json({ error: 'امتیاز باید عدد صحیح ۰ تا ۱۰ باشد' });
  }
  const branch = resolveBranch(req.body.branchId);
  const comment = String(req.body.comment || '').trim().slice(0, 800);
  const name = String(req.body.name || '').trim().slice(0, 80);
  const phone = normalizeDigits(req.body.phone || '').trim().slice(0, 15);
  const orderId = req.body.orderId != null ? Number(req.body.orderId) : null;
  const source = String(req.body.source || 'web').trim().slice(0, 40);
  const entry = {
    id: Math.max(0, ...(db.feedback || []).map((f) => f.id), 0) + 1,
    score,
    bucket: score >= 9 ? 'promoter' : score >= 7 ? 'passive' : 'detractor',
    comment,
    name,
    phone,
    orderId: Number.isFinite(orderId) && orderId > 0 ? orderId : null,
    branchId: branch?.id || null,
    source,
    status: 'new',
    createdAt: new Date().toISOString(),
  };
  db.feedback = db.feedback || [];
  db.feedback.unshift(entry);
  db.feedback = db.feedback.slice(0, 2000);
  save();
  res.json({ ok: true, id: entry.id, thankYou: s.thankYou || 'ممنون از بازخوردتان' });
});

app.get('/api/admin/feedback', requireAdmin, (req, res) => {
  const bid = req.query.branchId ? Number(req.query.branchId) : null;
  let list = db.feedback || [];
  if (bid) list = list.filter((f) => Number(f.branchId) === bid);
  const days = Math.min(90, Math.max(1, Number(req.query.days) || 30));
  const since = Date.now() - days * 24 * 3600 * 1000;
  const windowed = list.filter((f) => new Date(f.createdAt).getTime() >= since);
  res.json({
    settings: db.feedbackSettings || {},
    feedback: list.slice(0, 100),
    stats: feedbackNpsStats(windowed),
    days,
  });
});

app.put('/api/admin/feedback/settings', requireAdmin, (req, res) => {
  if (!db.feedbackSettings) db.feedbackSettings = {};
  const s = req.body.settings || req.body || {};
  if (typeof s.enabled === 'boolean') db.feedbackSettings.enabled = s.enabled;
  if (typeof s.askAfterOrder === 'boolean') db.feedbackSettings.askAfterOrder = s.askAfterOrder;
  if (typeof s.title === 'string') db.feedbackSettings.title = s.title.trim().slice(0, 120);
  if (typeof s.subtitle === 'string') db.feedbackSettings.subtitle = s.subtitle.trim().slice(0, 240);
  if (typeof s.thankYou === 'string') db.feedbackSettings.thankYou = s.thankYou.trim().slice(0, 200);
  save();
  res.json({ ok: true, settings: db.feedbackSettings });
});

app.patch('/api/admin/feedback/:id', requireAdmin, (req, res) => {
  const targetId = Number(normalizeDigits(String(req.params.id || '')).replace(/\D/g, ''));
  const item = (db.feedback || []).find((f) => Number(f.id) === targetId);
  if (!item) return res.status(404).json({ error: 'not found' });
  const st = String(req.body.status || '').trim();
  if (['new', 'reviewed', 'archived'].includes(st)) item.status = st;
  save();
  res.json({ ok: true, item });
});

// ---- pages & static -----------------------------------------------------
app.get('/', (req, res, next) => {
  // Old overlay deep-links → classic menu page
  if (req.query.menu != null || req.query.item != null) {
    const q = new URLSearchParams();
    if (req.query.cat != null) q.set('cat', String(req.query.cat));
    if (req.query.item != null) q.set('item', String(req.query.item));
    if (req.query.lang != null) q.set('lang', String(req.query.lang));
    if (req.query.q != null) q.set('q', String(req.query.q));
    if (req.query.exclude != null) q.set('exclude', String(req.query.exclude));
    const qs = q.toString();
    return res.redirect(302, '/menu' + (qs ? `?${qs}` : ''));
  }

  // Conservative 103 Early Hints: only resources that are unconditionally
  // needed by the root experience. No speculative menu images are hinted here;
  // the in-page resource scheduler owns those so user intent can preempt them.
  if (typeof res.writeEarlyHints === 'function') {
    try {
      res.writeEarlyHints({
        link: [
          '</css/westo-critical.smart.css?v=release14uf1d29-promo-geometry>; rel=preload; as=style',
          '</js/westo-smart-loader.js?v=release14uf1d29-promo-geometry>; rel=preload; as=script',
          '</js/westo-app.smart.js?v=release14uf1d29-promo-geometry>; rel=preload; as=script',
          '</api/content-bootstrap.js>; rel=preload; as=script',
          '</assets/fonts/Vazirmatn-Variable.woff2>; rel=preload; as=font; type=font/woff2; crossorigin',
        ],
      });
    } catch (_) {}
  }
  next();
});

const PAGES = {
  '/login': 'login.html',
  '/admin': 'admin.html',
  '/admin.html': 'admin.html',
  '/admin/cashier': 'role-panel.html',
  '/admin/waiter': 'role-panel.html',
  '/admin/kitchen': 'role-panel.html',
  '/profile': 'profile.html',
  '/menu': 'menu.html',
  '/order': 'order.html',
  '/menu-print': 'menu-print.html',
  '/reserve': 'reserve.html',
  '/about': 'about.html',
  '/feedback': 'feedback.html',
  '/cgu': 'cgu.html',
  '/mentions-legales': 'mentions-legales.html',
  '/politique-de-confidentialite': 'politique-de-confidentialite.html',
};

// Aliases for Operational Panels (POS, Waiter, KDS)
app.get(['/pos', '/pos.html', '/cashier', '/cashier.html'], (req, res) => res.redirect(302, '/admin/cashier'));
app.get(['/waiter', '/waiter.html'], (req, res) => res.redirect(302, '/admin/waiter'));
app.get(['/kitchen', '/kitchen.html', '/kds', '/kds.html'], (req, res) => res.redirect(302, '/admin/kitchen'));

app.get(Object.keys(PAGES), (req, res) => {
  if (req.path.startsWith('/admin') || req.path === '/login') res.setHeader('Cache-Control', 'no-store');
  const pagePath = PAGES[req.path] || PAGES[String(req.path || '').replace(/\/$/, '')];
  if (!pagePath) return res.status(404).send('Not Found');
  res.sendFile(path.join(ROOT, pagePath));
});

// The installed app always revalidates its lifecycle files. Versioned code can
// remain immutable; media keeps a bounded window so admin updates stay fresh.
app.get('/sw.js', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Service-Worker-Allowed', '/');
  res.type('application/javascript');
  res.sendFile(path.join(ROOT, 'sw.js'));
});

app.get('/manifest.webmanifest', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.type('application/manifest+json');
  res.sendFile(path.join(ROOT, 'manifest.webmanifest'));
});

app.use((req, res, next) => {
  const pathname = String(req.path || '');
  if (pathname === '/admin.html' || /^\/(?:js\/admin(?:-|\.)|css\/admin(?:-|\.))/.test(pathname)) {
    res.setHeader('Cache-Control', 'no-store, max-age=0, must-revalidate');
  } else if (/^\/uploads\//.test(pathname)) {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  } else if (/^\/assets\/(?:fonts|images|audio)\//.test(pathname)) {
    res.setHeader('Cache-Control', 'public, max-age=86400');
  } else if (/^\/assets\/menu\//.test(pathname)) {
    res.setHeader('Cache-Control', 'public, max-age=3600');
  } else if (/^\/(?:js|css)\//.test(pathname) && req.query.v) {
    if (process.env.NODE_ENV === 'production') {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    } else {
      res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    }
  }
  next();
});
app.use('/api', (req, res) => {
  res.status(404).json({
    ok: false,
    error: 'route_not_found',
    message: `مسیر ${req.method} ${req.originalUrl || req.path} در سرور یافت نشد.`,
    requestId: req.requestId,
  });
});

// Strict static asset security perimeter (blocks path traversal, source code, keys, and internal configs)
const FORBIDDEN_STATIC_PREFIXES = [
  '/server',
  '/scripts',
  '/test',
  '/node_modules',
  '/backups',
  '/artifacts',
  '/docs',
  '/desktop',
  '/sites',
  '/storage',
  '/nginx',
  '/e2e',
  '/dist-desktop'
];

const FORBIDDEN_STATIC_EXTENSIONS = /\.(key|pem|crt|env|json|ya?ml|sql|log|enc|sh|ts|lock|bak|conf|ini|sqlite|db|md|config\.js)$/i;

app.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  let decodedPath = '';
  try {
    decodedPath = decodeURIComponent(req.path);
  } catch {
    return res.status(400).send('Bad Request');
  }

  // Prevent path traversal
  if (decodedPath.includes('..') || decodedPath.includes('\\')) {
    return res.status(403).send('Forbidden');
  }

  // Prevent hidden / dotfile access
  if (/(?:^|\/)\./.test(decodedPath)) {
    return res.status(404).send('Not Found');
  }

  // Prevent internal directory exposure
  const normalizedPath = path.posix.normalize(decodedPath);
  for (const prefix of FORBIDDEN_STATIC_PREFIXES) {
    if (normalizedPath === prefix || normalizedPath.startsWith(prefix + '/')) {
      return res.status(404).send('Not Found');
    }
  }

  // Prevent sensitive file extensions exposure
  if (FORBIDDEN_STATIC_EXTENSIONS.test(normalizedPath)) {
    return res.status(404).send('Not Found');
  }

  next();
});

app.use(express.static(ROOT, { extensions: ['html'], etag: true, lastModified: true }));
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const status = Number.isInteger(err.status) && err.status >= 400 && err.status < 600
    ? err.status
    : 500;
  const isApi = req.path && req.path.startsWith('/api/');
  const code = err.code || (status === 500 ? 'internal_server_error' : 'error');
  const message = (process.env.NODE_ENV === 'production' && status === 500)
    ? 'خطای غیرمنتظره در سرور رخ داد.'
    : (err.message || 'خطای غیرمنتظره در سرور رخ داد.');

  if (status >= 500) {
    console.error(`[unhandled_error] ${req.method} ${req.path} (${req.requestId}):`, err);
  }

  if (isApi || req.xhr || (req.headers.accept && req.headers.accept.includes('application/json'))) {
    return res.status(status).json({
      ok: false,
      error: code,
      message,
      requestId: req.requestId,
    });
  }
  return res.status(status).send(`<!DOCTYPE html><html><body><h1>خطای ${status}</h1><p>${message}</p></body></html>`);
});

let httpServer = null;

async function hydrateStateFromPostgres() {
  if (!stateStore.enabled) {
    if (stateStore.required) {
      const error = new Error('WESTO_POSTGRES_REQUIRED is enabled but PostgreSQL is unavailable.');
      error.code = 'postgres_required_unavailable';
      throw error;
    }
    return { source: 'json' };
  }
  const loaded = await stateStore.hydrate(db);
  const migrated = loaded.state ? migrateDb(loaded.state) : null;
  if (migrated && migrated !== db) {
    // Keep the exported reference stable for every route while promoting the
    // PostgreSQL snapshot to the active in-memory state.
    for (const key of Object.keys(db)) delete db[key];
    Object.assign(db, migrated);
  }
  return loaded;
}

async function startServer() {
  if (httpServer) return httpServer;
  try {
    const loaded = await hydrateStateFromPostgres();
    console.log(`[storage] command center source: ${loaded.source}`);
  } catch (error) {
    // Shadow mode retains a deliberate recovery path. Cutover mode must fail
    // closed so a transient database issue cannot silently restore JSON as a
    // writable financial authority.
    if (stateStore.required) throw error;
    console.error('[postgres] startup hydration failed; using JSON snapshot', error.message);
  }
  rebuildProductsFromMenu();
  save();
  void neemBridge.flush();
  httpServer = await new Promise((resolve, reject) => {
    const server = app.listen(PORT, HOST, (error) => {
      if (error) {
        reject(error);
        return;
      }
      console.log(`Westo server on http://${HOST}:${PORT}`);
      resolve(server);
    });
  });
  return httpServer;
}

async function shutdown(signal) {
  if (shutdown.running) return;
  shutdown.running = true;
  console.log(`[server] ${signal} received; shutting down gracefully`);
  try {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    const pendingSaveWaiters = saveWaiters;
    saveWaiters = [];
    let shutdownPersistenceError = null;
    if (shouldWriteJsonState()) {
      try {
        const encoded = JSON.stringify(db, null, 2);
        const tmpPath = `${DB_PATH}.${process.pid}.shutdown.tmp`;
        fs.writeFileSync(tmpPath, encoded, { mode: 0o600 });
        fs.renameSync(tmpPath, DB_PATH);
      } catch (error) { shutdownPersistenceError = error; console.error('[storage] shutdown snapshot failed', error.message); }
    }
    if (httpServer) await new Promise((resolve) => httpServer.close(resolve));
    if (stateStore.enabled) {
      try { await stateStore.write(db); } catch (error) { shutdownPersistenceError = error; console.error('[postgres] shutdown flush failed', error.message); }
    }
    for (const pending of pendingSaveWaiters) {
      if (shutdownPersistenceError && pending.requireDurable) pending.reject(shutdownPersistenceError);
      else pending.resolve(!shutdownPersistenceError);
    }
    await stateStore.close();
  } finally { process.exit(0); }
}
['SIGTERM', 'SIGINT'].forEach((signal) => process.once(signal, () => shutdown(signal)));

if (require.main === module) {
  startServer().catch(async (error) => {
    console.error('[server] unable to start', error);
    try { await stateStore.close(); } catch (closeError) { console.error('[postgres] startup cleanup failed', closeError.message); }
    process.exitCode = 1;
  });
}

module.exports = {
  app,
  startServer,
  db,
  stateStore,
  eventHub,
  tenantConfig: TENANT_CONFIG,
  commandCenterPayload,
  publicContentPayload,
  shouldWriteJsonState,
};
