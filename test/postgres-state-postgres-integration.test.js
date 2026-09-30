'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { URL } = require('node:url');
const { Pool, Client } = require('pg');
const { createPostgresStateStore } = require('../server/postgres-state');

const enabled = process.env.WESTO_POSTGRES_INTEGRATION === '1';

test('real PostgreSQL rejects one of two independently hydrated competing order/payment snapshots', {
  skip: !enabled ? 'set WESTO_POSTGRES_INTEGRATION=1 to create and drop an isolated temporary database' : false,
  timeout: 30000,
}, async () => {
  const sourceUrl = new URL(process.env.WESTO_POSTGRES_TEST_URL || process.env.DATABASE_URL || '');
  if (!['localhost', '127.0.0.1', '::1'].includes(sourceUrl.hostname)) {
    throw new Error('Refusing PostgreSQL integration test against a non-loopback host.');
  }

  const database = `westo_cas_${crypto.randomBytes(8).toString('hex')}`;
  const adminUrl = new URL(sourceUrl);
  adminUrl.pathname = `/${sourceUrl.pathname.split('/').filter(Boolean)[0] || 'postgres'}`;
  const admin = new Client({ connectionString: adminUrl.toString(), connectionTimeoutMillis: 5000 });
  let databaseCreated = false;
  let first;
  let second;
  try {
    await admin.connect();
    await admin.query(`CREATE DATABASE "${database}" TEMPLATE template0`);
    databaseCreated = true;

    const isolatedUrl = new URL(sourceUrl);
    isolatedUrl.pathname = `/${database}`;
    const storeOptions = {
      connectionString: isolatedUrl.toString(),
      Pool,
      logger: { info() {}, warn() {}, error() {} },
      required: false,
    };
    first = createPostgresStateStore(storeOptions);
    second = createPostgresStateStore(storeOptions);

    const seed = { orders: [], financeV2: { journalEntries: [] } };
    await first.hydrate(seed);
    await second.hydrate(seed);

    const firstSnapshot = {
      orders: [{ id: 901, branchId: 7, amountPaid: 100, paymentStatus: 'partial' }],
      financeV2: { journalEntries: [{ id: 'first-payment-leg' }] },
    };
    const staleSnapshot = {
      orders: [{ id: 901, branchId: 7, amountPaid: 80, paymentStatus: 'partial' }],
      financeV2: { journalEntries: [{ id: 'stale-payment-leg' }] },
    };

    const writes = await Promise.allSettled([first.write(firstSnapshot), second.write(staleSnapshot)]);
    assert.equal(writes.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(writes.filter((result) => result.status === 'rejected').length, 1);
    const conflict = writes.find((result) => result.status === 'rejected').reason;
    assert.equal(conflict.code, 'postgres_state_write_conflict');
    assert.equal(conflict.status, 409);

    const verify = new Client({ connectionString: isolatedUrl.toString(), connectionTimeoutMillis: 5000 });
    await verify.connect();
    try {
      const result = await verify.query('SELECT data, version FROM westo_state WHERE id = 1');
      assert.equal(Number(result.rows[0].version), 2);
      const winnerId = result.rows[0].data.financeV2.journalEntries[0].id;
      const expectedWinner = writes[0].status === 'fulfilled' ? 'first-payment-leg' : 'stale-payment-leg';
      const expectedLoser = writes[0].status === 'fulfilled' ? 'stale-payment-leg' : 'first-payment-leg';
      assert.equal(winnerId, expectedWinner);
      assert.notEqual(winnerId, expectedLoser, 'the stale snapshot cannot replace the committed payment leg');
    } finally {
      await verify.end();
    }
  } finally {
    await Promise.all([first?.close(), second?.close()].filter(Boolean).map((promise) => Promise.resolve(promise).catch(() => {})));
    if (databaseCreated) await admin.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
    await admin.end().catch(() => {});
  }
});
