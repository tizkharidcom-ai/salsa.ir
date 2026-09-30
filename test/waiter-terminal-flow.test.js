'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('./helpers/source-fs');
const path = require('node:path');

const jsPath = path.join(__dirname, '..', 'js', 'role-panel.js');
const cssPath = path.join(__dirname, '..', 'css', 'waiter-floor-plan.css');
const htmlPath = path.join(__dirname, '..', 'role-panel.html');
const serverPath = path.join(__dirname, '..', 'server', 'server.js');
const source = fs.readFileSync(jsPath, 'utf8');
const styles = fs.readFileSync(cssPath, 'utf8');
const html = fs.readFileSync(htmlPath, 'utf8');
const serverSource = fs.readFileSync(serverPath, 'utf8');
const mobileFlowStyles = styles.slice(styles.lastIndexOf('@media (max-width: 640px)'));

function sourceBetween(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`);
  return source.slice(start, end);
}

const basicRulesSource = sourceBetween(
  '  function highestWaiterAssignedSeat(',
  '  function waiterDraftStorageKey(',
);
const recoveryRuleSource = sourceBetween(
  '  function waiterDraftCanRecover(',
  '  function offerWaiterDraftRecovery(',
);
const waiterRules = new Function(`${basicRulesSource}\n${recoveryRuleSource}\nreturn {
  highestWaiterAssignedSeat,
  validateWaiterCovers,
  waiterCanIncrementItemQuantity,
  waiterDraftLineMergeKey,
  mergeWaiterDraftLine,
  waiterTerminalHasUnsentWork,
  waiterTerminalMutationLocked,
  waiterPendingPaymentCanRecover,
  waiterDraftHasRecordedPayment,
  waiterOrderSubmissionCanRecover,
  splitWaiterCourseLines,
  waiterOrderDraftSignature,
  waiterDraftCanRecover,
};`)();

function createWaiterSplitHarness(apiImpl) {
  const source = sourceBetween('  async function submitWaiterSplit(', '\n  function splitOrderCheck(');
  const wt = {
    order: { id: 44, branchId: 7, items: [{ menuItemId: 1 }, { menuItemId: 2 }] },
    table: { id: '12' },
    lines: [{ localSaved: true }, { localSaved: true }],
    dirty: false,
    remoteUpdatePending: false,
    splitNeedsRefresh: false,
    splitSaving: false,
  };
  const state = { branchId: 7, waiterTerminal: wt, data: { orders: [] } };
  const events = [];
  const persisted = [];
  const persistWaiterTerminalDraft = (target) => {
    const pendingSplit = JSON.parse(JSON.stringify(target.pendingSplit));
    persisted.push(pendingSplit);
    events.push({ type: 'persist', pendingSplit });
    return true;
  };
  const api = async (url, options) => {
    events.push({
      type: 'post', url, headers: options.headers,
      body: options.body, persistedPendingSplit: persisted.at(-1),
    });
    return apiImpl(url, options);
  };
  const submit = new Function(
    'state', 'waiterHasCapability', 'waiterTerminalMutationLocked', 'waiterOrderDraftSignature',
    'persistWaiterTerminalDraft', 'showToast', 'dialogBody', 'api', 'dialog',
    'renderWaiterTerminal', 'refreshWaiterAfterMutation', 'waiterFloor',
    `${source}\nreturn submitWaiterSplit;`,
  )(
    state, () => true, waiterRules.waiterTerminalMutationLocked, () => 'before-split',
    persistWaiterTerminalDraft, () => {}, { querySelectorAll: () => [] }, api,
    { close() {} }, () => {}, async () => true, () => {},
  );
  return { state, wt, events, persisted, submit };
}

test('waiter item drawer rerenders in place without reopening its native modal', () => {
  const openDialogSource = sourceBetween('  function openDialog(kicker, title, body, options = {})', '\n  function setActiveBranch(');
  const fields = new Map([
    ['dialog-kicker', { textContent: '' }],
    ['dialog-title', { textContent: '' }],
  ]);
  let showModalCalls = 0;
  const dialog = {
    open: false,
    classList: { toggle() {} },
    showModal() { showModalCalls++; this.open = true; },
  };
  const dialogBody = { innerHTML: '' };
  const openDialog = new Function('dialog', 'document', 'dialogBody', `${openDialogSource}\nreturn openDialog;`)(
    dialog,
    { getElementById: (id) => fields.get(id) },
    dialogBody,
  );

  openDialog('غذا', 'سفارش اول', '<button>صندلی ۱</button>', { variant: 'waiter-item', reuse: true });
  assert.equal(showModalCalls, 1, 'the initial item drawer is opened as a native modal');
  openDialog('غذا', 'سفارش اول', '<button>صندلی ۲</button>', { variant: 'waiter-item', reuse: true });

  assert.equal(showModalCalls, 1, 'updating seat/options/quantity must not call showModal on an already-open dialog');
  assert.equal(dialogBody.innerHTML, '<button>صندلی ۲</button>');
  assert.match(sourceBetween('function openItemCustomization(item)', 'function paintTerminalCheck(container)'), /variant: 'waiter-item', reuse: true/);
});

test('item quantity stepper stops at the server-supported maximum of 99', () => {
  assert.equal(waiterRules.waiterCanIncrementItemQuantity(1), true);
  assert.equal(waiterRules.waiterCanIncrementItemQuantity(98), true);
  assert.equal(waiterRules.waiterCanIncrementItemQuantity(99), false);
  for (const value of [0, -1, 1.5, 100, Number.NaN, '۲']) {
    assert.equal(waiterRules.waiterCanIncrementItemQuantity(value), false, String(value));
  }
  assert.match(source, /id="drawer-inc-qty"[^>]*\$\{!waiterCanIncrementItemQuantity\(qty\) \? 'disabled' : ''\}/);
  assert.match(source, /if \(!waiterCanIncrementItemQuantity\(qty\)\) return showToast\('حداکثر تعداد هر قلم ۹۹ است\.'/);
});

test('adding the same configured waiter item merges quantity and preserves the existing line context', () => {
  const existing = {
    localId: 'saved-line-1', menuItemId: 42, name: 'غذای اصلی', price: 100, unitTotal: 125,
    lineTotal: 260, qty: 2,
    modifiers: [{ groupId: 'size', id: 'large', price: 25 }],
    complements: [{ id: 8, complementId: 8, qty: 2, price: 5 }],
    note: 'بدون نمک', seat: 3, course: 'entrees', courseStatus: 'hold',
    firedAt: '2026-09-23T10:00:00.000Z', localSaved: true,
  };
  const lines = [existing];
  const incoming = {
    menuItemId: '42', qty: 3,
    modifiers: [{ groupId: 'size', id: 'large', price: 999 }],
    complements: [{ complementId: '8', qty: 2 }],
    note: '  بدون نمک  ', seat: 3, course: 'ENTREES', courseStatus: 'HOLD',
  };

  const result = waiterRules.mergeWaiterDraftLine(lines, incoming);

  assert.equal(result.ok, true);
  assert.equal(result.merged, true);
  assert.equal(lines.length, 1);
  assert.equal(lines[0], existing, 'retain the original line identity');
  assert.equal(existing.localId, 'saved-line-1');
  assert.equal(existing.qty, 5);
  assert.equal(existing.localSaved, false, 'a saved server line becomes an unsaved local edit');
  assert.equal(Object.hasOwn(existing, 'lineTotal'), false, 'drop the stale quantity-derived total');
  assert.equal(existing.unitTotal, 125);
  assert.deepEqual(existing.modifiers, [{ groupId: 'size', id: 'large', price: 25 }]);
  assert.deepEqual(existing.complements, [{ id: 8, complementId: 8, qty: 2, price: 5 }]);
  assert.equal(existing.seat, 3);
  assert.equal(existing.course, 'entrees');
  assert.equal(existing.courseStatus, 'hold');
  assert.equal(existing.note, 'بدون نمک');
  assert.equal(existing.firedAt, '2026-09-23T10:00:00.000Z');
  assert.notEqual(waiterRules.waiterDraftLineMergeKey(existing), '');
});

test('waiter draft items with different modifiers, complements, note, seat, or course remain separate', () => {
  const base = {
    localId: 'line-original', menuItemId: 42, qty: 2, seat: 1,
    modifiers: [{ groupId: 'size', id: 'large' }],
    complements: [{ id: 8, qty: 1 }],
    note: 'کم نمک', course: 'entrees', courseStatus: 'hold',
  };
  const differentConfigurations = [
    ['modifier', { modifiers: [{ groupId: 'size', id: 'small' }] }],
    ['complement quantity', { complements: [{ id: 8, qty: 2 }] }],
    ['note', { note: 'بدون نمک' }],
    ['seat', { seat: 2 }],
    ['course', { course: 'dessert' }],
    ['course status', { courseStatus: 'fired' }],
  ];

  for (const [label, difference] of differentConfigurations) {
    const original = { ...base, modifiers: [...base.modifiers], complements: [...base.complements] };
    const lines = [original];
    const result = waiterRules.mergeWaiterDraftLine(lines, { ...base, ...difference, localId: `line-${label}`, qty: 1 });
    assert.equal(result.ok, true, label);
    assert.equal(result.merged, false, label);
    assert.equal(lines.length, 2, label);
    assert.equal(original.qty, 2, label);
  }
});

test('waiter draft quantity merge accepts 99 and rejects overflow without mutating or appending', () => {
  const base = { menuItemId: 42, seat: 0, qty: 98, modifiers: [], complements: [], note: '', course: 'starters', courseStatus: 'fired' };
  const line = { ...base, localId: 'line-at-cap', lineTotal: 9800 };
  const lines = [line];

  const reachesCap = waiterRules.mergeWaiterDraftLine(lines, { ...base, qty: 1 });
  assert.deepEqual({ ok: reachesCap.ok, merged: reachesCap.merged }, { ok: true, merged: true });
  assert.equal(line.qty, 99);
  assert.equal(lines.length, 1);

  const overflow = waiterRules.mergeWaiterDraftLine(lines, { ...base, qty: 1 });
  assert.equal(overflow.ok, false);
  assert.equal(overflow.error, 'quantity_limit');
  assert.equal(line.qty, 99);
  assert.equal(lines.length, 1, 'a capped combination is not appended as a duplicate line');
  assert.equal(Object.hasOwn(line, 'lineTotal'), false);
});

test('waiter add-item handler merges before closing and leaves failed additions in the drawer', () => {
  const customization = sourceBetween('function openItemCustomization(item)', 'function paintTerminalCheck(container)');
  const addHandler = customization.slice(customization.indexOf("querySelector('#drawer-add-to-check')"));
  const merge = addHandler.indexOf('mergeWaiterDraftLine(wt.lines, {');
  const failure = addHandler.indexOf('if (!addResult.ok)', merge);
  const close = addHandler.indexOf('dialog.close()', merge);
  assert.ok(merge >= 0 && failure > merge && close > failure,
    'a failed merge, including the quantity cap, returns before the drawer is closed');
  assert.match(addHandler.slice(merge, failure), /menuItemId: item\.id[\s\S]*?modifiers,[\s\S]*?complements: \[\],[\s\S]*?note: lineNote,[\s\S]*?seat: selectedSeat,[\s\S]*?course: selectedCourse,[\s\S]*?courseStatus: selectedCourseStatus/);
  assert.match(addHandler, /if \(!addResult\.ok\) \{\s*return showToast\(addResult\.error === 'quantity_limit'[\s\S]*?'warning'\);/);
  assert.match(addHandler, /wt\.dirty = true;[\s\S]*?dialog\.close\(\)/);
});

test('guest count cannot fall below an assigned seat or contain invalid values', () => {
  const lines = [{ seat: 0 }, { seat: 2 }, { seat: 4 }];
  assert.equal(waiterRules.highestWaiterAssignedSeat(lines), 4);
  assert.deepEqual(waiterRules.validateWaiterCovers(3, lines), { ok: false, error: 'seat_exceeds_covers' });
  assert.deepEqual(waiterRules.validateWaiterCovers(4, lines), { ok: true, covers: 4 });
  for (const value of [0, -1, 1.5, 100, Number.NaN]) {
    assert.deepEqual(waiterRules.validateWaiterCovers(value, []), { ok: false, error: 'covers_invalid' });
  }
  assert.equal(waiterRules.validateWaiterCovers(4, [{ seat: 2.5 }]).error, 'seat_exceeds_covers');
});

test('course staging separates saved kitchen items from unsaved local items', () => {
  const lines = [
    { course: 'entrees', courseStatus: 'hold', localSaved: true },
    { course: 'entrees', courseStatus: 'hold', localSaved: false },
    { course: 'entrees', courseStatus: 'fired', localSaved: false },
    { course: 'dessert', courseStatus: 'hold', localSaved: true },
  ];
  const split = waiterRules.splitWaiterCourseLines(lines, 'entrees');
  assert.equal(split.heldLines.length, 2);
  assert.equal(split.savedLines.length, 1);
  assert.equal(split.unsavedLines.length, 1);
  assert.equal(waiterRules.splitWaiterCourseLines(lines, 'unknown').heldLines.length, 0);
});

test('saved course firing adopts the verified server order state and locks an uncertain response', () => {
  const fireFlow = sourceBetween('async function fireCourse(course, button)', 'async function saveAndSendTerminalOrder');
  const adoptOrder = fireFlow.indexOf('wt.order = JSON.parse(JSON.stringify(responseOrder))');
  const updateLocalLines = fireFlow.indexOf('courseLines.forEach((line) => {');

  assert.match(fireFlow, /const result = await api\(`\/api\/waiter\/orders\/\$\{wt\.order\.id\}\/fire-course`/);
  assert.match(fireFlow, /result\?\.ok !== true[\s\S]*?Number\(responseOrder\?\.id\) !== Number\(wt\.order\.id\)[\s\S]*?responseCourse !== course[\s\S]*?!courseConfirmed/);
  assert.ok(adoptOrder >= 0 && updateLocalLines > adoptOrder,
    'adopt the same-order, same-course server response before marking local course lines fired');
  assert.match(fireFlow, /wt\.checkNo = wt\.order\.checkNo \|\| wt\.checkNo/);
  assert.match(fireFlow, /if \(err\.outcomeUnknown && savedLines\.length\)[\s\S]*?wt\.orderSaveNeedsRefresh = true[\s\S]*?persistWaiterTerminalDraft\(wt\)/);

  const patchStart = serverSource.indexOf("app.patch('/api/waiter/orders/:id/fire-course'");
  const routeEnd = serverSource.indexOf("app.post('/api/waiter/orders/:id/split'", patchStart);
  const route = serverSource.slice(patchStart, routeEnd);
  assert.ok(patchStart >= 0 && routeEnd > patchStart);
  assert.match(route, /res\.json\(\{ ok: true, idempotent: true, order: operationalOrderResponse\(order, req\.user\), firedCount: 0, course: courseValidation\.course \}\)/);
  assert.match(route, /res\.json\(\{ ok: true, order: operationalOrderResponse\(order, req\.user\), firedCount, course \}\)/);
  assert.match(route, /order\.status === 'pay_at_cashier'[\s\S]*?appendOrderStatus\(order, 'sent_to_kitchen'/);
});

test('draft recovery is scoped to branch/table and requires the same server order revision', () => {
  const order = { id: 44, updatedAt: 'rev-a', status: 'sent_to_kitchen', covers: 2, items: [{ menuItemId: 9, seat: 1, courseStatus: 'hold' }] };
  const context = { branchId: 7, tableId: '12', order };
  const baseDraft = { version: 1, branchId: 7, tableId: '12', lines: [] };
  assert.equal(waiterRules.waiterDraftCanRecover(baseDraft, { ...context, order: null }), true);
  assert.equal(waiterRules.waiterDraftCanRecover({ ...baseDraft, tableId: '13' }, context), false);
  const existingOrderDraft = { ...baseDraft, orderId: 44, baseOrderSignature: waiterRules.waiterOrderDraftSignature(order) };
  assert.equal(waiterRules.waiterDraftCanRecover(existingOrderDraft, context), true);
  assert.equal(waiterRules.waiterDraftCanRecover(existingOrderDraft, { ...context, order: { ...order, items: [{ ...order.items[0], courseStatus: 'fired' }] } }), false);
  assert.equal(waiterRules.waiterDraftCanRecover({ ...existingOrderDraft, baseOrderSignature: '' }, context), false);
});

test('uncertain waiter payment is treated as unsent work and only recovers for the same order and branch', () => {
  const order = { id: 44, total: 120000 };
  const intent = {
    orderId: 44,
    branchId: 7,
    tender: 'manual_card',
    paymentAmount: 120000,
    amountTendered: 120000,
    paymentReference: 'trace-123',
  };
  const pending = { intent, idempotencyKey: 'settle-12345678', baselinePaid: 0 };

  assert.equal(waiterRules.waiterTerminalHasUnsentWork({ lines: [], pendingPayment: pending }), true);
  assert.equal(waiterRules.waiterPendingPaymentCanRecover(pending, order, 7), true);
  assert.equal(waiterRules.waiterPendingPaymentCanRecover(pending, { id: 45 }, 7), false);
  assert.equal(waiterRules.waiterPendingPaymentCanRecover(pending, order, 8), false);
  assert.equal(waiterRules.waiterPendingPaymentCanRecover({ ...pending, idempotencyKey: '' }, order, 7), false);
  assert.equal(waiterRules.waiterPendingPaymentCanRecover({ ...pending, intent: { ...intent, amountTendered: 119999 } }, order, 7), false);
  assert.equal(waiterRules.waiterDraftHasRecordedPayment({ orderId: 44, pendingPayment: pending }, [{ id: 44, partialPayments: [{ idempotencyKey: 'settle-12345678' }] }]), true);
  assert.equal(waiterRules.waiterDraftHasRecordedPayment({ orderId: 44, pendingPayment: pending }, [{ id: 44, partialPayments: [{ idempotencyKey: 'another-key' }] }]), false);
});

test('unresolved payment locks order edits while the exact same-key retry remains available', () => {
  const pendingPayment = {
    intent: { orderId: 44, branchId: 7, tender: 'cash', paymentAmount: 120000, amountTendered: 120000 },
    idempotencyKey: 'settle-12345678',
    baselinePaid: 0,
  };

  assert.equal(waiterRules.waiterTerminalMutationLocked({ pendingPayment, paymentNeedsRefresh: true }), true);
  assert.equal(waiterRules.waiterTerminalMutationLocked({ paymentIntentConflict: true }), true);
  assert.equal(waiterRules.waiterTerminalMutationLocked({ pendingPayment, paymentNeedsRefresh: false }), true,
    'a pending intent protects the invoice after refresh; only its exact idempotent payment retry may proceed');

  const menu = sourceBetween('function paintTerminalMenu(container)', 'function paintTerminalCheck(container)');
  const check = sourceBetween('function paintTerminalCheck(container)', 'async function refreshWaiterPaymentState');
  const actions = sourceBetween('function paintTerminalActions(container)', 'async function submitWaiterSplit');
  const guest = sourceBetween('function paintTerminalGuest(container)', 'async function serveWaiterOrder');
  const sendFlow = sourceBetween('async function saveAndSendTerminalOrder(', 'function paintTerminalActions(container)');
  const payability = check.slice(check.indexOf('const canPay ='), check.indexOf('const sectionsHtml ='));
  assert.match(menu, /const orderSubmissionLocked = waiterTerminalMutationLocked\(wt\)/);
  assert.match(check, /const orderSubmissionLocked = waiterTerminalMutationLocked\(wt\)/);
  assert.match(actions, /const orderSubmissionLocked = waiterTerminalMutationLocked\(wt\)/);
  assert.match(guest, /const orderSubmissionLocked = waiterTerminalMutationLocked\(wt\)/);
  assert.match(sendFlow, /wt\.pendingPayment \|\| wt\.paymentNeedsRefresh \|\| wt\.paymentIntentConflict/);
  assert.match(payability, /pendingPaymentCanRetry/);
  assert.doesNotMatch(payability, /!orderSubmissionLocked/,
    'order edit locks must not suppress the exact safe retry of the saved payment intent');
});

test('uncertain waiter split is protected work and locks further order mutations', () => {
  const pendingSplit = {
    orderId: 44,
    branchId: 7,
    tableId: '12',
    payload: { mode: 'items', itemIndices: [1] },
    idempotencyKey: 'waiter-split-recovered-key',
    baseOrderSignature: 'before-split',
    startedAt: 1_800_000_000_000,
  };
  assert.equal(waiterRules.waiterTerminalHasUnsentWork({ lines: [], pendingSplit }), true);
  assert.equal(waiterRules.waiterTerminalMutationLocked({ pendingSplit }), true);
  assert.equal(waiterRules.waiterTerminalMutationLocked({ splitNeedsRefresh: true }), true);
  assert.equal(waiterRules.waiterTerminalMutationLocked({ pendingSplit: null, splitNeedsRefresh: false }), false);
});

test('waiter bill split persists its key before POST and sends that exact key', async () => {
  const harness = createWaiterSplitHarness(async () => {
    throw Object.assign(new Error('پاسخ نامشخص'), { outcomeUnknown: true });
  });

  const completed = await harness.submit({ mode: 'items', itemIndices: [1] }, () => 'split complete');

  assert.equal(completed, false);
  assert.equal(harness.events[0].type, 'persist');
  assert.equal(harness.events[1].type, 'post');
  const pendingSplit = harness.events[1].persistedPendingSplit;
  const key = pendingSplit.idempotencyKey;
  assert.match(key, /^waiter-split-[A-Za-z0-9-]{16,}$/);
  assert.equal(harness.events[1].headers['Idempotency-Key'], key);
  assert.equal(harness.wt.pendingSplit.idempotencyKey, key);
  assert.equal(harness.wt.splitNeedsRefresh, true);
});

test('unknown waiter split keeps changed and new split attempts locked without auto-retry', async () => {
  let apiCalls = 0;
  const harness = createWaiterSplitHarness(async () => {
    apiCalls += 1;
    throw Object.assign(new Error('پاسخ نامشخص'), { outcomeUnknown: true });
  });

  await harness.submit({ mode: 'items', itemIndices: [1] }, () => 'split complete');
  const pendingKey = harness.wt.pendingSplit.idempotencyKey;
  const changedSplit = await harness.submit({ mode: 'seat', seat: 2 }, () => 'split complete');

  assert.equal(changedSplit, false);
  assert.equal(apiCalls, 1, 'unknown outcome must not trigger an automatic or changed-payload replay');
  assert.equal(harness.events.filter((event) => event.type === 'post').length, 1);
  assert.deepEqual(harness.wt.pendingSplit.payload, { mode: 'items', itemIndices: [1] });
  assert.equal(harness.wt.pendingSplit.idempotencyKey, pendingKey);
  assert.equal(waiterRules.waiterTerminalMutationLocked(harness.wt), true);
});

test('uncertain new-order submission only recovers with its exact saved payload, table, branch, and key', () => {
  const pending = {
    idempotencyKey: 'waiter-12345678',
    payload: {
      branchId: 7,
      fulfillment: 'dine_in',
      tableNo: '12',
      covers: 2,
      sendToKitchen: true,
      items: [{ menuItemId: 9, qty: 2, seat: 1, modifiers: [], courseStatus: 'fired' }],
    },
  };
  assert.equal(waiterRules.waiterTerminalHasUnsentWork({ lines: [], pendingOrderSubmission: pending }), true);
  assert.equal(waiterRules.waiterOrderSubmissionCanRecover(pending, '12', 7), true);
  assert.equal(waiterRules.waiterOrderSubmissionCanRecover(pending, '13', 7), false);
  assert.equal(waiterRules.waiterOrderSubmissionCanRecover(pending, '12', 8), false);
  assert.equal(waiterRules.waiterOrderSubmissionCanRecover({ ...pending, idempotencyKey: '' }, '12', 7), false);
  assert.equal(waiterRules.waiterOrderSubmissionCanRecover({ ...pending, payload: { ...pending.payload, sendToKitchen: false } }, '12', 7), false);
  assert.equal(waiterRules.waiterOrderSubmissionCanRecover({ ...pending, payload: { ...pending.payload, items: [] } }, '12', 7), false);
  assert.equal(waiterRules.waiterOrderSubmissionCanRecover({ ...pending, payload: { ...pending.payload, items: [{ ...pending.payload.items[0], seat: 3 }] } }, '12', 7), false);
});

test('pending payment intent and its idempotency key survive draft persistence without offering discard', () => {
  assert.match(source, /pendingPayment: wt\.pendingPayment \? \{/);
  assert.match(source, /paymentIntentConflict: Boolean\(wt\.paymentIntentConflict\)/);
  assert.match(source, /wt\.paymentNeedsRefresh = Boolean\(wt\.pendingPayment\)/);
  assert.match(source, /waiterDraftHasRecordedPayment\(savedDraft, state\.data\.orders\)/);
  assert.match(source, /draft\.pendingPayment \|\| hasProtectedOrderSubmission\s*\?\s*`<button type="button" class="role-secondary" id="wt-draft-close-protected">/);
  assert.match(source, /\$\{hasPendingPayment \? 'حفظ درخواست دریافت و بازگشت به سالن' : hasPendingSplit \? 'حفظ وضعیت تفکیک و بازگشت به سالن' : hasPendingOrderSubmission \? 'حفظ وضعیت سفارش و بازگشت به سالن'/);
  assert.match(source, /\$\{hasProtectedIntent \? '' : '<button type="button" class="role-danger" id="wt-draft-discard-return">/);
});

test('waiter draft has explicit recover/discard paths and is removed after successful send', () => {
  assert.match(source, /storage\.setItem\(key, JSON\.stringify\(payload\)\)/);
  assert.match(source, /id="wt-draft-resume"/);
  assert.match(source, /id="wt-draft-discard-return"/);
  assert.match(source, /clearWaiterTerminalDraft\(wt\.table\.id\)/);
  assert.match(source, /persistWaiterTerminalDraft\(wt\);/);
  const createStart = source.indexOf("api('/api/staff/orders'", source.indexOf('async function saveAndSendTerminalOrder'));
  const idempotencySave = source.lastIndexOf('persistWaiterTerminalDraft(wt);', createStart);
  assert.ok(createStart > -1 && idempotencySave > -1 && idempotencySave < createStart,
    'persist the idempotency key before the new-order request can complete ambiguously');
});

test('new-order replay freezes and persists the exact payload before POST and reuses its original key', () => {
  const saveFlow = sourceBetween('async function saveAndSendTerminalOrder', 'function paintTerminalActions');
  const persistFlow = sourceBetween('function persistWaiterTerminalDraft(wt)', 'function clearWaiterTerminalDraft');
  const postStart = saveFlow.indexOf("api('/api/staff/orders'");
  assert.ok(postStart > -1);
  assert.match(persistFlow, /storage\.setItem\(key, JSON\.stringify\(payload\)\);\s*return true/);
  assert.match(persistFlow, /\/\/ Callers that are about to mutate the server must treat a failed save as a hard stop\.\s*return false;/);
  assert.ok(saveFlow.indexOf('wt.pendingOrderSubmission = { idempotencyKey, payload: JSON.parse(JSON.stringify(payload)) }') < postStart);
  assert.ok(saveFlow.lastIndexOf('persistWaiterTerminalDraft(wt);', postStart) < postStart);
  assert.match(saveFlow, /if \(!persistWaiterTerminalDraft\(wt\)\)[\s\S]*?هنوز چیزی به سرور ارسال نشده است/);
  assert.match(saveFlow, /headers: \{ 'Idempotency-Key': pending\.idempotencyKey \}/);
  assert.match(saveFlow, /body: JSON\.stringify\(pending\.payload\)/);
  assert.match(saveFlow, /wt\.pendingOrderSubmission = null;[\s\S]*?wt\.idempotencyKey = null/);
});

test('ambiguous existing-order PATCH is never blindly replayed and remains locked for reconciliation', () => {
  const saveFlow = sourceBetween('async function saveAndSendTerminalOrder', 'function paintTerminalActions');
  const patchStart = saveFlow.indexOf('api(`/api/waiter/orders/${wt.order.id}`');
  assert.ok(patchStart > -1);
  assert.ok(saveFlow.lastIndexOf('persistWaiterTerminalDraft(wt);', patchStart) < patchStart,
    'persist a protected draft before the non-idempotent order update can become ambiguous');
  assert.equal((saveFlow.match(/api\(`\/api\/waiter\/orders\/\$\{wt\.order\.id\}`/g) || []).length, 1);
  assert.match(saveFlow, /The edit route has no idempotency contract\. Never replay an uncertain kitchen update blindly\./);
  assert.match(saveFlow, /wt\.orderSaveNeedsRefresh = true;\s*wt\.orderSubmissionConflict = true/);
  assert.match(saveFlow, /idempotency_key_conflict', 'idempotency_replay_unavailable'/);
  const recoveryFlow = sourceBetween('function refreshWaiterViewAfterSync()', 'function startStream()');
  assert.match(recoveryFlow, /const clearedUncertainEdit = Boolean\(wt\.orderSaveNeedsRefresh && !wt\.pendingOrderSubmission\)/);
  assert.match(recoveryFlow, /Keep the reconciliation lock and only clear the "needs refresh" indicator/);
});

test('walk-in retry reuses one request key for an unchanged payload', () => {
  const dialog = sourceBetween('  async function openWaitlistDialog()', '  function openWaitlistSeatDialog(');
  assert.match(dialog, /let retryFingerprint = ''/);
  assert.match(dialog, /if \(fingerprint !== retryFingerprint\)[\s\S]*?retryIdempotencyKey = `waitlist-\$\{state\.branchId\}/);
  assert.match(dialog, /'Idempotency-Key': retryIdempotencyKey/);
  assert.match(dialog, /JSON\.stringify\(payload\)/);
});

test('waitlist seating validates before mutation, serializes per branch, and waits for durable persistence', () => {
  const postStart = serverSource.indexOf("app.post('/api/waiter/waitlist'");
  const patchStart = serverSource.indexOf("app.patch('/api/waiter/waitlist/:id'");
  const nextRoute = serverSource.indexOf("app.patch('/api/waiter/orders/:id/fire-course'", patchStart);
  assert.ok(postStart >= 0 && patchStart > postStart && nextRoute > patchStart);
  const postRoute = serverSource.slice(postStart, patchStart);
  const patchRoute = serverSource.slice(patchStart, nextRoute);
  assert.match(postRoute, /serializeWaitlistMutation\(branchId/);
  assert.match(postRoute, /await save\(\{ requireDurable: true \}\)/);
  assert.ok(postRoute.indexOf('await save({ requireDurable: true })') < postRoute.indexOf("publishOperationalEvent('waitlist.created'"));
  assert.match(patchRoute, /waitlist\.prepareWaitlistUpdate\(/);
  assert.match(patchRoute, /serializeWaitlistMutation\(entry\.branchId/);
  assert.match(patchRoute, /activeDineInOrderOnTable\(order, table\.id, candidate\.branchId\)/);
  assert.match(patchRoute, /waitlist\.reservationBlocksTable\(/);
  assert.match(patchRoute, /db\.reservationSettings\?\.slotMinutes/);
  assert.match(patchRoute, /await save\(\{ requireDurable: true \}\)/);
  assert.ok(patchRoute.indexOf('await save({ requireDurable: true })') < patchRoute.indexOf("publishOperationalEvent('waitlist.updated'"));
});

test('waiter mobile course and item controls retain readable text and touch targets', () => {
  assert.match(styles, /\.wt-course-picker__timing button \{[^}]*min-height:\s*52px[^}]*font-size:\s*14px/s);
  assert.match(styles, /\.wt-item-dialog #drawer-add-to-check \{[^}]*min-height:\s*52px[^}]*font-size:\s*15px/s);
  assert.match(styles, /\.wt-item-dialog \.wt-seat-chip \{[^}]*min-height:\s*48px[^}]*font-size:\s*14px/s);
  assert.match(styles, /\.wt-item-card \.wt-item-row__add-btn \{[^}]*width:\s*48px[^}]*height:\s*48px/s);
  assert.match(styles, /\.wt-draft-recovery__actions > button \{[^}]*min-height:\s*48px[^}]*font-size:\s*14px/s);
  assert.match(mobileFlowStyles, /body\.is-waiter-floor-app\.is-waiter-terminal\s+\.wt-menu-screen\s+\.wt-menu-stage\s+\.wt-item-card__info strong\s*\{[^}]*font-size:\s*16px/s);
  assert.match(mobileFlowStyles, /\.wt-menu-stage \.wt-item-card \.wt-item-row__add-btn \{[^}]*width:\s*48px[^}]*height:\s*48px/s);
  assert.match(mobileFlowStyles, /body\.is-waiter-floor-app\.is-waiter-terminal\s+\.wt-fire-btn\s*\{[^}]*min-height:\s*48px/s);
  assert.match(html, /waiter-floor-plan\.css\?v=waiter-mobile-cards-v18-payment-stage/, 'mobile cascade changes must invalidate the cached stylesheet');
});

test('waiter live refresh keeps the open ticket and protects local edits from remote overwrite', () => {
  const syncFlow = sourceBetween('function refreshWaiterViewAfterSync()', 'function startStream()');
  assert.match(syncFlow, /const wt = state\.waiterTerminal/);
  assert.match(syncFlow, /waiterOrderDraftSignature\(latest\)/);
  assert.match(syncFlow, /waiterTerminalHasUnsentWork\(wt\)/);
  assert.match(syncFlow, /wt\.remoteUpdatePending = true/);
  assert.match(syncFlow, /applyLatestWaiterOrder\(wt, latest\)/);
  assert.match(syncFlow, /if \(state\.activeView === 'floor'\) waiterFloor\(\)/);
  assert.match(source, /wt-flow__conflict/);
  assert.match(source, /بارگذاری نسخهٔ تازه و جایگزینی پیش‌نویس/);
});

test('unknown waiter delivery result cannot be abandoned before the server status is refreshed', () => {
  const start = source.indexOf("getElementById('wt-back-floor')");
  const end = source.indexOf("main.querySelectorAll('[data-wt-tab]')", start);
  assert.ok(start >= 0 && end > start, 'waiter terminal back handler exists');
  const backHandler = source.slice(start, end);
  const guard = backHandler.indexOf('if (wt.serveNeedsRefresh)');
  const closeCheck = backHandler.indexOf('if (!waiterTerminalHasUnsentWork(wt))');
  assert.ok(guard >= 0 && guard < closeCheck, 'unknown delivery outcome is checked before closing the terminal');
  assert.match(backHandler, /نتیجهٔ تحویل هنوز روشن نیست[\s\S]*?ابتدا وضعیت سفارش را از مرحله‌ها تازه کنید/);
});

test('waiter order section navigation exposes its current page to assistive technology', () => {
  assert.match(source, /data-wt-tab="menu"[^>]*aria-current="page"/);
  assert.match(source, /data-wt-tab="check"[^>]*aria-current="page"/);
  assert.match(source, /class="wt-tabs" aria-label="بخش‌های سفارش"/);
});

test('waiter payment errors preserve the exact request and block retry until payment state is refreshed', () => {
  const paymentFlow = sourceBetween('const completePayment = async (method', 'const renderPaymentChoices =');
  const catchStart = paymentFlow.lastIndexOf('} catch (error) {');
  assert.notEqual(catchStart, -1);
  const catchBlock = paymentFlow.slice(catchStart);
  assert.match(catchBlock, /wt\.pendingPayment \|\|= \{ intent, idempotencyKey, baselinePaid: amountPaid \}/);
  assert.match(catchBlock, /wt\.paymentNeedsRefresh = true/);
  assert.match(catchBlock, /dialog\.close\(\);\s*renderWaiterTerminal\(\)/);
  assert.doesNotMatch(catchBlock, /clearSettlementIdempotencyKey|wt\.pendingPayment = null/);
  assert.match(paymentFlow, /headers: \{ 'Idempotency-Key': idempotencyKey \}/);
  assert.match(paymentFlow, /String\(result\.payment\.idempotencyKey \|\| ''\) === String\(idempotencyKey\)/);
});

test('changed balance after an unresolved collection blocks replay and routes the invoice to cashier review', () => {
  const refreshFlow = sourceBetween('async function refreshWaiterPaymentState', 'async function fireCourse');
  assert.match(refreshFlow, /Number\(wt\.pendingPayment\.intent\?\.paymentAmount\) !== Number\(workflow\.amounts\.due\)/);
  assert.match(refreshFlow, /String\(payment\?\.idempotencyKey \|\| ''\) === String\(pending\.idempotencyKey \|\| ''\)/);
  assert.match(refreshFlow, /if \(!matchingReceipt\)/);
  assert.match(refreshFlow, /wt\.paymentIntentConflict = true/);
  const checkFlow = sourceBetween('function paintTerminalCheck(container)', 'function paintTerminalActions(container)');
  assert.match(checkFlow, /&& !paymentIntentConflict/);
  assert.match(checkFlow, /paymentIntentConflict[\s\S]*?صندوق باید مبلغ را تطبیق دهد/);
  const payFlow = sourceBetween('function payWaiterCheck()', 'function waiterCalls()');
  assert.match(payFlow, /if \(wt\?\.paymentIntentConflict\)/);
});

test('payment choices and cash confirmation expose useful labels and announce validation state', () => {
  const payFlow = sourceBetween('function payWaiterCheck()', 'function waiterCalls()');
  assert.match(payFlow, /role="region" aria-label="ثبت دریافت وجه"/);
  assert.match(payFlow, /aria-label="کد پیگیری روی رسید کارت‌خوان، الزامی"/);
  assert.match(payFlow, /aria-required="true" required/);
  assert.match(payFlow, /retrying && !String\(retryIntent\?\.paymentReference \|\| ''\)\.trim\(\)[\s\S]*?دریافت تازه انجام ندهید/);
  assert.match(payFlow, /id="wt-payment-amount"/);
  assert.match(payFlow, /updateCardReferenceValidity = \(\) => \{[\s\S]*?confirmButton\.disabled = readPaymentAmount\(\) === null \|\| !String\(cardReferenceInput\.value \|\| ''\)\.trim\(\)/);
  assert.match(payFlow, /aria-describedby="wt-payment-change"/);
  assert.match(payFlow, /aria-live="polite"/);
  assert.match(payFlow, /cashInput\.setAttribute\('aria-invalid', String\(!validTender\)\)/);
  assert.match(payFlow, /confirmButton\.disabled = !validTender/);
});

test('serving a ready ticket trusts the mutation response if snapshot refresh fails and locks an unknown outcome', () => {
  const serveFlow = sourceBetween('async function serveWaiterOrder(button)', 'function payWaiterCheck()');
  assert.match(serveFlow, /method: 'PATCH',[\s\S]*?body: JSON\.stringify\(\{ status: 'done' \}\)/);
  assert.ok(serveFlow.indexOf('if (responseOrder) wt.order = responseOrder') < serveFlow.indexOf('await fetchWaiter()'),
    'retain the server mutation response before attempting a secondary snapshot refresh');
  assert.match(serveFlow, /catch \(error\) \{\s*if \(error\.outcomeUnknown\)/);
  assert.match(serveFlow, /wt\.serveNeedsRefresh = true/);
  const checkFlow = sourceBetween('function paintTerminalCheck(container)', 'function paintTerminalActions(container)');
  assert.match(checkFlow, /!wt\.serveNeedsRefresh/);
  assert.match(checkFlow, /نتیجهٔ ثبت تحویل روشن نیست/);
});

test('server payment-guard messages stay clear and Persian for staff using waiter/cashier screens', () => {
  assert.match(source, /cash_collection_forbidden:\s*'دریافت وجه نقد فقط برای کاربر دارای دسترسی صندوق مجاز است\.'/);
  assert.match(source, /payment_amount_invalid:\s*'مبلغ پرداخت باید عدد صحیح و بزرگ‌تر از صفر باشد\.'/);
  assert.match(source, /payment_amount_exceeds_due:\s*'مبلغ واردشده از ماندهٔ فعلی بیشتر است؛ فاکتور را تازه کنید\.'/);
});

test('cashier and waiter use explicit server modifier definitions and preserve group identity', () => {
  assert.match(source, /return Array\.isArray\(item\?\.modifierGroups\) \? item\.modifierGroups : \[\]/);
  assert.doesNotMatch(source, /POS_MODIFIERS|legacy-option-/);
  assert.match(source, /return option \? \{ \.\.\.option, groupId: group\.id, groupTitle: group\.title \} : null/);
  assert.match(source, /validateMenuModifierChoices\(modifierGroups, modifiers\)/);
  assert.match(source, /selectedMods\.has\(`\$\{group\.id\}:\$\{option\.id\}`\)/);
});

test('waiter payment intent is saved before settlement request and storage failure sends nothing', () => {
  const paymentFlow = sourceBetween('const completePayment = async (method', 'const renderPaymentChoices =');
  const createPendingIndex = paymentFlow.indexOf('wt.pendingPayment ||= { intent, idempotencyKey, baselinePaid: amountPaid }');
  const persistIndex = paymentFlow.indexOf('if (!persistWaiterTerminalDraft(wt))');
  const requestIndex = paymentFlow.indexOf('api(`/api/staff/orders/${wt.order.id}/settle`');
  assert.ok(createPendingIndex >= 0 && createPendingIndex < persistIndex && persistIndex < requestIndex,
    'persist the payment intent and idempotency key before the server can record a receipt');
  assert.match(paymentFlow, /notSent: true/);
  const catchBlock = paymentFlow.slice(paymentFlow.indexOf('} catch (error) {'));
  assert.match(catchBlock, /if \(error\.notSent\)[\s\S]*?setBusy\(confirmButton, false\)[\s\S]*?return false/);
  assert.match(catchBlock, /wt\.paymentNeedsRefresh = true/);
});

test('new waiter items default to whole-table context instead of silently assigning seat one', () => {
  const customization = sourceBetween('function openItemCustomization(item)', 'function paintTerminalCheck(container)');
  assert.match(customization, /let selectedSeat = 0/);
  assert.match(customization, /data-seat="0"[^>]*>کل میز/);
});

test('unavailable menu items are announced as unavailable, not as addable', () => {
  const menu = sourceBetween('function paintTerminalMenu(container)', 'function openItemCustomization(item)');
  assert.match(menu, /const actionLabel = orderSubmissionLocked[\s\S]*?outOfStock[\s\S]*?\$\{item\.name\} ناموجود است/);
  assert.match(menu, /aria-label="\$\{esc\(actionLabel\)\}"/);
});

test('guest details are labeled as a draft and locked once the order is not editable', () => {
  const guest = sourceBetween('function paintTerminalGuest(container)', 'async function serveWaiterOrder(button)');
  assert.match(guest, /const orderEditLocked = Boolean\(wt\.order\?\.id && !orderCanEdit\(wt\.order\)\)/);
  assert.match(guest, /ذخیره و ارسال سفارش ثبت می‌شود/);
  assert.match(guest, /اعمال اطلاعات در پیش‌نویس فاکتور/);
  assert.match(guest, /ویرایش اطلاعات در این مرحله بسته است/);
});

test('waiter branch cannot change underneath an open table ticket', () => {
  const branchSwitch = sourceBetween('function setActiveBranch(value)', 'function clearRoleHeaderContext()');
  const guard = branchSwitch.indexOf('if (state.waiterTerminal)');
  const mutation = branchSwitch.indexOf('state.branchId = nextBranchId');
  assert.ok(guard >= 0 && mutation > guard, 'the open-terminal guard runs before changing branch context');
  const guardBlock = branchSwitch.slice(guard, mutation);
  assert.match(guardBlock, /waiterTerminalHasUnsentWork\(state\.waiterTerminal\)/);
  assert.match(guardBlock, /role-branch-select[\s\S]*?value = String\(state\.branchId\)/);
  assert.match(guardBlock, /role-user-branch-select[\s\S]*?value = String\(state\.branchId\)/);
  assert.match(guardBlock, /شعبه تغییر نکرد/);
  assert.match(guardBlock, /return;/);
});

test('waiter terminal rejects a branch change during menu loading and ignores the stale menu response', () => {
  const opening = sourceBetween('async function openWaiterTerminal(tableId, options = {})', 'function renderWaiterTerminal()');
  const capture = opening.indexOf('const openingBranchId = state.branchId');
  const load = opening.indexOf('await loadMenu()');
  const guard = opening.indexOf("String(state.branchId ?? '') !== String(openingBranchId ?? '')");
  const tableRead = opening.indexOf('const tables = state.data.floor?.tables || []');
  assert.ok(capture >= 0 && load > capture && guard > load && tableRead > guard,
    'branch context is captured before loading and validated before reading a table');
  assert.match(opening.slice(guard, tableRead), /شعبه هنگام بارگذاری تغییر کرد/);

  const loadMenu = sourceBetween('async function loadMenu(force = false)', 'async function showOrderComposer');
  const requestedBranch = loadMenu.indexOf('const requestedBranchId = state.branchId');
  const request = loadMenu.indexOf('await api(`/api/staff/menu?lang=fa${branchParam}`)');
  const staleGuard = loadMenu.indexOf("String(state.branchId ?? '') !== String(requestedBranchId ?? '')");
  const adopt = loadMenu.indexOf('state.menuItems = data.menuItems || data.items || []');
  assert.ok(requestedBranch >= 0 && request > requestedBranch && staleGuard > request && adopt > staleGuard,
    'a response fetched for a previous branch cannot overwrite the current menu snapshot');
});

test('a stale explicitly selected waiter check cannot fall through into new-order creation', () => {
  const opening = sourceBetween('async function openWaiterTerminal(tableId, options = {})', 'function renderWaiterTerminal()');
  const select = opening.indexOf('const existingOrder = options.selectedOrderId');
  const staleGuard = opening.indexOf('if (options.selectedOrderId && !existingOrder)', select);
  const newCheckFlow = opening.indexOf("if (!existingOrder && typeof options.covers === 'undefined' && !options.forceNew)", select);
  assert.ok(select >= 0 && staleGuard > select && newCheckFlow > staleGuard,
    'the stale-selection guard runs before the new-check and cover-selection paths');
  assert.match(opening.slice(staleGuard, newCheckFlow), /فاکتور تازه باز نشد/);
  assert.match(opening.slice(staleGuard, newCheckFlow), /return;/);
});

test('waiter cannot leave the terminal with an unsent draft when session storage fails', () => {
  const terminal = sourceBetween('function renderWaiterTerminal()', 'function paintTerminalMenu(container)');
  assert.match(terminal, /const waiterDraftPersisted = persistWaiterTerminalDraft\(wt\)/);
  assert.match(terminal, /wt\.draftStorageUnavailable = Boolean\(waiterTerminalHasUnsentWork\(wt\) && !waiterDraftPersisted\)/);
  assert.match(terminal, /پیش‌نویس این سفارش در حافظهٔ نشست ذخیره نشد/);

  const start = terminal.indexOf("dialogBody.querySelector('#wt-draft-save-return')");
  const end = terminal.indexOf("dialogBody.querySelector('#wt-draft-discard-return')", start);
  assert.ok(start >= 0 && end > start, 'keep-and-return handler exists');
  const saveReturn = terminal.slice(start, end);
  const persist = saveReturn.indexOf('if (!persistWaiterTerminalDraft(wt))');
  const failureReturn = saveReturn.indexOf('return;', persist);
  const close = saveReturn.indexOf('dialog.close()', persist);
  const leave = saveReturn.indexOf('state.waiterTerminal = null', persist);

  assert.ok(persist >= 0 && failureReturn > persist && close > failureReturn && leave > close,
    'a failed persistence attempt exits the failure branch before any close or navigation');
  assert.match(saveReturn.slice(persist, failureReturn), /status\.setAttribute\('role', 'alert'\)/);
  assert.match(saveReturn.slice(persist, failureReturn), /status\.textContent = 'ذخیرهٔ پیش‌نویس در این نشست انجام نشد/);
  assert.match(saveReturn.slice(persist, failureReturn), /showToast\('پیش‌نویس ذخیره نشد[\s\S]*?'error'\)/);
  assert.match(saveReturn, /showToast\('پیش‌نویس در همین نشست مرورگر نگه داشته شد\.'\)/);
});
