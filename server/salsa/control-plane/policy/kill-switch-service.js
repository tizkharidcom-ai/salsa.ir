'use strict';

const { getDatabase } = require('../db/database');
const auditService = require('../audit/audit-service');

function parseJson(value, fallback) {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch (_error) { return fallback; }
}

function mapKillSwitch(row) {
  if (!row) return null;
  const parsedFeatureKeys = parseJson(row.feature_keys, null);
  const featureKeys = parsedFeatureKeys === null && row.feature_key
    ? [row.feature_key]
    : parsedFeatureKeys;
  if ((!Array.isArray(featureKeys) || featureKeys.length === 0 || featureKeys.some(key => typeof key !== 'string' || !key.trim()))
      && !row.module_key) {
    const error = new Error('KILLSWITCH_ROW_INVALID: persisted switch has no valid target.');
    error.code = 'KILLSWITCH_ROW_INVALID';
    throw error;
  }
  return {
    id: row.id,
    featureKey: row.feature_key || null,
    moduleKey: row.module_key || null,
    featureKeys: Array.isArray(featureKeys) ? featureKeys : [],
    scope: row.scope,
    reason: row.reason,
    severity: row.severity,
    createdBy: row.created_by,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    expiresAt: row.expires_at instanceof Date ? row.expires_at.toISOString() : row.expires_at,
    status: row.status,
    affectedTenantCount: Number(row.affected_tenant_count) || 0,
    approvalState: row.approval_state,
    distributionStatus: row.distribution_status || 'pending',
    distributionError: parseJson(row.distribution_error, null),
    distributedAt: row.distributed_at instanceof Date ? row.distributed_at.toISOString() : row.distributed_at
  };
}

async function withTransaction(pool, work) {
  if (!pool || typeof pool.connect !== 'function') {
    const error = new Error('KILLSWITCH_TRANSACTION_UNAVAILABLE: durable switch and audit writes require a transaction-capable database pool.');
    error.code = 'KILLSWITCH_TRANSACTION_UNAVAILABLE';
    throw error;
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (_rollbackError) { /* retain original failure */ }
    throw error;
  } finally {
    client.release();
  }
}

class KillSwitchService {
  constructor({ dbProvider = getDatabase } = {}) {
    this.dbProvider = dbProvider;
  }

  async listActive() {
    const result = await this.dbProvider().query(`
      SELECT * FROM neem_platform_kill_switches
      WHERE status = 'active' AND expires_at > now()
      ORDER BY created_at DESC
    `);
    return result.rows.map(mapKillSwitch);
  }

  async findActive(requestedKey) {
    const result = await this.dbProvider().query(`
      SELECT * FROM neem_platform_kill_switches
      WHERE requested_key = $1 AND status = 'active' AND expires_at > now()
      LIMIT 1
    `, [requestedKey]);
    return mapKillSwitch(result.rows[0]);
  }

  async activate({ id, requestedKey, featureKey, moduleKey, featureKeys, scope, reason, severity, createdBy, createdAt, expiresAt, affectedTenantCount = 0, approvalState }) {
    const targetKeys = Array.isArray(featureKeys) ? [...new Set(featureKeys)] : featureKey ? [featureKey] : [];
    const expirationTime = expiresAt ? Date.parse(expiresAt) : NaN;
    const valid = typeof requestedKey === 'string' && requestedKey.trim()
      && typeof id === 'string' && id.trim()
      && typeof createdBy === 'string' && createdBy.trim()
      && typeof reason === 'string' && reason.trim()
      && scope === 'global'
      && ['low', 'medium', 'high', 'critical'].includes(severity)
      && Number.isFinite(expirationTime) && expirationTime > Date.now()
      && Number.isInteger(affectedTenantCount) && affectedTenantCount >= 0
      && ['approved', 'auto_approved', 'pending'].includes(approvalState)
      && (targetKeys.length > 0 || (typeof moduleKey === 'string' && moduleKey.trim()))
      && (!featureKey || targetKeys.includes(featureKey))
      && targetKeys.every(key => typeof key === 'string' && key.trim());
    if (!valid) {
      const error = new Error('KILLSWITCH_VALIDATION_FAILED: a valid global target, reason, platform actor, approval state, and future expiry are required.');
      error.code = 'KILLSWITCH_VALIDATION_FAILED';
      throw error;
    }

    const pool = this.dbProvider();
    return withTransaction(pool, async database => {
      await database.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)', [String(requestedKey)]);
      const result = await database.query(`
      INSERT INTO neem_platform_kill_switches (
        id, requested_key, feature_key, module_key, feature_keys, scope, reason, severity,
        created_by, created_at, expires_at, status, affected_tenant_count, approval_state,
        distribution_status, distribution_error, distributed_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'active', $12, $13, 'pending', NULL, NULL, now())
      ON CONFLICT (requested_key) DO UPDATE SET
        feature_key = EXCLUDED.feature_key,
        module_key = EXCLUDED.module_key,
        feature_keys = EXCLUDED.feature_keys,
        scope = EXCLUDED.scope,
        reason = EXCLUDED.reason,
        severity = EXCLUDED.severity,
        created_by = EXCLUDED.created_by,
        expires_at = EXCLUDED.expires_at,
        status = 'active',
        affected_tenant_count = EXCLUDED.affected_tenant_count,
        approval_state = EXCLUDED.approval_state,
        distribution_status = 'pending',
        distribution_error = NULL,
        distributed_at = NULL,
        updated_at = now()
      RETURNING *
      `, [id, requestedKey, featureKey || (targetKeys.length === 1 ? targetKeys[0] : null), moduleKey || null, JSON.stringify(targetKeys), scope, reason.trim(), severity, createdBy, createdAt || new Date().toISOString(), new Date(expirationTime).toISOString(), affectedTenantCount, approvalState]);
      const row = result.rows?.[0];
      if (!row) {
        const error = new Error('KILLSWITCH_WRITE_NOT_PERSISTED: database returned no persisted switch row.');
        error.code = 'KILLSWITCH_WRITE_NOT_PERSISTED';
        throw error;
      }
      const mapped = mapKillSwitch(row);
      await auditService.recordEvent({
        actorId: createdBy,
        action: 'PLATFORM_KILLSWITCH_ACTIVATED',
        targetType: 'platform_kill_switch',
        targetId: mapped.id,
        metadata: {
          requested_key: requestedKey,
          feature_keys: mapped.featureKeys,
          module_key: mapped.moduleKey,
          scope: mapped.scope,
          severity: mapped.severity,
          approval_state: mapped.approvalState,
          expires_at: mapped.expiresAt
        },
        database
      });
      return mapped;
    });
  }

  async recordDistribution(requestedKey, { ok, status = null, error = null } = {}) {
    const distributionError = ok ? null : {
      code: error || 'KILLSWITCH_SYNC_FAILED',
      httpStatus: Number(status) || null
    };
    const pool = this.dbProvider();
    return withTransaction(pool, async database => {
      const result = await database.query(`
      UPDATE neem_platform_kill_switches
      SET distribution_status = $1,
          distribution_error = $2,
          distributed_at = CASE WHEN $1 = 'synced' THEN now() ELSE NULL END,
          updated_at = now()
      WHERE requested_key = $3 AND status IN ('active', 'revoked')
      RETURNING *
      `, [ok ? 'synced' : 'failed', distributionError, requestedKey]);
      const row = result.rows?.[0];
      if (!row) return null;
      const mapped = mapKillSwitch(row);
      await auditService.recordEvent({
        actorId: row.created_by,
        action: 'PLATFORM_KILLSWITCH_DISTRIBUTION_UPDATED',
        targetType: 'platform_kill_switch',
        targetId: mapped.id,
        metadata: { requested_key: requestedKey, distribution_status: mapped.distributionStatus, distribution_error: mapped.distributionError },
        database
      });
      return mapped;
    });
  }

  async revoke(requestedKey, { actorId, reason = 'OPERATOR_REQUEST' } = {}) {
    if (!actorId || !String(actorId).trim()) {
      const error = new Error('KILLSWITCH_ACTOR_REQUIRED: revocation requires the authenticated platform principal.');
      error.code = 'KILLSWITCH_ACTOR_REQUIRED';
      throw error;
    }
    const pool = this.dbProvider();
    return withTransaction(pool, async database => {
      await database.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)', [String(requestedKey)]);
      const result = await database.query(`
      UPDATE neem_platform_kill_switches
      SET status = 'revoked',
          distribution_status = 'pending',
          distribution_error = NULL,
          distributed_at = NULL,
          updated_at = now()
      WHERE requested_key = $1 AND status = 'active'
      RETURNING *
      `, [requestedKey]);
      const row = result.rows?.[0];
      if (!row) return null;
      const mapped = mapKillSwitch(row);
      await auditService.recordEvent({
        actorId,
        action: 'PLATFORM_KILLSWITCH_REVOKED',
        targetType: 'platform_kill_switch',
        targetId: mapped.id,
        metadata: { requested_key: requestedKey, reason },
        database
      });
      return mapped;
    });
  }
}

module.exports = new KillSwitchService();
module.exports.KillSwitchService = KillSwitchService;
module.exports.mapKillSwitch = mapKillSwitch;
