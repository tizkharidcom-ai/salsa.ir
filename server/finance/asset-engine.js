'use strict';
/**
 * WESTO Finance — Asset Engine (ported from NEEM)
 * Multiple depreciation methods, disposal, transfer, journal integration.
 */
const { toInt } = require('./money');

function ensureAssets(acc) {
  if (!Array.isArray(acc.fixedAssets)) acc.fixedAssets = [];
  if (!Array.isArray(acc.assetDisposals)) acc.assetDisposals = [];
  if (!Array.isArray(acc.assetTransfers)) acc.assetTransfers = [];
  return acc;
}

function calcMonthlyDep(asset, method) {
  const cost = toInt(asset.purchaseCost);
  const salvage = toInt(asset.salvageValue);
  const months = Number(asset.usefulLifeMonths) || 60;
  const depBase = cost - salvage;
  const accDep = toInt(asset.accumulatedDepreciation);
  const remaining = depBase - accDep;
  if (remaining <= 0) return 0;

  method = method || asset.depreciationMethod || 'straight_line';

  if (method === 'straight_line') {
    return Math.min(Math.round(depBase / months), remaining);
  }
  if (method === 'declining_balance') {
    const rate = 2 / months;
    const bookValue = cost - accDep;
    const dep = Math.round(bookValue * rate);
    return Math.min(dep, remaining);
  }
  if (method === 'units_of_production') {
    const totalUnits = Number(asset.totalUnits) || 1;
    const unitsThisMonth = Number(asset.unitsThisMonth) || 0;
    const dep = Math.round(depBase * (unitsThisMonth / totalUnits));
    return Math.min(dep, remaining);
  }
  return Math.min(Math.round(depBase / months), remaining);
}

function runDepreciation(acc, postJournalFn, db) {
  ensureAssets(acc);
  const assets = acc.fixedAssets.filter(a => a.status === 'active');
  let total = 0;
  const processed = [];

  for (const asset of assets) {
    const dep = calcMonthlyDep(asset);
    if (dep > 0) {
      asset.accumulatedDepreciation = toInt(asset.accumulatedDepreciation) + dep;
      asset.lastDepreciationDate = new Date().toISOString();
      total += dep;
      processed.push({ id: asset.id, name: asset.name, amount: dep });
    }
  }

  if (total <= 0) return { ok: true, message: 'هیچ دارایی فعالی نیاز به محاسبه استهلاک ندارد.', postedAmount: 0 };

  let je = null;
  if (postJournalFn && db) {
    je = postJournalFn(db, {
      source: 'depreciation', date: new Date().toISOString(),
      description: `ثبت استهلاک ماهانه (${processed.length} قلم)`,
      lines: [
        { accountCode: '6980', debit: total, credit: 0, memo: 'هزینه استهلاک ماهانه' },
        { accountCode: '1890', debit: 0, credit: total, memo: 'افزایش استهلاک انباشته' },
      ],
    });
  }
  return { ok: true, journalEntry: je, totalDepreciation: total, processedAssets: processed };
}

function disposeAsset(acc, assetId, { salePrice, date, reason }) {
  ensureAssets(acc);
  const asset = acc.fixedAssets.find(a => a.id === assetId);
  if (!asset) return { error: 'دارایی یافت نشد.' };
  const bookValue = toInt(asset.purchaseCost) - toInt(asset.accumulatedDepreciation);
  const gainLoss = toInt(salePrice || 0) - bookValue;
  asset.status = 'disposed';
  asset.disposedAt = date || new Date().toISOString();
  asset.disposalReason = reason;
  const disposal = {
    id: `disp-${Date.now()}`, assetId, assetName: asset.name,
    bookValue, salePrice: toInt(salePrice), gainLoss, date: asset.disposedAt, reason,
  };
  acc.assetDisposals.push(disposal);
  return { ok: true, disposal, journalLines: [
    { accountCode: '1890', debit: toInt(asset.accumulatedDepreciation), credit: 0, memo: `حذف استهلاک ${asset.name}` },
    { accountCode: salePrice ? '1210' : '6990', debit: toInt(salePrice || 0), credit: 0, memo: `وجه فروش ${asset.name}` },
    { accountCode: '1810', debit: 0, credit: toInt(asset.purchaseCost), memo: `حذف بهای ${asset.name}` },
    ...(gainLoss !== 0 ? [{ accountCode: gainLoss > 0 ? '4500' : '6990', debit: gainLoss < 0 ? Math.abs(gainLoss) : 0, credit: gainLoss > 0 ? gainLoss : 0, memo: `سود/زیان فروش ${asset.name}` }] : []),
  ]};
}

function transferAsset(acc, assetId, { toBranchId, date }) {
  ensureAssets(acc);
  const asset = acc.fixedAssets.find(a => a.id === assetId);
  if (!asset) return { error: 'دارایی یافت نشد.' };
  const fromBranch = asset.branchId;
  asset.branchId = toBranchId;
  const transfer = {
    id: `trf-${Date.now()}`, assetId, assetName: asset.name,
    fromBranch, toBranch: toBranchId, date: date || new Date().toISOString(),
  };
  acc.assetTransfers.push(transfer);
  return { ok: true, transfer };
}

function createAsset(acc, data) {
  ensureAssets(acc);
  const id = data.id || `fa-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const asset = {
    id, assetCode: data.assetCode || `AST-${acc.fixedAssets.length + 1}`,
    name: data.name, category: data.category || 'تجهیزات',
    purchaseDate: data.purchaseDate || new Date().toISOString(),
    purchaseCost: toInt(data.purchaseCost), salvageValue: toInt(data.salvageValue || 0),
    usefulLifeMonths: Number(data.usefulLifeMonths) || 60,
    depreciationMethod: data.depreciationMethod || 'straight_line',
    accumulatedDepreciation: 0, status: 'active', branchId: data.branchId,
  };
  acc.fixedAssets.push(asset);
  return asset;
}

function getAssetRegister(acc, branchId) {
  ensureAssets(acc);
  return (acc.fixedAssets || [])
    .filter(a => !branchId || a.branchId == branchId)
    .map(a => ({
      ...a,
      bookValue: toInt(a.purchaseCost) - toInt(a.accumulatedDepreciation),
      depPct: toInt(a.purchaseCost) > 0 ? Math.round(toInt(a.accumulatedDepreciation) / toInt(a.purchaseCost) * 100) : 0,
    }));
}

module.exports = {
  ensureAssets, calcMonthlyDep, runDepreciation, disposeAsset,
  transferAsset, createAsset, getAssetRegister,
};
