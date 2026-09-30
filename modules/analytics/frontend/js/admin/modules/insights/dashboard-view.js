/* WESTO Admin — Advanced Live Operations Dashboard & Command Center Module */
(() => {
  'use strict';

  // --- Audio Synthesizer (Zero-asset Web Audio API) ---
  let audioCtx = null;
  function getAudioContext() {
    if (!audioCtx && (window.AudioContext || window.webkitAudioContext)) {
      const AudioClass = window.AudioContext || window.webkitAudioContext;
      audioCtx = new AudioClass();
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }
    return audioCtx;
  }

  function isAudioEnabled() {
    try {
      return localStorage.getItem('westo_admin_audio_enabled') === 'true';
    } catch (_) {
      return false;
    }
  }

  function setAudioEnabled(enabled) {
    try {
      localStorage.setItem('westo_admin_audio_enabled', enabled ? 'true' : 'false');
      return true;
    } catch (_) {
      return false;
    }
  }

  function audioIconMarkup(enabled, size = 15) {
    return enabled
      ? `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>`
      : `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><line x1="23" y1="9" x2="17" y2="15"></line><line x1="17" y1="9" x2="23" y2="15"></line></svg>`;
  }

  function syncAudioToggleButton(button, enabled) {
    button.classList.toggle('active', enabled);
    button.setAttribute('aria-pressed', enabled ? 'true' : 'false');
    button.setAttribute('aria-label', 'صدای اعلان‌ها');
    button.setAttribute('title', enabled
      ? 'صدای اعلان‌ها فعال است (برای قطع کلیک کنید)'
      : 'صدای اعلان‌ها خاموش است (برای فعال‌سازی کلیک کنید)');
    button.innerHTML = audioIconMarkup(enabled);
  }

  function playChime(type = 'success') {
    if (!isAudioEnabled()) return;
    try {
      const ctx = getAudioContext();
      if (!ctx) return;
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      if (type === 'order') {
        // Upbeat pleasant two-tone chime (C5 -> G5)
        osc.type = 'sine';
        osc.frequency.setValueAtTime(523.25, now);
        osc.frequency.exponentialRampToValueAtTime(783.99, now + 0.12);
        gain.gain.setValueAtTime(0.12, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
        osc.start(now);
        osc.stop(now + 0.35);
      } else if (type === 'alert') {
        // Soft cautionary double-tone (A4 -> F4)
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(440, now);
        osc.frequency.setValueAtTime(349.23, now + 0.1);
        gain.gain.setValueAtTime(0.15, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
        osc.start(now);
        osc.stop(now + 0.3);
      } else {
        // Quick subtle tick
        osc.type = 'sine';
        osc.frequency.setValueAtTime(659.25, now);
        gain.gain.setValueAtTime(0.08, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
        osc.start(now);
        osc.stop(now + 0.08);
      }
    } catch (_) {
      // Audio autoplay policy fallback
    }
  }

  // --- Snoozed Alerts Management ---
  function getSnoozedAlerts() {
    try {
      const raw = sessionStorage.getItem('westo_snoozed_alerts');
      const parsed = raw ? JSON.parse(raw) : {};
      const now = Date.now();
      const valid = {};
      for (const [key, exp] of Object.entries(parsed)) {
        if (exp > now) valid[key] = exp;
      }
      return valid;
    } catch (_) {
      return {};
    }
  }

  function snoozeAlert(alertId, durationMinutes = 15) {
    try {
      const snoozed = getSnoozedAlerts();
      snoozed[alertId] = Date.now() + durationMinutes * 60 * 1000;
      sessionStorage.setItem('westo_snoozed_alerts', JSON.stringify(snoozed));
      return true;
    } catch (_) {
      return false;
    }
  }

  // --- Relative Time Formatter ---
  let lastSyncTimestamp = Date.now();
  function setLastSyncTime(timestamp = Date.now()) {
    lastSyncTimestamp = timestamp;
  }

  function formatRelativeSync(timestamp) {
    const diffSec = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
    if (diffSec < 10) return 'هم‌اکنون بروز شد';
    if (diffSec < 60) return `${diffSec.toLocaleString('fa-IR')} ثانیه قبل`;
    const diffMin = Math.floor(diffSec / 60);
    return `${diffMin.toLocaleString('fa-IR')} دقیقه قبل`;
  }

  // --- Zen / Rush Mode State ---
  function isZenMode() {
    return sessionStorage.getItem('westo_admin_zen_mode') === 'true';
  }

  function toggleZenMode() {
    const next = !isZenMode();
    sessionStorage.setItem('westo_admin_zen_mode', next ? 'true' : 'false');
    const root = document.querySelector('.vital-dashboard');
    if (root) {
      root.classList.toggle('is-zen-mode', next);
    }
    const toggleBtn = document.getElementById('vital-zen-toggle');
    if (toggleBtn) {
      toggleBtn.classList.toggle('active', next);
      toggleBtn.setAttribute('aria-pressed', next ? 'true' : 'false');
    }
    return next;
  }

  // --- Auto-Refresh Pause State ---
  function isAutoRefreshPaused() {
    return window.westoDashboardPauseAutoRefresh === true;
  }

  function toggleAutoRefreshPause() {
    window.westoDashboardPauseAutoRefresh = !window.westoDashboardPauseAutoRefresh;
    const btn = document.getElementById('vital-pause-toggle');
    if (btn) {
      const paused = isAutoRefreshPaused();
      btn.classList.toggle('is-paused', paused);
      btn.innerHTML = paused
        ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>'
        : '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>';
      btn.setAttribute('title', paused ? 'ادامه بروزرسانی خودکار' : 'توقف موقت بروزرسانی خودکار');
      btn.setAttribute('aria-label', 'بروزرسانی خودکار');
      btn.setAttribute('aria-pressed', paused ? 'true' : 'false');
    }
    return window.westoDashboardPauseAutoRefresh;
  }

  // --- Command Palette Dialog (Ctrl/Cmd + K) ---
  function ensureCommandPalette(context) {
    let palette = document.getElementById('westo-command-palette');
    if (!palette) {
      palette = document.createElement('dialog');
      palette.id = 'westo-command-palette';
      palette.className = 'admin-command-palette';
      palette.innerHTML = `
        <div class="cmd-palette-card">
          <div class="cmd-palette-input-wrap">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <circle cx="11" cy="11" r="8"></circle>
              <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
            </svg>
            <input type="text" id="cmd-palette-input" placeholder="جستجوی سریع در بخش‌ها، سفارش‌ها، میزها یا عملیات... (Esc برای خروج)" autocomplete="off" />
            <kbd class="cmd-palette-kbd">Esc</kbd>
          </div>
          <div class="cmd-palette-results" id="cmd-palette-results" role="listbox"></div>
          <div class="cmd-palette-footer">
            <div class="cmd-palette-hints">
              <span><kbd>↑</kbd> <kbd>↓</kbd> جابجایی</span>
              <span><kbd>↵</kbd> انتخاب</span>
              <span><kbd>Esc</kbd> بستن</span>
            </div>
            <div class="cmd-palette-brand">مرکز فرمان هوشمند وستو</div>
          </div>
        </div>
      `;
      document.body.appendChild(palette);

      palette.addEventListener('click', (e) => {
        if (e.target === palette) closeCommandPalette();
      });

      const input = palette.querySelector('#cmd-palette-input');
      input.addEventListener('input', () => renderPaletteResults(context, input.value));
      input.addEventListener('keydown', handlePaletteKeynav);
    }
    return palette;
  }

  function openCommandPalette(context) {
    const palette = ensureCommandPalette(context);
    const input = palette.querySelector('#cmd-palette-input');
    input.value = '';
    renderPaletteResults(context, '');
    if (typeof palette.showModal === 'function') {
      try { palette.showModal(); } catch (_) { palette.setAttribute('open', ''); }
    } else {
      palette.setAttribute('open', '');
    }
    setTimeout(() => input.focus(), 50);
  }

  function closeCommandPalette() {
    const palette = document.getElementById('westo-command-palette');
    if (palette) {
      if (typeof palette.close === 'function') {
        try { palette.close(); } catch (_) { palette.removeAttribute('open'); }
      } else {
        palette.removeAttribute('open');
      }
    }
  }

  const BASE_NAV_ITEMS = [
    { label: 'نمای زنده داشبورد', tab: 'dashboard', category: 'صفحات اصلی', icon: '⌁', hint: 'خلاصه عملیات امروز' },
    { label: 'سفارش‌ها و صف صدور', tab: 'orders', category: 'عملیات زنده', icon: '▣', hint: 'مدیریت و پیگیری سفارش‌ها' },
    { label: 'نمایشگر آشپزخانه (KDS)', tab: 'kitchen', category: 'عملیات زنده', icon: '♨', hint: 'صف بار گرم و آماده‌سازی' },
    { label: 'رزروهای امروز و تقویم', tab: 'reservations', category: 'عملیات زنده', icon: '◌', hint: 'میزهای رزروشده' },
    { label: 'تحویل، پیک و دلیوری', tab: 'delivery', category: 'عملیات زنده', icon: '⚡', hint: 'پیگیری ارسال و پرداخت' },
    { label: 'آمار بازدید و مهمانان', tab: 'analytics', category: 'گزارش‌ها', icon: '▤', hint: 'رهگیری بازدید منو' },
    { label: 'گزارش تجاری فروش', tab: 'reports', category: 'گزارش‌ها', icon: '▥', hint: 'رتبه‌بندی محصولات و درآمد' },
    { label: 'مدیریت منو و اقلام', tab: 'menu', category: 'کاتالوگ', icon: '＋', hint: 'ویرایش دسته‌ها و غذاها' },
    { label: 'مدیریت قیمت‌ها و تغییر سریع', tab: 'prices', category: 'کاتالوگ', icon: '﷼', hint: 'به‌روزرسانی قیمت‌ها' },
    { label: 'مکمل‌ها و مهندسی منو', tab: 'complements', category: 'کاتالوگ', icon: '★', hint: 'پیشنهادات هوشمند افزودنی' },
    { label: 'میزها و چیدمان سالن', tab: 'tables', category: 'مشتریان و پذیرایی', icon: '⊞', hint: 'نقشه میزها و گارسون' },
    { label: 'باشگاه مشتریان و پیام‌رسانی', tab: 'club', category: 'مشتریان و پذیرایی', icon: '♥', hint: 'وفاداری و پیامک‌ها' },
    { label: 'تخفیف‌ها و کمپین‌ها', tab: 'promotions', category: 'مشتریان و پذیرایی', icon: '％', hint: 'کدهای تخفیف فعال' },
    { label: 'حسابداری و دفتر مالی', tab: 'accounting', category: 'مالی', icon: '✓', hint: 'دفترداری دوبل و تسویه' },
    { label: 'انبار و مواد اولیه', tab: 'inventory', category: 'مالی', icon: '◫', hint: 'موجودی انبار و فاکتور خرید' },
    { label: 'کاربران، پرسنل و نقش‌ها', tab: 'users', category: 'تنظیمات', icon: '👥', hint: 'دسترسی‌های همکاران' },
    { label: 'داشبورد تنظیمات سیستم', tab: 'settings', category: 'تنظیمات', icon: '⚙', hint: 'اطلاعات مجموعه و شعبه' },
  ];

  function renderPaletteResults(context, query) {
    const container = document.getElementById('cmd-palette-results');
    if (!container) return;

    const q = String(query || '').trim().toLowerCase();
    const items = [];

    // 1. Quick Actions
    items.push({
      title: '+ ثبت سفارش جدید',
      type: 'action',
      category: 'اقدام‌های سریع',
      icon: '＋',
      action: () => { closeCommandPalette(); context.tabs?.orders?.(); }
    });
    items.push({
      title: '⊞ رفتن به حالت تمرکز سالن (Zen Mode)',
      type: 'action',
      category: 'اقدام‌های سریع',
      icon: '🖥',
      action: () => { closeCommandPalette(); toggleZenMode(); }
    });
    items.push({
      title: '🖨️ چاپ خلاصه روزانه داشبورد',
      type: 'action',
      category: 'اقدام‌های سریع',
      icon: '🖨',
      action: () => { closeCommandPalette(); window.print(); }
    });

    // 2. Navigation items
    for (const nav of BASE_NAV_ITEMS) {
      if (!q || nav.label.toLowerCase().includes(q) || nav.tab.toLowerCase().includes(q) || (nav.hint && nav.hint.toLowerCase().includes(q))) {
        items.push({
          title: nav.label,
          type: 'tab',
          tab: nav.tab,
          category: nav.category,
          icon: nav.icon,
          hint: nav.hint,
          action: () => { closeCommandPalette(); context.tabs?.[nav.tab]?.(); }
        });
      }
    }

    if (!items.length) {
      container.innerHTML = '<div class="cmd-palette-empty">نتیجه‌ای متناسب با جستجوی شما یافت نشد.</div>';
      return;
    }

    container.innerHTML = items.map((item, idx) => `
      <div class="cmd-palette-item ${idx === 0 ? 'selected' : ''}" data-idx="${idx}" role="option" aria-selected="${idx === 0}">
        <span class="cmd-palette-item-icon">${item.icon}</span>
        <div class="cmd-palette-item-info">
          <strong>${item.title}</strong>
          ${item.hint ? `<small>${item.hint}</small>` : ''}
        </div>
        <span class="cmd-palette-item-cat">${item.category}</span>
      </div>
    `).join('');

    container.querySelectorAll('.cmd-palette-item').forEach((row) => {
      const idx = Number(row.dataset.idx);
      row.addEventListener('click', () => items[idx]?.action());
      row.addEventListener('mouseenter', () => {
        container.querySelectorAll('.cmd-palette-item').forEach((el) => el.classList.remove('selected'));
        row.classList.add('selected');
      });
    });

    container._items = items;
  }

  function handlePaletteKeynav(e) {
    const container = document.getElementById('cmd-palette-results');
    if (!container || !container._items) return;
    const items = container.querySelectorAll('.cmd-palette-item');
    if (!items.length) return;

    let selectedIdx = Array.from(items).findIndex((el) => el.classList.contains('selected'));

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectedIdx = (selectedIdx + 1) % items.length;
      items.forEach((el, i) => el.classList.toggle('selected', i === selectedIdx));
      items[selectedIdx]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectedIdx = (selectedIdx - 1 + items.length) % items.length;
      items.forEach((el, i) => el.classList.toggle('selected', i === selectedIdx));
      items[selectedIdx]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (selectedIdx >= 0 && container._items[selectedIdx]) {
        container._items[selectedIdx].action();
      }
    } else if (e.key === 'Escape') {
      closeCommandPalette();
    }
  }

  // --- Shortcuts Help Sheet Modal ---
  function openShortcutsModal() {
    let modal = document.getElementById('westo-shortcuts-modal');
    if (!modal) {
      modal = document.createElement('dialog');
      modal.id = 'westo-shortcuts-modal';
      modal.className = 'admin-shortcuts-dialog';
      modal.innerHTML = `
        <div class="shortcuts-card">
          <header class="shortcuts-header">
            <div>
              <h3>کلیدهای میانبر عملیاتی</h3>
              <p>دستورات سریع برای مدیریت چابک رستوران بدون برداشتن دست از کیبورد</p>
            </div>
            <button type="button" class="shortcuts-close" onclick="document.getElementById('westo-shortcuts-modal').close()">✕</button>
          </header>
          <div class="shortcuts-grid">
            <div class="shortcut-row"><kbd>Ctrl</kbd> + <kbd>K</kbd> <span>پالت دستورات و جستجوی جامع</span></div>
            <div class="shortcut-row"><kbd>O</kbd> <span>ثبت سفارش جدید و صف سفارش‌ها</span></div>
            <div class="shortcut-row"><kbd>R</kbd> <span>تقویم و مدیریت رزرو میز</span></div>
            <div class="shortcut-row"><kbd>M</kbd> <span>مدیریت و ویرایش سریع منو</span></div>
            <div class="shortcut-row"><kbd>A</kbd> <span>کارتابل حسابداری و دفتر مالی</span></div>
            <div class="shortcut-row"><kbd>F</kbd> <span>حالت تمام‌صفحه و تمرکز سالن (Zen Mode)</span></div>
            <div class="shortcut-row"><kbd>?</kbd> <span>نمایش همین راهنمای میانبرها</span></div>
            <div class="shortcut-row"><kbd>Esc</kbd> <span>بستن پنجره‌ها و مودال‌ها</span></div>
          </div>
          <footer class="shortcuts-footer">
            <button type="button" class="btn btn-sm btn-primary" onclick="document.getElementById('westo-shortcuts-modal').close()">متوجه شدم</button>
          </footer>
        </div>
      `;
      document.body.appendChild(modal);
      modal.addEventListener('click', (e) => { if (e.target === modal) modal.close(); });
    }
    if (typeof modal.showModal === 'function') {
      modal.showModal();
    } else {
      modal.setAttribute('open', '');
    }
  }

  // --- Global Keyboard Shortcuts Listener ---
  let shortcutsInstalled = false;
  function installKeyboardShortcuts(context) {
    if (shortcutsInstalled) return;
    shortcutsInstalled = true;

    window.addEventListener('keydown', (e) => {
      // Ignore when user is typing inside an input/textarea/editable
      const target = e.target;
      const isInput = target && (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable);

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        openCommandPalette(context);
        return;
      }

      if (isInput) return;

      if (e.key === '?' || (e.shiftKey && e.key === '/')) {
        e.preventDefault();
        openShortcutsModal();
      } else if (e.key.toLowerCase() === 'o') {
        e.preventDefault();
        playChime('click');
        context.tabs?.orders?.();
      } else if (e.key.toLowerCase() === 'r') {
        e.preventDefault();
        playChime('click');
        context.tabs?.reservations?.();
      } else if (e.key.toLowerCase() === 'm') {
        e.preventDefault();
        playChime('click');
        context.tabs?.menu?.();
      } else if (e.key.toLowerCase() === 'a') {
        e.preventDefault();
        playChime('click');
        context.tabs?.accounting?.();
      } else if (e.key.toLowerCase() === 'f') {
        e.preventDefault();
        playChime('click');
        toggleZenMode();
      }
    });
  }

  // --- Smart Shift Briefing Generator ---
  function generateShiftBriefing({ salesToday, activeOrders, busyTables, delayed, queue, weeklyDailyAverage, currentUser }) {
    const isSalesStrong = salesToday >= (weeklyDailyAverage || 1);
    const hasKitchenStrain = delayed > 0 || queue >= 5;
    const tone = hasKitchenStrain ? 'warning' : isSalesStrong ? 'success' : 'info';

    let headline = '';
    let recommendation = '';

    if (hasKitchenStrain) {
      headline = `فشار صف آشپزخانه: ${delayed ? `${delayed.toLocaleString('fa-IR')} سفارش دیرکرد` : `${queue.toLocaleString('fa-IR')} سفارش در صف`}`;
      recommendation = 'توصیه می‌شود ترتیب آماده‌سازی در بار گرم بررسی شده و گارسون‌ها از زمان تحویل تقریبی مهمانان مطلع شوند.';
    } else if (isSalesStrong) {
      headline = 'روند فروش شیفت جاری مطلوب و بالاتر از میانگین هفتگی است';
      recommendation = 'ظرفیت سالن در وضعیت ایده‌آل است؛ از بخش مهندسی منو برای بیش‌فروشی دسرها و مکمل‌ها استفاده فرمایید.';
    } else {
      headline = 'عملیات سالن پایدار و صف‌ها تحت کنترل کامل است';
      recommendation = 'زمان مناسبی برای بررسی سفارش‌های تأمین مواد اولیه یا ارسال پیامک‌های وفاداری به مشتریان است.';
    }

    return { tone, headline, recommendation };
  }

  // --- Render Enhanced Dashboard HTML ---
  function renderDashboardHtml(payload, context) {
    // The timestamp represents the snapshot rendered below, not page-load time
    // or the moment a refresh was requested. Failed fetches never reach here.
    setLastSyncTime(Date.now());
    const { d, live, stats, financeResult, beResult, currentBranch, currentUser, hasCapability, esc, fmtMoney, fmtNum } = payload;
    const br = currentBranch;
    const salesToday = Number(live.metrics?.salesToday || 0);
    const activeOrders = Number(live.metrics?.activeOrders || 0);
    const busyTables = Number(live.metrics?.busyTables || 0);
    const totalTables = Number(live.metrics?.totalTables || 0);
    const reservationsToday = Number(d.summary?.reservationsToday || 0);
    const openCalls = Number(live.metrics?.openWaiterCalls || 0);
    const delayed = Number(d.summary?.delayed || 0);
    const queue = Number(d.summary?.queue || 0);
    const kitchenQueue = Number(d.summary?.kitchenQueue ?? (d.queue || []).filter((order) => ['sent_to_kitchen', 'paid', 'preparing'].includes(order.status)).length);

    const financeData = financeResult?.data || null;
    const breakEvenDashboard = beResult?.data || beResult || null;
    const financeCriticalIssues = Array.isArray(financeData?.issues)
      ? financeData.issues.filter((issue) => issue.severity === 'critical')
      : [];
    const financeDifferenceIrr = Number(financeData?.metrics?.unexplainedDifferenceIrr || 0);
    const financeNeedsAttention = financeCriticalIssues.length > 0 || financeDifferenceIrr !== 0;
    const financeLoadError = hasCapability('finance.view') ? financeResult?.loadError : null;

    const weeklyDailyAverage = Number(stats.revenueWeek || 0) / 7;
    const salesHealth = salesToday > 0
      ? Math.max(1, Math.min(100, Math.round((salesToday / Math.max(1, weeklyDailyAverage || salesToday)) * 100)))
      : 0;
    const kitchenHealth = Math.max(0, Math.min(100, 100 - delayed * 14 - Math.max(0, kitchenQueue - 3) * 4));

    // Operations composition segments
    const overviewSegments = [
      { label: 'سفارش فعال', value: activeOrders, color: '#66c346' },
      { label: 'میز درگیر', value: busyTables, color: '#4d97ed' },
      { label: 'رزرو امروز', value: reservationsToday, color: '#9b7eea' },
      { label: 'فراخوان باز', value: openCalls, color: '#ffad45' },
    ];
    const overviewTotal = overviewSegments.reduce((sum, item) => sum + item.value, 0) || 1;
    let overviewCursor = 0;
    const overviewGradient = overviewSegments.map((item) => {
      const start = overviewCursor;
      overviewCursor += (item.value / overviewTotal) * 100;
      return `${item.color} ${start.toFixed(2)}% ${overviewCursor.toFixed(2)}%`;
    }).join(', ');

    const displayName = currentUser?.name || currentUser?.phone || 'مدیر وستو';
    const briefing = generateShiftBriefing({ salesToday, activeOrders, busyTables, delayed, queue: kitchenQueue, weeklyDailyAverage, currentUser });
    const isZen = isZenMode();
    const isAudio = isAudioEnabled();
    const isPaused = isAutoRefreshPaused();
    const snoozedAlerts = getSnoozedAlerts();

    // Filter active alerts excluding snoozed
    const activeOrderAlerts = [
      ...(d.delayed || []).map((order) => ({ ...order, alertKind: 'delayed', alertTitle: `تأخیر آشپزخانه سفارش #${order.id}` })),
      ...(d.paymentAttention || []).map((order) => ({ ...order, alertKind: 'payment', alertTitle: `پیگیری پرداخت سفارش #${order.id}` })),
      ...(d.handoffAttention || []).map((order) => ({ ...order, alertKind: 'handoff', alertTitle: `انتظار تحویل سفارش #${order.id}` })),
    ].filter((order) => !snoozedAlerts[`order-${order.alertKind}-${order.id}`]);
    const activeLowStock = (d.lowStock || []).filter((itm) => !snoozedAlerts[`stock-${itm.name}`]);
    const alertCount = activeOrderAlerts.length + activeLowStock.length;

    return `
      <div class="vital-dashboard ${isZen ? 'is-zen-mode' : ''}">
        <!-- Zen Mode Banner -->
        <div class="vital-zen-banner" role="status">
          <div class="vital-zen-info">
            <span class="vital-pulse-dot is-green" aria-hidden="true"></span>
            <strong>حالت تمرکز سالن و شیفت شلوغ فعال است</strong>
            <span>برای خروج کلید <kbd>F</kbd> را بفشارید یا روی بازگشت کلیک کنید.</span>
          </div>
          <button type="button" class="btn btn-sm btn-ghost" id="vital-zen-exit">خروج از حالت تمرکز</button>
        </div>

        <!-- Dashboard Header & Cockpit Controls -->
        <header class="vital-welcome">
          <div>
            <div class="vital-eyebrow-row">
              <p class="eyebrow">مرکز فرمان زنده${br ? ` · ${esc(br.name)}` : ''}</p>
              <div class="vital-sync-pulse" id="vital-sync-pulse" title="وضعیت ارتباط برخط با سرور">
                <span class="vital-pulse-dot is-green" aria-hidden="true"></span>
                <span class="vital-sync-label" id="vital-sync-label">${isPaused ? 'پایش موقتاً متوقف است' : 'اتصال زنده برقرار است'}</span>
                <small class="vital-sync-time" id="vital-sync-time">${formatRelativeSync(lastSyncTimestamp)}</small>
              </div>
            </div>
            <h1>وقت بخیر، ${esc(displayName)} <span aria-hidden="true">👋</span></h1>
            <p class="lead">امروز در مجموعه چه می‌گذرد؛ فروش، سفارش، آشپزخانه و هشدارها در یک نگاه.</p>
          </div>

          <div class="vital-page-actions">
            <div class="vital-controls-group">
              <button type="button" class="vital-icon-btn ${isPaused ? 'is-paused' : ''}" id="vital-pause-toggle" title="${isPaused ? 'ادامه بروزرسانی خودکار' : 'توقف موقت بروزرسانی خودکار'}" aria-label="بروزرسانی خودکار" aria-pressed="${isPaused ? 'true' : 'false'}">
                ${isPaused
                  ? '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>'
                  : '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>'}
              </button>
              <button type="button" class="vital-icon-btn" id="vital-refresh-btn" title="بروزرسانی دستی شاخص‌ها" aria-label="بروزرسانی دستی">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/>
                </svg>
              </button>
              <button type="button" class="vital-icon-btn ${isAudio ? 'active' : ''}" id="vital-audio-toggle" title="${isAudio ? 'صدای اعلان‌ها فعال است (برای قطع کلیک کنید)' : 'صدای اعلان‌ها خاموش است (برای فعال‌سازی کلیک کنید)'}" aria-label="صدای اعلان‌ها" aria-pressed="${isAudio ? 'true' : 'false'}">
                ${audioIconMarkup(isAudio)}
              </button>
              <button type="button" class="vital-icon-btn ${isZen ? 'active' : ''}" id="vital-zen-toggle" title="حالت تمرکز سالن (کلید F)" aria-label="حالت تمرکز سالن">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"></path>
                </svg>
              </button>
              <button type="button" class="vital-icon-btn" id="vital-cmd-palette-btn" title="پالت جستجوی دستورات (Ctrl+K)" aria-label="پالت جستجو">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="11" cy="11" r="8"></circle>
                  <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                </svg>
              </button>
              <button type="button" class="vital-icon-btn" id="vital-shortcuts-btn" title="راهنمای کلیدهای میانبر (کلید ?)" aria-label="کلیدهای میانبر">
                <span style="font-weight:bold;font-size:12px;">؟</span>
              </button>
            </div>

            <span class="vital-date-pill">${window.ShamsiCore ? window.ShamsiCore.formatShamsiDateFull(new Date()) : new Date().toLocaleDateString('fa-IR', { weekday: 'long', day: 'numeric', month: 'long' })}</span>
            <button class="btn btn-sm btn-ghost" data-quick-tab="orders">+ سفارش جدید (O)</button>
          </div>
        </header>

        <!-- Smart Shift Briefing Banner -->
        <section class="vital-briefing-card tone-${briefing.tone}" aria-label="تحلیل هوشمند وضعیت شیفت">
          <div class="vital-briefing-badge">💡 خلاصه تحلیلی شیفت</div>
          <div class="vital-briefing-content">
            <strong>${esc(briefing.headline)}</strong>
            <p>${esc(briefing.recommendation)}</p>
          </div>
          <div class="vital-briefing-actions">
            <button type="button" class="btn btn-xs btn-ghost" onclick="window.print()" title="چاپ خلاصه روز">🖨️ چاپ روزانه</button>
          </div>
        </section>

        <!-- Finance Alert Strips -->
        ${financeNeedsAttention ? `<button type="button" class="vital-finance-strip" data-quick-tab="accounting"><i aria-hidden="true">﷼</i><span><b>فروش و دفتر مالی نیازمند تطبیق‌اند</b><small>${fmtNum(financeCriticalIssues.length)} نوع هشدار فوری${financeDifferenceIrr ? ` · ${fmtMoney(Math.round(Math.abs(financeDifferenceIrr) / 10))} اختلاف توضیح‌نشده` : ''}</small></span><strong>باز کردن کارتابل حسابدار ←</strong></button>` : ''}
        ${financeLoadError ? '<button type="button" class="vital-finance-strip" data-quick-tab="accounting"><i aria-hidden="true">!</i><span><b>وضعیت مالی دریافت نشد</b><small>خطا پنهان نشده است؛ جزئیات و تلاش دوباره در کارتابل حسابدار قرار دارد.</small></span><strong>بررسی وضعیت ←</strong></button>' : ''}

        <!-- 4 Top Executive KPI Cards -->
        <section class="vital-kpi-grid" aria-label="شاخص‌های اصلی امروز">
          <article class="vital-kpi is-green" data-kpi-jump="reports" role="button" tabindex="0" title="مشاهده گزارش کامل فروش">
            <span class="vital-kpi__icon" aria-hidden="true">⌁</span>
            <small>فروش امروز</small>
            <strong>${fmtMoney(salesToday)}</strong>
            <em>${salesHealth >= 100 ? 'بالاتر از میانگین هفتگی' : `${fmtNum(salesHealth)}٪ میانگین روزانه هفته`}</em>
            <span class="vital-kpi-trend is-up">▲ زنده</span>
          </article>

          <article class="vital-kpi is-purple" data-kpi-jump="orders" role="button" tabindex="0" title="مشاهده صف سفارش‌ها">
            <span class="vital-kpi__icon" aria-hidden="true">▣</span>
            <small>سفارش‌های فعال</small>
            <strong>${fmtNum(activeOrders)}</strong>
            <em>${queue ? `${fmtNum(queue)} سفارش نیازمند اقدام` : 'صف عملیات تحت کنترل است'}</em>
            <span class="vital-kpi-badge">${fmtNum(activeOrders)} در جریان</span>
          </article>

          <article class="vital-kpi is-blue" data-kpi-jump="tables" role="button" tabindex="0" title="مشاهده نقشه میزهای سالن">
            <span class="vital-kpi__icon" aria-hidden="true">▤</span>
            <small>میزهای درگیر</small>
            <strong>${fmtNum(busyTables)} <i>از ${fmtNum(totalTables)}</i></strong>
            <em>وضعیت زنده سالن</em>
            <span class="vital-kpi-badge">${totalTables ? Math.round((busyTables / totalTables) * 100) : 0}٪ اشغال</span>
          </article>

          <article class="vital-kpi is-orange" data-kpi-jump="reservations" role="button" tabindex="0" title="مشاهده رزروهای امروز">
            <span class="vital-kpi__icon" aria-hidden="true">◌</span>
            <small>رزروهای امروز</small>
            <strong>${fmtNum(reservationsToday)}</strong>
            <em>${openCalls ? `${fmtNum(openCalls)} فراخوان گارسون باز` : 'فراخوان بازی وجود ندارد'}</em>
            ${openCalls ? `<span class="vital-kpi-alert-dot" title="${fmtNum(openCalls)} فراخوان باز">!</span>` : ''}
          </article>
        </section>

        <!-- Break-Even Shell (Contract-Compliant) -->
        ${payload.renderDashboardBreakEvenShell(breakEvenDashboard, stats, financeData, hasCapability('finance.view'))}

        <!-- Main Dashboard Layout (Split Grid) -->
        <div class="vital-dashboard-layout">
          <div class="vital-dashboard-main">
            <!-- Health & Composition Grid -->
            <section class="vital-health-grid" aria-label="سلامت عملیات">
              <article class="vital-health-card vital-health-card--sales">
                <header>
                  <span>سلامت فروش</span>
                  <button type="button" class="vital-more" aria-label="جزئیات فروش" data-quick-tab="reports">•••</button>
                </header>
                <div class="vital-dot-score" aria-label="امتیاز ${fmtNum(salesHealth)} از ۱۰۰">${fmtNum(salesHealth)}</div>
                <strong>${salesHealth >= 90 ? 'عالی' : salesHealth >= 65 ? 'رو به رشد' : 'نیازمند توجه'}</strong>
                <p>${fmtMoney(salesToday)} فروش ثبت‌شده امروز</p>
                <div class="vital-dot-wave" aria-hidden="true"></div>
              </article>

              <article class="vital-health-card vital-health-card--kitchen">
                <header>
                  <span>عملکرد آشپزخانه</span>
                  <button type="button" class="vital-more" aria-label="جزئیات آشپزخانه" data-quick-tab="kitchen">•••</button>
                </header>
                <div class="vital-dot-score" aria-label="امتیاز ${fmtNum(kitchenHealth)} از ۱۰۰">${fmtNum(kitchenHealth)}</div>
                <strong>${delayed ? 'نیازمند اقدام' : 'خوب'}</strong>
                <p>${delayed ? `${fmtNum(delayed)} سفارش دارای تأخیر` : 'سفارش دیرکرده‌ای ثبت نشده است'}</p>
                <div class="vital-dot-wave" aria-hidden="true"></div>
              </article>

              <article class="vital-overview-card">
                <header>
                  <div>
                    <p class="eyebrow">نمای امروز</p>
                    <h2>ترکیب عملیات</h2>
                  </div>
                </header>
                <div class="vital-overview-content">
                  <div class="vital-donut" style="--vital-donut:${overviewGradient}" role="img" aria-label="ترکیب عملیات امروز">
                    <span>
                      <strong>${fmtNum(overviewSegments.reduce((sum, item) => sum + item.value, 0))}</strong>
                      <small>رویداد</small>
                    </span>
                  </div>
                  <div class="vital-donut-legend">
                    ${overviewSegments.map((item) => `
                      <div class="vital-legend-row" data-legend-cat="${esc(item.label)}">
                        <i style="--legend:${item.color}"></i>
                        <span>${esc(item.label)}</span>
                        <strong>${fmtNum(item.value)} <small>(${Math.round((item.value / overviewTotal) * 100)}٪)</small></strong>
                      </div>
                    `).join('')}
                  </div>
                </div>
              </article>
            </section>

            <!-- Revenue Trend & Top Selling Details -->
            <section class="vital-detail-grid">
              <article class="section-box vital-chart-card">
                <div class="ops-panel__head">
                  <div>
                    <p class="eyebrow">روند درآمد</p>
                    <h2>${fmtMoney(stats.revenueWeek || 0)}</h2>
                    <span class="hint">فروش هفته جاری</span>
                  </div>
                  <button class="text-btn" data-quick-tab="reports">مشاهده گزارش</button>
                </div>
                ${payload.sparkBars([Math.max(0, weeklyDailyAverage * .58), weeklyDailyAverage * .72, weeklyDailyAverage * .68, weeklyDailyAverage * .86, weeklyDailyAverage, weeklyDailyAverage * .92, salesToday], 76)}
                <div class="vital-chart-footer-metrics">
                  <div class="metric-pill"><span>میانگین روزانه:</span> <strong>${fmtMoney(Math.round(weeklyDailyAverage))}</strong></div>
                  <div class="metric-pill"><span>عملکرد امروز:</span> <strong class="${salesHealth >= 90 ? 'text-green' : ''}">${fmtNum(salesHealth)}٪ هدف</strong></div>
                </div>
              </article>

              <article class="section-box vital-selling-card">
                <div class="ops-panel__head">
                  <div>
                    <p class="eyebrow">محبوب‌ترین‌ها</p>
                    <h2>محصولات پرفروش</h2>
                  </div>
                  <button class="text-btn" data-quick-tab="reports">همه</button>
                </div>
                <div class="vital-selling-list">
                  ${(stats.topItems || []).slice(0, 5).map((item, index) => `
                    <div class="vital-selling-row">
                      <span class="vital-selling-rank">${fmtNum(index + 1)}</span>
                      <div class="vital-selling-name-block">
                        <b>${esc(item.name)}</b>
                        <small>${fmtNum(item.qty)} سفارش</small>
                      </div>
                      <strong class="vital-selling-rev">${fmtMoney(item.revenue)}</strong>
                    </div>
                  `).join('') || '<p class="ops-empty">هنوز فروش ثبت نشده است.</p>'}
                </div>
              </article>
            </section>

            <!-- Quick Action Dock -->
            <nav class="vital-action-dock" aria-label="اقدام‌های سریع">
              <button data-quick-tab="orders"><i>＋</i><span>سفارش‌ها (O)</span></button>
              <button data-quick-tab="reservations"><i>□</i><span>رزرو میز (R)</span></button>
              <button data-quick-tab="menu"><i>＋</i><span>مدیریت منو (M)</span></button>
              <button data-quick-tab="club"><i>⌁</i><span>پیام به مشتریان</span></button>
              ${hasCapability('finance.view')
                ? '<button data-quick-tab="accounting"><i>✓</i><span>کارتابل مالی (A)</span></button>'
                : '<button data-quick-tab="reports"><i>▥</i><span>گزارش‌ها</span></button>'}
            </nav>
          </div>

          <!-- Live Sidebar: Orders Queue, Alerts & Follow-ups -->
          <aside class="vital-side-column" aria-label="جریان زنده و هشدارها">
            <!-- Live Orders Panel -->
            <section class="section-box vital-live-panel">
              <div class="ops-panel__head">
                <h2>سفارش‌های زنده</h2>
                <button class="text-btn" data-quick-tab="orders">همه (${fmtNum((d.queue || []).length)})</button>
              </div>
              <div class="vital-live-list">
                ${(d.queue || []).slice(0, 6).map((order, index) => `
                  <button type="button" data-order-jump="${order.id}" class="vital-order-row">
                    <i class="vital-status-dot is-${index % 4}"></i>
                    <span>
                      <b>#${order.id}</b>
                      <small>${esc(order.tableNo ? `میز ${order.tableNo}` : payload.fulfillmentLabel(order.fulfillment))}</small>
                    </span>
                    <em>${esc(payload.statusLabel(order.status))}</em>
                    <time>${fmtNum(order.ageMinutes)}د</time>
                  </button>
                `).join('') || '<p class="ops-empty">سفارشی در صف نیست.</p>'}
              </div>
            </section>

            <!-- Actionable Alerts Panel -->
            <section class="section-box vital-alert-panel">
              <div class="ops-panel__head">
                <h2>هشدارها و توجه (<span data-vital-alert-count data-count="${alertCount}" aria-live="polite">${fmtNum(alertCount)}</span>)</h2>
                <button class="text-btn" data-quick-tab="inventory">انبار</button>
              </div>
              <div class="vital-alert-list">
                ${activeOrderAlerts.slice(0, 4).map((order) => `
                  <div class="vital-alert-card is-danger" id="alert-order-${order.id}">
                    <i class="is-red">!</i>
                    <div class="vital-alert-text">
                      <b>${esc(order.alertTitle)}</b>
                      <small>${fmtNum(order.stageAgeMinutes ?? order.ageMinutes)} دقیقه در ${esc(payload.statusLabel(order.status))}</small>
                    </div>
                    <div class="vital-alert-actions">
                      <button type="button" class="btn btn-xs btn-ghost" data-order-jump="${order.id}" title="مشاهده سفارش">نمایش</button>
                      <button type="button" class="btn btn-xs btn-icon" data-snooze-alert="order-${order.alertKind}-${order.id}" title="تعویق ۱۵ دقیقه">⏱️</button>
                    </div>
                  </div>
                `).join('')}

                ${activeLowStock.slice(0, 4).map((item) => `
                  <div class="vital-alert-card is-warning" id="alert-stock-${encodeURIComponent(item.name)}">
                    <i class="is-orange">▣</i>
                    <div class="vital-alert-text">
                      <b>موجودی کم: ${esc(item.name)}</b>
                      <small>${fmtNum(item.stock)} عدد باقی مانده</small>
                    </div>
                    <div class="vital-alert-actions">
                      <button type="button" class="btn btn-xs btn-ghost" data-quick-tab="inventory" title="انبار">انبار</button>
                      <button type="button" class="btn btn-xs btn-icon" data-snooze-alert="stock-${item.name}" title="تعویق ۱۵ دقیقه">⏱️</button>
                    </div>
                  </div>
                `).join('')}

                <p class="ops-empty" data-vital-alert-empty${alertCount === 0 ? '' : ' hidden'}>هشدار فوری وجود ندارد؛ همه چیز مرتب است.</p>
              </div>
            </section>

            <!-- Today's Reservations Panel -->
            <section class="section-box vital-task-panel">
              <div class="ops-panel__head">
                <h2>پیگیری رزروهای امروز</h2>
                <button class="text-btn" data-quick-tab="reservations">همه</button>
              </div>
              <div class="vital-task-list">
                ${(d.reservations || []).slice(0, 5).map((reservation) => `
                  <div class="vital-task-row">
                    <i aria-hidden="true"></i>
                    <span>${esc(reservation.time)} · ${esc(reservation.name)}</span>
                  </div>
                `).join('') || '<p class="ops-empty">رزروی برای پیگیری ثبت نشده است.</p>'}
              </div>
            </section>
          </aside>
        </div>
      </div>
    `;
  }

  // --- Wire Event Handlers and Listeners ---
  let relativeTimeInterval = null;

  function bindDashboardEvents(container, payload, context) {
    // 1. Quick Tabs and Order Jumps
    container.querySelectorAll('[data-quick-tab]').forEach((button) => {
      button.addEventListener('click', () => {
        playChime('click');
        context.tabs?.[button.dataset.quickTab]?.().catch((err) => context.showToast?.(err.message));
      });
    });

    container.querySelectorAll('[data-order-jump]').forEach((button) => {
      button.addEventListener('click', () => {
        playChime('click');
        sessionStorage.setItem('westo_admin_focus_order', button.dataset.orderJump);
        context.tabs?.orders?.().catch((err) => context.showToast?.(err.message));
      });
    });

    // 2. KPI Cards Click-to-Jump
    container.querySelectorAll('[data-kpi-jump]').forEach((card) => {
      card.addEventListener('click', () => {
        playChime('click');
        context.tabs?.[card.dataset.kpiJump]?.().catch((err) => context.showToast?.(err.message));
      });
    });

    // 3. Zen Mode Toggles
    const zenToggle = container.querySelector('#vital-zen-toggle');
    if (zenToggle) {
      zenToggle.addEventListener('click', () => {
        playChime('click');
        toggleZenMode();
      });
    }
    const zenExit = container.querySelector('#vital-zen-exit');
    if (zenExit) {
      zenExit.addEventListener('click', () => {
        playChime('click');
        toggleZenMode();
      });
    }

    // 4. Auto-Refresh Pause Toggle
    const pauseToggle = container.querySelector('#vital-pause-toggle');
    if (pauseToggle) {
      pauseToggle.addEventListener('click', () => {
        playChime('click');
        const paused = toggleAutoRefreshPause();
        context.showToast?.(paused ? 'بروزرسانی خودکار متوقف شد' : 'بروزرسانی خودکار فعال شد', 'info');
      });
    }

    // 5. Manual Refresh Button
    const refreshBtn = container.querySelector('#vital-refresh-btn');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', async () => {
        if (refreshBtn.disabled) return;
        playChime('click');
        refreshBtn.disabled = true;
        refreshBtn.setAttribute('aria-busy', 'true');
        refreshBtn.classList.add('spinning');
        try {
          if (typeof context.tabs?.dashboard !== 'function') throw new Error('dashboard_refresh_unavailable');
          await context.tabs.dashboard();
          setLastSyncTime(Date.now());
          context.showToast?.('شاخص‌های داشبورد به‌روزرسانی شدند', 'success');
        } catch (_) {
          context.showToast?.('به‌روزرسانی انجام نشد؛ وضعیت قبلی حفظ شد. اتصال را بررسی کنید و دوباره تلاش کنید.', 'error');
        } finally {
          refreshBtn.disabled = false;
          refreshBtn.setAttribute('aria-busy', 'false');
          refreshBtn.classList.remove('spinning');
        }
      });
    }

    // 6. Audio Toggle
    const audioToggle = container.querySelector('#vital-audio-toggle');
    if (audioToggle) {
      audioToggle.addEventListener('click', () => {
        const next = !isAudioEnabled();
        if (!setAudioEnabled(next)) {
          context.showToast?.('تنظیم صدای اعلان‌ها ذخیره نشد.', 'error');
          return;
        }
        syncAudioToggleButton(audioToggle, next);
        if (next) playChime('order');
        context.showToast?.(next ? 'صدای اعلان‌ها فعال شد' : 'صدای اعلان‌ها غیرفعال شد', 'info');
      });
    }

    // 7. Command Palette Trigger
    const cmdBtn = container.querySelector('#vital-cmd-palette-btn');
    if (cmdBtn) {
      cmdBtn.addEventListener('click', () => {
        playChime('click');
        openCommandPalette(context);
      });
    }

    // 8. Shortcuts Help Trigger
    const shortcutsBtn = container.querySelector('#vital-shortcuts-btn');
    if (shortcutsBtn) {
      shortcutsBtn.addEventListener('click', () => {
        playChime('click');
        openShortcutsModal();
      });
    }

    // 9. Snooze Alert Actions
    container.querySelectorAll('[data-snooze-alert]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const alertId = btn.dataset.snoozeAlert;
        if (!snoozeAlert(alertId, 15)) {
          context.showToast?.('تعویق هشدار ذخیره نشد؛ هشدار در فهرست باقی ماند.', 'error');
          return;
        }
        playChime('click');
        const countEl = container.querySelector('[data-vital-alert-count]');
        if (countEl) {
          const currentCount = Number(countEl.dataset.count);
          const nextCount = Math.max(0, (Number.isFinite(currentCount) ? currentCount : 0) - 1);
          countEl.dataset.count = String(nextCount);
          countEl.textContent = nextCount.toLocaleString('fa-IR');
          const emptyState = container.querySelector('[data-vital-alert-empty]');
          if (emptyState) emptyState.hidden = nextCount !== 0;
        }
        const card = btn.closest('.vital-alert-card');
        if (card) {
          card.style.opacity = '0';
          card.style.transform = 'scale(0.95)';
          card.style.transition = 'all 0.2s ease';
          setTimeout(() => {
            card.remove();
            context.showToast?.('هشدار برای ۱۵ دقیقه به تعویق افتاد', 'info');
          }, 200);
        }
      });
    });

    // 10. Install Global Keyboard Shortcuts (idempotent)
    installKeyboardShortcuts(context);

    // 11. Relative Sync Time Live Clock
    if (relativeTimeInterval) clearInterval(relativeTimeInterval);
    relativeTimeInterval = setInterval(() => {
      const timeEl = document.getElementById('vital-sync-time');
      if (timeEl) {
        timeEl.textContent = formatRelativeSync(lastSyncTimestamp);
      }
    }, 5000);
  }

  // --- Public Interface attached to window.WestoDashboardView ---
  window.WestoDashboardView = {
    render: renderDashboardHtml,
    bindEvents: bindDashboardEvents,
    openCommandPalette,
    closeCommandPalette,
    openShortcutsModal,
    toggleZenMode,
    toggleAutoRefreshPause,
    isAutoRefreshPaused,
    setLastSyncTime,
    playChime,
    destroy() {
      if (relativeTimeInterval) {
        clearInterval(relativeTimeInterval);
        relativeTimeInterval = null;
      }
    }
  };
})();
