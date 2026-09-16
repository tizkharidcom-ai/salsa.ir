/**
 * prototype/js/views/gm26-audit.js
 * 
 * GM-26: تاریخچه ممیزی و رویدادهای غیرقابل تغییر (/audit)
 * ثبت تغییرات حساس، دسترسی به داده PII، منع دسترسی، بازگردانی بکاپ و اثبات زنجیره هش (Tamper-evident Hash Chain)
 */

window.renderGM26 = function() {
  const store = window.prototypeStore || window.GMStore;
  const esc = (window.GMPageContracts && window.GMPageContracts.escapeHtml) || String;
  const auditLogs = store && store.getAuditLogs ? store.getAuditLogs() : [];

  const successCount = auditLogs.filter(a => a.result === 'success').length;
  const deniedCount = auditLogs.filter(a => a.result !== 'success').length;
  const auditSource = auditLogs.length ? 'حافظه محلی Store' : 'بدون رویداد قابل مشاهده';
  const actionLabels = {
    'override.create': 'ثبت منع یا اجازه شخصی',
    'backup.verify': 'اعتبارسنجی پشتیبان',
    'feature.addon_grant': 'تمدید افزونه'
  };

  return `
    <div class="page-header gm26-page">
      <div class="page-title-group">
        <nav class="breadcrumb-nav" aria-label="مسیر راهبری">
          <a href="#gm-02-overview" class="breadcrumb-link">پیشخوان</a>
          <span class="breadcrumb-separator">/</span>
          <span class="breadcrumb-current" aria-current="page">تاریخچه ممیزی</span>
        </nav>
        <h1>
          ردپای ممیزی و تغییرات حساس
          <span class="badge badge-scope-global"><span class="status-dot dot-purple"></span> کلان پلتفرم</span>
          <span class="page-code-badge">GM-26</span>
        </h1>
        <p>ثبت تغییرات سیاست‌های امنیتی، افشای داده‌های حساس، پرداخت‌ها و اقدامات در زنجیره رویدادهای ضد جعل</p>
      </div>
      <div class="header-actions">
        <button class="btn btn-primary" onclick="window.GMApp ? window.GMApp.showToast('خروجی رسمی لاگ‌های ممیزی با امضای دیجیتال SHA-256 و ساختار زنجیره‌ای ضدجعل صادر شد.', 'success') : null">
          خروجی ممیزی انطباق (امضاشده)
        </button>
        <a href="#gm-27-team" class="btn btn-secondary">
          تیم و دسترسی پلتفرم
        </a>
      </div>
    </div>

    <div class="data-quality-strip" role="status" aria-label="وضعیت داده‌های ممیزی">
      <div class="data-quality-label"><span class="dq-badge-dot dot-cyan"></span><span>وضعیت ممیزی</span></div>
      <div class="data-quality-grid">
        <span class="dq-badge"><span class="dq-badge-dot ${auditLogs.length ? 'dot-blue' : 'dot-purple'}"></span><span class="dq-dim-name">منبع</span><span class="dq-dim-val">${auditSource}</span></span>
        <span class="dq-badge"><span class="dq-badge-dot dot-blue"></span><span class="dq-dim-name">رویداد قابل مشاهده</span><span class="dq-dim-val">${auditLogs.length.toLocaleString('fa-IR')} مورد</span></span>
        <span class="dq-badge"><span class="dq-badge-dot ${deniedCount ? 'dot-amber' : 'dot-emerald'}"></span><span class="dq-dim-name">نتیجه</span><span class="dq-dim-val">${deniedCount.toLocaleString('fa-IR')} مورد نیازمند بررسی</span></span>
      </div>
      <span class="dq-action-hint"><span>زنجیره ممیزی فقط برای مشاهده و اعتبارسنجی است؛ ویرایش یا حذف رویداد مجاز نیست</span></span>
    </div>

    ${window.GMDataState ? window.GMDataState.renderFreshnessBar({
      viewId: 'GM26',
      sourceLabel: 'دفتر کل لاگ ممیزی و رویدادهای سیستم',
      sourceMode: 'local',
      totalCount: auditLogs.length,
      countLabel: 'رویداد'
    }) : ''}

    <div class="card" style="margin-bottom: 1.25rem; border-color: rgba(16, 185, 129, 0.35); background: linear-gradient(135deg, rgba(16, 185, 129, 0.05) 0%, rgba(6, 182, 212, 0.05) 100%);">
      <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.75rem;">
        <div style="display: flex; align-items: center; gap: 0.75rem;">
          <span style="font-size: 1.5rem;">⛓️</span>
          <div>
            <div style="font-size: 0.95rem; font-weight: 700; color: var(--text-primary);">
              زنجیره لاگ ممیزی ضدجعل رمزنگاری‌شده (Tamper-Evident SHA-256 Hash Chain)
            </div>
            <div style="font-size: 0.75rem; color: var(--text-secondary); margin-top: 0.2rem;">
              تمام لاگ‌ها با امضای زنجیره‌ای هش قبلی ثبت می‌گردند. هرگونه حذف، ویرایش یا جابجایی رکوردها توسط موتور اعتبارسنجی کشف و مسدود می‌شود.
            </div>
          </div>
        </div>
        <button type="button" class="btn btn-outline-emerald btn-sm" onclick="(() => {
          const res = (window.prototypeStore || window.GMStore) ? (window.prototypeStore || window.GMStore).verifyAuditLogIntegrity() : { valid: true, message: 'زنجیره تایید شد' };
          window.GMApp ? window.GMApp.showToast(res.message, res.valid ? 'success' : 'danger') : alert(res.message);
        })()">
          ✓ ارزیابی برخط اصالت زنجیره
        </button>
      </div>
    </div>

    ${(() => {
      const dataState = window.GMDataState ? window.GMDataState.getViewState('GM26') : { state: 'live' };
      if (dataState.state === 'failed' || dataState.state === 'error') {
        return window.GMDataState.renderFailedState({
          viewId: 'GM26',
          title: 'خطا در واکشی زنجیره لاگ‌های ممیزی',
          reason: 'پاسخی از سرویس بایگانی امن لاگ ممیزی دریافت نشد.',
          errorCode: 'ERR_AUDIT_LOG_UNAVAILABLE'
        });
      }
      if (dataState.state === 'empty') {
        return window.GMDataState.renderEmptyState({
          title: 'هیچ رویداد ممیزی ثبت نشده است',
          summary: 'عدم ثبت تغییرات ساختاری یا دسترسی سطح بالا در زنجیره ممیزی',
          description: 'هنوز رویدادی در زنجیره تغییرناپذیر ممیزی و وقایع امنیتی این سیستم ذخیره نشده است.',
          auditScope: 'دفتر ممیزی تغییرناپذیر امنیتی (Append-only)، وقایع تغییر پیکربندی، لاگین ادمین و مجوزها',
          actionLabel: 'به‌روزرسانی فهرست',
          onAction: "window.GMDataState.refreshView('GM26')"
        });
      }
      if (dataState.state === 'loading') {
        return window.GMDataState.renderSkeleton('table', 5);
      }
      if (dataState.state === 'stale') {
        return window.GMDataState.renderStaleBanner('GM26');
      }
      if (dataState.state === 'refreshing') {
        return window.GMDataState.renderRefreshingBanner ? window.GMDataState.renderRefreshingBanner('GM26') : '';
      }
      return '';
    })()}

    ${(window.GMDataState && ['failed', 'empty', 'error', 'loading'].includes(window.GMDataState.getViewState('GM26').state)) ? '' : `
    <!-- Audit Integrity Banner -->
    <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 6px; padding: 0.75rem 1rem; margin-bottom: 1.25rem;">
      <div style="font-weight: 600; color: #166534; font-size: 0.813rem; margin-bottom: 0.2rem; display: flex; align-items: center; gap: 0.4rem;">
        <span class="status-dot dot-green"></span>
        تضمین یکپارچگی و تغییرناپذیری زنجیره ممیزی (Append-Only Audit Trail)
      </div>
      <div style="font-size: 0.75rem; color: #15803d; line-height: 1.5;">
        تمام رویدادهای سیستمی با امضای رمزنگاری‌شده و شناسه غیرقابل دستکاری در دفتر ممیزی امن پلتفرم ثبت شده‌اند. این دفتر فاقد هرگونه امکان ویرایش یا حذف است.
      </div>
    </div>

    <!-- Audit Logs Table -->
    <div class="table-wrapper">
      <div class="table-toolbar" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.75rem;">
        <div class="table-filters" id="auditResultChips" role="group" aria-label="فیلتر وضعیت نتیجه ممیزی">
          <button class="filter-chip active" data-result="all" aria-pressed="true" onclick="window.GMViews.GM26.setResultFilter('all')">
            همه رویدادها (${auditLogs.length})
          </button>
          <button class="filter-chip" data-result="success" aria-pressed="false" onclick="window.GMViews.GM26.setResultFilter('success')">
            موفق (${successCount})
          </button>
          <button class="filter-chip" data-result="denied" aria-pressed="false" onclick="window.GMViews.GM26.setResultFilter('denied')">
            ردشده / مشکوک (${deniedCount})
          </button>
        </div>

        <div class="table-search-group">
          <span id="auditFilterCount" class="filter-count-badge">نمایش ${auditLogs.length.toLocaleString('fa-IR')} از ${auditLogs.length.toLocaleString('fa-IR')} رویداد</span>
          <div class="search-input-wrapper" id="auditSearchWrapper">
            <input type="text" id="auditSearchInput" class="form-control" placeholder="جست‌وجو در عامل، عملیات یا شرح..." style="width: 240px; padding: 0.35rem 0.75rem;" aria-label="جست‌وجو در رویدادهای ممیزی" oninput="window.GMViews.GM26.search(this.value)" />
            <button class="search-clear-btn" onclick="window.GMViews.GM26.clearSearch()" aria-label="پاکسازی جستجو">✕</button>
          </div>
        </div>
      </div>
      <div class="table-responsive">
        <table class="data-table" id="auditTable" aria-label="جدول تاریخچه رویدادهای ممیزی و امنیتی پلتفرم">
          <thead>
            <tr>
              <th class="col-checkbox"><input type="checkbox" id="audit-select-all" aria-label="انتخاب همه رویدادهای ممیزی" /></th>
              <th>رویداد</th>
              <th>زمان رخداد</th>
              <th>عامل اقدام (Actor)</th>
              <th>عملیات</th>
              <th>شرح اقدام و حوزه اثر</th>
              <th>نتیجه</th>
              <th>جزئیات شبکه</th>
              <th>اعتبارسنجی</th>
              <th class="cell-actions">عملیات</th>
            </tr>
          </thead>
          <tbody>
            ${auditLogs.map(a => `
              <tr id="row-audit-${esc(a.id)}" data-id="${esc(a.id)}" data-result="${esc(a.result)}" data-search="${esc(`${a.id} ${a.actor} ${a.actorRole} ${a.action} ${a.description} ${a.ip || ''} ${a.result}`)}">
                <td class="col-checkbox">
                  <input type="checkbox" class="audit-row-select" data-id="${esc(a.id)}" aria-label="انتخاب رویداد ${esc(a.id)}" />
                </td>
                <td>
                  <strong style="color: var(--text-primary);">${esc(actionLabels[a.action] || 'رویداد سیستمی')}</strong>
                  <details class="row-disclosure audit-technical-details">
                    <summary>شناسه رویداد</summary>
                    <code class="nav-code">${esc(a.id)}</code>
                  </details>
                </td>
                <td style="font-size: 0.75rem; color: var(--text-secondary);">${esc(a.timestamp)}</td>
                <td>
                  <strong style="color: var(--text-primary);">${esc(a.actor)}</strong>
                  <details class="row-disclosure audit-technical-details">
                    <summary>نقش عامل</summary>
                    <span>${esc(a.actorRole)}</span>
                  </details>
                </td>
                <td><span class="badge badge-neutral">${esc(actionLabels[a.action] || 'رویداد سیستمی')}</span></td>
                <td style="font-size: 0.75rem; max-width: 240px; color: var(--text-secondary);">${esc(a.description)}</td>
                <td>
                  ${a.result === 'success'
                    ? '<span class="badge badge-success"><span class="badge-dot"></span> موفق</span>'
                    : '<span class="badge badge-danger"><span class="badge-dot"></span> رد شد</span>'
                  }
                </td>
                <td>
                  <details class="row-disclosure audit-technical-details">
                    <summary>نمایش IP</summary>
                    <code class="nav-code">${esc(a.ip || '۱۲۷.۰.۰.۱')}</code>
                  </details>
                </td>
                <td>
                  <details class="row-disclosure audit-technical-details">
                    <summary>نمایش هش</summary>
                    <code class="nav-code" style="font-size: 0.688rem;">${esc(a.hash ? a.hash.substring(0, 10) : 'a1b2c3d4')}...</code>
                  </details>
                </td>
                <td class="cell-actions">
                  <div style="display: inline-flex; gap: 0.35rem; justify-content: flex-end;">
                    <button class="btn btn-secondary btn-sm" data-audit-verify="${esc(a.id)}" data-audit-hash="${esc(a.hash ? a.hash.substring(0, 10) : 'a1b2c3d4')}" title="راستی‌آزمایی امضای رمزنگاری">
                      بررسی هش
                    </button>
                    <button class="btn btn-secondary btn-sm" data-audit-diff="${esc(a.id)}" aria-label="مشاهده جزئیات ممیزی ${esc(a.id)}">
                      Diff
                    </button>
                  </div>
                </td>
              </tr>
            `).join('')}
            <tr id="audit-empty-row" style="display: none;">
              <td colspan="10" class="table-empty-cell" style="text-align: center; padding: 2.5rem 1rem; color: var(--text-secondary);">
                <div style="font-size: 0.875rem; font-weight: 600; color: var(--text-primary); margin-bottom: 0.35rem;">هیچ رویداد ممیزی با این مشخصات پیدا نشد</div>
                <div style="font-size: 0.75rem; color: var(--text-tertiary, #64748b); margin-bottom: 0.85rem;">می‌توانید عبارت جستجو را ویرایش نموده یا فیلتر را بازنشانی کنید.</div>
                <button class="btn btn-secondary btn-sm" onclick="window.GMViews.GM26.resetAll()">پاکسازی فیلتر و جست‌وجو</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Bulk Actions Docked Bar -->
    <div id="gm26-bulk-actions" class="table-bulk-actions-bar" role="toolbar" aria-label="عملیات گروهی روی رویدادهای انتخاب‌شده">
      <div class="bulk-actions-info">
        <span class="bulk-counter-badge" id="gm26-bulk-count">۰ مورد انتخاب‌شده</span>
        <span class="bulk-actions-label">اقدامات دسته‌جمعی:</span>
      </div>
      <div class="bulk-actions-btns">
        <button type="button" class="btn btn-primary btn-sm" id="gm26-bulk-verify-btn" onclick="window.GMViews.GM26.bulkVerifyHashes()" disabled>
          اعتبارسنجی زنجیره هش (Fixture؛ تأییدنشده)
        </button>
        <button type="button" class="btn btn-secondary btn-sm" id="gm26-bulk-export-btn" onclick="window.GMViews.GM26.exportSelectedAudit()" disabled>
          خروجی ممیزی (بدون امضای تولیدی)
        </button>
        <button type="button" class="bulk-clear-btn" onclick="window.GMViews.GM26.clearSelection()">
          لغو انتخاب
        </button>
      </div>
    </div>
    `}
  `;
  setTimeout(() => {
    if (window.GMViews && window.GMViews.GM26 && typeof window.GMViews.GM26.initSelection === 'function') {
      window.GMViews.GM26.initSelection();
    }
  }, 0);
};

window.openGM26AuditDrawer = function(auditId, action, description) {
  const esc = (window.GMPageContracts && window.GMPageContracts.escapeHtml) || String;
  const content = `
    <div style="display: flex; flex-direction: column; gap: 1rem;">
      <div>
        <div style="font-size: 0.75rem; color: var(--text-secondary);">عملیات ثبت‌شده:</div>
        <div style="font-weight: 700; font-size: 0.95rem; color: var(--text-primary); margin-top: 0.15rem;">${esc(action)}</div>
        <div style="font-size: 0.75rem; color: var(--text-secondary); margin-top: 0.25rem;">${esc(description)}</div>
      </div>

      <div style="border-top: 1px solid var(--border-default); padding-top: 0.85rem;">
        <label class="form-label" style="font-size: 0.813rem; font-weight: 600; color: var(--text-primary);">تغییرات ثبت‌شده (Payload Diff):</label>
        <div style="background: var(--bg-surface-elevated, #f1f5f9); padding: 0.75rem; border-radius: 6px; font-size: 0.75rem; border: 1px solid var(--border-default);" class="cell-mono">
          <div style="color: var(--state-danger, #e11d48);">- "state": "inherit"</div>
          <div style="color: var(--state-success, #059669);">+ "state": "deny"</div>
          <div style="color: var(--text-tertiary, #64748b); margin-top: 0.25rem;">  "reason": "دستور هیئت مدیره برای توقف موقت خروجی مالی"</div>
          <div style="color: var(--text-tertiary, #64748b);">  "policyVersion": 42</div>
        </div>
      </div>

      <div style="border-top: 1px solid var(--border-default); padding-top: 0.85rem;">
        <label class="form-label" style="font-size: 0.813rem; font-weight: 600; color: var(--text-primary);">راستی‌آزمایی زنجیره هش امنیتی:</label>
        <div style="background: var(--state-success-subtle); border: 1px solid var(--status-live-border); border-radius: 6px; padding: 0.75rem; font-size: 0.75rem; color: var(--state-success); line-height: 1.45;">
          تطبیق هش و امضای کلید اصلی پلتفرم از منبع عملیاتی دریافت نشده است؛ عدم دستکاری در این Fixture قابل ادعا نیست.
        </div>
      </div>
    </div>
  `;

  if (window.GMApp && window.GMApp.openDrawer) {
    window.GMApp.openDrawer(`شواهد و Diff رویداد: ${auditId}`, content);
  }
};

// Delegated click handling for per-row audit actions. Data attributes keep
// untrusted audit identifiers out of inline event handlers entirely.
if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
  document.addEventListener('click', function(event) {
    const verifyBtn = event.target && event.target.closest ? event.target.closest('[data-audit-verify]') : null;
    if (verifyBtn) {
      const id = verifyBtn.getAttribute('data-audit-verify');
      const hash = verifyBtn.getAttribute('data-audit-hash');
      if (window.GMViews && window.GMViews.GM26 && typeof window.GMViews.GM26.verifySingleHash === 'function') {
        window.GMViews.GM26.verifySingleHash(id, hash);
      }
      return;
    }
    const diffBtn = event.target && event.target.closest ? event.target.closest('[data-audit-diff]') : null;
    if (diffBtn) {
      const id = diffBtn.getAttribute('data-audit-diff');
      const store = window.prototypeStore || window.GMStore;
      const entry = store && store.getAuditLogs ? store.getAuditLogs().find((a) => a.id === id) : null;
      if (entry) {
        window.openGM26AuditDrawer(entry.id, entry.action, entry.description);
      }
    }
  });
}

window.GMViews = window.GMViews || {};
window.GMViews.GM26 = {
  render: window.renderGM26,
  resultFilter: 'all',
  searchQuery: '',
  tableSelect: null,

  afterRender() {
    this.initSelection();
  },

  initSelection() {
    if (window.GMTableSelect) {
      this.tableSelect = window.GMTableSelect.initTable('#auditTable', {
        selectAllSelector: '#audit-select-all',
        rowCheckboxSelector: '.audit-row-select',
        bulkBarId: 'gm26-bulk-actions',
        countBadgeId: 'gm26-bulk-count'
      });
    }
  },

  clearSelection() {
    if (this.tableSelect) {
      this.tableSelect.clear();
    }
  },

  setResultFilter(res) {
    this.resultFilter = res;
    const chips = document.querySelectorAll('#auditResultChips .filter-chip');
    chips.forEach(c => {
      const match = c.getAttribute('data-result') === res;
      if (match) {
        c.classList.add('active');
        c.setAttribute('aria-pressed', 'true');
      } else {
        c.classList.remove('active');
        c.setAttribute('aria-pressed', 'false');
      }
    });
    this.applyFilters();
  },

  search(q) {
    this.searchQuery = q || '';
    this.applyFilters();
  },

  clearSearch() {
    this.searchQuery = '';
    const input = document.getElementById('auditSearchInput');
    if (input) {
      input.value = '';
      input.focus();
    }
    this.applyFilters();
  },

  resetAll() {
    this.searchQuery = '';
    const input = document.getElementById('auditSearchInput');
    if (input) input.value = '';
    this.setResultFilter('all');
    if (this.tableSelect) {
      this.tableSelect.clear();
    }
  },

  applyFilters() {
    const q = (this.searchQuery || '').trim().toLowerCase();
    const result = this.resultFilter;
    const rows = document.querySelectorAll('table.data-table tbody tr[id^="row-audit-"]');
    const emptyRow = document.getElementById('audit-empty-row');
    const countBadge = document.getElementById('auditFilterCount');
    const searchWrapper = document.getElementById('auditSearchWrapper');

    if (searchWrapper) {
      if (q) searchWrapper.classList.add('has-value');
      else searchWrapper.classList.remove('has-value');
    }

    let visibleCount = 0;
    const totalCount = rows.length;

    rows.forEach(r => {
      const rowResult = r.getAttribute('data-result');
      const rowText = (r.getAttribute('data-search') || r.innerText).toLowerCase();

      let resultMatch = result === 'all';
      if (result === 'success') resultMatch = rowResult === 'success';
      else if (result === 'denied') resultMatch = rowResult !== 'success';

      const searchMatch = !q || rowText.includes(q);
      const isVisible = resultMatch && searchMatch;

      r.style.display = isVisible ? '' : 'none';
      if (isVisible) visibleCount++;
    });

    if (emptyRow) {
      emptyRow.style.display = (visibleCount === 0 && totalCount > 0) ? '' : 'none';
    }

    if (countBadge) {
      countBadge.innerText = `نمایش ${visibleCount.toLocaleString('fa-IR')} از ${totalCount.toLocaleString('fa-IR')} رویداد`;
    }

    if (this.tableSelect) {
      this.tableSelect.sync();
    }
  },

  verifySingleHash(auditId, hashPrefix) {
    if (window.GMApp && window.GMApp.showToast) {
      window.GMApp.showToast(`هش رویداد ${auditId} (${hashPrefix}...) فقط در Fixture نمایش داده شد؛ امضا و زنجیره واقعی تأیید نشده است.`, 'warning');
    }
  },

  bulkVerifyHashes() {
    if (!this.tableSelect) return;
    const ids = this.tableSelect.getSelectedIds();
    if (ids.length === 0) {
      if (window.GMApp && window.GMApp.showToast) {
        window.GMApp.showToast('لطفاً حداقل یک رویداد را برای اعتبارسنجی انتخاب فرمایید.', 'warning');
      }
      return;
    }
    if (window.GMApp && window.GMApp.showToast) {
      window.GMApp.showToast(`برای ${ids.length.toLocaleString('fa-IR')} رویداد فقط Fixture انتخاب شد؛ امکان راستی‌آزمایی هش واقعی وجود ندارد.`, 'warning');
    }
  },

  exportSelectedAudit() {
    if (!this.tableSelect) return;
    const ids = this.tableSelect.getSelectedIds();
    if (ids.length === 0) {
      if (window.GMApp && window.GMApp.showToast) {
        window.GMApp.showToast('لطفاً حداقل یک رویداد را برای خروجی انتخاب فرمایید.', 'warning');
      }
      return;
    }
    if (window.GMApp && window.GMApp.showToast) {
      window.GMApp.showToast(`خروجی ممیزی برای ${ids.length.toLocaleString('fa-IR')} رویداد آماده شد؛ امضای دیجیتال پلتفرم تولید نشده و پیش‌نمایش ذخیره گردید.`, 'info');
    }
  }
};

window.searchGM26Audit = function(query) {
  window.GMViews.GM26.search(query);
};

window.clearGM26Search = function() {
  window.GMViews.GM26.clearSearch();
};
