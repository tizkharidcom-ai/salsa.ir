'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const financeV2 = require('../server/finance-v2');
const { classifyLegacyFinance } = require('../server/finance/legacy-classifier');
const { reconciliationSummary } = require('../server/postgres-state');
const { normalizedSchemaAvailable } = require('../server/finance-postgres-repository');
const { buildCutoverRunbook } = require('../server/finance/cutover-runbook');
const { discoverMigrations, buildMigrationPlan, readAppliedMigrations } = require('./migrate-finance-v2-postgres');

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function financeCounts(state = {}) {
  const count = (name) => Array.isArray(state[name]) ? state[name].length : 0;
  return {
    periods: count('fiscalPeriods'), events: count('events'), payments: count('payments'), refunds: count('refunds'),
    journals: count('journalEntries'), approvals: count('approvals'), reconciliations: count('reconciliationItems'),
    purchaseOrders: count('purchaseOrders'), goodsReceipts: count('goodsReceipts'), vendorInvoices: count('vendorInvoices'),
    inventoryMovements: count('inventoryMovements'), costSnapshots: count('orderItemCostSnapshots'),
    costCommitments: count('costCommitments'), fixedAssets: count('fixedAssets'), payrollRuns: count('payrollRuns'),
    openingBalanceBatches: count('openingBalanceBatches'), branchRollouts: count('branchRollouts'), migrationBaselines: count('migrationBaselines'), legacyArchive: count('legacyArchive'),
  };
}

function buildSourceEvidence(raw, sourcePath) {
  const db = JSON.parse(raw.toString('utf8'));
  const classified = classifyLegacyFinance(db, { analyzeSale: financeV2.salesLines });
  const verified = classified.rows.filter((row) => row.trustStatus === 'verified');
  const inferred = classified.rows.filter((row) => row.trustStatus === 'inferred_needs_approval');
  const quarantined = classified.rows.filter((row) => row.trustStatus === 'quarantined');
  const quality = financeV2.dataQuality(db, 1);
  const migration = financeV2.legacyMigrationReadiness(db, 1);
  return {
    db,
    evidence: {
      path: sourcePath,
      bytes: raw.length,
      sha256: sha256(raw),
      reconciliation: reconciliationSummary(db),
      financeCounts: financeCounts(db.financeV2),
      migrationTrust: {
        classifiedRecords: verified.length + inferred.length + quarantined.length,
        paidOrders: verified.length + inferred.length,
        verifiedOrders: verified.length,
        needsEvidenceOrders: inferred.length,
        quarantinedRecords: quarantined.length,
        baselinePresent: Boolean(migration.baseline),
        baselineRecords: migration.expectedRecords,
        archivedBaselineRecords: migration.archivedRecords,
        missingArchiveRecords: migration.missingArchiveRecords,
        archiveSnapshotMismatches: migration.archiveSnapshotMismatches,
        newUnscopedRecords: migration.newUnscopedRecords,
        unresolvedMigrationRecords: migration.unresolvedRecords,
        historicalEvidenceComplete: migration.status === 'complete',
        baseline: migration.baseline ? {
          id: migration.baseline.id,
          branchId: migration.baseline.branchId,
          status: migration.baseline.status,
          sourceCount: migration.baseline.sourceCount,
          sourceKeys: migration.baseline.sourceKeys,
          sourceFingerprints: migration.baseline.sourceFingerprints,
          sourceSha256: migration.baseline.sourceSha256,
        } : null,
      },
      dataQualityIssues: quality.issues.map((issue) => ({ code: issue.code, severity: issue.severity, count: issue.count ?? null, amountIrr: issue.amountIrr ?? null })),
    },
  };
}

function compareSummaries(source, destination) {
  const keys = [...new Set([...Object.keys(source || {}), ...Object.keys(destination || {})])].sort();
  return keys.map((key) => ({ key, source: source?.[key] ?? null, destination: destination?.[key] ?? null }))
    .filter((row) => row.source !== row.destination);
}

function legacySourceFingerprint(row) {
  // PostgreSQL returns BIGINT values as strings and nullable columns as
  // `null`, while the JSON source uses numbers and explicit nulls. Normalize
  // both representations before hashing; otherwise a faithful archive is
  // falsely reported as a fingerprint mismatch (and blocks cutover).
  const value = (snake, camel) => Object.hasOwn(row, snake) ? row[snake] : row[camel];
  const branch = value('branch_id', 'branchId');
  const amount = value('amount_irr', 'amountIrr');
  const occurred = value('occurred_at', 'occurredAt');
  const normalizedOccurred = occurred == null ? null : occurred instanceof Date ? occurred.toISOString() : occurred;
  return sha256(canonicalJson({
    sourceTable: value('source_table', 'sourceTable'),
    sourceId: String(value('source_id', 'sourceId')),
    trustStatus: value('trust_status', 'trustStatus'),
    reason: row.reason,
    sourcePayload: value('source_payload', 'sourcePayload'),
    branchId: branch == null ? null : Number(branch),
    amountIrr: amount == null ? null : Number(amount),
    occurredAt: normalizedOccurred,
    classificationDetails: value('classification_details', 'classificationDetails') ?? {},
  }));
}

async function inspectDestination(pool, branchId = 1) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const identity = await client.query('SELECT current_database() AS database_name, current_setting(\'server_version\') AS server_version');
    const relations = await client.query(`SELECT
      to_regclass('public.westo_state') AS westo_state,
      to_regclass('public.unified_journal_entries') AS unified_journals,
      to_regclass('public.journal_entries_v2') AS journals,
      to_regclass('public.journal_lines_v2') AS journal_lines,
      to_regclass('public.fiscal_periods_v2') AS periods,
      to_regclass('public.finance_schema_migrations') AS migration_ledger`);
    const relation = relations.rows?.[0] || {};
    const normalized = await normalizedSchemaAvailable(client);
    const appliedRows = await readAppliedMigrations(client);
    const migrationPlan = buildMigrationPlan(discoverMigrations(), appliedRows).map(({ path: ignoredPath, sql: ignoredSql, ...row }) => row);

    let snapshot = { present: false, version: null, updatedAt: null, canonicalSha256: null, reconciliation: null };
    if (relation.westo_state) {
      const stored = await client.query('SELECT data,version,updated_at FROM westo_state WHERE id=1');
      if (stored.rowCount) {
        const data = stored.rows[0].data || {};
        snapshot = {
          present: true,
          version: Number(stored.rows[0].version),
          updatedAt: stored.rows[0].updated_at,
          canonicalSha256: sha256(canonicalJson(data)),
          reconciliation: reconciliationSummary(data),
        };
      }
    }

    let normalizedCounts = null;
    let ledger = null;
    let migrationEvidence = null;
    if (normalized) {
      const counts = await client.query(`SELECT
        (SELECT COUNT(*) FROM finance_events)::int AS events,
        (SELECT COUNT(*) FROM journal_entries_v2)::int AS journals,
        (SELECT COUNT(*) FROM journal_lines_v2)::int AS journal_lines,
        (SELECT COUNT(*) FROM finance_payments)::int AS payments,
        (SELECT COUNT(*) FROM finance_approvals)::int AS approvals,
        (SELECT COUNT(*) FROM reconciliation_items)::int AS reconciliations,
        (SELECT COUNT(*) FROM finance_legacy_archive)::int AS legacy_archive,
        (SELECT COUNT(*) FROM finance_opening_balance_batches)::int AS opening_balances,
        (SELECT COUNT(*) FROM finance_branch_rollouts)::int AS branch_rollouts,
        (SELECT COUNT(*) FROM finance_migration_baselines)::int AS migration_baselines,
        (SELECT COUNT(*) FROM finance_migration_baselines WHERE status='active')::int AS active_migration_baselines,
        (SELECT COUNT(*) FROM fiscal_periods_v2 WHERE status IN ('open','reopened'))::int AS open_periods,
        (SELECT COUNT(*) FROM finance_events WHERE status IN ('pending','blocked','failed'))::int AS unresolved_events,
        (SELECT COUNT(*) FROM finance_approvals WHERE status='pending')::int AS pending_approvals`);
      normalizedCounts = counts.rows[0];
      const totals = await client.query(`SELECT
        COALESCE(SUM(l.debit_irr),0)::text AS debit_irr,
        COALESCE(SUM(l.credit_irr),0)::text AS credit_irr,
        COUNT(DISTINCT e.id)::int AS posted_entries
        FROM journal_entries_v2 e
        JOIN journal_lines_v2 l ON l.journal_entry_id=e.id
        WHERE e.status IN ('posted','reversed')`);
      const invalid = await client.query(`SELECT COUNT(*)::int AS count FROM (
        SELECT e.id
        FROM journal_entries_v2 e
        LEFT JOIN journal_lines_v2 l ON l.journal_entry_id=e.id
        WHERE e.status IN ('posted','reversed')
        GROUP BY e.id,e.debit_irr,e.credit_irr
        HAVING COALESCE(SUM(l.debit_irr),0) <> COALESCE(SUM(l.credit_irr),0)
          OR COALESCE(SUM(l.debit_irr),0) <> e.debit_irr
          OR COALESCE(SUM(l.credit_irr),0) <> e.credit_irr
      ) invalid_entries`);
      ledger = {
        debitIrr: totals.rows[0].debit_irr,
        creditIrr: totals.rows[0].credit_irr,
        postedEntries: totals.rows[0].posted_entries,
        invalidPostedEntries: invalid.rows[0].count,
        balanced: totals.rows[0].debit_irr === totals.rows[0].credit_irr && invalid.rows[0].count === 0,
      };
      const baselineResult = await client.query(`SELECT id,branch_id,status,source_count,source_keys,source_fingerprints,source_sha256,scanned_at
        FROM finance_migration_baselines WHERE branch_id=$1 AND status='active' ORDER BY scanned_at DESC LIMIT 1`, [Number(branchId)]);
      const archiveResult = await client.query(`SELECT source_table,source_id,trust_status,reason,source_payload,branch_id,amount_irr,occurred_at,classification_details
        FROM finance_legacy_archive WHERE branch_id=$1 OR branch_id IS NULL`, [Number(branchId)]);
      const baseline = baselineResult.rows[0] || null;
      migrationEvidence = {
        baseline: baseline ? {
          id: baseline.id,
          branchId: Number(baseline.branch_id),
          status: baseline.status,
          sourceCount: Number(baseline.source_count),
          sourceKeys: baseline.source_keys,
          sourceFingerprints: baseline.source_fingerprints,
          sourceSha256: baseline.source_sha256,
          scannedAt: baseline.scanned_at,
        } : null,
        archiveRecords: archiveResult.rows.map((row) => ({
          key: `${row.source_table}:${row.source_id}`,
          fingerprint: legacySourceFingerprint(row),
          branchId: row.branch_id == null ? null : Number(row.branch_id),
        })),
      };
    }

    let legacyUnifiedJournals = 0;
    if (relation.unified_journals) {
      const result = await client.query('SELECT COUNT(*)::int AS count FROM unified_journal_entries');
      legacyUnifiedJournals = result.rows[0].count;
    }
    await client.query('ROLLBACK');
    return {
      available: true,
      databaseName: identity.rows[0].database_name,
      serverVersion: identity.rows[0].server_version,
      normalizedSchema: normalized,
      migrationLedgerPresent: Boolean(relation.migration_ledger),
      migrationPlan,
      snapshot,
      normalizedCounts,
      ledger,
      migrationEvidence,
      legacyUnifiedJournals,
      inspectedReadOnly: true,
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

function evaluatePreflight(source, destination, shadowReadiness) {
  const gates = [];
  const gate = (id, passed, value) => gates.push({ id, passed: Boolean(passed), value });
  gate('destination_reachable', destination.available === true, destination.available ? destination.databaseName : destination.reason);
  gate('normalized_schema', destination.normalizedSchema === true, destination.normalizedSchema === true ? 'available' : 'missing');
  gate('migration_ledger', destination.migrationLedgerPresent === true, destination.migrationLedgerPresent ? 'available' : 'missing');
  const migrationDrift = (destination.migrationPlan || []).filter((row) => row.status === 'checksum_mismatch').length;
  const migrationPending = (destination.migrationPlan || []).filter((row) => row.status === 'pending').length;
  gate('migration_checksums', destination.available === true && migrationDrift === 0 && migrationPending === 0, { pending: migrationPending, drift: migrationDrift });
  gate('destination_snapshot', destination.snapshot?.present === true, destination.snapshot?.version ?? 'missing');
  const summaryDifferences = destination.snapshot?.reconciliation ? compareSummaries(source.reconciliation, destination.snapshot.reconciliation) : [{ key: 'snapshot', source: 'present', destination: 'missing' }];
  gate('snapshot_reconciliation', summaryDifferences.length === 0, summaryDifferences);
  gate('ledger_balance', destination.ledger?.balanced === true, destination.ledger || 'unavailable');
  gate('no_legacy_unified_journals', destination.available === true && destination.legacyUnifiedJournals === 0, destination.legacyUnifiedJournals ?? 'unknown');
  gate('open_period', Number(destination.normalizedCounts?.open_periods || 0) > 0, Number(destination.normalizedCounts?.open_periods || 0));
  gate('no_destination_exceptions', destination.normalizedSchema === true && Number(destination.normalizedCounts?.unresolved_events || 0) === 0 && Number(destination.normalizedCounts?.pending_approvals || 0) === 0, {
    unresolvedEvents: Number(destination.normalizedCounts?.unresolved_events || 0),
    pendingApprovals: Number(destination.normalizedCounts?.pending_approvals || 0),
  });
  gate('historical_evidence', source.migrationTrust.historicalEvidenceComplete === true, source.migrationTrust);
  const sourceBaseline = source.migrationTrust?.baseline || null;
  const destinationBaseline = destination.migrationEvidence?.baseline || null;
  const baselineMatches = Boolean(sourceBaseline && destinationBaseline
    && sourceBaseline.branchId === destinationBaseline.branchId
    && sourceBaseline.sourceCount === destinationBaseline.sourceCount
    && sourceBaseline.sourceSha256 === destinationBaseline.sourceSha256
    && canonicalJson((sourceBaseline.sourceKeys || []).map(String).sort()) === canonicalJson((destinationBaseline.sourceKeys || []).map(String).sort())
    && canonicalJson(sourceBaseline.sourceFingerprints) === canonicalJson(destinationBaseline.sourceFingerprints));
  gate('migration_baseline', destination.normalizedSchema === true && source.migrationTrust.baselinePresent === true && Number(destination.normalizedCounts?.active_migration_baselines || 0) > 0 && baselineMatches, {
    sourceBaselinePresent: source.migrationTrust.baselinePresent,
    destinationActiveBaselines: Number(destination.normalizedCounts?.active_migration_baselines || 0),
    exactMatch: baselineMatches,
  });
  const destinationArchiveByKey = new Map((destination.migrationEvidence?.archiveRecords || []).map((row) => [row.key, row]));
  const expectedArchiveKeys = Array.isArray(sourceBaseline?.sourceKeys) ? sourceBaseline.sourceKeys.map(String) : [];
  const missingDestinationArchiveKeys = expectedArchiveKeys.filter((key) => !destinationArchiveByKey.has(key));
  const mismatchedDestinationArchiveKeys = expectedArchiveKeys.filter((key) => {
    const expected = sourceBaseline?.sourceFingerprints?.[key];
    const actual = destinationArchiveByKey.get(key)?.fingerprint;
    return Boolean(expected && actual && expected !== actual);
  });
  const unexpectedDestinationArchiveKeys = [...destinationArchiveByKey.keys()].filter((key) => !expectedArchiveKeys.includes(String(key)));
  const exactArchiveMatch = Boolean(sourceBaseline && missingDestinationArchiveKeys.length === 0 && mismatchedDestinationArchiveKeys.length === 0 && unexpectedDestinationArchiveKeys.length === 0);
  gate('migration_archive_complete', destination.normalizedSchema === true && source.migrationTrust.missingArchiveRecords === 0 && source.migrationTrust.archiveSnapshotMismatches === 0 && source.migrationTrust.newUnscopedRecords === 0 && exactArchiveMatch && Number(destination.normalizedCounts?.legacy_archive || 0) >= source.migrationTrust.baselineRecords, {
    requiredBaselineRecords: source.migrationTrust.baselineRecords,
    destinationArchivedRecords: Number(destination.normalizedCounts?.legacy_archive || 0),
    quarantinedRecordsPreserved: source.migrationTrust.quarantinedRecords,
    missingArchiveRecords: source.migrationTrust.missingArchiveRecords,
    archiveSnapshotMismatches: source.migrationTrust.archiveSnapshotMismatches,
    newUnscopedRecords: source.migrationTrust.newUnscopedRecords,
    exactMatch: exactArchiveMatch,
    missingDestinationArchiveKeys: missingDestinationArchiveKeys.slice(0, 25),
    mismatchedDestinationArchiveKeys: mismatchedDestinationArchiveKeys.slice(0, 25),
    unexpectedDestinationArchiveKeys: unexpectedDestinationArchiveKeys.slice(0, 25),
  });
  gate('shadow_thresholds', shadowReadiness.status === 'READY_FOR_CUTOVER_REVIEW', { status: shadowReadiness.status, completeOrders: shadowReadiness.completeOrders, operatingDays: shadowReadiness.operatingDays });
  return {
    status: gates.every((row) => row.passed) ? 'READY_FOR_ACCOUNTANT_REVIEW' : 'NO_GO',
    automaticCutover: false,
    gates,
  };
}

function safeError(error) {
  return String(error?.message || error || 'unknown_error').replace(/postgres(?:ql)?:\/\/[^\s]+/gi, '[redacted-database-url]');
}

function writeEvidenceBundle({ raw, report, outputRoot }) {
  const stamp = report.generatedAt.replace(/[:.]/g, '-');
  const outputDir = path.join(outputRoot, stamp);
  fs.mkdirSync(outputDir, { recursive: true, mode: 0o700 });
  const snapshotPath = path.join(outputDir, 'source-db.snapshot.json');
  const reportPath = path.join(outputDir, 'cutover-preflight.json');
  fs.writeFileSync(snapshotPath, raw, { mode: 0o600, flag: 'wx' });
  const encodedReport = Buffer.from(`${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(reportPath, encodedReport, { mode: 0o600, flag: 'wx' });
  const manifest = {
    generatedAt: report.generatedAt,
    files: [
      { name: path.basename(snapshotPath), bytes: raw.length, sha256: sha256(raw) },
      { name: path.basename(reportPath), bytes: encodedReport.length, sha256: sha256(encodedReport) },
    ],
  };
  const manifestPath = path.join(outputDir, 'manifest.json');
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  return { outputDir, snapshotPath, reportPath, manifestPath, manifest };
}

async function main() {
  const root = path.resolve(__dirname, '..');
  const sourcePath = process.env.WESTO_DB_PATH || path.join(root, 'server', 'data', 'db.json');
  const raw = fs.readFileSync(sourcePath);
  const { db, evidence: source } = buildSourceEvidence(raw, sourcePath);
  let destination = { available: false, reason: 'database_url_required', inspectedReadOnly: true };
  if (process.env.DATABASE_URL) {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_SSL === 'false' ? false : undefined });
    try {
      destination = await inspectDestination(pool, Number(process.env.WESTO_BRANCH_ID) || 1);
    } catch (error) {
      destination = { available: false, reason: 'destination_inspection_failed', error: safeError(error), inspectedReadOnly: true };
    } finally {
      await pool.end().catch(() => {});
    }
  }
  const storageStatus = { available: destination.normalizedSchema === true, required: true, reason: destination.reason || (destination.normalizedSchema ? 'available' : 'finance_schema_missing') };
  const shadowReadiness = financeV2.shadowRunReadiness(db, Number(process.env.WESTO_BRANCH_ID) || 1, { storageStatus });
  const decision = evaluatePreflight(source, destination, shadowReadiness);
  // Include destination-only gates as well as shadow gates.  Otherwise an
  // operator could receive a runbook that omits a failed checksum, snapshot,
  // or archive-integrity gate which is only evaluated against PostgreSQL.
  decision.runbook = buildCutoverRunbook({ shadowReadiness, destination, preflightGates: decision.gates });
  const report = {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    mode: 'read_only_preflight',
    source,
    destination,
    shadowReadiness,
    decision,
  };
  let bundle = null;
  if (process.argv.includes('--write-evidence')) {
    bundle = writeEvidenceBundle({ raw, report, outputRoot: process.env.WESTO_FINANCE_CUTOVER_DIR || path.join(root, 'artifacts', 'finance-v2', 'cutover-evidence') });
  }
  process.stdout.write(`${JSON.stringify({ ok: decision.status === 'READY_FOR_ACCOUNTANT_REVIEW', status: decision.status, report, bundle }, null, 2)}\n`);
  if (decision.status !== 'READY_FOR_ACCOUNTANT_REVIEW') process.exitCode = 3;
  return { report, bundle };
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${JSON.stringify({ ok: false, code: error.code || 'finance_cutover_preflight_failed', error: safeError(error) }, null, 2)}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  sha256, canonicalJson, financeCounts, buildSourceEvidence, compareSummaries, legacySourceFingerprint,
  inspectDestination, evaluatePreflight, writeEvidenceBundle, main,
};
