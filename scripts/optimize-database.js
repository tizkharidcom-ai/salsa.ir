#!/usr/bin/env node
'use strict';

/**
 * Database Optimization & Maintenance Routine
 *
 * Provides deep PostgreSQL performance optimization, catalog statistics refresh,
 * dead tuple/bloat analysis, and automated index optimization for WESTO and NEEM.
 *
 * Capabilities:
 *  1. Catalog Statistics Refresh (ANALYZE / VACUUM ANALYZE)
 *  2. Dead Tuples & Table Bloat Analysis
 *  3. Index Health & Utilization Analysis
 *  4. Missing Foreign Key Index Detection & Safe Index Generation
 *
 * Usage:
 *   node scripts/optimize-database.js [--vacuum] [--apply-indexes] [--json]
 */

const fs = require('node:fs');
const path = require('node:path');

function loadEnvFile(envPath) {
  if (!fs.existsSync(envPath)) return false;
  try {
    const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const equalsIdx = trimmed.indexOf('=');
      if (equalsIdx <= 0) continue;
      const key = trimmed.slice(0, equalsIdx).trim();
      let value = trimmed.slice(equalsIdx + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
    return true;
  } catch (_error) {
    return false;
  }
}

const ROOT_DIR = path.resolve(__dirname, '..');
loadEnvFile(path.join(ROOT_DIR, '.env.local'));
loadEnvFile(path.join(ROOT_DIR, '.env'));

async function getPool(connectionString) {
  const { Pool } = require('pg');
  const pool = new Pool({
    connectionString,
    ssl: process.env.DATABASE_SSL === 'false' ? false : (
      process.env.DATABASE_SSL === 'true' || process.env.NODE_ENV === 'production'
        ? { rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== 'false' }
        : undefined
    ),
    connectionTimeoutMillis: Math.max(1000, Number(process.env.DATABASE_CONNECT_TIMEOUT_MS) || 5000),
  });
  if (typeof pool.on === 'function') {
    pool.on('error', () => {});
  }
  return pool;
}

async function analyzeTables(client, { vacuum = false } = {}) {
  const tablesRes = await client.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name;
  `);

  const results = [];
  for (const row of tablesRes.rows) {
    const table = row.table_name;
    const start = Date.now();
    try {
      const command = vacuum ? `VACUUM ANALYZE "${table}"` : `ANALYZE "${table}"`;
      await client.query(command);
      results.push({ table, ok: true, durationMs: Date.now() - start, action: vacuum ? 'VACUUM ANALYZE' : 'ANALYZE' });
    } catch (err) {
      results.push({ table, ok: false, error: err.message, durationMs: Date.now() - start });
    }
  }
  return results;
}

async function inspectTableStats(client) {
  const query = `
    SELECT
      relname AS table_name,
      n_live_tup AS live_tuples,
      n_dead_tup AS dead_tuples,
      CASE
        WHEN (n_live_tup + n_dead_tup) > 0
        THEN ROUND(100.0 * n_dead_tup / (n_live_tup + n_dead_tup), 2)
        ELSE 0.0
      END AS dead_tuple_ratio,
      last_vacuum,
      last_autovacuum,
      last_analyze,
      last_autoanalyze
    FROM pg_stat_user_tables
    ORDER BY n_dead_tup DESC, relname;
  `;
  const res = await client.query(query);
  return res.rows.map((row) => ({
    tableName: row.table_name,
    liveTuples: Number(row.live_tuples) || 0,
    deadTuples: Number(row.dead_tuples) || 0,
    deadTupleRatioPct: Number(row.dead_tuple_ratio) || 0,
    lastVacuum: row.last_vacuum || row.last_autovacuum || null,
    lastAnalyze: row.last_analyze || row.last_autoanalyze || null,
    needsVacuum: (Number(row.dead_tuples) > 500 && Number(row.dead_tuple_ratio) > 15),
  }));
}

async function inspectIndexStats(client) {
  const query = `
    SELECT
      relname AS table_name,
      indexrelname AS index_name,
      idx_scan AS index_scans,
      idx_tup_read AS tuples_read,
      idx_tup_fetch AS tuples_fetched
    FROM pg_stat_user_indexes
    ORDER BY idx_scan ASC, relname;
  `;
  const res = await client.query(query);
  return res.rows.map((row) => ({
    tableName: row.table_name,
    indexName: row.index_name,
    scans: Number(row.index_scans) || 0,
    tuplesRead: Number(row.tuples_read) || 0,
    tuplesFetched: Number(row.tuples_fetched) || 0,
  }));
}

async function generateMissingFkIndexPlans(client) {
  const query = `
    SELECT
      c.conrelid::regclass::text AS table_name,
      c.conname AS constraint_name,
      pg_get_constraintdef(c.oid) AS definition,
      ARRAY(
        SELECT a.attname
        FROM unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
        ORDER BY k.ord
      ) AS columns
    FROM pg_constraint c
    WHERE c.contype = 'f'
      AND c.connamespace = 'public'::regnamespace
      AND NOT EXISTS (
        SELECT 1
        FROM pg_index i
        WHERE i.indrelid = c.conrelid
          AND i.indkey[0:array_length(c.conkey, 1) - 1] = c.conkey
      )
    ORDER BY table_name, constraint_name;
  `;
  const res = await client.query(query);
  return res.rows.map((row) => {
    let cols = row.columns;
    if (typeof cols === 'string') {
      cols = cols.replace(/^\{|\}$/g, '').split(',').map((s) => s.trim().replace(/^"|"$/g, ''));
    } else if (!Array.isArray(cols)) {
      cols = [];
    }
    const cleanTableName = row.table_name.replace(/[^a-zA-Z0-9_]/g, '');
    const cleanColName = cols.join('_').slice(0, 30).replace(/[^a-zA-Z0-9_]/g, '');
    const indexName = `idx_${cleanTableName}_${cleanColName}`;
    const sql = `CREATE INDEX IF NOT EXISTS "${indexName}" ON "${row.table_name}" (${cols.map((c) => `"${c}"`).join(', ')});`;
    return {
      table: row.table_name,
      constraint: row.constraint_name,
      columns: cols,
      suggestedIndexName: indexName,
      ddl: sql,
    };
  });
}

async function runOptimization(options = {}) {
  const connectionString = options.databaseUrl || process.env.DATABASE_URL;
  if (!connectionString) {
    return {
      ok: false,
      reason: 'database_url_required',
      message: 'No DATABASE_URL configured. Database optimization applies to PostgreSQL storage engines.',
    };
  }

  let pg;
  try {
    pg = require('pg');
  } catch (err) {
    return { ok: false, reason: 'pg_driver_missing', message: 'pg driver not installed.' };
  }

  const pool = await getPool(connectionString);
  const client = await pool.connect();
  try {
    const started = Date.now();

    // 1. Analyze / Vacuum
    const maintenanceResults = await analyzeTables(client, { vacuum: options.vacuum });

    // 2. Table stats & dead tuples
    const tableStats = await inspectTableStats(client);

    // 3. Index stats
    const indexStats = await inspectIndexStats(client);

    // 4. Missing foreign key indexes
    const missingFkIndexes = await generateMissingFkIndexPlans(client);

    // If apply-indexes is requested
    const appliedIndexes = [];
    if (options.applyIndexes && missingFkIndexes.length > 0) {
      for (const item of missingFkIndexes) {
        try {
          await client.query(item.ddl);
          appliedIndexes.push({ table: item.table, index: item.suggestedIndexName, ok: true });
        } catch (err) {
          appliedIndexes.push({ table: item.table, index: item.suggestedIndexName, ok: false, error: err.message });
        }
      }
    }

    return {
      ok: true,
      durationMs: Date.now() - started,
      maintenance: {
        totalTablesOptimized: maintenanceResults.filter((r) => r.ok).length,
        failedTables: maintenanceResults.filter((r) => !r.ok),
      },
      tableStatistics: {
        totalTables: tableStats.length,
        tablesNeedingVacuum: tableStats.filter((t) => t.needsVacuum),
        topTablesByDeadTuples: tableStats.slice(0, 5),
      },
      indexOptimization: {
        totalIndexes: indexStats.length,
        missingForeignKeyIndexesCount: missingFkIndexes.length,
        missingForeignKeyIndexes: missingFkIndexes,
        appliedIndexes,
      },
    };
  } finally {
    client.release();
    await pool.end().catch(() => {});
  }
}

function formatOptimizationConsoleOutput(report) {
  const chalk = {
    cyan: (s) => `\x1b[36m${s}\x1b[0m`,
    green: (s) => `\x1b[32m${s}\x1b[0m`,
    yellow: (s) => `\x1b[33m${s}\x1b[0m`,
    red: (s) => `\x1b[31m${s}\x1b[0m`,
    bold: (s) => `\x1b[1m${s}\x1b[0m`,
  };

  console.log(chalk.bold('\n========================================================================'));
  console.log(chalk.cyan('             WESTO DATABASE MAINTENANCE & OPTIMIZATION REPORT          '));
  console.log(chalk.bold('========================================================================'));

  if (!report.ok) {
    console.log(chalk.yellow(`Status: Skipped (${report.reason})`));
    console.log(`Notice: ${report.message}\n`);
    return;
  }

  console.log(`Execution Time:     ${report.durationMs} ms`);
  console.log(`Tables Analyzed:    ${chalk.green(report.maintenance.totalTablesOptimized)} tables refreshed`);

  if (report.maintenance.failedTables.length > 0) {
    console.log(chalk.red(`Failed Tables:      ${report.maintenance.failedTables.map((f) => f.table).join(', ')}`));
  }

  console.log('\n--- Table Bloat & Dead Tuple Health ---');
  if (report.tableStatistics.tablesNeedingVacuum.length === 0) {
    console.log(chalk.green('✓ All tables healthy (no significant dead tuple bloat detected)'));
  } else {
    for (const t of report.tableStatistics.tablesNeedingVacuum) {
      console.log(chalk.yellow(`! Table "${t.tableName}": ${t.deadTuples} dead tuples (${t.deadTupleRatioPct}%) -> VACUUM recommended`));
    }
  }

  console.log('\n--- Foreign Key Index Optimization ---');
  const fkCount = report.indexOptimization.missingForeignKeyIndexesCount;
  if (fkCount === 0) {
    console.log(chalk.green('✓ All foreign key relationships have index coverage'));
  } else {
    console.log(chalk.yellow(`! Identified ${fkCount} foreign key constraint(s) without covering index`));
    console.log('Sample Index Recommendations:');
    for (const rec of report.indexOptimization.missingForeignKeyIndexes.slice(0, 5)) {
      console.log(`  ${chalk.cyan(rec.ddl)}`);
    }
    if (fkCount > 5) {
      console.log(`  ... and ${fkCount - 5} more. Run with --apply-indexes to automatically create them.`);
    }
  }

  if (report.indexOptimization.appliedIndexes.length > 0) {
    console.log(chalk.green(`\n✓ Successfully applied ${report.indexOptimization.appliedIndexes.length} missing indexes!`));
  }

  console.log(chalk.bold('========================================================================\n'));
}

async function main() {
  const args = process.argv.slice(2);
  const isJson = args.includes('--json');
  const vacuum = args.includes('--vacuum');
  const applyIndexes = args.includes('--apply-indexes');

  const report = await runOptimization({ vacuum, applyIndexes });

  if (isJson) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    formatOptimizationConsoleOutput(report);
  }

  process.exitCode = report.ok ? 0 : 1;
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Fatal optimization error:', err);
    process.exit(2);
  });
}

module.exports = {
  runOptimization,
  analyzeTables,
  inspectTableStats,
  inspectIndexStats,
  generateMissingFkIndexPlans,
};
