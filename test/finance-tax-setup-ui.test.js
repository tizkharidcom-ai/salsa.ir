'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (relative) => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');

test('branch tax setup is permission-gated, branch-scoped, and never fills legal values', () => {
  const source = read('js/admin-accounting.js');
  const css = read('css/admin-accounting.css');
  assert.match(source, /can\('finance\.settings\.manage'\).*تنظیم مالیات سفارش‌های این شعبه/s);
  assert.match(source, /tax-matrix\?branchId=\$\{encodeURIComponent\(branchId\)\}/);
  assert.match(source, /locationId:\s*branchId/);
  assert.match(source, /inclusive:\s*true/);
  assert.match(source, /currentRole\(\) === 'owner'[\s\S]*?fin-tax-global-form/);
  assert.match(source, /api\('\/api\/admin\/finance\/tax-matrix',[\s\S]*?method:\s*'PATCH'/);
  assert.match(source, /name="ratePercent"[^>]*required/);
  assert.match(source, /name="effectiveFrom" type="date" required/);
  assert.match(source, /name="legalSource" required/);
  assert.match(source, /rate:\s*ratePercent\s*\/\s*100/);
  assert.doesNotMatch(source, /name="(?:ratePercent|effectiveFrom|legalSource)"[^>]*value=/);
  assert.match(css, /\.fin-tax-setup \.fin-form \{ grid-template-columns: minmax\(0, 1fr\); \}/);
  assert.match(css, /\.fin-tax-setup \.fin-operation-list > article \{ flex-direction: column/);
});
