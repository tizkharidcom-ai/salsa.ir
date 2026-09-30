'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const cartSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'table-cart.js'), 'utf8');
const classicMenuSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'classic-menu.js'), 'utf8');

function queryContext() {
  const start = cartSource.indexOf('  function readCartContext(params) {');
  const end = cartSource.indexOf('\n  function branchIdFromContext', start);
  assert.ok(start >= 0 && end > start, 'public menu query parsing remains isolated');

  const branchStart = end + 1;
  const branchEnd = cartSource.indexOf('\n  function waiterCallStorageKey', branchStart);
  assert.ok(branchEnd > branchStart, 'branch validation remains isolated');

  const context = {
    normalizeDigits(value) {
      return String(value)
        .replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
        .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)));
    },
  };
  vm.runInNewContext(cartSource.slice(start, end) + cartSource.slice(branchStart, branchEnd), context);
  return context;
}

function classicMenuQueryContext() {
  const start = classicMenuSource.indexOf('  function readMenuCartContext(params) {');
  const end = classicMenuSource.indexOf('\n  const cartContext', start);
  assert.ok(start >= 0 && end > start, 'classic menu query parsing remains independently testable');
  const context = { URLSearchParams };
  vm.runInNewContext(classicMenuSource.slice(start, end), context);
  return context;
}

function tableContextRules() {
  const start = cartSource.indexOf('  function canonicalCartIdentity(value, { requirePositive = false } = {}) {');
  const end = cartSource.indexOf('\n  function waiterCallStorageKey', start);
  assert.ok(start >= 0 && end > start, 'cart identity and table-context checks remain independently testable');
  const context = {
    normalizeDigits(value) {
      return String(value)
        .replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
        .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)));
    },
  };
  vm.runInNewContext(cartSource.slice(start, end), context);
  return context;
}

test('public menu accepts QR t as a table alias and preserves branch validation', () => {
  const { readCartContext, branchIdFromContext, branchSelectorFromContext } = queryContext();
  const parsed = readCartContext(new URLSearchParams('?t=۰۷&branch=۲'));

  assert.deepEqual(JSON.parse(JSON.stringify(parsed)), { branch: '۲', table: '۰۷' });
  assert.equal(branchIdFromContext(parsed), 2);
  assert.deepEqual(JSON.parse(JSON.stringify(branchSelectorFromContext(parsed))), { branchId: 2 });
  assert.deepEqual(
    JSON.parse(JSON.stringify(branchSelectorFromContext({ branch: 'branch-west' }))),
    { branch: 'branch-west' },
    'a validated branch slug remains attached to the authoritative quote and order request',
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(readCartContext(new URLSearchParams('?t=7&tenantId=999&branchId=2')))),
    { branch: '2', table: '7' },
    'tenantId is not part of the public menu table/branch contract',
  );
  assert.equal(branchIdFromContext({ branch: 'tenant-2' }), undefined);
  assert.equal(branchIdFromContext({ branch: '0' }), undefined);
});

test('canonical table and branch values win over conflicting aliases', () => {
  const { readCartContext } = queryContext();

  assert.deepEqual(
    JSON.parse(JSON.stringify(readCartContext(new URLSearchParams('?table=9&t=7&tableNo=5&branch=3&branchId=4')))),
    { branch: '3', table: '9' },
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(readCartContext(new URLSearchParams('?t=7&tableNo=5&branchId=4')))),
    { branch: '4', table: '7' },
    'the new t alias takes precedence over the older tableNo alias when table is absent',
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(readCartContext(new URLSearchParams('?table=&t=7&branch=&branchId=4')))),
    { branch: '4', table: '7' },
    'empty canonical values fall back to a non-empty alias',
  );
});

test('QR table identity is revalidated against the submitted value without blocking unscoped menus', () => {
  const { matchesCartTableContext } = tableContextRules();

  assert.equal(matchesCartTableContext({ table: '۰۷' }, '7'), true, 'Persian numerals compare canonically');
  assert.equal(matchesCartTableContext({ table: 'VIP ۰۷' }, 'VIP 07'), true, 'text table labels keep their identity');
  assert.equal(matchesCartTableContext({ table: '7' }, '9'), false, 'a table-scoped cart cannot be retargeted');
  assert.equal(matchesCartTableContext({}, '9'), true, 'manual table selection remains available without QR scope');
});

test('public cart keys canonicalize equivalent Persian, Arabic and Latin numeric QR identities', () => {
  const { readCartContext, cartStorageKeyForContext } = queryContext();
  const key = (query) => cartStorageKeyForContext(readCartContext(new URLSearchParams(query)));

  assert.equal(key('?branch=۲&table=۰۷'), key('?branchId=2&t=7'));
  assert.equal(key('?branch=٠٢&tableNo=٠٠٧'), key('?branchId=2&table=7'));
  assert.notEqual(key('?branch=2&table=7'), key('?branch=3&table=7'), 'a cart is still isolated by branch');
  assert.equal(
    key('?branch=branch-west&table=میز%20۷'),
    key('?branch=branch-west&table=میز%207'),
    'text table labels stay textual while their Persian/Arabic/Latin digits normalize',
  );
});

test('cart storage identity canonicalizes Persian, Arabic, and Latin numeric IDs across aliases', () => {
  const { readCartContext, cartStorageKeyForContext } = queryContext();
  const searches = [
    '?branch=۰۰۲&table=۰۰۷',
    '?branchId=٠٠٢&t=٠٠٧',
    '?branchId=2&tableNo=7',
  ];
  const keys = searches.map((search) => cartStorageKeyForContext(
    readCartContext(new URLSearchParams(search)),
  ));

  assert.deepEqual(keys, [
    'westo_table:v2:2:table:7',
    'westo_table:v2:2:table:7',
    'westo_table:v2:2:table:7',
  ]);
});

test('cart storage identity preserves textual table and branch IDs, including internal spaces and digits', () => {
  const { readCartContext, cartStorageKeyForContext } = queryContext();
  const context = readCartContext(new URLSearchParams(
    '?branch=west%20wing%2002&table=VIP%20۰۷',
  ));

  assert.equal(
    cartStorageKeyForContext(context),
    'westo_table:v2:west%20wing%2002:table:VIP%2007',
  );
  assert.equal(
    cartStorageKeyForContext(readCartContext(new URLSearchParams('?branch=west%20wing%2002&table=VIP%2007'))),
    cartStorageKeyForContext(context),
    'numeral glyphs normalize without changing the textual table name',
  );
  assert.notEqual(
    cartStorageKeyForContext(readCartContext(new URLSearchParams('?branch=west%20wing%2002&table=VIP%207'))),
    cartStorageKeyForContext(context),
    'zero padding inside a textual table identifier is preserved',
  );
});

test('invalid numeric branch context fails closed and cannot share the unscoped cart', () => {
  const { readCartContext, cartStorageKeyForContext, hasInvalidNumericBranchContext } = queryContext();
  const noBranch = readCartContext(new URLSearchParams('?table=7'));
  const zeroBranch = readCartContext(new URLSearchParams('?branch=۰&table=7'));
  const unsafeBranch = readCartContext(new URLSearchParams('?branch=9007199254740993&table=7'));
  const slugBranch = readCartContext(new URLSearchParams('?branch=west-wing&table=7'));

  assert.equal(hasInvalidNumericBranchContext(noBranch), false);
  assert.equal(hasInvalidNumericBranchContext(zeroBranch), true);
  assert.equal(hasInvalidNumericBranchContext(unsafeBranch), true);
  assert.equal(hasInvalidNumericBranchContext(slugBranch), false, 'textual branch slugs are resolved by the server');
  assert.notEqual(
    cartStorageKeyForContext(zeroBranch),
    cartStorageKeyForContext(noBranch),
    'an invalid explicit branch must not reuse the default/unscoped table cart',
  );
  assert.notEqual(
    cartStorageKeyForContext(unsafeBranch),
    cartStorageKeyForContext(noBranch),
    'an unsafe numeric branch must remain isolated instead of falling back to the default cart',
  );
  assert.match(cartSource, /if \(invalidNumericCartBranch\)[\s\S]*?throw Object\.assign\(new Error\('invalid branch context'\)/);
  assert.match(cartSource, /if \(invalidNumericCartBranch\) \{\s*toast\([\s\S]*?return false;/);
});

test('QR table identity rejects values longer than the server table-number limit', () => {
  const rules = tableContextRules();
  const withinLimit = { table: '12345678901234567890' };
  const overLimit = { table: '12345678901234567890-alias' };

  assert.equal(rules.tableContextIsWithinServerLimit(withinLimit), true);
  assert.equal(rules.matchesCartTableContext(withinLimit, withinLimit.table), true);
  assert.equal(rules.tableContextIsWithinServerLimit(overLimit), false);
  assert.equal(rules.matchesCartTableContext(overLimit, overLimit.table), false,
    'a QR identifier must not be silently truncated into another server table identity');
  assert.match(cartSource, /شناسهٔ میز در QR از حد مجاز بیشتر است/);
});

test('classic menu uses the same QR aliases and requests branch-filtered guest items', () => {
  const cartRules = queryContext();
  const menuRules = classicMenuQueryContext();
  const cases = [
    '?t=۰۷&branchId=۲',
    '?table=9&t=7&branch=3&branchId=4',
    '?table=&t=7&branch=&branchId=4',
  ];

  for (const search of cases) {
    const params = new URLSearchParams(search);
    const expected = cartRules.readCartContext(params);
    const actual = menuRules.readMenuCartContext(params);
    assert.deepEqual(JSON.parse(JSON.stringify(actual)), JSON.parse(JSON.stringify(expected)));
    const requestUrl = menuRules.publicMenuRequestUrl(actual);
    const request = new URL(requestUrl, 'http://localhost');
    assert.equal(request.pathname, '/api/menu');
    assert.equal(request.searchParams.get('branch'), expected.branch || null);
    assert.equal(request.searchParams.has('all'), false, 'branch stock filtering is not bypassed');
  }

  assert.match(classicMenuSource, /fetch\(publicMenuRequestUrl\(\{ branch: cartBranch \}\)/);
  assert.doesNotMatch(classicMenuSource, /fetch\('\/api\/menu\?all=1'/);
  assert.match(cartSource, /fetch\(cartBranch \? `\/api\/menu\?branch=\$\{encodeURIComponent\(cartBranch\)\}` : '\/api\/menu'\)/);
  assert.match(cartSource, /\.\.\.branchSelector,/);

  for (const search of [
    '?branch=۲&table=۰۷',
    '?branchId=٠٠٢&t=٠٠٧',
    '?branch=2&table=7',
    '?branch=west%20wing%2002&table=VIP%20۰۷',
  ]) {
    const params = new URLSearchParams(search);
    assert.equal(
      menuRules.cartStorageKeyForContext(menuRules.readMenuCartContext(params)),
      cartRules.cartStorageKeyForContext(cartRules.readCartContext(params)),
      `classic menu and cart must use one storage identity for ${search}`,
    );
  }
});
