'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '..', 'css', 'role-panel.css'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'role-panel.html'), 'utf8');
const mobileStart = css.lastIndexOf('/* Mobile POS: keep product names, prices and primary touch targets readable. */');
assert.notEqual(mobileStart, -1, 'the current mobile POS cascade exists');
const mobileCss = css.slice(mobileStart);

function rule(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matches = [...mobileCss.matchAll(new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^}]*)\\}`, 'gm'))];
  assert.ok(matches.length, `mobile CSS rule exists for ${selector}`);
  return matches[matches.length - 1][1];
}

test('cashier mobile category cards use a scrollable two-column layout with readable labels', () => {
  const deck = rule('.is-pos-station .pos-category-deck');
  const title = rule('.is-pos-station .pos-category-card__content b');
  const count = rule('.is-pos-station .pos-category-card__content small');
  assert.match(deck, /grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(deck, /overflow-y:\s*auto/);
  assert.match(deck, /overscroll-behavior:\s*contain/);
  assert.match(title, /font-size:\s*14px/);
  assert.match(count, /font-size:\s*11px/);
});

test('cashier mobile product names use theme ink on light cards and bust the cached stylesheet', () => {
  const title = rule('.is-pos-station .pos-product-card__info b');
  const addLabel = rule('.is-pos-station .pos-product-card__info > span');
  assert.match(title, /color:\s*var\(--rp-ink\)/);
  assert.match(addLabel, /background:\s*var\(--rp-brand-soft\)/);
  assert.match(addLabel, /color:\s*var\(--rp-ink\)/);
  const link = html.match(/<link\s+rel="stylesheet"\s+href="css\/role-panel\.css\?v=([^"]+)"/);
  assert.ok(link);
  assert.equal(link[1], 'ops-mobile-touch-floor-v17');
});
