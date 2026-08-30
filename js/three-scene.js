
  import Lenis from './vendor/lenis.mjs?v=clean1';
  // Keep one canonical Three module URL across the whole graph. The previous
  // import-map query alias and the postprocessing bundle's relative import
  // created two browser module identities and downloaded/parsed Three twice.
  import * as THREE from './vendor/three/three.module.js';

async function bootScene() {

  // #region Helpers

  // Half-open modular wrap — keeps min inclusive / max exclusive so
  // cans[0] and cans[N/2] never share the same world X (hero collision).
  const wrap = (value, min, max) => {
    const size = max - min;
    if (size <= 0) return min;
    let t = (value - min) % size;
    if (t < 0) t += size;
    if (t >= size) t = 0;
    return t + min;
  };

  const clamp = (value, min, max) => {
    return Math.min(Math.max(value, min), max);
  };

  const lerp = (a, b, t) => {
    return a + (b - a) * t;
  };

  const round = (value, step) => {
    return Math.round(value / step) * step;
  };

  const toArray = (item) => {
    if (Array.isArray(item)) return item;
    if (item instanceof NodeList || item instanceof HTMLCollection) return Array.from(item);
    else return [item];
  };

  const on = (els, events, callback) => {
    if (typeof els === 'string' || els instanceof String) {
      els = document.querySelectorAll(els);
    }
    toArray(els).forEach((el, i) => {
      events.split(' ').forEach((event) => {
        if (typeof el === 'object' && el.hasOwnProperty(event) && el[event].connect) el[event].connect(callback);
        else el.addEventListener(event, callback);
      });
    });
  };
  const signal = () => {
    const callbacks = [];
    const connect = (callback) => callbacks.push(callback);
    const disconnect = (callback) => callbacks.splice(callbacks.indexOf(callback), 1);
    const emit = (data) => callbacks.forEach((callback) => callback(data));
    return { connect, disconnect, emit };
  };

  function debounce(callback, limit, isImmediate = false) {
    var timeout;
    return function () {
      var context = this,
        args = arguments;
      var later = function () {
        timeout = null;
        if (!isImmediate) callback.apply(context, args);
      };
      var callNow = isImmediate && !timeout;
      clearTimeout(timeout);
      timeout = setTimeout(later, limit);
      if (callNow) callback.apply(context, args);
    };
  }

  const closest = (items, goal, map, check) => {
    let dist = Infinity;
    let index = -1;
    if (!check) check = (goal, value, dist) => Math.abs(value - goal) < Math.abs(dist - goal);
    items.forEach((value, i) => {
      if (map) {
        value = map(value);
      }
      if (check(goal, value, dist)) {
        dist = value;
        index = i;
      }
    });
    return {
      diff: Math.abs(goal - dist),
      index,
    };
  };

  // #endregion Helpers
  // #region Device Profile

  const saveData = Boolean(navigator.connection?.saveData);
  const coarsePointer = Boolean(
    window.matchMedia?.('(pointer: coarse)')?.matches,
  );
  const hwTight = (navigator.hardwareConcurrency || 8) <= 4;
  const perfProfile = window.westoPerformance;
  const initialPerfTier = perfProfile?.tier || 'balanced';
  const initialQuality = perfProfile?.quality || {
    maxDpr: 1.25,
    textureSize: 640,
  };
  // Phones/tablets + weak CPUs + Save-Data: cheaper GPU path (no HalfFloat/SMAA).
  const lowPower =
    initialPerfTier !== 'premium' ||
    saveData ||
    hwTight ||
    (coarsePointer && window.innerWidth < 1280);
  const isTouchDevice = coarsePointer || window.innerWidth < 992;
  const lenis = new Lenis({
    autoRaf: false,
    infinite: false,
    // Mobile/touch devices or economy: use native browser touch momentum scrolling.
    // Keeping Lenis as the scroll API preserves programmatic scrollTo() calls without spending CPU
    // interpolating every user scroll frame on low-tier devices.
    smoothWheel: !isTouchDevice && initialPerfTier !== 'economy',
    syncTouch: !isTouchDevice && initialPerfTier === 'premium',
  });

  window.lenis = lenis;
  // Cached — creating a fresh MediaQueryList every render frame showed in profiles.
  const reducedMotionQuery = window.matchMedia
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : null;
  const prefersReducedMotion = () => Boolean(reducedMotionQuery && reducedMotionQuery.matches);

  // #endregion Setup
  // #region Scroll

  const scroll = {
    position: 0,
  };

  scroll.wrapped = (position) => {
    const max = Math.max(0, lenis.dimensions.scrollHeight - lenis.dimensions.height);
    // Finite page: clamp (do not wrap — wrapping teleports timeline seek)
    return clamp(position, 0, max);
  };

  scroll.to = (pos, options) => {
    if (pos !== 0) pos -= 10;
    lenis.scrollTo(pos, options);
  };

  scroll.distanceTo = (target, position = scroll.position) => {
    return Math.abs(position - target);
  };

  lenis.on('scroll', (e) => {
    scroll.position = scroll.wrapped(lenis.animatedScroll);
  });

  scroll.snap = (position = scroll.position) => {
    if (window.innerWidth < 1024) return;
    const found = closest(section.items, position, (item) => item.top);
    if (found.index >= 0 && section.items[found.index].snap) scroll.to(section.items[found.index].top);
    else if (scroll.distanceTo(section.items[0].top, position) < section.items[0].height / 2) {
      scroll.to(section.items[0].top);
    }
  };

  on(
    window,
    'scroll',
    debounce(() => scroll.snap(), 250),
  );
  on(
    window,
    'scrollend',
    debounce(() => scroll.snap(), 50),
  );

  // #endregion Scroll
  // #region Carousel State

  /* Categories → cans: one texture per site category cover (never drink labels). */
  let canLabels = [];
  let categoryIds = [];
  try {
    const store = window.westoMenuStore ? await window.westoMenuStore.ready : null;
    if (store && store.categoryOrder.length) {
      const ordered = store.categories;
      if (ordered.length) {
        categoryIds = store.categoryOrder.slice();
        canLabels = ordered.map((c) => {
          const cover = String(c.coverImg || '').trim();
          if (!cover || /assets\/textures\/westo_texture_/i.test(cover)) {
            console.error('[westo] category missing coverImg', c?.id, c?.title);
            return '';
          }
          return cover;
        }).filter(Boolean);
        // Keep ids aligned with labels (drop any empty covers defensively).
        if (canLabels.length !== categoryIds.length) {
          const paired = [];
          ordered.forEach((c) => {
            const cover = String(c.coverImg || '').trim();
            if (cover && !/assets\/textures\/westo_texture_/i.test(cover)) {
              paired.push({ id: Number(c.id), cover });
            }
          });
          categoryIds = paired.map((p) => p.id);
          canLabels = paired.map((p) => p.cover);
        }
      }
    }
  } catch (e) {
    console.warn('[westo] menu textures unavailable', e);
  }

  if (!canLabels.length) {
    console.error('[westo] no category covers — hero plates disabled');
  }

  window.__westoCategoryOrder = categoryIds.slice();
  window.__westoCanLabels = canLabels.slice();

  const cans = [];

  // Always center the active plate at x=0. The old odd-count offset (1.5)
  // was a drink-era hack that shifts food plates off-center whenever
  // category count is odd (e.g. 13 after adding ماچا بار).
  const carOffset = 0;
  let carousel = {
    spacing: 4.35,
    target: 0,
    position: 0,
    index: 0,
    lastIndex: 0,
    lastPosition: 0,
    delta: 0,
    offset: carOffset,
  };

  /** Fold carousel phase into one category period to avoid unbounded drift. */
  const categoryPeriod = () => Math.max(1, canLabels.length) * carousel.spacing;

  const normalizeCarouselPhase = (foldPosition = false) => {
    const period = categoryPeriod();
    if (period <= 0) return;
    const foldNear = (value, near) => {
      let t = ((carousel.getRounded(value) % period) + period) % period;
      while (t - near > period * 0.5) t -= period;
      while (near - t > period * 0.5) t += period;
      return t;
    };
    carousel.target = foldNear(carousel.target, carousel.position);
    if (foldPosition) {
      const delta = carousel.position - carousel.target;
      carousel.target = ((carousel.target % period) + period) % period;
      carousel.position = carousel.target + delta;
    }
  };

  carousel.getRounded = (value = carousel.target) => {
    return round(value + carousel.offset, carousel.spacing) - carousel.offset;
  };

  carousel.getIndex = (wrapped = true) => {
    const index = round((carousel.position + carousel.offset) / carousel.spacing, 1);
    if (wrapped) return wrap(index, 0, Math.max(1, canLabels.length));
    return index;
  };

  /** Keep carousel.index + title listeners aligned with the visible plate. */
  const syncCarouselIndex = (force = false) => {
    const index = carousel.getIndex(true);
    const previous = carousel.lastIndex;
    carousel.index = index;
    if (force || index !== previous) {
      carousel.lastIndex = index;
      carousel.changed.emit({ index, previous });
    }
  };

  carousel.goTo = (index, { immediate = false } = {}) => {
    const count = Math.max(1, canLabels.length);
    const wrapped = ((Math.round(index) % count) + count) % count;
    const target = wrapped * carousel.spacing - carousel.offset;
    carousel.target = target;
    normalizeCarouselPhase();
    if (immediate) {
      carousel.position = carousel.target;
      syncCarouselIndex(true);
      if (typeof window.westoRenderWake === 'function') window.westoRenderWake();
    }
  };

  carousel.previous = () => {
    carousel.goTo(carousel.getIndex(false) - 1);
  };

  carousel.next = () => {
    carousel.goTo(carousel.getIndex(false) + 1);
  };

  carousel.changed = signal();
  carousel.indexChanged = carousel.changed;

  window.carousel = carousel;

  window.__westoStageDebug = () =>
    cans.map((can, i) => ({
      i,
      visible: can.visible,
      x: +can.position.x.toFixed(2),
      y: +can.position.y.toFixed(2),
      z: +can.position.z.toFixed(2),
      rotY: +((can.rotation.y * 180) / Math.PI).toFixed(1),
      scale: +can.scale.x.toFixed(2),
      opacity: +(can.userData?.plate?.material?.opacity ?? 1).toFixed(2),
    }));

  // Precise screen seats from the live camera — used by the hero→catbar fly.
  window.__westoProjectCan = (index) => {
    const can = cans[index];
    if (!can) return null;
    camera.updateMatrixWorld(true);
    if (camera.updateProjectionMatrix) camera.updateProjectionMatrix();
    const vw = window.innerWidth || 1;
    const vh = window.innerHeight || 1;
    const world = new THREE.Vector3();
    can.getWorldPosition(world);
    const ndc = world.clone().project(camera);
    const cx = (ndc.x * 0.5 + 0.5) * vw;
    const cy = (-ndc.y * 0.5 + 0.5) * vh;
    const plate = can.userData?.plate;
    const geoH = can.userData?.plateSize?.height;
    const worldH = (Number.isFinite(geoH) ? geoH : 3.2) * Math.max(0.2, can.scale.y || can.scale.x || 1);
    const edge = world.clone();
    edge.y += worldH * 0.5;
    const edgeNdc = edge.project(camera);
    const edgeCy = (-edgeNdc.y * 0.5 + 0.5) * vh;
    const size = Math.max(36, Math.abs(cy - edgeCy) * 2);
    const opacity = can.userData?.plate?.material?.opacity ?? 1;
    return {
      i: index,
      categoryId: String(categoryIds[index] ?? can.userData?.categoryId ?? ''),
      cover: canLabels[index] || '',
      visible: Boolean(can.visible),
      opacity: +Number(opacity).toFixed(3),
      cx,
      cy,
      size,
    };
  };

  window.__westoCaptureHeroPlates = () => {
    const seats = [];
    const vw = window.innerWidth || 1;
    for (let i = 0; i < cans.length; i += 1) {
      const seat = window.__westoProjectCan(i);
      if (!seat) continue;
      if (!seat.visible || seat.opacity < 0.45) continue;
      if (!cans[i] || cans[i].scale.x < 0.4) continue;
      if (!seat.categoryId || !seat.cover) continue;
      // Plate center must be clearly on-screen.
      if (seat.cx < seat.size * 0.05 || seat.cx > vw - seat.size * 0.05) continue;
      seats.push(seat);
    }
    seats.sort((a, b) => a.cx - b.cx);
    return seats;
  };

  // Snapshot plates the user can see (visible + meaningful opacity), for
  // caching seats BEFORE dish scroll collapses canScale.
  window.__westoSnapshotAllHeroPlates = () => {
    const seats = [];
    const vw = window.innerWidth || 1;
    for (let i = 0; i < cans.length; i += 1) {
      const can = cans[i];
      if (!can || can.scale.x < 0.28) continue;
      const seat = window.__westoProjectCan(i);
      if (!seat?.categoryId || !seat.cover) continue;
      if (!seat.visible || seat.opacity < 0.22) continue;
      // Plate center must be on-screen (no off-stage summons).
      if (seat.cx < 0 || seat.cx > vw) continue;
      seats.push({ ...seat });
    }
    seats.sort((a, b) => a.cx - b.cx);
    return seats;
  };

  // Instantly tuck WebGL plates under DOM fly clones (no fade — clones already cover).
  window.__westoHideHeroPlatesForFly = (hide) => {
    for (let i = 0; i < cans.length; i += 1) {
      const can = cans[i];
      if (!can) continue;
      if (hide) {
        if (can.userData._flyPrevVisible == null) {
          can.userData._flyPrevVisible = can.visible;
          can.userData._flyPrevPlateOp = can.userData?.plate?.material?.opacity;
        }
        can.visible = false;
        if (can.userData?.plate?.material) can.userData.plate.material.opacity = 0;
        if (can.userData?.shadow) can.userData.shadow.visible = false;
        if (can.userData?.halo) can.userData.halo.visible = false;
      } else if (can.userData._flyPrevVisible != null) {
        can.visible = Boolean(can.userData._flyPrevVisible);
        if (can.userData?.plate?.material && can.userData._flyPrevPlateOp != null) {
          can.userData.plate.material.opacity = can.userData._flyPrevPlateOp;
        }
        delete can.userData._flyPrevVisible;
        delete can.userData._flyPrevPlateOp;
      }
    }
  };

  // Screen center of the hero stage (active plate / camera look), for synthetic fan seats.
  window.__westoHeroCenterScreen = () => {
    const active =
      typeof window.carousel?.getIndex === 'function'
        ? window.carousel.getIndex(true)
        : typeof window.carousel?.index === 'number'
          ? window.carousel.index
          : 0;
    const projected = window.__westoProjectCan(active);
    if (projected && Number.isFinite(projected.cx) && Number.isFinite(projected.cy)) {
      return {
        cx: projected.cx,
        cy: projected.cy,
        size: projected.size || Math.min(window.innerHeight * 0.42, 320),
      };
    }
    return {
      cx: (window.innerWidth || 1) * 0.5,
      cy: (window.innerHeight || 1) * 0.42,
      size: Math.min((window.innerHeight || 1) * 0.42, 320),
    };
  };

  // #endregion Carousel State
  // #region Camera

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(20, window.innerWidth / window.innerHeight, 0.1, 1000);

  // #endregion Camera
  // #region Renderer

  const mainEl = document.querySelector('main');
  // SMAA (desktop) replaces MSAA — avoid paying for both. Mobile uses neither.
  const renderer = new THREE.WebGLRenderer({
    antialias: false,
    alpha: true,
    powerPreference: lowPower ? 'low-power' : 'high-performance',
  });
  // Cap DPR hard: Retina phones at 2–3× were ~4–9× CSS pixels through the composer.
  let pixelRatio = Math.min(
    window.devicePixelRatio || 1,
    initialQuality.maxDpr || (isTouchDevice ? 1.0 : 1.25),
  );
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(pixelRatio);
  renderer.setClearColor(0x000000, 0);

  THREE.ColorManagement.enabled = true;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  mainEl.appendChild(renderer.domElement);

  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  // Food photos are already bright product shots — keep exposure low so
  // ceramic whites don't blow out under the key lights.
  renderer.toneMappingExposure = 0.88;

  // #endregion Renderer
  // #region Environment

  const pink = new THREE.Color(0xffffff);

  const tint = {
    color: { value: pink },
    strength: { value: 1 },
  };

  const environment = {
    setColor: async (color1, color2) => {
      // UI atmosphere only — food plates stay untinted so photos read natural
      tint.color.value = new THREE.Color(color1);
      document.documentElement.style.setProperty('--tint1', color1);
      if (color2) document.documentElement.style.setProperty('--tint2', color2);
    },
  };
  window.environment = environment;

  // #endregion Environment
  // #region Composers

  // Postprocessing is a premium-desktop enhancement, not a rendering
  // prerequisite. Economy/balanced/mobile render straight to the default
  // framebuffer: no offscreen target, fullscreen OutputPass or postfx module
  // parse. This removes a large GPU bandwidth + memory tax from the common path.
  const postFxCapable = initialPerfTier === 'premium' && !lowPower;
  let postFxEnabled = postFxCapable;
  let finalComposer = null;
  let smaaPass = null;
  if (postFxCapable) {
    const { EffectComposer, RenderPass, SMAAPass, OutputPass } = await import(
      './vendor/three/westo-postprocessing.bundle.mjs?v=release14uf1d28-webp-only'
    );
    const finalRenderTarget = new THREE.WebGLRenderTarget(
      window.innerWidth * pixelRatio,
      window.innerHeight * pixelRatio,
      { type: THREE.HalfFloatType, samples: 0 },
    );
    finalComposer = new EffectComposer(renderer, finalRenderTarget);
    finalComposer.addPass(new RenderPass(scene, camera));
    finalComposer.addPass(new OutputPass());
    smaaPass = new SMAAPass();
    finalComposer.addPass(smaaPass);
    finalComposer.setSize(window.innerWidth, window.innerHeight);
  }

  const presentFrame = () => {
    if (postFxEnabled && finalComposer) finalComposer.render();
    else renderer.render(scene, camera);
  };

  const applyRuntimePerformanceTier = (event) => {
    const tier = event?.detail?.tier || window.westoPerformance?.tier || initialPerfTier;
    const quality = event?.detail?.quality || window.westoPerformance?.quality || initialQuality;
    const nextPixelRatio = Math.min(window.devicePixelRatio || 1, quality.maxDpr || pixelRatio);
    if (Math.abs(nextPixelRatio - pixelRatio) > 0.01) {
      pixelRatio = nextPixelRatio;
      renderer.setPixelRatio(pixelRatio);
      // Keep both the drawing buffer and the canvas CSS box in sync. Passing
      // false here left the canvas visually stuck at the previous breakpoint
      // after live resize, stretching and offsetting the food plate.
      renderer.setSize(window.innerWidth, window.innerHeight, true);
      if (finalComposer) {
        finalComposer.setPixelRatio(pixelRatio);
        finalComposer.setSize(window.innerWidth, window.innerHeight);
      }
    }
    postFxEnabled = postFxCapable && tier === 'premium';
    if (smaaPass) smaaPass.enabled = postFxEnabled;
    window.__westoThreeQuality = { tier, pixelRatio, postFx: postFxEnabled };
  };
  window.addEventListener('westo:performance-tier', applyRuntimePerformanceTier);
  window.__westoThreeQuality = { tier: initialPerfTier, pixelRatio, postFx: postFxEnabled };

  // #endregion Composers
  // #region Cans → normalized food photos (legacy metal base removed)

  const isDesktopStage = () => window.innerWidth >= 992;

  // Soft elliptical shadow / halo — shared, tiny GPU cost
  let softShadowTexture = null;
  const getSoftShadowTexture = () => {
    if (softShadowTexture) return softShadowTexture;
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createRadialGradient(64, 72, 4, 64, 64, 60);
    grad.addColorStop(0, 'rgba(0,0,0,0.62)');
    grad.addColorStop(0.35, 'rgba(0,0,0,0.28)');
    grad.addColorStop(0.7, 'rgba(0,0,0,0.08)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 128, 128);
    softShadowTexture = new THREE.CanvasTexture(canvas);
    softShadowTexture.colorSpace = THREE.SRGBColorSpace;
    return softShadowTexture;
  };

  let softHaloTexture = null;
  const getSoftHaloTexture = () => {
    if (softHaloTexture) return softHaloTexture;
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createRadialGradient(64, 58, 8, 64, 64, 64);
    grad.addColorStop(0, 'rgba(255,244,220,0.38)');
    grad.addColorStop(0.4, 'rgba(255,236,200,0.12)');
    grad.addColorStop(1, 'rgba(255,236,200,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 128, 128);
    softHaloTexture = new THREE.CanvasTexture(canvas);
    softHaloTexture.colorSpace = THREE.SRGBColorSpace;
    return softHaloTexture;
  };

  // Round opaque product frames so they don't read as hard squares on black
  const roundFrameTexture = (texture, radiusRatio = 0.08) => {
    const src = texture.image;
    if (!src) return texture;
    const w = src.naturalWidth || src.width || 512;
    const h = src.naturalHeight || src.height || 512;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    const r = Math.min(w, h) * radiusRatio;
    ctx.beginPath();
    ctx.moveTo(r, 0);
    ctx.arcTo(w, 0, w, h, r);
    ctx.arcTo(w, h, 0, h, r);
    ctx.arcTo(0, h, 0, 0, r);
    ctx.arcTo(0, 0, w, 0, r);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(src, 0, 0, w, h);
    const rounded = new THREE.CanvasTexture(canvas);
    rounded.colorSpace = THREE.SRGBColorSpace;
    rounded.anisotropy = texture.anisotropy;
    rounded.generateMipmaps = initialPerfTier !== 'economy';
    rounded.minFilter = initialPerfTier === 'economy' ? THREE.LinearFilter : THREE.LinearMipmapLinearFilter;
    rounded.magFilter = THREE.LinearFilter;
    // Preserve ownership metadata so disposeCanGroup() can release this
    // replacement texture exactly like TextureLoader-owned plate textures.
    Object.assign(rounded.userData, texture.userData || {}, {
      westoOwned: true,
      westoRoundedFrame: true,
    });
    rounded.needsUpdate = true;
    texture.dispose?.();
    return rounded;
  };

  // Ultra Fine v1.2 desktop stage: the prior fixed 1.34/0.84 scales ignored
  // both viewport height and each category photo aspect ratio. On wide/short
  // customer screens this let the active plate and second-neighbor flock invade
  // the title/copy band. Keep the original carousel/state machine, but use a
  // calmer three-plate composition and apply an aspect-aware fit cap below.
  const sampleDesktopStage = (slot) => {
    const s = Math.abs(slot);
    const sign = slot < 0 ? -1 : slot > 0 ? 1 : 0;
    if (s >= 1.72) {
      return {
        visible: false,
        x: sign * 5.35,
        y: 0.20,
        z: -2.45,
        scale: 0.42,
        rotY: sign * 0.16,
        rotX: -0.025,
        opacity: 1,
      };
    }
    const compact = clamp((960 - (window.innerHeight || 900)) / 260, 0, 1);
    const keys = [
      { s: 0, x: 0, y: lerp(0.48, 0.66, compact), z: 0.34, scale: lerp(1.10, 0.98, compact), rotY: 0, rotX: -0.03, opacity: 1 },
      { s: 1, x: 3.78, y: lerp(0.22, 0.34, compact), z: -1.42, scale: lerp(0.68, 0.58, compact), rotY: 0.11, rotX: -0.026, opacity: 1 },
      { s: 1.72, x: 5.32, y: 0.20, z: -2.35, scale: 0.42, rotY: 0.16, rotX: -0.02, opacity: 1 },
    ];
    let a = keys[0];
    let b = keys[1];
    for (let i = 0; i < keys.length - 1; i += 1) {
      if (s >= keys[i].s && s <= keys[i + 1].s) {
        a = keys[i];
        b = keys[i + 1];
        break;
      }
    }
    const t = (s - a.s) / Math.max(0.0001, b.s - a.s);
    const ease = t * t * (3 - 2 * t);
    return {
      visible: true,
      x: sign * lerp(a.x, b.x, ease),
      y: lerp(a.y, b.y, ease),
      z: lerp(a.z, b.z, ease),
      scale: lerp(a.scale, b.scale, ease),
      rotY: sign * lerp(a.rotY, b.rotY, ease),
      rotX: lerp(a.rotX, b.rotX, ease),
      opacity: 1,
    };
  };const foodTextureLoader = new THREE.TextureLoader();

  // Menu/category imagery is pre-cut and pre-sized at build time.
  // Keep the Hero texture path deterministic: no Worker, Canvas, blob URL,
  // manifest probe or runtime background-removal step.
  const resolveCanImage = async (image, index = 0) => {
    const scheduler = window.WestoResources;
    if (scheduler?.requestImage) {
      try {
        const result = await scheduler.requestImage(image, {
          priority: index === 0 ? scheduler.priorities.CRITICAL : scheduler.priorities.NEAR,
          group: `three-cover:${index}`,
          kind: 'image',
        });
        if (result?.url) {
          return {
            url: result.url,
            mode: 'cutout',
            prepared: true,
            profile: 'smart-scheduler',
          };
        }
      } catch (_) {}
    }
    return {
      url: image,
      mode: 'cutout',
      prepared: true,
      profile: 'source-cutout',
    };
  };


  const createCan = async (image, index) => {
    const normalized = await resolveCanImage(image, index);
    const textureUrl = normalized?.url || image;
    let texture = await foodTextureLoader.loadAsync(textureUrl);
    texture.colorSpace = THREE.SRGBColorSpace;
    Object.assign(texture.userData, {
      westoOwned: true,
      westoSource: image,
      westoTextureUrl: textureUrl,
      westoPrepared: Boolean(normalized?.prepared),
      westoProfile: normalized?.profile || null,
    });
    const maxAniso = renderer.capabilities.getMaxAnisotropy?.() || 1;
    const anisotropyBudget = initialPerfTier === 'economy' ? 1 : initialPerfTier === 'balanced' ? 2 : 4;
    texture.anisotropy = Math.min(anisotropyBudget, maxAniso);
    texture.generateMipmaps = initialPerfTier !== 'economy';
    texture.minFilter = initialPerfTier === 'economy' ? THREE.LinearFilter : THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.premultiplyAlpha = false;
    texture.needsUpdate = true;

    const isFrame = normalized.mode === 'frame';
    if (isFrame) texture = roundFrameTexture(texture, 0.09);

    const source = texture.image;
    const aspect = (source.naturalWidth || source.width || 1) / Math.max(1, source.naturalHeight || source.height || 1);
    const height = isFrame ? 2.95 : 3.35;
    const width = height * aspect;

    const group = new THREE.Group();
    group.name = `food-plate-${index}`;
    group.userData.categoryIndex = index;
    group.userData.categoryId = categoryIds[index] || null;
    group.userData.imageMode = normalized.mode;
    group.userData.isPlateGroup = true;

    const plate = new THREE.Mesh(
      new THREE.PlaneGeometry(width, height),
      new THREE.MeshBasicMaterial({
        map: texture,
        color: 0xffffff,
        transparent: true,
        opacity: 1,
        alphaTest: isFrame ? 0.02 : 0.015,
        depthWrite: false,
        side: THREE.FrontSide,
        toneMapped: false,
      }),
    );
    plate.userData.isPlate = true;
    plate.renderOrder = 10;
    group.add(plate);

    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(width * (isFrame ? 1.05 : 0.95), height * (isFrame ? 0.34 : 0.3)),
      new THREE.MeshBasicMaterial({
        map: getSoftShadowTexture(),
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    shadow.userData.isShadow = true;
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.set(0, -height * 0.48, 0.02);
    shadow.scale.set(1, 1, 1);
    shadow.renderOrder = 1;
    // Decorative only — must not steal category / enter hits
    shadow.raycast = () => {};
    group.add(shadow);

    const halo = new THREE.Mesh(
      new THREE.PlaneGeometry(width * 1.45, height * 1.45),
      new THREE.MeshBasicMaterial({
        map: getSoftHaloTexture(),
        transparent: true,
        opacity: 0,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    halo.userData.isHalo = true;
    halo.position.z = -0.12;
    halo.renderOrder = 2;
    halo.raycast = () => {};
    group.add(halo);

    group.userData.plate = plate;
    group.userData.plateSize = { width, height };
    group.userData.shadow = shadow;
    group.userData.halo = halo;

    scene.add(group);
    return group;
  };

  const labelCount = canLabels.length;
  const uniqueCans = new Array(labelCount).fill(null);
  const wrapIndexDist = (i, center) => {
    if (labelCount <= 0) return 0;
    const d = Math.abs(((i - center) % labelCount + labelCount) % labelCount);
    return Math.min(d, labelCount - d);
  };

  const createStubCan = (index) => {
    const group = new THREE.Group();
    group.name = `food-plate-stub-${index}`;
    group.userData.categoryIndex = index;
    group.userData.categoryId = categoryIds[index] || null;
    group.userData.isStub = true;
    group.userData.isPlateGroup = true;
    group.visible = false;
    scene.add(group);
    return group;
  };

  const disposeCanGroup = (group) => {
    if (!group) return;
    scene.remove(group);
    group.traverse((child) => {
      if (child.geometry) child.geometry.dispose?.();
      if (child.material) {
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        mats.forEach((m) => {
          if (m.map && m.map.userData?.westoOwned) m.map.dispose?.();
          m.dispose?.();
        });
      }
    });
  };

  const rebuildCanRing = () => {
    // Stable model: exactly N unique cans. No physical duplicates — wrap math
    // uses N*spacing so title index and center texture cannot desync.
    while (cans.length > labelCount) {
      disposeCanGroup(cans.pop());
    }
    for (let i = 0; i < labelCount; i += 1) {
      if (uniqueCans[i] && cans[i] !== uniqueCans[i]) {
        if (cans[i]) disposeCanGroup(cans[i]);
        cans[i] = uniqueCans[i];
      } else if (!cans[i] && uniqueCans[i]) {
        cans[i] = uniqueCans[i];
      } else if (!cans[i]) {
        cans[i] = createStubCan(i);
      }
    }
  };

  const ensureCanLoaded = (index) => {
    if (index < 0 || index >= labelCount) return Promise.resolve(null);
    if (uniqueCans[index]) return Promise.resolve(uniqueCans[index]);
    if (ensureCanLoaded._inflight?.[index]) return ensureCanLoaded._inflight[index];
    ensureCanLoaded._inflight = ensureCanLoaded._inflight || {};
    ensureCanLoaded._inflight[index] = createCan(canLabels[index], index)
      .then((group) => {
        if (uniqueCans[index]) {
          // Race: another load won — dispose orphan.
          disposeCanGroup(group);
          return uniqueCans[index];
        }
        uniqueCans[index] = group;
        rebuildCanRing();
        if (typeof window.westoRenderWake === 'function') window.westoRenderWake();
        return group;
      })
      .finally(() => {
        delete ensureCanLoaded._inflight[index];
      });
    return ensureCanLoaded._inflight[index];
  };

  const preloadNeighbors = (center) => {
    const radius = initialPerfTier === 'economy' ? 1 : 2;
    for (let d = -radius; d <= radius; d += 1) {
      const idx = ((center + d) % labelCount + labelCount) % labelCount;
      ensureCanLoaded(idx);
    }
  };

  // Boot progress: load category plates by ring priority while the entrance gate is up.
  const priorityIdx = [];
  const deferredIdx = [];
  const priorityRadius = initialPerfTier === 'economy' ? 1 : 2;
  for (let i = 0; i < labelCount; i += 1) {
    if (wrapIndexDist(i, 0) <= priorityRadius) priorityIdx.push(i);
    else deferredIdx.push(i);
  }
  deferredIdx.sort((a, b) => wrapIndexDist(a, 0) - wrapIndexDist(b, 0));

  let bootInteractive = false;
  let bootComplete = false;
  let bootBoards = 0;
  let completeResolve = null;
  const completePromise = new Promise((resolve) => {
    completeResolve = resolve;
  });

  const cansLoadedCount = () => uniqueCans.filter(Boolean).length;

  const emitBootProgress = (extra = {}) => {
    const total = Math.max(1, labelCount);
    const cansRatio = cansLoadedCount() / total;
    // Menu API already awaited above; scene chrome ~ready once priority cans exist.
    let ratio = Math.min(
      1,
      0.08 + 0.12 * (bootInteractive ? 1 : cansRatio) + 0.72 * cansRatio + 0.08 * bootBoards,
    );
    if (bootComplete) ratio = 1;
    const detail = {
      ratio,
      cansLoaded: cansLoadedCount(),
      cansTotal: labelCount,
      interactive: bootInteractive,
      complete: bootComplete,
      ...extra,
    };
    window.__westoBootState = detail;
    window.dispatchEvent(new CustomEvent('westo:boot-progress', { detail }));
  };

  const entranceGateEl = document.getElementById('westo-entrance');
  const gateOpen = () =>
    document.documentElement.classList.contains('is-entrance-gate') ||
    Boolean(entranceGateEl && !entranceGateEl.hidden && entranceGateEl.getAttribute('aria-hidden') !== 'true');

  await Promise.all(priorityIdx.map((i) => ensureCanLoaded(i).then(() => emitBootProgress({ phase: 'priority' }))));
  for (let i = 0; i < labelCount; i += 1) {
    if (!cans[i]) cans.push(uniqueCans[i] || createStubCan(i));
  }
  rebuildCanRing();
  bootInteractive = true;
  emitBootProgress({ phase: 'interactive' });

  // Warm remaining plates in priority order. While the gate is visible, keep
  // concurrency up so enter doesn't hitch on stub→texture swaps.
  const bootDeferredIdx =
    initialPerfTier === 'economy'
      ? []
      : initialPerfTier === 'balanced'
        ? deferredIdx.slice(0, 4)
        : deferredIdx;
  const warmRestPromise = (async () => {
    if (!bootDeferredIdx.length) {
      bootComplete = true;
      emitBootProgress({ phase: 'complete' });
      completeResolve?.();
      window.dispatchEvent(new CustomEvent('westo:boot-complete'));
      return;
    }
    // Keep warm soft while gate UI + particles are also running (thermal).
    const concurrency = initialPerfTier === 'premium' && gateOpen() ? 2 : 1;
    let cursor = 0;
    const worker = async () => {
      while (cursor < bootDeferredIdx.length) {
        const idx = bootDeferredIdx[cursor++];
        try {
          await ensureCanLoaded(idx);
        } catch (_) {}
        emitBootProgress({ phase: 'cans' });
        // Yield so gate UI / progress stay responsive
        if (gateOpen()) {
          await new Promise((r) => requestAnimationFrame(r));
        } else if (typeof requestIdleCallback === 'function') {
          await new Promise((r) => requestIdleCallback(r, { timeout: 700 }));
        } else {
          await new Promise((r) => setTimeout(r, 24));
        }
      }
    };
    await Promise.all(Array.from({ length: concurrency }, () => worker()));
    bootComplete = true;
    emitBootProgress({ phase: 'complete' });
    completeResolve?.();
    window.dispatchEvent(new CustomEvent('westo:boot-complete'));
  })();

  window.westoBoot = {
    get interactive() {
      return bootInteractive;
    },
    get complete() {
      return bootComplete;
    },
    get state() {
      return window.__westoBootState || null;
    },
    markBoards(ratio = 1) {
      bootBoards = Math.max(bootBoards, Math.min(1, Number(ratio) || 0));
      emitBootProgress({ phase: 'boards' });
    },
    waitInteractive: () =>
      bootInteractive ? Promise.resolve() : new Promise((r) => {
        const onProg = (e) => {
          if (e.detail?.interactive) {
            window.removeEventListener('westo:boot-progress', onProg);
            r();
          }
        };
        window.addEventListener('westo:boot-progress', onProg);
      }),
    waitComplete: () => completePromise,
    /** Finish as much as possible before revealing the 3D menu (enter CTA). */
    waitForEnter: async (budgetMs = 6000) => {
      const started = performance.now();
      const center = typeof carousel.getIndex === 'function' ? carousel.getIndex(true) : 0;
      const neighborJobs = [];
      const enterRadius = initialPerfTier === 'economy' ? 1 : initialPerfTier === 'balanced' ? 2 : 3;
      for (let d = -enterRadius; d <= enterRadius; d += 1) {
        const idx = ((center + d) % labelCount + labelCount) % labelCount;
        neighborJobs.push(ensureCanLoaded(idx));
      }
      await Promise.race([
        Promise.all(neighborJobs),
        new Promise((r) => setTimeout(r, Math.min(1800, budgetMs))),
      ]);
      const left = Math.max(0, budgetMs - (performance.now() - started));
      if (initialPerfTier !== 'economy' && !bootComplete && left > 120) {
        await Promise.race([warmRestPromise, new Promise((r) => setTimeout(r, left))]);
      }
      emitBootProgress({ phase: 'enter-wait' });
    },
  };

  // If dish boards already painted (table-cart raced ahead), count them now.
  if (document.querySelector('section.is-benefits [data-menu-name]')?.textContent?.trim()) {
    bootBoards = Math.max(bootBoards, 1);
    emitBootProgress({ phase: 'boards-existing' });
  }

  on(carousel, 'changed', ({ index }) => preloadNeighbors(typeof index === 'number' ? index : 0));

  // Soften hero taste pose so plates face the guest more naturally
  // (applied via timeline data defaults already; minor scale bump in render via canScale)

  // #endregion Cans
  // #region Raycaster

  const raycast = new THREE.Raycaster();
  const isUiChromeClick = (e) =>
    Boolean(
      e.target?.closest?.(
        '.carousel_arrow, .carousel_nav, .carousel_pagination, .navbar, .hud, .westo-scroll-hint--mobile, .westo-scroll-hint--mobile-right, .scroll_discover, .icon-scroll_wrapper, [data-menu-open], .westo-back-categories, .table-drawer, .table-fab, #westo-dish-catbar, .benefits_nav.is-menu-rail, .westo-prod-hero-cats, .westo-prod-hero-cat, .westo-v12-hero-rail, .westo-v12-hero-dot',
      ),
    );

  const isDishRailGesture = (e) =>
    Boolean(e.target?.closest?.('.benefits_nav.is-menu-rail, #westo-dish-catbar'));

  const pickPlateHit = (mouse) => {
    raycast.setFromCamera(mouse, camera);
    let best = null;
    for (let i = 0; i < cans.length; i += 1) {
      const can = cans[i];
      if (!can?.visible) continue;
      const plate = can.userData?.plate;
      if (!plate?.visible) continue;
      const hits = raycast.intersectObject(plate, false);
      if (!hits.length) continue;
      const hit = hits[0];
      if (!best || hit.distance < best.distance) {
        best = { distance: hit.distance, can, i };
      }
    }
    return best;
  };

  const enterActiveCategory = (afterHero) => {
    scroll.to(afterHero.top, {
      duration: 0.75,
      easing: (t) => 1 - Math.pow(1 - t, 3),
    });
  };

  on(window, 'click', (e) => {
    const afterHero = section.afterHero?.() || section.items[1];
    if (pointer.prevent || swipe.direction != 0 || !afterHero || scroll.position > afterHero.top) return;
    if (Date.now() < swipe.suppressClickUntil) return;
    // Arrows / chrome already own their clicks
    if (isUiChromeClick(e)) return;

    const w = Math.max(1, window.innerWidth || renderer.domElement.clientWidth);
    const nx = e.clientX / w;

    // Side lanes mirror prev/next triggers (neighbors + empty margins)
    // so the large center plate cannot "steal" side clicks.
    const sideLane = isDesktopStage() ? 0.3 : 0.26;
    if (nx < sideLane) {
      e.preventDefault();
      e.stopPropagation();
      carousel.previous();
      return;
    }
    if (nx > 1 - sideLane) {
      e.preventDefault();
      e.stopPropagation();
      carousel.next();
      return;
    }

    const mouse = new THREE.Vector2();
    const cw = Math.max(1, renderer.domElement.clientWidth);
    const ch = Math.max(1, renderer.domElement.clientHeight);
    mouse.x = (e.clientX / cw) * 2 - 1;
    mouse.y = -(e.clientY / ch) * 2 + 1;

    const hit = pickPlateHit(mouse);
    if (!hit) return;

    e.preventDefault();
    e.stopPropagation();

    // Spatial side of the plate (not categoryIndex — ring duplicates share ids)
    const x = hit.can.position.x;
    const enterSlack = isDesktopStage() ? 0.9 : 0.7;
    if (Math.abs(x) <= enterSlack) {
      enterActiveCategory(afterHero);
      return;
    }
    if (x > 0) carousel.next();
    else carousel.previous();
  });

  // #endregion Raycaster
  // #region Cursor

  const isOnDishBoards = () => document.documentElement.classList.contains('is-dish-boards');

  // Hero category carousel only — never while reading dish boards.
  // Dish UI can flip on before scroll reaches afterHero.top (crossingIntoDishes),
  // so a class check is required in addition to scroll position.
  const isInGamme = () => {
    if (isOnDishBoards()) return false;
    const afterHero = section.afterHero?.() || section.items[1];
    return !afterHero || scroll.position < afterHero.top;
  };

  on(window, 'mousemove', (e) => {
    if (!isInGamme()) {
      document.body.style.cursor = '';
      return;
    }

    if (swipe.holding && swipe.direction === 1) {
      document.body.style.cursor = 'grabbing';
      return;
    }

    const w = Math.max(1, window.innerWidth || renderer.domElement.clientWidth);
    const nx = e.clientX / w;
    const sideLane = isDesktopStage() ? 0.3 : 0.26;
    if (nx < sideLane || nx > 1 - sideLane) {
      document.body.style.cursor = 'pointer';
      return;
    }

    const mouse = new THREE.Vector2();
    const cw = Math.max(1, renderer.domElement.clientWidth);
    const ch = Math.max(1, renderer.domElement.clientHeight);
    mouse.x = (e.clientX / cw) * 2 - 1;
    mouse.y = -(e.clientY / ch) * 2 + 1;

    const hit = pickPlateHit(mouse);
    document.body.style.cursor = hit ? 'pointer' : 'grab';
  });

  on(window, 'mouseup touchend', () => {
    if (isInGamme()) document.body.style.cursor = 'grab';
  });

  // #endregion Cursor
  // #region Sections

  const section = {
    items: [],
  };

  section.getIndex = () => {
    return closest(section.items, scroll.position, (item) => item.top).index;
  };

  section.previous = () => {
    const index = section.getIndex();
    section.goTo(index - 1);
  };

  section.next = () => {
    const index = section.getIndex();
    section.goTo(index + 1);
  };

  section.goTo = (index) => {
    scroll.to(section.items[index % (section.items.length - 1)].top);
  };

  /** First dish board after hero (skip leftover profile if still present). */
  section.afterHero = () => {
    for (let i = 1; i < section.items.length; i++) {
      const el = section.items[i]?.el;
      if (!el) continue;
      if (el.classList.contains('is-benefits')) return section.items[i];
    }
    for (let i = 1; i < section.items.length; i++) {
      const el = section.items[i]?.el;
      if (el?.classList.contains('is-profile')) return section.items[i];
    }
    return section.items[1] || null;
  };

  section.resize = () => {
    section.items.length = 0;
    let top = 0;
    // Only real page story sections. Entrance-gate <section class="eg-brand">
    // is still in the DOM (and measurable) after enter — including it shifted
    // snap tops so the first scroll stayed on the category cover.
    document.querySelectorAll('section.section').forEach((el) => {
      if (el.closest('.loader, #westo-entrance, .entrance-gate')) return;
      if (el.hasAttribute('hidden') || getComputedStyle(el).display === 'none') return;
      const height = el.clientHeight;
      if (height < 8) return;
      const idx = section.items.length;
      let snap = idx < 2 || el.classList.contains('is-benefits');
      if (window.innerWidth < 1024 && idx < 6) snap = true;
      section.items.push({
        el: el,
        top: top,
        height: height,
        snap: snap,
      });
      top += height;
    });
  };

  section.resize();

  // #endregion Sections
  // #region Swipe State
  // IMPORTANT : `swipe` doit être déclaré AVANT createTimeline(), car la timeline
  // référence `swipe` via tl.set(swipe, {active}). Sinon :
  // ReferenceError: Cannot access 'swipe' before initialization.
  // swipe.active est piloté par la timeline (mécanisme du collègue) ; pas de listener scroll concurrent.

  const swipe = {
    active: true,
    holding: false,
    startX: 0,
    startY: 0,
    lastX: 0,
    lastY: 0,
    deltaX: 0,
    deltaY: 0,
    totalX: 0,
    dragStartIndex: 0,
    direction: 0,
    suppressClickUntil: 0,
  };

  // Blocks stale gestures during loader / main-thread freeze so queued swipes
  // don't fire as a multi-category jump when the UI unfreezes.
  const inputGate = {
    open: false,
    gen: 0,
    settleUntil: 0,
  };

  const resetSwipeState = () => {
    swipe.deltaX = 0;
    swipe.deltaY = 0;
    swipe.totalX = 0;
    swipe.holding = false;
    swipe.direction = 0;
  };

  const pinHeroScroll = () => {
    try {
      lenis.scrollTo(0, { immediate: true });
      document.documentElement.classList.remove('is-dish-boards');
    } catch (_) {}
  };

  const openInputGate = (settleMs = 420) => {
    inputGate.gen += 1;
    const gen = inputGate.gen;
    resetSwipeState();
    carousel.target = carousel.getRounded(carousel.position);
    inputGate.open = false;
    inputGate.settleUntil = 0;
    pinHeroScroll();
    setTimeout(() => {
      if (gen !== inputGate.gen) return;
      pinHeroScroll();
      resetSwipeState();
      carousel.target = carousel.getRounded(carousel.position);
      inputGate.open = true;
      if (typeof window.westoRenderWake === 'function') window.westoRenderWake();
    }, settleMs);
  };

  const canAcceptSwipe = () =>
    inputGate.open &&
    swipe.active &&
    !pointer.prevent &&
    !animation.paused &&
    !document.documentElement.classList.contains('is-dish-boards') &&
    Date.now() >= inputGate.settleUntil;

  const isMobile = () => window.innerWidth < 1024;

  // #endregion Swipe State
  // #region Timeline

  const data = {
    camPosX: 0,
    camPosY: 0,
    // Slightly closer so the open flock fills the tall empty frame.
    camPosZ: 14.2,
    camRotX: 0,
    camRotY: 0,
    camRotZ: 0,
    fov: 34,
    canScale: 1.22,
    canPosX: 0,
    canPosY: 0,
    canPosZ: 0,
    canRotX: 0,
    canRotY: 0,
    canRotZ: 0,
    canSpin: 0,
    spacing: 4.35,
    wave: 0,
    swirl: 0,
    baseOffset: 3,
    lightIntensity: 11,
    lightWidth: 1.15,
    tintStrength: 0.75,
    spotIntensity: 0,
    spotY: 3,
    pointerInfluence: 0,
    swipeSpeed: 1,
  };

  const startData = JSON.parse(JSON.stringify(data));

  const createTimeline = () => {
    let i = 0;
    const H = () => lenis.dimensions.scrollHeight;
    const dur = () => {
      const item = section.items[i];
      return item ? item.height / Math.max(H(), 1) : 0.01;
    };
    const tl = gsap.timeline({
      defaults: {
        ease: 'power1.inOut',
      },
    });

    const taste = {
      camPosX: 0,
      camPosY: 0,
      camPosZ: 14.2,
      camRotX: 0,
      camRotY: 0,
      camRotZ: 0,
      fov: 34,
      canScale: 1.22,
      canPosX: 0,
      canPosY: -0.1,
      canPosZ: 0,
      canRotX: 0,
      canRotY: 0,
      canRotZ: 0,
      canSpin: 0,
      spacing: 4.35,
      wave: 0,
      swirl: 0,
      baseOffset: 3,
      lightIntensity: 11,
      lightWidth: 1.15,
      tintStrength: 0.75,
      spotIntensity: 0,
      spotY: 3,
      pointerInfluence: 0,
      swipeSpeed: 1,
    };

    // Soft exit into dish boards — shrink plates, no camera dive / FOV punch.
    const dishExit = {
      camPosX: 0,
      camPosY: -0.35,
      camPosZ: 16.5,
      camRotX: 0,
      camRotY: 0,
      camRotZ: 0,
      fov: 34,
      canScale: 0.001,
      canPosX: 0,
      canPosY: -0.2,
      canPosZ: 0,
      canRotX: 0,
      canRotY: 0,
      canRotZ: 0,
      canSpin: 0,
      spacing: 4.35,
      wave: 0,
      swirl: 0,
      baseOffset: 3,
      lightIntensity: 0,
      lightWidth: 1,
      tintStrength: 0.2,
      spotIntensity: 0,
      spotY: 2.2,
      pointerInfluence: 0,
      swipeSpeed: 1,
    };

    const dishPoses = [
      { ...dishExit },
      { ...dishExit, canPosY: -0.12 },
      { ...dishExit, canPosY: 0.02 },
      { ...dishExit, canPosY: 0.18 },
    ];

    // 0 — hero / categories (cans visible)
    tl.to(data, { ...taste, duration: dur() });
    i += 1;
    tl.set(swipe, { active: false });

    // profile — skipped in menu story; if present, soft handoff only
    if (section.items[i]?.el?.classList.contains('is-profile')) {
      tl.to(data, {
        ...dishExit,
        canScale: 0.2,
        tintStrength: 0.35,
        duration: dur(),
      });
      i += 1;
    }

    // benefits — one dish per section; cans scaled away (food copy on DOM)
    let dishN = 0;
    while (section.items[i]?.el?.classList.contains('is-benefits')) {
      const pose = dishPoses[dishN % dishPoses.length];
      tl.to(data, { ...pose, duration: dur() });
      dishN += 1;
      i += 1;
    }

    // argument
    if (section.items[i]) {
      tl.to(data, {
        camPosX: 0,
        camPosY: 0,
        camPosZ: 8,
        camRotX: 0,
        camRotY: 0,
        camRotZ: 0,
        fov: 45,
        canScale: 0.001,
        canPosX: 0,
        canPosY: 0,
        canPosZ: -0.5,
        canRotX: (Math.PI / 180) * -20,
        canRotY: 0,
        canRotZ: (Math.PI / 180) * -5,
        canSpin: 0,
        spacing: 5,
        wave: 0,
        swirl: 0,
        baseOffset: 3,
        lightIntensity: 10,
        lightWidth: 1.5,
        tintStrength: 1.35,
        spotIntensity: 0,
        spotY: 3,
        pointerInfluence: 0.2,
        swipeSpeed: 1,
        duration: dur(),
      });
      i += 1;
    }

    tl.set(swipe, { active: true });

    // full-gamme packshot
    if (section.items[i]) {
      tl.to(data, {
        camPosX: -3,
        camPosY: -3.5,
        camPosZ: 20,
        camRotX: (Math.PI / 180) * 10,
        camRotY: (Math.PI / 180) * -9,
        camRotZ: (Math.PI / 180) * -10,
        fov: 30,
        canScale: 1,
        canPosX: 0,
        canPosY: 0,
        canPosZ: -0.4,
        canRotX: 0,
        canRotY: 0,
        canRotZ: 0,
        canSpin: 0,
        spacing: 0.47,
        wave: 0,
        swirl: 1,
        baseOffset: 20,
        lightIntensity: 6,
        lightWidth: 3,
        tintStrength: 1.1,
        spotIntensity: 0,
        spotY: 3,
        pointerInfluence: 0,
        swipeSpeed: 2,
        duration: dur(),
      });
      i += 1;
    }

    // move offscreen
    if (section.items[i]) {
      tl.to(data, {
        camPosX: 0,
        camPosY: -5.5,
        camPosZ: 10,
        camRotX: 0,
        camRotY: 0,
        camRotZ: 0,
        fov: 30,
        canScale: 1,
        canPosX: 0,
        canPosY: 0,
        canPosZ: -0.4,
        canRotX: 0,
        canRotY: 0,
        canRotZ: 0,
        canSpin: 0,
        spacing: 0.6,
        wave: 0,
        swirl: 1,
        baseOffset: 20,
        lightIntensity: 0,
        lightWidth: 3,
        spotIntensity: 0,
        spotY: 3,
        pointerInfluence: 0,
        swipeSpeed: 1,
        duration: dur(),
      });
      i += 1;
    }

    tl.set(swipe, { active: false });

    tl.set(data, {
      camPosX: 0,
      camPosY: 8,
      camPosZ: 10,
      camRotX: 0,
      camRotY: 0,
      camRotZ: 0,
      fov: 20,
      spacing: 5,
      swirl: 0,
    });

    if (section.items[i]) {
      tl.to(data, {
        camPosX: 0,
        camPosY: 0,
        camPosZ: 29,
        camRotX: 0,
        camRotY: 0,
        camRotZ: 0,
        fov: 20,
        canScale: 1,
        canPosX: 0,
        canPosY: 0,
        canPosZ: 0.5,
        canRotX: 0,
        canRotY: 0,
        canRotZ: 0,
        canSpin: (Math.PI / 180) * 20,
        spacing: 5,
        wave: 0,
        swirl: 0,
        baseOffset: 10,
        lightIntensity: 8,
        lightWidth: 1,
        tintStrength: 0.9,
        spotIntensity: 0,
        spotY: 3,
        pointerInfluence: 0.2,
        swipeSpeed: 1,
        duration: dur(),
      });
      i += 1;
    }

    tl.to(data, {
      ...startData,
      duration: section.items[i] ? section.items[i].height / Math.max(H(), 1) : 1,
    });

    tl.pause();
    return tl;
  };

  let timeline = createTimeline();

  window.westoRelayout = () => {
    try {
      const y = scroll.position;
      const near = closest(section.items, y, (item) => item.top);
      const prevEl = near.index >= 0 ? section.items[near.index].el : null;
      const prevSlot = prevEl?.dataset?.menuSlot;
      const wasBenefits = prevEl?.classList?.contains('is-benefits');

      section.resize();
      updateSnapLimits();
      if (timeline) timeline.kill();
      timeline = createTimeline();
      // Scroll drives timeline.seek each frame — do not seek by stale time
      // after height changes (shrinking dish count used to leave the user past all boards).

      if (wasBenefits) {
        let target = null;
        if (prevSlot != null) {
          const want = document.querySelector(`section.is-benefits[data-menu-slot="${prevSlot}"]`);
          if (want && !want.hasAttribute('hidden') && getComputedStyle(want).display !== 'none') {
            target = want;
          }
        }
        if (!target) {
          const vis = [...document.querySelectorAll('section.is-benefits')].filter(
            (s) => !s.hasAttribute('hidden') && getComputedStyle(s).display !== 'none',
          );
          if (vis.length) {
            const idx = Math.min(Number(prevSlot) || 0, vis.length - 1);
            target = vis[idx];
          }
        }
        if (target) {
          lenis.scrollTo(target, { immediate: true, offset: 0 });
          scroll.position = lenis.scroll;
        }
      }

      if (window.ScrollTrigger) ScrollTrigger.refresh();
      document.dispatchEvent(new CustomEvent('westo:relayout'));

      // Timeline recreate can leave swipe.active false at hero — restore gestures
      if (isInGamme() && !pointer.prevent) {
        swipe.active = true;
        if (!inputGate.open) openInputGate(80);
      }
    } catch (e) {
      console.warn('[westoRelayout]', e);
    }
  };

  document.addEventListener('westo:langchange', () => {
    try {
      if (!isInGamme() || pointer.prevent) return;
      swipe.active = true;
      animation.paused = false;
      resetSwipeState();
      if (!inputGate.open) openInputGate(120);
      else inputGate.settleUntil = Date.now() + 120;
      if (typeof window.westoRenderWake === 'function') window.westoRenderWake();
    } catch (_) {}
  });

  // #endregion Timeline
  // #region Loader

  const loader = {
    complete: false,
    timeline: null,
    callbacks: [],
    ended: signal(),
  };

  loader.play = async () => {
    if (loader.timeline) loader.timeline.kill();

    lenis.scrollTo(0, { immediate: true });
    lenis.stop();
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';

    // Brief hard-lock only — drop the entrance CTA gesture, then re-open input.
    // Previously this stayed locked for the full camera intro (~4–5s), so
    // horizontal category swipe felt broken for several seconds after enter.
    animation.paused = true;
    swipe.active = false;
    pointer.prevent = true;
    resetSwipeState();
    inputGate.open = false;
    inputGate.gen += 1;

    const tl = gsap.timeline({
      defaults: {
        ease: 'power4.out',
        duration: 1.8,
      },
    });

    carousel.goTo(0);
    carousel.position = carousel.target;

    // Soft light-in only — never blast spacing/camera (that caused big→tiny hype).
    tl.set(data, {
      ...startData,
      lightIntensity: 0,
      lightWidth: 1.35,
      canSpin: (Math.PI / 180) * 8,
      pointerInfluence: 0,
    });

    tl.to(
      data,
      {
        lightIntensity: startData.lightIntensity,
        lightWidth: startData.lightWidth,
        canSpin: 0,
        duration: 0.95,
        ease: 'power2.out',
      },
      0,
    );

    loader.timeline = tl;

    const unlockInteraction = (settleMs) => {
      pointer.prevent = false;
      swipe.active = true;
      animation.paused = false;
      lenis.start();
      document.documentElement.style.overflow = '';
      document.body.style.overflow = '';
      if (typeof settleMs === 'number') openInputGate(settleMs);
      else if (!inputGate.open) openInputGate(120);
      loopGuard.lastPos = scroll.position;
      loopGuard.snapping = false;
      if (typeof window.westoRenderWake === 'function') window.westoRenderWake();
    };

    let unlocked = false;
    const earlyUnlock = () => {
      if (unlocked) return;
      unlocked = true;
      unlockInteraction(100);
    };
    const earlyTimer = window.setTimeout(earlyUnlock, 220);

    const animMs = Math.max(tl.duration() * 1000, 1800);
    await new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        resolve();
      };
      tl.eventCallback('onComplete', finish);
      setTimeout(finish, animMs);
    });

    window.clearTimeout(earlyTimer);
    if (!unlocked) {
      unlockInteraction(120);
    } else {
      // Intro finished — keep gate open; do not re-close for another settle window.
      pointer.prevent = false;
      swipe.active = true;
      animation.paused = false;
      lenis.start();
      document.documentElement.style.overflow = '';
      document.body.style.overflow = '';
      resetSwipeState();
      loopGuard.lastPos = scroll.position;
      loopGuard.snapping = false;
    }

    loader.ended.emit();
  };

  // #endregion Loader
  // #region Animation

  const animation = {
    paused: false,
  };

  // Flag DÉDIÉ à la perte de contexte WebGL — distinct de animation.paused.
  // animation.paused fige le lerp carousel pendant le loader, mais le rendu doit
  // CONTINUER pour qu'on voie l'anim d'intro. Seul contextLost coupe le render.
  let contextLost = false;

  // Gestion de la perte/restauration du contexte WebGL (crucial sur iOS, mémoire limitée)
  renderer.domElement.addEventListener(
    'webglcontextlost',
    (e) => {
      e.preventDefault();
      console.warn('WebGL context lost — pause du rendu');
      contextLost = true;
    },
    false,
  );
  renderer.domElement.addEventListener(
    'webglcontextrestored',
    () => {
      console.warn('WebGL context restored — reprise');
      contextLost = false;
    },
    false,
  );

  const loopGuard = {
    lastPos: 0,
    snapping: false,
    timer: null,
  };

  const renderCtl = {
    dirty: true,
    idleMs: 0,
    lastScroll: NaN,
    lastCarousel: NaN,
    lastFov: NaN,
    lastSeek: NaN,
    lastCamKey: '',
    dishSuspended: false,
    pageVisible: document.visibilityState !== 'hidden',
    sleeping: false,
    renderUnderGateOnce: false,
    rafId: 0,
    wake(opts) {
      // Gate covers the canvas — texture warm shouldn't keep a render loop alive.
      if ((!opts || !opts.force) && gateOpen()) {
        return;
      }
      this.dirty = true;
      if (opts?.force) this.renderUnderGateOnce = true;
      this.idleMs = 0;
      if (this.sleeping || !this.rafId) {
        this.sleeping = false;
        if (!this.rafId) this.rafId = requestAnimationFrame(animate);
      }
    },
  };
  window.westoRenderWake = (opts) => renderCtl.wake(opts);

  document.addEventListener('visibilitychange', () => {
    renderCtl.pageVisible = document.visibilityState !== 'hidden';
    if (renderCtl.pageVisible) {
      resetSwipeState();
      inputGate.settleUntil = Date.now() + 320;
      renderCtl.wake();
    } else {
      resetSwipeState();
      // Stop the rAF heartbeat entirely while backgrounded.
      if (renderCtl.rafId) {
        cancelAnimationFrame(renderCtl.rafId);
        renderCtl.rafId = 0;
      }
      renderCtl.sleeping = true;
    }
  });

  // Re-arm the loop after true idle sleep (Lenis needs a frame to catch wheel).
  ['pointerdown', 'wheel', 'touchstart', 'keydown'].forEach((evt) => {
    window.addEventListener(evt, () => renderCtl.wake(), { passive: true, capture: true });
  });

  // Wake when entering/leaving dish boards (class owned by table-cart).
  if (typeof MutationObserver !== 'undefined') {
    new MutationObserver(() => renderCtl.wake()).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });
  }

  let time = 0;
  function animate(tick = 0) {
    renderCtl.rafId = 0;
    var delta = tick / 1000 - time;
    time = tick / 1000;
    if (!Number.isFinite(delta) || delta <= 0) delta = 1 / 60;
    if (delta > 0.064) delta = 0.064;

    const scheduleNext = () => {
      if (!renderCtl.rafId && !renderCtl.sleeping && renderCtl.pageVisible && !contextLost) {
        renderCtl.rafId = requestAnimationFrame(animate);
      }
    };

    // Tab hidden / context lost: do not reschedule.
    if (!renderCtl.pageVisible || contextLost) {
      renderCtl.sleeping = true;
      return;
    }

    // Clamp Lenis (empêche scroll vers le haut au-delà de 0)
    if (lenis.targetScroll < 0) {
      lenis.targetScroll = 0;
      lenis.animatedScroll = 0;
      if (lenis.animate) lenis.animate.to = 0;
    }

    lenis.raf(time * 1000);

    // End clamp (finite scroll — cafe menu should not wrap to hero)
    {
      const max = Math.max(0, lenis.dimensions.scrollHeight - lenis.dimensions.height);
      if (lenis.targetScroll > max) {
        lenis.targetScroll = max;
        lenis.animatedScroll = max;
        if (lenis.animate) lenis.animate.to = max;
      }
      loopGuard.lastPos = scroll.position;
    }

    const onDishBoard = document.documentElement.classList.contains('is-dish-boards');
    const underGate = gateOpen();

    // Entrance gate covers the canvas — skip all WebGL (sim + present).
    // Boot texture loads still call wake(); we only burn GPU after enter.
    if (underGate && !renderCtl.renderUnderGateOnce) {
      renderCtl.idleMs += delta * 1000;
      // True sleep under gate once settle — particles/CSS own the screen.
      if (renderCtl.idleMs > 700) {
        renderCtl.sleeping = true;
        return;
      }
      scheduleNext();
      return;
    }
    if (renderCtl.renderUnderGateOnce) renderCtl.renderUnderGateOnce = false;

    // Wrap over N cans only — titles and plates share the same modular period.
    const ringCount = Math.max(1, labelCount || cans.length);
    const minX = ringCount * -0.5 * carousel.spacing;
    const maxX = ringCount * 0.5 * carousel.spacing;

    // Never drive category carousel from leftover swipe deltas while on dishes
    if (!onDishBoard && !animation.paused && !pointer.prevent && inputGate.open) {
      carousel.target -= swipe.deltaX * 0.02 * data.swipeSpeed;
    }
    swipe.deltaX = 0;

    // Pointer smoothing
    pointer.smoothX = lerp(pointer.smoothX, pointer.x, delta * 10);
    pointer.smoothY = lerp(pointer.smoothY, pointer.y, delta * 10);

    if (!animation.paused) {
      if (!swipe.holding) carousel.target = carousel.getRounded(carousel.target);
      if (prefersReducedMotion()) {
        carousel.position = carousel.target;
        pointer.smoothX = pointer.x;
        pointer.smoothY = pointer.y;
      } else {
        // Desktop stage: slightly softer settle (~550ms) for a premium arc
        const settle = isDesktopStage() ? 6.2 : 10;
        carousel.position = lerp(carousel.position, carousel.target, delta * settle);
      }
    }

    const scrollMoved = Math.abs(scroll.position - renderCtl.lastScroll) > 0.05;
    const carouselMoving =
      Math.abs(carousel.position - carousel.target) > 0.0008 ||
      Math.abs(carousel.position - renderCtl.lastCarousel) > 0.0008 ||
      swipe.holding;
    const pointerMoving =
      !pointer.prevent &&
      (Math.abs(pointer.smoothX - pointer.x) > 0.35 ||
        Math.abs(pointer.smoothY - pointer.y) > 0.35);

    if (scrollMoved || carouselMoving || pointerMoving || swipe.holding || renderCtl.dirty) {
      renderCtl.idleMs = 0;
      renderCtl.dirty = true;
    } else {
      renderCtl.idleMs += delta * 1000;
    }

    // Dish boards: keep Lenis physics, suspend WebGL sim + GPU presents.
    // Clear plates once so the last category frame cannot ghost under boards
    // (CSS also hides the canvas; this keeps GPU state clean for restore).
    // Exception: during hero→catbar fly, keep plates painted until DOM clones
    // cover the same photos (avoids a blink / "photo vanished" handoff).
    const catFlying = document.documentElement.classList.contains('is-cat-flying');
    const catFlyCovered = document.documentElement.classList.contains('is-cat-fly-covered');
    if (onDishBoard && !(catFlying && !catFlyCovered)) {
      if (renderCtl.dirty || !renderCtl.dishSuspended) {
        cans.forEach((c) => {
          c.visible = false;
        });
        if (!contextLost) presentFrame();
        renderCtl.dishSuspended = true;
        renderCtl.dirty = false;
      }
      carousel.delta = carousel.position - carousel.lastPosition;
      syncCarouselIndex(false);
      carousel.lastPosition = carousel.position;
      renderCtl.lastScroll = scroll.position;
      renderCtl.lastCarousel = carousel.position;
      // Boards: Lenis-only — sleep WebGL loop once suspended + idle.
      if (renderCtl.idleMs > 480 && !scrollMoved) {
        renderCtl.sleeping = true;
        return;
      }
      scheduleNext();
      return;
    }
    if (renderCtl.dishSuspended) {
      renderCtl.dishSuspended = false;
      renderCtl.dirty = true;
      renderCtl.idleMs = 0;
    }

    const needsSim = renderCtl.dirty || renderCtl.idleMs < 90;
    // Always reconcile title index with plate position — even when the GPU
    // frame is skipped. Stale carousel.index was the "wrong name until you
    // enter dishes and come back" bug.
    syncCarouselIndex(false);
    if (!needsSim) {
      carousel.lastPosition = carousel.position;
      if (renderCtl.idleMs > 520) {
        renderCtl.sleeping = true;
        return;
      }
      scheduleNext();
      return;
    }

    if (camera.fov !== data.fov || renderCtl.lastFov !== data.fov) {
      camera.fov = data.fov;
      camera.updateProjectionMatrix();
      renderCtl.lastFov = data.fov;
    }

    carousel.delta = carousel.position - carousel.lastPosition;

    const p0 = clamp(scroll.distanceTo(0) / section.items[0].height, 0, 1);
    const seekT = scroll.position / Math.max(1, lenis.dimensions.scrollHeight);
    if (Math.abs(seekT - renderCtl.lastSeek) > 0.00004 || renderCtl.dirty) {
      timeline.seek(seekT);
      renderCtl.lastSeek = seekT;
    }

    // ====== ANIM CANNETTES ======
    const windowRatio = clamp(1440 / lenis.dimensions.scrollWidth, 1, 2.4);
    const wave = windowRatio * 0.25 * (1 - (catFlying ? 0 : p0)) * data.wave;
    const desktopStage = isDesktopStage() && data.swirl < 0.35;
    const singlePlate = !isDesktopStage();
    // v13.9: when the managed promo deck owns the upper category band on a
    // portrait/touch stage, reserve real visual breathing room for it instead
    // of letting the selected category plate grow underneath the deck.
    const promoDeckPresent =
      !onDishBoard &&
      document.documentElement.classList.contains('has-westo-menu-promo-deck');
    const promoDeckActive = singlePlate && promoDeckPresent;
    const promoDeckDesktop = desktopStage && promoDeckPresent;
    const stageBlend = desktopStage
      ? clamp(1 - (catFlying ? 0 : p0) * 1.15, 0, 1)
      : 0;

    cans.forEach((can, i) => {
      var target = i * carousel.spacing - carousel.position;
      const x = wrap(target, minX, maxX);
      const slot = x / carousel.spacing;

      // Mobile only shows one plate. Skip the expensive transform/trig/material
      // path entirely for distant hidden categories; keep one neighbor warm so
      // a swipe has pixels ready before it becomes the center plate.
      if (singlePlate && !catFlying && Math.abs(slot) > 1.35) {
        can.visible = false;
        if (can.userData?.shadow) can.userData.shadow.visible = false;
        if (can.userData?.halo) can.userData.halo.visible = false;
        return;
      }

      // Carousel
      let p = clamp(1 - Math.abs(x) / carousel.spacing, 0, 1);
      const p1 = Math.min(p, p0);
      let canScale = 1.28;
      let canPosX = x * data.spacing;
      let canPosY = Math.sin(canPosX * wave);
      let canPosZ = (Math.abs(x) * -1 - 0.2) * data.wave;
      if (singlePlate) {
        const plateSize = can.userData?.plateSize;
        const plateWidth = Math.max(0.1, Number(plateSize?.width) || 3.35);
        const plateHeight = Math.max(0.1, Number(plateSize?.height) || 3.35);
        const standaloneViewport =
          document.documentElement.classList.contains('is-standalone')
          || window.navigator.standalone === true
          || window.matchMedia?.('(display-mode: standalone)').matches === true;
        const mobileViewportHeight = Math.max(
          1,
          standaloneViewport
            ? Number(window.innerHeight) || 1
            : Number(window.visualViewport?.height) || window.innerHeight || 1,
        );
        // Category-stage collision guard: short portrait and landscape
        // viewports have a much smaller band between the navbar and the
        // editorial copy. Progressively shrink and raise the active plate so
        // its projected lower edge never competes with the category name.
        const mobileCompact = clamp((760 - mobileViewportHeight) / 240, 0, 1);
        const mobileLandscape =
          window.innerWidth > mobileViewportHeight && mobileViewportHeight <= 560;
        const cameraDistance = Math.max(1, Math.abs(data.camPosZ - canPosZ));
        const visibleHeight =
          2 * Math.tan(THREE.MathUtils.degToRad(data.fov) * 0.5) * cameraDistance;
        const visibleWidth = visibleHeight * Math.max(0.35, camera.aspect);
        // Fit every category photo inside the portrait viewport. Aspect-aware
        // sizing replaces the old fixed 1.48 scale that cropped wide dishes.
        const promoWidthBudget = promoDeckActive ? 0.78 : 0.86;
        const promoHeightBudget = promoDeckActive
          ? lerp(0.43, 0.34, mobileCompact)
          : lerp(0.49, 0.38, mobileCompact);
        const fitWidth = (visibleWidth * promoWidthBudget) / plateWidth;
        const fitHeight = (visibleHeight * promoHeightBudget) / plateHeight;
        const mobileScaleFloor = promoDeckActive
          ? lerp(0.50, 0.38, mobileCompact)
          : lerp(0.55, 0.38, mobileCompact);
        canScale = clamp(Math.min(fitWidth, fitHeight), mobileScaleFloor, 1.42);
        canPosY += 0.42 * mobileCompact * (1 - p0);
        if (mobileLandscape) canPosX -= 3.0 * (1 - p0);
        // Screen Y grows downward while world Y grows upward. A very small,
        // scroll-fading negative world offset gives the deck/plate a stable
        // gap without changing the camera or the carousel/state machine.
        if (promoDeckActive) canPosY -= 0.08 * (1 - p0);
      }
      let canRotX = (-Math.PI / 180) * 20 * data.wave;
      let canRotY = (canPosX * 0.5 - (Math.PI / 180) * 20) * data.wave;
      let canRotZ = (Math.PI / 360) * 22.5 * data.wave;
      let plateOpacity = 1;
      // Narrow: only the centered plate (neighbors appear while swiping in).
      let stageVisible = !(singlePlate && Math.abs(slot) >= 0.92);

      if (stageBlend > 0.001) {
        const stage = sampleDesktopStage(slot);

        // Aspect-aware desktop fit: reserve the lower editorial band and cap
        // each food plane by its real geometry. This is the desktop equivalent
        // of the already-stable portrait fitting logic above.
        const plateSize = can.userData?.plateSize;
        const plateWidth = Math.max(0.1, Number(plateSize?.width) || 3.35);
        const plateHeight = Math.max(0.1, Number(plateSize?.height) || 3.35);
        const cameraDistance = Math.max(1, Math.abs(data.camPosZ - stage.z));
        const visibleHeight =
          2 * Math.tan(THREE.MathUtils.degToRad(data.fov) * 0.5) * cameraDistance;
        const visibleWidth = visibleHeight * Math.max(0.35, camera.aspect);
        const centerWeight = clamp(1 - Math.abs(slot), 0, 1);
        const widthBudget = lerp(0.19, 0.36, centerWeight);
        const heightBudget = lerp(0.26, 0.43, centerWeight);
        const fitScale = Math.min(
          (visibleWidth * widthBudget) / plateWidth,
          (visibleHeight * heightBudget) / plateHeight,
        );
        stage.scale = Math.min(
          stage.scale,
          clamp(fitScale, centerWeight > 0.55 ? 0.52 : 0.36, centerWeight > 0.55 ? 1.12 : 0.70),
        );

        if (promoDeckDesktop) {
          // The promo deck owns the upper desktop band. Compress the cinema
          // flock just enough to keep a real no-overlap gap while retaining
          // the original carousel geometry and neighbor peeks.
          const centerWeight = clamp(1 - Math.abs(slot), 0, 1);
          stage.y -= 0.15 + 0.05 * centerWeight;
          stage.scale *= lerp(0.86, 0.78, centerWeight);
        }
        stageVisible = stage.visible;
        canPosX = lerp(canPosX, stage.x, stageBlend);
        canPosY = lerp(canPosY, stage.y, stageBlend);
        canPosZ = lerp(canPosZ, stage.z, stageBlend);
        canScale = lerp(canScale, stage.scale, stageBlend);
        canRotX = lerp(canRotX, stage.rotX ?? 0, stageBlend);
        canRotY = lerp(canRotY, stage.rotY, stageBlend);
        canRotZ = lerp(canRotZ, 0, stageBlend);
        plateOpacity = lerp(1, stage.opacity, stageBlend);
      }

      // Packshot (swirl)
      canRotX = lerp(canRotX, x * 0.06 * windowRatio + 0.2, data.swirl);

      // Lerp to data — but while cat-flying, freeze hero plate size so photos
      // don't shrink away before DOM clones take over the same seats.
      // Cinema (wide): scroll resize floor keeps ≥3 flock readable.
      // Narrow single-plate: no flock floor — neighbors stay hidden.
      if (catFlying) {
        // Keep stage/hero scale & opacity; ignore dish canScale collapse.
      } else {
        canScale = lerp(canScale, data.canScale, p0);
        if (!singlePlate && p0 < 0.97) canScale = Math.max(canScale, 0.42);
        canPosY = lerp(canPosY, data.canPosY, p0);
        canPosZ = lerp(canPosZ, data.canPosZ, p0);
      }
      // Scale-only depth — never fade plates during scroll (film neighbor vanish).
      plateOpacity = 1;
      canRotX = canRotX + data.canRotX;
      canRotY = lerp(canRotY, data.canRotY, catFlying ? 0 : p1);
      canRotZ = lerp(canRotZ, data.canRotZ, catFlying ? 0 : p1);

      // Desktop: limited parallax only on the active plate (no idle float)
      if (desktopStage && stageBlend > 0.5 && p > 0.72) {
        const px = ((pointer.smoothX / window.innerWidth) - 0.5) * 2;
        const py = ((pointer.smoothY / window.innerHeight) - 0.5) * 2;
        canRotY += px * 0.038 * p * stageBlend;
        canRotX += py * 0.024 * p * stageBlend;
      } else {
        canRotY += (pointer.smoothX / 1280) * data.pointerInfluence * p;
        canRotX += (pointer.smoothY / 1280) * data.pointerInfluence * p;
      }
      canRotZ += data.canSpin * p * 0.15;

      // Apply
      can.position.x = canPosX;
      can.position.y = canPosY;
      can.position.z = canPosZ;
      can.rotation.x = canRotX;
      can.rotation.y = canRotY;
      can.rotation.z = canRotZ;
      can.scale.set(canScale, canScale, canScale);
      can.visible = stageVisible && canScale > 0.04;
      const dist = Math.abs(x);
      can.renderOrder = Math.round((1 - Math.min(dist, 1)) * 200);

      const plate = can.userData?.plate;
      const shadow = can.userData?.shadow;
      const halo = can.userData?.halo;
      if (plate?.material) {
        plate.material.opacity = 1;
        plate.material.color.setRGB(1, 1, 1);
      }
      if (shadow) {
        const near = Math.abs(slot) < 1.55 && stageVisible && can.visible;
        shadow.visible = near;
        if (shadow.material) {
          shadow.material.opacity = near ? (0.22 + 0.48 * p) * stageBlend : 0;
        }
        // Contact shadow stretches slightly with depth
        shadow.scale.set(1 + Math.abs(slot) * 0.12, 1, 1 + Math.abs(slot) * 0.2);
        shadow.position.x = slot * 0.08;
      }
      // Soft yellow spotlight behind the centered plate — removed for a cleaner stage.
      if (halo) {
        halo.visible = false;
        if (halo.material) halo.material.opacity = 0;
      }
    });
    // ====== FIN ANIM CANNETTES ======

    // UI state is owned by table-cart's scroll controller. WebGL only reacts.
    // Do NOT gate on data.canScale — that stays ~0 while scroll is still in the
    // dish timeline, which caused an empty hero flash when leaving dish boards.
    cans.forEach((c) => {
      c.visible = !onDishBoard && c.visible && c.scale.x > 0.04;
    });

    // Dev assert: center plate identity must match title index (N-only ring).
    if (typeof location !== 'undefined' && /[?&]westoDebug=1\b/.test(location.search)) {
      const idx = carousel.getIndex(true);
      const center = cans[idx];
      const expectedId = categoryIds[idx] || null;
      const actualId = center?.userData?.categoryId ?? null;
      if (expectedId && actualId && expectedId !== actualId) {
        console.warn('[westo] hero plate/title desync', { idx, expectedId, actualId });
      }
    }

    const camKey = `${data.camPosX}|${data.camPosY}|${data.camPosZ}|${data.camRotX}|${data.camRotY}|${data.camRotZ}`;
    if (camKey !== renderCtl.lastCamKey) {
      camera.position.x = data.camPosX;
      camera.position.y = data.camPosY;
      camera.position.z = data.camPosZ;
      camera.rotation.x = data.camRotX;
      camera.rotation.y = data.camRotY;
      camera.rotation.z = data.camRotZ;
      renderCtl.lastCamKey = camKey;
    }

    tint.strength.value = data.tintStrength;

    const shouldPresent =
      renderCtl.dirty ||
      renderCtl.idleMs < 240 ||
      carouselMoving ||
      scrollMoved ||
      pointerMoving;
    if (shouldPresent) presentFrame();

    carousel.lastPosition = carousel.position;
    renderCtl.lastScroll = scroll.position;
    renderCtl.lastCarousel = carousel.position;
    if (!carouselMoving && !scrollMoved && !pointerMoving && !swipe.holding) {
      renderCtl.dirty = false;
    }

    // True idle sleep — stop rAF until wake() (wheel/pointer/scroll/class).
    if (
      renderCtl.idleMs > 520 &&
      !carouselMoving &&
      !scrollMoved &&
      !pointerMoving &&
      !swipe.holding
    ) {
      renderCtl.sleeping = true;
      return;
    }
    scheduleNext();
  }

  // #endregion Animation
  // #region Pointer

  const pointer = {
    x: window.innerWidth / 2,
    y: window.innerHeight / 2,
    smoothX: window.innerWidth / 2,
    smoothY: window.innerHeight / 2,
    prevent: true,
  };

  // Blocage dur du scroll pendant le loader (wheel + touchmove coupés à la source).
  const blockScrollWhilePrevented = (e) => {
    if (pointer.prevent) {
      e.preventDefault();
      e.stopPropagation();
    }
  };
  window.addEventListener('wheel', blockScrollWhilePrevented, { passive: false, capture: true });
  window.addEventListener('touchmove', blockScrollWhilePrevented, { passive: false, capture: true });

  on(window, 'mousemove', (e) => {
    pointer.x = e.clientX;
    pointer.y = e.clientY;
  });

  // #endregion Pointer
  // #region Swipe

  // Swipe on window (not only canvas) so hero UI chrome doesn't steal the gesture.
  on(window, 'mousedown touchstart', (e) => {
    if (!canAcceptSwipe()) return;
    if (!isInGamme()) return;
    if (isUiChromeClick(e)) return;
    // Ignore multi-touch / leftover fingers from a frozen frame
    if (e.touches && e.touches.length > 1) return;
    swipe.holding = true;
    swipe.deltaX = 0;
    swipe.totalX = 0;
    swipe.dragStartIndex = carousel.index;
    swipe.direction = 0;
    const x = e.touches ? e.touches[0].clientX : e.clientX;
    const y = e.touches ? e.touches[0].clientY : e.clientY;
    swipe.startX = x;
    swipe.lastX = x;
    swipe.startY = y;
    swipe.lastY = y;
  });

  on(window, 'mousemove touchmove', (e) => {
    if (!swipe.holding) return;
    if (!canAcceptSwipe()) {
      resetSwipeState();
      return;
    }
    if (e.touches && e.touches.length > 1) {
      resetSwipeState();
      return;
    }
    const x = e.touches ? e.touches[0].clientX : e.clientX;
    const y = e.touches ? e.touches[0].clientY : e.clientY;
    const deltaX = x - swipe.lastX;
    const deltaY = y - swipe.lastY;
    if (swipe.direction == 0) {
      const movedX = Math.abs(x - swipe.startX);
      const movedY = Math.abs(y - swipe.startY);
      // Use total travel (not last-frame delta) so a vertical scroll
      // isn't misclassified as a category swipe from touch jitter.
      if (movedX > 8 || movedY > 8) {
        swipe.direction = movedX > movedY * 1.15 ? 1 : 2;
      }
    }
    if (swipe.direction == 1) {
      swipe.lastX = x;
      swipe.totalX += deltaX;
      if (isMobile() && isInGamme()) {
        const ratio = clamp(-swipe.totalX / 90, -0.42, 0.42);
        carousel.target = (swipe.dragStartIndex + ratio) * carousel.spacing - carousel.offset;
      } else {
        swipe.deltaX += deltaX;
      }
      lenis.stop();
      if (e.touches) {
        document.body.style.overflow = 'hidden';
      }
    }
  });

  on(window, 'mouseup touchend touchcancel', () => {
    if (!swipe.holding) return;
    const wasHorizontal = swipe.direction === 1;
    const totalX = swipe.totalX;
    const startIndex = swipe.dragStartIndex;
    const gen = inputGate.gen;
    const mobileGamme = isMobile() && isInGamme() && wasHorizontal;
    const accept = canAcceptSwipe();
    if (wasHorizontal && Math.abs(totalX) > 10) {
      swipe.suppressClickUntil = Date.now() + 450;
    }
    resetSwipeState();
    setTimeout(() => {
      if (gen !== inputGate.gen || !inputGate.open || !accept) {
        carousel.target = carousel.getRounded(carousel.position);
        lenis.start();
        document.body.style.overflow = '';
        return;
      }
      if (Date.now() < inputGate.settleUntil) {
        carousel.goTo(startIndex);
        lenis.start();
        document.body.style.overflow = '';
        return;
      }
      if (mobileGamme) {
        const threshold = 36;
        let next = startIndex;
        if (totalX < -threshold) next = wrap(startIndex + 1, 0, canLabels.length);
        else if (totalX > threshold) next = wrap(startIndex - 1, 0, canLabels.length);
        inputGate.settleUntil = Date.now() + 420;
        carousel.goTo(next);
        carousel.target = carousel.getRounded();
        normalizeCarouselPhase(true);
      } else if (wasHorizontal) {
        // Soften desktop flick — never amplify a stale multi-gesture pileup
        carousel.target = carousel.getRounded(carousel.target);
        normalizeCarouselPhase(true);
      }
      lenis.start();
      document.body.style.overflow = '';
    }, 0);
  });

  // #endregion Swipe
  // #region Mobile Paging

  const paging = {
    startX: 0,
    startY: 0,
    anchor: 0,
    axis: 0,
    active: false,
    threshold: 24,
    lastSnap: 7,
  };

  on(window, 'touchstart', (e) => {
    if (!isMobile() || pointer.prevent || !inputGate.open) return;
    // Interactive chrome owns its own taps/pans — never let page-swipe arbitration steal them.
    if (isUiChromeClick(e) || isDishRailGesture(e)) {
      paging.active = false;
      return;
    }
    if (swipe.holding && swipe.direction === 1) {
      paging.active = false;
      return;
    }
    paging.startX = e.touches[0].clientX;
    paging.startY = e.touches[0].clientY;
    paging.axis = 0;
    paging.anchor = closest(section.items, scroll.position, (item) => item.top).index;
    paging.active = paging.anchor <= paging.lastSnap;
  });

  window.addEventListener(
    'touchmove',
    (e) => {
      if (!isMobile() || pointer.prevent || !paging.active || !inputGate.open) return;
      if (window.__westoRailBrowsing || isDishRailGesture(e)) {
        paging.active = false;
        return;
      }
      if (swipe.holding && swipe.direction === 1) {
        paging.active = false;
        return;
      }
      const x = e.touches[0].clientX;
      const y = e.touches[0].clientY;
      if (paging.axis === 0) {
        const dx = Math.abs(x - paging.startX);
        const dy = Math.abs(y - paging.startY);
        if (dx > 2 || dy > 2) paging.axis = dx > dy ? 1 : 2;
      }
      if (paging.axis === 2) {
        e.preventDefault();
        lenis.stop();
      }
    },
    { passive: false },
  );

  on(window, 'touchend', (e) => {
    if (!isMobile() || pointer.prevent || !paging.active || paging.axis !== 2) return;
    if (window.__westoRailBrowsing || isDishRailGesture(e)) {
      paging.active = false;
      paging.axis = 0;
      lenis.start();
      return;
    }
    if (!inputGate.open || Date.now() < inputGate.settleUntil) {
      paging.active = false;
      paging.axis = 0;
      lenis.start();
      return;
    }
    const endY = (e.changedTouches && e.changedTouches[0].clientY) || paging.startY;
    const delta = endY - paging.startY;

    let target = paging.anchor;
    if (Math.abs(delta) > paging.threshold) {
      target = paging.anchor + (delta < 0 ? 1 : -1);
    }
    target = clamp(target, 0, section.items.length - 1);

    // Coalesce vertical snaps — one at a time after freeze.
    inputGate.settleUntil = Date.now() + 520;
    lenis.start();
    scroll.to(section.items[target].top, {
      duration: paging.anchor === 0 && target > 0 ? 0.75 : 1.05,
      easing: (t) => 1 - Math.pow(1 - t, 3),
    });

    paging.active = false;
    paging.axis = 0;
  });

  // #endregion Mobile Paging
  // #region Desktop Paging

  const ENABLE_DESKTOP_PAGING = true;

  const wheelPager = {
    locked: false,
    lastSnap: 6,
    durationSlow: 1.5,
    durationFast: 1,
    slowIndexes: [0, 1, 5, 6],
    cooldown: 0,
  };

  const updateSnapLimits = () => {
    let lastBenefits = 0;
    section.items.forEach((it, idx) => {
      if (it.el.classList.contains('is-gamme') || it.el.classList.contains('is-benefits')) {
        lastBenefits = idx;
      }
    });
    paging.lastSnap = lastBenefits;
    wheelPager.lastSnap = lastBenefits;
    wheelPager.slowIndexes = [0, Math.min(1, lastBenefits), lastBenefits].filter(
      (v, i, a) => a.indexOf(v) === i,
    );
  };
  updateSnapLimits();

  let wheelTimer;
  window.addEventListener(
    'wheel',
    (e) => {
      if (!ENABLE_DESKTOP_PAGING || pointer.prevent) return;
      // Rail / catbar own vertical scrub — don't snap dishes underneath.
      if (isDishRailGesture(e) || window.__westoRailBrowsing) return;

      const ax = Math.abs(e.deltaX);
      const ay = Math.abs(e.deltaY);
      // Dish mode: horizontal trackpad belongs to category step / catbar — never
      // let the vertical section pager steal it (that locked gestures after 1–2 swipes).
      if (
        document.documentElement.classList.contains('is-dish-boards') &&
        ax >= ay * 0.55
      ) {
        return;
      }

      const anchor = closest(section.items, scroll.position, (item) => item.top).index;
      if (anchor > wheelPager.lastSnap) return;
      e.preventDefault();
      if (wheelPager.locked) return;
      if (Math.abs(e.deltaY) < 4) return;
      const dir = e.deltaY > 0 ? 1 : -1;
      const target = clamp(anchor + dir, 0, section.items.length - 1);
      if (target === anchor) return;
      const duration =
        anchor === 0 && dir === 1
          ? 0.75
          : wheelPager.slowIndexes.includes(anchor)
            ? wheelPager.durationSlow
            : wheelPager.durationFast;
      wheelPager.locked = true;
      scroll.to(section.items[target].top, {
        duration,
        lock: true,
        easing: (t) => 1 - Math.pow(1 - t, 3),
      });
      clearTimeout(wheelTimer);
      wheelTimer = setTimeout(() => (wheelPager.locked = false), duration * 1000 + wheelPager.cooldown);
    },
    { passive: false },
  );

  // #endregion Desktop Paging
  // #region Resize

  renderCtl.rafId = requestAnimationFrame(animate);

  let lastResizeWidth = window.innerWidth;
  let lastResizeHeight = window.innerHeight;
  let lastResizeDpr = window.devicePixelRatio || 1;
  let resizeTimer = null;

  // One settled responsive coordinator owns expensive geometry rebuilds.
  // Resize storms only resize the GPU buffers immediately; expensive DOM /
  // timeline geometry commits after the viewport has settled.  During the
  // Hero↔Dish photo handoff we postpone the semantic reflow so the transition
  // cannot be rebuilt halfway through a frame.
  let responsiveRevision = 0;
  const scheduleResponsiveResize = () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const nextWidth = Math.max(1, window.innerWidth || 1);
      const nextHeight = Math.max(1, window.innerHeight || 1);
      const nextDpr = window.devicePixelRatio || 1;
      const widthDelta = Math.abs(nextWidth - lastResizeWidth);
      const heightDelta = Math.abs(nextHeight - lastResizeHeight);
      const dprChanged = Math.abs(nextDpr - lastResizeDpr) > 0.01;
      if (widthDelta < 1 && heightDelta < 1 && !dprChanged) return;

      const oldWidth = lastResizeWidth;
      const oldHeight = lastResizeHeight;
      const breakpointChanged =
        (oldWidth < 992) !== (nextWidth < 992) ||
        (oldWidth < 1024) !== (nextWidth < 1024);
      const orientationChanged = (oldWidth > oldHeight) !== (nextWidth > nextHeight);
      const meaningfulGeometry =
        widthDelta >= 2 || heightDelta >= 32 || breakpointChanged || orientationChanged || dprChanged;

      // Keep the WebGL backing store fitted even while a transition owns the
      // DOM state. This is cheap and avoids stretched frames during live resize.
      camera.aspect = nextWidth / nextHeight;
      camera.updateProjectionMatrix();
      const runtimeCap = Number(
        window.westoPerformance?.quality?.maxDpr || initialQuality.maxDpr || pixelRatio || 1.25,
      );
      const cappedDpr = Math.min(nextDpr, runtimeCap);
      pixelRatio = cappedDpr;
      renderer.setPixelRatio(cappedDpr);
      if (finalComposer) {
        finalComposer.setPixelRatio(cappedDpr);
        finalComposer.setSize(nextWidth, nextHeight);
      }
      renderer.setSize(nextWidth, nextHeight, true);

      // A fly transition is a single-owner transaction. Rebuilding its timeline
      // mid-flight caused the category image to jump/deform after resize.
      if (meaningfulGeometry && document.documentElement.classList.contains('is-cat-flying')) {
        resizeTimer = setTimeout(scheduleResponsiveResize, 120);
        renderCtl.wake();
        return;
      }

      const heroIndex = carousel.getIndex(true);
      lastResizeWidth = nextWidth;
      lastResizeHeight = nextHeight;
      lastResizeDpr = nextDpr;
      const revision = ++responsiveRevision;

      if (meaningfulGeometry) {
        const inDishMode = document.documentElement.classList.contains('is-dish-boards');
        if (inDishMode && typeof window.westoRelayout === 'function') {
          // westoRelayout is the authoritative dish-anchor preserving path. Do
          // not also rebuild section/timeline here (the old double rebuild was
          // the main source of resize deformation around tablet widths).
          window.westoRelayout();
        } else {
          if (timeline) timeline.kill();
          section.resize();
          updateSnapLimits();
          timeline = createTimeline();
          if (!swipe.holding) carousel.goTo(heroIndex, { immediate: true });
        }

        // Pointer offsets are viewport-relative. Recenter after the new aspect
        // ratio so the old desktop pointer cannot skew the mobile hero pose.
        pointer.x = pointer.smoothX = nextWidth * 0.5;
        pointer.y = pointer.smoothY = nextHeight * 0.5;
      }

      // Let CSS/container geometry commit before Catbar and dish modules read
      // their rects. A revision guard drops stale callbacks from resize storms.
      requestAnimationFrame(() => {
        if (revision !== responsiveRevision) return;
        document.dispatchEvent(
          new CustomEvent('westo:responsive-settle', {
            detail: {
              width: nextWidth,
              height: nextHeight,
              dpr: nextDpr,
              breakpointChanged,
              orientationChanged,
            },
          }),
        );
        renderCtl.wake();
      });
    }, 180);
  };

  on(window, 'resize', scheduleResponsiveResize);
  on(window, 'westo:viewportchange', scheduleResponsiveResize);
  window.visualViewport?.addEventListener?.('resize', scheduleResponsiveResize, { passive: true });
  on(window, 'orientationchange', scheduleResponsiveResize);

  lenis.scrollTo(0, { immediate: true });

  window.loader = loader;

  // Snap WebGL camera/cans back to the hero pose after leaving dish boards.
  // opts.hidden: pose ready but plates stay invisible until fly orbs land.
  window.westoRestoreHeroScene = (opts = {}) => {
    const hidden = Boolean(opts?.hidden);
    try {
      Object.keys(startData).forEach((key) => {
        data[key] = startData[key];
      });
      timeline.seek(0);
      renderCtl.lastSeek = 0;
      // Snap to the plate under the camera (getIndex), not a possibly stale .index
      const live = typeof carousel.getIndex === 'function' ? carousel.getIndex(true) : carousel.index;
      carousel.goTo(live, { immediate: true });
      const canvas = renderer?.domElement;
      if (canvas && window.gsap) window.gsap.set(canvas, { autoAlpha: 1 });
      cans.forEach((c) => {
        c.visible = true;
      });
      if (hidden && typeof window.__westoHideHeroPlatesForFly === 'function') {
        window.__westoHideHeroPlatesForFly(true);
      } else if (!hidden && typeof window.__westoHideHeroPlatesForFly === 'function') {
        window.__westoHideHeroPlatesForFly(false);
      }
      renderCtl.wake();
    } catch (e) {
      console.warn('[westoRestoreHeroScene]', e);
    }
  };

  // #endregion Resize
  // #region Scroll Indicator

  const indicator = {
    el: document.querySelector('.scroll_indicator'),
    set: null,
  };

  if (indicator.el) {
    gsap.set(indicator.el, { '--p': 0 });

    indicator.set = gsap.quickTo(indicator.el, '--p', {
      duration: 0.55,
      ease: 'power3.out',
    });

    const updateScrollIndicator = () => {
      let progress = 0;
      if (document.documentElement.classList.contains('is-dish-boards')) {
        // Progress through the current category's dish boards (not whole page).
        const boards = Array.from(document.querySelectorAll('section.is-benefits')).filter(
          (s) => !s.hasAttribute('hidden') && getComputedStyle(s).display !== 'none',
        );
        if (boards.length) {
          const start = boards[0].offsetTop || 0;
          const last = boards[boards.length - 1];
          const end = Math.max(
            start + 1,
            (last.offsetTop || 0) + (last.offsetHeight || 0) - (lenis.dimensions.height || window.innerHeight),
          );
          const range = Math.max(1, end - start);
          progress = Math.max(0, Math.min(1, ((scroll.position || 0) - start) / range));
        }
      } else {
        const max = lenis.dimensions.scrollHeight - lenis.dimensions.height;
        progress = max > 0 ? scroll.position / max : 0;
      }
      indicator.set(progress);
    };

    lenis.on('scroll', updateScrollIndicator);
    // Refresh when entering/leaving dishes or boards rebuild (category switch).
    const dishProgressMo = new MutationObserver(() => updateScrollIndicator());
    dishProgressMo.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });
    window.addEventListener('westo:menu-ready', () => {
      requestAnimationFrame(updateScrollIndicator);
    });
    window.setTimeout(updateScrollIndicator, 0);
  }

  // Signal pour ton code Webflow externe
  window.__sceneReady = true;
  window.dispatchEvent(new CustomEvent('carousel:ready', { detail: carousel }));
  emitBootProgress({ phase: 'scene-ready' });

  // #endregion Scroll Indicator
}

bootScene().catch((error) => {
  console.error('[westo] scene boot failed', error);
  document.documentElement.classList.add('is-scene-fallback');
  window.dispatchEvent(new CustomEvent('westo:scene-error', { detail: { error } }));
});
