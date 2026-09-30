'use strict';

// Independent audit contract: after a paid receipt print fails, both the
// receipt state and the order's latest print-attempt state must say failed.
// This reads route source only; it does not boot the server or touch data.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('./helpers/source-fs');
const path = require('node:path');

const serverSource = fs.readFileSync(path.join(__dirname, '../server/server.js'), 'utf8');
const rolePanelSource = fs.readFileSync(path.join(__dirname, '../js/role-panel.js'), 'utf8');
const orderPrintStart = serverSource.indexOf("app.post('/api/cashier/orders/:id/print'");
const receiptStart = serverSource.indexOf("app.post('/api/cashier/orders/:id/receipt'");
assert.ok(orderPrintStart >= 0 && receiptStart > orderPrintStart, 'canonical order print route boundaries exist');
const orderPrintRoute = serverSource.slice(orderPrintStart, receiptStart);
const routeStart = serverSource.indexOf("app.post('/api/cashier/orders/:id/receipt'");
const routeEnd = serverSource.indexOf("app.patch('/api/cashier/orders/:id/status'", routeStart);
assert.ok(routeStart >= 0 && routeEnd > routeStart, 'paid receipt route boundaries exist');
const receiptRoute = serverSource.slice(routeStart, routeEnd);
const printBranchStart = receiptRoute.indexOf("if (method === 'print') {");
const printBranchEnd = receiptRoute.indexOf("\n  order.receipt = {", printBranchStart);
assert.ok(printBranchStart >= 0 && printBranchEnd > printBranchStart, 'receipt print branch exists');
const printBranch = receiptRoute.slice(printBranchStart, printBranchEnd);
const catchStart = printBranch.indexOf('} catch (error) {');
const catchEnd = printBranch.indexOf('\n    }', catchStart);
assert.ok(catchStart >= 0 && catchEnd > catchStart, 'receipt print failure handler exists');
const failureHandler = printBranch.slice(catchStart, catchEnd);

test('failed post-settlement receipt print updates the latest print-attempt status', () => {
  assert.match(failureHandler, /order\.receipt\s*=\s*\{[\s\S]*?status:\s*'failed'/,
    'the receipt itself records the failed print attempt');
  assert.match(failureHandler, /order\.lastPrint\s*=\s*\{[\s\S]*?status:\s*'failed'/,
    'lastPrint must not retain a stale successful status after a failed receipt retry');
});

test('official order prints ignore browser rasters and use the persisted order for canonical totals', () => {
  assert.doesNotMatch(orderPrintRoute, /req\.body\?\.raster/);
  assert.doesNotMatch(receiptRoute, /req\.body\?\.raster/);
  assert.match(orderPrintRoute, /sendOrderToPrinter\(order, printer/);
  assert.match(receiptRoute, /sendOrderToPrinter\(order, printer/);
  assert.doesNotMatch(rolePanelSource.slice(rolePanelSource.indexOf('async function finishReceipt('), rolePanelSource.indexOf('async function openPrinterSettings(')), /body\.raster\s*=/);
  assert.match(rolePanelSource, /body: JSON\.stringify\(\{ branchId: state\.branchId \}\)/);
});
