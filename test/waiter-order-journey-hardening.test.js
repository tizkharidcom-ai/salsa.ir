'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ROLE_CAPABILITIES } = require('../server/command-center');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'js', 'role-panel.js'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'css', 'waiter-floor-plan.css'), 'utf8');

const stateStart = source.indexOf('  function waiterPaymentActionState(');
const stateEnd = source.indexOf('\n  function waiterDraftHasRecordedPayment(', stateStart);
assert.ok(stateStart >= 0 && stateEnd > stateStart, 'waiter payment readiness rule exists');
const stateRule = new Function('waiterPendingPaymentCanRecover', `return (${source.slice(stateStart, stateEnd).trim()});`)(
  () => false,
);

const paymentWorkflow = (overrides = {}) => ({
  settled: false,
  requiresReconciliation: false,
  isConsistent: true,
  amounts: { due: 1250 },
  stages: [{ id: 'settlement', state: 'current' }],
  ...overrides,
});
const paymentState = { deriveOrderPaymentWorkflow: (order) => order.workflow };
const waiterCapabilities = ['orders.view', 'payments.collect'];
const readyWaiter = () => ({
  order: { id: 42, status: 'done', workflow: paymentWorkflow() },
});

test('waiter payment shortcut follows the staged order, permission, and settlement gates', () => {
  assert.deepEqual(stateRule({ order: null }, waiterCapabilities, 7, paymentState), {
    ready: false, reason: 'order',
  });
  assert.deepEqual(stateRule(readyWaiter(), ['orders.view'], 7, paymentState), {
    ready: false, reason: 'permission',
  });

  const preparing = readyWaiter();
  preparing.order.status = 'preparing';
  assert.deepEqual(stateRule(preparing, waiterCapabilities, 7, paymentState), {
    ready: false, reason: 'service',
  });

  assert.deepEqual(stateRule(readyWaiter(), waiterCapabilities, 7, paymentState), {
    ready: true, reason: 'ready',
  });
});

test('waiter shortcut gives actionable reasons for unresolved, inconsistent, and settled invoices', () => {
  const refreshing = readyWaiter();
  refreshing.paymentNeedsRefresh = true;
  assert.equal(stateRule(refreshing, waiterCapabilities, 7, paymentState).reason, 'refresh');

  const inconsistent = readyWaiter();
  inconsistent.order.workflow = paymentWorkflow({ isConsistent: false });
  assert.equal(stateRule(inconsistent, waiterCapabilities, 7, paymentState).reason, 'reconciliation');

  const settled = readyWaiter();
  settled.order.workflow = paymentWorkflow({ settled: true });
  assert.equal(stateRule(settled, waiterCapabilities, 7, paymentState).reason, 'settled');

  const noBalance = readyWaiter();
  noBalance.order.workflow = paymentWorkflow({ amounts: { due: 0 } });
  assert.equal(stateRule(noBalance, waiterCapabilities, 7, paymentState).reason, 'balance');
});

test('operations payment button is disabled until eligible and explains the current blocker', () => {
  const actionsStart = source.indexOf('  function paintTerminalActions(container) {');
  const actionsEnd = source.indexOf('\n  async function submitWaiterSplit(', actionsStart);
  assert.ok(actionsStart >= 0 && actionsEnd > actionsStart, 'waiter operations action stage exists');
  const actions = source.slice(actionsStart, actionsEnd);

  assert.match(actions, /actionCapabilities = state\.session\?\.workspace\?\.capabilities/);
  assert.match(actions, /waiterPaymentActionState\(\s*wt,\s*actionCapabilities/);
  assert.match(actions, /id="act-pay-side" \$\{paymentAction\.ready \? '' : 'disabled'\}/);
  assert.match(actions, /id="wt-payment-action-hint"[\s\S]*?\$\{paymentActionHints\[paymentAction\.reason\]\}/);
  assert.match(actions, /permission:[\s\S]*?صندوق‌دار/);
  assert.match(actions, /service:[\s\S]*?ثبت تحویل سفارش به میز/);
  assert.match(actions, /reconciliation:[\s\S]*?با صندوق تطبیق/);
  assert.match(actions, /ready: canCollectCash[\s\S]*?دریافت نقدی از صندوق/);
  assert.match(actions, /act-pay-side[\s\S]*?payWaiterCheck\(\)/);
  assert.ok(ROLE_CAPABILITIES.waiter.includes('payments.collect'));
  assert.ok(!ROLE_CAPABILITIES.waiter.includes('cash.manage'), 'waiter must route cash settlement through an authorized drawer');

  assert.match(styles, /\.wt-action-btn#act-pay-side:disabled\s*\{[^}]*cursor:\s*not-allowed/s);
  assert.match(styles, /\.wt-action-btn#act-pay-side:disabled:active\s*\{[^}]*transform:\s*none/s);
  assert.match(styles, /\.wt-action-btn#act-pay-side small\s*\{[^}]*font-size:\s*12px\s*!important/s);
  assert.match(styles, /\.wt-action-btn#act-pay-side small\s*\{[^}]*overflow-wrap:\s*anywhere/s);
});
