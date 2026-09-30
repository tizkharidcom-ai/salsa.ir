'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { normalizeModifierGroups: normalizeServerGroups } = require('../server/menu-modifiers');

const root = path.join(__dirname, '..');
const cartSource = fs.readFileSync(path.join(root, 'js/table-cart.js'), 'utf8');
const menuSource = fs.readFileSync(path.join(root, 'js/classic-menu.js'), 'utf8');
const smartMenuSource = fs.readFileSync(path.join(root, 'js/westo-menu.smart.js'), 'utf8');
const smartAppSource = fs.readFileSync(path.join(root, 'js/westo-app.smart.js'), 'utf8');
const tableCss = fs.readFileSync(path.join(root, 'css/table.css'), 'utf8');
const menuHtml = fs.readFileSync(path.join(root, 'menu.html'), 'utf8');

function clientCartRules() {
  const start = cartSource.indexOf('  function modifierDefinition(item) {');
  const end = cartSource.indexOf('\n  function renderModifierPicker', start);
  assert.ok(start >= 0 && end > start, 'modifier validation stays an isolated pure section');
  const context = {
    safeCartPrice(value) {
      if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0 ? value : null;
      if (typeof value !== 'string' || !/^\d+$/.test(value.trim())) return null;
      const amount = Number(value.trim());
      return Number.isSafeInteger(amount) ? amount : null;
    },
  };
  vm.runInNewContext(cartSource.slice(start, end), context, { filename: 'table-cart-modifier-rules.js' });
  return context;
}

function lineKeyRule() {
  const start = cartSource.indexOf('  function modifierLineKey(line) {');
  const end = cartSource.indexOf('\n  function modifierUnitPrice', start);
  assert.ok(start >= 0 && end > start, 'cart line identity stays isolated');
  const context = {};
  vm.runInNewContext(cartSource.slice(start, end), context, { filename: 'table-cart-line-key.js' });
  return context.modifierLineKey;
}

function cartLineReplacementRule() {
  const start = cartSource.indexOf('  function replaceCartLineWithSelection(lines, sourceKey, replacement) {');
  const end = cartSource.indexOf('\n  function modifierUnitPrice', start);
  assert.ok(start >= 0 && end > start, 'cart option edits stay in a pure, independently testable transition');
  const context = { modifierLineKey: lineKeyRule() };
  vm.runInNewContext(cartSource.slice(start, end), context, { filename: 'table-cart-line-replacement.js' });
  return context.replaceCartLineWithSelection;
}

function cartStockRules() {
  const start = cartSource.indexOf('  function itemStockLimit(item) {');
  const end = cartSource.indexOf('\n  function modifierCopy', start);
  assert.ok(start >= 0 && end > start, 'stock limits remain isolated for deterministic tests');
  const context = {
    activeDayparts: ['lunch'],
    safeCartPrice(value) {
      if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0 ? value : null;
      if (typeof value !== 'string' || !/^\d+$/.test(value.trim())) return null;
      const amount = Number(value.trim());
      return Number.isSafeInteger(amount) ? amount : null;
    },
  };
  vm.runInNewContext(cartSource.slice(start, end), context, { filename: 'table-cart-stock-rules.js' });
  return context;
}

function menuAddClickHandler(items, addItem) {
  const listenerPrefix = "  document.addEventListener('click', (e) => {";
  const modalStart = cartSource.indexOf('// --- quantity modal ---');
  const listenerStart = cartSource.indexOf(listenerPrefix, modalStart);
  const listenerEnd = cartSource.indexOf("\n  });\n\n  document.addEventListener('keydown'", listenerStart);
  assert.ok(modalStart >= 0 && listenerStart > modalStart && listenerEnd > listenerStart,
    'the delegated menu/cart click handler remains independently executable');

  const context = {
    menuByCategory: { 7: items },
    modifierDefinition: () => ({ ok: true, groups: [] }),
    resolveDishFlySource: () => null,
    addItem,
    openQtyModal() { throw new Error('plain item should use quick add'); },
  };
  const handlerBody = cartSource.slice(listenerStart + listenerPrefix.length, listenerEnd);
  return vm.runInNewContext(`(e) => {${handlerBody}}`, context, { filename: 'table-cart-menu-add-handler.js' });
}

function classicMenuStockRules(lines) {
  const start = menuSource.indexOf('  function menuItemStockLimit(item) {');
  const end = menuSource.indexOf('\n  function detailSelectedModifiers', start);
  assert.ok(start >= 0 && end > start, 'classic menu stock rules remain independently testable');
  const context = { loadCart: () => lines };
  vm.runInNewContext(menuSource.slice(start, end), context, { filename: 'classic-menu-stock-rules.js' });
  return context;
}

test('menu and cart agree that omitted modifier availability means available', () => {
  const rawGroups = [{
    id: 'size', title: 'اندازه', selection: 'single', required: true,
    options: [{ id: 'regular', name: 'معمولی', price: '120000' }],
  }];
  const serverGroups = normalizeServerGroups(rawGroups);
  const rules = clientCartRules();
  const item = { id: 7, price: 300000, available: true, modifierGroups: rawGroups };
  const definition = rules.modifierDefinition(item);
  const selection = rules.validateModifierSelection(item, [{ groupId: 'size', id: 'regular' }]);

  assert.equal(serverGroups[0].options[0].available, true);
  assert.equal(definition.groups[0].options[0].available, true);
  assert.equal(selection.ok, true);
  assert.equal(selection.unitPrice, 420000);
});

test('the real delegated add-button handler resolves numeric and numeric-string menu IDs', () => {
  for (const menuItemId of [41, '41']) {
    const item = { id: menuItemId, categoryId: 7, name: 'Soup', price: 120000, available: true };
    const added = [];
    const handler = menuAddClickHandler([item], (...args) => added.push(args));
    const button = { disabled: false, dataset: { itemId: String(menuItemId) } };
    let prevented = false;
    let stopped = false;

    handler({
      target: { closest: (selector) => selector === '[data-menu-add]' ? button : null },
      preventDefault() { prevented = true; },
      stopPropagation() { stopped = true; },
    });

    assert.equal(added.length, 1, `item ID ${String(menuItemId)} reaches addItem once`);
    assert.equal(added[0][0], item);
    assert.equal(added[0][1], 1);
    assert.equal(prevented, true);
    assert.equal(stopped, true);
  }
});

test('editing cart options replaces a line in place and merges matching selections safely', () => {
  const replace = cartLineReplacementRule();
  const oldLine = { menuItemId: 7, qty: 2, name: 'Dish', modifiers: [{ groupId: 'size', id: 'small' }] };
  const other = { menuItemId: 8, qty: 1, name: 'Other', modifiers: [] };
  const changed = replace([oldLine, other], '7:[["size","small"]]', {
    ...oldLine, qty: 2, modifiers: [{ groupId: 'size', id: 'medium' }],
  });
  assert.equal(changed.ok, true);
  assert.equal(changed.lines[0].modifiers[0].id, 'medium');
  assert.equal(changed.lines[1], other);

  const target = { menuItemId: 7, qty: 3, name: 'Dish', modifiers: [{ groupId: 'size', id: 'large' }] };
  const merged = replace([oldLine, target, other], '7:[["size","small"]]', {
    ...oldLine, qty: 2, modifiers: [{ groupId: 'size', id: 'large' }],
  });
  assert.equal(merged.ok, true);
  assert.equal(merged.lines.length, 2);
  assert.equal(merged.lines[0].qty, 5);
  assert.equal(merged.lines[0].modifiers[0].id, 'large');
  assert.equal(merged.lines[1], other);
});

test('cart option edit refuses quantity overflow without mutating existing lines', () => {
  const replace = cartLineReplacementRule();
  const source = { menuItemId: 7, qty: 2, modifiers: [{ groupId: 'size', id: 'small' }] };
  const target = { menuItemId: 7, qty: 98, modifiers: [{ groupId: 'size', id: 'large' }] };
  const unchanged = [source, target];
  const rejected = replace(unchanged, '7:[["size","small"]]', {
    ...source, qty: 2, modifiers: [{ groupId: 'size', id: 'large' }],
  });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.reason, 'quantity_limit');
  assert.equal(rejected.lines, unchanged);
  assert.equal(target.qty, 98);
  assert.equal(replace([source], 'missing', source).reason, 'missing_line');
});

test('modifier choices can be edited from the cart with preselected options and stock checks', () => {
  assert.match(cartSource, /function renderModifierPicker\(container, item, namePrefix = 'menu', initialSelection = \[\]\)/);
  assert.match(cartSource, /requested\.has\(`\$\{input\.dataset\.modifierGroup\}:\$\{input\.value\}`\)\) input\.checked = true/);
  assert.match(cartSource, /class="table-line__edit-options" data-edit-options=/);
  assert.match(cartSource, /\[data-edit-options\]/);
  assert.match(cartSource, /cartQuantityWithinStock\(item, cart, quantity, source\)/);
  assert.match(cartSource, /Save changes/);
  assert.match(cartSource, /updateCartLineOptions\(sourceKey, item, qty, selection\.modifiers\)/);
  assert.match(tableCss, /\.table-line__edit-options\s*\{[\s\S]*?min-height:\s*44px/);
  assert.match(tableCss, /html\[data-theme="light"\] \.table-line__edit-options/);
  assert.match(tableCss, /@media \(max-width: 360px\)[\s\S]*?\.table-line__modifier-row \{[^}]*flex-direction: column/);
});

test('classic menu modifier rules reject unavailable and malformed options before carting', () => {
  const marker = '/* Classic menu — Majnoon-inspired UI, Westo data & cart. fa | en | ar */';
  const rulesSource = menuSource.slice(0, menuSource.indexOf(marker));
  assert.ok(rulesSource.length > 0, 'shared menu rules remain independently testable');
  const context = {};
  vm.runInNewContext(rulesSource, context, { filename: 'classic-menu-rules.js' });
  const rules = context.WestoMenuUiRules;
  const item = {
    price: '۳۰۰۰۰۰',
    modifierGroups: [{
      id: 'size', title: 'اندازه', selection: 'single', required: true,
      options: [
        { id: 'regular', name: 'معمولی', price: '0' },
        { id: 'sold-out', name: 'ناموجود', price: '50000', available: false },
        { id: 'broken', name: 'قیمت نامعتبر', price: '1.5' },
      ],
    }],
  };

  assert.equal(rules.resolveSelection(rules.normalizeGroups(item.modifierGroups), [], item.price).error, 'selection_count');
  assert.equal(rules.resolveSelection(rules.normalizeGroups(item.modifierGroups), [{ groupId: 'size', id: 'sold-out' }], item.price).error, 'invalid_selection');
  assert.equal(rules.resolveSelection(rules.normalizeGroups(item.modifierGroups), [{ groupId: 'size', id: 'broken' }], item.price).error, 'invalid_selection');
  assert.equal(rules.resolveSelection(rules.normalizeGroups(item.modifierGroups), [{ groupId: 'size', id: 'regular' }], item.price).unitPrice, 300000);
});

test('a valid empty catalogue has a distinct unpublished-menu state', () => {
  const start = menuSource.indexOf('  function emptyGridMessage(itemCount, categoryEmpty) {');
  const end = menuSource.indexOf('\n  function renderGrid()', start);
  assert.ok(start >= 0 && end > start, 'empty menu messaging remains a small unit-testable rule');
  const context = { t3: (fa) => fa };
  vm.runInNewContext(menuSource.slice(start, end), context, { filename: 'classic-menu-empty-state.js' });

  assert.equal(context.emptyGridMessage(0, false), 'منوی فعالی برای این رستوران منتشر نشده است.');
  assert.equal(context.emptyGridMessage(3, true), 'هنوز غذایی در این دسته نیست');
  assert.equal(context.emptyGridMessage(3, false), 'موردی با این فیلتر پیدا نشد');
  assert.match(menuSource, /const msg = emptyGridMessage\(\(items \|\| \[\]\)\.length, catEmpty\)/);
});

test('mobile catalogue cards keep the price unit and availability readable at compact widths', () => {
  const css = fs.readFileSync(path.join(root, 'css/classic-menu-catalogue-v2.css'), 'utf8');
  const compactAt = css.lastIndexOf('@media (max-width: 370px)');
  const mobileAt = css.lastIndexOf('@media (max-width: 559px)', compactAt);
  assert.ok(mobileAt >= 0 && compactAt > mobileAt, 'final mobile overrides must win the legacy cascade');
  const mobileRules = css.slice(mobileAt, compactAt);
  const compactRules = css.slice(compactAt);

  assert.match(mobileRules, /\.cm-item__price small\s*\{[^}]*font-size:\s*0\.75rem\s*!important/s);
  assert.match(mobileRules, /\.cm-item__badge\s*\{[^}]*position:\s*static\s*!important/s);
  assert.match(mobileRules, /\.cm-item__badge\s*\{[^}]*font-size:\s*0\.75rem\s*!important/s);
  assert.match(mobileRules, /\.cm-item__summary\s*\{[^}]*font-size:\s*0\.8rem\s*!important/s);
  assert.match(compactRules, /\.cm-item\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+6\.25rem\s*!important/s);
});

test('mobile menu header keeps primary controls at 44px and retains login in the navigation drawer', () => {
  const css = fs.readFileSync(path.join(root, 'css/classic-menu-catalogue-v2.css'), 'utf8');
  const mobileOverrideAt = css.lastIndexOf('@media (max-width: 559px)');
  const mobileOverride = css.slice(mobileOverrideAt);
  assert.ok(mobileOverrideAt >= 0);
  assert.match(mobileOverride, /\.cm-icon-btn[\s\S]*?width:\s*44px\s*!important;[\s\S]*?min-width:\s*44px\s*!important;[\s\S]*?min-height:\s*44px\s*!important;/);
  assert.match(mobileOverride, /\.cm-detail__media-expand\s*\{[^}]*width:\s*44px\s*!important;[^}]*height:\s*44px\s*!important;/s);
  assert.match(mobileOverride, /#cm-login\s*\{\s*display:\s*none\s*!important;/);
  assert.match(menuHtml, /class="cm-drawer__link" href="\/login"/,
    'hiding the redundant header shortcut must not remove the mobile login path');
});

test('required, unavailable, malformed-price and malformed-selection cases fail closed', () => {
  const rules = clientCartRules();
  const item = {
    id: 8,
    price: 200000,
    available: true,
    modifierGroups: [{
      id: 'size', title: 'اندازه', selection: 'single', required: true,
      options: [
        { id: 'regular', name: 'معمولی', price: 0, available: true },
        { id: 'sold-out', name: 'ناموجود', price: 50000, available: false },
        { id: 'bad-price', name: 'قیمت نامعتبر', price: '1.5', available: true },
      ],
    }],
  };

  assert.equal(rules.validateModifierSelection(item, []).error, 'required');
  assert.equal(rules.validateModifierSelection(item, [{ groupId: 'size', id: 'sold-out' }]).error, 'selection');
  assert.equal(rules.validateModifierSelection(item, [{ groupId: 'size', id: 'bad-price' }]).error, 'selection');
  assert.equal(rules.validateModifierSelection(item, [{ groupId: 'missing', id: 'regular' }]).error, 'selection');
  assert.equal(rules.validateModifierSelection({ ...item, price: 'unknown' }, [{ groupId: 'size', id: 'regular' }]).error, 'configuration');
  assert.equal(rules.validateModifierSelection({ ...item, modifierGroups: [{ id: 'empty', title: 'خالی', selection: 'single', options: [] }] }, []).error, 'configuration');
});

test('cart line identity merges the same configuration but separates distinct configurations', () => {
  const key = lineKeyRule();
  const line = (modifiers) => ({ menuItemId: 11, modifiers });

  assert.equal(key(line([{ groupId: 'size', id: 'large' }, { groupId: 'side', id: 'salad' }])),
    key(line([{ groupId: 'side', id: 'salad' }, { groupId: 'size', id: 'large' }])));
  assert.notEqual(key(line([{ groupId: 'size', id: 'large' }])), key(line([{ groupId: 'size', id: 'regular' }])));
  assert.notEqual(key(line([{ groupId: 'size', id: 'large' }])), key({ menuItemId: 12, modifiers: [{ groupId: 'size', id: 'large' }] }));
});

test('guest cart enforces known stock across modifier variants and removes no-longer-listed items from checkout', () => {
  const rules = cartStockRules();
  assert.equal(rules.itemStockLimit({ stock: 2 }), 2);
  assert.equal(rules.itemStockLimit({ stock: 0 }), 0);
  assert.equal(rules.itemStockLimit({ stock: '2' }), null, 'malformed API values are not treated as authoritative stock');
  assert.equal(rules.itemStockLimit({ stock: -1 }), null);

  const first = { menuItemId: 7, qty: 1, modifiers: [{ groupId: 'size', id: 'small' }] };
  const second = { menuItemId: 7, qty: 1, modifiers: [{ groupId: 'size', id: 'large' }] };
  const otherDish = { menuItemId: 8, qty: 1 };
  const cart = [first, second, otherDish];
  assert.equal(rules.cartQuantityForItem(cart, 7), 2, 'inventory is shared across modifier-specific lines');
  assert.equal(rules.cartQuantityForItem(cart, 7, first), 1, 'quantity changes can exclude their own line');
  assert.equal(rules.cartQuantityForItem(cart, 8), 1, 'different menu items keep independent stock');
  assert.equal(rules.cartQuantityWithinStock({ id: 7, stock: 2 }, cart, 0, first), true);
  assert.equal(rules.cartQuantityWithinStock({ id: 7, stock: 2 }, cart, 1), false);
  assert.equal(rules.cartQuantityWithinStock({ id: 7 }, cart, 99, first), true, 'untracked items remain governed by the server quote');
  assert.equal(rules.cartQuantityWithinStock(null, cart, 1), false, 'unknown menu items fail closed');
  assert.equal(rules.itemAvailabilityError({ available: true, stock: 0, price: 100, dayparts: ['all'] }), 'stock');
  assert.equal(rules.itemAvailabilityError({ available: true, stock: 2, price: 100, dayparts: ['dinner'] }), 'daypart');
  assert.equal(rules.itemAvailabilityError({ available: false, stock: 2, price: 100, dayparts: ['all'] }), 'unavailable');

  assert.match(cartSource, /!cartQuantityWithinStock\(item, cart, q\)/);
  assert.match(cartSource, /if \(itemMissing \|\| stockExceeded \|\| staleAvailability\) cartItemsVerified = false/);
  assert.match(cartSource, /const availabilityError = l\.item \? itemAvailabilityError\(l\.item\) : 'unavailable'/);
  assert.match(cartSource, /item is not served at this time\. Remove it from the cart to continue\./);
  assert.match(cartSource, /!cartItemsVerified/);
  assert.match(cartSource, /table-line__stock-warning/);

  const menuStock = classicMenuStockRules([
    { menuItemId: 7, qty: 1 },
    { menuItemId: 7, qty: 2 },
    { menuItemId: 8, qty: 3 },
  ]);
  assert.equal(menuStock.menuItemStockLimit({ stock: 0 }), 0);
  assert.equal(menuStock.menuItemStockLimit({ stock: '0' }), null);
  assert.equal(menuStock.menuItemStockRemaining({ id: 7, stock: 5 }), 2);
  assert.equal(menuStock.menuItemStockRemaining({ id: 7, stock: 2 }), 0);
  assert.equal(menuStock.menuItemStockRemaining({ id: 8, stock: 5 }), 2);
  assert.match(menuSource, /const outOfStock = menuItemStockLimit\(m\) === 0/);
  assert.match(menuSource, /remainingStock < detailQty/);
  assert.match(menuSource, /q > remainingStock/);
});

test('order journey verifies the server quote before submission and keeps retry identity', () => {
  const quoteAt = cartSource.indexOf("fetch('/api/checkout/quote'");
  const orderAt = cartSource.indexOf("fetch('/api/checkout/orders'");
  const clearAt = cartSource.indexOf('cart = [];', orderAt);
  assert.ok(quoteAt >= 0 && quoteAt < orderAt && orderAt < clearAt, 'quote precedes order and cart clears only after success');
  assert.match(cartSource, /Number\(quote\.subtotal\) !== shownSubtotal/);
  assert.match(cartSource, /'Idempotency-Key': checkoutIntent\.key/);
  assert.match(cartSource, /function createTableReceiptCode\(\)[\s\S]*?window\.crypto\.getRandomValues\(bytes\)/);
  assert.match(cartSource, /tableReceiptReadySignature !== checkoutSignature[\s\S]*?مالیات داخل قیمت منو[\s\S]*?return;[\s\S]*?checkoutIntent\.submitted = true/);
  assert.match(cartSource, /fetch\('\/api\/checkout\/recovery'[\s\S]*?receiptCode: code/);
  assert.match(cartSource, /data-table-copy-receipt/);
  assert.match(menuHtml, /id="order-name"[^>]*required/);
  assert.match(cartSource, /submitBtn\.disabled = true/);
  assert.match(cartSource, /function closeDrawer\(\)[\s\S]*?drawerFocusBeforeOpen[\s\S]*?back\.focus/);
  assert.match(menuSource, /function closeDetail\(\)[\s\S]*?els\.detail\.hidden = true[\s\S]*?classicRestoreFocus\(\)/);
});

test('accepted QR order retains its idempotency intent when browser storage cannot clear the old cart', () => {
  const start = cartSource.indexOf('  function finalizeAcceptedTableOrder(intent, storageKey) {');
  const end = cartSource.indexOf('\n  function tableCheckoutIntentDisposition', start);
  assert.ok(start >= 0 && end > start, 'post-acceptance cleanup remains an isolated transition');

  function run(persisted) {
    const state = {
      cart: [], STORAGE_KEY: 'cart', cartStorageAvailable: true, cartLoadWarning: '',
      window: { __westoTableCheckoutIntent: null },
      clearedKeys: [], badgeUpdates: 0, renders: 0,
      localStorage: { getItem: () => persisted ? '[]' : '[old cart]' },
      saveCart() { return persisted; },
      clearTableCheckoutIntent: (key) => state.clearedKeys.push(key),
      modifierCopy(fa) { return fa; },
      updateBadge: () => { state.badgeUpdates += 1; },
      renderCart: () => { state.renders += 1; },
    };
    vm.runInNewContext(cartSource.slice(start, end), state, { filename: 'table-cart-accepted-cleanup.js' });
    const intent = { signature: 'intent-12345678', key: 'table-retry-12345678' };
    const result = state.finalizeAcceptedTableOrder(intent, 'branch-table-intent');
    return { state, intent, result };
  }

  const cleared = run(true);
  assert.equal(cleared.result, true);
  assert.equal(cleared.state.window.__westoTableCheckoutIntent, null);
  assert.deepEqual(cleared.state.clearedKeys, ['branch-table-intent']);

  const retained = run(false);
  assert.equal(retained.result, false);
  assert.equal(retained.state.window.__westoTableCheckoutIntent.key, retained.intent.key);
  assert.deepEqual(retained.state.clearedKeys, [], 'a failed cart clear must not delete the only retry key');
  assert.equal(retained.state.cartStorageAvailable, false);
  assert.match(retained.state.cartLoadWarning, /سفارش ثبت شد/);
  assert.equal(retained.state.badgeUpdates, 1);
  assert.equal(retained.state.renders, 1);

  const responseAt = cartSource.indexOf('const acceptedOrder = d?.order;');
  const cleanupAt = cartSource.indexOf('finalizeAcceptedTableOrder(checkoutIntent, checkoutIntentStorageKey)', responseAt);
  const doneAt = cartSource.indexOf("const done = \$('#table-done-msg'\)", responseAt);
  assert.ok(cleanupAt > responseAt && doneAt > cleanupAt, 'the accepted receipt is rendered only after safe local cleanup handling');
  assert.match(cartSource, /table-done-storage-warning/);
  assert.match(tableCss, /\.table-done-storage-warning\s*\{[\s\S]*?width:\s*min\(100%,\s*32rem\)[\s\S]*?font-size:\s*0\.86rem/);
  assert.match(tableCss, /html\[data-theme="light"\] \.table-done-storage-warning/);
});

test('incomplete successful order responses preserve the cart and idempotency key', () => {
  const responseAt = cartSource.indexOf('const acceptedOrder = d?.order;');
  const idAt = cartSource.indexOf('Number.isSafeInteger(acceptedOrderId)', responseAt);
  const totalAt = cartSource.indexOf('Number.isSafeInteger(acceptedTotal)', responseAt);
  const tableAt = cartSource.indexOf('!acceptedTableNo', responseAt);
  const cartClearAt = cartSource.indexOf('cart = [];', responseAt);
  const cleanupAt = cartSource.indexOf('finalizeAcceptedTableOrder(checkoutIntent, checkoutIntentStorageKey)', responseAt);

  assert.ok(responseAt >= 0 && idAt > responseAt && totalAt > idAt && tableAt > totalAt,
    'order id, total, and table are validated before treating the response as accepted');
  assert.ok(cartClearAt > tableAt && cleanupAt > cartClearAt,
    'local cart persistence and retry-identity cleanup happen only after a complete order receipt');
  assert.match(cartSource, /پاسخ ثبت سفارش کامل نیست؛ سبد حفظ شد و تلاش بعدی با همان شناسهٔ یکتا انجام می‌شود/);
  assert.match(cartSource, /'Idempotency-Key': checkoutIntent\.key/);
});

test('checkout retry intent survives tab closure and is isolated by branch/table without storing guest data', () => {
  assert.match(cartSource, /westo_table_checkout_intent_v2:\$\{encodeURIComponent\(cartBranch \|\| 'unscoped'\)\}:\$\{encodeURIComponent\(cartTable \|\| 'no-table'\)\}/);
  assert.match(cartSource, /function readTableCheckoutIntentRecords\(storageKey, legacyStorageKey\)/);
  assert.match(cartSource, /function writeTableCheckoutIntent\(storageKey, intent\)/);
  assert.match(cartSource, /window\.localStorage\.setItem\(storageKey, safeValue\)/);
  assert.match(cartSource, /window\.sessionStorage\.setItem\(storageKey, safeValue\)/);
  assert.match(cartSource, /JSON\.stringify\(\{ signature: intent\.signature, key: intent\.key, submitted: intent\.submitted !== false \}\)/);
  assert.match(cartSource, /legacyCheckoutIntentStorageKey = 'westo_table_checkout_intent_v1'/);
  assert.match(cartSource, /if \(!writeTableCheckoutIntent\(checkoutIntentStorageKey, checkoutIntent\)\)[\s\S]*?table_checkout_intent_storage_unavailable/);
  assert.match(cartSource, /quote token only in memory/);
});

test('checkout intent storage migrates legacy fingerprints without persisting guest details or quote tokens', () => {
  const start = cartSource.indexOf('  function tableCheckoutIntentFingerprint(value) {');
  const end = cartSource.indexOf('  function tableCheckoutQuoteNeedsReview', start);
  assert.ok(start >= 0 && end > start, 'checkout intent storage helpers exist');
  const memoryStorage = () => {
    const values = new Map();
    return {
      values,
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, String(value)),
      removeItem: (key) => values.delete(key),
    };
  };
  const localStorage = memoryStorage();
  const sessionStorage = memoryStorage();
  const context = { module: { exports: {} }, window: { localStorage, sessionStorage } };
  vm.runInNewContext(`${cartSource.slice(start, end)}
module.exports = { tableCheckoutIntentFingerprint, normalizeTableCheckoutIntent, readTableCheckoutIntentRecords, writeTableCheckoutIntent, clearTableCheckoutIntent };`, context);
  const helpers = context.module.exports;
  const legacyKey = 'westo_table_checkout_intent_v1';
  const scopedKey = 'westo_table_checkout_intent_v2:branch-a:table-7';
  const rawSignature = JSON.stringify({ phone: '09123456789', tableNo: '7', items: [{ menuItemId: 4, qty: 1 }] });
  sessionStorage.setItem(legacyKey, JSON.stringify({ signature: rawSignature, key: 'table-retry-12345678', quoteToken: 'signed-quote-secret' }));

  const legacyRecord = helpers.readTableCheckoutIntentRecords(scopedKey, legacyKey)[0];
  const normalized = helpers.normalizeTableCheckoutIntent(legacyRecord.intent);
  assert.match(normalized.signature, /^intent-[a-f\d]{16}$/);
  assert.equal(helpers.writeTableCheckoutIntent(scopedKey, normalized), true);
  const persisted = JSON.parse(localStorage.getItem(scopedKey));
  assert.deepEqual(JSON.parse(JSON.stringify(persisted)), { signature: normalized.signature, key: normalized.key, submitted: true });
  assert.equal(JSON.stringify(persisted).includes('09123456789'), false);
  assert.equal(JSON.stringify(persisted).includes('signed-quote-secret'), false);
  assert.equal(sessionStorage.getItem(scopedKey), null);
  helpers.clearTableCheckoutIntent(scopedKey);
  assert.equal(localStorage.getItem(scopedKey), null);
});

test('QR receipt intents distinguish unsent review from submitted retries and generate secure 128-bit codes', () => {
  const start = cartSource.indexOf('  function tableCheckoutIntentFingerprint(value) {');
  const end = cartSource.indexOf('  function tableCheckoutQuoteNeedsReview', start);
  assert.ok(start >= 0 && end > start, 'receipt-intent helpers remain a deterministic isolated section');
  const bytes = Array.from({ length: 16 }, (_, index) => index);
  const context = {
    module: { exports: {} },
    window: {
      crypto: { getRandomValues(target) { target.set(bytes); return target; } },
      localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
      sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    },
  };
  vm.runInNewContext(`${cartSource.slice(start, end)}
module.exports = { tableCheckoutIntentDisposition, createTableReceiptCode, formatTableReceiptCode, normalizeTableCheckoutIntent };`, context);
  const helpers = context.module.exports;
  const code = helpers.createTableReceiptCode();
  assert.equal(code, '000102030405060708090a0b0c0d0e0f');
  assert.equal(helpers.formatTableReceiptCode(code), '0001-0203-0405-0607-0809-0a0b-0c0d-0e0f');
  assert.equal(helpers.tableCheckoutIntentDisposition({ key: code, signature: 'same', submitted: false }, 'same'), 'review');
  assert.equal(helpers.tableCheckoutIntentDisposition({ key: code, signature: 'same', submitted: true }, 'same'), 'retry');
  assert.equal(helpers.tableCheckoutIntentDisposition({ key: code, signature: 'old', submitted: false }, 'new'), 'replace-unsent');
  assert.equal(helpers.tableCheckoutIntentDisposition({ key: code, signature: 'old' }, 'new'), 'unresolved', 'legacy records default to submitted');
  assert.equal(helpers.normalizeTableCheckoutIntent({ key: 'table-old-key', signature: 'legacy' }).submitted, true);
});

test('QR checkout retries still require explicit review when the server quote changes', () => {
  const start = cartSource.indexOf('  function tableCheckoutQuoteNeedsReview(review, signature, visibleTotal, quotedTotal) {');
  const end = cartSource.indexOf('\n  function tableCheckoutOrderMatchesQuote', start);
  assert.ok(start >= 0 && end > start, 'quote review is isolated from the submission handler');
  const context = { module: { exports: {} } };
  vm.runInNewContext(`${cartSource.slice(start, end)}\nmodule.exports = tableCheckoutQuoteNeedsReview;`, context);
  const needsReview = context.module.exports;

  assert.equal(needsReview(null, 'same-cart', 1000, 1100), true,
    'a retry whose freshly quoted total differs from the visible cart must stop for confirmation');
  assert.equal(needsReview({ signature: 'same-cart', total: 1100 }, 'same-cart', 1000, 1100), false,
    'the exact reviewed quote can proceed');
  assert.equal(needsReview({ signature: 'same-cart', total: 1100 }, 'same-cart', 1000, 1200), true,
    'a second quote change requires a new confirmation');

  assert.match(cartSource, /if \(tableCheckoutQuoteNeedsReview\(tableQuoteReview, checkoutSignature, shownSubtotal, quote\.total\)\)/,
    'the review guard applies regardless of whether this is a first attempt or an idempotent retry');
  assert.doesNotMatch(cartSource, /if \(!reusableIntent && tableCheckoutQuoteNeedsReview/,
    'an existing retry intent must not bypass the current server quote review');
});

test('QR checkout treats only the known pre-order provider-unavailable response as a safe rejection', () => {
  const start = cartSource.indexOf('  function tableCheckoutFailureIsDefinitive(status, code) {');
  const end = cartSource.indexOf('\n  function tableCheckoutOrderMatchesQuote', start);
  assert.ok(start >= 0 && end > start, 'guest checkout error policy is isolated and testable');
  const context = { module: { exports: {} } };
  vm.runInNewContext(`${cartSource.slice(start, end)}\nmodule.exports = { tableCheckoutFailureIsDefinitive, tableCheckoutFailureMessage };`, context);
  const policy = context.module.exports;

  assert.equal(policy.tableCheckoutFailureIsDefinitive(503, 'payment_provider_not_ready'), true,
    'the order endpoint rejects this before creating an order');
  assert.equal(policy.tableCheckoutFailureIsDefinitive(503, 'service_unavailable'), false,
    'other server errors remain ambiguous and preserve retry identity');
  assert.equal(policy.tableCheckoutFailureIsDefinitive(409, 'idempotency_key_conflict'), false,
    'idempotency conflicts must not be treated as a fresh safe retry');
  assert.equal(policy.tableCheckoutFailureIsDefinitive(400, 'item_unavailable'), true);
  assert.match(policy.tableCheckoutFailureMessage({ error: 'payment_provider_not_ready' }, 'fallback'), /سفارش ثبت نشد/);
});

test('QR cart keeps online payment disabled until checkout metadata confirms a ready provider', () => {
  assert.match(menuHtml, /name="pay" value="online" disabled/);
  assert.match(menuHtml, /id="table-payment-note"[^>]*role="status"/);
  assert.match(cartSource, /async function loadTablePaymentAvailability\(\)/);
  assert.match(cartSource, /fetch\('\/api\/checkout\/meta'[\s\S]*?credentials:\s*'same-origin'[\s\S]*?cache:\s*'no-store'/);
  assert.match(cartSource, /meta\?\.payment\?\.onlineEnabled === true/);
  assert.match(cartSource, /if \(!available && onlineOption\.checked && cashierOption\) cashierOption\.checked = true/);
  assert.match(cartSource, /void loadTablePaymentAvailability\(\)/);
});

test('table aliases prefill checkout and waiter state is scoped to branch and table', () => {
  const start = cartSource.indexOf('  function readCartContext(params) {');
  const end = cartSource.indexOf('\n  function branchIdFromContext', start);
  assert.ok(start >= 0 && end > start, 'public order context is a small reusable parser');
  const context = {};
  vm.runInNewContext(cartSource.slice(start, end), context, { filename: 'table-cart-context.js' });

  assert.deepEqual(
    JSON.parse(JSON.stringify(context.readCartContext(new URLSearchParams('?tableNo=۰۷&branchId=۲')))),
    { branch: '۲', table: '۰۷' },
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(context.readCartContext(new URLSearchParams('?table=9&tableNo=7&branch=3')))),
    { branch: '3', table: '9' },
    'canonical query names take precedence when both forms are present',
  );
  context.normalizeDigits = (value) => String(value)
    .replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
    .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)));
  const branchStart = cartSource.indexOf('  function branchIdFromContext(context) {');
  const branchEnd = cartSource.indexOf('\n  function waiterCallStorageKey', branchStart);
  assert.ok(branchStart >= 0 && branchEnd > branchStart, 'branch parsing stays independently testable');
  vm.runInNewContext(cartSource.slice(branchStart, branchEnd), context, { filename: 'table-cart-branch.js' });
  assert.equal(context.branchIdFromContext({ branch: '۲' }), 2);
  assert.equal(context.branchIdFromContext({ branch: '0' }), undefined);
  assert.equal(context.branchIdFromContext({ branch: 'branch-west' }), undefined);
  assert.deepEqual(JSON.parse(JSON.stringify(context.waiterBranchRequestContext({ branch: '۲' }))), { branchId: 2 });
  assert.deepEqual(JSON.parse(JSON.stringify(context.waiterBranchRequestContext({}))), {});
  assert.equal(context.waiterBranchRequestContext({ branch: 'branch-west' }), null,
    'a textual branch cannot fall through to the waiter API default branch');
  assert.match(cartSource, /const tableFromQr = initialCartContext\.table/);
  assert.doesNotMatch(cartSource, /westo_active_table/);

  const canonicalStart = cartSource.indexOf('  function canonicalCartIdentity(value, { requirePositive = false } = {}) {');
  const keyStart = cartSource.indexOf('  function waiterCallStorageKey(tableNo, branchContext) {');
  const keyEnd = cartSource.indexOf('\n  const cartParams', keyStart);
  assert.ok(canonicalStart >= 0 && keyStart > canonicalStart && keyEnd > keyStart, 'waiter call storage is namespaced');
  const keyContext = {
    normalizeDigits(value) {
      return String(value).replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
        .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)));
    },
  };
  vm.runInNewContext(cartSource.slice(canonicalStart, keyEnd), keyContext, { filename: 'waiter-call-key.js' });
  const key = keyContext.waiterCallStorageKey;
  assert.notEqual(key('7', '1'), key('7', '2'), 'same table number in another branch has a different call state');
  assert.equal(key('۰۷', '۰۲'), key('07', '2'), 'Persian digits map to the same canonical table and branch');
  assert.notEqual(key('7', 'branch-a'), key('7', 'branch-b'), 'branch aliases stay isolated');
  assert.notEqual(key('7', 'branch-east-2'), key('7', 'branch-west-2'), 'digits inside textual branch slugs must not collapse distinct branches');
  assert.equal(key('۰۷', 'branch-west-۰۲'), key('7', 'branch-west-02'), 'digit glyphs normalize without discarding the slug');
  assert.match(cartSource, /sessionStorage\.getItem\(callStorageKey\)/);
  assert.match(cartSource, /sessionStorage\.setItem\(callStorageKey/);
  assert.match(cartSource, /orderTableInput\.readOnly = true/);
  assert.match(cartSource, /if \(!matchesCartTableContext\(initialCartContext, tableNo\)\)/);
  assert.match(cartSource, /branchSelectorFromContext\(initialCartContext\)/);
  assert.match(cartSource, /JSON\.stringify\(\{ tableNo, requestType: 'service', note: tr\('cart\.waiterNote'\), \.\.\.waiterBranch \}\)/);
});

test('smart-loaded bundles stay byte-for-byte aligned with the standalone cart source', () => {
  const begin = '/* ===== BEGIN js/table-cart.js ===== */';
  const end = '/* ===== END js/table-cart.js ===== */';
  const standalone = cartSource
    .replace(/^\/\* Restaurant table cart \+ sushi menu boards on scroll sections\. \*\/\s*/, '')
    .trim();
  for (const [name, bundle] of [['menu', smartMenuSource], ['app', smartAppSource]]) {
    const start = bundle.indexOf(begin);
    const finish = bundle.indexOf(end, start);
    assert.ok(start >= 0 && finish > start, `smart ${name} bundle contains its declared cart source`);
    const embedded = bundle.slice(start + begin.length, finish)
      .replace(/^\s*\/\* Restaurant table cart \+ sushi menu boards on scroll sections\. \*\/\s*/, '')
      .replace(/;\s*$/, '')
      .trim();
    assert.equal(embedded, standalone, `smart ${name} bundle must not drift from the tested source`);
    assert.match(embedded, /rawOption\.available !== false/);
    assert.match(embedded, /async function loadTablePaymentAvailability\(\)/);
  }
});

test('cart validation message has a readable light-theme treatment', () => {
  const lightRule = menuSourceForCss();
  assert.match(lightRule, /html\[data-theme='light'\] \.table-cart-validation:not\(\[hidden\]\)[\s\S]*?color:\s*#7f1d1d/i);
});

function menuSourceForCss() {
  return fs.readFileSync(path.join(root, 'css/classic-menu.css'), 'utf8');
}
