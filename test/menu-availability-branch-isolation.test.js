'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  menuAvailabilityOverride,
  menuItemAvailableForBranch,
  setMenuAvailabilityOverride,
} = require('../server/menu-availability');

const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server', 'server.js'), 'utf8');
const rolePanelSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'role-panel.js'), 'utf8');

test('manual sellability overrides are independent per branch and never re-enable a globally disabled item', () => {
  const db = { menuAvailabilityOverrides: [] };
  const sharedItem = { id: 41, available: true };

  assert.equal(menuItemAvailableForBranch(db, sharedItem, 1), true);
  assert.equal(menuItemAvailableForBranch(db, sharedItem, 2), true);
  assert.equal(setMenuAvailabilityOverride(db, { menuItemId: 41, branchId: 1, available: false }).ok, true);
  assert.equal(menuItemAvailableForBranch(db, sharedItem, 1), false);
  assert.equal(menuItemAvailableForBranch(db, sharedItem, 2), true, 'a branch toggle must not change another branch');
  assert.equal(setMenuAvailabilityOverride(db, { menuItemId: 41, branchId: 2, available: false }).ok, true);
  assert.equal(menuItemAvailableForBranch(db, sharedItem, 2), false);
  assert.equal(setMenuAvailabilityOverride(db, { menuItemId: 41, branchId: 1, available: true }).ok, true);
  assert.equal(menuItemAvailableForBranch(db, sharedItem, 1), true);
  assert.equal(menuItemAvailableForBranch(db, { ...sharedItem, available: false }, 1), false,
    'the catalog-level kill switch takes precedence over a branch override');
});

test('sellability fails closed when the request has no valid branch scope', () => {
  const item = { id: 41, available: true };
  const db = { menuAvailabilityOverrides: [] };

  assert.equal(menuItemAvailableForBranch(db, item, null), false);
  assert.equal(menuItemAvailableForBranch(db, item, 0), false);
  assert.equal(menuItemAvailableForBranch(db, item, 'not-a-branch'), false);
});

test('corrupt or duplicate branch overrides fail closed instead of selecting an arbitrary value', () => {
  const item = { id: 7, available: true };
  const duplicateDb = { menuAvailabilityOverrides: [
    { menuItemId: 7, branchId: 1, available: true },
    { menuItemId: 7, branchId: 1, available: false },
  ] };
  const invalidDb = { menuAvailabilityOverrides: [{ menuItemId: 7, branchId: 1, available: 'yes' }] };

  assert.equal(menuAvailabilityOverride(duplicateDb, 7, 1).error, 'menu_availability_override_duplicate');
  assert.equal(menuItemAvailableForBranch(duplicateDb, item, 1), false);
  assert.equal(menuAvailabilityOverride(invalidDb, 7, 1).error, 'menu_availability_override_invalid');
  assert.equal(menuItemAvailableForBranch(invalidDb, item, 1), false);
  assert.equal(setMenuAvailabilityOverride(duplicateDb, { menuItemId: 7, branchId: 1, available: true }).ok, false);
});

test('public menu, staff menu, order validation and KDS use the same branch sellability source', () => {
  assert.match(serverSource, /function publicGuestMenuPayload\([\s\S]*?menuItemAvailableForBranch\(db, m, branchId\)/);
  assert.match(serverSource, /function staffMenuPayload\([\s\S]*?resp\.available = menuItemAvailableForBranch\(db, item, branchId\)/);
  assert.match(serverSource, /const menuItem = db\.menuItems\.find\(\(item\) => item\.id === menuItemId[\s\S]*?menuItemAvailableForBranch\(db, item, branchId\)/);
  assert.match(serverSource, /function kdsMenuAvailabilityPayload\([\s\S]*?menuItemAvailableForBranch\(db, item, branchId\)/);
  assert.match(serverSource, /availability: \(db\.menuItems \|\| \[\]\)[\s\S]*?filter\(\(item\) => menuItemBelongsToBranch\(item, bid\)\)/);
});

test('KDS branch availability writes are scoped, durable, rolled back on failure, and published after commit', () => {
  const routeStart = serverSource.indexOf("app.patch('/api/kitchen/items/:id/availability'");
  const routeEnd = serverSource.indexOf("/* ---- Call waiter", routeStart);
  assert.ok(routeStart >= 0 && routeEnd > routeStart);
  const route = serverSource.slice(routeStart, routeEnd);
  const commit = route.indexOf('await persistFinanceMutation(snapshot, { bumpMenu: true })');
  const audit = route.indexOf('appendAuditAfterCommit(auditEntry)');
  const publish = route.indexOf("publishOperationalEvent('menu.availability_updated'");

  assert.match(route, /const branchId = requestedKdsBranch\(req\)/);
  assert.match(route, /!menuItemBelongsToBranch\(item, branchId\)/);
  assert.match(route, /serializeAdminConfigMutation\(branchId/);
  assert.match(route, /const snapshot = snapshotFinanceMutationState\(\)/);
  assert.ok(commit > 0 && audit > commit && publish > audit,
    'durable persistence must complete before committed audit append or publication');
  assert.doesNotMatch(route, /item\.available\s*=\s*req\.body\.available/,
    'a branch override must not mutate the shared catalogue flag');

  const client = rolePanelSource.slice(rolePanelSource.indexOf('function openKdsAvailability()'), rolePanelSource.indexOf('\n  function openKdsSettings()'));
  assert.match(client, /branchId: state\.branchId/);
  assert.match(client, /item\.inventoryBlocked \|\| item\.globallyAvailable === false/);
  assert.match(client, /item\.manualAvailable/);
});
