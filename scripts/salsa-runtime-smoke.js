'use strict';

/**
 * Runtime smoke gate for the local NEEM/GODMODE surfaces.
 *
 * This is intentionally a transport-level check. It does not create tenants,
 * mutate billing data, or treat a green prototype response as production
 * evidence. Use it after starting the prototype and (optionally) the Control
 * Plane in the same network environment.
 */

const http = require('http');
const https = require('https');

const DEFAULT_TIMEOUT_MS = 5000;

function parseArgs(argv) {
  const options = {
    prototypeUrl: 'http://127.0.0.1:3050',
    controlUrl: 'http://127.0.0.1:3061',
    skipControl: false,
    timeoutMs: DEFAULT_TIMEOUT_MS
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--skip-control') {
      options.skipControl = true;
    } else if (arg === '--prototype-url') {
      options.prototypeUrl = argv[++index];
    } else if (arg === '--control-url') {
      options.controlUrl = argv[++index];
    } else if (arg === '--timeout-ms') {
      options.timeoutMs = Number(argv[++index]);
    } else if (arg === '--help' || arg === '-h') {
      console.log('Usage: node scripts/salsa-runtime-smoke.js [--prototype-url URL] [--control-url URL] [--skip-control] [--timeout-ms N]');
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 100 || options.timeoutMs > 120000) {
    throw new Error('--timeout-ms must be an integer between 100 and 120000.');
  }
  return options;
}

function request(baseUrl, { method = 'GET', rawPath = '/', timeoutMs }) {
  const target = new URL(baseUrl);
  const transport = target.protocol === 'https:' ? https : http;

  return new Promise((resolve, reject) => {
    const req = transport.request({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || (target.protocol === 'https:' ? 443 : 80),
      method,
      path: rawPath,
      headers: { 'Accept': 'application/json, text/html, */*' }
    }, (res) => {
      const chunks = [];
      const maxCapturedBytes = 2 * 1024 * 1024;
      let bodyLength = 0;
      res.on('data', (chunk) => {
        bodyLength += chunk.length;
        if (bodyLength <= maxCapturedBytes) chunks.push(chunk);
      });
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          headers: Object.fromEntries(Object.entries(res.headers).map(([key, value]) => [key.toLowerCase(), value])),
          bodyLength,
          body: Buffer.concat(chunks).toString('utf8').slice(0, maxCapturedBytes)
        });
      });
    });

    req.setTimeout(timeoutMs, () => req.destroy(new Error(`request timeout after ${timeoutMs}ms`)));
    req.on('error', reject);
    req.end();
  });
}

function check(label, result, expectedStatus, predicate = () => true) {
  const passed = result.status === expectedStatus && predicate(result);
  return {
    label,
    passed,
    expectedStatus,
    actualStatus: result.status,
    details: passed ? 'ok' : {
      headers: result.headers,
      body: result.body
    }
  };
}

async function runPrototypeChecks(options) {
  const checks = [];
  const root = await request(options.prototypeUrl, { timeoutMs: options.timeoutMs });
  checks.push(check('prototype root', root, 200, (result) => (
    ['SALSA-GODMODE-MOCK', 'NEEM-GODMODE-MOCK'].includes(result.headers['x-prototype-mode'])
    && String(result.headers['content-security-policy'] || '').includes("default-src 'self'")
    && result.headers['x-content-type-options'] === 'nosniff'
    && result.headers['x-frame-options'] === 'DENY'
    && !Object.prototype.hasOwnProperty.call(result.headers, 'access-control-allow-origin')
  )));

  const api = await request(options.prototypeUrl, { rawPath: '/api/westo-real-data', timeoutMs: options.timeoutMs });
  checks.push(check('prototype API bridge disabled', api, 404));

  const traversal = await request(options.prototypeUrl, { rawPath: '/../server/data/db.json', timeoutMs: options.timeoutMs });
  checks.push(check('prototype traversal blocked', traversal, 403));

  const malformed = await request(options.prototypeUrl, { rawPath: '/%E0%A4%A', timeoutMs: options.timeoutMs });
  checks.push(check('prototype malformed path rejected', malformed, 400));

  const method = await request(options.prototypeUrl, { method: 'POST', rawPath: '/', timeoutMs: options.timeoutMs });
  checks.push(check('prototype method allowlist', method, 405));
  return checks;
}

async function runControlChecks(options) {
  const checks = [];
  const health = await request(options.controlUrl, { rawPath: '/api/control/health', timeoutMs: options.timeoutMs });
  checks.push(check('control health', health, 200, (result) => (
    (result.body.includes('salsa-control-plane') || result.body.includes('neem-control-plane')) && result.body.includes('healthy')
  )));

  const consolePage = await request(options.controlUrl, { rawPath: '/console/', timeoutMs: options.timeoutMs });
  checks.push(check('control console redirect to godmode', consolePage, 302, (result) => (
    (result.headers['location'] || '').includes('3050')
  )));

  for (const rawPath of ['/api/control/infra/domains', '/api/control/edge/devices', '/api/control/billing/quotas']) {
    const result = await request(options.controlUrl, { rawPath, timeoutMs: options.timeoutMs });
    checks.push(check(`control unauthenticated denied: ${rawPath}`, result, 401, (entry) => (
      entry.body.includes('UNAUTHENTICATED')
    )));
  }
  return checks;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const checks = [];
  const errors = [];

  try {
    checks.push(...await runPrototypeChecks(options));
  } catch (error) {
    errors.push({ surface: 'prototype', message: error.message });
  }

  if (!options.skipControl) {
    try {
      checks.push(...await runControlChecks(options));
    } catch (error) {
      errors.push({ surface: 'control', message: error.message });
    }
  }

  const failed = checks.filter((entry) => !entry.passed);
  const result = {
    ok: errors.length === 0 && failed.length === 0,
    checkedAt: new Date().toISOString(),
    surfaces: {
      prototype: options.prototypeUrl,
      control: options.skipControl ? null : options.controlUrl
    },
    checks,
    errors
  };
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
