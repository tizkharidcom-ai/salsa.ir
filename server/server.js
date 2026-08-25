/* Westo server: static site + OTP auth + admin/content API (JSON file storage). */
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
} = require('./command-center');
const { createPostgresStateStore } = require('./postgres-state');
const { registerAdminV2Routes } = require('./admin-v2');
const financeV2 = require('./finance-v2');
const accountingEngine = require('./accounting-engine');
const { registerAccountingRoutes } = require('./accounting-routes');
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

const ROOT = path.join(__dirname, '..');
const DB_PATH = process.env.WESTO_DB_PATH || path.join(__dirname, 'data', 'db.json');
const UPLOADS = path.join(ROOT, 'uploads');
const PORT = process.env.PORT == null ? 4180 : Number(process.env.PORT);
const HOST = process.env.HOST || (process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1');
const SECRET_PATH = process.env.WESTO_SECRET_PATH || path.join(__dirname, 'data', 'secret.key');

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
  const branchId = branchRaw == null || branchRaw === '' ? null : Number(branchRaw);
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
    branchId: Number.isFinite(branchId) ? branchId : null,
    sortOrder: Number.isFinite(Number(input.sortOrder)) ? Number(input.sortOrder) : (Number(current.sortOrder) || 0),
    autoplayMs: Math.max(0, Math.min(20000, Number(input.autoplayMs !== undefined ? input.autoplayMs : current.autoplayMs) || 0)),
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
  const data = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  return migrateDb(data);
}

// Runs for both the local JSON snapshot and a PostgreSQL snapshot. Keeping
// the migration idempotent gives staged rollouts a safe route forward and a
// local JSON rollback path without data loss.
function migrateDb(data) {
  // Migrate older db.json files that predate menu/orders.
  const seed = require('./seed');
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
  if (!Array.isArray(data.users)) data.users = [];
  if (!Array.isArray(data.staffShifts)) data.staffShifts = [];
  if (!Array.isArray(data.cashSessions)) data.cashSessions = [];
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
    data.neemIntegration = { enabled: true, endpoint: '', outbox: [], lastError: '' };
  }
  if (!Array.isArray(data.neemIntegration.outbox)) data.neemIntegration.outbox = [];
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
const db = loadDb();
const stateStore = createPostgresStateStore({ logger: console });
const eventHub = createEventHub();
let saveTimer = null;
let saveWaiters = [];

function rebuildProductsFromMenu() {
  db.products = buildProductsFromMenu(db);
}

function shouldWriteJsonState() {
  return !stateStore.enabled || process.env.WESTO_JSON_RECOVERY_SNAPSHOT === 'true';
}

function save(opts = {}) {
  if (opts.rebuildProducts) rebuildProductsFromMenu();
  if (opts.rebuildProducts || opts.bumpMenu) bumpMenuRevision(db);
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
if (db.menuComplementsV1Pending) {
  delete db.menuComplementsV1Pending;
  save({ bumpMenu: true });
}
const neemBridge = createNeemBridge({ getDb: () => db, persist: () => save(), logger: console });
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
  const id = Number(q);
  if (Number.isFinite(id) && id > 0) {
    return (db.branches || []).find((b) => b.id === id) || defaultBranch();
  }
  const slug = String(q).trim().toLowerCase();
  return (db.branches || []).find((b) => String(b.slug || '').toLowerCase() === slug) || defaultBranch();
}

function parseBranchId(req) {
  const q = req.query.branchId || req.query.branch || req.body?.branchId || req.body?.branch;
  const b = resolveBranch(q);
  return b ? b.id : null;
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
  if (!token) return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sign(payload)), Buffer.from(sig))) return null;
    return JSON.parse(Buffer.from(payload, 'base64url').toString());
  } catch {
    return null;
  }
}
function getCookie(req, name) {
  const m = (req.headers.cookie || '').match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}

function currentUser(req) {
  const data = parseToken(getCookie(req, 'westo_session'));
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
    if (!userCan(user, capability)) return res.status(403).json({ error: 'forbidden', capability });
    req.user = user;
    next();
  };
}
function requireAdmin(req, res, next) {
  return requireCapability('admin.access')(req, res, next);
}
function requireCommandCenterAccess(req, res, next) {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: 'unauthorized' });
  if (!userCan(user, 'ops.view') && !userCan(user, 'command.view') && !userCan(user, 'kitchen.view') && !userCan(user, 'admin.access')) {
    return res.status(403).json({ error: 'command_center_forbidden' });
  }
  req.user = user;
  next();
}
function requireKitchen(req, res, next) {
  return requireCapability('kitchen.view')(req, res, next);
}
function requireOwner(req, res, next) {
  const user = currentUser(req);
  if (effectiveRole(user) !== 'owner') return res.status(403).json({ error: 'owner_required' });
  req.user = user;
  next();
}
function publicUser(u) {
  const role = effectiveRole(u);
  return {
    phone: u.phone,
    name: u.name || '',
    email: u.email || '',
    role,
    roleLabel: roleLabel(role),
    capabilities: capabilitiesFor(u, db.settings || {}),
    points: Math.max(0, Math.round(Number(u.points) || 0)),
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

function pointsForOrderTotal(total) {
  const rate = Number(db.loyalty?.pointsPerToman) || 0;
  return Math.max(0, Math.floor(Number(total || 0) * rate));
}

// ---- OTP ---------------------------------------------------------------
// Intentionally matches the pre-admin-hardening WESTO OTP behaviour.
// Security hardening for cookies/session/origin remains in place, but OTP request
// throttling and verify-attempt caps are not applied here to preserve the former UX.
const otps = new Map(); // phone -> { code, expiresAt }
const PHONE_RE = /^09\d{9}$/;

// Accept Persian (۰-۹) and Arabic (٠-٩) digits everywhere numbers come in.
function normalizeDigits(str) {
  return String(str)
    .replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d))
    .replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
}

// ---- app ----------------------------------------------------------------
const app = express();
app.disable('x-powered-by');
if (process.env.TRUST_PROXY === 'true') app.set('trust proxy', 1);
app.use(compression({ threshold: 1024, level: 6 }));
app.use((req, res, next) => {
  const requestId = String(req.headers['x-request-id'] || crypto.randomUUID()).slice(0, 96);
  req.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  res.setHeader('Content-Security-Policy', "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'");
  if (/^\/api\/(?:admin|auth|kitchen)\b/.test(req.path)) res.setHeader('Cache-Control', 'no-store');
  next();
});
app.use(express.json({ limit: '1mb' }));
app.use((req, res, next) => {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  if (!/^\/api\/(?:admin|kitchen)\b/.test(req.path) && !/^\/api\/(?:content|menu|faq(?:-|\/|$)|v2\/orders(?:\/|$)|auth\/(?:logout|profile)$)/.test(req.path)) return next();
  const origin = String(req.headers.origin || '');
  if (!origin) return next(); // non-browser clients/tests
  let originHost = '';
  try { originHost = new URL(origin).host; } catch (_) { return res.status(403).json({ error: 'cross_origin_write_blocked', requestId: req.requestId }); }
  if (originHost !== String(req.get('host') || '')) return res.status(403).json({ error: 'cross_origin_write_blocked', requestId: req.requestId });
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
  const lowStock = (db.menuItems || [])
    .filter((item) => typeof item.stock === 'number' && item.stock <= Math.max(0, Number(item.lowStockAt) || 5))
    .slice(0, 12)
    .map((item) => ({ id: item.id, name: item.name, stock: item.stock, lowStockAt: item.lowStockAt }));
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
  res.json({
    user: publicUser(req.user),
    branchId: parseBranchId(req),
    branches: (db.branches || []).filter((branch) => branch.active !== false),
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
    branches: (db.branches || []).filter((branch) => branch.active !== false),
    shift: activeStaffShift(req.user, branchId),
  });
});

app.post('/api/staff/shifts/open', requireCapability('ops.view'), (req, res) => {
  const branchId = Number(req.body?.branchId) || defaultBranch()?.id || 1;
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
  const branchId = Number(req.body?.branchId) || defaultBranch()?.id || 1;
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

app.post('/api/cashier/drawer/open', requireCapability('cash.manage'), (req, res) => {
  const branchId = Number(req.body?.branchId) || defaultBranch()?.id || 1;
  const existing = activeCashSession(req.user, branchId);
  if (existing) return res.json({ ok: true, idempotent: true, session: existing, totals: cashSessionTotals(existing) });
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
  db.cashSessions.unshift(session);
  recordAudit(req, 'cash_drawer.opened', 'cash_session', session.id, { openingAmount }, branchId);
  save();
  res.status(201).json({ ok: true, session, totals: cashSessionTotals(session) });
});

app.post('/api/cashier/drawer/movements', requireCapability('cash.manage'), (req, res) => {
  const branchId = Number(req.body?.branchId) || defaultBranch()?.id || 1;
  const session = activeCashSession(req.user, branchId);
  if (!session) return res.status(409).json({ error: 'cash_drawer_not_open' });
  const type = String(req.body?.type || '');
  if (!['pay_in', 'pay_out'].includes(type)) return res.status(400).json({ error: 'cash_movement_invalid' });
  const rawAmount = Math.max(1, Math.round(Number(req.body?.amount) || 0));
  const movement = {
    id: nextId(session.movements),
    type,
    amount: type === 'pay_out' ? -rawAmount : rawAmount,
    note: String(req.body?.note || '').trim().slice(0, 160),
    at: new Date().toISOString(),
    by: req.user.phone,
  };
  session.movements.unshift(movement);
  recordAudit(req, `cash_drawer.${type}`, 'cash_session', session.id, { amount: movement.amount, note: movement.note }, branchId);
  const financeResult = financeV2.captureCashMovement(db, session, movement, { actor: req.user.phone });
  save();
  res.status(201).json({ ok: true, movement, session, totals: cashSessionTotals(session), finance: financeResult });
});

app.post('/api/cashier/drawer/close', requireCapability('cash.manage'), (req, res) => {
  const branchId = Number(req.body?.branchId) || defaultBranch()?.id || 1;
  const session = activeCashSession(req.user, branchId);
  if (!session) return res.status(409).json({ error: 'cash_drawer_not_open' });
  const totals = cashSessionTotals(session);
  session.countedAmount = Math.max(0, Math.round(Number(req.body?.countedAmount) || 0));
  session.variance = session.countedAmount - totals.expected;
  session.closedAt = new Date().toISOString();
  recordAudit(req, 'cash_drawer.closed', 'cash_session', session.id, { countedAmount: session.countedAmount, variance: session.variance }, branchId);
  const financeResult = financeV2.captureCashClose(db, session, { actor: req.user.phone });
  save();
  res.json({ ok: true, session, totals: { ...totals, counted: session.countedAmount, variance: session.variance }, finance: financeResult });
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
  return res.status(410).json({
    data: null,
    meta: { generatedAt: new Date().toISOString(), replacement: '/api/admin/v2/finance' },
    error: { code: 'finance_v1_read_only', message: 'عملیات نوشتنی مالی به Finance V2 منتقل شده است.' },
  });
});

registerAccountingRoutes({
  app,
  getDb: () => db,
  save,
  requireCapability,
  requireAdmin,
  parseBranchId,
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

app.get('/ops', requireCapability('admin.access'), (req, res) => {
  const target = process.env.NEEM_OPS_URL || 'http://localhost:4300';
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
  const base = (process.env.NEEM_OPS_URL || 'http://localhost:4300').replace(/\/?(?:#.*)?$/, '');
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
  const phone = normalizeDigits(req.body.phone || '').trim();
  if (!PHONE_RE.test(phone)) return res.status(400).json({ error: 'شماره موبایل معتبر نیست' });
  const code = String(crypto.randomInt(10000, 99999));
  otps.set(phone, { code, expiresAt: Date.now() + (db.settings.otpTtlMs || 120000) });
  const demoOtp = process.env.OTP_DEMO_MODE === 'true' || process.env.NODE_ENV !== 'production';
  if (!demoOtp) {
    otps.delete(phone);
    return res.status(503).json({ error: 'ارسال OTP در محیط تولید هنوز پیکربندی نشده است' });
  }
  console.log(`[OTP:demo] ${phone} -> ${code}`);
  res.json({ ok: true, demo: true, code, ttlMs: db.settings.otpTtlMs || 120000 });
});

app.post('/api/auth/verify-otp', (req, res) => {
  const phone = normalizeDigits(req.body.phone || '').trim();
  const code = normalizeDigits(req.body.code || '').trim();
  const entry = otps.get(phone);
  if (!entry || entry.expiresAt < Date.now()) return res.status(400).json({ error: 'کد منقضی شده است؛ دوباره درخواست دهید' });
  if (entry.code !== code) return res.status(400).json({ error: 'کد واردشده درست نیست' });
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
  res.setHeader('Set-Cookie', `westo_session=${encodeURIComponent(makeToken(phone))}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}${secureCookie ? '; Secure' : ''}`);
  res.json({ ok: true, user: publicUser(user) });
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
  const { name, email } = req.body;
  if (typeof name === 'string') req.user.name = name.trim().slice(0, 100);
  if (typeof email === 'string') req.user.email = email.trim().slice(0, 200);
  save();
  res.json({ ok: true, user: publicUser(req.user) });
});

// --- content ---
function publicGuestMenuPayload(query = {}) {
  let items = db.menuItems;
  if (!query.all) {
    items = items.filter((m) => m.available !== false && itemVisibleNow(m));
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
    menuItems: items,
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

function publicContentPayload() {
  const menu = publicGuestMenuPayload();
  const restaurantPayload = publicRestaurantPayload();
  return {
    content: db.content,
    products: db.products,
    // Keep the historical top-level fields for content-overrides.js and older
    // static builds while publishing exact current menu/restaurant payloads for
    // the performance loader. This removes two startup API round trips without
    // changing the public API contracts.
    menuCategories: db.menuCategories,
    menuItems: db.menuItems.filter((m) => m.available !== false),
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

function staffMenuPayload() {
  return {
    menuCategories: db.menuCategories || [],
    menuItems: (db.menuItems || []).filter((item) => item.available !== false && itemVisibleNow(item)),
    menuComplements: (db.menuComplements || []).filter((item) => item.available !== false && (item.stock == null || Number(item.stock) > 0)),
    menuComplementRules: (db.menuComplementRules || []).filter((rule) => rule.active !== false),
    menuRevision: db.menuRevision || 0,
  };
}

app.get('/api/staff/menu', requireCapability('orders.create'), (req, res) => {
  res.json(staffMenuPayload());
});

function normalizeComplementInput(input = {}, current = {}) {
  const img = input.img !== undefined ? sanitizeMenuImg(input.img) : (current.img || '');
  if (img === null) return { error: 'مسیر تصویر مکمل نامعتبر است' };
  const stockRaw = input.stock !== undefined ? input.stock : current.stock;
  const stock = stockRaw == null || stockRaw === '' ? null : Math.max(0, Math.round(Number(stockRaw) || 0));
  const complement = {
    ...current,
    name: String(input.name !== undefined ? input.name : current.name || '').trim().slice(0, 120),
    price: Math.max(0, Math.round(Number(input.price !== undefined ? input.price : current.price) || 0)),
    img: img || '',
    available: input.available !== undefined ? input.available !== false : current.available !== false,
    stock,
    lowStockAt: Math.max(0, Math.round(Number(input.lowStockAt !== undefined ? input.lowStockAt : current.lowStockAt) || 5)),
  };
  if (!complement.name) return { error: 'نام مکمل را وارد کنید' };
  if (stock === 0) complement.available = false;
  return { complement };
}

function normalizeComplementRuleInput(input = {}, current = {}) {
  const validCategoryIds = new Set((db.menuCategories || []).map((item) => Number(item.id)));
  const validItemIds = new Set((db.menuItems || []).map((item) => Number(item.id)));
  const validComplementIds = new Set((db.menuComplements || []).map((item) => Number(item.id)));
  const ids = (value, valid) => [...new Set((Array.isArray(value) ? value : []).map(Number).filter((id) => Number.isFinite(id) && valid.has(id)))];
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
  const complement = (db.menuComplements || []).find((item) => Number(item.id) === Number(req.params.id));
  if (!complement) return res.status(404).json({ error: 'مکمل پیدا نشد' });
  const normalized = normalizeComplementInput(req.body || {}, complement);
  if (normalized.error) return res.status(400).json(normalized);
  Object.assign(complement, normalized.complement);
  save({ bumpMenu: true });
  res.json({ ok: true, complement });
});

app.delete('/api/admin/menu-complements/:id', requireCapability('menu.manage'), (req, res) => {
  const id = Number(req.params.id);
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
  const rule = (db.menuComplementRules || []).find((item) => Number(item.id) === Number(req.params.id));
  if (!rule) return res.status(404).json({ error: 'قانون مکمل پیدا نشد' });
  const normalized = normalizeComplementRuleInput(req.body || {}, rule);
  if (normalized.error) return res.status(400).json(normalized);
  Object.assign(rule, normalized.rule);
  save({ bumpMenu: true });
  res.json({ ok: true, rule });
});

app.delete('/api/admin/menu-complement-rules/:id', requireCapability('menu.manage'), (req, res) => {
  const id = Number(req.params.id);
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
      engine: process.env.OPENAI_API_KEY ? 'openai' : 'glossary',
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
  const ids = Array.isArray(req.body.ids) ? req.body.ids.map(Number) : null;
  const langs = Array.isArray(req.body.langs) && req.body.langs.length
    ? req.body.langs.map(String)
    : ['en', 'ar'];
  let targets = db.menuItems || [];
  if (ids) targets = targets.filter((m) => ids.includes(m.id));
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
    engine: process.env.OPENAI_API_KEY ? 'openai' : 'glossary',
    items: updated,
  });
});

app.post('/api/admin/translate/menu/:id', requireAdmin, async (req, res) => {
  const item = db.menuItems.find((m) => m.id === Number(req.params.id));
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
  const cat = db.menuCategories.find((c) => c.id === Number(req.params.id));
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
  const id = Number(req.params.id);
  const cat = db.menuCategories.find((c) => c.id === id);
  if (!cat) return res.status(404).json({ error: 'دسته پیدا نشد' });
  const inUse = (db.menuItems || []).some((m) => m.categoryId === id);
  if (inUse) {
    return res.status(400).json({ error: 'ابتدا غذاهای این دسته را جابه‌جا یا حذف کنید' });
  }
  if (db.menuCategories.length <= 1) {
    return res.status(400).json({ error: 'حداقل یک دسته باید باقی بماند' });
  }
  db.menuCategories = db.menuCategories.filter((c) => c.id !== id);
  save({ rebuildProducts: true });
  res.json({ ok: true, menuCategories: db.menuCategories, products: db.products });
});

app.put('/api/menu/:id', requireAdmin, (req, res) => {
  const item = db.menuItems.find((m) => m.id === Number(req.params.id));
  if (!item) return res.status(404).json({ error: 'not found' });
  // Simple dirty-lock: reject concurrent price+stock writes with mismatched revisions.
  const clientRev = req.body._rev != null ? Number(req.body._rev) : null;
  const itemRev = Number(item.updatedAt) || 0;
  if (clientRev != null && itemRev && clientRev < itemRev) {
    return res.status(409).json({
      error: 'این آیتم هم‌زمان از جای دیگری تغییر کرده — صفحه را تازه کنید',
      item,
    });
  }
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
    const cid = Number(req.body.categoryId);
    if ((db.menuCategories || []).some((c) => c.id === cid)) item.categoryId = cid;
  }
  if (typeof req.body.price === 'number' && req.body.price >= 0) item.price = Math.round(req.body.price);
  if (typeof req.body.available === 'boolean') item.available = req.body.available;
  if (Array.isArray(req.body.allergens)) item.allergens = normalizeAllergens(req.body.allergens);
  if (Array.isArray(req.body.dayparts)) item.dayparts = normalizeDayparts(req.body.dayparts);
  if (req.body.stock === null || req.body.stock === '') item.stock = null;
  else if (typeof req.body.stock === 'number' && req.body.stock >= 0) {
    item.stock = Math.round(req.body.stock);
    if (item.stock === 0) item.available = false;
    else if (item.available === false && item.stock > 0) {
      /* keep manual sold-out unless explicitly restocked via available */
    }
  }
  if (typeof req.body.lowStockAt === 'number' && req.body.lowStockAt >= 0) {
    item.lowStockAt = Math.round(req.body.lowStockAt);
  }
  item.updatedAt = Date.now();
  save({ rebuildProducts: true });
  res.json({ ok: true, item });
});

app.post('/api/menu', requireAdmin, (req, res) => {
  const id = Math.max(0, ...db.menuItems.map((m) => m.id)) + 1;
  const stock =
    req.body.stock === null || req.body.stock === '' || req.body.stock === undefined
      ? null
      : Math.max(0, Math.round(Number(req.body.stock) || 0));
  const imgRaw = typeof req.body.img === 'string' ? sanitizeMenuImg(req.body.img) : '';
  if (imgRaw === null) return res.status(400).json({ error: 'مسیر تصویر نامعتبر است' });
  const item = {
    id,
    categoryId: Number(req.body.categoryId) || (db.menuCategories[0] || {}).id || 0,
    name: String(req.body.name || '').trim().slice(0, 120),
    en: String(req.body.en || '').trim().slice(0, 120),
    ar: String(req.body.ar || '').trim().slice(0, 120),
    desc: String(req.body.desc || '').trim().slice(0, 500),
    descEn: String(req.body.descEn || '').trim().slice(0, 500),
    descAr: String(req.body.descAr || '').trim().slice(0, 500),
    price: Math.max(0, Math.round(Number(req.body.price) || 0)),
    available: req.body.available !== false && stock !== 0,
    allergens: normalizeAllergens(req.body.allergens),
    dayparts: normalizeDayparts(req.body.dayparts),
    stock,
    lowStockAt: typeof req.body.lowStockAt === 'number' ? Math.round(req.body.lowStockAt) : 5,
  };
  if (imgRaw) item.img = imgRaw;
  if (!item.name) return res.status(400).json({ error: 'نام را وارد کنید' });
  db.menuItems.push(item);
  save({ rebuildProducts: true });
  res.json({ ok: true, item });
});
app.delete('/api/menu/:id', requireAdmin, (req, res) => {
  db.menuItems = db.menuItems.filter((m) => m.id !== Number(req.params.id));
  save({ rebuildProducts: true });
  res.json({ ok: true });
});

// --- orders ---
function orderLinesFromRequest(rawItems, { allowMenuItemIds = new Set(), allowComplementIds = new Set() } = {}) {
  const items = Array.isArray(rawItems) ? rawItems : [];
  const lines = [];
  let subtotal = 0;
  const requestedMenuQty = new Map();
  const requestedComplementQty = new Map();
  for (const line of items) {
    const menuItemId = Number(line.menuItemId);
    const menuItem = db.menuItems.find((item) => item.id === menuItemId && (item.available !== false || allowMenuItemIds.has(menuItemId)));
    if (!menuItem || (!allowMenuItemIds.has(menuItemId) && !itemVisibleNow(menuItem))) continue;
    const qty = Math.min(99, Math.max(1, Math.round(Number(line.qty) || 1)));
    const accumulatedMenuQty = (requestedMenuQty.get(menuItemId) || 0) + qty;
    if (typeof menuItem.stock === 'number' && menuItem.stock < accumulatedMenuQty) {
      return { error: `موجودی «${menuItem.name}» کافی نیست (باقی‌مانده: ${menuItem.stock})` };
    }
    requestedMenuQty.set(menuItemId, accumulatedMenuQty);
    const price = Math.max(0, Number(menuItem.price) || 0);
    const allowedModifierPrices = new Map([
      ['تند', 0], ['بدون پیاز', 0], ['بدون سس', 0], ['بدون پنیر', 0],
      ['پنیر اضافه', 120000], ['آووکادو', 180000], ['بیکن', 220000], ['سس اضافه', 60000],
    ]);
    const modifiers = (Array.isArray(line.modifiers) ? line.modifiers : [])
      .slice(0, 12)
      .map((modifier) => String(modifier?.name || modifier || '').trim().slice(0, 60))
      .filter((name) => allowedModifierPrices.has(name))
      .map((name) => ({ name, price: allowedModifierPrices.get(name) }));
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
    lines.push({
      menuItemId: menuItem.id,
      name: menuItem.name,
      price,
      qty,
      modifiers,
      complements,
      note: String(line.note || '').trim().slice(0, 180),
      seat: Math.min(99, Math.max(0, Math.round(Number(line.seat) || 0))),
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

function adjustOrderInventory(lines, direction) {
  for (const line of lines || []) {
    const menuItem = (db.menuItems || []).find((item) => Number(item.id) === Number(line.menuItemId));
    if (menuItem && typeof menuItem.stock === 'number') {
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

function findOrderBranch(input, tableNo, fulfillment) {
  const selected = resolveBranch(input.branchId || input.branch);
  if (fulfillment !== 'dine_in') return selected || defaultBranch();
  const table = (db.tables || []).find((item) => String(item.id) === tableNo || String(item.label) === tableNo);
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
  const tableNo = String(input.tableNo || '').trim().slice(0, 20);
  const fulfillment = normalizeFulfillment(input.fulfillment, { tableNo });
  const phone = normalizeDigits(input.phone || '').trim();
  const name = String(input.name || '').trim().slice(0, 100);
  const paymentMethod = input.paymentMethod === 'online' ? 'online' : 'cashier';
  const normalizedKey = String(idempotencyKey || '').trim().slice(0, 160);

  if ((requireTable || fulfillment === 'dine_in') && !tableNo) return { error: 'شماره میز را وارد کنید' };
  if ((requirePhone || phone) && !PHONE_RE.test(phone)) return { error: 'شماره موبایل معتبر نیست' };
  if (!Array.isArray(input.items) || !input.items.length) return { error: 'تیبل خالی است' };
  if (normalizedKey && db.checkoutIdempotency?.[normalizedKey]) {
    const saved = db.checkoutIdempotency[normalizedKey];
    const order = (db.orders || []).find((item) => Number(item.id) === Number(saved.orderId));
    const payment = (db.paymentAttempts || []).find((item) => Number(item.id) === Number(saved.paymentAttemptId));
    if (order) return { order, payment, idempotent: true, whatsapp: null };
  }

  const lineResult = orderLinesFromRequest(input.items);
  if (lineResult.error) return lineResult;
  const branch = findOrderBranch(input, tableNo, fulfillment);
  if (!branch) return { error: 'شعبه پیدا نشد' };
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
    if (menuItem && typeof menuItem.stock === 'number') {
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
  const order = {
    id: nextId(db.orders),
    orderNo: `W-${String(Date.now()).slice(-6)}-${nextId(db.orders)}`,
    tableNo: fulfillment === 'dine_in' ? tableNo : '',
    phone,
    name,
    branchId: branch.id,
    fulfillment,
    paymentMethod,
    paymentStatus: paymentMethod === 'online' ? 'pending' : 'unpaid',
    status: initialOrderStatus({ paymentMethod, fulfillment }),
    items: lineResult.lines,
    subtotal: lineResult.subtotal,
    deliveryFee: fulfillmentQuote.deliveryFee,
    total: fulfillmentQuote.total,
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
  publishOperationalEvent('order.created', { orderId: order.id, branchId: order.branchId, status: order.status });
  neemBridge.enqueueOrder(order, payment);
  const notify = await notifyOrderWhatsApp(db, order);
  save();
  return { order, payment, whatsapp: notify.skipped ? null : notify };
}

function settlePaymentAttempt(payment, { status = 'paid', reference = '', source = 'sandbox' } = {}) {
  if (!payment) return { error: 'payment_not_found' };
  if (!['paid', 'failed', 'cancelled', 'refunded'].includes(status)) return { error: 'payment_status_invalid' };
  const alreadyPaid = payment.status === 'paid' && status === 'paid';
  payment.status = status;
  if (!alreadyPaid || reference) payment.reference = String(reference || payment.reference || '').trim().slice(0, 160);
  if (!alreadyPaid) payment.updatedAt = new Date().toISOString();
  const order = (db.orders || []).find((item) => Number(item.id) === Number(payment.orderId));
  let financeResult = null;
  if (order) {
    order.paymentStatus = status;
    if (status === 'paid' && ['pending_online', 'awaiting_confirmation'].includes(order.status)) {
      appendOrderStatus(order, 'paid', null, { paymentAttemptId: payment.id, source });
    }
    if (status === 'paid') {
      financeResult = financeV2.captureOnlinePaidOrder(db, order, payment, { actor: `gateway:${payment.provider || source}`, occurredAt: payment.updatedAt });
    }
  }
  recordAudit(null, `payment.${status}`, 'payment', payment.id, { orderId: payment.orderId, source }, payment.branchId);
  publishOperationalEvent('payment.updated', { paymentId: payment.id, orderId: payment.orderId, branchId: payment.branchId, status });
  if (order) publishOperationalEvent('order.updated', { orderId: order.id, branchId: order.branchId, status: order.status });
  if (order) neemBridge.enqueueOrder(order, payment);
  save();
  return { payment, order, finance: financeResult, idempotent: alreadyPaid };
}

app.get('/api/checkout/meta', (req, res) => {
  const branch = resolveBranch(req.query.branchId || req.query.branch);
  res.json({
    payment: { mode: db.paymentProvider?.mode || 'sandbox', provider: db.paymentProvider?.provider || 'sandbox', onlineEnabled: db.paymentProvider?.enabled !== false },
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
  res.json({ ok: true, subtotal: lineResult.subtotal, ...quote, branchId: branch?.id || null });
});

app.post('/api/checkout/orders', async (req, res) => {
  const result = await createCheckoutOrder(req.body || {}, {
    idempotencyKey: req.get('Idempotency-Key') || req.body?.idempotencyKey,
  });
  if (result.error) return res.status(400).json(result);
  res.status(result.idempotent ? 200 : 201).json({
    ok: true,
    idempotent: !!result.idempotent,
    order: result.order,
    payment: result.payment
      ? { ...publicPaymentAttempt(result.payment), sandboxToken: result.payment.mode === 'sandbox' ? result.payment.sandboxToken : undefined }
      : null,
    whatsapp: result.whatsapp,
  });
});

app.post('/api/checkout/payments/:id/sandbox-confirm', (req, res) => {
  const payment = (db.paymentAttempts || []).find((item) => Number(item.id) === Number(req.params.id));
  if (!payment) return res.status(404).json({ error: 'payment_not_found' });
  if (payment.mode !== 'sandbox') return res.status(409).json({ error: 'sandbox_disabled' });
  if (!req.body?.token || req.body.token !== payment.sandboxToken) return res.status(403).json({ error: 'payment_token_invalid' });
  const result = settlePaymentAttempt(payment, { status: 'paid', reference: `sandbox-${payment.id}`, source: 'sandbox-confirm' });
  if (result.error) return res.status(400).json(result);
  res.json({ ok: true, idempotent: result.idempotent, payment: publicPaymentAttempt(result.payment), order: result.order });
});

app.post('/api/payments/webhook/:provider', (req, res) => {
  const payment = (db.paymentAttempts || []).find((item) => Number(item.id) === Number(req.body?.paymentAttemptId));
  if (!payment || payment.provider !== String(req.params.provider || '')) return res.status(404).json({ error: 'payment_not_found' });
  const secret = process.env.PAYMENT_WEBHOOK_SECRET;
  const signature = req.get('X-Westo-Payment-Signature');
  const validSandbox = payment.mode === 'sandbox' && req.body?.token === payment.sandboxToken;
  if (!validSandbox && (!secret || signature !== secret)) return res.status(401).json({ error: 'webhook_unauthorized' });
  const result = settlePaymentAttempt(payment, {
    status: String(req.body?.status || 'paid'),
    reference: req.body?.reference,
    source: `webhook:${payment.provider}`,
  });
  if (result.error) return res.status(400).json(result);
  res.json({ ok: true, idempotent: result.idempotent, payment: publicPaymentAttempt(result.payment), order: result.order });
});

// Existing table ordering clients keep their endpoint and response shape.
app.post('/api/orders', async (req, res) => {
  const result = await createCheckoutOrder(req.body || {}, { requireTable: true });
  if (result.error) return res.status(400).json(result);
  res.json({ ok: true, order: result.order, whatsapp: result.whatsapp });
});

app.get('/api/admin/orders', requireCapability('orders.view'), (req, res) => {
  let orders = (db.orders || []).slice();
  if (req.query.branchId) {
    const bid = Number(req.query.branchId);
    orders = orders.filter((o) => Number(o.branchId) === bid);
  }
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
  const result = await createCheckoutOrder(req.body || {}, {
    requireTable: String(req.body?.fulfillment || 'dine_in') === 'dine_in',
    requirePhone: false,
    idempotencyKey: req.get('Idempotency-Key') || '',
    actor: req.user,
  });
  if (result.error) return res.status(400).json(result);
  if (req.body?.sendToKitchen && result.order.paymentMethod !== 'online' && result.order.status === 'pay_at_cashier') {
    appendOrderStatus(result.order, 'sent_to_kitchen', req.user, { source: 'staff-pos', paymentStatus: result.order.paymentStatus });
    recordAudit(req, 'order.sent_to_kitchen', 'order', result.order.id, { paymentStatus: result.order.paymentStatus }, result.order.branchId);
    publishOperationalEvent('order.updated', { orderId: result.order.id, branchId: result.order.branchId, status: result.order.status });
    save();
  }
  res.status(201).json({ ok: true, order: result.order });
});

app.patch('/api/cashier/orders/:id', requireCapability('orders.manage'), (req, res) => {
  const order = (db.orders || []).find((item) => Number(item.id) === Number(req.params.id));
  if (!order) return res.status(404).json({ error: 'not found' });
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
  adjustOrderInventory(order.items, 1);
  const normalized = orderLinesFromRequest(req.body?.items, {
    allowMenuItemIds: existingMenuIds,
    allowComplementIds: existingComplementIds,
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

  adjustOrderInventory(normalized.lines, -1);
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

app.post('/api/cashier/orders/:id/settle', requireCapability('payments.manage'), (req, res) => {
  const order = (db.orders || []).find((item) => Number(item.id) === Number(req.params.id));
  if (!order) return res.status(404).json({ error: 'not found' });
  if (order.paymentStatus === 'paid') return res.json({ ok: true, idempotent: true, order });
  if (!['pay_at_cashier', 'awaiting_confirmation', 'sent_to_kitchen', 'preparing', 'ready'].includes(String(order.status || ''))) {
    return res.status(409).json({ error: 'order_not_payable', current: order.status });
  }
  const tender = String(req.body?.tender || 'cash');
  if (!['cash', 'card', 'manual_card', 'gift_card', 'card_on_file'].includes(tender)) return res.status(400).json({ error: 'tender_invalid' });
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
  publishOperationalEvent('order.updated', { orderId: order.id, branchId, status: order.status });
  save();
  res.json({ ok: true, order, drawer: drawer ? { session: drawer, totals: cashSessionTotals(drawer) } : null, finance: financeResult });
});

app.post('/api/cashier/orders/:id/receipt', requireCapability('payments.manage'), (req, res) => {
  const order = (db.orders || []).find((item) => Number(item.id) === Number(req.params.id));
  if (!order) return res.status(404).json({ error: 'not found' });
  if (order.paymentStatus !== 'paid') return res.status(409).json({ error: 'order_not_paid' });
  const method = String(req.body?.method || 'none');
  if (!['print', 'email', 'sms', 'none'].includes(method)) return res.status(400).json({ error: 'receipt_method_invalid' });
  order.receipt = {
    method,
    destination: String(req.body?.destination || '').trim().slice(0, 180),
    selectedAt: new Date().toISOString(),
    by: req.user.phone,
  };
  recordAudit(req, 'order.receipt_selected', 'order', order.id, { method }, order.branchId);
  save();
  res.json({ ok: true, order, deliveryConfigured: method === 'print' || method === 'none' });
});

app.patch('/api/cashier/orders/:id/status', requireCapability('orders.manage'), (req, res) => {
  const order = (db.orders || []).find((item) => Number(item.id) === Number(req.params.id));
  if (!order) return res.status(404).json({ error: 'not found' });
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
  const call = (db.waiterCalls || []).find((item) => Number(item.id) === Number(req.params.id));
  if (!call) return res.status(404).json({ error: 'not found' });
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
  const order = (db.orders || []).find((item) => Number(item.id) === Number(req.params.id));
  if (!order) return res.status(404).json({ error: 'not found' });
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

function cleanDeliveryZone(input, current = {}) {
  const branch = resolveBranch(input.branchId ?? current.branchId);
  return {
    id: current.id || nextId(db.deliveryZones),
    branchId: branch?.id || Number(current.branchId) || defaultBranch()?.id || 1,
    name: String(input.name ?? current.name ?? '').trim().slice(0, 100),
    active: typeof input.active === 'boolean' ? input.active : current.active !== false,
    minOrder: Math.max(0, Math.round(Number(input.minOrder ?? current.minOrder) || 0)),
    fee: Math.max(0, Math.round(Number(input.fee ?? current.fee) || 0)),
    etaMinutes: Math.max(0, Math.min(240, Math.round(Number(input.etaMinutes ?? current.etaMinutes) || 0))),
    sort: Math.max(0, Math.round(Number(input.sort ?? current.sort) || 0)),
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
  const current = (db.deliveryZones || []).find((item) => Number(item.id) === Number(req.params.id));
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
  const zone = (db.deliveryZones || []).find((item) => Number(item.id) === Number(req.params.id));
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
  const pts = pointsForOrderTotal(order.total);
  if (pts <= 0) return;
  awardLoyaltyPoints(order.phone, pts, 'order', { orderId: order.id, total: order.total });
  order.loyaltyAwarded = true;
  order.loyaltyPoints = pts;
}

app.patch('/api/admin/orders/:id', requireCapability('orders.manage'), (req, res) => {
  if (!['owner', 'manager'].includes(effectiveRole(req.user))) return res.status(403).json({ error: 'supervisor_required' });
  const order = db.orders.find((o) => o.id === Number(req.params.id));
  if (!order) return res.status(404).json({ error: 'not found' });
  const allowed = ['pending_online', 'awaiting_confirmation', 'pay_at_cashier', 'sent_to_kitchen', 'paid', 'preparing', 'ready', 'dispatched', 'picked_up', 'delivered', 'done', 'cancelled'];
  if (typeof req.body.status === 'string' && allowed.includes(req.body.status)) {
    appendOrderStatus(order, req.body.status, req.user, { source: 'legacy-admin' });
    if (['paid', 'preparing', 'ready', 'dispatched', 'picked_up', 'delivered', 'done'].includes(req.body.status)) {
      order.paymentStatus = 'paid';
      financeV2.capturePaidOrder(db, order, { actor: req.user.phone });
    }
    if (['done', 'picked_up', 'delivered'].includes(req.body.status)) {
      maybeAwardOrderLoyalty(order);
    }
    recordAudit(req, 'order.status_changed', 'order', order.id, { status: req.body.status, source: 'legacy-admin' }, order.branchId);
    publishOperationalEvent('order.updated', { orderId: order.id, branchId: order.branchId, status: order.status });
    neemBridge.enqueueOrder(order, (db.paymentAttempts || []).find((item) => Number(item.orderId) === Number(order.id)) || null);
  }
  save();
  res.json({ ok: true, order });
});

// Versioned endpoint for new clients: status changes must follow the state
// machine, while the legacy route above remains backwards compatible.
app.patch('/api/v2/orders/:id/status', requireCapability('orders.manage'), (req, res) => {
  if (!['owner', 'manager'].includes(effectiveRole(req.user))) return res.status(403).json({ error: 'supervisor_required' });
  const order = (db.orders || []).find((item) => Number(item.id) === Number(req.params.id));
  const status = String(req.body?.status || '');
  if (!order) return res.status(404).json({ error: 'not found' });
  if (status === String(order.status || '')) return res.json({ ok: true, idempotent: true, order });
  if (!canTransitionOrder(order, status)) {
    return res.status(409).json({ error: 'order_transition_invalid', current: order.status, allowed: allowedOrderTransitions(order) });
  }
  appendOrderStatus(order, status, req.user, { source: 'v2' });
  if (['paid', 'preparing', 'ready', 'dispatched', 'picked_up', 'delivered', 'done'].includes(status)) {
    order.paymentStatus = 'paid';
    financeV2.capturePaidOrder(db, order, { actor: req.user.phone });
  }
  if (['done', 'picked_up', 'delivered'].includes(status)) maybeAwardOrderLoyalty(order);
  recordAudit(req, 'order.status_changed', 'order', order.id, { status, source: 'v2' }, order.branchId);
  publishOperationalEvent('order.updated', { orderId: order.id, branchId: order.branchId, status: order.status });
  neemBridge.enqueueOrder(order, (db.paymentAttempts || []).find((item) => Number(item.orderId) === Number(order.id)) || null);
  save();
  res.json({ ok: true, order });
});

/* ---- Kitchen Display System (KDS) ---- */
const KDS_STATIONS = Object.freeze([
  { id: 'expo', label: 'اکسپو' },
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
  if (raw == null || raw === '') return defaultBranch()?.id || null;
  const id = Number(raw);
  const branch = Number.isFinite(id) ? (db.branches || []).find((entry) => Number(entry.id) === id && entry.active !== false) : null;
  return branch?.id || null;
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
  const order = db.orders.find((o) => o.id === Number(req.params.id) && Number(o.branchId) === Number(branchId));
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
  const item = (db.menuItems || []).find((entry) => Number(entry.id) === Number(req.params.id));
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
  const tableNo = String(req.body.tableNo || '').trim().slice(0, 20);
  if (!tableNo) return res.status(400).json({ error: 'شماره میز لازم است' });
  const note = String(req.body.note || '').trim().slice(0, 120);
  let branchId = Number(req.body.branchId) || null;
  if (!branchId) {
    const tableMatch = (db.tables || []).find(
      (t) => String(t.id) === tableNo || String(t.label) === tableNo
    );
    branchId = tableMatch?.branchId || defaultBranch()?.id || 1;
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
  save();
  res.json({ ok: true, call });
});

app.get('/api/kitchen/calls', requireCapability('service.manage'), (req, res) => {
  const bid = req.query.branchId ? Number(req.query.branchId) : null;
  const calls = (db.waiterCalls || [])
    .filter((c) => c.status === 'open')
    .filter((c) => (bid ? Number(c.branchId) === bid : true))
    .slice(0, 40);
  res.json({ calls });
});

app.patch('/api/kitchen/calls/:id', requireCapability('service.manage'), (req, res) => {
  const call = (db.waiterCalls || []).find((c) => c.id === Number(req.params.id));
  if (!call) return res.status(404).json({ error: 'not found' });
  if (req.body.status === 'done' || req.body.status === 'open') call.status = req.body.status;
  call.resolvedAt = new Date().toISOString();
  save();
  res.json({ ok: true, call });
});

// --- FAQ ---
app.post('/api/faq', requireAdmin, (req, res) => {
  const id = Math.max(0, ...db.faq.map((f) => f.id)) + 1;
  const item = { id, q: String(req.body.q || ''), a: String(req.body.a || '') };
  db.faq.push(item);
  save();
  res.json({ ok: true, item });
});
app.put('/api/faq/:id', requireAdmin, (req, res) => {
  const item = db.faq.find((f) => f.id === Number(req.params.id));
  if (!item) return res.status(404).json({ error: 'not found' });
  if (typeof req.body.q === 'string') item.q = req.body.q;
  if (typeof req.body.a === 'string') item.a = req.body.a;
  save();
  res.json({ ok: true, item });
});
app.delete('/api/faq/:id', requireAdmin, (req, res) => {
  db.faq = db.faq.filter((f) => f.id !== Number(req.params.id));
  save();
  res.json({ ok: true });
});
app.put('/api/faq-order', requireAdmin, (req, res) => {
  const order = req.body.order || [];
  db.faq.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  save();
  res.json({ ok: true, faq: db.faq });
});

// --- admin: users ---
app.get('/api/admin/users', requireOwner, (req, res) => {
  res.json({ users: db.users.map(publicUser) });
});
app.patch('/api/admin/users/:phone', requireOwner, (req, res) => {
  const user = db.users.find((u) => u.phone === req.params.phone);
  if (!user) return res.status(404).json({ error: 'not found' });
  if (typeof req.body.blocked === 'boolean') user.blocked = req.body.blocked;
  const requestedRole = String(req.body.role || '').trim().toLowerCase();
  const roleMap = { admin: 'owner', user: 'guest', owner: 'owner', manager: 'manager', cashier: 'cashier', waiter: 'waiter', kitchen: 'kitchen', guest: 'guest' };
  if (roleMap[requestedRole]) user.role = roleMap[requestedRole];
  recordAudit(req, 'user.access_updated', 'user', user.phone, { role: user.role, blocked: !!user.blocked });
  save();
  res.json({ ok: true, user: publicUser(user) });
});
app.delete('/api/admin/users/:phone', requireOwner, (req, res) => {
  const user = db.users.find((u) => u.phone === req.params.phone);
  db.users = db.users.filter((u) => u.phone !== req.params.phone);
  if (user) recordAudit(req, 'user.deleted', 'user', user.phone, { role: user.role });
  save();
  res.json({ ok: true });
});

// --- newsletter ---
app.post('/api/newsletter', (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'ایمیل معتبر نیست' });
  if (!db.newsletter.find((n) => n.email === email)) {
    db.newsletter.push({ email, at: new Date().toISOString() });
    save();
  }
  res.json({ ok: true });
});
app.get('/api/admin/newsletter', requireAdmin, (req, res) => {
  res.json({ newsletter: db.newsletter });
});

// --- admin: stats / uploads / settings ---
app.get('/api/admin/stats', requireAdmin, (req, res) => {
  const now = Date.now();
  const dayMs = 24 * 3600 * 1000;
  const weekAgo = now - 7 * dayMs;
  const dayAgo = now - dayMs;
  const bid = req.query.branchId ? Number(req.query.branchId) : null;
  let orders = db.orders || [];
  if (bid) orders = orders.filter((o) => Number(o.branchId) === bid);
  const paidLike = orders.filter((o) => !['cancelled'].includes(o.status));
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

  res.json({
    users: db.users.length,
    newsletter: db.newsletter.length,
    orders: orders.length,
    openOrders: orders.filter((o) => !['done', 'cancelled', 'paid'].includes(o.status)).length,
    menuItems: (db.menuItems || []).length,
    unavailable: (db.menuItems || []).filter((m) => m.available === false).length,
    lowStock: (db.menuItems || []).filter(
      (m) => typeof m.stock === 'number' && m.stock > 0 && m.stock <= (m.lowStockAt ?? 5)
    ).length,
    outOfStock: (db.menuItems || []).filter((m) => m.stock === 0).length,
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
  if (typeof r.taxPercent === 'number') db.restaurant.taxPercent = Math.max(0, Math.min(100, r.taxPercent));
  if (typeof r.servicePercent === 'number') db.restaurant.servicePercent = Math.max(0, Math.min(100, r.servicePercent));
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
  const bid = Number(req.body.branchId) || defaultBranch()?.id || 1;
  const others = (db.tables || []).filter((t) => Number(t.branchId) !== bid);
  const updated = req.body.tables.slice(0, 80).map((t, i) => ({
    id: Number(t.id) || i + 1,
    label: String(t.label || `میز ${i + 1}`).slice(0, 40),
    seats: Math.max(1, Math.min(20, Number(t.seats) || 4)),
    zone: String(t.zone || 'سالن').slice(0, 40),
    active: t.active !== false,
    branchId: bid,
  }));
  db.tables = [...others, ...updated].sort((a, b) => a.id - b.id);
  save();
  res.json({ ok: true, tables: updated });
});
app.post('/api/admin/tables', requireAdmin, (req, res) => {
  const id = Math.max(0, ...db.tables.map((t) => t.id), 0) + 1;
  const branchId = Number(req.body.branchId) || defaultBranch()?.id || 1;
  const table = {
    id,
    label: String(req.body.label || `میز ${id}`).slice(0, 40),
    seats: Math.max(1, Math.min(20, Number(req.body.seats) || 4)),
    zone: String(req.body.zone || 'سالن').slice(0, 40),
    active: true,
    branchId,
  };
  db.tables.push(table);
  save();
  res.json({ ok: true, table });
});
app.delete('/api/admin/tables/:id', requireAdmin, (req, res) => {
  db.tables = db.tables.filter((t) => t.id !== Number(req.params.id));
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
  const branch = (db.branches || []).find((b) => b.id === Number(req.params.id));
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
  const id = Number(req.params.id);
  if ((db.branches || []).length <= 1) {
    return res.status(400).json({ error: 'حداقل یک شعبه لازم است' });
  }
  const fallback = (db.branches || []).find((b) => b.id !== id);
  db.branches = (db.branches || []).filter((b) => b.id !== id);
  for (const t of db.tables || []) {
    if (Number(t.branchId) === id) t.branchId = fallback.id;
  }
  for (const o of db.orders || []) {
    if (Number(o.branchId) === id) o.branchId = fallback.id;
  }
  syncLegacyHours();
  save();
  res.json({ ok: true });
});

app.get('/api/admin/promotions', requireAdmin, (req, res) => {
  res.json({ promotions: db.promotions || [] });
});
app.post('/api/admin/promotions', requireAdmin, (req, res) => {
  const id = Math.max(0, ...(db.promotions || []).map((p) => p.id), 0) + 1;
  const promo = {
    id,
    title: String(req.body.title || '').trim().slice(0, 120),
    percent: Math.max(0, Math.min(90, Math.round(Number(req.body.percent) || 0))),
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
  const promo = (db.promotions || []).find((p) => p.id === Number(req.params.id));
  if (!promo) return res.status(404).json({ error: 'not found' });
  if (typeof req.body.title === 'string') promo.title = req.body.title.trim().slice(0, 120);
  if (typeof req.body.percent === 'number') promo.percent = Math.max(0, Math.min(90, Math.round(req.body.percent)));
  if (typeof req.body.code === 'string') promo.code = req.body.code.trim().slice(0, 32).toUpperCase();
  if (typeof req.body.active === 'boolean') promo.active = req.body.active;
  if (req.body.endsAt !== undefined) promo.endsAt = req.body.endsAt;
  save();
  res.json({ ok: true, promo });
});
app.delete('/api/admin/promotions/:id', requireAdmin, (req, res) => {
  db.promotions = (db.promotions || []).filter((p) => p.id !== Number(req.params.id));
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
  const index = (db.promoSlides || []).findIndex((slide) => Number(slide.id) === Number(req.params.id));
  if (index < 0) return res.status(404).json({ error: 'not found' });
  const updated = sanitizePromoSlideInput(req.body || {}, db.promoSlides[index]);
  updated.updatedAt = new Date().toISOString();
  db.promoSlides[index] = updated;
  save();
  res.json({ ok: true, slide: updated });
});

app.delete('/api/admin/promo-slides/:id', requireCapability('content.manage'), (req, res) => {
  db.promoSlides = (db.promoSlides || []).filter((slide) => Number(slide.id) !== Number(req.params.id));
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
  const slide = (db.promoSlides || []).find((item) => Number(item.id) === Number(req.params.id));
  if (slide) { slide.impressions = (Number(slide.impressions) || 0) + 1; save(); }
  res.status(204).end();
});

app.post('/api/promo-slides/:id/click', (req, res) => {
  const slide = (db.promoSlides || []).find((item) => Number(item.id) === Number(req.params.id));
  if (slide) { slide.clicks = (Number(slide.clicks) || 0) + 1; save(); }
  res.status(204).end();
});

/* Bulk price update — percent or absolute delta */
app.post('/api/admin/prices/bulk', requireAdmin, (req, res) => {
  const mode = req.body.mode === 'set' ? 'set' : req.body.mode === 'delta' ? 'delta' : 'percent';
  const value = Number(req.body.value);
  const categoryId = req.body.categoryId != null ? Number(req.body.categoryId) : null;
  if (!Number.isFinite(value)) return res.status(400).json({ error: 'مقدار نامعتبر' });
  let n = 0;
  for (const item of db.menuItems) {
    if (categoryId != null && item.categoryId !== categoryId) continue;
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
  if (typeof t.radius === 'number') db.theme.radius = Math.max(0, Math.min(28, Math.round(t.radius)));
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
      const extByMime = { 'image/jpeg': '.jpg', 'image/jpg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/avif': '.avif', 'image/gif': '.gif' };
      const ext = extByMime[String(file.mimetype || '').toLowerCase()] || '.bin';
      cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`);
    },
  }),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /^image\/(jpeg|jpg|png|webp|avif|gif)$/i.test(file.mimetype || '');
    cb(ok ? null : new Error('فقط تصویر JPEG/PNG/WebP/AVIF مجاز است'), ok);
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
  const item = db.menuItems.find((m) => m.id === Number(req.body.id));
  if (!item) return res.status(404).json({ error: 'not found' });
  if (req.body.stock === null || req.body.mode === 'unlimited') {
    item.stock = null;
  } else if (req.body.mode === 'set') {
    item.stock = Math.max(0, Math.round(Number(req.body.stock) || 0));
  } else {
    const delta = Math.round(Number(req.body.delta) || 0);
    const base = typeof item.stock === 'number' ? item.stock : 0;
    item.stock = Math.max(0, base + delta);
  }
  if (item.stock === 0) item.available = false;
  else if (typeof item.stock === 'number' && item.stock > 0 && req.body.restock === true) {
    item.available = true;
  }
  if (typeof req.body.lowStockAt === 'number') item.lowStockAt = Math.max(0, Math.round(req.body.lowStockAt));
  save();
  res.json({ ok: true, item });
});

app.get('/api/admin/loyalty', requireAdmin, (req, res) => {
  const members = db.users
    .map(publicUser)
    .sort((a, b) => b.points - a.points);
  res.json({
    loyalty: db.loyalty,
    members,
    ledger: (db.loyaltyLedger || []).slice(0, 80),
    totals: {
      members: members.filter((m) => m.points > 0).length,
      pointsIssued: members.reduce((s, m) => s + m.points, 0),
    },
  });
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
  res.json({ ok: true, entry, user: publicUser(user) });
});

app.get('/api/loyalty/me', requireAuth, (req, res) => {
  res.json({
    points: Math.max(0, Math.round(Number(req.user.points) || 0)),
    loyalty: {
      enabled: !!db.loyalty?.enabled,
      pointsPerToman: db.loyalty?.pointsPerToman ?? 0,
      redeemValue: db.loyalty?.redeemValue ?? 0,
      welcomePoints: db.loyalty?.welcomePoints ?? 0,
    },
    ledger: (db.loyaltyLedger || []).filter((e) => e.phone === req.user.phone).slice(0, 20),
  });
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
      ACTIVE_RES_STATUSES.has(r.status)
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
  const note = String(req.body.note || '').trim().slice(0, 200);
  const partySize = Math.max(1, Math.min(Number(settings.maxParty) || 12, Math.round(Number(req.body.partySize) || 2)));
  const branch = resolveBranch(req.body.branchId || req.body.branch);
  if (!name) return res.status(400).json({ error: 'نام لازم است' });
  if (!PHONE_RE.test(phone)) return res.status(400).json({ error: 'شماره موبایل معتبر نیست' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return res.status(400).json({ error: 'تاریخ نامعتبر' });
  if (!/^\d{2}:\d{2}$/.test(time)) return res.status(400).json({ error: 'ساعت نامعتبر' });
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
  let list = (db.reservations || []).slice();
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
  const item = (db.reservations || []).find((r) => r.id === Number(req.params.id));
  if (!item) return res.status(404).json({ error: 'not found' });
  const allowed = ['pending', 'confirmed', 'seated', 'cancelled', 'no_show'];
  if (typeof req.body.status === 'string' && allowed.includes(req.body.status)) {
    item.status = req.body.status;
    item.statusAt = new Date().toISOString();
  }
  if (typeof req.body.note === 'string') item.note = req.body.note.trim().slice(0, 200);
  if (typeof req.body.partySize === 'number') {
    item.partySize = Math.max(1, Math.min(Number(db.reservationSettings?.maxParty) || 12, Math.round(req.body.partySize)));
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
  if (typeof s.enabled === 'boolean') db.reservationSettings.enabled = s.enabled;
  if (typeof s.slotMinutes === 'number') {
    db.reservationSettings.slotMinutes = Math.max(15, Math.min(120, Math.round(s.slotMinutes)));
  }
  if (typeof s.maxParty === 'number') {
    db.reservationSettings.maxParty = Math.max(1, Math.min(40, Math.round(s.maxParty)));
  }
  if (typeof s.maxCoversPerSlot === 'number') {
    db.reservationSettings.maxCoversPerSlot = Math.max(1, Math.min(200, Math.round(s.maxCoversPerSlot)));
  }
  if (typeof s.advanceDays === 'number') {
    db.reservationSettings.advanceDays = Math.max(1, Math.min(90, Math.round(s.advanceDays)));
  }
  if (typeof s.minHoursAhead === 'number') {
    db.reservationSettings.minHoursAhead = Math.max(0, Math.min(48, Math.round(s.minHoursAhead)));
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
  const order = (db.orders || []).find((o) => o.id === Number(req.params.id));
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
  const item = (db.feedback || []).find((f) => f.id === Number(req.params.id));
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
          '</css/westo-critical.smart.css?v=release14uf1d23-landscape-shell>; rel=preload; as=style',
          '</js/westo-smart-loader.js?v=release14uf1d23-landscape-shell>; rel=preload; as=script',
          '</js/westo-app.smart.js?v=release14uf1d23-landscape-shell>; rel=preload; as=script',
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

app.get(Object.keys(PAGES), (req, res) => {
  if (req.path.startsWith('/admin') || req.path === '/login') res.setHeader('Cache-Control', 'no-store');
  const pagePath = PAGES[req.path] || PAGES[String(req.path || '').replace(/\/$/, '')];
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
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  }
  next();
});
app.use(express.static(ROOT, { extensions: ['html'], etag: true, lastModified: true }));

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

module.exports = { app, startServer, db, stateStore, eventHub, commandCenterPayload, publicContentPayload };
