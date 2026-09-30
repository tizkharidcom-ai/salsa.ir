/**
 * prototype/js/views/gm29-printers.js
 *
 * GM-29: مدیریت پرینترهای اکوسیستم و کاتالوگ سخت‌افزاری سالسا (/printers)
 * شامل:
 * ۱. ناوگان پرینترهای فعال و پیکربندی‌شده در شعب و صندوق‌ها (با اتصال زنده به پرینتر صندوق پورت ۴۱۸۰)
 * ۲. افزودن پرینتر جدید به اکوسیستم (انتخاب مدل، شعبه، پورت/IP یا USB، تنظیمات رستر و برش)
 * ۳. کاتالوگ مدل‌های سخت‌افزاری پشتیبانی‌شده پلتفرم سالسا (Epson, Bixolon, Star, Zebra...)
 * ۴. آزمون چاپ فیش مستقیم و تست سلامت ارتباط
 */

// Canonical HTML escaping
var esc = (typeof window !== 'undefined' && window.GMPageContracts && typeof window.GMPageContracts.escapeHtml === 'function')
  ? window.GMPageContracts.escapeHtml
  : function esc(v) {
      return String(v == null ? '' : v)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    };

/** Returns status badge for ecosystem printer */
function ecoPrinterStatusBadge(status) {
  const map = {
    online:  { cls: 'badge-success', dot: 'dot-green',  label: 'آنلاین و آماده' },
    busy:    { cls: 'badge-warning', dot: 'dot-amber',  label: 'در حال چاپ' },
    offline: { cls: 'badge-danger',  dot: 'dot-red',    label: 'آفلاین / بدون پاسخ' }
  };
  const s = map[status] || map.online;
  return `<span class="badge ${s.cls}"><span class="status-dot ${s.dot}"></span> ${s.label}</span>`;
}

/** Returns status badge for catalog model */
function modelStatusBadge(status) {
  const map = {
    active:     { cls: 'badge-success', dot: 'dot-green', label: 'پشتیبانی‌شده' },
    limited:    { cls: 'badge-warning', dot: 'dot-amber', label: 'پشتیبانی محدود' },
    beta:       { cls: 'badge-cyan',    dot: 'dot-blue',  label: 'آزمایشی (بتا)' },
    deprecated: { cls: 'badge-danger',  dot: 'dot-red',   label: 'منسوخ‌شده' }
  };
  const s = map[status] || map.active;
  return `<span class="badge ${s.cls}"><span class="status-dot ${s.dot}"></span> ${s.label}</span>`;
}

/** Role badge for printer purpose */
function printerRoleBadge(role, roleFa) {
  const map = {
    cashier:  { cls: 'badge-neutral', icon: '🧾' },
    kitchen:  { cls: 'badge-warning', icon: '🍳' },
    bar:      { cls: 'badge-cyan',    icon: '☕' },
    delivery: { cls: 'badge-neutral', icon: '🛵' },
    label:    { cls: 'badge-purple',  icon: '🏷️' }
  };
  const r = map[role] || { cls: 'badge-neutral', icon: '🖨️' };
  return `<span class="badge ${r.cls}" style="font-size: 0.75rem;">${r.icon} ${esc(roleFa || role)}</span>`;
}

window.renderGM29 = function(params) {
  const store = window.prototypeStore || window.GMStore;
  const subtab = (params && params.tab) || 'ecosystem'; // 'ecosystem' | 'catalog'
  const roleFilter = (params && params.role) || 'all';
  const categoryFilter = (params && params.category) || 'all';

  const ecoPrinters = store && typeof store.getEcosystemPrinters === 'function'
    ? store.getEcosystemPrinters()
    : [];

  const printerModels = store && typeof store.getPrinterModels === 'function'
    ? store.getPrinterModels()
    : [];

  // Filter ecosystem printers
  const filteredEco = roleFilter === 'all'
    ? ecoPrinters
    : ecoPrinters.filter(p => p.role === roleFilter);

  // Filter catalog models
  const filteredModels = categoryFilter === 'all'
    ? printerModels
    : printerModels.filter(p => p.category === categoryFilter);

  // Find the primary 4180 cashier printer
  const liveCashierPrinter = ecoPrinters.find(p => p.isPort4180Linked || p.code === 'cashier-main') || ecoPrinters[0];

  return `
    <div class="page-header gm29-page">
      <div class="page-title-group">
        <nav class="breadcrumb-nav" aria-label="مسیر راهبری">
          <a href="#gm-02-overview" class="breadcrumb-link">پیشخوان</a>
          <span class="breadcrumb-separator">/</span>
          <a href="#gm-27-team" class="breadcrumb-link">تنظیمات</a>
          <span class="breadcrumb-separator">/</span>
          <span class="breadcrumb-current" aria-current="page">پرینترها و تجهیزات چاپ</span>
        </nav>
        <h1>
          مدیریت پرینترهای اکوسیستم و کاتالوگ سخت‌افزاری
          <span class="badge badge-scope-global"><span class="status-dot dot-purple"></span> کلان پلتفرم</span>
          <span class="page-code-badge">GM-29</span>
        </h1>
        <p>پیکربندی پرینترهای فعال شعب، اتصال مستقیم به صندوق پورت ۴۱۸۰، و کاتالوگ مدل‌های پشتیبانی‌شده</p>
      </div>
      <div class="header-actions">
        <button class="btn btn-primary" onclick="window.openGM29AddEcosystemPrinterModal()" aria-label="افزودن پرینتر به اکوسیستم">
          ＋ افزودن پرینتر به اکوسیستم
        </button>
        <button class="btn btn-secondary" onclick="window.openGM29AddPrinterModal()" aria-label="افزودن مدل جدید به کاتالوگ">
          ＋ افزودن مدل به کاتالوگ
        </button>
      </div>
    </div>

    ${window.GMDataState ? window.GMDataState.renderFreshnessBar({
      viewId: 'GM29',
      sourceLabel: 'مدیریت پرینترها و تجهیزات چاپ سالسا',
      sourceMode: 'local',
      totalCount: ecoPrinters.length + printerModels.length,
      countLabel: 'رکورد پرینتر'
    }) : ''}

    <!-- Live Bridge Banner: Cashier Printer 4180 -->
    ${liveCashierPrinter ? `
      <div class="card" style="margin-bottom: 1.25rem; border: 1px solid var(--color-primary-light, #38bdf8); background: linear-gradient(135deg, rgba(2,132,199,0.05) 0%, rgba(14,165,233,0.02) 100%);">
        <div class="card-body" style="padding: 1.25rem; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 1rem;">
          <div style="display: flex; align-items: center; gap: 1rem;">
            <div style="width: 48px; height: 48px; border-radius: 12px; background: rgba(2,132,199,0.12); display: flex; align-items: center; justify-content: center; font-size: 1.75rem;">
              🖨️
            </div>
            <div>
              <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
                <h3 style="margin: 0; font-size: 1rem; font-weight: 800; color: var(--text-primary);">
                  ${esc(liveCashierPrinter.name)}
                </h3>
                <span class="badge badge-success" style="font-size: 0.72rem;">
                  <span class="status-dot dot-green"></span> متصل به سرویس چاپ ۴۱۸۰
                </span>
                <span class="badge badge-neutral" style="font-family: var(--font-mono); font-size: 0.72rem;">
                  کد: ${esc(liveCashierPrinter.code)}
                </span>
              </div>
              <div style="font-size: 0.813rem; color: var(--text-secondary); margin-top: 0.35rem; display: flex; gap: 1.25rem; flex-wrap: wrap;">
                <span>مدل: <strong>${esc(liveCashierPrinter.brand)} ${esc(liveCashierPrinter.model)}</strong></span>
                <span>نوع اتصال: <strong>${esc(liveCashierPrinter.transportFa)} · ${esc(liveCashierPrinter.host)}:${liveCashierPrinter.port}</strong></span>
                <span>صف USB مک: <code style="font-size: 0.75rem;">${esc(liveCashierPrinter.systemPrinterName || 'ندارد')}</code></span>
                <span>کاغذ: <strong>${liveCashierPrinter.paperWidth}mm (رستر ESC/POS)</strong></span>
                <span>برش خودکار: <strong>${liveCashierPrinter.cut ? 'فعال ✂️' : 'غیرفعال'}</strong></span>
              </div>
            </div>
          </div>
          <div style="display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap;">
            <button
              type="button"
              class="btn btn-primary btn-sm"
              onclick="window.openGM29TestPrintModal('${esc(liveCashierPrinter.id)}')"
              aria-label="تست چاپ فیش پرینتر صندوق"
            >
              🧪 آزمون چاپ آزمایشی فیش
            </button>
            <button
              type="button"
              class="btn btn-secondary btn-sm"
              onclick="window.openGM29EditEcosystemPrinterModal('${esc(liveCashierPrinter.id)}')"
              aria-label="ویرایش تنظیمات پرینتر صندوق"
            >
              ⚙️ تنظیمات اتصال
            </button>
          </div>
        </div>
      </div>
    ` : ''}

    <!-- KPI Summary Strip -->
    <div class="grid-cols-4" style="margin-bottom: 1.25rem;">
      <div class="card" style="padding: 1rem; border-right: 3px solid var(--color-primary, #0284c7);">
        <div style="font-size: 0.75rem; color: var(--text-secondary); font-weight: 600;">پرینترهای فعال اکوسیستم</div>
        <div style="font-size: 1.5rem; font-weight: 800; color: var(--text-primary); margin: 0.25rem 0;">${ecoPrinters.length.toLocaleString('fa-IR')}</div>
        <div style="font-size: 0.72rem; color: var(--text-tertiary);">مستقر در صندوق‌ها و آشپزخانه‌ها</div>
      </div>
      <div class="card" style="padding: 1rem; border-right: 3px solid #10b981;">
        <div style="font-size: 0.75rem; color: var(--text-secondary); font-weight: 600;">پرینترهای آنلاین و آماده</div>
        <div style="font-size: 1.5rem; font-weight: 800; color: #10b981; margin: 0.25rem 0;">${ecoPrinters.filter(p => p.status === 'online').length.toLocaleString('fa-IR')}</div>
        <div style="font-size: 0.72rem; color: var(--text-tertiary);">ارتباط شبکه و پورت فعال</div>
      </div>
      <div class="card" style="padding: 1rem; border-right: 3px solid #8b5cf6;">
        <div style="font-size: 0.75rem; color: var(--text-secondary); font-weight: 600;">مدل‌های کاتالوگ پلتفرم</div>
        <div style="font-size: 1.5rem; font-weight: 800; color: #8b5cf6; margin: 0.25rem 0;">${printerModels.length.toLocaleString('fa-IR')}</div>
        <div style="font-size: 0.72rem; color: var(--text-tertiary);">مدل‌های سخت‌افزاری تاییدشده</div>
      </div>
      <div class="card" style="padding: 1rem; border-right: 3px solid #f59e0b;">
        <div style="font-size: 0.75rem; color: var(--text-secondary); font-weight: 600;">پرینترهای آشپزخانه و بار</div>
        <div style="font-size: 1.5rem; font-weight: 800; color: #f59e0b; margin: 0.25rem 0;">${ecoPrinters.filter(p => p.role === 'kitchen' || p.role === 'bar').length.toLocaleString('fa-IR')}</div>
        <div style="font-size: 0.72rem; color: var(--text-tertiary);">ایستگاه‌های سفارش‌گیری</div>
      </div>
    </div>

    <!-- Sub-navigation Tabs (Ecosystem vs Catalog) -->
    <div style="display: flex; gap: 0.5rem; margin-bottom: 1.25rem; border-bottom: 1px solid var(--border-default); padding-bottom: 0.75rem;">
      <button
        type="button"
        class="filter-chip ${subtab === 'ecosystem' ? 'active' : ''}"
        onclick="window.switchGM29Tab('ecosystem')"
        style="font-size: 0.875rem; font-weight: 700; padding: 0.45rem 1rem;"
      >
        🖨️ پرینترهای فعال اکوسیستم (${ecoPrinters.length.toLocaleString('fa-IR')})
      </button>
      <button
        type="button"
        class="filter-chip ${subtab === 'catalog' ? 'active' : ''}"
        onclick="window.switchGM29Tab('catalog')"
        style="font-size: 0.875rem; font-weight: 700; padding: 0.45rem 1rem;"
      >
        📋 کاتالوگ مدل‌های پشتیبانی‌شده (${printerModels.length.toLocaleString('fa-IR')})
      </button>
    </div>

    <!-- TAB 1: ECOSYSTEM PRINTERS -->
    ${subtab === 'ecosystem' ? `
      <!-- Role Filter Chips -->
      <div style="display: flex; gap: 0.5rem; flex-wrap: wrap; margin-bottom: 1.25rem; align-items: center;">
        <span style="font-size: 0.813rem; font-weight: 600; color: var(--text-secondary); margin-left: 0.5rem;">فیلتر جایگاه:</span>
        <button type="button" class="filter-chip ${roleFilter === 'all' ? 'active' : ''}" onclick="window.filterGM29EcoRole('all')">همه جایگاه‌ها (${ecoPrinters.length})</button>
        <button type="button" class="filter-chip ${roleFilter === 'cashier' ? 'active' : ''}" onclick="window.filterGM29EcoRole('cashier')">🧾 صندوق‌های فروش (${ecoPrinters.filter(p => p.role === 'cashier').length})</button>
        <button type="button" class="filter-chip ${roleFilter === 'kitchen' ? 'active' : ''}" onclick="window.filterGM29EcoRole('kitchen')">🍳 آشپزخانه گرم (${ecoPrinters.filter(p => p.role === 'kitchen').length})</button>
        <button type="button" class="filter-chip ${roleFilter === 'bar' ? 'active' : ''}" onclick="window.filterGM29EcoRole('bar')">☕ بار و نوشیدنی (${ecoPrinters.filter(p => p.role === 'bar').length})</button>
      </div>

      <!-- Ecosystem Printers Table -->
      <div class="card" style="overflow: hidden;">
        <div class="card-header" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.75rem;">
          <div class="card-title-group">
            <h3 class="card-title">ناوگان پرینترهای مستقر در مجموعه‌ها و شعب</h3>
            <p class="card-subtitle">
              <span id="gm29EcoFilterCount">${filteredEco.length.toLocaleString('fa-IR')} پرینتر در این بخش فعال است</span>
            </p>
          </div>
          <div style="display: flex; gap: 0.5rem; align-items: center;">
            <input
              type="text"
              id="gm29EcoSearchInput"
              class="form-control"
              style="max-width: 240px; font-size: 0.85rem;"
              placeholder="جست‌وجو در پرینترها..."
              oninput="window.filterGM29EcoTable(this.value)"
              aria-label="جست‌وجو در ناوگان پرینترها"
            />
          </div>
        </div>

        ${filteredEco.length === 0 ? `
          <div class="card-body" style="text-align: center; padding: 3rem;">
            <div style="font-size: 2.5rem; margin-bottom: 0.75rem;">🖨️</div>
            <h4 style="color: var(--text-secondary); margin-bottom: 0.5rem;">هیچ پرینتری در این فیلتر ثبت نشده</h4>
            <p style="font-size: 0.85rem; color: var(--text-tertiary);">با دکمه «افزودن پرینتر به اکوسیستم» پرینتر جدید ثبت کنید.</p>
          </div>
        ` : `
          <div style="overflow-x: auto;">
            <table class="data-table" id="gm29EcoTable" aria-label="جدول پرینترهای فعال اکوسیستم">
              <thead>
                <tr>
                  <th scope="col">نام پرینتر و کاربری</th>
                  <th scope="col">مجموعه و شعبه</th>
                  <th scope="col">مدل سخت‌افزاری</th>
                  <th scope="col">نوع اتصال و آدرس</th>
                  <th scope="col">مشخصات چاپ</th>
                  <th scope="col">وضعیت ارتباط</th>
                  <th scope="col">اقدامات</th>
                </tr>
              </thead>
              <tbody id="gm29EcoTableBody">
                ${filteredEco.map(p => `
                  <tr data-eco-id="${esc(p.id)}" data-search-text="${esc(p.name + ' ' + p.code + ' ' + p.brand + ' ' + p.model + ' ' + p.tenantName + ' ' + (p.host || ''))}">
                    <td>
                      <div style="display: flex; align-items: center; gap: 0.4rem;">
                        <span style="font-weight: 700; color: var(--text-primary); font-size: 0.9rem;">${esc(p.name)}</span>
                        ${p.isPort4180Linked ? '<span class="badge badge-primary" style="font-size: 0.65rem;" title="متصل به سرویس پورت ۴۱۸۰">۴۱۸۰</span>' : ''}
                      </div>
                      <div style="display: flex; align-items: center; gap: 0.5rem; margin-top: 0.25rem;">
                        <span class="cell-mono" style="font-size: 0.75rem; color: var(--text-secondary);">${esc(p.code)}</span>
                        ${printerRoleBadge(p.role, p.roleFa)}
                      </div>
                      ${p.notes ? `<div style="font-size: 0.72rem; color: var(--text-tertiary); margin-top: 0.2rem;">${esc(p.notes)}</div>` : ''}
                    </td>
                    <td>
                      <div style="font-weight: 600; color: var(--text-primary); font-size: 0.85rem;">${esc(p.tenantName)}</div>
                      <div style="font-size: 0.75rem; color: var(--text-secondary);">${esc(p.branchName)}</div>
                    </td>
                    <td>
                      <div style="font-weight: 700; font-size: 0.85rem;">${esc(p.brand)}</div>
                      <div class="cell-mono" style="font-size: 0.78rem; color: var(--text-secondary);">${esc(p.model)}</div>
                    </td>
                    <td>
                      <div>
                        <span class="badge badge-neutral" style="font-size: 0.72rem;">${esc(p.transportFa)}</span>
                      </div>
                      ${p.transport === 'network' ? `
                        <div class="cell-mono" style="font-size: 0.8rem; margin-top: 0.25rem; font-weight: 600;">${esc(p.host)}:${p.port}</div>
                      ` : `
                        <div class="cell-mono" style="font-size: 0.75rem; margin-top: 0.25rem; color: var(--text-secondary);">صف: ${esc(p.systemPrinterName || 'پیش‌فرض سیستم')}</div>
                      `}
                    </td>
                    <td>
                      <div style="font-size: 0.8rem;">رول ${p.paperWidth}mm · ${p.renderMode === 'raster' ? 'رستر گرافیکی' : 'متنی'}</div>
                      <div style="font-size: 0.72rem; color: var(--text-secondary); margin-top: 0.2rem; display: flex; gap: 0.5rem;">
                        <span>${p.cut ? '✂️ برش خودکار' : 'بدون برش'}</span>
                        <span>${p.cashdrawer ? '💰 کشو پول' : ''}</span>
                      </div>
                    </td>
                    <td>
                      <div>${ecoPrinterStatusBadge(p.status)}</div>
                      <div style="font-size: 0.72rem; color: var(--text-tertiary); margin-top: 0.25rem;">${esc(p.lastPrintAt)}</div>
                    </td>
                    <td>
                      <div style="display: flex; gap: 0.35rem; flex-wrap: wrap;">
                        <button
                          type="button"
                          class="btn btn-xs btn-primary"
                          onclick="window.openGM29TestPrintModal('${esc(p.id)}')"
                          aria-label="تست چاپ فیش"
                          title="آزمون چاپ فیش و تست ارتباط"
                        >🧪 تست فیش</button>
                        <button
                          type="button"
                          class="btn btn-xs btn-secondary"
                          onclick="window.openGM29EditEcosystemPrinterModal('${esc(p.id)}')"
                          aria-label="ویرایش پرینتر"
                          title="ویرایش تنظیمات"
                        >✏️</button>
                        <button
                          type="button"
                          class="btn btn-xs btn-danger-outline"
                          onclick="window.confirmGM29DeleteEcosystemPrinter('${esc(p.id)}', '${esc(p.name)}')"
                          aria-label="حذف پرینتر"
                          title="حذف پرینتر از اکوسیستم"
                          style="background: transparent; border: 1px solid rgba(239,68,68,0.5); color: #ef4444; padding: 0.2rem 0.4rem; border-radius: 6px; font-size: 0.75rem; cursor: pointer;"
                        >🗑️</button>
                      </div>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        `}
      </div>
    ` : `
      <!-- TAB 2: HARDWARE CATALOG -->
      <!-- Category Filter Chips -->
      <div style="display: flex; gap: 0.5rem; flex-wrap: wrap; margin-bottom: 1.25rem; align-items: center;">
        <span style="font-size: 0.813rem; font-weight: 600; color: var(--text-secondary); margin-left: 0.5rem;">دسته‌بندی کاتالوگ:</span>
        <button type="button" class="filter-chip ${categoryFilter === 'all' ? 'active' : ''}" onclick="window.filterGM29Category('all')">همه مدل‌ها (${printerModels.length})</button>
        <button type="button" class="filter-chip ${categoryFilter === 'receipt' ? 'active' : ''}" onclick="window.filterGM29Category('receipt')">🧾 پرینتر فیش (${printerModels.filter(p => p.category === 'receipt').length})</button>
        <button type="button" class="filter-chip ${categoryFilter === 'kitchen' ? 'active' : ''}" onclick="window.filterGM29Category('kitchen')">🍳 پرینتر آشپزخانه (${printerModels.filter(p => p.category === 'kitchen').length})</button>
        <button type="button" class="filter-chip ${categoryFilter === 'label' ? 'active' : ''}" onclick="window.filterGM29Category('label')">🏷️ لیبل و بارکد (${printerModels.filter(p => p.category === 'label').length})</button>
      </div>

      <!-- Printer Models Table -->
      <div class="card" style="overflow: hidden;">
        <div class="card-header" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.75rem;">
          <div class="card-title-group">
            <h3 class="card-title">مدل‌های سخت‌افزاری پشتیبانی‌شده در پلتفرم سالسا</h3>
            <p class="card-subtitle">
              <span id="gm29ModelFilterCount">${filteredModels.length.toLocaleString('fa-IR')} مدل در کاتالوگ ثبت است</span>
            </p>
          </div>
          <div style="display: flex; gap: 0.5rem; align-items: center;">
            <input
              type="text"
              id="gm29ModelSearchInput"
              class="form-control"
              style="max-width: 240px; font-size: 0.85rem;"
              placeholder="جست‌وجو در کاتالوگ..."
              oninput="window.filterGM29ModelTable(this.value)"
              aria-label="جست‌وجو در کاتالوگ مدل‌ها"
            />
          </div>
        </div>

        <div style="overflow-x: auto;">
          <table class="data-table" id="gm29ModelsTable" aria-label="جدول مدل‌های سخت‌افزاری پرینتر">
            <thead>
              <tr>
                <th scope="col">برند و مدل</th>
                <th scope="col">دسته‌بندی</th>
                <th scope="col">رابط اتصال</th>
                <th scope="col">کاغذ / DPI</th>
                <th scope="col">سرعت</th>
                <th scope="col">قیچی / کشو</th>
                <th scope="col">ماژول‌های سازگار</th>
                <th scope="col">وضعیت پشتیبانی</th>
                <th scope="col">اقدام</th>
              </tr>
            </thead>
            <tbody id="gm29ModelsTableBody">
              ${filteredModels.map(p => `
                <tr data-model-id="${esc(p.id)}" data-search-text="${esc(p.brand + ' ' + p.model + ' ' + (p.categoryFa || ''))}">
                  <td>
                    <div style="font-weight: 700; color: var(--text-primary); font-size: 0.9rem;">${esc(p.brand)}</div>
                    <div class="cell-mono" style="font-size: 0.8rem; color: var(--text-secondary);">${esc(p.model)}</div>
                    ${p.notes ? `
                      <details class="row-disclosure" style="margin-top: 0.3rem;">
                        <summary style="font-size: 0.72rem; color: var(--text-tertiary); cursor: pointer;">توضیحات فنی</summary>
                        <div style="font-size: 0.75rem; color: var(--text-secondary); margin-top: 0.25rem; max-width: 280px; line-height: 1.5;">${esc(p.notes)}</div>
                      </details>
                    ` : ''}
                  </td>
                  <td>
                    <span style="font-size: 0.813rem;">${esc(p.categoryFa)}</span>
                  </td>
                  <td>
                    <div style="display: flex; flex-wrap: wrap; gap: 0.25rem;">
                      ${(p.interface || []).map(iface => `
                        <span class="badge badge-neutral" style="font-size: 0.68rem; font-family: var(--font-mono);">${esc(iface)}</span>
                      `).join('')}
                    </div>
                  </td>
                  <td class="cell-mono" style="font-size: 0.813rem; white-space: nowrap;">
                    <div>${p.paperWidth ? `${p.paperWidth}mm` : '—'}</div>
                    <div style="color: var(--text-secondary); font-size: 0.75rem;">${p.dpi ? `${p.dpi} DPI` : '—'}</div>
                  </td>
                  <td class="cell-mono" style="font-size: 0.813rem;">
                    ${p.speedMmPerSec ? `${p.speedMmPerSec} mm/s` : '<span style="color: var(--text-tertiary);">—</span>'}
                  </td>
                  <td style="text-align: center;">
                    <div style="display: flex; gap: 0.5rem; justify-content: center;">
                      <span title="قیچی خودکار" style="font-size: 1.1rem;">${p.cutter ? '✂️' : '<span style="opacity: 0.3;">✂️</span>'}</span>
                      <span title="خروجی کشو پول" style="font-size: 1.1rem;">${p.cashdrawer ? '💰' : '<span style="opacity: 0.3;">💰</span>'}</span>
                    </div>
                  </td>
                  <td>
                    <div style="display: flex; flex-direction: column; gap: 0.2rem;">
                      ${(p.compatibleFeatures || []).slice(0, 3).map(f => `
                        <span class="badge badge-neutral" style="font-size: 0.68rem; font-family: var(--font-mono);">${esc(f)}</span>
                      `).join('')}
                    </div>
                  </td>
                  <td>${modelStatusBadge(p.status)}</td>
                  <td>
                    <div style="display: flex; gap: 0.35rem; flex-wrap: wrap;">
                      <button
                        type="button"
                        class="btn btn-xs btn-secondary"
                        onclick="window.openGM29EditPrinterModal('${esc(p.id)}')"
                        aria-label="ویرایش مدل"
                      >✏️</button>
                      <button
                        type="button"
                        class="btn btn-xs btn-danger-outline"
                        onclick="window.confirmGM29DeletePrinter('${esc(p.id)}', '${esc(p.brand)} ${esc(p.model)}')"
                        aria-label="حذف مدل"
                        style="background: transparent; border: 1px solid rgba(239,68,68,0.5); color: #ef4444; padding: 0.2rem 0.4rem; border-radius: 6px; font-size: 0.75rem; cursor: pointer;"
                      >🗑️</button>
                    </div>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `}

    <!-- Technical Guide Card -->
    <div class="card" style="margin-top: 1.25rem;">
      <div class="card-header">
        <div class="card-title-group">
          <h3 class="card-title">راهنمای معماری چاپ مستقیم در سالسا وستو</h3>
          <p class="card-subtitle">چاپ بدون دیالوگ پرینت مرورگر با استفاده از درایور داخلی سرور پورت ۴۱۸۰</p>
        </div>
      </div>
      <div class="card-body">
        <div class="grid-cols-3" style="gap: 1rem;">
          <div style="background: var(--bg-surface-subtle); border: 1px solid var(--border-subtle); border-radius: 10px; padding: 1rem;">
            <div style="font-size: 1.25rem; margin-bottom: 0.5rem;">🔌</div>
            <h4 style="font-size: 0.875rem; font-weight: 700; color: var(--text-primary); margin-bottom: 0.4rem;">اتصال مستقیم شبکه (Raw Socket)</h4>
            <p style="font-size: 0.8rem; color: var(--text-secondary); line-height: 1.6;">سرور ۴۱۸۰ مستقیماً یک سوکت TCP به پورت ۹۱۰۰ پرینتر در شبکه محلی باز کرده و بایت‌های ESC/POS را با عرض ۸۰mm ارسال می‌کند.</p>
          </div>
          <div style="background: var(--bg-surface-subtle); border: 1px solid var(--border-subtle); border-radius: 10px; padding: 1rem;">
            <div style="font-size: 1.25rem; margin-bottom: 0.5rem;">💻</div>
            <h4 style="font-size: 0.875rem; font-weight: 700; color: var(--text-primary); margin-bottom: 0.4rem;">صف چاپ USB محلی (macOS / Linux)</h4>
            <p style="font-size: 0.8rem; color: var(--text-secondary); line-height: 1.6;">در صورت اتصال کابلی USB، دستور خام به صف چاپ سیستم با فلگ raw ارسال می‌شود (توسط lpstat/lp) تا پنجره پیش‌نمایش پرینت باز نشود.</p>
          </div>
          <div style="background: var(--bg-surface-subtle); border: 1px solid var(--border-subtle); border-radius: 10px; padding: 1rem;">
            <div style="font-size: 1.25rem; margin-bottom: 0.5rem;">🖼️</div>
            <h4 style="font-size: 0.875rem; font-weight: 700; color: var(--text-primary); margin-bottom: 0.4rem;">رندرینگ گرافیکی رستر (ESC/POS Raster)</h4>
            <p style="font-size: 0.8rem; color: var(--text-secondary); line-height: 1.6;">برای چاپ بدون نقص فونت‌های فارسی و مبالغ ریالی/تومانی، فیش به بیت‌مپ سیاه و سفید تک‌بیتی تبدیل شده و به صورت رستر ارسال می‌گردد.</p>
          </div>
        </div>
      </div>
    </div>
  `;
};

// --- INTERACTIVE ACTIONS & NAVIGATION ---

/** Switch between Ecosystem and Catalog sub-tabs */
window.switchGM29Tab = function(tabName) {
  window.location.hash = `#gm-29-printers?tab=${tabName}`;
};

/** Filter ecosystem printers by role */
window.filterGM29EcoRole = function(role) {
  window.location.hash = `#gm-29-printers?tab=ecosystem&role=${role}`;
};

/** Filter catalog models by category */
window.filterGM29Category = function(category) {
  window.location.hash = `#gm-29-printers?tab=catalog&category=${category}`;
};

/** Live search in Ecosystem table */
window.filterGM29EcoTable = function(query) {
  const q = (query || '').trim().toLowerCase();
  const tbody = document.getElementById('gm29EcoTableBody');
  const countEl = document.getElementById('gm29EcoFilterCount');
  if (!tbody) return;

  let visible = 0;
  tbody.querySelectorAll('tr[data-eco-id]').forEach(row => {
    const text = (row.getAttribute('data-search-text') || '').toLowerCase();
    const match = !q || text.includes(q);
    row.style.display = match ? '' : 'none';
    if (match) visible++;
  });

  if (countEl) {
    countEl.textContent = `${visible.toLocaleString('fa-IR')} پرینتر نمایش داده می‌شود`;
  }
};

/** Live search in Catalog table */
window.filterGM29ModelTable = function(query) {
  const q = (query || '').trim().toLowerCase();
  const tbody = document.getElementById('gm29ModelsTableBody');
  const countEl = document.getElementById('gm29ModelFilterCount');
  if (!tbody) return;

  let visible = 0;
  tbody.querySelectorAll('tr[data-model-id]').forEach(row => {
    const text = (row.getAttribute('data-search-text') || '').toLowerCase();
    const match = !q || text.includes(q);
    row.style.display = match ? '' : 'none';
    if (match) visible++;
  });

  if (countEl) {
    countEl.textContent = `${visible.toLocaleString('fa-IR')} مدل نمایش داده می‌شود`;
  }
};

// Legacy filter alias
window.filterGM29Printers = window.filterGM29Category;
window.filterGM29Table = window.filterGM29ModelTable;

// --- MODAL: ADD PRINTER TO ECOSYSTEM ---

window.openGM29AddEcosystemPrinterModal = function() {
  const store = window.prototypeStore || window.GMStore;
  const tenants = store && store.getTenants ? store.getTenants() : [{ id: 'tnt_westo_demo', name: 'کافه وستو (Westo Café)' }];
  const models = store && store.getPrinterModels ? store.getPrinterModels() : [];

  const modelOptions = models.map(m => `
    <option value="${esc(m.id)}" data-brand="${esc(m.brand)}" data-model="${esc(m.model)}" data-width="${m.paperWidth || 80}" data-cutter="${m.cutter ? '1' : '0'}" data-drawer="${m.cashdrawer ? '1' : '0'}">
      ${esc(m.brand)} ${esc(m.model)} (${esc(m.categoryFa)})
    </option>
  `).join('');

  const tenantOptions = tenants.map(t => `
    <option value="${esc(t.id)}">${esc(t.name)}</option>
  `).join('');

  const content = `
    <div style="display: flex; flex-direction: column; gap: 1rem;">
      <div class="op-context-banner op-context-info" style="font-size: 0.813rem; padding: 0.65rem 0.85rem; border-radius: 8px; background: rgba(2,132,199,0.08); border: 1px solid rgba(2,132,199,0.2);">
        <span>ℹ️ پرینترهای ثبت‌شده بلافاصله در دسترس صندوق، سفارش‌گیر و نمایشگر KDS مشتریان قرار می‌گیرند.</span>
      </div>

      <div class="grid-cols-2" style="gap: 0.75rem;">
        <div class="form-group">
          <label class="form-label" for="gm29a-name">نام پرینتر در سامانه <span class="field-badge field-required">الزامی</span></label>
          <input type="text" id="gm29a-name" class="form-control" placeholder="مثال: پرینتر صندوق شماره ۲" value="پرینتر صندوق ۲" />
        </div>
        <div class="form-group">
          <label class="form-label" for="gm29a-code">شناسه سیستمی (کد کوتاه)</label>
          <input type="text" id="gm29a-code" class="form-control cell-mono" placeholder="مثال: cashier-02" value="cashier-02" />
        </div>
      </div>

      <div class="grid-cols-2" style="gap: 0.75rem;">
        <div class="form-group">
          <label class="form-label" for="gm29a-tenant">مجموعه / رستوران</label>
          <select id="gm29a-tenant" class="form-control">
            ${tenantOptions}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label" for="gm29a-role">جایگاه و کاربری پرینتر</label>
          <select id="gm29a-role" class="form-control">
            <option value="cashier">🧾 صندوق فروش (صدور فیش مشتری و پیش‌فاکتور)</option>
            <option value="kitchen">🍳 آشپزخانه گرم (KOT - فیش آماده‌سازی غذا)</option>
            <option value="bar">☕ بار و کافی‌شاپ (سفارش نوشیدنی)</option>
            <option value="delivery">🛵 تحویل و دلیوری (فیش پیک و آدرس)</option>
            <option value="label">🏷️ انبار و بارکد (چاپ لیبل مواد مصرفی)</option>
          </select>
        </div>
      </div>

      <div class="form-group">
        <label class="form-label" for="gm29a-model">مدل سخت‌افزاری تاییدشده</label>
        <select id="gm29a-model" class="form-control" onchange="window.onGM29ModelSelectChange(this)">
          ${modelOptions}
        </select>
      </div>

      <div style="background: var(--bg-surface-subtle); border: 1px solid var(--border-default); border-radius: 8px; padding: 0.85rem;">
        <div style="font-weight: 700; font-size: 0.85rem; margin-bottom: 0.65rem; color: var(--text-primary);">پیکربندی اتصال به پرینتر (Transport)</div>
        
        <div style="display: flex; gap: 1.5rem; margin-bottom: 0.75rem;">
          <label style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer; font-size: 0.85rem;">
            <input type="radio" name="gm29a-transport" value="network" checked onchange="window.toggleGM29TransportMode('network')" />
            <span><b>شبکه محلی (LAN / Wi-Fi)</b></span>
          </label>
          <label style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer; font-size: 0.85rem;">
            <input type="radio" name="gm29a-transport" value="system" onchange="window.toggleGM29TransportMode('system')" />
            <span><b>USB / صف چاپ سیستم (macOS / Linux)</b></span>
          </label>
        </div>

        <div id="gm29a-net-panel" class="grid-cols-2" style="gap: 0.75rem;">
          <div class="form-group">
            <label class="form-label" for="gm29a-host">آدرس IP در شبکه محلی</label>
            <input type="text" id="gm29a-host" class="form-control cell-mono" placeholder="192.168.1.120" value="192.168.1.120" />
          </div>
          <div class="form-group">
            <label class="form-label" for="gm29a-port">پورت ارتباطی RAW</label>
            <input type="number" id="gm29a-port" class="form-control cell-mono" value="9100" />
          </div>
        </div>

        <div id="gm29a-sys-panel" class="form-group" style="display: none; margin-top: 0.5rem;">
          <label class="form-label" for="gm29a-queue">نام صف پرینتر نصب‌شده در سیستم (CUPS lpstat)</label>
          <input type="text" id="gm29a-queue" class="form-control cell-mono" placeholder="مثال: _192_168_254_120 یا BIXOLON_SRP_350III" value="_192_168_254_120" />
          <small style="color: var(--text-tertiary); font-size: 0.75rem; margin-top: 0.25rem; display: block;">نام پرینتر را همان‌طور که در تنظیمات Printers & Scanners سیستم ثبت شده وارد کنید.</small>
        </div>
      </div>

      <div class="grid-cols-2" style="gap: 0.75rem;">
        <div class="form-group">
          <label class="form-label" for="gm29a-paperwidth">عرض کاغذ حرارتی (mm)</label>
          <select id="gm29a-paperwidth" class="form-control">
            <option value="80" selected>۸۰ میلی‌متر (رول استاندارد فیش)</option>
            <option value="58">۵۸ میلی‌متر (رول کوچک / پوز سیار)</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label" for="gm29a-rendermode">حالت ارسال داده چاپ</label>
          <select id="gm29a-rendermode" class="form-control">
            <option value="raster" selected>رستر گرافیکی ESC/POS (توصیه‌شده - پشتیبانی کامل فونت فارسی)</option>
            <option value="text">متنی مستقیم ESC/POS (کدپیج داخلی)</option>
          </select>
        </div>
      </div>

      <div style="display: flex; gap: 1.5rem; flex-wrap: wrap;">
        <label style="display: flex; align-items: center; gap: 0.5rem; font-size: 0.875rem; cursor: pointer;">
          <input type="checkbox" id="gm29a-cut" checked /> فعال بودن قیچی خودکار (Auto-Cut)
        </label>
        <label style="display: flex; align-items: center; gap: 0.5rem; font-size: 0.875rem; cursor: pointer;">
          <input type="checkbox" id="gm29a-drawer" checked /> پالس باز شدن کشو پول (Drawer Kick)
        </label>
      </div>

      <div class="form-group">
        <label class="form-label" for="gm29a-notes">توضیحات محل استقرار (اختیاری)</label>
        <input type="text" id="gm29a-notes" class="form-control" placeholder="مثال: مستقر در باجه اصلی سفارش‌گیری کنار صندوق ۱" />
      </div>
    </div>
  `;

  if (window.GMApp && window.GMApp.openModal) {
    window.GMApp.openModal('ثبت و اتصال پرینتر جدید به اکوسیستم', content, () => {
      const name = (document.getElementById('gm29a-name')?.value || '').trim();
      if (!name) {
        if (window.GMApp.showToast) window.GMApp.showToast('نام پرینتر الزامی است.', 'error');
        return false;
      }

      const tenantSelect = document.getElementById('gm29a-tenant');
      const tenantId = tenantSelect?.value || 'tnt_westo_demo';
      const tenantName = tenantSelect?.options[tenantSelect.selectedIndex]?.text || 'کافه وستو (Westo Café)';

      const modelSelect = document.getElementById('gm29a-model');
      const selectedOption = modelSelect?.options[modelSelect?.selectedIndex];
      const modelId = modelSelect?.value || 'prn_bixolon_srp350iii';
      const brand = selectedOption?.getAttribute('data-brand') || 'BIXOLON';
      const model = selectedOption?.getAttribute('data-model') || 'SRP-350III';

      const role = document.getElementById('gm29a-role')?.value || 'cashier';
      const roleFaMap = {
        cashier: 'صندوق فروش (POS)',
        kitchen: 'آشپزخانه گرم (KOT)',
        bar: 'بار و کافی‌شاپ',
        delivery: 'تحویل و دلیوری',
        label: 'انبار و بارکد'
      };

      const transportRadio = document.querySelector('input[name="gm29a-transport"]:checked');
      const transport = transportRadio ? transportRadio.value : 'network';

      const host = (document.getElementById('gm29a-host')?.value || '192.168.1.120').trim();
      const port = parseInt(document.getElementById('gm29a-port')?.value || '9100', 10);
      const queue = (document.getElementById('gm29a-queue')?.value || '').trim();

      const paperWidth = parseInt(document.getElementById('gm29a-paperwidth')?.value || '80', 10);
      const renderMode = document.getElementById('gm29a-rendermode')?.value || 'raster';
      const cut = document.getElementById('gm29a-cut')?.checked !== false;
      const drawer = document.getElementById('gm29a-drawer')?.checked !== false;
      const notes = (document.getElementById('gm29a-notes')?.value || '').trim();
      const code = (document.getElementById('gm29a-code')?.value || ('prn-' + Math.floor(100 + Math.random() * 900))).trim();

      if (store && typeof store.addEcosystemPrinter === 'function') {
        store.addEcosystemPrinter({
          name,
          code,
          tenantId,
          tenantName,
          branchId: 1,
          branchName: 'شعبه اصلی',
          modelId,
          brand,
          model,
          role,
          roleFa: roleFaMap[role] || role,
          transport,
          transportFa: transport === 'system' ? 'USB / سیستم' : 'شبکه (LAN)',
          host,
          port,
          systemPrinterName: queue,
          paperWidth,
          charsPerLine: paperWidth === 58 ? 32 : 48,
          renderMode,
          encoding: 'windows-1256',
          codePage: 40,
          cut,
          cashdrawer: drawer,
          status: 'online',
          statusFa: 'آنلاین و آماده',
          notes,
          addedAt: new Date().toLocaleDateString('fa-IR')
        });
      }

      if (window.GMApp && window.GMApp.showToast) {
        window.GMApp.showToast(`پرینتر «${name}» با موفقیت به اکوسیستم اضافه شد.`, 'success');
      }

      if (window.GMRouter && typeof window.GMRouter.refresh === 'function') {
        window.GMRouter.refresh();
      }
      return true;
    }, { confirmLabel: 'ثبت و اتصال پرینتر', cancelLabel: 'انصراف' });
  }
};

window.onGM29ModelSelectChange = function(selectEl) {
  const opt = selectEl.options[selectEl.selectedIndex];
  if (!opt) return;
  const width = opt.getAttribute('data-width') || '80';
  const cutter = opt.getAttribute('data-cutter') === '1';
  const drawer = opt.getAttribute('data-drawer') === '1';

  const widthEl = document.getElementById('gm29a-paperwidth');
  const cutEl = document.getElementById('gm29a-cut');
  const drawEl = document.getElementById('gm29a-drawer');

  if (widthEl) widthEl.value = width;
  if (cutEl) cutEl.checked = cutter;
  if (drawEl) drawEl.checked = drawer;
};

window.toggleGM29TransportMode = function(mode) {
  const net = document.getElementById('gm29a-net-panel');
  const sys = document.getElementById('gm29a-sys-panel');
  if (net && sys) {
    if (mode === 'network') {
      net.style.display = 'grid';
      sys.style.display = 'none';
    } else {
      net.style.display = 'none';
      sys.style.display = 'block';
    }
  }
};

// --- MODAL: EDIT ECOSYSTEM PRINTER ---

window.openGM29EditEcosystemPrinterModal = function(printerId) {
  const store = window.prototypeStore || window.GMStore;
  const printers = store && typeof store.getEcosystemPrinters === 'function' ? store.getEcosystemPrinters() : [];
  const printer = printers.find(p => p.id === printerId);
  if (!printer) return;

  function sel(a, b) { return a === b ? 'selected' : ''; }

  const content = `
    <div style="display: flex; flex-direction: column; gap: 1rem;">
      <div class="grid-cols-2" style="gap: 0.75rem;">
        <div class="form-group">
          <label class="form-label" for="gm29e-name">نام پرینتر</label>
          <input type="text" id="gm29e-name" class="form-control" value="${esc(printer.name)}" />
        </div>
        <div class="form-group">
          <label class="form-label" for="gm29e-code">شناسه سیستمی</label>
          <input type="text" id="gm29e-code" class="form-control cell-mono" value="${esc(printer.code)}" />
        </div>
      </div>

      <div class="grid-cols-2" style="gap: 0.75rem;">
        <div class="form-group">
          <label class="form-label" for="gm29e-host">آدرس IP شبکه</label>
          <input type="text" id="gm29e-host" class="form-control cell-mono" value="${esc(printer.host || '192.168.1.100')}" />
        </div>
        <div class="form-group">
          <label class="form-label" for="gm29e-port">پورت RAW</label>
          <input type="number" id="gm29e-port" class="form-control cell-mono" value="${printer.port || 9100}" />
        </div>
      </div>

      <div class="form-group">
        <label class="form-label" for="gm29e-queue">نام صف پرینتر در سیستم (CUPS lpstat)</label>
        <input type="text" id="gm29e-queue" class="form-control cell-mono" value="${esc(printer.systemPrinterName || '')}" />
      </div>

      <div class="grid-cols-2" style="gap: 0.75rem;">
        <div class="form-group">
          <label class="form-label" for="gm29e-paperwidth">عرض کاغذ (mm)</label>
          <input type="number" id="gm29e-paperwidth" class="form-control" value="${printer.paperWidth || 80}" />
        </div>
        <div class="form-group">
          <label class="form-label" for="gm29e-status">وضعیت ارتباط</label>
          <select id="gm29e-status" class="form-control">
            <option value="online" ${sel(printer.status, 'online')}>آنلاین و فعال</option>
            <option value="busy" ${sel(printer.status, 'busy')}>مشغول به چاپ</option>
            <option value="offline" ${sel(printer.status, 'offline')}>آفلاین / غیرفعال</option>
          </select>
        </div>
      </div>

      <div style="display: flex; gap: 1.5rem; flex-wrap: wrap;">
        <label style="display: flex; align-items: center; gap: 0.5rem; font-size: 0.875rem; cursor: pointer;">
          <input type="checkbox" id="gm29e-cut" ${printer.cut ? 'checked' : ''} /> برش خودکار
        </label>
        <label style="display: flex; align-items: center; gap: 0.5rem; font-size: 0.875rem; cursor: pointer;">
          <input type="checkbox" id="gm29e-drawer" ${printer.cashdrawer ? 'checked' : ''} /> اتصال به کشو پول
        </label>
      </div>

      <div class="form-group">
        <label class="form-label" for="gm29e-notes">یادداشت</label>
        <input type="text" id="gm29e-notes" class="form-control" value="${esc(printer.notes || '')}" />
      </div>
    </div>
  `;

  if (window.GMApp && window.GMApp.openModal) {
    window.GMApp.openModal(`ویرایش پرینتر: ${printer.name}`, content, () => {
      const name = (document.getElementById('gm29e-name')?.value || '').trim();
      if (!name) {
        if (window.GMApp.showToast) window.GMApp.showToast('نام پرینتر الزامی است.', 'error');
        return false;
      }

      const host = (document.getElementById('gm29e-host')?.value || '').trim();
      const port = parseInt(document.getElementById('gm29e-port')?.value || '9100', 10);
      const queue = (document.getElementById('gm29e-queue')?.value || '').trim();
      const paperWidth = parseInt(document.getElementById('gm29e-paperwidth')?.value || '80', 10);
      const status = document.getElementById('gm29e-status')?.value || 'online';
      const cut = document.getElementById('gm29e-cut')?.checked !== false;
      const drawer = document.getElementById('gm29e-drawer')?.checked !== false;
      const notes = (document.getElementById('gm29e-notes')?.value || '').trim();

      if (store && typeof store.updateEcosystemPrinter === 'function') {
        store.updateEcosystemPrinter(printerId, {
          name,
          host,
          port,
          systemPrinterName: queue,
          paperWidth,
          status,
          cut,
          cashdrawer: drawer,
          notes
        });
      }

      if (window.GMApp && window.GMApp.showToast) {
        window.GMApp.showToast(`پرینتر «${name}» با موفقیت به‌روزرسانی شد.`, 'success');
      }

      if (window.GMRouter && typeof window.GMRouter.refresh === 'function') {
        window.GMRouter.refresh();
      }
      return true;
    });
  }
};

// --- MODAL: DELETE ECOSYSTEM PRINTER ---

window.confirmGM29DeleteEcosystemPrinter = function(printerId, printerName) {
  if (window.GMApp && window.GMApp.openModal) {
    const content = `
      <div style="display: flex; flex-direction: column; gap: 1rem;">
        <div class="op-context-banner op-context-danger" role="alert">
          <div class="op-context-header">
            <span>⚠️ تأیید حذف پرینتر از اکوسیستم</span>
            <span class="badge badge-danger">حذف دائمی</span>
          </div>
          <div style="font-size: 0.85rem; padding: 0.75rem; color: var(--text-secondary); line-height: 1.6;">
            پرینتر <strong style="color: var(--text-primary);">«${esc(printerName)}»</strong> از ناوگان پرینترهای متصل حذف خواهد شد.
            در صورت حذف، صندوق‌ها و پایانه‌های وابسته به این دستگاه دیگر قادر به ارسال فیش به این آدرس نخواهند بود.
          </div>
        </div>
      </div>
    `;

    window.GMApp.openModal(`حذف پرینتر: ${printerName}`, content, () => {
      const store = window.prototypeStore || window.GMStore;
      if (store && typeof store.deleteEcosystemPrinter === 'function') {
        store.deleteEcosystemPrinter(printerId);
      }
      if (window.GMApp && window.GMApp.showToast) {
        window.GMApp.showToast(`پرینتر «${printerName}» از اکوسیستم حذف شد.`, 'info');
      }
      if (window.GMRouter && typeof window.GMRouter.refresh === 'function') {
        window.GMRouter.refresh();
      }
      return true;
    }, { confirmLabel: '⛔ بله، پرینتر حذف شود', cancelLabel: 'انصراف' });
  }
};

// --- MODAL: TEST PRINT RECEIPT ---

window.openGM29TestPrintModal = function(printerId) {
  const store = window.prototypeStore || window.GMStore;
  const printers = store && typeof store.getEcosystemPrinters === 'function' ? store.getEcosystemPrinters() : [];
  const printer = printers.find(p => p.id === printerId) || printers[0];
  if (!printer) return;

  const nowFa = new Date().toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' }) + ' - ' + new Date().toLocaleDateString('fa-IR');

  const content = `
    <div style="display: flex; flex-direction: column; gap: 1rem;">
      <div style="font-size: 0.85rem; color: var(--text-secondary);">
        پیش‌نمایش فیش حرارتی تست که با دستور رستر ESC/POS به آدرس 
        <strong style="color: var(--text-primary); font-family: var(--font-mono);">${esc(printer.host)}:${printer.port}</strong>
        ارسال می‌شود:
      </div>

      <!-- Thermal Receipt Paper Simulation -->
      <div class="thermal-receipt-paper" style="box-shadow: 0 10px 25px -5px rgba(0,0,0,0.15); border: 1px solid #cbd5e1; border-radius: 6px; padding: 1.25rem 1rem; max-width: 330px; margin: 0 auto; background: #fff; color: #1e293b;">
        <div style="text-align: center; border-bottom: 2px dashed #94a3b8; padding-bottom: 0.75rem; margin-bottom: 0.75rem;">
          <div style="font-weight: 900; font-size: 1.2rem; color: #0f172a; letter-spacing: -0.5px;">${esc(printer.tenantName || 'کافه وستو')}</div>
          <div style="font-size: 0.75rem; color: #64748b; margin-top: 0.2rem; font-weight: 600;">فیش آزمون چاپگر حرارتی شبکه سالسا</div>
          <div style="font-size: 0.72rem; color: #64748b; font-family: var(--font-mono, monospace); margin-top: 0.2rem;">${esc(printer.host)}:${printer.port} · ${esc(printer.brand)} ${esc(printer.model)}</div>
        </div>

        <div style="font-size: 0.76rem; line-height: 1.6; margin-bottom: 0.65rem; border-bottom: 1px dashed #cbd5e1; padding-bottom: 0.5rem;">
          <div style="display: flex; justify-content: space-between;">
            <span style="color: #64748b;">شماره فاکتور:</span>
            <span style="font-weight: 700; font-family: monospace;">#INV-1042-TEST</span>
          </div>
          <div style="display: flex; justify-content: space-between;">
            <span style="color: #64748b;">میز / موقعیت:</span>
            <span style="font-weight: 600;">میز ۴ (سالن اصلی)</span>
          </div>
          <div style="display: flex; justify-content: space-between;">
            <span style="color: #64748b;">زمان صدور:</span>
            <span>${nowFa}</span>
          </div>
          <div style="display: flex; justify-content: space-between;">
            <span style="color: #64748b;">صندوق‌دار:</span>
            <span>مدیر سیستم (SuperAdmin)</span>
          </div>
        </div>

        <!-- Itemized Order Table Simulation -->
        <div style="font-size: 0.76rem; margin-bottom: 0.65rem;">
          <div style="display: flex; justify-content: space-between; font-weight: 700; border-bottom: 1px solid #e2e8f0; padding-bottom: 0.25rem; margin-bottom: 0.35rem; color: #475569;">
            <span>شرح سفارش</span>
            <span>مبلغ (تومان)</span>
          </div>
          <div style="display: flex; justify-content: space-between; margin-bottom: 0.25rem;">
            <span>۲× لاته آرت زعفرانی</span>
            <span style="font-family: monospace; font-weight: 600;">۲۸۰,۰۰۰</span>
          </div>
          <div style="display: flex; justify-content: space-between; margin-bottom: 0.25rem;">
            <span>۱× کروسان پسته‌ای دست‌ساز</span>
            <span style="font-family: monospace; font-weight: 600;">۱۳۵,۰۰۰</span>
          </div>
          <div style="display: flex; justify-content: space-between; margin-bottom: 0.25rem;">
            <span>۱× تست آووکادو و تخم‌مرغ</span>
            <span style="font-family: monospace; font-weight: 600;">۱۴۵,۰۰۰</span>
          </div>
        </div>

        <!-- Totals & Taxes -->
        <div style="border-top: 1px dashed #94a3b8; border-bottom: 2px dashed #94a3b8; padding: 0.5rem 0; margin-bottom: 0.75rem; font-size: 0.78rem;">
          <div style="display: flex; justify-content: space-between; color: #64748b;">
            <span>جمع اقلام:</span>
            <span style="font-family: monospace;">۵۶۰,۰۰۰</span>
          </div>
          <div style="display: flex; justify-content: space-between; color: #64748b;">
            <span>مالیات بر ارزش افزوده (۱۰٪):</span>
            <span style="font-family: monospace;">۵۶,۰۰۰</span>
          </div>
          <div style="display: flex; justify-content: space-between; font-size: 0.88rem; font-weight: 800; color: #0f172a; margin-top: 0.35rem;">
            <span>جمع کل پرداختی:</span>
            <span style="font-family: monospace;">۶۱۶,۰۰۰ تومان</span>
          </div>
        </div>

        <!-- Verification QR Code Mock -->
        <div style="text-align: center; margin-bottom: 0.65rem;">
          <div style="display: inline-block; padding: 0.5rem; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px;">
            <div style="width: 72px; height: 72px; margin: 0 auto; background: repeating-conic-gradient(#0f172a 0% 25%, #ffffff 0% 50%) 50% / 12px 12px; border-radius: 4px;"></div>
            <div style="font-size: 0.65rem; color: #64748b; margin-top: 0.25rem; font-family: monospace;">ESC/POS GS (k QR</div>
          </div>
        </div>

        <div style="border-top: 1px dashed #94a3b8; padding-top: 0.5rem; text-align: center; font-size: 0.72rem; color: #10b981; font-weight: 700;">
          ✅ آزمون رستر گرافیکی و ارسال بیت‌مپ موفقیت‌آمیز بود
        </div>

        <div class="receipt-perforation"></div>

        <div style="text-align: center; font-size: 0.68rem; color: #64748b;">
          <div>فناوری چاپ یکپارچه سالسا (SALSA ESC/POS Raster Engine)</div>
          <div style="margin-top: 0.15rem;">هسته کلاینت متصل: پورت ۴۱۸۰</div>
        </div>
      </div>

      <div style="font-size: 0.8rem; color: var(--text-tertiary); text-align: center;">
        با فشردن دکمه زیر، سوکت ارتباطی RAW پورت ۹۱۰۰ یا درایور CUPS مک فعال شده و فیش چاپ می‌شود.
      </div>
    </div>
  `;

  if (window.GMApp && window.GMApp.openModal) {
    window.GMApp.openModal(`آزمون چاپ فیش: ${printer.name}`, content, async () => {
      // Route printer test print through Control Plane (port 3061) or prototype ledger
      try {
        if (window.ControlPlaneClient && typeof window.ControlPlaneClient.request === 'function') {
          window.ControlPlaneClient.request('/edge/printers/test', {
            method: 'POST',
            body: {
              tenant_id: (store && store.getActiveTenantId) ? store.getActiveTenantId() : 'tnt_westo_demo',
              branch_id: printer.branchId || 1,
              printer_ip: printer.host,
              printer_port: printer.port,
              printer_name: printer.name
            }
          }).then(res => {
            if (res && res.success && window.GMApp && window.GMApp.showToast) {
              window.GMApp.showToast(`✅ دستور چاپ فیش آزمایشی به ${printer.host}:${printer.port} از کنترل پلین صادر شد.`, 'success');
            }
          }).catch(() => {});
        }
      } catch (_) {}

      // Log in prototype store ledger
      if (store && typeof store.addActivity === 'function') {
        store.addActivity({
          type: 'printer_test_executed',
          severity: 'info',
          title: `آزمون چاپ فیش پرینتر: ${printer.name}`,
          description: `دستور چاپ آزمایشی به آدرس ${printer.host}:${printer.port} (${printer.brand} ${printer.model}) ارسال شد.`,
          subsystem: 'Printers',
          route: '#gm-29-printers',
          routeLabel: 'GM-29 پرینترها',
          actor: 'SuperAdmin (مدیر پلتفرم)'
        });
      }

      if (window.GMApp && window.GMApp.showToast) {
        window.GMApp.showToast(`دستور آزمون چاپ برای «${printer.name}» صادر شد.`, 'success');
      }
      return true;
    }, { confirmLabel: '🖨️ ارسال فرمان چاپ آزمایشی', cancelLabel: 'بستن' });
  }
};

// --- MODAL: ADD CATALOG PRINTER MODEL ---

window.openGM29AddPrinterModal = function() {
  const content = `
    <div style="display: flex; flex-direction: column; gap: 1rem;">
      <div class="grid-cols-2" style="gap: 0.75rem;">
        <div class="form-group">
          <label class="form-label" for="gm29m-brand">برند پرینتر <span class="field-badge field-required">الزامی</span></label>
          <input type="text" id="gm29m-brand" class="form-control" placeholder="مثال: Epson، Star، Bixolon" />
        </div>
        <div class="form-group">
          <label class="form-label" for="gm29m-model">مدل دقیق <span class="field-badge field-required">الزامی</span></label>
          <input type="text" id="gm29m-model" class="form-control" placeholder="مثال: TM-T88VI" />
        </div>
      </div>

      <div class="form-group">
        <label class="form-label" for="gm29m-category">دسته‌بندی در کاتالوگ</label>
        <select id="gm29m-category" class="form-control">
          <option value="receipt">پرینتر فیش (رسید صندوق)</option>
          <option value="kitchen">پرینتر آشپزخانه (KOT)</option>
          <option value="label">پرینتر لیبل و بارکد</option>
        </select>
      </div>

      <div class="grid-cols-2" style="gap: 0.75rem;">
        <div class="form-group">
          <label class="form-label" for="gm29m-paperwidth">عرض کاغذ (mm)</label>
          <input type="number" id="gm29m-paperwidth" class="form-control" value="80" />
        </div>
        <div class="form-group">
          <label class="form-label" for="gm29m-dpi">وضوح چاپ (DPI)</label>
          <input type="number" id="gm29m-dpi" class="form-control" value="180" />
        </div>
      </div>

      <div class="form-group">
        <label class="form-label" for="gm29m-interface">رابط‌های اتصال (با کاما جدا کنید)</label>
        <input type="text" id="gm29m-interface" class="form-control" value="USB, LAN, Wi-Fi" />
      </div>

      <div style="display: flex; gap: 1.5rem; flex-wrap: wrap;">
        <label style="display: flex; align-items: center; gap: 0.5rem; font-size: 0.875rem; cursor: pointer;">
          <input type="checkbox" id="gm29m-cutter" checked /> قیچی خودکار
        </label>
        <label style="display: flex; align-items: center; gap: 0.5rem; font-size: 0.875rem; cursor: pointer;">
          <input type="checkbox" id="gm29m-cashdrawer" checked /> اتصال کشو پول
        </label>
      </div>

      <div class="form-group">
        <label class="form-label" for="gm29m-status">وضعیت پشتیبانی پلتفرم</label>
        <select id="gm29m-status" class="form-control">
          <option value="active">پشتیبانی‌شده کامل</option>
          <option value="limited">پشتیبانی محدود</option>
          <option value="beta">آزمایشی (بتا)</option>
        </select>
      </div>

      <div class="form-group">
        <label class="form-label" for="gm29m-notes">یادداشت فنی مدل</label>
        <textarea id="gm29m-notes" class="form-control" rows="2" placeholder="توضیحاتی درباره این مدل پرینتر و عملکرد آن در سیستم..."></textarea>
      </div>
    </div>
  `;

  if (window.GMApp && window.GMApp.openModal) {
    window.GMApp.openModal('افزودن مدل جدید به کاتالوگ سخت‌افزاری', content, () => {
      const brand = (document.getElementById('gm29m-brand')?.value || '').trim();
      const model = (document.getElementById('gm29m-model')?.value || '').trim();
      if (!brand || !model) {
        if (window.GMApp.showToast) window.GMApp.showToast('برند و مدل پرینتر الزامی هستند.', 'error');
        return false;
      }

      const category = document.getElementById('gm29m-category')?.value || 'receipt';
      const categoryFaMap = { receipt: 'پرینتر فیش (رسید)', kitchen: 'پرینتر آشپزخانه (KOT)', label: 'پرینتر لیبل و بارکد' };
      const ifaces = (document.getElementById('gm29m-interface')?.value || 'USB').split(',').map(s => s.trim()).filter(Boolean);

      const store = window.prototypeStore || window.GMStore;
      if (store && typeof store.addPrinterModel === 'function') {
        store.addPrinterModel({
          brand,
          model,
          category,
          categoryFa: categoryFaMap[category] || category,
          interface: ifaces,
          paperWidth: parseInt(document.getElementById('gm29m-paperwidth')?.value || '80', 10),
          dpi: parseInt(document.getElementById('gm29m-dpi')?.value || '180', 10),
          cutter: document.getElementById('gm29m-cutter')?.checked !== false,
          cashdrawer: document.getElementById('gm29m-cashdrawer')?.checked !== false,
          status: document.getElementById('gm29m-status')?.value || 'active',
          statusFa: { active: 'پشتیبانی‌شده', limited: 'پشتیبانی محدود', beta: 'آزمایشی (بتا)' }[document.getElementById('gm29m-status')?.value || 'active'],
          notes: document.getElementById('gm29m-notes')?.value || '',
          addedAt: new Date().toLocaleDateString('fa-IR')
        });
      }

      if (window.GMApp && window.GMApp.showToast) {
        window.GMApp.showToast(`مدل پرینتر «${brand} ${model}» به کاتالوگ اضافه شد.`, 'success');
      }

      if (window.GMRouter && typeof window.GMRouter.refresh === 'function') {
        window.GMRouter.refresh();
      }
      return true;
    }, { confirmLabel: 'افزودن مدل به کاتالوگ', cancelLabel: 'انصراف' });
  }
};

// --- MODAL: EDIT CATALOG PRINTER MODEL ---

window.openGM29EditPrinterModal = function(printerId) {
  const store = window.prototypeStore || window.GMStore;
  const printers = store && typeof store.getPrinterModels === 'function' ? store.getPrinterModels() : [];
  const printer = printers.find(p => p.id === printerId);
  if (!printer) return;

  function sel(a, b) { return a === b ? 'selected' : ''; }

  const content = `
    <div style="display: flex; flex-direction: column; gap: 1rem;">
      <div class="grid-cols-2" style="gap: 0.75rem;">
        <div class="form-group">
          <label class="form-label" for="gm29me-brand">برند پرینتر</label>
          <input type="text" id="gm29me-brand" class="form-control" value="${esc(printer.brand)}" />
        </div>
        <div class="form-group">
          <label class="form-label" for="gm29me-model">مدل دقیق</label>
          <input type="text" id="gm29me-model" class="form-control" value="${esc(printer.model)}" />
        </div>
      </div>

      <div class="form-group">
        <label class="form-label" for="gm29me-category">دسته‌بندی</label>
        <select id="gm29me-category" class="form-control">
          <option value="receipt" ${sel(printer.category, 'receipt')}>پرینتر فیش (رسید)</option>
          <option value="kitchen" ${sel(printer.category, 'kitchen')}>پرینتر آشپزخانه (KOT)</option>
          <option value="label" ${sel(printer.category, 'label')}>پرینتر لیبل و بارکد</option>
        </select>
      </div>

      <div class="grid-cols-2" style="gap: 0.75rem;">
        <div class="form-group">
          <label class="form-label" for="gm29me-paperwidth">عرض کاغذ (mm)</label>
          <input type="number" id="gm29me-paperwidth" class="form-control" value="${printer.paperWidth || 80}" />
        </div>
        <div class="form-group">
          <label class="form-label" for="gm29me-dpi">وضوح چاپ (DPI)</label>
          <input type="number" id="gm29me-dpi" class="form-control" value="${printer.dpi || 180}" />
        </div>
      </div>

      <div class="form-group">
        <label class="form-label" for="gm29me-interface">رابط‌های اتصال</label>
        <input type="text" id="gm29me-interface" class="form-control" value="${esc((printer.interface || []).join(', '))}" />
      </div>

      <div style="display: flex; gap: 1.5rem; flex-wrap: wrap;">
        <label style="display: flex; align-items: center; gap: 0.5rem; font-size: 0.875rem; cursor: pointer;">
          <input type="checkbox" id="gm29me-cutter" ${printer.cutter ? 'checked' : ''} /> قیچی خودکار
        </label>
        <label style="display: flex; align-items: center; gap: 0.5rem; font-size: 0.875rem; cursor: pointer;">
          <input type="checkbox" id="gm29me-cashdrawer" ${printer.cashdrawer ? 'checked' : ''} /> کشو پول
        </label>
      </div>

      <div class="form-group">
        <label class="form-label" for="gm29me-status">وضعیت پشتیبانی</label>
        <select id="gm29me-status" class="form-control">
          <option value="active" ${sel(printer.status, 'active')}>پشتیبانی‌شده کامل</option>
          <option value="limited" ${sel(printer.status, 'limited')}>پشتیبانی محدود</option>
          <option value="beta" ${sel(printer.status, 'beta')}>آزمایشی (بتا)</option>
          <option value="deprecated" ${sel(printer.status, 'deprecated')}>منسوخ‌شده</option>
        </select>
      </div>

      <div class="form-group">
        <label class="form-label" for="gm29me-notes">یادداشت</label>
        <textarea id="gm29me-notes" class="form-control" rows="2">${esc(printer.notes || '')}</textarea>
      </div>
    </div>
  `;

  if (window.GMApp && window.GMApp.openModal) {
    window.GMApp.openModal(`ویرایش مدل: ${printer.brand} ${printer.model}`, content, () => {
      const brand = (document.getElementById('gm29me-brand')?.value || '').trim();
      const model = (document.getElementById('gm29me-model')?.value || '').trim();
      if (!brand || !model) {
        if (window.GMApp.showToast) window.GMApp.showToast('برند و مدل الزامی هستند.', 'error');
        return false;
      }

      const category = document.getElementById('gm29me-category')?.value || printer.category;
      const categoryFaMap = { receipt: 'پرینتر فیش (رسید)', kitchen: 'پرینتر آشپزخانه (KOT)', label: 'پرینتر لیبل و بارکد' };
      const ifaces = (document.getElementById('gm29me-interface')?.value || '').split(',').map(s => s.trim()).filter(Boolean);
      const status = document.getElementById('gm29me-status')?.value || printer.status;

      if (store && typeof store.updatePrinterModel === 'function') {
        store.updatePrinterModel(printerId, {
          brand,
          model,
          category,
          categoryFa: categoryFaMap[category] || printer.categoryFa,
          interface: ifaces,
          paperWidth: parseInt(document.getElementById('gm29me-paperwidth')?.value || String(printer.paperWidth), 10),
          dpi: parseInt(document.getElementById('gm29me-dpi')?.value || String(printer.dpi), 10),
          cutter: document.getElementById('gm29me-cutter')?.checked !== false,
          cashdrawer: document.getElementById('gm29me-cashdrawer')?.checked !== false,
          status,
          statusFa: { active: 'پشتیبانی‌شده', limited: 'پشتیبانی محدود', beta: 'آزمایشی (بتا)', deprecated: 'منسوخ‌شده' }[status],
          notes: document.getElementById('gm29me-notes')?.value || ''
        });
      }

      if (window.GMApp && window.GMApp.showToast) {
        window.GMApp.showToast(`مدل «${brand} ${model}» با موفقیت ویرایش شد.`, 'success');
      }
      if (window.GMRouter && typeof window.GMRouter.refresh === 'function') window.GMRouter.refresh();
      return true;
    });
  }
};

// --- MODAL: DELETE CATALOG PRINTER MODEL ---

window.confirmGM29DeletePrinter = function(printerId, printerName) {
  if (window.GMApp && window.GMApp.openModal) {
    const content = `
      <div style="display: flex; flex-direction: column; gap: 1rem;">
        <div class="op-context-banner op-context-danger" role="alert">
          <div class="op-context-header">
            <span>⚠️ تأیید حذف مدل از کاتالوگ</span>
            <span class="badge badge-danger">غیرقابل‌بازگشت</span>
          </div>
          <div style="font-size: 0.85rem; padding: 0.75rem; color: var(--text-secondary); line-height: 1.6;">
            مدل پرینتر <strong style="color: var(--text-primary);">«${esc(printerName)}»</strong> از کاتالوگ پلتفرم حذف خواهد شد.
          </div>
        </div>
      </div>
    `;

    window.GMApp.openModal(`حذف مدل پرینتر: ${printerName}`, content, () => {
      const store = window.prototypeStore || window.GMStore;
      if (store && typeof store.deletePrinterModel === 'function') {
        store.deletePrinterModel(printerId);
      }
      if (window.GMApp && window.GMApp.showToast) {
        window.GMApp.showToast(`مدل پرینتر «${printerName}» از کاتالوگ حذف شد.`, 'info');
      }
      if (window.GMRouter && typeof window.GMRouter.refresh === 'function') window.GMRouter.refresh();
      return true;
    }, { confirmLabel: '⛔ بله، مدل حذف شود', cancelLabel: 'انصراف' });
  }
};

// Register as GMView
window.GMViews = window.GMViews || {};
window.GMViews.GM29 = { render: window.renderGM29 };
