/* WESTO Finance UI model — Phase 1 source of truth for language and task discovery. */
(() => {
  'use strict';

  const workspaces = [
    {
      id: 'workbench', label: 'کارهای حسابداری', navLabel: 'کارتابل حسابدار', hint: 'موارد باز برای بررسی و پیگیری', icon: '✓', endpoint: 'workbench',
      audience: ['owner', 'manager', 'accountant'], source: 'اطلاعات مالی مجموعه',
      tasks: ['review', 'approve', 'reconcile'],
    },
    {
      id: 'sales_bank', label: 'فروش ثبت‌شده و دریافت وجه', navLabel: 'فروش و دریافت وجه', hint: 'فروش ثبت‌شده، وجه دریافت‌شده، واریز بانکی و اختلاف‌ها', icon: '﷼', endpoint: 'sales-cash-bank',
      audience: ['owner', 'manager', 'accountant'], source: 'فروش ثبت‌شده، وجه دریافت‌شده و واریز بانکی',
      tasks: ['sales', 'cash', 'settlement', 'bank'],
    },
    {
      id: 'purchases', label: 'خرید، هزینه و پرداخت‌ها', navLabel: 'خرید، هزینه‌ها و پرداخت‌ها', hint: 'ثبت خرید، ثبت هزینه و پیگیری پرداخت‌ها', icon: '↗', endpoint: 'purchases-payables',
      audience: ['owner', 'manager', 'accountant'], source: 'خریدها، هزینه‌ها و پرداخت‌های در انتظار',
      tasks: ['purchase', 'receipt', 'invoice', 'payable'],
    },
    {
      id: 'costing', label: 'مواد و هزینه‌های تولید', navLabel: 'مواد و هزینه‌ها', hint: 'موجودی مواد، دستور تهیه و هزینهٔ هر محصول', icon: '∑', endpoint: 'costing-inventory',
      // This is a financial workspace. Kitchen operators do not have
      // finance.view and must not be represented as readers of costing data;
      // their physical handoff is explicit and uses the redacted kitchen API.
      audience: ['owner', 'manager', 'accountant'], source: 'موجودی مواد و هزینهٔ محصول',
      operationalHandoff: Object.freeze({ role: 'kitchen', capability: 'inventory.view', path: '/admin/kitchen?view=inventory&branchId={branchId}', label: 'تکمیل مقدار و موجودی عملیاتی' }),
      tasks: ['inventory', 'recipe', 'consumption', 'costing'],
    },
    {
      id: 'ledger_close', label: 'گزارش‌ها، سود و بستن دوره', navLabel: 'گزارش‌ها و بستن دوره', hint: 'گزارش‌های مالی، سود و زیان و آماده‌سازی بستن دوره', icon: '≡', endpoint: 'ledger-close',
      audience: ['owner', 'manager', 'accountant'], source: 'اطلاعات مالی ثبت‌شده',
      tasks: ['report', 'profit_loss', 'close'],
    },
  ];

  window.WestoFinanceUiModel = Object.freeze({
    version: 'phase-01',
    displayModes: Object.freeze({
      simple: 'نمای ساده برای کار روزانه',
      details: 'جزئیات قابل بازشدن برای بررسی',
      specialist: 'ابزار تخصصی برای حسابدار و مدیر',
    }),
    statusCopy: Object.freeze({
      empty: 'هنوز فعالیتی ثبت نشده است',
      insufficientData: 'داده کافی برای محاسبه وجود ندارد',
      needsAction: 'نیازمند اقدام',
      awaitingApproval: 'در انتظار تأیید',
      informational: 'فقط برای اطلاع',
    }),
    workspaces: Object.freeze(workspaces.map((workspace) => Object.freeze({
      ...workspace,
      audience: Object.freeze([...workspace.audience]),
      tasks: Object.freeze([...workspace.tasks]),
    }))),
  });
})();
