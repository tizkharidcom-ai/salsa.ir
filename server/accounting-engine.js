'use strict';

/**
 * WESTO Unified Accounting Engine
 * Complete double-entry accounting subsystem integrated from NEEM project.
 * Supports:
 * - 4-digit Persian Chart of Accounts (COA)
 * - Multi-line balanced Journal Entries (DR/CR) with SHA-256 integrity hash chaining
 * - Automatic sales & payment journalizing
 * - General Ledger & Subledgers
 * - 4-column & 6-column Trial Balance
 * - Income Statement (P&L), Balance Sheet, Direct & Indirect Cash Flow Statements
 * - Cash Drawer Sessions & POS Settlements
 * - Vendor Bills & Accounts Payable (AP Aging)
 * - Customer Receivables (AR Subledger)
 * - Expense Tracking & Petty Cash Management
 * - Fixed Assets & Automated Monthly Depreciation (multi-method)
 * - Fiscal Periods & Period Close with posting-lock enforcement
 * - VAT & Tax Settings Matrix
 * - Procurement (PO & Goods Receipts & 3-Way Match)
 * - Accruals & Prepaid Expenses Amortization
 * - Multi-Branch Consolidation & Benchmarking
 * - Bank Feed Auto-Matching & Reconciliation
 * - Predictive Analytics, Burn Rate & Cash Runway
 * - AI CFO Executive Briefs
 */

const crypto = require('crypto');
const money = require('./finance/money');
const periodService = require('./finance/period-service');
const taxEngine = require('./finance/tax-engine');
const inventoryEngine = require('./finance/inventory-engine');
const assetEngine = require('./finance/asset-engine');
const approvalEngine = require('./finance/approval-engine');
const accrualEngine = require('./finance/accrual-engine');
const procurementEngine = require('./finance/procurement-engine');
const reconciliationEngine = require('./finance/reconciliation-engine');
const predictiveEngine = require('./finance/predictive-engine');
const consolidationEngine = require('./finance/consolidation-engine');
const auditEngine = require('./finance/audit-engine');

const ACCOUNT_TYPES = new Set(['asset', 'liability', 'equity', 'revenue', 'contra_revenue', 'cogs', 'expense']);
const aiEngine = require('./finance/ai-engine');
const salesPosEngine = require('./finance/sales-pos-engine');
const taxpayerAdapter = require('./finance/taxpayer-adapter');
const payrollEngine = require('./finance/payroll-engine');
const fnbCostOptimizer = require('./finance/fnb-cost-optimizer');

// ── Default Chart of Accounts (Standard Iranian Restaurant COA) ─────────────
const DEFAULT_COA = [
  // ── 1. Assets (دارایی‌ها)
  { code: '1000', name: 'Assets', nameFa: 'دارایی‌ها', type: 'asset', isPostingAccount: false },
  { code: '1100', name: 'Current Assets', nameFa: 'دارایی‌های جاری', type: 'asset', isPostingAccount: false, parentCode: '1000' },
  { code: '1110', name: 'Cash on Hand', nameFa: 'وجه نقد در صندوق', type: 'asset', subtype: 'cash', isPostingAccount: true, parentCode: '1100' },
  { code: '1120', name: 'Cash in Drawer - Main', nameFa: 'صندوق نقدی شعبه اصلی', type: 'asset', subtype: 'cash', isPostingAccount: true, parentCode: '1100' },
  { code: '1125', name: 'Cash in Drawer - Secondary', nameFa: 'صندوق نقدی شعبه دو', type: 'asset', subtype: 'cash', isPostingAccount: true, parentCode: '1100' },
  { code: '1130', name: 'Petty Cash Fund', nameFa: 'صندوق تنخواه گردان', type: 'asset', subtype: 'cash', isPostingAccount: true, parentCode: '1100' },
  { code: '1200', name: 'Bank Accounts', nameFa: 'حساب‌های بانکی', type: 'asset', isPostingAccount: false, parentCode: '1100' },
  { code: '1210', name: 'Bank - Operating Account', nameFa: 'بانک جاری اصلی (متصل به صندوق فروش)', type: 'asset', subtype: 'bank', isPostingAccount: true, parentCode: '1200' },
  { code: '1220', name: 'Bank - Reserve Account', nameFa: 'حساب بانکی پس‌انداز و ذخیره', type: 'asset', subtype: 'bank', isPostingAccount: true, parentCode: '1200' },
  { code: '1300', name: 'Payment Gateway Receivables', nameFa: 'مطالبات از درگاه پرداخت و کارتخوان', type: 'asset', isPostingAccount: false, parentCode: '1100' },
  { code: '1310', name: 'Online Gateway Receivable (Zarinpal/PSP)', nameFa: 'مطالبات درگاه پرداخت آنلاین', type: 'asset', subtype: 'receivable', isPostingAccount: true, parentCode: '1300' },
  { code: '1320', name: 'POS Terminal Receivable (PC-POS)', nameFa: 'مطالبات در انتظار تسویه کارتخوان', type: 'asset', subtype: 'receivable', isPostingAccount: true, parentCode: '1300' },
  { code: '1400', name: 'Marketplace Receivables', nameFa: 'مطالبات از پلتفرم‌های سفارش آنلاین', type: 'asset', isPostingAccount: false, parentCode: '1100' },
  { code: '1410', name: 'SnappFood Receivable', nameFa: 'مطالبات اسنپ‌فود', type: 'asset', subtype: 'receivable', isPostingAccount: true, parentCode: '1400' },
  { code: '1420', name: 'Tapsi Food Receivable', nameFa: 'مطالبات تپسی فود', type: 'asset', subtype: 'receivable', isPostingAccount: true, parentCode: '1400' },
  { code: '1450', name: 'Recoverable Input VAT', nameFa: 'اعتبار مالیات بر ارزش افزوده خرید', type: 'asset', subtype: 'receivable', isPostingAccount: true, parentCode: '1100' },
  { code: '1500', name: 'Accounts Receivable (Customers)', nameFa: 'حساب‌های دریافتنی تجاری (مشتریان)', type: 'asset', isPostingAccount: false, parentCode: '1100' },
  { code: '1510', name: 'Customer Credit Accounts', nameFa: 'حساب‌های اعتباری و شرکتی مشتریان', type: 'asset', subtype: 'receivable', isPostingAccount: true, parentCode: '1500' },
  { code: '1590', name: 'Allowance for Doubtful Accounts', nameFa: 'ذخیره مطالبات مشکوک‌الوصول', type: 'asset', subtype: 'contra_asset', isPostingAccount: true, parentCode: '1500' },
  { code: '1600', name: 'Inventory', nameFa: 'موجودی مواد اولیه و کالا', type: 'asset', isPostingAccount: false, parentCode: '1100' },
  { code: '1610', name: 'Raw Food & Beverage Inventory', nameFa: 'موجودی مواد غذایی و نوشیدنی', type: 'asset', subtype: 'inventory', isPostingAccount: true, parentCode: '1600' },
  { code: '1620', name: 'Packaging & Consumables Inventory', nameFa: 'موجودی ظروف و اقلام مصرفی', type: 'asset', subtype: 'inventory', isPostingAccount: true, parentCode: '1600' },
  { code: '1630', name: 'Work in Progress & Prep Inventory', nameFa: 'موجودی مواد نیمه‌آماده و آماده‌سازی', type: 'asset', subtype: 'inventory', isPostingAccount: true, parentCode: '1600' },
  { code: '1700', name: 'Prepaid Expenses', nameFa: 'پیش‌پرداخت‌ها', type: 'asset', subtype: 'prepaid', isPostingAccount: true, parentCode: '1100' },
  { code: '1800', name: 'Fixed Assets (Property & Equipment)', nameFa: 'دارایی‌های ثابت مشهود', type: 'asset', isPostingAccount: false, parentCode: '1000' },
  { code: '1810', name: 'Kitchen & Bar Equipment', nameFa: 'تجهیزات آشپزخانه و بار', type: 'asset', subtype: 'fixed_asset', isPostingAccount: true, parentCode: '1800' },
  { code: '1820', name: 'Furniture & Decor', nameFa: 'مبلمان، دکوراسیون و سالن', type: 'asset', subtype: 'fixed_asset', isPostingAccount: true, parentCode: '1800' },
  { code: '1830', name: 'POS & IT Hardware', nameFa: 'سخت‌افزار صندوق و سامانه‌های دیجیتال', type: 'asset', subtype: 'fixed_asset', isPostingAccount: true, parentCode: '1800' },
  { code: '1880', name: 'Assets Under Construction / Fit-out', nameFa: 'دارایی‌های ثابت در جریان ساخت و نوسازی', type: 'asset', subtype: 'fixed_asset', isPostingAccount: true, parentCode: '1800' },
  { code: '1890', name: 'Accumulated Depreciation', nameFa: 'استهلاک انباشته دارایی‌های ثابت', type: 'asset', subtype: 'contra_asset', isPostingAccount: true, parentCode: '1800' },
  { code: '1910', name: 'Commercial Lease Security Deposits', nameFa: 'ودیعه رهن اماکن تجاری (غیرجاری)', type: 'asset', subtype: 'other_asset', isPostingAccount: true, parentCode: '1000' },

  // ── 2. Liabilities (بدهی‌ها)
  { code: '2000', name: 'Liabilities', nameFa: 'بدهی‌ها', type: 'liability', isPostingAccount: false },
  { code: '2100', name: 'Accounts Payable (Vendors)', nameFa: 'حساب‌های پرداختنی تجاری (تأمین‌کنندگان)', type: 'liability', isPostingAccount: false, parentCode: '2000' },
  { code: '2110', name: 'Trade Vendors Payable', nameFa: 'بستانکاران تجاری و تأمین‌کنندگان مواد', type: 'liability', subtype: 'payable', isPostingAccount: true, parentCode: '2100' },
  { code: '2120', name: 'Goods Received Not Invoiced', nameFa: 'کالای دریافت‌شده و فاکتورنشده', type: 'liability', subtype: 'payable', isPostingAccount: true, parentCode: '2100' },
  { code: '2150', name: 'Notes Payable (Issued Cheques)', nameFa: 'اسناد پرداختنی تجاری (چک‌های سررسیدنشده)', type: 'liability', subtype: 'payable', isPostingAccount: true, parentCode: '2100' },
  { code: '2200', name: 'Taxes & Levies Payable', nameFa: 'مالیات و عوارض پرداختنی', type: 'liability', isPostingAccount: false, parentCode: '2000' },
  { code: '2210', name: 'VAT & Sales Tax Payable', nameFa: 'مالیات بر ارزش افزوده پرداختنی (۱۰٪)', type: 'liability', subtype: 'payable', isPostingAccount: true, parentCode: '2200' },
  { code: '2220', name: 'Payroll Tax Payable', nameFa: 'مالیات تکلیفی حقوق پرداختنی', type: 'liability', subtype: 'payable', isPostingAccount: true, parentCode: '2200' },
  { code: '2230', name: 'Social Security Insurance Payable', nameFa: 'بیمه پرداختنی به تأمین اجتماعی (۳۰٪)', type: 'liability', subtype: 'payable', isPostingAccount: true, parentCode: '2200' },
  { code: '2250', name: 'Corporate Income Tax Provision', nameFa: 'ذخیره مالیات بر عملکرد سالانه', type: 'liability', subtype: 'payable', isPostingAccount: true, parentCode: '2200' },
  { code: '2300', name: 'Staff Tips Payable', nameFa: 'انعام کارکنان پرداختنی', type: 'liability', subtype: 'payable', isPostingAccount: true, parentCode: '2000' },
  { code: '2400', name: 'Gift Card & Voucher Liability', nameFa: 'تعهد کارت‌های هدیه و بن خرید', type: 'liability', subtype: 'payable', isPostingAccount: true, parentCode: '2000' },
  { code: '2500', name: 'Customer Deposits & Wallet Liabilities', nameFa: 'پیش‌دریافت، سپرده و تعهدات کیف پول مشتریان', type: 'liability', subtype: 'payable', isPostingAccount: true, parentCode: '2000' },
  { code: '2600', name: 'Payroll & Salaries Payable', nameFa: 'حقوق و دستمزد پرداختنی پرسنل', type: 'liability', subtype: 'payable', isPostingAccount: true, parentCode: '2000' },
  { code: '2700', name: 'Accrued Expenses', nameFa: 'سایر هزینه‌های پرداختنی و تعهدی', type: 'liability', subtype: 'payable', isPostingAccount: true, parentCode: '2000' },
  { code: '2750', name: 'Staff Gratuity Provision', nameFa: 'ذخیره مزایای پایان خدمت پرسنل (سنوات)', type: 'liability', subtype: 'payable', isPostingAccount: true, parentCode: '2000' },

  // ── 3. Equity (حقوق صاحبان سهام)
  { code: '3000', name: 'Equity', nameFa: 'حقوق صاحبان سهام و سرمایه', type: 'equity', isPostingAccount: false },
  { code: '3100', name: 'Owner Capital', nameFa: 'سرمایه اولیه مؤسسین', type: 'equity', isPostingAccount: true, parentCode: '3000' },
  { code: '3200', name: 'Retained Earnings', nameFa: 'سود و زیان انباشته سنواتی', type: 'equity', isPostingAccount: true, parentCode: '3000' },
  { code: '3900', name: 'Current Year Profit/Loss', nameFa: 'سود (زیان) خالص دوره جاری', type: 'equity', isPostingAccount: true, parentCode: '3000' },

  // ── 4. Revenue (درآمدها)
  { code: '4000', name: 'Revenue', nameFa: 'درآمدها', type: 'revenue', isPostingAccount: false },
  { code: '4100', name: 'Food Sales Revenue', nameFa: 'فروش غذا', type: 'revenue', isPostingAccount: false, parentCode: '4000' },
  { code: '4110', name: 'Dine-in Food Sales', nameFa: 'فروش غذا — سالن و میز', type: 'revenue', isPostingAccount: true, parentCode: '4100' },
  { code: '4120', name: 'Takeaway Food Sales', nameFa: 'فروش غذا — بیرون‌بر و حضوری', type: 'revenue', isPostingAccount: true, parentCode: '4100' },
  { code: '4130', name: 'Online Direct Food Sales', nameFa: 'فروش غذا — سفارش مستقیم سایت', type: 'revenue', isPostingAccount: true, parentCode: '4100' },
  { code: '4140', name: 'Marketplace Food Sales', nameFa: 'فروش غذا — پلتفرم‌های واسط', type: 'revenue', isPostingAccount: true, parentCode: '4100' },
  { code: '4200', name: 'Beverage Sales Revenue', nameFa: 'فروش نوشیدنی و بار گرم/سرد', type: 'revenue', isPostingAccount: false, parentCode: '4000' },
  { code: '4210', name: 'Coffee & Warm Beverages', nameFa: 'فروش انواع قهوه و نوشیدنی گرم', type: 'revenue', isPostingAccount: true, parentCode: '4200' },
  { code: '4220', name: 'Cold Beverages & Mocktails', nameFa: 'فروش نوشیدنی‌های سرد و موکتل', type: 'revenue', isPostingAccount: true, parentCode: '4200' },
  { code: '4300', name: 'Dessert & Bakery Sales', nameFa: 'فروش دسر، کیک و شیرینی', type: 'revenue', isPostingAccount: true, parentCode: '4000' },
  { code: '4400', name: 'Delivery & Service Charges', nameFa: 'درآمد حق سرویس و ارسال پیک', type: 'revenue', isPostingAccount: true, parentCode: '4000' },
  { code: '4500', name: 'Other Operating Income', nameFa: 'سایر درآمدهای عملیاتی و جانبی', type: 'revenue', isPostingAccount: true, parentCode: '4000' },
  { code: '4520', name: 'Inventory Count Surplus', nameFa: 'مازاد شمارش موجودی', type: 'revenue', isPostingAccount: true, parentCode: '4000' },
  { code: '4700', name: 'Interest & Non-Operating Income', nameFa: 'درآمدهای غیرعملیاتی و سود بانکی', type: 'revenue', isPostingAccount: true, parentCode: '4000' },
  { code: '4800', name: 'Foreign Exchange Gain', nameFa: 'سود تسعیر ارز', type: 'revenue', isPostingAccount: true, parentCode: '4000' },

  // ── 5. Contra Revenue (کاهنده‌های درآمد / تخفیف‌ها)
  { code: '4900', name: 'Sales Discounts & Allowances', nameFa: 'تخفیف‌ها و کاهنده‌های فروش', type: 'contra_revenue', isPostingAccount: false, parentCode: '4000' },
  { code: '4910', name: 'Promotional Discounts', nameFa: 'تخفیف‌های عمومی و کدهای تبلیغاتی', type: 'contra_revenue', isPostingAccount: true, parentCode: '4900' },
  { code: '4920', name: 'Staff & VIP Discounts', nameFa: 'تخفیف پرسنلی و مهمانان ویژه', type: 'contra_revenue', isPostingAccount: true, parentCode: '4900' },
  { code: '4930', name: 'Complimentary Meals (Comps)', nameFa: 'سفارش‌های رایگان و تعارف', type: 'contra_revenue', isPostingAccount: true, parentCode: '4900' },
  { code: '4940', name: 'Customer Refunds', nameFa: 'مرجوعی و بازپرداخت به مشتری', type: 'contra_revenue', isPostingAccount: true, parentCode: '4900' },
  { code: '4950', name: 'Loyalty Club Tier Discounts', nameFa: 'تخفیفات سطح وفاداری و باشگاه مشتریان', type: 'contra_revenue', isPostingAccount: true, parentCode: '4900' },

  // ── 6. COGS (بهای تمام‌شده کالای فروش‌رفته)
  { code: '5000', name: 'Cost of Goods Sold (COGS)', nameFa: 'بهای تمام‌شده کالای فروش‌رفته', type: 'cogs', isPostingAccount: false },
  { code: '5100', name: 'Food Ingredients COGS', nameFa: 'بهای تمام‌شده مواد اولیه غذا', type: 'cogs', isPostingAccount: true, parentCode: '5000' },
  { code: '5110', name: 'Raw Material Waste', nameFa: 'ضایعات مواد اولیه', type: 'cogs', isPostingAccount: true, parentCode: '5000' },
  { code: '5120', name: 'Inventory Count Shortage', nameFa: 'کسری شمارش موجودی', type: 'cogs', isPostingAccount: true, parentCode: '5000' },
  { code: '5130', name: 'Production Yield Loss', nameFa: 'افت تولید بچ', type: 'cogs', isPostingAccount: true, parentCode: '5000' },
  { code: '5150', name: 'Purchase Price Variance', nameFa: 'اختلاف قیمت خرید', type: 'cogs', isPostingAccount: true, parentCode: '5000' },
  { code: '5200', name: 'Beverage Ingredients COGS', nameFa: 'بهای تمام‌شده مواد اولیه نوشیدنی و قهوه', type: 'cogs', isPostingAccount: true, parentCode: '5000' },
  { code: '5300', name: 'Packaging & Takeaway Supplies', nameFa: 'بهای ظروف و ملزومات بیرون‌بر', type: 'cogs', isPostingAccount: true, parentCode: '5000' },
  { code: '5400', name: 'Kitchen Waste & Spoilage', nameFa: 'ضایعات و ضایع‌شدگی مواد آشپزخانه', type: 'cogs', isPostingAccount: true, parentCode: '5000' },
  { code: '5500', name: 'Cash Register Over/Short', nameFa: 'کسری / مازاد صندوق نقدی', type: 'cogs', isPostingAccount: true, parentCode: '5000' },

  // ── 7. Operating Expenses (هزینه‌های عمومی، اداری و عملیاتی)
  { code: '6000', name: 'Operating Expenses', nameFa: 'هزینه‌های عملیاتی و اداری', type: 'expense', isPostingAccount: false },
  { code: '6100', name: 'Personnel & Labor Costs', nameFa: 'هزینه‌های حقوق و دستمزد کارکنان', type: 'expense', isPostingAccount: false, parentCode: '6000' },
  { code: '6110', name: 'Kitchen Staff Wages', nameFa: 'دستمزد و حقوق پرسنل آشپزخانه و بار', type: 'expense', isPostingAccount: true, parentCode: '6100' },
  { code: '6120', name: 'Service Staff Wages', nameFa: 'دستمزد و حقوق پرسنل سالن و صندوق', type: 'expense', isPostingAccount: true, parentCode: '6100' },
  { code: '6130', name: 'Overtime & Bonuses', nameFa: 'اضافه‌کاری، پاداش و عیدی', type: 'expense', isPostingAccount: true, parentCode: '6100' },
  { code: '6140', name: 'Social Security & Insurance', nameFa: 'حق بیمه تأمین اجتماعی پرسنل', type: 'expense', isPostingAccount: true, parentCode: '6100' },
  { code: '6200', name: 'Rent & Lease Expense', nameFa: 'اجاره‌بهای ملک و سالن', type: 'expense', isPostingAccount: true, parentCode: '6000' },
  { code: '6300', name: 'Utilities (Water, Power, Gas, Internet)', nameFa: 'هزینه انشعابات (آب، برق، گاز، اینترنت)', type: 'expense', isPostingAccount: true, parentCode: '6000' },
  { code: '6400', name: 'Marketing & Advertising', nameFa: 'تبلیغات، شبکه‌های اجتماعی و برندینگ', type: 'expense', isPostingAccount: true, parentCode: '6000' },
  { code: '6500', name: 'Maintenance & Repairs', nameFa: 'تعمیرات و نگهداری دستگاه‌ها و فضا', type: 'expense', isPostingAccount: true, parentCode: '6000' },
  { code: '6600', name: 'Cleaning & Hygiene Supplies', nameFa: 'مواد شوینده، نظافت و بهداشت', type: 'expense', isPostingAccount: true, parentCode: '6000' },
  { code: '6700', name: 'Office Supplies & Stationery', nameFa: 'لوازم‌التحریر و ملزومات دفتری', type: 'expense', isPostingAccount: true, parentCode: '6000' },
  { code: '6710', name: 'Bank & PSP Settlement Fees', nameFa: 'کارمزد تسویه بانکی و درگاه', type: 'expense', isPostingAccount: true, parentCode: '6000' },
  { code: '6720', name: 'Bank Loan Interest Expense', nameFa: 'هزینه بهره و کارمزد تسهیلات بانکی', type: 'expense', isPostingAccount: true, parentCode: '6000' },
  { code: '6800', name: 'Business Insurance', nameFa: 'بیمه آتش‌سوزی و مسئولیت مدنی', type: 'expense', isPostingAccount: true, parentCode: '6000' },
  { code: '6850', name: 'Foreign Exchange Loss', nameFa: 'زیان تسعیر ارز', type: 'expense', isPostingAccount: true, parentCode: '6000' },
  { code: '6900', name: 'Licensing, Legal & Permits', nameFa: 'مجوزها، عوارض شهرداری و امور حقوقی', type: 'expense', isPostingAccount: true, parentCode: '6000' },
  { code: '6950', name: 'Bank & POS Terminal Fees', nameFa: 'کارمزد تراکنش‌های بانکی و کارتخوان', type: 'expense', isPostingAccount: true, parentCode: '6000' },
  { code: '6970', name: 'Marketplace Commissions', nameFa: 'کمیسیون پلتفرم‌های اسنپ‌فود/تپسی', type: 'expense', isPostingAccount: true, parentCode: '6000' },
  { code: '6980', name: 'Depreciation Expense', nameFa: 'هزینه استهلاک دارایی‌های ثابت', type: 'expense', isPostingAccount: true, parentCode: '6000' },
  { code: '6990', name: 'Miscellaneous Expenses', nameFa: 'سایر هزینه‌های جزئی و متفرقه', type: 'expense', isPostingAccount: true, parentCode: '6000' },
  { code: '6995', name: 'Tax Penalties & Fines (Non-Deductible)', nameFa: 'جرایم و خسارات قانونی (غیرقابل قبول مالیاتی)', type: 'expense', isPostingAccount: true, parentCode: '6000' },
];

function normalBalance(type) {
  switch (type) {
    case 'asset':
    case 'cogs':
    case 'expense':
    case 'contra_revenue':
      return 'debit';
    case 'liability':
    case 'equity':
    case 'revenue':
      return 'credit';
    default:
      return 'debit';
  }
}

/**
 * Validates the COA before it is used as a ledger lookup table. A duplicate or
 * malformed code must fail closed; Map-based lookups otherwise silently pick
 * one of the duplicate definitions and can reinterpret historical entries.
 */
function validateChartOfAccounts(accounts) {
  if (!Array.isArray(accounts) || accounts.length === 0) {
    throw new Error('طرح حساب‌ها (COA) خالی یا نامعتبر است.');
  }

  const byCode = new Map();
  accounts.forEach((account, index) => {
    if (!account || typeof account !== 'object' || Array.isArray(account)) {
      throw new Error(`ردیف ${index + 1} طرح حساب‌ها معتبر نیست.`);
    }
    const code = String(account.code ?? '').trim();
    if (!code) throw new Error(`کد حساب در ردیف ${index + 1} خالی است.`);
    if (byCode.has(code)) throw new Error(`کد حساب «${code}» در طرح حساب‌ها تکراری است.`);
    const type = String(account.type ?? '').trim();
    if (!ACCOUNT_TYPES.has(type)) throw new Error(`نوع حساب «${type || 'نامشخص'}» برای کد ${code} معتبر نیست.`);
    if (typeof account.isPostingAccount !== 'boolean') {
      throw new Error(`فیلد قابل ثبت مستقیم برای حساب ${code} باید بولی باشد.`);
    }
    byCode.set(code, account);
  });

  accounts.forEach((account) => {
    const code = String(account.code).trim();
    const parentCode = String(account.parentCode ?? '').trim();
    if (!parentCode) return;
    const parent = byCode.get(parentCode);
    if (!parent) throw new Error(`حساب والد ${parentCode} برای ${code} در COA یافت نشد.`);
    if (parentCode === code) throw new Error(`حساب ${code} نمی‌تواند والد خودش باشد.`);
    if (parent.isPostingAccount !== false) throw new Error(`حساب ${parentCode} باید حساب والد و غیرقابل ثبت مستقیم باشد.`);

    const visited = new Set([code]);
    let cursor = parent;
    while (cursor) {
      const cursorCode = String(cursor.code).trim();
      if (visited.has(cursorCode)) throw new Error(`چرخه در سلسله‌مراتب COA برای حساب ${code} شناسایی شد.`);
      visited.add(cursorCode);
      const nextCode = String(cursor.parentCode ?? '').trim();
      cursor = nextCode ? byCode.get(nextCode) : null;
    }
  });
  return true;
}

// ── State Initialization & Schema Migration ──────────────────────────────────
function ensureAccountingData(db, options = {}) {
  if (!db.accounting || typeof db.accounting !== 'object') {
    db.accounting = {};
  }
  const acc = db.accounting;

  if (!Array.isArray(acc.accounts) || acc.accounts.length === 0) {
    acc.accounts = JSON.parse(JSON.stringify(DEFAULT_COA));
  } else {
    acc.accounts.forEach((account) => {
      if (account && typeof account === 'object') {
        if (account.code !== null && account.code !== undefined) account.code = String(account.code).trim();
        if (account.parentCode !== null && account.parentCode !== undefined) account.parentCode = String(account.parentCode).trim();
      }
    });
    const existingCodes = new Set(acc.accounts.map((a) => String(a?.code ?? '').trim()));
    DEFAULT_COA.forEach((def) => {
      if (!existingCodes.has(def.code)) {
        acc.accounts.push({ ...def });
      }
    });
  }
  if (!Array.isArray(acc.journalEntries)) acc.journalEntries = [];
  if (!Array.isArray(acc.cashDrawers)) acc.cashDrawers = [];
  if (!Array.isArray(acc.settlements)) acc.settlements = [];
  if (!Array.isArray(acc.vendors)) acc.vendors = [];
  if (!Array.isArray(acc.vendorBills)) acc.vendorBills = [];
  if (!Array.isArray(acc.customerAccounts)) acc.customerAccounts = [];
  if (!Array.isArray(acc.expenses)) acc.expenses = [];
  if (!Array.isArray(acc.pettyCash)) acc.pettyCash = [];
  if (!Array.isArray(acc.fixedAssets)) acc.fixedAssets = [];
  if (!Array.isArray(acc.fiscalPeriods)) acc.fiscalPeriods = [];
  if (!Array.isArray(acc.giftCards)) acc.giftCards = [];
  if (!Array.isArray(acc.journalTemplates)) acc.journalTemplates = [];
  if (!Array.isArray(acc.recurringExpenses)) acc.recurringExpenses = [];
  if (!Array.isArray(acc.reimbursements)) acc.reimbursements = [];
  if (!Array.isArray(acc.payrollRuns)) acc.payrollRuns = [];

  validateChartOfAccounts(acc.accounts);

  // Ensure submodules structures
  periodService.ensurePeriods(acc);
  taxEngine.ensureTaxSettings(acc);
  inventoryEngine.ensureInventory(acc);
  assetEngine.ensureAssets(acc);
  approvalEngine.ensureApprovals(acc);
  accrualEngine.ensureAccruals(acc);
  procurementEngine.ensureProcurement(acc);
  reconciliationEngine.ensureReconciliation(acc);
  payrollEngine.ensurePayroll(acc);

  if (!acc.settings || typeof acc.settings !== 'object') {
    acc.settings = {
      vatRatePct: 10,
      autoPostOrders: true,
      defaultCashAccount: '1110',
      defaultPosAccount: '1320',
      defaultOnlineAccount: '1310',
      defaultVatAccount: '2210',
      defaultSalesAccount: '4110',
      defaultCogsAccount: '5100',
      defaultInventoryAccount: '1610',
      defaultBankAccountId: '1210',
      currency: 'تومان',
    };
  }

  // Demo fixtures are opt-in only. Production/runtime initialization must
  // never manufacture vendors, assets, or fiscal periods for official reports.
  const seedDemo = options.seedDemo === true || process.env.WESTO_ACCOUNTING_DEMO_SEED === 'true';
  if (seedDemo && acc.vendors.length === 0) {
    acc.vendors = [
      { id: 'v-1', name: 'تأمین لبنیات و پنیر میهن', nameFa: 'شرکت لبنیات میهن', phone: '02188880001', category: 'مواد اولیه غذایی', termsDays: 30, balance: 4500000 },
      { id: 'v-2', name: 'بازرگانی دانه‌های قهوه آریا', nameFa: 'بازرگانی قهوه آریا', phone: '02188880002', category: 'قهوه و بار گرم', termsDays: 15, balance: 12800000 },
      { id: 'v-3', name: 'صنایع بسته‌بندی سبز', nameFa: 'صنایع بسته‌بندی سبز', phone: '02188880003', category: 'ظروف بیرون‌بر', termsDays: 45, balance: 2100000 },
    ];
  }

  if (seedDemo && acc.fixedAssets.length === 0) {
    acc.fixedAssets = [
      { id: 'fa-1', assetCode: 'AST-101', name: 'دستگاه اسپرسوساز لامارزوکو ۳ گروپ', category: 'تجهیزات بار', purchaseDate: '2025-01-01', purchaseCost: 450000000, salvageValue: 50000000, usefulLifeMonths: 60, accumulatedDepreciation: 70000000, status: 'active' },
      { id: 'fa-2', assetCode: 'AST-102', name: 'فر پخت ترکیبی رشنال ۱۰ سینی', category: 'تجهیزات آشپزخانه', purchaseDate: '2025-01-15', purchaseCost: 620000000, salvageValue: 80000000, usefulLifeMonths: 84, accumulatedDepreciation: 75000000, status: 'active' },
      { id: 'fa-3', assetCode: 'AST-103', name: 'یخچال پرده هوا و سلف‌سرویس ۲ متری', category: 'تجهیزات برودتی', purchaseDate: '2025-02-01', purchaseCost: 180000000, salvageValue: 20000000, usefulLifeMonths: 60, accumulatedDepreciation: 26000000, status: 'active' },
      { id: 'fa-4', assetCode: 'AST-104', name: 'مجموعه صندوق‌های لمسی و شبکه', category: 'تجهیزات دیجیتال', purchaseDate: '2025-03-01', purchaseCost: 85000000, salvageValue: 5000000, usefulLifeMonths: 36, accumulatedDepreciation: 22000000, status: 'active' },
    ];
  }

  if (seedDemo && acc.fiscalPeriods.length === 0) {
    const currentYear = new Date().getFullYear();
    acc.fiscalPeriods = [
      { id: 'p-1', name: 'دوره ماهانه فروردین ۱۴۰۵', startDate: `${currentYear}-03-21`, endDate: `${currentYear}-04-20`, status: 'closed' },
      { id: 'p-2', name: 'دوره ماهانه اردیبهشت ۱۴۰۵', startDate: `${currentYear}-04-21`, endDate: `${currentYear}-05-21`, status: 'closed' },
      { id: 'p-3', name: 'دوره ماهانه خرداد ۱۴۰۵', startDate: `${currentYear}-05-22`, endDate: `${currentYear}-06-21`, status: 'open' },
    ];
  }

  return acc;
}

// ── Journal Voucher Generation Helpers ───────────────────────────────────────
function nextJournalNumber(acc, prefix = 'JE') {
  const count = (acc.journalEntries || []).length + 1;
  return `${prefix}-${String(count).padStart(5, '0')}`;
}

function roundMoney(val) {
  return money.toIRR(val);
}

function integerJournalMoney(val) {
  return money.toIntegerIRR(val);
}

function normalizeJournalBranchId(value, lineIndex) {
  if (value === null || value === undefined || value === '') return null;
  const branchId = Number(value);
  if (!Number.isSafeInteger(branchId) || branchId <= 0) {
    throw new Error(`شناسه شعبه در ردیف ${lineIndex + 1} معتبر نیست.`);
  }
  return branchId;
}

function cloneJournalEntry(entry, extra = {}) {
  return { ...JSON.parse(JSON.stringify(entry)), ...extra };
}

function sameJournalPayload(left, right) {
  return left.number === right.number
    && left.date === right.date
    && left.description === right.description
    && left.source === right.source
    && left.sourceId === right.sourceId
    && left.status === right.status
    && left.totalAmount === right.totalAmount
    && JSON.stringify(left.lines || []) === JSON.stringify(right.lines || []);
}

/**
 * Validates and posts a Journal Entry.
 * Checks period-lock, enforces DR=CR balance, and applies SHA-256 integrity hash chaining.
 */
function postJournalEntry(db, entryInput) {
  if (!entryInput || typeof entryInput !== 'object' || Array.isArray(entryInput)) {
    throw new TypeError('اطلاعات سند حسابداری معتبر نیست.');
  }
  const acc = ensureAccountingData(db);
  const requestedStatus = entryInput.status === undefined ? 'posted' : String(entryInput.status).toLowerCase();
  if (!['draft', 'posted'].includes(requestedStatus)) {
    throw new Error('وضعیت سند فقط می‌تواند draft یا posted باشد.');
  }

  const dateStr = entryInput.date || new Date().toISOString();
  if (Number.isNaN(new Date(dateStr).getTime())) {
    throw new Error('تاریخ سند معتبر نیست.');
  }
  if (requestedStatus === 'posted') {
    const periodCheck = periodService.assertPostingAllowed(acc, dateStr);
    if (!periodCheck.allowed) {
      throw new Error(periodCheck.reason || 'ثبت سند در این تاریخ به دلیل بسته بودن دوره مالی مجاز نیست.');
    }
  }

  const lines = Array.isArray(entryInput.lines) ? entryInput.lines : [];
  if (lines.length < 2) {
    throw new Error('هر سند حسابداری باید حداقل شامل دو ردیف بدهکار و بستانکار باشد.');
  }

  let totalDebit = 0;
  let totalCredit = 0;
  const accountsMap = new Map((acc.accounts || []).map((a) => [a.code, a]));

  const sanitizedLines = lines.map((line, idx) => {
    const code = String(line.accountCode || '').trim();
    const account = accountsMap.get(code);
    if (!account) {
      throw new Error(`کد حساب ${code} در ردیف ${idx + 1} در طرح حساب‌ها (COA) تعریف نشده است.`);
    }
    if (account.isPostingAccount === false) {
      throw new Error(`حساب ${code} در ردیف ${idx + 1} حساب کل/والد است و قابل ثبت مستقیم نیست.`);
    }
    const debit = integerJournalMoney(line.debit);
    const credit = integerJournalMoney(line.credit);
    if (debit < 0 || credit < 0) {
      throw new Error(`مبالغ ردیف ${idx + 1} نمی‌تواند منفی باشد.`);
    }
    if (debit === 0 && credit === 0) {
      throw new Error(`در ردیف ${idx + 1} حداقل باید یکی از فیلدهای بدهکار یا بستانکار مقدار داشته باشد.`);
    }
    if (debit > 0 && credit > 0) {
      throw new Error(`در ردیف ${idx + 1} یک ردیف نمی‌تواند همزمان بدهکار و بستانکار باشد.`);
    }
    totalDebit = money.addMoney(totalDebit, debit);
    totalCredit = money.addMoney(totalCredit, credit);
    return {
      accountCode: code,
      accountName: account.nameFa || account.name,
      debit,
      credit,
      memo: String(line.memo || '').slice(0, 300),
      branchId: normalizeJournalBranchId(line.branchId, idx),
    };
  });

  if (totalDebit !== totalCredit) {
    throw new Error(`سند تراز نیست! جمع بدهکار (${money.formatNumber(totalDebit)}) با جمع بستانکار (${money.formatNumber(totalCredit)}) برابر نیست. اختلاف: ${money.formatNumber(Math.abs(totalDebit - totalCredit))}`);
  }

  const id = entryInput.id === undefined || entryInput.id === null || entryInput.id === ''
    ? `je-${Date.now()}-${Math.random().toString(36).slice(2, 7)}` : String(entryInput.id);
  const number = entryInput.number === undefined || entryInput.number === null || entryInput.number === ''
    ? nextJournalNumber(acc) : String(entryInput.number);
  const source = String(entryInput.source || 'manual').trim() || 'manual';
  const sourceId = entryInput.sourceId === undefined || entryInput.sourceId === null || entryInput.sourceId === ''
    ? null : String(entryInput.sourceId);

  const existingIdx = acc.journalEntries.findIndex((e) => e.id === id
    || (sourceId !== null && e.source === source && String(e.sourceId) === sourceId));
  const existing = existingIdx >= 0 ? acc.journalEntries[existingIdx] : null;

  const ledgerChain = acc.journalEntries.length > 0 ? auditEngine.verifyLedgerChain(acc) : null;
  if (ledgerChain && !ledgerChain.isIntegrityValid) {
    throw new Error('زنجیره دفترکل معتبر نیست؛ تا بررسی و اصلاح مغایرت، سند جدید ثبت نمی‌شود.');
  }

  const predecessorIndex = existingIdx >= 0 ? existingIdx - 1 : acc.journalEntries.length - 1;
  const predecessorAudit = predecessorIndex >= 0 ? ledgerChain?.chainAudit?.[predecessorIndex] : null;
  const previousHash = predecessorIndex < 0
    ? auditEngine.GENESIS_HASH
    : predecessorAudit?.hashPresent
      ? acc.journalEntries[predecessorIndex].hash
      : predecessorAudit?.calculatedHash;
  if (!previousHash) {
    throw new Error('hash قبلی سند حسابداری قابل بازیابی نیست؛ ثبت سند متوقف شد.');
  }

  const entry = {
    id,
    number,
    date: dateStr,
    description: String(entryInput.description || 'ثبت سند حسابداری').slice(0, 250),
    source,
    sourceId,
    status: requestedStatus,
    totalAmount: totalDebit,
    lines: sanitizedLines,
    previousHash,
    createdAt: existing?.createdAt || new Date().toISOString(),
    createdById: entryInput.createdById || 'admin',
  };

  if (existing && existing.status === 'posted') {
    if (sameJournalPayload(existing, entry)) {
      return cloneJournalEntry(existing, { idempotentReplay: true });
    }
    throw new Error(`سند حسابداری شماره «${existing.number}» قطعی (POSTED) شده و طبق استانداردها غیرقابل ویرایش مستقیم است. برای اصلاح از ثبت سند معکوس (Reversal) استفاده کنید.`);
  }
  if (existing && existing.status !== 'draft') {
    throw new Error('فقط سند draft قابل تکمیل یا اصلاح است.');
  }
  if (existing && existingIdx !== acc.journalEntries.length - 1 && !sameJournalPayload(existing, entry)) {
    throw new Error('سند draft غیرانتهایی قابل تغییر نیست؛ برای حفظ استقلال زنجیره ابتدا آن را تعیین تکلیف کنید.');
  }
  if (existing && existingIdx !== acc.journalEntries.length - 1 && requestedStatus === 'posted') {
    throw new Error('سند draft غیرانتهایی قابل قطعی‌سازی نیست؛ برای حفظ استقلال زنجیره ابتدا آن را تعیین تکلیف کنید.');
  }
  if (existing && existingIdx !== acc.journalEntries.length - 1 && sameJournalPayload(existing, entry)) {
    return cloneJournalEntry(existing, { idempotentReplay: true });
  }

  const duplicateNumber = acc.journalEntries.find((candidate, index) => candidate.number === number && index !== existingIdx);
  if (duplicateNumber) throw new Error(`شماره سند «${number}» قبلاً استفاده شده است.`);

  entry.hash = auditEngine.computeJournalHash(entry, previousHash);

  if (existingIdx >= 0) {
    acc.journalEntries[existingIdx] = entry;
  } else {
    acc.journalEntries.push(entry);
  }

  auditEngine.recordAuditLog(acc, {
    action: 'POST_JOURNAL',
    entityType: 'JournalEntry',
    entityId: entry.id,
    userId: entry.createdById,
    message: `سند حسابداری شماره ${entry.number} به مبلغ ${money.formatNumber(totalDebit)} ثبت گردید.`,
    metadata: { number: entry.number, totalAmount: totalDebit, linesCount: sanitizedLines.length },
  });

  return cloneJournalEntry(entry);
}

/**
 * Reverses a posted Journal Entry by posting an inverted counter-entry.
 * Preserves full audit trail and immutable hash chain.
 */
function reverseJournalEntry(db, journalId, opts = {}) {
  const acc = ensureAccountingData(db);
  const ledgerChain = auditEngine.verifyLedgerChain(acc);
  if (!ledgerChain.isIntegrityValid) {
    throw new Error('زنجیره دفترکل معتبر نیست؛ معکوس‌سازی متوقف شد.');
  }
  const { reason = 'اصلاح سند', userId = 'admin', reversalDate = new Date().toISOString() } = opts;

  const target = (acc.journalEntries || []).find((e) => e.id === journalId || e.number === journalId);
  if (!target) {
    throw new Error('سند حسابداری جهت معکوس‌سازی یافت نشد.');
  }

  const existingReversal = (acc.journalEntries || []).find((entry) => entry.source === 'reversal' && entry.sourceId === target.id);
  if (existingReversal) {
    if (target.status !== 'reversed') {
      target.status = 'reversed';
      target.reversedAt = existingReversal.createdAt;
      target.reversedBy = existingReversal.createdById;
      target.reversalReason = reason;
      target.reversalJournalId = existingReversal.id;
      target.reversalJournalNumber = existingReversal.number;
    }
    return {
      ok: true,
      idempotentReplay: true,
      originalEntry: cloneJournalEntry(target),
      reversalEntry: cloneJournalEntry(existingReversal),
    };
  }
  if (target.status === 'reversed') {
    throw new Error(`این سند قبلاً معکوس شده است، اما سند معکوس متناظر یافت نشد.`);
  }
  if (target.status !== 'posted') {
    throw new Error('فقط سند posted قابل معکوس‌سازی است؛ draft ابتدا باید قطعی شود.');
  }
  if (target.source === 'reversal' || target.reversalOfId || target.reversalJournalId) {
    throw new Error('سند معکوس قابل معکوس‌سازی مجدد نیست.');
  }

  // Generate inverted lines: Debits become Credits, Credits become Debits
  const invertedLines = (target.lines || []).map((l) => ({
    accountCode: l.accountCode,
    accountName: l.accountName,
    debit: l.credit,
    credit: l.debit,
    memo: `[برگشت سند ${target.number}] ${l.memo || ''}`.slice(0, 300),
    branchId: l.branchId,
  }));

  const reversalEntry = postJournalEntry(db, {
    source: 'reversal',
    sourceId: target.id,
    date: reversalDate,
    description: `سند معکوس / خنثی‌کننده سند شماره ${target.number}${reason ? ': ' + reason : ''}`,
    lines: invertedLines,
    createdById: userId,
  });

  // Mark original entry as reversed
  target.status = 'reversed';
  target.reversedAt = new Date().toISOString();
  target.reversedBy = userId;
  target.reversalReason = reason;
  target.reversalJournalId = reversalEntry.id;
  target.reversalJournalNumber = reversalEntry.number;

  auditEngine.recordAuditLog(acc, {
    action: 'REVERSE_JOURNAL',
    entityType: 'JournalEntry',
    entityId: target.id,
    userId,
    message: `سند شماره ${target.number} توسط سند معکوس ${reversalEntry.number} باطل و خنثی گردید. علت: ${reason}`,
  });

  return { ok: true, idempotentReplay: false, originalEntry: cloneJournalEntry(target), reversalEntry: cloneJournalEntry(reversalEntry) };
}

// ── Automatic Sales Posting ──────────────────────────────────────────────────
/**
 * Automatically creates/updates a balanced double-entry Journal Voucher from a paid Order.
 */
function syncOrderSalesJournal(db, order) {
  if (!order || !order.id) return null;
  const isPaid = order.paymentStatus === 'paid' || ['paid', 'preparing', 'ready', 'dispatched', 'picked_up', 'delivered', 'done'].includes(order.status);
  if (!isPaid) return null;

  const acc = ensureAccountingData(db);
  const settings = acc.settings || {};
  if (settings.autoPostOrders === false) return null;

  const orderTotal = roundMoney(order.total || 0);
  if (orderTotal <= 0) return null;

  const orderDate = order.createdAt || new Date().toISOString();
  const taxCalc = taxEngine.calculateTax(acc.taxSettings, order.items || [{ price: orderTotal, qty: 1 }], {
    date: orderDate,
    fulfillmentType: order.fulfillment || null,
    globalDiscount: order.discount || 0,
  });

  const netSales = taxCalc.totalTaxableBase || roundMoney(orderTotal / 1.10);
  const totalTax = taxCalc.totalTax || (orderTotal - netSales);
  const discountTotal = taxCalc.totalDiscounts || roundMoney(order.discount || 0);
  const grossSales = netSales + discountTotal;

  // Determine debit account based on payment method and channel
  let debitAccountCode = settings.defaultPosAccount || '1320';
  let tenderMemo = 'کارتخوان';
  const method = String(order.paymentMethod || '').toLowerCase();
  const channel = String(order.fulfillment || order.channel || '').toLowerCase();

  if (method === 'cash') {
    debitAccountCode = settings.defaultCashAccount || '1110';
    tenderMemo = 'نقدی';
  } else if (method === 'online' || method === 'gateway' || method === 'zarinpal' || method === 'psp') {
    debitAccountCode = settings.defaultOnlineAccount || '1310';
    tenderMemo = 'درگاه آنلاین';
  } else if (method === 'wallet' || method === 'customer_wallet' || method === 'user_wallet') {
    debitAccountCode = settings.defaultWalletAccount || '2500';
    tenderMemo = 'کیف پول و پیش‌دریافت';
  } else if (method === 'credit' || method === 'staff_credit' || method === 'customer_credit' || method === 'vip') {
    debitAccountCode = settings.defaultCreditAccount || '1510';
    tenderMemo = 'حساب اعتباری مشتری';
  } else if (method === 'snappfood' || channel === 'snappfood') {
    debitAccountCode = '1410';
    tenderMemo = 'اسنپ‌فود';
  } else if (method === 'tapsifood' || method === 'tapsi' || channel === 'tapsifood' || channel === 'tapsi') {
    debitAccountCode = '1420';
    tenderMemo = 'تپسی‌فود';
  }

  // Determine credit account based on fulfillment channel
  let creditAccountCode = settings.defaultSalesAccount || '4110';
  if (order.fulfillment === 'pickup') creditAccountCode = '4120';
  else if (order.fulfillment === 'delivery') creditAccountCode = '4130';

  const orderNo = order.orderNo || `#${order.id}`;
  const lines = [
    {
      accountCode: debitAccountCode,
      debit: orderTotal,
      credit: 0,
      memo: `دریافت وجه سفارش ${orderNo} (${tenderMemo})`,
      branchId: order.branchId,
    },
    ...(discountTotal > 0 ? [{
      accountCode: '4910', // Promotional Discounts
      debit: discountTotal,
      credit: 0,
      memo: `تخفیف اعطایی سفارش ${orderNo}`,
      branchId: order.branchId,
    }] : []),
    {
      accountCode: creditAccountCode,
      debit: 0,
      credit: grossSales,
      memo: `درآمد فروش ناخالص سفارش ${orderNo}`,
      branchId: order.branchId,
    },
    {
      accountCode: settings.defaultVatAccount || '2210',
      debit: 0,
      credit: totalTax,
      memo: `مالیات ارزش افزوده سفارش ${orderNo} (مأخذ: ${money.formatNumber(netSales)})`,
      branchId: order.branchId,
    },
  ];

  try {
    return postJournalEntry(db, {
      source: 'sale',
      sourceId: String(order.id),
      date: order.createdAt || new Date().toISOString(),
      description: `ثبت فروش خودکار سفارش ${orderNo}`,
      lines,
    });
  } catch (err) {
    console.error(`[accounting] auto post failed for order ${order.id}:`, err.message);
    return null;
  }
}

/**
 * Rebuilds all double-entry ledger vouchers from all paid orders in history.
 */
function rebuildLedgerFromOrders(db) {
  const orders = Array.isArray(db.orders) ? db.orders : [];
  let count = 0;
  for (const order of orders) {
    const res = syncOrderSalesJournal(db, order);
    if (res) count++;
  }
  return count;
}

// ── Financial Reports & Calculations ─────────────────────────────────────────

function getAccountBalanceMap(acc, filter = {}) {
  const ledgerChain = auditEngine.verifyLedgerChain(acc);
  if (!ledgerChain.isIntegrityValid) {
    throw new Error('زنجیره دفترکل معتبر نیست؛ گزارش تراز متوقف شد.');
  }
  const map = new Map();
  (acc.accounts || []).forEach((a) => {
    map.set(a.code, {
      account: a,
      debitSum: 0,
      creditSum: 0,
      net: 0,
      lines: [],
    });
  });

  const entries = (acc.journalEntries || []).filter((e) => {
    if (e.status !== 'posted') return false;
    if (filter.from && new Date(e.date) < new Date(filter.from)) return false;
    if (filter.to && new Date(e.date) > new Date(filter.to)) return false;
    return true;
  });

  for (const entry of entries) {
    for (const line of entry.lines || []) {
      const lineBranchId = line.branchId ?? entry.branchId ?? null;
      if (filter.branchId != null && Number(lineBranchId) !== Number(filter.branchId)) continue;
      const target = map.get(line.accountCode);
      if (target) {
        target.debitSum += line.debit;
        target.creditSum += line.credit;
        target.lines.push({
          entryId: entry.id,
          number: entry.number,
          date: entry.date,
          description: entry.description,
          source: entry.source,
          debit: line.debit,
          credit: line.credit,
          memo: line.memo,
        });
      }
    }
  }

  // Calculate net balances based on normal balance convention
  for (const [, item] of map.entries()) {
    const norm = normalBalance(item.account.type);
    if (norm === 'debit') {
      item.net = item.debitSum - item.creditSum;
    } else {
      item.net = item.creditSum - item.debitSum;
    }
  }

  return map;
}

function getOverview(db, filter = {}) {
  const acc = ensureAccountingData(db);
  const balanceMap = getAccountBalanceMap(acc, filter);
  const branchId = filter.branchId == null ? null : Number(filter.branchId);
  const belongsToBranch = (row) => {
    if (branchId == null) return true;
    const ownBranchId = row?.branchId ?? row?.locationId;
    if (ownBranchId != null) return Number(ownBranchId) === branchId;
    const lineBranches = (row?.lines || [])
      .map((line) => line?.branchId ?? row?.branchId)
      .filter((value) => value != null);
    return lineBranches.length > 0 && lineBranches.every((value) => Number(value) === branchId);
  };

  let totalRevenue = 0;
  let totalDiscounts = 0;
  let totalCogs = 0;
  let totalOpex = 0;
  let totalCash = 0;
  let totalBank = 0;
  let totalAR = 0;
  let totalAP = 0;
  let totalAssets = 0;
  let totalLiabilities = 0;
  let totalEquity = 0;

  for (const [, item] of balanceMap.entries()) {
    const type = item.account.type;
    const net = item.net;

    if (type === 'revenue') totalRevenue += net;
    else if (type === 'contra_revenue') totalDiscounts += net;
    else if (type === 'cogs') totalCogs += net;
    else if (type === 'expense') totalOpex += net;
    else if (type === 'asset') {
      totalAssets += net;
      if (item.account.subtype === 'cash') totalCash += net;
      if (item.account.subtype === 'bank') totalBank += net;
      if (item.account.subtype === 'receivable') totalAR += net;
    } else if (type === 'liability') {
      totalLiabilities += net;
      if (item.account.subtype === 'payable') totalAP += net;
    } else if (type === 'equity') {
      totalEquity += net;
    }
  }

  const netSales = Math.max(0, totalRevenue - totalDiscounts);
  const grossProfit = netSales - totalCogs;
  const netIncome = grossProfit - totalOpex;
  const grossMarginPct = netSales > 0 ? Math.round((grossProfit / netSales) * 100) : 0;
  const netMarginPct = netSales > 0 ? Math.round((netIncome / netSales) * 100) : 0;

  const activeCashDrawers = (acc.cashDrawers || []).filter((d) => d.status === 'open' && belongsToBranch(d));
  const recentEntries = (acc.journalEntries || []).filter(belongsToBranch).slice().reverse().slice(0, 15);
  const pendingBills = (acc.vendorBills || []).filter((b) => belongsToBranch(b) && (b.status === 'open' || b.status === 'partial'));

  return {
    metrics: {
      totalRevenue,
      netSales,
      totalDiscounts,
      totalCogs,
      grossProfit,
      grossMarginPct,
      totalOpex,
      netIncome,
      netMarginPct,
      totalCash,
      totalBank,
      totalLiquidFunds: totalCash + totalBank,
      totalAR,
      totalAP,
      totalAssets,
      totalLiabilities,
      totalEquity,
      activeDrawersCount: activeCashDrawers.length,
      pendingBillsCount: pendingBills.length,
      totalJournalEntries: (acc.journalEntries || []).filter(belongsToBranch).length,
    },
    recentEntries,
    settings: acc.settings,
    generatedAt: new Date().toISOString(),
  };
}

function getSalesAnalysis(db, filter = {}) {
  const orders = Array.isArray(db.orders) ? db.orders : [];
  const branchId = filter.branchId == null ? null : Number(filter.branchId);
  const fromAt = filter.from ? new Date(filter.from).getTime() : null;
  const toAt = filter.to ? new Date(filter.to).getTime() : null;
  const paidOrders = orders.filter((o) => {
    if (branchId != null && Number(o.branchId) !== branchId) return false;
    if (Number.isFinite(fromAt) && new Date(o.paidAt || o.createdAt || o.date || 0).getTime() < fromAt) return false;
    if (Number.isFinite(toAt) && new Date(o.paidAt || o.createdAt || o.date || 0).getTime() > toAt) return false;
    return o.paymentStatus === 'paid' || ['paid', 'preparing', 'ready', 'dispatched', 'picked_up', 'delivered', 'done'].includes(o.status);
  });

  let totalSales = 0;
  const byChannel = { dine_in: 0, pickup: 0, delivery: 0 };
  const byMethod = { cash: 0, card: 0, online: 0, other: 0 };
  const byCategory = {};

  for (const order of paidOrders) {
    const total = roundMoney(order.total || 0);
    totalSales += total;

    const channel = order.fulfillment || 'dine_in';
    byChannel[channel] = (byChannel[channel] || 0) + total;

    const method = order.paymentMethod || 'card';
    if (byMethod[method] !== undefined) byMethod[method] += total;
    else byMethod.other += total;

    for (const item of order.items || []) {
      const cat = item.categoryTitle || 'عمومی';
      byCategory[cat] = (byCategory[cat] || 0) + roundMoney(item.lineTotal || (item.price * item.qty) || 0);
    }
  }

  const acc = ensureAccountingData(db);
  const vatRate = (acc.settings?.vatRatePct ?? 10) / 100;
  const netSales = vatRate > 0 ? Math.round(totalSales / (1 + vatRate)) : totalSales;
  const totalTax = totalSales - netSales;

  return {
    totalSales,
    totalTax,
    netSales,
    orderCount: paidOrders.length,
    averageOrderValue: paidOrders.length ? Math.round(totalSales / paidOrders.length) : 0,
    byChannel,
    byMethod,
    byCategory: Object.entries(byCategory).map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount),
  };
}

function getTrialBalanceReport(db, asOfDate = new Date().toISOString(), filter = {}) {
  const acc = ensureAccountingData(db);
  const balanceMap = getAccountBalanceMap(acc, { ...filter, to: asOfDate });

  let totalDebit = 0;
  let totalCredit = 0;
  const rows = [];

  for (const [, item] of balanceMap.entries()) {
    if (item.debitSum === 0 && item.creditSum === 0 && !item.account.isPostingAccount) continue;
    if (item.debitSum === 0 && item.creditSum === 0) continue;

    const norm = normalBalance(item.account.type);
    let closingDebit = 0;
    let closingCredit = 0;

    if (norm === 'debit') {
      if (item.net >= 0) closingDebit = item.net;
      else closingCredit = Math.abs(item.net);
    } else {
      if (item.net >= 0) closingCredit = item.net;
      else closingDebit = Math.abs(item.net);
    }

    totalDebit += closingDebit;
    totalCredit += closingCredit;

    rows.push({
      code: item.account.code,
      nameFa: item.account.nameFa || item.account.name,
      type: item.account.type,
      subtype: item.account.subtype,
      normalBalance: norm,
      debitTurnover: item.debitSum,
      creditTurnover: item.creditSum,
      closingDebit,
      closingCredit,
    });
  }

  rows.sort((a, b) => a.code.localeCompare(b.code));

  return {
    asOf: asOfDate,
    rows,
    totalDebit,
    totalCredit,
    isBalanced: totalDebit === totalCredit,
    discrepancy: Math.abs(totalDebit - totalCredit),
  };
}

function getIncomeStatement(db, from, to, filter = {}) {
  const acc = ensureAccountingData(db);
  const balanceMap = getAccountBalanceMap(acc, { ...filter, from, to });

  const getSectionAccounts = (filterFn) => {
    const list = [];
    let sum = 0;
    for (const [, item] of balanceMap.entries()) {
      if (filterFn(item.account) && item.net !== 0) {
        const netAmount = item.net;
        list.push({
          code: item.account.code,
          nameFa: item.account.nameFa || item.account.name,
          amount: Math.abs(netAmount),
        });
        sum += netAmount;
      }
    }
    return { accounts: list.sort((a, b) => b.amount - a.amount), total: Math.max(0, sum) };
  };

  const revenue = getSectionAccounts((a) => a.type === 'revenue');
  const discounts = getSectionAccounts((a) => a.type === 'contra_revenue');
  const cogs = getSectionAccounts((a) => a.type === 'cogs');
  const labor = getSectionAccounts((a) => a.type === 'expense' && a.code.startsWith('61'));
  const opex = getSectionAccounts((a) => a.type === 'expense' && !a.code.startsWith('61'));

  const netSales = Math.max(0, revenue.total - discounts.total);
  const grossProfit = netSales - cogs.total;
  const primeCost = cogs.total + labor.total;
  const operatingProfit = grossProfit - labor.total - opex.total;
  const netIncome = operatingProfit;

  return {
    period: { from, to },
    revenue,
    discounts,
    netSales,
    cogs,
    grossProfit,
    grossMarginPct: netSales ? Number(((grossProfit / netSales) * 100).toFixed(1)) : 0,
    labor,
    primeCost,
    primeCostPct: netSales ? Number(((primeCost / netSales) * 100).toFixed(1)) : 0,
    foodCostPct: netSales ? Number(((cogs.total / netSales) * 100).toFixed(1)) : 0,
    laborCostPct: netSales ? Number(((labor.total / netSales) * 100).toFixed(1)) : 0,
    opex,
    operatingProfit,
    netIncome,
    netMarginPct: netSales ? Number(((netIncome / netSales) * 100).toFixed(1)) : 0,
  };
}

function getBalanceSheet(db, asOfDate = new Date().toISOString(), filter = {}) {
  const acc = ensureAccountingData(db);
  const balanceMap = getAccountBalanceMap(acc, { ...filter, to: asOfDate });

  const getAccountsByType = (type) => {
    const list = [];
    let sum = 0;
    for (const [, item] of balanceMap.entries()) {
      if (item.account.type === type && item.net !== 0) {
        list.push({
          code: item.account.code,
          nameFa: item.account.nameFa || item.account.name,
          subtype: item.account.subtype,
          amount: item.net,
        });
        sum += item.net;
      }
    }
    return { accounts: list, total: sum };
  };

  const assets = getAccountsByType('asset');
  const liabilities = getAccountsByType('liability');
  const equity = getAccountsByType('equity');

  let totalRev = 0;
  let totalExp = 0;
  for (const [, item] of balanceMap.entries()) {
    if (item.account.type === 'revenue') totalRev += item.net;
    if (item.account.type === 'contra_revenue') totalRev -= item.net;
    if (item.account.type === 'cogs' || item.account.type === 'expense') totalExp += item.net;
  }
  const currentNetIncome = totalRev - totalExp;

  const adjustedEquityTotal = equity.total + currentNetIncome;
  const totalLiabAndEquity = liabilities.total + adjustedEquityTotal;

  return {
    asOf: asOfDate,
    assets,
    liabilities,
    equity: {
      accounts: [
        ...equity.accounts,
        { code: '3900', nameFa: 'سود (زیان) خالص انباشته دوره', amount: currentNetIncome },
      ],
      total: adjustedEquityTotal,
    },
    totalAssets: assets.total,
    totalLiabilities: liabilities.total,
    totalLiabAndEquity,
    isBalanced: assets.total === totalLiabAndEquity,
  };
}

function getCashFlowStatement(db, from, to, filter = {}) {
  const acc = ensureAccountingData(db);
  const branchId = filter.branchId == null ? null : Number(filter.branchId);
  const entries = (acc.journalEntries || []).filter(e => {
    if (e.status !== 'posted') return false;
    if (from && new Date(e.date) < new Date(from)) return false;
    if (to && new Date(e.date) > new Date(to)) return false;
    if (branchId != null) {
      const lines = (e.lines || []).map((line) => line?.branchId ?? e.branchId);
      if (!lines.length || !lines.some((value) => Number(value) === branchId)) return false;
    }
    return true;
  });

  let operatingInflows = 0;
  let operatingOutflows = 0;
  let investingOutflows = 0;
  let financingInflows = 0;

  entries.forEach(e => {
    (e.lines || []).forEach(l => {
      const lineBranchId = l.branchId ?? e.branchId ?? null;
      if (branchId != null && Number(lineBranchId) !== branchId) return;
      const accDef = (acc.accounts || []).find(a => a.code === l.accountCode);
      if (!accDef) return;

      if (accDef.subtype === 'cash' || accDef.subtype === 'bank') {
        if (l.debit > 0) {
          if (e.source === 'sale') operatingInflows += l.debit;
          else if (e.source === 'capital') financingInflows += l.debit;
          else operatingInflows += l.debit;
        }
        if (l.credit > 0) {
          if (e.source === 'asset_purchase') investingOutflows += l.credit;
          else operatingOutflows += l.credit;
        }
      }
    });
  });

  const netOperating = operatingInflows - operatingOutflows;
  const netInvesting = -investingOutflows;
  const netFinancing = financingInflows;
  const netChangeInCash = netOperating + netInvesting + netFinancing;

  return {
    period: { from, to },
    operating: {
      inflows: operatingInflows,
      outflows: operatingOutflows,
      net: netOperating,
    },
    investing: {
      outflows: investingOutflows,
      net: netInvesting,
    },
    financing: {
      inflows: financingInflows,
      net: netFinancing,
    },
    netChangeInCash,
    generatedAt: new Date().toISOString(),
  };
}

function getGeneralLedger(db, accountCode, filter = {}) {
  const acc = ensureAccountingData(db);
  const balanceMap = getAccountBalanceMap(acc, filter);
  const target = balanceMap.get(String(accountCode));

  if (!target) {
    throw new Error(`حساب با کد ${accountCode} یافت نشد.`);
  }

  let runningBalance = 0;
  const norm = normalBalance(target.account.type);

  const transactions = (target.lines || []).map((line) => {
    if (norm === 'debit') {
      runningBalance += line.debit - line.credit;
    } else {
      runningBalance += line.credit - line.debit;
    }
    return {
      ...line,
      runningBalance,
    };
  });

  return {
    account: target.account,
    normalBalance: norm,
    debitSum: target.debitSum,
    creditSum: target.creditSum,
    finalBalance: target.net,
    transactions,
  };
}

function getAPAging(db, asOfDate = new Date().toISOString(), filter = {}) {
  const acc = ensureAccountingData(db);
  const branchId = filter.branchId == null ? null : Number(filter.branchId);
  const bills = (acc.vendorBills || []).filter((b) => {
    if (b.status !== 'open' && b.status !== 'partial') return false;
    if (branchId == null) return true;
    const ownBranchId = b.branchId ?? b.locationId;
    return ownBranchId != null && Number(ownBranchId) === branchId;
  });
  const now = new Date(asOfDate).getTime();

  const buckets = {
    current: { label: 'جاری (سررسید نشده)', labelFa: 'جاری', amount: 0, count: 0 },
    days1_30: { label: '۱ تا ۳۰ روز معوق', labelFa: '۱-۳۰ روز', amount: 0, count: 0 },
    days31_60: { label: '۳۱ تا ۶۰ روز معوق', labelFa: '۳۱-۶۰ روز', amount: 0, count: 0 },
    days61_90: { label: '۶۱ تا ۹۰ روز معوق', labelFa: '۶۱-۹۰ روز', amount: 0, count: 0 },
    days90Plus: { label: 'بیش از ۹۰ روز معوق', labelFa: '+۹۰ روز', amount: 0, count: 0 },
  };

  const detailedBills = bills.map((bill) => {
    const dueDate = new Date(bill.dueDate).getTime();
    const daysPastDue = Math.floor((now - dueDate) / (1000 * 60 * 60 * 24));
    const balance = roundMoney(bill.balance || bill.total || 0);

    let bucketKey = 'current';
    if (daysPastDue > 90) bucketKey = 'days90Plus';
    else if (daysPastDue > 60) bucketKey = 'days61_90';
    else if (daysPastDue > 30) bucketKey = 'days31_60';
    else if (daysPastDue > 0) bucketKey = 'days1_30';

    buckets[bucketKey].amount += balance;
    buckets[bucketKey].count += 1;

    return {
      ...bill,
      daysPastDue: Math.max(0, daysPastDue),
      bucketKey,
    };
  });

  const total = Object.values(buckets).reduce((sum, b) => sum + b.amount, 0);

  return {
    asOf: asOfDate,
    total,
    buckets,
    bills: detailedBills.sort((a, b) => b.daysPastDue - a.daysPastDue),
  };
}

module.exports = {
  DEFAULT_COA,
  validateChartOfAccounts,
  ensureAccountingData,
  normalBalance,
  postJournalEntry,
  reverseJournalEntry,
  syncOrderSalesJournal,
  rebuildLedgerFromOrders,
  getOverview,
  getSalesAnalysis,
  getTrialBalanceReport,
  getIncomeStatement,
  getBalanceSheet,
  getCashFlowStatement,
  getGeneralLedger,
  getAPAging,
  calculateAndPostDepreciation: (db) => assetEngine.runDepreciation(ensureAccountingData(db), postJournalEntry, db),
  // Sub-engine direct exports
  money,
  periodService,
  taxEngine,
  inventoryEngine,
  assetEngine,
  approvalEngine,
  accrualEngine,
  procurementEngine,
  reconciliationEngine,
  predictiveEngine,
  consolidationEngine,
  auditEngine,
  aiEngine,
  salesPosEngine,
  taxpayerAdapter,
  payrollEngine,
  fnbCostOptimizer,
};
