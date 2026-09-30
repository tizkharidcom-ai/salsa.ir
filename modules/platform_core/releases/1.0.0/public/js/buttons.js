/* WESTO desktop button hover animation.
   Stable-performance version:
   - keeps the exact two-layer GSAP hover treatment;
   - does not split/duplicate every .button during boot;
   - only enhances a button the first time the user actually hovers it;
   - resolves .char nodes fresh on every animation so auth-nav can safely
     replace the login/profile/admin label after the button was enhanced.
*/
(() => {
  'use strict';

  const DESKTOP_MIN_WIDTH = 992;
  const states = new WeakMap();

  function isEligible(btn) {
    if (!btn || !btn.classList?.contains('button')) return false;
    if (btn.closest('.sib-form')) return false;
    if (btn.classList.contains('menu-add-btn')) return false;
    if (btn.classList.contains('glass-button')) return false;
    if (btn.closest('#table-drawer')) return false;
    if (btn.closest('#qty-modal')) return false;
    return true;
  }

  function isArabicScript(text) {
    return /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/.test(text);
  }

  function splitPieces(text) {
    if (!isArabicScript(text)) return Array.from(text);

    const words = text.split(/\s+/).filter(Boolean);
    return words.map((word, index) => (
      index < words.length - 1 ? `${word} ` : word
    ));
  }

  function makeChar(piece) {
    const span = document.createElement('span');
    span.className = 'char';
    span.style.display = 'inline-block';
    span.textContent = piece === ' ' ? '\u00a0' : piece.replace(/ /g, '\u00a0');
    return span;
  }

  function fillLayer(layer, text) {
    const fragment = document.createDocumentFragment();
    splitPieces(text).forEach((piece) => fragment.appendChild(makeChar(piece)));
    layer.replaceChildren(fragment);
  }

  function createLayers(btn) {
    const icon = btn.querySelector('.button_icon');
    const iconClone = icon?.cloneNode(true) || null;
    icon?.remove();

    const text = btn.textContent.trim();

    const textWrap = document.createElement('div');
    textWrap.className = 'button_text';
    textWrap.style.overflow = 'hidden';
    textWrap.style.display = 'inline-flex';
    textWrap.style.position = 'relative';

    const top = document.createElement('div');
    top.className = 'layer-top';

    const bottom = document.createElement('div');
    bottom.className = 'layer-bottom';
    bottom.style.position = 'absolute';
    bottom.style.top = '0';
    bottom.style.left = '0';

    fillLayer(top, text);
    fillLayer(bottom, text);
    textWrap.append(top, bottom);

    btn.replaceChildren(textWrap);
    if (iconClone) btn.prepend(iconClone);

    return { top, bottom };
  }

  function getLayers(btn) {
    const top = btn.querySelector('.layer-top');
    const bottom = btn.querySelector('.layer-bottom');
    return top && bottom ? { top, bottom } : null;
  }

  function killTimeline(state) {
    if (!state?.timeline) return;
    try {
      state.timeline.kill();
    } catch (_) {}
    state.timeline = null;
  }

  function currentChars(btn) {
    const layers = getLayers(btn);
    if (!layers) return null;

    const top = Array.from(layers.top.querySelectorAll('.char'));
    const bottom = Array.from(layers.bottom.querySelectorAll('.char'));
    if (!top.length || !bottom.length) return null;

    return { ...layers, topChars: top, bottomChars: bottom };
  }

  function setRestingState(btn) {
    const chars = currentChars(btn);
    if (!chars) return false;

    if (window.gsap?.set) {
      window.gsap.set(chars.topChars, { y: '0%' });
      window.gsap.set(chars.bottomChars, { y: '110%' });
    } else {
      chars.topChars.forEach((char) => {
        char.style.transform = 'translateY(0%)';
      });
      chars.bottomChars.forEach((char) => {
        char.style.transform = 'translateY(110%)';
      });
    }
    return true;
  }

  function setHoveredState(btn) {
    const chars = currentChars(btn);
    if (!chars) return false;

    if (window.gsap?.set) {
      window.gsap.set(chars.topChars, { y: '-110%' });
      window.gsap.set(chars.bottomChars, { y: '0%' });
    } else {
      chars.topChars.forEach((char) => {
        char.style.transform = 'translateY(-110%)';
      });
      chars.bottomChars.forEach((char) => {
        char.style.transform = 'translateY(0%)';
      });
    }
    return true;
  }

  function observeDynamicLabel(btn, state) {
    if (btn.id !== 'nav-auth-btn' || state.labelObserver) return;

    state.labelObserver = new MutationObserver(() => {
      // auth-nav replaces the .char children after /api/auth/me resolves.
      // Do not cache NodeLists: reconcile the newly-created characters with
      // the pointer's current visual state instead.
      window.requestAnimationFrame(() => {
        if (!btn.isConnected) {
          state.labelObserver?.disconnect();
          state.labelObserver = null;
          return;
        }
        if (state.hovered) setHoveredState(btn);
        else setRestingState(btn);
      });
    });

    state.labelObserver.observe(btn, {
      childList: true,
      subtree: true,
    });
  }

  function enhance(btn) {
    let state = states.get(btn);
    if (state?.enhanced && currentChars(btn)) return state;

    state ||= {
      enhanced: false,
      hovered: false,
      timeline: null,
      labelObserver: null,
    };

    if (!window.gsap) return state;

    // bfcache / duplicate-script safety: adopt existing layers if another
    // execution already enhanced this button; otherwise build them now.
    if (!getLayers(btn)) createLayers(btn);

    state.enhanced = true;
    states.set(btn, state);
    setRestingState(btn);
    observeDynamicLabel(btn, state);
    return state;
  }

  function animate(btn, entering) {
    const state = enhance(btn);
    if (!state?.enhanced || !window.gsap) return;

    state.hovered = entering;
    killTimeline(state);

    const chars = currentChars(btn);
    if (!chars) return;

    window.gsap.killTweensOf([...chars.topChars, ...chars.bottomChars]);
    const stagger = Math.min(0.025, 0.25 / chars.topChars.length);

    const timeline = window.gsap.timeline();
    state.timeline = timeline;

    if (entering) {
      timeline
        .to(
          chars.topChars,
          { y: '-110%', stagger, duration: 0.4, ease: 'power3.inOut' },
          0,
        )
        .to(
          chars.bottomChars,
          { y: '0%', stagger, duration: 0.4, ease: 'power3.inOut' },
          0,
        );
    } else {
      timeline
        .to(
          chars.bottomChars,
          { y: '110%', stagger, duration: 0.4, ease: 'power3.inOut' },
          0,
        )
        .to(
          chars.topChars,
          { y: '0%', stagger, duration: 0.4, ease: 'power3.inOut' },
          0,
        );
    }
  }

  function bindButton(btn) {
    if (!isEligible(btn) || btn.dataset.westoButtonBound === '1') return;
    btn.dataset.westoButtonBound = '1';

    btn.addEventListener('mouseenter', () => animate(btn, true));
    btn.addEventListener('mouseleave', () => animate(btn, false));
  }

  function start() {
    // Preserve the stable site's original breakpoint semantics: a page that
    // starts at tablet/mobile width does not opt into desktop hover splitting.
    if (window.innerWidth < DESKTOP_MIN_WIDTH) return;

    document.querySelectorAll('.button').forEach(bindButton);
  }

  window.westoButtons = Object.freeze({
    enhance(btn) {
      if (!isEligible(btn)) return false;
      return Boolean(enhance(btn)?.enhanced);
    },
    refresh(btn) {
      if (!btn || !states.has(btn)) return false;
      const state = states.get(btn);
      return state.hovered ? setHoveredState(btn) : setRestingState(btn);
    },
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
