'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'role-panel.html'), 'utf8');
const js = fs.readFileSync(path.join(root, 'js/role-panel.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'css/role-panel.css'), 'utf8');
const kdsCss = fs.readFileSync(path.join(root, 'css/kitchen-kds.css'), 'utf8');
const admin = fs.readFileSync(path.join(root, 'admin.html'), 'utf8');

test('role workspaces are separate routes with a manager preview launcher', () => {
  assert.match(admin, /admin-role-preview-trigger/);
  assert.match(admin, /admin-role-preview-grid/);
  assert.match(html, /role-preview-banner/);
  assert.match(js, /cashier:[\s\S]*menu[\s\S]*floor[\s\S]*orders[\s\S]*transactions[\s\S]*drawer/);
  assert.match(js, /waiter:[\s\S]*floor[\s\S]*calls[\s\S]*orders[\s\S]*reservations/);
  assert.match(js, /kitchen:[\s\S]*board[\s\S]*ready[\s\S]*inventory/);
  assert.match(js, /عملیات سالن · صندوق فروش/);
  assert.match(js, /خدمت‌رسانی سالن · همراه/);
  assert.match(js, /عملیات پشت صحنه · نمایشگر آشپزخانه/);
  assert.doesNotMatch(js, /Front of house|Floor service|Back of house|Handheld/);
  assert.doesNotMatch(js, /عملیات V2|رسپی V2/);
});

test('operational panels use real role-scoped APIs without NEEM or mock fixtures', () => {
  assert.match(js, /\/api\/cashier\/drawer/);
  assert.match(js, /\/api\/waiter\/calls/);
  assert.match(js, /\/api\/kitchen\/orders/);
  assert.match(js, /\/api\/kitchen\/inventory/);
  assert.match(js, /\/api\/kitchen\/inventory\/waste/);
  assert.match(js, /\/api\/kitchen\/inventory\/goods-receipts/);
  assert.match(js, /\/api\/kitchen\/inventory\/stock-counts/);
  assert.match(js, /\/api\/kitchen\/inventory\/production-batches/);
  assert.match(js, /\/api\/kitchen\/inventory\/recipe-versions/);
  assert.match(js, /\/api\/staff\/orders/);
  assert.match(js, /inventory-receipt-form/);
  assert.match(js, /purchasePricesHiddenFromOperator|قیمت خرید، حساب‌ها و مبلغ سند/);
  assert.match(js, /inventory-recipe-form/);
  assert.match(js, /data-add-recipe-line/);
  assert.match(js, /getISOValue\(form\.elements\.effectiveFrom\)/);
  assert.match(js, /\/api\/cashier\/orders\/\$\{order\.id\}\/settle/);
  assert.match(js, /sendToKitchen/);
  assert.doesNotMatch(js, /neem-project|localhost:4300|mockData|demoOrders/);
});

test('cashier sends branded raster receipts to network or USB printers without opening the OS dialog', () => {
  const server = fs.readFileSync(path.join(root, 'server/server.js'), 'utf8');
  assert.match(html, /role-panel\.css\?v=persianUx10-usb/);
  assert.match(js, /\/api\/cashier\/printer/);
  assert.match(js, /\/api\/cashier\/printers\/system/);
  assert.match(js, /\/api\/cashier\/orders\/\$\{check\.orderId\}\/print/);
  assert.match(js, /buildReceiptRasterPayload/);
  assert.match(js, /escpos-raster-v1/);
  assert.match(js, /getImageData/);
  assert.match(js, /westo-fa-wordmark-dark\.png/);
  assert.match(js, /api\(`\/api\/restaurant\$\{qs\(\)\}`\)/);
  assert.match(js, /restaurantData\?\.restaurant\?\.phone/);
  assert.match(js, /شماره تماس مجموعه/);
  assert.match(js, /USB \/ سیستم/);
  assert.match(js, /شناسایی دوباره/);
  assert.doesNotMatch(js, /چاپ تصویری فارسی فعال است|www\.westo\.local|از انتخاب شما سپاسگزاریم|با مهر و محبت/);
  assert.match(js, /dialog\.querySelector\('form\.role-dialog__sheet'\)/);
  assert.doesNotMatch(js, /<form id="printer-settings-form"/);
  assert.match(js, /رسید مستقیماً به پرینتر صندوق ارسال شد/);
  assert.doesNotMatch(js, /function printOrder[\s\S]*window\.open/);
  assert.match(server, /app\.post\('\/api\/cashier\/orders\/:id\/print'/);
  assert.match(server, /app\.get\('\/api\/cashier\/printers\/system'/);
  assert.match(server, /sendOrderToPrinter/);
  assert.match(server, /printRasterReceipt/);
  assert.match(server, /192\.168\.254\.4|DEFAULT_PRINTER_CONFIG/);
  assert.match(css, /\.printer-settings__transport/);
});

test('role UI includes responsive handheld and KDS layouts', () => {
  assert.match(css, /\.kds-board/);
  assert.match(css, /\.floor-grid/);
  assert.match(css, /\.drawer-card/);
  assert.match(css, /\.inventory-actions/);
  assert.match(css, /\.inventory-row/);
  assert.match(css, /\.recipe-builder__line/);
  assert.match(css, /\.pos-shell/);
  assert.match(css, /\.payment-sheet/);
  assert.match(css, /body\.is-pos-station/);
  assert.match(css, /overflow: hidden/);
  assert.match(js, /pos-category-deck/);
  assert.match(js, /pos-menu-path/);
  assert.match(js, /data-pos-quick-add/);
  assert.doesNotMatch(js, /data-pos-customize/);
  assert.match(js, /openComplementLayer/);
  assert.match(js, /menuComplementRules/);
  assert.match(js, /\/api\/staff\/menu/);
  assert.match(js, /data-pos-line-delta/);
  assert.match(js, /pendingPosItem/);
  assert.doesNotMatch(js, /posPager|posPageSize|posCartPageSize|data-pos-page/);
  assert.match(css, /@media \(max-width: 620px\)/);
  assert.match(css, /100dvh/);
});

test('kitchen workspace implements a high-volume Square-inspired KDS without broadening payment access', () => {
  const server = fs.readFileSync(path.join(root, 'server/server.js'), 'utf8');
  assert.match(html, /kitchen-kds\.css\?v=kdsSquare10-order-entry/);
  assert.match(js, /kdsFilteredTickets/);
  assert.match(js, /data-kds-item/);
  assert.doesNotMatch(js, /data-kds-action="complete_station"/);
  assert.match(js, /openKdsAllDay/);
  assert.match(js, /openKdsAvailability/);
  assert.match(js, /openKdsSettings/);
  assert.match(js, /handleKdsShortcut/);
  assert.match(js, /kdsPendingTickets/);
  assert.match(js, /branchId: state\.branchId/);
  assert.match(js, /recall_ticket/);
  assert.match(server, /app\.patch\('\/api\/kitchen\/items\/:id\/availability'/);
  assert.match(server, /kdsPerformance/);
  assert.match(server, /kds\.itemStates/);
  assert.match(server, /complete_station/);
  assert.match(kdsCss, /body\.is-kitchen-workspace/);
  assert.match(kdsCss, /height:\s*100dvh/);
  assert.match(kdsCss, /overflow:\s*hidden/);
  assert.match(kdsCss, /--kds-columns/);
  assert.match(kdsCss, /\.kds-ticket\.is-late/);
  assert.match(kdsCss, /\.kds-undo/);
  assert.match(kdsCss, /\.kds-order-entry/);
  assert.match(kdsCss, /\.role-main :is\(\.role-metric, \.inventory-action, \.role-section\)/);
  assert.doesNotMatch(kdsCss, /\.is-pos-station\s/);
});

test('kitchen display uses one food and beverage queue with complete Genius numpad coverage', () => {
  assert.match(js, /kdsStation: 'kitchen'/);
  assert.match(js, /kds-unified-station/);
  assert.match(js, /غذا · قهوه · نوشیدنی/);
  assert.match(js, /function openKdsKeyboardHelp/);
  assert.match(js, /id="kds-order-entry"/);
  assert.match(js, /function kdsAllDayDrawerMarkup/);
  assert.match(js, /function toggleKdsAllDay/);
  assert.match(js, /data-kds-all-day-close/);
  assert.match(js, /از سفارش‌ها/);
  assert.doesNotMatch(js, /kds-all-day-drawer__summary/);
  assert.doesNotMatch(js, /برای بستن شمارش کل/);
  for (const keyCode of ['Numpad0', 'Numpad1', 'NumpadEnter', 'NumpadDecimal', 'NumpadAdd', 'NumpadSubtract', 'NumpadMultiply', 'NumpadDivide', 'NumLock', 'Calculator']) {
    assert.match(js, new RegExp(keyCode));
  }
  for (const keyLabel of ['Tab', 'Backspace', 'PageUp', 'PageDown', 'Insert', 'Delete']) {
    assert.match(js, new RegExp(keyLabel));
  }
  assert.match(kdsCss, /\.kds-unified-station/);
  assert.match(kdsCss, /\.kds-ticket\.is-selected/);
  assert.match(kdsCss, /\.kds-keyboard-help/);
});

test('cashier can edit an order only before kitchen preparation starts', () => {
  const server = fs.readFileSync(path.join(root, 'server/server.js'), 'utf8');
  assert.match(js, /function orderCanEdit/);
  assert.match(js, /ویرایش سفارش/);
  assert.match(js, /ذخیره تغییرات سفارش/);
  assert.match(js, /\/api\/cashier\/orders\/\$\{check\.orderId\}/);
  assert.match(server, /app\.patch\('\/api\/cashier\/orders\/:id'/);
  assert.match(server, /order_edit_locked/);
  assert.match(server, /order\.edited_before_kitchen/);
  assert.match(css, /\.pos-order-row__action\.is-edit/);
});

test('staff shift has an explicit and guarded end-shift flow', () => {
  assert.match(js, /button\.textContent = shift \? 'پایان شیفت' : 'شروع شیفت'/);
  assert.match(js, /function showShiftCloseDialog/);
  assert.match(js, /تأیید و پایان شیفت/);
  assert.match(js, /صندوق پول هنوز باز است/);
  assert.match(js, /shift-go-drawer/);
  assert.match(js, /\/api\/staff\/shifts\/close/);
  assert.match(css, /\.shift-end-sheet/);
  assert.match(css, /\.role-shift\.is-open/);
});

test('cashier floor filters restaurant zones and counts down a 45 minute table service', () => {
  assert.match(js, /data-floor-zone="\$\{esc\(id\)\}"/);
  assert.match(js, /zoneButton\('all', 'همه'/);
  assert.match(js, /function startFloorCountdown/);
  assert.match(js, /زمان میز/);
  assert.match(js, /data-auto-released/);
  assert.match(css, /\.pos-floor__zones button\.active/);
  assert.match(css, /\.pos-floor__map time\.is-ending/);
});

test('cashier product cards use a readable dark fibonacci-ratio information panel', () => {
  assert.match(css, /\.pos-product-card__info[\s\S]*min-height:\s*38\.2%/);
  assert.match(css, /\.pos-product-card__info[\s\S]*linear-gradient\(135deg/);
  assert.match(css, /\.pos-product-card__info::before[\s\S]*width:\s*38\.2%/);
  assert.match(css, /\.pos-product-card__info b[\s\S]*font-size:\s*14px/);
  assert.match(css, /\.pos-product-card__info small[\s\S]*font-size:\s*10px/);
  assert.match(css, /\.pos-product-card__add:focus-visible/);
});

test('cashier invoice renders complements as independent priced rows without double counting', () => {
  assert.match(js, /function posBaseLineTotal/);
  assert.match(js, /function posInvoiceRows/);
  assert.match(js, /pos-line--complement/);
  assert.match(js, /data-pos-complement-delta/);
  assert.match(js, /money\(Number\(complement\.price \|\| 0\) \* Number\(complement\.qty \|\| 1\)\)/);
  assert.doesNotMatch(js, /class="pos-line__complements">↳/);
  assert.match(css, /\.pos-line--complement/);
  assert.match(css, /\.pos-line__complement > span/);
});

test('cashier keeps ambiguous legacy tenders out of cash and non-cash totals', () => {
  assert.match(js, /const hasTender = \(order\) => Object\.prototype\.hasOwnProperty\.call\(tenderLabel, order\.paymentTender\)/);
  assert.match(js, /const missingTender = paid\.filter\(\(order\) => !hasTender\(order\)\)/);
  assert.match(js, /روش ثبت‌نشده/);
  assert.match(js, /نقدی یا غیرنقدی فرض نشده/);
  assert.doesNotMatch(js, /tenderLabel\[order\.paymentTender\] \|\| 'پرداخت'/);
  assert.match(css, /\.role-inline-warning/);
  assert.match(css, /\.pos-transaction-list article\.is-warning/);
});

test('kitchen shortcuts use Persian-first visible labels', () => {
  assert.match(js, /id="kds-all-day">شمارش کل/);
  assert.match(js, /شماره \+ ۰<\/kbd> انتخاب سفارش/);
  assert.match(js, /function acceptKdsOrderDigit/);
  assert.match(js, /مثال ۱،۲،۰ یعنی سفارش ۱۲/);
  assert.match(js, /id="kds-keyboard-help">راهنمای نام‌پد/);
  assert.doesNotMatch(js, />All‑Day<|<kbd>Esc<\/kbd>/);
});

test('daily role workspaces use clear Persian task language instead of kitchen and POS jargon', () => {
  const server = fs.readFileSync(path.join(root, 'server/server.js'), 'utf8');
  assert.match(html, /role-panel\.js\?v=persianUx26-sequential-order-entry/);
  for (const jargon of ['تیکت', 'رسپی', 'کانتر', 'بچ', '<kbd>R', '<kbd>A', 'آیتم']) {
    assert.ok(!js.includes(jargon), `avoidable role jargon remains: ${jargon}`);
  }
  for (const clearCopy of ['صف آشپزخانه', 'دستور تهیه', 'تحویل پیشخوان', 'مرحله تولید', 'جست‌وجوی محصول', 'شمارش کل']) {
    assert.ok(js.includes(clearCopy), `missing clear role wording: ${clearCopy}`);
  }
  assert.match(js, /kdsStationLabel/);
  assert.match(server, /\{ id: 'expo', label: 'خروج سفارش' \}/);
});
