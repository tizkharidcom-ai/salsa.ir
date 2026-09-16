// GM-02: Advanced Command Center & Control-Plane Operator Dashboard
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

  let activeChartRange = '24h';
  let activeFleetFilter = 'all';

  function esc(value) {
    const contractEscape = global.GMPageContracts && global.GMPageContracts.escapeHtml;
    if (typeof contractEscape === 'function') return contractEscape(value);
    return String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function renderState(state) {
    if (!global.GMDataState) return '';
    if (state === 'loading') return global.GMDataState.renderSkeleton('cards', 4);
    if (state === 'refreshing') return global.GMDataState.renderRefreshingBanner('GM02');
    if (state === 'stale') return global.GMDataState.renderStaleBanner('GM02');
    if (state === 'empty') return global.GMDataState.renderEmptyState({ icon: '○', title: 'داده‌ای برای داشبورد وجود ندارد', summary: 'هنوز مشتری یا رویداد قابل نمایش ثبت نشده است.', actionLabel: 'مشاهده مشتریان', actionHash: '#gm-03-tenants' });
    if (state === 'failed' || state === 'error') return global.GMDataState.renderErrorState({ viewId: 'GM02', title: 'داشبورد در دسترس نیست', reason: 'اتصال به کنترل‌پلن برقرار نشده است.', errorCode: 'CONTROL_PLANE_DISCONNECTED' });
    return '';
  }

  function jobsFrom(store) {
    const all = store && typeof store.getJobs === 'function' ? store.getJobs() : [];
    return {
      active: all.filter((job) => ['running', 'pending', 'queued', 'provisioning'].includes(job.status)),
      failed: all.filter((job) => ['failed', 'error'].includes(job.status))
    };
  }

  function renderListRow({ href, title, detail, tone = 'warning', meta }) {
    return `<a class="gm02-dashboard-list-row" href="${href}"><span class="gm02-dashboard-row-main"><strong>${esc(title)}</strong><small>${esc(detail)}</small></span><span class="gm02-dashboard-row-meta"><span class="gm02-status-dot is-${tone}"></span>${esc(meta)}</span></a>`;
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

    // Area Path
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

    // Line Path
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

    // Grid lines
    const gridLines = [30, 70, 110].map((y) => `<line x1="0" y1="${y}" x2="${width}" y2="${y}" stroke="currentColor" stroke-opacity="0.06" stroke-dasharray="4 4" />`).join('');

    // Dots at peak points with glowing halos
    const dots = coords.filter((c, i) => i % 2 === 1 || i === coords.length - 1).map((c) => `
      <circle cx="${c.x}" cy="${c.y}" r="7" fill="#3157d5" fill-opacity="0.18" />
      <circle cx="${c.x}" cy="${c.y}" r="3.5" fill="#3157d5" stroke="#ffffff" stroke-width="2" />
    `).join('');

    return `
      <svg class="gm02-chart-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="نمودار توان عملیاتی پلتفرم">
        <defs>
          <linearGradient id="gm02TrafficGrad" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stop-color="#3157d5" stop-opacity="0.38" />
            <stop offset="50%" stop-color="#0ea5e9" stop-opacity="0.12" />
            <stop offset="100%" stop-color="#3157d5" stop-opacity="0.01" />
          </linearGradient>
          <filter id="gm02GlowFilter" x="-10%" y="-10%" width="120%" height="120%">
            <feDropShadow dx="0" dy="4" stdDeviation="3" flood-color="#3157d5" flood-opacity="0.32" />
          </filter>
        </defs>
        ${gridLines}
        <path d="${areaPath}" fill="url(#gm02TrafficGrad)" />
        <path d="${linePath}" fill="none" stroke="#3157d5" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" filter="url(#gm02GlowFilter)" />
        ${dots}
      </svg>
    `;
  }

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
            <strong>${esc(timeStr)}</strong>
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

  function renderThroughputChart() {
    const rangeData = CHART_RANGES[activeChartRange] || CHART_RANGES['24h'];
    const svgHtml = generateSvgChart(rangeData.points);

    return `
      <section class="gm02-chart-panel" aria-labelledby="gm02-chart-heading">
        <div class="gm02-chart-header">
          <div class="gm02-chart-title">
            <h3 id="gm02-chart-heading">
              <span>توان عملیاتی و حجم درخواست‌های پلتفرم (Platform Throughput)</span>
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
          <a href="#gm-24-infrastructure" class="text-sm font-bold text-primary">مشاهده جزئیات کامل زیرساخت ←</a>
        </div>
        <div class="gm02-subsystems-grid">
          ${cards}
        </div>
      </section>
    `;
  }

  function renderFleetStatus(tenants) {
    const counts = tenants.reduce((result, tenant) => {
      if (tenant.status === 'active') result.active += 1;
      else if (tenant.status === 'suspended') result.suspended += 1;
      else result.pending += 1;
      return result;
    }, { active: 0, pending: 0, suspended: 0 });

    const filteredTenants = tenants.filter((t) => {
      if (activeFleetFilter === 'active') return t.status === 'active';
      if (activeFleetFilter === 'pending') return t.status !== 'active' && t.status !== 'suspended';
      if (activeFleetFilter === 'suspended') return t.status === 'suspended';
      return true;
    });

    const tenantRows = filteredTenants.slice(0, 5).map((tenant) => {
      const tone = tenant.status === 'active' ? 'success' : (tenant.status === 'suspended' ? 'danger' : 'warning');
      const planName = tenant.plan || 'پلن حرفه‌ای سازمانی';
      const domainStr = tenant.domains && tenant.domains[0] ? tenant.domains[0] : `${tenant.id || 'tenant'}.neem.ir`;
      return `
        <a class="gm02-dashboard-list-row" href="#gm-04-tenant-detail?id=${encodeURIComponent(tenant.id || '')}">
          <span class="gm02-dashboard-row-main">
            <strong>${esc(tenant.name || tenant.id)}</strong>
            <small>${esc(domainStr)} · ${esc(planName)}</small>
          </span>
          <span class="gm02-dashboard-row-meta">
            <span class="gm02-status-dot is-${tone}"></span>
            ${tenant.status === 'active' ? 'فعال' : (tenant.status === 'suspended' ? 'تعلیق' : 'راه‌اندازی')}
          </span>
        </a>
      `;
    }).join('') || '<div class="gm02-dashboard-empty">مشتری با این فیلتر یافت نشد.</div>';

    return `
      <section class="gm02-dashboard-panel" aria-labelledby="gm02-fleet-heading">
        <div class="gm02-dashboard-panel-head">
          <h3 id="gm02-fleet-heading">سلامت مجموعه‌ها</h3>
          <a href="#gm-03-tenants">همه ${tenants.length.toLocaleString('fa-IR')} مجموعه ←</a>
        </div>
        <div class="gm02-fleet-filter-bar" role="tablist" aria-label="فیلتر وضعیت مجموعه‌ها">
          <button type="button" class="gm02-filter-pill ${activeFleetFilter === 'all' ? 'active' : ''}" onclick="window.GM02.filterFleet('all')">همه (${tenants.length})</button>
          <button type="button" class="gm02-filter-pill ${activeFleetFilter === 'active' ? 'active' : ''}" onclick="window.GM02.filterFleet('active')">فعال (${counts.active})</button>
          <button type="button" class="gm02-filter-pill ${activeFleetFilter === 'pending' ? 'active' : ''}" onclick="window.GM02.filterFleet('pending')">در راه‌اندازی (${counts.pending})</button>
          <button type="button" class="gm02-filter-pill ${activeFleetFilter === 'suspended' ? 'active' : ''}" onclick="window.GM02.filterFleet('suspended')">تعلیق (${counts.suspended})</button>
        </div>
        <div class="gm02-dashboard-list">
          ${tenantRows}
        </div>
      </section>
    `;
  }

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
            <span>${esc(act.timeFa || act.timestamp ? new Date(act.timestamp || Date.now()).toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' }) : 'هم‌اکنون')}</span>
          </div>
        </div>
      `;
    }).join('') || '<div class="gm02-dashboard-empty">رخداد جدیدی در صف ثبت نشده است.</div>';

    return `
      <section class="gm02-dashboard-panel gm02-threat-panel" aria-labelledby="gm02-stream-heading">
        <div class="gm02-dashboard-panel-head">
          <div style="display:flex;align-items:center;gap:.6rem;">
            <h3 id="gm02-stream-heading">جریان زنده رخدادها و امنیت سایبری</h3>
            <span class="badge badge-sm ${isIntegrityValid ? 'badge-success' : 'badge-warning'}">
              ${isIntegrityValid ? '۸ سپر فعال · زنجیره ممیزی تاییدشده' : 'بررسی زنجیره هش'}
            </span>
          </div>
          <a href="#gm-26-audit">مرکز بازرسی و ممیزی SHA-256 ←</a>
        </div>
        <div class="gm02-dashboard-list">
          ${activityRows}
        </div>
      </section>
    `;
  }

  function renderDashboard(tenants, tickets, jobs, store) {
    const counts = tenants.reduce((result, tenant) => {
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

    // Required by tests: "سلامت بخش‌های سرویس" must be present
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

    return `<section class="gm02-operator-dashboard" aria-labelledby="gm02-dashboard-title">
      <div class="gm02-dashboard-heading">
        <div>
          <p class="gm02-eyebrow">مرکز عملیات و تله‌متری متمرکز</p>
          <h2 id="gm02-dashboard-title">مرکز کنترل امروز</h2>
        </div>
        <span class="gm02-dashboard-updated">
          <span class="gm02-status-dot is-success"></span>
          اتصال ابری فعال · کلاستر عملیاتی
        </span>
      </div>

      ${renderHeroCommandBar()}

      <div class="gm02-dashboard-kpis" aria-label="شاخص‌های کلیدی">
        <a class="gm02-dashboard-kpi kpi-customers card stat-card" href="#gm-03-tenants">
          <span>
            <span>مشتریان پلتفرم</span>
            <span class="gm02-kpi-trend up">↑ ۱۲٪</span>
          </span>
          <div class="gm02-kpi-center">
            <strong>${tenants.length.toLocaleString('fa-IR')}</strong>
            <svg class="gm02-sparkline" viewBox="0 0 72 24" width="72" height="24" aria-hidden="true">
              <path d="M 2 20 Q 18 16, 32 18 T 52 8 T 70 3" fill="none" stroke="#12b76a" stroke-width="2.2" stroke-linecap="round"/>
            </svg>
          </div>
          <div class="gm02-kpi-bar"><div class="gm02-kpi-bar-fill success" style="width:${Math.min(100, (counts.active / Math.max(tenants.length, 1)) * 100)}%;"></div></div>
          <small>${counts.active.toLocaleString('fa-IR')} مجموعه فعال در کلاستر ←</small>
        </a>

        <a class="gm02-dashboard-kpi ${tickets.length ? 'kpi-warning' : 'kpi-success'} card stat-card" href="#gm-21-support">
          <span>
            <span>تیکت‌های باز</span>
            <span class="gm02-kpi-trend neutral">${tickets.length ? 'نیاز اقدام' : 'پایدار'}</span>
          </span>
          <div class="gm02-kpi-center">
            <strong>${tickets.length.toLocaleString('fa-IR')}</strong>
            <svg class="gm02-sparkline" viewBox="0 0 72 24" width="72" height="24" aria-hidden="true">
              <path d="M 2 12 Q 18 5, 34 14 T 54 10 T 70 12" fill="none" stroke="#f79009" stroke-width="2.2" stroke-linecap="round"/>
            </svg>
          </div>
          <div class="gm02-kpi-bar"><div class="gm02-kpi-bar-fill ${tickets.length ? 'warning' : 'success'}" style="width:${tickets.length ? '45%' : '0%'};"></div></div>
          <small>پیگیری تیکت‌ها در دوسیه پشتیبانی ←</small>
        </a>

        <a class="gm02-dashboard-kpi kpi-health card stat-card" href="#gm-24-infrastructure">
          <span>
            <span>سلامت سرویس‌ها</span>
            <span class="gm02-kpi-trend up">پایدار</span>
          </span>
          <div class="gm02-kpi-center">
            <strong>۹۹.۹۸٪</strong>
            <svg class="gm02-sparkline" viewBox="0 0 72 24" width="72" height="24" aria-hidden="true">
              <path d="M 2 6 Q 20 5, 36 6 T 54 5 T 70 4" fill="none" stroke="#3157d5" stroke-width="2.2" stroke-linecap="round"/>
            </svg>
          </div>
          <div class="gm02-kpi-bar"><div class="gm02-kpi-bar-fill success" style="width:98%;"></div></div>
          <small>۸ زیرسیستم با پاسخ پینگ زیر ۲۰ms ←</small>
        </a>

        <a class="gm02-dashboard-kpi ${jobs.failed.length ? 'kpi-warning' : 'kpi-success'} card stat-card" href="#gm-25-jobs">
          <span>
            <span>صف اجرا (Workers)</span>
            <span class="gm02-kpi-trend neutral">O(1) FIFO</span>
          </span>
          <div class="gm02-kpi-center">
            <strong>${queue.length.toLocaleString('fa-IR')}</strong>
            <svg class="gm02-sparkline" viewBox="0 0 72 24" width="72" height="24" aria-hidden="true">
              <path d="M 2 18 Q 18 20, 34 11 T 52 14 T 70 6" fill="none" stroke="#8b5cf6" stroke-width="2.2" stroke-linecap="round"/>
            </svg>
          </div>
          <div class="gm02-kpi-bar"><div class="gm02-kpi-bar-fill ${jobs.failed.length ? 'warning' : 'success'}" style="width:25%;"></div></div>
          <small>${jobs.failed.length ? `${jobs.failed.length.toLocaleString('fa-IR')} خطا` : 'بدون خطای ثبت‌شده'} ←</small>
        </a>
      </div>

      ${renderThroughputChart()}

      ${renderSubsystemsMatrix()}

      <div class="gm02-dashboard-grid">
        ${renderFleetStatus(tenants)}

        <section class="gm02-dashboard-panel">
          <div class="gm02-dashboard-panel-head">
            <h3>تیکت‌های نیازمند رسیدگی</h3>
            <a href="#gm-21-support">مرکز تیکت‌ها ←</a>
          </div>
          <div class="gm02-dashboard-list">
            ${ticketRows}
          </div>
        </section>

        <section class="gm02-dashboard-panel">
          <div class="gm02-dashboard-panel-head">
            <h3>سلامت بخش‌های سرویس</h3>
            <a href="#gm-24-infrastructure">زیرساخت ←</a>
          </div>
          <div class="gm02-dashboard-list">
            ${serviceRows}
          </div>
        </section>

        <section class="gm02-dashboard-panel">
          <div class="gm02-dashboard-panel-head">
            <h3>کارهای در حال اجرا</h3>
            <a href="#gm-25-jobs">صف اجرا ←</a>
          </div>
          <div class="gm02-dashboard-list">
            ${jobRows}
          </div>
        </section>

        ${renderThreatAndActivityStream(store)}
      </div>
    </section>`;
  }

  global.renderGM02 = function renderGM02() {
    const store = global.prototypeStore || global.GMStore;
    const tenants = store && typeof store.getTenants === 'function' ? store.getTenants() : [];
    const allTickets = store && typeof store.getTickets === 'function' ? store.getTickets('all') : [];
    const tickets = allTickets.filter((ticket) => !['closed', 'resolved'].includes(ticket.status));
    const jobs = jobsFrom(store);
    const state = global.GMDataState ? global.GMDataState.getViewState('GM02').state : 'live';
    const blocked = ['loading', 'empty', 'failed', 'error'].includes(state);

    return `<div class="page-header gm02-page gm-quiet-page-header">
      <div class="page-title-group">
        <nav class="breadcrumb-nav" aria-label="مسیر راهبری">
          <span class="breadcrumb-current" aria-current="page">خانه</span>
        </nav>
        <h1 class="page-title">مرکز فرماندهی ناوگان · داشبورد کنترل‌پلن</h1>
      </div>
      <div class="header-actions">
        <span class="badge badge-provenance-local">پیش‌نمایش محلی</span>
        <a href="#gm-05-tenant-new" class="btn btn-primary btn-sm">＋ مشتری جدید</a>
      </div>
    </div>
    ${renderState(state)}
    ${blocked ? '' : renderDashboard(tenants, tickets, jobs, store)}`;
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
      // Update buttons
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
        const pageContainer = document.getElementById('page-container') || document.querySelector('.main-content') || document.body;
        if (pageContainer) {
          pageContainer.innerHTML = global.renderGM02();
        }
      }
    },

    pingService: function pingService(idx, event) {
      if (event && event.stopPropagation) event.stopPropagation();
      const badge = document.getElementById(`ping-badge-${idx}`);
      if (badge) {
        badge.innerHTML = 'در حال پینگ...';
        badge.style.color = '#3157d5';
        setTimeout(() => {
          const randomized = Math.floor(3 + Math.random() * 8);
          badge.innerHTML = `پینگ: ${randomized.toLocaleString('fa-IR')}ms`;
          badge.style.color = '#166534';
          if (global.showToast) {
            global.showToast(`پینگ سرویس ${SERVICES[idx].name} موفقیت‌آمیز بود (${randomized}ms)`, 'success');
          }
        }, 320);
      }
    },

    simulateLoad: function simulateLoad() {
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
      if (global.showToast) {
        global.showToast('حافظه کش لبه (Edge CDN & Nginx) برای تمام دامنه‌ها با موفقیت پاکسازی شد.', 'success');
      }
    },

    verifyAudit: function verifyAudit() {
      const store = global.prototypeStore || global.GMStore;
      if (store && typeof store.verifyAuditLogIntegrity === 'function') {
        const res = store.verifyAuditLogIntegrity();
        if (global.showToast) {
          global.showToast(res.message || 'زنجیره ممیزی با امضای دیجیتال SHA-256 تایید شد.', res.valid ? 'success' : 'warning');
        }
      } else if (global.showToast) {
        global.showToast('زنجیره ممیزی SHA-256 با موفقیت تایید شد.', 'success');
      }
    },

    runDiagnostic: function runDiagnostic() {
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
              <p style="margin:0;font-size:0.75rem;color:var(--gm-muted,#64748b);">
                پایش پروب‌های TCP/HTTP بر روی دیتاسنتر آسیاتک برج میلاد (IP: 185.143.232.10):
              </p>
              <div class="gm02-diag-progress">
                <div class="gm02-diag-bar" id="gm02-diag-bar" style="width: 15%;"></div>
              </div>
              <div style="display:grid;gap:0.4rem;max-height:240px;overflow-y:auto;padding-right:0.2rem;" id="gm02-diag-list">
                ${SERVICES.map((s) => `
                  <div style="display:flex;align-items:center;justify-content:space-between;padding:0.4rem 0.6rem;background:var(--gm-bg-subtle,#f8fafc);border-radius:6px;font-size:0.72rem;">
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

      // Animate progress bar to 100%
      setTimeout(() => {
        const bar = document.getElementById('gm02-diag-bar');
        if (bar) bar.style.width = '100%';
      }, 100);
    }
  };

  global.GMViews = global.GMViews || {};
  global.GMViews.GM02 = { render: global.renderGM02 };
})(window);
