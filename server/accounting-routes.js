'use strict';

/**
 * WESTO Accounting API Routes
 * Complete RESTful suite ported from NEEM project covering:
 * - Overview & KPIs, AI CFO Brief, Predictive Analytics
 * - Journal Entries (DR/CR) & SHA-256 Blockchain Hash Verification
 * - Chart of Accounts (COA) Tree & Account Ledger (GL)
 * - Trial Balance, Income Statement (P&L), Balance Sheet, Cash Flow Statement
 * - Cash Drawers, Sessions, Cash Over/Short, POS/Gateway Settlements
 * - Procurement (Purchase Orders, Goods Receipts, Three-Way Matching)
 * - Accounts Payable (Vendors, Bills, AP Aging)
 * - Accounts Receivable (Customer Subledger)
 * - Expenses, Petty Cash Funds, Recurring Expenses, Reimbursements
 * - Fixed Assets, Automated Depreciation, Disposal, Transfers
 * - Fiscal Periods, Soft-Close, Hard-Lock, Reopening with posting restrictions
 * - Tax Matrix, Multi-Category Rules, Tax Calculations
 * - Inventory Valuation, Stock In, Recipe Costing, Menu Engineering, Waste Accounting
 * - Bank Feeds Auto-Matching, Reconciliation, Control Totals
 * - Multi-Branch Financial Consolidation & Benchmarking
 * - Gift Cards, Payroll Runs, Journal Templates
 */

const engine = require('./accounting-engine');
const { normalizeRole } = require('./command-center');
const { checkoutTaxCategoriesPatch, prepareBranchTaxRule } = require('./finance/tax-rule-input');

const normalizeDigits = (val) => String(val ?? '')
  .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
  .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));

function branchScopedUser(req) {
  const user = req.user || {};
  return Array.isArray(user.allowedBranchIds) || Array.isArray(user.branchIds) || user.branchId != null;
}

function branchScopedRows(req, rows, branchId, { allowGlobal = false } = {}) {
  const list = Array.isArray(rows) ? rows : [];
  // A consolidated owner report is represented by a null branchId. Once a
  // branch is explicitly selected, owners must be filtered too; otherwise a
  // branch selector silently returns the consolidated dataset.
  if (branchId == null && !branchScopedUser(req)) return list;
  return list.filter((row) => {
    const ownBranchId = row?.branchId ?? row?.locationId;
    if (ownBranchId != null) return Number(ownBranchId) === Number(branchId);
    const lines = Array.isArray(row?.lines) ? row.lines.filter((line) => line?.branchId != null) : [];
    if (lines.length) return lines.every((line) => Number(line.branchId) === Number(branchId));
    return allowGlobal;
  });
}

function hasExplicitBranchRequest(req) {
  return [req?.query?.branchId, req?.query?.branch, req?.body?.branchId, req?.body?.branch]
    .some((value) => value !== undefined && value !== null && String(value).trim() !== '');
}

// Owners inspect consolidated data by default; scoped staff always receive
// their resolved branch context, including the default allowed branch.
function reportBranchId(req, parseBranchId) {
  if (!parseBranchId) return null;
  if (!branchScopedUser(req) && !hasExplicitBranchRequest(req)) return null;
  return parseBranchId(req);
}

function reportBranchIds(req, parseBranchId) {
  const selected = hasExplicitBranchRequest(req) ? reportBranchId(req, parseBranchId) : null;
  if (selected != null) return [selected];
  if (!branchScopedUser(req)) return null;
  const user = req.user || {};
  const raw = Array.isArray(user.allowedBranchIds)
    ? user.allowedBranchIds
    : Array.isArray(user.branchIds)
      ? user.branchIds
      : user.branchId == null ? [] : [user.branchId];
  return [...new Set(raw.map(Number).filter((value) => Number.isSafeInteger(value) && value > 0))];
}

function taxInvoiceContext(req, parseBranchId) {
  const scoped = branchScopedUser(req);
  const explicit = hasExplicitBranchRequest(req);
  const branchId = scoped || explicit ? parseBranchId(req) : null;
  const user = req.user || {};
  const rawAllowed = Array.isArray(user.allowedBranchIds)
    ? user.allowedBranchIds
    : Array.isArray(user.branchIds)
      ? user.branchIds
      : user.branchId == null ? null : [user.branchId];
  return { branchId, allowedBranchIds: scoped ? rawAllowed : null };
}

function scopedTaxInvoice(req, taxInvoices, id, parseBranchId) {
  const branchId = reportBranchId(req, parseBranchId);
  return branchScopedRows(req, taxInvoices, branchId)
    .find((invoice) => String(invoice.id) === String(id) || String(invoice.tax_uid) === String(id));
}

function scopedResource(req, rows, id, parseBranchId) {
  const branchId = reportBranchId(req, parseBranchId);
  return branchScopedRows(req, rows, branchId)
    .find((row) => String(row?.id) === String(id) || String(row?.number) === String(id)) || null;
}

function financeV1PosReadOnly(req, res) {
  return res.status(410).json({
    data: null,
    meta: { generatedAt: new Date().toISOString(), replacement: '/api/staff/orders' },
    error: { code: 'finance_v1_pos_read_only', message: 'ثبت جدید POS فقط از مسیرهای عملیاتی متصل به Finance V2 مجاز است.' },
  });
}

function registerAccountingRoutes({ app, getDb, save, requireAdmin, requireCapability, parseBranchId }) {

  // ── 1. Overview & Executive Insights ──────────────────────────────────────
  app.get('/api/admin/finance/overview', requireCapability('admin.access'), (req, res) => {
    try {
      const db = getDb();
      const branchId = reportBranchId(req, parseBranchId);
      const data = engine.getOverview(db, { branchId, from: req.query.from, to: req.query.to });
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/admin/finance/ai-cfo-brief', requireCapability('admin.access'), (req, res) => {
    try {
      const db = getDb();
      const brief = engine.aiEngine.generateCFOBrief(db, { branchId: reportBranchId(req, parseBranchId) });
      res.json(brief);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/admin/finance/predictive', requireCapability('admin.access'), (req, res) => {
    try {
      const db = getDb();
      const branchId = reportBranchId(req, parseBranchId);
      const analytics = engine.predictiveEngine.getPredictiveAnalytics(db, { branchId });
      res.json(analytics);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── 2. Sales & Revenue Breakdown ──────────────────────────────────────────
  app.get('/api/admin/finance/sales', requireCapability('admin.access'), (req, res) => {
    try {
      const db = getDb();
      const branchId = reportBranchId(req, parseBranchId);
      const data = engine.getSalesAnalysis(db, { branchId, from: req.query.from, to: req.query.to });
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── 3. Chart of Accounts (COA) ────────────────────────────────────────────
  app.get('/api/admin/finance/coa', requireCapability('admin.access'), (req, res) => {
    try {
      const db = getDb();
      const acc = engine.ensureAccountingData(db);
      res.json({ accounts: acc.accounts || [] });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/admin/finance/coa', requireCapability('admin.access'), (req, res) => {
    try {
      const db = getDb();
      const acc = engine.ensureAccountingData(db);
      const { code, name, nameFa, type, subtype, parentCode, isPostingAccount } = req.body || {};

      if (!code || !nameFa || !type) {
        return res.status(400).json({ error: 'کد حساب، نام فارسی و نوع حساب الزامی است.' });
      }

      if (acc.accounts.some((a) => a.code === String(code).trim())) {
        return res.status(400).json({ error: `حساب با کد ${code} قبلاً تعریف شده است.` });
      }

      const newAccount = {
        code: String(code).trim(),
        name: String(name || nameFa).trim(),
        nameFa: String(nameFa).trim(),
        type: String(type).trim(),
        subtype: subtype ? String(subtype).trim() : null,
        parentCode: parentCode ? String(parentCode).trim() : null,
        isPostingAccount: isPostingAccount !== false,
      };

      acc.accounts.push(newAccount);
      acc.accounts.sort((a, b) => a.code.localeCompare(b.code));
      save();
      res.json({ ok: true, account: newAccount });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.patch('/api/admin/finance/coa/:code', requireCapability('admin.access'), (req, res) => {
    try {
      const db = getDb();
      const acc = engine.ensureAccountingData(db);
      const target = acc.accounts.find((a) => a.code === req.params.code);
      if (!target) return res.status(404).json({ error: 'حساب یافت نشد.' });

      if (req.body.nameFa) target.nameFa = String(req.body.nameFa).trim();
      if (req.body.name) target.name = String(req.body.name).trim();
      if (req.body.subtype !== undefined) target.subtype = req.body.subtype ? String(req.body.subtype).trim() : null;
      if (req.body.isPostingAccount !== undefined) target.isPostingAccount = Boolean(req.body.isPostingAccount);

      save();
      res.json({ ok: true, account: target });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── 3.5. POS Sales Ingestion, Tips, Splits & Refunds (v1 & api) ───────────
  app.post('/v1/pos/sales', requireCapability('orders.create'), financeV1PosReadOnly);
  app.post('/api/pos/sales', requireCapability('orders.create'), financeV1PosReadOnly);

  app.post('/v1/pos/sales/:id/refunds', requireCapability('orders.manage'), financeV1PosReadOnly);
  app.post('/api/pos/sales/:id/refunds', requireCapability('orders.manage'), financeV1PosReadOnly);

  app.get(['/v1/pos/sales/:id', '/api/pos/sales/:id'], requireCapability('orders.view'), (req, res) => {
    try {
      const db = getDb();
      const { posSales } = engine.salesPosEngine.ensureSalesPOS(db);
      const sale = branchScopedRows(req, posSales, reportBranchId(req, parseBranchId))
        .find((s) => s.external_id === req.params.id || s.id === req.params.id);
      if (!sale) return res.status(404).json({ error: 'فروش POS یافت نشد.' });
      res.json({ ok: true, sale });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── 3.6. Taxpayer System (سامانه مؤدیان) & E-Invoices ──────────────────────
  app.post(['/v1/tax/einvoices', '/api/tax/einvoices'], requireCapability('admin.access'), (req, res) => {
    try {
      const db = getDb();
      const result = engine.taxpayerAdapter.enqueueTaxInvoice(db, req.body, {
        userId: req.user?.phone || req.user?.id || 'admin',
        ...taxInvoiceContext(req, parseBranchId),
      });
      save();
      res.status(result.idempotent ? 200 : 202).json(result);
    } catch (err) {
      res.status(err.status || 400).json({ error: err.message, code: err.code });
    }
  });

  app.get(['/v1/tax/einvoices/:id/status', '/api/tax/einvoices/:id/status'], requireCapability('admin.access'), (req, res) => {
    try {
      const db = getDb();
      const { taxInvoices } = engine.taxpayerAdapter.ensureTaxpayerData(db);
      const invoice = scopedTaxInvoice(req, taxInvoices, req.params.id, parseBranchId);
      if (!invoice) return res.status(404).json({ ok: false, error: 'صورتحساب مالیاتی یافت نشد.' });
      const result = engine.taxpayerAdapter.queryTaxInvoiceStatus(db, invoice.id);
      res.json(result);
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message });
    }
  });

  app.get('/api/admin/finance/einvoices', requireCapability('admin.access'), (req, res) => {
    try {
      const db = getDb();
      const { taxInvoices, settings } = engine.taxpayerAdapter.ensureTaxpayerData(db);
      // Unassigned legacy invoices are withheld from a branch report until
      // their legal branch dimension is reconciled; otherwise a scoped user
      // could see another branch's tax data through a global row.
      const scopedInvoices = branchScopedRows(req, taxInvoices, reportBranchId(req, parseBranchId)).slice();
      let invoices = scopedInvoices.slice();

      if (req.query.status) invoices = invoices.filter((i) => i.status === req.query.status);
      if (req.query.search) {
        const q = String(req.query.search).toLowerCase();
        invoices = invoices.filter((i) => String(i.tax_uid || '').toLowerCase().includes(q) || String(i.source_id || '').toLowerCase().includes(q));
      }

      invoices.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));

      const stats = {
        // Stats must use the same branch/status/search scope as the returned
        // rows. Reporting global totals here leaked another branch's tax data.
        total: invoices.length,
        confirmed: invoices.filter((i) => i.status === 'CONFIRMED').length,
        queued: invoices.filter((i) => i.status === 'QUEUED' || i.status === 'SENDING').length,
        failed: invoices.filter((i) => i.status === 'FAILED' || i.status === 'REJECTED').length,
        totalTaxIrr: invoices.filter((i) => i.status === 'CONFIRMED').reduce((s, i) => s + (Number(i.totals?.tax_irr) || 0), 0),
      };

      res.json({ invoices, stats, settings });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/admin/finance/einvoices/:id/retry', requireCapability('admin.access'), (req, res) => {
    try {
      const db = getDb();
      const { taxInvoices } = engine.taxpayerAdapter.ensureTaxpayerData(db);
      const invoice = scopedTaxInvoice(req, taxInvoices, req.params.id, parseBranchId);
      if (!invoice) return res.status(404).json({ error: 'صورتحساب مالیاتی یافت نشد.' });
      const result = engine.taxpayerAdapter.processSubmission(db, invoice.id);
      save();
      res.json(result);
    } catch (err) {
      res.status(err.status || 400).json({ error: err.message, code: err.code });
    }
  });

  app.get('/api/admin/finance/taxpayer/settings', requireCapability('admin.access'), (req, res) => {
    try {
      const db = getDb();
      const { settings } = engine.taxpayerAdapter.ensureTaxpayerData(db);
      res.json({ settings });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/admin/finance/taxpayer/settings', requireCapability('admin.access'), (req, res) => {
    try {
      const db = getDb();
      const { settings } = engine.taxpayerAdapter.ensureTaxpayerData(db);
      if (req.body.taxMemoryId) settings.taxMemoryId = String(req.body.taxMemoryId).trim().toUpperCase();
      if (req.body.economicCode) settings.economicCode = String(req.body.economicCode).trim();
      if (req.body.nationalId) settings.nationalId = String(req.body.nationalId).trim();
      if (req.body.provider) settings.provider = String(req.body.provider).trim();
      if (req.body.schemaVersion) settings.schemaVersion = String(req.body.schemaVersion).trim();
      if (req.body.sandboxMode !== undefined) settings.sandboxMode = Boolean(req.body.sandboxMode);
      save();
      res.json({ ok: true, settings });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // ── 4. Double-Entry Journal Vouchers & Audit ──────────────────────────────
  app.get('/api/admin/finance/journal', requireCapability('admin.access'), (req, res) => {
    try {
      const db = getDb();
      const acc = engine.ensureAccountingData(db);
      // Owners get a consolidated journal unless they explicitly select a
      // branch. Scoped users still resolve to their permitted branch.
      const branchId = reportBranchId(req, parseBranchId);
      let entries = branchScopedRows(req, acc.journalEntries, branchId).slice();

      if (req.query.search) {
        const q = String(req.query.search).toLowerCase();
        entries = entries.filter((e) =>
          (e.number && e.number.toLowerCase().includes(q)) ||
          (e.description && e.description.toLowerCase().includes(q)) ||
          (e.lines && e.lines.some((l) => l.accountName && l.accountName.toLowerCase().includes(q)))
        );
      }

      if (req.query.from) {
        entries = entries.filter((e) => new Date(e.date) >= new Date(req.query.from));
      }
      if (req.query.to) {
        entries = entries.filter((e) => new Date(e.date) <= new Date(req.query.to));
      }
      if (req.query.status) {
        entries = entries.filter((e) => e.status === req.query.status);
      }

      entries.sort((a, b) => new Date(b.date || b.createdAt || 0) - new Date(a.date || a.createdAt || 0));
      res.json({ entries, total: entries.length });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/admin/finance/journal', requireCapability('admin.access'), (req, res) => {
    // Legacy journal writes are intentionally read-only compatibility now.
    // Finance V2 is the sole canonical writer and enforces event identity,
    // branch dimensions, approvals and PostgreSQL durability.
    res.status(410).json({ ok: false, error: 'finance_v2_required', message: 'ثبت سند فقط از مسیر رسمی Finance V2 مجاز است.' });
  });

  app.get('/api/admin/finance/journal/:id', requireCapability('admin.access'), (req, res) => {
    try {
      const db = getDb();
      const acc = engine.ensureAccountingData(db);
      const entry = branchScopedRows(req, acc.journalEntries, reportBranchId(req, parseBranchId))
        .find((e) => e.id === req.params.id || e.number === req.params.id);
      if (!entry) return res.status(404).json({ error: 'سند حسابداری یافت نشد.' });
      res.json({ entry });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/admin/finance/journal/:id/reverse', requireCapability('admin.access'), (req, res) => {
    res.status(410).json({ ok: false, error: 'finance_v2_required', message: 'اصلاح سند فقط با reversal رسمی Finance V2 مجاز است.' });
  });

  app.get(['/v1/audit/integrity', '/api/admin/finance/audit-hash'], requireCapability('admin.access'), (req, res) => {
    try {
      const db = getDb();
      const acc = engine.ensureAccountingData(db);
      const report = engine.auditEngine.verifyLedgerChain(acc);
      res.json(report);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get(['/v1/audit/compliance-10y', '/api/admin/finance/compliance-10y'], requireCapability('admin.access'), (req, res) => {
    try {
      const db = getDb();
      const acc = engine.ensureAccountingData(db);
      const report = engine.auditEngine.get10YearComplianceReport(acc);
      res.json(report);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get(['/v1/exports/general-journal', '/api/admin/finance/exports/general-journal'], requireCapability('admin.access'), (req, res) => {
    try {
      const db = getDb();
      const acc = engine.ensureAccountingData(db);
      const data = engine.auditEngine.generateOfficialGeneralJournal(acc, {
        ...req.query,
        branchId: reportBranchId(req, parseBranchId),
      });
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get(['/v1/exports/trial-balance', '/api/admin/finance/exports/trial-balance'], requireCapability('admin.access'), (req, res) => {
    try {
      const db = getDb();
      const acc = engine.ensureAccountingData(db);
      const data = engine.auditEngine.generateOfficialTrialBalance(acc, req.query.asOf, {
        branchId: reportBranchId(req, parseBranchId),
      });
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/v1/audit/validate-permission', requireCapability('admin.access'), (req, res) => {
    try {
      const { role, action } = req.body || {};
      const result = engine.auditEngine.validateRBACPermission(role, action);
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // ── 5. General Ledger, Trial Balance & Statements ─────────────────────────
  app.get('/api/admin/finance/gl', requireCapability('admin.access'), (req, res) => {
    try {
      const db = getDb();
      const accountCode = req.query.accountCode;
      if (!accountCode) {
        return res.status(400).json({ error: 'پارامتر accountCode الزامی است.' });
      }
      const data = engine.getGeneralLedger(db, accountCode, {
        from: req.query.from,
        to: req.query.to,
        branchId: reportBranchId(req, parseBranchId),
      });
      res.json(data);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.get(['/v1/reports/trial-balance', '/api/admin/finance/trial-balance'], requireCapability('admin.access'), (req, res) => {
    try {
      const db = getDb();
      const data = engine.getTrialBalanceReport(db, req.query.asOf || new Date().toISOString(), {
        branchId: reportBranchId(req, parseBranchId),
      });
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get(['/v1/reports/income-statement', '/v1/reports/pnl', '/api/admin/finance/pnl', '/api/admin/finance/income-statement'], requireCapability('admin.access'), (req, res) => {
    try {
      const db = getDb();
      const data = engine.getIncomeStatement(db, req.query.from, req.query.to, {
        branchId: reportBranchId(req, parseBranchId),
      });
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get(['/v1/reports/balance-sheet', '/api/admin/finance/balance-sheet'], requireCapability('admin.access'), (req, res) => {
    try {
      const db = getDb();
      const data = engine.getBalanceSheet(db, req.query.asOf || new Date().toISOString(), {
        branchId: reportBranchId(req, parseBranchId),
      });
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get(['/v1/reports/cash-flow', '/api/admin/finance/cash-flow'], requireCapability('admin.access'), (req, res) => {
    try {
      const db = getDb();
      const data = engine.getCashFlowStatement(db, req.query.from, req.query.to, {
        branchId: reportBranchId(req, parseBranchId),
      });
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── AI CFO Executive Brief & Smart Diagnostics ────────────────────────────
  app.get(['/v1/cfo/brief', '/api/admin/finance/cfo/brief', '/api/admin/finance/ai-cfo'], requireCapability('admin.access'), (req, res) => {
    try {
      const db = getDb();
      const brief = engine.aiEngine.generateCFOBrief(db, { branchId: reportBranchId(req, parseBranchId) });
      res.json(brief);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── 6. Cash Drawers & Sessions ────────────────────────────────────────────
  app.get('/api/admin/finance/cash-drawers', requireCapability('admin.access'), (req, res) => {
    try {
      const db = getDb();
      const acc = engine.ensureAccountingData(db);
      res.json({ sessions: branchScopedRows(req, acc.cashDrawers, reportBranchId(req, parseBranchId)) });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/admin/finance/cash-drawers/session', requireCapability('cash.manage'), (req, res) => {
    // Finance V2/cashier APIs are the canonical writers. Keeping this legacy
    // route mutable created a second cash-session model and posted directly to
    // the legacy ledger, bypassing durable idempotency, cash movement totals,
    // and the canonical closeout transaction.
    return res.status(410).json({
      data: null,
      meta: { replacement: '/api/cashier/drawer' },
      error: { code: 'cash_drawer_v2_required', message: 'عملیات صندوق فقط از مسیر رسمی صندوق‌دار انجام می‌شود.' },
    });
  });

  // ── 7. Settlements & POS Clearing ─────────────────────────────────────────
  app.get(['/v1/settlements', '/api/admin/finance/settlements'], requireCapability('admin.access'), (req, res) => {
    try {
      const db = getDb();
      const acc = engine.ensureAccountingData(db);
      res.json({ settlements: branchScopedRows(req, acc.settlements, reportBranchId(req, parseBranchId)) });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post(['/v1/settlements', '/v1/settlements/imports', '/api/admin/finance/settlements'], requireCapability('admin.access'), (req, res) => {
    // The former endpoint trusted operator-entered gross/fee totals and
    // posted them to the legacy ledger without tying the batch to successful,
    // same-branch payments or durable request idempotency. Reconciliation V2
    // is the only allowed writer for settlement batches.
    return res.status(410).json({
      data: null,
      meta: { replacement: '/api/admin/v2/finance/reconciliation/settlements' },
      error: { code: 'finance_v2_required', message: 'تطبیق تسویه فقط از مسیر رسمی Finance V2 مجاز است.' },
    });
  });

  // ── 10. Expenses & Petty Cash (Article 147 Compliant) ─────────────────────
  app.get(['/v1/expenses', '/api/admin/finance/expenses'], requireCapability('admin.access'), (req, res) => {
    try {
      const db = getDb();
      const acc = engine.ensureAccountingData(db);
      let expenses = branchScopedRows(req, acc.expenses, reportBranchId(req, parseBranchId)).slice();
      if (req.query.category) expenses = expenses.filter((e) => e.category === req.query.category);
      if (req.query.taxDeductibilityStatus) expenses = expenses.filter((e) => e.taxDeductibilityStatus === req.query.taxDeductibilityStatus);
      res.json({ expenses, total: expenses.length });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post(['/v1/expenses', '/api/admin/finance/expenses'], requireCapability('admin.access'), (req, res) => {
    try {
      const db = getDb();
      const acc = engine.ensureAccountingData(db);
      const result = engine.reconciliationEngine.createExpenseEntry(acc, {
        ...req.body,
        branchId: parseBranchId ? parseBranchId(req) : req.body?.branchId,
        createdById: req.user?.phone || req.user?.id || 'admin',
      }, {
        postJournalFn: (jeInput) => engine.postJournalEntry(db, jeInput),
      });

      save();
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.get('/api/admin/finance/petty-cash', requireCapability('admin.access'), (req, res) => {
    try {
      const db = getDb();
      const acc = engine.ensureAccountingData(db);
      res.json({ funds: branchScopedRows(req, acc.pettyCash, reportBranchId(req, parseBranchId)) });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post(['/api/admin/finance/petty-cash/topup', '/api/admin/finance/petty-cash/replenish'], requireCapability('admin.access'), (req, res) => {
    try {
      const db = getDb();
      const acc = engine.ensureAccountingData(db);
      const result = engine.reconciliationEngine.replenishPettyCash(acc, {
        ...req.body,
        branchId: parseBranchId ? parseBranchId(req) : req.body?.branchId,
        createdById: req.user?.phone || req.user?.id || 'admin',
      }, {
        postJournalFn: (jeInput) => engine.postJournalEntry(db, jeInput),
      });

      save();
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // ── 8. Procurement, POs & Three-Way Match ─────────────────────────────────
  app.get('/api/admin/finance/purchase-orders', requireCapability('admin.access'), (req, res) => {
    try {
      const db = getDb();
      const acc = engine.ensureAccountingData(db);
      res.json({ purchaseOrders: branchScopedRows(req, acc.purchaseOrders, reportBranchId(req, parseBranchId)) });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/admin/finance/purchase-orders', requireCapability('admin.access'), (req, res) => {
    try {
      const db = getDb();
      const acc = engine.ensureAccountingData(db);
      const result = engine.procurementEngine.createPurchaseOrder(acc, { ...(req.body || {}), branchId: parseBranchId ? parseBranchId(req) : req.body?.branchId });
      save();
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/admin/finance/purchase-orders/:id/approve', requireCapability('admin.access'), (req, res) => {
    try {
      const db = getDb();
      const acc = engine.ensureAccountingData(db);
      // Approval is a branch-owned mutation. Resolve the resource through the
      // same scope used by reads before handing its id to the legacy engine;
      // otherwise a scoped accountant could approve another branch's PO.
      if (!scopedResource(req, acc.purchaseOrders, req.params.id, parseBranchId)) {
        return res.status(404).json({ error: 'سفارش خرید یافت نشد.' });
      }
      const result = engine.procurementEngine.approvePurchaseOrder(acc, req.params.id, req.user?.phone || req.user?.id || 'admin');
      save();
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/admin/finance/goods-receipts', requireCapability('admin.access'), (req, res) => {
    try {
      const db = getDb();
      const acc = engine.ensureAccountingData(db);
      res.json({ goodsReceipts: branchScopedRows(req, acc.goodsReceipts, reportBranchId(req, parseBranchId)) });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/admin/finance/goods-receipts', requireCapability('admin.access'), (req, res) => {
    try {
      const db = getDb();
      const acc = engine.ensureAccountingData(db);
      const result = engine.procurementEngine.receiveGoods(acc, { ...(req.body || {}), branchId: parseBranchId ? parseBranchId(req) : req.body?.branchId });
      save();
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/admin/finance/three-way-match', requireCapability('admin.access'), (req, res) => {
    try {
      const db = getDb();
      const acc = engine.ensureAccountingData(db);
      const billId = req.body?.billId || req.body?.vendorBillId;
      if (!scopedResource(req, acc.vendorBills, billId, parseBranchId)) {
        return res.status(404).json({ error: 'فاکتور تأمین‌کننده یافت نشد.' });
      }
      const result = engine.procurementEngine.performThreeWayMatch(acc, req.body || {});
      save();
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── 9. Accounts Payable (Vendors, Bills & Aging) ──────────────────────────
  function ensureDefaultSpotVendor(acc) {
    if (!Array.isArray(acc.vendors)) acc.vendors = [];
    if (!acc.vendors.some((v) => v.id === 'vendor-spot' || v.isSpot)) {
      acc.vendors.unshift({
        id: 'vendor-spot',
        name: 'خرید آزاد / بازار روز',
        nameFa: 'خرید آزاد / بازار روز',
        category: 'آزاد',
        phone: '',
        contactPerson: 'خرید متفرقه و حضوری',
        termsDays: 0,
        isSpot: true,
        balance: 0,
        itemIds: [],
        active: true,
        createdAt: '2026-01-01T00:00:00.000Z',
      });
    }
  }

  app.get('/api/admin/finance/vendors', requireCapability(['admin.access', 'inventory.view', 'finance.view', 'inventory.manage', 'inventory.operations']), (req, res) => {
    try {
      const db = getDb();
      const acc = engine.ensureAccountingData(db);
      ensureDefaultSpotVendor(acc);
      res.json({ vendors: branchScopedRows(req, acc.vendors, reportBranchId(req, parseBranchId), { allowGlobal: true }) });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  function handleVendorUpsert(req, res, targetId = null) {
    try {
      const db = getDb();
      const acc = engine.ensureAccountingData(db);
      ensureDefaultSpotVendor(acc);
      const body = req.body || {};
      const id = targetId || body.id;
      const { name, nameFa, phone, contactPerson, category, termsDays, branchId, itemIds, isSpot, notes, active } = body;

      if (!nameFa && !name && !id) {
        return res.status(400).json({ error: 'نام تأمین‌کننده الزامی است.' });
      }

      const existingIndex = id ? acc.vendors.findIndex((row) => String(row.id) === String(id)) : -1;
      const before = acc.vendors.slice();

      let vendor;
      if (existingIndex >= 0) {
        const current = acc.vendors[existingIndex];
        vendor = {
          ...current,
          name: name ? String(name).trim() : (nameFa ? String(nameFa).trim() : current.name),
          nameFa: nameFa ? String(nameFa).trim() : (name ? String(name).trim() : current.nameFa),
          phone: phone !== undefined ? String(phone || '').trim() : current.phone,
          contactPerson: contactPerson !== undefined ? String(contactPerson || '').trim() : (current.contactPerson || ''),
          category: category || current.category || 'عمومی',
          termsDays: termsDays !== undefined ? (Number(termsDays) || 0) : current.termsDays,
          branchId: branchId !== undefined ? (branchId === null ? null : (Number(branchId) || null)) : current.branchId,
          itemIds: Array.isArray(itemIds) ? Array.from(new Set(itemIds.map(String))) : (current.itemIds || []),
          isSpot: isSpot !== undefined ? Boolean(isSpot) : Boolean(current.isSpot),
          notes: notes !== undefined ? String(notes || '').trim() : (current.notes || ''),
          active: active !== undefined ? Boolean(active) : (current.active !== false),
          updatedAt: new Date().toISOString(),
        };
        acc.vendors[existingIndex] = vendor;
      } else {
        const parsedBranchId = branchId === null ? null : (Number(branchId) || reportBranchId(req, parseBranchId) || null);
        vendor = {
          id: id || `v-${Date.now()}`,
          name: String(name || nameFa).trim(),
          nameFa: String(nameFa || name).trim(),
          phone: String(phone || '').trim(),
          contactPerson: String(contactPerson || '').trim(),
          category: category || 'عمومی',
          termsDays: termsDays !== undefined ? (Number(termsDays) || 0) : 30,
          branchId: parsedBranchId,
          itemIds: Array.isArray(itemIds) ? Array.from(new Set(itemIds.map(String))) : [],
          isSpot: Boolean(isSpot),
          notes: String(notes || '').trim(),
          balance: 0,
          active: active !== false,
          createdAt: new Date().toISOString(),
        };
        acc.vendors.push(vendor);
      }

      Promise.resolve(save()).then(() => {
        res.json({ ok: true, vendor });
      }).catch((error) => {
        console.error('[vendors] save error', error.message);
        res.json({ ok: true, vendor });
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  app.post('/api/admin/finance/vendors', requireCapability(['admin.access', 'inventory.manage', 'finance.payables.manage', 'inventory.operations']), (req, res) => handleVendorUpsert(req, res));
  app.put('/api/admin/finance/vendors/:id', requireCapability(['admin.access', 'inventory.manage', 'finance.payables.manage', 'inventory.operations']), (req, res) => handleVendorUpsert(req, res, req.params.id));

  app.get('/api/admin/finance/bills', requireCapability('admin.access'), (req, res) => {
    try {
      const db = getDb();
      const acc = engine.ensureAccountingData(db);
      res.json({ bills: branchScopedRows(req, acc.vendorBills, reportBranchId(req, parseBranchId)) });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/admin/finance/bills', requireCapability('admin.access'), (req, res) => {
    try {
      const db = getDb();
      const acc = engine.ensureAccountingData(db);
      const result = engine.procurementEngine.createVendorBill(acc, {
        ...req.body,
        branchId: parseBranchId ? parseBranchId(req) : req.body?.branchId,
        createdById: req.user?.phone || req.user?.id || 'admin',
      }, {
        postJournalFn: (jeInput) => engine.postJournalEntry(db, jeInput),
      });

      save();
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post(['/api/admin/finance/bills/:id/pay', '/api/admin/finance/bills/:id/payments'], requireCapability('admin.access'), (req, res) => {
    try {
      const db = getDb();
      const acc = engine.ensureAccountingData(db);
      const branchId = reportBranchId(req, parseBranchId);
      if (!scopedResource(req, acc.vendorBills, req.params.id, parseBranchId)) {
        return res.status(404).json({ error: 'فاکتور خرید یافت نشد.' });
      }
      const result = engine.procurementEngine.payVendorBill(acc, req.params.id, {
        ...req.body,
        ...(branchId == null ? {} : { branchId }),
        createdById: req.user?.phone || req.user?.id || 'admin',
      }, {
        postJournalFn: (jeInput) => engine.postJournalEntry(db, jeInput),
      });

      save();
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.get('/api/admin/finance/ap-aging', requireCapability('admin.access'), (req, res) => {
    try {
      const db = getDb();
      const data = engine.getAPAging(db, req.query.asOf || new Date().toISOString(), {
        branchId: reportBranchId(req, parseBranchId),
      });
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── 11. Payroll & Social Security (Articles 84/92 & Article 28) ────────
  app.get(['/v1/payroll/employees', '/api/admin/finance/payroll/employees'], requireCapability('admin.access'), (req, res) => {
    try {
      const db = getDb();
      const acc = engine.ensureAccountingData(db);
      res.json({ employees: branchScopedRows(req, acc.employees || [], reportBranchId(req, parseBranchId)) });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get(['/v1/payroll/runs', '/api/admin/finance/payroll/runs'], requireCapability('admin.access'), (req, res) => {
    try {
      const db = getDb();
      const acc = engine.ensureAccountingData(db);
      res.json({ runs: branchScopedRows(req, acc.payrollRuns, reportBranchId(req, parseBranchId)) });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post(['/v1/payroll/runs', '/api/admin/finance/payroll/runs'], requireCapability('admin.access'), (req, res) => {
    try {
      const db = getDb();
      const acc = engine.ensureAccountingData(db);
      const result = engine.payrollEngine.createPayrollRun(acc, {
        ...req.body,
        branchId: parseBranchId ? parseBranchId(req) : req.body?.branchId,
        createdById: req.user?.phone || req.user?.id || 'admin',
      }, {
        postJournalFn: (jeInput) => engine.postJournalEntry(db, jeInput),
      });

      save();
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post(['/v1/payroll/runs/:id/disburse', '/api/admin/finance/payroll/runs/:id/disburse'], requireCapability('admin.access'), (req, res) => {
    try {
      const db = getDb();
      const acc = engine.ensureAccountingData(db);
      if (!scopedResource(req, acc.payrollRuns, req.params.id, parseBranchId)) {
        return res.status(404).json({ error: 'لیست حقوق یافت نشد.' });
      }
      const result = engine.payrollEngine.disbursePayroll(acc, req.params.id, {
        ...req.body,
        createdById: req.user?.phone || req.user?.id || 'admin',
      }, {
        postJournalFn: (jeInput) => engine.postJournalEntry(db, jeInput),
      });

      save();
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // ── 12. Fixed Assets & Depreciation ───────────────────────────────────────
  app.get('/api/admin/finance/fixed-assets', requireCapability('admin.access'), (req, res) => {
    try {
      const db = getDb();
      const acc = engine.ensureAccountingData(db);
      const assets = engine.assetEngine.getAssetRegister(acc, reportBranchId(req, parseBranchId));
      res.json({ assets });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/admin/finance/fixed-assets', requireCapability('admin.access'), (req, res) => {
    try {
      const db = getDb();
      const acc = engine.ensureAccountingData(db);
      const asset = engine.assetEngine.createAsset(acc, { ...(req.body || {}), branchId: parseBranchId ? parseBranchId(req) : req.body?.branchId });

      // Post Initial Asset Purchase Entry: DR 1810 (Fixed Asset), CR 1210 (Bank)
      const debitAcc = req.body.accountCode || '1810';
      const je = engine.postJournalEntry(db, {
        source: 'asset_purchase',
        sourceId: asset.id,
        date: asset.purchaseDate,
        description: `خرید و ثبت دارایی ثابت: ${asset.name}`,
        lines: [
          { accountCode: debitAcc, debit: asset.purchaseCost, credit: 0, memo: `ثبت بهای تمام‌شده دارایی ${asset.name}`, branchId: asset.branchId },
          { accountCode: '1210', debit: 0, credit: asset.purchaseCost, memo: 'پرداخت از حساب بانکی بابت خرید دارایی', branchId: asset.branchId },
        ],
      });

      save();
      res.json({ ok: true, asset, journalEntry: je });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/admin/finance/fixed-assets/:id/dispose', requireCapability('admin.access'), (req, res) => {
    try {
      const db = getDb();
      const acc = engine.ensureAccountingData(db);
      if (!scopedResource(req, acc.fixedAssets, req.params.id, parseBranchId)) {
        return res.status(404).json({ error: 'دارایی یافت نشد.' });
      }
      const result = engine.assetEngine.disposeAsset(acc, req.params.id, req.body || {});
      if (result.journalLines) {
        engine.postJournalEntry(db, {
          source: 'asset_disposal',
          sourceId: req.params.id,
          date: new Date().toISOString(),
          description: `ثبت اسقاط/فروش دارایی ثابت`,
          lines: result.journalLines,
        });
      }
      save();
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/admin/finance/depreciation/run', requireCapability('admin.access'), (req, res) => {
    try {
      const db = getDb();
      const result = engine.calculateAndPostDepreciation(db);
      save();
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── 12. Fiscal Periods & Hard Lock ────────────────────────────────────────
  app.get('/api/admin/finance/fiscal-periods', requireCapability('admin.access'), (req, res) => {
    try {
      const db = getDb();
      const acc = engine.ensureAccountingData(db);
      const branchId = reportBranchId(req, parseBranchId);
      res.json({ periods: branchScopedRows(req, engine.periodService.listPeriods(acc), branchId) });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/admin/finance/fiscal-periods', requireCapability('admin.access'), (req, res) => {
    try {
      const db = getDb();
      const acc = engine.ensureAccountingData(db);
      const period = engine.periodService.createPeriod(acc, { ...(req.body || {}), branchId: parseBranchId ? parseBranchId(req) : req.body?.branchId });
      save();
      res.json({ ok: true, period });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/admin/finance/fiscal-periods/:id/lock', requireCapability('admin.access'), (req, res) => {
    try {
      const db = getDb();
      const acc = engine.ensureAccountingData(db);
      const branchId = reportBranchId(req, parseBranchId);
      if (!scopedResource(req, acc.fiscalPeriods, req.params.id, parseBranchId)) {
        return res.status(404).json({ error: 'دوره مالی یافت نشد.' });
      }
      const result = engine.periodService.lockPeriod(acc, req.params.id, req.user?.phone || req.user?.id || 'admin', req.body.reason, { branchId });
      save();
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/admin/finance/fiscal-periods/:id/reopen', requireCapability('admin.access'), (req, res) => {
    try {
      const db = getDb();
      const acc = engine.ensureAccountingData(db);
      const branchId = reportBranchId(req, parseBranchId);
      if (!scopedResource(req, acc.fiscalPeriods, req.params.id, parseBranchId)) {
        return res.status(404).json({ error: 'دوره مالی یافت نشد.' });
      }
      const result = engine.periodService.reopenPeriod(acc, req.params.id, req.user?.phone || req.user?.id || 'admin', req.body.reason, { branchId });
      save();
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── 13. Bank Feed & Reconciliation ────────────────────────────────────────
  app.get('/api/admin/finance/bank-feed', requireCapability('admin.access'), (req, res) => {
    try {
      const db = getDb();
      const acc = engine.ensureAccountingData(db);
      res.json({ transactions: branchScopedRows(req, acc.bankTransactions, reportBranchId(req, parseBranchId)) });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post(['/v1/bank-transactions/imports', '/api/admin/finance/bank-feed/import'], requireCapability('admin.access'), (req, res) => {
    try {
      const db = getDb();
      const acc = engine.ensureAccountingData(db);
      const branchId = parseBranchId ? parseBranchId(req) : req.body?.branchId;
      const result = engine.reconciliationEngine.importBankFeed(acc, req.body.transactions || [], { branchId });
      save();
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post(['/v1/reconciliations/bank', '/api/admin/finance/bank-feed/auto-match', '/api/admin/finance/bank-feed/automatch'], requireCapability('admin.access'), (req, res) => {
    try {
      const db = getDb();
      const acc = engine.ensureAccountingData(db);
      const result = engine.reconciliationEngine.autoMatchBankFeed(acc, reportBranchId(req, parseBranchId));
      save();
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/admin/finance/control-totals', requireCapability('admin.access'), (req, res) => {
    try {
      const db = getDb();
      const acc = engine.ensureAccountingData(db);
      const totals = engine.reconciliationEngine.calculateControlTotals(acc, reportBranchId(req, parseBranchId));
      res.json(totals);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── 14. Inventory Valuation, COGS & Recipes ───────────────────────────────
  app.get('/api/admin/finance/inventory/valuation', requireCapability('admin.access'), (req, res) => {
    try {
      const db = getDb();
      const acc = engine.ensureAccountingData(db);
      const result = engine.inventoryEngine.getInventoryValuation(acc, reportBranchId(req, parseBranchId));
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/admin/finance/inventory/cogs', requireCapability('admin.access'), (req, res) => {
    try {
      const db = getDb();
      const acc = engine.ensureAccountingData(db);
      const result = engine.inventoryEngine.getCOGSVarianceAnalysis(acc, db, reportBranchId(req, parseBranchId), {
        from: req.query.from,
        to: req.query.to,
      });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post(['/v1/inventory/waste', '/api/admin/finance/inventory/waste'], requireCapability('admin.access'), (req, res) => {
    try {
      const db = getDb();
      const acc = engine.ensureAccountingData(db);
      const result = engine.inventoryEngine.recordWaste(acc, {
        ...req.body,
        branchId: parseBranchId ? parseBranchId(req) : req.body?.branchId,
        createdById: req.user?.phone || req.user?.id || 'admin',
      }, {
        postJournalFn: (jeInput) => engine.postJournalEntry(db, jeInput),
      });

      save();
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.get('/api/admin/finance/recipes', requireCapability('admin.access'), (req, res) => {
    try {
      const db = getDb();
      const acc = engine.ensureAccountingData(db);
      res.json({ recipes: branchScopedRows(req, acc.recipes, reportBranchId(req, parseBranchId)) });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/admin/finance/recipes/:id', requireCapability('admin.access'), (req, res) => {
    try {
      const db = getDb();
      const acc = engine.ensureAccountingData(db);
      const targetId = normalizeDigits(String(req.params.id || '')).trim();
      const recipe = branchScopedRows(req, acc.recipes, reportBranchId(req, parseBranchId))
        .find((r) => String(r.id) === targetId || String(r.menuItemId) === targetId || normalizeDigits(String(r.id)).trim() === targetId || normalizeDigits(String(r.menuItemId)).trim() === targetId);
      if (!recipe) return res.status(404).json({ error: 'دستور تهیه یافت نشد.' });
      res.json({ ok: true, recipe });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/admin/finance/recipes', requireCapability('admin.access'), (req, res) => {
    try {
      const db = getDb();
      const acc = engine.ensureAccountingData(db);
      const recipe = engine.inventoryEngine.saveRecipe(acc, { ...(req.body || {}), branchId: parseBranchId ? parseBranchId(req) : req.body?.branchId });
      save();
      res.json({ ok: true, recipe });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put('/api/admin/finance/recipes/:id', requireCapability('admin.access'), (req, res) => {
    try {
      const db = getDb();
      const acc = engine.ensureAccountingData(db);
      const targetId = normalizeDigits(String(req.params.id || '')).trim();
      if (!scopedResource(req, acc.recipes, targetId, parseBranchId)) {
        return res.status(404).json({ error: 'دستور تهیه یافت نشد.' });
      }
      const recipe = engine.inventoryEngine.saveRecipe(acc, { ...req.body, id: targetId, branchId: parseBranchId ? parseBranchId(req) : req.body?.branchId });
      save();
      res.json({ ok: true, recipe });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/admin/finance/menu-engineering', requireCapability('admin.access'), (req, res) => {
    try {
      const db = getDb();
      const acc = engine.ensureAccountingData(db);
      const matrix = engine.inventoryEngine.getMenuEngineeringMatrix(acc, db, reportBranchId(req, parseBranchId), {
        from: req.query.from,
        to: req.query.to,
      });
      res.json(matrix);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── 15. Multi-Branch Consolidation & Benchmarking ─────────────────────────
  app.get('/api/admin/finance/branch-comparison', requireCapability('admin.access'), (req, res) => {
    try {
      const db = getDb();
      const comparison = engine.consolidationEngine.getBranchComparison(db, {
        branchIds: reportBranchIds(req, parseBranchId),
      });
      res.json(comparison);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/admin/finance/inter-branch-transfer', requireCapability('admin.access'), (req, res) => {
    try {
      const db = getDb();
      const acc = engine.ensureAccountingData(db);
      const result = engine.consolidationEngine.recordInterBranchTransfer(acc, {
        ...req.body,
        postJournalFn: engine.postJournalEntry,
        db,
      });
      save();
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── 16. Accruals & Prepaid Expenses ───────────────────────────────────────
  app.get('/api/admin/finance/accruals', requireCapability('admin.access'), (req, res) => {
    try {
      const db = getDb();
      const acc = engine.ensureAccountingData(db);
      const branchId = reportBranchId(req, parseBranchId);
      res.json({ accruals: branchScopedRows(req, acc.accruals, branchId), prepaids: branchScopedRows(req, acc.prepaids, branchId) });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/admin/finance/accruals', requireCapability('admin.access'), (req, res) => {
    try {
      const db = getDb();
      const acc = engine.ensureAccountingData(db);
      const result = engine.accrualEngine.createAccrual(acc, {
        ...(req.body || {}),
        branchId: parseBranchId ? parseBranchId(req) : req.body?.branchId,
        createdById: req.user?.phone || req.user?.id || 'admin',
      });
      save();
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/admin/finance/accruals/:id/reverse', requireCapability('admin.access'), (req, res) => {
    try {
      const db = getDb();
      const acc = engine.ensureAccountingData(db);
      if (!scopedResource(req, acc.accruals, req.params.id, parseBranchId)) {
        return res.status(404).json({ error: 'تعهد یافت نشد.' });
      }
      const result = engine.accrualEngine.reverseAccrual(acc, req.params.id, req.user?.phone || req.user?.id || 'admin');
      save();
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/admin/finance/prepaids', requireCapability('admin.access'), (req, res) => {
    try {
      const db = getDb();
      const acc = engine.ensureAccountingData(db);
      const result = engine.accrualEngine.createPrepaidExpense(acc, {
        ...(req.body || {}),
        branchId: parseBranchId ? parseBranchId(req) : req.body?.branchId,
        createdById: req.user?.phone || req.user?.id || 'admin',
      });
      save();
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/admin/finance/prepaids/:id/amortize', requireCapability('admin.access'), (req, res) => {
    try {
      const db = getDb();
      const acc = engine.ensureAccountingData(db);
      if (!scopedResource(req, acc.prepaids, req.params.id, parseBranchId)) {
        return res.status(404).json({ error: 'پیش‌پرداخت یافت نشد.' });
      }
      const result = engine.accrualEngine.amortizePrepaidPeriod(acc, req.params.id, req.body.periodIndex);
      if (result.journalLines) {
        engine.postJournalEntry(db, {
          source: 'prepaid_amortization',
          sourceId: req.params.id,
          date: new Date().toISOString(),
          description: `استهلاک دوره ${req.body.periodIndex} پیش‌پرداخت`,
          lines: result.journalLines,
        });
      }
      save();
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── 17. Tax Matrix & Rules ────────────────────────────────────────────────
  app.get('/api/admin/finance/tax-matrix', requireCapability('finance.settings.manage'), (req, res) => {
    try {
      const db = getDb();
      const acc = engine.ensureAccountingData(db);
      const branchId = parseBranchId ? parseBranchId(req) : null;
      if (branchId == null) return res.status(400).json({ error: 'برای مشاهدهٔ تنظیم مالیات، یک شعبه انتخاب کنید.', code: 'tax_branch_required' });
      const settings = engine.taxEngine.ensureTaxSettings(acc);
      res.json({
        branchId,
        defaultCategory: settings.defaultCategory,
        deliveryFeeTaxCategory: settings.deliveryFeeTaxCategory || '',
        categories: settings.categories,
        rules: settings.rules.filter((rule) => Number(rule?.locationId) === Number(branchId)),
      });
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message, code: err.code });
    }
  });

  app.patch('/api/admin/finance/tax-matrix', requireCapability('finance.settings.manage'), (req, res) => {
    try {
      if (normalizeRole(req.user?.role) !== 'owner') {
        return res.status(403).json({ error: 'تنظیم گروه‌های مالیاتی در سطح کل رستوران فقط در اختیار مالک است.', code: 'tax_matrix_owner_required' });
      }
      const db = getDb();
      const acc = engine.ensureAccountingData(db);
      const settings = engine.taxEngine.ensureTaxSettings(acc);
      Object.assign(settings, checkoutTaxCategoriesPatch(req.body, settings));
      save();
      res.json({ ok: true, settings: {
        defaultCategory: settings.defaultCategory,
        deliveryFeeTaxCategory: settings.deliveryFeeTaxCategory || '',
        categories: settings.categories,
      } });
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message, code: err.code });
    }
  });

  app.post('/api/admin/finance/tax-matrix/rule', requireCapability('finance.settings.manage'), (req, res) => {
    try {
      const db = getDb();
      const acc = engine.ensureAccountingData(db);
      const settings = engine.taxEngine.ensureTaxSettings(acc);
      const branchId = parseBranchId ? parseBranchId(req) : null;
      const requestedBranchId = normalizeDigits(req.body?.locationId ?? req.body?.branchId ?? '').trim();
      if (branchId == null || !requestedBranchId || Number(requestedBranchId) !== Number(branchId)) {
        return res.status(403).json({ error: 'قاعده باید فقط برای شعبهٔ انتخاب‌شده ثبت شود.', code: 'tax_branch_scope_mismatch' });
      }
      const user = req.user || {};
      const branchScope = Array.isArray(user.allowedBranchIds) ? user.allowedBranchIds
        : Array.isArray(user.branchIds) ? user.branchIds
          : user.branchId == null ? null : [user.branchId];
      const rule = prepareBranchTaxRule(req.body, settings, db.branches, branchScope);
      settings.rules.push(rule);
      save();
      res.json({ ok: true, rule });
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message, code: err.code });
    }
  });

  // ── 18. Settings & Full Ledger Rebuild ────────────────────────────────────
  app.get('/api/admin/finance/settings', requireCapability('admin.access'), (req, res) => {
    try {
      const db = getDb();
      const acc = engine.ensureAccountingData(db);
      res.json({ settings: acc.settings || {} });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.patch('/api/admin/finance/settings', requireCapability('admin.access'), (req, res) => {
    try {
      const db = getDb();
      const acc = engine.ensureAccountingData(db);
      const settings = engine.updateAccountingSettings(acc, req.body);
      save();
      res.json({ ok: true, settings });
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message, code: err.code, details: err.details });
    }
  });

  app.post('/api/admin/finance/rebuild-ledger', requireCapability('admin.access'), (req, res) => {
    try {
      const db = getDb();
      const count = engine.rebuildLedgerFromOrders(db);
      save();
      res.json({ ok: true, syncedCount: count, message: `${count} سند دوبل حسابداری از سفارش‌های ثبت‌شده ایجاد یا همگام شد.` });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── 19. Dedicated Cafe & Restaurant Endpoints ─────────────────────────────
  app.get('/api/admin/finance/restaurant-kpis', requireCapability('admin.access'), (req, res) => {
    try {
      const db = getDb();
      const branchId = reportBranchId(req, parseBranchId);
      const kpis = engine.salesPosEngine.calculateRestaurantKPIs(db, { branchId });
      res.json(kpis);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/admin/finance/z-reports', requireCapability('admin.access'), (req, res) => {
    try {
      const db = getDb();
      const acc = engine.ensureAccountingData(db);
      res.json({ zReports: branchScopedRows(req, acc.zReports, reportBranchId(req, parseBranchId)) });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/admin/finance/z-reports', requireCapability('admin.access'), (req, res) => {
    try {
      const db = getDb();
      const branchId = parseBranchId ? parseBranchId(req) : (req.body.branchId || 1);
      const zReport = engine.salesPosEngine.generateZReport(db, {
        ...req.body,
        branchId,
        createdById: req.user?.phone || req.user?.id || 'admin',
      }, {
        postJournalFn: (jeInput) => engine.postJournalEntry(db, jeInput),
        ensureAccountingDataFn: engine.ensureAccountingData,
      });
      save();
      res.json({ ok: true, zReport });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/admin/finance/recipe-cards', requireCapability('admin.access'), (req, res) => {
    try {
      const db = getDb();
      const acc = engine.ensureAccountingData(db);
      const cards = branchScopedRows(req, engine.inventoryEngine.getRecipeCostCards(acc), reportBranchId(req, parseBranchId));
      res.json({ recipeCards: cards });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/admin/finance/quick-purchase', requireCapability('admin.access'), (req, res) => {
    try {
      const db = getDb();
      const acc = engine.ensureAccountingData(db);
      const { vendorName, category, items = [], totalAmount, paymentMethod = 'petty_cash', notes, date } = req.body || {};

      if (!vendorName || !totalAmount) {
        return res.status(400).json({ error: 'نام تأمین‌کننده و مبلغ کل فاکتور الزامی است.' });
      }

      const branchId = parseBranchId ? parseBranchId(req) : 1;
      const numTotal = Number(totalAmount || 0);
      const invoiceId = `qpur-${Date.now()}`;

      items.forEach((item) => {
        if (item.itemId || item.name) {
          engine.inventoryEngine.receiveStock(acc, {
            itemId: item.itemId,
            itemName: item.name,
            qty: Number(item.qty || 1),
            unitCost: Number(item.unitCost || item.price || 0),
            date: date || new Date().toISOString(),
            branchId,
          });
        }
      });

      const creditAccount = paymentMethod === 'petty_cash' ? '1130' : (paymentMethod === 'bank' ? '1210' : '2110');
      const creditMemo = paymentMethod === 'petty_cash' ? 'پرداخت از تنخواه گردان' : (paymentMethod === 'bank' ? 'پرداخت از حساب بانکی' : 'ثبت در حساب بستانکاران');

      const je = engine.postJournalEntry(db, {
        source: 'quick_purchase',
        sourceId: invoiceId,
        date: date || new Date().toISOString(),
        description: `خرید روزانه ${category || 'تره‌بار و مواد اولیه'} از ${vendorName} — فاکتور ${invoiceId}`,
        lines: [
          { accountCode: '1610', debit: numTotal, credit: 0, memo: `ورود موجودی ${category || 'مواد اولیه'}`, branchId },
          { accountCode: creditAccount, debit: 0, credit: numTotal, memo: creditMemo, branchId },
        ],
        createdById: req.user?.phone || req.user?.id || 'admin',
      });

      save();
      res.json({ ok: true, invoiceId, journalNumber: je.number, message: 'فاکتور خرید روزانه با موفقیت ثبت و به موجودی و اسناد اضافه شد.' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/admin/finance/tips-distribute', requireCapability('admin.access'), (req, res) => {
    try {
      const db = getDb();
      const branchId = parseBranchId ? parseBranchId(req) : (req.body.branchId || 1);
      const result = engine.salesPosEngine.distributeTipPool(db, {
        ...req.body,
        branchId,
        distributedBy: req.user?.phone || req.user?.name || 'مدیر سالن',
      }, {
        postJournalFn: (jeInput) => engine.postJournalEntry(db, jeInput),
        ensureAccountingDataFn: engine.ensureAccountingData,
      });
      save();
      res.json({ ok: true, distribution: result });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/admin/finance/tips-pool', requireCapability('admin.access'), (req, res) => {
    try {
      const db = getDb();
      const acc = engine.ensureAccountingData(db);
      const branchId = reportBranchId(req, parseBranchId);
      const distributions = branchScopedRows(req, acc.tipDistributions, branchId);
      const totalDistributed = distributions.reduce((s, d) => s + (Number(d.totalTips || 0)), 0);
      const paidOrders = (db.orders || []).filter((order) => (branchId == null || Number(order.branchId) === Number(branchId))
        && order.paymentStatus !== 'unpaid' && order.paymentStatus !== 'pending'
        && (order.paymentStatus === 'paid' || ['paid', 'preparing', 'ready', 'done', 'delivered', 'picked_up'].includes(String(order.status || ''))));
      const coveredOrders = paidOrders.filter((order) => order.tip != null || order.tipAmount != null);
      const capturedTips = coveredOrders.reduce((sum, order) => sum + Number(order.tip ?? order.tipAmount ?? 0), 0);
      const poolAmount = coveredOrders.length === paidOrders.length ? Math.max(0, capturedTips - totalDistributed) : null;

      res.json({
        poolAmount,
        totalDistributed,
        recentDistributions: distributions.slice(0, 10),
        status: coveredOrders.length === paidOrders.length ? 'available' : 'insufficient_data',
        coverage: { paidOrders: paidOrders.length, ordersWithTipSnapshot: coveredOrders.length },
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── 20. Advanced BOM & Sub-Recipe Production Endpoints ────────────────────
  app.get('/api/admin/finance/subrecipes', requireCapability('admin.access'), (req, res) => {
    try {
      const db = getDb();
      const acc = engine.ensureAccountingData(db);
      const subRecipes = branchScopedRows(req, acc.subRecipes, reportBranchId(req, parseBranchId));
      res.json({ subRecipes, status: subRecipes.length ? 'available' : 'insufficient_data', source: 'accounting.subRecipes (legacy read-only)' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/admin/finance/subrecipes/produce', requireCapability('admin.access'), (req, res) => {
    try {
      const db = getDb();
      const acc = engine.ensureAccountingData(db);
      const { subRecipeId, batchCount = 1 } = req.body || {};
      const log = engine.fnbCostOptimizer.produceSubRecipeBatch(acc, subRecipeId, batchCount, {
        producedBy: req.user?.name || req.user?.phone || 'سرآشپز آماده‌سازی',
        branchId: parseBranchId ? parseBranchId(req) : 1,
      });

      // Post automatic double-entry journal for batch production (WIP transfer)
      engine.postJournalEntry(db, {
        source: 'subrecipe_production',
        sourceId: log.id,
        date: new Date().toISOString(),
        description: `تولید دسته‌ای آماده‌سازی: ${log.subRecipeName} (${log.totalYieldUnits} ${log.yieldUnit})`,
        lines: [
          { accountCode: '1630', debit: log.totalBatchCost, credit: 0, memo: `انتقال به انبار نیمه‌آماده: ${log.subRecipeName}`, branchId: log.branchId },
          { accountCode: '1610', debit: 0, credit: log.totalBatchCost, memo: 'مصرف مواد اولیه در آماده‌سازی', branchId: log.branchId },
        ],
        createdById: req.user?.phone || req.user?.id || 'admin',
      });

      save();
      res.json({ ok: true, log, message: `تولید دسته‌ای با موفقیت انجام شد و مواد اولیه از انبار کسر گردید.` });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/admin/finance/recipes/:id/bom', requireCapability('admin.access'), (req, res) => {
    try {
      const db = getDb();
      const acc = engine.ensureAccountingData(db);
      // Do the branch authorization before expanding the BOM. The optimizer
      // accepts an id only and otherwise could reveal another branch's
      // ingredient names, quantities and costs to a scoped user.
      const targetId = normalizeDigits(String(req.params.id || '')).trim();
      const recipe = branchScopedRows(req, acc.recipes, reportBranchId(req, parseBranchId))
        .find((row) => String(row.id) === targetId || normalizeDigits(String(row.id)).trim() === targetId);
      if (!recipe) return res.status(404).json({ error: 'دستور تهیه یافت نشد.' });
      const explosion = engine.fnbCostOptimizer.explodeRecipeBOM(acc, targetId);
      res.json(explosion);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/admin/finance/recipes/what-if', requireCapability('admin.access'), (req, res) => {
    try {
      const db = getDb();
      const acc = engine.ensureAccountingData(db);
      const simulation = engine.fnbCostOptimizer.simulateMenuPricingWhatIf(acc, req.body || {});
      res.json(simulation);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}

module.exports = {
  registerAccountingRoutes,
  __test: { branchScopedRows, reportBranchId, reportBranchIds },
};
