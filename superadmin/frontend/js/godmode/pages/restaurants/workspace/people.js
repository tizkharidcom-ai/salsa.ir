/**
 * prototype/js/godmode/pages/restaurants/workspace/people.js
 *
 * Tab 3/5: People, Administrative Access & Role Permissions (superadmin.md §7.4 & §11).
 * Comprehensive Customer Directory, IAM Role Breakdown, Status Toggles, and Time-limited OTP Reset.
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

  function getRoleInfo(role) {
    switch (role) {
      case 'owner':
        return { label: 'مالک مجموعه', cls: 'badge-primary' };
      case 'admin':
        return { label: 'مدیر ارشد و فنی', cls: 'badge-indigo' };
      case 'manager':
        return { label: 'مدیر شعبه', cls: 'badge-info' };
      case 'accountant':
        return { label: 'حسابدار ارشد', cls: 'badge-warning' };
      case 'cashier':
        return { label: 'صندوق‌دار', cls: 'badge-neutral' };
      case 'waiter':
        return { label: 'گارسون سالن', cls: 'badge-neutral' };
      default:
        return { label: role || 'کاربر', cls: 'badge-neutral' };
    }
  }

  async function renderPeopleTab(restaurant, params) {
    const client = global.ControlPlaneClient ? (typeof global.ControlPlaneClient.getInstance === 'function' ? global.ControlPlaneClient.getInstance() : global.ControlPlaneClient) : null;
    let memberships = [];
    let membershipLoadFailed = false;

    try {
      if (!client) throw new Error('CONTROL_PLANE_CLIENT_UNAVAILABLE');
      const res = await client.get(`/api/control/identities?tenantId=${encodeURIComponent(restaurant.id)}`, { timeoutMs: 3000 });
      if (!Array.isArray(res?.data)) throw new Error('IDENTITIES_RESPONSE_INVALID');
      memberships = res.data;
    } catch (_) {
      membershipLoadFailed = true;
    }

    const totalIdentities = memberships.length;
    const activeCount = memberships.filter(m => m.status === 'active').length;
    const suspendedCount = memberships.filter(m => m.status === 'suspended').length;
    const privilegedCount = memberships.filter(m => ['owner', 'admin'].includes(m.role)).length;

    const clientDomain = restaurant.domain || `${restaurant.id}.salsa.ir`;
    const staffAdminUrl = `http://${clientDomain}/admin.html#staff`;
    const membershipsNotice = membershipLoadFailed
      ? `<div class="card" role="alert" style="margin: 0 0 1rem; padding: 1rem; border: 1px solid var(--salsa-border, #d1d5db); background: var(--salsa-surface-subtle, #f9fafb); color: var(--salsa-text-primary, #111827);">
          <span class="badge badge-warning">فهرست اعضا دریافت نشد</span>
          <p style="margin: 0.5rem 0;">برای جلوگیری از نمایش اطلاعات نادرست، تا دریافت پاسخ معتبر از سرویس هیچ عضوی نمایش داده نمی‌شود.</p>
          <button type="button" class="btn btn-secondary btn-sm" onclick="window.GodModeRouter ? window.GodModeRouter.handleRoute() : window.location.reload()">تلاش دوباره</button>
        </div>`
      : memberships.length === 0
        ? '<p role="status" style="margin: 0 0 1rem; color: var(--salsa-text-secondary, #666);">برای این مجموعه عضوی ثبت نشده است.</p>'
        : '';

    return `
      <div class="workspace-tab-panel people-panel">
        <!-- Top Action Bar -->
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; flex-wrap: wrap; gap: 1rem;">
          <div>
            <h2 style="font-size: 1.15rem; font-weight: 700; margin: 0 0 0.25rem 0;">
              دایرکتوری مدیران، پرسنل و دسترسی‌های اداری مجموعه
            </h2>
            <p style="font-size: 0.85rem; color: #666; margin: 0;">
              مدیریت هویت‌ها، نقش‌های سازمانی (RBAC)، تعلیق حساب و صدور رمز موقت اضطراری
            </p>
          </div>
          <div style="display: flex; gap: 0.75rem; flex-wrap: wrap;">
            <button type="button" class="btn btn-secondary btn-sm" onclick="window.GodModeAppShell ? window.GodModeAppShell.openInviteTenantAdminModal('${esc(restaurant.id)}') : null">
              <span>➕</span>
              <span>دعوت مدیر جدید</span>
            </button>
            <button type="button" class="btn btn-primary btn-sm" onclick="window.GodModeAppShell ? window.GodModeAppShell.openSupportDelegationModal('${esc(restaurant.id)}') : null">
              <span>🛡 تفویض دسترسی پشتیبانی (۳۰ دقیقه)</span>
            </button>
          </div>
        </div>

        ${membershipsNotice}

        <!-- Metric Pulse Strip -->
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 1rem; margin-bottom: 1.5rem;">
          <div class="card" style="padding: 1rem; border-radius: 10px; border: 1px solid var(--salsa-border, #E5E7EB); background: var(--card, #FFF);">
            <span style="font-size: 0.78rem; color: var(--text-secondary, #666); display: block; margin-bottom: 0.25rem;">کل حساب‌های کاربری</span>
            <strong style="font-size: 1.5rem; font-weight: 800; color: var(--text-primary, #111827);">${totalIdentities}</strong>
            <span style="display: block; font-size: 0.7rem; color: var(--text-tertiary, #888); margin-top: 0.25rem;">شناسه‌های اداری و پرسنل</span>
          </div>
          <div class="card" style="padding: 1rem; border-radius: 10px; border: 1px solid var(--salsa-border, #E5E7EB); background: var(--card, #FFF);">
            <span style="font-size: 0.78rem; color: #16A34A; display: block; margin-bottom: 0.25rem;">حساب‌های فعال و مجاز</span>
            <strong style="font-size: 1.5rem; font-weight: 800; color: #16A34A;">${activeCount}</strong>
            <span style="display: block; font-size: 0.7rem; color: #16A34A; margin-top: 0.25rem;">دسترسی عملیاتی بدون مانع</span>
          </div>
          <div class="card" style="padding: 1rem; border-radius: 10px; border: 1px solid var(--salsa-border, #E5E7EB); background: var(--card, #FFF);">
            <span style="font-size: 0.78rem; color: ${suspendedCount > 0 ? '#DC2626' : 'var(--text-secondary, #666)'}; display: block; margin-bottom: 0.25rem;">حساب‌های معلق / متوقف</span>
            <strong style="font-size: 1.5rem; font-weight: 800; color: ${suspendedCount > 0 ? '#DC2626' : 'var(--text-primary, #111827)'};">${suspendedCount}</strong>
            <span style="display: block; font-size: 0.7rem; color: var(--text-tertiary, #888); margin-top: 0.25rem;">ورود مسدود توسط ناظر پلتفرم</span>
          </div>
          <div class="card" style="padding: 1rem; border-radius: 10px; border: 1px solid var(--salsa-border, #E5E7EB); background: var(--card, #FFF);">
            <span style="font-size: 0.78rem; color: #4F46E5; display: block; margin-bottom: 0.25rem;">دسترسی‌های ارشد و مالکیت</span>
            <strong style="font-size: 1.5rem; font-weight: 800; color: #4F46E5;">${privilegedCount}</strong>
            <span style="display: block; font-size: 0.7rem; color: var(--text-tertiary, #888); margin-top: 0.25rem;">سطح دسترسی تام سازمان</span>
          </div>
        </div>

        <!-- Filter & Search Controls Bar -->
        <div class="card" style="border-radius: 12px; border: 1px solid var(--salsa-border, #E5E7EB); padding: 1rem 1.25rem; margin-bottom: 1.25rem; background: var(--card, #FFF);">
          <div style="display: flex; flex-direction: column; gap: 0.85rem;">
            <!-- Search Bar -->
            <div style="display: flex; gap: 0.75rem; align-items: center;">
              <div style="position: relative; flex: 1;">
                <input 
                  type="text" 
                  id="people-search-input" 
                  class="form-control" 
                  placeholder="🔍 جستجو بر اساس نام کاربر، شماره موبایل، ایمیل یا شناسه..."
                  oninput="window.GodModePeople ? window.GodModePeople.handleFilter() : null"
                  style="width: 100%; padding: 0.55rem 0.85rem; font-size: 0.85rem;"
                />
              </div>
            </div>

            <!-- Filter Pills -->
            <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.75rem;">
              <div style="display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap;" id="people-role-filter-group">
                <span style="font-size: 0.78rem; font-weight: 600; color: var(--text-secondary, #666); margin-left: 0.25rem;">نقش:</span>
                <button type="button" class="btn btn-sm btn-primary people-role-btn active" data-role="all" onclick="window.GodModePeople.setRoleFilter('all')">همه</button>
                <button type="button" class="btn btn-sm btn-secondary people-role-btn" data-role="owner" onclick="window.GodModePeople.setRoleFilter('owner')">مالک مجموعه</button>
                <button type="button" class="btn btn-sm btn-secondary people-role-btn" data-role="admin" onclick="window.GodModePeople.setRoleFilter('admin')">مدیر ارشد</button>
                <button type="button" class="btn btn-sm btn-secondary people-role-btn" data-role="manager" onclick="window.GodModePeople.setRoleFilter('manager')">مدیر شعبه</button>
                <button type="button" class="btn btn-sm btn-secondary people-role-btn" data-role="accountant" onclick="window.GodModePeople.setRoleFilter('accountant')">حسابدار</button>
                <button type="button" class="btn btn-sm btn-secondary people-role-btn" data-role="cashier" onclick="window.GodModePeople.setRoleFilter('cashier')">صندوق‌دار</button>
                <button type="button" class="btn btn-sm btn-secondary people-role-btn" data-role="waiter" onclick="window.GodModePeople.setRoleFilter('waiter')">گارسون</button>
              </div>

              <div style="display: flex; align-items: center; gap: 0.4rem;" id="people-status-filter-group">
                <span style="font-size: 0.78rem; font-weight: 600; color: var(--text-secondary, #666); margin-left: 0.25rem;">وضعیت:</span>
                <button type="button" class="btn btn-sm btn-primary people-status-btn active" data-status="all" onclick="window.GodModePeople.setStatusFilter('all')">همه</button>
                <button type="button" class="btn btn-sm btn-secondary people-status-btn" data-status="active" onclick="window.GodModePeople.setStatusFilter('active')">فعال</button>
                <button type="button" class="btn btn-sm btn-secondary people-status-btn" data-status="suspended" onclick="window.GodModePeople.setStatusFilter('suspended')">تعلیق موقت</button>
              </div>
            </div>
          </div>
        </div>

        <!-- Section 1: Tenant Identities Table -->
        <div class="card" style="border-radius: 12px; border: 1px solid var(--salsa-border, #E5E7EB); overflow: hidden; margin-bottom: 2rem; background: var(--card, #FFF);">
          <table class="data-table" id="people-table" style="width: 100%; border-collapse: collapse; font-size: 0.85rem;">
            <thead>
              <tr style="background: var(--salsa-surface-subtle, #F9FAFB); text-align: right; border-bottom: 1px solid var(--salsa-border, #E5E7EB);">
                <th style="padding: 0.85rem 1rem;">نام و هویت حساب</th>
                <th style="padding: 0.85rem 1rem;">نقش سازمانی</th>
                <th style="padding: 0.85rem 1rem;">شماره تماس / ایمیل</th>
                <th style="padding: 0.85rem 1rem;">وضعیت دسترسی</th>
                <th style="padding: 0.85rem 1rem;">امنیت (2FA)</th>
                <th style="padding: 0.85rem 1rem;">آخرین فعالیت</th>
                <th style="padding: 0.85rem 1rem; text-align: left;">اقدام‌های نظارتی</th>
              </tr>
            </thead>
            <tbody id="people-table-body">
              ${memberships.map(m => {
                const roleInfo = getRoleInfo(m.role);
                const membershipStatus = ['active', 'suspended'].includes(m.status) ? m.status : 'unknown';
                const isActive = membershipStatus === 'active';
                const initialLetter = (m.displayName || m.name || 'ک')[0];
                const searchableText = `${m.displayName || ''} ${m.name || ''} ${m.phone || ''} ${m.email || ''} ${m.id || ''} ${roleInfo.label}`.toLowerCase();

                return `
                <tr class="people-row" data-role="${esc(m.role)}" data-status="${esc(membershipStatus)}" data-searchable="${esc(searchableText)}" style="border-bottom: 1px solid var(--salsa-border, #F3F4F6);">
                  <td style="padding: 0.85rem 1rem;">
                    <div style="display: flex; align-items: center; gap: 0.6rem;">
                      <div style="width: 32px; height: 32px; border-radius: 50%; background: var(--salsa-surface-subtle, #F3F4F6); border: 1px solid var(--salsa-border, #E5E7EB); display: flex; align-items: center; justify-content: center; font-weight: 700; color: var(--salsa-primary, #111827); font-size: 0.85rem;">
                        ${esc(initialLetter)}
                      </div>
                      <div>
                        <div style="font-weight: 600; color: #111827;">${esc(m.displayName || m.name || 'کاربر')}</div>
                        <div style="font-size: 0.72rem; font-family: monospace; color: #888;">${esc(m.id)}</div>
                      </div>
                    </div>
                  </td>
                  <td style="padding: 0.85rem 1rem;">
                    <div style="display: flex; align-items: center; gap: 0.4rem;">
                      <span class="badge ${roleInfo.cls}">
                        ${esc(roleInfo.label)}
                      </span>
                      <button type="button" class="btn btn-ghost btn-xs" style="padding: 0.15rem 0.35rem; font-size: 0.72rem;" title="مشاهده حدود اختیارات" onclick="window.GodModePeople ? window.GodModePeople.viewRolePermissions('${esc(m.role)}') : null">
                        🛡 اختیارات
                      </button>
                    </div>
                  </td>
                  <td style="padding: 0.85rem 1rem;">
                    <div style="direction: ltr; text-align: right; font-family: monospace; font-size: 0.8rem;">${esc(m.phone || '—')}</div>
                    <div style="font-size: 0.75rem; color: #666;">${esc(m.email || '')}</div>
                  </td>
                  <td style="padding: 0.85rem 1rem;">
                    ${membershipStatus === 'active' ? `
                      <span class="badge badge-success" style="display: inline-flex; align-items: center; gap: 0.35rem;">
                        <span style="display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: #22C55E;"></span>
                        فعال
                      </span>
                    ` : membershipStatus === 'suspended' ? `
                      <span class="badge badge-danger" style="display: inline-flex; align-items: center; gap: 0.35rem;">
                        <span style="display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: #EF4444;"></span>
                        تعلیق موقت
                      </span>
                    ` : `
                      <span class="badge badge-neutral">نامشخص</span>
                    `}
                  </td>
                  <td style="padding: 0.85rem 1rem;">
                    ${m.mfaEnabled ? `
                      <span style="font-size: 0.75rem; color: #16A34A; display: inline-flex; align-items: center; gap: 0.25rem;">
                        <span>✓</span>
                        <span>MFA فعال</span>
                      </span>
                    ` : `
                      <span style="font-size: 0.75rem; color: #9CA3AF;">فاقد ۲FA</span>
                    `}
                  </td>
                  <td style="padding: 0.85rem 1rem; color: #666; font-size: 0.75rem;">
                    ${m.lastLoginAt ? new Date(m.lastLoginAt).toLocaleDateString('fa-IR') : '—'}
                  </td>
                  <td style="padding: 0.85rem 1rem; text-align: left;">
                    <div style="display: inline-flex; gap: 0.35rem; align-items: center;">
                      <button type="button" class="btn btn-secondary btn-xs" title="صدور کد ورود موقت و پیامکی" onclick="window.GodModePeople ? window.GodModePeople.openResetCredentialsModal('${esc(restaurant.id)}', '${esc(m.id)}', '${esc(m.displayName || m.name)}') : null">
                        🔑 رمز موقت
                      </button>
                      
                      ${membershipStatus === 'active' ? `
                        <button type="button" class="btn btn-ghost btn-xs text-danger" title="تعلیق موقت حساب کاربری" onclick="window.GodModePeople ? window.GodModePeople.openToggleStatusModal('${esc(restaurant.id)}', '${esc(m.id)}', 'active') : null">
                          ⛔ تعلیق
                        </button>
                      ` : membershipStatus === 'suspended' ? `
                        <button type="button" class="btn btn-ghost btn-xs text-success" title="رفع تعلیق حساب کاربری" onclick="window.GodModePeople ? window.GodModePeople.openToggleStatusModal('${esc(restaurant.id)}', '${esc(m.id)}', 'suspended') : null">
                          ✅ فعال‌سازی
                        </button>
                      ` : ''}

                      <button type="button" class="btn btn-ghost btn-xs text-danger" title="ابطال نشست‌های فعال" onclick="window.GodModeAppShell ? window.GodModeAppShell.openRevokeSessionsModal('${esc(restaurant.id)}', '${esc(m.id)}') : null">
                        خروج نشست
                      </button>
                    </div>
                  </td>
                </tr>
                `;
              }).join('')}
            </tbody>
          </table>
          
          <div id="people-empty-filter" style="display: none; padding: 2.5rem; text-align: center; color: #888;">
            <div style="font-size: 2rem; margin-bottom: 0.5rem;">🔍</div>
            <strong style="display: block; font-size: 0.95rem; margin-bottom: 0.25rem;">کاربری با این فیلتر یا مشخصات یافت نشد</strong>
            <p style="font-size: 0.85rem; margin: 0;">عبارت جستجو یا فیلتر نقش/وضعیت را تغییر دهید.</p>
          </div>
        </div>

        <!-- Section 2: Operational Staff Summary (Separation of Concerns) -->
        <div class="card" style="border-radius: 12px; border: 1px solid var(--salsa-border, #E5E7EB); padding: 1.5rem; background: var(--salsa-surface-subtle, #F9FAFB);">
          <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem;">
            <div>
              <strong style="font-size: 1rem; display: block; margin-bottom: 0.25rem;">
                پرسنل شیفت و عملیاتی شعبه‌ها (گارسون، صندوق‌دار، آشپزخانه)
              </strong>
              <p style="font-size: 0.85rem; color: #666; margin: 0;">
                تعریف شیفت‌های کاری، تخصیص انبار و تغییر رمز روزانه پرسنل مستقیماً توسط مدیر شعبه در پنل ابری یا کلاینت POS انجام می‌پذیرد.
              </p>
            </div>
            <div>
              <a href="${esc(staffAdminUrl)}" target="_blank" rel="noopener noreferrer" class="btn btn-secondary btn-sm">
                <span>ورود به پرتال مدیریت پرسنل مجموعه</span>
                <span>↗</span>
              </a>
            </div>
          </div>
        </div>

      </div>
    `;
  }

  const GodModePeople = {
    currentRoleFilter: 'all',
    currentStatusFilter: 'all',
    currentSearchQuery: '',

    setRoleFilter(role) {
      this.currentRoleFilter = role;
      this.updateFilterButtons();
      this.handleFilter();
    },

    setStatusFilter(status) {
      this.currentStatusFilter = status;
      this.updateFilterButtons();
      this.handleFilter();
    },

    updateFilterButtons() {
      const roleBtns = document.querySelectorAll('.people-role-btn');
      roleBtns.forEach(btn => {
        if (btn.getAttribute('data-role') === this.currentRoleFilter) {
          btn.classList.add('active', 'btn-primary');
          btn.classList.remove('btn-secondary');
        } else {
          btn.classList.remove('active', 'btn-primary');
          btn.classList.add('btn-secondary');
        }
      });
      const statusBtns = document.querySelectorAll('.people-status-btn');
      statusBtns.forEach(btn => {
        if (btn.getAttribute('data-status') === this.currentStatusFilter) {
          btn.classList.add('active', 'btn-primary');
          btn.classList.remove('btn-secondary');
        } else {
          btn.classList.remove('active', 'btn-primary');
          btn.classList.add('btn-secondary');
        }
      });
    },

    handleFilter() {
      const input = document.getElementById('people-search-input');
      const query = (input ? input.value : this.currentSearchQuery || '').toLowerCase().trim();
      const rows = document.querySelectorAll('.people-row');
      let visibleCount = 0;

      rows.forEach(row => {
        const role = row.getAttribute('data-role') || '';
        const status = row.getAttribute('data-status') || '';
        const searchable = (row.getAttribute('data-searchable') || '').toLowerCase();

        const matchRole = this.currentRoleFilter === 'all' || role === this.currentRoleFilter;
        const matchStatus = this.currentStatusFilter === 'all' || status === this.currentStatusFilter;
        const matchQuery = !query || searchable.includes(query);

        if (matchRole && matchStatus && matchQuery) {
          row.style.display = '';
          visibleCount++;
        } else {
          row.style.display = 'none';
        }
      });

      const emptyNotice = document.getElementById('people-empty-filter');
      if (emptyNotice) {
        emptyNotice.style.display = visibleCount === 0 ? '' : 'none';
      }
    },

    viewRolePermissions(role) {
      const roleDict = {
        owner: { role: 'owner', nameFa: 'مالک / مدیرعامل', scope: 'tenant', defaultPermissions: ['tenant.manage', 'branch.manage', 'billing.view', 'reports.view', 'menu.edit', 'orders.manage'], description: 'اختیارات کامل مدیریتی، مالی و عملیاتی در سطح تمامی شعب' },
        admin: { role: 'admin', nameFa: 'مدیر شعبه', scope: 'branch', defaultPermissions: ['branch.manage', 'reports.view', 'menu.edit', 'orders.manage', 'pos.operate'], description: 'مدیریت کامل شعبه، پرسنل، منو و گزارش‌های فروش' },
        cashier: { role: 'cashier', nameFa: 'صندوق‌دار', scope: 'branch', defaultPermissions: ['pos.operate', 'orders.manage', 'receipt.print'], description: 'ثبت سفارش، صدور فاکتور و دریافت وجه در صندوق' },
        waiter: { role: 'waiter', nameFa: 'گارسون سالن', scope: 'branch', defaultPermissions: ['order.create', 'order.view'], description: 'ثبت سفارش پای میز و مشاهده وضعیت آماده‌سازی' }
      };
      const roleInfo = roleDict[role] || {
        role,
        nameFa: role,
        scope: 'branch',
        defaultPermissions: [],
        permissionsDetail: [],
        description: 'دسترسی پیش‌فرض تعریف‌شده در سیستم'
      };

      const scopeFa = roleInfo.scope === 'tenant' ? 'سازمانی / تمامی شعب (Tenant-Wide)' : 'محدود به یک شعبه (Branch-Scoped)';
      const permsList = (roleInfo.permissionsDetail || []).map(p => `
        <li style="padding: 0.45rem 0; border-bottom: 1px dashed var(--salsa-border, #E5E7EB); display: flex; justify-content: space-between; align-items: center;">
          <span style="font-weight: 500; font-size: 0.85rem; color: #111827;">${esc(p.nameFa)}</span>
          <span style="font-family: monospace; font-size: 0.75rem; background: rgba(0,0,0,0.05); padding: 0.15rem 0.45rem; border-radius: 4px; color: #4B5563;">${esc(p.key)}</span>
        </li>
      `).join('');

      const content = `
        <div style="font-size: 0.9rem; line-height: 1.6; text-align: right;">
          <div style="background: var(--salsa-surface-subtle, #F9FAFB); border-radius: 8px; padding: 1rem; margin-bottom: 1.25rem; border: 1px solid var(--salsa-border, #E5E7EB);">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
              <strong style="font-size: 1.05rem; color: var(--salsa-primary, #111827);">${esc(roleInfo.nameFa)}</strong>
              <span class="badge ${roleInfo.scope === 'tenant' ? 'badge-primary' : 'badge-neutral'}">${esc(scopeFa)}</span>
            </div>
            <p style="margin: 0; font-size: 0.85rem; color: #555;">${esc(roleInfo.description)}</p>
          </div>

          <h4 style="font-size: 0.95rem; font-weight: 700; margin: 0 0 0.75rem 0; color: #111827;">اختیارات و مجوزهای سیستمی (${roleInfo.defaultPermissions?.length || 0} مورد):</h4>
          <ul style="list-style: none; padding: 0; margin: 0 0 1.25rem 0; max-height: 260px; overflow-y: auto;">
            ${permsList || '<li style="color: #888; text-align: center; padding: 1rem;">هیچ مجوز پیش‌فرضی ثبت نشده است.</li>'}
          </ul>

          <div style="font-size: 0.8rem; color: #92400E; background: #FFFBEB; border: 1px solid #FDE68A; padding: 0.75rem; border-radius: 8px;">
            ⚠️ <strong>یادآوری امنیتی:</strong> هرگونه استثنا یا override فردی بر روی این نقش در بخش «کنترل دسترسی و استثناها (Flow 3)» پلتفرم ارزیابی می‌گردد.
          </div>
        </div>
      `;

      if (global.GMApp && typeof global.GMApp.openModal === 'function') {
        global.GMApp.openModal(`اختیارات و حدود دسترسی نقش: ${roleInfo.nameFa}`, content, null, {
          cancelText: 'بستن'
        });
      }
    },

    openResetCredentialsModal(tenantId, userId, userName) {
      if (!global.GodModeConfirmDialog) return;
      global.GodModeConfirmDialog.show({
        title: `صدور رمز موقت و بازنشانی دسترسی: ${userName}`,
        severity: 'high',
        message: `آیا مایل به صدور رمز عبور موقت و پیامکی برای «${userName}» هستید؟ رمز پیشین باطل شده و یک کد ورود ۶ رقمی با انقضای ۱۵ دقیقه‌ای صادر می‌گردد.`,
        impactDetails: 'ثبت در دفترکل وقایع امنیتی با هش SHA-256 و انقضای خودکار پس از ۱۵ دقیقه.',
        requireReason: true,
        reasonPlaceholder: 'علت صدور رمز موقت (مثال: درخواست کاربر به علت فراموشی رمز، بازرسی اضطراری)...',
        confirmText: 'تولید و ثبت رمز موقت',
        onConfirm: async (reason) => {
          const client = global.ControlPlaneClient ? (typeof global.ControlPlaneClient.getInstance === 'function' ? global.ControlPlaneClient.getInstance() : global.ControlPlaneClient) : null;
          try {
            if (!client) throw new Error('اتصال به سرویس مدیریت هویت برقرار نیست.');
            const res = await client.post(`/api/control/identities/${encodeURIComponent(userId)}/reset-credentials`, { tenantId, reason });
            const tempOtp = String(res?.data?.tempOtp || '').trim();
            const expiresAt = String(res?.data?.expiresAt || '').trim();
            if (!tempOtp || !expiresAt) throw new Error('سرور صدور و ثبت رمز موقت را تأیید نکرد؛ هیچ کدی نمایش داده نشد.');
            const resContent = `
              <div style="text-align: center; padding: 1rem 0;">
                <div style="font-size: 2.5rem; margin-bottom: 0.5rem;">🔑</div>
                <h3 style="margin: 0 0 0.5rem 0; font-size: 1.15rem; font-weight: 700; color: #111827;">رمز یک‌بارمصرف با موفقیت تولید شد</h3>
                <p style="color: #666; font-size: 0.85rem; margin-bottom: 1.25rem;">
                  این کد را در اختیار کاربر مجاز قرار دهید. ورود به سامانه باید ظرف مدت ۱۵ دقیقه آینده انجام پذیرد.
                </p>
                <div style="background: #111827; color: #10B981; font-family: monospace; font-size: 2rem; letter-spacing: 0.5rem; padding: 1rem; border-radius: 8px; margin-bottom: 1rem; user-select: all; text-align: center; direction: ltr;">
                  ${esc(tempOtp)}
                </div>
                <div style="font-size: 0.8rem; color: #888;">
                  مهلت استفاده: <strong>${esc(expiresAt)}</strong> | ثبت در زنجیره لاگ‌های امنیتی پلتفرم
                </div>
              </div>
            `;
            if (global.GMApp && typeof global.GMApp.openModal === 'function') {
              global.GMApp.openModal('گواهی رمز موقت ورود', resContent, null, { cancelText: 'متوجه شدم' });
            }
            if (global.GMToast) global.GMToast.show('صدور رمز موقت از سوی سرور تأیید شد.', 'success');
            if (global.GodModeRouter) global.GodModeRouter.handleRoute();
          } catch (err) {
            if (global.GMToast) global.GMToast.show(`خطا در صدور رمز موقت: ${err.message || 'خطای سرور'}`, 'error');
            return;
          }
        }
      });
    },

    openToggleStatusModal(tenantId, userId, currentStatus) {
      const isCurrentlyActive = currentStatus === 'active';
      const targetAction = isCurrentlyActive ? 'تعلیق موقت حساب' : 'رفع تعلیق حساب';
      const severity = isCurrentlyActive ? 'high' : 'moderate';

      if (!global.GodModeConfirmDialog) return;
      global.GodModeConfirmDialog.show({
        title: `${targetAction} کاربر`,
        severity: severity,
        message: isCurrentlyActive
          ? 'با تعلیق حساب، دسترسی کاربر به تمامی بخش‌های پنل و صندوق بلافاصله قطع شده و امکان ورود جدید نخواهد داشت.'
          : 'با رفع تعلیق، حساب کاربری مجدداً فعال شده و کاربر قادر به ورود با همان مجوزهای پیشین خواهد بود.',
        impactDetails: isCurrentlyActive ? 'قطع فوری نشست‌های فعال در کلیه پایانه‌های متصل.' : 'بازیابی دسترسی با ثبت واقعه امنیتی.',
        requireReason: true,
        reasonPlaceholder: `علت ${targetAction} (مثال: بررسی تخلف مالی، پایان دوره مرخصی پرسنل)...`,
        confirmText: `تأیید و اعمال ${targetAction}`,
        onConfirm: async (reason) => {
          const client = global.ControlPlaneClient ? (typeof global.ControlPlaneClient.getInstance === 'function' ? global.ControlPlaneClient.getInstance() : global.ControlPlaneClient) : null;
          try {
            if (!client) throw new Error('اتصال به سرویس مدیریت هویت برقرار نیست.');
            await client.post(`/api/control/identities/${encodeURIComponent(userId)}/${isCurrentlyActive ? 'suspend' : 'reactivate'}`, { tenantId, reason });
            if (global.GMToast) global.GMToast.show(`وضعیت حساب کاربری با موفقیت به «${isCurrentlyActive ? 'معلق' : 'فعال'}» تغییر یافت.`, 'success');
            if (global.GodModeRouter) global.GodModeRouter.handleRoute();
          } catch (err) {
            if (global.GMToast) global.GMToast.show(`خطا در تغییر وضعیت کاربر: ${err.message || 'خطای سرور'}`, 'error');
          }
        }
      });
    },

    async getUsers(tenantId) {
      const client = global.ControlPlaneClient ? (typeof global.ControlPlaneClient.getInstance === 'function' ? global.ControlPlaneClient.getInstance() : global.ControlPlaneClient) : null;
      if (!client) return [];
      try {
        const res = await client.get(`/api/control/identities?tenantId=${encodeURIComponent(tenantId)}`);
        return Array.isArray(res?.data) ? res.data : [];
      } catch (_) {
        return [];
      }
    },

    openInviteModal(tenantId) {
      if (global.GodModeAppShell && typeof global.GodModeAppShell.openInviteTenantAdminModal === 'function') {
        global.GodModeAppShell.openInviteTenantAdminModal(tenantId);
      }
    }
  };

  global.GodModePeople = GodModePeople;

  if (global.GodModeRestaurantWorkspace) {
    global.GodModeRestaurantWorkspace.registerTabRenderer('people', renderPeopleTab);
  }
})(typeof window !== 'undefined' ? window : globalThis);
