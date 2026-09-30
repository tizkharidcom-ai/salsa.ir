'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const pageSource = fs.readFileSync(path.join(__dirname, '../prototype/js/godmode/pages/commercial/commercial.js'), 'utf8');

function loadPage(overrides = {}) {
  const sandbox = {
    GodModeAppMode: { isProduction: () => false },
    ...overrides,
  };
  vm.runInNewContext(pageSource, sandbox, { filename: 'commercial.js' });
  return sandbox;
}

test('isolated preview hides commercial data and does not call repositories', async () => {
  let repositoryCalls = 0;
  const repository = new Proxy({}, { get: () => async () => { repositoryCalls += 1; return []; } });
  const sandbox = loadPage({
    CommercialRepository: repository,
    EntitlementsRepository: repository,
    RestaurantsRepository: repository,
  });

  const html = await sandbox.renderGodModeCommercial();
  assert.match(html, /اطلاعات عملیاتی در دسترس نیست/);
  assert.match(html, /پیش‌نمایش ایزوله/);
  assert.doesNotMatch(html, /commercial-invoices-table|هزار|MRR|7\.3M/);
  assert.equal(repositoryCalls, 0);
});

test('production data-source failure stays unavailable instead of falling back to fixtures', async () => {
  const repository = new Proxy({}, { get: () => async () => { throw new Error('connection refused'); } });
  const sandbox = loadPage({
    GodModeAppMode: { isProduction: () => true },
    CommercialRepository: repository,
    EntitlementsRepository: repository,
    RestaurantsRepository: repository,
  });

  const html = await sandbox.renderGodModeCommercial();
  assert.match(html, /اطلاعات عملیاتی در دسترس نیست/);
  assert.match(html, /connection refused/);
  for (const fixture of ['7.3M', '47 GB', 'A19382', 'tnt_westo_demo', '7190000']) {
    assert.doesNotMatch(html, new RegExp(fixture.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('connected production view represents absent quota telemetry as unknown, not as zero use', async () => {
  const sandbox = loadPage({
    GodModeAppMode: { isProduction: () => true },
    CommercialRepository: {
      listPlans: async () => [],
      getBillingExceptions: async () => [],
      getGlobalKillswitches: async () => ({}),
      getPendingActivationInvoices: async () => [],
      getAllInvoices: async () => [],
      getCommercialPulseMetrics: async () => null,
      getTaxSummary: async () => null,
      listSubscriptions: async () => [],
    },
    EntitlementsRepository: { getBusinessModules: async () => [] },
    RestaurantsRepository: { listRestaurants: async () => ({ restaurants: [] }) },
  });

  const html = await sandbox.renderGodModeCommercial({ params: { section: 'quotas' } });
  assert.match(html, /دادهٔ مصرف و سهمیه از سرویس عملیاتی دریافت نشد/);
  assert.doesNotMatch(html, /7\.3M|47 GB|4,210|10M/);
});

test('isolated-preview provenance banner is not hidden by the workspace stylesheet', () => {
  const css = fs.readFileSync(path.join(__dirname, '../prototype/css/godmode-workspace.css'), 'utf8');
  const bannerRule = css.match(/\.prototype-banner\s*\{([^}]*)\}/);
  assert.ok(bannerRule, 'prototype banner rule exists');
  assert.match(bannerRule[1], /display:\s*flex\s*!important/);
  assert.doesNotMatch(bannerRule[1], /display:\s*none/);
});
