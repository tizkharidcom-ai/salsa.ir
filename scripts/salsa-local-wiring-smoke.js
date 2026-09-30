'use strict';

/*
 * Local wiring smoke for the three-part stack:
 *   GODMODE prototype (3050) -> WESTO client apps (4180) -> NEEM Control Plane (3061)
 *
 * This deliberately fails when the local WESTO outbox is not draining. A
 * healthy HTTP response alone is not evidence that the bridge is configured.
 */
const fs = require('node:fs');
const path = require('node:path');

function arg(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

async function request(url, init = {}) {
  try {
    const response = await fetch(url, init);
    const text = await response.text();
    let body = null;
    try { body = JSON.parse(text); } catch (_error) { body = text; }
    return { ok: true, status: response.status, body };
  } catch (error) {
    return { ok: false, status: 0, body: null, error: error.message };
  }
}

function addCheck(checks, label, result, passed, details) {
  checks.push({
    label,
    passed: Boolean(passed),
    expectedStatus: result?.expectedStatus,
    actualStatus: result?.status || 0,
    details: details || result?.error || (typeof result?.body === 'string' ? result.body.slice(0, 180) : 'ok'),
  });
}

async function main() {
  const prototypeUrl = arg('--prototype-url', 'http://127.0.0.1:3050').replace(/\/$/, '');
  const westoUrl = arg('--westo-url', 'http://127.0.0.1:4180').replace(/\/$/, '');
  const controlUrl = arg('--control-url', 'http://127.0.0.1:3061').replace(/\/$/, '');
  const dbPath = path.resolve(arg('--db', path.join(__dirname, '..', 'server', 'data', 'db.json')));
  const checks = [];

  const prototypeRoot = await request(`${prototypeUrl}/`);
  prototypeRoot.expectedStatus = 200;
  addCheck(checks, 'GODMODE prototype root', prototypeRoot, prototypeRoot.status === 200);

  const prototypeBridge = await request(`${prototypeUrl}/api/control/health`);
  prototypeBridge.expectedStatus = 404;
  addCheck(
    checks,
    'GODMODE remains isolated from live APIs',
    prototypeBridge,
    prototypeBridge.status === 404 && prototypeBridge.body?.error === 'API_NOT_AVAILABLE',
  );

  const westoHealth = await request(`${westoUrl}/api/health`);
  westoHealth.expectedStatus = 200;
  addCheck(checks, 'WESTO client health', westoHealth, westoHealth.status === 200 && westoHealth.body?.ok === true);

  const menu = await request(`${westoUrl}/api/menu`);
  menu.expectedStatus = 200;
  addCheck(checks, 'WESTO menu API', menu, menu.status === 200 && Array.isArray(menu.body?.menuItems));

  const restaurant = await request(`${westoUrl}/api/restaurant`);
  restaurant.expectedStatus = 200;
  addCheck(
    checks,
    'WESTO restaurant API',
    restaurant,
    restaurant.status === 200 && Array.isArray(restaurant.body?.tables),
  );

  const controlHealth = await request(`${controlUrl}/api/control/health`);
  controlHealth.expectedStatus = 200;
  addCheck(
    checks,
    'SALSA Control Plane health',
    controlHealth,
    controlHealth.status === 200 && controlHealth.body?.success === true && controlHealth.body?.data?.status === 'healthy',
  );

  const controlConsole = await request(`${controlUrl}/console/`);
  controlConsole.expectedStatus = 200;
  addCheck(checks, 'SALSA Control Plane console (redirects to GODMODE 3050)', controlConsole, controlConsole.status === 200 || controlConsole.status === 302);

  let integration = null;
  let dbError = null;
  try {
    const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    const state = (db.salsaIntegration && typeof db.salsaIntegration === 'object')
      ? db.salsaIntegration
      : (db.neemIntegration && typeof db.neemIntegration === 'object' ? db.neemIntegration : {});
    const outbox = Array.isArray(state.outbox) ? state.outbox : [];
    integration = {
      tenantId: state.tenantId || null,
      endpoint: state.endpoint || null,
      enabled: state.enabled !== false,
      outboxTotal: outbox.length,
      pending: outbox.filter((event) => !event.deliveredAt).length,
      delivered: outbox.filter((event) => event.deliveredAt).length,
      legacyWithoutTenant: outbox.filter((event) => !event.tenantId && !event.payload?.tenantId).length,
      lastError: state.lastError || null,
    };
    addCheck(
      checks,
      'WESTO bridge outbox drains',
      { status: 200 },
      integration.pending === 0 && integration.delivered > 0 && !integration.lastError,
      JSON.stringify(integration),
    );
  } catch (error) {
    dbError = error.message;
    addCheck(checks, 'WESTO bridge outbox drains', { status: 0 }, false, `DB_READ_FAILED: ${dbError}`);
  }

  const report = {
    ok: checks.every((check) => check.passed),
    checkedAt: new Date().toISOString(),
    surfaces: { prototypeUrl, westoUrl, controlUrl },
    integration,
    checks,
    errors: dbError ? [dbError] : [],
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = report.ok ? 0 : 1;
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({ ok: false, error: error.message }, null, 2)}\n`);
  process.exitCode = 1;
});
