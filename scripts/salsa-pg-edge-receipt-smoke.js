'use strict';

/**
 * Disposable PostgreSQL smoke gate for D9-E durable Edge order receipts.
 *
 * The script requires an explicit confirmation because it inserts and removes
 * one generated tenant, device, lease and receipt in the supplied database.
 * It never targets WESTO's Finance database implicitly.
 */

const assert = require('node:assert/strict');

const CONFIRMATION = 'RUN_NEEM_EDGE_RECEIPT_SMOKE';

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

async function main() {
  if (process.env.NEEM_EDGE_RECEIPT_SMOKE_CONFIRM !== CONFIRMATION) {
    throw new Error(`Refusing to mutate PostgreSQL without NEEM_EDGE_RECEIPT_SMOKE_CONFIRM=${CONFIRMATION}.`);
  }

  process.env.NODE_ENV = 'development';
  const { getDatabase } = require('../server/salsa/control-plane/db/database');
  const { EdgePairingLeaseService } = require('../server/salsa/control-plane/edge/edge-pairing-lease-service');
  const { EdgeSyncService } = require('../server/salsa/control-plane/edge/edge-sync-service');
  const db = getDatabase();
  const suffix = `${Date.now()}-${process.pid}`.replace(/[^0-9-]/g, '');
  const tenantId = `edge-ledger-${suffix}`;
  const cellId = `cell-edge-${suffix}`;
  const databaseName = `edge_ledger_${suffix.replace(/-/g, '_')}`;
  const domain = `${tenantId}.smoke.neem.ir`;
  const checks = [];
  let deviceId = null;
  let orderId = `edge-order-${suffix}`;

  const check = (name, passed, details = null) => {
    checks.push({ name, passed, details: passed ? 'ok' : details });
    assert.equal(passed, true, name);
  };

  try {
    const schema = await db.query("SELECT to_regclass('public.neem_edge_order_receipts') AS table_name");
    check('durable Edge receipt table is migrated', schema.rows[0]?.table_name === 'neem_edge_order_receipts', schema.rows[0]);

    await db.query(
      `INSERT INTO neem_tenants
        (tenant_id, display_name, status, plan_code, cell_id, database_name, database_provider, canonical_domain, metadata, created_at, updated_at)
       VALUES ($1, $2, 'active', 'pilot', $3, $4, 'postgres', $5, '{}'::jsonb, now(), now())`,
      [tenantId, 'D9-E Durable Edge Receipt Smoke', cellId, databaseName, domain]
    );

    const pairing = new EdgePairingLeaseService({ db });
    const firstSync = new EdgeSyncService({ db });
    const afterRestart = new EdgeSyncService({ db });
    const paired = await pairing.pairDevice({
      tenantId,
      branchId: 'branch-edge-smoke',
      deviceName: 'D9-E durable receipt smoke'
    });
    deviceId = paired.device.id;
    const order = {
      order_id: orderId,
      receipt_number: `BR-EDGE-${suffix}`,
      tenant_id: tenantId,
      total_rials: 1_250_000,
      status: 'completed'
    };
    const batch = [{ entity_kind: 'order', entity_id: orderId, payload: order }];
    const first = await firstSync.syncBatch({
      tenantId,
      deviceId,
      leaseToken: paired.lease.lease_token,
      batch
    });
    check('first delivery creates one durable receipt', first.synced_count === 1 && first.duplicate_deduplicated.length === 0, first);

    const replay = await afterRestart.syncBatch({
      tenantId,
      deviceId,
      leaseToken: paired.lease.lease_token,
      batch
    });
    check('replay after service restart is deduplicated', replay.duplicate_deduplicated.length === 1 && replay.duplicate_deduplicated[0] === orderId, replay);

    await assert.rejects(
      afterRestart.syncBatch({
        tenantId,
        deviceId,
        leaseToken: paired.lease.lease_token,
        batch: [{ entity_kind: 'order', entity_id: orderId, payload: { ...order, total_rials: 9_999_999 } }]
      }),
      (error) => error.code === 'EDGE_ORDER_PAYLOAD_MISMATCH' && error.status === 409
    );
    check('same order id with changed payload is rejected', true);

    const receipt = await db.query(
      `SELECT count(*)::int AS count FROM neem_edge_order_receipts WHERE tenant_id = $1 AND order_id = $2`,
      [tenantId, orderId]
    );
    check('exactly one receipt remains authoritative', receipt.rows[0]?.count === 1, receipt.rows[0]);
    console.log(JSON.stringify({ ok: true, tenantId, deviceId, orderId, checks }, null, 2));
  } finally {
    await db.query('DELETE FROM neem_edge_order_receipts WHERE tenant_id = $1', [tenantId]).catch(() => {});
    await db.query('DELETE FROM neem_edge_leases WHERE tenant_id = $1', [tenantId]).catch(() => {});
    if (deviceId) await db.query('DELETE FROM neem_edge_devices WHERE id = $1', [deviceId]).catch(() => {});
    await db.query('DELETE FROM neem_tenants WHERE tenant_id = $1', [tenantId]).catch(() => {});
    await db.end?.().catch?.(() => {});
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
