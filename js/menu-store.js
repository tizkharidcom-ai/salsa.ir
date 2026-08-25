/* One shared, category-id based menu model for the hero, boards and rail.
   Instant local hydrate → one coalesced network refresh. Offline keeps the
   last good snapshot. Persistence is intentionally moved out of the startup
   hot path so JSON.stringify/localStorage does not compete with Hero boot. */
(function () {
  'use strict';

  const existing = window.westoMenuStore;
  if (existing && existing.ready) return;

  const LOCAL_KEY = 'westo_menu_cache';
  const LOCAL_SOFT_TTL_MS = 6 * 60 * 60 * 1000;
  const PERSIST_IDLE_TIMEOUT_MS = 2500;
  const PERSIST_FALLBACK_DELAY_MS = 900;

  const store = {
    data: null,
    ready: null,
    byCategory: Object.create(null),
    categories: [],
    categoryOrder: [],
    menuRevision: 0,
    fromCache: false,
    updatedAt: 0,
    savedAt: 0,
    lastError: null,
    refresh: null,
    getSnapshot: null,
  };

  // Publish the store before any cached-data event is emitted. Existing
  // consumers primarily use event.detail, but making the global available
  // immediately removes a timing hole for late/legacy consumers.
  window.westoMenuStore = store;

  let cachedSnapshot = null;
  let inFlight = null;
  let persistPayload = null;
  let persistIdleHandle = 0;
  let persistTimer = 0;
  let destroyed = false;

  function isDrinkTexture(path) {
    return /assets\/textures\/westo_texture_/i.test(String(path || ''));
  }

  function hasCover(category) {
    const cover = String(category?.coverImg || '').trim();
    return Boolean(cover) && !isDrinkTexture(cover);
  }

  function safeArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function applyData(data, { fromCache = false, savedAt = 0 } = {}) {
    if (!data || typeof data !== 'object') return store;

    const menuItems = safeArray(data.menuItems);
    const menuCategories = safeArray(data.menuCategories);
    const siteCategories = safeArray(data.siteCategories);
    const byCategory = Object.create(null);

    for (let index = 0; index < menuItems.length; index += 1) {
      const item = menuItems[index];
      if (!item || item.available === false) continue;
      const id = Number(item.categoryId);
      if (!Number.isFinite(id)) continue;
      if (!byCategory[id]) byCategory[id] = [];
      byCategory[id].push(item);
    }

    // Preserve the stable category-selection contract exactly: server
    // siteCategories wins; menuCategories is only the fallback.
    let categories;
    if (siteCategories.length) {
      categories = siteCategories.filter((category) => category && hasCover(category));
    } else {
      categories = menuCategories.filter(
        (category) => category && !category.hiddenOnSite && hasCover(category),
      );
    }

    store.data = data;
    store.byCategory = byCategory;
    store.categories = categories;
    store.categoryOrder = categories.map((category) => Number(category.id));
    store.menuRevision = Number(data.menuRevision) || 0;
    store.fromCache = Boolean(fromCache);
    store.updatedAt = Date.now();
    if (savedAt) store.savedAt = Number(savedAt) || store.savedAt || 0;
    store.lastError = null;

    window.__westoCategoryOrder = store.categoryOrder.slice();
    window.__westoMenuRevision = store.menuRevision;

    window.dispatchEvent(
      new CustomEvent('westo:menu-ready', {
        detail: store,
      }),
    );

    return store;
  }

  function readLocal() {
    try {
      const value = localStorage.getItem(LOCAL_KEY);
      if (!value) return null;
      const parsed = JSON.parse(value);
      if (!parsed || typeof parsed !== 'object' || !parsed.data || typeof parsed.data !== 'object') {
        return null;
      }
      return parsed;
    } catch (_) {
      return null;
    }
  }

  function cancelPersistSchedule() {
    if (persistIdleHandle && typeof window.cancelIdleCallback === 'function') {
      try {
        window.cancelIdleCallback(persistIdleHandle);
      } catch (_) {}
    }
    persistIdleHandle = 0;
    if (persistTimer) window.clearTimeout(persistTimer);
    persistTimer = 0;
  }

  function persistNow() {
    if (!persistPayload) return false;
    const payload = persistPayload;
    persistPayload = null;
    cancelPersistSchedule();

    try {
      localStorage.setItem(LOCAL_KEY, JSON.stringify(payload));
      store.savedAt = Number(payload.savedAt) || Date.now();
      cachedSnapshot = payload;
      return true;
    } catch (_) {
      return false;
    }
  }

  function schedulePersist(data) {
    if (!data || typeof data !== 'object') return;

    persistPayload = {
      savedAt: Date.now(),
      menuRevision: Number(data.menuRevision) || 0,
      data,
    };

    // Coalesce multiple fast refreshes into one persistent write.
    if (persistIdleHandle || persistTimer) return;

    if (typeof window.requestIdleCallback === 'function') {
      persistIdleHandle = window.requestIdleCallback(
        () => {
          persistIdleHandle = 0;
          persistNow();
        },
        { timeout: PERSIST_IDLE_TIMEOUT_MS },
      );
    } else {
      persistTimer = window.setTimeout(() => {
        persistTimer = 0;
        persistNow();
      }, PERSIST_FALLBACK_DELAY_MS);
    }
  }

  function isSyntheticOfflinePayload(data) {
    return Boolean(data && typeof data === 'object' && data.offline === true);
  }

  async function fetchFreshMenu() {
    const response = await fetch('/api/menu', {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-cache',
      headers: {
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`menu request failed (${response.status})`);
    }

    const data = await response.json();
    if (!data || typeof data !== 'object') {
      throw new Error('menu request returned invalid JSON');
    }
    return data;
  }

  function keepOfflineSnapshot(error) {
    store.lastError = error || null;

    if (store.data) {
      // The cached/local snapshot was already painted. Do not re-apply it:
      // re-dispatching menu-ready would make boards/hero rebuild for no gain.
      return store;
    }

    if (cachedSnapshot?.data) {
      try {
        return applyData(cachedSnapshot.data, {
          fromCache: true,
          savedAt: cachedSnapshot.savedAt,
        });
      } catch (_) {}
    }

    // Preserve the old contract: ready still resolves to the store even when
    // no menu is available, so Hero/Table fallbacks can continue normally.
    store.data = {
      menuCategories: [],
      menuItems: [],
      siteCategories: [],
    };
    store.byCategory = Object.create(null);
    store.categories = [];
    store.categoryOrder = [];
    store.menuRevision = 0;
    store.fromCache = true;
    window.__westoCategoryOrder = [];
    window.__westoMenuRevision = 0;
    return store;
  }

  function refresh() {
    if (destroyed) return Promise.resolve(store);
    if (inFlight) return inFlight;

    inFlight = fetchFreshMenu()
      .then((data) => {
        // Legacy offline builds returned { offline:true, ... } only when both the
        // network and SW Cache Storage miss. Never let that synthetic empty
        // payload overwrite a valid localStorage snapshot.
        if (isSyntheticOfflinePayload(data)) {
          const error = new Error('menu offline fallback');
          error.code = 'WESTO_MENU_OFFLINE_FALLBACK';
          return keepOfflineSnapshot(error);
        }

        const result = applyData(data, { fromCache: false });
        // Persist after the critical render work, not inside this promise's
        // immediate continuation. Consumers can paint from the fresh object
        // while storage work waits for idle time.
        schedulePersist(data);
        return result;
      })
      .catch((error) => {
        if (!destroyed) console.warn('[westoMenuStore]', error);
        return keepOfflineSnapshot(error);
      })
      .finally(() => {
        inFlight = null;
      });

    return inFlight;
  }

  store.refresh = refresh;
  store.getSnapshot = () => store;

  // The parser-preloaded content bootstrap now carries the exact current
  // guest-menu payload. Prefer it over localStorage and skip the redundant
  // startup /api/menu request entirely. Older/static deployments keep the
  // original cache -> refresh fallback below.
  const bootMenu = window.__WESTO_CONTENT__?.menu;
  if (bootMenu && typeof bootMenu === 'object') {
    try {
      applyData(bootMenu, { fromCache: false });
      schedulePersist(bootMenu);
      store.ready = Promise.resolve(store);
    } catch (error) {
      store.lastError = error;
    }
  }

  if (!store.ready) {
    // Instant user-first hydrate from the last known good snapshot.
    cachedSnapshot = readLocal();
    if (cachedSnapshot?.data) {
      try {
        applyData(cachedSnapshot.data, {
          fromCache: true,
          savedAt: cachedSnapshot.savedAt,
        });
      } catch (_) {}
    }

    // Compatibility path for static/older servers that do not publish
    // window.__WESTO_CONTENT__.menu.
    store.ready = refresh();

    // Keep the existing soft-TTL signal used by the optional background warmer.
    if (
      cachedSnapshot?.savedAt &&
      Date.now() - Number(cachedSnapshot.savedAt) > LOCAL_SOFT_TTL_MS
    ) {
      try {
        localStorage.removeItem('westo_warm_state');
      } catch (_) {}
    }
  }

  // If initial refresh happened while offline, reconnecting should repair the
  // shared store once. inFlight coalescing prevents an online-event burst from
  // creating parallel /api/menu requests.
  function onOnline() {
    if (store.fromCache || store.lastError) refresh();
  }

  function onPageHide() {
    // A fresh menu that has already painted should not be lost just because
    // the idle callback did not run before navigation/close.
    if (persistPayload) persistNow();
  }

  window.addEventListener('online', onOnline, { passive: true });
  window.addEventListener('pagehide', onPageHide);
})();
