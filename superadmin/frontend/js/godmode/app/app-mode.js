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
      this._runtimeConfig = this._loadRuntimeConfig();
      this._isImmutable = this._runtimeConfig && this._runtimeConfig.environment === 'production';
      this._mode = this._detectInitialMode();
      this._listeners = new Set();
    }

    _loadRuntimeConfig() {
      if (global.__SALSA_RUNTIME_CONFIG__ && typeof global.__SALSA_RUNTIME_CONFIG__ === 'object') {
        return global.__SALSA_RUNTIME_CONFIG__;
      }
      return null;
    }

    _detectInitialMode() {
      // 1. Immutable Server Runtime Config (P0 Phase 6)
      if (this._runtimeConfig && this._runtimeConfig.environment) {
        return this._runtimeConfig.environment === 'production' ? 'production' : 'demo';
      }

      // Runtime fixtures are allowed only under the automated test process.
      if (typeof process !== 'undefined' && process.env?.NODE_ENV === 'test') return 'demo';
      return 'production';
    }

    get mode() {
      return this._mode;
    }

    getMode() {
      return this._mode;
    }

    getRuntimeConfig() {
      return this._runtimeConfig;
    }

    isProduction() {
      return this._mode === 'production';
    }

    isDemo() {
      return this._mode === 'demo';
    }

    isImmutable() {
      return this._isImmutable;
    }

    setMode(nextMode) {
      if (this._isImmutable) {
        console.warn('[AppMode] Cannot change mode: environment is immutable in production.');
        return;
      }
      const isTest = typeof process !== 'undefined' && process.env?.NODE_ENV === 'test';
      if (nextMode !== 'production' && !(isTest && nextMode === 'demo')) {
        throw new Error('Demo mode is disabled outside automated tests.');
      }
      if (this._mode === nextMode) return;
      this._mode = nextMode;
      this._notify();
    }

    toggleMode() {
      if (this._isImmutable) {
        console.warn('[AppMode] Cannot toggle mode: environment is immutable in production.');
        return;
      }
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
