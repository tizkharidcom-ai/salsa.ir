'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const cartSource = fs.readFileSync(path.join(root, 'js/table-cart.js'), 'utf8');
const menuSource = fs.readFileSync(path.join(root, 'js/classic-menu.js'), 'utf8');
const menuHtml = fs.readFileSync(path.join(root, 'menu.html'), 'utf8');

function cartRules(startMarker, endMarker, extras = {}) {
  const start = cartSource.indexOf(startMarker);
  const end = cartSource.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `${startMarker.trim()} remains independently testable`);
  const context = { ...extras };
  vm.runInNewContext(cartSource.slice(start, end), context);
  return context;
}

test('stored cart migration recovers valid lines, clamps quantities, and reports unknown data', () => {
  const normalizeDigits = (value) => String(value)
    .replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
    .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)));
  const { parseStoredCartSnapshot } = cartRules('  function storedCartInteger(value) {', '\n  function loadCart', { normalizeDigits });
  const migrated = parseStoredCartSnapshot(JSON.stringify({ lines: [
    { menuItemId: 12, qty: 130, price: 200 },
    { menuItemId: 13, qty: 2, price: 400 },
    { menuItemId: 'bad', qty: 1 },
    { menuItemId: 14, qty: 0 },
  ] }));

  assert.deepEqual(JSON.parse(JSON.stringify(migrated.lines)), [
    { menuItemId: 12, qty: 99, price: 200 },
    { menuItemId: 13, qty: 2, price: 400 },
  ]);
  assert.equal(migrated.recoveredCount, 3);
  assert.equal(migrated.invalidPayload, false);
  assert.equal(parseStoredCartSnapshot('{bad').invalidPayload, true);
  assert.equal(parseStoredCartSnapshot('{"unexpected":true}').invalidPayload, true);
  assert.equal(parseStoredCartSnapshot('').invalidPayload, true);
});

test('stored cart IDs and quantities accept only positive integer numbers or decimal strings', () => {
  const normalizeDigits = (value) => String(value)
    .replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
    .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)));
  const { parseStoredCartSnapshot } = cartRules('  function storedCartInteger(value) {', '\n  function loadCart', { normalizeDigits });
  const parsed = parseStoredCartSnapshot(JSON.stringify({ lines: [
    { menuItemId: '۰۰۷', qty: '۳' },
    { menuItemId: '١٣', qty: '٢' },
    { menuItemId: 14, qty: 4 },
    { menuItemId: '1e2', qty: 1 },
    { menuItemId: '0x10', qty: 1 },
    { menuItemId: true, qty: 1 },
    { menuItemId: 15, qty: '1e2' },
    { menuItemId: 16, qty: true },
  ] }));

  assert.deepEqual(JSON.parse(JSON.stringify(parsed.lines)), [
    { menuItemId: 7, qty: 3 },
    { menuItemId: 13, qty: 2 },
    { menuItemId: 14, qty: 4 },
  ]);
  assert.equal(parsed.recoveredCount, 5);
});

test('unreadable cart snapshot is copied before replacement and quota failure preserves the original', () => {
  const { preserveUnreadableCartSnapshot } = cartRules(
    '  function preserveUnreadableCartSnapshot(storage, storageKey, rawSnapshot) {',
    '\n  function loadCart',
  );
  const raw = '{bad legacy cart';
  const values = new Map([['westo_table', raw]]);
  const storage = {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
  };

  const backupKey = preserveUnreadableCartSnapshot(storage, 'westo_table', raw);
  assert.equal(values.get(backupKey), raw);
  assert.equal(values.get('westo_table'), raw, 'the active raw snapshot remains untouched until its backup is verified');
  assert.equal(preserveUnreadableCartSnapshot(storage, 'westo_table', raw), backupKey,
    'retry reuses the verified backup instead of making duplicates');

  const quotaValues = new Map([['westo_table', raw]]);
  const quotaStorage = {
    getItem(key) { return quotaValues.has(key) ? quotaValues.get(key) : null; },
    setItem(key, value) {
      if (key.includes(':recovery:')) throw new Error('quota exceeded');
      quotaValues.set(key, String(value));
    },
  };
  assert.throws(() => preserveUnreadableCartSnapshot(quotaStorage, 'westo_table', raw), /quota exceeded/);
  assert.equal(quotaValues.get('westo_table'), raw);
  assert.throws(() => preserveUnreadableCartSnapshot(storage, 'westo_table', 'changed raw'), /snapshot_changed/);
});

test('removed line undo restores original ordering and refuses to exceed the quantity cap', () => {
  const context = cartRules('  function modifierLineKey(line) {', '\n  function modifierUnitPrice');
  const original = [
    { menuItemId: 4, qty: 1, modifiers: [] },
    { menuItemId: 9, qty: 2, modifiers: [{ groupId: 'size', id: 'large' }] },
  ];
  const removed = { index: 1, line: original[1] };
  const restored = context.restoreRemovedCartLine([original[0]], removed);
  assert.equal(restored.ok, true);
  assert.deepEqual(JSON.parse(JSON.stringify(restored.lines)), original);
  assert.equal(original.length, 2, 'restore helper does not mutate the source cart');

  const full = { menuItemId: 9, qty: 98, modifiers: [{ groupId: 'size', id: 'large' }] };
  const rejected = context.restoreRemovedCartLine([full], { index: 1, line: removed.line });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.reason, 'quantity_limit');
});

test('price snapshots include selected modifiers and reject unknown stored amounts', () => {
  const normalizeDigits = (value) => String(value).replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)));
  const context = cartRules('  function cartSnapshotUnitPrice(line) {', '\n  const ALLERGEN_META', {
    safeCartPrice(value) {
      if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0 ? value : null;
      if (typeof value !== 'string' || !value.trim()) return null;
      const normalized = normalizeDigits(value.trim());
      if (!/^\d+$/.test(normalized)) return null;
      const amount = Number(normalized);
      return Number.isSafeInteger(amount) && amount >= 0 ? amount : null;
    },
  });

  assert.equal(context.cartSnapshotUnitPrice({ price: '۳۰۰۰۰۰', modifiers: [{ price: 25000 }, { price: '5000' }] }), 330000);
  assert.equal(context.cartSnapshotUnitPrice({ price: 300000, modifiers: [{ price: 'unknown' }] }), null);
});

test('guest menu search is visible, restores and synchronizes q in the URL', () => {
  const start = menuSource.indexOf('  function initialMenuSearchQuery(params) {');
  const end = menuSource.indexOf('\n\n  const cartContext', start);
  assert.ok(start >= 0 && end > start, 'initial query reader remains independently testable');
  const context = { URLSearchParams };
  vm.runInNewContext(menuSource.slice(start, end), context);

  assert.equal(context.initialMenuSearchQuery(new URLSearchParams('?q=%D8%B4%D8%B1%DB%8C%D9%85%D9%BE')), 'شریمپ');
  assert.match(menuSource, /url\.searchParams\.set\('q', query\.trim\(\)\)/);
  assert.match(menuHtml, /<input id="cm-search"[^>]*type="search"[^>]*min-height:44px;font-size:16px/);
  assert.match(menuHtml, /aria-controls="cm-grid"/);
});

test('price changes require explicit review before continuing; storage and cart targets fail visibly', () => {
  assert.match(cartSource, /checkoutBtn\.disabled = cart\.length === 0 \|\| cartRecoveryPending \|\| !pricesVerified \|\| !cartItemsVerified \|\| !cartStorageAvailable \|\| \(priceChanges\.length > 0 && !priceReviewAccepted\)/);
  assert.match(cartSource, /priceAcceptBtn\.addEventListener\('click'/);
  assert.match(cartSource, /function removeCartLine\(id\)/);
  assert.match(cartSource, /actionLabel: modifierCopy\('بازگردانی', 'Undo'/);
  assert.match(cartSource, /The cart could not be saved/);
  assert.match(cartSource, /westo:cartchange', \(event\) => \{\s*cart = Array\.isArray\(event\.detail\?\.cart\) \? event\.detail\.cart : loadCart\(\)/);
  assert.match(menuHtml, /id="table-cart-price-review"/);
  assert.match(menuHtml, /id="table-cart-storage-warning"[^>]*role="alert"/);
  assert.match(cartSource, /table-cart-recovery-action/);
  assert.match(cartSource, /preserveUnreadableCartSnapshot\(localStorage, STORAGE_KEY, unreadableCartSnapshotRaw\)/);
  assert.match(cartSource, /recoverButton\.addEventListener\('click'[\s\S]*?startFreshCartAfterRecovery\(\)/);
  assert.match(cartSource, /function tableCartMutationAllowed\(\)[\s\S]*?if \(cartRecoveryPending\)[\s\S]*?return false;/);
  assert.match(cartSource, /data-rm="\$\{escapeHtml\(lineKey\)\}"[^>]*style="min-width:44px;min-height:44px"/);
  assert.match(cartSource, /data-dec="\$\{escapeHtml\(lineKey\)\}"[^>]*style="min-width:44px;min-height:44px"/);
  assert.match(cartSource, /data-inc="\$\{escapeHtml\(lineKey\)\}"[^>]*style="min-width:44px;min-height:44px"/);
});

test('unreadable cart recovery requires an explicit action and verifies backup before reset', () => {
  const start = cartSource.indexOf('  function startFreshCartAfterRecovery() {');
  const end = cartSource.indexOf('\n  function saveCart', start);
  assert.ok(start >= 0 && end > start);
  const recoveryFlow = cartSource.slice(start, end);
  const backupAt = recoveryFlow.indexOf('preserveUnreadableCartSnapshot(localStorage, STORAGE_KEY, unreadableCartSnapshotRaw)');
  const resetAt = recoveryFlow.indexOf("localStorage.setItem(STORAGE_KEY, '[]')");
  assert.ok(backupAt >= 0 && resetAt > backupAt, 'the unreadable original is backed up before a fresh cart replaces it');
  assert.match(recoveryFlow, /catch \(_\)[\s\S]*cartRecoveryPending/);
  assert.match(cartSource, /function tableCartMutationAllowed\(\)[\s\S]*?if \(cartRecoveryPending\)[\s\S]*?return false;/);
  assert.match(cartSource, /cart\.length === 0 \|\| cartRecoveryPending \|\| !pricesVerified/);
  assert.match(cartSource, /recoverButton\.addEventListener\('click'[\s\S]*?startFreshCartAfterRecovery\(\)/);
});
