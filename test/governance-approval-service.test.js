'use strict';

process.env.NODE_ENV = process.env.NODE_ENV || 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {
  GovernanceApprovalService,
  canonicalJson,
} = require('../server/salsa/control-plane/governance/governance-approval-service');
const { buildCriticalKillSwitchBinding } = require('../server/salsa/control-plane/policy/kill-switch-approval-binding');

const ACTOR_A = '10000000-0000-4000-8000-000000000001';
const ACTOR_B = '10000000-0000-4000-8000-000000000002';
const ACTOR_C = '10000000-0000-4000-8000-000000000003';
const ROLE = 'platform_operations';

function clone(value) {
  return structuredClone(value);
}

class ApprovalDatabaseAdapter {
  constructor() {
    this.approvals = new Map();
    this.auditEvents = [];
    this.failAudit = false;
    this.transactionTail = Promise.resolve();
  }

  async acquireTransaction() {
    let release;
    const current = new Promise(resolve => { release = resolve; });
    const previous = this.transactionTail;
    this.transactionTail = previous.then(() => current);
    await previous;
    return release;
  }

  async connect() {
    return new ApprovalDatabaseClient(this);
  }
}

class ApprovalDatabaseClient {
  constructor(adapter) {
    this.adapter = adapter;
    this.releaseMutex = null;
    this.snapshot = null;
  }

  async query(sql, params = []) {
    const normalized = String(sql).replace(/\s+/g, ' ').trim().toUpperCase();
    if (normalized === 'BEGIN') {
      this.releaseMutex = await this.adapter.acquireTransaction();
      this.snapshot = { approvals: clone(this.adapter.approvals), auditEvents: clone(this.adapter.auditEvents) };
      return { rows: [], rowCount: 0 };
    }
    if (normalized === 'COMMIT') {
      this.snapshot = null;
      this.unlock();
      return { rows: [], rowCount: 0 };
    }
    if (normalized === 'ROLLBACK') {
      if (this.snapshot) {
        this.adapter.approvals = clone(this.snapshot.approvals);
        this.adapter.auditEvents = clone(this.snapshot.auditEvents);
      }
      this.snapshot = null;
      this.unlock();
      return { rows: [], rowCount: 0 };
    }
    if (normalized.startsWith('INSERT INTO NEEM_PLATFORM_GOVERNANCE_APPROVALS')) {
      const [id, actionType, targetResource, payloadJson, payloadDigest, reason, metadataJson, requestedBy, requestedAt, expiresAt] = params;
      const row = {
        id,
        action_type: actionType,
        target_resource: targetResource,
        payload: JSON.parse(payloadJson),
        payload_digest: payloadDigest,
        reason,
        metadata: JSON.parse(metadataJson),
        status: 'pending',
        requested_by: requestedBy,
        requested_at: requestedAt,
        expires_at: expiresAt,
        confirmed_by: null,
        confirmed_at: null,
        confirmation_note: null,
        rejected_by: null,
        rejected_at: null,
        rejection_reason: null,
        consumed_by: null,
        consumed_at: null,
        updated_at: requestedAt,
      };
      this.adapter.approvals.set(id, row);
      return { rows: [clone(row)], rowCount: 1 };
    }
    if (normalized.startsWith('INSERT INTO NEEM_CONTROL_AUDIT_EVENTS')) {
      if (this.adapter.failAudit) throw new Error('test audit adapter failure');
      const [id, actorId, actorRole, action, targetType, targetId, tenantId, requestId, metadata] = params;
      const event = { id, actorId, actorRole, action, targetType, targetId, tenantId, requestId, metadata: clone(metadata) };
      this.adapter.auditEvents.push(event);
      return { rows: [event], rowCount: 1 };
    }
    if (normalized.startsWith('SELECT COUNT(*)::INT AS TOTAL FROM NEEM_PLATFORM_GOVERNANCE_APPROVALS')) {
      const filtered = normalized.includes('WHERE STATUS = $1')
        ? [...this.adapter.approvals.values()].filter(row => row.status === params[0])
        : [...this.adapter.approvals.values()];
      return { rows: [{ total: filtered.length }], rowCount: 1 };
    }
    if (normalized.startsWith('SELECT * FROM NEEM_PLATFORM_GOVERNANCE_APPROVALS WHERE ID = $1')) {
      const row = this.adapter.approvals.get(params[0]);
      return { rows: row ? [clone(row)] : [], rowCount: row ? 1 : 0 };
    }
    if (normalized.startsWith('SELECT * FROM NEEM_PLATFORM_GOVERNANCE_APPROVALS')) {
      let rows = [...this.adapter.approvals.values()];
      if (normalized.includes('WHERE STATUS = $3')) rows = rows.filter(row => row.status === params[2]);
      rows.sort((a, b) => new Date(b.requested_at) - new Date(a.requested_at) || b.id.localeCompare(a.id));
      const [limit, offset] = params;
      return { rows: rows.slice(offset, offset + limit).map(clone), rowCount: Math.min(limit, Math.max(0, rows.length - offset)) };
    }
    if (normalized.startsWith('UPDATE NEEM_PLATFORM_GOVERNANCE_APPROVALS')) {
      if (normalized.includes("SET STATUS = 'EXPIRED'")) {
        const isBulk = normalized.includes('WHERE STATUS IN');
        const now = isBulk ? params[0] : params[1];
        const changed = [];
        for (const row of this.adapter.approvals.values()) {
          const matches = isBulk
            ? ['pending', 'approved'].includes(row.status) && new Date(row.expires_at) <= new Date(now)
            : row.id === params[0] && ['pending', 'approved'].includes(row.status) && new Date(row.expires_at) <= new Date(now);
          if (!matches) continue;
          row.status = 'expired';
          row.updated_at = now;
          changed.push(isBulk ? { id: row.id, action_type: row.action_type, target_resource: row.target_resource, payload_digest: row.payload_digest } : clone(row));
        }
        return { rows: changed, rowCount: changed.length };
      }
      if (normalized.includes("SET STATUS = 'CONSUMED'")) {
        const [id, actorId, now] = params;
        const row = this.adapter.approvals.get(id);
        if (!row || row.status !== 'approved' || row.consumed_at || new Date(row.expires_at) <= new Date(now)) return { rows: [], rowCount: 0 };
        row.status = 'consumed';
        row.consumed_by = actorId;
        row.consumed_at = now;
        row.updated_at = now;
        return { rows: [clone(row)], rowCount: 1 };
      }
      if (normalized.includes('SET STATUS = $2')) {
        const [id, status, actorId, now, note] = params;
        const row = this.adapter.approvals.get(id);
        if (!row || row.status !== 'pending' || new Date(row.expires_at) <= new Date(now)) return { rows: [], rowCount: 0 };
        row.status = status;
        if (status === 'approved') {
          row.confirmed_by = actorId;
          row.confirmed_at = now;
          row.confirmation_note = note || null;
        } else {
          row.rejected_by = actorId;
          row.rejected_at = now;
          row.rejection_reason = note;
        }
        row.updated_at = now;
        return { rows: [clone(row)], rowCount: 1 };
      }
    }
    throw new Error(`Unsupported test-adapter SQL: ${normalized}`);
  }

  unlock() {
    if (this.releaseMutex) {
      const release = this.releaseMutex;
      this.releaseMutex = null;
      release();
    }
  }

  release() {
    if (this.snapshot) {
      this.adapter.approvals = clone(this.snapshot.approvals);
      this.adapter.auditEvents = clone(this.snapshot.auditEvents);
      this.snapshot = null;
    }
    this.unlock();
  }
}

function makeHarness({ start = '2026-09-24T09:00:00.000Z', ttlMs } = {}) {
  const adapter = new ApprovalDatabaseAdapter();
  let now = new Date(start);
  const service = new GovernanceApprovalService({
    dbProvider: () => adapter,
    clock: () => now,
    ...(ttlMs ? { ttlMs } : {}),
    audit: {
      async recordEvent(event) {
        if (!event.database) throw new Error('audit must use the approval transaction client');
        return event.database.query(
          'INSERT INTO neem_control_audit_events (id, actor_id, actor_role, action, target_type, target_id, tenant_id, request_id, metadata) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',
          [crypto.randomUUID(), event.actorId, event.actorRole, event.action, event.targetType, event.targetId, event.tenantId, event.requestId, event.metadata],
        );
      },
    },
  });
  return { adapter, service, advance(ms) { now = new Date(now.getTime() + ms); }, currentTime() { return now; } };
}

function criticalIntent() {
  return buildCriticalKillSwitchBinding({
    moduleKey: 'orders',
    featureKeys: ['orders.kds', 'orders.pos'],
    scope: 'global',
    reason: 'Contain a verified platform security incident',
    severity: 'critical',
    expiresAt: '2026-09-24T18:00:00.000Z',
    affectedTenantCount: 42,
  });
}

async function createAndConfirm(service, intent = criticalIntent()) {
  const request = await service.create({
    ...intent,
    reason: intent.payload.reason,
    payload: intent.payload,
    metadata: { incidentRef: 'INC-42' },
    actorId: ACTOR_A,
    actorRole: ROLE,
    expiresAt: new Date('2026-09-24T10:00:00.000Z'),
  });
  const confirmed = await service.decide({ id: request.id, decision: 'confirm', actorId: ACTOR_B, actorRole: ROLE, note: 'Reviewed independently' });
  return { request, confirmed, intent };
}

test('approval survives service recreation and list/read remain backed by the shared adapter and audit ledger', async () => {
  const harness = makeHarness();
  const created = await harness.service.create({
    ...criticalIntent(),
    reason: criticalIntent().payload.reason,
    payload: criticalIntent().payload,
    actorId: ACTOR_A,
    actorRole: ROLE,
    expiresAt: new Date('2026-09-24T10:00:00.000Z'),
  });
  const recreated = new GovernanceApprovalService({
    dbProvider: () => harness.adapter,
    clock: () => harness.currentTime(),
    audit: harness.service.audit,
  });
  const list = await recreated.list({ actorId: ACTOR_B, actorRole: ROLE, status: 'pending', limit: 10, offset: 0 });
  const read = await recreated.get({ id: created.id, actorId: ACTOR_B, actorRole: ROLE });

  assert.equal(list.total, 1);
  assert.equal(list.items[0].id, created.id);
  assert.equal(read.payloadDigest, created.payloadDigest);
  assert.equal(Object.hasOwn(read, 'requestedByEmail'), false);
  assert.deepEqual(harness.adapter.auditEvents.map(event => event.action), [
    'PLATFORM_GOVERNANCE_APPROVAL_REQUESTED',
    'PLATFORM_GOVERNANCE_APPROVALS_LISTED',
    'PLATFORM_GOVERNANCE_APPROVAL_READ',
  ]);
});

test('four-eyes confirmation rejects self-confirmation, replay, and concurrent double confirmation', async () => {
  const harness = makeHarness();
  const request = await harness.service.create({
    ...criticalIntent(), reason: 'Independent approval required', payload: criticalIntent().payload,
    actorId: ACTOR_A, actorRole: ROLE, expiresAt: new Date('2026-09-24T10:00:00.000Z'),
  });
  await assert.rejects(
    harness.service.decide({ id: request.id, decision: 'confirm', actorId: ACTOR_A, actorRole: ROLE }),
    { code: 'FOUR_EYES_VIOLATION', httpStatus: 403 },
  );

  const concurrent = await Promise.allSettled([
    harness.service.decide({ id: request.id, decision: 'confirm', actorId: ACTOR_B, actorRole: ROLE }),
    harness.service.decide({ id: request.id, decision: 'confirm', actorId: ACTOR_C, actorRole: 'platform_owner' }),
  ]);
  assert.equal(concurrent.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(concurrent.filter(result => result.status === 'rejected' && result.reason.code === 'APPROVAL_ALREADY_DECIDED').length, 1);
  const row = harness.adapter.approvals.get(request.id);
  assert.equal(row.status, 'approved');
  assert.notEqual(row.confirmed_by, row.requested_by);
  await assert.rejects(
    harness.service.decide({ id: request.id, decision: 'confirm', actorId: ACTOR_C, actorRole: 'platform_owner' }),
    { code: 'APPROVAL_ALREADY_DECIDED' },
  );
});

test('critical kill-switch authorization binds exact action, canonical payload, target, and expiry', async () => {
  const harness = makeHarness();
  const { confirmed, intent } = await createAndConfirm(harness.service);
  assert.equal(canonicalJson({ b: 2, a: 1 }), '{"a":1,"b":2}');
  const accepted = await harness.service.assertApprovedAction({
    id: confirmed.id, actorId: ACTOR_C, actorRole: 'platform_owner', ...intent,
  });
  assert.equal(accepted.status, 'approved');

  await assert.rejects(harness.service.assertApprovedAction({
    id: confirmed.id, actorId: ACTOR_C, actorRole: 'platform_owner',
    ...intent, targetResource: 'platform.kill-switch:billing',
  }), { code: 'APPROVAL_BINDING_MISMATCH' });
  await assert.rejects(harness.service.assertApprovedAction({
    id: confirmed.id, actorId: ACTOR_C, actorRole: 'platform_owner',
    ...intent, payload: { ...intent.payload, reason: 'Changed after review' },
  }), { code: 'APPROVAL_BINDING_MISMATCH' });

  const stored = harness.adapter.approvals.get(confirmed.id);
  stored.payload.reason = 'Tampered in storage';
  await assert.rejects(harness.service.assertApprovedAction({
    id: confirmed.id, actorId: ACTOR_C, actorRole: 'platform_owner', ...intent,
  }), { code: 'APPROVAL_BINDING_MISMATCH' });
});

test('expired approvals are durably expired and cannot authorize or be consumed', async () => {
  const harness = makeHarness();
  const action = criticalIntent();
  const request = await harness.service.create({
    ...action, reason: action.payload.reason, payload: action.payload,
    actorId: ACTOR_A, actorRole: ROLE, expiresAt: new Date('2026-09-24T09:05:00.000Z'),
  });
  await harness.service.decide({ id: request.id, decision: 'confirm', actorId: ACTOR_B, actorRole: ROLE });
  harness.advance(6 * 60 * 1000);
  await assert.rejects(harness.service.assertApprovedAction({
    id: request.id, actorId: ACTOR_C, actorRole: 'platform_owner', ...action,
  }), { code: 'APPROVAL_EXPIRED', httpStatus: 410 });
  assert.equal(harness.adapter.approvals.get(request.id).status, 'expired');
});

test('consumption is one-shot and a failed audit insert rolls back approval state changes', async () => {
  const harness = makeHarness();
  const { confirmed, intent } = await createAndConfirm(harness.service);
  const consumed = await harness.service.consumeApprovedAction({
    id: confirmed.id, actorId: ACTOR_C, actorRole: 'platform_owner', ...intent,
  });
  assert.equal(consumed.status, 'consumed');
  await assert.rejects(harness.service.consumeApprovedAction({
    id: confirmed.id, actorId: ACTOR_C, actorRole: 'platform_owner', ...intent,
  }), { code: 'APPROVAL_NOT_CONSUMABLE' });

  const rollbackHarness = makeHarness();
  const pending = await rollbackHarness.service.create({
    ...intent, reason: intent.payload.reason, payload: intent.payload,
    actorId: ACTOR_A, actorRole: ROLE, expiresAt: new Date('2026-09-24T10:00:00.000Z'),
  });
  rollbackHarness.adapter.failAudit = true;
  await assert.rejects(rollbackHarness.service.decide({
    id: pending.id, decision: 'confirm', actorId: ACTOR_B, actorRole: ROLE,
  }), /test audit adapter failure/);
  assert.equal(rollbackHarness.adapter.approvals.get(pending.id).status, 'pending');
  assert.equal(rollbackHarness.adapter.auditEvents.length, 1, 'only the original request audit remains');
});

test('critical kill-switch route verifies durable binding then preserves global fan-out fail-closed behavior', () => {
  const routePath = path.join(__dirname, '../server/salsa/control-plane/routes/policy-routes.js');
  const source = fs.readFileSync(routePath, 'utf8');
  const start = source.indexOf("router.post('/killswitch'");
  const end = source.indexOf("router.delete('/killswitch/:featureKey'", start);
  const handler = source.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(handler, /severity === 'critical'[\s\S]*?buildCriticalKillSwitchBinding/);
  assert.match(handler, /governanceApprovalService\.assertApprovedAction\([\s\S]*?id: req\.body\?\.approvalId/);
  assert.match(handler, /await governanceApprovalService\.assertApprovedAction[\s\S]*?GLOBAL_KILLSWITCH_FANOUT_NOT_IMPLEMENTED/);
  assert.doesNotMatch(handler, /killSwitchService\.activate/);
  assert.match(source, /globalMutationsAvailable: false/);
});

test('migration 034 defines immutable target/payload/expiry binding and distinct requester/confirmer identities', () => {
  const migrationPath = path.join(__dirname, '../server/salsa/control-plane/migrations/034_durable_governance_approvals.sql');
  const migration = fs.readFileSync(migrationPath, 'utf8');
  assert.match(migration, /CREATE TABLE IF NOT EXISTS neem_platform_governance_approvals/);
  assert.match(migration, /payload_digest TEXT NOT NULL CHECK \(length\(payload_digest\) = 64 AND payload_digest ~ '\^\[0-9a-f\]\{64\}\$'\)/);
  assert.match(migration, /confirmed_by IS NULL OR confirmed_by <> requested_by/);
  assert.match(migration, /NEW\.target_resource[\s\S]*?NEW\.payload_digest[\s\S]*?NEW\.expires_at/);
  assert.match(migration, /CREATE TRIGGER neem_platform_governance_approval_binding_immutable/);
});
