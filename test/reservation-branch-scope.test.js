'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../server/server.js'), 'utf8');
const listStart = source.indexOf("app.get('/api/admin/reservations'");
const updateStart = source.indexOf("app.patch('/api/admin/reservations/:id'", listStart);
const updateEnd = source.indexOf("app.get('/api/admin/reservation-settings'", updateStart);
assert.ok(listStart >= 0 && updateStart > listStart && updateEnd > updateStart, 'reservation route boundaries exist');
const listRoute = source.slice(listStart, updateStart);
const updateRoute = source.slice(updateStart, updateEnd);

test('reservation list defaults scoped staff to one permitted branch and rejects empty scope', () => {
  assert.match(listRoute, /const allowedBranchIds = branchScopeForUser\(req\.user/);
  assert.match(listRoute, /if \(requestedBranch != null\)\s*\{\s*branchId = parseBranchId\(req\)/);
  assert.match(listRoute, /if \(!allowedBranchIds\.length\)[\s\S]*?branch_scope_empty/);
  assert.match(listRoute, /if \(branchId != null\) list = list\.filter\(\(r\) => Number\(r\.branchId\) === Number\(branchId\)\)/);
  assert.doesNotMatch(listRoute, /if \(req\.query\.branchId\)/);
});

test('reservation update authorizes the record branch before accepting any mutation', () => {
  const accessIndex = updateRoute.indexOf('assertUserBranchAccess(req.user, item.branchId)');
  const mutationIndex = updateRoute.indexOf("if (typeof req.body.status === 'string' && allowed.includes(req.body.status))");
  assert.ok(accessIndex >= 0 && mutationIndex > accessIndex);
  assert.match(updateRoute, /reservation_branch_mismatch/);
});
