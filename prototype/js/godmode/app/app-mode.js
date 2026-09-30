/**
 * prototype/js/godmode/app/app-mode.js
 *
 * Strict Environment and Mode Manager for SALSA God Mode.
 * Ensures absolute separation between Demo Mode and Production Mode (superadmin.md §14.1).
 *
 * In Production Mode:
 *   - Strictly forbids DEFAULT_FLEET fallback.
 *   - Forbids fake operational telemetry (fake ping, fake RPS, hardcoded 100% health).
 *   - Failed API requests MUST surface as Error or Unknown, never masked by mock data.
 *
 * In Demo Mode:
 *   - Displays persistent Demo Data banner.
 *   - Uses unified fixture provider.
 */

(function (global) {
  'use strict';

  const STORAGE_KEY = 'salsa_godmode_app_mode';

  class AppModeManager {
    constructor() {
      this._mode = this._detectInitialMode();
      this._listeners = new Set();
    }

    _detectInitialMode() {
      // 1. Explicit window override
      if (global.__SALSA_APP_MODE__) {
        return global.__SALSA_APP_MODE__ === 'production' ? 'production' : 'demo';
      }
      // 2. Query param ?mode=production or ?mode=demo
      if (global.location && global.location.search) {
        const search = new URLSearchParams(global.location.search);
        const qm = search.get('mode');
        if (qm === 'production' || qm === 'demo') {
          try { localStorage.setItem(STORAGE_KEY, qm); } catch (_) {}
          return qm;
        }
      }
      // 3. LocalStorage preference
      try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored === 'production' || stored === 'demo') return stored;
      } catch (_) {}

      // Default: demo mode for isolated prototype, production mode when served behind control plane
      return 'demo';
    }

    get mode() {
      return this._mode;
    }

    getMode() {
      return this._mode;
    }

    isProduction() {
      return this._mode === 'production';
    }

    isDemo() {
      return this._mode === 'demo';
    }

    setMode(nextMode) {
      if (nextMode !== 'production' && nextMode !== 'demo') {
        throw new Error(`Invalid app mode: ${nextMode}. Must be 'production' or 'demo'.`);
      }
      if (this._mode === nextMode) return;
      this._mode = nextMode;
      try {
        localStorage.setItem(STORAGE_KEY, nextMode);
      } catch (_) {}
      this._notify();
    }

    toggleMode() {
      this.setMode(this._mode === 'production' ? 'demo' : 'production');
    }

    subscribe(listener) {
      if (typeof listener === 'function') {
        this._listeners.add(listener);
      }
      return () => this._listeners.delete(listener);
    }

    _notify() {
      for (const listener of this._listeners) {
        try {
          listener(this._mode);
        } catch (e) {
          console.error('[AppMode] Listener error:', e);
        }
      }
    }
  }

  const GodModeAppMode = new AppModeManager();
  global.GodModeAppMode = GodModeAppMode;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = GodModeAppMode;
  }
})(typeof window !== 'undefined' ? window : globalThis);
