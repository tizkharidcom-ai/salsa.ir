'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const procurement = require('../server/finance/procurement-engine');

function fixture() {
  return {
    vendors: [{ id: 'vendor-1', name: 'تأمین‌کننده تست', nameFa: 'تأمین‌کننده تست', balance: 0 }],
    inventoryItems: [
      { id: 'milk', name: 'شیر', unit: 'لیتر', branchId: 1, conversions: [] },
      { id: 'coffee', name: 'قهوه', unit: 'کیلوگرم', branchId: 1, conversions: [] },
    ],
    purchaseOrders: [], goodsReceipts: [], threeWayMatches: [], vendorBills: [], vendorPayments: [], journalEntries: [], auditLogs: [],
  };
}

function postJournal(acc) {
  return (input) => {
    const debit = input.lines.reduce((sum, line) => sum + Number(line.debit || 0), 0);
    const credit = input.lines.reduce((sum, line) => sum + Number(line.credit || 0), 0);
    assert.equal(debit, credit, `سند ${input.source} باید تراز باشد`);
    const entry = {
      id: `je-${acc.journalEntries.length + 1}`,
      number: `JE-${String(acc.journalEntries.length + 1).padStart(4, '0')}`,
      source: input.source,
      sourceId: input.sourceId,
      date: input.date,
      lines: input.lines,
      totalAmount: debit,
    };
    acc.journalEntries.push(entry);
    return entry;
  };
}

function createApprovedPo(acc, overrides = {}) {
  const result = procurement.createPurchaseOrder(acc, {
    vendorId: 'vendor-1', branchId: 1,
    lines: [{ itemId: 'milk', quantity: 10, unit: 'لیتر', unitPriceIrr: 100000 }],
    createdById: 'buyer-1', ...overrides,
  });
  procurement.approvePurchaseOrder(acc, result.po.id, 'manager-1');
  return result.po;
}

function receiveFull(acc, po, options = {}) {
  return procurement.receiveGoods(acc, {
    poId: po.id, branchId: 1, deliveryNoteNumber: options.deliveryNoteNumber || `DN-${acc.goodsReceipts.length + 1}`,
    lines: [{ poLineId: po.lines[0].id, quantityReceived: 10, unit: 'لیتر' }], createdById: 'warehouse-1', ...options,
  }, { postJournalFn: options.postJournalFn || postJournal(acc) });
}

function createMatchedBill(acc, po, grn, options = {}) {
  const total = options.total ?? 1100000;
  const vatAmount = options.vatAmount ?? 100000;
  return procurement.createVendorBill(acc, {
    vendorId: 'vendor-1', branchId: 1, poId: po.id, grnId: grn.id,
    invoiceNumber: options.invoiceNumber || `INV-${acc.vendorBills.length + 1}`,
    total, vatAmount,
    lines: [{ grnLineId: grn.lines[0].id, poLineId: po.lines[0].id, quantity: options.quantity || 10, unit: options.unit || 'لیتر', unitPriceIrr: options.unitPriceIrr ?? 100000 }],
    createdById: 'accountant-1', ...options,
  }, { postJournalFn: options.postJournalFn || postJournal(acc) });
}

test('PO quantity, branch and unit controls reject unsafe input before mutation', () => {
  const acc = fixture();
  assert.throws(() => procurement.createPurchaseOrder(acc, {
    vendorId: 'vendor-1', branchId: 1, lines: [{ itemId: 'milk', quantity: 0, unit: 'لیتر', unitPriceIrr: 100000 }],
  }), (error) => error.code === 'purchase_quantity_invalid');
  assert.throws(() => procurement.createPurchaseOrder(acc, {
    vendorId: 'vendor-1', branchId: 1, lines: [{ itemId: 'milk', quantity: 1, unit: 'عدد', unitPriceIrr: 100000 }],
  }), (error) => error.code === 'purchase_item_unit_mismatch');
  assert.throws(() => procurement.createPurchaseOrder(acc, {
    vendorId: 'vendor-1', branchId: 2, lines: [{ itemId: 'milk', quantity: 1, unit: 'لیتر', unitPriceIrr: 100000 }],
  }), (error) => error.code === 'inventory_item_branch_mismatch');
  assert.equal(acc.purchaseOrders.length, 0);
});

test('over-receipt, duplicate receipt rows, duplicate delivery notes and branch crossing are blocked atomically', () => {
  const acc = fixture();
  const po = createApprovedPo(acc);
  assert.throws(() => procurement.receiveGoods(acc, {
    poId: po.id, branchId: 1, deliveryNoteNumber: 'DN-OVER',
    lines: [{ poLineId: po.lines[0].id, quantityReceived: 11, unit: 'لیتر' }],
  }), (error) => error.code === 'goods_receipt_over_quantity');
  assert.equal(acc.goodsReceipts.length, 0);
  assert.equal(po.lines[0].receivedQuantity, 0);
  assert.throws(() => procurement.receiveGoods(acc, {
    poId: po.id, branchId: 1, deliveryNoteNumber: 'DN-DUP-ROW',
    lines: [
      { poLineId: po.lines[0].id, quantityReceived: 5, unit: 'لیتر' },
      { poLineId: po.lines[0].id, quantityReceived: 5, unit: 'لیتر' },
    ],
  }), (error) => error.code === 'goods_receipt_duplicate_purchase_order_line');
  assert.equal(acc.goodsReceipts.length, 0);
  assert.throws(() => procurement.receiveGoods(acc, {
    poId: po.id, branchId: 2, deliveryNoteNumber: 'DN-BRANCH',
    lines: [{ poLineId: po.lines[0].id, quantityReceived: 1, unit: 'لیتر' }],
  }), (error) => error.code === 'goods_receipt_branch_mismatch');
  const first = procurement.receiveGoods(acc, {
    poId: po.id, branchId: 1, deliveryNoteNumber: 'DN-OK',
    lines: [{ poLineId: po.lines[0].id, quantityReceived: 5, unit: 'لیتر' }],
  }, { postJournalFn: postJournal(acc) });
  assert.equal(first.grn.totalValue, 500000);
  assert.equal(po.status, 'partially_received');
  assert.throws(() => procurement.receiveGoods(acc, {
    poId: po.id, branchId: 1, deliveryNoteNumber: 'DN-SECOND',
    lines: [{ poLineId: po.lines[0].id, quantityReceived: 6, unit: 'لیتر' }],
  }), (error) => error.code === 'goods_receipt_over_quantity');
  assert.throws(() => procurement.receiveGoods(acc, {
    poId: po.id, branchId: 1, deliveryNoteNumber: 'DN-OK',
    lines: [{ poLineId: po.lines[0].id, quantityReceived: 1, unit: 'لیتر' }],
  }), (error) => error.code === 'goods_receipt_duplicate');
  assert.equal(acc.goodsReceipts.length, 1);
});

test('receipt posts GRNI and matched invoice clears GRNI into AP without double-debiting inventory', () => {
  const acc = fixture();
  const post = postJournal(acc);
  const po = createApprovedPo(acc);
  const received = procurement.receiveGoods(acc, {
    poId: po.id, branchId: 1, deliveryNoteNumber: 'DN-GRNI',
    lines: [{ poLineId: po.lines[0].id, quantityReceived: 10, unit: 'لیتر' }], createdById: 'warehouse-1',
  }, { postJournalFn: post });
  assert.deepEqual(received.journalEntry.lines.map((line) => [line.accountCode, line.debit, line.credit]), [['1610', 1000000, 0], ['2120', 0, 1000000]]);
  const created = procurement.createVendorBill(acc, {
    vendorId: 'vendor-1', branchId: 1, poId: po.id, grnId: received.grn.id, invoiceNumber: 'INV-GRNI',
    total: 1100000, vatAmount: 100000,
    lines: [{ grnLineId: received.grn.lines[0].id, poLineId: po.lines[0].id, quantity: 10, unit: 'لیتر', unitPriceIrr: 100000 }],
  }, { postJournalFn: post });
  assert.equal(created.bill.status, 'open');
  assert.equal(created.match.status, 'matched');
  assert.equal(created.journalEntry.lines.some((line) => line.accountCode === '1610'), false);
  assert.deepEqual(created.journalEntry.lines.map((line) => [line.accountCode, line.debit, line.credit]), [['2120', 1000000, 0], ['1450', 100000, 0], ['2110', 0, 1100000]]);
  assert.equal(acc.vendors[0].balance, 1100000);
  const payment = procurement.payVendorBill(acc, created.bill.id, { amount: 1100000, paymentMethod: 'BANK', createdById: 'treasurer-1' }, { postJournalFn: post });
  assert.equal(payment.bill.status, 'paid');
  assert.equal(payment.bill.paidAmount, 1100000);
  assert.equal(payment.payment.amount, 1100000);
  assert.equal(acc.vendors[0].balance, 0);
  assert.equal(acc.vendorPayments.length, 1);
  assert.equal(acc.journalEntries.every((entry) => entry.lines.reduce((sum, line) => sum + line.debit, 0) === entry.lines.reduce((sum, line) => sum + line.credit, 0)), true);
});

test('duplicate invoice detection is vendor-scoped and does not reject a different invoice with same date and amount', () => {
  const acc = fixture();
  const first = procurement.createVendorBill(acc, {
    vendorId: 'vendor-1', branchId: 1, invoiceNumber: ' INV-001 ', date: '2026-08-27', total: 1100000, vatAmount: 100000,
  });
  assert.equal(first.bill.status, 'unmatched');
  assert.throws(() => procurement.createVendorBill(acc, {
    vendorId: 'vendor-1', branchId: 2, invoiceNumber: 'inv-001', date: '2026-08-27', total: 1100000, vatAmount: 100000,
  }), (error) => error.code === 'vendor_invoice_duplicate');
  const different = procurement.createVendorBill(acc, {
    vendorId: 'vendor-1', branchId: 1, invoiceNumber: 'INV-002', date: '2026-08-27', total: 1100000, vatAmount: 100000,
  });
  assert.equal(different.bill.invoiceNumber, 'INV-002');
  assert.throws(() => procurement.createVendorBill(acc, { vendorId: 'vendor-1', total: 1 }), (error) => error.code === 'vendor_invoice_number_missing');
});

test('price variance is held, can be rejected, and a corrected invoice can retry the same receipt', () => {
  const acc = fixture();
  const post = postJournal(acc);
  const po = createApprovedPo(acc);
  const received = receiveFull(acc, po, { postJournalFn: post, deliveryNoteNumber: 'DN-VARIANCE' });
  const wrong = createMatchedBill(acc, po, received.grn, { invoiceNumber: 'INV-WRONG', total: 1200000, vatAmount: 0, unitPriceIrr: 120000, postJournalFn: post });
  assert.equal(wrong.bill.status, 'match_exception');
  assert.equal(wrong.match.status, 'price_variance');
  assert.equal(wrong.journalEntry, null);
  assert.equal(acc.journalEntries.filter((entry) => entry.source === 'vendor_bill').length, 0);
  const rejected = procurement.resolveVendorBillVariance(acc, wrong.bill.id, 'rejected', { reason: 'قیمت فاکتور با سفارش سازگار نیست', actor: 'owner-1' });
  assert.equal(rejected.bill.status, 'match_rejected');
  assert.equal(rejected.match.status, 'rejected');
  const corrected = createMatchedBill(acc, po, received.grn, { invoiceNumber: 'INV-CORRECTED', total: 1000000, vatAmount: 0, unitPriceIrr: 100000, postJournalFn: post });
  assert.equal(corrected.bill.status, 'open');
  assert.equal(corrected.match.status, 'matched');
  assert.equal(corrected.journalEntry.lines.find((line) => line.accountCode === '2120').debit, 1000000);
});

test('accepted variance posts the explicit price difference and remains payable', () => {
  const acc = fixture();
  const post = postJournal(acc);
  const po = createApprovedPo(acc);
  const received = receiveFull(acc, po, { postJournalFn: post, deliveryNoteNumber: 'DN-ACCEPT' });
  const result = createMatchedBill(acc, po, received.grn, { invoiceNumber: 'INV-ACCEPT', total: 1200000, vatAmount: 0, unitPriceIrr: 120000, postJournalFn: post });
  const accepted = procurement.resolveVendorBillVariance(acc, result.bill.id, 'approved', { reason: 'اختلاف قیمت با تأیید مالک پذیرفته شد', actor: 'owner-1' }, { postJournalFn: post });
  assert.equal(accepted.bill.status, 'open');
  assert.equal(accepted.bill.matchStatus, 'accepted_variance');
  assert.equal(accepted.journalEntry.lines.find((line) => line.accountCode === '5150').debit, 200000);
  assert.equal(acc.vendors[0].balance, 1200000);
});

test('three-way matching rejects missing links, crossed documents, invoice over-receipt, total drift and unit drift', () => {
  const acc = fixture();
  const post = postJournal(acc);
  const po = createApprovedPo(acc);
  const received = receiveFull(acc, po, { postJournalFn: post, deliveryNoteNumber: 'DN-CONTROLS' });
  const unlinked = procurement.createVendorBill(acc, { vendorId: 'vendor-1', branchId: 1, invoiceNumber: 'INV-UNLINKED', total: 1000, vatAmount: 0 });
  assert.throws(() => procurement.performThreeWayMatch(acc, { billId: unlinked.bill.id }), (error) => error.code === 'three_way_documents_required');
  assert.throws(() => procurement.createVendorBill(acc, {
    vendorId: 'vendor-1', branchId: 2, poId: po.id, grnId: received.grn.id, invoiceNumber: 'INV-BRANCH-CROSS', total: 1100000, vatAmount: 100000,
    lines: [{ grnLineId: received.grn.lines[0].id, poLineId: po.lines[0].id, quantity: 10, unit: 'لیتر', unitPriceIrr: 100000 }],
  }), (error) => error.code === 'three_way_branch_mismatch');
  acc.vendors.push({ id: 'vendor-2', name: 'تأمین‌کننده دوم', balance: 0 });
  assert.throws(() => procurement.createVendorBill(acc, {
    vendorId: 'vendor-2', branchId: 1, poId: po.id, grnId: received.grn.id, invoiceNumber: 'INV-VENDOR-CROSS', total: 1100000, vatAmount: 100000,
    lines: [{ grnLineId: received.grn.lines[0].id, poLineId: po.lines[0].id, quantity: 10, unit: 'لیتر', unitPriceIrr: 100000 }],
  }), (error) => error.code === 'three_way_vendor_mismatch');
  assert.throws(() => procurement.createVendorBill(acc, {
    vendorId: 'vendor-1', branchId: 1, poId: po.id, grnId: received.grn.id, invoiceNumber: 'INV-OVER-BILL', total: 1210000, vatAmount: 110000,
    lines: [{ grnLineId: received.grn.lines[0].id, poLineId: po.lines[0].id, quantity: 11, unit: 'لیتر', unitPriceIrr: 110000 }],
  }), (error) => error.code === 'vendor_invoice_over_received_quantity');
  assert.throws(() => procurement.createVendorBill(acc, {
    vendorId: 'vendor-1', branchId: 1, poId: po.id, grnId: received.grn.id, invoiceNumber: 'INV-TOTAL-DRIFT', total: 1100000, vatAmount: 0,
    lines: [{ grnLineId: received.grn.lines[0].id, poLineId: po.lines[0].id, quantity: 10, unit: 'لیتر', unitPriceIrr: 100000 }],
  }), (error) => error.code === 'vendor_bill_total_mismatch');
  assert.throws(() => procurement.createVendorBill(acc, {
    vendorId: 'vendor-1', branchId: 1, poId: po.id, grnId: received.grn.id, invoiceNumber: 'INV-UNIT-DRIFT', total: 1100000, vatAmount: 100000,
    lines: [{ grnLineId: received.grn.lines[0].id, poLineId: po.lines[0].id, quantity: 10, unit: 'کیلوگرم', unitPriceIrr: 100000 }],
  }), (error) => error.code === 'vendor_invoice_unit_mismatch');
  assert.equal(acc.vendorBills.length, 1);
});

test('sealed procurement documents reject direct tampering while lifecycle actions remain explicit', () => {
  const acc = fixture();
  const po = procurement.createPurchaseOrder(acc, { vendorId: 'vendor-1', branchId: 1, lines: [{ itemId: 'milk', quantity: 10, unit: 'لیتر', unitPriceIrr: 100000 }] }).po;
  po.lines[0].unitPrice = 999999;
  assert.throws(() => procurement.approvePurchaseOrder(acc, po.id, 'manager-1'), (error) => error.code === 'document_tampered');

  const second = fixture();
  const po2 = createApprovedPo(second);
  const received = receiveFull(second, po2, { deliveryNoteNumber: 'DN-SEAL' });
  received.grn.lines[0].unitCost = 1;
  assert.throws(() => procurement.createVendorBill(second, {
    vendorId: 'vendor-1', branchId: 1, poId: po2.id, grnId: received.grn.id, invoiceNumber: 'INV-SEAL', total: 1100000, vatAmount: 100000,
    lines: [{ grnLineId: received.grn.lines[0].id, poLineId: po2.lines[0].id, quantity: 10, unit: 'لیتر', unitPriceIrr: 100000 }],
  }), (error) => error.code === 'document_tampered');

  const third = fixture();
  const po3 = createApprovedPo(third);
  const grn3 = receiveFull(third, po3, { deliveryNoteNumber: 'DN-BILL-SEAL' });
  const bill = createMatchedBill(third, po3, grn3.grn, { invoiceNumber: 'INV-BILL-SEAL' }).bill;
  bill.total = 1;
  assert.throws(() => procurement.payVendorBill(third, bill.id, { amount: 1 }), (error) => error.code === 'document_tampered');
});

test('payment must be reversed before bill, and bill before receipt; reversals preserve originals', () => {
  const acc = fixture();
  const post = postJournal(acc);
  const po = createApprovedPo(acc);
  const received = receiveFull(acc, po, { postJournalFn: post, deliveryNoteNumber: 'DN-REV' });
  const bill = createMatchedBill(acc, po, received.grn, { invoiceNumber: 'INV-REV', postJournalFn: post }).bill;
  const payment = procurement.payVendorBill(acc, bill.id, { amount: 1100000, paymentMethod: 'BANK' }, { postJournalFn: post });
  assert.throws(() => procurement.reverseVendorBill(acc, bill.id, { reason: 'ابطال فاکتور', actor: 'owner-1' }, { postJournalFn: post }), (error) => error.code === 'vendor_bill_has_payment_activity');
  assert.throws(() => procurement.reverseVendorBillPayment(acc, payment.payment.id, { branchId: 2, reason: 'اصلاح پرداخت' }, { postJournalFn: post }), (error) => error.code === 'reversal_branch_mismatch');
  const paymentReversal = procurement.reverseVendorBillPayment(acc, payment.payment.id, { reason: 'اصلاح پرداخت بانکی', actor: 'owner-1' }, { postJournalFn: post });
  assert.equal(paymentReversal.payment.status, 'reversed');
  assert.equal(paymentReversal.bill.status, 'open');
  assert.equal(paymentReversal.bill.paidAmount, 0);
  const billReversal = procurement.reverseVendorBill(acc, bill.id, { reason: 'ابطال فاکتور خرید', actor: 'owner-1' }, { postJournalFn: post });
  assert.equal(billReversal.bill.status, 'reversed');
  assert.equal(acc.threeWayMatches[0].status, 'reversed');
  assert.equal(acc.vendors[0].balance, 0);
  const receiptReversal = procurement.reverseGoodsReceipt(acc, received.grn.id, { reason: 'برگشت کالا', actor: 'owner-1' }, { postJournalFn: post });
  assert.equal(receiptReversal.grn.status, 'reversed');
  assert.equal(po.lines[0].receivedQuantity, 0);
  assert.equal(po.status, 'approved');
  assert.equal(received.grn.lines[0].quantityReceived, 10);
  assert.equal(acc.procurementReversals.length, 3);
});

test('idempotency replays the original PO, receipt, bill and payment and rejects key reuse with changed input', () => {
  const acc = fixture();
  const post = postJournal(acc);
  const first = procurement.createPurchaseOrder(acc, { idempotencyKey: 'po-request-1', vendorId: 'vendor-1', branchId: 1, lines: [{ itemId: 'milk', quantity: 10, unit: 'لیتر', unitPriceIrr: 100000 }] });
  const replayPo = procurement.createPurchaseOrder(acc, { idempotencyKey: 'po-request-1', vendorId: 'vendor-1', branchId: 1, lines: [{ itemId: 'milk', quantity: 10, unit: 'لیتر', unitPriceIrr: 100000 }] });
  assert.equal(replayPo.idempotentReplay, true);
  assert.equal(replayPo.po.id, first.po.id);
  assert.equal(acc.purchaseOrders.length, 1);
  assert.throws(() => procurement.createPurchaseOrder(acc, { idempotencyKey: 'po-request-1', vendorId: 'vendor-1', branchId: 1, lines: [{ itemId: 'milk', quantity: 9, unit: 'لیتر', unitPriceIrr: 100000 }] }), (error) => error.code === 'idempotency_key_conflict');
  const po = first.po;
  procurement.approvePurchaseOrder(acc, po.id, 'manager-1');
  const receiptInput = { idempotencyKey: 'grn-request-1', poId: po.id, branchId: 1, deliveryNoteNumber: 'DN-IDEMP', lines: [{ poLineId: po.lines[0].id, quantityReceived: 10, unit: 'لیتر' }] };
  const firstReceipt = procurement.receiveGoods(acc, receiptInput, { postJournalFn: post });
  const replayReceipt = procurement.receiveGoods(acc, receiptInput, { postJournalFn: post });
  assert.equal(replayReceipt.idempotentReplay, true);
  assert.equal(replayReceipt.grn.id, firstReceipt.grn.id);
  assert.equal(acc.goodsReceipts.length, 1);
  const billInput = { idempotencyKey: 'bill-request-1', vendorId: 'vendor-1', branchId: 1, poId: po.id, grnId: firstReceipt.grn.id, invoiceNumber: 'INV-IDEMP', total: 1100000, vatAmount: 100000, lines: [{ grnLineId: firstReceipt.grn.lines[0].id, poLineId: po.lines[0].id, quantity: 10, unit: 'لیتر', unitPriceIrr: 100000 }] };
  const firstBill = procurement.createVendorBill(acc, billInput, { postJournalFn: post });
  const replayBill = procurement.createVendorBill(acc, billInput, { postJournalFn: post });
  assert.equal(replayBill.idempotentReplay, true);
  assert.equal(replayBill.bill.id, firstBill.bill.id);
  const payInput = { idempotencyKey: 'pay-request-1', amount: 1100000, paymentMethod: 'BANK' };
  const firstPayment = procurement.payVendorBill(acc, firstBill.bill.id, payInput, { postJournalFn: post });
  const replayPayment = procurement.payVendorBill(acc, firstBill.bill.id, payInput, { postJournalFn: post });
  assert.equal(replayPayment.idempotentReplay, true);
  assert.equal(replayPayment.payment.id, firstPayment.payment.id);
  assert.equal(acc.vendorPayments.length, 1);
});
