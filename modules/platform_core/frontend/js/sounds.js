const westOSoundsBoot = () => {
  // WESTO sound runtime.
  // Keep the original public API and sound cues, but keep Web Audio and the
  // audio files completely out of the critical boot path. Nothing is fetched
  // or decoded until the guest has actually interacted with the page.
  const SOUNDS = Object.freeze({
    change: 'assets/audio/westo-ui-scroll.mp3',
    enter: 'assets/audio/westo-ui-enter.mp3',
    benefits: 'assets/audio/westo-ui-transition.mp3',
    click: 'assets/audio/westo-ui-click.mp3',
  });

  const VOLUME = 0.5;
  const MAX_DEFERRED_PLAY_AGE_MS = 900;

  let ctx = null;
  let unlocked = false;
  let destroyed = false;

  const buffers = Object.create(null);
  const bufferPromises = Object.create(null);
  const playGenerations = Object.create(null);

  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;

  const isMuted = () => {
    const btn = document.querySelector('#nav-sound-btn');
    return btn ? btn.classList.contains('is-muted') : false;
  };

  const initCtx = () => {
    if (destroyed || ctx || !AudioContextCtor) return ctx;
    try {
      ctx = new AudioContextCtor();
    } catch (error) {
      console.warn('[westoSound] AudioContext unavailable', error);
      ctx = null;
    }
    return ctx;
  };

  const removeUnlockListeners = () => {
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('touchstart', unlock);
    window.removeEventListener('keydown', unlock);
    window.removeEventListener('wheel', unlock);
  };

  const ensureSound = (name) => {
    if (destroyed || !SOUNDS[name]) return Promise.resolve(null);
    if (buffers[name]) return Promise.resolve(buffers[name]);
    if (bufferPromises[name]) return bufferPromises[name];

    const audioCtx = initCtx();
    if (!audioCtx) return Promise.resolve(null);

    const scheduler = window.WestoResources;
    const bytesPromise = scheduler?.requestAudio
      ? scheduler.requestAudio(
          SOUNDS[name],
          scheduler.priorities?.BACKGROUND || 24,
        ).then((result) => result?.blob?.arrayBuffer?.() || null)
      : fetch(SOUNDS[name], {
          credentials: 'same-origin',
          cache: 'force-cache',
        }).then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.arrayBuffer();
        });

    const task = bytesPromise
      .then((arrayBuffer) => {
        if (!arrayBuffer) throw new Error('audio bytes unavailable');
        return audioCtx.decodeAudioData(arrayBuffer);
      })
      .then((buffer) => {
        if (!destroyed) buffers[name] = buffer;
        return buffer;
      })
      .catch((error) => {
        console.warn('[westoSound] load failed', name, error);
        return null;
      })
      .finally(() => {
        delete bufferPromises[name];
      });

    bufferPromises[name] = task;
    return task;
  };

  // Small, frequently-used cues are prepared after the first real gesture.
  // The two larger transition files remain strictly on-demand.
  const primeFrequentSounds = () => {
    ensureSound('click');
    ensureSound('change');
  };

  async function unlock() {
    if (destroyed || unlocked) return;
    const audioCtx = initCtx();
    if (!audioCtx) {
      removeUnlockListeners();
      return;
    }

    try {
      if (audioCtx.state === 'suspended') await audioCtx.resume();
    } catch (_) {
      // Some browsers reject resume for wheel/touch sequences that are not
      // considered an activation. Keep the listeners so a later click/keydown
      // can unlock the same context.
    }

    if (audioCtx.state !== 'running') return;

    unlocked = true;
    removeUnlockListeners();
    primeFrequentSounds();
  }

  window.addEventListener('pointerdown', unlock, { passive: true });
  window.addEventListener('touchstart', unlock, { passive: true });
  window.addEventListener('keydown', unlock);
  window.addEventListener('wheel', unlock, { passive: true });

  const startBuffer = async (name, volume, rate, requestedAt, generation) => {
    const buffer = buffers[name] || (await ensureSound(name));
    if (
      destroyed ||
      !buffer ||
      !unlocked ||
      isMuted() ||
      document.hidden ||
      playGenerations[name] !== generation ||
      performance.now() - requestedAt > MAX_DEFERRED_PLAY_AGE_MS
    ) {
      return false;
    }

    const audioCtx = ctx;
    if (!audioCtx) return false;

    try {
      if (audioCtx.state === 'suspended') await audioCtx.resume();
    } catch (_) {
      return false;
    }
    if (audioCtx.state !== 'running') return false;

    try {
      const source = audioCtx.createBufferSource();
      const gain = audioCtx.createGain();
      source.buffer = buffer;
      source.playbackRate.value = rate;
      gain.gain.value = VOLUME * volume;
      source.connect(gain).connect(audioCtx.destination);
      source.onended = () => {
        try {
          source.disconnect();
          gain.disconnect();
        } catch (_) {}
      };
      source.start(0);
      return true;
    } catch (error) {
      console.warn('[westoSound] play failed', name, error);
      return false;
    }
  };

  const play = (name, { volume = 1, rate = 1 } = {}) => {
    if (destroyed || !SOUNDS[name] || !unlocked || isMuted() || document.hidden) return false;

    const generation = (playGenerations[name] || 0) + 1;
    playGenerations[name] = generation;
    const requestedAt = performance.now();

    if (buffers[name]) {
      void startBuffer(name, volume, rate, requestedAt, generation);
      return true;
    }

    // Keep only the latest pending cue of a given type while its file is being
    // fetched/decoded. Rapid carousel changes therefore do not burst several
    // delayed sounds once the first decode completes.
    void startBuffer(name, volume, rate, requestedAt, generation);
    return true;
  };

  // Programmatic navigation suppresses scroll-transition cues temporarily.
  const nav = { lock: false, timer: null };
  const lockNav = (ms = 1200) => {
    nav.lock = true;
    if (nav.timer) clearTimeout(nav.timer);
    nav.timer = setTimeout(() => {
      nav.timer = null;
      nav.lock = false;
    }, ms);
  };

  window.westoSound = { play, lockNav };

  // === Carousel change cue ===
  let carouselBound = false;
  const bindCarousel = () => {
    if (carouselBound || !window.carousel || !window.carousel.changed) return false;
    carouselBound = true;
    window.carousel.changed.connect(() => play('change'));
    return true;
  };
  if (!bindCarousel()) {
    window.addEventListener('carousel:ready', bindCarousel, { once: true });
  }

  // === Scroll transition cues ===
  // One Lenis listener owns both the hero-enter and benefits cues. The old
  // implementation registered two independent handlers and rebuilt geometry
  // through monkey-patched globals. Geometry is now cached and refreshed only
  // on actual layout/language changes.
  let lenisBound = false;
  let boundary = 0;
  let sections = [];
  let layoutRaf = 0;
  let inHome = true;
  let lastScroll = 0;
  let lastIdx = 0;
  let lastDishSlot = -1;

  const visibleSection = (el) => {
    if (!el || el.hasAttribute('hidden')) return false;
    if (el.closest('.loader, #westo-entrance, .entrance-gate')) return false;
    return getComputedStyle(el).display !== 'none';
  };

  const activeDishSlot = () => {
    const active = document.querySelector('section.is-benefits.is-dish-active:not([hidden])');
    if (!active || active.style.display === 'none') return -1;
    return Number(active.dataset.menuSlot) || 0;
  };

  const currentIndex = (pos) => {
    if (!sections.length) return 0;
    let best = 0;
    let dist = Infinity;
    for (let i = 0; i < sections.length; i += 1) {
      const d = Math.abs(sections[i].top - pos);
      if (d < dist) {
        dist = d;
        best = i;
      }
    }
    return best;
  };

  const rebuildLayout = () => {
    layoutRaf = 0;
    if (destroyed) return;

    const first =
      document.querySelector('section.section.is-gamme') || document.querySelector('section.section');
    boundary = first ? first.clientHeight : 0;

    let top = 0;
    const nextSections = [];
    document.querySelectorAll('section.section').forEach((el) => {
      if (!visibleSection(el)) return;
      nextSections.push({
        top,
        isBenefits: el.classList.contains('is-benefits'),
      });
      top += el.clientHeight;
    });
    sections = nextSections;

    const pos = window.lenis?.animatedScroll || window.scrollY || 0;
    if (!lenisBound) {
      lastIdx = currentIndex(pos);
      lastDishSlot = activeDishSlot();
    }
  };

  const scheduleLayout = () => {
    if (destroyed || layoutRaf) return;
    layoutRaf = requestAnimationFrame(rebuildLayout);
  };

  const wrap = (value, min, max) => {
    const size = max - min;
    if (size <= 0) return min;
    let out = value % size;
    if (out < 0) out += size;
    return out + min;
  };

  const bindLenis = () => {
    if (lenisBound || !window.lenis) return false;
    lenisBound = true;

    rebuildLayout();
    lastScroll = window.lenis.animatedScroll || 0;
    lastIdx = currentIndex(lastScroll);
    lastDishSlot = activeDishSlot();

    window.lenis.on('scroll', () => {
      if (destroyed) return;

      const cur = window.lenis.animatedScroll || 0;
      const goingDown = cur > lastScroll;
      const threshold = Math.max(boundary * 0.03, 24);

      if (inHome && cur >= threshold) {
        inHome = false;
        if (goingDown && !nav.lock) play('enter');
      } else if (!inHome && cur < threshold) {
        inHome = true;
      }
      lastScroll = cur;

      if (document.documentElement.classList.contains('is-dish-boards')) {
        const slot = activeDishSlot();
        if (slot >= 0 && lastDishSlot >= 0 && slot !== lastDishSlot) {
          if (Math.abs(slot - lastDishSlot) === 1 && !nav.lock) play('benefits');
          lastDishSlot = slot;
        } else if (slot >= 0) {
          lastDishSlot = slot;
        }
        return;
      }

      lastDishSlot = -1;
      const dimensions = window.lenis.dimensions;
      const max = dimensions ? dimensions.scrollHeight - dimensions.height : 0;
      if (max <= 0 || !sections.length) return;

      const pos = wrap(cur, 0, max);
      const idx = currentIndex(pos);
      if (idx === lastIdx) return;

      const adjacent = Math.abs(idx - lastIdx) === 1;
      if (adjacent && sections[idx]?.isBenefits && !nav.lock) play('benefits');
      lastIdx = idx;
    });

    return true;
  };

  if (!bindLenis()) {
    window.addEventListener('carousel:ready', () => {
      bindLenis();
      scheduleLayout();
    }, { once: true });
  }

  window.addEventListener('resize', scheduleLayout, { passive: true });
  document.addEventListener('westo:relayout', scheduleLayout);
  document.addEventListener('westo:langchange', scheduleLayout);
  window.addEventListener('load', scheduleLayout, { once: true });
  if (document.fonts?.ready) {
    document.fonts.ready.then(scheduleLayout).catch(() => {});
  }

  // === Menu / FAQ click cue ===
  // Delegation keeps one listener instead of binding every current link and it
  // also covers FAQ/menu nodes that may be cloned later by content/menu code.
  document.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    if (target.closest('.navbar_menu-button')) {
      play('click');
    }

    if (target.closest('.navbar_link')) {
      play('click');
      lockNav();
    }

    if (target.closest('.faq_question')) {
      play('click');
    }
  });

  const syncVisibility = () => {
    if (!ctx) return;
    if (document.hidden) {
      try {
        void ctx.suspend();
      } catch (_) {}
      return;
    }
    if (unlocked && ctx.state === 'suspended') {
      try {
        void ctx.resume();
      } catch (_) {}
    }
  };

  document.addEventListener('visibilitychange', syncVisibility);

  window.addEventListener('pagehide', () => {
    if (nav.timer) {
      clearTimeout(nav.timer);
      nav.timer = null;
      nav.lock = false;
    }
    if (layoutRaf) {
      cancelAnimationFrame(layoutRaf);
      layoutRaf = 0;
    }
    if (ctx?.state === 'running') {
      try {
        void ctx.suspend();
      } catch (_) {}
    }
  });

  window.addEventListener('pageshow', () => {
    scheduleLayout();
    syncVisibility();
  });
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', westOSoundsBoot, { once: true });
} else {
  westOSoundsBoot();
}

