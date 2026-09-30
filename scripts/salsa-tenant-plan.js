#!/usr/bin/env node
'use strict';

/*
 * Read-only NEEM tenant-cell planner.
 *
 * This command does not create databases, DNS records, users, backups, or
 * certificates. It turns the environment into a safe, reviewable checklist
 * before a tenant is provisioned or moved to production.
 */
const fs = require('fs');
const path = require('path');
const { loadTenantConfig } = require('../server/salsa/tenant-config');

const strict = process.argv.includes('--strict');
const config = loadTenantConfig();
const root = path.resolve(__dirname, '..');

function present(name) {
  const alt = name.startsWith('SALSA_') ? name.replace('SALSA_', 'NEEM_') : (name.startsWith('NEEM_') ? name.replace('NEEM_', 'SALSA_') : name);
  return String(process.env[name] || process.env[alt] || '').trim().length > 0;
}

function validDatabaseUrl() {
  if (!present('DATABASE_URL')) return false;
  try {
    const url = new URL(process.env.DATABASE_URL);
    return ['postgres:', 'postgresql:'].includes(url.protocol) && Boolean(url.pathname.replace(/^\//, ''));
  } catch {
    return false;
  }
}

function check(id, ok, message, severity = 'required') {
  return { id, ok: Boolean(ok), severity, message };
}

const checks = [
  check('tenant_id', present('SALSA_TENANT_ID'), 'SALSA_TENANT_ID (or NEEM_TENANT_ID) must be explicitly set for a production cell.'),
  check('tenant_hosts', present('SALSA_TENANT_HOSTS'), 'SALSA_TENANT_HOSTS (or NEEM_TENANT_HOSTS) must list every accepted public hostname.'),
  check('canonical_domain', present('SALSA_CANONICAL_DOMAIN'), 'SALSA_CANONICAL_DOMAIN (or NEEM_CANONICAL_DOMAIN) must be explicit and verified in DNS.'),
  check('cell_id', present('SALSA_CELL_ID'), 'SALSA_CELL_ID (or NEEM_CELL_ID) must identify the Iranian hosting cell.'),
  check('database_url', validDatabaseUrl(), 'DATABASE_URL must be a valid PostgreSQL URL for this tenant\'s dedicated database.'),
  check('domain_coherence', config.hosts.includes(config.canonicalDomain), 'Canonical domain must also be present in tenant hosts.'),
  check('tenant_database_mode', config.multiTenant && config.requireMetadata, 'Multi-tenant mode and require metadata must both be true before production cutover.'),
  check('postgres_required', process.env.WESTO_POSTGRES_REQUIRED === 'true', 'WESTO_POSTGRES_REQUIRED must be true so a database outage cannot restore JSON as authority.'),
  check('json_not_authority', process.env.WESTO_JSON_RECOVERY_SNAPSHOT !== 'true', 'WESTO_JSON_RECOVERY_SNAPSHOT must not be true in production; retain snapshots through the backup workflow.'),
  check('host_guard', config.enforceHost, 'Enforce tenant host must be true to reject a request sent to another tenant host.'),
  check('iranian_runtime_only', process.env.SALSA_ALLOW_FOREIGN_RUNTIME !== 'true' && process.env.NEEM_ALLOW_FOREIGN_RUNTIME !== 'true', 'Runtime policy must remain false for the Iranian-only policy.'),
  check('bridge_url', present('SALSA_BRIDGE_URL'), 'SALSA_BRIDGE_URL must point to the internal SALSA control-plane receiver.', 'recommended'),
  check('bridge_secret', present('WESTO_SALSA_BRIDGE_SECRET') || present('WESTO_NEEM_BRIDGE_SECRET'), 'WESTO_SALSA_BRIDGE_SECRET must be present for signed control-plane sync.', 'recommended'),
  check('control_schema', fs.existsSync(path.join(root, 'server', 'salsa', 'control-plane-schema.sql')), 'The control-plane schema file must be present in the release.'),
];

const requiredFailures = checks.filter((item) => !item.ok && item.severity === 'required');
const recommendedFailures = checks.filter((item) => !item.ok && item.severity === 'recommended');

const result = {
  ok: requiredFailures.length === 0 && (!strict || recommendedFailures.length === 0),
  readOnly: true,
  mode: strict ? 'strict-production-preflight' : 'planning',
  tenant: {
    tenantId: config.tenantId,
    tenantSlug: config.tenantSlug,
    displayName: config.displayName,
    canonicalDomain: config.canonicalDomain,
    hosts: config.hosts,
    cellId: config.cellId,
    release: config.release,
    runtimeMode: config.mode,
    storageMode: 'database-per-tenant',
  },
  connections: {
    databaseConfigured: present('DATABASE_URL'),
    bridgeConfigured: present('WESTO_NEEM_BRIDGE_SECRET') && present('NEEM_BRIDGE_URL'),
    secretsIncluded: false,
  },
  checks,
  summary: {
    requiredFailures: requiredFailures.length,
    recommendedFailures: recommendedFailures.length,
    nextStep: requiredFailures.length || (strict && recommendedFailures.length)
      ? 'Resolve the checklist and rerun this command before provisioning or cutover.'
      : 'This checklist is internally consistent; database connectivity, DNS, backup restore, and browser smoke tests still need separate verification.',
  },
};

console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exitCode = 2;
