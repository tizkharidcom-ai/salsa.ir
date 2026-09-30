/* Westo server: static site + OTP auth + admin/content API (JSON file storage). */
if (!process.env.SALSA_CONTROL_ALLOW_EPHEMERAL_DEV && !process.env.NEEM_CONTROL_ALLOW_EPHEMERAL_DEV) {
  process.env.SALSA_CONTROL_ALLOW_EPHEMERAL_DEV = 'true';
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
  FULFILLMENTS,
  paymentStatusFor,
  initialOrderStatus,
  hasAcceptedDelivery,
  nextOrderStatusAfterPayment,
  nextOrderStatusAfterDeliveryAcceptance,
  canTransitionOrder,
  canEditOrderBeforeKitchen,
  canSettleOrder,
  allowedOrderTransitions,
  quoteFulfillment,
  nextId,
  createAuditEntry,
  createEventHub,
  isOwnerActor,
  assertStaffMutationBoundary,
} = require('./command-center');
const { createPostgresStateStore } = require('./postgres-state');
const { createCheckoutQuoteToken, verifyCheckoutQuoteToken } = require('./checkout-quote');
const { publicCheckoutOrderView } = require('./public-checkout-order');
const { customerOrderProgress } = require('./customer-order-progress');
const { paymentProviderPublicStatus } = require('./payment-provider-status');
const { createSessionToken, readSessionToken, sessionTokenMatchesTenant } = require('./session-token');
const { normalizeSettlementReference, settlementReferenceIdentity } = require('./settlement-reference');
const { resolveSettlementAmounts } = require('./settlement-amounts');
const { menuItemBelongsToBranch } = require('./menu-branch-scope');
const {
  menuAvailabilityOverride,
  menuItemAvailableForBranch,
  setMenuAvailabilityOverride,
} = require('./menu-availability');
const { createSettlementInFlightKey } = require('./settlement-in-flight-key');
const { resolveAuditTenantId } = require('./audit-tenant-scope');
const { paymentAttemptTransition, orderPaymentStatusForAttempt } = require('./payment-attempt-transitions');
const { isOtpDemoMode } = require('./otp-policy');
const {
  highestAssignedSeat,
  validateCoversForItems,
  validateOrderLineInput,
  validateWaiterOrderAdd,
  validateWaiterKitchenSend,
  validateWaiterCourseFire,
  validateWaiterSettlementTiming,
  validateWaiterOrderEdit,
  validateDeliveryAcceptance,
  isKitchenOrderPaymentEligible,
} = require('./waiter-order-invariants');
const { retainOperationalOrders, mergeActionableOrders } = require('./operational-order-retention');
const { normalizeOrderHistoryCursor, historyPageSize, paginateCachedClosedOrders } = require('./order-history');
const { orderCancellationGuard, receivedAmount, shouldReleaseOrderInventory } = require('./order-cancellation-guard');
const { orderSplitLifecycleGuard } = require('./order-split-policy');
const { prepareKitchenQueue } = require('./kitchen-queue');
const { getOrderAging } = require('./operational-order-aging');
const { translationEngine } = require('./salsa/provider-policy');
const {
  registerAdminV2Routes,
  adminOrderDto,
  operationalOrderDto,
  adminPaymentDto,
} = require('./admin-v2');
const financeV2 = require('./finance-v2');
const {
  effectiveModifierGroupsForItem,
  validateModifierGroupDefinitions,
  calculateModifierLinePrice,
} = require('./menu-modifiers');
const accountingEngine = require('./accounting-engine');
const { buildCheckoutTaxSnapshot } = require('./checkout-tax');
const { registerAccountingRoutes } = require('./accounting-routes');
const loyaltyEngine = require('./finance/loyalty-engine');
const loyaltyAchievements = require('./finance/loyalty-achievements');
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
const { createSalsaBridge, createNeemBridge } = require('./salsa-bridge');
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
const {
  loadTenantConfig,
  tenantHostMiddleware,
  publicTenantContext,
  normalizeTenantId,
} = require('./salsa/tenant-config');
const { TenantRegistry } = require('./salsa/tenant-registry');
const { legacyTenantPersistenceError } = require('./salsa/tenant-persistence-policy');
const {
  hasControlPlaneBridgeCredential,
  isTrustedLocalControlPlaneOrigin,
} = require('./control-plane-bridge-auth');
const { createSettlementPersistenceGate } = require('./settlement-persistence-gate');
const { runtimeReadiness } = require('./runtime-readiness');
const {
  CANONICAL_FEATURES,
  resolveFeatureForRoute,
  isFeatureEnabledForTenant,
  getFeatureInfo,
} = require('./salsa/canonical-features');
const {
  createSalsaPrincipalMiddleware,
  createNeemPrincipalMiddleware,
  requireCapabilityEnforced,
  requireAnyCapabilityEnforced,
  salsaRouteAwarePolicyMiddleware,
  neemRouteAwarePolicyMiddleware,
  isOwnerOnlySettingsCategory,
  assertTenantBoundary,
} = require('./salsa/westo-policy-enforcement');
const { lookupCapability, lookupPolicyCapability } = require('./salsa/route-capability-map');
const {
  tenantStorage,
  createTenantContext,
} = require('./salsa/tenant-context');
const { TenantResolver } = require('./salsa/tenant-resolver');
const {
  ControlDataAccess,
  TenantConnectionManager,
} = require('./salsa/data-access');
const { tenantMenuRepository } = require('./salsa/tenant-menu-repository');

const ROOT = path.join(__dirname, '..');
const DB_PATH = process.env.WESTO_DB_PATH || path.join(__dirname, 'data', 'db.json');
// These legacy platform operator identities must authenticate through the
// platform control plane, never as restaurant owners in a tenant session.
const PLATFORM_ONLY_PHONE_IDENTITIES = new Set(['09120000000']); // [DEV] removed 09374333028

function isPlatformOnlyIdentity(userOrPhone) {
  const phone = typeof userOrPhone === 'string' || typeof userOrPhone === 'number'
    ? String(userOrPhone)
    : String(userOrPhone?.phone || '');
  const normalizedPhone = normalizeDigits(phone).trim();
  return Boolean(userOrPhone?.principalType === 'platform_admin'
    || PLATFORM_ONLY_PHONE_IDENTITIES.has(normalizedPhone));
}
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
  if (!Array.isArray(data.settings.adminPhones)) data.settings.adminPhones = [];
  data.settings.adminPhones = data.settings.adminPhones
    .map((phone) => normalizeDigits(String(phone || '')).trim())
    .filter(Boolean); // [TEMPORARILY REMOVED platform filter FOR DEV]
  // for (const user of Array.isArray(data.users) ? data.users : []) {
  //   if (isPlatformOnlyIdentity(user)) user.role = 'guest';
  // }
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
  if (!data.salsaIntegration && data.neemIntegration) {
    data.salsaIntegration = data.neemIntegration;
  }
  if (!data.salsaIntegration || typeof data.salsaIntegration !== 'object') {
    data.salsaIntegration = {
      enabled: true,
      endpoint: '',
      outbox: [],
      lastError: '',
      tenantId: TENANT_CONFIG.tenantId,
      schemaVersion: 1,
      mode: 'outbox',
    };
  }
  if (!Array.isArray(data.salsaIntegration.outbox)) data.salsaIntegration.outbox = [];
  data.salsaIntegration.tenantId = TENANT_CONFIG.tenantId;
  data.salsaIntegration.schemaVersion = 1;
  data.salsaIntegration.mode = 'outbox';
  data.neemIntegration = data.salsaIntegration;
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
const TENANT_INFRASTRUCTURE_ENABLED = TENANT_CONFIG.multiTenant
  || (process.env.SALSA_TENANT_CONTEXT_MODE || process.env.NEEM_TENANT_CONTEXT_MODE) === 'control-db';

let runtimeControlDataAccess = null;
let closeRuntimeControlDatabase = async () => {};
if (TENANT_INFRASTRUCTURE_ENABLED && (process.env.SALSA_CONTROL_DATABASE_URL || process.env.NEEM_CONTROL_DATABASE_URL)) {
  const controlDatabase = require('./salsa/control-plane/db/database');
  runtimeControlDataAccess = new ControlDataAccess({ pool: controlDatabase.getDatabase() });
  closeRuntimeControlDatabase = controlDatabase.closeDatabase;
}

const tenantResolver = new TenantResolver({
  controlDataAccess: runtimeControlDataAccess,
  baseDomain: process.env.SALSA_PLATFORM_BASE_DOMAIN || process.env.NEEM_PLATFORM_BASE_DOMAIN || 'salsa.ir',
  defaultTenant: TENANT_CONFIG.tenantId,
  defaultHosts: TENANT_CONFIG.hosts,
  localHostTenant: TENANT_CONFIG.tenantId,
  allowLocalDevelopment: process.env.NODE_ENV !== 'production',
  trustForwardedHost: (process.env.SALSA_TRUST_PROXY || process.env.NEEM_TRUST_PROXY) === 'true',
  logger: console,
});
const tenantConnectionManager = new TenantConnectionManager({
  baseUrl: process.env.SALSA_TENANT_DB_POSTGRES_URL || process.env.NEEM_TENANT_DB_POSTGRES_URL,
  logger: console,
});

function multiTenantHostMiddleware(req, res, next) {
  const rawHost = String(req.headers['x-forwarded-host'] || req.headers.host || '');
  const tenantId = tenantRegistry.resolveTenantIdForHost(rawHost, {
    defaultTenantId: TENANT_CONFIG.tenantId,
    defaultHosts: TENANT_CONFIG.hosts,
  });

  // A public host is never allowed to create a tenant merely by being
  // requested. Tenant provisioning is an authenticated control-plane action.
  if (!tenantId) {
    return res.status(404).json({
      ok: false,
      error: 'unknown_tenant_host',
      message: 'این دامنه به هیچ رستوران فعال در پلتفرم متصل نیست.',
    });
  }

  const tenantDb = tenantRegistry.getTenantDb(tenantId);
  if (!tenantDb) {
    return res.status(404).json({
      ok: false,
      error: 'tenant_storage_not_registered',
      message: 'ذخیره‌سازی این tenant ثبت نشده است.',
    });
  }
  const identity = tenantDb.tenantIdentity || {};
  req.tenant = {
    ...TENANT_CONFIG,
    tenantId,
    tenantSlug: identity.tenantSlug || tenantId,
    displayName: identity.displayName || tenantDb.restaurant?.name || tenantId,
    canonicalDomain: identity.canonicalDomain || `${tenantId}.salsa.ir`,
  };
  req.tenantHostMatched = true;
  req.tenantSlug = req.tenant.tenantSlug;
  req.tenantId = tenantId;
  next();
}

const db = new Proxy(defaultDb, {
  get(target, prop) {
    const store = tenantStorage.getStore();
    const current = (store && store.db) ? store.db : target;
    return Reflect.get(current, prop);
  },
  set(target, prop, value) {
    const store = tenantStorage.getStore();
    const current = (store && store.db) ? store.db : target;
    return Reflect.set(current, prop, value);
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
const settlementPersistenceGate = createSettlementPersistenceGate();
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
    const persistenceError = legacyTenantPersistenceError({ tenantId: currentTenantId });
    if (persistenceError) {
      return opts.requireDurable ? Promise.reject(persistenceError) : Promise.resolve(false);
    }
    try {
      const persisted = tenantRegistry.saveTenantDb(currentTenantId, { requireDurable: opts.requireDurable === true });
      if (opts.requireDurable && persisted !== true) {
        throw Object.assign(new Error('Tenant state was not persisted.'), { code: 'tenant_persistence_failed', status: 503 });
      }
      return Promise.resolve(persisted !== false);
    } catch (error) {
      if (!opts.requireDurable) return Promise.resolve(false);
      return Promise.reject(Object.assign(error, {
        code: error.code || 'tenant_persistence_failed',
        status: error.status || 503,
      }));
    }
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
    let persistenceAttempted = false;
    if (shouldWriteJsonState()) {
      persistenceAttempted = true;
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
      persistenceAttempted = true;
      try {
        const persisted = await stateStore.write(db);
        if (persisted !== true) {
          throw Object.assign(new Error('PostgreSQL state store did not confirm a durable write.'), {
            code: 'persistence_unconfirmed',
            status: 503,
          });
        }
      } catch (error) {
        persistenceError = error;
        settlementPersistenceGate.recordFailure(error);
        console.error('[postgres] unable to persist state', error.message);
      }
    }
    if (!persistenceAttempted) {
      persistenceError = Object.assign(new Error('No durable persistence backend is available.'), {
        code: 'persistence_unavailable',
        status: 503,
      });
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
  'financeV2', 'accounting', 'orders', 'cashSessions', 'staffShifts', 'paymentAttempts', 'auditLog',
  'users', 'walletLedger', 'walletTopupRequests', 'loyaltyLedger', 'loyaltyAchievementAwards', 'referrals', 'campaignLog', 'smsLog', 'menuItems', 'menuComplements', 'checkoutIdempotency',
  'menuAvailabilityOverrides', 'menuRevision', 'waiterCalls',
]);
const settlementInFlight = new Map();
function persistedOrderBranchId(order) {
  const value = order?.branchId;
  if (typeof value === 'number') return Number.isSafeInteger(value) && value > 0 ? value : null;
  if (typeof value !== 'string') return null;
  const normalized = normalizeDigits(value).trim();
  if (!/^\d+$/u.test(normalized)) return null;
  const branchId = Number(normalized);
  return Number.isSafeInteger(branchId) && branchId > 0 ? branchId : null;
}

function settlementLockKey(req, order, idempotencyKey, branchId = order?.branchId) {
  return createSettlementInFlightKey({
    tenantId: req?.tenantId || req?.tenantContext?.tenantId || req?.tenant?.tenantId,
    branchId,
    orderId: order?.id,
    idempotencyKey,
  });
}

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

async function persistFinanceMutation(snapshot, options = {}) {
  try {
    await save({ ...options, requireDurable: true });
  } catch (error) {
    restoreFinanceMutationState(snapshot);
    // A JSON recovery snapshot may have been written before a later durable
    // backend failed. Persist the restored image as well so a failed order
    // commit cannot survive a restart through that secondary snapshot.
    try {
      await save({ ...options, requireDurable: true });
    } catch (rollbackError) {
      console.error('[persistence] rollback snapshot write failed', rollbackError?.message || rollbackError);
    }
    throw error;
  }
}

const adminConfigMutationQueues = new Map();
const branchOrderMutationQueues = new Map();
const orderMutationQueues = new Map();
const checkoutOrderMutationQueues = new Map();

async function serializeOrderMutation(req, branchId, orderId, operation) {
  const tenantId = String(
    tenantStorage.getStore()?.tenantId
      || req?.tenantId
      || req?.tenantContext?.tenantId
      || req?.tenant?.tenantId
      || TENANT_CONFIG.tenantId
      || 'westo',
  );
  const branch = Number(branchId);
  const id = Number(orderId);
  if (!tenantId || !Number.isSafeInteger(branch) || branch <= 0
      || !Number.isSafeInteger(id) || id <= 0 || typeof operation !== 'function') {
    throw Object.assign(new Error('Order mutation identity is invalid.'), {
      code: 'order_mutation_identity_invalid', status: 409,
    });
  }
  const key = JSON.stringify([tenantId, branch, id]);
  const previous = orderMutationQueues.get(key) || Promise.resolve();
  const current = previous.catch(() => {}).then(operation);
  orderMutationQueues.set(key, current);
  try {
    return await current;
  } finally {
    if (orderMutationQueues.get(key) === current) orderMutationQueues.delete(key);
  }
}

async function serializeBranchOrderMutation(order, operation) {
  const tenantId = tenantStorage.getStore()?.tenantId || TENANT_CONFIG.tenantId || 'westo';
  // Serialize snapshot-backed order commits within a branch. This also keeps
  // acceptance idempotency references unique across different order ids.
  const key = `${tenantId}:${Number(order?.branchId)}`;
  const previous = branchOrderMutationQueues.get(key) || Promise.resolve();
  const current = previous.catch(() => {}).then(operation);
  branchOrderMutationQueues.set(key, current);
  try {
    return await current;
  } finally {
    if (branchOrderMutationQueues.get(key) === current) branchOrderMutationQueues.delete(key);
  }
}

async function serializeCheckoutOrderMutation(tenantId, idempotencyKey, operation) {
  const key = JSON.stringify([String(tenantId || 'westo'), String(idempotencyKey || '')]);
  const previous = checkoutOrderMutationQueues.get(key) || Promise.resolve();
  const current = previous.catch(() => {}).then(operation);
  checkoutOrderMutationQueues.set(key, current);
  try {
    return await current;
  } finally {
    if (checkoutOrderMutationQueues.get(key) === current) checkoutOrderMutationQueues.delete(key);
  }
}

function serializeOrderMutationRoute(handler) {
  return (req, res, next) => {
    const targetId = Number(normalizeDigits(String(req.params?.id || '')).replace(/\D/g, ''));
    const order = (db.orders || []).find((item) => Number(item.id) === targetId);
    if (!order) return handler(req, res, next);
    return serializeBranchOrderMutation(order, () => handler(req, res, next)).catch((error) => {
      if (res.headersSent) return undefined;
      return res.status(error.status || 503).json({ error: error.code || 'order_mutation_failed', message: error.message });
    });
  };
}

function serializePaymentOrderMutationRoute(handler) {
  return (req, res, next) => {
    const paymentId = Number(normalizeDigits(String(req.params?.id || req.body?.paymentAttemptId || '')).replace(/\D/g, ''));
    const payment = (db.paymentAttempts || []).find((item) => Number(item.id) === paymentId);
    const order = payment && (db.orders || []).find((item) => Number(item.id) === Number(payment.orderId));
    if (!order) return handler(req, res, next);
    return serializeBranchOrderMutation(order, () => handler(req, res, next)).catch((error) => {
      if (res.headersSent) return undefined;
      return res.status(error.status || 503).json({ error: error.code || 'payment_order_mutation_failed', message: error.message });
    });
  };
}

async function serializeAdminConfigMutation(branchId, operation) {
  const tenantId = tenantStorage.getStore()?.tenantId || TENANT_CONFIG.tenantId || 'westo';
  const key = `${tenantId}:${Number(branchId)}`;
  const previous = adminConfigMutationQueues.get(key) || Promise.resolve();
  const current = previous.catch(() => {}).then(operation);
  adminConfigMutationQueues.set(key, current);
  try {
    return await current;
  } finally {
    if (adminConfigMutationQueues.get(key) === current) adminConfigMutationQueues.delete(key);
  }
}

async function persistAdminConfigMutation(rollback) {
  try {
    await save({ requireDurable: true });
  } catch (error) {
    try { rollback?.(); } catch (rollbackError) {
      console.error('[admin-config] rollback failed', rollbackError?.message || rollbackError);
    }
    throw error;
  }
}

if (db.menuComplementsV1Pending) {
  delete db.menuComplementsV1Pending;
  save({ bumpMenu: true });
}
const salsaBridge = createSalsaBridge({
  getDb: () => db,
  persist: () => save(),
  logger: console,
  tenantConfig: TENANT_CONFIG,
});
const neemBridge = salsaBridge;
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

function tableBranchId(table) {
  return Number(table?.branchId) || Number(defaultBranch()?.id) || 1;
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

function makeToken(phone, tenantId = TENANT_CONFIG.tenantId) {
  return createSessionToken({
    phone,
    tenantId: normalizeTenantId(tenantId || TENANT_CONFIG.tenantId),
  }, SECRET);
}
function parseToken(token, expectedTenantId) {
  const parsed = readSessionToken(token, SECRET);
  if (!parsed || !sessionTokenMatchesTenant(parsed, expectedTenantId, {
    requireTenantClaim: TENANT_INFRASTRUCTURE_ENABLED,
  })) return null;
  return parsed;
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
  const tenantId = normalizeTenantId(
    req?.tenantId || req?.tenant?.tenantSlug || req?.tenant?.tenantId || db.tenantIdentity?.tenantId || TENANT_CONFIG.tenantId,
  );
  const data = parseToken(token, tenantId);
  if (!data || !Number.isFinite(Number(data.ts)) || Date.now() - Number(data.ts) > SESSION_TTL_MS) return null;
  const user = db.users.find((u) => u.phone === data.phone);
  if (!user || user.blocked || isPlatformOnlyIdentity(user)) return null;
  return user;
}
function effectiveRole(user) {
  if (isPlatformOnlyIdentity(user)) return 'guest';
  const adminPhones = Array.isArray(db.settings?.adminPhones) ? db.settings.adminPhones : [];
  return normalizeRole(user?.role, adminPhones, user?.phone || '');
}
function userCan(user, capability) {
  if (isPlatformOnlyIdentity(user)) return false;
  const adminPhones = Array.isArray(db.settings?.adminPhones) ? db.settings.adminPhones : [];
  const settings = { ...(db.settings || {}), adminPhones };
  return !!user && hasCapability(user, capability, settings);
}
function operationalOrderResponse(order, user) {
  return operationalOrderDto(order, {
    includePii: userCan(user, 'pii.view'),
    includePaymentReferences: userCan(user, 'payments.manage'),
    includeDeliveryReason: userCan(user, 'delivery.manage'),
  });
}
function operationalPaymentResponse(payment, user) {
  return adminPaymentDto(payment, {
    includePaymentReferences: userCan(user, 'payments.manage'),
  });
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
    tags: Array.isArray(u.tags) ? u.tags : [],
    vipNote: u.vipNote || '',
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

function recordAudit(req, action, targetType, targetId, meta = {}, branchId = null, options = {}) {
  if (req) req.auditRecorded = true;
  const entry = createAuditEntry({
    actor: req?.user || null,
    action,
    targetType,
    targetId,
    branchId,
    meta,
  });
  entry.tenantId = resolveAuditTenantId(req, tenantStorage.getStore()?.tenantId, TENANT_CONFIG.tenantId);
  db.auditLog = Array.isArray(db.auditLog) ? db.auditLog : [];
  db.auditLog.unshift(entry);
  db.auditLog = db.auditLog.slice(0, 5000);
  if (stateStore.enabled && options.deferAppend !== true) {
    stateStore.appendAudit(entry).catch((error) => console.error('[postgres] unable to append audit event', error.message));
  }
  return entry;
}

function appendAuditAfterCommit(entry) {
  if (!entry || !stateStore.enabled) return;
  stateStore.appendAudit(entry).catch((error) => console.error('[postgres] unable to append audit event', error.message));
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
const OTP_COOLDOWN_MS = Number(process.env.OTP_COOLDOWN_MS) || 0; // [TEMPORARILY 0 FOR DEV] was 60000
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
const PUBLIC_CHECKOUT_RECOVERY_RATE_LIMIT = 10;
const ORDER_IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$/;
const publicOrderRateBuckets = new Map();
const publicCheckoutRecoveryRateBuckets = new Map();

function normalizeCheckoutReceiptCode(value) {
  const compact = String(value || '').trim().replace(/[\s-]/g, '').toLowerCase();
  return /^[a-f0-9]{32}$/.test(compact) ? compact : '';
}

function checkoutReceiptIndexKey(value) {
  const code = normalizeCheckoutReceiptCode(value);
  if (!code) return '';
  return crypto.createHmac('sha256', SECRET)
    .update(`westo:guest-checkout-receipt:v1:${code}`)
    .digest('hex');
}

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
  const configuredMode = String(db.paymentProvider?.mode || 'sandbox').trim().toLowerCase();
  const configuredProvider = String(db.paymentProvider?.provider || 'sandbox').trim().toLowerCase();
  if (db.paymentProvider?.enabled === false || configuredMode === 'disabled') return false;
  if (process.env.NODE_ENV !== 'production') {
    // This checkout implements only its local sandbox flow. A configured live
    // provider is not usable until a real create-and-verify adapter exists.
    return configuredMode === 'sandbox' && configuredProvider === 'sandbox';
  }
  // A provider name/mode in the local settings is not evidence that a real
  // order-payment adapter can create and verify a bank transaction. Keep the
  // production path closed until a provider adapter is wired and verified.
  return false;
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
  if (!ORDER_IDEMPOTENCY_KEY_RE.test(idempotencyKey)) {
    res.status(400).json({ error: 'idempotency_key_required', message: 'برای ثبت سفارش تولیدی، Idempotency-Key معتبر الزامی است.' });
    return false;
  }
  if (!hasActiveLocalEntitlement(featureKey)) {
    res.status(503).json({ error: 'feature_entitlement_unavailable', featureKey, message: 'حق استفادهٔ تجاری این مسیر از Control Plane تأیید نشده است.' });
    return false;
  }
  return true;
}

function guardPublicCheckoutRecovery(req, res, next) {
  const now = Date.now();
  const key = publicMutationClientKey(req);
  const existing = publicCheckoutRecoveryRateBuckets.get(key);
  const bucket = existing && now - existing.startedAt < PUBLIC_ORDER_RATE_WINDOW_MS
    ? existing
    : { startedAt: now, count: 0 };
  bucket.count += 1;
  publicCheckoutRecoveryRateBuckets.set(key, bucket);
  if (publicCheckoutRecoveryRateBuckets.size > 5000) {
    for (const [clientKey, candidate] of publicCheckoutRecoveryRateBuckets) {
      if (now - candidate.startedAt >= PUBLIC_ORDER_RATE_WINDOW_MS) publicCheckoutRecoveryRateBuckets.delete(clientKey);
    }
  }
  if (bucket.count > PUBLIC_CHECKOUT_RECOVERY_RATE_LIMIT) {
    res.setHeader('Retry-After', '60');
    return res.status(429).json({ error: 'public_order_rate_limited', retryAfterSec: 60 });
  }
  return next();
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
const fixedTenantHostMiddleware = tenantHostMiddleware(TENANT_CONFIG, { logger: console });
app.use((req, res, next) => {
  if (!TENANT_INFRASTRUCTURE_ENABLED) {
    return fixedTenantHostMiddleware(req, res, () => {
      const tenantId = normalizeTenantId(req.tenant?.tenantSlug || req.tenant?.tenantId);
      const persistenceError = legacyTenantPersistenceError({ tenantId });
      if (persistenceError) {
        return res.status(persistenceError.status).json({ ok: false, error: persistenceError.code, message: persistenceError.message });
      }
      const tenantDb = tenantRegistry.getTenantDb(tenantId);
      if (!tenantId || !tenantDb) {
        return res.status(404).json({ ok: false, error: 'tenant_not_registered' });
      }
      const context = createTenantContext({
        tenantId,
        tenantSlug: tenantId,
        domain: req.headers.host,
        databaseName: `tenant_${tenantId.replace(/-/g, '_')}`,
        databaseProvider: 'legacy-json',
        cellId: TENANT_CONFIG.cellId,
        release: TENANT_CONFIG.release,
        source: 'fixed-local-tenant',
      });
      req.tenantContext = context;
      req.tenantId = context.tenantId;
      req.tenantSlug = context.tenantSlug;
      req.tenantDb = tenantDb;
      req.tenantDataAccess = null;
      return tenantStorage.run({ ...context, db: tenantDb, tenantDataAccess: null }, next);
    });
  }

  // New boundary mode is fail-closed: no Control DB means no tenant request.
  const controlAccess = runtimeControlDataAccess || tenantResolver.controlDataAccess;
  if (!controlAccess) {
    return res.status(503).json({
      ok: false,
      error: 'tenant_control_database_unavailable',
      message: 'Control DB برای تشخیص tenant تنظیم نشده است.',
    });
  }

  return tenantResolver.middleware()(req, res, () => {
    const context = req.tenantContext;
    const persistenceError = legacyTenantPersistenceError({ tenantId: context?.tenantId });
    if (persistenceError) {
      return res.status(persistenceError.status).json({ ok: false, error: persistenceError.code, message: persistenceError.message });
    }
    let legacyDb = tenantRegistry.getTenantDb(context.tenantId);
    if (!legacyDb) {
      legacyDb = tenantRegistry.provisionTenant(context.tenantId, {
        name: context.tenantSlug,
        domain: context.domain,
        cellId: context.cellId,
      });
    }
    const tenantDb = legacyDb;
    req.tenant = {
      ...TENANT_CONFIG,
      tenantId: context.tenantId,
      tenantSlug: context.tenantSlug,
      canonicalDomain: context.domain || TENANT_CONFIG.canonicalDomain,
      cellId: context.cellId || TENANT_CONFIG.cellId,
      release: context.release || TENANT_CONFIG.release,
    };
    req.tenantId = context.tenantId;
    req.tenantSlug = context.tenantSlug;
    req.tenantDb = tenantDb;
    req.tenantDataAccess = tenantConnectionManager.forContext(context);
    return tenantStorage.run({
      ...context,
      db: tenantDb,
      tenantDataAccess: req.tenantDataAccess,
      controlDataAccess: controlAccess,
    }, next);
  });
});
app.use((req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const readiness = settlementPersistenceGate.check({
    postgresEnabled: stateStore.enabled,
    postgresRequired: stateStore.required,
  });
  if (readiness.ok) return next();
  return res.status(readiness.status).json({
    ok: false,
    error: readiness.code,
    message: readiness.message,
    persistenceError: settlementPersistenceGate.uncertainty()?.code,
  });
});
// ── SALSA Tenant Policy Enforcement Layer ───────────────────────────────────
// Attaches req.salsaPrincipal & req.neemPrincipal on every request (non-blocking).
// Resolve WESTO's signed session before the route-aware policy layer so an
// authenticated operator is not evaluated as the anonymous guest.
app.use(createSalsaPrincipalMiddleware({ resolveUser: currentUser }));
// Shadow-evaluates (or enforces, depending on SALSA_POLICY_MODE / NEEM_POLICY_MODE) policy for
// all routes listed in the route-capability-map. In shadow mode this never
// blocks; in enforce mode it returns 403 on DENY.
app.use(salsaRouteAwarePolicyMiddleware());
// SALSA God Mode dynamic feature entitlement gate
app.use((req, res, next) => {
  const isFinance = req.path.startsWith('/api/admin/finance') || req.path.startsWith('/api/admin/v2/finance');
  if (isFinance) {
    const entitlements = db.salsaEntitlements || db.featureEntitlements || db.neemEntitlements;
    const financeGrant = entitlements && entitlements['finance.workspace'];
    if (financeGrant && (financeGrant.active === false || financeGrant.status === 'disabled')) {
      return res.status(403).json({
        ok: false,
        error: 'feature_disabled',
        featureKey: 'finance.workspace',
        message: 'بخش حسابداری و امور مالی توسط کنترل‌پلن SALSA برای این مشتری غیرفعال شده است.'
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
        message: `قابلیت «${info.nameFa || featureKey}» توسط کنترل‌پلن SALSA برای این مشتری غیرفعال شده است.`
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
  if (!req.path.startsWith('/api/')) return next();
  const origin = String(req.headers.origin || '');
  const hasSessionCookie = Boolean(getCookie(req, 'westo_session'));
  const fetchSite = String(req.headers['sec-fetch-site'] || '').toLowerCase();
  if (hasSessionCookie && !origin) {
    return res.status(403).json({ error: 'same_origin_required', requestId: req.requestId });
  }
  if (hasSessionCookie && fetchSite === 'cross-site') {
    return res.status(403).json({ error: 'cross_origin_write_blocked', requestId: req.requestId });
  }
  if (!origin) return next(); // server-to-server integrations and non-cookie clients
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
      ...getOrderAging(order, now),
      id: order.id,
      branchId: order.branchId,
      status: order.status,
      paymentStatus: paymentStatusFor(order),
      fulfillment: normalizeFulfillment(order.fulfillment, { tableNo: order.tableNo }),
      tableNo: order.tableNo || null,
      customerName: order.name || 'مهمان',
      total: order.total,
      createdAt: order.createdAt,
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
  const delayed = queue.filter((item) => item.attentionType === 'kitchen');
  const paymentAttention = queue.filter((item) => item.attentionType === 'payment');
  const handoffAttention = queue.filter((item) => item.attentionType === 'handoff');
  const kitchenQueue = queue.filter((item) => ['sent_to_kitchen', 'paid', 'preparing'].includes(item.status)).length;
  return {
    generatedAt: new Date().toISOString(),
    revision: Number(db.commandCenter?.eventRevision || 0),
    branchId: branchId || null,
    summary: {
      queue: queue.length,
      delayed: delayed.length,
      kitchenQueue,
      paymentAttention: paymentAttention.length,
      handoffAttention: handoffAttention.length,
      lowStock: lowStock.length,
      reservationsToday: activeReservations.length,
      pendingPayments: paymentAttempts.filter((item) => item.status === 'pending').length + queue.filter((item) => item.paymentStatus === 'pending').length,
      capacity: { used: usedCapacity, total: tableCapacity, percent: tableCapacity ? Math.round((usedCapacity / tableCapacity) * 100) : 0 },
    },
    queue,
    delayed,
    paymentAttention,
    handoffAttention,
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
  const opening = parseCashDrawerAmount(session?.openingAmount, { allowZero: true });
  if (opening == null) return null;
  const movements = session?.movements === undefined ? [] : session.movements;
  if (!Array.isArray(movements)) return null;
  let signed = 0;
  let sales = 0;
  let payIn = 0;
  let payOut = 0;
  let refunds = 0;
  const addSafe = (current, amount) => {
    const next = current + amount;
    return Number.isSafeInteger(next) ? next : null;
  };
  for (const movement of movements) {
    if (!movement || typeof movement !== 'object' || Array.isArray(movement)) return null;
    const rawAmount = movement.amount;
    const normalized = typeof rawAmount === 'string' ? normalizeDigits(rawAmount).trim() : rawAmount;
    if ((typeof normalized !== 'number' && (typeof normalized !== 'string' || !/^[+-]?\d+$/u.test(normalized)))
      || !Number.isSafeInteger(Number(normalized)) || Number(normalized) === 0) return null;
    const amount = Number(normalized);
    signed = addSafe(signed, amount);
    if (signed == null) return null;
    if (movement.type === 'sale') {
      if (amount < 0) return null;
      sales = addSafe(sales, amount);
      if (sales == null) return null;
    } else if (movement.type === 'pay_in') {
      if (amount < 0) return null;
      payIn = addSafe(payIn, amount);
      if (payIn == null) return null;
    } else if (movement.type === 'pay_out') {
      if (amount > 0) return null;
      payOut = addSafe(payOut, Math.abs(amount));
      if (payOut == null) return null;
    } else if (movement.type === 'refund') {
      refunds = addSafe(refunds, Math.abs(amount));
      if (refunds == null) return null;
    }
  }
  const expected = addSafe(opening, signed);
  if (expected == null) return null;
  return {
    opening,
    sales,
    payIn,
    payOut,
    refunds,
    expected,
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

app.post('/api/staff/shifts/open', requireCapability('ops.view'), async (req, res) => {
  const branchId = parseBranchId(req) || defaultBranch()?.id || 1;
  const existing = activeStaffShift(req.user, branchId);
  if (existing) return res.json({ ok: true, idempotent: true, shift: existing });
  const snapshot = snapshotFinanceMutationState();
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
  try {
    await persistFinanceMutation(snapshot);
    res.status(201).json({ ok: true, shift });
  } catch (error) {
    return res.status(error.status || 503).json({ error: error.code || 'shift_persistence_failed' });
  }
});

app.post('/api/staff/shifts/close', requireCapability('ops.view'), async (req, res) => {
  const branchId = parseBranchId(req) || defaultBranch()?.id || 1;
  return withCashDrawerMutationLock(cashDrawerMutationQueueKey(req, branchId), async () => {
    const shift = activeStaffShift(req.user, branchId);
    if (!shift) return res.status(409).json({ error: 'shift_not_open' });
    if (activeCashSession(req.user, branchId)) return res.status(409).json({ error: 'cash_drawer_still_open' });
    const snapshot = snapshotFinanceMutationState();
    shift.closedAt = new Date().toISOString();
    recordAudit(req, 'shift.closed', 'shift', shift.id, {}, branchId);
    try {
      await persistFinanceMutation(snapshot);
      return res.json({ ok: true, shift });
    } catch (error) {
      return res.status(error.status || 503).json({ error: error.code || 'shift_persistence_failed' });
    }
  });
});

// Cash drawer inputs are whole Toman amounts. Reject malformed values instead
// of silently coercing them to zero, and keep retries tied to a durable key.
function parseCashDrawerAmount(value, { allowZero = false } = {}) {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value >= (allowZero ? 0 : 1) ? value : null;
  }
  const normalized = normalizeDigits(String(value ?? '').trim());
  if (!normalized || !/^(?:\d+|\d{1,3}(?:[,٬]\d{3})+)$/.test(normalized)) return null;
  const amount = Number(normalized.replace(/[٬,]/g, ''));
  return Number.isSafeInteger(amount) && amount >= (allowZero ? 0 : 1) ? amount : null;
}

function normalizeCashDrawerIdempotencyKey(headerValue, bodyValue) {
  const header = String(headerValue || '').trim();
  const body = String(bodyValue || '').trim();
  if (header && body && header !== body) return { error: 'cash_movement_idempotency_invalid' };
  const key = header || body;
  if (!key) return { error: 'cash_movement_idempotency_required' };
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$/.test(key)) return { error: 'cash_movement_idempotency_invalid' };
  return { key };
}

function cashDrawerMovementFingerprint({ tenantId, branchId, sessionId, phone, type, amount, note }) {
  const request = JSON.stringify({
    tenantId: String(tenantId || ''), branchId: Number(branchId), sessionId: String(sessionId),
    phone: String(phone || ''), type: String(type), amount: Number(amount), note: String(note || ''),
  });
  return crypto.createHash('sha256').update(request).digest('hex');
}

function cashDrawerOpenRetry(session, openingAmount) {
  if (!session) return { kind: 'new' };
  return Number.isSafeInteger(Number(session.openingAmount))
    && Number(session.openingAmount) === Number(openingAmount)
    ? { kind: 'duplicate', session }
    : { kind: 'conflict', session };
}

function findCashDrawerMovementRetry(session, key, fingerprint) {
  const movement = (Array.isArray(session?.movements) ? session.movements : [])
    .find((item) => item?.idempotencyKey === key);
  if (!movement) return { kind: 'new' };
  return movement.requestFingerprint === fingerprint
    ? { kind: 'duplicate', movement }
    : { kind: 'conflict', movement };
}

function cashDrawerPayOutExceedsAvailable(totals, amount) {
  return !Number.isSafeInteger(totals?.expected)
    || !Number.isSafeInteger(amount)
    || amount <= 0
    || amount > totals.expected;
}

const cashDrawerMutationQueues = new Map();
function cashDrawerMutationQueueKey(req, branchId) {
  const tenantId = String(req?.tenantId || '').trim();
  const branch = Number(branchId);
  const phone = String(req?.user?.phone || '').trim();
  if (!tenantId || !Number.isSafeInteger(branch) || branch <= 0 || !phone) {
    throw Object.assign(new Error('Cash drawer mutation identity is invalid.'), {
      code: 'cash_drawer_lock_identity_invalid', status: 409,
    });
  }
  return `${tenantId}:${branch}:${phone}`;
}

async function withCashDrawerMutationLock(key, task) {
  const previous = cashDrawerMutationQueues.get(key) || Promise.resolve();
  let release;
  const current = new Promise((resolve) => { release = resolve; });
  cashDrawerMutationQueues.set(key, current);
  await previous.catch(() => {});
  try {
    return await task();
  } finally {
    release();
    if (cashDrawerMutationQueues.get(key) === current) cashDrawerMutationQueues.delete(key);
  }
}

async function withCashDrawerSettlementLock(req, orderId, operation) {
  const tender = String(req?.body?.tender || 'cash');
  const order = (db.orders || []).find((item) => Number(item.id) === Number(orderId));
  const branchId = persistedOrderBranchId(order);
  if (!order || branchId == null || tender !== 'cash') return operation();
  return withCashDrawerMutationLock(cashDrawerMutationQueueKey(req, branchId), operation);
}

app.get('/api/cashier/drawer', requireCapability('cash.manage'), (req, res) => {
  const branchId = parseBranchId(req) || defaultBranch()?.id || 1;
  return withCashDrawerMutationLock(cashDrawerMutationQueueKey(req, branchId), async () => {
    const session = activeCashSession(req.user, branchId);
    const totals = session ? cashSessionTotals(session) : null;
    if (session && !totals) return res.status(409).json({ error: 'cash_drawer_ledger_invalid', message: 'سابقهٔ صندوق قابل جمع‌بندی نیست؛ پیش از ادامه آن را تطبیق دهید.' });
    return res.json({ session, totals });
  });
});

app.post('/api/cashier/drawer/open', requireCapability('cash.manage'), async (req, res) => {
  const branchId = parseBranchId(req) || defaultBranch()?.id || 1;
  const openingAmount = parseCashDrawerAmount(req.body?.openingAmount, { allowZero: true });
  if (openingAmount == null) return res.status(400).json({ error: 'cash_amount_invalid' });
  const queueKey = cashDrawerMutationQueueKey(req, branchId);
  return withCashDrawerMutationLock(queueKey, async () => {
    if (!activeStaffShift(req.user, branchId)) {
      return res.status(409).json({ error: 'staff_shift_not_open' });
    }
    const existing = activeCashSession(req.user, branchId);
    const retry = cashDrawerOpenRetry(existing, openingAmount);
    if (retry.kind === 'conflict') {
      return res.status(409).json({ error: 'cash_drawer_opening_conflict', session: retry.session });
    }
    if (retry.kind === 'duplicate') {
      const totals = cashSessionTotals(retry.session);
      if (!totals) return res.status(409).json({ error: 'cash_drawer_ledger_invalid' });
      return res.json({ ok: true, idempotent: true, session: retry.session, totals });
    }
    const snapshot = snapshotFinanceMutationState();
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
      return res.status(201).json({ ok: true, session, totals: cashSessionTotals(session) });
    } catch (error) {
      restoreFinanceMutationState(snapshot);
      return res.status(error.status || 503).json({ error: error.code || error.message });
    }
  });
});

app.post('/api/cashier/drawer/movements', requireCapability('cash.manage'), async (req, res) => {
  const branchId = parseBranchId(req) || defaultBranch()?.id || 1;
  const type = String(req.body?.type || '');
  if (!['pay_in', 'pay_out'].includes(type)) return res.status(400).json({ error: 'cash_movement_invalid' });
  const rawAmount = parseCashDrawerAmount(req.body?.amount);
  if (rawAmount == null) return res.status(400).json({ error: 'cash_movement_amount_invalid' });
  const idempotency = normalizeCashDrawerIdempotencyKey(req.get('Idempotency-Key'), req.body?.idempotencyKey);
  if (idempotency.error) return res.status(400).json({ error: idempotency.error });
  const note = String(req.body?.note || '').trim().slice(0, 160);
  const queueKey = cashDrawerMutationQueueKey(req, branchId);
  return withCashDrawerMutationLock(queueKey, async () => {
    const session = activeCashSession(req.user, branchId);
    if (!session) return res.status(409).json({ error: 'cash_drawer_not_open' });
    const currentTotals = cashSessionTotals(session);
    if (!currentTotals) return res.status(409).json({ error: 'cash_drawer_ledger_invalid', message: 'سابقهٔ صندوق معتبر نیست؛ تغییر جدید ثبت نشد.' });
    const amount = type === 'pay_out' ? -rawAmount : rawAmount;
    const requestFingerprint = cashDrawerMovementFingerprint({
      tenantId: req.tenantId, branchId, sessionId: session.id, phone: req.user.phone, type, amount, note,
    });
    const retry = findCashDrawerMovementRetry(session, idempotency.key, requestFingerprint);
    if (retry.kind === 'conflict') return res.status(409).json({ error: 'cash_movement_idempotency_conflict' });
    if (retry.kind === 'duplicate') {
      return res.json({
        ok: true, idempotent: true, movement: retry.movement, session, totals: currentTotals,
      });
    }

    if (type === 'pay_out' && cashDrawerPayOutExceedsAvailable(currentTotals, rawAmount)) {
      return res.status(409).json({
        error: 'cash_drawer_insufficient_funds',
        available: Math.max(0, currentTotals.expected),
        requested: rawAmount,
        message: 'مبلغ خروج از وجه نقد قابل‌برداشت صندوق بیشتر است؛ مبلغ را کاهش دهید یا ورود نقدی ثبت کنید.',
      });
    }

    const projectedTotals = cashSessionTotals({
      ...session,
      movements: [{ type, amount }, ...(Array.isArray(session.movements) ? session.movements : [])],
    });
    if (!projectedTotals) return res.status(409).json({ error: 'cash_drawer_ledger_invalid', message: 'جمع صندوق از محدودهٔ معتبر خارج می‌شود؛ تغییر ثبت نشد.' });

    const snapshot = snapshotFinanceMutationState();
    const movement = {
      id: nextId(session.movements), type, amount, note,
      idempotencyKey: idempotency.key, requestFingerprint,
      at: new Date().toISOString(), by: req.user.phone,
    };
    try {
      session.movements.unshift(movement);
      recordAudit(req, `cash_drawer.${type}`, 'cash_session', session.id, { amount: movement.amount, note: movement.note }, branchId);
      const financeResult = financeV2.captureCashMovement(db, session, movement, { actor: req.user.phone });
      if (financeResult?.event) {
        movement.financeEventId = financeResult.event.id;
        movement.financeStatus = financeResult.event.status;
        movement.financeErrorCode = financeResult.event.error?.code || null;
      }
      await persistFinanceMutation(snapshot);
      return res.status(201).json({ ok: true, movement, session, totals: cashSessionTotals(session), finance: financeResult });
    } catch (error) {
      restoreFinanceMutationState(snapshot);
      return res.status(error.status || 503).json({ error: error.code || error.message });
    }
  });
});

app.post('/api/cashier/drawer/close', requireCapability('cash.manage'), async (req, res) => {
  const branchId = parseBranchId(req) || defaultBranch()?.id || 1;
  const countedAmount = parseCashDrawerAmount(req.body?.countedAmount, { allowZero: true });
  if (countedAmount == null) return res.status(400).json({ error: 'cash_counted_amount_invalid' });
  const queueKey = cashDrawerMutationQueueKey(req, branchId);
  return withCashDrawerMutationLock(queueKey, async () => {
    const session = activeCashSession(req.user, branchId);
    const requestedSessionId = String(req.body?.sessionId || '').trim();
    if (session && requestedSessionId && String(session.id) !== requestedSessionId) {
      return res.status(409).json({ error: 'cash_drawer_session_changed' });
    }
    const closedSession = session || (requestedSessionId
      ? (db.cashSessions || []).find((item) => String(item.id) === requestedSessionId
        && String(item.phone) === String(req.user.phone)
        && Number(item.branchId) === Number(branchId)
        && item.closedAt)
      : null);
    if (!closedSession) return res.status(409).json({ error: 'cash_drawer_not_open' });
    const requestFingerprint = cashDrawerMovementFingerprint({
      tenantId: req.tenantId, branchId, sessionId: closedSession.id,
      phone: req.user.phone, type: 'close', amount: countedAmount, note: '',
    });
    if (closedSession.closeRequestFingerprint) {
      if (closedSession.closeRequestFingerprint !== requestFingerprint) {
        return res.status(409).json({ error: 'cash_drawer_close_idempotency_conflict' });
      }
      const closedTotals = cashSessionTotals(closedSession);
      if (!closedTotals) return res.status(409).json({ error: 'cash_drawer_ledger_invalid' });
      return res.json({
        ok: true, idempotent: true, session: closedSession,
        totals: { ...closedTotals, counted: closedSession.countedAmount, variance: closedSession.variance },
      });
    }
    if (!session) return res.status(409).json({ error: 'cash_drawer_not_open' });
    const totals = cashSessionTotals(session);
    if (!totals) return res.status(409).json({ error: 'cash_drawer_ledger_invalid', message: 'سابقهٔ صندوق معتبر نیست؛ بستن صندوق انجام نشد.' });
    const snapshot = snapshotFinanceMutationState();
    session.countedAmount = countedAmount;
    session.variance = session.countedAmount - totals.expected;
    session.closedAt = new Date().toISOString();
    session.closeRequestFingerprint = requestFingerprint;
    recordAudit(req, 'cash_drawer.closed', 'cash_session', session.id, { countedAmount: session.countedAmount, variance: session.variance }, branchId);
    try {
      const financeResult = financeV2.captureCashClose(db, session, { actor: req.user.phone });
      await persistFinanceMutation(snapshot);
      return res.json({ ok: true, session, totals: { ...totals, counted: session.countedAmount, variance: session.variance }, finance: financeResult });
    } catch (error) {
      restoreFinanceMutationState(snapshot);
      return res.status(error.status || 503).json({ error: error.code || error.message });
    }
  });
});

registerAdminV2Routes({
  app,
  getDb: () => db,
  save,
  requireCapability,
  requireAdmin,
  parseBranchId,
  requestBranchValue,
  effectiveRole,
  normalizeDigits,
  phoneRe: PHONE_RE,
  recordAudit,
  appendAudit: appendAuditAfterCommit,
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
  const identity = db.tenantIdentity || {};
  res.json({
    ok: true,
    tenant: publicTenantContext({
      ...TENANT_CONFIG,
      tenantId: req.tenantId || identity.tenantId || TENANT_CONFIG.tenantId,
      tenantSlug: req.tenantSlug || identity.tenantSlug || TENANT_CONFIG.tenantSlug,
      displayName: identity.displayName || db.restaurant?.name || TENANT_CONFIG.displayName,
      canonicalDomain: identity.canonicalDomain || TENANT_CONFIG.canonicalDomain,
    }),
  });
});

// SALSA remains a separate operations application so its React runtime and
// finance database can never interfere with the public 3D menu runtime.
const handleIntegrationStatus = (req, res) => {
  res.json({ ok: true, integration: salsaBridge.status() });
};
const handleIntegrationRetry = (req, res) => {
  salsaBridge.retry();
  res.json({ ok: true, integration: salsaBridge.status() });
};
const handleIntegrationBackfill = (req, res) => {
  const queued = salsaBridge.queueBackfill();
  res.json({ ok: true, queued, integration: salsaBridge.status() });
};

app.use((req, res, next) => {
  if (req.url && req.url.startsWith('/api/admin/salsa-integration')) {
    req.url = req.url.replace('/api/admin/salsa-integration', '/api/admin/neem-integration');
  }
  next();
});

app.get('/api/admin/neem-integration', requireCapability('admin.access'), handleIntegrationStatus);
app.post('/api/admin/neem-integration/retry', requireCapability('admin.access'), handleIntegrationRetry);
app.post('/api/admin/neem-integration/backfill', requireCapability('admin.access'), handleIntegrationBackfill);

// Dynamic Feature Control from SALSA God Mode & Health Check
app.use((req, res, next) => {
  if (req.path === '/api/ready' && ['GET', 'HEAD'].includes(req.method)) {
    void (async () => {
      const databasePing = await stateStore.ping();
      const readiness = runtimeReadiness({
        nodeEnv: process.env.NODE_ENV,
        postgresEnabled: stateStore.enabled,
        postgresRequired: stateStore.required,
        databasePing,
        financeStatus: stateStore.financeStatus(),
        settlementGate: settlementPersistenceGate.check({
          postgresEnabled: stateStore.enabled,
          postgresRequired: stateStore.required,
        }),
      });
      return res.status(readiness.ok ? 200 : 503).json({
        ...readiness,
        app: 'WESTO',
        version: '1.2.0',
        timestamp: new Date().toISOString(),
      });
    })().catch(next);
    return;
  }

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
      database: stateStore.enabled ? 'postgresql-configured' : 'memory-fallback',
      timestamp: new Date().toISOString()
    });
  }

  const applyAdminCors = () => {
    const origin = String(req.headers.origin || '');
    if (origin && (origin.includes(':3050') || origin.includes(':3061') || origin.includes('localhost') || origin.includes('127.0.0.1'))) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Request-Id, Authorization, X-Salsa-Control-Secret, X-Neem-Control-Secret, X-Tenant-Id, X-Tenant-Slug');
    }
  };

  if (req.path === '/api/admin/live-summary' && req.method === 'OPTIONS') {
    applyAdminCors();
    return res.sendStatus(204);
  }

  if (req.path === '/api/admin/live-summary' && req.method === 'GET') {
    applyAdminCors();
    const hasBridgeCredential = hasControlPlaneBridgeCredential(req);
    if (!hasBridgeCredential && !isTrustedLocalControlPlaneOrigin(req)) {
      return res.status(401).json({ ok: false, error: 'control_plane_bridge_required' });
    }
    const requestTenant = normalizeTenantId(req.tenantContext?.tenantId || req.tenantSlug || TENANT_CONFIG.tenantId);
    const targetTenant = normalizeTenantId(req.query.tenantId || requestTenant);
    if (!targetTenant) return res.status(400).json({ ok: false, error: 'tenant_id_invalid' });
    if (targetTenant !== requestTenant && !hasBridgeCredential && !isTrustedLocalControlPlaneOrigin(req)) {
      return res.status(403).json({ ok: false, error: 'tenant_scope_denied' });
    }
    const targetDb = tenantRegistry.getTenantDb(targetTenant);
    if (!targetDb) {
      return res.status(404).json({ ok: false, error: 'tenant_not_registered' });
    }
    const orders = Array.isArray(targetDb.orders) ? targetDb.orders : [];
    const totalRevenue = orders.reduce((sum, o) => sum + Number(o.total || 0), 0);
    const users = (Array.isArray(targetDb.users) ? targetDb.users : []).map(u => ({
      id: u.id,
      name: u.name || 'پرسنل مجموعه',
      phone: u.phone || '',
      role: u.role || 'staff',
      active: u.active !== false
    }));
    return res.json({
      ok: true,
      tenantId: targetTenant,
      name: targetDb.restaurant?.name || 'کافه رستوران وستو',
      status: 'active',
      menuItemsCount: (targetDb.menuItems || []).length,
      categoriesCount: (targetDb.menuCategories || []).length,
      ordersCount: orders.length,
      tablesCount: (targetDb.tables || []).length,
      branchesCount: (targetDb.branches || []).length || 1,
      usersCount: users.length,
      users,
      totalRevenue,
      devicesCount: 4,
      features: targetDb.featureEntitlements || {},
      printers: targetDb.settings?.printers || [],
      lastBackup: new Date().toISOString(),
      timestamp: new Date().toISOString()
    });
  }

  if ((req.path === '/api/admin/features' || req.path === '/api/features' || req.path === '/api/admin/features/current') && req.method === 'GET') {
    applyAdminCors();
    const hasBridgeCredential = hasControlPlaneBridgeCredential(req);
    const localControlPlane = isTrustedLocalControlPlaneOrigin(req);
    const requestTenant = normalizeTenantId(req.tenantContext?.tenantId || req.tenantSlug || TENANT_CONFIG.tenantId);
    const targetTenant = normalizeTenantId(req.query.tenantId || requestTenant);
    if (!targetTenant) return res.status(400).json({ ok: false, error: 'tenant_id_invalid' });
    if (targetTenant !== requestTenant && !hasBridgeCredential && !localControlPlane) {
      return res.status(403).json({ ok: false, error: 'tenant_scope_denied' });
    }
    const targetDb = tenantRegistry.getTenantDb(targetTenant);
    if (!targetDb) return res.status(404).json({ ok: false, error: 'tenant_not_registered' });
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
    const hasBridgeCredential = hasControlPlaneBridgeCredential(req);
    const localControlPlane = isTrustedLocalControlPlaneOrigin(req);
    if (!hasBridgeCredential && !localControlPlane) {
      return res.status(401).json({
        ok: false,
        error: 'control_plane_bridge_required',
        message: 'تغییر قابلیت‌ها فقط از مسیر احراز‌شدهٔ کنترل پلتفرم انجام می‌شود.'
      });
    }

    const { featureKey, featureKeys, enabled, tenantId } = req.body || {};
    const requestedKeys = Array.isArray(featureKeys) && featureKeys.length
      ? [...new Set(featureKeys)]
      : (featureKey ? [featureKey] : []);
    if (!requestedKeys.length) {
      return res.status(400).json({ ok: false, error: 'featureKey_required' });
    }
    if (requestedKeys.length > CANONICAL_FEATURES.length || requestedKeys.some(key => typeof key !== 'string')) {
      return res.status(400).json({ ok: false, error: 'invalid_feature_keys' });
    }
    const canonicalKeys = new Set(CANONICAL_FEATURES.map(feature => feature.key));
    const unknownKeys = requestedKeys.filter(key => !canonicalKeys.has(key));
    if (unknownKeys.length) {
      return res.status(422).json({ ok: false, error: 'unknown_feature_keys', featureKeys: unknownKeys });
    }

    const requestTenant = normalizeTenantId(req.tenantContext?.tenantId || req.tenantSlug || TENANT_CONFIG.tenantId);
    const targetTenant = normalizeTenantId(tenantId || requestTenant);
    if (!targetTenant) return res.status(400).json({ ok: false, error: 'tenant_id_invalid' });
    if (targetTenant !== requestTenant && !hasBridgeCredential && !localControlPlane) {
      return res.status(403).json({ ok: false, error: 'tenant_scope_denied' });
    }
    const persistenceError = legacyTenantPersistenceError({ tenantId: targetTenant });
    if (persistenceError) {
      return res.status(persistenceError.status).json({ ok: false, error: persistenceError.code, message: persistenceError.message });
    }
    const targetDb = tenantRegistry.getTenantDb(targetTenant);
    if (!targetDb) {
      return res.status(404).json({ ok: false, error: 'tenant_not_registered' });
    }
    if (!targetDb.featureEntitlements) targetDb.featureEntitlements = {};
    const updatedAt = new Date().toISOString();
    for (const key of requestedKeys) {
      targetDb.featureEntitlements[key] = {
        active: Boolean(enabled),
        status: enabled ? 'active' : 'disabled',
        updatedAt
      };
    }
    tenantRegistry.saveTenantDb(targetTenant);

    return res.json({
      ok: true,
      tenantId: targetTenant,
      featureKey: requestedKeys[0],
      featureKeys: requestedKeys,
      enabled: Boolean(enabled),
      updatedAt,
      message: `${requestedKeys.length} قابلیت برای مستأجر ${targetTenant} به وضعیت ${enabled ? 'فعال' : 'غیرفعال'} تغییر یافت.`
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
    const hasBridgeCredential = hasControlPlaneBridgeCredential(req);
    const localControlPlane = isTrustedLocalControlPlaneOrigin(req);
    if (!hasBridgeCredential && !localControlPlane) {
      return res.status(401).json({
        ok: false,
        error: 'control_plane_bridge_required',
        message: 'ایجاد tenant فقط از مسیر احراز‌شدهٔ کنترل پلتفرم انجام می‌شود.'
      });
    }

    const input = req.body || {};
    const tenantId = normalizeTenantId(input.tenantId);
    const { name, brandName, domain, enabledFeatures } = input;
    if (!tenantId) {
      return res.status(400).json({ ok: false, error: 'tenantId_required' });
    }

    const persistenceError = legacyTenantPersistenceError({ tenantId });
    if (persistenceError) {
      return res.status(persistenceError.status).json({ ok: false, error: persistenceError.code, message: persistenceError.message });
    }

    const cleanDb = tenantRegistry.createTenant(tenantId, {
      name: name || brandName || tenantId,
      brandName: brandName || name || tenantId,
      domain: domain || `${tenantId}.salsa.ir`,
      enabledFeatures: Array.isArray(enabledFeatures) ? enabledFeatures : ['core.workspace', 'catalog.menu']
    });

    return res.status(201).json({
      ok: true,
      tenantId,
      name: cleanDb.settings?.restaurantName,
      domain: `${tenantId}.salsa.ir`,
      message: `مستأجر خام «${tenantId}» با موفقیت ایجاد شد و آماده پیکربندی از مرکز فرماندهی SALSA است.`
    });
  }

  if (req.path === '/api/admin/tenants' && req.method === 'GET') {
    applyAdminCors();
    if (!hasControlPlaneBridgeCredential(req) && !isTrustedLocalControlPlaneOrigin(req)) {
      return res.status(401).json({ ok: false, error: 'control_plane_bridge_required' });
    }
    const list = tenantRegistry.listTenants();
    return res.json({
      ok: true,
      tenants: list
    });
  }

  next();
});

app.get('/ops', requireCapability('admin.access'), (req, res) => {
  const target = process.env.SALSA_OPS_URL || process.env.NEEM_OPS_URL || 'http://127.0.0.1:3050/#overview';
  res.redirect(302, target);
});

// Deep links keep the relevant SALSA workspace reachable from the matching
// WESTO admin section while the two runtimes remain isolated.
const SALSA_OPERATION_VIEWS = new Set([
  'tables', 'customers', 'marketing', 'reservations', 'waiter-panel',
  'fin-overview', 'fin-sales', 'fin-cash-drawers', 'fin-settlements',
  'fin-journal', 'fin-gl', 'fin-coa', 'fin-trial-balance', 'fin-reports',
  'fin-period-close', 'fin-command-center', 'fin-expenses', 'fin-bank-feed',
  'fin-three-way-match', 'fin-tax-matrix',
]);
const NEEM_OPERATION_VIEWS = SALSA_OPERATION_VIEWS;

app.get('/ops/:view', requireCapability('admin.access'), (req, res) => {
  const view = String(req.params.view || '');
  if (!SALSA_OPERATION_VIEWS.has(view)) return res.status(404).json({ error: 'unknown_salsa_view' });
  const base = (process.env.SALSA_OPS_URL || process.env.NEEM_OPS_URL || 'http://127.0.0.1:3050').replace(/\/?(?:#.*)?$/, '');
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

  const demoOtp = isOtpDemoMode(process.env);
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

  // [TEMPORARILY DISABLED] platform-admin login restriction
  // if (PLATFORM_ONLY_PHONE_IDENTITIES.has(phone)
  //     || (Array.isArray(db.users) && db.users.some((candidate) =>
  //       normalizeDigits(String(candidate.phone || '')).trim() === phone && candidate.principalType === 'platform_admin'))) {
  //   return res.status(403).json({ error: 'separate_platform_account_required', message: 'حساب راهبر پلتفرم با حساب مالک رستوران جداست.' });
  // }

  if (!Array.isArray(db.users)) db.users = [];
  if (!db.settings) db.settings = { adminPhones: [] };
  if (!Array.isArray(db.settings.adminPhones)) db.settings.adminPhones = [];
  if (!Array.isArray(db.loginLog)) db.loginLog = [];

  let user = db.users.find((u) => u.phone === phone);
  const isAdmin = Array.isArray(db.settings.adminPhones) && db.settings.adminPhones.includes(phone);
  if (!user) {
    user = {
      phone,
      name: '',
      email: '',
      role: isAdmin ? 'owner' : 'user',
      points: 0,
      createdAt: new Date().toISOString(),
      blocked: false,
    };
    db.users.push(user);
    if (db.loyalty && db.loyalty.welcomePoints) {
      awardLoyaltyPoints(phone, db.loyalty.welcomePoints, 'welcome');
    }
  }
  // [DEV] Sync role with adminPhones on every login
  if (isAdmin && user.role !== 'owner') user.role = 'owner';
  user.lastLoginAt = new Date().toISOString();
  db.loginLog.unshift({ phone, at: user.lastLoginAt });
  db.loginLog = db.loginLog.slice(0, 200);
  save();
  const secureCookie = req.secure || String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
  const token = makeToken(phone, req.tenantId || req.tenant?.tenantId || req.tenant?.tenantSlug);
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
// Keep the catalogue response self-contained so every consumer (public menu,
// admin editor, waiter and cashier) sees the same explicitly configured
// choices. Missing configuration means no modifiers; it must never synthesize
// saleable options or prices from product names.
function menuItemForResponse(item) {
  return {
    ...item,
    modifierGroups: effectiveModifierGroupsForItem(item),
  };
}

function publicGuestMenuPayload(query = {}) {
  let items = db.menuItems;
  const requestedBranch = query.branchId || query.branch;
  const branch = requestedBranch ? resolveBranchExact(requestedBranch) : defaultBranch();
  const branchId = branch?.id || null;
  if (branchId) items = items.filter((item) => menuItemBelongsToBranch(item, branchId));
  if (!query.all) {
    items = items.filter((m) => {
      if (!menuItemAvailableForBranch(db, m, branchId) || !itemVisibleNow(m)) return false;
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
    menuItems: items.map((item) => ({
      ...menuItemForResponse(item),
      available: menuItemAvailableForBranch(db, item, branchId),
    })),
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
app.get('/api/menu', async (req, res) => {
  try {
    const requestedBranch = req.query?.branchId || req.query?.branch;
    if (requestedBranch && !resolveBranchExact(requestedBranch)) {
      return res.status(400).json({ error: 'branch_invalid', message: 'شعبهٔ انتخاب‌شده معتبر نیست.' });
    }
    if (tenantConnectionManager?.baseUrl && req.tenantDataAccess && req.tenantContext?.databaseProvider === 'postgres') {
      const pgItems = await tenantMenuRepository.listMenuItems(req.tenantDataAccess);
      db.menuItems = pgItems;
      const pgCategories = await tenantMenuRepository.listCategories(req.tenantDataAccess);
      if (pgCategories.length > 0) {
        db.menuCategories = pgCategories;
      }
    }
    res.json(publicGuestMenuPayload(req.query || {}));
  } catch (err) {
    console.error('[Menu GET Error]', err);
    res.status(500).json({ ok: false, error: 'menu_retrieval_failed', message: 'دریافت منو موقتاً با مشکل روبه‌رو شد.' });
  }
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
      resp.available = menuItemAvailableForBranch(db, item, branchId);
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
app.post('/api/menu/categories', requireAdmin, async (req, res) => {
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
  if (tenantConnectionManager?.baseUrl && req.tenantDataAccess && req.tenantContext?.databaseProvider === 'postgres') {
    try {
      await tenantMenuRepository.createCategory(req.tenantDataAccess, cat);
    } catch (err) {
      console.warn?.('[Tenant Category Persist Warning]', err.message);
    }
  }
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

app.put('/api/menu/:id', requireAdmin, async (req, res) => {
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
  const hasModifierGroupInput = Object.prototype.hasOwnProperty.call(req.body || {}, 'modifierGroups');
  let validatedModifierGroups = null;
  if (hasModifierGroupInput) {
    if (!Array.isArray(req.body.modifierGroups)) {
      return res.status(400).json({
        error: 'modifier_groups_invalid',
        message: 'فهرست گزینه‌های کالا باید به‌صورت آرایه ارسال شود.',
      });
    }
    const validation = validateModifierGroupDefinitions(req.body.modifierGroups);
    if (!validation.ok) {
      return res.status(400).json({
        error: 'modifier_configuration_invalid',
        message: 'تنظیم گزینه‌های این کالا معتبر نیست؛ گروه‌ها و قیمت گزینه‌ها را بررسی کنید.',
        details: validation.errors,
      });
    }
    validatedModifierGroups = validation.groups;
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
  if (hasModifierGroupInput) item.modifierGroups = validatedModifierGroups;
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
  if (Array.isArray(req.body.dietary)) {
    item.dietary = req.body.dietary.map((t) => String(t || '').trim()).filter(Boolean).slice(0, 10);
  }
  const rawPrep = parseNum(req.body.prepTime ?? req.body.prepTimeMinutes);
  if (rawPrep != null && rawPrep >= 0) {
    item.prepTime = Math.round(rawPrep);
  }
  item.updatedAt = Date.now();
  if (tenantConnectionManager?.baseUrl && req.tenantDataAccess && req.tenantContext?.databaseProvider === 'postgres') {
    try {
      await tenantMenuRepository.updateMenuItem(req.tenantDataAccess, targetId, item);
    } catch (err) {
      console.error('[Tenant Menu Update Error]', err);
      return res.status(500).json({ ok: false, error: 'menu_persist_failed', message: err.message });
    }
  }
  save({ rebuildProducts: true });
  res.json({ ok: true, item: menuItemForResponse(item) });
});

app.patch('/api/menu/:id', requireAdmin, async (req, res) => {
  const targetId = Number(normalizeDigits(String(req.params.id || '')).replace(/\D/g, ''));
  const item = (db.menuItems || []).find((m) => Number(m.id) === targetId);
  if (!item) return res.status(404).json({ error: 'not found' });
  const parseNum = (v) => {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return isNaN(v) ? null : v;
    const n = Number(normalizeDigits(String(v)).replace(/[,٬_\s]/g, '').trim());
    return isNaN(n) ? null : n;
  };
  if (typeof req.body.name === 'string') item.name = req.body.name.trim().slice(0, 120);
  if (typeof req.body.desc === 'string') item.desc = req.body.desc.trim().slice(0, 500);
  const rawPrice = parseNum(req.body.price);
  if (rawPrice != null && rawPrice >= 0) item.price = Math.round(rawPrice);
  if (typeof req.body.available === 'boolean') item.available = req.body.available;
  if (Array.isArray(req.body.allergens)) item.allergens = normalizeAllergens(req.body.allergens);
  if (Array.isArray(req.body.dietary)) item.dietary = req.body.dietary.map((t) => String(t || '').trim()).filter(Boolean).slice(0, 10);
  const rawPrep = parseNum(req.body.prepTime ?? req.body.prepTimeMinutes);
  if (rawPrep != null && rawPrep >= 0) item.prepTime = Math.round(rawPrep);
  if (req.body.stock === null || req.body.stock === '') item.stock = null;
  else {
    const rawStock = parseNum(req.body.stock);
    if (rawStock != null && rawStock >= 0) {
      item.stock = Math.round(rawStock);
      if (item.stock === 0) item.available = false;
    }
  }
  item.updatedAt = Date.now();
  save({ rebuildProducts: true });
  res.json({ ok: true, item: menuItemForResponse(item) });
});

app.post('/api/admin/menu/bulk-adjust-prices', requireAdmin, (req, res) => {
  const categoryId = req.body.categoryId != null && req.body.categoryId !== '' ? Number(req.body.categoryId) : null;
  const percentChange = Number(req.body.percentChange) || 0;
  const roundToNearest = Math.max(100, Number(req.body.roundToNearest) || 1000);
  if (!percentChange || Math.abs(percentChange) > 100) {
    return res.status(400).json({ error: 'درصد تغییر نامعتبر است (باید بین -۱۰۰ تا ۱۰۰ باشد)' });
  }
  const factor = 1 + (percentChange / 100);
  const itemsToUpdate = (db.menuItems || []).filter((m) => categoryId == null || Number(m.categoryId) === categoryId);
  const changes = [];
  itemsToUpdate.forEach((m) => {
    const oldPrice = m.price || 0;
    const newPrice = Math.max(0, Math.round((oldPrice * factor) / roundToNearest) * roundToNearest);
    m.price = newPrice;
    m.updatedAt = Date.now();
    changes.push({ id: m.id, name: m.name, oldPrice, newPrice });
  });
  save({ rebuildProducts: true });
  res.json({ ok: true, updatedCount: changes.length, changes });
});

app.post('/api/admin/menu/bulk-undo-prices', requireAdmin, (req, res) => {
  const changes = Array.isArray(req.body.changes) ? req.body.changes : [];
  if (!changes.length) return res.status(400).json({ error: 'لیست تغییرات برای بازگردانی خالی است' });
  let restored = 0;
  changes.forEach((c) => {
    const item = (db.menuItems || []).find((m) => Number(m.id) === Number(c.id));
    if (item && c.oldPrice != null) {
      item.price = Math.max(0, Math.round(Number(c.oldPrice)));
      item.updatedAt = Date.now();
      restored++;
    }
  });
  save({ rebuildProducts: true });
  res.json({ ok: true, restoredCount: restored });
});

app.post('/api/menu', requireAdmin, async (req, res) => {
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
    prepTime: parseNum(req.body.prepTime ?? req.body.prepTimeMinutes) ?? 15,
    dietary: Array.isArray(req.body.dietary) ? req.body.dietary.map((t) => String(t || '').trim()).filter(Boolean).slice(0, 10) : [],
  };
  const hasModifierGroupInput = Object.prototype.hasOwnProperty.call(req.body || {}, 'modifierGroups');
  if (hasModifierGroupInput && !Array.isArray(req.body.modifierGroups)) {
    return res.status(400).json({
      error: 'modifier_groups_invalid',
      message: 'فهرست گزینه‌های کالا باید به‌صورت آرایه ارسال شود.',
    });
  }
  const modifierGroupsInput = hasModifierGroupInput ? req.body.modifierGroups : [];
  const modifierGroupValidation = validateModifierGroupDefinitions(modifierGroupsInput);
  if (!modifierGroupValidation.ok) {
    return res.status(400).json({
      error: 'modifier_configuration_invalid',
      message: 'تنظیم گزینه‌های این کالا معتبر نیست؛ گروه‌ها و قیمت گزینه‌ها را بررسی کنید.',
      details: modifierGroupValidation.errors,
    });
  }
  item.modifierGroups = modifierGroupValidation.groups;
  if (imgRaw) item.img = imgRaw;
  if (!item.name) return res.status(400).json({ error: 'نام را وارد کنید' });
  if (tenantConnectionManager?.baseUrl && req.tenantDataAccess && req.tenantContext?.databaseProvider === 'postgres') {
    try {
      const persisted = await tenantMenuRepository.createMenuItem(req.tenantDataAccess, item);
      if (persisted?.id != null) {
        item.id = persisted.id;
      }
    } catch (err) {
      console.error('[Tenant Menu Save Error]', err);
      return res.status(500).json({ ok: false, error: 'menu_persist_failed', message: err.message });
    }
  }
  db.menuItems.push(item);
  save({ rebuildProducts: true });
  res.json({ ok: true, item: menuItemForResponse(item) });
});
app.delete('/api/menu/:id', requireAdmin, async (req, res) => {
  const targetId = Number(normalizeDigits(String(req.params.id || '')).replace(/\D/g, ''));
  if (tenantConnectionManager?.baseUrl && req.tenantDataAccess && req.tenantContext?.databaseProvider === 'postgres') {
    try {
      await tenantMenuRepository.deleteMenuItem(req.tenantDataAccess, targetId);
    } catch (err) {
      console.error('[Tenant Menu Delete Error]', err);
      return res.status(500).json({ ok: false, error: 'menu_delete_failed', message: err.message });
    }
  }
  db.menuItems = (db.menuItems || []).filter((m) => Number(m.id) !== targetId);
  save({ rebuildProducts: true });
  res.json({ ok: true });
});

// --- orders ---
function parseOrderTomanAmount(value) {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0 ? value : null;
  if (typeof value !== 'string') return null;
  const normalized = normalizeDigits(value).replace(/[,_\s٬]/gu, '').trim();
  if (!/^\d+$/u.test(normalized)) return null;
  const amount = Number(normalized);
  return Number.isSafeInteger(amount) && amount >= 0 ? amount : null;
}

function orderLinesFromRequest(rawItems, {
  allowMenuItemIds = new Set(), allowComplementIds = new Set(), branchId = null,
  excludeInventoryReservationOrderId = null,
} = {}) {
  if (!Array.isArray(rawItems) || !rawItems.length) {
    return { error: 'order_items_required', code: 'order_items_required', status: 400 };
  }
  const items = rawItems;
  const lines = [];
  let subtotal = 0;
  const requestedMenuQty = new Map();
  const requestedComplementQty = new Map();
  for (let lineIndex = 0; lineIndex < items.length; lineIndex += 1) {
    const line = items[lineIndex];
    const lineShape = validateOrderLineInput(line, lineIndex);
    if (!lineShape.ok) {
      return {
        error: lineShape.error,
        code: lineShape.error,
        status: 400,
        message: 'تعداد، گزینه‌ها یا اطلاعات یکی از اقلام سفارش معتبر نیست؛ سبد را بازبینی کنید.',
        index: lineShape.index,
      };
    }
    const menuItemId = Number(line.menuItemId || line.id);
    const menuItem = db.menuItems.find((item) => item.id === menuItemId
      && (menuItemAvailableForBranch(db, item, branchId) || allowMenuItemIds.has(menuItemId)));
    if (!menuItem || !menuItemBelongsToBranch(menuItem, branchId)
        || (!allowMenuItemIds.has(menuItemId) && !itemVisibleNow(menuItem))) {
      return { error: 'item_unavailable', message: 'یکی از اقلام سفارش دیگر در دسترس نیست؛ سبد را بازبینی کنید.' };
    }
    const qty = Math.min(99, Math.max(1, Math.round(Number(line.qty || line.count) || 1)));
    const accumulatedMenuQty = (requestedMenuQty.get(menuItemId) || 0) + qty;
    const v2Availability = branchId
      ? financeV2.menuItemAvailability(db, menuItem.id, branchId, accumulatedMenuQty, undefined, {
        excludeOrderId: excludeInventoryReservationOrderId,
      })
      : null;
    if (v2Availability?.tracked) {
      if (!v2Availability.available) {
        const shortage = v2Availability.issues?.find((issue) => issue.code === 'inventory_shortage');
        return { error: shortage?.itemName ? `مواد لازم برای «${menuItem.name}» کافی نیست (ماده: ${shortage.itemName})` : `موجودی مواد لازم برای «${menuItem.name}» کافی نیست` };
      }
    } else if (typeof menuItem.stock === 'number' && menuItem.stock < accumulatedMenuQty) {
      return { error: `موجودی «${menuItem.name}» کافی نیست (باقی‌مانده: ${menuItem.stock})` };
    }
    requestedMenuQty.set(menuItemId, accumulatedMenuQty);
    const rawModifierGroups = Array.isArray(menuItem.modifierGroups) ? menuItem.modifierGroups : [];
    const modifierGroupValidation = validateModifierGroupDefinitions(rawModifierGroups);
    if (!modifierGroupValidation.ok) {
      return {
        error: 'modifier_configuration_invalid',
        code: 'modifier_configuration_invalid',
        status: 409,
        message: `گزینه‌های «${menuItem.name}» نیازمند بازبینی مدیریت منو هستند.`,
        details: modifierGroupValidation.errors,
      };
    }
    const priceResult = calculateModifierLinePrice(
      menuItem.price,
      qty,
      modifierGroupValidation.groups,
      line.modifiers,
    );
    if (!priceResult.ok) {
      return {
        error: 'modifier_selection_invalid',
        code: 'modifier_selection_invalid',
        status: 400,
        message: 'گزینه‌های انتخاب‌شده معتبر نیستند یا یک انتخاب اجباری جا افتاده است؛ سبد را بازبینی کنید.',
        details: priceResult.errors || [{ code: priceResult.error }],
      };
    }
    const price = priceResult.basePrice;
    const modifiers = priceResult.modifiers;
    const unitTotal = priceResult.unitPrice;
    const allowedComplementIds = new Set(complementRulesForMenuItem(menuItem).flatMap((rule) => rule.complementIds || []).map(Number));
    const complementQuantities = new Map();
    for (const entry of (Array.isArray(line.complements) ? line.complements : [])) {
      const complementId = Number(entry?.complementId ?? entry?.id);
      if (!allowedComplementIds.has(complementId) && !allowComplementIds.has(complementId)) {
        return {
          error: 'complement_selection_invalid',
          code: 'complement_selection_invalid',
          status: 400,
          message: 'یکی از افزودنی‌های انتخاب‌شده برای این کالا معتبر نیست.',
          index: lineIndex,
        };
      }
      const complementQty = Number(entry.qty);
      complementQuantities.set(complementId, (complementQuantities.get(complementId) || 0) + complementQty);
    }
    const complements = [];
    for (const [complementId, complementQty] of complementQuantities) {
      const complement = (db.menuComplements || []).find((entry) => Number(entry.id) === complementId
        && (allowComplementIds.has(complementId)
          || (entry.available !== false && (entry.stock == null || Number(entry.stock) > 0))));
      if (!complement) {
        return {
          error: 'complement_unavailable',
          code: 'complement_unavailable',
          status: 409,
          message: 'یکی از افزودنی‌های انتخاب‌شده دیگر در دسترس نیست؛ سبد را بازبینی کنید.',
          index: lineIndex,
        };
      }
      const accumulatedComplementQty = (requestedComplementQty.get(complementId) || 0) + complementQty;
      if (typeof complement.stock === 'number' && complement.stock < accumulatedComplementQty) {
        return { error: `موجودی مکمل «${complement.name}» کافی نیست (باقی‌مانده: ${complement.stock})` };
      }
      requestedComplementQty.set(complementId, accumulatedComplementQty);
      const complementPrice = Math.max(0, Number(complement.price) || 0);
      complements.push({ id: complement.id, name: complement.name, price: complementPrice, qty: complementQty, img: complement.img || '', lineTotal: complementPrice * complementQty });
    }
    const complementTotal = complements.reduce((sum, complement) => sum + complement.lineTotal, 0);
    const lineTotal = priceResult.lineTotal + complementTotal;
    if (!Number.isSafeInteger(complementTotal) || !Number.isSafeInteger(lineTotal) || !Number.isSafeInteger(subtotal + lineTotal)) {
      return { error: 'order_amount_unsafe', code: 'order_amount_unsafe', status: 400, message: 'مبلغ سفارش از محدودهٔ مجاز بیشتر است.' };
    }
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
      ...(typeof (menuItem.taxCategory || menuItem.taxCode) === 'string' && String(menuItem.taxCategory || menuItem.taxCode).trim()
        ? { taxCategory: String(menuItem.taxCategory || menuItem.taxCode).trim() }
        : {}),
      modifiers,
      complements,
      note: String(line.note || '').trim().slice(0, 180),
      seat: Math.min(99, Math.max(0, Math.round(Number(line.seat) || 0))),
      course,
      courseStatus,
      firedAt,
      unitTotal,
      lineTotal,
    });
    subtotal += lineTotal;
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
  const status = String(order.status || '');
  const paymentStatus = paymentStatusFor(order);
  const serviceComplete = ['done', 'picked_up', 'delivered'].includes(status);
  const paymentNeedsAttention = ['unpaid', 'partial', 'pending', 'failed', 'unknown'].includes(paymentStatus);
  return fulfillment === 'dine_in'
    && tableNoBelongsToTable(order.tableNo, tableNo)
    && status !== 'cancelled'
    && (!serviceComplete || paymentNeedsAttention);
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
  const requestedBranch = input.branchId || input.branch;
  const selected = requestedBranch ? resolveBranchExact(requestedBranch) : defaultBranch();
  if (requestedBranch && !selected) return null;
  if (fulfillment !== 'dine_in') return selected || defaultBranch();
  const cleanTable = normalizeDigits(String(tableNo || '')).trim();
  const tableKey = canonicalTableNo(cleanTable);
  const matchingTables = (db.tables || []).filter((item) => item.active !== false
    && (canonicalTableNo(item.id) === tableKey || canonicalTableNo(item.label) === tableKey));
  const scopedTables = selected
    ? matchingTables.filter((item) => Number(item.branchId) === Number(selected.id))
    : matchingTables;
  if (scopedTables.length !== 1) return null;
  const table = scopedTables[0];
  const tableBranch = (db.branches || []).find((branch) => branch.active !== false && Number(branch.id) === Number(table.branchId));
  if (!tableBranch || (selected && Number(selected.id) !== Number(tableBranch.id))) return null;
  return tableBranch;
}

function validateExplicitCheckoutSelections(input) {
  if (Object.hasOwn(input || {}, 'fulfillment')) {
    const fulfillment = typeof input.fulfillment === 'string' ? input.fulfillment.trim() : '';
    if (!FULFILLMENTS.includes(fulfillment)) {
      return { error: 'fulfillment_invalid', code: 'fulfillment_invalid', status: 400, message: 'روش دریافت انتخاب‌شده معتبر نیست.' };
    }
  }
  if (Object.hasOwn(input || {}, 'paymentMethod')) {
    const paymentMethod = typeof input.paymentMethod === 'string' ? input.paymentMethod.trim() : '';
    if (!['cashier', 'online'].includes(paymentMethod)) {
      return { error: 'payment_method_invalid', code: 'payment_method_invalid', status: 400, message: 'روش پرداخت انتخاب‌شده معتبر نیست.' };
    }
  }
  return null;
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
  if (status === 'dispatched') order.dispatchedAt = order.statusAt;
  if (order.fulfillment === 'delivery' && ['dispatched', 'delivered', 'cancelled'].includes(status)) {
    order.delivery = order.delivery && typeof order.delivery === 'object' ? order.delivery : {};
    order.delivery.dispatchStatus = status;
    if (status === 'dispatched') order.delivery.dispatchedAt = order.delivery.dispatchedAt || order.statusAt;
    if (status === 'delivered') {
      order.delivery.dispatchedAt = order.delivery.dispatchedAt || order.dispatchedAt || order.statusAt;
      order.delivery.deliveredAt = order.delivery.deliveredAt || order.statusAt;
    }
  }
  if (['done', 'picked_up', 'delivered'].includes(status)) order.doneAt = order.statusAt;
}

function reverseCancelledOrderFinancialEffects(order, user) {
  const reason = `لغو سفارش #${order.orderNo || order.id}`;
  const actor = user?.phone || 'admin';
  const orderFinanceEvents = (db.financeV2?.events || []).filter((event) =>
    ['order.paid', 'order.cogs'].includes(event.source)
    && String(event.sourceId) === String(order.id));
  if (orderFinanceEvents.some((event) => Number(event.branchId) !== Number(order.branchId))) {
    throw Object.assign(new Error('شعبهٔ رویداد مالی با شعبهٔ سفارش هم‌خوان نیست؛ لغو بدون تطبیق مالی ثبت نشد.'), {
      code: 'order_finance_branch_mismatch',
      status: 409,
    });
  }
  const salesReversal = accountingEngine.reverseOrderSalesJournal(db, order.id, {
    reason,
    userId: actor,
  });
  const paidEvent = (db.financeV2?.events || []).find((event) => event.source === 'order.paid'
    && String(event.sourceId) === String(order.id)
    && event.journalEntryId);
  const financeSalesReversal = paidEvent
    ? financeV2.reverseEntry(db, paidEvent.journalEntryId, actor, reason)
    : null;
  const cogsReversal = financeV2.reverseOrderCogsAndInventory(db, order.id, actor, reason);
  const unreversedCogsJournal = (db.financeV2?.events || [])
    .filter((event) => event.source === 'order.cogs'
      && String(event.sourceId) === String(order.id)
      && event.journalEntryId)
    .map((event) => (db.financeV2?.journalEntries || []).find((entry) => entry.id === event.journalEntryId))
    .find((entry) => entry?.status === 'posted' && !entry.reversedById);
  if (unreversedCogsJournal) {
    throw Object.assign(new Error('سند بهای تمام‌شدهٔ سفارش معکوس نشد؛ لغو سفارش ثبت نشد.'), {
      code: 'order_cogs_reversal_incomplete',
      status: 409,
    });
  }
  return { salesReversal, financeSalesReversal, cogsReversal };
}

function checkoutIdempotencyFingerprint(input, actor = null) {
  const canonical = (value) => {
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
    if (value && typeof value === 'object') {
      return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
  };
  const scopedRequest = {
    actor: actor ? { phone: String(actor.phone || ''), role: effectiveRole(actor) } : null,
    input,
  };
  return crypto.createHash('sha256').update(canonical(scopedRequest)).digest('hex');
}

function checkoutQuoteIntent({ input, branch, fulfillment, lines, subtotal, deliveryFee, discount, total, phone = input.phone, taxSnapshot = null }) {
  const tenantId = normalizeTenantId(
    tenantStorage.getStore()?.tenantId || db.tenantIdentity?.tenantId || TENANT_CONFIG.tenantId || 'westo',
  );
  const quoteLines = (lines || []).map((line) => ({
    menuItemId: Number(line.menuItemId),
    name: String(line.name || ''),
    price: Number(line.price) || 0,
    qty: Number(line.qty) || 0,
    modifiers: (line.modifiers || []).map((item) => ({ id: item.id, groupId: item.groupId, name: item.name, price: Number(item.price) || 0 })),
    complements: (line.complements || []).map((item) => ({ id: item.id, name: item.name, price: Number(item.price) || 0, qty: Number(item.qty) || 0 })),
    note: String(line.note || ''),
    seat: Number(line.seat) || 0,
    course: String(line.course || 'starters'),
    courseStatus: String(line.courseStatus || 'fired'),
  }));
  return {
    tenantId,
    branchId: Number(branch.id),
    fulfillment,
    tableNo: canonicalTableNo(input.tableNo || input.table),
    zoneId: Number(input.deliveryZoneId || input.zoneId) || null,
    phone: normalizeDigits(phone || '').trim(),
    paymentMethod: input.paymentMethod === 'online' ? 'online' : 'cashier',
    items: quoteLines,
    subtotal: Number(subtotal) || 0,
    deliveryFee: Number(deliveryFee) || 0,
    discount: Number(discount) || 0,
    total: Number(total) || 0,
    taxSnapshot,
  };
}

function calculateCheckoutPricing({ input, actor, subtotal, deliveryFee }) {
  const actorIsCustomer = effectiveRole(actor) === 'user';
  const phone = normalizeDigits(input.phone || (actorIsCustomer ? actor?.phone : '') || '').trim();
  const requestedManualDiscount = input.discount === undefined ? 0 : parseOrderTomanAmount(input.discount);
  if (requestedManualDiscount === null) {
    return { error: 'discount_invalid', code: 'discount_invalid', status: 400, message: 'مبلغ تخفیف باید عدد صحیح و معتبر باشد.' };
  }
  if (requestedManualDiscount > 0 && !userCan(actor, 'orders.manage')) {
    return { error: 'discount_not_allowed', status: 403, message: 'اعمال تخفیف دستی فقط برای نقش مجاز امکان‌پذیر است.' };
  }
  if (requestedManualDiscount > subtotal) {
    return { error: 'discount_exceeds_subtotal', code: 'discount_exceeds_subtotal', status: 400, message: 'تخفیف نمی‌تواند از جمع اقلام بیشتر باشد.' };
  }

  const actorPhone = normalizeDigits(actor?.phone || '').trim();
  const customerUser = actorIsCustomer && phone && actorPhone === phone
    ? (db.users || []).find((user) => normalizeDigits(user.phone || '').trim() === phone)
    : null;
  const discountCalc = customerUser
    ? loyaltyEngine.calculateOrderDiscounts(db, {
        subtotalToman: subtotal,
        phone,
        user: customerUser,
        redeemPoints: 0,
      })
    : {
        customerPhone: null,
        customerName: null,
        availablePoints: 0,
        tier: { id: 'none', name: 'بدون عضویت', discountPct: 0, multiplier: 1 },
        tierDiscountToman: 0,
        tierDiscountPct: 0,
        redeemValue: Math.max(0, Math.round(Number(db?.loyalty?.redeemValue) || 1000)),
        maxRedeemablePoints: 0,
        pointsRedeemed: 0,
        pointsDiscountToman: 0,
        totalDiscountToman: 0,
        finalPayable: subtotal,
      };
  const manualDiscount = userCan(actor, 'orders.manage') ? requestedManualDiscount : 0;
  const loyaltyDiscount = parseOrderTomanAmount(discountCalc.totalDiscountToman);
  if (loyaltyDiscount === null || loyaltyDiscount > subtotal) {
    return { error: 'loyalty_discount_invalid', code: 'loyalty_discount_invalid', status: 409, message: 'تخفیف وفاداری معتبر نیست؛ سفارش ثبت نشد.' };
  }
  const discount = Math.max(loyaltyDiscount, manualDiscount);
  const total = subtotal + deliveryFee - discount;
  if (!Number.isSafeInteger(total) || total < 0) {
    return { error: 'order_amount_unsafe', code: 'order_amount_unsafe', status: 400, message: 'مبلغ سفارش از محدودهٔ مجاز بیشتر است.' };
  }
  return { phone, customerUser, discountCalc, discount, total };
}

function checkoutTaxForOrder({ branch, fulfillment, lines, discount, deliveryFee, total, date }) {
  try {
    const snapshot = buildCheckoutTaxSnapshot({
      taxSettings: db.accounting?.taxSettings,
      branchId: branch?.id,
      fulfillment,
      lines,
      discountToman: discount,
      deliveryFeeToman: deliveryFee,
      date,
    });
    const expectedPayableIrr = Number(total) * 10;
    if (!Number.isSafeInteger(expectedPayableIrr) || snapshot.totalPayableIrr !== expectedPayableIrr) {
      return {
        error: 'checkout_tax_payable_mismatch',
        code: 'checkout_tax_payable_mismatch',
        status: 409,
        message: 'جمع پیش‌فاکتور با snapshot مالیاتی شعبه یکسان نیست؛ سفارش ثبت نشد.',
      };
    }
    return { snapshot };
  } catch (error) {
    return {
      error: error.code || 'checkout_tax_snapshot_unavailable',
      code: error.code || 'checkout_tax_snapshot_unavailable',
      status: error.status || 409,
      message: error.message || 'ثبت سفارش متوقف شد؛ تصویر مالیاتی معتبر برای شعبه در دسترس نیست.',
    };
  }
}

async function createCheckoutOrder(input, { requireTable = false, requirePhone = true, requireQuote = false, requireName = false, idempotencyKey = '', actor = null } = {}) {
  const tableNo = normalizeDigits(String(input.tableNo || input.table || '')).trim().slice(0, 20);
  const selectionError = validateExplicitCheckoutSelections(input);
  if (selectionError) return selectionError;
  const fulfillment = normalizeFulfillment(input.fulfillment, { tableNo });
  const phone = normalizeDigits(input.phone || (effectiveRole(actor) === 'user' ? actor?.phone : '') || '').trim();
  const name = String(input.name || '').trim().slice(0, 100);
  const paymentMethod = String(input.paymentMethod || 'cashier').trim() === 'online' ? 'online' : 'cashier';
  const normalizedKey = String(idempotencyKey || '').trim();
  if (process.env.NODE_ENV === 'production' && !normalizedKey) {
    return { error: 'idempotency_key_required', code: 'idempotency_key_required', status: 400, message: 'برای ثبت سفارش، کلید یکتای درخواست لازم است.' };
  }
  if (requireName && !name) {
    return { error: 'name_required', code: 'name_required', status: 400, message: 'نام گیرنده را وارد کنید.' };
  }
  if (normalizedKey && !ORDER_IDEMPOTENCY_KEY_RE.test(normalizedKey)) {
    return { error: 'idempotency_key_invalid', code: 'idempotency_key_invalid', status: 400 };
  }

  if ((requireTable || fulfillment === 'dine_in') && !tableNo) return { error: 'شماره میز را وارد کنید' };
  if ((requirePhone || phone) && !PHONE_RE.test(phone)) return { error: 'شماره موبایل معتبر نیست' };
  if (!Array.isArray(input.items) || !input.items.length) return { error: 'سبد سفارش خالی است' };

  const branch = findOrderBranch(input, tableNo, fulfillment);
  if (!branch || branch.active === false) return { error: 'شعبه پیدا نشد' };
  if (actor && effectiveRole(actor) !== 'user') {
    try {
      assertUserBranchAccess(actor, branch.id);
    } catch (error) {
      return { error: error.code || 'branch_access_denied', status: error.status || 403, message: error.message };
    }
  }

  const fingerprintInput = {
    ...input,
    branchId: Number(branch.id),
    fulfillment,
    tableNo: canonicalTableNo(tableNo),
    paymentMethod,
    phone,
  };
  delete fingerprintInput.quoteToken;
  const requestFingerprint = normalizedKey ? checkoutIdempotencyFingerprint(fingerprintInput, actor) : null;
  if (normalizedKey && Object.hasOwn(db.checkoutIdempotency || {}, normalizedKey)) {
    const saved = db.checkoutIdempotency[normalizedKey];
    if (!saved || typeof saved !== 'object' || Array.isArray(saved) || typeof saved.requestFingerprint !== 'string') {
      return { error: 'idempotency_replay_unavailable', code: 'idempotency_replay_unavailable', status: 409, message: 'اطلاعات بازیابی سفارش قبلی کامل نیست؛ برای سفارش تازه کلید جدید بسازید.' };
    }
    if (saved.requestFingerprint !== requestFingerprint) {
      return { error: 'idempotency_key_conflict', code: 'idempotency_key_conflict', status: 409, message: 'این کلید قبلاً برای درخواست دیگری استفاده شده است؛ برای سفارش تازه دوباره تلاش کنید.' };
    }
    const order = (db.orders || []).find((item) => Number(item.id) === Number(saved.orderId));
    if (!order) {
      return { error: 'idempotency_replay_unavailable', code: 'idempotency_replay_unavailable', status: 409, message: 'سفارش قبلی این درخواست دیگر در دسترس نیست؛ برای ثبت سفارش تازه، کلید جدید بسازید.' };
    }
    if (persistedOrderBranchId(order) !== Number(branch.id)) {
      return { error: 'idempotency_replay_unavailable', code: 'idempotency_replay_unavailable', status: 409, message: 'شعبهٔ سفارش قبلی با درخواست بازیابی هم‌خوان نیست.' };
    }
    const payment = saved.paymentAttemptId == null
      ? (order.paymentMethod === 'online' ? (db.paymentAttempts || []).find((item) => Number(item.orderId) === Number(order.id)) : null)
      : (db.paymentAttempts || []).find((item) => Number(item.id) === Number(saved.paymentAttemptId));
    const paymentMatchesOrder = payment
      && Number(payment.orderId) === Number(order.id)
      && Number(payment.branchId) === Number(order.branchId)
      && Number.isSafeInteger(Number(payment.amount))
      && Number.isSafeInteger(Number(order.total))
      && Number(payment.amount) === Number(order.total);
    if ((saved.paymentAttemptId != null && (!payment
        || !paymentMatchesOrder))
      || (order.paymentMethod === 'online' && !paymentMatchesOrder)
      || (order.paymentMethod !== 'online' && payment)) {
      return { error: 'idempotency_replay_unavailable', code: 'idempotency_replay_unavailable', status: 409, message: 'وضعیت پرداخت سفارش قبلی برای بازیابی امن کامل نیست.' };
    }
    if (actor && effectiveRole(actor) !== 'user') {
      try {
        assertUserBranchAccess(actor, order.branchId);
      } catch (error) {
        return { error: error.code || 'branch_access_denied', status: error.status || 403, message: error.message };
      }
    }
    return { order, payment, idempotent: true, whatsapp: null };
  }

  if (paymentMethod === 'online' && !productionPaymentProviderReady()) {
    return { error: 'payment_provider_not_ready', code: 'payment_provider_not_ready', status: 503 };
  }
  const lineResult = orderLinesFromRequest(input.items, { branchId: branch.id });
  if (lineResult.error) return lineResult;
  if (actor && effectiveRole(actor) !== 'user') {
    const addValidation = validateWaiterOrderAdd(input.items, {
      canonicalLines: lineResult.lines,
      sendToKitchen: input.sendToKitchen === true,
    });
    if (!addValidation.ok) {
      const message = addValidation.error === 'course_already_served'
        ? 'سفارش تازه نمی‌تواند قلمی با وضعیت «تحویل‌شده» داشته باشد.'
        : addValidation.error === 'kitchen_course_empty'
          ? 'برای ارسال سفارش، دست‌کم یک دوره باید برای آشپزخانه آماده باشد.'
          : 'اقلام سفارش با ساختار یا قیمت معتبر منو سازگار نیستند.';
      return {
        error: addValidation.error,
        code: addValidation.error,
        status: 400,
        message,
        ...(addValidation.index === undefined ? {} : { index: addValidation.index }),
      };
    }
  }
  const dineInCovers = fulfillment === 'dine_in'
    ? (input.covers === undefined ? 1 : Number(normalizeDigits(String(input.covers)).replace(/[^0-9]/g, '')))
    : null;
  if (fulfillment === 'dine_in') {
  const coverValidation = validateCoversForItems(dineInCovers, lineResult.lines);
    if (!coverValidation.ok) {
      return {
        error: coverValidation.error,
        code: coverValidation.error,
        status: 400,
        message: coverValidation.error === 'seat_exceeds_covers'
          ? 'تعداد مهمان نمی‌تواند از شمارهٔ صندلی تخصیص‌یافته کمتر باشد.'
          : 'تعداد مهمان باید بین ۱ تا ۹۹ نفر باشد.',
      };
    }
  }
  if (input.sendToKitchen === true && !lineResult.lines.some((line) => line.courseStatus === 'fired')) {
    return { error: 'kitchen_course_empty', code: 'kitchen_course_empty', status: 400, message: 'برای ارسال سفارش، دست‌کم یک مرحله باید به آشپزخانه فرستاده شود.' };
  }
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
  const deliveryFee = parseOrderTomanAmount(fulfillmentQuote.deliveryFee);
  if (deliveryFee === null) {
    return { error: 'delivery_fee_invalid', code: 'delivery_fee_invalid', status: 409, message: 'هزینهٔ ارسال معتبر نیست؛ تنظیم محدودهٔ ارسال را بررسی کنید.' };
  }
  const deliveryAddress = String(input.deliveryAddress || input.address || '').trim().slice(0, 300);
  if (fulfillment === 'delivery' && !deliveryAddress) return { error: 'آدرس تحویل را وارد کنید' };

  const pricing = calculateCheckoutPricing({ input: { ...input, phone }, actor, subtotal: lineResult.subtotal, deliveryFee });
  if (pricing.error) return pricing;
  const { customerUser, discountCalc } = pricing;
  const orderDiscount = pricing.discount;
  const orderTotal = pricing.total;
  const createdAt = new Date().toISOString();
  const checkoutTax = checkoutTaxForOrder({
    branch,
    fulfillment,
    lines: lineResult.lines,
    discount: orderDiscount,
    deliveryFee,
    total: orderTotal,
    date: createdAt,
  });
  if (checkoutTax.error) return checkoutTax;
  if (requireQuote) {
    const quoteIntent = checkoutQuoteIntent({
      input: { ...input, tableNo, fulfillment, paymentMethod }, branch, fulfillment, lines: lineResult.lines, subtotal: lineResult.subtotal,
      deliveryFee, discount: orderDiscount, total: orderTotal, phone, taxSnapshot: checkoutTax.snapshot,
    });
    const verification = verifyCheckoutQuoteToken(input.quoteToken, SECRET, quoteIntent);
    if (!verification.valid) {
      return {
        error: verification.reason === 'missing_or_malformed' ? 'checkout_quote_required' : 'checkout_quote_stale',
        code: verification.reason === 'missing_or_malformed' ? 'checkout_quote_required' : 'checkout_quote_stale',
        status: 409,
        message: 'قیمت یا موجودی سفارش تغییر کرده است؛ مبلغ تازه را بررسی و دوباره ثبت کنید.',
      };
    }
  }

  const inventoryReservationSnapshot = financeV2.buildOrderInventoryReservationSnapshot(
    db, lineResult.lines, branch.id, createdAt,
  );
  if (!inventoryReservationSnapshot.ok) {
    return {
      error: 'inventory_reservation_unavailable',
      code: 'inventory_reservation_unavailable',
      status: 409,
      message: 'رزرو مواد اولیه برای این سفارش قابل ثبت نیست؛ موجودی و دستور تهیه را بررسی کنید.',
      details: inventoryReservationSnapshot.issues,
    };
  }

  // Deduct stock only after validating the current server-side quote.
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
  const checkNo = fulfillment === 'dine_in'
    ? nextDineInCheckNo(branch.id, tableNo, input.checkNo || tableNo)
    : '';

  const order = {
    id: nextId(db.orders),
    orderNo: `W-${String(Date.now()).slice(-6)}-${nextId(db.orders)}`,
    tableNo: fulfillment === 'dine_in' ? tableNo : '',
    checkNo,
    phone,
    name,
    branchId: branch.id,
    fulfillment,
    ...(fulfillment === 'dine_in' ? { covers: dineInCovers } : {}),
    paymentMethod,
    paymentStatus: paymentMethod === 'online' ? 'pending' : 'unpaid',
    status: initialOrderStatus({ paymentMethod, fulfillment }),
    items: lineResult.lines,
    taxSnapshot: { ...checkoutTax.snapshot, capturedAt: createdAt },
    inventoryReservationSnapshot,
    subtotal: lineResult.subtotal,
    discount: orderDiscount,
    tierDiscountToman: discountCalc.tierDiscountToman,
    pointsRedeemed: discountCalc.pointsRedeemed,
    pointsDiscountToman: discountCalc.pointsDiscountToman,
    loyaltyTier: discountCalc.tier?.id || 'bronze',
    deliveryFee,
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
  db.orders = retainOperationalOrders(db.orders);

  let payment = null;
  if (paymentMethod === 'online') {
    db.paymentAttempts = Array.isArray(db.paymentAttempts) ? db.paymentAttempts : [];
    payment = {
      id: nextId(db.paymentAttempts),
      orderId: order.id,
      branchId: branch.id,
      tender: 'online',
      provider: 'sandbox',
      mode: 'sandbox',
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
    db.checkoutIdempotency[normalizedKey] = { orderId: order.id, paymentAttemptId: payment?.id || null, createdAt, requestFingerprint };
    // Do not evict replay records by count: a delayed retry after eviction
    // could otherwise create a second order. Production storage must move
    // this index to a durable table with explicit retention and expired-key handling.
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
  const idempotencyKey = String(options.idempotencyKey || '').trim();
  if (!idempotencyKey) return createAndPersistCheckoutOrderOnce(input, options, afterCreate);
  const tenantId = tenantStorage.getStore()?.tenantId
    || options.actor?.tenantId
    || db.tenantIdentity?.tenantId
    || TENANT_CONFIG.tenantId
    || 'westo';
  return serializeCheckoutOrderMutation(tenantId, idempotencyKey,
    () => createAndPersistCheckoutOrderOnce(input, options, afterCreate));
}

async function createAndPersistCheckoutOrderOnce(input, options = {}, afterCreate = null) {
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
  // never leave a live event, SALSA outbox row, or notification for a missing
  // order in the durable store.
  if (!result.idempotent) {
    try {
      publishOperationalEvent('order.created', { orderId: result.order.id, branchId: result.order.branchId, status: result.order.status });
      salsaBridge.enqueueOrder(result.order, result.payment);
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
  status = String(status || '').trim().toLowerCase();
  const order = (db.orders || []).find((item) => Number(item.id) === Number(payment.orderId));
  if (!order) return { error: 'payment_order_not_found', status: 409 };
  const paymentBranchId = Number(payment.branchId);
  const orderBranchId = Number(order.branchId);
  if (!Number.isSafeInteger(paymentBranchId) || paymentBranchId <= 0
    || !Number.isSafeInteger(orderBranchId) || orderBranchId <= 0
    || paymentBranchId !== orderBranchId) {
    return { error: 'payment_order_branch_mismatch', status: 409 };
  }
  const transition = paymentAttemptTransition(payment.status, status);
  if (!transition.ok) return { error: transition.error, status: 409 };
  const alreadyPaid = payment.status === 'paid' && status === 'paid';
  if (alreadyPaid && reference && String(reference).trim() !== String(payment.reference || '').trim()) {
    return { error: 'payment_reference_conflict', status: 409 };
  }
  if (transition.idempotent && !alreadyPaid) {
    const existingOrder = (db.orders || []).find((item) => Number(item.id) === Number(payment.orderId));
    return { payment, order: existingOrder || null, finance: null, idempotent: true };
  }
  if (!alreadyPaid) {
    payment.status = status;
    payment.reference = String(reference || payment.reference || '').trim().slice(0, 160);
    payment.updatedAt = new Date().toISOString();
  }
  let financeResult = null;
  if (order) {
    if (status === 'paid') {
      financeResult = financeV2.captureOnlinePaidOrder(db, order, payment, { actor: `gateway:${payment.provider || source}`, occurredAt: payment.updatedAt });
      const financeState = db.financeV2 || {};
      const expectedSourceId = `${String(order.id)}:${String(payment.id)}`;
      const expectedAmountIrr = Number(payment.amount) * 10;
      const receiptEvent = (financeState.events || []).find((event) => event.id === payment.financeReceiptEventId);
      const receiptJournal = (financeState.journalEntries || []).find((entry) => entry.id === payment.financeReceiptJournalEntryId);
      const financePayment = (financeState.payments || []).find((row) => row.id === payment.financePaymentId);
      const matchingReceiptEvents = (financeState.events || []).filter((event) => event.source === 'order.payment_received'
        && String(event.sourceId) === expectedSourceId);
      const matchingReceiptJournals = (financeState.journalEntries || []).filter((entry) => entry.source === 'order.payment_received'
        && String(entry.sourceId) === expectedSourceId);
      const receiptPosted = Boolean(receiptEvent && receiptJournal && financePayment
        && matchingReceiptEvents.length === 1 && matchingReceiptJournals.length === 1
        && receiptEvent.source === 'order.payment_received'
        && String(receiptEvent.sourceId) === expectedSourceId
        && String(receiptEvent.payload?.paymentId) === String(payment.id)
        && receiptEvent.payload?.tender === 'online'
        && Number(receiptEvent.branchId) === orderBranchId
        && Number(receiptEvent.amountIrr) === expectedAmountIrr
        && receiptEvent.status === 'posted'
        && receiptEvent.journalEntryId === receiptJournal.id
        && receiptJournal.sourceEventId === receiptEvent.id
        && receiptJournal.source === 'order.payment_received'
        && String(receiptJournal.sourceId) === expectedSourceId
        && Number(receiptJournal.branchId) === orderBranchId
        && receiptJournal.status === 'posted'
        && String(financePayment.orderId) === String(order.id)
        && Number(financePayment.branchId) === orderBranchId
        && financePayment.tender === 'online'
        && Number(financePayment.amountIrr) === expectedAmountIrr
        && financePayment.status === 'succeeded'
        && String(financePayment.payload?.operationalPaymentId) === String(payment.id)
        && financePayment.receiptFinanceEventId === receiptEvent.id
        && financePayment.receiptJournalEntryId === receiptJournal.id);
      if (!receiptPosted) {
        throw Object.assign(new Error('پرداخت تأیید نشد چون رسید مستقل آن در دفتر مالی ثبت نشد.'), {
          code: receiptEvent?.error?.code || 'online_payment_receipt_finance_blocked', status: 409,
        });
      }
      // Partial captures are PSP-clearing receipts against customer deposits.
      // Recognize the sale only after all accepted captures cover the order.
      if (order.paymentStatus === 'paid' && (!financeResult?.journalEntry || financeResult.journalEntry.status !== 'posted')) {
        const captureCode = financeResult?.event?.error?.code || financeResult?.reason || 'finance_capture_blocked';
        throw Object.assign(new Error('پرداخت تأیید نشد چون سند فروش در دفتر مالی ثبت نشد.'), {
          code: captureCode,
          status: 409,
          details: financeResult?.event?.error || null,
        });
      }
      if (!['partial', 'paid'].includes(String(order.paymentStatus))) {
        throw Object.assign(new Error('وضعیت تجمیعی پرداخت پس از capture معتبر نیست.'), {
          code: 'online_payment_projection_invalid', status: 409,
        });
      }
      if (order.paymentStatus === 'paid') {
        const nextStatus = nextOrderStatusAfterPayment(order);
        if (nextStatus && canTransitionOrder(order, nextStatus)) {
          appendOrderStatus(order, nextStatus, null, { paymentAttemptId: payment.id, source });
        }
      }
    } else if (!['paid', 'partial'].includes(String(order.paymentStatus))) {
      // A failed/pending attempt must not erase successful partial captures.
      order.paymentStatus = orderPaymentStatusForAttempt(status) || 'unknown';
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
  const requestedBranch = req.query.branchId || req.query.branch;
  const branch = requestedBranch ? resolveBranchExact(requestedBranch) : defaultBranch();
  if (requestedBranch && !branch) return res.status(400).json({ error: 'branch_invalid', message: 'شعبهٔ انتخاب‌شده معتبر نیست.' });
  const paymentProvider = paymentProviderPublicStatus(db.paymentProvider, {
    nodeEnv: process.env.NODE_ENV,
    providerReady: productionPaymentProviderReady(),
  });
  res.json({
    payment: {
      mode: paymentProvider.mode,
      provider: paymentProvider.provider,
      onlineEnabled: paymentProvider.enabled,
    },
    branches: (db.branches || []).filter((item) => item.active !== false).map((item) => ({ id: item.id, slug: item.slug, name: item.name, address: item.address })),
    deliveryZones: (db.deliveryZones || [])
      .filter((item) => item.active !== false && (!branch || Number(item.branchId) === Number(branch.id)))
      .sort((a, b) => Number(a.sort || 0) - Number(b.sort || 0))
      .map((item) => ({ id: item.id, branchId: item.branchId, name: item.name, minOrder: item.minOrder, fee: item.fee, etaMinutes: item.etaMinutes })),
  });
});

app.post('/api/checkout/quote', (req, res) => {
  const input = req.body || {};
  const selectionError = validateExplicitCheckoutSelections(input);
  if (selectionError) return res.status(selectionError.status).json(selectionError);
  const tableNo = normalizeDigits(String(input.tableNo || input.table || '')).trim().slice(0, 20);
  const fulfillment = normalizeFulfillment(input.fulfillment, { tableNo });
  const branch = findOrderBranch(input, tableNo, fulfillment);
  if (!branch || branch.active === false) return res.status(400).json({ error: 'table_or_branch_invalid', message: 'میز فعال و شعبهٔ معتبر را انتخاب کنید.' });
  const zone = fulfillment === 'delivery'
    ? (db.deliveryZones || []).find((item) => Number(item.id) === Number(input.deliveryZoneId || input.zoneId))
    : null;
  const lineResult = orderLinesFromRequest(input.items, { branchId: branch.id });
  if (lineResult.error) return res.status(400).json(lineResult);
  const quote = quoteFulfillment({ fulfillment, subtotal: lineResult.subtotal, zone, branchId: branch?.id });
  if (!quote.ok) return res.status(400).json(quote);

  const paymentMethod = String(input.paymentMethod || 'cashier').trim() === 'online' ? 'online' : 'cashier';
  if (paymentMethod === 'online' && !productionPaymentProviderReady()) {
    return res.status(503).json({ error: 'payment_provider_not_ready', message: 'پرداخت آنلاین اکنون در دسترس نیست؛ روش پرداخت دیگری انتخاب کنید.' });
  }
  const pricing = calculateCheckoutPricing({
    input,
    actor: req.user,
    subtotal: lineResult.subtotal,
    deliveryFee: quote.deliveryFee,
  });
  if (pricing.error) return res.status(pricing.status || 400).json(pricing);

  const finalTotal = pricing.total;
  const checkoutTax = checkoutTaxForOrder({
    branch,
    fulfillment,
    lines: lineResult.lines,
    discount: pricing.discount,
    deliveryFee: quote.deliveryFee,
    total: finalTotal,
    date: new Date(),
  });
  if (checkoutTax.error) return res.status(checkoutTax.status || 409).json(checkoutTax);
  const quoteInput = { ...input, tableNo, fulfillment, paymentMethod, phone: pricing.phone };
  const quoteIntent = checkoutQuoteIntent({
    input: quoteInput, branch, fulfillment, lines: lineResult.lines,
    subtotal: lineResult.subtotal, deliveryFee: quote.deliveryFee,
    discount: pricing.discount, total: finalTotal, phone: pricing.phone, taxSnapshot: checkoutTax.snapshot,
  });

  res.json({
    ok: true,
    quoteToken: createCheckoutQuoteToken(SECRET, quoteIntent),
    fulfillment,
    subtotal: lineResult.subtotal,
    deliveryFee: quote.deliveryFee,
    discount: pricing.discount,
    tierDiscountToman: pricing.discountCalc.tierDiscountToman,
    tier: pricing.discountCalc.tier,
    pointsRedeemed: pricing.discountCalc.pointsRedeemed,
    pointsDiscountToman: pricing.discountCalc.pointsDiscountToman,
    maxRedeemablePoints: pricing.discountCalc.maxRedeemablePoints,
    availablePoints: pricing.discountCalc.availablePoints,
    total: finalTotal,
    tax: { inclusive: true, totalTaxIrr: checkoutTax.snapshot.totalTaxIrr },
    minimum: quote.minimum,
    etaMinutes: quote.etaMinutes,
    zone: quote.zone,
    branchId: branch?.id || null,
  });
});

app.post('/api/checkout/orders', publicOrderMutationGuard('orders.online'), async (req, res) => {
  try {
    const rawReceiptCode = req.get('Idempotency-Key') || req.body?.idempotencyKey;
    const receiptCode = normalizeCheckoutReceiptCode(rawReceiptCode);
    if (!receiptCode) {
      return res.status(400).json({ error: 'receipt_code_invalid', message: 'کد پیگیری سفارش معتبر نیست.' });
    }
    const result = await createAndPersistCheckoutOrder(req.body || {}, {
      requireQuote: true,
      requireName: true,
      idempotencyKey: checkoutReceiptIndexKey(receiptCode),
      actor: req.user || null,
    });
    if (result.error) return res.status(result.status || 400).json(result);
    res.status(result.idempotent ? 200 : 201).json({
      ok: true,
      idempotent: !!result.idempotent,
      order: publicCheckoutOrderView(result.order),
      payment: result.payment
        ? { ...publicPaymentAttempt(result.payment), sandboxToken: result.payment.mode === 'sandbox' ? result.payment.sandboxToken : undefined }
        : null,
      whatsapp: null,
    });
  } catch (error) {
    return res.status(error.status || 503).json({ error: error.code || error.message });
  }
});

app.post('/api/checkout/recovery', guardPublicCheckoutRecovery, (req, res) => {
  const receiptCode = normalizeCheckoutReceiptCode(req.body?.receiptCode);
  if (!receiptCode) return res.status(400).json({ error: 'receipt_code_invalid' });
  const indexKey = checkoutReceiptIndexKey(receiptCode);
  const saved = indexKey ? db.checkoutIdempotency?.[indexKey] : null;
  const order = saved && (db.orders || []).find((item) => Number(item.id) === Number(saved.orderId));
  if (!order) return res.status(404).json({ error: 'receipt_not_found' });
  const projection = publicCheckoutOrderView(order);
  if (!projection) return res.status(404).json({ error: 'receipt_not_found' });
  return res.json({ ok: true, order: projection });
});

app.post('/api/checkout/payments/:id/sandbox-confirm', sandboxPaymentGuard, serializePaymentOrderMutationRoute(async (req, res) => {
  const targetId = Number(normalizeDigits(String(req.params.id || '')).replace(/\D/g, ''));
  const payment = (db.paymentAttempts || []).find((item) => Number(item.id) === targetId);
  if (!payment) return res.status(404).json({ error: 'payment_not_found' });
  if (payment.mode !== 'sandbox') return res.status(409).json({ error: 'sandbox_disabled' });
  if (!req.body?.token || req.body.token !== payment.sandboxToken) return res.status(403).json({ error: 'payment_token_invalid' });
  const status = typeof req.body?.status === 'string' ? req.body.status.trim().toLowerCase() : '';
  if (!status) return res.status(400).json({ error: 'payment_status_required' });
  if (!['paid', 'failed', 'cancelled', 'unknown', 'reconciliation_required'].includes(status)) {
    return res.status(400).json({ error: 'payment_status_invalid' });
  }
  const snapshot = snapshotFinanceMutationState();
  let result;
  try {
    result = settlePaymentAttempt(payment, { status, reference: `sandbox-${payment.id}`, source: 'sandbox-confirm' });
    if (result.error) return res.status(result.status || 400).json(result);
    await persistFinanceMutation(snapshot);
  } catch (error) {
    restoreFinanceMutationState(snapshot);
    return res.status(error.status || 503).json({ error: error.code || error.message });
  }
  try { publishPaymentCommitEffects(result, status); } catch (error) { console.error('[payment-post-commit] integration effect failed', error?.message || error); }
  res.json({ ok: true, idempotent: result.idempotent, payment: publicPaymentAttempt(result.payment), order: publicCheckoutOrderView(result.order) });
}));

app.post('/api/payments/webhook/:provider', serializePaymentOrderMutationRoute(async (req, res) => {
  const payment = (db.paymentAttempts || []).find((item) => Number(item.id) === Number(req.body?.paymentAttemptId));
  if (!payment || payment.provider !== String(req.params.provider || '')) return res.status(404).json({ error: 'payment_not_found' });
  // No production gateway adapter or provider-specific raw-body verifier is
  // installed yet. Never let a configured shared secret or a sandbox token
  // turn this placeholder endpoint into a production payment authority.
  if (process.env.NODE_ENV === 'production') {
    return res.status(503).json({ error: 'payment_webhook_provider_unavailable' });
  }
  if (payment.mode !== 'sandbox' || payment.provider !== 'sandbox') {
    return res.status(503).json({ error: 'payment_webhook_provider_unavailable' });
  }
  if (!req.body?.token || req.body.token !== payment.sandboxToken) {
    return res.status(401).json({ error: 'webhook_unauthorized' });
  }
  const status = typeof req.body?.status === 'string' ? req.body.status.trim().toLowerCase() : '';
  if (!status) return res.status(400).json({ error: 'payment_status_required' });
  if (!['paid', 'failed', 'cancelled', 'unknown', 'reconciliation_required'].includes(status)) {
    return res.status(400).json({ error: 'payment_status_invalid' });
  }
  const callbackAmountText = normalizeDigits(String(req.body?.amount ?? '')).replace(/[٬,]/g, '').trim();
  const callbackAmount = Number(callbackAmountText);
  const expectedAmount = Number(payment.amount);
  if (!Number.isSafeInteger(callbackAmount) || !Number.isSafeInteger(expectedAmount) || callbackAmount !== expectedAmount) {
    return res.status(409).json({ error: 'payment_amount_mismatch' });
  }
  const snapshot = snapshotFinanceMutationState();
  let result;
  try {
    result = settlePaymentAttempt(payment, {
      status,
      reference: req.body?.reference,
      source: `webhook:${payment.provider}`,
    });
    if (result.error) return res.status(result.status || 400).json(result);
    await persistFinanceMutation(snapshot);
  } catch (error) {
    restoreFinanceMutationState(snapshot);
    return res.status(error.status || 503).json({ error: error.code || error.message });
  }
  try { publishPaymentCommitEffects(result, status); } catch (error) { console.error('[payment-post-commit] integration effect failed', error?.message || error); }
  res.json({ ok: true, idempotent: result.idempotent, payment: publicPaymentAttempt(result.payment), order: publicCheckoutOrderView(result.order) });
}));

const CUSTOMER_ORDER_STATUS_LABELS = Object.freeze({
  unknown: 'وضعیت سفارش نامشخص',
  pending: 'در انتظار تأیید',
  pending_online: 'در انتظار پرداخت آنلاین',
  pending_cashier: 'در انتظار پرداخت صندوق/پیک',
  pay_at_cashier: 'در انتظار پرداخت',
  awaiting_confirmation: 'در انتظار تأیید رستوران',
  prep: 'در حال آماده‌سازی',
  preparing: 'در حال پخت و آماده‌سازی',
  kitchen: 'در حال پخت در آشپزخانه',
  sent_to_kitchen: 'ارسال‌شده به آشپزخانه',
  ready: 'آماده تحویل',
  dispatched: 'در مسیر ارسال',
  delivering: 'در حال ارسال پیک',
  delivered: 'تحویل داده شد',
  picked_up: 'تحویل حضوری شد',
  paid: 'پرداخت و تکمیل‌شده',
  done: 'تکمیل‌شده',
  cancelled: 'لغوشده',
  rejected: 'رد شده',
});

function normalizeCustomerOrderStatus(status) {
  const normalized = typeof status === 'string' ? status.trim().toLowerCase() : '';
  return Object.hasOwn(CUSTOMER_ORDER_STATUS_LABELS, normalized) ? normalized : 'unknown';
}

function getOrderStatusFaLabel(status) {
  return CUSTOMER_ORDER_STATUS_LABELS[normalizeCustomerOrderStatus(status)];
}

function customerOrderStatusProjection(order) {
  const progress = customerOrderProgress(order);
  const paymentStatus = progress.paymentStatus || 'unknown';
  let status = normalizeCustomerOrderStatus(order?.status);
  // Legacy lifecycle rows marked "paid" without explicit payment evidence are
  // not sufficient to tell a customer that payment succeeded.
  if (status === 'paid' && paymentStatus !== 'paid') status = 'unknown';
  return {
    ...progress,
    paymentStatus,
    status,
    statusLabel: getOrderStatusFaLabel(status),
  };
}

function customerOwnsHistoryOrder(order, user) {
  // An explicit owner is authoritative. Never fall through to a matching
  // phone when the record belongs to a different account (or is malformed).
  // requireAuth resolves a session created only after OTP verification; phone
  // lookup is retained solely for genuinely unowned guest-order records.
  return loyaltyAchievements.orderBelongsToMember(order, user);
}

app.get('/api/orders/my-orders', requireAuth, (req, res) => {
  const userOrders = (db.orders || [])
    .filter((o) => customerOwnsHistoryOrder(o, req.user))
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

  const tierInfo = loyaltyEngine.resolveCustomerTier(db, req.user);

  const mapped = userOrders.map((o) => {
    const totalAmount = Number(o.total || o.finalTotal || o.subtotal || 0);
    const calculatedPoints = loyaltyEngine.calculateOrderPointsEarned(db, totalAmount, tierInfo.tier);
    return {
      ...customerOrderStatusProjection(o),
      id: o.id,
      orderNo: o.orderNo || `W-${o.id}`,
      createdAt: o.createdAt || new Date().toISOString(),
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
    const result = await createAndPersistCheckoutOrder(req.body || {}, {
      requireTable: true,
      requireQuote: true,
      idempotencyKey: req.get('Idempotency-Key') || req.body?.idempotencyKey || '',
      actor: req.user || null,
    });
    if (result.error) return res.status(result.status || 400).json(result);
    res.json({ ok: true, order: publicCheckoutOrderView(result.order), whatsapp: null });
  } catch (error) {
    return res.status(error.status || 503).json({ error: error.code || error.message });
  }
});

app.get('/api/admin/orders', requireCapability('orders.view'), async (req, res) => {
  const includePii = userCan(req.user, 'pii.view');
  const includePaymentReferences = userCan(req.user, 'payments.manage');
  const orderOptions = {
    includePii,
    includePaymentReferences,
    includeDeliveryReason: userCan(req.user, 'delivery.manage'),
  };
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

  if (String(req.query?.history || '') === 'closed') {
    try {
      const cursor = normalizeOrderHistoryCursor(req.query?.cursor);
      const limit = historyPageSize(req.query?.limit);
      const tenantId = tenantStorage.getStore()?.tenantId || TENANT_CONFIG.tenantId || 'westo';
      if (stateStore.enabled && tenantId === 'westo') {
        try {
          const archive = await stateStore.listClosedOrders({ branchId, cursor, limit });
          if (archive.available) {
            const invalidRows = Number(archive.invalidRows) || 0;
            return res.json({
              orders: (archive.orders || []).map((order) => adminOrderDto(order, orderOptions)),
              hasMore: archive.hasMore,
              nextCursor: archive.nextCursor,
              limit: archive.limit,
              complete: false,
              coverage: 'unverified',
              source: 'postgres',
              skippedInvalidRows: invalidRows,
              warning: `آرشیو پایدار سفارش‌ها صفحه‌بندی شده است، اما کامل بودن سوابق پیش از مهاجرت هنوز تأیید نشده است.${invalidRows ? ` ${invalidRows.toLocaleString('fa-IR')} ردیف نامعتبر نیز نمایش داده نشد.` : ''}`,
              serverTime: new Date().toISOString(),
            });
          }
          if (stateStore.required) {
            return res.status(503).json({
              error: 'order_history_store_unavailable',
              message: 'آرشیو پایدار سفارش‌ها در دسترس نیست؛ برای جلوگیری از نمایش تاریخچهٔ ناقص دوباره تلاش کنید.',
            });
          }
        } catch (error) {
          if (error.status === 400) return res.status(400).json({ error: error.code || 'order_history_cursor_invalid', message: 'نشانگر صفحهٔ تاریخچه معتبر نیست.' });
          if (stateStore.required) {
            console.error('[orders] durable history read failed', error);
            return res.status(503).json({ error: 'order_history_store_unavailable', message: 'خواندن آرشیو پایدار سفارش‌ها ممکن نیست؛ دوباره تلاش کنید.' });
          }
          console.warn('[orders] falling back to bounded closed-order cache', error.message);
        }
      }

      const cached = paginateCachedClosedOrders(db.orders || [], { branchId, cursor, limit });
      const warning = tenantId !== 'westo'
        ? 'برای این مجموعه آرشیو پایدار سفارش در این سرویس متصل نیست؛ فقط سابقهٔ موجود در حافظهٔ اخیر نمایش داده می‌شود و کامل نیست.'
        : 'آرشیو پایدار در دسترس نیست؛ فقط سفارش‌های بستهٔ موجود در حافظهٔ اخیر نمایش داده می‌شوند و ممکن است سابقهٔ قدیمی‌تر را شامل نشوند.';
      return res.json({
        ...cached,
        orders: (cached.orders || []).map((order) => adminOrderDto(order, orderOptions)),
        complete: false,
        coverage: 'recent-cache-only',
        source: 'recent-cache',
        warning,
        serverTime: new Date().toISOString(),
      });
    } catch (error) {
      return res.status(error.status || 400).json({ error: error.code || 'order_history_invalid', message: 'درخواست تاریخچهٔ سفارش معتبر نیست.' });
    }
  }

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
  res.json({
    orders: orders.map((order) => operationalOrderResponse(order, req.user)),
    serverTime: new Date().toISOString(),
  });
});

app.post('/api/staff/orders', requireCapability('orders.create'), async (req, res) => {
  const idempotencyKey = String(req.get('Idempotency-Key') || req.body?.idempotencyKey || '').trim();
  if (idempotencyKey && !ORDER_IDEMPOTENCY_KEY_RE.test(idempotencyKey)) {
    return res.status(400).json({ error: 'idempotency_key_invalid', message: 'کلید یکتای سفارش معتبر نیست.' });
  }
  if (process.env.NODE_ENV === 'production' && !idempotencyKey) {
    return res.status(400).json({ error: 'idempotency_key_required', message: 'برای ثبت سفارش، کلید یکتای درخواست لازم است.' });
  }
  try {
    const result = await createAndPersistCheckoutOrder(req.body || {}, {
      requireTable: String(req.body?.fulfillment || 'dine_in') === 'dine_in',
      requirePhone: false,
      idempotencyKey,
      actor: req.user,
    }, async ({ order }) => {
      if (req.body?.sendToKitchen === true && order.paymentMethod !== 'online' && order.status === 'pay_at_cashier'
          && canTransitionOrder(order, 'sent_to_kitchen')) {
        appendOrderStatus(order, 'sent_to_kitchen', req.user, { source: 'staff-pos', paymentStatus: order.paymentStatus });
        recordAudit(req, 'order.sent_to_kitchen', 'order', order.id, { paymentStatus: order.paymentStatus }, order.branchId);
        return () => publishOperationalEvent('order.updated', { orderId: order.id, branchId: order.branchId, status: order.status });
      }
      return null;
    });
    if (result.error) return res.status(result.status || 400).json(result);
    res.status(result.idempotent ? 200 : 201).json({
      ok: true,
      idempotent: !!result.idempotent,
      order: operationalOrderResponse(result.order, req.user),
    });
  } catch (error) {
    return res.status(error.status || 503).json({ error: error.code || error.message });
  }
});

const handleEditOrder = async (req, res) => {
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
  const receivedAmount = Math.max(
    Number(order.amountPaid) || 0,
    (Array.isArray(order.partialPayments) ? order.partialPayments : [])
      .reduce((sum, payment) => sum + Math.max(0, Number(payment?.amount) || 0), 0),
  );
  if (order.paymentStatus === 'paid' || receivedAmount > 0) {
    return res.status(409).json({ error: 'order_edit_after_payment_requires_adjustment', current: order.status });
  }
  if (!canEditOrderBeforeKitchen(order)) {
    return res.status(409).json({ error: 'order_edit_locked', current: order.status, startedAt: order.startedAt || null });
  }
  const currentDiscount = parseOrderTomanAmount(order.discount ?? 0);
  if (currentDiscount === null) return res.status(409).json({ error: 'order_discount_state_invalid' });
  let requestedDiscount = null;
  if (req.body?.discount !== undefined) {
    requestedDiscount = parseOrderTomanAmount(req.body.discount);
    if (requestedDiscount === null) {
      return res.status(400).json({ error: 'discount_invalid', message: 'مبلغ تخفیف باید عدد صحیح و معتبر باشد.' });
    }
  }
  if (requestedDiscount !== null && requestedDiscount > currentDiscount && !userCan(req.user, 'orders.manage')) {
    return res.status(403).json({ error: 'discount_not_allowed', message: 'اعمال یا افزایش تخفیف دستی فقط برای نقش مجاز امکان‌پذیر است.' });
  }

  const snapshot = orderInventorySnapshot();
  const mutationSnapshot = snapshotFinanceMutationState();
  const previous = {
    total: Number(order.total || 0),
    subtotal: Number(order.subtotal || 0),
    itemUnits: (order.items || []).reduce((sum, line) => sum + Number(line.qty || 0), 0),
    covers: Number(order.covers) || 1,
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
    excludeInventoryReservationOrderId: order.id,
  });
  if (normalized.error) {
    restoreOrderInventorySnapshot(snapshot);
    return res.status(400).json(normalized);
  }
  const sendToKitchen = req.body?.sendToKitchen === true;
  const waiterValidation = sendToKitchen
    ? validateWaiterKitchenSend(order, req.body?.items, { canonicalLines: normalized.lines })
    : validateWaiterOrderEdit(order, req.body?.items, { canonicalLines: normalized.lines });
  if (!waiterValidation.ok) {
    restoreOrderInventorySnapshot(snapshot);
    const conflictErrors = new Set([
      'invoice_closed', 'order_edit_locked', 'order_edit_payment_locked',
      'kitchen_send_locked', 'payment_not_confirmed',
    ]);
    return res.status(conflictErrors.has(waiterValidation.error) ? 409 : 400).json({
      error: waiterValidation.error,
      message: waiterValidation.error === 'payment_not_confirmed'
        ? 'وضعیت پرداخت سفارش تأیید نشده است؛ ابتدا اطلاعات فاکتور را بررسی کنید.'
        : 'اطلاعات سفارش با وضعیت فعلی فاکتور یا اقلام معتبر منو سازگار نیست؛ فاکتور را بازبینی کنید.',
      ...(waiterValidation.index === undefined ? {} : { index: waiterValidation.index }),
    });
  }
  if (sendToKitchen && !normalized.lines.some((line) => line.courseStatus === 'fired')) {
    restoreOrderInventorySnapshot(snapshot);
    return res.status(400).json({ error: 'kitchen_course_empty', message: 'برای ارسال سفارش، دست‌کم یک مرحله باید به آشپزخانه فرستاده شود.' });
  }

  const inventoryReservationSnapshot = financeV2.buildOrderInventoryReservationSnapshot(
    db, normalized.lines, order.branchId, order.createdAt || new Date().toISOString(),
  );
  if (!inventoryReservationSnapshot.ok) {
    restoreOrderInventorySnapshot(snapshot);
    return res.status(409).json({
      error: 'inventory_reservation_unavailable',
      message: 'رزرو مواد اولیهٔ سفارش قابل به‌روزرسانی نیست؛ موجودی و دستور تهیه را بررسی کنید.',
      details: inventoryReservationSnapshot.issues,
    });
  }

  const rawCovers = req.body?.covers === undefined
    ? Math.max(Number(order.covers) || 1, highestAssignedSeat(order.items))
    : Number(normalizeDigits(String(req.body.covers)).replace(/[^0-9]/g, ''));
  const coverValidation = validateCoversForItems(rawCovers, normalized.lines);
  if (!coverValidation.ok && coverValidation.error === 'covers_invalid') {
    restoreOrderInventorySnapshot(snapshot);
    return res.status(400).json({ error: 'covers_invalid', message: 'تعداد مهمان باید بین ۱ تا ۹۹ نفر باشد.' });
  }
  if (!coverValidation.ok) {
    restoreOrderInventorySnapshot(snapshot);
    return res.status(400).json({ error: 'seat_exceeds_covers', message: 'تعداد مهمان نمی‌تواند از شمارهٔ صندلی تخصیص‌یافته کمتر باشد.' });
  }

  const deliveryFee = parseOrderTomanAmount(order.deliveryFee ?? 0);
  if (deliveryFee === null) {
    restoreOrderInventorySnapshot(snapshot);
    return res.status(409).json({ error: 'order_delivery_fee_invalid' });
  }
  const discount = requestedDiscount === null ? Math.min(normalized.subtotal, currentDiscount) : requestedDiscount;
  if (discount > normalized.subtotal) {
    restoreOrderInventorySnapshot(snapshot);
    return res.status(400).json({ error: 'discount_exceeds_subtotal', message: 'تخفیف نمی‌تواند از جمع اقلام بیشتر باشد.' });
  }
  const nextTotal = normalized.subtotal + deliveryFee - discount;
  if (!Number.isSafeInteger(nextTotal) || nextTotal < 0) {
    restoreOrderInventorySnapshot(snapshot);
    return res.status(400).json({ error: 'order_amount_unsafe' });
  }
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
  order.inventoryReservationSnapshot = inventoryReservationSnapshot;
  order.subtotal = normalized.subtotal;
  order.discount = discount;
  order.total = nextTotal;
  order.covers = rawCovers;
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
  order.editHistory.push({ at: order.editedAt, by: order.editedBy, before: previous, after: { total: nextTotal, subtotal: normalized.subtotal, covers: rawCovers, itemUnits: normalized.lines.reduce((sum, line) => sum + Number(line.qty || 0), 0) } });
  order.editHistory = order.editHistory.slice(-30);

  if (sendToKitchen && order.status === 'pay_at_cashier' && canTransitionOrder(order, 'sent_to_kitchen')) {
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
  try {
    await persistFinanceMutation(mutationSnapshot, { bumpMenu: true });
  } catch (error) {
    restoreFinanceMutationState(mutationSnapshot);
    return res.status(error.status || 503).json({ error: error.code || 'order_persistence_failed', message: error.message });
  }
  try { publishOperationalEvent('order.updated', { orderId: order.id, branchId: order.branchId, status: order.status, edited: true }); }
  catch (error) { console.error('[order-edit] post-commit event failed', error?.message || error); }
  res.json({ ok: true, order: operationalOrderResponse(order, req.user), editable: canEditOrderBeforeKitchen(order) });
};

app.patch('/api/cashier/orders/:id', requireCapability('orders.manage'), serializeOrderMutationRoute(handleEditOrder));
app.patch('/api/waiter/orders/:id', requireCapability('service.manage'), serializeOrderMutationRoute(handleEditOrder));

app.post('/api/cashier/orders/:id/apply-loyalty', requireCapability('orders.manage'), serializeOrderMutationRoute(async (req, res) => {
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
  if (redeemPoints > 0) {
    return res.status(409).json({ error: 'loyalty_redemption_requires_settlement', message: 'استفاده از امتیاز تا زمان پیاده‌سازی رزرو و ثبت اتمیک در تسویه غیرفعال است.' });
  }

  const authorizedCustomer = phone && (req.user?.phone === phone || userCan(req.user, 'orders.manage'));
  const user = authorizedCustomer ? (db.users || []).find((u) => u.phone === phone) : null;
  const discounts = loyaltyEngine.calculateOrderDiscounts(db, {
    subtotalToman: order.subtotal,
    phone: user ? phone : '',
    user,
    redeemPoints: 0,
  });

  if (req.body?.apply) {
    const amountPaid = Math.max(0, Number(order.amountPaid) || 0);
    const nextTotal = Math.max(0, Number(order.subtotal || 0) + Number(order.deliveryFee || 0) - discounts.totalDiscountToman);
    if (nextTotal < amountPaid) return res.status(409).json({ error: 'order_edit_refund_required', amountPaid, nextTotal });
    const snapshot = snapshotFinanceMutationState();
    try {
    order.phone = phone || order.phone;
    if (user?.name && !order.name) order.name = user.name;
    order.tierDiscountToman = discounts.tierDiscountToman;
    order.pointsRedeemed = 0;
    order.pointsDiscountToman = discounts.pointsDiscountToman;
    order.loyaltyTier = discounts.tier?.id || 'bronze';
    order.discount = discounts.totalDiscountToman;
    order.total = nextTotal;
    order.amountPaid = amountPaid;
    order.balanceDue = Math.max(0, nextTotal - amountPaid);
    recordAudit(req, 'order.loyalty_discount_applied', 'order', order.id, { tierDiscountToman: discounts.tierDiscountToman, pointsRedeemed: 0 }, order.branchId);
    await persistFinanceMutation(snapshot);
    try { publishOperationalEvent('order.updated', { orderId: order.id, branchId: order.branchId, status: order.status, edited: true }); }
    catch (eventError) { console.error('[loyalty-discount] post-commit event failed', eventError?.message || eventError); }
    } catch (error) {
      restoreFinanceMutationState(snapshot);
      return res.status(error.status || 503).json({ error: error.code || 'order_persistence_failed', message: error.message });
    }
  }

  res.json({
    ok: true,
    order: operationalOrderResponse(order, req.user),
    discounts,
    customer: user && userCan(req.user, 'pii.view')
      ? {
          name: user.name,
          phone: user.phone,
          points: user.points,
          walletBalance: walletEngine.getWalletBalance(db, user.phone),
          tier: discounts.tier,
        }
      : null,
  });
}));

function isSettlementRequestFingerprint(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
}

const handleSettleOrder = async (req, res, forcedTargetId) => {
  const persistenceReadiness = settlementPersistenceGate.check({
    postgresEnabled: stateStore.enabled,
    postgresRequired: stateStore.required,
  });
  if (!persistenceReadiness.ok) {
    return res.status(persistenceReadiness.status).json({ error: persistenceReadiness.code, message: persistenceReadiness.message });
  }
  const targetId = forcedTargetId !== undefined ? forcedTargetId : Number(normalizeDigits(String(req.params.id || '')).replace(/\D/g, ''));
  const order = (db.orders || []).find((item) => Number(item.id) === targetId);
  if (!order) return res.status(404).json({ error: 'not found' });
  const branchId = persistedOrderBranchId(order);
  if (!branchId) return res.status(409).json({ error: 'order_branch_unresolved', message: 'شعبهٔ ثبت‌شدهٔ سفارش معتبر نیست؛ تسویه تا تطبیق شعبه انجام نمی‌شود.' });
  // The route's request body is optional, so requireCapability cannot infer
  // the branch from it. Resolve access from the order itself before even
  // returning an idempotent response; otherwise a scoped cashier/manager
  // could settle or inspect a paid order belonging to another branch.
  try {
    assertUserBranchAccess(req.user, branchId);
  } catch (error) {
    return res.status(error.status || 403).json({ error: error.code || 'branch_access_denied', message: error.message, requestId: req.requestId });
  }
  if (effectiveRole(req.user) === 'waiter') {
    const serviceTiming = validateWaiterSettlementTiming(order);
    if (!serviceTiming.ok) {
      return res.status(409).json({
        error: serviceTiming.error,
        message: 'گارسون فقط پس از ثبت تحویل سفارش به میز می‌تواند تسویه را انجام دهد؛ برای تسویهٔ زودتر، فاکتور را به صندوق بسپارید.',
      });
    }
  }
  const tenderValue = req.body?.tender;
  if (typeof tenderValue !== 'string' || !tenderValue.trim()) {
    return res.status(400).json({ error: 'settlement_tender_required', message: 'روش دریافت وجه را انتخاب کنید.' });
  }
  const tender = tenderValue.trim();
  if (tender === 'cash' && !userCan(req.user, 'cash.manage')) {
    return res.status(403).json({ error: 'cash_collection_forbidden', message: 'دریافت وجه نقد فقط برای کاربر دارای دسترسی صندوق مجاز است.' });
  }
  const rawPaymentAmount = req.body?.paymentAmount == null ? null : req.body.paymentAmount;
  const rawAmountTendered = req.body?.amountTendered == null ? null : req.body.amountTendered;
  let paymentReference;
  try { paymentReference = normalizeSettlementReference(req.body?.paymentReference); }
  catch (error) { return res.status(error.status || 400).json({ error: error.code || 'settlement_reference_invalid', message: error.message }); }
  const idempotencyKey = String(req.get('Idempotency-Key') || req.body?.idempotencyKey || '').trim();
  if (process.env.NODE_ENV === 'production' && !idempotencyKey) {
    return res.status(400).json({ error: 'settlement_idempotency_required', message: 'برای ثبت پرداخت، کلید یکتای درخواست لازم است.' });
  }
  if (idempotencyKey && !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$/.test(idempotencyKey)) {
    return res.status(400).json({ error: 'settlement_idempotency_invalid', message: 'کلید یکتای پرداخت معتبر نیست.' });
  }
  const inFlightKey = idempotencyKey ? settlementLockKey(req, order, idempotencyKey, branchId) : null;
  const requestFingerprint = idempotencyKey ? checkoutIdempotencyFingerprint({
    orderId: order.id,
    branchId,
    tender,
    paymentAmount: rawPaymentAmount,
    amountTendered: rawAmountTendered,
    paymentReference,
  }, req.user) : null;
  const existingPayment = idempotencyKey
    ? (Array.isArray(order.partialPayments) ? order.partialPayments : []).find((payment) => payment.idempotencyKey === idempotencyKey)
    : null;
  if (existingPayment) {
    if (!isSettlementRequestFingerprint(existingPayment.requestFingerprint)) {
      return res.status(409).json({
        error: 'idempotency_replay_unavailable',
        message: 'پرداخت قبلی اثرانگشت معتبر ندارد؛ برای جلوگیری از دریافت تکراری، رسید و وضعیت صندوق را تطبیق دهید و پرداخت را دوباره ثبت نکنید.',
      });
    }
    if (existingPayment.requestFingerprint && existingPayment.requestFingerprint !== requestFingerprint) {
      return res.status(409).json({ error: 'idempotency_key_conflict', message: 'این کلید پرداخت پیش‌تر با مبلغ یا روش دیگری استفاده شده است.' });
    }
    const pending = settlementInFlight.get(inFlightKey);
    if (pending) {
      const outcome = await pending;
      if (!outcome.ok) return res.status(outcome.status || 503).json({ error: outcome.error || 'finance_persistence_failed', message: outcome.message });
    }
    return res.json({
      ok: true,
      idempotent: true,
      order: operationalOrderResponse(order, req.user),
      payment: operationalPaymentResponse(existingPayment, req.user),
    });
  }
  if (order.paymentStatus === 'paid') {
    return res.json({ ok: true, idempotent: true, order: operationalOrderResponse(order, req.user) });
  }
  if (order.paymentStatus === 'unknown') {
    return res.status(409).json({ error: 'payment_status_reconciliation_required', message: 'وضعیت پرداخت این سفارش قابل‌تأیید نیست؛ پیش از دریافت دوباره، سابقهٔ مالی را تطبیق دهید.' });
  }
  if (!canSettleOrder(order)) {
    return res.status(409).json({ error: 'order_not_payable', current: order.status });
  }
  // Only accept tenders backed by an actual local settlement path. Card
  // processing, gift cards, and stored cards are not connected providers;
  // they must never be marked paid merely because a client named them.
  if (!['cash', 'manual_card', 'wallet'].includes(tender)) return res.status(400).json({ error: 'tender_invalid', message: 'این روش پرداخت در این سامانه فعال یا متصل نیست.' });
  if (tender === 'manual_card' && !paymentReference) {
    return res.status(400).json({
      error: 'settlement_reference_required',
      message: 'کد پیگیری درج‌شده روی رسید کارت‌خوان برای ثبت دستی الزامی است.',
    });
  }
  const previousPayments = Array.isArray(order.partialPayments) ? order.partialPayments : [];
  if (tender === 'manual_card' && paymentReference) {
    const incomingReference = settlementReferenceIdentity(paymentReference);
    const referenceAlreadyUsed = previousPayments.some((payment) => {
      try { return settlementReferenceIdentity(payment?.reference) === incomingReference; }
      catch { return false; }
    });
    if (referenceAlreadyUsed) {
      return res.status(409).json({
        error: 'settlement_reference_duplicate',
        message: 'این کد پیگیری قبلاً برای همین فاکتور ثبت شده است؛ رسیدهای پرداخت را تطبیق دهید.',
      });
    }
  }
  const amounts = resolveSettlementAmounts({
    total: order.total,
    amountPaid: order.amountPaid,
    payments: previousPayments,
    paymentAmount: req.body?.paymentAmount,
    amountTendered: req.body?.amountTendered,
    tender,
  });
  if (!amounts.ok) {
    const status = amounts.error === 'payment_amount_exceeds_due' ? 409 : 400;
    return res.status(status).json({
      error: amounts.error,
      ...(amounts.outstanding !== undefined ? { outstanding: amounts.outstanding } : {}),
      ...(amounts.minimum !== undefined ? { minimum: amounts.minimum } : {}),
    });
  }
  const { alreadyPaid, outstanding, requestedAmount, amountTendered } = amounts;
  if (!requestedAmount || !outstanding) {
    return res.json({ ok: true, idempotent: true, order: operationalOrderResponse(order, req.user) });
  }
  const drawer = tender === 'cash' ? activeCashSession(req.user, branchId) : null;
  if (tender === 'cash' && !drawer) return res.status(409).json({ error: 'cash_drawer_not_open' });
  if (drawer) {
    const currentDrawerTotals = cashSessionTotals(drawer);
    const projectedDrawerTotals = cashSessionTotals({
      ...drawer,
      movements: [{ type: 'sale', amount: requestedAmount }, ...(Array.isArray(drawer.movements) ? drawer.movements : [])],
    });
    if (!currentDrawerTotals || !projectedDrawerTotals) {
      return res.status(409).json({ error: 'cash_drawer_ledger_invalid', message: 'سابقهٔ صندوق معتبر و قابل جمع‌بندی نیست؛ پیش از دریافت وجه آن را تطبیق دهید.' });
    }
  }

  // Snapshot before any tender-side mutation. Wallet payments update the
  // customer balance before the sale journal is attempted; a closed/missing
  // fiscal period or a durable-write failure must roll that debit back along
  // with the order and drawer projection.
  const snapshot = snapshotFinanceMutationState();
  let resolveSettlement;
  let settlementPromise;
  let settlementAuditEntry;
  try {
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

  const paymentAt = new Date().toISOString();
  const payment = {
    id: nextId(previousPayments), tender, amount: requestedAmount,
    amountTendered, changeDue: tender === 'cash' ? Math.max(0, amountTendered - requestedAmount) : 0,
    ...(paymentReference ? { reference: paymentReference } : {}),
    ...(tender === 'cash' && drawer ? { cashSessionId: drawer.id } : {}),
    at: paymentAt, by: req.user.phone,
    ...(idempotencyKey ? { idempotencyKey, requestFingerprint } : {}),
  };
  order.partialPayments = previousPayments;
  order.partialPayments.push(payment);
  order.amountPaid = alreadyPaid + requestedAmount;
  const fullyPaid = order.amountPaid >= Number(order.total || 0);
  order.paymentStatus = fullyPaid ? 'paid' : 'partial';
  if (fullyPaid) {
    const nextStatus = nextOrderStatusAfterPayment(order);
    if (nextStatus && canTransitionOrder(order, nextStatus)) {
      appendOrderStatus(order, nextStatus, req.user, { source: 'cashier', tender });
    } else if (normalizeFulfillment(order.fulfillment, { tableNo: order.tableNo }) !== 'delivery'
        && ['pending', 'pending_cashier'].includes(String(order.status || ''))) {
      // Preserve the legacy wallet-intent states for non-delivery orders.
      appendOrderStatus(order, 'paid', req.user, { source: 'cashier', tender });
    }
  }
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
      at: paymentAt,
      by: req.user.phone,
    });
  }
  const receiptFinanceResult = ['cash', 'manual_card'].includes(tender)
    ? financeV2.captureOrderPaymentReceipt(db, order, payment, {
      actor: req.user.phone,
      cashSessionId: drawer?.id || null,
    })
    : null;
  settlementAuditEntry = recordAudit(req, fullyPaid ? 'order.settled' : 'order.partial_payment', 'order', order.id, { tender, paymentAmount: requestedAmount, amountPaid: order.amountPaid, outstanding: Math.max(0, Number(order.total || 0) - order.amountPaid), amountTendered, changeDue: order.changeDue }, branchId, { deferAppend: true });
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
  if (idempotencyKey) {
    settlementPromise = new Promise((resolve) => { resolveSettlement = resolve; });
    settlementInFlight.set(inFlightKey, settlementPromise);
  }
  await persistFinanceMutation(snapshot);
  appendAuditAfterCommit(settlementAuditEntry);
  try { publishOperationalEvent('order.updated', { orderId: order.id, branchId, status: order.status }); }
  catch (eventError) { console.error('[settlement] post-commit event failed', eventError?.message || eventError); }
  const responsePayload = {
    ok: true,
    order: operationalOrderResponse(order, req.user),
    payment: operationalPaymentResponse(payment, req.user),
    drawer: drawer ? { session: drawer, totals: cashSessionTotals(drawer) } : null,
    ...(userCan(req.user, 'payments.manage') ? { finance: financeResult, financeReceipt: receiptFinanceResult } : {}),
  };
  resolveSettlement?.({ ok: true });
  if (inFlightKey) settlementInFlight.delete(inFlightKey);
  res.json(responsePayload);
  } catch (error) {
    restoreFinanceMutationState(snapshot);
    const failedKey = inFlightKey;
    if (settlementPromise) {
      // Resolve duplicate requests only after the original durable write has
      // either committed or rolled back; never acknowledge an in-memory debit.
      resolveSettlement?.({ ok: false, status: error.status || 503, error: error.code || error.message, message: error.message });
      if (failedKey) settlementInFlight.delete(failedKey);
    }
    return res.status(error.status || 503).json({ error: error.code || error.message });
  }
};

app.post('/api/cashier/orders/:id/settle', requireCapability('payments.manage'), serializeOrderMutationRoute(async (req, res) => {
  const targetId = Number(normalizeDigits(String(req.params.id || '')).replace(/\D/g, ''));
  return withCashDrawerSettlementLock(req, targetId, () => handleSettleOrder(req, res, targetId));
}));

app.post('/api/staff/orders/:id/settle', requireCapability('payments.collect'), serializeOrderMutationRoute(async (req, res) => {
  const targetId = Number(normalizeDigits(String(req.params.id || '')).replace(/\D/g, ''));
  return withCashDrawerSettlementLock(req, targetId, () => handleSettleOrder(req, res, targetId));
}));

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
    // Official order printouts must be rendered from the authoritative order;
    // never let a browser-supplied image redefine prices or payment state.
    const result = await sendOrderToPrinter(order, printer, { restaurantName: db.restaurant?.name || 'وستو' });
    const printedAt = new Date().toISOString();
    order.lastPrint = { status: 'printed', printerId: printer.id, printedAt, by: req.user.phone };
    recordAudit(req, 'order.printed', 'order', order.id, { printerId: printer.id, host: printer.host, port: printer.port, bytes: result.bytes, paid: order.paymentStatus === 'paid' }, branchId);
    save();
    return res.json({ ok: true, printed: true, printer: publicPrinterConfig(printer), result, order: operationalOrderResponse(order, req.user) });
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
  const branchId = Number(order.branchId) || defaultBranch()?.id || 1;
  try {
    assertUserBranchAccess(req.user, branchId);
  } catch (error) {
    return res.status(error.status || 403).json({ error: error.code || 'branch_access_denied', message: error.message });
  }
  if (order.paymentStatus !== 'paid') return res.status(409).json({ error: 'order_not_paid' });
  const method = String(req.body?.method || 'none');
  if (!['print', 'email', 'sms', 'none'].includes(method)) return res.status(400).json({ error: 'receipt_method_invalid' });
  if (method === 'print') {
    const printer = printerForBranch(db, branchId, req.body?.printerId);
    if (!printer) return res.status(409).json({ error: 'printer_not_configured' });
    try {
      // A paid receipt is generated only from the canonical, persisted order.
      const result = await sendOrderToPrinter(order, printer, { restaurantName: db.restaurant?.name || 'وستو' });
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
      return res.json({ ok: true, order: operationalOrderResponse(order, req.user), printed: true, deliveryConfigured: true, printer: publicPrinterConfig(printer), result });
    } catch (error) {
      const failedAt = new Date().toISOString();
      order.receipt = {
        method,
        status: 'failed',
        printerId: printer.id,
        selectedAt: failedAt,
        by: req.user.phone,
        error: error.code || error.message,
      };
      order.lastPrint = {
        status: 'failed',
        printerId: printer.id,
        printedAt: failedAt,
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
  res.json({ ok: true, order: operationalOrderResponse(order, req.user), deliveryConfigured: method === 'none' });
});

app.patch('/api/cashier/orders/:id/status', requireCapability('orders.manage'), serializeOrderMutationRoute(async (req, res) => {
  const targetId = Number(normalizeDigits(String(req.params.id || '')).replace(/\D/g, ''));
  const order = (db.orders || []).find((item) => Number(item.id) === targetId);
  if (!order) return res.status(404).json({ error: 'not found' });
  try {
    assertUserBranchAccess(req.user, order.branchId);
  } catch (error) {
    return res.status(error.status || 403).json({ error: error.code || 'branch_access_denied', message: error.message, requestId: req.requestId });
  }
  const next = String(req.body?.status || '');
  if (next && next === String(order.status || '')) {
    return res.json({ ok: true, idempotent: true, order: operationalOrderResponse(order, req.user) });
  }
  if (normalizeFulfillment(order.fulfillment, { tableNo: order.tableNo }) === 'delivery'
      && ['dispatched', 'delivered'].includes(next) && !hasAcceptedDelivery(order)) {
    return res.status(409).json({ error: 'delivery_acceptance_required', message: 'ارسال و تحویل پیک بدون پذیرش ثبت‌شدهٔ رستوران ممکن نیست.' });
  }
  const allowed = {
    pay_at_cashier: ['cancelled'],
    awaiting_confirmation: ['cancelled'],
    ready: order.fulfillment === 'delivery' ? ['dispatched'] : order.fulfillment === 'pickup' ? ['picked_up'] : ['done'],
    dispatched: order.fulfillment === 'delivery' ? ['delivered'] : [],
  }[String(order.status || '')] || [];
  if (!allowed.includes(next)) return res.status(409).json({ error: 'cashier_transition_invalid', current: order.status, allowed });
  if (next === 'cancelled') {
    const cancellation = orderCancellationGuard(order);
    if (!cancellation.ok) return res.status(409).json({ error: cancellation.code, message: cancellation.message });
  }
  const snapshot = snapshotFinanceMutationState();
  try {
  if (next === 'cancelled' && shouldReleaseOrderInventory(order)) {
    adjustOrderInventory(order.items, 1, order.branchId);
  }
  appendOrderStatus(order, next, req.user, { source: 'cashier' });
  if (['done', 'picked_up', 'delivered'].includes(next)) maybeAwardOrderLoyalty(order);
  recordAudit(req, 'order.status_changed', 'order', order.id, { status: next, source: 'cashier' }, order.branchId);
  await persistFinanceMutation(snapshot);
  try { publishOperationalEvent('order.updated', { orderId: order.id, branchId: order.branchId, status: next }); }
  catch (eventError) { console.error('[cashier-status] post-commit event failed', eventError?.message || eventError); }
  res.json({ ok: true, order: operationalOrderResponse(order, req.user) });
  } catch (error) {
    restoreFinanceMutationState(snapshot);
    return res.status(error.status || 503).json({ error: error.code || 'order_persistence_failed', message: error.message });
  }
}));

app.get('/api/waiter/calls', requireCapability('service.manage'), (req, res) => {
  const branchId = parseBranchId(req);
  const calls = branchScoped(db.waiterCalls || [], branchId)
    .filter((call) => call.status === 'open' || call.status === 'new')
    .slice(0, 80);
  res.json({ calls, serverTime: new Date().toISOString() });
});

app.patch('/api/waiter/calls/:id', requireCapability('service.manage'), async (req, res) => {
  const targetId = Number(normalizeDigits(String(req.params.id || '')).replace(/\D/g, ''));
  const call = (db.waiterCalls || []).find((item) => Number(item.id) === targetId);
  if (!call) return res.status(404).json({ error: 'not found' });
  try {
    assertUserBranchAccess(req.user, call.branchId);
  } catch (error) {
    return res.status(error.status || 403).json({ error: error.code || 'branch_access_denied', message: error.message, requestId: req.requestId });
  }
  if (String(req.body?.status || '') !== 'done') return res.status(400).json({ error: 'call_status_invalid' });
  return serializeAdminConfigMutation(call.branchId, async () => {
    const current = (db.waiterCalls || []).find((item) => Number(item.id) === targetId);
    if (!current) return res.status(404).json({ error: 'not found' });
    try {
      assertUserBranchAccess(req.user, current.branchId);
    } catch (error) {
      return res.status(error.status || 403).json({ error: error.code || 'branch_access_denied', message: error.message, requestId: req.requestId });
    }
    if (current.status === 'done') return res.json({ ok: true, idempotent: true, call: current });
    if (!['open', 'new'].includes(String(current.status || ''))) {
      return res.status(409).json({ error: 'waiter_call_transition_invalid', current: current.status });
    }

    const snapshot = snapshotFinanceMutationState();
    current.status = 'done';
    current.resolvedAt = new Date().toISOString();
    current.resolvedBy = req.user.phone;
    const auditEntry = recordAudit(req, 'waiter_call.resolved', 'waiter_call', current.id, { tableNo: current.tableNo }, current.branchId, { deferAppend: true });
    try {
      await persistFinanceMutation(snapshot);
    } catch (error) {
      return res.status(error.status || 503).json({ error: error.code || 'waiter_call_persistence_failed', message: 'ثبت انجام فراخوان پایدار نشد؛ دوباره همگام‌سازی کنید.' });
    }

    appendAuditAfterCommit(auditEntry);
    let eventPublished = true;
    try {
      publishOperationalEvent('waiter_call.updated', { callId: current.id, branchId: current.branchId, status: current.status });
    } catch (error) {
      eventPublished = false;
      console.error('[waiter-call] committed event failed', error?.message || error);
    }
    return res.json({ ok: true, eventPublished, call: current });
  }).catch((error) => {
    if (res.headersSent) return undefined;
    return res.status(error.status || 503).json({ error: error.code || 'waiter_call_update_failed' });
  });
});

app.patch('/api/waiter/orders/:id/status', requireCapability('service.manage'), serializeOrderMutationRoute(async (req, res) => {
  const targetId = Number(normalizeDigits(String(req.params.id || '')).replace(/\D/g, ''));
  const order = (db.orders || []).find((item) => Number(item.id) === targetId);
  if (!order) return res.status(404).json({ error: 'not found' });
  try {
    assertUserBranchAccess(req.user, order.branchId);
  } catch (error) {
    return res.status(error.status || 403).json({ error: error.code || 'branch_access_denied', message: error.message, requestId: req.requestId });
  }
  const next = String(req.body?.status || '');
  if (next === 'done' && order.status === 'done') {
    return res.json({ ok: true, idempotent: true, order: operationalOrderResponse(order, req.user) });
  }
  const allowed = order.fulfillment === 'dine_in' && order.status === 'ready' ? ['done'] : [];
  if (!allowed.includes(next)) return res.status(409).json({ error: 'waiter_transition_invalid', current: order.status, allowed });
  const snapshot = snapshotFinanceMutationState();
  try {
  appendOrderStatus(order, next, req.user, { source: 'waiter' });
  maybeAwardOrderLoyalty(order);
  recordAudit(req, 'order.status_changed', 'order', order.id, { status: next, source: 'waiter' }, order.branchId);
  await persistFinanceMutation(snapshot);
  try { publishOperationalEvent('order.updated', { orderId: order.id, branchId: order.branchId, status: next }); }
  catch (eventError) { console.error('[waiter-status] post-commit event failed', eventError?.message || eventError); }
  res.json({ ok: true, order: operationalOrderResponse(order, req.user) });
  } catch (error) {
    restoreFinanceMutationState(snapshot);
    return res.status(error.status || 503).json({ error: error.code || 'order_persistence_failed', message: error.message });
  }
}));

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

const waitlistMutationQueues = new Map();

async function serializeWaitlistMutation(branchId, operation) {
  const tenantId = tenantStorage.getStore()?.tenantId || TENANT_CONFIG.tenantId || 'westo';
  const key = `${tenantId}:${Number(branchId)}`;
  const previous = waitlistMutationQueues.get(key) || Promise.resolve();
  const current = previous.catch(() => {}).then(operation);
  waitlistMutationQueues.set(key, current);
  try {
    return await current;
  } finally {
    if (waitlistMutationQueues.get(key) === current) waitlistMutationQueues.delete(key);
  }
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

app.post('/api/waiter/waitlist', requireCapability('reservations.receive'), async (req, res) => {
  let branchId;
  try { branchId = parseBranchId(req); } catch (error) {
    return res.status(error.status || 400).json({ error: error.code || 'waitlist_branch_invalid', message: error.message });
  }
  if (!branchId) return res.status(400).json({ error: 'waitlist_branch_required', message: 'شعبهٔ فعال مشخص نیست.' });
  return serializeWaitlistMutation(branchId, async () => {
    db.reservations = Array.isArray(db.reservations) ? db.reservations : [];
    const reservationsBefore = db.reservations.slice();
    const hadAuditLog = Array.isArray(db.auditLog);
    const auditLogBefore = hadAuditLog ? db.auditLog.slice() : null;
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
        await save({ requireDurable: true });
        try { publishOperationalEvent('waitlist.created', { waitlistId: result.entry.id, branchId, status: result.entry.status }); }
        catch (eventError) { console.error('[waitlist-create] post-commit event failed', eventError?.message || eventError); }
      }
      return res.status(result.idempotentReplay ? 200 : 201).json({ ok: true, idempotent: result.idempotentReplay, entry: publicWaitlistEntry(result.entry) });
    } catch (error) {
      db.reservations = reservationsBefore;
      if (hadAuditLog) db.auditLog = auditLogBefore;
      else delete db.auditLog;
      return res.status(error.status || 503).json({ error: error.code || 'waitlist_create_failed', message: error.message, entry: error.entry ? publicWaitlistEntry(error.entry) : undefined });
    }
  });
});

app.patch('/api/waiter/waitlist/:id', requireCapability('reservations.receive'), async (req, res) => {
  const targetId = Number(normalizeDigits(String(req.params.id || '')).replace(/\D/g, ''));
  const entry = (db.reservations || []).find((item) => Number(item.id) === targetId && waitlist.isWaitlist(item));
  if (!entry) return res.status(404).json({ error: 'waitlist_not_found', message: 'مهمان موردنظر در صف پیدا نشد.' });
  try { assertUserBranchAccess(req.user, entry.branchId); } catch (error) {
    return res.status(error.status || 403).json({ error: error.code || 'branch_access_denied', message: error.message, requestId: req.requestId });
  }
  return serializeWaitlistMutation(entry.branchId, async () => {
    const current = (db.reservations || []).find((item) => Number(item.id) === targetId && waitlist.isWaitlist(item));
    if (!current) return res.status(404).json({ error: 'waitlist_not_found', message: 'مهمان موردنظر در صف پیدا نشد.' });
    try { assertUserBranchAccess(req.user, current.branchId); } catch (error) {
      return res.status(error.status || 403).json({ error: error.code || 'branch_access_denied', message: error.message, requestId: req.requestId });
    }

    let prepared;
    const operationNow = new Date();
    try {
      prepared = waitlist.prepareWaitlistUpdate({
        entry: current,
        records: db.reservations || [],
        tables: db.tables || [],
        body: req.body || {},
        maxParty: db.reservationSettings?.maxParty || 40,
        now: operationNow.toISOString(),
        isTableBusy: (tableNo, table, candidate) => {
          const orderBusy = (db.orders || []).some((order) => activeDineInOrderOnTable(order, table.id, candidate.branchId));
          if (orderBusy) return true;
          return (db.reservations || []).some((item) => item !== candidate
            && Number(item.branchId) === Number(candidate.branchId)
            && waitlist.tableIdsOverlap(item.tableNo, tableNo)
            && ((waitlist.isWaitlist(item) && item.status === 'seated')
              || (!waitlist.isWaitlist(item) && waitlist.reservationBlocksTable(
                item,
                operationNow,
                db.reservationSettings?.slotMinutes,
              ))));
        },
      });
    } catch (error) {
      return res.status(error.status || 400).json({ error: error.code || 'waitlist_update_invalid', message: error.message, current: current.status });
    }
    if (prepared.idempotent) return res.json({ ok: true, idempotent: true, entry: publicWaitlistEntry(current) });

    const before = JSON.parse(JSON.stringify(current));
    const hadAuditLog = Array.isArray(db.auditLog);
    const auditLogBefore = hadAuditLog ? db.auditLog.slice() : null;
    Object.assign(current, prepared.entry);
    try {
      recordAudit(req, 'waitlist.updated', 'reservation', current.id, { status: current.status, tableNo: current.tableNo || null }, current.branchId);
      await save({ requireDurable: true });
    } catch (error) {
      Object.assign(current, before);
      if (hadAuditLog) db.auditLog = auditLogBefore;
      else delete db.auditLog;
      return res.status(error.status || 503).json({ error: error.code || 'waitlist_persistence_failed', message: 'تغییر صف پایدار نشد؛ دوباره همگام‌سازی کنید.', current: current.status });
    }
    try { publishOperationalEvent('waitlist.updated', { waitlistId: current.id, branchId: current.branchId, status: current.status, tableNo: current.tableNo || null }); }
    catch (eventError) { console.error('[waitlist-update] post-commit event failed', eventError?.message || eventError); }
    return res.json({ ok: true, entry: publicWaitlistEntry(current) });
  });
});

app.patch('/api/waiter/orders/:id/fire-course', requireCapability('orders.course.manage'), serializeOrderMutationRoute(async (req, res) => {
  const targetId = Number(normalizeDigits(String(req.params.id || '')).replace(/\D/g, ''));
  const order = (db.orders || []).find((item) => Number(item.id) === targetId);
  if (!order) return res.status(404).json({ error: 'not found' });
  try {
    assertUserBranchAccess(req.user, order.branchId);
  } catch (error) {
    return res.status(error.status || 403).json({ error: error.code || 'branch_access_denied', message: error.message, requestId: req.requestId });
  }
  if (normalizeFulfillment(order.fulfillment, { tableNo: order.tableNo }) === 'delivery' && !hasAcceptedDelivery(order)) {
    return res.status(409).json({ error: 'delivery_acceptance_required', message: 'پیش از ارسال دورهٔ سفارش، پذیرش رستوران را ثبت کنید.' });
  }
  const course = String(req.body?.course || '').trim().toLowerCase();
  if (!course) return res.status(400).json({ error: 'course_required' });
  const courseValidation = validateWaiterCourseFire(order, course);
  if (!courseValidation.ok) {
    const status = ['order_not_found', 'course_not_found'].includes(courseValidation.error)
      ? 404
      : ['course_invalid'].includes(courseValidation.error)
        ? 400
        : 409;
    return res.status(status).json({ error: courseValidation.error, current: order.status });
  }
  if (courseValidation.idempotent) {
    return res.json({ ok: true, idempotent: true, order: operationalOrderResponse(order, req.user), firedCount: 0, course: courseValidation.course });
  }
  const snapshot = snapshotFinanceMutationState();
  const now = new Date().toISOString();
  let firedCount = 0;
  (order.items || []).forEach((item) => {
    if (String(item.course || '').toLowerCase() === course && item.courseStatus === 'hold') {
      item.courseStatus = 'fired';
      item.firedAt = now;
      firedCount++;
    }
  });
  if (firedCount > 0 && order.status === 'pay_at_cashier' && canTransitionOrder(order, 'sent_to_kitchen')) {
    appendOrderStatus(order, 'sent_to_kitchen', req.user, { source: 'waiter-fire', course });
  }
  recordAudit(req, 'order.course_fired', 'order', order.id, { course, firedCount }, order.branchId);
  try {
    await persistFinanceMutation(snapshot);
  } catch (error) {
    return res.status(error.status || 503).json({ error: error.code || 'course_persistence_failed', message: 'ارسال مرحلهٔ سفارش پایدار نشد؛ وضعیت را تازه کنید و دوباره بررسی کنید.' });
  }
  try { publishOperationalEvent('order.updated', { orderId: order.id, branchId: order.branchId, status: order.status, courseFired: course }); }
  catch (eventError) { console.error('[waiter-course] post-commit event failed', eventError?.message || eventError); }
  res.json({ ok: true, order: operationalOrderResponse(order, req.user), firedCount, course });
}));

function allocateOrderSplitDiscount(discount, selectedSubtotal, remainingSubtotal) {
  const selected = Number(selectedSubtotal);
  const remaining = Number(remainingSubtotal);
  const gross = selected + remaining;
  const requestedDiscount = Number(discount);
  if (!Number.isSafeInteger(selected) || selected < 0
      || !Number.isSafeInteger(remaining) || remaining < 0
      || !Number.isSafeInteger(gross)
      || !Number.isSafeInteger(requestedDiscount) || requestedDiscount < 0) return null;
  const totalDiscount = Math.min(requestedDiscount, gross);
  const selectedDiscount = gross > 0
    ? Number((BigInt(totalDiscount) * BigInt(selected)) / BigInt(gross))
    : 0;
  return {
    selectedDiscount,
    remainingDiscount: totalDiscount - selectedDiscount,
  };
}

app.post('/api/waiter/orders/:id/split', requireCapability('orders.split'), serializeOrderMutationRoute(async (req, res) => {
  const targetId = Number(normalizeDigits(String(req.params.id || '')).replace(/\D/g, ''));
  const order = (db.orders || []).find((item) => Number(item.id) === targetId);
  if (!order) return res.status(404).json({ error: 'not found' });
  try {
    assertUserBranchAccess(req.user, order.branchId);
  } catch (error) {
    return res.status(error.status || 403).json({ error: error.code || 'branch_access_denied', message: error.message, requestId: req.requestId });
  }
  const idempotencyKey = String(req.get('Idempotency-Key') || req.body?.idempotencyKey || '').trim();
  if (process.env.NODE_ENV === 'production' && !idempotencyKey) {
    return res.status(400).json({ error: 'order_split_idempotency_required', message: 'برای تفکیک فاکتور در محیط تولید، کلید یکتای درخواست لازم است.' });
  }
  if (idempotencyKey && !ORDER_IDEMPOTENCY_KEY_RE.test(idempotencyKey)) {
    return res.status(400).json({ error: 'order_split_idempotency_invalid' });
  }
  const splitMode = req.body?.mode || 'seat';
  if (!['seat', 'items'].includes(splitMode)) {
    return res.status(400).json({ error: 'split_mode_invalid' });
  }
  const targetSeat = Number(req.body?.seat || 0);
  const requestedItemIndices = Array.isArray(req.body?.itemIndices)
    ? [...new Set(req.body.itemIndices.map(Number).filter((index) => Number.isInteger(index) && index >= 0))]
    : [];
  const requestFingerprint = idempotencyKey ? checkoutIdempotencyFingerprint({
    orderId: order.id,
    branchId: persistedOrderBranchId(order),
    mode: splitMode,
    seat: splitMode === 'seat' ? targetSeat : null,
    itemIndices: splitMode === 'items' ? requestedItemIndices : [],
  }, req.user) : null;
  if (idempotencyKey && order.splitOperations != null && !Array.isArray(order.splitOperations)) {
    return res.status(409).json({ error: 'idempotency_replay_unavailable', message: 'سابقهٔ تفکیک سفارش معتبر نیست؛ پیش از تکرار، فاکتورهای مرتبط را دستی تطبیق دهید.' });
  }
  const splitOperations = Array.isArray(order.splitOperations) ? order.splitOperations : [];
  const priorSplit = idempotencyKey
    ? splitOperations.find((operation) => operation?.idempotencyKey === idempotencyKey)
    : null;
  if (priorSplit) {
    if (!/^[a-f0-9]{64}$/i.test(String(priorSplit.requestFingerprint || ''))) {
      return res.status(409).json({ error: 'idempotency_replay_unavailable', message: 'اطلاعات بازیابی تفکیک کامل نیست؛ سفارش‌ها را بررسی کنید و درخواست را تکرار نکنید.' });
    }
    if (priorSplit.requestFingerprint !== requestFingerprint) {
      return res.status(409).json({ error: 'idempotency_key_conflict' });
    }
    const replayOrder = (db.orders || []).find((item) => Number(item.id) === Number(priorSplit.splitOrderId));
    if (!replayOrder || Number(replayOrder.splitFromOrderId) !== Number(order.id)
        || Number(replayOrder.branchId) !== Number(order.branchId)) {
      return res.status(409).json({ error: 'idempotency_replay_unavailable', message: 'فاکتور حاصل از تفکیک دیگر در دسترس نیست؛ وضعیت را دستی تطبیق دهید.' });
    }
    return res.json({ ok: true, idempotent: true, primaryOrder: operationalOrderResponse(order, req.user), splitOrder: operationalOrderResponse(replayOrder, req.user) });
  }
  if (['paid', 'partial', 'pending', 'unknown'].includes(String(order.paymentStatus || '').toLowerCase())
    || order.status === 'paid'
    || receivedAmount(order) > 0) {
    return res.status(409).json({ error: 'order_split_locked', message: 'تا تعیین تکلیف پرداخت یا ثبت دریافت، تفکیک فاکتور ممکن نیست؛ ابتدا وضعیت صندوق را بررسی کنید.' });
  }
  const splitLifecycle = orderSplitLifecycleGuard(order);
  if (!splitLifecycle.ok) {
    return res.status(409).json({ error: splitLifecycle.code, message: splitLifecycle.message });
  }
  if (normalizeFulfillment(order.fulfillment, { tableNo: order.tableNo }) !== 'dine_in') {
    return res.status(409).json({ error: 'order_split_dine_in_only', message: 'تفکیک فاکتور فقط برای سفارش حضوری مجاز است.' });
  }
  if (!Array.isArray(order.items) || order.items.length <= 1) {
    return res.status(400).json({ error: 'cannot_split_single_item_order' });
  }
  const selectedItemIndices = requestedItemIndices.filter((index) => index < order.items.length);

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

  const lineSubtotal = (item) => Number(item.lineTotal) || Number(item.price) * Number(item.qty);
  const splitSubtotal = splitItems.reduce((sum, item) => sum + lineSubtotal(item), 0);
  const remainingSubtotal = remainingItems.reduce((sum, item) => sum + lineSubtotal(item), 0);
  const discountAllocation = allocateOrderSplitDiscount(order.discount || 0, splitSubtotal, remainingSubtotal);
  if (!discountAllocation) {
    return res.status(409).json({ error: 'order_split_pricing_invalid', message: 'مبلغ اقلام یا تخفیف سفارش برای تفکیک معتبر نیست.' });
  }

  const snapshot = snapshotFinanceMutationState();
  order.items = remainingItems;
  order.subtotal = remainingSubtotal;
  order.discount = discountAllocation.remainingDiscount;
  order.total = remainingSubtotal - discountAllocation.remainingDiscount;
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
    subtotal: splitSubtotal,
    discount: discountAllocation.selectedDiscount,
    total: splitSubtotal - discountAllocation.selectedDiscount,
    checkNo: subTableNo,
    createdAt: new Date().toISOString(),
    statusAt: new Date().toISOString(),
    paymentStatus: 'unpaid',
    amountPaid: 0,
    partialPayments: [],
    balanceDue: splitSubtotal - discountAllocation.selectedDiscount,
    splitFromOrderId: order.id,
    splitMode,
    splitSeat: splitMode === 'seat' ? targetSeat : null,
    splitItemIndices: splitMode === 'items' ? selectedItemIndices : [],
    splitAt: new Date().toISOString(),
  };
  db.orders.unshift(subOrder);
  if (idempotencyKey) {
    order.splitOperations = [
      ...splitOperations,
      {
        idempotencyKey,
        requestFingerprint,
        splitOrderId: subOrder.id,
        createdAt: subOrder.splitAt,
      },
    ];
  }

  recordAudit(req, 'order.split', 'order', order.id, { newOrderId: subOrder.id, subTableNo }, order.branchId);
  try {
    await persistFinanceMutation(snapshot);
  } catch (error) {
    return res.status(error.status || 503).json({ error: error.code || 'order_split_persistence_failed', message: 'تفکیک سفارش به‌صورت پایدار ثبت نشد؛ وضعیت را تازه کنید و دوباره بررسی کنید.' });
  }
  publishOperationalEvent('order.created', { orderId: subOrder.id, branchId: subOrder.branchId, status: subOrder.status });
  publishOperationalEvent('order.updated', { orderId: order.id, branchId: order.branchId, status: order.status });
  res.json({ ok: true, primaryOrder: operationalOrderResponse(order, req.user), splitOrder: operationalOrderResponse(subOrder, req.user) });
}));

app.patch('/api/waiter/orders/:id/move-table', requireCapability('orders.move_table'), async (req, res) => {
  const targetId = Number(normalizeDigits(String(req.params.id || '')).replace(/\D/g, ''));
  if (!Number.isSafeInteger(targetId) || targetId <= 0) return res.status(400).json({ error: 'order_id_invalid' });
  const initial = (db.orders || []).find((item) => Number(item.id) === targetId);
  if (!initial) return res.status(404).json({ error: 'not found' });
  const initialBranchId = persistedOrderBranchId(initial);
  if (!initialBranchId) return res.status(409).json({ error: 'order_branch_invalid' });
  try {
    assertUserBranchAccess(req.user, initialBranchId);
  } catch (error) {
    return res.status(error.status || 403).json({ error: error.code || 'branch_access_denied', message: error.message, requestId: req.requestId });
  }
  const nextTable = String(req.body?.tableNo || '').trim();
  if (!nextTable) return res.status(400).json({ error: 'table_required' });
  return serializeBranchOrderMutation(initial, async () => {
    const order = (db.orders || []).find((item) => Number(item.id) === targetId);
    if (!order) return res.status(404).json({ error: 'not found' });
    if (persistedOrderBranchId(order) !== initialBranchId) {
      return res.status(409).json({ error: 'order_branch_changed' });
    }
    try {
      assertUserBranchAccess(req.user, initialBranchId);
    } catch (error) {
      return res.status(error.status || 403).json({ error: error.code || 'branch_access_denied', message: error.message, requestId: req.requestId });
    }
    if (!(db.branches || []).some((branch) => Number(branch.id) === initialBranchId && branch.active !== false)) {
      return res.status(409).json({ error: 'order_branch_inactive' });
    }

    const fulfillment = normalizeFulfillment(order.fulfillment, { tableNo: order.tableNo });
    const status = String(order.status || '').trim().toLowerCase();
    const invoiceStatus = String(order.invoiceStatus || '').trim().toLowerCase();
    const explicitlyClosed = order.closed === true || order.invoiceClosed === true
      || Boolean(order.closedAt || order.invoiceClosedAt)
      || ['closed', 'settled', 'paid', 'cancelled', 'canceled', 'void', 'refunded'].includes(invoiceStatus);
    const serviceComplete = ['done', 'completed', 'picked_up', 'delivered'].includes(status);
    const unpaidCompletion = ['unpaid', 'partial', 'pending', 'failed', 'unknown'].includes(paymentStatusFor(order));
    const knownOpenStatus = ['draft', 'pay_at_cashier', 'awaiting_confirmation', 'pending_online',
      'sent_to_kitchen', 'preparing', 'ready', 'paid', 'dispatched', 'done', 'completed', 'picked_up', 'delivered'];
    if (fulfillment !== 'dine_in' || explicitlyClosed || !knownOpenStatus.includes(status)
        || status === 'cancelled' || (serviceComplete && !unpaidCompletion)) {
      return res.status(409).json({ error: 'order_not_open_dine_in', message: 'فقط سفارش حضوریِ باز و تسویه‌نشده قابل انتقال است.' });
    }

    const targetTable = tableForBranch(nextTable, initialBranchId);
    if (!targetTable || Number(tableBranchId(targetTable)) !== initialBranchId) {
      return res.status(404).json({ error: 'table_not_found', message: 'میز مقصد در شعبهٔ فعال پیدا نشد.' });
    }
    if (targetTable.active === false) {
      return res.status(409).json({ error: 'table_inactive', message: 'میز مقصد غیرفعال است.' });
    }
    const oldTable = order.tableNo || null;
    if (tableNoBelongsToTable(oldTable, targetTable.id)) {
      const movedAuditExists = (db.auditLog || []).some((entry) => entry.action === 'order.table_moved'
        && String(entry.targetId) === String(order.id)
        && String(entry.meta?.nextTable || '') === String(order.tableNo));
      if (!movedAuditExists) {
        const auditSnapshot = snapshotFinanceMutationState();
        const auditEntry = recordAudit(req, 'order.table_moved', 'order', order.id, {
          oldTable: null, nextTable: String(order.tableNo), recoveredAfterCommit: true,
        }, initialBranchId, { deferAppend: true });
        try {
          await persistFinanceMutation(auditSnapshot);
        } catch (error) {
          return res.status(error.status || 503).json({
            error: error.code || 'order_table_move_audit_persistence_failed',
            message: 'انتقال انجام شده اما ثبت سابقه کامل نشد؛ وضعیت را تازه و دوباره بررسی کنید.',
          });
        }
        appendAuditAfterCommit(auditEntry);
      }
      return res.json({ ok: true, idempotent: true, order: operationalOrderResponse(order, req.user), oldTable, nextTable: oldTable });
    }

    const occupied = (db.orders || []).some((candidate) => Number(candidate.id) !== targetId
      && Number(candidate.branchId) === initialBranchId
      && waitlist.tableIdsOverlap(candidate.tableNo, targetTable.id)
      && activeDineInOrderOnTable(candidate, candidate.tableNo, initialBranchId));
    if (occupied || ['busy', 'occupied'].includes(String(targetTable.state || '').trim().toLowerCase())) {
      return res.status(409).json({ error: 'table_occupied', message: 'میز مقصد در حال سرویس است؛ میز دیگری انتخاب کنید.' });
    }
    if (String(targetTable.state || '').trim().toLowerCase() === 'reserved') {
      return res.status(409).json({ error: 'table_reserved', message: 'میز مقصد رزرو شده است؛ میز دیگری انتخاب کنید.' });
    }

    const now = new Date();
    const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const reserved = (db.reservations || []).some((entry) => {
      if (Number(entry.branchId) !== initialBranchId || !waitlist.tableIdsOverlap(entry.tableNo, targetTable.id)) return false;
      if (waitlist.isWaitlist(entry)) return String(entry.status || '') === 'seated';
      const reservationStatus = String(entry.status || '').trim().toLowerCase();
      if (!['pending', 'confirmed', 'seated'].includes(reservationStatus)) return false;
      const dateKey = String(entry.date || '').slice(0, 10);
      return reservationStatus === 'seated'
        || waitlist.reservationBlocksTable(entry, now, db.reservationSettings?.slotMinutes)
        || !/^\d{4}-\d{2}-\d{2}$/u.test(dateKey)
        || dateKey > todayKey;
    });
    if (reserved) {
      return res.status(409).json({ error: 'table_reserved', message: 'میز مقصد برای رزرو یا مهمانِ نشسته نگه داشته شده است.' });
    }

    const snapshot = snapshotFinanceMutationState();
    const assignedTable = String(targetTable.id);
    order.tableNo = assignedTable;
    order.checkNo = nextDineInCheckNo(initialBranchId, assignedTable, assignedTable);
    try {
      await persistFinanceMutation(snapshot);
    } catch (error) {
      return res.status(error.status || 503).json({
        error: error.code || 'order_table_move_persistence_failed',
        message: 'انتقال میز ذخیره نشد؛ وضعیت قبلی سفارش حفظ شد.',
      });
    }

    const auditSnapshot = snapshotFinanceMutationState();
    const auditEntry = recordAudit(req, 'order.table_moved', 'order', order.id, {
      oldTable, nextTable: assignedTable,
    }, initialBranchId, { deferAppend: true });
    try {
      await persistFinanceMutation(auditSnapshot);
    } catch (error) {
      return res.status(error.status || 503).json({
        error: error.code || 'order_table_move_audit_persistence_failed',
        message: 'انتقال ذخیره شد اما ثبت سابقه کامل نشد؛ وضعیت را تازه و دوباره بررسی کنید.',
      });
    }
    appendAuditAfterCommit(auditEntry);
    let eventPublished = true;
    try {
      publishOperationalEvent('order.updated', { orderId: order.id, branchId: initialBranchId, tableNo: assignedTable });
    } catch (error) {
      eventPublished = false;
      console.error('[waiter-move-table] committed event failed', error?.message || error);
    }
    return res.json({ ok: true, idempotent: false, eventPublished, order: operationalOrderResponse(order, req.user), oldTable, nextTable: assignedTable });
  }).catch((error) => {
    if (res.headersSent) return undefined;
    return res.status(error.status || 503).json({ error: error.code || 'order_table_move_failed', message: error.message });
  });
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

function rollbackAuditEntry(entry, auditLogWasPresent) {
  if (entry && Array.isArray(db.auditLog)) db.auditLog = db.auditLog.filter((candidate) => candidate !== entry);
  if (!auditLogWasPresent && Array.isArray(db.auditLog) && db.auditLog.length === 0) delete db.auditLog;
}

function respondAdminConfigPersistenceFailure(res, error, fallbackCode) {
  console.error('[admin-config] durable write failed', error?.message || error);
  return res.status(error?.status || 503).json({
    error: error?.code || fallbackCode,
    message: 'تغییر ذخیره نشد؛ دوباره تلاش کنید.',
  });
}

function validateAdminHoursTime(value) {
  if (typeof value !== 'string') return null;
  const normalized = normalizeDigits(value).trim();
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(normalized) ? normalized : null;
}

app.post('/api/admin/delivery-zones', requireCapability('delivery.manage'), async (req, res) => {
  let branchId;
  try { branchId = parseBranchId(req); } catch (error) {
    return res.status(error.status || 400).json({ error: error.code || 'branch_invalid', message: error.message });
  }
  if (branchId == null) return res.status(400).json({ error: 'branch_required' });
  return serializeAdminConfigMutation(branchId, async () => {
    const zone = cleanDeliveryZone({ ...(req.body || {}), branchId });
    if (!zone.name) return res.status(400).json({ error: 'نام محدوده لازم است' });
    const hadZones = Array.isArray(db.deliveryZones);
    db.deliveryZones = hadZones ? db.deliveryZones : [];
    db.deliveryZones.push(zone);
    const auditLogWasPresent = Array.isArray(db.auditLog);
    let auditEntry;
    try {
      auditEntry = recordAudit(req, 'delivery_zone.created', 'delivery_zone', zone.id, { name: zone.name }, zone.branchId, { deferAppend: true });
      await persistAdminConfigMutation(() => {
        db.deliveryZones = (db.deliveryZones || []).filter((candidate) => candidate !== zone);
        if (!hadZones && db.deliveryZones.length === 0) delete db.deliveryZones;
        rollbackAuditEntry(auditEntry, auditLogWasPresent);
      });
    } catch (error) {
      return respondAdminConfigPersistenceFailure(res, error, 'delivery_zone_persistence_failed');
    }
    appendAuditAfterCommit(auditEntry);
    try { publishOperationalEvent('delivery_zone.updated', { zoneId: zone.id, branchId: zone.branchId }); }
    catch (eventError) { console.error('[delivery-zone-create] post-commit event failed', eventError?.message || eventError); }
    return res.status(201).json({ ok: true, zone });
  });
});

app.patch('/api/admin/delivery-zones/:id', requireCapability('delivery.manage'), async (req, res) => {
  const targetId = Number(normalizeDigits(String(req.params.id || '')).replace(/\D/g, ''));
  const initial = (db.deliveryZones || []).find((item) => Number(item.id) === targetId);
  if (!initial) return res.status(404).json({ error: 'not found' });
  const initialBranchId = Number(initial.branchId) || Number(defaultBranch()?.id) || 1;
  try { assertUserBranchAccess(req.user, initialBranchId); } catch (error) {
    return res.status(error.status || 403).json({ error: error.code || 'branch_access_denied', message: error.message, requestId: req.requestId });
  }
  return serializeAdminConfigMutation(initialBranchId, async () => {
    const current = (db.deliveryZones || []).find((item) => Number(item.id) === targetId);
    if (!current) return res.status(404).json({ error: 'not found' });
    const currentBranchId = Number(current.branchId) || Number(defaultBranch()?.id) || 1;
    try { assertUserBranchAccess(req.user, currentBranchId); } catch (error) {
      return res.status(error.status || 403).json({ error: error.code || 'branch_access_denied', message: error.message, requestId: req.requestId });
    }
    if (currentBranchId !== initialBranchId) return res.status(409).json({ error: 'delivery_zone_changed', message: 'محدودهٔ ارسال هنگام ویرایش تغییر کرده است؛ صفحه را تازه کنید.' });
    if (requestBranchValue(req) != null && Number(parseBranchId(req)) !== currentBranchId) {
      return res.status(409).json({ error: 'delivery_zone_branch_immutable', message: 'محدودهٔ ارسال را نمی‌توان به شعبهٔ دیگری منتقل کرد.' });
    }
    const zone = cleanDeliveryZone({ ...(req.body || {}), branchId: currentBranchId }, current);
    if (!zone.name) return res.status(400).json({ error: 'نام محدوده لازم است' });
    const before = { ...current };
    Object.assign(current, zone);
    const auditLogWasPresent = Array.isArray(db.auditLog);
    let auditEntry;
    try {
      auditEntry = recordAudit(req, 'delivery_zone.updated', 'delivery_zone', current.id, { name: current.name }, current.branchId, { deferAppend: true });
      await persistAdminConfigMutation(() => {
        for (const key of Object.keys(current)) delete current[key];
        Object.assign(current, before);
        rollbackAuditEntry(auditEntry, auditLogWasPresent);
      });
    } catch (error) {
      return respondAdminConfigPersistenceFailure(res, error, 'delivery_zone_persistence_failed');
    }
    appendAuditAfterCommit(auditEntry);
    try { publishOperationalEvent('delivery_zone.updated', { zoneId: current.id, branchId: current.branchId }); }
    catch (eventError) { console.error('[delivery-zone-update] post-commit event failed', eventError?.message || eventError); }
    return res.json({ ok: true, zone: current });
  });
});

app.delete('/api/admin/delivery-zones/:id', requireCapability('delivery.manage'), async (req, res) => {
  const targetId = Number(normalizeDigits(String(req.params.id || '')).replace(/\D/g, ''));
  const initial = (db.deliveryZones || []).find((item) => Number(item.id) === targetId);
  if (!initial) return res.status(404).json({ error: 'not found' });
  const initialBranchId = Number(initial.branchId) || Number(defaultBranch()?.id) || 1;
  try { assertUserBranchAccess(req.user, initialBranchId); } catch (error) {
    return res.status(error.status || 403).json({ error: error.code || 'branch_access_denied', message: error.message, requestId: req.requestId });
  }
  return serializeAdminConfigMutation(initialBranchId, async () => {
    const zones = db.deliveryZones || [];
    const index = zones.findIndex((item) => Number(item.id) === targetId);
    if (index < 0) return res.status(404).json({ error: 'not found' });
    const zone = zones[index];
    const zoneBranchId = Number(zone.branchId) || Number(defaultBranch()?.id) || 1;
    try { assertUserBranchAccess(req.user, zoneBranchId); } catch (error) {
      return res.status(error.status || 403).json({ error: error.code || 'branch_access_denied', message: error.message, requestId: req.requestId });
    }
    if (zoneBranchId !== initialBranchId) return res.status(409).json({ error: 'delivery_zone_changed', message: 'محدودهٔ ارسال هنگام حذف تغییر کرده است؛ صفحه را تازه کنید.' });
    db.deliveryZones = zones.filter((item) => item !== zone);
    const auditLogWasPresent = Array.isArray(db.auditLog);
    let auditEntry;
    try {
      auditEntry = recordAudit(req, 'delivery_zone.deleted', 'delivery_zone', zone.id, { name: zone.name }, zone.branchId, { deferAppend: true });
      await persistAdminConfigMutation(() => {
        const currentZones = db.deliveryZones || (db.deliveryZones = []);
        if (!currentZones.includes(zone)) currentZones.splice(Math.min(index, currentZones.length), 0, zone);
        rollbackAuditEntry(auditEntry, auditLogWasPresent);
      });
    } catch (error) {
      return respondAdminConfigPersistenceFailure(res, error, 'delivery_zone_persistence_failed');
    }
    appendAuditAfterCommit(auditEntry);
    try { publishOperationalEvent('delivery_zone.updated', { zoneId: zone.id, branchId: zone.branchId, deleted: true }); }
    catch (eventError) { console.error('[delivery-zone-delete] post-commit event failed', eventError?.message || eventError); }
    return res.json({ ok: true });
  });
});

app.get('/api/admin/payments', requireCapability('payments.manage'), (req, res) => {
  const branchId = parseBranchId(req);
  const limit = Math.max(1, Math.min(200, Number(req.query.limit) || 80));
  res.json({
    provider: paymentProviderPublicStatus(db.paymentProvider, {
      nodeEnv: process.env.NODE_ENV,
      providerReady: productionPaymentProviderReady(),
    }),
    payments: branchScoped(db.paymentAttempts || [], branchId).slice(0, limit).map(publicPaymentAttempt),
  });
});

function maybeAwardOrderLoyalty(order) {
  if (!order) return;
  if (!order.loyaltyAwarded && db.loyalty?.enabled) {
  const phone = normalizeDigits(order.phone || '').trim();
  const user = PHONE_RE.test(phone)
    ? db.users.find((candidate) => candidate.phone === phone && effectiveRole(candidate) === 'user')
    : null;
  if (user) {
    const resolved = loyaltyEngine.resolveCustomerTier(db, user);
    let pts = loyaltyEngine.calculateOrderPointsEarned(db, order.total, resolved.tier);

    // Happy Hour multiplier
    const hh = campaignsEngine.checkHappyHourStatus(db);
    if (hh.active && hh.pointsMultiplier > 1.0) {
      pts = Math.round(pts * hh.pointsMultiplier);
    }

    if (pts > 0) {
      awardLoyaltyPoints(phone, pts, 'order', {
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

      // Notification delivery is best-effort; an async SMS rejection must
      // never turn a committed service completion into a failed HTTP request.
      try {
        const userBal = walletEngine.getWalletBalance(db, phone);
        Promise.resolve(smsEngine.sendSms(db, {
          phone,
          name: order.name || user.name || '',
          templateKey: 'points_awarded',
          vars: {
            name: order.name || user.name || 'مشتری گرامی',
            points: pts,
            total_points: user.points,
            wallet_balance: userBal,
            tier: resolved.tier.name,
          },
          triggerType: 'event',
        })).catch(() => {});
      } catch (_) {}
    }
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

  // Behavioral milestone points are created only as part of a real order
  // completion transition. Reads of /api/loyalty/me are strictly read-only.
  if (!db.loyalty?.enabled || !loyaltyAchievements.isValidCompletedOrder(order)) return;
  const member = (db.users || []).find((candidate) => effectiveRole(candidate) === 'user'
    && loyaltyAchievements.orderBelongsToMember(order, candidate));
  if (!member || !member.phone) return;
  const memberKey = member.id !== undefined && member.id !== null
    ? `user:${String(member.id)}`
    : `phone:${loyaltyAchievements.normalizePhoneKey(member.phone)}`;
  if (!Array.isArray(db.loyaltyAchievementAwards)) db.loyaltyAchievementAwards = [];
  const linkedOrders = (db.orders || []).filter((candidate) => loyaltyAchievements.orderBelongsToMember(candidate, member));
  const achievements = loyaltyAchievements.getLoyaltyAchievements(db);
  const context = {
    menuItems: db.menuItems || [],
    branches: db.branches || [],
    fallbackTimeZone: db.settings?.businessTimeZone || db.settings?.timezone || loyaltyAchievements.FALLBACK_TIME_ZONE,
  };
  for (const achievement of achievements) {
    if (!achievement.enabled || achievement.rewardPoints <= 0) continue;
    const progress = loyaltyAchievements.evaluateAchievement(achievement, linkedOrders, context);
    if (!loyaltyAchievements.isRewardEligibleAtLaunch(achievement, progress, order.id)) continue;
    const awardKey = `${memberKey}:${achievement.id}`;
    loyaltyAchievements.recordAchievementAwardOnce(db.loyaltyAchievementAwards, {
      key: awardKey,
      memberKey,
      achievementId: achievement.id,
      orderId: order.id,
      points: achievement.rewardPoints,
    }, () => awardLoyaltyPoints(member.phone, achievement.rewardPoints, 'achievement', {
      achievementId: achievement.id,
      achievementName: achievement.name,
      memberKey,
      orderId: order.id,
      oneTime: true,
    }));
  }
}

app.post('/api/delivery/orders/:id/accept', requireCapability('delivery.manage'), async (req, res) => {
  const targetId = Number(normalizeDigits(String(req.params.id || '')).replace(/\D/g, ''));
  if (!Number.isSafeInteger(targetId) || targetId <= 0) return res.status(400).json({ error: 'order_id_invalid' });
  const initial = (db.orders || []).find((item) => Number(item.id) === targetId);
  if (!initial) return res.status(404).json({ error: 'not found' });
  const initialBranchId = Number(initial.branchId);
  if (!Number.isSafeInteger(initialBranchId) || initialBranchId <= 0) return res.status(409).json({ error: 'order_branch_invalid' });
  if (!(db.branches || []).some((branch) => Number(branch.id) === initialBranchId && branch.active !== false)) {
    return res.status(409).json({ error: 'order_branch_inactive' });
  }
  try {
    assertUserBranchAccess(req.user, initialBranchId);
  } catch (error) {
    return res.status(error.status || 403).json({ error: error.code || 'branch_access_denied', message: error.message, requestId: req.requestId });
  }
  const idempotencyKey = String(req.get('Idempotency-Key') || req.body?.idempotencyKey || '').trim();
  if (process.env.NODE_ENV === 'production' && !idempotencyKey) {
    return res.status(400).json({ error: 'delivery_acceptance_idempotency_required', message: 'برای پذیرش سفارش، کلید یکتای درخواست لازم است.' });
  }
  if (idempotencyKey && !ORDER_IDEMPOTENCY_KEY_RE.test(idempotencyKey)) {
    return res.status(400).json({ error: 'delivery_acceptance_idempotency_invalid' });
  }

  return serializeBranchOrderMutation(initial, async () => {
    const order = (db.orders || []).find((item) => Number(item.id) === targetId);
    if (!order) return res.status(404).json({ error: 'not found' });
    if (Number(order.branchId) !== initialBranchId) return res.status(409).json({ error: 'order_branch_changed' });
    try {
      assertUserBranchAccess(req.user, order.branchId);
    } catch (error) {
      return res.status(error.status || 403).json({ error: error.code || 'branch_access_denied', message: error.message, requestId: req.requestId });
    }
    if (normalizeFulfillment(order.fulfillment, { tableNo: order.tableNo }) !== 'delivery') {
      return res.status(409).json({ error: 'delivery_acceptance_not_applicable' });
    }
    if (order.deliveryAcceptance?.status === 'accepted') {
      const acceptance = validateDeliveryAcceptance(order);
      if (!acceptance.ok) {
        return res.status(409).json({ error: 'delivery_acceptance_provenance_invalid', message: 'پذیرش قبلی قابل انتساب و تأیید نیست؛ این سفارش نیازمند بررسی است.' });
      }
      if (idempotencyKey && acceptance.reference !== idempotencyKey) {
        return res.status(409).json({ error: 'delivery_acceptance_idempotency_conflict' });
      }
      return res.json({ ok: true, idempotent: true, order: operationalOrderResponse(order, req.user) });
    }
    if (idempotencyKey && (db.orders || []).some((candidate) =>
      Number(candidate.id) !== targetId
      && Number(candidate.branchId) === initialBranchId
      && String(candidate.deliveryAcceptance?.reference || '') === idempotencyKey)) {
      return res.status(409).json({ error: 'delivery_acceptance_idempotency_conflict' });
    }
    if (order.deliveryAcceptance?.status === 'rejected') {
      return res.status(409).json({ error: 'delivery_acceptance_rejected' });
    }
    const status = String(order.status || '');
    const kitchenWasStarted = Boolean(order.startedAt)
      || ['sent_to_kitchen', 'preparing', 'ready', 'dispatched', 'delivered'].includes(status)
      || (Array.isArray(order.statusHistory) && order.statusHistory.some((entry) => ['sent_to_kitchen', 'preparing', 'ready', 'dispatched', 'delivered'].includes(String(entry?.status || ''))));
    if (kitchenWasStarted) {
      return res.status(409).json({ error: 'delivery_acceptance_after_kitchen_start', message: 'پذیرش باید پیش از ورود سفارش به آشپزخانه ثبت شود؛ این سفارش نیازمند بررسی سابقه است.' });
    }
    if (!['pending_online', 'awaiting_confirmation', 'pay_at_cashier', 'paid'].includes(status)) {
      return res.status(409).json({ error: 'delivery_acceptance_state_invalid', current: status });
    }

    const snapshot = snapshotFinanceMutationState();
    const acceptedAt = new Date().toISOString();
    const requestReference = String(req.requestId || '');
    const reference = idempotencyKey || (/^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$/.test(requestReference) ? requestReference : crypto.randomUUID());
    const deliveryAcceptance = {
      status: 'accepted',
      acceptedAt,
      acceptedBy: { phone: String(req.user.phone || ''), role: effectiveRole(req.user) },
      source: 'restaurant',
      reference,
    };
    const acceptance = validateDeliveryAcceptance({ fulfillment: 'delivery', deliveryAcceptance });
    if (!acceptance.ok) {
      return res.status(403).json({ error: 'delivery_acceptance_actor_invalid', message: 'حساب کاربری مجاز برای پذیرش سفارش معتبر نیست.' });
    }
    order.deliveryAcceptance = deliveryAcceptance;
    const nextStatus = nextOrderStatusAfterDeliveryAcceptance(order);
    if (nextStatus && canTransitionOrder(order, nextStatus)) {
      appendOrderStatus(order, nextStatus, req.user, { source: 'restaurant-delivery-acceptance', acceptanceReference: reference });
    }
    recordAudit(req, 'delivery.order_accepted', 'order', order.id, {
      reference,
      previousStatus: status,
      resultingStatus: order.status,
      paymentStatus: paymentStatusFor(order),
    }, order.branchId);
    try {
      await persistFinanceMutation(snapshot);
    } catch (error) {
      return res.status(error.status || 503).json({ error: error.code || 'delivery_acceptance_persistence_failed', message: error.message });
    }
    try {
      publishOperationalEvent('order.updated', { orderId: order.id, branchId: order.branchId, status: order.status, deliveryAcceptance: 'accepted' });
      neemBridge.enqueueOrder(order, (db.paymentAttempts || []).find((item) => Number(item.orderId) === Number(order.id)) || null);
    } catch (error) {
      console.error('[delivery-acceptance] post-commit event failed', error?.message || error);
    }
    return res.json({ ok: true, idempotent: false, order: operationalOrderResponse(order, req.user) });
  }).catch((error) => {
    console.error('[delivery-acceptance] mutation failed', error?.message || error);
    if (res.headersSent) return undefined;
    return res.status(error.status || 503).json({ error: error.code || 'delivery_acceptance_failed', message: error.message || 'پذیرش سفارش ثبت نشد.' });
  });
});

app.post('/api/delivery/orders/:id/reject', requireCapability('delivery.manage'), async (req, res) => {
  const targetId = Number(normalizeDigits(String(req.params.id || '')).replace(/\D/g, ''));
  if (!Number.isSafeInteger(targetId) || targetId <= 0) return res.status(400).json({ error: 'order_id_invalid' });
  const initial = (db.orders || []).find((item) => Number(item.id) === targetId);
  if (!initial) return res.status(404).json({ error: 'not found' });
  const initialBranchId = persistedOrderBranchId(initial);
  if (!initialBranchId) return res.status(409).json({ error: 'order_branch_invalid' });
  if (!(db.branches || []).some((branch) => Number(branch.id) === initialBranchId && branch.active !== false)) {
    return res.status(409).json({ error: 'order_branch_inactive' });
  }
  try {
    assertUserBranchAccess(req.user, initialBranchId);
  } catch (error) {
    return res.status(error.status || 403).json({ error: error.code || 'branch_access_denied', message: error.message, requestId: req.requestId });
  }

  const rawReason = typeof req.body?.reason === 'string' ? req.body.reason : '';
  const reason = rawReason.replace(/\r\n?/gu, '\n').trim();
  if (!reason || reason.length > 500 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(reason)) {
    return res.status(400).json({ error: 'delivery_rejection_reason_required', message: 'دلیل رد سفارش را کوتاه و روشن وارد کنید.' });
  }
  const idempotencyKey = String(req.get?.('Idempotency-Key') || req.body?.idempotencyKey || '').trim();
  if (idempotencyKey && !ORDER_IDEMPOTENCY_KEY_RE.test(idempotencyKey)) {
    return res.status(400).json({ error: 'delivery_rejection_idempotency_invalid' });
  }

  return serializeBranchOrderMutation(initial, async () => {
    const order = (db.orders || []).find((item) => Number(item.id) === targetId);
    if (!order) return res.status(404).json({ error: 'not found' });
    if (persistedOrderBranchId(order) !== initialBranchId) return res.status(409).json({ error: 'order_branch_changed' });
    try {
      assertUserBranchAccess(req.user, initialBranchId);
    } catch (error) {
      return res.status(error.status || 403).json({ error: error.code || 'branch_access_denied', message: error.message, requestId: req.requestId });
    }
    if (normalizeFulfillment(order.fulfillment, { tableNo: order.tableNo }) !== 'delivery') {
      return res.status(409).json({ error: 'delivery_rejection_not_applicable' });
    }

    const priorDecision = order.deliveryAcceptance;
    if (priorDecision?.status === 'rejected') {
      const provenanceValid = priorDecision.source === 'restaurant'
        && typeof priorDecision.reason === 'string' && priorDecision.reason.trim()
        && Number.isFinite(Date.parse(priorDecision.rejectedAt || ''))
        && /^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$/u.test(String(priorDecision.reference || ''))
        && typeof priorDecision.rejectedBy?.phone === 'string' && priorDecision.rejectedBy.phone.trim()
        && ['owner', 'manager', 'cashier'].includes(String(priorDecision.rejectedBy.role || '').toLowerCase());
      if (!provenanceValid) return res.status(409).json({ error: 'delivery_rejection_provenance_invalid' });
      if (priorDecision.reason !== reason || (idempotencyKey && priorDecision.reference !== idempotencyKey)) {
        return res.status(409).json({ error: 'delivery_rejection_idempotency_conflict' });
      }
      const auditExists = (db.auditLog || []).some((entry) => entry.action === 'delivery.order_rejected'
        && String(entry.targetId) === String(order.id)
        && String(entry.meta?.reference || '') === String(priorDecision.reference));
      if (!auditExists) {
        const auditSnapshot = snapshotFinanceMutationState();
        const auditEntry = recordAudit(req, 'delivery.order_rejected', 'order', order.id, {
          reference: priorDecision.reference, reason: priorDecision.reason,
          recoveredAfterCommit: true,
        }, initialBranchId, { deferAppend: true });
        try {
          await persistFinanceMutation(auditSnapshot);
        } catch (error) {
          return res.status(error.status || 503).json({ error: error.code || 'delivery_rejection_audit_persistence_failed' });
        }
        appendAuditAfterCommit(auditEntry);
      }
      return res.json({ ok: true, idempotent: true, order: operationalOrderResponse(order, req.user) });
    }
    if (priorDecision?.status === 'accepted') {
      return res.status(409).json({ error: 'delivery_already_accepted' });
    }

    const status = String(order.status || '').trim().toLowerCase();
    const kitchenWasStarted = Boolean(order.startedAt)
      || ['sent_to_kitchen', 'preparing', 'ready', 'dispatched', 'delivered'].includes(status)
      || (Array.isArray(order.statusHistory) && order.statusHistory.some((entry) =>
        ['sent_to_kitchen', 'preparing', 'ready', 'dispatched', 'delivered'].includes(String(entry?.status || '').toLowerCase())));
    if (kitchenWasStarted) {
      return res.status(409).json({ error: 'delivery_rejection_after_kitchen_start' });
    }
    if (!['pending_online', 'awaiting_confirmation', 'pay_at_cashier', 'paid'].includes(status)) {
      return res.status(409).json({ error: 'delivery_rejection_state_invalid', current: order.status });
    }

    const actorRole = String(effectiveRole(req.user) || '').trim().toLowerCase();
    const actorPhone = String(req.user?.phone || '').trim();
    if (!actorPhone || actorPhone.length > 64 || !['owner', 'manager', 'cashier'].includes(actorRole)) {
      return res.status(403).json({ error: 'delivery_rejection_actor_invalid' });
    }
    const referenceFromRequest = String(req.requestId || '');
    const reference = idempotencyKey
      || (/^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$/u.test(referenceFromRequest) ? referenceFromRequest : crypto.randomUUID());
    if ((db.orders || []).some((candidate) => Number(candidate.id) !== targetId
      && Number(candidate.branchId) === initialBranchId
      && String(candidate.deliveryAcceptance?.reference || '') === reference)) {
      return res.status(409).json({ error: 'delivery_rejection_idempotency_conflict' });
    }

    const snapshot = snapshotFinanceMutationState();
    order.deliveryAcceptance = {
      status: 'rejected',
      source: 'restaurant',
      rejectedAt: new Date().toISOString(),
      rejectedBy: { phone: actorPhone, role: actorRole },
      reason,
      reference,
    };
    try {
      await persistFinanceMutation(snapshot);
    } catch (error) {
      return res.status(error.status || 503).json({
        error: error.code || 'delivery_rejection_persistence_failed',
        message: 'رد سفارش ذخیره نشد؛ وضعیت قبلی حفظ شد.',
      });
    }

    const auditSnapshot = snapshotFinanceMutationState();
    const auditEntry = recordAudit(req, 'delivery.order_rejected', 'order', order.id, {
      reference, reason, previousStatus: status,
    }, initialBranchId, { deferAppend: true });
    try {
      await persistFinanceMutation(auditSnapshot);
    } catch (error) {
      return res.status(error.status || 503).json({
        error: error.code || 'delivery_rejection_audit_persistence_failed',
        message: 'رد سفارش ثبت شد اما ثبت سابقه کامل نشد؛ وضعیت را تازه و دوباره بررسی کنید.',
      });
    }
    appendAuditAfterCommit(auditEntry);
    let eventPublished = true;
    try {
      publishOperationalEvent('order.updated', {
        orderId: order.id, branchId: initialBranchId, status: order.status, deliveryAcceptance: 'rejected',
      });
    } catch (error) {
      eventPublished = false;
      console.error('[delivery-rejection] committed event failed', error?.message || error);
    }
    return res.json({ ok: true, idempotent: false, eventPublished, order: operationalOrderResponse(order, req.user) });
  }).catch((error) => {
    if (res.headersSent) return undefined;
    return res.status(error.status || 503).json({ error: error.code || 'delivery_rejection_failed', message: error.message });
  });
});

app.patch('/api/admin/orders/:id', requireCapability('orders.manage'), serializeOrderMutationRoute(async (req, res) => {
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
  const status = String(req.body?.status || '');
  if (!allowed.includes(status)) return res.status(400).json({ error: 'order_status_invalid' });
  if (status === 'paid' && order.paymentStatus !== 'paid') {
    return res.status(409).json({ error: 'payment_settlement_required', message: 'پرداخت را از مسیر تسویه ثبت کنید؛ تغییر وضعیت سفارش رسید دریافت وجه نیست.' });
  }
  if (status === String(order.status || '')) return res.json({ ok: true, idempotent: true, order: operationalOrderResponse(order, req.user) });
  if (status === 'cancelled') {
    const cancellation = orderCancellationGuard(order);
    if (!cancellation.ok) return res.status(409).json({ error: cancellation.code, message: cancellation.message });
  }
  if (!canTransitionOrder(order, status)) {
    return res.status(409).json({ error: 'order_transition_invalid', current: order.status, allowed: allowedOrderTransitions(order) });
  }
  const snapshot = snapshotFinanceMutationState();
  try {
    if (status === 'cancelled' && shouldReleaseOrderInventory(order)) {
      adjustOrderInventory(order.items, 1, order.branchId);
    }
    appendOrderStatus(order, status, req.user, { source: 'legacy-admin' });
    if (status === 'cancelled') {
      reverseCancelledOrderFinancialEffects(order, req.user);
    }
    if (['done', 'picked_up', 'delivered'].includes(status)) maybeAwardOrderLoyalty(order);
    recordAudit(req, 'order.status_changed', 'order', order.id, { status, source: 'legacy-admin' }, order.branchId);
    await persistFinanceMutation(snapshot);
  } catch (error) {
    restoreFinanceMutationState(snapshot);
    return res.status(error.status || 503).json({ error: error.code || error.message });
  }
  try {
    publishOperationalEvent('order.updated', { orderId: order.id, branchId: order.branchId, status: order.status });
    neemBridge.enqueueOrder(order, (db.paymentAttempts || []).find((item) => Number(item.orderId) === Number(order.id)) || null);
  } catch (error) { console.error('[order-post-commit] integration effect failed', error?.message || error); }
  res.json({ ok: true, order: operationalOrderResponse(order, req.user) });
}));

// Versioned endpoint for new clients: order progress follows the state machine;
// payment status is only changed by a verified settlement/payment command.
app.patch('/api/v2/orders/:id/status', requireCapability('orders.manage'), serializeOrderMutationRoute(async (req, res) => {
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
  if (status === 'paid' && order.paymentStatus !== 'paid') {
    return res.status(409).json({ error: 'payment_settlement_required', message: 'پرداخت را از مسیر تسویه ثبت کنید؛ تغییر وضعیت سفارش رسید دریافت وجه نیست.' });
  }
  if (status === String(order.status || '')) return res.json({ ok: true, idempotent: true, order: operationalOrderResponse(order, req.user) });
  if (status === 'cancelled') {
    const cancellation = orderCancellationGuard(order);
    if (!cancellation.ok) return res.status(409).json({ error: cancellation.code, message: cancellation.message });
  }
  if (!canTransitionOrder(order, status)) {
    return res.status(409).json({ error: 'order_transition_invalid', current: order.status, allowed: allowedOrderTransitions(order) });
  }
  const snapshot = snapshotFinanceMutationState();
  try {
    if (status === 'cancelled' && shouldReleaseOrderInventory(order)) {
      adjustOrderInventory(order.items, 1, order.branchId);
    }
    appendOrderStatus(order, status, req.user, { source: 'v2' });
    if (status === 'cancelled') {
      reverseCancelledOrderFinancialEffects(order, req.user);
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
  res.json({ ok: true, order: operationalOrderResponse(order, req.user) });
}));

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

function kitchenHeldCourseItems(order) {
  return (order.items || []).filter((item) => String(item.courseStatus || 'fired').toLowerCase() === 'hold');
}

function kitchenLines(order, { onlyHeld = false } = {}) {
  const kds = ensureKdsState(order);
  const categories = new Map((db.menuCategories || []).map((entry) => [Number(entry.id), entry]));
  const menu = new Map((db.menuItems || []).map((entry) => [Number(entry.id), entry]));
  const lines = [];
  (order.items || []).forEach((item, index) => {
    const isHeld = String(item.courseStatus || 'fired').toLowerCase() === 'hold';
    if (isHeld !== onlyHeld) return;
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
      courseStatus: isHeld ? 'hold' : item.courseStatus || 'fired',
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
        courseStatus: isHeld ? 'hold' : item.courseStatus || 'fired',
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

function elapsedSecondsSince(timestamp, now = Date.now()) {
  const timestampMs = timestamp instanceof Date
    ? timestamp.getTime()
    : typeof timestamp === 'number'
      ? timestamp
      : Date.parse(String(timestamp || ''));
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  if (!Number.isFinite(timestampMs) || !Number.isFinite(nowMs)) return null;
  return Math.max(0, Math.floor((nowMs - timestampMs) / 1000));
}

function isKdsPaymentStatusEligible(order) {
  const orderStatus = String(order?.status || '').trim().toLowerCase();
  const paymentStatus = String(paymentStatusFor(order) || '').trim().toLowerCase();
  if (!['sent_to_kitchen', 'preparing', 'ready', 'paid'].includes(orderStatus)) return false;
  if (!['unpaid', 'partial', 'failed', 'paid'].includes(paymentStatus)) return false;
  return orderStatus !== 'paid' || paymentStatus === 'paid';
}

function isKdsPaymentEligible(order) {
  return isKitchenOrderPaymentEligible(order, paymentStatusFor(order));
}

function summarizeKdsPaymentReview(orders, branchId) {
  const active = new Set(['sent_to_kitchen', 'paid', 'preparing', 'ready']);
  const summary = { blockedCount: 0, pendingCount: 0, unknownCount: 0, incompatibleCount: 0 };
  for (const order of Array.isArray(orders) ? orders : []) {
    if (Number(order?.branchId) !== Number(branchId) || !active.has(String(order?.status || '').trim().toLowerCase())) continue;
    if (isKdsPaymentStatusEligible(order)) continue;
    summary.blockedCount += 1;
    const paymentStatus = String(paymentStatusFor(order) || '').trim().toLowerCase();
    if (paymentStatus === 'pending') summary.pendingCount += 1;
    else if (paymentStatus === 'unknown' || !paymentStatus) summary.unknownCount += 1;
    else summary.incompatibleCount += 1;
  }
  return summary;
}

function kitchenTicket(order, now = Date.now()) {
  const kds = ensureKdsState(order);
  const lines = kitchenLines(order);
  const heldCourseItems = kitchenLines(order, { onlyHeld: true });
  const ageSec = elapsedSecondsSince(order.createdAt, now);
  const prepAgeSec = order.startedAt ? elapsedSecondsSince(order.startedAt, now) : 0;
  return {
    ...order,
    items: lines,
    heldCourseItems,
    column: kitchenColumn(order),
    ageSec,
    ageKnown: ageSec !== null,
    prepAgeSec,
    prepAgeKnown: prepAgeSec !== null,
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

function kdsMenuAvailabilityPayload(item, branchId) {
  const inventory = financeV2.menuItemAvailability(db, item.id, branchId);
  const override = menuAvailabilityOverride(db, item.id, branchId);
  const inventoryBlocked = (typeof item.stock === 'number' && item.stock <= 0)
    || (db.settings?.enforceInventoryStock === true && inventory?.tracked === true && inventory.available !== true);
  const manualAvailable = menuItemAvailableForBranch(db, item, branchId);
  const globallyAvailable = item.available !== false;
  return {
    id: item.id,
    name: item.name,
    available: manualAvailable && !inventoryBlocked,
    manualAvailable,
    globallyAvailable,
    inventoryBlocked,
    branchOverride: override.ok ? override.override?.available ?? null : null,
    station: kdsStationForMenuItem(item),
    categoryName: (db.menuCategories || []).find((entry) => Number(entry.id) === Number(item.categoryId))?.title || '',
  };
}

app.get('/api/kitchen/orders', requireKitchen, (req, res) => {
  // Only confirmed orders reach the kitchen. Cash collection, cancellation and
  // fulfilment remain cashier/manager actions and cannot be bypassed from KDS.
  const active = ['sent_to_kitchen', 'paid', 'preparing', 'ready'];
  const bid = requestedKdsBranch(req);
  if (!bid) return res.status(400).json({ error: 'branch_invalid' });
  const now = Date.now();
  const branchOrders = (db.orders || []).filter((order) => Number(order.branchId) === Number(bid));
  const queuePaymentEligible = (order) => {
    if (normalizeFulfillment(order?.fulfillment, { tableNo: order?.tableNo }) === 'delivery' && !hasAcceptedDelivery(order)) return false;
    return isKdsPaymentEligible(order);
  };
  const activeTickets = branchOrders
    .filter((o) => active.includes(o.status) && queuePaymentEligible(o))
    .filter((o) => kitchenLines(o).length > 0 || kitchenLines(o, { onlyHeld: true }).length > 0)
    .map((o) => kitchenTicket(o, now));
  // Keep active legacy deliveries visible as aggregate blockers, without
  // putting their customer/order details into the kitchen ticket list.
  const acceptanceReviewTickets = branchOrders
    .filter((order) => active.includes(order.status)
      && normalizeFulfillment(order?.fulfillment, { tableNo: order?.tableNo }) === 'delivery'
      && !hasAcceptedDelivery(order))
    .map((order) => ({
      id: order.id,
      branchId: order.branchId,
      status: order.status,
      fulfillment: 'delivery',
      paymentStatus: paymentStatusFor(order),
      deliveryAcceptance: {
        status: String(order.deliveryAcceptance?.status || 'pending').trim().toLowerCase(),
      },
    }));

  // A cancellation is visible to KDS only if the order had entered a state
  // that the active kitchen queue accepts. Keep the review window explicit;
  // undated legacy cancellations remain visible but are labelled as unknown.
  const cancellationCutoff = now - 24 * 60 * 60 * 1000;
  const cancelledTicketsForQueue = branchOrders
    .filter((order) => String(order.status || '').toLowerCase() === 'cancelled')
    .filter((order) => (Array.isArray(order.statusHistory) && order.statusHistory.some((entry) => active.includes(String(entry?.status || '').toLowerCase())))
      || !!(order.startedAt || order.readyAt))
    .map((order) => {
      const cancellationEvent = [...(Array.isArray(order.statusHistory) ? order.statusHistory : [])]
        .reverse()
        .find((entry) => String(entry?.status || '').toLowerCase() === 'cancelled');
      const statusCancelledAt = order.statusAt ? new Date(order.statusAt).getTime() : NaN;
      const eventCancelledAt = cancellationEvent?.at ? new Date(cancellationEvent.at).getTime() : NaN;
      const parsedCancelledAt = Number.isFinite(statusCancelledAt) ? statusCancelledAt : eventCancelledAt;
      const isRecent = Number.isFinite(parsedCancelledAt)
        ? parsedCancelledAt >= cancellationCutoff && parsedCancelledAt <= now
        : true;
      if (!isRecent) return null;

      // kitchenTicket/ensureKdsState normalizes KDS state. Clone this terminal
      // order's KDS shell so a read of the cancellation lane never mutates db.
      const snapshot = {
        ...order,
        kds: {
          ...(order.kds && typeof order.kds === 'object' ? order.kds : {}),
          itemStates: { ...(order.kds?.itemStates && typeof order.kds.itemStates === 'object' ? order.kds.itemStates : {}) },
        },
      };
      const ticket = kitchenTicket(snapshot, now);
      const items = [...(ticket.items || []), ...(ticket.heldCourseItems || [])];
      if (!items.length) return null;
      return {
        id: order.id,
        orderNo: order.orderNo || `#${order.id}`,
        branchId: order.branchId,
        fulfillment: order.fulfillment || (order.tableNo ? 'dine_in' : 'pickup'),
        tableNo: order.tableNo || null,
        createdAt: order.createdAt || null,
        cancelledAt: Number.isFinite(parsedCancelledAt) ? new Date(parsedCancelledAt).toISOString() : null,
        note: order.note || '',
        kitchenNote: order.kitchenNote || '',
        items,
        column: 'cancelled',
      };
    })
    .filter(Boolean);

  const queue = prepareKitchenQueue([...activeTickets, ...acceptanceReviewTickets, ...cancelledTicketsForQueue], { branchId: bid });
  const { tickets, cancelledTickets, counts } = queue;
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
  res.json({
    tickets,
    cancelledTickets,
    cancellationWindowHours: 24,
    counts,
    paymentReview: summarizeKdsPaymentReview(branchOrders, bid),
    stations: KDS_STATIONS.map((entry) => ({ ...entry, count: entry.id === 'expo' ? tickets.filter((ticket) => ticket.column !== 'ready').length : Number(stationCounts[entry.id] || 0) })),
    allDay: [...allDayMap.values()].sort((a, b) => b.qty - a.qty || String(a.name).localeCompare(String(b.name), 'fa')),
    availability: (db.menuItems || [])
      .filter((item) => menuItemBelongsToBranch(item, bid))
      .map((item) => kdsMenuAvailabilityPayload(item, bid))
      .sort((a, b) => String(a.name).localeCompare(String(b.name), 'fa')),
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

app.patch('/api/kitchen/orders/:id', requireCapability('kitchen.manage'), serializeOrderMutationRoute(async (req, res) => {
  const branchId = requestedKdsBranch(req);
  if (!branchId) return res.status(400).json({ error: 'branch_invalid' });
  const targetId = Number(normalizeDigits(String(req.params.id || '')).replace(/\D/g, ''));
  const order = (db.orders || []).find((o) => Number(o.id) === targetId && Number(o.branchId) === Number(branchId));
  if (!order) return res.status(404).json({ error: 'not found' });
  if (normalizeFulfillment(order.fulfillment, { tableNo: order.tableNo }) === 'delivery' && !hasAcceptedDelivery(order)) {
    return res.status(409).json({ error: 'delivery_acceptance_required', message: 'این سفارش تا ثبت پذیرش رستوران وارد آشپزخانه نمی‌شود.' });
  }
  if (!isKitchenOrderPaymentEligible(order, paymentStatusFor(order))) {
    return res.status(409).json({ error: 'payment_reconciliation_required', message: 'وضعیت پرداخت این سفارش باید پیش از ورود به صف آشپزخانه تطبیق شود.' });
  }
  const legacyStatus = String(req.body?.status || '');
  const requestedAction = String(req.body?.action || '');
  const actionName = requestedAction || (legacyStatus === 'preparing' ? 'start_ticket' : legacyStatus === 'ready' ? 'complete_ticket' : '');
  const snapshot = snapshotFinanceMutationState();
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
    if (!lines.length) return res.status(409).json({ error: 'kds_ticket_incomplete', incomplete: (order.items || []).map((item, index) => kdsLineKey(item, index)) });
    start();
  } else if (actionName === 'complete_item') {
    if (!line) return res.status(409).json({ error: 'kds_item_invalid', lineKey, current: order.status });
    // A lost response after the final item completed must be safely retryable
    // even though that completion already moved the ticket to `ready`.
    if (kds.itemStates[lineKey]?.completedAt) return res.json(kdsIdempotent(order));
    if (order.status === 'ready') return res.status(409).json({ error: 'kds_item_invalid', lineKey, current: order.status });
    start();
    kds.itemStates[lineKey] = { completedAt: now, completedBy: actor };
    const allComplete = kitchenHeldCourseItems(order).length === 0
      && kitchenLines(order).every((entry) => kds.itemStates[entry.key]?.completedAt);
    if (allComplete && order.status === 'preparing' && canTransitionOrder(order, 'ready')) {
      appendOrderStatus(order, 'ready', req.user, { source: 'kds', action: 'all_items_complete' });
      kds.completedAt = order.readyAt;
    }
  } else if (actionName === 'complete_station') {
    const station = String(req.body?.station || '');
    if (!['hot', 'cold', 'bar'].includes(station)) return res.status(409).json({ error: 'kds_station_invalid', station, current: order.status });
    const stationLines = lines.filter((entry) => entry.station === station);
    if (!stationLines.length) return res.status(409).json({ error: 'kds_station_empty', station });
    // A retried station completion is a no-op even when another station is
    // still working and the whole order remains `preparing`. Do not persist,
    // audit, or publish the same station completion again.
    if (stationLines.every((entry) => kds.itemStates[entry.key]?.completedAt)) return res.json(kdsIdempotent(order));
    if (order.status === 'ready') return res.status(409).json({ error: 'kds_station_invalid', station, current: order.status });
    start();
    for (const entry of stationLines) kds.itemStates[entry.key] = kds.itemStates[entry.key] || { completedAt: now, completedBy: actor };
    const allComplete = kitchenHeldCourseItems(order).length === 0
      && kitchenLines(order).every((entry) => kds.itemStates[entry.key]?.completedAt);
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
    const incomplete = lines.filter((entry) => !kds.itemStates[entry.key]?.completedAt);
    const heldKeys = (order.items || [])
      .map((item, index) => String(item.courseStatus || 'fired').toLowerCase() === 'hold' ? kdsLineKey(item, index) : null)
      .filter(Boolean);
    if (!lines.length || incomplete.length || heldKeys.length) {
      return res.status(409).json({ error: 'kds_ticket_incomplete', incomplete: [...incomplete.map((entry) => entry.key), ...heldKeys] });
    }
    // Validate the persisted ticket even for a replay. A stale/corrupt `ready`
    // status must not be acknowledged as complete when its items are not.
    if (order.status === 'ready') return res.json(kdsIdempotent(order));
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
  try {
    await persistFinanceMutation(snapshot);
  } catch (error) {
    return res.status(error.status || 503).json({ error: error.code || 'kds_persistence_failed', message: 'تغییر وضعیت آشپزخانه پایدار نشد؛ دوباره همگام‌سازی کنید.' });
  }
  let eventPublished = true;
  try {
    publishOperationalEvent('order.updated', { orderId: order.id, branchId: order.branchId, status: order.status, kdsAction: actionName });
  } catch (error) {
    eventPublished = false;
    console.error('[kds] committed state event failed', error?.message || error);
  }
  res.json({ ok: true, eventPublished, order: kitchenTicket(order) });
}));

app.patch('/api/kitchen/items/:id/availability', requireCapability('kitchen.manage'), async (req, res) => {
  const branchId = requestedKdsBranch(req);
  if (!branchId) return res.status(400).json({ error: 'branch_invalid' });
  const targetId = Number(normalizeDigits(String(req.params.id || '')).replace(/\D/g, ''));
  if (!Number.isSafeInteger(targetId) || targetId <= 0) return res.status(400).json({ error: 'menu_item_id_invalid' });
  const item = (db.menuItems || []).find((entry) => Number(entry.id) === targetId);
  if (!item || !menuItemBelongsToBranch(item, branchId)) return res.status(404).json({ error: 'not found' });
  if (typeof req.body?.available !== 'boolean') return res.status(400).json({ error: 'availability_invalid' });
  if (req.body.available && item.available === false) {
    return res.status(409).json({ error: 'menu_item_globally_unavailable', message: 'این کالا در کاتالوگ اصلی غیرفعال است؛ فعال‌سازی شعبه‌ای کافی نیست.' });
  }

  return serializeAdminConfigMutation(branchId, async () => {
    const snapshot = snapshotFinanceMutationState();
    const mutation = setMenuAvailabilityOverride(db, {
      menuItemId: item.id,
      branchId,
      available: req.body.available,
    });
    if (!mutation.ok) return res.status(409).json({ error: mutation.error });
    const auditEntry = recordAudit(req, 'kds.item_availability_changed', 'menu_item', item.id, {
      branchId, available: req.body.available,
    }, branchId, { deferAppend: true });
    try {
      await persistFinanceMutation(snapshot, { bumpMenu: true });
    } catch (error) {
      return res.status(error.status || 503).json({
        error: error.code || 'menu_availability_persistence_failed',
        message: 'تغییر موجودی شعبه ذخیره نشد؛ وضعیت قبلی حفظ شد.',
      });
    }

    appendAuditAfterCommit(auditEntry);
    let eventPublished = true;
    try {
      publishOperationalEvent('menu.availability_updated', {
        menuItemId: item.id, branchId, available: req.body.available,
      });
    } catch (error) {
      eventPublished = false;
      console.error('[kds] committed availability event failed', error?.message || error);
    }
    return res.json({
      ok: true,
      eventPublished,
      branchId,
      item: kdsMenuAvailabilityPayload(item, branchId),
    });
  }).catch((error) => {
    if (res.headersSent) return undefined;
    return res.status(error.status || 503).json({ error: error.code || 'menu_availability_update_failed' });
  });
});

/* ---- Call waiter (فراخوان گارسون) ---- */
app.post('/api/call-waiter', async (req, res) => {
  const tableNo = normalizeDigits(String(req.body.tableNo || '')).trim().slice(0, 20);
  if (!tableNo) return res.status(400).json({ error: 'شماره میز لازم است' });
  const note = String(req.body.note || '').trim().slice(0, 120);
  // Older clients omitted requestType; preserve their established meaning as
  // a service call while rejecting unknown types instead of silently losing
  // the request's intent.
  const requestType = String(req.body?.requestType ?? 'service').trim().toLowerCase();
  if (!['service', 'bill', 'supplies', 'other'].includes(requestType)) {
    return res.status(400).json({ error: 'waiter_call_request_type_invalid' });
  }
  const branchInput = normalizeDigits(String(req.body?.branchId ?? '')).trim();
  if (branchInput && !/^\d+$/u.test(branchInput)) {
    return res.status(400).json({ error: 'branch_invalid' });
  }
  const branchId = branchInput ? Number(branchInput) : Number(defaultBranch()?.id);
  if (!Number.isSafeInteger(branchId) || branchId <= 0
      || !(db.branches || []).some((branch) => Number(branch.id) === branchId && branch.active !== false)) {
    return res.status(400).json({ error: 'branch_invalid' });
  }
  const tableMatch = tableForBranch(tableNo, branchId)
    || (db.tables || []).find((table) => tableBranchId(table) === branchId
      && table.active !== false && tableNoBelongsToTable(tableNo, table.id));
  if (!tableMatch) return res.status(404).json({ error: 'waiter_call_table_not_found', message: 'میز فعال در شعبهٔ انتخاب‌شده پیدا نشد.' });
  if (tableMatch.active === false) return res.status(409).json({ error: 'waiter_call_table_inactive' });

  return serializeAdminConfigMutation(branchId, async () => {
    db.waiterCalls = Array.isArray(db.waiterCalls) ? db.waiterCalls : [];
    const activeCall = db.waiterCalls.find((call) => Number(call.branchId) === branchId
      && ['open', 'new'].includes(String(call.status || ''))
      && tableNoBelongsToTable(call.tableNo, tableMatch.id)
      && String(call.requestType || 'service').trim().toLowerCase() === requestType
      && String(call.note || '').trim().slice(0, 120) === note);
    if (activeCall) return res.json({ ok: true, idempotent: true, call: activeCall });

    const snapshot = snapshotFinanceMutationState();
    const numericIds = db.waiterCalls.map((call) => Number(call.id)).filter(Number.isSafeInteger);
    const call = {
      id: Math.max(0, ...numericIds) + 1,
      tableNo,
      requestType,
      note,
      branchId,
      status: 'open',
      createdAt: new Date().toISOString(),
    };
    db.waiterCalls.unshift(call);
    db.waiterCalls = db.waiterCalls.slice(0, 200);
    const auditEntry = recordAudit(req, 'waiter_call.created', 'waiter_call', call.id, {
      tableNo: call.tableNo, requestType: call.requestType, note: call.note,
    }, branchId, { deferAppend: true });
    try {
      await persistFinanceMutation(snapshot);
    } catch (error) {
      return res.status(error.status || 503).json({ error: error.code || 'waiter_call_persistence_failed', message: 'فراخوان ذخیره نشد؛ دوباره تلاش کنید.' });
    }

    appendAuditAfterCommit(auditEntry);
    let eventPublished = true;
    try {
      publishOperationalEvent('waiter_call.created', {
        callId: call.id,
        branchId: call.branchId,
        tableNo: call.tableNo,
        requestType: call.requestType,
        note: call.note,
      });
    } catch (error) {
      eventPublished = false;
      console.error('[waiter-call] committed event failed', error?.message || error);
    }
    return res.json({ ok: true, eventPublished, call });
  }).catch((error) => {
    if (res.headersSent) return undefined;
    return res.status(error.status || 503).json({ error: error.code || 'waiter_call_create_failed' });
  });
});

app.post('/api/call-waiter/cancel', async (req, res) => {
  const tableNo = normalizeDigits(String(req.body?.tableNo || '')).trim().slice(0, 20);
  const rawCallId = normalizeDigits(String(req.body?.callId ?? '')).trim();
  const branchInput = normalizeDigits(String(req.body?.branchId ?? '')).trim();
  if (!tableNo) return res.status(400).json({ error: 'شماره میز لازم است' });
  if (rawCallId && !/^\d+$/u.test(rawCallId)) return res.status(400).json({ error: 'call_id_invalid' });
  if (branchInput && !/^\d+$/u.test(branchInput)) return res.status(400).json({ error: 'branch_invalid' });
  const callId = rawCallId ? Number(rawCallId) : null;
  if (callId !== null && (!Number.isSafeInteger(callId) || callId <= 0)) {
    return res.status(400).json({ error: 'call_id_invalid' });
  }
  const branchId = branchInput ? Number(branchInput) : Number(defaultBranch()?.id);
  if (!Number.isSafeInteger(branchId) || branchId <= 0
      || !(db.branches || []).some((branch) => Number(branch.id) === branchId && branch.active !== false)) {
    return res.status(400).json({ error: 'branch_invalid' });
  }
  const tableMatch = tableForBranch(tableNo, branchId)
    || (db.tables || []).find((table) => tableBranchId(table) === branchId
      && table.active !== false && tableNoBelongsToTable(tableNo, table.id));
  if (!tableMatch || tableMatch.active === false) {
    return res.status(404).json({ error: 'waiter_call_table_not_found' });
  }

  return serializeAdminConfigMutation(branchId, async () => {
    db.waiterCalls = Array.isArray(db.waiterCalls) ? db.waiterCalls : [];
    const tableCallMatches = (call) => Number(call.branchId) === branchId
      && (tableNoBelongsToTable(call.tableNo, tableMatch.id)
        || Number(tableForBranch(call.tableNo, branchId)?.id) === Number(tableMatch.id));
    const call = callId === null
      ? db.waiterCalls.find((item) => ['open', 'new'].includes(String(item.status || '')) && tableCallMatches(item))
      : db.waiterCalls.find((item) => Number(item.id) === callId && tableCallMatches(item));
    if (!call) return res.status(404).json({ error: 'فراخوان بازی یافت نشد' });
    if (call.status === 'cancelled') return res.json({ ok: true, idempotent: true, call });
    if (!['open', 'new'].includes(String(call.status || ''))) {
      return res.status(409).json({ error: 'waiter_call_transition_invalid', current: call.status });
    }

    const snapshot = snapshotFinanceMutationState();
    call.status = 'cancelled';
    call.resolvedAt = new Date().toISOString();
    call.resolvedBy = 'guest';
    const auditEntry = recordAudit(req, 'waiter_call.cancelled', 'waiter_call', call.id, {
      tableNo: call.tableNo,
    }, branchId, { deferAppend: true });
    try {
      await persistFinanceMutation(snapshot);
    } catch (error) {
      return res.status(error.status || 503).json({
        error: error.code || 'waiter_call_persistence_failed',
        message: 'لغو فراخوان ذخیره نشد؛ دوباره تلاش کنید.',
      });
    }

    appendAuditAfterCommit(auditEntry);
    let eventPublished = true;
    try {
      publishOperationalEvent('waiter_call.updated', {
        callId: call.id, branchId: call.branchId, status: call.status,
      });
    } catch (error) {
      eventPublished = false;
      console.error('[waiter-call] committed cancellation event failed', error?.message || error);
    }
    return res.json({ ok: true, eventPublished, call });
  }).catch((error) => {
    if (res.headersSent) return undefined;
    return res.status(error.status || 503).json({ error: error.code || 'waiter_call_cancel_failed' });
  });
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
  const requestedStatus = req.body?.status;
  if (!['done', 'open'].includes(requestedStatus)) {
    return res.status(400).json({ error: 'kitchen_call_status_invalid', allowed: ['open', 'done'] });
  }
  if (call.status !== requestedStatus) {
    call.status = requestedStatus;
    call.resolvedAt = requestedStatus === 'done' ? new Date().toISOString() : null;
  }
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
app.get('/api/admin/users', requireOwner, (req, res) => {
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

const STAFF_BRANCH_ROLES = new Set(['manager', 'accountant', 'cashier', 'waiter', 'kitchen']);
const USER_ROLE_MAP = Object.freeze({ admin: 'owner', user: 'guest', owner: 'owner', manager: 'manager', accountant: 'accountant', cashier: 'cashier', waiter: 'waiter', kitchen: 'kitchen', guest: 'guest' });

function requestedBranchAssignments(body = {}, existingUser = null) {
  let rawIds;
  if (Array.isArray(body.allowedBranchIds)) rawIds = body.allowedBranchIds;
  else if (Object.prototype.hasOwnProperty.call(body, 'allowedBranchIds')) rawIds = [];
  else if (Object.prototype.hasOwnProperty.call(body, 'branchId')) rawIds = body.branchId == null || body.branchId === '' ? [] : [body.branchId];
  else if (Array.isArray(existingUser?.allowedBranchIds)) rawIds = existingUser.allowedBranchIds;
  else if (existingUser?.branchId != null && existingUser.branchId !== '') rawIds = [existingUser.branchId];
  else rawIds = [];

  const parsed = rawIds.map((value) => {
    const digits = normalizeDigits(String(value)).trim();
    const id = Number(digits);
    return /^\d+$/.test(digits) && Number.isSafeInteger(id) && id > 0 ? id : null;
  });
  if (parsed.some((id) => id == null)) {
    return { error: { status: 400, code: 'staff_branch_assignment_invalid', message: 'فهرست شعب شامل شناسهٔ نامعتبر است.' } };
  }
  return { ids: [...new Set(parsed)] };
}

function validateStaffBranchAssignments(actor, role, ids) {
  if (!Array.isArray(ids) || (STAFF_BRANCH_ROLES.has(role) && ids.length === 0)) {
    return { status: 400, code: 'staff_branch_assignment_required', message: 'برای کارمند حداقل یک شعبهٔ مجاز انتخاب کنید.' };
  }
  const activeBranchIds = new Set((db.branches || []).filter((branch) => branch.active !== false).map((branch) => Number(branch.id)));
  if (ids.some((id) => !activeBranchIds.has(Number(id)))) {
    return { status: 400, code: 'staff_branch_assignment_invalid', message: 'یکی از شعب انتخاب‌شده وجود ندارد یا غیرفعال است.' };
  }
  const actorScope = branchScopeForUser(actor, { role: effectiveRole(actor) });
  if (actorScope !== null && ids.some((id) => !actorScope.includes(Number(id)))) {
    return { status: 403, code: 'staff_branch_assignment_forbidden', message: 'فقط می‌توانید شعبه‌هایی را واگذار کنید که خودتان به آن‌ها دسترسی دارید.' };
  }
  return null;
}

app.post(['/api/admin/users', '/api/admin/customers'], requireAdmin, (req, res) => {
  const phone = normalizeDigits(req.body.phone || '').trim();
  const name = String(req.body.name || '').trim().slice(0, 120);
  if (!PHONE_RE.test(phone)) return res.status(400).json({ error: 'شماره موبایل معتبر نیست.' });
  if (!name) return res.status(400).json({ error: 'نام و نام خانوادگی لازم است.' });
  if (db.users.some((user) => user.phone === phone)) return res.status(409).json({ error: 'کاربری با این شماره قبلاً ثبت شده است.' });
  
  const requestedRole = String(req.body.role || 'user').trim().toLowerCase();
  const role = USER_ROLE_MAP[requestedRole] || 'guest';
  
  if (['owner', 'manager'].includes(role) && !isOwnerActor(db, req.user)) {
    return res.status(403).json({
      error: role === 'owner' ? 'staff_owner_protected' : 'staff_manager_protected',
      message: role === 'owner' ? 'حساب مالک فقط توسط مالک قابل ایجاد است.' : 'حساب مدیر فقط توسط مالک قابل ایجاد است.',
    });
  }

  const branchRequest = requestedBranchAssignments(req.body || {});
  if (branchRequest.error) return res.status(branchRequest.error.status).json({ error: branchRequest.error.code, message: branchRequest.error.message });
  let allowedBranchIds = branchRequest.ids;
  if (!Array.isArray(req.body?.allowedBranchIds) && !Object.prototype.hasOwnProperty.call(req.body || {}, 'branchId') && role === 'owner') allowedBranchIds = null;
  if (role !== 'owner') {
    const assignmentError = validateStaffBranchAssignments(req.user, role, allowedBranchIds || []);
    if (assignmentError) return res.status(assignmentError.status).json({ error: assignmentError.code, message: assignmentError.message });
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

  const requestedRole = String(req.body.role || '').trim().toLowerCase();
  const newRole = USER_ROLE_MAP[requestedRole] || null;
  if (newRole && newRole !== user.role && ['owner', 'manager'].includes(newRole) && !isOwnerActor(db, req.user)) {
    return res.status(403).json({
      error: newRole === 'owner' ? 'staff_owner_protected' : 'staff_manager_protected',
      message: newRole === 'owner' ? 'اعطای نقش مالک فقط توسط مالک امکان‌پذیر است.' : 'اعطای نقش مدیر فقط توسط مالک امکان‌پذیر است.',
    });
  }
  const branchAssignmentSpecified = Object.prototype.hasOwnProperty.call(req.body || {}, 'allowedBranchIds')
    || Object.prototype.hasOwnProperty.call(req.body || {}, 'branchId');
  let assignedBranchIds = null;
  const resultingRole = newRole || user.role;
  if (branchAssignmentSpecified || (newRole && newRole !== user.role && STAFF_BRANCH_ROLES.has(resultingRole))) {
    const branchRequest = requestedBranchAssignments(req.body || {}, user);
    if (branchRequest.error) return res.status(branchRequest.error.status).json({ error: branchRequest.error.code, message: branchRequest.error.message });
    const assignmentError = validateStaffBranchAssignments(req.user, resultingRole, branchRequest.ids);
    if (assignmentError) return res.status(assignmentError.status).json({ error: assignmentError.code, message: assignmentError.message });
    assignedBranchIds = branchRequest.ids;
  }

  if (typeof req.body.blocked === 'boolean') user.blocked = req.body.blocked;
  if (typeof req.body.name === 'string') user.name = req.body.name.trim();
  if (typeof req.body.email === 'string') user.email = req.body.email.trim();
  if (typeof req.body.notes === 'string') user.notes = req.body.notes.trim().slice(0, 500);
  if (Array.isArray(req.body.tags)) {
    user.tags = req.body.tags.map((t) => String(t).trim().slice(0, 30)).filter(Boolean);
  }
  if (typeof req.body.vipNote === 'string') {
    user.vipNote = req.body.vipNote.trim().slice(0, 300);
  }
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
  if (assignedBranchIds) user.allowedBranchIds = assignedBranchIds;
  if (typeof req.body.birthdate === 'string') {
    user.birthdate = req.body.birthdate.trim().slice(0, 50);
    user.birthdateUpdatedAt = new Date().toISOString();
    try { campaignsEngine.checkBirthdayEligibility(db, user); } catch (_) {}
  }
  if (newRole) user.role = newRole;
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
app.get('/api/admin/newsletter', requireOwner, (req, res) => {
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
app.put('/api/admin/hours', requireAdmin, async (req, res) => {
  const days = ['sat', 'sun', 'mon', 'tue', 'wed', 'thu', 'fri'];
  const incoming = req.body?.hours;
  if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
    return res.status(400).json({ error: 'hours_invalid', message: 'ساختار ساعت کاری معتبر نیست.' });
  }
  for (const day of days) {
    const value = incoming[day];
    if (value != null && (typeof value !== 'object' || Array.isArray(value))) {
      return res.status(400).json({ error: 'hours_invalid', message: 'ساختار ساعت کاری معتبر نیست.' });
    }
    for (const field of ['open', 'close']) {
      if (typeof value?.[field] !== 'string') continue;
      if (!validateAdminHoursTime(value[field])) {
        return res.status(400).json({ error: 'hours_time_invalid', day, field, message: 'ساعت باید در قالب ۲۴ ساعتهٔ ساعت:دقیقه باشد.' });
      }
    }
  }
  let branchId;
  try { branchId = parseBranchId(req); } catch (error) {
    return res.status(error.status || 400).json({ error: error.code || 'branch_invalid', message: error.message });
  }
  const branch = resolveBranchExact(branchId);
  if (!branch) return res.status(400).json({ error: 'شعبه یافت نشد' });
  return serializeAdminConfigMutation(branch.id, async () => {
    const currentBranch = resolveBranchExact(branch.id);
    if (!currentBranch) return res.status(409).json({ error: 'branch_changed', message: 'شعبه تغییر کرده است؛ صفحه را تازه کنید.' });
    const hadBranchHours = Object.prototype.hasOwnProperty.call(currentBranch, 'hours');
    const previousBranchHours = hadBranchHours ? JSON.parse(JSON.stringify(currentBranch.hours)) : undefined;
    const hadLegacyHours = Object.prototype.hasOwnProperty.call(db, 'hours');
    const previousLegacyHours = hadLegacyHours ? JSON.parse(JSON.stringify(db.hours)) : undefined;
    if (!currentBranch.hours || typeof currentBranch.hours !== 'object' || Array.isArray(currentBranch.hours)) {
      currentBranch.hours = defaultHoursTemplate();
    }
    for (const day of days) {
      if (!incoming[day]) continue;
      const current = currentBranch.hours[day] || { open: '10:00', close: '23:00', closed: false };
      if (typeof incoming[day].open === 'string') current.open = validateAdminHoursTime(incoming[day].open);
      if (typeof incoming[day].close === 'string') current.close = validateAdminHoursTime(incoming[day].close);
      if (typeof incoming[day].closed === 'boolean') current.closed = incoming[day].closed;
      currentBranch.hours[day] = current;
    }
    syncLegacyHours();
    const auditLogWasPresent = Array.isArray(db.auditLog);
    let auditEntry;
    try {
      auditEntry = recordAudit(req, 'branch.hours.updated', 'branch', currentBranch.id, { days: days.filter((day) => incoming[day]) }, currentBranch.id, { deferAppend: true });
      await persistAdminConfigMutation(() => {
        if (hadBranchHours) currentBranch.hours = previousBranchHours;
        else delete currentBranch.hours;
        if (hadLegacyHours) db.hours = previousLegacyHours;
        else delete db.hours;
        rollbackAuditEntry(auditEntry, auditLogWasPresent);
      });
    } catch (error) {
      return respondAdminConfigPersistenceFailure(res, error, 'hours_persistence_failed');
    }
    appendAuditAfterCommit(auditEntry);
    return res.json({ ok: true, hours: currentBranch.hours, branchId: currentBranch.id });
  });
});

app.get('/api/admin/tables', requireAdmin, (req, res) => {
  const bid = Number(parseBranchId(req));
  const allowedBranchIds = branchScopeForUser(req.user, { role: effectiveRole(req.user) });
  const tables = (db.tables || []).filter((table) => tableBranchId(table) === bid);
  const branches = allowedBranchIds === null
    ? (db.branches || [])
    : (db.branches || []).filter((branch) => allowedBranchIds.includes(Number(branch.id)));
  res.json({ tables, branches });
});
app.put('/api/admin/tables', requireAdmin, async (req, res) => {
  if (!Array.isArray(req.body.tables)) return res.status(400).json({ error: 'tables required' });
  const parseNum = (v, fb = 0) => {
    if (v == null || v === '') return fb;
    if (typeof v === 'number') return isNaN(v) ? fb : v;
    const n = Number(normalizeDigits(String(v)).replace(/[,٬_\s]/g, '').trim());
    return isNaN(n) ? fb : n;
  };
  const bid = Number(parseBranchId(req));
  const requestedIds = req.body.tables.slice(0, 80).map((table, index) => Math.round(parseNum(table.id, index + 1)));
  if (new Set(requestedIds).size !== requestedIds.length) return res.status(400).json({ error: 'table_id_duplicate' });
  const existingMap = new Map((db.tables || []).map((t) => [Number(t.id), t]));
  if (requestedIds.some((id) => existingMap.has(id) && tableBranchId(existingMap.get(id)) !== bid)) {
    return res.status(403).json({ error: 'branch_access_denied', message: 'نمی‌توان میز شعبهٔ دیگری را با این درخواست جابه‌جا کرد.' });
  }
  const before = JSON.parse(JSON.stringify(db.tables || []));
  const others = (db.tables || []).filter((t) => tableBranchId(t) !== bid);
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
  try {
    await save({ requireDurable: true });
  } catch (error) {
    db.tables = before;
    return res.status(503).json({ error: 'table_persistence_failed', message: 'ذخیرهٔ تغییرات میز انجام نشد؛ وضعیت قبلی حفظ شد.' });
  }
  res.json({ ok: true, tables: updated });
});
app.post('/api/admin/tables', requireAdmin, async (req, res) => {
  const parseNum = (v, fb = 0) => {
    if (v == null || v === '') return fb;
    if (typeof v === 'number') return isNaN(v) ? fb : v;
    const n = Number(normalizeDigits(String(v)).replace(/[,٬_\s]/g, '').trim());
    return isNaN(n) ? fb : n;
  };
  const id = Math.max(0, ...db.tables.map((t) => Number(t.id) || 0), 0) + 1;
  const branchId = Number(parseBranchId(req));
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
  const before = JSON.parse(JSON.stringify(db.tables || []));
  db.tables.push(table);
  try {
    await save({ requireDurable: true });
  } catch (error) {
    db.tables = before;
    return res.status(503).json({ error: 'table_persistence_failed', message: 'ذخیرهٔ میز انجام نشد؛ وضعیت قبلی حفظ شد.' });
  }
  res.json({ ok: true, table });
});
app.delete('/api/admin/tables/:id', requireAdmin, async (req, res) => {
  // The legacy endpoint has no expectedLayoutRevision and cannot join the
  // floor-layout lock used by /api/admin/v2/floor/tables/delete. Refuse every
  // legacy delete until it can be routed through that guarded mutation; even
  // idle-table deletes must not silently bypass revisioning.
  return res.status(428).json({
    error: 'floor_layout_revision_required',
    message: 'حذف میز از این مسیر قدیمی امن نیست. نقشه را از API نسخه‌دار تازه کنید و حذف را همراه نسخهٔ نقشه انجام دهید.',
    replacement: {
      read: 'GET /api/admin/v2/floor?branchId={branchId}',
      delete: 'POST /api/admin/v2/floor/tables/delete',
      requiredBody: ['expectedLayoutRevision', 'tableIds'],
    },
  });
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
  let configuredAdminPhones = null;
  if (Array.isArray(s.adminPhones) && s.adminPhones.length) {
    configuredAdminPhones = s.adminPhones.map((phone) => normalizeDigits(phone).trim());
    if (configuredAdminPhones.some((phone) => PLATFORM_ONLY_PHONE_IDENTITIES.has(phone))) {
      return res.status(400).json({ error: 'platform_identity_cannot_be_tenant_owner', message: 'حساب راهبر پلتفرم را نمی‌توان به مالک رستوران تبدیل کرد.' });
    }
    if (!configuredAdminPhones.every((phone) => PHONE_RE.test(phone))) {
      return res.status(400).json({ error: 'admin_phone_invalid' });
    }
  }
  if (typeof s.siteTitle === 'string') db.settings.siteTitle = s.siteTitle;
  if (typeof s.metaDescription === 'string') db.settings.metaDescription = s.metaDescription;
  if (configuredAdminPhones) db.settings.adminPhones = configuredAdminPhones;
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

app.get('/api/admin/loyalty', requireOwner, (req, res) => {
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
  const completedOrders = (db.orders || []).filter(loyaltyAchievements.isValidCompletedOrder);
  const linkedMembers = (db.users || []).filter((member) => effectiveRole(member) === 'user');
  const unlinkedCompleted = completedOrders.filter((order) => !linkedMembers.some((member) => loyaltyAchievements.orderBelongsToMember(order, member)));
  const membersWithoutCompletedOrders = linkedMembers.filter((member) => Number(member.points) > 0
    && !completedOrders.some((order) => loyaltyAchievements.orderBelongsToMember(order, member)));
  res.json({
    loyalty: {
      ...(db.loyalty || {}),
      tiers: loyaltyEngine.getLoyaltyTiers(db),
    },
    achievements: loyaltyAchievements.getLoyaltyAchievements(db),
    menuCategories: (db.menuCategories || []).map((category) => ({ id: category.id, title: category.title || category.name1 || `دسته ${category.id}` })),
    diagnostics: {
      completedOrders: completedOrders.length,
      unlinkedCompletedOrders: unlinkedCompleted.length,
      unlinkedOrdersSample: unlinkedCompleted.slice(0, 12).map((order) => ({
        orderNo: order.orderNo || `W-${order.id}`,
        status: order.status,
        completedAt: loyaltyAchievements.completionDate(order)?.toISOString() || null,
        phoneLast4: normalizeDigits(order.phone || order.userPhone || order.customerPhone || '').replace(/\D/g, '').slice(-4),
      })),
      membersWithPointsWithoutLinkedCompletedOrders: membersWithoutCompletedOrders.length,
      membersWithoutOrdersSample: membersWithoutCompletedOrders.slice(0, 12).map((member) => ({
        name: String(member.name || 'مشتری').slice(0, 48),
        phoneLast4: normalizeDigits(member.phone || '').replace(/\D/g, '').slice(-4),
        points: Math.max(0, Math.round(Number(member.points) || 0)),
      })),
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

app.get('/api/admin/club', requireOwner, (req, res) => {
  const orderStatsByPhone = new Map();
  const now = Date.now();
  for (const o of (db.orders || [])) {
    const phone = String(o.phone || '').trim();
    if (!phone) continue;
    const stat = orderStatsByPhone.get(phone) || { orders: 0, total: 0, lastOrderAt: null };
    stat.orders += 1;
    if (o.paid || ['paid', 'preparing', 'ready', 'delivered', 'completed'].includes(o.status)) {
      stat.total += Number(o.total) || 0;
    }
    if (!stat.lastOrderAt || new Date(o.createdAt || 0) > new Date(stat.lastOrderAt)) {
      stat.lastOrderAt = o.createdAt;
    }
    orderStatsByPhone.set(phone, stat);
  }

  let totalOrderSpendToman = 0;
  let totalPaidOrders = 0;
  let atRiskCount = 0;
  let championsCount = 0;

  const rawMembers = (db.users || []).map(publicUser).sort((a, b) => (b.points || 0) - (a.points || 0));
  const members = rawMembers.map((m) => {
    const tierInfo = loyaltyEngine.resolveCustomerTier(db, m);
    const walletBalanceToman = walletEngine.getWalletBalance(db, m.phone);
    const stat = orderStatsByPhone.get(m.phone) || { orders: 0, total: 0, lastOrderAt: null };
    const recencyDays = stat.lastOrderAt ? Math.max(0, Math.floor((now - new Date(stat.lastOrderAt).getTime()) / (1000 * 3600 * 24))) : null;
    const monetaryToman = Math.round(stat.total / 10);
    totalOrderSpendToman += monetaryToman;
    totalPaidOrders += stat.orders;

    let rfmSegment = 'new';
    let rfmLabel = 'مشتری جدید 🌱';
    if (stat.orders >= 6 && recencyDays != null && recencyDays <= 30) {
      rfmSegment = 'champion';
      rfmLabel = 'قهرمان 🏆';
      championsCount++;
    } else if (stat.orders >= 3 && recencyDays != null && recencyDays <= 45) {
      rfmSegment = 'loyal';
      rfmLabel = 'وفادار 💎';
    } else if (stat.orders >= 2 && recencyDays != null && recencyDays <= 60) {
      rfmSegment = 'potential';
      rfmLabel = 'مستعد رشد 🚀';
    } else if (stat.orders >= 2 && recencyDays != null && recencyDays > 60) {
      rfmSegment = 'at_risk';
      rfmLabel = 'در معرض ریزش ⚠️';
      atRiskCount++;
    } else if (recencyDays != null && recencyDays > 90) {
      rfmSegment = 'churned';
      rfmLabel = 'خواب‌رفته 💤';
    } else if (stat.orders <= 1 && recencyDays != null && recencyDays <= 30) {
      rfmSegment = 'new';
      rfmLabel = 'مشتری جدید 🌱';
    }

    return {
      ...m,
      orders: stat.orders,
      total: stat.total,
      monetaryToman,
      recencyDays,
      rfmSegment,
      rfmLabel,
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
      activeWallets: walletSummary.activeWalletsCount || 0,
      avgLtvToman: members.length ? Math.round(totalOrderSpendToman / members.length) : 0,
      avgOrderToman: totalPaidOrders ? Math.round(totalOrderSpendToman / totalPaidOrders) : 0,
      atRiskCount,
      championsCount,
      newFeedback,
    },
    customers: members,
  });
});

app.get('/api/admin/loyalty/tiers', requireOwner, (req, res) => {
  const rawMembers = db.users.map(publicUser);
  const tiers = loyaltyEngine.summarizeTiersMembership(db, rawMembers);
  res.json({ tiers });
});

app.put('/api/admin/loyalty/tiers', requireOwner, (req, res) => {
  let normalizedTiers;
  try {
    normalizedTiers = loyaltyEngine.normalizeLoyaltyTiers(req.body.tiers);
  } catch (error) {
    return res.status(400).json({ error: error.code || 'invalid_loyalty_tiers', message: error.message });
  }
  if (!db.loyalty) db.loyalty = {};
  db.loyalty.tiers = normalizedTiers;
  save();
  res.json({ ok: true, tiers: db.loyalty.tiers });
});

app.put('/api/admin/loyalty/achievements', requireOwner, async (req, res) => {
  const validCategoryIds = (db.menuCategories || []).map((category) => Number(category.id));
  let normalized;
  try {
    normalized = loyaltyAchievements.normalizeLoyaltyAchievements(req.body?.achievements, { validCategoryIds });
  } catch (error) {
    return res.status(400).json({ error: error.code || 'invalid_loyalty_achievements', message: error.message });
  }
  if (!db.loyalty) db.loyalty = {};
  const previous = db.loyalty.achievements;
  const previousById = new Map(loyaltyAchievements.getLoyaltyAchievements(db).map((item) => [item.id, item]));
  const savedAt = new Date().toISOString();
  db.loyalty.achievements = normalized.map((achievement) => {
    const prior = previousById.get(achievement.id);
    const priorRewardWasLive = prior?.enabled !== false && Number(prior?.rewardPoints) > 0 && !!prior?.rewardStartsAt
      && loyaltyAchievements.sameAchievementRewardDefinition(prior, achievement);
    const rewardStartsAt = achievement.enabled && achievement.rewardPoints > 0
      ? (priorRewardWasLive ? prior.rewardStartsAt : savedAt)
      : null;
    return { ...achievement, rewardStartsAt };
  });
  try {
    const persisted = await save({ requireDurable: true });
    if (persisted !== true) throw Object.assign(new Error('ذخیرهٔ پایدار تنظیمات تأیید نشد.'), { code: 'persistence_unconfirmed', status: 503 });
  } catch (error) {
    if (previous === undefined) delete db.loyalty.achievements;
    else db.loyalty.achievements = previous;
    return res.status(error.status || 503).json({ error: error.code || 'loyalty_achievement_save_failed', message: 'ذخیرهٔ پایدار هدف‌های وفاداری انجام نشد؛ تغییری اعمال نشده است.' });
  }
  return res.json({ ok: true, achievements: db.loyalty.achievements });
});

app.post('/api/admin/loyalty/adjust', requireOwner, (req, res) => {
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
  const member = (db.users || []).find((candidate) => loyaltyAchievements.orderBelongsToMember({ userId: req.user.id, phone: req.user.phone }, candidate)) || req.user;
  const memberKey = member.id !== undefined && member.id !== null
    ? `user:${String(member.id)}`
    : `phone:${loyaltyAchievements.normalizePhoneKey(member.phone || req.user.phone)}`;
  const linkedOrders = (db.orders || []).filter((order) => loyaltyAchievements.orderBelongsToMember(order, member));
  const awards = (db.loyaltyAchievementAwards || []).filter((award) => award.memberKey === memberKey);
  const achievementRows = loyaltyAchievements.evaluateAchievements(
    loyaltyAchievements.getLoyaltyAchievements(db),
    linkedOrders,
    {
      menuItems: db.menuItems || [],
      branches: db.branches || [],
      fallbackTimeZone: db.settings?.businessTimeZone || db.settings?.timezone || loyaltyAchievements.FALLBACK_TIME_ZONE,
    },
  ).map((achievement) => {
    const award = awards.find((entry) => entry.achievementId === achievement.id);
    let rewardStatus = 'in_progress';
    if (award) rewardStatus = 'issued';
    else if (achievement.unlocked && achievement.rewardPoints <= 0) rewardStatus = 'not_configured';
    else if (achievement.unlocked && achievement.rewardStartsAt && achievement.completedAt
      && Date.parse(achievement.completedAt) < Date.parse(achievement.rewardStartsAt)) rewardStatus = 'completed_before_rewards';
    else if (achievement.unlocked && !db.loyalty?.enabled) rewardStatus = 'program_paused';
    else if (achievement.unlocked) rewardStatus = 'award_review';
    return { ...achievement, thresholdOrderId: undefined, rewardStatus, rewardIssuedAt: award?.at || null, pointsAwarded: award?.points || 0 };
  });
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
      achievements: achievementRows,
      achievementProgressSource: 'server_completed_orders',
    },
    achievements: achievementRows,
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
  if (channel === 'online_gateway' && process.env.NODE_ENV === 'production') {
    return res.status(503).json({ error: 'wallet_online_gateway_not_configured', message: 'شارژ آنلاین تا اتصال و تأیید واقعی درگاه بانکی در دسترس نیست؛ از شارژ حضوری استفاده کنید.' });
  }
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
  if (process.env.NODE_ENV === 'production') {
    return res.status(503).json({ error: 'wallet_online_gateway_not_configured', message: 'تأیید شارژ فقط پس از اتصال امن به درگاه واقعی امکان‌پذیر است.' });
  }
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

app.post('/api/orders/:id/pay-wallet', requireAuth, serializeOrderMutationRoute(async (req, res) => {
  const persistenceReadiness = settlementPersistenceGate.check({
    postgresEnabled: stateStore.enabled,
    postgresRequired: stateStore.required,
  });
  if (!persistenceReadiness.ok) {
    return res.status(persistenceReadiness.status).json({ error: persistenceReadiness.code, message: persistenceReadiness.message });
  }
  const orderId = Number(normalizeDigits(String(req.params.id || '')).replace(/\D/g, ''));
  const order = (db.orders || []).find((o) => Number(o.id) === orderId);
  if (!order) return res.status(404).json({ error: 'سفارش یافت نشد.' });
  const branchId = persistedOrderBranchId(order);
  if (!branchId) return res.status(409).json({ error: 'order_branch_unresolved', message: 'شعبهٔ ثبت‌شدهٔ سفارش معتبر نیست؛ پرداخت تا تطبیق شعبه انجام نمی‌شود.' });

  const phone = normalizeDigits(req.user?.phone || '').trim();
  if (!phone) return res.status(400).json({ error: 'شماره مشتری برای پرداخت کیف پول مشخص نیست.' });
  if (order.phone && normalizeDigits(order.phone).trim() !== phone) {
    return res.status(403).json({ error: 'این سفارش به حساب مشتری دیگری تعلق دارد.' });
  }
  if (!order.phone) return res.status(409).json({ error: 'سفارش شماره مشتری قابل پرداخت از کیف پول ندارد.' });

  const idempotencyKey = String(req.get('Idempotency-Key') || req.body?.idempotencyKey || '').trim();
  if (process.env.NODE_ENV === 'production' && !idempotencyKey) {
    return res.status(400).json({ error: 'settlement_idempotency_required', message: 'برای ثبت پرداخت، کلید یکتای درخواست لازم است.' });
  }
  if (idempotencyKey && !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$/.test(idempotencyKey)) {
    return res.status(400).json({ error: 'settlement_idempotency_invalid' });
  }
  const inFlightKey = idempotencyKey ? settlementLockKey(req, order, idempotencyKey, branchId) : null;
  const requestFingerprint = idempotencyKey ? checkoutIdempotencyFingerprint({ orderId: order.id, branchId, action: 'wallet-pay-remaining' }, req.user) : null;
  const existingWalletPayment = idempotencyKey
    ? (Array.isArray(order.partialPayments) ? order.partialPayments : []).find((payment) => payment.idempotencyKey === idempotencyKey)
    : null;
  if (existingWalletPayment) {
    if (!isSettlementRequestFingerprint(existingWalletPayment.requestFingerprint)) {
      return res.status(409).json({ error: 'idempotency_replay_unavailable', message: 'اثر انگشت پرداخت کیف پول موجود نیست؛ برای جلوگیری از برداشت تکراری، ابتدا سابقهٔ کیف پول و سفارش را تطبیق دهید.' });
    }
    if (existingWalletPayment.requestFingerprint !== requestFingerprint) {
      return res.status(409).json({ error: 'idempotency_key_conflict', message: 'این کلید برای درخواست پرداخت دیگری استفاده شده است.' });
    }
    const pending = settlementInFlight.get(inFlightKey);
    if (pending) {
      const outcome = await pending;
      if (!outcome.ok) return res.status(outcome.status || 503).json({ error: outcome.error || 'finance_persistence_failed', message: outcome.message });
    }
    return res.json({
      ok: true,
      idempotent: true,
      order: operationalOrderResponse(order, req.user),
      payment: operationalPaymentResponse(existingWalletPayment, req.user),
    });
  }
  if (order.paymentStatus === 'unknown') {
    return res.status(409).json({ error: 'payment_status_reconciliation_required', message: 'وضعیت پرداخت سفارش باید پیش از برداشت از کیف پول تطبیق شود.' });
  }
  if (order.paymentStatus === 'paid') {
    return res.json({ ok: true, idempotent: true, order: operationalOrderResponse(order, req.user) });
  }

  const existingPayments = Array.isArray(order.partialPayments) ? order.partialPayments : [];
  const settlementAmounts = resolveSettlementAmounts({
    total: order.total,
    amountPaid: order.amountPaid,
    payments: existingPayments,
    tender: 'wallet',
  });
  if (!settlementAmounts.ok) {
    return res.status(409).json({
      error: settlementAmounts.error,
      ...(settlementAmounts.outstanding !== undefined ? { outstanding: settlementAmounts.outstanding } : {}),
      message: 'ماندهٔ پرداخت از سابقهٔ سفارش قابل‌اعتماد نیست؛ پیش از برداشت کیف پول، پرداخت‌ها را تطبیق دهید.',
    });
  }
  const { orderTotal, alreadyPaid, outstanding, requestedAmount: payableAmount } = settlementAmounts;
  if (!outstanding) {
    return res.status(409).json({ error: 'order_payment_reconciliation_required', message: 'وضعیت سفارش پرداخت‌نشده است اما مانده‌ای برای برداشت وجود ندارد؛ ابتدا وضعیت را تطبیق دهید.' });
  }
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
  let resolveWalletPayment;
  let walletPaymentPromise;
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
        ...(idempotencyKey ? { idempotencyKey, requestFingerprint } : {}),
      });
    }
    order.amountPaid = alreadyPaid + payableAmount;
    order.paymentTenders = [...new Set(order.partialPayments.map((row) => row.tender).filter(Boolean))];
    if (fullyPaid) {
      const nextStatus = nextOrderStatusAfterPayment(order);
      if (nextStatus && canTransitionOrder(order, nextStatus)) {
        appendOrderStatus(order, nextStatus, req.user || null, { source: 'wallet' });
      } else if (normalizeFulfillment(order.fulfillment, { tableNo: order.tableNo }) !== 'delivery'
          && ['pending', 'pending_cashier'].includes(String(order.status || ''))) {
        appendOrderStatus(order, 'paid', req.user || null, { source: 'wallet' });
      }
    }

    financeResult = financeV2.capturePaidOrder(db, order, {
      actor: req.user?.phone || 'customer-wallet',
      idempotencyKey: `order:${branchId}:${order.id}:wallet-payment`,
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
    if (idempotencyKey) {
      walletPaymentPromise = new Promise((resolve) => { resolveWalletPayment = resolve; });
      settlementInFlight.set(inFlightKey, walletPaymentPromise);
    }
    await persistFinanceMutation(snapshot);
  } catch (error) {
    restoreFinanceMutationState(snapshot);
    if (walletPaymentPromise) {
      resolveWalletPayment?.({ ok: false, status: error.status || 503, error: error.code || error.message, message: error.message });
      settlementInFlight.delete(inFlightKey);
    }
    return res.status(error.status || 503).json({
      error: error.code || error.message,
      ...(userCan(req.user, 'payments.manage') && error.details ? { details: error.details } : {}),
    });
  }

  try {
    publishOperationalEvent('payment.updated', { orderId: order.id, branchId: order.branchId, status: order.paymentStatus, tender: 'wallet' });
    publishOperationalEvent('order.updated', { orderId: order.id, branchId: order.branchId, status: order.status });
  } catch (eventError) { console.error('[wallet-payment] post-commit event failed', eventError?.message || eventError); }
  resolveWalletPayment?.({ ok: true });
  if (inFlightKey) settlementInFlight.delete(inFlightKey);

  res.json({
    ok: true,
    order: operationalOrderResponse(order, req.user),
    paymentResult: {
      ok: paymentResult?.ok === true,
      amountPaid: paymentResult?.amountPaid ?? null,
      newBalance: paymentResult?.newBalance ?? null,
    },
    ...(userCan(req.user, 'payments.manage') ? { finance: financeResult } : {}),
    cashbackAwarded: cashbackAmount,
    newWalletBalance: walletEngine.getWalletBalance(db, phone),
  });
}));

app.get('/api/admin/wallet/summary', requireOwner, (req, res) => {
  const summary = walletEngine.summarizeWallet(db);
  res.json(summary);
});

app.post('/api/admin/wallet/adjust', requireOwner, async (req, res) => {
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

app.get('/api/admin/wallet/packages', requireOwner, (req, res) => {
  res.json({ packages: walletEngine.getWalletPackages(db) });
});

app.put('/api/admin/wallet/packages', requireOwner, (req, res) => {
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
let reservationCreationTail = Promise.resolve();

async function serializeReservationCreation(operation) {
  const previous = reservationCreationTail;
  let release;
  reservationCreationTail = new Promise((resolve) => { release = resolve; });
  await previous.catch(() => {});
  try {
    return await operation();
  } finally {
    release();
  }
}

function normalizeReservationDate(value) {
  const raw = normalizeDigits(String(value || '')).trim();
  const match = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/.exec(raw);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (year >= 1200 && year <= 1600) {
    if (month < 1 || month > 12 || day < 1 || day > shamsi.getJalaliMonthDays(year, month)) return null;
    try {
      return shamsi.toShamsiParts(`${year}/${month}/${day}`).isoDate;
    } catch (_) {
      return null;
    }
  }

  const isoDate = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const parsed = new Date(`${isoDate}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === isoDate ? isoDate : null;
}

function reservationDateWithinWindow(dateStr, settings) {
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const dayDelta = (Date.parse(`${dateStr}T00:00:00.000Z`) - Date.parse(`${today}T00:00:00.000Z`)) / 86400000;
  const advanceDays = Math.max(1, Number(settings.advanceDays) || 21);
  return Number.isInteger(dayDelta) && dayDelta >= 0 && dayDelta <= advanceDays;
}

function reservationFingerprint({ branchId, date, time, partySize, name, phone, note }) {
  const canonical = JSON.stringify({ branchId, date, time, partySize, name, phone, note });
  return crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
}

function reservationResponse(reservation, branch) {
  return {
    ...reservation,
    shamsiDate: shamsi.formatShamsiDate(reservation.date),
    shamsiDateLong: shamsi.formatShamsiDateLong(reservation.date),
    shamsiDateFull: shamsi.formatShamsiDateFull(reservation.date),
    branchName: branch?.name,
    restaurantName: db.restaurant?.name,
  };
}

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
  const sendError = (status, code, message) => res.status(status).json({ ok: false, error: code, code, message });
  const rawKey = String(req.get('Idempotency-Key') || '').trim();
  if (process.env.NODE_ENV === 'production' && !rawKey) {
    return sendError(400, 'idempotency_key_required', 'برای ثبت رزرو، کلید درخواست لازم است.');
  }
  if (rawKey && !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(rawKey)) {
    return sendError(400, 'idempotency_key_invalid', 'کلید درخواست معتبر نیست.');
  }

  const candidateBody = req.body;
  const bodyPrototype = candidateBody && typeof candidateBody === 'object'
    ? Object.getPrototypeOf(candidateBody)
    : null;
  const body = candidateBody
    && typeof candidateBody === 'object'
    && !Array.isArray(candidateBody)
    && (bodyPrototype === Object.prototype || bodyPrototype === null)
    ? candidateBody
    : null;
  if (!body) return sendError(400, 'reservation_body_invalid', 'بدنهٔ درخواست رزرو معتبر نیست.');
  const name = String(body.name || '').trim().normalize('NFC').slice(0, 80);
  const phone = normalizeDigits(body.phone || '').trim();
  const dateStr = normalizeReservationDate(body.date);
  const dateFingerprintValue = dateStr || normalizeDigits(String(body.date || '')).trim().slice(0, 32);
  const time = normalizeDigits(String(body.time || '')).trim();
  const note = String(body.note || '').trim().normalize('NFC').slice(0, 200);
  const maxParty = Math.max(1, Number(settings.maxParty) || 12);
  const rawPartySize = body.partySize == null || String(body.partySize).trim() === ''
    ? '2'
    : normalizeDigits(body.partySize);
  const partySize = Number(rawPartySize);
  const branchValue = body.branchId ?? body.branch;
  const branch = resolveBranchExact(branchValue);

  const idempotencyKey = rawKey || crypto.randomUUID();
  const fingerprint = reservationFingerprint({
    branchId: branch ? Number(branch.id) : normalizeDigits(String(branchValue || '')).trim().toLowerCase(),
    date: dateFingerprintValue,
    time,
    partySize: Number.isSafeInteger(partySize) ? partySize : String(rawPartySize).trim(),
    name,
    phone,
    note,
  });

  let outcome;
  try {
    outcome = await serializeReservationCreation(async () => {
      const idempotency = db.reservationIdempotency && typeof db.reservationIdempotency === 'object'
        ? db.reservationIdempotency
        : {};
      const prior = Object.prototype.hasOwnProperty.call(idempotency, idempotencyKey)
        ? idempotency[idempotencyKey]
        : null;
      if (prior) {
        if (prior.fingerprint !== fingerprint) {
          return { error: { status: 409, code: 'idempotency_key_conflict', message: 'این کلید قبلاً برای اطلاعات رزرو دیگری استفاده شده است.' } };
        }
        const existing = (db.reservations || []).find((item) => Number(item.id) === Number(prior.reservationId));
        if (!existing) {
          return { error: { status: 409, code: 'reservation_idempotency_result_unavailable', message: 'نتیجهٔ این کلید دیگر در سابقهٔ رزروها موجود نیست.' } };
        }
        const existingBranch = (db.branches || []).find((item) => Number(item.id) === Number(existing.branchId)) || branch;
        return { reservation: existing, branch: existingBranch, replay: true };
      }

      if (!name) return { error: { status: 400, code: 'reservation_name_required', message: 'نام لازم است.' } };
      if (!PHONE_RE.test(phone)) return { error: { status: 400, code: 'reservation_phone_invalid', message: 'شماره موبایل معتبر نیست.' } };
      if (!dateStr) return { error: { status: 400, code: 'reservation_date_invalid', message: 'تاریخ معتبر نیست.' } };
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
        return { error: { status: 400, code: 'reservation_time_invalid', message: 'ساعت معتبر نیست.' } };
      }
      if (!Number.isSafeInteger(partySize) || partySize < 1 || partySize > maxParty) {
        return { error: { status: 400, code: 'reservation_party_size_invalid', message: `تعداد نفرات باید بین ۱ تا ${maxParty} باشد.` } };
      }
      if (!branch || branch.active === false) {
        return { error: { status: 400, code: 'reservation_branch_invalid', message: 'شعبهٔ فعال یافت نشد.' } };
      }
      if (settings.enabled === false) {
        return { error: { status: 403, code: 'reservations_disabled', message: 'رزرو غیرفعال است.' } };
      }
      if (!reservationDateWithinWindow(dateStr, settings)) {
        return { error: { status: 400, code: 'reservation_date_out_of_range', message: 'تاریخ رزرو خارج از بازهٔ مجاز است.' } };
      }
      const { slots, closed } = listReservationSlots(branch, dateStr, partySize);
      if (closed) {
        return { error: { status: 409, code: 'reservation_day_closed', message: 'در این روز مجموعه تعطیل است.' } };
      }
      const slot = slots.find((item) => item.time === time);
      if (!slot || !slot.available) {
        return { error: { status: 409, code: 'reservation_slot_unavailable', message: 'این ساعت در حال حاضر ظرفیت ندارد.' } };
      }

      const hadReservations = Object.prototype.hasOwnProperty.call(db, 'reservations');
      const reservationsBefore = Array.isArray(db.reservations) ? db.reservations.slice() : db.reservations;
      const hadIdempotency = Object.prototype.hasOwnProperty.call(db, 'reservationIdempotency');
      const idempotencyBefore = db.reservationIdempotency;
      const hadAuditLog = Object.prototype.hasOwnProperty.call(db, 'auditLog');
      const auditLogBefore = Array.isArray(db.auditLog) ? db.auditLog.slice() : db.auditLog;
      const id = Math.max(0, ...(db.reservations || []).map((item) => Number(item.id) || 0)) + 1;
      const createdAt = new Date().toISOString();
      const reservation = {
        id,
        branchId: branch.id,
        name,
        phone,
        partySize,
        date: dateStr,
        time,
        endTime: '',
        note,
        status: 'pending',
        createdAt,
        statusAt: createdAt,
      };

      db.reservations = [reservation, ...(Array.isArray(db.reservations) ? db.reservations : [])].slice(0, 1000);
      db.reservationIdempotency = {
        ...idempotency,
        [idempotencyKey]: { fingerprint, reservationId: id, createdAt },
      };
      const auditEntry = recordAudit(null, 'reservation.created', 'reservation', id, { partySize }, branch.id, { deferAppend: true });

      try {
        const persisted = await save({ requireDurable: true });
        if (persisted !== true) throw Object.assign(new Error('Reservation persistence was not confirmed.'), { code: 'reservation_persistence_unconfirmed', status: 503 });
      } catch (error) {
        if (hadReservations) db.reservations = reservationsBefore;
        else delete db.reservations;
        if (hadIdempotency) db.reservationIdempotency = idempotencyBefore;
        else delete db.reservationIdempotency;
        if (hadAuditLog) db.auditLog = auditLogBefore;
        else delete db.auditLog;
        console.error('[reservation] durable commit failed', error?.message || error);
        return { error: { status: 503, code: 'reservation_persistence_failed', message: 'رزرو ذخیره نشد؛ لطفاً با همین درخواست دوباره تلاش کنید.' } };
      }

      appendAuditAfterCommit(auditEntry);
      return { reservation, branch, replay: false };
    });
  } catch (error) {
    console.error('[reservation] creation failed', error?.message || error);
    return sendError(503, 'reservation_creation_failed', 'ثبت رزرو موقتاً انجام نشد.');
  }

  if (outcome.error) return sendError(outcome.error.status, outcome.error.code, outcome.error.message);
  const reservation = outcome.reservation;
  const responseBranch = outcome.branch || branch;
  if (outcome.replay) {
    return res.status(200).json({ ok: true, idempotentReplay: true, reservation: reservationResponse(reservation, responseBranch), whatsapp: null });
  }

  let notify = null;
  try {
    publishOperationalEvent('reservation.created', { reservationId: reservation.id, branchId: reservation.branchId, status: reservation.status });
  } catch (error) {
    console.error('[reservation] post-commit event failed', error?.message || error);
  }
  try {
    notify = await notifyReservationWhatsApp(db, reservation);
    if (!notify?.skipped) await save({ requireDurable: true });
  } catch (error) {
    // The durable reservation and idempotency record already committed. Never
    // turn a notification error into a retryable create failure.
    console.error('[reservation] post-commit notification failed', error?.message || error);
    notify = null;
  }

  return res.status(201).json({
    ok: true,
    idempotentReplay: false,
    reservation: reservationResponse(reservation, responseBranch),
    whatsapp: notify?.skipped ? null : notify,
  });
});

app.get('/api/admin/reservations', requireCapability('reservations.view'), (req, res) => {
  // Walk-in guests have no date/time slot; they are served by the waiter
  // reception endpoint and must not pollute the online reservation calendar.
  const requestedBranch = requestBranchValue(req);
  const allowedBranchIds = branchScopeForUser(req.user, { role: effectiveRole(req.user) });
  let branchId = null;
  try {
    if (requestedBranch != null) {
      branchId = parseBranchId(req);
    } else if (allowedBranchIds !== null) {
      if (!allowedBranchIds.length) {
        return res.status(403).json({ error: 'branch_scope_empty', message: 'برای این کاربر شعبهٔ مجازی تعریف نشده است.' });
      }
      const preferred = defaultBranch();
      branchId = preferred && allowedBranchIds.includes(Number(preferred.id))
        ? preferred.id
        : allowedBranchIds[0];
    }
  } catch (error) {
    return res.status(error.status || 400).json({ error: error.code || 'branch_invalid', message: error.message });
  }
  let list = (db.reservations || []).filter((item) => !waitlist.isWaitlist(item)).slice();
  if (branchId != null) list = list.filter((r) => Number(r.branchId) === Number(branchId));
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
  try {
    assertUserBranchAccess(req.user, item.branchId);
  } catch (error) {
    return res.status(error.status || 403).json({ error: error.code || 'branch_access_denied', message: error.message, requestId: req.requestId });
  }
  if (req.body?.branchId != null && Number(req.body.branchId) !== Number(item.branchId)) {
    return res.status(404).json({ error: 'reservation_branch_mismatch' });
  }
  const allowed = ['pending', 'confirmed', 'seated', 'completed', 'cancelled', 'no_show'];
  if (typeof req.body.status === 'string' && allowed.includes(req.body.status)) {
    item.status = req.body.status;
    item.statusAt = new Date().toISOString();
    if (req.body.status === 'seated' && !item.seatedAt) item.seatedAt = new Date().toISOString();
    if (req.body.status === 'completed' && !item.completedAt) item.completedAt = new Date().toISOString();
  }
  if (typeof req.body.note === 'string') item.note = req.body.note.trim().slice(0, 200);
  if (req.body.tableNo !== undefined) {
    item.tableNo = req.body.tableNo == null || req.body.tableNo === '' ? null : String(req.body.tableNo).trim().slice(0, 20);
  }
  if (req.body.occasion !== undefined) {
    item.occasion = req.body.occasion == null || req.body.occasion === '' ? null : String(req.body.occasion).trim().slice(0, 40);
  }
  if (req.body.partySize != null) {
    const rawParty = typeof req.body.partySize === 'number'
      ? req.body.partySize
      : Number(String(req.body.partySize).replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).trim());
    if (!isNaN(rawParty)) {
      item.partySize = Math.max(1, Math.min(Number(db.reservationSettings?.maxParty) || 12, Math.round(rawParty)));
    }
  }
  recordAudit(req, 'reservation.updated', 'reservation', item.id, { status: item.status, partySize: item.partySize, tableNo: item.tableNo }, item.branchId);
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

app.get('/api/admin/feedback', requireCapability('pii.view'), (req, res) => {
  let bid;
  try {
    assertRequestBranchAccess(req);
    bid = parseBranchId(req);
  } catch (error) {
    return res.status(error.status || 403).json({ error: error.code || 'branch_access_denied', message: error.message });
  }
  let list = db.feedback || [];
  if (bid != null) list = list.filter((f) => Number(f.branchId) === Number(bid));
  else if (effectiveRole(req.user) !== 'owner') return res.status(403).json({ error: 'branch_scope_required' });
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

app.put('/api/admin/feedback/settings', requireOwner, (req, res) => {
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
  try {
    assertUserBranchAccess(req.user, item.branchId);
  } catch (error) {
    return res.status(error.status || 403).json({ error: error.code || 'branch_access_denied', message: error.message });
  }
  const st = String(req.body.status || '').trim();
  if (['new', 'reviewed', 'in_progress', 'resolved', 'archived'].includes(st)) item.status = st;
  if (typeof req.body.resolutionNote === 'string') {
    item.resolutionNote = req.body.resolutionNote.trim().slice(0, 300);
    item.resolvedAt = new Date().toISOString();
  }
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
          '</css/westo-critical.smart.css?v=release14uf1d31-order-staged-quote>; rel=preload; as=style',
          '</js/westo-smart-loader.js?v=release14uf1d31-order-staged-quote>; rel=preload; as=script',
          '</js/westo-app.smart.js?v=release14uf1d31-order-staged-quote>; rel=preload; as=script',
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
  '/order.html': 'order.html',
  '/menu-print': 'menu-print.html',
  '/reserve': 'reserve.html',
  '/about': 'about.html',
  '/feedback': 'feedback.html',
  '/cgu': 'cgu.html',
  '/mentions-legales': 'mentions-legales.html',
  '/politique-de-confidentialite': 'politique-de-confidentialite.html',
};

// Aliases for Operational Panels (POS, Waiter, KDS) and Checkout
app.get(['/pos', '/pos.html', '/cashier', '/cashier.html'], (req, res) => res.redirect(302, '/admin/cashier'));
app.get(['/waiter', '/waiter.html'], (req, res) => res.redirect(302, '/admin/waiter'));
app.get(['/kitchen', '/kitchen.html', '/kds', '/kds.html'], (req, res) => res.redirect(302, '/admin/kitchen'));
app.get(['/checkout', '/checkout.html'], (req, res) => res.redirect(302, '/order'));

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
  try {
    const recovery = await stateStore.loadActionableOrders();
    if (!recovery.available) {
      if (stateStore.required) {
        throw Object.assign(new Error('Normalized PostgreSQL order history is required for safe production startup.'), {
          code: recovery.reason || 'operational_order_store_missing', status: 503,
        });
      }
      console.warn('[orders] normalized order history is unavailable; only snapshot orders can be restored');
    } else {
      if (recovery.invalidRows && stateStore.required) {
        throw Object.assign(new Error(`Unable to restore ${recovery.invalidRows} malformed actionable order row(s).`), {
          code: 'operational_order_recovery_incomplete', status: 503,
        });
      }
      if (recovery.invalidRows) console.warn(`[orders] skipped ${recovery.invalidRows} malformed normalized order row(s)`);
      const mergedOrders = mergeActionableOrders(db.orders, recovery.orders);
      if (mergedOrders.restoredCount) {
        db.orders = mergedOrders.orders;
        console.warn(`[orders] restored ${mergedOrders.restoredCount} actionable order(s) omitted from the recent snapshot`);
      }
    }
  } catch (error) {
    if (stateStore.required) throw error;
    console.error('[orders] unable to reconcile actionable order history', error.message);
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
    await tenantConnectionManager.close();
    await closeRuntimeControlDatabase();
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
  tenantResolver,
  tenantConnectionManager,
  tenantRegistry,
  tenantInfrastructureEnabled: TENANT_INFRASTRUCTURE_ENABLED,
  commandCenterPayload,
  publicContentPayload,
  shouldWriteJsonState,
};
