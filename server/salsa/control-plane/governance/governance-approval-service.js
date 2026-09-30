'use strict';

const crypto = require('crypto');
const { getDatabase } = require('../db/database');
const auditService = require('../audit/audit-service');

const TABLE = 'neem_platform_governance_approvals';
const VALID_STATUSES = new Set(['pending', 'approved', 'rejected', 'expired', 'consumed']);
const VALID_ROLES = new Set([
  'platform_owner',
  'platform_operations',
  'platform_support',
  'platform_finance',
  'platform_readonly',
]);
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_TTL_MS = 24 * 60 * 60 * 1000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function approvalError(code, message, httpStatus = 409) {
  const error = new Error(message);
  error.code = code;
  error.httpStatus = httpStatus;
  return error;
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function canonicalize(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isPlainObject(value)) {
    const output = {};
    for (const key of Object.keys(value).sort()) {
      if (['__proto__', 'constructor', 'prototype'].includes(key)) {
        throw approvalError('APPROVAL_PAYLOAD_INVALID', 'Approval payload contains a reserved property.', 422);
      }
      output[key] = canonicalize(value[key]);
    }
    return output;
  }
  throw approvalError('APPROVAL_PAYLOAD_INVALID', 'Approval payload must contain only JSON values.', 422);
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function normalizePayload(value) {
  if (!isPlainObject(value)) {
    throw approvalError('APPROVAL_PAYLOAD_INVALID', 'Approval payload must be a JSON object.', 422);
  }
  const json = canonicalJson(value);
  if (Buffer.byteLength(json, 'utf8') > 64 * 1024) {
    throw approvalError('APPROVAL_PAYLOAD_TOO_LARGE', 'Approval payload must not exceed 64 KB.', 422);
  }
  return JSON.parse(json);
}

function normalizeMetadata(value) {
  if (value === undefined || value === null) return {};
  return normalizePayload(value);
}

function actionDigest({ actionType, targetResource, payload, approvalExpiresAt }) {
  const binding = {
    actionType: String(actionType),
    targetResource: String(targetResource),
    payload: normalizePayload(payload),
    approvalExpiresAt: new Date(approvalExpiresAt).toISOString(),
  };
  return crypto.createHash('sha256').update(canonicalJson(binding), 'utf8').digest('hex');
}

function requireActor(actorId, actorRole) {
  if (typeof actorId !== 'string' || !UUID_RE.test(actorId)) {
    throw approvalError('PLATFORM_PRINCIPAL_REQUIRED', 'A valid authenticated platform principal ID is required.', 401);
  }
  if (typeof actorRole !== 'string' || !VALID_ROLES.has(actorRole)) {
    throw approvalError('PLATFORM_ROLE_REQUIRED', 'A valid authenticated platform role is required.', 403);
  }
}

function parseDate(value, field) {
  const timestamp = value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    throw approvalError('APPROVAL_EXPIRY_INVALID', `${field} must be a valid date.`, 422);
  }
  return new Date(timestamp);
}

function parseJson(value, fallback) {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch (_error) { return fallback; }
}

function mapApproval(row) {
  if (!row) return null;
  return {
    id: row.id,
    actionType: row.action_type,
    targetResource: row.target_resource,
    payload: parseJson(row.payload, {}),
    payloadDigest: row.payload_digest,
    reason: row.reason,
    metadata: parseJson(row.metadata, {}),
    status: row.status,
    requestedBy: row.requested_by,
    requestedAt: row.requested_at instanceof Date ? row.requested_at.toISOString() : row.requested_at,
    expiresAt: row.expires_at instanceof Date ? row.expires_at.toISOString() : row.expires_at,
    confirmedBy: row.confirmed_by || null,
    confirmedAt: row.confirmed_at instanceof Date ? row.confirmed_at.toISOString() : row.confirmed_at || null,
    confirmationNote: row.confirmation_note || null,
    rejectedBy: row.rejected_by || null,
    rejectedAt: row.rejected_at instanceof Date ? row.rejected_at.toISOString() : row.rejected_at || null,
    rejectionReason: row.rejection_reason || null,
    consumedBy: row.consumed_by || null,
    consumedAt: row.consumed_at instanceof Date ? row.consumed_at.toISOString() : row.consumed_at || null,
  };
}

async function withTransaction(pool, work) {
  if (!pool || typeof pool.connect !== 'function') {
    throw approvalError('APPROVAL_DATABASE_UNAVAILABLE', 'Durable approval storage requires a PostgreSQL connection pool.', 503);
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (_rollbackError) { /* preserve the original error */ }
    throw error;
  } finally {
    client.release();
  }
}

class GovernanceApprovalService {
  constructor({ dbProvider = getDatabase, audit = auditService, clock = () => new Date(), ttlMs = DEFAULT_TTL_MS } = {}) {
    this.dbProvider = dbProvider;
    this.audit = audit;
    this.clock = clock;
    this.ttlMs = Math.min(Number(ttlMs) || DEFAULT_TTL_MS, MAX_TTL_MS);
  }

  now() {
    const value = this.clock();
    return value instanceof Date ? new Date(value.getTime()) : new Date(value);
  }

  async auditEvent(database, { actorId, actorRole, action, targetId, metadata = {}, requestId = null }) {
    return this.audit.recordEvent({
      actorId,
      actorRole,
      action,
      targetType: 'platform_governance_approval',
      targetId: targetId || null,
      requestId,
      metadata,
      database,
    });
  }

  async expireRow(database, row, actorId, actorRole, now, requestId = null) {
    if (!row || !['pending', 'approved'].includes(row.status) || parseDate(row.expires_at, 'expiresAt').getTime() > now.getTime()) return row;
    const result = await database.query(`
      UPDATE ${TABLE}
      SET status = 'expired', updated_at = $2
      WHERE id = $1 AND status IN ('pending', 'approved') AND expires_at <= $2
      RETURNING *
    `, [row.id, now]);
    const expired = result.rows?.[0];
    if (!expired) return row;
    await this.auditEvent(database, {
      actorId,
      actorRole,
      action: 'PLATFORM_GOVERNANCE_APPROVAL_EXPIRED',
      targetId: row.id,
      requestId,
      metadata: { action_type: row.action_type, target_resource: row.target_resource, payload_digest: row.payload_digest },
    });
    return expired;
  }

  async expireAll(database, actorId, actorRole, now, requestId = null) {
    const result = await database.query(`
      UPDATE ${TABLE}
      SET status = 'expired', updated_at = $1
      WHERE status IN ('pending', 'approved') AND expires_at <= $1
      RETURNING id, action_type, target_resource, payload_digest
    `, [now]);
    for (const row of result.rows || []) {
      await this.auditEvent(database, {
        actorId,
        actorRole,
        action: 'PLATFORM_GOVERNANCE_APPROVAL_EXPIRED',
        targetId: row.id,
        requestId,
        metadata: { action_type: row.action_type, target_resource: row.target_resource, payload_digest: row.payload_digest },
      });
    }
  }

  async create({ actionType, targetResource, reason, payload = {}, metadata = {}, actorId, actorRole, expiresAt = null, requestId = null }) {
    requireActor(actorId, actorRole);
    actorId = actorId.toLowerCase();
    if (typeof actionType !== 'string' || !/^[a-z][a-z0-9._:-]{2,99}$/i.test(actionType.trim())) {
      throw approvalError('APPROVAL_ACTION_INVALID', 'actionType is invalid.', 422);
    }
    const cleanAction = actionType.trim();
    if (typeof targetResource !== 'string' || !targetResource.trim() || targetResource.trim().length > 240) {
      throw approvalError('APPROVAL_TARGET_INVALID', 'targetResource is required and must not exceed 240 characters.', 422);
    }
    if (typeof reason !== 'string' || reason.trim().length < 5 || reason.trim().length > 1000) {
      throw approvalError('APPROVAL_REASON_INVALID', 'A reason between 5 and 1000 characters is required.', 422);
    }
    const cleanTarget = targetResource.trim();
    const cleanPayload = normalizePayload(payload);
    const cleanMetadata = normalizeMetadata(metadata);
    const now = this.now();
    const approvalExpiry = expiresAt ? parseDate(expiresAt, 'expiresAt') : new Date(now.getTime() + this.ttlMs);
    if (approvalExpiry.getTime() <= now.getTime() || approvalExpiry.getTime() > now.getTime() + this.ttlMs) {
      throw approvalError('APPROVAL_EXPIRY_INVALID', 'Approval expiry must be in the future and within the configured 24-hour approval window.', 422);
    }
    const id = crypto.randomUUID();
    const payloadDigest = actionDigest({ actionType: cleanAction, targetResource: cleanTarget, payload: cleanPayload, approvalExpiresAt: approvalExpiry });

    return withTransaction(this.dbProvider(), async database => {
      const result = await database.query(`
        INSERT INTO ${TABLE} (
          id, action_type, target_resource, payload, payload_digest, reason, metadata,
          status, requested_by, requested_at, expires_at, updated_at
        ) VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7::jsonb, 'pending', $8, $9, $10, $9)
        RETURNING *
      `, [id, cleanAction, cleanTarget, JSON.stringify(cleanPayload), payloadDigest, reason.trim(), JSON.stringify(cleanMetadata), actorId, now, approvalExpiry]);
      const row = result.rows?.[0];
      if (!row) throw approvalError('APPROVAL_WRITE_NOT_PERSISTED', 'Approval request was not returned by durable storage.', 503);
      await this.auditEvent(database, {
        actorId,
        actorRole,
        action: 'PLATFORM_GOVERNANCE_APPROVAL_REQUESTED',
        targetId: id,
        requestId,
        metadata: { action_type: cleanAction, target_resource: cleanTarget, payload_digest: payloadDigest, expires_at: approvalExpiry.toISOString() },
      });
      return mapApproval(row);
    });
  }

  async list({ status = null, limit = 50, offset = 0, actorId, actorRole, requestId = null }) {
    requireActor(actorId, actorRole);
    actorId = actorId.toLowerCase();
    if (status && !VALID_STATUSES.has(status)) throw approvalError('APPROVAL_STATUS_FILTER_INVALID', 'status filter is invalid.', 422);
    const pageSize = Number(limit);
    const pageOffset = Number(offset);
    if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100
      || !Number.isSafeInteger(pageOffset) || pageOffset < 0 || pageOffset > 100000) {
      throw approvalError('APPROVAL_PAGINATION_INVALID', 'limit must be 1–100 and offset must be a non-negative integer.', 422);
    }
    const now = this.now();
    return withTransaction(this.dbProvider(), async database => {
      await this.expireAll(database, actorId, actorRole, now, requestId);
      const countFilterSql = status ? 'WHERE status = $1' : '';
      const rowFilterSql = status ? 'WHERE status = $3' : '';
      const countParams = status ? [status] : [];
      const [count, rows] = await Promise.all([
        database.query(`SELECT COUNT(*)::int AS total FROM ${TABLE} ${countFilterSql}`, countParams),
        database.query(`SELECT * FROM ${TABLE} ${rowFilterSql} ORDER BY requested_at DESC, id DESC LIMIT $1 OFFSET $2`, status ? [pageSize, pageOffset, status] : [pageSize, pageOffset]),
      ]);
      const total = Number(count.rows?.[0]?.total) || 0;
      await this.auditEvent(database, {
        actorId,
        actorRole,
        action: 'PLATFORM_GOVERNANCE_APPROVALS_LISTED',
        targetId: null,
        requestId,
        metadata: { status_filter: status, limit: pageSize, offset: pageOffset, returned_count: rows.rows?.length || 0 },
      });
      return { items: (rows.rows || []).map(mapApproval), total, limit: pageSize, offset: pageOffset, hasMore: pageOffset + (rows.rows?.length || 0) < total };
    });
  }

  async get({ id, actorId, actorRole, requestId = null }) {
    requireActor(actorId, actorRole);
    actorId = actorId.toLowerCase();
    if (typeof id !== 'string' || !UUID_RE.test(id)) throw approvalError('APPROVAL_NOT_FOUND', 'Approval request was not found.', 404);
    const now = this.now();
    const result = await withTransaction(this.dbProvider(), async database => {
      const selected = await database.query(`SELECT * FROM ${TABLE} WHERE id = $1 FOR UPDATE`, [id]);
      let row = selected.rows?.[0] || null;
      if (row) row = await this.expireRow(database, row, actorId, actorRole, now, requestId);
      await this.auditEvent(database, {
        actorId,
        actorRole,
        action: row ? 'PLATFORM_GOVERNANCE_APPROVAL_READ' : 'PLATFORM_GOVERNANCE_APPROVAL_READ_MISSING',
        targetId: id,
        requestId,
        metadata: row ? { action_type: row.action_type, target_resource: row.target_resource, status: row.status } : {},
      });
      return row;
    });
    if (!result) throw approvalError('APPROVAL_NOT_FOUND', 'Approval request was not found.', 404);
    return mapApproval(result);
  }

  async decide({ id, actorId, actorRole, decision, note = '', requestId = null }) {
    requireActor(actorId, actorRole);
    actorId = actorId.toLowerCase();
    if (typeof id !== 'string' || !UUID_RE.test(id)) throw approvalError('APPROVAL_NOT_FOUND', 'Approval request was not found.', 404);
    if (!['confirm', 'reject'].includes(decision)) throw approvalError('APPROVAL_DECISION_INVALID', 'Approval decision must be confirm or reject.', 422);
    if (typeof note !== 'string' || note.trim().length < (decision === 'reject' ? 5 : 0) || note.trim().length > 1000) {
      throw approvalError(decision === 'reject' ? 'APPROVAL_REJECTION_REASON_REQUIRED' : 'APPROVAL_NOTE_INVALID', decision === 'reject' ? 'A rejection reason of at least 5 characters is required.' : 'Confirmation note must not exceed 1000 characters.', 422);
    }
    const now = this.now();
    const outcome = await withTransaction(this.dbProvider(), async database => {
      const selected = await database.query(`SELECT * FROM ${TABLE} WHERE id = $1 FOR UPDATE`, [id]);
      let row = selected.rows?.[0] || null;
      if (!row) {
        await this.auditEvent(database, { actorId, actorRole, action: 'PLATFORM_GOVERNANCE_APPROVAL_DECISION_MISSING', targetId: id, requestId, metadata: { decision } });
        return { error: approvalError('APPROVAL_NOT_FOUND', 'Approval request was not found.', 404) };
      }
      row = await this.expireRow(database, row, actorId, actorRole, now, requestId);
      if (row.status === 'expired') {
        return { error: approvalError('APPROVAL_EXPIRED', 'Approval request has expired.', 410) };
      }
      if (row.status !== 'pending') {
        await this.auditEvent(database, { actorId, actorRole, action: 'PLATFORM_GOVERNANCE_APPROVAL_DECISION_REPLAY_BLOCKED', targetId: id, requestId, metadata: { decision, status: row.status } });
        return { error: approvalError('APPROVAL_ALREADY_DECIDED', `Approval request is already ${row.status}.`, 409) };
      }
      if (decision === 'confirm' && row.requested_by === actorId) {
        await this.auditEvent(database, { actorId, actorRole, action: 'PLATFORM_GOVERNANCE_APPROVAL_SELF_CONFIRM_BLOCKED', targetId: id, requestId, metadata: { action_type: row.action_type, payload_digest: row.payload_digest } });
        return { error: approvalError('FOUR_EYES_VIOLATION', 'The initiator cannot confirm their own approval request.', 403) };
      }

      const confirmed = decision === 'confirm';
      const updated = await database.query(`
        UPDATE ${TABLE}
        SET status = $2,
            confirmed_by = CASE WHEN $2 = 'approved' THEN $3::uuid ELSE confirmed_by END,
            confirmed_at = CASE WHEN $2 = 'approved' THEN $4 ELSE confirmed_at END,
            confirmation_note = CASE WHEN $2 = 'approved' THEN NULLIF($5, '') ELSE confirmation_note END,
            rejected_by = CASE WHEN $2 = 'rejected' THEN $3::uuid ELSE rejected_by END,
            rejected_at = CASE WHEN $2 = 'rejected' THEN $4 ELSE rejected_at END,
            rejection_reason = CASE WHEN $2 = 'rejected' THEN $5 ELSE rejection_reason END,
            updated_at = $4
        WHERE id = $1 AND status = 'pending' AND expires_at > $4
        RETURNING *
      `, [id, confirmed ? 'approved' : 'rejected', actorId, now, note.trim()]);
      const updatedRow = updated.rows?.[0];
      if (!updatedRow) {
        await this.auditEvent(database, { actorId, actorRole, action: 'PLATFORM_GOVERNANCE_APPROVAL_DECISION_RACE_BLOCKED', targetId: id, requestId, metadata: { decision } });
        return { error: approvalError('APPROVAL_ALREADY_DECIDED', 'Approval request changed before this decision could be committed.', 409) };
      }
      await this.auditEvent(database, {
        actorId,
        actorRole,
        action: confirmed ? 'PLATFORM_GOVERNANCE_APPROVAL_CONFIRMED' : 'PLATFORM_GOVERNANCE_APPROVAL_REJECTED',
        targetId: id,
        requestId,
        metadata: { action_type: row.action_type, target_resource: row.target_resource, payload_digest: row.payload_digest, ...(confirmed ? {} : { rejection_reason: note.trim() }) },
      });
      return { value: mapApproval(updatedRow) };
    });
    if (outcome.error) throw outcome.error;
    return outcome.value;
  }

  async assertApprovedAction({ id, actorId, actorRole, actionType, targetResource, payload, requestId = null }) {
    requireActor(actorId, actorRole);
    actorId = actorId.toLowerCase();
    if (typeof id !== 'string' || !UUID_RE.test(id)) throw approvalError('APPROVAL_REQUIRED', 'A valid approval ID is required for this critical action.', 409);
    const expectedPayload = normalizePayload(payload);
    const now = this.now();
    const outcome = await withTransaction(this.dbProvider(), async database => {
      const selected = await database.query(`SELECT * FROM ${TABLE} WHERE id = $1 FOR UPDATE`, [id]);
      let row = selected.rows?.[0] || null;
      if (!row) {
        await this.auditEvent(database, { actorId, actorRole, action: 'PLATFORM_GOVERNANCE_APPROVAL_MATCH_MISSING', targetId: id, requestId, metadata: { action_type: actionType, target_resource: targetResource } });
        return { error: approvalError('APPROVAL_REQUIRED', 'No matching approved request exists for this critical action.', 409) };
      }
      row = await this.expireRow(database, row, actorId, actorRole, now, requestId);
      if (row.status === 'expired') return { error: approvalError('APPROVAL_EXPIRED', 'The approval for this action has expired.', 410) };
      if (row.status !== 'approved' || row.consumed_at) {
        await this.auditEvent(database, { actorId, actorRole, action: 'PLATFORM_GOVERNANCE_APPROVAL_MATCH_BLOCKED', targetId: id, requestId, metadata: { status: row.status, action_type: row.action_type } });
        return { error: approvalError('APPROVAL_REQUIRED', 'The approval is not in an unused approved state.', 409) };
      }

      let persistedDigest;
      try {
        persistedDigest = actionDigest({
          actionType: row.action_type,
          targetResource: row.target_resource,
          payload: parseJson(row.payload, null),
          approvalExpiresAt: row.expires_at,
        });
      } catch (_error) {
        persistedDigest = null;
      }
      const expectedDigest = actionDigest({
        actionType,
        targetResource,
        payload: expectedPayload,
        approvalExpiresAt: row.expires_at,
      });
      if (!persistedDigest || persistedDigest !== row.payload_digest || expectedDigest !== row.payload_digest
        || row.confirmed_by === row.requested_by || !row.confirmed_by) {
        await this.auditEvent(database, {
          actorId,
          actorRole,
          action: 'PLATFORM_GOVERNANCE_APPROVAL_BINDING_MISMATCH',
          targetId: id,
          requestId,
          metadata: { action_type: row.action_type, target_resource: row.target_resource, payload_digest: row.payload_digest },
        });
        return { error: approvalError('APPROVAL_BINDING_MISMATCH', 'The approved action, target, payload, expiry, or four-eyes identities do not match.', 409) };
      }
      await this.auditEvent(database, {
        actorId,
        actorRole,
        action: 'PLATFORM_GOVERNANCE_APPROVAL_MATCHED',
        targetId: id,
        requestId,
        metadata: { action_type: actionType, target_resource: targetResource, payload_digest: row.payload_digest },
      });
      return { value: mapApproval(row) };
    });
    if (outcome.error) throw outcome.error;
    return outcome.value;
  }

  async consumeApprovedAction({ id, actorId, actorRole, actionType, targetResource, payload, requestId = null }) {
    requireActor(actorId, actorRole);
    actorId = actorId.toLowerCase();
    if (typeof id !== 'string' || !UUID_RE.test(id)) throw approvalError('APPROVAL_NOT_FOUND', 'Approval request was not found.', 404);
    const expectedPayload = normalizePayload(payload);
    const now = this.now();
    const outcome = await withTransaction(this.dbProvider(), async database => {
      const selected = await database.query(`SELECT * FROM ${TABLE} WHERE id = $1 FOR UPDATE`, [id]);
      let row = selected.rows?.[0] || null;
      if (row) row = await this.expireRow(database, row, actorId, actorRole, now, requestId);
      if (!row || row.status !== 'approved' || row.consumed_at || !row.confirmed_by || row.confirmed_by === row.requested_by) {
        await this.auditEvent(database, { actorId, actorRole, action: 'PLATFORM_GOVERNANCE_APPROVAL_CONSUME_BLOCKED', targetId: id, requestId, metadata: { status: row?.status || 'missing' } });
        return { error: approvalError('APPROVAL_NOT_CONSUMABLE', 'Approval is missing, expired, mismatched, or already consumed.', row ? 409 : 404) };
      }
      const storedDigest = actionDigest({ actionType: row.action_type, targetResource: row.target_resource, payload: parseJson(row.payload, null), approvalExpiresAt: row.expires_at });
      const expectedDigest = actionDigest({ actionType, targetResource, payload: expectedPayload, approvalExpiresAt: row.expires_at });
      if (storedDigest !== row.payload_digest || expectedDigest !== row.payload_digest) {
        await this.auditEvent(database, { actorId, actorRole, action: 'PLATFORM_GOVERNANCE_APPROVAL_CONSUME_MISMATCH', targetId: id, requestId, metadata: { payload_digest: row.payload_digest } });
        return { error: approvalError('APPROVAL_BINDING_MISMATCH', 'Approved action binding does not match the requested action.', 409) };
      }
      const consumed = await database.query(`
        UPDATE ${TABLE}
        SET status = 'consumed', consumed_by = $2::uuid, consumed_at = $3, updated_at = $3
        WHERE id = $1 AND status = 'approved' AND consumed_at IS NULL AND expires_at > $3
        RETURNING *
      `, [id, actorId, now]);
      if (!consumed.rows?.[0]) return { error: approvalError('APPROVAL_NOT_CONSUMABLE', 'Approval was concurrently consumed or expired.', 409) };
      await this.auditEvent(database, { actorId, actorRole, action: 'PLATFORM_GOVERNANCE_APPROVAL_CONSUMED', targetId: id, requestId, metadata: { action_type: actionType, target_resource: targetResource, payload_digest: row.payload_digest } });
      return { value: mapApproval(consumed.rows[0]) };
    });
    if (outcome.error) throw outcome.error;
    return outcome.value;
  }
}

module.exports = new GovernanceApprovalService();
module.exports.GovernanceApprovalService = GovernanceApprovalService;
module.exports.actionDigest = actionDigest;
module.exports.canonicalJson = canonicalJson;
module.exports.mapApproval = mapApproval;
