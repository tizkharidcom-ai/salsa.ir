'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {
  createSessionToken,
  createMembershipSessionToken,
  readSessionToken,
  sessionTokenMatchesTenant,
  sessionTokenMatchesMembership,
} = require('../server/session-token');
const { TenantResolver } = require('../server/salsa/tenant-resolver');
const {
  assertCurrentTenant,
  requireTenantContext,
  runWithTenantContext,
  tenantStorage,
} = require('../server/salsa/tenant-context');

const secret = 'test-only-session-signing-secret';

test('session token is signed and bound to the tenant that issued it', () => {
  const tenantAToken = createSessionToken({ phone: '09120000001', tenantId: 'tenant-a', issuedAtMs: 1000 }, secret);
  const claims = readSessionToken(tenantAToken, secret);

  assert.deepEqual(claims, { phone: '09120000001', tenantId: 'tenant-a', principalType: 'tenant_user', ts: 1000 });
  assert.equal(sessionTokenMatchesTenant(claims, 'tenant-a', { requireTenantClaim: true }), true);
  assert.equal(sessionTokenMatchesTenant(claims, 'tenant-b', { requireTenantClaim: true }), false);
  assert.equal(readSessionToken(tenantAToken, 'a-different-secret'), null);
  assert.equal(readSessionToken(`${tenantAToken}tampered`, secret), null);
});

test('membership-bound sessions require and match the exact tenant identity and membership tuple', () => {
  const token = createMembershipSessionToken({
    tenantId: 'tenant-a',
    identityId: 'usr_staff_1',
    membershipId: 'mem_staff_1',
    issuedAtMs: 1000,
  }, secret);
  const claims = readSessionToken(token, secret);

  assert.deepEqual(claims, {
    tenantId: 'tenant-a',
    principalType: 'tenant_user',
    ts: 1000,
    identityId: 'usr_staff_1',
    membershipId: 'mem_staff_1',
  });
  assert.equal(sessionTokenMatchesMembership(claims, {
    tenantId: 'tenant-a', identityId: 'usr_staff_1', membershipId: 'mem_staff_1',
  }), true);
  assert.equal(sessionTokenMatchesMembership(claims, {
    tenantId: 'tenant-b', identityId: 'usr_staff_1', membershipId: 'mem_staff_1',
  }), false);
  assert.equal(sessionTokenMatchesMembership(claims, {
    tenantId: 'tenant-a', identityId: 'usr_staff_2', membershipId: 'mem_staff_1',
  }), false);
  assert.equal(sessionTokenMatchesMembership(claims, {
    tenantId: 'tenant-a', identityId: 'usr_staff_1', membershipId: 'mem_staff_2',
  }), false);
  assert.throws(
    () => createSessionToken({ tenantId: 'tenant-a', identityId: 'usr_staff_1' }, secret),
    /both identityId and membershipId/,
  );
  assert.equal(readSessionToken(`${Buffer.from(JSON.stringify({
    tenantId: 'tenant-a', principalType: 'tenant_user', ts: 1000, identityId: 'usr_staff_1',
  })).toString('base64url')}.${crypto.createHmac('sha256', secret).update(Buffer.from(JSON.stringify({
    tenantId: 'tenant-a', principalType: 'tenant_user', ts: 1000, identityId: 'usr_staff_1',
  })).toString('base64url')).digest('base64url')}`, secret), null,
  'a signed token with only one membership claim is malformed');
});

test('legacy tokens without tenant identity are never accepted in multi-tenant mode', () => {
  const payload = Buffer.from(JSON.stringify({ phone: '09120000001', ts: 1000 })).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  const legacyClaims = readSessionToken(`${payload}.${signature}`, secret);

  assert.ok(legacyClaims);
  assert.equal(sessionTokenMatchesTenant(legacyClaims, 'tenant-a'), false);
  assert.equal(sessionTokenMatchesTenant(legacyClaims, 'tenant-a', { requireTenantClaim: false }), false,
    'legacy opt-out cannot make an unbound token valid for every tenant');
});

test('tenant session tokens cannot be created or accepted as platform identities', () => {
  assert.throws(
    () => createSessionToken({ phone: '09120000001', tenantId: 'tenant-a', principalType: 'platform_admin' }, secret),
    /cannot represent platform identities/,
  );

  const payload = Buffer.from(JSON.stringify({
    phone: '09120000001', tenantId: 'tenant-a', principalType: 'platform_admin', ts: 1000,
  })).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  const platformClaims = readSessionToken(`${payload}.${signature}`, secret);
  assert.equal(platformClaims, null);
  assert.equal(sessionTokenMatchesTenant({ tenantId: 'tenant-a', principalType: 'platform_admin' }, 'tenant-a'), false);
});

test('frozen or directly installed tenant contexts cannot bind one tenant to another tenant database', async () => {
  const forgedContext = Object.freeze({
    tenantId: 'tenant-a',
    tenantSlug: 'tenant-a',
    databaseName: 'tenant_tenant_b',
    databaseProvider: 'postgres',
    status: 'active',
  });

  assert.throws(
    () => runWithTenantContext(forgedContext, () => assertCurrentTenant('tenant-a')),
    /TENANT_BOUNDARY_VIOLATION/,
  );
  assert.throws(
    () => tenantStorage.run(forgedContext, () => requireTenantContext()),
    /TENANT_BOUNDARY_VIOLATION/,
  );
  assert.throws(
    () => runWithTenantContext({ tenantId: 'tenant-a', isPlatform: true }, () => assertCurrentTenant('tenant-a')),
    /TENANT_CONTEXT_INVALID/,
    'platform identity cannot be represented by a restaurant tenant context',
  );
});

test('session tokens reject malformed claims, oversized payloads, and future issue times', () => {
  assert.throws(
    () => createSessionToken({ phone: '09120000001', tenantId: '' }, secret),
    /canonical tenant id/,
  );
  assert.throws(
    () => createSessionToken({ phone: '09120000001', tenantId: 'tenant-a', issuedAtMs: Date.now() + 60_000 }, secret),
    /issue time/,
  );

  const signClaims = (claims) => {
    const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
    const signature = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
    return `${payload}.${signature}`;
  };
  assert.equal(readSessionToken(signClaims({
    phone: '09120000001', tenantId: 'tenant-a', ts: Date.now() + 60_000,
  }), secret), null);
  assert.equal(readSessionToken(signClaims({
    phone: '09120000001', tenantId: 'invalid tenant', ts: 1000,
  }), secret), null);
  assert.equal(readSessionToken('x'.repeat(5000), secret), null);
  assert.equal(sessionTokenMatchesTenant({ tenantId: 'TENANT-A', principalType: 'tenant_user' }, 'tenant-a'), true);
  assert.equal(sessionTokenMatchesTenant({ tenantId: '' }, 'tenant-a', { requireTenantClaim: true }), false);
  assert.equal(sessionTokenMatchesTenant({ tenantId: '' }, 'tenant-a', { requireTenantClaim: false }), false);
  assert.equal(sessionTokenMatchesTenant({ tenantId: 'invalid tenant' }, 'tenant-a', { requireTenantClaim: false }), false);
  assert.equal(sessionTokenMatchesTenant({}, 'tenant-a', { requireTenantClaim: false }), false);
  assert.equal(sessionTokenMatchesTenant({ tenantId: 'tenant-a' }, 'not valid', { requireTenantClaim: true }), false);
});

test('tenant-control database errors return 503 and never fall back to a configured tenant', async () => {
  const resolver = new TenantResolver({
    controlDataAccess: {
      async findTenantByHost() { throw new Error('control database unavailable'); },
    },
    defaultTenant: 'tenant-a',
    logger: { error() {} },
  });
  const req = { headers: { host: 'bistro-a.salsa.ir' } };
  const res = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  let continued = false;
  await resolver.middleware()(req, res, () => { continued = true; });
  assert.equal(continued, false);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.error, 'tenant_resolution_unavailable');
  assert.equal(req.tenantContext, undefined);
});

test('server authentication resolves and checks the current request tenant before user lookup', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'server', 'server.js'), 'utf8');
  assert.match(source, /function makeToken\(phone, tenantId = TENANT_CONFIG\.tenantId\)/);
  assert.match(source, /function parseToken\(token, expectedTenantId\)/);
  assert.match(source, /requireTenantClaim:\s*TENANT_INFRASTRUCTURE_ENABLED/);
  assert.match(source, /const data = parseToken\(token, tenantId\);[\s\S]{0,220}const user = db\.users\.find/);
  assert.match(source, /makeToken\(phone, req\.tenantId \|\| req\.tenant\?\.tenantId/);
});
