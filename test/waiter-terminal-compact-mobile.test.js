'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'role-panel.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'css', 'waiter-floor-plan.css'), 'utf8');

test('waiter workflow is summarized with accessible optional step details', () => {
  assert.match(source, /class="wt-flow__summary"[\s\S]*?class="wt-flow__current" role="status"/);
  assert.match(source, /<details class="wt-flow__details">\s*<summary>نمایش مراحل سفارش<\/summary>/);
  assert.match(source, /id="wt-refresh-flow"/);
  assert.match(source, /تسویه تا بررسی مالی با صندوق متوقف است/);
});

test('waiter category stage removes redundant instructions and keeps search touch-sized', () => {
  const categoryStart = source.indexOf('const categoriesHtml = !showingItems');
  const categoryEnd = source.indexOf('const itemsHtml = showingItems', categoryStart);
  assert.ok(categoryStart >= 0 && categoryEnd > categoryStart, 'category stage markup exists');
  const categories = source.slice(categoryStart, categoryEnd);
  assert.match(categories, /<strong>دسته‌های غذا<\/strong>/);
  assert.doesNotMatch(categories, /برای شروع سفارش، یکی از دسته‌ها را لمس کنید/);
  assert.match(css, /\.wt-menu-category-section \.wt-menu-stage-head \.wt-menu-search\s*\{[^}]*width:\s*100%/);
});

test('mobile waiter table title can wrap without clipping and compact flow rules are present', () => {
  assert.match(css, /body\.is-waiter-floor-app\.is-waiter-terminal \.wt-header__title strong\s*\{[^}]*white-space:\s*normal\s*!important/s);
  assert.match(css, /body\.is-waiter-floor-app\.is-waiter-terminal \.wt-flow__summary\s*\{[^}]*min-height:\s*42px/s);
  assert.match(css, /body\.is-waiter-floor-app\.is-waiter-terminal \.wt-flow__details > summary/);
});
