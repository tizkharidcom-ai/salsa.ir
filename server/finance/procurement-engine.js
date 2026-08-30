'use strict';

/**
 * WESTO Finance — Procurement, Vendor Bills, Input VAT & Three-Way Match Engine
 * Implements:
 * 1. PO Lifecycle (Draft -> Approved -> Partially Received -> Received)
 * 2. Goods Receipts (GRN) with warehouse valuation update
 * 3. Supplier Bill Ingestion with Input VAT separation (Recoverable vs Non-recoverable)
 * 4. Duplicate Supplier Invoice Detection
 * 5. Three-Way Match Engine (PO vs GRN vs Bill)
 * 6. Supplier Bill Payments with General Ledger posting
 */

const crypto = require('crypto');
const { toIRR, formatNumber } = require('./money');
const { canonicalUnit, convertQuantity } = require('./restaurant-intelligence');
const auditEngine = require('./audit-engine');

const PROCUREMENT_EPSILON = 1e-9;
const PROCUREMENT_MAX_QUANTITY = 1e12;
const PROCUREMENT_MAX_MONEY = Number.MAX_SAFE_INTEGER;
const PROCUREMENT_PAYMENT_METHODS = new Set(['BANK', 'CASH', 'PETTY_CASH']);
const PROCUREMENT_REJECTED_BILL_STATUSES = new Set(['match_rejected', 'reversed', 'cancelled']);

function procurementNow() { return new Date().toISOString(); }
function procurementList(value) { return Array.isArray(value) ? value : []; }
function procurementClone(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }
function procurementId(prefix) {
  const suffix = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${crypto.randomBytes(12).toString('hex')}`;
  return `${prefix}-${suffix}`;
}
function procurementFail(message, code, status = 400, details) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  if (details !== undefined) error.details = details;
  throw error;
}
function procurementLatinDigits(value) {
  return String(value)
    .replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
    .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)));
}
function procurementText(value) {
  return procurementLatinDigits(value == null ? '' : value)
    .trim().replace(/[يى]/g, 'ی').replace(/ك/g, 'ک').replace(/\s+/g, ' ').toLowerCase();
}
function procurementNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const text = procurementLatinDigits(value).replace(/[,٬،\s]/g, '').trim();
  if (!/^-?(?:\d+(?:\.\d+)?|\.\d+)$/.test(text)) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}
function procurementMoney(value, { inputUnit = 'irr', allowZero = true, code = 'amount_invalid' } = {}) {
  const amount = procurementNumber(value);
  if (amount === null || amount < 0 || !Number.isInteger(amount)) procurementFail('مبلغ باید عددی صحیح و نامنفی باشد.', code);
  const unit = procurementText(inputUnit || 'irr');
  if (!['irr', 'rial', 'ریال', 'toman', 'tmn', 'تومان'].includes(unit)) procurementFail('واحد مبلغ فقط ریال یا تومان است.', `${code}_unit`);
  const result = Math.round(amount) * (['toman', 'tmn', 'تومان'].includes(unit) ? 10 : 1);
  if (!Number.isSafeInteger(result) || result > PROCUREMENT_MAX_MONEY || (!allowZero && result <= 0)) procurementFail('مبلغ خارج از محدودهٔ امن یا صفر است.', code);
  return result;
}
function procurementQuantity(value, code = 'quantity_invalid') {
  const quantity = procurementNumber(value);
  if (quantity === null || quantity <= 0 || quantity > PROCUREMENT_MAX_QUANTITY) procurementFail('مقدار باید عددی بزرگ‌تر از صفر و در محدودهٔ امن باشد.', code);
  return quantity;
}
function procurementUnit(value, code = 'unit_invalid') {
  const display = String(value || '').trim();
  const codeUnit = canonicalUnit(display);
  if (!display || !codeUnit) procurementFail('واحد کالا معتبر یا قابل تبدیل نیست.', code);
  return { display, code: codeUnit };
}
function procurementBranch(value, fallback = null, code = 'branch_invalid') {
  if (value === null || value === undefined || value === '') {
    if (fallback === null) return null;
    return procurementBranch(fallback, null, code);
  }
  const parsed = procurementNumber(value);
  if (parsed === null || !Number.isSafeInteger(parsed) || parsed <= 0) procurementFail('شناسهٔ شعبه معتبر نیست.', code);
  return parsed;
}
function procurementRowBranch(row) {
  const raw = row?.branchId ?? row?.locationId;
  return raw === null || raw === undefined || raw === '' ? null : procurementBranch(raw, null, 'stored_branch_invalid');
}
function procurementAssertBranch(expected, actual, code = 'branch_mismatch') {
  if (expected === null || actual === null || Number(expected) !== Number(actual)) procurementFail('سند با شعبهٔ فعال سازگار نیست.', code, 409, { expectedBranchId: expected, actualBranchId: actual });
}
function procurementDate(value, code) {
  const text = String(value || '').trim();
  if (!text || !Number.isFinite(new Date(text).getTime())) procurementFail('تاریخ معتبر نیست.', code);
  return text;
}
function procurementCanonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(procurementCanonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${procurementCanonicalJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value === undefined ? null : value);
}
function procurementImmutablePayload(document, type) {
  const value = procurementClone(document) || {};
  delete value.immutableHash;
  delete value.documentVersion;
  const lifecycle = {
    purchaseOrder: ['status', 'approvedAt', 'approvedBy', 'closedAt'],
    goodsReceipt: ['status', 'reversalId', 'reversedAt', 'reversedBy'],
    vendorBill: ['status', 'paidAmount', 'paymentStatus', 'matchStatus', 'journalEntryId', 'journalNumber', 'reversalId', 'reversedAt', 'reversedBy'],
    vendorPayment: ['status', 'reversalId', 'reversedAt', 'reversedBy'],
  }[type] || [];
  lifecycle.forEach((key) => delete value[key]);
  if (type === 'purchaseOrder') procurementList(value.lines).forEach((line) => {
    delete line.receivedQuantity;
    delete line.receivedQuantityBase;
  });
  return value;
}
function procurementHash(document, type) {
  return crypto.createHash('sha256').update(procurementCanonicalJson(procurementImmutablePayload(document, type))).digest('hex');
}
function procurementSeal(document, type) {
  if (!document.immutableHash) {
    document.documentVersion = 1;
    document.immutableHash = procurementHash(document, type);
  }
  return document;
}
function procurementReseal(document, type) {
  const currentVersion = Number(document.documentVersion);
  document.documentVersion = Number.isSafeInteger(currentVersion) && currentVersion > 0 ? currentVersion + 1 : 2;
  document.immutableHash = procurementHash(document, type);
  return document;
}
function procurementAssertSealed(document, type) {
  if (!document) return;
  if (document.immutableHash && document.immutableHash !== procurementHash(document, type)) {
    procurementFail('سند قطعی دستکاری شده است؛ ویرایش مستقیم مجاز نیست و باید سند معکوس ثبت شود.', 'document_tampered', 409, { documentId: document.id, documentType: type });
  }
  if (!document.immutableHash) procurementSeal(document, type);
}
const PROCUREMENT_ATOMIC_KEYS = ['purchaseOrders', 'goodsReceipts', 'threeWayMatches', 'vendorBills', 'vendorPayments', 'vendorBillPayments', 'procurementReversals', 'procurementIdempotency', 'auditLogs', 'journalEntries', 'vendors'];
function procurementRestoreObject(target, source) {
  Object.keys(target).forEach((key) => { if (!(key in source)) delete target[key]; });
  Object.keys(source).forEach((key) => {
    if (Array.isArray(source[key]) && Array.isArray(target[key])) procurementRestoreArray(target[key], source[key]);
    else if (source[key] && typeof source[key] === 'object' && target[key] && typeof target[key] === 'object' && !Array.isArray(target[key])) procurementRestoreObject(target[key], source[key]);
    else target[key] = procurementClone(source[key]);
  });
  return target;
}
function procurementRestoreArray(target, source) {
  const currentByIdentity = new Map(target.map((item) => [String(item?.id ?? item?.number ?? item?.billNumber ?? ''), item]));
  const restored = source.map((item) => {
    const identity = String(item?.id ?? item?.number ?? item?.billNumber ?? '');
    // Arrays such as journalLines intentionally have no document identity.
    // Reusing the same empty-key object for every row duplicates the last
    // restored line and can invalidate an otherwise untouched document hash.
    const existing = identity ? currentByIdentity.get(identity) : null;
    return existing && item && typeof item === 'object' ? procurementRestoreObject(existing, item) : procurementClone(item);
  });
  target.splice(0, target.length, ...restored);
  return target;
}
function procurementAtomic(acc, operation) {
  const snapshot = Object.fromEntries(PROCUREMENT_ATOMIC_KEYS.map((key) => [key, procurementClone(acc[key])]));
  try { return operation(); } catch (error) {
    const restoredArrays = new Set();
    PROCUREMENT_ATOMIC_KEYS.forEach((key) => {
      if (snapshot[key] === undefined) delete acc[key];
      else if (Array.isArray(snapshot[key])) {
        if (!Array.isArray(acc[key])) acc[key] = [];
        if (!restoredArrays.has(acc[key])) {
          procurementRestoreArray(acc[key], snapshot[key]);
          restoredArrays.add(acc[key]);
        }
      } else if (snapshot[key] && typeof snapshot[key] === 'object') {
        if (!acc[key] || typeof acc[key] !== 'object' || Array.isArray(acc[key])) acc[key] = {};
        Object.keys(acc[key]).forEach((property) => delete acc[key][property]);
        Object.assign(acc[key], procurementClone(snapshot[key]));
      } else acc[key] = snapshot[key];
    });
    throw error;
  }
}
function procurementIdempotencyKey(input) {
  const key = String(input?.idempotencyKey || input?.requestId || input?.clientRequestId || '').trim();
  if (!key) return null;
  if (key.length > 200) procurementFail('کلید idempotency بیش از حد طولانی است.', 'idempotency_key_invalid');
  return key;
}
function procurementRunIdempotent(acc, input, operationName, operation) {
  const key = procurementIdempotencyKey(input);
  if (!key) return procurementAtomic(acc, operation);
  const fingerprintInput = { ...(input || {}) };
  delete fingerprintInput.idempotencyKey;
  delete fingerprintInput.requestId;
  delete fingerprintInput.clientRequestId;
  const fingerprint = crypto.createHash('sha256').update(procurementCanonicalJson(fingerprintInput)).digest('hex');
  const previous = acc.procurementIdempotency[key];
  if (previous) {
    if (previous.operation !== operationName || previous.fingerprint !== fingerprint) procurementFail('این کلید idempotency قبلاً برای درخواست متفاوت مصرف شده است.', 'idempotency_key_conflict', 409);
    return { ...procurementClone(previous.result), idempotentReplay: true };
  }
  const result = procurementAtomic(acc, operation);
  acc.procurementIdempotency[key] = { operation: operationName, fingerprint, result: procurementClone(result), createdAt: procurementNow() };
  return { ...result, idempotentReplay: false };
}
function procurementAudit(acc, action, entityType, entityId, userId, message, metadata) {
  return auditEngine.recordAuditLog(acc, { action, entityType, entityId, userId: userId || 'admin', message, metadata });
}
function procurementNormalizeQuantity(value, inputUnit, targetUnit, conversions, code) {
  const quantity = procurementQuantity(value, code);
  const from = procurementUnit(inputUnit);
  const to = procurementUnit(targetUnit);
  const converted = convertQuantity(quantity, from.code, to.code, conversions || []);
  if (!converted.ok || !Number.isFinite(converted.value) || converted.value <= 0 || converted.value > PROCUREMENT_MAX_QUANTITY) procurementFail('مقدار و واحد با واحد پایهٔ سند سازگار نیست.', 'unit_incompatible', 409, { fromUnit: from.code, toUnit: to.code });
  return { inputQuantity: quantity, inputUnit: from.display, inputUnitCode: from.code, quantity: converted.value, unit: to.display, unitCode: to.code, conversionSource: converted.source };
}
function procurementLineAmount(quantity, unitPrice, code) {
  const result = Math.round(quantity * unitPrice);
  if (!Number.isSafeInteger(result) || result < 0 || result > PROCUREMENT_MAX_MONEY) procurementFail('جمع ریالی ردیف از محدودهٔ امن خارج است.', code);
  return result;
}
function procurementAllocatedAmount(totalAmount, totalQuantity, quantity, code) {
  const total = procurementNumber(totalAmount);
  const denominator = procurementNumber(totalQuantity);
  const allocatedQuantity = procurementNumber(quantity);
  if (total === null || !Number.isSafeInteger(total) || total < 0 || denominator === null || denominator <= 0 || allocatedQuantity === null || allocatedQuantity < 0 || allocatedQuantity > denominator) {
    procurementFail('تخصیص مبلغ رسید کالا معتبر نیست.', code);
  }
  const result = Math.round(total * allocatedQuantity / denominator);
  if (!Number.isSafeInteger(result) || result < 0 || result > PROCUREMENT_MAX_MONEY) procurementFail('مبلغ تخصیص‌یافته از محدودهٔ امن خارج است.', code);
  return result;
}
function procurementStoredRate(value, code) {
  const rate = procurementNumber(value);
  if (rate === null || rate <= 0 || !Number.isFinite(rate) || rate > PROCUREMENT_MAX_MONEY) procurementFail('نرخ واحد ذخیره‌شده معتبر نیست.', code);
  return rate;
}
function procurementNextNumber(rows, prefix) {
  const used = new Set(rows.map((row) => String(row.number || row.billNumber || '')));
  let count = rows.length + 1;
  let result = `${prefix}-${new Date().getFullYear()}-${String(count).padStart(5, '0')}`;
  while (used.has(result)) result = `${prefix}-${new Date().getFullYear()}-${String(++count).padStart(5, '0')}`;
  return result;
}
function procurementVendor(acc, vendorId, branch) {
  const id = String(vendorId || '').trim();
  if (!id) procurementFail('تأمین‌کننده الزامی است.', 'vendor_missing');
  const vendor = acc.vendors.find((row) => String(row.id) === id || procurementText(row.name) === procurementText(id) || procurementText(row.nameFa) === procurementText(id));
  if (acc.vendors.length && !vendor) procurementFail('تأمین‌کننده در دفتر تأمین‌کنندگان یافت نشد.', 'vendor_not_found', 404);
  if (vendor && vendor.branchId != null) procurementAssertBranch(branch, procurementRowBranch(vendor), 'vendor_branch_mismatch');
  return vendor || null;
}
function procurementInventoryItem(acc, itemId, branch) {
  const id = String(itemId || '').trim();
  if (!id) return null;
  const items = procurementList(acc.inventoryItems);
  const item = items.find((row) => String(row.id) === id);
  if (items.length && !item) procurementFail('کالای انبار یافت نشد.', 'inventory_item_not_found', 404);
  if (item && item.branchId != null) procurementAssertBranch(branch, procurementRowBranch(item), 'inventory_item_branch_mismatch');
  return item || null;
}

function ensureProcurement(acc) {
  if (!Array.isArray(acc.purchaseOrders)) acc.purchaseOrders = [];
  if (!Array.isArray(acc.goodsReceipts)) acc.goodsReceipts = [];
  if (!Array.isArray(acc.threeWayMatches)) acc.threeWayMatches = [];
  if (!Array.isArray(acc.vendorBills)) acc.vendorBills = [];
  if (!Array.isArray(acc.vendors)) acc.vendors = [];
  if (!Array.isArray(acc.vendorPayments)) acc.vendorPayments = [];
  if (!Array.isArray(acc.vendorBillPayments)) acc.vendorBillPayments = acc.vendorPayments;
  if (!Array.isArray(acc.procurementReversals)) acc.procurementReversals = [];
  if (!acc.procurementIdempotency || typeof acc.procurementIdempotency !== 'object' || Array.isArray(acc.procurementIdempotency)) acc.procurementIdempotency = {};
  // Backward-compatible read normalization for documents created before the
  // branch/unit controls existed.  It does not alter business amounts or
  // history, and new documents are still required to carry both fields.
  acc.purchaseOrders.forEach((po) => {
    if (po.branchId == null && po.locationId != null) po.branchId = procurementBranch(po.locationId, 1, 'stored_branch_invalid');
    if (po.locationId == null && po.branchId != null) po.locationId = procurementBranch(po.branchId, 1, 'stored_branch_invalid');
    procurementList(po.lines).forEach((line) => {
      if (!line.unitCode && canonicalUnit(line.unit)) line.unitCode = canonicalUnit(line.unit);
      if (!Array.isArray(line.conversions)) line.conversions = [];
    });
  });
  acc.goodsReceipts.forEach((grn) => {
    if (grn.branchId == null) {
      const po = acc.purchaseOrders.find((row) => String(row.id) === String(grn.poId || grn.purchaseOrderId));
      grn.branchId = procurementRowBranch(po) || 1;
    }
  });
  acc.vendorBills.forEach((bill) => {
    if (bill.branchId == null) {
      const grn = acc.goodsReceipts.find((row) => String(row.id) === String(bill.grnId || bill.goodsReceiptId));
      const po = acc.purchaseOrders.find((row) => String(row.id) === String(bill.poId || bill.purchaseOrderId));
      bill.branchId = procurementRowBranch(grn) || procurementRowBranch(po) || 1;
    }
  });
  return acc;
}

/**
 * Checks for likely duplicate supplier invoices.
 */
function detectDuplicateBill(acc, { vendorId, invoiceNumber, excludeId }) {
  ensureProcurement(acc);
  const normalizedInvNo = procurementText(invoiceNumber);
  if (!normalizedInvNo) return null;
  return acc.vendorBills.find((b) => {
    if (excludeId && String(b.id) === String(excludeId)) return false;
    if (String(b.vendorId) !== String(vendorId)) return false;
    return procurementText(b.invoiceNumber || b.billNumber) === normalizedInvNo;
  }) || null;
}

/**
 * Creates a Purchase Order (PO).
 */
function createPurchaseOrder(acc, input = {}) {
  ensureProcurement(acc);
  const branch = procurementBranch(input.branchId ?? input.locationId, 1, 'branch_missing');
  const requestedVendorId = String(input.vendorId || input.supplierId || '').trim();
  const vendor = procurementVendor(acc, requestedVendorId, branch);
  const vendorId = vendor?.id || requestedVendorId;
  const rawLines = procurementList(input.lines);
  if (!rawLines.length || rawLines.length > 500) procurementFail('سفارش خرید باید حداقل یک ردیف معتبر داشته باشد.', 'purchase_order_lines_missing');

  return procurementRunIdempotent(acc, input, 'create_purchase_order', () => {
    const issueDate = input.issueDate ? procurementDate(input.issueDate, 'purchase_issue_date_invalid') : procurementNow();
    const expectedDate = input.expectedDate ? procurementDate(input.expectedDate, 'purchase_expected_date_invalid') : null;
    let subtotal = 0;
    let lineTaxTotal = 0;
    const sanitizedLines = rawLines.map((line, i) => {
      const itemId = String(line.itemId || line.ingredientId || '').trim() || null;
      const item = procurementInventoryItem(acc, itemId, branch);
      const baseUnit = item?.unit || line.unit || 'کیلوگرم';
      const unit = procurementUnit(line.unit || baseUnit, 'purchase_unit_invalid');
      if (item?.unit) {
        const itemUnit = procurementUnit(item.unit, 'inventory_unit_invalid');
        if (unit.code !== itemUnit.code) procurementFail(`واحد ردیف ${i + 1} باید با واحد پایهٔ کالا برابر باشد.`, 'purchase_item_unit_mismatch', 409, { lineNo: i + 1, expectedUnit: itemUnit.code, actualUnit: unit.code });
      }
      const quantity = procurementQuantity(line.quantity ?? line.qty, 'purchase_quantity_invalid');
      const unitPrice = procurementMoney(line.unitPriceIrr ?? line.unitPrice ?? line.price, { inputUnit: line.priceCurrency || 'irr', allowZero: false, code: 'purchase_unit_price_invalid' });
      const tax = procurementMoney(line.taxIrr ?? 0, { inputUnit: line.taxCurrency || 'irr', code: 'purchase_tax_invalid' });
      const discount = procurementMoney(line.discountIrr ?? 0, { inputUnit: line.discountCurrency || 'irr', code: 'purchase_discount_invalid' });
      const gross = procurementLineAmount(quantity, unitPrice, 'purchase_line_total_invalid');
      const lineTotal = gross + tax - discount;
      if (!Number.isSafeInteger(lineTotal) || lineTotal < 0 || lineTotal > PROCUREMENT_MAX_MONEY) procurementFail(`جمع ردیف ${i + 1} معتبر نیست.`, 'purchase_line_total_invalid');
      subtotal += gross - discount;
      lineTaxTotal += tax;
      if (!Number.isSafeInteger(subtotal) || subtotal > PROCUREMENT_MAX_MONEY) procurementFail('جمع سفارش خرید از محدودهٔ امن خارج است.', 'purchase_total_unsafe');
      return {
        id: procurementId('pol'), itemId, description: String(line.description || line.name || item?.name || 'کالای سفارشی').trim().slice(0, 180),
        quantity, receivedQuantity: 0, unit: unit.display, unitCode: unit.code, unitPrice, priceCurrency: 'IRR', taxIrr: tax, discountIrr: discount,
        totalPrice: lineTotal, conversions: procurementClone(item?.conversions || []), taxCategory: line.taxCategory || 'standard_1405',
      };
    });
    const taxAmount = input.taxAmount !== undefined
      ? procurementMoney(input.taxAmount, { inputUnit: input.taxCurrency || 'irr', code: 'purchase_tax_invalid' })
      : (lineTaxTotal > 0 ? lineTaxTotal : Math.round(subtotal * 0.10));
    const total = subtotal + taxAmount;
    if (!Number.isSafeInteger(total) || total > PROCUREMENT_MAX_MONEY) procurementFail('جمع کل سفارش خرید از محدودهٔ امن خارج است.', 'purchase_total_unsafe');
    const po = {
      id: procurementId('po'), number: procurementNextNumber(acc.purchaseOrders, 'PO'), vendorId, branchId: branch, locationId: branch,
      status: 'draft', issueDate, expectedDate, subtotal, taxAmount, total,
      notes: String(input.notes || '').trim().slice(0, 300), createdById: input.createdById || 'admin', lines: sanitizedLines, createdAt: procurementNow(),
    };
    procurementSeal(po, 'purchaseOrder');
    acc.purchaseOrders.push(po);
    procurementAudit(acc, 'CREATE_PURCHASE_ORDER', 'PurchaseOrder', po.id, po.createdById, `سفارش خرید شماره ${po.number} به مبلغ کل ${formatNumber(total)} ریال ثبت شد.`);
    return { ok: true, po };
  });
}

/**
 * Approves a Purchase Order.
 */
function approvePurchaseOrder(acc, poId, userId) {
  ensureProcurement(acc);
  const po = acc.purchaseOrders.find((p) => p.id === poId);
  if (!po) return { ok: false, error: 'سفارش خرید یافت نشد.' };
  return procurementAtomic(acc, () => {
    procurementAssertSealed(po, 'purchaseOrder');
    if (po.status !== 'draft') return { ok: false, error: `وضعیت فعلی: ${po.status} — فقط پیش‌نویس قابل تایید است.` };
    po.status = 'approved';
    po.approvedAt = procurementNow();
    po.approvedBy = userId || 'admin';
    procurementAudit(acc, 'APPROVE_PURCHASE_ORDER', 'PurchaseOrder', po.id, userId, `سفارش خرید ${po.number} تأیید شد.`);
    return { ok: true, po };
  });
}

/**
 * Records a Goods Receipt Note (GRN) when items arrive at the warehouse.
 */
function receiveGoods(acc, input = {}, opts = {}) {
  ensureProcurement(acc);
  const replay = procurementReplay(acc, input, 'receive_goods');
  if (replay) return replay;
  const poId = String(input.poId || input.purchaseOrderId || '').trim();
  if (!poId) procurementFail('رسید کالا باید به سفارش خرید متصل باشد.', 'purchase_order_required');
  const po = acc.purchaseOrders.find((row) => String(row.id) === poId);
  if (!po) procurementFail('سفارش خرید یافت نشد.', 'purchase_order_not_found', 404);
  const branch = procurementBranch(input.branchId ?? input.locationId ?? opts.branchId, procurementRowBranch(po), 'goods_receipt_branch_invalid');
  procurementAssertBranch(procurementRowBranch(po), branch, 'goods_receipt_branch_mismatch');
  if (!['approved', 'partially_received'].includes(po.status)) procurementFail('فقط سفارش خرید تأییدشده قابل دریافت است.', 'purchase_order_not_approved', 409);
  if (input.vendorId) {
    const receiptVendor = procurementVendor(acc, input.vendorId, branch);
    if (String(receiptVendor?.id || input.vendorId) !== String(po.vendorId)) procurementFail('تأمین‌کنندهٔ رسید با سفارش خرید یکسان نیست.', 'goods_receipt_vendor_mismatch', 409);
  }
  const rawLines = procurementList(input.lines);
  if (!rawLines.length || rawLines.length > 500) procurementFail('حداقل یک ردیف دریافت الزامی است.', 'goods_receipt_lines_missing');
  const deliveryNoteNumber = String(input.deliveryNoteNumber || '').trim().slice(0, 120);
  if (deliveryNoteNumber && acc.goodsReceipts.some((row) => String(row.vendorId) === String(po.vendorId) && procurementText(row.deliveryNoteNumber) === procurementText(deliveryNoteNumber))) procurementFail('شماره حوالهٔ تأمین‌کننده قبلاً ثبت شده است.', 'goods_receipt_duplicate', 409);

  return procurementRunIdempotent(acc, input, 'receive_goods', () => {
    procurementAssertSealed(po, 'purchaseOrder');
    const seen = new Set();
    const sanitizedLines = rawLines.map((line, index) => {
      const poLineId = String(line.poLineId || line.purchaseOrderLineId || '').trim();
      const poLine = po.lines.find((row) => String(row.id) === poLineId);
      if (!poLine) procurementFail(`ردیف ${index + 1} به سفارش خرید متصل نیست.`, 'purchase_order_line_not_found', 404);
      if (seen.has(poLine.id)) procurementFail(`ردیف ${index + 1} در همین رسید تکرار شده است.`, 'goods_receipt_duplicate_purchase_order_line', 409);
      seen.add(poLine.id);
      if (line.itemId && String(line.itemId) !== String(poLine.itemId)) procurementFail(`کالای ردیف ${index + 1} با سفارش خرید یکسان نیست.`, 'goods_receipt_item_mismatch', 409);
      if (line.unit && !convertQuantity(1, line.unit, poLine.unit || poLine.unitCode, poLine.conversions || []).ok) procurementFail(`واحد ردیف ${index + 1} با واحد سفارش خرید سازگار نیست.`, 'goods_receipt_unit_mismatch', 409);
      const normalized = procurementNormalizeQuantity(line.quantityReceived ?? line.quantity ?? line.qty, line.unit || poLine.unit, poLine.unit, poLine.conversions, 'goods_receipt_quantity_invalid');
      const alreadyReceived = Number(poLine.receivedQuantity || 0);
      const remaining = Number(poLine.quantity) - alreadyReceived;
      if (normalized.quantity > remaining + PROCUREMENT_EPSILON) procurementFail(`دریافت ردیف ${index + 1} از مانده سفارش بیشتر است.`, 'goods_receipt_over_quantity', 409, { remainingQuantity: remaining, requestedQuantity: normalized.quantity });
      const explicitUnitCost = line.unitCostIrr !== undefined || line.unitCost !== undefined || line.unitPrice !== undefined;
      const inputUnitCost = explicitUnitCost
        ? procurementMoney(line.unitCostIrr ?? line.unitCost ?? line.unitPrice, { inputUnit: line.costCurrency || 'irr', allowZero: false, code: 'goods_receipt_unit_cost_invalid' })
        : procurementMoney(poLine.unitPrice, { inputUnit: 'irr', allowZero: false, code: 'goods_receipt_unit_cost_invalid' });
      const totalCost = explicitUnitCost
        ? procurementLineAmount(normalized.inputQuantity, inputUnitCost, 'goods_receipt_value_invalid')
        : procurementLineAmount(normalized.quantity, inputUnitCost, 'goods_receipt_value_invalid');
      const unitCost = totalCost / normalized.quantity;
      return {
        id: procurementId('grnl'), poLineId: poLine.id, itemId: poLine.itemId, description: poLine.description,
        quantityReceived: normalized.quantity, receivedInputQuantity: normalized.inputQuantity, receivedInputUnit: normalized.inputUnit,
        unit: poLine.unit, unitCode: poLine.unitCode, unitCost, unitCostInput: inputUnitCost, unitCostInputUnit: normalized.inputUnit, totalCost,
      };
    });
    const totalValue = sanitizedLines.reduce((sum, line) => sum + line.totalCost, 0);
    if (!Number.isSafeInteger(totalValue) || totalValue > PROCUREMENT_MAX_MONEY) procurementFail('ارزش رسید کالا از محدودهٔ امن خارج است.', 'goods_receipt_value_unsafe');
    const receivedDate = input.receivedDate || input.receivedAt || procurementNow();
    procurementDate(receivedDate, 'goods_receipt_date_invalid');
    const grn = {
      id: procurementId('grn'), number: procurementNextNumber(acc.goodsReceipts, 'GRN'), poId: po.id, poNumber: po.number,
      purchaseOrderId: po.id, purchaseOrderNumber: po.number, vendorId: po.vendorId, branchId: branch,
      deliveryNoteNumber, receivedDate, receivedAt: receivedDate, totalValue, totalValueIrr: totalValue,
      notes: String(input.notes || '').trim().slice(0, 300), lines: sanitizedLines, status: 'completed', createdById: input.createdById || 'admin', createdAt: procurementNow(),
      journalEntryId: null, journalNumber: null,
    };
    const journalLines = [
      { accountCode: opts.inventoryAccountCode || '1610', debit: totalValue, credit: 0, branchId: branch, memo: `دریافت کالا ${grn.number}` },
      { accountCode: opts.grniAccountCode || '2120', debit: 0, credit: totalValue, branchId: branch, memo: `کالای دریافت‌شده و فاکتورنشده ${grn.number}` },
    ];
    let journalEntry = null;
    if (opts.postJournalFn) {
      journalEntry = opts.postJournalFn({ source: 'goods_receipt', sourceId: grn.id, date: receivedDate, description: `ثبت GRNI رسید ${grn.number}`, lines: journalLines, createdById: input.createdById || 'admin' });
      grn.journalEntryId = journalEntry?.id || null;
      grn.journalNumber = journalEntry?.number || null;
    }
    grn.journalLines = journalLines;
    procurementSeal(grn, 'goodsReceipt');
    acc.goodsReceipts.push(grn);
    sanitizedLines.forEach((line) => {
      const poLine = po.lines.find((row) => row.id === line.poLineId);
      poLine.receivedQuantity = Number(poLine.receivedQuantity || 0) + line.quantityReceived;
    });
    po.status = po.lines.every((line) => Number(line.receivedQuantity || 0) >= Number(line.quantity) - PROCUREMENT_EPSILON) ? 'received' : 'partially_received';
    procurementAudit(acc, 'RECEIVE_GOODS', 'GoodsReceipt', grn.id, grn.createdById, `رسید ورود کالا ${grn.number} به ارزش ${formatNumber(totalValue)} ریال ثبت گردید.`);
    return { ok: true, grn, journalEntry, po };
  });
}

/**
 * Creates a Supplier Bill (فاکتور خرید تأمین‌کننده) with Input VAT separation and GL posting.
 */
function legacyCreateVendorBill(acc, billInput, opts = {}) {
  ensureProcurement(acc);
  const { postJournalFn } = opts;

  const vendorId = String(billInput.vendorId || billInput.supplierId || '').trim();
  const invoiceNumber = String(billInput.invoiceNumber || billInput.billNumber || '').trim();
  const billDate = billInput.date || billInput.billDate || new Date().toISOString();
  const dueDate = billInput.dueDate || new Date(Date.now() + 30 * 86400000).toISOString();
  const branchId = billInput.branchId ? Number(billInput.branchId) : 1;

  const totalAmount = toIRR(billInput.total || billInput.totalAmount || billInput.amount || 0);

  // Duplicate Check
  const duplicate = detectDuplicateBill(acc, { vendorId, invoiceNumber, date: billDate, totalAmount });
  if (duplicate) {
    throw new Error(`فاکتور تکراری کشف شد! فاکتور با شماره «${duplicate.invoiceNumber || duplicate.billNumber}» به مبلغ مشابه قبلاً در سیستم ثبت شده است.`);
  }

  const isExempt = Boolean(billInput.isExempt);
  const rawVat = isExempt ? 0 : toIRR(billInput.vatAmount || billInput.taxAmount || Math.round((totalAmount / 1.10) * 0.10));
  const netAmount = totalAmount - rawVat;

  const billId = `bill-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const billNo = `BILL-${new Date().getFullYear()}-${String(acc.vendorBills.length + 1).padStart(5, '0')}`;

  const vendor = (acc.vendors || []).find((v) => v.id === vendorId || v.name === vendorId);
  const vendorName = vendor ? vendor.name : vendorId;

  // GL Posting: DR Inventory (1610), DR Input VAT Recoverable (1450), CR Supplier AP (2110)
  const journalLines = [
    {
      accountCode: '1610', // Raw Food & Beverage Inventory
      debit: netAmount,
      credit: 0,
      memo: `خرید مواد اولیه - فاکتور ${invoiceNumber || billNo} (${vendorName})`,
      branchId,
    },
    ...(rawVat > 0 ? [{
      accountCode: '1450', // Recoverable Input VAT (اعتبار مالیاتی خرید)
      debit: rawVat,
      credit: 0,
      memo: `اعتبار مالیات ارزش افزوده خرید - فاکتور ${invoiceNumber || billNo}`,
      branchId,
    }] : []),
    {
      accountCode: '2110', // Trade Vendors Payable (حساب‌های پرداختنی تجاری)
      debit: 0,
      credit: totalAmount,
      memo: `بدهی تجاری فاکتور ${invoiceNumber || billNo} (${vendorName})`,
      branchId,
    },
  ];

  let journalEntry = null;
  if (postJournalFn) {
    journalEntry = postJournalFn({
      source: 'vendor_bill',
      sourceId: billId,
      date: billDate,
      description: `ثبت فاکتور خرید تأمین‌کننده: ${vendorName} (شماره فاکتور: ${invoiceNumber || billNo})`,
      lines: journalLines,
      createdById: billInput.createdById || 'admin',
    });
  }

  const bill = {
    id: billId,
    billNumber: billNo,
    invoiceNumber,
    vendorId,
    vendorName,
    poId: billInput.poId || null,
    grnId: billInput.grnId || null,
    date: billDate,
    dueDate,
    subtotal: netAmount,
    vatAmount: rawVat,
    total: totalAmount,
    paidAmount: 0,
    status: 'unpaid', // unpaid, partially_paid, paid
    journalEntryId: journalEntry ? journalEntry.id : null,
    journalNumber: journalEntry ? journalEntry.number : null,
    createdAt: new Date().toISOString(),
  };

  acc.vendorBills.push(bill);

  auditEngine.recordAuditLog(acc, {
    action: 'CREATE_VENDOR_BILL',
    entityType: 'VendorBill',
    entityId: bill.id,
    userId: billInput.createdById || 'admin',
    message: `فاکتور خرید ${bill.billNumber} به مبلغ ${formatNumber(totalAmount)} ریال ثبت گردید.`,
  });

  return { ok: true, bill, journalEntry };
}

/**
 * Performs Three-Way Match across PO, GRN, and Vendor Bill.
 */
function legacyPerformThreeWayMatch(acc, { billId, poId, grnId }) {
  ensureProcurement(acc);
  const bill = (acc.vendorBills || []).find((b) => b.id === billId);
  const po = poId ? acc.purchaseOrders.find((p) => p.id === poId) : null;
  const grn = grnId ? acc.goodsReceipts.find((g) => g.id === grnId) : null;

  if (!bill) return { ok: false, error: 'فاکتور تامین‌کننده یافت نشد.' };

  const billTotal = toIRR(bill.total || bill.amount || 0);
  const poTotal = po ? toIRR(po.total) : null;
  const grnTotal = grn ? toIRR(grn.totalValue) : null;

  const priceVariance = poTotal !== null ? (billTotal - poTotal) : 0;
  const qtyVariance = (po && grn) ? (po.lines.reduce((s, l) => s + l.quantity, 0) - grn.lines.reduce((s, l) => s + l.quantityReceived, 0)) : 0;
  const isMatch = Math.abs(priceVariance) <= 1000 && Math.abs(qtyVariance) <= 0.01;

  const matchRecord = {
    id: `3wm-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    billId: bill.id,
    billNumber: bill.billNumber || bill.number || `#${bill.id}`,
    poId: po ? po.id : null,
    poNumber: po ? po.number : null,
    grnId: grn ? grn.id : null,
    grnNumber: grn ? grn.number : null,
    billTotal,
    poTotal,
    grnTotal,
    priceVariance,
    qtyVariance,
    status: isMatch ? 'matched' : (priceVariance !== 0 ? 'price_variance' : 'qty_variance'),
    matchedAt: new Date().toISOString(),
  };

  acc.threeWayMatches.push(matchRecord);
  return { ok: true, match: matchRecord };
}

/**
 * Pays a Supplier Bill and posts GL settlement entry.
 */
function legacyPayVendorBill(acc, billId, paymentInput, opts = {}) {
  ensureProcurement(acc);
  const { postJournalFn } = opts;

  const bill = acc.vendorBills.find((b) => b.id === billId);
  if (!bill) throw new Error('فاکتور خرید یافت نشد.');

  const amountToPay = toIRR(paymentInput.amount || (bill.total - (bill.paidAmount || 0)));
  const remaining = bill.total - (bill.paidAmount || 0);

  if (amountToPay <= 0 || amountToPay > remaining) {
    throw new Error(`مبلغ پرداختی (${formatNumber(amountToPay)}) نامعتبر است یا از مانده بدهی (${formatNumber(remaining)}) بیشتر است.`);
  }

  const payMethod = String(paymentInput.paymentMethod || 'BANK').toUpperCase();
  let creditAccount = '1210'; // Bank Account
  if (payMethod === 'CASH') creditAccount = '1110';
  else if (payMethod === 'PETTY_CASH') creditAccount = '1120';

  const payDate = paymentInput.date || new Date().toISOString();

  // GL Posting: DR Supplier AP (2110), CR Bank/Cash (1210/1110)
  const journalLines = [
    {
      accountCode: '2110', // Trade Vendors Payable
      debit: amountToPay,
      credit: 0,
      memo: `تسویه بدهی فاکتور ${bill.billNumber} (${bill.vendorName})`,
      branchId: bill.branchId || 1,
    },
    {
      accountCode: creditAccount,
      debit: 0,
      credit: amountToPay,
      memo: `پرداخت وجه فاکتور ${bill.billNumber} از طریق ${payMethod}`,
      branchId: bill.branchId || 1,
    },
  ];

  let journalEntry = null;
  if (postJournalFn) {
    journalEntry = postJournalFn({
      source: 'bill_payment',
      sourceId: bill.id,
      date: payDate,
      description: `پرداخت فاکتور تأمین‌کننده ${bill.vendorName} (${bill.billNumber})`,
      lines: journalLines,
      createdById: paymentInput.createdById || 'admin',
    });
  }

  bill.paidAmount = (bill.paidAmount || 0) + amountToPay;
  bill.status = bill.paidAmount >= bill.total ? 'paid' : 'partially_paid';

  auditEngine.recordAuditLog(acc, {
    action: 'PAY_VENDOR_BILL',
    entityType: 'VendorBill',
    entityId: bill.id,
    userId: paymentInput.createdById || 'admin',
    message: `پرداخت مبلغ ${formatNumber(amountToPay)} ریال بابت فاکتور ${bill.billNumber} ثبت شد. وضعیت فاکتور: ${bill.status}`,
  });

  return { ok: true, bill, paymentAmount: amountToPay, journalEntry };
}

/* -------------------------------------------------------------------------- */
/* Hardened legacy-flow implementations                                      */
/* -------------------------------------------------------------------------- */

function procurementReplay(acc, input, operationName) {
  const key = procurementIdempotencyKey(input);
  if (!key) return null;
  const fingerprintInput = { ...(input || {}) };
  delete fingerprintInput.idempotencyKey;
  delete fingerprintInput.requestId;
  delete fingerprintInput.clientRequestId;
  const fingerprint = crypto.createHash('sha256').update(procurementCanonicalJson(fingerprintInput)).digest('hex');
  const previous = acc.procurementIdempotency[key];
  if (!previous) return null;
  if (previous.operation !== operationName || previous.fingerprint !== fingerprint) procurementFail('این کلید idempotency قبلاً برای درخواست متفاوت مصرف شده است.', 'idempotency_key_conflict', 409);
  return { ...procurementClone(previous.result), idempotentReplay: true };
}

function procurementVendorBillActive(bill) {
  return bill && !PROCUREMENT_REJECTED_BILL_STATUSES.has(String(bill.status)) && bill.status !== 'unmatched';
}

function procurementLinkedDocuments(acc, bill, poId, grnId, { seal = true } = {}) {
  const resolvedPoId = String(poId || bill.poId || '').trim();
  const resolvedGrnId = String(grnId || bill.grnId || '').trim();
  const po = resolvedPoId ? acc.purchaseOrders.find((row) => String(row.id) === resolvedPoId) : null;
  const grn = resolvedGrnId ? acc.goodsReceipts.find((row) => String(row.id) === resolvedGrnId) : null;
  if (!po || !grn) procurementFail('برای تطبیق سه‌طرفه، PO و رسید کالا هر دو الزامی هستند.', 'three_way_documents_required', 409);
  if (String(grn.poId || grn.purchaseOrderId) !== String(po.id)) procurementFail('رسید کالا به این سفارش خرید تعلق ندارد.', 'three_way_po_receipt_mismatch', 409);
  if (String(grn.status) === 'reversed') procurementFail('رسید معکوس‌شده قابل استفاده در تطبیق سه‌طرفه نیست.', 'goods_receipt_reversed', 409);
  if (['reversed', 'cancelled'].includes(String(po.status))) procurementFail('سفارش خرید معکوس یا لغوشده قابل استفاده نیست.', 'purchase_order_not_active', 409);
  procurementAssertBranch(procurementRowBranch(po), procurementRowBranch(grn), 'three_way_branch_mismatch');
  // Report an explicit bill/document scope violation before checking hashes.
  // A received PO/GRN legitimately changes lifecycle fields; if the bill is
  // for another branch, callers must receive the actionable scope error even
  // when the linked document's immutable payload is already stale.
  procurementAssertBranch(procurementRowBranch(po), procurementRowBranch(bill), 'three_way_branch_mismatch');
  if (String(bill.vendorId) !== String(po.vendorId) || String(bill.vendorId) !== String(grn.vendorId)) procurementFail('تأمین‌کنندهٔ PO، رسید و فاکتور یکسان نیست.', 'three_way_vendor_mismatch', 409);
  if (bill.poId && String(bill.poId) !== String(po.id)) procurementFail('فاکتور به PO دیگری متصل است.', 'three_way_bill_po_mismatch', 409);
  if (bill.grnId && String(bill.grnId) !== String(grn.id)) procurementFail('فاکتور به رسید دیگری متصل است.', 'three_way_bill_grn_mismatch', 409);
  if (seal) {
    procurementAssertSealed(po, 'purchaseOrder');
    procurementAssertSealed(grn, 'goodsReceipt');
  }
  return { po, grn };
}

function procurementPreviouslyInvoiced(acc, grnLineId, excludeBillId) {
  return acc.vendorBills
    .filter((bill) => String(bill.id) !== String(excludeBillId || '') && procurementVendorBillActive(bill))
    .flatMap((bill) => procurementList(bill.lines))
    .filter((line) => String(line.grnLineId || line.receiptLineId) === String(grnLineId))
    .reduce((sum, line) => sum + Number(line.quantity || line.invoicedQuantity || 0), 0);
}

function procurementBuildMatch(acc, bill, po, grn, { toleranceIrr = 0 } = {}) {
  const invoiceLines = procurementList(bill.lines);
  if (!invoiceLines.length) procurementFail('برای تطبیق سه‌طرفه، ردیف‌های فاکتور الزامی است.', 'vendor_bill_lines_missing');
  const seen = new Set();
  let invoiceNet = 0;
  let receiptValue = 0;
  let unbilledQuantity = 0;
  const details = [];
  for (const [index, line] of invoiceLines.entries()) {
    const grnLineId = String(line.grnLineId || line.receiptLineId || '').trim();
    const grnLine = grn.lines.find((row) => String(row.id) === grnLineId);
    if (!grnLine) procurementFail(`ردیف فاکتور ${index + 1} به رسید کالا متصل نیست.`, 'goods_receipt_line_not_found', 404);
    if (seen.has(grnLine.id)) procurementFail(`ردیف رسید ${index + 1} در فاکتور تکرار شده است.`, 'vendor_invoice_duplicate_receipt_line', 409);
    seen.add(grnLine.id);
    const poLine = po.lines.find((row) => String(row.id) === String(grnLine.poLineId));
    if (!poLine) procurementFail(`ردیف رسید ${index + 1} به PO متصل نیست.`, 'purchase_order_line_not_found', 409);
    if (line.poLineId && String(line.poLineId) !== String(poLine.id)) procurementFail(`ردیف فاکتور ${index + 1} با PO یکسان نیست.`, 'vendor_invoice_po_line_mismatch', 409);
    if (line.itemId && String(line.itemId) !== String(grnLine.itemId || poLine.itemId)) procurementFail(`کالای ردیف فاکتور ${index + 1} با رسید یکسان نیست.`, 'vendor_invoice_item_mismatch', 409);
    if (line.unit && !convertQuantity(1, line.unit, grnLine.unit, poLine.conversions || []).ok) procurementFail(`واحد ردیف فاکتور ${index + 1} با رسید کالا سازگار نیست.`, 'vendor_invoice_unit_mismatch', 409);
    const normalized = procurementNormalizeQuantity(line.quantity ?? line.invoicedQuantity ?? line.qty, line.unit || grnLine.unit, grnLine.unit, poLine.conversions, 'vendor_invoice_quantity_invalid');
    const prior = procurementPreviouslyInvoiced(acc, grnLine.id, bill.id);
    const received = Number(grnLine.quantityReceived || 0);
    const remaining = received - prior;
    if (normalized.quantity > remaining + PROCUREMENT_EPSILON) procurementFail(`مقدار فاکتور ردیف ${index + 1} از دریافت فاکتورنشده بیشتر است.`, 'vendor_invoice_over_received_quantity', 409, { remainingQuantity: remaining, requestedQuantity: normalized.quantity });
    const unitPrice = line.unitPriceIrr !== undefined || line.unitPrice !== undefined || line.price !== undefined
      ? procurementMoney(line.unitPriceIrr ?? line.unitPrice ?? line.price, { inputUnit: line.priceCurrency || 'irr', allowZero: false, code: 'vendor_invoice_unit_price_invalid' })
      : procurementMoney(grnLine.unitCost, { inputUnit: 'irr', allowZero: false, code: 'vendor_invoice_unit_price_invalid' });
    const lineTotal = procurementLineAmount(normalized.inputQuantity, unitPrice, 'vendor_invoice_line_total_invalid');
    invoiceNet += lineTotal;
    const receiptLineValue = grnLine.totalCost !== undefined
      ? procurementAllocatedAmount(grnLine.totalCost, received, normalized.quantity, 'three_way_receipt_value_invalid')
      : procurementLineAmount(normalized.quantity, procurementStoredRate(grnLine.unitCost, 'goods_receipt_unit_cost_invalid'), 'three_way_receipt_value_invalid');
    receiptValue += receiptLineValue;
    unbilledQuantity += Math.max(0, remaining - normalized.quantity);
    details.push({ invoiceLineId: line.id, grnLineId: grnLine.id, poLineId: poLine.id, invoiceQuantity: normalized.quantity, receivedQuantity: received, unit: grnLine.unit, invoiceUnitPrice: unitPrice, receiptUnitCost: grnLine.unitCost, lineTotal });
  }
  if (invoiceNet !== Number(bill.subtotal)) procurementFail('جمع خالص ردیف‌های فاکتور با مبلغ خالص فاکتور برابر نیست.', 'vendor_invoice_subtotal_mismatch', 409, { calculated: invoiceNet, submitted: bill.subtotal });
  const priceVariance = invoiceNet - receiptValue;
  const status = Math.abs(priceVariance) <= Number(toleranceIrr || 0) ? 'matched' : 'price_variance';
  return {
    id: procurementId('3wm'), billId: bill.id, billNumber: bill.billNumber, poId: po.id, poNumber: po.number,
    grnId: grn.id, grnNumber: grn.number, branchId: procurementRowBranch(po), vendorId: bill.vendorId,
    billTotal: bill.total, invoiceNet, poTotal: po.total, grnTotal: grn.totalValue, receiptValue, priceVariance,
    qtyVariance: 0, unbilledQuantity, status, matchStatus: status === 'matched' ? 'matched' : 'exception',
    reviewStatus: status === 'matched' ? 'not_required' : 'pending', details, matchedAt: procurementNow(),
  };
}

function procurementBillJournalLines(bill, match, opts = {}) {
  const variance = Number(match.priceVariance || 0);
  return [
    ...(match.receiptValue > 0 ? [{ accountCode: opts.grniAccountCode || '2120', debit: match.receiptValue, credit: 0, branchId: bill.branchId, memo: `تسویه GRNI رسید ${match.grnNumber}` }] : []),
    ...(variance > 0 ? [{ accountCode: opts.varianceAccountCode || '5150', debit: variance, credit: 0, branchId: bill.branchId, memo: `اختلاف قیمت خرید فاکتور ${bill.invoiceNumber}` }] : []),
    ...(variance < 0 ? [{ accountCode: opts.varianceAccountCode || '5150', debit: 0, credit: Math.abs(variance), branchId: bill.branchId, memo: `اختلاف قیمت خرید فاکتور ${bill.invoiceNumber}` }] : []),
    ...(bill.vatAmount > 0 ? [{ accountCode: opts.vatAccountCode || '1450', debit: bill.vatAmount, credit: 0, branchId: bill.branchId, memo: `اعتبار مالیاتی فاکتور ${bill.invoiceNumber}` }] : []),
    { accountCode: opts.apAccountCode || '2110', debit: 0, credit: bill.total, branchId: bill.branchId, memo: `حساب پرداختنی فاکتور ${bill.invoiceNumber}` },
  ];
}

function createVendorBill(acc, billInput = {}, opts = {}) {
  ensureProcurement(acc);
  const replay = procurementReplay(acc, billInput, 'create_vendor_bill');
  if (replay) return replay;
  const requestedVendorId = String(billInput.vendorId || billInput.supplierId || '').trim();
  const invoiceNumber = String(billInput.invoiceNumber || billInput.billNumber || '').trim().slice(0, 120);
  if (!invoiceNumber) procurementFail('شماره فاکتور تأمین‌کننده الزامی است.', 'vendor_invoice_number_missing');
  const branch = procurementBranch(billInput.branchId ?? billInput.locationId, 1, 'bill_branch_invalid');
  const vendor = procurementVendor(acc, requestedVendorId, branch);
  const vendorId = vendor?.id || requestedVendorId;
  const duplicate = detectDuplicateBill(acc, { vendorId, invoiceNumber });
  if (duplicate) procurementFail(`فاکتور تکراری کشف شد؛ فاکتور «${duplicate.invoiceNumber || duplicate.billNumber}» قبلاً ثبت شده است.`, 'vendor_invoice_duplicate', 409, { duplicateBillId: duplicate.id });
  return procurementRunIdempotent(acc, billInput, 'create_vendor_bill', () => {
    const billDate = billInput.date || billInput.billDate || procurementNow();
    const dueDate = billInput.dueDate || new Date(new Date(billDate).getTime() + 30 * 86400000).toISOString();
    procurementDate(billDate, 'vendor_bill_date_invalid');
    procurementDate(dueDate, 'vendor_bill_due_date_invalid');
    if (new Date(dueDate) < new Date(billDate)) procurementFail('سررسید فاکتور نمی‌تواند قبل از تاریخ فاکتور باشد.', 'vendor_bill_due_date_before_bill');
    const poId = String(billInput.poId || billInput.purchaseOrderId || '').trim() || null;
    const grnId = String(billInput.grnId || billInput.goodsReceiptId || '').trim() || null;
    if (Boolean(poId) !== Boolean(grnId)) procurementFail('PO و رسید کالا باید هر دو برای فاکتور مشخص شوند.', 'three_way_documents_required', 409);
    // Validate linked-document identity and scope before parsing monetary
    // fields, so a cross-branch/vendor request cannot be misreported as a
    // later total or line-validation error.
    const linkedDocuments = poId
      ? procurementLinkedDocuments(acc, { vendorId, branchId: branch, poId, grnId }, poId, grnId, { seal: false })
      : null;
    const rawLines = procurementList(billInput.lines);
    if ((poId || grnId) && !rawLines.length) procurementFail('فاکتور متصل به رسید باید ردیف داشته باشد.', 'vendor_bill_lines_missing');
    const defaultGrn = grnId ? acc.goodsReceipts.find((row) => String(row.id) === grnId) : null;
    let subtotal = 0;
    const lines = rawLines.map((line, index) => {
      const quantity = procurementQuantity(line.quantity ?? line.invoicedQuantity ?? line.qty, 'vendor_invoice_quantity_invalid');
      const defaultGrnLine = defaultGrn?.lines?.find((row) => String(row.id) === String(line.grnLineId || line.receiptLineId || line.goodsReceiptLineId || ''));
      const unit = procurementUnit(line.unit || defaultGrnLine?.unit || 'کیلوگرم', 'vendor_invoice_unit_invalid');
      const unitPrice = procurementMoney(line.unitPriceIrr ?? line.unitPrice ?? line.price, { inputUnit: line.priceCurrency || 'irr', allowZero: false, code: 'vendor_invoice_unit_price_invalid' });
      const totalPrice = procurementLineAmount(quantity, unitPrice, 'vendor_invoice_line_total_invalid');
      subtotal += totalPrice;
      if (!Number.isSafeInteger(subtotal) || subtotal > PROCUREMENT_MAX_MONEY) procurementFail('جمع خالص فاکتور از محدودهٔ امن خارج است.', 'vendor_invoice_total_unsafe');
      return {
        id: procurementId('billl'), lineNo: index + 1, grnLineId: String(line.grnLineId || line.receiptLineId || line.goodsReceiptLineId || '').trim() || null,
        poLineId: String(line.poLineId || line.purchaseOrderLineId || '').trim() || null, itemId: line.itemId || null,
        quantity, invoicedQuantity: quantity, unit: unit.display, unitCode: unit.code, unitPrice, unitPriceIrr: unitPrice, totalPrice,
      };
    });
    const totalInput = billInput.total ?? billInput.totalAmount ?? billInput.amount;
    let total;
    let vatAmount;
    if (totalInput === undefined || totalInput === null || totalInput === '') {
      vatAmount = billInput.isExempt ? 0 : procurementMoney(billInput.vatAmount ?? billInput.taxAmount ?? 0, { inputUnit: billInput.vatCurrency || 'irr', code: 'vendor_bill_vat_invalid' });
      total = subtotal + vatAmount;
    } else {
      total = procurementMoney(totalInput, { inputUnit: billInput.currency || billInput.amountUnit || 'irr', allowZero: false, code: 'vendor_bill_total_invalid' });
      vatAmount = billInput.isExempt ? 0 : billInput.vatAmount !== undefined || billInput.taxAmount !== undefined
        ? procurementMoney(billInput.vatAmount ?? billInput.taxAmount, { inputUnit: billInput.vatCurrency || 'irr', code: 'vendor_bill_vat_invalid' })
        : (rawLines.length ? total - subtotal : Math.round((total / 1.10) * 0.10));
    }
    if (!Number.isSafeInteger(vatAmount) || vatAmount < 0 || vatAmount > total) procurementFail('مبلغ مالیات فاکتور معتبر نیست.', 'vendor_bill_vat_invalid');
    const totalMismatch = rawLines.length && subtotal + vatAmount !== total;
    const bill = {
      id: procurementId('bill'), billNumber: procurementNextNumber(acc.vendorBills, 'BILL'), invoiceNumber, vendorId,
      vendorName: vendor?.name || vendorId, poId, grnId, branchId: branch, date: billDate, dueDate, subtotal, vatAmount, total,
      paidAmount: 0, paymentStatus: 'unpaid', status: poId ? 'match_exception' : 'unmatched', matchStatus: poId ? 'pending' : 'unmatched',
      journalEntryId: null, journalNumber: null, lines, createdById: billInput.createdById || 'admin', createdAt: procurementNow(), reversalId: null,
    };
    let match = null;
    let journalEntry = null;
    if (poId) {
      const linked = procurementLinkedDocuments(acc, bill, poId, grnId);
      match = procurementBuildMatch(acc, bill, linked.po, linked.grn, { toleranceIrr: billInput.matchToleranceIrr ?? opts.matchToleranceIrr ?? 0 });
      // Run line-level three-way controls first. This keeps an over-receipt or
      // unit drift actionable even when the submitted invoice total is also
      // inconsistent; no document is persisted before this point.
      if (totalMismatch) procurementFail('جمع ردیف‌ها، مالیات و مبلغ کل فاکتور با هم سازگار نیستند.', 'vendor_bill_total_mismatch', 409, { subtotal, vatAmount, total });
      if (match.status === 'matched') {
        const journalLines = procurementBillJournalLines(bill, match, opts);
        if (opts.postJournalFn) {
          journalEntry = opts.postJournalFn({ source: 'vendor_bill', sourceId: bill.id, date: billDate, description: `ثبت فاکتور خرید تأمین‌کننده ${invoiceNumber}`, lines: journalLines, createdById: bill.createdById });
          bill.journalEntryId = journalEntry?.id || null;
          bill.journalNumber = journalEntry?.number || null;
        }
        bill.journalLines = journalLines;
        bill.status = 'open';
        bill.matchStatus = 'matched';
      } else {
        bill.status = 'match_exception';
        bill.matchStatus = 'price_variance';
      }
    } else if (totalMismatch) {
      procurementFail('جمع ردیف‌ها، مالیات و مبلغ کل فاکتور با هم سازگار نیستند.', 'vendor_bill_total_mismatch', 409, { subtotal, vatAmount, total });
    }
    procurementSeal(bill, 'vendorBill');
    acc.vendorBills.push(bill);
    if (match) acc.threeWayMatches.push(match);
    if (bill.status === 'open') {
      const storedVendor = acc.vendors.find((row) => String(row.id) === vendorId);
      if (storedVendor && Number.isFinite(Number(storedVendor.balance))) storedVendor.balance = Number(storedVendor.balance) + total;
    }
    procurementAudit(acc, 'CREATE_VENDOR_BILL', 'VendorBill', bill.id, bill.createdById, `فاکتور خرید ${bill.billNumber} به مبلغ ${formatNumber(total)} ریال ثبت گردید.`, { matchStatus: bill.matchStatus });
    return { ok: true, bill, match, threeWayMatch: match, journalEntry };
  });
}

function performThreeWayMatch(acc, input = {}, opts = {}) {
  ensureProcurement(acc);
  const replay = procurementReplay(acc, input, 'perform_three_way_match');
  if (replay) return replay;
  const bill = acc.vendorBills.find((row) => String(row.id) === String(input.billId || input.vendorBillId || ''));
  if (!bill) return { ok: false, error: 'فاکتور تأمین‌کننده یافت نشد.', code: 'vendor_bill_not_found' };
  if (bill.status === 'match_rejected' || bill.status === 'reversed') procurementFail('فاکتور ردشده یا معکوس‌شده قابل تطبیق مجدد نیست؛ فاکتور اصلاحی جدید ثبت کنید.', 'vendor_bill_not_retryable', 409);
  if (input.branchId != null) procurementAssertBranch(procurementRowBranch(bill), procurementBranch(input.branchId, null, 'match_branch_invalid'), 'three_way_branch_mismatch');
  return procurementRunIdempotent(acc, input, 'perform_three_way_match', () => {
    procurementAssertSealed(bill, 'vendorBill');
    const linked = procurementLinkedDocuments(acc, bill, input.poId, input.grnId);
    const linksBound = !bill.poId || !bill.grnId;
    if (!bill.poId) bill.poId = linked.po.id;
    if (!bill.grnId) bill.grnId = linked.grn.id;
    const existing = acc.threeWayMatches.find((row) => row.billId === bill.id && row.poId === linked.po.id && row.grnId === linked.grn.id && row.status === 'matched');
    if (existing) {
      if (linksBound) procurementReseal(bill, 'vendorBill');
      return { ok: true, match: existing, threeWayMatch: existing, bill, idempotentReplay: true };
    }
    const match = procurementBuildMatch(acc, bill, linked.po, linked.grn, { toleranceIrr: input.matchToleranceIrr ?? opts.matchToleranceIrr ?? 0 });
    const old = acc.threeWayMatches.find((row) => row.billId === bill.id && row.status !== 'reversed');
    if (old) Object.assign(old, match);
    else acc.threeWayMatches.push(match);
    bill.matchStatus = match.status === 'matched' ? 'matched' : 'price_variance';
    let journalEntry = null;
    if (match.status === 'matched') {
      bill.status = 'open';
      const journalLines = procurementBillJournalLines(bill, match, opts);
      if (!bill.journalEntryId && opts.postJournalFn) {
        journalEntry = opts.postJournalFn({ source: 'vendor_bill', sourceId: bill.id, date: bill.date, description: `ثبت فاکتور خرید تأمین‌کننده ${bill.invoiceNumber}`, lines: journalLines, createdById: bill.createdById || 'admin' });
        bill.journalEntryId = journalEntry?.id || null;
        bill.journalNumber = journalEntry?.number || null;
        bill.journalLines = journalLines;
      }
    } else bill.status = 'match_exception';
    if (linksBound) procurementReseal(bill, 'vendorBill');
    procurementAudit(acc, 'THREE_WAY_MATCH', 'ThreeWayMatch', match.id, input.createdById || 'admin', `تطبیق سه‌طرفه فاکتور ${bill.invoiceNumber}: ${match.status}.`);
    return { ok: true, match, threeWayMatch: match, bill, journalEntry };
  });
}

function resolveVendorBillVariance(acc, billId, decision, input = {}, opts = {}) {
  ensureProcurement(acc);
  const replay = procurementReplay(acc, { ...input, billId, decision }, 'resolve_vendor_bill_variance');
  if (replay) return replay;
  const bill = acc.vendorBills.find((row) => String(row.id) === String(billId));
  if (!bill) procurementFail('فاکتور تأمین‌کننده یافت نشد.', 'vendor_bill_not_found', 404);
  const match = acc.threeWayMatches.find((row) => String(row.billId) === String(bill.id));
  if (!match || match.status === 'matched') procurementFail('برای این فاکتور اختلاف قابل بررسی وجود ندارد.', 'three_way_variance_not_found', 409);
  if (['rejected', 'reversed'].includes(String(match.status)) || bill.status === 'match_rejected' || bill.status === 'reversed') procurementFail('اختلاف ردشده یا معکوس‌شده قابل بازگشایی نیست؛ فاکتور اصلاحی جدید ثبت کنید.', 'three_way_variance_not_retryable', 409);
  const reason = String(input.reason || input.comment || '').trim().slice(0, 300);
  if (reason.length < 3) procurementFail('علت تصمیم اختلاف الزامی است.', 'three_way_decision_reason_required');
  const normalizedDecision = procurementText(decision || input.decision);
  if (!['approved', 'accepted', 'rejected'].includes(normalizedDecision)) procurementFail('تصمیم اختلاف باید approved یا rejected باشد.', 'three_way_decision_invalid');
  return procurementRunIdempotent(acc, { ...input, billId, decision: normalizedDecision }, 'resolve_vendor_bill_variance', () => {
    procurementAssertSealed(bill, 'vendorBill');
    const actor = input.actor || input.createdById || 'admin';
    match.reviewStatus = normalizedDecision === 'rejected' ? 'rejected' : 'approved';
    match.decidedBy = actor; match.decidedAt = procurementNow(); match.decisionComment = reason;
    if (normalizedDecision === 'rejected') {
      bill.status = 'match_rejected'; bill.matchStatus = 'rejected'; match.status = 'rejected';
      procurementAudit(acc, 'REJECT_VENDOR_BILL_VARIANCE', 'VendorBill', bill.id, actor, `اختلاف فاکتور ${bill.invoiceNumber} رد شد: ${reason}`);
      return { ok: true, bill, match, threeWayMatch: match, journalEntry: null };
    }
    const journalLines = procurementBillJournalLines(bill, match, opts);
    let journalEntry = null;
    if (opts.postJournalFn && !bill.journalEntryId) {
      journalEntry = opts.postJournalFn({ source: 'vendor_bill', sourceId: bill.id, date: bill.date, description: `ثبت فاکتور با اختلاف پذیرفته‌شده ${bill.invoiceNumber}`, lines: journalLines, createdById: actor });
      bill.journalEntryId = journalEntry?.id || null; bill.journalNumber = journalEntry?.number || null; bill.journalLines = journalLines;
    }
    bill.status = 'open'; bill.matchStatus = 'accepted_variance'; match.status = 'accepted_variance';
    const vendor = acc.vendors.find((row) => String(row.id) === String(bill.vendorId));
    if (vendor && Number.isFinite(Number(vendor.balance))) vendor.balance = Number(vendor.balance) + bill.total;
    procurementAudit(acc, 'ACCEPT_VENDOR_BILL_VARIANCE', 'VendorBill', bill.id, actor, `اختلاف فاکتور ${bill.invoiceNumber} پذیرفته شد: ${reason}`);
    return { ok: true, bill, match, threeWayMatch: match, journalEntry };
  });
}

function procurementBillPaymentStatus(bill) {
  const paid = Number(bill.paidAmount || 0);
  if (paid >= Number(bill.total || 0) - PROCUREMENT_EPSILON) return 'paid';
  return paid > 0 ? 'partially_paid' : 'open';
}

function payVendorBill(acc, billId, paymentInput = {}, opts = {}) {
  ensureProcurement(acc);
  const replay = procurementReplay(acc, { ...paymentInput, billId }, 'pay_vendor_bill');
  if (replay) return replay;
  const bill = acc.vendorBills.find((row) => String(row.id) === String(billId));
  if (!bill) procurementFail('فاکتور خرید یافت نشد.', 'vendor_bill_not_found', 404);
  if (!['open', 'partially_paid', 'unpaid', 'partial'].includes(String(bill.status))) procurementFail('فاکتور در وضعیت قابل پرداخت نیست؛ ابتدا تطبیق سه‌طرفه یا بررسی اختلاف را تکمیل کنید.', bill.status === 'match_exception' ? 'three_way_match_required' : 'vendor_bill_not_payable', 409);
  if ((bill.poId || bill.grnId) && !['matched', 'accepted_variance'].includes(String(bill.matchStatus))) procurementFail('فاکتور متصل به PO/GRN قبل از پرداخت باید تطبیق یا تأیید اختلاف شود.', 'three_way_match_required', 409);
  const branch = procurementBranch(paymentInput.branchId ?? opts.branchId, procurementRowBranch(bill), 'payment_branch_invalid');
  procurementAssertBranch(procurementRowBranch(bill), branch, 'payment_branch_mismatch');
  return procurementRunIdempotent(acc, { ...paymentInput, billId }, 'pay_vendor_bill', () => {
    procurementAssertSealed(bill, 'vendorBill');
    const remaining = Number(bill.total || 0) - Number(bill.paidAmount || 0);
    const amount = procurementMoney(paymentInput.amount ?? paymentInput.amountIrr ?? remaining, { inputUnit: paymentInput.currency || paymentInput.amountUnit || 'irr', allowZero: false, code: 'payment_amount_invalid' });
    if (amount > remaining) procurementFail('مبلغ پرداختی از مانده بدهی بیشتر است.', 'payment_exceeds_balance', 409, { amount, remaining });
    const method = String(paymentInput.paymentMethod || 'BANK').toUpperCase();
    if (!PROCUREMENT_PAYMENT_METHODS.has(method)) procurementFail('روش پرداخت پشتیبانی نمی‌شود.', 'payment_method_invalid');
    const payDate = paymentInput.date || paymentInput.paymentDate || procurementNow();
    procurementDate(payDate, 'payment_date_invalid');
    const creditAccount = method === 'CASH' ? '1110' : method === 'PETTY_CASH' ? '1120' : '1210';
    const paymentId = procurementId('vpay');
    const journalLines = [
      { accountCode: opts.apAccountCode || '2110', debit: amount, credit: 0, branchId: branch, memo: `تسویه بدهی فاکتور ${bill.billNumber}` },
      { accountCode: creditAccount, debit: 0, credit: amount, branchId: branch, memo: `پرداخت فاکتور ${bill.billNumber} از طریق ${method}` },
    ];
    let journalEntry = null;
    if (opts.postJournalFn) journalEntry = opts.postJournalFn({ source: 'bill_payment', sourceId: paymentId, date: payDate, description: `پرداخت فاکتور تأمین‌کننده ${bill.vendorName}`, lines: journalLines, createdById: paymentInput.createdById || 'admin' });
    const payment = {
      id: paymentId, billId: bill.id, billNumber: bill.billNumber, vendorId: bill.vendorId, branchId: branch, amount, paymentAmount: amount,
      paymentMethod: method, date: payDate, reference: String(paymentInput.reference || '').trim().slice(0, 120) || null, status: 'posted',
      journalEntryId: journalEntry?.id || null, journalNumber: journalEntry?.number || null, journalLines, createdById: paymentInput.createdById || 'admin', createdAt: procurementNow(), reversalId: null,
    };
    procurementSeal(payment, 'vendorPayment');
    acc.vendorPayments.push(payment);
    if (acc.vendorBillPayments !== acc.vendorPayments) acc.vendorBillPayments.push(payment);
    bill.paidAmount = Number(bill.paidAmount || 0) + amount;
    bill.status = procurementBillPaymentStatus(bill);
    bill.paymentStatus = bill.status === 'paid' ? 'paid' : 'partial';
    const vendor = acc.vendors.find((row) => String(row.id) === String(bill.vendorId));
    if (vendor && Number.isFinite(Number(vendor.balance))) vendor.balance = Number(vendor.balance) - amount;
    procurementAudit(acc, 'PAY_VENDOR_BILL', 'VendorBillPayment', payment.id, payment.createdById, `پرداخت مبلغ ${formatNumber(amount)} ریال بابت فاکتور ${bill.billNumber} ثبت شد.`);
    return { ok: true, bill, payment, paymentAmount: amount, journalEntry };
  });
}

function procurementReverseJournal(document, sourceType, actor, reason, opts = {}) {
  const lines = procurementList(document.journalLines);
  if (!lines.length) return null;
  const inverted = lines.map((line) => ({ ...line, debit: line.credit, credit: line.debit, memo: `[برگشت ${document.id}] ${line.memo || ''}`.slice(0, 300) }));
  if (opts.reverseJournalFn) return opts.reverseJournalFn(document.journalEntryId, { source: `${sourceType}_reversal`, sourceId: document.id, date: opts.reversalDate || procurementNow(), reason, createdById: actor, lines: inverted });
  if (opts.postJournalFn) return opts.postJournalFn({ source: `${sourceType}_reversal`, sourceId: document.id, date: opts.reversalDate || procurementNow(), description: `سند معکوس ${document.id}: ${reason}`, lines: inverted, createdById: actor });
  return null;
}

function reverseVendorBillPayment(acc, paymentId, input = {}, opts = {}) {
  ensureProcurement(acc);
  const replay = procurementReplay(acc, { ...input, paymentId }, 'reverse_vendor_bill_payment');
  if (replay) return replay;
  const payment = acc.vendorPayments.find((row) => String(row.id) === String(paymentId));
  if (!payment) procurementFail('پرداخت تأمین‌کننده یافت نشد.', 'vendor_payment_not_found', 404);
  if (payment.status === 'reversed') procurementFail('این پرداخت قبلاً معکوس شده است.', 'vendor_payment_already_reversed', 409);
  if (payment.status !== 'posted') procurementFail('فقط پرداخت ثبت‌شده قابل معکوس‌سازی است.', 'vendor_payment_not_reversible', 409);
  const bill = acc.vendorBills.find((row) => String(row.id) === String(payment.billId));
  if (!bill) procurementFail('فاکتور پرداخت‌شده یافت نشد.', 'vendor_bill_not_found', 404);
  if (bill.status === 'reversed') procurementFail('پرداخت فاکتور معکوس‌شده قابل برگشت نیست.', 'vendor_bill_not_reversible', 409);
  if (input.branchId != null) procurementAssertBranch(procurementRowBranch(payment), procurementBranch(input.branchId, null, 'reversal_branch_invalid'), 'reversal_branch_mismatch');
  const reason = String(input.reason || '').trim();
  if (reason.length < 3) procurementFail('علت معکوس‌سازی پرداخت الزامی است.', 'reversal_reason_required');
  return procurementRunIdempotent(acc, { ...input, paymentId }, 'reverse_vendor_bill_payment', () => {
    procurementAssertSealed(payment, 'vendorPayment');
    procurementAssertSealed(bill, 'vendorBill');
    const actor = input.actor || input.createdById || 'admin';
    const journalEntry = procurementReverseJournal(payment, 'bill_payment', actor, reason, opts);
    const reversal = { id: procurementId('rev'), type: 'vendor_payment', originalId: payment.id, billId: bill.id, amount: payment.amount, branchId: payment.branchId, reason, createdById: actor, createdAt: procurementNow(), journalEntryId: journalEntry?.id || null };
    acc.procurementReversals.push(reversal);
    payment.status = 'reversed'; payment.reversalId = reversal.id; payment.reversedAt = procurementNow(); payment.reversedBy = actor;
    bill.paidAmount = Math.max(0, Number(bill.paidAmount || 0) - Number(payment.amount || 0));
    bill.status = procurementBillPaymentStatus(bill); bill.paymentStatus = bill.status === 'paid' ? 'paid' : bill.paidAmount > 0 ? 'partial' : 'unpaid';
    const vendor = acc.vendors.find((row) => String(row.id) === String(bill.vendorId));
    if (vendor && Number.isFinite(Number(vendor.balance))) vendor.balance = Number(vendor.balance) + Number(payment.amount || 0);
    procurementAudit(acc, 'REVERSE_VENDOR_BILL_PAYMENT', 'VendorBillPayment', payment.id, actor, `پرداخت فاکتور ${bill.billNumber} معکوس شد: ${reason}`);
    return { ok: true, payment, bill, reversal, journalEntry };
  });
}

function reverseVendorBill(acc, billId, input = {}, opts = {}) {
  ensureProcurement(acc);
  const replay = procurementReplay(acc, { ...input, billId }, 'reverse_vendor_bill');
  if (replay) return replay;
  const bill = acc.vendorBills.find((row) => String(row.id) === String(billId));
  if (!bill) procurementFail('فاکتور تأمین‌کننده یافت نشد.', 'vendor_bill_not_found', 404);
  if (bill.status === 'reversed') procurementFail('این فاکتور قبلاً معکوس شده است.', 'vendor_bill_already_reversed', 409);
  if (Number(bill.paidAmount || 0) > 0 || acc.vendorPayments.some((row) => String(row.billId) === String(bill.id) && row.status !== 'reversed')) procurementFail('ابتدا پرداخت‌های فاکتور را معکوس کنید.', 'vendor_bill_has_payment_activity', 409);
  const reason = String(input.reason || '').trim();
  if (reason.length < 3) procurementFail('علت معکوس‌سازی فاکتور الزامی است.', 'reversal_reason_required');
  const branch = procurementBranch(input.branchId, procurementRowBranch(bill), 'reversal_branch_invalid');
  procurementAssertBranch(procurementRowBranch(bill), branch, 'reversal_branch_mismatch');
  return procurementRunIdempotent(acc, { ...input, billId }, 'reverse_vendor_bill', () => {
    procurementAssertSealed(bill, 'vendorBill');
    const actor = input.actor || input.createdById || 'admin';
    const apWasPosted = Boolean(bill.journalEntryId) || ['matched', 'accepted_variance'].includes(String(bill.matchStatus));
    const journalEntry = procurementReverseJournal(bill, 'vendor_bill', actor, reason, opts);
    const reversal = { id: procurementId('rev'), type: 'vendor_bill', originalId: bill.id, branchId: branch, amount: bill.total, reason, createdById: actor, createdAt: procurementNow(), journalEntryId: journalEntry?.id || null };
    acc.procurementReversals.push(reversal);
    bill.status = 'reversed'; bill.matchStatus = 'reversed'; bill.reversalId = reversal.id; bill.reversedAt = procurementNow(); bill.reversedBy = actor;
    const match = acc.threeWayMatches.find((row) => String(row.billId) === String(bill.id));
    if (match) { match.status = 'reversed'; match.reviewStatus = 'reversed'; match.reversalId = reversal.id; }
    const vendor = acc.vendors.find((row) => String(row.id) === String(bill.vendorId));
    if (vendor && apWasPosted && Number.isFinite(Number(vendor.balance))) vendor.balance = Number(vendor.balance) - Number(bill.total || 0);
    procurementAudit(acc, 'REVERSE_VENDOR_BILL', 'VendorBill', bill.id, actor, `فاکتور ${bill.invoiceNumber} معکوس شد: ${reason}`);
    return { ok: true, bill, reversal, journalEntry };
  });
}

function reverseGoodsReceipt(acc, grnId, input = {}, opts = {}) {
  ensureProcurement(acc);
  const replay = procurementReplay(acc, { ...input, grnId }, 'reverse_goods_receipt');
  if (replay) return replay;
  const grn = acc.goodsReceipts.find((row) => String(row.id) === String(grnId));
  if (!grn) procurementFail('رسید کالا یافت نشد.', 'goods_receipt_not_found', 404);
  if (grn.status === 'reversed') procurementFail('این رسید قبلاً معکوس شده است.', 'goods_receipt_already_reversed', 409);
  if (grn.status !== 'completed') procurementFail('فقط رسید تکمیل‌شده قابل معکوس‌سازی است.', 'goods_receipt_not_reversible', 409);
  if (acc.vendorBills.some((bill) => String(bill.grnId) === String(grn.id) && !PROCUREMENT_REJECTED_BILL_STATUSES.has(String(bill.status)))) procurementFail('رسید دارای فعالیت فاکتور است؛ ابتدا فاکتور و پرداخت‌های مرتبط را معکوس کنید.', 'goods_receipt_has_invoice_activity', 409);
  const po = acc.purchaseOrders.find((row) => String(row.id) === String(grn.poId || grn.purchaseOrderId));
  if (!po) procurementFail('سفارش خرید رسید یافت نشد.', 'purchase_order_not_found', 404);
  const reason = String(input.reason || '').trim();
  if (reason.length < 3) procurementFail('علت معکوس‌سازی رسید الزامی است.', 'reversal_reason_required');
  const branch = procurementBranch(input.branchId, procurementRowBranch(grn), 'reversal_branch_invalid');
  procurementAssertBranch(procurementRowBranch(grn), branch, 'reversal_branch_mismatch');
  return procurementRunIdempotent(acc, { ...input, grnId }, 'reverse_goods_receipt', () => {
    procurementAssertSealed(grn, 'goodsReceipt');
    procurementAssertSealed(po, 'purchaseOrder');
    const actor = input.actor || input.createdById || 'admin';
    const journalEntry = procurementReverseJournal(grn, 'goods_receipt', actor, reason, opts);
    const reversal = { id: procurementId('rev'), type: 'goods_receipt', originalId: grn.id, poId: po.id, branchId: branch, amount: grn.totalValue, reason, createdById: actor, createdAt: procurementNow(), journalEntryId: journalEntry?.id || null };
    acc.procurementReversals.push(reversal);
    grn.status = 'reversed'; grn.reversalId = reversal.id; grn.reversedAt = procurementNow(); grn.reversedBy = actor;
    for (const line of grn.lines) {
      const poLine = po.lines.find((row) => String(row.id) === String(line.poLineId));
      if (poLine) poLine.receivedQuantity = Math.max(0, Number(poLine.receivedQuantity || 0) - Number(line.quantityReceived || 0));
    }
    po.status = po.lines.some((line) => Number(line.receivedQuantity || 0) > 0) ? 'partially_received' : 'approved';
    procurementAudit(acc, 'REVERSE_GOODS_RECEIPT', 'GoodsReceipt', grn.id, actor, `رسید ${grn.number} معکوس شد: ${reason}`);
    return { ok: true, grn, po, reversal, journalEntry };
  });
}

module.exports = {
  ensureProcurement,
  detectDuplicateBill,
  createPurchaseOrder,
  approvePurchaseOrder,
  receiveGoods,
  createVendorBill,
  performThreeWayMatch,
  resolveVendorBillVariance,
  payVendorBill,
  reverseVendorBillPayment,
  reverseVendorBill,
  reverseGoodsReceipt,
};
