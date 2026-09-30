'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('./helpers/source-fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const adminSource = fs.readFileSync(path.join(root, 'js/admin.js'), 'utf8');
const serverSource = fs.readFileSync(path.join(root, 'server/server.js'), 'utf8');
const adminHtml = fs.readFileSync(path.join(root, 'admin.html'), 'utf8');
const operationsCss = fs.readFileSync(path.join(root, 'css/admin-operations-v3.css'), 'utf8');

function extractFunction(name) {
  const declaration = new RegExp(`(?:^|\\n)\\s*(?:async\\s+)?function ${name}\\(`).exec(adminSource);
  assert.ok(declaration, `expected helper ${name} in js/admin.js`);
  const start = declaration.index + declaration[0].lastIndexOf('function');
  const asyncPrefix = /async\s+function/.test(declaration[0]) ? 'async ' : '';
  let parentheses = 0;
  let closingParenthesis = -1;
  for (let index = adminSource.indexOf('(', start); index < adminSource.length; index += 1) {
    if (adminSource[index] === '(') parentheses += 1;
    if (adminSource[index] === ')') {
      parentheses -= 1;
      if (parentheses === 0) { closingParenthesis = index; break; }
    }
  }
  assert.ok(closingParenthesis > start, `expected ${name} parameters to close`);
  const open = adminSource.indexOf('{', closingParenthesis + 1);
  assert.ok(open > start, `expected ${name} body`);
  let depth = 0;
  for (let index = open; index < adminSource.length; index += 1) {
    if (adminSource[index] === '{') depth += 1;
    if (adminSource[index] === '}') {
      depth -= 1;
      if (depth === 0) return `${asyncPrefix}${adminSource.slice(start, index + 1)}`;
    }
  }
  throw new Error(`unclosed helper ${name}`);
}

function loadKdsHelpers({ api = async () => ({}), branchQs = () => '?branchId=9' } = {}) {
  const names = [
    'adminKdsIsHeldLine',
    'adminKitchenTicketProgress',
    'adminKitchenLineAction',
    'adminKitchenCompletionAction',
    'adminKitchenActionPayload',
    'sendAdminKitchenAction',
    'adminDeliveryAcceptanceView',
  ];
  return new Function('api', 'branchQs', `${names.map(extractFunction).join('\n')}\nreturn { ${names.join(', ')} };`)(api, branchQs);
}

function kitchenMethodSource() {
  const start = adminSource.indexOf('    async kitchen() {');
  const end = adminSource.indexOf('\n    async reservations()', start);
  assert.ok(start >= 0 && end > start, 'the legacy admin kitchen method exists');
  return adminSource.slice(start, end);
}

test('legacy KDS progress counts active and held lines separately and blocks early ready', () => {
  const { adminKitchenTicketProgress, adminKitchenCompletionAction } = loadKdsHelpers();
  const ticket = {
    column: 'preparing',
    items: [
      { key: '0:11', completedAt: '2026-09-23T09:00:00.000Z' },
      { key: '1:12', completedAt: null },
      { key: '2:13', courseStatus: 'hold' },
    ],
    heldCourseItems: [{ key: '2:13', courseStatus: 'hold' }],
  };

  const progress = adminKitchenTicketProgress(ticket);
  assert.deepEqual(progress, {
    activeCount: 2,
    completedCount: 1,
    remainingCount: 1,
    heldCount: 1,
    canCompleteTicket: false,
  });
  assert.deepEqual(adminKitchenCompletionAction(ticket, progress), {
    action: null,
    enabled: false,
    label: 'منتظر تکمیل قلم‌ها و ارسال دوره از سالن',
  });

  const incomplete = adminKitchenTicketProgress({ items: [{ key: '0:11', completedAt: null }] });
  assert.equal(adminKitchenCompletionAction({ column: 'preparing' }, incomplete).action, null);
  const heldOnly = adminKitchenTicketProgress({ items: [], heldCourseItems: [{ key: '2:13' }] });
  assert.equal(heldOnly.canCompleteTicket, false);
  assert.equal(adminKitchenCompletionAction({ column: 'preparing' }, heldOnly).enabled, false);

  const complete = adminKitchenTicketProgress({ items: [{ key: '0:11', completedAt: 'now' }] });
  assert.deepEqual(adminKitchenCompletionAction({ column: 'preparing' }, complete), {
    action: 'complete_ticket',
    enabled: true,
    label: 'ثبت آماده‌بودن سفارش',
  });
});

test('legacy KDS line actions use a single line key and never complete a held or unstarted line', () => {
  const { adminKitchenLineAction, adminKitchenActionPayload } = loadKdsHelpers();

  assert.equal(adminKitchenLineAction({ key: '0:11' }, 'new'), null);
  assert.equal(adminKitchenLineAction({ key: '0:11', courseStatus: 'hold' }, 'preparing'), null);
  assert.equal(adminKitchenLineAction({ courseStatus: 'fired' }, 'preparing'), null);
  assert.deepEqual(adminKitchenLineAction({ key: '1:12' }, 'preparing'), {
    action: 'complete_item', lineKey: '1:12',
  });
  assert.deepEqual(adminKitchenLineAction({ key: '1:12', completedAt: 'now' }, 'preparing'), {
    action: 'undo_item', lineKey: '1:12',
  });
  assert.deepEqual(adminKitchenLineAction({ key: '1:12', completedAt: 'now' }, 'ready'), {
    action: 'undo_item', lineKey: '1:12',
  });
  assert.equal(adminKitchenLineAction({ key: '1:12' }, 'ready'), null);

  assert.deepEqual(adminKitchenActionPayload({ kdsAction: 'complete_item', lineKey: '1:12' }), {
    action: 'complete_item', lineKey: '1:12',
  });
  assert.deepEqual(adminKitchenActionPayload({ kdsAction: 'undo_item', lineKey: '1:12' }), {
    action: 'undo_item', lineKey: '1:12',
  });
  assert.equal(adminKitchenActionPayload({ kdsAction: 'complete_item' }), null);
  assert.equal(adminKitchenActionPayload({ kdsAction: 'complete_ticket' }), null);
  assert.deepEqual(adminKitchenActionPayload({ kdsAction: 'complete_ticket', kdsCanComplete: 'true' }), {
    action: 'complete_ticket',
  });
});

test('legacy admin KDS wires item controls to branch-scoped action requests and only renders ready action when eligible', async () => {
  const calls = [];
  const helpers = loadKdsHelpers({
    api: async (url, options) => { calls.push({ url, options }); return { ok: true }; },
    branchQs: () => '?branchId=9',
  });
  await helpers.sendAdminKitchenAction(42, { action: 'complete_item', lineKey: '2:17' });
  await helpers.sendAdminKitchenAction(42, { action: 'undo_item', lineKey: '2:17' });
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(call.url, '/api/kitchen/orders/42?branchId=9');
    assert.equal(call.options.method, 'PATCH');
  }
  assert.deepEqual(JSON.parse(calls[0].options.body), { action: 'complete_item', lineKey: '2:17' });
  assert.deepEqual(JSON.parse(calls[1].options.body), { action: 'undo_item', lineKey: '2:17' });

  const kitchen = kitchenMethodSource();
  assert.match(kitchen, /isHeld \? null : adminKitchenLineAction\(item, ticket\.column\)/);
  assert.match(kitchen, /data-kds-action="\$\{itemAction\.action\}"[\s\S]*?data-line-key="\$\{esc\(itemAction\.lineKey\)\}"/);
  assert.match(kitchen, /completionAction\.enabled[\s\S]*?data-kds-action="complete_ticket" data-kds-can-complete="true"/);
  assert.match(kitchen, /main\.querySelectorAll\('\[data-kds-action\]'\)/);
  assert.match(kitchen, /adminKitchenActionPayload\(button\.dataset\)/);
  assert.match(kitchen, /sendAdminKitchenAction\(button\.dataset\.kdsTicketId, payload\)/);
  assert.doesNotMatch(kitchen, /data-kstatus|recall_ticket/);
});

test('legacy admin KDS action controls use the linked stylesheet and touch-sized mobile targets', () => {
  assert.match(adminHtml, /css\/admin-operations-v3\.css\?v=adminOps7-order-actions/);
  assert.match(adminHtml, /js\/admin\.js\?v=admin-delivery-handoff-v3/);

  const actionRule = operationsCss.match(/\.kds-order-line__action\s*\{([^}]*)\}/);
  assert.ok(actionRule, 'per-item action style exists');
  assert.match(actionRule[1], /min-height:\s*48px/);
  assert.match(operationsCss, /@media\s*\(max-width:\s*640px\)[\s\S]*?\.kds-order-line__action\s*\{[^}]*width:\s*100%/);
});

test('delivery acceptance badge is independent from payment and actions require delivery.manage', () => {
  const { adminDeliveryAcceptanceView } = loadKdsHelpers();
  for (const orderStatus of ['pending_online', 'awaiting_confirmation', 'pay_at_cashier', 'paid']) {
    for (const paymentStatus of ['unpaid', 'partial', 'pending', 'unknown', 'paid']) {
      const view = adminDeliveryAcceptanceView({
        id: 72,
        status: orderStatus,
        fulfillment: 'delivery',
        paymentStatus,
        deliveryAcceptance: { status: 'pending' },
      }, true);
      assert.equal(view.canAccept, true, `payment ${paymentStatus} does not change the restaurant-acceptance control`);
      assert.equal(view.status, 'pending');
      assert.match(view.badge, /پذیرش رستوران/);
      assert.match(view.detail, /پذیرش مستقل از پرداخت است/);
    }
  }

  assert.equal(adminDeliveryAcceptanceView({ status: 'awaiting_confirmation', fulfillment: 'delivery' }, false).canAccept, false);
  assert.equal(adminDeliveryAcceptanceView({ status: 'sent_to_kitchen', fulfillment: 'delivery' }, true), null);
  assert.equal(adminDeliveryAcceptanceView({ status: 'awaiting_confirmation', fulfillment: 'dine_in' }, true), null);
  assert.match(adminDeliveryAcceptanceView({
    status: 'pending_online', fulfillment: 'delivery', paymentStatus: 'pending',
    deliveryAcceptance: { status: 'accepted' },
  }, true).detail, /وارد آشپزخانه نمی‌شود/);
  assert.equal(adminDeliveryAcceptanceView({
    status: 'awaiting_confirmation', fulfillment: 'delivery', deliveryAcceptance: { status: 'accepted' },
  }, true).canAccept, false);
  assert.equal(adminDeliveryAcceptanceView({
    status: 'awaiting_confirmation', fulfillment: 'delivery', deliveryAcceptance: { status: 'rejected' },
  }, true).canAccept, false);
  assert.equal(adminDeliveryAcceptanceView({
    status: 'awaiting_confirmation', fulfillment: 'delivery', deliveryAcceptance: { status: 'mystery' },
  }, true).status, 'unknown');
});

test('delivery acceptance review UI stays aligned with the server pre-kitchen allowlist', () => {
  const routeStart = serverSource.indexOf("app.post('/api/delivery/orders/:id/accept'");
  const routeEnd = serverSource.indexOf("app.patch('/api/admin/orders/:id'", routeStart);
  assert.ok(routeStart >= 0 && routeEnd > routeStart);
  const route = serverSource.slice(routeStart, routeEnd);
  assert.match(adminSource, /!\['pending_online', 'awaiting_confirmation', 'pay_at_cashier', 'paid'\]\.includes\(orderStatus\)/);
  assert.match(route, /!\['pending_online', 'awaiting_confirmation', 'pay_at_cashier', 'paid'\]\.includes\(status\)/);
});

test('manager delivery acceptance calls the dedicated POST route, reconciles uncertain outcomes, and never PATCHes status', () => {
  const ordersStart = adminSource.indexOf('    async orders() {');
  const ordersEnd = adminSource.indexOf('\n    async delivery()', ordersStart);
  assert.ok(ordersStart >= 0 && ordersEnd > ordersStart);
  const ordersUi = adminSource.slice(ordersStart, ordersEnd);
  const actionStart = ordersUi.indexOf("main.querySelectorAll('[data-delivery-accept]')");
  const actionEnd = ordersUi.indexOf("main.querySelectorAll('[data-onext]')", actionStart);
  assert.ok(actionStart >= 0 && actionEnd > actionStart);
  const action = ordersUi.slice(actionStart, actionEnd);

  assert.match(ordersUi, /adminDeliveryAcceptanceView\(order,canManageDelivery\)/);
  assert.match(ordersUi, /data-delivery-accept="\$\{esc\(order\.id\)\}"/);
  assert.match(ordersUi, /پذیرش و ارسال به آشپزخانه/);
  assert.match(action, /`\/api\/delivery\/orders\/\$\{encodeURIComponent\(orderId\)\}\/accept\$\{branchQs\(\)\}`/);
  assert.match(action, /method:'POST'/);
  assert.match(action, /'Idempotency-Key':acceptanceKey\.key/);
  assert.match(action, /await tabs\.orders\(\)/);
  assert.match(action, /deliveryAcceptance\?\.status/);
  assert.match(ordersUi, /check\.dataset\.deliveryAcceptCheck=String\(orderId\)/);
  assert.doesNotMatch(action, /method:'PATCH'/);
});

test('admin KDS surfaces blocked delivery acceptance reasons without offering an acceptance action to kitchen staff', () => {
  const kitchen = kitchenMethodSource();
  assert.match(kitchen, /Number\(queue\.counts\?\.blocked\)\s*\|\|\s*0/);
  assert.match(kitchen, /queue\.counts\?\.blockedReasons\?\.acceptanceRequired/);
  assert.match(kitchen, /queue\.counts\?\.blockedReasons\?\.acceptanceRejected/);
  assert.match(kitchen, /queue\.counts\?\.blockedReasons\?\.acceptanceProvenanceInvalid/);
  assert.match(kitchen, /kds-acceptance-block-title/);
  assert.match(kitchen, /دریافت وجه به‌تنهایی مجوز شروع آماده‌سازی نیست/);
  assert.match(kitchen, /آشپزخانه امکان تأیید سفارش ارسال را ندارد/);
  assert.match(operationsCss, /\.kds-acceptance-block\s*\{/);
});

test('handheld admin KDS raises kitchen-critical text to readable sizes and retains 48px actions', () => {
  const mobileStart = operationsCss.lastIndexOf('@media (max-width: 640px)');
  assert.ok(mobileStart >= 0);
  const mobile = operationsCss.slice(mobileStart);
  for (const selector of ['.kds-card header small', '.kds-note', '.kds-order-line__state', '.kds-call-btn span']) {
    assert.match(mobile, new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^}]*font-size:\\s*\.8125rem`));
  }
  assert.match(mobile, /\.kds-actions > button\s*\{[^}]*min-height:\s*48px/);
  assert.match(mobile, /\.delivery-acceptance__action\s*\{[^}]*min-height:\s*48px/);
});
