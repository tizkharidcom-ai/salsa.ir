/* Navbar auth-state bridge.
   Keeps the guest button usable immediately, but moves /api/auth/me out of the
   parser/boot burst. The authenticated label is reconciled after DOM ready +
   idle, or immediately when the user shows intent to use the auth button.

   Integration contracts kept intact:
   - #nav-auth-btn stays the single source of navbar auth navigation.
   - staff roles -> /admin + «پنل»; regular users -> /profile + «پروفایل».
   - buttons.js may have already split the label into .layer-top/.layer-bottom;
     this file safely updates either the split or unsplit form.
*/
(function () {
  'use strict';

  var btn = document.getElementById('nav-auth-btn');
  if (!btn) return;

  var STAFF_ROLES = new Set(['owner', 'manager', 'cashier', 'kitchen', 'admin']);
  var IDLE_TIMEOUT_MS = 1800;
  var FALLBACK_DELAY_MS = 700;
  var FETCH_TIMEOUT_MS = 5000;

  var requestPromise = null;
  var controller = null;
  var fetchTimeout = 0;
  var idleHandle = 0;
  var delayTimer = 0;
  var settled = false;
  var destroyed = false;

  function clearSchedule() {
    if (idleHandle && typeof window.cancelIdleCallback === 'function') {
      window.cancelIdleCallback(idleHandle);
    }
    idleHandle = 0;
    if (delayTimer) window.clearTimeout(delayTimer);
    delayTimer = 0;
  }

  function clearFetchTimeout() {
    if (!fetchTimeout) return;
    window.clearTimeout(fetchTimeout);
    fetchTimeout = 0;
  }

  function splitLabel(text) {
    var isArabicScript = /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/.test(text);
    var pieces = isArabicScript
      ? text.split(/\s+/).map(function (word, index, list) {
          return index < list.length - 1 ? word + ' ' : word;
        })
      : text.split('');

    return pieces
      .map(function (char) {
        return (
          '<span class="char" style="display:inline-block;">' +
          (char === ' ' ? '&nbsp;' : char.replace(/ /g, '&nbsp;')) +
          '</span>'
        );
      })
      .join('');
  }

  function killDetachedButtonTweens(top, bottom) {
    if (!window.gsap || typeof window.gsap.killTweensOf !== 'function') return;
    var oldChars = [];
    if (top) oldChars.push.apply(oldChars, top.querySelectorAll('.char'));
    if (bottom) oldChars.push.apply(oldChars, bottom.querySelectorAll('.char'));
    if (oldChars.length) window.gsap.killTweensOf(oldChars);
  }

  function resetBottomLayer(bottom) {
    if (!bottom) return;
    var bottomChars = bottom.querySelectorAll('.char');
    if (!bottomChars.length) return;

    if (window.gsap && typeof window.gsap.set === 'function') {
      window.gsap.set(bottomChars, { y: '110%' });
      return;
    }

    // Extremely early/fallback path: preserve the same resting visual state
    // until GSAP/buttons.js is available.
    bottomChars.forEach(function (char) {
      char.style.transform = 'translateY(110%)';
    });
  }

  function applyButtonState(labelText, href, state) {
    if (destroyed) return false;

    btn.setAttribute('href', href);

    var top = btn.querySelector('.layer-top');
    var bottom = btn.querySelector('.layer-bottom');

    if (top && bottom) {
      killDetachedButtonTweens(top, bottom);
      var chars = splitLabel(labelText);
      top.innerHTML = chars;
      bottom.innerHTML = chars;
      resetBottomLayer(bottom);
    } else {
      var label = btn.querySelector('div') || btn;
      label.textContent = labelText;
    }

    btn.dataset.westoAuthResolved = state;
    return true;
  }

  function applyUser(user) {
    if (!user || destroyed) return false;
    var canOpenPanel = STAFF_ROLES.has(String(user.role || '').toLowerCase());
    return applyButtonState(
      canOpenPanel ? 'پنل' : 'پروفایل',
      canOpenPanel ? '/admin' : '/profile',
      'user',
    );
  }

  function applyGuestIfNeeded() {
    // Normal first-load guests already have the correct server-rendered button,
    // so avoid a needless DOM rewrite. This path matters for bfcache restores
    // after logout or an expired session.
    if (btn.dataset.westoAuthResolved !== 'user') return;
    applyButtonState('ورود', '/login', 'guest');
  }

  function fetchAuthState() {
    if (destroyed || settled) return requestPromise || Promise.resolve(null);
    if (requestPromise) return requestPromise;

    clearSchedule();
    controller = typeof AbortController === 'function' ? new AbortController() : null;

    if (controller) {
      fetchTimeout = window.setTimeout(function () {
        controller && controller.abort();
      }, FETCH_TIMEOUT_MS);
    }

    requestPromise = fetch('/api/auth/me', {
      credentials: 'same-origin',
      cache: 'no-store',
      signal: controller ? controller.signal : undefined,
    })
      .then(function (response) {
        return response.ok ? response.json() : null;
      })
      .then(function (data) {
        if (destroyed) return null;
        settled = true;
        var user = data && data.user ? data.user : null;
        if (user) applyUser(user);
        else applyGuestIfNeeded();
        return user;
      })
      .catch(function (error) {
        // Guest/offline/timeout: keep the original login button. Abort caused by
        // pagehide is intentionally retryable on pageshow.
        if (error && error.name === 'AbortError') return null;
        settled = true;
        return null;
      })
      .finally(function () {
        clearFetchTimeout();
        controller = null;
        requestPromise = null;
      });

    return requestPromise;
  }

  function scheduleAuthCheck() {
    if (destroyed || settled || requestPromise || idleHandle || delayTimer) return;
    if (document.visibilityState === 'hidden') return;

    if (typeof window.requestIdleCallback === 'function') {
      idleHandle = window.requestIdleCallback(
        function () {
          idleHandle = 0;
          fetchAuthState();
        },
        { timeout: IDLE_TIMEOUT_MS },
      );
      return;
    }

    delayTimer = window.setTimeout(function () {
      delayTimer = 0;
      fetchAuthState();
    }, FALLBACK_DELAY_MS);
  }

  function scheduleAfterPageLoad() {
    if (document.readyState === 'complete') {
      scheduleAuthCheck();
      return;
    }
    window.addEventListener('load', scheduleAuthCheck, { once: true });
  }

  function handleIntent() {
    // If the visitor is actually heading for the account control, do not make
    // them wait for the background idle slot.
    fetchAuthState();
  }

  function handleVisibility() {
    if (document.visibilityState === 'visible') scheduleAuthCheck();
  }

  function handlePageHide() {
    clearSchedule();
    clearFetchTimeout();
    if (controller) controller.abort();
    controller = null;
    requestPromise = null;
  }

  function handlePageShow(event) {
    // A bfcache restore can happen after login/logout in another page. Recheck
    // instead of trusting the old in-memory auth result forever.
    if (event && event.persisted) {
      settled = false;
        btn.removeAttribute('data-westo-auth-resolved');
    }
    scheduleAuthCheck();
  }

  btn.addEventListener('pointerenter', handleIntent, { once: true, passive: true });
  btn.addEventListener('focus', handleIntent, { once: true, passive: true });
  btn.addEventListener('touchstart', handleIntent, { once: true, passive: true });
  document.addEventListener('visibilitychange', handleVisibility);
  window.addEventListener('pagehide', handlePageHide);
  window.addEventListener('pageshow', handlePageShow);

  scheduleAfterPageLoad();
})();
