/**
 * superadmin/frontend/js/godmode/app/bootstrap.js
 *
 * Canonical Bootstrap Orchestrator for SALSA God Mode (Phases 2 & 3).
 * Enforces strict fail-closed authentication boundary before any protected
 * page or component renderer executes.
 *
 * Lifecycle States:
 *   INITIALIZING -> CHECKING_SESSION -> [MFA_REQUIRED | AUTHENTICATED | UNAUTHENTICATED | ACCESS_DENIED | BOOTSTRAP_FAILED]
 */

(function (global) {
  'use strict';

  const BootstrapState = Object.freeze({
    INITIALIZING: 'INITIALIZING',
    CHECKING_SESSION: 'CHECKING_SESSION',
    MFA_REQUIRED: 'MFA_REQUIRED',
    AUTHENTICATED: 'AUTHENTICATED',
    UNAUTHENTICATED: 'UNAUTHENTICATED',
    ACCESS_DENIED: 'ACCESS_DENIED',
    BOOTSTRAP_FAILED: 'BOOTSTRAP_FAILED'
  });

  class GodModeBootstrap {
    constructor() {
      this._state = BootstrapState.INITIALIZING;
      this._client = global.ControlPlaneClient || (global.BrowserControlPlaneClient ? new global.BrowserControlPlaneClient() : null);
      this._permissions = global.GodModePermissions;
      this._appMode = global.GodModeAppMode;
      this._runtimeConfig = null;
      this._principal = null;
      this._session = null;
      this._lastError = null;
    }

    getState() {
      return this._state;
    }

    async init() {
      this._state = BootstrapState.INITIALIZING;

      // 1. Load Immutable Runtime Configuration
      this._runtimeConfig = this._loadRuntimeConfig();

      // 2. Render initial loading barrier (Phase 3: Auth Boundary)
      this._renderLoadingBarrier('در حال بررسی نشست مدیریتی پلتفرم سالسا…');

      // 3. Ensure client is available
      if (!this._client && global.ControlPlaneClient) {
        this._client = global.ControlPlaneClient;
      }

      // 4. Check active platform session
      this._state = BootstrapState.CHECKING_SESSION;
      try {
        const sessionRes = await this._client.bootstrapSession();

        if (sessionRes && sessionRes.ok && sessionRes.principal) {
          const principalEmail = String(sessionRes.principal.email || '').trim().toLowerCase();
          const isDevFixture = principalEmail === 'dev_owner@neem.internal';
          if (isDevFixture && this._runtimeConfig?.environment === 'production' && this._runtimeConfig?.devSessionEnabled !== true) {
            this._state = BootstrapState.ACCESS_DENIED;
            this._setHeaderSessionStatus(false, null, 'حساب توسعه برای محیط تولید مجاز نیست');
            this._renderAccessDenied('نشست Local Dev Owner یک حساب توسعه‌ای است و در محیط تولید پذیرفته نمی‌شود. برای دسترسی عملیاتی، راهبر پلتفرم واقعی باید جداگانه provision شود.');
            return { ok: false, state: this._state, error: 'DEVELOPMENT_PRINCIPAL_FORBIDDEN_IN_PRODUCTION' };
          }

          // Session valid and authenticated
          this._principal = sessionRes.principal;
          this._session = sessionRes.session;
          this._state = BootstrapState.AUTHENTICATED;
          this._setHeaderSessionStatus(true, this._principal);

          // Set authenticated principal in PermissionManager
          if (this._permissions) {
            this._permissions.setPrincipal(this._principal);
          }

          // Tear down auth barrier
          this._clearBarrier();

          // Initialize Shell & Router
          if (global.GodModeAppShell) global.GodModeAppShell.init();
          if (global.GodModeRouter) global.GodModeRouter.init();

          return { ok: true, state: this._state, principal: this._principal };
        }

        // If session endpoint indicates MFA challenge required
        if (sessionRes && sessionRes.mfaRequired) {
          this._state = BootstrapState.MFA_REQUIRED;
          this._setHeaderSessionStatus(false);
          this._renderMfaChallenge(sessionRes.challengeTicket);
          return { ok: false, state: this._state };
        }

        // If unauthenticated (401)
        this._state = BootstrapState.UNAUTHENTICATED;
        this._setHeaderSessionStatus(false);
        this._renderLoginSurface();
        return { ok: false, state: this._state };
      } catch (err) {
        if (err.status === 401) {
          this._state = BootstrapState.UNAUTHENTICATED;
          this._setHeaderSessionStatus(false);
          this._renderLoginSurface();
          return { ok: false, state: this._state };
        }
        if (err.status === 403) {
          this._state = BootstrapState.ACCESS_DENIED;
          this._setHeaderSessionStatus(false);
          this._renderAccessDenied(err.message);
          return { ok: false, state: this._state };
        }

        this._lastError = err;
        this._state = BootstrapState.BOOTSTRAP_FAILED;
        this._setHeaderSessionStatus(false);
        this._renderBootstrapFailed(err);
        return { ok: false, state: this._state, error: err };
      }
    }

    _loadRuntimeConfig() {
      if (global.__SALSA_RUNTIME_CONFIG__) {
        return global.__SALSA_RUNTIME_CONFIG__;
      }
      const config = {
        environment: (global.location && (global.location.hostname === 'localhost' || global.location.hostname === '127.0.0.1')) ? 'development' : 'production',
        apiBase: global.location ? `${global.location.protocol}//${global.location.hostname}:3061` : 'http://127.0.0.1:3061',
        buildId: 'bld-salsa-v2',
        commitSha: 'c8f492b',
        releaseVersion: '2.0.0',
        releaseChannel: 'stable'
      };
      global.__SALSA_RUNTIME_CONFIG__ = Object.freeze(config);
      return config;
    }

    _setHeaderSessionStatus(verified, principal = null, badgeLabel = null) {
      const badge = document.getElementById('header-env-badge');
      const email = String(principal?.email || '').trim().toLowerCase();
      const isDevFixture = email === 'dev_owner@neem.internal';
      if (badge) {
        badge.className = `badge ${verified ? 'badge-info' : 'badge-warning'} header-env-badge`;
        const label = badgeLabel || (verified && isDevFixture && this._runtimeConfig?.devSessionEnabled === true
          ? 'نشست توسعهٔ محلی تأیید شد'
          : (verified ? 'نشست مدیر پلتفرم تأیید شد' : 'اتصال کنترل‌پلین تأییدنشده'));
        badge.innerHTML = `<span class="status-dot ${verified ? 'dot-blue' : 'dot-amber'}" aria-hidden="true"></span>${label}`;
      }

      const chip = document.getElementById('header-user-chip');
      if (!chip) return;
      const name = verified
        ? String(principal?.displayName || principal?.fullName || principal?.full_name || principal?.name || principal?.email || 'مدیر پلتفرم')
        : 'ورود انجام نشده';
      const roleLabels = {
        platform_owner: 'مالک پلتفرم',
        platform_operations: 'عملیات پلتفرم',
        platform_security: 'امنیت پلتفرم',
        platform_billing: 'مالی پلتفرم',
        platform_support: 'پشتیبانی پلتفرم'
      };
      const role = roleLabels[principal?.role] || (verified ? 'نشست احرازشده' : 'احراز هویت لازم است');
      const subtitle = verified
        ? [role, email || null, isDevFixture ? 'نشست توسعه' : null].filter(Boolean).join(' · ')
        : role;
      const nameNode = chip.querySelector('.header-user-name');
      const subtitleNode = chip.querySelector('.user-subtitle');
      const avatarNode = chip.querySelector('.header-user-avatar');
      if (nameNode) nameNode.textContent = name;
      if (subtitleNode) subtitleNode.textContent = subtitle;
      if (avatarNode) avatarNode.textContent = verified ? (name.trim().charAt(0) || 'م') : '—';
      chip.title = verified ? (isDevFixture ? 'نشست توسعهٔ محلی؛ برای تولید معتبر نیست' : 'نشست احرازشدهٔ مدیر پلتفرم') : 'ورود به امنیت حساب مدیر';
      chip.setAttribute('aria-label', verified ? `${name}، ${subtitle}` : 'ورود انجام نشده؛ احراز هویت لازم است');
      chip.onclick = verified ? null : () => { global.location.hash = '#login'; };
    }

    _ensureBarrier() {
      let barrier = document.getElementById('salsa-auth-barrier');
      if (!barrier) {
        barrier = document.createElement('div');
        barrier.id = 'salsa-auth-barrier';
        document.body.appendChild(barrier);
      }
      return barrier;
    }

    _renderAuthShell(cardHtml) {
      const barrier = this._ensureBarrier();
      barrier.innerHTML = `
        <main class="auth-wrap" id="salsa-auth-main" tabindex="-1">
          <div class="auth-card">
            ${cardHtml}
          </div>
        </main>
      `;
    }

    _authLogoMarkup() {
      return '<img class="auth-logo" src="assets/images/salsa-logo.jpg" alt="SALSA" width="768" height="431" />';
    }

    _renderLoadingBarrier(message) {
      this._renderAuthShell(`
        ${this._authLogoMarkup()}
        <h2 class="auth-title">مرکز کنترل سالسا</h2>
        <p class="auth-sub">${message}</p>
        <div class="salsa-auth-spinner" role="status" aria-label="در حال بارگذاری"></div>
      `);
    }

    _clearBarrier() {
      const barrier = document.getElementById('salsa-auth-barrier');
      if (barrier) {
        barrier.remove();
      }
    }

    _renderLoginSurface() {
      const runtime = this._loadRuntimeConfig();
      const devSessionMarkup = runtime.devSessionEnabled === true
        ? `
            <div id="dev-quick-login-container" class="auth-foot">
              <button type="button" class="btn btn-ghost" onclick="window.GodModeBootstrap.handleDevLogin()">
                ورود سریع توسعه (Dev-Session)
              </button>
            </div>
          `
        : '';

      this._renderAuthShell(`
        ${this._authLogoMarkup()}
        <h2 class="auth-title" id="salsa-auth-heading">ورود</h2>
        <p class="auth-sub">
          ورود به مرکز مدیریت پلتفرم سالسا
          <span class="auth-sub-note">احراز هویت دومرحله‌ای سازمانی (RFC 6238 MFA)</span>
        </p>

        <form id="salsa-bootstrap-login-form" onsubmit="window.GodModeBootstrap.handleLogin(event)">
          <div class="field">
            <label for="login-username">شناسه یا ایمیل راهبر</label>
            <input type="text" id="login-username" dir="ltr" required autocomplete="username" placeholder="admin@salsa.ir">
          </div>

          <div class="field">
            <label for="login-password">گذرواژه سازمانی</label>
            <input type="password" id="login-password" required autocomplete="current-password" placeholder="••••••••••••">
          </div>

          <p id="login-error-box" class="msg error hidden" role="alert" aria-live="polite"></p>

          <button type="submit" id="btn-login-submit" class="btn">بررسی هویت و ورود</button>

          ${devSessionMarkup}
        </form>
      `);
    }

    async handleLogin(e) {
      if (e) e.preventDefault();
      const userEl = document.getElementById('login-username');
      const passEl = document.getElementById('login-password');
      const errBox = document.getElementById('login-error-box');
      const submitBtn = document.getElementById('btn-login-submit');

      if (!userEl || !passEl) return;
      if (errBox) {
        errBox.textContent = '';
        errBox.classList.add('hidden');
      }
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'در حال اعتبارسنجی…';
      }

      try {
        const res = await this._client.post('/api/control/auth/login', {
          email: userEl.value.trim(),
          password: passEl.value
        });

        if (res.ok) {
          if (res.data?.mfaRequired) {
            this._state = BootstrapState.MFA_REQUIRED;
            this._renderMfaChallenge(res.data.challengeTicket);
            return;
          }
          await this.init();
        } else {
          throw new Error(res.error?.message || 'نام کاربری یا گذرواژه نامعتبر است.');
        }
      } catch (err) {
        if (errBox) {
          errBox.textContent = err.message || 'خطا در احراز هویت.';
          errBox.classList.remove('hidden');
        }
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = 'بررسی هویت و ورود';
        }
      }
    }

    async handleDevLogin() {
      const errBox = document.getElementById('login-error-box');
      if (this._loadRuntimeConfig().devSessionEnabled !== true) {
        if (errBox) {
          errBox.textContent = 'ورود توسعه برای این محیط فعال نیست.';
          errBox.classList.remove('hidden');
        }
        return;
      }
      try {
        const res = await this._client.post('/api/control/auth/dev-session', {
          role: 'platform_owner',
          email: 'admin@salsa.ir',
          name: 'مدیر ارشد پلتفرم سالسا'
        });
        if (res.ok) {
          await this.init();
        } else {
          throw new Error(res.error?.message || 'نشست توسعه توسط سرور غیرفعال شده است.');
        }
      } catch (err) {
        if (errBox) {
          errBox.textContent = err?.name === 'TypeError' && /fetch/i.test(String(err.message || ''))
            ? 'سرویس Control Plane در دسترس نیست. ابتدا backend محلی SALSA را روی پورت 3061 اجرا کنید.'
            : (err.message || 'نشست توسعه توسط سرور غیرفعال شده است.');
          errBox.classList.remove('hidden');
        }
      }
    }

    _renderMfaChallenge(challengeTicket) {
      const ticket = String(challengeTicket || '').replace(/'/g, "\\'");
      this._renderAuthShell(`
        ${this._authLogoMarkup()}
        <h2 class="auth-title">تأیید هویت دومرحله‌ای</h2>
        <p class="auth-sub">کد ۶ رقمی نرم‌افزار Authenticator خود را وارد کنید.</p>

        <form onsubmit="window.GodModeBootstrap.handleMfaSubmit(event, '${ticket}')">
          <div class="field field-mfa">
            <label class="visually-hidden" for="mfa-token-input">کد MFA</label>
            <input type="text" id="mfa-token-input" dir="ltr" required maxlength="6" pattern="[0-9]{6}" inputmode="numeric" autocomplete="one-time-code" placeholder="••••••" aria-label="کد ۶ رقمی MFA">
          </div>

          <p id="mfa-error-box" class="msg error hidden" role="alert" aria-live="polite"></p>

          <button type="submit" class="btn">تأیید و ورود به پلتفرم</button>
        </form>
      `);
    }

    async handleMfaSubmit(e, ticket) {
      if (e) e.preventDefault();
      const tokenInput = document.getElementById('mfa-token-input');
      const errBox = document.getElementById('mfa-error-box');
      if (!tokenInput) return;

      try {
        const res = await this._client.post('/api/control/auth/mfa/verify', {
          totpCode: tokenInput.value.trim(),
          mfaToken: ticket
        });
        if (res.ok) {
          await this.init();
        } else {
          throw new Error(res.error?.message || 'کد اعتبارسنجی وارد شده صحیح نمی‌باشد.');
        }
      } catch (err) {
        if (errBox) {
          errBox.textContent = err.message;
          errBox.classList.remove('hidden');
        }
      }
    }

    _renderAccessDenied(message) {
      this._renderLoadingBarrier(`خطای عدم دسترسی: ${message || 'حساب کاربری شما اجازه ورود به پلتفرم را ندارد.'}`);
    }

    _renderBootstrapFailed(err) {
      const detail = String(err?.message || 'Network connection refused')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      this._renderAuthShell(`
        ${this._authLogoMarkup()}
        <div class="salsa-auth-status-icon" aria-hidden="true">⚠️</div>
        <h2 class="auth-title">عدم دسترسی به Control Plane</h2>
        <p class="auth-sub">ارتباط مرورگر با سرور متمرکز سالسا (پورت 3061) برقرار نشد.</p>
        <p class="msg error mono">${detail}</p>
        <button type="button" class="btn" onclick="location.reload()">تلاش مجدد اتصال</button>
      `);
    }
  }

  const GodModeBootstrapInstance = new GodModeBootstrap();
  global.GodModeBootstrap = GodModeBootstrapInstance;
  global.BootstrapState = BootstrapState;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = GodModeBootstrapInstance;
    module.exports.BootstrapState = BootstrapState;
  }
})(typeof window !== 'undefined' ? window : globalThis);
