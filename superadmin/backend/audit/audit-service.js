// server/salsa/control-plane/audit/audit-service.js
'use strict';

const crypto = require('crypto');
const { getDatabase } = require('../db/database');

const SENSITIVE_KEYS = new Set([
  'password',
  'password_hash',
  'secret',
  'secret_ciphertext',
  'totp_code',
  'token',
  'recovery_code',
  'bootstrap_secret',
  'credit_card',
  'authorization',
  'access_token',
  'refresh_token',
  'session_token',
  'mfa_token',
  'api_key',
  'private_key'
]);

function redactMetadata(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(redactMetadata);

  const clean = {};
  for (const [k, v] of Object.entries(obj)) {
    if (SENSITIVE_KEYS.has(k.toLowerCase())) {
      clean[k] = '[REDACTED]';
    } else if (typeof v === 'object' && v !== null) {
      clean[k] = redactMetadata(v);
    } else {
      clean[k] = v;
    }
  }
  return clean;
}

class AuditService {
  constructor() {
    this.db = getDatabase();
  }

  async recordEvent({
    actorId,
    actorRole = 'platform_owner',
    action,
    targetType,
    targetId = null,
    tenantId = null,
    requestId = null,
    clientIp = null,
    userAgent = null,
    metadata = {}
  }) {
    if (!actorId || !action || !targetType) {
      throw new Error('Audit Error: actorId, action, and targetType are mandatory for every audit event.');
    }

    const eventId = crypto.randomUUID();
    const cleanMeta = redactMetadata(metadata);

    const sql = `
      INSERT INTO neem_control_audit_events 
        (id, actor_id, actor_role, action, target_type, target_id, tenant_id, request_id, metadata, client_ip, user_agent)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *
    `;

    const params = [
      eventId,
      actorId,
      actorRole,
      action,
      targetType,
      targetId,
      tenantId,
      requestId,
      cleanMeta,
      clientIp,
      userAgent
    ];

    const result = await this.db.query(sql, params);
    return result.rows[0];
  }

  async listEvents({ limit = 50, tenantId = null } = {}) {
    let sql = 'SELECT * FROM neem_control_audit_events';
    const params = [];

    if (tenantId) {
      sql += ' WHERE tenant_id = $1';
      params.push(tenantId);
    }

    sql += ' ORDER BY occurred_at DESC LIMIT ' + Math.min(Number(limit) || 50, 100);

    const result = await this.db.query(sql, params);
    return result.rows;
  }
}

module.exports = new AuditService();
module.exports.redactMetadata = redactMetadata;
