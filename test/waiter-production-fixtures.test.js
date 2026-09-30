'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'role-panel.js'), 'utf8');

test('floor map renders only configured fixtures and never invents operational stations', () => {
  const start = source.indexOf('function buildPlanCanvasHtml(');
  const end = source.indexOf('function setupFloorCanvasPanZoom(', start);
  assert.ok(start >= 0 && end > start, 'floor map renderer exists');
  const renderer = source.slice(start, end);

  assert.match(renderer, /Array\.isArray\(state\.data\.floor\?\.fixtures\) \? state\.data\.floor\.fixtures : \[\]/);
  assert.match(renderer, /const fixturesMarkup = dynamicFixtures\.length > 0 \?/);
  assert.doesNotMatch(renderer, /plan-fixture--(?:entrance|bar|kitchen|cashier)/);
  assert.doesNotMatch(renderer, /بار گرم و سرد|تحویل غذا|💳 صندوق/);
});

test('printer check is explicit, synthetic, and does not create or mark a real paid order', () => {
  const start = source.indexOf('function waiterTestReceiptOrder(');
  const end = source.indexOf('async function buildReceiptRasterPayload(', start);
  assert.ok(start >= 0 && end > start, 'isolated test receipt fixture exists');
  const buildFixture = new Function(`${source.slice(start, end)}\nreturn waiterTestReceiptOrder;`)();
  const fixture = buildFixture('2026-09-23T00:00:00.000Z');

  assert.equal(fixture.orderNo, '');
  assert.equal(fixture.tableNo, '');
  assert.equal(fixture.phone, '');
  assert.equal(fixture.paymentStatus, 'unpaid');
  assert.match(fixture.note, /آزمایشی/);
  assert.match(fixture.note, /سفارش یا پرداختی ثبت نشده/);
  assert.ok(fixture.lines.every((line) => /^قلم آزمایشی/u.test(line.name)));
  assert.doesNotMatch(JSON.stringify(fixture), /چیکن پارمسان|چای زعفرانی مخصوص وستو|کوکی شکلاتی|آب معدنی|09120000000/);

  const rasterStart = source.indexOf('async function buildReceiptRasterPayload(');
  const rasterEnd = source.indexOf('async function activePrinter()', rasterStart);
  const raster = source.slice(rasterStart, rasterEnd);
  assert.match(raster, /برگه آزمایشی چاپگر · فاقد اعتبار مالی/);
  assert.match(raster, /test \? 'شناسه آزمایشی' : 'شماره سفارش'/);
  assert.match(raster, /test \? 'مبالغ نمایشی' : 'جمع کل'/);
  assert.match(raster, /test \? 'آزمایشی · فاقد اعتبار مالی'/);
  assert.match(raster, /if \(test\) drawCenter\('سفارش و پرداختی ثبت نشده است'/);
  assert.match(source, /id="printer-test">چاپ برگهٔ تست · فاقد اعتبار مالی/);
  assert.equal((source.match(/test: true/g) || []).length, 1, 'only the dedicated printer-test path can use the fixture');

  const testButton = source.indexOf("document.getElementById('printer-test')");
  const nextRole = source.indexOf('function cashierFloor()', testButton);
  const action = source.slice(testButton, nextRole);
  assert.match(action, /api\('\/api\/cashier\/printer\/test'/);
  assert.doesNotMatch(action, /\/api\/(?:staff|waiter)\/orders/);
});
