'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'role-panel.js'), 'utf8');
const functionBody = (name, nextName) => {
  const start = source.indexOf(`function ${name}(`);
  const end = source.indexOf(`function ${nextName}(`, start);
  assert.notEqual(start, -1, `${name} exists`);
  assert.notEqual(end, -1, `${nextName} follows ${name}`);
  return source.slice(start, end);
};

test('an order mapped only to an inactive table remains in the unmapped active dine-in queue', () => {
  const mappedCheck = functionBody('waiterOrderHasMappedTable', 'waiterAvailableAssignmentTables');
  const unmappedFilter = functionBody('waiterUnmappedOrders', 'waiterOrderHasMappedTable');

  assert.match(mappedCheck, /table\.active !== false && tableNoBelongsToTable\(order\?\.tableNo, table\.id\)/);
  assert.match(unmappedFilter, /order\.fulfillment === 'dine_in'[\s\S]*orderIsOpen\(order\)[\s\S]*!waiterOrderHasMappedTable\(order\)/);
});

test('assignment choices are active, available, and have no open order or call', () => {
  const candidates = functionBody('waiterAvailableAssignmentTables', 'waiterFloorModeStorageKey');

  assert.match(candidates, /table\.active === false \|\| \['reserved', 'busy', 'attention'\]/);
  assert.match(candidates, /context\.state === 'available'[\s\S]*context\.orders\.length === 0 && context\.calls\.length === 0/);
});

test('confirmation rechecks the saved order and table, then moves the existing invoice exactly once', () => {
  const assignment = functionBody('openUnmappedOrderTableAssignment', 'waiterReservations');

  assert.match(assignment, /latestOrder\.fulfillment !== 'dine_in' \|\| !orderIsOpen\(latestOrder\) \|\| waiterOrderHasMappedTable\(latestOrder\)/);
  assert.match(assignment, /waiterAvailableAssignmentTables\(\)\.find\(\(table\) => String\(table\.id\) === String\(tableNo\)\)/);
  assert.match(assignment, /api\(`\/api\/waiter\/orders\/\$\{encodeURIComponent\(order\.id\)\}\/move-table`,\s*\{\s*method: 'PATCH'/);
  assert.doesNotMatch(assignment, /api\(['"]\/api\/staff\/orders['"]/);
  assert.equal((assignment.match(/\/move-table`/g) || []).length, 1);
  assert.match(assignment, /setBusy\(confirmButton, true\)/);
});

test('an uncertain table-assignment result pins the exact destination across dialog reopen and retry', () => {
  const assignment = functionBody('openUnmappedOrderTableAssignment', 'waiterReservations');

  assert.match(source, /waiterUnmappedAssignmentIntents:\s*new Map\(\)/);
  assert.match(assignment, /const intentKey = `\$\{String\(requestedBranchId \?\? ''\)\}:\$\{String\(order\.id\)\}`/);
  assert.match(assignment, /assignmentIntents\.get\(intentKey\)\?\.tableNo/);
  assert.match(assignment, /if \(isUncertainRetry && String\(selection\?\.value \|\| ''\) !== uncertainTargetNo\)/);
  assert.match(assignment, /assignmentIntents\.set\(intentKey, \{[\s\S]*?tableNo: uncertainTargetNo \}\)/);
  assert.match(assignment, /selection\.disabled = true/);
  assert.match(assignment, /فقط همان مقصد را دوباره امتحان کنید/);
  assert.match(assignment, /else if \(isUncertainRetry\)[\s\S]*?await fetchWaiter\(\)/);
});

test('a confirmed assignment updates the waiter queue even when the follow-up refresh fails', () => {
  const assignment = functionBody('openUnmappedOrderTableAssignment', 'waiterReservations');

  assert.match(assignment, /const confirmedOrder = result\?\.order/);
  assert.match(assignment, /String\(confirmedOrder\.tableNo \?\? ''\) !== String\(tableNo\)/);
  assert.match(assignment, /const orderIndex = \(state\.data\.orders \|\| \[\]\)\.findIndex/);
  assert.match(assignment, /await fetchWaiter\(\)/);
  assert.match(assignment, /اتصال سفارش به .*تأیید شد، اما فهرست تازه ناموفق یا ناسازگار بود/);
  assert.match(assignment, /تا تطبیق، انتقال دیگری انجام ندهید/);
});
