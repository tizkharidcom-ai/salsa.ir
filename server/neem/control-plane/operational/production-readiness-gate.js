'use strict';

const REQUIRED_GATE_IDS = Object.freeze([
  'staging_foundation',
  'finance_and_provider',
  'outbox_and_edge_ack',
  'pitr_and_restore',
  'release_registry_and_canary',
  'load_cost_and_pilot'
]);

const REQUIRED_APPROVAL_ROLES = Object.freeze(['product', 'security', 'finance', 'sre']);
const FORBIDDEN_EVIDENCE_SOURCES = /(?:^|[\s._:/-])(local|disposable|mock|fixture|harness|prototype)(?:$|[\s._:/-])/i;
const REQUIRED_GATE_ASSERTIONS = Object.freeze({
  staging_foundation: Object.freeze(['migration_plan', 'tenant_isolation', 'secrets_and_object_storage', 'backup_restore', 'restart_recovery']),
  finance_and_provider: Object.freeze(['provider_callback', 'ledger_reconciliation', 'tax_and_settlement', 'operational_data', 'audit_trace']),
  outbox_and_edge_ack: Object.freeze(['signed_ack', 'exactly_once_effect', 'dlq_replay', 'edge_print_or_kds', 'crash_reconciliation']),
  pitr_and_restore: Object.freeze(['wal_chain', 'target_time_restore', 'peer_isolation', 'reconciliation', 'rpo_rto']),
  release_registry_and_canary: Object.freeze(['artifact_digest_signature', 'edge_compatibility', 'cohort_progression', 'rollback_fencing', 'incident_audit']),
  load_cost_and_pilot: Object.freeze(['staged_load', 'latency_error_budget', 'cost_per_tenant', 'failure_isolation', 'pilot_rollback'])
});

function failure(id, reason, details = {}) {
  return { id, status: 'blocked', reason, ...details };
}

function normalizeEvidence(row) {
  if (!Array.isArray(row?.evidence)) return [];
  return row.evidence.filter((item) => item && typeof item === 'object');
}

function isEvidenceUri(value) {
  try {
    const parsed = new URL(String(value || '').trim());
    if (parsed.protocol !== 'https:' && parsed.protocol !== 's3:') return false;
    const hostname = String(parsed.hostname || '').replace(/^\[|\]$/g, '').toLowerCase();
    if (!hostname) return false;
    const isIpv6Literal = hostname.includes(':');
    if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local') ||
        (isIpv6Literal && (hostname === '::1' || hostname.startsWith('fc') || hostname.startsWith('fd') || hostname.startsWith('fe80:')))) {
      return false;
    }
    const octets = hostname.split('.').map((part) => Number(part));
    if (octets.length === 4 && octets.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)) {
      const [first, second] = octets;
      if (first === 10 || first === 127 || (first === 169 && second === 254) ||
          (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168)) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

function isValidTimestamp(value) {
  const normalized = String(value || '').trim();
  return Boolean(normalized) && Number.isFinite(Date.parse(normalized));
}

function isSha256(value) {
  return /^[0-9a-f]{64}$/i.test(String(value || '').trim());
}

function isValidStopRules(stopRules) {
  if (!stopRules || typeof stopRules !== 'object' || Array.isArray(stopRules)) return false;
  const errorBudgetPct = stopRules.errorBudgetPct;
  const ackMinimumPct = stopRules.ackMinimumPct;
  return typeof errorBudgetPct === 'number' && Number.isFinite(errorBudgetPct) &&
    errorBudgetPct >= 0 && errorBudgetPct <= 100 &&
    typeof ackMinimumPct === 'number' && Number.isFinite(ackMinimumPct) &&
    ackMinimumPct > 0 && ackMinimumPct <= 100;
}

function validateEvidence(gateId, row) {
  const evidence = normalizeEvidence(row);
  if (evidence.length === 0) return failure(gateId, 'EVIDENCE_REQUIRED');
  const invalid = evidence.find((item) => {
    const source = String(item.source || '').trim();
    return !source || FORBIDDEN_EVIDENCE_SOURCES.test(source) || !isEvidenceUri(item.uri) ||
      !isValidTimestamp(item.capturedAt) || !String(item.actor || '').trim() || !isSha256(item.artifactDigest);
  });
  if (invalid) {
    return failure(gateId, 'EVIDENCE_METADATA_INVALID', {
      required: ['source', 'uri', 'capturedAt', 'actor', 'artifactDigest'],
      forbiddenSources: ['local', 'disposable', 'mock', 'fixture', 'harness', 'prototype']
    });
  }
  return { id: gateId, status: 'passed', evidenceCount: evidence.length };
}

function validateGateAssertions(gateId, row) {
  const required = REQUIRED_GATE_ASSERTIONS[gateId] || [];
  const assertions = row?.assertions && typeof row.assertions === 'object' && !Array.isArray(row.assertions)
    ? row.assertions
    : {};
  const missing = required.filter((key) => assertions[key] !== true);
  if (missing.length > 0) {
    return failure(gateId, 'REQUIRED_ASSERTIONS_MISSING', { required, missing });
  }
  return null;
}

function evaluateProductionReadiness(manifest, { target = 'production', expectedReleaseId = null } = {}) {
  const report = {
    ok: false,
    status: 'NO_GO',
    target,
    evaluatedAt: new Date().toISOString(),
    gates: [],
    approvals: [],
    blockers: []
  };

  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    report.blockers.push('PRODUCTION_GATE_MANIFEST_REQUIRED');
    report.gates = REQUIRED_GATE_IDS.map((id) => failure(id, 'MANIFEST_MISSING'));
    return report;
  }
  if (manifest.schemaVersion !== 1) report.blockers.push('MANIFEST_SCHEMA_VERSION_INVALID');
  if (String(manifest.environment || '').trim() !== target) {
    report.blockers.push('MANIFEST_ENVIRONMENT_MISMATCH');
  }
  if (!String(manifest.releaseId || '').trim()) report.blockers.push('RELEASE_ID_REQUIRED');
  if (expectedReleaseId && String(manifest.releaseId || '').trim() !== String(expectedReleaseId).trim()) {
    report.blockers.push('RELEASE_ID_MISMATCH');
  }
  if (!String(manifest.rollbackPlan || '').trim()) report.blockers.push('ROLLBACK_PLAN_REQUIRED');
  if (!isValidStopRules(manifest.stopRules)) {
    report.blockers.push('STOP_RULES_INVALID');
  }

  const checks = manifest.checks && typeof manifest.checks === 'object' && !Array.isArray(manifest.checks)
    ? manifest.checks
    : {};
  report.gates = REQUIRED_GATE_IDS.map((id) => {
    const row = checks[id];
    if (!row || row.status !== 'passed') return failure(id, 'GATE_NOT_PASSED', { observed: row?.status || 'missing' });
    const assertionFailure = validateGateAssertions(id, row);
    if (assertionFailure) return assertionFailure;
    return validateEvidence(id, row);
  });
  for (const gate of report.gates) {
    if (gate.status !== 'passed') report.blockers.push(`${gate.id}:${gate.reason}`);
  }

  const approvals = Array.isArray(manifest.approvals) ? manifest.approvals : [];
  report.approvals = REQUIRED_APPROVAL_ROLES.map((role) => {
    const approval = approvals.find((item) => item?.role === role && item?.status === 'approved' &&
      String(item.actor || '').trim() && isValidTimestamp(item.approvedAt));
    return approval
      ? { role, status: 'approved', actor: approval.actor || null, approvedAt: approval.approvedAt || null }
      : { role, status: 'missing' };
  });
  for (const approval of report.approvals) {
    if (approval.status !== 'approved') report.blockers.push(`approval:${approval.role}`);
  }

  if (report.blockers.length === 0) {
    report.ok = true;
    report.status = 'GO';
  }
  return report;
}

module.exports = {
  REQUIRED_GATE_IDS,
  REQUIRED_APPROVAL_ROLES,
  REQUIRED_GATE_ASSERTIONS,
  evaluateProductionReadiness
};
