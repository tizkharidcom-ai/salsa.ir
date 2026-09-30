'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const gateImplementations = [
  require('../server/salsa/control-plane/operational/production-readiness-gate'),
  require('../superadmin/backend/operational/production-readiness-gate'),
];

function validManifest(gate) {
  const capturedAt = new Date().toISOString();
  return {
    schemaVersion: 1,
    environment: 'production',
    releaseId: 'release-gate-test-1',
    rollbackPlan: 'restore the last approved release',
    stopRules: { errorBudgetPct: 1, ackMinimumPct: 99 },
    checks: Object.fromEntries(gate.REQUIRED_GATE_IDS.map((id) => [id, {
      status: 'passed',
      assertions: Object.fromEntries(gate.REQUIRED_GATE_ASSERTIONS[id].map((key) => [key, true])),
      evidence: [{
        source: 'approved external evidence provider',
        uri: 'https://artifacts.westo.ir/evidence/report.json',
        capturedAt,
        actor: 'release-reviewer',
        artifactDigest: 'a'.repeat(64),
      }],
    }])),
    approvals: gate.REQUIRED_APPROVAL_ROLES.map((role) => ({
      role, status: 'approved', actor: `${role}-reviewer`, approvedAt: capturedAt,
    })),
  };
}

test('both production gate implementations reject malformed entries instead of discarding them', () => {
  for (const gate of gateImplementations) {
    const manifest = validManifest(gate);
    assert.equal(gate.evaluateProductionReadiness(manifest).status, 'GO');
    manifest.checks.staging_foundation.evidence.push(null);
    const report = gate.evaluateProductionReadiness(manifest);
    assert.equal(report.status, 'NO_GO');
    assert.ok(report.blockers.includes('staging_foundation:EVIDENCE_METADATA_INVALID'));
  }
});

test('both production gates reject IP literals and reserved example hosts as external proof', () => {
  const rejectedUris = [
    'https://[::ffff:127.0.0.1]/evidence',
    'https://127.0.0.1/evidence',
    'https://10.2.3.4/evidence',
    'https://evidence.localhost/report',
    'https://artifact.invalid/report',
    'https://artifact.example.com/report',
    'https://artifact.internal/report',
  ];
  for (const gate of gateImplementations) {
    for (const uri of rejectedUris) {
      const manifest = validManifest(gate);
      for (const row of Object.values(manifest.checks)) row.evidence[0].uri = uri;
      const report = gate.evaluateProductionReadiness(manifest);
      assert.equal(report.status, 'NO_GO', `${uri} must not count as external production evidence`);
      assert.ok(report.blockers.includes('staging_foundation:EVIDENCE_METADATA_INVALID'));
    }
  }
});

test('production gate CLI consumes the hardened Control Plane implementation', () => {
  const cli = fs.readFileSync(path.join(__dirname, '..', 'scripts/salsa-production-readiness-gate.js'), 'utf8');
  assert.match(cli, /require\('\.\.\/server\/salsa\/control-plane\/operational\/production-readiness-gate'\)/);
});
