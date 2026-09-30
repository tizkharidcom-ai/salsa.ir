'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {
  MAX_MODIFIER_GROUPS,
  MAX_MODIFIER_OPTIONS_PER_GROUP,
  normalizeModifierGroups,
  effectiveModifierGroupsForItem,
  validateModifierGroupDefinitions,
  validateModifierSelection,
  calculateModifierLinePrice,
} = require('../server/menu-modifiers');

function definitions(overrides = {}) {
  return [{
    id: 'size',
    title: 'اندازه',
    selection: 'single',
    required: true,
    options: [
      { id: 'regular', name: 'معمولی', price: 0 },
      { id: 'large', name: 'بزرگ', price: 125000 },
      { id: 'sold-out', name: 'ناموجود', price: 90000, available: false },
    ],
    ...overrides,
  }];
}

function codes(result) {
  return result.errors.map((entry) => entry.code);
}

function clientMenuRules() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'classic-menu.js'), 'utf8');
  const start = source.indexOf('/* Shared guest-menu rules.');
  const end = source.indexOf('/* Classic menu —', start);
  assert.ok(start >= 0 && end > start, 'shared client rules stay isolated from DOM boot code');
  const context = { window: {} };
  vm.runInNewContext(source.slice(start, end), context, { filename: 'classic-menu-rules.js' });
  return context.window.WestoMenuUiRules;
}

function bootMenuStore(menu, { search = '', stored = {}, fetchMenu = null } = {}) {
  class TestCustomEvent {
    constructor(type, init = {}) { this.type = type; this.detail = init.detail; }
  }
  const events = [];
  const requests = [];
  const storage = new Map(Object.entries(stored));
  const window = {
    __WESTO_CONTENT__: { menu },
    dispatchEvent(event) { events.push(event); },
    addEventListener() {},
    setTimeout() { return 1; },
    clearTimeout() {},
  };
  const context = {
    window,
    CustomEvent: TestCustomEvent,
    URLSearchParams,
    location: { search },
    localStorage: {
      getItem(key) { return storage.get(key) ?? null; },
      setItem(key, value) { storage.set(key, String(value)); },
      removeItem(key) { storage.delete(key); },
    },
    async fetch(url) {
      requests.push(String(url));
      if (fetchMenu) return fetchMenu(String(url));
      throw new Error('boot payload must not fetch');
    },
    console: { warn() {} },
    Date,
    Promise,
    Object,
    Array,
    Number,
    String,
    Boolean,
  };
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, '..', 'js', 'menu-store.js'), 'utf8'),
    context,
    { filename: 'menu-store.js' },
  );
  return { store: window.westoMenuStore, events, requests, storage };
}

test('normalization keeps legacy groups usable and constrains malformed prices to unavailable', () => {
  const raw = [{
    id: ' extras ',
    title: 'افزودنی',
    selection: 'multiple',
    options: [
      { id: 'cheese', name: 'پنیر', price: '120.4' },
      { id: 'bad-price', name: 'قیمت خراب', price: 'not-money' },
    ],
  }];
  const normalized = normalizeModifierGroups(raw);

  assert.deepEqual(normalized[0], {
    id: 'extras',
    title: 'افزودنی',
    selection: 'multiple',
    required: false,
    minSelections: 0,
    maxSelections: MAX_MODIFIER_OPTIONS_PER_GROUP,
    options: [
      { id: 'cheese', name: 'پنیر', price: 120, available: true },
      { id: 'bad-price', name: 'قیمت خراب', price: 0, available: false },
    ],
  });
  assert.equal(raw[0].options[0].price, '120.4', 'normalization does not mutate the source definition');
});

test('explicit empty groups stay empty and absent groups do not infer modifiers or prices', () => {
  assert.deepEqual(normalizeModifierGroups([{ id: 'blank', title: 'عمداً خالی', options: [] }]), []);
  assert.deepEqual(effectiveModifierGroupsForItem({ name: 'لاته' }), [], 'runtime menu never infers saleable options or prices from a name');
});

test('invalid persisted modifier definitions stay non-orderable in guest menu payloads', () => {
  const rawGroups = [{
    id: 'size', title: 'اندازه', selection: 'single', required: true,
    options: [
      { id: 'same', name: 'معمولی', price: 0 },
      { id: 'same', name: 'بزرگ', price: 50000 },
    ],
  }];
  const exposed = effectiveModifierGroupsForItem({ modifierGroups: rawGroups });

  assert.equal(validateModifierGroupDefinitions(rawGroups).ok, false);
  assert.equal(exposed.length, 1);
  assert.equal(validateModifierGroupDefinitions(exposed).ok, false, 'the response marker cannot pass cart validation');
  assert.equal(clientMenuRules().normalizeGroups(exposed).ok, false, 'classic menu must disable the broken configuration before carting');
  assert.equal(rawGroups[0].options[0].id, 'same', 'the persisted source is left untouched');
});

test('definition validation rejects ambiguous IDs, impossible cardinality, and invalid prices', () => {
  const result = validateModifierGroupDefinitions([
    {
      id: 'same', title: 'اول', selection: 'single', required: true,
      options: [
        { id: 'duplicate', name: 'الف', price: 10 },
        { id: 'duplicate', name: 'ب', price: -1 },
        { id: 'coerced-price', name: 'قیمت غیرعددی', price: true },
      ],
    },
    { id: 'same', title: 'دوم', options: [{ id: 'x', name: 'ایکس', price: 'NaN' }] },
    { id: 'bad-cardinality', title: 'نامعتبر', selection: 'single', required: false, minSelections: 2, maxSelections: 1, options: [{ id: 'x', name: 'ایکس' }] },
  ]);

  assert.equal(result.ok, false);
  assert.ok(codes(result).includes('duplicate_modifier_option_id'));
  assert.ok(codes(result).includes('duplicate_modifier_group_id'));
  assert.ok(codes(result).includes('modifier_option_price_invalid'));
  assert.ok(codes(result).includes('modifier_cardinality_invalid'));
});

test('definition limits are explicit and required groups must retain enough available choices', () => {
  const tooManyGroups = Array.from({ length: MAX_MODIFIER_GROUPS + 1 }, (_, index) => ({
    id: `g-${index}`, title: `گروه ${index}`, options: [{ id: 'a', name: 'الف' }],
  }));
  const groupResult = validateModifierGroupDefinitions(tooManyGroups);
  assert.ok(codes(groupResult).includes('too_many_modifier_groups'));

  const tooManyOptions = [{
    id: 'g', title: 'گروه', selection: 'multiple',
    options: Array.from({ length: MAX_MODIFIER_OPTIONS_PER_GROUP + 1 }, (_, index) => ({ id: `o-${index}`, name: `گزینه ${index}` })),
  }];
  assert.ok(codes(validateModifierGroupDefinitions(tooManyOptions)).includes('too_many_modifier_options'));

  const coercion = validateModifierGroupDefinitions([{
    id: 'coercion', title: 'ورودی مبهم', minSelections: true,
    options: [{ id: 'array-price', name: 'مبلغ مبهم', price: [] }],
  }]);
  assert.ok(codes(coercion).includes('modifier_min_selections_invalid'));
  assert.ok(codes(coercion).includes('modifier_option_price_invalid'));

  const unavailableRequired = validateModifierGroupDefinitions([{
    id: 'required', title: 'اجباری', required: true,
    options: [{ id: 'none', name: 'ناموجود', available: false }],
  }]);
  assert.ok(codes(unavailableRequired).includes('modifier_required_options_unavailable'));
});

test('selection rejects missing required choices and cardinality violations', () => {
  const single = definitions();
  assert.ok(codes(validateModifierSelection(single, [])).includes('modifier_selection_below_minimum'));

  const selectedTwice = validateModifierSelection(single, [
    { groupId: 'size', id: 'regular' },
    { groupId: 'size', id: 'large' },
  ]);
  assert.ok(codes(selectedTwice).includes('modifier_selection_above_maximum'));

  const multi = [{
    id: 'toppings', title: 'تاپینگ', selection: 'multiple', minSelections: 1, maxSelections: 2,
    options: [
      { id: 'a', name: 'آ', price: 1 },
      { id: 'b', name: 'ب', price: 2 },
      { id: 'c', name: 'پ', price: 3 },
    ],
  }];
  const tooMany = validateModifierSelection(multi, [
    { groupId: 'toppings', id: 'a' },
    { groupId: 'toppings', id: 'b' },
    { groupId: 'toppings', id: 'c' },
  ]);
  assert.ok(codes(tooMany).includes('modifier_selection_above_maximum'));
});

test('selection rejects unknown, unavailable, malformed, and duplicate options rather than dropping them', () => {
  const groups = definitions();
  assert.ok(codes(validateModifierSelection(groups, [{ groupId: 'missing', id: 'regular' }])).includes('modifier_group_unknown'));
  assert.ok(codes(validateModifierSelection(groups, [{ groupId: 'size', id: 'ghost' }])).includes('modifier_option_unknown'));
  assert.ok(codes(validateModifierSelection(groups, [{ groupId: 'size', id: 'sold-out' }])).includes('modifier_option_unavailable'));
  assert.ok(codes(validateModifierSelection(groups, [{ id: 'regular' }])).includes('modifier_selection_identity_required'));
  assert.ok(codes(validateModifierSelection(groups, [
    { groupId: 'size', id: 'regular' },
    { groupId: 'size', id: 'regular' },
  ])).includes('duplicate_modifier_selection'));
});

test('selection trusts only group and option IDs, and derives names and prices from menu definitions', () => {
  const groups = [
    { id: 'drink', title: 'نوشیدنی', selection: 'single', options: [{ id: 'regular', name: 'عادی', price: 0 }] },
    { id: 'meal', title: 'غذا', selection: 'single', options: [{ id: 'regular', name: 'ویژه', price: 45000 }] },
  ];
  const result = validateModifierSelection(groups, [
    { groupId: 'drink', id: 'regular', name: 'دستکاری‌شده', price: 999999999 },
    { groupId: 'meal', id: 'regular', name: 'نام دیگر', price: -5 },
  ]);

  assert.equal(result.ok, true);
  assert.equal(result.modifierTotal, 45000);
  assert.deepEqual(result.modifiers.map(({ groupId, id, name, price }) => ({ groupId, id, name, price })), [
    { groupId: 'drink', id: 'regular', name: 'عادی', price: 0 },
    { groupId: 'meal', id: 'regular', name: 'ویژه', price: 45000 },
  ]);

  const nameOnly = validateModifierSelection(groups, [{ groupId: 'meal', name: 'ویژه' }]);
  assert.ok(codes(nameOnly).includes('modifier_selection_identity_required'));
});

test('line pricing uses validated server prices and guards invalid or unsafe totals', () => {
  const selected = [{ groupId: 'size', id: 'large', price: 1, name: 'دستکاری' }];
  const priced = calculateModifierLinePrice(300000, 2, definitions(), selected);
  assert.equal(priced.ok, true);
  assert.deepEqual({
    basePrice: priced.basePrice,
    modifierTotal: priced.modifierTotal,
    unitPrice: priced.unitPrice,
    quantity: priced.quantity,
    lineTotal: priced.lineTotal,
  }, {
    basePrice: 300000,
    modifierTotal: 125000,
    unitPrice: 425000,
    quantity: 2,
    lineTotal: 850000,
  });
  assert.equal(priced.modifiers[0].name, 'بزرگ');
  assert.equal(priced.modifiers[0].price, 125000);
  assert.deepEqual(calculateModifierLinePrice(-1, 1, definitions(), selected), { ok: false, error: 'base_price_invalid' });
  assert.deepEqual(calculateModifierLinePrice(1, 0, definitions(), selected), { ok: false, error: 'quantity_invalid' });
  assert.ok(codes(calculateModifierLinePrice(1, 1, definitions(), [])).includes('modifier_selection_below_minimum'));
  assert.deepEqual(calculateModifierLinePrice(Number.MAX_SAFE_INTEGER, 2, [], []), { ok: false, error: 'modifier_line_total_unsafe' });
});

test('guest menu price parser accepts exact toman integers and refuses guessed/coerced amounts', () => {
  const rules = clientMenuRules();
  for (const [input, expected] of [[0, 0], ['125000', 125000], ['۱۲۵۰۰۰', 125000], ['١٢٥٠٠٠', 125000]]) {
    assert.equal(rules.safePrice(input), expected);
  }
  for (const invalid of ['', '  ', '۱٬۲۵۰', '125.5', '-1', '1e5', true, null, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(rules.safePrice(invalid), null, `reject ${String(invalid)}`);
  }
});

test('guest option rules preserve optional/required cardinality and disable unknown prices', () => {
  const rules = clientMenuRules();
  const normalized = rules.normalizeGroups([
    {
      id: 'size', title: 'اندازه', selection: 'single', required: true,
      options: [
        { id: 'regular', name: 'معمولی', price: '۰', available: true },
        { id: 'unknown-price', name: 'قیمت ثبت‌نشده', price: '', available: true },
      ],
    },
    {
      id: 'extras', title: 'افزودنی', selection: 'multiple', minSelections: 0, maxSelections: 2,
      options: [{ id: 'cheese', name: 'پنیر', price: 25000, available: true }],
    },
  ]);

  assert.equal(normalized.ok, true);
  assert.equal(normalized.groups[0].minSelections, 1);
  assert.equal(normalized.groups[0].options[1].available, false);
  assert.equal(normalized.groups[1].minSelections, 0);
  assert.equal(rules.normalizeGroups(undefined).groups.length, 0, 'missing server groups never generate demo choices');
  assert.equal(rules.normalizeGroups([{ id: 'empty', title: 'خالی', options: [] }]).ok, false);
  assert.equal(rules.normalizeGroups([
    { id: 'same', title: 'اول', selection: 'single', options: [{ id: 'a', name: 'آ', price: 1 }] },
    { id: 'same', title: 'دوم', selection: 'single', options: [{ id: 'b', name: 'ب', price: 2 }] },
  ]).ok, false);
});

test('guest selection submits IDs only and calculates names/prices from current definitions', () => {
  const rules = clientMenuRules();
  const groups = rules.normalizeGroups([{
    id: 'size', title: 'اندازه', selection: 'single', required: true,
    options: [
      { id: 'regular', name: 'معمولی', price: 0, available: true },
      { id: 'large', name: 'بزرگ', price: 40000, available: true },
      { id: 'sold-out', name: 'ناموجود', price: 60000, available: false },
    ],
  }]);
  const valid = rules.resolveSelection(groups, [{ groupId: 'size', id: 'large', name: 'دستکاری', price: 1 }], '۳۰۰۰۰۰');
  assert.equal(valid.ok, true);
  assert.equal(valid.unitPrice, 340000);
  assert.deepEqual(JSON.parse(JSON.stringify(valid.modifiers)), [
    { groupId: 'size', id: 'large', groupTitle: 'اندازه', name: 'بزرگ', price: 40000 },
  ]);
  assert.equal(rules.resolveSelection(groups, [], 300000).ok, false, 'required choice blocks add');
  assert.equal(rules.resolveSelection(groups, [{ groupId: 'size', id: 'sold-out' }], 300000).ok, false);
  assert.equal(rules.resolveSelection(groups, [{ groupId: 'unknown', id: 'large' }], 300000).ok, false);
  assert.equal(rules.resolveSelection(groups, [{ groupId: 'size', id: 'large' }], 'not-a-price').ok, false);
});

test('menu store honors the server-published category list and ignores invalid covers', () => {
  const { store, events } = bootMenuStore({
    menuItems: [{ id: 1, categoryId: 2, name: 'آیتم واقعی', price: 100, available: true }],
    siteCategories: [
      { id: 2, title: 'غذای روز', coverImg: 'assets/menu/real-food.webp' },
      { id: 3, title: 'بدون کاور', coverImg: '' },
      { id: 4, title: 'کاور ساختاری', coverImg: 'assets/textures/westo_texture_placeholder.webp' },
    ],
    menuCategories: [{ id: 5, title: 'جایگزین', coverImg: 'assets/menu/other.webp' }],
  });
  assert.deepEqual(JSON.parse(JSON.stringify(store.categories.map(({ id }) => id))), [2]);
  assert.deepEqual(JSON.parse(JSON.stringify(store.categoryOrder)), [2]);
  assert.equal(events.some((event) => event.type === 'westo:menu-ready'), true);
});

test('branch QR menu bypasses the unfiltered bootstrap and requests the canonical branch', async () => {
  const globalMenu = {
    menuItems: [{ id: 1, categoryId: 2, available: true }],
    menuCategories: [{ id: 2, title: 'دسته اصلی' }],
  };
  const branchMenu = {
    menuItems: [{ id: 22, categoryId: 2, available: true }],
    menuCategories: [{ id: 2, title: 'دسته اصلی' }],
  };
  const { store, requests } = bootMenuStore(globalMenu, {
    search: '?branch=%DB%B0%DB%B2',
    fetchMenu: async (url) => ({ ok: true, json: async () => branchMenu }),
  });

  await store.ready;
  assert.deepEqual(requests, ['/api/menu?branch=2']);
  assert.deepEqual(Array.from(store.data.menuItems, ({ id }) => id), [22]);
  assert.equal(store.fromCache, false);
});

test('branch QR offline hydration never falls back to another branch or the global menu cache', async () => {
  const globalMenu = {
    menuItems: [{ id: 1, categoryId: 2, available: true }],
    menuCategories: [{ id: 2, title: 'دسته اصلی' }],
  };
  const branchMenu = {
    menuItems: [{ id: 22, categoryId: 2, available: true }],
    menuCategories: [{ id: 2, title: 'دسته اصلی' }],
  };
  const stored = {
    'westo_menu_cache': JSON.stringify({ savedAt: 10, data: globalMenu }),
    'westo_menu_cache:v2:branch:2': JSON.stringify({ savedAt: 20, data: branchMenu }),
  };
  const { store, requests } = bootMenuStore(globalMenu, {
    search: '?branchId=۲',
    stored,
    fetchMenu: async () => { throw new Error('offline'); },
  });

  await store.ready;
  assert.deepEqual(requests, ['/api/menu?branch=2']);
  assert.deepEqual(Array.from(store.data.menuItems, ({ id }) => id), [22]);
  assert.equal(store.fromCache, true);
  assert.ok(store.lastError);
});

test('menu/category and cart integration fail closed and preserve option identities at quote', () => {
  const classic = fs.readFileSync(path.join(__dirname, '..', 'js', 'classic-menu.js'), 'utf8');
  const cart = fs.readFileSync(path.join(__dirname, '..', 'js', 'table-cart.js'), 'utf8');
  const smart = fs.readFileSync(path.join(__dirname, '..', 'js', 'westo-menu.smart.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '..', 'menu.html'), 'utf8');
  const styles = fs.readFileSync(path.join(__dirname, '..', 'css', 'classic-menu-catalogue-v2.css'), 'utf8');
  const storyStyles = fs.readFileSync(path.join(__dirname, '..', 'css', 'menu-story.css'), 'utf8');
  assert.ok(classic.includes('categories = siteCategories.filter((c) => c && hasCover(c));'));
  assert.match(classic, /activeDayparts,\s*\}\);/);
  assert.match(cart, /!isInActiveDaypart\(item, currentDayparts\)/);
  assert.match(cart, /itemAvailabilityError\(pendingItem\)/);
  assert.match(cart, /role="\$\{group\.mode === 'single' \? 'radiogroup' : 'group'\}"/);
  assert.match(cart, /aria-describedby="\$\{escapeHtml\(name\)\}-hint"/);
  assert.match(cart, /modifiers:\s*\(Array\.isArray\(l\.modifiers\)[\s\S]*?groupId, id/);
  assert.match(cart, /Number\(quote\.subtotal\) !== shownSubtotal/);
  assert.match(cart, /function ensureMenuLoadState\(\)/);
  assert.match(cart, /menuStore\.lastError && typeof menuStore\.refresh === 'function'/);
  assert.match(cart, /Ordering stays unavailable until a valid menu is received/);
  assert.match(cart, /sec\.setAttribute\('aria-hidden', 'true'\)/);
  assert.match(smart, /function modifierLineKey\(line\)/);
  assert.match(smart, /if \(addItem\(item, qty, \{ fromEl, modifiers: selection\.modifiers \}\)\) closeQtyModal\(\)/);
  assert.match(smart, /items: cart\.map\(\(l\) => \(\{[\s\S]*?modifiers: \(Array\.isArray\(l\.modifiers\)[\s\S]*?groupId, id/);
  assert.match(smart, /const shownSubtotal = cartTotal\(\)/);
  assert.match(html, /id="qty-modifiers"/);
  assert.match(html, /id="qty-modifier-message"[^>]+role="alert"/);
  assert.ok(classic.includes('role="alert"><p>'));
  assert.ok(classic.includes('id="cm-retry"'));
  assert.match(html, /id="cm-meta" role="status" aria-live="polite"/);
  assert.match(html, /id="table-cart-validation"[^>]*role="alert"/);
  assert.match(html, /aria-describedby="cm-detail-desc"/);
  assert.match(styles, /\.cm-detail__price\s*\{[\s\S]*?overflow-wrap:\s*anywhere/);
  assert.match(styles, /@media \(max-width:\s*559px\)/);
  assert.match(storyStyles, /\.westo-menu-load-state \.westo-menu-load-retry\s*\{[\s\S]*?min-height:\s*44px/);
});
