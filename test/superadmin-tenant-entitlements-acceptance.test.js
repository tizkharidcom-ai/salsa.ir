'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

const { ControlDataAccess, TenantDataAccess } = require('../server/salsa/data-access');
const {
  createTenantContext,
  runWithTenantContext,
} = require('../server/salsa/tenant-context');
const { TenantResolver } = require('../server/salsa/tenant-resolver');
const quotaService = require('../server/salsa/control-plane/billing/quota-service');
const auditService = require('../server/salsa/control-plane/audit/audit-service');

function registration(tenantId, overrides = {}) {
  return {
    tenant_id: tenantId,
    status: 'active',
    cell_id: 'cell-a',
    database_name: `tenant_${tenantId.replace(/-/g, '_')}`,
    database_provider: 'postgres',
    ...overrides,
  };
}

function controlAccess({ infrastructure = [], verifiedDomains = [], canonical = [], subdomain = [] } = {}) {
  const calls = [];
  const access = new ControlDataAccess({
    query: async (sql, params) => {
      calls.push({ sql, params });
      return {
        rows: [...infrastructure, ...verifiedDomains, ...canonical, ...subdomain],
      };
    },
  });
  return { access, calls };
}

test('registered host resolves only when all domain registries agree on tenant routing', async () => {
  const infra = registration('tenant-alpha', { domain_kind: 'custom' });
  const verified = registration('tenant-alpha', { domain_kind: 'custom' });
  const canonical = registration('tenant-alpha', { domain_kind: 'canonical_domain' });
  const { access, calls } = controlAccess({
    infrastructure: [infra],
    verifiedDomains: [verified],
    canonical: [canonical],
  });

  const resolved = await access.findTenantByHost('cafe.example.com');
  assert.equal(resolved, infra, 'existing source precedence is retained after agreement is established');
  assert.equal(calls.length, 1, 'all registration sources are checked in one database snapshot');
  assert.match(calls[0].sql, /UNION ALL[\s\S]*FROM neem_domains[\s\S]*FROM neem_tenants/);

  const resolver = new TenantResolver({ controlDataAccess: access, logger: { error() {} } });
  const context = await resolver.resolveHost('cafe.example.com');
  assert.equal(context.tenantId, 'tenant-alpha');
  assert.equal(context.databaseName, 'tenant_tenant_alpha');
  assert.equal(Object.isFrozen(context), true);
});

test('conflicting tenant registrations for one host fail closed before request context is created', async () => {
  const { access } = controlAccess({
    infrastructure: [registration('tenant-alpha')],
    verifiedDomains: [registration('tenant-beta')],
  });
  await assert.rejects(
    () => access.findTenantByHost('cafe.example.com'),
    /TENANT_HOST_AMBIGUOUS/
  );

  const resolver = new TenantResolver({ controlDataAccess: access, logger: { error() {} } });
  const req = { headers: { host: 'cafe.example.com' } };
  let nextCalled = false;
  const res = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  await resolver.middleware()(req, res, () => { nextCalled = true; });

  assert.equal(res.statusCode, 503);
  assert.equal(res.body.error, 'tenant_resolution_unavailable');
  assert.equal(nextCalled, false);
  assert.equal(req.tenantContext, undefined);
});

test('same tenant with conflicting database bindings is rejected as ambiguous', async () => {
  const { access } = controlAccess({
    infrastructure: [registration('tenant-alpha')],
    verifiedDomains: [registration('tenant-alpha', {
      database_name: 'tenant_tenant_alpha_test',
    })],
  });

  await assert.rejects(
    () => access.findTenantByHost('cafe.example.com'),
    /TENANT_REGISTRATION_AMBIGUOUS/
  );
});

test('platform subdomain alias cannot override a conflicting registered canonical domain', async () => {
  const { access } = controlAccess({
    canonical: [registration('tenant-alpha')],
    subdomain: [registration('tenant-beta')],
  });

  await assert.rejects(
    () => access.findTenantByHost('tenant-alpha.salsa.ir'),
    /TENANT_HOST_AMBIGUOUS/
  );
});

test('tenant data access permits its authenticated scope and rejects a different tenant scope', async () => {
  let poolLookups = 0;
  let queries = 0;
  const manager = {
    async getPoolForContext(context) {
      poolLookups += 1;
      assert.equal(context.tenantId, 'tenant-alpha');
      return { query: async () => { queries += 1; return { rows: [{ ok: true }] }; } };
    },
  };
  const access = new TenantDataAccess({
    manager,
    context: createTenantContext({ tenantId: 'tenant-alpha' }),
  });

  const alphaContext = createTenantContext({ tenantId: 'tenant-alpha' });
  const result = await runWithTenantContext(alphaContext, () => access.query('SELECT 1'));
  assert.deepEqual(result.rows, [{ ok: true }]);

  const betaContext = createTenantContext({ tenantId: 'tenant-beta' });
  await assert.rejects(
    () => runWithTenantContext(betaContext, () => access.query('SELECT 1')),
    /TENANT_BOUNDARY_VIOLATION/
  );
  assert.equal(poolLookups, 1, 'cross-tenant request is denied before selecting a database pool');
  assert.equal(queries, 1, 'cross-tenant request never reaches tenant SQL');
});

test('platform quota updates serialize by tenant and commit together with their audit event', async t => {
  const original = {
    db: quotaService.db,
    fallback: quotaService.allowInMemoryFallback,
    memory: new Map(quotaService.inMemoryQuotas),
    recordEvent: auditService.recordEvent
  };
  let quotaRow = {
    tenant_id: 'tenant-alpha', max_branches: 1, max_devices: 2, max_users: 5,
    max_orders_monthly: -1, max_storage_mb: 5000, max_sms_monthly: 1000,
    current_branches: 1, current_devices: 1, current_users: 2,
    current_orders_monthly: 9, current_storage_mb: 250, current_sms_monthly: 30
  };
  let beforeTransaction;
  let failAudit = false;
  const statements = [];
  let auditEvent;
  const pool = {
    async connect() {
      return {
        async query(sql, params = []) {
          const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase();
          statements.push(normalized);
          if (normalized === 'begin') {
            beforeTransaction = { ...quotaRow };
            return { rows: [] };
          }
          if (normalized === 'commit') return { rows: [] };
          if (normalized === 'rollback') {
            quotaRow = beforeTransaction;
            return { rows: [] };
          }
          if (normalized.startsWith('select pg_advisory_xact_lock')) return { rows: [] };
          if (normalized.startsWith('select * from neem_billing_quotas')) return { rows: [{ ...quotaRow }] };
          if (normalized.startsWith('insert into neem_billing_quotas')) {
            quotaRow = {
              ...quotaRow,
              max_branches: params[1], max_devices: params[2], max_users: params[3],
              max_orders_monthly: params[4], max_storage_mb: params[5], max_sms_monthly: params[6]
            };
            return { rows: [{ ...quotaRow }] };
          }
          throw new Error(`unexpected quota query: ${normalized}`);
        },
        release() {}
      };
    }
  };
  quotaService.db = pool;
  quotaService.allowInMemoryFallback = false;
  auditService.recordEvent = async event => {
    auditEvent = event;
    if (failAudit) throw new Error('audit unavailable');
  };
  t.after(() => {
    quotaService.db = original.db;
    quotaService.allowInMemoryFallback = original.fallback;
    quotaService.inMemoryQuotas.clear();
    for (const [key, value] of original.memory) quotaService.inMemoryQuotas.set(key, value);
    auditService.recordEvent = original.recordEvent;
  });

  const updated = await quotaService.setQuotas('tenant-alpha', { maxUsers: 10 }, 'platform-principal-7');
  assert.equal(updated.maxUsers, 10);
  assert.ok(statements.some(sql => sql.startsWith('select pg_advisory_xact_lock')));
  assert.equal(statements.at(-1), 'commit');
  assert.equal(auditEvent.actorId, 'platform-principal-7');
  assert.equal(auditEvent.database !== null && typeof auditEvent.database.query, 'function');
  assert.equal(auditEvent.metadata.previous.maxUsers, 5);

  failAudit = true;
  await assert.rejects(
    () => quotaService.setQuotas('tenant-alpha', { maxUsers: 12 }, 'platform-principal-7'),
    /audit unavailable/
  );
  assert.equal(quotaRow.max_users, 10, 'audit failure rolls back quota persistence');
  assert.equal(statements.at(-1), 'rollback');
});
