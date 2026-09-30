// server/salsa/control-plane/policy/override-service.js
'use strict';

const crypto = require('crypto');
const { getDatabase } = require('../db/database');
const auditService = require('../audit/audit-service');

class OverrideService {
  constructor() {
    this.db = getDatabase();
  }

  async listOverrides(tenantId, userId = null) {
    if (!tenantId) return [];
    let sql = 'SELECT * FROM neem_personal_overrides WHERE tenant_id = $1';
    const params = [tenantId];
    if (userId) {
      sql += ' AND user_id = $2';
      params.push(userId);
    }
    const res = await this.db.query(sql, params);
    return res.rows.map(r => ({
      id: r.id,
      tenantId: r.tenant_id,
      userId: r.user_id,
      permissionKey: r.permission_key,
      state: r.state,
      decisionReason: r.decision_reason,
      actorId: r.actor_id,
      updatedAt: r.updated_at
    }));
  }

  async setOverride({
    tenantId,
    userId,
    permissionKey,
    state = 'inherit',
    decisionReason = '',
    actorId = 'system'
  }) {
    if (!tenantId || !userId || !permissionKey) {
      throw new Error('Validation Error: tenantId, userId, and permissionKey are required.');
    }

    if (!['inherit', 'allow', 'deny'].includes(state)) {
      throw new Error(`Invalid state '${state}'. Must be one of: inherit, allow, deny.`);
    }

    if ((state === 'allow' || state === 'deny') && (!decisionReason || decisionReason.trim().length < 5)) {
      throw new Error('REASON_REQUIRED: Explicit allow or deny overrides strictly require a documented decision reason (min 5 characters).');
    }

    const overrideId = crypto.randomUUID();

    if (state === 'inherit') {
      await this.db.query(
        'DELETE FROM neem_personal_overrides WHERE tenant_id = $1 AND user_id = $2 AND permission_key = $3',
        [tenantId, userId, permissionKey]
      );
      await auditService.recordEvent({
        actorId,
        action: 'PERSONAL_OVERRIDE_RESET_INHERIT',
        targetType: 'personal_override',
        targetId: `${tenantId}:${userId}:${permissionKey}`,
        tenantId,
        metadata: { permission_key: permissionKey, state: 'inherit' }
      });
      return { tenantId, userId, permissionKey, state: 'inherit', decisionReason: 'ارث‌بری پیش‌فرض از نقش' };
    }

    const sql = `
      INSERT INTO neem_personal_overrides
        (id, tenant_id, user_id, permission_key, state, decision_reason, actor_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (tenant_id, user_id, permission_key) DO UPDATE
        SET state = EXCLUDED.state,
            decision_reason = EXCLUDED.decision_reason,
            actor_id = EXCLUDED.actor_id,
            updated_at = now()
      RETURNING *
    `;

    const res = await this.db.query(sql, [
      overrideId,
      tenantId,
      userId,
      permissionKey,
      state,
      decisionReason.trim(),
      actorId
    ]);

    await auditService.recordEvent({
      actorId,
      action: `PERSONAL_OVERRIDE_${state.toUpperCase()}`,
      targetType: 'personal_override',
      targetId: overrideId,
      tenantId,
      metadata: { user_id: userId, permission_key: permissionKey, state, decision_reason: decisionReason }
    });

    return res.rows[0];
  }
}

module.exports = new OverrideService();
