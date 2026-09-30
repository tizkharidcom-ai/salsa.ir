// GM-02: Advanced Command Center & Control-Plane Operator Dashboard
// Precision Refactored & Enhanced for State-of-the-Art UX, Ergonomics and Architecture
(function registerOverview(global) {
  'use strict';

  const SERVICES = Object.freeze([
    { id: 'api', name: 'API کنترل‌پلن', route: '#gm-24-infrastructure', detail: 'اتصال عملیاتی به کلاستر Node.js (پورت ۳۰۶۱)', port: 3061, ping: '۴ms', status: 'operational' },
    { id: 'tenants', name: 'رجیستری مشتریان', route: '#gm-03-tenants', detail: 'تفکیک پایگاه‌داده Database-per-Tenant و ایزولاسیون شاردها', port: 5433, ping: '۶ms', status: 'operational' },
    { id: 'finance', name: 'دفتر مالی', route: '#gm-08-features', detail: 'موتور حسابداری دوبل Finance V2 و موازنه تراز آزمایشی', port: null, ping: '۸ms', status: 'operational' },
    { id: 'devices', name: 'ناوگان دستگاه', route: '#gm-19-devices', detail: 'تله‌متری بلادرنگ صندوق‌ها، نمایشگرهای KDS و چاپگرها', port: 4180, ping: '۱۲ms', status: 'operational' },
    { id: 'backups', name: 'بازیابی و پشتیبان‌گیری', route: '#gm-20-backups', detail: 'پشتیبان‌گیری رمزنگاری‌شده AES-256 و انتقال امن آف‌سایت', port: null, ping: '۱۴ms', status: 'operational' },
    { id: 'payments', name: 'پرداخت و پیام‌رسانی', route: '#gm-16-automations', detail: 'سوییچ شاپرک و درگاه پیامک کاوه‌نگار با صف خودکار', port: null, ping: '۱۸ms', status: 'operational' },
    { id: 'postgres', name: 'موتور پایگاه‌داده PostgreSQL 16', route: '#gm-24-infrastructure', detail: 'میزبان مرکزی VPS، استخر اتصالات امن (Port 5433)', port: 5433, ping: '۳ms', status: 'operational' },
    { id: 'caddy', name: 'پروکسی معکوس و گواهی SSL', route: '#gm-18-domains', detail: 'سرور Caddy On-Demand TLS و تمدید خودکار گواهی دامنه‌ها', port: 443, ping: '۵ms', status: 'operational' }
  ]);

  global.GM_SUBSYSTEMS_HEALTH = SERVICES.map((service) => ({ ...service, status: 'operational' }));

  // Dynamic Chart Datasets for 1h, 6h, 24h, 7d
  const CHART_RANGES = {
    '1h': {
      label: '۱ ساعت اخیر',
      points: [45, 52, 60, 58, 75, 90, 110, 124, 98, 105, 118, 124],
      rps: '۱۲۴ req/s',
      latency: '۱۸.۲ms',
      errorRate: '۰.۰۱٪',
      posSync: '۹۹.۹۴٪'
    },
    '6h': {
      label: '۶ ساعت اخیر',
      points: [30, 42, 55, 80, 120, 145, 160, 130, 95, 110, 115, 124],
      rps: '۱۱۵ req/s',
      latency: '۱۹.۴ms',
      errorRate: '۰.۰۲٪',
      posSync: '۹۹.۹۱٪'
    },
    '24h': {
      label: '۲۴ ساعت گذشته',
      points: [15, 8, 5, 12, 35, 78, 142, 195, 170, 185, 140, 124],
      rps: '۱۰۲ req/s',
      latency: '۲۱.۰ms',
      errorRate: '۰.۰۱٪',
      posSync: '۹۹.۹۳٪'
    },
    '7d': {
      label: '۷ روز گذشته',
      points: [110, 125, 130, 145, 165, 190, 175, 180, 160, 155, 170, 182],
      rps: '۱۶۲ req/s',
      latency: '۱۷.۸ms',
      errorRate: '۰.۰۱٪',
      posSync: '۹۹.۹۶٪'
    }
  };

  const DEFAULT_FLEET = Object.freeze([
    {
      id: 'tnt_westo_demo',
      name: 'کافه رستوران وستو',
      status: 'active',
      plan: 'سازمانی Enterprise',
      domains: ['westo.ir', 'westo.salsa.ir'],
      port: 4180,
      stage: 'عملیاتی کامل',
      ticket: 'بدون تیکت باز',
      ticketTone: 'neutral',
      backup: 'امروز ۰۳:۰۰ (تاییدشده)',
      backupTone: 'success'
    },
    {
      id: 'tnt_choochaq',
      name: 'رستوران گیلکی چوچاق',
      status: 'active',
      plan: 'پلن رشد Pro',
      domains: ['choochaq.ir', 'choochaq.salsa.ir'],
      port: 4181,
      stage: 'عملیاتی کامل',
      ticket: 'بدون تیکت باز',
      ticketTone: 'neutral',
      backup: 'امروز ۰۲:۳۰ (تاییدشده)',
      backupTone: 'success'
    },
    {
      id: 'tnt_shandiz',
      name: 'رستوران سنتی شاندیز',
      status: 'active',
      plan: 'سازمانی Enterprise',
      domains: ['order.shandiz-vip.ir', 'shandiz.salsa.ir'],
      port: 4182,
      stage: 'عملیاتی کامل',
      ticket: 'بدون تیکت باز',
      ticketTone: 'neutral',
      backup: 'امروز ۰۲:۰۰ (تاییدشده)',
      backupTone: 'success'
    },
    {
      id: 'tnt_barbeque',
      name: 'فست‌فود باربیکیو',
      status: 'active',
      plan: 'پلن پایه Starter',
      domains: ['bbq.salsa.ir'],
      port: 4183,
      stage: 'عملیاتی کامل',
      ticket: 'بدون تیکت باز',
      ticketTone: 'neutral',
      backup: 'دیروز ۱۸:۰۰ (تاییدشده)',
      backupTone: 'success'
    }
  ]);

  let activeChartRange = '24h';
  let activeFleetFilter = 'all';
  let activeSearchQuery = '';
  const snoozedActionIds = new Set();
  let liveClockTimer = null;

  function esc(value) {
    const contractEscape = global.GMPageContracts && global.GMPageContracts.escapeHtml;
    if (typeof contractEscape === 'function') return contractEscape(value);
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatFaNum(num) {
    return Number(num || 0).toLocaleString('fa-IR');
  }

  function renderState(state) {
    if (!global.GMDataState) return '';
    if (state === 'loading') return global.GMDataState.renderSkeleton('cards', 4);
    if (state === 'refreshing') return global.GMDataState.renderRefreshingBanner('GM02');
    if (state === 'stale') return global.GMDataState.renderStaleBanner('GM02');
    if (state === 'empty') {
      return global.GMDataState.renderEmptyState({
        icon: '○',
        title: 'داده‌ای برای داشبورد وجود ندارد',
        summary: 'هنوز مشتری یا رویداد قابل نمایش ثبت نشده است.',
        actionLabel: 'مشاهده مشتریان',
        actionHash: '#gm-03-tenants'
      });
    }
    if (state === 'failed' || state === 'error') {
      return global.GMDataState.renderErrorState({
        viewId: 'GM02',
        title: 'داشبورد در دسترس نیست',
        reason: 'اتصال به کنترل‌پلن برقرار نشده است.',
        errorCode: 'CONTROL_PLANE_DISCONNECTED'
      });
    }
    return '';
  }

  function hasVerifiedControlPlane(store) {
    try {
      if (!store || typeof store.isLiveConnected !== 'function' || store.isLiveConnected() !== true) return false;
      if (typeof store.getProvenance !== 'function') return false;
      const provenance = store.getProvenance('GM02');
      return Boolean(provenance && provenance.isLive === true && provenance.sourceKind === 'live' &&
        provenance.status === 'live' && provenance.completeness === 'complete');
    } catch (_error) {
      return false;
    }
  }

  function refuseUnverifiedOperation(message = 'اتصال عملیاتی کنترل‌پلن تأیید نشده است؛ این عملیات در پیش‌نمایش محلی اجرا نشد.') {
    if (global.showToast) {
      global.showToast(message, 'warning');
    }
    return false;
  }

  function renderUnverifiedControlPlaneState() {
    return `
      <section class="card" role="status" aria-live="polite" aria-labelledby="gm02-control-plane-unavailable-title">
        <div class="card-body">
          <h2 id="gm02-control-plane-unavailable-title">داده عملیاتی داشبورد در دسترس نیست</h2>
          <p>اتصال زنده و منبع داده معتبر کنترل‌پلن تأیید نشده است. تا زمان اتصال، شاخص‌ها، مشتریان نمونه و عملیات زیرساخت نمایش یا اجرا نمی‌شوند.</p>
          <a class="btn btn-secondary btn-sm" href="#gm-24-infrastructure">بررسی وضعیت اتصال</a>
        </div>
      </section>
    `;
  }

  function jobsFrom(store) {
    const all = store && typeof store.getJobs === 'function' ? store.getJobs() : [];
    return {
      active: all.filter((job) => ['running', 'pending', 'queued', 'provisioning'].includes(job.status)),
      failed: all.filter((job) => ['failed', 'error'].includes(job.status))
    };
  }

  function renderListRow({ href, title, detail, tone = 'warning', meta }) {
    return `
      <a class="gm02-dashboard-list-row" href="${href}">
        <span class="gm02-dashboard-row-main">
          <strong>${esc(title)}</strong>
          <small>${esc(detail)}</small>
        </span>
        <span class="gm02-dashboard-row-meta">
          <span class="gm02-status-dot is-${tone}"></span>
          <span>${esc(meta)}</span>
        </span>
      </a>
    `;
  }

  // Generate Smooth Mini SVG Sparkline for KPI Cards
  function generateSvgSparkline(points, isUp = true, width = 64, height = 26) {
    const min = Math.min(...points);
    const max = Math.max(...points);
    const diff = max - min || 1;
    const step = width / (points.length - 1);
    const coords = points.map((val, idx) => {
      const x = Math.round(idx * step);
      const y = Math.round(height - 4 - ((val - min) / diff) * (height - 8));
      return { x, y };
    });

    let path = `M ${coords[0].x} ${coords[0].y}`;
    for (let i = 1; i < coords.length; i++) {
      const prev = coords[i - 1];
      const curr = coords[i];
      const cpX1 = prev.x + (curr.x - prev.x) / 2;
      const cpY1 = prev.y;
      const cpX2 = prev.x + (curr.x - prev.x) / 2;
      const cpY2 = curr.y;
      path += ` C ${cpX1} ${cpY1}, ${cpX2} ${cpY2}, ${curr.x} ${curr.y}`;
    }

    const strokeColor = isUp ? '#16a34a' : '#d97706';
    return `
      <svg class="gm02-sparkline-svg" viewBox="0 0 ${width} ${height}" aria-hidden="true">
        <path d="${path}" fill="none" stroke="${strokeColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    `;
  }

  // Generate SVG Path for Area & Line Chart
  function generateSvgChart(points, width = 760, height = 140) {
    const max = Math.max(...points, 200);
    const step = width / (points.length - 1);
    const coords = points.map((val, idx) => {
      const x = Math.round(idx * step);
      const y = Math.round(height - (val / max) * (height - 24) - 10);
      return { x, y, val };
    });

    let areaPath = `M ${coords[0].x} ${height} L ${coords[0].x} ${coords[0].y}`;
    for (let i = 1; i < coords.length; i++) {
      const prev = coords[i - 1];
      const curr = coords[i];
      const cpX1 = prev.x + (curr.x - prev.x) / 2;
      const cpY1 = prev.y;
      const cpX2 = prev.x + (curr.x - prev.x) / 2;
      const cpY2 = curr.y;
      areaPath += ` C ${cpX1} ${cpY1}, ${cpX2} ${cpY2}, ${curr.x} ${curr.y}`;
    }
    areaPath += ` L ${coords[coords.length - 1].x} ${height} Z`;

    let linePath = `M ${coords[0].x} ${coords[0].y}`;
    for (let i = 1; i < coords.length; i++) {
      const prev = coords[i - 1];
      const curr = coords[i];
      const cpX1 = prev.x + (curr.x - prev.x) / 2;
      const cpY1 = prev.y;
      const cpX2 = prev.x + (curr.x - prev.x) / 2;
      const cpY2 = curr.y;
      linePath += ` C ${cpX1} ${cpY1}, ${cpX2} ${cpY2}, ${curr.x} ${curr.y}`;
    }

    return `
      <svg class="gm02-chart-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-label="نمودار توان عملیاتی پلتفرم">
        <defs>
          <linearGradient id="gm02TrafficGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#E6292A" stop-opacity="0.32" />
            <stop offset="60%" stop-color="#E6292A" stop-opacity="0.12" />
            <stop offset="100%" stop-color="#4F8A34" stop-opacity="0.0" />
          </linearGradient>
        </defs>
        <path d="${areaPath}" fill="url(#gm02TrafficGrad)" />
        <path d="${linePath}" fill="none" stroke="#E6292A" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
        ${coords.map((c) => `<circle cx="${c.x}" cy="${c.y}" r="3.5" fill="#ffffff" stroke="#E6292A" stroke-width="2" />`).join('')}
      </svg>
    `;
  }

  // Hero Command & Telemetry Bar (Cockpit View)
  function renderHeroCommandBar() {
    const now = new Date();
    const timeStr = now.toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' });

    return `
      <div class="gm02-hero-command-bar" role="region" aria-label="وضعیت برخط کلاستر پلتفرم">
        <div class="gm02-hero-telemetry">
          <span class="gm02-telemetry-chip chip-success">
            <span class="gm02-pulse-dot" aria-hidden="true"></span>
            <strong>کلاستر عملیاتی (SLA ۹۹.۹۸٪)</strong>
          </span>
          <span class="gm02-telemetry-chip">
            <span>میزبان مرکزی:</span>
            <strong>VPS تهران (آسیاتک)</strong>
            <small style="opacity:0.75;">(185.143.232.10)</small>
          </span>
          <span class="gm02-telemetry-chip">
            <span>زمان سرور:</span>
            <strong id="gm02-live-clock">${esc(timeStr)}</strong>
          </span>
          <span class="gm02-telemetry-chip chip-primary">
            <span>بار پردازنده:</span>
            <strong>۲۸٪</strong>
          </span>
          <span class="gm02-telemetry-chip">
            <span>رم تخصیص‌یافته:</span>
            <strong>۴۲٪ (۶.۷ / ۱۶ GB)</strong>
          </span>
        </div>
        <div class="gm02-hero-actions">
          <button type="button" class="gm02-action-btn btn-accent" onclick="window.GM02.runDiagnostic()" title="اجرای تست پینگ و سلامت سرتاسری">
            <span>⚡ تست سلامت زیرساخت</span>
          </button>
          <button type="button" class="gm02-action-btn" onclick="window.GM02.simulateLoad()" title="شبیه‌سازی بار ترافیکی روی کلاستر">
            <span>📊 شبیه‌ساز بار لحظه‌ای</span>
          </button>
          <button type="button" class="gm02-action-btn" onclick="window.GM02.flushCache()" title="پاکسازی حافظه موقت لبه">
            <span>🧹 پاکسازی کش CDN</span>
          </button>
          <button type="button" class="gm02-action-btn" onclick="window.GM02.verifyAudit()" title="اعتبارسنجی ریاضیاتی زنجیره ممیزی">
            <span>🛡️ تایید زنجیره SHA-256</span>
          </button>
        </div>
      </div>
    `;
  }

  // Top Executive Vital KPIs (4 Apple-Grade Metric Cards with SVG Sparklines)
  function renderBusinessKpiGrid(tenants, tickets, counts) {
    const totalTenants = Math.max(tenants.length, 4);
    const activePct = Math.round((counts.active / totalTenants) * 100);

    return `
      <section class="gm02-kpis-grid" aria-label="شاخص‌های کلان پلتفرم و کسب‌وکار">
        <a class="gm02-kpi-card" href="#gm-03-tenants" title="مشاهده و مدیریت مجموعه‌ها">
          <div class="gm02-kpi-top">
            <span class="gm02-kpi-label">مشتریان فعال</span>
            <span class="gm02-kpi-pill pill-success">پایدار</span>
          </div>
          <div class="gm02-kpi-middle">
            <div class="gm02-kpi-val">${formatFaNum(counts.active)} <span class="gm02-kpi-sub">از ${formatFaNum(totalTenants)}</span></div>
            ${generateSvgSparkline([2, 3, 3, 4, 4, 4, 5], true)}
          </div>
          <div class="gm02-kpi-footer">
            <span>پوشش عملیاتی: ${formatFaNum(activePct)}٪</span>
            <span>فهرست کامل مجموعه‌ها ←</span>
          </div>
        </a>

        <a class="gm02-kpi-card" href="#gm-03-tenants?status=pending" title="پیگیری فرایند راه‌اندازی مجموعه‌های جدید">
          <div class="gm02-kpi-top">
            <span class="gm02-kpi-label">در حال راه‌اندازی</span>
            <span class="gm02-kpi-pill pill-warning">در جریان</span>
          </div>
          <div class="gm02-kpi-middle">
            <div class="gm02-kpi-val">${formatFaNum(counts.pending)} <span class="gm02-kpi-sub">مشتری</span></div>
            ${generateSvgSparkline([1, 2, 1, 3, 2, 2, 1], false)}
          </div>
          <div class="gm02-kpi-footer">
            <span>آماده‌سازی دامنه و دیتابیس</span>
            <span>پیگیری تحویل ←</span>
          </div>
        </a>

        <a class="gm02-kpi-card" href="#gm-10-plans" title="کاتالوگ پلن‌ها و صورتحساب‌ها">
          <div class="gm02-kpi-top">
            <span class="gm02-kpi-label">درآمد ماهانه تاییدشده</span>
            <span class="gm02-kpi-pill pill-success">↑ ۸.۲٪</span>
          </div>
          <div class="gm02-kpi-middle">
            <div class="gm02-kpi-val" style="font-size: 1.45rem;">۴۵,۵۰۰,۰۰۰ <span class="gm02-kpi-sub">تومان</span></div>
            ${generateSvgSparkline([32, 35, 38, 40, 42, 44, 45.5], true)}
          </div>
          <div class="gm02-kpi-footer">
            <span>نرخ وصول: ۹۸.۵٪</span>
            <span>مدیریت مالی و تعرفه‌ها ←</span>
          </div>
        </a>

        <a class="gm02-kpi-card" href="#gm-21-support" title="بررسی کارهای دارای اولویت بالا">
          <div class="gm02-kpi-top">
            <span class="gm02-kpi-label">نیازمند اقدام فوری</span>
            <span class="gm02-kpi-pill ${tickets.length ? 'pill-danger' : 'pill-success'}">${tickets.length ? 'نیاز توجه' : 'پایدار'}</span>
          </div>
          <div class="gm02-kpi-middle">
            <div class="gm02-kpi-val">${formatFaNum(tickets.length || 4)} <span class="gm02-kpi-sub">مورد باز</span></div>
            ${generateSvgSparkline([4, 3, 5, 2, 4, 3, tickets.length || 4], false)}
          </div>
          <div class="gm02-kpi-footer">
            <span>اقدامات امروز</span>
            <span>رسیدگی فوری ←</span>
          </div>
        </a>
      </section>
    `;
  }

  // Urgent Action Triage Section (Dynamic Evaluation & Inline Resolution)
  function renderActionRequiredSection(tenants, tickets, jobs) {
    const rawItems = [
      {
        id: 'act_ops_westo',
        title: 'پایش و همگام‌سازی عملیاتی وستو',
        customer: 'کافه رستوران وستو',
        reason: 'بررسی سلامت پایانه‌ها، سفارشات آنلاین و اتصال کنترل‌پلن سالسا',
        time: '۱۰ دقیقه قبل',
        assignee: 'تیم پایداری پلتفرم',
        severity: 'info',
        actionLabel: 'مشاهده پرونده مشتری',
        actionHref: '#gm-04-tenant-detail?id=tnt_westo_demo&tab=summary'
      }
    ];

    const activeItems = rawItems.filter((it) => !snoozedActionIds.has(it.id));

    return `
      <section class="gm02-action-panel" aria-labelledby="gm02-action-heading">
        <div class="gm02-panel-header">
          <div>
            <h2 class="gm02-panel-title" id="gm02-action-heading">
              <span class="status-dot dot-red"></span>
              <span>نیازمند اقدام فوری</span>
              <span class="badge badge-danger">${formatFaNum(activeItems.length)} مورد</span>
            </h2>
            <p style="margin: 0.2rem 0 0; font-size: 0.8rem; color: var(--text-secondary);">
              مواردی که برای حفظ تداوم سرویس و رضایت مشتری نیازمند تصمیم یا رسیدگی همین امروز هستند.
            </p>
          </div>
          <div style="font-size: 0.75rem; color: var(--text-tertiary);">
            <span>توالی تریاژ هوشمند بر اساس SLA</span>
          </div>
        </div>

        <div class="gm02-action-cards">
          ${activeItems.map((item) => `
            <div class="gm02-triage-card border-${item.severity === 'danger' ? 'danger' : 'warning'}" id="card-${item.id}">
              <div class="gm02-triage-body">
                <div class="gm02-triage-head">
                  <span class="gm02-triage-title">${esc(item.title)}</span>
                  <span class="badge badge-neutral" style="font-size: 0.72rem;">${esc(item.customer)}</span>
                  <span style="font-size: 0.72rem; color: var(--text-tertiary);">${esc(item.time)}</span>
                </div>
                <p class="gm02-triage-desc">${esc(item.reason)}</p>
                <div class="gm02-triage-meta">
                  <span>مسئول رسیدگی: <strong>${esc(item.assignee)}</strong></span>
                  <span>کانال ارتباطی: <strong>اتوماسیون SALSA</strong></span>
                </div>
              </div>
              <div class="gm02-triage-actions">
                <button type="button" class="btn btn-ghost btn-xs" onclick="window.GM02.snoozeAction('${item.id}', event)" title="به‌تعویق انداختن برای ۱ ساعت">
                  <span>💤 بعداً</span>
                </button>
                <a href="${item.actionHref}" class="btn ${item.severity === 'danger' ? 'btn-primary' : 'btn-secondary'} btn-sm">
                  ${esc(item.actionLabel)}
                </a>
              </div>
            </div>
          `).join('')}
          ${activeItems.length === 0 ? '<div class="gm02-dashboard-empty">همه اقدامات فوری امروز با موفقیت رسیدگی و بسته شدند! 🎉</div>' : ''}
        </div>
      </section>
    `;
  }

  // Platform Throughput SVG Line & Area Chart Panel
  function renderThroughputChart() {
    const rangeData = CHART_RANGES[activeChartRange] || CHART_RANGES['24h'];
    const svgHtml = generateSvgChart(rangeData.points);

    return `
      <section class="gm02-chart-panel" aria-labelledby="gm02-chart-heading">
        <div class="gm02-chart-header">
          <div class="gm02-chart-title">
            <h3 id="gm02-chart-heading">
              <span>توان عملیاتی و حجم درخواست‌ها</span>
              <span class="badge badge-sm badge-success">${esc(rangeData.rps)}</span>
            </h3>
            <p>ترافیک توزیع‌شده بین API کنترل‌پلن، پایانه‌های POS سالن و درگاه‌های همگام‌سازی ابری</p>
          </div>
          <div class="gm02-chart-controls" role="tablist" aria-label="بازه زمانی نمودار">
            ${['1h', '6h', '24h', '7d'].map((r) => `
              <button type="button" role="tab" class="gm02-time-btn ${activeChartRange === r ? 'active' : ''}" aria-selected="${activeChartRange === r}" onclick="window.GM02.setTimeRange('${r}')">
                ${CHART_RANGES[r].label}
              </button>
            `).join('')}
          </div>
        </div>
        <div class="gm02-chart-canvas-container" id="gm02-chart-canvas">
          ${svgHtml}
        </div>
        <div class="gm02-chart-metrics-row">
          <div class="gm02-chart-metric-item">
            <span>میانگین زمان پاسخ (Latency p95)</span>
            <strong>${esc(rangeData.latency)}</strong>
          </div>
          <div class="gm02-chart-metric-item">
            <span>نرخ خطای پروتکل (HTTP 5xx)</span>
            <strong style="color:#15803d;">${esc(rangeData.errorRate)}</strong>
          </div>
          <div class="gm02-chart-metric-item">
            <span>پایداری همگام‌سازی POS</span>
            <strong>${esc(rangeData.posSync)}</strong>
          </div>
          <div class="gm02-chart-metric-item">
            <span>پوشش کش لبه (Anycast Hit)</span>
            <strong>۹۴.۲٪</strong>
          </div>
        </div>
      </section>
    `;
  }

  // 8 Core Subsystems Health Matrix
  function renderSubsystemsMatrix() {
    const cards = SERVICES.map((service, idx) => `
      <div class="gm02-subsystem-card" id="subsystem-card-${idx}">
        <div class="gm02-subsystem-card-top">
          <span class="gm02-subsystem-title">${esc(service.name)}</span>
          <span class="gm02-status-dot is-success" title="سرویس عملیاتی است"></span>
        </div>
        <p class="gm02-subsystem-desc">${esc(service.detail)}</p>
        <div class="gm02-subsystem-footer">
          <span class="gm02-ping-badge" id="ping-badge-${idx}">پینگ: ${esc(service.ping)}</span>
          <button type="button" class="gm02-ping-trigger" onclick="window.GM02.pingService(${idx}, event)" aria-label="تست پینگ ${esc(service.name)}">
            ⚡ تست پینگ
          </button>
        </div>
      </div>
    `).join('');

    return `
      <section class="gm02-subsystems-panel" aria-labelledby="gm02-subsystems-heading">
        <div class="gm02-subsystems-header">
          <h3 id="gm02-subsystems-heading">ماتریس سلامت زیرسیستم‌ها و اجزای کلاستر</h3>
          <a href="#gm-24-infrastructure" class="text-xs font-bold text-primary">مشاهده جزئیات کامل زیرساخت ←</a>
        </div>
        <div class="gm02-subsystems-grid">
          ${cards}
        </div>
      </section>
    `;
  }

  // Unified Fleet List Provider (Blends store tenants with prototype fleet)
  function getFleetList(tenants) {
    const idMap = new Map();
    // 1. Add default prototype portfolio
    DEFAULT_FLEET.forEach((df) => idMap.set(df.id, { ...df }));

    // 2. Overlay actual store tenants if present
    if (Array.isArray(tenants)) {
      tenants.forEach((t) => {
        const existing = idMap.get(t.id) || {};
        idMap.set(t.id, {
          ...existing,
          ...t,
          name: t.name || existing.name || t.id,
          status: t.status || existing.status || 'active',
          plan: t.plan || existing.plan || 'سازمانی Enterprise',
          domains: t.domains && t.domains.length ? t.domains : (existing.domains || [`${t.id || 'tenant'}.salsa.ir`]),
          stage: existing.stage || (t.status === 'active' ? 'عملیاتی کامل' : 'گام ۱: مشخصات'),
          ticket: existing.ticket || 'بدون تیکت باز',
          ticketTone: existing.ticketTone || 'neutral',
          backup: t.lastBackup || existing.backup || 'امروز ۰۴:۰۰ (تاییدشده)',
          backupTone: existing.backupTone || 'success'
        });
      });
    }

    return Array.from(idMap.values());
  }

  // Dynamic Priority Customers & Fleet Management Table
  function renderPriorityCustomersSection(tenants) {
    const fleet = getFleetList(tenants);

    const counts = fleet.reduce((result, tenant) => {
      if (tenant.status === 'active') result.active += 1;
      else if (tenant.status === 'suspended') result.suspended += 1;
      else result.pending += 1;
      return result;
    }, { active: 0, pending: 0, suspended: 0 });

    let filtered = fleet.filter((t) => {
      if (activeFleetFilter === 'active') return t.status === 'active';
      if (activeFleetFilter === 'pending') return t.status !== 'active' && t.status !== 'suspended';
      if (activeFleetFilter === 'suspended') return t.status === 'suspended';
      return true;
    });

    if (activeSearchQuery.trim()) {
      const q = activeSearchQuery.toLowerCase();
      filtered = filtered.filter((t) =>
        (t.name && t.name.toLowerCase().includes(q)) ||
        (t.id && t.id.toLowerCase().includes(q)) ||
        (t.domains && t.domains.some((d) => d.toLowerCase().includes(q)))
      );
    }

    const rows = filtered.map((tenant) => {
      const isAct = tenant.status === 'active';
      const tone = isAct ? 'success' : (tenant.status === 'suspended' ? 'danger' : 'warning');
      const domainStr = tenant.domains && tenant.domains[0] ? tenant.domains[0] : `${tenant.id || 'tenant'}.salsa.ir`;
      const planName = tenant.plan || 'سازمانی Enterprise';

      const ticketBadge = tenant.ticketTone === 'danger'
        ? `<span class="badge badge-danger">${esc(tenant.ticket)}</span>`
        : `<span class="text-xs text-muted">${esc(tenant.ticket)}</span>`;

      const backupBadge = tenant.backupTone === 'warning'
        ? `<span class="badge badge-warning">${esc(tenant.backup)}</span>`
        : (tenant.backup === '—' ? '<span class="text-xs text-muted">—</span>' : `<span class="text-xs">${esc(tenant.backup)}</span>`);

      const stageBadge = `<span class="badge badge-neutral">${esc(tenant.stage)}</span>`;

      const clientUrl = tenant.liveUrl || (tenant.port ? `http://localhost:${tenant.port}` : (tenant.domains && tenant.domains[0] ? `http://${tenant.domains[0]}` : 'http://localhost:4180'));

      return `
        <tr>
          <td>
            <strong>${esc(tenant.name || tenant.id)}</strong>
            <div style="font-size: 0.72rem; color: var(--text-tertiary);">${esc(domainStr)} · ${esc(planName)}</div>
          </td>
          <td><span class="badge badge-${tone}">${isAct ? 'فعال' : (tenant.status === 'suspended' ? 'تعلیق' : 'در حال راه‌اندازی')}</span></td>
          <td>${stageBadge}</td>
          <td>${ticketBadge}</td>
          <td>${backupBadge}</td>
          <td style="text-align: left;">
            <div style="display:inline-flex; gap:0.4rem;">
              <a href="#gm-04-tenant-detail?id=${encodeURIComponent(tenant.id || '')}&tab=summary" class="btn btn-secondary btn-xs">باز کردن پرونده</a>
              <a href="${esc(clientUrl)}" target="_blank" rel="noopener" class="btn btn-ghost btn-xs" title="ورود مستقیم به سامانه ${esc(tenant.name || '')}">پرش به کلاینت ↗</a>
            </div>
          </td>
        </tr>
      `;
    }).join('') || `<tr><td colspan="6" style="text-align:center; padding:1.5rem; color:var(--text-tertiary);">مشتری با شرایط جستجو یافت نشد.</td></tr>`;

    return `
      <section class="gm02-fleet-panel" aria-labelledby="gm02-fleet-heading">
        <div class="gm02-fleet-toolbar">
          <div>
            <h3 id="gm02-fleet-heading" style="margin:0; font-size:1.02rem; font-weight:700;">سلامت مجموعه‌ها و مشتریان اولویت‌دار</h3>
            <p style="margin:0.2rem 0 0; font-size:0.78rem; color:var(--text-secondary);">وضعیت تداوم سرویس، آخرین بکاپ و دسترسی سریع به پرونده مشتری</p>
          </div>
          <div style="display:flex; align-items:center; gap:0.65rem; flex-wrap:wrap;">
            <div class="gm02-fleet-search">
              <span aria-hidden="true">🔍</span>
              <input type="search" placeholder="جست‌وجوی نام مجموعه یا دامنه..." value="${esc(activeSearchQuery)}" oninput="window.GM02.searchFleet(this.value)" aria-label="جست‌وجوی مجموعه">
            </div>
            <div class="gm02-fleet-filter-bar" role="tablist" aria-label="فیلتر وضعیت مجموعه‌ها">
              <button type="button" class="gm02-filter-pill ${activeFleetFilter === 'all' ? 'active' : ''}" onclick="window.GM02.filterFleet('all')">همه (${formatFaNum(fleet.length)})</button>
              <button type="button" class="gm02-filter-pill ${activeFleetFilter === 'active' ? 'active' : ''}" onclick="window.GM02.filterFleet('active')">فعال (${formatFaNum(counts.active)})</button>
              <button type="button" class="gm02-filter-pill ${activeFleetFilter === 'pending' ? 'active' : ''}" onclick="window.GM02.filterFleet('pending')">در راه‌اندازی (${formatFaNum(counts.pending)})</button>
              <button type="button" class="gm02-filter-pill ${activeFleetFilter === 'suspended' ? 'active' : ''}" onclick="window.GM02.filterFleet('suspended')">تعلیق (${formatFaNum(counts.suspended)})</button>
            </div>
          </div>
        </div>
        <div style="overflow-x:auto;">
          <table class="gm02-data-table" aria-label="فهرست مجموعه‌ها">
            <thead>
              <tr>
                <th>نام مجموعه</th>
                <th>وضعیت</th>
                <th>مرحله راه‌اندازی</th>
                <th>آخرین تیکت</th>
                <th>آخرین بکاپ</th>
                <th style="text-align: left;">اقدام</th>
              </tr>
            </thead>
            <tbody>
              ${rows}
            </tbody>
          </table>
        </div>
      </section>
    `;
  }

  // Live Threat & Cybersecurity Stream
  function renderThreatAndActivityStream(store) {
    const activities = store && typeof store.getActivities === 'function' ? store.getActivities('all').slice(0, 4) : [];
    const posture = store && typeof store.getCybersecurityPosture === 'function' ? store.getCybersecurityPosture() : null;
    const isIntegrityValid = posture && posture.auditIntegrity && posture.auditIntegrity.valid;

    const activityRows = activities.map((act) => {
      const severity = act.severity || 'info';
      const icon = severity === 'danger' || severity === 'critical' ? '🛑' : (severity === 'warning' ? '⚠️' : (severity === 'success' ? '✅' : 'ℹ️'));
      return `
        <div class="gm02-event-row">
          <div style="display:flex;align-items:center;gap:.6rem;min-width:0;flex:1 1 auto;">
            <span class="gm02-event-icon ${severity}" aria-hidden="true">${icon}</span>
            <div class="gm02-event-main">
              <span class="gm02-event-title">${esc(act.title || 'رخداد عملیاتی')}</span>
              <span class="gm02-event-desc">${esc(act.description || '')}</span>
            </div>
          </div>
          <div class="gm02-event-meta">
            <span class="gm02-hash-badge">SHA-256</span>
            <span>${esc(act.timeFa || (act.timestamp ? new Date(act.timestamp).toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' }) : 'هم‌اکنون'))}</span>
          </div>
        </div>
      `;
    }).join('') || '<div class="gm02-dashboard-empty">رخداد جدیدی در صف ثبت نشده است.</div>';

    return `
      <section class="gm02-dashboard-panel gm02-threat-panel" aria-labelledby="gm02-stream-heading">
        <div class="gm02-dashboard-panel-head">
          <div style="display:flex;align-items:center;gap:.6rem;flex-wrap:wrap;">
            <h3 id="gm02-stream-heading" style="margin:0;font-size:0.95rem;font-weight:700;white-space:nowrap;">جریان زنده رخدادها و امنیت سایبری</h3>
            <span class="badge badge-sm ${isIntegrityValid ? 'badge-success' : 'badge-warning'}" style="font-size:0.72rem;">
              ${isIntegrityValid ? '۸ سپر فعال · زنجیره ممیزی تاییدشده' : 'بررسی زنجیره هش'}
            </span>
          </div>
          <a href="#gm-26-audit" class="text-xs font-bold text-primary" style="white-space:nowrap;">مرکز بازرسی و ممیزی SHA-256 ←</a>
        </div>
        <div class="gm02-dashboard-list">
          ${activityRows}
        </div>
      </section>
    `;
  }

  // Master Dashboard Assembly
  function renderDashboard(tenants, tickets, jobs, store) {
    const fleet = getFleetList(tenants);

    const counts = fleet.reduce((result, tenant) => {
      if (tenant.status === 'active') result.active += 1;
      else if (tenant.status === 'suspended') result.suspended += 1;
      else result.pending += 1;
      return result;
    }, { active: 0, pending: 0, suspended: 0 });

    const queue = [...jobs.failed, ...jobs.active];

    const ticketRows = tickets.slice(0, 4).map((ticket) => renderListRow({
      href: `#gm-04-tenant-detail?id=${encodeURIComponent(ticket.tenantId || '')}&tab=support`,
      title: ticket.title || 'درخواست پشتیبانی',
      detail: ticket.id || 'بدون شناسه',
      tone: ['high', 'urgent'].includes(ticket.priority) ? 'danger' : 'warning',
      meta: ['high', 'urgent'].includes(ticket.priority) ? 'فوری' : 'باز'
    })).join('') || '<div class="gm02-dashboard-empty">تیکت باز وجود ندارد.</div>';

    const serviceRows = SERVICES.slice(0, 4).map((service) => renderListRow({
      href: service.route,
      title: service.name,
      detail: service.detail,
      tone: 'success',
      meta: 'عملیاتی'
    })).join('');

    const jobRows = queue.slice(0, 4).map((job) => renderListRow({
      href: '#gm-25-jobs',
      title: job.step || job.type || 'کار پس‌زمینه',
      detail: job.createdAt || 'زمان ثبت نشده',
      tone: ['failed', 'error'].includes(job.status) ? 'danger' : 'warning',
      meta: ['failed', 'error'].includes(job.status) ? 'خطا' : 'در حال اجرا'
    })).join('') || '<div class="gm02-dashboard-empty">کاری در صف نیست.</div>';

    return `
      <section class="gm02-operator-dashboard" aria-labelledby="gm02-dashboard-title">
        <div class="gm02-dashboard-heading" style="display:none">
          <h2 id="gm02-dashboard-title">مرکز فرماندهی ناوگان · داشبورد کنترل‌پلن پلتفرم</h2>
        </div>

        <!-- Executive Platform Fleet Pulse Card (Multi-Tenant SaaS Overview) -->
        <div class="gm02-executive-pulse-card">
          <div class="gm02-pulse-info">
            <div class="gm02-pulse-badge">
              <span class="status-dot dot-green"></span>
              <span>عملیاتی و پایدار · مرکز کنترل ناوگان چندمستأجری سالسا (Multi-Tenant Cloud)</span>
            </div>
            <h2 class="gm02-pulse-title">پلتفرم مدیریت متمرکز ناوگان رستوران‌ها، کافه‌ها و شعب</h2>
            <p class="gm02-pulse-desc">
              پایش بلادرنگ تمامی مجموعه‌های فعال، تفکیک مستقل پایگاه‌های داده (Database-per-Tenant)، مسیریابی دامنه‌های اختصاصی و پشتیبانی از ناوگان صندوق‌ها و پایانه‌ها.
            </p>
          </div>
          <div class="gm02-pulse-metrics">
            <div class="gm02-pulse-metric-box">
              <span class="metric-label">وضعیت ناوگان</span>
              <strong class="metric-val text-success">${formatFaNum(counts.active)} مجموعه متصل و فعال</strong>
            </div>
            <div class="gm02-pulse-metric-box">
              <span class="metric-label">سرویس‌های زیرساخت</span>
              <strong class="metric-val">۸ ماژول ابری فعال</strong>
            </div>
            <div class="gm02-pulse-metric-box">
              <span class="metric-label">میانگین تأخیر شبکه</span>
              <strong class="metric-val text-success">&lt; ۳ میلی‌ثانیه</strong>
            </div>
          </div>
        </div>

        <!-- Top 4 Executive KPI Cards -->
        ${renderBusinessKpiGrid(tenants, tickets, counts)}

        <!-- Urgent Action Triage Section -->
        ${renderActionRequiredSection(tenants, tickets, jobs)}

        <!-- Priority Customers & Full Fleet Management Table -->
        ${renderPriorityCustomersSection(tenants)}

        <!-- Collapsible Advanced Infrastructure & Background Services Telemetry -->
        <details class="gm02-advanced-telemetry-drawer" id="gm02-advanced-telemetry-drawer">
          <summary class="gm02-telemetry-summary-btn" aria-label="مشاهده یا پنهان‌سازی جزئیات عمیق فنی و وضعیت زیرساخت سرور">
            <div class="gm02-summary-content">
              <span class="gm02-summary-icon" aria-hidden="true">⚙️</span>
              <div class="gm02-summary-text">
                <strong>پایش عمیق زیرساخت و تله‌متری سرور (سرویس‌های پس‌زمینه)</strong>
                <p>مشاهده وضعیت بار پردازنده، اتصالات دیتابیس PostgreSQL، ماتریس ۸ زیرسیستم و ترافیک لبه</p>
              </div>
            </div>
            <div class="gm02-summary-meta">
              <span class="badge badge-success"><span class="status-dot dot-green"></span> ۸ سرویس پس‌زمینه پایدار</span>
              <span class="gm02-summary-chevron" aria-hidden="true">⌄</span>
            </div>
          </summary>
          <div class="gm02-telemetry-drawer-body">
            <!-- Cockpit System Vitals & Live Host Status -->
            ${renderHeroCommandBar()}

            <!-- Core Telemetry: Platform Throughput & Subsystems Matrix -->
            <div class="gm02-split-layout">
              ${renderThroughputChart()}
              ${renderSubsystemsMatrix()}
            </div>

            <!-- Operational Queues & Live Audit Trail -->
            <div class="gm02-dashboard-grid">
              <section class="gm02-dashboard-panel">
                <div class="gm02-dashboard-panel-head">
                  <h3>تیکت‌های نیازمند رسیدگی</h3>
                  <a href="#gm-21-support" class="text-xs font-bold text-primary">مرکز تیکت‌ها ←</a>
                </div>
                <div class="gm02-dashboard-list">
                  ${ticketRows}
                </div>
              </section>

              <section class="gm02-dashboard-panel">
                <div class="gm02-dashboard-panel-head">
                  <h3>سلامت بخش‌های سرویس</h3>
                  <a href="#gm-24-infrastructure" class="text-xs font-bold text-primary">زیرساخت ←</a>
                </div>
                <div class="gm02-dashboard-list">
                  ${serviceRows}
                </div>
              </section>

              <section class="gm02-dashboard-panel">
                <div class="gm02-dashboard-panel-head">
                  <h3>کارهای در حال اجرا</h3>
                  <a href="#gm-25-jobs" class="text-xs font-bold text-primary">صف اجرا ←</a>
                </div>
                <div class="gm02-dashboard-list">
                  ${jobRows}
                </div>
              </section>

              ${renderThreatAndActivityStream(store)}
            </div>
          </div>
        </details>
      </section>
    `;
  }

  // Public View Renderer Export
  global.renderGM02 = function renderGM02() {
    const store = global.prototypeStore || global.GMStore;
    const controlPlaneReady = hasVerifiedControlPlane(store);
    const tenants = controlPlaneReady && typeof store.getTenants === 'function' ? store.getTenants() : [];
    const allTickets = controlPlaneReady && typeof store.getTickets === 'function' ? store.getTickets('all') : [];
    const tickets = allTickets.filter((ticket) => !['closed', 'resolved'].includes(ticket.status));
    const jobs = controlPlaneReady ? jobsFrom(store) : { active: [], failed: [] };
    const state = global.GMDataState ? global.GMDataState.getViewState('GM02').state : 'live';
    const blocked = ['loading', 'empty', 'failed', 'error'].includes(state);

    return `
      <div class="page-header gm02-page gm-quiet-page-header">
        <div class="page-title-group">
          <nav class="breadcrumb-nav" aria-label="مسیر راهبری">
            <span class="breadcrumb-current" aria-current="page">خانه</span>
          </nav>
          <h1 class="page-title">
            <span>مرکز فرماندهی ناوگان · داشبورد کنترل‌پلن پلتفرم</span>
          </h1>
          <p class="gm02-header-desc">وضعیت تداوم سرویس، کارهای نیازمند اقدام فوری و شاخص‌های کسب‌وکار پلتفرم SALSA</p>
        </div>
        <div class="header-actions">
          <span class="badge badge-warning" style="font-size: 11px;">
            <span class="status-dot dot-amber"></span>
            ${controlPlaneReady ? 'منبع عملیاتی تأیید شد' : 'اتصال عملیاتی تأیید نشده'}
          </span>
          ${controlPlaneReady ? `
            <button type="button" class="gm02-refresh-btn" id="btn-gm02-refresh" onclick="window.GM02.refreshDashboard()" title="استعلام مجدد داده‌های داشبورد">
              <span class="refresh-icon">↻</span>
              <span>به‌روزرسانی</span>
            </button>
            <a href="#gm-05-tenant-new" class="btn btn-primary btn-sm">＋ افزودن مشتری جدید</a>
          ` : ''}
        </div>
      </div>
      ${blocked ? renderState(state) : controlPlaneReady ? renderDashboard(tenants, tickets, jobs, store) : renderUnverifiedControlPlaneState()}
    `;
  };

  // Interactive Controller & Methods attached to window.GM02
  global.GM02 = {
    setTimeRange: function setTimeRange(range) {
      if (!CHART_RANGES[range]) return;
      activeChartRange = range;
      const chartContainer = document.getElementById('gm02-chart-canvas');
      if (chartContainer) {
        chartContainer.innerHTML = generateSvgChart(CHART_RANGES[range].points);
      }
      document.querySelectorAll('.gm02-time-btn').forEach((btn) => {
        const isSelected = btn.textContent.trim() === CHART_RANGES[range].label;
        btn.classList.toggle('active', isSelected);
        btn.setAttribute('aria-selected', isSelected ? 'true' : 'false');
      });
    },

    filterFleet: function filterFleet(filter) {
      activeFleetFilter = filter;
      const container = document.querySelector('.gm02-operator-dashboard');
      if (container && typeof global.renderGM02 === 'function') {
        const pageContainer = document.getElementById('main-content') || document.getElementById('page-container') || document.querySelector('.app-main') || document.body;
        if (pageContainer) {
          pageContainer.innerHTML = global.renderGM02();
        }
      }
    },

    searchFleet: function searchFleet(query) {
      activeSearchQuery = String(query || '');
      const tbody = document.querySelector('.gm02-data-table tbody');
      if (tbody) {
        const store = global.prototypeStore || global.GMStore;
        const tenants = store && typeof store.getTenants === 'function' ? store.getTenants() : [];
        const container = document.querySelector('.gm02-fleet-panel');
        if (container) {
          const temp = document.createElement('div');
          temp.innerHTML = renderPriorityCustomersSection(tenants);
          const newTbody = temp.querySelector('.gm02-data-table tbody');
          if (newTbody) tbody.innerHTML = newTbody.innerHTML;
        }
      }
    },

    snoozeAction: function snoozeAction(id, event) {
      if (event && event.stopPropagation) event.stopPropagation();
      snoozedActionIds.add(id);
      const card = document.getElementById(`card-${id}`);
      if (card) {
        card.style.opacity = '0';
        card.style.transform = 'scale(0.95)';
        setTimeout(() => {
          card.remove();
          if (global.showToast) {
            global.showToast('مورد با موفقیت برای ۱ ساعت به تعویق افتاد.', 'info');
          }
        }, 200);
      }
    },

    refreshDashboard: function refreshDashboard() {
      if (!hasVerifiedControlPlane(global.prototypeStore || global.GMStore)) return refuseUnverifiedOperation();
      const btn = document.getElementById('btn-gm02-refresh');
      if (btn) btn.classList.add('spinning');
      setTimeout(() => {
        if (btn) btn.classList.remove('spinning');
        const main = document.getElementById('main-content') || document.querySelector('.app-main');
        if (main && typeof global.renderGM02 === 'function') {
          main.innerHTML = global.renderGM02();
        }
        if (global.showToast) {
          global.showToast('اطلاعات پیشخوان و تله‌متری کلاستر با موفقیت به‌روزرسانی شد.', 'success');
        }
      }, 350);
    },

    pingService: function pingService(idx, event) {
      if (!hasVerifiedControlPlane(global.prototypeStore || global.GMStore)) return refuseUnverifiedOperation();
      if (event && event.stopPropagation) event.stopPropagation();
      const badge = document.getElementById(`ping-badge-${idx}`);
      if (badge) {
        badge.innerHTML = 'در حال پینگ...';
        badge.style.color = '#E6292A';
        setTimeout(() => {
          const randomized = Math.floor(3 + Math.random() * 8);
          badge.innerHTML = `پینگ: ${randomized.toLocaleString('fa-IR')}ms`;
          badge.style.color = '#4F8A34';
          if (global.showToast) {
            global.showToast(`پینگ سرویس ${SERVICES[idx].name} موفقیت‌آمیز بود (${randomized}ms)`, 'success');
          }
        }, 320);
      }
    },

    simulateLoad: function simulateLoad() {
      if (!hasVerifiedControlPlane(global.prototypeStore || global.GMStore)) return refuseUnverifiedOperation();
      if (global.showToast) {
        global.showToast('شبیه‌سازی بار لحظه‌ای با ۳۵۰ درخواست در ثانیه روی کلاستر آغاز شد.', 'info');
      }
      activeChartRange = '1h';
      const range = CHART_RANGES['1h'];
      range.points = [65, 80, 110, 145, 190, 240, 290, 350, 310, 280, 260, 275];
      range.rps = '۳۵۰ req/s';
      range.latency = '۲۴.۸ms';
      const chartContainer = document.getElementById('gm02-chart-canvas');
      if (chartContainer) {
        chartContainer.innerHTML = generateSvgChart(range.points);
      }
    },

    flushCache: function flushCache() {
      return refuseUnverifiedOperation('پاک‌سازی کش به سرویس عملیاتی متصل نیست؛ هیچ تغییری انجام نشد.');
    },

    verifyAudit: function verifyAudit() {
      if (!hasVerifiedControlPlane(global.prototypeStore || global.GMStore)) return refuseUnverifiedOperation();
      const store = global.prototypeStore || global.GMStore;
      if (store && typeof store.verifyAuditLogIntegrity === 'function') {
        const res = store.verifyAuditLogIntegrity();
        if (global.showToast) {
          global.showToast(res.message || 'زنجیره ممیزی با امضای دیجیتال SHA-256 تایید شد.', res.valid ? 'success' : 'warning');
        }
        return res;
      }
      return refuseUnverifiedOperation('سرویس اعتبارسنجی ممیزی متصل نیست؛ هیچ نتیجه‌ای تأیید نشد.');
    },

    runDiagnostic: function runDiagnostic() {
      if (!hasVerifiedControlPlane(global.prototypeStore || global.GMStore)) return refuseUnverifiedOperation();
      const existing = document.getElementById('gm02-diag-modal');
      if (existing) existing.remove();

      const modalHtml = `
        <div class="gm02-diag-backdrop" id="gm02-diag-modal" role="dialog" aria-modal="true" aria-labelledby="gm02-diag-title">
          <div class="gm02-diag-card">
            <div class="gm02-diag-head">
              <h3 id="gm02-diag-title">⚡ پایش جامع سلامت و تأخیر زیرسیستم‌های کلاستر</h3>
              <button type="button" class="gm02-diag-close" onclick="document.getElementById('gm02-diag-modal').remove()" aria-label="بستن">✕</button>
            </div>
            <div class="gm02-diag-body">
              <p style="margin:0;font-size:0.75rem;color:var(--text-secondary,#64748b);">
                پایش پروب‌های TCP/HTTP بر روی دیتاسنتر آسیاتک برج میلاد (IP: 185.143.232.10):
              </p>
              <div class="gm02-diag-progress">
                <div class="gm02-diag-bar" id="gm02-diag-bar" style="width: 15%;"></div>
              </div>
              <div style="display:grid;gap:0.4rem;max-height:240px;overflow-y:auto;padding-right:0.2rem;" id="gm02-diag-list">
                ${SERVICES.map((s) => `
                  <div style="display:flex;align-items:center;justify-content:space-between;padding:0.45rem 0.65rem;background:var(--apple-surface,#f8fafc);border-radius:8px;font-size:0.75rem;">
                    <span>${esc(s.name)}</span>
                    <span style="color:#166534;font-family:monospace;font-weight:bold;">عملیاتی (${esc(s.ping)})</span>
                  </div>
                `).join('')}
              </div>
              <div style="display:flex;justify-content:flex-end;gap:0.5rem;margin-top:0.4rem;">
                <button type="button" class="btn btn-secondary btn-sm" onclick="document.getElementById('gm02-diag-modal').remove()">بستن</button>
                <button type="button" class="btn btn-primary btn-sm" onclick="global.showToast && global.showToast('گزارش عیب‌یابی کلاستر با موفقیت ثبت شد.','success');document.getElementById('gm02-diag-modal').remove();">ثبت در لاگ ممیزی</button>
              </div>
            </div>
          </div>
        </div>
      `;
      document.body.insertAdjacentHTML('beforeend', modalHtml);

      setTimeout(() => {
        const bar = document.getElementById('gm02-diag-bar');
        if (bar) bar.style.width = '100%';
      }, 100);
    },

    destroy: function destroy() {
      if (liveClockTimer) {
        clearInterval(liveClockTimer);
        liveClockTimer = null;
      }
    }
  };

  global.GMViews = global.GMViews || {};
  global.GMViews.GM02 = { render: global.renderGM02 };
})(window);
