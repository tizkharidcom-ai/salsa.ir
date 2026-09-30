'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { registerAccountingRoutes } = require('../server/accounting-routes');
const { checkoutTaxCategoriesPatch, prepareBranchTaxRule } = require('../server/finance/tax-rule-input');

const settings = {
  defaultCategory: 'standard_1405',
  deliveryFeeTaxCategory: '',
  categories: [
    { code: 'standard_1405', exempt: false },
    { code: 'exempt_staple', exempt: true },
  ],
  rules: [],
};
const branches = [{ id: 4 }, { id: 9 }];
const validInput = {
  code: 'VAT_BRANCH_4',
  name: 'قاعده تأییدشده شعبه',
  taxCategory: 'standard_1405',
  rate: 0.09,
  inclusive: true,
  locationId: 4,
  fulfillmentType: null,
  effectiveFrom: '2026-03-21',
  legalSource: 'منبع تأییدشده توسط مسئول مالی',
};

function taxRouteHarness() {
  const routes = new Map();
  const app = {};
  for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
    app[method] = (routePath, ...handlers) => routes.set(`${method.toUpperCase()} ${routePath}`, handlers.at(-1));
  }
  const db = {
    branches,
    accounting: { taxSettings: { ...settings, rules: [
      { id: 'rule-4', locationId: 4, code: 'VAT_4', taxCategory: 'standard_1405', rate: 0.09, inclusive: true },
      { id: 'rule-9', locationId: 9, code: 'VAT_9', taxCategory: 'standard_1405', rate: 0.08, inclusive: true },
    ] } },
  };
  let saveCalls = 0;
  registerAccountingRoutes({
    app,
    getDb: () => db,
    save: () => { saveCalls += 1; },
    requireAdmin: () => (_req, _res, next) => next?.(),
    requireCapability: () => (_req, _res, next) => next?.(),
    parseBranchId: (req) => Number(req.query?.branchId || req.body?.branchId || 4),
  });
  return { routes, db, get saveCalls() { return saveCalls; } };
}

function responseRecorder() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test('tax matrix accepts only explicit order categories and never invents a rate', () => {
  assert.deepEqual(checkoutTaxCategoriesPatch({
    defaultCategory: 'standard_1405',
    deliveryFeeTaxCategory: 'standard_1405',
  }, settings), {
    defaultCategory: 'standard_1405',
    deliveryFeeTaxCategory: 'standard_1405',
  });
  assert.throws(() => prepareBranchTaxRule({ ...validInput, rate: undefined }, settings, branches), { code: 'tax_rate_required' });
  assert.throws(() => prepareBranchTaxRule({ ...validInput, legalSource: '' }, settings, branches), { code: 'tax_rule_evidence_required' });
  assert.throws(() => prepareBranchTaxRule({ ...validInput, locationId: 99 }, settings, branches), { code: 'tax_branch_required' });
  assert.throws(() => prepareBranchTaxRule(validInput, settings, branches, [9]), { code: 'tax_branch_forbidden' });
});

test('branch rule input preserves inclusive pricing, legal source, and effective-dated versioning', () => {
  const rule = prepareBranchTaxRule(validInput, settings, branches, [4]);
  assert.equal(rule.inclusive, true);
  assert.equal(rule.rate, 0.09);
  assert.equal(rule.locationId, 4);
  assert.equal(rule.legalSource, validInput.legalSource);
  assert.equal(rule.effectiveFrom, '2026-03-21');
  assert.equal(rule.version, 1);
  const nextVersion = prepareBranchTaxRule({ ...validInput, rate: 0.08, effectiveFrom: '2027-03-21' }, { ...settings, rules: [rule] }, branches, [4]);
  assert.equal(nextVersion.version, 2);
  assert.equal(nextVersion.effectiveFrom, '2027-03-21');
  assert.throws(() => prepareBranchTaxRule({ ...validInput, code: 'VAT_OTHER' }, { ...settings, rules: [rule] }, branches, [4]), { code: 'tax_rule_scope_conflict' });
  assert.throws(() => prepareBranchTaxRule({ ...validInput, inclusive: 'true' }, settings, branches), { code: 'tax_inclusive_required' });
  assert.throws(() => prepareBranchTaxRule({ ...validInput, effectiveFrom: '2026-02-30' }, settings, branches), { code: 'tax_effective_date_required' });
});

test('accounting tax configuration route has no implicit ten-percent default', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'server', 'accounting-routes.js'), 'utf8');
  const start = source.indexOf("app.post('/api/admin/finance/tax-matrix/rule'");
  const end = source.indexOf('// ── 18. Settings & Full Ledger Rebuild', start);
  assert.ok(start >= 0 && end > start);
  const route = source.slice(start, end);
  assert.match(route, /requireCapability\('finance\.settings\.manage'\)/);
  assert.match(route, /prepareBranchTaxRule\(req\.body, settings, db\.branches, branchScope\)/);
  assert.match(route, /parseBranchId\(req\)/);
  assert.match(route, /tax_branch_scope_mismatch/);
  assert.doesNotMatch(route, /0\.10|rate:\s*Number\(req\.body\.rate\)\s*\|\|/);
});

test('tax matrix read is restricted to the selected branch and settings capability', () => {
  const routes = fs.readFileSync(path.join(__dirname, '..', 'server', 'accounting-routes.js'), 'utf8');
  const map = fs.readFileSync(path.join(__dirname, '..', 'server', 'salsa', 'route-capability-map.js'), 'utf8');
  const start = routes.indexOf("app.get('/api/admin/finance/tax-matrix'");
  const end = routes.indexOf("app.patch('/api/admin/finance/tax-matrix'", start);
  assert.ok(start >= 0 && end > start);
  const route = routes.slice(start, end);
  assert.match(route, /requireCapability\('finance\.settings\.manage'\)/);
  assert.match(route, /branchId\s*=\s*parseBranchId\s*\?\s*parseBranchId\(req\)\s*:\s*null/);
  assert.match(route, /rules\.filter\(\(rule\)\s*=>\s*Number\(rule\?\.locationId\)\s*===\s*Number\(branchId\)\)/);
  assert.match(map, /'GET \/api\/admin\/finance\/tax-matrix':\s*'finance\.settings\.manage'/);
  assert.match(map, /'PATCH \/api\/admin\/finance\/tax-matrix':\s*'finance\.settings\.manage'/);
  assert.match(map, /'POST \/api\/admin\/finance\/tax-matrix\/rule':\s*'finance\.settings\.manage'/);
});

test('tax matrix HTTP handler returns only the selected branch rules and rejects a different target branch', () => {
  const harness = taxRouteHarness();
  const read = responseRecorder();
  harness.routes.get('GET /api/admin/finance/tax-matrix')({ query: { branchId: '4' }, user: { role: 'owner' } }, read);
  assert.equal(read.statusCode, 200);
  assert.equal(read.body.branchId, 4);
  assert.deepEqual(read.body.rules.map((rule) => rule.id), ['rule-4']);

  const write = responseRecorder();
  harness.routes.get('POST /api/admin/finance/tax-matrix/rule')({
    query: { branchId: '4' },
    body: { ...validInput, locationId: 9 },
    user: { role: 'owner' },
  }, write);
  assert.equal(write.statusCode, 403);
  assert.equal(write.body.code, 'tax_branch_scope_mismatch');
  assert.equal(harness.saveCalls, 0);

  const scopedPatch = responseRecorder();
  harness.routes.get('PATCH /api/admin/finance/tax-matrix')({
    body: { defaultCategory: 'standard_1405', deliveryFeeTaxCategory: 'standard_1405' },
    user: { role: 'manager', allowedBranchIds: [4] },
  }, scopedPatch);
  assert.equal(scopedPatch.statusCode, 403);
  assert.equal(scopedPatch.body.code, 'tax_matrix_owner_required');
  assert.equal(harness.saveCalls, 0);

  const ownerPatch = responseRecorder();
  harness.routes.get('PATCH /api/admin/finance/tax-matrix')({
    body: { defaultCategory: 'standard_1405', deliveryFeeTaxCategory: 'standard_1405' },
    user: { role: 'owner' },
  }, ownerPatch);
  assert.equal(ownerPatch.statusCode, 200);
  assert.equal(ownerPatch.body.settings.deliveryFeeTaxCategory, 'standard_1405');
  assert.equal(Object.hasOwn(ownerPatch.body.settings, 'rules'), false,
    'tenant-global updates must never disclose per-branch rules in their response');
  assert.equal(harness.saveCalls, 1);
});
