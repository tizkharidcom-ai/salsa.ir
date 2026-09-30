/**
 * prototype/js/godmode/api/control-plane-client.js
 *
 * Canonical Unified API Client for SALSA Control Plane (/api/control).
 * All God Mode browser data communications MUST pass through this client (superadmin.md §15.2).
 * Direct browser calls to tenant runtime (port 4180) or raw printer endpoints are strictly prohibited.
 */

(function (global) {
  'use strict';

  const DEFAULT_CONTROL_PLANE_URL = 'http://127.0.0.1:3061';
  const DEFAULT_TIMEOUT_MS = 10000;

  /**
   * BrowserControlPlaneClient (Phases 7 & 8)
   * Cookie-based, credentials include, CSRF-aware, zero auth secret tokens in localStorage.
   */
  class BrowserControlPlaneClient {
    constructor() {
      this._baseUrl = this._resolveBaseUrl();
      this._csrfToken = null;
      this._session = null;
      this._purgeLocalStorageSecrets();
    }

    _purgeLocalStorageSecrets() {
      // P0 Phase 8: Never store platform tokens or secrets in localStorage
      try {
        localStorage.removeItem('salsa_platform_token');
        localStorage.removeItem('salsa_platform_csrf');
        localStorage.removeItem('salsa_control_url');
      } catch (_) {}
    }

    _resolveBaseUrl() {
      if (global.__SALSA_RUNTIME_CONFIG__ && global.__SALSA_RUNTIME_CONFIG__.apiBase) {
        return String(global.__SALSA_RUNTIME_CONFIG__.apiBase).replace(/\/$/, '');
      }
      if (global.__SALSA_CONTROL_URL__) {
        return String(global.__SALSA_CONTROL_URL__).replace(/\/$/, '');
      }
      if (global.location && (global.location.port === '3061')) {
        return global.location.origin;
      }
      if (global.location && ['localhost', '127.0.0.1'].includes(global.location.hostname)) {
        return `${global.location.protocol}//${global.location.hostname}:3061`;
      }
      return DEFAULT_CONTROL_PLANE_URL;
    }

    _getCsrfToken() {
      if (this._csrfToken) return this._csrfToken;
      if (typeof document !== 'undefined' && document.cookie) {
        const match = document.cookie.match(/(?:salsa|neem)_platform_csrf=([^;]+)/);
        if (match && match[1]) {
          try {
            return decodeURIComponent(match[1]);
          } catch (_) {
            return match[1];
          }
        }
      }
      return null;
    }

    setCsrfToken(csrfToken) {
      this._csrfToken = csrfToken || null;
    }

    getBaseUrl() {
      return this._baseUrl;
    }

    setBaseUrl(url) {
      this._baseUrl = String(url || DEFAULT_CONTROL_PLANE_URL).replace(/\/$/, '');
    }

    /**
     * Session Bootstrap (Phases 2, 7 & 8)
     * Verifies platform principal and active session from /api/control/auth/session via HttpOnly cookie
     */
    async bootstrapSession() {
      try {
        const res = await this.get('/api/control/auth/session', { timeoutMs: 5000 });
        if (res.ok && res.data?.principal) {
          if (res.data.session?.csrfToken) {
            this._csrfToken = res.data.session.csrfToken;
          }
          this._session = res.data.session;
          if (global.GodModePermissions) {
            global.GodModePermissions.setPrincipal(res.data.principal);
          }
          if (global.dispatchEvent && typeof global.CustomEvent === 'function') {
            global.dispatchEvent(new CustomEvent('salsa:authenticated', { detail: res.data }));
          }
          return { ok: true, principal: res.data.principal, session: res.data.session };
        }
        if (res.data?.mfaRequired) {
          return { ok: false, mfaRequired: true, challengeTicket: res.data.challengeTicket };
        }
      } catch (err) {
        if (err.status === 401) {
          this._handleUnauthorized('UNAUTHENTICATED', 'No active platform session.');
          return { ok: false, unauthenticated: true };
        }
        return { ok: false, error: err.message };
      }
      return { ok: false };
    }

    /**
     * Core normalized HTTP Request
     */
    async request(endpoint, options = {}) {
      const method = String(options.method || 'GET').toUpperCase();
      const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
      const url = `${this._baseUrl}${cleanEndpoint}`;
      const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;

      const requestId = options.requestId || (global.crypto?.randomUUID ? global.crypto.randomUUID() : `req_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`);

      const headers = {
        'Accept': 'application/json',
        'X-Request-Id': requestId,
        ...options.headers
      };

      if (this._token) {
        headers['Authorization'] = `Bearer ${this._token}`;
      }

      // Read CSRF token from property or document.cookie for state mutations
      const csrfToken = this._getCsrfToken();
      if (csrfToken && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
        headers['X-CSRF-Token'] = csrfToken;
      }

      // Optimistic concurrency control (expectedVersion / If-Match §23)
      if (options.expectedVersion != null) {
        headers['If-Match'] = `"${options.expectedVersion}"`;
      }

      let body = options.body;
      if (body && typeof body === 'object' && !(body instanceof FormData) && !(body instanceof Blob)) {
        headers['Content-Type'] = 'application/json';
        body = JSON.stringify(body);
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(new Error(`درخواست به سرور با وقفه زمانی (${timeoutMs}ms) متوقف شد.`)), timeoutMs);

      const startedAt = Date.now();

      try {
        const response = await fetch(url, {
          method,
          headers,
          body,
          credentials: 'include', // Includes HttpOnly cookies for same-site / CORS allowed origin
          signal: controller.signal
        });

        clearTimeout(timer);
        const durationMs = Date.now() - startedAt;

        let responseData = null;
        const contentType = response.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          try {
            responseData = await response.json();
          } catch (_) {
            responseData = null;
          }
        } else {
          responseData = await response.text();
        }

        if (!response.ok) {
          const errorCode = responseData?.error?.code || responseData?.error || `HTTP_${response.status}`;
          const errorMessage = responseData?.error?.message || responseData?.message || `خطای سرور: کد وضعیت ${response.status}`;

          // If unauthorized, notify session listeners
          if (response.status === 401) {
            this._handleUnauthorized(errorCode, errorMessage);
          }

          const error = new Error(errorMessage);
          error.status = response.status;
          error.code = errorCode;
          error.requestId = requestId;
          error.details = responseData?.error?.details || responseData?.details || null;
          error.meta = {
            source: 'control-plane',
            status: 'failed',
            observedAt: new Date().toISOString(),
            requestId,
            durationMs
          };
          throw error;
        }

        // Return standardized envelope
        const payload = responseData && responseData.data !== undefined ? responseData.data : responseData;
        return {
          ok: true,
          data: payload,
          meta: {
            source: 'control-plane',
            status: 'live',
            observedAt: new Date().toISOString(),
            requestId,
            durationMs
          }
        };
      } catch (err) {
        clearTimeout(timer);
        if (err.name === 'AbortError' || err.message?.includes('وقفه زمانی')) {
          const timeoutErr = new Error('سرور کنترل پلن پاسخ نداد (تایم‌اوت شبکه).');
          timeoutErr.status = 504;
          timeoutErr.code = 'GATEWAY_TIMEOUT';
          timeoutErr.requestId = requestId;
          timeoutErr.meta = {
            source: 'control-plane',
            status: 'failed',
            observedAt: new Date().toISOString(),
            requestId
          };
          throw timeoutErr;
        }
        if (!err.meta) {
          err.meta = {
            source: 'control-plane',
            status: 'failed',
            observedAt: new Date().toISOString(),
            requestId
          };
        }
        throw err;
      }
    }

    _handleUnauthorized(code, message) {
      if (global.dispatchEvent && typeof global.CustomEvent === 'function') {
        global.dispatchEvent(new CustomEvent('salsa:unauthorized', { detail: { code, message } }));
      }
    }

    // Convenience HTTP verbs
    get(endpoint, options = {}) {
      return this.request(endpoint, { ...options, method: 'GET' });
    }

    post(endpoint, body, options = {}) {
      return this.request(endpoint, { ...options, method: 'POST', body });
    }

    put(endpoint, body, options = {}) {
      return this.request(endpoint, { ...options, method: 'PUT', body });
    }

    patch(endpoint, body, options = {}) {
      return this.request(endpoint, { ...options, method: 'PATCH', body });
    }

    delete(endpoint, options = {}) {
      return this.request(endpoint, { ...options, method: 'DELETE' });
    }

    // Normalize error envelope (§64)
    normalizeError(err) {
      if (!err) return { code: 'UNKNOWN_ERROR', message: 'خطای ناشناخته', status: 500 };
      const res = err.response || err;
      const data = res.data || {};
      const errorObj = data.error || {};
      return {
        status: res.status || err.status || 500,
        code: errorObj.code || err.code || 'INTERNAL_ERROR',
        message: errorObj.message || err.message || 'خطای غیرمنتظره در ارتباط با کنترل پلن.',
        userMessage: errorObj.userMessage || errorObj.message || err.message,
        details: errorObj.details || null,
        requestId: errorObj.requestId || err.requestId || null,
        retryable: Boolean(errorObj.retryable),
        fieldErrors: errorObj.fieldErrors || null,
        conflictVersion: errorObj.conflictVersion || null
      };
    }

    // Ping / Health check
    async checkHealth() {
      try {
        const res = await this.get('/api/control/health', { timeoutMs: 3000 });
        return { ok: true, data: res.data };
      } catch (err) {
        return { ok: false, error: err.message, status: err.status || 0 };
      }
    }
  }

  /**
   * ServiceControlPlaneClient (Phases 7 & 8)
   * Internal / service runner client supporting explicit bearer token.
   */
  class ServiceControlPlaneClient extends BrowserControlPlaneClient {
    constructor(options = {}) {
      super();
      if (options.baseUrl) this._baseUrl = options.baseUrl;
      this._serviceToken = options.token || null;
    }

    setToken(token) {
      this._serviceToken = token;
    }

    async request(endpoint, options = {}) {
      const opts = { ...options, headers: { ...options.headers } };
      if (this._serviceToken) {
        opts.headers['Authorization'] = `Bearer ${this._serviceToken}`;
      }
      return super.request(endpoint, opts);
    }
  }

  const defaultBrowserClient = new BrowserControlPlaneClient();
  global.BrowserControlPlaneClient = BrowserControlPlaneClient;
  global.ServiceControlPlaneClient = ServiceControlPlaneClient;
  global.ControlPlaneClient = defaultBrowserClient;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = defaultBrowserClient;
    module.exports.BrowserControlPlaneClient = BrowserControlPlaneClient;
    module.exports.ServiceControlPlaneClient = ServiceControlPlaneClient;
    module.exports.ControlPlaneClient = defaultBrowserClient;
  }
})(typeof window !== 'undefined' ? window : globalThis);
