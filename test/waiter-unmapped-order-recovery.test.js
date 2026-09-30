'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'role-panel.js'), 'utf8');

test('unmapped-order warning is an accessible action that opens the filtered order queue', () => {
  assert.match(source, /data-waiter-quick-view="\$\{unmappedOrders\.length \? 'unmapped-orders' : 'orders'\}"/);
  assert.match(source, /state\.waiterUnmappedOnly = target === 'unmapped-orders'/);
  assert.match(source, /state\.activeView = state\.waiterUnmappedOnly \? 'orders' : target/);
  assert.match(source, /waiterUnmappedOrders\(activeOrders\)/);
});

test('an unmapped active dine-in order can be assigned only to an available mapped table', () => {
  assert.match(source, /data-assign-waiter-table/);
  assert.match(source, /function openUnmappedOrderTableAssignment\(order\)/);
  assert.match(source, /\['reserved', 'busy', 'attention'\]/);
  assert.match(source, /context\.orders\.length === 0 && context\.calls\.length === 0/);
  assert.match(source, /\/api\/waiter\/orders\/\$\{encodeURIComponent\(order\.id\)\}\/move-table/);
  assert.match(source, /waiter-order-table-confirm/);
});

test('filtered queue has an explicit route back to all active waiter orders', () => {
  assert.match(source, /id="waiter-show-all-orders"/);
  assert.match(source, /state\.waiterUnmappedOnly = false;\s*waiterOrders\(\)/);
  assert.match(source, /سفارش فعالِ بدون میز برای رسیدگی وجود ندارد/);
});
