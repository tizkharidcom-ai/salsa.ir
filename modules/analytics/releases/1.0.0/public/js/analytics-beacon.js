/* Lightweight visitor beacon for admin analytics.
   Performance note: analytics is not part of the guest UI critical path.
   The beacon therefore waits until window load + idle, but still flushes on
   pagehide so short visits are not lost. */
(() => {
  'use strict';

  const ENDPOINT = '/api/analytics/visit';
  const SESSION_KEY = 'westo_vid';
  const IDLE_TIMEOUT_MS = 4000;
  const FALLBACK_DELAY_MS = 1200;

  let sent = false;
  let idleId = 0;
  let timerId = 0;
  let payloadBody = '';

  function getSessionId() {
    try {
      let sessionId = sessionStorage.getItem(SESSION_KEY);
      if (!sessionId) {
        sessionId = `${Date.now().toString(36)}-${Math.random()
          .toString(36)
          .slice(2, 10)}`;
        sessionStorage.setItem(SESSION_KEY, sessionId);
      }
      return sessionId;
    } catch (_) {
      // Analytics must never interfere with the guest experience when storage
      // is unavailable (private mode, policy restrictions, etc.).
      return `${Date.now().toString(36)}-${Math.random()
        .toString(36)
        .slice(2, 10)}`;
    }
  }

  function buildBody() {
    if (payloadBody) return payloadBody;
    payloadBody = JSON.stringify({
      path: location.pathname + location.search,
      referrer: document.referrer || '',
      sessionId: getSessionId(),
    });
    return payloadBody;
  }

  function cancelScheduledSend() {
    if (idleId && typeof window.cancelIdleCallback === 'function') {
      window.cancelIdleCallback(idleId);
    }
    if (timerId) window.clearTimeout(timerId);
    idleId = 0;
    timerId = 0;
  }

  function send() {
    if (sent) return;
    sent = true;
    cancelScheduledSend();

    try {
      const body = buildBody();

      if (typeof navigator.sendBeacon === 'function') {
        const accepted = navigator.sendBeacon(
          ENDPOINT,
          new Blob([body], { type: 'application/json' }),
        );
        if (accepted) return;
      }

      fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: true,
        credentials: 'same-origin',
        cache: 'no-store',
      }).catch(() => {});
    } catch (_) {
      /* Analytics is best-effort and must stay invisible to the UI. */
    }
  }

  function scheduleIdleSend() {
    if (sent || idleId || timerId) return;

    if (typeof window.requestIdleCallback === 'function') {
      idleId = window.requestIdleCallback(
        () => {
          idleId = 0;
          send();
        },
        { timeout: IDLE_TIMEOUT_MS },
      );
      return;
    }

    timerId = window.setTimeout(() => {
      timerId = 0;
      send();
    }, FALLBACK_DELAY_MS);
  }

  function scheduleAfterLoad() {
    if (document.readyState === 'complete') {
      scheduleIdleSend();
      return;
    }
    window.addEventListener('load', scheduleIdleSend, { once: true });
  }

  // Preserve analytics for very short visits without putting the request back
  // onto the startup path.
  window.addEventListener('pagehide', send, { once: true });

  try {
    scheduleAfterLoad();
  } catch (_) {
    /* ignore */
  }
})();
