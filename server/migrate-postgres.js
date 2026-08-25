#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { createPostgresStateStore, reconciliationSummary } = require('./postgres-state');

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required. No data was changed.');
  }
  const dbPath = process.env.WESTO_DB_PATH || path.join(__dirname, 'data', 'db.json');
  const state = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
  const store = createPostgresStateStore();
  try {
    await store.write(state);
    const before = reconciliationSummary(state);
    const hydrated = await store.hydrate({});
    const after = reconciliationSummary(hydrated.state);
    const matched = JSON.stringify(before) === JSON.stringify(after);
    if (!matched) throw new Error('PostgreSQL reconciliation mismatch; no cutover should be performed.');
    console.log(JSON.stringify({ ok: true, source: dbPath, reconciliation: { matched, before, after } }, null, 2));
  } finally {
    await store.close();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
