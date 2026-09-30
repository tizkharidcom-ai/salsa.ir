'use strict';

function safeReason(value) {
  const reason = String(value || '').trim();
  return /^[A-Za-z0-9_.-]{1,80}$/.test(reason) ? reason : null;
}

function runtimeReadiness({
  nodeEnv = 'development',
  postgresEnabled = false,
  postgresRequired = false,
  databasePing = null,
  financeStatus = null,
  settlementGate = null,
} = {}) {
  const production = String(nodeEnv) === 'production';
  const checks = {
    postgresAuthority: {
      ok: postgresEnabled === true && postgresRequired === true,
      required: production,
      reason: postgresEnabled !== true
        ? 'postgres_disabled'
        : postgresRequired !== true ? 'postgres_not_authoritative' : null,
    },
    databaseConnection: {
      ok: databasePing?.ok === true,
      required: production,
      reason: databasePing?.ok === true ? null : safeReason(databasePing?.code || databasePing?.reason) || 'database_unavailable',
    },
    financeSchema: {
      ok: financeStatus?.available === true,
      required: production,
      reason: financeStatus?.available === true ? null : safeReason(financeStatus?.reason) || 'finance_schema_unavailable',
    },
    settlementWrites: {
      ok: settlementGate?.ok === true,
      required: production,
      reason: settlementGate?.ok === true ? null : safeReason(settlementGate?.code) || 'settlement_not_ready',
    },
  };
  const ready = !production || Object.values(checks).every((check) => check.ok);
  return {
    ok: ready,
    status: ready ? 'ready' : 'not_ready',
    environment: production ? 'production' : 'non_production',
    checks,
  };
}

module.exports = { runtimeReadiness };
