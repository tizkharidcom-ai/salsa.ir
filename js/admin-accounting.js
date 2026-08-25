/**
 * WESTO Finance V2 — accountant-first workspace.
 * Five durable destinations, source-labelled KPIs, explicit empty/error states.
 */
(() => {
  'use strict';

  const WORKSPACES = [
    { id: 'workbench', label: 'کارتابل حسابدار', icon: '✓', endpoint: 'workbench' },
    { id: 'sales_bank', label: 'فروش، صندوق و بانک', icon: '﷼', endpoint: 'sales-cash-bank' },
    { id: 'purchases', label: 'خرید، هزینه و پرداختنی', icon: '↗', endpoint: 'purchases-payables' },
    { id: 'costing', label: 'بهای تمام‌شده و انبار', icon: '∑', endpoint: 'costing-inventory' },
    { id: 'ledger_close', label: 'دفاتر، گزارش‌ها و پایان دوره', icon: '≡', endpoint: 'ledger-close' },
  ];
  const state = { workspace: 'workbench', operation: 'journal', query: {}, payload: null, meta: null, loading: false, pages: {}, request: null };
  let root = null;

  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const fa = (value) => Number(value || 0).toLocaleString('fa-IR');
  const money = (amountIrr) => amountIrr == null ? 'داده کافی نیست' : `${fa(Math.round(Number(amountIrr || 0) / 10))} تومان`;
  const dateTime = (value) => {
    if (!value) return 'ثبت نشده';
    const parsed = new Date(value);
    if (!Number.isFinite(parsed.getTime())) return esc(value);
    return window.ShamsiCore
      ? window.ShamsiCore.formatShamsiDateTime(parsed)
      : parsed.toLocaleString('fa-IR-u-ca-persian');
  };
  const dateOnly = (value) => {
    if (!value) return 'ثبت نشده';
    return window.ShamsiCore
      ? window.ShamsiCore.formatShamsiDate(String(value).slice(0, 10))
      : new Date(`${String(value).slice(0, 10)}T12:00:00`).toLocaleDateString('fa-IR-u-ca-persian');
  };
  const localIsoDate = () => {
    const value = new Date();
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(value).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
  };
  const label = (value) => ({
    cash: 'نقد', card: 'کارتخوان', manual_card: 'کارتخوان دستی', card_on_file: 'کارت ذخیره‌شده',
    online: 'آنلاین', gateway: 'درگاه', gift_card: 'کارت هدیه', credit: 'اعتباری', unknown: 'نامشخص',
    posted: 'قطعی', blocked: 'مسدود', pending: 'منتظر پردازش', unregistered: 'ثبت‌نشده',
    paid: 'پرداخت‌شده', partial: 'ناقص', approved: 'تأییدشده', rejected: 'ردشده',
    succeeded: 'انجام‌شده', refunded: 'کاملاً برگشت‌خورده', cancelled: 'لغوشده',
    draft: 'پیش‌نویس', pending_approval: 'منتظر تأیید', open: 'باز', reopened: 'بازگشایی‌شده', soft_closed: 'بستهٔ مقدماتی', closed: 'بسته',
    received: 'کامل دریافت‌شده', partially_received: 'دریافت ناقص', partially_paid: 'بخشی پرداخت‌شده', match_exception: 'اختلاف تطبیق', matched: 'تطبیق‌شده', unmatched: 'تطبیق‌نشده', exception: 'دارای اختلاف',
    active: 'فعال', inactive: 'غیرفعال', reversed: 'معکوس‌شده',
    verified: 'تأییدشده از منبع عملیاتی', inferred_needs_approval: 'قابل استنتاج؛ نیازمند تأیید', quarantined: 'قرنطینه‌شده',
    approved_for_backfill: 'مجاز برای بازسازی کنترل‌شده', keep_quarantined: 'در قرنطینه بماند', not_financial: 'غیرمالی', not_requested: 'درخواست نشده',
    inflow: 'واریز به بانک', outflow: 'برداشت از بانک',
    journal_entry: 'سند حسابداری', finance_event: 'رویداد مالی', fiscal_period: 'دورهٔ مالی', purchase_order: 'سفارش خرید', supplier_payment: 'پرداخت تأمین‌کننده',
    finance_refund: 'برگشت وجه مشتری', approve_purchase_order: 'تأیید سفارش خرید', approve_supplier_payment: 'تأیید پرداخت تأمین‌کننده', approve_customer_refund: 'تأیید برگشت وجه مشتری',
    cost_payment: 'پرداخت هزینهٔ دوره‌ای', approve_cost_accrual: 'تأیید ثبت دوره‌ای هزینه', approve_cost_payment: 'تأیید پرداخت هزینهٔ دوره‌ای',
    approve_asset_acquisition: 'تأیید خرید دارایی ثابت', approve_asset_depreciation: 'تأیید استهلاک ماهانه',
    payroll_payment: 'پرداخت بدهی حقوق', approve_payroll_run: 'تأیید لیست حقوق', approve_payroll_payment: 'تأیید پرداخت بدهی حقوق',
    post_legacy_order_backfill: 'پست بازسازی سفارش تاریخی', legacy_backfill: 'بازسازی تاریخی',
    opening_balance: 'مانده افتتاحیه', post_opening_balance: 'تأیید و پست مانده افتتاحیه',
    net_salary: 'خالص حقوق کارکنان', social_security: 'بیمه پرداختنی', payroll_tax: 'مالیات حقوق', other_deductions: 'سایر کسورات',
    available: 'قابل محاسبه', insufficient_data: 'داده ناکافی', partial_coverage: 'پوشش ناقص', critical: 'فوری', warning: 'هشدار', normal: 'عادی',
    balanced: 'تراز', unbalanced: 'نامتوازن', rule_based: 'قاعده‌محور', snapshot_backed: 'مبتنی بر snapshot', movement_backed: 'مبتنی بر گردش', partial_valuation: 'ارزش‌گذاری ناقص',
    net_sales: 'فروش خالص قطعی', variable_cost: 'هزینه متغیر قطعی', fixed_cost: 'هزینه ثابت قطعی', fixed_cost_commitments: 'تعهد ثابت فعال',
  }[value] || value || 'نامشخص');
  const severity = (value) => value === 'critical' ? 'danger' : value === 'warning' ? 'warning' : 'neutral';

  function readLocationQuery(extra = '') {
    const params = new URLSearchParams(location.search);
    const supplied = new URLSearchParams(String(extra || '').replace(/^\?/, ''));
    supplied.forEach((value, key) => { if (!params.has(key)) params.set(key, value); });
    state.workspace = WORKSPACES.some((item) => item.id === params.get('financeWorkspace')) ? params.get('financeWorkspace') : 'workbench';
    state.operation = ['journal', 'events', 'approvals', 'periods'].includes(params.get('financeOperation')) ? params.get('financeOperation') : 'journal';
    state.query = {
      branchId: params.get('branchId') || supplied.get('branchId') || '',
      from: params.get('financeFrom') || '',
      to: params.get('financeTo') || '',
      page: 1,
    };
  }

  function persistQuery() {
    const params = new URLSearchParams(location.search);
    params.set('financeWorkspace', state.workspace);
    state.workspace === 'workbench' ? params.set('financeOperation', state.operation) : params.delete('financeOperation');
    state.query.from ? params.set('financeFrom', state.query.from) : params.delete('financeFrom');
    state.query.to ? params.set('financeTo', state.query.to) : params.delete('financeTo');
    if (state.query.branchId) params.set('branchId', state.query.branchId);
    history.replaceState(null, '', `${location.pathname}?${params.toString()}${location.hash}`);
  }

  function requestQuery() {
    const params = new URLSearchParams();
    if (state.query.branchId) params.set('branchId', state.query.branchId);
    if (state.query.from) params.set('from', `${state.query.from}T00:00:00`);
    if (state.query.to) params.set('to', `${state.query.to}T23:59:59.999`);
    if (state.query.page > 1) params.set('page', String(state.query.page));
    params.set('pageSize', '25');
    return params.toString();
  }

  async function api(path, options = {}) {
    const response = await fetch(path, {
      ...options,
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...(options.headers || {}) },
    });
    const body = await response.json().catch(() => null);
    if (!response.ok || !body || body.error) {
      const message = body?.error?.message || body?.error || `پاسخ نامعتبر سرور (${response.status})`;
      const error = new Error(message);
      error.code = body?.error?.code || `http_${response.status}`;
      throw error;
    }
    return body;
  }

  const idempotencyKey = () => window.crypto?.randomUUID?.() || `fin-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const asciiDigits = (value) => String(value ?? '')
    .replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
    .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
    .replace(/[٬,\s]/g, '');
  const asciiNumber = (value) => Number(asciiDigits(value));
  const toast = (message, tone = 'success') => {
    if (typeof window.showToast === 'function') window.showToast(message, tone === 'danger' ? 'error' : tone, 2400);
  };

  async function mutation(path, body, button) {
    if (button?.dataset.finBusy === '1') return null;
    if (button) { button.dataset.finBusy = '1'; button.disabled = true; button.setAttribute('aria-busy', 'true'); }
    try {
      return await api(path, {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey() },
        body: JSON.stringify(body || {}),
      });
    } finally {
      if (button) { delete button.dataset.finBusy; button.disabled = false; button.removeAttribute('aria-busy'); }
    }
  }

  function statusBadge(value, explicitTone) {
    const tone = explicitTone || (['posted', 'approved', 'paid', 'passed', 'succeeded', 'matched', 'refunded'].includes(value) ? 'success' : ['blocked', 'rejected', 'failed', 'NO_GO'].includes(value) ? 'danger' : 'warning');
    return `<span class="fin-badge ${tone}">${esc(label(value))}</span>`;
  }

  function metric(title, value, detail, tone = '') {
    return `<article class="fin-metric ${tone}"><span>${esc(title)}</span><strong>${value}</strong><small>${esc(detail)}</small></article>`;
  }

  function empty(message) {
    return `<div class="fin-empty"><strong>اطلاعاتی برای نمایش نیست</strong><span>${esc(message)}</span></div>`;
  }

  function table(id, columns, rows, emptyMessage = 'در محدودهٔ انتخاب‌شده رکوردی وجود ندارد.', serverPagination = null) {
    if (!rows?.length) return empty(emptyMessage);
    const pageSize = 25;
    const pages = serverPagination ? Math.max(1, Number(serverPagination.pages) || 1) : Math.max(1, Math.ceil(rows.length / pageSize));
    const current = serverPagination ? Math.max(1, Number(serverPagination.page) || 1) : Math.min(pages, Math.max(1, Number(state.pages[id]) || 1));
    const visible = serverPagination ? rows : rows.slice((current - 1) * pageSize, current * pageSize);
    const total = serverPagination ? Number(serverPagination.total || rows.length) : rows.length;
    const pageAttr = serverPagination ? 'data-fin-server-page' : 'data-fin-page';
    return `
      <div class="fin-table-wrap">
        <table class="fin-table"><thead><tr>${columns.map((column) => `<th>${esc(column.label)}</th>`).join('')}</tr></thead>
          <tbody>${visible.map((row) => `<tr>${columns.map((column) => `<td>${column.render ? column.render(row) : esc(row[column.key] ?? '—')}</td>`).join('')}</tr>`).join('')}</tbody>
        </table>
      </div>
      <div class="fin-pagination" aria-label="صفحه‌بندی جدول">
        <span>${fa(total)} رکورد · صفحه ${fa(current)} از ${fa(pages)}</span>
        <div><button type="button" ${pageAttr}="${esc(id)}" data-page="${current - 1}" ${current <= 1 ? 'disabled' : ''}>قبلی</button><button type="button" ${pageAttr}="${esc(id)}" data-page="${current + 1}" ${current >= pages ? 'disabled' : ''}>بعدی</button></div>
      </div>`;
  }

  function metadata() {
    if (!state.meta) return '';
    const period = [state.meta.from, state.meta.to].filter(Boolean).map((item) => window.ShamsiCore
      ? window.ShamsiCore.formatShamsiDate(item)
      : new Date(item).toLocaleDateString('fa-IR-u-ca-persian')).join(' تا ') || 'تمام تاریخچه';
    return `<div class="fin-meta"><span>به‌روزرسانی: ${dateTime(state.meta.calculatedAt || state.meta.generatedAt)}</span><span>دوره: ${esc(period)}</span><span>شعبه: ${esc(state.meta.branchId || 'همه')}</span><span>واحد ذخیره: ریال · نمایش: تومان</span><span>منبع: ${esc(state.meta.source)}</span></div>`;
  }

  function renderShell() {
    root.innerHTML = `
      <section class="finance-v2" aria-labelledby="fin-title">
        <header class="fin-header">
          <div><p class="fin-eyebrow">WESTO FINANCE V2 · دفتر سایه</p><h1 id="fin-title">مالی و حسابداری</h1><p>پیچیدگی مالی حفظ شده، اما کار روزانه حول استثناها، تطبیق و پایان دوره سازمان‌دهی شده است.</p></div>
          <div class="fin-header-status"><span class="fin-dot"></span>مرحلهٔ اجرا: Shadow · انتشار: NO-GO</div>
        </header>
        <div class="fin-toolbar">
          <label class="fin-search"><span>جست‌وجوی مالی</span><input id="fin-global-search" type="search" placeholder="سفارش، سند، تأمین‌کننده یا مبلغ" autocomplete="off"><div id="fin-search-results" class="fin-search-results" hidden></div></label>
          <label>از<input id="fin-from" type="date" value="${esc(state.query.from)}"></label>
          <label>تا<input id="fin-to" type="date" value="${esc(state.query.to)}"></label>
          <button class="fin-btn secondary" id="fin-apply-filter" type="button">اعمال فیلتر</button>
        </div>
        <nav class="fin-workspace-nav" aria-label="فضاهای کاری مالی">
          ${WORKSPACES.map((item) => `<button type="button" data-fin-workspace="${item.id}" class="${item.id === state.workspace ? 'active' : ''}"><b>${item.icon}</b><span>${item.label}</span></button>`).join('')}
        </nav>
        <div id="fin-metadata"></div>
        <main id="fin-workspace-content" tabindex="-1"></main>
      </section>`;
    bindShell();
  }

  function bindShell() {
    root.querySelectorAll('[data-fin-workspace]').forEach((button) => button.addEventListener('click', () => {
      state.workspace = button.dataset.finWorkspace;
      state.pages = {};
      state.query.page = 1;
      persistQuery();
      renderShell();
      loadWorkspace();
    }));
    root.querySelector('#fin-apply-filter').addEventListener('click', () => {
      const fromInput = root.querySelector('#fin-from');
      const toInput = root.querySelector('#fin-to');
      state.query.from = window.ShamsiDatePicker?.getISOValue(fromInput) || fromInput.dataset.isoDate || fromInput.value;
      state.query.to = window.ShamsiDatePicker?.getISOValue(toInput) || toInput.dataset.isoDate || toInput.value;
      if (state.query.from && state.query.to && state.query.from > state.query.to) {
        renderError({ code: 'date_range_invalid', message: 'تاریخ شروع نمی‌تواند بعد از تاریخ پایان باشد.' });
        return;
      }
      state.pages = {};
      state.query.page = 1;
      persistQuery();
      loadWorkspace();
    });
    const search = root.querySelector('#fin-global-search');
    let timer = null;
    search.addEventListener('input', () => {
      clearTimeout(timer);
      const term = search.value.trim();
      if (term.length < 2) return closeSearch();
      timer = setTimeout(() => runSearch(term), 280);
    });
    search.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeSearch(); });
  }

  async function runSearch(term) {
    const target = root.querySelector('#fin-search-results');
    target.hidden = false;
    target.innerHTML = '<span class="fin-search-wait">در حال جست‌وجو…</span>';
    try {
      const query = new URLSearchParams({ q: term });
      if (state.query.branchId) query.set('branchId', state.query.branchId);
      const result = await api(`/api/admin/v2/finance/search?${query}`);
      target.innerHTML = result.data.length ? result.data.map((item) => `<button type="button"><span>${esc(item.label)}</span><small>${esc(label(item.kind))} · ${money(item.amountIrr)}</small></button>`).join('') : '<span class="fin-search-wait">نتیجه‌ای پیدا نشد.</span>';
    } catch (error) {
      target.innerHTML = `<span class="fin-search-error">${esc(error.message)}</span>`;
    }
  }

  function closeSearch() {
    const target = root?.querySelector('#fin-search-results');
    if (target) { target.hidden = true; target.innerHTML = ''; }
  }

  async function loadWorkspace() {
    const content = root.querySelector('#fin-workspace-content');
    const meta = root.querySelector('#fin-metadata');
    const config = WORKSPACES.find((item) => item.id === state.workspace) || WORKSPACES[0];
    if (state.request) state.request.abort();
    state.request = new AbortController();
    content.innerHTML = '<div class="fin-loading"><span></span><strong>در حال دریافت دادهٔ تأییدشده…</strong></div>';
    meta.innerHTML = '';
    try {
      const query = requestQuery();
      const result = await api(`/api/admin/v2/finance/${config.endpoint}${query ? `?${query}` : ''}`, { signal: state.request.signal });
      state.payload = result.data;
      state.meta = result.meta;
      meta.innerHTML = metadata();
      renderWorkspace();
    } catch (error) {
      if (error.name !== 'AbortError') renderError(error);
    }
  }

  function renderError(error) {
    const content = root.querySelector('#fin-workspace-content');
    content.innerHTML = `<div class="fin-error" role="alert"><span>!</span><div><strong>دادهٔ مالی بارگذاری نشد</strong><p>${esc(error.message)}</p><small>کد خطا: ${esc(error.code || 'unknown')}</small></div><button type="button" id="fin-retry">تلاش دوباره</button></div>`;
    content.querySelector('#fin-retry')?.addEventListener('click', loadWorkspace);
  }

  function renderWorkspace() {
    const renderers = { workbench: renderWorkbench, sales_bank: renderSales, purchases: renderPurchases, costing: renderCosting, ledger_close: renderLedger };
    const content = root.querySelector('#fin-workspace-content');
    content.innerHTML = renderers[state.workspace]?.(state.payload) || empty('فضای کاری در دسترس نیست.');
    bindContent();
  }

  function bindContent() {
    root.querySelectorAll('[data-fin-goto]').forEach((button) => button.addEventListener('click', () => {
      state.workspace = button.dataset.finGoto;
      persistQuery(); renderShell(); loadWorkspace();
    }));
    root.querySelectorAll('[data-fin-page]').forEach((button) => button.addEventListener('click', () => {
      state.pages[button.dataset.finPage] = Number(button.dataset.page);
      renderWorkspace();
    }));
    root.querySelectorAll('[data-fin-server-page]').forEach((button) => button.addEventListener('click', () => {
      state.query.page = Number(button.dataset.page) || 1;
      loadWorkspace();
    }));
    root.querySelectorAll('[data-fin-export]').forEach((button) => button.addEventListener('click', () => exportCurrent(button.dataset.finExport)));
    root.querySelectorAll('[data-fin-operation]').forEach((button) => button.addEventListener('click', () => {
      state.operation = button.dataset.finOperation;
      persistQuery();
      renderWorkspace();
      root.querySelector('#fin-operations')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }));
    bindOperationActions();
    bindBreakEvenPreview();
  }

  function bindBreakEvenPreview() {
    root.querySelector('#fin-break-even-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const button = form.querySelector('button[type="submit"]');
      const values = Object.fromEntries(new FormData(form));
      const toman = (name) => asciiNumber(values[name]);
      const rent = toman('rentToman');
      const payroll = toman('payrollToman');
      const other = toman('otherFixedToman');
      const sales = toman('salesToman');
      const variable = toman('variableCostToman');
      const days = asciiNumber(values.remainingOpenDays);
      if ([rent, payroll, other, sales, variable].some((value) => !Number.isSafeInteger(value) || value < 0) || sales <= 0 || variable >= sales) {
        return operationError({ code: 'break_even_input_invalid', message: 'مبالغ باید صحیح و نامنفی باشند و هزینه متغیر از فروش کمتر باشد.' });
      }
      try {
        const result = await api('/api/admin/v2/finance/planning/break-even/preview', {
          method: 'POST',
          body: JSON.stringify({
            fixedCostsIrr: [rent * 10, payroll * 10, other * 10],
            sales: [{ revenueIrr: sales * 10, variableCostIrr: variable * 10 }],
            realizedNetSalesIrr: sales * 10,
            remainingOpenDays: Number.isSafeInteger(days) && days > 0 ? days : null,
          }),
        });
        const data = result.data;
        const target = root.querySelector('#fin-break-even-result');
        if (!target) return;
        target.innerHTML = data.status !== 'available' ? empty('برای محاسبه نقطه سربه‌سر، دادهٔ معتبر فروش و هزینه لازم است.') : `
          <div class="fin-result-grid">
            ${metric('فروش سربه‌سر', money(data.breakEvenSalesIrr), `حاشیه مشارکت ${fa(Math.round(data.contributionMarginRatio * 10000) / 100)}٪`)}
            ${metric('فاصله تا سربه‌سر', money(data.gapIrr), data.gapIrr ? 'هنوز پوشش داده نشده' : 'سربه‌سر پوشش داده شده', data.gapIrr ? 'danger' : 'success')}
            ${metric('فروش روزانه لازم', money(data.requiredDailySalesIrr), data.remainingOpenDays ? `${fa(data.remainingOpenDays)} روز کاری باقی‌مانده` : 'روزهای باقی‌مانده ثبت نشده')}
          </div>`;
      } catch (error) { operationError(error); }
      finally { if (button) button.disabled = false; }
    });
  }

  function operationError(error, targetSelector = '#fin-operation-feedback') {
    toast(error.message || 'عملیات مالی انجام نشد.', 'danger');
    const target = root.querySelector(targetSelector);
    if (target) target.innerHTML = `<div class="fin-note warning" role="alert"><strong>عملیات انجام نشد</strong><span>${esc(error.message)} · کد: ${esc(error.code || 'unknown')}</span></div>`;
  }

  async function refreshAfterMutation(message) {
    toast(message, 'success');
    await loadWorkspace();
  }

  function payrollFormPayload(form) {
    const values = Object.fromEntries(new FormData(form));
    const postingDate = window.ShamsiDatePicker?.getISOValue(form.elements.postingDate) || form.elements.postingDate.dataset.isoDate || values.postingDate;
    const headcount = asciiNumber(values.headcount);
    const amountNames = ['kitchenGrossToman', 'serviceGrossToman', 'employerInsuranceToman', 'employeeInsuranceToman', 'payrollTaxToman', 'otherDeductionsToman', 'netPayToman'];
    const amounts = Object.fromEntries(amountNames.map((name) => [name, asciiNumber(values[name] || 0)]));
    if (!Number.isSafeInteger(headcount) || headcount < 1 || headcount > 10000
      || Object.values(amounts).some((amount) => !Number.isSafeInteger(amount) || amount < 0 || amount > Number.MAX_SAFE_INTEGER / 10)
      || amounts.kitchenGrossToman + amounts.serviceGrossToman <= 0 || amounts.netPayToman <= 0) {
      throw Object.assign(new Error('تعداد کارکنان و مبالغ لیست حقوق باید عدد صحیح، نامنفی و معتبر باشند.'), { code: 'payroll_input_invalid' });
    }
    return {
      branchId: Number(state.query.branchId) || 1, postingDate, sourceReference: values.sourceReference,
      headcount, kitchenGrossIrr: amounts.kitchenGrossToman * 10, serviceGrossIrr: amounts.serviceGrossToman * 10,
      employerInsuranceIrr: amounts.employerInsuranceToman * 10, employeeInsuranceIrr: amounts.employeeInsuranceToman * 10,
      payrollTaxIrr: amounts.payrollTaxToman * 10, otherDeductionsIrr: amounts.otherDeductionsToman * 10,
      netPayIrr: amounts.netPayToman * 10,
    };
  }

  function openingBalanceFormPayload(form) {
    if (!form) throw Object.assign(new Error('فرم مانده افتتاحیه در دسترس نیست.'), { code: 'opening_balance_form_missing' });
    const values = Object.fromEntries(new FormData(form));
    const dateInput = form.elements.asOfDate;
    const asOfDate = window.ShamsiDatePicker?.getISOValue(dateInput) || dateInput?.dataset.isoDate || values.asOfDate;
    const sourceReference = String(values.sourceReference || '').trim();
    const rows = [...form.querySelectorAll('[data-fin-opening-row]')];
    if (rows.length < 2 || rows.length > 1000) throw Object.assign(new Error('حداقل دو ردیف برای مانده افتتاحیه لازم است.'), { code: 'opening_balance_lines_invalid' });
    const seen = new Set();
    const branchId = Number(state.query.branchId) || 1;
    const lines = rows.map((row, index) => {
      const accountCode = asciiDigits(row.querySelector('[name="openingAccount"]')?.value);
      const side = row.querySelector('[name="openingSide"]')?.value;
      const amountToman = asciiNumber(row.querySelector('[name="openingAmountToman"]')?.value);
      const memo = row.querySelector('[name="openingMemo"]')?.value?.trim() || '';
      if (!accountCode || seen.has(accountCode)) throw Object.assign(new Error(`حساب ردیف ${fa(index + 1)} خالی یا تکراری است.`), { code: 'opening_balance_account_duplicate' });
      if (!Number.isSafeInteger(amountToman) || amountToman <= 0 || amountToman > Number.MAX_SAFE_INTEGER / 10) {
        throw Object.assign(new Error(`مبلغ ردیف ${fa(index + 1)} باید تومان صحیح و بزرگ‌تر از صفر باشد.`), { code: 'opening_balance_amount_invalid' });
      }
      seen.add(accountCode);
      const amountIrr = amountToman * 10;
      return {
        accountCode, debitIrr: side === 'debit' ? amountIrr : 0, creditIrr: side === 'credit' ? amountIrr : 0,
        branchId, costCenter: `branch:${branchId}`, memo,
      };
    });
    const debitIrr = lines.reduce((sum, line) => sum + line.debitIrr, 0);
    const creditIrr = lines.reduce((sum, line) => sum + line.creditIrr, 0);
    if (debitIrr !== creditIrr) throw Object.assign(new Error(`سند متوازن نیست؛ اختلاف ${money(Math.abs(debitIrr - creditIrr))} است.`), { code: 'journal_unbalanced' });
    return { branchId, asOfDate, sourceReference, lines };
  }

  function bindOperationActions() {
    root.querySelector('#fin-settlement-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const formData = new FormData(form);
      const values = Object.fromEntries(formData);
      const paymentIds = formData.getAll('paymentIds').map(String).filter(Boolean);
      const feeToman = asciiNumber(values.feeToman);
      const bankAmountToman = asciiNumber(values.bankAmountToman);
      const settledAt = window.ShamsiDatePicker?.getISOValue(form.elements.settledAt) || form.elements.settledAt.dataset.isoDate || values.settledAt;
      if (!paymentIds.length) return operationError({ code: 'settlement_payments_required', message: 'حداقل یک پرداخت داخل بچ انتخاب کنید.' });
      if (![feeToman, bankAmountToman].every((value) => Number.isSafeInteger(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER / 10)) return operationError({ code: 'settlement_amount_invalid', message: 'کارمزد و خالص واریزی باید عدد صحیح نامنفی باشند.' });
      try {
        await mutation('/api/admin/v2/finance/reconciliation/settlements', {
          branchId: Number(state.query.branchId) || 1, paymentIds, psp: values.psp,
          terminalId: values.terminalId, batchNo: values.batchNo, feeIrr: feeToman * 10,
          bankAmountIrr: bankAmountToman * 10, bankReference: values.bankReference,
          settledAt: `${settledAt}T12:00:00.000Z`,
        }, form.querySelector('button[type="submit"]'));
        await refreshAfterMutation('بچ تسویه با پرداخت‌ها و سند دفتر تطبیق شد.');
      } catch (error) {
        const target = root.querySelector('#fin-settlement-feedback');
        if (target) target.innerHTML = `<div class="fin-note warning" role="alert"><strong>تسویه ثبت نشد</strong><span>${esc(error.message)} · کد: ${esc(error.code || 'unknown')}</span></div>`;
        operationError(error);
      }
    });
    root.querySelector('#fin-bank-line-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const values = Object.fromEntries(new FormData(form));
      const amountToman = asciiNumber(values.amountToman);
      const occurredAt = window.ShamsiDatePicker?.getISOValue(form.elements.occurredAt) || form.elements.occurredAt.dataset.isoDate || values.occurredAt;
      if (!Number.isSafeInteger(amountToman) || amountToman <= 0 || amountToman > Number.MAX_SAFE_INTEGER / 10) return operationError({ code: 'bank_statement_amount_invalid', message: 'مبلغ گردش بانک باید عدد صحیح و بزرگ‌تر از صفر باشد.' }, '#fin-bank-feedback');
      try {
        await mutation('/api/admin/v2/finance/reconciliation/bank-statement-lines', {
          branchId: Number(state.query.branchId) || 1, bankReference: values.bankReference,
          bankAccountCode: values.bankAccountCode, direction: values.direction,
          amountIrr: amountToman * 10, occurredAt: `${occurredAt}T12:00:00.000Z`, description: values.description,
        }, form.querySelector('button[type="submit"]'));
        await refreshAfterMutation('ردیف صورت‌حساب بانک ثبت شد و در صف تطبیق قرار گرفت.');
      } catch (error) { operationError(error, '#fin-bank-feedback'); }
    });
    root.querySelectorAll('[data-fin-bank-match]').forEach((button) => button.addEventListener('click', async () => {
      const statementLineId = button.dataset.finBankMatch;
      const journalEntryId = root.querySelector(`[data-fin-bank-candidate="${CSS.escape(statementLineId)}"]`)?.value;
      if (!journalEntryId) return operationError({ code: 'bank_match_journal_required', message: 'یک سند قطعی با مبلغ، جهت، شعبه و حساب یکسان انتخاب کنید.' }, '#fin-bank-feedback');
      try {
        await mutation(`/api/admin/v2/finance/reconciliation/bank-statement-lines/${encodeURIComponent(statementLineId)}/match`, { journalEntryId }, button);
        await refreshAfterMutation('گردش بانک با سند قطعی دفتر تطبیق شد.');
      } catch (error) { operationError(error, '#fin-bank-feedback'); }
    }));
    root.querySelector('#fin-refund-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const values = Object.fromEntries(new FormData(form));
      const selected = form.elements.paymentId.selectedOptions[0];
      const orderId = selected?.dataset.orderId;
      const amountToman = asciiNumber(values.amountToman);
      const refundDate = window.ShamsiDatePicker?.getISOValue(form.elements.refundDate) || form.elements.refundDate.dataset.isoDate || values.refundDate;
      if (!orderId || !values.paymentId) return operationError({ code: 'refund_payment_required', message: 'پرداخت مبدأ را انتخاب کنید.' });
      if (!Number.isSafeInteger(amountToman) || amountToman <= 0 || amountToman > Number.MAX_SAFE_INTEGER / 10) return operationError({ code: 'refund_amount_invalid', message: 'مبلغ برگشت باید عدد صحیح و بزرگ‌تر از صفر باشد.' });
      try {
        await mutation(`/api/admin/v2/finance/orders/${encodeURIComponent(orderId)}/refund-requests`, {
          paymentId: values.paymentId, amountIrr: amountToman * 10,
          refundDate: `${refundDate}T12:00:00.000Z`, reason: values.reason,
        }, form.querySelector('button[type="submit"]'));
        await refreshAfterMutation('درخواست برگشت وجه برای تأیید مستقل مالک ارسال شد.');
      } catch (error) { operationError(error); }
    });
    const purchaseItem = root.querySelector('#fin-po-form [name="itemId"]');
    purchaseItem?.addEventListener('change', () => {
      const unit = root.querySelector('#fin-po-form [name="unit"]');
      if (unit) unit.value = purchaseItem.selectedOptions[0]?.dataset.unit || '';
    });
    root.querySelector('#fin-journal-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const submit = form.querySelector('button[type="submit"]');
      const amountToman = asciiNumber(new FormData(form).get('amountToman'));
      if (!Number.isSafeInteger(amountToman) || amountToman <= 0 || amountToman > Number.MAX_SAFE_INTEGER / 10) return operationError({ code: 'amount_invalid', message: 'مبلغ سند باید عدد صحیح، بزرگ‌تر از صفر و در محدودهٔ امن ریال باشد.' });
      const dateInput = form.elements.date;
      const date = window.ShamsiDatePicker?.getISOValue(dateInput) || dateInput.dataset.isoDate || dateInput.value;
      if (!date) return operationError({ code: 'date_required', message: 'تاریخ سند الزامی است.' });
      const values = Object.fromEntries(new FormData(form));
      const debitAccount = asciiDigits(values.debitAccount);
      const creditAccount = asciiDigits(values.creditAccount);
      if (!/^\d{4,10}$/.test(debitAccount) || !/^\d{4,10}$/.test(creditAccount)) return operationError({ code: 'account_invalid', message: 'کد حساب بدهکار و بستانکار باید ۴ تا ۱۰ رقم باشد.' });
      const branchId = Number(state.query.branchId) || 1;
      const amountIrr = amountToman * 10;
      try {
        const created = await mutation('/api/admin/v2/finance/journal-entries', {
          date: `${date}T12:00:00.000Z`, branchId, costCenter: values.costCenter || `branch:${branchId}`,
          description: values.description,
          lines: [
            { accountCode: debitAccount, debitIrr: amountIrr, creditIrr: 0, branchId, costCenter: values.costCenter || `branch:${branchId}`, memo: values.description },
            { accountCode: creditAccount, debitIrr: 0, creditIrr: amountIrr, branchId, costCenter: values.costCenter || `branch:${branchId}`, memo: values.description },
          ],
        }, submit);
        const entry = created?.data?.entry;
        if (entry && form.elements.submitForApproval.checked) {
          await mutation(`/api/admin/v2/finance/journal-entries/${encodeURIComponent(entry.id)}/submit`, {}, submit);
          await refreshAfterMutation(`سند ${entry.number} ثبت و برای تأیید ارسال شد.`);
        } else if (entry) {
          await refreshAfterMutation(`پیش‌نویس ${entry.number} ثبت شد.`);
        }
      } catch (error) { operationError(error); }
    });

    root.querySelectorAll('[data-fin-submit-journal]').forEach((button) => button.addEventListener('click', async () => {
      try {
        await mutation(`/api/admin/v2/finance/journal-entries/${encodeURIComponent(button.dataset.finSubmitJournal)}/submit`, {}, button);
        await refreshAfterMutation('سند برای بازبین ارسال شد.');
      } catch (error) { operationError(error); }
    }));

    root.querySelectorAll('[data-fin-capture-order]').forEach((button) => button.addEventListener('click', async () => {
      try {
        const result = await mutation(`/api/admin/v2/finance/events/orders/${encodeURIComponent(button.dataset.finCaptureOrder)}/capture`, {}, button);
        const status = result?.data?.event?.status;
        await refreshAfterMutation(status === 'blocked'
          ? 'پروندهٔ بررسی ایجاد شد؛ تا ثبت روش پرداخت و مرجع مدرک هیچ سندی پست نمی‌شود.'
          : 'رویداد مالی سفارش از منبع معتبر ثبت و پردازش شد.');
      } catch (error) { operationError(error); }
    }));

    root.querySelectorAll('[data-fin-resolve-event]').forEach((button) => button.addEventListener('click', async () => {
      const eventId = button.dataset.finResolveEvent;
      const source = button.dataset.finSource;
      let body;
      if (source === 'order.paid') {
        const tenderControl = root.querySelector(`[data-fin-event-tender="${CSS.escape(eventId)}"]`);
        if (tenderControl) {
          const amountIrr = Number(button.dataset.finAmountIrr);
          const evidenceReference = root.querySelector(`[data-fin-event-evidence="${CSS.escape(eventId)}"]`)?.value?.trim();
          body = { tenders: [{ tender: tenderControl.value, amountIrr }], evidenceReference };
        } else {
          body = {};
        }
      } else if (source.startsWith('inventory.')) {
        body = {};
      } else {
        const counterpartAccount = asciiDigits(root.querySelector(`[data-fin-event-account="${CSS.escape(eventId)}"]`)?.value);
        body = { counterpartAccount };
      }
      try {
        await mutation(`/api/admin/v2/finance/events/${encodeURIComponent(eventId)}/resolve`, body, button);
        await refreshAfterMutation('مانع رویداد رفع و سند متوازن ثبت شد.');
      } catch (error) { operationError(error); }
    }));

    root.querySelector('[data-fin-classify-legacy]')?.addEventListener('click', async (event) => {
      try {
        const result = await mutation('/api/admin/v2/finance/migration/classify', {}, event.currentTarget);
        const created = result?.data?.created || 0;
        await refreshAfterMutation(`${fa(created)} رکورد به آرشیو خواندنی افزوده شد؛ هیچ سندی ثبت و هیچ داده‌ای حذف نشد.`);
      } catch (error) { operationError(error); }
    });

    root.querySelectorAll('[data-fin-legacy-decision]').forEach((button) => button.addEventListener('click', async () => {
      const archiveId = button.dataset.finLegacyDecision;
      const decision = root.querySelector(`[data-fin-legacy-choice="${CSS.escape(archiveId)}"]`)?.value;
      const decisionNotes = root.querySelector(`[data-fin-legacy-note="${CSS.escape(archiveId)}"]`)?.value?.trim();
      const evidenceReference = root.querySelector(`[data-fin-legacy-evidence="${CSS.escape(archiveId)}"]`)?.value?.trim();
      const reviewedTenders = [...root.querySelectorAll(`[data-fin-legacy-tender="${CSS.escape(archiveId)}"]`)]
        .map((input) => ({ tender: input.dataset.tender, amountIrr: asciiNumber(input.value || 0) * 10 }))
        .filter((row) => row.amountIrr > 0);
      try {
        await mutation(`/api/admin/v2/finance/migration/archive/${encodeURIComponent(archiveId)}/decision`, { decision, decisionNotes, evidenceReference, reviewedTenders }, button);
        await refreshAfterMutation('تصمیم آرشیو با ردپای کامل ثبت شد؛ بازسازی خودکار انجام نشد.');
      } catch (error) { operationError(error); }
    }));

    root.querySelectorAll('[data-fin-legacy-preview]').forEach((button) => button.addEventListener('click', async () => {
      try {
        const result = await mutation(`/api/admin/v2/finance/migration/archive/${encodeURIComponent(button.dataset.finLegacyPreview)}/backfill-preview`, {}, button);
        const preview = result?.data;
        const target = root.querySelector('#fin-operation-feedback');
        if (target) target.innerHTML = preview?.ready
          ? `<div class="fin-note success"><strong>پیش‌نمایش متوازن و آماده است</strong><span>بدهکار و بستانکار: ${money(preview.totals.debitIrr)} · دوره: ${esc(preview.period?.name || 'نامشخص')} · این مرحله هیچ سندی ثبت نکرد.</span></div>`
          : `<div class="fin-note warning"><strong>پیش‌نمایش هنوز قابل ثبت نیست</strong><span>${(preview?.blockers || []).map((item) => esc(item.message)).join(' · ')}</span></div>`;
      } catch (error) { operationError(error); }
    }));

    root.querySelectorAll('[data-fin-legacy-request]').forEach((button) => button.addEventListener('click', async () => {
      try {
        await mutation(`/api/admin/v2/finance/migration/archive/${encodeURIComponent(button.dataset.finLegacyRequest)}/backfill-request`, {}, button);
        await refreshAfterMutation('سند بازسازی در وضعیت منتظر تأیید ساخته شد؛ هنوز قطعی نشده است.');
      } catch (error) { operationError(error); }
    }));

    root.querySelectorAll('[data-fin-approval-decision]').forEach((button) => button.addEventListener('click', async () => {
      const decision = button.dataset.finApprovalDecision;
      const approvalId = button.dataset.finApprovalId;
      if (decision === 'approved' && !window.confirm('این درخواست تأیید و اثر مالی آن قطعی شود؟')) return;
      const comment = root.querySelector(`[data-fin-approval-comment="${CSS.escape(approvalId)}"]`)?.value || '';
      try {
        await mutation(`/api/admin/v2/finance/approvals/${encodeURIComponent(approvalId)}/decision`, { decision, comment }, button);
        await refreshAfterMutation(decision === 'approved' ? 'درخواست تأیید و ثبت قطعی شد.' : 'درخواست با ردپای کامل رد شد.');
      } catch (error) { operationError(error); }
    }));

    root.querySelector('#fin-period-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const submit = form.querySelector('button[type="submit"]');
      const values = Object.fromEntries(new FormData(form));
      const startDate = window.ShamsiDatePicker?.getISOValue(form.elements.startDate) || form.elements.startDate.dataset.isoDate || values.startDate;
      const endDate = window.ShamsiDatePicker?.getISOValue(form.elements.endDate) || form.elements.endDate.dataset.isoDate || values.endDate;
      try {
        await mutation('/api/admin/v2/finance/fiscal-periods', { name: values.name, startDate, endDate }, submit);
        await refreshAfterMutation('دورهٔ مالی V2 ایجاد شد.');
      } catch (error) { operationError(error); }
    });

    root.querySelectorAll('[data-fin-close-period]').forEach((button) => button.addEventListener('click', async () => {
      if (!window.confirm('دوره به‌صورت مقدماتی بسته شود؟ ثبت‌های جدید تا بازگشایی کنترل‌شده متوقف می‌شوند.')) return;
      try {
        await mutation(`/api/admin/v2/finance/fiscal-periods/${encodeURIComponent(button.dataset.finClosePeriod)}/close`, { preliminary: true }, button);
        await refreshAfterMutation('دوره به‌صورت مقدماتی بسته شد.');
      } catch (error) { operationError(error); }
    }));

    root.querySelector('#fin-po-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const values = Object.fromEntries(new FormData(form));
      const quantity = asciiNumber(values.quantity);
      const unitPriceToman = asciiNumber(values.unitPriceToman);
      if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isSafeInteger(unitPriceToman) || unitPriceToman < 0) return operationError({ code: 'purchase_input_invalid', message: 'مقدار و قیمت خرید معتبر نیست.' });
      const issueDate = window.ShamsiDatePicker?.getISOValue(form.elements.issueDate) || form.elements.issueDate.dataset.isoDate || values.issueDate;
      const submit = form.querySelector('button[type="submit"]');
      try {
        const created = await mutation('/api/admin/v2/finance/purchase-orders', {
          branchId: Number(state.query.branchId) || 1, vendorId: values.vendorId, issueDate: `${issueDate}T12:00:00.000Z`, notes: values.notes,
          lines: [{ itemId: values.itemId, description: form.elements.itemId.selectedOptions[0]?.textContent || values.itemId, quantity, unit: values.unit, unitPriceIrr: unitPriceToman * 10 }],
        }, submit);
        const po = created?.data?.purchaseOrder;
        if (po && form.elements.submitForApproval.checked) await mutation(`/api/admin/v2/finance/purchase-orders/${encodeURIComponent(po.id)}/submit`, {}, submit);
        await refreshAfterMutation(po && form.elements.submitForApproval.checked ? `سفارش ${po.number} برای تأیید ارسال شد.` : `سفارش ${po?.number || ''} ذخیره شد.`);
      } catch (error) { operationError(error); }
    });

    root.querySelectorAll('[data-fin-submit-po]').forEach((button) => button.addEventListener('click', async () => {
      try {
        await mutation(`/api/admin/v2/finance/purchase-orders/${encodeURIComponent(button.dataset.finSubmitPo)}/submit`, {}, button);
        await refreshAfterMutation('سفارش خرید برای تأیید مستقل ارسال شد.');
      } catch (error) { operationError(error); }
    }));

    root.querySelector('#fin-grn-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const values = Object.fromEntries(new FormData(form));
      const [purchaseOrderId, purchaseOrderLineId] = String(values.poLine || '').split('|');
      const receivedQuantity = asciiNumber(values.receivedQuantity);
      if (!purchaseOrderId || !purchaseOrderLineId || !Number.isFinite(receivedQuantity) || receivedQuantity <= 0) return operationError({ code: 'goods_receipt_input_invalid', message: 'سفارش، ردیف و مقدار دریافت را کامل کنید.' });
      const receivedDate = window.ShamsiDatePicker?.getISOValue(form.elements.receivedDate) || form.elements.receivedDate.dataset.isoDate || values.receivedDate;
      try {
        await mutation('/api/admin/v2/finance/goods-receipts', {
          purchaseOrderId, deliveryNoteNumber: values.deliveryNoteNumber, receivedAt: `${receivedDate}T12:00:00.000Z`,
          lines: [{ purchaseOrderLineId, receivedQuantity }],
        }, form.querySelector('button[type="submit"]'));
        await refreshAfterMutation('رسید کالا ثبت شد؛ موجودی و حساب کالای فاکتورنشده به‌روزرسانی شدند.');
      } catch (error) { operationError(error); }
    });

    root.querySelector('#fin-invoice-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const values = Object.fromEntries(new FormData(form));
      const [goodsReceiptId, goodsReceiptLineId] = String(values.receiptLine || '').split('|');
      const invoicedQuantity = asciiNumber(values.invoicedQuantity);
      const unitPriceToman = asciiNumber(values.unitPriceToman);
      const vatToman = asciiNumber(values.vatToman || 0);
      if (!goodsReceiptId || !goodsReceiptLineId || !Number.isFinite(invoicedQuantity) || invoicedQuantity <= 0 || ![unitPriceToman, vatToman].every((value) => Number.isSafeInteger(value) && value >= 0)) return operationError({ code: 'vendor_invoice_input_invalid', message: 'اطلاعات ردیف، قیمت و مالیات فاکتور معتبر نیست.' });
      const invoiceDate = window.ShamsiDatePicker?.getISOValue(form.elements.invoiceDate) || form.elements.invoiceDate.dataset.isoDate || values.invoiceDate;
      try {
        await mutation('/api/admin/v2/finance/vendor-invoices', {
          goodsReceiptId, invoiceNumber: values.invoiceNumber, invoiceDate: `${invoiceDate}T12:00:00.000Z`, vatIrr: vatToman * 10,
          lines: [{ goodsReceiptLineId, invoicedQuantity, unitPriceIrr: unitPriceToman * 10 }],
        }, form.querySelector('button[type="submit"]'));
        await refreshAfterMutation('فاکتور ثبت و تطبیق سه‌سویه محاسبه شد.');
      } catch (error) { operationError(error); }
    });

    root.querySelector('#fin-supplier-payment-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const values = Object.fromEntries(new FormData(form));
      const amountToman = asciiNumber(values.amountToman);
      if (!Number.isSafeInteger(amountToman) || amountToman <= 0) return operationError({ code: 'supplier_payment_input_invalid', message: 'مبلغ پرداخت باید عدد صحیح و بزرگ‌تر از صفر باشد.' });
      const paymentDate = window.ShamsiDatePicker?.getISOValue(form.elements.paymentDate) || form.elements.paymentDate.dataset.isoDate || values.paymentDate;
      try {
        await mutation(`/api/admin/v2/finance/vendor-invoices/${encodeURIComponent(values.vendorInvoiceId)}/payment-request`, {
          amountIrr: amountToman * 10, paymentMethod: values.paymentMethod, paymentDate: `${paymentDate}T12:00:00.000Z`, reference: values.reference,
        }, form.querySelector('button[type="submit"]'));
        await refreshAfterMutation('درخواست پرداخت بدون خروج وجه، برای تأیید مالک ارسال شد.');
      } catch (error) { operationError(error); }
    });
    root.querySelector('#fin-cost-commitment-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const values = Object.fromEntries(new FormData(form));
      const monthlyAmountToman = asciiNumber(values.monthlyAmountToman);
      const startDate = window.ShamsiDatePicker?.getISOValue(form.elements.startDate) || form.elements.startDate.dataset.isoDate || values.startDate;
      const endDate = window.ShamsiDatePicker?.getISOValue(form.elements.endDate) || form.elements.endDate.dataset.isoDate || values.endDate;
      if (!Number.isSafeInteger(monthlyAmountToman) || monthlyAmountToman <= 0 || monthlyAmountToman > Number.MAX_SAFE_INTEGER / 10) return operationError({ code: 'cost_commitment_amount_invalid', message: 'مبلغ ماهانه باید عدد صحیح و بزرگ‌تر از صفر باشد.' });
      try {
        await mutation('/api/admin/v2/finance/cost-commitments', {
          branchId: Number(state.query.branchId) || 1, name: values.name, type: values.type,
          monthlyAmountIrr: monthlyAmountToman * 10, startDate, endDate: endDate || null,
          counterpartyId: values.counterpartyId, notes: values.notes,
        }, form.querySelector('button[type="submit"]'));
        await refreshAfterMutation('تعهد هزینه ثبت شد؛ تا زمان ایجاد ثبت دوره‌ای هیچ اثر مالی ندارد.');
      } catch (error) { operationError(error); }
    });
    root.querySelector('#fin-cost-accrual-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const values = Object.fromEntries(new FormData(form));
      const postingDate = window.ShamsiDatePicker?.getISOValue(form.elements.postingDate) || form.elements.postingDate.dataset.isoDate || values.postingDate;
      const overrideToman = values.amountToman ? asciiNumber(values.amountToman) : null;
      if (overrideToman != null && (!Number.isSafeInteger(overrideToman) || overrideToman <= 0 || overrideToman > Number.MAX_SAFE_INTEGER / 10)) return operationError({ code: 'cost_accrual_amount_invalid', message: 'مبلغ واقعی دوره معتبر نیست.' });
      try {
        await mutation(`/api/admin/v2/finance/cost-commitments/${encodeURIComponent(values.costCommitmentId)}/accruals`, {
          postingDate, amountIrr: overrideToman == null ? null : overrideToman * 10, overrideReason: values.overrideReason,
        }, form.querySelector('button[type="submit"]'));
        await refreshAfterMutation('ثبت دوره‌ای متوازن برای تأیید مستقل مالک ارسال شد.');
      } catch (error) { operationError(error); }
    });
    root.querySelector('#fin-cost-payment-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const values = Object.fromEntries(new FormData(form));
      const amountToman = asciiNumber(values.amountToman);
      const paymentDate = window.ShamsiDatePicker?.getISOValue(form.elements.paymentDate) || form.elements.paymentDate.dataset.isoDate || values.paymentDate;
      if (!Number.isSafeInteger(amountToman) || amountToman <= 0 || amountToman > Number.MAX_SAFE_INTEGER / 10) return operationError({ code: 'cost_payment_amount_invalid', message: 'مبلغ پرداخت باید عدد صحیح و بزرگ‌تر از صفر باشد.' });
      try {
        await mutation(`/api/admin/v2/finance/cost-accruals/${encodeURIComponent(values.costAccrualId)}/payment-request`, {
          amountIrr: amountToman * 10, paymentMethod: values.paymentMethod, paymentDate: `${paymentDate}T12:00:00.000Z`, reference: values.reference,
        }, form.querySelector('button[type="submit"]'));
        await refreshAfterMutation('درخواست پرداخت هزینه برای تأیید مالک ارسال شد؛ هنوز وجهی خارج نشده است.');
      } catch (error) { operationError(error); }
    });
    root.querySelectorAll('[data-fin-deactivate-cost]').forEach((button) => button.addEventListener('click', async () => {
      if (!window.confirm('این تعهد غیرفعال شود؟ ثبت‌های قطعی قبلی حفظ می‌شوند.')) return;
      try {
        await mutation(`/api/admin/v2/finance/cost-commitments/${encodeURIComponent(button.dataset.finDeactivateCost)}/deactivate`, {}, button);
        await refreshAfterMutation('تعهد هزینه غیرفعال شد؛ تاریخچه حذف نشد.');
      } catch (error) { operationError(error); }
    }));
    const openingForm = root.querySelector('#fin-opening-balance-form');
    const openingLines = openingForm?.querySelector('[data-fin-opening-lines]');
    openingLines?.addEventListener('click', (event) => {
      const remove = event.target.closest('[data-fin-remove-opening-row]');
      if (!remove) return;
      if (openingLines.querySelectorAll('[data-fin-opening-row]').length <= 2) {
        return operationError({ code: 'opening_balance_minimum_lines', message: 'مانده افتتاحیه کمتر از دو ردیف نمی‌تواند باشد.' }, '#fin-opening-preview-result');
      }
      remove.closest('[data-fin-opening-row]')?.remove();
    });
    root.querySelector('[data-fin-add-opening-row]')?.addEventListener('click', (event) => {
      const accounts = state.payload?.openingBalanceAccounts || [];
      const used = new Set([...openingLines.querySelectorAll('[name="openingAccount"]')].map((select) => select.value));
      const selected = accounts.find((account) => !used.has(account.code)) || accounts[0];
      if (!selected) return operationError({ code: 'opening_balance_accounts_missing', message: 'حساب مجاز دیگری در کدینگ موجود نیست.' }, '#fin-opening-preview-result');
      const options = accounts.map((account) => `<option value="${esc(account.code)}" ${account.code === selected.code ? 'selected' : ''}>${esc(account.code)} · ${esc(account.name)}</option>`).join('');
      openingLines.insertAdjacentHTML('beforeend', `<div class="fin-opening-row" data-fin-opening-row>
        <label class="fin-field"><span>حساب تفصیلی</span><select name="openingAccount" required>${options}</select></label>
        <label class="fin-field"><span>ماهیت این مانده</span><select name="openingSide"><option value="debit" ${selected.normalSide === 'debit' ? 'selected' : ''}>بدهکار</option><option value="credit" ${selected.normalSide === 'credit' ? 'selected' : ''}>بستانکار</option></select></label>
        <label class="fin-field"><span>مبلغ (تومان)</span><input name="openingAmountToman" inputmode="numeric" required></label>
        <label class="fin-field"><span>شرح ردیف</span><input name="openingMemo" maxlength="300"></label>
        <button class="fin-icon-btn" type="button" data-fin-remove-opening-row aria-label="حذف ردیف">×</button>
      </div>`);
      event.currentTarget.blur();
    });
    root.querySelector('[data-fin-opening-preview]')?.addEventListener('click', async (event) => {
      const button = event.currentTarget;
      const target = root.querySelector('#fin-opening-preview-result');
      try {
        button.disabled = true;
        const result = await api('/api/admin/v2/finance/opening-balances/preview', { method: 'POST', body: JSON.stringify(openingBalanceFormPayload(openingForm)) });
        const preview = result.data;
        if (target) target.innerHTML = `<div class="fin-result-grid">
          ${metric('جمع بدهکار', money(preview.totals.debitIrr), `${fa(preview.lines.length)} ردیف`)}
          ${metric('جمع بستانکار', money(preview.totals.creditIrr), 'باید برابر بدهکار باشد')}
          ${metric('اختلاف', money(preview.totals.debitIrr - preview.totals.creditIrr), 'کنترل سرور', 'success')}
          ${metric('دوره مقصد', esc(preview.period.name || preview.period.id), dateOnly(preview.asOfDate))}
        </div><div class="fin-note success"><strong>پیش‌نمایش متوازن است</strong><span>هنوز ذخیره یا قطعی نشده و حساب جبرانی خودکار ساخته نشده است.</span></div>`;
      } catch (error) { operationError(error, '#fin-opening-preview-result'); }
      finally { button.disabled = false; }
    });
    openingForm?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      try {
        await mutation('/api/admin/v2/finance/opening-balances', openingBalanceFormPayload(form), form.querySelector('button[type="submit"]'));
        await refreshAfterMutation('مانده افتتاحیه متوازن برای تأیید مستقل مالک ارسال شد؛ هنوز قطعی نیست.');
      } catch (error) { operationError(error, '#fin-opening-preview-result'); }
    });
    root.querySelectorAll('[data-fin-reverse-opening]').forEach((button) => button.addEventListener('click', async () => {
      const reason = window.prompt('علت دقیق سند معکوس مانده افتتاحیه را وارد کنید:')?.trim();
      if (reason == null) return;
      if (reason.length < 3) return operationError({ code: 'reversal_reason_required', message: 'علت سند معکوس حداقل سه نویسه لازم دارد.' }, '#fin-opening-preview-result');
      try {
        await mutation(`/api/admin/v2/finance/journal-entries/${encodeURIComponent(button.dataset.finReverseOpening)}/reversal`, { reason, date: `${localIsoDate()}T12:00:00.000Z` }, button);
        await refreshAfterMutation('مانده افتتاحیه با سند مستقل معکوس شد؛ رکورد اصلی حذف یا ویرایش نشد.');
      } catch (error) { operationError(error, '#fin-opening-preview-result'); }
    }));
    root.querySelector('#fin-fixed-asset-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const values = Object.fromEntries(new FormData(form));
      const purchaseCostToman = asciiNumber(values.purchaseCostToman);
      const salvageValueToman = asciiNumber(values.salvageValueToman || 0);
      const usefulLifeMonths = asciiNumber(values.usefulLifeMonths);
      const purchaseDate = window.ShamsiDatePicker?.getISOValue(form.elements.purchaseDate) || form.elements.purchaseDate.dataset.isoDate || values.purchaseDate;
      const inServiceDate = window.ShamsiDatePicker?.getISOValue(form.elements.inServiceDate) || form.elements.inServiceDate.dataset.isoDate || values.inServiceDate;
      if (![purchaseCostToman, salvageValueToman, usefulLifeMonths].every(Number.isSafeInteger)
        || purchaseCostToman <= 0 || salvageValueToman < 0 || salvageValueToman >= purchaseCostToman
        || usefulLifeMonths < 1 || usefulLifeMonths > 600 || purchaseCostToman > Number.MAX_SAFE_INTEGER / 10) {
        return operationError({ code: 'fixed_asset_input_invalid', message: 'بها، ارزش اسقاط و عمر مفید دارایی معتبر نیست.' });
      }
      try {
        await mutation('/api/admin/v2/finance/fixed-assets', {
          branchId: Number(state.query.branchId) || 1, assetCode: values.assetCode, name: values.name,
          category: values.category, fundingMethod: values.fundingMethod, sourceReference: values.sourceReference,
          purchaseDate, inServiceDate, purchaseCostIrr: purchaseCostToman * 10,
          salvageValueIrr: salvageValueToman * 10, usefulLifeMonths,
        }, form.querySelector('button[type="submit"]'));
        await refreshAfterMutation('خرید دارایی به‌صورت سند منتظر تأیید ثبت شد؛ هنوز قطعی نیست.');
      } catch (error) { operationError(error); }
    });
    root.querySelector('[data-fin-depreciation-preview]')?.addEventListener('click', async (event) => {
      const button = event.currentTarget;
      const form = root.querySelector('#fin-depreciation-form');
      const dateInput = form?.elements.postingDate;
      const postingDate = window.ShamsiDatePicker?.getISOValue(dateInput) || dateInput?.dataset.isoDate || dateInput?.value;
      const target = root.querySelector('#fin-depreciation-preview-result');
      try {
        button.disabled = true;
        const result = await api('/api/admin/v2/finance/depreciation-runs/preview', {
          method: 'POST', body: JSON.stringify({ branchId: Number(state.query.branchId) || 1, postingDate }),
        });
        const preview = result.data;
        if (target) target.innerHTML = preview.status !== 'available' ? empty(preview.message || 'دارایی قابل استهلاکی وجود ندارد.') : `
          <div class="fin-result-grid">
            ${metric('دارایی قابل ثبت', fa(preview.lines.length), `ماه ${esc(preview.serviceMonth)}`)}
            ${metric('استهلاک پیشنهادی', money(preview.totalDepreciationIrr), 'روش خط مستقیم · ماه کامل')}
            ${metric('قبلاً ثبت‌شده', fa(preview.skippedAlreadyProcessed), 'برای همان ماه دوباره محاسبه نمی‌شود')}
          </div>`;
      } catch (error) { operationError(error); }
      finally { button.disabled = false; }
    });
    root.querySelector('#fin-depreciation-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const dateInput = form.elements.postingDate;
      const postingDate = window.ShamsiDatePicker?.getISOValue(dateInput) || dateInput.dataset.isoDate || dateInput.value;
      try {
        await mutation('/api/admin/v2/finance/depreciation-runs', {
          branchId: Number(state.query.branchId) || 1, postingDate,
        }, form.querySelector('button[type="submit"]'));
        await refreshAfterMutation('ثبت استهلاک ماهانه برای تأیید مستقل مالک ارسال شد.');
      } catch (error) { operationError(error); }
    });
    root.querySelector('[data-fin-payroll-preview]')?.addEventListener('click', async (event) => {
      const button = event.currentTarget;
      const form = root.querySelector('#fin-payroll-run-form');
      const target = root.querySelector('#fin-payroll-preview-result');
      try {
        button.disabled = true;
        const result = await api('/api/admin/v2/finance/payroll-runs/preview', { method: 'POST', body: JSON.stringify(payrollFormPayload(form)) });
        const preview = result.data;
        if (target) target.innerHTML = `<div class="fin-result-grid">
          ${metric('هزینه کل کارفرما', money(preview.totalExpenseIrr), `${fa(preview.headcount)} نفر`)}
          ${metric('خالص حقوق پرداختنی', money(preview.netPayIrr), 'حساب ۲۶۰۰')}
          ${metric('بیمه پرداختنی', money(preview.totalInsuranceIrr), 'سهم کارمند + کارفرما')}
          ${metric('مالیات و سایر کسورات', money(preview.payrollTaxIrr + preview.otherDeductionsIrr), 'بدهی مستقل')}
        </div><div class="fin-note"><strong>پیش‌نمایش متوازن است</strong><span>هنوز ذخیره یا قطعی نشده و هیچ نرخ قانونی به‌صورت خودکار اعمال نشده است.</span></div>`;
      } catch (error) { operationError(error, '#fin-payroll-preview-result'); }
      finally { button.disabled = false; }
    });
    root.querySelector('#fin-payroll-run-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      try {
        await mutation('/api/admin/v2/finance/payroll-runs', payrollFormPayload(form), form.querySelector('button[type="submit"]'));
        await refreshAfterMutation('لیست حقوق متوازن برای تأیید مستقل مالک ارسال شد؛ هنوز قطعی یا پرداخت نشده است.');
      } catch (error) { operationError(error, '#fin-payroll-preview-result'); }
    });
    root.querySelector('#fin-payroll-payment-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const values = Object.fromEntries(new FormData(form));
      const amountToman = asciiNumber(values.amountToman);
      const paymentDate = window.ShamsiDatePicker?.getISOValue(form.elements.paymentDate) || form.elements.paymentDate.dataset.isoDate || values.paymentDate;
      if (!Number.isSafeInteger(amountToman) || amountToman <= 0 || amountToman > Number.MAX_SAFE_INTEGER / 10) return operationError({ code: 'payroll_payment_amount_invalid', message: 'مبلغ پرداخت حقوق باید عدد صحیح و بزرگ‌تر از صفر باشد.' });
      try {
        await mutation(`/api/admin/v2/finance/payroll-runs/${encodeURIComponent(values.payrollRunId)}/payment-request`, {
          liabilityType: values.liabilityType, amountIrr: amountToman * 10, paymentMethod: values.paymentMethod,
          paymentDate: `${paymentDate}T12:00:00.000Z`, reference: values.reference,
        }, form.querySelector('button[type="submit"]'));
        await refreshAfterMutation('درخواست پرداخت بدهی حقوق برای تأیید مالک ارسال شد؛ هنوز وجهی خارج نشده است.');
      } catch (error) { operationError(error); }
    });
  }

  function renderWorkbench(data) {
    const actions = data.actions || [];
    const readiness = data.shadowReadiness || { status: 'NO_GO', gates: [], completeOrders: 0, operatingDays: 0 };
    return `
      <section class="fin-section-head"><div><h2>کارتابل حسابدار</h2><p>فقط مواردی که امروز نیاز به تصمیم یا پیگیری دارند.</p></div>${statusBadge(data.status)}</section>
      ${renderOperations(data.operations || {})}
      <section class="fin-panel fin-actions"><div class="fin-panel-title"><div><h3>اقدام‌های متناسب با وضعیت</h3><p>حداکثر سه اقدام با اولویت امروز</p></div></div>
        ${actions.length ? `<div class="fin-action-grid">${actions.map((action, index) => `<button type="button" ${action.workspace ? `data-fin-goto="${esc(action.workspace)}"` : `data-fin-operation="${esc(action.operation || 'journal')}"`}><span>${fa(index + 1)}</span><strong>${esc(action.label)}</strong><small>${action.workspace ? 'رفتن به فضای کاری مرتبط' : 'انجام عملیات در همین کارتابل'}</small></button>`).join('')}</div>` : '<div class="fin-ok-state">مورد فوریِ قابل‌اقدامی ثبت نشده است.</div>'}
      </section>
      <section class="fin-panel"><div class="fin-panel-title"><div><h3>کنترل و تطبیق ارقام</h3><p>خلاصهٔ عددی پس از میز عملیات؛ هر عدد با منبع مشخص.</p></div></div><div class="fin-metrics">
        ${metric('فروش عملیاتی', money(data.metrics.operationalSalesIrr), `${fa(data.metrics.paidOrders)} سفارش · منبع: سفارش‌ها`)}
        ${metric('فروش ثبت‌شده در دفتر V2', money(data.metrics.ledgerSalesIrr), 'منبع: اسناد قطعی Finance V2')}
        ${metric('اختلاف توضیح‌نشده', money(data.metrics.unexplainedDifferenceIrr), 'باید پیش از cutover صفر شود', data.metrics.unexplainedDifferenceIrr ? 'danger' : 'success')}
        ${metric('رویداد مسدود', fa(data.metrics.blockedEvents), 'روش پرداخت، دوره یا قاعدهٔ ثبت', data.metrics.blockedEvents ? 'danger' : '')}
      </div></section>
      <section class="fin-panel"><div class="fin-panel-title"><div><h3>آمادگی اجرای سایه و Cutover</h3><p>هر دو آستانهٔ ۷ روز و ۱۰۰ سفارش کامل الزامی‌اند؛ فعال‌سازی خودکار انجام نمی‌شود.</p></div>${statusBadge(readiness.status, readiness.status === 'READY_FOR_CUTOVER_REVIEW' ? 'success' : 'danger')}</div>
        <div class="fin-metrics">
          ${metric('سفارش کامل', fa(readiness.completeOrders), 'پرداخت + سند فروش + COGS قطعی')}
          ${metric('روز عملیاتی کامل', fa(readiness.operatingDays), 'روز متمایز با سفارش کامل')}
        </div>
        <div class="fin-issue-list">${(readiness.gates || []).map((gate) => `<article class="${gate.passed ? 'success' : 'danger'}"><div>${statusBadge(gate.passed ? 'عبور' : 'مانع', gate.passed ? 'success' : 'danger')}<strong>${esc(gate.label)}</strong></div><p>${gate.target == null ? esc(String(gate.value ?? '—')) : `${fa(gate.value)} از ${fa(gate.target)}`}</p><code>${esc(gate.id)}</code></article>`).join('')}</div>
      </section>
      <section class="fin-panel"><div class="fin-panel-title"><div><h3>هشدارهای کیفیت داده</h3><p>هیچ خطا یا نبود داده‌ای با رقم نمایشی جایگزین نمی‌شود.</p></div><span>${fa(data.issues?.length || 0)} مورد</span></div>
        ${(data.issues || []).length ? `<div class="fin-issue-list">${data.issues.map((issue) => `<article class="${severity(issue.severity)}"><div>${statusBadge(issue.severity, severity(issue.severity))}<strong>${esc(issue.title)}</strong></div><p>${fa(issue.count)} رکورد${issue.amountIrr == null ? '' : ` · ${money(issue.amountIrr)}`}</p><code>${esc(issue.code)}</code></article>`).join('')}</div>` : '<div class="fin-ok-state">هشدار کیفیت داده‌ای در محدودهٔ انتخاب‌شده وجود ندارد.</div>'}
      </section>
      <section class="fin-panel"><div class="fin-panel-title"><div><h3>منابع محاسبه</h3><p>ردیابی مرجع هر عدد</p></div></div><dl class="fin-source-list">${Object.entries(data.sources || {}).map(([key, value]) => `<div><dt>${esc(key)}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl></section>`;
  }

  function operationTabs() {
    const tabs = [
      { id: 'journal', label: 'ثبت سند' },
      { id: 'events', label: 'رویدادها و مغایرت' },
      { id: 'approvals', label: 'تأییدها' },
      { id: 'periods', label: 'دورهٔ مالی' },
    ];
    return `<nav class="fin-operation-tabs" aria-label="عملیات حسابداری">${tabs.map((tab) => `<button type="button" data-fin-operation="${tab.id}" class="${state.operation === tab.id ? 'active' : ''}">${esc(tab.label)}</button>`).join('')}</nav>`;
  }

  function renderOperations(operations) {
    const counters = operations.counters || {};
    const panels = {
      journal: renderJournalOperations,
      events: renderEventOperations,
      approvals: renderApprovalOperations,
      periods: renderPeriodOperations,
    };
    return `<section class="fin-panel fin-operations" id="fin-operations">
      <div class="fin-panel-title"><div><h3>میز عملیات حسابداری</h3><p>ثبت و گردش کار واقعی؛ هر عملیات با کلید یکتا، مجوز نقش و ردپای ممیزی انجام می‌شود.</p></div><span>عملیاتی، نه صرفاً گزارش</span></div>
      <div class="fin-operation-counters">
        <span><b>${fa(counters.uncapturedOrders)}</b> سفارش جاافتاده</span>
        <span><b>${fa(counters.blockedEvents)}</b> رویداد مسدود</span>
        <span><b>${fa(counters.draftJournals)}</b> پیش‌نویس</span>
        <span><b>${fa(counters.pendingApprovals)}</b> منتظر تأیید</span>
      </div>
      ${operationTabs()}
      <div id="fin-operation-feedback"></div>
      <div class="fin-operation-body">${(panels[state.operation] || panels.journal)(operations)}</div>
    </section>`;
  }

  function renderJournalOperations(operations) {
    const today = localIsoDate();
    const drafts = operations.journalDrafts || [];
    return `<div class="fin-operation-layout">
      <form id="fin-journal-form" class="fin-form" autocomplete="off">
        <div class="fin-form-title"><div><strong>سند دستی متوازن</strong><small>مبلغ را تومان وارد کنید؛ در API به ریال صحیح تبدیل می‌شود.</small></div>${statusBadge('draft', 'neutral')}</div>
        <label class="fin-field span-2"><span>شرح سند</span><input name="description" required maxlength="280" placeholder="مثلاً اصلاح طبقه‌بندی هزینه آب"></label>
        <label class="fin-field"><span>تاریخ</span><input name="date" type="date" value="${today}" required></label>
        <label class="fin-field"><span>مبلغ (تومان)</span><input name="amountToman" inputmode="numeric" required placeholder="۰"></label>
        <label class="fin-field"><span>حساب بدهکار</span><input name="debitAccount" list="fin-account-codes" required pattern="[0-9۰-۹٠-٩]{4,10}" placeholder="مثلاً ۵۱۰۰"></label>
        <label class="fin-field"><span>حساب بستانکار</span><input name="creditAccount" list="fin-account-codes" required pattern="[0-9۰-۹٠-٩]{4,10}" placeholder="مثلاً ۱۱۱۰"></label>
        <label class="fin-field span-2"><span>مرکز هزینه</span><input name="costCenter" value="branch:${esc(state.query.branchId || '1')}" required></label>
        <datalist id="fin-account-codes"><option value="1110">صندوق</option><option value="1310">درگاه</option><option value="1320">کارتخوان</option><option value="2100">حساب‌های پرداختنی</option><option value="4110">فروش حضوری</option><option value="5100">هزینه مواد</option><option value="6100">حقوق</option><option value="6200">اجاره</option><option value="6990">سایر هزینه‌ها</option></datalist>
        <label class="fin-check span-2"><input name="submitForApproval" type="checkbox" checked><span>پس از ثبت برای تأیید مدیر/مالک ارسال شود</span></label>
        <button class="fin-btn primary span-2" type="submit">ثبت سند و شروع گردش تأیید</button>
      </form>
      <div class="fin-operation-list"><div class="fin-subhead"><strong>پیش‌نویس‌ها و منتظرهای اخیر</strong><span>${fa(drafts.length)} مورد</span></div>
        ${drafts.length ? drafts.map((row) => `<article><div><strong>${esc(row.number)}</strong><small>${esc(row.description)} · ${dateTime(row.date)}</small></div><div>${statusBadge(row.status)}<b>${money(row.debitIrr)}</b>${row.status === 'draft' ? `<button class="fin-btn secondary" type="button" data-fin-submit-journal="${esc(row.id)}">ارسال برای تأیید</button>` : ''}</div></article>`).join('') : empty('سند باز یا منتظر تأییدی وجود ندارد.')}
      </div>
    </div>`;
  }

  function renderEventOperations(operations) {
    const orders = operations.uncapturedOrders || [];
    const events = operations.events || [];
    return `<div class="fin-grid-2">
      <div class="fin-operation-list"><div class="fin-subhead"><strong>سفارش پرداخت‌شده بدون رویداد مالی</strong><span>${fa(orders.length)} مورد</span></div>
        ${orders.length ? orders.map((row) => `<article><div><strong>${esc(row.orderNo || row.id)}</strong><small>${dateTime(row.createdAt)} · ${money(row.amountIrr)}</small></div><div>${statusBadge(row.tenderKnown ? 'روش پرداخت معتبر' : 'روش پرداخت نامشخص', row.tenderKnown ? 'success' : 'danger')}<button class="fin-btn secondary" type="button" data-fin-capture-order="${esc(row.id)}">${row.tenderKnown ? 'ثبت مالی' : 'ایجاد پرونده بررسی'}</button></div></article>`).join('') : empty('سفارش جاافتاده‌ای در محدودهٔ انتخاب‌شده نیست.')}
      </div>
      <div class="fin-operation-list"><div class="fin-subhead"><strong>رویدادهای نیازمند رفع مانع</strong><span>${fa(events.length)} مورد</span></div>
        ${events.length ? events.map((row) => {
          const inventoryEvent = ['inventory.waste', 'inventory.stock_count', 'inventory.production_batch'].includes(row.source);
          const supported = ['order.paid', 'cash.movement'].includes(row.source) || inventoryEvent;
          const sourceTenders = Array.isArray(row.payload?.tenderSnapshot) ? row.payload.tenderSnapshot : [];
          const hasReliableTender = sourceTenders.length > 0 && sourceTenders.reduce((sum, item) => sum + Number(item.amountIrr || 0), 0) === Number(row.amountIrr || 0);
          const control = row.source === 'order.paid' && !hasReliableTender
            ? `<select data-fin-event-tender="${esc(row.id)}" aria-label="روش پرداخت"><option value="card">کارتخوان</option><option value="cash">نقد</option><option value="online">درگاه</option><option value="credit">اعتباری</option><option value="gift_card">کارت هدیه</option></select><input data-fin-event-evidence="${esc(row.id)}" required maxlength="160" placeholder="مرجع مدرک پرداخت" aria-label="شماره رسید، تراکنش یا گزارش صندوق">`
            : row.source === 'order.paid'
              ? `<span class="fin-badge success">استفاده از روش پرداخت ثبت‌شده در منبع</span>`
            : inventoryEvent ? '' : `<input data-fin-event-account="${esc(row.id)}" inputmode="numeric" placeholder="حساب مقابل" aria-label="کد حساب مقابل">`;
          const actionLabel = inventoryEvent ? 'ارزش‌گذاری با قیمت معتبر و ثبت' : row.source === 'order.paid' && !hasReliableTender ? 'ثبت پس از بررسی مدرک' : 'رفع مانع و ثبت';
          return `<article class="stack"><div><strong>${esc(row.source)} / ${esc(row.sourceId)}</strong><small>${esc(row.error?.message || 'منتظر پردازش')} · ${money(row.amountIrr)}</small></div>${supported ? `<div class="fin-inline-action">${control}<button class="fin-btn secondary" type="button" data-fin-resolve-event="${esc(row.id)}" data-fin-source="${esc(row.source)}" data-fin-amount-irr="${esc(row.amountIrr)}">${actionLabel}</button></div>` : `<span class="fin-badge warning">قاعدهٔ رفع خودکار ندارد</span>`}</article>`;
        }).join('') : empty('رویداد مسدود یا منتظر پردازشی وجود ندارد.')}
      </div>
    </div>${renderMigrationOperations(operations)}`;
  }

  function renderMigrationOperations(operations) {
    const rows = operations.legacyArchive || [];
    const summary = operations.legacyArchiveSummary || { total: 0, byTrust: {}, byDecision: {} };
    const trustTone = (value) => value === 'quarantined' ? 'danger' : value === 'inferred_needs_approval' ? 'warning' : 'success';
    return `<details class="fin-action-details" ${summary.byDecision?.pending ? 'open' : ''}>
      <summary><span><strong>پاک‌سازی و تصمیم مهاجرت داده‌های قدیمی</strong><small>طبقه‌بندی قابل ممیزی؛ بدون حذف، تبدیل کور مبلغ یا ثبت خودکار سند</small></span><em>${fa(summary.total || 0)} رکورد آرشیوی</em></summary>
      <div class="fin-note warning"><strong>این عملیات فقط پرونده می‌سازد</strong><span>حتی «مجاز برای بازسازی» صرفاً تصمیم مدیر است؛ ایجاد سند افتتاحیه یا backfill مرحلهٔ جداگانه و کنترل‌شده خواهد بود.</span></div>
      <div class="fin-inline-action"><button class="fin-btn primary" type="button" data-fin-classify-legacy>اسکن و به‌روزرسانی آرشیو خواندنی</button><span class="fin-badge neutral">تأییدشده ${fa(summary.byTrust?.verified || 0)}</span><span class="fin-badge warning">نیازمند تأیید ${fa(summary.byTrust?.inferred_needs_approval || 0)}</span><span class="fin-badge danger">قرنطینه ${fa(summary.byTrust?.quarantined || 0)}</span></div>
      <div class="fin-operation-list"><div class="fin-subhead"><strong>پرونده‌های مهاجرت</strong><span>${fa(summary.byDecision?.pending || 0)} تصمیم باز</span></div>
        ${rows.length ? rows.map((row) => {
          const choices = row.trustStatus === 'quarantined'
            ? '<option value="keep_quarantined">در قرنطینه بماند</option><option value="not_financial">غیرمالی</option>'
            : '<option value="approved_for_backfill">مجاز برای بازسازی کنترل‌شده</option><option value="keep_quarantined">در قرنطینه بماند</option><option value="not_financial">غیرمالی</option>';
          const tenderReview = row.trustStatus === 'inferred_needs_approval' ? `<details><summary>تقسیم مبلغ بر اساس مدرک پرداخت</summary><div class="fin-inline-action"><label>نقد (تومان)<input data-fin-legacy-tender="${esc(row.id)}" data-tender="cash" inputmode="numeric" value="0"></label><label>کارتخوان (تومان)<input data-fin-legacy-tender="${esc(row.id)}" data-tender="card" inputmode="numeric" value="0"></label><label>درگاه (تومان)<input data-fin-legacy-tender="${esc(row.id)}" data-tender="online" inputmode="numeric" value="0"></label><label>اعتباری (تومان)<input data-fin-legacy-tender="${esc(row.id)}" data-tender="credit" inputmode="numeric" value="0"></label><label>کارت هدیه (تومان)<input data-fin-legacy-tender="${esc(row.id)}" data-tender="gift_card" inputmode="numeric" value="0"></label></div><small>جمع این مبالغ باید دقیقاً ${money(row.amountIrr)} باشد؛ مقدار صفر نادیده گرفته می‌شود.</small></details>` : '';
          const backfillActions = row.sourceTable === 'orders' && row.decision === 'approved_for_backfill'
            ? `<div class="fin-inline-action">${statusBadge(row.backfillStatus || 'not_requested', row.backfillStatus === 'posted' ? 'success' : 'warning')}<button class="fin-btn secondary" type="button" data-fin-legacy-preview="${esc(row.id)}">پیش‌نمایش سند</button>${!['pending_approval', 'posted', 'reversed'].includes(row.backfillStatus) ? `<button class="fin-btn primary" type="button" data-fin-legacy-request="${esc(row.id)}">ارسال سند برای تأیید مستقل</button>` : ''}</div>` : '';
          return `<article class="stack"><div><strong>${esc(row.sourceTable)} / ${esc(row.sourceId)}</strong><small>${esc(label(row.reason))}${row.amountIrr == null ? '' : ` · ${money(row.amountIrr)}`}${row.decidedBy ? ` · تصمیم‌گیر: ${esc(row.decidedBy)}` : ''}</small></div><div class="fin-inline-action">${statusBadge(row.trustStatus, trustTone(row.trustStatus))}${statusBadge(row.decision, row.decision === 'approved_for_backfill' ? 'success' : 'neutral')}<select data-fin-legacy-choice="${esc(row.id)}" aria-label="تصمیم مهاجرت">${choices}</select><input data-fin-legacy-evidence="${esc(row.id)}" maxlength="160" placeholder="مرجع مدرک (برای بازسازی الزامی)"><input data-fin-legacy-note="${esc(row.id)}" maxlength="500" required placeholder="علت تصمیم"><button class="fin-btn secondary" type="button" data-fin-legacy-decision="${esc(row.id)}">ثبت تصمیم</button></div>${tenderReview}${backfillActions}</article>`;
        }).join('') : empty('هنوز اسکن مهاجرت اجرا نشده است.')}
      </div>
    </details>`;
  }

  function renderApprovalOperations(operations) {
    const approvals = operations.approvals || [];
    return `<div class="fin-operation-list"><div class="fin-subhead"><strong>صف تأیید مستقل</strong><span>ایجادکننده نمی‌تواند درخواست خودش را تأیید کند.</span></div>
      ${approvals.length ? approvals.map((row) => `<article class="stack"><div><strong>${esc(label(row.operation))}</strong><small>${esc(label(row.entityType))} · ${money(row.amountIrr)} · ایجاد: ${dateTime(row.createdAt)}</small></div><div class="fin-inline-action"><input data-fin-approval-comment="${esc(row.id)}" placeholder="یادداشت تصمیم" maxlength="300"><button class="fin-btn secondary" type="button" data-fin-approval-id="${esc(row.id)}" data-fin-approval-decision="rejected">رد</button><button class="fin-btn primary" type="button" data-fin-approval-id="${esc(row.id)}" data-fin-approval-decision="approved">تأیید</button></div></article>`).join('') : empty('درخواستی منتظر تأیید مالک یا مدیر مالی نیست.')}
    </div>`;
  }

  function renderPeriodOperations(operations) {
    const periods = operations.periods || [];
    const current = operations.currentPeriod;
    return `<div class="fin-operation-layout">
      <form id="fin-period-form" class="fin-form" autocomplete="off">
        <div class="fin-form-title span-2"><div><strong>تعریف دورهٔ مالی V2</strong><small>دوره‌ها باید بدون فاصله و هم‌پوشانی باشند.</small></div>${statusBadge(operations.periodSource === 'finance_v2' ? 'V2' : 'legacy_read_only', 'neutral')}</div>
        <label class="fin-field span-2"><span>نام دوره</span><input name="name" required maxlength="120" placeholder="مثلاً شهریور ۱۴۰۵"></label>
        <label class="fin-field"><span>شروع دوره</span><input name="startDate" type="date" required></label>
        <label class="fin-field"><span>پایان دوره</span><input name="endDate" type="date" required></label>
        <button class="fin-btn primary span-2" type="submit">ایجاد دوره</button>
      </form>
      <div class="fin-operation-list"><div class="fin-subhead"><strong>دوره‌ها</strong><span>${fa(periods.length)} مورد</span></div>
        ${operations.periodSource !== 'finance_v2' ? '<div class="fin-note warning"><strong>دوره‌های فعلی فقط خواندنی‌اند</strong><span>برای عملیات بستن، دوره باید یک‌بار در V2 تعریف و کنترل شود.</span></div>' : ''}
        ${periods.length ? periods.map((row) => `<article><div><strong>${esc(row.name || row.id)}</strong><small>${esc(row.startDate)} تا ${esc(row.endDate)}</small></div><div>${statusBadge(row.status)}${operations.periodSource === 'finance_v2' && ['open', 'reopened'].includes(row.status) ? `<button class="fin-btn secondary" type="button" data-fin-close-period="${esc(row.id)}">بستن مقدماتی</button>` : ''}</div></article>`).join('') : empty('دورهٔ مالی ثبت نشده است؛ بدون دوره امکان پست سند وجود ندارد.')}
        ${current ? `<div class="fin-note"><strong>دورهٔ جاری: ${esc(current.name || current.id)}</strong><span>وضعیت ${esc(label(current.status))}</span></div>` : '<div class="fin-note warning"><strong>دورهٔ جاری یافت نشد</strong><span>این وضعیت مانع ثبت قطعی سند است.</span></div>'}
      </div>
    </div>`;
  }

  function renderSales(data) {
    const summary = data.summary;
    const refundablePayments = data.refundablePayments || [];
    const refunds = data.refunds || [];
    const unmatchedPayments = data.reconciliation?.unmatchedPayments || [];
    const settlementsV2 = data.reconciliation?.settlements || [];
    const bankAccounts = data.reconciliation?.bankAccounts || [];
    const bankStatementLines = data.reconciliation?.bankStatementLines || [];
    const bankCandidates = data.reconciliation?.bankCandidates || [];
    const unmatchedBankLines = bankStatementLines.filter((row) => row.status === 'unmatched');
    const today = localIsoDate();
    return `
      <section class="fin-section-head"><div><h2>فروش، صندوق و بانک</h2><p>سفارش، tender، نشست صندوق و تسویه در یک نمای تطبیقی.</p></div><button class="fin-btn secondary" type="button" data-fin-export="sales">خروجی CSV</button></section>
      <div class="fin-metrics">
        ${metric('فروش خالص عملیاتی', money(summary.operational.salesIrr), `${fa(summary.operational.paidOrders)} سفارش · برگشت ${money(summary.operational.refundsIrr)}`)}
        ${metric('دفتر فروش V2', money(summary.ledger.salesIrr), `${fa(summary.ledger.postedEntries)} سند قطعی`)}
        ${metric('اختلاف عملیات و دفتر', money(summary.reconciliation.salesDifferenceIrr), summary.reconciliation.salesDifferenceIrr ? 'نیازمند تطبیق' : 'تطبیق کامل', summary.reconciliation.salesDifferenceIrr ? 'danger' : 'success')}
        ${metric('نشست صندوق', fa(data.cashSessions?.length || 0), 'مرجع: cashSessions')}
      </div>
      <div class="fin-grid-2">
        <section class="fin-panel"><div class="fin-panel-title"><div><h3>روش‌های پرداخت</h3><p>بدون نسبت یا fallback ساختگی</p></div></div>${(data.tenders || []).length ? `<div class="fin-tender-list">${data.tenders.map((row) => `<div><span>${esc(label(row.tender))}</span><strong>${money(row.amountIrr)}</strong></div>`).join('')}</div>` : empty('روش پرداخت قابل اتکایی ثبت نشده است.')}</section>
        <section class="fin-panel"><div class="fin-panel-title"><div><h3>وضعیت تسویه</h3><p>یکتایی PSP / پایانه / بچ</p></div></div>${data.settlementDuplicates?.length ? `<div class="fin-issue-list">${data.settlementDuplicates.map((row) => `<article class="danger"><strong>${esc(row.key)}</strong><p>${fa(row.count)} رکورد تکراری</p></article>`).join('')}</div>` : '<div class="fin-ok-state">بچ تسویهٔ تکراری در دادهٔ خوانده‌شده دیده نشد.</div>'}</section>
      </div>
      <section class="fin-panel fin-operations"><div class="fin-panel-title"><div><h3>عملیات فروش و بانک</h3><p>کارهای کم‌تکرار به‌صورت مرحله‌ای باز می‌شوند تا صفحه روزمره شلوغ نشود.</p></div><span>کنترل‌شده</span></div>
      <div class="fin-action-stack">
      <details class="fin-action-details" ${unmatchedPayments.length ? 'open' : ''}><summary><span><strong>تطبیق تسویه کارتخوان و درگاه</strong><small>پرداخت‌ها ← ناخالص بچ ← کارمزد ← خالص بانک</small></span><em>${fa(unmatchedPayments.length)} پرداخت منتظر</em></summary><div id="fin-settlement-feedback"></div>
        <div class="fin-operation-layout">
          <form id="fin-settlement-form" class="fin-form" autocomplete="off">
            <label class="fin-field span-2"><span>پرداخت‌های داخل بچ</span><select name="paymentIds" multiple size="5" required>${unmatchedPayments.map((item) => `<option value="${esc(item.paymentId)}">${esc(item.details?.orderNo || `سفارش ${item.orderId}`)} · ${esc(label(item.payment?.tender))} · ${money(item.amountIrr)}</option>`).join('')}</select></label>
            <label class="fin-field"><span>PSP / درگاه</span><input name="psp" required maxlength="120" placeholder="مثلاً به‌پرداخت"></label>
            <label class="fin-field"><span>شناسه پایانه</span><input name="terminalId" required maxlength="120"></label>
            <label class="fin-field"><span>شماره بچ</span><input name="batchNo" required maxlength="120"></label>
            <label class="fin-field"><span>تاریخ تسویه</span><input name="settledAt" type="date" value="${today}" required></label>
            <label class="fin-field"><span>کارمزد (تومان)</span><input name="feeToman" inputmode="numeric" value="0" required></label>
            <label class="fin-field"><span>خالص واریزی بانک (تومان)</span><input name="bankAmountToman" inputmode="numeric" required></label>
            <label class="fin-field span-2"><span>شناسه واریز بانک</span><input name="bankReference" maxlength="160"></label>
            <button class="fin-btn primary span-2" type="submit" ${unmatchedPayments.length ? '' : 'disabled'}>کنترل، تطبیق و ثبت سند تسویه</button>
          </form>
          <div class="fin-operation-list"><div class="fin-subhead"><strong>بچ‌های V2</strong><span>${fa(settlementsV2.length)} مورد</span></div>
            ${settlementsV2.length ? settlementsV2.slice(0, 25).map((row) => `<article><div><strong>${esc(row.psp)} / ${esc(row.batchNo)}</strong><small>${dateTime(row.createdAt)} · بانک ${esc(row.bankReference || 'بدون شناسه')}</small></div><div>${statusBadge(row.status)}<b>${money(row.amountIrr)}</b></div></article>`).join('') : empty('بچ تسویهٔ V2 ثبت نشده است.')}
          </div>
        </div>
      </details>
      <details class="fin-action-details" ${unmatchedBankLines.length ? 'open' : ''}><summary><span><strong>تطبیق صورت‌حساب بانک با دفتر</strong><small>مدرک بانک ← کنترل مبلغ و جهت ← سند قطعی</small></span><em>${fa(unmatchedBankLines.length)} گردش منتظر</em></summary><div id="fin-bank-feedback"></div>
        <div class="fin-operation-layout">
          <form id="fin-bank-line-form" class="fin-form" autocomplete="off">
            <div class="fin-form-title span-2"><div><strong>ثبت گردش صورت‌حساب بانک</strong><small>این رکورد فقط مدرک بیرونی است و خودش سند حسابداری ایجاد نمی‌کند.</small></div>${statusBadge('unmatched')}</div>
            <label class="fin-field"><span>حساب بانکی</span><select name="bankAccountCode" required>${bankAccounts.map((account) => `<option value="${esc(account.code)}">${esc(account.code)} · ${esc(account.name)}</option>`).join('')}</select></label>
            <label class="fin-field"><span>نوع گردش</span><select name="direction" required><option value="inflow">واریز به بانک</option><option value="outflow">برداشت از بانک</option></select></label>
            <label class="fin-field"><span>تاریخ گردش</span><input name="occurredAt" type="date" value="${today}" required></label>
            <label class="fin-field"><span>مبلغ (تومان)</span><input name="amountToman" inputmode="numeric" required placeholder="۰"></label>
            <label class="fin-field span-2"><span>شناسه یکتای بانک</span><input name="bankReference" required maxlength="160" placeholder="شماره پیگیری / شناسه تراکنش"></label>
            <label class="fin-field span-2"><span>شرح صورت‌حساب</span><input name="description" maxlength="300" placeholder="شرح درج‌شده توسط بانک"></label>
            <button class="fin-btn primary span-2" type="submit" ${bankAccounts.length ? '' : 'disabled'}>ثبت در صف تطبیق</button>
          </form>
          <div class="fin-operation-list"><div class="fin-subhead"><strong>گردش‌های بانکی</strong><span>${fa(bankStatementLines.length)} مورد</span></div>
            ${bankStatementLines.length ? bankStatementLines.slice(0, 25).map((row) => {
              const exactCandidates = bankCandidates.filter((candidate) => candidate.accountCode === row.details?.bankAccountCode && candidate.direction === row.details?.direction && Number(candidate.amountIrr) === Number(row.amountIrr));
              return `<article class="stack"><div><strong>${esc(row.bankReference)}</strong><small>${dateTime(row.details?.occurredAt)} · ${esc(label(row.details?.direction))} · حساب ${esc(row.details?.bankAccountCode)}</small></div><div>${statusBadge(row.status)}<b>${money(row.amountIrr)}</b></div>
                ${row.status === 'unmatched' ? `<div class="fin-inline-action"><select data-fin-bank-candidate="${esc(row.id)}" aria-label="سند دفتر برای ${esc(row.bankReference)}"><option value="">${exactCandidates.length ? 'سند قطعی هم‌مبلغ را انتخاب کنید' : 'سند قطعی دقیق یافت نشد'}</option>${exactCandidates.map((candidate) => `<option value="${esc(candidate.journalEntryId)}">${esc(candidate.journalNumber)} · ${dateTime(candidate.occurredAt)} · ${esc(candidate.description)}</option>`).join('')}</select><button class="fin-btn secondary" type="button" data-fin-bank-match="${esc(row.id)}" ${exactCandidates.length ? '' : 'disabled'}>تطبیق دقیق</button></div>` : `<small>سند ${esc(row.matchedJournal?.number || row.details?.matchedJournalNumber || row.journalEntryId)} · تطبیق‌دهنده ${esc(row.matchedBy || 'ثبت نشده')}</small>`}
              </article>`;
            }).join('') : empty('گردش صورت‌حساب بانک ثبت نشده است؛ بدون مدرک بانک، وضعیت تطبیق ادعا نمی‌شود.')}
          </div>
        </div>
      </details>
      <details class="fin-action-details" ${refunds.some((row) => row.status === 'pending_approval') ? 'open' : ''}><summary><span><strong>برگشت وجه کنترل‌شده</strong><small>درخواست حسابدار ← تأیید مالک ← سند متناسب</small></span><em>بدون اثر خودکار موجودی</em></summary><div id="fin-operation-feedback"></div>
        <div class="fin-operation-layout">
          <form id="fin-refund-form" class="fin-form" autocomplete="off">
            <div class="fin-form-title span-2"><div><strong>درخواست برگشت وجه</strong><small>برای سفارش چندپرداختی، روش خروج وجه را دقیق انتخاب کنید.</small></div>${statusBadge('pending_approval')}</div>
            <label class="fin-field span-2"><span>پرداخت مبدأ</span><select name="paymentId" required><option value="">انتخاب کنید</option>${refundablePayments.map((payment) => {
              const remaining = Number(payment.amountIrr) - Number(payment.refundedIrr || 0);
              return `<option value="${esc(payment.id)}" data-order-id="${esc(payment.orderId)}">${esc(payment.payload?.orderNo || `سفارش ${payment.orderId}`)} · ${esc(label(payment.tender))} · مانده ${money(remaining)}</option>`;
            }).join('')}</select></label>
            <label class="fin-field"><span>تاریخ برگشت</span><input name="refundDate" type="date" value="${today}" required></label>
            <label class="fin-field"><span>مبلغ (تومان)</span><input name="amountToman" inputmode="numeric" required placeholder="۰"></label>
            <label class="fin-field span-2"><span>علت</span><input name="reason" required minlength="3" maxlength="300" placeholder="مثلاً لغو پس از پرداخت"></label>
            <div class="fin-note warning span-2"><strong>بازگشت فیزیکی جداست</strong><span>این عملیات موجودی یا COGS را تغییر نمی‌دهد؛ دریافت کالای برگشتی باید در انبار ثبت شود.</span></div>
            <button class="fin-btn primary span-2" type="submit" ${refundablePayments.length ? '' : 'disabled'}>ارسال برای تأیید مالک</button>
          </form>
          <div class="fin-operation-list"><div class="fin-subhead"><strong>درخواست‌های اخیر</strong><span>${fa(refunds.length)} مورد</span></div>
            ${refunds.length ? refunds.slice(0, 25).map((row) => `<article><div><strong>${esc(row.reason)}</strong><small>سفارش ${esc(row.orderId)} · ${dateTime(row.refundDate)}</small></div><div>${statusBadge(row.status)}<b>${money(row.amountIrr)}</b></div></article>`).join('') : empty('درخواست برگشت وجه‌ای در این محدوده ثبت نشده است.')}
          </div>
        </div>
      </details>
      </div></section>
      <section class="fin-panel"><div class="fin-panel-title"><div><h3>سفارش‌ها و وضعیت ثبت مالی</h3><p>فیلتر مشترک تاریخ و شعبه اعمال شده است.</p></div></div>
        ${table('sales-orders', [
          { label: 'سفارش', render: (row) => `<strong>${esc(row.orderNo || row.id)}</strong>` },
          { label: 'تاریخ', render: (row) => dateTime(row.createdAt) },
          { label: 'روش پرداخت', render: (row) => row.tenders?.length ? row.tenders.map((item) => statusBadge(label(item), 'neutral')).join(' ') : statusBadge('نامشخص', 'danger') },
          { label: 'مبلغ', render: (row) => `<strong>${money(row.amountIrr)}</strong>` },
          { label: 'ثبت مالی', render: (row) => statusBadge(row.financeStatus) },
        ], data.orders, 'سفارش پرداخت‌شده‌ای در این محدوده وجود ندارد.', data.pagination)}
      </section>`;
  }

  function renderPurchases(data) {
    const v2 = data.v2 || { purchaseOrders: [], goodsReceipts: [], vendorInvoices: [], supplierPayments: [] };
    const today = localIsoDate();
    const availablePoLines = (v2.purchaseOrders || []).flatMap((po) => ['approved', 'partially_received'].includes(po.status)
      ? (po.lines || []).filter((line) => Number(line.receivedQuantity || 0) < Number(line.quantity || 0)).map((line) => ({ po, line })) : []);
    const invoicedReceiptIds = new Set((v2.vendorInvoices || []).map((row) => row.goodsReceiptId));
    const availableReceiptLines = (v2.goodsReceipts || []).filter((grn) => !invoicedReceiptIds.has(grn.id)).flatMap((grn) => (grn.lines || []).map((line) => ({ grn, line })));
    const payableInvoices = (v2.vendorInvoices || []).filter((row) => ['open', 'partially_paid'].includes(row.status) && Number(row.totalIrr) > Number(row.paidAmountIrr || 0));
    const activeCostCommitments = (v2.costCommitments || []).filter((row) => row.status === 'active');
    const costAccruals = v2.costAccruals || [];
    const payableCostAccruals = costAccruals.filter((row) => ['posted', 'partially_paid'].includes(row.status) && Number(row.amountIrr) > Number(row.paidAmountIrr || 0));
    return `
      <section class="fin-section-head"><div><h2>خرید، هزینه و پرداختنی</h2><p>PO ← رسید کالا ← فاکتور ← تطبیق سه‌سویه ← پرداخت</p></div><button class="fin-btn secondary" type="button" data-fin-export="payables">خروجی CSV</button></section>
      <div class="fin-metrics">
        ${metric('سفارش خرید V2', fa(data.summary.v2PurchaseOrders), 'پیش‌نویس تا دریافت')}
        ${metric('فاکتور باز V2', fa(data.summary.v2OpenInvoices), `${fa(data.summary.matchExceptions)} اختلاف تطبیق`, data.summary.matchExceptions ? 'danger' : '')}
        ${metric('پرداختنی قابل اتکا', money(data.summary.v2PayableIrr), 'فقط فاکتورهای V2')}
        ${metric('پرداخت منتظر تأیید', fa(data.summary.pendingSupplierPayments), 'خروج وجه فقط پس از تأیید مالک', data.summary.pendingSupplierPayments ? 'warning' : '')}
      </div>
      <div class="fin-flow"><span>${fa(v2.purchaseOrders?.length || 0)} سفارش خرید</span><b>←</b><span>${fa(v2.goodsReceipts?.length || 0)} رسید کالا</span><b>←</b><span>${fa(v2.vendorInvoices?.length || 0)} فاکتور و تطبیق</span><b>←</b><span>${fa(v2.supplierPayments?.length || 0)} درخواست پرداخت</span></div>
      <section class="fin-panel fin-operations"><div class="fin-panel-title"><div><h3>میز عملیات خرید و پرداختنی</h3><p>هر مرحله فقط دادهٔ لازم همان کار را می‌گیرد؛ مبالغ UI تومان و ذخیره همیشه ریال است.</p></div><span>عملیاتی</span></div><div id="fin-operation-feedback"></div>
        <div class="fin-procurement-stack">
          <details class="fin-advanced" open><summary>۱. ایجاد سفارش خرید</summary>
            <form id="fin-po-form" class="fin-form fin-procurement-form" autocomplete="off">
              <label class="fin-field"><span>تأمین‌کننده</span><select name="vendorId" required><option value="">انتخاب کنید</option>${(data.vendors || []).map((row) => `<option value="${esc(row.id)}">${esc(row.nameFa || row.name || row.id)}</option>`).join('')}</select></label>
              <label class="fin-field"><span>ماده/کالا</span><select name="itemId" required><option value="">انتخاب کنید</option>${(data.inventoryItems || []).map((row) => `<option value="${esc(row.id)}" data-unit="${esc(row.unit || '')}">${esc(row.name || row.id)} · ${esc(row.unit || '')}</option>`).join('')}</select></label>
              <label class="fin-field"><span>مقدار</span><input name="quantity" inputmode="decimal" required></label>
              <label class="fin-field"><span>واحد</span><input name="unit" required placeholder="کیلوگرم / لیتر / عدد"></label>
              <label class="fin-field"><span>قیمت واحد (تومان)</span><input name="unitPriceToman" inputmode="numeric" required></label>
              <label class="fin-field"><span>تاریخ سفارش</span><input name="issueDate" type="date" value="${today}" required></label>
              <label class="fin-field span-2"><span>یادداشت</span><input name="notes" maxlength="300"></label>
              <label class="fin-check span-2"><input name="submitForApproval" type="checkbox" checked><span>پس از ذخیره برای تأیید مدیر/مالک ارسال شود</span></label>
              <button class="fin-btn primary span-2" type="submit">ثبت سفارش خرید</button>
            </form>
          </details>
          <details class="fin-advanced"><summary>۲. ثبت دریافت کالا (${fa(availablePoLines.length)} ردیف قابل دریافت)</summary>
            <form id="fin-grn-form" class="fin-form fin-procurement-form" autocomplete="off">
              <label class="fin-field span-2"><span>سفارش و ردیف</span><select name="poLine" required><option value="">انتخاب کنید</option>${availablePoLines.map(({ po, line }) => `<option value="${esc(po.id)}|${esc(line.id)}">${esc(po.number)} · ${esc(line.description)} · مانده ${fa(Number(line.quantity) - Number(line.receivedQuantity || 0))} ${esc(line.unit)}</option>`).join('')}</select></label>
              <label class="fin-field"><span>مقدار دریافت</span><input name="receivedQuantity" inputmode="decimal" required></label>
              <label class="fin-field"><span>شماره حواله تأمین‌کننده</span><input name="deliveryNoteNumber" maxlength="120"></label>
              <label class="fin-field"><span>تاریخ دریافت</span><input name="receivedDate" type="date" value="${today}" required></label>
              <button class="fin-btn primary" type="submit" ${availablePoLines.length ? '' : 'disabled'}>ثبت رسید و موجودی</button>
            </form>
          </details>
          <details class="fin-advanced"><summary>۳. ثبت فاکتور و تطبیق سه‌سویه (${fa(availableReceiptLines.length)} رسید)</summary>
            <form id="fin-invoice-form" class="fin-form fin-procurement-form" autocomplete="off">
              <label class="fin-field span-2"><span>رسید و ردیف</span><select name="receiptLine" required><option value="">انتخاب کنید</option>${availableReceiptLines.map(({ grn, line }) => `<option value="${esc(grn.id)}|${esc(line.id)}">${esc(grn.number)} · ${esc(line.itemId)} · ${fa(line.acceptedQuantity)} ${esc(line.unit)}</option>`).join('')}</select></label>
              <label class="fin-field"><span>شماره فاکتور</span><input name="invoiceNumber" required maxlength="120"></label>
              <label class="fin-field"><span>مقدار فاکتور</span><input name="invoicedQuantity" inputmode="decimal" required></label>
              <label class="fin-field"><span>قیمت واحد (تومان)</span><input name="unitPriceToman" inputmode="numeric" required></label>
              <label class="fin-field"><span>مالیات کل (تومان)</span><input name="vatToman" inputmode="numeric" value="0" required></label>
              <label class="fin-field"><span>تاریخ فاکتور</span><input name="invoiceDate" type="date" value="${today}" required></label>
              <button class="fin-btn primary" type="submit" ${availableReceiptLines.length ? '' : 'disabled'}>ثبت و تطبیق</button>
            </form>
          </details>
          <details class="fin-advanced"><summary>۴. درخواست پرداخت (${fa(payableInvoices.length)} فاکتور قابل پرداخت)</summary>
            <form id="fin-supplier-payment-form" class="fin-form fin-procurement-form" autocomplete="off">
              <label class="fin-field span-2"><span>فاکتور</span><select name="vendorInvoiceId" required><option value="">انتخاب کنید</option>${payableInvoices.map((row) => `<option value="${esc(row.id)}">${esc(row.invoiceNumber)} · مانده ${money(Number(row.totalIrr) - Number(row.paidAmountIrr || 0))}</option>`).join('')}</select></label>
              <label class="fin-field"><span>مبلغ (تومان)</span><input name="amountToman" inputmode="numeric" required></label>
              <label class="fin-field"><span>روش پرداخت</span><select name="paymentMethod"><option value="bank">بانک</option><option value="cash">نقد</option><option value="petty_cash">تنخواه</option></select></label>
              <label class="fin-field"><span>تاریخ پرداخت</span><input name="paymentDate" type="date" value="${today}" required></label>
              <label class="fin-field"><span>مرجع بانکی</span><input name="reference" maxlength="160"></label>
              <button class="fin-btn primary span-2" type="submit" ${payableInvoices.length ? '' : 'disabled'}>ارسال برای تأیید مالک</button>
            </form>
          </details>
        </div>
      </section>
      <section class="fin-panel fin-operations"><div class="fin-panel-title"><div><h3>اجاره، حقوق و هزینه‌های دوره‌ای</h3><p>تعریف یک‌بار، ثبت ماهانهٔ کنترل‌شده، تأیید مستقل و سپس پرداخت؛ بدون انتخاب آزاد حساب بدهکار/بستانکار.</p></div><span>متصل به Actual break-even</span></div>
        <div class="fin-metrics">
          ${metric('تعهد فعال', fa(data.summary.activeCostCommitments), 'اجاره، حقوق و هزینه جاری')}
          ${metric('مبلغ ماهانه تعریف‌شده', money(data.summary.committedMonthlyCostIrr), 'برنامه؛ تا ثبت دوره‌ای وارد GL نمی‌شود')}
          ${metric('ثبت منتظر تأیید', fa(data.summary.pendingCostAccruals), 'بدون تأیید وارد گزارش رسمی نمی‌شود', data.summary.pendingCostAccruals ? 'warning' : '')}
          ${metric('مانده هزینه پرداختنی', money(data.summary.accruedCostPayableIrr), 'فقط ثبت‌های قطعی دوره‌ای')}
        </div>
        <div class="fin-procurement-stack">
          <details class="fin-advanced" open><summary>۱. تعریف تعهد ماهانه</summary>
            <form id="fin-cost-commitment-form" class="fin-form fin-form-wide" autocomplete="off">
              <label class="fin-field"><span>عنوان</span><input name="name" required minlength="2" maxlength="160" placeholder="مثلاً اجاره شعبه اصلی"></label>
              <label class="fin-field"><span>نوع هزینه</span><select name="type" required>${(v2.costCommitmentTypes || []).map((type) => `<option value="${esc(type.id)}">${esc(type.label)} · حساب ${esc(type.expenseAccount)}</option>`).join('')}</select></label>
              <label class="fin-field"><span>مبلغ ماهانه (تومان)</span><input name="monthlyAmountToman" inputmode="numeric" required></label>
              <label class="fin-field"><span>شروع تعهد</span><input name="startDate" type="date" value="${today}" required></label>
              <label class="fin-field"><span>پایان اختیاری</span><input name="endDate" type="date"></label>
              <label class="fin-field"><span>طرف حساب اختیاری</span><input name="counterpartyId" maxlength="160" placeholder="مالک، پرسنل یا شرکت خدماتی"></label>
              <label class="fin-field span-2"><span>یادداشت</span><input name="notes" maxlength="300"></label>
              <button class="fin-btn primary" type="submit" ${(v2.costCommitmentTypes || []).length ? '' : 'disabled'}>ذخیره بدون اثر مالی</button>
            </form>
          </details>
          <details class="fin-advanced"><summary>۲. ایجاد ثبت ماهانه (${fa(activeCostCommitments.length)} تعهد فعال)</summary>
            <form id="fin-cost-accrual-form" class="fin-form fin-procurement-form" autocomplete="off">
              <label class="fin-field span-2"><span>تعهد</span><select name="costCommitmentId" required><option value="">انتخاب کنید</option>${activeCostCommitments.map((row) => `<option value="${esc(row.id)}">${esc(row.name)} · ${money(row.monthlyAmountIrr)}</option>`).join('')}</select></label>
              <label class="fin-field"><span>تاریخ ثبت</span><input name="postingDate" type="date" value="${today}" required></label>
              <label class="fin-field"><span>مبلغ واقعی دوره (اختیاری)</span><input name="amountToman" inputmode="numeric" placeholder="خالی = مبلغ تعهد"></label>
              <label class="fin-field span-2"><span>علت تغییر مبلغ</span><input name="overrideReason" maxlength="300" placeholder="اگر مبلغ واقعی با تعهد متفاوت است، علت الزامی است"></label>
              <div class="fin-note span-2"><strong>اثر حسابداری پس از تأیید</strong><span>بدهکار: حساب هزینهٔ کنترل‌شده · بستانکار: حقوق/هزینه پرداختنی. پرداخت وجه مرحله‌ای جدا دارد.</span></div>
              <button class="fin-btn primary span-2" type="submit" ${activeCostCommitments.length ? '' : 'disabled'}>ارسال ثبت دوره‌ای برای تأیید</button>
            </form>
          </details>
          <details class="fin-advanced"><summary>۳. درخواست پرداخت هزینه (${fa(payableCostAccruals.length)} مانده قطعی)</summary>
            <form id="fin-cost-payment-form" class="fin-form fin-procurement-form" autocomplete="off">
              <label class="fin-field span-2"><span>ثبت قطعی</span><select name="costAccrualId" required><option value="">انتخاب کنید</option>${payableCostAccruals.map((row) => `<option value="${esc(row.id)}">${esc(row.commitment?.name || row.id)} · مانده ${money(Number(row.amountIrr) - Number(row.paidAmountIrr || 0))}</option>`).join('')}</select></label>
              <label class="fin-field"><span>مبلغ پرداخت (تومان)</span><input name="amountToman" inputmode="numeric" required></label>
              <label class="fin-field"><span>روش پرداخت</span><select name="paymentMethod"><option value="bank">بانک</option><option value="cash">نقد</option><option value="petty_cash">تنخواه</option></select></label>
              <label class="fin-field"><span>تاریخ پرداخت</span><input name="paymentDate" type="date" value="${today}" required></label>
              <label class="fin-field"><span>مرجع پرداخت</span><input name="reference" maxlength="160"></label>
              <button class="fin-btn primary span-2" type="submit" ${payableCostAccruals.length ? '' : 'disabled'}>ارسال پرداخت برای تأیید مالک</button>
            </form>
          </details>
        </div>
        <div class="fin-grid-2">
          <div class="fin-operation-list"><div class="fin-subhead"><strong>تعهدها</strong><span>${fa(v2.costCommitments?.length || 0)} مورد</span></div>
            ${(v2.costCommitments || []).length ? v2.costCommitments.map((row) => `<article><div><strong>${esc(row.name)}</strong><small>${esc((v2.costCommitmentTypes || []).find((type) => type.id === row.type)?.label || row.type)} · از ${dateOnly(row.startDate)}</small></div><div>${statusBadge(row.status, row.status === 'active' ? 'success' : 'neutral')}<b>${money(row.monthlyAmountIrr)}</b>${row.status === 'active' ? `<button class="fin-btn secondary" type="button" data-fin-deactivate-cost="${esc(row.id)}">غیرفعال</button>` : ''}</div></article>`).join('') : empty('تعهد ماهانه‌ای تعریف نشده است.')}
          </div>
          <div class="fin-operation-list"><div class="fin-subhead"><strong>ثبت‌های دوره‌ای</strong><span>${fa(costAccruals.length)} مورد</span></div>
            ${costAccruals.length ? costAccruals.map((row) => `<article><div><strong>${esc(row.commitment?.name || row.id)}</strong><small>${dateTime(row.postingDate)} · سند ${esc(row.journalEntry?.number || 'در انتظار')}</small></div><div>${statusBadge(row.status, ['posted', 'paid'].includes(row.status) ? 'success' : row.status === 'rejected' ? 'danger' : 'warning')}<b>${money(row.amountIrr)}</b></div></article>`).join('') : empty('ثبت دوره‌ای هزینه ایجاد نشده است.')}
          </div>
        </div>
      </section>
      <section class="fin-panel"><div class="fin-panel-title"><div><h3>زنجیره خرید V2</h3><p>وضعیت و اقدام بعدی هر پرونده</p></div></div>
        ${table('v2-purchase-orders', [
          { label: 'شماره', render: (row) => `<strong>${esc(row.number)}</strong>` },
          { label: 'تأمین‌کننده', render: (row) => esc((data.vendors || []).find((vendor) => String(vendor.id) === String(row.vendorId))?.nameFa || row.vendorId) },
          { label: 'مبلغ', render: (row) => money(row.totalIrr) },
          { label: 'وضعیت', render: (row) => statusBadge(row.status, row.status === 'received' ? 'success' : row.status === 'rejected' ? 'danger' : 'warning') },
          { label: 'اقدام', render: (row) => row.status === 'draft' ? `<button class="fin-btn secondary" type="button" data-fin-submit-po="${esc(row.id)}">ارسال برای تأیید</button>` : '—' },
        ], v2.purchaseOrders, 'هنوز سفارش خرید V2 ثبت نشده است.')}
      </section>
      <section class="fin-panel"><div class="fin-panel-title"><div><h3>فاکتور و پرداخت</h3><p>اختلاف تطبیق قبل از ایجاد بدهی و پرداخت متوقف می‌شود.</p></div></div>
        ${table('v2-invoices', [
          { label: 'فاکتور', render: (row) => `<strong>${esc(row.invoiceNumber)}</strong>` },
          { label: 'مبلغ', render: (row) => money(row.totalIrr) },
          { label: 'مانده', render: (row) => money(Number(row.totalIrr) - Number(row.paidAmountIrr || 0)) },
          { label: 'تطبیق', render: (row) => statusBadge(row.matchStatus, row.matchStatus === 'matched' ? 'success' : 'danger') },
          { label: 'وضعیت', render: (row) => statusBadge(row.status, row.status === 'paid' ? 'success' : row.status === 'match_exception' ? 'danger' : 'warning') },
        ], v2.vendorInvoices, 'هنوز فاکتور V2 ثبت نشده است.')}
      </section>
      <div class="fin-note warning"><strong>دادهٔ میراثی فقط برای بررسی است</strong><span>${fa(data.purchaseOrders?.length || 0)} سفارش خرید، ${fa(data.goodsReceipts?.length || 0)} رسید و ${fa(data.bills?.length || 0)} فاکتور تاریخی وارد دفتر V2 نشده‌اند؛ حذف یا تبدیل کور انجام نمی‌شود.</span></div>
      <details class="fin-advanced"><summary>تأمین‌کنندگان و مانده‌های تاریخی</summary><section class="fin-legacy-table">
        ${table('vendors', [
          { label: 'تأمین‌کننده', render: (row) => `<strong>${esc(row.nameFa || row.name || row.id)}</strong>` },
          { label: 'دسته', render: (row) => esc(row.category || 'ثبت نشده') },
          { label: 'مهلت', render: (row) => row.termsDays == null ? 'ثبت نشده' : `${fa(row.termsDays)} روز` },
          { label: 'ماندهٔ تاریخی', render: (row) => money(Number(row.balance || 0) * 10) },
          { label: 'اعتماد', render: () => statusBadge('نیازمند تأیید', 'warning') },
        ], data.vendors, 'تأمین‌کننده‌ای ثبت نشده است.')}
      </section></details>`;
  }

  function renderCosting(data) {
    const intelligence = data.intelligence || {};
    const capacities = intelligence.recipeCapacity || [];
    const stockout = intelligence.stockoutForecast || { status: 'insufficient_data', items: [] };
    const stockoutActions = data.stockoutActions || [];
    const profitability = data.itemProfitability || { status: 'insufficient_data', rows: [] };
    const actualBreakEven = data.actualBreakEven || { status: 'insufficient_data', missing: [] };
    const plannedBreakEven = data.plannedBreakEven || { status: 'insufficient_data', missing: [] };
    return `
      <section class="fin-section-head"><div><h2>بهای تمام‌شده و انبار</h2><p>واقعیت عملیاتی در آشپزخانه/انبار ثبت می‌شود؛ اینجا اثر مالی و مغایرت دیده می‌شود.</p></div><button class="fin-btn secondary" type="button" data-fin-export="costing">خروجی CSV</button></section>
      <div class="fin-metrics">
        ${metric('اقلام انبار', fa(data.summary.inventoryItems), 'منبع: inventoryItems')}
        ${metric('رسپی', fa(data.summary.recipes), `${fa(data.summary.unversionedRecipes)} بدون نسخه`, data.summary.unversionedRecipes ? 'warning' : '')}
        ${metric('گردش V2 انبار', fa(data.summary.shadowMovements), 'فروش، ضایعات، شمارش و تولید')}
        ${metric('رویداد ضایعات میراثی', fa(data.summary.wasteEvents), 'فقط برای بررسی؛ ثبت جدید در پنل آشپزخانه')}
      </div>
      <div class="fin-grid-2">
        <section class="fin-panel"><div class="fin-panel-title"><div><h3>COGS نظری</h3><p>رسپی نسخه‌دار × قیمت معتبر مواد</p></div>${statusBadge(data.theoreticalCogs.status, data.theoreticalCogs.amountIrr == null ? 'warning' : 'success')}</div>${data.theoreticalCogs.amountIrr == null ? empty('تا نسخه‌بندی رسپی و تکمیل قیمت معتبر، مبلغ نظری محاسبه نمی‌شود.') : `<strong>${money(data.theoreticalCogs.amountIrr)}</strong>`}</section>
        <section class="fin-panel"><div class="fin-panel-title"><div><h3>مصرف واقعی</h3><p>بر مبنای گردش و شمارش انبار</p></div>${statusBadge(data.actualConsumption.status, data.actualConsumption.amountIrr == null ? 'warning' : 'success')}</div>${data.actualConsumption.amountIrr == null ? empty('تاریخچه برای محاسبهٔ مبلغ مصرف واقعی کافی نیست.') : `<strong>${money(data.actualConsumption.amountIrr)}</strong>`}</section>
      </div>
      <section class="fin-panel"><div class="fin-panel-title"><div><h3>کیفیت دادهٔ هزینه</h3><p>پیش‌نیاز گزارش سودآوری منو</p></div></div>
        <div class="fin-check-grid"><article class="${data.summary.invalidCostItems ? 'danger' : 'success'}"><strong>قیمت نامعتبر مواد</strong><span>${fa(data.summary.invalidCostItems)}</span></article><article class="${data.summary.unversionedRecipes ? 'warning' : 'success'}"><strong>رسپی بدون نسخه</strong><span>${fa(data.summary.unversionedRecipes)}</span></article></div>
      </section>
      <section class="fin-panel"><div class="fin-panel-title"><div><h3>سودآوری آیتم‌های فروخته‌شده</h3><p>فروش snapshot سفارش منهای بهای نظری همان نسخهٔ رسپی؛ بدون حدس‌زدن هزینه.</p></div>${statusBadge(profitability.status, profitability.status === 'snapshot_backed' ? 'success' : profitability.status === 'partial_coverage' ? 'warning' : 'neutral')}</div>
        ${table('item-profitability', [
          { label: 'آیتم', render: (row) => `<strong>${esc(row.name)}</strong>` },
          { label: 'تعداد', render: (row) => fa(row.quantity) },
          { label: 'فروش خالص snapshot', render: (row) => money(row.netSalesIrr) },
          { label: 'COGS نظری', render: (row) => money(row.theoreticalCogsIrr) },
          { label: 'حاشیه مشارکت', render: (row) => `<strong>${money(row.contributionIrr)}</strong>` },
          { label: 'درصد', render: (row) => row.contributionMarginPercent == null ? '—' : `${fa(row.contributionMarginPercent)}٪` },
          { label: 'اقدام', render: (row) => statusBadge(row.action === 'stop_and_review' ? 'توقف و بازبینی' : row.action === 'review_cost_or_price' ? 'بازبینی قیمت/رسپی' : 'پایش', row.action === 'stop_and_review' ? 'danger' : row.action === 'review_cost_or_price' ? 'warning' : 'success') },
        ], profitability.rows, 'تا فروش دارای رسپی نسخه‌دار و قیمت معتبر ثبت نشود، سودآوری آیتم نمایش داده نمی‌شود.')}
        ${profitability.refundCountNotAllocated ? `<div class="fin-note warning"><strong>نتیجه رسمی نیست</strong><span>${fa(profitability.refundCountNotAllocated)} بازپرداخت در سطح پرداخت ثبت شده و به ردیف منو تخصیص ندارد؛ سود آیتم‌ها عمداً partial باقی مانده است.</span></div>` : ''}
      </section>
      <section class="fin-panel"><div class="fin-panel-title"><div><h3>ظرفیت قابل فروش رسپی‌ها</h3><p>کمینهٔ موجودی قابل مصرف هر ماده ÷ مصرف هر پرس؛ رزرو، قرنطینه و افت رسپی لحاظ می‌شود.</p></div><span>${fa(capacities.filter((row) => row.status === 'available').length)} رسپی قابل محاسبه</span></div>
        ${table('recipe-capacity', [
          { label: 'رسپی', render: (row) => `<strong>${esc(row.name)}</strong>` },
          { label: 'نسخه', render: (row) => esc(row.version || 'ثبت نشده') },
          { label: 'ظرفیت فعلی', render: (row) => row.capacity == null ? 'داده کافی نیست' : `<strong>${fa(row.capacity)} پرس</strong>` },
          { label: 'ماده محدودکننده', render: (row) => esc(row.limitingIngredient?.name || 'قابل تعیین نیست') },
          { label: 'کیفیت', render: (row) => statusBadge(row.status, row.status === 'available' ? 'success' : 'warning') },
        ], capacities, 'رسپی معتبر و قابل اتصال به موجودی ثبت نشده است.')}
      </section>
      <section class="fin-panel"><div class="fin-panel-title"><div><h3>پیش‌بینی اتمام موجودی</h3><p>فقط از سفارش پرداخت‌شده، نسخه رسپی و حداقل ۱۴ روز تاریخچه استفاده می‌کند.</p></div>${statusBadge(stockout.status, stockout.status === 'available' ? 'success' : stockout.status === 'partial_coverage' ? 'warning' : 'neutral')}</div>
        ${stockout.status === 'insufficient_data' ? empty(`تاریخچهٔ معتبر ${fa(stockout.historyDays || 0)} روز است؛ حداقل ${fa(stockout.minimumHistoryDays || 14)} روز و پوشش رسپی لازم است.`) : table('stockout', [
          { label: 'ماده', render: (row) => `<strong>${esc(row.name)}</strong>` },
          { label: 'موجودی قابل مصرف', render: (row) => `${fa(Math.round(row.availableQuantity * 100) / 100)} ${esc(row.unit)}` },
          { label: 'مصرف روزانه', render: (row) => `${fa(Math.round(row.averageDailyUsage * 100) / 100)} ${esc(row.unit)}` },
          { label: 'روز باقی‌مانده', render: (row) => `<strong>${fa(Math.round(row.daysRemaining * 10) / 10)}</strong>` },
          { label: 'تاریخ احتمالی اتمام', render: (row) => window.ShamsiCore ? window.ShamsiCore.formatShamsiDate(row.forecastDate) : esc(row.forecastDate) },
          { label: 'اقدام سفارش', render: (row) => row.actionStatus === 'lead_time_missing' ? statusBadge('زمان تأمین ثبت نشده', 'warning') : `${statusBadge(row.actionStatus === 'order_now' ? 'سفارش امروز' : 'زمان‌بندی‌شده', row.actionStatus === 'order_now' ? 'danger' : 'success')}<small>${row.reorderByDate ? ` تا ${window.ShamsiCore ? window.ShamsiCore.formatShamsiDate(row.reorderByDate) : esc(row.reorderByDate)} · ${fa(row.suggestedOrderQuantity)} ${esc(row.unit)}` : ''}</small>` },
          { label: 'اولویت', render: (row) => statusBadge(row.urgency, row.urgency === 'critical' ? 'danger' : row.urgency === 'warning' ? 'warning' : 'success') },
        ], stockoutActions, 'ماده‌ای با مصرف روزانهٔ قابل اتکا یافت نشد.')}
        ${stockout.recipeCoveragePercent == null ? '' : `<div class="fin-note"><strong>پوشش رسپی سفارش‌ها</strong><span>${fa(stockout.recipeCoveragePercent)}٪ خطوط فروش</span></div>`}
      </section>
      <section class="fin-panel"><div class="fin-panel-title"><div><h3>نقطهٔ سربه‌سر برنامه‌ای از تعهدها</h3><p>تعهد فعال اجاره و حقوق + حاشیه مشارکت اسناد قطعی؛ با Actual مخلوط نمی‌شود.</p></div>${statusBadge(plannedBreakEven.status, plannedBreakEven.status === 'available' ? 'success' : 'neutral')}</div>
        ${plannedBreakEven.breakEvenSalesIrr == null ? empty(`برای برنامه، تعهد ثابت و فروش/هزینه متغیر قطعی لازم است: ${(plannedBreakEven.missing || []).map(label).join('، ') || 'داده کافی نیست'}.`) : `<div class="fin-result-grid">
          ${metric('تعهد ثابت ماهانه', money(plannedBreakEven.committedFixedCostIrr), `${fa(plannedBreakEven.commitmentCount)} تعهد فعال`)}
          ${metric('حاشیه مشارکت مبنا', `${fa(Math.round(plannedBreakEven.contributionMarginRatio * 10000) / 100)}٪`, 'فقط فروش و هزینه متغیر قطعی')}
          ${metric('فروش سربه‌سر برنامه', money(plannedBreakEven.breakEvenSalesIrr), 'منبع: تعهدهای فعال + GL')}
          ${metric('فاصله برنامه', money(plannedBreakEven.gapIrr), plannedBreakEven.gapIrr ? 'فروش بیشتر لازم است' : 'پوشش داده شده', plannedBreakEven.gapIrr ? 'danger' : 'success')}
        </div>`}
      </section>
      <section class="fin-panel"><div class="fin-panel-title"><div><h3>نقطهٔ سربه‌سر واقعی از دفتر</h3><p>فقط سندهای قطعی طبقه‌بندی‌شده؛ تعهد ثبت‌نشده وارد Actual نمی‌شود.</p></div>${statusBadge(actualBreakEven.status, actualBreakEven.status === 'available' ? 'success' : actualBreakEven.status === 'partial_coverage' ? 'warning' : 'neutral')}</div>
        ${actualBreakEven.breakEvenSalesIrr == null ? empty(`دادهٔ قطعی لازم کامل نیست: ${(actualBreakEven.missing || []).map(label).join('، ') || 'فروش، هزینه متغیر یا هزینه ثابت'}.`) : `<div class="fin-result-grid">
          ${metric('فروش خالص قطعی', money(actualBreakEven.netSalesIrr), 'منبع: خطوط قطعی دفتر')}
          ${metric('هزینه ثابت قطعی', money(actualBreakEven.fixedCostIrr), 'حقوق + اجاره')}
          ${metric('هزینه متغیر قطعی', money(actualBreakEven.variableCostIrr), 'مواد اولیه و COGS')}
          ${metric('فروش سربه‌سر', money(actualBreakEven.breakEvenSalesIrr), `پوشش طبقه‌بندی هزینه ${fa(actualBreakEven.coveragePercent)}٪`, actualBreakEven.status === 'available' ? 'success' : 'warning')}
          ${metric('فاصله تا سربه‌سر', money(actualBreakEven.gapIrr), actualBreakEven.gapIrr ? 'نیازمند فروش بیشتر' : 'پوشش داده شده', actualBreakEven.gapIrr ? 'danger' : 'success')}
        </div>`}
        ${(actualBreakEven.unclassified || []).length ? `<div class="fin-note warning"><strong>این نتیجه رسمی نیست</strong><span>${fa(actualBreakEven.unclassified.length)} ردیف هزینه هنوز ثابت/متغیر طبقه‌بندی نشده است؛ از محاسبه حذف نشده‌نمایی نمی‌شود و وضعیت partial می‌ماند.</span></div>` : ''}
      </section>
      <section class="fin-panel"><div class="fin-panel-title"><div><h3>پیش‌نمایش نقطهٔ سربه‌سر</h3><p>اجاره، حقوق و سایر هزینه‌های ثابت در برابر فروش و هزینهٔ متغیر؛ نتیجه ذخیره نمی‌شود.</p></div><span>موتور قواعد قابل‌ردیابی</span></div>
        <form id="fin-break-even-form" class="fin-form fin-form-wide" autocomplete="off">
          <label class="fin-field"><span>اجاره ماهانه (تومان)</span><input name="rentToman" inputmode="numeric" value="0" required></label>
          <label class="fin-field"><span>حقوق ماهانه (تومان)</span><input name="payrollToman" inputmode="numeric" value="0" required></label>
          <label class="fin-field"><span>سایر هزینه ثابت (تومان)</span><input name="otherFixedToman" inputmode="numeric" value="0" required></label>
          <label class="fin-field"><span>فروش خالص دوره (تومان)</span><input name="salesToman" inputmode="numeric" required></label>
          <label class="fin-field"><span>هزینه متغیر همان فروش (تومان)</span><input name="variableCostToman" inputmode="numeric" required></label>
          <label class="fin-field"><span>روز کاری باقی‌مانده</span><input name="remainingOpenDays" type="number" min="1" max="366"></label>
          <button class="fin-btn primary" type="submit">محاسبه نقطهٔ سربه‌سر</button>
        </form>
        <div id="fin-break-even-result" class="fin-preview-result">${intelligence.breakEven?.status === 'available' ? '' : empty('مبالغ میراثی مبهم خودکار تبدیل نمی‌شوند؛ ارقام تأییدشده را برای پیش‌نمایش وارد کنید.')}</div>
      </section>
      <div class="fin-note"><strong>مسیر ثبت عملیاتی</strong><span>ضایعات، دریافت کالا و شمارش موجودی از پنل آشپز/انبار انجام می‌شود؛ حسابدار مبلغ یا حساب را برای آشپز انتخاب نمی‌کند.</span></div>`;
  }

  function renderLedger(data) {
    const checks = data.closeChecklist || [];
    const reports = data.reports || {};
    const trial = reports.trialBalance || { rows: [], status: 'insufficient_data', debitIrr: 0, creditIrr: 0, differenceIrr: 0 };
    const pnl = reports.profitAndLoss || { status: 'insufficient_data', revenueIrr: 0, cogsIrr: 0, operatingExpenseIrr: 0, netProfitIrr: 0 };
    const balance = reports.balanceSheet || { status: 'insufficient_data', assetsIrr: 0, liabilitiesIrr: 0, equityIrr: 0, equationDifferenceIrr: 0 };
    const cashFlow = reports.cashFlow || { status: 'insufficient_data', operatingIrr: 0, investingIrr: 0, financingIrr: 0, unclassifiedIrr: 0, netChangeIrr: 0 };
    const fixedAssets = data.fixedAssets || [];
    const depreciationRuns = data.depreciationRuns || [];
    const depreciationPreview = data.depreciationPreview || { status: 'insufficient_data', lines: [], totalDepreciationIrr: 0 };
    const assetPolicies = data.assetPolicies || { categories: [], fundingMethods: [] };
    const payrollRuns = data.payrollRuns || [];
    const payrollPayments = data.payrollPayments || [];
    const payrollPolicies = data.payrollPolicies || { liabilityTypes: [] };
    const openingBalanceBatches = data.openingBalanceBatches || [];
    const openingBalanceAccounts = data.openingBalanceAccounts || [];
    const activeOpeningBalance = openingBalanceBatches.find((batch) => ['pending_approval', 'posted'].includes(batch.status));
    const today = localIsoDate();
    const openingDate = data.selectedPeriod?.startDate || today;
    const openingOptionMarkup = (selectedCode) => openingBalanceAccounts.map((account) => `<option value="${esc(account.code)}" ${account.code === selectedCode ? 'selected' : ''}>${esc(account.code)} · ${esc(account.name)}</option>`).join('');
    const openingRowMarkup = (accountCode, side) => `<div class="fin-opening-row" data-fin-opening-row>
      <label class="fin-field"><span>حساب تفصیلی</span><select name="openingAccount" required>${openingOptionMarkup(accountCode)}</select></label>
      <label class="fin-field"><span>ماهیت این مانده</span><select name="openingSide"><option value="debit" ${side === 'debit' ? 'selected' : ''}>بدهکار</option><option value="credit" ${side === 'credit' ? 'selected' : ''}>بستانکار</option></select></label>
      <label class="fin-field"><span>مبلغ (تومان)</span><input name="openingAmountToman" inputmode="numeric" required></label>
      <label class="fin-field"><span>شرح ردیف</span><input name="openingMemo" maxlength="300"></label>
      <button class="fin-icon-btn" type="button" data-fin-remove-opening-row aria-label="حذف ردیف">×</button>
    </div>`;
    const defaultOpeningRows = [
      ['1210', 'debit'], ['1610', 'debit'], ['2110', 'credit'], ['3100', 'credit'],
    ].filter(([code]) => openingBalanceAccounts.some((account) => account.code === code));
    const activeAssets = fixedAssets.filter((asset) => asset.status === 'active');
    const assetBookValueIrr = activeAssets.reduce((sum, asset) => sum + Math.max(0, Number(asset.purchaseCostIrr) - Number(asset.accumulatedDepreciationIrr || 0)), 0);
    const payablePayrollRuns = payrollRuns.filter((run) => ['posted', 'partially_paid'].includes(run.status));
    const payrollLiabilityIrr = payrollRuns.filter((run) => ['posted', 'partially_paid', 'paid'].includes(run.status)).reduce((sum, run) => sum + Object.values(run.liabilities || {}).reduce((part, amount) => part + Number(amount || 0), 0), 0);
    const payrollPaidIrr = payrollRuns.reduce((sum, run) => sum + Object.values(run.paidByLiability || {}).reduce((part, amount) => part + Number(amount || 0), 0), 0);
    return `
      <section class="fin-section-head"><div><h2>دفاتر، گزارش‌ها و پایان دوره</h2><p>دفتر کل، تراز و صورت‌های مالی فقط از سند قطعی V2.</p></div><button class="fin-btn secondary" type="button" data-fin-export="ledger">خروجی CSV</button></section>
      <div class="fin-metrics">
        ${metric('اسناد V2', fa(data.entries?.length || 0), 'پیش‌نویس، منتظر و قطعی')}
        ${metric('جمع بدهکار قطعی', money(data.snapshot.ledger.debitIrr), 'منبع: financeV2.journalEntries')}
        ${metric('جمع بستانکار قطعی', money(data.snapshot.ledger.creditIrr), 'منبع: financeV2.journalEntries')}
        ${metric('اختلاف فروش و دفتر', money(data.snapshot.reconciliation.salesDifferenceIrr), 'مانع بستن دوره', data.snapshot.reconciliation.salesDifferenceIrr ? 'danger' : 'success')}
      </div>
      <section class="fin-panel fin-operations"><div class="fin-panel-title"><div><h3>مانده افتتاحیه کنترل‌شده</h3><p>مانده‌های بانک، صندوق، موجودی، بدهی و سرمایه را یک‌بار و با سند متوازن وارد کنید؛ حساب جبرانی خودکار ساخته نمی‌شود.</p></div><span>عملیات دفتر V2</span></div>
        <div class="fin-metrics">
          ${metric('بچ‌های افتتاحیه', fa(openingBalanceBatches.length), activeOpeningBalance ? `وضعیت فعال: ${label(activeOpeningBalance.status)}` : 'بچ فعال وجود ندارد')}
          ${metric('حساب مجاز', fa(openingBalanceAccounts.length), 'فقط حساب تفصیلی ترازنامه')}
          ${metric('قاعده توازن', 'صفر', 'اختلاف بدهکار و بستانکار باید صفر باشد')}
          ${metric('روش اصلاح', 'سند معکوس', 'ویرایش یا حذف سند قطعی ممنوع است')}
        </div>
        <details class="fin-advanced" ${activeOpeningBalance ? '' : 'open'}><summary>پیش‌نمایش و ارسال مانده افتتاحیه</summary>
          <form id="fin-opening-balance-form" class="fin-form fin-opening-form" autocomplete="off">
            <label class="fin-field"><span>تاریخ افتتاحیه</span><input name="asOfDate" type="date" value="${openingDate}" required></label>
            <label class="fin-field span-2"><span>مرجع صورت‌مانده / صورتجلسه</span><input name="sourceReference" required minlength="3" maxlength="160" placeholder="مثلاً TB-OPEN-1405"></label>
            <div class="fin-opening-lines span-all" data-fin-opening-lines>
              ${(defaultOpeningRows.length >= 2 ? defaultOpeningRows : openingBalanceAccounts.slice(0, 2).map((account) => [account.code, account.normalSide])).map(([code, side]) => openingRowMarkup(code, side)).join('')}
            </div>
            <div class="fin-opening-actions span-all">
              <button class="fin-btn secondary" type="button" data-fin-add-opening-row ${openingBalanceAccounts.length ? '' : 'disabled'}>افزودن ردیف</button>
              <button class="fin-btn secondary" type="button" data-fin-opening-preview ${activeOpeningBalance || openingBalanceAccounts.length < 2 ? 'disabled' : ''}>فقط کنترل و پیش‌نمایش</button>
              <button class="fin-btn primary" type="submit" ${activeOpeningBalance || openingBalanceAccounts.length < 2 || data.periodSource !== 'finance_v2' ? 'disabled' : ''}>ارسال برای تأیید مستقل مالک</button>
            </div>
          </form>
          <div id="fin-opening-preview-result" class="fin-preview-result">${activeOpeningBalance
            ? `<div class="fin-note warning"><strong>ثبت جدید متوقف است</strong><span>بچ ${esc(activeOpeningBalance.id)} در وضعیت ${esc(label(activeOpeningBalance.status))} است. برای اصلاح ثبت قطعی فقط سند معکوس بزنید.</span></div>`
            : data.periodSource !== 'finance_v2'
              ? `<div class="fin-note warning"><strong>ابتدا دوره مالی V2 بسازید</strong><span>مانده افتتاحیه به دورهٔ میراثی یا فرضی پست نمی‌شود.</span></div>`
              : empty('پیش‌نمایش هیچ داده‌ای ذخیره نمی‌کند و هیچ رقم جبرانی حدس نمی‌زند.')}</div>
        </details>
        <div class="fin-operation-list"><div class="fin-subhead"><strong>تاریخچه مانده افتتاحیه</strong><span>${fa(openingBalanceBatches.length)} مورد</span></div>
          ${openingBalanceBatches.length ? openingBalanceBatches.map((batch) => `<article><div><strong>${dateOnly(batch.asOfDate)} · ${esc(batch.sourceReference)}</strong><small>سند ${esc(batch.journalEntry?.number || 'در انتظار')} · ${fa(batch.lines?.length || 0)} ردیف</small></div><div>${statusBadge(batch.status, batch.status === 'posted' ? 'success' : batch.status === 'rejected' ? 'danger' : batch.status === 'reversed' ? 'neutral' : 'warning')}<b>${money(batch.debitIrr)}</b>${batch.status === 'posted' ? `<button class="fin-btn secondary" type="button" data-fin-reverse-opening="${esc(batch.journalEntryId)}">سند معکوس</button>` : ''}</div></article>`).join('') : empty('هنوز مانده افتتاحیه‌ای ثبت نشده است.')}
        </div>
      </section>
      <section class="fin-panel fin-operations"><div class="fin-panel-title"><div><h3>دارایی ثابت و استهلاک ماهانه</h3><p>خرید و استهلاک قبل از قطعی‌شدن preview و تأیید مستقل دارند؛ مسیر قدیمی تکرارپذیر فقط خواندنی است.</p></div><span>عملیات پیشرفته V2</span></div>
        <div class="fin-metrics">
          ${metric('دارایی فعال V2', fa(activeAssets.length), `${fa(fixedAssets.filter((asset) => asset.status === 'pending_approval').length)} منتظر تأیید`)}
          ${metric('ارزش دفتری V2', money(assetBookValueIrr), 'بهای خرید منهای استهلاک انباشته')}
          ${metric('استهلاک پیشنهادی ماه', money(depreciationPreview.totalDepreciationIrr), depreciationPreview.status === 'available' ? `${fa(depreciationPreview.lines.length)} دارایی` : 'داده یا دارایی واجد شرایط نیست')}
          ${metric('دارایی میراثی قرنطینه', fa(data.legacyAssets?.count || 0), 'وارد ثبت رسمی V2 نشده', data.legacyAssets?.count ? 'warning' : '')}
        </div>
        <div class="fin-procurement-stack">
          <details class="fin-advanced" open><summary>۱. ثبت خرید دارایی</summary>
            <form id="fin-fixed-asset-form" class="fin-form fin-form-wide" autocomplete="off">
              <label class="fin-field"><span>کد دارایی</span><input name="assetCode" required pattern="[A-Za-z0-9_-]{3,40}" maxlength="40" placeholder="AST-ESP-01" dir="ltr"></label>
              <label class="fin-field span-2"><span>نام دارایی</span><input name="name" required minlength="2" maxlength="160" placeholder="مثلاً دستگاه اسپرسوساز"></label>
              <label class="fin-field"><span>گروه</span><select name="category" required>${assetPolicies.categories.map((row) => `<option value="${esc(row.id)}">${esc(row.label)} · ${esc(row.accountCode)}</option>`).join('')}</select></label>
              <label class="fin-field"><span>روش پرداخت</span><select name="fundingMethod" required>${assetPolicies.fundingMethods.map((row) => `<option value="${esc(row.id)}">${esc(row.label)}</option>`).join('')}</select></label>
              <label class="fin-field"><span>مرجع خرید</span><input name="sourceReference" required minlength="3" maxlength="160" placeholder="شماره فاکتور یا قرارداد"></label>
              <label class="fin-field"><span>بهای خرید (تومان)</span><input name="purchaseCostToman" inputmode="numeric" required></label>
              <label class="fin-field"><span>ارزش اسقاط (تومان)</span><input name="salvageValueToman" inputmode="numeric" value="0" required></label>
              <label class="fin-field"><span>عمر مفید (ماه)</span><input name="usefulLifeMonths" inputmode="numeric" value="60" required></label>
              <label class="fin-field"><span>تاریخ خرید</span><input name="purchaseDate" type="date" value="${today}" required></label>
              <label class="fin-field"><span>شروع بهره‌برداری</span><input name="inServiceDate" type="date" value="${today}" required></label>
              <div class="fin-note span-2"><strong>اثر پس از تأیید مالک</strong><span>بدهکار: حساب کنترل‌شدهٔ گروه دارایی · بستانکار: بانک/صندوق. تا قبل از تأیید، دارایی فعال و سند قطعی نمی‌شود.</span></div>
              <button class="fin-btn primary span-2" type="submit" ${assetPolicies.categories.length && assetPolicies.fundingMethods.length ? '' : 'disabled'}>ارسال خرید برای تأیید</button>
            </form>
          </details>
          <details class="fin-advanced"><summary>۲. پیش‌نمایش و ثبت استهلاک ماهانه</summary>
            <form id="fin-depreciation-form" class="fin-form fin-procurement-form" autocomplete="off">
              <label class="fin-field span-2"><span>تاریخ ثبت ماه</span><input name="postingDate" type="date" value="${today}" required></label>
              <button class="fin-btn secondary" type="button" data-fin-depreciation-preview>فقط پیش‌نمایش</button>
              <button class="fin-btn primary" type="submit" ${activeAssets.length ? '' : 'disabled'}>ارسال ثبت برای تأیید</button>
            </form>
            <div id="fin-depreciation-preview-result" class="fin-preview-result">${depreciationPreview.status === 'available' ? `<div class="fin-note"><strong>${fa(depreciationPreview.lines.length)} دارایی واجد شرایط</strong><span>جمع پیشنهادی ${money(depreciationPreview.totalDepreciationIrr)} · هنوز ذخیره یا قطعی نشده است.</span></div>` : empty(depreciationPreview.message || 'دارایی واجد شرایط برای این ماه وجود ندارد.')}</div>
          </details>
        </div>
        <div class="fin-grid-2">
          <div class="fin-operation-list"><div class="fin-subhead"><strong>دفتر دارایی V2</strong><span>${fa(fixedAssets.length)} مورد</span></div>
            ${fixedAssets.length ? fixedAssets.map((asset) => `<article><div><strong>${esc(asset.assetCode)} · ${esc(asset.name)}</strong><small>خرید ${dateOnly(asset.purchaseDate)} · بهای ${money(asset.purchaseCostIrr)}</small></div><div>${statusBadge(asset.status, asset.status === 'active' ? 'success' : asset.status === 'rejected' ? 'danger' : 'warning')}<b>${money(Math.max(0, Number(asset.purchaseCostIrr) - Number(asset.accumulatedDepreciationIrr || 0)))}</b></div></article>`).join('') : empty('دارایی V2 ثبت نشده است.')}
          </div>
          <div class="fin-operation-list"><div class="fin-subhead"><strong>ثبت‌های استهلاک</strong><span>${fa(depreciationRuns.length)} مورد</span></div>
            ${depreciationRuns.length ? depreciationRuns.map((run) => `<article><div><strong>ماه ${dateOnly(`${run.serviceMonth}-01`)}</strong><small>${fa(run.lines?.length || 0)} دارایی · سند ${esc(run.journalEntry?.number || 'در انتظار')}</small></div><div>${statusBadge(run.status, run.status === 'posted' ? 'success' : run.status === 'rejected' ? 'danger' : 'warning')}<b>${money(run.totalDepreciationIrr)}</b></div></article>`).join('') : empty('استهلاک V2 ثبت نشده است.')}
          </div>
        </div>
      </section>
      <section class="fin-panel fin-operations"><div class="fin-panel-title"><div><h3>حقوق، کسورات و پرداخت بدهی</h3><p>لیست متوازن بر اساس ارقام تأییدشدهٔ حسابدار ثبت می‌شود؛ خالص حقوق، بیمه، مالیات و سایر کسورات جداگانه تسویه می‌شوند.</p></div><span>عملیات حقوق V2</span></div>
        <div class="fin-metrics">
          ${metric('لیست حقوق V2', fa(payrollRuns.length), `${fa(payrollRuns.filter((run) => run.status === 'pending_approval').length)} منتظر تأیید`)}
          ${metric('بدهی ایجادشده', money(payrollLiabilityIrr), 'از لیست‌های رد یا معکوس‌نشده')}
          ${metric('پرداخت قطعی', money(payrollPaidIrr), `${fa(payrollPayments.filter((payment) => payment.status === 'pending_approval').length)} درخواست منتظر تأیید`)}
          ${metric('حقوق میراثی قرنطینه', fa(data.legacyPayroll?.count || 0), 'در نرخ یا سند V2 استفاده نشده', data.legacyPayroll?.count ? 'warning' : '')}
        </div>
        <div class="fin-note warning"><strong>نرخ قانونی خودکار نیست</strong><span>برای جلوگیری از ثبت با نرخ منقضی یا حدسی، بیمه و مالیات از فایل/محاسبهٔ تأییدشدهٔ حسابدار وارد می‌شوند. موتور فقط معادله و سند دوبل را کنترل می‌کند.</span></div>
        <div class="fin-procurement-stack">
          <details class="fin-advanced" open><summary>۱. پیش‌نمایش و ارسال لیست حقوق</summary>
            <form id="fin-payroll-run-form" class="fin-form fin-form-wide" autocomplete="off">
              <label class="fin-field span-2"><span>مرجع لیست تأییدشده</span><input name="sourceReference" required minlength="3" maxlength="160" placeholder="شماره فایل، صورتجلسه یا گزارش حقوق"></label>
              <label class="fin-field"><span>تعداد کارکنان</span><input name="headcount" inputmode="numeric" required></label>
              <label class="fin-field"><span>تاریخ ثبت / ماه خدمت</span><input name="postingDate" type="date" value="${today}" required></label>
              <label class="fin-field"><span>ناخالص آشپزخانه و بار (تومان)</span><input name="kitchenGrossToman" inputmode="numeric" value="0" required></label>
              <label class="fin-field"><span>ناخالص سالن و صندوق (تومان)</span><input name="serviceGrossToman" inputmode="numeric" value="0" required></label>
              <label class="fin-field"><span>بیمه سهم کارفرما (تومان)</span><input name="employerInsuranceToman" inputmode="numeric" value="0" required></label>
              <label class="fin-field"><span>بیمه سهم کارکنان (تومان)</span><input name="employeeInsuranceToman" inputmode="numeric" value="0" required></label>
              <label class="fin-field"><span>مالیات حقوق (تومان)</span><input name="payrollTaxToman" inputmode="numeric" value="0" required></label>
              <label class="fin-field"><span>سایر کسورات (تومان)</span><input name="otherDeductionsToman" inputmode="numeric" value="0" required></label>
              <label class="fin-field span-2"><span>خالص حقوق پرداختنی (تومان)</span><input name="netPayToman" inputmode="numeric" required></label>
              <button class="fin-btn secondary" type="button" data-fin-payroll-preview>فقط کنترل و پیش‌نمایش</button>
              <button class="fin-btn primary" type="submit">ارسال لیست برای تأیید</button>
            </form>
            <div id="fin-payroll-preview-result" class="fin-preview-result">${empty('ارقام تأییدشده را وارد کنید؛ پیش‌نمایش هیچ ثبت مالی ایجاد نمی‌کند.')}</div>
          </details>
          <details class="fin-advanced"><summary>۲. درخواست پرداخت بدهی حقوق</summary>
            <form id="fin-payroll-payment-form" class="fin-form fin-form-wide" autocomplete="off">
              <label class="fin-field span-2"><span>لیست حقوق قطعی</span><select name="payrollRunId" required>${payablePayrollRuns.map((run) => `<option value="${esc(run.id)}">${dateOnly(`${run.serviceMonth}-01`)} · ${fa(run.headcount)} نفر · ${money(run.totalExpenseIrr)}</option>`).join('')}</select></label>
              <label class="fin-field"><span>نوع بدهی</span><select name="liabilityType" required>${payrollPolicies.liabilityTypes.map((row) => `<option value="${esc(row.id)}">${esc(row.label)} · ${esc(row.accountCode)}</option>`).join('')}</select></label>
              <label class="fin-field"><span>مبلغ (تومان)</span><input name="amountToman" inputmode="numeric" required></label>
              <label class="fin-field"><span>روش پرداخت</span><select name="paymentMethod" required><option value="bank">بانک</option><option value="cash">صندوق</option></select></label>
              <label class="fin-field"><span>تاریخ پرداخت</span><input name="paymentDate" type="date" value="${today}" required></label>
              <label class="fin-field span-2"><span>مرجع پرداخت</span><input name="reference" maxlength="160" placeholder="شماره حواله یا فیش"></label>
              <div class="fin-note span-2"><strong>تفکیک وظایف</strong><span>ثبت این فرم وجهی خارج نمی‌کند؛ مالک/مدیر پس از تأیید، سند تسویه بدهی و خروج بانک/صندوق را قطعی می‌کند.</span></div>
              <button class="fin-btn primary span-2" type="submit" ${payablePayrollRuns.length && payrollPolicies.liabilityTypes.length ? '' : 'disabled'}>ارسال پرداخت برای تأیید</button>
            </form>
          </details>
        </div>
        <div class="fin-grid-2">
          <div class="fin-operation-list"><div class="fin-subhead"><strong>لیست‌های حقوق V2</strong><span>${fa(payrollRuns.length)} مورد</span></div>
            ${payrollRuns.length ? payrollRuns.map((run) => `<article><div><strong>ماه ${dateOnly(`${run.serviceMonth}-01`)} · ${fa(run.headcount)} نفر</strong><small>مرجع ${esc(run.sourceReference)} · سند ${esc(run.journalEntry?.number || 'در انتظار')}</small></div><div>${statusBadge(run.status, ['posted', 'paid'].includes(run.status) ? 'success' : run.status === 'rejected' ? 'danger' : 'warning')}<b>${money(run.totalExpenseIrr)}</b></div></article>`).join('') : empty('لیست حقوق V2 ثبت نشده است.')}
          </div>
          <div class="fin-operation-list"><div class="fin-subhead"><strong>پرداخت‌های حقوق و کسورات</strong><span>${fa(payrollPayments.length)} مورد</span></div>
            ${payrollPayments.length ? payrollPayments.map((payment) => `<article><div><strong>${esc(label(payment.liabilityType))}</strong><small>${dateOnly(payment.paymentDate)} · ${esc(label(payment.paymentMethod))} · ${esc(payment.reference || 'بدون مرجع')}</small></div><div>${statusBadge(payment.status, payment.status === 'paid' ? 'success' : payment.status === 'rejected' ? 'danger' : 'warning')}<b>${money(payment.amountIrr)}</b></div></article>`).join('') : empty('پرداخت حقوق V2 ثبت نشده است.')}
          </div>
        </div>
      </section>
      <div class="fin-grid-2">
        <section class="fin-panel"><div class="fin-panel-title"><div><h3>سود و زیان</h3><p>فقط خطوط قطعی حساب‌های ۴، ۵ و ۶</p></div>${statusBadge(pnl.status, pnl.status === 'available' ? 'success' : 'neutral')}</div><div class="fin-result-grid">${metric('درآمد خالص', money(pnl.revenueIrr), '۴xxx')}${metric('بهای تمام‌شده', money(pnl.cogsIrr), '۵xxx')}${metric('هزینه عملیاتی', money(pnl.operatingExpenseIrr), '۶xxx')}${metric('سود/زیان دوره', money(pnl.netProfitIrr), 'بدون clamp منفی', pnl.netProfitIrr < 0 ? 'danger' : 'success')}</div></section>
        <section class="fin-panel"><div class="fin-panel-title"><div><h3>ترازنامه</h3><p>دارایی = بدهی + حقوق مالکانه + نتیجه دوره</p></div>${statusBadge(balance.status, balance.status === 'balanced' ? 'success' : balance.status === 'unbalanced' ? 'danger' : 'neutral')}</div><div class="fin-result-grid">${metric('دارایی', money(balance.assetsIrr), '۱xxx')}${metric('بدهی', money(balance.liabilitiesIrr), '۲xxx')}${metric('حقوق مالکانه', money(balance.equityIrr), 'شامل نتیجه دوره')}${metric('اختلاف معادله', money(Math.abs(balance.equationDifferenceIrr)), 'باید صفر باشد', balance.equationDifferenceIrr ? 'danger' : 'success')}</div></section>
      </div>
      <section class="fin-panel"><div class="fin-panel-title"><div><h3>جریان وجوه نقد مستقیم</h3><p>فقط تغییر حساب‌های صندوق، تنخواه و بانک؛ طبقه‌بندی نامطمئن پنهان نمی‌شود.</p></div>${statusBadge(cashFlow.status, cashFlow.status === 'rule_based' ? 'success' : cashFlow.status === 'partial_coverage' ? 'warning' : 'neutral')}</div><div class="fin-result-grid">${metric('عملیاتی', money(cashFlow.operatingIrr), 'قاعده حساب مقابل')}${metric('سرمایه‌گذاری', money(cashFlow.investingIrr), 'دارایی ثابت')}${metric('تأمین مالی', money(cashFlow.financingIrr), 'سرمایه/تسهیلات')}${metric('تغییر خالص وجه', money(cashFlow.netChangeIrr), cashFlow.unclassifiedIrr ? `طبقه‌بندی‌نشده: ${money(cashFlow.unclassifiedIrr)}` : 'تمام تغییرات طبقه‌بندی شد', cashFlow.unclassifiedIrr ? 'warning' : 'success')}</div></section>
      <details class="fin-advanced"><summary>تراز آزمایشی (${fa(trial.rows.length)} حساب)</summary><section class="fin-panel"><div class="fin-panel-title"><div><h3>تراز آزمایشی</h3><p>جمع بدهکار و بستانکار از خطوط قطعی V2</p></div>${statusBadge(trial.status, trial.status === 'balanced' ? 'success' : trial.status === 'unbalanced' ? 'danger' : 'neutral')}</div>${table('trial-balance', [
        { label: 'حساب', render: (row) => `<strong>${esc(row.accountCode)}</strong>${row.accountName ? `<small>${esc(row.accountName)}</small>` : ''}` },
        { label: 'بدهکار', render: (row) => money(row.debitIrr) },
        { label: 'بستانکار', render: (row) => money(row.creditIrr) },
        { label: 'مانده', render: (row) => money(Math.abs(row.balanceIrr)) },
        { label: 'ماهیت مانده', render: (row) => row.balanceIrr > 0 ? 'بدهکار' : row.balanceIrr < 0 ? 'بستانکار' : 'صفر' },
      ], trial.rows, 'برای این محدوده سند قطعی وجود ندارد.')}</section></details>
      <section class="fin-panel"><div class="fin-panel-title"><div><h3>چک‌لیست بستن دوره</h3><p>بستن دوره تا عبور همهٔ کنترل‌ها غیرفعال است.</p></div><span>${fa(checks.filter((item) => item.passed).length)} / ${fa(checks.length)}</span></div>
        <div class="fin-check-list">${checks.map((item) => `<article class="${item.passed ? 'passed' : 'failed'}"><span>${item.passed ? '✓' : '!'}</span><strong>${esc(item.label)}</strong>${statusBadge(item.passed ? 'passed' : 'failed')}</article>`).join('')}</div>
        <button type="button" class="fin-btn primary" data-fin-close-period="${esc(data.selectedPeriod?.id || '')}" ${checks.every((item) => item.passed) && data.periodSource === 'finance_v2' && data.selectedPeriod?.id ? '' : 'disabled'}>بستن مقدماتی دوره</button>
      </section>
      <section class="fin-panel"><div class="fin-panel-title"><div><h3>اسناد دفتر V2</h3><p>سند قطعی ویرایش نمی‌شود؛ اصلاح فقط با reversal.</p></div></div>
        ${table('ledger', [
          { label: 'شماره', render: (row) => `<strong>${esc(row.number)}</strong>` },
          { label: 'تاریخ', render: (row) => dateTime(row.date) },
          { label: 'شرح', render: (row) => esc(row.description) },
          { label: 'بدهکار', render: (row) => money(row.debitIrr) },
          { label: 'بستانکار', render: (row) => money(row.creditIrr) },
          { label: 'وضعیت', render: (row) => row.reversalOfId ? statusBadge('سند معکوس', 'neutral') : row.reversedById ? statusBadge('دارای سند معکوس', 'warning') : statusBadge(row.status) },
        ], data.entries, 'هنوز سندی در دفتر V2 قطعی نشده است.', data.pagination)}
      </section>
      <details class="fin-advanced"><summary>سایر ابزارهای پیشرفته</summary><div><span>کدینگ حساب‌ها</span><span>پارامترهای قانونی حقوق: نیازمند تأیید تخصصی مؤثر-از-تاریخ</span><span>مالیات</span><span>${esc(data.integrityControl.label)}</span></div></details>
      <div class="fin-note warning"><strong>سامانه مؤدیان: متصل نیست</strong><span>${esc(data.taxpayerIntegration.message)}</span></div>`;
  }

  function exportCurrent(kind) {
    const payload = state.payload;
    let rows = [];
    if (kind === 'sales') rows = payload.orders || [];
    if (kind === 'payables') rows = payload.vendors || [];
    if (kind === 'costing') rows = payload.items || [];
    if (kind === 'ledger') rows = payload.entries || [];
    if (!rows.length) {
      if (typeof window.showToast === 'function') window.showToast('رکوردی برای خروجی وجود ندارد', 'warning');
      return;
    }
    const keys = [...new Set(rows.flatMap((row) => Object.keys(row).filter((key) => typeof row[key] !== 'object')))];
    const quote = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const csv = `\uFEFF${keys.map(quote).join(',')}\n${rows.map((row) => keys.map((key) => quote(row[key])).join(',')).join('\n')}`;
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = `westo-finance-${kind}-${new Date().toISOString().slice(0, 10)}.csv`; link.click(); URL.revokeObjectURL(url);
  }

  window.renderAccountingWorkspace = async function renderAccountingWorkspace(container, qs = '') {
    root = container;
    readLocationQuery(qs);
    renderShell();
    await loadWorkspace();
  };
})();
