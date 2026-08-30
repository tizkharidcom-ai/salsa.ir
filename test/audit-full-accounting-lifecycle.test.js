'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const accounting = require('../server/accounting-engine');
const money = require('../server/finance/money');
const periodService = require('../server/finance/period-service');
const taxEngine = require('../server/finance/tax-engine');
const inventoryEngine = require('../server/finance/inventory-engine');
const assetEngine = require('../server/finance/asset-engine');
const accrualEngine = require('../server/finance/accrual-engine');
const procurementEngine = require('../server/finance/procurement-engine');
const reconciliationEngine = require('../server/finance/reconciliation-engine');
const consolidationEngine = require('../server/finance/consolidation-engine');
const auditEngine = require('../server/finance/audit-engine');
const salesPosEngine = require('../server/finance/sales-pos-engine');
const payrollEngine = require('../server/finance/payroll-engine');
const fnbCostOptimizer = require('../server/finance/fnb-cost-optimizer');

function createFullLifecycleDb() {
  const db = {
    branches: [
      { id: 1, name: 'شعبه مرکزی', code: 'main', active: true },
      { id: 2, name: 'شعبه دوم', code: 'second', active: true },
    ],
    orders: [],
    posSales: [],
    posRefunds: [],
    accounting: {
      fiscalPeriods: [
        {
          id: 'p-1405-06',
          name: 'دوره ماهانه شهریور ۱۴۰۵',
          startDate: '2026-08-23',
          endDate: '2026-09-22',
          status: 'open',
        },
      ],
      journalEntries: [],
      auditLogs: [],
      inventoryItems: [
        { id: 'item-meat', sku: 'MEAT-01', name: 'گوشت گوساله چرخ‌کرده', unit: 'کیلوگرم', qtyOnHand: 50, avgCostIrr: 4000000, branchId: 1 },
        { id: 'item-bread', sku: 'BREAD-01', name: 'نان برگر فرانسوی', unit: 'عدد', qtyOnHand: 200, avgCostIrr: 150000, branchId: 1 },
        { id: 'item-sauce-wip', sku: 'SAUCE-WIP', name: 'سس برگر آماده‌سازی', unit: 'کیلوگرم', qtyOnHand: 0, avgCostIrr: 0, branchId: 1 },
      ],
      recipes: [],
      vendors: [
        { id: 'v-meat-supplier', name: 'بازرگانی گوشت البرز', nameFa: 'بازرگانی گوشت البرز', phone: '02188880001', category: 'پروتئین', termsDays: 30, balance: 0, branchId: 1 },
      ],
      employees: [
        { id: 'emp-chef', name: 'سرآشپز اجرایی', branchId: 1, department: 'kitchen', baseSalary: 250000000, active: true },
        { id: 'emp-waiter', name: 'مدیر سالن', branchId: 1, department: 'service', baseSalary: 180000000, active: true },
      ],
    },
  };

  accounting.ensureAccountingData(db);
  return db;
}

test('Comprehensive End-to-End Accounting Lifecycle: All 100 Phases Connected and Balanced', () => {
  const db = createFullLifecycleDb();
  const acc = db.accounting;
  const postFn = (first, second) => (second ? accounting.postJournalEntry(first, second) : accounting.postJournalEntry(db, first));
  const postJournalFn = postFn;

  // ── Step 1: COA & Double-Entry Ledger Verification (Phases 1-20) ──────────
  assert.ok(Array.isArray(acc.accounts));
  assert.ok(acc.accounts.some((a) => a.code === '1630'), 'WIP account 1630 must exist in COA');
  assert.ok(acc.accounts.some((a) => a.code === '6710'), 'Bank settlement fee account 6710 must exist');
  assert.ok(acc.accounts.some((a) => a.code === '5500'), 'Cash shortage account 5500 must exist');

  // ── Step 2: Procurement Cycle with 3-Way Match and Input VAT (Phases 41-60)
  // 2.1 Create and Approve PO
  const poResult = procurementEngine.createPurchaseOrder(acc, {
    vendorId: 'v-meat-supplier',
    branchId: 1,
    lines: [{ itemId: 'item-meat', quantity: 20, unit: 'کیلوگرم', unitPriceIrr: 4200000 }],
    createdById: 'buyer-1',
  });
  assert.ok(poResult.ok);
  procurementEngine.approvePurchaseOrder(acc, poResult.po.id, 'manager-1');

  // 2.2 Goods Receipt (GRN) -> DR 1610 (Inventory), CR 2120 (GRNI)
  const grnResult = procurementEngine.receiveGoods(acc, {
    poId: poResult.po.id,
    branchId: 1,
    deliveryNoteNumber: 'DN-9901',
    lines: [{ poLineId: poResult.po.lines[0].id, quantityReceived: 20, unit: 'کیلوگرم' }],
    createdById: 'warehouse-1',
  }, { postJournalFn });
  assert.ok(grnResult.ok);
  inventoryEngine.receiveStock(acc, { itemId: 'item-meat', qty: 20, unitCost: 4200000, branchId: 1 });
  assert.equal(acc.inventoryItems.find((i) => i.id === 'item-meat').qtyOnHand, 70);

  // 2.3 Vendor Bill Ingestion with Input VAT (1450) and 3-Way Match
  const billResult = procurementEngine.createVendorBill(acc, {
    vendorId: 'v-meat-supplier',
    branchId: 1,
    poId: poResult.po.id,
    grnId: grnResult.grn.id,
    invoiceNumber: 'INV-ALBORZ-101',
    total: 92400000, // 84M base + 8.4M VAT (10%)
    vatAmount: 8400000,
    lines: [{ grnLineId: grnResult.grn.lines[0].id, poLineId: poResult.po.lines[0].id, quantity: 20, unit: 'کیلوگرم', unitPriceIrr: 4200000 }],
    createdById: 'accountant-1',
  }, { postJournalFn });
  assert.ok(billResult.ok);

  // 2.4 Pay Vendor Bill -> DR 2110 (AP), CR 1210 (Bank)
  const payBillResult = procurementEngine.payVendorBill(acc, billResult.bill.id, {
    amount: 92400000,
    paymentMethod: 'bank',
    createdById: 'finance-officer',
  }, { postJournalFn });
  assert.ok(payBillResult.ok);
  assert.equal(payBillResult.bill.status, 'paid');

  // ── Step 3: Sub-recipe Production to WIP Account 1630 (Phases 61-70) ───────
  // Prepare sub-recipe batch (consume raw meat 5kg -> produce sauce/mix 5kg)
  acc.subRecipes = [
    {
      id: 'sub-mix-01',
      name: 'ترکیب برگر مخصوص',
      branchId: 1,
      outputItemId: 'item-sauce-wip',
      batchYieldUnits: 5,
      yieldUnits: 5,
      yieldUnit: 'کیلوگرم',
      ingredients: [
        { itemId: 'item-meat', name: 'گوشت', qty: 5, unit: 'کیلوگرم', unitCost: 4000000 },
      ],
    },
  ];

  const batchLog = fnbCostOptimizer.produceSubRecipeBatch(acc, 'sub-mix-01', 1, {
    producedBy: 'chef-1',
    branchId: 1,
  });
  assert.ok(batchLog);

  // Post WIP transfer: DR 1630 (WIP), CR 1610 (Raw)
  postFn({
    source: 'subrecipe_production',
    sourceId: batchLog.id,
    date: '2026-08-25T10:00:00.000Z',
    description: `تولید بچ آماده‌سازی ${batchLog.subRecipeName}`,
    lines: [
      { accountCode: '1630', debit: batchLog.totalBatchCost, credit: 0, memo: 'انتقال به انبار نیمه‌آماده', branchId: 1 },
      { accountCode: '1610', debit: 0, credit: batchLog.totalBatchCost, memo: 'مصرف مواد اولیه در آماده‌سازی', branchId: 1 },
    ],
  });

  // ── Step 4: Waste Recording (Phases 63-65) ────────────────────────────────
  // Record kitchen waste: 1kg bread spoiled -> DR 5110 (Waste COGS), CR 1610 (Raw)
  const wasteResult = inventoryEngine.recordWaste(acc, {
    itemId: 'item-bread',
    qty: 2,
    reason: 'سوختگی در فر پخت',
    createdById: 'chef-1',
    branchId: 1,
  }, { postJournalFn });
  assert.ok(wasteResult.ok);
  assert.equal(acc.inventoryItems.find((i) => i.id === 'item-bread').qtyOnHand, 198);

  // ── Step 5: Sales Ingestion, POS Split Tender, VAT & Tips (Phases 21-30) ───
  const orderPaid = {
    id: 'ord-1001',
    orderNo: '#1001',
    branchId: 1,
    status: 'paid',
    paymentStatus: 'paid',
    paymentMethod: 'card',
    fulfillment: 'dine_in',
    createdAt: '2026-08-25T14:30:00.000Z',
    total: 3300000, // 300,000 base + 30,000 VAT 10%
    discount: 0,
    items: [
      { name: 'همبرگر مخصوص دست‌ساز', price: 3000000, qty: 1, lineTotal: 3000000 },
    ],
  };
  db.orders.push(orderPaid);

  const saleJournal = accounting.syncOrderSalesJournal(db, orderPaid);
  assert.ok(saleJournal, 'Sale journal must be posted automatically');
  assert.equal(saleJournal.totalAmount, 3300000);

  // ── Step 6: Cash Drawer Shift & Overage/Shortage Posting (Phases 23-24) ────
  acc.cashDrawers.push({
    id: 'ds-day-1',
    drawerName: 'صندوق شیفت ظهر',
    cashierName: 'صندوق‌دار سالن',
    openedAt: '2026-08-25T08:00:00.000Z',
    openingFloat: 2000000,
    cashSales: 5000000,
    cashRefunds: 0,
    status: 'open',
    branchId: 1,
  });

  // Close with 50,000 shortage -> DR 5500 (Shortage COGS), CR 1110 (Cash on hand)
  const drawerCloseResult = reconciliationEngine.closeCashDrawer(acc, 'ds-day-1', {
    closingCash: 6950000, // expected 7,000,000 -> 50,000 short
    closedBy: 'head-cashier',
  }, { postJournalFn });
  assert.ok(drawerCloseResult.ok);
  assert.equal(drawerCloseResult.session.discrepancy, -50000);
  assert.ok(drawerCloseResult.discrepancyJournal);

  // ── Step 7: Shaparak POS Settlement with Fee Recognition (Phases 31-36) ───
  // Gross: 3,300,000, Fee: 5,000 -> Net to Bank: 3,295,000
  const settlementResult = reconciliationEngine.recordSettlement(acc, {
    grossAmount: 3300000,
    feeAmount: 5000,
    provider: 'کارتخوان سداد',
    batchNumber: 'B-7788',
    branchId: 1,
    createdById: 'accountant-1',
  }, { postJournalFn });
  assert.ok(settlementResult.ok);
  assert.equal(settlementResult.settlement.netAmount, 3295000);

  // ── Step 8: Petty Cash Replenishment & Article 147 Expenses (Phases 84-87) ─
  // 8.1 Replenish Petty Cash from Bank: DR 1130 (Petty Cash), CR 1210 (Bank)
  const replenishResult = reconciliationEngine.replenishPettyCash(acc, {
    amount: 10000000,
    custodian: 'مسئول تنخواه',
    branchId: 1,
    createdById: 'accountant-1',
  }, { postJournalFn });
  assert.ok(replenishResult.ok);

  // 8.2 Expense: Utilities (Water/Power) paid from Petty Cash -> DR 6300, CR 1130
  const expenseResult = reconciliationEngine.createExpenseEntry(acc, {
    title: 'قبوض برق و آب مرداد ماه',
    category: 'قبوض و انشعابات',
    amount: 3500000,
    paymentMethod: 'petty_cash',
    taxDeductibilityStatus: 'CONFIRMED',
    branchId: 1,
    createdById: 'accountant-1',
  }, { postJournalFn });
  assert.ok(expenseResult.ok);
  assert.equal(expenseResult.expense.taxDeductibilityStatus, 'CONFIRMED');

  // ── Step 9: Fixed Assets & Monthly Depreciation Run (Phases 81-83) ────────
  // 9.1 Add Asset: Espresso Machine 3-Group -> DR 1810, CR 1210
  const asset = assetEngine.createAsset(acc, {
    assetCode: 'AST-ESPRESSO-01',
    name: 'دستگاه اسپرسوساز ۳ گروپ صنعتی',
    category: 'تجهیزات بار',
    purchaseDate: '2026-08-24',
    purchaseCost: 600000000,
    salvageValue: 60000000,
    usefulLifeMonths: 60,
    depreciationMethod: 'straight_line',
    branchId: 1,
  });
  assert.ok(asset);

  // Post asset purchase
  postFn({
    source: 'asset_purchase',
    sourceId: asset.id,
    date: asset.purchaseDate,
    description: `خرید دارایی ثابت ${asset.name}`,
    lines: [
      { accountCode: '1810', debit: asset.purchaseCost, credit: 0, memo: 'ثبت بهای تمام‌شده دارایی', branchId: 1 },
      { accountCode: '1210', debit: 0, credit: asset.purchaseCost, memo: 'پرداخت از حساب بانکی', branchId: 1 },
    ],
  });

  // 9.2 Run Monthly Depreciation -> DR 6980 (Deprec Expense), CR 1890 (Accum Deprec)
  const depResult = assetEngine.runDepreciation(acc, postFn, db);
  assert.ok(depResult.ok);
  assert.ok(depResult.processedAssets.length >= 1);

  // ── Step 10: Payroll Processing & 30% Insurance Split (Phases 88-90) ──────
  const payrollRunResult = payrollEngine.createPayrollRun(acc, {
    periodName: 'شهریور ۱۴۰۵',
    serviceMonth: '2026-08',
    date: '2026-08-25T10:00:00.000Z',
    branchId: 1,
    createdById: 'hr-manager',
  }, { postJournalFn });
  assert.ok(payrollRunResult.ok);
  assert.ok(payrollRunResult.payrollRun.totalNetPay > 0);

  // Disburse Payroll from Bank -> DR 2600 (Payroll Payable), CR 1210 (Bank)
  const disburseResult = payrollEngine.disbursePayroll(acc, payrollRunResult.payrollRun.id, {
    amount: payrollRunResult.payrollRun.totalNetPay,
    date: '2026-08-25T18:00:00.000Z',
    createdById: 'finance-director',
  }, { postJournalFn });
  assert.ok(disburseResult.ok);
  assert.equal(disburseResult.payrollRun.status, 'disbursed');

  // ── Step 11: Inter-Branch Transfer & Consolidation (Phases 91-92) ──────────
  const ibtResult = consolidationEngine.recordInterBranchTransfer(acc, {
    fromBranchId: 1,
    toBranchId: 2,
    amount: 15000000,
    description: 'تأمین نقدینگی صندوق شعبه ۲',
    date: '2026-08-25T19:00:00.000Z',
    postJournalFn,
    db,
  });
  assert.ok(ibtResult.ok);

  const branchComparison = consolidationEngine.getBranchComparison(db);
  assert.ok(branchComparison.branches.length >= 2);

  // ── Step 12: Blockchain Ledger Integrity Verification (Phase 12, 94) ──────
  const ledgerAudit = auditEngine.verifyLedgerChain(acc);
  assert.equal(ledgerAudit.isIntegrityValid, true, 'SHA-256 blockchain ledger chain must be 100% valid');
  assert.ok(ledgerAudit.chainLength >= 10, 'All lifecycle steps must produce cryptographically linked vouchers');

  // ── Step 13: Official 4-Column & 6-Column Trial Balance (Phase 96) ─────────
  const trialBalance = accounting.getTrialBalanceReport(db, '2026-09-01');
  assert.equal(trialBalance.isBalanced, true, 'Trial Balance must be 100% balanced');
  assert.equal(trialBalance.discrepancy, 0, 'No discrepancy allowed in Trial Balance');
  assert.ok(trialBalance.totalDebit > 0);
  assert.equal(trialBalance.totalDebit, trialBalance.totalCredit);

  const officialTB = auditEngine.generateOfficialTrialBalance(acc, '2026-09-01');
  assert.equal(officialTB.isTurnoverBalanced, true);
  assert.equal(officialTB.isClosingBalanced, true);

  // ── Step 14: Restaurant Income Statement (P&L) & Prime Cost (Phase 97) ─────
  const pnl = accounting.getIncomeStatement(db, '2026-08-01', '2026-08-31');
  assert.ok(pnl.netSales >= 0);
  assert.ok(pnl.primeCost >= 0);
  assert.equal(typeof pnl.grossMarginPct, 'number');

  // ── Step 15: Standard Balance Sheet & Cash Flow Statement (Phases 98-99) ───
  const balanceSheet = accounting.getBalanceSheet(db, '2026-09-01');
  assert.equal(balanceSheet.isBalanced, true, 'Balance Sheet must satisfy Assets = Liabilities + Equity');
  assert.equal(balanceSheet.totalAssets, balanceSheet.totalLiabAndEquity);

  const cashFlow = accounting.getCashFlowStatement(db, '2026-08-01', '2026-08-31');
  assert.ok(cashFlow.operating);
  assert.ok(cashFlow.investing);
  assert.ok(cashFlow.financing);

  // ── Step 16: Article 95 Official Journal & 10-Year Compliance (Phase 95) ──
  const generalJournal = auditEngine.generateOfficialGeneralJournal(acc, { from: '2026-08-01', to: '2026-08-31' });
  assert.equal(generalJournal.isBalanced, true);
  assert.ok(generalJournal.totalRows > 0);

  const complianceReport = auditEngine.get10YearComplianceReport(acc);
  assert.equal(complianceReport.digitalLedgerIntegrity, 'VERIFIED_TAMPER_PROOF');
  assert.equal(complianceReport.legalHoldActive, true);
});

test('100 Discrepancies Verification: Advanced Edge Cases, Tenders, COA & Bank Deduplication', () => {
  const db = createFullLifecycleDb();
  const acc = db.accounting;
  const postFn = (first, second) => (second ? accounting.postJournalEntry(first, second) : accounting.postJournalEntry(db, first));

  // 1. Verify all new specialized COA accounts are registered and valid
  const expectedCodes = ['1590', '1880', '1910', '2150', '2250', '2500', '2750', '4700', '4800', '6720', '6850', '6995'];
  for (const code of expectedCodes) {
    assert.ok(acc.accounts.some((a) => a.code === code), `Account ${code} must exist in COA`);
  }

  // 2. Verify Wallet Tender Journal Mapping (Discrepancy #2) -> DR 2500, CR 4110, CR 2210
  const walletOrder = {
    id: 5001,
    orderNo: '#W-5001',
    branchId: 1,
    status: 'paid',
    paymentStatus: 'paid',
    paymentMethod: 'wallet',
    fulfillment: 'dine_in',
    createdAt: '2026-08-26T12:00:00.000Z',
    total: 1100000,
    items: [{ name: 'پیتزا سیر و استیک', price: 1000000, qty: 1 }],
  };
  const walletJournal = accounting.syncOrderSalesJournal(db, walletOrder);
  assert.ok(walletJournal);
  assert.equal(walletJournal.lines[0].accountCode, '2500', 'Wallet payment must debit 2500 (Customer Deposits & Wallet Liabilities)');

  // 3. Verify SnappFood / Marketplace Tender Journal Mapping (Discrepancy #3) -> DR 1410
  const snappOrder = {
    id: 5002,
    orderNo: '#S-5002',
    branchId: 1,
    status: 'paid',
    paymentStatus: 'paid',
    paymentMethod: 'snappfood',
    fulfillment: 'delivery',
    channel: 'snappfood',
    createdAt: '2026-08-26T13:00:00.000Z',
    total: 2200000,
    items: [{ name: 'برگر دوبل ذغالی', price: 2000000, qty: 1 }],
  };
  const snappJournal = accounting.syncOrderSalesJournal(db, snappOrder);
  assert.ok(snappJournal);
  assert.equal(snappJournal.lines[0].accountCode, '1410', 'SnappFood order must debit 1410 (Marketplace Receivables)');

  // 4. Verify Bank Feed Deduplicated Matching (Discrepancy #16)
  // Two bank transactions with identical amount 1,100,000 IRR, but only one matching journal exists
  reconciliationEngine.importBankFeed(acc, [
    { id: 'btx-01', date: '2026-08-26T12:05:00.000Z', debit: 1100000, credit: 0, reference: 'REF-001' },
    { id: 'btx-02', date: '2026-08-26T12:06:00.000Z', debit: 1100000, credit: 0, reference: 'REF-002' },
  ]);
  // Add a single matching journal voucher for 1,100,000 IRR
  postFn({
    source: 'pos_settlement',
    sourceId: 'settle-demo-1',
    date: '2026-08-26T12:00:00.000Z',
    description: 'تسویه کارتخوان تست',
    lines: [
      { accountCode: '1210', debit: 1100000, credit: 0 },
      { accountCode: '1320', debit: 0, credit: 1100000 },
    ],
  });

  const autoMatchResult = reconciliationEngine.autoMatchBankFeed(acc);
  assert.equal(autoMatchResult.matchedCount, 1, 'Only one transaction must match the single journal voucher');
  assert.equal(autoMatchResult.remainingUnmatched, 1, 'Second identical transaction must remain unmatched without false positive duplicate link');

  // 5. Verify WIP Prep & Packaging Waste Crediting (Discrepancy #43)
  acc.inventoryItems.push({
    id: 'item-box',
    name: 'جعبه برگر کرافت',
    category: 'packaging',
    accountCode: '1620',
    unit: 'عدد',
    qtyOnHand: 100,
    avgCostIrr: 25000,
    branchId: 1,
  });
  const packagingWasteResult = inventoryEngine.recordWaste(acc, {
    itemId: 'item-box',
    qty: 5,
    reason: 'له‌شدگی در انبار',
    branchId: 1,
  }, { postJournalFn: postFn });
  assert.ok(packagingWasteResult.ok);
  assert.equal(packagingWasteResult.journalEntry.lines[1].accountCode, '1620', 'Packaging waste must credit 1620');

  // 6. Verify Statutory Social Security Ceiling (Discrepancy #51)
  const highSalaryEmp = { id: 'emp-exec', name: 'مدیرعامل', baseSalary: 2500000000, branchId: 1, active: true }; // 250M Tomans
  const payslip = payrollEngine.calculateEmployeePayslip(highSalaryEmp);
  assert.equal(payslip.insurableEarnings, 1200000000, 'Insurable earnings must be capped at 1.2B IRR statutory ceiling');
  assert.equal(payslip.employeeInsurance, 84000000, '7% of 1.2B IRR ceiling = 84,000,000 IRR');
  assert.equal(payslip.employerInsurance, 276000000, '23% of 1.2B IRR ceiling = 276,000,000 IRR');

  // 7. Verify Income Statement Signed Net Turnover Accumulation (Discrepancy #91)
  const isReport = accounting.getIncomeStatement(db, '2026-08-01', '2026-08-31');
  assert.ok(isReport.revenue.total >= 0);
  assert.ok(isReport.netSales >= 0);
});
