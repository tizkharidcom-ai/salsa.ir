'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('./helpers/source-fs');
const path = require('node:path');
const vm = require('node:vm');
const { prepareKitchenQueue, transitionKitchenTicket } = require('../server/kitchen-queue');
const { isKitchenOrderPaymentEligible, validateWaiterOrderEdit } = require('../server/waiter-order-invariants');

const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server', 'server.js'), 'utf8');
const adminSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'admin.js'), 'utf8');
const rolePanelSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'role-panel.js'), 'utf8');
const kitchenCss = fs.readFileSync(path.join(__dirname, '../css/kitchen-kds.css'), 'utf8');
const appliedHelperSource = adminSource.match(/function adminKitchenActionApplied\(ticket, payload\) \{[\s\S]*?\n  \}/)?.[0];
assert.ok(appliedHelperSource, 'admin KDS should reconcile uncertain mutation responses from a fresh ticket snapshot');
const adminKitchenActionApplied = vm.runInNewContext(`(${appliedHelperSource})`, {
  adminKdsIsHeldLine: (item) => String(item?.courseStatus || '').trim().toLowerCase() === 'hold',
});
const paymentGuardSource = adminSource.match(/function adminKitchenPaymentGuard\(ticket\) \{[\s\S]*?\n  \}/)?.[0];
assert.ok(paymentGuardSource, 'admin KDS must keep inspection-only legacy tickets non-actionable');
const adminKitchenPaymentGuard = vm.runInNewContext(`(${paymentGuardSource})`);
const actionPayloadSource = adminSource.match(/function adminKitchenActionPayload\(dataset = \{\}\) \{[\s\S]*?\n  \}/)?.[0];
assert.ok(actionPayloadSource, 'admin KDS actions need a narrow, explicit payload allowlist');
const adminKitchenActionPayload = vm.runInNewContext(`(${actionPayloadSource})`);

function cssRules(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [...kitchenCss.matchAll(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 'g'))]
    .map((match) => match[1]);
}

test('KDS accepts only start, preparation, ready, and recall transitions allowed by the current state', () => {
  const original = { id: 14, status: 'sent_to_kitchen', column: 'new' };

  const started = transitionKitchenTicket(original, 'start_ticket');
  assert.equal(started.ok, true);
  assert.equal(started.idempotent, false);
  assert.deepEqual(started.ticket, { id: 14, status: 'preparing', column: 'preparing' });
  assert.deepEqual(original, { id: 14, status: 'sent_to_kitchen', column: 'new' }, 'transition must not mutate its input');

  const ready = transitionKitchenTicket(started.ticket, 'complete_ticket');
  assert.equal(ready.ok, true);
  assert.equal(ready.ticket.status, 'ready');
  assert.equal(ready.ticket.column, 'ready');

  const recalled = transitionKitchenTicket(ready.ticket, 'recall_ticket');
  assert.equal(recalled.ok, true);
  assert.equal(recalled.ticket.column, 'preparing');
});

test('KDS read and mutation endpoints keep kitchen capability and branch boundaries server-side', () => {
  assert.match(serverSource, /app\.get\('\/api\/kitchen\/orders',\s*requireKitchen/);
  assert.match(serverSource, /app\.patch\('\/api\/kitchen\/orders\/:id',\s*requireCapability\('kitchen\.manage'\)/);
  assert.match(serverSource, /function requireKitchen\(req, res, next\)[\s\S]{0,100}requireCapability\('kitchen\.view'\)/);

  const branchResolverStart = serverSource.indexOf('function requestedKdsBranch(req) {');
  const branchResolverEnd = serverSource.indexOf('\n}', branchResolverStart);
  const getRouteStart = serverSource.indexOf("app.get('/api/kitchen/orders'");
  const getRouteEnd = serverSource.indexOf("app.patch('/api/kitchen/orders/:id'", getRouteStart);
  const patchRouteStart = getRouteEnd;
  const patchRouteEnd = serverSource.indexOf("app.patch('/api/kitchen/items/:id/availability'", patchRouteStart);
  assert.ok(branchResolverStart >= 0 && branchResolverEnd > branchResolverStart);
  assert.ok(getRouteEnd > getRouteStart && patchRouteEnd > patchRouteStart);

  const branchResolver = serverSource.slice(branchResolverStart, branchResolverEnd);
  const getRoute = serverSource.slice(getRouteStart, getRouteEnd);
  const patchRoute = serverSource.slice(patchRouteStart, patchRouteEnd);
  assert.match(branchResolver, /branchScopeForUser\(req\.user/);
  assert.match(branchResolver, /allowedBranchIds\.includes\(Number\(branch\.id\)\)/);
  assert.match(getRoute, /Number\(order\.branchId\) === Number\(bid\)/);
  assert.match(getRoute, /\.filter\(\(o\) => active\.includes\(o\.status\) && queuePaymentEligible\(o\)\)/);
  assert.match(getRoute, /return isKdsPaymentEligible\(order\)/);
  assert.match(getRoute, /paymentReview: summarizeKdsPaymentReview\(branchOrders, bid\)/,
    'legacy or unresolved payment rows are represented only by aggregate review counts');
  assert.match(getRoute, /prepareKitchenQueue\(\[\.\.\.activeTickets, \.\.\.acceptanceReviewTickets, \.\.\.cancelledTicketsForQueue\], \{ branchId: bid \}\)/);
  assert.match(patchRoute, /Number\(o\.branchId\) === Number\(branchId\)/);
  assert.match(patchRoute, /isKitchenOrderPaymentEligible\(order, paymentStatusFor\(order\)\)/);
  assert.match(patchRoute, /!\['sent_to_kitchen', 'paid', 'preparing', 'ready'\]\.includes\(String\(order\.status \|\| ''\)\)/);
  assert.doesNotMatch(patchRoute, /cancel_ticket|edit_ticket|delete_ticket/);
});

test('KDS explains aggregate payment holds and disables start when every course is held', () => {
  const ticketMarkupStart = rolePanelSource.indexOf('function kdsTicketMarkup(ticket, shortcut) {');
  const ticketMarkupEnd = rolePanelSource.indexOf('\n  function kdsUndoMarkup()', ticketMarkupStart);
  const boardStart = rolePanelSource.indexOf('function kitchenBoard(readyOnly = false) {');
  const boardEnd = rolePanelSource.indexOf('\n  function startKdsClock()', boardStart);
  assert.ok(ticketMarkupStart >= 0 && ticketMarkupEnd > ticketMarkupStart);
  assert.ok(boardStart >= 0 && boardEnd > boardStart);
  const ticketMarkup = rolePanelSource.slice(ticketMarkupStart, ticketMarkupEnd);
  const boardMarkup = rolePanelSource.slice(boardStart, boardEnd);

  assert.match(ticketMarkup, /actionBlocked \|\| visibleItems\.length === 0/,
    'a ticket with no fired courses must not offer an action the API will reject');
  assert.match(ticketMarkup, /منتظر اعلام سالن/);
  assert.match(boardMarkup, /data\.paymentReview\?\.blockedCount/);
  assert.match(boardMarkup, /تطبیق پرداخت:.*صندوق/);
  assert.match(boardMarkup, /aria-label="\$\{esc\(queueSummaryLabel\)\}"/,
    'the short visual warning keeps an explanatory accessible label');
});

test('invalid and out-of-order KDS transitions are rejected with the actions valid for that state', () => {
  const cannotCompleteNew = transitionKitchenTicket({ id: 1, column: 'new' }, 'complete_ticket');
  assert.deepEqual(cannotCompleteNew, {
    ok: false,
    error: 'kitchen_transition_invalid',
    current: 'new',
    action: 'complete_ticket',
    allowed: ['start_ticket'],
  });

  assert.equal(transitionKitchenTicket({ id: 1, column: 'ready' }, 'start_ticket').error, 'kitchen_transition_invalid');
  assert.equal(transitionKitchenTicket({ id: 1, column: 'preparing' }, 'made_up_action').error, 'kitchen_action_invalid');
  assert.equal(transitionKitchenTicket({ id: 1, column: 'unknown' }, 'start_ticket').error, 'kitchen_state_invalid');
});

test('canonical order status wins over a stale display column and unknown persisted states fail closed', () => {
  const cancelled = { id: 9, status: 'cancelled', column: 'preparing' };
  const ready = { id: 10, status: 'ready', paymentStatus: 'unpaid', column: 'new' };
  const preparing = { id: 11, status: 'preparing', paymentStatus: 'partial', column: 'ready' };
  const unknown = { id: 12, status: 'pay_at_cashier', column: 'new' };
  const unreconciled = { id: 13, status: 'sent_to_kitchen', column: 'new' };

  const queue = prepareKitchenQueue([cancelled, ready, preparing, unknown, unreconciled]);
  assert.deepEqual(queue.tickets.map((ticket) => ticket.id), [10, 11, 13]);
  assert.deepEqual(queue.cancelledTickets.map((ticket) => ticket.id), [9]);
  assert.equal(transitionKitchenTicket(cancelled, 'start_ticket').error, 'kitchen_transition_invalid');
  assert.equal(transitionKitchenTicket(ready, 'start_ticket').error, 'kitchen_transition_invalid');
  assert.equal(transitionKitchenTicket(preparing, 'complete_ticket').ticket.column, 'ready');
  assert.equal(transitionKitchenTicket(unknown, 'start_ticket').error, 'kitchen_state_invalid');
  assert.equal(transitionKitchenTicket(unreconciled, 'start_ticket').ok, true,
    'queue visibility may retain legacy tickets for inspection; the mutation route must reconcile payment');
});

test('repeated start, ready, and recall requests are idempotent when applied to the latest ticket state', () => {
  const started = transitionKitchenTicket({ id: 3, status: 'sent_to_kitchen', column: 'new' }, 'start_ticket').ticket;
  const repeatedStart = transitionKitchenTicket(started, 'start_ticket');
  assert.equal(repeatedStart.ok, true);
  assert.equal(repeatedStart.idempotent, true);
  assert.equal(repeatedStart.ticket, started);

  const ready = transitionKitchenTicket(started, 'complete_ticket').ticket;
  const repeatedReady = transitionKitchenTicket(ready, 'complete_ticket');
  assert.equal(repeatedReady.ok, true);
  assert.equal(repeatedReady.idempotent, true);
  assert.equal(repeatedReady.ticket, ready);

  const recalled = transitionKitchenTicket(ready, 'recall_ticket').ticket;
  const repeatedRecall = transitionKitchenTicket(recalled, 'recall_ticket');
  assert.equal(repeatedRecall.ok, true);
  assert.equal(repeatedRecall.idempotent, true);
  assert.equal(repeatedRecall.ticket, recalled);
});

test('admin KDS recognizes only authoritative, action-specific outcomes after an uncertain response', () => {
  const preparing = { id: 8, column: 'preparing', items: [{ key: '0:1', completedAt: '2026-09-24T09:00:00.000Z' }] };
  const ready = { ...preparing, column: 'ready' };
  const held = { id: 9, column: 'preparing', heldCourseItems: [{ key: '1:2', courseStatus: 'hold', completedAt: '2026-09-24T09:00:00.000Z' }] };

  assert.equal(adminKitchenActionApplied(preparing, { action: 'start_ticket' }), true);
  assert.equal(adminKitchenActionApplied(ready, { action: 'start_ticket' }), true,
    'later valid progress still proves that start was applied');
  assert.equal(adminKitchenActionApplied(ready, { action: 'complete_ticket' }), true);
  assert.equal(adminKitchenActionApplied(preparing, { action: 'complete_ticket' }), false);
  assert.equal(adminKitchenActionApplied(preparing, { action: 'complete_item', lineKey: '0:1' }), true);
  assert.equal(adminKitchenActionApplied(preparing, { action: 'undo_item', lineKey: '0:1' }), false);
  assert.equal(adminKitchenActionApplied(ready, { action: 'undo_item', lineKey: '0:1' }), false,
    'ready cannot confirm a recall of an individual item');
  assert.equal(adminKitchenActionApplied(held, { action: 'complete_item', lineKey: '1:2' }), false,
    'a held course is never mistaken for a completed kitchen action');
  assert.equal(adminKitchenActionApplied(null, { action: 'start_ticket' }), false);
});

test('admin KDS blocks inspection-only or inconsistent payment snapshots before sending mutations', () => {
  const legacyGuard = adminKitchenPaymentGuard({ status: 'sent_to_kitchen' });
  assert.equal(legacyGuard.eligible, false);
  assert.equal(legacyGuard.message, 'وضعیت پرداخت ثبت یا تطبیق نشده است؛ این سفارش فقط برای بررسی نمایش داده می‌شود.');
  assert.equal(adminKitchenPaymentGuard({ status: 'preparing', paymentStatus: 'unknown' }).eligible, false);
  assert.equal(adminKitchenPaymentGuard({ status: 'paid', paymentStatus: 'unpaid' }).eligible, false);
  assert.equal(adminKitchenPaymentGuard({ status: 'sent_to_kitchen', paymentStatus: 'unpaid' }).eligible, true);
  assert.equal(adminKitchenPaymentGuard({ status: 'paid', paymentStatus: 'paid' }).eligible, true);
});

test('admin KDS action payload guard rejects cancellation, incomplete completion, and unknown commands', () => {
  assert.equal(adminKitchenActionPayload({ kdsAction: 'start_ticket' })?.action, 'start_ticket');
  const linePayload = adminKitchenActionPayload({ kdsAction: 'complete_item', lineKey: '0:5' });
  assert.equal(linePayload?.action, 'complete_item');
  assert.equal(linePayload?.lineKey, '0:5');
  assert.equal(adminKitchenActionPayload({ kdsAction: 'complete_item', lineKey: ' ' }), null);
  assert.equal(adminKitchenActionPayload({ kdsAction: 'complete_ticket' }), null);
  assert.equal(adminKitchenActionPayload({ kdsAction: 'complete_ticket', kdsCanComplete: 'true' })?.action, 'complete_ticket');
  assert.equal(adminKitchenActionPayload({ kdsAction: 'cancel_ticket' }), null);
  assert.equal(adminKitchenActionPayload({ kdsAction: 'delete_ticket' }), null);
});

test('delivery tickets need restaurant acceptance provenance before entering the kitchen queue', () => {
  const base = { branchId: 12, fulfillment: 'delivery', status: 'sent_to_kitchen', paymentStatus: 'unpaid', column: 'new' };
  const acceptanceTime = Date.now() - 60_000;
  const accepted = {
    ...base,
    statusAt: new Date(Date.now() - 30_000).toISOString(),
    deliveryAcceptance: {
      status: 'accepted',
      source: 'restaurant',
      reference: 'acceptance-ref-001',
      acceptedAt: new Date(acceptanceTime).toISOString(),
      acceptedBy: { phone: '+989121234567', role: 'manager' },
    },
  };
  const result = prepareKitchenQueue([
    { ...base, id: 'pending' },
    { ...base, id: 'status-only', deliveryAcceptance: 'accepted' },
    { ...base, id: 'rejected', deliveryAcceptance: { status: 'rejected' } },
    { ...accepted, id: 'accepted' },
  ], { branchId: 12 });

  assert.deepEqual(result.tickets.map((ticket) => ticket.id), ['accepted']);
  assert.equal(result.counts.blocked, 3);
  assert.equal(result.counts.blockedReasons.acceptanceRequired, 1);
  assert.equal(result.counts.blockedReasons.acceptanceRejected, 1);
  assert.equal(result.counts.blockedReasons.acceptanceProvenanceInvalid, 1);
  assert.equal(transitionKitchenTicket({ ...base, id: 'not-accepted' }, 'start_ticket').error, 'delivery_acceptance_required');
});

test('admin KDS mutations fail closed on stale snapshots and reconcile, rather than blindly replay, uncertain actions', () => {
  const kitchenStart = adminSource.indexOf('async kitchen() {');
  const kitchenEnd = adminSource.indexOf('\n    async reservations()', kitchenStart);
  assert.ok(kitchenStart >= 0 && kitchenEnd > kitchenStart);
  const kitchen = adminSource.slice(kitchenStart, kitchenEnd);

  assert.match(kitchen, /button\.disabled = true;\s*button\.setAttribute\('aria-disabled', 'true'\)/);
  assert.match(kitchen, /const refreshed = await paint\(\)\.catch\(\(\) => null\)/);
  assert.match(kitchen, /adminKitchenActionApplied\(currentTicket, payload\)/);
  assert.match(kitchen, /پاسخ اقدام و وضعیت تازهٔ سفارش مشخص نشد/);
  assert.match(kitchen, /صف تازه شد؛ وضعیت فعلی را بررسی کنید و فقط در صورت نیاز دوباره اقدام کنید/);
  assert.match(kitchen, /if \(refreshed\?\.ok && !refreshed\.callsError && !refreshed\.calls\.some/);
  assert.match(kitchen, /فراخوان هنوز باز است؛ پس از بررسی دوباره تلاش کنید/);
  assert.match(adminSource, /delivery_acceptance_required: 'پذیرش رستوران/);
  assert.match(adminSource, /payment_reconciliation_required: 'وضعیت پرداخت سفارش روشن نیست/);
});

test('cancelled tickets are returned explicitly and never counted as active KDS work', () => {
  const result = prepareKitchenQueue([
    { id: 'active', status: 'preparing', paymentStatus: 'unpaid', createdAt: '2026-09-23T10:00:00.000Z' },
    { id: 'cancelled-old', status: 'cancelled', createdAt: '2026-09-23T09:00:00.000Z' },
    { id: 'cancelled-new', column: 'cancelled', cancelledAt: '2026-09-23T10:05:00.000Z' },
    { id: 'ready', column: 'ready', createdAt: '2026-09-23T10:01:00.000Z' },
  ]);

  assert.deepEqual(result.tickets.map((ticket) => ticket.id), ['active', 'ready']);
  assert.deepEqual(result.cancelledTickets.map((ticket) => ticket.id), ['cancelled-new', 'cancelled-old']);
  assert.equal(result.cancelledTickets.every((ticket) => ticket.column === 'cancelled'), true);
  assert.deepEqual(result.counts, { new: 0, preparing: 1, ready: 1, cancelled: 2 });
});

test('cancelled tickets fall back to the first valid timestamp and keep undated records visible last', () => {
  const result = prepareKitchenQueue([
    { id: 'fallback-updated', status: 'cancelled', cancelledAt: 'broken', updatedAt: '2026-09-23T10:15:00.000Z' },
    { id: 'latest', status: 'cancelled', cancelledAt: '2026-09-23T10:20:00.000Z' },
    { id: 'fallback-created', status: 'cancelled', cancelledAt: 'also-broken', updatedAt: 'not-a-date', createdAt: '2026-09-23T10:10:00.000Z' },
    { id: 'unknown', status: 'cancelled', cancelledAt: 'broken', updatedAt: '', createdAt: null },
  ]);

  assert.deepEqual(result.cancelledTickets.map((ticket) => ticket.id), [
    'latest', 'fallback-updated', 'fallback-created', 'unknown',
  ]);
  assert.equal(result.cancelledTickets.length, 4, 'invalid timestamps never hide cancellation records');
});

test('KDS cancellation is not an action and an already cancelled ticket cannot be mutated', () => {
  const cancelAttempt = transitionKitchenTicket({ id: 8, column: 'preparing' }, 'cancel_ticket');
  assert.equal(cancelAttempt.ok, false);
  assert.equal(cancelAttempt.error, 'kitchen_action_invalid');
  assert.equal(cancelAttempt.allowed.includes('cancel_ticket'), false);

  const cancelled = { id: 8, column: 'cancelled' };
  assert.equal(transitionKitchenTicket(cancelled, 'start_ticket').error, 'kitchen_transition_invalid');
  assert.equal(transitionKitchenTicket(cancelled, 'complete_ticket').error, 'kitchen_transition_invalid');
});

test('cross-scope policy gap: a sent ticket remains editable until kitchen work starts', () => {
  const line = { menuItemId: 21, qty: 1, seat: 0, modifiers: [], complements: [] };
  const sent = { status: 'sent_to_kitchen', paymentStatus: 'unpaid' };
  const preparing = { ...sent, status: 'preparing' };

  assert.equal(validateWaiterOrderEdit(sent, [line], { canonicalLines: [line] }).ok, true);
  assert.equal(validateWaiterOrderEdit(preparing, [line], { canonicalLines: [line] }).error, 'order_edit_locked');
});

test('KDS rejects unknown or pending payment states and requires paid evidence for paid orders', () => {
  const order = { status: 'sent_to_kitchen' };
  assert.equal(isKitchenOrderPaymentEligible(order, 'unknown'), false);
  assert.equal(isKitchenOrderPaymentEligible(order, 'pending'), false);
  assert.equal(isKitchenOrderPaymentEligible(order, 'unpaid'), true);
  assert.equal(isKitchenOrderPaymentEligible(order, 'partial'), true);
  assert.equal(isKitchenOrderPaymentEligible(order, 'failed'), true);
  assert.equal(isKitchenOrderPaymentEligible({ status: 'paid' }, 'unpaid'), false);
  assert.equal(isKitchenOrderPaymentEligible({ status: 'paid' }, 'paid'), true);
});

test('queue accepts only eligible states and confines tickets to the selected branch', () => {
  const result = prepareKitchenQueue([
    { id: 'same-branch', branchId: 12, status: 'sent_to_kitchen', paymentStatus: 'unpaid', column: 'new' },
    { id: 'other-branch', branchId: 13, status: 'sent_to_kitchen', paymentStatus: 'unpaid', column: 'new' },
    { id: 'unpaid-unknown', branchId: 12, status: 'sent_to_kitchen', paymentStatus: 'unknown', column: 'new' },
    { id: 'pending', branchId: 12, status: 'sent_to_kitchen', paymentStatus: 'pending', column: 'new' },
    { id: 'paid-mismatch', branchId: 12, status: 'paid', paymentStatus: 'unpaid', column: 'new' },
    { id: 'terminal', branchId: 12, status: 'done', paymentStatus: 'paid', column: 'ready' },
    { id: 'missing-state', branchId: 12, column: 'mystery' },
  ], { branchId: 12 });

  assert.deepEqual(result.tickets.map((ticket) => ticket.id), ['same-branch']);
  assert.deepEqual(result.cancelledTickets, []);
  assert.deepEqual(prepareKitchenQueue([
    { id: 'ticket', branchId: 12, status: 'sent_to_kitchen', paymentStatus: 'unpaid', column: 'new' },
  ], { branchId: 'not-a-branch' }).tickets, []);
});

test('operator priority is boolean and FIFO order is retained within each priority tier', () => {
  const result = prepareKitchenQueue([
    { id: 'fifo-first', column: 'new', createdAt: '2026-09-23T10:01:00.000Z', kds: { priority: false } },
    { id: 'false-string', column: 'new', createdAt: '2026-09-23T10:00:00.000Z', kds: { priority: 'true' } },
    { id: 'priority', column: 'preparing', createdAt: '2026-09-23T10:03:00.000Z', kds: { priority: true } },
    { id: 'fifo-second', column: 'ready', createdAt: '2026-09-23T10:02:00.000Z', kds: { priority: false } },
  ]);

  assert.deepEqual(result.tickets.map((ticket) => ticket.id), ['priority', 'false-string', 'fifo-first', 'fifo-second']);
});

test('KDS refreshes after EventSource reconnect and surfaces connection loss', () => {
  const streamStart = rolePanelSource.indexOf('function startStream() {');
  const streamEnd = rolePanelSource.indexOf('\n  function handlePosShortcut', streamStart);
  assert.ok(streamStart >= 0 && streamEnd > streamStart);
  const stream = rolePanelSource.slice(streamStart, streamEnd);
  assert.match(stream, /new EventSource\(/);
  assert.match(stream, /addEventListener\('open'/);
  assert.match(stream, /addEventListener\('error'/);
  assert.match(stream, /kdsShouldRefreshAfterReconnect\(role, reconnected, state\.activeView\)/);
  assert.match(stream, /state\.kdsConnected = false/);
});

test('handheld KDS releases desktop ticket rows, keeps the command rail in-bounds, and uses touch-sized filters', () => {
  const ticketGrid = cssRules('.kds-ticket-grid').find((rule) => /grid-template-rows:\s*none/.test(rule));
  const fulfillmentButton = cssRules('.kds-fulfillment button').find((rule) => /min-width:\s*44px/.test(rule) && /min-height:\s*44px/.test(rule));

  assert.match(ticketGrid, /grid-template-rows:\s*none/);
  assert.match(ticketGrid, /grid-auto-flow:\s*row/);
  assert.match(ticketGrid, /grid-auto-rows:\s*minmax\(270px,\s*auto\)/);
  assert.match(fulfillmentButton, /min-width:\s*44px/);
  assert.match(fulfillmentButton, /min-height:\s*44px/);
  assert.match(kitchenCss, /\.kds-shell\s*\{\s*grid-template-rows:\s*148px\s+52px/s);
  assert.match(kitchenCss, /\.kds-shell\s*\{\s*grid-template-rows:\s*148px\s+100px/s);
  assert.match(kitchenCss, /\.kds-item\s*\{[^}]*min-height:\s*48px/s);
  assert.match(kitchenCss, /\.kds-ticket__footer\s*>\s*button\s*\{[^}]*min-height:\s*44px/s);
  assert.match(kitchenCss, /@media\s*\(max-height:\s*560px\)\s*and\s*\(pointer:\s*coarse\)/);
});

test('handheld KDS keeps course and held-state labels readable against inline desktop sizing', () => {
  const handheldStart = kitchenCss.indexOf('/* Handheld KDS:');
  const handheldBlock = kitchenCss.slice(handheldStart).match(/@media\s*\(max-width:\s*700px\)\s*\{([\s\S]*?)\n\}/);

  assert.ok(handheldStart >= 0, 'the handheld KDS overrides are present');
  assert.ok(handheldBlock, 'the handheld breakpoint can be isolated');
  assert.match(rolePanelSource, /class="kds-course-tag" style="[^"]*font-size:10px/,
    'course tags are deliberately sized smaller inline for desktop');
  assert.match(handheldBlock[1], /\.kds-course-tag\s*\{\s*font-size:\s*12px\s*!important;\s*line-height:\s*1\.4;/);
});
