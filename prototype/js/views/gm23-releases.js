/**
 * prototype/js/views/gm23-releases.js
 * 
 * GM-23: نسخه‌ها، انتشار قناری و بازگشت اضطراری (/releases)
 * مدیریت بسته‌های نرم‌افزاری، استقرار تدریجی (Canary Rollout)، سازگاری با دسکتاپ و برنامه بازگشت (Rollback Plan)
 */

window.renderGM23 = function() {
  const store = window.prototypeStore || window.GMStore;
  const releases = store && store.getReleases ? store.getReleases() : [];
  const releaseSource = releases.length ? 'سامانه کنترل استقرار و توزیع بسته NEEM' : 'بدون نسخه قابل مشاهده';

  setTimeout(() => {
    if (window.GMViews && window.GMViews.GM23) {
      window.GMViews.GM23.init();
    }
  }, 50);

  return `
    <div class="page-header gm23-page">
      <div class="page-title-group">
        <nav class="breadcrumb-nav" aria-label="مسیر راهبری">
          <a href="#gm-02-overview" class="breadcrumb-link">پیشخوان</a>
          <span class="breadcrumb-separator">/</span>
          <span class="breadcrumb-current" aria-current="page">نسخه‌ها و انتشار</span>
        </nav>
        <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
          <h1>
            نسخه، انتشار و بازگشت امن
            <span class="page-code-badge">GM-23</span>
          </h1>
          <span class="badge badge-scope-global"><span class="status-dot dot-purple"></span> کلان پلتفرم</span>
        </div>
        <p>استقرار امضاشده نسخه‌های سرور و کلاینت، کنترل موج‌های انتشار و دروازه‌های بازگشت خودکار</p>
      </div>
      <div class="header-actions">
        <button class="btn btn-primary" onclick="window.GMApp ? window.GMApp.showToast('موج انتشار نسخه جدید در پایپ‌لاین استقرار ثبت گردید.', 'success') : null">
          ایجاد موج انتشار جدید
        </button>
        <a href="#gm-24-infrastructure" class="btn btn-secondary">
          زیرساخت و سرورها
        </a>
      </div>
    </div>

    ${window.GMDataState ? window.GMDataState.renderFreshnessBar({
      viewId: 'GM23',
      sourceLabel: 'مخزن بسته‌های نرم‌افزاری و کنترل استقرار قناری',
      totalCount: releases.length,
      countLabel: 'نسخه نرم‌افزاری'
    }) : ''}

    ${(() => {
      const dataState = window.GMDataState ? window.GMDataState.getViewState('GM23') : { state: 'live' };
      if (dataState.state === 'failed' || dataState.state === 'error') {
        return window.GMDataState.renderFailedState({
          viewId: 'GM23',
          title: 'خطا در واکشی وضعیت انتشار و بسته‌ها',
          reason: 'ارتباط با رجیستری توزیع بسته‌های نرم‌افزاری یا سرویس Anycast برقرار نشد.',
          errorCode: 'ERR_RELEASE_REGISTRY_OFFLINE'
        });
      }
      if (dataState.state === 'empty') {
        return window.GMDataState.renderEmptyState({
          icon: '<span class="status-dot dot-warning"></span>',
          title: 'هیچ نسخه‌ای یافت نشد',
          description: 'هیچ بسته یا موج انتشاری برای پلتفرم ثبت نشده است.',
          actionLabel: 'ایجاد موج انتشار جدید',
          onAction: "window.GMApp ? window.GMApp.showToast('موج انتشار جدید برای کانال بتا آماده شد.', 'success') : null"
        });
      }
      if (dataState.state === 'loading') {
        return window.GMDataState.renderSkeleton('table', 4);
      }
      if (dataState.state === 'stale') {
        return window.GMDataState.renderStaleBanner('GM23');
      }
      if (dataState.state === 'refreshing') {
        return window.GMDataState.renderRefreshingBanner ? window.GMDataState.renderRefreshingBanner('GM23') : '';
      }
      return '';
    })()}

    ${(window.GMDataState && ['failed', 'empty', 'error', 'loading'].includes(window.GMDataState.getViewState('GM23').state)) ? '' : `
    <!-- Operational Guidance Banner -->
    <div class="op-context-banner op-context-info" role="region" aria-label="راهنمای استقرار و مدیریت انتشار">
      <div class="op-context-header">
        <span>تفکیک انتشار نسخه پلتفرم از پرچم‌های قابلیت (Feature Flags vs Releases)</span>
        <span class="badge badge-cyan">استقرار قناری (Canary Gates)</span>
      </div>
      <div class="op-context-grid">
        <div class="op-context-item">
          <span class="op-context-label">وضعیت جاری:</span>
          <span class="op-context-desc">بسته‌ها توسط سامانه استقرار امضا شده و معیارهای سلامت p99 و نرخ خطای 5xx پیوسته رصد می‌شوند.</span>
        </div>
        <div class="op-context-item">
          <span class="op-context-label">تعهد معماری و پیامد:</span>
          <span class="op-context-desc">کلیه تغییرات ترافیکی با هماهنگی کنترل‌پلن و دروازه‌های سلامت اعمال می‌شود.</span>
        </div>
        <div class="op-context-item">
          <span class="op-context-label">اقدام استاندارد بعدی:</span>
          <span class="op-context-desc">پیش از هر اقدام واقعی، رجیستری بسته، امضای قابل بازپخش، مقصد و شواهد سازگاری Schema باید متصل و تأیید شوند.</span>
        </div>
      </div>
    </div>

    <div class="data-quality-strip" role="status" aria-label="وضعیت داده‌های نسخه و انتشار">
      <div class="data-quality-label"><span class="dq-badge-dot dot-cyan"></span><span>وضعیت انتشار</span></div>
      <div class="data-quality-grid">
        <span class="dq-badge"><span class="dq-badge-dot ${releases.length ? 'dot-blue' : 'dot-purple'}"></span><span class="dq-dim-name">منبع</span><span class="dq-dim-val">${releaseSource}</span></span>
        <span class="dq-badge"><span class="dq-badge-dot dot-blue"></span><span class="dq-dim-name">نسخه قابل مشاهده</span><span class="dq-dim-val">${releases.length.toLocaleString('fa-IR')} نسخه</span></span>
        <span class="dq-badge"><span class="dq-badge-dot dot-emerald"></span><span class="dq-dim-name">اعتبار استقرار</span><span class="dq-dim-val">ACK مقصد لازم است</span></span>
      </div>
      <span class="dq-action-hint"><span>درصد Canary و وضعیت نسخه در این پروتوتایپ نمایشی است؛ انتشار واقعی باید با ACK مقصد تأیید شود</span></span>
    </div>

    <!-- Releases Table with Toolbar, Select All, and Bulk Actions -->
    <div class="table-wrapper">
      <div class="table-toolbar">
        <div class="table-filters" id="releaseChannelFilters" role="group" aria-label="فیلتر کانال انتشار">
          <button class="filter-chip active" aria-pressed="true" onclick="window.GMViews.GM23.setChannelFilter('all', this)">همه (${releases.length})</button>
          <button class="filter-chip" aria-pressed="false" onclick="window.GMViews.GM23.setChannelFilter('stable', this)">پایدار (Stable)</button>
          <button class="filter-chip" aria-pressed="false" onclick="window.GMViews.GM23.setChannelFilter('canary', this)">قناری آزمایشی</button>
        </div>
        <div class="table-search-group">
          <span id="releasesFilterCount" class="filter-count-badge">نمایش ${releases.length.toLocaleString('fa-IR')} از ${releases.length.toLocaleString('fa-IR')} نسخه نرم‌افزاری</span>
          <div class="search-input-wrapper" id="releaseSearchWrapper">
            <input type="text" id="releaseSearchInput" class="form-control" placeholder="جست‌وجو در نسخه، دایجست، قابلیت‌ها..." aria-label="جست‌وجو در نسخه‌ها" style="width: 230px; padding: 0.35rem 0.75rem;" oninput="window.GMViews.GM23.setQuery(this.value)" />
            <button class="search-clear-btn" onclick="window.GMViews.GM23.clearSearch()" aria-label="پاکسازی جستجو">✕</button>
          </div>
        </div>
      </div>
      <div class="table-responsive">
        <table class="data-table" id="releasesTable" aria-label="جدول نسخه‌های نرم‌افزاری و کانال‌های انتشار">
          <thead>
            <tr>
              <th class="cell-checkbox" style="width: 40px; text-align: center;">
                <input type="checkbox" id="releases-select-all" aria-label="انتخاب همه نسخه‌ها" />
              </th>
              <th>نسخه برنامه</th>
              <th>کانال انتشار</th>
              <th>اعتبار نسخه</th>
              <th>درصد استقرار (Canary)</th>
              <th>مشتریان دریافت‌کننده</th>
              <th>قابلیت‌های جدید</th>
              <th>وضعیت</th>
              <th class="cell-actions">عملیات بازگشت</th>
            </tr>
          </thead>
          <tbody>
            ${releases.map(r => `
              <tr class="release-row" data-version="${r.version}" data-channel="${r.channel}" data-search="${(r.version + ' ' + (r.channel || '') + ' ' + (r.digest || '') + ' ' + (r.featuresAdded ? r.featuresAdded.join(' ') : '')).toLowerCase()}">
                <td class="cell-checkbox" style="text-align: center;">
                  <input type="checkbox" class="release-row-select" data-id="${r.version}" aria-label="انتخاب نسخه ${r.version}" />
                </td>
                <td>
                  <span class="cell-mono font-bold" style="font-size: 0.813rem; color: var(--accent-cyan);">${r.version}</span>
                </td>
                <td>
                  ${r.channel === 'stable'
                    ? '<span class="badge badge-success">پایدار (Stable)</span>'
                    : '<span class="badge badge-warning">قناری آزمایشی</span>'
                  }
                </td>
                <td>
                  <span class="badge badge-success"><span class="status-dot dot-green"></span> امضای معتبر دیجیتال</span>
                  <details class="row-disclosure releases-technical-details">
                    <summary>نمایش Digest</summary>
                    <code class="nav-code" style="font-size: 0.688rem;">${r.digest}</code>
                  </details>
                </td>
                <td>
                  <div class="metric-meter metric-meter-compact" role="progressbar" aria-label="درصد استقرار قناری نسخه ${r.version}" aria-valuenow="${r.canaryPercent}" aria-valuemin="0" aria-valuemax="100">
                    <div class="metric-meter-track" style="width: 60px;">
                      <div class="metric-meter-fill ${r.canaryPercent === 100 ? 'meter-success' : 'meter-warning'}" style="width: ${r.canaryPercent}%;"></div>
                    </div>
                    <span class="metric-meter-val" style="color: var(--text-primary); font-weight: 600;">${r.canaryPercent}٪</span>
                  </div>
                </td>
                <td class="cell-mono" style="font-size: 0.75rem;">${r.deployedTenantsCount} مجموعه</td>
                <td class="release-features" title="${r.featuresAdded.join(' · ')}">
                  <span>${r.featuresAdded.slice(0, 2).join(' · ')}</span>${r.featuresAdded.length > 2 ? ` <span class="badge badge-neutral">+${r.featuresAdded.length - 2}</span>` : ''}
                </td>
                <td>
                  <span class="badge badge-success"><span class="badge-dot"></span> عملیاتی و پایدار</span>
                </td>
                <td class="cell-actions">
                  <button class="btn btn-secondary btn-sm" onclick="window.openGM23RollbackModal('${r.version}')" aria-label="طرح بازگشت نسخه ${r.version}">
                    برنامه بازگشت
                  </button>
                </td>
              </tr>
            `).join('')}
            <tr id="releases-empty-row" style="display: none;">
              <td colspan="9" style="text-align: center; padding: 2rem; color: var(--text-muted);">
                موردی مطابق با کانال انتخابی یا عبارت جست‌وجو شده یافت نشد.
                <button class="btn btn-xs btn-secondary" style="margin-right: 0.5rem;" onclick="window.GMViews.GM23.resetAll()">پاکسازی فیلترها</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Docked Bulk Actions Bar -->
    <div id="gm23-bulk-actions" class="bulk-actions-docked" role="toolbar" aria-label="عملیات گروهی روی نسخه‌ها" style="display: none;">
      <div class="bulk-actions-content">
        <div class="bulk-actions-info">
          <span class="bulk-selected-count">۰ مورد انتخاب شده</span>
        </div>
        <div class="bulk-actions-buttons">
          <button class="btn btn-sm btn-primary" onclick="window.GMViews.GM23.bulkVerifyDigests()">
            صحت‌سنجی امضای بسته‌ها
          </button>
          <button class="btn btn-sm btn-secondary" onclick="window.GMViews.GM23.bulkHaltRollout()">
            توقف موج استقرار قناری
          </button>
          <button class="btn btn-sm btn-subtle" onclick="window.GMViews.GM23.tableSelect && window.GMViews.GM23.tableSelect.clearSelection()">
            لغو انتخاب
          </button>
        </div>
      </div>
    </div>
    `}
  `;
};

window.openGM23RollbackModal = function(version) {
  const content = `
    <div style="display: flex; flex-direction: column; gap: 0.85rem;">
      <p style="font-size: 0.813rem; color: var(--text-primary); line-height: 1.5;">
        برنامه بازگشت اضطراری به آخرین نسخه پایدار قبل از <strong>${version}</strong>:
      </p>
      <div class="alert alert-danger">
        <strong>اقدام بازگشت اضطراری (Rollback):</strong> ترافیک کلیه گره‌ها پس از تخلیه اتصالات فعال به نسخه پایدار هدایت می‌شود.
      </div>
      <div style="background: var(--bg-surface-subtle); padding: 0.75rem; border-radius: 6px; font-size: 0.75rem; color: var(--text-secondary); border: 1px solid var(--border-subtle);" class="cell-mono">
        <div>نسخه بازگشت هدف: v2.3.9 (پایدار)</div>
        <div style="margin-top: 0.2rem;">سازگاری اسکیما دیتابیس: سازگار و بدون نیاز به میگریشن معکوس</div>
        <div style="margin-top: 0.2rem;">زمان سوئیچ ترافیک: تخمینی کمتر از ۳۰ ثانیه</div>
      </div>
    </div>
  `;

  if (window.GMApp && window.GMApp.openModal) {
    window.GMApp.openModal(`طرح بازگشت اضطراری برای نسخه ${version}`, content, () => {
      window.GMApp.showToast(`پروتوتایپ به کنترل‌کنندهٔ ترافیک متصل نیست؛ بازگشت نسخه ${version} اجرا یا ثبت نشد.`, 'warning');
      return false;
    }, {
      confirmText: 'تأیید طرح بازگشت اضطراری',
      confirmVariant: 'danger',
      severity: 'danger',
      severityLabel: 'مدیریت بحران انتشار'
    });
  }
};

window.GMViews = window.GMViews || {};
window.GMViews.GM23 = {
  channelFilter: 'all',
  query: '',
  tableSelect: null,

  init() {
    if (window.GMTableSelect && typeof window.GMTableSelect.initTable === 'function') {
      this.tableSelect = window.GMTableSelect.initTable('#releasesTable', {
        selectAllId: '#releases-select-all',
        rowCheckboxClass: '.release-row-select',
        rowClass: '.release-row',
        bulkBarId: '#gm23-bulk-actions',
        selectedCountClass: '.bulk-selected-count'
      });
    }
  },

  applyFilters() {
    const rows = document.querySelectorAll('#releasesTable tbody tr.release-row');
    let visibleCount = 0;
    const totalCount = rows.length;

    rows.forEach(row => {
      const channel = row.getAttribute('data-channel') || '';
      const searchData = row.getAttribute('data-search') || '';

      let matchFilter = true;
      if (this.channelFilter === 'stable') matchFilter = channel === 'stable';
      else if (this.channelFilter === 'canary') matchFilter = channel !== 'stable';

      const matchQuery = !this.query || searchData.includes(this.query);

      if (matchFilter && matchQuery) {
        row.style.display = '';
        visibleCount++;
      } else {
        row.style.display = 'none';
      }
    });

    const emptyRow = document.getElementById('releases-empty-row');
    if (emptyRow) {
      emptyRow.style.display = (visibleCount === 0 && totalCount > 0) ? '' : 'none';
    }

    const countBadge = document.getElementById('releasesFilterCount');
    if (countBadge) {
      countBadge.textContent = `نمایش ${visibleCount.toLocaleString('fa-IR')} از ${totalCount.toLocaleString('fa-IR')} نسخه نرم‌افزاری`;
    }

    const wrapper = document.getElementById('releaseSearchWrapper');
    if (wrapper) {
      if (this.query) wrapper.classList.add('has-value');
      else wrapper.classList.remove('has-value');
    }

    if (this.tableSelect) {
      this.tableSelect.sync();
    }
  },

  setChannelFilter(channel, btn) {
    this.channelFilter = channel;
    document.querySelectorAll('#releaseChannelFilters .filter-chip').forEach(el => {
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
    const input = document.getElementById('releaseSearchInput');
    if (input) input.value = '';
    this.setQuery('');
  },

  resetAll() {
    this.channelFilter = 'all';
    const firstChip = document.querySelector('#releaseChannelFilters .filter-chip');
    if (firstChip) {
      document.querySelectorAll('#releaseChannelFilters .filter-chip').forEach(el => {
        el.classList.remove('active');
        el.setAttribute('aria-pressed', 'false');
      });
      firstChip.classList.add('active');
      firstChip.setAttribute('aria-pressed', 'true');
    }
    this.clearSearch();
    if (this.tableSelect) {
      this.tableSelect.clear();
    }
  },

  bulkVerifyDigests() {
    const ids = this.tableSelect ? this.tableSelect.getSelectedIds() : [];
    if (ids.length === 0) {
      if (window.GMApp && window.GMApp.showToast) {
        window.GMApp.showToast('لطفاً ابتدا حداقل یک نسخه را انتخاب فرمایید.', 'warning');
      }
      return;
    }
    if (window.GMApp && window.GMApp.showToast) {
      window.GMApp.showToast(`برای ${ids.length} نسخه، امکان تأیید امضا نیازمند اتصال برخط گره‌های مقصد است.`, 'warning');
    }
  },

  bulkHaltRollout() {
    const ids = this.tableSelect ? this.tableSelect.getSelectedIds() : [];
    if (ids.length === 0) {
      if (window.GMApp && window.GMApp.showToast) {
        window.GMApp.showToast('لطفاً ابتدا حداقل یک نسخه را انتخاب فرمایید.', 'warning');
      }
      return;
    }
    if (window.GMApp && window.GMApp.openModal) {
      const content = `
        <p class="text-primary" style="font-size: 0.813rem; line-height: 1.5;">
          آیا از توقف فوری موج استقرار قناری برای <strong>${ids.length} نسخه</strong> انتخاب‌شده اطمینان دارید؟
        </p>
        <div class="alert alert-danger" style="margin-top: 0.5rem;">
          انتقال ترافیک جدید به این نسخه‌ها بلافاصله متوقف شده و به آخرین نسخه پایدار بازگردانده خواهد شد.
        </div>
      `;
      window.GMApp.openModal('تأیید توقف موج استقرار قناری', content, () => {
        if (window.GMApp && window.GMApp.showToast) {
          window.GMApp.showToast(`دستور توقف موج ${ids.length} نسخه ثبت گردید؛ تا تأیید تخلیه ترافیک، استقرار واقعی تغییر نکرد.`, 'info');
        }
        if (this.tableSelect) this.tableSelect.clearSelection();
      }, {
        confirmText: 'توقف استقرار',
        confirmVariant: 'danger',
        severity: 'danger',
        severityLabel: 'توقف اضطراری انتشار'
      });
    }
  }
};
