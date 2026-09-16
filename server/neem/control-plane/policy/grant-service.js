// server/neem/control-plane/policy/grant-service.js
'use strict';

const crypto = require('crypto');
const { getDatabase } = require('../db/database');
const catalogService = require('./catalog-service');
const auditService = require('../audit/audit-service');

class GrantService {
  constructor() {
    this.db = getDatabase();
  }

  async listGrants(tenantId) {
    if (!tenantId) return [];
    const sql = 'SELECT * FROM neem_commercial_grants WHERE tenant_id = $1';
    const res = await this.db.query(sql, [tenantId]);
    return res.rows.map(r => ({
      id: r.id,
      tenantId: r.tenant_id,
      featureKey: r.feature_key,
      grantKind: r.grant_kind,
      status: r.status || (r.is_active ? 'ACTIVE' : 'INACTIVE'),
      isActive: r.status ? r.status === 'ACTIVE' : (r.is_active !== false && (!r.expires_at || new Date(r.expires_at) > new Date())),
      expiresAt: r.expires_at || r.valid_until,
      grantedBy: r.granted_by,
      metadata: r.metadata,
      createdAt: r.created_at
    }));
  }

  async issueGrant({
    tenantId,
    featureKey,
    grantKind = 'addon',
    durationMonths = 12,
    actorId = 'system',
    metadata = {}
  }) {
    if (!tenantId || !featureKey) {
      throw new Error('Validation Error: tenantId and featureKey are required.');
    }

    const feature = catalogService.getFeature(featureKey);
    if (!feature) {
      throw new Error(`Feature '${featureKey}' is not recognized in canonical catalog.`);
    }

    // 1. Dependency Validation Check
    const currentGrants = await this.listGrants(tenantId);
    const activeKeys = currentGrants.map(g => g.featureKey);
    const depCheck = catalogService.validateDependencies(featureKey, activeKeys);
    if (!depCheck.valid) {
      throw new Error(`DEPENDENCY_VIOLATION: ${depCheck.error}`);
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

    const res = await this.db.query(sql, [
      grantId,
      tenantId,
      featureKey,
      grantKind,
      expiresAt,
      actorId,
      metadata
    ]);

    // Audit Event
    await auditService.recordEvent({
      actorId,
      action: 'COMMERCIAL_GRANT_ISSUED',
      targetType: 'commercial_grant',
      targetId: grantId,
      tenantId,
      metadata: { feature_key: featureKey, grant_kind: grantKind, expires_at: expiresAt }
    });

    return res.rows[0];
  }

  async revokeGrant({
    tenantId,
    featureKey,
    actorId = 'system',
    reason = 'AUTOMATION_REVOCATION'
  }) {
    if (!tenantId || !featureKey) {
      throw new Error('Validation Error: tenantId and featureKey are required to revoke grant.');
    }

    const sql = 'DELETE FROM neem_commercial_grants WHERE tenant_id = $1 AND feature_key = $2 RETURNING *';
    const res = await this.db.query(sql, [tenantId, featureKey]);
    const deleted = res.rows && res.rows[0];

    await auditService.recordEvent({
      actorId,
      action: 'COMMERCIAL_GRANT_REVOKED',
      targetType: 'commercial_grant',
      targetId: deleted ? deleted.id : `${tenantId}:${featureKey}`,
      tenantId,
      metadata: { feature_key: featureKey, reason }
    });

    return {
      revoked: Boolean(deleted),
      grant: deleted || null
    };
  }
}

module.exports = new GrantService();
