/* WESTO Admin — unified inventory, recipes, costing and expenses workspace. */
(() => {
  'use strict';
  const registry = window.WestoAdminModules;
  if (!registry) return;

  const tabs = ['inventory', 'costControl', 'expenses'];
  const viewByTab = { inventory: 'materials', costControl: 'costing', expenses: 'expenses' };

  const TAB_NAV_ITEMS = Object.freeze({
    inventory: [
      ['materials', 'مواد اولیه'],
      ['vendors', 'تأمین‌کنندگان'],
      ['recipes', 'دستور تهیه محصولات'],
      ['operations', 'گردش انبار'],
      ['production', 'تولید دسته‌ای'],
      ['counts', 'انبارگردانی'],
      ['waste', 'ضایعات'],
    ],
    costControl: [
      ['costing', 'بهای تمام‌شده و سودآوری'],
      ['recipes', 'آنالیز بهای دستورهای تهیه'],
    ],
    expenses: [
      ['expenses', 'هزینه‌های ثبت‌شده'],
    ],
  });

  const TAB_HEADERS = Object.freeze({
    inventory: {
      eyebrow: 'مدیریت موجودی و انبار',
      title: 'انبار و مواد اولیه',
      lead: 'مدیریت مواد اولیه، تأمین‌کنندگان، فرمولاسیون دستور تهیه، گردش انبار، تولید، انبارگردانی و ضایعات شعبه فعال.',
    },
    costControl: {
      eyebrow: 'کنترل هزینه و مهندسی منو',
      title: 'بهای تمام‌شده',
      lead: 'تحلیل بهای تمام‌شده کالای فروش‌رفته (COGS)، بهای نظری در برابر مصرف واقعی و حاشیه سود محصولات.',
    },
    expenses: {
      eyebrow: 'مدیریت هزینه‌های جاری',
      title: 'هزینه‌ها',
      lead: 'ثبت، دسته‌بندی و پیگیری هزینه‌های عملیاتی و جاری شعبه با اتصال مستقیم به دفاتر مالی.',
    },
  });
  let context = null;
  let root = null;
  let data = { kitchen: {}, costing: {}, expenses: {}, purchases: {} };
  let loading = false;
  let loadError = null;
  let bound = false;
  let openFormKind = null;

  const list = (value) => Array.isArray(value) ? value : [];
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const fa = (value) => window.WestoPersianFormat?.number(value, { locale: 'fa-IR' }) ?? Number(value || 0).toLocaleString('fa-IR');
  const parseInputNumber = (value) => window.WestoPersianFormat?.parse?.(value) ?? Number(value || 0);
  const moneyIrr = (value) => context.fmtMoney(Math.round(Number(value || 0) / 10));
  const dateOnly = () => new Date().toISOString().slice(0, 10);
  const key = (prefix) => window.crypto?.randomUUID?.() || `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const bodyOf = (response) => response?.data ?? response ?? {};
  const items = () => {
    const costingItems = list(data.costing.items);
    const kitchenItems = list(data.kitchen.items);
    if (!kitchenItems.length) return costingItems;
    if (!costingItems.length) return kitchenItems;
    const costingById = new Map(costingItems.map((item) => [String(item.id), item]));
    const merged = kitchenItems.map((item) => ({ ...(costingById.get(String(item.id)) || {}), ...item }));
    const kitchenIds = new Set(kitchenItems.map((item) => String(item.id)));
    return merged.concat(costingItems.filter((item) => !kitchenIds.has(String(item.id))));
  };
  const recipes = () => {
    const all = [...list(data.costing.recipes), ...list(data.kitchen.recipeVersions), ...list(data.kitchen.productionRecipes)];
    const seen = new Set();
    return all.filter((recipe) => { const id = String(recipe.id || recipe.recipeId || ''); if (!id || seen.has(id)) return false; seen.add(id); return true; });
  };
  const menuItems = () => list(data.kitchen.menuItems).length ? list(data.kitchen.menuItems) : list(context.state?.menuItems);
  const itemById = (id) => items().find((item) => String(item.id) === String(id));
  const vendors = () => {
    const listVendors = list(data.kitchen.vendors).length ? list(data.kitchen.vendors) : list(data.purchases.vendors);
    const seen = new Set();
    return listVendors.filter((v) => { const id = String(v.id || ''); if (!id || seen.has(id)) return false; seen.add(id); return true; });
  };
  const vendorById = (id) => vendors().find((v) => String(v.id) === String(id));
  const vendorsForItem = (itemId) => vendors().filter((v) => list(v.itemIds).map(String).includes(String(itemId)));
  const recipeLabel = (recipe) => recipe.name || recipe.menuItemName || menuItems().find((item) => String(item.id) === String(recipe.menuItemId))?.name || recipe.id;
  const STATUS_LABELS = Object.freeze({
    approved: 'تأییدشده', pending_approval: 'در انتظار تأیید', pending: 'در انتظار بررسی', pending_review: 'در انتظار بررسی',
    draft: 'پیش‌نویس', submitted: 'ارسال‌شده', rejected: 'ردشده', retired: 'غیرفعال‌شده',
    posted: 'ثبت قطعی', reversed: 'معکوس‌شده', active: 'فعال', inactive: 'غیرفعال', available: 'موجود',
    blocked: 'مسدود', completed: 'تکمیل‌شده', failed: 'ناموفق', cancelled: 'لغوشده', canceled: 'لغوشده',
    received: 'دریافت‌شده', partially_received: 'دریافت ناقص', paid: 'پرداخت‌شده', partially_paid: 'بخشی پرداخت‌شده',
    settled: 'تسویه‌شده', unvalued: 'بدون ارزش‌گذاری', shortage: 'کمبود', low_stock: 'موجودی کم', ready: 'آماده',
    shadow: 'در حالت آزمایشی', insufficient_data: 'اطلاعات ناکافی', partial_coverage: 'پوشش ناقص',
    superseded: 'جایگزین‌شده', exception: 'استثنا', skipped: 'ردشده', succeeded: 'موفق',
    match_rejected: 'ردشده در تطبیق', branch_cutover_active: 'انتقال شعبه فعال', out_of_stock: 'ناموجود',
  });
  const MOVEMENT_TYPE_LABELS = Object.freeze({
    waste: 'ضایعات', 'inventory.waste': 'ضایعات', stock_count: 'انبارگردانی', 'inventory.stock_count': 'انبارگردانی',
    count_adjustment: 'تعدیل انبارگردانی', production: 'تولید', 'inventory.production_batch': 'تولید',
    stock_transfer: 'انتقال بین انبارها', 'inventory.stock_transfer': 'انتقال بین انبارها',
    stock_issue: 'خروج عملیاتی', 'inventory.stock_issue': 'خروج عملیاتی', purchase: 'خرید',
    goods_receipt: 'دریافت کالا', 'inventory.goods_receipt': 'دریافت کالا', sale_consumption: 'مصرف فروش',
    'order.cogs': 'مصرف مواد دستور تهیه فروش', adjustment: 'تعدیل موجودی', stock_adjustment: 'تعدیل موجودی',
    return: 'برگشت موجودی', 'inventory.reversal': 'برگشت موجودی', 'purchase.goods_received': 'دریافت کالا',
  });
  const normalizeKey = (value) => String(value ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  const statusLabel = (status) => STATUS_LABELS[normalizeKey(status)] || 'نیازمند بررسی';
  const movementTypeLabel = (type) => MOVEMENT_TYPE_LABELS[String(type ?? '').trim().toLowerCase()] || 'نیازمند بررسی';
  const statusClass = (status) => ['approved', 'posted', 'available', 'received', 'completed', 'ready'].includes(normalizeKey(status)) ? 'is-good' : ['rejected', 'reversed', 'failed', 'cancelled', 'canceled'].includes(normalizeKey(status)) ? 'is-danger' : 'is-warn';
  const actionableError = (error, fallback) => {
    const code = normalizeKey(error?.code || error?.error?.code);
    const known = {
      inventory_item_not_found: 'مادهٔ اولیه در شعبهٔ فعال پیدا نشد؛ شعبه و قلم انتخاب‌شده را بررسی کنید.',
      inventory_item_branch_mismatch: 'این مادهٔ اولیه متعلق به شعبهٔ فعال نیست؛ شعبه یا قلم را اصلاح کنید.',
      recipe_not_found: 'دستور تهیه انتخاب‌شده پیدا نشد؛ فهرست دستورهای تهیه را تازه‌سازی کنید.',
      recipe_retired: 'این دستور تهیه غیرفعال شده و برای تولید قابل استفاده نیست؛ دستور تهیه فعال دیگری انتخاب کنید.',
      recipe_ingredients_missing: 'مواد تشکیل‌دهندهٔ دستور تهیه کامل نیست؛ دستور تهیه را بازبینی و ذخیره کنید.',
      production_inventory_shortage: 'موجودی مواد برای تولید کافی نیست؛ ابتدا دریافت یا انبارگردانی را ثبت کنید.',
      production_output_item_missing: 'کالای خروجی دستور تهیه مشخص نیست؛ محصول تولیدی را در دستور تهیه انتخاب کنید.',
      production_output_branch_mismatch: 'کالای خروجی به شعبهٔ فعال تعلق ندارد؛ محصول شعبهٔ درست را انتخاب کنید.',
      transfer_warehouse_invalid: 'انبار مبدأ و مقصد باید متفاوت و مشخص باشند؛ هر دو را بررسی کنید.',
      idempotency_key_required: 'شناسهٔ پیگیری درخواست ارسال نشد؛ دوباره تلاش کنید.',
      finance_period_closed: 'دورهٔ مالی بسته است؛ دورهٔ باز یا تاریخ مجاز انتخاب کنید.',
      finance_period_missing: 'برای این تاریخ دورهٔ مالی بازی پیدا نشد؛ دورهٔ مالی را بررسی کنید.',
      finance_approver_required: 'کاربر فعلی مجوز انجام این عملیات را ندارد؛ با مدیر مالی هماهنگ کنید.',
    };
    if (known[code]) return known[code];
    const raw = String(error?.message || error?.error?.message || error || '').trim();
    if (raw && !raw.includes('[object Object]') && !raw.startsWith('HTTP ')) return raw;
    if (/موجودی|shortage|inventory/i.test(raw)) return 'موجودی یا اطلاعات انبار کافی نیست؛ قلم و موجودی را بررسی کنید.';
    if (/رسپی|دستور|recipe/i.test(raw)) return 'اطلاعات دستور تهیه کامل نیست؛ دستور تهیه و مواد تشکیل‌دهنده را بررسی کنید.';
    if (/هزینه|expense|finance|accounting/i.test(raw)) return 'ثبت مالی انجام نشد؛ مبلغ، تاریخ، دورهٔ مالی و مجوز کاربر را بررسی کنید.';
    return fallback;
  };
  const unit = (item) => item?.unit || '—';

  async function loadData() {
    loading = true;
    loadError = null;
    const query = context.branchQs();
    const read = async (path) => bodyOf(await context.api(path));
    const canReadFinance = Boolean(context.hasCapability?.('finance.view'));
    const canReadPayables = Boolean(context.hasCapability?.('finance.payables.manage'));
    try {
      const [kitchen, costing, expenses, purchases] = await Promise.all([
        read(`/api/kitchen/inventory${query}`),
        canReadFinance ? read(`/api/admin/v2/finance/costing-inventory${query}`) : Promise.resolve({}),
        canReadFinance ? read(`/api/admin/v2/finance/operating-expenses${query}`) : Promise.resolve({}),
        canReadPayables ? read(`/api/admin/v2/finance/purchases-payables${query}`) : Promise.resolve({}),
      ]);
      data = { kitchen, costing, expenses, purchases };
    } catch (error) {
      loadError = error instanceof Error ? error : new Error('اطلاعات انبار و مالی دریافت نشد.');
      throw loadError;
    } finally {
      loading = false;
    }
  }

  function shell(tab) {
    const navItems = TAB_NAV_ITEMS[tab] || TAB_NAV_ITEMS.inventory;
    const header = TAB_HEADERS[tab] || TAB_HEADERS.inventory;
    const currentView = viewByTab[tab] || navItems[0][0];

    const navMarkup = navItems.length > 1 ? `<nav class="inv-nav" aria-label="بخش‌های ${header.title}">
      ${navItems.map(([id, label]) => `<button type="button" class="${currentView === id ? 'is-active' : ''}" data-inv-view="${id}">${label}</button>`).join('')}
    </nav>` : '';

    return `<div class="inv-workspace" dir="rtl">
      <div class="ops-page-head inv-page-head">
        <div>
          <p class="eyebrow">${esc(header.eyebrow)}</p>
          <h1>${esc(header.title)}</h1>
          <p class="lead">${esc(header.lead)}</p>
        </div>
        <div class="row-actions">
          ${tab === 'inventory' ? `<a class="btn btn-sm btn-ghost" href="/admin/kitchen?view=inventory&branchId=${encodeURIComponent(context.currentBranch?.()?.id || 1)}">پنل آشپزخانه</a>` : ''}
          ${tab === 'costControl' ? `<a class="btn btn-sm btn-ghost" href="${context.financeWorkspaceHref('costing')}">دفتر رسمی در حسابداری</a>` : ''}
          ${tab === 'expenses' ? `<a class="btn btn-sm btn-ghost" href="${context.financeWorkspaceHref('purchases')}">خرید و پرداختنی در حسابداری</a>` : ''}
        </div>
      </div>
      ${navMarkup}
      <div class="inv-body" id="inv-body"></div>
    </div>`;
  }

  function materialView() {
    const canManage = context.hasCapability?.('inventory.manage');
    const allItems = items();
    const lowStockCount = allItems.filter((item) => item.availableQuantity != null && item.minStock > 0 && Number(item.availableQuantity) <= Number(item.minStock)).length;
    const totalValuationIrr = allItems.reduce((sum, item) => sum + (item.availableQuantity != null && (item.avgCostIrr || item.unitCostIrr) ? Number(item.availableQuantity) * Number(item.avgCostIrr || item.unitCostIrr) : 0), 0);

    const rows = allItems.map((item) => {
      const available = item.availableQuantity == null ? null : Number(item.availableQuantity);
      const min = Number(item.minStock || 0);
      const low = available != null && min > 0 && available <= min;
      const reorderSoon = !low && available != null && min > 0 && available <= (min * 1.5);
      const cost = item.avgCostIrr ?? item.unitCostIrr;
      const value = available != null && cost != null ? available * Number(cost) : null;
      const status = available == null ? 'نیازمند بررسی' : low ? 'کمبود' : 'مناسب';
      const costLabel = item.costStatus === 'estimated' ? '<small>برآورد پایه · جایگزین با فاکتور واقعی</small>' : '';
      const linkedVendors = vendorsForItem(item.id);
      const vendorBadges = linkedVendors.length
        ? `<div class="inv-vendor-tags">${linkedVendors.map((v) => `<span class="inv-vendor-tag ${v.isSpot ? 'is-spot' : ''}">${esc(v.nameFa || v.name)}</span>`).join('')}</div>`
        : '<div class="inv-vendor-tags"><span class="inv-vendor-tag is-none">بدون تأمین‌کننده</span></div>';
      const searchKey = `${item.name || ''} ${item.sku || ''} ${item.category || ''}`.toLowerCase();

      return `<tr class="inv-material-row" data-search-text="${esc(searchKey)}">
        <td><strong>${esc(item.name || item.id)}</strong><small>${esc(item.sku || 'بدون کد')} · ${esc(item.category || 'سایر')}</small>${vendorBadges}</td>
        <td>${available == null ? 'اطلاعات کافی نیست' : `${fa(available)} <small>${esc(unit(item))}</small>`}</td>
        <td>${min ? fa(min) : '—'}</td>
        <td>${value == null ? 'ثبت نشده' : `${moneyIrr(value)}${costLabel}`}</td>
        <td>
          <div style="display:flex;align-items:center;gap:0.35rem;flex-wrap:wrap;">
            <span class="inv-status ${available == null ? 'is-warn' : low ? 'is-danger' : reorderSoon ? 'is-warn' : 'is-good'}">
              ${low ? 'بحرانی (کسری)' : reorderSoon ? 'نقطه سفارش' : status}
            </span>
            ${low ? `<button type="button" class="inv-button inv-button--soft inv-button--xs" data-inv-quick-reorder="${esc(item.id)}" title="ثبت فوری سفارش خرید برای جبران کسری">سفارش خرید</button>` : ''}
          </div>
        </td>
      </tr>`;
    }).join('');

    return `<div class="inv-grid inv-grid--wide">
      <div class="inv-counts-kpis">
        <article>
          <small>کل اقلام مواد اولیه</small>
          <strong>${fa(allItems.length)} قلم</strong>
          <span>اقلام فعال شعبه</span>
        </article>
        <article class="${lowStockCount > 0 ? 'is-warn' : ''}">
          <small>اقلام نیازمند سفارش (کسری)</small>
          <strong>${fa(lowStockCount)} قلم</strong>
          <span>موجود کمتر از حد آستانه</span>
        </article>
        <article>
          <small>ارزش تقریبی کل موجودی انبار</small>
          <strong>${moneyIrr(totalValuationIrr)}</strong>
          <span>بر اساس بهای میانگین</span>
        </article>
      </div>

      <section class="inv-card inv-card--list">
        <div class="inv-card-head">
          <div>
            <span class="inv-eyebrow">منبع موجودی</span>
            <h2>مواد اولیهٔ شعبه</h2>
            <p>موجودی قابل‌مصرف با گردش‌های واقعی فروش، دریافت، ضایعات و شمارش محاسبه می‌شود.</p>
          </div>
          <div class="inv-card-actions">
            ${canManage ? actionButton('material', 'مادهٔ اولیهٔ جدید') : ''}
            <a class="inv-link" href="${context.financeWorkspaceHref('purchases')}">خرید و دریافت کالا ←</a>
          </div>
        </div>

        <div class="inv-search-strip">
          <input type="text" id="inv-material-search" placeholder="جست‌وجوی آنی نام ماده، کد کالا یا دسته‌بندی مواد اولیه…" />
        </div>

        <div class="inv-table-wrap">
          <table class="inv-table">
            <thead>
              <tr>
                <th>ماده و طرف حساب</th>
                <th>قابل‌مصرف</th>
                <th>حداقل</th>
                <th>ارزش تقریبی</th>
                <th>وضعیت و اقدام</th>
              </tr>
            </thead>
            <tbody>
              ${rows || '<tr><td colspan="5" class="inv-empty">هنوز ماده‌ای برای این شعبه ثبت نشده است.</td></tr>'}
            </tbody>
          </table>
        </div>
      </section>
    </div>`;
  }

  function actionButton(kind, label, disabled = false) {
    return `<button type="button" class="inv-button inv-button--primary" data-inv-open-form="${esc(kind)}"${disabled ? ' disabled' : ''}>＋ ${esc(label)}</button>`;
  }

  function materialFormMarkup() {
    const allVendors = vendors();
    return `<form class="inv-form" data-inv-form="material"><label>نام ماده<input name="name" required placeholder="مثلاً شیر پرچرب" /></label><label>کد کالا<input name="sku" dir="ltr" placeholder="MILK-01" /></label><label>دسته<input name="category" placeholder="لبنیات" /></label><label>واحد پایه<select name="unit" required><option value="کیلوگرم">کیلوگرم</option><option value="لیتر">لیتر</option><option value="عدد">عدد</option><option value="گرم">گرم</option><option value="میلی‌لیتر">میلی‌لیتر</option></select></label><label>موجودی اولیه<input name="qtyOnHand" inputmode="decimal" type="text" value="۰" /></label><label>بهای واحد (تومان)<input name="avgCostToman" inputmode="decimal" type="text" placeholder="اگر هنوز مشخص نیست خالی بگذارید" /></label><label>حداقل موجودی<input name="minStock" inputmode="decimal" type="text" value="۰" /></label><label>تأمین‌کنندهٔ اولیه (اختیاری)<select name="vendorId"><option value="">انتخاب طرف حساب</option>${allVendors.map((v) => `<option value="${esc(v.id)}">${esc(v.nameFa || v.name)} ${v.isSpot ? '(آزاد)' : ''}</option>`).join('')}</select></label><button class="inv-button inv-button--primary" type="submit">افزودن به انبار</button></form>`;
  }

  function vendorsView() {
    const canManage = context.hasCapability?.('inventory.manage') || context.hasCapability?.('admin.access') || context.hasCapability?.('inventory.operations');
    const allVendors = vendors();
    const allItems = items();
    const contractVendors = allVendors.filter((v) => !v.isSpot && v.id !== 'vendor-spot');
    const coveredItemIds = new Set();
    allVendors.forEach((v) => list(v.itemIds).forEach((id) => coveredItemIds.add(String(id))));

    const rows = allVendors.map((vendor) => {
      const isSpot = Boolean(vendor.isSpot || vendor.category === 'آزاد' || vendor.id === 'vendor-spot');
      const assignedIds = list(vendor.itemIds).map(String);
      const assignedNames = assignedIds.map((id) => itemById(id)?.name || id).slice(0, 5);
      const moreCount = assignedIds.length > 5 ? assignedIds.length - 5 : 0;
      const termsLabel = isSpot || !vendor.termsDays ? 'نقدی / تسویه درجا' : `${fa(vendor.termsDays)} روز`;
      const searchKey = `${vendor.nameFa || vendor.name || ''} ${vendor.contactPerson || ''} ${vendor.category || ''}`.toLowerCase();

      return `<tr class="inv-vendor-row" data-search-text="${esc(searchKey)}">
        <td>
          <div class="inv-vendor-cell">
            <strong>${esc(vendor.nameFa || vendor.name || vendor.id)}</strong>
            <span class="inv-status ${isSpot ? 'is-spot' : 'is-good'}">${isSpot ? 'خرید آزاد / بازار روز' : 'قراردادی'}</span>
            ${vendor.contactPerson ? `<small>مسئول: ${esc(vendor.contactPerson)}</small>` : ''}
          </div>
        </td>
        <td><span class="inv-category-pill">${esc(vendor.category || 'عمومی')}</span></td>
        <td>${vendor.phone ? `<span dir="ltr">${esc(vendor.phone)}</span>` : '<span class="text-muted">—</span>'}</td>
        <td><span class="inv-terms-pill">${esc(termsLabel)}</span></td>
        <td>
          <div class="inv-vendor-item-tags">
            ${assignedNames.length ? assignedNames.map((name) => `<span class="inv-tag">${esc(name)}</span>`).join('') : '<span class="text-muted">ماده‌ای منتسب نشده</span>'}
            ${moreCount > 0 ? `<span class="inv-tag-more">+${fa(moreCount)} قلم دیگر</span>` : ''}
          </div>
        </td>
        ${canManage ? `<td>
          <div style="display:flex;gap:0.35rem;flex-wrap:wrap;">
            <button type="button" class="inv-button inv-button--soft inv-button--sm" data-edit-vendor="${esc(vendor.id)}">ویرایش و مواد</button>
            <button type="button" class="inv-button inv-button--soft inv-button--sm" data-inv-quick-po="${esc(vendor.id)}" title="ایجاد سفارش خرید برای این تأمین‌کننده">سفارش خرید</button>
          </div>
        </td>` : ''}
      </tr>`;
    }).join('');

    return `<div class="inv-grid inv-grid--wide">
      <div class="inv-search-strip">
        <input type="text" id="inv-vendor-search" placeholder="جست‌وجوی نام تأمین‌کننده، مسئول رابط، شماره تماس یا دسته‌بندی…" />
      </div>
      <section class="inv-card inv-card--notice">
        <span class="inv-notice-icon">🏪</span>
        <div>
          <strong>مدیریت تأمین‌کنندگان و انتساب مواد اولیه</strong>
          <p>هر مادهٔ اولیه می‌تواند چند تأمین‌کننده (قراردادی یا خرید آزاد) داشته باشد. در صورت خرید متفرقه یا روزانه از بازارچه و فروشگاه، گزینهٔ «خرید آزاد / بازار روز» در دسترس است.</p>
        </div>
      </section>

      <div class="inv-cost-cards">
        <article>
          <small>کل تأمین‌کنندگان</small>
          <strong>${fa(allVendors.length)}</strong>
          <span>طرف حساب ثبت‌شده</span>
        </article>
        <article>
          <small>تأمین‌کنندگان رسمی</small>
          <strong>${fa(contractVendors.length)}</strong>
          <span>قراردادی و اعتباری</span>
        </article>
        <article class="is-spot-metric">
          <small>تأمین‌کننده آزاد</small>
          <strong>فعال</strong>
          <span>خرید روزانه و حضوری</span>
        </article>
        <article>
          <small>مواد تحت پوشش</small>
          <strong>${fa(coveredItemIds.size)} / ${fa(allItems.length)}</strong>
          <span>اقلام انبار با طرف حساب</span>
        </article>
      </div>

      <section class="inv-card inv-card--list">
        <div class="inv-card-head">
          <div>
            <span class="inv-eyebrow">فهرست طرف‌های حساب</span>
            <h2>تأمین‌کنندگان شعبه</h2>
          </div>
          <div class="inv-card-actions">
            ${canManage ? actionButton('vendor', 'تأمین‌کنندهٔ جدید') : ''}
            <a class="inv-link" href="${context.financeWorkspaceHref('purchases')}">خرید و پرداختنی در حسابداری ←</a>
          </div>
        </div>
        <div class="inv-table-wrap">
          <table class="inv-table">
            <thead>
              <tr>
                <th>تأمین‌کننده</th>
                <th>دسته‌بندی</th>
                <th>شماره تماس</th>
                <th>مهلت تسویه</th>
                <th>مواد اولیه تحت پوشش</th>
                ${canManage ? '<th>عملیات</th>' : ''}
              </tr>
            </thead>
            <tbody>
              ${rows || '<tr><td colspan="6" class="inv-empty">تأمین‌کننده‌ای ثبت نشده است.</td></tr>'}
            </tbody>
          </table>
        </div>
      </section>
    </div>`;
  }

  function vendorFormMarkup(vendor = null) {
    const isEdit = Boolean(vendor?.id);
    const allItems = items();
    const assignedIds = new Set(list(vendor?.itemIds).map(String));
    const isSpot = Boolean(vendor?.isSpot || vendor?.category === 'آزاد' || vendor?.id === 'vendor-spot');
    const categories = ['عمومی', 'لبنیات', 'گوشت و پروتئین', 'سبزیجات و میوه', 'نان و آرد', 'خشکبار و قهوه', 'نوشیدنی', 'بسته‌بندی و مصرفی', 'شوینده و بهداشتی', 'آزاد'];
    const itemCategories = Array.from(new Set(allItems.map((i) => i.category || 'عمومی').filter(Boolean))).sort();

    function renderVendorChips(assigned) {
      if (!assigned.size) return '<span class="inv-placeholder">انتخاب و جست‌وجوی مواد اولیه... (کلیک برای باز شدن فهرست)</span>';
      if (assigned.size === allItems.length && allItems.length > 0) {
        return `<span class="inv-selected-chip inv-selected-chip--all">✓ همهٔ ${fa(allItems.length)} ماده اولیه انبار انتخاب شده‌اند</span>`;
      }
      const arr = Array.from(assigned);
      const visible = arr.slice(0, 3);
      const remaining = arr.length - visible.length;
      let html = visible.map((id) => {
        const item = itemById(id);
        return `<span class="inv-selected-chip" data-chip-id="${esc(id)}">${esc(item?.name || id)} <button type="button" class="inv-chip-remove" data-remove-chip="${esc(id)}" aria-label="حذف">×</button></span>`;
      }).join('');
      if (remaining > 0) {
        html += `<span class="inv-selected-chip inv-selected-chip--more">+${fa(remaining)} قلم دیگر</span>`;
      }
      return html;
    }

    return `<form class="inv-form inv-form--vendor" data-inv-form="vendor">
      <input type="hidden" name="vendorId" value="${esc(vendor?.id || '')}" />
      <label>
        نام تأمین‌کننده
        <input name="nameFa" required placeholder="مثلاً لبنیات پگاه یا قصابی مهر" value="${esc(vendor?.nameFa || vendor?.name || '')}" />
      </label>
      <label>
        دسته‌بندی اقلام
        <select name="category">
          ${categories.map((c) => `<option value="${esc(c)}"${(vendor?.category || 'عمومی') === c ? ' selected' : ''}>${esc(c)}</option>`).join('')}
        </select>
      </label>
      <label>
        شماره تماس
        <input name="phone" type="tel" dir="ltr" placeholder="0912..." value="${esc(vendor?.phone || '')}" />
      </label>
      <label>
        مسئول یا نماینده فروش (اختیاری)
        <input name="contactPerson" placeholder="نام رابط فروش یا ویزیتور" value="${esc(vendor?.contactPerson || '')}" />
      </label>
      <label>
        مهلت تسویه حساب (روز)
        <input name="termsDays" inputmode="numeric" type="number" min="0" placeholder="۰ برای نقدی، ۳۰ برای ماهانه" value="${vendor?.termsDays ?? 30}" />
      </label>
      <label class="inv-checkbox-label">
        <input type="checkbox" name="isSpot" value="true"${isSpot ? ' checked' : ''} />
        <span>این طرف حساب «تأمین‌کننده آزاد / خرید روز» است (خرید متفرقه حضوری)</span>
      </label>
      <div class="inv-form-full">
        <label>یادداشت یا آدرس</label>
        <textarea name="notes" placeholder="آدرس، شماره حساب یا شرایط تحویل...">${esc(vendor?.notes || '')}</textarea>
      </div>
      <div class="inv-form-full inv-multiselect-wrapper" data-inv-multiselect>
        <div class="inv-multiselect-header">
          <span class="inv-label">مواد اولیه تحت پوشش این تأمین‌کننده (${fa(allItems.length)} ماده در انبار)</span>
          <div class="inv-multiselect-quick-actions">
            <button type="button" class="inv-btn-text" data-multiselect-all>انتخاب همه (${fa(allItems.length)})</button>
            <span class="inv-sep">·</span>
            <button type="button" class="inv-btn-text" data-multiselect-clear>پاک‌کردن همه</button>
          </div>
        </div>

        <div class="inv-cat-filters-bar" data-category-filters>
          <button type="button" class="inv-cat-btn is-active" data-filter-cat="all">همه اقلام (${fa(allItems.length)})</button>
          ${itemCategories.map((cat) => {
            const count = allItems.filter((i) => (i.category || 'عمومی') === cat).length;
            return `<button type="button" class="inv-cat-btn" data-filter-cat="${esc(cat)}">${esc(cat)} (${fa(count)})</button>`;
          }).join('')}
        </div>

        <div class="inv-multiselect-control" data-multiselect-trigger tabindex="0" role="combobox" aria-expanded="false">
          <div class="inv-multiselect-chips" data-multiselect-chips>
            ${renderVendorChips(assignedIds)}
          </div>
          <span class="inv-multiselect-arrow">▾</span>
        </div>

        <div class="inv-multiselect-dropdown" data-multiselect-dropdown style="display:none;">
          <div class="inv-multiselect-search-box">
            <input type="search" class="inv-multiselect-search-input" data-multiselect-search placeholder="جست‌وجوی سریع بین مواد اولیه (نام، کد، دسته)..." />
            <button type="button" class="inv-btn-select-group" data-multiselect-select-group title="انتخاب دسته‌ای اقلام در حال نمایش">انتخاب این دسته</button>
            <span class="inv-multiselect-count" data-multiselect-count>${fa(assignedIds.size)} انتخاب شده</span>
          </div>

          <div class="inv-multiselect-list" data-multiselect-list>
            ${allItems.map((item) => {
              const isChecked = assignedIds.has(String(item.id));
              const itemCat = item.category || 'عمومی';
              const searchText = `${item.name || ''} ${item.sku || ''} ${itemCat} ${unit(item)}`.toLowerCase();
              return `<label class="inv-multiselect-item ${isChecked ? 'is-selected' : ''}" data-search-text="${esc(searchText)}" data-item-category="${esc(itemCat)}">
                <input type="checkbox" name="itemIds" value="${esc(item.id)}"${isChecked ? ' checked' : ''} />
                <span class="inv-item-info">
                  <strong>${esc(item.name || item.id)}</strong>
                  <small>${esc(itemCat)} · ${esc(unit(item))}${item.sku ? ` · کد: ${esc(item.sku)}` : ''}</small>
                </span>
                <span class="inv-item-check-indicator">✓</span>
              </label>`;
            }).join('')}
            <div class="inv-multiselect-no-match" data-multiselect-no-match style="display:none;">
              موردی با این عبارت یا در این دسته‌بندی پیدا نشد.
            </div>
          </div>
        </div>
      </div>
      <button class="inv-button inv-button--primary" type="submit">${isEdit ? 'ذخیرهٔ تغییرات تأمین‌کننده' : 'ثبت تأمین‌کننده جدید'}</button>
    </form>`;
  }

  const standardUnits = [
    { value: 'گرم', label: 'گرم (g)' },
    { value: 'کیلوگرم', label: 'کیلوگرم (kg)' },
    { value: 'میلی‌لیتر', label: 'میلی‌لیتر (ml)' },
    { value: 'لیتر', label: 'لیتر (l)' },
    { value: 'عدد', label: 'عدد (count)' },
    { value: 'بسته', label: 'بسته' },
    { value: 'بطری', label: 'بطری' },
    { value: 'برگ', label: 'برگ' },
    { value: 'قاشق', label: 'قاشق' },
    { value: 'قالب', label: 'قالب' },
  ];

  function unitSelectOptions(selectedUnit = '') {
    const normalized = String(selectedUnit || '').trim().toLowerCase();
    return standardUnits.map((u) => {
      const isSel = u.value === selectedUnit ||
        u.value.toLowerCase() === normalized ||
        (u.value === 'کیلوگرم' && (normalized === 'kg' || normalized === 'kilogram')) ||
        (u.value === 'گرم' && (normalized === 'g' || normalized === 'gram')) ||
        (u.value === 'لیتر' && (normalized === 'l' || normalized === 'liter')) ||
        (u.value === 'میلی‌لیتر' && (normalized === 'ml' || normalized === 'milliliter')) ||
        (u.value === 'عدد' && (normalized === 'count' || normalized === 'piece' || normalized === 'pcs' || normalized === 'واحد'));
      return `<option value="${esc(u.value)}"${isSel ? ' selected' : ''}>${esc(u.label)}</option>`;
    }).join('');
  }

  function itemOptions({ includeEmpty = true, selectedId = '' } = {}) {
    const subRecipeItems = new Set(recipes().filter((r) => r.outputItemId).map((r) => String(r.outputItemId)));
    return `${includeEmpty ? '<option value="">انتخاب ماده اولیه</option>' : ''}${items().map((item) => {
      const isSel = String(item.id) === String(selectedId);
      const isSubRecipe = subRecipeItems.has(String(item.id));
      const label = `${item.name || item.id}${isSubRecipe ? ' [دستور نیمه‌آماده]' : ''} (${unit(item)})`;
      return `<option value="${esc(item.id)}"${isSel ? ' selected' : ''} data-unit="${esc(unit(item))}">${esc(label)}</option>`;
    }).join('')}`;
  }

  function recipeIngredientLineHtml(ingredient = {}) {
    const selectedItemId = ingredient.itemId || '';
    const selectedUnit = ingredient.unit || (selectedItemId ? itemById(selectedItemId)?.unit : 'کیلوگرم');
    const qty = ingredient.quantity ?? ingredient.qty ?? '';
    const basis = ingredient.quantityBasis || 'raw';
    const yieldPct = ingredient.yieldPercent ?? 100;
    return `<div class="inv-recipe-line" data-recipe-line>
      <select name="itemId" data-recipe-item required>${itemOptions({ includeEmpty: true, selectedId: selectedItemId })}</select>
      <input name="quantity" type="number" min="0.0001" step="any" placeholder="مقدار" value="${qty}" required class="recipe-qty-input" />
      <select name="unit" data-recipe-unit required>${unitSelectOptions(selectedUnit)}</select>
      <select name="quantityBasis" class="recipe-basis-select" title="مبنای مقدار مصرف">
        <option value="raw"${basis === 'raw' ? ' selected' : ''}>ناخالص (خرید)</option>
        <option value="usable"${basis === 'usable' ? ' selected' : ''}>خالص (پخته)</option>
      </select>
      <div class="recipe-yield-wrap" title="درصد بازده پس از پاک‌سازی یا پخت (دورریز)">
        <input name="yieldPercent" type="number" min="1" max="100" step="1" value="${yieldPct}" class="recipe-yield-input" />
        <span>٪ بازده</span>
      </div>
      <button type="button" class="inv-icon-button" data-inv-remove-line aria-label="حذف ماده">×</button>
      <div class="recipe-line-calc" data-line-calc>
        <span>ناخالص مورد نیاز: <strong data-calc-gross>—</strong></span>
        <span>بهای برآوردی: <strong data-calc-cost>—</strong></span>
      </div>
    </div>`;
  }

  function recipeIngredientRows(ingredients = []) {
    const lines = list(ingredients).length ? ingredients.map(recipeIngredientLineHtml).join('') : recipeIngredientLineHtml();
    return `<div class="inv-recipe-lines" data-recipe-lines>${lines}</div><button type="button" class="inv-button inv-button--soft" data-inv-add-line>+ افزودن مادهٔ دیگر</button>`;
  }

  function recipesView() {
    const canOperate = context.hasCapability?.('inventory.operations');
    const allRecipes = recipes();
    const rows = allRecipes.map((recipe) => {
      const isApproved = recipe.status === 'approved';
      const costLabel = recipe.costStatus === 'estimated' ? '<small>بهای برآوردی برای تست</small>' : '';
      return `<tr>
        <td>
          <strong>${esc(recipeLabel(recipe))}</strong>
          <small>${esc(recipe.menuItemId || 'بدون محصول منو')} · ${recipe.version ? `نسخه ${fa(recipe.version)}` : 'نسخه ۱'}</small>
        </td>
        <td>${fa(list(recipe.ingredients).length)} قلم ماده</td>
        <td>${fa(recipe.yieldQuantity || recipe.servings || 1)} پرس</td>
        <td><span class="inv-status ${statusClass(recipe.status)}">${statusLabel(recipe.status)}</span>${costLabel}</td>
        <td>${recipe.effectiveFrom ? esc(String(recipe.effectiveFrom).slice(0, 10)) : '—'}</td>
        ${canOperate ? `<td><button type="button" class="inv-button inv-button--soft inv-button--sm" data-edit-recipe="${esc(recipe.id || recipe.menuItemId)}">ویرایش دستور تهیه</button></td>` : ''}
      </tr>`;
    }).join('');

    return `<div class="inv-grid inv-grid--wide">
      <section class="inv-card inv-card--notice">
        <span class="inv-notice-icon">✓</span>
        <div>
          <strong>اتصال مستقیم محصولات منو به مواد اولیه و انبار</strong>
          <p>هر محصول دارای دستور تهیه اختصاصی با واحدهای استاندارد است و از همین کارتابل قابل پیگیری است.</p>
        </div>
      </section>
      <section class="inv-card inv-card--list">
        <div class="inv-card-head">
          <div>
            <span class="inv-eyebrow">فهرست دستورهای تهیه</span>
            <h2>دستورهای تهیه متصل به محصولات</h2>
          </div>
          <div class="inv-card-actions">${canOperate ? actionButton('recipe', 'رسپی جدید') : ''}<a class="inv-link" href="${context.financeWorkspaceHref('costing')}">گزارش بهای تمام‌شده ←</a></div>
        </div>
        <div class="inv-table-wrap">
          <table class="inv-table">
            <thead>
              <tr>
                <th>محصول</th>
                <th>مواد اولیه</th>
                <th>بازده</th>
                <th>وضعیت</th>
                <th>شروع اثر</th>
                ${canOperate ? '<th>عملیات</th>' : ''}
              </tr>
            </thead>
            <tbody>${rows || '<tr><td colspan="6" class="inv-empty">دستور تهیه‌ای ثبت نشده است.</td></tr>'}</tbody>
          </table>
        </div>
      </section>
    </div>`;
  }

  function recipeFormMarkup() {
    const allRecipes = recipes();
    return `<form class="inv-form inv-form--recipe" data-inv-form="recipe">
      <input type="hidden" name="recipeId" id="input-recipe-id" value="" />
      <label>محصول منو<select name="menuItemId" id="select-menu-item" required><option value="">انتخاب محصول برای ثبت نسخهٔ دستور تهیه</option>${menuItems().map((item) => { const hasRcp = allRecipes.some((r) => String(r.menuItemId) === String(item.id)); return `<option value="${esc(item.id)}">${esc(item.name || item.title || item.id)} ${hasRcp ? '✓ (دارای نسخه)' : ''}</option>`; }).join('')}</select></label>
      <label>نام دستور تهیه<input name="recipeName" id="input-recipe-name" placeholder="اختیاری؛ نام محصول استفاده می‌شود" /></label>
      <label>تعداد پرس / بازده<input name="yieldQuantity" id="input-yield-qty" inputmode="decimal" type="text" value="۱" required /></label>
      <label>شروع اثر<input name="effectiveFrom" id="input-effective-from" type="date" value="${dateOnly()}" required /></label>
      <label>محصول تولیدی دسته‌ای (اختیاری)<select name="outputItemId" id="select-output-item"><option value="">بدون تولید دسته‌ای</option>${itemOptions({ includeEmpty: false })}</select></label>
      <div class="recipe-batch-scaler">
        <span>مقیاس دسته‌ای پخت:</span>
        <button type="button" class="recipe-scale-btn is-active" data-scale="1">۱×</button>
        <button type="button" class="recipe-scale-btn" data-scale="2">۲×</button>
        <button type="button" class="recipe-scale-btn" data-scale="5">۵×</button>
        <button type="button" class="recipe-scale-btn" data-scale="10">۱۰×</button>
        <button type="button" class="recipe-scale-btn" data-scale="25">۲۵×</button>
      </div>
      <div class="inv-form-full"><span class="inv-label">مواد تشکیل‌دهنده</span>${recipeIngredientRows()}</div>
      <div class="inv-form-full">
        <label>یادداشت و دستورالعمل پخت
          <textarea name="notes" id="input-recipe-notes" placeholder="دستورالعمل آماده‌سازی، نکات حرارت و سرو..."></textarea>
        </label>
      </div>
      <div class="recipe-live-summary">
        <article><small>کل بهای مواد</small><strong id="recipe-sum-total-cost">—</strong></article>
        <article><small>بهای تمام‌شده هر پرس</small><strong id="recipe-sum-portion-cost">—</strong></article>
        <article><small>قیمت منو</small><strong id="recipe-sum-menu-price">—</strong></article>
        <article><small>درصد بهای غذا</small><strong id="recipe-sum-food-cost-pct">—</strong></article>
      </div>
      <div id="recipe-cost-alert" class="recipe-danger-alert" style="display:none;"></div>
      <button type="button" class="inv-button inv-button--soft inv-button--sm" id="reset-recipe-form" style="display:none;">دستور تهیه جدید</button>
      <button class="inv-button inv-button--primary" id="btn-save-recipe" type="submit">ارسال نسخهٔ دستور تهیه برای تأیید</button>
    </form>`;
  }

  function operationsView() {
    const operations = list(data.kitchen.recentOperations || data.kitchen.operations);
    const pendingPOs = list(data.kitchen.receivablePurchaseOrders);

    return `<div class="inv-grid inv-grid--wide">
      <div class="inv-action-grid">
        <button type="button" data-inv-view="waste">
          <b>ثبت ضایعات</b>
          <span>کاهش کنترل‌شدهٔ مواد با علت مشخص</span>
        </button>
        <button type="button" data-inv-view="counts">
          <b>انبارگردانی</b>
          <span>مقایسهٔ شمارش فیزیکی با دفتر موجودی</span>
        </button>
        <button type="button" data-inv-view="production">
          <b>ثبت تولید</b>
          <span>مصرف مواد و تولید محصول آماده</span>
        </button>
        <a href="${context.financeWorkspaceHref('purchases')}">
          <b>خرید و دریافت</b>
          <span>سفارش خرید، رسید کالا و پرداختنی</span>
        </a>
      </div>

      <section class="inv-card inv-card--list">
        <div class="inv-card-head">
          <div>
            <span class="inv-eyebrow">بارانداز و دریافت کالا در آشپزخانه</span>
            <h2>سفارش‌های خرید در انتظار تحویل و توزین</h2>
            <p>مقادیر تحویل‌شده را بررسی و توزین کنید؛ ثبت رسید انبار بلافاصله موجودی انبار را شارژ و سند حسابداری دریافت ایجاد می‌کند.</p>
          </div>
          <div class="inv-card-actions">
            <a class="inv-link" href="${context.financeWorkspaceHref('purchases')}">مدیریت فاکتورها و پرداختنی‌ها ←</a>
          </div>
        </div>

        <div class="inv-receiving-dock">
          ${pendingPOs.length ? pendingPOs.map((po) => `
            <article class="inv-po-card" data-po-id="${esc(po.id)}">
              <div class="inv-po-card-head">
                <div>
                  <h3>${esc(po.vendorName)} <small style="color:var(--p-text-dim);">· سفارش ${esc(po.number || po.id)}</small></h3>
                  <p>موعد تحویل: ${po.expectedDate ? esc(po.expectedDate) : 'امروز'} · ${fa(po.lines.length)} قلم کالا</p>
                </div>
                <span class="inv-status is-good">آماده تحویل</span>
              </div>
              <div class="inv-table-wrap">
                <table class="inv-receive-table">
                  <thead>
                    <tr>
                      <th>شرح قلم</th>
                      <th>واحد</th>
                      <th>سفارش</th>
                      <th>قبلاً دریافت شده</th>
                      <th>مانده منتظر</th>
                      <th style="min-width: 110px;">مقدار دریافتی امروز</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${po.lines.map((line) => `
                      <tr data-line-id="${esc(line.id)}">
                        <td><strong>${esc(line.description || line.itemId)}</strong></td>
                        <td>${esc(line.unit || '—')}</td>
                        <td>${fa(line.orderedQuantity)}</td>
                        <td>${fa(line.receivedQuantity)}</td>
                        <td><strong style="color:var(--p-accent);">${fa(line.remainingQuantity)}</strong></td>
                        <td>
                          <input type="text" inputmode="decimal" class="inv-receive-qty-input" data-po-id="${esc(po.id)}" data-line-id="${esc(line.id)}" data-max="${line.remainingQuantity}" value="${line.remainingQuantity}" />
                        </td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>
              <div class="inv-qc-chips">
                <span class="inv-qc-chip is-checked" data-qc-check>✓ تأیید دمای استاندارد یخچال و فریزر</span>
                <span class="inv-qc-chip is-checked" data-qc-check>✓ بررسی سلامت ظاهری و پلمپ بسته‌بندی</span>
                <span class="inv-qc-chip is-checked" data-qc-check>✓ انقضای معتبر و بهداشتی</span>
              </div>
              <div style="display:flex;justify-content:flex-end;gap:0.75rem;">
                <button type="button" class="inv-button inv-button--primary" data-inv-receive-po="${esc(po.id)}">
                  تأیید توزین و ثبت رسید انبار (Goods Receipt)
                </button>
              </div>
            </article>
          `).join('') : '<div class="inv-empty">سفارش خرید بازی در انتظار دریافت کالا برای این شعبه وجود ندارد.</div>'}
        </div>
      </section>

      <section class="inv-card">
        <div class="inv-card-head">
          <div>
            <span class="inv-eyebrow">ردپای ثبت‌شده</span>
            <h2>آخرین گردش‌های انبار</h2>
          </div>
        </div>
        <div class="inv-activity-list">
          ${operations.slice(0, 25).map((row) => `
            <article>
              <span class="inv-activity-dot"></span>
              <div>
                <strong>${esc(row.kindLabel || movementTypeLabel(row.movementType || row.type || row.source))}</strong>
                <small>${esc(row.itemName || row.itemId || '')} · ${row.occurredAt ? context.fmtDateTime(row.occurredAt) : 'زمان ثبت نشده'}</small>
              </div>
              <em>${row.quantityBase != null ? fa(row.quantityBase) : ''}</em>
            </article>
          `).join('') || '<p class="inv-empty">هنوز گردش جدیدی برای این شعبه ثبت نشده است.</p>'}
        </div>
      </section>
    </div>`;
  }
  function operationCards() { return operationsView(); }

  function countsView() {
    const canManage = context.hasCapability?.('inventory.operations') || context.hasCapability?.('inventory.manage') || context.hasCapability?.('admin.access');
    const allItems = items();
    const operations = list(data.kitchen.recentOperations || data.kitchen.operations);
    const countOps = operations.filter((op) => String(op.source || op.type || op.movementType).includes('stock_count'));
    const categories = Array.from(new Set(allItems.map((it) => it.category || 'سایر'))).filter(Boolean);

    const rows = allItems.map((item) => {
      const bookQty = item.availableQuantity == null ? 0 : Number(item.availableQuantity);
      const cost = Number(item.avgCostIrr ?? item.unitCostIrr ?? 0);
      return `<tr class="inv-stocktake-row" data-item-id="${esc(item.id)}" data-cat="${esc(item.category || 'سایر')}">
        <td>
          <strong>${esc(item.name || item.id)}</strong>
          <small>${esc(item.sku || 'بدون کد')} · ${esc(item.category || 'سایر')}</small>
        </td>
        <td><span class="inv-unit-pill">${esc(unit(item))}</span></td>
        <td><strong class="inv-book-qty">${fa(bookQty)}</strong></td>
        <td>
          <input type="text" inputmode="decimal" class="inv-count-input" data-item-id="${esc(item.id)}" data-book-qty="${bookQty}" data-unit-cost="${cost}" placeholder="مقدار واقعی…" />
        </td>
        <td>
          <span class="inv-variance-pill is-none" data-variance-for="${esc(item.id)}">—</span>
        </td>
        <td>
          <span class="inv-variance-cost" data-cost-for="${esc(item.id)}">—</span>
        </td>
        <td>
          <button type="button" class="inv-button inv-button--soft inv-button--xs" data-inv-quick-count="${esc(item.id)}" title="ثبت فوری شمارش این قلم">ثبت ردیف</button>
        </td>
      </tr>`;
    }).join('');

    return `<div class="inv-grid inv-grid--wide">
      <section class="inv-card inv-card--list">
        <div class="inv-card-head">
          <div>
            <span class="inv-eyebrow">انبارگردانی و تطبیق فیزیکی</span>
            <h2>کاربرگ شمارش موجودی انبار</h2>
            <p>شمارش واقعی را در ستون مربوطه وارد کنید؛ اختلاف کسری یا اضافی و ارزش ریالی انحراف به‌صورت آنی محاسبه می‌شود.</p>
          </div>
          <div class="inv-card-actions">
            ${canManage ? actionButton('counts', 'ثبت شمارش مجزا') : ''}
            <button type="button" class="inv-button inv-button--primary" data-inv-submit-counts-batch>ثبت نهایی اقلام شمارش‌شده</button>
            <button type="button" class="inv-button inv-button--soft" onclick="window.print()" title="چاپ فرم جهت شمارش دستی">چاپ فرم شمارش 🖨️</button>
          </div>
        </div>

        <div class="inv-counts-kpis">
          <article>
            <small>کل اقلام فعال</small>
            <strong id="st-total-items">${fa(allItems.length)}</strong>
            <span>قلم کالای موجود</span>
          </article>
          <article>
            <small>اقلام واردشده</small>
            <strong id="st-counted-items">۰</strong>
            <span>شمارش‌شده</span>
          </article>
          <article class="is-warn">
            <small>اقلام دارای کسری</small>
            <strong id="st-shortage-items">۰</strong>
            <span>کسری فیزیکی</span>
          </article>
          <article>
            <small>اقلام دارای اضافی</small>
            <strong id="st-surplus-items">۰</strong>
            <span>مازاد بر دفتر</span>
          </article>
          <article>
            <small>خالص ارزش انحراف</small>
            <strong id="st-net-variance-cost">۰ تومان</strong>
            <span>بر مبنای بهای میانگین</span>
          </article>
        </div>

        <div class="inv-counts-toolbar">
          <div class="inv-cat-filters-bar" role="tablist">
            <button type="button" class="inv-cat-btn is-active" data-st-filter="all">همه (${fa(allItems.length)})</button>
            ${categories.map((c) => `<button type="button" class="inv-cat-btn" data-st-filter="${esc(c)}">${esc(c)}</button>`).join('')}
          </div>
          <div class="inv-counts-actions">
            <button type="button" class="inv-btn-text" data-inv-count-autofill>شمارش منطبق با دفتر ✓</button>
            <span class="inv-sep">|</span>
            <button type="button" class="inv-btn-text" data-inv-count-clear>پاکسازی مقادیر ↺</button>
            <span class="inv-sep">|</span>
            <button type="button" class="inv-btn-text" data-inv-count-filter-discrepancy>فقط اقلام دارای اختلاف ⚠️</button>
          </div>
        </div>

        <div class="inv-table-wrap">
          <table class="inv-table inv-stocktake-table">
            <thead>
              <tr>
                <th>ماده اولیه</th>
                <th>واحد</th>
                <th>موجودی دفتر</th>
                <th style="min-width: 140px;">شمارش فیزیکی واقعی</th>
                <th>اختلاف شمارش</th>
                <th>ارزش ریالی اختلاف</th>
                <th>عملیات</th>
              </tr>
            </thead>
            <tbody>
              ${rows || '<tr><td colspan="7" class="inv-empty">هنوز ماده‌ای برای این شعبه ثبت نشده است.</td></tr>'}
            </tbody>
          </table>
        </div>
      </section>

      ${countOps.length ? `
      <section class="inv-card">
        <div class="inv-card-head">
          <div>
            <span class="inv-eyebrow">سوابق انبارگردانی</span>
            <h2>ثبت‌های اخیر انبارگردانی و تعدیل موجودی</h2>
          </div>
        </div>
        <div class="inv-activity-list">
          ${countOps.slice(0, 10).map((row) => `
            <article>
              <span class="inv-activity-dot"></span>
              <div>
                <strong>${esc(itemById(row.itemId)?.name || row.itemId || 'انبارگردانی')}</strong>
                <small>${row.occurredAt ? context.fmtDateTime(row.occurredAt) : 'زمان ثبت نشده'} · ${esc(row.reason || 'تطبیق دوره‌ای')}</small>
              </div>
              <div style="text-align: left;">
                <em>${row.quantity != null ? fa(row.quantity) : ''} ${esc(row.unit || '')}</em>
                <span class="inv-status ${statusClass(row.status)}">${statusLabel(row.status)}</span>
              </div>
            </article>
          `).join('')}
        </div>
      </section>
      ` : ''}
    </div>`;
  }

  function wasteView() {
    const canManage = context.hasCapability?.('inventory.operations') || context.hasCapability?.('inventory.manage') || context.hasCapability?.('admin.access');
    const operations = list(data.kitchen.recentOperations || data.kitchen.operations);
    const wasteOps = operations.filter((op) => String(op.source || op.type || op.movementType).includes('waste'));

    const totalWasteCount = wasteOps.length;
    const totalWasteCostIrr = wasteOps.reduce((sum, op) => sum + (Number(op.totalCostIrr) || 0), 0);
    const totalWasteCostToman = Math.round(totalWasteCostIrr / 10);

    const wasteByItem = new Map();
    wasteOps.forEach((op) => {
      const id = String(op.itemId || 'other');
      const item = itemById(id);
      const name = item?.name || id;
      const cost = Number(op.totalCostIrr || 0);
      const prev = wasteByItem.get(id) || { name, cost: 0, count: 0, unit: item?.unit || op.unit };
      prev.cost += cost;
      prev.count += 1;
      wasteByItem.set(id, prev);
    });
    const topWasted = Array.from(wasteByItem.values()).sort((a, b) => b.cost - a.cost).slice(0, 3);

    return `<div class="inv-grid inv-grid--wide">
      <section class="inv-card inv-card--list">
        <div class="inv-card-head">
          <div>
            <span class="inv-eyebrow">مدیریت هدررفت و ضایعات</span>
            <h2>پایش و ثبت ضایعات مواد اولیه</h2>
            <p>ثبت دقیق ضایعات با تعیین علت باعث کاهش خودکار موجودی انبار و ثبت هزینه هدررفت در بهای تمام‌شده می‌شود.</p>
          </div>
          <div class="inv-card-actions">
            ${canManage ? actionButton('waste', 'ثبت ضایعات جدید') : ''}
            <a class="inv-link" href="${context.financeWorkspaceHref('costing')}">گزارش بهای تمام‌شده و ضایعات ←</a>
          </div>
        </div>

        <div class="inv-waste-kpis">
          <article class="is-danger">
            <small>زیان مالی ضایعات دوره</small>
            <strong>${fa(totalWasteCostToman)} تومان</strong>
            <span>بر مبنای گردش‌های ثبت‌شده</span>
          </article>
          <article>
            <small>تعداد رکوردهای ضایعات</small>
            <strong>${fa(totalWasteCount)}</strong>
            <span>مورد ثبت‌شده</span>
          </article>
          <article>
            <small>قلم با بیشترین خسارت</small>
            <strong>${esc(topWasted[0]?.name || '—')}</strong>
            <span>${topWasted[0] ? `${fa(Math.round(topWasted[0].cost / 10))} تومان` : 'بدون ضایعات'}</span>
          </article>
        </div>

        ${topWasted.length ? `
        <div class="inv-pareto-panel">
          <div class="inv-pareto-head">
            <strong>بیشترین اقلام هدررفت (تحلیل پارتو)</strong>
            <small>اقلامی که بیشترین هزینه را به مجموعه تحمیل کرده‌اند</small>
          </div>
          <div class="inv-pareto-bars">
            ${topWasted.map((item) => {
              const pct = totalWasteCostIrr > 0 ? Math.min(100, Math.round((item.cost / totalWasteCostIrr) * 100)) : 0;
              return `<div class="inv-pareto-row">
                <div class="inv-pareto-label">
                  <span>${esc(item.name)}</span>
                  <small>${fa(Math.round(item.cost / 10))} تومان (${fa(pct)}٪)</small>
                </div>
                <div class="inv-pareto-track">
                  <div class="inv-pareto-fill" style="width: ${pct}%;"></div>
                </div>
              </div>`;
            }).join('')}
          </div>
        </div>
        ` : ''}

        <div class="inv-table-wrap">
          <table class="inv-table inv-waste-table">
            <thead>
              <tr>
                <th>تاریخ و ساعت</th>
                <th>ماده اولیه</th>
                <th>مقدار دورریز</th>
                <th>واحد</th>
                <th>ارزش ریالی زیان</th>
                <th>علت هدررفت</th>
                <th>وضعیت حسابداری</th>
              </tr>
            </thead>
            <tbody>
              ${wasteOps.length ? wasteOps.map((op) => {
                const item = itemById(op.itemId);
                const costToman = op.totalCostIrr != null ? Math.round(Number(op.totalCostIrr) / 10) : null;
                return `<tr>
                  <td><small>${op.occurredAt ? context.fmtDateTime(op.occurredAt) : '—'}</small></td>
                  <td><strong>${esc(item?.name || op.itemId || 'نامشخص')}</strong></td>
                  <td><b>${op.quantity != null ? fa(op.quantity) : '—'}</b></td>
                  <td>${esc(op.unit || item?.unit || '—')}</td>
                  <td>${costToman != null ? `<strong>${fa(costToman)} تومان</strong>` : '<small class="is-warn">در انتظار ارزش‌گذاری</small>'}</td>
                  <td><span>${esc(op.reason || 'دورریز عادی')}</span></td>
                  <td><span class="inv-status ${statusClass(op.status)}">${statusLabel(op.status)}</span></td>
                </tr>`;
              }).join('') : '<tr><td colspan="7" class="inv-empty">خوشبختانه هیچ ضایعاتی در این دوره ثبت نشده است.</td></tr>'}
            </tbody>
          </table>
        </div>
      </section>
    </div>`;
  }

  function movementForm(kind) {
    if (kind === 'counts') return countsView();
    if (kind === 'waste') return wasteView();
    return `<section class="inv-card inv-card--list"><div class="inv-card-head"><div><span class="inv-eyebrow">${esc(kind)}</span><h2>ثبت گردش انبار</h2></div></div></section>`;
  }

  function movementFormMarkup(kind) {
    const isWaste = kind === 'waste';
    return `<form class="inv-form" data-inv-form="${kind}"><label>ماده<select name="itemId" required>${itemOptions()}</select></label><label>${isWaste ? 'مقدار ضایعات' : 'مقدار شمارش‌شده'}<input name="quantity" inputmode="decimal" type="text" required /></label><label>واحد<select name="unit" required>${unitSelectOptions('کیلوگرم')}</select></label>${isWaste ? `<div class="inv-form-full"><span class="inv-label">علت شایع ضایعات:</span><div class="inv-qc-chips"><span class="inv-qc-chip" data-waste-preset="دورریز آماده‌سازی و پاک‌کردن">دورریز آماده‌سازی</span><span class="inv-qc-chip" data-waste-preset="فساد و انقضای تاریخ مصرف">انقضا و فساد</span><span class="inv-qc-chip" data-waste-preset="سوختگی و خطای پخت پرسنل">سوختگی و پخت</span><span class="inv-qc-chip" data-waste-preset="افتادن و شکستگی ظرف">افتادن / شکستگی</span><span class="inv-qc-chip" data-waste-preset="مرجوعی مهمان سالن">مرجوعی مهمان</span></div></div>` : ''}<label class="inv-form-full">${isWaste ? 'علت ضایعات' : 'توضیح شمارش'}<textarea name="reason" required placeholder="توضیح کوتاه و قابل پیگیری"></textarea></label><button class="inv-button inv-button--primary" type="submit">ثبت ${isWaste ? 'ضایعات' : 'شمارش'}</button></form>`;
  }

  function productionView() {
    const productionRecipes = recipes().filter((recipe) => recipe.status === 'approved' && recipe.outputItemId);
    return `<section class="inv-card inv-card--list"><div class="inv-card-head"><div><span class="inv-eyebrow">تولید دسته‌ای</span><h2>ثبت تولید محصول آماده</h2><p>مواد دستور تهیه کم می‌شود و محصول تولیدشده به موجودی اضافه می‌شود؛ همه‌چیز با یک رویداد قابل پیگیری ثبت می‌شود.</p></div>${actionButton('production', 'ثبت تولید', !productionRecipes.length)}</div>${productionRecipes.length ? '<div class="inv-empty">برای ثبت تولید، فرم تولید را باز کنید.</div>' : '<div class="inv-empty">برای ثبت تولید، ابتدا یک دستور تهیه تأییدشده با «محصول تولیدی» تعریف کنید.</div>'}</section>`;
  }

  function productionFormMarkup() {
    const productionRecipes = recipes().filter((recipe) => recipe.status === 'approved' && recipe.outputItemId);
    return `<form class="inv-form" data-inv-form="production"><label>دستور تهیه تأییدشده<select name="recipeId" required><option value="">انتخاب دستور تهیه</option>${productionRecipes.map((recipe) => `<option value="${esc(recipe.id)}">${esc(recipeLabel(recipe))} · خروجی: ${esc(itemById(recipe.outputItemId)?.name || recipe.outputItemId)}</option>`).join('')}</select></label><label>بازده برنامه‌ریزی‌شده<input name="plannedYield" inputmode="decimal" type="text" required /></label><label>بازده واقعی<input name="actualYield" inputmode="decimal" type="text" required /></label><button class="inv-button inv-button--primary" type="submit">ثبت تولید</button></form>`;
  }

  function costingView() {
    const summary = data.costing.summary || {};
    const theoretical = data.costing.theoreticalCogs?.amountIrr;
    const actual = data.costing.actualConsumption?.amountIrr;
    // Finance V2 exposes item profitability as a status envelope
    // ({ status, rows, ... }); keep accepting the legacy array shape while
    // rendering the canonical rows instead of silently showing an empty
    // product-margin table.
    const profitability = list(data.costing.itemProfitability?.rows || data.costing.itemProfitability);
    const coverage = list(data.costing.recipeCoverageQueue);
    return `<div class="inv-grid inv-grid--wide"><section class="inv-card inv-card--notice"><span class="inv-notice-icon">∑</span><div><strong>بهای تمام‌شده از فروش و گردش انبار ساخته می‌شود</strong><p>مبلغ نظری از snapshot دستور تهیهٔ فروش و مبلغ واقعی از گردش‌های ثبت‌شدهٔ مواد می‌آید. عددی که دادهٔ کافی ندارد به‌عنوان قطعی نمایش داده نمی‌شود.</p></div></section><section class="inv-cost-cards"><article><small>بهای نظری فروش</small><strong>${theoretical == null ? 'داده کافی نیست' : moneyIrr(theoretical)}</strong><span>${fa(summary.costSnapshots || 0)} snapshot فروش</span></article><article><small>مصرف واقعی</small><strong>${actual == null ? 'داده کافی نیست' : moneyIrr(actual)}</strong><span>${fa(summary.shadowMovements || 0)} گردش جدید</span></article><article><small>پوشش دستور تهیه</small><strong>${fa(summary.recipes || 0)}</strong><span>دستورهای تهیه فعال شعبه</span></article></section><section class="inv-card"><div class="inv-card-head"><div><span class="inv-eyebrow">محصولات فروخته‌شده</span><h2>حاشیهٔ مشارکت</h2></div></div><div class="inv-table-wrap"><table class="inv-table"><thead><tr><th>محصول</th><th>تعداد</th><th>فروش</th><th>بهای نظری</th><th>حاشیه</th></tr></thead><tbody>${profitability.slice(0, 30).map((row) => `<tr><td>${esc(row.name || row.menuItemId)}</td><td>${fa(row.quantity)}</td><td>${moneyIrr(row.netSalesIrr)}</td><td>${moneyIrr(row.theoreticalCogsIrr)}</td><td><span class="inv-status ${Number(row.contributionMarginPercent) >= 40 ? 'is-good' : 'is-warn'}">${row.contributionMarginPercent == null ? 'نامشخص' : `${fa(row.contributionMarginPercent)}٪`}</span></td></tr>`).join('') || '<tr><td colspan="5" class="inv-empty">هنوز snapshot بهای فروش ثبت نشده است.</td></tr>'}</tbody></table></div></section><section class="inv-card"><div class="inv-card-head"><div><span class="inv-eyebrow">اقدام پیشنهادی</span><h2>محصولات بدون پوشش دستور تهیه</h2></div></div><div class="inv-coverage-list">${coverage.slice(0, 20).map((row) => `<article><strong>${esc(row.menuItemName || row.menuItemId || 'محصول نامشخص')}</strong><span>${fa(row.affectedSaleLines || 0)} خط فروش · ${esc(row.issueCounts ? Object.keys(row.issueCounts).join('، ') : 'نیازمند بررسی')}</span></article>`).join('') || '<p class="inv-empty">صف پوشش دستور تهیه خالی است.</p>'}</div></section></div>`;
  }

  function expensesView() {
    const canCreate = context.hasCapability?.('finance.journal.create');
    const categories = list(data.expenses.categories);
    const expenses = list(data.expenses.expenses);
    const rows = expenses.slice(0, 40).map((expense) => `<tr><td><strong>${esc(expense.subject || expense.description)}</strong><small>${esc(expense.vendorName || 'بدون طرف حساب')} · ${esc(String(expense.date || '').slice(0, 10))}</small></td><td>${esc(categories.find((item) => item.id === expense.category)?.label || expense.category || 'سایر')}</td><td>${moneyIrr(expense.amountIrr)}</td><td><span class="inv-status ${statusClass(expense.status)}">${statusLabel(expense.status)}</span></td></tr>`).join('');
    return `<div class="inv-grid inv-grid--wide"><section class="inv-card inv-card--list"><div class="inv-card-head"><div><span class="inv-eyebrow">کارتابل هزینه</span><h2>هزینه‌های ثبت‌شده</h2></div><div class="inv-card-actions">${canCreate ? actionButton('expense', 'هزینهٔ جدید') : ''}<a class="inv-link" href="${context.financeWorkspaceHref('workbench')}">کارتابل تأیید مالی ←</a></div></div><div class="inv-table-wrap"><table class="inv-table"><thead><tr><th>شرح</th><th>دسته</th><th>مبلغ</th><th>وضعیت</th></tr></thead><tbody>${rows || '<tr><td colspan="4" class="inv-empty">هنوز هزینه‌ای در ماژول جدید ثبت نشده است.</td></tr>'}</tbody></table></div></section></div>`;
  }

  function expenseFormMarkup() {
    const categories = list(data.expenses.categories);
    const allVendors = vendors();
    return `<form class="inv-form" data-inv-form="expense"><label>دسته هزینه<select name="category" required>${categories.map((item) => `<option value="${esc(item.id)}">${esc(item.label)}</option>`).join('')}</select></label><label>مبلغ (تومان)<input name="amountToman" inputmode="decimal" type="text" required /></label><label>تاریخ<input name="date" type="date" value="${dateOnly()}" required /></label><label>روش پرداخت<select name="paymentMethod"><option value="cash">نقدی</option><option value="petty_cash">تنخواه</option><option value="bank">بانکی</option><option value="credit">اعتباری / پرداختنی</option></select></label><label>طرف حساب / تأمین‌کننده (اختیاری)<input name="vendorName" list="fin-expense-vendors" placeholder="انتخاب از لیست یا نام فروشنده" /><datalist id="fin-expense-vendors">${allVendors.map((v) => `<option value="${esc(v.nameFa || v.name)}">${esc(v.category)}</option>`).join('')}</datalist></label><label>مرجع (اختیاری)<input name="reference" placeholder="شماره رسید یا فاکتور" /></label><label class="inv-form-full">شرح هزینه<textarea name="subject" required placeholder="برای چه کاری هزینه شد؟"></textarea></label><button class="inv-button inv-button--primary" type="submit">ثبت و ارسال برای تأیید</button></form>`;
  }

  function modalShell(kind, title, description, formMarkup) {
    return `<div class="inv-modal-backdrop" data-inv-modal="${esc(kind)}"><section class="inv-modal" role="dialog" aria-modal="true" aria-labelledby="inv-modal-title"><header class="inv-modal__header"><div><span class="inv-eyebrow">فرم ثبت اطلاعات</span><h2 id="inv-modal-title">${esc(title)}</h2><p>${esc(description)}</p></div><button type="button" class="inv-modal__close" data-inv-close-modal aria-label="بستن فرم">×</button></header><div class="inv-modal__body">${formMarkup}</div></section></div>`;
  }

  function closeFormModal() {
    root?.querySelector('[data-inv-modal]')?.remove();
    root?.ownerDocument?.body?.classList.remove('inv-modal-open');
    openFormKind = null;
  }

  function openFormModal(kind, recipe = null) {
    if (!root) return;
    closeFormModal();
    const spec = {
      material: ['مادهٔ اولیهٔ جدید', 'اطلاعات ماده و موجودی اولیه را ثبت کنید.', materialFormMarkup()],
      vendor: ['مدیریت تأمین‌کننده و انتساب مواد', 'مشخصات تأمین‌کننده، نوع و مواد اولیه تحت پوشش را ثبت کنید.', vendorFormMarkup(recipe)],
      recipe: ['ثبت نسخهٔ دستور تهیه', 'محصول، مواد تشکیل‌دهنده و بازده را ثبت کنید؛ هر تغییر یک نسخهٔ جدید برای تأیید می‌سازد و نسخهٔ قبلی حذف نمی‌شود.', recipeFormMarkup()],
      waste: ['ثبت ضایعات مواد', 'کاهش موجودی را با علت مشخص و قابل پیگیری ثبت کنید.', movementFormMarkup('waste')],
      counts: ['ثبت شمارش فیزیکی', 'موجودی واقعی را ثبت کنید تا اختلاف با دفتر مشخص شود.', movementFormMarkup('counts')],
      production: ['ثبت تولید محصول آماده', 'تولید دسته‌ای را بر اساس دستور تهیه تأییدشده ثبت کنید.', productionFormMarkup()],
      expense: ['هزینهٔ جدید', 'هزینه به‌صورت سند دوبل ثبت و برای تأیید مدیر مالی ارسال می‌شود.', expenseFormMarkup()],
    }[kind];
    if (!spec) return;
    const host = root.ownerDocument.createElement('div');
    host.innerHTML = modalShell(kind, ...spec);
    const modal = host.firstElementChild;
    root.appendChild(modal);
    openFormKind = kind;
    root.ownerDocument.body.classList.add('inv-modal-open');
    if (kind === 'recipe') populateRecipeForm(recipe);
    modal.querySelector('input:not([type="hidden"]), select, textarea')?.focus();
  }

  function body(tab) {
    const navItems = TAB_NAV_ITEMS[tab] || TAB_NAV_ITEMS.inventory;
    const validNavIds = navItems.map(([id]) => id);
    let view = viewByTab[tab];
    if (!validNavIds.includes(view)) {
      view = validNavIds[0] || (tab === 'costControl' ? 'costing' : tab === 'expenses' ? 'expenses' : 'materials');
      viewByTab[tab] = view;
    }
    if (loading) return '<div class="inv-loading">در حال دریافت اطلاعات واقعی انبار و مالی…</div>';
    if (loadError) return `<div class="inv-error" role="alert"><strong>دریافت اطلاعات انجام نشد.</strong><p>${esc(actionableError(loadError, 'ارتباط با سرویس انبار و مالی برقرار نشد؛ اتصال را بررسی کنید و دوباره تلاش کنید.'))}</p><button type="button" class="inv-button inv-button--soft" data-inv-refresh>تلاش دوباره</button></div>`;
    if (view === 'materials') return materialView();
    if (view === 'vendors') return vendorsView();
    if (view === 'recipes') return recipesView();
    if (view === 'operations') return operationCards();
    if (view === 'production') return productionView();
    if (view === 'counts') return movementForm('counts');
    if (view === 'waste') return movementForm('waste');
    if (view === 'expenses') return expensesView();
    return costingView();
  }

  function render(tab) {
    if (!root) return;
    closeFormModal();
    root.innerHTML = shell(tab);
    root.querySelector('#inv-body').innerHTML = body(tab);
  }

  async function refresh(tab) {
    if (!root) return;
    try { await loadData(); render(tab); } catch (error) { root.innerHTML = `<div class="inv-error" role="alert"><strong>دریافت اطلاعات انجام نشد.</strong><p>${esc(actionableError(error, 'دریافت اطلاعات انبار و هزینه انجام نشد؛ اتصال و شعبهٔ فعال را بررسی کنید و دوباره تلاش کنید.'))}</p><button type="button" class="inv-button inv-button--soft" data-inv-refresh>تلاش دوباره</button></div>`; }
  }

  async function mutate(button, action) {
    if (button) { button.disabled = true; button.dataset.busy = '1'; }
    try { await action(); closeFormModal(); context.showToast('ثبت با موفقیت انجام شد.', 'success'); await refresh(context.activeTab?.() || 'inventory'); }
    catch (error) { context.showToast(actionableError(error, 'ثبت اطلاعات انجام نشد؛ ورودی‌ها و مجوز کاربر را بررسی کنید و دوباره تلاش کنید.'), 'error', 4200); }
    finally { if (button) { button.disabled = false; delete button.dataset.busy; } }
  }

  function formValue(form, name) {
    const field = form.elements?.[name] || form.querySelector?.(`[name="${name}"]`);
    // The Shamsi date picker keeps the ISO value in data-iso-date while the
    // visible input contains the Persian calendar representation.
    if (field?.dataset?.isoDate) return field.dataset.isoDate;
    return field?.value ?? '';
  }
  function recipePayload(form) {
    const lines = [...form.querySelectorAll('.inv-recipe-line')];
    const ingredients = lines.map((line) => ({
      itemId: formValue(line, 'itemId'),
      quantity: parseInputNumber(formValue(line, 'quantity')),
      unit: formValue(line, 'unit') || itemById(formValue(line, 'itemId'))?.unit || 'کیلوگرم',
      quantityBasis: formValue(line, 'quantityBasis') || 'raw', // fallback quantityBasis: 'raw'
      yieldPercent: parseInputNumber(formValue(line, 'yieldPercent') || 100) || 100, // fallback yieldPercent: 100
    }));
    const invalidLines = ingredients
      .map((line, index) => (!line.itemId || !Number.isFinite(line.quantity) || line.quantity <= 0 ? index + 1 : null))
      .filter(Boolean);

    return {
      branchId: context.currentBranch?.()?.id,
      recipeId: formValue(form, 'recipeId') || null,
      menuItemId: formValue(form, 'menuItemId'),
      name: formValue(form, 'recipeName'),
      notes: formValue(form, 'notes') || null,
      effectiveFrom: formValue(form, 'effectiveFrom'),
      yieldQuantity: parseInputNumber(formValue(form, 'yieldQuantity') || 1),
      outputItemId: formValue(form, 'outputItemId') || null,
      ingredients: ingredients.filter((line) => line.itemId && Number.isFinite(line.quantity) && line.quantity > 0),
      invalidLines,
    };
  }

  function recalculateRecipeSummary(form) {
    if (!form) return;
    const lines = form.querySelectorAll('.inv-recipe-line');
    let totalCostIrr = 0;
    const allMenuItems = menuItems();
    const menuItemId = form.querySelector('#select-menu-item')?.value;
    const menuItem = allMenuItems.find((m) => String(m.id) === String(menuItemId));
    const yieldQty = parseInputNumber(form.querySelector('#input-yield-qty')?.value || 1) || 1;

    lines.forEach((line) => {
      const itemId = line.querySelector('[data-recipe-item]')?.value;
      const qty = parseInputNumber(line.querySelector('.recipe-qty-input')?.value || 0) || 0;
      const unit = line.querySelector('[data-recipe-unit]')?.value || '';
      const basis = line.querySelector('.recipe-basis-select')?.value || 'raw';
      const yieldPct = Math.max(1, Math.min(100, parseInputNumber(line.querySelector('.recipe-yield-input')?.value || 100) || 100));

      const item = itemById(itemId);
      if (!item || !qty) {
        const grossEl = line.querySelector('[data-calc-gross]');
        const costEl = line.querySelector('[data-calc-cost]');
        if (grossEl) grossEl.textContent = '—';
        if (costEl) costEl.textContent = '—';
        return;
      }

      const grossNeeded = basis === 'usable' ? (qty / (yieldPct / 100)) : qty;
      const unitCostIrr = item.avgCostIrr || item.unitCostIrr || (item.cost ? item.cost * 10 : 0) || 0;
      const lineCostIrr = grossNeeded * unitCostIrr;
      totalCostIrr += lineCostIrr;

      const grossEl = line.querySelector('[data-calc-gross]');
      const costEl = line.querySelector('[data-calc-cost]');
      if (grossEl) grossEl.textContent = `${fa(Math.round(grossNeeded * 1000) / 1000)} ${esc(unit || item.unit)}`;
      if (costEl) costEl.textContent = moneyIrr(lineCostIrr);
    });

    const totalCostToman = Math.round(totalCostIrr / 10);
    const portionCostToman = Math.round(totalCostToman / yieldQty);
    const menuPriceToman = menuItem?.price || 0;

    const totalEl = form.querySelector('#recipe-sum-total-cost');
    const portionEl = form.querySelector('#recipe-sum-portion-cost');
    const menuEl = form.querySelector('#recipe-sum-menu-price');
    const pctEl = form.querySelector('#recipe-sum-food-cost-pct');
    const alertEl = form.querySelector('#recipe-cost-alert');

    if (totalEl) totalEl.textContent = `${fa(totalCostToman.toLocaleString())} تومان`;
    if (portionEl) portionEl.textContent = `${fa(portionCostToman.toLocaleString())} تومان`;
    if (menuEl) menuEl.textContent = menuPriceToman ? `${fa(menuPriceToman.toLocaleString())} تومان` : 'تعریف‌نشده';

    if (pctEl) {
      if (menuPriceToman > 0) {
        const pct = Math.round((portionCostToman / menuPriceToman) * 100);
        pctEl.textContent = `٪${fa(pct)}`;
        pctEl.style.color = pct <= 30 ? 'var(--p-accent)' : pct <= 38 ? '#f59e0b' : '#ef4444';
      } else {
        pctEl.textContent = '—';
        pctEl.style.color = '';
      }
    }

    if (alertEl) {
      if (menuPriceToman > 0 && portionCostToman > menuPriceToman) {
        alertEl.style.display = 'block';
        alertEl.textContent = `⚠️ هشدار بحرانی: بهای تمام‌شده هر پرس (${fa(portionCostToman.toLocaleString())} ت) بیشتر از قیمت فروش در منو (${fa(menuPriceToman.toLocaleString())} ت) است! این محصول زیان‌ده است.`;
      } else if (menuPriceToman > 0 && (portionCostToman / menuPriceToman) > 0.38) {
        alertEl.style.display = 'block';
        alertEl.textContent = `توجه: بهای تمام‌شده این غذا بالای ۳۸٪ قیمت فروش است. هدف‌گذاری مطلوب صنعت رستوران ۲۵٪ تا ۳۰٪ است.`;
      } else {
        alertEl.style.display = 'none';
      }
    }
  }

  function populateRecipeForm(recipe) {
    if (!root) return;
    const form = root.querySelector('[data-inv-form="recipe"]');
    if (!form) return;

    const recipeIdInput = form.querySelector('#input-recipe-id');
    const menuItemSelect = form.querySelector('#select-menu-item');
    const nameInput = form.querySelector('#input-recipe-name');
    const yieldInput = form.querySelector('#input-yield-qty');
    const effectiveInput = form.querySelector('#input-effective-from');
    const outputSelect = form.querySelector('#select-output-item');
    const notesInput = form.querySelector('#input-recipe-notes');
    const titleEl = root.querySelector('#recipe-form-title');
    const eyebrowEl = root.querySelector('#recipe-form-eyebrow');
    const resetBtn = root.querySelector('#reset-recipe-form');
    const saveBtn = root.querySelector('#btn-save-recipe');
    const linesWrap = form.querySelector('[data-recipe-lines]');

    if (recipe) {
      if (recipeIdInput) recipeIdInput.value = recipe.id || recipe.recipeId || '';
      if (menuItemSelect) menuItemSelect.value = recipe.menuItemId || '';
      if (nameInput) nameInput.value = recipe.name || '';
      if (yieldInput) yieldInput.value = recipe.yieldQuantity || recipe.servings || 1;
      if (effectiveInput) effectiveInput.value = (recipe.effectiveFrom ? String(recipe.effectiveFrom).slice(0, 10) : dateOnly());
      if (outputSelect) outputSelect.value = recipe.outputItemId || '';
      if (notesInput) notesInput.value = recipe.notes || '';

      const ingHtml = list(recipe.ingredients).map(recipeIngredientLineHtml).join('');
      if (linesWrap) linesWrap.innerHTML = ingHtml || recipeIngredientLineHtml();

      if (titleEl) titleEl.textContent = `ویرایش دستور تهیه «${recipeLabel(recipe)}»`;
      if (eyebrowEl) eyebrowEl.textContent = 'ویرایش دستور تهیه موجود';
      if (resetBtn) resetBtn.style.display = 'inline-block';
      if (saveBtn) saveBtn.textContent = 'ارسال نسخهٔ جدید برای تأیید';
    } else {
      if (recipeIdInput) recipeIdInput.value = '';
      if (nameInput) nameInput.value = '';
      if (yieldInput) yieldInput.value = '1';
      if (effectiveInput) effectiveInput.value = dateOnly();
      if (outputSelect) outputSelect.value = '';
      if (notesInput) notesInput.value = '';
      if (linesWrap) linesWrap.innerHTML = recipeIngredientLineHtml();

      if (titleEl) titleEl.textContent = 'ثبت یا ویرایش دستور تهیه محصول';
      if (eyebrowEl) eyebrowEl.textContent = 'مدیریت دستور تهیه';
      if (resetBtn) resetBtn.style.display = 'none';
      if (saveBtn) saveBtn.textContent = 'ارسال نسخهٔ دستور تهیه برای تأیید';
    }

    recalculateRecipeSummary(form);
  }

  function updateStocktakeKpis() {
    if (!root) return;
    const countInputs = root.querySelectorAll('.inv-count-input');
    if (!countInputs.length) return;

    let countedCount = 0;
    let shortageCount = 0;
    let surplusCount = 0;
    let netVarianceCostToman = 0;

    countInputs.forEach((input) => {
      const rawVal = String(input.value || '').trim();
      if (rawVal === '') return;
      const counted = parseInputNumber(rawVal);
      if (!Number.isFinite(counted)) return;

      countedCount++;
      const bookQty = Number(input.dataset.bookQty) || 0;
      const unitCostIrr = Number(input.dataset.unitCost) || 0;
      const diff = counted - bookQty;
      const costToman = Math.round((diff * unitCostIrr) / 10);
      netVarianceCostToman += costToman;

      if (diff < -0.0001) shortageCount++;
      else if (diff > 0.0001) surplusCount++;
    });

    const countedEl = root.querySelector('#st-counted-items');
    const shortageEl = root.querySelector('#st-shortage-items');
    const surplusEl = root.querySelector('#st-surplus-items');
    const netCostEl = root.querySelector('#st-net-variance-cost');

    if (countedEl) countedEl.textContent = fa(countedCount);
    if (shortageEl) shortageEl.textContent = fa(shortageCount);
    if (surplusEl) surplusEl.textContent = fa(surplusCount);
    if (netCostEl) {
      const prefix = netVarianceCostToman > 0 ? '+' : '';
      netCostEl.textContent = `${prefix}${fa(netVarianceCostToman.toLocaleString())} تومان`;
      netCostEl.style.color = netVarianceCostToman < 0 ? '#ef4444' : netVarianceCostToman > 0 ? '#10b981' : '';
    }
  }

  function bindEvents() {
    if (bound || !root) return;
    bound = true;
    function updateMultiselectUI(wrapper) {
      if (!wrapper) return;
      const chipsEl = wrapper.querySelector('[data-multiselect-chips]');
      const countEl = wrapper.querySelector('[data-multiselect-count]');
      const checkedBoxes = wrapper.querySelectorAll('input[name="itemIds"]:checked');
      const allCheckboxes = wrapper.querySelectorAll('input[name="itemIds"]');
      if (chipsEl) {
        if (!checkedBoxes.length) {
          chipsEl.innerHTML = '<span class="inv-placeholder">انتخاب و جست‌وجوی مواد اولیه... (کلیک برای باز شدن فهرست)</span>';
        } else if (checkedBoxes.length === allCheckboxes.length && allCheckboxes.length > 0) {
          chipsEl.innerHTML = `<span class="inv-selected-chip inv-selected-chip--all">✓ همهٔ ${fa(allCheckboxes.length)} ماده اولیه انبار انتخاب شده‌اند</span>`;
        } else {
          const arr = Array.from(checkedBoxes);
          const visible = arr.slice(0, 3);
          const remaining = arr.length - visible.length;
          let html = visible.map((cb) => {
            const item = itemById(cb.value);
            return `<span class="inv-selected-chip" data-chip-id="${esc(cb.value)}">${esc(item?.name || cb.value)} <button type="button" class="inv-chip-remove" data-remove-chip="${esc(cb.value)}" aria-label="حذف">×</button></span>`;
          }).join('');
          if (remaining > 0) {
            html += `<span class="inv-selected-chip inv-selected-chip--more">+${fa(remaining)} قلم دیگر</span>`;
          }
          chipsEl.innerHTML = html;
        }
      }
      if (countEl) {
        countEl.textContent = `${fa(checkedBoxes.length)} انتخاب شده`;
      }
    }

    root.addEventListener('click', (event) => {
      // Category filter button (انتخاب دسته‌ای)
      const catBtn = event.target.closest('[data-filter-cat]');
      if (catBtn) {
        const cat = catBtn.dataset.filterCat;
        const wrapper = catBtn.closest('[data-inv-multiselect]');
        if (wrapper) {
          wrapper.querySelectorAll('[data-filter-cat]').forEach((b) => b.classList.toggle('is-active', b === catBtn));
          const dropdown = wrapper.querySelector('[data-multiselect-dropdown]');
          if (dropdown && dropdown.style.display === 'none') {
            dropdown.style.display = 'block';
            wrapper.querySelector('[data-multiselect-trigger]')?.setAttribute('aria-expanded', 'true');
          }
          const searchInput = wrapper.querySelector('[data-multiselect-search]');
          const query = String(searchInput?.value || '').trim().toLowerCase();
          const items = wrapper.querySelectorAll('.inv-multiselect-item');
          let matches = 0;
          items.forEach((it) => {
            const itemCat = it.dataset.itemCategory || 'عمومی';
            const catMatch = cat === 'all' || itemCat === cat;
            const searchMatch = !query || (it.dataset.searchText || '').includes(query);
            const visible = catMatch && searchMatch;
            it.style.display = visible ? 'flex' : 'none';
            if (visible) matches++;
          });
          const noMatchEl = wrapper.querySelector('[data-multiselect-no-match]');
          if (noMatchEl) noMatchEl.style.display = matches === 0 ? 'block' : 'none';
        }
        return;
      }

      // Stocktake category filter
      const stFilterBtn = event.target.closest('[data-st-filter]');
      if (stFilterBtn) {
        const cat = stFilterBtn.dataset.stFilter;
        const toolbar = stFilterBtn.closest('.inv-counts-toolbar');
        toolbar?.querySelectorAll('[data-st-filter]').forEach((b) => b.classList.toggle('is-active', b === stFilterBtn));
        const rows = root.querySelectorAll('.inv-stocktake-table tbody tr.inv-stocktake-row');
        rows.forEach((row) => {
          const rowCat = row.dataset.cat || 'سایر';
          const match = cat === 'all' || rowCat === cat;
          row.style.display = match ? '' : 'none';
        });
        return;
      }

      // Stocktake autofill book quantity
      if (event.target.closest('[data-inv-count-autofill]')) {
        const inputs = root.querySelectorAll('.inv-count-input');
        inputs.forEach((input) => {
          input.value = input.dataset.bookQty || '0';
          input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        context.showToast?.('مقادیر موجودی دفتر در ستون شمارش درج شد.', 'info');
        return;
      }

      // Stocktake clear counts
      if (event.target.closest('[data-inv-count-clear]')) {
        const inputs = root.querySelectorAll('.inv-count-input');
        inputs.forEach((input) => {
          input.value = '';
          input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        context.showToast?.('مقادیر شمارش فیزیکی پاکسازی شد.', 'info');
        return;
      }

      // Stocktake discrepancy filter toggle
      const discBtn = event.target.closest('[data-inv-count-filter-discrepancy]');
      if (discBtn) {
        const isFiltered = discBtn.classList.toggle('is-active');
        const rows = root.querySelectorAll('.inv-stocktake-table tbody tr.inv-stocktake-row');
        rows.forEach((row) => {
          if (!isFiltered) {
            row.style.display = '';
          } else {
            const status = row.dataset.varianceStatus;
            row.style.display = (status === 'shortage' || status === 'surplus') ? '' : 'none';
          }
        });
        return;
      }

      // Single item quick count submission
      const quickCountBtn = event.target.closest('[data-inv-quick-count]');
      if (quickCountBtn) {
        const itemId = quickCountBtn.dataset.invQuickCount;
        const input = root.querySelector(`.inv-count-input[data-item-id="${itemId}"]`);
        const countedQty = parseInputNumber(input?.value);
        if (!Number.isFinite(countedQty)) {
          context.showToast?.('لطفاً ابتدا مقدار شمارش فیزیکی این قلم را وارد کنید.', 'warn');
          input?.focus();
          return;
        }
        const item = itemById(itemId);
        const branchId = context.currentBranch?.()?.id;
        mutate(quickCountBtn, async () => {
          await context.api('/api/kitchen/inventory/stock-counts', {
            method: 'POST',
            headers: { 'Idempotency-Key': key('stock-count-' + itemId) },
            body: JSON.stringify({
              branchId,
              itemId,
              countedQuantity: countedQty,
              unit: item?.unit || 'عدد',
              reason: 'تطبیق فیزیکی ردیفی',
            }),
          });
        });
        return;
      }

      // Batch stock count submission
      const batchCountBtn = event.target.closest('[data-inv-submit-counts-batch]');
      if (batchCountBtn) {
        const inputs = root.querySelectorAll('.inv-count-input');
        const itemsToSubmit = [];
        inputs.forEach((input) => {
          const raw = String(input.value || '').trim();
          if (raw === '') return;
          const counted = parseInputNumber(raw);
          if (!Number.isFinite(counted)) return;
          const itemId = input.dataset.itemId;
          const item = itemById(itemId);
          itemsToSubmit.push({
            itemId,
            countedQuantity: counted,
            unit: item?.unit || 'عدد',
            reason: 'انبارگردانی دوره‌ای',
          });
        });

        if (!itemsToSubmit.length) {
          context.showToast?.('هیچ مقداری برای ثبت انبارگردانی وارد نشده است.', 'warn');
          return;
        }

        const branchId = context.currentBranch?.()?.id;
        mutate(batchCountBtn, async () => {
          for (const record of itemsToSubmit) {
            await context.api('/api/kitchen/inventory/stock-counts', {
              method: 'POST',
              headers: { 'Idempotency-Key': key('batch-count-' + record.itemId) },
              body: JSON.stringify({ branchId, ...record }),
            });
          }
        });
        return;
      }

      // QC inspection check toggle
      const qcChip = event.target.closest('[data-qc-check]');
      if (qcChip) {
        qcChip.classList.toggle('is-checked');
        return;
      }

      // Inbound Goods Receipt confirmation for PO
      const receivePoBtn = event.target.closest('[data-inv-receive-po]');
      if (receivePoBtn) {
        const poId = receivePoBtn.dataset.invReceivePo;
        const card = receivePoBtn.closest('.inv-po-card');
        const inputs = card?.querySelectorAll('.inv-receive-qty-input') || [];
        const lines = [];
        inputs.forEach((inp) => {
          const lineId = inp.dataset.lineId;
          const qty = parseInputNumber(inp.value);
          if (Number.isFinite(qty) && qty > 0) {
            lines.push({ purchaseOrderLineId: lineId, receivedQuantity: qty });
          }
        });

        if (!lines.length) {
          context.showToast?.('حداقل مقدار یک قلم کالای تحویلی باید بزرگ‌تر از صفر باشد.', 'warn');
          return;
        }

        const branchId = context.currentBranch?.()?.id;
        const payload = {
          branchId,
          purchaseOrderId: poId,
          deliveryNoteNumber: `DN-${Date.now().toString().slice(-6)}`,
          receivedAt: new Date().toISOString(),
          lines,
        };

        mutate(receivePoBtn, async () => {
          try {
            await context.api('/api/kitchen/inventory/goods-receipts', {
              method: 'POST',
              headers: { 'Idempotency-Key': key('goods-receipt-' + poId) },
              body: JSON.stringify(payload),
            });
          } catch {
            await context.api('/api/admin/v2/finance/goods-receipts', {
              method: 'POST',
              headers: { 'Idempotency-Key': key('goods-receipt-' + poId) },
              body: JSON.stringify(payload),
            });
          }
        });
        return;
      }

      // Waste reason quick preset chips
      const presetChip = event.target.closest('[data-waste-preset]');
      if (presetChip) {
        const presetText = presetChip.dataset.wastePreset;
        const form = presetChip.closest('form');
        const reasonTextarea = form?.querySelector('textarea[name="reason"]');
        if (reasonTextarea) {
          reasonTextarea.value = presetText;
          reasonTextarea.focus();
        }
        return;
      }

      // Quick reorder and PO buttons
      const reorderBtn = event.target.closest('[data-inv-quick-reorder]');
      if (reorderBtn) {
        context.showToast?.('هدایت به کارتابل سفارش‌های خرید تأمین‌کنندگان...', 'info');
        window.location.href = context.financeWorkspaceHref?.('purchases') || '#finance/purchases';
        return;
      }
      const quickPoBtn = event.target.closest('[data-inv-quick-po]');
      if (quickPoBtn) {
        context.showToast?.('هدایت به ثبت پیش‌فاکتور خرید این تأمین‌کننده...', 'info');
        window.location.href = context.financeWorkspaceHref?.('purchases') || '#finance/purchases';
        return;
      }

      // Batch selection for visible items
      if (event.target.closest('[data-multiselect-select-group]')) {
        const wrapper = event.target.closest('[data-inv-multiselect]');
        if (wrapper) {
          const items = wrapper.querySelectorAll('.inv-multiselect-item');
          items.forEach((it) => {
            if (it.style.display !== 'none') {
              const cb = it.querySelector('input[name="itemIds"]');
              if (cb) { cb.checked = true; it.classList.add('is-selected'); }
            }
          });
          updateMultiselectUI(wrapper);
        }
        return;
      }

      // Multiselect trigger toggle
      const trigger = event.target.closest('[data-multiselect-trigger]');
      if (trigger && !event.target.closest('[data-remove-chip]')) {
        const wrapper = trigger.closest('[data-inv-multiselect]');
        const dropdown = wrapper?.querySelector('[data-multiselect-dropdown]');
        if (dropdown) {
          const isOpen = dropdown.style.display !== 'none';
          dropdown.style.display = isOpen ? 'none' : 'block';
          trigger.setAttribute('aria-expanded', !isOpen);
          if (!isOpen) {
            const searchInput = dropdown.querySelector('[data-multiselect-search]');
            if (searchInput) setTimeout(() => searchInput.focus(), 50);
          }
        }
        return;
      }

      // Chip remove button
      const removeChipBtn = event.target.closest('[data-remove-chip]');
      if (removeChipBtn) {
        event.stopPropagation();
        const chipId = removeChipBtn.dataset.removeChip;
        const wrapper = removeChipBtn.closest('[data-inv-multiselect]');
        const checkbox = wrapper?.querySelector(`input[name="itemIds"][value="${chipId}"]`);
        if (checkbox) {
          checkbox.checked = false;
          checkbox.closest('.inv-multiselect-item')?.classList.remove('is-selected');
          updateMultiselectUI(wrapper);
        }
        return;
      }

      // Multiselect Select All
      if (event.target.closest('[data-multiselect-all]')) {
        const wrapper = event.target.closest('[data-inv-multiselect]');
        if (wrapper) {
          const items = wrapper.querySelectorAll('.inv-multiselect-item');
          items.forEach((it) => {
            const cb = it.querySelector('input[name="itemIds"]');
            if (cb) { cb.checked = true; it.classList.add('is-selected'); }
          });
          updateMultiselectUI(wrapper);
        }
        return;
      }

      // Multiselect Clear All
      if (event.target.closest('[data-multiselect-clear]')) {
        const wrapper = event.target.closest('[data-inv-multiselect]');
        if (wrapper) {
          const items = wrapper.querySelectorAll('.inv-multiselect-item');
          items.forEach((it) => {
            const cb = it.querySelector('input[name="itemIds"]');
            if (cb) { cb.checked = false; it.classList.remove('is-selected'); }
          });
          updateMultiselectUI(wrapper);
        }
        return;
      }

      // Clicking outside dropdown: close dropdown
      if (!event.target.closest('[data-inv-multiselect]')) {
        root.querySelectorAll('[data-multiselect-dropdown]').forEach((d) => {
          d.style.display = 'none';
          d.closest('[data-inv-multiselect]')?.querySelector('[data-multiselect-trigger]')?.setAttribute('aria-expanded', 'false');
        });
      }

      const openButton = event.target.closest('[data-inv-open-form]');
      if (openButton) {
        openFormModal(openButton.dataset.invOpenForm);
        return;
      }
      const modal = event.target.closest('[data-inv-modal]');
      if (event.target.closest('[data-inv-close-modal]') || (modal && event.target === modal)) {
        closeFormModal();
        return;
      }
      const viewButton = event.target.closest('[data-inv-view]');
      if (viewButton && root.contains(viewButton)) {
        const next = viewButton.dataset.invView;
        viewByTab[context.activeTab?.() || 'inventory'] = next;
        render(context.activeTab?.() || 'inventory');
        return;
      }
      if (event.target.closest('[data-inv-refresh]')) { refresh(context.activeTab?.() || 'inventory'); return; }
      if (event.target.closest('[data-inv-add-line]')) {
        const lines = root.querySelector('[data-recipe-lines]');
        if (lines) {
          const div = document.createElement('div');
          div.innerHTML = recipeIngredientLineHtml();
          lines.appendChild(div.firstElementChild);
          const form = lines.closest('form');
          if (form) recalculateRecipeSummary(form);
        }
        return;
      }
      const scaleBtn = event.target.closest('.recipe-scale-btn');
      if (scaleBtn) {
        const factor = Number(scaleBtn.dataset.scale) || 1;
        const form = scaleBtn.closest('form');
        if (form) {
          form.querySelectorAll('.recipe-scale-btn').forEach((b) => b.classList.toggle('is-active', b === scaleBtn));
          const yieldInput = form.querySelector('#input-yield-qty');
          if (yieldInput) {
            if (!yieldInput.dataset.baseYield) yieldInput.dataset.baseYield = String(parseInputNumber(yieldInput.value) || 1);
            const baseYield = Number(yieldInput.dataset.baseYield) || 1;
            yieldInput.value = String(baseYield * factor);
          }
          form.querySelectorAll('.inv-recipe-line').forEach((line) => {
            const qInput = line.querySelector('.recipe-qty-input');
            if (qInput) {
              if (!qInput.dataset.baseQty) qInput.dataset.baseQty = String(parseInputNumber(qInput.value) || 0);
              const baseQty = Number(qInput.dataset.baseQty) || 0;
              if (baseQty > 0) {
                qInput.value = String(Math.round(baseQty * factor * 10000) / 10000);
              }
            }
          });
          recalculateRecipeSummary(form);
        }
        return;
      }
      const editBtn = event.target.closest('[data-edit-recipe]');
      if (editBtn) {
        const key = editBtn.dataset.editRecipe;
        const allRecipes = recipes();
        const found = allRecipes.find((r) => String(r.id) === String(key) || String(r.menuItemId) === String(key));
        if (found) {
          openFormModal('recipe', found);
        }
        return;
      }
      const editVendorBtn = event.target.closest('[data-edit-vendor]');
      if (editVendorBtn) {
        const id = editVendorBtn.dataset.editVendor;
        const vendor = vendorById(id);
        if (vendor) {
          openFormModal('vendor', vendor);
        }
        return;
      }
      if (event.target.closest('#reset-recipe-form')) {
        const select = root.querySelector('#select-menu-item');
        if (select) select.value = '';
        populateRecipeForm(null);
        return;
      }
      const remove = event.target.closest('[data-inv-remove-line]');
      if (remove) {
        const form = remove.closest('form');
        const lines = root.querySelectorAll('.inv-recipe-line');
        if (lines.length > 1) {
          remove.closest('.inv-recipe-line').remove();
          if (form) recalculateRecipeSummary(form);
        }
      }
    });

    root.addEventListener('keydown', (event) => {
      // Global navigation shortcuts (Alt + M/V/R/O/C/W)
      if (event.altKey && !event.ctrlKey && !event.metaKey) {
        const k = event.key.toLowerCase();
        const map = {
          m: 'materials',
          v: 'vendors',
          r: 'recipes',
          o: 'operations',
          c: 'counts',
          w: 'waste',
        };
        if (map[k]) {
          event.preventDefault();
          const tab = context.activeTab?.() || 'inventory';
          viewByTab[tab] = map[k];
          render(tab);
          return;
        }
      }

      if (event.target.matches('[data-multiselect-search]') && event.key === 'Enter') {
        event.preventDefault();
        return;
      }
      if (event.key === 'Escape') {
        const openDropdown = root.querySelector('[data-multiselect-dropdown][style*="display: block"], [data-multiselect-dropdown]:not([style*="display: none"])');
        if (openDropdown && openDropdown.style.display !== 'none') {
          openDropdown.style.display = 'none';
          openDropdown.closest('[data-inv-multiselect]')?.querySelector('[data-multiselect-trigger]')?.setAttribute('aria-expanded', 'false');
          return;
        }
        if (root.querySelector('[data-inv-modal]')) closeFormModal();
      }
    });

    root.addEventListener('input', (event) => {
      const recipeForm = event.target.closest('form[data-inv-form="recipe"]');
      if (recipeForm) recalculateRecipeSummary(recipeForm);

      // Stocktake input live variance calculation
      if (event.target.matches('.inv-count-input')) {
        const input = event.target;
        const itemId = input.dataset.itemId;
        const bookQty = Number(input.dataset.bookQty) || 0;
        const unitCostIrr = Number(input.dataset.unitCost) || 0;
        const item = itemById(itemId);
        const u = item?.unit || '';
        const pill = root.querySelector(`[data-variance-for="${itemId}"]`);
        const costEl = root.querySelector(`[data-cost-for="${itemId}"]`);
        const row = input.closest('tr');

        const raw = String(input.value || '').trim();
        if (raw === '') {
          if (pill) { pill.className = 'inv-variance-pill is-none'; pill.textContent = '—'; }
          if (costEl) { costEl.className = 'inv-variance-cost'; costEl.textContent = '—'; }
          if (row) delete row.dataset.varianceStatus;
        } else {
          const val = parseInputNumber(raw);
          if (!Number.isFinite(val)) {
            if (pill) { pill.className = 'inv-variance-pill is-none'; pill.textContent = 'نامعتبر'; }
            if (costEl) costEl.textContent = '—';
            if (row) delete row.dataset.varianceStatus;
          } else {
            const diff = Math.round((val - bookQty) * 1000) / 1000;
            const diffCostToman = Math.round((diff * unitCostIrr) / 10);
            if (Math.abs(diff) < 0.0001) {
              if (pill) { pill.className = 'inv-variance-pill is-match'; pill.textContent = 'منطبق ✓'; }
              if (costEl) { costEl.className = 'inv-variance-cost'; costEl.textContent = '۰ ت'; }
              if (row) row.dataset.varianceStatus = 'match';
            } else if (diff < 0) {
              if (pill) { pill.className = 'inv-variance-pill is-shortage'; pill.textContent = `${fa(diff)} ${u}`; }
              if (costEl) { costEl.className = 'inv-variance-cost is-danger'; costEl.textContent = `${fa(Math.abs(diffCostToman).toLocaleString())} ت (کسری)`; }
              if (row) row.dataset.varianceStatus = 'shortage';
            } else {
              if (pill) { pill.className = 'inv-variance-pill is-surplus'; pill.textContent = `+${fa(diff)} ${u}`; }
              if (costEl) { costEl.className = 'inv-variance-cost is-good'; costEl.textContent = `+${fa(diffCostToman.toLocaleString())} ت (مازاد)`; }
              if (row) row.dataset.varianceStatus = 'surplus';
            }
          }
        }
        updateStocktakeKpis();
      }

      // Materials live table filter
      if (event.target.matches('#inv-material-search')) {
        const query = String(event.target.value || '').trim().toLowerCase();
        const rows = root.querySelectorAll('.inv-materials-table tbody tr');
        rows.forEach((tr) => {
          const text = tr.textContent.toLowerCase();
          tr.style.display = !query || text.includes(query) ? '' : 'none';
        });
      }

      // Vendors live table filter
      if (event.target.matches('#inv-vendor-search')) {
        const query = String(event.target.value || '').trim().toLowerCase();
        const rows = root.querySelectorAll('.inv-vendors-table tbody tr');
        rows.forEach((tr) => {
          const text = tr.textContent.toLowerCase();
          tr.style.display = !query || text.includes(query) ? '' : 'none';
        });
      }

      if (event.target.matches('[data-multiselect-search]')) {
        const q = String(event.target.value || '').trim().toLowerCase();
        const wrapper = event.target.closest('[data-inv-multiselect]');
        if (!wrapper) return;
        const activeCatBtn = wrapper.querySelector('[data-filter-cat].is-active');
        const activeCat = activeCatBtn?.dataset?.filterCat || 'all';
        const items = wrapper.querySelectorAll('.inv-multiselect-item');
        let matchesCount = 0;
        items.forEach((it) => {
          const text = (it.dataset.searchText || '').toLowerCase();
          const itemCat = it.dataset.itemCategory || 'عمومی';
          const catMatch = activeCat === 'all' || itemCat === activeCat;
          const searchMatch = !q || text.includes(q);
          const show = catMatch && searchMatch;
          it.style.display = show ? 'flex' : 'none';
          if (show) matchesCount++;
        });
        const noMatchEl = wrapper.querySelector('[data-multiselect-no-match]');
        if (noMatchEl) noMatchEl.style.display = matchesCount === 0 ? 'block' : 'none';
      }
    });

    root.addEventListener('change', (event) => {
      const recipeForm = event.target.closest('form[data-inv-form="recipe"]');
      if (recipeForm) recalculateRecipeSummary(recipeForm);

      if (event.target.matches('input[name="itemIds"]')) {
        const itemRow = event.target.closest('.inv-multiselect-item');
        if (itemRow) itemRow.classList.toggle('is-selected', event.target.checked);
        const wrapper = event.target.closest('[data-inv-multiselect]');
        if (wrapper) updateMultiselectUI(wrapper);
      }

      // When menu item is selected in recipe form: auto-load existing recipe if one exists!
      if (event.target.matches('#select-menu-item')) {
        const selectedId = event.target.value;
        const allRecipes = recipes();
        const existing = allRecipes.find((r) => String(r.menuItemId) === String(selectedId));
        if (existing) {
          populateRecipeForm(existing);
        } else {
          populateRecipeForm(null);
          const nameInput = root.querySelector('#input-recipe-name');
          const mItem = menuItems().find((m) => String(m.id) === String(selectedId));
          if (nameInput && mItem) nameInput.value = mItem.name || mItem.title || '';
        }
      }

      // When ingredient item is changed: auto-select default base unit in unit dropdown
      if (event.target.matches('select[data-recipe-item]')) {
        const selectedOpt = event.target.selectedOptions?.[0];
        const defaultUnit = selectedOpt?.dataset?.unit;
        const line = event.target.closest('.inv-recipe-line');
        const unitSelect = line?.querySelector('select[data-recipe-unit]');
        if (unitSelect && defaultUnit) {
          const match = [...unitSelect.options].find((opt) => opt.value === defaultUnit || opt.value.includes(defaultUnit) || defaultUnit.includes(opt.value));
          if (match) unitSelect.value = match.value;
        }
      }
    });

    root.addEventListener('submit', (event) => {
      const form = event.target.closest('[data-inv-form]');
      if (!form) return;
      event.preventDefault();
      const button = form.querySelector('button[type="submit"]');
      const kind = form.dataset.invForm;
      mutate(button, async () => {
        const branchId = context.currentBranch?.()?.id;
        if (kind === 'material') {
          const rawCostToman = String(formValue(form, 'avgCostToman') || '').trim();
          const costToman = rawCostToman === '' ? null : parseInputNumber(rawCostToman);
          const vendorId = formValue(form, 'vendorId');
          const response = await context.api('/api/admin/v2/finance/inventory-items', { method: 'POST', headers: { 'Idempotency-Key': key('inventory') }, body: JSON.stringify({ branchId, name: formValue(form, 'name'), sku: formValue(form, 'sku'), category: formValue(form, 'category'), unit: formValue(form, 'unit'), qtyOnHand: parseInputNumber(formValue(form, 'qtyOnHand')), minStock: parseInputNumber(formValue(form, 'minStock')), avgCostIrr: costToman == null ? null : Math.round(costToman * 10) }) });
          const createdItem = response?.item || response?.data?.item || response?.data;
          if (vendorId && createdItem?.id) {
            const vendor = vendorById(vendorId);
            if (vendor) {
              const currentItemIds = list(vendor.itemIds).map(String);
              if (!currentItemIds.includes(String(createdItem.id))) {
                const linkPayload = { ...vendor, itemIds: [...currentItemIds, String(createdItem.id)], branchId };
                try {
                  await context.api(`/api/admin/v2/finance/vendors/${encodeURIComponent(vendor.id)}`, { method: 'PUT', headers: { 'Idempotency-Key': key('vendor-link') }, body: JSON.stringify(linkPayload) });
                } catch {
                  await context.api(`/api/admin/finance/vendors/${encodeURIComponent(vendor.id)}`, { method: 'PUT', headers: { 'Idempotency-Key': key('vendor-link') }, body: JSON.stringify(linkPayload) });
                }
              }
            }
          }
        } else if (kind === 'vendor') {
          const vendorId = formValue(form, 'vendorId');
          const nameFa = String(formValue(form, 'nameFa') || '').trim();
          if (!nameFa) throw new Error('لطفاً نام تأمین‌کننده را وارد کنید.');
          const itemCheckboxes = form.querySelectorAll('input[name="itemIds"]:checked');
          const itemIds = Array.from(itemCheckboxes).map((cb) => cb.value);
          const isSpot = Boolean(form.querySelector('input[name="isSpot"]')?.checked);
          const payload = {
            id: vendorId || undefined,
            name: nameFa,
            nameFa,
            category: formValue(form, 'category') || 'عمومی',
            phone: formValue(form, 'phone'),
            contactPerson: formValue(form, 'contactPerson'),
            termsDays: parseInputNumber(formValue(form, 'termsDays')),
            branchId,
            itemIds,
            isSpot,
            notes: formValue(form, 'notes'),
          };
          const apiUrl = vendorId
            ? `/api/admin/finance/vendors/${encodeURIComponent(vendorId)}`
            : '/api/admin/finance/vendors';
          const method = vendorId ? 'PUT' : 'POST';
          await context.api(apiUrl, { method, headers: { 'Idempotency-Key': key('vendor') }, body: JSON.stringify(payload) });
        } else if (kind === 'recipe') {
          const payload = recipePayload(form);
          if (payload.invalidLines?.length) throw new Error(`ردیف‌های ${payload.invalidLines.join('، ')} دستور تهیه ماده و مقدار معتبر ندارند؛ هیچ ردیفی بی‌صدا حذف نمی‌شود.`);
          if (!payload.ingredients.length) throw new Error('حداقل یک ماده برای رسپی انتخاب کنید.');
          if (!Number.isFinite(payload.yieldQuantity) || payload.yieldQuantity <= 0) throw new Error('بازده دستور تهیه باید بزرگ‌تر از صفر باشد.');
          delete payload.invalidLines;
          await context.api('/api/kitchen/inventory/recipe-versions', { method: 'POST', headers: { 'Idempotency-Key': key('recipe') }, body: JSON.stringify(payload) });
        } else if (kind === 'waste' || kind === 'counts') {
          const payload = { branchId, itemId: formValue(form, 'itemId'), unit: formValue(form, 'unit'), reason: formValue(form, 'reason') };
          if (kind === 'waste') payload.quantity = parseInputNumber(formValue(form, 'quantity'));
          else payload.countedQuantity = parseInputNumber(formValue(form, 'quantity'));
          await context.api(`/api/kitchen/inventory/${kind === 'waste' ? 'waste' : 'stock-counts'}`, { method: 'POST', headers: { 'Idempotency-Key': key(kind) }, body: JSON.stringify(payload) });
        } else if (kind === 'production') {
          await context.api('/api/kitchen/inventory/production-batches', { method: 'POST', headers: { 'Idempotency-Key': key('production') }, body: JSON.stringify({ branchId, recipeId: formValue(form, 'recipeId'), plannedYield: parseInputNumber(formValue(form, 'plannedYield')), actualYield: parseInputNumber(formValue(form, 'actualYield')) }) });
        } else if (kind === 'expense') {
          await context.api('/api/admin/v2/finance/operating-expenses', { method: 'POST', headers: { 'Idempotency-Key': key('expense') }, body: JSON.stringify({ branchId, category: formValue(form, 'category'), amountToman: parseInputNumber(formValue(form, 'amountToman')), date: formValue(form, 'date'), paymentMethod: formValue(form, 'paymentMethod'), vendorName: formValue(form, 'vendorName'), reference: formValue(form, 'reference'), subject: formValue(form, 'subject') }) });
        }
      });
    });
  }

  async function open(tab, defaultView) {
    context.setActiveTab(tab);
    viewByTab[tab] = viewByTab[tab] || defaultView;
    root = context.main;
    root.innerHTML = '<div class="inv-loading">در حال دریافت اطلاعات واقعی انبار و مالی…</div>';
    bindEvents();
    await refresh(tab);
  }

  registry.register({
    id: 'inventory', title: 'انبار، بهای تمام‌شده و هزینه‌ها', version: '1.0.0', tabs,
    dependencies: ['core', 'finance'], stateKeys: ['financeV2', 'menuItems'],
    mount(ctx) { context = ctx; },
    createTabs(ctx) {
      context = ctx;
      return { inventory: () => open('inventory', 'materials'), costControl: () => open('costControl', 'costing'), expenses: () => open('expenses', 'expenses') };
    },
  });
})();
