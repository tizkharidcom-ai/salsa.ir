'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'role-panel.js'), 'utf8');

test('floor map pan capture leaves table clicks available to cashier and waiter', () => {
  const start = source.indexOf('function setupFloorCanvasPanZoom(');
  const end = source.indexOf('function openNewCheck()', start);
  assert.ok(start >= 0 && end > start, 'shared floor-map interaction handler exists');
  const pan = source.slice(start, end);
  const downStart = pan.indexOf("viewport.addEventListener('pointerdown'");
  const downEnd = pan.indexOf("viewport.addEventListener('pointermove'", downStart);
  assert.ok(downStart >= 0 && downEnd > downStart, 'canvas pointer-down handler exists');
  const pointerDown = pan.slice(downStart, downEnd);
  const tableGuard = pointerDown.indexOf("e.target.closest('.plan-table')");
  const capture = pointerDown.indexOf('viewport.setPointerCapture');
  assert.ok(tableGuard >= 0 && tableGuard < capture,
    'pressing a table must bypass canvas pointer capture so its click can open the table');
});

test('cashier order picker and waiter floor still bind table activation handlers', () => {
  assert.match(source, /picker\.querySelectorAll\('\[data-pos-table\]'\)[\s\S]*?startPosCheck\('dine_in', tableId\)/,
    'cashier table selection starts or resumes the check');
  assert.match(source, /el\.addEventListener\('click',[\s\S]*?showTableDetail\(table\.id\)/,
    'waiter table selection opens the table workflow');
});
