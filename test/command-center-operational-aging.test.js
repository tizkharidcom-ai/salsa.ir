'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('command center separates kitchen, payment and handoff attention by current-stage age', (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'westo-command-aging-'));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));

  const serverPath = path.resolve(__dirname, '../server/server.js');
  const script = `
    const { db, commandCenterPayload } = require(${JSON.stringify(serverPath)});
    const now = Date.now();
    const ago = (minutes) => new Date(now - minutes * 60000).toISOString();
    db.orders = [
      { id: 101, status: 'preparing', createdAt: ago(600), statusHistory: [{ status: 'preparing', at: ago(5) }] },
      { id: 102, status: 'sent_to_kitchen', createdAt: ago(25), statusHistory: [{ status: 'sent_to_kitchen', at: ago(25) }] },
      { id: 103, status: 'pay_at_cashier', createdAt: ago(45), statusHistory: [{ status: 'pay_at_cashier', at: ago(45) }] },
      { id: 104, status: 'ready', createdAt: ago(30), statusHistory: [{ status: 'ready', at: ago(30) }] },
    ];
    const payload = commandCenterPayload();
    process.stdout.write(JSON.stringify({
      summary: payload.summary,
      delayed: payload.delayed.map((item) => item.id),
      paymentAttention: payload.paymentAttention.map((item) => item.id),
      handoffAttention: payload.handoffAttention.map((item) => item.id),
      recentlyAdvancedStageAge: payload.queue.find((item) => item.id === 101).stageAgeMinutes,
    }));
  `;
  const result = spawnSync(process.execPath, ['-e', script], {
    encoding: 'utf8',
    env: {
      ...process.env,
      NODE_ENV: 'test',
      DATABASE_URL: '',
      WESTO_POSTGRES_REQUIRED: 'false',
      WESTO_DB_PATH: path.join(tempDir, 'db.json'),
      WESTO_SECRET_PATH: path.join(tempDir, 'secret.key'),
      SALSA_MULTI_TENANT_MODE: 'false',
      NEEM_MULTI_TENANT_MODE: 'false',
      SALSA_REQUIRE_TENANT_METADATA: 'false',
      NEEM_REQUIRE_TENANT_METADATA: 'false',
    },
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const raw = result.stdout.trim().split('\n').at(-1);
  const payload = JSON.parse(raw);
  assert.deepEqual(payload.delayed, [102]);
  assert.deepEqual(payload.paymentAttention, [103]);
  assert.deepEqual(payload.handoffAttention, [104]);
  assert.equal(payload.recentlyAdvancedStageAge, 5);
  assert.deepEqual({
    queue: payload.summary.queue,
    delayed: payload.summary.delayed,
    kitchenQueue: payload.summary.kitchenQueue,
    paymentAttention: payload.summary.paymentAttention,
    handoffAttention: payload.summary.handoffAttention,
  }, { queue: 4, delayed: 1, kitchenQueue: 2, paymentAttention: 1, handoffAttention: 1 });
});
