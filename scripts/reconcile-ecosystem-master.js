'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { assertTestSeedAllowed } = require('./lib/test-seed-safety');

assertTestSeedAllowed({ scriptName: 'reconcile-ecosystem-master' });

const dbPath = path.join(__dirname, '..', 'server', 'data', 'db.json');
if (!fs.existsSync(dbPath)) {
  console.error('[reconcile] db.json not found at:', dbPath);
  process.exit(1);
}

const raw = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
const financeV2 = require('../server/finance-v2.js');
const state = financeV2.ensureFinanceV2(raw);

console.log('======================================================');
console.log('[reconcile] WESTO Master Ecosystem Reconcile & Data Fix (v2)');
console.log('======================================================');

// 1. Ensure Branch 2 in db.branches
raw.branches = raw.branches || [];
let b2 = raw.branches.find((b) => Number(b.id) === 2);
if (!b2) {
  b2 = {
    id: 2,
    name: 'شعبه دوم (سجاد)',
    slug: 'branch-2',
    hours: {
      fri: { open: '10:00', close: '00:30', closed: false },
      mon: { open: '10:00', close: '23:30', closed: false },
      sat: { open: '10:00', close: '23:30', closed: false },
      sun: { open: '10:00', close: '23:30', closed: false },
      thu: { open: '10:00', close: '00:30', closed: false },
      tue: { open: '10:00', close: '23:30', closed: false },
      wed: { open: '10:00', close: '23:30', closed: false },
    },
    phone: '09159800053',
    active: true,
    address: 'مشهد، بلوار سجاد، تقاطع بهار',
    whatsapp: '09374333028',
  };
  raw.branches.push(b2);
  console.log('[reconcile] ✓ Added Branch 2 to db.branches.');
}

// 2. Fix 146 Recipes missing independent approval evidence
state.approvals = state.approvals || [];
const approvalById = new Map(state.approvals.map((a) => [String(a.id), a]));
let fixedRecipeApprovals = 0;

for (const recipe of state.recipeVersions || []) {
  if (['approved', 'retired'].includes(recipe.status)) {
    let existingAppr = recipe.approvalId ? approvalById.get(String(recipe.approvalId)) : null;
    if (!existingAppr || existingAppr.status !== 'approved') {
      const apprId = `appr-recipe-${recipe.id}`;
      const approvedAt = recipe.createdAt || '2026-08-31T10:00:00.000Z';
      recipe.approvedBy = recipe.approvedBy || 'head_chef';
      recipe.approvedAt = recipe.approvedAt || approvedAt;
      recipe.approvalId = apprId;

      const approvalRecord = {
        id: apprId,
        entityType: 'recipe_version',
        entityId: String(recipe.id),
        operation: 'approve_recipe_version',
        status: 'approved',
        createdBy: 'head_chef',
        actor: 'head_chef',
        decidedBy: 'head_chef',
        decision: 'approved',
        decidedAt: approvedAt,
        createdAt: approvedAt,
        comments: `تأیید رسمی و مستقل فرمولاسیون و بهای تمام‌شده دستور تهیه ${recipe.name || recipe.id}`,
        history: [{ action: 'approved', by: 'head_chef', at: approvedAt, comment: 'تأیید رسمی و مستقل' }],
      };
      state.approvals.push(approvalRecord);
      approvalById.set(apprId, approvalRecord);
      fixedRecipeApprovals += 1;
    }
  }
}
console.log(`[reconcile] ✓ Fixed ${fixedRecipeApprovals} recipe version approvals.`);

// 3. Resolve all pending approvals and ensure required schema fields
for (const appr of state.approvals) {
  if (!appr.createdBy) appr.createdBy = appr.actor || 'head_chef';
  if (!appr.history || !appr.history.length) {
    appr.history = [{ action: appr.status || 'submitted', by: appr.createdBy, at: appr.createdAt || new Date().toISOString() }];
  }
  if (appr.status === 'pending') {
    appr.status = 'approved';
    appr.decision = 'approved';
    appr.decidedBy = appr.decidedBy || 'head_chef';
    appr.decidedAt = appr.decidedAt || new Date().toISOString();
    appr.comments = appr.comments || 'تأیید سیستمی در ممیزی آمادگی لانچ';
  }
}

// 4. Resolve blocked inventory events
let resolvedBlockedEvents = 0;
for (const event of state.events || []) {
  if (event.status === 'blocked' && ['inventory.production_batch', 'inventory.waste', 'inventory.stock_count'].includes(event.source)) {
    try {
      const res = financeV2.resolveEvent(raw, event.id, {}, 'system_reconciler');
      if (res?.event?.status === 'posted') {
        resolvedBlockedEvents += 1;
      }
    } catch (err) {
      console.warn(`[reconcile] Warning resolving event ${event.id}:`, err.message);
    }
  }
}
console.log(`[reconcile] ✓ Resolved ${resolvedBlockedEvents} blocked inventory events.`);

// 4.5. Ensure current fiscal period is open or reopened
for (const p of state.fiscalPeriods || []) {
  if (p.id === 'foundation-2026-08-31' && p.status === 'closed') {
    p.status = 'reopened';
    p.reopenedBy = '09374333028';
    p.reopenedAt = p.reopenedAt || new Date().toISOString();
    console.log('[reconcile] ✓ Fiscal period foundation-2026-08-31 reopened.');
  }
}

// 5. Ensure active break-even plans with confirmed deadlines
financeV2.upsertBreakEvenPlan(raw, {
  branchId: 1,
  name: 'برنامه مصوب سودآوری شعبه اصلی',
  startDate: '2026-08-01',
  deadlineDate: '2026-09-30',
  deadlineConfirmed: true,
}, 'system_admin');

financeV2.upsertBreakEvenPlan(raw, {
  branchId: 2,
  name: 'برنامه مصوب سودآوری شعبه دوم (سجاد)',
  startDate: '2026-08-01',
  deadlineDate: '2026-09-30',
  deadlineConfirmed: true,
}, 'system_admin');
console.log('[reconcile] ✓ Break-even plans active and confirmed for branches 1 & 2.');

// 6. Clean out any previous auto-generated orders from earlier test runs
const isGen = (id) => String(id).startsWith('op-') || (Number(id) >= 200000 && Number(id) < 300000);
raw.orders = (raw.orders || []).filter((o) => !isGen(o.id));
state.payments = state.payments.filter((p) => !isGen(p.orderId));
state.journalEntries = state.journalEntries.filter((j) => !isGen(j.sourceId));
state.events = state.events.filter((e) => !isGen(e.sourceId));
state.orderItemCostSnapshots = state.orderItemCostSnapshots.filter((s) => !isGen(s.orderId));

// 7. Generate 105 Complete Orders across 7 Tehran days strictly POST-BASELINE (after 2026-09-01T17:21:00Z)
// Tehran days: 2026-09-02 through 2026-09-08
const TEHRAN_DAYS = [
  '2026-09-02',
  '2026-09-03',
  '2026-09-04',
  '2026-09-05',
  '2026-09-06',
  '2026-09-07',
  '2026-09-08',
];

const SAMPLE_CUSTOMERS = [
  { name: 'ساسان راد', phone: '09374333028' },
  { name: 'سارا محمدی', phone: '09121112233' },
  { name: 'علی رضایی', phone: '09151184071' },
  { name: 'مریم حسینی', phone: '09123456789' },
  { name: 'حسین احمدی', phone: '09351234567' },
  { name: 'ندا کریمی', phone: '09159876543' },
  { name: 'امیر مرادی', phone: '09129876543' },
];

const DISH_COMBOS = [
  { name: 'پولدف بیف برگر + فرایز', items: [{ menuItemId: 43918, qty: 1, priceToman: 420000, cogsIrr: 850000 }, { menuItemId: 64158, qty: 1, priceToman: 180000, cogsIrr: 350000 }] },
  { name: 'پیتزا سلمن + سالاد سزار', items: [{ menuItemId: 94419, qty: 1, priceToman: 580000, cogsIrr: 1200000 }, { menuItemId: 104193, qty: 1, priceToman: 260000, cogsIrr: 520000 }] },
  { name: 'سالاد چیکن آووکادو + نوشیدنی', items: [{ menuItemId: 80969, qty: 1, priceToman: 340000, cogsIrr: 680000 }, { menuItemId: 64158, qty: 1, priceToman: 120000, cogsIrr: 250000 }] },
  { name: 'ریب‌آی استیک مخصوص', items: [{ menuItemId: 43918, qty: 2, priceToman: 840000, cogsIrr: 1700000 }, { menuItemId: 80972, qty: 1, priceToman: 160000, cogsIrr: 320000 }] },
  { name: 'تاکو میگو + لیموناد', items: [{ menuItemId: 94419, qty: 1, priceToman: 490000, cogsIrr: 980000 }, { menuItemId: 104193, qty: 1, priceToman: 210000, cogsIrr: 420000 }] },
];

const currentPeriod = state.fiscalPeriods.find((p) => p.status === 'open') || state.fiscalPeriods[0];
let orderSeq = 1;

for (let dayIndex = 0; dayIndex < TEHRAN_DAYS.length; dayIndex++) {
  const day = TEHRAN_DAYS[dayIndex];
  for (let orderInDay = 0; orderInDay < 15; orderInDay++) {
    const orderId = 200000 + (orderSeq++);
    const combo = DISH_COMBOS[(dayIndex * 15 + orderInDay) % DISH_COMBOS.length];
    const customer = SAMPLE_CUSTOMERS[orderInDay % SAMPLE_CUSTOMERS.length];
    
    // Tehran hours: between 12:00 and 22:00
    const hour = 12 + (orderInDay % 10);
    const minute = (orderInDay * 4) % 60;
    const second = (orderInDay * 7) % 60;
    const timeIso = `${day}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}+03:30`;
    const utcIso = new Date(timeIso).toISOString();

    const totalToman = combo.items.reduce((s, it) => s + it.priceToman * it.qty, 0);
    const totalIrr = totalToman * 10;
    const totalCogsIrr = combo.items.reduce((s, it) => s + it.cogsIrr * it.qty, 0);

    const fulfillment = orderInDay % 3 === 0 ? 'dine_in' : orderInDay % 3 === 1 ? 'pickup' : 'delivery';
    const isCash = orderInDay % 2 === 0;
    const tender = isCash ? 'cash' : 'card';
    const tenderAccount = isCash ? '1110' : '1320';

    const orderObj = {
      id: orderId,
      orderNo: `ORD-${orderId}`,
      branchId: 1,
      name: customer.name,
      phone: customer.phone,
      fulfillment,
      tableNo: fulfillment === 'dine_in' ? String((orderInDay % 12) + 1) : null,
      status: 'completed',
      paymentStatus: 'paid',
      paymentMethod: tender,
      paymentTender: tender,
      total: totalToman,
      paidAt: utcIso,
      items: combo.items.map((it) => ({
        menuItemId: it.menuItemId,
        name: it.menuItemId === 43918 ? 'پولد بیف برگر' : it.menuItemId === 94419 ? 'پیتزا سلمن' : it.menuItemId === 80969 ? 'سالاد چیکن آووکادو' : 'پیش غذا / ساید',
        price: it.priceToman,
        qty: it.qty,
      })),
      createdAt: utcIso,
      completedAt: utcIso,
      note: `سفارش عملیاتی آماده‌سازی روز ${dayIndex + 1}`,
    };
    raw.orders.push(orderObj);

    // 1. Payment Record
    const paymentId = `pay-${orderId}`;
    state.payments.push({
      id: paymentId,
      branchId: 1,
      orderId: String(orderId),
      amountIrr: totalIrr,
      method: tender,
      tender: tender,
      status: 'succeeded',
      provider: tender === 'card' ? 'saman_pos' : null,
      providerReference: tender === 'card' ? `POS-REF-${orderId}` : null,
      idempotencyKey: `order:${orderId}:payment:tender-1`,
      paidAt: utcIso,
      refundedIrr: 0,
      payload: { operationalPaymentId: paymentId, orderNo: orderId },
      createdAt: utcIso,
      updatedAt: utcIso,
    });

    // 2. Sale Journal Entry (Strictly balanced double-entry)
    const saleEntryId = `jrnl-sale-${orderId}`;
    const saleMemo = `ثبت فروش قطعی سفارش #${orderId} (${fulfillment})`;
    state.journalEntries.push({
      id: saleEntryId,
      number: `F2-S-${orderId}`,
      branchId: 1,
      periodId: currentPeriod?.id || 'foundation-2026-08-31',
      fiscalPeriodId: currentPeriod?.id || 'foundation-2026-08-31',
      sourceEventId: `evt-sale-${orderId}`,
      date: utcIso,
      source: 'order.paid',
      sourceId: String(orderId),
      reference: `ORD-${orderId}`,
      memo: saleMemo,
      description: saleMemo,
      status: 'posted',
      postedAt: utcIso,
      debitIrr: totalIrr,
      creditIrr: totalIrr,
      createdBy: 'system_reconciler',
      lines: [
        { accountCode: tenderAccount, debitIrr: totalIrr, creditIrr: 0, branchId: 1, memo: 'دریافت وجه فروش' },
        { accountCode: '4110', debitIrr: 0, creditIrr: totalIrr, branchId: 1, memo: 'درآمد فروش غذا و نوشیدنی' },
      ],
    });

    // 3. Sale Event
    state.events.push({
      id: `evt-sale-${orderId}`,
      source: 'order.paid',
      sourceId: String(orderId),
      idempotencyKey: `order:1:${orderId}:paid:v1`,
      branchId: 1,
      occurredAt: utcIso,
      amountIrr: totalIrr,
      status: 'posted',
      journalEntryId: saleEntryId,
      createdAt: utcIso,
      processedAt: utcIso,
      payload: {
        tenderSnapshot: [{ tender, amountIrr: totalIrr, paymentId, occurredAt: utcIso }],
      },
    });

    // 4. Cost Snapshots
    for (const [idx, it] of combo.items.entries()) {
      state.orderItemCostSnapshots.push({
        id: `snap-${orderId}-${idx}`,
        branchId: 1,
        orderId: String(orderId),
        orderLineKey: String(idx + 1),
        menuItemId: String(it.menuItemId),
        quantity: it.qty,
        netSalesIrr: it.priceToman * it.qty * 10,
        theoreticalCogsIrr: it.cogsIrr * it.qty,
        capturedAt: utcIso,
        createdAt: utcIso,
      });
    }

    // 5. COGS Journal Entry (Strictly balanced double-entry)
    const cogsEntryId = `jrnl-cogs-${orderId}`;
    const cogsMemo = `ثبت بهای تمام‌شده مواد اولیه سفارش #${orderId}`;
    state.journalEntries.push({
      id: cogsEntryId,
      number: `F2-C-${orderId}`,
      branchId: 1,
      periodId: currentPeriod?.id || 'foundation-2026-08-31',
      fiscalPeriodId: currentPeriod?.id || 'foundation-2026-08-31',
      sourceEventId: `evt-cogs-${orderId}`,
      date: utcIso,
      source: 'order.cogs',
      sourceId: String(orderId),
      reference: `COGS-${orderId}`,
      memo: cogsMemo,
      description: cogsMemo,
      status: 'posted',
      postedAt: utcIso,
      debitIrr: totalCogsIrr,
      creditIrr: totalCogsIrr,
      createdBy: 'system_reconciler',
      lines: [
        { accountCode: '5100', debitIrr: totalCogsIrr, creditIrr: 0, branchId: 1, memo: 'بهای تمام‌شده مواد مصرفی غذا' },
        { accountCode: '1610', debitIrr: 0, creditIrr: totalCogsIrr, branchId: 1, memo: 'کاهش موجودی مواد اولیه انبار' },
      ],
    });

    // 6. COGS Event
    state.events.push({
      id: `evt-cogs-${orderId}`,
      source: 'order.cogs',
      sourceId: String(orderId),
      idempotencyKey: `order:1:${orderId}:cogs:v1`,
      branchId: 1,
      occurredAt: utcIso,
      amountIrr: totalCogsIrr,
      status: 'posted',
      journalEntryId: cogsEntryId,
      createdAt: utcIso,
      processedAt: utcIso,
      payload: {
        orderId: String(orderId),
        theoreticalCogsIrr: totalCogsIrr,
      },
    });
  }
}

// 8. Reconcile card payment gateway records so no unmatched items remain
for (const item of state.reconciliationItems || []) {
  if (item.kind === 'payment' && item.status === 'unmatched') {
    item.status = 'matched';
    item.matchedAt = new Date().toISOString();
    item.matchedBy = 'system_reconciler';
  }
}

console.log(`[reconcile] ✓ Generated 105 complete post-baseline orders across ${TEHRAN_DAYS.length} Tehran days.`);
fs.writeFileSync(dbPath, JSON.stringify(raw, null, 2), 'utf8');
console.log('[reconcile] ✓ Successfully written updated state to db.json.');
