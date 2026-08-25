'use strict';

const crypto = require('crypto');

const PAID_STATUSES = new Set(['paid', 'preparing', 'ready', 'dispatched', 'picked_up', 'delivered', 'done']);
const TRUST_PRIORITY = Object.freeze({ verified: 1, inferred_needs_approval: 2, quarantined: 3 });

function list(value) { return Array.isArray(value) ? value : []; }
function clone(value) { return JSON.parse(JSON.stringify(value == null ? null : value)); }
function paid(order) { return order?.paymentStatus === 'paid' || PAID_STATUSES.has(String(order?.status || '')); }
function amountIrrFromLegacyToman(value) { return Math.round(Number(value) || 0) * 10; }
function digest(value) { return crypto.createHash('sha256').update(String(value)).digest('hex'); }
function stableUuid(value) {
  const bytes = Buffer.from(digest(value).slice(0, 32), 'hex');
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
function sourceId(row, index) {
  const explicit = row?.id ?? row?.number ?? row?.reference ?? row?.batchNo ?? row?.batchNumber;
  return explicit == null || String(explicit).trim() === '' ? `content-${digest(`${JSON.stringify(row || {})}:${index}`).slice(0, 20)}` : String(explicit);
}

function classifyLegacyFinance(db, { analyzeSale } = {}) {
  if (typeof analyzeSale !== 'function') throw Object.assign(new Error('قاعدهٔ تحلیل فروش برای طبقه‌بندی مهاجرت الزامی است.'), { code: 'legacy_sale_analyzer_required' });
  const records = new Map();
  const add = (record) => {
    const key = `${record.sourceTable}:${record.sourceId}`;
    const current = records.get(key);
    if (!current || TRUST_PRIORITY[record.trustStatus] > TRUST_PRIORITY[current.trustStatus]) records.set(key, record);
  };
  const make = ({ sourceTable, sourceId: rowId, trustStatus, reason, sourcePayload, branchId = null, amountIrr = null, occurredAt = null, classificationDetails = {} }) => ({
    id: stableUuid(`finance-legacy-archive:${sourceTable}:${rowId}`), sourceTable, sourceId: String(rowId), trustStatus, reason,
    sourcePayload: clone(sourcePayload), branchId: branchId == null ? null : Number(branchId), amountIrr,
    occurredAt: occurredAt || null, classificationDetails: clone(classificationDetails),
    decision: trustStatus === 'quarantined' ? 'keep_quarantined' : 'pending',
  });

  for (const order of list(db.orders).filter(paid)) {
    const analysis = analyzeSale(order);
    add(make({
      sourceTable: 'orders', sourceId: sourceId(order),
      trustStatus: analysis.ok ? 'verified' : 'inferred_needs_approval',
      reason: analysis.ok ? 'operational_source_and_tender_verified' : (analysis.code || 'payment_evidence_incomplete'),
      sourcePayload: order, branchId: order.branchId, amountIrr: amountIrrFromLegacyToman(order.total),
      occurredAt: order.paidAt || order.createdAt || null,
      classificationDetails: analysis.ok ? { tenderSnapshot: analysis.tenders } : { message: analysis.message || null },
    }));
  }

  const duplicateRows = (rows, sourceTable, keyFor, reason) => {
    const groups = new Map();
    list(rows).forEach((row, index) => {
      const duplicateKey = keyFor(row);
      if (!duplicateKey) return;
      const bucket = groups.get(duplicateKey) || [];
      bucket.push({ row, index }); groups.set(duplicateKey, bucket);
    });
    for (const [duplicateKey, bucket] of groups) {
      if (bucket.length < 2) continue;
      const ids = bucket.map(({ row, index }) => sourceId(row, index));
      bucket.forEach(({ row, index }) => add(make({
        sourceTable, sourceId: sourceId(row, index), trustStatus: 'quarantined', reason, sourcePayload: row,
        branchId: row.branchId, amountIrr: row.amountIrr == null ? (row.amount == null ? null : amountIrrFromLegacyToman(row.amount)) : Number(row.amountIrr),
        occurredAt: row.date || row.createdAt || row.settledAt || null,
        classificationDetails: { duplicateKey, groupSourceIds: ids },
      })));
    }
  };

  const accounting = db.accounting || {};
  duplicateRows(accounting.settlements, 'accounting.settlements', (row) => {
    const provider = row.provider || row.psp || row.gateway;
    const batch = row.batchNo || row.batchNumber || row.reference;
    return provider && batch ? `${provider}:${batch}` : '';
  }, 'duplicate_settlement_batch');
  duplicateRows(accounting.expenses, 'accounting.expenses', (row) => {
    const day = String(row.date || row.createdAt || '').slice(0, 10);
    const amount = row.amount ?? row.totalAmount;
    return day && amount != null ? `${day}:${amount}:${String(row.description || row.title || '').trim().toLowerCase()}` : '';
  }, 'possible_duplicate_expense');
  duplicateRows(list(accounting.journalEntries).filter((row) => row.source === 'depreciation'), 'accounting.journalEntries', (row) => {
    const asset = row.sourceId || String(row.description || '').match(/AST-\d+|fa-\d+/i)?.[0] || 'batch';
    const period = String(row.date || '').slice(0, 7);
    return period ? `${asset}:${period}` : '';
  }, 'duplicate_depreciation_asset_period');

  list(accounting.journalEntries).forEach((row, index) => {
    if (!/test|demo|نمونه|آزمایش/i.test(`${row.description || ''} ${row.number || ''}`)) return;
    add(make({
      sourceTable: 'accounting.journalEntries', sourceId: sourceId(row, index), trustStatus: 'quarantined',
      reason: 'explicit_test_or_demo_marker', sourcePayload: row, branchId: row.branchId,
      amountIrr: row.debitIrr ?? row.totalDebitIrr ?? null, occurredAt: row.date || row.createdAt || null,
    }));
  });

  const seedRules = [
    ['vendors', (row) => ['v-1', 'v-2', 'v-3'].includes(String(row.id))],
    ['inventoryItems', (row) => /^inv-[1-9]\d*$/.test(String(row.id))],
    ['recipes', (row) => ['rcp-1', 'rcp-2'].includes(String(row.id))],
    ['fixedAssets', (row) => ['fa-1', 'fa-2', 'fa-3', 'fa-4'].includes(String(row.id))],
    ['employees', (row) => ['emp-1', 'emp-2', 'emp-3'].includes(String(row.id))],
  ];
  seedRules.forEach(([table, predicate]) => list(accounting[table]).forEach((row, index) => {
    if (!predicate(row)) return;
    add(make({
      sourceTable: `accounting.${table}`, sourceId: sourceId(row, index), trustStatus: 'quarantined',
      reason: 'known_legacy_seed_fixture', sourcePayload: row, branchId: row.branchId,
    }));
  }));

  const rows = [...records.values()].sort((a, b) => `${a.sourceTable}:${a.sourceId}`.localeCompare(`${b.sourceTable}:${b.sourceId}`));
  const summary = rows.reduce((result, row) => {
    result.total += 1; result[row.trustStatus] += 1; return result;
  }, { total: 0, verified: 0, inferred_needs_approval: 0, quarantined: 0 });
  return { rows, summary, policy: { deletesPerformed: 0, postingsPerformed: 0, blindCurrencyConversions: 0, archiveMode: 'read_only' } };
}

module.exports = { classifyLegacyFinance, stableUuid };
