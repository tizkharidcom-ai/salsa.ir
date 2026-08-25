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
});

test('operational panels use real role-scoped APIs without NEEM or mock fixtures', () => {
  assert.match(js, /\/api\/cashier\/drawer/);
  assert.match(js, /\/api\/waiter\/calls/);
  assert.match(js, /\/api\/kitchen\/orders/);
  assert.match(js, /\/api\/kitchen\/inventory/);
  assert.match(js, /\/api\/kitchen\/inventory\/waste/);
  assert.match(js, /\/api\/kitchen\/inventory\/stock-counts/);
  assert.match(js, /\/api\/kitchen\/inventory\/production-batches/);
  assert.match(js, /\/api\/staff\/orders/);
  assert.match(js, /\/api\/cashier\/orders\/\$\{order\.id\}\/settle/);
  assert.match(js, /sendToKitchen/);
  assert.doesNotMatch(js, /neem-project|localhost:4300|mockData|demoOrders/);
});

test('role UI includes responsive handheld and KDS layouts', () => {
  assert.match(css, /\.kds-board/);
  assert.match(css, /\.floor-grid/);
  assert.match(css, /\.drawer-card/);
  assert.match(css, /\.inventory-actions/);
  assert.match(css, /\.inventory-row/);
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
  assert.match(html, /kitchen-kds\.css\?v=kdsSquare3/);
  assert.match(js, /kdsFilteredTickets/);
  assert.match(js, /data-kds-item/);
  assert.match(js, /data-kds-action="complete_station"/);
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
  assert.doesNotMatch(kdsCss, /\.is-pos-station\s/);
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
  assert.match(js, /money\(Number\(entry\.price \|\| 0\) \* Number\(entry\.qty \|\| 1\)\)/);
  assert.doesNotMatch(js, /class="pos-line__complements">↳/);
  assert.match(css, /\.pos-line--complement/);
  assert.match(css, /\.pos-line__complement > span/);
});
