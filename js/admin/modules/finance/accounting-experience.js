/* Accounting presentation boundary. Existing Finance V2 APIs and mutation handlers remain authoritative. */
(() => {
  'use strict';

  const views = [
    { id: 'home', workspace: 'workbench', operation: 'journal', title: 'خانهٔ حسابداری', hint: 'وضعیت مالی و کارهایی که باید پیگیری شوند', icon: 'home' },
    { id: 'sales', workspace: 'sales_bank', title: 'فروش و دریافت‌ها', hint: 'فروش سفارش‌ها، دریافت وجه و درخواست‌های برگشت', icon: 'sales', tabs: [['orders', 'فروش سفارش‌ها'], ['refunds', 'برگشت وجه']] },
    { id: 'bank', workspace: 'sales_bank', title: 'بانک و صندوق', hint: 'تسویه‌ها، گردش بانک و تطبیق با دفتر مالی', icon: 'bank', tabs: [['bank', 'گردش و تطبیق بانک'], ['settlements', 'تسویهٔ کارتخوان و درگاه'], ['cash', 'وضعیت صندوق']] },
    { id: 'purchases', workspace: 'purchases', title: 'خرید و هزینه‌ها', hint: 'خرید، فاکتور، هزینه و ماندهٔ پرداختنی', icon: 'purchase', tabs: [['orders', 'سفارش خرید'], ['invoices', 'فاکتور و پرداخت'], ['expenses', 'هزینه‌های روزانه'], ['recurring', 'هزینه‌های دوره‌ای'], ['vendors', 'تأمین‌کنندگان']] },
    { id: 'journals', workspace: 'workbench', operation: 'journal', title: 'اسناد حسابداری', hint: 'پیش‌نویس‌ها، اسناد ثبت‌شده و گردش تأیید', icon: 'journal' },
    { id: 'reports', workspace: 'ledger_close', title: 'گزارش‌های مالی', hint: 'گزارش‌های دفتر مالی با وضعیت روشنِ کامل‌بودن داده', icon: 'report', tabs: [['pnl', 'سود و زیان'], ['balance', 'ترازنامه'], ['cashflow', 'جریان وجوه نقد'], ['trial', 'تراز آزمایشی'], ['ratios', 'نسبت‌های مالی']] },
    { id: 'costing', workspace: 'costing', title: 'بهای تمام‌شده', hint: 'هزینهٔ محصولات، ارزش موجودی و تحلیل سودآوری', icon: 'cost', tabs: [['products', 'هزینهٔ محصولات'], ['inventory', 'موجودی و مصرف'], ['coverage', 'موارد نیازمند تکمیل'], ['planning', 'برنامهٔ سودآوری'], ['breakeven', 'تحلیل سربه‌سر']] },
    { id: 'people_assets', workspace: 'ledger_close', title: 'حقوق و دارایی‌ها', hint: 'حقوق و کسورات، دارایی‌های ثابت و استهلاک', icon: 'people', secondary: true, tabs: [['payroll', 'حقوق و پرداخت‌ها'], ['assets', 'دارایی و استهلاک']] },
    { id: 'periods', workspace: 'workbench', operation: 'periods', title: 'دورهٔ مالی', hint: 'دوره‌ها، کنترل‌های بستن و ماندهٔ افتتاحیه', icon: 'calendar', secondary: true, tabs: [['periods', 'دوره‌ها'], ['close', 'کنترل‌های بستن'], ['opening', 'ماندهٔ افتتاحیه']] },
    { id: 'settings', workspace: 'ledger_close', title: 'تنظیمات حسابداری', hint: 'تنظیم مالیات، کدینگ حساب‌ها و بررسی داده‌های قدیمی', icon: 'settings', secondary: true, tabs: [['tax', 'تنظیم مالیات'], ['accounts', 'کدینگ حساب‌ها'], ['migration', 'انتقال داده‌های قدیمی']] },
    { id: 'approvals', workspace: 'workbench', operation: 'approvals', title: 'تأییدها', hint: 'درخواست‌ها و تصمیم‌های مستقل مدیر یا مالک', icon: 'check', utility: true },
    { id: 'issues', workspace: 'workbench', operation: 'events', title: 'موارد نیازمند رسیدگی', hint: 'ثبت‌های جاافتاده و مواردی که مانع تکمیل دفتر هستند', icon: 'alert', utility: true },
  ].map(view => Object.freeze({ ...view, tabs: Object.freeze((view.tabs || []).map(tab => Object.freeze(tab))) }));
  const icons = {
    home: '<path d="m3 10 9-7 9 7v10H3Z"/><path d="M9 20v-7h6v7"/>',
    sales: '<path d="M4 19h16M6 15V9m6 6V5m6 10v-4"/>',
    bank: '<path d="m3 8 9-5 9 5H3ZM4 21h16M6 10v8m6-8v8m6-8v8"/>',
    purchase: '<path d="M3 4h3l3 12h10l2-8H7"/><circle cx="10" cy="20" r="1"/><circle cx="18" cy="20" r="1"/>',
    journal: '<path d="M5 3h11l3 3v15H5ZM9 9h6M9 13h6M9 17h4"/>',
    report: '<path d="M4 3h16v18H4ZM8 16v-3m4 3V8m4 8v-6"/>',
    cost: '<path d="M4 4h16v16H4ZM8 8h8M8 12h3m3 0h2M8 16h3m3 0h2"/>',
    people: '<circle cx="9" cy="8" r="3"/><path d="M3 20v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6m2 3a5 5 0 0 1 3 5"/>',
    calendar: '<path d="M4 5h16v16H4ZM4 10h16M8 3v4m8-4v4M8 14h2m4 0h2M8 17h2"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="m10 3-1 3-3 1-3 3 2 2-1 4 3 3 3-1 2 3 4-1 1-3 3-2-1-4 2-2-3-3-3 1-2-3Z"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
    download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
    alert: '<path d="m12 3 10 18H2ZM12 9v5m0 3v1"/>',
  };
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.journal}</svg>`;
  const resolve = (view, workspace, operation) => views.find(item => item.id === view)
    || views.find(item => item.workspace === workspace && item.operation === operation)
    || views.find(item => item.workspace === workspace) || views[0];
  const tabFor = (view, tab) => view.tabs.some(item => item[0] === tab) ? tab : view.tabs[0]?.[0] || '';
  const routeFor = (view, tab) => {
    if (view.id === 'periods' && ['close', 'opening'].includes(tab)) return { workspace: 'ledger_close', operation: 'periods' };
    if (view.id === 'settings' && tab === 'migration') return { workspace: 'workbench', operation: 'events' };
    return { workspace: view.workspace, operation: view.operation || 'journal' };
  };

  function dateRange(preset, today) {
    if (preset === 'all') return { from: '', to: '' };
    const date = new Date(`${today}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() - (preset === '7d' ? 6 : preset === '30d' ? 29 : 0));
    return { from: date.toISOString().slice(0, 10), to: today };
  }
  function datePreset(query, today) {
    return ['all', 'today', '7d', '30d'].find(preset => {
      const range = dateRange(preset, today);
      return (query.from || '') === range.from && (query.to || '') === range.to;
    }) || 'custom';
  }

  function shell(state, today) {
    const view = resolve(state.view, state.workspace, state.operation);
    const nav = item => `<button type="button" data-fin-view="${item.id}" ${item.id === view.id ? 'class="active" aria-current="page"' : ''}>${icon(item.icon)}<span>${item.title}</span></button>`;
    return `<section class="finance-v2 fin-experience" data-display-mode="simple" data-accounting-view="${view.id}" aria-label="فضای کاری حسابداری">
      <nav class="fin-local-nav" aria-label="بخش‌های حسابداری"><div class="fin-local-brand">${icon('journal')}<span>دفتر مالی</span></div>
        <span class="fin-nav-caption">کارهای روزانه</span><div class="fin-local-links">${views.filter(item => ['home', 'sales', 'bank', 'purchases'].includes(item.id)).map(nav).join('')}</div>
        <span class="fin-nav-caption">دفتر و گزارش‌ها</span><div class="fin-local-links">${views.filter(item => ['journals', 'reports', 'costing'].includes(item.id)).map(nav).join('')}</div>
        <span class="fin-nav-caption">مدیریت و تنظیمات</span><div class="fin-local-links">${views.filter(item => item.secondary).map(nav).join('')}</div>
        <div class="fin-nav-footer">مبالغ به تومان نمایش داده می‌شوند</div>
      </nav>
      <div class="fin-experience-main">
        <header class="fin-page-header"><div><div class="fin-page-breadcrumb">فضای کاری حسابداری</div><h2>${esc(view.title)}</h2><p>${esc(view.hint)}</p></div><div class="fin-page-utilities"><button class="fin-btn secondary" type="button" data-fin-view="issues">${icon('alert')}رسیدگی</button><button class="fin-btn secondary" type="button" data-fin-view="approvals">${icon('check')}تأییدها <span data-fin-approval-count></span></button></div></header>
        <label class="fin-mobile-destination">بخش حسابداری<select data-fin-mobile-view>${views.filter(item => !item.utility).map(item => `<option value="${item.id}" ${item.id === view.id ? 'selected' : ''}>${esc(item.title)}</option>`).join('')}</select></label>
        <div class="fin-context"><div class="fin-scope" data-fin-scope><span data-fin-period>تمام تاریخچه</span><span data-fin-period-status></span></div><aside class="fin-header-status" data-fin-connection-state="loading" role="status" aria-live="polite"><span class="fin-dot" aria-hidden="true"></span><span><b>در حال دریافت اطلاعات</b><small>دفتر مالی</small></span></aside></div>
        <div class="fin-toolbar"><label class="fin-search"><span class="fin-sr-only">جست‌وجو در کل حسابداری</span>${icon('search')}<input id="fin-global-search" type="search" value="${esc(state.search || '')}" placeholder="جست‌وجو در کل حسابداری…" aria-label="جست‌وجو در کل حسابداری" autocomplete="off" aria-controls="fin-search-results" aria-expanded="false"><div id="fin-search-results" class="fin-search-results" role="region" aria-label="نتایج جست‌وجوی حسابداری" hidden></div></label>
          <div class="fin-presets" role="group" aria-label="فیلتر سریع تاریخ">${[['all', 'همه'], ['today', 'امروز'], ['7d', '۷ روز'], ['30d', '۳۰ روز']].map(([id, text]) => `<button type="button" class="fin-preset-btn ${datePreset(state.query, today) === id ? 'is-active' : ''}" aria-pressed="${datePreset(state.query, today) === id}" data-fin-preset="${id}">${text}</button>`).join('')}</div>
          <button class="fin-btn secondary fin-filter-toggle" id="fin-filter-toggle" type="button" aria-expanded="false" aria-controls="fin-date-controls">${icon('calendar')}<span>بازهٔ دلخواه</span></button>
          <div class="fin-date-controls" id="fin-date-controls"><label>از<input id="fin-from" type="date" value="${esc(state.query.from)}"></label><label>تا<input id="fin-to" type="date" value="${esc(state.query.to)}"></label><button class="fin-btn secondary" id="fin-apply-filter" type="button">اعمال بازه</button><span id="fin-date-error" role="alert" hidden></span></div>
        </div>
        <div id="fin-workspace-content" role="region" aria-label="جزئیات فضای کاری مالی" aria-live="polite" tabindex="-1"></div>
      </div></section>`;
  }

  const formLabels = {
    'fin-po-form': 'سفارش خرید جدید', 'fin-invoice-form': 'ثبت فاکتور خرید', 'fin-supplier-payment-form': 'درخواست پرداخت فاکتور',
    'fin-cost-commitment-form': 'تعریف هزینهٔ دوره‌ای', 'fin-cost-accrual-form': 'ثبت هزینهٔ این دوره', 'fin-cost-payment-form': 'درخواست پرداخت هزینه',
    'fin-refund-form': 'درخواست برگشت وجه', 'fin-bank-line-form': 'ثبت گردش بانک', 'fin-settlement-form': 'ثبت تسویهٔ کارتخوان یا درگاه',
    'fin-journal-form': 'سند حسابداری جدید', 'fin-period-form': 'تعریف دورهٔ مالی', 'fin-opening-balance-form': 'ثبت ماندهٔ افتتاحیه',
    'fin-fixed-asset-form': 'ثبت دارایی جدید', 'fin-depreciation-form': 'محاسبه و ثبت استهلاک', 'fin-payroll-run-form': 'ثبت لیست حقوق',
    'fin-payroll-payment-form': 'درخواست پرداخت حقوق', 'fin-break-even-plan-form': 'ویرایش برنامهٔ سودآوری',
    'fin-break-even-form': 'محاسبهٔ سناریوی سربه‌سر', 'fin-operating-expense-form': 'ثبت هزینهٔ روزانه',
  };

  function compose(content, state, auxiliary = {}) {
    const view = resolve(state.view, state.workspace, state.operation);
    const tab = tabFor(view, state.section);
    const source = document.createElement('div');
    while (content.firstChild) source.append(content.firstChild);
    const ledger = document.createElement('div');
    ledger.innerHTML = auxiliary.ledgerHtml || '';
    const workbench = document.createElement('div');
    workbench.innerHTML = auxiliary.workbenchHtml || '';
    const selected = [];
    const panel = (title, from = source) => Array.from(from.querySelectorAll('h3')).find(node => node.textContent.trim() === title)?.closest('section');
    const take = node => { if (node && !selected.includes(node)) selected.push(node); };
    const takePanel = (title, from) => take(panel(title, from));
    const takeForm = id => take(source.querySelector(`#${id}`)?.closest('details') || source.querySelector(`#${id}`));
    const operation = source.querySelector('.fin-operation-body');

    if (view.id === 'home') {
      source.querySelector('[data-fin-queue="informational"]')?.remove();
      takePanel('وضعیت در یک نگاه'); take(source.querySelector('.fin-actions'));
    } else if (view.id === 'journals') {
      take(operation); take(source.querySelector('[data-fin-journal-history]'));
    } else if (view.id === 'approvals') take(operation);
    else if (view.id === 'issues') {
      operation?.querySelectorAll('details').forEach(node => { if (node.querySelector('[data-fin-classify-legacy]')) node.remove(); });
      take(operation);
    } else if (view.id === 'sales') {
      take(source.querySelector('[data-fin-sales-summary]'));
      if (tab === 'orders') { takePanel('سفارش‌ها و وضعیت ثبت مالی'); takePanel('روش‌های پرداخت'); }
      else takeForm('fin-refund-form');
    } else if (view.id === 'bank') {
      if (tab === 'bank') takeForm('fin-bank-line-form');
      if (tab === 'settlements') { takeForm('fin-settlement-form'); takePanel('وضعیت تسویه'); }
      if (tab === 'cash') {
        take(source.querySelector('.fin-cash-cycle'));
        take(source.querySelector('.fin-section-head .fin-head-actions'));
      }
    } else if (view.id === 'purchases') {
      if (tab === 'orders') { takePanel('زنجیره خرید جدید'); takeForm('fin-po-form'); take(source.querySelector('#fin-receiving-step')); }
      if (tab === 'invoices') { takePanel('فاکتور و پرداخت'); takePanel('ماتریس سن‌سنجی بدهی‌های پرداختنی (AP Aging)'); takeForm('fin-invoice-form'); takeForm('fin-supplier-payment-form'); takePanel('پیگیری پرداخت تأمین‌کننده'); }
      if (tab === 'expenses') { takePanel('هزینه‌های عملیاتی ثبت‌شده'); take(source.querySelector('[data-fin-daily-expense]')); }
      if (tab === 'recurring') takePanel('اجاره، حقوق و هزینه‌های دوره‌ای');
      if (tab === 'vendors') take(Array.from(source.querySelectorAll('details')).find(node => node.querySelector('summary')?.textContent.includes('تأمین‌کنندگان و مانده‌های تاریخی')));
    } else if (view.id === 'reports') {
      const reports = { pnl: 'سود و زیان', balance: 'ترازنامه', cashflow: 'جریان وجوه نقد مستقیم', trial: 'تراز آزمایشی', ratios: 'شاخص‌های تحلیلی و نسبت‌های سلامت مالی' };
      if (tab === 'trial') take(source.querySelector('#fin-trial-balance-details'));
      else if (tab === 'ratios') take(source.querySelector('.fin-ratios-panel'));
      else takePanel(reports[tab]);
      take(source.querySelector('[aria-label="خلاصهٔ گزارش‌های مالی"]'));
    } else if (view.id === 'people_assets') takePanel(tab === 'payroll' ? 'حقوق و پرداخت‌های پرسنل' : 'دارایی‌ها و استهلاک');
    else if (view.id === 'periods') {
      if (tab === 'periods') take(operation);
      if (tab === 'close') take((auxiliary.ledgerHtml ? ledger : source).querySelector('.fin-close-summary'));
      if (tab === 'opening') takePanel('مانده‌های شروع دوره', auxiliary.ledgerHtml ? ledger : source);
    } else if (view.id === 'settings') {
      if (tab === 'tax') { take(source.querySelector('[data-fin-tax-setup]')); take(Array.from(source.querySelectorAll('.fin-note')).find(node => node.textContent.includes('سامانه مؤدیان:'))); }
      if (tab === 'accounts') take(source.querySelector('[data-fin-chart-accounts]'));
      if (tab === 'migration') take(Array.from((auxiliary.workbenchHtml ? workbench : source).querySelectorAll('details.fin-action-details')).find(node => node.querySelector('[data-fin-classify-legacy]')));
    } else if (view.id === 'costing') {
      const groups = {
        products: ['بهای تمام‌شده نظری', 'سود ناخالص نظری محصولات فروخته‌شده'],
        inventory: ['خروج ارزش‌گذاری‌شده انبار', 'ظرفیت قابل فروش دستورهای تهیه', 'پیش‌بینی اتمام موجودی'],
        coverage: ['کیفیت دادهٔ هزینه', 'صف بازبینی تأیید دستورهای تهیه', 'شکاف پوشش دستور تهیهٔ فروش'],
        planning: ['نقشهٔ سودآوری تا ددلاین'],
        breakeven: ['نقطهٔ سربه‌سر واقعی از دفتر', 'نقطهٔ سربه‌سر برنامه‌ای از تعهدها', 'پیش‌نمایش نقطهٔ سربه‌سر'],
      };
      (groups[tab] || groups.products).forEach(title => takePanel(title));
    }

    // Keep one feedback region in the visible page. Existing handlers address
    // these IDs after reload and must never silently write into a hidden form.
    const feedback = document.createElement('div');
    feedback.className = 'fin-page-feedback';
    for (const id of ['fin-operation-feedback', 'fin-settlement-feedback', 'fin-bank-feedback']) {
      const existing = source.querySelector(`#${id}`) || ledger.querySelector(`#${id}`) || workbench.querySelector(`#${id}`);
      const node = existing || document.createElement('div'); node.id = id; feedback.append(node);
    }
    content.append(feedback);
    if (view.tabs.length) {
      const tabs = document.createElement('nav'); tabs.className = 'fin-view-tabs'; tabs.setAttribute('aria-label', `صفحات ${view.title}`);
      tabs.innerHTML = view.tabs.map(([id, title]) => `<button type="button" data-fin-section="${id}" ${id === tab ? 'class="active" aria-current="page"' : ''}>${esc(title)}</button>`).join('');
      content.append(tabs);
    }
    const actions = document.createElement('div'); actions.className = 'fin-page-actions';
    const main = document.createElement('div'); main.className = 'fin-page-list';
    const tasks = document.createElement('div'); tasks.className = 'fin-task-library';
    selected.forEach(node => main.append(node));
    content.append(actions, main, tasks);
    if (!selected.length) main.innerHTML = '<div class="fin-empty"><strong>عملیاتی برای این سطح دسترسی در دسترس نیست</strong><span>این بخش فقط امکانات مجازِ متصل به دفتر مالی را نمایش می‌دهد.</span></div>';

    // Remove structural accordions. Their contents have their own destination;
    // a genuine per-record disclosure (approval/reopen/etc.) remains intact.
    main.querySelectorAll('details').forEach(node => {
      if (node.matches('.fin-period-reopen')) return;
      const summary = node.querySelector(':scope > summary');
      if (!summary) return;
      const wrap = document.createElement('section'); wrap.className = 'fin-flat-section';
      if (node.id) wrap.id = node.id;
      if (node.hasAttribute('data-fin-tax-setup')) wrap.setAttribute('data-fin-tax-setup', '');
      const title = document.createElement('h3'); title.textContent = summary.querySelector('strong')?.textContent || summary.textContent;
      wrap.append(title);
      while (node.firstChild) { if (node.firstChild === summary) summary.remove(); else wrap.append(node.firstChild); }
      node.replaceWith(wrap);
    });
    main.querySelectorAll('form[id]').forEach(form => {
      if (!formLabels[form.id]) return;
      form.querySelectorAll('input').forEach(input => {
        if (!input.hasAttribute('data-money-input')) input.dataset.moneyInput = /Toman$|Irr$/.test(input.name) ? 'true' : 'false';
      });
      const costCenter = form.querySelector('[name="costCenter"]');
      if (costCenter) {
        costCenter.type = 'hidden'; costCenter.value = `branch:${state.query.branchId || ''}`;
        costCenter.closest('label').hidden = true;
      }
      const task = document.createElement('section'); task.className = 'fin-task-page'; task.dataset.finTaskPage = form.id; task.hidden = true;
      const heading = document.createElement('div'); heading.className = 'fin-task-heading';
      heading.innerHTML = `<div><span class="fin-page-breadcrumb">${esc(view.title)}</span><h3>${formLabels[form.id]}</h3></div><button type="button" class="fin-btn secondary" data-fin-close-task>بازگشت به فهرست</button>`;
      task.append(heading, form);
      const previewIds = { 'fin-payroll-run-form': 'fin-payroll-preview-result', 'fin-opening-balance-form': 'fin-opening-preview-result', 'fin-depreciation-form': 'fin-depreciation-preview-result', 'fin-break-even-form': 'fin-break-even-result' };
      const preview = main.querySelector(`#${previewIds[form.id] || '__none'}`); if (preview) task.append(preview);
      tasks.append(task);
      const button = document.createElement('button'); button.type = 'button'; button.className = `fin-btn ${actions.childElementCount ? 'secondary' : 'primary'}`;
      button.dataset.finOpenTask = form.id; button.textContent = formLabels[form.id]; actions.append(button);
    });
    // Empty containers left by form extraction add no useful information.
    main.querySelectorAll('.fin-flat-section,.fin-operation-layout,.fin-procurement-stack').forEach(node => { if (!node.querySelector('form,table,article,a,button,input,select,.fin-empty,.fin-note,.fin-metric,.fin-result-grid,.fin-preview-result,[data-fin-tax-content]')) node.remove(); });
    // A structural wrapper and its single panel are one surface, not two cards.
    main.querySelectorAll('.fin-flat-section').forEach(wrap => {
      const children = [...wrap.children].filter(child => child.tagName !== 'H3');
      if (children.length !== 1 || !children[0].matches('section.fin-panel') || !children[0].querySelector('h3')) return;
      const inner = children[0];
      if (wrap.id) inner.id = wrap.id;
      if (wrap.hasAttribute('data-fin-tax-setup')) inner.setAttribute('data-fin-tax-setup', '');
      wrap.replaceWith(inner);
    });
    main.querySelector('.fin-trial-search-wrap')?.remove();
    const totals = main.querySelector('.fin-trial-totals-bar');
    if (totals) { const label = document.createElement('strong'); label.className = 'fin-totals-caption'; label.textContent = 'جمع کل حساب‌های گزارش، پیش از فیلتر فهرست'; totals.prepend(label); }
    main.querySelectorAll('[data-fin-aging-bucket]').forEach(card => {
      const button = document.createElement('button'); button.type = 'button'; button.className = card.className; button.dataset.finAgingBucket = card.dataset.finAgingBucket; button.title = card.title;
      button.innerHTML = card.innerHTML; const active = card.dataset.finAgingBucket === state.listAging; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); card.replaceWith(button);
    });
    main.querySelector('.fin-category-pills')?.setAttribute('role', 'group');
    main.querySelectorAll('[data-fin-trial-cat]').forEach(button => {
      const active = button.dataset.finTrialCat === (state.listCategory || 'all');
      button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
      button.removeAttribute('aria-selected'); button.removeAttribute('role');
    });
    main.querySelectorAll('label.fin-field').forEach(label => {
      if (label.querySelector('[required]') && label.querySelector(':scope > span')) label.querySelector(':scope > span').classList.add('fin-required-label');
    });
    main.querySelectorAll('.fin-metric-value').forEach(node => { if (node.textContent.includes('هنوز فعالیتی')) { node.textContent = '—'; node.classList.add('fin-metric-unavailable'); } });
    main.querySelectorAll('.fin-panel-title > span').forEach(node => { if (['عملیاتی', 'کارهای تکمیلی', 'کنترل‌شده'].includes(node.textContent.trim())) node.remove(); });
    main.querySelectorAll('.fin-panel-title p').forEach(node => { node.classList.add('fin-context-help'); });

    const search = document.createElement('label'); search.className = 'fin-list-search';
    search.innerHTML = `<span>جست‌وجو در این فهرست</span><input type="search" data-fin-list-search placeholder="جست‌وجو در این صفحه…" value="${esc(state.listSearch || '')}">`;
    if (main.querySelector('.fin-table,.fin-operation-list article')) actions.append(search);
    const statuses = [...new Set(Array.from(main.querySelectorAll('.fin-table tbody .fin-badge,.fin-operation-list > article .fin-badge')).map(node => node.textContent.trim()))];
    if (state.listStatus && !statuses.includes(state.listStatus)) statuses.push(state.listStatus);
    if (statuses.length) {
      const filter = document.createElement('label'); filter.className = 'fin-list-status';
      filter.innerHTML = `<span>وضعیت</span><select data-fin-list-status><option value="">همهٔ وضعیت‌ها</option>${statuses.map(status => `<option value="${esc(status)}" ${status === state.listStatus ? 'selected' : ''}>${esc(status)}</option>`).join('')}</select>`;
      actions.append(filter);
    }
    const count = document.createElement('span'); count.className = 'fin-visible-count'; count.setAttribute('data-fin-visible-count', ''); count.setAttribute('role', 'status'); actions.append(count);
    const clear = document.createElement('button'); clear.type = 'button'; clear.className = 'fin-btn secondary'; clear.dataset.finClearList = ''; clear.textContent = 'پاک‌کردن فیلترها'; clear.hidden = true; actions.append(clear);
    const noResults = document.createElement('div'); noResults.className = 'fin-empty fin-filter-empty'; noResults.dataset.finFilterEmpty = ''; noResults.hidden = true; noResults.innerHTML = '<strong>موردی با این فیلترها پیدا نشد</strong><span>جست‌وجو، وضعیت یا گروه حساب را تغییر دهید.</span><button type="button" class="fin-btn secondary" data-fin-clear-list>نمایش همهٔ موارد این صفحه</button>'; const firstTable = main.querySelector('.fin-table-wrap'); if (firstTable) firstTable.after(noResults); else main.prepend(noResults);
    content.querySelectorAll('[data-fin-quick-pay]').forEach(button => { button.dataset.finExperienceQuickPay = '1'; });
    // Export follows the selected list, not an unrelated vendor/raw payload.
    if (main.querySelector('table')) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'fin-btn secondary'; button.dataset.finExportVisible = ''; button.innerHTML = `${icon('download')}<span>خروجی صفحه</span>`; actions.append(button);
    }
    main.querySelectorAll('table').forEach(table => {
      table.querySelectorAll('thead th').forEach((heading, index) => {
        if (/اقدام|جزئیات|زنجیره/.test(heading.textContent)) return;
        const label = heading.textContent;
        if (/مبلغ|بدهکار|بستانکار|مانده|ارزش|هزینه|سود|جمع|درصد/.test(label)) { heading.classList.add('fin-numeric'); table.querySelectorAll('tbody tr').forEach(row => row.children[index]?.classList.add('fin-numeric')); }
        heading.textContent = ''; heading.setAttribute('aria-sort', 'none');
        const button = document.createElement('button'); button.type = 'button'; button.className = 'fin-sort-button'; button.dataset.finSort = String(index); button.title = 'مرتب‌سازی موارد همین صفحه'; button.textContent = label; heading.append(button);
      });
    });
    const titles = { 'زنجیره خرید جدید': 'سفارش‌های خرید', 'ماتریس سن‌سنجی بدهی‌های پرداختنی (AP Aging)': 'سررسید بدهی‌ها', 'شاخص‌های تحلیلی و نسبت‌های سلامت مالی': 'نسبت‌های مالی', 'نقشهٔ سودآوری تا ددلاین': 'برنامهٔ سودآوری', 'ویرایش مبنای برنامه و ددلاین': 'مبنای برنامه', 'پاک‌سازی و تصمیم مهاجرت داده‌های قدیمی': 'بررسی داده‌های قدیمی' };
    main.querySelectorAll('h3').forEach(node => { const text = node.textContent.trim(); if (titles[text]) node.textContent = titles[text]; });
    const badges = content.closest('.fin-experience')?.querySelector('[data-fin-approval-count]');
    const approvals = state.payload?.operations?.counters?.pendingApprovals;
    if (badges && approvals != null) badges.textContent = Number(approvals) > 0 ? Number(approvals).toLocaleString('fa-IR') : '';
    return { view, tab, actions, main, tasks };
  }

  function showTask(content, id) {
    const previous = content.querySelector('[data-fin-task-page]:not([hidden])')?.dataset.finTaskPage;
    const task = Array.from(content.querySelectorAll('[data-fin-task-page]')).find(node => node.dataset.finTaskPage === id);
    content.querySelectorAll('[data-fin-task-page]').forEach(node => { node.hidden = node !== task; });
    const main = content.querySelector('.fin-page-list'); const actions = content.querySelector('.fin-page-actions');
    if (main) main.hidden = Boolean(task); if (actions) actions.hidden = Boolean(task);
    if (task) { task.querySelector('input:not([type="hidden"]),select,textarea')?.focus({ preventScroll: true }); task.scrollIntoView({ block: 'start' }); }
    if (!task && previous) { const trigger = [...content.querySelectorAll('[data-fin-open-task]')].find(button => button.dataset.finOpenTask === previous); trigger?.focus({ preventScroll: true }); actions?.scrollIntoView({ block: 'nearest' }); }
    return Boolean(task);
  }

  const normalize = value => String(value ?? '').replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/[۰-۹]/g, char => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(char))).replace(/[٠-٩]/g, char => String('٠١٢٣٤٥٦٧٨٩'.indexOf(char))).toLowerCase();
  function rowMatches({ text, statuses = [], accountCode = '', agingBucket = '' }, term = '', status = '', category = 'all', aging = 'all') {
    const query = normalize(term).trim();
    return (!query || normalize(text).includes(query))
      && (!status || statuses.some(value => normalize(value).trim() === normalize(status).trim()))
      && (!category || category === 'all' || normalize(accountCode).trim().startsWith(String(category)))
      && (!agingBucket || !aging || aging === 'all' || agingBucket === aging);
  }
  function filterList(content, term, status = '', category = 'all', aging = 'all') {
    const rows = Array.from(content.querySelectorAll('.fin-page-list .fin-table tbody tr,.fin-page-list .fin-operation-list > article'));
    let visible = 0;
    rows.forEach(row => {
      row.hidden = !rowMatches({ text: row.textContent, statuses: Array.from(row.querySelectorAll('.fin-badge')).map(badge => badge.textContent.trim()), accountCode: row.querySelector('td')?.textContent || '', agingBucket: row.dataset?.finAgingRow || '' }, term, status, category, aging);
      if (!row.hidden && row.style.display !== 'none') visible++;
    });
    const count = content.querySelector('[data-fin-visible-count]'); if (count) count.textContent = rows.length ? `${visible.toLocaleString('fa-IR')} از ${rows.length.toLocaleString('fa-IR')} مورد این صفحه` : '';
    const empty = content.querySelector('[data-fin-filter-empty]'); if (empty) empty.hidden = !rows.length || visible > 0;
    content.querySelectorAll('[data-fin-clear-list]').forEach(button => { button.hidden = !(String(term || '').trim() || status || category && category !== 'all' || aging && aging !== 'all'); });
    return { visible, total: rows.length };
  }

  function reviewMarkup(form, branch) {
    const fields = [...form.querySelectorAll('input[name],select[name],textarea[name]')].filter(field => field.type !== 'hidden' && !field.closest('[data-fin-journal-row]') && (field.type === 'checkbox' || field.value));
    const details = fields.map(field => {
      const label = field.closest('label')?.querySelector('span')?.textContent || field.name;
      const value = field.type === 'checkbox' ? field.checked ? 'بله' : 'خیر' : field.tagName === 'SELECT' ? [...field.selectedOptions].map(option => option.textContent).join('، ') : field.value;
      return `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`;
    }).join('');
    const journal = [...form.querySelectorAll('[data-fin-journal-row]')];
    const lines = journal.length ? `<div class="fin-table-wrap"><table class="fin-table"><caption>ردیف‌های سند · مبالغ به تومان</caption><thead><tr><th>حساب</th><th>شرح</th><th class="fin-numeric">بدهکار</th><th class="fin-numeric">بستانکار</th></tr></thead><tbody>${journal.map(row => `<tr>${['account', 'memo', 'debit', 'credit'].map((name, index) => `<td ${index > 1 ? 'class="fin-numeric"' : ''}>${esc(row.querySelector(`[name="${{ account: 'journalAccount', memo: 'journalMemo', debit: 'journalDebitToman', credit: 'journalCreditToman' }[name]}"]`)?.value || '—')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : '';
    const note = form.querySelector('.fin-note')?.textContent.trim() || '';
    return `<div class="fin-review-step">مرحلهٔ ۲ از ۲ · بازبینی</div><h3>اطلاعات را بررسی کنید</h3><p>شعبهٔ ${Number(branch).toLocaleString('fa-IR')} · ${esc(formLabels[form.id])}</p><dl>${details}</dl>${lines}${note ? `<p class="fin-review-context">${esc(note)}</p>` : ''}<div class="fin-head-actions"><button class="fin-btn primary" type="button" data-fin-confirm-form>تأیید اطلاعات و ادامه</button><button class="fin-btn secondary" type="button" data-fin-edit-form>بازگشت به ویرایش</button></div>`;
  }

  function showRecord(content, title, html) {
    content.querySelector('.fin-record-dialog')?.remove();
    const dialog = document.createElement('dialog'); dialog.className = 'fin-record-dialog'; dialog.setAttribute('aria-label', title);
    dialog.innerHTML = `<div class="fin-task-heading"><h3>${esc(title)}</h3><button type="button" class="fin-btn secondary" data-fin-close-record>بستن</button></div><div class="fin-record-body">${html}</div>`;
    content.append(dialog); dialog.querySelector('[data-fin-close-record]').addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', event => { const rect = dialog.getBoundingClientRect(); if (event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) dialog.close(); }); dialog.showModal();
  }

  const digits = value => String(value ?? '').replace(/[۰-۹]/g, char => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(char))).replace(/[٠-٩]/g, char => String('٠١٢٣٤٥٦٧٨٩'.indexOf(char)));
  function tomanToIrr(value) {
      const text = digits(value).trim() || '0';
      if (!/^(?:\d+|\d{1,3}(?:[٬,]\d{3})+)$/.test(text)) throw new Error('مبلغ باید تومانِ صحیح و نامنفی باشد.');
      const number = Number(text.replace(/[٬,]/g, ''));
      if (!Number.isSafeInteger(number) || number > Number.MAX_SAFE_INTEGER / 10) throw new Error('مبلغ ردیف از محدودهٔ امن ریال بیشتر است.');
      return number * 10;
  }
  function journalLines(rows, branchId, accounts = [], { allowUnbalanced = false } = {}) {
    if (!Number.isSafeInteger(Number(branchId)) || Number(branchId) < 1) throw new Error('ابتدا شعبه را انتخاب کنید.');
    if (rows.length < 2 || rows.length > 1000) throw new Error('سند باید بین دو تا هزار ردیف داشته باشد.');
    const allowed = new Set(accounts.filter(account => account.isPostingAccount !== false && account.active !== false).map(account => String(account.code)));
    const lines = rows.map((row, index) => {
      const match = digits(row.account).trim().match(/^(\d{4,10})(?:\s*·.*)?$/);
      if (!match || accounts.length && !allowed.has(match[1])) throw new Error(`حساب ردیف ${index + 1} معتبر نیست؛ یک حساب تفصیلی انتخاب کنید.`);
      const debitIrr = tomanToIrr(row.debit); const creditIrr = tomanToIrr(row.credit);
      if ((debitIrr > 0) === (creditIrr > 0)) throw new Error(`ردیف ${index + 1} باید یک مبلغ بدهکار یا بستانکارِ مثبت داشته باشد.`);
      return { accountCode: match[1], debitIrr, creditIrr, branchId: Number(branchId), costCenter: `branch:${branchId}`, memo: String(row.memo || '').slice(0, 300) };
    });
    const debitIrr = lines.reduce((sum, line) => sum + line.debitIrr, 0);
    const creditIrr = lines.reduce((sum, line) => sum + line.creditIrr, 0);
    if (!Number.isSafeInteger(debitIrr) || !Number.isSafeInteger(creditIrr)) throw new Error('جمع سند از محدودهٔ امن ریال بیشتر است.');
    if (!allowUnbalanced && debitIrr !== creditIrr) throw new Error('جمع بدهکار و بستانکار برابر نیست؛ سند را تراز کنید.');
    return { lines, debitIrr, creditIrr };
  }

  window.WestoAccountingExperience = Object.freeze({ views: Object.freeze(views), resolve, tabFor, routeFor, shell, compose, showTask, filterList, rowMatches, dateRange, datePreset, reviewMarkup, showRecord, formLabels, journalLines, tomanToIrr });
})();
