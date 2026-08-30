'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  canonicalJson, buildSourceEvidence, compareSummaries, evaluatePreflight,
} = require('../scripts/finance-cutover-preflight');

test('cutover source evidence is checksum-backed and preserves the real-data trust split', () => {
  const sourcePath = path.join(__dirname, '..', 'server', 'data', 'db.json');
  const raw = fs.readFileSync(sourcePath);
  const result = buildSourceEvidence(raw, sourcePath);
  assert.match(result.evidence.sha256, /^[0-9a-f]{64}$/);
  assert.equal(result.evidence.bytes, raw.length);
  const trust = result.evidence.migrationTrust;
  assert.equal(trust.paidOrders, trust.verifiedOrders + trust.needsEvidenceOrders);
  assert.equal(trust.classifiedRecords, trust.paidOrders + trust.quarantinedRecords);
  assert.ok(result.evidence.reconciliation.orders >= trust.paidOrders);
  assert.ok(trust.verifiedOrders >= 0);
  assert.ok(trust.needsEvidenceOrders >= 0);
  assert.ok(trust.quarantinedRecords >= 0);
  assert.equal(typeof trust.historicalEvidenceComplete, 'boolean');
});

test('canonical JSON and reconciliation comparison are deterministic', () => {
  assert.equal(canonicalJson({ b: 2, a: { d: 4, c: 3 } }), '{"a":{"c":3,"d":4},"b":2}');
  assert.deepEqual(compareSummaries({ orders: 2, total: 4 }, { total: 4, orders: 2 }), []);
  assert.deepEqual(compareSummaries({ orders: 2 }, { orders: 1 }), [{ key: 'orders', source: 2, destination: 1 }]);
});

test('cutover evaluation stays NO-GO when destination, evidence and shadow thresholds are absent', () => {
  const decision = evaluatePreflight(
    { reconciliation: { orders: 2 }, migrationTrust: { classifiedRecords: 5, verifiedOrders: 0, needsEvidenceOrders: 2, quarantinedRecords: 3 } },
    { available: false, reason: 'database_url_required', migrationPlan: [], inspectedReadOnly: true },
    { status: 'NO_GO', completeOrders: 0, operatingDays: 0 },
  );
  assert.equal(decision.status, 'NO_GO');
  assert.equal(decision.automaticCutover, false);
  assert.equal(decision.gates.find((row) => row.id === 'destination_reachable').passed, false);
  assert.equal(decision.gates.find((row) => row.id === 'historical_evidence').passed, false);
  assert.equal(decision.gates.find((row) => row.id === 'no_destination_exceptions').passed, false);
  assert.equal(decision.gates.find((row) => row.id === 'migration_baseline').passed, false);
  assert.equal(decision.gates.find((row) => row.id === 'migration_archive_complete').passed, false);
  assert.equal(decision.gates.find((row) => row.id === 'shadow_thresholds').passed, false);
});

test('destination preflight is structurally read-only', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'finance-cutover-preflight.js'), 'utf8');
  assert.match(source, /REPEATABLE READ READ ONLY/);
  assert.match(source, /ROLLBACK/);
  assert.doesNotMatch(source, /client\.query\(`?\s*(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE)/i);
});
