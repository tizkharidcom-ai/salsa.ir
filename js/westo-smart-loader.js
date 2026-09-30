/* WESTO Smart Loader v1
 * Central resource scheduler / browser download manager.
 * No Service Worker. One owner for menu image/audio network work.
 * Priorities: CRITICAL > USER_INTENT > VISIBLE > PREDICTIVE > BACKGROUND.
 */
(function () {
  'use strict';

  if (window.WestoResources && window.WestoSmartLoad) return;

  const VERSION = 'release14-menu-payload-contract-v2';
  // The static bootstrap is immutable-cached. Bump this independently when
  // the public menu catalogue changes so a recovered/offline menu cannot keep
  // serving an older catalogue after a data foundation refresh.
  const STATIC_BOOTSTRAP_VERSION = 'menu-foundation-v2';
  const now = () => performance.now();
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection || null;  const coarse = Boolean(window.matchMedia?.('(pointer: coarse)')?.matches);
  const lowMemory = Number(navigator.deviceMemory || 8) <= 4;

  const P = Object.freeze({
    CRITICAL: 130,
    INTENT: 120,
    CURRENT: 115,
    NEXT: 108,
    VISIBLE: 92,
    NEAR: 76,
    PREDICT: 54,
    BACKGROUND: 24,
    IDLE: 10,
  });

  let detectedTransport = 'unknown';

  function networkBudget() {
    const saveData = Boolean(connection?.saveData);
    const effectiveType = String(connection?.effectiveType || '4g').toLowerCase();
    const rtt = Math.max(0, Number(connection?.rtt || 0));
    const downlink = Math.max(0, Number(connection?.downlink || 0));
    if (saveData || effectiveType === 'slow-2g' || effectiveType === '2g') {
      return { max: 2, reserve: 1, predictive: false, background: true, name: 'constrained' };
    }
    // A nominal "4g" connection can still have very high RTT/bufferbloat.
    // Prefer responsiveness over bulk warming when the Network Information API
    // exposes a slow path; this leaves a lane free for taps/navigation.
    if (rtt >= 220 || (downlink > 0 && downlink < 4)) {
      return { max: 2, reserve: 1, predictive: false, background: true, name: 'high-latency' };
    }
    if (effectiveType === '3g') {
      return { max: 3, reserve: 1, predictive: true, background: true, name: '3g' };
    }
    if (rtt >= 120 || (downlink > 0 && downlink < 8)) {
      return { max: 3, reserve: 1, predictive: true, background: true, name: 'latency-aware' };
    }
    const transportBonus = detectedTransport === 'h2' || detectedTransport === 'h3' ? 1 : 0;
    return { max: Math.min(6, (coarse || lowMemory ? 4 : 5) + transportBonus), reserve: 1, predictive: true, background: true, name: transportBonus ? `fast-${detectedTransport}` : 'fast' };
  }

  let budget = networkBudget();
  const records = new Map();
  // Menu data owns stable WebP paths. The scheduler keeps that contract intact
  // and never upgrades a request to a lower-quality sibling format.
  const resolvedImageSources = new Map();
  const queue = [];
  const active = new Set();
  const imageBindings = new WeakMap();
  const progressiveBindings = new WeakMap();
  const decodePromises = new Map();
  const observerPools = new Map();
  let serial = 0;
  let focusEpoch = 0;
  let currentCategory = null;
  let currentDishSlot = 0;
  let criticalUntil = 0;
  let codeCritical = true;
  let menuModel = null;
  let previousCategoryIndex = -1;
  let lastDirection = 0;
  const metrics = {
    queued: 0,
    started: 0,
    completed: 0,
    aborted: 0,
    failed: 0,
    deduped: 0,
    cacheHits: 0,
    previewed: 0,
    promoted: 0,
    bytes: 0,
    maxActive: 0,
  };

  function emit(name, detail = {}) {
    try {
      window.dispatchEvent(new CustomEvent(`westo:resource:${name}`, { detail: { ...detail, at: now() } }));
    } catch (_) {}
  }

  function canonical(url) {
    try {
      return new URL(String(url || ''), location.href).href;
    } catch (_) {
      return String(url || '');
    }
  }

  function webpImageUrl(url) {
    try {
      const parsed = new URL(String(url || ''), location.href);
      const base = new URL(location.href);
      // A legacy local AVIF reference is translated to its retained WebP
      // sibling before fetching. Third-party AVIFs are intentionally skipped:
      // there is no reliable WebP sibling contract outside this application.
      if (/\.avif$/i.test(parsed.pathname)) {
        if (parsed.origin !== base.origin) return '';
        parsed.pathname = parsed.pathname.replace(/\.avif$/i, '.webp');
      }
      return parsed.href;
    } catch (_) {
      return '';
    }
  }

  function previewImageUrl(url) {
    try {
      const source = webpImageUrl(url);
      if (!source) return '';
      const parsed = new URL(source, location.href);
      const base = new URL(location.href);
      if (parsed.origin !== base.origin || /\/previews\//i.test(parsed.pathname)) return '';
      if (!/\.webp$/i.test(parsed.pathname)) return '';
      const directory = parsed.pathname.slice(0, parsed.pathname.lastIndexOf('/'));
      const filename = parsed.pathname.slice(parsed.pathname.lastIndexOf('/') + 1).replace(/\.webp$/i, '');
      parsed.pathname = `${directory}/previews/${filename}.webp`;
      return parsed.href;
    } catch (_) {
      return '';
    }
  }

  async function imageCandidates(url) {
    const source = canonical(url);
    const webp = webpImageUrl(source);
    if (!webp) return [];
    return [{
      url: webp,
      format: /\.webp(?:$|[?#])/i.test(webp) ? 'webp' : 'source',
    }];
  }

  function fetchPriority(priority) {
    if (priority >= P.VISIBLE) return 'high';
    if (priority <= P.PREDICT) return 'low';
    return 'auto';
  }

  function ageBoost(task) {
    const waited = Math.max(0, now() - task.enqueuedAt);
    // Starvation prevention: +1 every 400 ms, capped to +20.
    return Math.min(20, waited / 400);
  }

  function effectivePriority(task) {
    return Number(task.priority || 0) + ageBoost(task);
  }

  function taskCompare(a, b) {
    const pa = effectivePriority(a);
    const pb = effectivePriority(b);
    if (pa !== pb) return pb - pa;
    return a.serial - b.serial;
  }

  function isUrgentWaiting() {
    return queue.some((task) => !task.cancelled && effectivePriority(task) >= P.VISIBLE);
  }

  function runtimeMax() {
    return codeCritical ? Math.min(3, budget.max) : budget.max;
  }

  function canStart(task) {
    if (!task || task.cancelled) return false;
    const p = effectivePriority(task);
    const max = runtimeMax();
    if (active.size >= max) return false;
    if (p >= P.VISIBLE) return true;
    if (now() < criticalUntil) return false;
    if (!budget.background && p < P.NEAR) return false;
    if (isUrgentWaiting()) return false;
    // Keep one physical connection free for a future intent request.
    return active.size < Math.max(1, max - budget.reserve);
  }

  function preemptFor(priority) {
    if (priority < P.INTENT || active.size < runtimeMax()) return;
    let victim = null;
    for (const task of active) {
      if (task.nonPreemptible || task.pinned || task.priority >= P.VISIBLE) continue;
      if (!victim || task.priority < victim.priority) victim = task;
    }
    if (!victim) return;
    victim.requeueAfterAbort = true;
    victim.controller?.abort('westo-preempt');
  }

  function schedulePump() {
    Promise.resolve().then(pump);
  }

  function pump() {
    queue.sort(taskCompare);
    let safety = 0;
    const max = runtimeMax();
    while (active.size < max && queue.length && safety++ < 1000) {
      let index = queue.findIndex((task) => canStart(task));
      if (index < 0) break;
      const task = queue.splice(index, 1)[0];
      if (!task || task.cancelled || task.status !== 'queued') continue;
      startTask(task);
      queue.sort(taskCompare);
    }
  }

  async function startTask(task) {
    task.status = 'active';
    task.startedAt = now();
    task.controller = new AbortController();
    active.add(task);
    metrics.started += 1;
    metrics.maxActive = Math.max(metrics.maxActive, active.size);
    emit('start', { url: task.url, priority: task.priority, group: task.group, kind: task.kind });

    const init = {
      method: 'GET',
      credentials: 'same-origin',
      cache: task.cache || 'default',
      signal: task.controller.signal,
    };
    // Chromium supports Fetch Priority; other browsers ignore the option.
    try { init.priority = fetchPriority(task.priority); } catch (_) {}

    try {
      const response = await fetch(task.url, init);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      if (task.cancelled) throw new DOMException('Cancelled', 'AbortError');
      // Images are delivered by their canonical HTTP URL after the scheduler's
      // fetch has populated the browser cache. The old all-blob strategy kept
      // every image Blob + object URL alive and made DOM image swaps show up as
      // a major CPU/memory cost. Audio still needs raw bytes for WebAudio.
      const needsBlobDelivery = task.kind === 'audio';
      const objectUrl = needsBlobDelivery ? URL.createObjectURL(blob) : '';
      const deliveryUrl = objectUrl || task.url;
      task.status = 'ready';
      task.blob = needsBlobDelivery ? blob : null;
      task.objectUrl = objectUrl;
      task.deliveryUrl = deliveryUrl;
      if (objectUrl) {
        task.objectUrls ||= new Set();
        task.objectUrls.add(objectUrl);
      }
      task.size = blob.size || 0;
      task.completedAt = now();
      task.controller = null;
      metrics.completed += 1;
      metrics.bytes += task.size;
      task.resolve({
        url: deliveryUrl,
        source: task.url,
        blob: needsBlobDelivery ? blob : null,
        size: task.size,
        fromScheduler: true,
        cachePrimed: !needsBlobDelivery,
      });
      emit('ready', {
        url: task.url,
        priority: task.priority,
        group: task.group,
        kind: task.kind,
        size: task.size,
        queueMs: task.startedAt - task.enqueuedAt,
        networkMs: task.completedAt - task.startedAt,
      });
    } catch (error) {
      const aborted = error?.name === 'AbortError' || task.controller?.signal?.aborted;
      task.controller = null;
      if (aborted && task.requeueAfterAbort && !task.cancelled) {
        task.requeueAfterAbort = false;
        task.status = 'queued';
        task.enqueuedAt = now();
        task.priority = Math.min(task.priority, P.PREDICT);
        queue.push(task);
        metrics.aborted += 1;
        emit('preempted', { url: task.url, group: task.group });
      } else if (aborted) {
        task.status = 'cancelled';
        metrics.aborted += 1;
        task.reject(error);
      } else {
        task.status = 'failed';
        task.error = error;
        metrics.failed += 1;
        records.delete(task.key);
        task.reject(error);
        emit('error', { url: task.url, group: task.group, message: String(error?.message || error) });
      }
    } finally {
      active.delete(task);
      schedulePump();
    }
  }

  function requestBlob(url, options = {}) {
    const source = String(url || '').trim();
    if (!source) return Promise.reject(new Error('empty resource URL'));
    const key = canonical(source);
    const priority = Number(options.priority ?? P.NEAR);
    const group = String(options.group || 'generic');
    const kind = String(options.kind || 'image');

    let task = records.get(key);
    if (task) {
      metrics.deduped += 1;
      if (options.pinned) {
        task.pinned = true;
        task.nonPreemptible = true;
      }
      if (task.status === 'ready' && task.objectUrl) {
        metrics.cacheHits += 1;
        task.lastUsedAt = now();
        return Promise.resolve({
          url: task.objectUrl,
          source: task.url,
          blob: task.blob,
          size: task.size,
          fromScheduler: true,
          cacheHit: true,
        });
      }
      if (priority > task.priority) {
        task.priority = priority;
        task.group = group || task.group;
        if (task.status === 'active') preemptFor(priority);
        schedulePump();
      }
      return task.promise;
    }

    let resolve;
    let reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    task = {
      key,
      url: key,
      original: source,
      kind,
      priority,
      group,
      epoch: Number(options.epoch ?? focusEpoch),
      status: 'queued',
      serial: serial++,
      enqueuedAt: now(),
      startedAt: 0,
      completedAt: 0,
      controller: null,
      cancelled: false,
      nonPreemptible: Boolean(options.nonPreemptible),
      pinned: Boolean(options.pinned),
      requeueAfterAbort: false,
      cache: options.cache || 'default',
      promise,
      resolve,
      reject,
      blob: null,
      objectUrl: null,
      objectUrls: new Set(),
      size: 0,
    };
    records.set(key, task);
    queue.push(task);
    metrics.queued += 1;
    preemptFor(priority);
    schedulePump();
    emit('queued', { url: key, priority, group, kind });
    return promise;
  }

  async function requestImage(url, options = {}) {
    const logicalSource = canonical(url);
    const candidates = await imageCandidates(url, options);
    let lastError = null;
    for (let index = 0; index < candidates.length; index += 1) {
      const candidate = candidates[index];
      if (!candidate?.url) continue;
      try {
        const result = await requestBlob(candidate.url, {
          ...options,
          kind: 'image',
        });
        resolvedImageSources.set(logicalSource, candidate.url);
        return {
          ...result,
          logicalSource,
          format: candidate.format,
          fallback: index > 0,
        };
      } catch (error) {
        if (error?.name === 'AbortError') throw error;
        lastError = error;
      }
    }
    throw lastError || new Error('image candidates unavailable');
  }

  function requestPreviewImage(url, options = {}) {
    const preview = previewImageUrl(url);
    if (!preview) return Promise.resolve(null);
    return requestImage(preview, {
      ...options,
      priority: Number(options.priority ?? P.CURRENT),
      group: options.group || 'image-preview',
      kind: 'image',
    }).catch(() => null);
  }

  function cancelWhere(predicate, { includeActive = true } = {}) {
    for (const task of queue) {
      if (task.status !== 'queued' || task.pinned || !predicate(task)) continue;
      task.cancelled = true;
      task.status = 'cancelled';
      records.delete(task.key);
      try { task.reject(new DOMException('Cancelled', 'AbortError')); } catch (_) {}
    }
    for (let i = queue.length - 1; i >= 0; i -= 1) {
      if (queue[i].cancelled) queue.splice(i, 1);
    }
    if (includeActive) {
      for (const task of active) {
        if (!predicate(task) || task.nonPreemptible || task.pinned) continue;
        task.cancelled = true;
        records.delete(task.key);
        task.controller?.abort('westo-cancel');
      }
    }
    schedulePump();
  }

  function pauseBackground(ms = 900) {
    criticalUntil = Math.max(criticalUntil, now() + Math.max(0, ms));
    setTimeout(schedulePump, Math.max(0, ms) + 10);
  }

  function decodeObjectUrl(url) {
    if (!url) return Promise.resolve(false);
    if (decodePromises.has(url)) return decodePromises.get(url);
    const promise = new Promise((resolve) => {
      const probe = new Image();
      probe.decoding = 'async';
      probe.onload = () => resolve(true);
      probe.onerror = () => resolve(false);
      probe.src = url;
      if (typeof probe.decode === 'function') {
        probe.decode().then(() => resolve(true)).catch(() => {});
      }
    });
    decodePromises.set(url, promise);
    return promise;
  }

  async function setElementSource(img, result, original, token, decode) {
    if (!img || imageBindings.get(img) !== token) return false;
    // Decode off-DOM first so the currently visible image is not replaced by an
    // empty frame while the browser decodes the selected category's asset.
    if (decode) await decodeObjectUrl(result.url);
    if (imageBindings.get(img) !== token) return false;
    // `expectedSource` may be stamped before an async fetch starts. `appliedSource`
    // is the only authoritative proof that the pixels currently assigned to this
    // DOM image belong to the requested menu record. Keeping them separate avoids
    // stale-image false cache hits when a board/rail slot is reused.
    img.dataset.expectedSource = original;
    img.dataset.appliedSource = original;
    img.dataset.source = original; // compatibility for older callers/debug tooling
    img.dataset.westoManaged = '1';
    delete img.dataset.previewSource;
    delete img.dataset.westoPreview;
    img.src = result.url;
    return true;
  }

  async function setElementPreviewSource(img, result, original, token) {
    if (!img || !result || imageBindings.get(img) !== token) return false;
    if (img.dataset.appliedSource === original) return false;
    if (!(await decodeObjectUrl(result.url)) || imageBindings.get(img) !== token) return false;
    if (img.dataset.appliedSource === original) return false;
    img.dataset.expectedSource = original;
    img.dataset.source = original;
    img.dataset.previewSource = result.logicalSource || result.source || '';
    img.dataset.westoPreview = '1';
    img.dataset.westoManaged = '1';
    img.src = result.url;
    metrics.previewed += 1;
    emit('preview-ready', { url: original, preview: result.source || result.url });
    return true;
  }

  function bindImage(img, url, options = {}) {
    if (!img) return Promise.resolve(false);
    const original = String(url || '').trim();
    if (!original) {
      img.removeAttribute('src');
      delete img.dataset.source;
      delete img.dataset.expectedSource;
      delete img.dataset.appliedSource;
      delete img.dataset.previewSource;
      delete img.dataset.westoPreview;
      progressiveBindings.delete(img);
      return Promise.resolve(false);
    }
    // The category/rail state machine calls bindImage defensively. If this exact
    // resource is already decoded and painted, avoid minting a new generation
    // token, Promise chain and off-DOM decode probe. This is a hot interaction
    // path and materially reduces main-thread work on category taps.
    if (
      img.dataset.appliedSource === original &&
      img.dataset.westoManaged === '1' &&
      img.complete &&
      img.naturalWidth > 0
    ) {
      metrics.cacheHits += 1;
      return Promise.resolve(true);
    }
    const token = `${focusEpoch}:${serial++}:${original}`;
    imageBindings.set(img, token);
    img.dataset.expectedSource = original;
    img.decoding = options.decoding || img.decoding || 'async';
    try { img.fetchPriority = fetchPriority(Number(options.priority ?? P.NEAR)); } catch (_) {}
    if (options.loading) img.loading = options.loading;

    return requestImage(original, {
      priority: Number(options.priority ?? P.NEAR),
      group: options.group || 'dom-image',
      kind: options.kind || 'image',
      epoch: options.epoch ?? focusEpoch,
      nonPreemptible: Boolean(options.nonPreemptible),
      pinned: Boolean(options.pinned),
    })
      .then((result) => setElementSource(img, result, original, token, options.decode !== false))
      .catch((error) => {
        if (error?.name !== 'AbortError') {
          // Browser-native fallback keeps the visual functional if scheduler fetch fails.
        if (imageBindings.get(img) === token) {
            img.dataset.expectedSource = original;
            img.dataset.appliedSource = original;
          img.dataset.source = original;
          delete img.dataset.previewSource;
          delete img.dataset.westoPreview;
          img.src = original;
          }
        }
        return false;
      });
  }

  function bindProgressiveImage(img, url, options = {}) {
    if (!img) return Promise.resolve(false);
    const original = String(url || '').trim();
    if (!original || !previewImageUrl(original)) return bindImage(img, original, options);
    const pending = progressiveBindings.get(img);
    if (pending?.source === original) return pending.promise;
    if (
      img.dataset.appliedSource === original &&
      img.dataset.westoManaged === '1' &&
      img.complete &&
      img.naturalWidth > 0
    ) {
      metrics.cacheHits += 1;
      return Promise.resolve(true);
    }

    const token = `${focusEpoch}:${serial++}:progressive:${original}`;
    imageBindings.set(img, token);
    img.dataset.expectedSource = original;
    img.decoding = options.decoding || img.decoding || 'async';
    try { img.fetchPriority = fetchPriority(Number(options.priority ?? P.NEAR)); } catch (_) {}
    if (options.loading) img.loading = options.loading;

    const group = options.group || 'dom-image';
    const previewPriority = Math.max(
      P.CURRENT,
      Number(options.previewPriority ?? P.CURRENT),
    );
    // Queue the small same-photo preview first. The full resource starts at the
    // same time but cannot replace this frame until its own decode completes.
    requestPreviewImage(original, {
      priority: previewPriority,
      group: `${group}:preview`,
      epoch: options.epoch ?? focusEpoch,
    }).then((preview) => setElementPreviewSource(img, preview, original, token)).catch(() => {});

    const fullPromise = requestImage(original, {
      priority: Number(options.priority ?? P.NEAR),
      group,
      kind: options.kind || 'image',
      epoch: options.epoch ?? focusEpoch,
      nonPreemptible: Boolean(options.nonPreemptible),
      pinned: Boolean(options.pinned),
    })
      .then((result) => setElementSource(img, result, original, token, options.decode !== false))
      .then((ok) => {
        if (ok) {
          metrics.promoted += 1;
          emit('preview-promoted', { url: original });
        }
        return ok;
      })
      .catch((error) => {
        if (error?.name !== 'AbortError' && imageBindings.get(img) === token) {
          img.dataset.expectedSource = original;
          img.dataset.appliedSource = original;
          img.dataset.source = original;
          delete img.dataset.previewSource;
          delete img.dataset.westoPreview;
          img.src = original;
        }
        return false;
      });
    progressiveBindings.set(img, { source: original, token, promise: fullPromise });
    fullPromise.finally(() => {
      const latest = progressiveBindings.get(img);
      if (latest?.token === token) progressiveBindings.delete(img);
    });
    return fullPromise;
  }

  function observerKey(root, margin) {
    const id = root ? (root.dataset.westoObserverId ||= `wo${serial++}`) : 'viewport';
    return `${id}|${margin}`;
  }

  function observeImage(img, url, options = {}) {
    if (!img) return;
    const root = options.root || null;
    const rootMargin = options.rootMargin || '320px';
    const key = observerKey(root, rootMargin);
    let pool = observerPools.get(key);
    if (!pool && 'IntersectionObserver' in window) {
      const callbacks = new WeakMap();
      const observer = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const cb = callbacks.get(entry.target);
          if (!cb) continue;
          observer.unobserve(entry.target);
          callbacks.delete(entry.target);
          cb();
        }
      }, { root, rootMargin });
      pool = { observer, callbacks };
      observerPools.set(key, pool);
    }
    if (!pool) {
      bindImage(img, url, options);
      return;
    }
    const expected = String(url || '');
    // Invalidate any older in-flight generation immediately, even before this
    // lazy target becomes intersecting. Otherwise an old request can finish in
    // the gap between category remap and the new observer callback and paint
    // stale dish pixels into a reused rail slot.
    const pendingToken = `${focusEpoch}:${serial++}:observe:${expected}`;
    imageBindings.set(img, pendingToken);
    img.dataset.expectedSource = expected;
    pool.callbacks.set(img, () => bindImage(img, expected, options));
    pool.observer.observe(img);
  }

  function categoryModel(data) {
    const input = data?.menuItems ? data : data?.data || data;
    if (!input || typeof input !== 'object') return null;
    const items = Array.isArray(input.menuItems) ? input.menuItems.filter((x) => x && x.available !== false) : [];
    const cats = Array.isArray(input.siteCategories) && input.siteCategories.length
      ? input.siteCategories
      : (Array.isArray(input.menuCategories) ? input.menuCategories.filter((x) => x && !x.hiddenOnSite) : []);
    const byCategory = new Map();
    for (const item of items) {
      const id = Number(item.categoryId);
      if (!Number.isFinite(id)) continue;
      if (!byCategory.has(id)) byCategory.set(id, []);
      byCategory.get(id).push(item);
    }
    const categories = cats
      .map((cat) => ({ id: Number(cat.id), cover: String(cat.coverImg || '').trim(), raw: cat }))
      .filter((cat) => Number.isFinite(cat.id) && cat.cover);
    return { categories, order: categories.map((c) => c.id), byCategory };
  }

  function registerMenu(data) {
    const model = categoryModel(data);
    if (!model) return false;
    menuModel = model;
    emit('menu-model', { categories: model.order.length, items: Array.from(model.byCategory.values()).reduce((n, a) => n + a.length, 0) });
    return true;
  }

  function categoryIndex(id) {
    if (!menuModel?.order?.length) return -1;
    return menuModel.order.findIndex((x) => Number(x) === Number(id));
  }

  function categoryCover(id) {
    return menuModel?.categories?.find((x) => Number(x.id) === Number(id))?.cover || '';
  }

  function categoryItems(id) {
    return menuModel?.byCategory?.get(Number(id)) || [];
  }

  function warmOne(url, priority, group, epoch = focusEpoch, extra = {}) {
    if (!url) return Promise.resolve(null);
    return requestImage(url, { priority, group, epoch, kind: 'image', ...extra }).catch(() => null);
  }

  function warmCategoryCover(url, priority, group, epoch = focusEpoch) {
    return warmOne(url, priority, group, epoch, { pinned: true, nonPreemptible: true });
  }

  function focusDish(categoryId, slot = 0, reason = 'viewport') {
    if (!menuModel) return;
    const items = categoryItems(categoryId);
    if (!items.length) return;
    currentDishSlot = Math.max(0, Number(slot) || 0);
    const group = `cat:${Number(categoryId)}:focus`;
    pauseBackground(650);
    const picks = [
      [currentDishSlot, P.CRITICAL],
      [currentDishSlot + 1, P.INTENT],
      [currentDishSlot - 1, P.CURRENT],
      [currentDishSlot + 2, P.VISIBLE],
    ];
    for (const [index, priority] of picks) {
      const item = items[index];
      const url = String(item?.img || item?.image || '').trim();
      if (url) warmOne(url, priority, group);
    }
    emit('dish-focus', { categoryId: Number(categoryId), slot: currentDishSlot, reason });
  }

  function focusCategory(categoryId, options = {}) {
    if (!menuModel) return;
    const id = Number(categoryId);
    const index = categoryIndex(id);
    if (index < 0) return;
    const old = currentCategory;
    focusEpoch += 1;
    currentCategory = id;
    currentDishSlot = Math.max(0, Number(options.slot) || 0);
    pauseBackground(options.intentOnly ? 500 : 1100);

    // Cancel old speculative work. Ready blobs remain reusable; queued/in-flight
    // work for the previous category/prediction is interruptible so a fresh tap
    // can immediately reclaim the physical connection budget.
    cancelWhere((task) =>
      (task.group.startsWith('preview:') || task.group.startsWith('predict:')) ||
      (task.group.startsWith('cat:') &&
        !task.group.startsWith(`cat:${id}:`) &&
        task.priority < P.VISIBLE),
    );

    if (old != null && index !== previousCategoryIndex) {
      const oldIndex = categoryIndex(old);
      if (oldIndex >= 0) lastDirection = Math.sign(index - oldIndex) || lastDirection;
    }
    previousCategoryIndex = index;

    const cover = categoryCover(id);
    warmCategoryCover(cover, P.CRITICAL, `cat:${id}:cover`);
    focusDish(id, currentDishSlot, options.reason || 'category');

    const items = categoryItems(id);
    // Rest of selected category is scheduled, but cannot occupy the reserved
    // urgent connection while current/next images are pending.
    items.forEach((item, itemIndex) => {
      if (Math.abs(itemIndex - currentDishSlot) <= 2) return;
      const url = String(item?.img || item?.image || '').trim();
      if (url) warmOne(url, P.NEAR - Math.min(18, itemIndex), `cat:${id}:rest`);
    });

    if (budget.predictive && menuModel.order.length > 1) {
      const predicted = [];
      const add = (offset, p) => {
        const idx = (index + offset + menuModel.order.length) % menuModel.order.length;
        const cid = menuModel.order[idx];
        if (cid === id || predicted.includes(cid)) return;
        predicted.push(cid);
        warmCategoryCover(categoryCover(cid), p, `predict:${id}`);
        const first = categoryItems(cid)[0];
        const firstUrl = String(first?.img || first?.image || '').trim();
        if (firstUrl) warmOne(firstUrl, p - 4, `predict:${id}`);
      };
      // User-direction prediction gets first place; both neighbors remain warm.
      if (lastDirection) add(lastDirection, P.PREDICT + 8);
      add(1, P.PREDICT);
      add(-1, P.PREDICT - 2);
    }
    emit('category-focus', { categoryId: id, index, reason: options.reason || 'unknown', epoch: focusEpoch });
  }

  function previewCategory(categoryId, options = {}) {
    if (!menuModel) return;
    const id = Number(categoryId);
    if (categoryIndex(id) < 0 || id === currentCategory) return;
    const group = `preview:${id}`;
    // Pointer travel across the rail should not accumulate preview downloads.
    // Only the latest hovered/touched category keeps speculative ownership.
    cancelWhere((task) => task.group.startsWith('preview:') && task.group !== group);
    warmCategoryCover(categoryCover(id), P.VISIBLE, group);
    const items = categoryItems(id);
    [0, 1].forEach((index) => {
      const item = items[index];
      const url = String(item?.img || item?.image || '').trim();
      if (url) warmOne(url, index === 0 ? P.NEAR : P.PREDICT + 8, group);
    });
    emit('category-preview', { categoryId: id, reason: options.reason || 'hover' });
  }

  function intentCategory(categoryId, options = {}) {
    focusCategory(categoryId, { ...options, intentOnly: true, reason: options.reason || 'intent' });
  }

  function primeInitial() {
    if (!menuModel?.order?.length) return;
    const initial = Number(window.__westoCategoryOrder?.[0] ?? menuModel.order[0]);
    focusCategory(initial, { reason: 'boot', slot: 0 });
    const index = categoryIndex(initial);
    const visibleRadius = coarse ? 0 : 2;
    for (let d = -visibleRadius; d <= visibleRadius; d += 1) {
      const idx = (index + d + menuModel.order.length) % menuModel.order.length;
      warmCategoryCover(categoryCover(menuModel.order[idx]), d === 0 ? P.CRITICAL : P.VISIBLE, 'hero-visible');
    }
  }

  let backgroundFillStarted = false;
  let backgroundFillComplete = false;

  function startBackgroundFill(reason = 'idle') {
    if (backgroundFillStarted || !menuModel || !budget.background) return Promise.resolve(false);
    backgroundFillStarted = true;
    const work = [];
    // Covers first: they back Hero + Catbar and are pinned for the full session.
    for (const cat of menuModel.categories || []) {
      if (cat.cover) work.push(warmCategoryCover(cat.cover, P.NEAR, 'fill:covers'));
    }
    // Session-prewarm policy: every food gets a tiny same-photo preview first,
    // then its normal WebP resource. The queue remains interruptible, so
    // a tap or scroll always preempts background work. This removes the old
    // 8/24-item cap that made distant categories visibly load on entry.
    const focusIndex = Math.max(0, categoryIndex(currentCategory));
    const ordered = (menuModel.order || []).slice().sort((a, b) => {
      const ai = categoryIndex(a);
      const bi = categoryIndex(b);
      const ad = Math.abs(ai - focusIndex);
      const bd = Math.abs(bi - focusIndex);
      return ad - bd;
    });
    for (const cid of ordered) {
      for (const item of categoryItems(cid)) {
        const url = String(item?.img || item?.image || '').trim();
        if (url) {
          const preview = previewImageUrl(url);
          if (preview) work.push(requestPreviewImage(url, { priority: P.BACKGROUND + 8, group: 'fill:previews', epoch: focusEpoch }));
          work.push(warmOne(url, P.BACKGROUND, 'fill:menu', focusEpoch));
        }
      }
    }

    emit('background-fill-start', { reason, count: work.length });
    return Promise.allSettled(work).then(() => {
      backgroundFillComplete = true;
      emit('background-fill-complete', { reason, records: records.size });
      return true;
    });
  }

  function requestAudio(url, priority = P.BACKGROUND) {
    return requestBlob(url, { priority, group: 'audio', kind: 'audio' });
  }

  function getReadyUrl(url) {
    const logicalSource = canonical(url);
    const task = records.get(resolvedImageSources.get(logicalSource) || logicalSource);
    return task?.status === 'ready' ? (task.deliveryUrl || task.objectUrl || task.url) : '';
  }

  function refreshReadyUrl(url) {
    const logicalSource = canonical(url);
    const task = records.get(resolvedImageSources.get(logicalSource) || logicalSource);
    if (!task || task.status !== 'ready') return '';
    // Image records use stable HTTP cache URLs and do not need object-URL
    // reminting after BFCache/memory pressure.
    if (task.kind !== 'audio') return task.deliveryUrl || task.url || '';
    if (!task.blob) return task.deliveryUrl || task.objectUrl || '';
    // A decoded DOM image can occasionally lose its blob backing across browser
    // memory pressure / BFCache restoration. Re-mint the URL from the already
    // fetched Blob instead of hitting the network again. Keep older URLs alive
    // until real page unload because other Catbar clones may still reference them.
    try {
      const next = URL.createObjectURL(task.blob);
      task.objectUrls ||= new Set();
      task.objectUrls.add(next);
      task.objectUrl = next;
      return next;
    } catch (_) {
      return task.objectUrl || '';
    }
  }

  function detectTransport() {
    try {
      const protocols = performance.getEntriesByType('resource')
        .map((entry) => String(entry.nextHopProtocol || '').toLowerCase());
      if (protocols.some((p) => p === 'h3' || p.includes('quic'))) detectedTransport = 'h3';
      else if (protocols.some((p) => p === 'h2')) detectedTransport = 'h2';
      else if (protocols.some((p) => p.includes('http/1.1') || p === 'http/1.1')) detectedTransport = 'h1';
    } catch (_) {}
  }

  function updateBudget() {
    detectTransport();
    budget = networkBudget();
    schedulePump();
  }
  connection?.addEventListener?.('change', updateBudget);
  window.addEventListener('load', updateBudget, { once: true });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      // Hidden tabs keep only already-active urgent work. Speculative queued work
      // waits until the user returns, preserving battery and mobile radio time.
      criticalUntil = Number.POSITIVE_INFINITY;
    } else {
      criticalUntil = now() + 150;
      schedulePump();
    }
  });

  function cleanupResourceSession() {
    observerPools.forEach((pool) => pool.observer?.disconnect?.());
    for (const task of active) task.controller?.abort?.('westo-pagehide');
    for (const task of records.values()) {
      const urls = task.objectUrls?.size ? task.objectUrls : (task.objectUrl ? [task.objectUrl] : []);
      for (const objectUrl of urls) {
        try { URL.revokeObjectURL(objectUrl); } catch (_) {}
      }
    }
    records.clear();
    resolvedImageSources.clear();
    queue.length = 0;
    active.clear();
    decodePromises.clear();
  }

  window.addEventListener('pagehide', (event) => {
    // A BFCache page is not dead. Revoking its blob URLs leaves the restored DOM
    // pointing at invalid `blob:` sources (the black category-circle bug).
    if (event.persisted) {
      emit('bfcache-preserve', { records: records.size });
      return;
    }
    cleanupResourceSession();
  });

  window.addEventListener('pageshow', (event) => {
    if (!event.persisted) return;
    criticalUntil = now() + 120;
    // Revalidate any managed image that the browser failed to keep decoded. The
    // scheduler record is still alive, so this path normally performs zero I/O.
    document.querySelectorAll('img[data-westo-managed="1"][data-source]').forEach((img) => {
      if (!img.complete || img.naturalWidth > 0) return;
      bindImage(img, img.dataset.source, {
        priority: img.classList.contains('westo-dish-catbar__thumb') ? P.VISIBLE : P.NEAR,
        group: 'bfcache-heal',
        loading: 'eager',
        decode: true,
        pinned: img.classList.contains('westo-dish-catbar__thumb'),
        nonPreemptible: img.classList.contains('westo-dish-catbar__thumb'),
      });
    });
    schedulePump();
    emit('bfcache-restore', { records: records.size });
  });

  const resources = {
    version: VERSION,
    priorities: P,
    requestBlob,
    requestImage,
    requestPreviewImage,
    requestAudio,
    bindImage,
    bindProgressiveImage,
    observeImage,
    registerMenu,
    primeInitial,
    startBackgroundFill,
    focusCategory,
    previewCategory,
    intentCategory,
    focusDish,
    pauseBackground,
    cancelWhere,
    getReadyUrl,
    refreshReadyUrl,
    setCodeCritical(value) { codeCritical = Boolean(value); schedulePump(); },
    get currentCategory() { return currentCategory; },
    get metrics() { return { ...metrics, active: active.size, queuedNow: queue.length, budget: { ...budget }, backgroundFillStarted, backgroundFillComplete }; },
    get model() { return menuModel; },
  };
  window.WestoResources = resources;

  // --- Code/CSS phase loader -------------------------------------------------
  const scriptPromises = new Map();
  const stylePromises = new Map();

  function absoluteKey(src) {
    try { return new URL(src, location.href).href; } catch (_) { return src; }
  }

  function loadScript(src, options = {}) {
    const key = absoluteKey(src);
    if (scriptPromises.has(key)) return scriptPromises.get(key);
    const promise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      if (options.type) script.type = options.type;
      try { script.fetchPriority = options.fetchPriority || 'auto'; } catch (_) {}
      script.dataset.westoSmart = options.marker || '1';
      script.onload = () => resolve(script);
      script.onerror = () => reject(new Error(`script failed: ${src}`));
      document.head.appendChild(script);
    });
    scriptPromises.set(key, promise);
    return promise;
  }

  function loadStyle(href, marker = 'lazy') {
    const key = absoluteKey(href);
    if (stylePromises.has(key)) return stylePromises.get(key);
    const promise = new Promise((resolve, reject) => {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      link.dataset.westoSmartStyle = marker;
      link.onload = () => resolve(link);
      link.onerror = () => reject(new Error(`style failed: ${href}`));
      document.head.appendChild(link);
    });
    stylePromises.set(key, promise);
    return promise;
  }

  function afterPaint() {
    return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }

  function idle(timeout = 2500) {
    return new Promise((resolve) => {
      if ('requestIdleCallback' in window) requestIdleCallback(resolve, { timeout });
      else setTimeout(resolve, Math.min(800, timeout));
    });
  }

  let bootPromise = null;
  let menuPromise = null;
  let heroPromise = null;
  let threePromise = null;
  let liquidPromise = null;
  let webflowPromise = null;

  // A local/static export has no /api route. Keep the server response as the
  // normal source of truth, but let the same public bootstrap payload start
  // the experience when index.html is opened directly from disk.
  async function loadContentBootstrap() {
    if (window.__WESTO_CONTENT__) return window.__WESTO_CONTENT__;

    const staticSource = `js/content-bootstrap.static.js?v=${STATIC_BOOTSTRAP_VERSION}`;
    const localFile = location.protocol === 'file:';

    if (localFile) {
      await loadScript(staticSource, { marker: 'bootstrap-static', fetchPriority: 'high' });
    } else {
      try {
        await loadScript('/api/content-bootstrap.js', { marker: 'bootstrap', fetchPriority: 'high' });
      } catch (apiError) {
        // This makes a copied static export recover gracefully from a missing
        // API route without masking the normal server-first path.
        console.warn('[westo-smart-loader] API bootstrap unavailable; using static fallback', apiError);
        await loadScript(staticSource, { marker: 'bootstrap-static', fetchPriority: 'high' });
      }
    }

    const payload = window.__WESTO_CONTENT__ || window.__WESTO_STATIC_CONTENT__;
    if (!payload) throw new Error('content bootstrap did not provide a public payload');
    window.__WESTO_CONTENT__ = payload;
    return payload;
  }

  async function boot() {
    if (bootPromise) return bootPromise;
    bootPromise = (async () => {
      emit('phase', { phase: 'bootstrap' });
      const content = await loadContentBootstrap();
      resources.registerMenu(content?.menu || content);
      resources.primeInitial();

      emit('phase', { phase: 'app-runtime' });
      // One dependency-ordered critical bundle. index.html + 103 Early Hints
      // preload it while bootstrap is in flight, eliminating the previous
      // foundation/motion -> menu/hero network barrier on high-RTT links.
      menuPromise = loadScript(`js/westo-app.smart.js?v=${VERSION}`, { marker: 'app', fetchPriority: 'high' });
      heroPromise = menuPromise;
      await menuPromise;
      resources.setCodeCritical(false);
      emit('phase', { phase: 'menu-hero-ready' });

      await afterPaint();
      scheduleThreeLoad();
      setupBackground();
      return true;
    })().catch((error) => {
      console.error('[westo-smart-loader] boot failed', error);
      emit('error', { scope: 'boot', message: String(error?.message || error) });
      throw error;
    });
    return bootPromise;
  }

  function scheduleThreeLoad() {
    if (threePromise) return;
    const trigger = () => {
      window.removeEventListener('pointerdown', trigger);
      window.removeEventListener('touchstart', trigger);
      window.removeEventListener('scroll', trigger);
      window.removeEventListener('eg-enter-start', trigger);
      loadThree();
    };
    window.addEventListener('pointerdown', trigger, { passive: true, once: true });
    window.addEventListener('touchstart', trigger, { passive: true, once: true });
    window.addEventListener('scroll', trigger, { passive: true, once: true });
    window.addEventListener('eg-enter-start', trigger, { once: true });

    if ('requestIdleCallback' in window) {
      requestIdleCallback(() => loadThree(), { timeout: 1600 });
    } else {
      setTimeout(() => loadThree(), 1200);
    }
  }

  function loadThree() {
    if (threePromise) return threePromise;
    // Give current/next menu images a short exclusive window before the module graph.
    resources.pauseBackground(300);
    threePromise = import(`./three-scene.js?v=${VERSION}`)
      .then((mod) => {
        emit('phase', { phase: 'three-ready' });
        return mod;
      })
      .catch((error) => {
        console.warn('[westo-smart-loader] Three unavailable', error);
        return null;
      });
    return threePromise;
  }

  function loadLiquid() {
    // v13.4: active dish identity is carried by the rail card state, not a cyan
    // shader ring around the food thumbnail. Keep the module out of the critical
    // path entirely; glass language remains owned by the surrounding rail/card.
    if (!liquidPromise) liquidPromise = Promise.resolve(null);
    return liquidPromise;
  }

  function loadWebflow(reason = 'near-viewport') {
    if (webflowPromise) return webflowPromise;
    webflowPromise = loadScript('js/vendor/jquery-3.5.1.min.js', { marker: 'jquery', fetchPriority: 'low' })
      .then(() => loadScript('js/vendor/webflow.9a82b613.50fbdd53e3da9960.js', { marker: 'webflow', fetchPriority: 'low' }))
      .then((value) => {
        emit('phase', { phase: 'webflow-ready', reason });
        return value;
      })
      .catch((error) => {
        console.warn('[westo-smart-loader] webflow failed', error);
        return null;
      });
    return webflowPromise;
  }

  function setupBackground() {
    // Auth/analytics can never compete with first menu interaction.
    const start = async () => {
      await idle(650);
      if (isUrgentWaiting()) await idle(350);
      resources.startBackgroundFill('browser-idle').catch(() => {});
      await idle(900);
      loadScript(`js/westo-background.smart.js?v=${VERSION}`, { marker: 'background', fetchPriority: 'low' }).catch(() => {});
    };
    if (document.readyState === 'complete') start();
    else window.addEventListener('load', start, { once: true });

    // Liquid is needed only when the menu UI is entered. Begin on actual intent.
    window.addEventListener('westo:enter-intent', () => loadLiquid(), { once: true });
    window.addEventListener('westo:entered', () => loadLiquid(), { once: true });

    // Webflow/newsletter are lower-page features: load close to viewport, never at boot.
    const targets = [document.querySelector('section.is-faq'), document.getElementById('newsletter')].filter(Boolean);
    if ('IntersectionObserver' in window && targets.length) {
      const io = new IntersectionObserver((entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        io.disconnect();
        loadWebflow('near-lower-page');
        if (document.getElementById('newsletter')) loadStyle(`css/sib-styles.css?v=${VERSION}`, 'newsletter').catch(() => {});
      }, { rootMargin: '1400px 0px' });
      targets.forEach((target) => io.observe(target));
    } else {
      window.addEventListener('load', () => idle(5000).then(() => loadWebflow('fallback-idle')), { once: true });
    }
  }

  window.WestoSmartLoad = {
    version: VERSION,
    boot,
    loadThree,
    loadLiquid,
    loadWebflow,
    resources,
  };

  // Run after this defer script executes; dynamic children do not block DCL.
  if (!window.__WESTO_SMART_TEST_NO_BOOT__) Promise.resolve().then(boot);
})();
