'use strict';

/**
 * Disposable PostgreSQL smoke gate for D7.
 *
 * Verifies the real control-plane outbox contract with two independent worker
 * instances: SKIP LOCKED claims, signed inbox ACKs, durable deduplication after
 * a simulated crash, fencing-token takeover, retry/DLQ and incident evidence.
 * It mutates only one generated tenant and exact smoke rows, and requires an
 * explicit confirmation before it can run.
 */

const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const CONFIRMATION = 'RUN_NEEM_OUTBOX_MULTIWORKER_SMOKE';

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

async function main() {
  if (process.env.NEEM_OUTBOX_SMOKE_CONFIRM !== CONFIRMATION) {
    throw new Error(`Refusing to mutate PostgreSQL without NEEM_OUTBOX_SMOKE_CONFIRM=${CONFIRMATION}.`);
  }

  requireEnv('NEEM_CONTROL_DATABASE_URL');
  process.env.NODE_ENV = 'development';
  process.env.NEEM_INBOX_ACK_SECRET = requireEnv('NEEM_INBOX_ACK_SECRET');

  const { getDatabase } = require('../server/salsa/control-plane/db/database');
  const { OutboxWorker } = require('../server/salsa/control-plane/automation/outbox-worker');
  const db = getDatabase();
  const suffix = `${Date.now()}-${process.pid}`.replace(/[^0-9-]/g, '');
  const tenantId = `d7-smoke-${suffix}`;
  const cellId = `cell-d7-${suffix}`;
  const taskIds = [];
  const idempotencyKeys = [];
  const markerIds = [];
  const checks = [];

  const recordCheck = (name, passed, details = null) => {
    checks.push({ name, passed, details: passed ? 'ok' : details });
    assert.equal(passed, true, name);
  };

  const insertTenant = async () => {
    await db.query(
      `INSERT INTO neem_tenants
        (tenant_id, display_name, status, plan_code, cell_id, database_name, database_provider, canonical_domain, metadata, created_at, updated_at)
       VALUES ($1, $2, 'active', 'pilot', $3, $4, 'postgres', $5, '{}'::jsonb, now(), now())`,
      [tenantId, 'D7 Outbox Multi-Worker Smoke', cellId, `control_${suffix}`, `${tenantId}.smoke.neem.ir`]
    );
  };

  const effectHandler = async (task, client) => {
    const payload = typeof task.payload === 'string' ? JSON.parse(task.payload) : task.payload;
    await client.query(
      `INSERT INTO neem_control_audit_events
        (id, action, actor_id, target_type, target_id, tenant_id, metadata, occurred_at)
       VALUES ($1, 'D7_SMOKE_EFFECT', 'd7_smoke_worker', 'automation_outbox', $2, $3, $4::jsonb, now())`,
      [payload.markerId, task.id, tenantId, JSON.stringify({ idempotencyKey: task.idempotency_key })]
    );
    return { applied: true, taskId: task.id };
  };

  const workerA = new OutboxWorker({ lockTtlSeconds: 5 });
  const workerB = new OutboxWorker({ lockTtlSeconds: 5 });
  workerA.registerHandler('d7.smoke.effect', effectHandler);
  workerB.registerHandler('d7.smoke.effect', effectHandler);

  try {
    await insertTenant();

    // Two real PostgreSQL workers claim the same queue concurrently. FOR UPDATE
    // SKIP LOCKED must split ownership without duplicate effects.
    const batchTasks = await Promise.all(Array.from({ length: 4 }, async (_, index) => {
      const taskId = `d7-${suffix}-batch-${index}`;
      const idempotencyKey = `d7-${suffix}-batch-key-${index}`;
      const markerId = crypto.randomUUID();
      taskIds.push(taskId);
      idempotencyKeys.push(idempotencyKey);
      markerIds.push(markerId);
      return workerA.enqueueTask({
        id: taskId,
        tenantId,
        targetCell: cellId,
        eventName: 'd7.smoke.effect',
        payload: { markerId },
        idempotencyKey,
        maxAttempts: 3
      });
    }));
    recordCheck('D7 queue accepted four idempotent tasks', batchTasks.length === 4 && batchTasks.every((row) => row.status === 'pending'), batchTasks);
    await db.query(`UPDATE neem_automation_outbox SET next_run_at = now() - interval '1 second' WHERE tenant_id = $1 AND id = ANY($2::text[])`, [tenantId, taskIds]);

    const [workerAResult, workerBResult] = await Promise.all([
      workerA.processBatch({ batchSize: 2, workerId: 'd7-worker-a' }),
      workerB.processBatch({ batchSize: 2, workerId: 'd7-worker-b' })
    ]);
    recordCheck('D7 two workers split durable claims', workerAResult.processed.length > 0 && workerBResult.processed.length > 0 && workerAResult.batchProcessedCount + workerBResult.batchProcessedCount === 4, { workerA: workerAResult, workerB: workerBResult });

    const batchRows = await db.query(
      `SELECT status, count(*)::int AS count
       FROM neem_automation_outbox WHERE tenant_id = $1 AND id = ANY($2::text[])
       GROUP BY status`,
      [tenantId, taskIds]
    );
    const batchStatus = Object.fromEntries(batchRows.rows.map((row) => [row.status, row.count]));
    recordCheck('D7 all four tasks acknowledged', batchStatus.acknowledged === 4, batchStatus);

    const effects = await db.query(
      `SELECT count(*)::int AS count FROM neem_control_audit_events
       WHERE tenant_id = $1 AND action = 'D7_SMOKE_EFFECT' AND target_id = ANY($2::text[])`,
      [tenantId, taskIds]
    );
    recordCheck('D7 exactly-once local effects across two workers', effects.rows[0]?.count === 4, effects.rows[0]);

    const processed = await db.query(
      `SELECT count(*)::int AS count FROM neem_automation_processed_keys WHERE tenant_id = $1 AND idempotency_key = ANY($2::text[])`,
      [tenantId, idempotencyKeys]
    );
    recordCheck('D7 durable processed-key receipts persisted', processed.rows[0]?.count === 4, processed.rows[0]);

    // Simulate a crash after the destination committed the effect and inbox
    // receipt but before the sender recorded its ACK.
    const crashTaskId = `d7-${suffix}-crash`;
    const crashKey = `d7-${suffix}-crash-key`;
    const crashMarkerId = crypto.randomUUID();
    taskIds.push(crashTaskId);
    idempotencyKeys.push(crashKey);
    markerIds.push(crashMarkerId);
    await workerA.enqueueTask({
      id: crashTaskId,
      tenantId,
      targetCell: cellId,
      eventName: 'd7.smoke.effect',
      payload: { markerId: crashMarkerId },
      idempotencyKey: crashKey,
      maxAttempts: 3
    });
    const claimedCrash = await workerA.claimBatch({ batchSize: 1, workerId: 'd7-worker-a', lockDurationMs: 100 });
    assert.equal(claimedCrash.length, 1);
    await assert.rejects(
      workerA.dispatchExternalWithInboxAck(claimedCrash[0], workerA.receiverAdapter, {
        effectHandler,
        faultInjection: 'after_dispatch_before_ack',
        workerId: 'd7-worker-a'
      }),
      /Connection reset after receiver processed effect/
    );

    const crashInbox = await db.query(
      `SELECT status, ack_token IS NOT NULL AS has_ack FROM neem_cell_inbox WHERE idempotency_key = $1`,
      [crashKey]
    );
    const crashOutboxBeforeRetry = await db.query(
      `SELECT status FROM neem_automation_outbox WHERE id = $1`,
      [crashTaskId]
    );
    recordCheck('D7 crash window leaves completed inbox receipt but unacknowledged outbox', crashInbox.rows[0]?.status === 'completed' && crashInbox.rows[0]?.has_ack === true && crashOutboxBeforeRetry.rows[0]?.status === 'processing', { inbox: crashInbox.rows[0], outbox: crashOutboxBeforeRetry.rows[0] });

    await db.query(`UPDATE neem_automation_outbox SET locked_until = now() - interval '1 second', next_run_at = now() - interval '1 second' WHERE id = $1`, [crashTaskId]);
    const restarted = new OutboxWorker({ lockTtlSeconds: 5 });
    restarted.registerHandler('d7.smoke.effect', effectHandler);
    const restartResult = await restarted.processBatch({ batchSize: 1, workerId: 'd7-worker-b' });
    recordCheck('D7 restarted worker reclaims crash-window task', restartResult.processed[0]?.status === 'acknowledged', restartResult);

    const crashEffects = await db.query(
      `SELECT count(*)::int AS count FROM neem_control_audit_events WHERE tenant_id = $1 AND id = $2`,
      [tenantId, crashMarkerId]
    );
    const crashOutboxAfterRetry = await db.query(`SELECT status FROM neem_automation_outbox WHERE id = $1`, [crashTaskId]);
    recordCheck('D7 inbox dedup prevents duplicate effect after worker restart', crashEffects.rows[0]?.count === 1 && crashOutboxAfterRetry.rows[0]?.status === 'acknowledged', { effects: crashEffects.rows[0], outbox: crashOutboxAfterRetry.rows[0] });

    // Expired lease takeover: the stale worker must be fenced out.
    const fenceTaskId = `d7-${suffix}-fence`;
    const fenceKey = `d7-${suffix}-fence-key`;
    taskIds.push(fenceTaskId);
    idempotencyKeys.push(fenceKey);
    await workerA.enqueueTask({
      id: fenceTaskId,
      tenantId,
      targetCell: cellId,
      eventName: 'd7.smoke.effect',
      payload: { markerId: crypto.randomUUID() },
      idempotencyKey: fenceKey,
      maxAttempts: 3
    });
    await db.query(`UPDATE neem_automation_outbox SET next_run_at = now() - interval '1 second' WHERE id = $1`, [fenceTaskId]);
    const staleClaim = (await workerA.claimBatch({ batchSize: 1, workerId: 'd7-worker-a', lockDurationMs: 50 }))[0];
    assert.ok(staleClaim, 'D7 stale worker must claim the fencing fixture.');
    await new Promise((resolve) => setTimeout(resolve, 80));
    const successorClaim = (await workerB.claimBatch({ batchSize: 1, workerId: 'd7-worker-b', lockDurationMs: 5000 }))[0];
    recordCheck('D7 successor worker increments fencing token after lease expiry', Boolean(successorClaim) && Number(successorClaim.fencing_token) === Number(staleClaim.fencing_token) + 1, { stale: staleClaim, successor: successorClaim });
    await assert.rejects(
      workerA.executeTransactionalEffect(staleClaim, async () => ({ stale: true }), { workerId: 'd7-worker-a' }),
      /FENCING_TOKEN_MISMATCH/
    );
    recordCheck('D7 stale worker is rejected by fencing token', true);
    await workerB.acknowledgeTask(fenceTaskId, { workerId: 'd7-worker-b', fencingToken: successorClaim.fencing_token });

    // Unknown handlers must retry/DLQ on the real PostgreSQL schema, and an
    // incident must be recorded for operator action.
    const dlqTaskId = `d7-${suffix}-dlq`;
    const dlqKey = `d7-${suffix}-dlq-key`;
    taskIds.push(dlqTaskId);
    idempotencyKeys.push(dlqKey);
    await workerA.enqueueTask({
      id: dlqTaskId,
      tenantId,
      targetCell: cellId,
      eventName: 'd7.smoke.unknown',
      payload: {},
      idempotencyKey: dlqKey,
      maxAttempts: 1
    });
    const dlqResult = await workerA.processBatch({ batchSize: 1, workerId: 'd7-worker-a' });
    const dlqRow = await db.query(`SELECT status, last_error FROM neem_automation_outbox WHERE id = $1`, [dlqTaskId]);
    const incidentRow = await db.query(`SELECT count(*)::int AS count FROM neem_incidents WHERE affected_scope = $1 AND trigger_event = 'OUTBOX_DEAD_LETTER'`, [`${tenantId}:${cellId}`]);
    recordCheck('D7 unknown handler is fail-closed and dead-lettered', dlqResult.processed[0]?.status === 'dead_letter' && dlqRow.rows[0]?.status === 'dead_letter' && String(dlqRow.rows[0]?.last_error).includes('NO_HANDLER_REGISTERED'), { result: dlqResult, row: dlqRow.rows[0] });
    recordCheck('D7 dead-letter incident is recorded', incidentRow.rows[0]?.count === 1, incidentRow.rows[0]);

    const final = await db.query(
      `SELECT
        (SELECT count(*) FROM neem_automation_outbox WHERE tenant_id = $1 AND status = 'acknowledged')::int AS acknowledged,
        (SELECT count(*) FROM neem_cell_inbox WHERE tenant_id = $1 AND status = 'completed')::int AS inbox_completed,
        (SELECT count(*) FROM neem_automation_processed_keys WHERE tenant_id = $1)::int AS processed_receipts`,
      [tenantId]
    );
    console.log(JSON.stringify({ ok: true, tenantId, checks, final: final.rows[0] }, null, 2));
  } finally {
    await db.query(`DELETE FROM neem_control_audit_events WHERE tenant_id = $1 AND (action = 'D7_SMOKE_EFFECT' OR target_id = ANY($2::text[]))`, [tenantId, taskIds]).catch(() => {});
    await db.query(`DELETE FROM neem_incidents WHERE affected_scope = $1 AND trigger_event IN ('OUTBOX_DEAD_LETTER', 'OUTBOX_RETRY_SCHEDULED')`, [`${tenantId}:${cellId}`]).catch(() => {});
    await db.query(`DELETE FROM neem_cell_inbox WHERE tenant_id = $1`, [tenantId]).catch(() => {});
    await db.query(`DELETE FROM neem_automation_processed_keys WHERE tenant_id = $1`, [tenantId]).catch(() => {});
    await db.query(`DELETE FROM neem_automation_outbox WHERE tenant_id = $1`, [tenantId]).catch(() => {});
    await db.query(`DELETE FROM neem_tenants WHERE tenant_id = $1`, [tenantId]).catch(() => {});
    await db.end?.().catch?.(() => {});
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
