'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('./helpers/source-fs');
const path = require('node:path');

test('replayed station completion while another station is active exits before audit and persistence', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'server', 'server.js'), 'utf8');
  const routeStart = source.indexOf("app.patch('/api/kitchen/orders/:id'");
  const routeEnd = source.indexOf("app.patch('/api/kitchen/items/:id/availability'", routeStart);
  assert.ok(routeStart >= 0 && routeEnd > routeStart);
  const route = source.slice(routeStart, routeEnd);
  const stationStart = route.indexOf("actionName === 'complete_station'");
  const stationEnd = route.indexOf("actionName === 'undo_item'", stationStart);
  assert.ok(stationStart >= 0 && stationEnd > stationStart);
  const stationAction = route.slice(stationStart, stationEnd);
  const replay = stationAction.indexOf('stationLines.every((entry) => kds.itemStates[entry.key]?.completedAt)');
  const stationWrite = stationAction.indexOf('for (const entry of stationLines)');
  assert.ok(replay >= 0 && replay < stationWrite);
  assert.match(stationAction, /if \(stationLines\.every\(\(entry\) => kds\.itemStates\[entry\.key\]\?\.completedAt\)\) return res\.json\(kdsIdempotent\(order\)\)/);
  assert.ok(route.indexOf('recordAudit(req, auditAction') > stationEnd);
  assert.ok(route.indexOf('await persistFinanceMutation(snapshot)') > stationEnd);
});
