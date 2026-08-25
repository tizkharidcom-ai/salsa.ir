'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const financeV2 = require('../server/finance-v2');
const { classifyLegacyFinance } = require('../server/finance/legacy-classifier');

const root = path.resolve(__dirname, '..');
const sourcePath = process.env.WESTO_DB_PATH || path.join(root, 'server', 'data', 'db.json');
const outputDir = process.env.WESTO_FINANCE_AUDIT_DIR || path.join(root, 'artifacts', 'finance-v2');
const raw = fs.readFileSync(sourcePath);
const db = JSON.parse(raw.toString('utf8'));
const sha256 = crypto.createHash('sha256').update(raw).digest('hex');
const generatedAt = new Date().toISOString();
const classified = classifyLegacyFinance(db, { analyzeSale: financeV2.salesLines });
const verified = classified.rows.filter((row) => row.trustStatus === 'verified');
const inferred = classified.rows.filter((row) => row.trustStatus === 'inferred_needs_approval');
const quarantined = classified.rows.filter((row) => row.trustStatus === 'quarantined');
const countReason = (reason) => quarantined.filter((row) => row.reason === reason).length;
const countGroups = (reason) => new Set(quarantined.filter((row) => row.reason === reason).map((row) => row.classificationDetails?.duplicateKey).filter(Boolean)).size;

const report = {
  schemaVersion: 1,
  generatedAt,
  source: { path: sourcePath, sha256, bytes: raw.length, amountUnitClassification: 'legacy_toman' },
  policy: { ...classified.policy, canonicalTargetCurrency: 'IRR' },
  summary: {
    paidOrders: verified.length + inferred.length,
    verifiedOrders: verified.length,
    inferredOrdersNeedingApproval: inferred.length,
    quarantinedRecords: quarantined.length,
    duplicateSettlementGroups: countGroups('duplicate_settlement_batch'),
    duplicateExpenseGroups: countGroups('possible_duplicate_expense'),
    duplicateDepreciationGroups: countGroups('duplicate_depreciation_asset_period'),
    explicitTestRecords: countReason('explicit_test_or_demo_marker'),
    knownSeedFixtures: countReason('known_legacy_seed_fixture'),
  },
  classifications: {
    verifiedWithOperationalSource: verified,
    inferredNeedsAccountantApproval: inferred,
    quarantined,
  },
  reconciliation: financeV2.reportSnapshot(db),
  releaseGate: { status: 'NO_GO', reasons: financeV2.dataQuality(db).issues.map((issue) => issue.code) },
};

fs.mkdirSync(outputDir, { recursive: true });
const stamp = generatedAt.replace(/[:.]/g, '-');
const outputPath = path.join(outputDir, `migration-audit-${stamp}.json`);
fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
process.stdout.write(`${JSON.stringify({ ok: true, outputPath, sha256, summary: report.summary, releaseGate: report.releaseGate }, null, 2)}\n`);
