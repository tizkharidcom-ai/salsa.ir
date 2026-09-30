'use strict';

// The Control Plane must never report a usable service while its own schema is
// absent or behind the code that is about to serve requests. This check is
// intentionally separate from the WESTO Finance preflight: the two databases
// have different ownership, migration ledgers, and failure domains.

const { loadMigrations } = require('./migration-runner');

const REQUIRED_MIGRATIONS = Object.freeze(
  loadMigrations().map((migration) => migration.version)
);

const REQUIRED_TABLES = Object.freeze([
  'neem_control_migrations',
  'neem_tenants',
  'neem_platform_principals',
  'neem_platform_mfa_challenges',
  'neem_platform_kill_switches',
  'neem_billing_plan_versions',
  'neem_billing_plan_operations',
  'neem_control_audit_events',
  'neem_releases',
  'neem_rollout_waves',
  'neem_incidents',
  'neem_automation_outbox',
  'neem_audit_export_cursors',
  'neem_support_session_approvals',
  'neem_support_approval_rate_limits'
]);

function createReadinessError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

async function inspectControlPlaneDatabase(db) {
  if (!db || typeof db.query !== 'function') {
    throw createReadinessError(
      'CONTROL_PLANE_DATABASE_UNAVAILABLE',
      'Control Plane database adapter is unavailable.'
    );
  }

  let registration;
  try {
    registration = await db.query(`
      SELECT
        current_database() AS database_name,
        current_schema() AS schema_name,
        to_regclass('public.neem_control_migrations') AS migration_table,
        to_regclass('public.neem_tenants') AS tenants_table,
        to_regclass('public.neem_platform_principals') AS principals_table,
        to_regclass('public.neem_platform_mfa_challenges') AS mfa_challenges_table,
        to_regclass('public.neem_platform_kill_switches') AS kill_switches_table,
        to_regclass('public.neem_billing_plan_versions') AS billing_plan_versions_table,
        to_regclass('public.neem_billing_plan_operations') AS billing_plan_operations_table,
        to_regclass('public.neem_control_audit_events') AS audit_table,
        to_regclass('public.neem_releases') AS releases_table,
        to_regclass('public.neem_rollout_waves') AS rollout_waves_table,
        to_regclass('public.neem_incidents') AS incidents_table,
        to_regclass('public.neem_automation_outbox') AS outbox_table,
        to_regclass('public.neem_audit_export_cursors') AS siem_cursor_table,
        to_regclass('public.neem_support_session_approvals') AS support_approval_table,
        to_regclass('public.neem_support_approval_rate_limits') AS support_approval_rate_limit_table
    `);
  } catch (error) {
    throw createReadinessError(
      'CONTROL_PLANE_DATABASE_UNREACHABLE',
      `Control Plane database readiness query failed: ${error.message}`
    );
  }

  const registrationRow = registration.rows?.[0] || {};
  const tableNames = {
    neem_control_migrations: registrationRow.migration_table,
    neem_tenants: registrationRow.tenants_table,
    neem_platform_principals: registrationRow.principals_table,
    neem_platform_mfa_challenges: registrationRow.mfa_challenges_table,
    neem_platform_kill_switches: registrationRow.kill_switches_table,
    neem_billing_plan_versions: registrationRow.billing_plan_versions_table,
    neem_billing_plan_operations: registrationRow.billing_plan_operations_table,
    neem_control_audit_events: registrationRow.audit_table,
    neem_releases: registrationRow.releases_table,
    neem_rollout_waves: registrationRow.rollout_waves_table,
    neem_incidents: registrationRow.incidents_table,
    neem_automation_outbox: registrationRow.outbox_table,
    neem_audit_export_cursors: registrationRow.siem_cursor_table,
    neem_support_session_approvals: registrationRow.support_approval_table,
    neem_support_approval_rate_limits: registrationRow.support_approval_rate_limit_table
  };
  const missingTables = REQUIRED_TABLES.filter((table) => !tableNames[table]);

  let appliedVersions = [];
  if (!missingTables.includes('neem_control_migrations')) {
    try {
      const migrations = await db.query(
        'SELECT version FROM neem_control_migrations ORDER BY version'
      );
      appliedVersions = migrations.rows
        .map((row) => String(row.version || '').padStart(3, '0'))
        .filter(Boolean);
    } catch (error) {
      throw createReadinessError(
        'CONTROL_PLANE_MIGRATION_LEDGER_UNREADABLE',
        `Control Plane migration ledger query failed: ${error.message}`
      );
    }
  }

  const missingMigrations = REQUIRED_MIGRATIONS.filter(
    (version) => !appliedVersions.includes(version)
  );
  const ready = missingTables.length === 0 && missingMigrations.length === 0;

  return {
    ready,
    databaseName: registrationRow.database_name || null,
    schemaName: registrationRow.schema_name || null,
    requiredTables: [...REQUIRED_TABLES],
    missingTables,
    requiredMigrations: [...REQUIRED_MIGRATIONS],
    appliedVersions,
    missingMigrations
  };
}

async function assertControlPlaneDatabaseReady(db) {
  const result = await inspectControlPlaneDatabase(db);
  if (!result.ready) {
    throw createReadinessError(
      'CONTROL_PLANE_SCHEMA_NOT_READY',
      'FAIL-CLOSED: Control Plane database schema is missing or behind the required migration set.',
      result
    );
  }
  return result;
}

module.exports = {
  REQUIRED_MIGRATIONS,
  REQUIRED_TABLES,
  inspectControlPlaneDatabase,
  assertControlPlaneDatabaseReady
};
