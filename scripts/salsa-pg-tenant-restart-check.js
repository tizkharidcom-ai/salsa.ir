'use strict';

/**
 * Post-restart persistence gate for D6.
 *
 * This probe only targets the exact tenant databases supplied in
 * NEEM_RESTART_DB_NAMES. It requires an explicit confirmation because it
 * writes one sentinel row per database and deletes it before completion.
 */

const assert = require('node:assert/strict');

const CONFIRMATION = 'RUN_NEEM_TENANT_PG_RESTART_CHECK';

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function databaseNames() {
  const names = requireEnv('NEEM_RESTART_DB_NAMES')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (!names.length || names.some((name) => !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name))) {
    throw new Error('NEEM_RESTART_DB_NAMES must contain one or more safe PostgreSQL database names.');
  }
  return names;
}

async function main() {
  if (process.env.NEEM_TENANT_PG_RESTART_CONFIRM !== CONFIRMATION) {
    throw new Error(`Refusing to mutate PostgreSQL without NEEM_TENANT_PG_RESTART_CONFIRM=${CONFIRMATION}.`);
  }

  const dataUrl = requireEnv('NEEM_TENANT_DB_POSTGRES_URL');
  const { Client } = require('pg');
  const dataTemplateUrl = new URL(dataUrl);
  const expectedUser = decodeURIComponent(dataTemplateUrl.username || '');
  if (!expectedUser) throw new Error('NEEM_TENANT_DB_POSTGRES_URL must include the runtime role username.');

  const checks = [];
  const record = (name, passed, details = null) => {
    checks.push({ name, passed, details: passed ? 'ok' : details });
    assert.equal(passed, true, name);
  };

  for (const databaseName of databaseNames()) {
    const dbUrl = new URL(dataUrl);
    dbUrl.pathname = `/${databaseName}`;
    const client = new Client({ connectionString: dbUrl.toString() });
    await client.connect();
    const sentinelId = `restart_${databaseName}`;

    try {
      const identity = await client.query(
        `SELECT current_user, current_database(), has_database_privilege(current_user, current_database(), 'CREATE') AS can_create_database`
      );
      const table = await client.query(`SELECT to_regclass('public.tenant_orders') AS table_name`);
      const before = await client.query('SELECT count(*)::int AS count FROM tenant_orders');
      record(`${databaseName}: runtime role survived restart`, identity.rows[0]?.current_user === expectedUser, identity.rows[0]);
      record(`${databaseName}: runtime role cannot create databases`, identity.rows[0]?.can_create_database === false, identity.rows[0]);
      record(`${databaseName}: tenant schema survived restart`, table.rows[0]?.table_name === 'tenant_orders', table.rows[0]);
      record(`${databaseName}: zero-data survived restart`, before.rows[0]?.count === 0, before.rows[0]);

      await client.query(
        `INSERT INTO tenant_orders (id, order_number, status, total_amount_cents) VALUES ($1, $2, $3, $4)`,
        [sentinelId, sentinelId, 'paid', 333]
      );
      const read = await client.query('SELECT id FROM tenant_orders WHERE id = $1', [sentinelId]);
      record(`${databaseName}: runtime role can write/read after restart`, read.rows.length === 1 && read.rows[0].id === sentinelId, read.rows);
    } finally {
      await client.query('DELETE FROM tenant_orders WHERE id = $1', [sentinelId]).catch(() => {});
      const after = await client.query('SELECT count(*)::int AS count FROM tenant_orders').catch(() => ({ rows: [] }));
      record(`${databaseName}: sentinel cleanup returned to zero-data`, after.rows[0]?.count === 0, after.rows[0]);
      await client.end().catch(() => {});
    }
  }

  console.log(JSON.stringify({ ok: true, checks }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});

