'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildServiceDefinitions } = require('../server/full-stack');

test('full stack starts the current frontend and wires all three local ports', () => {
  const [westo, frontend, control] = buildServiceDefinitions({});
  assert.deepEqual(westo.args, ['server/server.js']);
  assert.deepEqual(frontend.args, ['superadmin/frontend/server.js']);
  assert.deepEqual(control.args, ['server/salsa/control-plane/server.js']);
  assert.equal(westo.env.PORT, '4180');
  assert.equal(frontend.env.PORT, '3050');
  assert.equal(control.env.SALSA_CONTROL_PORT, '3061');
  assert.equal(frontend.env.NODE_ENV, 'development');
  assert.equal(frontend.env.SALSA_CONTROL_PLANE_URL, 'http://127.0.0.1:3061');
  assert.equal(westo.env.WESTO_SALSA_BRIDGE_SECRET, control.env.WESTO_SALSA_BRIDGE_SECRET);
  assert.equal(westo.env.SALSA_BRIDGE_URL, 'http://127.0.0.1:3061/api/control/integrations/westo/events');
});

test('full stack preserves explicit database, ports, API origin and environment', () => {
  const services = buildServiceDefinitions({
    NODE_ENV: 'production', PORT: '5180', GODMODE_PORT: '4050', SALSA_CONTROL_PORT: '4061',
    SALSA_CONTROL_PLANE_URL: 'https://control.example.com',
    SALSA_CONTROL_ALLOW_EPHEMERAL_DEV: 'false', DATABASE_URL: 'postgres://local/westo',
  });
  assert.equal(services[0].env.PORT, '5180');
  assert.equal(services[1].env.PORT, '4050');
  assert.equal(services[2].env.SALSA_CONTROL_PORT, '4061');
  for (const service of services) {
    assert.equal(service.env.NODE_ENV, 'production');
    assert.equal(service.env.SALSA_CONTROL_ALLOW_EPHEMERAL_DEV, 'false');
    assert.equal(service.env.DATABASE_URL, 'postgres://local/westo');
    assert.equal(service.env.SALSA_CONTROL_PLANE_URL, 'https://control.example.com');
  }
});
