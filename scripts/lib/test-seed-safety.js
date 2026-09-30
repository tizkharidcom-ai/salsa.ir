'use strict';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

function isLoopbackUrl(value) {
  if (!value) return true;
  let parsed;
  try {
    parsed = new URL(String(value));
  } catch {
    return false;
  }
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return ['http:', 'https:', 'postgres:', 'postgresql:'].includes(parsed.protocol)
    && (LOOPBACK_HOSTS.has(host) || /^127(?:\.\d{1,3}){3}$/.test(host));
}

function assertTestSeedAllowed({
  scriptName = 'test seeder',
  targetUrl,
  argv = process.argv.slice(2),
  nodeEnv = process.env.NODE_ENV,
} = {}) {
  const name = String(scriptName || 'test seeder');
  if (String(nodeEnv || '').toLowerCase() === 'production') {
    const error = new Error(`${name} is disabled when NODE_ENV=production.`);
    error.code = 'test_seed_disabled_in_production';
    throw error;
  }
  if (!Array.isArray(argv) || !argv.includes('--allow-test-seed')) {
    const error = new Error(`Refusing to run ${name}. Pass --allow-test-seed only for an intentional local test environment.`);
    error.code = 'test_seed_opt_in_required';
    throw error;
  }
  if (targetUrl && !isLoopbackUrl(targetUrl)) {
    const error = new Error(`Refusing to run ${name} against a non-loopback target.`);
    error.code = 'test_seed_target_must_be_local';
    throw error;
  }
  return true;
}

module.exports = { assertTestSeedAllowed, isLoopbackUrl };
