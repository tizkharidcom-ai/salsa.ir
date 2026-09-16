// server/neem/control-plane/automation/outbox-worker.js
'use strict';

/**
 * NEEM Transactional Outbox & Resilient Delivery Worker (Phase 6 / GM-25 / P0 Hardening)
 *
 * Guaranteed Delivery Invariant:
 * Physical network transport across distributed cell/remote boundaries is AT-LEAST-ONCE.
 * Network "exactly-once" cannot be achieved via simple in-memory Sets or un-coordinated post-effect keys.
 * Deduplication and correctness are guaranteed via:
 *   1. Local side-effects: Co-located atomic database transaction (executeTransactionalEffect: effect + receipt).
 *   2. Remote side-effects: Recipient Inbox Deduplication (InboxReceiverAdapter / neem_cell_inbox) with signed ACK tokens.
 *   3. Concurrency & Zombie Worker Safety: Monotonic fencing tokens and ownership lease validation.
 *      Expired or superseded workers cannot overwrite or acknowledge tasks claimed by new workers.
 *   4. Fail-Closed on Missing Handlers: Unknown task events throw immediately, schedule retries, or route to DLQ
 *      with zero false positive acknowledgments.
 */

const crypto = require('crypto');
const { getDatabase, getDatabaseClient } = require('../db/database');
const auditService = require('../audit/audit-service');
const syncStateService = require('./sync-state-service');

function safeParseJson(val, fallback = {}) {
  if (val === null || val === undefined) return fallback;
  if (typeof val === 'object') return val;
  if (typeof val !== 'string') return fallback;
  try {
    return JSON.parse(val);
  } catch {
    return fallback;
  }
}

class InboxReceiverAdapter {
  constructor(db = null, { ackSecret = null, leaseDurationMs = 30000 } = {}) {
    this.db = db || getDatabase();
    const envSecret = process.env.NEEM_INBOX_ACK_SECRET;
    const isTest = process.env.NODE_ENV === 'test' || process.env.NEEM_ENV === 'test';
    const effectiveSecret = ackSecret || envSecret || (isTest ? 'test_ephemeral_inbox_ack_secret' : null);
    if (!effectiveSecret) {
      throw new Error('CONFIG_ERROR_FAIL_CLOSED: NEEM_INBOX_ACK_SECRET must be configured in non-test environments.');
    }
    this.ackSecret = effectiveSecret;
    this.leaseDurationMs = leaseDurationMs;
  }

  computePayloadDigest(payload) {
    const canonicalJson = JSON.stringify(payload || {});
    return crypto.createHash('sha256').update(canonicalJson).digest('hex');
  }

  generateAckToken(idempotencyKey, cellId, tenantId = null, taskType = null, payloadDigest = null) {
    let key = idempotencyKey;
    let cell = cellId;
    let tenant = tenantId;
    let task = taskType;
    let digest = payloadDigest;
    if (typeof idempotencyKey === 'object' && idempotencyKey !== null) {
      key = idempotencyKey.idempotencyKey;
      cell = idempotencyKey.cellId;
      tenant = idempotencyKey.tenantId;
      task = idempotencyKey.taskType;
      digest = idempotencyKey.payloadDigest;
    }

    const boundPayload = `${key}:${cell}:${tenant || ''}:${task || ''}:${digest || ''}`;
    const sig = crypto.createHmac('sha256', this.ackSecret)
      .update(boundPayload)
      .digest('hex').slice(0, 32);

    if (tenant || task || digest) {
      const meta = Buffer.from(JSON.stringify({ t: tenant, k: task, d: digest })).toString('base64url');
      return `ack_${meta}.${sig}`;
    }

    return `ack_${sig}`;
  }

  verifyAckToken(ackToken, idempotencyKey, cellId, tenantId = null, taskType = null, payloadDigest = null) {
    if (!ackToken || typeof ackToken !== 'string' || !ackToken.startsWith('ack_')) return false;

    let key = typeof idempotencyKey === 'object' ? idempotencyKey.idempotencyKey : idempotencyKey;
    let cell = typeof idempotencyKey === 'object' ? idempotencyKey.cellId : cellId;
    let tenant = typeof idempotencyKey === 'object' ? idempotencyKey.tenantId : tenantId;
    let task = typeof idempotencyKey === 'object' ? idempotencyKey.taskType : taskType;
    let digest = typeof idempotencyKey === 'object' ? idempotencyKey.payloadDigest : payloadDigest;

    const raw = ackToken.slice(4);
    if (raw.includes('.')) {
      const [metaStr, sig] = raw.split('.');
      try {
        const meta = JSON.parse(Buffer.from(metaStr, 'base64url').toString('utf8'));
        const effTenant = tenant || meta.t;
        const effTask = task || meta.k;
        const effDigest = digest || meta.d;

        if (tenant && meta.t && tenant !== meta.t) return false;
        if (task && meta.k && task !== meta.k) return false;
        if (digest && meta.d && digest !== meta.d) return false;

        const boundPayload = `${key}:${cell}:${effTenant || ''}:${effTask || ''}:${effDigest || ''}`;
        const expectedSig = crypto.createHmac('sha256', this.ackSecret)
          .update(boundPayload)
          .digest('hex').slice(0, 32);

        if (sig.length !== expectedSig.length) return false;
        return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig));
      } catch {
        return false;
      }
    }

    // Single-segment token verification
    const boundPayload = `${key}:${cell}`;
    const expectedSig = crypto.createHmac('sha256', this.ackSecret)
      .update(boundPayload)
      .digest('hex').slice(0, 32);
    const expected = `ack_${expectedSig}`;
    if (ackToken.length !== expected.length) return false;
    return crypto.timingSafeEqual(Buffer.from(ackToken), Buffer.from(expected));
  }

  /**
   * Receives an inbound task at a cell/remote destination with durable deduplication and separation of
   * in-progress claims from completed receipts.
   */
  async receive({
    id,
    tenantId,
    cellId,
    sourceOutboxId,
    idempotencyKey,
    taskType,
    payload,
    effectHandler = null,
    faultInjection = null,
    leaseDurationMs = null
  }) {
    if (!idempotencyKey || !cellId || !tenantId) {
      throw new Error('INBOX_RECEIVER_ERROR: idempotencyKey, cellId, and tenantId are required.');
    }

    const payloadDigest = this.computePayloadDigest(payload);
    const effLeaseMs = leaseDurationMs || this.leaseDurationMs;

    // Execute effect and receipt on a single dedicated connection in a transaction with rollback!
    const client = await getDatabaseClient(this.db);
    await client.query('BEGIN');

    try {
      // 1. Check if already in neem_cell_inbox
      const existingRes = await client.query(
        'SELECT * FROM neem_cell_inbox WHERE idempotency_key = $1',
        [idempotencyKey]
      );

      let isRetryOfInProgress = false;
      if (existingRes.rows && existingRes.rows.length > 0) {
        const record = existingRes.rows[0];

        // Cryptographic / Semantic Binding check: Mismatched tenant, cell, taskType, or payload digest must FAIL
        const existingDigest = record.payload_digest;
        if (
          (record.tenant_id && record.tenant_id !== tenantId) ||
          (record.cell_id && record.cell_id !== cellId) ||
          (record.task_type && taskType && record.task_type !== taskType) ||
          (existingDigest && existingDigest !== payloadDigest)
        ) {
          throw new Error(`IDEMPOTENCY_KEY_PAYLOAD_MISMATCH: Idempotency key '${idempotencyKey}' already exists with different payload digest or tenant.`);
        }

        // Check if already successfully processed & committed
        if (record.status === 'completed' || (record.processed_at && record.ack_token)) {
          await client.query('COMMIT');
          return {
            status: 'deduplicated',
            idempotencyKey,
            ackToken: record.ack_token,
            responsePayload: record.response_payload,
            alreadyProcessed: true
          };
        }

        // Record is in_progress (previous crash, exception, or retry)
        // Lease control: if locked_until is active (in the future), another receiver is currently running!
        if (record.locked_until && new Date(record.locked_until) > new Date()) {
          throw new Error(`CONCURRENT_RECEIVER_ACTIVE: Task '${idempotencyKey}' is currently in progress by another receiver (lease active until ${record.locked_until.toISOString ? record.locked_until.toISOString() : record.locked_until}).`);
        }

        isRetryOfInProgress = true;
      }

      const lockUntil = new Date(Date.now() + effLeaseMs);

      if (isRetryOfInProgress) {
        // Re-claim lease atomically on the in-progress record for this retry attempt
        const updateRes = await client.query(
          `UPDATE neem_cell_inbox
           SET locked_until = $1, attempts = COALESCE(attempts, 0) + 1
           WHERE idempotency_key = $2 AND (locked_until IS NULL OR locked_until < now())`,
          [lockUntil, idempotencyKey]
        );
        if (updateRes.rowCount === 0) {
          throw new Error(`CONCURRENT_RECEIVER_ACTIVE: Failed to acquire lease for task '${idempotencyKey}' due to concurrent claim.`);
        }
      } else {
        // Insert new in-progress claim into neem_cell_inbox
        const inboxId = id || ('inbox_' + crypto.randomUUID().slice(0, 16));
        await client.query(
          `INSERT INTO neem_cell_inbox
            (id, tenant_id, cell_id, source_outbox_id, idempotency_key, task_type, payload, payload_digest, status, locked_until, ack_token, received_at, attempts)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'in_progress', $9, null, now(), 1)`,
          [
            inboxId,
            tenantId,
            cellId,
            sourceOutboxId || 'unknown',
            idempotencyKey,
            taskType || 'unknown',
            JSON.stringify(payload || {}),
            payloadDigest,
            lockUntil
          ]
        );
      }

      // 2. Execute effect handler if provided (passes payload AND dedicated client)
      let responsePayload = { received: true, processedAt: new Date().toISOString() };
      if (effectHandler) {
        if (faultInjection === 'before_effect') {
          throw new Error('FAULT_INJECTED_BEFORE_EFFECT');
        }
        const handlerResult = await effectHandler(payload, client);
        if (handlerResult !== undefined && handlerResult !== null) {
          if (handlerResult === false || handlerResult.success === false || handlerResult.status === 'failed' || handlerResult.error) {
            throw new Error(`EFFECT_HANDLER_FAILED: ${handlerResult.error || 'Handler signaled failure (success=false)'}`);
          }
          responsePayload = handlerResult;
        }
        if (faultInjection === 'after_effect_before_commit') {
          throw new Error('FAULT_INJECTED_AFTER_EFFECT_BEFORE_COMMIT');
        }
      }

      // 3. Effect succeeded! Generate cryptographically bound ACK token and commit completed receipt
      const ackToken = this.generateAckToken(idempotencyKey, cellId, tenantId, taskType, payloadDigest);

      await client.query(
        `UPDATE neem_cell_inbox
         SET status = 'completed', processed_at = now(), ack_token = $1, response_payload = $2, locked_until = null
         WHERE idempotency_key = $3`,
        [ackToken, JSON.stringify(responsePayload), idempotencyKey]
      );

      if (faultInjection === 'before_commit') {
        throw new Error('FAULT_INJECTED_BEFORE_COMMIT');
      }

      await client.query('COMMIT');

      if (faultInjection === 'after_commit_before_ack') {
        throw new Error('FAULT_INJECTED_AFTER_COMMIT_BEFORE_ACK');
      }

      return {
        status: 'processed',
        idempotencyKey,
        ackToken,
        responsePayload
      };
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch (_) {}
      throw err;
    } finally {
      client.release();
    }
  }
}

class OutboxWorker {
  constructor({ lockTtlSeconds = 30, ackSecret = null, receiverAdapter = null } = {}) {
    this.db = getDatabase();
    this.lockTtlSeconds = lockTtlSeconds;
    this.deliveredIds = new Set();
    this.processedKeys = this.deliveredIds;
    this.handlers = new Map();
    // Let InboxReceiverAdapter resolve the environment secret itself. Passing a
    // hardcoded test secret here would silently bypass its production fail-closed
    // configuration guard whenever a worker was constructed without options.
    this.receiverAdapter = receiverAdapter || new InboxReceiverAdapter(
      this.db,
      ackSecret ? { ackSecret } : {}
    );
    this.registerDefaultHandlers();
  }

  registerHandler(eventName, handler) {
    this.handlers.set(eventName, handler);
  }

  registerDefaultHandlers() {
    registerStandardHandlers(this);
    return this;
  }

  /**
   * Enqueues a scheduled task or event into the transactional outbox
   */
  async enqueueTask({
    tenantId,
    targetCell = 'cell-teh-01',
    eventName,
    payload = {},
    idempotencyKey = null,
    delaySeconds = 0,
    maxAttempts = 3,
    id = null
  }) {
    if (!tenantId || !eventName) {
      throw new Error('OUTBOX_ERROR: tenantId and eventName are required.');
    }

    const key = idempotencyKey || `auto_${tenantId}_${eventName}_${Date.now()}`;
    const taskId = id || ('task_' + crypto.randomUUID().slice(0, 16));
    const nextRunAt = new Date(Date.now() + delaySeconds * 1000);

    const sql = `
      INSERT INTO neem_automation_outbox
        (id, tenant_id, target_cell, event_name, payload, idempotency_key, status, next_run_at, max_attempts)
      VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7, $8)
      ON CONFLICT (idempotency_key) DO NOTHING
      RETURNING *
    `;

    const res = await this.db.query(sql, [
      taskId,
      tenantId,
      targetCell,
      eventName,
      JSON.stringify(payload),
      key,
      nextRunAt,
      maxAttempts
    ]);

    return res.rows[0] || { idempotencyKey: key, status: 'already_queued' };
  }

  async enqueue(options) {
    const tenantId = options.tenantId || options.tenant_id;
    const targetCell = options.targetCell || options.target_cell || 'cell-teh-01';
    const eventName = options.eventName || options.event_name || options.event_type;
    const payload = options.payload || {};
    const idempotencyKey = options.idempotencyKey || options.idempotency_key;
    const delaySeconds = options.delaySeconds || options.delay_seconds || 0;
    const maxAttempts = options.maxAttempts || options.max_attempts || 3;
    const id = options.id;
    return this.enqueueTask({ tenantId, targetCell, eventName, payload, idempotencyKey, delaySeconds, maxAttempts, id });
  }

  /**
   * Atomically claims a batch of tasks using PostgreSQL FOR UPDATE SKIP LOCKED
   * or memory equivalent, assigning worker_id, lease_token, and incrementing fencing_token.
   */
  async claimBatch({ batchSize = null, limit = null, workerId = null, lockTtlSeconds = null, lockDurationMs = null } = {}) {
    const ttlMs = lockDurationMs !== null && lockDurationMs !== undefined
      ? lockDurationMs
      : ((lockTtlSeconds || this.lockTtlSeconds) * 1000);
    const lockUntil = new Date(Date.now() + ttlMs);
    const assignedWorkerId = workerId || `worker_${crypto.randomUUID().slice(0, 8)}`;
    const effectiveLimit = batchSize || limit || 10;
    const leaseToken = `lease_${crypto.randomUUID().slice(0, 12)}`;

    const claimSql = `
      UPDATE neem_automation_outbox
      SET status = 'processing',
          locked_until = $1,
          attempts = attempts + 1,
          worker_id = $2,
          lease_token = $3,
          fencing_token = COALESCE(fencing_token, 0) + 1
      WHERE id IN (
        SELECT id FROM neem_automation_outbox
        WHERE (status = 'pending' OR (status = 'processing' AND locked_until < now()))
          AND next_run_at <= now()
        ORDER BY next_run_at ASC
        LIMIT $4
        FOR UPDATE SKIP LOCKED
      )
      RETURNING *;
    `;

    const res = await this.db.query(claimSql, [lockUntil, assignedWorkerId, leaseToken, effectiveLimit]);
    const tasks = res.rows || [];
    tasks.workerId = assignedWorkerId;
    tasks.tasks = tasks;
    return tasks;
  }

  /**
   * Extends the ownership lease for a currently claimed task as long as the fencing token matches.
   */
  async renewLease({ taskId, workerId, fencingToken, lockDurationMs = 30000 }) {
    const lockUntil = new Date(Date.now() + lockDurationMs);
    const res = await this.db.query(
      `UPDATE neem_automation_outbox
       SET locked_until = $1
       WHERE id = $2 AND worker_id = $3 AND fencing_token = $4
       RETURNING *`,
      [lockUntil, taskId, workerId, fencingToken]
    );
    return { success: res.rowCount > 0, task: res.rows[0] || null };
  }

  /**
   * Processes a single worker batch with atomic claim, fencing token verification,
   * fail-closed missing handler detection, and exponential backoff retry.
   */
  async processBatch({ batchSize = 10, targetHandler = null, workerId = null, lockDurationMs = null, backoffBaseSeconds = null, receiverAdapter = null } = {}) {
    const claimRes = await this.claimBatch({ batchSize, workerId, lockDurationMs });
    const tasks = Array.isArray(claimRes) ? claimRes : (claimRes.tasks || []);
    const activeWorkerId = claimRes.workerId || workerId || 'worker_default';
    const processed = [];
    const effectiveReceiver = receiverAdapter || this.receiverAdapter;

    for (const item of tasks) {
      try {
        // 1. Durable Idempotency Check in Database (AC-28)
        let isAlreadyProcessed = this.deliveredIds.has(item.idempotency_key);
        if (!isAlreadyProcessed) {
          const durableCheck = await this.db.query(
            'SELECT idempotency_key FROM neem_automation_processed_keys WHERE idempotency_key = $1',
            [item.idempotency_key]
          );
          if (durableCheck.rows && durableCheck.rows.length > 0) {
            isAlreadyProcessed = true;
          }
        }

        if (isAlreadyProcessed) {
          const ackRes = await this.db.query(
            `UPDATE neem_automation_outbox 
             SET status = 'acknowledged', acknowledged_at = now(), locked_until = null 
             WHERE id = $1 AND status = 'processing' AND worker_id = $2 AND fencing_token = $3 AND (locked_until IS NULL OR locked_until >= now())
             RETURNING *`,
            [item.id, activeWorkerId, item.fencing_token]
          );
          if (ackRes.rowCount === 0) {
            throw new Error(`FENCING_TOKEN_MISMATCH: Worker ${activeWorkerId} lost lease or expired on deduped task ${item.id}`);
          }
          this.deliveredIds.add(item.idempotency_key);
          processed.push({ id: item.id, status: 'acknowledged_deduped' });
          continue;
        }

        // 2. Execute Handler - FAIL-CLOSED: No registered handler MUST NOT succeed
        const handler = targetHandler || this.handlers.get(item.event_name);
        if (!handler) {
          throw new Error(`NO_HANDLER_REGISTERED: No registered worker handler for event '${item.event_name}' (task id: ${item.id})`);
        }

        // 3. Real Dispatch via Transactional Contract (dispatchExternalWithInboxAck or executeTransactionalEffect)
        let dispatchResult;
        if (effectiveReceiver && item.target_cell) {
          dispatchResult = await this.dispatchExternalWithInboxAck(item, effectiveReceiver, {
            effectHandler: handler,
            workerId: activeWorkerId
          });
        } else {
          dispatchResult = await this.executeTransactionalEffect(item, handler, {
            workerId: activeWorkerId
          });
        }

        // Also persist in neem_automation_processed_keys for durable local deduplication
        await this.db.query(
          `INSERT INTO neem_automation_processed_keys (idempotency_key, task_id, tenant_id)
           VALUES ($1, $2, $3)
           ON CONFLICT DO NOTHING`,
          [item.idempotency_key, item.id, item.tenant_id]
        );

        this.deliveredIds.add(item.idempotency_key);

        // Fail-safe: Resolve open retry incident on successful delivery
        try {
          await syncStateService.resolveSyncIncident({
            tenantId: item.tenant_id,
            cellId: item.target_cell,
            triggerEvent: 'OUTBOX_RETRY_SCHEDULED'
          });
        } catch (resolveErr) {}

        const handlerRes = dispatchResult.receipt ? dispatchResult.receipt.responsePayload : dispatchResult.effectResult;
        processed.push({
          id: item.id,
          status: 'acknowledged',
          workerId: activeWorkerId,
          result: handlerRes,
          ackToken: dispatchResult.receipt ? dispatchResult.receipt.ackToken : undefined
        });

      } catch (err) {
        if (err.message.includes('FENCING_TOKEN_MISMATCH') || err.message.includes('FENCING_OR_LEASE')) {
          // The current worker has lost ownership or lease expired; interloper or subsequent worker owns the task.
          // The expired worker MUST NOT alter the task record or schedule a retry!
          processed.push({ id: item.id, status: 'superseded', error: err.message });
          continue;
        }

        const nextAttempts = (item.attempts || 0);
        if (nextAttempts >= (item.max_attempts || 5)) {
          // Dead letter with fencing token
          const dlqRes = await this.db.query(
            `UPDATE neem_automation_outbox 
             SET status = 'dead_letter', last_error = $1, locked_until = null 
             WHERE id = $2 AND status = 'processing' AND worker_id = $3 AND fencing_token = $4
             RETURNING *`,
            [err.message, item.id, activeWorkerId, item.fencing_token]
          );

          if (dlqRes.rowCount === 0) {
            console.warn(`[OutboxWorker] Fence mismatch on dead_letter update for task ${item.id}`);
          }

          // Record Dead Letter Incident in neem_incidents
          let incident = null;
          try {
            const incResult = await syncStateService.recordSyncIncident({
              tenantId: item.tenant_id,
              cellId: item.target_cell,
              triggerEvent: 'OUTBOX_DEAD_LETTER',
              severity: 'sev2_major',
              title: `Outbox Dead Letter: ${item.event_name} on ${item.target_cell}`,
              rootCause: `Exceeded max_attempts (${item.max_attempts || 5}). Final error: ${err.message}`,
              mitigationActions: [
                { action: 'quarantine_task_to_dlq', taskId: item.id, idempotencyKey: item.idempotency_key },
                { action: 'check_cell_connectivity', cellId: item.target_cell }
              ]
            });
            incident = incResult.incident;
          } catch (incErr) {
            console.warn('[OutboxWorker] Incident recording failed (fail-safe):', incErr.message);
          }

          processed.push({ id: item.id, status: 'dead_letter', error: err.message, incidentId: incident?.id });
        } else {
          // Exponential backoff: base ^ attempts seconds with fencing token
          const backoffSec = (backoffBaseSeconds !== null && backoffBaseSeconds !== undefined)
            ? (backoffBaseSeconds === 0 ? 0 : Math.pow(backoffBaseSeconds, nextAttempts))
            : Math.pow(2, nextAttempts);
          const nextRun = new Date(Date.now() + backoffSec * 1000);
          const retryRes = await this.db.query(
            `UPDATE neem_automation_outbox 
             SET status = 'pending', next_run_at = $1, last_error = $2, locked_until = null 
             WHERE id = $3 AND worker_id = $4 AND fencing_token = $5
             RETURNING *`,
            [nextRun, err.message, item.id, activeWorkerId, item.fencing_token]
          );

          if (retryRes.rowCount === 0) {
            console.warn(`[OutboxWorker] Fence mismatch on retry update for task ${item.id}`);
          }

          // Record/Deduplicate Retry Incident in neem_incidents
          let incident = null;
          try {
            const incResult = await syncStateService.recordSyncIncident({
              tenantId: item.tenant_id,
              cellId: item.target_cell,
              triggerEvent: 'OUTBOX_RETRY_SCHEDULED',
              severity: 'sev3_minor',
              title: `Outbox Delivery Delayed: ${item.event_name} on ${item.target_cell}`,
              rootCause: `Attempt ${nextAttempts} failed: ${err.message}`,
              mitigationActions: [
                { action: 'scheduled_retry_backoff', taskId: item.id, attempt: nextAttempts, nextRun: nextRun.toISOString() }
              ]
            });
            incident = incResult.incident;
          } catch (incErr) {
            console.warn('[OutboxWorker] Incident recording failed (fail-safe):', incErr.message);
          }

          processed.push({ id: item.id, status: 'retry_scheduled', nextRunAt: nextRun, incidentId: incident?.id });
        }
      }
    }

    return {
      batchProcessedCount: processed.length,
      workerId: activeWorkerId,
      processed
    };
  }

  /**
   * Co-located atomic effect + receipt for local database operations.
   * Executes effectFn inside a single database transaction along with the durable processed_keys receipt
   * and outbox ACK. If a crash or error occurs before COMMIT, the entire transaction is rolled back,
   * guaranteeing no orphan partial effects and no false acknowledgments.
   */
  async executeTransactionalEffect(task, effectFn, { workerId = null } = {}) {
    const activeWorkerId = workerId || task.worker_id;
    const fencingToken = task.fencing_token;
    const client = await getDatabaseClient(this.db);

    await client.query('BEGIN');
    try {
      // 1. Check if already processed durably within transaction
      const checkRes = await client.query(
        'SELECT idempotency_key FROM neem_automation_processed_keys WHERE idempotency_key = $1',
        [task.idempotency_key]
      );
      if (checkRes.rows && checkRes.rows.length > 0) {
        let dedupAckRes;
        if (activeWorkerId && fencingToken !== undefined && fencingToken !== null) {
          dedupAckRes = await client.query(
            `UPDATE neem_automation_outbox
             SET status = 'acknowledged', acknowledged_at = now(), locked_until = null
             WHERE id = $1 AND worker_id = $2 AND fencing_token = $3 AND (locked_until IS NULL OR locked_until >= now())`,
            [task.id, activeWorkerId, fencingToken]
          );
        } else {
          dedupAckRes = await client.query(
            `UPDATE neem_automation_outbox
             SET status = 'acknowledged', acknowledged_at = now(), locked_until = null
             WHERE id = $1`,
            [task.id]
          );
        }
        if (dedupAckRes.rowCount === 0) {
          throw new Error(`FENCING_TOKEN_MISMATCH: Task ${task.id} could not be acknowledged during durable deduplication.`);
        }
        await client.query('COMMIT');
        this.deliveredIds.add(task.idempotency_key);
        return { status: 'acknowledged_deduped', alreadyProcessed: true };
      }

      // 2. Run the business side-effect on dedicated connection
      const effectResult = await effectFn(task, client);
      if (effectResult !== undefined && effectResult !== null) {
        if (effectResult === false || effectResult.success === false || effectResult.status === 'failed' || effectResult.error) {
          throw new Error(`EFFECT_HANDLER_FAILED: ${effectResult.error || 'Handler returned success=false'}`);
        }
      }

      // 3. Co-locate receipt insertion in the exact same transaction
      await client.query(
        `INSERT INTO neem_automation_processed_keys (idempotency_key, task_id, tenant_id)
         VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING`,
        [task.idempotency_key, task.id, task.tenant_id]
      );

      // 4. Update outbox status to acknowledged with fencing token verification
      let ackRes;
      if (activeWorkerId && fencingToken !== undefined && fencingToken !== null) {
        ackRes = await client.query(
          `UPDATE neem_automation_outbox
           SET status = 'acknowledged', acknowledged_at = now(), locked_until = null
           WHERE id = $1 AND status = 'processing' AND worker_id = $2 AND fencing_token = $3 AND (locked_until IS NULL OR locked_until >= now())
           RETURNING *`,
          [task.id, activeWorkerId, fencingToken]
        );
        if (ackRes.rowCount === 0) {
          throw new Error(`FENCING_TOKEN_MISMATCH: Task ${task.id} lost lease during transactional effect (worker=${activeWorkerId}, fencingToken=${fencingToken})`);
        }
      } else {
        ackRes = await client.query(
          `UPDATE neem_automation_outbox
           SET status = 'acknowledged', acknowledged_at = now(), locked_until = null
           WHERE id = $1
           RETURNING *`,
          [task.id]
        );
      }

      await client.query('COMMIT');
      this.deliveredIds.add(task.idempotency_key);
      return { status: 'acknowledged', effectResult };
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch (_) {}
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Dispatches task to a remote cell or external destination adapter with signed ACK token verification.
   */
  async dispatchExternalWithInboxAck(task, receiverAdapter = null, { effectHandler = null, faultInjection = null, workerId = null } = {}) {
    const activeWorkerId = workerId || task.worker_id;
    const fencingToken = task.fencing_token;
    const effectiveReceiver = receiverAdapter || this.receiverAdapter;

    if (faultInjection === 'before_dispatch') {
      throw new Error('FAULT_INJECTED: Network partition before dispatching to destination.');
    }

    const inboundPayload = safeParseJson(task.payload, {});
    const payloadDigest = (typeof effectiveReceiver.computePayloadDigest === 'function')
      ? effectiveReceiver.computePayloadDigest(inboundPayload)
      : crypto.createHash('sha256').update(JSON.stringify(inboundPayload || {})).digest('hex');

    const receipt = await effectiveReceiver.receive({
      tenantId: task.tenant_id,
      cellId: task.target_cell || 'cell-teh-01',
      sourceOutboxId: task.id,
      idempotencyKey: task.idempotency_key,
      taskType: task.event_name,
      payload: inboundPayload,
      effectHandler: effectHandler ? async (p, client) => {
        return effectHandler(task, client);
      } : null
    });

    if (faultInjection === 'after_dispatch_before_ack') {
      throw new Error('FAULT_INJECTED: Connection reset after receiver processed effect but before client recorded ACK.');
    }

    const isValidAck = effectiveReceiver.verifyAckToken(
      receipt ? receipt.ackToken : null,
      task.idempotency_key,
      task.target_cell || 'cell-teh-01',
      task.tenant_id,
      task.event_name,
      payloadDigest
    );
    if (!isValidAck) {
      throw new Error(`INVALID_ACK_TOKEN: Receiver returned unrecognized, falsified, or tampered ACK token: ${receipt ? receipt.ackToken : 'undefined'}`);
    }

    const ackRes = await this.db.query(
      `UPDATE neem_automation_outbox
       SET status = 'acknowledged', acknowledged_at = now(), locked_until = null
       WHERE id = $1 AND worker_id = $2 AND fencing_token = $3 AND (locked_until IS NULL OR locked_until >= now())
       RETURNING *`,
      [task.id, activeWorkerId, fencingToken]
    );

    if (ackRes.rowCount === 0) {
      throw new Error(`FENCING_TOKEN_MISMATCH: Task ${task.id} was superseded before external ACK could be recorded.`);
    }

    this.deliveredIds.add(task.idempotency_key);
    return {
      status: 'acknowledged',
      receipt
    };
  }

  async acknowledgeTask(taskId, { workerId = null, fencingToken = null } = {}) {
    let sql = `UPDATE neem_automation_outbox SET status = 'acknowledged', acknowledged_at = now(), locked_until = null WHERE id = $1`;
    const params = [taskId];
    if (workerId !== null && fencingToken !== null) {
      sql += ` AND worker_id = $2 AND fencing_token = $3`;
      params.push(workerId, fencingToken);
    }
    sql += ' RETURNING *';
    const res = await this.db.query(sql, params);
    return res.rows[0] || null;
  }

  /**
   * Manually retries a failed or dead-letter task (GM-25 action)
   */
  async retryTask(taskId, actorId = 'platform_operator') {
    const currentRes = await this.db.query(
      'SELECT * FROM neem_automation_outbox WHERE id = $1',
      [taskId]
    );
    const current = currentRes.rows?.[0];
    if (!current) return null;
    if (!['failed', 'dead_letter', 'cancelled'].includes(current.status)) {
      const err = new Error(`TASK_NOT_RETRYABLE: Task '${taskId}' is '${current.status}' and cannot be manually retried.`);
      err.code = 'TASK_NOT_RETRYABLE';
      err.status = 409;
      throw err;
    }

    const sql = `
      UPDATE neem_automation_outbox
      SET status = 'pending',
          next_run_at = now(),
          locked_until = null,
          worker_id = null,
          lease_token = null,
          fencing_token = COALESCE(fencing_token, 0) + 1,
          attempts = 0
      WHERE id = $1 AND status IN ('failed', 'dead_letter', 'cancelled')
      RETURNING *
    `;
    const res = await this.db.query(sql, [taskId]);
    const updated = res.rows[0];
    if (updated) {
      await auditService.recordEvent({
        actorId,
        action: 'AUTOMATION_TASK_RETRIED',
        targetType: 'automation_outbox',
        targetId: taskId,
        tenantId: updated.tenant_id,
        metadata: { eventName: updated.event_name }
      });
    }
    return updated || null;
  }

  /**
   * Manually cancels a pending or dead-letter task (GM-25 action)
   */
  async cancelTask(taskId, reason = 'Cancelled by operator', actorId = 'platform_operator') {
    const currentRes = await this.db.query(
      'SELECT * FROM neem_automation_outbox WHERE id = $1',
      [taskId]
    );
    const current = currentRes.rows?.[0];
    if (!current) return null;
    if (!['pending', 'failed', 'dead_letter'].includes(current.status)) {
      const err = new Error(`TASK_NOT_CANCELLABLE: Task '${taskId}' is '${current.status}' and cannot be cancelled without a fencing token.`);
      err.code = 'TASK_NOT_CANCELLABLE';
      err.status = 409;
      throw err;
    }

    const sql = `
      UPDATE neem_automation_outbox
      SET status = 'cancelled',
          last_error = $1,
          locked_until = null,
          worker_id = null,
          lease_token = null,
          fencing_token = COALESCE(fencing_token, 0) + 1
      WHERE id = $2 AND status IN ('pending', 'failed', 'dead_letter')
      RETURNING *
    `;
    const res = await this.db.query(sql, [reason, taskId]);
    const updated = res.rows[0];
    if (updated) {
      await auditService.recordEvent({
        actorId,
        action: 'AUTOMATION_TASK_CANCELLED',
        targetType: 'automation_outbox',
        targetId: taskId,
        tenantId: updated.tenant_id,
        metadata: { reason }
      });
    }
    return updated || null;
  }

  /**
   * Lists outbox tasks with optional filters
   */
  async listTasks({ tenantId = null, status = null, limit = 50 } = {}) {
    let sql = 'SELECT * FROM neem_automation_outbox';
    const params = [];
    const conditions = [];

    if (tenantId) {
      params.push(tenantId);
      conditions.push(`tenant_id = $${params.length}`);
    }
    if (status) {
      params.push(status);
      conditions.push(`status = $${params.length}`);
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }

    sql += ' ORDER BY created_at DESC';
    if (limit) {
      params.push(limit);
      conditions.push(` LIMIT $${params.length}`);
    }

    const res = await this.db.query(sql, params);
    return res.rows;
  }

  reset() {
    this.deliveredIds.clear();
  }
}

const defaultOutboxWorker = new OutboxWorker();
defaultOutboxWorker.OutboxWorker = OutboxWorker;
defaultOutboxWorker.InboxReceiverAdapter = InboxReceiverAdapter;

// =========================================================================
// Real Production Default Handlers (Phase 6 / GM-25 / P0 Hardening)
// =========================================================================

const ALLOWED_AUTOMATION_ACTIONS = new Set([
  'suspend_tenant',
  'revoke_entitlement',
  'record_audit',
  'quarantine_tenant',
  'flag_review',
  'sync_cell'
]);

function registerStandardHandlers(worker) {
  // 1. tenant.suspend: Real Tenant Suspension with Version CAS & Safe Concurrency
  worker.registerHandler('tenant.suspend', async (task, txClient) => {
    const dbClient = txClient || worker.db;
    const tenantId = task.tenant_id;
    const payload = safeParseJson(task.payload, {});

  const tenantRes = await dbClient.query(
    'SELECT tenant_id, status, metadata, version FROM neem_tenants WHERE tenant_id = $1 FOR UPDATE',
    [tenantId]
  );
  const tenant = tenantRes.rows && tenantRes.rows[0];
  if (!tenant) {
    throw new Error(`TENANT_NOT_FOUND: Cannot suspend non-existent tenant '${tenantId}'`);
  }

  const updateRes = await dbClient.query(
    "UPDATE neem_tenants SET status = 'suspended', updated_at = now(), version = version + 1 WHERE tenant_id = $1 RETURNING *",
    [tenantId]
  );
  const updatedTenant = updateRes.rows && updateRes.rows[0];

  await auditService.recordEvent({
    actorId: payload.actorId || 'outbox_worker',
    actorRole: 'system',
    action: 'TENANT_SUSPENDED',
    targetType: 'tenant',
    targetId: tenantId,
    tenantId,
    metadata: {
      reason: payload.reason || 'OUTBOX_AUTOMATION_SUSPENSION',
      taskId: task.id,
      previousStatus: tenant.status
    }
  });

  return {
    success: true,
    suspended: true,
    tenantId,
    status: 'suspended',
    version: updatedTenant ? updatedTenant.version : tenant.version + 1,
    appliedAt: new Date().toISOString()
    };
  });

  // 2. entitlement.revoke: Trial Expiry Never Revokes Paid Subscriptions or Commercial Grants
  worker.registerHandler('entitlement.revoke', async (task, txClient) => {
    const dbClient = txClient || worker.db;
    const tenantId = task.tenant_id;
    const payload = safeParseJson(task.payload, {});
    const featureKey = payload.featureKey || payload.feature_key || null;
    const isTrialTrigger = payload.trigger === 'trial_expiry' ||
                           payload.grantKind === 'trial' ||
                           (payload.reason && payload.reason.toLowerCase().includes('trial'));

    // Invariant Guard: Trial expiry must NEVER revoke an active paid subscription or commercial grant
    if (isTrialTrigger) {
      const subRes = await dbClient.query(
        "SELECT id, plan_code, status FROM neem_billing_subscriptions WHERE tenant_id = $1 AND status IN ('active', 'trialing')",
        [tenantId]
      );
      const hasActivePaidSub = subRes.rows && subRes.rows.some(s => s.plan_code && s.plan_code.toLowerCase() !== 'trial');

      let isTargetGrantCommercial = false;
      if (featureKey) {
        const grantRes = await dbClient.query(
          'SELECT id, feature_key, grant_kind FROM neem_commercial_grants WHERE tenant_id = $1 AND feature_key = $2',
          [tenantId, featureKey]
        );
        const g = grantRes.rows && grantRes.rows[0];
        if (g && (g.grant_kind === 'plan' || g.grant_kind === 'commercial' || g.grant_kind === 'addon')) {
          isTargetGrantCommercial = true;
        }
      }

      if (hasActivePaidSub || isTargetGrantCommercial) {
        await auditService.recordEvent({
          actorId: payload.actorId || 'outbox_worker',
          actorRole: 'system',
          action: 'REVOCATION_SUPPRESSED_PAID_GRANT',
          targetType: 'tenant_entitlement',
          targetId: featureKey || tenantId,
          tenantId,
          metadata: {
            reason: 'TRIAL_EXPIRY_CANNOT_REVOKE_PAID_GRANT',
            hasActivePaidSub,
            isTargetGrantCommercial,
            taskId: task.id
          }
        });
        return {
          success: true,
          revoked: false,
          preserved: true,
          reason: 'TRIAL_EXPIRY_CANNOT_REVOKE_PAID_GRANT',
          tenantId,
          featureKey
        };
      }
    }

    // Legitimate revocation
    let deletedCount = 0;
    if (featureKey) {
      const delRes = await dbClient.query(
        'DELETE FROM neem_commercial_grants WHERE tenant_id = $1 AND feature_key = $2 RETURNING *',
        [tenantId, featureKey]
      );
      deletedCount = delRes.rowCount || (delRes.rows ? delRes.rows.length : 0);
    } else {
      const delRes = await dbClient.query(
        "DELETE FROM neem_commercial_grants WHERE tenant_id = $1 AND grant_kind = 'trial' RETURNING *",
        [tenantId]
      );
      deletedCount = delRes.rowCount || (delRes.rows ? delRes.rows.length : 0);
    }

    await auditService.recordEvent({
      actorId: payload.actorId || 'outbox_worker',
      actorRole: 'system',
      action: 'ENTITLEMENT_REVOKED',
      targetType: 'commercial_grant',
      targetId: featureKey || tenantId,
      tenantId,
      metadata: {
        featureKey,
        revokedCount: deletedCount,
        reason: payload.reason || 'OUTBOX_AUTOMATION_REVOCATION',
        taskId: task.id
      }
    });

    return {
      success: true,
      revoked: true,
      deletedCount,
      tenantId,
      featureKey,
      appliedAt: new Date().toISOString()
    };
  });

  // 3. billing.overdue_notice: Real In-DB Invoice Update, Outbox/Adapter Contract Only (No real external SMS/messages)
  worker.registerHandler('billing.overdue_notice', async (task, txClient) => {
    const dbClient = txClient || worker.db;
    const tenantId = task.tenant_id;
    const payload = safeParseJson(task.payload, {});
    const invoiceId = payload.invoiceId || payload.invoice_id;

    let updatedInvoice = null;
    if (invoiceId) {
      const invRes = await dbClient.query(
        'SELECT id, status, metadata FROM neem_billing_invoices WHERE id = $1 AND tenant_id = $2',
        [invoiceId, tenantId]
      );
      if (invRes.rows && invRes.rows[0]) {
        const inv = invRes.rows[0];
        const prevMeta = safeParseJson(inv.metadata, {});
        const newMeta = {
          ...prevMeta,
          notice_dispatched_at: new Date().toISOString(),
          notice_task_id: task.id,
          notice_count: (prevMeta.notice_count || 0) + 1
        };
        const upd = await dbClient.query(
          'UPDATE neem_billing_invoices SET metadata = $1, updated_at = now() WHERE id = $2 AND tenant_id = $3 RETURNING *',
          [JSON.stringify(newMeta), invoiceId, tenantId]
        );
        updatedInvoice = upd.rows && upd.rows[0];
      }
    }

    await auditService.recordEvent({
      actorId: payload.actorId || 'outbox_worker',
      actorRole: 'system',
      action: 'BILLING_OVERDUE_NOTICE_RECORDED',
      targetType: 'billing_invoice',
      targetId: invoiceId || tenantId,
      tenantId,
      metadata: {
        taskId: task.id,
        invoiceId,
        noticeType: 'overdue_notice_contract_only',
        deliveredVia: 'adapter_contract_only'
      }
    });

    return {
      success: true,
      notified: true,
      contractOnly: true,
      invoiceId: invoiceId || null,
      tenantId,
      invoiceUpdated: Boolean(updatedInvoice),
      dispatchedAt: new Date().toISOString()
    };
  });

  // 4. automation.rule.triggered: Restricted Action Registry (Fail-Closed on Unknown)
  worker.registerHandler('automation.rule.triggered', async (task, txClient) => {
    const dbClient = txClient || worker.db;
    const tenantId = task.tenant_id;
    const payload = safeParseJson(task.payload, {});
    const actionKind = payload.actionKind || payload.action || payload.action_kind;

    // Fail-closed validation against restricted registry
    if (!actionKind || !ALLOWED_AUTOMATION_ACTIONS.has(actionKind)) {
      throw new Error(`UNSUPPORTED_AUTOMATION_RULE_ACTION: Action '${actionKind}' is not allowed by the automation action registry (task id: ${task.id}).`);
    }

    let actionOutput = null;

    if (actionKind === 'suspend_tenant') {
      await dbClient.query(
        "UPDATE neem_tenants SET status = 'suspended', updated_at = now(), version = version + 1 WHERE tenant_id = $1",
        [tenantId]
      );
      actionOutput = { suspended: true, status: 'suspended' };
    } else if (actionKind === 'quarantine_tenant') {
      await dbClient.query(
        "UPDATE neem_tenants SET status = 'quarantined', updated_at = now(), version = version + 1 WHERE tenant_id = $1",
        [tenantId]
      );
      actionOutput = { quarantined: true, status: 'quarantined' };
    } else if (actionKind === 'revoke_entitlement') {
      const isTrial = payload.trigger === 'trial_expiry' || payload.grantKind === 'trial';
      if (isTrial) {
        const subRes = await dbClient.query(
          "SELECT id, plan_code, status FROM neem_billing_subscriptions WHERE tenant_id = $1 AND status IN ('active', 'trialing')",
          [tenantId]
        );
        const hasActivePaidSub = subRes.rows && subRes.rows.some(s => s.plan_code && s.plan_code.toLowerCase() !== 'trial');
        if (hasActivePaidSub) {
          actionOutput = { revoked: false, preserved: true, reason: 'TRIAL_EXPIRY_CANNOT_REVOKE_PAID_GRANT' };
        }
      }
      if (!actionOutput) {
        const delRes = await dbClient.query(
          'DELETE FROM neem_commercial_grants WHERE tenant_id = $1 RETURNING *',
          [tenantId]
        );
        actionOutput = { revoked: true, rowCount: delRes.rowCount || (delRes.rows ? delRes.rows.length : 0) };
      }
    } else if (actionKind === 'sync_cell') {
      await syncStateService.recordCellHeartbeat(task.target_cell || 'cell-teh-01', {
        sourceTask: task.id,
        tenantId
      });
      actionOutput = { cellSynced: true, cellId: task.target_cell || 'cell-teh-01' };
    } else if (actionKind === 'record_audit' || actionKind === 'flag_review') {
      actionOutput = { recorded: true, flag: actionKind };
    }

    if (payload.executionId) {
      try {
        await dbClient.query(
          `UPDATE neem_automation_executions
           SET status = 'executed', completed_at = now(), action_result = $1
           WHERE id = $2`,
          [JSON.stringify(actionOutput), payload.executionId]
        );
      } catch (_) {}
    }

    await auditService.recordEvent({
      actorId: payload.actorId || 'outbox_worker',
      actorRole: 'system',
      action: 'AUTOMATION_RULE_ACTION_APPLIED',
      targetType: 'automation_rule',
      targetId: payload.ruleId || task.id,
      tenantId,
      metadata: {
        actionKind,
        actionOutput,
        taskId: task.id,
        ruleVersion: payload.ruleVersion
      }
    });

    return {
      success: true,
      executed: true,
      actionKind,
      actionOutput,
      taskId: task.id,
      appliedAt: new Date().toISOString()
    };
  });

  // 5. sync.cell.event: Real Durable Sync State via syncStateService
  worker.registerHandler('sync.cell.event', async (task, txClient) => {
    const dbClient = txClient || worker.db;
    const cellId = task.target_cell || 'cell-teh-01';
    const tenantId = task.tenant_id;
    const payload = safeParseJson(task.payload, {});

    const heartbeatResult = await syncStateService.recordCellHeartbeat(cellId, {
      task_id: task.id,
      tenant_id: tenantId,
      event_type: task.event_name,
      payload
    });

    await auditService.recordEvent({
      actorId: payload.actorId || 'outbox_worker',
      actorRole: 'system',
      action: 'CELL_EVENT_SYNCED',
      targetType: 'cell',
      targetId: cellId,
      tenantId,
      metadata: {
        taskId: task.id,
        cellId,
        stateRecorded: Boolean(heartbeatResult)
      }
    });

    return {
      success: true,
      synced: true,
      cellId,
      tenantId,
      appliedAt: new Date().toISOString()
    };
  });
}

// Initial registration for singleton
registerStandardHandlers(defaultOutboxWorker);
defaultOutboxWorker.registerStandardHandlers = registerStandardHandlers;

module.exports = defaultOutboxWorker;
