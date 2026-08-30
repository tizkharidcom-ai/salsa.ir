'use strict';
/**
 * WESTO Finance — Asset Engine (ported from NEEM)
 * Multiple depreciation methods, disposal, transfer, journal integration.
 */
const { toInt, toIntegerIRR } = require('./money');

const ACTIVE_DEPRECIATION_STATUSES = new Set(['posted', 'pending_approval']);

function financeError(code, message) {
  const error = new Error(message);
  error.code = code;
  error.status = 400;
  return error;
}

function parseDate(value, code, message) {
  const raw = String(value || '').trim();
  const date = new Date(raw);
  if (!raw || !Number.isFinite(date.getTime())) throw financeError(code, message);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw) && date.toISOString().slice(0, 10) !== raw) throw financeError(code, message);
  return date;
}

function periodBoundary(value, isEnd = false) {
  const raw = String(value || '').trim();
  if (isEnd && /^\d{4}-\d{2}-\d{2}$/.test(raw)) return new Date(`${raw}T23:59:59.999Z`);
  return new Date(raw);
}

function monthOf(value) {
  return parseDate(value, 'asset_date_invalid', 'تاریخ دارایی معتبر نیست.').toISOString().slice(0, 7);
}

function safeAmount(value, code, message, { allowZero = false } = {}) {
  let amount;
  try {
    amount = toIntegerIRR(value);
  } catch (error) {
    throw financeError(code, message);
  }
  if (!Number.isSafeInteger(amount) || (allowZero ? amount < 0 : amount <= 0)) throw financeError(code, message);
  return amount;
}

function assetFingerprint(data) {
  return JSON.stringify({
    id: data.id || null, assetCode: String(data.assetCode || '').trim().toUpperCase(), name: String(data.name || '').trim(),
    category: data.category || 'تجهیزات', branchId: data.branchId == null ? null : Number(data.branchId),
    purchaseDate: data.purchaseDate || null, inServiceDate: data.inServiceDate || null,
    purchaseCost: toInt(data.purchaseCost), salvageValue: toInt(data.salvageValue || 0),
    usefulLifeMonths: data.usefulLifeMonths == null ? 60 : Number(data.usefulLifeMonths),
    depreciationMethod: data.depreciationMethod || 'straight_line',
    assetAccountCode: data.assetAccountCode || data.accountCode || '1810',
  });
}

function numericBranch(value, code = 'asset_branch_invalid') {
  const branchId = Number(value);
  if (!Number.isSafeInteger(branchId) || branchId <= 0) throw financeError(code, 'شعبه دارایی معتبر نیست.');
  return branchId;
}

function assertBranchExists(acc, branchId) {
  if (Array.isArray(acc.branches) && acc.branches.length && !acc.branches.some((branch) => Number(branch.id) === branchId && branch.active !== false)) {
    throw financeError('asset_branch_not_found', 'شعبه دارایی یافت نشد یا غیرفعال است.');
  }
}

function assertOpenPeriod(acc, date) {
  if (!Array.isArray(acc.fiscalPeriods) || acc.fiscalPeriods.length === 0) return null;
  const period = acc.fiscalPeriods.find((candidate) => {
    const start = periodBoundary(candidate.startDate);
    const end = periodBoundary(candidate.endDate, true);
    return Number.isFinite(start.getTime()) && Number.isFinite(end.getTime()) && start <= date && end >= date;
  });
  if (!period) throw financeError('asset_period_missing', 'برای تاریخ ثبت دارایی/استهلاک دوره مالی معتبر یافت نشد.');
  if (period.status === 'closed') throw financeError('asset_period_closed', `دوره «${period.name || ''}» بسته شده است.`);
  return period;
}

function addMonthsClamped(date, offset) {
  const source = new Date(date);
  const day = source.getUTCDate();
  const target = new Date(Date.UTC(source.getUTCFullYear(), source.getUTCMonth() + offset, 1, 12, 0, 0, 0));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0, 12, 0, 0, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target;
}

function ensureAssets(acc) {
  if (!Array.isArray(acc.fixedAssets)) acc.fixedAssets = [];
  if (!Array.isArray(acc.assetDisposals)) acc.assetDisposals = [];
  if (!Array.isArray(acc.assetTransfers)) acc.assetTransfers = [];
  if (!Array.isArray(acc.depreciationRuns)) acc.depreciationRuns = [];
  return acc;
}

function calcMonthlyDep(asset, method) {
  const cost = toInt(asset.purchaseCost);
  const salvage = Math.max(0, toInt(asset.salvageValue));
  const months = Number.isInteger(Number(asset.usefulLifeMonths)) && Number(asset.usefulLifeMonths) > 0 ? Number(asset.usefulLifeMonths) : 60;
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

function runDepreciation(acc, postJournalFn, db, options = {}) {
  ensureAssets(acc);
  const postingDate = options.postingDate || options.date || new Date().toISOString().slice(0, 10);
  const postingAt = parseDate(postingDate, 'depreciation_date_invalid', 'تاریخ ثبت استهلاک معتبر نیست.');
  const serviceMonth = monthOf(postingAt);
  const branchId = options.branchId == null || options.branchId === '' ? null : numericBranch(options.branchId, 'depreciation_branch_invalid');
  if (branchId != null) assertBranchExists(acc, branchId);
  const requestKey = options.idempotencyKey == null ? null : String(options.idempotencyKey).trim();
  const requestFingerprint = JSON.stringify({ postingDate: postingAt.toISOString(), branchId });
  if (requestKey) {
    const existing = acc.depreciationRuns.find((run) => run.idempotencyKey === requestKey);
    if (existing) {
      if (existing.requestFingerprint !== requestFingerprint) throw financeError('depreciation_idempotency_conflict', 'کلید idempotency استهلاک قبلاً با بدنه متفاوت استفاده شده است.');
      return { ok: true, idempotentReplay: true, run: existing, journalEntry: null, totalDepreciation: existing.totalDepreciation, processedAssets: existing.lines || [] };
    }
  }
  const period = assertOpenPeriod(acc, postingAt);
  const assets = acc.fixedAssets.filter(a => a.status === 'active');
  const eligibleAssets = assets.filter((asset) => {
    if (branchId != null && Number(asset.branchId) !== branchId) return false;
    const inService = asset.inServiceDate || asset.purchaseDate;
    if (inService) {
      const serviceDate = parseDate(inService, 'asset_date_invalid', 'تاریخ بهره‌برداری دارایی معتبر نیست.');
      if (serviceDate > postingAt) return false;
    }
    const alreadyRun = acc.depreciationRuns.some((run) => run.serviceMonth === serviceMonth
      && ACTIVE_DEPRECIATION_STATUSES.has(run.status)
      && Array.isArray(run.lines) && run.lines.some((line) => line.assetId === asset.id));
    const lastMonth = asset.lastDepreciationDate ? monthOf(asset.lastDepreciationDate) : null;
    return !alreadyRun && lastMonth !== serviceMonth;
  });
  let total = 0;
  const processed = [];

  for (const asset of eligibleAssets) {
    const dep = calcMonthlyDep(asset);
    if (dep > 0) {
      total += dep;
      processed.push({ id: asset.id, assetId: asset.id, name: asset.name, amount: dep, branchId: asset.branchId || null });
    }
  }

  if (total <= 0) return {
    ok: true, message: 'هیچ دارایی فعالی نیاز به محاسبه استهلاک ندارد.', postedAmount: 0,
    totalDepreciation: 0, processedAssets: [], skippedAssets: assets.length - eligibleAssets.length,
    serviceMonth, postingDate: postingAt.toISOString(), periodId: period?.id || null,
  };

  const runId = `depr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  let je = null;
  if (postJournalFn && db) {
    je = postJournalFn(db, {
      source: 'depreciation', sourceId: runId, date: postingAt.toISOString(),
      description: `ثبت استهلاک ماهانه (${processed.length} قلم)`,
      lines: processed.flatMap((item) => [
        { accountCode: '6980', debit: item.amount, credit: 0, memo: `هزینه استهلاک ${item.name}`, branchId: item.branchId || undefined },
        { accountCode: '1890', debit: 0, credit: item.amount, memo: `افزایش استهلاک انباشته ${item.name}`, branchId: item.branchId || undefined },
      ]),
    });
  }
  const run = {
    id: runId,
    serviceMonth, postingDate: postingAt.toISOString(), branchId, periodId: period?.id || null,
    status: 'posted',
    journalEntryId: je?.id || null, totalDepreciation: total,
    lines: processed.map((item) => ({ assetId: item.assetId, amount: item.amount, branchId: item.branchId })),
    createdById: options.createdById || 'admin', approvedById: options.approvedById || null,
    idempotencyKey: requestKey,
    requestFingerprint: requestKey ? requestFingerprint : null,
  };
  acc.depreciationRuns.push(run);
  for (const item of processed) {
    const asset = acc.fixedAssets.find((candidate) => candidate.id === item.assetId);
    asset.accumulatedDepreciation = toInt(asset.accumulatedDepreciation) + item.amount;
    asset.lastDepreciationDate = postingAt.toISOString();
  }
  return { ok: true, journalEntry: je, totalDepreciation: total, processedAssets: processed, run };
}

function reverseDepreciationRun(acc, runId, options = {}) {
  ensureAssets(acc);
  const run = acc.depreciationRuns.find((item) => item.id === runId);
  if (!run) return { ok: false, error: 'ثبت استهلاک یافت نشد.' };
  if (run.status === 'reversed') return { ok: false, error: 'این ثبت استهلاک قبلاً معکوس شده است.' };
  if (run.status !== 'posted') return { ok: false, error: 'فقط ثبت استهلاک قطعی قابل معکوس‌سازی است.' };
  const reversalDate = parseDate(options.date || new Date().toISOString(), 'depreciation_reversal_date_invalid', 'تاریخ معکوس‌سازی استهلاک معتبر نیست.');
  const postingDate = parseDate(run.postingDate, 'depreciation_date_invalid', 'تاریخ ثبت استهلاک معتبر نیست.');
  if (reversalDate < postingDate) throw financeError('depreciation_reversal_date_invalid', 'تاریخ معکوس‌سازی استهلاک نمی‌تواند قبل از تاریخ ثبت باشد.');
  assertOpenPeriod(acc, reversalDate);
  const laterRun = acc.depreciationRuns.some((candidate) => candidate.status === 'posted'
    && candidate.id !== run.id && candidate.serviceMonth > run.serviceMonth
    && candidate.lines?.some((candidateLine) => run.lines.some((line) => line.assetId === candidateLine.assetId)));
  if (laterRun) return { ok: false, error: 'ابتدا ثبت استهلاک ماه‌های جدیدتر باید معکوس شود.' };
  let reversalJournal = null;
  if (options.postJournalFn) {
    reversalJournal = options.postJournalFn({
      source: 'depreciation_reversal', sourceId: run.id, date: reversalDate.toISOString(),
      description: `معکوس استهلاک ماه ${run.serviceMonth}`,
      lines: run.lines.flatMap((line) => [
        { accountCode: '6980', debit: 0, credit: line.amount, branchId: line.branchId || run.branchId || undefined },
        { accountCode: '1890', debit: line.amount, credit: 0, branchId: line.branchId || run.branchId || undefined },
      ]),
    });
  }
  run.status = 'reversed'; run.reversedAt = reversalDate.toISOString(); run.reversedBy = options.userId || 'admin';
  run.reversalJournalEntryId = reversalJournal?.id || null;
  for (const line of run.lines) {
    const asset = acc.fixedAssets.find((candidate) => candidate.id === line.assetId);
    if (!asset) continue;
    asset.accumulatedDepreciation = Math.max(0, toInt(asset.accumulatedDepreciation) - toInt(line.amount));
    const latest = acc.depreciationRuns
      .filter((candidate) => candidate.status === 'posted' && candidate.id !== run.id && candidate.lines?.some((candidateLine) => candidateLine.assetId === asset.id))
      .sort((a, b) => String(b.serviceMonth).localeCompare(String(a.serviceMonth)))[0];
    asset.lastDepreciationDate = latest?.postingDate || null;
  }
  return { ok: true, run, reversalJournal };
}

function disposeAsset(acc, assetId, input = {}) {
  ensureAssets(acc);
  const asset = acc.fixedAssets.find(a => a.id === assetId);
  if (!asset) return { error: 'دارایی یافت نشد.' };
  const { salePrice, date, reason, idempotencyKey } = input;
  const requestKey = idempotencyKey == null ? null : String(idempotencyKey).trim();
  const requestFingerprint = JSON.stringify({ assetId, salePrice: salePrice == null || salePrice === '' ? null : toInt(salePrice), date: date || null, reason: String(reason || '').trim() });
  if (requestKey) {
    const existing = acc.assetDisposals.find((item) => item.idempotencyKey === requestKey);
    if (existing) {
      if (existing.requestFingerprint !== requestFingerprint) throw financeError('asset_disposal_idempotency_conflict', 'کلید idempotency واگذاری قبلاً با بدنه متفاوت استفاده شده است.');
      return { ok: true, disposal: existing, asset, idempotentReplay: true };
    }
  }
  if (asset.status !== 'active') return { ok: false, error: 'فقط دارایی فعال قابل واگذاری یا اسقاط است.' };
  const disposalDate = parseDate(date || new Date().toISOString(), 'asset_disposal_date_invalid', 'تاریخ واگذاری دارایی معتبر نیست.');
  const purchaseDate = parseDate(asset.purchaseDate, 'asset_date_invalid', 'تاریخ خرید دارایی معتبر نیست.');
  if (disposalDate < purchaseDate) throw financeError('asset_disposal_date_invalid', 'تاریخ واگذاری دارایی نمی‌تواند قبل از تاریخ خرید باشد.');
  assertOpenPeriod(acc, disposalDate);
  const hasSalePrice = salePrice !== undefined && salePrice !== null && salePrice !== '';
  const normalizedSalePrice = safeAmount(hasSalePrice ? salePrice : 0, 'asset_sale_price_invalid', 'مبلغ فروش دارایی معتبر نیست.', { allowZero: true });
  const bookValue = Math.max(0, toInt(asset.purchaseCost) - toInt(asset.accumulatedDepreciation));
  const gainLoss = normalizedSalePrice - bookValue;
  asset.status = 'disposed';
  asset.disposedAt = disposalDate.toISOString();
  asset.disposalReason = String(reason || '').trim().slice(0, 300) || null;
  const disposal = {
    id: `disp-${Date.now()}`, assetId, assetName: asset.name,
    bookValue, salePrice: normalizedSalePrice, gainLoss, date: asset.disposedAt, reason: asset.disposalReason,
    branchId: asset.branchId == null ? null : Number(asset.branchId),
    idempotencyKey: requestKey, requestFingerprint: requestKey ? requestFingerprint : null,
  };
  acc.assetDisposals.push(disposal);
  return { ok: true, disposal, journalLines: [
    { accountCode: '1890', debit: toInt(asset.accumulatedDepreciation), credit: 0, memo: `حذف استهلاک ${asset.name}`, branchId: asset.branchId || undefined },
    { accountCode: hasSalePrice ? '1210' : '6990', debit: normalizedSalePrice, credit: 0, memo: hasSalePrice ? `وجه فروش ${asset.name}` : `اسقاط ${asset.name}`, branchId: asset.branchId || undefined },
    { accountCode: asset.assetAccountCode || '1810', debit: 0, credit: toInt(asset.purchaseCost), memo: `حذف بهای ${asset.name}`, branchId: asset.branchId || undefined },
    ...(gainLoss !== 0 ? [{ accountCode: gainLoss > 0 ? '4500' : '6990', debit: gainLoss < 0 ? Math.abs(gainLoss) : 0, credit: gainLoss > 0 ? gainLoss : 0, memo: `سود/زیان فروش ${asset.name}`, branchId: asset.branchId || undefined }] : []),
  ]};
}

function transferAsset(acc, assetId, input = {}) {
  ensureAssets(acc);
  const asset = acc.fixedAssets.find(a => a.id === assetId);
  if (!asset) return { error: 'دارایی یافت نشد.' };
  const { toBranchId, date, idempotencyKey } = input;
  const requestKey = idempotencyKey == null ? null : String(idempotencyKey).trim();
  const requestFingerprint = JSON.stringify({ assetId, toBranchId: toBranchId == null ? null : Number(toBranchId), date: date || null });
  if (requestKey) {
    const existing = acc.assetTransfers.find((item) => item.idempotencyKey === requestKey);
    if (existing) {
      if (existing.requestFingerprint !== requestFingerprint) throw financeError('asset_transfer_idempotency_conflict', 'کلید idempotency انتقال قبلاً با بدنه متفاوت استفاده شده است.');
      return { ok: true, transfer: existing, asset, idempotentReplay: true };
    }
  }
  if (asset.status !== 'active') return { ok: false, error: 'فقط دارایی فعال قابل انتقال است.' };
  const targetBranchId = numericBranch(toBranchId, 'asset_transfer_branch_invalid');
  assertBranchExists(acc, targetBranchId);
  const fromBranch = asset.branchId;
  if (fromBranch != null && Number(fromBranch) === targetBranchId) return { ok: false, error: 'شعبه مقصد با شعبه فعلی یکسان است.' };
  const transferDate = parseDate(date || new Date().toISOString(), 'asset_transfer_date_invalid', 'تاریخ انتقال دارایی معتبر نیست.');
  const purchaseDate = parseDate(asset.purchaseDate, 'asset_date_invalid', 'تاریخ خرید دارایی معتبر نیست.');
  if (transferDate < purchaseDate) throw financeError('asset_transfer_date_invalid', 'تاریخ انتقال دارایی نمی‌تواند قبل از تاریخ خرید باشد.');
  assertOpenPeriod(acc, transferDate);
  asset.branchId = targetBranchId;
  const transfer = {
    id: `trf-${Date.now()}`, assetId, assetName: asset.name,
    fromBranch, toBranch: targetBranchId, date: transferDate.toISOString(), idempotencyKey: requestKey,
    requestFingerprint: requestKey ? requestFingerprint : null,
  };
  acc.assetTransfers.push(transfer);
  return { ok: true, transfer };
}

function createAsset(acc, data) {
  ensureAssets(acc);
  data = data || {};
  const requestKey = data.idempotencyKey == null ? null : String(data.idempotencyKey).trim();
  if (requestKey) {
    const existingByKey = acc.fixedAssets.find((candidate) => candidate.idempotencyKey === requestKey);
    if (existingByKey) {
      if (existingByKey.requestFingerprint !== assetFingerprint(data)) throw financeError('asset_idempotency_conflict', 'کلید idempotency دارایی قبلاً با بدنه متفاوت استفاده شده است.');
      return existingByKey;
    }
  }
  const name = String(data.name || '').trim().slice(0, 160);
  if (name.length < 2) throw financeError('asset_name_required', 'نام دارایی الزامی است.');
  const purchaseCost = safeAmount(data.purchaseCost, 'asset_cost_invalid', 'بهای دارایی باید عدد صحیح مثبت باشد.');
  const salvageValue = safeAmount(data.salvageValue == null || data.salvageValue === '' ? 0 : data.salvageValue, 'asset_salvage_invalid', 'ارزش اسقاط دارایی معتبر نیست.', { allowZero: true });
  if (salvageValue >= purchaseCost) throw financeError('asset_cost_invalid', 'ارزش اسقاط باید کمتر از بهای دارایی باشد.');
  const usefulLifeMonths = Number(data.usefulLifeMonths == null || data.usefulLifeMonths === '' ? 60 : data.usefulLifeMonths);
  if (!Number.isInteger(usefulLifeMonths) || usefulLifeMonths < 1 || usefulLifeMonths > 600) throw financeError('asset_life_invalid', 'عمر مفید دارایی باید بین ۱ تا ۶۰۰ ماه باشد.');
  const purchaseDate = parseDate(data.purchaseDate || new Date().toISOString(), 'asset_date_invalid', 'تاریخ خرید دارایی معتبر نیست.');
  const inServiceDate = parseDate(data.inServiceDate || purchaseDate.toISOString(), 'asset_date_invalid', 'تاریخ بهره‌برداری دارایی معتبر نیست.');
  if (inServiceDate < purchaseDate) throw financeError('asset_date_range_invalid', 'تاریخ بهره‌برداری نمی‌تواند قبل از خرید باشد.');
  const branchId = data.branchId == null || data.branchId === '' ? null : numericBranch(data.branchId);
  if (branchId != null) assertBranchExists(acc, branchId);
  const assetCode = String(data.assetCode || `AST-${acc.fixedAssets.length + 1}`).trim().toUpperCase();
  if (!/^[A-Z0-9_-]{3,40}$/.test(assetCode)) throw financeError('asset_code_invalid', 'کد دارایی معتبر نیست.');
  if (data.id && acc.fixedAssets.some((asset) => asset.id === data.id)) throw financeError('asset_id_duplicate', 'شناسه دارایی تکراری است.');
  if (acc.fixedAssets.some((asset) => String(asset.assetCode || '').toUpperCase() === assetCode && asset.status !== 'rejected' && Number(asset.branchId || 0) === Number(branchId || 0))) {
    throw financeError('asset_code_duplicate', 'کد دارایی در این شعبه تکراری است.');
  }
  assertOpenPeriod(acc, purchaseDate);
  const depreciationMethod = data.depreciationMethod || 'straight_line';
  if (!['straight_line', 'declining_balance', 'units_of_production'].includes(depreciationMethod)) throw financeError('asset_depreciation_method_invalid', 'روش استهلاک دارایی معتبر نیست.');
  const id = data.id || `fa-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const asset = {
    id, assetCode,
    name, category: data.category || 'تجهیزات',
    purchaseDate: purchaseDate.toISOString(), inServiceDate: inServiceDate.toISOString(),
    purchaseCost, salvageValue,
    usefulLifeMonths,
    depreciationMethod,
    accumulatedDepreciation: 0, status: 'active', branchId,
    assetAccountCode: data.assetAccountCode || data.accountCode || '1810',
    idempotencyKey: requestKey, requestFingerprint: requestKey ? assetFingerprint(data) : null,
  };
  acc.fixedAssets.push(asset);
  return asset;
}

function getAssetRegister(acc, branchId) {
  ensureAssets(acc);
  const normalizedBranchId = branchId == null || branchId === '' ? null : numericBranch(branchId);
  return (acc.fixedAssets || [])
    .filter(a => normalizedBranchId == null || Number(a.branchId) === normalizedBranchId)
    .map(a => ({
      ...a,
      bookValue: Math.max(0, toInt(a.purchaseCost) - toInt(a.accumulatedDepreciation)),
      depPct: toInt(a.purchaseCost) > 0 ? Math.min(100, Math.max(0, Math.round(toInt(a.accumulatedDepreciation) / toInt(a.purchaseCost) * 100))) : 0,
    }));
}

module.exports = {
  ensureAssets, calcMonthlyDep, runDepreciation, disposeAsset,
  transferAsset, reverseDepreciationRun, createAsset, getAssetRegister,
};
