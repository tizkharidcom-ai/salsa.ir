'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ROLE_CAPABILITIES } = require('../server/command-center');

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'role-panel.js'), 'utf8');

function sourceBetween(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(start, -1, `source start marker exists: ${startMarker}`);
  assert.notEqual(end, -1, `source end marker exists: ${endMarker}`);
  return source.slice(start, end);
}

test('waiter can view the floor but cannot enter layout editing', () => {
  assert.ok(ROLE_CAPABILITIES.waiter.includes('tables.view'));
  assert.ok(!ROLE_CAPABILITIES.waiter.includes('tables.manage'));

  const floor = sourceBetween('function waiterFloor() {', 'function wireWaiterFloorEvents()');
  assert.match(floor, /const canEditFloor = workspaceCapabilities\.includes\('\*'\) \|\| workspaceCapabilities\.includes\('tables\.manage'\)/);
  assert.match(floor, /if \(!canEditFloor\) state\.waiterFloorEditing = false/);
  assert.match(floor, /state\.waiterFloorEditing && canEditFloor \?/);
  assert.match(floor, /: canEditFloor \?/);
  assert.match(floor, /allowEdit: canEditFloor/);
  assert.match(floor, /چیدمان فقط‌خواندنی است؛ تغییر آن از این فضای کاری مجاز نیست/);
});

test('waiter floor snapshot retains the GET response, including its layout revision', () => {
  const fetchWaiter = sourceBetween('async function fetchWaiter() {', 'async function refreshWaiterAfterMutation()');
  assert.match(fetchWaiter, /api\(`\/api\/admin\/v2\/floor\$\{branchParam\}`\)/);
  assert.match(fetchWaiter, /state\.data = \{\s*floor,/);
  assert.doesNotMatch(fetchWaiter, /floor\s*:\s*\{\s*tables\s*:/);
});
