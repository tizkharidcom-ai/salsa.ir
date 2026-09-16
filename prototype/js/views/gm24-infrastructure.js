/**
 * prototype/js/views/gm24-infrastructure.js
 * 
 * GM-24: پایش سرور اختصاصی و زیرساخت متمرکز VPS (/infrastructure)
 * مدیریت منابع سخت‌افزاری سرور واحد (CPU/RAM/NVMe)، دیتابیس متمرکز PostgreSQL، پراکسی Nginx و سرویس‌های Node.js
 */

window.renderGM24 = function() {
  const store = window.prototypeStore || window.GMStore;
  const cells = store && store.getInfrastructureCells ? store.getInfrastructureCells() : [];
  const infrastructureSource = cells.length ? 'مرکز مدیریت زیرساخت عملیاتی WESTO VPS' : 'بدون سرور قابل مشاهده';

  setTimeout(() => {
    if (window.GMViews && window.GMViews.GM24) {
      window.GMViews.GM24.init();
    }
  }, 50);

  return `
    <div class="page-header gm24-page">
      <div class="page-title-group">
        <nav class="breadcrumb-nav" aria-label="مسیر راهبری">
          <a href="#gm-02-overview" class="breadcrumb-link">پیشخوان</a>
          <span class="breadcrumb-separator">/</span>
          <span class="breadcrumb-current" aria-current="page">زیرساخت و سرور متمرکز VPS</span>
        </nav>
        <h1>
          پایش سرور و زیرساخت اختصاصی VPS
          <span class="badge badge-scope-global"><span class="status-dot dot-purple"></span> کلان پلتفرم</span>
          <span class="page-code-badge">GM-24</span>
        </h1>
        <p>مدیریت و پایش منابع سرور ابری واحد (Single VPS Host)، دیتابیس متمرکز PostgreSQL، پراکسی Nginx و پردازش‌های Node.js</p>
      </div>
      <div class="header-actions">
        <button class="btn btn-primary" onclick="window.GMDataState ? window.GMDataState.refreshView('GM24') : (window.GMApp ? window.GMApp.showToast('پایش سلامت سرورها بازخوانی شد', 'info') : null)">
          پایش لحظه‌ای سرورها
        </button>
        <a href="#gm-22-operations" class="btn btn-secondary">
          سلامت و رخدادها
        </a>
      </div>
    </div>

    ${window.GMDataState ? window.GMDataState.renderFreshnessBar({
      viewId: 'GM24',
      sourceLabel: 'سرویس‌های هاست VPS، وب‌سرور Nginx و کارگزار پایگاه داده',
      sourceMode: 'local',
      totalCount: cells.length,
      countLabel: 'محیط سرور'
    }) : ''}

    ${(() => {
      const dataState = window.GMDataState ? window.GMDataState.getViewState('GM24') : { state: 'live' };
      if (dataState.state === 'failed' || dataState.state === 'error') {
        return window.GMDataState.renderFailedState({
          viewId: 'GM24',
          title: 'خطا در ارتباط با سرور VPS',
          reason: 'پاسخی از کارگزار محلی زیرساخت دریافت نشد.',
          errorCode: 'ERR_INFRASTRUCTURE_UNREACHABLE'
        });
      }
      if (dataState.state === 'empty') {
        return window.GMDataState.renderEmptyState({
          title: 'هیچ محیط سروری یافت نشد',
          description: 'هیچ سرور یا محیطی برای این پلتفرم ثبت نشده است.',
          actionLabel: 'پایش مجدد شبکه',
          onAction: "window.GMApp ? window.GMApp.showToast('آزمایش سرور آغاز شد', 'info') : null"
        });
      }
      if (dataState.state === 'loading') {
        return window.GMDataState.renderSkeleton('cards', 3);
      }
      if (dataState.state === 'stale') {
        return window.GMDataState.renderStaleBanner('GM24');
      }
      if (dataState.state === 'refreshing') {
        return window.GMDataState.renderRefreshingBanner ? window.GMDataState.renderRefreshingBanner('GM24') : '';
      }
      return '';
    })()}

    ${(window.GMDataState && ['failed', 'empty', 'error', 'loading'].includes(window.GMDataState.getViewState('GM24').state)) ? '' : `
    <!-- Real Production Services & Port Topology -->
    <div class="card" style="margin-bottom: 1.25rem; border-color: rgba(2, 132, 199, 0.3); background: var(--bg-surface);">
      <div class="card-header" style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border-default); padding-bottom: 0.75rem; margin-bottom: 1rem;">
        <div>
          <h3 class="card-title" style="font-size: 0.95rem; font-weight: 700;">📡 توپولوژی سرویس‌های عملیاتی سرور VPS (Host Services & Port Topology)</h3>
          <p class="card-subtitle" style="font-size: 0.75rem; color: var(--text-secondary); margin-top: 0.2rem;">پیکربندی رسمی پورت‌ها و سوکت‌های فعال بر روی سرور اختصاصی VPS در محیط عملیاتی</p>
        </div>
        <span class="badge badge-success"><span class="status-dot dot-green"></span> سرور متمرکز VPS</span>
      </div>
      <div class="grid-cols-4" style="gap: 0.75rem;">
        <div style="background: var(--bg-surface-subtle); border: 1px solid var(--border-default); border-radius: 8px; padding: 0.85rem;">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <span class="cell-mono font-bold" style="color: var(--accent-cyan); font-size: 1rem;">پورت ۳۰۵۰</span>
            <span class="badge badge-success" style="font-size: 10px;">فعال</span>
          </div>
          <div style="font-weight: 600; font-size: 0.813rem; color: var(--text-primary); margin-top: 0.35rem;">رابط کاربری گادمود (Godmode UI)</div>
          <div style="font-size: 0.72rem; color: var(--text-secondary); margin-top: 0.2rem;">داشبورد کنترل‌پلن، ابزارهای اپراتور و مدیریت مشتریان</div>
        </div>

        <div style="background: var(--bg-surface-subtle); border: 1px solid var(--border-default); border-radius: 8px; padding: 0.85rem;">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <span class="cell-mono font-bold" style="color: var(--accent-cyan); font-size: 1rem;">پورت ۳۰۶۱</span>
            <span class="badge badge-success" style="font-size: 10px;">فعال</span>
          </div>
          <div style="font-weight: 600; font-size: 0.813rem; color: var(--text-primary); margin-top: 0.35rem;">سرویس API کنترل‌پلن (Control Plane API)</div>
          <div style="font-size: 0.72rem; color: var(--text-secondary); margin-top: 0.2rem;">ماشین وضعیت مشتریان، مجوزها، لاگ ممیزی و هماهنگی</div>
        </div>

        <div style="background: var(--bg-surface-subtle); border: 1px solid var(--border-default); border-radius: 8px; padding: 0.85rem;">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <span class="cell-mono font-bold" style="color: var(--accent-cyan); font-size: 1rem;">پورت ۴۱۸۰</span>
            <span class="badge badge-success" style="font-size: 10px;">متصل</span>
          </div>
          <div style="font-weight: 600; font-size: 0.813rem; color: var(--text-primary); margin-top: 0.35rem;">کلاینت‌های مشتریان</div>
          <div style="font-size: 0.72rem; color: var(--text-secondary); margin-top: 0.2rem;">سامانه رستورانی، صندوق POS، منوی مشتری، سالن و KDS</div>
        </div>

        <div style="background: var(--bg-surface-subtle); border: 1px solid var(--border-default); border-radius: 8px; padding: 0.85rem;">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <span class="cell-mono font-bold" style="color: var(--accent-cyan); font-size: 1rem;">پورت ۵۴۳۳</span>
            <span class="badge badge-success" style="font-size: 10px;">پایدار</span>
          </div>
          <div style="font-weight: 600; font-size: 0.813rem; color: var(--text-primary); margin-top: 0.35rem;">پایگاه داده متمرکز (PostgreSQL 16)</div>
          <div style="font-size: 0.72rem; color: var(--text-secondary); margin-top: 0.2rem;">ایزولاسیون کامل شِما برای هر مشتری با تأخیر شبکه صفر</div>
        </div>
      </div>
    </div>

    <!-- Standardized Operational Guidance Banner -->
    <div class="op-context-banner op-context-info" role="region" aria-label="راهنمای معماری تک‌سرور VPS">
      <div class="op-context-header">
        <span>معماری متمرکز تک‌سرور ابری (Single VPS Server Architecture)</span>
        <span class="badge badge-cyan">استقرار متمرکز و یکپارچه</span>
      </div>
      <div class="op-context-grid">
        <div class="op-context-item">
          <span class="op-context-label">وضعیت جاری:</span>
          <span class="op-context-desc">کل سامانه وستو (UI گادمود، API کنترل‌پلن، اپلیکیشن مشتریان و دیتابیس) بر روی یک سرور واحد VPS مستقر هستند. تفکیک مشتریان با شِماهای ایزوله انجام می‌گیرد.</span>
        </div>
        <div class="op-context-item">
          <span class="op-context-label">تعهد معماری و عملکرد:</span>
          <span class="op-context-desc">بهره‌مندی از حداکثر کارایی با تأخیر شبکه صفر (Zero Latency) میان سرویس‌ها و پایگاه‌داده بدون پیچیدگی کلاسترهای توزیع‌شده یا هزینه‌های نگهداری چندسلولی.</span>
        </div>
        <div class="op-context-item">
          <span class="op-context-label">اقدام استاندارد بعدی:</span>
          <span class="op-context-desc">پایش پیوسته مصرف حافظه رم (RAM)، بار پردازنده (CPU) و فضای دیسک NVMe سرور اصلی.</span>
        </div>
      </div>
    </div>

    <div class="data-quality-strip" role="status" aria-label="وضعیت داده‌های زیرساخت">
      <div class="data-quality-label"><span class="dq-badge-dot dot-cyan"></span><span>وضعیت هاست VPS</span></div>
      <div class="data-quality-grid">
        <span class="dq-badge"><span class="dq-badge-dot ${cells.length ? 'dot-blue' : 'dot-purple'}"></span><span class="dq-dim-name">منبع</span><span class="dq-dim-val">${infrastructureSource}</span></span>
        <span class="dq-badge"><span class="dq-badge-dot dot-blue"></span><span class="dq-dim-name">سرور فعال</span><span class="dq-dim-val">${cells.length.toLocaleString('fa-IR')} محیط</span></span>
        <span class="dq-badge"><span class="dq-badge-dot dot-emerald"></span><span class="dq-dim-name">اعتبار</span><span class="dq-dim-val">عملیاتی و برخط</span></span>
      </div>
      <span class="dq-action-hint"><span>زیرساخت متمرکز VPS با سلامت عملیاتی و پایش پیوسته در دسترس است.</span></span>
    </div>

    <!-- Toolbar with Region Filters and Search -->
    <div class="table-wrapper" style="margin-bottom: 1rem;">
      <div class="table-toolbar">
        <div class="table-filters" id="cellRegionFilters" role="group" aria-label="فیلتر محیط‌های سرور">
          <button class="filter-chip active" aria-pressed="true" onclick="window.GMViews.GM24.setRegionFilter('all', this)">همه محیط‌ها (${cells.length})</button>
          <button class="filter-chip" aria-pressed="false" onclick="window.GMViews.GM24.setRegionFilter('tehran', this)">سرور اصلی (Production)</button>
          <button class="filter-chip" aria-pressed="false" onclick="window.GMViews.GM24.setRegionFilter('isfahan', this)">محیط‌های تست و بکاپ</button>
        </div>
        <div class="table-search-group">
          <span id="cellsFilterCount" class="filter-count-badge">نمایش ${cells.length.toLocaleString('fa-IR')} از ${cells.length.toLocaleString('fa-IR')} سرور و محیط</span>
          <div class="search-input-wrapper" id="cellSearchWrapper">
            <input type="text" id="cellSearchInput" class="form-control" placeholder="جست‌وجو در شناسه، نام یا محیط سرور..." aria-label="جست‌وجو در سرورها" style="width: 220px; padding: 0.35rem 0.75rem;" oninput="window.GMViews.GM24.setQuery(this.value)" />
            <button class="search-clear-btn" onclick="window.GMViews.GM24.clearSearch()" aria-label="پاکسازی جستجو">✕</button>
          </div>
        </div>
      </div>
    </div>

    <div id="cells-empty-message" style="display: none; text-align: center; padding: 2.5rem; background: var(--bg-surface-subtle); border-radius: 8px; border: 1px dashed var(--border-subtle); margin-bottom: 1.25rem;">
      <p style="color: var(--text-muted); margin-bottom: 0.5rem;">هیچ سرور یا محیطی منطبق با فیلتر یا جست‌وجوی واردشده یافت نشد.</p>
      <button class="btn btn-xs btn-secondary" onclick="window.GMViews.GM24.resetAll()">پاکسازی فیلترها</button>
    </div>

    <!-- Server Hosts Grid -->
    <div class="grid-cols-3" id="cellsGridContainer" style="margin-bottom: 1.25rem;">
      ${cells.map(c => {
        const isPrimary = c.id === 'cell-teh-01';
        return `
          <div class="card cell-card" data-id="${c.id}" data-region="${c.region}" data-search="${(c.id + ' ' + c.name + ' ' + c.region).toLowerCase()}">
            <div class="card-header">
              <div class="card-title-group">
                <details class="row-disclosure infrastructure-technical-details">
                  <summary>شناسه سرور</summary>
                  <code class="cell-mono" style="color: var(--accent-cyan); font-size: 0.75rem;">${c.id}</code>
                </details>
                <h3 class="card-title" style="font-size: 0.875rem;">${c.name}</h3>
                <p class="card-subtitle">
                  ${isPrimary ? 'سرور متمرکز عملیاتی (Production VPS)' : c.id === 'cell-teh-02' ? 'محیط پیش‌نمایش و تست (Staging VPS)' : 'ذخیره‌سازی پشتیبان آف‌سایت (Backup)'}
                </p>
              </div>
              <div class="card-actions">
                <span class="badge badge-success"><span class="badge-dot"></span> عملیاتی و برخط</span>
              </div>
            </div>

            <div class="card-body">
              <div style="display: flex; flex-direction: column; gap: 0.75rem; margin-bottom: 1rem;">
                ${c.specs ? `
                <div style="font-size: 0.75rem; color: var(--text-secondary); background: var(--bg-surface-subtle); padding: 0.4rem 0.6rem; border-radius: 6px; border: 1px solid var(--border-subtle);">
                  <div><strong>سخت‌افزار:</strong> <span class="cell-mono">${c.specs}</span></div>
                  ${c.os ? `<div style="margin-top: 0.2rem;"><strong>سیستم‌عامل:</strong> <span class="cell-mono">${c.os}</span></div>` : ''}
                </div>` : ''}

                <!-- Tenant Capacity Meter -->
                <div class="metric-meter" role="status" aria-label="ظرفیت میزبانی مجموعه در سرور ${c.id}; ۴۲٪ پایدار">
                  <div class="metric-meter-header">
                    <span class="metric-meter-label">ظرفیت میزبانی مجموعه:</span>
                    <span class="metric-meter-val text-success">${c.tenantsAssigned} از ${c.tenantsCapacity} مجموعه</span>
                  </div>
                  <div class="metric-meter-track">
                    <div class="metric-meter-fill success" style="width: ${Math.round((c.tenantsAssigned / c.tenantsCapacity) * 100) || 10}%;"></div>
                  </div>
                </div>

                <!-- CPU Load Meter -->
                <div class="metric-meter" role="status" aria-label="بار پردازنده سرور ${c.id}; ${c.cpuPercent}٪ نرمال">
                  <div class="metric-meter-header">
                    <span class="metric-meter-label">بار پردازنده (CPU):</span>
                    <span class="metric-meter-val text-success">${c.cpuPercent}٪ (نرمال)</span>
                  </div>
                  <div class="metric-meter-track">
                    <div class="metric-meter-fill success" style="width: ${c.cpuPercent}%;"></div>
                  </div>
                </div>

                <!-- RAM Load Meter -->
                <div class="metric-meter" role="status" aria-label="مصرف حافظه رم سرور ${c.id}; ${c.memoryPercent}٪ بهینه">
                  <div class="metric-meter-header">
                    <span class="metric-meter-label">حافظه مصرفی (RAM):</span>
                    <span class="metric-meter-val text-success">${c.memoryPercent}٪ (بهینه)</span>
                  </div>
                  <div class="metric-meter-track">
                    <div class="metric-meter-fill success" style="width: ${c.memoryPercent}%;"></div>
                  </div>
                </div>

                <!-- Disk Space Info -->
                <div style="display: flex; justify-content: space-between; font-size: 0.75rem; padding-top: 0.25rem; border-top: 1px solid rgba(255, 255, 255, 0.05);">
                  <span style="color: var(--text-secondary);">فضای ذخیره‌سازی:</span>
                  <span class="cell-mono font-bold text-success">${c.storageGb || 'آزاد'}</span>
                </div>
              </div>

              <button class="btn btn-secondary btn-sm" style="width: 100%; justify-content: center;" onclick="window.GMApp ? window.GMApp.showToast('ارتباط با سرویس‌های سرور ${c.id} برقرار و پایدار است (تاخیر ۱ میلی‌ثانیه محلی).', 'success') : null">
                آزمون ارتباط سرویس‌های سرور
              </button>
            </div>
          </div>
        `;
      }).join('')}
    </div>
    `}
  `;
};

window.GMViews = window.GMViews || {};
window.GMViews.GM24 = {
  regionFilter: 'all',
  query: '',

  init() {
    this.applyFilters();
  },

  applyFilters() {
    const cards = document.querySelectorAll('#cellsGridContainer .cell-card');
    let visibleCount = 0;
    const totalCount = cards.length;

    cards.forEach(card => {
      const region = (card.getAttribute('data-region') || '').toLowerCase();
      const searchData = card.getAttribute('data-search') || '';

      let matchFilter = true;
      if (this.regionFilter === 'tehran' || this.regionFilter === 'production') {
        matchFilter = region.includes('tehran-core') || card.getAttribute('data-id') === 'cell-teh-01';
      } else if (this.regionFilter === 'isfahan' || this.regionFilter === 'staging-backup') {
        matchFilter = !region.includes('tehran-core');
      }

      const matchQuery = !this.query || searchData.includes(this.query);

      if (matchFilter && matchQuery) {
        card.style.display = '';
        visibleCount++;
      } else {
        card.style.display = 'none';
      }
    });

    const emptyMsg = document.getElementById('cells-empty-message');
    if (emptyMsg) {
      emptyMsg.style.display = (visibleCount === 0 && totalCount > 0) ? '' : 'none';
    }

    const countBadge = document.getElementById('cellsFilterCount');
    if (countBadge) {
      countBadge.textContent = `نمایش ${visibleCount.toLocaleString('fa-IR')} از ${totalCount.toLocaleString('fa-IR')} سرور و محیط`;
    }

    const wrapper = document.getElementById('cellSearchWrapper');
    if (wrapper) {
      if (this.query) wrapper.classList.add('has-value');
      else wrapper.classList.remove('has-value');
    }
  },

  setRegionFilter(region, btn) {
    this.regionFilter = region;
    document.querySelectorAll('#cellRegionFilters .filter-chip').forEach(el => {
      el.classList.remove('active');
      el.setAttribute('aria-pressed', 'false');
    });
    if (btn) {
      btn.classList.add('active');
      btn.setAttribute('aria-pressed', 'true');
    }
    this.applyFilters();
  },

  setQuery(q) {
    this.query = (q || '').trim().toLowerCase();
    this.applyFilters();
  },

  clearSearch() {
    const input = document.getElementById('cellSearchInput');
    if (input) input.value = '';
    this.setQuery('');
  },

  resetAll() {
    this.regionFilter = 'all';
    const firstChip = document.querySelector('#cellRegionFilters .filter-chip');
    if (firstChip) {
      document.querySelectorAll('#cellRegionFilters .filter-chip').forEach(el => {
        el.classList.remove('active');
        el.setAttribute('aria-pressed', 'false');
      });
      firstChip.classList.add('active');
      firstChip.setAttribute('aria-pressed', 'true');
    }
    this.clearSearch();
  }
};
