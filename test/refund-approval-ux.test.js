'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'admin-accounting.js'), 'utf8');

test('refund approval copy distinguishes authorization from transferring funds', () => {
  assert.match(source, /data-fin-approval-operation="\$\{esc\(row\.operation\)\}"/);
  assert.match(source, /button\.dataset\.finApprovalOperation === 'approve_customer_refund'/);
  assert.match(source, /این تأیید فقط مجوز برگشت وجه است؛ هنوز پولی منتقل نشده/);
  assert.match(source, /پس از پرداخت، مدرک خروجی و تطبیق لازم است/);
  assert.match(source, /پرداخت در حال انجام/);
  assert.doesNotMatch(source, /اثر مالی آن قطعی شود\?/);
});

test('refund requests require a meaningful reason and an explicit non-disbursement confirmation', () => {
  const refundSubmit = source.slice(source.indexOf("root.querySelector('#fin-refund-form')"), source.indexOf("const poForm = root.querySelector('#fin-po-form')"));
  assert.match(source, /name="reason" required minlength="10" maxlength="300"/);
  assert.match(refundSubmit, /String\(values\.reason \|\| ''\)\.trim\(\)/);
  assert.match(refundSubmit, /Array\.from\(reason\)\.filter\(\(character\) => !\/\\s\/u\.test\(character\)\)\.length < 10/);
  assert.match(refundSubmit, /window\.confirm\(confirmation\)/);
  assert.match(refundSubmit, /این مرحله فقط درخواست را برای تأیید مالک می‌فرستد؛ وجه اکنون منتقل نمی‌شود/);
  assert.match(refundSubmit, /lockButtonOnSuccess: true/);
  assert.match(refundSubmit, /submitButton\?\.dataset\.finCompleted === '1'/);
});

test('refund list shows completion only for a known server-confirmed reconciled state', () => {
  const statusRenderer = source.slice(source.indexOf('function refundStatusBadge'), source.indexOf('function metric('));
  assert.match(statusRenderer, /succeeded: \{ text: 'برگشت وجه ثبت و با مدرک خروجی تطبیق شد', tone: 'success' \}/);
  assert.match(statusRenderer, /approved: \{ text: 'مجاز برای پرداخت؛ وجه منتقل نشده', tone: 'warning' \}/);
  assert.match(statusRenderer, /processing: \{ text: 'پرداخت در حال انجام؛ هنوز نهایی نیست', tone: 'warning' \}/);
  assert.match(statusRenderer, /وضعیت نامشخص؛ از ثبت دوباره خودداری کنید/);
  assert.doesNotMatch(statusRenderer, /paid:|پرداخت‌شده/);
  assert.match(source, /refundStatusBadge\(row\.status\)/);
});

test('a confirmed refund request stays locked while its workspace refresh is in progress', () => {
  const operation = source.slice(source.indexOf('async function runRecoverableFinanceOperation'), source.indexOf('function payrollFormPayload'));
  assert.ok(operation.indexOf("const record = result?.data?.[receiptKey]") < operation.indexOf('if (lockButtonOnSuccess && button)'));
  assert.match(operation, /button\.dataset\.finCompleted = '1'/);
  assert.match(operation, /button\.disabled = true/);
  assert.match(operation, /button\.textContent = 'درخواست ثبت شد'/);
});
