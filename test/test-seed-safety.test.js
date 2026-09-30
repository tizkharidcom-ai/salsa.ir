'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { assertTestSeedAllowed, isLoopbackUrl } = require('../scripts/lib/test-seed-safety');

assert.equal(assertTestSeedAllowed({ argv: ['--allow-test-seed'], nodeEnv: 'development' }), true);
assert.throws(
  () => assertTestSeedAllowed({ argv: [], nodeEnv: 'development', scriptName: 'fixture loader' }),
  (error) => error.code === 'test_seed_opt_in_required',
);
assert.throws(
  () => assertTestSeedAllowed({ argv: ['--allow-test-seed'], nodeEnv: 'production' }),
  (error) => error.code === 'test_seed_disabled_in_production',
);
assert.throws(
  () => assertTestSeedAllowed({ argv: ['--allow-test-seed'], targetUrl: 'postgres://db.example.com/app' }),
  (error) => error.code === 'test_seed_target_must_be_local',
);

for (const url of [
  'http://localhost:4180',
  'https://127.0.0.1:4180',
  'postgresql://user:pass@127.0.0.1:5432/local',
  'http://[::1]:4180',
]) assert.equal(isLoopbackUrl(url), true, `${url} should be a loopback target`);

for (const url of ['https://westo.example', 'not-a-url']) {
  assert.equal(isLoopbackUrl(url), false, `${url} must not be an allowed seed target`);
}

for (const script of [
  'seed-ecosystem-master.js',
  'seed-ecosystem-operations.js',
  'seed-pos-inventory-live.js',
  'seed-menu-foundation.js',
  'seed-westo-culinary-ecosystem.js',
  'reconcile-ecosystem-master.js',
]) {
  const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', script), 'utf8');
  assert.match(source, /assertTestSeedAllowed\(/, `${script} must require explicit local-seed authorization`);
}

console.log('Test seed safety checks passed.');
