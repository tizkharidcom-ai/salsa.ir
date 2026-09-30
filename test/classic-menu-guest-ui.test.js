'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const menuSource = fs.readFileSync(path.join(root, 'js/classic-menu.js'), 'utf8');
const menuCss = fs.readFileSync(path.join(root, 'css/classic-menu.css'), 'utf8');
const catalogueCss = fs.readFileSync(path.join(root, 'css/classic-menu-catalogue-v2.css'), 'utf8');

function menuRules() {
  const marker = '/* Classic menu — Majnoon-inspired UI, Westo data & cart. fa | en | ar */';
  const source = menuSource.slice(0, menuSource.indexOf(marker));
  const context = {};
  vm.runInNewContext(source, context, { filename: 'classic-menu-guest-rules.js' });
  return context.WestoMenuUiRules;
}

test('guest modifier cardinality accepts explicit integers and rejects coerced values', () => {
  const rules = menuRules();
  for (const [value, expected] of [[0, 0], [1, 1], ['2', 2], ['۲', 2], ['٢', 2]]) {
    assert.equal(rules.safeSelectionCount(value), expected);
  }
  for (const invalid of [true, false, [], {}, '1.0', '1e0', '']) {
    assert.equal(rules.safeSelectionCount(invalid), null, `reject ${String(invalid)}`);
  }

  const option = { id: 'o', name: 'Option', price: 0 };
  for (const invalid of [true, [], '1.0']) {
    assert.equal(rules.normalizeGroups([{ id: 'g', title: 'Group', minSelections: invalid, options: [option] }]).ok, false);
    assert.equal(rules.normalizeGroups([{ id: 'g', title: 'Group', maxSelections: invalid, options: [option] }]).ok, false);
  }
});

test('guest search treats Arabic/Persian letter forms, digits, diacritics, and ZWNJ consistently', () => {
  const normalize = menuRules().normalizeSearchText;
  assert.equal(normalize('ي ك ى ۱۲٣'), 'ی ک ی 123');
  assert.equal(normalize('عَرَبی'), normalize('عربی'));
  assert.equal(normalize('سیب\u200cزمینی'), normalize('سیب زمینی'));

  assert.match(menuSource, /const value = normalizeSearchText\([\s\S]*?cat \? catTitle\(cat\)/);
  assert.match(menuSource, /const q = menuRules\?\.normalizeSearchText\(query\)/);
});

test('required and optional add-ons resolve to a truthful unit price and reject unavailable choices', () => {
  const rules = menuRules();
  const groups = rules.normalizeGroups([
    {
      id: 'required', title: 'Required', selection: 'single', required: true,
      options: [{ id: 'base', name: 'Base', price: 0 }, { id: 'sold-out', name: 'Unavailable', price: 90, available: false }],
    },
    {
      id: 'extra', title: 'Optional', selection: 'multiple', maxSelections: 2,
      options: [{ id: 'addon', name: 'Add-on', price: 25 }],
    },
  ]);

  assert.equal(groups.ok, true);
  assert.equal(rules.resolveSelection(groups, [], 100).error, 'selection_count');
  assert.equal(rules.resolveSelection(groups, [{ groupId: 'required', id: 'sold-out' }], 100).error, 'invalid_selection');
  assert.equal(rules.resolveSelection(groups, [{ groupId: 'required', id: 'base' }], 100).unitPrice, 100);
  assert.equal(rules.resolveSelection(groups, [
    { groupId: 'required', id: 'base' }, { groupId: 'extra', id: 'addon' },
  ], 100).unitPrice, 125);
});

test('unavailable and unpriced menu items remain visibly non-orderable and modifiers label base price', () => {
  assert.match(menuSource, /const out = m\.available !== true/);
  assert.match(menuSource, /const orderBlocked = out \|\| outOfStock \|\| off \|\| !priceKnown/);
  assert.match(menuSource, /const hasModifierGroups = Array\.isArray\(detailItem\.modifierGroups\)/);
  assert.match(menuSource, /قیمت پایه/);
  assert.match(menuSource, /els\.detailAdd\.disabled = !pricing\.ok/);
  assert.match(menuSource, /detailModifierMessage\.textContent = pricing\.ok \? ''/);
  assert.match(menuSource, /if \(pricing\.ok && addToCart\(detailItem, detailQty, pricing\.modifiers\)\) closeDetail\(\)/);
  assert.match(menuSource, /window\.westoTable\.addDirect\(cartItem, q, \{/);
});

test('modifier and purchase controls retain mobile touch, wrapping, and visible focus affordances', () => {
  assert.match(menuCss, /\.cm-modifier__option[\s\S]*?min-height:\s*2\.9rem/);
  assert.match(menuCss, /\.cm-detail__price[\s\S]*?overflow-wrap:\s*anywhere/);
  assert.match(catalogueCss, /\.cm-modifier__option,\.menu-modifier-option\):focus-within[\s\S]*?outline:\s*3px solid/);
  assert.match(catalogueCss, /@media \(max-width: 559px\)[\s\S]*?\.cm-detail__actions[\s\S]*?width:\s*100%/);
  assert.match(catalogueCss, /\.cm-item__badge[\s\S]*?white-space:\s*normal/);
});
