'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const admin = read('admin.html');
const adminJs = read('js/admin.js');
const adminModuleRegistry = read('js/admin/modules/core/registry.js');
const catalogModule = read('js/admin/modules/catalog/menu-module.js');
const inventoryModule = read('js/admin/modules/inventory/inventory-module.js');
const insightsModule = read('js/admin/modules/insights/reports-module.js');
const shellJs = read('js/admin-professional-v4.js');
const themeJs = read('js/theme.js');
const vitalityCss = read('css/admin-vitality-v5.css');
const financeJs = read('js/admin-accounting.js');
const financeCss = read('css/admin-accounting.css');
const breakEvenChartJs = read('js/admin/modules/finance/break-even-chart.js');
const breakEvenChartCss = read('css/admin-break-even-chart.css');
const financeServer = read('server/finance-v2.js');
const adminV2 = read('server/admin-v2.js');

test('admin vitality system is the final visual layer and defaults to an isolated light theme', () => {
  const vitalityIndex = admin.indexOf('css/admin-vitality-v5.css');
  assert.ok(vitalityIndex > admin.indexOf('css/design-logic-v13.css'));
  assert.match(admin, /admin-vitality-v5\.css\?v=adminVitality\d+/);
  assert.match(themeJs, /IS_ADMIN\s*\?\s*'westo_admin_theme'\s*:\s*'westo_theme'/);
  assert.match(themeJs, /IS_ADMIN\s*\?\s*'light'\s*:\s*'system'/);
});

test('every visible admin destination still has a native renderer', () => {
  const tabs = [...admin.matchAll(/data-tab="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(tabs).size, 29);
  for (const tab of new Set(tabs)) {
    const owner = ['analytics', 'reports'].includes(tab) ? insightsModule : ['inventory', 'costControl', 'expenses'].includes(tab) ? inventoryModule : adminJs;
    if (['inventory', 'costControl', 'expenses'].includes(tab)) {
      assert.match(owner, new RegExp(`\\b${tab}\\b`), `missing renderer for ${tab}`);
    } else {
      assert.match(owner, new RegExp(`async\\s+${tab}\\s*\\(`), `missing renderer for ${tab}`);
    }
  }
});

test('admin feature modules are registered before the shell and keep explicit ownership', () => {
  assert.match(admin, /admin\/modules\/core\/registry\.js\?v=adminModules2/);
  assert.match(admin, /admin\/modules\/catalog\/menu-module\.js\?v=adminModules3-inventory/);
  assert.match(admin, /admin\/modules\/insights\/reports-module\.js\?v=adminModules2/);
  for (const modulePath of [
    'admin/modules/operations/operations-module.js',
    'admin/modules/finance/finance-module.js',
    'admin/modules/content/content-module.js',
    'admin/modules/settings/settings-module.js',
  ]) assert.match(admin, new RegExp(`${modulePath.replaceAll('/', '\\/')}\\?v=adminModules2`));
  assert.match(adminJs, /mountAdminModules\(\)/);
  assert.match(adminModuleRegistry, /WestoAdminModules/);
  assert.match(catalogModule, /id:\s*'catalog'/);
  assert.match(catalogModule, /'menu', 'products', 'prices', 'complements', 'translate', 'printmenu'/);
  assert.match(admin, /admin\/modules\/inventory\/inventory-module\.js\?v=inventoryV2-20260829-2/);
  assert.match(inventoryModule, /id:\s*'inventory'/);
  assert.match(inventoryModule, /'inventory', 'costControl', 'expenses'/);
  assert.match(catalogModule, /threeDMenu:\s*'js\/three-scene\.js'/);
  assert.match(insightsModule, /id:\s*'insights'/);
  assert.match(insightsModule, /async\s+analytics\s*\(/);
  assert.match(insightsModule, /async\s+reports\s*\(/);
});

test('admin settings expose real desktop installers without weakening the Electron shell', () => {
  assert.match(admin, /js\/admin\.js\?v=adminVitality20260830-break-even-official/);
  assert.match(adminJs, /api\('\/api\/admin\/v2\/desktop\/releases'/);
  assert.match(adminJs, /admin-desktop-release/);
  assert.match(adminV2, /desktop\/releases\/\:platform\/\:arch\/\:format\/download/);
  assert.match(adminV2, /desktop_settings_read_only/);
  const main = read('desktop/main.cjs');
  const preload = read('desktop/preload.cjs');
  assert.match(main, /contextIsolation:\s*true/);
  assert.match(main, /nodeIntegration:\s*false/);
  assert.match(main, /sandbox:\s*true/);
  assert.match(preload, /contextBridge\.exposeInMainWorld\('westoDesktop'/);
});

test('every visible admin tab has exactly one module owner', () => {
  const context = { window: {}, console };
  vm.createContext(context);
  const moduleSources = [
    adminModuleRegistry,
    catalogModule,
    inventoryModule,
    insightsModule,
    read('js/admin/modules/operations/operations-module.js'),
    read('js/admin/modules/finance/finance-module.js'),
    read('js/admin/modules/content/content-module.js'),
    read('js/admin/modules/settings/settings-module.js'),
  ];
  for (const source of moduleSources) vm.runInContext(source, context);
  const owners = context.window.WestoAdminModules.tabOwners();
  const visibleTabs = [...new Set([...admin.matchAll(/data-tab="([^"]+)"/g)].map((match) => match[1]))];
  assert.deepEqual(Object.keys(owners).filter((tab) => visibleTabs.includes(tab)).sort(), visibleTabs.sort());
  assert.equal(new Set(Object.values(owners)).size, 7);
});

test('dashboard uses real operational surfaces and the sidebar receives consistent icons', () => {
  assert.match(adminJs, /class="vital-dashboard"/);
  assert.match(adminJs, /api\(`\/api\/admin\/command-center/);
  assert.match(adminJs, /api\(`\/api\/admin\/v2\/overview/);
  assert.doesNotMatch(adminJs, /vital-task-list[\s\S]{0,500}type="checkbox"/);
  assert.match(shellJs, /installNavIcons\(\)/);
  assert.match(shellJs, /const NAV_ICONS\s*=\s*\{/);
});

test('dashboard break-even uses only Finance V2 output and keeps operational orders separate', () => {
  assert.match(adminJs, /planning\/break-even\/dashboard/);
  assert.match(adminJs, /const breakEvenDashboard = beResult\?\.data \|\| beResult \|\| null/);
  assert.match(adminJs, /renderDashboardBreakEvenShell\(breakEvenDashboard, stats, financeData/);
  assert.match(adminJs, /mountDashboardBreakEven\(breakEvenDashboard\)/);
  assert.match(adminJs, /status: 'load_error'/);
  assert.match(adminJs, /WestoBreakEvenChart\.mount\(host, dashboardBreakEvenChartData\(dashboard\)/);
  assert.match(adminJs, /\.\.\.\(dashboard\?\.chart \|\| \{ status: 'insufficient_data'/);
  assert.doesNotMatch(adminJs, /renderLineChart9Card\(beResult/);
  assert.doesNotMatch(adminJs, /svgPoints\.find\(\(p\) => p\.isBreakEven\) \|\| svgPoints\[/);
  assert.match(adminJs, /غیررسمی؛ شامل سفارش‌های لغونشده/);
  assert.match(adminJs, /این بخش فقط خروجی موتور Finance V2 را نمایش می‌دهد/);
  assert.match(adminJs, /financeWorkspaceHref\('sales_bank'\)/);
  assert.match(adminJs, /\/admin\/kitchen\?view=inventory&branchId=/);
  assert.match(breakEvenChartJs, /تا آن زمان هیچ خط عبور یا سودی تخمین زده نمی‌شود/);
  assert.match(breakEvenChartJs, /حاشیهٔ مشارکت با هزینهٔ متغیر صفر، صددرصد فرض نمی‌شود/);
  assert.match(breakEvenChartJs, /source\.official \? ' \(دفتر مالی قطعی\)'/);
  assert.match(breakEvenChartJs, /role: 'img', tabindex: '0'/);
  assert.match(breakEvenChartCss, /\.vital-break-even__actions/);
  assert.match(breakEvenChartCss, /@media \(max-width: 620px\)/);
});

test('shared admin surfaces, tables, focus states and responsive layouts are covered', () => {
  for (const selector of ['.section-box', '.card', '.tbl', '.table-scroll', '.kds-card', '.admin-settings-nav', '.admin-qr-preview__stage']) {
    assert.ok(vitalityCss.includes(selector), `missing visual coverage for ${selector}`);
  }
  assert.match(vitalityCss, /:focus-visible/);
  assert.match(vitalityCss, /@media \(max-width: 680px\)/);
  assert.match(vitalityCss, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(vitalityCss, /table\.tbl\s*\{[^}]*min-width:\s*42rem/s);
});

test('operational workspaces explain their accounting relationship with focused links', () => {
  const adminInsights = `${adminJs}\n${insightsModule}`;
  assert.match(adminJs, /api\/admin\/v2\/finance\/workbench/);
  assert.match(adminJs, /فروش و دفتر مالی نیازمند تطبیق‌اند/);
  assert.match(adminJs, /data-quick-tab="accounting"/);
  assert.match(adminInsights, /financeWorkspaceHref\('sales_bank'\)/);
  assert.match(adminInsights, /تطبیق با صندوق و دفتر مالی/);
  assert.match(adminJs, /href="\/admin\/kitchen\?view=inventory"/);
  assert.match(adminJs, /financeWorkspaceHref\('costing'\)/);
  assert.match(adminJs, /موجودی قابل فروش منو/);
  assert.match(adminJs, /اثر مالی و بهای تمام‌شده/);
});

test('daily admin copy is Persian-first and wide two-column pages cannot overflow the shell', () => {
  for (const staleCopy of [
    'Order Control',
    'Kitchen Display',
    'Front of House',
    'MENU ENGINEERING · POS',
    'COST CONTROL · WESTO',
    'SETTINGS · WESTO',
    'No-show امروز',
    'بدون polling',
    'QR STUDIO · TABLE ORDERS',
    'ترجمه منو (FA → EN / AR)',
  ]) {
    assert.ok(!adminJs.includes(staleCopy), `stale visible copy remains: ${staleCopy}`);
  }
  assert.match(adminJs, /تنظیمات یکپارچه وستو/);
  assert.match(adminJs, /ترجمه منو به انگلیسی و عربی/);
  assert.match(adminJs, /مدیریت رمزینه سفارش میز/);
  assert.match(vitalityCss, /\.grid-2-main\s*\{\s*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/s);
  assert.match(vitalityCss, /\.grid-2-main\s*>\s*\*\s*\{\s*min-width:\s*0/s);
});

test('admin replaces avoidable borrowed jargon with task-focused Persian labels', () => {
  for (const staleCopy of ['دسته‌ها و کاروسل', 'تخفیف و پرومو', 'نوبار و منو', 'کاور', 'آپلود', 'اکسنت', "'VIP'", 'سکشن', 'اسکرول', 'کپی‌رایت', 'لوگوتایپ', 'تم و برندینگ']) {
    assert.ok(!admin.includes(staleCopy), `stale shell wording remains: ${staleCopy}`);
    assert.ok(!adminJs.includes(staleCopy), `stale workspace wording remains: ${staleCopy}`);
  }
  for (const clearCopy of ['دسته‌ها و ترتیب نمایش', 'تخفیف‌ها و پیشنهادها']) assert.match(admin, new RegExp(clearCopy));
  for (const clearCopy of ['نوار بالای سایت و منو', 'بخش آغازین', 'تصویر شاخص', 'رنگ تأکیدی', 'بارگذاری', "'ویژه'", 'حق نشر منو', 'راهنمای پیمایش', 'نوشتار برند', 'ظاهر و هویت برند']) {
    assert.ok(adminJs.includes(clearCopy), `missing Persian-first wording: ${clearCopy}`);
  }
  assert.match(adminJs, /qrEclLabel/);
  assert.match(adminJs, /مقاومت چاپ/);
});

test('finance mobile shell keeps work visible and uses plain Persian kitchen terms', () => {
  assert.match(admin, /admin-accounting\.css\?v=finance-v2-20260829-break-even3/);
  assert.match(admin, /admin-break-even-chart\.css\?v=break-even-chart4-dashboard/);
  assert.match(admin, /break-even-chart\.js\?v=break-even-chart4-dashboard/);
  assert.match(admin, /admin-accounting\.js\?v=finance-v2-20260829-break-even5/);
  assert.match(financeJs, /id="fin-filter-toggle"/);
  assert.match(financeJs, /تغییر بازهٔ زمانی/);
  assert.match(financeJs, /activeWorkspace\.scrollIntoView\(\{ block: 'nearest', inline: 'center' \}\)/);
  assert.match(financeCss, /\.fin-date-controls\.is-open\s*\{\s*display:\s*grid/);
  assert.match(financeCss, /\.fin-workspace-nav\s*\{[\s\S]*?display:\s*flex;[\s\S]*?overflow-x:\s*auto;/);
  assert.match(financeCss, /\.fin-meta\s*\{\s*flex-wrap:\s*nowrap;\s*overflow-x:\s*auto;/);
  assert.doesNotMatch(financeJs, /رسپی|آیتم/);
  assert.doesNotMatch(financeServer, /رسپی|آیتم/);
  for (const clearCopy of ['دستور تهیه', 'محصول واقعی منو', 'سود ناخالص نظری محصولات فروخته‌شده']) {
    assert.match(financeJs, new RegExp(clearCopy));
  }
});
