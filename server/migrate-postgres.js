#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { createPostgresStateStore, reconciliationSummary } = require('./postgres-state');
const { loadTenantConfig } = require('./salsa/tenant-config');

async function migrateState({ dbPath, store }) {
  const state = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
  // Prime the store's optimistic-lock version before replacing the staged
  // snapshot. Calling write() on a fresh store skips loadedVersion and
  // therefore treats an already existing westo_state row as a concurrent
  // writer even when this command is the only importer running.
  await store.hydrate({});
  await store.write(state);
  const before = reconciliationSummary(state);
  const hydrated = await store.hydrate({});
  const after = reconciliationSummary(hydrated.state);
  const matched = JSON.stringify(before) === JSON.stringify(after);
  if (!matched) throw new Error('PostgreSQL reconciliation mismatch; no cutover should be performed.');
  return { ok: true, source: dbPath, reconciliation: { matched, before, after } };
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required. No data was changed.');
  }
  const dbPath = process.env.WESTO_DB_PATH || path.join(__dirname, 'data', 'db.json');
  const tenantConfig = loadTenantConfig();
  const store = createPostgresStateStore({
    tenantConfig,
    requireTenantMetadata: tenantConfig.requireMetadata,
    required: process.env.WESTO_POSTGRES_REQUIRED === 'true'
      || tenantConfig.multiTenant
      || tenantConfig.requireMetadata,
  });
  try {
    const result = await migrateState({ dbPath, store });
    console.log(JSON.stringify({ ...result, tenant: {
      tenantId: tenantConfig.tenantId,
      canonicalDomain: tenantConfig.canonicalDomain,
      cellId: tenantConfig.cellId,
    } }, null, 2));
  } finally {
    await store.close();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { migrateState };
