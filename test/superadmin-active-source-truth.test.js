'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const read = (relativePath) => fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
const frontend = 'superadmin/frontend';

test('active Super Admin shell does not claim live Control Plane before verification', () => {
  const html = read(`${frontend}/index.html`);
  const app = read(`${frontend}/js/app.js`);
  const shell = read(`${frontend}/js/godmode/components/app-shell.js`);
  const css = read(`${frontend}/css/godmode-workspace.css`);

  assert.match(html, /اتصال کنترل‌پلین تأییدنشده/);
  assert.doesNotMatch(html, /داده زنده کنترل‌پلین/);
  assert.doesNotMatch(app, /Production Live|متصل به سرور کنترل پلن|آماده استقرار و بهره‌برداری VPS/);
  assert.doesNotMatch(shell, /Production Live|متصل به سرور کنترل پلن/);
  assert.match(css, /\.prototype-banner\s*\{[^}]*display:\s*flex/s);
  assert.doesNotMatch(css.match(/\.prototype-banner\s*\{([^}]*)\}/s)?.[1] || '', /display:\s*none/);
  assert.match(css, /\[data-theme="dark"\] \.prototype-banner/);
});

test('production commercial repositories reject missing sources instead of returning empty fixture-like values', async () => {
  const sandbox = {
    GodModeAppMode: { isProduction: () => true },
    console: { warn() {} }
  };
  vm.runInNewContext(read(`${frontend}/js/godmode/domain/commercial/repository.js`), sandbox);
  const repository = sandbox.CommercialRepository;

  await assert.rejects(repository.listPlans(), /BILLING_PLANS_UNAVAILABLE/);
  await assert.rejects(repository.getBillingExceptions(), /BILLING_EXCEPTIONS_UNAVAILABLE/);
  await assert.rejects(repository.getAllInvoices(), /BILLING_INVOICES_UNAVAILABLE/);
  await assert.rejects(repository.getPendingActivationInvoices(), /BILLING_INVOICES_UNAVAILABLE/);
  await assert.rejects(repository.listSubscriptions(), /BILLING_SUBSCRIPTIONS_UNAVAILABLE/);
  await assert.rejects(repository.listGlobalKillswitches(), /KILLSWITCH_STATE_UNAVAILABLE/);
  const Repository = repository.constructor;
  const malformedKillswitches = new Repository({ get: async () => ({ data: { items: [] } }) });
  await assert.rejects(malformedKillswitches.listGlobalKillswitches(), /KILLSWITCH_STATE_INVALID/);
});

test('production module catalog fails closed and does not expose manifest list prices as approved tariffs', async () => {
  const sandbox = {
    GodModeAppMode: { isProduction: () => true },
    console: { warn() {} }
  };
  vm.runInNewContext(read(`${frontend}/js/godmode/domain/entitlements/repository.js`), sandbox);
  const Repository = sandbox.EntitlementsRepository.constructor;
  const unavailable = new Repository({ get: async () => { throw new Error('offline'); } });
  await assert.rejects(unavailable.refreshBusinessModules(), /offline/);
  const emptyCatalog = new Repository({ get: async () => ({ data: { modules: [] } }) });
  await assert.rejects(emptyCatalog.refreshBusinessModules(), /MODULE_CATALOG_INVALID/);

  const manifestOnly = new Repository({ get: async () => ({ data: { modules: [{
    key: 'pos', priceMonthlyIrr: 4900000,
    catalogProvenance: { priceMeaning: 'module_list_price_not_subscription_plan_price' }
  }] } }) });
  const modules = await manifestOnly.refreshBusinessModules();
  assert.equal(modules[0].defaultPriceToman, null);
  const approvedCatalog = new Repository({ get: async () => ({ data: { modules: [{
    key: 'pos', priceMonthlyIrr: 1230000,
    catalogProvenance: { priceMeaning: 'approved_customer_tariff' }
  }] } }) });
  assert.equal((await approvedCatalog.refreshBusinessModules())[0].defaultPriceToman, 123000);
});

test('global emergency controls remain disabled until Control Plane confirms tenant-wide fanout', async () => {
  const sandbox = {
    GodModeAppMode: { isProduction: () => true },
    console: { warn() {} },
    ControlPlaneClient: { get: async () => ({
      data: [],
      capabilities: { globalMutationsAvailable: false, reason: 'GLOBAL_KILLSWITCH_FANOUT_NOT_IMPLEMENTED' }
    }) }
  };
  vm.runInNewContext(read(`${frontend}/js/godmode/domain/commercial/repository.js`), sandbox);
  const states = await sandbox.CommercialRepository.listGlobalKillswitches();
  assert.equal(states.__capabilities.globalMutationsAvailable, false);

  const pageSandbox = {
    __SALSA_RUNTIME_CONFIG__: { environment: 'production' },
    GodModeAppMode: { isProduction: () => true },
    CommercialRepository: {
      listPlans: async () => [],
      getBillingExceptions: async () => [],
      listGlobalKillswitches: async () => states,
      getPendingActivationInvoices: async () => [],
      getAllInvoices: async () => [],
      getCommercialPulseMetrics: async () => ({ dataStatus: 'unavailable' }),
      getTaxSummary: async () => ({ dataStatus: 'unavailable' }),
      listSubscriptions: async () => []
    },
    EntitlementsRepository: {
      refreshBusinessModules: async () => [{
        key: 'pos', nameFa: 'صندوق', icon: '▣', lifecycle: 'ga', commercialState: 'addon',
        defaultPriceToman: 490000, catalogProvenance: { priceMeaning: 'module_list_price_not_subscription_plan_price' },
        descriptionFa: 'صندوق فروش', technicalFeatures: [], controllable: true
      }, {
        key: 'future', nameFa: 'قابلیت آینده', icon: '✦', lifecycle: 'planned', commercialState: 'addon',
        defaultPriceToman: null, catalogProvenance: { priceMeaning: 'approved_customer_tariff' },
        descriptionFa: 'قیمت هنوز ثبت نشده', technicalFeatures: [], controllable: true
      }]
    },
    RestaurantsRepository: { listRestaurants: async () => ({ restaurants: [] }) }
  };
  vm.runInNewContext(read(`${frontend}/js/godmode/pages/commercial/commercial.js`), pageSandbox);
  const html = await pageSandbox.renderGodModeCommercial({ params: { section: 'modules' } });
  assert.match(html, /توقف سراسری هنوز عملیاتی نیست/);
  assert.match(html, /پخش توقف به همهٔ رستوران‌ها هنوز عملیاتی نیست/);
  assert.match(html, /قیمت مصوب ثبت نشده/);
  assert.doesNotMatch(html, /۴۹۰٬۰۰۰ تومان \/ ماه/);
  assert.doesNotMatch(html, /۰ تومان \/ ماه/);
  assert.doesNotMatch(html, /openGlobalKillSwitchModal\('pos'\)/);
});

test('a reserved development owner cannot authenticate the production Super Admin', async () => {
  const nodes = {
    '.header-user-name': { textContent: '' },
    '.user-subtitle': { textContent: '' },
    '.header-user-avatar': { textContent: '' }
  };
  const attributes = {};
  const chip = {
    querySelector: selector => nodes[selector],
    setAttribute: (name, value) => { attributes[name] = value; }
  };
  const badge = { className: '', innerHTML: '' };
  const sandbox = {
    __SALSA_RUNTIME_CONFIG__: { environment: 'production', devSessionEnabled: false },
    ControlPlaneClient: {
      bootstrapSession: async () => ({ ok: true, principal: {
        email: 'dev_owner@neem.internal', full_name: 'Local Dev Owner', role: 'platform_owner'
      } })
    },
    document: { getElementById: id => id === 'header-env-badge' ? badge : id === 'header-user-chip' ? chip : null },
    location: { hash: '' },
    console
  };
  vm.runInNewContext(read(`${frontend}/js/godmode/app/bootstrap.js`), sandbox);
  sandbox.GodModeBootstrap._setHeaderSessionStatus(true, {
    email: 'dev_owner@neem.internal', full_name: 'Local Dev Owner', role: 'platform_owner'
  });
  assert.equal(nodes['.header-user-name'].textContent, 'Local Dev Owner');
  assert.match(nodes['.user-subtitle'].textContent, /dev_owner@neem\.internal.*نشست توسعه/);

  const bootstrap = sandbox.GodModeBootstrap;
  let deniedMessage = '';
  bootstrap._renderLoadingBarrier = () => {};
  bootstrap._renderAccessDenied = message => { deniedMessage = message; };
  const result = await bootstrap.init();
  assert.equal(result.state, sandbox.BootstrapState.ACCESS_DENIED);
  assert.match(deniedMessage, /حساب توسعه‌ای است/);
});

test('commercial production view shows unknowns and disables global controls when their source is unavailable', async () => {
  const failure = async () => { throw new Error('offline'); };
  const sandbox = {
    __SALSA_RUNTIME_CONFIG__: { environment: 'production' },
    GodModeAppMode: { isProduction: () => true },
    CommercialRepository: {
      listPlans: async () => [],
      getBillingExceptions: failure,
      listGlobalKillswitches: failure,
      getPendingActivationInvoices: failure,
      getAllInvoices: failure,
      getCommercialPulseMetrics: () => ({ dataStatus: 'unavailable' }),
      getTaxSummary: async () => ({ grossInvoicedToman: null, collectedVatToman: null, moadianStatus: 'unavailable' }),
      listSubscriptions: async () => []
    },
    EntitlementsRepository: {
      refreshBusinessModules: async () => [{
        key: 'pos', nameFa: 'صندوق', icon: '▣', lifecycle: 'ga', commercialState: 'addon', defaultPriceToman: 290000,
        catalogProvenance: { priceMeaning: 'module_list_price_not_subscription_plan_price' },
        descriptionFa: 'ماژول نمونهٔ کاتالوگ', technicalFeatures: [], controllable: true
      }]
    },
    RestaurantsRepository: { listRestaurants: async () => ({ restaurants: [] }) }
  };
  vm.runInNewContext(read(`${frontend}/js/godmode/pages/commercial/commercial.js`), sandbox);

  const html = await sandbox.renderGodModeCommercial({ params: { section: 'modules' } });
  assert.match(html, /بعضی اطلاعات از کنترل‌پلین دریافت نشد/);
  assert.match(html, /نامشخص/);
  assert.match(html, /توقف سراسری هنوز عملیاتی نیست/);
  assert.match(html, /disabled title="وضعیت کلید کنترل از کنترل‌پلین دریافت نشد"/);
  assert.match(html, /قیمت مصوب ثبت نشده/);
  assert.doesNotMatch(html, /داده زنده کنترل‌پلین|تراکنش‌های موفق بانکی شاپرک|0 حساب|بدون مغایرت کشف‌شده/);
});
