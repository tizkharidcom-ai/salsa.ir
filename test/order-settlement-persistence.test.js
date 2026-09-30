'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('./helpers/source-fs');
const path = require('node:path');
const vm = require('node:vm');
const { createSettlementInFlightKey } = require('../server/settlement-in-flight-key');

const source = fs.readFileSync(path.join(__dirname, '..', 'server', 'server.js'), 'utf8');
const fingerprintSource = source.match(/function checkoutIdempotencyFingerprint\(input, actor = null\) \{[\s\S]*?\n\}/)?.[0];
assert.ok(fingerprintSource, 'settlement request fingerprint helper exists');
const checkoutIdempotencyFingerprint = vm.runInNewContext(
  `${fingerprintSource}; checkoutIdempotencyFingerprint;`,
  { crypto, effectiveRole: (actor) => String(actor?.role || 'guest') },
);
const start = source.indexOf('const handleSettleOrder = async (req, res, forcedTargetId) => {');
const end = source.indexOf("app.post('/api/cashier/orders/:id/settle'", start);
assert.ok(start >= 0 && end > start, 'cashier settlement handler boundaries exist');
const handler = source.slice(start, end);

test('settlement retry identity includes tenant, branch, order and the caller key', () => {
  const identity = {
    tenantId: 'tenant-a', branchId: 7, orderId: 41, idempotencyKey: 'cashier-settlement-001',
  };
  const key = createSettlementInFlightKey(identity);
  assert.equal(key, createSettlementInFlightKey({ ...identity, branchId: '07', orderId: '41' }));
  assert.notEqual(key, createSettlementInFlightKey({ ...identity, tenantId: 'tenant-b' }));
  assert.notEqual(key, createSettlementInFlightKey({ ...identity, branchId: 8 }));
  assert.notEqual(key, createSettlementInFlightKey({ ...identity, orderId: 42 }));
  assert.notEqual(key, createSettlementInFlightKey({ ...identity, idempotencyKey: 'cashier-settlement-002' }));
});

test('durable order rollback snapshots the one-time loyalty award idempotency ledger', () => {
  const snapshotKeys = source.match(/const FINANCE_MUTATION_STATE_KEYS = Object\.freeze\(\[([\s\S]*?)\]\);/)?.[1] || '';
  assert.match(snapshotKeys, /'users'/);
  assert.match(snapshotKeys, /'loyaltyLedger'/);
  assert.match(snapshotKeys, /'loyaltyAchievementAwards'/);
});

test('settlement request fingerprint changes with branch, actor identity, role, and terminal reference', () => {
  const input = {
    orderId: 41, branchId: 7, tender: 'manual_card', paymentAmount: 2_500,
    amountTendered: null, paymentReference: 'TERM-REF-001',
  };
  const actor = { phone: 'cashier-1', role: 'cashier' };
  const fingerprint = checkoutIdempotencyFingerprint(input, actor);

  assert.equal(checkoutIdempotencyFingerprint(input, actor), fingerprint);
  assert.notEqual(checkoutIdempotencyFingerprint({ ...input, branchId: 8 }, actor), fingerprint);
  assert.notEqual(checkoutIdempotencyFingerprint(input, { ...actor, phone: 'cashier-2' }), fingerprint);
  assert.notEqual(checkoutIdempotencyFingerprint(input, { ...actor, role: 'manager' }), fingerprint);
  assert.notEqual(checkoutIdempotencyFingerprint({ ...input, paymentReference: 'TERM-REF-002' }, actor), fingerprint);
});

test('cashier checks branch access before returning a persisted idempotent replay', () => {
  const branchResolution = handler.indexOf('persistedOrderBranchId(order)');
  const branchCheck = handler.indexOf('assertUserBranchAccess(req.user, branchId)');
  const replayLookup = handler.indexOf(".find((payment) => payment.idempotencyKey === idempotencyKey)");
  const replayResponse = handler.indexOf('order: operationalOrderResponse(order, req.user)', replayLookup);
  assert.ok(branchResolution >= 0 && branchCheck > branchResolution && replayLookup > branchCheck && replayResponse > replayLookup);
});

test('settlement holds duplicate retries until durable save succeeds and never resolves them as success on failure', () => {
  const pendingLookup = handler.indexOf('const pending = settlementInFlight.get(inFlightKey)');
  const waitForPending = handler.indexOf('const outcome = await pending', pendingLookup);
  const failedReplay = handler.indexOf('if (!outcome.ok)', waitForPending);
  const replaySuccess = handler.indexOf('order: operationalOrderResponse(order, req.user)', failedReplay);
  const lock = handler.indexOf('settlementInFlight.set(inFlightKey, settlementPromise)');
  const persist = handler.indexOf('await persistFinanceMutation(snapshot)');
  const success = handler.indexOf('resolveSettlement?.({ ok: true })', persist);
  const catchStart = handler.indexOf('} catch (error) {', success);
  const rollback = handler.indexOf('restoreFinanceMutationState(snapshot)', catchStart);
  const failure = handler.indexOf('resolveSettlement?.({ ok: false', rollback);
  assert.ok(pendingLookup >= 0 && waitForPending > pendingLookup && failedReplay > waitForPending && replaySuccess > failedReplay);
  assert.ok(lock >= 0 && persist > lock && success > persist);
  assert.ok(catchStart > success && rollback > catchStart && failure > rollback);
  assert.match(handler.slice(failure, failure + 300), /\{ ok: false, status:/);
});

test('settlement audit outbox append occurs only after the financial snapshot commits', () => {
  const audit = handler.indexOf("settlementAuditEntry = recordAudit(req, fullyPaid ? 'order.settled'");
  const persist = handler.indexOf('await persistFinanceMutation(snapshot)');
  const appendAudit = handler.indexOf('appendAuditAfterCommit(settlementAuditEntry)', persist);
  const publish = handler.indexOf("publishOperationalEvent('order.updated'", persist);
  assert.ok(audit >= 0 && persist > audit && appendAudit > persist && publish > appendAudit);
  assert.match(handler.slice(audit, persist), /\{ deferAppend: true \}/,
    'the standalone durable audit append is deferred while the order mutation is provisional');
});

test('unknown payment status and production persistence uncertainty fence collection before mutation', () => {
  const readiness = handler.indexOf('settlementPersistenceGate.check(');
  const lookup = handler.indexOf('(db.orders || []).find((item) => Number(item.id) === targetId)');
  const unknownGuard = handler.indexOf("if (order.paymentStatus === 'unknown')");
  const mutation = handler.indexOf('order.partialPayments.push(payment)');
  assert.ok(readiness >= 0 && lookup > readiness && unknownGuard > lookup && mutation > unknownGuard);
  assert.match(handler.slice(unknownGuard, mutation), /payment_status_reconciliation_required/);
});
