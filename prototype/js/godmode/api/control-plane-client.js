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

  class ControlPlaneClient {
    constructor() {
      this._baseUrl = this._resolveBaseUrl();
      this._token = null;
      this._csrfToken = null;
      this._loadStoredCredentials();
    }

    _resolveBaseUrl() {
      if (global.__SALSA_CONTROL_URL__) {
        return String(global.__SALSA_CONTROL_URL__).replace(/\/$/, '');
      }
      try {
        const stored = localStorage.getItem('salsa_control_url');
        if (stored) return stored.replace(/\/$/, '');
      } catch (_) {}

      // If running directly on port 3061, use origin
      if (global.location && (global.location.port === '3061')) {
        return global.location.origin;
      }
      return DEFAULT_CONTROL_PLANE_URL;
    }

    _loadStoredCredentials() {
      try {
        this._token = localStorage.getItem('salsa_platform_token') || null;
        this._csrfToken = localStorage.getItem('salsa_platform_csrf') || null;
      } catch (_) {}
    }

    setCredentials(token, csrfToken) {
      this._token = token || null;
      this._csrfToken = csrfToken || null;
      try {
        if (token) localStorage.setItem('salsa_platform_token', token);
        else localStorage.removeItem('salsa_platform_token');

        if (csrfToken) localStorage.setItem('salsa_platform_csrf', csrfToken);
        else localStorage.removeItem('salsa_platform_csrf');
      } catch (_) {}
    }

    clearCredentials() {
      this.setCredentials(null, null);
    }

    getBaseUrl() {
      return this._baseUrl;
    }

    setBaseUrl(url) {
      this._baseUrl = String(url || DEFAULT_CONTROL_PLANE_URL).replace(/\/$/, '');
      try {
        localStorage.setItem('salsa_control_url', this._baseUrl);
      } catch (_) {}
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

      if (this._csrfToken && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
        headers['X-CSRF-Token'] = this._csrfToken;
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

  const ControlPlaneClientInstance = new ControlPlaneClient();
  global.ControlPlaneClient = ControlPlaneClientInstance;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = ControlPlaneClientInstance;
  }
})(typeof window !== 'undefined' ? window : globalThis);
