'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('./helpers/source-fs');
const path = require('node:path');
const { menuItemBelongsToBranch } = require('../server/menu-branch-scope');

const source = fs.readFileSync(path.join(__dirname, '..', 'server', 'server.js'), 'utf8');

test('global catalog items are shared while branch-owned items are visible only in their branch', () => {
  assert.equal(menuItemBelongsToBranch({ id: 1, branchId: null }, 7), true);
  assert.equal(menuItemBelongsToBranch({ id: 2, branchId: 7 }, 7), true);
  assert.equal(menuItemBelongsToBranch({ id: 2, branchId: 8 }, 7), false);
  assert.equal(menuItemBelongsToBranch({ id: 2, branchId: 'invalid' }, 7), false);
  assert.equal(menuItemBelongsToBranch({ id: 2, branchId: 7 }, null), false);
});

test('both public menu and authoritative order lookup enforce branch-owned catalog scope', () => {
  const publicMenuStart = source.indexOf('function publicGuestMenuPayload(');
  const publicMenuEnd = source.indexOf('function publicRestaurantPayload(', publicMenuStart);
  const lineLookupStart = source.indexOf('function orderLinesFromRequest(');
  const lineLookupEnd = source.indexOf('function checkoutQuoteIntent(', lineLookupStart);
  assert.ok(publicMenuStart >= 0 && publicMenuEnd > publicMenuStart);
  assert.ok(lineLookupStart >= 0 && lineLookupEnd > lineLookupStart);
  assert.match(source.slice(publicMenuStart, publicMenuEnd), /menuItemBelongsToBranch\(item, branchId\)/);
  assert.match(source.slice(lineLookupStart, lineLookupEnd), /menuItemBelongsToBranch\(menuItem, branchId\)/);
});

test('public menu failures keep database error details out of guest responses', () => {
  const routeStart = source.indexOf("app.get('/api/menu'");
  const routeEnd = source.indexOf('function complementRulesForMenuItem', routeStart);
  assert.ok(routeStart >= 0 && routeEnd > routeStart);
  const route = source.slice(routeStart, routeEnd);
  assert.match(route, /error: 'menu_retrieval_failed', message: 'دریافت منو موقتاً با مشکل روبه‌رو شد\.'/);
  assert.doesNotMatch(route, /message:\s*err\.message/);
});

test('explicit invalid branch context fails closed for menu, checkout metadata, and order quoting', () => {
  const menuStart = source.indexOf("app.get('/api/menu'");
  const menuEnd = source.indexOf('function complementRulesForMenuItem', menuStart);
  const metaStart = source.indexOf("app.get('/api/checkout/meta'");
  const metaEnd = source.indexOf("app.post('/api/checkout/quote'", metaStart);
  const branchLookupStart = source.indexOf('function findOrderBranch(');
  const branchLookupEnd = source.indexOf('function publicPaymentAttempt(', branchLookupStart);

  assert.ok(menuStart >= 0 && menuEnd > menuStart);
  assert.ok(metaStart >= 0 && metaEnd > metaStart);
  assert.ok(branchLookupStart >= 0 && branchLookupEnd > branchLookupStart);
  assert.match(source.slice(menuStart, menuEnd), /requestedBranch && !resolveBranchExact\(requestedBranch\)/);
  assert.match(source.slice(metaStart, metaEnd), /requestedBranch && !branch/);
  assert.match(source.slice(branchLookupStart, branchLookupEnd), /requestedBranch \? resolveBranchExact\(requestedBranch\) : defaultBranch\(\)/);
});
