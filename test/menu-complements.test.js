'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'server/server.js'), 'utf8');
const seed = require(path.join(root, 'server/seed.js'));
const role = fs.readFileSync(path.join(root, 'js/role-panel.js'), 'utf8');
const adminJs = fs.readFileSync(path.join(root, 'js/admin.js'), 'utf8');
const adminHtml = fs.readFileSync(path.join(root, 'admin.html'), 'utf8');

test('sale-only complements are seeded separately from the public menu', () => {
  assert.ok(seed.menuComplements.length >= 5);
  assert.ok(seed.menuComplementRules.length >= 2);
  assert.ok(seed.menuComplements.every((entry) => !seed.menuItems.some((item) => Number(item.id) === Number(entry.id) && item.name === entry.name)));
  const publicPayload = server.slice(server.indexOf('function publicGuestMenuPayload'), server.indexOf('function publicRestaurantPayload'));
  assert.doesNotMatch(publicPayload, /menuComplements|menuComplementRules/);
});

test('staff and admin APIs enforce scoped access for complement management', () => {
  assert.match(server, /app\.get\('\/api\/staff\/menu', requireCapability\('orders\.create'\)/);
  assert.match(server, /app\.get\('\/api\/admin\/menu-engineering', requireCapability\('menu\.manage'\)/);
  assert.match(server, /app\.post\('\/api\/admin\/menu-complements', requireCapability\('menu\.manage'\)/);
  assert.match(server, /app\.post\('\/api\/admin\/menu-complement-rules', requireCapability\('menu\.manage'\)/);
});

test('order parser validates linked complements and includes their totals and stock', () => {
  assert.match(server, /allowedComplementIds/);
  assert.match(server, /complementRulesForMenuItem/);
  assert.match(server, /complementTotal/);
  assert.match(server, /lineTotal: unitTotal \* qty \+ complementTotal/);
  assert.match(server, /complement\.stock = Math\.max/);
});

test('cashier adds product first then offers contextual complements without a details button', () => {
  assert.doesNotMatch(role, /data-pos-customize/);
  assert.match(role, /function openComplementLayer/);
  assert.match(role, /محصول به فاکتور اضافه شد/);
  assert.match(role, /line\.complements/);
  assert.match(role, /complements: \(line\.complements/);
});

test('admin exposes a complete menu engineering workspace', () => {
  assert.match(adminHtml, /data-tab="complements"/);
  assert.match(adminJs, /async complements\(\)/);
  assert.match(adminJs, /کتابخانه مکمل‌ها/);
  assert.match(adminJs, /قوانین پیشنهاد/);
  assert.match(adminJs, /data-me-category/);
  assert.match(adminJs, /data-me-item/);
  assert.match(adminJs, /data-me-complement/);
});
