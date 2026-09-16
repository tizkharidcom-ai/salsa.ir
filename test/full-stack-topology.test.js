'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildServiceDefinitions } = require('../server/full-stack');

test('full stack starts WESTO, GODMODE on 3050, and the Control Plane', () => {
  const services = buildServiceDefinitions({
    PORT: '44180',
    GODMODE_PORT: '43050',
    GODMODE_HOST: '127.0.0.1',
    NEEM_CONTROL_PORT: '43061',
  });

  assert.deepEqual(services.map((service) => service.name), [
    'WESTO client',
    'NEEM GODMODE prototype',
    'NEEM Control Plane',
  ]);
  assert.equal(services[0].env.PORT, '44180');
  assert.equal(services[1].env.PORT, '43050');
  assert.equal(services[1].env.GODMODE_HOST, '127.0.0.1');
  assert.equal(services[2].env.NEEM_CONTROL_PORT, '43061');
});
