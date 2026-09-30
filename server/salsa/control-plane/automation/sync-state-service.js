// server/salsa/control-plane/automation/sync-state-service.js
'use strict';

const crypto = require('crypto');
const { getDatabase } = require('../db/database');
const auditService = require('../audit/audit-service');

function sanitizeIncidentText(val) {
  if (!val) return '';
  let s = typeof val === 'string' ? val : JSON.stringify(val);
  // Redact bearer tokens
  s = s.replace(/bearer\s+[a-zA-Z0-9_\-\.]+/gi, 'Bearer [REDACTED_TOKEN]');
  // Redact 32-64 hex strings (secrets/keys)
  s = s.replace(/\b[0-9a-fA-F]{32,64}\b/g, '[REDACTED_SECRET]');
  // Redact credentials and secrets
  s = s.replace(/(password|secret|token|recovery_code|bootstrap_secret|key)["']?\s*[:=]\s*["']?(?!\[REDACTED)[^"',\s}]+/gi, '$1=[REDACTED]');
  // Redact Iranian mobile numbers
  s = s.replace(/\b09\d{9}\b/g, '[REDACTED_PHONE]');
  // Redact national IDs (10 digits)
  s = s.replace(/\b\d{10}\b/g, '[REDACTED_NATIONAL_ID]');
  return s;
}

function sanitizeMetadata(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(sanitizeMetadata);
  const clean = {};
  for (const [k, v] of Object.entries(obj)) {
    const lk = k.toLowerCase();
    if (lk.includes('secret') || lk.includes('password') || lk.includes('token') || lk.includes('key')) {
      clean[k] = '[REDACTED]';
    } else if (typeof v === 'object' && v !== null) {
      clean[k] = sanitizeMetadata(v);
    } else if (typeof v === 'string') {
      clean[k] = sanitizeIncidentText(v);
    } else {
      clean[k] = v;
    }
  }
  return clean;
}

class SyncStateService {
  constructor() {
    this.db = getDatabase();
  }

  async setDesiredState(tenantId, cellId, version) {
    const id = `${tenantId}:${cellId}`;
    const sql = `
      INSERT INTO neem_automation_cell_states
        (id, tenant_id, cell_id, desired_version, updated_at)
      VALUES ($1, $2, $3, $4, now())
      ON CONFLICT (tenant_id, cell_id) DO UPDATE
        SET desired_version = EXCLUDED.desired_version,
            updated_at = now()
      RETURNING *
    `;
    const res = await this.db.query(sql, [id, tenantId, cellId, version]);
    return res.rows[0];
  }

  async setAppliedState(tenantId, cellId, version) {
    const sql = `
      UPDATE neem_automation_cell_states
      SET applied_version = $1, updated_at = now()
      WHERE tenant_id = $2 AND cell_id = $3
      RETURNING *
    `;
    const res = await this.db.query(sql, [version, tenantId, cellId]);
    return res.rows[0];
  }

  async recordCellAcknowledgement(tenantId, cellId, version, ackHash) {
    const sql = `
      UPDATE neem_automation_cell_states
      SET ack_version = $1, ack_hash = $2, last_synced_at = now(), updated_at = now()
      WHERE tenant_id = $3 AND cell_id = $4
      RETURNING *
    `;
    const res = await this.db.query(sql, [version, ackHash, tenantId, cellId]);
    return res.rows[0];
  }

  async getSyncStatus(tenantId) {
    const sql = 'SELECT * FROM neem_automation_cell_states WHERE tenant_id = $1';
    const res = await this.db.query(sql, [tenantId]);
    return res.rows.map(r => ({
      tenantId: r.tenant_id,
      cellId: r.cell_id,
      desiredVersion: r.desired_version,
      appliedVersion: r.applied_version,
      ackVersion: r.ack_version,
      isFullySynced: r.desired_version === r.ack_version,
      lastSyncedAt: r.last_synced_at
    }));
  }

  /**
   * Records or deduplicates an operational incident for cell/tenant sync failure.
   * Idempotent: repeated attempts for the same active trigger & scope update the existing incident.
   */
  async recordSyncIncident({
    tenantId,
    cellId,
    triggerEvent,
    severity = 'sev3_minor',
    title,
    rootCause,
    mitigationActions = []
  }) {
    if (!tenantId || !cellId || !triggerEvent) {
      throw new Error('INCIDENT_ERROR: tenantId, cellId, and triggerEvent are required.');
    }

    const affectedScope = `${tenantId}:${cellId}`;
    const cleanTitle = sanitizeIncidentText(title || `Sync Incident: ${triggerEvent} on ${affectedScope}`);
    const cleanRootCause = sanitizeIncidentText(rootCause || 'Unspecified sync error');
    const cleanActions = sanitizeMetadata(mitigationActions);

    // 1. Deduplication check: Is there an existing active incident for this scope and trigger?
    const findSql = `
      SELECT * FROM neem_incidents 
      WHERE affected_scope = $1 AND trigger_event = $2 AND status != 'resolved'
    `;
    const existingRes = await this.db.query(findSql, [affectedScope, triggerEvent]);

    if (existingRes.rows && existingRes.rows.length > 0) {
      const existing = existingRes.rows[0];
      const prevActions = Array.isArray(existing.mitigation_actions) ? existing.mitigation_actions : [];
      const mergedActions = [
        ...prevActions.slice(-10),
        ...(Array.isArray(cleanActions) ? cleanActions : [cleanActions]),
        { deduplicated_at: new Date().toISOString() }
      ];

      // Upgrade severity if incoming is higher
      const severityOrder = { sev3_minor: 1, sev2_major: 2, sev1_critical: 3 };
      const currentLevel = severityOrder[existing.severity] || 1;
      const incomingLevel = severityOrder[severity] || 1;
      const targetSeverity = incomingLevel > currentLevel ? severity : existing.severity;

      const updateSql = `
        UPDATE neem_incidents 
        SET root_cause = $1, mitigation_actions = $2, severity = $3 
        WHERE id = $4 
        RETURNING *
      `;
      const updateRes = await this.db.query(updateSql, [
        cleanRootCause,
        JSON.stringify(mergedActions),
        targetSeverity,
        existing.id
      ]);

      return {
        incident: updateRes.rows[0] || existing,
        isNew: false,
        deduplicated: true
      };
    }

    // 2. New incident creation
    const incidentId = `inc_${crypto.randomUUID().slice(0, 12)}`;
    const insertSql = `
      INSERT INTO neem_incidents
        (id, title, severity, status, affected_scope, trigger_event, root_cause, mitigation_actions, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
      RETURNING *
    `;

    const insertRes = await this.db.query(insertSql, [
      incidentId,
      cleanTitle,
      severity,
      'investigating',
      affectedScope,
      triggerEvent,
      cleanRootCause,
      JSON.stringify(cleanActions)
    ]);

    const created = insertRes.rows[0];

    // Record traceable platform audit event
    try {
      await auditService.recordEvent({
        actorId: 'automation_sync_worker',
        actorRole: 'platform_system',
        action: 'incident.sync.created',
        targetType: 'sync_incident',
        targetId: incidentId,
        tenantId,
        metadata: {
          cellId,
          triggerEvent,
          severity,
          incidentId
        }
      });
    } catch (auditErr) {
      console.warn('[SyncStateService] Audit logging warning (fail-safe):', auditErr.message);
    }

    return {
      incident: created,
      isNew: true,
      deduplicated: false
    };
  }

  /**
   * Resolves active incidents for a tenant/cell scope upon successful synchronization
   */
  async resolveSyncIncident({ tenantId, cellId, triggerEvent }) {
    const affectedScope = `${tenantId}:${cellId}`;
    const updateSql = `
      UPDATE neem_incidents 
      SET status = 'resolved', resolved_at = NOW() 
      WHERE affected_scope = $1 AND trigger_event = $2 AND status != 'resolved'
      RETURNING *
    `;
    const res = await this.db.query(updateSql, [affectedScope, triggerEvent]);
    const resolvedRows = res.rows || [];

    for (const inc of resolvedRows) {
      try {
        await auditService.recordEvent({
          actorId: 'automation_sync_worker',
          actorRole: 'platform_system',
          action: 'incident.sync.resolved',
          targetType: 'sync_incident',
          targetId: inc.id,
          tenantId,
          metadata: {
            cellId,
            triggerEvent,
            incidentId: inc.id
          }
        });
      } catch (err) {
        // fail-safe
      }
    }

    return resolvedRows;
  }

  /**
   * Convenience method to trigger desync incident when cell acknowledgement diverges
   */
  async recordDesyncIncident({ tenantId, cellId, desiredVersion, appliedVersion, ackVersion, error = null }) {
    return this.recordSyncIncident({
      tenantId,
      cellId,
      triggerEvent: 'CELL_SYNC_DESYNC',
      severity: 'sev2_major',
      title: `Cell Sync Desynchronization: ${tenantId} on ${cellId}`,
      rootCause: `State divergence: desired=${desiredVersion}, applied=${appliedVersion}, ack=${ackVersion}. Error: ${error || 'ACK timeout'}`,
      mitigationActions: [
        { action: 'inspect_cell_connection', cellId },
        { action: 'force_state_resync', desiredVersion }
      ]
    });
  }

  async getIncidents({ tenantId = null, cellId = null, status = null } = {}) {
    let sql = 'SELECT * FROM neem_incidents';
    const params = [];

    if (tenantId && cellId) {
      sql += ' WHERE affected_scope = $1';
      params.push(`${tenantId}:${cellId}`);
    } else if (tenantId) {
      sql += ' WHERE affected_scope LIKE $1';
      params.push(`${tenantId}:%`);
    }

    const res = await this.db.query(sql, params);
    let rows = res.rows || [];
    if (status) {
      rows = rows.filter(r => r.status === status);
    }
    return rows;
  }

  async resolveIncident(incidentId, resolutionNotes = '', actorId = 'platform_operator') {
    const updateSql = `
      UPDATE neem_incidents 
      SET status = 'resolved', resolved_at = NOW() 
      WHERE id = $1
      RETURNING *
    `;
    const res = await this.db.query(updateSql, [incidentId]);
    const resolved = res.rows[0] || null;
    if (resolved) {
      await auditService.recordEvent({
        actorId,
        action: 'incident.resolved',
        targetType: 'sync_incident',
        targetId: incidentId,
        metadata: { resolutionNotes }
      });
    }
    return resolved;
  }
}

module.exports = new SyncStateService();
