'use strict';

/*
 * Deterministic, read-only guidance for the finance cutover gates.
 *
 * This module deliberately does not mutate a database and does not provide a
 * "seed" path for financial transactions.  It turns failed preflight gates
 * into an operator checklist, while making the distinction between evidence
 * that can be produced by the application and evidence that must come from
 * the business owner, bank, or PSP explicit.
 */

const GATE_PLANS = Object.freeze({
  postgres_required: {
    owner: 'release engineer + finance owner',
    class: 'infrastructure',
    safeToAutomate: true,
    action: 'مرجع مالی PostgreSQL نرمال را برای این شعبه فعال و هویت، schema و اتصال پایدار آن را ثبت کنید.',
    evidence: ['database identity', 'normalized schema check', 'runtime storage status'],
    verify: 'npm run postgres:status && npm run postgres:preflight',
    stop: 'در زمان cutover به snapshot یا fallback JSON به‌عنوان مرجع مالی سوئیچ نکنید.',
  },
  normalized_schema: {
    owner: 'release engineer',
    class: 'infrastructure',
    safeToAutomate: true,
    action: 'تمام relationهای schema نرمال Finance V2 و وابستگی unified operational را با migrationهای ثبت‌شده ایجاد و بررسی کنید.',
    evidence: ['normalized relation inventory', 'operational relation inventory', 'migration output'],
    verify: 'npm run postgres:migrate:plan && npm run postgres:preflight',
    stop: 'مهاجرت را با حذف جدول، disable کردن FK یا بازگشت به JSON دور نزنید.',
  },
  migration_ledger: {
    owner: 'migration reviewer',
    class: 'data_integrity',
    safeToAutomate: true,
    action: 'ledger مهاجرت را ایجاد و برای هر فایل نسخه، نام فایل و checksum را ثبت کنید.',
    evidence: ['finance_schema_migrations rows', 'migration plan', 'zero checksum drift'],
    verify: 'npm run postgres:migrate:plan',
    stop: 'نسخه یا checksum را دستی در ledger تغییر ندهید تا migration ظاهراً اعمال‌شده جلوه کند.',
  },
  migration_checksums: {
    owner: 'migration reviewer',
    class: 'data_integrity',
    safeToAutomate: true,
    action: 'migrationهای pending یا checksumهای متفاوت را با backup و review اصلاح کنید و plan را به صفر برسانید.',
    evidence: ['migration plan', 'backup reference', 'zero pending and drift'],
    verify: 'npm run postgres:migrate:plan',
    stop: 'checksum mismatch را با ثبت جعلی در ledger یا حذف migration پنهان نکنید.',
  },
  destination_snapshot: {
    owner: 'release engineer + migration reviewer',
    class: 'data_integrity',
    safeToAutomate: true,
    action: 'snapshot durable عملیاتی را با نسخه و checksum در مقصد ثبت و وجود آن را read-only بررسی کنید.',
    evidence: ['westo_state version', 'canonical snapshot SHA-256', 'source snapshot reference'],
    verify: 'npm run postgres:preflight',
    stop: 'برای ساخت snapshot مقصد از دادهٔ حدسی یا fixture مالی استفاده نکنید.',
  },
  snapshot_reconciliation: {
    owner: 'accountant + migration reviewer',
    class: 'reconciliation',
    safeToAutomate: false,
    action: 'مجموعهٔ reconciliation عملیاتی، پرداخت، فروش و دفتر را با source snapshot تطبیق دهید و اختلاف را با سند اصلاحی معتبر حل کنید.',
    evidence: ['source/destination reconciliation diff', 'journal correction or reversal chain'],
    verify: 'npm run postgres:preflight',
    stop: 'با صفر کردن مبلغ، حذف رکورد یا update مستقیم snapshot اختلاف را پنهان نکنید.',
  },
  sales_reconciliation: {
    owner: 'accountant',
    class: 'reconciliation',
    safeToAutomate: false,
    action: 'فروش عملیاتی، tenderهای موفق، سند فروش و COGS همان سفارش را به‌صورت branch-scoped تطبیق دهید.',
    evidence: ['order chain', 'succeeded payment', 'posted sale and COGS journals'],
    verify: 'GET /api/admin/v2/finance/sales-cash-bank?branchId=<branchId>',
    stop: 'پرداخت موفق بدون سند posted یا فروش بدون tender معتبر را پذیرفته تلقی نکنید.',
  },
  ledger_balance: {
    owner: 'accountant',
    class: 'ledger_integrity',
    safeToAutomate: false,
    action: 'مجموع بدهکار و بستانکار هر سند و کل دفتر را بررسی و مغایرت را فقط با reversal/correction معتبر حل کنید.',
    evidence: ['journal entry totals', 'journal line totals', 'reversal links'],
    verify: 'npm run postgres:preflight',
    stop: 'با update مستقیم total یا حذف line مغایرت را پنهان نکنید.',
  },
  no_legacy_unified_journals: {
    owner: 'migration reviewer + accountant',
    class: 'cutover_integrity',
    safeToAutomate: false,
    action: 'هر سند باقی‌مانده در دفتر legacy را classify و با تصمیم مستند archive یا backfill کنید.',
    evidence: ['legacy journal inventory', 'archive decision trail', 'approved backfill chain'],
    verify: 'GET /api/admin/v2/finance/migration/archive?branchId=<branchId>',
    stop: 'دفتر legacy را برای کاهش count حذف یا truncate نکنید.',
  },
  complete_orders: {
    owner: 'operations + accountant',
    class: 'real_operations',
    safeToAutomate: false,
    action: 'ثبت حداقل ۱۰۰ سفارش واقعی پرداخت‌شده که فروش، tender و COGS آن‌ها در همان شعبه قابل ردیابی باشد.',
    evidence: ['order.paid event', 'succeeded payment rows', 'posted order.cogs event', 'balanced journal entry'],
    verify: 'npm run postgres:preflight',
    stop: 'از fixture، سفارش ساختگی، مبلغ فرضی یا post مستقیم دفتر برای عبور از این گیت استفاده نشود.',
  },
  operating_days: {
    owner: 'operations + accountant',
    class: 'real_operations',
    safeToAutomate: false,
    action: 'پوشش حداقل ۷ روز تقویمی با سفارش‌های کامل واقعی برقرار شود؛ روزها باید از occurredAt رویدادهای ثبت‌شده محاسبه شوند.',
    evidence: ['Tehran-local operating day keys', 'complete order chain per day'],
    verify: 'npm run postgres:preflight',
    stop: 'تغییر تاریخ fixture یا پخش مصنوعی سفارش‌ها روی روزها قابل قبول نیست.',
  },
  open_period: {
    owner: 'owner / authorized accountant',
    class: 'controlled_accounting_action',
    safeToAutomate: false,
    action: 'وضعیت دوره را با درخواست بازگشایی کنترل‌شده، علت، actor و تأیید مستقل به open یا reopened برسانید.',
    evidence: ['period id and branch', 'reopen reason', 'requester and approver audit trail'],
    verify: 'npm run postgres:preflight',
    stop: 'دوره را مستقیم در JSON/PostgreSQL به open تغییر ندهید و قبل از تأیید مستقل post نکنید.',
  },
  migration_baseline: {
    owner: 'accountant + migration reviewer',
    class: 'read_only_classification_then_approval',
    safeToAutomate: true,
    action: 'ابتدا classify/archive را با branchId اجرا و checksum خط مبنا را ثبت کنید؛ سپس هر رکورد نیازمند مدرک را جداگانه تصمیم‌گذاری کنید.',
    evidence: ['source snapshot SHA-256', 'source keys/fingerprints', 'immutable archive rows', 'review notes and evidence references'],
    verify: 'npm run evidence:finance-cutover',
    stop: 'رکورد quarantined یا inferred را بدون مدرک مالک/بررسی مستقل به backfill تبدیل نکنید.',
  },
  migration_archive_coverage: {
    owner: 'migration reviewer',
    class: 'data_integrity',
    safeToAutomate: true,
    action: 'آرشیو تغییرناپذیر را با baseline مقایسه و رکوردهای جدید بدون branch را scope یا quarantine کنید؛ snapshot اصلی نباید بازنویسی شود.',
    evidence: ['exact source key match', 'fingerprint match', 'zero new unscoped records'],
    verify: 'npm run postgres:preflight',
    stop: 'برای کاهش count، archive یا رکورد legacy را حذف نکنید.',
  },
  migration_archive_complete: {
    owner: 'migration reviewer',
    class: 'data_integrity',
    safeToAutomate: true,
    action: 'کلید و fingerprint آرشیو مقصد را دقیقاً با baseline منبع تطبیق دهید؛ هر رکورد جدید بدون branch را scope یا quarantine کنید.',
    evidence: ['exact source key match', 'fingerprint match', 'zero missing/unexpected/unscoped records'],
    verify: 'npm run postgres:preflight',
    stop: 'رکوردهای اضافه، missing یا unscoped را با حذف یا تغییر snapshot پنهان نکنید.',
  },
  historical_evidence: {
    owner: 'accountant + migration reviewer',
    class: 'read_only_classification_then_approval',
    safeToAutomate: true,
    action: 'زنجیرهٔ شواهد سفارش‌های legacy را classify کنید؛ verified، نیازمند مدرک و quarantined را جدا نگه دارید.',
    evidence: ['source snapshot SHA-256', 'classification records', 'owner evidence references'],
    verify: 'npm run evidence:finance-cutover',
    stop: 'رکورد quarantined یا inferred را به سفارش پرداخت‌شده یا سند دفتر تبدیل نکنید.',
  },
  shadow_thresholds: {
    owner: 'operations + accountant',
    class: 'real_operations',
    safeToAutomate: false,
    action: 'حداقل سفارش و روز عملیاتی واقعی را با زنجیرهٔ کامل فروش، tender و COGS تکمیل کنید.',
    evidence: ['complete order chain', 'Tehran-local operating days', 'posted sale and COGS journals'],
    verify: 'npm run postgres:preflight',
    stop: 'تاریخ، مبلغ یا status سفارش را برای عبور از threshold جعل نکنید.',
  },
  unresolved_events: {
    owner: 'accountant + operations',
    class: 'operational_queue',
    safeToAutomate: false,
    action: 'رویدادهای pending/blocked/failed را با علت و resolution یا reversal مستند تعیین تکلیف کنید.',
    evidence: ['event error code', 'resolution chain', 'reconciliation result'],
    verify: 'GET /api/admin/v2/finance/events?branchId=<branchId>&status=blocked',
    stop: 'status رویداد را بدون سند اصلاحی تغییر ندهید و رویداد را حذف نکنید.',
  },
  pending_approvals: {
    owner: 'independent approver',
    class: 'segregation_of_duties',
    safeToAutomate: false,
    action: 'تأییدهای معطل را با actor مستقل و audit trail کامل approve یا reject کنید.',
    evidence: ['approval id', 'requester/approver identities', 'decision audit trail'],
    verify: 'GET /api/admin/v2/finance/approvals?branchId=<branchId>&status=pending',
    stop: 'درخواست‌کننده نباید تأییدکنندهٔ همان عملیات باشد و approval را مستقیم حذف نکنید.',
  },
  migration_decisions: {
    owner: 'accountant + migration reviewer',
    class: 'read_only_classification_then_approval',
    safeToAutomate: false,
    action: 'هر پروندهٔ migration را approve، reject یا quarantine کنید و backfill را فقط پس از تأیید معتبر درخواست دهید.',
    evidence: ['decision notes', 'decision history', 'backfill request and journal link'],
    verify: 'GET /api/admin/v2/finance/migration/archive?branchId=<branchId>',
    stop: 'backfill نیمه‌کاره را posted تلقی نکنید و دادهٔ archive را بازنویسی نکنید.',
  },
  data_quality: {
    owner: 'accountant + domain owner',
    class: 'issue_specific',
    safeToAutomate: false,
    action: 'هر issue را در workbench باز کنید؛ branch reference، زنجیرهٔ تأیید رسپی، duplicate، tender، event یا period را با مسیر domain خودش اصلاح کنید.',
    evidence: ['issue code and record ids', 'reversal or correction chain', 'reconciliation result'],
    verify: 'GET /api/admin/v2/finance/workbench?branchId=<branchId>',
    stop: 'دادهٔ نامشخص را با صفر یا مقدار پیش‌فرض معتبر جلوه ندهید.',
  },
  no_destination_exceptions: {
    owner: 'accountant',
    class: 'operational_queue',
    safeToAutomate: false,
    action: 'تمام رویدادهای pending/blocked/failed و approvalهای pending را با علت و مسیر اصلاحی تعیین تکلیف کنید.',
    evidence: ['event resolution or reversal', 'approval decision audit'],
    verify: 'npm run postgres:preflight',
    stop: 'ردیف exception را حذف یا status آن را بدون chain اصلاحی تغییر ندهید.',
  },
  ledger_balance: {
    owner: 'accountant',
    class: 'ledger_integrity',
    safeToAutomate: false,
    action: 'entry و lineهای نامتوازن را با reversal/correction معتبر بررسی کنید و مجموع بدهکار/بستانکار را برابر نگه دارید.',
    evidence: ['journal entry totals', 'journal line totals', 'reversal links'],
    verify: 'npm run postgres:preflight',
    stop: 'با update مستقیم total یا حذف line مغایرت را پنهان نکنید.',
  },
  destination_reachable: {
    owner: 'release engineer',
    class: 'infrastructure',
    safeToAutomate: true,
    action: 'اتصال به PostgreSQL اختصاصی، schema نرمال و migration ledger را بررسی کنید.',
    evidence: ['database identity', 'normalized schema check', 'migration plan with zero pending/drift'],
    verify: 'npm run postgres:status && npm run postgres:preflight',
    stop: 'به fallback JSON به‌عنوان مرجع انتشار مالی سوئیچ نکنید.',
  },
});

function gateValue(readiness, id) {
  return Array.isArray(readiness?.gates) ? readiness.gates.find((gate) => gate.id === id) || null : null;
}

function failedGateIds(readiness) {
  return (Array.isArray(readiness?.gates) ? readiness.gates : [])
    .filter((gate) => gate && gate.passed !== true)
    .map((gate) => String(gate.id));
}

function gateIdsFrom(gates) {
  return (Array.isArray(gates) ? gates : [])
    .filter((gate) => gate && gate.passed !== true && gate.id)
    .map((gate) => String(gate.id));
}

function qualityCodes(readiness, qualityIssues = []) {
  const values = gateValue(readiness, 'data_quality')?.value;
  const fromGate = Array.isArray(values) ? values : [];
  return [...new Set([...fromGate, ...qualityIssues].map((issue) => typeof issue === 'string' ? issue : issue?.code).filter(Boolean))].sort();
}

function buildCutoverRunbook({ shadowReadiness = {}, qualityIssues = [], destination = null, preflightGates = [] } = {}) {
  const failed = [...failedGateIds(shadowReadiness), ...gateIdsFrom(preflightGates)];
  const ids = [...new Set(failed)];
  if (qualityCodes(shadowReadiness, qualityIssues).length && !ids.includes('data_quality')) ids.push('data_quality');
  if (!destination?.available && !ids.includes('destination_reachable')) ids.unshift('destination_reachable');
  const steps = ids.map((gateId, index) => {
    const plan = GATE_PLANS[gateId] || {
      owner: 'release owner', class: 'unmapped_release_gate', safeToAutomate: false,
      action: `گیت «${gateId}» را بررسی و شواهد معتبر آن را ثبت کنید.`, evidence: ['gate-specific evidence'],
      verify: 'npm run postgres:preflight', stop: 'تا تعیین تکلیف صریح این گیت، cutover را انجام ندهید.',
    };
    const gate = gateValue(shadowReadiness, gateId);
    return {
      order: index + 1,
      id: `cutover-${gateId}`,
      gateId,
      owner: plan.owner,
      class: plan.class,
      safeToAutomate: plan.safeToAutomate,
      currentValue: gate?.value ?? null,
      action: plan.action,
      evidence: plan.evidence,
      verify: plan.verify,
      stop: plan.stop,
    };
  });
  return {
    version: 1,
    status: shadowReadiness.status === 'READY_FOR_CUTOVER_REVIEW' && steps.length === 0 ? 'READY_FOR_CUTOVER_REVIEW' : 'NO_GO',
    policy: {
      readOnly: true,
      noSyntheticFinancialData: true,
      externalEvidenceRequiredForPSPAndOwnerActions: true,
      automaticCutover: false,
    },
    qualityCodes: qualityCodes(shadowReadiness, qualityIssues),
    steps,
  };
}

module.exports = { GATE_PLANS, failedGateIds, gateIdsFrom, qualityCodes, buildCutoverRunbook };
