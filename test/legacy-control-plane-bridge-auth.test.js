'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  configuredControlSecret,
  hasControlPlaneBridgeCredential,
  isTrustedLocalControlPlaneOrigin,
} = require('../server/control-plane-bridge-auth');

const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server', 'server.js'), 'utf8');
const runnerSource = fs.readFileSync(path.join(__dirname, '..', 'superadmin', 'run.js'), 'utf8');

test('bridge credentials require a configured long secret and accept only exact header or bearer matches', () => {
  const secret = 'x'.repeat(40);
  assert.equal(configuredControlSecret({ SALSA_CONTROL_SECRET: 'too-short' }), null);
  assert.equal(configuredControlSecret({ SALSA_CONTROL_SECRET: secret }), secret);
  assert.equal(hasControlPlaneBridgeCredential({ headers: {} }, {}), false);
  assert.equal(hasControlPlaneBridgeCredential({ headers: { 'x-salsa-control-secret': secret } }, { SALSA_CONTROL_SECRET: secret }), true);
  assert.equal(hasControlPlaneBridgeCredential({ headers: { 'x-neem-control-secret': secret } }, { NEEM_CONTROL_SECRET: secret }), true);
  assert.equal(hasControlPlaneBridgeCredential({ headers: { authorization: `Bearer ${secret}` } }, { SALSA_CONTROL_SECRET: secret }), true);
  assert.equal(hasControlPlaneBridgeCredential({ headers: { 'x-salsa-control-secret': `${secret}wrong` } }, { SALSA_CONTROL_SECRET: secret }), false);
  assert.equal(hasControlPlaneBridgeCredential({ headers: { 'x-salsa-control-secret': 'dev_secret_salsa_westo_2026' } }, {}), false);
});

test('only exact loopback control-plane origins are a development fallback, never a production credential', () => {
  assert.equal(isTrustedLocalControlPlaneOrigin({ headers: { origin: 'http://127.0.0.1:3050' } }, { NODE_ENV: 'development' }), true);
  assert.equal(isTrustedLocalControlPlaneOrigin({ headers: { origin: 'http://localhost:3061' } }, { NODE_ENV: 'test' }), true);
  assert.equal(isTrustedLocalControlPlaneOrigin({ headers: { origin: 'http://localhost:3050.attacker.example' } }, { NODE_ENV: 'development' }), false);
  assert.equal(isTrustedLocalControlPlaneOrigin({ headers: { origin: 'https://localhost:3050' } }, { NODE_ENV: 'development' }), false);
  assert.equal(isTrustedLocalControlPlaneOrigin({ headers: { origin: 'http://127.0.0.1:3050' } }, { NODE_ENV: 'production' }), false);
});

test('legacy cross-tenant administration is protected and no built-in shared secrets remain accepted', () => {
  const liveStart = serverSource.indexOf("if (req.path === '/api/admin/live-summary' && req.method === 'GET')");
  const featureStart = serverSource.indexOf("if (req.path === '/api/admin/features/toggle' && req.method === 'POST')");
  const provisionStart = serverSource.indexOf("if (req.path === '/api/admin/tenants/provision' && req.method === 'POST')");
  const listStart = serverSource.indexOf("if (req.path === '/api/admin/tenants' && req.method === 'GET')");
  assert.ok(liveStart >= 0 && featureStart > liveStart && provisionStart > featureStart && listStart > provisionStart);
  assert.match(serverSource.slice(liveStart, featureStart), /hasControlPlaneBridgeCredential\(req\)/);
  assert.match(serverSource.slice(liveStart, featureStart), /tenant_scope_denied/);
  assert.match(serverSource.slice(featureStart, provisionStart), /hasControlPlaneBridgeCredential\(req\)/);
  assert.match(serverSource.slice(featureStart, provisionStart), /tenant_scope_denied/);
  assert.match(serverSource.slice(provisionStart, listStart), /hasControlPlaneBridgeCredential\(req\)/);
  assert.match(serverSource.slice(listStart), /hasControlPlaneBridgeCredential\(req\)/);
  assert.doesNotMatch(serverSource, /salsa_dev_bridge_secret_at_least_32_bytes_entropy_token|dev_secret_salsa_westo_2026/);
  assert.match(runnerSource, /if \(isProduction\)[\s\S]*?SALSA_CONTROL_SECRET[\s\S]*?FAIL-CLOSED/);
  assert.match(runnerSource, /const bridgeSecret = process\.env\.SALSA_CONTROL_SECRET \|\| process\.env\.NEEM_CONTROL_SECRET/);
  assert.doesNotMatch(runnerSource, /const bridgeSecret = process\.env\.SALSA_SESSION_SECRET/);
  assert.match(runnerSource, /WESTO_SALSA_BRIDGE_SECRET[\s\S]*?SALSA_INBOX_ACK_SECRET/);
});
