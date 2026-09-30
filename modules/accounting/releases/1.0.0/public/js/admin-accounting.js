/**
 * فضای مالی حسابدارمحور وستو.
 * پنج مقصد پایدار، شاخص‌های منبع‌دار و وضعیت‌های خالی/خطای صریح.
 */
(() => {
  'use strict';

  // The executable model is loaded before this script. Fail closed if it is
  // missing instead of maintaining a second, potentially divergent menu.
  const WORKSPACES = Array.isArray(window.WestoFinanceUiModel?.workspaces)
    ? window.WestoFinanceUiModel.workspaces
    : [];
  const STATUS_COPY = window.WestoFinanceUiModel?.statusCopy || Object.freeze({
    empty: 'هنوز فعالیتی ثبت نشده است',
    insufficientData: 'داده کافی برای محاسبه وجود ندارد',
    needsAction: 'نیازمند اقدام',
    awaitingApproval: 'در انتظار تأیید',
    informational: 'فقط برای اطلاع',
  });
  const REVIEW_TENDERS = Object.freeze([
    { id: 'cash', label: 'نقد' },
    { id: 'card', label: 'کارتخوان' },
    { id: 'manual_card', label: 'کارتخوان دستی' },
    { id: 'card_on_file', label: 'کارت ذخیره‌شده' },
    { id: 'online', label: 'درگاه' },
    { id: 'gateway', label: 'درگاه واسط' },
    { id: 'credit', label: 'اعتباری' },
    { id: 'gift_card', label: 'کارت هدیه' },
  ]);
  const state = { workspace: 'workbench', operation: 'journal', query: {}, payload: null, meta: null, loading: false, pages: {}, serverPages: { events: 1, migration: 1, uncaptured: 1, journals: 1, approvals: 1 }, request: null, focusRecordId: null, experience: false, view: 'home', section: '', task: '', search: '', listSearch: '', navigation: {}, auxiliary: {} };
  let root = null;
  let taxSetupRequestId = 0;
  let accessContext = { hasCapability: () => false, currentUser: () => null, branchCount: () => 0 };

  const can = (capability) => accessContext.hasCapability?.(capability) === true;
  const actorPhone = () => String(accessContext.currentUser?.()?.phone || '');
  const currentRole = () => String(accessContext.currentUser?.()?.role || '').toLowerCase();
  const activeBranchId = () => {
    const branchId = Number(state.query.branchId);
    return Number.isSafeInteger(branchId) && branchId > 0 ? branchId : null;
  };

  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const fa = (value) => window.WestoPersianFormat?.number(value, { locale: 'fa-IR' }) ?? Number(value || 0).toLocaleString('fa-IR');
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
    processing: 'پرداخت در حال انجام',
    succeeded: 'انجام‌شده', refunded: 'کاملاً برگشت‌خورده', cancelled: 'لغوشده',
    draft: 'پیش‌نویس', pending_approval: 'منتظر تأیید', open: 'باز', reopened: 'بازگشایی‌شده', soft_closed: 'بستهٔ مقدماتی', closed: 'بسته',
    received: 'کامل دریافت‌شده', partially_received: 'دریافت ناقص', partially_paid: 'بخشی پرداخت‌شده', match_exception: 'اختلاف تطبیق', match_rejected: 'اختلاف ردشده', matched: 'تطبیق‌شده', accepted_variance: 'اختلاف پذیرفته‌شده', unmatched: 'تطبیق‌نشده', exception: 'دارای اختلاف',
    active: 'فعال', inactive: 'غیرفعال', reversed: 'معکوس‌شده',
    verified: 'تأییدشده از منبع عملیاتی', inferred_needs_approval: 'قابل استنتاج؛ نیازمند تأیید', quarantined: 'قرنطینه‌شده',
    approved_for_backfill: 'مجاز برای بازسازی کنترل‌شده', keep_quarantined: 'در قرنطینه بماند', not_financial: 'غیرمالی', not_requested: 'درخواست نشده',
    inflow: 'واریز به بانک', outflow: 'برداشت از بانک',
    journal_entry: 'سند حسابداری', finance_event: 'رویداد مالی', fiscal_period: 'دورهٔ مالی', purchase_order: 'سفارش خرید', vendor_invoice_match: 'اختلاف تطبیق فاکتور', supplier_payment: 'پرداخت تأمین‌کننده',
    finance_refund: 'برگشت وجه مشتری', approve_purchase_order: 'تأیید سفارش خرید', approve_supplier_payment: 'تأیید پرداخت تأمین‌کننده', approve_customer_refund: 'تأیید برگشت وجه مشتری',
    resolve_three_way_match_variance: 'تصمیم اختلاف تطبیق سه‌سویه',
    cost_payment: 'پرداخت هزینهٔ دوره‌ای', approve_cost_accrual: 'تأیید ثبت دوره‌ای هزینه', approve_cost_payment: 'تأیید پرداخت هزینهٔ دوره‌ای',
    approve_asset_acquisition: 'تأیید خرید دارایی ثابت', approve_asset_depreciation: 'تأیید استهلاک ماهانه',
    payroll_payment: 'پرداخت بدهی حقوق', approve_payroll_run: 'تأیید لیست حقوق', approve_payroll_payment: 'تأیید پرداخت بدهی حقوق',
    post_legacy_order_backfill: 'پست بازسازی سفارش تاریخی', legacy_backfill: 'بازسازی تاریخی',
    opening_balance: 'مانده افتتاحیه', post_opening_balance: 'تأیید و پست مانده افتتاحیه',
    finance_branch_rollout: 'انتقال مالی شعبه', activate_finance_branch_cutover: 'فعال‌سازی پایگاه داده اصلی مالی برای شعبه',
    shadow: 'اجرای آزمایشی', cutover_active: 'مرجع اصلی فعال', branch_cutover_active: 'مرجع مالی شعبه فعال',
    NO_GO: 'آماده انتشار نیست', READY_FOR_CUTOVER_REVIEW: 'آماده بررسی انتقال نهایی', passed: 'عبور کرده', failed: 'ناموفق',
    net_salary: 'خالص حقوق کارکنان', social_security: 'بیمه پرداختنی', payroll_tax: 'مالیات حقوق', other_deductions: 'سایر کسورات',
    available: 'قابل محاسبه', insufficient_data: 'داده ناکافی', partial_coverage: 'پوشش ناقص', critical: 'فوری', warning: 'هشدار', normal: 'عادی',
    balanced: 'تراز', unbalanced: 'نامتوازن', rule_based: 'قاعده‌محور', snapshot_backed: 'مبتنی بر ثبت لحظه فروش', movement_backed: 'مبتنی بر گردش انبار', partial_valuation: 'ارزش‌گذاری ناقص',
    empty_period: 'بدون فعالیت', no_activity: 'بدون فعالیت', ready: 'آماده', partial: 'پوشش ناقص', insufficient: 'داده کافی نیست', incomplete: 'ناقص', positive: 'سود', negative: 'زیان', check_passed: 'کنترل موفق', check_failed: 'کنترل ناموفق',
    net_sales: 'فروش خالص قطعی', variable_cost: 'هزینه متغیر قطعی', fixed_cost: 'هزینه ثابت قطعی', fixed_cost_commitments: 'تعهد ثابت فعال',
  }[value] || value || 'نامشخص');
  const severity = (value) => value === 'critical' ? 'danger' : value === 'warning' ? 'warning' : 'neutral';

  const gateLabel = (value) => ({
    postgres_required: 'آمادگی پایگاه داده اصلی',
    complete_orders: 'سفارش‌های کامل آزمایشی',
    operating_days: 'روزهای عملیاتی آزمایشی',
    sales_reconciliation: 'تطبیق فروش و دفتر',
    data_quality: 'پاکی کامل داده‌ها',
    open_period: 'دوره مالی باز',
    unresolved_events: 'رویدادهای مالی حل‌نشده',
    pending_approvals: 'تأییدهای معطل',
    migration_baseline: 'خط مبنای انتقال داده',
    migration_archive_coverage: 'پوشش آرشیو انتقال داده',
    migration_decisions: 'پرونده‌های انتقال داده نیمه‌کاره',
  }[value] || String(value || 'کنترل نامشخص'));

  const issueLabel = (code, fallback) => ({
    paid_orders_without_finance_event: 'سفارش پرداخت‌شده بدون ثبت مالی',
    payment_tender_missing: 'روش پرداخت نامشخص',
    orphaned_finance_sale_events: 'رویداد فروش بدون سفارش معتبر',
    orphaned_finance_cogs_events: 'رویداد بهای تمام‌شده بدون سفارش معتبر',
    posted_sale_tender_evidence_missing: 'فروش قطعی بدون مدرک روش پرداخت',
    duplicate_settlement_batch: 'تسویه تکراری',
    duplicate_expense_candidate: 'هزینهٔ احتمالی تکراری',
    duplicate_depreciation_period: 'استهلاک تکراری',
    parallel_cash_models: 'وجود مدل صندوق موازی',
    blocked_finance_events: 'رویداد مالی مسدود',
    unmatched_card_gateway_payments: 'پرداخت کارت یا درگاه تطبیق‌نشده',
    posted_sale_payment_records_missing: 'فروش قطعی بدون رکورد پرداخت',
    normalized_postgres_not_active: 'پایگاه داده اصلی مالی فعال نیست',
  }[code] || fallback || 'هشدار کیفیت داده');

  const sourceKeyLabel = (value) => ({
    operationalSales: 'فروش عملیاتی',
    orders: 'سفارش‌ها',
    cash: 'صندوق',
    ledger: 'دفتر مالی جدید',
    legacyLedger: 'دفتر قدیمی',
    persistence: 'روش نگهداری داده',
  }[value] || String(value || 'منبع'));

  function sourceValueLabel(value) {
    const raw = String(value || 'ثبت نشده');
    const exact = {
      orders: 'سفارش‌های ثبت‌شده در عملیات',
      cashSessions: 'نشست‌های عملیاتی صندوق',
      'financeV2.journalEntries': 'اسناد قطعی دفتر مالی جدید',
      'legacyLedger/read-only': 'دفتر قدیمی، فقط خواندنی',
      'snapshot only (postgres_disabled)': 'فعلاً نسخه بازیابی؛ پایگاه داده اصلی فعال نیست',
      'WESTO Finance V2': 'دفتر مالی جدید وستو',
    };
    if (exact[raw]) return exact[raw];
    return raw
      .replace(/WESTO Finance V2/gi, 'دفتر مالی جدید وستو')
      .replace(/financeV2\.journalEntries/gi, 'اسناد دفتر مالی جدید')
      .replace(/cashSessions/gi, 'نشست‌های عملیاتی صندوق')
      .replace(/snapshot/gi, 'نسخه بازیابی')
      .replace(/postgres_disabled/gi, 'پایگاه داده اصلی غیرفعال')
      .replace(/read-only/gi, 'فقط خواندنی');
  }

  function businessText(value) {
    return String(value || '')
      .replace(/\s*\(متصل به POS\)/gi, ' (متصل به صندوق فروش)')
      .replace(/سیستم‌های IT/gi, 'سامانه‌های دیجیتال')
      .replace(/تجهیزات IT/gi, 'تجهیزات دیجیتال')
      .replace(/\s*\(GRNI\)/gi, '');
  }

  function financeSourceLabel(value) {
    const raw = String(value || 'manual');
    const exact = {
      manual: 'سند دستی',
      sale: 'فروش سفارش',
      'order.paid': 'پرداخت سفارش',
      'order.cogs': 'بهای تمام‌شده سفارش',
      'order.refund': 'بازپرداخت سفارش',
      'cash.movement': 'گردش صندوق',
      settlement: 'تسویه کارت یا درگاه',
      'purchase.goods_received': 'دریافت کالا',
      'purchase.vendor_invoice': 'فاکتور تأمین‌کننده',
      'purchase.supplier_payment': 'پرداخت تأمین‌کننده',
      'inventory.waste': 'ضایعات انبار',
      'inventory.stock_count': 'شمارش انبار',
      'inventory.production_batch': 'تولید دسته‌ای',
      depreciation: 'استهلاک دارایی',
      payroll: 'حقوق و دستمزد',
      opening_balance: 'مانده افتتاحیه',
      reversal: 'سند معکوس',
    };
    return exact[raw] || label(raw);
  }

  function legacySourceLabel(value) {
    const raw = String(value || 'legacy');
    return ({
      orders: 'سفارش قدیمی',
      settlements: 'تسویه قدیمی',
      expenses: 'هزینه قدیمی',
      depreciations: 'استهلاک قدیمی',
      accounting: 'دفتر قدیمی',
      legacy: 'داده قدیمی',
    }[raw] || 'داده قدیمی');
  }

  function friendlyValue(value) {
    if (value == null || value === '') return 'ثبت نشده';
    if (typeof value === 'boolean') return value ? 'بله' : 'خیر';
    if (Array.isArray(value)) return `${fa(value.length)} مورد`;
    if (typeof value === 'object') {
      const archived = value.archived ?? value.archivedRecords ?? value.covered;
      const expected = value.expected ?? value.expectedRecords ?? value.total;
      if (archived != null && expected != null) return `${fa(archived)} از ${fa(expected)}`;
      const numericValues = Object.values(value).filter((item) => Number.isFinite(Number(item)));
      return numericValues.length ? `${fa(numericValues.reduce((sum, item) => sum + Number(item), 0))} مورد` : 'نیازمند بررسی';
    }
    if (Number.isFinite(Number(value))) return fa(value);
    return label(value);
  }

  function gateValue(gate) {
    if (gate.target != null) return `${fa(gate.value)} از ${fa(gate.target)}`;
    if (gate.id === 'postgres_required') return gate.passed ? 'فعال و اجباری' : 'غیرفعال یا اختیاری';
    if (gate.id === 'sales_reconciliation') return Number(gate.value || 0) === 0 ? 'بدون اختلاف' : money(Math.abs(Number(gate.value || 0)));
    if (gate.id === 'open_period') return gate.value === 'missing' ? 'دوره‌ای ثبت نشده' : label(gate.value);
    if (gate.id === 'migration_baseline') return gate.value === 'missing' ? 'ثبت نشده' : `${fa(gate.value)} رکورد مبنا`;
    if (gate.id === 'migration_archive_coverage' && gate.value && typeof gate.value === 'object') {
      return `مفقود ${fa(gate.value.missing)} · تغییرکرده ${fa(gate.value.mismatched)} · خارج از خط مبنا ${fa(gate.value.newUnscoped)}`;
    }
    return friendlyValue(gate.value);
  }

  function readLocationQuery(extra = '') {
    const params = new URLSearchParams(location.search);
    const supplied = new URLSearchParams(String(extra || '').replace(/^\?/, ''));
    // The admin shell passes the canonical branch scope on every mount. When
    // a user changes branch, location.search can still contain the previous
    // branch until the shell renders again, so the supplied scope must win;
    // otherwise Finance silently reloads the old branch.
    supplied.forEach((value, key) => {
      if (key === 'branchId' || !params.has(key)) params.set(key, value);
    });
    state.workspace = WORKSPACES.some((item) => item.id === params.get('financeWorkspace')) ? params.get('financeWorkspace') : 'workbench';
    state.operation = ['journal', 'events', 'approvals', 'periods'].includes(params.get('financeOperation')) ? params.get('financeOperation') : 'journal';
    if (state.experience) {
      const oldOperation = params.has('financeOperation') && state.workspace === 'workbench'
        ? { journal: 'journals', events: 'issues', approvals: 'approvals', periods: 'periods' }[state.operation] : '';
      const view = window.WestoAccountingExperience.resolve(params.get('financeView') || oldOperation, state.workspace, state.operation);
      state.view = view.id;
      state.section = window.WestoAccountingExperience.tabFor(view, params.get('financeSection'));
      state.task = params.get('financeTask') || '';
      Object.assign(state, window.WestoAccountingExperience.routeFor(view, state.section));
    }
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
    if (state.experience) {
      params.set('financeView', state.view);
      state.section ? params.set('financeSection', state.section) : params.delete('financeSection');
      state.task ? params.set('financeTask', state.task) : params.delete('financeTask');
    }
    history.replaceState(null, '', `${location.pathname}?${params.toString()}${location.hash}`);
  }

  function requestQuery() {
    const params = new URLSearchParams();
    if (state.query.branchId) params.set('branchId', state.query.branchId);
    // Keep calendar filters date-only. The Finance V2 backend owns the
    // Tehran-local day boundary contract; sending a timezone-less timestamp
    // here would make the result depend on the host/server timezone.
    if (state.query.from) params.set('from', state.query.from);
    if (state.query.to) params.set('to', state.query.to);
    if (state.query.page > 1) params.set('page', String(state.query.page));
    if (state.workspace === 'workbench') {
      params.set('eventPage', String(state.serverPages.events || 1));
      params.set('migrationPage', String(state.serverPages.migration || 1));
      params.set('uncapturedPage', String(state.serverPages.uncaptured || 1));
      params.set('journalPage', String(state.serverPages.journals || 1));
      params.set('approvalPage', String(state.serverPages.approvals || 1));
    }
    params.set('pageSize', '25');
    return params.toString();
  }

  async function api(path, options = {}) {
    let response;
    try {
      response = await fetch(path, {
        ...options,
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...(options.headers || {}) },
      });
    } catch (error) {
      // A failed connection cannot tell the client whether a financial POST
      // reached and committed on the server.
      error.outcomeUnknown = true;
      error.code = error.code || 'finance_response_unknown';
      throw error;
    }
    const body = await response.json().catch(() => null);
    if (!response.ok || !body || body.error) {
      const message = body?.error?.message || body?.error || `پاسخ نامعتبر سرور (${response.status})`;
      const error = new Error(message);
      error.code = body?.error?.code || `http_${response.status}`;
      error.responseStatus = response.status;
      error.outcomeUnknown = response.status >= 500 || (response.ok && (!body || Boolean(body.error)));
      throw error;
    }
    return body;
  }

  const idempotencyKey = () => window.crypto?.randomUUID?.() || `fin-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const asciiDigits = (value) => String(value ?? '')
    .replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
    .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
    .replace(/[٬,٫\s]/g, '');
  const asciiNumber = (value) => Number(asciiDigits(value));
  const toast = (message, tone = 'success') => {
    if (typeof window.showToast === 'function') window.showToast(message, tone === 'danger' ? 'error' : tone, 2400);
  };

  async function mutation(path, body, button, options = {}) {
    if (button?.dataset.finBusy === '1') return null;
    const recoveryEnabled = options.recovery === true && Boolean(button);
    const requestKey = recoveryEnabled
      ? (button.dataset.finIdempotencyKey || idempotencyKey())
      : idempotencyKey();
    if (button) {
      button.dataset.finBusy = '1';
      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
      if (recoveryEnabled) {
        button.dataset.finIdempotencyKey = requestKey;
        button.dataset.finPendingVerification = '1';
      }
    }
    try {
      return await api(path, {
        method: 'POST',
        headers: { 'Idempotency-Key': requestKey },
        body: JSON.stringify(body || {}),
      });
    } catch (error) {
      if (recoveryEnabled && error.outcomeUnknown) {
        button.dataset.finOutcomeUnknown = '1';
      } else if (recoveryEnabled) {
        delete button.dataset.finIdempotencyKey;
        delete button.dataset.finPendingVerification;
        delete button.dataset.finOutcomeUnknown;
      }
      throw error;
    } finally {
      if (button) {
        delete button.dataset.finBusy;
        button.removeAttribute('aria-busy');
        if (!recoveryEnabled || button.dataset.finPendingVerification !== '1') button.disabled = false;
      }
    }
  }

  function finalizeRecoverableMutation(button) {
    if (!button) return;
    delete button.dataset.finIdempotencyKey;
    delete button.dataset.finPendingVerification;
    delete button.dataset.finOutcomeUnknown;
    button.disabled = false;
    button.removeAttribute('aria-busy');
  }

  function statusBadge(value, explicitTone) {
    const tone = explicitTone || (['posted', 'approved', 'paid', 'passed', 'succeeded', 'matched', 'accepted_variance', 'refunded'].includes(value) ? 'success' : ['blocked', 'rejected', 'match_rejected', 'failed', 'NO_GO'].includes(value) ? 'danger' : 'warning');
    return `<span class="fin-badge ${tone}">${esc(label(value))}</span>`;
  }

  function refundStatusBadge(value) {
    const states = {
      pending_approval: { text: 'منتظر تأیید مالک', tone: 'warning' },
      approved: { text: 'مجاز برای پرداخت؛ وجه منتقل نشده', tone: 'warning' },
      processing: { text: 'پرداخت در حال انجام؛ هنوز نهایی نیست', tone: 'warning' },
      succeeded: { text: 'برگشت وجه ثبت و با مدرک خروجی تطبیق شد', tone: 'success' },
      failed: { text: 'پرداخت ناموفق؛ بررسی لازم است', tone: 'danger' },
      cancelled: { text: 'درخواست لغو شده', tone: 'neutral' },
    };
    const state = states[String(value || '').toLowerCase()] || { text: 'وضعیت نامشخص؛ از ثبت دوباره خودداری کنید', tone: 'danger' };
    return `<span class="fin-badge ${state.tone}">${esc(state.text)}</span>`;
  }

  function metric(title, value, detail, tone = '') {
    const tonePill = tone === 'danger' ? '<span class="fin-metric-pill danger">مغایرت</span>' : tone === 'success' ? '<span class="fin-metric-pill success">تراز</span>' : '';
    return `<article class="fin-metric ${tone}"><div class="fin-metric-header"><span>${esc(title)}</span>${tonePill}</div><strong class="fin-metric-value">${value}</strong><small class="fin-metric-detail">${esc(detail)}</small></article>`;
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
        <table class="fin-table" ${state.experience ? `data-fin-table="${esc(id)}"` : ''}><thead><tr>${columns.map((column) => `<th>${esc(column.label)}</th>`).join('')}</tr></thead>
          <tbody>${visible.map((row) => `<tr ${state.experience && row.bucketKey ? `data-fin-aging-row="${esc(row.bucketKey)}"` : ''}>${columns.map((column) => `<td>${column.render ? column.render(row) : esc(row[column.key] ?? '—')}</td>`).join('')}</tr>`).join('')}</tbody>
        </table>
      </div>
      <div class="fin-pagination" aria-label="صفحه‌بندی جدول">
        <span>${fa(total)} رکورد · صفحه ${fa(current)} از ${fa(pages)}</span>
        <div><button type="button" ${pageAttr}="${esc(id)}" data-page="${current - 1}" ${current <= 1 ? 'disabled' : ''}>قبلی</button><button type="button" ${pageAttr}="${esc(id)}" data-page="${current + 1}" ${current >= pages ? 'disabled' : ''}>بعدی</button></div>
      </div>`;
  }

  function paginationControls(id, pagination, server = false) {
    const current = Math.max(1, Number(pagination?.page) || 1);
    const pages = Math.max(1, Number(pagination?.pages) || 1);
    const total = Math.max(0, Number(pagination?.total) || 0);
    if (total <= Number(pagination?.pageSize || 25) && pages <= 1) return '';
    const pageAttr = server === 'workbench' ? 'data-fin-workbench-page' : server ? 'data-fin-server-page' : 'data-fin-page';
    const pageScope = server === 'workbench' ? ` data-fin-page-scope="${esc(id)}"` : '';
    return `<div class="fin-pagination" aria-label="صفحه‌بندی ${esc(id)}">
      <span>${fa(total)} رکورد · صفحه ${fa(current)} از ${fa(pages)}</span>
      <div><button type="button" ${pageAttr}="${esc(id)}"${pageScope} data-page="${current - 1}" ${current <= 1 ? 'disabled' : ''}>قبلی</button><button type="button" ${pageAttr}="${esc(id)}"${pageScope} data-page="${current + 1}" ${current >= pages ? 'disabled' : ''}>بعدی</button></div>
    </div>`;
  }

  function renderShell() {
    if (state.experience) {
      root.innerHTML = window.WestoAccountingExperience.shell(state, localIsoDate());
      bindShell();
      return;
    }
    root.innerHTML = `
      <section class="finance-v2" data-display-mode="simple" aria-label="فضای کاری حسابداری">
        <nav class="fin-workspace-nav" aria-label="فضاهای کاری مالی">
          ${WORKSPACES.map((item) => {
            const shortLabel = { workbench: 'کارتابل', sales_bank: 'فروش و دریافت', purchases: 'خرید و هزینه', costing: 'مواد و بها', ledger_close: 'گزارش و دوره' }[item.id] || item.navLabel || item.label;
            return `<button type="button" data-fin-workspace="${item.id}" class="${item.id === state.workspace ? 'active' : ''}" aria-current="${item.id === state.workspace ? 'page' : 'false'}" aria-label="${esc(item.label)}" title="${esc(item.label)}"><b aria-hidden="true">${item.icon}</b><strong>${esc(shortLabel)}</strong></button>`;
          }).join('')}
        </nav>
        <div class="fin-context">
          <div class="fin-scope" data-fin-scope aria-label="محدودهٔ نمایش مالی"><span data-fin-period>بازه: تمام تاریخچه</span></div>
          <aside class="fin-header-status" data-fin-connection-state="loading" role="status" aria-live="polite">
            <span class="fin-dot" aria-hidden="true"></span><span><b>در حال بررسی داده‌ها</b><small>اتصال به دفتر مالی در حال بررسی است.</small></span>
          </aside>
        </div>
        <div class="fin-toolbar">
          <label class="fin-search"><span>جست‌وجو در مالی</span><input id="fin-global-search" type="search" placeholder="شماره سفارش، سند یا تأمین‌کننده" autocomplete="off"><div id="fin-search-results" class="fin-search-results" hidden></div></label>
          <div class="fin-presets" role="group" aria-label="فیلتر سریع تاریخ">
            <button type="button" class="fin-preset-btn ${!state.query.from && !state.query.to ? 'is-active' : ''}" data-fin-preset="all">همه</button>
            <button type="button" class="fin-preset-btn ${state.query.from === localIsoDate() && state.query.to === localIsoDate() ? 'is-active' : ''}" data-fin-preset="today">امروز</button>
            <button type="button" class="fin-preset-btn" data-fin-preset="7d">۷ روز</button>
            <button type="button" class="fin-preset-btn" data-fin-preset="30d">۳۰ روز</button>
          </div>
          <button class="fin-btn secondary fin-filter-toggle" id="fin-filter-toggle" type="button" aria-expanded="false" aria-controls="fin-date-controls">تغییر بازهٔ زمانی</button>
          <div class="fin-date-controls" id="fin-date-controls">
            <label>از<input id="fin-from" type="date" value="${esc(state.query.from)}"></label>
            <label>تا<input id="fin-to" type="date" value="${esc(state.query.to)}"></label>
            <button class="fin-btn secondary" id="fin-apply-filter" type="button">اعمال بازه</button>
          </div>
        </div>
        <div id="fin-workspace-content" role="region" aria-label="جزئیات فضای کاری مالی" aria-live="polite" tabindex="-1"></div>
      </section>`;
    bindShell();
  }

  function bindShell() {
    root.querySelectorAll('[data-fin-view]').forEach(button => button.addEventListener('click', () => navigateAccounting(button.dataset.finView)));
    root.querySelector('[data-fin-mobile-view]')?.addEventListener('change', event => navigateAccounting(event.target.value));
    root.querySelectorAll('[data-fin-workspace]').forEach((button) => button.addEventListener('click', () => {
      state.workspace = button.dataset.finWorkspace;
      state.pages = {};
      state.serverPages = { events: 1, migration: 1, uncaptured: 1, journals: 1, approvals: 1 };
      state.query.page = 1;
      persistQuery();
      renderShell();
      loadWorkspace();
    }));
    root.querySelectorAll('[data-fin-preset]').forEach((btn) => btn.addEventListener('click', () => {
      if (state.experience && !confirmLeaveAccountingTask()) return;
      const preset = btn.dataset.finPreset;
      const today = localIsoDate();
      if (preset === 'all') {
        state.query.from = '';
        state.query.to = '';
      } else if (preset === 'today') {
        state.query.from = today;
        state.query.to = today;
      } else if (preset === '7d') {
        const d = new Date();
        d.setDate(d.getDate() - 7);
        state.query.from = d.toISOString().slice(0, 10);
        state.query.to = today;
      } else if (preset === '30d') {
        const d = new Date();
        d.setDate(d.getDate() - 30);
        state.query.from = d.toISOString().slice(0, 10);
        state.query.to = today;
      }
      if (state.experience) Object.assign(state.query, window.WestoAccountingExperience.dateRange(preset, today));
      state.pages = {};
      state.query.page = 1;
      persistQuery();
      renderShell();
      loadWorkspace();
    }));
    const filterToggle = root.querySelector('#fin-filter-toggle');
    const dateControls = root.querySelector('#fin-date-controls');
    const activeWorkspace = root.querySelector('.fin-workspace-nav button.active');
    if (activeWorkspace && window.matchMedia('(max-width: 720px)').matches) {
      window.requestAnimationFrame(() => activeWorkspace.scrollIntoView({ block: 'nearest', inline: 'center' }));
    }
    filterToggle?.addEventListener('click', () => {
      const expanded = filterToggle.getAttribute('aria-expanded') === 'true';
      filterToggle.setAttribute('aria-expanded', String(!expanded));
      if (state.experience) {
        const toggleLabel = filterToggle.querySelector('span') || filterToggle;
        toggleLabel.textContent = expanded ? 'بازهٔ دلخواه' : 'بستن بازه';
      } else filterToggle.textContent = expanded ? 'تغییر بازهٔ زمانی' : 'بستن بازهٔ زمانی';
      dateControls.classList.toggle('is-open', !expanded);
    });
    root.querySelector('#fin-apply-filter').addEventListener('click', () => {
      if (state.experience && !confirmLeaveAccountingTask()) return;
      const fromInput = root.querySelector('#fin-from');
      const toInput = root.querySelector('#fin-to');
      const from = window.ShamsiDatePicker?.getISOValue(fromInput) || fromInput.dataset.isoDate || fromInput.value;
      const to = window.ShamsiDatePicker?.getISOValue(toInput) || toInput.dataset.isoDate || toInput.value;
      if (!state.experience) Object.assign(state.query, { from, to });
      const dateError = root.querySelector('#fin-date-error');
      if (from && to && from > to) {
        if (dateError) { dateError.textContent = 'تاریخ شروع باید پیش از تاریخ پایان باشد.'; dateError.hidden = false; }
        else renderError({ code: 'date_range_invalid', message: 'تاریخ شروع نمی‌تواند بعد از تاریخ پایان باشد.' });
        return;
      }
      if (dateError) dateError.hidden = true;
      Object.assign(state.query, { from, to });
      state.pages = {};
      state.query.page = 1;
      persistQuery();
      if (state.experience) renderShell();
      loadWorkspace();
    });
    const search = root.querySelector('#fin-global-search');
    let timer = null;
    search.addEventListener('input', () => {
      if (state.experience) state.search = search.value;
      clearTimeout(timer);
      const term = search.value.trim();
      if (term.length < 2) return closeSearch();
      timer = setTimeout(() => runSearch(term), 280);
    });
    search.addEventListener('keydown', event => {
      if (event.key === 'Escape') { if (state.experience) clearTimeout(timer); closeSearch(); }
      if (state.experience && event.key === 'ArrowDown') { const button = root.querySelector('#fin-search-results:not([hidden]) button'); if (button) { event.preventDefault(); button.focus(); } }
    });
  }

  function navigateAccounting(viewId, section = '', task = '', targetPage = null) {
    if (!state.experience) return;
    const view = window.WestoAccountingExperience.views.find(item => item.id === viewId);
    if (!view || !confirmLeaveAccountingTask()) return;
    state.navigation[`${state.view}:${state.section}`] = { listSearch: state.listSearch, listStatus: state.listStatus || '', listCategory: state.listCategory || 'all', listAging: state.listAging || 'all', listSort: { ...state.listSort }, pages: { ...state.pages }, page: state.query.page, serverPages: { ...state.serverPages } };
    state.view = view.id;
    state.section = window.WestoAccountingExperience.tabFor(view, section);
    Object.assign(state, window.WestoAccountingExperience.routeFor(view, state.section));
    state.task = task;
    const previous = state.navigation[`${state.view}:${state.section}`];
    state.listSearch = targetPage == null ? previous?.listSearch || '' : '';
    state.listStatus = targetPage == null ? previous?.listStatus || '' : '';
    state.listCategory = targetPage == null ? previous?.listCategory || 'all' : 'all';
    state.listAging = targetPage == null ? previous?.listAging || 'all' : 'all';
    state.listSort = targetPage == null ? previous?.listSort || {} : {};
    state.pages = targetPage == null ? previous?.pages || {} : {};
    state.query.page = targetPage || previous?.page || 1;
    state.serverPages = previous?.serverPages || { events: 1, migration: 1, uncaptured: 1, journals: 1, approvals: 1 };
    persistQuery(); renderShell();
    root.querySelector('.fin-experience')?.scrollIntoView({ block: 'start' });
    loadWorkspace();
  }

  function confirmLeaveAccountingTask() {
    const form = root?.querySelector('[data-fin-task-page]:not([hidden]) form');
    if (!form || form.dataset.finDirty !== 'true') return true;
    const changed = form.dataset.finInitialValues !== accountingFormSnapshot(form);
    return !changed || window.confirm('اطلاعات این فرم هنوز ثبت نشده است. از فرم خارج شوید؟');
  }

  function accountingFormSnapshot(form) {
    return JSON.stringify([...form.querySelectorAll('input[name],select[name],textarea[name]')].map(field => [
      field.name,
      field.type === 'checkbox' ? field.checked : field.tagName === 'SELECT' && field.multiple ? [...field.selectedOptions].map(option => option.value)
        : field.dataset.isoDate || (field.type === 'date' ? field.value : asciiDigits(field.value).replace(/[,٬]/g, '')),
    ]));
  }

  async function runSearch(term) {
    const target = root.querySelector('#fin-search-results');
    target.hidden = false;
    if (state.experience) root.querySelector('#fin-global-search')?.setAttribute('aria-expanded', 'true');
    target.innerHTML = '<span class="fin-search-wait">در حال جست‌وجو…</span>';
    try {
      const query = new URLSearchParams({ q: term, pageSize: '25' });
      if (state.query.branchId) query.set('branchId', state.query.branchId);
      if (state.query.from) query.set('from', state.query.from);
      if (state.query.to) query.set('to', state.query.to);
      const result = await api(`/api/admin/v2/finance/search?${query}`);
      if (state.experience && (!target.isConnected || root.querySelector('#fin-global-search')?.value.trim() !== term || target.hidden)) return;
      target.innerHTML = result.data.length ? result.data.map((item) => `<button type="button" data-fin-search-workspace="${esc(item.kind === 'order' ? 'sales_bank' : item.kind === 'vendor' ? 'purchases' : 'ledger_close')}" data-fin-search-id="${esc(item.id)}" data-fin-search-page="${esc(item.targetPage || 1)}" aria-label="مشاهده ${esc(item.label)} در بخش مرتبط"><span><strong>${esc(item.label)}</strong><small>${esc(label(item.kind))} · ${money(item.amountIrr)}</small></span><em>مشاهده</em></button>`).join('') : '<span class="fin-search-wait">نتیجه‌ای پیدا نشد.</span>';
      if (state.experience) target.onkeydown = event => {
        const buttons = [...target.querySelectorAll('button')]; const index = buttons.indexOf(event.target);
        if (event.key === 'Escape') { closeSearch(); root.querySelector('#fin-global-search')?.focus(); }
        else if (['ArrowDown', 'ArrowUp'].includes(event.key) && buttons.length) { event.preventDefault(); buttons[(index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length].focus(); }
      };
      target.querySelectorAll('[data-fin-search-workspace]').forEach((button) => button.addEventListener('click', () => {
        if (state.experience) {
          state.focusRecordId = button.dataset.finSearchId || null;
          const workspace = button.dataset.finSearchWorkspace;
          const view = workspace === 'sales_bank' ? 'sales' : workspace === 'purchases' ? 'purchases' : 'journals';
          navigateAccounting(view, workspace === 'purchases' ? 'vendors' : '', '', Math.max(1, Number(button.dataset.finSearchPage) || 1));
          return;
        }
        state.workspace = button.dataset.finSearchWorkspace;
        state.operation = 'journal';
        state.pages = {};
        state.query.page = Math.max(1, Number(button.dataset.finSearchPage) || 1);
        state.focusRecordId = button.dataset.finSearchId || null;
        persistQuery();
        closeSearch();
        renderShell();
        loadWorkspace();
      }));
    } catch (error) {
      if (state.experience && (!target.isConnected || root.querySelector('#fin-global-search')?.value.trim() !== term || target.hidden)) return;
      target.innerHTML = `<span class="fin-search-error">${esc(error.message)}</span>`;
    }
  }

  function closeSearch() {
    const target = root?.querySelector('#fin-search-results');
    if (target) { target.hidden = true; target.innerHTML = ''; }
    if (state.experience) root?.querySelector('#fin-global-search')?.setAttribute('aria-expanded', 'false');
  }

  async function loadWorkspace() {
    const content = root.querySelector('#fin-workspace-content');
    const accountingRequest = state.experience;
    const config = WORKSPACES.find((item) => item.id === state.workspace) || WORKSPACES[0];
    if (!config) {
      setFinanceConnectionState('error', 'مدل مالی بارگذاری نشد', 'صفحه را تازه‌سازی کنید یا با پشتیبانی تماس بگیرید.');
      content.innerHTML = '<div class="fin-error" role="alert"><span>!</span><div><strong>فضای مالی آماده نیست</strong><p>تعریف مسیرهای حسابداری بارگذاری نشد.</p></div><button type="button" id="fin-retry">تلاش دوباره</button></div>';
      content.querySelector('#fin-retry')?.addEventListener('click', () => location.reload());
      return false;
    }
    if (state.request) state.request.abort();
    state.request = new AbortController();
    const request = state.request;
    setFinanceConnectionState('loading', 'در حال بررسی داده‌ها', 'اتصال به دفتر مالی در حال بررسی است.');
    content.innerHTML = '<div class="fin-loading"><span></span><strong>در حال دریافت دادهٔ تأییدشده…</strong></div>';
    try {
      const query = requestQuery();
      const result = await api(`/api/admin/v2/finance/${config.endpoint}${query ? `?${query}` : ''}`, { signal: request.signal });
      if (accountingRequest && (request !== state.request || !content.isConnected)) return false;
      const auxiliary = {};
      if (state.experience) {
        const extra = [];
        if (state.view === 'journals') extra.push(['journals', 'journal-entries']);
        if (state.view === 'purchases' && state.section === 'expenses') extra.push(['expenses', 'operating-expenses']);
        const responses = await Promise.all(extra.map(async ([key, endpoint]) => {
          const response = await api(`/api/admin/v2/finance/${endpoint}?${query}`, { signal: request.signal });
          return [key, key === 'journals' ? { rows: response.data, pagination: response.meta?.pagination } : response.data];
        }));
        if (request !== state.request || !content.isConnected) return false;
        Object.assign(auxiliary, Object.fromEntries(responses));
        if ((state.view === 'journals' && can('finance.journal.create')) || (state.view === 'settings' && state.section === 'accounts')) {
          auxiliary.accounts = (await api('/api/admin/finance/coa', { signal: request.signal })).accounts || [];
        }
      }
      if (accountingRequest && (request !== state.request || !content.isConnected)) return false;
      state.auxiliary = auxiliary;
      state.payload = result.data;
      state.meta = result.meta;
      if (state.experience && state.view === 'purchases' && state.section === 'vendors' && state.focusRecordId) {
        const index = (state.payload.vendors || []).findIndex(row => String(row.id) === String(state.focusRecordId));
        if (index >= 0) state.pages.vendors = Math.floor(index / 25) + 1;
      }
      setFinanceScope(result.data?.currentPeriod || result.data?.selectedPeriod || null);
      setFinanceConnectionState('ready', 'دادهٔ مالی آماده است', 'اطلاعات این بخش از دفتر مالی دریافت شد.');
      renderWorkspace();
      focusSearchedRecord();
      return true;
    } catch (error) {
      if (accountingRequest && (request !== state.request || !content.isConnected)) return false;
      if (error.name !== 'AbortError') {
        setFinanceConnectionState('error', 'دادهٔ مالی در دسترس نیست', error.message || 'پاسخ قابل استفاده‌ای دریافت نشد.');
        renderError(error);
      }
      return false;
    }
  }

  function setFinanceConnectionState(stateName, title, detail) {
    const status = root?.querySelector('[data-fin-connection-state]');
    if (!status) return;
    status.dataset.finConnectionState = stateName;
    const strong = status.querySelector('b');
    const small = status.querySelector('small');
    if (strong) strong.textContent = title;
    if (small) small.textContent = detail;
  }

  function setFinanceScope(period = null) {
    const scope = root?.querySelector('[data-fin-scope]');
    if (!scope) return;
    const range = [state.query.from, state.query.to].filter(Boolean).map((item) => window.ShamsiCore?.formatShamsiDate(item) || item).join(' تا ') || 'تمام تاریخچه';
    const periodStateLabel = period && ['open', 'reopened'].includes(String(period.status || ''))
      ? 'دورهٔ فعال'
      : period && ['soft_closed', 'closed'].includes(String(period.status || ''))
        ? 'دورهٔ جاری برای مشاهده'
        : 'دورهٔ جاری';
    const periodLabel = period
      ? `${periodStateLabel}: ${dateOnly(period.startDate)} تا ${dateOnly(period.endDate)} · ${label(period.status)}`
      : `بازه: ${range}`;
    const branch = accessContext.branchCount?.() > 1 && state.query.branchId ? ` · شعبهٔ ${fa(state.query.branchId)}` : '';
    const target = scope.querySelector('[data-fin-period]');
    if (target) target.textContent = `${state.experience ? range : periodLabel}${branch}`;
    const periodStatus = scope.querySelector('[data-fin-period-status]');
    if (periodStatus) { periodStatus.textContent = period ? `دورهٔ مالی ${label(period.status)}` : 'دورهٔ مالی تعیین نشده'; periodStatus.title = period ? `${dateOnly(period.startDate)} تا ${dateOnly(period.endDate)}` : ''; }
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
    if (state.experience) {
      if (state.view === 'journals') {
        content.insertAdjacentHTML('beforeend', renderAccountingJournalHistory(state.auxiliary.journals));
        const form = content.querySelector('#fin-journal-form');
        if (form && state.auxiliary.accounts) form.outerHTML = renderAccountingJournalForm(state.auxiliary.accounts);
      }
      if (state.view === 'settings' && state.section === 'accounts') content.insertAdjacentHTML('beforeend', renderAccountingChartAccounts(state.auxiliary.accounts));
      if (state.view === 'purchases' && state.section === 'expenses') content.insertAdjacentHTML('beforeend', renderAccountingExpenseForm(state.auxiliary.expenses));
      const previousOperation = state.operation;
      state.operation = 'events';
      const workbenchHtml = state.auxiliary.workbench ? renderWorkbench(state.auxiliary.workbench) : '';
      state.operation = previousOperation;
      window.WestoAccountingExperience.compose(content, state, {
        ledgerHtml: state.auxiliary.ledger ? renderLedger(state.auxiliary.ledger) : '', workbenchHtml,
      });
    }
    bindContent();
    if (state.experience) bindAccountingExperience();
  }

  // Finance V2 keeps the whole workspace read-only for roles that can inspect
  // financial data but cannot perform a given mutation.  The API remains the
  // final authority, while this client-side gate prevents an accountant from
  // filling a purchase form that the server would reject (and makes the
  // separation of duties visible before submission).
  function applyCapabilityGates() {
    const capabilityLabels = {
      'finance.events.manage': 'مدیریت رویدادهای مالی',
      'finance.journal.create': 'ثبت و ارسال سند حسابداری',
      'finance.journal.post': 'ثبت سند معکوس',
      'finance.reconcile': 'تطبیق صندوق و بانک',
      'finance.payables.manage': 'مدیریت خرید و پرداختنی',
      'finance.settings.manage': 'مدیریت تنظیمات مالی',
    };
    const formRules = [
      ['#fin-settlement-form', 'finance.reconcile'],
      ['#fin-bank-line-form', 'finance.reconcile'],
      ['#fin-refund-form', 'finance.events.manage'],
      ['#fin-po-form', 'finance.payables.manage'],
      ['#fin-invoice-form', 'finance.payables.manage'],
      ['#fin-supplier-payment-form', 'finance.payables.manage'],
      ['#fin-cost-commitment-form', 'finance.payables.manage'],
      ['#fin-cost-accrual-form', 'finance.payables.manage'],
      ['#fin-cost-payment-form', 'finance.payables.manage'],
      ['#fin-journal-form', 'finance.journal.create'],
      ['#fin-operating-expense-form', 'finance.journal.create'],
      ['#fin-fixed-asset-form', 'finance.journal.create'],
      ['#fin-depreciation-form', 'finance.journal.create'],
      ['#fin-payroll-run-form', 'finance.journal.create'],
      ['#fin-payroll-payment-form', 'finance.journal.create'],
      ['#fin-opening-balance-form', 'finance.journal.create'],
      ['#fin-break-even-plan-form', 'finance.payables.manage'],
    ];
    const buttonRules = [
      ['[data-fin-capture-order]', 'finance.events.manage'],
      ['[data-fin-retry-ready-cogs]', 'finance.events.manage'],
      ['[data-fin-resolve-event]', 'finance.events.manage'],
      ['[data-fin-classify-legacy]', 'finance.events.manage'],
      ['[data-fin-legacy-decision]', 'finance.events.manage'],
      ['[data-fin-legacy-request]', 'finance.journal.create'],
      ['[data-fin-bank-match]', 'finance.reconcile'],
      ['[data-fin-submit-po]', 'finance.payables.manage'],
      ['[data-fin-request-match-review]', 'finance.payables.manage'],
      ['[data-fin-supplier-payment-request]', 'finance.payables.manage'],
      ['[data-fin-deactivate-cost]', 'finance.payables.manage'],
      ['[data-fin-reverse-opening]', 'finance.journal.post'],
      ['[data-fin-cutover-request]', 'finance.settings.manage'],
      ['[data-fin-submit-journal]', 'finance.journal.create'],
    ];
    const addNotice = (host, capability) => {
      if (!host || can(capability) || host.dataset.finCapabilityBlocked === 'true') return;
      host.dataset.finCapabilityBlocked = 'true';
      const notice = document.createElement('div');
      notice.className = 'fin-note warning fin-capability-block';
      notice.setAttribute('role', 'status');
      notice.innerHTML = `<strong>این عملیات برای سطح دسترسی فعلی فعال نیست</strong><span>${esc(capabilityLabels[capability] || capability)} فقط توسط کاربر مجاز انجام می‌شود؛ این صفحه در حالت مشاهده باقی می‌ماند.</span>`;
      host.insertBefore(notice, host.firstChild);
    };
    formRules.forEach(([selector, capability]) => {
      const form = root.querySelector(selector);
      if (!form || can(capability)) return;
      form.hidden = true;
      addNotice(form.closest('details') || form.parentElement || form, capability);
    });
    buttonRules.forEach(([selector, capability]) => {
      root.querySelectorAll(selector).forEach((button) => {
        if (can(capability)) return;
        button.hidden = true;
        addNotice(button.closest('details') || button.parentElement || button, capability);
      });
    });
  }

  function focusSearchedRecord() {
    if (!state.focusRecordId) return;
    const recordId = state.focusRecordId;
    state.focusRecordId = null;
    window.requestAnimationFrame(() => {
      const target = root.querySelector(`[data-fin-record-id="${CSS.escape(String(recordId))}"]`);
      if (!target) return;
      target.classList.add('fin-search-target');
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      target.focus({ preventScroll: true });
      window.setTimeout(() => target.classList.remove('fin-search-target'), 3000);
    });
  }

  function bindContent() {
    root.querySelectorAll('a[href^="#"]').forEach((link) => link.addEventListener('click', (event) => {
      const targetId = link.getAttribute('href');
      if (!targetId || targetId === '#') return;
      const target = root.querySelector(targetId);
      if (target) {
        event.preventDefault();
        if (state.experience && target.closest('[data-fin-task-page]')) openAccountingTask(target.closest('[data-fin-task-page]').dataset.finTaskPage);
        const details = target.closest('details');
        if (details) details.open = true;
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        target.querySelector('input:not([type="hidden"]), button, select, [tabindex]')?.focus();
      }
    }));
    root.querySelectorAll('[data-fin-goto]').forEach((button) => button.addEventListener('click', () => {
      if (state.experience) {
        const destination = { workbench: 'home', sales_bank: 'bank', purchases: 'purchases', costing: 'costing', ledger_close: 'reports' }[button.dataset.finGoto];
        navigateAccounting(destination || 'home', button.dataset.finGoto === 'costing' ? 'coverage' : '');
        return;
      }
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
    root.querySelectorAll('[data-fin-order-chain]').forEach((button) => button.addEventListener('click', async () => {
      const feedback = root.querySelector('#fin-operation-feedback');
      if (!feedback) return;
      button.disabled = true;
      try {
        const query = state.query.branchId ? `?branchId=${encodeURIComponent(state.query.branchId)}` : '';
        const result = await api(`/api/admin/v2/finance/orders/${encodeURIComponent(button.dataset.finOrderChain)}\/chain${query}`);
        const chain = result.data || {};
        const issueText = (chain.issues || []).map((issue) => esc(issue.message || label(issue.code))).join('، ') || 'مورد باز وجود ندارد.';
        feedback.innerHTML = `<div class="fin-note ${chain.status === 'complete' ? 'success' : 'warning'}" role="status"><strong>زنجیرهٔ سفارش ${esc(chain.order?.orderNo || chain.order?.id || button.dataset.finOrderChain)}</strong><span>وضعیت: ${esc(chain.statusLabel || label(chain.status))} · تطبیق پرداخت: ${esc(label(chain.reconciliationStatus || 'نامشخص'))}</span>${chain.issues?.length ? `<small>موارد نیازمند اقدام: ${issueText}</small>` : '<small>فروش، پرداخت، بهای تمام‌شده و برگشت وجه بررسی شد.</small>'}</div>`;
        if (state.experience) {
          window.WestoAccountingExperience.showRecord(root.querySelector('#fin-workspace-content'), 'جزئیات ثبت مالی سفارش', feedback.innerHTML);
          feedback.innerHTML = '';
          return;
        }
        feedback.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } catch (error) { operationError(error); }
      finally { button.disabled = false; }
    }));
    root.querySelectorAll('[data-fin-workbench-page]').forEach((button) => button.addEventListener('click', () => {
      const scope = button.dataset.finPageScope;
      if (!['events', 'migration', 'uncaptured', 'journals', 'approvals'].includes(scope)) return;
      state.serverPages[scope] = Number(button.dataset.page) || 1;
      loadWorkspace();
    }));
    root.querySelectorAll('[data-fin-export]').forEach((button) => button.addEventListener('click', () => exportCurrent(button.dataset.finExport)));
    root.querySelectorAll('[data-fin-copy-receiving-handoff]').forEach((button) => button.addEventListener('click', async () => {
      if (button.dataset.finCopyPending === '1') return;
      const text = button.dataset.finCopyReceivingHandoff || '';
      if (!text) return;
      button.dataset.finCopyPending = '1';
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(text);
        } else {
          const input = document.createElement('textarea');
          input.value = text;
          input.setAttribute('readonly', '');
          input.style.position = 'fixed'; input.style.opacity = '0';
          document.body.appendChild(input);
          input.select();
          const copied = document.execCommand('copy');
          input.remove();
          if (!copied) throw new Error('clipboard_unavailable');
        }
        button.textContent = 'کپی شد';
        button.setAttribute('aria-label', 'ارجاع دریافت کالا کپی شد');
        toast('شناسه سفارش و ردیف برای آشپز/انباردار کپی شد.', 'success');
        window.setTimeout(() => {
          button.textContent = 'کپی ارجاع';
          button.setAttribute('aria-label', 'کپی ارجاع دریافت کالا');
          delete button.dataset.finCopyPending;
        }, 1800);
      } catch (_) {
        delete button.dataset.finCopyPending;
        operationError({ code: 'receiving_handoff_copy_failed', message: 'کپی ارجاع انجام نشد؛ شناسه‌ها را از همین ردیف بردارید.' });
      }
    }));
    root.querySelector('[data-fin-cutover-request]')?.addEventListener('click', async (event) => {
      const button = event.currentTarget;
      if (!window.confirm('درخواست انتقال این شعبه برای تأیید مستقل ارسال شود؟ فعال‌سازی نهایی فقط پس از محاسبه دوباره همه گیت‌ها انجام می‌شود.')) return;
      try {
        await mutation(`/api/admin/v2/finance/rollout/${encodeURIComponent(state.query.branchId || '1')}/cutover-request`, {}, button);
        await refreshAfterMutation('درخواست انتقال شعبه ثبت شد؛ مالک یا مدیر دیگری باید آن را تأیید کند.');
      } catch (error) { operationError(error); }
    });
    root.querySelectorAll('[data-fin-operation]').forEach((button) => button.addEventListener('click', () => {
      if (state.experience) {
        const migration = /migration|legacy/.test(button.dataset.finQueueActionId || '');
        navigateAccounting(migration ? 'settings' : ({ journal: 'journals', events: 'issues', approvals: 'approvals', periods: 'periods' }[button.dataset.finOperation] || 'issues'), migration ? 'migration' : '');
        return;
      }
      state.operation = button.dataset.finOperation;
      state.query.page = 1;
      persistQuery();
      renderWorkspace();
      const specialistArea = root.querySelector('#fin-specialist-operations');
      if (specialistArea) specialistArea.open = true;
      root.querySelector('#fin-operations')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }));
    // Quick Pay button on open invoices
    root.querySelectorAll('[data-fin-quick-pay]').forEach((button) => button.addEventListener('click', () => {
      const invoiceId = button.dataset.finQuickPay;
      const amountToman = button.dataset.amountToman;
      if (state.experience) openAccountingTask('fin-supplier-payment-form');
      const payDetails = root.querySelector('#fin-supplier-payment-form')?.closest('details');
      if (payDetails) payDetails.open = true;
      const form = root.querySelector('#fin-supplier-payment-form');
      if (!form) return;
      const select = form.querySelector('[name="vendorInvoiceId"]');
      if (select) select.value = invoiceId;
      const amountInput = form.querySelector('[name="amountToman"]');
      if (amountInput) amountInput.value = amountToman || '';
      form.scrollIntoView({ behavior: 'smooth', block: 'center' });
      amountInput?.focus();
      toast(`فاکتور انتخاب و مبلغ ${fa(amountToman)} تومان درج شد.`, 'success');
    }));

    // Interactive AP Aging bucket filter
    root.querySelectorAll('[data-fin-aging-bucket]').forEach((card) => card.addEventListener('click', () => {
      const bucket = card.dataset.finAgingBucket;
      const isAlreadyActive = card.classList.contains('active');
      if (state.experience) {
        state.listAging = isAlreadyActive ? 'all' : bucket;
        root.querySelectorAll('[data-fin-aging-bucket]').forEach(button => { const active = button.dataset.finAgingBucket === state.listAging; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); });
        window.WestoAccountingExperience.filterList(root.querySelector('#fin-workspace-content'), state.listSearch, state.listStatus, state.listCategory, state.listAging);
        return;
      }
      root.querySelectorAll('[data-fin-aging-bucket]').forEach((c) => c.classList.remove('active'));
      if (!isAlreadyActive) card.classList.add('active');
      const activeBucket = isAlreadyActive ? 'all' : bucket;
      const invoiceRows = root.querySelectorAll('.fin-table tbody tr');
      invoiceRows.forEach((tr) => {
        if (activeBucket === 'all' || !activeBucket) {
          tr.style.display = '';
        } else {
          const text = tr.textContent;
          let match = false;
          if (activeBucket === 'days90Plus') match = text.includes('+۹۰');
          else if (activeBucket === 'days61_90') match = text.includes('۶۱-۹۰');
          else if (activeBucket === 'days31_60') match = text.includes('۳۱-۶۰');
          else if (activeBucket === 'current') match = text.includes('جاری');
          tr.style.display = match ? '' : 'none';
        }
      });
    }));

    // Trial Balance category tabs and live search
    root.querySelectorAll('[data-fin-trial-cat]').forEach((pill) => pill.addEventListener('click', () => {
      const cat = pill.dataset.finTrialCat;
      if (state.experience) {
        state.listCategory = cat;
        root.querySelectorAll('[data-fin-trial-cat]').forEach(button => { button.classList.toggle('active', button === pill); button.setAttribute('aria-pressed', String(button === pill)); });
        window.WestoAccountingExperience.filterList(root.querySelector('#fin-workspace-content'), state.listSearch, state.listStatus, state.listCategory, state.listAging);
        return;
      }
      root.querySelectorAll('[data-fin-trial-cat]').forEach((p) => p.classList.remove('active'));
      pill.classList.add('active');
      const tableRows = root.querySelectorAll('#fin-trial-balance-details .fin-table tbody tr');
      tableRows.forEach((tr) => {
        const firstCell = tr.querySelector('td')?.textContent?.trim() || '';
        if (cat === 'all' || firstCell.startsWith(cat)) {
          tr.style.display = '';
        } else {
          tr.style.display = 'none';
        }
      });
    }));

    root.querySelector('#fin-trial-search')?.addEventListener('input', (e) => {
      const q = e.target.value.trim().toLowerCase();
      const tableRows = root.querySelectorAll('#fin-trial-balance-details .fin-table tbody tr');
      tableRows.forEach((tr) => {
        const text = tr.textContent.toLowerCase();
        tr.style.display = (!q || text.includes(q)) ? '' : 'none';
      });
    });

    // Global keyboard shortcuts for workspace switching (Alt+1 to Alt+5)
    if (!window.__finShortcutsBound) {
      window.__finShortcutsBound = true;
      window.addEventListener('keydown', (e) => {
        if (e.altKey && e.key >= '1' && e.key <= '5') {
          if (state.experience) {
            if (!root?.querySelector('.fin-experience')) return;
            e.preventDefault();
            navigateAccounting({ '1': 'home', '2': 'sales', '3': 'purchases', '4': 'bank', '5': 'journals' }[e.key]);
            return;
          }
          const workspaceMap = { '1': 'workbench', '2': 'sales_bank', '3': 'purchases', '4': 'costing', '5': 'ledger_close' };
          const targetWs = workspaceMap[e.key];
          if (targetWs && targetWs !== state.workspace) {
            e.preventDefault();
            state.workspace = targetWs;
            persistQuery();
            renderShell();
            loadWorkspace();
          }
        }
      });
    }

    bindOperationActions();
    bindBreakEvenPlanning();
    bindBreakEvenPreview();
    applyCapabilityGates();
    const taxSetup = root.querySelector('[data-fin-tax-setup]');
    if (taxSetup) loadBranchTaxSetup(taxSetup);
  }

  async function loadBranchTaxSetup(panel, successMessage = '') {
    const requestId = ++taxSetupRequestId;
    const status = panel.querySelector('[data-fin-tax-status]');
    const content = panel.querySelector('[data-fin-tax-content]');
    const branchId = activeBranchId();
    if (!status || !content) return;
    if (!branchId) {
      status.className = 'fin-note warning';
      status.innerHTML = '<strong>شعبه انتخاب نشده</strong><span>از انتخابگر بالای پنل، شعبه را مشخص کنید؛ تنظیم مالیات بدون محدودهٔ شعبه در دسترس نیست.</span>';
      content.hidden = true;
      return;
    }
    status.className = 'fin-note';
    status.textContent = 'در حال دریافت قواعد همین شعبه…';
    content.hidden = true;
    try {
      const result = await api(`/api/admin/finance/tax-matrix?branchId=${encodeURIComponent(branchId)}`);
      if (requestId !== taxSetupRequestId || !panel.isConnected) return;
      const categories = Array.isArray(result.categories) ? result.categories.filter((item) => item && item.exempt !== true) : [];
      const rules = Array.isArray(result.rules) ? result.rules.filter((rule) => Number(rule.locationId) === Number(branchId)) : [];
      const categoryByCode = new Map(categories.map((category) => [String(category.code), category]));
      const ruleList = rules.length
        ? `<div class="fin-operation-list">${rules.map((rule) => {
          const category = categoryByCode.get(String(rule.taxCategory));
          const fulfillment = { dine_in: 'صرف داخل سالن', pickup: 'بیرون‌بر', delivery: 'ارسال' }[rule.fulfillmentType] || 'همهٔ روش‌ها';
          const effective = `${dateOnly(rule.effectiveFrom)}${rule.effectiveTo ? ` تا ${dateOnly(rule.effectiveTo)}` : ' به بعد'}`;
          return `<article><div><strong>${esc(rule.name)} · نسخه ${fa(rule.version || 1)}</strong><small>${esc(category?.label || category?.name || rule.taxCategory)} · ${esc(fulfillment)} · ${effective}</small><small>مأخذ: ${esc(rule.legalSource || 'ثبت نشده')}</small></div><div>${statusBadge(rule.status || 'active', rule.status === 'active' ? 'success' : 'neutral')}<b>${fa(Number(rule.rate) * 100)}٪ · شامل قیمت</b></div></article>`;
        }).join('')}</div>`
        : '<div class="fin-note warning"><strong>برای این شعبه قاعده‌ای ثبت نشده است</strong><span>تا ثبت قاعدهٔ معتبر و مؤثر، سفارش فاقد snapshot مالیاتی ثبت نمی‌شود.</span></div>';
      const categoryOptions = categories.map((category) => `<option value="${esc(category.code)}" ${String(category.code) === String(result.defaultCategory || '') ? 'selected' : ''}>${esc(category.label || category.name || category.code)}</option>`).join('');
      const globalSettingsForm = currentRole() === 'owner' ? `
        <form id="fin-tax-global-form" class="fin-form fin-form-wide" autocomplete="off">
          <div class="fin-form-title"><div><strong>دسته‌های مالیاتی کل رستوران</strong><small>این نگاشت سراسری است؛ نرخ و مأخذ هر قاعده همچنان جداگانه برای شعبه ثبت می‌شود.</small></div><span class="fin-badge warning">فقط مالک</span></div>
          <label class="fin-field"><span>دستهٔ پیش‌فرض کالاها</span><select name="defaultCategory" required>${categories.map((category) => `<option value="${esc(category.code)}" ${String(category.code) === String(result.defaultCategory || '') ? 'selected' : ''}>${esc(category.label || category.name || category.code)}</option>`).join('')}</select></label>
          <label class="fin-field"><span>دستهٔ هزینهٔ ارسال</span><select name="deliveryFeeTaxCategory"><option value="">تنظیم نشده · سفارش دارای هزینهٔ ارسال متوقف می‌شود</option>${categories.map((category) => `<option value="${esc(category.code)}" ${String(category.code) === String(result.deliveryFeeTaxCategory || '') ? 'selected' : ''}>${esc(category.label || category.name || category.code)}</option>`).join('')}</select></label>
          <div class="fin-note span-all"><strong>اثر این تغییر</strong><span>دستهٔ پیش‌فرض و هزینهٔ ارسال برای کل رستوران به‌روزرسانی می‌شود؛ پیش از ثبت، شعبه‌های دیگر را هم در نظر بگیرید.</span></div>
          <button class="fin-btn secondary span-all" type="submit" ${categories.length ? '' : 'disabled'}>ذخیرهٔ نگاشت سراسری</button>
          <p class="fin-form-feedback span-all" data-fin-tax-global-feedback role="status" aria-live="polite"></p>
        </form>` : '';
      content.innerHTML = `
        <div class="fin-note success"><strong>قیمت منو شامل مالیات است</strong><span>مالیات دوباره به مبلغ سفارش افزوده نمی‌شود. هر نرخ، مأخذ و بازهٔ اثر باید از مسئول مالی شعبه تأیید شود.</span></div>
        ${globalSettingsForm}
        ${ruleList}
        <form id="fin-tax-rule-form" class="fin-form fin-form-wide" autocomplete="off">
          <div class="fin-form-title"><div><strong>ثبت قاعدهٔ شعبه</strong><small>نرخ پیش‌فرض نداریم؛ تاریخ شروع، دسته، کد و مأخذ را از سند معتبر وارد کنید.</small></div><span class="fin-badge neutral">شعبه ${fa(branchId)}</span></div>
          <label class="fin-field"><span>دستهٔ مالیاتی</span><select name="taxCategory" required ${categories.length ? '' : 'disabled'}>${categoryOptions || '<option value="">دسته‌ای موجود نیست</option>'}</select></label>
          <label class="fin-field"><span>کد پایدار قاعده</span><input name="code" required minlength="2" maxlength="80" pattern="[A-Za-z0-9][A-Za-z0-9._-]{1,79}" dir="ltr" autocomplete="off"></label>
          <label class="fin-field"><span>عنوان قاعده</span><input name="name" required minlength="2" maxlength="120"></label>
          <label class="fin-field"><span>نرخ تأییدشده (%)</span><input name="ratePercent" type="number" inputmode="decimal" min="0" max="100" step="0.01" required></label>
          <label class="fin-field"><span>روش دریافت</span><select name="fulfillmentType"><option value="">همهٔ روش‌ها</option><option value="dine_in">صرف داخل سالن</option><option value="pickup">بیرون‌بر</option><option value="delivery">ارسال</option></select></label>
          <label class="fin-field"><span>شروع اثر</span><input name="effectiveFrom" type="date" required></label>
          <label class="fin-field"><span>پایان اثر (اختیاری)</span><input name="effectiveTo" type="date"></label>
          <label class="fin-field span-2"><span>مأخذ قانونی یا سند تأیید</span><input name="legalSource" required minlength="3" maxlength="500" autocomplete="off"></label>
          <div class="fin-note span-all"><strong>مبنای قیمت</strong><span>طبق تنظیم انتخاب‌شده، نرخ به‌صورت مالیاتِ داخل قیمت ثبت می‌شود.</span></div>
          <button class="fin-btn primary span-all" type="submit" ${categories.length ? '' : 'disabled'}>ثبت قاعده برای شعبهٔ ${fa(branchId)}</button>
          <p class="fin-form-feedback span-all" data-fin-tax-feedback role="status" aria-live="polite"></p>
        </form>`;
      content.hidden = false;
      status.className = successMessage ? 'fin-note success' : 'fin-note';
      status.textContent = successMessage || `تنظیمات فقط برای شعبهٔ ${fa(branchId)} نمایش داده می‌شود.`;
      const globalForm = content.querySelector('#fin-tax-global-form');
      globalForm?.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (!globalForm.reportValidity()) return;
        const submit = globalForm.querySelector('[type="submit"]');
        const feedback = globalForm.querySelector('[data-fin-tax-global-feedback]');
        const data = new FormData(globalForm);
        submit.disabled = true;
        submit.setAttribute('aria-busy', 'true');
        feedback.textContent = 'در حال ذخیرهٔ نگاشت سراسری…';
        try {
          await api('/api/admin/finance/tax-matrix', {
            method: 'PATCH',
            body: JSON.stringify({
              defaultCategory: String(data.get('defaultCategory') || ''),
              deliveryFeeTaxCategory: String(data.get('deliveryFeeTaxCategory') || ''),
            }),
          });
          await loadBranchTaxSetup(panel, 'نگاشت سراسری ذخیره شد؛ این تغییر بر همهٔ شعبه‌ها اثر دارد.');
          toast('نگاشت مالیاتی کل رستوران ذخیره شد.', 'success');
        } catch (error) {
          feedback.textContent = error.message || 'ذخیرهٔ نگاشت انجام نشد.';
          feedback.dataset.tone = 'danger';
          submit.disabled = false;
          submit.removeAttribute('aria-busy');
        }
      });
      const form = content.querySelector('#fin-tax-rule-form');
      form?.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (!form.reportValidity()) return;
        const submit = form.querySelector('[type="submit"]');
        const feedback = form.querySelector('[data-fin-tax-feedback]');
        const data = new FormData(form);
        const ratePercent = asciiNumber(data.get('ratePercent'));
        if (!Number.isFinite(ratePercent) || ratePercent < 0 || ratePercent > 100) {
          feedback.textContent = 'نرخ باید عددی بین صفر تا ۱۰۰ درصد باشد.';
          feedback.dataset.tone = 'danger';
          return;
        }
        submit.disabled = true;
        submit.setAttribute('aria-busy', 'true');
        feedback.textContent = 'در حال ثبت…';
        try {
          await api(`/api/admin/finance/tax-matrix/rule?branchId=${encodeURIComponent(branchId)}`, {
            method: 'POST',
            body: JSON.stringify({
              locationId: branchId,
              taxCategory: String(data.get('taxCategory') || ''),
              code: String(data.get('code') || '').trim(),
              name: String(data.get('name') || '').trim(),
              rate: ratePercent / 100,
              inclusive: true,
              fulfillmentType: String(data.get('fulfillmentType') || '') || null,
              effectiveFrom: String(data.get('effectiveFrom') || ''),
              effectiveTo: String(data.get('effectiveTo') || '') || null,
              legalSource: String(data.get('legalSource') || '').trim(),
            }),
          });
          form.reset();
          await loadBranchTaxSetup(panel, 'قاعدهٔ مالیاتی شعبه ثبت شد. قبل از استفاده، بازه و مأخذ را با مسئول مالی تطبیق دهید.');
          toast('قاعدهٔ مالیاتی شعبه ثبت شد.', 'success');
        } catch (error) {
          feedback.textContent = error.message || 'ثبت قاعده انجام نشد.';
          feedback.dataset.tone = 'danger';
          submit.disabled = false;
          submit.removeAttribute('aria-busy');
        }
      });
    } catch (error) {
      if (requestId !== taxSetupRequestId || !panel.isConnected) return;
      status.className = 'fin-note warning';
      status.textContent = `تنظیم مالیات دریافت نشد: ${error.message || 'خطای نامشخص'}`;
      content.hidden = true;
    }
  }

  function breakEvenPlanAmounts(plan) {
    const assumptions = Array.isArray(plan?.assumptions) ? plan.assumptions : [];
    const byCategory = (code) => assumptions.filter((row) => String(row.categoryCode || row.category || '') === code)
      // Persisted plans use monthlyAmountIrr; amountIrr is kept for legacy
      // planning snapshots. Reading only amountIrr silently reset every saved
      // plan back to zero when the costing workspace was reopened.
      .reduce((sum, row) => sum + Number(row.monthlyAmountIrr ?? row.amountIrr ?? 0), 0);
    const payroll = assumptions.find((row) => String(row.categoryCode || row.category || '') === 'payroll') || null;
    const classified = new Set(['rent', 'payroll', 'utilities']);
    return {
      rentToman: Math.round(byCategory('rent') / 10),
      payrollToman: Math.round(byCategory('payroll') / 10),
      utilitiesToman: Math.round(byCategory('utilities') / 10),
      otherFixedToman: Math.round(assumptions
        .filter((row) => !classified.has(String(row.categoryCode || row.category || '')))
        .reduce((sum, row) => sum + Number(row.monthlyAmountIrr ?? row.amountIrr ?? 0), 0) / 10),
      payrollHeadcount: Number.isSafeInteger(Number(payroll?.headcount)) ? Number(payroll.headcount) : 10,
      payrollSalaryToman: Number.isSafeInteger(Number(payroll?.salaryPerPersonIrr))
        ? Math.round(Number(payroll.salaryPerPersonIrr) / 10)
        : Math.round((byCategory('payroll') / 10) / Math.max(1, Number(payroll?.headcount) || 10)),
    };
  }

  function mountBreakEvenChart(dashboard) {
    const host = root.querySelector('#fin-break-even-chart');
    if (!host) return;
    if (!window.WestoBreakEvenChart?.mount) {
      host.innerHTML = empty('نمایش نمودار سودآوری بارگذاری نشد؛ صفحه را یک‌بار تازه‌سازی کنید.');
      return;
    }
    try {
      window.WestoBreakEvenChart.mount(host, dashboard?.chart || { status: 'insufficient_data' }, { currency: 'تومان' });
    } catch (error) {
      host.innerHTML = empty('نمودار سودآوری قابل نمایش نیست. دادهٔ برنامه را بررسی کنید.');
    }
  }

  function bindBreakEvenPlanning() {
    const dashboard = state.payload?.breakEvenDashboard || null;
    mountBreakEvenChart(dashboard);
    root.querySelector('#fin-break-even-plan-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const button = form.querySelector('button[type="submit"]');
      const values = Object.fromEntries(new FormData(form));
      const startDate = window.ShamsiDatePicker?.getISOValue(form.elements.startDate) || form.elements.startDate?.dataset.isoDate || values.startDate;
      const deadlineDate = window.ShamsiDatePicker?.getISOValue(form.elements.deadlineDate) || form.elements.deadlineDate?.dataset.isoDate || values.deadlineDate;
      const deadlineConfirmed = form.elements.deadlineConfirmed?.checked === true;
      const rentToman = asciiNumber(values.rentToman);
      const payrollHeadcount = asciiNumber(values.payrollHeadcount);
      const payrollSalaryToman = asciiNumber(values.payrollSalaryToman);
      const utilitiesToman = asciiNumber(values.utilitiesToman);
      const otherFixedToman = asciiNumber(values.otherFixedToman || 0);
      const payrollToman = payrollHeadcount * payrollSalaryToman;
      const amounts = [rentToman, payrollHeadcount, payrollSalaryToman, utilitiesToman, otherFixedToman, payrollToman];
      if (!deadlineConfirmed) {
        return operationError({ code: 'break_even_plan_deadline_confirmation_required', message: 'پیش از ذخیره، ددلاین واقعی سوددهی را تعیین و تأیید کنید.' }, '#fin-break-even-feedback');
      }
      if (!startDate || !deadlineDate || !Number.isSafeInteger(rentToman) || rentToman < 0
        || !Number.isSafeInteger(payrollHeadcount) || payrollHeadcount < 0 || payrollHeadcount > 10000
        || !Number.isSafeInteger(payrollSalaryToman) || payrollSalaryToman < 0
        || !Number.isSafeInteger(utilitiesToman) || utilitiesToman < 0
        || !Number.isSafeInteger(otherFixedToman) || otherFixedToman < 0
        || !Number.isSafeInteger(payrollToman) || payrollToman < 0
        || amounts.some((amount) => amount > Number.MAX_SAFE_INTEGER / 10)
        || rentToman + payrollToman + utilitiesToman + otherFixedToman <= 0) {
        return operationError({ code: 'break_even_plan_input_invalid', message: 'تاریخ و مبالغ پایه را با عدد صحیح و نامنفی وارد کنید؛ جمع هزینهٔ ثابت باید بزرگ‌تر از صفر باشد.' }, '#fin-break-even-feedback');
      }
      const assumptions = [
        { id: 'planning-rent-monthly', name: 'اجاره ماهانه مغازه', categoryId: 'facility-rent', categoryCode: 'rent', categoryName: 'اجاره محل', monthlyAmountIrr: rentToman * 10 },
        { id: 'planning-payroll-monthly', name: 'حقوق ماهانه نیروها', categoryId: 'payroll', categoryCode: 'payroll', categoryName: 'هزینه نیرو', monthlyAmountIrr: payrollToman * 10, headcount: payrollHeadcount, salaryPerPersonIrr: payrollSalaryToman * 10 },
        { id: 'planning-utilities-monthly', name: 'اشتراک ماهانه آب، برق و گاز', categoryId: 'utilities', categoryCode: 'utilities', categoryName: 'اشتراک آب، برق و گاز', monthlyAmountIrr: utilitiesToman * 10 },
        { id: 'planning-other-fixed-monthly', name: 'سایر هزینه‌های ثابت ماهانه', categoryId: 'other-fixed', categoryCode: 'other_fixed', categoryName: 'سایر هزینه ثابت', monthlyAmountIrr: otherFixedToman * 10 },
      ];
      try {
        await mutation('/api/admin/v2/finance/planning/break-even/plans', {
          planId: values.planId || undefined,
          branchId: Number(state.query.branchId) || 1,
          name: String(values.name || 'مبنای برنامهٔ سودآوری').trim(),
          startDate,
          deadlineDate,
          deadlineConfirmed,
          assumptions,
        }, button);
        await refreshAfterMutation('مبنای برنامه‌ای ذخیره شد؛ این داده وارد دفتر واقعی نشده است.');
      } catch (error) { operationError(error, '#fin-break-even-feedback'); }
    });
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
    if (target) target.innerHTML = `<div class="fin-note warning" role="alert"><strong>عملیات انجام نشد</strong><span>${esc(error.message)}${state.experience ? '' : ` · کد: ${esc(error.code || 'unknown')}`}</span></div>`;
  }

  async function refreshAfterMutation(message) {
    const refreshed = await loadWorkspace();
    toast(refreshed
      ? message
      : 'پاسخ ثبت از سرور دریافت شد، اما تازه‌سازی فهرست مالی ناموفق بود؛ وضعیت تازه پس از بازیابی اتصال بررسی شود.', refreshed ? 'success' : 'info');
    return refreshed;
  }

  function renderOperationReceipt(selector, title, record, fields, refreshed) {
    const target = root.querySelector(selector);
    const host = target || root.querySelector('#fin-workspace-content');
    if (!host || !record?.id) return;
    const fieldRows = [
      { label: 'شناسهٔ رسید', value: record.id },
      ...fields,
      ...(record.status ? [{ label: 'وضعیت ثبت‌شده', value: label(record.status) }] : []),
    ].filter((field) => field.value != null && field.value !== '');
    const markup = `<div class="fin-operation-receipt" data-fin-operation-receipt role="status" aria-live="polite">
      <div class="fin-operation-receipt__heading"><strong>رسید پاسخ سرور</strong><span class="fin-badge ${refreshed ? 'success' : 'warning'}">${refreshed ? 'فهرست تازه شد' : 'فهرست تازه نشد'}</span></div>
      <p>${esc(title)}${refreshed ? '؛ اطلاعات مالی دوباره بارگیری شد.' : '؛ اما تازه‌سازی فهرست ناموفق بود، پس وضعیت تازه را پس از بازیابی اتصال بررسی کنید.'}</p>
      <dl>${fieldRows.map((field) => `<div><dt>${esc(field.label)}</dt><dd>${esc(field.value)}</dd></div>`).join('')}</dl>
      ${!refreshed ? '<small class="fin-operation-receipt__caution">رسید پاسخ سرور موجود است؛ تا تازه‌شدن فهرست، این مورد را دوباره ثبت نکنید.</small>' : ''}
    </div>`;
    if (target) target.innerHTML = markup;
    else host.insertAdjacentHTML('afterbegin', markup);
    host.closest('details')?.setAttribute('open', '');
    host.setAttribute('tabindex', '-1');
    host.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
    host.focus?.({ preventScroll: true });
  }

  function renderUnknownOperation(selector, error, button, retry) {
    const target = root.querySelector(selector);
    if (!target) return;
    const key = button?.dataset.finIdempotencyKey || '';
    target.innerHTML = `<div class="fin-operation-unknown" role="alert" aria-live="assertive">
      <strong>نتیجهٔ عملیات نامعلوم است</strong>
      <span>پاسخ قطعی دریافت نشد؛ ممکن است ثبت در سرور انجام شده باشد. برای جلوگیری از ثبت تکراری، فرم را دوباره ارسال نکنید. نتیجه را با همان شناسهٔ امن پیگیری کنید.</span>
      ${key ? `<small>شناسهٔ پیگیری: <code>${esc(key)}</code></small>` : ''}
      <button class="fin-btn secondary" type="button" data-fin-recover-operation>بازیابی پاسخ با همان شناسه</button>
      <small>کد فنی: ${esc(error.code || 'finance_response_unknown')}</small>
    </div>`;
    toast('نتیجهٔ عملیات مالی نامعلوم است؛ تا بازیابی پاسخ، آن را دوباره ثبت نکنید.', 'info');
    target.querySelector('[data-fin-recover-operation]')?.addEventListener('click', async (event) => {
      const retryButton = event.currentTarget;
      retryButton.disabled = true;
      retryButton.setAttribute('aria-busy', 'true');
      await retry();
      retryButton.removeAttribute('aria-busy');
      retryButton.disabled = false;
    }, { once: true });
  }

  async function runRecoverableFinanceOperation({ path, body, button, feedbackSelector, receiptKey, receiptTitle, receiptFields, successMessage, lockButtonOnSuccess = false }) {
    const attempt = async () => {
      try {
        const result = await mutation(path, body, button, { recovery: true });
        const record = result?.data?.[receiptKey];
        if (!record?.id) {
          throw Object.assign(new Error('پاسخ عملیات رسید قابل تأیید ندارد.'), {
            code: 'finance_operation_receipt_missing', outcomeUnknown: true,
          });
        }
        finalizeRecoverableMutation(button);
        if (lockButtonOnSuccess && button) {
          button.dataset.finCompleted = '1';
          button.disabled = true;
          button.textContent = 'درخواست ثبت شد';
          button.setAttribute('aria-label', `${receiptTitle} با پاسخ سرور ثبت شد`);
        }
        const refreshed = await refreshAfterMutation(successMessage);
        renderOperationReceipt(feedbackSelector, receiptTitle, record, receiptFields(record, result.data), refreshed);
      } catch (error) {
        if (error.outcomeUnknown) {
          renderUnknownOperation(feedbackSelector, error, button, attempt);
          return;
        }
        finalizeRecoverableMutation(button);
        operationError(error, feedbackSelector);
      }
    };
    await attempt();
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
    const settlementForm = root.querySelector('#fin-settlement-form');
    const updateSettlementNet = () => {
      if (!settlementForm) return;
      const selected = [...settlementForm.querySelector('[name="paymentIds"]')?.selectedOptions || []];
      const grossIrr = selected.reduce((sum, option) => sum + asciiNumber(option.dataset.amountIrr || 0), 0);
      const feeToman = asciiNumber(settlementForm.elements.feeToman?.value || 0);
      const output = settlementForm.querySelector('[data-fin-settlement-net]');
      if (!output) return;
      if (!selected.length || !Number.isSafeInteger(feeToman) || feeToman < 0 || feeToman * 10 > grossIrr) {
        output.textContent = selected.length && feeToman * 10 > grossIrr ? 'کارمزد از ناخالص بیشتر است' : 'پس از انتخاب پرداخت‌ها محاسبه می‌شود';
        output.dataset.valueIrr = '';
        return;
      }
      output.dataset.valueIrr = String(grossIrr - feeToman * 10);
      output.textContent = money(grossIrr - feeToman * 10);
    };
    settlementForm?.querySelector('[name="paymentIds"]')?.addEventListener('change', updateSettlementNet);
    settlementForm?.elements.feeToman?.addEventListener('input', updateSettlementNet);
    updateSettlementNet();
    settlementForm?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const formData = new FormData(form);
      const values = Object.fromEntries(formData);
      const paymentIds = formData.getAll('paymentIds').map(String).filter(Boolean);
      const feeToman = asciiNumber(values.feeToman);
      const settledAt = window.ShamsiDatePicker?.getISOValue(form.elements.settledAt) || form.elements.settledAt.dataset.isoDate || values.settledAt;
      if (!paymentIds.length) return operationError({ code: 'settlement_payments_required', message: 'حداقل یک پرداخت داخل دسته انتخاب کنید.' });
      if (!Number.isSafeInteger(feeToman) || feeToman < 0 || feeToman > Number.MAX_SAFE_INTEGER / 10) return operationError({ code: 'settlement_amount_invalid', message: 'کارمزد باید عدد صحیح نامنفی باشد.' });
      const branchId = activeBranchId();
      if (!branchId) return operationError({ code: 'finance_branch_required', message: 'شعبهٔ فعال مشخص نیست؛ برای جلوگیری از ثبت در شعبهٔ اشتباه، ابتدا شعبه را انتخاب کنید.' }, '#fin-settlement-feedback');
      await runRecoverableFinanceOperation({
        path: '/api/admin/v2/finance/reconciliation/settlements',
        body: {
          branchId, paymentIds, psp: values.psp,
          terminalId: values.terminalId, batchNo: values.batchNo, feeIrr: feeToman * 10,
          bankReference: values.bankReference,
          settledAt: `${settledAt}T12:00:00.000Z`,
        },
        button: form.querySelector('button[type="submit"]'),
        feedbackSelector: '#fin-settlement-feedback', receiptKey: 'settlement',
        receiptTitle: 'دستهٔ تسویه در سامانه ثبت شد',
        receiptFields: (record, data) => [
          { label: 'درگاه / شرکت پرداخت', value: record.psp },
          { label: 'شمارهٔ دسته', value: record.batchNo },
          { label: 'مبلغ خالص', value: money(record.amountIrr) },
          { label: 'سند دفتر', value: data.journalEntry?.number || data.journalEntry?.id || record.journalEntryId },
        ],
        successMessage: 'رسید دستهٔ تسویه از سرور دریافت و فهرست مالی تازه شد.',
      });
    });
    root.querySelector('#fin-bank-line-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const values = Object.fromEntries(new FormData(form));
      const amountToman = asciiNumber(values.amountToman);
      const occurredAt = window.ShamsiDatePicker?.getISOValue(form.elements.occurredAt) || form.elements.occurredAt.dataset.isoDate || values.occurredAt;
      if (!Number.isSafeInteger(amountToman) || amountToman <= 0 || amountToman > Number.MAX_SAFE_INTEGER / 10) return operationError({ code: 'bank_statement_amount_invalid', message: 'مبلغ گردش بانک باید عدد صحیح و بزرگ‌تر از صفر باشد.' }, '#fin-bank-feedback');
      const branchId = activeBranchId();
      if (!branchId) return operationError({ code: 'finance_branch_required', message: 'شعبهٔ فعال مشخص نیست؛ برای جلوگیری از ثبت در شعبهٔ اشتباه، ابتدا شعبه را انتخاب کنید.' }, '#fin-bank-feedback');
      await runRecoverableFinanceOperation({
        path: '/api/admin/v2/finance/reconciliation/bank-statement-lines',
        body: {
          branchId, bankReference: values.bankReference,
          bankAccountCode: values.bankAccountCode, direction: values.direction,
          amountIrr: amountToman * 10, occurredAt: `${occurredAt}T12:00:00.000Z`, description: values.description,
        },
        button: form.querySelector('button[type="submit"]'),
        feedbackSelector: '#fin-bank-feedback', receiptKey: 'statementLine',
        receiptTitle: 'گردش صورت‌حساب بانک در صف تطبیق ثبت شد',
        receiptFields: (record) => [
          { label: 'شناسهٔ یکتای بانک', value: record.bankReference },
          { label: 'مبلغ گردش', value: money(record.amountIrr) },
          { label: 'حساب بانکی', value: record.details?.bankAccountCode },
          { label: 'جهت گردش', value: label(record.details?.direction) },
        ],
        successMessage: 'رسید گردش بانک از سرور دریافت و فهرست مالی تازه شد.',
      });
    });
    root.querySelectorAll('[data-fin-bank-match]').forEach((button) => button.addEventListener('click', async () => {
      const statementLineId = button.dataset.finBankMatch;
      const journalEntryId = root.querySelector(`[data-fin-bank-candidate="${CSS.escape(statementLineId)}"]`)?.value;
      if (!journalEntryId) return operationError({ code: 'bank_match_journal_required', message: 'یک سند قطعی با مبلغ، جهت، شعبه و حساب یکسان انتخاب کنید.' }, '#fin-bank-feedback');
      await runRecoverableFinanceOperation({
        path: `/api/admin/v2/finance/reconciliation/bank-statement-lines/${encodeURIComponent(statementLineId)}/match`,
        body: { journalEntryId }, button,
        feedbackSelector: '#fin-bank-feedback', receiptKey: 'statementLine',
        receiptTitle: 'تطبیق گردش بانک با سند دفتر ثبت شد',
        receiptFields: (record, data) => [
          { label: 'شناسهٔ بانکی', value: record.bankReference },
          { label: 'سند تطبیق‌یافته', value: data.journalEntry?.number || data.journalEntry?.id || record.journalEntryId },
          { label: 'مبلغ', value: money(record.amountIrr) },
          { label: 'تطبیق‌دهنده', value: record.matchedBy },
        ],
        successMessage: 'رسید تطبیق از سرور دریافت و فهرست مالی تازه شد.',
      });
    }));
    root.querySelector('#fin-refund-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const submitButton = form.querySelector('button[type="submit"]');
      if (submitButton?.dataset.finCompleted === '1') return;
      const values = Object.fromEntries(new FormData(form));
      const selected = form.elements.paymentId.selectedOptions[0];
      const orderId = selected?.dataset.orderId;
      const amountToman = asciiNumber(values.amountToman);
      const refundDate = window.ShamsiDatePicker?.getISOValue(form.elements.refundDate) || form.elements.refundDate.dataset.isoDate || values.refundDate;
      const reason = String(values.reason || '').trim();
      if (!orderId || !values.paymentId) return operationError({ code: 'refund_payment_required', message: 'پرداخت مبدأ را انتخاب کنید.' });
      if (!Number.isSafeInteger(amountToman) || amountToman <= 0 || amountToman > Number.MAX_SAFE_INTEGER / 10) return operationError({ code: 'refund_amount_invalid', message: 'مبلغ برگشت باید عدد صحیح و بزرگ‌تر از صفر باشد.' });
      if (Array.from(reason).filter((character) => !/\s/u.test(character)).length < 10 || reason.length > 300) {
        operationError({ code: 'refund_reason_not_meaningful', message: 'علت را روشن و دست‌کم با ۱۰ نویسهٔ غیرخالی بنویسید.' }, '#fin-operation-feedback');
        form.elements.reason.focus();
        return;
      }
      const confirmation = [
        `درخواست برگشت ${fa(amountToman)} تومان از پرداخت سفارش ${orderId} ثبت شود؟`,
        `علت: ${reason}`,
        'این مرحله فقط درخواست را برای تأیید مالک می‌فرستد؛ وجه اکنون منتقل نمی‌شود.',
      ].join('\n');
      if (!window.confirm(confirmation)) return;
      await runRecoverableFinanceOperation({
        path: `/api/admin/v2/finance/orders/${encodeURIComponent(orderId)}/refund-requests`,
        body: {
          paymentId: values.paymentId, amountIrr: amountToman * 10,
          refundDate: `${refundDate}T12:00:00.000Z`, reason,
        },
        button: submitButton,
        feedbackSelector: '#fin-operation-feedback',
        receiptKey: 'refund',
        receiptTitle: 'درخواست بازپرداخت ثبت شد',
        receiptFields: (record) => [
          { label: 'سفارش', value: record.orderId },
          { label: 'پرداخت مبدأ', value: record.paymentId },
          { label: 'مبلغ درخواستی', value: money(record.amountIrr) },
        ],
        successMessage: 'رسید درخواست بازپرداخت از سرور دریافت شد؛ وجه هنوز منتقل نشده است.',
        lockButtonOnSuccess: true,
      });
    });
    const poForm = root.querySelector('#fin-po-form');
    const poLines = poForm?.querySelector('[data-fin-po-lines]');
    const syncPurchaseUnit = (select) => {
      const row = select?.closest('[data-fin-po-row]');
      const unit = row?.querySelector('[name="poUnit"]');
      if (unit) unit.value = select.selectedOptions[0]?.dataset.unit || '';
    };
    poLines?.addEventListener('change', (event) => {
      if (event.target.matches('[name="poItemId"]')) syncPurchaseUnit(event.target);
    });
    poLines?.addEventListener('click', (event) => {
      const remove = event.target.closest('[data-fin-remove-po-row]');
      if (!remove) return;
      if (poLines.querySelectorAll('[data-fin-po-row]').length <= 1) return operationError({ code: 'purchase_order_lines_missing', message: 'سفارش خرید باید حداقل یک ردیف داشته باشد.' });
      remove.closest('[data-fin-po-row]')?.remove();
    });
    root.querySelector('[data-fin-add-po-row]')?.addEventListener('click', () => {
      const template = root.querySelector('#fin-po-line-template');
      if (!template || !poLines) return;
      poLines.append(template.content.cloneNode(true));
    });
    const invoiceForm = root.querySelector('#fin-invoice-form');
    const invoiceLines = invoiceForm?.querySelector('[data-fin-invoice-lines]');
    const syncInvoiceReceiptScope = () => {
      if (!invoiceLines) return;
      const selects = [...invoiceLines.querySelectorAll('[name="invoiceReceiptLine"]')];
      const selectedGrnId = selects.map((select) => String(select.value || '').split('|')[0]).find(Boolean) || '';
      selects.forEach((select) => {
        if (select.value && String(select.value).split('|')[0] !== selectedGrnId) select.value = '';
        [...select.options].forEach((option) => {
          const optionGrnId = String(option.value || '').split('|')[0];
          option.disabled = Boolean(selectedGrnId && optionGrnId && optionGrnId !== selectedGrnId);
        });
      });
      invoiceForm.dataset.goodsReceiptId = selectedGrnId;
    };
    invoiceLines?.addEventListener('change', (event) => {
      if (event.target.matches('[name="invoiceReceiptLine"]')) syncInvoiceReceiptScope();
    });
    invoiceLines?.addEventListener('click', (event) => {
      const remove = event.target.closest('[data-fin-remove-invoice-row]');
      if (!remove) return;
      if (invoiceLines.querySelectorAll('[data-fin-invoice-row]').length <= 1) return operationError({ code: 'vendor_invoice_lines_missing', message: 'فاکتور باید حداقل یک ردیف داشته باشد.' });
      remove.closest('[data-fin-invoice-row]')?.remove();
      syncInvoiceReceiptScope();
    });
    root.querySelector('[data-fin-add-invoice-row]')?.addEventListener('click', () => {
      const template = root.querySelector('#fin-invoice-line-template');
      if (!template || !invoiceLines) return;
      invoiceLines.append(template.content.cloneNode(true));
      syncInvoiceReceiptScope();
    });
    root.querySelector('#fin-journal-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      if (state.experience && form.querySelector('[data-fin-journal-lines]')) {
        await submitAccountingJournal(form);
        return;
      }
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

    root.querySelector('[data-fin-retry-ready-cogs]')?.addEventListener('click', async (event) => {
      const button = event.currentTarget;
      const confirmed = window.confirm('فقط سفارش‌های دارای دستور تهیهٔ مؤثر، قیمت ریالی و موجودی کافی بررسی می‌شوند. برای هر مورد کامل، یک سند بهای تمام‌شده و حرکت مصرف انبار ثبت می‌شود. ادامه می‌دهید؟');
      if (!confirmed) return;
      try {
        const result = await mutation('/api/admin/v2/finance/events/cogs/retry-ready', {
          branchId: Number(state.query.branchId) || 1,
          confirmed: true,
        }, button);
        const summary = result?.data || {};
        await refreshAfterMutation(`${fa(summary.posted || 0)} مورد ثبت شد؛ ${fa(summary.stillBlocked || 0)} مورد هنوز دادهٔ کامل ندارد، ${fa(summary.skipped || 0)} مورد برای این نوبت ثبت نشد و ${fa(summary.remainingBlocked || 0)} مورد در صف باقی ماند.`);
      } catch (error) { operationError(error); }
    });

    root.querySelectorAll('[data-fin-resolve-event]').forEach((button) => button.addEventListener('click', async () => {
      const eventId = button.dataset.finResolveEvent;
      const source = button.dataset.finSource;
      let body;
      if (source === 'order.paid') {
        const tenderControls = [...root.querySelectorAll(`[data-fin-event-tender-amount="${CSS.escape(eventId)}"]`)];
        if (tenderControls.length) {
          const tenders = tenderControls.map((input) => ({
            tender: input.dataset.tender,
            amountIrr: (() => {
              const amountToman = asciiNumber(input.value || 0);
              const amountIrr = amountToman * 10;
              return Number.isSafeInteger(amountToman) && Number.isSafeInteger(amountIrr) && amountIrr > 0 ? amountIrr : 0;
            })(),
          })).filter((row) => row.amountIrr > 0);
          if (!tenders.length) {
            operationError({ code: 'reviewed_tenders_required', message: 'حداقل یک روش پرداخت معتبر وارد کنید.' });
            return;
          }
          if (tenders.reduce((sum, row) => sum + row.amountIrr, 0) !== Number(button.dataset.finAmountIrr)) {
            operationError({ code: 'reviewed_tenders_mismatch', message: 'جمع روش‌های پرداخت باید دقیقاً برابر مبلغ رویداد باشد.' });
            return;
          }
          const evidenceReference = root.querySelector(`[data-fin-event-evidence="${CSS.escape(eventId)}"]`)?.value?.trim();
          body = { tenders, evidenceReference };
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
        const branch = encodeURIComponent(state.query.branchId || '1');
        const result = await mutation(`/api/admin/v2/finance/migration/classify?branchId=${branch}`, {}, event.currentTarget);
        const created = result?.data?.created || 0;
        const sourceCount = result?.data?.baseline?.sourceCount || 0;
        await refreshAfterMutation(`${fa(created)} رکورد به آرشیو خواندنی افزوده و خط مبنای ${fa(sourceCount)} رکوردی ثبت شد؛ هیچ سندی ثبت و هیچ داده‌ای حذف نشد.`);
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
      const isCustomerRefund = button.dataset.finApprovalOperation === 'approve_customer_refund';
      if (decision === 'approved') {
        const confirmMessage = isCustomerRefund
          ? 'این تأیید فقط مجوز برگشت وجه است؛ هنوز پولی منتقل نشده. درخواست را تأیید می‌کنید؟'
          : 'این درخواست تأیید شود؟ اثر مالی فقط پس از انجام فرایند مربوط ثبت خواهد شد.';
        if (!window.confirm(confirmMessage)) return;
      }
      const comment = root.querySelector(`[data-fin-approval-comment="${CSS.escape(approvalId)}"]`)?.value || '';
      try {
        await mutation(`/api/admin/v2/finance/approvals/${encodeURIComponent(approvalId)}/decision`, { decision, comment }, button);
        const successMessage = decision !== 'approved'
          ? 'درخواست با ردپای کامل رد شد.'
          : isCustomerRefund
            ? 'درخواست برگشت وجه تأیید شد؛ هنوز وجهی منتقل نشده است. پس از پرداخت، مدرک خروجی و تطبیق لازم است.'
            : 'درخواست تأیید شد؛ اثر مالی پس از انجام فرایند مربوط ثبت خواهد شد.';
        await refreshAfterMutation(successMessage);
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
        await mutation('/api/admin/v2/finance/fiscal-periods', {
          name: values.name,
          startDate,
          endDate,
          branchId: Number(state.query.branchId) || 1,
        }, submit);
        await refreshAfterMutation('دورهٔ مالی جدید ایجاد شد.');
      } catch (error) { operationError(error); }
    });

    root.querySelectorAll('[data-fin-reopen-form]').forEach((form) => form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const target = event.currentTarget;
      const button = target.querySelector('button[type="submit"]');
      const reason = String(new FormData(target).get('reason') || '').trim();
      if (reason.length < 3) {
        operationError({ code: 'period_reopen_reason_required', message: 'علت بازگشایی را حداقل در سه نویسه وارد کنید.' });
        return;
      }
      try {
        await mutation(`/api/admin/v2/finance/fiscal-periods/${encodeURIComponent(target.dataset.finReopenPeriod)}/reopen-request`, {
          branchId: Number(state.query.branchId) || 1,
          reason,
        }, button);
        await refreshAfterMutation('درخواست بازگشایی ثبت شد؛ تصمیم باید توسط مدیر یا مالک مستقل انجام شود.');
      } catch (error) { operationError(error); }
    }));

    root.querySelectorAll('[data-fin-close-period]').forEach((button) => button.addEventListener('click', async () => {
      const preliminary = button.dataset.finCloseMode !== 'final';
      const prompt = preliminary
        ? 'دوره به‌صورت مقدماتی بسته شود؟ ثبت‌های جدید تا بازگشایی کنترل‌شده متوقف می‌شوند.'
        : 'دوره به‌صورت نهایی بسته شود؟ این اقدام پس از عبور همهٔ کنترل‌ها قابل بازگشت مستقیم نیست.';
      if (!window.confirm(prompt)) return;
      try {
        await mutation(`/api/admin/v2/finance/fiscal-periods/${encodeURIComponent(button.dataset.finClosePeriod)}/close`, {
          preliminary, branchId: Number(state.query.branchId) || undefined,
        }, button);
        await refreshAfterMutation(preliminary ? 'دوره به‌صورت مقدماتی بسته شد.' : 'دوره به‌صورت نهایی بسته شد.');
      } catch (error) { operationError(error); }
    }));

    poForm?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const values = Object.fromEntries(new FormData(form));
      const lines = [...form.querySelectorAll('[data-fin-po-row]')].map((row) => {
        const item = row.querySelector('[name="poItemId"]');
        const quantity = asciiNumber(row.querySelector('[name="poQuantity"]')?.value);
        const unitPriceToman = asciiNumber(row.querySelector('[name="poUnitPriceToman"]')?.value);
        return {
          itemId: item?.value || '', description: item?.selectedOptions[0]?.textContent || item?.value || '',
          quantity, unit: row.querySelector('[name="poUnit"]')?.value || '', unitPriceToman,
        };
      });
      if (!lines.length || lines.some((line) => !line.itemId || !line.unit || !Number.isFinite(line.quantity) || line.quantity <= 0
        || !Number.isSafeInteger(line.unitPriceToman) || line.unitPriceToman < 0 || line.unitPriceToman > Number.MAX_SAFE_INTEGER / 10)) {
        return operationError({ code: 'purchase_input_invalid', message: 'کالا، واحد، مقدار و قیمت تمام ردیف‌های خرید باید معتبر باشند.' });
      }
      const issueDate = window.ShamsiDatePicker?.getISOValue(form.elements.issueDate) || form.elements.issueDate.dataset.isoDate || values.issueDate;
      const submit = form.querySelector('button[type="submit"]');
      try {
        const created = await mutation('/api/admin/v2/finance/purchase-orders', {
          branchId: Number(state.query.branchId) || 1, vendorId: values.vendorId, issueDate: `${issueDate}T12:00:00.000Z`, notes: values.notes,
          lines: lines.map(({ unitPriceToman, ...line }) => ({ ...line, unitPriceIrr: unitPriceToman * 10 })),
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

    invoiceForm?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const values = Object.fromEntries(new FormData(form));
      const lines = [...form.querySelectorAll('[data-fin-invoice-row]')].map((row) => {
        const receipt = row.querySelector('[name="invoiceReceiptLine"]');
        const [goodsReceiptId, goodsReceiptLineId] = String(receipt?.value || '').split('|');
        return {
          goodsReceiptId, goodsReceiptLineId,
          invoicedQuantity: asciiNumber(row.querySelector('[name="invoiceQuantity"]')?.value),
          remainingInvoiceQuantity: asciiNumber(receipt?.selectedOptions[0]?.dataset.max),
          unitPriceToman: asciiNumber(row.querySelector('[name="invoiceUnitPriceToman"]')?.value),
        };
      });
      const goodsReceiptId = lines[0]?.goodsReceiptId;
      const vatToman = asciiNumber(values.vatToman || 0);
      if (!goodsReceiptId || !lines.length || lines.some((line) => !line.goodsReceiptLineId || line.goodsReceiptId !== goodsReceiptId
        || !Number.isFinite(line.invoicedQuantity) || line.invoicedQuantity <= 0
        || !Number.isSafeInteger(line.unitPriceToman) || line.unitPriceToman < 0 || line.unitPriceToman > Number.MAX_SAFE_INTEGER / 10)
        || !Number.isSafeInteger(vatToman) || vatToman < 0 || vatToman > Number.MAX_SAFE_INTEGER / 10) {
        return operationError({ code: 'vendor_invoice_input_invalid', message: 'تمام ردیف‌های یک فاکتور باید معتبر و متعلق به یک رسید کالا باشند.' });
      }
      if (new Set(lines.map((line) => line.goodsReceiptLineId)).size !== lines.length) return operationError({ code: 'vendor_invoice_duplicate_receipt_line', message: 'هر ردیف رسید فقط یک بار می‌تواند در این فاکتور انتخاب شود.' });
      if (lines.some((line) => Number.isFinite(line.remainingInvoiceQuantity) && line.invoicedQuantity > line.remainingInvoiceQuantity)) return operationError({ code: 'vendor_invoice_over_received_quantity', message: 'مقدار یکی از ردیف‌های فاکتور از ماندهٔ دریافت فاکتورنشده بیشتر است.' });
      const invoiceDate = window.ShamsiDatePicker?.getISOValue(form.elements.invoiceDate) || form.elements.invoiceDate.dataset.isoDate || values.invoiceDate;
      try {
        await mutation('/api/admin/v2/finance/vendor-invoices', {
          goodsReceiptId, invoiceNumber: values.invoiceNumber, invoiceDate: `${invoiceDate}T12:00:00.000Z`, vatIrr: vatToman * 10,
          lines: lines.map((line) => ({ goodsReceiptLineId: line.goodsReceiptLineId, invoicedQuantity: line.invoicedQuantity, unitPriceIrr: line.unitPriceToman * 10 })),
        }, form.querySelector('button[type="submit"]'));
        await refreshAfterMutation('فاکتور ثبت و تطبیق سه‌سویه محاسبه شد.');
      } catch (error) { operationError(error); }
    });

    root.querySelectorAll('[data-fin-request-match-review]').forEach((button) => button.addEventListener('click', async () => {
      const reason = window.prompt('علت اختلاف و دلیل درخواست بررسی را وارد کنید (حداقل ۵ نویسه):', 'اختلاف قیمت فاکتور با سفارش خرید نیازمند تصمیم مدیر است.');
      if (reason == null) return;
      if (reason.trim().length < 5) return operationError({ code: 'three_way_match_reason_required', message: 'علت بررسی اختلاف باید حداقل ۵ نویسه باشد.' });
      const evidenceReference = window.prompt('مرجع مدرک (اختیاری):', '') || '';
      try {
        await mutation(`/api/admin/v2/finance/vendor-invoices/${encodeURIComponent(button.dataset.finRequestMatchReview)}/match-review`, { reason: reason.trim(), evidenceReference: evidenceReference.trim() }, button);
        await refreshAfterMutation('اختلاف تطبیق برای تصمیم مستقل مالک/مدیر ارسال شد.');
      } catch (error) { operationError(error); }
    }));

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
      const options = accounts.map((account) => `<option value="${esc(account.code)}" ${account.code === selected.code ? 'selected' : ''}>${esc(account.code)} · ${esc(businessText(account.name))}</option>`).join('');
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
    const operations = data.operations || {};
    const counters = operations.counters || {};
    const metrics = data.metrics || {};
    const awaitingApproval = actions.filter((action) => action.operation === 'approvals' || action.id === 'pending-approvals');
    const needsAction = actions.filter((action) => !awaitingApproval.includes(action));
    const activity = Boolean(
      Number(metrics.paidOrders || 0) > 0
      || Number(metrics.operationalSalesIrr || 0) !== 0
      || Number(metrics.ledgerSalesIrr || 0) !== 0
      || Number(metrics.blockedEvents || 0) > 0
      || Number(metrics.pendingApprovals || 0) > 0
      || Object.values(counters).some((value) => Number(value || 0) > 0)
      || (operations.events || []).length
      || (operations.journalDrafts || []).length
      || (operations.approvals || []).length
      || (operations.uncapturedOrders || []).length
      || Number(operations.legacyArchivePagination?.total || operations.legacyArchive?.length || 0) > 0
    );
    // Workbench actions are intentionally loaded across the selected history
    // (the backend does not apply the date filter to the top-level action
    // queue).  A fixed "today" heading therefore overstates freshness and
    // can make an old unresolved item look like a new task.  Keep the label
    // truthful to the scope shown in the header.
    // The top-level action queue intentionally remains all-history so an old
    // unresolved item cannot disappear behind a date filter.  Make that
    // distinction explicit instead of implying that the queue itself is
    // period-scoped.
    const workbenchScope = 'همهٔ کارهای باز';
    const workbenchScopeDetail = state.query.from || state.query.to
      ? 'شاخص‌ها و جزئیات این صفحه برای بازهٔ انتخاب‌شده‌اند؛ صف کارها همهٔ موارد باز را نگه می‌دارد.'
      : 'همهٔ موارد باز که باید پیگیری شوند؛ برای محدودکردن شاخص‌ها، بازه را انتخاب کنید.';
    const information = activity ? [
      Number.isFinite(Number(metrics.paidOrders)) ? { label: 'سفارش‌های پرداخت‌شده', value: fa(metrics.paidOrders), detail: 'منبع: سفارش‌های عملیاتی' } : null,
      metrics.operationalSalesIrr != null ? { label: 'فروش عملیاتی', value: money(metrics.operationalSalesIrr), detail: 'منبع: سفارش‌های پرداخت‌شده' } : null,
      metrics.ledgerSalesIrr != null ? { label: 'ثبت قطعی دفتر', value: money(metrics.ledgerSalesIrr), detail: 'منبع: اسناد قطعی دفتر مالی' } : null,
    ].filter(Boolean) : [];
    const renderQueueAction = (action, index) => {
      // Inventory/recipe blockers are owned by the costing workspace. They
      // must not fall through to the journal tab, which cannot resolve a
      // physical stock or cost-data issue.
      const workspace = action.workspace || (action.operation === 'inventory' ? 'costing' : null);
      const requiredCapability = String(action.requiredCapability || 'finance.view');
      const actionable = can(requiredCapability);
      const audienceHint = action.audience === 'manager_owner' && !actionable
        ? 'فقط مشاهده؛ تصمیم با مدیر یا مالک است'
        : actionable ? (workspace ? 'رفتن به بخش مرتبط' : 'بازکردن اقدام در ابزار حسابدار') : 'مجوز اقدام برای نقش فعلی صادر نشده است';
      return `<button type="button" class="fin-queue-action" aria-label="${esc(action.label)}" data-fin-queue-action-id="${esc(action.id || '')}" data-fin-required-capability="${esc(requiredCapability)}" data-fin-actionable="${actionable ? 'true' : 'false'}" ${workspace ? `data-fin-goto="${esc(workspace)}"` : `data-fin-operation="${esc(action.operation || 'journal')}"`}><span>${fa(index + 1)}</span><strong>${esc(action.label)}</strong><small>${audienceHint}</small><i class="fin-action-arrow" aria-hidden="true">←</i></button>`;
    };
    const renderQueue = (id, title, description, items, tone, emptyMessage, countLabel = 'مورد') => `<section class="fin-work-queue ${tone}" data-fin-queue="${id}" aria-labelledby="fin-queue-${id}"><div class="fin-work-queue-head"><div><h3 id="fin-queue-${id}">${esc(title)}</h3><p>${esc(description)}</p></div><span class="fin-queue-count" aria-label="${fa(items.length)} ${esc(countLabel)}">${fa(items.length)} <small>${esc(countLabel)}</small></span></div>${items.length ? `<div class="fin-queue-items">${items.map((item, index) => item.label && !(state.experience && id === 'informational') ? renderQueueAction(item, index) : `<div class="fin-queue-info"><strong>${esc(item.value)}</strong><span>${esc(item.label)}</span><small>${esc(item.detail)}</small></div>`).join('')}</div>` : `<div class="fin-queue-empty"><span class="fin-empty-icon" aria-hidden="true">✓</span><span>${esc(emptyMessage)}</span></div>`}</section>`;
    return `
      <section class="fin-section-head"><div><h2>کارتابل حسابدار</h2><p>اول ${workbenchScope} را انجام دهید؛ جزئیات تخصصی در ادامه قرار دارد.</p></div></section>
      <section class="fin-panel fin-actions" aria-labelledby="fin-today-title"><div class="fin-panel-title"><div><h3 id="fin-today-title">${workbenchScope}</h3><p>${workbenchScopeDetail} هر مورد علت روشن و مسیر مستقیم دارد؛ جزئیات فنی در ابزار تکمیلی است.</p></div></div>
        <div class="fin-work-queues">
          ${renderQueue('needs-action', STATUS_COPY.needsAction, 'مواردی که باید بررسی یا اصلاح شوند.', needsAction, 'needs-action', 'موردی برای اقدام فوری ثبت نشده است.', 'اقدام')}
          ${renderQueue('awaiting-approval', STATUS_COPY.awaitingApproval, 'درخواست‌هایی که تصمیم مستقل مدیر یا مالک می‌خواهند.', awaitingApproval, 'awaiting', 'درخواستی منتظر تصمیم نیست.', 'درخواست')}
          ${renderQueue('informational', STATUS_COPY.informational, 'اطلاعات واقعی برای تصمیم‌گیری؛ بدون ایجاد اقدام ساختگی.', information, 'informational', 'اطلاعاتی برای این بازه ثبت نشده است.', 'شاخص')}
          ${!activity && !actions.length ? renderQueue('no-activity', STATUS_COPY.empty, 'این وضعیت با خطا فرق دارد؛ هنوز فعالیت مالی در این بازه ثبت نشده است.', [], 'empty', 'هنوز فعالیتی ثبت نشده است؛ مورد فوریِ قابل‌اقدامی ثبت نشده است.', 'فعالیت') : ''}
        </div>
      </section>
      <details class="fin-advanced fin-specialist-area" id="fin-specialist-operations"><summary><span><strong>ابزارهای تکمیلی حسابدار و مدیر</strong><small>ثبت سند، رفع مغایرت، تأییدها و مدیریت دوره؛ فقط هنگام نیاز باز کنید.</small></span><em>جزئیات حرفه‌ای</em></summary>
        ${renderOperations(operations)}
      </details>
      <section class="fin-panel"><div class="fin-panel-title"><div><h3>وضعیت در یک نگاه</h3><p>چهار عدد اصلی بر پایهٔ دادهٔ واقعی دفتر و عملیات.</p></div></div><div class="fin-metrics">
        ${metric('فروش عملیاتی', money(data.metrics.operationalSalesIrr), `${fa(data.metrics.paidOrders)} سفارش · منبع: سفارش‌ها`)}
        ${metric('فروش ثبت‌شده در دفتر جدید', money(data.metrics.ledgerSalesIrr), 'منبع: اسناد قطعی دفتر مالی جدید')}
        ${metric('اختلاف توضیح‌نشده', money(data.metrics.unexplainedDifferenceIrr), 'باید پیش از انتقال نهایی صفر شود', data.metrics.unexplainedDifferenceIrr ? 'danger' : 'success')}
        ${metric('رویداد مسدود', fa(data.metrics.blockedEvents), 'روش پرداخت، دوره یا قاعدهٔ ثبت', data.metrics.blockedEvents ? 'danger' : '')}
      </div></section>`;
  }

  function operationTabs() {
    const tabs = [
      { id: 'journal', label: 'ثبت سند' },
      { id: 'events', label: 'مغایرت‌ها' },
      { id: 'approvals', label: 'تأییدها' },
      { id: 'periods', label: 'بستن دوره' },
    ];
    return `<nav class="fin-operation-tabs" aria-label="عملیات حسابداری">${tabs.map((tab) => `<button type="button" data-fin-operation="${tab.id}" class="${state.operation === tab.id ? 'active' : ''}" aria-pressed="${state.operation === tab.id ? 'true' : 'false'}">${esc(tab.label)}</button>`).join('')}</nav>`;
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
      <div class="fin-panel-title"><div><h3>ثبت و پیگیری</h3><p>ثبت سند، رفع مغایرت، تأییدها و دورهٔ مالی را از اینجا دنبال کنید.</p></div><span>کارهای عملیاتی</span></div>
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
    const draftsPagination = operations.journalDraftsPagination || { page: 1, pageSize: 25, total: drafts.length, pages: 1 };
    return `<div class="fin-operation-layout">
      <form id="fin-journal-form" class="fin-form" autocomplete="off">
        <div class="fin-form-title"><div><strong>سند دستی متوازن</strong><small>مبلغ را تومان وارد کنید؛ هنگام ثبت به ریال صحیح تبدیل می‌شود.</small></div>${statusBadge('draft', 'neutral')}</div>
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
        ${paginationControls('journals', draftsPagination, 'workbench')}
      </div>
    </div>`;
  }

  function renderEventOperations(operations) {
    const orders = operations.uncapturedOrders || [];
    const ordersPagination = operations.uncapturedOrdersPagination || { page: 1, pageSize: 25, total: orders.length, pages: 1 };
    const events = operations.events || [];
    const eventsPagination = operations.eventsPagination || { page: 1, pageSize: 25, total: events.length, pages: 1 };
    const blockedCogsEvents = Number(operations.counters?.blockedCogsEvents || 0);
    const retryReadyCogs = blockedCogsEvents > 0 ? `<div class="fin-note warning"><strong>${fa(blockedCogsEvents)} بهای تمام‌شدهٔ سفارش منتظر دادهٔ کامل است</strong><span>پس از تکمیل دستور تهیه و قیمت مواد، فقط سفارش‌های قابل محاسبه دوباره بررسی می‌شوند.</span><div class="fin-inline-action"><a class="fin-btn secondary" href="/admin/kitchen?view=inventory&branchId=${encodeURIComponent(state.query.branchId || 1)}">تکمیل دستور تهیه و موجودی</a><button class="fin-btn primary" type="button" data-fin-retry-ready-cogs>بازآزمایی موارد آماده</button></div></div>` : '';
    return `<div class="fin-grid-2">
      <div class="fin-operation-list"><div class="fin-subhead"><strong>سفارش پرداخت‌شده بدون رویداد مالی</strong><span>${fa(orders.length)} مورد</span></div>
        ${orders.length ? orders.map((row) => `<article><div><strong>${esc(row.orderNo || row.id)}</strong><small>${dateTime(row.createdAt)} · ${money(row.amountIrr)}</small></div><div>${statusBadge(row.tenderKnown ? 'روش پرداخت معتبر' : 'روش پرداخت نامشخص', row.tenderKnown ? 'success' : 'danger')}<button class="fin-btn secondary" type="button" data-fin-capture-order="${esc(row.id)}">${row.tenderKnown ? 'ثبت مالی' : 'ایجاد پرونده بررسی'}</button></div></article>`).join('') : empty('سفارش جاافتاده‌ای در محدودهٔ انتخاب‌شده نیست.')}
        ${paginationControls('uncaptured', ordersPagination, 'workbench')}
      </div>
      <div class="fin-operation-list">${retryReadyCogs}<div class="fin-subhead"><strong>رویدادهای نیازمند رفع مانع</strong><span>${fa(eventsPagination.total)} مورد</span></div>
        ${events.length ? events.map((row) => {
          const inventoryEvent = ['inventory.waste', 'inventory.stock_count', 'inventory.production_batch'].includes(row.source);
          const cogsEvent = row.source === 'order.cogs';
          const supported = ['order.paid', 'cash.movement'].includes(row.source) || inventoryEvent;
          const issueText = cogsEvent ? 'برای محاسبه، دستور تهیه، قیمت مواد و موجودی را کامل کنید.' : row.error?.message || 'منتظر پردازش';
          const sourceTenders = Array.isArray(row.payload?.tenderSnapshot) ? row.payload.tenderSnapshot : [];
          const hasReliableTender = sourceTenders.length > 0
            && sourceTenders.every((item) => REVIEW_TENDERS.some((tender) => tender.id === String(item.tender || ''))
              && Number.isSafeInteger(Number(item.amountIrr)) && Number(item.amountIrr) > 0)
            && sourceTenders.reduce((sum, item) => sum + Number(item.amountIrr), 0) === Number(row.amountIrr || 0);
          const control = row.source === 'order.paid' && !hasReliableTender
            ? `<fieldset class="fin-tender-review"><legend>روش‌های پرداخت (تومان)</legend><div class="fin-inline-action">${REVIEW_TENDERS.map((tender) => `<label>${esc(tender.label)}<input data-fin-event-tender-amount="${esc(row.id)}" data-tender="${esc(tender.id)}" inputmode="numeric" value="0" aria-label="مبلغ ${esc(tender.label)} به تومان"></label>`).join('')}</div><small>جمع روش‌ها باید دقیقاً ${money(row.amountIrr)} باشد.</small></fieldset><input data-fin-event-evidence="${esc(row.id)}" required maxlength="160" placeholder="مرجع مدرک پرداخت" aria-label="شماره رسید، تراکنش یا گزارش صندوق">`
            : row.source === 'order.paid'
              ? `<span class="fin-badge success">استفاده از روش پرداخت ثبت‌شده در منبع</span>`
            : inventoryEvent ? '' : `<input data-fin-event-account="${esc(row.id)}" inputmode="numeric" placeholder="حساب مقابل" aria-label="کد حساب مقابل">`;
          const actionLabel = inventoryEvent ? 'ارزش‌گذاری با قیمت معتبر و ثبت' : row.source === 'order.paid' && !hasReliableTender ? 'ثبت پس از بررسی مدرک' : 'رفع مانع و ثبت';
          const cogsGuide = cogsEvent ? `<div class="fin-inline-action"><span class="fin-badge warning">نیازمند دستور تهیه، قیمت و موجودی معتبر</span><a class="fin-btn secondary" href="/admin/kitchen?view=inventory&branchId=${encodeURIComponent(state.query.branchId || 1)}">تکمیل دستور تهیه</a></div>` : '';
          return `<article class="stack"><div><strong>${esc(financeSourceLabel(row.source))} · مرجع ${esc(row.sourceId)}</strong><small>${esc(issueText)} · ${money(row.amountIrr)}</small></div>${supported ? `<div class="fin-inline-action">${control}<button class="fin-btn secondary" type="button" data-fin-resolve-event="${esc(row.id)}" data-fin-source="${esc(row.source)}" data-fin-amount-irr="${esc(row.amountIrr)}">${actionLabel}</button></div>` : cogsGuide || `<span class="fin-badge warning">نیازمند بررسی دستی است</span>`}</article>`;
        }).join('') : empty('رویداد مسدود یا منتظر پردازشی وجود ندارد.')}
        ${paginationControls('events', eventsPagination, 'workbench')}
      </div>
    </div>${renderMigrationOperations(operations)}`;
  }

  function renderMigrationOperations(operations) {
    const rows = operations.legacyArchive || [];
    const archivePagination = operations.legacyArchivePagination || { page: 1, pageSize: 25, total: rows.length, pages: 1 };
    const summary = operations.legacyArchiveSummary || { total: 0, byTrust: {}, byDecision: {} };
    const migration = operations.migrationReadiness || { status: 'incomplete', expectedRecords: 0, archivedRecords: 0, missingArchiveRecords: 0, archiveSnapshotMismatches: 0, newUnscopedRecords: 0, unresolvedRecords: 0, baseline: null };
    const trustTone = (value) => value === 'quarantined' ? 'danger' : value === 'inferred_needs_approval' ? 'warning' : 'success';
    return `<details class="fin-action-details" ${summary.byDecision?.pending ? 'open' : ''}>
      <summary><span><strong>پاک‌سازی و تصمیم مهاجرت داده‌های قدیمی</strong><small>طبقه‌بندی قابل ممیزی؛ بدون حذف، تبدیل کور مبلغ یا ثبت خودکار سند</small></span><em>${fa(summary.total || 0)} رکورد آرشیوی</em></summary>
      <div class="fin-note warning"><strong>این عملیات فقط پرونده می‌سازد</strong><span>حتی «مجاز برای بازسازی» صرفاً تصمیم مدیر است؛ ایجاد سند افتتاحیه یا بازسازی تاریخی مرحلهٔ جداگانه و کنترل‌شده خواهد بود.</span></div>
      <div class="fin-note ${migration.status === 'complete' ? 'success' : 'warning'}"><strong>خط مبنای انتقال داده: ${migration.baseline ? `${fa(migration.expectedRecords)} رکورد · ${esc(dateTime(migration.baseline.scannedAt))}` : 'ثبت نشده'}</strong><span>${migration.baseline ? `آرشیو ${fa(migration.archivedRecords)} · مفقود ${fa(migration.missingArchiveRecords)} · تغییر نسخه بازیابی ${fa(migration.archiveSnapshotMismatches)} · داده تازه خارج از خط مبنا ${fa(migration.newUnscopedRecords)} · تصمیم باز ${fa(migration.unresolvedRecords)}` : 'پیش از اجرای آزمایشی باید یک اسکن کنترل‌شده ثبت شود؛ سفارش‌های عملیاتی بعد از آن از مسیر رویداد مالی جدید کنترل می‌شوند.'}</span></div>
      <div class="fin-inline-action"><button class="fin-btn primary" type="button" data-fin-classify-legacy>اسکن و به‌روزرسانی آرشیو خواندنی</button><span class="fin-badge neutral">تأییدشده ${fa(summary.byTrust?.verified || 0)}</span><span class="fin-badge warning">نیازمند تأیید ${fa(summary.byTrust?.inferred_needs_approval || 0)}</span><span class="fin-badge danger">قرنطینه ${fa(summary.byTrust?.quarantined || 0)}</span></div>
      <div class="fin-operation-list"><div class="fin-subhead"><strong>پرونده‌های مهاجرت</strong><span>${fa(summary.byDecision?.pending || 0)} تصمیم باز</span></div>
        ${rows.length ? rows.map((row) => {
          const choices = row.trustStatus === 'quarantined'
            ? '<option value="keep_quarantined">در قرنطینه بماند</option><option value="not_financial">غیرمالی</option>'
            : '<option value="approved_for_backfill">مجاز برای بازسازی کنترل‌شده</option><option value="keep_quarantined">در قرنطینه بماند</option><option value="not_financial">غیرمالی</option>';
          const tenderReview = row.trustStatus === 'inferred_needs_approval' ? `<details><summary>تقسیم مبلغ بر اساس مدرک پرداخت</summary><div class="fin-inline-action"><label>نقد (تومان)<input data-fin-legacy-tender="${esc(row.id)}" data-tender="cash" inputmode="numeric" value="0"></label><label>کارتخوان (تومان)<input data-fin-legacy-tender="${esc(row.id)}" data-tender="card" inputmode="numeric" value="0"></label><label>درگاه (تومان)<input data-fin-legacy-tender="${esc(row.id)}" data-tender="online" inputmode="numeric" value="0"></label><label>اعتباری (تومان)<input data-fin-legacy-tender="${esc(row.id)}" data-tender="credit" inputmode="numeric" value="0"></label><label>کارت هدیه (تومان)<input data-fin-legacy-tender="${esc(row.id)}" data-tender="gift_card" inputmode="numeric" value="0"></label></div><small>جمع این مبالغ باید دقیقاً ${money(row.amountIrr)} باشد؛ مقدار صفر نادیده گرفته می‌شود.</small></details>` : '';
          const backfillActions = row.sourceTable === 'orders' && row.decision === 'approved_for_backfill'
            ? `<div class="fin-inline-action">${statusBadge(row.backfillStatus || 'not_requested', row.backfillStatus === 'posted' ? 'success' : 'warning')}<button class="fin-btn secondary" type="button" data-fin-legacy-preview="${esc(row.id)}">پیش‌نمایش سند</button>${!['pending_approval', 'posted', 'reversed'].includes(row.backfillStatus) ? `<button class="fin-btn primary" type="button" data-fin-legacy-request="${esc(row.id)}">ارسال سند برای تأیید مستقل</button>` : ''}</div>` : '';
          return `<article class="stack"><div><strong>${esc(legacySourceLabel(row.sourceTable))} · مرجع ${esc(row.sourceId)}</strong><small>${esc(label(row.reason))}${row.amountIrr == null ? '' : ` · ${money(row.amountIrr)}`}${row.decidedBy ? ` · تصمیم‌گیر: ${esc(row.decidedBy)}` : ''}</small></div><div class="fin-inline-action">${statusBadge(row.trustStatus, trustTone(row.trustStatus))}${statusBadge(row.decision, row.decision === 'approved_for_backfill' ? 'success' : 'neutral')}<select data-fin-legacy-choice="${esc(row.id)}" aria-label="تصمیم مهاجرت">${choices}</select><input data-fin-legacy-evidence="${esc(row.id)}" maxlength="160" placeholder="مرجع مدرک (برای بازسازی الزامی)"><input data-fin-legacy-note="${esc(row.id)}" maxlength="500" required placeholder="علت تصمیم"><button class="fin-btn secondary" type="button" data-fin-legacy-decision="${esc(row.id)}">ثبت تصمیم</button></div>${tenderReview}${backfillActions}</article>`;
        }).join('') : empty('هنوز اسکن مهاجرت اجرا نشده است.')}
        ${paginationControls('migration', archivePagination, 'workbench')}
      </div>
    </details>`;
  }

  function renderApprovalOperations(operations) {
    const approvals = operations.approvals || [];
    const approvalsPagination = operations.approvalsPagination || { page: 1, pageSize: 25, total: approvals.length, pages: 1 };
    const currentActor = actorPhone();
    return `<div class="fin-operation-list"><div class="fin-subhead"><strong>صف تأیید مستقل</strong><span>ایجادکننده نمی‌تواند درخواست خودش را تأیید کند.</span></div>
      ${approvals.length ? approvals.map((row) => {
        const selfRequested = Boolean(currentActor && String(row.createdBy || row.requestedBy || '') === currentActor);
        const canDecide = can('finance.approve') && !selfRequested;
        const action = canDecide
          ? `<div class="fin-inline-action"><input data-fin-approval-comment="${esc(row.id)}" placeholder="یادداشت تصمیم" maxlength="300"><button class="fin-btn secondary" type="button" data-fin-approval-id="${esc(row.id)}" data-fin-approval-operation="${esc(row.operation)}" data-fin-approval-decision="rejected">رد</button><button class="fin-btn primary" type="button" data-fin-approval-id="${esc(row.id)}" data-fin-approval-operation="${esc(row.operation)}" data-fin-approval-decision="approved">تأیید</button></div>`
          : `<div class="fin-note warning"><strong>${selfRequested ? 'نیازمند تصمیم شخص مستقل' : 'فقط مشاهده'}</strong><span>${selfRequested ? 'این درخواست توسط شما ایجاد شده و تأیید یا رد آن باید توسط مالک/مدیر دیگری انجام شود.' : 'نقش فعلی مجوز تصمیم‌گیری مالی ندارد.'}</span></div>`;
        return `<article class="stack"><div><strong>${esc(label(row.operation))}</strong><small>${esc(label(row.entityType))} · ${money(row.amountIrr)} · ایجاد: ${dateTime(row.createdAt)}</small></div>${action}</article>`;
      }).join('') : empty('درخواستی منتظر تأیید مالک یا مدیر مالی نیست.')}
      ${paginationControls('approvals', approvalsPagination, 'workbench')}
    </div>`;
  }

  function renderPeriodOperations(operations) {
    const periods = operations.periods || [];
    const current = operations.currentPeriod;
    const canFinalClose = can('finance.period.close') && ['owner', 'manager'].includes(currentRole());
    const canRequestReopen = can('finance.period.reopen');
    const pendingReopen = new Set((operations.approvals || [])
      .filter((approval) => approval.status === 'pending' && approval.operation === 'reopen_fiscal_period' && approval.entityType === 'fiscal_period')
      .map((approval) => String(approval.entityId)));
    const periodActions = (period) => {
      const closeActions = `${can('finance.period.close') && operations.periodSource === 'finance_v2' && ['open', 'reopened'].includes(period.status) ? `<button class="fin-btn secondary" type="button" data-fin-close-period="${esc(period.id)}" data-fin-close-mode="preliminary">بستن مقدماتی</button>` : ''}${canFinalClose && operations.periodSource === 'finance_v2' && period.status === 'soft_closed' ? `<button class="fin-btn primary" type="button" data-fin-close-period="${esc(period.id)}" data-fin-close-mode="final">بستن نهایی</button>` : ''}`;
      if (!['closed', 'soft_closed'].includes(period.status) || operations.periodSource !== 'finance_v2') return closeActions;
      if (pendingReopen.has(String(period.id))) return `${closeActions}<span class="fin-badge warning">درخواست بازگشایی منتظر تأیید مستقل</span>`;
      if (!canRequestReopen) return `${closeActions}<span class="fin-badge neutral">درخواست بازگشایی فقط برای مدیر/مالک</span>`;
      return `${closeActions}<details class="fin-period-reopen"><summary class="fin-btn secondary">درخواست بازگشایی</summary><form class="fin-inline-form" data-fin-reopen-form data-fin-reopen-period="${esc(period.id)}" autocomplete="off"><label class="fin-field"><span>علت بازگشایی</span><input name="reason" required minlength="3" maxlength="300" placeholder="مثلاً ثبت سند جاافتاده"></label><button class="fin-btn primary" type="submit">ارسال درخواست مستقل</button></form></details>`;
    };
    return `<div class="fin-operation-layout">
      ${can('finance.settings.manage') ? `<form id="fin-period-form" class="fin-form" autocomplete="off">
        <div class="fin-form-title span-2"><div><strong>تعریف دورهٔ مالی جدید</strong><small>دوره‌ها باید بدون فاصله و هم‌پوشانی باشند.</small></div>${statusBadge(operations.periodSource === 'finance_v2' ? 'سامانه جدید' : 'قدیمی؛ فقط خواندنی', 'neutral')}</div>
        <label class="fin-field span-2"><span>نام دوره</span><input name="name" required maxlength="120" placeholder="مثلاً شهریور ۱۴۰۵"></label>
        <label class="fin-field"><span>شروع دوره</span><input name="startDate" type="date" required></label>
        <label class="fin-field"><span>پایان دوره</span><input name="endDate" type="date" required></label>
        <button class="fin-btn primary span-2" type="submit">ایجاد دوره</button>
      </form>` : '<div class="fin-note warning"><strong>تعریف دوره فقط خواندنی است</strong><span>نقش فعلی مجوز تنظیمات مالی و ایجاد دورهٔ جدید ندارد.</span></div>'}
      <div class="fin-operation-list"><div class="fin-subhead"><strong>دوره‌ها</strong><span>${fa(periods.length)} مورد</span></div>
        ${operations.periodSource !== 'finance_v2' ? '<div class="fin-note warning"><strong>دوره‌های فعلی فقط خواندنی‌اند</strong><span>برای عملیات بستن، دوره باید یک‌بار در سامانه جدید تعریف و کنترل شود.</span></div>' : ''}
        ${periods.length ? periods.map((row) => `<article><div><strong>${esc(row.name || row.id)}</strong><small>${dateOnly(row.startDate)} تا ${dateOnly(row.endDate)}</small></div><div>${statusBadge(row.status)}${periodActions(row)}</div></article>`).join('') : empty('دورهٔ مالی ثبت نشده است؛ بدون دوره امکان پست سند وجود ندارد.')}
        ${current ? `<div class="fin-note"><strong>دورهٔ جاری: ${esc(current.name || current.id)}</strong><span>وضعیت ${esc(label(current.status))}</span></div>` : '<div class="fin-note warning"><strong>دورهٔ جاری یافت نشد</strong><span>این وضعیت مانع ثبت قطعی سند است.</span></div>'}
      </div>
    </div>`;
  }

  function renderSales(data) {
    const summary = data.summary || { operational: {}, ledger: {}, reconciliation: {} };
    const operational = summary.operational || {};
    const ledger = summary.ledger || {};
    const reconciliation = summary.reconciliation || {};
    const refundablePayments = data.refundablePayments || [];
    const refunds = data.refunds || [];
    const unmatchedPayments = data.reconciliation?.unmatchedPayments || [];
    const settlementsV2 = data.reconciliation?.settlements || [];
    const bankAccounts = data.reconciliation?.bankAccounts || [];
    const bankStatementLines = data.reconciliation?.bankStatementLines || [];
    const bankCandidates = data.reconciliation?.bankCandidates || [];
    const unmatchedBankLines = bankStatementLines.filter((row) => row.status === 'unmatched');
    const autoMatchSuggestions = [];
    unmatchedBankLines.forEach((row) => {
      const candidate = bankCandidates.find((c) => (
        c.accountCode === row.details?.bankAccountCode
        && c.direction === row.details?.direction
        && Number(c.amountIrr) === Number(row.amountIrr)
      ));
      if (candidate) {
        autoMatchSuggestions.push({ statementLineId: row.id, journalEntryId: candidate.journalEntryId, reference: row.bankReference, amountIrr: row.amountIrr });
      }
    });

    const settlementPagination = { page: Math.max(1, Number(state.pages.settlements) || 1), pageSize: 25, total: settlementsV2.length, pages: Math.max(1, Math.ceil(settlementsV2.length / 25)) };
    const settlementPage = Math.min(settlementPagination.page, settlementPagination.pages);
    const visibleSettlements = settlementsV2.slice((settlementPage - 1) * settlementPagination.pageSize, settlementPage * settlementPagination.pageSize);
    const bankPagination = { page: Math.max(1, Number(state.pages.bankLines) || 1), pageSize: 25, total: bankStatementLines.length, pages: Math.max(1, Math.ceil(bankStatementLines.length / 25)) };
    const bankPage = Math.min(bankPagination.page, bankPagination.pages);
    const visibleBankLines = bankStatementLines.slice((bankPage - 1) * bankPagination.pageSize, bankPage * bankPagination.pageSize);
    const refundPagination = { page: Math.max(1, Number(state.pages.refunds) || 1), pageSize: 25, total: refunds.length, pages: Math.max(1, Math.ceil(refunds.length / 25)) };
    const refundPage = Math.min(refundPagination.page, refundPagination.pages);
    const visibleRefunds = refunds.slice((refundPage - 1) * refundPagination.pageSize, refundPage * refundPagination.pageSize);
    const today = localIsoDate();
    const hasSalesActivity = Number(operational.paidOrders || 0) > 0
      || Number(ledger.postedEntries || 0) > 0
      || (data.cashSessions || []).length > 0
      || (data.tenders || []).length > 0
      || refunds.length > 0
      || (data.reconciliation?.unmatchedPayments || []).length > 0
      || (data.reconciliation?.bankStatementLines || []).length > 0;
    const salesValue = (value) => hasSalesActivity ? money(value) : STATUS_COPY.empty;
    const salesDetail = hasSalesActivity ? null : STATUS_COPY.empty;
    const cashSessionStatus = { open: 'باز', closed: 'بسته', awaiting_count: 'در انتظار شمارش', balanced: 'تطبیق‌شده', difference: 'دارای اختلاف' };
    return `
      <section class="fin-section-head"><div><h2>فروش، صندوق و بانک</h2><p>سفارش، روش پرداخت، نشست صندوق و تسویه در یک نمای قابل تطبیق.</p></div><div class="fin-head-actions">${can('cash.manage') ? `<a class="fin-btn secondary" href="/admin/cashier?view=drawer&branchId=${encodeURIComponent(state.query.branchId || 1)}">رفتن به پنل صندوق</a>` : '<span class="fin-note warning fin-cash-handoff" data-fin-cash-handoff role="status"><strong>نیازمند صندوق‌دار</strong><span>بازکردن و بستن نشست صندوق در پنل صندوق انجام می‌شود؛ این نقش فقط گزارش و تطبیق را می‌بیند.</span></span>'}<button class="fin-btn secondary" type="button" data-fin-export="sales" title="خروجی فقط از صفحهٔ جاری">دریافت CSV صفحهٔ جاری</button></div></section>
      <div class="fin-metrics" data-fin-sales-summary data-fin-activity-state="${hasSalesActivity ? 'active' : 'empty'}">
        ${metric('فروش خالص عملیاتی', salesValue(operational.salesIrr), salesDetail || `${fa(operational.paidOrders)} سفارش · برگشت ${money(operational.refundsIrr)}`)}
        ${metric('فروش ثبت‌شده در دفتر جدید', salesValue(ledger.salesIrr), salesDetail || `${fa(ledger.postedEntries)} سند قطعی`)}
        ${metric('اختلاف عملیات و دفتر', hasSalesActivity ? money(reconciliation.salesDifferenceIrr) : STATUS_COPY.empty, hasSalesActivity ? (reconciliation.salesDifferenceIrr ? 'نیازمند تطبیق' : 'بدون اختلاف ثبت‌شده') : 'هنوز فعالیتی برای تطبیق ثبت نشده است', hasSalesActivity ? (reconciliation.salesDifferenceIrr ? 'danger' : 'success') : '')}
        ${metric('نشست صندوق', hasSalesActivity ? fa(data.cashSessions?.length || 0) : STATUS_COPY.empty, hasSalesActivity ? 'منبع: نشست‌های عملیاتی صندوق' : STATUS_COPY.empty)}
      </div>
      ${!hasSalesActivity ? `<div class="fin-empty fin-no-activity" data-fin-no-activity><strong>${esc(STATUS_COPY.empty)}</strong><span>پس از ثبت نخستین سفارش یا نشست صندوق، فروش و دریافت وجه از همین‌جا قابل تطبیق است.</span></div>` : ''}
      <div class="fin-flow fin-sales-chain" data-fin-sales-chain aria-label="زنجیرهٔ فروش تا بانک">
        <span data-fin-chain-step="sale">فروش ثبت‌شده</span><b>←</b><span data-fin-chain-step="payment">وجه دریافت‌شده</span><b>←</b><span data-fin-chain-step="cash">نشست صندوق</span><b>←</b><span data-fin-chain-step="bank">تسویه و واریز بانک</span>
      </div>
      <section class="fin-panel fin-cash-cycle" data-fin-cash-cycle><div class="fin-panel-title"><div><h3>چرخهٔ صندوق</h3><p>باز یا بسته‌بودن نشست و اختلاف شمارش از دادهٔ واقعی صندوق خوانده می‌شود.</p></div></div>
        ${(data.cashSessions || []).length ? `<div class="fin-cash-session-list">${data.cashSessions.map((session) => `<article data-fin-cash-session="${esc(session.id)}"><div><strong>${session.status === 'open' ? 'نشست باز' : 'نشست بسته'} · ${esc(session.id)}</strong><small>شروع ${dateTime(session.openedAt)}${session.closedAt ? ` · پایان ${dateTime(session.closedAt)}` : ''}</small></div><div><span class="fin-badge ${session.reconciliationStatus === 'difference' ? 'warning' : session.reconciliationStatus === 'balanced' ? 'success' : 'neutral'}">${esc(cashSessionStatus[session.reconciliationStatus] || 'وضعیت مشخص نیست')}</span><b>${session.expectedAmountIrr == null ? STATUS_COPY.insufficientData : `موجودی مورد انتظار ${money(session.expectedAmountIrr)}`}</b></div>${session.varianceIrr == null ? '' : `<small class="fin-cash-variance">اختلاف شمارش: ${money(session.varianceIrr)}</small>`}</article>`).join('')}</div>` : empty(STATUS_COPY.empty)}</section>
      <div class="fin-grid-2">
        <section class="fin-panel"><div class="fin-panel-title"><div><h3>روش‌های پرداخت</h3><p>فقط بر پایه روش پرداخت ثبت‌شده؛ بدون عدد جایگزین</p></div></div>${(data.tenders || []).length ? (() => {
          const totalTender = (data.tenders || []).reduce((acc, row) => acc + Math.max(0, Number(row.amountIrr || 0)), 0);
          return `<div class="fin-tender-list">${data.tenders.map((row) => {
            const pct = totalTender > 0 ? Math.round((Number(row.amountIrr || 0) / totalTender) * 100) : 0;
            return `<div><span>${esc(label(row.tender))}${pct > 0 ? ` <small class="fin-tender-pct">${fa(pct)}٪</small>` : ''}</span><strong>${money(row.amountIrr)}</strong></div>`;
          }).join('')}</div>`;
        })() : empty(hasSalesActivity ? 'روش پرداخت قابل اتکایی در این بازه ثبت نشده است.' : STATUS_COPY.empty)}</section>
        <section class="fin-panel"><div class="fin-panel-title"><div><h3>وضعیت تسویه</h3><p>هر شرکت پرداخت، پایانه و شماره تسویه باید یکتا باشد</p></div></div>${data.settlementDuplicates?.length ? `<div class="fin-issue-list">${data.settlementDuplicates.map((row) => `<article class="danger"><strong>${esc(row.key)}</strong><p>${fa(row.count)} رکورد تکراری</p></article>`).join('')}</div>` : '<div class="fin-ok-state">شماره تسویهٔ تکراری در دادهٔ خوانده‌شده دیده نشد.</div>'}</section>
      </div>
      <section class="fin-panel fin-operations"><div class="fin-panel-title"><div><h3>عملیات فروش و بانک</h3><p>کارهای کم‌تکرار به‌صورت مرحله‌ای باز می‌شوند تا صفحه روزمره شلوغ نشود.</p></div><span>کنترل‌شده</span></div>
      <div class="fin-action-stack">
      <details class="fin-action-details" ${unmatchedPayments.length ? 'open' : ''}><summary><span><strong>تطبیق تسویه کارتخوان و درگاه</strong><small>پرداخت‌ها ← ناخالص بچ ← کارمزد ← خالص بانک</small></span><em>${fa(unmatchedPayments.length)} پرداخت منتظر</em></summary><div id="fin-settlement-feedback"></div>
        <div class="fin-operation-layout">
          <form id="fin-settlement-form" class="fin-form" autocomplete="off">
            <label class="fin-field span-2"><span>پرداخت‌های داخل دسته</span><select name="paymentIds" multiple size="5" required>${unmatchedPayments.map((item) => `<option value="${esc(item.paymentId)}" data-amount-irr="${esc(item.amountIrr)}">${esc(item.details?.orderNo || `سفارش ${item.orderId}`)} · ${esc(label(item.payment?.tender))} · ${money(item.amountIrr)}</option>`).join('')}</select></label>
            <label class="fin-field"><span>شرکت پرداخت یا درگاه</span><input name="psp" required maxlength="120" placeholder="مثلاً به‌پرداخت"></label>
            <label class="fin-field"><span>شناسه پایانه</span><input name="terminalId" required maxlength="120"></label>
            <label class="fin-field"><span>شماره دسته تسویه</span><input name="batchNo" required maxlength="120"></label>
            <label class="fin-field"><span>تاریخ تسویه</span><input name="settledAt" type="date" value="${today}" required></label>
            <label class="fin-field"><span>کارمزد (تومان)</span><input name="feeToman" inputmode="numeric" value="0" required></label>
            <div class="fin-derived-amount fin-field"><span>خالص واریزی بانک</span><output data-fin-settlement-net aria-live="polite">پس از انتخاب پرداخت‌ها محاسبه می‌شود</output><small>ناخالص پرداخت‌ها منهای کارمزد؛ این مبلغ توسط سامانه محاسبه و دوباره کنترل می‌شود.</small></div>
            <label class="fin-field span-2"><span>شناسه واریز بانک</span><input name="bankReference" maxlength="160"></label>
            <button class="fin-btn primary span-2" type="submit" ${unmatchedPayments.length ? '' : 'disabled'}>کنترل، تطبیق و ثبت سند تسویه</button>
          </form>
          <div class="fin-operation-list"><div class="fin-subhead"><strong>تسویه‌های ثبت‌شده</strong><span>${fa(settlementsV2.length)} مورد</span></div>
            ${settlementsV2.length ? visibleSettlements.map((row) => `<article><div><strong>${esc(row.psp)} / ${esc(row.batchNo)}</strong><small>${dateTime(row.createdAt)} · بانک ${esc(row.bankReference || 'بدون شناسه')}</small></div><div>${statusBadge(row.status)}<b>${money(row.amountIrr)}</b></div></article>`).join('') : empty('تسویه‌ای در دفتر مالی جدید ثبت نشده است.')}
            ${paginationControls('settlements', settlementPagination)}
          </div>
        </div>
      </details>
      <details class="fin-action-details" ${unmatchedBankLines.length ? 'open' : ''}><summary><span><strong>تطبیق صورت‌حساب بانک با دفتر</strong><small>مدرک بانک ← کنترل مبلغ و جهت ← سند قطعی</small></span><em>${fa(unmatchedBankLines.length)} گردش منتظر</em></summary><div id="fin-bank-feedback"></div>
        ${autoMatchSuggestions.length ? `
          <div class="fin-auto-match-banner" data-fin-auto-match-banner>
            <div class="fin-auto-match-banner__text">
              <span class="fin-sparkle-icon">⚡</span>
              <div>
                <strong>${fa(autoMatchSuggestions.length)} گردش با مبلغ، جهت و حسابِ همسان پیدا شد</strong>
                <small>مبلغ، جهت و حساب این گردش‌ها با اسناد قطعی دفتر کل دقیقاً برابر است.</small>
              </div>
            </div>
            <small class="fin-auto-match-review">این‌ها فقط پیشنهادند؛ هر گردش را جداگانه بررسی و تطبیق را تأیید کنید.</small>
          </div>
        ` : ''}
        <div class="fin-operation-layout">
          <form id="fin-bank-line-form" class="fin-form" autocomplete="off">
            <div class="fin-form-title span-2"><div><strong>ثبت گردش صورت‌حساب بانک</strong><small>این رکورد فقط مدرک بیرونی است و خودش سند حسابداری ایجاد نمی‌کند.</small></div>${statusBadge('unmatched')}</div>
            <label class="fin-field"><span>حساب بانکی</span><select name="bankAccountCode" required>${bankAccounts.map((account) => `<option value="${esc(account.code)}">${esc(account.code)} · ${esc(businessText(account.name))}</option>`).join('')}</select></label>
            <label class="fin-field"><span>نوع گردش</span><select name="direction" required><option value="inflow">واریز به بانک</option><option value="outflow">برداشت از بانک</option></select></label>
            <label class="fin-field"><span>تاریخ گردش</span><input name="occurredAt" type="date" value="${today}" required></label>
            <label class="fin-field"><span>مبلغ (تومان)</span><input name="amountToman" inputmode="numeric" required placeholder="۰"></label>
            <label class="fin-field span-2"><span>شناسه یکتای بانک</span><input name="bankReference" required maxlength="160" placeholder="شماره پیگیری / شناسه تراکنش"></label>
            <label class="fin-field span-2"><span>شرح صورت‌حساب</span><input name="description" maxlength="300" placeholder="شرح درج‌شده توسط بانک"></label>
            <button class="fin-btn primary span-2" type="submit" ${bankAccounts.length ? '' : 'disabled'}>ثبت در صف تطبیق</button>
          </form>
          <div class="fin-operation-list"><div class="fin-subhead"><strong>گردش‌های بانکی</strong><span>${fa(bankStatementLines.length)} مورد</span></div>
            ${bankStatementLines.length ? visibleBankLines.map((row) => {
              const exactCandidates = bankCandidates.filter((candidate) => candidate.accountCode === row.details?.bankAccountCode && candidate.direction === row.details?.direction && Number(candidate.amountIrr) === Number(row.amountIrr));
              return `<article class="stack"><div><strong>${esc(row.bankReference)}</strong><small>${dateTime(row.details?.occurredAt)} · ${esc(label(row.details?.direction))} · حساب ${esc(row.details?.bankAccountCode)}</small></div><div>${statusBadge(row.status)}<b>${money(row.amountIrr)}</b></div>
                ${row.status === 'unmatched' ? `<div class="fin-inline-action"><select data-fin-bank-candidate="${esc(row.id)}" aria-label="سند دفتر برای ${esc(row.bankReference)}"><option value="">${exactCandidates.length ? 'سند قطعی هم‌مبلغ را انتخاب کنید' : 'سند قطعی دقیق یافت نشد'}</option>${exactCandidates.map((candidate) => `<option value="${esc(candidate.journalEntryId)}">${esc(candidate.journalNumber)} · ${dateTime(candidate.occurredAt)} · ${esc(candidate.description)}</option>`).join('')}</select><button class="fin-btn secondary" type="button" data-fin-bank-match="${esc(row.id)}" ${exactCandidates.length ? '' : 'disabled'}>تطبیق دقیق</button></div>` : `<small>سند ${esc(row.matchedJournal?.number || row.details?.matchedJournalNumber || row.journalEntryId)} · تطبیق‌دهنده ${esc(row.matchedBy || 'ثبت نشده')}</small>`}
              </article>`;
            }).join('') : empty('گردش صورت‌حساب بانک ثبت نشده است؛ بدون مدرک بانک، وضعیت تطبیق ادعا نمی‌شود.')}
            ${paginationControls('bankLines', bankPagination)}
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
            <label class="fin-field span-2"><span>علت</span><input name="reason" required minlength="10" maxlength="300" placeholder="علت روشن را با جزئیات کوتاه بنویسید"></label>
            <div class="fin-note warning span-2"><strong>بازگشت فیزیکی جداست</strong><span>این عملیات موجودی یا بهای تمام‌شده را تغییر نمی‌دهد؛ دریافت کالای برگشتی باید در انبار ثبت شود.</span></div>
            <button class="fin-btn primary span-2" type="submit" ${refundablePayments.length ? '' : 'disabled'}>ارسال برای تأیید مالک</button>
          </form>
          <div class="fin-operation-list"><div class="fin-subhead"><strong>درخواست‌های اخیر</strong><span>${fa(refunds.length)} مورد</span></div>
            ${refunds.length ? visibleRefunds.map((row) => `<article><div><strong>${esc(row.reason)}</strong><small>سفارش ${esc(row.orderId)} · ${dateTime(row.refundDate)}</small></div><div>${refundStatusBadge(row.status)}<b>${money(row.amountIrr)}</b></div></article>`).join('') : empty('درخواست برگشت وجه‌ای در این محدوده ثبت نشده است.')}
            ${paginationControls('refunds', refundPagination)}
          </div>
        </div>
      </details>
      </div></section>
      <section class="fin-panel"><div class="fin-panel-title"><div><h3>سفارش‌ها و وضعیت ثبت مالی</h3><p>فیلتر مشترک تاریخ و شعبه اعمال شده است.</p></div></div>
        ${table('sales-orders', [
          { label: 'سفارش', render: (row) => `<strong class="fin-record-anchor" data-fin-record-id="${esc(row.id)}" tabindex="-1">${esc(row.orderNo || row.id)}</strong>` },
          { label: 'تاریخ حسابداری', render: (row) => `<strong>${dateTime(row.accountingDate || row.paidAt || row.createdAt)}</strong><small class="fin-cell-note">ایجاد سفارش: ${dateTime(row.createdAt)}</small>` },
          { label: 'روش پرداخت', render: (row) => row.tenders?.length ? row.tenders.map((item) => statusBadge(label(item), 'neutral')).join(' ') : statusBadge('نامشخص', 'danger') },
          { label: 'مبلغ', render: (row) => `<strong>${money(row.amountIrr)}</strong>` },
          { label: 'ثبت مالی', render: (row) => statusBadge(row.financeStatus) },
          { label: 'زنجیره', render: (row) => `<button class="fin-btn secondary" type="button" data-fin-order-chain="${esc(row.id)}">جزئیات کامل</button>` },
        ], data.orders, 'سفارش پرداخت‌شده‌ای در این محدوده وجود ندارد.', data.pagination)}
      </section>`;
  }

  function renderPurchases(data) {
    const v2 = data.v2 || { purchaseOrders: [], goodsReceipts: [], vendorInvoices: [], supplierPayments: [] };
    const supplierPayments = [...(v2.supplierPayments || [])].sort((a, b) => new Date(b.paymentDate || b.createdAt) - new Date(a.paymentDate || a.createdAt));
    const operatingExpenses = [...(v2.operatingExpenses || [])].sort((a, b) => new Date(b.date || b.createdAt) - new Date(a.date || a.createdAt));
    const hasPurchaseActivity = Boolean(
      (v2.purchaseOrders || []).length || (v2.goodsReceipts || []).length || (v2.vendorInvoices || []).length || supplierPayments.length
      || (v2.costCommitments || []).length || (v2.costAccruals || []).length || operatingExpenses.length
      || (data.purchaseOrders || []).length || (data.goodsReceipts || []).length || (data.bills || []).length || (data.expenses || []).length,
    );
    const activityCount = (value) => hasPurchaseActivity ? fa(value || 0) : STATUS_COPY.empty;
    const activityMoney = (value) => hasPurchaseActivity ? money(value || 0) : STATUS_COPY.empty;
    const today = localIsoDate();
    const receivablePurchaseLines = (v2.purchaseOrders || []).flatMap((po) => {
      if (!['approved', 'partially_received'].includes(String(po.status || ''))) return [];
      return (po.lines || []).map((line) => ({
        po,
        line,
        remainingQuantity: Math.max(0, Number(line.quantity || 0) - Number(line.receivedQuantity || 0)),
      })).filter((row) => row.remainingQuantity > 1e-9);
    });
    const receivablePoLineCount = receivablePurchaseLines.length;
    const receivingHandoffText = ({ po, line, remainingQuantity }) => [
      `دریافت کالا · سفارش ${po.number || po.id}`,
      `شناسه سفارش: ${po.id}`,
      `شناسه ردیف: ${line.id}`,
      `کالا: ${line.description || line.itemId || 'ثبت نشده'}`,
      `مانده: ${remainingQuantity} ${line.unit || ''}`,
      `شعبه: ${state.query.branchId || 1}`,
    ].join(' | ');
    const operationalReceivingLink = `/admin/kitchen?view=inventory&branchId=${encodeURIComponent(state.query.branchId || 1)}`;
    const receivingHandoff = !can('inventory.receiving')
      ? `<section class="fin-note warning fin-receiving-handoff" id="fin-receiving-handoff" data-fin-receiving-handoff role="status">
          <strong>نیازمند آشپز/انباردار</strong>
          <span>حسابدار فقط صف دریافت را پیگیری می‌کند؛ ثبت رسید کالا و تغییر موجودی در ایستگاه عملیاتی انجام می‌شود.</span>
          ${receivablePurchaseLines.length ? `<div class="fin-receiving-handoff-list">${receivablePurchaseLines.map((row) => {
            const reference = receivingHandoffText(row);
            return `<article class="fin-receiving-handoff-row" data-fin-receiving-handoff-row data-fin-handoff-order-id="${esc(row.po.id)}" data-fin-handoff-line-id="${esc(row.line.id)}">
              <div><strong>سفارش ${esc(row.po.number || row.po.id)}</strong><small>شناسه سفارش: ${esc(row.po.id)} · شناسه ردیف: ${esc(row.line.id)}</small><small>${esc(row.line.description || row.line.itemId || 'کالا')} · مانده ${fa(row.remainingQuantity)} ${esc(row.line.unit || '')}</small></div>
              <div class="fin-inline-action"><a class="fin-btn secondary" href="#fin-receiving-handoff" aria-label="بازکردن پرونده دریافت سفارش ${esc(row.po.number || row.po.id)}">پرونده مالی</a><button class="fin-btn secondary" type="button" data-fin-copy-receiving-handoff="${esc(reference)}">کپی ارجاع</button></div>
            </article>`;
          }).join('')}</div>` : '<small>در حال حاضر ردیف بازِ قابل دریافت وجود ندارد.</small>'}
        </section>`
      : '';
    const invoicedByReceiptLine = new Map();
    (v2.vendorInvoices || []).filter((invoice) => !['match_rejected', 'cancelled'].includes(invoice.status)).forEach((invoice) => (invoice.lines || []).forEach((line) => {
      invoicedByReceiptLine.set(String(line.goodsReceiptLineId), Number(invoicedByReceiptLine.get(String(line.goodsReceiptLineId)) || 0) + Number(line.invoicedQuantity || 0));
    }));
    const availableReceiptLines = (v2.goodsReceipts || []).flatMap((grn) => (grn.lines || []).map((line) => ({
      grn, line, remainingInvoiceQuantity: Math.max(0, Number(line.acceptedQuantity || 0) - Number(invoicedByReceiptLine.get(String(line.id)) || 0)),
    })).filter((row) => row.remainingInvoiceQuantity > 1e-9));
    const payableInvoices = (v2.vendorInvoices || []).filter((row) => ['open', 'partially_paid'].includes(row.status) && Number(row.totalIrr) > Number(row.paidAmountIrr || 0));

    // AP Aging Matrix computation across open & partially paid vendor invoices
    const nowTs = new Date(today).getTime();
    const agingBuckets = {
      current: { label: 'جاری (۰ تا ۳۰ روز)', labelShort: 'جاری', amountIrr: 0, count: 0, tone: 'success' },
      days31_60: { label: '۳۱ تا ۶۰ روز معوق', labelShort: '۳۱-۶۰ روز', amountIrr: 0, count: 0, tone: 'warning' },
      days61_90: { label: '۶۱ تا ۹۰ روز معوق', labelShort: '۶۱-۹۰ روز', amountIrr: 0, count: 0, tone: 'warning' },
      days90Plus: { label: '+۹۰ روز معوق (بحرانی)', labelShort: '+۹۰ روز', amountIrr: 0, count: 0, tone: 'danger' },
    };
    const invoicesWithAging = (v2.vendorInvoices || []).map((inv) => {
      const remainingIrr = Math.max(0, Number(inv.totalIrr || 0) - Number(inv.paidAmountIrr || 0));
      const refDate = inv.dueDate || inv.invoiceDate || today;
      const refTs = new Date(refDate).getTime();
      const daysPastDue = Number.isFinite(refTs) ? Math.max(0, Math.floor((nowTs - refTs) / (1000 * 60 * 60 * 24))) : 0;
      let bucketKey = 'current';
      if (daysPastDue > 90) bucketKey = 'days90Plus';
      else if (daysPastDue > 60) bucketKey = 'days61_90';
      else if (daysPastDue > 30) bucketKey = 'days31_60';
      if (['open', 'partially_paid'].includes(inv.status) && remainingIrr > 0) {
        agingBuckets[bucketKey].amountIrr += remainingIrr;
        agingBuckets[bucketKey].count += 1;
      }
      return { ...inv, remainingIrr, daysPastDue, bucketKey };
    });
    const totalAgingPayableIrr = Object.values(agingBuckets).reduce((sum, b) => sum + b.amountIrr, 0);

    // Top vendors by outstanding debt exposure
    const vendorDebtMap = new Map();
    invoicesWithAging.forEach((inv) => {
      if (inv.remainingIrr > 0) {
        const key = String(inv.vendorId || 'unknown');
        const cur = vendorDebtMap.get(key) || { vendorId: key, debtIrr: 0, count: 0 };
        cur.debtIrr += inv.remainingIrr;
        cur.count += 1;
        vendorDebtMap.set(key, cur);
      }
    });
    const topVendorsByDebt = [...vendorDebtMap.values()]
      .sort((a, b) => b.debtIrr - a.debtIrr)
      .slice(0, 4)
      .map((item) => {
        const vendor = (data.vendors || []).find((v) => String(v.id) === String(item.vendorId));
        return {
          ...item,
          name: vendor?.nameFa || vendor?.name || item.vendorId,
          category: vendor?.category || 'مواد اولیه',
          termsDays: vendor?.termsDays != null ? vendor.termsDays : null,
        };
      });

    const activeCostCommitments = (v2.costCommitments || []).filter((row) => row.status === 'active');
    const costAccruals = v2.costAccruals || [];
    const payableCostAccruals = costAccruals.filter((row) => ['posted', 'partially_paid'].includes(row.status) && Number(row.amountIrr) > Number(row.paidAmountIrr || 0));
    const purchaseItemOptions = `<option value="">انتخاب کنید</option>${(data.inventoryItems || []).map((row) => `<option value="${esc(row.id)}" data-unit="${esc(row.unit || '')}">${esc(row.name || row.id)} · ${esc(row.unit || '')}</option>`).join('')}`;
    const receiptLineOptions = `<option value="">انتخاب کنید</option>${availableReceiptLines.map(({ grn, line, remainingInvoiceQuantity }) => `<option value="${esc(grn.id)}|${esc(line.id)}" data-max="${esc(remainingInvoiceQuantity)}">${esc(grn.number)} · ${esc(line.itemId)} · مانده ${fa(remainingInvoiceQuantity)} ${esc(line.unit)}</option>`).join('')}`;
    const purchaseLineRow = () => `<div class="fin-procurement-row fin-po-line-row" data-fin-po-row>
      <label class="fin-field"><span>ماده/کالا</span><select name="poItemId" required>${purchaseItemOptions}</select></label>
      <label class="fin-field"><span>مقدار</span><input name="poQuantity" inputmode="decimal" required></label>
      <label class="fin-field"><span>واحد پایه</span><input name="poUnit" readonly required aria-readonly="true"></label>
      <label class="fin-field"><span>قیمت واحد (تومان)</span><input name="poUnitPriceToman" inputmode="numeric" required></label>
      <button class="fin-icon-btn" type="button" data-fin-remove-po-row aria-label="حذف ردیف خرید">×</button>
    </div>`;
    const invoiceLineRow = () => `<div class="fin-procurement-row fin-invoice-line-row" data-fin-invoice-row>
      <label class="fin-field"><span>رسید و ردیف</span><select name="invoiceReceiptLine" required>${receiptLineOptions}</select></label>
      <label class="fin-field"><span>مقدار فاکتور</span><input name="invoiceQuantity" inputmode="decimal" required></label>
      <label class="fin-field"><span>قیمت واحد (تومان)</span><input name="invoiceUnitPriceToman" inputmode="numeric" required></label>
      <button class="fin-icon-btn" type="button" data-fin-remove-invoice-row aria-label="حذف ردیف فاکتور">×</button>
    </div>`;
    return `
      <section class="fin-section-head"><div><h2>خرید، هزینه و پرداختنی</h2><p>سفارش خرید ← رسید کالا ← فاکتور ← تطبیق سه‌سویه ← پرداخت</p></div><button class="fin-btn secondary" type="button" data-fin-export="payables" title="خروجی فقط از صفحهٔ جاری">دریافت CSV صفحهٔ جاری</button></section>
      <div class="fin-metrics" data-fin-purchases-summary data-fin-activity-state="${hasPurchaseActivity ? 'active' : 'empty'}">
        ${metric('سفارش خرید جدید', activityCount(data.summary.v2PurchaseOrders), 'از پیش‌نویس تا دریافت')}
        ${metric('فاکتور باز جدید', activityCount(data.summary.v2OpenInvoices), hasPurchaseActivity ? `${fa(data.summary.matchExceptions || 0)} اختلاف تطبیق` : STATUS_COPY.empty, data.summary.matchExceptions ? 'danger' : '')}
        ${metric('پرداختنی قابل اتکا', activityMoney(data.summary.v2PayableIrr), 'فقط فاکتورهای ثبت‌شده در سامانه جدید')}
        ${metric('پرداخت منتظر تأیید', activityCount(data.summary.pendingSupplierPayments), 'خروج وجه فقط پس از تأیید مالک', data.summary.pendingSupplierPayments ? 'warning' : '')}
      </div>
      <div class="fin-flow" data-fin-purchase-chain aria-label="زنجیره خرید و پرداخت"><span>${activityCount(v2.purchaseOrders?.length)} سفارش خرید</span><b>←</b><span>${activityCount(v2.goodsReceipts?.length)} رسید کالا</span><b>←</b><span>${activityCount(v2.vendorInvoices?.length)} فاکتور و تطبیق</span><b>←</b><span>${activityCount(supplierPayments.length)} درخواست پرداخت</span></div>
      ${hasPurchaseActivity ? '' : `<div class="fin-note" data-fin-no-activity><strong>${STATUS_COPY.empty}</strong><span>برای شروع، یک سفارش خرید یا هزینهٔ واقعی ثبت کنید؛ در این حالت هیچ بدهی یا مبلغ ساختگی نمایش داده نمی‌شود.</span></div>`}
      <section class="fin-panel fin-operations"><div class="fin-panel-title"><div><h3>میز عملیات خرید و پرداختنی</h3><p>هر مرحله فقط دادهٔ لازم همان کار را می‌گیرد؛ مبلغ در صفحه تومان و در ذخیره‌سازی ریال است.</p></div><span>عملیاتی</span></div><div id="fin-operation-feedback"></div>
        <div class="fin-procurement-stack">
          <details class="fin-advanced" open><summary>۱. ایجاد سفارش خرید</summary>
            <form id="fin-po-form" class="fin-form fin-procurement-form" autocomplete="off">
              <label class="fin-field"><span>تأمین‌کننده</span><select name="vendorId" required><option value="">انتخاب کنید</option>${(data.vendors || []).map((row) => `<option value="${esc(row.id)}">${esc(row.nameFa || row.name || row.id)}</option>`).join('')}</select></label>
              <label class="fin-field"><span>تاریخ سفارش</span><input name="issueDate" type="date" value="${today}" required></label>
              <div class="fin-procurement-lines span-all" data-fin-po-lines>${purchaseLineRow()}</div>
              <template id="fin-po-line-template">${purchaseLineRow()}</template>
              <div class="fin-procurement-actions span-all"><button class="fin-btn secondary" type="button" data-fin-add-po-row ${(data.inventoryItems || []).length ? '' : 'disabled'}>افزودن ردیف خرید</button><small>هر ردیف به واحد پایه همان قلم انبار قفل می‌شود.</small></div>
              <label class="fin-field span-2"><span>یادداشت</span><input name="notes" maxlength="300"></label>
              <label class="fin-check span-2"><input name="submitForApproval" type="checkbox" checked><span>پس از ذخیره برای تأیید مدیر/مالک ارسال شود</span></label>
              <button class="fin-btn primary span-2" type="submit" ${(data.inventoryItems || []).length ? '' : 'disabled'}>ثبت سفارش خرید چندردیفی</button>
            </form>
          </details>
          <details class="fin-advanced" id="fin-receiving-step"${!can('inventory.receiving') ? ' open' : ''}><summary>۲. دریافت فیزیکی کالا (${fa(receivablePoLineCount)} ردیف قابل دریافت)</summary>
            <div class="fin-note"><strong>تفکیک وظایف</strong><span>ثبت مقدار تحویل‌شده در پنل آشپزخانه/انبار انجام می‌شود؛ آن پنل قیمت خرید و کد حساب را نمایش نمی‌دهد. پس از ثبت، رسید، موجودی و حساب کالای فاکتورنشده خودکار به همین پرونده برمی‌گردند.</span></div>
            ${can('inventory.receiving')
              ? `<a class="fin-btn secondary" href="${operationalReceivingLink}">رفتن به پنل دریافت کالا</a>`
              : receivingHandoff}
          </details>
          <details class="fin-advanced"><summary>۳. ثبت فاکتور و تطبیق سه‌سویه (${fa(availableReceiptLines.length)} رسید)</summary>
            <form id="fin-invoice-form" class="fin-form fin-procurement-form" autocomplete="off">
              <label class="fin-field"><span>شماره فاکتور</span><input name="invoiceNumber" required maxlength="120"></label>
              <label class="fin-field"><span>تاریخ فاکتور</span><input name="invoiceDate" type="date" value="${today}" required></label>
              <div class="fin-procurement-lines span-all" data-fin-invoice-lines>${invoiceLineRow()}</div>
              <template id="fin-invoice-line-template">${invoiceLineRow()}</template>
              <div class="fin-procurement-actions span-all"><button class="fin-btn secondary" type="button" data-fin-add-invoice-row ${availableReceiptLines.length ? '' : 'disabled'}>افزودن ردیف فاکتور</button><small>ردیف‌های هر فاکتور باید از یک رسید کالا باشند؛ فاکتور جزئی مجاز است.</small></div>
              <label class="fin-field"><span>مالیات کل (تومان)</span><input name="vatToman" inputmode="numeric" value="0" required></label>
              <button class="fin-btn primary" type="submit" ${availableReceiptLines.length ? '' : 'disabled'}>ثبت و تطبیق چندردیفی</button>
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
      <section class="fin-panel fin-operations"><div class="fin-panel-title"><div><h3>اجاره، حقوق و هزینه‌های دوره‌ای</h3><p>تعریف یک‌بار، ثبت ماهانهٔ کنترل‌شده، تأیید مستقل و سپس پرداخت؛ بدون انتخاب آزاد حساب بدهکار/بستانکار.</p></div><span>متصل به نقطه سربه‌سر واقعی</span></div>
        <div class="fin-metrics">
          ${metric('تعهد فعال', fa(data.summary.activeCostCommitments), 'اجاره، حقوق و هزینه جاری')}
          ${metric('مبلغ ماهانه تعریف‌شده', money(data.summary.committedMonthlyCostIrr), 'برنامه؛ تا ثبت دوره‌ای وارد دفتر کل نمی‌شود')}
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
      <section class="fin-grid-2 fin-purchase-followup" data-fin-purchase-followup>
        <section class="fin-panel"><div class="fin-panel-title"><div><h3>پیگیری پرداخت تأمین‌کننده</h3><p>هر درخواست تا تأیید و خروج واقعی وجه قابل پیگیری است.</p></div><span>${activityCount(supplierPayments.length)} مورد</span></div>
          <div class="fin-operation-list" data-fin-purchase-payments>${supplierPayments.length ? supplierPayments.map((row) => {
            const invoice = (v2.vendorInvoices || []).find((item) => item.id === row.vendorInvoiceId);
            const tone = row.status === 'paid' ? 'success' : ['rejected', 'reversed'].includes(row.status) ? 'danger' : 'warning';
            return `<article><div><strong>${esc(invoice?.invoiceNumber || row.vendorInvoiceId || 'فاکتور')}</strong><small>${dateTime(row.paymentDate || row.createdAt)} · ${esc(label(row.paymentMethod))}${row.reference ? ` · مرجع ${esc(row.reference)}` : ''}</small></div><div>${statusBadge(row.status, tone)}<b>${money(row.amountIrr)}</b></div></article>`;
          }).join('') : empty('هنوز درخواست پرداخت تأمین‌کننده‌ای ثبت نشده است.')}</div>
        </section>
        <section class="fin-panel"><div class="fin-panel-title"><div><h3>هزینه‌های عملیاتی ثبت‌شده</h3><p>ثبت هزینه، تأیید و اثر قطعی آن را در همین پرونده دنبال کنید.</p></div><span>${activityCount(operatingExpenses.length)} مورد</span></div>
          <div class="fin-operation-list" data-fin-operating-expenses>${operatingExpenses.length ? operatingExpenses.map((row) => `<article><div><strong>${esc(row.subject || row.description || 'هزینهٔ عملیاتی')}</strong><small>${dateTime(row.date || row.createdAt)} · ${esc(row.category || 'سایر')}${row.reference ? ` · مرجع ${esc(row.reference)}` : ''}</small></div><div>${statusBadge(row.status, row.status === 'posted' ? 'success' : row.status === 'rejected' ? 'danger' : 'warning')}<b>${money(row.amountIrr)}</b></div></article>`).join('') : empty('هنوز هزینهٔ عملیاتی ثبت نشده است.')}</div>
        </section>
      </section>
      <section class="fin-panel"><div class="fin-panel-title"><div><h3>زنجیره خرید جدید</h3><p>وضعیت و اقدام بعدی هر پرونده</p></div></div>
        ${table('v2-purchase-orders', [
          { label: 'شماره', render: (row) => `<strong>${esc(row.number)}</strong>` },
          { label: 'تأمین‌کننده', render: (row) => esc((data.vendors || []).find((vendor) => String(vendor.id) === String(row.vendorId))?.nameFa || row.vendorId) },
          { label: 'مبلغ', render: (row) => money(row.totalIrr) },
          { label: 'وضعیت', render: (row) => statusBadge(row.status, row.status === 'received' ? 'success' : row.status === 'rejected' ? 'danger' : 'warning') },
          { label: 'اقدام', render: (row) => row.status === 'draft' ? `<button class="fin-btn secondary" type="button" data-fin-submit-po="${esc(row.id)}">ارسال برای تأیید</button>` : '—' },
        ], v2.purchaseOrders, 'هنوز سفارش خریدی در سامانه جدید ثبت نشده است.')}
      </section>
      <section class="fin-panel fin-ap-aging-panel" data-fin-ap-aging-section>
        <div class="fin-panel-title">
          <div>
            <h3>ماتریس سن‌سنجی بدهی‌های پرداختنی (AP Aging)</h3>
            <p>تفکیک بدهی‌ها بر اساس سررسید و روزهای معوق جهت مدیریت جریان نقدینگی و اولویت‌بندی تسویه</p>
          </div>
          <div class="fin-ap-aging-total">
            <span>مجموع پرداختنی:</span>
            <strong>${money(totalAgingPayableIrr)}</strong>
          </div>
        </div>
        <div class="fin-ap-aging-matrix">
          ${Object.entries(agingBuckets).map(([key, bucket]) => {
            const pct = totalAgingPayableIrr > 0 ? Math.round((bucket.amountIrr / totalAgingPayableIrr) * 100) : 0;
            return `
              <div class="fin-ap-aging-card ${bucket.tone}" data-fin-aging-bucket="${key}" role="button" tabindex="0" title="فیلتر فاکتورهای ${bucket.label}">
                <div class="fin-ap-aging-card__head">
                  <span>${esc(bucket.label)}</span>
                  <span class="fin-badge ${bucket.tone}">${fa(bucket.count)} فاکتور</span>
                </div>
                <strong class="fin-ap-aging-card__amount">${money(bucket.amountIrr)}</strong>
                <div class="fin-ap-aging-card__foot">
                  <small>${fa(pct)}٪ از کل بدهی</small>
                </div>
              </div>
            `;
          }).join('')}
        </div>
        ${totalAgingPayableIrr > 0 ? `
          <div class="fin-ap-aging-bar-wrap" aria-label="نمودار توزیع سن‌سنجی بدهی">
            <div class="fin-ap-aging-bar">
              ${Object.entries(agingBuckets).map(([key, bucket]) => {
                const pct = totalAgingPayableIrr > 0 ? (bucket.amountIrr / totalAgingPayableIrr) * 100 : 0;
                return pct > 0 ? `<div class="fin-ap-aging-segment ${bucket.tone}" style="width: ${pct}%" title="${bucket.label}: ${money(bucket.amountIrr)} (${fa(Math.round(pct))}٪)"></div>` : '';
              }).join('')}
            </div>
            <div class="fin-ap-aging-legend">
              <span class="fin-legend-item success"><i class="dot"></i> جاری (۰-۳۰)</span>
              <span class="fin-legend-item warning"><i class="dot"></i> ۳۱-۶۰ روز</span>
              <span class="fin-legend-item orange"><i class="dot"></i> ۶۱-۹۰ روز</span>
              <span class="fin-legend-item danger"><i class="dot"></i> +۹۰ روز معوق</span>
            </div>
          </div>
        ` : ''}
      </section>
      ${topVendorsByDebt.length ? `
      <section class="fin-panel fin-top-vendors-panel">
        <div class="fin-panel-title">
          <div>
            <h3>تأمین‌کنندگان با بیشترین مانده پرداختنی</h3>
            <p>تعهدات عمدهٔ تأمین و شرایط اعتباری تسویه</p>
          </div>
          <span>${fa(topVendorsByDebt.length)} تأمین‌کننده</span>
        </div>
        <div class="fin-top-vendors-grid">
          ${topVendorsByDebt.map((v) => `
            <article class="fin-vendor-card">
              <div class="fin-vendor-card__info">
                <strong>${esc(v.name)}</strong>
                <small>${esc(v.category)}${v.termsDays != null ? ` · مهلت ${fa(v.termsDays)} روز` : ''}</small>
              </div>
              <div class="fin-vendor-card__balance">
                <b>${money(v.debtIrr)}</b>
                <span class="fin-badge neutral">${fa(v.count)} فاکتور باز</span>
              </div>
            </article>
          `).join('')}
        </div>
      </section>
      ` : ''}
      <section class="fin-panel"><div class="fin-panel-title"><div><h3>فاکتور و پرداخت</h3><p>اختلاف تطبیق قبل از ایجاد بدهی و پرداخت متوقف می‌شود.</p></div></div>
        ${table('v2-invoices', [
          { label: 'فاکتور', render: (row) => `<strong>${esc(row.invoiceNumber)}</strong>${row.invoiceDate ? `<small class="fin-cell-note">${dateOnly(row.invoiceDate)}</small>` : ''}` },
          { label: 'مبلغ', render: (row) => money(row.totalIrr) },
          { label: 'مانده', render: (row) => {
            const remaining = Number(row.totalIrr) - Number(row.paidAmountIrr || 0);
            const paidPct = Number(row.totalIrr) > 0 ? Math.min(100, Math.round((Number(row.paidAmountIrr || 0) / Number(row.totalIrr)) * 100)) : 0;
            return `<strong>${money(remaining)}</strong>${paidPct > 0 ? `<div class="fin-partial-progress"><span style="width: ${paidPct}%"></span><small>${fa(paidPct)}٪ تسویه</small></div>` : ''}`;
          } },
          { label: 'سررسید و سن بدهی', render: (row) => {
            const refDate = row.dueDate || row.invoiceDate || today;
            const daysPastDue = Math.max(0, Math.floor((nowTs - new Date(refDate).getTime()) / (1000 * 60 * 60 * 24)));
            let badgeTone = 'success';
            let badgeText = 'جاری (۰-۳۰)';
            if (daysPastDue > 90) { badgeTone = 'danger'; badgeText = `${fa(daysPastDue)} روز (+۹۰)`; }
            else if (daysPastDue > 60) { badgeTone = 'danger'; badgeText = `${fa(daysPastDue)} روز (۶۱-۹۰)`; }
            else if (daysPastDue > 30) { badgeTone = 'warning'; badgeText = `${fa(daysPastDue)} روز (۳۱-۶۰)`; }
            else if (daysPastDue > 0) { badgeTone = 'warning'; badgeText = `${fa(daysPastDue)} روز معوق`; }
            return `<span class="fin-badge ${badgeTone}">${esc(badgeText)}</span>`;
          } },
          { label: 'تطبیق', render: (row) => statusBadge(row.matchStatus, ['matched', 'accepted_variance'].includes(row.matchStatus) ? 'success' : 'danger') },
          { label: 'وضعیت', render: (row) => statusBadge(row.status, row.status === 'paid' ? 'success' : ['match_exception', 'match_rejected'].includes(row.status) ? 'danger' : 'warning') },
          { label: 'اقدام اختلاف', render: (row) => {
            if (row.status === 'match_exception') {
              return row.matchReview?.status === 'pending_approval'
                ? statusBadge('pending_approval', 'warning')
                : `<button class="fin-btn secondary" type="button" data-fin-request-match-review="${esc(row.id)}">ارسال برای تصمیم</button>`;
            }
            const remaining = Number(row.totalIrr) - Number(row.paidAmountIrr || 0);
            if (['open', 'partially_paid'].includes(row.status) && remaining > 0) {
              const amountToman = Math.round(remaining / 10);
              return `<button class="fin-btn primary fin-quick-pay-btn" type="button" data-fin-quick-pay="${esc(row.id)}" data-amount-toman="${amountToman}" title="تسویه سریع فاکتور">پرداخت سریع</button>`;
            }
            return '—';
          } },
        ], invoicesWithAging, 'هنوز فاکتوری در سامانه جدید ثبت نشده است.')}
      </section>
      <div class="fin-note warning"><strong>دادهٔ قدیمی فقط برای بررسی است</strong><span>${fa(data.purchaseOrders?.length || 0)} سفارش خرید، ${fa(data.goodsReceipts?.length || 0)} رسید و ${fa(data.bills?.length || 0)} فاکتور تاریخی وارد دفتر مالی جدید نشده‌اند؛ حذف یا تبدیل کور انجام نمی‌شود.</span></div>
      <details class="fin-advanced"><summary>تأمین‌کنندگان و مانده‌های تاریخی</summary><section class="fin-legacy-table">
        ${table('vendors', [
          { label: 'تأمین‌کننده', render: (row) => `<strong class="fin-record-anchor" data-fin-record-id="${esc(row.id)}" tabindex="-1">${esc(row.nameFa || row.name || row.id)}</strong>` },
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
    const breakEvenDashboard = data.breakEvenDashboard || { status: 'needs_branch', chart: { status: 'insufficient_data' } };
    const breakEvenPlan = breakEvenDashboard.plan || breakEvenDashboard.suggestedPlan || {};
    const breakEvenAmounts = breakEvenPlanAmounts(breakEvenPlan);
    const projection = breakEvenDashboard.projection || {};
    const projectionForecast = projection.forecast || {};
    const deadlineStatusLabel = ({ on_track: 'در مسیر سوددهی تا ددلاین', at_risk: 'در خطر نرسیدن تا ددلاین', achieved: 'تا ددلاین به سوددهی رسیده', missed: 'ددلاین رد شده و هدف نرسیده' })[projectionForecast.deadlineStatus] || 'برای محاسبه، فروش و بهای تمام‌شده لازم است';
    const contributionSource = breakEvenDashboard.dataSources?.selected || null;
    const contributionCandidates = Array.isArray(breakEvenDashboard.dataSources?.candidates) ? breakEvenDashboard.dataSources.candidates : [];
    const usableContribution = contributionCandidates.find((candidate) => candidate?.usable) || null;
    const sourceReady = Boolean(usableContribution);
    const planDeadlineConfirmed = breakEvenPlan.deadline?.isConfirmed === true;
    const recipeCoverageQueue = data.recipeCoverageQueue || [];
    const recipeApprovalReviewQueue = data.recipeApprovalReviewQueue || [];
    const qualitySummary = data.summary || {};
    const recipeReady = Number(qualitySummary.recipes || 0) > 0
      && Number(qualitySummary.invalidCostItems || 0) === 0
      && Number(qualitySummary.unversionedRecipes || 0) === 0
      && Number(qualitySummary.recipeApprovalAuditMissing || 0) === 0
      && recipeCoverageQueue.length === 0;
    const coverageIssueLabel = (code) => ({
      recipe_missing: 'دستور تهیهٔ مؤثر ندارد', recipe_line_invalid: 'ردیف دستور تهیه نامعتبر است', ingredient_item_missing: 'ماده به انبار وصل نیست',
      ingredient_quantity_invalid: 'مقدار ماده نامعتبر', unit_conversion_missing: 'تبدیل واحد ناقص', unit_dimension_mismatch: 'واحد ناسازگار',
    })[code] || label(code);
    return `
      <section class="fin-section-head"><div><h2>بهای تمام‌شده و انبار</h2><p>واقعیت عملیاتی در آشپزخانه و انبار ثبت می‌شود؛ اینجا اثر مالی و مغایرت دیده می‌شود.</p></div><button class="fin-btn secondary" type="button" data-fin-export="costing" title="خروجی فقط از صفحهٔ جاری">دریافت CSV صفحهٔ جاری</button></section>
      <div class="fin-metrics">
        ${metric('اقلام انبار', fa(data.summary.inventoryItems), 'منبع: اقلام ثبت‌شده انبار')}
        ${metric('دستور تهیه', fa(data.summary.recipes), `${fa(data.summary.unversionedRecipes)} بدون نسخه · ${fa(data.summary.recipeApprovalAuditMissing || 0)} بدون تأیید مستقل`, data.summary.unversionedRecipes || data.summary.recipeApprovalAuditMissing ? 'warning' : '')}
        ${metric('گردش جدید انبار', fa(data.summary.shadowMovements), 'فروش، ضایعات، شمارش و تولید')}
        ${metric('ضایعات قدیمی', fa(data.summary.wasteEvents), 'فقط برای بررسی؛ ثبت جدید در پنل آشپزخانه')}
      </div>
      <div class="fin-grid-2">
        <section class="fin-panel"><div class="fin-panel-title"><div><h3>بهای تمام‌شده نظری</h3><p>دستور تهیهٔ نسخه‌دار × قیمت معتبر مواد</p></div>${statusBadge(data.theoreticalCogs.status, data.theoreticalCogs.amountIrr == null ? 'warning' : 'success')}</div>${data.theoreticalCogs.amountIrr == null ? empty('تا نسخه‌بندی دستور تهیه و تکمیل قیمت معتبر، مبلغ نظری محاسبه نمی‌شود.') : `<strong>${money(data.theoreticalCogs.amountIrr)}</strong>`}</section>
        <section class="fin-panel"><div class="fin-panel-title"><div><h3>خروج ارزش‌گذاری‌شده انبار</h3><p>مصرف نظری فروش + ضایعات + کسری شمارش؛ هر جزء جدا نگه‌داری می‌شود.</p></div>${statusBadge(data.actualConsumption.status, data.actualConsumption.amountIrr == null ? 'warning' : 'success')}</div>${data.actualConsumption.amountIrr == null ? empty('تا ارزش‌گذاری کامل گردش‌ها، جمع مبلغ نمایش داده نمی‌شود.') : `<strong>${money(data.actualConsumption.amountIrr)}</strong><small>فروش: ${money(data.actualConsumption.components?.theoreticalSaleConsumptionIrr || 0)} · ضایعات: ${money(data.actualConsumption.components?.wasteIrr || 0)} · کسری شمارش: ${money(data.actualConsumption.components?.negativeCountAdjustmentIrr || 0)}</small>`}</section>
      </div>
      <section class="fin-panel fin-break-even-planning"><div class="fin-panel-title"><div><h3>نقشهٔ سودآوری تا ددلاین</h3><p>فروش و بهای تمام‌شده از یک منبع هم‌مبنا خوانده می‌شوند؛ مبالغ پایه فقط برنامه‌ای هستند و هرگز سند واقعی ایجاد نمی‌کنند.</p></div>${statusBadge(breakEvenDashboard.status === 'available' ? 'available' : breakEvenDashboard.status === 'needs_plan' ? 'pending' : 'insufficient_data', breakEvenDashboard.status === 'available' ? 'success' : 'warning')}</div>
        ${breakEvenDashboard.message ? `<div class="fin-note warning"><strong>وضعیت برنامه</strong><span>${esc(breakEvenDashboard.message)}</span></div>` : ''}
        <div class="fin-break-even-readiness" aria-label="آمادگی محاسبهٔ سودآوری">
          <article class="${planDeadlineConfirmed ? 'success' : 'warning'}"><span>۱</span><div><strong>هزینه و ددلاین</strong><small>${planDeadlineConfirmed ? 'ددلاین واقعی برنامه تأیید شده است.' : 'مبالغ پایه آماده‌اند؛ ددلاین پیشنهادی را پیش از ذخیره تأیید کنید.'}</small></div><a href="#fin-break-even-plan-form">تکمیل برنامه</a></article>
          <article class="${sourceReady ? 'success' : 'warning'}"><span>۲</span><div><strong>فروش و بهای مواد</strong><small>${sourceReady ? `${esc(usableContribution.source?.label || 'منبع هم‌مبنا')} · ${fa(usableContribution.rowCount || 0)} روز یا ردیف قابل محاسبه` : 'فروش خالص و بهای موادِ همان فروش باید هر دو ثبت شوند.'}</small></div><a href="/admin?financeWorkspace=sales_bank&branchId=${encodeURIComponent(state.query.branchId || 1)}#accounting">بررسی فروش</a></article>
          <article class="${recipeReady ? 'success' : 'warning'}"><span>۳</span><div><strong>دستور تهیه و انبار</strong><small>${recipeReady ? 'دستورهای تهیهٔ لازم نسخه‌دار، قیمت‌گذاری‌شده و دارای تأیید مستقل‌اند.' : `${fa(qualitySummary.recipes || 0)} دستور تهیه · ${fa(qualitySummary.invalidCostItems || 0)} قیمت نامعتبر · ${fa(qualitySummary.recipeApprovalAuditMissing || 0)} بدون تأیید مستقل · ${fa(recipeCoverageQueue.length)} شکاف فروش`}</small></div><a href="/admin/kitchen?view=inventory&branchId=${encodeURIComponent(state.query.branchId || 1)}">تکمیل دستور تهیه</a></article>
        </div>
        <div id="fin-break-even-chart" class="fin-break-even-chart-slot" aria-live="polite"></div>
        <div class="fin-result-grid">
          ${metric('هزینهٔ ثابت ماهانهٔ برنامه', money(breakEvenPlan.monthlyFixedCostIrr), 'اجاره، نیرو و اشتراک‌ها؛ خارج از دفتر واقعی')}
          ${metric('فروش سربه‌سر تا ددلاین', projection.breakEvenSalesIrr == null ? 'داده کافی نیست' : money(projection.breakEvenSalesIrr), projection.contributionMarginRatio == null ? 'برای محاسبه، فروش و هزینهٔ متغیر لازم است' : `حاشیه مشارکت ${fa(Math.round(projection.contributionMarginRatio * 10000) / 100)}٪`)}
          ${metric('روز عبور پیش‌بینی‌شده', projectionForecast.breakEvenDate ? dateOnly(projectionForecast.breakEvenDate) : 'هنوز مشخص نیست', projectionForecast.breakEvenDate ? `روز ${fa(projectionForecast.breakEvenDay)} دوره` : deadlineStatusLabel, projectionForecast.deadlineStatus === 'on_track' || projectionForecast.deadlineStatus === 'achieved' ? 'success' : projectionForecast.deadlineStatus === 'at_risk' || projectionForecast.deadlineStatus === 'missed' ? 'danger' : 'warning')}
          ${metric('منبع حاشیه مشارکت', contributionSource?.label || 'دادهٔ هم‌مبنا ثبت نشده', contributionSource?.official ? 'اسناد قطعی دفتر مالی' : contributionSource ? 'ثبت لحظه‌ای دستور تهیه و بهای تمام‌شده؛ برای پیش‌بینی' : 'فروش و بهای تمام‌شده را کامل کنید')}
        </div>
        <details class="fin-details" open><summary>ویرایش مبنای برنامه و ددلاین</summary><div class="fin-details-body">
          <form id="fin-break-even-plan-form" class="fin-form fin-form-wide" autocomplete="off">
            <input type="hidden" name="planId" value="${esc(breakEvenPlan.id || '')}">
            <label class="fin-field"><span>نام برنامه</span><input name="name" maxlength="160" value="${esc(breakEvenPlan.name || 'مبنای برنامهٔ سودآوری')}"></label>
            <label class="fin-field"><span>شروع تحلیل</span><input name="startDate" type="date" value="${esc(breakEvenPlan.startDate || '')}" required></label>
            <label class="fin-field"><span>ددلاین سوددهی</span><input name="deadlineDate" type="date" value="${esc(breakEvenPlan.deadlineDate || '')}" required></label>
            <label class="fin-break-even-deadline-confirmation span-all"><input name="deadlineConfirmed" type="checkbox" ${planDeadlineConfirmed ? 'checked' : ''}><span><strong>ددلاین را بر پایهٔ برنامهٔ واقعی مجموعه تأیید می‌کنم.</strong><small>تا این تأیید انجام نشود، برنامه ذخیره نمی‌شود و هیچ سند واقعی هم ساخته نخواهد شد.</small></span></label>
            <label class="fin-field"><span>اجاره ماهانه (تومان)</span><input name="rentToman" inputmode="numeric" value="${esc(breakEvenAmounts.rentToman)}" required></label>
            <label class="fin-field"><span>تعداد نیرو</span><input name="payrollHeadcount" inputmode="numeric" value="${esc(breakEvenAmounts.payrollHeadcount)}" required></label>
            <label class="fin-field"><span>حقوق هر نفر در ماه (تومان)</span><input name="payrollSalaryToman" inputmode="numeric" value="${esc(breakEvenAmounts.payrollSalaryToman)}" required></label>
            <label class="fin-field"><span>آب، برق و گاز ماهانه (تومان)</span><input name="utilitiesToman" inputmode="numeric" value="${esc(breakEvenAmounts.utilitiesToman)}" required></label>
            <label class="fin-field"><span>سایر هزینهٔ ثابت ماهانه (تومان)</span><input name="otherFixedToman" inputmode="numeric" value="${esc(breakEvenAmounts.otherFixedToman)}" required></label>
            <div id="fin-break-even-feedback" class="span-all"></div>
            <button class="fin-btn primary" type="submit">ذخیره و محاسبهٔ مسیر سوددهی</button>
          </form>
          <div class="fin-note"><strong>مرز داده‌ها</strong><span>اجارهٔ ۸۰۰ میلیون، حقوق ۱۰ نفر × ۴۵ میلیون و اشتراک‌های ۳۰ میلیون تومان به‌عنوان مبنای قابل‌ویرایش آماده‌اند. ددلاین پیش‌فرض فقط پیشنهادی است و تا تأیید شما ذخیره نمی‌شود. تا وقتی تعهد یا سند واقعی نسازید، این مبالغ در دفتر کل و هزینهٔ واقعی وارد نمی‌شوند.</span></div>
        </div></details>
      </section>
      <section class="fin-panel"><div class="fin-panel-title"><div><h3>کیفیت دادهٔ هزینه</h3><p>پیش‌نیاز گزارش سودآوری منو</p></div></div>
        <div class="fin-check-grid"><article class="${data.summary.invalidCostItems ? 'danger' : 'success'}"><strong>قیمت نامعتبر مواد</strong><span>${fa(data.summary.invalidCostItems)}</span></article><article class="${data.summary.unversionedRecipes ? 'warning' : 'success'}"><strong>دستور تهیه بدون نسخه</strong><span>${fa(data.summary.unversionedRecipes)}</span></article><article class="${data.summary.recipeApprovalAuditMissing ? 'danger' : 'success'}"><strong>بدون زنجیرهٔ تأیید مستقل</strong><span>${fa(data.summary.recipeApprovalAuditMissing || 0)}</span></article></div>
      </section>
      <section class="fin-panel"><div class="fin-panel-title"><div><h3>صف بازبینی تأیید دستورهای تهیه</h3><p>نسخهٔ ساختاریِ بدون approval مستقل برای COGS رسمی معتبر نیست؛ این صفحه فقط شواهد را نشان می‌دهد و وضعیت را خودکار تغییر نمی‌دهد.</p></div><a class="fin-btn secondary" href="/admin?financeWorkspace=workbench&branchId=${encodeURIComponent(state.query.branchId || 1)}#accounting">بازگشت به کارتابل</a></div>
        ${table('recipe-approval-review', [
          { label: 'محصول منو', render: (row) => `<strong>${esc(row.menuItemName || 'محصول نامشخص')}</strong><small>${esc(row.menuItemId || row.id)}</small>` },
          { label: 'نسخه و شعبه', render: (row) => `${esc(row.version == null ? '—' : String(row.version))} · ${row.branchId == null ? 'عمومی' : esc(String(row.branchId))}` },
          { label: 'وضعیت', render: (row) => statusBadge(row.status || 'نامشخص', 'danger') },
          { label: 'شواهد ناقص', render: (row) => (row.missingEvidence || []).map((code) => esc(({ approved_by: 'تأییدکننده', approved_at: 'زمان تأیید', approval_record: 'رکورد approval', approval_entity: 'نوع موجودیت', approval_entity_id: 'شناسه موجودیت', approval_operation: 'عملیات approval', approval_decision: 'تصمیم نهایی' })[code] || code)).join('، ') || '—' },
          { label: 'اقدام مجاز', render: () => statusBadge('بازبینی آشپز/مدیر ← تأیید مستقل', 'warning') },
        ], recipeApprovalReviewQueue, 'همهٔ نسخه‌های مؤثر دستور تهیه زنجیرهٔ تأیید مستقل معتبر دارند.')}
        ${recipeApprovalReviewQueue.length ? '<div class="fin-note warning"><strong>تا تعیین تکلیف، COGS رسمی متوقف است</strong><span>ایجاد نسخهٔ شعبه‌ای و تأیید آن باید از workflow آشپزخانه و مدیر/مالک مستقل انجام شود؛ approvedBy یا approval صوری قابل قبول نیست.</span></div>' : ''}
      </section>
      <section class="fin-panel"><div class="fin-panel-title"><div><h3>شکاف پوشش دستور تهیهٔ فروش</h3><p>صف اقدام بر پایه خطوط فروش پرداخت‌شده؛ حسابدار مشکل را می‌بیند و آشپز/انباردار مقدار واقعی مواد را پیشنهاد می‌کند.</p></div><a class="fin-btn secondary" href="/admin/kitchen?view=inventory&branchId=${encodeURIComponent(state.query.branchId || 1)}">رفتن به دستورهای تهیه</a></div>
        ${table('recipe-coverage-queue', [
          { label: 'محصول واقعی منو', render: (row) => `<strong>${esc(row.menuItemName)}</strong><small>${esc(row.menuItemId || 'شناسه نامشخص')}</small>` },
          { label: 'خط فروش خارج از پوشش', render: (row) => `<strong>${fa(row.affectedSaleLines)}</strong>` },
          { label: 'علت‌ها', render: (row) => Object.entries(row.issueCounts || {}).map(([code, count]) => `<span>${esc(coverageIssueLabel(code))}: ${fa(count)}</span>`).join('') || '—' },
          { label: 'نمونه سفارش', render: (row) => (row.latestOrderIds || []).map((id) => esc(id)).join('، ') || '—' },
          { label: 'مسئول اقدام', render: () => statusBadge('آشپز/انباردار ← تأیید مالک', 'warning') },
        ], recipeCoverageQueue, 'تمام خطوط فروش انتخاب‌شده دارای دستور تهیهٔ مؤثر و قابل محاسبه‌اند.')}
        <div class="fin-note"><strong>تفکیک وظایف</strong><span>حسابدار قیمت و اثر مالی را کنترل می‌کند، اما مقدار ماده را به‌جای آشپز حدس نمی‌زند؛ نسخهٔ تازه تا تأیید مستقل وارد بهای تمام‌شده نمی‌شود.</span></div>
      </section>
      <section class="fin-panel"><div class="fin-panel-title"><div><h3>سود ناخالص نظری محصولات فروخته‌شده</h3><p>مبلغ ثبت‌شده هنگام فروش منهای بهای نظری همان نسخهٔ دستور تهیه؛ کارمزد کانال و بسته‌بندی هنوز «حاشیه مشارکت» محسوب نمی‌شوند.</p></div>${statusBadge(profitability.status, profitability.status === 'snapshot_backed' ? 'success' : profitability.status === 'partial_coverage' ? 'warning' : 'neutral')}</div>
        ${table('item-profitability', [
          { label: 'محصول', render: (row) => `<strong>${esc(row.name)}</strong>` },
          { label: 'تعداد', render: (row) => fa(row.quantity) },
          { label: 'فروش خالص ثبت‌شده', render: (row) => money(row.netSalesIrr) },
          { label: 'بهای تمام‌شده نظری', render: (row) => money(row.theoreticalCogsIrr) },
          { label: 'سود ناخالص نظری', render: (row) => `<strong>${money(row.theoreticalGrossProfitIrr)}</strong>` },
          { label: 'حاشیه ناخالص نظری', render: (row) => row.theoreticalGrossMarginPercent == null ? '—' : `${fa(row.theoreticalGrossMarginPercent)}٪` },
          { label: 'اقدام', render: (row) => statusBadge(row.action === 'stop_and_review' ? 'توقف و بازبینی' : row.action === 'review_cost_or_price' ? 'بازبینی قیمت یا دستور تهیه' : 'پایش', row.action === 'stop_and_review' ? 'danger' : row.action === 'review_cost_or_price' ? 'warning' : 'success') },
        ], profitability.rows, 'تا فروش دارای دستور تهیهٔ نسخه‌دار و قیمت معتبر ثبت نشود، سودآوری محصول نمایش داده نمی‌شود.')}
        ${profitability.refundCountNotAllocated ? `<div class="fin-note warning"><strong>نتیجه رسمی نیست</strong><span>${fa(profitability.refundCountNotAllocated)} بازپرداخت در سطح پرداخت ثبت شده و به ردیف منو تخصیص ندارد؛ سود محصولات عمداً با پوشش ناقص نمایش داده می‌شود.</span></div>` : ''}
      </section>
      <section class="fin-panel"><div class="fin-panel-title"><div><h3>ظرفیت قابل فروش دستورهای تهیه</h3><p>کمینهٔ موجودی قابل مصرف هر ماده ÷ مصرف هر پرس؛ رزرو، قرنطینه و افت پخت لحاظ می‌شود.</p></div><span>${fa(capacities.filter((row) => row.status === 'available').length)} دستور قابل محاسبه</span></div>
        ${table('recipe-capacity', [
          { label: 'دستور تهیه', render: (row) => `<strong>${esc(row.name)}</strong>` },
          { label: 'نسخه', render: (row) => esc(row.version || 'ثبت نشده') },
          { label: 'ظرفیت فعلی', render: (row) => row.capacity == null ? 'داده کافی نیست' : `<strong>${fa(row.capacity)} پرس</strong>` },
          { label: 'ماده محدودکننده', render: (row) => esc(row.limitingIngredient?.name || 'قابل تعیین نیست') },
          { label: 'کیفیت', render: (row) => statusBadge(row.status, row.status === 'available' ? 'success' : 'warning') },
        ], capacities, 'دستور تهیهٔ معتبر و قابل اتصال به موجودی ثبت نشده است.')}
      </section>
      <section class="fin-panel"><div class="fin-panel-title"><div><h3>پیش‌بینی اتمام موجودی</h3><p>الگوی مصرف روز هفته از فروش پرداخت‌شده + دستور تهیهٔ مؤثر + سفارش خرید تأییدشدهٔ آینده؛ سفارش سررسیدگذشته دریافت‌شده فرض نمی‌شود.</p></div>${statusBadge(stockout.status, stockout.status === 'available' ? 'success' : stockout.status === 'partial_coverage' ? 'warning' : 'neutral')}</div>
        ${stockout.status === 'insufficient_data' ? empty(`تاریخچهٔ معتبر ${fa(stockout.historyDays || 0)} روز است؛ حداقل ${fa(stockout.minimumHistoryDays || 14)} روز و پوشش دستورهای تهیه لازم است.`) : table('stockout', [
          { label: 'ماده', render: (row) => `<strong>${esc(row.name)}</strong>` },
          { label: 'موجودی قابل مصرف', render: (row) => `${fa(Math.round(row.availableQuantity * 100) / 100)} ${esc(row.unit)}` },
          { label: 'میانگین روزانه', render: (row) => `${fa(Math.round(row.averageDailyUsage * 100) / 100)} ${esc(row.unit)}` },
          { label: 'سفارش خرید ورودی معتبر', render: (row) => row.projectedInboundQuantity ? `<strong>${fa(Math.round(row.projectedInboundQuantity * 100) / 100)} ${esc(row.unit)}</strong><small>${fa(row.inboundSchedule?.length || 0)} سفارش تأییدشده</small>` : 'ندارد' },
          { label: 'روز باقی‌مانده', render: (row) => row.daysRemaining == null ? `بیش از ${fa(row.forecastHorizonDays || 365)} روز` : `<strong>${fa(row.daysRemaining)}</strong>` },
          { label: 'تاریخ احتمالی اتمام', render: (row) => !row.forecastDate ? 'در افق پیش‌بینی رخ نمی‌دهد' : window.ShamsiCore ? window.ShamsiCore.formatShamsiDate(row.forecastDate) : esc(row.forecastDate) },
          { label: 'اقدام سفارش', render: (row) => row.actionStatus === 'monitor' ? statusBadge(row.confidence === 'high' ? 'فعلاً کافی' : 'پایش؛ اطمینان ناکافی', row.confidence === 'high' ? 'success' : 'warning') : row.actionStatus === 'lead_time_missing' ? statusBadge('زمان تأمین ثبت نشده', 'warning') : `${statusBadge(row.actionStatus === 'order_now' ? 'سفارش امروز' : 'زمان‌بندی‌شده', row.actionStatus === 'order_now' ? 'danger' : row.confidence === 'high' ? 'success' : 'warning')}<small>${row.reorderByDate ? ` تا ${window.ShamsiCore ? window.ShamsiCore.formatShamsiDate(row.reorderByDate) : esc(row.reorderByDate)} · ${fa(row.suggestedOrderQuantity)} ${esc(row.unit)}` : ''}</small>` },
          { label: 'اطمینان', render: (row) => `${statusBadge(row.confidence === 'high' ? 'بالا' : row.confidence === 'medium' ? 'متوسط' : 'پایین', row.confidence === 'high' ? 'success' : row.confidence === 'medium' ? 'warning' : 'neutral')}<small>${row.backtestWapePercent == null ? 'تاریخچه کافی برای آزمون دقت نیست' : `خطای آزمون دقت: ${fa(row.backtestWapePercent)}٪`}</small>` },
          { label: 'اولویت', render: (row) => statusBadge(row.urgency, row.urgency === 'critical' ? 'danger' : row.urgency === 'warning' ? 'warning' : 'success') },
        ], stockoutActions, 'ماده‌ای با مصرف روزانهٔ قابل اتکا یافت نشد.')}
        ${stockout.recipeCoveragePercent == null ? '' : `<div class="fin-note"><strong>پوشش دستور تهیهٔ سفارش‌ها</strong><span>${fa(stockout.recipeCoveragePercent)}٪ خطوط فروش</span></div>`}
        ${(stockout.coverageIssues || []).length ? `<div class="fin-note warning"><strong>خطوط خارج از پوشش</strong><span>${fa(stockout.coverageIssues.length)} خط فروش به‌علت دستور تهیه، ماده یا تبدیل واحد ناقص وارد پیش‌بینی نشده است.</span></div>` : ''}
        ${(stockout.inboundIssues || []).length ? `<div class="fin-note warning"><strong>سفارش خرید خارج از پیش‌بینی</strong><span>${fa(stockout.inboundIssues.length)} ردیف سفارش خرید تاریخ تحویل معتبر آینده ندارد یا سررسیدش گذشته است؛ دریافت‌شده فرض نشد.</span></div>` : ''}
      </section>
      <section class="fin-panel"><div class="fin-panel-title"><div><h3>نقطهٔ سربه‌سر برنامه‌ای از تعهدها</h3><p>تعهد فعال اجاره و حقوق + حاشیه مشارکت اسناد قطعی؛ با عملکرد واقعی مخلوط نمی‌شود.</p></div>${statusBadge(plannedBreakEven.status, plannedBreakEven.status === 'available' ? 'success' : 'neutral')}</div>
        ${plannedBreakEven.breakEvenSalesIrr == null ? empty(`برای برنامه، تعهد ثابت و فروش/هزینه متغیر قطعی لازم است: ${(plannedBreakEven.missing || []).map(label).join('، ') || 'داده کافی نیست'}.`) : `<div class="fin-result-grid">
          ${metric('تعهد ثابت بازه', money(plannedBreakEven.committedFixedCostIrr), `${fa(plannedBreakEven.commitmentCount)} تعهد فعال · سرشکن روزهای تقویمی`)}
          ${metric('حاشیه مشارکت مبنا', `${fa(Math.round(plannedBreakEven.contributionMarginRatio * 10000) / 100)}٪`, 'فقط فروش و هزینه متغیر قطعی')}
          ${metric('فروش سربه‌سر برنامه', money(plannedBreakEven.breakEvenSalesIrr), 'منبع: تعهدهای فعال + دفتر کل')}
          ${metric('فاصله برنامه', money(plannedBreakEven.gapIrr), plannedBreakEven.gapIrr ? 'فروش بیشتر لازم است' : 'پوشش داده شده', plannedBreakEven.gapIrr ? 'danger' : 'success')}
        </div>`}
      </section>
      <section class="fin-panel"><div class="fin-panel-title"><div><h3>نقطهٔ سربه‌سر واقعی از دفتر</h3><p>فقط سندهای قطعی طبقه‌بندی‌شده؛ تعهد ثبت‌نشده وارد عملکرد واقعی نمی‌شود.</p></div>${statusBadge(actualBreakEven.status, actualBreakEven.status === 'available' ? 'success' : actualBreakEven.status === 'partial_coverage' ? 'warning' : 'neutral')}</div>
        ${actualBreakEven.breakEvenSalesIrr == null ? empty(`دادهٔ قطعی لازم کامل نیست: ${(actualBreakEven.missing || []).map(label).join('، ') || 'فروش، هزینه متغیر یا هزینه ثابت'}.`) : `<div class="fin-result-grid">
          ${metric('فروش خالص قطعی', money(actualBreakEven.netSalesIrr), 'منبع: خطوط قطعی دفتر')}
          ${metric('هزینه ثابت قطعی', money(actualBreakEven.fixedCostIrr), 'حقوق + اجاره')}
          ${metric('هزینه متغیر قطعی', money(actualBreakEven.variableCostIrr), 'مواد اولیه و بهای تمام‌شده')}
          ${metric('فروش سربه‌سر', money(actualBreakEven.breakEvenSalesIrr), `پوشش طبقه‌بندی هزینه ${fa(actualBreakEven.coveragePercent)}٪`, actualBreakEven.status === 'available' ? 'success' : 'warning')}
          ${metric('فاصله تا سربه‌سر', money(actualBreakEven.gapIrr), actualBreakEven.gapIrr ? 'نیازمند فروش بیشتر' : 'پوشش داده شده', actualBreakEven.gapIrr ? 'danger' : 'success')}
        </div>`}
        ${(actualBreakEven.unclassified || []).length ? `<div class="fin-note warning"><strong>این نتیجه رسمی نیست</strong><span>${fa(actualBreakEven.unclassified.length)} ردیف هزینه هنوز ثابت یا متغیر طبقه‌بندی نشده است؛ وضعیت تا تکمیل طبقه‌بندی «پوشش ناقص» می‌ماند.</span></div>` : ''}
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
    const openingOptionMarkup = (selectedCode) => openingBalanceAccounts.map((account) => `<option value="${esc(account.code)}" ${account.code === selectedCode ? 'selected' : ''}>${esc(account.code)} · ${esc(businessText(account.name))}</option>`).join('');
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
    const snapshot = data.snapshot || {};
    const operational = snapshot.operational || {};
    const reconciliation = snapshot.reconciliation || {};
    const reportingState = data.reportingState || {};
    const hasFinancialActivity = reportingState.hasActivity != null
      ? reportingState.hasActivity === true
      : Number(operational.paidOrders || 0) > 0 || Number(data.entries?.length || 0) > 0;
    const hasSalesActivity = Number(operational.paidOrders || 0) > 0 || Number(pnl.controls?.expectedSaleEvents || 0) > 0;
    const reportCard = (title, value, detail, status, tone = '') => `<article class="fin-report-card ${tone}" data-report-status="${esc(status)}"><div class="fin-report-card__head"><span>${esc(title)}</span>${statusBadge(status, tone || undefined)}</div><strong>${value}</strong><small>${esc(detail)}</small></article>`;
    const salesReport = !hasSalesActivity
      ? { value: 'بدون فعالیت', detail: STATUS_COPY.empty, status: 'empty_period', tone: 'neutral' }
      : Number(reconciliation.salesDifferenceIrr || 0) === 0
        ? { value: money(operational.salesIrr), detail: 'فروش عملیاتی با دفتر مالی تطبیق دارد', status: 'available', tone: 'success' }
        : { value: money(Math.abs(Number(reconciliation.salesDifferenceIrr || 0))), detail: 'اختلاف فروش و دفتر؛ بررسی لازم است', status: 'partial', tone: 'warning' };
    const expenseIrr = pnl.status === 'available' ? Number(pnl.cogsIrr || 0) + Number(pnl.operatingExpenseIrr || 0) : null;
    const expenseReport = !hasFinancialActivity
      ? { value: 'بدون فعالیت', detail: STATUS_COPY.empty, status: 'empty_period', tone: 'neutral' }
      : expenseIrr == null
        ? { value: STATUS_COPY.insufficientData, detail: 'بهای تمام‌شده یا هزینهٔ قطعی کامل نیست', status: 'insufficient', tone: 'warning' }
        : { value: money(expenseIrr), detail: 'بهای تمام‌شده و هزینه‌های عملیاتی قطعی', status: 'available', tone: 'success' };
    const profitReport = !hasFinancialActivity
      ? { value: 'بدون فعالیت', detail: STATUS_COPY.empty, status: 'empty_period', tone: 'neutral' }
      : pnl.status === 'available'
        ? { value: money(pnl.netProfitIrr), detail: pnl.netProfitIrr < 0 ? 'زیان قطعی از دفتر مالی' : 'سود قطعی از دفتر مالی', status: pnl.netProfitIrr < 0 ? 'negative' : 'positive', tone: pnl.netProfitIrr < 0 ? 'danger' : 'success' }
        : { value: STATUS_COPY.insufficientData, detail: 'تا تکمیل فروش، بهای تمام‌شده و هزینه‌ها رقم رسمی ساخته نمی‌شود', status: 'incomplete', tone: 'warning' };
    const passedChecks = checks.filter((item) => item.passed).length;
    const closeReport = checks.length && passedChecks === checks.length
      ? { value: `${fa(passedChecks)} از ${fa(checks.length)}`, detail: 'همهٔ کنترل‌ها عبور کرده‌اند؛ دوره آمادهٔ بستن است', status: 'ready', tone: 'success' }
      : checks.length
        ? { value: `${fa(passedChecks)} از ${fa(checks.length)}`, detail: `${fa(checks.length - passedChecks)} کنترل نیازمند اقدام است`, status: 'check_failed', tone: 'danger' }
        : { value: STATUS_COPY.insufficientData, detail: 'چک‌لیست بستن دوره از دفتر مالی دریافت نشد', status: 'insufficient', tone: 'warning' };
    const periodId = data.selectedPeriod?.id || '';
    const finalCloseAllowed = can('finance.period.close') && ['owner', 'manager'].includes(currentRole())
      && data.periodSource === 'finance_v2' && Boolean(periodId)
      && ['open', 'reopened', 'soft_closed'].includes(data.selectedPeriod?.status)
      && checks.length > 0 && checks.every((item) => item.passed);
    const preliminaryCloseAllowed = can('finance.period.close') && data.periodSource === 'finance_v2'
      && Boolean(periodId) && ['open', 'reopened'].includes(data.selectedPeriod?.status);
    const checklistActions = {
      'balanced-ledger': ['مشاهدهٔ گزارش‌ها', 'ledger_close'],
      'sales-reconciled': ['بررسی فروش و بانک', 'sales_bank'],
      'events-clear': ['بازکردن کارتابل', 'workbench'],
      'period-open': ['مشاهدهٔ دورهٔ مالی', 'workbench'],
      'duplicates-clear': ['بازکردن کارتابل', 'workbench'],
      'approvals-clear': ['مشاهدهٔ تأییدها', 'workbench'],
      'reports-reliable': ['بررسی مواد و بهای تمام‌شده', 'costing'],
    };
    const checklistAction = (id, passed) => {
      if (passed || !checklistActions[id]) return '';
      const [text, workspace] = checklistActions[id];
      return `<button class="fin-btn secondary fin-check-action" type="button" data-fin-goto="${workspace}">${text}</button>`;
    };

    // Financial ratios & 4-column trial balance calculations
    const totalAssets = Number(balance.assetsIrr || 0);
    const totalLiabilities = Number(balance.liabilitiesIrr || 0);
    const revenue = Number(pnl.revenueIrr || 0);
    const cogs = Number(pnl.cogsIrr || 0);
    const netProfit = Number(pnl.netProfitIrr || 0);
    const grossProfit = revenue - cogs;

    const currentAssetsIrr = (trial.rows || [])
      .filter((r) => /^(11|12|13|14|15|16)/.test(r.accountCode))
      .reduce((sum, r) => sum + Math.max(0, Number(r.balanceIrr || 0)), 0);

    const currentLiabilitiesIrr = (trial.rows || [])
      .filter((r) => /^(21|22|23|24|26)/.test(r.accountCode))
      .reduce((sum, r) => sum + Math.max(0, -Number(r.balanceIrr || 0)), 0);

    const quickAssetsIrr = (trial.rows || [])
      .filter((r) => /^(11|12|13)/.test(r.accountCode))
      .reduce((sum, r) => sum + Math.max(0, Number(r.balanceIrr || 0)), 0);

    const currentRatio = currentLiabilitiesIrr > 0 ? (currentAssetsIrr / currentLiabilitiesIrr).toFixed(2) : null;
    const quickRatio = currentLiabilitiesIrr > 0 ? (quickAssetsIrr / currentLiabilitiesIrr).toFixed(2) : null;
    const grossMarginPct = revenue > 0 ? Math.round((grossProfit / revenue) * 1000) / 10 : null;
    const netMarginPct = revenue > 0 ? Math.round((netProfit / revenue) * 1000) / 10 : null;
    const debtRatioPct = totalAssets > 0 ? Math.round((totalLiabilities / totalAssets) * 1000) / 10 : null;

    const totalDebitTurnover = (trial.rows || []).reduce((sum, r) => sum + Number(r.debitIrr || 0), 0);
    const totalCreditTurnover = (trial.rows || []).reduce((sum, r) => sum + Number(r.creditIrr || 0), 0);
    const totalDebitBalance = (trial.rows || []).reduce((sum, r) => sum + (r.balanceIrr > 0 ? Number(r.balanceIrr) : 0), 0);
    const totalCreditBalance = (trial.rows || []).reduce((sum, r) => sum + (r.balanceIrr < 0 ? Math.abs(Number(r.balanceIrr)) : 0), 0);
    const turnoverBalanced = totalDebitTurnover === totalCreditTurnover;
    const balanceBalanced = totalDebitBalance === totalCreditBalance;

    return `
      <section class="fin-section-head"><div><h2>گزارش‌ها و بستن دوره</h2><p>چهار نتیجهٔ اصلی را سریع ببینید؛ گزارش‌ها از اسناد قطعی ساخته می‌شوند و جزئیات حرفه‌ای فقط هنگام نیاز باز می‌شود.</p></div><button class="fin-btn secondary" type="button" data-fin-export="ledger" title="خروجی فقط از صفحهٔ جاری">دریافت CSV صفحهٔ جاری</button></section>
      <section class="fin-report-summary" aria-label="خلاصهٔ گزارش‌های مالی">
        ${reportCard('فروش و تطبیق', salesReport.value, salesReport.detail, salesReport.status, salesReport.tone)}
        ${reportCard('هزینه‌ها', expenseReport.value, expenseReport.detail, expenseReport.status, expenseReport.tone)}
        ${reportCard('سود و زیان', profitReport.value, profitReport.detail, profitReport.status, profitReport.tone)}
        ${reportCard('وضعیت بستن دوره', closeReport.value, closeReport.detail, closeReport.status, closeReport.tone)}
      </section>
      ${can('finance.settings.manage') ? `<details class="fin-advanced fin-tax-setup" data-fin-tax-setup>
        <summary><span><strong>تنظیم مالیات سفارش‌های این شعبه</strong><small>قیمت منو شامل مالیات است · فقط برای شعبهٔ انتخاب‌شده</small></span><em>تنظیمات حساس</em></summary>
        <div class="fin-tax-setup__body"><div class="fin-note" data-fin-tax-status role="status" aria-live="polite">در حال آماده‌سازی…</div><div data-fin-tax-content hidden></div></div>
      </details>` : ''}
      <section class="fin-panel fin-close-summary" aria-labelledby="fin-close-summary-title"><div class="fin-panel-title"><div><h3 id="fin-close-summary-title">کنترل‌های بستن دوره</h3><p>هر مورد ناموفق یک علت ساده و مسیر مستقیم برای اصلاح دارد.</p></div><span>${fa(passedChecks)} از ${fa(checks.length)} کنترل</span></div>
        <div class="fin-check-list fin-check-list--summary">${checks.map((item) => `<article class="${item.passed ? 'passed' : 'failed'}"><span>${item.passed ? '✓' : '!'}</span><div><strong>${esc(item.label)}</strong>${item.passed ? '<small>کنترل عبور کرده است</small>' : '<small>برای ادامه، اقدام پیشنهادی را انجام دهید.</small>'}</div>${checklistAction(item.id, item.passed)}${statusBadge(item.passed ? 'passed' : 'failed')}</article>`).join('')}</div>
        <div class="fin-inline-action fin-close-actions">
          ${preliminaryCloseAllowed ? `<button type="button" class="fin-btn secondary" data-fin-close-period="${esc(periodId)}" data-fin-close-mode="preliminary">بستن مقدماتی دوره</button>` : ''}
          ${finalCloseAllowed ? `<button type="button" class="fin-btn primary" data-fin-close-period="${esc(periodId)}" data-fin-close-mode="final">بستن نهایی دوره</button>` : ''}
          ${!preliminaryCloseAllowed && !finalCloseAllowed ? `<span class="fin-note warning">${data.selectedPeriod?.status === 'soft_closed' ? 'برای بستن نهایی، نقش مالک/مدیر و عبور همهٔ کنترل‌ها لازم است.' : 'اقدام بستن در وضعیت فعلی یا با دادهٔ ناقص در دسترس نیست.'}</span>` : ''}
        </div>
      </section>
      <details class="fin-advanced fin-specialist-area" id="fin-ledger-specialist"><summary><span><strong>جزئیات حرفه‌ای حسابدار و مدیر</strong><small>افتتاحیه، دارایی، حقوق، گزارش‌های تفصیلی و دفتر مالی در این بخش است.</small></span><em>فقط هنگام نیاز</em></summary>
      <div class="fin-metrics">
        ${metric('اسناد دفتر جدید', fa(data.pagination?.total ?? data.entries?.length ?? 0), 'پیش‌نویس، منتظر و قطعی')}
        ${metric('جمع بدهکار قطعی', money(snapshot.ledger?.debitIrr), 'منبع: اسناد دفتر مالی جدید')}
        ${metric('جمع بستانکار قطعی', money(snapshot.ledger?.creditIrr), 'منبع: اسناد دفتر مالی جدید')}
        ${metric('اختلاف فروش و دفتر', money(reconciliation.salesDifferenceIrr), 'مانع بستن دوره', reconciliation.salesDifferenceIrr ? 'danger' : 'success')}
      </div>
      <section class="fin-panel fin-operations"><div class="fin-panel-title"><div><h3>مانده‌های شروع دوره</h3><p>موجودی بانک، صندوق، کالا و بدهی را یک‌بار وارد کنید؛ قبل از ثبت نهایی، توازن کنترل می‌شود.</p></div><span>برای شروع دوره</span></div>
        <div class="fin-metrics">
          ${metric('دوره‌های افتتاحیه', fa(openingBalanceBatches.length), activeOpeningBalance ? `وضعیت فعال: ${label(activeOpeningBalance.status)}` : 'دسته فعال وجود ندارد')}
          ${metric('حساب مجاز', fa(openingBalanceAccounts.length), 'فقط حساب تفصیلی ترازنامه')}
          ${metric('قاعده توازن', 'صفر', 'اختلاف بدهکار و بستانکار باید صفر باشد')}
          ${metric('روش اصلاح', 'سند معکوس', 'ویرایش یا حذف سند قطعی ممنوع است')}
        </div>
        <details class="fin-advanced"><summary>ثبت مانده‌های شروع دوره</summary>
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
            ? `<div class="fin-note warning"><strong>ثبت جدید متوقف است</strong><span>دسته ${esc(activeOpeningBalance.id)} در وضعیت ${esc(label(activeOpeningBalance.status))} است. برای اصلاح ثبت قطعی فقط سند معکوس بزنید.</span></div>`
            : data.periodSource !== 'finance_v2'
              ? `<div class="fin-note warning"><strong>ابتدا دوره مالی جدید بسازید</strong><span>مانده افتتاحیه به دورهٔ قدیمی یا فرضی ثبت قطعی نمی‌شود.</span></div>`
              : empty('پیش‌نمایش هیچ داده‌ای ذخیره نمی‌کند و هیچ رقم جبرانی حدس نمی‌زند.')}</div>
        </details>
        <div class="fin-operation-list"><div class="fin-subhead"><strong>تاریخچه مانده افتتاحیه</strong><span>${fa(openingBalanceBatches.length)} مورد</span></div>
          ${openingBalanceBatches.length ? openingBalanceBatches.map((batch) => `<article><div><strong>${dateOnly(batch.asOfDate)} · ${esc(batch.sourceReference)}</strong><small>سند ${esc(batch.journalEntry?.number || 'در انتظار')} · ${fa(batch.lines?.length || 0)} ردیف</small></div><div>${statusBadge(batch.status, batch.status === 'posted' ? 'success' : batch.status === 'rejected' ? 'danger' : batch.status === 'reversed' ? 'neutral' : 'warning')}<b>${money(batch.debitIrr)}</b>${batch.status === 'posted' ? `<button class="fin-btn secondary" type="button" data-fin-reverse-opening="${esc(batch.journalEntryId)}">سند معکوس</button>` : ''}</div></article>`).join('') : empty('هنوز مانده افتتاحیه‌ای ثبت نشده است.')}
        </div>
      </section>
      <section class="fin-panel fin-operations"><div class="fin-panel-title"><div><h3>دارایی‌ها و استهلاک</h3><p>خرید دارایی و استهلاک ماهانه را ثبت و برای تأیید ارسال کنید.</p></div><span>کارهای تکمیلی</span></div>
        <div class="fin-metrics">
          ${metric('دارایی فعال', fa(activeAssets.length), `${fa(fixedAssets.filter((asset) => asset.status === 'pending_approval').length)} منتظر تأیید`)}
          ${metric('ارزش دفتری', money(assetBookValueIrr), 'بهای خرید منهای استهلاک انباشته')}
          ${metric('استهلاک پیشنهادی ماه', money(depreciationPreview.totalDepreciationIrr), depreciationPreview.status === 'available' ? `${fa(depreciationPreview.lines.length)} دارایی` : 'داده یا دارایی واجد شرایط نیست')}
          ${metric('دارایی قدیمی قرنطینه', fa(data.legacyAssets?.count || 0), 'وارد ثبت رسمی جدید نشده', data.legacyAssets?.count ? 'warning' : '')}
        </div>
        <div class="fin-procurement-stack">
          <details class="fin-advanced"><summary>۱. ثبت خرید دارایی</summary>
            <form id="fin-fixed-asset-form" class="fin-form fin-form-wide" autocomplete="off">
              <label class="fin-field"><span>کد دارایی</span><input name="assetCode" required pattern="[A-Za-z0-9_-]{3,40}" maxlength="40" placeholder="AST-ESP-01" dir="ltr"></label>
              <label class="fin-field span-2"><span>نام دارایی</span><input name="name" required minlength="2" maxlength="160" placeholder="مثلاً دستگاه اسپرسوساز"></label>
              <label class="fin-field"><span>گروه</span><select name="category" required>${assetPolicies.categories.map((row) => `<option value="${esc(row.id)}">${esc(businessText(row.label))} · ${esc(row.accountCode)}</option>`).join('')}</select></label>
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
          <div class="fin-operation-list"><div class="fin-subhead"><strong>دفتر دارایی</strong><span>${fa(fixedAssets.length)} مورد</span></div>
            ${fixedAssets.length ? fixedAssets.map((asset) => `<article><div><strong>${esc(asset.assetCode)} · ${esc(asset.name)}</strong><small>خرید ${dateOnly(asset.purchaseDate)} · بهای ${money(asset.purchaseCostIrr)}</small></div><div>${statusBadge(asset.status, asset.status === 'active' ? 'success' : asset.status === 'rejected' ? 'danger' : 'warning')}<b>${money(Math.max(0, Number(asset.purchaseCostIrr) - Number(asset.accumulatedDepreciationIrr || 0)))}</b></div></article>`).join('') : empty('دارایی جدیدی ثبت نشده است.')}
          </div>
          <div class="fin-operation-list"><div class="fin-subhead"><strong>ثبت‌های استهلاک</strong><span>${fa(depreciationRuns.length)} مورد</span></div>
            ${depreciationRuns.length ? depreciationRuns.map((run) => `<article><div><strong>ماه ${dateOnly(`${run.serviceMonth}-01`)}</strong><small>${fa(run.lines?.length || 0)} دارایی · سند ${esc(run.journalEntry?.number || 'در انتظار')}</small></div><div>${statusBadge(run.status, run.status === 'posted' ? 'success' : run.status === 'rejected' ? 'danger' : 'warning')}<b>${money(run.totalDepreciationIrr)}</b></div></article>`).join('') : empty('استهلاکی در سامانه جدید ثبت نشده است.')}
          </div>
        </div>
      </section>
      <section class="fin-panel fin-operations"><div class="fin-panel-title"><div><h3>حقوق و پرداخت‌های پرسنل</h3><p>لیست حقوق، کسورات و پرداخت‌های تأییدشده را در این بخش پیگیری کنید.</p></div><span>کارهای تکمیلی</span></div>
        <div class="fin-metrics">
          ${metric('لیست حقوق ثبت‌شده', fa(payrollRuns.length), `${fa(payrollRuns.filter((run) => run.status === 'pending_approval').length)} منتظر تأیید`)}
          ${metric('بدهی ایجادشده', money(payrollLiabilityIrr), 'از لیست‌های رد یا معکوس‌نشده')}
          ${metric('پرداخت قطعی', money(payrollPaidIrr), `${fa(payrollPayments.filter((payment) => payment.status === 'pending_approval').length)} درخواست منتظر تأیید`)}
          ${metric('حقوق قدیمی قرنطینه', fa(data.legacyPayroll?.count || 0), 'در نرخ یا سند جدید استفاده نشده', data.legacyPayroll?.count ? 'warning' : '')}
        </div>
        <div class="fin-note warning"><strong>نرخ قانونی خودکار نیست</strong><span>برای جلوگیری از ثبت با نرخ منقضی یا حدسی، بیمه و مالیات از فایل/محاسبهٔ تأییدشدهٔ حسابدار وارد می‌شوند. موتور فقط معادله و سند دوبل را کنترل می‌کند.</span></div>
        <div class="fin-procurement-stack">
          <details class="fin-advanced"><summary>۱. ثبت لیست حقوق</summary>
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
          <div class="fin-operation-list"><div class="fin-subhead"><strong>لیست‌های حقوق</strong><span>${fa(payrollRuns.length)} مورد</span></div>
            ${payrollRuns.length ? payrollRuns.map((run) => `<article><div><strong>ماه ${dateOnly(`${run.serviceMonth}-01`)} · ${fa(run.headcount)} نفر</strong><small>مرجع ${esc(run.sourceReference)} · سند ${esc(run.journalEntry?.number || 'در انتظار')}</small></div><div>${statusBadge(run.status, ['posted', 'paid'].includes(run.status) ? 'success' : run.status === 'rejected' ? 'danger' : 'warning')}<b>${money(run.totalExpenseIrr)}</b></div></article>`).join('') : empty('لیست حقوقی در سامانه جدید ثبت نشده است.')}
          </div>
          <div class="fin-operation-list"><div class="fin-subhead"><strong>پرداخت‌های حقوق و کسورات</strong><span>${fa(payrollPayments.length)} مورد</span></div>
            ${payrollPayments.length ? payrollPayments.map((payment) => `<article><div><strong>${esc(label(payment.liabilityType))}</strong><small>${dateOnly(payment.paymentDate)} · ${esc(label(payment.paymentMethod))} · ${esc(payment.reference || 'بدون مرجع')}</small></div><div>${statusBadge(payment.status, payment.status === 'paid' ? 'success' : payment.status === 'rejected' ? 'danger' : 'warning')}<b>${money(payment.amountIrr)}</b></div></article>`).join('') : empty('پرداخت حقوقی در سامانه جدید ثبت نشده است.')}
          </div>
        </div>
      </section>
      <div class="fin-grid-2">
        <section class="fin-panel"><div class="fin-panel-title"><div><h3>سود و زیان</h3><p>فقط خطوط قطعی حساب‌های ۴، ۵ و ۶</p></div>${statusBadge(pnl.status, pnl.status === 'available' ? 'success' : pnl.status === 'partial_coverage' ? 'warning' : 'neutral')}</div>${pnl.status === 'partial_coverage' ? `<div class="fin-note warning" role="alert"><strong>این سود برای تصمیم‌گیری یا انتشار معتبر نیست</strong><span>اختلاف فروش و دفتر: ${money(Math.abs(pnl.controls?.salesDifferenceIrr || 0))} · بهای تمام‌شده مسدود: ${fa(pnl.controls?.blockedCogsEvents || 0)} · بهای تمام‌شده مفقود: ${fa(pnl.controls?.missingCogsEvents || 0)}</span></div>` : ''}<div class="fin-result-grid">${metric('درآمد خالص', money(pnl.revenueIrr), 'گروه حساب ۴')}${metric('بهای تمام‌شده', money(pnl.cogsIrr), 'گروه حساب ۵')}${metric('هزینه عملیاتی', money(pnl.operatingExpenseIrr), 'گروه حساب ۶')}${metric('سود/زیان دوره', money(pnl.netProfitIrr), pnl.status === 'available' ? 'رقم قابل اتکا از دفتر قطعی' : 'رقم موقت؛ پوشش کامل نیست', pnl.status !== 'available' ? 'warning' : pnl.netProfitIrr < 0 ? 'danger' : 'success')}</div></section>
        <section class="fin-panel"><div class="fin-panel-title"><div><h3>ترازنامه</h3><p>دارایی = بدهی + حقوق مالکانه + نتیجه دوره</p></div>${statusBadge(balance.status, balance.status === 'balanced' ? 'success' : balance.status === 'unbalanced' ? 'danger' : balance.status === 'partial_coverage' ? 'warning' : 'neutral')}</div>${balance.status === 'partial_coverage' ? `<div class="fin-note warning" role="alert"><strong>معادله تراز است، اما ماهیت مانده سالم نیست</strong><span>${fa(balance.abnormalBalanceRows?.length || 0)} حساب دارای مانده خلاف ماهیت است: ${(balance.abnormalBalanceRows || []).slice(0, 3).map((row) => `${esc(row.accountCode)} ${esc(businessText(row.accountName || ''))}`).join('، ')}</span></div>` : ''}<div class="fin-result-grid">${metric('دارایی', money(balance.assetsIrr), 'گروه حساب ۱')}${metric('بدهی', money(balance.liabilitiesIrr), 'گروه حساب ۲', balance.liabilitiesIrr < 0 ? 'warning' : '')}${metric('حقوق مالکانه', money(balance.equityIrr), 'شامل نتیجه دوره')}${metric('اختلاف معادله', money(Math.abs(balance.equationDifferenceIrr)), 'باید صفر باشد', balance.equationDifferenceIrr ? 'danger' : 'success')}</div></section>
      </div>
      <section class="fin-panel fin-ratios-panel" aria-label="نسبت‌های سلامت مالی">
        <div class="fin-panel-title">
          <div>
            <h3>شاخص‌های تحلیلی و نسبت‌های سلامت مالی</h3>
            <p>سنجش توان نقدینگی، سودآوری و ساختار سرمایه بر مبنای اسناد قطعی دوره</p>
          </div>
          <span class="fin-badge neutral">استاندارد رستوران و کافه</span>
        </div>
        <div class="fin-ratio-grid">
          <article class="fin-ratio-card ${currentRatio == null ? '' : Number(currentRatio) >= 1.2 ? 'success' : Number(currentRatio) >= 1.0 ? 'warning' : 'danger'}">
            <div class="fin-ratio-head">
              <span>نسبت جاری (Current Ratio)</span>
              <small title="دارایی جاری تقسیم بر بدهی جاری">توان تسویه بدهی کوتاه‌مدت</small>
            </div>
            <strong class="fin-ratio-value">${currentRatio != null ? fa(currentRatio) : '—'}</strong>
            <div class="fin-ratio-meta">
              <span class="benchmark">هدف: &gt; ۱.۲</span>
              <span class="fin-badge ${currentRatio == null ? 'neutral' : Number(currentRatio) >= 1.2 ? 'success' : 'warning'}">${currentRatio == null ? 'بدون داده' : Number(currentRatio) >= 1.2 ? 'نقدینگی قوی' : 'نیازمند پایش'}</span>
            </div>
          </article>
          <article class="fin-ratio-card ${quickRatio == null ? '' : Number(quickRatio) >= 0.8 ? 'success' : 'warning'}">
            <div class="fin-ratio-head">
              <span>نسبت آنی (Quick Ratio)</span>
              <small title="نقدینگی و مطالبات تقسیم بر بدهی جاری">تسویه فوری بدون فروش انبار</small>
            </div>
            <strong class="fin-ratio-value">${quickRatio != null ? fa(quickRatio) : '—'}</strong>
            <div class="fin-ratio-meta">
              <span class="benchmark">هدف: &gt; ۰.۸</span>
              <span class="fin-badge ${quickRatio == null ? 'neutral' : Number(quickRatio) >= 0.8 ? 'success' : 'warning'}">${quickRatio == null ? 'بدون داده' : Number(quickRatio) >= 0.8 ? 'نقدینگی آنی بالا' : 'ریسک سررسید'}</span>
            </div>
          </article>
          <article class="fin-ratio-card ${grossMarginPct == null ? '' : grossMarginPct >= 60 ? 'success' : grossMarginPct >= 45 ? 'warning' : 'danger'}">
            <div class="fin-ratio-head">
              <span>حاشیه سود ناخالص</span>
              <small title="(درآمد منهای بهای تمام‌شده) تقسیم بر درآمد">(فروش - مواد) ÷ فروش</small>
            </div>
            <strong class="fin-ratio-value">${grossMarginPct != null ? `${fa(grossMarginPct)}٪` : '—'}</strong>
            <div class="fin-ratio-meta">
              <span class="benchmark">هدف: ۶۰٪ تا ۷۰٪</span>
              <span class="fin-badge ${grossMarginPct == null ? 'neutral' : grossMarginPct >= 60 ? 'success' : 'warning'}">${grossMarginPct == null ? 'بدون داده' : grossMarginPct >= 60 ? 'حاشیه عالی' : 'بهای مواد بالا'}</span>
            </div>
          </article>
          <article class="fin-ratio-card ${netMarginPct == null ? '' : netMarginPct >= 15 ? 'success' : netMarginPct >= 0 ? 'warning' : 'danger'}">
            <div class="fin-ratio-head">
              <span>حاشیه سود خالص</span>
              <small title="سود خالص تقسیم بر درآمد">سود نهایی پس از تمام هزینه‌ها</small>
            </div>
            <strong class="fin-ratio-value">${netMarginPct != null ? `${fa(netMarginPct)}٪` : '—'}</strong>
            <div class="fin-ratio-meta">
              <span class="benchmark">هدف: ۱۵٪ تا ۲۵٪</span>
              <span class="fin-badge ${netMarginPct == null ? 'neutral' : netMarginPct >= 15 ? 'success' : netMarginPct >= 0 ? 'warning' : 'danger'}">${netMarginPct == null ? 'بدون داده' : netMarginPct >= 15 ? 'سودآور' : netMarginPct >= 0 ? 'سود محدود' : 'زیان‌ده'}</span>
            </div>
          </article>
          <article class="fin-ratio-card ${debtRatioPct == null ? '' : debtRatioPct <= 50 ? 'success' : debtRatioPct <= 75 ? 'warning' : 'danger'}">
            <div class="fin-ratio-head">
              <span>نسبت بدهی (Debt Ratio)</span>
              <small title="مجموع بدهی تقسیم بر مجموع دارایی">اهرم مالی و ریسک بدهی</small>
            </div>
            <strong class="fin-ratio-value">${debtRatioPct != null ? `${fa(debtRatioPct)}٪` : '—'}</strong>
            <div class="fin-ratio-meta">
              <span class="benchmark">هدف: &lt; ۵۰٪</span>
              <span class="fin-badge ${debtRatioPct == null ? 'neutral' : debtRatioPct <= 50 ? 'success' : 'warning'}">${debtRatioPct == null ? 'بدون داده' : debtRatioPct <= 50 ? 'ریسک پایین' : 'اهرم بالا'}</span>
            </div>
          </article>
        </div>
      </section>
      <section class="fin-panel"><div class="fin-panel-title"><div><h3>جریان وجوه نقد مستقیم</h3><p>فقط تغییر حساب‌های صندوق، تنخواه و بانک؛ طبقه‌بندی نامطمئن پنهان نمی‌شود.</p></div>${statusBadge(cashFlow.status, cashFlow.status === 'rule_based' ? 'success' : cashFlow.status === 'partial_coverage' ? 'warning' : 'neutral')}</div><div class="fin-result-grid">${metric('عملیاتی', money(cashFlow.operatingIrr), 'قاعده حساب مقابل')}${metric('سرمایه‌گذاری', money(cashFlow.investingIrr), 'دارایی ثابت')}${metric('تأمین مالی', money(cashFlow.financingIrr), 'سرمایه/تسهیلات')}${metric('تغییر خالص وجه', money(cashFlow.netChangeIrr), cashFlow.unclassifiedIrr ? `طبقه‌بندی‌نشده: ${money(cashFlow.unclassifiedIrr)}` : 'تمام تغییرات طبقه‌بندی شد', cashFlow.unclassifiedIrr ? 'warning' : 'success')}</div></section>
      <details class="fin-advanced" id="fin-trial-balance-details"><summary>تراز آزمایشی چهارستونی (${fa(trial.rows.length)} حساب)</summary>
        <section class="fin-panel fin-trial-panel">
          <div class="fin-panel-title">
            <div>
              <h3>تراز آزمایشی</h3>
              <p>تراز آزمایشی استاندارد چهارستونی بر اساس اسناد قطعی دفتر مالی</p>
            </div>
            ${statusBadge(trial.status, trial.status === 'balanced' ? 'success' : trial.status === 'unbalanced' ? 'danger' : 'neutral')}
          </div>
          <div class="fin-trial-toolbar">
            <div class="fin-category-pills" role="tablist" aria-label="فیلتر طبقه حساب">
              <button type="button" class="fin-category-pill active" data-fin-trial-cat="all">همه (${fa(trial.rows.length)})</button>
              <button type="button" class="fin-category-pill" data-fin-trial-cat="1">۱. دارایی‌ها</button>
              <button type="button" class="fin-category-pill" data-fin-trial-cat="2">۲. بدهی‌ها</button>
              <button type="button" class="fin-category-pill" data-fin-trial-cat="3">۳. حقوق مالکانه</button>
              <button type="button" class="fin-category-pill" data-fin-trial-cat="4">۴. درآمدها</button>
              <button type="button" class="fin-category-pill" data-fin-trial-cat="5">۵. بهای تمام‌شده</button>
              <button type="button" class="fin-category-pill" data-fin-trial-cat="6">۶. هزینه‌ها</button>
            </div>
            <div class="fin-trial-search-wrap">
              <input type="search" id="fin-trial-search" class="fin-trial-search" placeholder="جستجوی کد یا نام حساب…" autocomplete="off">
            </div>
          </div>
          ${table('trial-balance', [
            { label: 'حساب', render: (row) => `<strong>${esc(row.accountCode)}</strong>${row.accountName ? `<small>${esc(businessText(row.accountName))}</small>` : ''}` },
            { label: 'گردش بدهکار', render: (row) => money(row.debitIrr) },
            { label: 'گردش بستانکار', render: (row) => money(row.creditIrr) },
            { label: 'مانده بدهکار', render: (row) => row.balanceIrr > 0 ? `<strong>${money(row.balanceIrr)}</strong>` : '—' },
            { label: 'مانده بستانکار', render: (row) => row.balanceIrr < 0 ? `<strong>${money(Math.abs(row.balanceIrr))}</strong>` : '—' },
            { label: 'ماهیت مانده', render: (row) => {
              const isAbnormal = (balance.abnormalBalanceRows || []).some((ab) => ab.accountCode === row.accountCode);
              if (isAbnormal) return `<span class="fin-badge danger" title="مانده خلاف ماهیت طبیعی حساب">غیرعادی</span>`;
              return row.balanceIrr > 0 ? '<span class="fin-badge neutral">بدهکار</span>' : row.balanceIrr < 0 ? '<span class="fin-badge neutral">بستانکار</span>' : '<span class="fin-badge neutral">صفر</span>';
            } },
          ], trial.rows, 'برای این محدوده سند قطعی وجود ندارد.')}
          <div class="fin-trial-totals-bar">
            <div class="fin-trial-total-col">
              <span>جمع گردش بدهکار:</span>
              <strong>${money(totalDebitTurnover)}</strong>
            </div>
            <div class="fin-trial-total-col">
              <span>جمع گردش بستانکار:</span>
              <strong>${money(totalCreditTurnover)}</strong>
            </div>
            <div class="fin-trial-total-col">
              <span>جمع مانده بدهکار:</span>
              <strong>${money(totalDebitBalance)}</strong>
            </div>
            <div class="fin-trial-total-col">
              <span>جمع مانده بستانکار:</span>
              <strong>${money(totalCreditBalance)}</strong>
            </div>
            <div class="fin-trial-status-badge">
              <span class="fin-badge ${turnoverBalanced && balanceBalanced ? 'success' : 'danger'}">
                ${turnoverBalanced && balanceBalanced ? 'تراز ۴ ستونی کامل و منطبق ✓' : 'مغایرت در تراز آزمایشی'}
              </span>
            </div>
          </div>
        </section>
      </details>
      <section class="fin-panel"><div class="fin-panel-title"><div><h3>اسناد دفتر مالی جدید</h3><p>سند قطعی ویرایش نمی‌شود؛ اصلاح فقط با سند معکوس انجام می‌شود.</p></div></div>
        ${table('ledger', [
          { label: 'شماره', render: (row) => `<strong class="fin-record-anchor" data-fin-record-id="${esc(row.id)}" tabindex="-1">${esc(row.number)}</strong>` },
          { label: 'تاریخ', render: (row) => dateTime(row.date) },
          { label: 'شرح', render: (row) => esc(row.description) },
          { label: 'منشأ', render: (row) => `<strong>${esc(financeSourceLabel(row.source))}</strong>${row.sourceId ? `<small class="fin-cell-note">مرجع ${esc(row.sourceId)}</small>` : ''}` },
          { label: 'بدهکار', render: (row) => money(row.debitIrr) },
          { label: 'بستانکار', render: (row) => money(row.creditIrr) },
          { label: 'وضعیت', render: (row) => row.reversalOfId ? statusBadge('سند معکوس', 'neutral') : row.reversedById ? statusBadge('دارای سند معکوس', 'warning') : statusBadge(row.status) },
        ], data.entries, 'هنوز سندی در دفتر مالی جدید قطعی نشده است.', data.pagination)}
      </section>
      <details class="fin-advanced"><summary>سایر ابزارهای پیشرفته</summary><div><span>کدینگ حساب‌ها</span><span>پارامترهای قانونی حقوق: نیازمند تأیید تخصصی مؤثر-از-تاریخ</span><span>مالیات</span><span>${esc(data.integrityControl.label)}</span></div></details>
      </details>
      <div class="fin-note warning"><strong>سامانه مؤدیان: متصل نیست</strong><span>${esc(data.taxpayerIntegration.message)}</span></div>`;
  }

  function accountingJournalRow() {
    return `<div class="fin-journal-row" data-fin-journal-row>
      <label class="fin-field"><span>حساب</span><input name="journalAccount" list="fin-posting-accounts" required autocomplete="off" data-money-input="false" placeholder="کد یا نام حساب"></label>
      <label class="fin-field"><span>بدهکار (تومان)</span><input name="journalDebitToman" inputmode="numeric" data-money-input="false" placeholder="۰"></label>
      <label class="fin-field"><span>بستانکار (تومان)</span><input name="journalCreditToman" inputmode="numeric" data-money-input="false" placeholder="۰"></label>
      <label class="fin-field"><span>شرح ردیف</span><input name="journalMemo" maxlength="300" data-money-input="false"></label>
      <button class="fin-btn secondary" type="button" data-fin-remove-journal-row aria-label="حذف ردیف سند">حذف</button>
    </div>`;
  }

  function renderAccountingJournalForm(accounts = []) {
    const posting = accounts.filter(account => account.isPostingAccount !== false && account.active !== false);
    return `<form id="fin-journal-form" class="fin-form fin-form-wide" autocomplete="off">
      <label class="fin-field span-2"><span>شرح سند</span><input name="description" required minlength="3" maxlength="500" placeholder="شرح روشن عملیات حسابداری"></label>
      <label class="fin-field"><span>تاریخ سند</span><input name="date" type="date" value="${localIsoDate()}" required></label>
      <div class="fin-note"><strong>مبالغ به تومان وارد می‌شوند</strong><span>سند ابتدا پیش‌نویس می‌شود؛ ارسال برای تأیید از فهرست پیش‌نویس‌ها انجام می‌شود.</span></div>
      <datalist id="fin-posting-accounts">${posting.map(account => `<option value="${esc(account.code)} · ${esc(account.nameFa || account.name)}"></option>`).join('')}</datalist>
      <div class="fin-journal-lines span-2" data-fin-journal-lines>${accountingJournalRow()}${accountingJournalRow()}</div>
      <button class="fin-btn secondary" type="button" data-fin-add-journal-row>افزودن ردیف سند</button>
      <output class="fin-journal-totals span-2" data-fin-journal-totals aria-live="polite">حداقل دو ردیف را تکمیل کنید؛ بدهکار و بستانکار باید برابر باشند.</output>
      <button class="fin-btn primary span-2" type="submit" ${posting.length ? '' : 'disabled'}>بررسی و ذخیرهٔ پیش‌نویس</button>
    </form>`;
  }

  function accountingJournalInput(form) {
    return [...form.querySelectorAll('[data-fin-journal-row]')].map(row => ({
      account: row.querySelector('[name="journalAccount"]').value,
      debit: row.querySelector('[name="journalDebitToman"]').value,
      credit: row.querySelector('[name="journalCreditToman"]').value,
      memo: row.querySelector('[name="journalMemo"]').value,
    }));
  }

  async function submitAccountingJournal(form) {
    try {
      const branchId = activeBranchId();
      const journal = window.WestoAccountingExperience.journalLines(accountingJournalInput(form), branchId, state.auxiliary.accounts);
      const dateInput = form.elements.date;
      const date = window.ShamsiDatePicker?.getISOValue(dateInput) || dateInput.dataset.isoDate || dateInput.value;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('تاریخ سند را انتخاب کنید.');
      await runRecoverableFinanceOperation({
        path: '/api/admin/v2/finance/journal-entries',
        body: { branchId, costCenter: `branch:${branchId}`, date: `${date}T12:00:00.000Z`, description: form.elements.description.value, lines: journal.lines },
        button: form.querySelector('button[type="submit"]'), feedbackSelector: '#fin-operation-feedback',
        receiptKey: 'entry', receiptTitle: 'رسید پیش‌نویس سند',
        receiptFields: record => [{ label: 'شماره', value: record.number }, { label: 'شرح', value: record.description }, { label: 'وضعیت', value: label(record.status) }],
        successMessage: 'پیش‌نویس ذخیره شد؛ از فهرست پیش‌نویس‌ها برای تأیید ارسال کنید.', lockButtonOnSuccess: true,
      });
    } catch (error) { operationError(error); }
  }

  function renderAccountingChartAccounts(accounts = []) {
    const types = { asset: 'دارایی', liability: 'بدهی', equity: 'سرمایه', revenue: 'درآمد', contra_revenue: 'کاهندهٔ درآمد', cogs: 'بهای تمام‌شده', expense: 'هزینه' };
    return `<section class="fin-panel" data-fin-chart-accounts><div class="fin-panel-title"><div><h3>کدینگ حساب‌ها</h3><p>ساختار حساب‌های متصل به دفتر مالی؛ حساب‌های گروهی قابل ثبت مستقیم نیستند.</p></div></div>${table('accounting-chart-accounts', [
      { label: 'کد', key: 'code' }, { label: 'نام حساب', render: row => esc(row.nameFa || row.name) },
      { label: 'گروه', render: row => esc(types[row.type] || row.type) }, { label: 'حساب والد', render: row => esc(row.parentCode || '—') },
      { label: 'نوع ثبت', render: row => statusBadge(row.isPostingAccount === false ? 'گروهی' : 'قابل ثبت', row.isPostingAccount === false ? 'neutral' : 'success') },
    ], accounts, 'کدینگ حساب‌ها از سرور دریافت نشد.')}</section>`;
  }

  function renderAccountingJournalHistory(result = {}) {
    const rows = result.rows || [];
    return `<section class="fin-panel" data-fin-journal-history><div class="fin-panel-title"><div><h3>دفتر اسناد حسابداری</h3><p>اسناد ثبت‌شده در شعبه و بازهٔ انتخاب‌شده</p></div></div>${table('accounting-journal-history', [
      { label: 'شماره سند', render: row => `<strong data-fin-record-id="${esc(row.id)}" tabindex="-1">${esc(row.number)}</strong>` },
      { label: 'تاریخ', render: row => dateTime(row.date) },
      { label: 'شرح', key: 'description' },
      { label: 'منشأ', render: row => esc(financeSourceLabel(row.source)) },
      { label: 'بدهکار', render: row => money(row.debitIrr ?? (row.lines || []).reduce((sum, line) => sum + Number(line.debitIrr || 0), 0)) },
      { label: 'بستانکار', render: row => money(row.creditIrr ?? (row.lines || []).reduce((sum, line) => sum + Number(line.creditIrr || 0), 0)) },
      { label: 'وضعیت', render: row => statusBadge(row.status) },
      { label: 'جزئیات', render: row => `<button class="fin-btn secondary" type="button" data-fin-journal-detail="${esc(row.id)}">مشاهده</button>` },
    ], rows, 'سندی در این شعبه و بازه ثبت نشده است.', result.pagination)}</section>`;
  }

  function renderAccountingExpenseForm(data = {}) {
    return `<section class="fin-panel" data-fin-daily-expense><form id="fin-operating-expense-form" class="fin-form fin-form-wide" autocomplete="off">
      <label class="fin-field span-2"><span>شرح هزینه</span><input name="subject" required minlength="2" maxlength="240" placeholder="مثلاً قبض برق شهریور"></label>
      <label class="fin-field"><span>دستهٔ هزینه</span><select name="category" required><option value="">دستهٔ هزینه را انتخاب کنید</option>${(data.categories || []).map(row => `<option value="${esc(row.id)}">${esc(row.label)}</option>`).join('')}</select></label>
      <label class="fin-field"><span>مبلغ (تومان)</span><input name="amountToman" inputmode="numeric" data-money-input="false" required placeholder="۰"></label>
      <label class="fin-field"><span>تاریخ هزینه</span><input name="date" type="date" value="${localIsoDate()}" required></label>
      <label class="fin-field"><span>روش پرداخت</span><select name="paymentMethod"><option value="bank">بانک</option><option value="cash">نقد</option><option value="petty_cash">تنخواه</option><option value="credit">پرداخت نشده؛ ثبت بدهی</option></select></label>
      <label class="fin-field span-2"><span>مرجع فاکتور یا پرداخت</span><input name="reference" maxlength="160" placeholder="شماره فاکتور یا رسید"></label>
      <div class="fin-note span-2"><strong>ثبت پس از تأیید مستقل قطعی می‌شود</strong><span>شرح، دسته و روش پرداخت را بررسی کنید؛ هزینهٔ سرمایه‌ای از بخش دارایی ثبت می‌شود.</span></div>
      <button class="fin-btn primary span-2" type="submit" ${(data.categories || []).length ? '' : 'disabled'}>ثبت هزینه و ارسال برای تأیید</button>
    </form></section>`;
  }

  function openAccountingTask(id) {
    const content = root.querySelector('#fin-workspace-content');
    const form = content.querySelector(`#${CSS.escape(id)}`);
    if (!form || form.hidden || !confirmLeaveAccountingTask()) return false;
    state.task = id; persistQuery();
    return window.WestoAccountingExperience.showTask(content, id);
  }

  function bindAccountingExperience() {
    const content = root.querySelector('#fin-workspace-content');
    const experience = window.WestoAccountingExperience;
    const journalForm = content.querySelector('#fin-journal-form');
    const journalRows = journalForm?.querySelector('[data-fin-journal-lines]');
    if (journalRows) {
      const updateTotals = () => {
        const output = journalForm.querySelector('[data-fin-journal-totals]');
        try {
          const journal = experience.journalLines(accountingJournalInput(journalForm), activeBranchId(), state.auxiliary.accounts, { allowUnbalanced: true });
          const difference = journal.debitIrr - journal.creditIrr;
          output.textContent = `بدهکار: ${money(journal.debitIrr)} · بستانکار: ${money(journal.creditIrr)} · ${difference ? `اختلاف: ${money(Math.abs(difference))}` : 'سند تراز است'}`;
          output.dataset.balanced = String(!difference);
        } catch (error) { output.textContent = error.message; output.dataset.balanced = 'false'; }
      };
      journalRows.addEventListener('input', updateTotals);
      journalRows.addEventListener('change', updateTotals);
      journalRows.addEventListener('click', event => {
        const button = event.target.closest('[data-fin-remove-journal-row]');
        if (!button) return;
        if (journalRows.children.length <= 2) return operationError({ message: 'حداقل دو ردیف برای سند لازم است.' });
        button.closest('[data-fin-journal-row]').remove(); journalForm.dataset.finDirty = 'true'; updateTotals();
      });
      journalForm.querySelector('[data-fin-add-journal-row]').addEventListener('click', () => {
        if (journalRows.children.length >= 1000) return;
        journalRows.insertAdjacentHTML('beforeend', accountingJournalRow()); journalForm.dataset.finDirty = 'true'; updateTotals();
        journalRows.lastElementChild.querySelector('input').focus();
      });
    }
    content.querySelectorAll('[data-fin-section]').forEach(button => button.addEventListener('click', () => navigateAccounting(state.view, button.dataset.finSection)));
    content.querySelectorAll('[data-fin-open-task]').forEach(button => {
      const form = content.querySelector(`#${CSS.escape(button.dataset.finOpenTask)}`);
      if (form?.hidden) button.hidden = true;
      button.addEventListener('click', () => openAccountingTask(button.dataset.finOpenTask));
    });
    content.querySelectorAll('[data-fin-close-task]').forEach(button => button.addEventListener('click', () => {
      if (!confirmLeaveAccountingTask()) return;
      state.task = ''; persistQuery(); experience.showTask(content, '');
    }));
    content.querySelector('[data-fin-list-search]')?.addEventListener('input', event => {
      state.listSearch = event.target.value; experience.filterList(content, state.listSearch, state.listStatus, state.listCategory, state.listAging);
    });
    content.querySelector('[data-fin-list-status]')?.addEventListener('change', event => {
      state.listStatus = event.target.value; experience.filterList(content, state.listSearch, state.listStatus, state.listCategory, state.listAging);
    });
    content.querySelectorAll('[data-fin-clear-list]').forEach(button => button.addEventListener('click', () => {
      state.listSearch = ''; state.listStatus = ''; state.listCategory = 'all'; state.listAging = 'all';
      content.querySelectorAll('[data-fin-aging-bucket]').forEach(card => { card.classList.remove('active'); card.setAttribute('aria-pressed', 'false'); });
      const search = content.querySelector('[data-fin-list-search]'); if (search) search.value = '';
      const status = content.querySelector('[data-fin-list-status]'); if (status) status.value = '';
      content.querySelectorAll('[data-fin-trial-cat]').forEach(pill => { const active = pill.dataset.finTrialCat === 'all'; pill.classList.toggle('active', active); pill.setAttribute('aria-pressed', String(active)); });
      experience.filterList(content, '', '', 'all');
    }));
    experience.filterList(content, state.listSearch, state.listStatus, state.listCategory, state.listAging);
    const sortTable = (tableNode, index, ascending) => {
      const rows = [...tableNode.querySelectorAll('tbody tr')];
      const collator = new Intl.Collator('fa', { numeric: true });
      rows.sort((left, right) => {
        const a = left.children[index]?.textContent.trim() || ''; const b = right.children[index]?.textContent.trim() || '';
        const comparison = a.includes('تومان') && b.includes('تومان')
          ? Number(asciiDigits(a).replace(/[^0-9-]/g, '')) - Number(asciiDigits(b).replace(/[^0-9-]/g, '')) : collator.compare(a, b);
        return comparison * (ascending ? 1 : -1);
      });
      tableNode.querySelectorAll('thead th').forEach((node, column) => { if (node.hasAttribute('aria-sort')) node.setAttribute('aria-sort', column === index ? ascending ? 'ascending' : 'descending' : 'none'); });
      rows.forEach(row => tableNode.querySelector('tbody').append(row));
    };
    content.querySelectorAll('table[data-fin-table]').forEach(tableNode => {
      const sort = state.listSort?.[tableNode.dataset.finTable];
      if (sort) sortTable(tableNode, sort.index, sort.ascending);
    });
    content.querySelectorAll('[data-fin-sort]').forEach(button => button.addEventListener('click', () => {
      const tableNode = button.closest('table'); const heading = button.closest('th');
      const ascending = heading.getAttribute('aria-sort') !== 'ascending';
      const index = Number(button.dataset.finSort);
      state.listSort ||= {}; state.listSort[tableNode.dataset.finTable] = { index, ascending };
      sortTable(tableNode, index, ascending);
    }));
    content.querySelectorAll('[data-fin-journal-detail]').forEach(button => button.addEventListener('click', () => {
      const entry = state.auxiliary.journals?.rows?.find(row => String(row.id) === button.dataset.finJournalDetail);
      if (!entry) return;
      const accountNames = new Map((state.auxiliary.accounts || []).map(account => [String(account.code), account.nameFa || account.name]));
      const lines = table('journal-record-lines', [
        { label: 'حساب', render: row => esc(`${row.accountCode} ${accountNames.get(String(row.accountCode)) || ''}`) },
        { label: 'شرح ردیف', key: 'memo' },
        { label: 'بدهکار', render: row => money(row.debitIrr) }, { label: 'بستانکار', render: row => money(row.creditIrr) },
      ], entry.lines || [], 'ردیف‌های سند در پاسخ موجود نیست.', { page: 1, pages: 1, total: entry.lines?.length || 0 });
      experience.showRecord(content, `سند ${entry.number || entry.id}`, `<div class="fin-note"><strong>${esc(entry.description)}</strong><span>${dateTime(entry.date)} · ${esc(label(entry.status))} · ${esc(financeSourceLabel(entry.source))}</span></div>${lines}<p class="fin-record-note">سند قطعی از این صفحه ویرایش نمی‌شود؛ اصلاح آن از گردش مجاز سند معکوس انجام می‌شود.</p>`);
    }));
    content.querySelector('[data-fin-export-visible]')?.addEventListener('click', () => {
      const rows = [];
      content.querySelectorAll('.fin-page-list table').forEach(tableNode => {
        const headers = [...tableNode.querySelectorAll('thead th')];
        const columns = headers.map((header, index) => /اقدام|جزئیات|زنجیره/.test(header.textContent) ? -1 : index).filter(index => index >= 0);
        rows.push(columns.map(index => headers[index].textContent.trim()));
        tableNode.querySelectorAll('tbody tr').forEach(row => {
          if (row.hidden || row.style.display === 'none') return;
          rows.push(columns.map(index => row.children[index]?.textContent.trim() || ''));
        });
      });
      if (!rows.length) return;
      const quote = value => {
        const text = String(value).trimStart();
        const safe = /^[=+@-]/.test(text) && !/^-?\d+(\.\d+)?$/.test(text) ? `'${value}` : value;
        return `"${String(safe).replace(/"/g, '""')}"`;
      };
      const url = URL.createObjectURL(new Blob([`\uFEFF${rows.map(row => row.map(quote).join(',')).join('\n')}`], { type: 'text/csv;charset=utf-8' }));
      const link = document.createElement('a'); link.href = url; link.download = `westo-accounting-${state.view}-${state.section || 'list'}-${localIsoDate()}.csv`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    content.querySelectorAll('[data-fin-task-page] form').forEach(form => {
      form.dataset.finInitialValues = accountingFormSnapshot(form);
      const beginEdit = event => {
        if (!event.isTrusted || form.dataset.finUserTouched === 'true') return;
        form.dataset.finInitialValues = accountingFormSnapshot(form);
        form.dataset.finUserTouched = 'true';
      };
      form.addEventListener('pointerdown', beginEdit);
      form.addEventListener('keydown', beginEdit);
      form.addEventListener('input', event => { if (event.isTrusted || form.dataset.finUserTouched === 'true') form.dataset.finDirty = 'true'; });
      form.addEventListener('change', event => { if (event.isTrusted || form.dataset.finUserTouched === 'true') form.dataset.finDirty = 'true'; });
      form.addEventListener('submit', event => {
        if (form.id === 'fin-break-even-form') return;
        const snapshot = accountingFormSnapshot(form);
        if (form.dataset.finReviewedValues === snapshot) { delete form.dataset.finReviewedValues; return; }
        event.preventDefault(); event.stopImmediatePropagation();
        if (!activeBranchId()) return operationError({ code: 'finance_branch_required', message: 'ابتدا شعبه را انتخاب کنید.' });
        if (form.querySelector('[data-fin-journal-lines]')) {
          try { experience.journalLines(accountingJournalInput(form), activeBranchId(), state.auxiliary.accounts); }
          catch (error) { return operationError(error); }
        }
        if (form.id === 'fin-operating-expense-form') {
          try { if (experience.tomanToIrr(form.elements.amountToman.value) <= 0) throw new Error('مبلغ هزینه باید مثبت باشد.'); }
          catch (error) { return operationError(error); }
        }
        form.querySelector('[data-fin-form-review]')?.remove();
        const review = document.createElement('section'); review.className = 'fin-form-review span-all'; review.dataset.finFormReview = ''; review.setAttribute('aria-label', 'بررسی اطلاعات پیش از ثبت');
        review.innerHTML = experience.reviewMarkup(form, activeBranchId());
        form.classList.add('is-reviewing'); form.append(review); review.scrollIntoView({ block: 'start' }); review.querySelector('[data-fin-confirm-form]').focus({ preventScroll: true });
        const dismiss = () => { review.remove(); form.classList.remove('is-reviewing'); };
        review.querySelector('[data-fin-edit-form]').addEventListener('click', () => { dismiss(); form.querySelector('input:not([type="hidden"]),select,textarea')?.focus({ preventScroll: true }); });
        review.querySelector('[data-fin-confirm-form]').addEventListener('click', () => {
          if (snapshot !== accountingFormSnapshot(form)) { dismiss(); form.requestSubmit(event.submitter); return; }
          form.dataset.finReviewedValues = snapshot; dismiss(); form.requestSubmit(event.submitter);
        });
      }, { capture: true });
    });
    const daily = content.querySelector('#fin-operating-expense-form');
    daily?.addEventListener('submit', async event => {
      event.preventDefault(); const form = event.currentTarget; const values = Object.fromEntries(new FormData(form));
      const branchId = activeBranchId();
      let amountIrr;
      try { amountIrr = experience.tomanToIrr(values.amountToman); }
      catch (error) { return operationError(error); }
      if (!branchId || amountIrr <= 0) return operationError({ code: 'expense_amount_invalid', message: 'مبلغ هزینه باید عدد صحیح مثبت و در محدودهٔ امن ریال باشد.' });
      const dateInput = form.elements.date;
      const date = window.ShamsiDatePicker?.getISOValue(dateInput) || dateInput.dataset.isoDate || dateInput.value;
      await runRecoverableFinanceOperation({
        path: '/api/admin/v2/finance/operating-expenses', body: { branchId, subject: values.subject, category: values.category, amountIrr, date, paymentMethod: values.paymentMethod, reference: values.reference },
        button: form.querySelector('button[type="submit"]'), feedbackSelector: '#fin-operation-feedback', receiptKey: 'expense', receiptTitle: 'رسید ثبت هزینهٔ روزانه',
        receiptFields: record => [{ label: 'شرح', value: record.subject }, { label: 'مبلغ', value: money(record.amountIrr) }, { label: 'وضعیت', value: label(record.status) }], successMessage: 'هزینه ثبت و برای تأیید مستقل ارسال شد.', lockButtonOnSuccess: true,
      });
    });
    if (state.task) {
      const form = content.querySelector(`#${CSS.escape(state.task)}`);
      if (form && !form.hidden) experience.showTask(content, state.task);
      else { state.task = ''; persistQuery(); }
    }
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

  window.renderAccountingWorkspace = async function renderAccountingWorkspace(container, qs = '', context = {}) {
    root = container;
    state.experience = context.experience === 'accounting' && Boolean(window.WestoAccountingExperience);
    state.search = '';
    state.listSearch = '';
    state.listStatus = '';
    state.listCategory = 'all'; state.listAging = 'all'; state.listSort = {};
    state.navigation = {};
    accessContext = {
      hasCapability: typeof context.hasCapability === 'function' ? context.hasCapability : () => false,
      currentUser: typeof context.currentUser === 'function' ? context.currentUser : () => null,
      branchCount: typeof context.branchCount === 'function' ? context.branchCount : () => 0,
    };
    readLocationQuery(qs);
    if (context.workspace && WORKSPACES.some((item) => item.id === context.workspace)) {
      state.workspace = context.workspace;
    }
    renderShell();
    await loadWorkspace();
  };
})();
