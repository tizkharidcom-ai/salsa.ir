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

const { toIRR } = require('./money');
const auditEngine = require('./audit-engine');

function ensureProcurement(acc) {
  if (!Array.isArray(acc.purchaseOrders)) acc.purchaseOrders = [];
  if (!Array.isArray(acc.goodsReceipts)) acc.goodsReceipts = [];
  if (!Array.isArray(acc.threeWayMatches)) acc.threeWayMatches = [];
  if (!Array.isArray(acc.vendorBills)) acc.vendorBills = [];
  if (!Array.isArray(acc.vendors)) acc.vendors = [];
  return acc;
}

/**
 * Checks for likely duplicate supplier invoices.
 */
function detectDuplicateBill(acc, { vendorId, invoiceNumber, date, totalAmount, excludeId }) {
  ensureProcurement(acc);
  const normalizedInvNo = String(invoiceNumber || '').trim().toLowerCase();
  const targetDate = date ? String(date).slice(0, 10) : null;
  const targetAmount = toIRR(totalAmount);

  return acc.vendorBills.find((b) => {
    if (excludeId && b.id === excludeId) return false;
    if (String(b.vendorId) !== String(vendorId)) return false;

    // Match 1: exact invoice number for the same vendor
    if (normalizedInvNo && b.invoiceNumber && String(b.invoiceNumber).trim().toLowerCase() === normalizedInvNo) {
      return true;
    }
    // Match 2: same vendor, same date, same amount
    if (targetDate && b.date && String(b.date).slice(0, 10) === targetDate && toIRR(b.total) === targetAmount) {
      return true;
    }
    return false;
  });
}

/**
 * Creates a Purchase Order (PO).
 */
function createPurchaseOrder(acc, { vendorId, locationId, issueDate, expectedDate, notes, lines = [], createdById }) {
  ensureProcurement(acc);
  const year = new Date().getFullYear();
  const count = acc.purchaseOrders.length + 1;
  const number = `PO-${year}-${String(count).padStart(5, '0')}`;
  const id = `po-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  let subtotal = 0;
  const sanitizedLines = lines.map((l, i) => {
    const qty = Number(l.quantity || l.qty || 1);
    const unitPrice = toIRR(l.unitPrice || l.price || 0);
    const lineTotal = qty * unitPrice;
    subtotal += lineTotal;
    return {
      id: `pol-${i + 1}`,
      itemId: l.itemId || l.ingredientId || null,
      description: String(l.description || l.name || 'کالای سفارشی').slice(0, 150),
      quantity: qty,
      receivedQuantity: 0,
      unit: String(l.unit || 'کیلوگرم').slice(0, 20),
      unitPrice,
      totalPrice: lineTotal,
      taxCategory: l.taxCategory || 'standard_1405',
    };
  });

  const taxAmount = Math.round(subtotal * 0.10);
  const total = subtotal + taxAmount;

  const po = {
    id,
    number,
    vendorId: String(vendorId),
    locationId: locationId ? Number(locationId) : 1,
    status: 'draft', // draft, approved, partially_received, received, closed
    issueDate: issueDate || new Date().toISOString(),
    expectedDate: expectedDate || null,
    subtotal,
    taxAmount,
    total,
    notes: String(notes || '').slice(0, 250),
    createdById: createdById || 'admin',
    lines: sanitizedLines,
    createdAt: new Date().toISOString(),
  };

  acc.purchaseOrders.push(po);

  auditEngine.recordAuditLog(acc, {
    action: 'CREATE_PURCHASE_ORDER',
    entityType: 'PurchaseOrder',
    entityId: po.id,
    userId: createdById || 'admin',
    message: `سفارش خرید شماره ${po.number} به مبلغ کل ${total.toLocaleString('fa-IR')} ریال ثبت شد.`,
  });

  return { ok: true, po };
}

/**
 * Approves a Purchase Order.
 */
function approvePurchaseOrder(acc, poId, userId) {
  ensureProcurement(acc);
  const po = acc.purchaseOrders.find((p) => p.id === poId);
  if (!po) return { ok: false, error: 'سفارش خرید یافت نشد.' };
  if (po.status !== 'draft') return { ok: false, error: `وضعیت فعلی: ${po.status} — فقط پیش‌نویس قابل تایید است.` };
  po.status = 'approved';
  po.approvedAt = new Date().toISOString();
  po.approvedBy = userId || 'admin';
  return { ok: true, po };
}

/**
 * Records a Goods Receipt Note (GRN) when items arrive at the warehouse.
 */
function receiveGoods(acc, { poId, vendorId, deliveryNoteNumber, receivedDate, lines = [], notes, createdById, branchId }) {
  ensureProcurement(acc);
  const po = poId ? acc.purchaseOrders.find((p) => p.id === poId) : null;
  const year = new Date().getFullYear();
  const count = acc.goodsReceipts.length + 1;
  const number = `GRN-${year}-${String(count).padStart(5, '0')}`;
  const id = `grn-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  let totalValue = 0;
  const sanitizedLines = lines.map((l, i) => {
    const qtyReceived = Number(l.quantityReceived || l.qty || 0);
    const unitCost = toIRR(l.unitCost || l.unitPrice || 0);
    const totalCost = qtyReceived * unitCost;
    totalValue += totalCost;

    // Update PO line received quantity if attached
    if (po && l.poLineId) {
      const poLine = po.lines.find((pl) => pl.id === l.poLineId);
      if (poLine) poLine.receivedQuantity = (poLine.receivedQuantity || 0) + qtyReceived;
    }

    return {
      id: `grnl-${i + 1}`,
      poLineId: l.poLineId || null,
      itemId: l.itemId || l.ingredientId || null,
      description: String(l.description || l.name || 'کالای دریافتی').slice(0, 150),
      quantityReceived: qtyReceived,
      unit: String(l.unit || 'کیلوگرم').slice(0, 20),
      unitCost,
      totalCost,
    };
  });

  if (po) {
    const allReceived = po.lines.every((pl) => pl.receivedQuantity >= pl.quantity);
    po.status = allReceived ? 'received' : 'partially_received';
  }

  const grn = {
    id,
    number,
    poId: po ? po.id : null,
    poNumber: po ? po.number : null,
    vendorId: String(vendorId || (po ? po.vendorId : '')),
    deliveryNoteNumber: String(deliveryNoteNumber || '').slice(0, 100),
    receivedDate: receivedDate || new Date().toISOString(),
    totalValue,
    notes: String(notes || '').slice(0, 250),
    lines: sanitizedLines,
    status: 'completed',
    createdById: createdById || 'admin',
    branchId: branchId || (po ? po.locationId : 1),
    createdAt: new Date().toISOString(),
  };

  acc.goodsReceipts.push(grn);

  auditEngine.recordAuditLog(acc, {
    action: 'RECEIVE_GOODS',
    entityType: 'GoodsReceipt',
    entityId: grn.id,
    userId: createdById || 'admin',
    message: `رسید ورود کالا ${grn.number} به ارزش ${totalValue.toLocaleString('fa-IR')} ریال ثبت گردید.`,
  });

  return { ok: true, grn };
}

/**
 * Creates a Supplier Bill (فاکتور خرید تأمین‌کننده) with Input VAT separation and GL posting.
 */
function createVendorBill(acc, billInput, opts = {}) {
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
    message: `فاکتور خرید ${bill.billNumber} به مبلغ ${totalAmount.toLocaleString('fa-IR')} ریال ثبت گردید.`,
  });

  return { ok: true, bill, journalEntry };
}

/**
 * Performs Three-Way Match across PO, GRN, and Vendor Bill.
 */
function performThreeWayMatch(acc, { billId, poId, grnId }) {
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
function payVendorBill(acc, billId, paymentInput, opts = {}) {
  ensureProcurement(acc);
  const { postJournalFn } = opts;

  const bill = acc.vendorBills.find((b) => b.id === billId);
  if (!bill) throw new Error('فاکتور خرید یافت نشد.');

  const amountToPay = toIRR(paymentInput.amount || (bill.total - (bill.paidAmount || 0)));
  const remaining = bill.total - (bill.paidAmount || 0);

  if (amountToPay <= 0 || amountToPay > remaining) {
    throw new Error(`مبلغ پرداختی (${amountToPay.toLocaleString('fa-IR')}) نامعتبر است یا از مانده بدهی (${remaining.toLocaleString('fa-IR')}) بیشتر است.`);
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
    message: `پرداخت مبلغ ${amountToPay.toLocaleString('fa-IR')} ریال بابت فاکتور ${bill.billNumber} ثبت شد. وضعیت فاکتور: ${bill.status}`,
  });

  return { ok: true, bill, paymentAmount: amountToPay, journalEntry };
}

module.exports = {
  ensureProcurement,
  detectDuplicateBill,
  createPurchaseOrder,
  approvePurchaseOrder,
  receiveGoods,
  createVendorBill,
  performThreeWayMatch,
  payVendorBill,
};
