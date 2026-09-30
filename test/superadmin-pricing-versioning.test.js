'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const auditService = require('../server/salsa/control-plane/audit/audit-service');
const { PricingService } = require('../server/salsa/control-plane/billing/pricing-service');
const catalogService = require('../superadmin/backend/policy/catalog-service');

function rowFromPlan(plan) {
  return { ...plan };
}

function makePricingDb() {
  const db = {
    state: { plans: [], versions: [], operations: [] },
    locks: new Map(),
    async query(sql, params) { return this._run(sql, params, null); },
    async connect() {
      const client = {
        snapshot: null,
        unlock: null,
        query: (sql, params) => db._run(sql, params, client),
        release() { client.unlock?.(); client.unlock = null; }
      };
      return client;
    },
    async _run(sql, params = [], client) {
      const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase();
      if (normalized === 'begin') return { rows: [] };
      if (normalized === 'commit') { client.snapshot = null; client.unlock?.(); client.unlock = null; return { rows: [] }; }
      if (normalized === 'rollback') {
        if (client.snapshot) db.state = client.snapshot;
        client.snapshot = null;
        client.unlock?.(); client.unlock = null;
        return { rows: [] };
      }
      if (normalized.startsWith('select pg_advisory_xact_lock')) {
        const key = params[0];
        const previous = db.locks.get(key) || Promise.resolve();
        let unlock;
        const gate = new Promise(resolve => { unlock = resolve; });
        const tail = previous.then(() => gate);
        db.locks.set(key, tail);
        await previous;
        client.unlock = () => { unlock(); if (db.locks.get(key) === tail) db.locks.delete(key); };
        client.snapshot = structuredClone(db.state);
        return { rows: [] };
      }
      if (normalized.startsWith('select operation_type, request_hash, result')) {
        const row = db.state.operations.find(item => item.operation_key === params[0]);
        return { rows: row ? [{ operation_type: row.operation_type, request_hash: row.request_hash, result: row.result }] : [] };
      }
      if (normalized.startsWith('insert into neem_billing_plan_operations')) {
        db.state.operations.push({ operation_key: params[0], operation_type: params[1], request_hash: params[2], actor_id: params[3], result: JSON.parse(params[4]) });
        return { rows: [] };
      }
      if (normalized.startsWith('insert into neem_billing_plans')) {
        const existing = db.state.plans.find(row => row.plan_code === params[0]);
        if (normalized.includes('do nothing')) {
          if (!existing) db.state.plans.push({ plan_code: params[0], is_custom: false, custom_tenant_id: null });
          return { rows: [] };
        }
        if (existing && (!existing.is_custom || existing.custom_tenant_id !== params[10])) return { rows: [] };
        const planRow = {
          plan_code: params[0], name_fa: params[1], base_price_monthly_rials: params[2],
          included_branches: params[3], included_devices: params[4], features: JSON.parse(params[5]),
          description_fa: params[6], included_users: params[7], quotas: JSON.parse(params[8]),
          version: params[9], is_custom: true, custom_tenant_id: params[10]
        };
        if (existing) Object.assign(existing, planRow); else db.state.plans.push(planRow);
        return { rows: [{ plan_code: params[0] }] };
      }
      if (normalized.startsWith('insert into neem_billing_plan_versions')) {
        if (normalized.includes("values ($1, $2, 'draft'")) {
          const [planCode, version, nameFa, descriptionFa, price, branches, devices, users, features, quotas, actorId] = params;
          const existing = db.state.versions.find(row => row.plan_code === planCode && row.version === version);
          if (existing && (existing.state !== 'draft' || existing.is_custom)) return { rows: [] };
          const row = existing || { plan_code: planCode, version, created_at: new Date().toISOString() };
          Object.assign(row, {
            state: 'draft', is_custom: false, custom_tenant_id: null, name_fa: nameFa,
            description_fa: descriptionFa, base_price_monthly_rials: price,
            included_branches: branches, included_devices: devices, included_users: users,
            included_features: JSON.parse(features), quotas: JSON.parse(quotas), created_by: actorId,
            updated_by: actorId, published_at: null, effective_from: null, effective_to: null,
            updated_at: new Date().toISOString()
          });
          if (!existing) db.state.versions.push(row);
          return { rows: [rowFromPlan(row)] };
        }
        const [planCode, version, tenantId, nameFa, descriptionFa, price, branches, devices, users, features, quotas, effectiveFrom, actorId] = params;
        const row = {
          plan_code: planCode, version, state: 'published', is_custom: true, custom_tenant_id: tenantId,
          name_fa: nameFa, description_fa: descriptionFa, base_price_monthly_rials: price,
          included_branches: branches, included_devices: devices, included_users: users,
          included_features: JSON.parse(features), quotas: JSON.parse(quotas),
          published_at: effectiveFrom, effective_from: effectiveFrom, effective_to: null,
          created_by: actorId, updated_by: actorId, created_at: effectiveFrom, updated_at: effectiveFrom
        };
        db.state.versions.push(row);
        return { rows: [rowFromPlan(row)] };
      }
      if (normalized.startsWith('select version from neem_billing_plan_versions')) {
        return { rows: db.state.versions.filter(row => row.plan_code === params[0] && row.is_custom && row.custom_tenant_id === params[1]).map(row => ({ version: row.version })) };
      }
      if (normalized.startsWith('select version, effective_from from neem_billing_plan_versions')) {
        const rows = db.state.versions.filter(item => item.plan_code === params[0] && item.state === 'published' && item.effective_from >= params[1]).sort((a, b) => a.effective_from.localeCompare(b.effective_from));
        return { rows: rows.length ? [{ version: rows[0].version, effective_from: rows[0].effective_from }] : [] };
      }
      if (normalized.startsWith('select plan_code, version, state, is_custom')) {
        if (normalized.includes("where plan_code = $1 and state = 'draft' and is_custom = false")) {
          const row = db.state.versions.filter(item => item.plan_code === params[0] && item.state === 'draft' && !item.is_custom).sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
          return { rows: row ? [rowFromPlan(row)] : [] };
        }
        let rows = db.state.versions;
        if (normalized.includes('where plan_code = $1')) rows = rows.filter(row => row.plan_code === params[0]);
        if (normalized.includes('and (not is_custom or custom_tenant_id = $2)')) rows = rows.filter(row => !row.is_custom || row.custom_tenant_id === params[1]);
        if (normalized.includes('and ($3::text is null or version = $3)') && params[2]) rows = rows.filter(row => row.version === params[2]);
        if (normalized.includes('and (not is_custom or ($2::boolean and custom_tenant_id = $3))')) rows = rows.filter(row => !row.is_custom || (params[1] && row.custom_tenant_id === params[2]));
        const historyQuery = normalized.includes('order by created_at desc, version desc');
        if (!historyQuery) {
          const time = new Date(normalized.includes('effective_from <= $4') ? params[3] : params[4]);
          rows = rows.filter(row => row.state === 'published'
            ? new Date(row.effective_from) <= time && (!row.effective_to || new Date(row.effective_to) > time)
            : Boolean(params[0] === true || params[3] === true));
        }
        if (normalized.includes('order by (state =')) rows.sort((a, b) => (b.state === 'draft') - (a.state === 'draft'));
        if (normalized.includes('order by is_custom')) rows.sort((a, b) => Number(a.is_custom) - Number(b.is_custom));
        if (normalized.includes('limit 1')) rows = rows.slice(0, 1);
        return { rows: rows.map(rowFromPlan) };
      }
      if (normalized.startsWith('select count(*)::int as count from neem_billing_subscriptions')) return { rows: [{ count: 2 }] };
      if (normalized.startsWith('update neem_billing_plan_versions set effective_to')) {
        const [planCode, tenantOrDate, maybeDate] = params;
        const custom = maybeDate !== undefined;
        const tenantId = custom ? tenantOrDate : null;
        const effectiveAt = custom ? maybeDate : tenantOrDate;
        for (const row of db.state.versions) {
          if (row.plan_code === planCode && row.state === 'published' && (!custom || row.custom_tenant_id === tenantId)
            && row.effective_from < effectiveAt && (!row.effective_to || row.effective_to > effectiveAt)) row.effective_to = effectiveAt;
        }
        return { rows: [] };
      }
      if (normalized.startsWith("update neem_billing_plan_versions set state = 'published'")) {
        const [planCode, effectiveFrom, publishedAt, actorId, version] = params;
        const row = db.state.versions.find(item => item.plan_code === planCode && item.version === version && item.state === 'draft');
        if (!row) return { rows: [] };
        Object.assign(row, { state: 'published', published_at: publishedAt, effective_from: effectiveFrom, effective_to: null, updated_by: actorId, updated_at: publishedAt });
        return { rows: [rowFromPlan(row)] };
      }
      if (normalized.startsWith('update neem_billing_plans set name_fa')) return { rows: [] };
      throw new Error(`Unexpected pricing test SQL: ${normalized}`);
    }
  };
  return db;
}

function seedStandardPlan(db) {
  const effectiveFrom = '2026-09-01T00:00:00.000Z';
  const plan = {
    plan_code: 'starter', version: '1.0.0', state: 'published', is_custom: false,
    custom_tenant_id: null, name_fa: 'پلن پایه', description_fa: 'نسخه اولیه',
    base_price_monthly_rials: 45000000, included_branches: 1, included_devices: 2,
    included_users: 5, included_features: ['core.workspace'], quotas: { maxBranches: 1 },
    published_at: effectiveFrom, effective_from: effectiveFrom, effective_to: null,
    created_at: effectiveFrom, updated_at: effectiveFrom
  };
  db.state.plans.push({ plan_code: 'starter', is_custom: false });
  db.state.versions.push(plan);
}

test('versioned plans use PostgreSQL as the quote authority and preserve effective history across service instances', async t => {
  const originalAudit = auditService.recordEvent;
  const events = [];
  auditService.recordEvent = async event => { events.push(event); return {}; };
  t.after(() => { auditService.recordEvent = originalAudit; });
  const db = makePricingDb();
  seedStandardPlan(db);
  let now = '2026-09-24T10:00:00.000Z';
  const first = new PricingService({ db, now: () => new Date(now) });
  const secondProcess = new PricingService({ db, now: () => new Date(now) });
  const draft = await first.createDraftPlan({
    planCode: 'starter', version: '1.1.0', nameFa: 'پلن پایه به‌روز',
    basePriceMonthlyRials: 50000000, includedBranches: 1, includedDevices: 2,
    includedUsers: 5, includedFeatures: ['core.workspace'], actorId: 'platform-1',
    actorRole: 'platform_owner', idempotencyKey: 'draft-starter-v110'
  });
  assert.equal(draft.isDraft, true);
  const effectiveFrom = '2026-09-25T00:00:00.000Z';
  const published = await first.publishPlan('starter', {
    effectiveFrom, actorId: 'platform-1', actorRole: 'platform_owner', idempotencyKey: 'publish-starter-v110'
  });
  assert.equal(published.impactedTenantsCount, 2);
  assert.equal(published.plan.version, '1.1.0');
  assert.equal(events.length, 2);
  assert.ok(events.every(event => event.database), 'audit is sent through the mutation transaction client');

  const beforeActivation = await secondProcess.calculateQuote({ planCode: 'starter' });
  assert.equal(beforeActivation.planVersion, '1.0.0');
  now = effectiveFrom;
  const afterActivation = await secondProcess.calculateQuote({ planCode: 'starter' });
  assert.equal(afterActivation.planVersion, '1.1.0');
  assert.equal(afterActivation.finalTotalRials, 55000000);
  assert.equal(afterActivation.pricingSource, 'postgres_plan_version');
  await assert.rejects(
    () => secondProcess.calculateQuote({ planCode: 'starter', planVersion: '1.0.0' }),
    error => error.code === 'PRICING_VERSION_STALE'
  );
  const history = await secondProcess.getPlanVersions('starter');
  assert.equal(history.length, 2);
  assert.equal(history.find(row => row.version === '1.0.0').effectiveTo, effectiveFrom);

  const replay = await secondProcess.createDraftPlan({
    planCode: 'starter', version: '1.1.0', nameFa: 'پلن پایه به‌روز',
    basePriceMonthlyRials: 50000000, includedBranches: 1, includedDevices: 2,
    includedUsers: 5, includedFeatures: ['core.workspace'], actorId: 'platform-1',
    actorRole: 'platform_owner', idempotencyKey: 'draft-starter-v110'
  });
  assert.equal(replay.idempotentReplay, true);
  assert.equal(events.length, 2, 'idempotent replay does not duplicate the audit event');
});

test('paid add-ons fail closed without an approved versioned tariff, even when a catalog price exists or is missing', async t => {
  const db = makePricingDb();
  seedStandardPlan(db);
  const service = new PricingService({ db, now: () => new Date('2026-09-24T10:00:00.000Z') });
  const originalGetFeature = catalogService.getFeature;
  const staticFeature = originalGetFeature.call(catalogService, 'orders.pos');
  assert.equal(staticFeature.priceMonthly, 450000, 'the test exercises the legacy feature list amount');

  await assert.rejects(
    () => service.calculateQuote({ planCode: 'starter', addonKeys: ['orders.pos'] }),
    error => error.code === 'PRICING_ADDON_TARIFF_UNAVAILABLE' && /versioned add-on tariff/i.test(error.message)
  );

  catalogService.getFeature = key => {
    const feature = originalGetFeature.call(catalogService, key);
    return key === 'orders.pos' && feature
      ? { ...feature, priceMonthly: undefined, priceMonthlyIrr: undefined }
      : feature;
  };
  t.after(() => { catalogService.getFeature = originalGetFeature; });
  await assert.rejects(
    () => service.calculateQuote({ planCode: 'starter', addonKeys: ['orders.pos'] }),
    error => error.code === 'PRICING_ADDON_TARIFF_UNAVAILABLE' && /not billable sources/i.test(error.message)
  );
});

test('published plan-version price is accepted and its included free features remain zero-charge', async () => {
  const db = makePricingDb();
  seedStandardPlan(db);
  const service = new PricingService({ db, now: () => new Date('2026-09-24T10:00:00.000Z') });

  const quote = await service.calculateQuote({ planCode: 'starter', addonKeys: ['core.workspace'] });
  const includedFeature = quote.lineItems.find(item => item.featureKey === 'core.workspace');

  assert.equal(quote.planVersion, '1.0.0');
  assert.equal(quote.pricingSource, 'postgres_plan_version');
  assert.equal(quote.addonPricingSource, 'postgres_plan_version');
  assert.equal(quote.subtotalRials, 45000000);
  assert.equal(quote.finalTotalRials, 49500000);
  assert.equal(includedFeature.totalRials, 0);
  assert.equal(includedFeature.pricingMeaning, 'included_no_additional_charge');
});

test('changing feature list price does not change a quote for a versioned free entitlement', async t => {
  const db = makePricingDb();
  seedStandardPlan(db);
  const service = new PricingService({ db, now: () => new Date('2026-09-24T10:00:00.000Z') });
  const originalGetFeature = catalogService.getFeature;
  let listPrice = 0;
  catalogService.getFeature = key => {
    const feature = originalGetFeature.call(catalogService, key);
    return key === 'core.workspace' && feature ? { ...feature, priceMonthly: listPrice } : feature;
  };
  t.after(() => { catalogService.getFeature = originalGetFeature; });

  const zeroListPriceQuote = await service.calculateQuote({ planCode: 'starter', addonKeys: ['core.workspace'] });
  listPrice = 90000000;
  const changedListPriceQuote = await service.calculateQuote({ planCode: 'starter', addonKeys: ['core.workspace'] });

  assert.equal(zeroListPriceQuote.finalTotalRials, changedListPriceQuote.finalTotalRials);
  assert.equal(zeroListPriceQuote.subtotalRials, changedListPriceQuote.subtotalRials);
  assert.deepEqual(zeroListPriceQuote.lineItems, changedListPriceQuote.lineItems);
  assert.equal(changedListPriceQuote.lineItems.find(item => item.featureKey === 'core.workspace').totalRials, 0);
});

test('custom plans remain tenant-scoped and audit failure rolls back the plan write', async t => {
  const originalAudit = auditService.recordEvent;
  let rejectAudit = false;
  auditService.recordEvent = async event => {
    assert.ok(event.database);
    if (rejectAudit) throw new Error('simulated audit failure');
    return {};
  };
  t.after(() => { auditService.recordEvent = originalAudit; });
  const db = makePricingDb();
  seedStandardPlan(db);
  const service = new PricingService({ db, now: () => new Date('2026-09-24T10:00:00.000Z') });
  const custom = await service.createCustomPlan({
    tenantId: 'tenant-a', nameFa: 'قرارداد ویژه', version: '1.0.0',
    basePriceMonthlyRials: 72000000, includedFeatures: ['core.workspace'],
    actorId: 'platform-1', actorRole: 'platform_owner'
  });
  assert.equal(custom.isCustom, true);
  assert.equal(custom.customTenantId, 'tenant-a');
  assert.match(custom.planCode, /^custom_[a-f0-9]{24}$/);
  assert.equal((await service.listPlans({ includeCustom: true, tenantId: 'tenant-a' })).some(row => row.planCode === custom.planCode), true);
  assert.equal((await service.listPlans({ includeCustom: true, tenantId: 'tenant-b' })).some(row => row.planCode === custom.planCode), false);
  assert.equal(await service.getPlan(custom.planCode, { tenantId: 'tenant-b' }), null);
  await assert.rejects(() => service.listPlans({ includeCustom: true }), error => error.code === 'TENANT_SCOPE_REQUIRED');
  await assert.rejects(() => service.calculateQuote({ planCode: custom.planCode, tenantId: 'tenant-b' }), error => error.code === 'PRICING_PLAN_UNAVAILABLE');

  const before = db.state.versions.length;
  rejectAudit = true;
  await assert.rejects(() => service.createDraftPlan({
    planCode: 'starter', version: '1.2.0', nameFa: 'نسخه شکست‌خورده',
    basePriceMonthlyRials: 60000000, actorId: 'platform-1', actorRole: 'platform_owner'
  }), /simulated audit failure/);
  assert.equal(db.state.versions.length, before, 'rollback restores plan history when audit fails');
});

test('concurrent admin retries serialize on a plan lock and replay one committed draft', async t => {
  const originalAudit = auditService.recordEvent;
  const events = [];
  auditService.recordEvent = async event => { events.push(event); return {}; };
  t.after(() => { auditService.recordEvent = originalAudit; });
  const db = makePricingDb();
  seedStandardPlan(db);
  const serviceA = new PricingService({ db });
  const serviceB = new PricingService({ db });
  const input = {
    planCode: 'starter', version: '1.1.0', nameFa: 'نسخه همزمان',
    basePriceMonthlyRials: 51000000, actorId: 'platform-1', actorRole: 'platform_owner',
    idempotencyKey: 'concurrent-draft-110'
  };
  const [left, right] = await Promise.all([serviceA.createDraftPlan(input), serviceB.createDraftPlan(input)]);
  assert.equal([left, right].filter(result => result.idempotentReplay).length, 1);
  assert.equal(db.state.versions.filter(row => row.plan_code === 'starter' && row.version === '1.1.0').length, 1);
  assert.equal(events.length, 1);
});
