'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('./helpers/source-fs');
const path = require('node:path');
const { runtimeReadiness } = require('../server/runtime-readiness');

const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server', 'server.js'), 'utf8');

const productionReady = {
  nodeEnv: 'production',
  postgresEnabled: true,
  postgresRequired: true,
  databasePing: { ok: true, latencyMs: 3 },
  financeStatus: { available: true },
  settlementGate: { ok: true },
};

test('production readiness requires authoritative PostgreSQL, a live connection, Finance schema, and an open settlement gate', () => {
  assert.equal(runtimeReadiness(productionReady).ok, true);

  for (const [key, value, reason] of [
    ['postgresEnabled', false, 'postgres_disabled'],
    ['postgresRequired', false, 'postgres_not_authoritative'],
    ['databasePing', { ok: false, code: 'connection_refused' }, 'connection_refused'],
    ['financeStatus', { available: false, reason: 'finance_schema_required' }, 'finance_schema_required'],
    ['settlementGate', { ok: false, code: 'settlement_reconciliation_required' }, 'settlement_reconciliation_required'],
  ]) {
    const readiness = runtimeReadiness({ ...productionReady, [key]: value });
    assert.equal(readiness.ok, false, key);
    assert.equal(readiness.status, 'not_ready', key);
    const failedCheck = Object.values(readiness.checks).find((check) => check.reason === reason);
    assert.ok(failedCheck, `${key} must expose safe reason ${reason}`);
  }
});

test('non-production JSON fallback remains usable without being mislabeled as production-ready', () => {
  const readiness = runtimeReadiness({ nodeEnv: 'development' });
  assert.equal(readiness.ok, true);
  assert.equal(readiness.environment, 'non_production');
  assert.equal(readiness.checks.postgresAuthority.ok, false);
});

test('the readiness endpoint checks PostgreSQL and settlement health while liveness remains separate', () => {
  const endpointStart = serverSource.indexOf("if (req.path === '/api/ready'");
  const healthStart = serverSource.indexOf("if (req.path === '/api/health'");
  assert.ok(endpointStart >= 0 && healthStart > endpointStart);
  const endpoint = serverSource.slice(endpointStart, healthStart);
  assert.match(endpoint, /await stateStore\.ping\(\)/);
  assert.match(endpoint, /stateStore\.financeStatus\(\)/);
  assert.match(endpoint, /settlementPersistenceGate\.check\(/);
  assert.match(endpoint, /res\.status\(readiness\.ok \? 200 : 503\)/);
  assert.match(endpoint, /\.catch\(next\)/);
  assert.match(serverSource.slice(healthStart, healthStart + 800), /status:\s*'healthy'/,
    'the existing liveness endpoint stays distinct from write-path readiness');
  assert.match(serverSource, /database: stateStore\.enabled \? 'postgresql-configured' : 'memory-fallback'/,
    'liveness no longer claims an actual database connection from env presence alone');
});
