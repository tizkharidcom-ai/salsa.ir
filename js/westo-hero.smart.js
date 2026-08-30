/* WESTO Smart Load generated bundle: js/westo-hero.smart.js
   Sources: js/animations.js, js/sounds.js
*/

/* ===== BEGIN js/animations.js ===== */

  const westOAnimationsBoot = () => {
    // #region Helpers

    const $ = (selector, parent = document) => parent.querySelector(selector);
    const $$ = (selector, parent = document) => parent.querySelectorAll(selector);
    const clamp = (v, min, max) => Math.min(Math.max(v, min), max);

    // Debounce util (mutualisé pour colors / video)
    const debounce = (fn, ms = 150) => {
      let t = null;
      return (...args) => {
        if (t) clearTimeout(t);
        t = setTimeout(() => {
          fn(...args);
          t = null;
        }, ms);
      };
    };

    // Breakpoints

    const bp = {
      mobile: window.matchMedia('(max-width: 991px)'),
      desktop: window.matchMedia('(min-width: 992px)'),
    };

    const isMobile = () => bp.mobile.matches;
    const isDesktop = () => bp.desktop.matches;
    const prefersReducedMotion = () =>
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    /* Weak phones: clip-path + blur + SplitText together hitch hard. */
    const prefersMenuLite = () => {
      if (prefersReducedMotion()) return true;
      if (isMobile()) return true;
      const cores = Number(navigator.hardwareConcurrency) || 0;
      const mem = Number(navigator.deviceMemory) || 0;
      return (cores > 0 && cores <= 4) || (mem > 0 && mem <= 4);
    };

    // SplitText

    const createLinesMask = (el, options = {}) => {
      const { stagger = 0.08, duration = 0.7, ease = 'power3.out' } = options;
      if (!el || !String(el.textContent || '').trim()) {
        return { in: () => {}, out: () => {}, revert: () => {} };
      }

      if (prefersMenuLite() || !window.SplitText) {
        gsap.set(el, { opacity: 0, y: 16 });
        return {
          in: ({ delay = 0 } = {}) =>
            gsap.to(el, {
              opacity: 1,
              y: 0,
              duration: duration * 0.85,
              ease,
              delay,
              overwrite: true,
            }),
          out: ({ delay = 0 } = {}) =>
            gsap.to(el, {
              opacity: 0,
              y: -16,
              duration: duration * 0.85,
              ease: 'power2.in',
              delay,
              overwrite: true,
            }),
          revert: () => {
            gsap.set(el, { clearProps: 'opacity,transform' });
          },
        };
      }

      const split = new SplitText(el, {
        type: 'lines',
        mask: 'lines',
        linesClass: 'line',
      });
      const targets = split.lines;
      if (!targets?.length) {
        return { in: () => {}, out: () => {}, revert: () => split.revert() };
      }

      gsap.set(targets, { yPercent: 110 });

      return {
        in: ({ delay = 0 } = {}) =>
          gsap.to(targets, {
            yPercent: 0,
            duration,
            ease,
            stagger,
            delay,
            overwrite: true,
          }),
        out: ({ delay = 0 } = {}) =>
          gsap.to(targets, {
            yPercent: -110,
            duration,
            ease,
            stagger,
            delay,
            overwrite: true,
          }),
        revert: () => split.revert(),
      };
    };

    const createCharsMask = (el, options = {}) => {
      const { stagger = 0.01, duration = 0.6, ease = 'power3.out' } = options;
      if (!el || !String(el.textContent || '').trim()) {
        return { in: () => {}, out: () => {}, revert: () => {} };
      }

      if (prefersMenuLite() || !window.SplitText) {
        gsap.set(el, { opacity: 0, y: 14 });
        return {
          in: ({ delay = 0 } = {}) =>
            gsap.to(el, {
              opacity: 1,
              y: 0,
              duration: duration * 0.85,
              ease,
              delay,
              overwrite: true,
            }),
          out: ({ delay = 0 } = {}) =>
            gsap.to(el, {
              opacity: 0,
              y: -14,
              duration: duration * 0.85,
              ease: 'power2.in',
              delay,
              overwrite: true,
            }),
          revert: () => {
            gsap.set(el, { clearProps: 'opacity,transform' });
          },
        };
      }

      // Arabic-script letters are joined; splitting per char breaks shaping.
      const isArabicScript = /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/.test(el.textContent);
      const split = new SplitText(el, {
        type: isArabicScript ? 'lines,words' : 'lines,chars',
        mask: 'lines',
        linesClass: 'line',
      });
      const targets = isArabicScript ? split.words : split.chars;
      if (!targets?.length) {
        return { in: () => {}, out: () => {}, revert: () => split.revert() };
      }

      gsap.set(targets, { yPercent: 110 });

      return {
        in: ({ delay = 0 } = {}) =>
          gsap.to(targets, {
            yPercent: 0,
            duration,
            ease,
            stagger,
            delay,
            overwrite: true,
          }),
        out: ({ delay = 0 } = {}) =>
          gsap.to(targets, {
            yPercent: -110,
            duration,
            ease,
            stagger,
            delay,
            overwrite: true,
          }),
        revert: () => split.revert(),
      };
    };

    const initAnimations = (parent = document, excludeSelector = '') => {
      const all = $$('[data-anim]', parent);
      const els = excludeSelector ? [...all].filter((el) => !el.closest(excludeSelector)) : [...all];
      if (!els.length) return null;

      const instances = [];

      els.forEach((el) => {
        const type = el.dataset.anim;
        const stagger = parseFloat(el.dataset.animStagger) || undefined;
        const duration = parseFloat(el.dataset.animDuration) || undefined;
        const ease = el.dataset.animEase || undefined;

        const opts = { stagger, duration, ease };
        let anim = null;

        if (type === 'lines-mask') {
          anim = createLinesMask(el, opts);
        }

        if (type === 'chars-mask') {
          anim = createCharsMask(el, opts);
        }

        if (anim) instances.push(anim);
      });

      if (!instances.length) return null;

      return {
        in: (opts) => instances.forEach((a) => a.in(opts)),
        out: (opts) => instances.forEach((a) => a.out(opts)),
        revert: () => instances.forEach((a) => a.revert()),
      };
    };

    // #region Entrance gate (replaces auto preloader)

    const initLoader = () => {
      const loaderWrapper = $('.loader');
      const gammeContainer = $('.gamme_container');
      const navbar = $('.navbar');
      const hud = $('.hud');
      const hudLeft = $('.hud_left');
      const hudRight = $('.hud_right');
      // Three.js appends WebGL as a direct child of <main>; never pick #eg-particles
      const getSceneCanvas = () => {
        const direct = document.querySelector('main > canvas:not(#eg-particles)');
        if (direct) return direct;
        return (
          [...document.querySelectorAll('canvas')].find(
            (c) => c.id !== 'eg-particles' && !c.classList?.contains('eg-ambient__particles'),
          ) || null
        );
      };
      const enterBtn = $('#eg-enter');
      const enterLabel = $('#eg-cta-label');
      const siteMenuBtn = $('#eg-site-menu');
      const sheet = $('#eg-sheet');
      const sheetScrim = $('#eg-scrim');
      const sheetTitle = $('#eg-sheet-title');
      const siteNav = $('.eg-site-nav', loaderWrapper);
      const infoTabs = $('#eg-info-tabs');
      const sheetCloseBtn = $('[data-eg-sheet-close]', loaderWrapper);
      let sheetFocusReturn = null;

      const focusablesIn = (container) => {
        if (!container) return [];
        return $$('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])', container)
          .filter((el) => !el.hidden && el.getClientRects().length && el.getAttribute('aria-hidden') !== 'true');
      };
      const setSceneAccessibility = (blocked) => {
        const canvas = getSceneCanvas();
        [gammeContainer, navbar, hud, canvas].filter(Boolean).forEach((el) => {
          if (blocked) {
            el.setAttribute('inert', '');
            el.setAttribute('aria-hidden', 'true');
          } else {
            el.removeAttribute('inert');
            el.removeAttribute('aria-hidden');
          }
        });
      };

      if ('scrollRestoration' in history) {
        history.scrollRestoration = 'manual';
      }

      window.scrollTo(0, 0);
      window.lenis?.scrollTo(0, { immediate: true });
      window.addEventListener('load', () => {
        window.scrollTo(0, 0);
        window.lenis?.scrollTo(0, { immediate: true });
      });
      requestAnimationFrame(() => {
        window.scrollTo(0, 0);
        window.lenis?.scrollTo(0, { immediate: true });
      });

      document.documentElement.style.overflow = 'hidden';
      document.body.style.overflow = 'hidden';
      document.documentElement.classList.add('is-entrance-gate');
      window.lenis?.stop();

      const hideSceneChrome = () => {
        const canvas = getSceneCanvas();
        const hideTargets = [gammeContainer, navbar, hud, canvas].filter(Boolean);
        hideTargets.forEach((el) => gsap.set(el, { autoAlpha: 0 }));
      };
      hideSceneChrome();
      setSceneAccessibility(true);
      // Three.js mounts async — re-hide when the WebGL canvas appears
      window.addEventListener(
        'carousel:ready',
        () => {
          const canvas = getSceneCanvas();
          if (canvas) {
            gsap.set(canvas, { autoAlpha: 0 });
            canvas.setAttribute('inert', '');
            canvas.setAttribute('aria-hidden', 'true');
          }
        },
        { once: true },
      );
      gsap.set(document.body, { '--loader-reveal': '100vh' });

      // Immersive doorway FX (logo draw, story loader, parallax, particles)
      try {
        window.westoEntrance?.init?.({ gsap });
      } catch (_) {}

      let sceneReady = false;
      let userRequestedEnter = false;
      let entered = false;

      const i18n = () => window.westoI18n;
      const tr = (key, vars) => (i18n()?.t ? i18n().t(key, vars) : key);
      const localizedAdminCopy = (key, value) => {
        const clean = typeof value === 'string' ? value.trim() : '';
        if (key === 'entrance.subtitle' && i18n()?.lang === 'fa' && /^cafe\s*&\s*restaurant$/i.test(clean)) return tr('eg.subtitleEn');
        return clean;
      };
      const entranceAdminCopy = (key, fallback) => {
        const value = window.__WESTO_CONTENT__?.content?.[key];
        const localized = localizedAdminCopy(key, value);
        return localized || fallback;
      };
      const applyGateAdminCopy = () => {
        if (!loaderWrapper) return;
        $$('[data-admin-content]', loaderWrapper).forEach((el) => {
          const key = el.getAttribute('data-admin-content');
          const value = key ? window.__WESTO_CONTENT__?.content?.[key] : '';
          const localized = localizedAdminCopy(key, value);
          if (localized) el.textContent = localized;
        });
      };
      const entranceCtaCopy = () => entranceAdminCopy('entrance.cta', tr('eg.enterWesto'));

      const setCtaReady = () => {
        if (!enterBtn || !enterLabel) return;
        enterBtn.disabled = false;
        enterLabel.textContent = entranceCtaCopy();
        if (loaderWrapper) loaderWrapper.setAttribute('aria-busy', 'false');
        try {
          window.westoEntrance?.completeExperienceLoader?.();
        } catch (_) {}
      };

      const setCtaPreparing = () => {
        if (!enterLabel || sceneReady) return;
        enterLabel.textContent = entranceCtaCopy();
      };
      setCtaPreparing();

      const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
      const DAY_ORDER = ['sat', 'sun', 'mon', 'tue', 'wed', 'thu', 'fri'];

      let lastGatePayload = null;

      const applyGateChromeI18n = () => {
        if (!loaderWrapper) return;
        $$('[data-i18n]', loaderWrapper).forEach((el) => {
          const key = el.getAttribute('data-i18n');
          if (key) el.textContent = tr(key);
        });
        const loginBtn = $('.eg-top a.eg-glass-btn', loaderWrapper);
        if (loginBtn) loginBtn.setAttribute('aria-label', tr('eg.aria.login'));
        if (siteMenuBtn) siteMenuBtn.setAttribute('aria-label', tr('eg.aria.menu'));
        const lang = i18n()?.lang || 'fa';
        const arSeg = $('#eg-lang-ar', loaderWrapper);
        if (arSeg) arSeg.hidden = false;
        $$('.eg-lang-seg', loaderWrapper).forEach((opt) => {
          opt.classList.toggle('is-active', opt.getAttribute('data-lang') === lang);
        });
        const themeBtn = $('#eg-theme-toggle', loaderWrapper);
        if (themeBtn) {
          const resolved = window.westoTheme?.get?.() || 'dark';
          themeBtn.setAttribute(
            'aria-label',
            resolved === 'light' ? tr('eg.themeLight') : tr('eg.themeDark'),
          );
          const themeLabel = $('.eg-corner__label', themeBtn);
          if (themeLabel) {
            themeLabel.textContent = resolved === 'light' ? tr('eg.themeLight') : tr('eg.themeDark');
          }
        }
        $$('.eg-chip-icon[data-eg-action]', loaderWrapper).forEach((chip) => {
          const action = chip.getAttribute('data-eg-action');
          const map = {
            phone: 'eg.dock.phone',
            map: 'eg.dock.map',
            instagram: 'eg.dock.instagram',
            hours: 'eg.hours',
            reserve: 'eg.dock.reserve',
          };
          if (map[action]) chip.setAttribute('aria-label', tr(map[action]));
        });
        const stepKeys = ['eg.step.brew', 'eg.step.world', 'eg.step.menu', 'eg.step.table'];
        $$('.eg-step-icon[data-eg-step]', loaderWrapper).forEach((el) => {
          const i = Number(el.getAttribute('data-eg-step'));
          if (stepKeys[i]) el.setAttribute('aria-label', tr(stepKeys[i]));
        });
        if (sceneReady) setCtaReady();
        else setCtaPreparing();
        // i18n paints generic locale copy first; entrance-specific Admin copy is
        // the final owner for fields explicitly marked data-admin-content.
        applyGateAdminCopy();
      };

      const parseHm = (s) => {
        const [h, m] = String(s || '0:0').split(':').map((n) => parseInt(n, 10) || 0);
        return h * 60 + m;
      };

      const isOpenNow = (hours) => {
        if (!hours) return { open: false, todayKey: DAY_KEYS[new Date().getDay()] };
        const todayKey = DAY_KEYS[new Date().getDay()];
        const today = hours[todayKey];
        if (!today || today.closed) return { open: false, todayKey, today };
        const now = new Date();
        const mins = now.getHours() * 60 + now.getMinutes();
        const openM = parseHm(today.open);
        let closeM = parseHm(today.close);
        // overnight window (e.g. 10:00 → 00:30)
        if (closeM <= openM) {
          return { open: mins >= openM || mins < closeM, todayKey, today };
        }
        return { open: mins >= openM && mins < closeM, todayKey, today };
      };

      const igUrl = (handle) => {
        if (!handle) return '';
        const h = String(handle).trim();
        if (/^https?:\/\//i.test(h)) return h;
        return `https://instagram.com/${h.replace(/^@/, '')}`;
      };

      const tiktokUrl = (handle) => {
        if (!handle) return '';
        const h = String(handle).trim();
        if (/^https?:\/\//i.test(h)) return h;
        return `https://www.tiktok.com/@${h.replace(/^@/, '')}`;
      };

      const waUrl = (phone) => {
        if (!phone) return '';
        const digits = String(phone).replace(/\D/g, '');
        if (!digits) return '';
        const normalized = digits.startsWith('0') ? `98${digits.slice(1)}` : digits;
        return `https://wa.me/${normalized}`;
      };

      let gateLinks = { phone: '', address: '', instagram: '', maps: '' };

      const setSheetMode = (mode) => {
        const isInfo = mode === 'info';
        if (siteNav) siteNav.hidden = isInfo;
        if (infoTabs) infoTabs.hidden = !isInfo;
        $$('.eg-panel', loaderWrapper).forEach((panel) => {
          if (!isInfo) {
            panel.hidden = true;
            panel.classList.remove('is-active');
            return;
          }
          const on = panel.classList.contains('is-active');
          panel.hidden = !on;
        });
        if (sheetTitle) sheetTitle.textContent = isInfo ? tr('eg.venueInfo') : tr('eg.siteMenu');
      };

      const openSheetTab = (tabId) => {
        setSheetMode('info');
        $$('.eg-tab', loaderWrapper).forEach((t) => {
          const on = t.getAttribute('data-eg-tab') === tabId;
          t.classList.toggle('is-active', on);
          t.setAttribute('aria-selected', on ? 'true' : 'false');
          t.setAttribute('tabindex', on ? '0' : '-1');
        });
        $$('.eg-panel', loaderWrapper).forEach((panel) => {
          const on = panel.getAttribute('data-eg-panel') === tabId;
          panel.classList.toggle('is-active', on);
          panel.hidden = !on;
        });
        setSheetOpen(true);
      };

      const openSiteMenu = () => {
        // Same circular night menu as the main navbar trigger
        if (window.westoNavMenu?.toggle) {
          window.westoNavMenu.toggle(siteMenuBtn);
          return;
        }
        setSheetMode('nav');
        setSheetOpen(true);
      };

      const requestEnter = async () => {
        if (!sceneReady || entered || userRequestedEnter) return;
        userRequestedEnter = true;
        window.dispatchEvent(
          new CustomEvent('westo:enter-intent', {
            detail: { source: 'entrance-cta', at: performance.now() },
          }),
        );
        if (enterBtn) enterBtn.disabled = true;
        // Finish as much progressive menu load as budget allows before the reveal
        // (avoids the heavy first-frame hitch when stubs swap to real plates).
        if (window.westoBoot?.waitForEnter) {
          if (enterLabel) enterLabel.textContent = entranceCtaCopy();
          try {
            await window.westoBoot.waitForEnter(2200);
          } catch (_) {}
        }
        if (enterLabel) enterLabel.textContent = tr('eg.entering');
        enterScene();
      };
      // Public hook for tests / secondary UI that must enter the scene
      window.westoRequestEnter = requestEnter;

      if (
        typeof navigator !== 'undefined' &&
        (navigator.webdriver ||
          /Lighthouse|Chrome-Lighthouse|HeadlessChrome/i.test(navigator.userAgent || ''))
      ) {
        setTimeout(() => {
          try {
            requestEnter();
          } catch (_) {}
        }, 400);
      }

      const fillGate = (payload) => {
        lastGatePayload = payload;
        const restaurant = payload?.restaurant || {};
        const branch = payload?.branch || {};
        const hours = payload?.hours || {};
        const name = restaurant.brandName || restaurant.name || 'WESTO';
        // API tagline/about are FA-authored; use i18n strings for en/ar.
        // Never surface "3D / سه‌بعدی" marketing copy to guests.
        const lang = i18n()?.lang || 'fa';
        const rawTag = lang === 'fa' ? restaurant.tagline : '';
        const tagline =
          (rawTag && !/سه‌?بعدی|3\s*d|ثلاثية/i.test(rawTag) ? rawTag : '') ||
          tr('eg.tagline');
        const about =
          (lang === 'fa' && restaurant.about) ||
          tr('eg.aboutBody');
        const address = branch.address || restaurant.address || '';
        const phone = branch.phone || restaurant.phone || '';
        const whatsapp = branch.whatsapp || restaurant.whatsapp || '';
        const mapUrl = branch.mapUrl || restaurant.mapUrl || '';
        const instagram = restaurant.instagram || '';
        const tiktok = restaurant.tiktok || '';
        const website = restaurant.website || '';

        gateLinks = {
          phone: phone ? `tel:${phone}` : whatsapp ? waUrl(whatsapp) : '',
          address,
          instagram: igUrl(instagram),
          maps: mapUrl || (address
            ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`
            : ''),
        };

        const syncSocial = (kind, url) => {
          $$(`[data-dl-social="${kind}"]`).forEach((link) => {
            if (!url) {
              link.hidden = true;
              link.removeAttribute('href');
              return;
            }
            link.hidden = false;
            link.setAttribute('href', url);
            link.setAttribute('target', '_blank');
            link.setAttribute('rel', 'noopener');
          });
        };
        syncSocial('instagram', gateLinks.instagram);
        syncSocial('tiktok', tiktokUrl(tiktok));
        const instagramChip = $('[data-eg-action="instagram"]', loaderWrapper);
        if (instagramChip) {
          instagramChip.hidden = !gateLinks.instagram;
          instagramChip.toggleAttribute('aria-disabled', !gateLinks.instagram);
        }

        const nameEl = $('[data-eg="name"]', loaderWrapper);
        const tagEl = $('[data-eg="tagline"]', loaderWrapper);
        const aboutEl = $('[data-eg="about"]', loaderWrapper);
        const statusEl = $('[data-eg="status"]', loaderWrapper);
        const statusLabel = $('[data-eg="status-label"]', loaderWrapper);
        const hoursEl = $('[data-eg="hours"]', loaderWrapper);
        const contactEl = $('[data-eg="contact"]', loaderWrapper);
        const englishEl = $('[data-eg="english"]', loaderWrapper);

        if (nameEl) nameEl.textContent = restaurant.name || 'وستو';
        if (englishEl) englishEl.textContent = name;
        if (tagEl) tagEl.textContent = tagline;
        if (aboutEl) aboutEl.textContent = about;

        const { open, todayKey, today } = isOpenNow(hours);
        const cityRaw = String(address || '').trim() || tr('eg.cityFallback');
        const cityShort = cityRaw.length > 28 ? `${cityRaw.slice(0, 26)}…` : cityRaw;
        if (statusEl && statusLabel) {
          const meta =
            open && today
              ? tr('eg.until', { t: today.close })
              : today && !today.closed
                ? tr('eg.fromToday', { t: today.open })
                : '';
          try {
            window.westoEntrance?.applyStatusUi?.({
              loading: false,
              open,
              label: open ? tr('eg.open') : tr('eg.closed'),
              meta,
              location: cityShort,
            });
          } catch (_) {
            statusEl.classList.toggle('is-open', open);
            statusEl.classList.toggle('is-closed', !open);
            statusEl.classList.remove('is-loading');
            statusLabel.textContent = open ? tr('eg.open') : tr('eg.closed');
            const statusMeta = $('[data-eg="status-meta"]', loaderWrapper);
            const statusLoc = $('[data-eg="status-loc"]', loaderWrapper);
            if (statusMeta) statusMeta.textContent = meta;
            if (statusLoc) statusLoc.textContent = cityShort;
          }
          if (open && today) statusEl.title = tr('eg.until', { t: today.close });
          else if (today && !today.closed) statusEl.title = tr('eg.fromToday', { t: today.open });
        }

        if (hoursEl) {
          hoursEl.innerHTML = DAY_ORDER.map((key) => {
            const row = hours[key] || { open: '—', close: '—', closed: true };
            const time = row.closed ? tr('eg.closedDay') : `${row.open} – ${row.close}`;
            const todayClass = key === todayKey ? ' is-today' : '';
            const dayName = i18n()?.dayLabel ? i18n().dayLabel(key) : key;
            return `<li class="${todayClass}"><span class="eg-hours-day">${dayName}</span><span class="eg-hours-time">${time}</span></li>`;
          }).join('');
        }

        if (contactEl) {
          const bits = [];
          if (address) bits.push(`<p><strong>${tr('eg.address')}</strong><br/>${address}</p>`);
          if (phone) bits.push(`<p><strong>${tr('eg.tel')}</strong><br/><a dir="ltr" href="tel:${phone}">${phone}</a></p>`);
          if (whatsapp) {
            bits.push(
              `<p><strong>${tr('eg.whatsapp')}</strong><br/><a dir="ltr" href="${waUrl(whatsapp)}" target="_blank" rel="noopener">${whatsapp}</a></p>`,
            );
          }
          if (website) {
            bits.push(
              `<p><strong>${tr('eg.website')}</strong><br/><a dir="ltr" href="${website}" target="_blank" rel="noopener">${website.replace(/^https?:\/\//, '')}</a></p>`,
            );
          }
          contactEl.innerHTML = bits.join('') || `<p>${tr('eg.contactSoon')}</p>`;
        }

        applyGateChromeI18n();
      };

      const loadRestaurant = () => {
        const bootPayload = window.__WESTO_CONTENT__?.restaurantPayload;
        if (bootPayload) {
          fillGate(bootPayload);
          return Promise.resolve(bootPayload);
        }
        return fetch('/api/restaurant')
          .then((r) => (r.ok ? r.json() : null))
          .then((data) => {
            if (data) fillGate(data);
            return data;
          })
          .catch(() => null);
      };
      Promise.resolve().then(loadRestaurant).catch(() => null);

      // Sheet / site menu / info tabs
      const setSheetOpen = (open) => {
        if (!loaderWrapper) return;
        const wasOpen = loaderWrapper.classList.contains('is-sheet-open');
        if (open && !wasOpen) sheetFocusReturn = document.activeElement;
        loaderWrapper.classList.toggle('is-sheet-open', open);
        siteMenuBtn?.classList.toggle('is-active', open);
        siteMenuBtn?.setAttribute('aria-expanded', open ? 'true' : 'false');
        if (sheet) {
          sheet.hidden = !open;
          sheet.setAttribute('aria-hidden', open ? 'false' : 'true');
          if (open) sheet.removeAttribute('inert');
          else sheet.setAttribute('inert', '');
        }
        if (sheetScrim) sheetScrim.hidden = !open;
        if (open && !wasOpen) {
          requestAnimationFrame(() => {
            const target = sheetCloseBtn || focusablesIn(sheet)[0];
            target?.focus?.({ preventScroll: true });
          });
        } else if (!open && wasOpen) {
          const back = sheetFocusReturn;
          sheetFocusReturn = null;
          requestAnimationFrame(() => {
            if (back?.isConnected && typeof back.focus === 'function') back.focus({ preventScroll: true });
          });
        }
      };

      siteMenuBtn?.addEventListener('click', () => {
        if (window.westoNavMenu?.isOpen?.()) {
          window.westoNavMenu.close();
          return;
        }
        openSiteMenu();
      });
      sheetScrim?.addEventListener('click', () => setSheetOpen(false));
      sheetCloseBtn?.addEventListener('click', () => setSheetOpen(false));

      $$('.eg-tab', loaderWrapper).forEach((tab) => {
        tab.addEventListener('click', () => {
          const id = tab.getAttribute('data-eg-tab');
          openSheetTab(id);
        });
        tab.addEventListener('keydown', (event) => {
          if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
          const tabs = $$('.eg-tab', loaderWrapper).filter((node) => !node.hidden);
          const current = Math.max(0, tabs.indexOf(tab));
          let next = current;
          if (event.key === 'Home') next = 0;
          else if (event.key === 'End') next = tabs.length - 1;
          else if (event.key === 'ArrowRight') next = (current + 1) % tabs.length;
          else next = (current - 1 + tabs.length) % tabs.length;
          event.preventDefault();
          const target = tabs[next];
          openSheetTab(target?.getAttribute('data-eg-tab'));
          target?.focus?.({ preventScroll: true });
        });
      });

      $$('[data-eg-nav]', loaderWrapper).forEach((el) => {
        el.addEventListener('click', () => {
          const action = el.getAttribute('data-eg-nav');
          if (action === 'hours') return openSheetTab('hours');
          if (action === 'enter') {
            setSheetOpen(false);
            requestEnter();
          }
        });
      });

      $$('.eg-chip-icon', loaderWrapper).forEach((chip) => {
        chip.addEventListener('click', async (e) => {
          const action = chip.getAttribute('data-eg-action');
          if (action === 'reserve' && chip.tagName === 'A') {
            // allow native navigation; still mark active
          }
          $$('.eg-chip-icon', loaderWrapper).forEach((c) =>
            c.classList.toggle('is-active', c === chip && action !== 'lang'),
          );
          if (action === 'hours') return openSheetTab('hours');
          if (action === 'phone') {
            e.preventDefault();
            if (gateLinks.phone) window.location.href = gateLinks.phone;
            else openSheetTab('contact');
            return;
          }
          if (action === 'map') {
            e.preventDefault();
            if (gateLinks.maps) window.open(gateLinks.maps, '_blank', 'noopener');
            else openSheetTab('contact');
            return;
          }
          if (action === 'instagram') {
            e.preventDefault();
            if (gateLinks.instagram) window.open(gateLinks.instagram, '_blank', 'noopener');
            else openSheetTab('contact');
            return;
          }
          if (action === 'reserve') {
            // <a href="/reserve"> handles navigation
            return;
          }
        });
      });

      const langSwitch = $('#eg-lang-switch', loaderWrapper);
      langSwitch?.addEventListener('click', (e) => {
        const opt = e.target.closest('[data-lang]');
        if (!opt || !i18n()?.setLang) return;
        i18n().setLang(opt.getAttribute('data-lang'), { userInitiated: true });
      });

      const themeToggle = $('#eg-theme-toggle', loaderWrapper);
      themeToggle?.addEventListener('click', (e) => {
        e.preventDefault();
        try {
          window.westoTheme?.toggle?.();
        } catch (_) {}
        applyGateChromeI18n();
      });
      document.addEventListener('westo:theme-change', () => applyGateChromeI18n());

      document.addEventListener('westo:langchange', () => {
        applyGateChromeI18n();
        if (lastGatePayload) fillGate(lastGatePayload);
        // After i18n rewrites SplitText nodes, force title/desc leaves visible
        requestAnimationFrame(() => {
          $$('.carousel_list.is-hero [data-anim="chars-mask"], .carousel_list.is-desc [data-anim="chars-mask"], [data-menu-name], [data-menu-desc]').forEach(
            (el) => {
              gsap.set(el, { yPercent: 0, clearProps: 'transform' });
              $$(
                '.line, .line > div, .word, .char',
                el,
              ).forEach((leaf) => gsap.set(leaf, { yPercent: 0, clearProps: 'transform' }));
            },
          );
        });
      });
      applyGateChromeI18n();

      const enterScene = async () => {
        if (entered || !userRequestedEnter || !sceneReady) return;
        entered = true;
        setSheetOpen(false);

        try {
          await window.westoEntrance?.playExitPrelude?.();
        } catch (_) {}
        try {
          window.westoEntrance?.destroyFx?.();
        } catch (_) {}
        try {
          window.westoRenderWake?.({ force: true });
        } catch (_) {}

        const tl = gsap.timeline({
          defaults: { ease: 'power3.out' },
          onComplete: () => {
            setSceneAccessibility(false);
            document.documentElement.classList.remove('is-entrance-gate');
            window.dispatchEvent(
              new CustomEvent('westo:entered', {
                detail: { source: 'entrance-transition', at: performance.now() },
              }),
            );
            window.scrollTo(0, 0);
            // Lenis / overflow / swipe unlock are owned by window.loader.play()
            // so horizontal carousel input is not re-locked by this fade timeline.
            if (window.ScrollTrigger) ScrollTrigger.refresh();
          },
        });

        if (hud) tl.set(hud, { autoAlpha: 1 }, 0);

        const sceneCanvas = getSceneCanvas();
        tl.to(
          loaderWrapper,
          {
            autoAlpha: 0,
            duration: 0.55,
            ease: 'power2.inOut',
            onComplete: () => {
              gsap.set(loaderWrapper, { display: 'none', pointerEvents: 'none' });
              if (loaderWrapper) loaderWrapper.setAttribute('hidden', '');
            },
          },
          0,
        );
        if (sceneCanvas) {
          tl.to(sceneCanvas, { autoAlpha: 1, duration: 0.65, ease: 'power2.out' }, 0.05);
        }
        tl.to(document.body, { '--loader-reveal': '0vh', duration: 1, ease: 'power2.out' }, 0.15)
          .fromTo(navbar, { autoAlpha: 0, yPercent: -120 }, { autoAlpha: 1, yPercent: 0, duration: 0.9 }, 0.25);

        if (isMobile()) {
          tl.fromTo(hudLeft, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.9 }, 0.35).fromTo(
            hudRight,
            { autoAlpha: 0 },
            { autoAlpha: 1, duration: 0.9 },
            0.35,
          );
        } else {
          tl.fromTo(hudLeft, { autoAlpha: 0, x: '-10rem' }, { autoAlpha: 1, x: '0rem', duration: 0.9 }, 0.35).fromTo(
            hudRight,
            { autoAlpha: 0, x: '10rem' },
            { autoAlpha: 1, x: '0rem', duration: 0.9 },
            0.35,
          );
        }
        tl.fromTo(gammeContainer, { autoAlpha: 0 }, { autoAlpha: 1, yPercent: 0, duration: 1 }, 0.4);

        if (typeof window.loader?.play === 'function') {
          await window.loader.play();
        }
      };

      const onSceneReady = () => {
        if (sceneReady) return;
        sceneReady = true;
        setCtaReady();
        enterScene();
      };
      window.addEventListener('carousel:ready', onSceneReady);
      if (window.carousel && window.__sceneReady) onSceneReady();

      // Never leave the guest stuck if the 3D boot hangs
      window.setTimeout(() => {
        if (!sceneReady) {
          document.documentElement.dataset.westoBootFallback = '1';
          onSceneReady();
        }
      }, 8000);

      // Bind enter via click on the CTA (and bubbles from the label span)
      const onEnterIntent = (event) => {
        if (enterBtn?.disabled) return;
        if (event?.type === 'keydown' && event.key !== 'Enter' && event.key !== ' ') return;
        if (event?.type === 'keydown') event.preventDefault();
        requestEnter();
      };
      enterBtn?.addEventListener('click', onEnterIntent);
      enterBtn?.addEventListener('keydown', onEnterIntent);
      if (enterBtn) enterBtn.dataset.egBound = '1';

      // Default sheet to site-nav mode (info panels stay hidden until opened)
      setSheetMode('nav');

      document.addEventListener('keydown', (event) => {
        if (loaderWrapper?.classList.contains('is-sheet-open') && event.key === 'Tab') {
          const list = focusablesIn(sheet);
          if (!list.length) {
            event.preventDefault();
            sheetCloseBtn?.focus?.({ preventScroll: true });
            return;
          }
          const first = list[0];
          const last = list[list.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault(); last.focus({ preventScroll: true }); return;
          }
          if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault(); first.focus({ preventScroll: true }); return;
          }
        }
        if (event.key !== 'Escape') return;
        if (loaderWrapper?.classList.contains('is-sheet-open')) {
          event.preventDefault();
          setSheetOpen(false);
        }
      });
    };

    // #region Navbar

    // Sound Button

    const initSoundToggle = () => {
      const sound = $('#nav-sound-btn');
      if (!sound) return;

      const bars = $$('svg rect', sound);
      const label = sound.querySelector('.navbar_menu-sound__label');
      let isMuted = sound.classList.contains('is-muted');
      let playing = false;

      const t = (key, fallback) => {
        try {
          if (window.WestoI18n && typeof window.WestoI18n.t === 'function') {
            return window.WestoI18n.t(key) || fallback;
          }
        } catch (_) {}
        return fallback;
      };

      const syncLabels = () => {
        const aria = isMuted ? t('nav.sound_play', 'پخش صدا') : t('nav.sound_off', 'قطع صدا');
        sound.setAttribute('aria-pressed', isMuted ? 'true' : 'false');
        sound.setAttribute('aria-label', aria);
        sound.setAttribute('title', aria);
        if (label && !label.hasAttribute('data-i18n')) {
          label.textContent = t('nav.sound', 'صدا');
        }
      };

      const animateBar = (bar) => {
        if (!playing) return;
        const h = gsap.utils.random(2, 8, 0.1);
        gsap.to(bar, {
          attr: { height: h, y: (8 - h) / 2 },
          duration: gsap.utils.random(0.2, 0.5),
          ease: 'power1.inOut',
          onComplete: () => animateBar(bar),
        });
      };

      const start = () => {
        playing = true;
        bars.forEach(animateBar);
      };

      const stop = () => {
        playing = false;
        gsap.killTweensOf(bars);
        gsap.to(bars, {
          attr: { height: 2, y: 3 },
          duration: 0.3,
          ease: 'power2.out',
        });
      };

      sound.addEventListener('click', () => {
        isMuted = !isMuted;
        sound.classList.toggle('is-muted', isMuted);
        syncLabels();
        isMuted ? stop() : start();
      });

      syncLabels();
      if (isMuted) stop();
      else start();
    };

    // Scroll Button

    const initScrollIcon = () => {
      const wrappers = $$('.icon-scroll_wrapper');
      if (!wrappers.length) return;
      const entries = [];

      wrappers.forEach((wrapper) => {
        const arrows = $$('svg > g', wrapper);
        if (arrows.length !== 3) return;

        const [first, middle, last] = arrows;

        gsap.set([first, middle, last], { opacity: 0, scale: 0, transformOrigin: '50% 50%' });
        gsap.set(first, { y: 100 });
        gsap.set(last, { y: -100 });

        // This is the only always-repeating decorative timeline in the hero.
        // Keep the exact animation, but do not keep GSAP awake when its icon
        // cannot be seen (below the hero, dish mode, entrance gate, hidden tab).
        const tl = gsap.timeline({ repeat: -1, repeatDelay: 0.3, paused: true });

        tl.to(first, { opacity: 1, scale: 1, y: 0, duration: 0.6, ease: 'power2.out' }).to(middle, { opacity: 1, scale: 1, duration: 0.6, ease: 'power2.out' }, '-=0.4').to(last, { opacity: 1, scale: 1, y: 0, duration: 0.6, ease: 'power2.out' }, '-=0.4').to(
          [first, middle, last],
          {
            opacity: 0,
            duration: 0.4,
            ease: 'power2.in',
            stagger: 0.25,
          },
          '+=0.3',
        );
        entries.push({ wrapper, tl, inView: true });
      });

      const syncScrollIconPlay = () => {
        const globallyHidden =
          document.visibilityState === 'hidden' ||
          document.documentElement.classList.contains('is-entrance-gate') ||
          document.documentElement.classList.contains('is-dish-boards');
        entries.forEach(({ tl, inView }) => {
          const shouldRun = !globallyHidden && inView;
          if (shouldRun) {
            if (tl.paused()) tl.play();
          } else if (!tl.paused() || tl.time() !== 0) {
            tl.pause(0);
          }
        });
      };

      document.addEventListener('visibilitychange', syncScrollIconPlay);
      window.addEventListener('westo:thermal-idle', syncScrollIconPlay);
      window.addEventListener('westo:thermal-wake', syncScrollIconPlay);
      if (typeof MutationObserver !== 'undefined') {
        new MutationObserver(syncScrollIconPlay).observe(document.documentElement, {
          attributes: true,
          attributeFilter: ['class'],
        });
      }

      if (typeof IntersectionObserver !== 'undefined') {
        const byWrapper = new Map(entries.map((entry) => [entry.wrapper, entry]));
        const observer = new IntersectionObserver(
          (changes) => {
            changes.forEach((change) => {
              const entry = byWrapper.get(change.target);
              if (entry) entry.inView = change.isIntersecting && change.intersectionRatio > 0;
            });
            syncScrollIconPlay();
          },
          { root: null, rootMargin: '80px 0px', threshold: 0.01 },
        );
        entries.forEach((entry) => observer.observe(entry.wrapper));
      }

      syncScrollIconPlay();
    };

    // Menu Button

    const initMenuButton = () => {
      if (!isDesktop()) return;

      const button = $('.navbar_menu-button');
      if (!button) return;

      const circles = $$('svg circle', button);
      if (!circles.length) return;

      gsap.set(circles, { transformOrigin: '50% 50%' });

      let tl = null;

      button.addEventListener('mouseenter', () => {
        if (tl) tl.kill();
        gsap.set(circles, { scale: 1 });

        tl = gsap.timeline({ repeat: -1 });
        tl.to(circles, {
          scale: 0.5,
          duration: 0.4,
          ease: 'power2.inOut',
          stagger: { each: 0.1, from: 'start' },
        }).to(circles, {
          scale: 1,
          duration: 0.4,
          ease: 'power2.inOut',
          stagger: { each: 0.1, from: 'start' },
        });
      });

      button.addEventListener('mouseleave', () => {
        if (tl) tl.kill();
        tl = null;
        gsap.to(circles, {
          scale: 1,
          duration: 0.3,
          ease: 'power2.out',
          overwrite: true,
        });
      });
    };

    // Arrow Button

    const initCarouselArrowsHover = () => {
      if (!isDesktop()) return;

      const arrows = $$('.carousel_arrow');
      if (!arrows.length) return;

      arrows.forEach((arrow) => {
        const shapes = $$('svg path, svg rect', arrow);
        if (!shapes.length) return;

        gsap.set(shapes, { transformOrigin: '50% 50%' });

        let tl = null;

        arrow.addEventListener('mouseenter', () => {
          if (tl) tl.kill();
          gsap.set(shapes, { scale: 1 });

          tl = gsap.timeline({ repeat: -1 });
          tl.to(shapes, {
            scale: 0.5,
            duration: 0.4,
            ease: 'power2.inOut',
            stagger: { each: 0.08, from: 'start' },
          }).to(shapes, {
            scale: 1,
            duration: 0.4,
            ease: 'power2.inOut',
            stagger: { each: 0.08, from: 'start' },
          });
        });

        arrow.addEventListener('mouseleave', () => {
          if (tl) tl.kill();
          tl = null;
          gsap.to(shapes, {
            scale: 1,
            duration: 0.3,
            ease: 'power2.out',
            overwrite: true,
          });
        });
      });
    };

    // Menu Open/close — circular night-service reveal from the menu button

    const initMenuToggle = () => {
      const button = $('.navbar_menu-button');
      const menu = $('.navbar_menu');
      if (!button || !menu) return;

      const links = $$('.navbar_link', menu);
      if (!links.length) return;

      if (!menu.id) menu.id = 'westo-navbar-menu';
      button.setAttribute('role', 'button');
      button.setAttribute('tabindex', '0');
      button.setAttribute('aria-label', 'باز کردن منو');
      button.setAttribute('aria-controls', menu.id);
      button.setAttribute('aria-expanded', 'false');
      menu.setAttribute('aria-hidden', 'true');

      let scrim = $('#westo-navbar-scrim');
      if (!scrim) {
        scrim = document.createElement('div');
        scrim.className = 'navbar_menu-scrim';
        scrim.id = 'westo-navbar-scrim';
        scrim.hidden = true;
        scrim.setAttribute('aria-hidden', 'true');
      }

      // Escape navbar stacking context so the stage covers hero chrome
      if (scrim.parentElement !== document.body) document.body.appendChild(scrim);
      if (menu.parentElement !== document.body) document.body.appendChild(menu);

      const topbar = $('.navbar_menu-topbar', menu);
      const prefsBar = $('.navbar_prefs', menu) || $('.navbar_theme', menu);
      const closeBtn = $('.navbar_menu-close', menu);
      const middle = $('.navbar_middle', menu);
      const bottom = $('.navbar_bottom', menu);
      const watermark = $('.navbar_menu-watermark', menu);
      const orbs = $$('.navbar_menu-orb', menu);
      const metas = $$('.navbar_link-meta', menu);
      const arrows = $$('.navbar_link-arrow', menu);
      const labels = $$('.navbar_link-label', menu);
      const gateMenuBtn = $('#eg-site-menu');
      const contentEls = [topbar, prefsBar, middle, bottom].filter(Boolean);

      /* SplitText lines are expensive — only build on capable / desktop path. */
      let linkReveals = [];
      const ensureLinkReveals = () => {
        if (linkReveals.length || prefersMenuLite()) return linkReveals;
        linkReveals = (labels.length ? [...labels] : [...links]).map((el) =>
          createLinesMask(el, { duration: 0.75, stagger: 0.03 }),
        );
        return linkReveals;
      };

      let isOpen = false;
      let animating = false;
      let activeTl = null;
      let orbDrift = null;
      let originEl = button;
      let menuFocusReturn = null;

      const menuFocusables = () =>
        $$('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])', menu)
          .filter((el) => !el.hidden && el.getClientRects().length && el.getAttribute('aria-hidden') !== 'true');
      const restoreMenuFocus = () => {
        const back = menuFocusReturn;
        menuFocusReturn = null;
        requestAnimationFrame(() => {
          if (back?.isConnected && typeof back.focus === 'function') back.focus({ preventScroll: true });
        });
      };

      const circleClip = (r, x, y) => `circle(${Math.max(0, r)}px at ${x}px ${y}px)`;

      const setMenuClip = (r, x, y) => {
        const clip = circleClip(r, x, y);
        menu.style.clipPath = clip;
        menu.style.webkitClipPath = clip;
      };

      const syncTriggers = (open) => {
        [button, gateMenuBtn].filter(Boolean).forEach((el) => {
          el.classList.toggle('is-open', open);
          el.classList.toggle('is-active', open);
          el.setAttribute('aria-expanded', open ? 'true' : 'false');
          el.setAttribute('aria-label', open ? 'بستن منو' : 'باز کردن منو');
        });
      };

      const originFromTrigger = () => {
        const el = originEl?.isConnected ? originEl : button;
        const br = el.getBoundingClientRect();
        const x = br.left + br.width / 2;
        const y = br.top + br.height / 2;
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const maxR = Math.ceil(Math.hypot(Math.max(x, vw - x), Math.max(y, vh - y))) + 48;
        return { x, y, maxR };
      };

      const setScrollLock = (lock) => {
        document.documentElement.classList.toggle('is-nav-menu-open', lock);
        if (window.lenis) {
          if (lock) window.lenis.stop();
          else if (!document.documentElement.classList.contains('is-entrance-gate')) window.lenis.start();
        }
      };

      const setAnimatingClass = (on, lite) => {
        document.documentElement.classList.toggle('is-nav-menu-animating', on);
        document.documentElement.classList.toggle('is-nav-menu-lite', !!lite);
        if (on) menu.style.willChange = 'clip-path';
        else menu.style.willChange = 'auto';
      };

      const stopOrbDrift = () => {
        if (orbDrift) {
          orbDrift.kill();
          orbDrift = null;
        }
      };

      const startOrbDrift = () => {
        stopOrbDrift();
        if (document.documentElement.dataset.thermalIdle === 'true' || !orbs.length || prefersMenuLite() || prefersReducedMotion()) return;
        orbDrift = gsap.timeline({ repeat: -1, yoyo: true });
        orbs.forEach((orb, i) => {
          orbDrift.to(
            orb,
            {
              x: i ? -28 : 34,
              y: i ? 22 : -18,
              duration: 4.8 + i * 0.6,
              ease: 'sine.inOut',
            },
            0,
          );
        });
      };

      window.addEventListener('westo:thermal-idle', stopOrbDrift);
      window.addEventListener('westo:thermal-wake', () => {
        if (document.documentElement.classList.contains('is-nav-menu-open')) startOrbDrift();
      });

      const showContentInstant = () => {
        gsap.set(contentEls, { autoAlpha: 1, y: 0, scale: 1, rotate: 0 });
        gsap.set(metas, { autoAlpha: 1, y: 0 });
        gsap.set(arrows, { autoAlpha: 1, scale: 1 });
        gsap.set(labels, { autoAlpha: 1, y: 0 });
        gsap.set(watermark, { autoAlpha: 1, scale: 1 });
        gsap.set(orbs, { opacity: 0, x: 0, y: 0 });
      };

      const resetContent = () => {
        const { x, y } = originFromTrigger();
        stopOrbDrift();
        setAnimatingClass(false, false);
        gsap.set(contentEls, { autoAlpha: 0, y: 24, scale: 1, rotate: 0 });
        gsap.set(metas, { autoAlpha: 0, y: 14 });
        gsap.set(arrows, { autoAlpha: 0, scale: 0.7 });
        gsap.set(watermark, { autoAlpha: 0, scale: 1.08 });
        gsap.set(orbs, { opacity: 0, x: 0, y: 0 });
        gsap.set(menu, { display: 'none', opacity: 1 });
        setMenuClip(0, x, y);
      };

      gsap.set(scrim, { autoAlpha: 0, display: 'none' });
      resetContent();

      const openLite = (x, y, maxR) => {
        /* One compositor-heavy property only: circular clip. Content is ready. */
        showContentInstant();
        gsap.set(menu, { display: 'flex', opacity: 1 });
        setMenuClip(0, x, y);
        gsap.set(scrim, { display: 'block' });

        const clip = { r: 0 };
        const tl = gsap.timeline({
          onComplete: () => {
            animating = false;
            activeTl = null;
            setAnimatingClass(false, true);
            setMenuClip(maxR, x, y);
          },
        });
        activeTl = tl;

        tl.to(scrim, { autoAlpha: 1, duration: 0.2, ease: 'power2.out' }, 0).to(
          clip,
          {
            r: maxR,
            duration: prefersReducedMotion() ? 0.01 : 0.48,
            ease: 'power3.out',
            onUpdate: () => setMenuClip(clip.r, x, y),
          },
          0,
        );
      };

      const openFull = (x, y, maxR, mobile) => {
        const reveals = ensureLinkReveals();
        gsap.set(menu, { display: 'flex', opacity: 1 });
        setMenuClip(0, x, y);
        gsap.set(scrim, { display: 'block' });

        const clip = { r: 0 };
        const tl = gsap.timeline({
          defaults: { ease: 'power3.out' },
          onComplete: () => {
            animating = false;
            activeTl = null;
            setAnimatingClass(false, false);
            setMenuClip(maxR, x, y);
            startOrbDrift();
          },
        });
        activeTl = tl;

        tl.to(scrim, { autoAlpha: 1, duration: 0.4, ease: 'power2.out' }, 0)
          .to(
            clip,
            {
              r: maxR,
              duration: mobile ? 0.8 : 0.75,
              ease: 'power4.inOut',
              onUpdate: () => setMenuClip(clip.r, x, y),
            },
            0.02,
          )
          .to(orbs, { opacity: 0.55, duration: 0.8, stagger: 0.1 }, 0.2)
          .fromTo(
            watermark,
            { autoAlpha: 0, scale: 1.12 },
            { autoAlpha: 1, scale: 1, duration: 1.1, ease: 'power2.out' },
            0.18,
          )
          .fromTo(topbar, { autoAlpha: 0, y: -16 }, { autoAlpha: 1, y: 0, duration: 0.55 }, 0.32);

        if (prefsBar) {
          tl.fromTo(
            prefsBar,
            { autoAlpha: 0, y: -10 },
            { autoAlpha: 1, y: 0, duration: 0.45 },
            0.4,
          );
        }

        reveals.forEach((reveal, i) => {
          reveal.in({ delay: 0.42 + i * (mobile ? 0.12 : 0.08) });
        });

        tl.fromTo(
          metas,
          { autoAlpha: 0, y: 16 },
          { autoAlpha: 1, y: 0, duration: 0.5, stagger: 0.1 },
          0.48,
        ).fromTo(
          arrows,
          { autoAlpha: 0, scale: 0.65 },
          { autoAlpha: 1, scale: 1, duration: 0.55, stagger: 0.1, ease: 'back.out(1.6)' },
          0.58,
        );

        if (middle) {
          tl.fromTo(
            middle,
            { autoAlpha: 0, y: 20, scale: 0.86, rotate: -8 },
            {
              autoAlpha: 1,
              y: 0,
              scale: 1,
              rotate: 0,
              duration: 0.75,
              ease: 'back.out(1.5)',
            },
            0.7,
          );
        }
        if (bottom) {
          tl.fromTo(bottom, { autoAlpha: 0, y: 40 }, { autoAlpha: 1, y: 0, duration: 0.7 }, 0.78);
        }
      };

      const open = (fromEl) => {
        if (animating || isOpen) return;
        animating = true;
        isOpen = true;
        if (activeTl) activeTl.kill();
        originEl = fromEl || button;
        menuFocusReturn = document.activeElement;

        syncTriggers(true);
        menu.removeAttribute('inert');
        menu.setAttribute('aria-hidden', 'false');
        scrim.hidden = false;
        scrim.setAttribute('aria-hidden', 'false');
        setScrollLock(true);

        const { x, y, maxR } = originFromTrigger();
        const lite = prefersMenuLite();
        setAnimatingClass(true, lite);

        if (lite) openLite(x, y, maxR);
        else openFull(x, y, maxR, isMobile());
        requestAnimationFrame(() => {
          (closeBtn || menuFocusables()[0])?.focus?.({ preventScroll: true });
        });
      };

      const closeLite = (x, y, maxR) => {
        const clip = { r: maxR };
        const tl = gsap.timeline({
          onComplete: () => {
            resetContent();
            gsap.set(scrim, { display: 'none', autoAlpha: 0 });
            scrim.hidden = true;
            setScrollLock(false);
            animating = false;
            activeTl = null;
            restoreMenuFocus();
          },
        });
        activeTl = tl;

        tl.to(
          clip,
          {
            r: 0,
            duration: prefersReducedMotion() ? 0.01 : 0.4,
            ease: 'power3.in',
            onUpdate: () => setMenuClip(clip.r, x, y),
          },
          0,
        ).to(scrim, { autoAlpha: 0, duration: 0.28, ease: 'power2.in' }, 0.08);
      };

      const closeFull = (x, y, maxR, mobile) => {
        const reveals = ensureLinkReveals();
        const circleDur = mobile ? 0.8 : 0.75;
        setMenuClip(maxR, x, y);
        const clip = { r: maxR };

        const tl = gsap.timeline({
          onComplete: () => {
            resetContent();
            gsap.set(scrim, { display: 'none', autoAlpha: 0 });
            scrim.hidden = true;
            setScrollLock(false);
            animating = false;
            activeTl = null;
            restoreMenuFocus();
          },
        });
        activeTl = tl;

        if (bottom) {
          tl.to(bottom, { autoAlpha: 0, y: 36, duration: 0.45, ease: 'power3.in' }, 0);
        }
        if (middle) {
          tl.to(
            middle,
            {
              autoAlpha: 0,
              y: 18,
              scale: 0.86,
              rotate: 8,
              duration: 0.5,
              ease: 'power3.in',
            },
            0.06,
          );
        }

        tl.to(
          arrows,
          { autoAlpha: 0, scale: 0.65, duration: 0.4, stagger: 0.08, ease: 'power2.in' },
          0.1,
        ).to(
          metas,
          { autoAlpha: 0, y: -14, duration: 0.4, stagger: 0.08, ease: 'power2.in' },
          0.14,
        );

        reveals.forEach((reveal, i) => {
          const last = links.length - 1;
          reveal.out({ delay: 0.16 + (last - i) * (mobile ? 0.1 : 0.07) });
        });

        if (prefsBar) {
          tl.to(prefsBar, { autoAlpha: 0, y: -10, duration: 0.35, ease: 'power2.in' }, 0.24);
        }

        tl.to(topbar, { autoAlpha: 0, y: -16, duration: 0.4, ease: 'power2.in' }, 0.28)
          .to(watermark, { autoAlpha: 0, scale: 1.1, duration: 0.5, ease: 'power2.in' }, 0.22)
          .to(orbs, { opacity: 0, duration: 0.45, stagger: 0.06, ease: 'power2.in' }, 0.24)
          .to(
            clip,
            {
              r: 0,
              duration: circleDur,
              ease: 'power4.inOut',
              onUpdate: () => setMenuClip(clip.r, x, y),
            },
            0.38,
          )
          .to(
            scrim,
            { autoAlpha: 0, duration: 0.4, ease: 'power2.in' },
            0.38 + circleDur * 0.35,
          );
      };

      const close = () => {
        if (!isOpen) return;
        // Escape/close is an interrupt, not another animation request. If the
        // reveal is still running, finish closed immediately so focus and
        // scroll ownership are never trapped behind an `animating` guard.
        if (animating) {
          isOpen = false;
          if (activeTl) activeTl.kill();
          activeTl = null;
          stopOrbDrift();
          gsap.killTweensOf([menu, scrim, ...contentEls, ...metas, ...arrows, ...labels, watermark, ...orbs]);
          syncTriggers(false);
          menu.setAttribute('inert', '');
          menu.setAttribute('aria-hidden', 'true');
          scrim.setAttribute('aria-hidden', 'true');
          resetContent();
          gsap.set(scrim, { display: 'none', autoAlpha: 0 });
          scrim.hidden = true;
          setScrollLock(false);
          animating = false;
          restoreMenuFocus();
          return;
        }
        animating = true;
        isOpen = false;
        if (activeTl) activeTl.kill();
        stopOrbDrift();

        syncTriggers(false);
        menu.setAttribute('inert', '');
        menu.setAttribute('aria-hidden', 'true');
        scrim.setAttribute('aria-hidden', 'true');

        const { x, y, maxR } = originFromTrigger();
        const lite = prefersMenuLite();
        setAnimatingClass(true, lite);
        setMenuClip(maxR, x, y);

        if (lite) closeLite(x, y, maxR);
        else closeFull(x, y, maxR, isMobile());
      };

      button.addEventListener('click', () => {
        isOpen ? close() : open();
      });
      button.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        isOpen ? close() : open();
      });
      closeBtn?.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        close();
      });

      links.forEach((link) => {
        link.addEventListener('click', (event) => {
          const href = link.getAttribute('href') || '';
          // In-page anchors: close and let hash / Lenis handlers run.
          if (!href || href === '#' || href.startsWith('#')) {
            close();
            return;
          }
          // Full-page routes (/login, /menu, /about, …): navigate explicitly.
          // The close clip-path animation was swallowing default navigation.
          event.preventDefault();
          event.stopPropagation();
          const url = link.href;
          close();
          window.setTimeout(() => {
            window.location.assign(url);
          }, 220);
        });
      });

      scrim.addEventListener('click', () => {
        if (isOpen) close();
      });

      document.addEventListener('keydown', (event) => {
        if (!isOpen) return;
        if (event.key === 'Tab') {
          const list = menuFocusables();
          if (!list.length) {
            event.preventDefault();
            closeBtn?.focus?.({ preventScroll: true });
            return;
          }
          const first = list[0];
          const last = list[list.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault(); last.focus({ preventScroll: true }); return;
          }
          if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault(); first.focus({ preventScroll: true }); return;
          }
        }
        if (event.key !== 'Escape') return;
        event.preventDefault();
        close();
      });

      bp.mobile.addEventListener('change', () => {
        if (!isOpen) {
          resetContent();
          return;
        }
        const { x, y, maxR } = originFromTrigger();
        gsap.set(menu, { display: 'flex', opacity: 1 });
        setMenuClip(maxR, x, y);
        gsap.set(contentEls, { autoAlpha: 1, y: 0, scale: 1, rotate: 0 });
        gsap.set([metas, arrows], { autoAlpha: 1, y: 0, scale: 1 });
        gsap.set(watermark, { autoAlpha: 1, scale: 1 });
        gsap.set(orbs, { opacity: prefersMenuLite() ? 0 : 0.55 });
      });

      window.westoNavMenu = {
        open: (fromEl) => open(fromEl || button),
        close,
        toggle: (fromEl) => (isOpen ? close() : open(fromEl || button)),
        isOpen: () => isOpen,
      };
    };

    // #region Carousel

    // Carousel Text

    const initCarouselText = () => {
      // Only hero category titles — other .carousel_slide lists (profile leftovers)
      // share indices and were getting faded with the wrong opacity.
      const slides = $$('.carousel_list.is-hero .carousel_slide');
      const descs = $$('.carousel_desc');
      const titles = $$('.carousel_title-b');
      if (!slides.length || !window.carousel) return null;

      const orderOf = () =>
        Array.isArray(window.__westoCategoryOrder) && window.__westoCategoryOrder.length
          ? window.__westoCategoryOrder
          : Array.isArray(window.__westoSlideCategoryOrder)
            ? window.__westoSlideCategoryOrder
            : [];

      const isActiveEl = (el, activeIndex) => {
        const order = orderOf();
        const catId = el.getAttribute?.('data-menu-cat-id');
        if (catId && order.length) return String(order[activeIndex]) === String(catId);
        const list = el.parentElement?.children ? [...el.parentElement.children] : [];
        return list.indexOf(el) === activeIndex;
      };

      const indexInList = (els, carouselIndex) => {
        const order = orderOf();
        const catId = order[carouselIndex];
        if (catId == null) return carouselIndex;
        const found = [...els].findIndex((el) => String(el.getAttribute('data-menu-cat-id')) === String(catId));
        return found >= 0 ? found : carouselIndex;
      };

      // Boot assert: slide ids must match can order or titles will drift.
      const slideIds = [...slides].map((s) => Number(s.getAttribute('data-menu-cat-id')));
      const canIds = orderOf().map(Number);
      if (canIds.length && slideIds.length && slideIds.join(',') !== canIds.join(',')) {
        console.error('[westo] hero title/can id mismatch', { slideIds, canIds });
      }

      const createMultiReveal = (container, selector, factory) => {
        const els = $$(selector, container);
        if (!els.length) return null;

        const instances = [...els].map((el) => factory(el));

        return {
          in: (opts) => instances.forEach((a) => a.in(opts)),
          out: (opts) => instances.forEach((a) => a.out(opts)),
        };
      };

      // SplitText expands the DOM substantially. The old path split every
      // category at boot even though only one category is visible. Preserve the
      // exact reveal factories, but instantiate them only for the active/visited
      // categories. The next category is prepared synchronously before its fade,
      // so the visible motion contract stays unchanged.
      const descReveals = new Array(descs.length);
      const titleReveals = new Array(titles.length);
      const slideReveals = new Array(slides.length);

      const ensureRevealAt = (i) => {
        if (i == null || i < 0) return;

        const desc = descs[i];
        if (desc && !descReveals[i]) {
          const lines = createMultiReveal(desc, '[data-anim="lines-mask"]', (el) => createLinesMask(el));
          const chars = createMultiReveal(desc, '[data-anim="chars-mask"]', (el) => createCharsMask(el));
          descReveals[i] = {
            in: (opts) => {
              lines?.in(opts);
              chars?.in(opts);
            },
            out: (opts) => {
              lines?.out(opts);
              chars?.out(opts);
            },
          };
        }

        const title = titles[i];
        if (title && !titleReveals[i]) {
          titleReveals[i] = createMultiReveal(title, '[data-anim="chars-mask"]', (el) => createCharsMask(el));
        }

        const slide = slides[i];
        if (slide && !slideReveals[i]) {
          slideReveals[i] = createMultiReveal(slide, '[data-anim="chars-mask"]', (el) => createCharsMask(el));
        }
      };

      // Hide inactive slides immediately so a previous category name cannot
      // linger (or crossfade) on top of the active can — that read as "mixed names".
      const fade = (els, activeIndex) => {
        els.forEach((el) => {
          if (isActiveEl(el, activeIndex)) {
            gsap.to(el, {
              autoAlpha: 1,
              duration: 0.4,
              ease: 'power2.out',
              overwrite: true,
            });
          } else {
            gsap.killTweensOf(el);
            gsap.set(el, { autoAlpha: 0 });
          }
        });
      };

      const setInitial = (els) => {
        const idx = window.carousel.index || 0;
        els.forEach((el) => gsap.set(el, { autoAlpha: isActiveEl(el, idx) ? 1 : 0 }));
      };
      setInitial(slides);
      setInitial(descs);
      setInitial(titles);

      window.carousel.changed.connect(({ index, previous }) => {
        const prevI = indexInList(slides, previous);
        const nextI = indexInList(slides, index);
        ensureRevealAt(prevI);
        ensureRevealAt(nextI);

        fade(slides, index);
        fade(descs, index);
        fade(titles, index);

        descReveals[prevI]?.out();
        descReveals[nextI]?.in({ delay: 0.3 });
        titleReveals[prevI]?.out();
        titleReveals[nextI]?.in({ delay: 0.3 });
        slideReveals[prevI]?.out();
        slideReveals[nextI]?.in({ delay: 0.3 });
      });

      const initialI = indexInList(slides, window.carousel.index);
      ensureRevealAt(initialI);
      slideReveals[initialI]?.in({ delay: 0.3 });

      return {
        inActive: (opts) => {
          const i = indexInList(slides, window.carousel.index);
          ensureRevealAt(i);
          descReveals[i]?.in(opts);
          titleReveals[i]?.in(opts);
        },
        outActive: (opts) => {
          const i = indexInList(slides, window.carousel.index);
          ensureRevealAt(i);
          descReveals[i]?.out(opts);
          titleReveals[i]?.out(opts);
        },
      };
    };

    // Carousel Nav

    const initCarouselNav = () => {
      const prev = $('.carousel_arrow.is-prev');
      const next = $('.carousel_arrow.is-next');
      if (!window.carousel) return;

      const go = (fn) => (e) => {
        e.preventDefault();
        e.stopPropagation();
        fn();
      };
      prev?.addEventListener('click', go(() => window.carousel.previous()));
      next?.addEventListener('click', go(() => window.carousel.next()));
    };

    const initCarouselPagination = () => {
      const container = $('.carousel_pagination');
      if (!container || !window.carousel) return;

      const svg = $('svg', container);
      const dot = $('.carousel_pagination-dot', container);
      const slides = $$('.carousel_list.is-hero .carousel_slide');
      const count = slides.length;
      if (!count) return;

      const viewBoxWidth = 1000;
      const padding = 20;
      const usable = viewBoxWidth - padding * 2;

      const indexToX = (i) => padding + (usable / Math.max(count - 1, 1)) * i;
      const xToIndex = (x) => Math.round(((x - padding) / usable) * (count - 1));

      gsap.set(dot, {
        attr: { cx: indexToX(window.carousel.index) },
        transformBox: 'fill-box',
        transformOrigin: '50% 50%',
        x: 0,
      });

      let dotTl = null;

      window.carousel.changed.connect(({ index, previous }) => {
        const delta = index - previous;
        const isWrap = Math.abs(delta) > count / 2;

        if (dotTl) dotTl.kill();
        gsap.killTweensOf(dot);

        if (isWrap) {
          const exitRight = previous > index;
          const slide = 150;
          const exitX = exitRight ? slide : -slide;
          const enterX = exitRight ? -slide : slide;

          dotTl = gsap.timeline();
          dotTl
            .to(dot, { x: exitX, scale: 0, duration: 0.3, ease: 'power2.in' })
            .set(dot, { attr: { cx: indexToX(index) }, x: enterX })
            .to(dot, { x: 0, scale: 1, duration: 0.45, ease: 'power3.out' });
        } else {
          dotTl = gsap.timeline();
          dotTl.to(dot, { attr: { cx: indexToX(index) }, scale: 1, x: 0, duration: 0.6, ease: 'power3.out' });
        }
      });

      const getXFromEvent = (e) => {
        const rect = svg.getBoundingClientRect();
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const ratio = (clientX - rect.left) / rect.width;
        return clamp(ratio * viewBoxWidth, padding, viewBoxWidth - padding);
      };

      let dragging = false;

      const updateFromPointer = (e) => {
        if (document.documentElement.classList.contains('is-dish-boards')) return;
        const x = getXFromEvent(e);
        const targetIndex = clamp(xToIndex(x), 0, count - 1);
        if (targetIndex !== window.carousel.index) {
          window.carousel.goTo(targetIndex);
        }
      };

      container.addEventListener('pointerdown', (e) => {
        if (document.documentElement.classList.contains('is-dish-boards')) return;
        dragging = true;
        container.setPointerCapture(e.pointerId);
        updateFromPointer(e);
      });

      container.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        updateFromPointer(e);
      });

      container.addEventListener('pointerup', () => {
        dragging = false;
      });

      container.addEventListener('pointercancel', () => {
        dragging = false;
      });
    };

    // Carousel Gradient Angulaire

    const initGammeGradient = () => {
      const gradient = $('.gamme_gradient');
      if (!gradient || !window.carousel) return;

      const slides = $$('.carousel_list.is-hero .carousel_slide');
      if (!slides.length) return;

      const step = 360 / slides.length;
      let current = 0;

      gsap.set(gradient, { rotation: 0 });

      window.carousel.changed.connect(({ index, previous }) => {
        let delta = index - previous;
        if (delta > slides.length / 2) delta -= slides.length;
        if (delta < -slides.length / 2) delta += slides.length;

        current -= delta * step;

        gsap.to(gradient, {
          rotation: current,
          duration: 0.8,
          ease: 'power2.inOut',
          overwrite: true,
        });
      });
    };

    // Carousel Color

    const initCarouselColors = () => {
      const slides = $$('.carousel_list.is-hero .carousel_slide');
      if (!slides.length || !window.carousel) return;

      const root = document.documentElement;

      const applyColors = (slide) => {
        if (!slide) return;
        const catId = slide.getAttribute('data-menu-cat-id');
        if (window.westoCategoryTheme?.apply && catId != null) {
          const theme = window.westoCategoryTheme.apply(catId);
          if (theme && window.environment?.setColor) {
            window.environment.setColor(theme.tastePrimary, theme.tasteSecondary);
          }
          return;
        }
        const primary = slide.dataset.tastePrimary;
        const secondary = slide.dataset.tasteSecondary;
        if (primary) root.style.setProperty('--color-scheme-1--taste-primary', primary);
        if (secondary) root.style.setProperty('--color-scheme-1--taste-secondary', secondary);
        if (primary && window.environment?.setColor) {
          window.environment.setColor(primary, secondary);
        }
      };

      applyColors(slides[window.carousel.index]);

      const apply = debounce((index) => applyColors(slides[index]), 150);
      window.carousel.changed.connect(({ index }) => apply(index));
    };

    // Carousel Video

    const initCarouselVideo = () => {
      const section = $('.section.is-argument');
      if (!section || !window.carousel) return;

      const items = [...$$('.argument_video', section)].map((wrapper) => ({ wrapper, video: $('video', wrapper) })).filter((it) => it.video);
      if (!items.length) return;

      let inView = false;

      const activate = (video) => {
        video.setAttribute('autoplay', '');
        if (video.readyState === 0) video.load();

        const tryPlay = () => video.play().catch(() => {});
        if (video.readyState >= 2) tryPlay();
        else video.addEventListener('canplay', tryPlay, { once: true });
      };

      const deactivate = (video) => {
        video.removeAttribute('autoplay');
        video.pause();
      };

      const goTo = (i) => {
        items.forEach(({ wrapper, video }, idx) => {
          if (idx === i) {
            if (inView) activate(video);
            gsap.to(wrapper, { autoAlpha: 1, duration: 0.6, ease: 'power2.inOut', overwrite: true });
          } else {
            gsap.to(wrapper, {
              autoAlpha: 0,
              duration: 0.6,
              ease: 'power2.inOut',
              overwrite: true,
              onComplete: () => deactivate(video),
            });
          }
        });
      };

      items.forEach(({ wrapper }) => gsap.set(wrapper, { autoAlpha: 0 }));

      const apply = debounce((index) => {
        if (inView) goTo(index);
      }, 150);
      window.carousel.changed.connect(({ index }) => apply(index));

      ScrollTrigger.create({
        trigger: section,
        start: 'top bottom',
        end: 'bottom top',
        onToggle: ({ isActive }) => {
          inView = isActive;
          if (isActive && document.visibilityState !== 'hidden') goTo(window.carousel.index);
          else items.forEach(({ video }) => deactivate(video));
        },
      });

      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
          items.forEach(({ video }) => deactivate(video));
        } else if (inView) {
          goTo(window.carousel.index);
        }
      });
    };

    // #region Sections

    // Section Gamme

    const initSectionGamme = () => {
      const section = $('.section.is-gamme');
      if (!section) return;

      const tl = gsap.timeline({
        defaults: { duration: 0.5, ease: 'power2.inOut' },
        scrollTrigger: {
          trigger: section,
          // Mobile hero is ~100svh; `bottom bottom` fires on load and hides hints.
          start: isMobile() ? 'bottom top' : 'bottom bottom',
          toggleActions: 'play none none reverse',
        },
      });

      tl.to('.carousel_pagination, .icon-scroll_wrapper, .westo-scroll-hint--mobile, .westo-scroll-hint--mobile-right, .carousel_arrow.is-prev, .scroll_discover, .gamme_gradient-wrapper', { autoAlpha: 0 });

      if (isDesktop()) {
        tl.to('.carousel_title-collection', { autoAlpha: 0 }, '<');
        tl.to('.carousel_nav', { maxWidth: '55%' }, '<');
      }

      if (isMobile()) {
        tl.to('.carousel_arrow.is-next', { autoAlpha: 0 }, '<');
        tl.to('.carousel_title-collection', { y: '-2.5rem' }, '<');
      }

      // Hero is full-viewport on mobile — undo any immediate hide from ST init.
      requestAnimationFrame(() => syncHeroScrollHints(true));
    };

    let heroHintsApplied = false;
    const syncHeroScrollHints = (force) => {
      const gamme = $('.section.is-gamme');
      if (!gamme || document.documentElement.classList.contains('is-dish-boards')) return;
      const scrollPos = window.lenis?.scroll ?? window.scrollY ?? 0;
      const nearTop = scrollPos < Math.max(window.innerHeight * 0.08, 32);
      if (!force) {
        // Apply once per entry into the top zone — running two gsap.set on
        // every scroll frame at the hero caused constant style writes.
        if (!nearTop) {
          heroHintsApplied = false;
          return;
        }
        if (heroHintsApplied) return;
      }
      heroHintsApplied = nearTop;
      gsap.set('.hud_left, .hud_right', { x: 0, clearProps: 'transform' });
      gsap.set('.icon-scroll_wrapper, .westo-scroll-hint--mobile, .westo-scroll-hint--mobile-right, .scroll_discover, .carousel_pagination', { autoAlpha: 1 });
    };

    const reparentMobileScrollHint = () => {
      if (!isMobile()) return;
      // The original HUD already contains a left and a right animated scroll
      // glyph. Remove legacy mobile clones and let CSS place those two source
      // glyphs at the viewport edges, so the hint remains symmetric at every
      // phone/tablet size without a duplicate centered affordance.
      document.querySelectorAll('.westo-scroll-hint--mobile').forEach((node) => node.remove());
    };

    // Section Profile

    const initSectionProfile = () => {
      const section = $('.section.is-profile');
      if (!section) return;
      // Menu story skips profile — don't bind ST that hide gamme forever
      if (
        section.dataset.westoSkipped ||
        section.hasAttribute('hidden') ||
        getComputedStyle(section).display === 'none'
      ) return;

      const container = $('.profile_container', section);
      if (!container) return;

      const gammeContainer = $('.gamme_container');
      const reveal = initAnimations(section, '.carousel_desc, .carousel_title-b');

      gsap
        .timeline({
          defaults: { duration: 0.5, ease: 'power2.inOut' },
          scrollTrigger: {
            trigger: section,
            start: 'top bottom',
            end: 'bottom bottom',
            toggleActions: 'play reverse play reverse',
            onEnter: () => {
              document.body.classList.add('is-profile-active');
              reveal?.in({ delay: 0 });
              window.carouselText?.inActive({ delay: 0 });
            },
            onEnterBack: () => {
              reveal?.in({ delay: 0 });
              window.carouselText?.inActive({ delay: 0 });
              gsap.to(gammeContainer, { autoAlpha: 1, duration: 0.5, ease: 'power2.inOut' });
            },
            onLeave: () => {
              reveal?.out();
              window.carouselText?.outActive();
              gsap.to(gammeContainer, { autoAlpha: 0, duration: 0.5, ease: 'power2.inOut' });
            },
            onLeaveBack: () => {
              document.body.classList.remove('is-profile-active');
              reveal?.out();
              window.carouselText?.outActive();
            },
          },
        })
        .fromTo(container, { autoAlpha: 0 }, { autoAlpha: 1 })
        .fromTo('.carousel_title-bis-wrapper', { autoAlpha: 0 }, { autoAlpha: 1 }, '<');
    };

    // Restore hero category chrome after leaving dish boards (profile skip path)
    window.westoRestoreHeroChrome = ({ force } = {}) => {
      const onHero =
        force ||
        (!document.documentElement.classList.contains('is-dish-boards') &&
          (window.lenis?.scroll || 0) < (document.querySelector('section.is-benefits')?.offsetTop || 9999) * 0.55);
      if (!onHero && !force) return;
      gsap.killTweensOf(
        '.gamme_container, .carousel_title-collection, .navbar, .gamme_gradient-wrapper, .carousel_pagination, .scroll_component, .scroll_discover, .icon-scroll_wrapper, .westo-scroll-hint--mobile, .westo-scroll-hint--mobile-right, .carousel_arrow',
      );
      gsap.set(
        [
          '.gamme_container',
          '.carousel_title-collection',
          '.navbar',
          '.gamme_gradient-wrapper',
          '.carousel_pagination',
          '.scroll_component',
          '.scroll_discover',
          '.icon-scroll_wrapper',
          '.westo-scroll-hint--mobile',
          '.westo-scroll-hint--mobile-right',
          '.carousel_arrow',
          'main canvas',
        ].join(','),
        { autoAlpha: 1, y: 0, yPercent: 0 },
      );
      // Re-show active hero slide by category id (matches cans), not raw DOM index
      const slides = gsap.utils.toArray('.carousel_list.is-hero .carousel_slide');
      const idx =
        typeof window.carousel?.getIndex === 'function'
          ? window.carousel.getIndex(true)
          : window.carousel?.index ?? 0;
      const order =
        Array.isArray(window.__westoCategoryOrder) && window.__westoCategoryOrder.length
          ? window.__westoCategoryOrder
          : Array.isArray(window.__westoSlideCategoryOrder)
            ? window.__westoSlideCategoryOrder
            : [];
      const activeId = order[idx];
      slides.forEach((el, i) => {
        const catId = el.getAttribute('data-menu-cat-id');
        const on = activeId != null && catId ? String(catId) === String(activeId) : i === idx;
        gsap.set(el, { autoAlpha: on ? 1 : 0 });
        if (on) {
          $$(
            '[data-anim="chars-mask"] .line, [data-anim="chars-mask"] .word, [data-anim="chars-mask"] .char, [data-anim="chars-mask"]',
            el,
          ).forEach((leaf) => gsap.set(leaf, { yPercent: 0, clearProps: 'transform' }));
        }
      });
      window.carouselText?.inActive?.({ delay: 0 });
      document.body.classList.remove('is-profile-active');
      if (window.ScrollTrigger) window.ScrollTrigger.update();
    };

    // Section Benefits

    const initSectionBenefits = () => {
      const sections = $$('.section.is-benefits');
      if (!sections.length) return;
      sections.forEach((section) => {
        if (section.dataset.westoBenefitsBound) return;
        const container = $('.benefits_container', section);
        if (!container) return;
        section.dataset.westoBenefitsBound = '1';

        // Dish boards: SplitText + scroll reveal fights live menu copy + CSS grid
        // and makes the price/name card jump. Keep text stable.
        $$('[data-anim]', section).forEach((el) => el.removeAttribute('data-anim'));
        gsap.set(container, { autoAlpha: 1, clearProps: 'opacity,visibility' });
        gsap.set(section, { '--line': 1, '--benefits-line': 1 });
        $$('.benefits_text, [data-menu-name], [data-menu-desc], [data-menu-price]', section).forEach(
          (el) => gsap.set(el, { autoAlpha: 1, yPercent: 0, clearProps: 'transform' }),
        );
      });
    };

    // Called after table-cart clones dish boards past the initial HTML set
    window.westoRefreshBenefits = () => {
      const before = document.querySelectorAll('section.is-benefits[data-westo-benefits-bound]').length;
      initSectionBenefits();
      const after = document.querySelectorAll('section.is-benefits[data-westo-benefits-bound]').length;
      if (after > before && window.ScrollTrigger) window.ScrollTrigger.refresh();
    };

    const initBenefitsNav = () => {
      const nav = $('.benefits_nav');
      const sections = $$('.section.is-benefits');
      if (!nav || !sections.length) return;
      const profileSection = $('.section.is-profile');
      const startTrigger = profileSection && getComputedStyle(profileSection).display !== 'none' && !profileSection.hasAttribute('hidden')
        ? profileSection
        : sections[0];

      const icons = $$('.benefits_icon-wrapper', nav);

      const tl = gsap.timeline({
        defaults: { duration: 0.5, ease: 'power2.inOut' },
        scrollTrigger: {
          trigger: startTrigger,
          start: 'top bottom',
          endTrigger: sections[sections.length - 1],
          end: 'bottom bottom',
          toggleActions: 'play reverse play reverse',
        },
      });

      tl.fromTo(nav, { autoAlpha: 0 }, { autoAlpha: 1 });

      sections.forEach((section, i) => {
        ScrollTrigger.create({
          trigger: section,
          start: 'top bottom',
          end: 'bottom bottom',
          onToggle: ({ isActive }) => {
            // Menu rail owns single-active highlight via three-scene / table-cart
            if (document.querySelector('.benefits_nav.is-menu-rail')) return;
            icons[i]?.classList.toggle('is-active', isActive);
          },
        });
      });
    };

    // Section Argument

    const initSectionArgument = () => {
      const section = $('.section.is-argument');
      if (
        !section ||
        section.hasAttribute('hidden') ||
        section.dataset.westoTailSkipped ||
        getComputedStyle(section).display === 'none'
      ) return;

      const svgShapes = $$('.argument_svg svg path, .argument_svg svg polygon', section);
      const svgBlur = $('.argument_svg-blur', section);

      gsap.set(svgShapes, { autoAlpha: 0, scale: 0.6, transformOrigin: '50% 50%' });
      if (svgBlur) gsap.set(svgBlur, { autoAlpha: 0 });

      const animateSvgIn = () => {
        gsap.to(svgShapes, {
          autoAlpha: 1,
          scale: 1,
          duration: 0.5,
          ease: 'back.out(2)',
          stagger: 0.04,
          delay: 0.4,
          overwrite: true,
        });
        if (svgBlur) {
          gsap.to(svgBlur, {
            autoAlpha: 1,
            duration: 0.4,
            ease: 'power2.out',
            delay: 1,
            overwrite: true,
          });
        }
      };

      const animateSvgOut = () => {
        gsap.to(svgShapes, {
          autoAlpha: 0,
          scale: 0.6,
          duration: 0.4,
          ease: 'power2.in',
          overwrite: true,
        });
        if (svgBlur) {
          gsap.to(svgBlur, {
            autoAlpha: 0,
            duration: 0.4,
            ease: 'power2.in',
            overwrite: true,
          });
        }
      };

      gsap
        .timeline({
          defaults: { duration: 0.5, ease: 'power2.inOut' },
          scrollTrigger: {
            trigger: section,
            start: 'top bottom',
            end: 'bottom bottom',
            toggleActions: 'play reverse play reverse',
            onEnter: animateSvgIn,
            onEnterBack: animateSvgIn,
            onLeave: animateSvgOut,
            onLeaveBack: animateSvgOut,
          },
        })
        .fromTo('.argument_container', { autoAlpha: 0 }, { autoAlpha: 1 })
        .fromTo('.gradient_overlay', { autoAlpha: 1 }, { autoAlpha: 0 }, '<');
    };

    // Section Full Gamme

    const initSectionFullGamme = () => {
      const section = $('.section.is-full-gamme');
      if (
        !section ||
        section.hasAttribute('hidden') ||
        section.dataset.westoTailSkipped ||
        getComputedStyle(section).display === 'none'
      ) return;

      gsap.timeline({
        defaults: { duration: 0.5, ease: 'power2.inOut' },
        scrollTrigger: {
          trigger: section,
          start: 'top bottom',
          end: 'bottom bottom',
          toggleActions: 'play reverse play reverse',
          onEnter: () => document.body.classList.remove('is-profile-active'),
          onLeaveBack: () => document.body.classList.add('is-profile-active'),
        },
      });
    };

    // Section FAQ (mobile : fade out du HUD)

    const initSectionFaq = () => {
      if (!isMobile()) return;

      const section = $('.section.is-faq');
      if (
        !section ||
        section.hasAttribute('hidden') ||
        section.dataset.westoTailSkipped ||
        getComputedStyle(section).display === 'none'
      ) return;

      gsap.fromTo(
        '.hud_container',
        { autoAlpha: 1 },
        {
          autoAlpha: 0,
          duration: 0.5,
          ease: 'power2.inOut',
          scrollTrigger: {
            trigger: section,
            start: 'top bottom',
            end: 'bottom top',
            toggleActions: 'play reverse play reverse',
          },
        },
      );
    };

    const initLenisHashLinks = () => {
      document.addEventListener('click', (e) => {
        const a = e.target.closest('a[href^="#"]');
        if (!a || a.hasAttribute('data-menu-open')) return;
        const href = a.getAttribute('href') || '';
        if (href.length < 2 || href === '#') return;
        const id = href.slice(1);
        const el = document.getElementById(id) || document.querySelector(href);
        if (!el) return;
        e.preventDefault();
        // Close mobile nav if open
        const menuBtn = $('.navbar_menu-button.is-open');
        if (menuBtn) menuBtn.click();
        if (window.lenis) {
          window.lenis.scrollTo(el, { offset: 0, duration: 1.15 });
        } else {
          el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
        if (history.replaceState) {
          history.replaceState(null, '', href);
        }
      });
    };

    // #region Init

    const initWhenCarousel = (fn) => {
      if (window.carousel) {
        fn();
      } else {
        window.addEventListener('carousel:ready', fn, { once: true });
      }
    };

    const setupCarouselText = () => {
      window.carouselText = initCarouselText();
    };

    initLoader();
    initSoundToggle();
    initMenuButton();
    initMenuToggle();
    initLenisHashLinks();
    reparentMobileScrollHint();
    initScrollIcon();
    initCarouselArrowsHover();
    initWhenCarousel(setupCarouselText);
    initWhenCarousel(initCarouselNav);
    initWhenCarousel(initCarouselPagination);
    initWhenCarousel(initCarouselColors);
    initWhenCarousel(initGammeGradient);
    initWhenCarousel(initCarouselVideo);
    initSectionGamme();
    initWhenCarousel(() => {
      reparentMobileScrollHint();
      syncHeroScrollHints(true);
    });
    window.lenis?.on('scroll', () => syncHeroScrollHints(false));
    initSectionProfile();
    initSectionBenefits();
    initBenefitsNav();
    initSectionArgument();
    initSectionFullGamme();
    initSectionFaq();
    };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', westOAnimationsBoot, { once: true });
  } else {
    westOAnimationsBoot();
  }

;/* ===== END js/animations.js ===== */

/* ===== BEGIN js/sounds.js ===== */
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


;/* ===== END js/sounds.js ===== */
