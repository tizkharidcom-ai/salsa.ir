// server/salsa/control-plane/policy/grant-service.js
'use strict';

const crypto = require('crypto');
const { getDatabase } = require('../db/database');
const catalogService = require('./catalog-service');
const auditService = require('../audit/audit-service');

function mapGrant(row, now = Date.now()) {
  const expiresAt = row.expires_at ?? row.valid_until ?? null;
  const expiryTime = expiresAt ? new Date(expiresAt).getTime() : Infinity;
  const statusAllows = row.status == null
    ? row.is_active === true
    : String(row.status).toLowerCase() === 'active' && row.is_active !== false;
  const isActive = statusAllows && expiryTime > now;
  return {
    id: row.id,
    tenantId: row.tenant_id,
    featureKey: row.feature_key,
    grantKind: row.grant_kind,
    status: isActive ? 'active' : 'inactive',
    isActive,
    expiresAt,
    grantedBy: row.granted_by,
    metadata: row.metadata,
    createdAt: row.created_at
  };
}

async function withTransaction(pool, database, work, { allowExistingClient = false } = {}) {
  if (allowExistingClient && database && typeof database.release === 'function') {
    return work(database);
  }

  const connectionPool = database || pool;
  if (!connectionPool || typeof connectionPool.connect !== 'function') {
    const error = new Error('GRANT_TRANSACTION_UNAVAILABLE: durable grant and audit writes require a transaction-capable database pool.');
    error.code = 'GRANT_TRANSACTION_UNAVAILABLE';
    throw error;
  }

  const client = await connectionPool.connect();
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

class GrantService {
  constructor() {
    this.db = getDatabase();
  }

  async listGrants(tenantId, { database = this.db } = {}) {
    if (!tenantId) return [];
    const sql = 'SELECT * FROM neem_commercial_grants WHERE tenant_id = $1';
    const res = await database.query(sql, [tenantId]);
    return res.rows.map(row => mapGrant(row));
  }

  async issueGrant({
    tenantId,
    featureKey,
    grantKind = 'addon',
    durationMonths = 12,
    actorId,
    idempotencyKey = null,
    metadata = {},
    database
  }) {
    if (!tenantId || !featureKey) {
      throw new Error('Validation Error: tenantId and featureKey are required.');
    }
    if (typeof actorId !== 'string' || !actorId.trim()) {
      throw new Error('PLATFORM_ACTOR_REQUIRED: commercial grants require an authenticated platform principal.');
    }

    const feature = catalogService.getFeature(featureKey);
    if (!feature) {
      throw new Error(`Feature '${featureKey}' is not recognized in canonical catalog.`);
    }
    const module = feature.moduleKey ? catalogService.getModule(feature.moduleKey) : null;
    if (!module || module.commercialState !== 'addon' || ['planned', 'retired'].includes(module.lifecycle)) {
      throw new Error(`MODULE_COMMERCIAL_STATE_BLOCKED: ${feature.moduleKey || featureKey}`);
    }
    if (!['plan', 'addon', 'trial', 'custom'].includes(grantKind)) {
      throw new Error(`INVALID_GRANT_KIND: ${grantKind}`);
    }
    if (idempotencyKey !== null && (typeof idempotencyKey !== 'string' || !idempotencyKey.trim() || idempotencyKey.length > 200)) {
      throw new Error('INVALID_IDEMPOTENCY_KEY: idempotencyKey must be a non-empty string up to 200 characters.');
    }
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
      throw new Error('INVALID_GRANT_METADATA: metadata must be an object.');
    }
    if (durationMonths !== null && (!Number.isInteger(durationMonths) || durationMonths < 1 || durationMonths > 120)) {
      throw new Error('INVALID_GRANT_DURATION: durationMonths must be null for an explicit permanent grant or an integer from 1 to 120.');
    }

    const grantId = crypto.randomUUID();
    const expiresAt = durationMonths ? new Date(Date.now() + durationMonths * 30 * 86400 * 1000) : null;

    const sql = `
      INSERT INTO neem_commercial_grants
        (id, tenant_id, feature_key, grant_kind, expires_at, granted_by, metadata)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (tenant_id, feature_key) DO UPDATE
        SET grant_kind = EXCLUDED.grant_kind,
            expires_at = EXCLUDED.expires_at,
            granted_by = EXCLUDED.granted_by,
            metadata = EXCLUDED.metadata,
            updated_at = now()
      RETURNING *
    `;

    const targetDatabase = database || this.db;
    return withTransaction(this.db, targetDatabase, async transaction => {
      // Serialize dependency checks per tenant across all Control Plane workers.
      await transaction.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)', [String(tenantId)]);

      if (idempotencyKey) {
        const priorResult = await transaction.query(
          'SELECT * FROM neem_commercial_grants WHERE tenant_id = $1 AND feature_key = $2 FOR UPDATE',
          [tenantId, featureKey]
        );
        const prior = priorResult.rows?.[0];
        let priorMetadata = prior?.metadata;
        if (typeof priorMetadata === 'string') {
          try { priorMetadata = JSON.parse(priorMetadata); } catch (_error) { priorMetadata = null; }
        }
        if (prior && priorMetadata?.idempotency_key === idempotencyKey) return prior;
      }

      const currentGrants = await this.listGrants(tenantId, { database: transaction });
      const activeKeys = currentGrants.filter(grant => grant.isActive).map(grant => grant.featureKey);
      // Included capabilities are effective from base policy and do not need a duplicate grant row.
      const includedKeys = catalogService.getFeatures()
        .filter(item => item.priceMonthly === 0)
        .map(item => item.key);
      const depCheck = catalogService.validateDependencies(featureKey, [...new Set([...activeKeys, ...includedKeys])]);
      if (!depCheck.valid) {
        throw new Error(`DEPENDENCY_VIOLATION: ${depCheck.error}`);
      }

      const res = await transaction.query(sql, [
        grantId,
        tenantId,
        featureKey,
        grantKind,
        expiresAt,
        actorId,
        idempotencyKey ? { ...metadata, idempotency_key: idempotencyKey } : metadata
      ]);
      const persistedGrant = res.rows?.[0];
      if (!persistedGrant?.id) {
        const error = new Error('GRANT_WRITE_NOT_PERSISTED: database returned no persisted grant row.');
        error.code = 'GRANT_WRITE_NOT_PERSISTED';
        throw error;
      }

      await auditService.recordEvent({
        actorId,
        action: 'COMMERCIAL_GRANT_ISSUED',
        targetType: 'commercial_grant',
        targetId: persistedGrant.id,
        tenantId,
        metadata: { feature_key: featureKey, grant_kind: grantKind, expires_at: expiresAt },
        database: transaction
      });

      return persistedGrant;
    }, { allowExistingClient: targetDatabase !== this.db });
  }

  async revokeGrant({
    tenantId,
    featureKey,
    actorId,
    reason = 'AUTOMATION_REVOCATION',
    database
  }) {
    if (!tenantId || !featureKey) {
      throw new Error('Validation Error: tenantId and featureKey are required to revoke grant.');
    }
    if (typeof actorId !== 'string' || !actorId.trim()) {
      throw new Error('PLATFORM_ACTOR_REQUIRED: grant revocation requires an authenticated platform principal.');
    }

    const sql = 'DELETE FROM neem_commercial_grants WHERE tenant_id = $1 AND feature_key = $2 RETURNING *';
    const targetDatabase = database || this.db;
    return withTransaction(this.db, targetDatabase, async transaction => {
      await transaction.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)', [String(tenantId)]);
      const res = await transaction.query(sql, [tenantId, featureKey]);
      const deleted = res.rows && res.rows[0];

      await auditService.recordEvent({
        actorId,
        action: 'COMMERCIAL_GRANT_REVOKED',
        targetType: 'commercial_grant',
        targetId: deleted ? deleted.id : `${tenantId}:${featureKey}`,
        tenantId,
        metadata: { feature_key: featureKey, reason },
        database: transaction
      });

      return { revoked: Boolean(deleted), grant: deleted || null };
    }, { allowExistingClient: targetDatabase !== this.db });
  }
}

module.exports = new GrantService();
module.exports.mapGrant = mapGrant;
