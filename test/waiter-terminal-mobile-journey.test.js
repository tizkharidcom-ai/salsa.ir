'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '..', 'css', 'waiter-floor-plan.css'), 'utf8');
const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'role-panel.js'), 'utf8');

function balancedBlock(text, openBraceIndex) {
  let depth = 0;
  for (let index = openBraceIndex; index < text.length; index += 1) {
    if (text[index] === '{') depth += 1;
    if (text[index] === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(openBraceIndex + 1, index);
    }
  }
  throw new Error('Unclosed CSS block');
}

function mediaBlock(maxWidth) {
  const expression = new RegExp(`@media\\s*\\(max-width:\\s*${maxWidth}px\\)\\s*\\{`, 'g');
  const matches = [...css.matchAll(expression)];
  const match = matches.at(-1);
  assert.ok(match, `max-width ${maxWidth}px media query exists`);
  const openBraceIndex = match.index + match[0].lastIndexOf('{');
  return balancedBlock(css, openBraceIndex);
}

function ruleBlock(stylesheet, selector) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const expression = new RegExp(`(?:^|\\n)\\s*${escapedSelector}\\s*\\{`, 'm');
  const match = expression.exec(stylesheet);
  assert.ok(match, `rule exists: ${selector}`);
  const openBraceIndex = match.index + match[0].lastIndexOf('{');
  return balancedBlock(stylesheet, openBraceIndex);
}

const narrow = mediaBlock(390);
const extraNarrow = mediaBlock(360);

test('floor table cards keep state and invoice details readable on small phones', () => {
  assert.match(css, /body\.is-waiter-floor-app \.floor-table\.waiter-table-card\s*\{[^}]*min-height:\s*136px/s);
  assert.match(css, /body\.is-waiter-floor-app \.floor-table\.waiter-table-card \.waiter-table-card__top b\s*\{[^}]*font-size:\s*14px/s);
  assert.match(css, /body\.is-waiter-floor-app \.floor-table\.waiter-table-card em\s*\{[^}]*font-size:\s*14px/s);
});

test('mobile acceptance widths are covered by the narrow-screen rules', () => {
  const smallestFloorGrid = mediaBlock(370);
  assert.match(smallestFloorGrid, /body\.is-waiter-floor-app \.floor-grid\s*\{[^}]*grid-template-columns:\s*1fr/s,
    '320px and 360px waiter table cards use a readable single column');
  assert.match(css, /@media\s*\(max-width:\s*640px\)/, 'existing narrow terminal rules cover all target widths');
});

test('mobile floor view defaults to readable cards even when an old saved preference selected the scaled plan', () => {
  assert.match(source, /'westo_waiter_floor_mode_mobile_v2'/,
    'mobile uses a versioned preference so stale plan selections do not force unreadable scaled tables');
  assert.match(source, /\(isMobile \? 'grid' : 'plan'\)/,
    'a phone without an explicit current-version choice opens the readable card view');
});

test('waiter floor cards and zone filters remain keyboard-operable, named controls', () => {
  assert.ok(source.includes('<button class="floor-table waiter-table-card'), 'each floor card is a native button');
  const floorSource = source.slice(source.indexOf('function waiterFloor() {'), source.indexOf('function wireWaiterFloorEvents()'));
  const floorCardMarkup = floorSource.slice(floorSource.indexOf('const classicGridHtml ='), floorSource.indexOf('main.innerHTML =', floorSource.indexOf('const classicGridHtml =')));
  assert.match(floorCardMarkup, /aria-label="\$\{esc\(\[[\s\S]*?table\.label \|\| `میز \$\{table\.id\}`[\s\S]*?table\.stateLabel[\s\S]*?\.join\('، '\)\)\}"/,
    'floor card accessible name includes table name, service state, and related counts');
  assert.ok(source.includes('<button type="button" class="floor-zone-pill') && source.includes('data-zone-filter="${esc(z)}"'),
    'zone filters are native buttons, so Enter and Space activation is built in');
  assert.match(source, /data-zone-filter="\$\{esc\(z\)\}" aria-pressed="\$\{state\.waiterFloorZone === z \? 'true' : 'false'\}"/,
    'the selected hall zone is exposed to assistive technology');

  const mobileControls = mediaBlock(768);
  assert.match(mobileControls, /body\.is-waiter-floor-app \.floor-zone-pill,[\s\S]*?body\.is-waiter-floor-app \.floor-segmented__btn\s*\{[^}]*min-height:\s*44px/s,
    'zone filters and floor-mode buttons meet the minimum touch height');
  assert.match(css, /body\.is-waiter-floor-app \.floor-table\.waiter-table-card\s*\{[^}]*min-height:\s*136px/s,
    'waiter table cards have a generous handheld target');
});

test('terminal containers and menu viewport are width-constrained on narrow phones', () => {
  const containerMatch = narrow.match(/body\.is-waiter-floor-app\.is-waiter-terminal \.waiter-terminal-screen,[\s\S]*?body\.is-waiter-floor-app\.is-waiter-terminal \.wt-menu-screen\s*\{([^}]*)\}/);
  const viewport = ruleBlock(narrow, 'body.is-waiter-floor-app.is-waiter-terminal .wt-viewport');

  assert.ok(containerMatch, 'terminal shell surfaces share a bounded-width rule');
  assert.match(containerMatch[1], /box-sizing:\s*border-box/);
  assert.match(containerMatch[1], /min-width:\s*0/);
  assert.match(containerMatch[1], /max-width:\s*100%/);
  assert.match(viewport, /overflow-x:\s*hidden/);
});

test('product cards keep readable content, wrapping, and a 48px add target', () => {
  const card = ruleBlock(css, 'body.is-waiter-floor-app.is-waiter-terminal .wt-menu-screen .wt-menu-stage .wt-items-list .wt-item-card');
  const title = ruleBlock(css, 'body.is-waiter-floor-app.is-waiter-terminal .wt-menu-screen .wt-menu-stage .wt-item-card__info strong');
  const price = ruleBlock(css, 'body.is-waiter-floor-app.is-waiter-terminal .wt-menu-screen .wt-menu-stage .wt-item-card__info > span:not(.wt-stock-badge)');
  const add = ruleBlock(css, 'body.is-waiter-floor-app.is-waiter-terminal .wt-menu-screen .wt-menu-stage .wt-item-card .wt-item-row__add-btn');

  assert.match(card, /grid-template-columns:\s*76px\s+minmax\(0,\s*1fr\)\s*!important/);
  assert.match(card, /min-width:\s*0\s*!important/);
  assert.match(title, /font-size:\s*16px\s*!important/);
  assert.match(title, /white-space:\s*normal\s*!important/);
  assert.match(title, /overflow-wrap:\s*anywhere\s*!important/);
  assert.match(price, /font-size:\s*14px\s*!important/);
  assert.match(price, /white-space:\s*normal\s*!important/);
  assert.match(add, /width:\s*48px\s*!important/);
  assert.match(add, /height:\s*48px\s*!important/);
});

test('category choices use two readable columns with touch-sized cards at 320–390px', () => {
  const grid = ruleBlock(narrow, 'body.is-waiter-floor-app.is-waiter-terminal .wt-menu-stage .wt-cat-grid');
  const card = ruleBlock(narrow, 'body.is-waiter-floor-app.is-waiter-terminal .wt-menu-stage .wt-cat-card');
  const title = ruleBlock(narrow, 'body.is-waiter-floor-app.is-waiter-terminal .wt-menu-stage .wt-cat-card strong');
  const count = ruleBlock(narrow, 'body.is-waiter-floor-app.is-waiter-terminal .wt-menu-stage .wt-cat-card small');

  assert.match(grid, /grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(card, /min-height:\s*72px/);
  assert.match(title, /font-size:\s*13px/);
  assert.match(title, /white-space:\s*normal/);
  assert.match(title, /overflow-wrap:\s*anywhere/);
  assert.match(count, /font-size:\s*11px/);
});

test('order journey stepper and status refresh remain legible and reachable', () => {
  const steps = ruleBlock(narrow, 'body.is-waiter-floor-app.is-waiter-terminal .wt-flow__steps');
  const step = ruleBlock(narrow, 'body.is-waiter-floor-app.is-waiter-terminal .wt-flow__step');
  const meta = ruleBlock(narrow, 'body.is-waiter-floor-app.is-waiter-terminal .wt-flow__meta');
  const hint = ruleBlock(narrow, 'body.is-waiter-floor-app.is-waiter-terminal .wt-flow__meta p');
  const refresh = ruleBlock(narrow, 'body.is-waiter-floor-app.is-waiter-terminal .wt-flow__refresh');

  assert.match(steps, /grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(step, /font-size:\s*14px/);
  assert.match(step, /overflow-wrap:\s*anywhere/);
  assert.match(meta, /grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  assert.match(hint, /font-size:\s*13px/);
  assert.match(refresh, /min-height:\s*48px/);

  for (const label of ['سفارش', 'آماده‌سازی', 'تحویل', 'تسویه']) {
    assert.ok(source.includes(`{ label: '${label}'`), `workflow includes the ${label} stage`);
  }
  assert.match(source, /const preparationComplete = \['ready',[\s\S]*?\['done', 'completed', 'picked_up', 'delivered'\]/);
  assert.match(source, /سفارش ثبت شد؛ تا آماده‌شدن غذا/);
  const mobileTerminal = mediaBlock(640);
  assert.match(mobileTerminal, /body\.is-waiter-floor-app\.is-waiter-terminal \.wt-flow__step\s*\{[^}]*font-size:\s*13px/s);
});

test('tabs fit four columns and remove decorative icons only at 320–360px', () => {
  const tabs = ruleBlock(narrow, 'body.is-waiter-floor-app.is-waiter-terminal .wt-tabs');
  const tab = ruleBlock(narrow, 'body.is-waiter-floor-app.is-waiter-terminal .wt-tab');
  const icons = ruleBlock(extraNarrow, 'body.is-waiter-floor-app.is-waiter-terminal .wt-tab > span:first-child');

  assert.match(tabs, /grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(tab, /min-width:\s*0/);
  assert.match(tab, /min-height:\s*52px/);
  assert.match(icons, /display:\s*none/);
  assert.ok(source.includes('data-wt-tab="menu"'));
  assert.ok(source.includes('data-wt-tab="check"'));
  assert.ok(source.includes('data-wt-tab="actions"'));
  assert.ok(source.includes('data-wt-tab="guest"'));
});

test('invoice summary reserves room for its bottom action without horizontal growth', () => {
  const summary = ruleBlock(narrow, 'body.is-waiter-floor-app.is-waiter-terminal .wt-summary-bar');
  const actions = ruleBlock(narrow, 'body.is-waiter-floor-app.is-waiter-terminal .wt-summary-bar__buttons');
  const buttonMatch = narrow.match(/body\.is-waiter-floor-app\.is-waiter-terminal \.wt-summary-bar__buttons \.wt-send-btn,\s*body\.is-waiter-floor-app\.is-waiter-terminal \.wt-summary-bar__buttons \.wt-pay-btn,\s*body\.is-waiter-floor-app\.is-waiter-terminal \.wt-summary-bar__buttons \.wt-serve-btn\s*\{([^}]*)\}/);
  const check = ruleBlock(narrow, 'body.is-waiter-floor-app.is-waiter-terminal .wt-check-view');

  assert.match(summary, /display:\s*grid/);
  assert.match(summary, /grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  assert.match(summary, /width:\s*100%/);
  assert.match(actions, /min-width:\s*0/);
  assert.match(actions, /grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  assert.ok(buttonMatch, 'primary waiter actions have a shared narrow-screen rule');
  assert.match(buttonMatch[1], /min-height:\s*52px/);
  assert.match(buttonMatch[1], /white-space:\s*normal/);
  assert.match(check, /padding-bottom:\s*calc\(240px\s*\+\s*env\(safe-area-inset-bottom\)\)/);
});
