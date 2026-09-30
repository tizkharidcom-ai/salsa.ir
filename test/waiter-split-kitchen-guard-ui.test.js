'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../js/role-panel.js'), 'utf8');
const start = source.indexOf('function paintTerminalActions(container)');
const end = source.indexOf('function ', start + 12);
assert.ok(start >= 0 && end > start, 'waiter terminal action renderer exists');
const renderer = source.slice(start, end);

test('waiter split action exposes the kitchen-stage lock and re-enables only after service', () => {
  assert.match(renderer, /splitBlockedByKitchen = \['sent_to_kitchen', 'preparing', 'ready'\]\.includes\(splitOrderStatus\)/);
  assert.match(renderer, /&& !splitBlockedByKitchen && !splitBlockedByCancelled/);
  assert.match(renderer, /پس از تحویل سفارش به میز دوباره فعال می‌شود/);
  assert.match(renderer, /سفارش لغوشده قابل تفکیک نیست/);
});
