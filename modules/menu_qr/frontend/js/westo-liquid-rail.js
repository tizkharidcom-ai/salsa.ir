/* Westo liquid-metal rail border.
   The shader package is loaded only when the adaptive budget allows a second
   WebGL context. Economy/Balanced keep the existing static cyan contour.

   Performance/lifecycle rules:
   - never import the shader until an eligible active dish actually asks for it
   - only one rail ShaderMount may exist at a time
   - async activation is generation-guarded so stale dish switches cannot mount
   - hidden/offscreen rails render at speed 0
   - temporary speed bumps share one owned timer
   - public WestoLiquidRail API and visual shader parameters stay compatible
*/

const STYLE_ID = 'westo-liquid-rail-style';
const BASE_SPEED = 0.55;
const BUMP_SPEED_MAX = 2.4;

let emptyImg = null;
let emptyImgPromise = null;
let activeAnchor = null;
let activeMount = null;
let activeHost = null;
let desiredWrapper = null;
let lastTint = '';
let railIo = null;
let railInViewport = true;
let railPaused = false;
let desiredSpeed = BASE_SPEED;
let bumpTimer = 0;
let activationGeneration = 0;
let shaderModulePromise = null;
let lifecycleBound = false;

const reducedQuery =
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : null;

function currentQuality() {
  return window.westoPerformance?.quality || null;
}

function shaderAllowed() {
  const quality = currentQuality();
  if (quality && quality.shaderRail === false) return false;
  return !reducedQuery?.matches;
}

function documentVisible() {
  return typeof document === 'undefined' || document.visibilityState !== 'hidden';
}

function shouldAnimateMount() {
  return !!activeMount && shaderAllowed() && documentVisible() && railInViewport && !railPaused;
}

function syncMountSpeed() {
  if (!activeMount?.setSpeed) return;
  try {
    activeMount.setSpeed(shouldAnimateMount() ? desiredSpeed : 0);
  } catch (_) {}
}

async function loadShaderModule() {
  if (!shaderAllowed()) return null;
  if (!shaderModulePromise) {
    shaderModulePromise = import('./vendor/westo-liquid-shader.bundle.mjs?v=clean1').catch((error) => {
      // A transient module/network failure must not permanently poison future
      // activations. The caller still receives the original rejection.
      shaderModulePromise = null;
      throw error;
    });
  }
  return shaderModulePromise;
}

function clearBumpTimer() {
  if (!bumpTimer) return;
  window.clearTimeout(bumpTimer);
  bumpTimer = 0;
}

function pauseLiquidRail() {
  railPaused = true;
  syncMountSpeed();
}

function resumeLiquidRail() {
  railPaused = false;
  syncMountSpeed();
}

function onReducedMotionChange() {
  if (!shaderAllowed()) {
    // Keep desiredWrapper so a later explicit tier/motion upgrade can restore
    // the same active rail without requiring a category/dish change.
    destroyMount({ preserveDesired: true });
    return;
  }
  if (desiredWrapper?.isConnected) {
    activateLiquidRailBorder(desiredWrapper);
  }
}

function onPerformanceTierChange() {
  if (!shaderAllowed()) {
    destroyMount({ preserveDesired: true });
    return;
  }
  if (desiredWrapper?.isConnected) {
    activateLiquidRailBorder(desiredWrapper);
  }
}

function bindRailLifecycle() {
  if (lifecycleBound || typeof document === 'undefined') return;
  lifecycleBound = true;

  document.addEventListener('visibilitychange', () => {
    syncMountSpeed();
  });

  window.addEventListener('pagehide', () => {
    pauseLiquidRail();
  });

  window.addEventListener('pageshow', () => {
    if (document.visibilityState !== 'hidden') resumeLiquidRail();
  });

  window.addEventListener('westo:performance-tier', onPerformanceTierChange);

  if (typeof reducedQuery?.addEventListener === 'function') {
    reducedQuery.addEventListener('change', onReducedMotionChange);
  } else if (typeof reducedQuery?.addListener === 'function') {
    reducedQuery.addListener(onReducedMotionChange);
  }
}
bindRailLifecycle();

function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .benefits_rail-border--liquid {
      position: absolute;
      inset: -4px;
      border-radius: inherit;
      pointer-events: none;
      z-index: 5;
      opacity: 0;
      visibility: hidden;
      transition: opacity 0.32s ease, visibility 0.32s ease, transform 0.32s ease;
      transform: scale(0.96);
      overflow: hidden;
      isolation: isolate;
    }
    .benefits_icon-wrapper.is-active .benefits_rail-border--liquid,
    .benefits_icon-wrapper.w--current .benefits_rail-border--liquid,
    .benefits_icon.is-liquid-active > .benefits_rail-border--liquid {
      opacity: 1;
      visibility: visible;
      transform: scale(1);
    }
    .benefits_rail-border__metal {
      position: absolute;
      inset: 0;
      border-radius: inherit;
      overflow: hidden;
      /* Ring only — liquid metal shows as a slim contour */
      -webkit-mask-image: radial-gradient(
        farthest-side,
        transparent calc(100% - 3px),
        #000 calc(100% - 2.2px)
      );
      mask-image: radial-gradient(
        farthest-side,
        transparent calc(100% - 3px),
        #000 calc(100% - 2.2px)
      );
    }
    .benefits_rail-border__metal canvas {
      width: 100% !important;
      height: 100% !important;
      display: block !important;
      position: absolute !important;
      inset: 0 !important;
      border-radius: inherit !important;
    }
    .benefits_rail-border__sheen {
      position: absolute;
      inset: 0;
      border-radius: inherit;
      box-shadow:
        inset 0 0 0 1px color-mix(in srgb, var(--wg-accent, #78d0d8) 35%, transparent),
        0 0 12px color-mix(in srgb, var(--wg-accent, #78d0d8) 28%, transparent);
      pointer-events: none;
      mix-blend-mode: screen;
      opacity: 0.55;
    }
    html[data-theme='light'] .benefits_rail-border__sheen {
      mix-blend-mode: multiply;
      opacity: 0.45;
      box-shadow:
        inset 0 0 0 1.5px rgba(42, 122, 134, 0.55),
        0 0 10px rgba(42, 122, 134, 0.2);
    }
    @media (prefers-reduced-motion: reduce) {
      .benefits_rail-border--liquid {
        transition: opacity 0.2s ease;
      }
    }
  `;
  document.head.appendChild(style);
}

function loadEmptyPixel(emptyPixel) {
  if (emptyImg?.complete) return Promise.resolve(emptyImg);
  if (emptyImgPromise) return emptyImgPromise;

  emptyImgPromise = new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      emptyImg = img;
      resolve(img);
    };
    img.onerror = reject;
    img.src = emptyPixel;
  }).finally(() => {
    emptyImgPromise = null;
  });

  return emptyImgPromise;
}

function accentHex() {
  // Site chrome accent locked to brand cyan — category washes stay atmospheric only.
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--wg-accent').trim();
  if (accent) return accent;
  const theme = document.documentElement.getAttribute('data-theme');
  return theme === 'light' ? '#2a7a86' : '#78d0d8';
}

function disconnectRailObserver() {
  if (!railIo) return;
  try {
    railIo.disconnect();
  } catch (_) {}
}

function disposeActiveMount() {
  if (activeMount?.dispose) {
    try {
      activeMount.dispose();
    } catch (_) {}
  } else if (activeMount?.destroy) {
    try {
      activeMount.destroy();
    } catch (_) {}
  }
  activeMount = null;
}

function destroyMount({ preserveDesired = false, invalidate = true } = {}) {
  if (invalidate) activationGeneration += 1;
  clearBumpTimer();
  desiredSpeed = BASE_SPEED;
  disconnectRailObserver();
  disposeActiveMount();

  if (activeHost) {
    activeHost.classList.remove('is-liquid-active');
  }

  activeHost = null;
  activeAnchor = null;
  lastTint = '';
  railInViewport = true;
  railPaused = false;
  if (!preserveDesired) desiredWrapper = null;
}

function ensureDom(iconEl) {
  ensureStyle();
  let ring = iconEl.querySelector(':scope > .benefits_rail-border--liquid');
  if (!ring) {
    // Prefer icon host; fall back to wrapper.
    const host = iconEl;
    if (getComputedStyle(host).position === 'static') {
      host.style.position = 'relative';
    }
    if (!host.style.borderRadius) {
      // Circular plate thumbs read best with a full round metal ring.
      const r = getComputedStyle(host).borderRadius;
      if (!r || r === '0px') host.style.borderRadius = '999px';
    }
    ring = document.createElement('span');
    ring.className = 'benefits_rail-border benefits_rail-border--liquid';
    ring.setAttribute('aria-hidden', 'true');
    const metal = document.createElement('span');
    metal.className = 'benefits_rail-border__metal';
    const sheen = document.createElement('span');
    sheen.className = 'benefits_rail-border__sheen';
    ring.appendChild(metal);
    ring.appendChild(sheen);
    host.insertBefore(ring, host.firstChild);
  }
  return ring;
}

function observeActiveHost(iconEl) {
  if (typeof IntersectionObserver === 'undefined') {
    railInViewport = true;
    syncMountSpeed();
    return;
  }

  if (!railIo) {
    railIo = new IntersectionObserver(
      (entries) => {
        const entry = entries.find((candidate) => candidate.target === activeHost);
        if (!entry) return;
        railInViewport = entry.isIntersecting && entry.intersectionRatio > 0;
        syncMountSpeed();
      },
      { threshold: 0.05 },
    );
  }

  railIo.disconnect();
  railInViewport = true;
  railIo.observe(iconEl);
}

async function mountOn(iconEl, wrapper, generation, tintHex) {
  const shader = await loadShaderModule();
  if (!shader || generation !== activationGeneration || desiredWrapper !== wrapper) return false;
  if (!iconEl.isConnected || !wrapper.isConnected || !shaderAllowed()) return false;

  const {
    ShaderMount,
    liquidMetalFragmentShader,
    LiquidMetalShapes,
    getShaderColorFromString,
    ShaderFitOptions,
    emptyPixel,
  } = shader;

  await loadEmptyPixel(emptyPixel);
  if (generation !== activationGeneration || desiredWrapper !== wrapper) return false;
  if (!iconEl.isConnected || !wrapper.isConnected || !shaderAllowed()) return false;

  const ring = ensureDom(iconEl);
  const metal = ring.querySelector('.benefits_rail-border__metal');
  if (!metal) return false;

  const tint = getShaderColorFromString(tintHex);
  // Dark metal base — tint comes from brand cyan --wg-accent.
  const back = getShaderColorFromString('#0c1214');

  // Re-check after every async boundary before touching the current mount.
  if (generation !== activationGeneration || desiredWrapper !== wrapper) return false;

  disconnectRailObserver();
  disposeActiveMount();
  if (activeHost && activeHost !== iconEl) activeHost.classList.remove('is-liquid-active');

  activeMount = new ShaderMount(
    metal,
    liquidMetalFragmentShader,
    {
      u_image: emptyImg,
      u_isImage: false,
      u_colorBack: back,
      u_colorTint: tint,
      u_repetition: 3.6,
      u_softness: 0.42,
      u_shiftRed: 0.18,
      u_shiftBlue: -0.14,
      u_distortion: 0.1,
      u_contour: 0.32,
      u_angle: 52,
      u_shape: LiquidMetalShapes.circle,
      u_fit: ShaderFitOptions.contain,
      u_scale: 1.05,
      u_rotation: 0,
      u_originX: 0.5,
      u_originY: 0.5,
      u_offsetX: 0,
      u_offsetY: 0,
      u_worldWidth: 0,
      u_worldHeight: 0,
    },
    { alpha: true, antialias: false, premultipliedAlpha: true },
    0,
    0,
    1,
    140 * 140,
  );

  activeHost = iconEl;
  activeAnchor = wrapper;
  lastTint = tintHex;
  desiredSpeed = BASE_SPEED;
  railPaused = false;
  iconEl.classList.add('is-liquid-active');
  observeActiveHost(iconEl);
  syncMountSpeed();
  return true;
}

/**
 * Activate liquid-metal ring on the selected rail dish.
 * @param {HTMLElement | null} wrapper .benefits_icon-wrapper
 */
export async function activateLiquidRailBorder(wrapper) {
  desiredWrapper = wrapper || null;

  if (!wrapper) {
    destroyMount();
    return;
  }

  if (!shaderAllowed()) {
    destroyMount({ preserveDesired: true });
    return;
  }

  const icon = wrapper.querySelector('.benefits_icon') || wrapper;
  const tintNow = accentHex();

  if (activeHost === icon && activeMount && tintNow === lastTint) {
    activeAnchor = wrapper;
    desiredSpeed = BASE_SPEED;
    railPaused = false;
    syncMountSpeed();
    return;
  }

  const generation = ++activationGeneration;
  clearBumpTimer();
  desiredSpeed = BASE_SPEED;

  try {
    await mountOn(icon, wrapper, generation, tintNow);
  } catch (err) {
    if (generation === activationGeneration && desiredWrapper === wrapper) {
      console.warn('[westo] liquid rail border failed', err);
    }
  }
}

export function clearLiquidRailBorder() {
  destroyMount();
}

export function bumpLiquidRailSpeed(temp = 1.4, ms = 280) {
  if (!activeMount?.setSpeed || !shaderAllowed()) return;
  if (reducedQuery?.matches) return;

  const requested = Number(temp);
  const duration = Number(ms);
  desiredSpeed = Number.isFinite(requested)
    ? Math.max(0, Math.min(BUMP_SPEED_MAX, requested))
    : 1.4;
  syncMountSpeed();

  clearBumpTimer();
  bumpTimer = window.setTimeout(
    () => {
      bumpTimer = 0;
      desiredSpeed = BASE_SPEED;
      syncMountSpeed();
    },
    Number.isFinite(duration) ? Math.max(0, duration) : 280,
  );
}

window.WestoLiquidRail = {
  activate: activateLiquidRailBorder,
  clear: clearLiquidRailBorder,
  bump: bumpLiquidRailSpeed,
};
