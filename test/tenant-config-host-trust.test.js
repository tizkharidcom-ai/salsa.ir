'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  classifyHost,
  createDynamicTenantHostMiddleware,
  hostMatchesTenant,
  hostnameFromHostHeader,
  resolveTenantSlugFromRequest,
  tenantHostMiddleware,
} = require('../server/salsa/tenant-config');

function responseRecorder() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    redirect(code, location) { this.statusCode = code; this.location = location; return this; },
  };
}

test('normalizes case, terminal DNS dot, valid port, and IDN hostname', () => {
  assert.equal(hostnameFromHostHeader('  WESTO.SALSA.IR.:4180  '), 'westo.salsa.ir');
  assert.equal(hostnameFromHostHeader('café.example'), 'xn--caf-dma.example');
  assert.equal(classifyHost('WESTO.SALSA.IR.:4180').kind, 'platform_subdomain');
});

test('rejects malformed authorities instead of extracting a tenant from their prefix', () => {
  for (const host of [
    '',
    'westo.salsa.ir:bad',
    'westo.salsa.ir:0',
    'westo.salsa.ir:65536',
    'westo.salsa.ir:',
    'westo.salsa.ir/path',
    'westo.salsa.ir@attacker.test',
    'westo.salsa.ir,attacker.test',
    'westo.salsa.ir\\attacker.test',
    'westo\u00a0.salsa.ir',
    'westo..salsa.ir',
    '127.1',
  ]) {
    assert.equal(hostnameFromHostHeader(host), '', `expected rejection for ${JSON.stringify(host)}`);
    assert.equal(classifyHost(host).kind, 'unknown', `expected unknown classification for ${JSON.stringify(host)}`);
  }
});

test('only a valid single tenant slug is classified as a platform subdomain', () => {
  assert.equal(classifyHost('westo.salsa.ir').tenantId, 'westo');
  assert.equal(classifyHost('two-level.salsa.ir').tenantId, 'two-level');
  assert.equal(classifyHost('a.b.salsa.ir').kind, 'unknown');
  assert.equal(classifyHost('a.salsa.ir').kind, 'unknown');
});

test('keeps legitimate local hosts, local ports, IPv6, and branch subdomains', () => {
  for (const host of ['localhost', 'localhost:4180', '127.0.0.1:4180', '[::1]:4180']) {
    assert.equal(classifyHost(host).kind, 'development', host);
  }
  assert.equal(classifyHost('branch.localhost:4180').tenantId, 'branch');
  assert.equal(resolveTenantSlugFromRequest({ headers: { host: 'branch.localhost:4180' } }), 'branch');
  assert.equal(resolveTenantSlugFromRequest({ headers: { host: 'localhost:4180' } }), 'westo');
});

test('matches allowlisted hosts by hostname while preserving explicitly configured ports', () => {
  assert.equal(hostMatchesTenant('WESTO.SALSA.IR.:4180', { hosts: ['westo.salsa.ir'] }), true);
  assert.equal(hostMatchesTenant('localhost.:4180', { hosts: ['localhost:4180'] }), true);
  assert.equal(hostMatchesTenant('localhost:4181', { hosts: ['localhost:4180'] }), false);
  assert.equal(hostMatchesTenant('westo.salsa.ir:bad', { hosts: ['westo.salsa.ir'] }), false);
});

test('request tenant resolution ignores X-Forwarded-Host unless explicitly trusted', () => {
  const req = { headers: { host: 'branch.salsa.ir', 'x-forwarded-host': 'victim.salsa.ir' } };
  assert.equal(resolveTenantSlugFromRequest(req), 'branch');
  assert.equal(resolveTenantSlugFromRequest(req, { trustForwardedHost: true }), 'victim');
  assert.equal(resolveTenantSlugFromRequest({
    headers: { host: 'branch.salsa.ir', 'x-forwarded-host': 'victim.salsa.ir, attacker.test' },
  }, { trustForwardedHost: true }), 'westo');
});

test('dynamic middleware uses direct Host by default and requires explicit proxy trust', async () => {
  const directReq = { headers: { host: 'branch.salsa.ir:4180', 'x-forwarded-host': 'victim.salsa.ir' } };
  const directRes = responseRecorder();
  let directNext = false;
  await createDynamicTenantHostMiddleware({ baseDomain: 'salsa.ir' })(directReq, directRes, () => { directNext = true; });
  assert.equal(directNext, true);
  assert.equal(directReq.tenantId, 'branch');

  const forwardedReq = { headers: { host: 'branch.salsa.ir', 'x-forwarded-host': 'victim.salsa.ir' } };
  const forwardedRes = responseRecorder();
  let forwardedNext = false;
  await createDynamicTenantHostMiddleware({ baseDomain: 'salsa.ir', trustForwardedHost: true })(
    forwardedReq,
    forwardedRes,
    () => { forwardedNext = true; },
  );
  assert.equal(forwardedNext, true);
  assert.equal(forwardedReq.tenantId, 'victim');
});

test('dynamic middleware fails closed on malformed Host or trusted forwarded authority', async () => {
  for (const headers of [
    { host: 'branch.salsa.ir:bad' },
    { host: 'branch.salsa.ir', 'x-forwarded-host': 'victim.salsa.ir,attacker.test' },
  ]) {
    const req = { headers };
    const res = responseRecorder();
    let nextCalled = false;
    await createDynamicTenantHostMiddleware({ baseDomain: 'salsa.ir', trustForwardedHost: true })(
      req,
      res,
      () => { nextCalled = true; },
    );
    assert.equal(res.statusCode, 421);
    assert.equal(res.body.error, 'invalid_host_header');
    assert.equal(nextCalled, false);
  }
});

test('custom-domain lookup receives a canonical hostname without port or terminal dot', async () => {
  const req = { headers: { host: 'Shop.Example.:4180' } };
  const res = responseRecorder();
  let lookedUpHost = null;
  await createDynamicTenantHostMiddleware({
    baseDomain: 'salsa.ir',
    domainRoutingService: {
      async resolveHostToTenant(host) {
        lookedUpHost = host;
        return { matched: true, tenantId: 'shop', tenantSlug: 'shop' };
      },
    },
  })(req, res, () => {});
  assert.equal(lookedUpHost, 'shop.example');
  assert.equal(req.tenantId, 'shop');
});

test('fixed-tenant middleware does not use a spoofed forwarded host for allowlist matching', () => {
  const config = { tenantId: 'westo', hosts: ['westo.salsa.ir'], enforceHost: true };
  const req = { headers: { host: 'westo.salsa.ir', 'x-forwarded-host': 'attacker.test' } };
  const res = responseRecorder();
  let nextCalled = false;
  tenantHostMiddleware(config, { logger: {} })(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
  assert.equal(req.tenantHostMatched, true);
  assert.equal(req.hostClassification.kind, 'platform_subdomain');
});
