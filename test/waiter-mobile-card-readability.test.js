'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '..', 'css', 'waiter-floor-plan.css'), 'utf8');
const roleCss = fs.readFileSync(path.join(__dirname, '..', 'css', 'role-panel.css'), 'utf8');
const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'role-panel.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'role-panel.html'), 'utf8');
const finalMarker = '/* Final mobile override lives in the last-loaded waiter stylesheet';
const finalMarkerIndex = css.lastIndexOf(finalMarker);
assert.notEqual(finalMarkerIndex, -1, 'final waiter mobile override exists');
const finalCss = css.slice(finalMarkerIndex);
const roleMarker = '/* Waiter menu card cascade guard:';
const roleMarkerIndex = roleCss.lastIndexOf(roleMarker);
assert.notEqual(roleMarkerIndex, -1, 'role panel has a high-specificity mobile cascade guard');
const roleMobileCss = roleCss.slice(roleMarkerIndex);

function getRule(stylesheet, selector) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = stylesheet.match(new RegExp(`(?:^|\\n)\\s*${escapedSelector}\\s*\\{([^}]*)\\}`, 'm'));
  assert.ok(match, `CSS rule exists for ${selector}`);
  return match[1];
}

function getLastRule(stylesheet, selector) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matches = [...stylesheet.matchAll(new RegExp(`(?:^|\\n)\\s*${escapedSelector}\\s*\\{([^}]*)\\}`, 'gm'))];
  assert.ok(matches.length, `CSS rule exists for ${selector}`);
  return matches[matches.length - 1][1];
}

test('role panel cache-busts the current waiter mobile-card stylesheet', () => {
  const roleCssLink = html.match(/<link\s+rel="stylesheet"\s+href="css\/role-panel\.css\?v=([^"]+)"/);
  assert.ok(roleCssLink, 'role panel stylesheet is explicitly versioned');
  assert.equal(roleCssLink[1], 'ops-mobile-touch-floor-v17', 'mobile card cascade guard cannot reuse the previous cached role panel stylesheet');
  const cssLink = html.match(/<link\s+rel="stylesheet"\s+href="css\/waiter-floor-plan\.css\?v=([^"]+)"/);
  assert.ok(cssLink, 'waiter stylesheet is explicitly versioned');
  assert.equal(cssLink[1], 'waiter-mobile-cards-v18-payment-stage', 'updated mobile-card rules cannot reuse the previous cached stylesheet');
  assert.ok(html.indexOf('css/waiter-floor-plan.css') > html.indexOf('css/kitchen-kds.css'), 'waiter overrides load after shared and KDS styles');
});

test('waiter mobile order cards keep status text readable and action buttons touch-sized', () => {
  const status = getRule(finalCss, 'body.is-waiter-workspace .order-card__meta');
  const actions = getRule(finalCss, 'body.is-waiter-workspace .order-card__bottom > button');
  const create = getRule(finalCss, 'body.is-waiter-workspace #new-order.role-primary');

  assert.match(status, /font-size:\s*14px/);
  assert.match(status, /line-height:\s*1\.55/);
  assert.match(actions, /min-height:\s*44px/);
  assert.match(actions, /white-space:\s*normal/);
  assert.match(create, /font-size:\s*14px/);
  assert.match(create, /min-height:\s*48px/);
});

test('source contract: the mobile card override covers 320px, 390px, and the reported 510px viewport', () => {
  const targetViewports = [320, 390, 510];
  const breakpoint = finalCss.match(/@media\s*\(max-width:\s*(\d+)px\)/);
  assert.ok(breakpoint, 'final mobile rules have an explicit max-width breakpoint');

  const maxWidth = Number(breakpoint[1]);
  for (const viewport of targetViewports) {
    assert.ok(viewport <= maxWidth, `${viewport}px is covered by the ${maxWidth}px override`);
  }
});

test('final waiter order-card rules cover 320-430px with readable wrapping and scoped layout', () => {
  const marker = '/* Final 320-430px waiter ordering pass; deliberately isolated from POS and KDS. */';
  const start = roleCss.lastIndexOf(marker);
  assert.notEqual(start, -1, 'final narrow waiter override exists in role-panel.css');
  const mobileCss = roleCss.slice(start);
  const media = mobileCss.match(/@media\s*\(max-width:\s*(\d+)px\)/);
  assert.equal(Number(media?.[1]), 430);

  for (const viewport of [320, 360, 390, 430]) {
    assert.ok(viewport <= Number(media[1]), `${viewport}px is covered by the waiter-only override`);
  }

  assert.match(mobileCss, /html body\.is-waiter-floor-app\.is-waiter-terminal/);
  assert.doesNotMatch(mobileCss, /(^|\n)\s*\.pos-|(^|\n)\s*\.kds-/);
  const list = getRule(mobileCss, 'html body.is-waiter-floor-app.is-waiter-terminal .wt-menu-screen .wt-menu-stage .wt-items-list');
  const card = getRule(mobileCss, 'html body.is-waiter-floor-app.is-waiter-terminal .wt-menu-screen .wt-menu-stage .wt-items-list .wt-item-card');
  const title = getRule(mobileCss, 'html body.is-waiter-floor-app.is-waiter-terminal .wt-menu-screen .wt-menu-stage .wt-item-card__info strong');
  const price = getRule(mobileCss, 'html body.is-waiter-floor-app.is-waiter-terminal .wt-menu-screen .wt-menu-stage .wt-item-card__info > span:not(.wt-stock-badge)');
  const wrapping = mobileCss.match(/html body\.is-waiter-floor-app\.is-waiter-terminal \.wt-menu-screen \.wt-menu-stage \.wt-item-card__info strong,[\s\S]*?\{([^}]*)\}/);

  assert.match(list, /grid-template-columns:\s*minmax\(0,\s*1fr\)\s*!important/);
  assert.match(list, /overflow-x:\s*hidden\s*!important/);
  assert.match(card, /min-height:\s*104px\s*!important/);
  assert.match(card, /grid-template-columns:\s*76px\s+minmax\(0,\s*1fr\)\s*!important/);
  assert.ok(wrapping, 'dish name, price and stock share wrapping rules');
  assert.match(wrapping[1], /white-space:\s*normal\s*!important/);
  assert.match(wrapping[1], /overflow-wrap:\s*anywhere\s*!important/);
  assert.match(title, /font-size:\s*16px\s*!important/);
  assert.match(price, /font-size:\s*14px\s*!important/);
});

test('waiter primary ordering actions keep touch-sized targets and Persian labels can wrap', () => {
  const marker = '/* Final 320-430px waiter ordering pass; deliberately isolated from POS and KDS. */';
  const mobileCss = roleCss.slice(roleCss.lastIndexOf(marker));
  const add = getRule(mobileCss, 'html body.is-waiter-floor-app.is-waiter-terminal .wt-menu-screen .wt-menu-stage .wt-item-card .wt-item-row__add-btn');
  const actions = mobileCss.match(/html body\.is-waiter-floor-app\.is-waiter-terminal \.wt-tabs \.wt-tab,[\s\S]*?\{([^}]*)\}/);
  assert.ok(actions, 'waiter order and flow controls share a touch-size rule');

  assert.match(add, /width:\s*48px\s*!important/);
  assert.match(add, /height:\s*48px\s*!important/);
  assert.match(add, /min-width:\s*48px\s*!important/);
  assert.match(add, /min-height:\s*48px\s*!important/);
  assert.match(actions[1], /min-height:\s*48px\s*!important/);
  assert.match(actions[1], /white-space:\s*normal\s*!important/);
  assert.match(actions[1], /overflow-wrap:\s*anywhere\s*!important/);

  const narrow = mobileCss.slice(mobileCss.lastIndexOf('@media (max-width: 360px)'));
  const narrowCard = getRule(narrow, 'html body.is-waiter-floor-app.is-waiter-terminal .wt-menu-screen .wt-menu-stage .wt-items-list .wt-item-card');
  assert.match(narrowCard, /grid-template-columns:\s*64px\s+minmax\(0,\s*1fr\)\s*!important/);
});

test('role panel mobile cascade guard keeps waiter item names and prices from cropping at 320-510px', () => {
  const viewportRule = roleMobileCss.match(/@media\s*\(max-width:\s*(\d+)px\)/);
  assert.ok(viewportRule);
  for (const viewport of [320, 390, 510]) {
    assert.ok(viewport <= Number(viewportRule[1]), `${viewport}px is covered by the role panel override`);
  }

  const list = getRule(roleMobileCss, 'html body.is-waiter-floor-app.is-waiter-terminal .wt-menu-screen .wt-menu-stage .wt-items-list');
  const card = getRule(roleMobileCss, 'html body.is-waiter-floor-app.is-waiter-terminal .wt-menu-screen .wt-menu-stage .wt-items-list .wt-item-card');
  const textRules = roleMobileCss.match(/html body\.is-waiter-floor-app\.is-waiter-terminal \.wt-menu-screen \.wt-menu-stage \.wt-item-card__info strong,[\s\S]*?\{([^}]*)\}/);
  assert.ok(textRules, 'title and price share the no-crop rule');
  const title = getLastRule(roleMobileCss, 'html body.is-waiter-floor-app.is-waiter-terminal .wt-menu-screen .wt-menu-stage .wt-item-card__info strong');
  const price = getLastRule(roleMobileCss, 'html body.is-waiter-floor-app.is-waiter-terminal .wt-menu-screen .wt-menu-stage .wt-item-card__info > span:not(.wt-stock-badge)');

  assert.match(list, /grid-template-columns:\s*minmax\(0,\s*1fr\)\s*!important/);
  assert.match(card, /grid-template-columns:\s*76px\s+minmax\(0,\s*1fr\)\s*!important/);
  for (const rule of [textRules[1]]) {
    assert.match(rule, /overflow:\s*visible\s*!important/);
    assert.match(rule, /text-overflow:\s*clip\s*!important/);
    assert.match(rule, /white-space:\s*normal\s*!important/);
    assert.match(rule, /overflow-wrap:\s*anywhere\s*!important/);
  }
  assert.match(title, /font-size:\s*16px\s*!important/);
  assert.match(price, /font-size:\s*14px\s*!important/);
  assert.match(title, /-webkit-line-clamp:\s*unset\s*!important/);
});

test('source contract: menu list and cards constrain their width and prevent horizontal list scrolling', () => {
  const list = getRule(finalCss, 'body.is-waiter-floor-app.is-waiter-terminal .wt-menu-screen .wt-menu-stage .wt-items-list');
  const card = getRule(finalCss, 'body.is-waiter-floor-app.is-waiter-terminal .wt-menu-screen .wt-menu-stage .wt-items-list .wt-item-card');
  const info = getRule(finalCss, 'body.is-waiter-floor-app.is-waiter-terminal .wt-menu-screen .wt-menu-stage .wt-item-card__info');

  assert.match(list, /grid-template-columns:\s*minmax\(0,\s*1fr\)\s*!important/);
  assert.match(list, /min-width:\s*0\s*!important/);
  assert.match(list, /max-width:\s*100%\s*!important/);
  assert.match(list, /overflow-x:\s*hidden\s*!important/);
  assert.match(card, /grid-template-columns:\s*76px\s+minmax\(0,\s*1fr\)\s*!important/);
  assert.match(card, /min-width:\s*0\s*!important/);
  assert.match(card, /max-width:\s*100%\s*!important/);
  assert.match(info, /min-width:\s*0\s*!important/);
  assert.match(info, /max-width:\s*100%\s*!important/);
});

test('source contract: dish name, price, and stock text stay readable and can wrap', () => {
  const title = getRule(finalCss, 'body.is-waiter-floor-app.is-waiter-terminal .wt-menu-screen .wt-menu-stage .wt-item-card__info strong');
  const price = getRule(finalCss, 'body.is-waiter-floor-app.is-waiter-terminal .wt-menu-screen .wt-menu-stage .wt-item-card__info > span:not(.wt-stock-badge)');
  const stock = getRule(finalCss, 'body.is-waiter-floor-app.is-waiter-terminal .wt-menu-screen .wt-menu-stage .wt-item-card__info .wt-stock-badge');

  assert.match(title, /font-size:\s*16px\s*!important/);
  assert.match(title, /line-height:\s*1\.5\s*!important/);
  assert.match(title, /display:\s*block\s*!important/);
  assert.match(title, /overflow:\s*visible\s*!important/);
  assert.match(title, /white-space:\s*normal\s*!important/);
  assert.match(title, /overflow-wrap:\s*anywhere\s*!important/);
  assert.match(title, /-webkit-line-clamp:\s*unset\s*!important/);
  assert.match(price, /font-size:\s*14px\s*!important/);
  assert.match(price, /line-height:\s*1\.5\s*!important/);
  assert.match(price, /white-space:\s*normal\s*!important/);
  assert.match(price, /overflow-wrap:\s*anywhere\s*!important/);
  assert.match(stock, /white-space:\s*normal/);
  assert.match(stock, /overflow-wrap:\s*anywhere/);
});

test('source contract: add, fire, send, and menu-option controls have touch-sized targets', () => {
  const add = getRule(finalCss, 'body.is-waiter-floor-app.is-waiter-terminal .wt-menu-screen .wt-menu-stage .wt-item-card .wt-item-row__add-btn');
  const fire = getRule(finalCss, 'body.is-waiter-floor-app.is-waiter-terminal .wt-fire-btn');
  const options = getRule(finalCss, 'body.is-waiter-floor-app.is-waiter-terminal .wt-item-dialog .wt-seat-chip');
  const optionSmall = getRule(finalCss, 'body.is-waiter-floor-app.is-waiter-terminal .wt-item-dialog .wt-seat-chip small');
  const quantity = getRule(finalCss, 'body.is-waiter-floor-app.is-waiter-terminal .wt-item-dialog #drawer-inc-qty');
  const sendActions = finalCss.match(/body\.is-waiter-floor-app\.is-waiter-terminal \.wt-item-dialog #drawer-add-to-check,\s*body\.is-waiter-floor-app\.is-waiter-terminal \.wt-send-btn\s*\{([^}]*)\}/);

  assert.match(add, /width:\s*48px\s*!important/);
  assert.match(add, /height:\s*48px\s*!important/);
  assert.match(add, /min-width:\s*48px\s*!important/);
  assert.match(add, /min-height:\s*48px\s*!important/);
  assert.match(fire, /min-width:\s*48px\s*!important/);
  assert.match(fire, /min-height:\s*48px\s*!important/);
  assert.match(options, /min-height:\s*48px\s*!important/);
  assert.match(options, /font-size:\s*14px\s*!important/);
  assert.match(options, /white-space:\s*normal\s*!important/);
  assert.match(optionSmall, /font-size:\s*12px\s*!important/);
  assert.match(quantity, /width:\s*48px\s*!important/);
  assert.match(quantity, /min-height:\s*48px\s*!important/);
  assert.ok(sendActions, 'send and add-to-check buttons share a mobile touch-target rule');
  assert.match(sendActions[1], /min-height:\s*48px\s*!important/);
});

test('source contract: item cards and option chips define readable light and dark theme colors', () => {
  const lightCard = getRule(css, '.wt-menu-stage .wt-item-card');
  const darkCard = getRule(css, "html[data-theme='dark'] .wt-menu-stage .wt-item-card");
  const lightPrice = getRule(css, '.wt-menu-stage .wt-item-card__info span');
  const darkPrice = getRule(css, "html[data-theme='dark'] .wt-menu-stage .wt-item-card__info span");
  const lightOption = getRule(css, '.wt-item-dialog .wt-seat-chip');
  const darkOption = getRule(css, "html[data-theme='dark'] .wt-item-dialog .wt-seat-chip");

  assert.match(lightCard, /background:/);
  assert.match(darkCard, /color:\s*#f8fafc/);
  assert.match(lightPrice, /color:\s*#007ea7/);
  assert.match(darkPrice, /color:\s*#55c8e1/);
  assert.match(lightOption, /color:\s*#21484c/);
  assert.match(darkOption, /color:\s*#e4f3f3/);
});

test('role-panel waiter table and call cards wrap long operational labels on phones', () => {
  const marker = '/* Waiter mobile cards: let operational labels wrap instead of hiding table state. */';
  const start = roleCss.lastIndexOf(marker);
  assert.notEqual(start, -1, 'waiter card overrides load in the permitted role-panel stylesheet');
  const mobileCards = roleCss.slice(start);
  const status = getRule(mobileCards, 'html body.is-waiter-floor-app .floor-table.waiter-table-card .waiter-table-card__top b');
  const table = getRule(mobileCards, 'html body.is-waiter-floor-app .floor-grid .floor-table.waiter-table-card');
  const calls = getRule(mobileCards, 'html body.is-waiter-workspace .call-row');
  const callButton = getRule(mobileCards, 'html body.is-waiter-workspace .call-row > button');

  assert.match(table, /min-height:\s*156px\s*!important/);
  assert.match(status, /font-size:\s*14px\s*!important/);
  assert.match(status, /white-space:\s*normal\s*!important/);
  assert.match(status, /overflow:\s*visible\s*!important/);
  assert.match(status, /overflow-wrap:\s*anywhere\s*!important/);
  assert.match(calls, /grid-template-columns:\s*minmax\(0,\s*1fr\)\s*!important/);
  assert.match(callButton, /min-height:\s*48px/);
});

test('waiter floor-card accessible names include the service counts shown visually', () => {
  const floor = source.slice(source.indexOf('function waiterFloor() {'), source.indexOf('function wireWaiterFloorEvents()'));
  const start = floor.indexOf('const classicGridHtml =');
  const end = floor.indexOf('main.innerHTML =', start);
  const card = floor.slice(start, end);
  assert.match(card, /table\.calls\.length \? `\$\{num\(table\.calls\.length\)\} فراخوان باز`/);
  assert.match(card, /table\.readyOrders\.length \? `\$\{num\(table\.readyOrders\.length\)\} سفارش آماده تحویل`/);
  assert.match(card, /table\.orders\.length \? `\$\{num\(table\.orders\.length\)\} فاکتور باز`/);
  assert.match(card, /aria-label="\$\{esc\(\[/);
});
