/* WESTO Admin — unified inventory, recipes, costing and expenses workspace. */
(() => {
  'use strict';
  const registry = window.WestoAdminModules;
  if (!registry) return;

  const tabs = ['inventory', 'costControl', 'expenses'];
  const viewByTab = { inventory: 'materials', costControl: 'costing', expenses: 'expenses' };
  let context = null;
  let root = null;
  let data = { kitchen: {}, costing: {}, expenses: {}, purchases: {} };
  let loading = false;
  let bound = false;

  const list = (value) => Array.isArray(value) ? value : [];
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const fa = (value) => window.WestoPersianFormat?.number(value, { locale: 'fa-IR' }) ?? Number(value || 0).toLocaleString('fa-IR');
  const moneyIrr = (value) => context.fmtMoney(Math.round(Number(value || 0) / 10));
  const dateOnly = () => new Date().toISOString().slice(0, 10);
  const key = (prefix) => window.crypto?.randomUUID?.() || `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const bodyOf = (response) => response?.data ?? response ?? {};
  const items = () => list(data.costing.items).length ? list(data.costing.items) : list(data.kitchen.items);
  const recipes = () => {
    const all = [...list(data.costing.recipes), ...list(data.kitchen.recipeVersions), ...list(data.kitchen.productionRecipes)];
    const seen = new Set();
    return all.filter((recipe) => { const id = String(recipe.id || recipe.recipeId || ''); if (!id || seen.has(id)) return false; seen.add(id); return true; });
  };
  const menuItems = () => list(data.kitchen.menuItems).length ? list(data.kitchen.menuItems) : list(context.state?.menuItems);
  const itemById = (id) => items().find((item) => String(item.id) === String(id));
  const recipeLabel = (recipe) => recipe.name || recipe.menuItemName || menuItems().find((item) => String(item.id) === String(recipe.menuItemId))?.name || recipe.id;
  const statusLabel = (status) => ({ approved: 'تأییدشده', pending_approval: 'منتظر تأیید', draft: 'پیش‌نویس', rejected: 'ردشده', retired: 'بازنشسته', posted: 'قطعی', reversed: 'معکوس‌شده' }[status] || status || 'نامشخص');
  const statusClass = (status) => ['approved', 'posted', 'available'].includes(status) ? 'is-good' : ['rejected', 'reversed'].includes(status) ? 'is-danger' : 'is-warn';
  const unit = (item) => item?.unit || '—';

  async function loadData() {
    loading = true;
    const query = context.branchQs();
    const read = async (path) => bodyOf(await context.api(path));
    const [kitchen, costing, expenses, purchases] = await Promise.all([
      read(`/api/kitchen/inventory${query}`).catch(() => ({})),
      read(`/api/admin/v2/finance/costing-inventory${query}`).catch(() => ({})),
      read(`/api/admin/v2/finance/operating-expenses${query}`).catch(() => ({})),
      read(`/api/admin/v2/finance/purchases-payables${query}`).catch(() => ({})),
    ]);
    data = { kitchen, costing, expenses, purchases };
    loading = false;
  }

  function shell(tab) {
    const branch = context.currentBranch?.();
    const allItems = items();
    const low = allItems.filter((item) => item.minStock != null && Number(item.availableQuantity ?? item.qtyOnHand) <= Number(item.minStock)).length;
    const pendingRecipes = recipes().filter((recipe) => recipe.status === 'pending_approval').length;
    const pendingExpenses = list(data.expenses.expenses).filter((expense) => expense.status === 'pending_approval').length;
    return `<div class="inv-workspace" dir="rtl">
      <section class="inv-hero">
        <div><span class="inv-eyebrow">انبار و هزینهٔ یکپارچه</span><h1>مواد، رسپی و هزینه‌ها</h1><p>یک منبع واقعی برای موجودی مواد اولیه، بهای تمام‌شده، تولید و ثبت هزینه‌های مجموعه.</p></div>
        <div class="inv-hero-side"><span>شعبهٔ فعال</span><strong>${esc(branch?.name || 'شعبهٔ فعلی')}</strong><button type="button" class="inv-button inv-button--soft" data-inv-refresh>تازه‌سازی اطلاعات</button></div>
      </section>
      <section class="inv-metrics">
        <article><small>مواد اولیه</small><strong>${fa(allItems.length)}</strong><span>اقلام متصل به همین شعبه</span></article>
        <article class="${low ? 'is-warn' : ''}"><small>هشدار موجودی</small><strong>${fa(low)}</strong><span>${low ? 'نیازمند بررسی و تأمین' : 'کمبودی ثبت نشده است'}</span></article>
        <article><small>رسپی‌های منتظر تأیید</small><strong>${fa(pendingRecipes)}</strong><span>پس از تأیید روی فروش اثر می‌گذارد</span></article>
        <article class="${pendingExpenses ? 'is-warn' : ''}"><small>هزینه‌های در انتظار</small><strong>${fa(pendingExpenses)}</strong><span>در کارتابل تأیید مالی</span></article>
      </section>
      <nav class="inv-nav" aria-label="بخش‌های انبار و هزینه">
        ${[['materials', 'مواد اولیه'], ['recipes', 'رسپی محصولات'], ['operations', 'گردش انبار'], ['production', 'تولید'], ['counts', 'انبارگردانی'], ['waste', 'ضایعات'], ['costing', 'بهای تمام‌شده'], ['expenses', 'هزینه‌ها']].map(([id, label]) => `<button type="button" class="${viewByTab[tab] === id ? 'is-active' : ''}" data-inv-view="${id}">${label}</button>`).join('')}
      </nav>
      <div class="inv-body" id="inv-body"></div>
    </div>`;
  }

  function itemOptions({ includeEmpty = true } = {}) {
    return `${includeEmpty ? '<option value="">انتخاب ماده</option>' : ''}${items().map((item) => `<option value="${esc(item.id)}">${esc(item.name || item.id)} · ${esc(unit(item))}</option>`).join('')}`;
  }

  function materialView() {
    const canManage = context.hasCapability?.('inventory.manage');
    const rows = items().map((item) => {
      const available = Number(item.availableQuantity ?? item.qtyOnHand ?? 0);
      const min = Number(item.minStock || 0);
      const low = min > 0 && available <= min;
      const value = available * Number(item.avgCostIrr || item.unitCostIrr || 0);
      return `<tr><td><strong>${esc(item.name || item.id)}</strong><small>${esc(item.sku || 'بدون کد')} · ${esc(item.category || 'سایر')}</small></td><td>${fa(available)} <small>${esc(unit(item))}</small></td><td>${min ? fa(min) : '—'}</td><td>${value ? moneyIrr(value) : 'ثبت نشده'}</td><td><span class="inv-status ${low ? 'is-warn' : 'is-good'}">${low ? 'کمبود' : 'مناسب'}</span></td></tr>`;
    }).join('');
    return `<div class="inv-grid inv-grid--wide">
      ${canManage ? `<section class="inv-card"><div class="inv-card-head"><div><span class="inv-eyebrow">ثبت ماده</span><h2>مادهٔ اولیهٔ جدید</h2></div><span class="inv-help">موجودی اولیه فقط یک‌بار ثبت می‌شود؛ اصلاح‌های بعدی از انبارگردانی انجام می‌شود.</span></div>
        <form class="inv-form" data-inv-form="material"><label>نام ماده<input name="name" required placeholder="مثلاً شیر پرچرب" /></label><label>کد کالا<input name="sku" dir="ltr" placeholder="MILK-01" /></label><label>دسته<input name="category" placeholder="لبنیات" /></label><label>واحد پایه<select name="unit" required><option value="کیلوگرم">کیلوگرم</option><option value="لیتر">لیتر</option><option value="عدد">عدد</option><option value="گرم">گرم</option><option value="بسته">بسته</option><option value="بطری">بطری</option></select></label><label>موجودی اولیه<input name="qtyOnHand" type="number" min="0" step="0.001" value="0" /></label><label>بهای واحد (تومان)<input name="avgCostToman" type="number" min="0" step="1" value="0" /></label><label>حداقل موجودی<input name="minStock" type="number" min="0" step="0.001" value="0" /></label><button class="inv-button inv-button--primary" type="submit">افزودن به انبار</button></form></section>` : ''}
      <section class="inv-card"><div class="inv-card-head"><div><span class="inv-eyebrow">منبع موجودی</span><h2>مواد اولیهٔ شعبه</h2><p>موجودی قابل‌مصرف با گردش‌های واقعی فروش، دریافت، ضایعات و شمارش محاسبه می‌شود.</p></div><a class="inv-link" href="${context.financeWorkspaceHref('purchases')}">خرید و دریافت کالا ←</a></div><div class="inv-table-wrap"><table class="inv-table"><thead><tr><th>ماده</th><th>قابل‌مصرف</th><th>حداقل</th><th>ارزش تقریبی</th><th>وضعیت</th></tr></thead><tbody>${rows || '<tr><td colspan="5" class="inv-empty">هنوز ماده‌ای برای این شعبه ثبت نشده است.</td></tr>'}</tbody></table></div></section>
    </div>`;
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
    return `${includeEmpty ? '<option value="">انتخاب ماده اولیه</option>' : ''}${items().map((item) => {
      const isSel = String(item.id) === String(selectedId);
      return `<option value="${esc(item.id)}"${isSel ? ' selected' : ''} data-unit="${esc(unit(item))}">${esc(item.name || item.id)} (${esc(unit(item))})</option>`;
    }).join('')}`;
  }

  function recipeIngredientLineHtml(ingredient = {}) {
    const selectedItemId = ingredient.itemId || '';
    const selectedUnit = ingredient.unit || (selectedItemId ? itemById(selectedItemId)?.unit : 'کیلوگرم');
    const qty = ingredient.quantity ?? ingredient.qty ?? '';
    return `<div class="inv-recipe-line">
      <select name="itemId" data-recipe-item required>${itemOptions({ includeEmpty: true, selectedId: selectedItemId })}</select>
      <input name="quantity" type="number" min="0.0001" step="any" placeholder="مقدار مصرف" value="${qty}" required />
      <select name="unit" data-recipe-unit required>${unitSelectOptions(selectedUnit)}</select>
      <button type="button" class="inv-icon-button" data-inv-remove-line aria-label="حذف ماده">×</button>
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
      return `<tr>
        <td>
          <strong>${esc(recipeLabel(recipe))}</strong>
          <small>${esc(recipe.menuItemId || 'بدون محصول منو')} · ${recipe.version ? `نسخه ${fa(recipe.version)}` : 'نسخه ۱'}</small>
        </td>
        <td>${fa(list(recipe.ingredients).length)} قلم ماده</td>
        <td>${fa(recipe.yieldQuantity || recipe.servings || 1)} پرس</td>
        <td><span class="inv-status ${statusClass(recipe.status)}">${statusLabel(recipe.status)}</span></td>
        <td>${recipe.effectiveFrom ? esc(String(recipe.effectiveFrom).slice(0, 10)) : '—'}</td>
        ${canOperate ? `<td><button type="button" class="inv-button inv-button--soft inv-button--sm" data-edit-recipe="${esc(recipe.id || recipe.menuItemId)}">ویرایش رسپی</button></td>` : ''}
      </tr>`;
    }).join('');

    return `<div class="inv-grid inv-grid--wide">
      <section class="inv-card inv-card--notice">
        <span class="inv-notice-icon">✓</span>
        <div>
          <strong>اتصال مستقیم محصولات منو به مواد اولیه و انبار</strong>
          <p>هر محصول دارای رسپی اختصاصی با واحدهای استاندارد است. با انتخاب هر غذا، رسپی قبلی بارگذاری شده و قابل ویرایش درجا می‌باشد.</p>
        </div>
      </section>
      ${canOperate ? `
      <section class="inv-card" id="recipe-editor-section">
        <div class="inv-card-head">
          <div>
            <span class="inv-eyebrow" id="recipe-form-eyebrow">مدیریت رسپی</span>
            <h2 id="recipe-form-title">ثبت یا ویرایش رسپی محصول</h2>
          </div>
          <button type="button" class="inv-button inv-button--soft inv-button--sm" id="reset-recipe-form" style="display:none;">رسپی جدید</button>
        </div>
        <form class="inv-form inv-form--recipe" data-inv-form="recipe">
          <input type="hidden" name="recipeId" id="input-recipe-id" value="" />
          <label>محصول منو
            <select name="menuItemId" id="select-menu-item" required>
              <option value="">انتخاب محصول جهت مشاهده و ویرایش رسپی</option>
              ${menuItems().map((item) => {
                const hasRcp = allRecipes.some(r => String(r.menuItemId) === String(item.id));
                return `<option value="${esc(item.id)}">${esc(item.name || item.title || item.id)} ${hasRcp ? '✓ (دارای رسپی)' : ''}</option>`;
              }).join('')}
            </select>
          </label>
          <label>نام رسپی
            <input name="recipeName" id="input-recipe-name" placeholder="اختیاری؛ نام محصول استفاده می‌شود" />
          </label>
          <label>تعداد پرس / بازده
            <input name="yieldQuantity" id="input-yield-qty" type="number" min="0.001" step="any" value="1" required />
          </label>
          <label>شروع اثر
            <input name="effectiveFrom" id="input-effective-from" type="date" value="${dateOnly()}" required />
          </label>
          <label>محصول تولیدی بچ (اختیاری)
            <select name="outputItemId" id="select-output-item">
              <option value="">بدون تولید بچ</option>
              ${itemOptions({ includeEmpty: false })}
            </select>
          </label>
          <div class="inv-form-full">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
              <span class="inv-label">مواد تشکیل‌دهنده (انتخاب ماده، مقدار و واحد از لیست کشویی)</span>
            </div>
            ${recipeIngredientRows()}
          </div>
          <button class="inv-button inv-button--primary" id="btn-save-recipe" type="submit">ذخیره و به‌روزرسانی رسپی</button>
        </form>
      </section>` : ''}
      <section class="inv-card">
        <div class="inv-card-head">
          <div>
            <span class="inv-eyebrow">فهرست رسپی‌ها</span>
            <h2>رسپی‌های متصل به محصولات</h2>
          </div>
          <a class="inv-link" href="${context.financeWorkspaceHref('costing')}">گزارش بهای تمام‌شده ←</a>
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
            <tbody>${rows || '<tr><td colspan="6" class="inv-empty">رسپی ثبت‌شده‌ای وجود ندارد.</td></tr>'}</tbody>
          </table>
        </div>
      </section>
    </div>`;
  }

  function operationCards() {
    const operations = list(data.kitchen.recentOperations || data.kitchen.operations);
    return `<div class="inv-action-grid"><button type="button" data-inv-view="waste"><b>ثبت ضایعات</b><span>کاهش کنترل‌شدهٔ مواد با علت مشخص</span></button><button type="button" data-inv-view="counts"><b>انبارگردانی</b><span>مقایسهٔ شمارش فیزیکی با دفتر موجودی</span></button><button type="button" data-inv-view="production"><b>ثبت تولید</b><span>مصرف مواد و تولید محصول آماده</span></button><a href="${context.financeWorkspaceHref('purchases')}"><b>خرید و دریافت</b><span>سفارش خرید، رسید کالا و پرداختنی</span></a></div><section class="inv-card"><div class="inv-card-head"><div><span class="inv-eyebrow">ردپای ثبت‌شده</span><h2>آخرین گردش‌های انبار</h2></div></div><div class="inv-activity-list">${operations.slice(0, 20).map((row) => `<article><span class="inv-activity-dot"></span><div><strong>${esc(row.kindLabel || row.movementType || row.type || 'عملیات انبار')}</strong><small>${esc(row.itemName || row.itemId || '')} · ${row.occurredAt ? context.fmtDateTime(row.occurredAt) : 'زمان ثبت نشده'}</small></div><em>${row.quantityBase != null ? fa(row.quantityBase) : ''}</em></article>`).join('') || '<p class="inv-empty">هنوز گردش جدیدی برای این شعبه ثبت نشده است.</p>'}</div></section>`;
  }

  function movementForm(kind) {
    const isWaste = kind === 'waste';
    return `<section class="inv-card inv-card--form"><div class="inv-card-head"><div><span class="inv-eyebrow">${isWaste ? 'ضایعات' : 'انبارگردانی'}</span><h2>${isWaste ? 'ثبت ضایعات مواد' : 'ثبت شمارش فیزیکی'}</h2><p>${isWaste ? 'ثبت باعث ایجاد گردش مالی و کاهش موجودی قابل‌مصرف می‌شود.' : 'عدد شمارش‌شده با ماندهٔ واقعی مقایسه و اختلاف در دفتر ثبت می‌شود.'}</p></div></div><form class="inv-form" data-inv-form="${kind}"><label>ماده<select name="itemId" required>${itemOptions()}</select></label><label>${isWaste ? 'مقدار ضایعات' : 'مقدار شمارش‌شده'}<input name="quantity" type="number" min="0" step="any" required /></label><label>واحد<select name="unit" required>${unitSelectOptions('کیلوگرم')}</select></label><label class="inv-form-full">${isWaste ? 'علت ضایعات' : 'توضیح شمارش'}<textarea name="reason" required placeholder="توضیح کوتاه و قابل پیگیری"></textarea></label><button class="inv-button inv-button--primary" type="submit">ثبت ${isWaste ? 'ضایعات' : 'شمارش'}</button></form></section>`;
  }

  function productionView() {
    const productionRecipes = recipes().filter((recipe) => recipe.status === 'approved' && recipe.outputItemId);
    return `<section class="inv-card inv-card--form"><div class="inv-card-head"><div><span class="inv-eyebrow">تولید بچ</span><h2>ثبت تولید محصول آماده</h2><p>مواد رسپی کم می‌شود و محصول تولیدشده به موجودی اضافه می‌شود؛ همه‌چیز با یک رویداد قابل پیگیری ثبت می‌شود.</p></div></div>${productionRecipes.length ? `<form class="inv-form" data-inv-form="production"><label>رسپی تأییدشده<select name="recipeId" required><option value="">انتخاب رسپی</option>${productionRecipes.map((recipe) => `<option value="${esc(recipe.id)}">${esc(recipeLabel(recipe))} · خروجی: ${esc(itemById(recipe.outputItemId)?.name || recipe.outputItemId)}</option>`).join('')}</select></label><label>بازده برنامه‌ریزی‌شده<input name="plannedYield" type="number" min="0.001" step="any" required /></label><label>بازده واقعی<input name="actualYield" type="number" min="0" step="any" required /></label><button class="inv-button inv-button--primary" type="submit">ثبت تولید</button></form>` : '<div class="inv-empty">برای ثبت تولید، ابتدا یک رسپی تأییدشده با «محصول تولیدی» تعریف کنید.</div>'}</section>`;
  }

  function costingView() {
    const summary = data.costing.summary || {};
    const theoretical = data.costing.theoreticalCogs?.amountIrr;
    const actual = data.costing.actualConsumption?.amountIrr;
    const profitability = list(data.costing.itemProfitability);
    const coverage = list(data.costing.recipeCoverageQueue);
    return `<div class="inv-grid inv-grid--wide"><section class="inv-card inv-card--notice"><span class="inv-notice-icon">∑</span><div><strong>بهای تمام‌شده از فروش و گردش انبار ساخته می‌شود</strong><p>مبلغ نظری از snapshot رسپیِ فروش و مبلغ واقعی از گردش‌های ثبت‌شدهٔ مواد می‌آید. عددی که دادهٔ کافی ندارد به‌عنوان قطعی نمایش داده نمی‌شود.</p></div></section><section class="inv-cost-cards"><article><small>بهای نظری فروش</small><strong>${theoretical == null ? 'داده کافی نیست' : moneyIrr(theoretical)}</strong><span>${fa(summary.costSnapshots || 0)} snapshot فروش</span></article><article><small>مصرف واقعی</small><strong>${actual == null ? 'داده کافی نیست' : moneyIrr(actual)}</strong><span>${fa(summary.shadowMovements || 0)} گردش جدید</span></article><article><small>پوشش رسپی</small><strong>${fa(summary.recipes || 0)}</strong><span>رسپی‌های فعال شعبه</span></article></section><section class="inv-card"><div class="inv-card-head"><div><span class="inv-eyebrow">محصولات فروخته‌شده</span><h2>حاشیهٔ مشارکت</h2></div></div><div class="inv-table-wrap"><table class="inv-table"><thead><tr><th>محصول</th><th>تعداد</th><th>فروش</th><th>بهای نظری</th><th>حاشیه</th></tr></thead><tbody>${profitability.slice(0, 30).map((row) => `<tr><td>${esc(row.name || row.menuItemId)}</td><td>${fa(row.quantity)}</td><td>${moneyIrr(row.netSalesIrr)}</td><td>${moneyIrr(row.theoreticalCogsIrr)}</td><td><span class="inv-status ${Number(row.contributionMarginPercent) >= 40 ? 'is-good' : 'is-warn'}">${row.contributionMarginPercent == null ? 'نامشخص' : `${fa(row.contributionMarginPercent)}٪`}</span></td></tr>`).join('') || '<tr><td colspan="5" class="inv-empty">هنوز snapshot بهای فروش ثبت نشده است.</td></tr>'}</tbody></table></div></section><section class="inv-card"><div class="inv-card-head"><div><span class="inv-eyebrow">اقدام پیشنهادی</span><h2>محصولات بدون پوشش رسپی</h2></div></div><div class="inv-coverage-list">${coverage.slice(0, 20).map((row) => `<article><strong>${esc(row.menuItemName || row.menuItemId || 'محصول نامشخص')}</strong><span>${fa(row.affectedSaleLines || 0)} خط فروش · ${esc(row.issueCounts ? Object.keys(row.issueCounts).join('، ') : 'نیازمند بررسی')}</span></article>`).join('') || '<p class="inv-empty">صف پوشش رسپی خالی است.</p>'}</div></section></div>`;
  }

  function expensesView() {
    const canCreate = context.hasCapability?.('finance.journal.create');
    const categories = list(data.expenses.categories);
    const expenses = list(data.expenses.expenses);
    const rows = expenses.slice(0, 40).map((expense) => `<tr><td><strong>${esc(expense.subject || expense.description)}</strong><small>${esc(expense.vendorName || 'بدون طرف حساب')} · ${esc(String(expense.date || '').slice(0, 10))}</small></td><td>${esc(categories.find((item) => item.id === expense.category)?.label || expense.category || 'سایر')}</td><td>${moneyIrr(expense.amountIrr)}</td><td><span class="inv-status ${statusClass(expense.status)}">${statusLabel(expense.status)}</span></td></tr>`).join('');
    return `<div class="inv-grid inv-grid--wide">${canCreate ? `<section class="inv-card"><div class="inv-card-head"><div><span class="inv-eyebrow">ثبت در دفتر مالی</span><h2>هزینهٔ جدید</h2><p>هزینه به‌صورت سند دوبل ثبت و برای تأیید مدیر مالی ارسال می‌شود.</p></div></div><form class="inv-form" data-inv-form="expense"><label>دسته هزینه<select name="category" required>${categories.map((item) => `<option value="${esc(item.id)}">${esc(item.label)}</option>`).join('')}</select></label><label>مبلغ (تومان)<input name="amountToman" type="number" min="1" step="1" required /></label><label>تاریخ<input name="date" type="date" value="${dateOnly()}" required /></label><label>روش پرداخت<select name="paymentMethod"><option value="cash">نقدی</option><option value="petty_cash">تنخواه</option><option value="bank">بانکی</option><option value="credit">اعتباری / پرداختنی</option></select></label><label>طرف حساب (اختیاری)<input name="vendorName" placeholder="نام فروشنده یا طرف قرارداد" /></label><label>مرجع (اختیاری)<input name="reference" placeholder="شماره رسید یا فاکتور" /></label><label class="inv-form-full">شرح هزینه<textarea name="subject" required placeholder="برای چه کاری هزینه شد؟"></textarea></label><button class="inv-button inv-button--primary" type="submit">ثبت و ارسال برای تأیید</button></form></section>` : ''}<section class="inv-card"><div class="inv-card-head"><div><span class="inv-eyebrow">کارتابل هزینه</span><h2>هزینه‌های ثبت‌شده</h2></div><a class="inv-link" href="${context.financeWorkspaceHref('workbench')}">کارتابل تأیید مالی ←</a></div><div class="inv-table-wrap"><table class="inv-table"><thead><tr><th>شرح</th><th>دسته</th><th>مبلغ</th><th>وضعیت</th></tr></thead><tbody>${rows || '<tr><td colspan="4" class="inv-empty">هنوز هزینه‌ای در ماژول جدید ثبت نشده است.</td></tr>'}</tbody></table></div></section></div>`;
  }

  function body(tab) {
    const view = viewByTab[tab];
    if (loading) return '<div class="inv-loading">در حال دریافت اطلاعات واقعی انبار و مالی…</div>';
    if (view === 'materials') return materialView();
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
    root.innerHTML = shell(tab);
    root.querySelector('#inv-body').innerHTML = body(tab);
  }

  async function refresh(tab) {
    if (!root) return;
    try { await loadData(); render(tab); } catch (error) { root.innerHTML = `<div class="inv-error">${esc(error.message || 'اطلاعات انبار دریافت نشد.')}</div>`; }
  }

  async function mutate(button, action) {
    if (button) { button.disabled = true; button.dataset.busy = '1'; }
    try { await action(); context.showToast('ثبت با موفقیت انجام شد.', 'success'); await refresh(context.activeTab?.() || 'inventory'); }
    catch (error) { context.showToast(error.message || 'ثبت اطلاعات انجام نشد.', 'error', 4200); }
    finally { if (button) { button.disabled = false; delete button.dataset.busy; } }
  }

  function formValue(form, name) { return form.elements[name]?.value ?? ''; }
  function recipePayload(form) {
    const ingredients = [...form.querySelectorAll('.inv-recipe-line')].map((line) => ({
      itemId: formValue(line, 'itemId'),
      quantity: Number(formValue(line, 'quantity')),
      unit: formValue(line, 'unit') || itemById(formValue(line, 'itemId'))?.unit || 'کیلوگرم',
      quantityBasis: 'raw',
      yieldPercent: 100,
    })).filter((line) => line.itemId && line.quantity > 0);

    return {
      branchId: context.currentBranch?.()?.id,
      recipeId: formValue(form, 'recipeId') || null,
      menuItemId: formValue(form, 'menuItemId'),
      name: formValue(form, 'recipeName'),
      effectiveFrom: formValue(form, 'effectiveFrom'),
      yieldQuantity: Number(formValue(form, 'yieldQuantity') || 1),
      outputItemId: formValue(form, 'outputItemId') || null,
      ingredients,
    };
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

      const ingHtml = list(recipe.ingredients).map(recipeIngredientLineHtml).join('');
      if (linesWrap) linesWrap.innerHTML = ingHtml || recipeIngredientLineHtml();

      if (titleEl) titleEl.textContent = `ویرایش رسپی «${recipeLabel(recipe)}»`;
      if (eyebrowEl) eyebrowEl.textContent = 'ویرایش رسپی موجود';
      if (resetBtn) resetBtn.style.display = 'inline-block';
      if (saveBtn) saveBtn.textContent = 'ذخیره تغییرات رسپی';
    } else {
      if (recipeIdInput) recipeIdInput.value = '';
      if (nameInput) nameInput.value = '';
      if (yieldInput) yieldInput.value = '1';
      if (effectiveInput) effectiveInput.value = dateOnly();
      if (outputSelect) outputSelect.value = '';
      if (linesWrap) linesWrap.innerHTML = recipeIngredientLineHtml();

      if (titleEl) titleEl.textContent = 'ثبت یا ویرایش رسپی محصول';
      if (eyebrowEl) eyebrowEl.textContent = 'مدیریت رسپی';
      if (resetBtn) resetBtn.style.display = 'none';
      if (saveBtn) saveBtn.textContent = 'ذخیره و به‌روزرسانی رسپی';
    }
  }

  function bindEvents() {
    if (bound || !root) return;
    bound = true;
    root.addEventListener('click', (event) => {
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
        }
        return;
      }
      const editBtn = event.target.closest('[data-edit-recipe]');
      if (editBtn) {
        const key = editBtn.dataset.editRecipe;
        const allRecipes = recipes();
        const found = allRecipes.find((r) => String(r.id) === String(key) || String(r.menuItemId) === String(key));
        if (found) {
          populateRecipeForm(found);
          root.querySelector('#recipe-editor-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
        const lines = root.querySelectorAll('.inv-recipe-line');
        if (lines.length > 1) remove.closest('.inv-recipe-line').remove();
      }
    });

    root.addEventListener('change', (event) => {
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
          await context.api('/api/admin/v2/finance/inventory-items', { method: 'POST', headers: { 'Idempotency-Key': key('inventory') }, body: JSON.stringify({ branchId, name: formValue(form, 'name'), sku: formValue(form, 'sku'), category: formValue(form, 'category'), unit: formValue(form, 'unit'), qtyOnHand: Number(formValue(form, 'qtyOnHand')), minStock: Number(formValue(form, 'minStock')), avgCostIrr: Math.round(Number(formValue(form, 'avgCostToman')) * 10) }) });
        } else if (kind === 'recipe') {
          const payload = recipePayload(form);
          if (!payload.ingredients.length) throw new Error('حداقل یک ماده برای رسپی انتخاب کنید.');
          await context.api('/api/kitchen/inventory/recipe-versions', { method: 'POST', headers: { 'Idempotency-Key': key('recipe') }, body: JSON.stringify(payload) });
          // Also sync to legacy/admin recipes endpoint if available
          try {
            await context.api('/api/admin/finance/recipes', { method: 'POST', body: JSON.stringify(payload) });
          } catch (_) {}
        } else if (kind === 'waste' || kind === 'counts') {
          const payload = { branchId, itemId: formValue(form, 'itemId'), unit: formValue(form, 'unit'), reason: formValue(form, 'reason') };
          if (kind === 'waste') payload.quantity = Number(formValue(form, 'quantity'));
          else payload.countedQuantity = Number(formValue(form, 'quantity'));
          await context.api(`/api/kitchen/inventory/${kind === 'waste' ? 'waste' : 'stock-counts'}`, { method: 'POST', headers: { 'Idempotency-Key': key(kind) }, body: JSON.stringify(payload) });
        } else if (kind === 'production') {
          await context.api('/api/kitchen/inventory/production-batches', { method: 'POST', headers: { 'Idempotency-Key': key('production') }, body: JSON.stringify({ branchId, recipeId: formValue(form, 'recipeId'), plannedYield: Number(formValue(form, 'plannedYield')), actualYield: Number(formValue(form, 'actualYield')) }) });
        } else if (kind === 'expense') {
          await context.api('/api/admin/v2/finance/operating-expenses', { method: 'POST', headers: { 'Idempotency-Key': key('expense') }, body: JSON.stringify({ branchId, category: formValue(form, 'category'), amountToman: Number(formValue(form, 'amountToman')), date: formValue(form, 'date'), paymentMethod: formValue(form, 'paymentMethod'), vendorName: formValue(form, 'vendorName'), reference: formValue(form, 'reference'), subject: formValue(form, 'subject') }) });
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
