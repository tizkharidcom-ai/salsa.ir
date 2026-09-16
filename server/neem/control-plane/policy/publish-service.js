// server/neem/control-plane/policy/publish-service.js
'use strict';

const crypto = require('crypto');
const { getDatabase } = require('../db/database');
const grantService = require('./grant-service');
const overrideService = require('./override-service');
const catalogService = require('./catalog-service');
const auditService = require('../audit/audit-service');

class PolicyPublishService {
  constructor() {
    this.db = getDatabase();
  }

  async publishPolicySnapshot({ tenantId, publishedBy = 'platform_owner', targetCell = 'cell-teh-01' }) {
    if (!tenantId) {
      throw new Error('Validation Error: tenantId is required.');
    }

    const grants = await grantService.listGrants(tenantId);
    const overrides = await overrideService.listOverrides(tenantId);
    const catalogChecksum = catalogService.getChecksum();

    const policyPayload = {
      tenantId,
      catalogChecksum,
      grants: grants.map(g => ({ key: g.featureKey, kind: g.grantKind, expiresAt: g.expiresAt })),
      overrides: overrides.map(o => ({ userId: o.userId, perm: o.permissionKey, state: o.state })),
      generatedAt: new Date().toISOString()
    };

    const payloadRaw = JSON.stringify(policyPayload);
    const policyHash = crypto.createHash('sha256').update(payloadRaw).digest('hex');
    const version = `pol_${tenantId}_${Date.now()}`;

    // 1. Save published snapshot
    const sqlSnap = `
      INSERT INTO neem_published_policies 
        (version, tenant_id, policy_payload, policy_hash, published_by)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `;
    await this.db.query(sqlSnap, [version, tenantId, policyPayload, policyHash, publishedBy]);

    // 2. Enqueue into Outbox Queue for cell distribution
    const outboxId = crypto.randomUUID();
    const sqlOutbox = `
      INSERT INTO neem_policy_outbox 
        (id, tenant_id, policy_version, target_cell, status, attempts)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `;
    const outboxRes = await this.db.query(sqlOutbox, [
      outboxId,
      tenantId,
      version,
      targetCell,
      'pending',
      1
    ]);

    // 3. Audit event
    await auditService.recordEvent({
      actorId: publishedBy,
      action: 'POLICY_SNAPSHOT_PUBLISHED',
      targetType: 'policy_snapshot',
      targetId: version,
      tenantId,
      metadata: { version, policy_hash: policyHash, target_cell: targetCell }
    });

    return {
      version,
      policyHash,
      outboxId,
      targetCell,
      status: 'enqueued'
    };
  }

  async listOutbox(tenantId = null) {
    let sql = 'SELECT * FROM neem_policy_outbox';
    const params = [];
    if (tenantId) {
      sql += ' WHERE tenant_id = $1';
      params.push(tenantId);
    }
    sql += ' ORDER BY created_at DESC LIMIT 50';
    const res = await this.db.query(sql, params);
    return res.rows;
  }

  async acknowledgeDistribution(outboxId) {
    if (!outboxId) return false;
    const sql = `
      UPDATE neem_policy_outbox 
      SET status = 'acknowledged', acked_at = now()
      WHERE id = $1
      RETURNING *
    `;
    const res = await this.db.query(sql, [outboxId]);
    return !!res.rows[0];
  }
}

module.exports = new PolicyPublishService();
