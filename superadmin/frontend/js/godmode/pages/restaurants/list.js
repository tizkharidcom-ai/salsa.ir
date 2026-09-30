/**
 * prototype/js/godmode/pages/restaurants/list.js
 *
 * Destination 2: Restaurants List (superadmin.md §6).
 * Fast, clean organization list.
 * Search across name/domain/id/owner; filter by lifecycle/plan/attention.
 * Zero hard-coded DEFAULT_FLEET in production mode.
 */

(function (global) {
  'use strict';

  function esc(val) {
    return String(val == null ? '' : val)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  let filterState = {
    search: '',
    lifecycle: 'all',
    plan: 'all',
    onlyAttention: false
  };

  async function renderRestaurantsListPage(context = {}) {
    const restRepo = global.RestaurantsRepository;
    const StatusBadge = global.StatusBadge;
    const SourceState = global.SourceState;

    let restaurants = [];
    let meta = {};
    let loadError = null;

    try {
      if (restRepo) {
        const res = await restRepo.listRestaurants();
        restaurants = res.restaurants || [];
        meta = res.meta || {};
      }
    } catch (err) {
      loadError = err;
    }

    // Client filtering
    const searchLow = filterState.search.trim().toLowerCase();
    const filtered = restaurants.filter(r => {
      if (searchLow) {
        const matchName = (r.name || '').toLowerCase().includes(searchLow);
        const matchId = (r.id || '').toLowerCase().includes(searchLow);
        const matchDomain = (r.domain || '').toLowerCase().includes(searchLow);
        const matchOwner = (r.owner?.name || '').toLowerCase().includes(searchLow) || (r.owner?.email || '').toLowerCase().includes(searchLow);
        if (!matchName && !matchId && !matchDomain && !matchOwner) return false;
      }
      if (filterState.lifecycle !== 'all' && r.status !== filterState.lifecycle) return false;
      if (filterState.plan !== 'all' && !(r.plan || '').toLowerCase().includes(filterState.plan.toLowerCase())) return false;
      if (filterState.onlyAttention && r.health === 'healthy' && r.status === 'active') return false;
      return true;
    });

    const attentionCount = restaurants.filter(r => r.status === 'suspended' || r.health !== 'healthy').length;

    return `
      <div class="godmode-page-container restaurants-list-page">
        <!-- Page Header -->
        <div class="page-top-bar" style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 1.5rem; flex-wrap: wrap; gap: 1rem;">
          <div>
            <div style="display: flex; align-items: center; gap: 0.6rem; margin-bottom: 0.25rem;">
              <h1 style="font-size: 1.5rem; font-weight: 800; margin: 0; color: var(--salsa-text-primary, #111);">
                مجموعه‌ها و رستوران‌ها
              </h1>
              <span class="badge badge-neutral" style="font-size: 0.8rem;">
                ${restaurants.length} مجموعه ثبت‌شده
              </span>
              ${SourceState ? SourceState.renderSourceBadge(meta) : ''}
            </div>
            <p style="font-size: 0.85rem; color: var(--salsa-text-secondary, #666); margin: 0;">
              مدیریت قراردادها، شعب، اشتراک و دسترسی‌های مجموعه‌های عضو سالسا
            </p>
          </div>
          <div>
            <a href="#restaurants/new" class="btn btn-primary" style="display: inline-flex; align-items: center; gap: 0.4rem;">
              <span>➕</span>
              <span>افزودن رستوران جدید</span>
            </a>
          </div>
        </div>

        ${loadError ? `
          <div class="alert alert-danger" style="margin-bottom: 1.5rem;" role="alert">
            <strong>خطا در دریافت لیست رستوران‌ها از سرور:</strong>
            <p style="margin: 0.25rem 0 0.5rem 0;">${esc(loadError.message)}</p>
            <button class="btn btn-secondary btn-sm" onclick="window.GodModeRouter.handleRoute()">تلاش مجدد</button>
          </div>
        ` : ''}

        <!-- Search & Filter Controls -->
        <div class="card" style="padding: 1rem 1.25rem; margin-bottom: 1.5rem; border-radius: 12px; border: 1px solid var(--salsa-border, #E5E7EB);">
          <div style="display: flex; gap: 1rem; flex-wrap: wrap; align-items: center; justify-content: space-between;">
            <!-- Search Input -->
            <div style="flex: 1; min-width: 260px;">
              <input type="search"
                     id="restaurant-search-input"
                     class="form-control"
                     placeholder="جست‌وجو بر اساس نام رستوران، دامنه، شناسه یا مالک..."
                     value="${esc(filterState.search)}"
                     oninput="window.GodModeRestaurantsList ? window.GodModeRestaurantsList.onSearch(this.value) : null"
                     style="width: 100%; font-size: 0.85rem; padding: 0.5rem 0.85rem;" />
            </div>

            <!-- Filters -->
            <div style="display: flex; gap: 0.75rem; flex-wrap: wrap; align-items: center;">
              <select class="form-control"
                      style="font-size: 0.85rem; padding: 0.45rem 0.6rem;"
                      onchange="window.GodModeRestaurantsList ? window.GodModeRestaurantsList.onLifecycleFilter(this.value) : null">
                <option value="all" ${filterState.lifecycle === 'all' ? 'selected' : ''}>همه وضعیت‌ها</option>
                <option value="active" ${filterState.lifecycle === 'active' ? 'selected' : ''}>فقط فعال</option>
                <option value="trial" ${filterState.lifecycle === 'trial' ? 'selected' : ''}>آزمایشی</option>
                <option value="suspended" ${filterState.lifecycle === 'suspended' ? 'selected' : ''}>معلق</option>
              </select>

              <label style="display: inline-flex; align-items: center; gap: 0.4rem; font-size: 0.85rem; cursor: pointer; user-select: none;">
                <input type="checkbox"
                       ${filterState.onlyAttention ? 'checked' : ''}
                       onchange="window.GodModeRestaurantsList ? window.GodModeRestaurantsList.onAttentionFilter(this.checked) : null" />
                <span>فقط نیازمند رسیدگی (${attentionCount})</span>
              </label>
            </div>
          </div>
        </div>

        <!-- Restaurants Data Table -->
        <div class="card" style="border-radius: 12px; border: 1px solid var(--salsa-border, #E5E7EB); overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.03);">
          ${filtered.length === 0 ? `
            <div style="padding: 3rem; text-align: center; color: var(--salsa-text-secondary, #666);">
              <div style="font-size: 2rem; margin-bottom: 0.5rem;">🔍</div>
              <strong style="display: block; margin-bottom: 0.25rem;">مجموعه‌ای با مشخصات جست‌وجو یافت نشد</strong>
              <span style="font-size: 0.85rem;">فیلترها را پاک کنید یا رستوران جدیدی ثبت نمایید.</span>
            </div>
          ` : `
            <div class="table-responsive" style="overflow-x: auto;">
              <table class="data-table" style="width: 100%; border-collapse: collapse; font-size: 0.85rem;">
                <thead>
                  <tr style="background: var(--salsa-surface-subtle, #F9FAFB); text-align: right; border-bottom: 1px solid var(--salsa-border, #E5E7EB);">
                    <th style="padding: 0.85rem 1rem;">مجموعه</th>
                    <th style="padding: 0.85rem 1rem;">وضعیت</th>
                    <th style="padding: 0.85rem 1rem;">شعب</th>
                    <th style="padding: 0.85rem 1rem;">پلن اشتراک</th>
                    <th style="padding: 0.85rem 1rem;">وضعیت سلامت</th>
                    <th style="padding: 0.85rem 1rem;">مالک / مدیر</th>
                    <th style="padding: 0.85rem 1rem;">آخرین همگام‌سازی</th>
                    <th style="padding: 0.85rem 1rem; text-align: left;">اقدام‌ها</th>
                  </tr>
                </thead>
                <tbody id="restaurants-table-body">
                  ${filtered.map(r => {
                    const clientDomain = r.domain || `${r.id}.salsa.ir`;
                    const adminUrl = `http://${clientDomain}/admin.html`;
                    return `
                      <tr data-tenant-row="true"
                          data-name="${esc(r.name)}"
                          data-domain="${esc(clientDomain)}"
                          data-id="${esc(r.id)}"
                          data-owner="${esc(r.owner?.name || '')} ${esc(r.owner?.email || '')}"
                          data-status="${esc(r.status)}"
                          data-health="${esc(r.health)}"
                          style="border-bottom: 1px solid var(--salsa-border, #F3F4F6);">
                        <td style="padding: 0.85rem 1rem;">
                          <div style="display: flex; align-items: center; gap: 0.6rem;">
                            <div style="width: 32px; height: 32px; border-radius: 8px; background: #EEF2FF; color: #4F46E5; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 0.85rem;" aria-hidden="true">
                              ${esc(r.name.slice(0, 2))}
                            </div>
                            <div>
                              <a href="#restaurants/workspace?id=${esc(r.id)}" style="font-weight: 700; color: inherit; text-decoration: none;">
                                ${esc(r.name)}
                              </a>
                              <div style="font-size: 0.75rem; color: var(--salsa-text-muted, #888); direction: ltr; text-align: right;">
                                ${esc(clientDomain)}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td style="padding: 0.85rem 1rem;">
                          ${StatusBadge ? StatusBadge.renderLifecycleBadge(r.status) : esc(r.status)}
                        </td>
                        <td style="padding: 0.85rem 1rem; font-weight: 600;">
                          ${esc(r.branchCount)} شعبه
                        </td>
                        <td style="padding: 0.85rem 1rem;">
                          <span style="font-weight: 600;">${esc(r.plan)}</span>
                        </td>
                        <td style="padding: 0.85rem 1rem;">
                          ${StatusBadge ? StatusBadge.renderHealthBadge(r.health) : esc(r.health)}
                          ${r.attentionReason ? `<div style="font-size: 0.7rem; color: #DC2626; margin-top: 0.2rem;">${esc(r.attentionReason)}</div>` : ''}
                        </td>
                        <td style="padding: 0.85rem 1rem;">
                          <div>${esc(r.owner?.name || '—')}</div>
                          <div style="font-size: 0.75rem; color: var(--salsa-text-muted, #888);">${esc(r.owner?.phone || r.owner?.email || '')}</div>
                        </td>
                        <td style="padding: 0.85rem 1rem; color: var(--salsa-text-muted, #888); font-size: 0.75rem;">
                          ${SourceState ? SourceState.formatRelativeTime(r.lastObservedAt) : 'اخیراً'}
                        </td>
                        <td style="padding: 0.85rem 1rem; text-align: left; white-space: nowrap;">
                          <a href="#restaurants/workspace?id=${esc(r.id)}" class="btn btn-secondary btn-sm" title="مشاهده پرونده ۳۶۰ درجه مجموعه">
                            پرونده رستوران
                          </a>
                          <a href="${esc(adminUrl)}" target="_blank" rel="noopener noreferrer" class="btn btn-ghost btn-sm" title="ورود به پنل ادمین رستوران">
                            ورود ↗
                          </a>
                        </td>
                      </tr>
                    `;
                  }).join('')}
                  <tr id="restaurants-empty-search-row" style="display: none;">
                    <td colspan="8" style="padding: 3rem; text-align: center; color: var(--salsa-text-secondary, #666);">
                      <div style="font-size: 2rem; margin-bottom: 0.5rem;">🔍</div>
                      <strong style="display: block; margin-bottom: 0.25rem;">موردی با این عبارت یافت نشد</strong>
                      <span style="font-size: 0.85rem;">عبارت جست‌وجو را تغییر دهید یا فیلترها را پاک کنید.</span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          `}
        </div>
      </div>
    `;
  }

  // Filter Event Handlers
  const GodModeRestaurantsList = {
    applyFiltersInPlace() {
      const tbody = document.getElementById('restaurants-table-body');
      if (!tbody) {
        if (global.GodModeRouter) global.GodModeRouter.handleRoute();
        return;
      }
      const rows = tbody.querySelectorAll('tr[data-tenant-row]');
      const query = (filterState.search || '').trim().toLowerCase();
      let visibleCount = 0;

      rows.forEach(row => {
        const name = (row.getAttribute('data-name') || '').toLowerCase();
        const domain = (row.getAttribute('data-domain') || '').toLowerCase();
        const id = (row.getAttribute('data-id') || '').toLowerCase();
        const owner = (row.getAttribute('data-owner') || '').toLowerCase();
        const status = (row.getAttribute('data-status') || '').toLowerCase();
        const health = (row.getAttribute('data-health') || '').toLowerCase();

        const matchQuery = !query || name.includes(query) || domain.includes(query) || id.includes(query) || owner.includes(query);
        const matchLifecycle = filterState.lifecycle === 'all' || status === filterState.lifecycle;
        const matchAttention = !filterState.onlyAttention || (status !== 'active' || health !== 'healthy');

        if (matchQuery && matchLifecycle && matchAttention) {
          row.style.display = '';
          visibleCount++;
        } else {
          row.style.display = 'none';
        }
      });

      const emptyRow = document.getElementById('restaurants-empty-search-row');
      if (emptyRow) {
        emptyRow.style.display = visibleCount === 0 ? '' : 'none';
      }
    },
    onSearch(value) {
      filterState.search = value || '';
      this.applyFiltersInPlace();
    },
    onLifecycleFilter(value) {
      filterState.lifecycle = value || 'all';
      this.applyFiltersInPlace();
    },
    onAttentionFilter(checked) {
      filterState.onlyAttention = Boolean(checked);
      this.applyFiltersInPlace();
    }
  };

  global.GodModeRestaurantsList = GodModeRestaurantsList;

  // Register in Router
  if (global.GodModeRouter) {
    global.GodModeRouter.registerRenderer('restaurants', renderRestaurantsListPage);
  }

  global.renderGodModeRestaurantsList = renderRestaurantsListPage;
})(typeof window !== 'undefined' ? window : globalThis);
