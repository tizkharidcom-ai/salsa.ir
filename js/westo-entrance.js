/**
 * WESTO Immersive Entrance — visual phases + ambient FX.
 * Gate I/O (sheet, fillGate, enter) stays in animations.js;
 * this module owns brand reveal, story loader, parallax, particles,
 * and cinematic exit hooks.
 */
(function (global) {
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => [...(r || document).querySelectorAll(s)];

  let root = null;
  let gsap = null;
  let reduced = false;
  let particlesRaf = 0;
  let particlesTimer = 0;
  let particlesResizeRaf = 0;
  let particlesLastTime = 0;
  let particleIntervalMs = 1000 / 30;
  let bootTimer = 0;
  let initialized = false;
  let progressTween = null;
  let storyTween = null;
  let parallaxBound = false;
  let steamExpandTl = null;
  let particlesRunning = false;
  let onParticlesVis = null;
  let parallaxMove = null;
  let parallaxLeave = null;
  let parallaxRaf = 0;
  let particlesResize = null;
  let onPerformanceTier = null;
  let onThermalIdle = null;
  let onThermalWake = null;

  const state = {
    progress: 0,
    step: -1,
    ready: false,
    phase: 0,
  };

  function tr(key, vars) {
    return global.westoI18n?.t ? global.westoI18n.t(key, vars) : key;
  }

  const DEFAULT_PATTERN = 'assets/images/entrance/westo-pattern.webp';

  function applyPatternAsset() {
    if (!root) return;
    let src = String(global.__WESTO_CONTENT__?.content?.['entrance.pattern'] || DEFAULT_PATTERN).trim();
    if (!/^(?:\/|assets\/|uploads\/|https?:\/\/)/i.test(src)) src = DEFAULT_PATTERN;
    src = src.replace(/[\"'\n\r\\]/g, '');
    if (!src) src = DEFAULT_PATTERN;
    try { src = new URL(src, document.baseURI).href; } catch (_) {}
    const apply = (resolved) => {
      const asset = String(resolved || src);
      root.style.setProperty('--eg-pattern-image', `url("${asset}")`);
      root.dataset.egPattern = asset;
    };
    const scheduler = global.WestoResources;
    if (!scheduler?.requestImage) {
      apply(src);
      return;
    }
    // Decoration is non-blocking and follows the same WebP-only policy as
    // menu media. The CSS variable is written only after the image resolves.
    scheduler.requestImage(src, {
      priority: scheduler.priorities?.NEAR,
      group: 'entrance-pattern',
      kind: 'image',
    }).then((result) => apply(result?.url)).catch(() => apply(src));
  }

  /* —— Brand logo reveal (PNG + steam) —— */
  function playLogoReveal() {
    const png = $('.eg-logo-png', root);
    const stage = $('[data-eg-logo]', root);
    const title = $('.eg-brand-title', root);
    const tag = $('.eg-tagline', root);
    const sub = $('.eg-subtitle', root);

    if (!gsap) {
      if (png) png.style.opacity = '1';
      root?.classList.add('is-steam-on');
      return;
    }

    gsap.set([stage, title, tag, sub].filter(Boolean), { autoAlpha: 0, y: 16, scale: 0.92 });
    if (stage) gsap.set(stage, { scale: 0.85 });
    if (png) gsap.set(png, { autoAlpha: 0, scale: 0.92 });

    const tl = gsap.timeline({ defaults: { ease: 'power2.out' } });
    tl.to(stage, { autoAlpha: 1, scale: 1, duration: 0.55 }, 0);
    tl.to(
      png,
      {
        autoAlpha: 1,
        scale: 1,
        duration: 0.85,
        ease: 'power2.out',
        onStart: () => root?.classList.add('is-steam-on'),
      },
      0.2,
    );
    tl.to(
      [title, tag, sub].filter(Boolean),
      { autoAlpha: 1, y: 0, duration: 0.7, stagger: 0.08 },
      0.45,
    );

    return tl;
  }

  /* —— Particles (lightweight canvas) —— */
  function stopParticles() {
    particlesRunning = false;
    particlesLastTime = 0;
    if (particlesTimer) {
      clearTimeout(particlesTimer);
      particlesTimer = 0;
    }
    if (particlesRaf) {
      cancelAnimationFrame(particlesRaf);
      particlesRaf = 0;
    }
  }

  function initParticles() {
    const canvas = $('#eg-particles', root);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const isMobile = () => window.innerWidth < 768;
    let parts = [];
    let w = 0;
    let h = 0;

    const resizeNow = () => {
      w = canvas.clientWidth || window.innerWidth;
      h = canvas.clientHeight || window.innerHeight;
      const perf = global.westoPerformance;
      const tier = perf?.tier || 'balanced';
      const maxDpr = Math.min(Number(perf?.quality?.maxDpr) || 1.25, isMobile() ? 1 : 1.25);
      // The old loop painted at 20fps on economy and 30fps otherwise while
      // still waking requestAnimationFrame at display refresh rate. Keep the
      // exact visible cadence, but only wake the canvas when a paint is due.
      particleIntervalMs = tier === 'balanced' ? 1000 / 24 : 1000 / 30;
      const dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const n = reduced
        ? 0
        : tier === 'economy'
          ? 0
          : tier === 'balanced'
            ? isMobile()
              ? 3
              : 6
            : isMobile()
              ? 4
              : 10;
      parts = Array.from({ length: n }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        r: 0.6 + Math.random() * 1.6,
        a: 0.12 + Math.random() * 0.28,
        vy: -0.12 - Math.random() * 0.28,
        vx: (Math.random() - 0.5) * 0.15,
      }));
    };

    particlesResize = () => {
      if (particlesResizeRaf) return;
      particlesResizeRaf = requestAnimationFrame(() => {
        particlesResizeRaf = 0;
        if (!root || root.hidden) return;
        resizeNow();
      });
    };

    const queueNextPaint = () => {
      if (
        !particlesRunning ||
        particlesTimer ||
        particlesRaf ||
        !root ||
        root.hidden ||
        document.visibilityState === 'hidden'
      ) {
        return;
      }
      // Compensate for the average wait until the next display frame so the
      // actual paint cadence remains close to the previous 20/30fps output.
      const timerDelay = Math.max(0, particleIntervalMs - 9);
      particlesTimer = window.setTimeout(() => {
        particlesTimer = 0;
        if (!particlesRunning || !root || root.hidden || document.visibilityState === 'hidden') {
          return;
        }
        particlesRaf = requestAnimationFrame(tick);
      }, timerDelay);
    };

    const tick = (now) => {
      particlesRaf = 0;
      if (!particlesRunning || !root || root.hidden || document.visibilityState === 'hidden') {
        return;
      }

      // Position used to advance on every 60Hz RAF even though only every
      // second/third frame was painted. Scale by elapsed 60Hz frames so the
      // visible drift speed remains the same at the lower wake cadence.
      const elapsed = particlesLastTime ? now - particlesLastTime : particleIntervalMs;
      particlesLastTime = now;
      const step = Math.max(0.5, Math.min(4, elapsed / (1000 / 60)));

      ctx.clearRect(0, 0, w, h);
      const light = document.documentElement.getAttribute('data-theme') === 'light';
      for (let i = 0; i < parts.length; i += 1) {
        const p = parts[i];
        p.x += p.vx * step;
        p.y += p.vy * step;
        if (p.y < -4) {
          p.y = h + 4;
          p.x = Math.random() * w;
        }
        if (p.x < -4) p.x = w + 4;
        if (p.x > w + 4) p.x = -4;
        ctx.beginPath();
        ctx.fillStyle = light
          ? `rgba(42,122,134,${p.a * 0.9})`
          : `rgba(120,208,216,${p.a})`;
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
      queueNextPaint();
    };

    const start = () => {
      if (reduced || !parts.length || particlesRunning || !root || root.hidden) return;
      particlesRunning = true;
      particlesLastTime = 0;
      if (!particlesRaf && !particlesTimer) particlesRaf = requestAnimationFrame(tick);
    };

    resizeNow();
    window.addEventListener('resize', particlesResize, { passive: true });
    onPerformanceTier = () => {
      resizeNow();
      if (global.westoPerformance?.isEconomy) {
        unbindParallax();
        stopParticles();
      } else {
        start();
      }
    };
    window.addEventListener('westo:performance-tier', onPerformanceTier);
    onParticlesVis = () => {
      if (document.visibilityState === 'hidden' || root?.hidden) stopParticles();
      else start();
    };
    document.addEventListener('visibilitychange', onParticlesVis);
    onThermalIdle = () => stopParticles();
    onThermalWake = () => {
      if (!global.westoPerformance?.isEconomy && document.visibilityState !== 'hidden' && !root?.hidden) start();
    };
    window.addEventListener('westo:thermal-idle', onThermalIdle);
    window.addEventListener('westo:thermal-wake', onThermalWake);
    if (document.documentElement.dataset.thermalIdle !== 'true') start();
  }

  function unbindParallax() {
    if (!parallaxBound) return;
    if (parallaxMove) window.removeEventListener('pointermove', parallaxMove);
    if (parallaxLeave) window.removeEventListener('pointerleave', parallaxLeave);
    parallaxMove = null;
    parallaxLeave = null;
    if (parallaxRaf) cancelAnimationFrame(parallaxRaf);
    parallaxRaf = 0;
    parallaxBound = false;
  }

  function destroyFx() {
    stopParticles();
    unbindParallax();
    if (bootTimer) {
      clearTimeout(bootTimer);
      bootTimer = 0;
    }
    if (particlesResizeRaf) {
      cancelAnimationFrame(particlesResizeRaf);
      particlesResizeRaf = 0;
    }
    progressTween?.kill?.();
    storyTween?.kill?.();
    steamExpandTl?.kill?.();
    progressTween = null;
    storyTween = null;
    steamExpandTl = null;
    if (onParticlesVis) {
      document.removeEventListener('visibilitychange', onParticlesVis);
      onParticlesVis = null;
    }
    if (particlesResize) {
      window.removeEventListener('resize', particlesResize);
      particlesResize = null;
    }
    if (onPerformanceTier) {
      window.removeEventListener('westo:performance-tier', onPerformanceTier);
      onPerformanceTier = null;
    }
    if (onThermalIdle) {
      window.removeEventListener('westo:thermal-idle', onThermalIdle);
      onThermalIdle = null;
    }
    if (onThermalWake) {
      window.removeEventListener('westo:thermal-wake', onThermalWake);
      onThermalWake = null;
    }
    root?.classList.add('is-fx-off');
  }

  /* —— Story loader + progress —— */
  function setProgress(pct) {
    const p = Math.max(0, Math.min(100, Math.round(pct)));
    state.progress = p;
    const cta = $('#eg-enter', root);
    const label = $('#eg-progress-pct', root);
    const bar = $('#eg-progress', root);
    if (cta) {
      cta.style.setProperty('--eg-progress', `${p}%`);
      cta.dataset.progress = String(p);
      cta.setAttribute('aria-busy', p < 100 ? 'true' : 'false');
    }
    if (label) label.textContent = `${p}%`;
    if (bar) {
      bar.setAttribute('aria-valuenow', String(p));
      bar.textContent = `${p}%`;
    }
  }

  function setStep(index) {
    state.step = index;
    $$('[data-eg-step]', root).forEach((el) => {
      const i = Number(el.getAttribute('data-eg-step'));
      el.classList.toggle('is-active', i === index);
      el.classList.toggle('is-done', i < index);
    });
    const keys = ['eg.feature.digitalMenu', 'eg.feature.onlineOrder', 'eg.feature.reserveTable', 'eg.feature.quickEntry'];
    $$('.eg-step-icon[data-eg-step]', root).forEach((el) => {
      const i = Number(el.getAttribute('data-eg-step'));
      const key = keys[i];
      if (key) el.setAttribute('aria-label', tr(key));
    });
  }

  function startExperienceLoader() {
    setStep(0);

    // Scene may already be ready (carousel:ready before the ~1.6s delay).
    // Never re-clamp a finished loader back to 92%.
    if (state.ready) {
      setProgress(100);
      setStep(3);
      return;
    }

    setProgress(0);

    if (!gsap || reduced) {
      setProgress(100);
      setStep(3);
      return;
    }

    const proxy = { p: 0 };
    progressTween?.kill?.();
    storyTween?.kill?.();

    progressTween = gsap.to(proxy, {
      p: 92,
      duration: 4.2,
      ease: 'power1.out',
      onUpdate: () => {
        if (state.ready) return;
        setProgress(proxy.p);
      },
    });

    storyTween = gsap.timeline();
    [0, 1, 2, 3].forEach((i) => {
      storyTween.call(
        () => {
          if (!state.ready) setStep(i);
        },
        null,
        i * 0.95,
      );
    });
  }

  function completeExperienceLoader() {
    if (state.ready && state.progress >= 100) {
      setStep(3);
      return;
    }
    state.ready = true;
    root?.classList.add('is-experience-ready');
    progressTween?.kill?.();
    storyTween?.kill?.();
    if (gsap) {
      const proxy = { p: Math.max(state.progress, 0) };
      progressTween = gsap.to(proxy, {
        p: 100,
        duration: 0.45,
        ease: 'power2.out',
        onUpdate: () => setProgress(proxy.p),
        onComplete: () => {
          setProgress(100);
          setStep(3);
        },
      });
    } else {
      setProgress(100);
      setStep(3);
    }
  }

  /* —— Parallax —— */
  function bindParallax() {
    if (parallaxBound || !gsap || reduced) return;
    if (global.westoPerformance?.isEconomy) return;
    const card = $('[data-eg-card]', root);
    const logo = $('[data-eg-logo]', root);
    const reflect = $('.eg-card__reflect', root);
    if (!card) return;
    if (window.matchMedia('(max-width: 767px)').matches) return;

    parallaxBound = true;
    // quickTo/resetTo cannot reset individual 3D transform components in the
    // bundled GSAP build. A tiny damped loop keeps the same soft tilt without
    // warning spam or allocating a tween on every pointer event.
    const setRotX = gsap.quickSetter(card, 'rotationX', 'deg');
    const setRotY = gsap.quickSetter(card, 'rotationY', 'deg');
    const tilt = { x: 0, y: 0, targetX: 0, targetY: 0 };
    const renderTilt = () => {
      parallaxRaf = 0;
      tilt.x += (tilt.targetX - tilt.x) * 0.16;
      tilt.y += (tilt.targetY - tilt.y) * 0.16;
      setRotX(tilt.x);
      setRotY(tilt.y);
      if (Math.abs(tilt.targetX - tilt.x) > 0.01 || Math.abs(tilt.targetY - tilt.y) > 0.01) {
        parallaxRaf = requestAnimationFrame(renderTilt);
      }
    };
    const rotX = (value) => {
      tilt.targetX = value;
      if (!parallaxRaf) parallaxRaf = requestAnimationFrame(renderTilt);
    };
    const rotY = (value) => {
      tilt.targetY = value;
      if (!parallaxRaf) parallaxRaf = requestAnimationFrame(renderTilt);
    };
    const logoX = logo ? gsap.quickTo(logo, 'x', { duration: 0.55, ease: 'power3.out' }) : null;
    const logoY = logo ? gsap.quickTo(logo, 'y', { duration: 0.55, ease: 'power3.out' }) : null;

    parallaxMove = (e) => {
      if (root?.hidden || document.visibilityState === 'hidden') return;
      const nx = (e.clientX / window.innerWidth) * 2 - 1;
      const ny = (e.clientY / window.innerHeight) * 2 - 1;
      rotY(nx * 3);
      rotX(-ny * 2.4);
      logoX?.(nx * 5);
      logoY?.(ny * 4);
      if (reflect) {
        reflect.style.backgroundPosition = `${50 + nx * 18}% ${40 + ny * 12}%`;
      }
    };

    parallaxLeave = () => {
      rotX(0);
      rotY(0);
      logoX?.(0);
      logoY?.(0);
    };

    window.addEventListener('pointermove', parallaxMove, { passive: true });
    window.addEventListener('pointerleave', parallaxLeave, { passive: true });
    gsap.set(card, { transformPerspective: 1100 });
  }

  /* —— Cinematic exit helpers —— */
  function playExitPrelude() {
    // Kill continuous FX before the exit timeline so GPU cools during the handoff.
    destroyFx();
    if (!gsap || !root) return Promise.resolve();
    const card = $('[data-eg-card]', root);
    const steam = $('.eg-steam', root);
    const ambient = $('.eg-ambient', root);
    const logo = $('[data-eg-logo]', root);
    const cup = $('.eg-cup-stage', root);

    steamExpandTl?.kill?.();
    steamExpandTl = gsap.timeline({ defaults: { ease: 'power2.inOut' } });
    if (steam) {
      steamExpandTl.to(steam, { scale: 3.2, autoAlpha: 0, duration: 0.55 }, 0);
    }
    if (cup) {
      steamExpandTl.to(cup, { autoAlpha: 0, x: -40, duration: 0.5 }, 0);
    }
    if (logo) {
      steamExpandTl.to(logo, { y: -36, scale: 0.72, autoAlpha: 0.35, duration: 0.65 }, 0.05);
    }
    if (card) {
      steamExpandTl.to(card, { autoAlpha: 0, y: 28, scale: 0.96, duration: 0.6 }, 0.12);
    }
    if (ambient) {
      steamExpandTl.to(ambient, { autoAlpha: 0, duration: 0.7 }, 0.18);
    }
    return new Promise((resolve) => {
      steamExpandTl.eventCallback('onComplete', resolve);
      if (steamExpandTl.duration() === 0) resolve();
    });
  }

  function applyStatusUi({ open, loading, label, meta, location }) {
    const statusEl = $('[data-eg="status"]', root);
    const statusLabel = $('[data-eg="status-label"]', root);
    const statusMeta = $('[data-eg="status-meta"]', root);
    const statusLoc = $('[data-eg="status-loc"]', root);
    if (!statusEl) return;
    statusEl.classList.toggle('is-loading', !!loading);
    statusEl.classList.toggle('is-open', !loading && !!open);
    statusEl.classList.toggle('is-closed', !loading && !open);
    if (statusLabel && label != null) statusLabel.textContent = label;
    if (statusMeta) statusMeta.textContent = meta || '';
    if (statusLoc) statusLoc.textContent = location || '';
  }

  function bootPhases() {
    state.phase = 1;
    playLogoReveal();
    // Phase 2 status is filled by animations.js fillGate — show loading until then
    applyStatusUi({
      loading: true,
      open: false,
      label: tr('eg.statusPreparing'),
      meta: '',
    });
    if (bootTimer) clearTimeout(bootTimer);
    bootTimer = window.setTimeout(() => {
      bootTimer = 0;
      if (!root || root.hidden) return;
      state.phase = 3;
      startExperienceLoader();
    }, reduced ? 200 : 1600);
  }

  function init(opts = {}) {
    const nextRoot = document.getElementById('westo-entrance') || $('.loader.entrance-gate');
    if (!nextRoot) return null;
    // animations.js is the gate owner. If Webflow or a recovery path asks for
    // init again on the same gate, do not duplicate listeners/RAF/timelines.
    if (initialized && root === nextRoot) return api;
    if (initialized && root !== nextRoot) destroyFx();
    root = nextRoot;
    initialized = true;
    root.classList.remove('is-fx-off');
    gsap = opts.gsap || global.gsap;
    reduced = Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches);
    applyPatternAsset();

    // Initial hide for staged reveal
    if (gsap) {
      gsap.set(['.eg-card', '.eg-top', '.eg-foot', '.eg-experience'], {
        autoAlpha: 0,
      });
      gsap.to(['.eg-top', '.eg-foot'], {
        autoAlpha: 1,
        duration: 0.7,
        stagger: 0.08,
        delay: 0.15,
        ease: 'power3.out',
      });
      gsap.to('.eg-card', {
        autoAlpha: 1,
        duration: 0.85,
        delay: 0.2,
        ease: 'power3.out',
      });
      gsap.to('.eg-experience', {
        autoAlpha: 1,
        duration: 0.6,
        delay: 1.2,
        ease: 'power2.out',
      });
    }

    initParticles();
    bindParallax();
    bootPhases();

    return api;
  }

  const api = {
    init,
    setProgress,
    setStep,
    completeExperienceLoader,
    playExitPrelude,
    destroyFx,
    applyStatusUi,
    getState: () => ({ ...state }),
  };

  global.westoEntrance = api;
})(typeof window !== 'undefined' ? window : globalThis);
