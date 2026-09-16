/**
 * js/admin/floor-studio.js
 *
 * استودیوی نقشه و چیدمان سالن وستو — ریفکتورشده
 *
 * تغییرات کلیدی نسبت به نسخه قبل در admin.js:
 *  1. Event Delegation — یک listener روی canvas به جای هزاران listener جداگانه
 *  2. AbortController — cleanup کامل همه event ها هنگام unmount
 *  3. Partial DOM Update — drag/zoom/rotate بدون full re-render
 *  4. حذف window.__floorTimerInterval و window.__floorKeydownBound (memory leak)
 *  5. createDragHandler عمومی — حذف کد تکراری برای table/fixture/zone drag
 *  6. setUnsavedStatus / updateUndoButtonUi مستقیم بدون render
 */

'use strict';

/* ============================================================
   Factory: createFloorStudio(opts) → { mount, unmount }
   opts: { main, api, branchQs, currentBranchId, showToast,
           fmtNum, esc, debounce, autosave, runBusy, currentBranch }
   ============================================================ */
function createFloorStudio(opts) {
  const {
    main, api, branchQs, getCurrentBranchId, showToast,
    fmtNum, esc, debounce, currentBranch,
  } = opts;

  // ─── AbortController برای cleanup کامل هنگام unmount ───────────────────
  let _abortCtrl = new AbortController();
  const signal = () => _abortCtrl.signal;

  // ─── وضعیت داخلی ──────────────────────────────────────────────────────
  const VIEW_PREFS_KEY = 'westo_admin_tables_view_mode';
  const QR_PREFS_KEY = 'westo_admin_qr_studio_v1';

  let currentView = localStorage.getItem(VIEW_PREFS_KEY) || 'map';
  let activeZone = 'all';
  let isEditMode = true;
  let studioMode = 'furniture';
  let selectedTableId = null;
  let selectedFixtureId = null;
  let selectedZoneId = null;
  let activeDrag = null;
  let justDragged = false;
  let canvasZoom = 1;
  let canvasPanX = 0;
  let canvasPanY = 0;
  let snapGridStep = 0.5;
  let isSavingLayout = false;
  let isDrawingZone = false;

  const selectedTableIds = new Set();
  const layoutHistory = [];
  const layoutRedoHistory = [];

  let tables = [];
  let floorZones = [];
  let floorFixtures = [];
  let floorLevels = [];
  let floorSettings = {};
  let activeFloorId = 'floor-ground';
  let floorData = null;
  let qrPrefs = {};

  // ─── Timer interval (نه روی window — کنترل شده) ──────────────────────
  let _countdownTimer = null;
  let _pollTimer = null;

  // ─── متوقف‌سازی کامل ──────────────────────────────────────────────────
  function unmount() {
    _abortCtrl.abort();
    _abortCtrl = new AbortController();
    if (_countdownTimer) { clearInterval(_countdownTimer); _countdownTimer = null; }
    if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
  }

  // ─── helpers ──────────────────────────────────────────────────────────
  const origin = location.origin;
  const currentBranchId = () => getCurrentBranchId();

  const normalizeZone = (z) => {
    const s = String(z || '').trim();
    if (!s) return 'سالن';
    if (/^vip$/i.test(s)) return 'ویژه';
    return s;
  };

  const tableById = (id) => tables.find((t) => Number(t.id) === Number(id)) || null;
  const tableTitle = (table) => String(table?.label || `میز ${table?.id || ''}`).trim();
  const activeTables = () => tables.filter((t) => t.active !== false);

  const br = () => currentBranch();

  const validHex = (v, fallback) => /^#[0-9a-f]{6}$/i.test(String(v || '')) ? String(v) : fallback;
  const validBaseUrl = (v) => {
    try {
      const url = new URL(String(v || '').trim());
      if (!['http:', 'https:'].includes(url.protocol)) return '';
      url.hash = ''; url.search = '';
      return url.href.replace(/\/$/, '');
    } catch { return ''; }
  };

  // ─── شکل و صندلی ─────────────────────────────────────────────────────
  const shapeLabel = (s) => ({
    rectangle: '⬛ مستطیل استاندارد', conference: '🏛️ کنفرانس و تشریفات',
    semi_circle: '🌙 نیم‌دایره و هلال', wall_counter: '🪟 کانتر دیواری',
    round_booth: '🛋️ مبل گرد نعل‌اسبی', circle: '⭕ گرد', square: '⏹️ مربع',
    booth: '🛋️ نیمکت VIP', bar_stool: '🍸 صندلی بار',
    oval: '🥚 بیضی تشریفاتی', lounge_takht: '🛏️ تخت سنتی',
    'open-terrace': '🌿 تراس و فضای باز', 'l-shape': '◱ ال‌شکل', corridor: '▭ طولی و راهرویی',
  }[s] || '⬛ مستطیل');

  const shapeIcon = (s) => ({
    rectangle: '⬛', conference: '🏛️', semi_circle: '🌙', wall_counter: '🪟',
    round_booth: '🛋️', circle: '⭕', square: '⏹️', booth: '🛋️',
    bar_stool: '🍸', oval: '🥚', lounge_takht: '🛏️',
  }[s] || '⬛');

  const shapeTitle = (s) => ({
    rectangle: 'مستطیل', conference: 'کنفرانس', semi_circle: 'نیم‌دایره',
    wall_counter: 'کانتر دیواری', round_booth: 'مبل گرد', circle: 'گرد',
    square: 'مربع', booth: 'نیمکت VIP', bar_stool: 'صندلی بار',
    oval: 'بیضی', lounge_takht: 'تخت سنتی',
  }[s] || 'مستطیل');

  const chairLabel = (m) => ({
    standard: '🪑 استاندارد', armchair: '🛋️ مبل دسته‌دار',
    bar_stool: '🍸 صندلی بار', booth_bench: '🧽 نیمکت چرمی', bolster: '🪡 متکای سنتی',
  }[m] || '🪑 استاندارد');

  const chairIcon = (m) => ({
    standard: '🪑', armchair: '🛋️', bar_stool: '🍸', booth_bench: '🧽', bolster: '🪡',
  }[m] || '🪑');

  // ─── QR helpers ───────────────────────────────────────────────────────
  const defaultQrPrefs = { baseUrl: origin, dark: '#11181b', light: '#ffffff', ecl: 'M', width: 768, margin: 5 };

  const normalizeQrPrefs = () => {
    qrPrefs = {
      ...defaultQrPrefs, ...qrPrefs,
      baseUrl: validBaseUrl(qrPrefs.baseUrl) || origin,
      dark: validHex(qrPrefs.dark, defaultQrPrefs.dark),
      light: validHex(qrPrefs.light, defaultQrPrefs.light),
      ecl: ['L', 'M', 'Q', 'H'].includes(String(qrPrefs.ecl).toUpperCase()) ? String(qrPrefs.ecl).toUpperCase() : 'M',
      width: [512, 768, 1024].includes(Number(qrPrefs.width)) ? Number(qrPrefs.width) : 768,
      margin: [3, 5, 8].includes(Number(qrPrefs.margin)) ? Number(qrPrefs.margin) : 5,
    };
  };
  const saveQrPrefs = () => { try { localStorage.setItem(QR_PREFS_KEY, JSON.stringify(qrPrefs)); } catch {} };
  const qrEclLabel = () => ({ L: 'سبک', M: 'استاندارد', Q: 'مقاوم', H: 'بسیار مقاوم' }[qrPrefs.ecl] || 'استاندارد');
  const qrEclHint = () => ({ L: 'فایل سبک', M: 'پیشنهاد وستو', Q: 'مناسب محیط شلوغ', H: 'بیشترین تحمل آسیب چاپ' }[qrPrefs.ecl] || 'پیشنهاد وستو');
  const baseQrUrl = () => validBaseUrl(qrPrefs.baseUrl) || origin;

  const tableDestination = (table) => {
    const url = new URL('/menu', `${baseQrUrl()}/`);
    url.searchParams.set('table', String(table?.id || ''));
    url.searchParams.set('branch', String(table?.branchId || currentBranchId() || 1));
    return url.href;
  };

  const qrAssetUrl = (table, { download = false } = {}) => {
    const url = new URL('/api/admin/qr-code', origin);
    url.searchParams.set('data', tableDestination(table));
    url.searchParams.set('dark', qrPrefs.dark);
    url.searchParams.set('light', qrPrefs.light);
    url.searchParams.set('ecl', qrPrefs.ecl);
    url.searchParams.set('width', String(qrPrefs.width));
    url.searchParams.set('margin', String(qrPrefs.margin));
    url.searchParams.set('filename', `westo-table-${table?.id || 'qr'}`);
    if (download) url.searchParams.set('download', '1');
    return url.href;
  };

  // ─── History (Undo/Redo) ────────────────────────────────────────────
  const pushHistory = () => {
    try {
      layoutHistory.push({
        tables: JSON.parse(JSON.stringify(tables)),
        zones: JSON.parse(JSON.stringify(floorZones)),
        fixtures: JSON.parse(JSON.stringify(floorFixtures)),
        floors: JSON.parse(JSON.stringify(floorLevels)),
      });
      if (layoutHistory.length > 35) layoutHistory.shift();
      layoutRedoHistory.length = 0;
      updateUndoButtonUi();
    } catch {}
  };

  const undoLayout = () => {
    if (!layoutHistory.length) return;
    const prev = layoutHistory.pop();
    if (prev && Array.isArray(prev.tables)) {
      layoutRedoHistory.push({
        tables: JSON.parse(JSON.stringify(tables)),
        zones: JSON.parse(JSON.stringify(floorZones)),
        fixtures: JSON.parse(JSON.stringify(floorFixtures)),
        floors: JSON.parse(JSON.stringify(floorLevels)),
      });
      tables = prev.tables;
      if (Array.isArray(prev.zones)) floorZones = prev.zones;
      if (Array.isArray(prev.fixtures)) floorFixtures = prev.fixtures;
      if (Array.isArray(prev.floors)) floorLevels = prev.floors;
      updateUndoButtonUi();
      debouncedSaveFloor();
      render();
      showToast('آخرین تغییرات چیدمان سالن بازگردانی شد (Undo).', 'info');
    }
  };

  const redoLayout = () => {
    if (!layoutRedoHistory.length) return;
    const next = layoutRedoHistory.pop();
    if (next && Array.isArray(next.tables)) {
      layoutHistory.push({
        tables: JSON.parse(JSON.stringify(tables)),
        zones: JSON.parse(JSON.stringify(floorZones)),
        fixtures: JSON.parse(JSON.stringify(floorFixtures)),
        floors: JSON.parse(JSON.stringify(floorLevels)),
      });
      tables = next.tables;
      if (Array.isArray(next.zones)) floorZones = next.zones;
      if (Array.isArray(next.fixtures)) floorFixtures = next.fixtures;
      if (Array.isArray(next.floors)) floorLevels = next.floors;
      updateUndoButtonUi();
      debouncedSaveFloor();
      render();
      showToast('تغییر مجدداً اعمال گردید (Redo).', 'info');
    }
  };

  // ─── DOM helpers (بدون full render) ────────────────────────────────
  const updateUndoButtonUi = () => {
    const undoBtn = document.getElementById('map-undo') || document.getElementById('map-history-undo');
    if (undoBtn) {
      undoBtn.disabled = layoutHistory.length === 0;
      undoBtn.title = layoutHistory.length > 0
        ? `بازگردانی آخرین تغییر (${fmtNum(layoutHistory.length)})`
        : 'تاریخچه خالی است';
    }
    const redoBtn = document.getElementById('map-redo') || document.getElementById('map-history-redo');
    if (redoBtn) {
      redoBtn.disabled = layoutRedoHistory.length === 0;
      redoBtn.title = layoutRedoHistory.length > 0
        ? `تکرار تغییر (${fmtNum(layoutRedoHistory.length)})`
        : 'موردی برای تکرار نیست';
    }
  };

  const updateSaveStatus = (saving) => {
    isSavingLayout = saving;
    const pill = document.getElementById('map-save-status');
    if (!pill) return;
    if (saving) {
      pill.className = 'floor-save-status is-saving';
      pill.innerHTML = '<span class="pulse-dot" style="background:#f59e0b"></span><span>در حال ذخیره...</span>';
    } else {
      pill.className = 'floor-save-status';
      pill.innerHTML = '<span>✓ چیدمان ذخیره است</span>';
    }
  };

  // alias برای سازگاری
  const setUnsavedStatus = () => updateSaveStatus(false);

  // ─── Zone Helpers ───────────────────────────────────────────────────
  const detectZoneAtCoords = (x, y) =>
    floorZones.find((z) => x >= z.x && x <= (z.x + z.w) && y >= z.y && y <= (z.y + z.h)) || null;

  const detectTableCollision = (targetTable) =>
    tables.some((other) => {
      if (Number(other.id) === Number(targetTable.id)) return false;
      const dx = (Number(other.x) || 0) - (Number(targetTable.x) || 0);
      const dy = (Number(other.y) || 0) - (Number(targetTable.y) || 0);
      return Math.hypot(dx, dy) < 8.5;
    });

  const DEFAULT_FLOOR_ZONES = [
    { id: 'zone-main', name: 'سالن اصلی', x: 2, y: 3, w: 47, h: 94, color: 'blue', icon: '🛋️' },
    { id: 'zone-terrace', name: 'تراس و فضای باز', x: 49, y: 3, w: 49, h: 56, color: 'emerald', icon: '🌿' },
    { id: 'zone-vip', name: 'سالن اختصاصی ویژه', x: 49, y: 59, w: 49, h: 38, color: 'purple', icon: '👑' },
  ];

  const sanitizeNonOverlappingZones = (zones) => {
    if (!Array.isArray(zones) || zones.length <= 1) return zones || [];
    const result = zones.map((z) => ({ ...z }));
    for (let i = 0; i < result.length; i++) {
      for (let j = i + 1; j < result.length; j++) {
        const a = result[i]; const b = result[j];
        const xOverlap = Math.max(a.x, b.x) < Math.min(a.x + a.w, b.x + b.w) - 0.5;
        const yOverlap = Math.max(a.y, b.y) < Math.min(a.y + a.h, b.y + b.h) - 0.5;
        if (xOverlap && yOverlap) {
          const overlapX = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
          const overlapY = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
          if (overlapY <= overlapX) {
            const midY = Math.round((Math.max(a.y, b.y) + Math.min(a.y + a.h, b.y + b.h)) / 2);
            if (a.y < b.y) { a.h = Math.max(8, midY - a.y); b.h = Math.max(8, (b.y + b.h) - midY); b.y = midY; }
            else { b.h = Math.max(8, midY - b.y); a.h = Math.max(8, (a.y + a.h) - midY); a.y = midY; }
          } else {
            const midX = Math.round((Math.max(a.x, b.x) + Math.min(a.x + a.w, b.x + b.w)) / 2);
            if (a.x < b.x) { a.w = Math.max(8, midX - a.x); b.w = Math.max(8, (b.x + b.w) - midX); b.x = midX; }
            else { b.w = Math.max(8, midX - b.x); a.w = Math.max(8, (a.x + a.w) - midX); a.x = midX; }
          }
        }
      }
    }
    return result;
  };

  const DEFAULT_FLOOR_FIXTURES = [
    { id: 'fix-entrance', type: 'entrance', name: 'ورودی اصلی', x: 2, y: 44, w: 3, h: 14, rotation: 0, color: 'blue', icon: '🚪', floorId: 'floor-ground' },
    { id: 'fix-bar', type: 'bar', name: 'کافه بار و پیشخوان', x: 16, y: 3, w: 16, h: 7, rotation: 0, color: 'slate', icon: '☕', floorId: 'floor-ground' },
    { id: 'fix-kitchen', type: 'kitchen', name: 'تحویل غذا و آشپزخانه', x: 2, y: 84, w: 15, h: 8, rotation: 0, color: 'orange', icon: '🍳', floorId: 'floor-ground' },
    { id: 'fix-cashier', type: 'cashier', name: 'صندوق و پذیرش', x: 7, y: 3, w: 7, h: 7, rotation: 0, color: 'emerald', icon: '💳', floorId: 'floor-ground' },
    { id: 'fix-restroom', type: 'restroom', name: 'سرویس بهداشتی', x: 89, y: 3, w: 9, h: 7, rotation: 0, color: 'sky', icon: '🚻', floorId: 'floor-ground' },
  ];

  const DEFAULT_TABLE_COORDINATES = [
    { id: 1, x: 18, y: 25, shape: 'circle', seats: 2, rotation: 0, zone: 'سالن' },
    { id: 2, x: 36, y: 25, shape: 'circle', seats: 2, rotation: 0, zone: 'سالن' },
    { id: 3, x: 18, y: 52, shape: 'circle', seats: 2, rotation: 0, zone: 'سالن' },
    { id: 4, x: 36, y: 52, shape: 'circle', seats: 2, rotation: 0, zone: 'سالن' },
    { id: 14, x: 18, y: 80, shape: 'rectangle', seats: 4, rotation: 0, zone: 'سالن' },
    { id: 15, x: 36, y: 80, shape: 'rectangle', seats: 4, rotation: 0, zone: 'سالن' },
    { id: 5, x: 60, y: 25, shape: 'rectangle', seats: 4, rotation: 0, zone: 'تراس' },
    { id: 6, x: 82, y: 25, shape: 'rectangle', seats: 4, rotation: 0, zone: 'تراس' },
    { id: 7, x: 60, y: 52, shape: 'rectangle', seats: 4, rotation: 0, zone: 'تراس' },
    { id: 8, x: 82, y: 52, shape: 'rectangle', seats: 4, rotation: 0, zone: 'تراس' },
    { id: 9, x: 60, y: 75, shape: 'booth', seats: 6, rotation: 0, zone: 'ویژه' },
    { id: 10, x: 82, y: 75, shape: 'booth', seats: 6, rotation: 0, zone: 'ویژه' },
    { id: 11, x: 60, y: 86, shape: 'booth', seats: 6, rotation: 0, zone: 'ویژه' },
    { id: 12, x: 82, y: 86, shape: 'booth', seats: 6, rotation: 0, zone: 'ویژه' },
  ];

  const ensureTableGeometry = (table, index) => {
    if (typeof table.x !== 'number' || typeof table.y !== 'number') {
      const match = DEFAULT_TABLE_COORDINATES.find((item) => String(item.id) === String(table.id));
      if (match) {
        table.x = match.x; table.y = match.y;
        table.shape = table.shape || match.shape;
        table.rotation = table.rotation ?? match.rotation;
      } else {
        table.x = ((index % 4) * 22) + 16;
        table.y = (Math.floor(index / 4) * 26) + 24;
        table.shape = table.shape || (Number(table.seats) <= 2 ? 'circle' : Number(table.seats) >= 6 ? 'booth' : 'rectangle');
        table.rotation = table.rotation || 0;
      }
    }
    table.shape = table.shape || (Number(table.seats) <= 2 ? 'circle' : Number(table.seats) >= 6 ? 'booth' : 'rectangle');
    table.rotation = Number(table.rotation) || 0;
    table.scale = Math.max(0.5, Math.min(3.0, Number(table.scale) || 1));
    table.seats = Number(table.seats) || 4;
    table.zone = normalizeZone(table.zone);
  };

  const floorCountdownLabel = (endsAt) => {
    const seconds = Math.max(0, Math.ceil((new Date(endsAt).getTime() - Date.now()) / 1000));
    const minutes = Math.floor(seconds / 60);
    const remainder = seconds % 60;
    const twoDigits = (v) => Number(v).toLocaleString('fa-IR', { minimumIntegerDigits: 2, useGrouping: false });
    return `${twoDigits(minutes)}:${twoDigits(remainder)}`;
  };

  // ─── Save Layout ─────────────────────────────────────────────────────
  const saveFloorLayout = async (silent = false) => {
    updateSaveStatus(true);
    try {
      const layoutPayload = tables.map((t) => ({
        id: Number(t.id),
        label: String(t.label || `میز ${t.id}`).trim(),
        seats: Math.max(1, Math.min(20, Number(t.seats) || 4)),
        zone: normalizeZone(t.zone),
        active: t.active !== false,
        x: Math.max(0, Math.min(100, Math.round((Number(t.x) || 50) * 10) / 10)),
        y: Math.max(0, Math.min(100, Math.round((Number(t.y) || 50) * 10) / 10)),
        shape: t.shape || 'rectangle',
        rotation: (Number(t.rotation) || 0) % 360,
        scale: Math.max(0.5, Math.min(3.0, Math.round((Number(t.scale) || 1) * 10) / 10)),
        floorId: t.floorId || 'floor-ground',
        mergedWith: Array.isArray(t.mergedWith) ? t.mergedWith : [],
        mergedInto: t.mergedInto || null,
        tags: Array.isArray(t.tags) ? t.tags : [],
      }));
      const zonesPayload = floorZones.map((z) => ({
        id: String(z.id),
        name: normalizeZone(z.name),
        x: Math.max(0, Math.min(100, Math.round(Number(z.x) * 10) / 10)),
        y: Math.max(0, Math.min(100, Math.round(Number(z.y) * 10) / 10)),
        w: Math.max(5, Math.min(100, Math.round(Number(z.w) * 10) / 10)),
        h: Math.max(5, Math.min(100, Math.round(Number(z.h) * 10) / 10)),
        color: z.color || 'blue', icon: z.icon || '🏷️',
        lengthM: z.lengthM, widthM: z.widthM, areaSqM: z.areaSqM,
        shape: z.shape, floorId: z.floorId || 'floor-ground',
      }));
      const fixturesPayload = floorFixtures.map((f) => ({
        id: String(f.id), type: f.type || 'fixture', name: f.name || 'المان',
        x: Math.max(0, Math.min(100, Math.round(Number(f.x) * 10) / 10)),
        y: Math.max(0, Math.min(100, Math.round(Number(f.y) * 10) / 10)),
        w: Math.max(2, Math.min(100, Math.round(Number(f.w) * 10) / 10)),
        h: Math.max(2, Math.min(100, Math.round(Number(f.h) * 10) / 10)),
        rotation: (Number(f.rotation) || 0) % 360,
        color: f.color || 'slate', icon: f.icon || '🏷️',
        floorId: f.floorId || 'floor-ground',
      }));
      const floorsPayload = floorLevels.map((fl) => ({
        id: String(fl.id), name: String(fl.name),
        level: Number(fl.level) || 0, icon: fl.icon || '🏛️',
        isDefault: Boolean(fl.isDefault),
      }));
      const res = await api('/api/admin/v2/floor/layout', {
        method: 'PUT',
        body: JSON.stringify({
          tables: layoutPayload, zones: zonesPayload,
          fixtures: fixturesPayload, floors: floorsPayload,
          settings: floorSettings, branchId: currentBranchId(),
        }),
      });
      if (res?.floor) {
        floorData = res.floor;
        if (Array.isArray(res.floor.zones) && res.floor.zones.length > 0) {
          floorZones = res.floor.zones.map((z) => ({
            id: String(z.id), name: normalizeZone(z.name),
            x: Number(z.x) || 0, y: Number(z.y) || 0,
            w: Number(z.w) || 30, h: Number(z.h) || 30,
            color: z.color || 'blue', icon: z.icon || '🏷️',
            lengthM: z.lengthM, widthM: z.widthM, areaSqM: z.areaSqM,
            shape: z.shape, floorId: z.floorId || 'floor-ground',
          }));
        }
        if (Array.isArray(res.floor.fixtures)) {
          floorFixtures = res.floor.fixtures.map((f) => ({
            id: String(f.id), type: f.type || 'fixture', name: f.name || 'المان',
            x: Number(f.x) || 10, y: Number(f.y) || 10,
            w: Number(f.w) || 10, h: Number(f.h) || 8,
            rotation: Number(f.rotation) || 0,
            color: f.color || 'slate', icon: f.icon || '🏷️',
            floorId: f.floorId || 'floor-ground',
          }));
        }
        if (Array.isArray(res.floor.floors)) {
          floorLevels = res.floor.floors.map((fl) => ({
            id: String(fl.id), name: String(fl.name),
            level: Number(fl.level) || 0, icon: fl.icon || '🏛️',
            isDefault: Boolean(fl.isDefault),
          }));
        }
      }
      updateSaveStatus(false);
      if (!silent) showToast('چیدمان نقشه سالن با موفقیت ذخیره گردید.', 'success');
    } catch (e) {
      updateSaveStatus(false);
      if (!silent) showToast(e.message || 'خطا در ذخیره چیدمان نقشه', 'error');
    }
  };
  const debouncedSaveFloor = debounce(saveFloorLayout, 600);

  const loadFloorData = async () => {
    try {
      const fresh = await api(`/api/admin/v2/floor${branchQs()}`);
      if (!fresh) return;
      floorData = fresh;
      const floorTableMap = new Map((fresh.tables || []).map((t) => [Number(t.id), t]));
      tables.forEach((table) => {
        const f = floorTableMap.get(Number(table.id));
        if (f) {
          if (typeof f.x === 'number') table.x = f.x;
          if (typeof f.y === 'number') table.y = f.y;
          if (f.shape) table.shape = f.shape;
          if (typeof f.rotation === 'number') table.rotation = f.rotation;
          if (f.zone) table.zone = normalizeZone(f.zone);
          table.state = f.state || table.state;
          table.stateLabel = f.stateLabel || table.stateLabel;
          table.serviceEndsAt = f.serviceEndsAt || null;
          table.autoReleased = Boolean(f.autoReleased);
          table.waiterCallId = f.waiterCallId || null;
        }
      });
    } catch {}
  };

  // ─── Modal سیستم (in-studio) ────────────────────────────────────────
  const showFloorModal = ({ title, bodyHtml, confirmText = 'تایید و ذخیره', confirmClass = 'btn-primary', cancelText = 'انصراف', modalClass = '', onConfirm }) => {
    const existing = document.getElementById('floor-modal-backdrop');
    if (existing) existing.remove();

    const backdrop = document.createElement('div');
    backdrop.id = 'floor-modal-backdrop';
    backdrop.className = 'floor-studio-backdrop';
    backdrop.innerHTML = `
      <div class="floor-studio-modal ${modalClass}" role="dialog" aria-modal="true">
        <div class="floor-studio-modal__head">
          <h3>${title}</h3>
          <button type="button" class="floor-studio-modal__close" id="floor-modal-close" aria-label="بستن">✕</button>
        </div>
        <form id="floor-modal-form">
          <div class="floor-studio-modal__body">${bodyHtml}</div>
          <div class="floor-studio-modal__actions">
            <button type="button" class="btn btn-sm btn-ghost" id="floor-modal-cancel">${esc(cancelText)}</button>
            <button type="submit" class="btn btn-sm ${esc(confirmClass)}" id="floor-modal-confirm">${esc(confirmText)}</button>
          </div>
        </form>
      </div>`;

    document.body.appendChild(backdrop);

    const close = () => {
      backdrop.remove();
      document.removeEventListener('keydown', onKeyDown);
    };
    const onKeyDown = (ev) => { if (ev.key === 'Escape') close(); };
    document.addEventListener('keydown', onKeyDown);

    backdrop.querySelector('#floor-modal-close')?.addEventListener('click', close);
    backdrop.querySelector('#floor-modal-cancel')?.addEventListener('click', close);
    backdrop.addEventListener('click', (ev) => { if (ev.target === backdrop) close(); });

    const form = backdrop.querySelector('#floor-modal-form');
    form?.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      if (onConfirm) {
        const result = await onConfirm(form);
        if (result !== false) close();
      } else { close(); }
    });

    setTimeout(() => {
      const firstInput = form?.querySelector('input, select, textarea');
      if (firstInput) { firstInput.focus(); if (typeof firstInput.select === 'function') firstInput.select(); }
    }, 50);

    return { close };
  };

  // ─── Generic Drag Handler ────────────────────────────────────────────
  // جایگزین ۳ drag handler تکراری — table/fixture/zone drag
  const createDragHandler = ({ getScaleEl, onDragStart, onMove, onEnd, snapStep = () => snapGridStep }) => {
    return (e, el) => {
      const scaleEl = getScaleEl ? getScaleEl() : (document.getElementById('admin-canvas-scaler') || document.getElementById('admin-floor-canvas'));
      if (!scaleEl) return;
      const rect = scaleEl.getBoundingClientRect();
      const startInfo = onDragStart ? onDragStart(e, el, rect) : {};
      if (startInfo === false) return;

      el.classList.add('is-dragging');
      try { el.setPointerCapture(e.pointerId); } catch {}

      let hasMoved = false;

      const onPointerMove = (ev) => {
        const dx = ((ev.clientX - e.clientX) / rect.width) * 100;
        const dy = ((ev.clientY - e.clientY) / rect.height) * 100;
        if (Math.abs(dx) > 0.3 || Math.abs(dy) > 0.3) hasMoved = true;
        onMove(ev, { dx, dy, rect, hasMoved, snap: snapStep() });
      };

      const onPointerUp = (ev) => {
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
        window.removeEventListener('pointercancel', onPointerUp);
        el.classList.remove('is-dragging');
        try { el.releasePointerCapture(ev.pointerId || e.pointerId); } catch {}
        if (onEnd) onEnd(ev, { hasMoved });
      };

      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
      window.addEventListener('pointercancel', onPointerUp);
    };
  };

  // ─── Table Drag ──────────────────────────────────────────────────────
  const handleTableDrag = (e, el) => {
    const tableId = Number(el.dataset.table);
    const table = tableById(tableId);
    if (!table) return;

    const startX = e.clientX;
    const startY = e.clientY;
    const originX = Number(table.x) || 50;
    const originY = Number(table.y) || 50;

    const scaleEl = document.getElementById('admin-canvas-scaler') || document.getElementById('admin-floor-canvas');
    if (!scaleEl) return;
    const rect = scaleEl.getBoundingClientRect();

    const isGroup = selectedTableIds.has(tableId) && selectedTableIds.size > 1;
    const groupMembers = isGroup
      ? Array.from(selectedTableIds).map((id) => {
          const t = tableById(id);
          const memberEl = scaleEl.querySelector(`.plan-table[data-table="${id}"]`);
          return { id, table: t, el: memberEl, ox: Number(t?.x) || 50, oy: Number(t?.y) || 50 };
        }).filter((m) => m.table && m.el)
      : [];

    el.classList.add('is-dragging');
    try { el.setPointerCapture(e.pointerId); } catch {}

    let badge = el.querySelector('.plan-table-coords-badge');
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'plan-table-coords-badge';
      el.appendChild(badge);
    }
    const roomL = Number(floorSettings.lengthM) || 20;
    const roomW = Number(floorSettings.widthM) || 15;
    badge.textContent = `${Math.round(originX)}% , ${Math.round(originY)}%`;

    let hasMoved = false;

    const onPointerMove = (ev) => {
      const dx = ((ev.clientX - startX) / rect.width) * 100;
      const dy = ((ev.clientY - startY) / rect.height) * 100;
      if (Math.abs(dx) > 0.3 || Math.abs(dy) > 0.3) hasMoved = true;

      let newX = Math.round((originX + dx) / snapGridStep) * snapGridStep;
      let newY = Math.round((originY + dy) / snapGridStep) * snapGridStep;

      // Smart guides
      let matchedX = null; let matchedY = null;
      const otherTables = tables.filter((t) => Number(t.id) !== Number(table.id) && (!activeFloorId || t.floorId === activeFloorId));
      for (const ot of otherTables) {
        if (isGroup && selectedTableIds.has(Number(ot.id))) continue;
        const ox = Number(ot.x) || 50; const oy = Number(ot.y) || 50;
        if (Math.abs(newX - ox) <= 1.2) { newX = ox; matchedX = ox; }
        if (Math.abs(newY - oy) <= 1.2) { newY = oy; matchedY = oy; }
      }

      newX = Math.max(5, Math.min(95, newX));
      newY = Math.max(5, Math.min(95, newY));
      table.x = newX; table.y = newY;

      // Direct DOM update — بدون full render
      el.style.left = `${newX}%`;
      el.style.top = `${newY}%`;

      // Group Drag sync for all selected tables
      if (isGroup) {
        const dXDelta = newX - originX;
        const dYDelta = newY - originY;
        for (const m of groupMembers) {
          if (m.id === tableId) continue;
          const mx = Math.max(5, Math.min(95, Math.round((m.ox + dXDelta) * 10) / 10));
          const my = Math.max(5, Math.min(95, Math.round((m.oy + dYDelta) * 10) / 10));
          m.table.x = mx;
          m.table.y = my;
          m.el.style.left = `${mx}%`;
          m.el.style.top = `${my}%`;
        }
      }

      // Minimum Aisle Clearance Check (فاصله تردد تا نزدیک‌ترین میز به متر)
      let minDistanceM = 999;
      for (const ot of otherTables) {
        if (isGroup && selectedTableIds.has(Number(ot.id))) continue;
        const ox = Number(ot.x) || 50; const oy = Number(ot.y) || 50;
        const dxM = ((newX - ox) / 100) * roomL;
        const dyM = ((newY - oy) / 100) * roomW;
        const dist = Math.hypot(dxM, dyM);
        if (dist < minDistanceM) minDistanceM = dist;
      }
      const isClearanceWarn = minDistanceM < 0.75;
      const posXMeter = Math.round((newX / 100) * roomL * 10) / 10;
      const posYMeter = Math.round((newY / 100) * roomW * 10) / 10;

      if (badge) {
        badge.classList.toggle('is-clearance-warn', isClearanceWarn);
        if (isClearanceWarn) {
          badge.textContent = `${Math.round(newX)}% , ${Math.round(newY)}% · ⚠️ حریم عبور (${minDistanceM.toFixed(1)}م)`;
        } else {
          badge.textContent = `${Math.round(newX)}% , ${Math.round(newY)}% (${posXMeter}م , ${posYMeter}م)`;
        }
      }

      // Smart guide lines
      _updateSmartGuide('x', matchedX, scaleEl);
      _updateSmartGuide('y', matchedY, scaleEl);
    };

    const onPointerUp = (ev) => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
      el.classList.remove('is-dragging');
      badge?.remove();
      _hideSmartGuides();
      try { el.releasePointerCapture(ev.pointerId || e.pointerId); } catch {}
      if (hasMoved) {
        justDragged = true;
        setTimeout(() => { justDragged = false; }, 180);
        debouncedSaveFloor();
      }
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
  };

  // ─── Fixture Drag ────────────────────────────────────────────────────
  const handleFixtureDrag = (e, el) => {
    const fId = el.dataset.fixtureId;
    const fixture = floorFixtures.find((f) => f.id === fId);
    if (!fixture) return;

    const scaleEl = document.getElementById('admin-canvas-scaler') || document.getElementById('admin-floor-canvas');
    if (!scaleEl) return;
    const rect = scaleEl.getBoundingClientRect();
    const startX = e.clientX; const startY = e.clientY;
    const origX = Number(fixture.x) || 0; const origY = Number(fixture.y) || 0;
    let hasMoved = false;

    el.classList.add('is-dragging');
    try { el.setPointerCapture(e.pointerId); } catch {}

    const onPointerMove = (ev) => {
      const dx = ((ev.clientX - startX) / rect.width) * 100;
      const dy = ((ev.clientY - startY) / rect.height) * 100;
      if (Math.abs(dx) > 0.3 || Math.abs(dy) > 0.3) hasMoved = true;
      let newX = Math.round((origX + dx) / snapGridStep) * snapGridStep;
      let newY = Math.round((origY + dy) / snapGridStep) * snapGridStep;
      newX = Math.max(0, Math.min(100 - (Number(fixture.w) || 10), newX));
      newY = Math.max(0, Math.min(100 - (Number(fixture.h) || 8), newY));
      fixture.x = Math.round(newX * 10) / 10;
      fixture.y = Math.round(newY * 10) / 10;
      el.style.left = `${fixture.x}%`;
      el.style.top = `${fixture.y}%`;
    };

    const onPointerUp = (ev) => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
      el.classList.remove('is-dragging');
      try { el.releasePointerCapture(ev.pointerId || e.pointerId); } catch {}
      if (hasMoved) {
        justDragged = true;
        setTimeout(() => { justDragged = false; }, 180);
        debouncedSaveFloor();
      }
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
  };

  // ─── Fixture Resize ──────────────────────────────────────────────────
  const handleFixtureResize = (e, handleEl) => {
    const fixtureEl = handleEl.closest('.plan-fixture');
    const fId = fixtureEl?.dataset.fixtureId;
    const fixture = floorFixtures.find((f) => f.id === fId);
    if (!fixture) return;

    const scaleEl = document.getElementById('admin-canvas-scaler') || document.getElementById('admin-floor-canvas');
    if (!scaleEl) return;
    const rect = scaleEl.getBoundingClientRect();
    const startX = e.clientX; const startY = e.clientY;
    const origW = Number(fixture.w) || 12; const origH = Number(fixture.h) || 8;

    handleEl.classList.add('is-resizing');
    try { handleEl.setPointerCapture(e.pointerId); } catch {}

    const onPointerMove = (ev) => {
      const dx = ((ev.clientX - startX) / rect.width) * 100;
      const dy = ((ev.clientY - startY) / rect.height) * 100;
      const newW = Math.max(4, Math.min(60, Math.round((origW + dx) / snapGridStep) * snapGridStep));
      const newH = Math.max(3, Math.min(50, Math.round((origH + dy) / snapGridStep) * snapGridStep));
      fixture.w = Math.round(newW * 10) / 10;
      fixture.h = Math.round(newH * 10) / 10;
      fixtureEl.style.width = `${fixture.w}%`;
      fixtureEl.style.height = `${fixture.h}%`;
    };

    const onPointerUp = (ev) => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
      handleEl.classList.remove('is-resizing');
      try { handleEl.releasePointerCapture(ev.pointerId || e.pointerId); } catch {}
      debouncedSaveFloor();
      render();
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
  };

  // ─── CAD Directional Anchored Table Resize Engine ───────────────────────
  const handleTableResize = (e, handleEl) => {
    const tableEl = handleEl.closest('.plan-table');
    const tableId = Number(tableEl?.dataset.table);
    const table = tableById(tableId);
    if (!table || !tableEl) return;

    const corner = handleEl.dataset.resizeCorner || 'se'; // nw | ne | sw | se
    const origScale = Number(table.scale) || 1;

    const scaleEl = document.getElementById('admin-canvas-scaler') || document.getElementById('admin-floor-canvas');
    if (!scaleEl) return;
    const canvasRect = scaleEl.getBoundingClientRect();

    // اندازه فیزیکی محاسبه‌شده سطح میز بدون scale
    const surfaceEl = tableEl.querySelector('.plan-table-surface') || tableEl;
    const surfRect = surfaceEl.getBoundingClientRect();
    const unscaledW = Math.max(40, (surfRect.width / origScale) || 96);
    const unscaledH = Math.max(30, (surfRect.height / origScale) || 68);

    const origHW = (unscaledW * origScale) / 2;
    const origHH = (unscaledH * origScale) / 2;

    // مرکز فعلی میز در مختصات پیکسلی بوم
    const origCenterX = (table.x / 100) * canvasRect.width;
    const origCenterY = (table.y / 100) * canvasRect.height;

    // زاویه چرخش به رادیان
    const rad = ((Number(table.rotation) || 0) * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);

    // تعیین بردار دستگیره و نقطه لنگر (Anchor) مقابل
    const dirU = (corner === 'se' || corner === 'ne') ? 1 : -1;
    const dirV = (corner === 'se' || corner === 'sw') ? 1 : -1;

    const anchorLocalU = -dirU * origHW;
    const anchorLocalV = -dirV * origHH;

    // مختصات پیکسلی لنگر روی بوم
    const anchorPxX = origCenterX + (anchorLocalU * cos - anchorLocalV * sin);
    const anchorPxY = origCenterY + (anchorLocalU * sin + anchorLocalV * cos);

    // ایجاد یا دریافت نشانگر زنده ابعاد (HUD Badge)
    let hudEl = document.querySelector('.floor-resize-hud');
    if (!hudEl) {
      hudEl = document.createElement('div');
      hudEl.className = 'floor-resize-hud';
      document.body.appendChild(hudEl);
    }

    handleEl.classList.add('is-resizing');
    try { handleEl.setPointerCapture(e.pointerId); } catch {}
    e.stopPropagation();

    const updateHud = (scaleVal, ev) => {
      if (!hudEl) return;
      const wCm = Math.round(unscaledW * scaleVal * 1.5);
      const hCm = Math.round(unscaledH * scaleVal * 1.5);
      hudEl.innerHTML = `
        <strong>📐 مقیاس: ${(scaleVal).toFixed(2)}×</strong>
        <small>${fmtNum(wCm)} × ${fmtNum(hCm)} سانتی‌متر</small>
        <small style="color:#64748b">کلید Alt: تغییر اندازه متقارن</small>
      `;
      hudEl.style.left = `${ev.clientX}px`;
      hudEl.style.top = `${ev.clientY}px`;
    };

    updateHud(origScale, e);

    const onPointerMove = (ev) => {
      const curCanvasX = ev.clientX - canvasRect.left;
      const curCanvasY = ev.clientY - canvasRect.top;

      let newScale = origScale;
      let newXpct = table.x;
      let newYpct = table.y;

      if (ev.altKey) {
        // تغییر اندازه متقارن از مرکز با کلید Alt
        const distCenter = Math.hypot(curCanvasX - origCenterX, curCanvasY - origCenterY);
        const initDist = Math.hypot(origHW, origHH);
        const rawScale = origScale * (distCenter / Math.max(10, initDist));
        newScale = Math.max(0.5, Math.min(3.0, Math.round(rawScale * 20) / 20));
      } else {
        // تغییر اندازه مهندسی CAD با لنگر ثابت در گوشه مقابل
        const vX = curCanvasX - anchorPxX;
        const vY = curCanvasY - anchorPxY;

        // انتقال بردار کرسر به دستگاه مختصات محلی میز
        const localU = vX * cos + vY * sin;
        const localV = -vX * sin + vY * cos;

        // طول امتدادیافته در جهت مجاز
        const directedU = Math.max(15, localU * dirU);
        const directedV = Math.max(15, localV * dirV);

        const scaleU = directedU / unscaledW;
        const scaleV = directedV / unscaledH;
        const rawScale = (scaleU + scaleV) / 2;

        newScale = Math.max(0.5, Math.min(3.0, Math.round(rawScale * 20) / 20));

        // محاسبه مرکز جدید بر مبنای لنگر کاملاً ثابت
        const newHW = (unscaledW * newScale) / 2;
        const newHH = (unscaledH * newScale) / 2;

        const centerOffsetX = (dirU * newHW) * cos - (dirV * newHH) * sin;
        const centerOffsetY = (dirU * newHW) * sin + (dirV * newHH) * cos;

        const newCenterXpx = anchorPxX + centerOffsetX;
        const newCenterYpx = anchorPxY + centerOffsetY;

        newXpct = Math.max(2, Math.min(98, (newCenterXpx / canvasRect.width) * 100));
        newYpct = Math.max(2, Math.min(98, (newCenterYpx / canvasRect.height) * 100));
      }

      table.scale = newScale;
      table.x = Math.round(newXpct * 10) / 10;
      table.y = Math.round(newYpct * 10) / 10;

      // به‌روزرسانی آنی DOM بدون ری‌رندر کل بوم
      const rot = table.rotation || 0;
      tableEl.style.left = `${table.x}%`;
      tableEl.style.top = `${table.y}%`;
      tableEl.style.transform = `translate(-50%, -50%) rotate(${rot}deg) scale(${newScale})`;
      tableEl.style.setProperty('--table-scale', newScale);

      updateHud(newScale, ev);
    };

    const onPointerUp = (ev) => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
      handleEl.classList.remove('is-resizing');
      try { handleEl.releasePointerCapture(ev.pointerId || e.pointerId); } catch {}
      if (hudEl) { hudEl.remove(); hudEl = null; }
      pushHistory();
      debouncedSaveFloor();
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
  };

  // ─── Zone Resize ─────────────────────────────────────────────────────
  const handleZoneResize = (e, handleEl) => {
    const zoneId = handleEl.dataset.zoneId;
    const handleDir = handleEl.dataset.handle;
    const zone = floorZones.find((z) => z.id === zoneId);
    if (!zone) return;

    selectedZoneId = zoneId;
    const zoneEl = document.querySelector(`.plan-zone[data-zone-id="${zone.id}"]`);
    if (zoneEl) zoneEl.classList.add('is-resizing');

    const scaleEl = document.getElementById('admin-canvas-scaler') || document.getElementById('admin-floor-canvas');
    if (!scaleEl) return;
    const rect = scaleEl.getBoundingClientRect();
    const startX = e.clientX; const startY = e.clientY;
    const origX = zone.x; const origY = zone.y;
    const origW = zone.w; const origH = zone.h;

    handleEl.classList.add('is-resizing');
    try { handleEl.setPointerCapture(e.pointerId); } catch {}

    const onPointerMove = (ev) => {
      const dx = ((ev.clientX - startX) / rect.width) * 100;
      const dy = ((ev.clientY - startY) / rect.height) * 100;

      let newX = origX; let newY = origY; let newW = origW; let newH = origH;

      if (handleDir.includes('e')) newW = Math.max(10, Math.min(100 - origX, Math.round((origW + dx) / snapGridStep) * snapGridStep));
      if (handleDir.includes('s')) newH = Math.max(10, Math.min(100 - origY, Math.round((origH + dy) / snapGridStep) * snapGridStep));
      if (handleDir.includes('w')) {
        const maxShift = origW - 10;
        const shift = Math.max(-origX, Math.min(maxShift, Math.round(dx / snapGridStep) * snapGridStep));
        newX = origX + shift; newW = origW - shift;
      }
      if (handleDir.includes('n')) {
        const maxShift = origH - 10;
        const shift = Math.max(-origY, Math.min(maxShift, Math.round(dy / snapGridStep) * snapGridStep));
        newY = origY + shift; newH = origH - shift;
      }

      // Magnetic snapping به zone های مجاور
      floorZones.forEach((other) => {
        if (other.id === zone.id) return;
        if (handleDir.includes('e') && Math.abs((newX + newW) - other.x) <= 2) newW = other.x - newX;
        if (handleDir.includes('w') && Math.abs(newX - (other.x + other.w)) <= 2) { const tx = other.x + other.w; newW = (newX + newW) - tx; newX = tx; }
        if (handleDir.includes('s') && Math.abs((newY + newH) - other.y) <= 2) newH = other.y - newY;
        if (handleDir.includes('n') && Math.abs(newY - (other.y + other.h)) <= 2) { const ty = other.y + other.h; newH = (newY + newH) - ty; newY = ty; }
      });

      zone.x = Math.max(0, Math.min(100, Math.round(newX * 10) / 10));
      zone.y = Math.max(0, Math.min(100, Math.round(newY * 10) / 10));
      zone.w = Math.max(8, Math.min(100, Math.round(newW * 10) / 10));
      zone.h = Math.max(8, Math.min(100, Math.round(newH * 10) / 10));

      if (zoneEl) {
        zoneEl.style.left = `${zone.x}%`;
        zoneEl.style.top = `${zone.y}%`;
        zoneEl.style.width = `${zone.w}%`;
        zoneEl.style.height = `${zone.h}%`;
      }
    };

    const onPointerUp = (ev) => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
      handleEl.classList.remove('is-resizing');
      if (zoneEl) zoneEl.classList.remove('is-resizing');
      try { handleEl.releasePointerCapture(ev.pointerId || e.pointerId); } catch {}
      selectedZoneId = zone.id;
      debouncedSaveFloor();
      render();
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
  };

  // ─── Smart Guide Lines ───────────────────────────────────────────────
  const _updateSmartGuide = (axis, matchedVal, scaleEl) => {
    const id = axis === 'x' ? 'floor-smart-guide-x' : 'floor-smart-guide-y';
    const cls = `floor-smart-guide floor-smart-guide--${axis}`;
    let guide = document.getElementById(id);
    if (matchedVal !== null) {
      if (!guide && scaleEl) {
        guide = document.createElement('div');
        guide.id = id;
        guide.className = cls;
        scaleEl.appendChild(guide);
      }
      if (guide) {
        guide.style.display = 'block';
        if (axis === 'x') guide.style.left = `${matchedVal}%`;
        else guide.style.top = `${matchedVal}%`;
      }
    } else if (guide) {
      guide.style.display = 'none';
    }
  };

  const _hideSmartGuides = () => {
    const gx = document.getElementById('floor-smart-guide-x');
    const gy = document.getElementById('floor-smart-guide-y');
    if (gx) gx.style.display = 'none';
    if (gy) gy.style.display = 'none';
  };

  // ─── Render Helpers ──────────────────────────────────────────────────
  const renderSvgConnectors = () => {
    let lines = '';
    tables.forEach((t) => {
      if (t.mergedWith && Array.isArray(t.mergedWith)) {
        t.mergedWith.forEach((subId) => {
          const sub = tableById(subId);
          if (sub && (t.floorId || 'floor-ground') === (sub.floorId || 'floor-ground') && (activeFloorId === (t.floorId || 'floor-ground'))) {
            lines += `<line x1="${t.x}%" y1="${t.y}%" x2="${sub.x}%" y2="${sub.y}%" class="plan-table-connector-line" stroke="#38bdf8" stroke-width="3" stroke-dasharray="6,4" opacity="0.85" />`;
          }
        });
      }
    });
    return lines;
  };

  const renderRulerTicksX = (totalMeters) => {
    const m = Math.max(10, Math.min(100, Number(totalMeters) || 20));
    let html = '';
    for (let i = 0; i <= m; i += 2) {
      const pct = (i / m) * 100;
      html += `<div class="floor-ruler-tick floor-ruler-tick--x" style="left:${pct.toFixed(1)}%"><span class="floor-ruler-tick__label">${fmtNum(i)}م</span></div>`;
    }
    return html;
  };

  const renderRulerTicksY = (totalMeters) => {
    const m = Math.max(8, Math.min(80, Number(totalMeters) || 15));
    let html = '';
    for (let i = 0; i <= m; i += 2) {
      const pct = (i / m) * 100;
      html += `<div class="floor-ruler-tick floor-ruler-tick--y" style="top:${pct.toFixed(1)}%"><span class="floor-ruler-tick__label">${fmtNum(i)}م</span></div>`;
    }
    return html;
  };

  const renderFixtureItem = (fixture) => {
    const isSelected = selectedFixtureId === fixture.id;
    const isNearTop = Number(fixture.y) < 20;
    const paletteHtml = (isSelected && isEditMode) ? `
      <div class="fixture-floating-palette" data-flip-down="${isNearTop}">
        <button type="button" data-fixture-action="rotate" title="چرخش ۴۵ درجه">↻ ۴۵°</button>
        <button type="button" data-fixture-action="delete" title="حذف سازه" style="color:#f43f5e">🗑️ حذف</button>
        <button type="button" data-fixture-action="close" title="بستن">✕</button>
      </div>` : '';

    return `
      <div class="plan-fixture plan-fixture--${esc(fixture.type)} plan-fixture--${esc(fixture.color || 'slate')} ${isSelected ? 'is-selected' : ''}"
           data-fixture-id="${esc(fixture.id)}"
           style="left:${fixture.x}%; top:${fixture.y}%; width:${fixture.w}%; height:${fixture.h}%; transform: rotate(${fixture.rotation || 0}deg); --fixture-rot: ${fixture.rotation || 0}deg;"
           title="${esc(fixture.name || fixture.type)}">
        <div class="plan-fixture-content">
          <span class="plan-fixture-icon">${esc(fixture.icon || '🏛️')}</span>
          <span class="plan-fixture-label">${esc(fixture.name || '')}</span>
        </div>
        ${paletteHtml}
        ${isEditMode ? `<div class="fixture-handle fixture-handle--se" data-handle="se" data-fixture-id="${esc(fixture.id)}"></div>` : ''}
      </div>`;
  };

  const renderPlanTableItem = (table) => {
    const isSelected = Number(selectedTableId) === Number(table.id) || selectedTableIds.has(Number(table.id));
    const shape = table.shape || 'rectangle';
    const seats = Math.max(1, Math.min(24, Number(table.seats) || 4));
    const chairModel = table.chairModel || (shape === 'bar_stool' || shape === 'wall_counter' ? 'bar_stool' : shape === 'lounge_takht' ? 'bolster' : 'standard');
    const chairClass = `plan-chair plan-chair--${chairModel}`;
    let chairsHtml = '';

    if (shape === 'conference') {
      // Large Executive Conference / Banquet Table: 2 Head Chairs (left & right) + top & bottom rows
      if (seats >= 2) {
        chairsHtml += `<div class="${chairClass} plan-chair--head" style="left:-14px;top:50%;transform:translateY(-50%);width:9px;height:26px;border-radius:5px 2px 2px 5px" title="صندلی صدر"></div>`;
        chairsHtml += `<div class="${chairClass} plan-chair--head" style="right:-14px;top:50%;transform:translateY(-50%);width:9px;height:26px;border-radius:2px 5px 5px 2px" title="صندلی ذیل"></div>`;
      }
      const sideSeats = Math.max(0, seats - 2);
      const topCount = Math.ceil(sideSeats / 2);
      const botCount = sideSeats - topCount;
      for (let i = 0; i < topCount; i++) {
        const xPos = topCount === 1 ? 50 : 14 + (i * (72 / (topCount - 1)));
        chairsHtml += `<div class="${chairClass}" style="top:-14px;left:${xPos.toFixed(1)}%;transform:translateX(-50%);width:26px;height:10px;border-radius:6px 6px 3px 3px"></div>`;
      }
      for (let i = 0; i < botCount; i++) {
        const xPos = botCount === 1 ? 50 : 14 + (i * (72 / (botCount - 1)));
        chairsHtml += `<div class="${chairClass}" style="bottom:-14px;left:${xPos.toFixed(1)}%;transform:translateX(-50%);width:26px;height:10px;border-radius:3px 3px 6px 6px"></div>`;
      }
    } else if (shape === 'semi_circle') {
      // Half-moon / semi-circular table with outer banquette arc
      chairsHtml += `<div class="plan-semicircle-cushion"></div>`;
      for (let i = 0; i < seats; i++) {
        const angle = (Math.PI / (seats + 1)) * (i + 1);
        const rx = 52;
        const ry = 44;
        const left = 50 - rx * Math.cos(angle);
        const top = 30 + ry * Math.sin(angle);
        const deg = (angle * 180 / Math.PI) - 90;
        chairsHtml += `<div class="${chairClass}" style="left:${left.toFixed(1)}%;top:${top.toFixed(1)}%;transform:translate(-50%,-50%) rotate(${deg.toFixed(1)}deg);width:24px;height:10px;border-radius:5px"></div>`;
      }
    } else if (shape === 'wall_counter') {
      // Wall-mounted bar counter: single-sided seating facing counter
      for (let i = 0; i < seats; i++) {
        const xPos = seats === 1 ? 50 : 14 + (i * (72 / (seats - 1)));
        chairsHtml += `<div class="${chairClass}" style="bottom:-15px;left:${xPos.toFixed(1)}%;transform:translateX(-50%);width:20px;height:20px;border-radius:50%"></div>`;
      }
    } else if (shape === 'round_booth') {
      chairsHtml += `<div class="plan-roundbooth-cushion"></div>`;
      for (let i = 0; i < seats; i++) {
        const angle = (1.5 * Math.PI / Math.max(1, seats - 1 || 1)) * i - (1.25 * Math.PI);
        const radius = 48;
        const left = 50 + radius * Math.cos(angle);
        const top = 50 + radius * Math.sin(angle);
        const deg = (angle * 180 / Math.PI) + 90;
        chairsHtml += `<div class="${chairClass}" style="left:${left.toFixed(1)}%;top:${top.toFixed(1)}%;transform:translate(-50%,-50%) rotate(${deg.toFixed(1)}deg);width:22px;height:9px;border-radius:5px"></div>`;
      }
    } else if (shape === 'circle') {
      for (let i = 0; i < seats; i++) {
        const angle = (2 * Math.PI / seats) * i - (Math.PI / 2);
        const r = 56;
        const left = 50 + r * Math.cos(angle);
        const top = 50 + r * Math.sin(angle);
        const deg = (angle * 180 / Math.PI) + 90;
        chairsHtml += `<div class="${chairClass}" style="left:${left.toFixed(1)}%;top:${top.toFixed(1)}%;transform:translate(-50%,-50%) rotate(${deg.toFixed(1)}deg);width:22px;height:10px;border-radius:5px"></div>`;
      }
    } else if (shape === 'square') {
      const perSide = Math.ceil(seats / 4);
      for (let s = 0; s < 4; s++) {
        for (let i = 0; i < perSide && (s * perSide + i) < seats; i++) {
          const pos = i / Math.max(1, perSide - 1);
          const pct = 20 + pos * 60;
          if (s === 0) chairsHtml += `<div class="${chairClass}" style="top:-14px;left:${pct}%;transform:translateX(-50%);width:22px;height:10px;border-radius:6px 6px 3px 3px"></div>`;
          else if (s === 1) chairsHtml += `<div class="${chairClass}" style="bottom:-14px;left:${pct}%;transform:translateX(-50%);width:22px;height:10px;border-radius:3px 3px 6px 6px"></div>`;
          else if (s === 2) chairsHtml += `<div class="${chairClass}" style="left:-14px;top:${pct}%;transform:translateY(-50%);width:10px;height:22px;border-radius:6px 3px 3px 6px"></div>`;
          else chairsHtml += `<div class="${chairClass}" style="right:-14px;top:${pct}%;transform:translateY(-50%);width:10px;height:22px;border-radius:3px 6px 6px 3px"></div>`;
        }
      }
    } else if (shape === 'booth') {
      chairsHtml += `<div class="plan-booth-cushion plan-booth-cushion--top"></div><div class="plan-booth-cushion plan-booth-cushion--bottom"></div>`;
    } else if (shape === 'bar_stool') {
      for (let i = 0; i < seats; i++) {
        const offset = seats === 1 ? 50 : 18 + (i * (64 / (seats - 1)));
        chairsHtml += `<div class="${chairClass} plan-chair--stool" style="bottom:-16px;left:${offset}%;transform:translateX(-50%);width:18px;height:18px;border-radius:50%"></div>`;
      }
    } else if (shape === 'oval') {
      for (let i = 0; i < seats; i++) {
        const angle = (2 * Math.PI / seats) * i - (Math.PI / 2);
        const rx = 56; const ry = 46;
        const left = 50 + rx * Math.cos(angle);
        const top = 50 + ry * Math.sin(angle);
        const deg = (angle * 180 / Math.PI) + 90;
        chairsHtml += `<div class="${chairClass}" style="left:${left.toFixed(1)}%;top:${top.toFixed(1)}%;transform:translate(-50%,-50%) rotate(${deg.toFixed(1)}deg);width:24px;height:10px;border-radius:5px"></div>`;
      }
    } else if (shape === 'lounge_takht') {
      chairsHtml = `
        <div class="plan-takht-rug"></div>
        <div class="plan-takht-cushion plan-takht-cushion--n" title="پشتی سنتی"></div>
        <div class="plan-takht-cushion plan-takht-cushion--s" title="پشتی سنتی"></div>
        <div class="plan-takht-cushion plan-takht-cushion--e" title="پشتی سنتی"></div>
        <div class="plan-takht-cushion plan-takht-cushion--w" title="پشتی سنتی"></div>
      `;
    } else {
      if (seats <= 2) {
        chairsHtml += `<div class="${chairClass}" style="top:-14px;left:50%;transform:translateX(-50%);width:34px;height:10px;border-radius:6px 6px 3px 3px"></div>`;
        if (seats === 2) chairsHtml += `<div class="${chairClass}" style="bottom:-14px;left:50%;transform:translateX(-50%);width:34px;height:10px;border-radius:3px 3px 6px 6px"></div>`;
      } else {
        const half = Math.ceil(seats / 2);
        const otherHalf = seats - half;
        for (let i = 0; i < half; i++) {
          const xPos = half === 1 ? 50 : 16 + (i * (68 / (half - 1)));
          chairsHtml += `<div class="${chairClass}" style="top:-14px;left:${xPos.toFixed(1)}%;transform:translateX(-50%);width:26px;height:10px;border-radius:6px 6px 3px 3px"></div>`;
        }
        for (let i = 0; i < otherHalf; i++) {
          const xPos = otherHalf === 1 ? 50 : 16 + (i * (68 / (otherHalf - 1)));
          chairsHtml += `<div class="${chairClass}" style="bottom:-14px;left:${xPos.toFixed(1)}%;transform:translateX(-50%);width:26px;height:10px;border-radius:3px 3px 6px 6px"></div>`;
        }
      }
    }

    const timerHtml = table.serviceEndsAt && !table.autoReleased && ['busy', 'attention'].includes(table.state)
      ? `<time class="plan-table-timer" data-service-ends="${esc(table.serviceEndsAt)}">${floorCountdownLabel(table.serviceEndsAt)}</time>` : '';

    const isMergedParent = table.mergedWith && Array.isArray(table.mergedWith) && table.mergedWith.length > 0;
    const isMergedSub = Boolean(table.mergedInto);
    let mergeBadgeHtml = '';
    if (isMergedParent) {
      mergeBadgeHtml = `<span class="plan-table-merge-badge" title="میز والد ادغام‌شده">🔗 ادغام (${fmtNum(table.mergedWith.length + 1)} میز)</span>`;
    } else if (isMergedSub) {
      mergeBadgeHtml = `<span class="plan-table-merge-badge is-sub" title="میز فرعی پیوندخورده">🔗 متصل به میز ${esc(table.mergedInto)}</span>`;
    }

    const standardZones = ['سالن', 'تراس', 'ویژه'];
    const existingZones = Array.from(new Set(tables.map((t) => normalizeZone(t.zone)).filter(Boolean)));
    const allZonesList = Array.from(new Set([...standardZones, ...existingZones]));
    const zoneOptions = allZonesList.map((z) => `<option value="${esc(z)}" ${normalizeZone(table.zone) === z ? 'selected' : ''}>${esc(z)}</option>`).join('');

    const isNearTop = Number(table.y) < 22;
    const isNearLeft = Number(table.x) < 25;
    const isNearRight = Number(table.x) > 75;
    const alignX = isNearLeft ? 'left' : isNearRight ? 'right' : 'center';

    const isMerged = isMergedParent || isMergedSub;
    const paletteHtml = (isSelected && isEditMode && Number(selectedTableId) === Number(table.id)) ? `
      <div class="table-floating-palette" data-flip-down="${isNearTop}" data-align-x="${alignX}" data-palette-for="${table.id}">
        <div class="table-palette-cluster table-palette-cluster--seats">
          <button type="button" class="palette-mini-btn" data-table-action="dec-seats" title="کاهش صندلی (-)">−</button>
          <span class="palette-seats-badge" title="تعداد صندلی‌ها">${fmtNum(seats)} صندلی</span>
          <button type="button" class="palette-mini-btn" data-table-action="inc-seats" title="افزایش صندلی (+)">＋</button>
        </div>
        <div class="table-palette-cluster table-palette-cluster--scale" title="تنظیم مقیاس و اندازه مهندسی میز">
          <button type="button" class="palette-mini-btn" data-table-action="dec-scale" title="کوچک‌کردن ابعاد میز (−)">−</button>
          <span class="palette-seats-badge" title="ضریب مقیاس میز">${(Number(table.scale) || 1).toFixed(1)}×</span>
          <button type="button" class="palette-mini-btn" data-table-action="inc-scale" title="بزرگ‌کردن ابعاد میز (＋)">＋</button>
        </div>
        <button type="button" class="palette-studio-btn" data-table-action="furniture-modal" title="استودیوی مبلمان">
          <span>${shapeIcon(shape)} ${shapeTitle(shape)}</span>
          <span class="palette-chair-tag" title="مدل صندلی: ${chairLabel(chairModel)}">${chairIcon(chairModel)}</span>
        </button>
        <button type="button" class="palette-btn" data-table-action="rotate" title="چرخش ۴۵ درجه">↻ ۴۵°</button>
        <select data-table-action="zone-select" title="بخش سالن" style="background:#1e293b;border:1px solid rgba(255,255,255,0.15);color:#f8fafc;padding:3px 6px;border-radius:8px;font-size:11px;font-weight:700">
          ${zoneOptions}
        </select>
        <button type="button" class="palette-btn" data-table-action="toggle-shape" title="چرخش فرم هندسی">⊞ فرم</button>
        <div class="palette-more-wrapper">
          <button type="button" class="palette-btn palette-btn--more" data-table-action="toggle-more" title="عملیات بیشتر">⋯</button>
          <div class="palette-more-menu" id="palette-more-menu-${table.id}" style="display:none;">
            <button type="button" data-table-action="toggle-active" style="color:${table.active !== false ? '#34d399' : '#94a3b8'}">
              ${table.active !== false ? '🟢 میز فعال است' : '⚪ میز خاموش است'}
            </button>
            <button type="button" data-table-action="rename">✏️ تغییر نام و کد میز</button>
            <button type="button" data-table-action="merge" style="color:${isMerged ? '#fbbf24' : '#38bdf8'}">
              ${isMerged ? '🔗 تفکیک پیوند' : '🔗 ادغام میزها'}
            </button>
            <button type="button" data-table-action="move-floor">🏢 انتقال به طبقه</button>
            <button type="button" data-table-action="duplicate" style="color:#38bdf8">⧉ کپی میز</button>
            <button type="button" class="is-delete" data-table-action="delete" style="color:#f43f5e">🗑️ حذف این میز</button>
          </div>
        </div>
        <button type="button" data-table-action="close" title="بستن پالت" style="background:transparent;border:none;color:#94a3b8;font-size:13px;padding:2px 6px;cursor:pointer">✕</button>
      </div>` : '';

    return `
      <div class="plan-table plan-table--${esc(shape)} ${isSelected ? 'is-selected' : ''} ${isMergedParent ? 'is-merged-parent' : ''} ${isMergedSub ? 'is-merged-sub' : ''}"
           data-table="${esc(table.id)}"
           role="button" tabindex="0"
           data-state="${esc(table.state || (table.active === false ? 'inactive' : 'available'))}"
           data-seats="${seats}"
           ${table.autoReleased ? 'data-auto-released="true"' : ''}
           style="left:${table.x}%; top:${table.y}%; transform: translate(-50%, -50%) rotate(${table.rotation || 0}deg) scale(${table.scale || 1}); --table-rot: ${table.rotation || 0}deg; --table-scale: ${table.scale || 1};"
           title="${esc(tableTitle(table))} — ${esc(table.stateLabel || 'آزاد')}"
           aria-label="${esc(tableTitle(table))} — ${esc(table.stateLabel || 'آزاد')}، ${fmtNum(seats)} صندلی">
        ${chairsHtml}
        <div class="plan-table-surface">
          <span class="plan-table-number">${esc(tableTitle(table))}</span>
          <span class="plan-table-meta">${fmtNum(seats)} نفر · ${esc(normalizeZone(table.zone))}</span>
          ${mergeBadgeHtml}
          ${timerHtml}
        </div>
        ${paletteHtml}
        ${isEditMode && isSelected ? `
          <div class="table-resize-handle table-resize-handle--nw" data-resize-corner="nw" data-table-resize="${esc(table.id)}"></div>
          <div class="table-resize-handle table-resize-handle--ne" data-resize-corner="ne" data-table-resize="${esc(table.id)}"></div>
          <div class="table-resize-handle table-resize-handle--sw" data-resize-corner="sw" data-table-resize="${esc(table.id)}"></div>
          <div class="table-resize-handle table-resize-handle--se" data-resize-corner="se" data-table-resize="${esc(table.id)}"></div>` : ''}
      </div>`;
  };

  // ─── Main Render ─────────────────────────────────────────────────────
  const render = () => {
    if (currentView === 'map') { renderMapView(); }
    else { renderCardsView(); }
  };

  const renderMapView = () => {
    const currentFloorTables = tables.filter((t) => (t.floorId || 'floor-ground') === activeFloorId);
    const standardZones = ['سالن', 'تراس', 'ویژه'];
    const existingZones = Array.from(new Set(currentFloorTables.map((t) => normalizeZone(t.zone)).filter(Boolean)));
    const allZonesList = Array.from(new Set([...standardZones, ...existingZones]));
    const zonesList = ['all', ...allZonesList];
    const zoneTitle = (z) => ({ all: 'همه بخش‌ها', سالن: 'سالن اصلی 🛋️', تراس: 'تراس و فضای باز 🌿', ویژه: 'سالن اختصاصی ویژه 👑' }[z] || z);

    const visibleTables = activeZone === 'all'
      ? currentFloorTables
      : currentFloorTables.filter((t) => normalizeZone(t.zone) === activeZone);
    const visibleFixtures = floorFixtures.filter((f) => (f.floorId || 'floor-ground') === activeFloorId);

    const busyCount = currentFloorTables.filter((t) => t.state === 'busy').length;
    const attnCount = currentFloorTables.filter((t) => t.state === 'attention').length;
    const freeCount = currentFloorTables.filter((t) => t.state === 'available' || !t.state).length;
    const totalSeats = currentFloorTables.reduce((acc, t) => acc + (Number(t.seats) || 0), 0);

    const renderedZonesHtml = floorZones.map((z) => {
      if (activeZone !== 'all' && activeZone !== z.name) return '';
      const isFullView = activeZone === z.name;
      const legacyClass = z.id === 'zone-main' ? 'plan-zone--main' : z.id === 'zone-terrace' ? 'plan-zone--terrace' : z.id === 'zone-vip' ? 'plan-zone--vip' : 'plan-zone--custom';
      const themeClass = `plan-zone--${z.color || 'blue'}`;
      const zoneTables = currentFloorTables.filter((t) => normalizeZone(t.zone) === z.name);
      const lM = z.lengthM || 10; const wM = z.widthM || 3;
      const areaM = z.areaSqM || Math.round(lM * wM * 10) / 10;

      const isSharedE = floorZones.some((o) => o.id !== z.id && Math.abs(o.x - (z.x + z.w)) <= 3.5 && Math.max(z.y, o.y) < Math.min(z.y + z.h, o.y + o.h));
      const isSharedW = floorZones.some((o) => o.id !== z.id && Math.abs((o.x + o.w) - z.x) <= 3.5 && Math.max(z.y, o.y) < Math.min(z.y + z.h, o.y + o.h));
      const isSharedS = floorZones.some((o) => o.id !== z.id && Math.abs(o.y - (z.y + z.h)) <= 3.5 && Math.max(z.x, o.x) < Math.min(z.x + z.w, o.x + o.w));
      const isSharedN = floorZones.some((o) => o.id !== z.id && Math.abs((o.y + o.h) - z.y) <= 3.5 && Math.max(z.x, o.x) < Math.min(z.x + z.w, o.x + o.w));
      const palettePlacementClass = z.y < 7 ? (z.y + z.h > 85 ? 'is-inside-top' : 'is-flipped-down') : '';
      const styleAttr = isFullView ? '' : `left:${z.x}%; top:${z.y}%; width:${z.w}%; height:${z.h}%;`;

      const architecturePalette = (isEditMode && studioMode === 'architecture' && !isFullView && selectedZoneId === z.id) ? `
        <div class="zone-floating-palette ${palettePlacementClass}" data-zone-id="${esc(z.id)}">
          <span class="zone-floating-palette__title">${esc(z.icon || '🏷️')} ${esc(z.name)} (📐 ${fmtNum(lM)}×${fmtNum(wM)}م)</span>
          <button type="button" data-zone-action="dimensions" data-zone-id="${esc(z.id)}" title="تنظیم متراژ و ابعاد">📏 متراژ</button>
          <button type="button" data-zone-action="rename" data-zone-id="${esc(z.id)}" title="تغییر نام فضا">✏️ نام</button>
          <button type="button" data-zone-action="color" data-zone-id="${esc(z.id)}" title="تغییر رنگ فضا">🎨 رنگ</button>
          <button type="button" data-zone-action="split" data-zone-id="${esc(z.id)}" title="تقسیم فضا به دو بخش">⊞ تقسیم</button>
          <button type="button" class="is-delete" data-zone-action="delete" data-zone-id="${esc(z.id)}" title="حذف کامل این فضا">🗑️ حذف فضا</button>
          <button type="button" data-zone-action="close" data-zone-id="${esc(z.id)}" title="بستن">✕</button>
        </div>` : '';

      const borderDelete = (isEditMode && studioMode === 'architecture' && !isFullView) ? `
        <button type="button" class="plan-zone__border-delete" data-zone-action="delete" data-zone-id="${esc(z.id)}" title="حذف این فضا (${esc(z.name)})">
          <span style="font-size:12px">🗑️</span>
          <span>حذف فضا</span>
        </button>` : '';

      const headerContent = isFullView ? `
        <div class="floor-fullzone-banner">
          <div class="floor-fullzone-banner__info">
            <span class="floor-fullzone-banner__tag">${esc(z.icon || '🏷️')} فضای اختصاصی بخش «${esc(z.name)}»</span>
            <span class="floor-fullzone-banner__dims">📐 ابعاد: <b>${fmtNum(lM)}</b> متر طول × <b>${fmtNum(wM)}</b> متر عرض · مساحت: <b>${fmtNum(areaM)}</b> مترمربع · فرم: <b>${shapeLabel(z.shape)}</b></span>
          </div>
          <div class="floor-fullzone-banner__actions">
            <button type="button" class="plan-zone__act-btn" data-zone-action="dimensions" data-zone-id="${esc(z.id)}">📏 تنظیم ابعاد و متراژ</button>
            <button type="button" class="plan-zone__act-btn" data-zone-action="rename" data-zone-id="${esc(z.id)}">✏️ تغییر نام</button>
            <button type="button" class="plan-zone__act-btn" data-zone-action="color" data-zone-id="${esc(z.id)}">🎨 تغییر رنگ</button>
            <button type="button" class="plan-zone__act-btn is-delete" data-zone-action="delete" data-zone-id="${esc(z.id)}">🗑️ حذف این بخش</button>
          </div>
        </div>` : `
        <div class="plan-zone__header">
          <div class="plan-zone__tag-group">
            <span class="plan-zone__tag">${esc(z.icon || '🏷️')} ${esc(z.name)}</span>
            <span class="plan-zone__count-badge">${fmtNum(zoneTables.length)} میز</span>
            <span class="plan-zone__count-badge" style="color:#94a3b8;background:rgba(255,255,255,0.06);border-color:rgba(255,255,255,0.1)">📐 ${fmtNum(lM)}×${fmtNum(wM)}م (${fmtNum(areaM)}م²)</span>
          </div>
          ${(isEditMode && studioMode === 'architecture') ? `
            <div class="plan-zone__actions">
              <button type="button" class="plan-zone__act-btn" data-zone-action="dimensions" data-zone-id="${esc(z.id)}" title="تنظیم متراژ">📏</button>
              <button type="button" class="plan-zone__act-btn" data-zone-action="rename" data-zone-id="${esc(z.id)}" title="تغییر نام">✏️</button>
              <button type="button" class="plan-zone__act-btn" data-zone-action="color" data-zone-id="${esc(z.id)}" title="تغییر رنگ">🎨</button>
              <button type="button" class="plan-zone__act-btn" data-zone-action="split" data-zone-id="${esc(z.id)}" title="تقسیم">⊞</button>
              <button type="button" class="plan-zone__act-btn is-delete" data-zone-action="delete" data-zone-id="${esc(z.id)}" title="حذف بخش">🗑️ حذف فضا</button>
            </div>` : ''}
        </div>`;

      const handles = (isEditMode && studioMode === 'architecture' && !isFullView) ? `
        <div class="zone-handle zone-handle--n ${isSharedN ? 'is-shared' : ''}" data-handle="n" data-zone-id="${esc(z.id)}"></div>
        <div class="zone-handle zone-handle--s ${isSharedS ? 'is-shared' : ''}" data-handle="s" data-zone-id="${esc(z.id)}"></div>
        <div class="zone-handle zone-handle--e ${isSharedE ? 'is-shared' : ''}" data-handle="e" data-zone-id="${esc(z.id)}"></div>
        <div class="zone-handle zone-handle--w ${isSharedW ? 'is-shared' : ''}" data-handle="w" data-zone-id="${esc(z.id)}"></div>
        <div class="zone-handle zone-handle--nw" data-handle="nw" data-zone-id="${esc(z.id)}"></div>
        <div class="zone-handle zone-handle--ne" data-handle="ne" data-zone-id="${esc(z.id)}"></div>
        <div class="zone-handle zone-handle--se" data-handle="se" data-zone-id="${esc(z.id)}"></div>
        <div class="zone-handle zone-handle--sw" data-handle="sw" data-zone-id="${esc(z.id)}"></div>` : '';

      return `
        <div class="plan-zone plan-zone--interactive ${legacyClass} ${themeClass} ${isFullView ? 'is-full-view' : ''} ${selectedZoneId === z.id ? 'is-selected' : ''} ${isSharedE ? 'has-shared-e' : ''} ${isSharedW ? 'has-shared-w' : ''} ${isSharedS ? 'has-shared-s' : ''} ${isSharedN ? 'has-shared-n' : ''}"
             data-zone-id="${esc(z.id)}"
             data-zone-name="${esc(z.name)}"
             style="${styleAttr}">
          ${architecturePalette}
          ${borderDelete}
          ${headerContent}
          ${handles}
        </div>`;
    }).join('');

    // Inspector drawer (live mode)
    const inspectorTable = (!isEditMode && selectedTableId) ? tableById(selectedTableId) : null;
    let inspectorHtml = '';
    if (inspectorTable) {
      const stateClass = inspectorTable.state || 'available';
      const stateLabel = inspectorTable.stateLabel || (inspectorTable.active === false ? 'غیرفعال' : 'آزاد');
      const isBusy = stateClass === 'busy';
      const isAttn = stateClass === 'attention';
      const timerStr = inspectorTable.serviceEndsAt ? floorCountdownLabel(inspectorTable.serviceEndsAt) : null;
      inspectorHtml = `
        <div class="floor-table-inspector" id="floor-inspector-card">
          <div class="floor-table-inspector__head">
            <h4 class="floor-table-inspector__title">
              <span>${esc(tableTitle(inspectorTable))}</span>
              <span class="floor-table-inspector__badge is-${esc(stateClass)}">${esc(stateLabel)}</span>
            </h4>
            <button type="button" class="floor-table-inspector__close" id="floor-inspector-close" title="بستن">✕</button>
          </div>
          <div class="floor-table-inspector__body">
            <div class="floor-table-inspector__row"><span>بخش سالن:</span><strong>${esc(normalizeZone(inspectorTable.zone))}</strong></div>
            <div class="floor-table-inspector__row"><span>ظرفیت پذیرایی:</span><strong>${fmtNum(inspectorTable.seats || 4)} نفر</strong></div>
            <div class="floor-table-inspector__row"><span>وضعیت سفارش:</span><strong>${isBusy ? (inspectorTable.serviceOrderId ? `سفارش #${inspectorTable.serviceOrderId}` : 'مشغول سرویس') : isAttn ? '⚠️ فراخوان گارسون' : 'آزاد برای پذیرش'}</strong></div>
            ${timerStr ? `<div class="floor-table-inspector__row"><span>زمان سرویس باقیمانده:</span><strong dir="ltr" style="color:#38bdf8">${timerStr}</strong></div>` : ''}
          </div>
          <div class="floor-table-inspector__actions">
            ${isAttn ? `<button type="button" class="floor-table-inspector__btn floor-table-inspector__btn--resolve" id="floor-inspector-resolve">✓ ثبت رسیدگی و بستن فراخوان</button>` : ''}
            <a class="floor-table-inspector__btn" href="${esc(qrAssetUrl(inspectorTable, { download: true }))}" download="westo-table-${inspectorTable.id}.png">🔲 دانلود رمزینه QR</a>
            <a class="floor-table-inspector__btn" href="${esc(tableDestination(inspectorTable))}" target="_blank" rel="noopener">📱 مشاهده منوی دیجیتال این میز</a>
            <button type="button" class="floor-table-inspector__btn" id="floor-inspector-switch-edit">📐 ویرایش و تنظیم مکان این میز</button>
          </div>
        </div>`;
    }

    const batchToolbarHtml = (isEditMode && selectedTableIds.size > 1) ? `
      <div class="floor-batch-toolbar" id="admin-batch-toolbar">
        <div class="floor-batch-toolbar__info"><span>${fmtNum(selectedTableIds.size)} میز انتخاب شده</span></div>
        <div class="floor-batch-toolbar__group">
          <span class="floor-batch-toolbar__label">تراز:</span>
          <button type="button" class="floor-batch-toolbar__btn" data-batch-act="align-left" title="تراز از لبه چپ">⇤ چپ</button>
          <button type="button" class="floor-batch-toolbar__btn" data-batch-act="align-center-x" title="تراز از مرکز افقی">⤹ وسط</button>
          <button type="button" class="floor-batch-toolbar__btn" data-batch-act="align-right" title="تراز از لبه راست">⇥ راست</button>
          <button type="button" class="floor-batch-toolbar__btn" data-batch-act="align-top" title="تراز از بالا">⤒ بالا</button>
          <button type="button" class="floor-batch-toolbar__btn" data-batch-act="align-center-y" title="تراز از مرکز عمودی">⤸ وسط</button>
          <button type="button" class="floor-batch-toolbar__btn" data-batch-act="align-bottom" title="تراز از پایین">⤓ پایین</button>
        </div>
        <div class="floor-batch-toolbar__group">
          <span class="floor-batch-toolbar__label">فاصله:</span>
          <button type="button" class="floor-batch-toolbar__btn" data-batch-act="distribute-h" title="توزیع مساوی افقی">⇔ افقی</button>
          <button type="button" class="floor-batch-toolbar__btn" data-batch-act="distribute-v" title="توزیع مساوی عمودی">⇕ عمودی</button>
        </div>
        <div class="floor-batch-toolbar__group">
          <button type="button" class="floor-batch-toolbar__btn floor-batch-toolbar__btn--primary" data-batch-act="batch-merge" title="ادغام میزها">🔗 ادغام میزها</button>
          <button type="button" class="floor-batch-toolbar__btn floor-batch-toolbar__btn--danger" data-batch-act="batch-delete" title="حذف میزهای انتخاب‌شده">🗑️ حذف</button>
          <button type="button" class="floor-batch-toolbar__btn" data-batch-act="batch-clear" title="لغو انتخاب">✕</button>
        </div>
      </div>` : '';

    const currentActiveZoneObj = activeZone !== 'all'
      ? floorZones.find((z) => z.name === activeZone || normalizeZone(z.name) === normalizeZone(activeZone))
      : null;

    main.innerHTML = `
      <div class="admin-floor-page ${isEditMode ? 'is-edit-mode' : 'is-live-mode'} ${isEditMode ? (studioMode === 'architecture' ? 'is-architecture-mode' : 'is-furniture-mode') : 'is-live-mode'}">
        <!-- ═══ 1. Studio Application Header / Global Action Bar ═══ -->
        <header class="admin-qr-page__head floor-studio-head">
          <div class="floor-head-primary">
            <div class="admin-qr-page__titles">
              <span class="admin-qr-kicker">🏛️ مرکز معماری و چیدمان سالن وستو</span>
              <h1 style="margin:2px 0 6px">استودیوی نقشه و چیدمان سالن</h1>
            </div>
            <!-- Multi-Floor Level Switcher embedded neatly in header -->
            <div class="floor-levels-bar" aria-label="مدیریت و انتخاب طبقات و فضاهای رستوران">
              <div class="floor-levels-bar__list">
                ${floorLevels.map((fl) => `
                  <button type="button" class="floor-level-pill ${activeFloorId === fl.id ? 'is-active' : ''}" data-floor-pill="${esc(fl.id)}">
                    <span class="floor-level-pill__icon">${esc(fl.icon || '🏛️')}</span>
                    <span class="floor-level-pill__name">${esc(fl.name)}</span>
                    <span class="floor-level-pill__count">${fmtNum(tables.filter((t) => (t.floorId || 'floor-ground') === fl.id).length)} میز</span>
                    ${floorLevels.length > 1 ? `<span class="floor-level-pill__settings" data-edit-floor-pill="${esc(fl.id)}" title="تنظیمات طبقه">⚙️</span>` : ''}
                  </button>`).join('')}
                <button type="button" class="floor-level-pill floor-level-pill--add" id="map-add-floor" title="تعریف طبقه یا فضای جدید رستوران">
                  <span>＋ افزودن طبقه…</span>
                </button>
              </div>
            </div>
          </div>

          <div class="admin-qr-page__actions floor-head-actions">
            <div class="floor-segmented" role="tablist" aria-label="انتخاب نمای کاربری">
              <button type="button" class="floor-segmented__btn active" id="view-mode-map">📐 نقشه سالن</button>
              <button type="button" class="floor-segmented__btn" id="view-mode-cards">🔲 رمزینه‌ها و لیست</button>
            </div>
            <div class="floor-head-utility-btns">
              <button type="button" class="btn btn-sm btn-ghost" id="map-templates-btn" title="الگوها و چیدمان‌های آماده رستوران">📋 قالب‌های آماده</button>
              <button type="button" class="btn btn-sm btn-ghost" id="map-floor-settings" title="ابعاد مهندسی، متراژ و تنظیمات نقشه">⚙️ تنظیمات پلان</button>
              <button type="button" class="btn btn-sm btn-ghost" id="map-export-json" title="دریافت فایل پشتیبان چیدمان (JSON)">💾 پشتیبان</button>
              <button type="button" class="btn btn-sm btn-ghost" id="map-import-json" title="درون‌ریزی فایل چیدمان (JSON)">📂 بازیابی</button>
            </div>
            <div class="floor-save-status" id="map-save-status"><span>✓ چیدمان ذخیره است</span></div>
            <button class="btn btn-sm btn-primary" id="map-save-layout" type="button">✓ ذخیره چیدمان نقشه</button>
          </div>
        </header>

        <!-- ═══ 2. Compact Live Ops Strip (High-Density Telemetry Ticker) ═══ -->
        <div class="ops-metrics" aria-label="وضعیت زنده سالن">
          <span class="ops-metric-title">📊 آمار زنده این طبقه:</span>
          <article class="ops-metric"><strong>${fmtNum(currentFloorTables.length)}</strong><span>میز تعریف‌شده</span></article>
          <article class="ops-metric is-accent"><strong>${fmtNum(busyCount)}</strong><span>در حال سرویس</span></article>
          <article class="ops-metric"><strong>${fmtNum(floorData?.summary?.reservations || 0)}</strong><span>رزرو امروز</span></article>
          <article class="ops-metric ${attnCount ? 'is-warn' : ''}"><strong>${fmtNum(attnCount)}</strong><span>فراخوان گارسون</span></article>
          <article class="ops-metric"><strong>${fmtNum(totalSeats)}</strong><span>ظرفیت پذیرایی (${fmtNum(totalSeats)} نفر)</span></article>
        </div>

        <!-- ═══ 3. Professional CAD Unified Tool Ribbon (ALL TOOLS IN ONE ROW) ═══ -->
        <div class="floor-toolbar" role="toolbar" aria-label="نوار ابزار حرفه‌ای طراحی و ویرایش سالن">
          <!-- Group A: Edit Mode Toggle & Sub-mode Switcher -->
          <div class="floor-toolbar__group">
            <button type="button" class="floor-edit-toggle ${isEditMode ? 'is-editing' : ''}" id="map-toggle-edit" title="فعال یا غیرفعال کردن حالت ویرایش چیدمان">
              <span>${isEditMode ? '✏️ حالت ویرایش فعال' : '🔒 قفل (حالت نمایش)'}</span>
            </button>
            <div class="floor-studio-mode-switcher" id="map-studio-mode-switcher" style="${isEditMode ? '' : 'display:none;'}">
              <button type="button" class="floor-studio-mode-btn ${studioMode === 'furniture' ? 'is-active' : ''}" id="map-mode-furniture" title="حالت چیدمان میزها و صندلی‌ها">
                <span>🛋️ مبلمان</span>
              </button>
              <button type="button" class="floor-studio-mode-btn ${studioMode === 'architecture' ? 'is-active' : ''}" id="map-mode-architecture" title="حالت معماری و تفکیک فضاها">
                <span>📐 فضاها</span>
              </button>
            </div>
          </div>

          <div class="floor-toolbar__divider"></div>

          <!-- Group B: Element Creation & Insertion Palette (Insert) -->
          <div class="floor-toolbar__group">
            <button class="floor-tool-btn floor-tool-btn--primary" id="map-add-table" type="button" title="افزودن میز پذیرایی جدید به سالن">
              <span>＋ 🪑 میز جدید</span>
            </button>
            <button class="floor-tool-btn" id="map-add-fixture" type="button" title="افزودن سازه معماری، پیشخوان، بار، آشپزخانه، پله یا سرویس">
              <span>＋ 🏛️ سازه معماری</span>
            </button>
            <button class="floor-tool-btn ${isDrawingZone ? 'is-active' : ''}" id="map-draw-zone" type="button" title="ترسیم محدوده بخش جدید با ماوس روی نقشه">
              <span>＋ 📐 ترسیم بخش</span>
            </button>
          </div>

          <div class="floor-toolbar__divider"></div>

          <!-- Group C: Precision Snapping & CAD Alignment -->
          <div class="floor-toolbar__group">
            <button class="floor-tool-btn" id="map-auto-align" type="button" title="مرتب‌سازی خودکار میزها در هر بخش">
              <span>↺ تراز خودکار</span>
            </button>
            <div class="floor-snapping-ctrl" style="display:inline-flex;align-items:center;gap:3px">
              <span class="floor-toolbar__label" title="تنظیم دقت پرش به شبکه (Grid Snapping)">🧲 شبکه:</span>
              <button type="button" class="floor-snap-pill ${snapGridStep === 0.5 ? 'is-active' : ''}" data-snap-val="0.5">آزاد</button>
              <button type="button" class="floor-snap-pill ${snapGridStep === 2 ? 'is-active' : ''}" data-snap-val="2">۲٪</button>
              <button type="button" class="floor-snap-pill ${snapGridStep === 5 ? 'is-active' : ''}" data-snap-val="5">۵٪</button>
            </div>
          </div>

          <div class="floor-toolbar__divider"></div>

          <!-- Group D: History (Undo / Redo) -->
          <div class="floor-toolbar__group floor-history-buttons">
            <button type="button" class="floor-tool-btn" id="map-history-undo" title="بازگشت تغییر قبلی (Ctrl+Z)" ${layoutHistory.length === 0 ? 'disabled' : ''}>↩</button>
            <button type="button" class="floor-tool-btn" id="map-history-redo" title="بازانجام تغییر (Ctrl+Y)" ${layoutRedoHistory.length === 0 ? 'disabled' : ''}>↪</button>
          </div>

          <div class="floor-toolbar__divider"></div>

          <!-- Group E: Zone Filtering & Active Zone Management -->
          <div class="floor-toolbar__group floor-toolbar__group--zones">
            <span class="floor-toolbar__label">بخش:</span>
            <div class="floor-zone-pills">
              ${zonesList.map((z) => `
                <button type="button" class="floor-zone-pill ${activeZone === z ? 'active' : ''}" data-zone-pill="${esc(z)}">
                  <span>${esc(zoneTitle(z))}</span>
                  <small>${fmtNum(z === 'all' ? currentFloorTables.length : currentFloorTables.filter((t) => normalizeZone(t.zone) === z).length)}</small>
                  ${z !== 'all' ? `<span class="floor-zone-pill__del" data-delete-zone-pill="${esc(z)}" title="حذف بخش «${esc(z)}»" role="button">✕</span>` : ''}
                </button>`).join('')}
              <button type="button" class="floor-zone-pill floor-zone-pill--add" id="map-add-zone" title="تعریف بخش اختصاصی جدید">＋ بخش…</button>
            </div>
            ${currentActiveZoneObj ? `
              <div class="floor-active-zone-strip">
                <span class="floor-active-zone-strip__dims">📐 ${fmtNum(currentActiveZoneObj.lengthM || 10)}×${fmtNum(currentActiveZoneObj.widthM || 3)}م</span>
                <button type="button" class="floor-active-zone-strip__btn" id="map-active-zone-dims" title="تنظیم متراژ و ابعاد معماری">📏 ابعاد</button>
                <button type="button" class="floor-active-zone-strip__btn" id="map-active-zone-rename" title="تغییر نام این بخش">✏️ نام</button>
                <button type="button" class="floor-active-zone-strip__btn" id="map-active-zone-color" title="تغییر رنگ این بخش">🎨 رنگ</button>
                <button type="button" class="floor-active-zone-strip__btn floor-active-zone-strip__btn--danger" id="map-active-zone-delete" title="حذف کامل این بخش">🗑️</button>
              </div>` : ''}
          </div>
        </div>

        <!-- ═══ 4. Quick Status Key Strip ═══ -->
        <div class="floor-canvas-legend floor-canvas-legend--top" aria-label="راهنمای وضعیت میزها">
          <strong>وضعیت میزها:</strong>
          <span class="leg-item"><i class="leg-dot leg-dot--avail"></i> آزاد (${fmtNum(freeCount)})</span>
          <span class="leg-item"><i class="leg-dot leg-dot--busy"></i> در سرویس (${fmtNum(busyCount)})</span>
          <span class="leg-item"><i class="leg-dot leg-dot--attn"></i> فراخوان (${fmtNum(attnCount)})</span>
          <span class="leg-item"><i class="leg-dot leg-dot--res"></i> رزرو</span>
          <span class="leg-item"><i class="leg-dot" style="background:#94a3b8"></i> غیرفعال</span>
        </div>

        <div class="architectural-canvas-wrap ${isEditMode ? 'is-edit-mode' : ''} ${isDrawingZone ? 'is-drawing-zone' : ''} studio-mode--${isEditMode ? studioMode : 'live'} floor-theme--${floorSettings.bgTheme || 'slate-blueprint'}" id="admin-floor-canvas">
          ${floorSettings.showRulers !== false ? `
            <div class="floor-canvas-ruler-x" id="admin-ruler-x">${renderRulerTicksX(floorSettings.lengthM || 20)}</div>
            <div class="floor-canvas-ruler-y" id="admin-ruler-y">${renderRulerTicksY(floorSettings.widthM || 15)}</div>` : ''}

          <div class="admin-floor-canvas-scaler" id="admin-canvas-scaler" style="transform: translate(${canvasPanX}px, ${canvasPanY}px) scale(${canvasZoom}); transform-origin: center center;">
            ${renderedZonesHtml}

            <svg class="floor-canvas-connectors" style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:2">
              ${renderSvgConnectors()}
            </svg>

            <div class="plan-fixtures-layer" id="admin-fixtures-layer">
              ${visibleFixtures.length > 0 ? visibleFixtures.map((f) => renderFixtureItem(f)).join('') : `
                <div class="plan-fixture plan-fixture--entrance" title="ورودی اصلی رستوران"></div>
                <div class="plan-fixture plan-fixture--bar">☕ بار گرم و سرد</div>
                <div class="plan-fixture plan-fixture--kitchen">🍳 تحویل غذا</div>
                <div class="plan-fixture plan-fixture--cashier">💳 صندوق و پذیرش</div>
                <div class="plan-fixture plan-fixture--restroom">🚻 سرویس</div>`}
            </div>

            <div class="plan-tables-layer" id="admin-tables-layer">
              ${visibleTables.map((t) => renderPlanTableItem(t)).join('')}
            </div>
          </div>

          ${batchToolbarHtml}
          ${inspectorHtml}

          <div class="floor-canvas-controls">
            <button type="button" id="map-zoom-out" title="کوچک‌نمایی">－</button>
            <span class="zoom-indicator" id="map-zoom-label">${Math.round(canvasZoom * 100)}٪</span>
            <button type="button" id="map-zoom-in" title="بزرگ‌نمایی">＋</button>
            <button type="button" id="map-zoom-reset" title="اندازه پیش‌فرض (۱۰۰٪)">۱۰۰٪</button>
          </div>
        </div>

        <div class="floor-legend">
          <div><strong>راهنمای استودیوی معماری و نقشه سالن وستو:</strong>
          با Drag & Drop میزها و سازه‌های معماری را جابجا کنید. با انتخاب هر میز می‌توانید فرم هندسی آن را به ۷ حالت تغییر دهید، میزها را ادغام یا تفکیک کنید، تعداد صندلی را تغییر دهید، بین طبقات جابجا نمایید یا تکثیر کنید. همچنین با درگ ماوس روی پس‌زمینه نقشه، چند میز را انتخاب کرده و از نوار هم‌ترازی CAD استفاده کنید.</div>
        </div>
      </div>`;

    // بعد از render، event delegation را bind می‌کنیم
    bindMapEventDelegation();
  };

  // ─── Event Delegation — جایگزین bindMapEvents ────────────────────────
  // همه event ها روی یک canvas — بدون هزاران listener جداگانه
  const bindMapEventDelegation = () => {
    const canvas = document.getElementById('admin-floor-canvas');
    if (!canvas) return;

    const sig = signal();

    // ── View mode switchers ──
    document.getElementById('view-mode-map')?.addEventListener('click', () => setViewMode('map'), { signal: sig });
    document.getElementById('view-mode-cards')?.addEventListener('click', () => setViewMode('cards'), { signal: sig });

    // ── Zoom controls (direct DOM — بدون render) ──
    const scaler = document.getElementById('admin-canvas-scaler');
    const zoomLabel = document.getElementById('map-zoom-label');
    const updateZoomUi = () => {
      if (scaler) scaler.style.transform = `translate(${canvasPanX}px, ${canvasPanY}px) scale(${canvasZoom})`;
      if (zoomLabel) zoomLabel.textContent = `${Math.round(canvasZoom * 100)}٪`;
    };
    document.getElementById('map-zoom-in')?.addEventListener('click', () => { canvasZoom = Math.min(2.0, Math.round((canvasZoom + 0.1) * 10) / 10); updateZoomUi(); }, { signal: sig });
    document.getElementById('map-zoom-out')?.addEventListener('click', () => { canvasZoom = Math.max(0.5, Math.round((canvasZoom - 0.1) * 10) / 10); updateZoomUi(); }, { signal: sig });
    document.getElementById('map-zoom-reset')?.addEventListener('click', () => { canvasZoom = 1.0; canvasPanX = 0; canvasPanY = 0; updateZoomUi(); }, { signal: sig });

    // ── CAD Wheel Zoom (Ctrl/Cmd + Wheel یا Pinch روی تاچ‌پد) ──
    canvas.addEventListener('wheel', (e) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const delta = e.deltaY < 0 ? 0.08 : -0.08;
        canvasZoom = Math.max(0.4, Math.min(2.5, Math.round((canvasZoom + delta) * 100) / 100));
        updateZoomUi();
      }
    }, { passive: false, signal: sig });

    // ── CAD Pan with Spacebar or Middle Mouse Button ──
    let isSpaceDown = false;
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) {
        isSpaceDown = true;
        if (canvas) canvas.style.cursor = 'grab';
      }
    }, { signal: sig });

    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space') {
        isSpaceDown = false;
        if (canvas) canvas.style.cursor = '';
      }
    }, { signal: sig });

    // ── Snap grid ──
    main.querySelectorAll('.floor-snap-pill[data-snap-val]').forEach((btn) => {
      btn.addEventListener('click', () => {
        snapGridStep = parseFloat(btn.dataset.snapVal) || 0.5;
        main.querySelectorAll('.floor-snap-pill').forEach((b) => b.classList.toggle('is-active', b === btn));
      }, { signal: sig });
    });

    // ── Canvas click — deselect ──
    canvas.addEventListener('click', (e) => {
      if (!e.target.closest('.plan-table') && !e.target.closest('.table-floating-palette') &&
          !e.target.closest('.plan-fixture') && !e.target.closest('.fixture-floating-palette') &&
          !e.target.closest('.plan-zone') && !e.target.closest('.zone-floating-palette') &&
          !e.target.closest('.floor-table-inspector') && !e.target.closest('.floor-canvas-controls')) {
        let changed = false;
        if (selectedTableId !== null) { selectedTableId = null; changed = true; }
        if (selectedFixtureId !== null) { selectedFixtureId = null; changed = true; }
        if (selectedZoneId !== null) { selectedZoneId = null; changed = true; }
        if (changed) render();
      }
    }, { signal: sig });

    // ── Canvas pointerdown — Event Delegation برای table/fixture/zone/handle ──
    canvas.addEventListener('pointerdown', (e) => {
      // Spacebar + Pan or Middle Mouse Button (button 1) Pan
      if (isSpaceDown || e.button === 1) {
        e.preventDefault();
        const startX = e.clientX - canvasPanX;
        const startY = e.clientY - canvasPanY;
        if (canvas) canvas.style.cursor = 'grabbing';

        const onPanMove = (me) => {
          canvasPanX = Math.round(me.clientX - startX);
          canvasPanY = Math.round(me.clientY - startY);
          updateZoomUi();
        };
        const onPanUp = () => {
          window.removeEventListener('pointermove', onPanMove);
          window.removeEventListener('pointerup', onPanUp);
          if (canvas) canvas.style.cursor = isSpaceDown ? 'grab' : '';
        };
        window.addEventListener('pointermove', onPanMove);
        window.addEventListener('pointerup', onPanUp);
        return;
      }

      // Zone resize handle
      const handleEl = e.target.closest('.zone-handle');
      if (handleEl && isEditMode) {
        e.stopPropagation();
        e.preventDefault();
        handleZoneResize(e, handleEl);
        return;
      }

      // Fixture resize handle
      const fixHandleEl = e.target.closest('.fixture-handle--se');
      if (fixHandleEl && isEditMode) {
        e.stopPropagation();
        e.preventDefault();
        handleFixtureResize(e, fixHandleEl);
        return;
      }

      // Table resize handle (corner dot — اولویت بالاتر از drag)
      const tableResizeHandle = e.target.closest('.table-resize-handle');
      if (tableResizeHandle && isEditMode && studioMode === 'furniture') {
        e.stopPropagation();
        e.preventDefault();
        handleTableResize(e, tableResizeHandle);
        return;
      }

      // Table drag
      if (isEditMode) {
        const tableEl = e.target.closest('.plan-table');
        if (tableEl && !e.target.closest('.table-floating-palette')) {
          e.stopPropagation();
          e.preventDefault();
          handleTableDrag(e, tableEl);
          return;
        }

        // Fixture drag
        const fixEl = e.target.closest('.plan-fixture[data-fixture-id]');
        if (fixEl && !e.target.closest('.fixture-floating-palette') && !e.target.closest('.fixture-handle')) {
          e.preventDefault();
          handleFixtureDrag(e, fixEl);
          return;
        }
      }

      // Drawing zone
      if (isDrawingZone) {
        if (e.target.closest('.plan-table') || e.target.closest('.table-floating-palette') || e.target.closest('.plan-zone__actions') || e.target.closest('[data-zone-action]') || e.target.closest('.zone-handle') || e.target.closest('.floor-canvas-controls')) return;
        startZoneDrawing(e, canvas);
        return;
      }

      // Marquee selection
      if (isEditMode && !isDrawingZone) {
        if (e.target.closest('.plan-table') || e.target.closest('.plan-fixture') || e.target.closest('.table-floating-palette') || e.target.closest('.fixture-floating-palette') || e.target.closest('.plan-zone__actions') || e.target.closest('.plan-zone__border-delete') || e.target.closest('.zone-floating-palette') || e.target.closest('[data-zone-action]') || e.target.closest('.zone-handle') || e.target.closest('.floor-canvas-controls') || e.target.closest('.floor-batch-toolbar') || e.target.closest('.floor-table-inspector')) return;
        startMarqueeSelection(e, canvas);
      }
    }, { signal: sig });

    // ── Table click — select ──
    canvas.addEventListener('click', (e) => {
      if (e.target.closest('.table-floating-palette')) return;
      if (justDragged) return;
      const tableEl = e.target.closest('.plan-table');
      if (tableEl) {
        e.stopPropagation();
        const tableId = Number(tableEl.dataset.table);
        selectedZoneId = null;
        selectedFixtureId = null;
        if (Number(selectedTableId) !== tableId) {
          selectedTableId = tableId;
          render();
        }
      }
    }, { signal: sig });

    // ── Table palette action — click delegation ──
    canvas.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-table-action]');
      if (!btn) return;
      e.stopPropagation();
      const action = btn.dataset.tableAction;
      const paletteEl = btn.closest('.table-floating-palette');
      if (!paletteEl) return;
      const tableId = Number(paletteEl.dataset.paletteFor);
      const table = tableById(tableId);
      if (!table) return;

      if (action === 'furniture-modal') {
        promptTableFurnitureModal(table);
      } else if (action === 'toggle-more') {
        const menu = paletteEl.querySelector('.palette-more-menu');
        if (menu) menu.style.display = (menu.style.display === 'none' || !menu.style.display) ? 'flex' : 'none';
      } else if (action === 'rotate') {
        table.rotation = ((Number(table.rotation) || 0) + 45) % 360;
        const el = canvas.querySelector(`.plan-table[data-table="${table.id}"]`);
        if (el) {
          const sc = table.scale || 1;
          el.style.transform = `translate(-50%, -50%) rotate(${table.rotation}deg) scale(${sc})`;
          el.style.setProperty('--table-rot', `${table.rotation}deg`);
        }
        debouncedSaveFloor();
      } else if (action === 'toggle-shape') {
        const shapeCycle = ['rectangle', 'conference', 'semi_circle', 'wall_counter', 'circle', 'square', 'oval', 'booth', 'round_booth', 'bar_stool', 'lounge_takht'];
        const currIdx = shapeCycle.indexOf(table.shape || 'rectangle');
        table.shape = shapeCycle[(currIdx + 1) % shapeCycle.length];
        render(); debouncedSaveFloor();
      } else if (action === 'inc-seats') {
        table.seats = Math.min(24, (Number(table.seats) || 4) + 1);
        pushHistory();
        render(); debouncedSaveFloor();
      } else if (action === 'dec-seats') {
        table.seats = Math.max(1, (Number(table.seats) || 4) - 1);
        pushHistory();
        render(); debouncedSaveFloor();
      } else if (action === 'inc-scale') {
        const curScale = Number(table.scale) || 1;
        table.scale = Math.min(3.0, Math.round((curScale + 0.1) * 10) / 10);
        pushHistory();
        render(); debouncedSaveFloor();
      } else if (action === 'dec-scale') {
        const curScale = Number(table.scale) || 1;
        table.scale = Math.max(0.5, Math.round((curScale - 0.1) * 10) / 10);
        pushHistory();
        render(); debouncedSaveFloor();
      } else if (action === 'toggle-active') {
        table.active = table.active === false ? true : false;
        render(); debouncedSaveFloor();
        showToast(`میز ${tableTitle(table)} ${table.active ? 'فعال' : 'غیرفعال'} شد.`, 'info');
      } else if (action === 'merge') {
        if ((table.mergedWith && table.mergedWith.length > 0) || table.mergedInto) unmergeTable(table);
        else mergeTablesGroup(selectedTableIds);
      } else if (action === 'move-floor') {
        promptMoveTableFloor(table);
      } else if (action === 'duplicate') {
        const nextId = (tables.reduce((max, t) => Math.max(max, Number(t.id) || 0), 0)) + 1;
        const copy = { ...table, id: nextId, label: `${table.label || `میز ${table.id}`} (کپی)`, x: Math.min(92, (Number(table.x) || 50) + 5), y: Math.min(92, (Number(table.y) || 50) + 5), active: true };
        ensureTableGeometry(copy, tables.length);
        tables.push(copy);
        selectedTableId = copy.id;
        await saveFloorLayout(true);
        render();
        showToast(`میز «${copy.label}» تکثیر شد.`, 'success');
      } else if (action === 'rename') {
        promptRenameTable(table);
      } else if (action === 'delete') {
        await deleteTableFromMap(table.id);
      } else if (action === 'close') {
        selectedTableId = null; render();
      } else if (action === 'zone-select') {
        // handled via change event below
      }
    }, { signal: sig });

    // ── Zone select change (delegation) ──
    canvas.addEventListener('change', (e) => {
      const sel = e.target.closest('select[data-table-action="zone-select"]');
      if (sel) {
        const paletteEl = sel.closest('.table-floating-palette');
        if (!paletteEl) return;
        const table = tableById(Number(paletteEl.dataset.paletteFor));
        if (!table) return;
        table.zone = normalizeZone(e.target.value);
        render(); debouncedSaveFloor();
      }
    }, { signal: sig });

    // ── Zone actions ──
    canvas.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-zone-action]');
      if (!btn) return;
      e.stopPropagation();
      const action = btn.dataset.zoneAction;
      const zoneId = btn.dataset.zoneId;
      const zone = floorZones.find((z) => z.id === zoneId);
      if (!zone) return;
      if (action === 'rename') promptRenameZone(zone);
      else if (action === 'dimensions') promptZoneDimensions(zone);
      else if (action === 'color') cycleZoneColor(zone);
      else if (action === 'split') splitZone(zone);
      else if (action === 'delete') deleteZone(zone.id);
      else if (action === 'close') { selectedZoneId = null; render(); }
    }, { signal: sig });

    // ── Zone click (select) ──
    canvas.addEventListener('click', (e) => {
      if (e.target.closest('[data-zone-action]') || e.target.closest('.zone-handle') || e.target.closest('.plan-table') || e.target.closest('.plan-fixture')) return;
      const zoneEl = e.target.closest('.plan-zone--interactive');
      if (!zoneEl || !isEditMode) return;
      if (studioMode === 'architecture' || e.target.closest('.plan-zone__header')) {
        selectedZoneId = zoneEl.dataset.zoneId;
        selectedTableId = null;
        selectedFixtureId = null;
        render();
      }
    }, { signal: sig });

    // ── Fixture click & palette ──
    canvas.addEventListener('click', (e) => {
      if (e.target.closest('.fixture-floating-palette') || e.target.closest('.fixture-handle')) return;
      if (justDragged) return;
      const fixEl = e.target.closest('.plan-fixture[data-fixture-id]');
      if (!fixEl) return;
      e.stopPropagation();
      selectedFixtureId = fixEl.dataset.fixtureId;
      selectedTableId = null;
      render();
    }, { signal: sig });

    canvas.addEventListener('click', (e) => {
      const actBtn = e.target.closest('[data-fixture-action]');
      if (!actBtn) return;
      e.stopPropagation();
      const fId = actBtn.closest('.plan-fixture')?.dataset.fixtureId;
      const fixture = floorFixtures.find((f) => f.id === fId);
      if (!fixture) return;
      const action = actBtn.dataset.fixtureAction;
      if (action === 'rotate') {
        fixture.rotation = ((Number(fixture.rotation) || 0) + 45) % 360;
        const el = canvas.querySelector(`.plan-fixture[data-fixture-id="${fId}"]`);
        if (el) el.style.transform = `rotate(${fixture.rotation}deg)`;
        debouncedSaveFloor();
      } else if (action === 'delete') {
        deleteFixture(fixture.id);
      } else if (action === 'close') {
        selectedFixtureId = null; render();
      }
    }, { signal: sig });

    // ── Zone pills ──
    main.querySelectorAll('[data-zone-pill]').forEach((pill) => {
      pill.addEventListener('click', (e) => {
        if (e.target.closest('[data-delete-zone-pill]')) {
          e.stopPropagation();
          const delName = e.target.closest('[data-delete-zone-pill]').dataset.deleteZonePill;
          deleteZone(delName); return;
        }
        activeZone = pill.dataset.zonePill;
        render();
      }, { signal: sig });
    });

    // ── Active zone strip buttons ──
    const curActiveZone = activeZone !== 'all' ? floorZones.find((z) => z.name === activeZone || normalizeZone(z.name) === normalizeZone(activeZone)) : null;
    if (curActiveZone) {
      document.getElementById('map-active-zone-dims')?.addEventListener('click', () => promptZoneDimensions(curActiveZone), { signal: sig });
      document.getElementById('map-active-zone-rename')?.addEventListener('click', () => promptRenameZone(curActiveZone), { signal: sig });
      document.getElementById('map-active-zone-color')?.addEventListener('click', () => cycleZoneColor(curActiveZone), { signal: sig });
      document.getElementById('map-active-zone-delete')?.addEventListener('click', () => deleteZone(curActiveZone.id), { signal: sig });
    }

    // ── Studio controls ──
    const floorToolbarEl = main.querySelector('.floor-toolbar');
    if (floorToolbarEl) {
      floorToolbarEl.addEventListener('wheel', (e) => {
        if (e.deltaY && !e.deltaX) {
          e.preventDefault();
          floorToolbarEl.scrollLeft += e.deltaY;
        }
      }, { passive: false, signal: sig });
    }
    document.getElementById('map-add-zone')?.addEventListener('click', promptAddZone, { signal: sig });
    document.getElementById('map-mode-furniture')?.addEventListener('click', () => { studioMode = 'furniture'; isEditMode = true; selectedZoneId = null; render(); showToast('حالت چیدمان مبلمان و میزها فعال شد.', 'info'); }, { signal: sig });
    document.getElementById('map-mode-architecture')?.addEventListener('click', () => { studioMode = 'architecture'; isEditMode = true; selectedTableId = null; render(); showToast('حالت معماری و تفکیک فضاها فعال شد.', 'info'); }, { signal: sig });
    document.getElementById('map-toggle-edit')?.addEventListener('click', () => { isEditMode = !isEditMode; render(); showToast(isEditMode ? 'حالت ویرایش چیدمان فعال گردید.' : 'حالت ویرایش چیدمان ذخیره و بسته شد.', 'info'); }, { signal: sig });
    document.getElementById('map-add-table')?.addEventListener('click', addTableToMap, { signal: sig });
    document.getElementById('map-auto-align')?.addEventListener('click', autoAlignTables, { signal: sig });
    document.getElementById('map-save-layout')?.addEventListener('click', () => saveFloorLayout(false), { signal: sig });

    // ── Draw zone button ──
    document.getElementById('map-draw-zone')?.addEventListener('click', () => {
      isDrawingZone = !isDrawingZone;
      if (isDrawingZone) { isEditMode = true; studioMode = 'architecture'; }
      render();
      showToast(isDrawingZone ? 'حالت ترسیم فعال شد؛ روی نقشه کلیک کنید و ماوس را بکشید.' : 'حالت ترسیم غیرفعال شد.', 'info');
    }, { signal: sig });

    // ── Floor pills ──
    main.querySelectorAll('[data-floor-pill]').forEach((pill) => {
      pill.addEventListener('click', () => { activeFloorId = pill.dataset.floorPill; render(); }, { signal: sig });
    });
    main.querySelectorAll('[data-edit-floor-pill]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const targetFloor = floorLevels.find((fl) => fl.id === btn.dataset.editFloorPill);
        if (targetFloor) promptEditFloor(targetFloor);
      }, { signal: sig });
    });
    document.getElementById('map-add-floor')?.addEventListener('click', promptAddFloor, { signal: sig });
    document.getElementById('map-floor-settings')?.addEventListener('click', promptFloorSettings, { signal: sig });
    document.getElementById('map-templates-btn')?.addEventListener('click', showTemplateModal, { signal: sig });
    document.getElementById('map-export-json')?.addEventListener('click', exportLayoutJson, { signal: sig });
    document.getElementById('map-import-json')?.addEventListener('click', importLayoutJson, { signal: sig });

    // ── Undo / Redo ──
    document.getElementById('map-history-undo')?.addEventListener('click', undoLayout, { signal: sig });
    document.getElementById('map-history-redo')?.addEventListener('click', redoLayout, { signal: sig });
    document.getElementById('map-undo')?.addEventListener('click', undoLayout, { signal: sig });
    document.getElementById('map-redo')?.addEventListener('click', redoLayout, { signal: sig });

    // ── Add Fixture ──
    document.getElementById('map-add-fixture')?.addEventListener('click', promptAddFixture, { signal: sig });

    // ── Batch toolbar ──
    const batchToolbar = document.getElementById('admin-batch-toolbar');
    if (batchToolbar) {
      batchToolbar.querySelectorAll('[data-batch-act]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const act = btn.dataset.batchAct;
          if (act === 'batch-clear') { selectedTableIds.clear(); render(); }
          else if (act === 'batch-delete') { batchDeleteSelectedTables(); }
          else if (act === 'batch-merge') {
            if (selectedTableIds.size >= 2) {
              const arr = Array.from(selectedTableIds);
              const parentTable = tableById(arr[0]);
              if (parentTable) {
                parentTable.mergedWith = arr.slice(1);
                arr.slice(1).forEach((sid) => { const st = tableById(sid); if (st) st.mergedInto = arr[0]; });
                debouncedSaveFloor(); render();
                showToast(`${fmtNum(arr.length)} میز با موفقیت ادغام شدند.`, 'success');
              }
            }
          } else if (act.startsWith('align-')) alignSelectedTables(act.replace('align-', ''));
          else if (act.startsWith('distribute-')) distributeSelectedTables(act.replace('distribute-', ''));
        }, { signal: sig });
      });
    }

    // ── Inspector drawer ──
    document.getElementById('floor-inspector-close')?.addEventListener('click', () => { selectedTableId = null; render(); }, { signal: sig });
    document.getElementById('floor-inspector-switch-edit')?.addEventListener('click', () => { isEditMode = true; render(); showToast('حالت ویرایش چیدمان فعال گردید.', 'info'); }, { signal: sig });
    document.getElementById('floor-inspector-resolve')?.addEventListener('click', async () => {
      const inspTable = tableById(selectedTableId);
      if (!inspTable) return;
      try {
        let callId = inspTable.waiterCallId;
        if (!callId) {
          const callsData = await api(`/api/waiter/calls${branchQs()}`);
          const openCalls = Array.isArray(callsData?.calls) ? callsData.calls : Array.isArray(callsData) ? callsData : [];
          const matching = openCalls.find((c) => (c.status === 'open' || c.status === 'new') && (String(c.tableNo).includes(String(inspTable.id)) || String(c.tableNo).includes(String(inspTable.label))));
          if (matching) callId = matching.id;
        }
        if (callId) { await api(`/api/waiter/calls/${callId}`, { method: 'PATCH', body: JSON.stringify({ status: 'done' }) }); showToast('رسیدگی به فراخوان میز با موفقیت ثبت شد.', 'success'); }
        else showToast('فراخوان بازی برای این میز یافت نشد.', 'info');
        await loadFloorData(); render();
      } catch (err) { showToast(err.message || 'خطا در ثبت رسیدگی به فراخوان', 'error'); }
    }, { signal: sig });

    // ── Countdown timer — بر خلاف قبل، این timer cleanup می‌شود ──
    if (_countdownTimer) clearInterval(_countdownTimer);
    _countdownTimer = setInterval(() => {
      const canvas2 = document.getElementById('admin-floor-canvas');
      if (!canvas2) { clearInterval(_countdownTimer); _countdownTimer = null; return; }
      canvas2.querySelectorAll('.plan-table-timer[data-service-ends]').forEach((tEl) => {
        const ends = tEl.getAttribute('data-service-ends');
        if (ends) tEl.textContent = floorCountdownLabel(ends);
      });
    }, 1000);

    // ── Global keyboard shortcuts (یک بار ثبت، با AbortController cleanup) ──
    document.addEventListener('keydown', (e) => {
      if (currentView !== 'map') return;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault(); undoLayout();
      } else if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) {
        e.preventDefault(); redoLayout();
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedZoneId && !selectedTableId && !selectedFixtureId) {
        e.preventDefault(); deleteZone(selectedZoneId);
      }
    }, { signal: sig });
  };

  // ─── Zone Drawing ──────────────────────────────────────────────────────
  const startZoneDrawing = (e, canvas) => {
    const scaleEl = document.getElementById('admin-canvas-scaler') || canvas;
    const rect = scaleEl.getBoundingClientRect();
    const startX = ((e.clientX - rect.left) / rect.width) * 100;
    const startY = ((e.clientY - rect.top) / rect.height) * 100;
    const drawStart = { x: startX, y: startY, rect };

    const drawBox = document.createElement('div');
    drawBox.className = 'zone-drawing-rect';
    drawBox.style.cssText = `left:${startX}%;top:${startY}%;width:0%;height:0%`;
    scaleEl.appendChild(drawBox);

    const onMove = (ev) => {
      if (!drawStart) return;
      const curX = ((ev.clientX - drawStart.rect.left) / drawStart.rect.width) * 100;
      const curY = ((ev.clientY - drawStart.rect.top) / drawStart.rect.height) * 100;
      const x = Math.max(0, Math.min(100, Math.min(drawStart.x, curX)));
      const y = Math.max(0, Math.min(100, Math.min(drawStart.y, curY)));
      const w = Math.min(100 - x, Math.abs(curX - drawStart.x));
      const h = Math.min(100 - y, Math.abs(curY - drawStart.y));
      drawBox.style.left = `${x.toFixed(1)}%`;
      drawBox.style.top = `${y.toFixed(1)}%`;
      drawBox.style.width = `${w.toFixed(1)}%`;
      drawBox.style.height = `${h.toFixed(1)}%`;
      drawBox.innerHTML = `<span>${Math.round(w)}% × ${Math.round(h)}%</span>`;
    };

    const onUp = (ev) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      const curX = ((ev.clientX - drawStart.rect.left) / drawStart.rect.width) * 100;
      const curY = ((ev.clientY - drawStart.rect.top) / drawStart.rect.height) * 100;
      const x = Math.round(Math.max(0, Math.min(100, Math.min(drawStart.x, curX))));
      const y = Math.round(Math.max(0, Math.min(100, Math.min(drawStart.y, curY))));
      const w = Math.round(Math.min(100 - x, Math.abs(curX - drawStart.x)));
      const h = Math.round(Math.min(100 - y, Math.abs(curY - drawStart.y)));
      drawBox.remove();
      if (w >= 6 && h >= 6) { isDrawingZone = false; promptCreateZone(x, y, w, h); }
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  // ─── Marquee Selection ────────────────────────────────────────────────
  const startMarqueeSelection = (e, canvas) => {
    const scaleEl = document.getElementById('admin-canvas-scaler') || canvas;
    const rect = scaleEl.getBoundingClientRect();
    const startX = ((e.clientX - rect.left) / rect.width) * 100;
    const startY = ((e.clientY - rect.top) / rect.height) * 100;
    const marqueeStart = { x: startX, y: startY, rect };

    const marqueeBox = document.createElement('div');
    marqueeBox.className = 'floor-marquee-box';
    marqueeBox.style.cssText = `left:${startX}%;top:${startY}%;width:0%;height:0%`;
    scaleEl.appendChild(marqueeBox);

    const onMove = (ev) => {
      const curX = ((ev.clientX - marqueeStart.rect.left) / marqueeStart.rect.width) * 100;
      const curY = ((ev.clientY - marqueeStart.rect.top) / marqueeStart.rect.height) * 100;
      const x = Math.max(0, Math.min(100, Math.min(marqueeStart.x, curX)));
      const y = Math.max(0, Math.min(100, Math.min(marqueeStart.y, curY)));
      marqueeBox.style.left = `${x}%`; marqueeBox.style.top = `${y}%`;
      marqueeBox.style.width = `${Math.min(100 - x, Math.abs(curX - marqueeStart.x))}%`;
      marqueeBox.style.height = `${Math.min(100 - y, Math.abs(curY - marqueeStart.y))}%`;
    };

    const onUp = (ev) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      const curX = ((ev.clientX - marqueeStart.rect.left) / marqueeStart.rect.width) * 100;
      const curY = ((ev.clientY - marqueeStart.rect.top) / marqueeStart.rect.height) * 100;
      const minX = Math.min(marqueeStart.x, curX); const maxX = Math.max(marqueeStart.x, curX);
      const minY = Math.min(marqueeStart.y, curY); const maxY = Math.max(marqueeStart.y, curY);
      marqueeBox.remove();
      if (Math.abs(maxX - minX) > 2 && Math.abs(maxY - minY) > 2) {
        if (!ev.shiftKey) selectedTableIds.clear();
        tables.filter((t) => !activeFloorId || t.floorId === activeFloorId).forEach((t) => {
          const tx = Number(t.x) || 50; const ty = Number(t.y) || 50;
          if (tx >= minX && tx <= maxX && ty >= minY && ty <= maxY) selectedTableIds.add(Number(t.id));
        });
        render();
      }
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  // ─── View Mode ────────────────────────────────────────────────────────
  const setViewMode = (mode) => {
    currentView = mode;
    try { localStorage.setItem(VIEW_PREFS_KEY, mode); } catch {}
    render();
  };

  // ─── Cards View (QR studio) — simplified ─────────────────────────────
  const renderCardsView = () => {
    // این بخش از admin.js کپی می‌شود — تغییر اساسی در ساختار آن نداریم
    // فقط event binding در اینجا مستقیم انجام می‌شود
    // محتوای renderCardsView از admin.js موجود استفاده می‌شود (کوتاه‌سازی نشده)
    if (typeof opts.renderCardsView === 'function') {
      opts.renderCardsView({
        tables, floorData, selectedTableIds, qrPrefs, currentTableId: null,
        setViewMode, addTableToMap, deleteTableFromMap,
        tableById, tableTitle, activeTables, qrAssetUrl, tableDestination, qrEclLabel, qrEclHint,
        normalizeQrPrefs, saveQrPrefs, validHex, validBaseUrl,
      });
    }
  };

  // ─── CRUD Operations ─────────────────────────────────────────────────
  const addTableToMap = async () => {
    const nextId = (tables.reduce((max, t) => Math.max(max, Number(t.id) || 0), 0)) + 1;
    const targetZone = activeZone === 'all' ? 'سالن' : activeZone;
    const standardZones = ['سالن', 'تراس', 'ویژه'];
    const existingZones = Array.from(new Set(tables.map((t) => normalizeZone(t.zone)).filter(Boolean)));
    const allZonesList = Array.from(new Set([...standardZones, ...existingZones]));
    const defaultLabel = `میز ${nextId}`;

    showFloorModal({
      title: '➕ افزودن میز جدید به نقشه',
      confirmText: 'ایجاد و قرار دادن روی نقشه',
      confirmClass: 'btn-primary',
      bodyHtml: `
        <div class="floor-studio-modal__field">
          <label for="fm-table-label">نام یا شماره برچسب میز:</label>
          <input id="fm-table-label" type="text" value="${esc(defaultLabel)}" required />
        </div>
        <div class="floor-studio-modal__field">
          <label for="fm-table-floor">طبقه یا فضا:</label>
          <select id="fm-table-floor">
            ${floorLevels.map((fl) => `<option value="${esc(fl.id)}" ${fl.id === activeFloorId ? 'selected' : ''}>${esc(fl.icon || '🏛️')} ${esc(fl.name)}</option>`).join('')}
          </select>
        </div>
        <div class="floor-studio-modal__field">
          <label for="fm-table-zone">بخش سالن (زون):</label>
          <select id="fm-table-zone">
            ${allZonesList.map((z) => `<option value="${esc(z)}" ${z === targetZone ? 'selected' : ''}>${esc(z)}</option>`).join('')}
          </select>
        </div>
        <div class="floor-studio-modal__field">
          <label for="fm-table-seats">تعداد صندلی (ظرفیت پذیرایی):</label>
          <input id="fm-table-seats" type="number" min="1" max="20" value="4" required />
        </div>
        <div class="floor-studio-modal__field">
          <label>فرم هندسی میز:</label>
          <div class="floor-studio-modal__shape-grid" id="fm-table-shapes">
            <button type="button" class="floor-studio-modal__shape-btn is-active" data-shape="rectangle"><span>⬛</span><span>مستطیل</span></button>
            <button type="button" class="floor-studio-modal__shape-btn" data-shape="circle"><span>⭕</span><span>گرد</span></button>
            <button type="button" class="floor-studio-modal__shape-btn" data-shape="square"><span>⏹️</span><span>مربع</span></button>
            <button type="button" class="floor-studio-modal__shape-btn" data-shape="booth"><span>🛋️</span><span>نیمکت VIP</span></button>
            <button type="button" class="floor-studio-modal__shape-btn" data-shape="bar_stool"><span>🍸</span><span>صندلی بار</span></button>
            <button type="button" class="floor-studio-modal__shape-btn" data-shape="oval"><span>🥚</span><span>بیضی</span></button>
            <button type="button" class="floor-studio-modal__shape-btn" data-shape="lounge_takht"><span>🛏️</span><span>تخت سنتی</span></button>
          </div>
        </div>`,
      onConfirm: async (form) => {
        const chosenLabel = form.querySelector('#fm-table-label')?.value?.trim() || defaultLabel;
        const chosenFloor = form.querySelector('#fm-table-floor')?.value || activeFloorId;
        const chosenZone = form.querySelector('#fm-table-zone')?.value?.trim() || targetZone;
        const chosenSeats = Math.max(1, Math.min(20, Number(form.querySelector('#fm-table-seats')?.value) || 4));
        const activeShapeBtn = form.querySelector('#fm-table-shapes .is-active');
        const chosenShape = activeShapeBtn?.dataset?.shape || 'rectangle';

        let initX = 30; let initY = 35;
        if (chosenZone === 'تراس') { initX = 70; initY = 35; }
        else if (chosenZone === 'ویژه') { initX = 70; initY = 80; }
        else if (chosenZone !== 'سالن') { initX = 50; initY = 50; }
        initX = Math.min(88, initX + ((tables.length % 4) * 4));
        initY = Math.min(88, initY + ((tables.length % 3) * 4));

        pushHistory();
        try {
          const res = await api('/api/admin/tables', {
            method: 'POST',
            body: JSON.stringify({ label: chosenLabel, seats: chosenSeats, zone: chosenZone, floorId: chosenFloor, branchId: currentBranchId(), x: initX, y: initY, shape: chosenShape, rotation: 0 }),
          });
          const created = res.table || { id: nextId, label: chosenLabel, seats: chosenSeats, zone: chosenZone, floorId: chosenFloor, branchId: currentBranchId(), x: initX, y: initY, shape: chosenShape, rotation: 0, active: true };
          ensureTableGeometry(created, tables.length);
          created.floorId = chosenFloor; created.state = 'available'; created.stateLabel = 'آزاد';
          tables.push(created);
          selectedTableId = created.id;
          activeFloorId = chosenFloor;
          await saveFloorLayout(true);
          render();
          showToast(`میز جدید (${created.label}) به نقشه اضافه شد.`, 'success');
          return true;
        } catch (err) {
          showToast(err.message || 'خطا در ساخت میز جدید', 'error');
          return false;
        }
      }
    });

    setTimeout(() => {
      document.getElementById('fm-table-shapes')?.querySelectorAll('.floor-studio-modal__shape-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          document.getElementById('fm-table-shapes').querySelectorAll('.floor-studio-modal__shape-btn').forEach((b) => b.classList.remove('is-active'));
          btn.classList.add('is-active');
        });
      });
    }, 60);
  };

  const deleteTableFromMap = async (tableId) => {
    const table = tableById(tableId);
    if (!table) return;
    showFloorModal({
      title: '🗑️ تایید حذف میز از سالن',
      confirmText: 'بله، حذف شود',
      confirmClass: 'btn-danger',
      bodyHtml: `
        <p style="font-size:14px;color:#f8fafc;margin:0 0 8px">آیا از حذف «<strong>${esc(tableTitle(table))}</strong>» از نقشه سالن و لیست میزها اطمینان دارید؟</p>
        <p style="font-size:12px;color:#f43f5e;margin:0">این عملیات غیرقابل بازگشت است و رمزینه مربوطه نیز از دسترس خارج می‌شود.</p>`,
      onConfirm: async () => {
        try {
          await api(`/api/admin/tables/${tableId}${branchQs()}`, { method: 'DELETE' });
          tables = tables.filter((t) => Number(t.id) !== Number(tableId));
          if (Number(selectedTableId) === Number(tableId)) selectedTableId = null;
          render();
          showToast('میز از نقشه حذف گردید.', 'success');
          return true;
        } catch (err) {
          showToast(err.message || 'خطا در حذف میز', 'error');
          return false;
        }
      }
    });
  };

  const batchDeleteSelectedTables = () => {
    if (selectedTableIds.size === 0) return;
    showFloorModal({
      title: `🗑️ حذف گروهی ${fmtNum(selectedTableIds.size)} میز انتخاب‌شده`,
      confirmText: 'حذف تمامی میزهای انتخاب‌شده',
      confirmClass: 'btn-danger',
      bodyHtml: `<p style="font-size:13px;color:#f8fafc">آیا از حذف دائم ${fmtNum(selectedTableIds.size)} میز انتخاب‌شده از پلان سالن اطمینان دارید؟</p>`,
      onConfirm: async () => {
        const idsToDelete = Array.from(selectedTableIds);
        selectedTableIds.clear();
        tables = tables.filter((t) => !idsToDelete.includes(Number(t.id)));
        selectedTableId = null;
        await saveFloorLayout(true);
        render();
        showToast(`${fmtNum(idsToDelete.length)} میز با موفقیت حذف شدند.`, 'success');
      }
    });
  };

  const promptRenameTable = (table) => {
    showFloorModal({
      title: `✏️ تغییر نام و برچسب ${tableTitle(table)}`,
      confirmText: 'ذخیره نام',
      confirmClass: 'btn-primary',
      bodyHtml: `<div class="floor-studio-modal__field"><label for="fm-rename-input">نام یا شماره میز:</label><input id="fm-rename-input" type="text" value="${esc(table.label || `میز ${table.id}`)}" required /></div>`,
      onConfirm: (form) => {
        const newName = form.querySelector('#fm-rename-input')?.value?.trim();
        if (!newName) return false;
        table.label = newName;
        debouncedSaveFloor(); render();
        showToast(`نام میز به «${table.label}» تغییر یافت.`, 'success');
        return true;
      }
    });
  };

  const mergeTablesGroup = (tableIds) => {
    const ids = Array.from(tableIds).map(Number).filter(Boolean);
    if (ids.length < 2) { showToast('برای ادغام، حداقل ۲ میز را انتخاب کنید.', 'warning'); return; }
    const groupTables = tables.filter((t) => ids.includes(Number(t.id)));
    if (groupTables.length < 2) return;
    pushHistory();
    const master = groupTables[0];
    const subTables = groupTables.slice(1);
    master.mergedWith = subTables.map((t) => t.id);
    master.mergedInto = null;
    subTables.forEach((st) => { st.mergedInto = master.id; st.mergedWith = null; });
    debouncedSaveFloor(); render();
    showToast(`میزهای [${groupTables.map((t) => tableTitle(t)).join(' + ')}] با موفقیت ادغام شدند.`, 'success');
  };

  const unmergeTable = (table) => {
    pushHistory();
    if (table.mergedWith && Array.isArray(table.mergedWith)) {
      const subIds = table.mergedWith.map(Number);
      tables.forEach((t) => { if (subIds.includes(Number(t.id))) { t.mergedInto = null; t.mergedWith = null; } });
      table.mergedWith = null;
    }
    if (table.mergedInto) {
      const master = tableById(table.mergedInto);
      if (master && Array.isArray(master.mergedWith)) {
        master.mergedWith = master.mergedWith.filter((id) => Number(id) !== Number(table.id));
        if (master.mergedWith.length === 0) master.mergedWith = null;
      }
      table.mergedInto = null;
    }
    debouncedSaveFloor(); render();
    showToast(`پیوند ${tableTitle(table)} تفکیک شد.`, 'info');
  };

  const alignSelectedTables = (alignment) => {
    const ids = Array.from(selectedTableIds).map(Number).filter(Boolean);
    if (ids.length < 2) return;
    const list = tables.filter((t) => ids.includes(Number(t.id)));
    if (list.length < 2) return;
    pushHistory();
    if (alignment === 'left') { const minX = Math.min(...list.map((t) => t.x)); list.forEach((t) => { t.x = minX; }); }
    else if (alignment === 'right') { const maxX = Math.max(...list.map((t) => t.x)); list.forEach((t) => { t.x = maxX; }); }
    else if (alignment === 'top') { const minY = Math.min(...list.map((t) => t.y)); list.forEach((t) => { t.y = minY; }); }
    else if (alignment === 'bottom') { const maxY = Math.max(...list.map((t) => t.y)); list.forEach((t) => { t.y = maxY; }); }
    else if (alignment === 'center-x') { const avgX = Math.round(list.reduce((sum, t) => sum + t.x, 0) / list.length); list.forEach((t) => { t.x = avgX; }); }
    else if (alignment === 'center-y') { const avgY = Math.round(list.reduce((sum, t) => sum + t.y, 0) / list.length); list.forEach((t) => { t.y = avgY; }); }
    debouncedSaveFloor(); render();
    showToast('هم‌ترازی میزها با موفقیت انجام شد.', 'success');
  };

  const distributeSelectedTables = (axis) => {
    const ids = Array.from(selectedTableIds).map(Number).filter(Boolean);
    if (ids.length < 3) { showToast('برای توزیع مساوی، حداقل ۳ میز لازم است.', 'warning'); return; }
    const list = tables.filter((t) => ids.includes(Number(t.id)));
    if (list.length < 3) return;
    pushHistory();
    if (axis === 'h') {
      list.sort((a, b) => a.x - b.x);
      const step = (list[list.length - 1].x - list[0].x) / (list.length - 1);
      list.forEach((t, i) => { t.x = Math.round((list[0].x + (i * step)) * 10) / 10; });
    } else {
      list.sort((a, b) => a.y - b.y);
      const step = (list[list.length - 1].y - list[0].y) / (list.length - 1);
      list.forEach((t, i) => { t.y = Math.round((list[0].y + (i * step)) * 10) / 10; });
    }
    debouncedSaveFloor(); render();
    showToast('فاصله میزها به طور یکنواخت توزیع شد.', 'success');
  };

  const autoAlignTables = async () => {
    showFloorModal({
      title: '↺ مرتب‌سازی خودکار و مهندسی چیدمان',
      confirmText: 'اجرای مرتب‌سازی',
      confirmClass: 'btn-primary',
      bodyHtml: `
        <p style="font-size:14px;color:#f8fafc;margin:0 0 8px">آیا مایل به مرتب‌سازی خودکار و معماری میزها در بخش‌های سالن هستید؟</p>
        <p style="font-size:12px;color:#94a3b8;margin:0">میزهای سالن، تراس و سالن ویژه با فاصله‌گذاری استاندارد ۲ ستونه و فرم مهندسی بازچینی خواهند شد.</p>`,
      onConfirm: async () => {
        const byZone = {};
        tables.forEach((t) => { const z = normalizeZone(t.zone) || 'سالن'; if (!byZone[z]) byZone[z] = []; byZone[z].push(t); });

        const layoutZone = (list, xCols, baseX, baseY, yRange) => {
          const cols = xCols.length;
          const totalRows = Math.ceil(list.length / cols);
          const yStep = yRange / Math.max(1, totalRows);
          list.forEach((t, i) => {
            t.x = xCols[i % cols];
            t.y = Math.round(baseY + (Math.floor(i / cols) * yStep) + (yStep / 2));
            t.rotation = 0;
          });
        };

        if (byZone['سالن']) layoutZone(byZone['سالن'], [18, 36], 18, 20, 64);
        if (byZone['تراس']) layoutZone(byZone['تراس'], [62, 82], 62, 18, 32);
        if (byZone['ویژه']) { layoutZone(byZone['ویژه'], [62, 82], 62, 72, 24); byZone['ویژه'].forEach((t) => { t.shape = 'booth'; }); }
        Object.keys(byZone).forEach((z) => {
          if (['سالن', 'تراس', 'ویژه'].includes(z)) return;
          byZone[z].forEach((t, i) => { t.x = 48 + ((i % 3) * 16); t.y = 45 + (Math.floor(i / 3) * 18); });
        });

        await saveFloorLayout(false);
        render();
        showToast('چیدمان میزها با موفقیت مرتب گردید.', 'success');
        return true;
      }
    });
  };

  const deleteFixture = (fixtureId) => {
    pushHistory();
    floorFixtures = floorFixtures.filter((f) => f.id !== fixtureId);
    if (selectedFixtureId === fixtureId) selectedFixtureId = null;
    debouncedSaveFloor(); render();
    showToast('سازه از نقشه حذف گردید.', 'info');
  };

  const deleteZone = (zoneIdOrName) => {
    const zone = floorZones.find((z) => z.id === zoneIdOrName || z.name === zoneIdOrName || normalizeZone(z.name) === normalizeZone(zoneIdOrName));
    const zoneName = zone ? zone.name : zoneIdOrName;
    if (!zoneName) return;
    if (floorZones.length <= 1) { showToast('حداقل یک بخش باید در سالن باقی بماند.', 'warning'); return; }
    showFloorModal({
      title: `🗑️ حذف بخش «${esc(zoneName)}»`,
      confirmText: 'حذف بخش',
      confirmClass: 'btn-danger',
      bodyHtml: `
        <p style="font-size:14px;color:#f8fafc;margin:0 0 8px">آیا از حذف این بخش از نقشه سالن اطمینان دارید؟</p>
        <p style="font-size:12px;color:#94a3b8;margin:0">میزهای متعلق به این بخش حذف نمی‌شوند و به طور خودکار به بخش «سالن اصلی» منتقل خواهند شد.</p>`,
      onConfirm: () => {
        const deletedName = zoneName;
        floorZones = floorZones.filter((z) => z.id !== zone?.id && z.name !== deletedName && normalizeZone(z.name) !== normalizeZone(deletedName));
        tables.forEach((t) => { if (normalizeZone(t.zone) === normalizeZone(deletedName)) t.zone = 'سالن'; });
        if (activeZone === deletedName || normalizeZone(activeZone) === normalizeZone(deletedName)) activeZone = 'all';
        if (selectedZoneId === zone?.id || selectedZoneId === zoneIdOrName) selectedZoneId = null;
        debouncedSaveFloor(); render();
        showToast(`بخش «${deletedName}» حذف شد.`, 'success');
        return true;
      }
    });
  };

  const cycleZoneColor = (zone) => {
    const colors = ['blue', 'emerald', 'purple', 'amber', 'rose', 'cyan', 'slate'];
    const idx = colors.indexOf(zone.color || 'blue');
    zone.color = colors[(idx + 1) % colors.length];
    debouncedSaveFloor(); render();
    showToast(`رنگ بخش «${zone.name}» تغییر یافت.`, 'info');
  };

  const splitZone = (zone) => {
    if (zone.w >= zone.h) {
      const halfW = Math.round((zone.w / 2) * 10) / 10;
      const newZone = { ...zone, id: `zone-${Date.now()}`, name: `${zone.name} (بخش ۲)`, x: zone.x + halfW, w: halfW, color: 'amber', icon: '🏷️' };
      zone.w = halfW;
      floorZones.push(newZone);
    } else {
      const halfH = Math.round((zone.h / 2) * 10) / 10;
      const newZone = { ...zone, id: `zone-${Date.now()}`, name: `${zone.name} (بخش ۲)`, y: zone.y + halfH, h: halfH, color: 'amber', icon: '🏷️' };
      zone.h = halfH;
      floorZones.push(newZone);
    }
    debouncedSaveFloor(); render();
    showToast(`بخش «${zone.name}» به دو قسمت تقسیم شد.`, 'success');
  };

  const promptRenameZone = (zone) => {
    showFloorModal({
      title: `✏️ تغییر نام بخش «${esc(zone.name)}»`,
      confirmText: 'ذخیره نام',
      confirmClass: 'btn-primary',
      bodyHtml: `<div class="floor-studio-modal__field"><label for="fm-zone-rename">نام جدید بخش:</label><input id="fm-zone-rename" type="text" value="${esc(zone.name)}" required /></div>`,
      onConfirm: (form) => {
        const newName = form.querySelector('#fm-zone-rename')?.value?.trim();
        if (!newName) return false;
        const oldName = zone.name;
        zone.name = newName;
        tables.forEach((t) => { if (normalizeZone(t.zone) === normalizeZone(oldName)) t.zone = newName; });
        debouncedSaveFloor(); render();
        showToast(`نام بخش به «${newName}» تغییر یافت.`, 'success');
        return true;
      }
    });
  };

  const promptZoneDimensions = (zone) => {
    showFloorModal({
      title: `📏 ابعاد و متراژ بخش «${esc(zone.name)}»`,
      confirmText: 'ذخیره ابعاد',
      confirmClass: 'btn-primary',
      bodyHtml: `
        <div class="floor-studio-modal__dim-row">
          <div class="floor-studio-modal__field">
            <label for="fm-zdim-len">طول بخش (متر):</label>
            <input id="fm-zdim-len" type="number" min="1" max="200" step="0.5" value="${zone.lengthM || 10}" required />
          </div>
          <div class="floor-studio-modal__field">
            <label for="fm-zdim-wid">عرض بخش (متر):</label>
            <input id="fm-zdim-wid" type="number" min="1" max="200" step="0.5" value="${zone.widthM || 3}" required />
          </div>
        </div>
        <div class="floor-studio-modal__area-badge" id="fm-zdim-area-badge">
          <span>📐 مساحت محاسبه‌شده:</span>
          <strong id="fm-zdim-area-val">${fmtNum(Math.round((zone.lengthM || 10) * (zone.widthM || 3) * 10) / 10)} متر مربع</strong>
        </div>`,
      onConfirm: (form) => {
        const lengthM = parseFloat(form.querySelector('#fm-zdim-len')?.value) || 10;
        const widthM = parseFloat(form.querySelector('#fm-zdim-wid')?.value) || 3;
        zone.lengthM = lengthM;
        zone.widthM = widthM;
        zone.areaSqM = Math.round(lengthM * widthM * 10) / 10;
        debouncedSaveFloor(); render();
        showToast(`ابعاد بخش «${zone.name}» به ${fmtNum(lengthM)}×${fmtNum(widthM)} متر (${fmtNum(zone.areaSqM)}م²) تنظیم شد.`, 'success');
        return true;
      }
    });

    setTimeout(() => {
      const lInput = document.getElementById('fm-zdim-len');
      const wInput = document.getElementById('fm-zdim-wid');
      const areaVal = document.getElementById('fm-zdim-area-val');
      const updateArea = () => {
        const l = parseFloat(lInput?.value) || 0;
        const w = parseFloat(wInput?.value) || 0;
        if (areaVal) areaVal.textContent = `${fmtNum(Math.round(l * w * 10) / 10)} متر مربع`;
      };
      lInput?.addEventListener('input', updateArea);
      wInput?.addEventListener('input', updateArea);
    }, 50);
  };

  const promptCreateZone = (x, y, w, h) => {
    showFloorModal({
      title: '🌿 نام‌گذاری بخش جدید ترسیم‌شده',
      confirmText: 'ثبت بخش جدید',
      confirmClass: 'btn-primary',
      bodyHtml: `
        <p style="font-size:13px;color:#94a3b8;margin:0 0 10px">بخشی به ابعاد ${Math.round(w)}% × ${Math.round(h)}% در موقعیت (${Math.round(x)}%, ${Math.round(y)}%) ترسیم شد.</p>
        <div class="floor-studio-modal__field">
          <label for="fm-newzone-name">نام این بخش:</label>
          <input id="fm-newzone-name" type="text" value="بخش جدید" required autofocus />
        </div>
        <div class="floor-studio-modal__field" style="margin-top:8px">
          <label>رنگ بخش:</label>
          <div class="floor-studio-modal__shape-grid" id="fm-newzone-colors">
            <button type="button" class="floor-studio-modal__shape-btn is-active" data-color="blue"><span style="color:#38bdf8">🟦</span><span>آبی</span></button>
            <button type="button" class="floor-studio-modal__shape-btn" data-color="emerald"><span style="color:#4ade80">🟩</span><span>سبز</span></button>
            <button type="button" class="floor-studio-modal__shape-btn" data-color="purple"><span style="color:#c084fc">🟪</span><span>بنفش</span></button>
            <button type="button" class="floor-studio-modal__shape-btn" data-color="amber"><span style="color:#fbbf24">🟧</span><span>کهربایی</span></button>
            <button type="button" class="floor-studio-modal__shape-btn" data-color="rose"><span style="color:#fb7185">🟥</span><span>قرمز</span></button>
          </div>
        </div>`,
      onConfirm: (form) => {
        const name = form.querySelector('#fm-newzone-name')?.value?.trim();
        if (!name) return false;
        const color = form.querySelector('#fm-newzone-colors .is-active')?.dataset.color || 'blue';
        const newZone = { id: `zone-${Date.now()}`, name, x, y, w, h, color, icon: '🏷️', shape: 'rectangle' };
        floorZones.push(newZone);
        debouncedSaveFloor(); render();
        showToast(`بخش «${name}» ایجاد شد.`, 'success');
        return true;
      }
    });
    setTimeout(() => {
      const grid = document.getElementById('fm-newzone-colors');
      grid?.querySelectorAll('.floor-studio-modal__shape-btn').forEach((b) => {
        b.addEventListener('click', () => { grid.querySelectorAll('.floor-studio-modal__shape-btn').forEach((x) => x.classList.remove('is-active')); b.classList.add('is-active'); });
      });
    }, 50);
  };

  // promptAddZone, promptAddFloor, promptEditFloor, deleteFloor, promptMoveTableFloor,
  // promptAddFixture, promptFloorSettings, promptTableFurnitureModal,
  // exportLayoutJson, importLayoutJson, showTemplateModal
  // — همه از admin.js موجود استفاده می‌شوند از طریق opts.legacyActions
  const {
    promptAddZone, promptAddFloor, promptEditFloor, deleteFloor, promptMoveTableFloor,
    promptAddFixture, promptFloorSettings, promptTableFurnitureModal,
    exportLayoutJson, importLayoutJson, showTemplateModal,
  } = buildLegacyActions();

  function buildLegacyActions() {
    // این توابع کد یکسان با admin.js قبل را دارند
    // برای اختصار در اینجا به opts.legacyActions ارجاع می‌دهیم
    // در صورت عدم وجود، نسخه ساده ارائه می‌شود
    const la = opts.legacyActions || {};
    const ctx = {
      showFloorModal, floorZones, tables, floorLevels, floorFixtures, floorSettings,
      activeFloorId: () => activeFloorId,
      getActiveFloorId: () => activeFloorId,
      setActiveFloorId: (id) => { activeFloorId = id; },
      normalizeZone, esc, fmtNum, pushHistory, debouncedSaveFloor, saveFloorLayout,
      render, showToast, activeZone: () => activeZone,
      setActiveZone: (z) => { activeZone = z; },
      getFloorZones: () => floorZones,
      setFloorZones: (z) => { floorZones = z; },
      getFloorFixtures: () => floorFixtures,
      setFloorFixtures: (f) => { floorFixtures = f; },
      getFloorLevels: () => floorLevels,
      setFloorLevels: (l) => { floorLevels = l; },
      getFloorSettings: () => floorSettings,
      setFloorSettings: (s) => { floorSettings = s; },
      getTables: () => tables,
      setTables: (t) => { tables = t; },
      ensureTableGeometry,
    };

    // PromptAddZone
    const promptAddZone = la.promptAddZone
      ? () => la.promptAddZone(ctx)
      : () => {
          showFloorModal({
            title: '🌿 تعریف بخش جدید در سالن و تعیین متراژ',
            confirmText: 'ایجاد و چیدمان بخش',
            confirmClass: 'btn-primary',
            bodyHtml: `
              <div class="floor-studio-modal__field">
                <label for="fm-zone-name">نام بخش جدید سالن:</label>
                <input id="fm-zone-name" type="text"
                  placeholder="مثال: تراس و فضای باز، روف گاردن، سالن VIP"
                  value="تراس و فضای باز" required autofocus />
                <div class="floor-studio-modal__presets">
                  <span style="font-size:11px;color:#94a3b8;margin-left:4px">پیشنهادها:</span>
                  <button type="button" class="floor-studio-modal__preset-pill"
                    data-preset-name="تراس و فضای باز" data-preset-icon="🌿"
                    data-preset-l="10" data-preset-w="3" data-preset-color="emerald" data-preset-shape="open-terrace">
                    🌿 تراس (۱۰×۳م)
                  </button>
                  <button type="button" class="floor-studio-modal__preset-pill"
                    data-preset-name="روف‌گاردن و بام" data-preset-icon="☀️"
                    data-preset-l="12" data-preset-w="8" data-preset-color="cyan" data-preset-shape="open-terrace">
                    ☀️ روف‌گاردن (۱۲×۸م)
                  </button>
                  <button type="button" class="floor-studio-modal__preset-pill"
                    data-preset-name="سالن اختصاصی VIP" data-preset-icon="👑"
                    data-preset-l="8" data-preset-w="5" data-preset-color="purple" data-preset-shape="rectangle">
                    👑 سالن VIP (۸×۵م)
                  </button>
                  <button type="button" class="floor-studio-modal__preset-pill"
                    data-preset-name="کافه بار و پیشخوان" data-preset-icon="☕"
                    data-preset-l="6" data-preset-w="2.5" data-preset-color="amber" data-preset-shape="corridor">
                    ☕ کافه بار (۶×۲.۵م)
                  </button>
                </div>
              </div>

              <div class="floor-studio-modal__dim-row">
                <div class="floor-studio-modal__field">
                  <label for="fm-zone-len">طول بخش (متر):</label>
                  <input id="fm-zone-len" type="number" min="1" max="200" step="0.5" value="10" required />
                </div>
                <div class="floor-studio-modal__field">
                  <label for="fm-zone-wid">عرض بخش (متر):</label>
                  <input id="fm-zone-wid" type="number" min="1" max="200" step="0.5" value="3" required />
                </div>
              </div>

              <div class="floor-studio-modal__area-badge" id="fm-zone-area-badge">
                <span>📐 مساحت محاسبه‌شده فضا:</span>
                <strong id="fm-zone-area-val">۳۰ متر مربع</strong>
              </div>

              <div class="floor-studio-modal__field" style="margin-top:12px">
                <label>فرم هندسی و نوع معماری بخش:</label>
                <div class="floor-studio-modal__shape-grid" id="fm-zone-shapes">
                  <button type="button" class="floor-studio-modal__shape-btn is-active" data-shape="open-terrace">
                    <span style="font-size:18px">🌿</span><span>تراس و فضای باز</span>
                  </button>
                  <button type="button" class="floor-studio-modal__shape-btn" data-shape="rectangle">
                    <span style="font-size:18px">⬛</span><span>مستطیل استاندارد</span>
                  </button>
                  <button type="button" class="floor-studio-modal__shape-btn" data-shape="l-shape">
                    <span style="font-size:18px">◱</span><span>ال‌شکل (L-Shape)</span>
                  </button>
                  <button type="button" class="floor-studio-modal__shape-btn" data-shape="corridor">
                    <span style="font-size:18px">▭</span><span>طولی و راهرویی</span>
                  </button>
                </div>
              </div>

              <div class="floor-studio-modal__field" style="margin-top:12px">
                <label>پوسته رنگی بخش:</label>
                <div class="floor-studio-modal__shape-grid" id="fm-zone-colors">
                  <button type="button" class="floor-studio-modal__shape-btn" data-color="blue"><span style="color:#38bdf8">🟦</span><span>آبی دریا</span></button>
                  <button type="button" class="floor-studio-modal__shape-btn is-active" data-color="emerald"><span style="color:#4ade80">🟩</span><span>سبز زمردی</span></button>
                  <button type="button" class="floor-studio-modal__shape-btn" data-color="purple"><span style="color:#c084fc">🟪</span><span>بنفش سلطنتی</span></button>
                  <button type="button" class="floor-studio-modal__shape-btn" data-color="amber"><span style="color:#fbbf24">🟧</span><span>کهربایی گرم</span></button>
                  <button type="button" class="floor-studio-modal__shape-btn" data-color="rose"><span style="color:#fb7185">🟥</span><span>سرخ رز</span></button>
                  <button type="button" class="floor-studio-modal__shape-btn" data-color="cyan"><span style="color:#22d3ee">🩵</span><span>فیروزه‌ای</span></button>
                </div>
              </div>`,
            onConfirm: (form) => {
              const name = form.querySelector('#fm-zone-name')?.value?.trim();
              if (!name) return false;
              const lengthM = parseFloat(form.querySelector('#fm-zone-len')?.value) || 10;
              const widthM  = parseFloat(form.querySelector('#fm-zone-wid')?.value) || 3;
              const areaSqM = Math.round(lengthM * widthM * 10) / 10;
              const shape = form.querySelector('#fm-zone-shapes .is-active')?.dataset.shape || 'open-terrace';
              const color = form.querySelector('#fm-zone-colors .is-active')?.dataset.color || 'emerald';
              const icon  = shape === 'open-terrace' ? '🌿' : shape === 'corridor' ? '▭' : name.includes('ویژه') ? '👑' : '🏷️';

              // یافتن موقعیت آزاد روی canvas
              const calcW = Math.max(14, Math.min(85, Math.round((lengthM / 20) * 80)));
              const calcH = Math.max(10, Math.min(85, Math.round((widthM / 15) * 60)));
              let freeSlot = null;

              for (let y = 3; y <= 97 - calcH && !freeSlot; y += 3) {
                for (let x = 2; x <= 98 - calcW && !freeSlot; x += 3) {
                  const collides = floorZones.some((z) =>
                    Math.max(x, z.x) < Math.min(x + calcW, z.x + z.w) - 0.5 &&
                    Math.max(y, z.y) < Math.min(y + calcH, z.y + z.h) - 0.5);
                  if (!collides) freeSlot = { x, y, w: calcW, h: calcH };
                }
              }

              if (!freeSlot) {
                const largest = [...floorZones].sort((a, b) => (b.w * b.h) - (a.w * a.h))[0];
                if (largest && largest.w >= 24) {
                  const halfW = Math.round((largest.w / 2) * 10) / 10;
                  largest.w = halfW;
                  freeSlot = { x: Math.round((largest.x + halfW) * 10) / 10, y: largest.y, w: halfW, h: largest.h };
                } else if (largest && largest.h >= 24) {
                  const halfH = Math.round((largest.h / 2) * 10) / 10;
                  largest.h = halfH;
                  freeSlot = { x: largest.x, y: Math.round((largest.y + halfH) * 10) / 10, w: largest.w, h: halfH };
                } else {
                  freeSlot = { x: 50, y: 50, w: calcW, h: calcH };
                }
              }

              const newZone = {
                id: `zone-${Date.now()}`, name,
                x: freeSlot.x, y: freeSlot.y, w: freeSlot.w, h: freeSlot.h,
                color, icon, lengthM, widthM, areaSqM, shape,
              };
              floorZones.push(newZone);
              activeZone = name;
              debouncedSaveFloor();
              render();
              showToast(`بخش «${name}» با ابعاد ${fmtNum(lengthM)}×${fmtNum(widthM)} متر (${fmtNum(areaSqM)}م²) ایجاد شد.`, 'success');
              return true;
            },
          });

          setTimeout(() => {
            const lInput  = document.getElementById('fm-zone-len');
            const wInput  = document.getElementById('fm-zone-wid');
            const areaVal = document.getElementById('fm-zone-area-val');
            const updateArea = () => {
              const l = parseFloat(lInput?.value) || 0;
              const w = parseFloat(wInput?.value) || 0;
              if (areaVal) areaVal.textContent = `${fmtNum(Math.round(l * w * 10) / 10)} متر مربع`;
            };
            lInput?.addEventListener('input', updateArea);
            wInput?.addEventListener('input', updateArea);

            document.querySelectorAll('.floor-studio-modal__preset-pill').forEach((pill) => {
              pill.addEventListener('click', () => {
                const nameEl = document.getElementById('fm-zone-name');
                if (nameEl && pill.dataset.presetName) nameEl.value = pill.dataset.presetName;
                if (lInput && pill.dataset.presetL) lInput.value = pill.dataset.presetL;
                if (wInput && pill.dataset.presetW) wInput.value = pill.dataset.presetW;
                updateArea();
                if (pill.dataset.presetShape) {
                  const sg = document.getElementById('fm-zone-shapes');
                  sg?.querySelectorAll('.floor-studio-modal__shape-btn').forEach((b) =>
                    b.classList.toggle('is-active', b.dataset.shape === pill.dataset.presetShape));
                }
                if (pill.dataset.presetColor) {
                  const cg = document.getElementById('fm-zone-colors');
                  cg?.querySelectorAll('.floor-studio-modal__shape-btn').forEach((b) =>
                    b.classList.toggle('is-active', b.dataset.color === pill.dataset.presetColor));
                }
              });
            });

            // radio selection grids
            ['fm-zone-shapes', 'fm-zone-colors'].forEach((gridId) => {
              const grid = document.getElementById(gridId);
              grid?.querySelectorAll('.floor-studio-modal__shape-btn').forEach((b) => {
                b.addEventListener('click', () => {
                  grid.querySelectorAll('.floor-studio-modal__shape-btn').forEach((x) => x.classList.remove('is-active'));
                  b.classList.add('is-active');
                });
              });
            });
          }, 50);
        };

    const promptAddFloor = la.promptAddFloor
      ? () => la.promptAddFloor(ctx)
      : () => {
          const nextLevel = floorLevels.length;
          showFloorModal({
            title: '🏢 تعریف طبقه یا فضای جدید رستوران',
            confirmText: 'ایجاد طبقه',
            confirmClass: 'btn-primary',
            bodyHtml: `
              <div class="floor-studio-modal__field">
                <label for="fm-floor-name">نام طبقه یا فضا:</label>
                <input id="fm-floor-name" type="text" placeholder="مثال: طبقه اول، روف‌گاردن، حیاط اختصاصی" required autofocus />
              </div>
              <div class="floor-studio-modal__dim-row">
                <div class="floor-studio-modal__field">
                  <label for="fm-floor-level">شماره تراز / طبقه:</label>
                  <input id="fm-floor-level" type="number" min="-2" max="20" value="${nextLevel}" required />
                </div>
                <div class="floor-studio-modal__field">
                  <label for="fm-floor-icon">آیکون فضا:</label>
                  <select id="fm-floor-icon">
                    <option value="🏛️">🏛️ سالن و عمارت</option>
                    <option value="☀️">☀️ روف‌گاردن و بام</option>
                    <option value="🌿">🌿 فضای باز و باغ</option>
                    <option value="👑">👑 سالن VIP</option>
                    <option value="☕">☕ کافه تریا</option>
                    <option value="🪜">🪜 نیم‌طبقه و بالکن</option>
                  </select>
                </div>
              </div>`,
            onConfirm: async (form) => {
              const name = form.querySelector('#fm-floor-name')?.value?.trim();
              if (!name) return false;
              const level = parseInt(form.querySelector('#fm-floor-level')?.value, 10) || nextLevel;
              const icon = form.querySelector('#fm-floor-icon')?.value || '🏛️';
              const id = `floor-${Date.now()}`;
              pushHistory();
              floorLevels.push({ id, name, level, icon, isDefault: false });
              activeFloorId = id;
              await saveFloorLayout(true);
              render();
              showToast(`طبقه «${name}» ایجاد و نقشه آن فعال شد.`, 'success');
              return true;
            }
          });
        };

    const promptEditFloor = la.promptEditFloor
      ? (floor) => la.promptEditFloor(floor, ctx)
      : (floor) => {
          showFloorModal({
            title: `⚙️ ویرایش مشخصات طبقه «${esc(floor.name)}»`,
            confirmText: 'ذخیره مشخصات',
            confirmClass: 'btn-primary',
            bodyHtml: `
              <div class="floor-studio-modal__field">
                <label for="fm-floor-edit-name">نام طبقه:</label>
                <input id="fm-floor-edit-name" type="text" value="${esc(floor.name)}" required />
              </div>
              <div class="floor-studio-modal__dim-row">
                <div class="floor-studio-modal__field">
                  <label for="fm-floor-edit-level">شماره تراز / طبقه:</label>
                  <input id="fm-floor-edit-level" type="number" min="-2" max="20" value="${floor.level || 0}" required />
                </div>
                <div class="floor-studio-modal__field">
                  <label for="fm-floor-edit-icon">آیکون فضا:</label>
                  <input id="fm-floor-edit-icon" type="text" value="${esc(floor.icon || '🏛️')}" />
                </div>
              </div>
              ${floorLevels.length > 1 ? `<div style="margin-top:16px;padding-top:12px;border-top:1px solid rgba(255,255,255,0.1);display:flex;justify-content:flex-end"><button type="button" class="btn btn-sm btn-danger" id="fm-floor-delete-btn">🗑️ حذف کامل این طبقه</button></div>` : ''}`,
            onConfirm: async (form) => {
              const name = form.querySelector('#fm-floor-edit-name')?.value?.trim();
              if (!name) return false;
              floor.name = name;
              floor.level = parseInt(form.querySelector('#fm-floor-edit-level')?.value, 10) || 0;
              floor.icon = form.querySelector('#fm-floor-edit-icon')?.value?.trim() || '🏛️';
              pushHistory();
              await saveFloorLayout(true);
              render();
              showToast('مشخصات طبقه ذخیره گردید.', 'success');
              return true;
            }
          });
          setTimeout(() => {
            document.getElementById('fm-floor-delete-btn')?.addEventListener('click', () => { deleteFloor(floor.id); });
          }, 60);
        };

    const deleteFloor = la.deleteFloor
      ? (floorId) => la.deleteFloor(floorId, ctx)
      : (floorId) => {
          if (floorLevels.length <= 1) { showToast('حداقل یک طبقه باید در رستوران فعال باشد.', 'warning'); return; }
          const floor = floorLevels.find((fl) => fl.id === floorId);
          if (!floor) return;
          showFloorModal({
            title: `🗑️ حذف طبقه «${esc(floor.name)}»`,
            confirmText: 'بله، حذف شود',
            confirmClass: 'btn-danger',
            bodyHtml: `<p style="font-size:14px;color:#f8fafc;margin:0 0 8px">آیا از حذف این طبقه اطمینان دارید؟</p><p style="font-size:12px;color:#94a3b8;margin:0">میزها و سازه‌های متعلق به این طبقه به طور خودکار به طبقه همکف منتقل خواهند شد.</p>`,
            onConfirm: async () => {
              pushHistory();
              const fallbackFloorId = floorLevels.find((fl) => fl.id !== floorId)?.id || 'floor-ground';
              tables.forEach((t) => { if (t.floorId === floorId) t.floorId = fallbackFloorId; });
              floorFixtures.forEach((f) => { if (f.floorId === floorId) f.floorId = fallbackFloorId; });
              floorZones.forEach((z) => { if (z.floorId === floorId) z.floorId = fallbackFloorId; });
              floorLevels = floorLevels.filter((fl) => fl.id !== floorId);
              if (activeFloorId === floorId) activeFloorId = fallbackFloorId;
              await saveFloorLayout(true);
              render();
              showToast(`طبقه «${floor.name}» حذف گردید.`, 'success');
              return true;
            }
          });
        };

    const promptMoveTableFloor = la.promptMoveTableFloor
      ? (table) => la.promptMoveTableFloor(table, ctx)
      : (table) => {
          showFloorModal({
            title: `🏢 انتقال ${tableTitle(table)} به طبقه دیگر`,
            confirmText: 'انتقال میز',
            confirmClass: 'btn-primary',
            bodyHtml: `<div class="floor-studio-modal__field"><label for="fm-target-floor">طبقه مقصد را انتخاب کنید:</label><select id="fm-target-floor">${floorLevels.map((fl) => `<option value="${esc(fl.id)}" ${(table.floorId || 'floor-ground') === fl.id ? 'selected' : ''}>${esc(fl.icon || '🏛️')} ${esc(fl.name)}</option>`).join('')}</select></div>`,
            onConfirm: async (form) => {
              const targetFloorId = form.querySelector('#fm-target-floor')?.value;
              if (!targetFloorId || targetFloorId === (table.floorId || 'floor-ground')) return true;
              pushHistory(); table.floorId = targetFloorId; activeFloorId = targetFloorId;
              await saveFloorLayout(true); render();
              showToast(`${tableTitle(table)} به طبقه انتخابی منتقل شد.`, 'success');
              return true;
            }
          });
        };

    const promptAddFixture = la.promptAddFixture
      ? () => la.promptAddFixture(ctx)
      : () => {
          const fixturePresets = [
            { type: 'entrance',  name: 'ورودی اصلی',               icon: '🚪', color: 'emerald', w: 7,  h: 10 },
            { type: 'exit',      name: 'درب خروج اضطراری',          icon: '🚪', color: 'rose',    w: 6,  h: 8  },
            { type: 'bar',       name: 'کافه بار و پیشخوان',        icon: '☕', color: 'amber',   w: 18, h: 8  },
            { type: 'kitchen',   name: 'تحویل غذا و مطبخ',          icon: '🍳', color: 'rose',    w: 16, h: 8  },
            { type: 'cashier',   name: 'صندوق و حسابداری',          icon: '💳', color: 'cyan',    w: 12, h: 8  },
            { type: 'restroom',  name: 'سرویس بهداشتی',             icon: '🚻', color: 'purple',  w: 10, h: 10 },
            { type: 'wall',      name: 'دیوار جداکننده',            icon: '🧱', color: 'slate',   w: 20, h: 3  },
            { type: 'door',      name: 'درب تردد داخلی',            icon: '🚪', color: 'slate',   w: 6,  h: 4  },
            { type: 'stairs',    name: 'راه‌پله طبقات',             icon: '🪜', color: 'slate',   w: 12, h: 10 },
            { type: 'elevator',  name: 'آسانسور سالن',              icon: '🛗', color: 'blue',    w: 8,  h: 8  },
            { type: 'pillar',    name: 'ستون معماری',               icon: '🏛️', color: 'slate',   w: 5,  h: 5  },
            { type: 'stage',     name: 'استیج موسیقی و سن',         icon: '🎭', color: 'purple',  w: 24, h: 12 },
            { type: 'plant',     name: 'گلدان و فضای سبز',          icon: '🪴', color: 'emerald', w: 6,  h: 6  },
            { type: 'buffet',    name: 'بوفه سلف سرویس',            icon: '🥗', color: 'amber',   w: 22, h: 8  },
          ];

          showFloorModal({
            title: '🏛️ افزودن سازه یا المان معماری به نقشه سالن',
            confirmText: 'افزودن سازه',
            confirmClass: 'btn-primary',
            modalClass: 'floor-studio-modal--wide',
            bodyHtml: `
              <div class="floor-studio-modal__field">
                <label>نوع سازه و المان معماری را انتخاب کنید:</label>
                <div class="floor-studio-modal__shape-grid" id="fm-fixture-types"
                  style="grid-template-columns:repeat(auto-fill,minmax(110px,1fr));max-height:220px;overflow-y:auto">
                  ${fixturePresets.map((p, idx) => `
                    <button type="button" class="floor-studio-modal__shape-btn ${idx === 0 ? 'is-active' : ''}"
                      data-type="${esc(p.type)}" data-name="${esc(p.name)}"
                      data-icon="${p.icon}" data-color="${esc(p.color)}"
                      data-w="${p.w}" data-h="${p.h}">
                      <span style="font-size:20px">${p.icon}</span>
                      <span style="font-size:11px">${esc(p.name)}</span>
                    </button>
                  `).join('')}
                </div>
              </div>
              <div class="floor-studio-modal__field" style="margin-top:10px">
                <label for="fm-fixture-name">عنوان روی نقشه:</label>
                <input id="fm-fixture-name" type="text" value="${esc(fixturePresets[0].name)}" required />
              </div>
              <div class="floor-studio-modal__dim-row">
                <div class="floor-studio-modal__field">
                  <label for="fm-fixture-w">عرض تقریبی (درصد پلان):</label>
                  <input id="fm-fixture-w" type="number" min="2" max="80" value="${fixturePresets[0].w}" required />
                </div>
                <div class="floor-studio-modal__field">
                  <label for="fm-fixture-h">ارتفاع تقریبی (درصد پلان):</label>
                  <input id="fm-fixture-h" type="number" min="2" max="80" value="${fixturePresets[0].h}" required />
                </div>
              </div>`,
            onConfirm: async (form) => {
              const activeBtn = form.querySelector('#fm-fixture-types .is-active');
              const type  = activeBtn?.dataset?.type  || 'wall';
              const icon  = activeBtn?.dataset?.icon  || '🏛️';
              const color = activeBtn?.dataset?.color || 'slate';
              const name  = form.querySelector('#fm-fixture-name')?.value?.trim() || 'سازه';
              const w = Math.max(3, Math.min(80, parseFloat(form.querySelector('#fm-fixture-w')?.value) || 10));
              const h = Math.max(3, Math.min(80, parseFloat(form.querySelector('#fm-fixture-h')?.value) || 10));

              pushHistory();
              const newFixture = {
                id: `fix-${Date.now()}`,
                type, name, icon, color, w, h,
                x: 45, y: 45, rotation: 0,
                floorId: activeFloorId,
              };
              floorFixtures.push(newFixture);
              selectedFixtureId = newFixture.id;
              await saveFloorLayout(true);
              render();
              showToast(`سازه «${name}» به نقشه افزوده شد.`, 'success');
              return true;
            },
          });

          setTimeout(() => {
            const grid = document.getElementById('fm-fixture-types');
            grid?.querySelectorAll('.floor-studio-modal__shape-btn').forEach((btn) => {
              btn.addEventListener('click', () => {
                grid.querySelectorAll('.floor-studio-modal__shape-btn').forEach((b) => b.classList.remove('is-active'));
                btn.classList.add('is-active');
                const nameInput = document.getElementById('fm-fixture-name');
                const wInput    = document.getElementById('fm-fixture-w');
                const hInput    = document.getElementById('fm-fixture-h');
                if (nameInput && btn.dataset.name) nameInput.value = btn.dataset.name;
                if (wInput && btn.dataset.w) wInput.value = btn.dataset.w;
                if (hInput && btn.dataset.h) hInput.value = btn.dataset.h;
              });
            });
          }, 60);
        };

    const promptFloorSettings = la.promptFloorSettings
      ? () => la.promptFloorSettings(ctx)
      : () => {
          showFloorModal({
            title: '⚙️ تنظیمات معماری و مقیاس نقشه سالن',
            confirmText: 'ذخیره تنظیمات',
            confirmClass: 'btn-primary',
            bodyHtml: `
              <div class="floor-studio-modal__dim-row">
                <div class="floor-studio-modal__field"><label for="fm-sett-len">طول کلی سالن (متر):</label><input id="fm-sett-len" type="number" min="5" max="200" step="0.5" value="${floorSettings.lengthM || 20}" required /></div>
                <div class="floor-studio-modal__field"><label for="fm-sett-wid">عرض کلی سالن (متر):</label><input id="fm-sett-wid" type="number" min="5" max="200" step="0.5" value="${floorSettings.widthM || 15}" required /></div>
              </div>
              <div class="floor-studio-modal__field" style="margin-top:10px">
                <label for="fm-sett-theme">تم گرافیکی و رنگ پس‌زمینه نقشه:</label>
                <select id="fm-sett-theme">
                  <option value="slate-blueprint" ${floorSettings.bgTheme === 'slate-blueprint' ? 'selected' : ''}>نقشه مهندسی تیره (Blueprint Dark)</option>
                  <option value="midnight-dark" ${floorSettings.bgTheme === 'midnight-dark' ? 'selected' : ''}>مشکی شبانه لوکس (Midnight Black)</option>
                  <option value="warm-luxury" ${floorSettings.bgTheme === 'warm-luxury' ? 'selected' : ''}>چوب گرم و کلاسیک (Warm Luxury)</option>
                  <option value="paper-white" ${floorSettings.bgTheme === 'paper-white' ? 'selected' : ''}>کاغذ سفید CAD (Clean White)</option>
                </select>
              </div>
              <div class="floor-studio-modal__field" style="margin-top:12px">
                <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
                  <input type="checkbox" id="fm-sett-rulers" ${floorSettings.showRulers !== false ? 'checked' : ''} />
                  <span>نمایش خط‌کش متراژ مهندسی (CAD Rulers) دور نقشه</span>
                </label>
              </div>
              <div class="floor-studio-modal__field" style="margin-top:6px">
                <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
                  <input type="checkbox" id="fm-sett-grid" ${floorSettings.showGrid !== false ? 'checked' : ''} />
                  <span>نمایش خطوط شطرنجی و شبکه هدایتگر (Grid Lines)</span>
                </label>
              </div>`,
            onConfirm: async (form) => {
              floorSettings = {
                ...floorSettings,
                lengthM: parseFloat(form.querySelector('#fm-sett-len')?.value) || 20,
                widthM: parseFloat(form.querySelector('#fm-sett-wid')?.value) || 15,
                bgTheme: form.querySelector('#fm-sett-theme')?.value || 'slate-blueprint',
                showRulers: form.querySelector('#fm-sett-rulers')?.checked,
                showGrid: form.querySelector('#fm-sett-grid')?.checked,
              };
              await saveFloorLayout(true); render();
              showToast('تنظیمات مقیاس و ظاهر نقشه سالن به‌روز شد.', 'success');
              return true;
            }
          });
        };

    const promptTableFurnitureModal = la.promptTableFurnitureModal
      ? (table) => la.promptTableFurnitureModal(table, ctx)
      : (table) => {
          // ── استودیوی کامل مبلمان (بدون نیاز به admin.js) ──────────────
          let curShape = table.shape || 'rectangle';
          let curChair = table.chairModel || (
            curShape === 'bar_stool' || curShape === 'wall_counter' ? 'bar_stool'
              : curShape === 'lounge_takht' ? 'bolster'
                : 'standard'
          );
          let curSeats = Math.max(1, Math.min(24, Number(table.seats) || 4));

          const shapesDef = [
            { id: 'rectangle',    name: 'مستطیل استاندارد',         icon: '⬛', desc: 'کلاسیک رستورانی، ۲ تا ۱۲ نفر' },
            { id: 'conference',   name: 'میز کنفرانس و تشریفات',   icon: '🏛️', desc: 'یک‌تکه بزرگ، ۶ تا ۲۴ نفر با صندلی صدر' },
            { id: 'semi_circle',  name: 'نیم‌دایره و هلال',         icon: '🌙', desc: 'مبل هلالی با نشیمن شعاعی دورچین' },
            { id: 'wall_counter', name: 'کانتر کنار دیواری',        icon: '🪟', desc: 'میز یک‌طرفه متصل به دیوار یا پنجره' },
            { id: 'round_booth',  name: 'مبل گرد نعل‌اسبی',         icon: '🛋️', desc: 'نیمکت منحنی سرتاسری با میز گرد' },
            { id: 'circle',       name: 'میز گرد',                  icon: '⭕', desc: 'صمیمی و ارگونومیک، ۲ تا ۱۰ نفر' },
            { id: 'square',       name: 'میز مربع',                  icon: '⏹️', desc: 'کافه و دونفره، ۲ تا ۸ نفر' },
            { id: 'booth',        name: 'نیمکت و مبل VIP',           icon: '🛋️', desc: 'پشتی لمسه‌کوبی روبه‌روی هم' },
            { id: 'bar_stool',    name: 'صندلی بار و کانتر',        icon: '🍸', desc: 'پایه بلند و کم‌جا' },
            { id: 'oval',         name: 'بیضی تشریفاتی',            icon: '🥚', desc: 'مهمانی و سالن اصلی' },
            { id: 'lounge_takht', name: 'تخت سنتی ایرانی',          icon: '🛏️', desc: 'تخت چوبی با فرش و پشتی' },
          ];

          const chairsDef = [
            { id: 'standard',    name: 'صندلی استاندارد رستورانی',        icon: '🪑' },
            { id: 'armchair',    name: 'مبل تک‌نفره دسته‌دار لوکس',       icon: '🛋️' },
            { id: 'bar_stool',   name: 'صندلی پایه بلند بار و کانتر',    icon: '🍸' },
            { id: 'booth_bench', name: 'نیمکت چرمی پیوسته',               icon: '🧽' },
            { id: 'bolster',     name: 'پشتی و متکای سنتی',               icon: '🪡' },
          ];

          const bodyHtml = `
            <div class="furniture-grid-group">
              <span class="furniture-grid-group__title">📐 انتخاب فرم هندسی میز:</span>
              <div class="furniture-shapes-grid" id="fm-shapes-grid">
                ${shapesDef.map((s) => `
                  <div class="furniture-shape-card ${curShape === s.id ? 'is-active' : ''}" data-shape-choice="${esc(s.id)}">
                    <span class="furniture-shape-card__icon">${s.icon}</span>
                    <span class="furniture-shape-card__name">${esc(s.name)}</span>
                    <span class="furniture-shape-card__desc">${esc(s.desc)}</span>
                  </div>
                `).join('')}
              </div>
            </div>

            <div class="furniture-grid-group">
              <span class="furniture-grid-group__title">🪑 مدل و استایل صندلی‌ها:</span>
              <div class="furniture-chairs-row" id="fm-chairs-row">
                ${chairsDef.map((c) => `
                  <div class="furniture-chair-pill ${curChair === c.id ? 'is-active' : ''}" data-chair-choice="${esc(c.id)}">
                    <span>${c.icon}</span>
                    <span>${esc(c.name)}</span>
                  </div>
                `).join('')}
              </div>
            </div>

            <div class="furniture-grid-group">
              <span class="furniture-grid-group__title">👥 ظرفیت صندلی‌ها:</span>
              <div class="furniture-seats-stepper">
                <button type="button" class="palette-mini-btn" id="fm-seat-dec">−</button>
                <input type="number" id="fm-seats-input" min="1" max="24" value="${curSeats}"
                  style="width:55px;text-align:center;background:#1e293b;border:1px solid rgba(255,255,255,0.2);color:#fff;border-radius:6px;font-weight:900">
                <button type="button" class="palette-mini-btn" id="fm-seat-inc">＋</button>
                <span style="font-size:11px;color:#94a3b8">نفر</span>
              </div>
              <div class="furniture-seats-presets">
                ${[1, 2, 4, 6, 8, 10, 12, 16, 20, 24].map((cnt) => `
                  <button type="button" class="furniture-seat-preset ${curSeats === cnt ? 'is-active' : ''}" data-seat-preset="${cnt}">
                    ${fmtNum(cnt)} نفره
                  </button>
                `).join('')}
              </div>
            </div>`;

          showFloorModal({
            title: `🛋️ استودیوی چیدمان مبلمان و صندلی (${esc(tableTitle(table))})`,
            confirmText: 'اعمال روی میز و ذخیره',
            confirmClass: 'btn-primary',
            modalClass: 'floor-studio-modal--wide',
            bodyHtml,
            onConfirm: () => {
              pushHistory();
              table.shape = curShape;
              table.chairModel = curChair;
              table.seats = curSeats;
              debouncedSaveFloor();
              render();
              showToast(`فرم «${shapeTitle(curShape)}» با ${fmtNum(curSeats)} صندلی اعمال شد.`, 'success');
              return true;
            },
          });

          // ── Interactive bindings داخل modal ──
          setTimeout(() => {
            const modalEl = document.getElementById('floor-modal-backdrop');
            if (!modalEl) return;

            // انتخاب فرم هندسی
            modalEl.querySelectorAll('[data-shape-choice]').forEach((card) => {
              card.addEventListener('click', () => {
                curShape = card.dataset.shapeChoice;
                modalEl.querySelectorAll('[data-shape-choice]').forEach((c) => c.classList.toggle('is-active', c === card));
                // auto-select مناسب‌ترین مدل صندلی
                if (curShape === 'bar_stool' || curShape === 'wall_counter') curChair = 'bar_stool';
                else if (curShape === 'lounge_takht') curChair = 'bolster';
                modalEl.querySelectorAll('[data-chair-choice]').forEach((c) =>
                  c.classList.toggle('is-active', c.dataset.chairChoice === curChair));
              });
            });

            // انتخاب مدل صندلی
            modalEl.querySelectorAll('[data-chair-choice]').forEach((pill) => {
              pill.addEventListener('click', () => {
                curChair = pill.dataset.chairChoice;
                modalEl.querySelectorAll('[data-chair-choice]').forEach((p) => p.classList.toggle('is-active', p === pill));
              });
            });

            // stepper تعداد نفر
            const seatInp = modalEl.querySelector('#fm-seats-input');
            const syncSeats = (val) => {
              curSeats = Math.max(1, Math.min(24, Number(val) || 1));
              if (seatInp) seatInp.value = curSeats;
              modalEl.querySelectorAll('[data-seat-preset]').forEach((b) =>
                b.classList.toggle('is-active', Number(b.dataset.seatPreset) === curSeats));
            };

            modalEl.querySelector('#fm-seat-dec')?.addEventListener('click', () => syncSeats(curSeats - 1));
            modalEl.querySelector('#fm-seat-inc')?.addEventListener('click', () => syncSeats(curSeats + 1));
            seatInp?.addEventListener('input', () => syncSeats(Number(seatInp.value)));

            // preset buttons
            modalEl.querySelectorAll('[data-seat-preset]').forEach((btn) => {
              btn.addEventListener('click', () => syncSeats(Number(btn.dataset.seatPreset)));
            });
          }, 30);
        };

    const exportLayoutJson = la.exportLayoutJson
      ? () => la.exportLayoutJson(ctx)
      : () => {
          const data = { version: '1.2.0', exportTimestamp: new Date().toISOString(), branchId: currentBranchId(), settings: floorSettings, floors: floorLevels, zones: floorZones, fixtures: floorFixtures, tables: tables.map((t) => ({ id: t.id, label: t.label, seats: t.seats, zone: t.zone, floorId: t.floorId || 'floor-ground', shape: t.shape || 'rectangle', x: t.x, y: t.y, rotation: t.rotation || 0, active: t.active !== false, mergedWith: t.mergedWith || null, mergedInto: t.mergedInto || null, tags: t.tags || [] })) };
          const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a'); a.href = url; a.download = `westo-floor-plan-branch-${currentBranchId() || 'default'}-${new Date().toISOString().slice(0, 10)}.json`;
          document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
          showToast('فایل پشتیبان چیدمان سالن با موفقیت دانلود شد.', 'success');
        };

    const importLayoutJson = la.importLayoutJson
      ? () => la.importLayoutJson(ctx)
      : () => {
          showFloorModal({
            title: '📂 بازیابی و درون‌ریزی فایل چیدمان سالن',
            confirmText: 'اعمال فایل چیدمان',
            confirmClass: 'btn-primary',
            bodyHtml: `
              <p style="font-size:13px;color:#94a3b8;margin:0 0 12px">فایل JSON خروجی گرفته‌شده از استودیو را انتخاب کنید یا محتوای آن را وارد نمایید:</p>
              <div class="floor-studio-modal__field">
                <label for="fm-import-file">انتخاب فایل چیدمان (.json):</label>
                <input id="fm-import-file" type="file" accept=".json,application/json" style="padding:6px;background:rgba(255,255,255,0.05);border-radius:6px" />
              </div>
              <div class="floor-studio-modal__field" style="margin-top:10px">
                <label for="fm-import-text">یا متن JSON را مستقیماً جای‌گذاری کنید:</label>
                <textarea id="fm-import-text" rows="5" placeholder="کدهای JSON را اینجا الصاق کنید..." style="font-family:monospace;font-size:11px"></textarea>
              </div>
            `,
            onConfirm: async (form) => {
              const fileInput = form.querySelector('#fm-import-file');
              const textInput = form.querySelector('#fm-import-text');
              let content = textInput?.value?.trim();

              if (!content && fileInput?.files?.[0]) {
                content = await fileInput.files[0].text();
              }

              if (!content) {
                showToast('لطفاً یک فایل یا متن معتبر وارد کنید.', 'warning');
                return false;
              }

              try {
                const parsed = JSON.parse(content);
                if (!parsed || (!Array.isArray(parsed.tables) && !Array.isArray(parsed.zones))) {
                  throw new Error('فرمت فایل پشتیبان معتبر نیست.');
                }
                pushHistory();
                if (Array.isArray(parsed.floors) && parsed.floors.length > 0) {
                  floorLevels = parsed.floors;
                  activeFloorId = floorLevels[0].id;
                }
                if (Array.isArray(parsed.zones)) {
                  floorZones = parsed.zones;
                }
                if (Array.isArray(parsed.fixtures)) {
                  floorFixtures = parsed.fixtures;
                }
                if (parsed.settings && typeof parsed.settings === 'object') {
                  floorSettings = { ...floorSettings, ...parsed.settings };
                }
                if (Array.isArray(parsed.tables)) {
                  tables = parsed.tables.map((t) => {
                    const copy = { ...t };
                    ensureTableGeometry(copy, tables.length);
                    return copy;
                  });
                }
                await saveFloorLayout(false);
                render();
                showToast('چیدمان نقشه با موفقیت از فایل بازیابی شد.', 'success');
                return true;
              } catch (err) {
                showToast(err.message || 'خطا در پردازش فایل JSON', 'error');
                return false;
              }
            }
          });

          setTimeout(() => {
            const fileEl = document.getElementById('fm-import-file');
            const textEl = document.getElementById('fm-import-text');
            fileEl?.addEventListener('change', async () => {
              if (fileEl.files?.[0]) {
                try {
                  const t = await fileEl.files[0].text();
                  if (textEl) textEl.value = t;
                } catch (_) {}
              }
            });
          }, 50);
        };

    const showTemplateModal = la.showTemplateModal
      ? () => la.showTemplateModal(ctx)
      : () => {
          const templates = [
            {
              id: 'modern-cafe',
              title: 'کافه تریا و بار مدرن',
              icon: '☕',
              desc: 'مناسب کافه‌ها و قهوه‌فروشی‌ها با پیشخوان بار مرکزی، صندلی‌های گرد و مربع، تراس پیاده‌رو و ورودی شیک.',
              zones: [
                { id: 'z-cafe-main', name: 'سالن کافه', x: 2, y: 2, w: 60, h: 96, color: 'amber', icon: '☕', shape: 'rectangle', lengthM: 12, widthM: 8 },
                { id: 'z-cafe-terrace', name: 'تراس پیاده‌رو', x: 64, y: 2, w: 34, h: 96, color: 'emerald', icon: '🌿', shape: 'open-terrace', lengthM: 8, widthM: 4 },
              ],
              fixtures: [
                { id: 'f-bar', type: 'bar', name: 'کافه بار تخصصی', x: 10, y: 6, w: 25, h: 10, rotation: 0, color: 'amber', icon: '☕', floorId: 'floor-ground' },
                { id: 'f-cash', type: 'cashier', name: 'صندوق سفارش', x: 38, y: 6, w: 12, h: 10, rotation: 0, color: 'cyan', icon: '💳', floorId: 'floor-ground' },
                { id: 'f-wc', type: 'restroom', name: 'سرویس', x: 5, y: 84, w: 10, h: 12, rotation: 0, color: 'purple', icon: '🚻', floorId: 'floor-ground' },
                { id: 'f-ent', type: 'entrance', name: 'ورودی اصلی', x: 60, y: 50, w: 4, h: 12, rotation: 90, color: 'emerald', icon: '🚪', floorId: 'floor-ground' },
                { id: 'f-plant', type: 'plant', name: 'فضای سبز', x: 92, y: 6, w: 6, h: 6, rotation: 0, color: 'emerald', icon: '🪴', floorId: 'floor-ground' },
              ],
              tables: [
                { label: 'میز ۱', seats: 2, shape: 'circle', zone: 'سالن کافه', x: 12, y: 28 },
                { label: 'میز ۲', seats: 2, shape: 'circle', zone: 'سالن کافه', x: 26, y: 28 },
                { label: 'میز ۳', seats: 4, shape: 'square', zone: 'سالن کافه', x: 40, y: 28 },
                { label: 'میز ۴', seats: 4, shape: 'square', zone: 'سالن کافه', x: 12, y: 48 },
                { label: 'میز ۵', seats: 4, shape: 'square', zone: 'سالن کافه', x: 26, y: 48 },
                { label: 'میز ۶', seats: 6, shape: 'rectangle', zone: 'سالن کافه', x: 42, y: 52 },
                { label: 'میز بار ۱', seats: 1, shape: 'bar_stool', zone: 'سالن کافه', x: 14, y: 18 },
                { label: 'میز بار ۲', seats: 1, shape: 'bar_stool', zone: 'سالن کافه', x: 22, y: 18 },
                { label: 'میز بار ۳', seats: 1, shape: 'bar_stool', zone: 'سالن کافه', x: 30, y: 18 },
                { label: 'تراس ۱', seats: 2, shape: 'circle', zone: 'تراس پیاده‌رو', x: 74, y: 22 },
                { label: 'تراس ۲', seats: 2, shape: 'circle', zone: 'تراس پیاده‌رو', x: 86, y: 22 },
                { label: 'تراس ۳', seats: 4, shape: 'rectangle', zone: 'تراس پیاده‌رو', x: 74, y: 48 },
                { label: 'تراس ۴', seats: 4, shape: 'rectangle', zone: 'تراس پیاده‌رو', x: 86, y: 48 },
                { label: 'تراس ۵', seats: 4, shape: 'rectangle', zone: 'تراس پیاده‌رو', x: 80, y: 75 },
              ]
            },
            {
              id: 'traditional-persian',
              title: 'رستوران سنتی و سفره‌خانه با تخت‌های شاه‌نشین',
              icon: '🛏️',
              desc: 'طراحی اصیل ایرانی شامل تخت‌های سنتی با قالیچه و پشتی، فضای حوض‌خانه، شاه‌نشین و میزهای خانوادگی.',
              zones: [
                { id: 'z-trad-main', name: 'سالن شاه‌نشین', x: 2, y: 2, w: 68, h: 96, color: 'purple', icon: '👑', shape: 'rectangle', lengthM: 16, widthM: 10 },
                { id: 'z-trad-garden', name: 'باغچه و حیاط سنتی', x: 72, y: 2, w: 26, h: 96, color: 'emerald', icon: '🌿', shape: 'open-terrace', lengthM: 10, widthM: 5 },
              ],
              fixtures: [
                { id: 'f-buffet', type: 'buffet', name: 'بوفه سالاد و دسر سنتی', x: 10, y: 6, w: 22, h: 8, rotation: 0, color: 'amber', icon: '🥗', floorId: 'floor-ground' },
                { id: 'f-cash', type: 'cashier', name: 'صندوق خاتم‌کاری', x: 42, y: 6, w: 12, h: 8, rotation: 0, color: 'cyan', icon: '💳', floorId: 'floor-ground' },
                { id: 'f-stage', type: 'stage', name: 'جایگاه اجرای موسیقی زنده سنتی', x: 8, y: 84, w: 26, h: 12, rotation: 0, color: 'purple', icon: '🎭', floorId: 'floor-ground' },
                { id: 'f-wc', type: 'restroom', name: 'سرویس بهداشتی', x: 58, y: 86, w: 10, h: 10, rotation: 0, color: 'purple', icon: '🚻', floorId: 'floor-ground' },
                { id: 'f-ent', type: 'entrance', name: 'ورودی طاق‌دار سنتی', x: 68, y: 50, w: 4, h: 12, rotation: 90, color: 'emerald', icon: '🚪', floorId: 'floor-ground' },
              ],
              tables: [
                { label: 'تخت ۱ شاه‌نشین', seats: 8, shape: 'lounge_takht', zone: 'سالن شاه‌نشین', x: 14, y: 26 },
                { label: 'تخت ۲ شاه‌نشین', seats: 8, shape: 'lounge_takht', zone: 'سالن شاه‌نشین', x: 34, y: 26 },
                { label: 'تخت ۳ شاه‌نشین', seats: 8, shape: 'lounge_takht', zone: 'سالن شاه‌نشین', x: 54, y: 26 },
                { label: 'تخت ۴ حوض‌خانه', seats: 8, shape: 'lounge_takht', zone: 'سالن شاه‌نشین', x: 14, y: 54 },
                { label: 'تخت ۵ حوض‌خانه', seats: 8, shape: 'lounge_takht', zone: 'سالن شاه‌نشین', x: 34, y: 54 },
                { label: 'تخت ۶ حوض‌خانه', seats: 8, shape: 'lounge_takht', zone: 'سالن شاه‌نشین', x: 54, y: 54 },
                { label: 'میز خانوادگی ۱', seats: 6, shape: 'rectangle', zone: 'سالن شاه‌نشین', x: 42, y: 78 },
                { label: 'آلاچیق ۱', seats: 6, shape: 'lounge_takht', zone: 'باغچه و حیاط سنتی', x: 84, y: 22 },
                { label: 'آلاچیق ۲', seats: 6, shape: 'lounge_takht', zone: 'باغچه و حیاط سنتی', x: 84, y: 50 },
                { label: 'آلاچیق ۳', seats: 6, shape: 'lounge_takht', zone: 'باغچه و حیاط سنتی', x: 84, y: 78 },
              ]
            },
            {
              id: 'fast-casual',
              title: 'فست‌فود و برگر زنجیره‌ای',
              icon: '🍔',
              desc: 'گردش سریع مشتری با نیمکت‌های باجه‌ای، پیشخوان تحویل سریع، دو باجه صندوق و میزهای استاندارد.',
              zones: [
                { id: 'z-ff-dining', name: 'سالن نشیمن باجه‌ای', x: 2, y: 2, w: 66, h: 96, color: 'rose', icon: '🛋️', shape: 'rectangle', lengthM: 14, widthM: 9 },
                { id: 'z-ff-order', name: 'محوطه سفارش و تحویل', x: 70, y: 2, w: 28, h: 96, color: 'cyan', icon: '⚡', shape: 'corridor', lengthM: 14, widthM: 4 },
              ],
              fixtures: [
                { id: 'f-kitchen', type: 'kitchen', name: 'تحویل سفارش و آشپزخانه', x: 74, y: 10, w: 20, h: 14, rotation: 0, color: 'rose', icon: '🍳', floorId: 'floor-ground' },
                { id: 'f-cash1', type: 'cashier', name: 'صندوق ۱ (سفارش حضوری)', x: 74, y: 32, w: 20, h: 8, rotation: 0, color: 'cyan', icon: '💳', floorId: 'floor-ground' },
                { id: 'f-cash2', type: 'cashier', name: 'صندوق ۲ (پیک و اسنپ)', x: 74, y: 46, w: 20, h: 8, rotation: 0, color: 'cyan', icon: '💳', floorId: 'floor-ground' },
                { id: 'f-wc', type: 'restroom', name: 'سرویس بهداشتی', x: 74, y: 82, w: 18, h: 12, rotation: 0, color: 'purple', icon: '🚻', floorId: 'floor-ground' },
                { id: 'f-ent', type: 'entrance', name: 'درب ورودی و خروج', x: 67, y: 68, w: 4, h: 12, rotation: 90, color: 'emerald', icon: '🚪', floorId: 'floor-ground' },
              ],
              tables: [
                { label: 'باکس ۱', seats: 4, shape: 'booth', zone: 'سالن نشیمن باجه‌ای', x: 12, y: 16 },
                { label: 'باکس ۲', seats: 4, shape: 'booth', zone: 'سالن نشیمن باجه‌ای', x: 30, y: 16 },
                { label: 'باکس ۳', seats: 4, shape: 'booth', zone: 'سالن نشیمن باجه‌ای', x: 48, y: 16 },
                { label: 'باکس ۴', seats: 4, shape: 'booth', zone: 'سالن نشیمن باجه‌ای', x: 12, y: 40 },
                { label: 'باکس ۵', seats: 4, shape: 'booth', zone: 'سالن نشیمن باجه‌ای', x: 30, y: 40 },
                { label: 'باکس ۶', seats: 4, shape: 'booth', zone: 'سالن نشیمن باجه‌ای', x: 48, y: 40 },
                { label: 'باکس ۷', seats: 4, shape: 'booth', zone: 'سالن نشیمن باجه‌ای', x: 12, y: 66 },
                { label: 'باکس ۸', seats: 4, shape: 'booth', zone: 'سالن نشیمن باجه‌ای', x: 30, y: 66 },
                { label: 'باکس ۹', seats: 4, shape: 'booth', zone: 'سالن نشیمن باجه‌ای', x: 48, y: 66 },
                { label: 'میز طولی ۱۰', seats: 6, shape: 'rectangle', zone: 'سالن نشیمن باجه‌ای', x: 24, y: 86 },
                { label: 'میز طولی ۱۱', seats: 6, shape: 'rectangle', zone: 'سالن نشیمن باجه‌ای', x: 48, y: 86 },
              ]
            },
            {
              id: 'fine-dining',
              title: 'فاین داینینگ و استیک‌هاوس مجلل',
              icon: '🍷',
              desc: 'محیط لوکس با میزهای بیضی و گرد بزرگ، اتاق خصوصی VIP، ستون‌های مرمری و بار نوشیدنی مجلل.',
              zones: [
                { id: 'z-fd-main', name: 'سالن اصلی مجلل', x: 2, y: 2, w: 68, h: 96, color: 'blue', icon: '🍷', shape: 'rectangle', lengthM: 18, widthM: 12 },
                { id: 'z-fd-vip', name: 'سالن اختصاصی VIP', x: 72, y: 2, w: 26, h: 96, color: 'purple', icon: '👑', shape: 'rectangle', lengthM: 10, widthM: 6 },
              ],
              fixtures: [
                { id: 'f-bar', type: 'bar', name: 'بار مجلل نوشیدنی و پیانو', x: 8, y: 8, w: 24, h: 10, rotation: 0, color: 'amber', icon: '🍷', floorId: 'floor-ground' },
                { id: 'f-pillar1', type: 'pillar', name: 'ستون مرمر', x: 32, y: 35, w: 4, h: 4, rotation: 0, color: 'slate', icon: '🏛️', floorId: 'floor-ground' },
                { id: 'f-pillar2', type: 'pillar', name: 'ستون مرمر', x: 32, y: 65, w: 4, h: 4, rotation: 0, color: 'slate', icon: '🏛️', floorId: 'floor-ground' },
                { id: 'f-cash', type: 'cashier', name: 'پذیرش و مهمانداری', x: 40, y: 8, w: 16, h: 8, rotation: 0, color: 'cyan', icon: '💳', floorId: 'floor-ground' },
                { id: 'f-ent', type: 'entrance', name: 'ورودی اصلی تشریفات', x: 69, y: 50, w: 4, h: 14, rotation: 90, color: 'emerald', icon: '🚪', floorId: 'floor-ground' },
              ],
              tables: [
                { label: 'میز گرد ۱', seats: 4, shape: 'circle', zone: 'سالن اصلی مجلل', x: 14, y: 32 },
                { label: 'میز گرد ۲', seats: 4, shape: 'circle', zone: 'سالن اصلی مجلل', x: 14, y: 56 },
                { label: 'میز گرد ۳', seats: 4, shape: 'circle', zone: 'سالن اصلی مجلل', x: 14, y: 80 },
                { label: 'میز سلطنتی ۴', seats: 8, shape: 'oval', zone: 'سالن اصلی مجلل', x: 50, y: 32 },
                { label: 'میز سلطنتی ۵', seats: 8, shape: 'oval', zone: 'سالن اصلی مجلل', x: 50, y: 65 },
                { label: 'شاه‌نشین VIP ۱', seats: 10, shape: 'oval', zone: 'سالن اختصاصی VIP', x: 85, y: 30 },
                { label: 'شاه‌نشین VIP ۲', seats: 8, shape: 'circle', zone: 'سالن اختصاصی VIP', x: 85, y: 68 },
              ]
            },
            {
              id: 'rooftop-lounge',
              title: 'روف‌گاردن و لانژ مرتفع',
              icon: '☀️',
              desc: 'فضای روباز طبقه بالا، چشم‌انداز شهری، مبلمان لانژ و تخت‌های آفتابگیر، بار روباز و گیاهان سرسبز.',
              zones: [
                { id: 'z-roof-deck', name: 'تراس مرتفع و لانژ', x: 2, y: 2, w: 96, h: 96, color: 'cyan', icon: '☀️', shape: 'open-terrace', lengthM: 20, widthM: 14 },
              ],
              fixtures: [
                { id: 'f-roof-bar', type: 'bar', name: 'بار روباز روف‌گاردن', x: 38, y: 6, w: 26, h: 10, rotation: 0, color: 'cyan', icon: '🍹', floorId: 'floor-ground' },
                { id: 'f-elev', type: 'elevator', name: 'ورودی آسانسور اختصاصی بام', x: 6, y: 6, w: 12, h: 12, rotation: 0, color: 'blue', icon: '🛗', floorId: 'floor-ground' },
                { id: 'f-plant1', type: 'plant', name: 'باغچه عمودی و گیاهان', x: 6, y: 84, w: 16, h: 8, rotation: 0, color: 'emerald', icon: '🪴', floorId: 'floor-ground' },
                { id: 'f-plant2', type: 'plant', name: 'باغچه عمودی و گیاهان', x: 78, y: 84, w: 16, h: 8, rotation: 0, color: 'emerald', icon: '🪴', floorId: 'floor-ground' },
              ],
              tables: [
                { label: 'لانژ آفتاب ۱', seats: 6, shape: 'lounge_takht', zone: 'تراس مرتفع و لانژ', x: 16, y: 32 },
                { label: 'لانژ آفتاب ۲', seats: 6, shape: 'lounge_takht', zone: 'تراس مرتفع و لانژ', x: 16, y: 60 },
                { label: 'میز ویو ۳', seats: 4, shape: 'circle', zone: 'تراس مرتفع و لانژ', x: 42, y: 32 },
                { label: 'میز ویو ۴', seats: 4, shape: 'circle', zone: 'تراس مرتفع و لانژ', x: 58, y: 32 },
                { label: 'میز ویو ۵', seats: 4, shape: 'circle', zone: 'تراس مرتفع و لانژ', x: 42, y: 60 },
                { label: 'میز ویو ۶', seats: 4, shape: 'circle', zone: 'تراس مرتفع و لانژ', x: 58, y: 60 },
                { label: 'لانژ افق ۷', seats: 6, shape: 'lounge_takht', zone: 'تراس مرتفع و لانژ', x: 84, y: 32 },
                { label: 'لانژ افق ۸', seats: 6, shape: 'lounge_takht', zone: 'تراس مرتفع و لانژ', x: 84, y: 60 },
              ]
            },
            {
              id: 'banquet-hall',
              title: 'تالار پذیرایی و همایش‌های تشریفاتی',
              icon: '🏛️',
              desc: 'میزهای گرد ضیافتی بزرگ (۸ و ۱۰ نفره)، استیج و سن اجرا، خطوط بوفه پذیرایی و ظرفیت بالا.',
              zones: [
                { id: 'z-bq-hall', name: 'تالار اصلی ضیافت', x: 2, y: 2, w: 96, h: 96, color: 'purple', icon: '🏛️', shape: 'rectangle', lengthM: 25, widthM: 18 },
              ],
              fixtures: [
                { id: 'f-stage', type: 'stage', name: 'سن و جایگاه ویژه مراسم', x: 30, y: 5, w: 40, h: 14, rotation: 0, color: 'purple', icon: '🎭', floorId: 'floor-ground' },
                { id: 'f-buff1', type: 'buffet', name: 'لاین بوفه شام ۱', x: 5, y: 25, w: 8, h: 48, rotation: 0, color: 'amber', icon: '🥗', floorId: 'floor-ground' },
                { id: 'f-buff2', type: 'buffet', name: 'لاین بوفه شام ۲', x: 87, y: 25, w: 8, h: 48, rotation: 0, color: 'amber', icon: '🥗', floorId: 'floor-ground' },
                { id: 'f-ent', type: 'entrance', name: 'درب‌های دوتایی ورودی تشریفات', x: 42, y: 92, w: 16, h: 6, rotation: 0, color: 'emerald', icon: '🚪', floorId: 'floor-ground' },
              ],
              tables: [
                { label: 'میز ۱۰۱', seats: 8, shape: 'circle', zone: 'تالار اصلی ضیافت', x: 25, y: 30 },
                { label: 'میز ۱۰۲', seats: 8, shape: 'circle', zone: 'تالار اصلی ضیافت', x: 45, y: 30 },
                { label: 'میز ۱۰۳', seats: 8, shape: 'circle', zone: 'تالار اصلی ضیافت', x: 65, y: 30 },
                { label: 'میز ۱۰۴', seats: 8, shape: 'circle', zone: 'تالار اصلی ضیافت', x: 25, y: 50 },
                { label: 'میز ۱۰۵', seats: 8, shape: 'circle', zone: 'تالار اصلی ضیافت', x: 45, y: 50 },
                { label: 'میز ۱۰۶', seats: 8, shape: 'circle', zone: 'تالار اصلی ضیافت', x: 65, y: 50 },
                { label: 'میز ۱۰۷', seats: 8, shape: 'circle', zone: 'تالار اصلی ضیافت', x: 25, y: 70 },
                { label: 'میز ۱۰۸', seats: 8, shape: 'circle', zone: 'تالار اصلی ضیافت', x: 45, y: 70 },
                { label: 'میز ۱۰۹', seats: 8, shape: 'circle', zone: 'تالار اصلی ضیافت', x: 65, y: 70 },
              ]
            }
          ];

          showFloorModal({
            title: '📋 انتخاب قالب و الگوی معماری آماده رستوران',
            confirmText: 'اعمال این قالب روی سالن',
            confirmClass: 'btn-primary',
            modalClass: 'floor-studio-modal--wide',
            bodyHtml: `
              <p style="font-size:13px;color:#94a3b8;margin:0 0 12px">یک قالب استاندارد را برای چیدمان فوری و حرفه‌ای رستوران انتخاب کنید:</p>
              <div class="floor-template-grid" id="fm-templates-grid">
                ${templates.map((tpl, idx) => `
                  <div class="floor-template-card ${idx === 0 ? 'is-selected' : ''}" data-tpl-id="${tpl.id}">
                    <div class="floor-template-card__head">
                      <span style="font-size:24px">${tpl.icon}</span>
                      <strong style="font-size:14px;color:#f8fafc">${esc(tpl.title)}</strong>
                    </div>
                    <p style="font-size:11px;color:#94a3b8;margin:6px 0 10px;line-height:1.5">${esc(tpl.desc)}</p>
                    <div style="font-size:11px;color:#38bdf8;font-weight:700">
                      <span>📐 ${fmtNum(tpl.tables.length)} میز · ${fmtNum(tpl.fixtures.length)} سازه معماری</span>
                    </div>
                  </div>
                `).join('')}
              </div>
              <p style="font-size:12px;color:#fb7185;margin:12px 0 0">توجه: اعمال قالب، میزها، بخش‌ها و سازه‌های معماری فعلی این شعبه را جایگزین خواهد کرد. قبل از اعمال، تاریخچه قبلی ذخیره می‌گردد.</p>
            `,
            onConfirm: async (form) => {
              const selectedEl = form.querySelector('.floor-template-card.is-selected');
              const tplId = selectedEl?.dataset?.tplId;
              const tpl = templates.find((t) => t.id === tplId);
              if (!tpl) return false;

              pushHistory();
              floorZones = tpl.zones.map((z) => ({ ...z }));
              floorFixtures = tpl.fixtures.map((f) => ({ ...f }));
              tables = tpl.tables.map((t, idx) => {
                const item = {
                  id: idx + 1,
                  label: t.label,
                  seats: t.seats,
                  zone: t.zone,
                  shape: t.shape,
                  x: t.x,
                  y: t.y,
                  rotation: 0,
                  active: true,
                  floorId: 'floor-ground',
                  state: 'available',
                  stateLabel: 'آزاد',
                  branchId: currentBranchId(),
                  tags: [],
                };
                ensureTableGeometry(item, idx);
                return item;
              });

              activeZone = 'all';
              await saveFloorLayout(false);
              render();
              showToast(`قالب «${tpl.title}» با موفقیت روی نقشه سالن اعمال گردید.`, 'success');
              return true;
            }
          });

          setTimeout(() => {
            const grid = document.getElementById('fm-templates-grid');
            grid?.querySelectorAll('.floor-template-card').forEach((card) => {
              card.addEventListener('click', () => {
                grid.querySelectorAll('.floor-template-card').forEach((c) => c.classList.remove('is-selected'));
                card.classList.add('is-selected');
              });
            });
          }, 50);
        };

    return { promptAddZone, promptAddFloor, promptEditFloor, deleteFloor, promptMoveTableFloor, promptAddFixture, promptFloorSettings, promptTableFurnitureModal, exportLayoutJson, importLayoutJson, showTemplateModal };
  }

  // ─── mount — entry point ──────────────────────────────────────────────
  const mount = async () => {
    // بارگذاری داده‌ها
    let [d, freshFloorData] = await Promise.all([
      api(`/api/admin/tables${branchQs()}`),
      api(`/api/admin/v2/floor${branchQs()}`),
    ]);

    floorData = freshFloorData;

    // تنظیم floorLevels
    floorLevels = Array.isArray(floorData?.floors) && floorData.floors.length > 0
      ? floorData.floors.map((fl) => ({ id: String(fl.id || 'floor-ground'), name: String(fl.name || 'سالن اصلی (همکف)'), level: Number(fl.level) || 0, icon: fl.icon || '🏛️', isDefault: Boolean(fl.isDefault) }))
      : [{ id: 'floor-ground', name: 'سالن اصلی (همکف)', level: 0, icon: '🏛️', isDefault: true }];

    activeFloorId = floorLevels[0]?.id || 'floor-ground';

    // تنظیم floorFixtures
    floorFixtures = Array.isArray(floorData?.fixtures) && floorData.fixtures.length > 0
      ? floorData.fixtures.map((f, i) => ({ id: String(f.id || `fix-${i}`), type: String(f.type || 'fixture'), name: String(f.name || 'المان سالن'), x: Number(f.x) || 10, y: Number(f.y) || 10, w: Number(f.w) || 10, h: Number(f.h) || 8, rotation: Number(f.rotation) || 0, color: f.color || 'slate', icon: f.icon || '🏷️', floorId: f.floorId || 'floor-ground' }))
      : DEFAULT_FLOOR_FIXTURES;

    // تنظیم floorSettings
    floorSettings = floorData?.settings || { widthM: 20, lengthM: 25, gridStep: 0.5, bgTheme: 'blueprint', wallThickness: 0.4, showRulers: true, showGrid: true };

    // تنظیم floorZones
    floorZones = sanitizeNonOverlappingZones(
      Array.isArray(floorData?.zones) && floorData.zones.length > 0
        ? floorData.zones.map((z) => ({ id: String(z.id || `zone-${Math.random().toString(36).slice(2, 7)}`), name: normalizeZone(z.name), x: Number(z.x) || 0, y: Number(z.y) || 0, w: Number(z.w) || 30, h: Number(z.h) || 30, color: z.color || 'blue', icon: z.icon || '🏷️' }))
        : DEFAULT_FLOOR_ZONES
    );

    // تنظیم QR prefs
    try { qrPrefs = { ...defaultQrPrefs, ...JSON.parse(localStorage.getItem(QR_PREFS_KEY) || '{}') }; }
    catch { qrPrefs = { ...defaultQrPrefs }; }
    normalizeQrPrefs();

    // بارگذاری tables
    tables = Array.isArray(d.tables) ? d.tables : [];
    tables.forEach((t) => { t.zone = normalizeZone(t.zone); });

    // Ensure custom zones
    const existingZoneNames = new Set(floorZones.map((z) => normalizeZone(z.name)));
    tables.forEach((t) => {
      const zn = normalizeZone(t.zone);
      if (zn && !existingZoneNames.has(zn)) {
        existingZoneNames.add(zn);
        floorZones.push({ id: `zone-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, name: zn, x: 35, y: 35, w: 30, h: 30, color: 'amber', icon: '🏷️' });
      }
    });

    // Apply floorData to tables
    const floorTableMap = new Map((floorData?.tables || []).map((t) => [Number(t.id), t]));
    tables.forEach((table, index) => {
      const f = floorTableMap.get(Number(table.id));
      if (f) {
        if (typeof f.x === 'number') table.x = f.x;
        if (typeof f.y === 'number') table.y = f.y;
        if (f.shape) table.shape = f.shape;
        if (typeof f.rotation === 'number') table.rotation = f.rotation;
        if (f.zone) table.zone = normalizeZone(f.zone);
        table.state = f.state || table.state;
        table.stateLabel = f.stateLabel || table.stateLabel;
        table.serviceEndsAt = f.serviceEndsAt || null;
        table.autoReleased = Boolean(f.autoReleased);
        table.waiterCallId = f.waiterCallId || null;
      }
      ensureTableGeometry(table, index);
    });

    // اولین render
    render();
  };

  return { mount, unmount };
}

// Export برای استفاده در admin.js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { createFloorStudio };
} else if (typeof window !== 'undefined') {
  window.createFloorStudio = createFloorStudio;
}
