'use strict';

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  process.stderr.write('DATABASE_URL is required. Finance V2 migration was not attempted.\n');
  process.exitCode = 2;
} else {
  const migrationPaths = fs.readdirSync(path.join(__dirname, '..', 'server', 'migrations'))
    .filter((name) => /^(?:00[2-9]|0[1-9]\d|[1-9]\d{2})_.*\.sql$/.test(name))
    .sort()
    .map((name) => path.join(__dirname, '..', 'server', 'migrations', name));
  const pool = new Pool({ connectionString, ssl: process.env.DATABASE_SSL === 'false' ? false : undefined });
  (async () => {
    const client = await pool.connect();
    try {
      for (const migrationPath of migrationPaths) await client.query(fs.readFileSync(migrationPath, 'utf8'));
      const result = await client.query(`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = ANY($1::text[])
        ORDER BY table_name
      `, [[
        'finance_events', 'fiscal_periods_v2', 'journal_entries_v2', 'journal_lines_v2',
        'finance_approvals', 'reconciliation_items', 'finance_outbox', 'finance_legacy_archive',
        'finance_inventory_items_v2', 'finance_recipe_ingredients', 'finance_order_item_cost_snapshots',
      ]]);
      process.stdout.write(`${JSON.stringify({ ok: true, migrations: migrationPaths.map((migrationPath) => path.basename(migrationPath)), tables: result.rows.map((row) => row.table_name) }, null, 2)}\n`);
    } catch (error) {
      process.stderr.write(`${error.stack || error.message}\n`);
      process.exitCode = 1;
    } finally {
      client.release();
      await pool.end();
    }
  })();
}
