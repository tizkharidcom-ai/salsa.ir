'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createSettlementPersistenceGate } = require('../server/settlement-persistence-gate');

const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server', 'server.js'), 'utf8');

test('production cash settlement requires PostgreSQL to be both enabled and authoritative', () => {
  const gate = createSettlementPersistenceGate({ environment: () => 'production' });
  assert.equal(gate.check({ postgresEnabled: true, postgresRequired: true }).ok, true);
  assert.equal(gate.check({ postgresEnabled: false, postgresRequired: true }).code, 'production_postgres_authority_required');
  assert.equal(gate.check({ postgresEnabled: true, postgresRequired: false }).code, 'production_postgres_authority_required');
  assert.equal(gate.check({ postgresEnabled: false, postgresRequired: false }).status, 503);
});

test('an uncertain durable write permanently fences production mutations until process restart', () => {
  const gate = createSettlementPersistenceGate({ environment: () => 'production' });
  assert.equal(gate.recordFailure(Object.assign(new Error('commit acknowledgement lost'), { code: 'postgres_state_write_conflict' })).code,
    'postgres_state_write_conflict');
  assert.equal(gate.check({ postgresEnabled: true, postgresRequired: true }).code, 'settlement_reconciliation_required');
  assert.equal(gate.uncertainty().code, 'postgres_state_write_conflict');
  gate.recordFailure(Object.assign(new Error('later failure'), { code: 'later_error' }));
  assert.equal(gate.uncertainty().code, 'postgres_state_write_conflict', 'retain the first failure as the reconciliation trigger');
});

test('the settlement fence is production-only and precedes both external-tender routes', () => {
  const development = createSettlementPersistenceGate({ environment: () => 'development' });
  development.recordFailure(Object.assign(new Error('local failure'), { code: 'test_error' }));
  assert.equal(development.uncertainty(), null);
  assert.equal(development.check({ postgresEnabled: false, postgresRequired: false }).ok, true);

  const settlementStart = serverSource.indexOf('const handleSettleOrder = async (req, res, forcedTargetId) => {');
  const settlementLookup = serverSource.indexOf('(db.orders || []).find((item) => Number(item.id) === targetId)', settlementStart);
  const readiness = serverSource.indexOf('settlementPersistenceGate.check(', settlementStart);
  assert.ok(readiness >= 0 && settlementLookup > readiness, 'cash/manual-card settlement is gated before reading or changing order state');

  const walletStart = serverSource.indexOf("app.post('/api/orders/:id/pay-wallet', requireAuth, async (req, res) => {");
  const walletLookup = serverSource.indexOf('(db.orders || []).find((o) => Number(o.id) === orderId)', walletStart);
  const walletReadiness = serverSource.indexOf('settlementPersistenceGate.check(', walletStart);
  assert.ok(walletReadiness >= 0 && walletLookup > walletReadiness, 'wallet payment is gated before order state lookup');

  const tenantMiddlewareEnd = serverSource.indexOf('// ── SALSA Tenant Policy Enforcement Layer', serverSource.indexOf('app.use((req, res, next) => {\n  if (!TENANT_INFRASTRUCTURE_ENABLED)'));
  const mutationFence = serverSource.indexOf('settlementPersistenceGate.check({', tenantMiddlewareEnd - 900);
  assert.ok(mutationFence >= tenantMiddlewareEnd - 900, 'all post-failure mutations are rejected centrally while safe reads remain available');
});
