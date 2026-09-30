'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const probeFiles = [
  'server/salsa/control-plane/routes/infra-routes.js',
  'superadmin/backend/routes/infra-routes.js',
];

test('both Control Plane runtimes probe WESTO operational readiness rather than liveness', () => {
  for (const relativePath of probeFiles) {
    const source = fs.readFileSync(path.join(root, relativePath), 'utf8');
    const start = source.indexOf('// 3. Westo Core Cell Runtime Bridge Probe');
    const end = source.indexOf('// 4. Ingress / Reverse Proxy Configuration Probe', start);
    assert.ok(start >= 0 && end > start, `${relativePath}: cell probe boundaries exist`);
    const cellProbe = source.slice(start, end);

    assert.match(cellProbe, /\/api\/ready/);
    assert.doesNotMatch(cellProbe, /\/api\/health/);
    assert.match(cellProbe, /cellRes\.ok && readinessPayload\?\.ok === true && readinessPayload\?\.status === 'ready' \? 'healthy' : 'degraded'/);
    assert.match(cellProbe, /httpStatus: cellRes\.status/);
    assert.match(cellProbe, /runtimeStatus: readinessPayload\?\.status/);
    assert.match(cellProbe, /checks: readinessChecks/);
    assert.match(cellProbe, /clearTimeout\(timer\)/);
    assert.match(cellProbe, /1200/);
  }
});

test('Control Plane probe keeps readiness diagnostics bounded and excludes non-code reason text', () => {
  for (const relativePath of probeFiles) {
    const source = fs.readFileSync(path.join(root, relativePath), 'utf8');
    const start = source.indexOf('const readinessChecks = Object.fromEntries(');
    const end = source.indexOf('probes.push({', start);
    const normalization = source.slice(start, end);
    assert.match(normalization, /\.slice\(0, 8\)/);
    assert.match(normalization, /\^\[A-Za-z0-9_\.\-\]\{1,80\}\$/);
    assert.match(normalization, /ok: check\?\.ok === true/);
  }
});
