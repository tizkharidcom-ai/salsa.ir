'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repositoryPath = path.join(__dirname, '..', 'superadmin', 'frontend', 'js', 'godmode', 'domain', 'operations', 'repository.js');
const source = fs.readFileSync(repositoryPath, 'utf8');
const repository = require(repositoryPath);

test('SuperAdmin distinguishes a responding but unready Core Cell from a network timeout', () => {
  const degraded = repository.describeProbeFailure({
    kind: 'runtime_cell',
    status: 'degraded',
    details: {
      endpoint: '/api/ready',
      httpStatus: 503,
      runtimeStatus: 'not_ready',
      checks: {
        postgresAuthority: { ok: false, reason: 'postgres_not_authoritative' },
        databaseConnection: { ok: false, reason: 'database_unavailable' },
      },
    },
  });
  assert.match(degraded, /HTTP 503/);
  assert.match(degraded, /not_ready/);
  assert.match(degraded, /postgres_not_authoritative/);
  assert.doesNotMatch(degraded, /عدم پاسخگویی/);

  const unreachable = repository.describeProbeFailure({ kind: 'runtime_cell', status: 'unreachable' });
  assert.match(unreachable, /پروب در مهلت مقرر پاسخ نگرفت/);

  const cellIncident = repository.describeProbeIncident({ kind: 'runtime_cell', status: 'degraded', details: { httpStatus: 503 } });
  assert.equal(cellIncident.severity, 'critical');
  assert.match(cellIncident.title, /سرویس رستوران آماده/);

  const queueIncident = repository.describeProbeIncident({ kind: 'queue', name: 'صف رویدادها', status: 'degraded' });
  assert.equal(queueIncident.severity, 'warning');
  assert.match(queueIncident.title, /صف رویدادها نیازمند بررسی/);
});

test('action inbox uses readiness diagnostics for measured probe failures', () => {
  assert.match(source, /const incident = this\.describeProbeIncident\(p\)/);
  assert.match(source, /reason:\s*incident\.reason/);
  assert.match(source, /سلول پاسخ داده اما آمادهٔ سرویس‌دهی نیست/);
  assert.match(source, /Object\.entries\(details\.checks \|\| \{\}\)/);
});
