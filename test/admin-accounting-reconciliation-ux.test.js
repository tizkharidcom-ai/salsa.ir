'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const js = fs.readFileSync(path.join(__dirname, '..', 'js', 'admin-accounting.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'css', 'admin-accounting.css'), 'utf8');

test('ambiguous financial responses stay unknown and recover with the same idempotency key', () => {
  assert.match(js, /error\.outcomeUnknown = true/);
  assert.match(js, /error\.outcomeUnknown = response\.status >= 500/);
  assert.match(js, /button\.dataset\.finIdempotencyKey = requestKey/);
  assert.match(js, /button\.dataset\.finPendingVerification !== '1'\) button\.disabled = false/);
  assert.match(js, /بازیابی پاسخ با همان شناسه/);
  assert.match(js, /فرم را دوباره ارسال نکنید/);
  assert.match(js, /runRecoverableFinanceOperation\(\{[\s\S]*?receiptKey: 'settlement'/);
  assert.match(js, /runRecoverableFinanceOperation\(\{[\s\S]*?receiptKey: 'statementLine'/);
});

test('success messaging waits for a fresh workspace read and receipts use server records', () => {
  const refresh = js.slice(js.indexOf('async function refreshAfterMutation'), js.indexOf('function renderOperationReceipt'));
  assert.ok(refresh.indexOf('await loadWorkspace()') < refresh.indexOf("toast(refreshed"));
  assert.match(js, /if \(!record\?\.id\)[\s\S]*?outcomeUnknown: true/);
  assert.match(js, /رسید پاسخ سرور/);
  assert.match(js, /شناسهٔ رسید/);
  assert.match(js, /تطبیق‌دهنده/);
});

test('bank match suggestions require individual review rather than one-click bulk posting', () => {
  assert.match(js, /این‌ها فقط پیشنهادند؛ هر گردش را جداگانه بررسی و تطبیق را تأیید کنید/);
  assert.doesNotMatch(js, /data-fin-auto-match-all/);
  assert.doesNotMatch(js, /تطبیق ۱-کلیکی همه موارد/);
});

test('bank receipts and settlement batches fail closed when no active branch is selected', () => {
  assert.match(js, /const activeBranchId = \(\) => \{[\s\S]*?Number\.isSafeInteger\(branchId\) && branchId > 0 \? branchId : null/);
  assert.match(js, /code: 'finance_branch_required'[\s\S]*?ابتدا شعبه را انتخاب کنید/);
  const settlement = js.slice(js.indexOf("path: '/api/admin/v2/finance/reconciliation/settlements'"), js.indexOf("path: '/api/admin/v2/finance/reconciliation/bank-statement-lines'"));
  const bankLine = js.slice(js.indexOf("path: '/api/admin/v2/finance/reconciliation/bank-statement-lines'"), js.indexOf("root.querySelectorAll\('[data-fin-bank-match]'"));
  assert.match(settlement, /body: \{[\s\S]*?branchId, paymentIds/);
  assert.match(bankLine, /body: \{[\s\S]*?branchId, bankReference/);
  assert.doesNotMatch(settlement + bankLine, /branchId\) \|\| 1/);
});

test('reconciliation receipts and unknown states remain readable and operable on narrow screens', () => {
  assert.match(css, /\.fin-operation-unknown[\s\S]*?overflow-wrap: anywhere/);
  assert.match(css, /\.fin-operation-receipt dl[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /@media \(max-width: 720px\)[\s\S]*?\.fin-operation-receipt dl \{ grid-template-columns: minmax\(0, 1fr\); \}/);
  assert.match(css, /\.fin-operation-unknown > \.fin-btn \{ min-height: 44px/);
});
