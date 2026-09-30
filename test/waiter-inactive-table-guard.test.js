'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'role-panel.js'), 'utf8');

function renderPlanTableForTest(state) {
  const start = source.indexOf('  function renderPlanTable(table, options = {}) {');
  const end = source.indexOf('\n  function buildPlanCanvasHtml(', start);
  assert.ok(start >= 0 && end > start, 'floor plan table renderer exists');
  const renderer = new Function(
    'state', 'esc', 'num', 'getComputedTableCoords', 'floorCountdownLabel',
    `${source.slice(start, end)}\nreturn renderPlanTable;`,
  )(
    state,
    (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]),
    String,
    () => ({ x: 50, y: 50 }),
    () => '',
  );
  return renderer;
}

test('inactive floor-plan table is visibly unavailable and removed from waiter keyboard order', () => {
  const render = renderPlanTableForTest({ selectedTableId: null });
  const html = render({ id: 7, label: 'میز ۷', active: false, seats: 4, zone: 'سالن', state: 'available' }, {
    disableInactive: true,
    isEditMode: false,
    attr: () => 'data-table="7"',
  });

  assert.match(html, /class="plan-table[^\"]*is-inactive/);
  assert.match(html, /tabindex="-1"/);
  assert.match(html, /aria-disabled="true"/);
  assert.match(html, /data-state="inactive"/);
  assert.match(html, /غیرفعال؛ برای سفارش از میز فعال استفاده کنید/);
});

test('inactive tables remain selectable when editing the floor layout', () => {
  const render = renderPlanTableForTest({ selectedTableId: null });
  const html = render({ id: 7, label: 'میز ۷', active: false, seats: 4, zone: 'سالن' }, {
    disableInactive: true,
    isEditMode: true,
    attr: () => 'data-table="7"',
  });

  assert.match(html, /tabindex="0"/);
  assert.match(html, /aria-disabled="false"/);
  assert.doesNotMatch(html, /class="plan-table[^\"]*is-inactive/);
});

test('waiter floor guards plan clicks and disables inactive tables in the card grid', () => {
  const waiterStart = source.indexOf('  function waiterFloor() {');
  const waiterEnd = source.indexOf('  function wireWaiterFloorEvents()', waiterStart);
  const waiterMarkup = source.slice(waiterStart, waiterEnd);
  const eventsStart = waiterEnd;
  const eventsEnd = source.indexOf('\n  function ', eventsStart + 10);
  const eventWiring = source.slice(eventsStart, eventsEnd);

  assert.match(waiterMarkup, /disableInactive: true/);
  assert.match(waiterMarkup, /table\.active === false && !state\.waiterFloorEditing \? 'disabled aria-disabled="true" title=/);
  assert.match(eventWiring, /if \(table\.active === false && !state\.waiterFloorEditing\) return;/);
});
