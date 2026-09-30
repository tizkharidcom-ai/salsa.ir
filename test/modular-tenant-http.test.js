'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { createSessionToken } = require('../server/session-token');

test('isolated hosts deliver the same modules with empty menus, deny unpaid APIs, retain POS history, and reveal it after purchase', { timeout: 35000 }, async t => {
  const root = path.resolve(__dirname, '..');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'westo-modular-http-'));
  const secret = crypto.randomBytes(32).toString('hex');
  const dbPath = path.join(temp, 'db.json'), secretPath = path.join(temp, 'secret.key');
  const livePath = path.join(root, 'server/data/db.json');
  const before = fs.existsSync(livePath) ? crypto.createHash('sha256').update(fs.readFileSync(livePath)).digest('hex') : null;
  fs.writeFileSync(dbPath, JSON.stringify(require('../server/seed')), { mode: 0o600 });
  fs.writeFileSync(secretPath, secret, { mode: 0o600 });
  const child = spawn(process.execPath, [path.join(__dirname, 'fixtures/modular-tenant-server.cjs')], {
    cwd: root, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    env: { ...process.env, NODE_ENV: 'test', HOST: '127.0.0.1', PORT: '0', WESTO_DB_PATH: dbPath, WESTO_SECRET_PATH: secretPath,
      WESTO_ALLOW_TEST_DB_WRITE: 'true', WESTO_POSTGRES_REQUIRED: 'false', SALSA_TENANT_CONTEXT_MODE: 'control-db',
      SALSA_TENANT_DB_POSTGRES_URL: '', NEEM_TENANT_DB_POSTGRES_URL: '', SALSA_CONTROL_DATABASE_URL: '', NEEM_CONTROL_DATABASE_URL: '', DATABASE_URL: '' },
  });
  let diagnostics = '';
  child.stdout.on('data', bytes => { diagnostics = (diagnostics + bytes).slice(-6000); });
  child.stderr.on('data', bytes => { diagnostics = (diagnostics + bytes).slice(-6000); });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) { const exit = once(child, 'exit'); child.kill('SIGTERM'); await exit; }
    const after = fs.existsSync(livePath) ? crypto.createHash('sha256').update(fs.readFileSync(livePath)).digest('hex') : null;
    assert.equal(after, before);
    fs.rmSync(temp, { recursive: true, force: true });
  });
  const ready = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('readiness timed out: ' + diagnostics)), 15000);
    child.on('message', message => { if (message.ready || message.error) { clearTimeout(timer); resolve(message); } });
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`server exited ${code}: ${diagnostics}`)); });
  });
  if (ready.code === 'EPERM') { t.skip('loopback denied by sandbox; run with local network permission'); return; }
  assert.equal(ready.error, undefined, JSON.stringify(ready) + diagnostics);
  let id = 0;
  function command(tenantId, type, extra = {}) {
    return new Promise((resolve, reject) => {
      const key = ++id;
      const timer = setTimeout(() => { child.off('message', handler); reject(new Error('IPC timeout')); }, 5000);
      function handler(message) { if (message.id !== key) return; clearTimeout(timer); child.off('message', handler);
        if (message.error) reject(new Error(message.error)); else resolve(message.result); }
      child.on('message', handler); child.send({ id: key, tenantId, type, ...extra });
    });
  }
  async function request(tenantId, route, { method = 'GET', body, tokenTenant = tenantId } = {}) {
    return new Promise((resolve, reject) => {
      const outgoing = require('node:http').request({ hostname: '127.0.0.1', port: ready.port, path: route, method,
        headers: { host: `${tenantId}.localhost`, origin: `http://${tenantId}.localhost`, 'sec-fetch-site': 'same-origin', cookie: `westo_session=${createSessionToken({ phone: '09120000001', tenantId: tokenTenant }, secret)}`,
          ...(body ? { 'content-type': 'application/json' } : {}) } }, response => {
        let text = ''; response.setEncoding('utf8'); response.on('data', chunk => { text += chunk; });
        response.on('end', () => { let payload; try { payload = JSON.parse(text); } catch (_) { payload = text; }
          resolve({ status: response.statusCode, response: { headers: { get: key => response.headers[key] || null } }, payload }); });
      });
      outgoing.setTimeout(8000, () => outgoing.destroy(new Error('HTTP timeout')));
      outgoing.on('error', reject); outgoing.end(body ? JSON.stringify(body) : undefined);
    });
  }
  for (const tenant of ['darbar', 'bistro']) {
    const menu = await request(tenant, '/api/menu');
    assert.equal(menu.status, 200, JSON.stringify(menu.payload) + diagnostics); assert.deepEqual(menu.payload.menuItems, []);
    const boot = await request(tenant, '/js/content-bootstrap.static.js');
    const sandbox = { window: {} };
    require('node:vm').runInNewContext(boot.payload, sandbox);
    assert.equal(sandbox.window.__WESTO_CONTENT__.tenantId, tenant);
    assert.equal(sandbox.window.__WESTO_CONTENT__.menuItems.length, 0);
    const admin = await request(tenant, '/admin');
    assert.equal(admin.status, 200); assert.match(admin.payload, /admin\/features\/menu_qr-views.js/);
    assert.equal(admin.response.headers.get('x-westo-module-version'), 'platform_core@1.0.0');
    const asset = await request(tenant, '/js/admin/features/menu_qr-views.js');
    assert.equal(asset.status, 200); assert.equal(asset.response.headers.get('x-westo-module-version'), 'menu_qr@1.0.0');
    assert.equal((await request(tenant, '/modules/accounting/server/finance-v2.js')).status, 404);
    const session = await request(tenant, '/api/admin/session');
    assert.equal(session.status, 200); assert.equal(session.payload.moduleAccess.features['finance.workspace'], false);
    for (const route of ['/api/admin/v2/finance/events', '/v1/reports/pnl', '/api/tax/einvoices/x/status', '/api/admin/v2/kitchen']) {
      assert.equal((await request(tenant, route)).status, 403, route);
    }
  }
  assert.equal((await request('bistro', '/api/admin/session', { tokenTenant: 'darbar' })).status, 401);
  assert.equal((await request('unregistered', '/api/menu')).status, 404);
  const historical = await command('darbar', 'sale', { orderId: 'august-history' });
  assert.equal(historical.status, 'posted'); assert.equal(historical.count, 1);
  const replay = await command('darbar', 'sale', { orderId: 'august-history' });
  assert.equal(replay.eventId, historical.eventId); assert.equal(replay.count, 1);
  await command('darbar', 'menu');
  assert.deepEqual((await request('bistro', '/api/menu')).payload.menuItems, []);
  const created = await request('darbar', '/api/staff/orders', { method: 'POST', body: {
    branchId: 1, fulfillment: 'pickup', paymentMethod: 'cashier', items: [{ menuItemId: 1, qty: 1 }], idempotencyKey: 'modular-pos-order-001',
  } });
  assert.equal(created.status, 201, JSON.stringify(created.payload));
  const settled = await request('darbar', `/api/cashier/orders/${created.payload.order.id}/settle`, { method: 'POST', body: {
    tender: 'manual_card', paymentAmount: 1000, paymentReference: 'POS-MODULE-001', idempotencyKey: 'modular-pos-settle-001',
  } });
  assert.equal(settled.status, 200, JSON.stringify(settled.payload));
  assert.equal(settled.payload.order.paymentStatus, 'paid');
  assert.equal('finance' in settled.payload, false);
  assert.equal('financeReceipt' in settled.payload, false);
  const persisted = JSON.parse(fs.readFileSync(path.join(temp, 'tenants/darbar.json'), 'utf8'));
  assert.equal(persisted.financeV2.events.filter(row => row.source === 'order.paid').length, 2);
  await command('darbar', 'access', { grant: { status: 'active', active: true } });
  const events = await request('darbar', '/api/admin/v2/finance/events?branchId=1');
  assert.equal(events.status, 200, JSON.stringify(events.payload));
  assert.match(JSON.stringify(events.payload), /august-history/);
  assert.equal((await request('bistro', '/api/admin/v2/finance/events?branchId=1')).status, 403);
  const previous = await command('darbar', 'state');
  await command('darbar', 'access', { grant: { status: 'expired', active: false } });
  assert.equal((await request('darbar', '/api/admin/v2/finance/events?branchId=1')).status, 403);
  assert.deepEqual(await command('darbar', 'state'), previous);
  assert.deepEqual(await command('bistro', 'state'), { events: 0, entries: 0, orders: 0 });
});
