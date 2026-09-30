'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'admin-accounting.js'), 'utf8');

function sourceBetween(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `missing source range: ${startMarker}`);
  return source.slice(start, end);
}

test('refund request uses the recoverable server receipt and says no money was transferred', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'admin.html'), 'utf8');
  const handler = sourceBetween(
    "root.querySelector('#fin-refund-form')?.addEventListener('submit'",
    "const poForm = root.querySelector('#fin-po-form');",
  );

  assert.match(handler, /runRecoverableFinanceOperation\(\{/);
  assert.match(handler, /path: `\/api\/admin\/v2\/finance\/orders\/\$\{encodeURIComponent\(orderId\)\}\/refund-requests`/);
  assert.match(handler, /paymentId: values\.paymentId, amountIrr: amountToman \* 10/);
  assert.match(handler, /refundDate: `\$\{refundDate\}T12:00:00\.000Z`, reason/);
  assert.match(handler, /receiptKey: 'refund'/);
  assert.match(handler, /وجه هنوز منتقل نشده است/);
  assert.doesNotMatch(handler, /await mutation\(/);
  assert.match(html, /js\/admin-accounting\.js\?v=finance-v2-tax-setup-v1-20260924/);
});

test('an uncertain refund request can replay the captured payload with its original idempotency key', () => {
  const mutation = sourceBetween('  async function mutation(', '  function finalizeRecoverableMutation(');
  const unknown = sourceBetween('  function renderUnknownOperation(', '  async function runRecoverableFinanceOperation(');
  const recovery = sourceBetween('  async function runRecoverableFinanceOperation(', '  function payrollFormPayload(');

  assert.match(mutation, /button\.dataset\.finIdempotencyKey \|\| idempotencyKey\(\)/);
  assert.match(mutation, /'Idempotency-Key': requestKey/);
  assert.match(mutation, /button\.dataset\.finOutcomeUnknown = '1'/);
  assert.match(unknown, /data-fin-recover-operation/);
  assert.match(unknown, /await retry\(\)/);
  assert.match(recovery, /mutation\(path, body, button, \{ recovery: true \}\)/);
  assert.match(recovery, /if \(error\.outcomeUnknown\)[\s\S]*?renderUnknownOperation\(feedbackSelector, error, button, attempt\)/);
});
