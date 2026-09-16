/**
 * prototype/js/views/gm01-login.js
 * 
 * GM-01: مرکز امنیت، نشست‌ها و مدیریت حساب راهبر ارشد پلتفرم
 * مدیریت احراز هویت دو مرحله‌ای (TOTP)، کدهای اضطراری، نشست‌های برخط VPS،
 * کلیدهای دسترسی API (PAT)، تغییر گذرواژه ریشه و فایروال کنترل‌پنل.
 */

// In-memory persistent state for Master Admin Security operations
window.GM01State = window.GM01State || {
  activeTab: 'overview',
  admin: {
    name: 'مهندس ارشد زیرساخت و امنیت',
    username: 'superadmin@neem.ir',
    role: 'دسترسی تام ریشه پلتفرم (Root SuperAdmin)',
    mobile: '۰۹۱۲۰۰۰۰۰۹۹',
    registeredAt: '۱۴۰۲/۰۱/۱۵',
    lastPasswordChange: '۱۴۰۳/۰۵/۱۰ (۳ هفته پیش)',
    mfaEnabled: true,
    mfaSecret: 'NEEM-SEC-77A9-K82F-M401',
    securityScore: 100
  },
  sessions: [
    {
      id: 'ses_current',
      device: 'macOS Sonoma 14.5 · Google Chrome 128',
      ip: '185.143.232.10',
      location: 'ایران، تهران (دیتاسنتر برج میلاد آسیاتک)',
      startedAt: 'هم‌اکنون',
      isCurrent: true,
      status: 'active'
    },
    {
      id: 'ses_ipad_992',
      device: 'iPadOS 17.5 · Safari Mobile',
      ip: '2.188.42.91',
      location: 'ایران، مشهد (شاتل)',
      startedAt: '۲ ساعت پیش',
      isCurrent: false,
      status: 'active'
    },
    {
      id: 'ses_ubuntu_cli',
      device: 'Ubuntu Linux 24.04 (CLI Terminal & SSH)',
      ip: '185.143.232.11',
      location: 'سرور متمرکز VPS (vps.neem.ir)',
      startedAt: 'دیروز ۱۶:۲۰',
      isCurrent: false,
      status: 'active'
    }
  ],
  tokens: [
    {
      id: 'tok_vps_backup',
      name: 'neem_pat_vps_backup_cron',
      scope: 'پشتیبان‌گیری دیتابیس و فایل‌های سیستم',
      createdAt: '۱۴۰۳/۰۵/۰۱',
      lastUsed: 'امروز ۰۴:۰۰ بامداد',
      expiresAt: 'بدون انقضا',
      status: 'active'
    },
    {
      id: 'tok_deploy_cicd',
      name: 'neem_pat_deploy_github_action',
      scope: 'استقرار کانتینرها و ریلیز نسخه‌ها (CI/CD)',
      createdAt: '۱۴۰۳/۰۵/۱۵',
      lastUsed: '۳ روز پیش',
      expiresAt: '۱۴۰۳/۰۸/۱۵ (۶۰ روز مانده)',
      status: 'active'
    }
  ],
  backupCodes: [
    '8912-4029', '7731-9014', '3124-8890', '6543-1289',
    '9081-5542', '1249-7731', '4491-0021', '5523-8819',
    '2910-3341', '7612-4490'
  ],
  policies: {
    bruteForceLimit: '5',
    lockoutMinutes: '30',
    inactivityTimeout: '30',
    ipAllowlistEnabled: false,
    ipAllowlist: '185.143.232.0/24',
    smsLoginAlerts: true
  },
  auditLog: [
    { time: 'امروز ۱۰:۲۴', action: 'ورود موفق با احراز دومرحله‌ای (TOTP)', ip: '185.143.232.10', status: 'success' },
    { time: 'امروز ۰۹:۱۵', action: 'استفاده از کلید API پشتیبان‌گیری', ip: '185.143.232.11', status: 'success' },
    { time: 'دیروز ۱۸:۳۰', action: 'ورود موفق از iPadOS (مشهد)', ip: '2.188.42.91', status: 'success' },
    { time: '۳ روز پیش', action: 'بررسی سلامت گواهی امنیتی On-Demand TLS', ip: '185.143.232.10', status: 'success' }
  ]
};

// Global Tab switcher
window.switchGM01Tab = function(tabName) {
  window.GM01State.activeTab = tabName;
  const hash = window.location && window.location.hash ? window.location.hash : '#gm-01-login';
  const [baseRoute, queryString] = hash.split('?');
  const params = new URLSearchParams(queryString || '');
  params.set('tab', tabName);
  const nextHash = `#${baseRoute.replace(/^#\/?/, '')}?${params.toString()}`;
  const compactHash = window.GMRouter && typeof window.GMRouter.compactHash === 'function'
    ? window.GMRouter.compactHash(nextHash)
    : nextHash;

  if (window.history && typeof window.history.replaceState === 'function') {
    window.history.replaceState(null, '', compactHash);
  }

  document.querySelectorAll('.gm01-tab-btn').forEach(btn => {
    const isTarget = btn.getAttribute('data-tab') === tabName;
    btn.classList.toggle('active', isTarget);
    if (isTarget) {
      btn.setAttribute('aria-current', 'page');
    } else {
      btn.removeAttribute('aria-current');
    }
  });

  document.querySelectorAll('.gm01-panel').forEach(panel => {
    const isTarget = panel.getAttribute('data-panel') === tabName;
    panel.style.display = isTarget ? 'block' : 'none';
  });
};

// Revoke single session
window.revokeSingleSession = function(sessionId) {
  const session = window.GM01State.sessions.find(s => s.id === sessionId);
  if (!session) return;
  if (session.isCurrent) {
    if (window.GMApp && window.GMApp.showToast) {
      window.GMApp.showToast('نشست جاری سیستم قابل ابطال مستقیم از داخل پنل نیست؛ جهت خروج از گزینه خروج از حساب استفاده کنید.', 'warning');
    }
    return;
  }

  window.GM01State.sessions = window.GM01State.sessions.filter(s => s.id !== sessionId);
  const store = window.prototypeStore || window.GMStore;
  if (store && store.addActivity) {
    store.addActivity({
      type: 'session_revoked',
      severity: 'warning',
      title: `قطع نشست راه دور (${session.device})`,
      description: `نشست با آدرس IP: ${session.ip} توسط مدیر ارشد با موفقیت ابطال شد.`,
      subsystem: 'Security',
      route: '#gm-01-login?tab=sessions',
      actor: 'SuperAdmin'
    });
  }

  if (window.GMApp && window.GMApp.showToast) {
    window.GMApp.showToast(`نشست دسترسی «${session.device}» با موفقیت باطل شد و اتصال آن قطع گردید.`, 'success');
  }

  // Refresh view
  if (window.GMRouter && typeof window.GMRouter.refresh === 'function') {
    window.GMRouter.refresh();
  }
};

// Confirm and revoke all other sessions
window.confirmRevokeOtherSessions = function() {
  const otherCount = window.GM01State.sessions.filter(s => !s.isCurrent).length;
  if (otherCount === 0) {
    if (window.GMApp && window.GMApp.showToast) {
      window.GMApp.showToast('در حال حاضر هیچ نشست فعال دیگری به جز نشست جاری شما وجود ندارد.', 'info');
    }
    return;
  }

  const content = `
    <div style="display: flex; flex-direction: column; gap: 0.85rem;">
      <p style="font-size: 0.813rem; color: var(--text-primary); line-height: 1.5;">
        آیا از ابطال تمامی <strong>${otherCount} نشست فعال دیگر</strong> روی سایر دستگاه‌ها، تبلت‌ها و سرورها اطمینان دارید؟
      </p>
      <div class="alert alert-danger" style="font-size: 0.775rem;">
        <strong>اثر اقدام امنیتی:</strong> کلیه توکن‌های دسترسی، نشست‌های مرورگر و کوکی‌های احراز هویت روی سایر دستگاه‌ها فوراً باطل خواهند شد. نشست جاری شما فعال باقی می‌ماند.
      </div>
    </div>
  `;

  const doRevoke = () => {
    window.GM01State.sessions = window.GM01State.sessions.filter(s => s.isCurrent);
    const store = window.prototypeStore || window.GMStore;
    if (store && store.addActivity) {
      store.addActivity({
        type: 'all_sessions_revoked',
        severity: 'danger',
        title: 'ابطال سراسری کلیه نشست‌های دیگر',
        description: `تعداد ${otherCount} نشست دیگر راه دور روی سرور مرکزی VPS ابطال گردید.`,
        subsystem: 'Security',
        route: '#gm-01-login?tab=sessions',
        actor: 'SuperAdmin'
      });
    }
    if (window.GMApp && window.GMApp.showToast) {
      window.GMApp.showToast('تمامی نشست‌های فعال دیگر با موفقیت ابطال شده و توکن‌های مربوطه منقضی گردیدند.', 'success');
    }
    if (window.GMRouter && typeof window.GMRouter.refresh === 'function') {
      window.GMRouter.refresh();
    }
  };

  if (window.GMApp && window.GMApp.openModal) {
    window.GMApp.openModal('تأیید ابطال سراسری نشست‌ها', content, doRevoke, {
      confirmText: 'ابطال تمام نشست‌های دیگر',
      confirmVariant: 'danger',
      severity: 'danger',
      severityLabel: 'اقدام امنیتی'
    });
  } else {
    doRevoke();
  }
};

// Test MFA code verification
window.testMfaCode = function() {
  const input = document.getElementById('gm01-mfa-test-input');
  const val = input ? input.value.trim() : '';
  if (!val || val.length < 6) {
    if (window.GMApp && window.GMApp.showToast) {
      window.GMApp.showToast('لطفاً کد ۶ رقمی تولیدشده توسط نرم‌افزار Authenticator را وارد نمایید.', 'warning');
    }
    return;
  }

  if (window.GMApp && window.GMApp.showToast) {
    window.GMApp.showToast(`کد تایید ${val} با کلید TOTP سرور متمرکز تطبیق داده شد و معتبر است.`, 'success');
  }
  if (input) input.value = '';
};

// Copy MFA Secret
window.copyMfaSecret = function() {
  const secret = window.GM01State.admin.mfaSecret;
  if (navigator && navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(secret);
  }
  if (window.GMApp && window.GMApp.showToast) {
    window.GMApp.showToast('کلید اختصاصی TOTP در کلیپ‌بورد کپی شد.', 'success');
  }
};

// Copy Backup codes
window.copyBackupCodes = function() {
  const codes = window.GM01State.backupCodes.join('\n');
  if (navigator && navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(codes);
  }
  if (window.GMApp && window.GMApp.showToast) {
    window.GMApp.showToast('۱۰ کد بازیابی اضطراری در کلیپ‌بورد کپی شدند. آنها را در محل امن نگهداری کنید.', 'success');
  }
};

// Regenerate Backup codes
window.regenerateBackupCodes = function() {
  const newCodes = [];
  for (let i = 0; i < 10; i++) {
    const part1 = Math.floor(1000 + Math.random() * 9000);
    const part2 = Math.floor(1000 + Math.random() * 9000);
    newCodes.push(`${part1}-${part2}`);
  }
  window.GM01State.backupCodes = newCodes;
  if (window.GMApp && window.GMApp.showToast) {
    window.GMApp.showToast('کدهای اضطراری جدید تولید شدند. کدهای قبلی باطل گردیدند.', 'success');
  }
  if (window.GMRouter && typeof window.GMRouter.refresh === 'function') {
    window.GMRouter.refresh();
  }
};

// Master password update
window.saveMasterPassword = function() {
  const curPass = document.getElementById('gm01-current-password')?.value;
  const newPass = document.getElementById('gm01-new-password')?.value;
  const confPass = document.getElementById('gm01-confirm-password')?.value;
  const revokeOthers = document.getElementById('gm01-revoke-on-change')?.checked;

  if (!curPass) {
    if (window.GMApp && window.GMApp.showToast) {
      window.GMApp.showToast('لطفاً گذرواژه فعلی حساب را وارد نمایید.', 'warning');
    }
    return;
  }
  if (!newPass || newPass.length < 8) {
    if (window.GMApp && window.GMApp.showToast) {
      window.GMApp.showToast('گذرواژه جدید باید حداقل ۸ نویسه شامل ترکیب حروف، ارقام و علائم باشد.', 'warning');
    }
    return;
  }
  if (newPass !== confPass) {
    if (window.GMApp && window.GMApp.showToast) {
      window.GMApp.showToast('تکرار گذرواژه جدید با گذرواژه همخوانی ندارد.', 'error');
    }
    return;
  }

  if (revokeOthers) {
    window.GM01State.sessions = window.GM01State.sessions.filter(s => s.isCurrent);
  }

  window.GM01State.admin.lastPasswordChange = 'هم‌اکنون';
  const store = window.prototypeStore || window.GMStore;
  if (store && store.addActivity) {
    store.addActivity({
      type: 'password_changed',
      severity: 'warning',
      title: 'تغییر کلمه عبور مدیر ارشد پلتفرم',
      description: 'گذرواژه ریشه حساب مدیر ارشد با موفقیت بروزرسانی شد و توکن‌های دیگر باطل گردیدند.',
      subsystem: 'Security',
      route: '#gm-01-login?tab=password',
      actor: 'SuperAdmin'
    });
  }

  if (window.GMApp && window.GMApp.showToast) {
    window.GMApp.showToast('گذرواژه مدیر ارشد با موفقیت تغییر یافت و امنیت حساب تثبیت شد.', 'success');
  }

  document.getElementById('gm01-current-password').value = '';
  document.getElementById('gm01-new-password').value = '';
  document.getElementById('gm01-confirm-password').value = '';
};

// Create new API access token (PAT)
window.openCreateTokenModal = function() {
  const content = `
    <div style="display: flex; flex-direction: column; gap: 1rem;">
      <div class="form-group">
        <label class="form-label" for="new-token-name">نام و شرح کاربرد توکن</label>
        <input type="text" id="new-token-name" class="form-control" placeholder="مثال: neem_pat_grafana_monitoring" />
      </div>
      <div class="form-group">
        <label class="form-label" for="new-token-scope">محدوده دسترسی (Scope)</label>
        <select id="new-token-scope" class="form-control">
          <option value="دسترسی کامل ریشه (Full Admin)">دسترسی کامل ریشه (Full Admin)</option>
          <option value="فقط خواندنی و پایش (Read-Only Metrics)">فقط خواندنی و پایش (Read-Only Metrics)</option>
          <option value="زیرساخت و پشتیبان‌گیری (Infra & Backup)">زیرساخت و پشتیبان‌گیری (Infra & Backup)</option>
          <option value="استقرار نسخه‌ها و CI/CD">استقرار نسخه‌ها و CI/CD</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label" for="new-token-expiry">مدت اعتبار توکن</label>
        <select id="new-token-expiry" class="form-control">
          <option value="۳۰ روزه">۳۰ روزه</option>
          <option value="۹۰ روزه" selected>۹۰ روزه</option>
          <option value="۱ ساله">۱ ساله</option>
          <option value="بدون انقضا">بدون انقضا (دائمی)</option>
        </select>
      </div>
    </div>
  `;

  const onConfirm = () => {
    const nameInput = document.getElementById('new-token-name');
    const scopeInput = document.getElementById('new-token-scope');
    const expInput = document.getElementById('new-token-expiry');

    const name = (nameInput ? nameInput.value.trim() : '') || 'neem_pat_custom_key';
    const scope = scopeInput ? scopeInput.value : 'دسترسی عمومی';
    const expiresAt = expInput ? expInput.value : '۹۰ روزه';

    const rawToken = 'neem_pat_' + Math.random().toString(36).substring(2, 10) + Math.random().toString(36).substring(2, 10);
    window.GM01State.tokens.push({
      id: 'tok_' + Math.floor(1000 + Math.random() * 9000),
      name: name,
      scope: scope,
      createdAt: 'هم‌اکنون',
      lastUsed: 'استفاده نشده',
      expiresAt: expiresAt,
      status: 'active'
    });

    if (navigator && navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(rawToken);
    }

    if (window.GMApp && window.GMApp.showToast) {
      window.GMApp.showToast(`کلید جدید «${name}» صادر و در کلیپ‌بورد کپی شد: ${rawToken}`, 'success');
    }
    if (window.GMRouter && typeof window.GMRouter.refresh === 'function') {
      window.GMRouter.refresh();
    }
  };

  if (window.GMApp && window.GMApp.openModal) {
    window.GMApp.openModal('صدور کلید امنیتی جدید API (Personal Access Token)', content, onConfirm, {
      confirmText: 'صدور و کپی کلید',
      confirmVariant: 'primary'
    });
  }
};

// Revoke API access token
window.revokeApiToken = function(tokenId) {
  const tok = window.GM01State.tokens.find(t => t.id === tokenId);
  if (!tok) return;

  window.GM01State.tokens = window.GM01State.tokens.filter(t => t.id !== tokenId);
  if (window.GMApp && window.GMApp.showToast) {
    window.GMApp.showToast(`کلید دسترسی «${tok.name}» با موفقیت باطل گردید.`, 'success');
  }
  if (window.GMRouter && typeof window.GMRouter.refresh === 'function') {
    window.GMRouter.refresh();
  }
};

// Save Security Policies
window.saveSecurityPolicies = function() {
  const brute = document.getElementById('gm01-policy-brute')?.value;
  const lockout = document.getElementById('gm01-policy-lockout')?.value;
  const timeout = document.getElementById('gm01-policy-timeout')?.value;
  const ipEnabled = document.getElementById('gm01-policy-ip-switch')?.checked;
  const ips = document.getElementById('gm01-policy-ip-list')?.value;

  window.GM01State.policies = {
    bruteForceLimit: brute || '5',
    lockoutMinutes: lockout || '30',
    inactivityTimeout: timeout || '30',
    ipAllowlistEnabled: Boolean(ipEnabled),
    ipAllowlist: ips || '185.143.232.0/24',
    smsLoginAlerts: true
  };

  if (window.GMApp && window.GMApp.showToast) {
    window.GMApp.showToast('سیاست‌های امنیتی و فایروال کنترل‌پنل بر روی سرور VPS با موفقیت ذخیره شدند.', 'success');
  }
};

// Test SMS Alert
window.testSmsAlert = function() {
  if (window.GMApp && window.GMApp.showToast) {
    window.GMApp.showToast(`پیامک هشدار تست امنیتی با موفقیت به شماره ${window.GM01State.admin.mobile} ارسال گردید.`, 'success');
  }
};

// Main GM-01 Render Function
window.renderGM01 = function(params) {
  const activeTab = (params && params.tab) || window.GM01State.activeTab || 'overview';
  const state = window.GM01State;
  const activeSessionsCount = state.sessions.length;

  return `
    <div class="page-header gm01-page">
      <div class="page-title-group">
        <nav class="breadcrumb-nav" aria-label="مسیر راهبری">
          <a href="#gm-02-overview" class="breadcrumb-link">پیشخوان</a>
          <span class="breadcrumb-separator">/</span>
          <span class="breadcrumb-current" aria-current="page">امنیت حساب و نشست‌ها</span>
        </nav>
        <h1>
          مرکز امنیت، مدیریت نشست‌ها و حساب مدیر ارشد
          <span class="badge badge-scope-global"><span class="status-dot dot-purple"></span> کلان پلتفرم</span>
          <span class="page-code-badge">GM-01</span>
        </h1>
        <p>پیکربندی جامع اعتبارنامه ریشه، احراز هویت دومرحله‌ای (TOTP)، مدیریت نشست‌های برخط سرور VPS، کلیدهای دسترسی API و فایروال کنترل‌پنل</p>
      </div>
      <div class="header-actions">
        <button type="button" class="btn btn-secondary btn-sm" onclick="window.testSmsAlert()">
          📱 پیامک هشدار امنیتی
        </button>
        <button type="button" class="btn btn-primary btn-sm" onclick="window.confirmRevokeOtherSessions()">
          🛡️ ابطال تمام نشست‌های دیگر
        </button>
      </div>
    </div>

    <!-- Security Posture Summary Strip -->
    <div class="data-quality-strip" role="status" aria-label="خلاصه شاخص‌های امنیت پلتفرم">
      <div class="data-quality-label"><span class="dq-badge-dot dot-emerald"></span><span>وضعیت امنیت</span></div>
      <div class="data-quality-grid">
        <span class="dq-badge"><span class="dq-badge-dot dot-emerald"></span><span class="dq-dim-name">امتیاز ایمنی</span><span class="dq-dim-val">${state.admin.securityScore}٪ (A+)</span></span>
        <span class="dq-badge"><span class="dq-badge-dot dot-emerald"></span><span class="dq-dim-name">MFA</span><span class="dq-dim-val">فعال و الزامی</span></span>
        <span class="dq-badge"><span class="dq-badge-dot dot-blue"></span><span class="dq-dim-name">نشست‌های برخط</span><span class="dq-dim-val">${activeSessionsCount.toLocaleString('fa-IR')} نشست</span></span>
        <span class="dq-badge"><span class="dq-badge-dot dot-purple"></span><span class="dq-dim-name">کلیدهای API</span><span class="dq-dim-val">${state.tokens.length.toLocaleString('fa-IR')} کلید فعال</span></span>
        <span class="dq-badge"><span class="dq-badge-dot dot-cyan"></span><span class="dq-dim-name">فایروال Brute-force</span><span class="dq-dim-val">${state.policies.bruteForceLimit} خطا / ${state.policies.lockoutMinutes}m قفل</span></span>
      </div>
      <span class="dq-action-hint"><span>تمام اقدامات ممهور به امضای دیجیتال و ثبت در لاگ ممیزی (GM-26) می‌گردند.</span></span>
    </div>

    <!-- Navigation Tabs -->
    <div class="tab-nav-wrapper" style="margin-bottom: 1.25rem;">
      <div class="tab-nav" role="tablist" aria-label="تب‌های مدیریت امنیت حساب">
        <button type="button" class="tab-link gm01-tab-btn ${activeTab === 'overview' ? 'active' : ''}" data-tab="overview" onclick="window.switchGM01Tab('overview')">
          👤 خلاصه حساب و پروفایل
        </button>
        <button type="button" class="tab-link gm01-tab-btn ${activeTab === 'sessions' ? 'active' : ''}" data-tab="sessions" onclick="window.switchGM01Tab('sessions')">
          💻 نشست‌ها و دستگاه‌ها (${activeSessionsCount.toLocaleString('fa-IR')})
        </button>
        <button type="button" class="tab-link gm01-tab-btn ${activeTab === 'mfa' ? 'active' : ''}" data-tab="mfa" onclick="window.switchGM01Tab('mfa')">
          🔑 احراز هویت دو مرحله‌ای (TOTP)
        </button>
        <button type="button" class="tab-link gm01-tab-btn ${activeTab === 'password' ? 'active' : ''}" data-tab="password" onclick="window.switchGM01Tab('password')">
          🔒 تغییر گذرواژه
        </button>
        <button type="button" class="tab-link gm01-tab-btn ${activeTab === 'api-keys' ? 'active' : ''}" data-tab="api-keys" onclick="window.switchGM01Tab('api-keys')">
          ⚡ کلیدهای دسترسی API (${state.tokens.length.toLocaleString('fa-IR')})
        </button>
        <button type="button" class="tab-link gm01-tab-btn ${activeTab === 'policy' ? 'active' : ''}" data-tab="policy" onclick="window.switchGM01Tab('policy')">
          🛡️ فایروال و سیاست‌های امنیتی
        </button>
      </div>
    </div>

    <!-- TAB 1: Overview & Profile Panel -->
    <div class="gm01-panel" data-panel="overview" style="display: ${activeTab === 'overview' ? 'block' : 'none'};">
      <div class="grid-cols-2" style="gap: 1.25rem;">
        <!-- Identity Card -->
        <div class="card">
          <div class="card-header">
            <div class="card-title-group">
              <h3 class="card-title">شناسنامه و اعتبارنامه مدیر ارشد پلتفرم</h3>
              <p class="card-subtitle">حساب اصلی متصل به کلید دسترسی ریشه (Root SuperAdmin)</p>
            </div>
            <span class="badge badge-purple">سطح دسترسی تام ریشه</span>
          </div>
          <div class="card-body">
            <div class="kv-list">
              <div class="kv-item">
                <span class="kv-label">نام و عنوان سازمانی:</span>
                <span class="text-primary font-bold">${state.admin.name}</span>
              </div>
              <div class="kv-item">
                <span class="kv-label">ایمیل / شناسه ورود:</span>
                <span class="cell-mono text-cyan font-bold">${state.admin.username}</span>
              </div>
              <div class="kv-item">
                <span class="kv-label">تلفن همراه اضطراری امنیتی:</span>
                <span class="cell-mono text-primary">${state.admin.mobile}</span>
              </div>
              <div class="kv-item">
                <span class="kv-label">سطح نقش امنیتی:</span>
                <span class="badge badge-success">Platform SuperAdmin (همه ماژول‌ها)</span>
              </div>
              <div class="kv-item">
                <span class="kv-label">تاریخ ایجاد حساب در سرور:</span>
                <span class="cell-mono text-secondary">${state.admin.registeredAt}</span>
              </div>
              <div class="kv-item">
                <span class="kv-label">آخرین زمان تغییر کلمه عبور:</span>
                <span class="text-secondary">${state.admin.lastPasswordChange}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Security Readiness Checklist Card -->
        <div class="card">
          <div class="card-header">
            <div class="card-title-group">
              <h3 class="card-title">چک‌لیست ایمنی و آمادگی حساب</h3>
              <p class="card-subtitle">انطباق حساب کاربری با الزامات امنیتی استاندارد OWASP و پلتفرم</p>
            </div>
            <span class="badge badge-success"><span class="status-dot dot-active"></span> ۱۰۰٪ تکمیل</span>
          </div>
          <div class="card-body">
            <ul style="list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.75rem; font-size: 0.813rem;">
              <li style="display: flex; justify-content: space-between; align-items: center;">
                <span style="display: flex; align-items: center; gap: 0.5rem;">
                  <span class="badge-dot dot-success"></span>
                  <span>احراز هویت دو مرحله‌ای سخت‌گیرانه (MFA / TOTP)</span>
                </span>
                <span class="badge badge-success">فعال</span>
              </li>
              <li style="display: flex; justify-content: space-between; align-items: center;">
                <span style="display: flex; align-items: center; gap: 0.5rem;">
                  <span class="badge-dot dot-success"></span>
                  <span>کدهای اضطراری آفلاین (۱۰ کد بازیابی صادرشده)</span>
                </span>
                <span class="badge badge-success">صادرشده</span>
              </li>
              <li style="display: flex; justify-content: space-between; align-items: center;">
                <span style="display: flex; align-items: center; gap: 0.5rem;">
                  <span class="badge-dot dot-success"></span>
                  <span>پیچیدگی گذرواژه (حداقل ۱۰ نویسه مرکب)</span>
                </span>
                <span class="badge badge-success">قدرت عالی (۹۴ بیت)</span>
              </li>
              <li style="display: flex; justify-content: space-between; align-items: center;">
                <span style="display: flex; align-items: center; gap: 0.5rem;">
                  <span class="badge-dot dot-success"></span>
                  <span>محافظت در برابر حملات Brute-Force و حد مجاز خطا</span>
                </span>
                <span class="badge badge-success">۵ خطا / ۳۰ دقیقه قفل</span>
              </li>
              <li style="display: flex; justify-content: space-between; align-items: center;">
                <span style="display: flex; align-items: center; gap: 0.5rem;">
                  <span class="badge-dot dot-success"></span>
                  <span>انقضای خودکار نشست‌های بدون فعالیت (Inactivity Timeout)</span>
                </span>
                <span class="badge badge-success">۳۰ دقیقه</span>
              </li>
            </ul>

            <div class="surface-subtle" style="margin-top: 1rem; padding: 0.75rem; border-radius: 6px; font-size: 0.75rem; color: var(--text-secondary); line-height: 1.5;">
              💡 <strong>نکته امنیتی پلتفرم:</strong> هرگونه رخداد تغییر گذرواژه، صدور توکن API یا ورود از شبکه جدید بلافاصله از طریق پیامک به شماره مستقیم مدیر ارسال می‌گردد.
            </div>
          </div>
        </div>
      </div>

      <!-- Recent Security Events Table -->
      <div class="table-wrapper" style="margin-top: 1.25rem;">
        <div class="table-toolbar">
          <div class="table-search-group">
            <span class="filter-count-badge">آخرین رویدادهای امنیتی حساب مدیر</span>
          </div>
          <a href="#gm-26-audit" class="btn btn-secondary btn-sm">مشاهده ردپای کامل ممیزی (GM-26) ←</a>
        </div>
        <div class="table-responsive">
          <table class="data-table">
            <thead>
              <tr>
                <th>زمان رویداد</th>
                <th>نوع رویداد امنیتی</th>
                <th>آدرس شبکه (IP)</th>
                <th>وضعیت</th>
              </tr>
            </thead>
            <tbody>
              ${state.auditLog.map(log => `
                <tr>
                  <td class="cell-mono text-secondary" style="font-size: 0.775rem;">${log.time}</td>
                  <td><strong class="text-primary">${log.action}</strong></td>
                  <td class="cell-mono" style="font-size: 0.775rem;">${log.ip}</td>
                  <td><span class="badge badge-success"><span class="badge-dot"></span> تایید شده</span></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- TAB 2: Active Sessions & Devices Panel -->
    <div class="gm01-panel" data-panel="sessions" style="display: ${activeTab === 'sessions' ? 'block' : 'none'};">
      <div class="table-wrapper">
        <div class="table-toolbar" style="display: flex; justify-content: space-between; align-items: center;">
          <div>
            <span class="filter-count-badge">تعداد ${activeSessionsCount.toLocaleString('fa-IR')} نشست برخط روی سرور متمرکز VPS</span>
          </div>
          <div>
            <button type="button" class="btn btn-danger btn-sm" onclick="window.confirmRevokeOtherSessions()">
              🚫 ابطال تمام نشست‌های دیگر
            </button>
          </div>
        </div>
        <div class="table-responsive">
          <table class="data-table">
            <thead>
              <tr>
                <th>دستگاه و مرورگر</th>
                <th>آدرس شبکه (IP)</th>
                <th>موقعیت و اپراتور</th>
                <th>زمان شروع / آخرین فعالیت</th>
                <th>وضعیت نشست</th>
                <th class="cell-actions">اقدام امنیتی</th>
              </tr>
            </thead>
            <tbody>
              ${state.sessions.map(s => `
                <tr style="${s.isCurrent ? 'background: rgba(16, 185, 129, 0.05);' : ''}">
                  <td>
                    <div style="font-weight: 600; color: var(--text-primary); font-size: 0.813rem;">${s.device}</div>
                    ${s.isCurrent ? '<span class="badge badge-success" style="font-size: 0.688rem; margin-top: 0.2rem;">نشست جاری (این مرورگر)</span>' : ''}
                  </td>
                  <td><code class="cell-mono">${s.ip}</code></td>
                  <td style="font-size: 0.775rem;">${s.location}</td>
                  <td class="cell-mono" style="font-size: 0.775rem;">${s.startedAt}</td>
                  <td>
                    ${s.isCurrent 
                      ? '<span class="badge badge-success"><span class="status-dot dot-active"></span> فعال (جاری)</span>' 
                      : '<span class="badge badge-neutral"><span class="status-dot dot-warning"></span> فعال (راه دور)</span>'}
                  </td>
                  <td class="cell-actions">
                    ${s.isCurrent 
                      ? '<span class="text-secondary text-xs">نشست فعلی</span>' 
                      : `<button type="button" class="btn btn-danger btn-sm" onclick="window.revokeSingleSession('${s.id}')">قطع نشست</button>`}
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- TAB 3: MFA & Emergency Backup Codes Panel -->
    <div class="gm01-panel" data-panel="mfa" style="display: ${activeTab === 'mfa' ? 'block' : 'none'};">
      <div class="grid-cols-2" style="gap: 1.25rem;">
        <!-- TOTP Setup Card -->
        <div class="card">
          <div class="card-header">
            <div class="card-title-group">
              <h3 class="card-title">پیکربندی نرم‌افزار Authenticator (MFA)</h3>
              <p class="card-subtitle">سازگار با Google Authenticator، Microsoft Authenticator و 1Password</p>
            </div>
            <span class="badge badge-success"><span class="status-dot dot-active"></span> فعال و الزامی</span>
          </div>
          <div class="card-body">
            <div style="display: flex; gap: 1rem; align-items: center; margin-bottom: 1rem; flex-wrap: wrap;">
              <div style="background: white; padding: 0.5rem; border-radius: 6px; border: 1px solid var(--border-default); display: flex; align-items: center; justify-content: center; width: 110px; height: 110px;">
                <!-- QR Code Representation -->
                <svg viewBox="0 0 100 100" width="95" height="95" style="display: block;">
                  <rect width="100" height="100" fill="#ffffff" />
                  <rect x="10" y="10" width="25" height="25" fill="#0f172a" />
                  <rect x="15" y="15" width="15" height="15" fill="#ffffff" />
                  <rect x="65" y="10" width="25" height="25" fill="#0f172a" />
                  <rect x="70" y="15" width="15" height="15" fill="#ffffff" />
                  <rect x="10" y="65" width="25" height="25" fill="#0f172a" />
                  <rect x="15" y="70" width="15" height="15" fill="#ffffff" />
                  <rect x="45" y="20" width="10" height="15" fill="#0f172a" />
                  <rect x="40" y="45" width="20" height="10" fill="#0f172a" />
                  <rect x="70" y="55" width="15" height="20" fill="#0f172a" />
                  <rect x="45" y="70" width="15" height="15" fill="#0f172a" />
                </svg>
              </div>
              <div style="flex: 1; min-width: 200px;">
                <div class="text-xs text-secondary" style="margin-bottom: 0.35rem;">کلید مخفی اختصاصی متنی (Secret Key):</div>
                <div style="display: flex; gap: 0.5rem; align-items: center;">
                  <code class="cell-mono text-cyan" style="font-weight: 700; font-size: 0.875rem; background: var(--bg-surface-elevated); padding: 0.4rem 0.6rem; border-radius: 4px; border: 1px solid var(--border-default);">${state.admin.mfaSecret}</code>
                  <button type="button" class="btn btn-secondary btn-sm" onclick="window.copyMfaSecret()" title="کپی کلید اختصاصی">📋 کپی</button>
                </div>
                <div class="text-xs text-secondary" style="margin-top: 0.5rem; line-height: 1.4;">
                  در صورت عدم اسکن بارکد، این کلید را مستقیماً در نرم‌افزار وارد نمایید.
                </div>
              </div>
            </div>

            <!-- Test 6-digit Code Input -->
            <div class="form-group" style="border-top: 1px solid var(--border-subtle); padding-top: 1rem;">
              <label class="form-label" for="gm01-mfa-test-input">تست صحت کارکرد نرم‌افزار احراز هویت (کد ۶ رقمی جاری):</label>
              <div style="display: flex; gap: 0.5rem;">
                <input type="text" id="gm01-mfa-test-input" class="form-control cell-mono" placeholder="مثال: 489201" maxlength="6" style="width: 170px; letter-spacing: 0.25em; font-size: 1.1rem; text-align: center;" />
                <button type="button" class="btn btn-primary btn-sm" onclick="window.testMfaCode()">بررسی و تایید کد</button>
              </div>
            </div>
          </div>
        </div>

        <!-- Emergency Backup Codes Card -->
        <div class="card">
          <div class="card-header">
            <div class="card-title-group">
              <h3 class="card-title">کدهای اضطراری بازیابی (Backup Codes)</h3>
              <p class="card-subtitle">کدهای یک‌بار مصرف آفلاین برای مواقع عدم دسترسی به گوشی تلفن همراه</p>
            </div>
            <span class="badge badge-neutral">۱۰ کد یک‌بارمصرف</span>
          </div>
          <div class="card-body">
            <p style="font-size: 0.775rem; color: var(--text-secondary); margin-bottom: 0.75rem; line-height: 1.5;">
              در صورتی که دستگاه تلفن همراه در دسترس نباشد یا آسیب ببیند، می‌توانید با هر یک از کدهای زیر یک بار وارد کنترل‌پنل شوید. هر کد پس از یک بار استفاده به طور خودکار باطل می‌شود.
            </p>

            <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 0.5rem; background: var(--bg-surface-elevated); padding: 0.75rem; border-radius: 6px; border: 1px solid var(--border-default); margin-bottom: 1rem;">
              ${state.backupCodes.map((code, idx) => `
                <div style="display: flex; justify-content: space-between; align-items: center; padding: 0.25rem 0.5rem; background: var(--bg-surface); border-radius: 4px; font-size: 0.75rem;">
                  <span class="text-secondary">${(idx + 1).toLocaleString('fa-IR')}.</span>
                  <code class="cell-mono text-primary font-bold">${code}</code>
                </div>
              `).join('')}
            </div>

            <div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
              <button type="button" class="btn btn-secondary btn-sm" onclick="window.copyBackupCodes()">
                📋 کپی تمام کدها
              </button>
              <button type="button" class="btn btn-secondary btn-sm" onclick="window.print()">
                🖨️ چاپ و ذخیره امن
              </button>
              <button type="button" class="btn btn-secondary btn-sm text-warning" onclick="window.regenerateBackupCodes()">
                🔄 ابطال و صدور کدهای جدید
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- TAB 4: Change Password Panel -->
    <div class="gm01-panel" data-panel="password" style="display: ${activeTab === 'password' ? 'block' : 'none'};">
      <div class="card" style="max-width: 650px;">
        <div class="card-header">
          <div class="card-title-group">
            <h3 class="card-title">تغییر گذرواژه حساب ریشه مدیر ارشد</h3>
            <p class="card-subtitle">بروزرسانی رمز عبور ورود با استانداردهای رمزنگاری قوی</p>
          </div>
          <span class="badge badge-purple">امنیت حساب ریشه</span>
        </div>
        <div class="card-body">
          <div class="form-group">
            <label class="form-label" for="gm01-current-password">گذرواژه فعلی</label>
            <input type="password" id="gm01-current-password" class="form-control" placeholder="••••••••••••" />
          </div>

          <div class="form-group">
            <label class="form-label" for="gm01-new-password">گذرواژه جدید</label>
            <input type="password" id="gm01-new-password" class="form-control" placeholder="حداقل ۱۰ نویسه مرکب" />
            <div class="form-hint text-xs text-secondary" style="margin-top: 0.35rem;">
              شامل حداقل یک حرف بزرگ، یک حرف کوچک، یک رقم و یک کاراکتر ویژه (!@#$%^&*).
            </div>
          </div>

          <div class="form-group">
            <label class="form-label" for="gm01-confirm-password">تکرار گذرواژه جدید</label>
            <input type="password" id="gm01-confirm-password" class="form-control" placeholder="تکرار رمز جدید" />
          </div>

          <div style="margin: 1rem 0; padding: 0.75rem; background: var(--bg-surface-elevated); border-radius: 6px; border: 1px solid var(--border-default);">
            <label style="display: flex; align-items: center; gap: 0.5rem; font-size: 0.813rem; cursor: pointer;">
              <input type="checkbox" id="gm01-revoke-on-change" checked style="accent-color: var(--accent-cyan);" />
              <span>پس از تغییر گذرواژه، تمام نشست‌های دیگر روی سایر دستگاه‌ها فوراً باطل شوند.</span>
            </label>
          </div>

          <div style="display: flex; justify-content: flex-end; gap: 0.5rem;">
            <button type="button" class="btn btn-primary" onclick="window.saveMasterPassword()">
              ذخیره و به‌روزرسانی گذرواژه
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- TAB 5: API Access Tokens (PAT) Panel -->
    <div class="gm01-panel" data-panel="api-keys" style="display: ${activeTab === 'api-keys' ? 'block' : 'none'};">
      <div class="table-wrapper">
        <div class="table-toolbar" style="display: flex; justify-content: space-between; align-items: center;">
          <div>
            <span class="filter-count-badge">تعداد ${state.tokens.length.toLocaleString('fa-IR')} کلید دسترسی فعال (Personal Access Tokens)</span>
          </div>
          <div>
            <button type="button" class="btn btn-primary btn-sm" onclick="window.openCreateTokenModal()">
              ＋ صدور کلید دسترسی جدید (New PAT)
            </button>
          </div>
        </div>
        <div class="table-responsive">
          <table class="data-table">
            <thead>
              <tr>
                <th>نام و شناسه کلید</th>
                <th>محدوده دسترسی (Scope)</th>
                <th>تاریخ صدور</th>
                <th>آخرین زمان استفاده</th>
                <th>تاریخ انقضا</th>
                <th>وضعیت</th>
                <th class="cell-actions">ابطال کلید</th>
              </tr>
            </thead>
            <tbody>
              ${state.tokens.map(t => `
                <tr>
                  <td>
                    <code class="cell-mono text-cyan" style="font-weight: 700; font-size: 0.813rem;">${t.name}</code>
                    <div class="text-xs text-secondary cell-mono">${t.id}</div>
                  </td>
                  <td style="font-size: 0.775rem;">${t.scope}</td>
                  <td class="cell-mono text-secondary" style="font-size: 0.75rem;">${t.createdAt}</td>
                  <td class="cell-mono text-primary" style="font-size: 0.75rem;">${t.lastUsed}</td>
                  <td class="cell-mono text-secondary" style="font-size: 0.75rem;">${t.expiresAt}</td>
                  <td><span class="badge badge-success"><span class="badge-dot"></span> فعال</span></td>
                  <td class="cell-actions">
                    <button type="button" class="btn btn-secondary btn-sm text-danger" onclick="window.revokeApiToken('${t.id}')">ابطال کلید</button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- TAB 6: Security Policies & Firewall Panel -->
    <div class="gm01-panel" data-panel="policy" style="display: ${activeTab === 'policy' ? 'block' : 'none'};">
      <div class="card" style="max-width: 700px;">
        <div class="card-header">
          <div class="card-title-group">
            <h3 class="card-title">سیاست‌های امنیتی و فایروال ورود به کنترل‌پنل</h3>
            <p class="card-subtitle">تنظیمات محافظت در برابر نفوذ، قفل خودکار و محدودیت‌های شبکه‌ای</p>
          </div>
          <span class="badge badge-success"><span class="status-dot dot-active"></span> فایروال فعال</span>
        </div>
        <div class="card-body">
          <div class="grid-cols-2" style="gap: 1rem; margin-bottom: 1rem;">
            <div class="form-group">
              <label class="form-label" for="gm01-policy-brute">سقف تلاش‌های ناموفق ورود (Brute-Force):</label>
              <select id="gm01-policy-brute" class="form-control">
                <option value="3">۳ تلاش (بسیار سخت‌گیرانه)</option>
                <option value="5" selected>۵ تلاش ناموفق (پیشنهادی استاندارد)</option>
                <option value="10">۱۰ تلاش ناموفق</option>
              </select>
            </div>

            <div class="form-group">
              <label class="form-label" for="gm01-policy-lockout">مدت زمان قفل موقت حساب:</label>
              <select id="gm01-policy-lockout" class="form-control">
                <option value="15">۱۵ دقیقه</option>
                <option value="30" selected>۳۰ دقیقه (پیشنهادی)</option>
                <option value="60">۶۰ دقیقه (۱ ساعت)</option>
              </select>
            </div>
          </div>

          <div class="form-group" style="margin-bottom: 1rem;">
            <label class="form-label" for="gm01-policy-timeout">خروج خودکار در صورت عدم فعالیت (Inactivity Timeout):</label>
            <select id="gm01-policy-timeout" class="form-control" style="width: 220px;">
              <option value="15">۱۵ دقیقه</option>
              <option value="30" selected>۳۰ دقیقه (پیشنهادی)</option>
              <option value="60">۱ ساعت</option>
              <option value="240">۴ ساعت</option>
            </select>
          </div>

          <div style="border-top: 1px solid var(--border-subtle); padding-top: 1rem; margin-top: 1rem;">
            <label style="display: flex; align-items: center; gap: 0.5rem; font-size: 0.813rem; cursor: pointer; margin-bottom: 0.75rem;">
              <input type="checkbox" id="gm01-policy-ip-switch" ${state.policies.ipAllowlistEnabled ? 'checked' : ''} style="accent-color: var(--accent-cyan);" />
              <strong>محدودسازی ورود فقط به IPهای مجاز مدیران (IP Whitelist)</strong>
            </label>
            <div class="form-group">
              <label class="form-label" for="gm01-policy-ip-list">فهرست آدرس‌ها یا رنج‌های مجاز IP (جداشده با کاما):</label>
              <input type="text" id="gm01-policy-ip-list" class="form-control cell-mono" value="${state.policies.ipAllowlist}" placeholder="185.143.232.0/24, 2.188.42.91" />
            </div>
          </div>

          <div style="display: flex; justify-content: flex-end; gap: 0.5rem; margin-top: 1.25rem;">
            <button type="button" class="btn btn-primary" onclick="window.saveSecurityPolicies()">
              ذخیره سیاست‌های امنیتی سرور
            </button>
          </div>
        </div>
      </div>
    </div>
  `;
};
