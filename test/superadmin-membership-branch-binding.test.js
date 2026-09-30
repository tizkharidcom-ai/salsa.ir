'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const identityModule = require('../server/salsa/control-plane/tenant/identity-service');
const invitationModule = require('../server/salsa/control-plane/tenant/invitation-service');
const root = path.join(__dirname, '..');

function fakeIdentityDatabase({ identities = [], memberships = [], raceIdentity = null } = {}) {
  const calls = [];
  const state = { identities: identities.map((row) => ({ ...row })), memberships: memberships.map((row) => ({ ...row })) };
  return {
    calls,
    state,
    async query(sql, params = []) {
      const normalized = String(sql).replace(/\s+/g, ' ').trim().toLowerCase();
      calls.push({ sql: normalized, params });
      if (normalized.includes('from neem_tenant_identities') && normalized.includes('where lower(email) = $1')) {
        const email = String(params[0] || '').toLowerCase();
        return { rows: state.identities.filter((item) => String(item.email || '').toLowerCase() === email) };
      }
      if (normalized.startsWith('insert into neem_tenant_identities')) {
        if (raceIdentity) return { rows: [{ ...raceIdentity }] };
        const item = {
          id: params[0], display_name: params[1], email: params[2], phone: params[3],
          identity_type: params[4], status: params[5], mfa_enabled: Boolean(params[6]),
        };
        state.identities.push(item);
        return { rows: [item] };
      }
      if (normalized.includes('from neem_tenant_memberships')) {
        if (normalized.includes('where m.tenant_id = $1 and m.identity_id = $2 and m.id = $3')) {
          const row = state.memberships.find((item) => item.tenant_id === params[0]
            && item.identity_id === params[1] && item.id === params[2]);
          if (!row) return { rows: [] };
          const identity = state.identities.find((item) => item.id === row.identity_id) || {};
          return { rows: [{ ...row, identity_type: identity.identity_type, identity_status: identity.status }] };
        }
        const tenantId = params[0];
        const targetId = params[1];
        return { rows: state.memberships.filter((item) => item.tenant_id === tenantId
          && (item.identity_id === targetId || item.id === targetId)) };
      }
      if (normalized.startsWith('insert into neem_tenant_memberships')) {
        const row = {
          id: params[0], tenant_id: params[1], identity_id: params[2], role: params[3],
          branch_scope: params[4], status: params[5], active_sessions: params[6],
        };
        state.memberships.push(row);
        return { rows: [row] };
      }
      if (normalized.startsWith('update neem_tenant_memberships')) {
        const target = params[params.length - 1];
        const row = state.memberships.find((item) => item.tenant_id === params[params.length - 2]
          && (item.id === target || item.identity_id === target));
        if (row) { row.role = params[0]; row.branch_scope = params[1]; }
        return { rows: row ? [row] : [] };
      }
      throw new Error(`Unexpected fake DB query: ${normalized}`);
    },
  };
}

const audit = { async recordEvent() {} };

test('existing restaurant identity cannot be attached to a new tenant by email alone', async () => {
  const db = fakeIdentityDatabase({ identities: [{
    id: 'usr_existing', email: 'staff@example.com', identity_type: 'restaurant_staff', status: 'active',
  }] });
  const service = new identityModule.IdentityService({ db, audit });

  await assert.rejects(service.createMembership({
    tenantId: 'tenant-a', email: 'staff@example.com', displayName: 'Staff',
    role: 'manager', branchScope: 'br_central',
  }), { code: 'IDENTITY_LINK_REQUIRES_VERIFICATION' });
  assert.equal(db.calls.some((call) => call.sql.startsWith('insert into neem_tenant_memberships')), false);
});

test('platform and guest identities remain ineligible for restaurant membership', async () => {
  const db = fakeIdentityDatabase({ identities: [{
    id: 'platform-1', email: 'operator@example.com', identity_type: 'platform_operator', status: 'active',
  }] });
  const service = new identityModule.IdentityService({ db, audit });

  await assert.rejects(service.createMembership({
    tenantId: 'tenant-a', email: 'operator@example.com', displayName: 'Operator',
    role: 'owner', branchScope: 'br_main',
  }), { code: 'IDENTITY_TYPE_CONFLICT' });
  assert.equal(db.calls.some((call) => call.sql.startsWith('insert into neem_tenant_memberships')), false);
});

test('manager membership rejects omitted and wildcard branch scopes but accepts an explicit branch key', async () => {
  const emptyDb = fakeIdentityDatabase();
  const emptyService = new identityModule.IdentityService({ db: emptyDb, audit });
  await assert.rejects(emptyService.createMembership({
    tenantId: 'tenant-a', email: 'manager@example.com', displayName: 'Manager', role: 'manager',
  }), { code: 'BRANCH_SCOPE_REQUIRED' });
  await assert.rejects(emptyService.createMembership({
    tenantId: 'tenant-a', email: 'manager@example.com', displayName: 'Manager', role: 'manager', branchScope: '*',
  }), { code: 'BRANCH_SCOPE_REQUIRES_ASSIGNMENT' });
  assert.equal(emptyDb.calls.length, 0, 'invalid grants fail before identity or membership writes');

  const db = fakeIdentityDatabase();
  const service = new identityModule.IdentityService({ db, audit });
  const created = await service.createMembership({
    tenantId: 'tenant-a', email: 'manager@example.com', displayName: 'Manager', role: 'manager', branchScope: 'BR_CENTRAL',
  });
  assert.equal(created.branch_scope, 'br_central');
  assert.equal(db.state.memberships.length, 1);
});

test('role update without a new scope preserves then validates the prior scope instead of widening it', async () => {
  const db = fakeIdentityDatabase({ memberships: [{
    id: 'mem-manager', tenant_id: 'tenant-a', identity_id: 'usr-manager', role: 'cashier', branch_scope: '*', status: 'active',
  }] });
  const service = new identityModule.IdentityService({ db, audit });
  await assert.rejects(service.updateRole({
    tenantId: 'tenant-a', identityId: 'usr-manager', role: 'manager',
  }), { code: 'BRANCH_SCOPE_REQUIRES_ASSIGNMENT' });
  assert.equal(db.calls.filter((call) => call.sql.startsWith('update neem_tenant_memberships')).length, 0);
});

test('membership authorization checks current identity, membership, tenant, and verified branch mapping', () => {
  const membership = {
    id: 'mem-manager', tenant_id: 'tenant-a', identity_id: 'usr-manager', role: 'manager',
    branch_scope: 'br_central', status: 'active', identity_status: 'active', identity_type: 'restaurant_staff',
  };
  const branchRegistry = [{ tenantId: 'tenant-a', scopeKey: 'br_central', runtimeBranchId: 7, active: true }];
  assert.deepEqual(identityModule.resolveMembershipAccess(membership, {
    tenantId: 'tenant-a', identityId: 'usr-manager', membershipId: 'mem-manager', branchRegistry,
  }), {
    tenantId: 'tenant-a', identityId: 'usr-manager', membershipId: 'mem-manager', role: 'manager',
    branchScope: 'br_central', allowedBranchIds: [7],
  });
  assert.throws(() => identityModule.resolveMembershipAccess({ ...membership, branch_scope: '*' }, {
    tenantId: 'tenant-a', identityId: 'usr-manager', membershipId: 'mem-manager', branchRegistry,
  }), { code: 'BRANCH_SCOPE_REQUIRES_ASSIGNMENT' });
  assert.throws(() => identityModule.resolveMembershipAccess(membership, {
    tenantId: 'tenant-b', identityId: 'usr-manager', membershipId: 'mem-manager', branchRegistry,
  }), { code: 'TENANT_BOUNDARY_VIOLATION' });
  assert.throws(() => identityModule.resolveMembershipAccess(membership, {
    tenantId: 'tenant-a', identityId: 'usr-manager', membershipId: 'mem-manager', branchRegistry: [],
  }), { code: 'BRANCH_SCOPE_MAPPING_UNAVAILABLE' });
  assert.throws(() => identityModule.resolveMembershipAccess({ ...membership, status: 'suspended' }, {
    tenantId: 'tenant-a', identityId: 'usr-manager', membershipId: 'mem-manager', branchRegistry,
  }), { code: 'MEMBERSHIP_INACTIVE' });
});

test('wildcard branch scope is denied for owners until platform branch policy is confirmed', () => {
  const membership = {
    id: 'mem-owner', tenant_id: 'tenant-a', identity_id: 'usr-owner', role: 'owner',
    branch_scope: '*', status: 'active', identity_status: 'active', identity_type: 'restaurant_staff',
  };
  assert.throws(() => identityModule.resolveMembershipAccess(membership, {
    tenantId: 'tenant-a', identityId: 'usr-owner', membershipId: 'mem-owner', branchRegistry: [
      { tenantId: 'tenant-a', scopeKey: 'br_one', runtimeBranchId: 2, active: true },
      { tenantId: 'tenant-a', scopeKey: 'br_two', runtimeBranchId: 9, active: true },
      { tenantId: 'tenant-b', scopeKey: 'br_other', runtimeBranchId: 11, active: true },
    ],
  }), { code: 'BRANCH_SCOPE_REQUIRES_ASSIGNMENT' });
});

test('new owner memberships also require an explicit branch while wildcard policy is unresolved', async () => {
  const db = fakeIdentityDatabase();
  const service = new identityModule.IdentityService({ db, audit });
  await assert.rejects(service.createMembership({
    tenantId: 'tenant-a', email: 'owner@example.com', displayName: 'Owner', role: 'owner', branchScope: '*',
  }), { code: 'BRANCH_SCOPE_REQUIRES_ASSIGNMENT' });
  assert.equal(db.calls.length, 0, 'wildcard must be rejected before identity or membership writes');
});

test('membership reads and role updates normalize tenant ids before querying', async () => {
  const db = fakeIdentityDatabase({ memberships: [{
    id: 'mem-manager', tenant_id: 'tenant-a', identity_id: 'usr-manager', role: 'cashier',
    branch_scope: 'br_central', status: 'active',
  }] });
  const service = new identityModule.IdentityService({ db, audit });
  const updated = await service.updateRole({
    tenantId: ' TENANT-A ', identityId: 'usr-manager', role: 'manager',
  });
  assert.equal(updated.role, 'manager');
  const updateCall = db.calls.find((call) => call.sql.startsWith('update neem_tenant_memberships'));
  assert.equal(updateCall.params[2], 'tenant-a');
  assert.equal(db.calls.some((call) => call.params.includes(' TENANT-A ')), false);
});

test('invalid tenant ids fail before membership queries or writes', async () => {
  const db = fakeIdentityDatabase();
  const service = new identityModule.IdentityService({ db, audit });
  await assert.rejects(service.updateRole({
    tenantId: '*', identityId: 'usr-manager', role: 'manager', branchScope: 'br_central',
  }), { code: 'TENANT_CONTEXT_INVALID' });
  await assert.rejects(service.resolveSessionMembership({
    tenantId: '*', identityId: 'usr-manager', membershipId: 'mem-manager', branchRegistry: [],
  }), { code: 'TENANT_CONTEXT_INVALID' });
  assert.equal(db.calls.length, 0);
});

test('invitation acceptance does not consume a token or claim success without credential provisioning', async () => {
  let queries = 0;
  const service = new invitationModule.InvitationService({
    db: { async query() { queries += 1; return { rows: [] }; } },
    audit,
  });
  await assert.rejects(service.acceptInvitation('opaque-token', 'correct-horse-battery-staple'), {
    code: 'INVITATION_ACCOUNT_PROVISIONING_UNAVAILABLE', status: 503,
  });
  assert.equal(queries, 0, 'a token stays pending until credentials and membership can be committed together');
});

test('identity membership mutations fail closed until runtime session and branch mapping are wired', () => {
  const routes = fs.readFileSync(path.join(root, 'server/salsa/control-plane/routes/identity-routes.js'), 'utf8');
  for (const [method, route] of [
    ['post', '/invite'],
    ['patch', '/:id/role'],
    ['post', '/:id/suspend'],
    ['post', '/:id/reactivate'],
    ['post', '/:id/revoke'],
    ['delete', '/:id'],
  ]) {
    const escaped = route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const routeStart = new RegExp(`router\\.${method}\\(\\s*['"]${escaped}['"][\\s\\S]{0,320}rejectUnboundTenantIdentityMutation`);
    assert.match(routes, routeStart, `${method.toUpperCase()} ${route} must not claim an effective runtime change`);
  }
  assert.match(routes, /TENANT_IDENTITY_RUNTIME_BINDING_UNAVAILABLE/);
});

test('invitation resend returns an explicit delivery-not-configured response without fabricating success', async () => {
  const routesSource = fs.readFileSync(path.join(root, 'server/salsa/control-plane/routes/identity-routes.js'), 'utf8');
  const start = routesSource.indexOf("router.post(\n  '/invitations/resend'");
  const end = routesSource.indexOf('// 4. Update Role & Scope', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const resendSource = routesSource.slice(start, end);
  assert.match(resendSource, /CREDENTIAL_DELIVERY_NOT_CONFIGURED/);
  assert.doesNotMatch(resendSource, /rejectUnboundTenantIdentityMutation|Date\.now|status:\s*['"]resent['"]/);

  const routes = require('../server/salsa/control-plane/routes/identity-routes');
  const route = routes.stack.find((layer) => layer.route?.path === '/invitations/resend' && layer.route.methods.post);
  assert.ok(route, 'resend route should be registered');
  const handler = route.route.stack.at(-1).handle;
  const response = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  await handler({ body: { invitationId: 'inv_existing', email: 'member@example.com' } }, response);
  assert.equal(response.statusCode, 503);
  assert.equal(response.body.success, false);
  assert.equal(response.body.error.code, 'CREDENTIAL_DELIVERY_NOT_CONFIGURED');
});

test('paired SuperAdmin identity views disclose local preview state and do not claim live session revocation', () => {
  for (const relativePath of [
    'prototype/js/views/gm13-identities.js',
    'superadmin/frontend/js/views/gm13-identities.js',
  ]) {
    const source = fs.readFileSync(path.join(root, relativePath), 'utf8');
    assert.match(source, /ابطال نشست · غیرفعال/);
    assert.match(source, /بدون اتصال|runtime/);
    assert.match(source, /colspan="7"/);
  }
  for (const [prototypePath, frontendPath] of [
    ['prototype/js/views/gm14-access-roles.js', 'superadmin/frontend/js/views/gm14-access-roles.js'],
    ['prototype/js/views/gm27-team.js', 'superadmin/frontend/js/views/gm27-team.js'],
  ]) {
    assert.equal(
      fs.readFileSync(path.join(root, prototypePath), 'utf8'),
      fs.readFileSync(path.join(root, frontendPath), 'utf8'),
      `${frontendPath} must stay in targeted parity with its prototype view`,
    );
  }
  for (const relativePath of [
    'prototype/js/views/gm14-access-roles.js',
    'superadmin/frontend/js/views/gm14-access-roles.js',
  ]) {
    const source = fs.readFileSync(path.join(root, relativePath), 'utf8');
    assert.match(source, /پیش‌نمایش محلی · بدون اتصال به runtime/);
    assert.doesNotMatch(source, /موتور کنترل دسترسی برخط|۱۰۰\/۱۰۰|tnt_westo_demo|usr_owner_reza/);
  }
  for (const relativePath of [
    'prototype/js/views/gm27-team.js',
    'superadmin/frontend/js/views/gm27-team.js',
  ]) {
    const source = fs.readFileSync(path.join(root, relativePath), 'utf8');
    assert.match(source, /پیش‌نمایش محلی تیم پلتفرم/);
    assert.match(source, /ذخیره پیش‌نویس محلی/);
  }
});
