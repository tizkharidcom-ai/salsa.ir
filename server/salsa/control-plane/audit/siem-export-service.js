'use strict';

const crypto = require('node:crypto');
const { getDatabase, getDatabaseClient } = require('../db/database');
const { redactMetadata } = require('./audit-service');

const EXPORT_LOCK_KEY = 'neem-audit-siem-export-v1';
const CURSOR_ID = 'default';
const DEFAULT_BATCH_SIZE = 100;
const MAX_BATCH_SIZE = 500;
const DEFAULT_MAX_ATTEMPTS = 3;
const MAX_ATTEMPTS = 5;

function stableJson(value) {
  if (value === undefined) return 'null';
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function makeError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, details);
  return error;
}

function normalizeEvent(event) {
  return {
    id: event.id,
    actorId: event.actor_id || null,
    actorRole: event.actor_role || null,
    action: event.action,
    targetType: event.target_type,
    targetId: event.target_id || null,
    tenantId: event.tenant_id || null,
    requestId: event.request_id || null,
    metadata: redactMetadata(event.metadata || {}),
    clientIp: event.client_ip || null,
    userAgent: event.user_agent || null,
    prevHash: event.prev_hash || null,
    eventHash: event.event_hash || null,
    occurredAt: event.occurred_at instanceof Date
      ? event.occurred_at.toISOString()
      : (event.occurred_at ? new Date(event.occurred_at).toISOString() : null)
  };
}

function normalizeEndpoint(env) {
  const raw = String(env.NEEM_SIEM_INGEST_URL || '').trim();
  if (!raw) throw makeError('SIEM_EXPORT_NOT_CONFIGURED', 'NEEM_SIEM_INGEST_URL is required for audit export.');
  let endpoint;
  try {
    endpoint = new URL(raw);
  } catch {
    throw makeError('SIEM_EXPORT_ENDPOINT_INVALID', 'NEEM_SIEM_INGEST_URL must be a valid URL.');
  }
  const allowInsecureTest = env.NODE_ENV === 'test' && env.NEEM_SIEM_ALLOW_INSECURE_TEST_ENDPOINT === 'true';
  if (endpoint.protocol !== 'https:' && !allowInsecureTest) {
    throw makeError('SIEM_EXPORT_ENDPOINT_INSECURE', 'SIEM ingestion requires HTTPS outside an explicit test-only exception.');
  }
  const secret = String(env.NEEM_SIEM_HMAC_SECRET || '');
  if (secret.length < 32) {
    throw makeError('SIEM_EXPORT_SECRET_INVALID', 'NEEM_SIEM_HMAC_SECRET must be at least 32 characters long.');
  }
  const sourceId = String(env.NEEM_SIEM_SOURCE_ID || '').trim();
  if (!sourceId) throw makeError('SIEM_EXPORT_SOURCE_REQUIRED', 'NEEM_SIEM_SOURCE_ID is required for audit export.');
  return { endpoint, secret, sourceId };
}

class SiemExportService {
  constructor(options = {}) {
    this.db = options.db || getDatabase();
    this.env = options.env || process.env;
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
    this.sleep = options.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.clock = options.clock || (() => new Date());
  }

  getConfig() {
    return normalizeEndpoint(this.env);
  }

  async withExportLock(callback) {
    const client = await getDatabaseClient(this.db);
    try {
      await client.query('SELECT pg_advisory_lock(hashtext($1))', [EXPORT_LOCK_KEY]);
      return await callback(client);
    } finally {
      await client.query('SELECT pg_advisory_unlock(hashtext($1))', [EXPORT_LOCK_KEY]).catch(() => {});
      client.release?.();
    }
  }

  async readCursor(client) {
    const result = await client.query(
      `SELECT id, last_exported_occurred_at, last_exported_id, last_batch_id
       FROM neem_audit_export_cursors WHERE id = $1`,
      [CURSOR_ID]
    );
    const row = result.rows?.[0];
    return row ? {
      occurredAt: row.last_exported_occurred_at || null,
      eventId: row.last_exported_id || null,
      batchId: row.last_batch_id || null
    } : { occurredAt: null, eventId: null, batchId: null };
  }

  async readPendingEvents(client, cursor, limit) {
    const result = await client.query(
      `SELECT * FROM neem_control_audit_events
       WHERE ($1::timestamptz IS NULL
          OR occurred_at > $1::timestamptz
          OR (occurred_at = $1::timestamptz AND id > $2))
       ORDER BY occurred_at ASC, id ASC
       LIMIT $3`,
      [cursor.occurredAt, cursor.eventId || '', limit]
    );
    return result.rows || [];
  }

  buildEnvelope(events, sourceId) {
    const normalizedEvents = events.map(normalizeEvent);
    const payload = { schemaVersion: 1, sourceId, events: normalizedEvents };
    const digest = sha256(stableJson(payload));
    return {
      batchId: `audit_${digest.slice(0, 32)}`,
      body: stableJson({ ...payload, batchId: `audit_${digest.slice(0, 32)}` }),
      events: normalizedEvents,
      digest
    };
  }

  async sendEnvelope(envelope, config) {
    if (typeof this.fetchImpl !== 'function') {
      throw makeError('SIEM_EXPORT_FETCH_UNAVAILABLE', 'No fetch implementation is available for SIEM export.');
    }
    const timestamp = String(this.clock().getTime());
    const signature = crypto.createHmac('sha256', config.secret)
      .update(`${timestamp}.${envelope.body}`, 'utf8')
      .digest('hex');
    let response;
    try {
      response = await this.fetchImpl(config.endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          'x-neem-siem-source': config.sourceId,
          'x-neem-siem-timestamp': timestamp,
          'x-neem-siem-signature': `sha256=${signature}`,
          'idempotency-key': envelope.batchId
        },
        body: envelope.body
      });
    } catch (error) {
      throw makeError('SIEM_EXPORT_NETWORK_ERROR', error.message, { retryable: true, cause: error });
    }
    if (!response || response.status < 200 || response.status >= 300) {
      const responseText = response && typeof response.text === 'function' ? await response.text().catch(() => '') : '';
      const status = response?.status || 0;
      throw makeError('SIEM_EXPORT_HTTP_ERROR', `SIEM ingestion returned HTTP ${status}.`, {
        retryable: status === 429 || status >= 500 || status === 0,
        status,
        responseText: responseText.slice(0, 512)
      });
    }
    return { status: response.status, batchId: envelope.batchId, digest: envelope.digest };
  }

  async persistCursor(client, event, batchId) {
    await client.query('BEGIN');
    try {
      await client.query(
        `INSERT INTO neem_audit_export_cursors
          (id, last_exported_occurred_at, last_exported_id, last_batch_id, updated_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (id) DO UPDATE SET
           last_exported_occurred_at = EXCLUDED.last_exported_occurred_at,
           last_exported_id = EXCLUDED.last_exported_id,
           last_batch_id = EXCLUDED.last_batch_id,
           updated_at = NOW()`,
        [CURSOR_ID, event.occurredAt, event.id, batchId]
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw makeError('SIEM_EXPORT_CURSOR_PERSIST_FAILED', error.message, { cause: error });
    }
  }

  async exportOnce({ limit = DEFAULT_BATCH_SIZE } = {}) {
    const config = this.getConfig();
    const safeLimit = Math.min(Math.max(Number(limit) || DEFAULT_BATCH_SIZE, 1), MAX_BATCH_SIZE);
    return this.withExportLock(async (client) => {
      const cursor = await this.readCursor(client);
      const rows = await this.readPendingEvents(client, cursor, safeLimit);
      if (rows.length === 0) {
        return { exported: 0, pending: false, cursor };
      }
      const envelope = this.buildEnvelope(rows, config.sourceId);
      const sent = await this.sendEnvelope(envelope, config);
      const lastEvent = envelope.events[envelope.events.length - 1];
      await this.persistCursor(client, lastEvent, sent.batchId);
      return {
        exported: envelope.events.length,
        pending: envelope.events.length === safeLimit,
        batchId: sent.batchId,
        digest: sent.digest,
        cursor: { occurredAt: lastEvent.occurredAt, eventId: lastEvent.id, batchId: sent.batchId }
      };
    });
  }

  async exportPending({ limit = DEFAULT_BATCH_SIZE, maxAttempts = DEFAULT_MAX_ATTEMPTS } = {}) {
    const attempts = Math.min(Math.max(Number(maxAttempts) || DEFAULT_MAX_ATTEMPTS, 1), MAX_ATTEMPTS);
    let lastError;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        return { ...(await this.exportOnce({ limit })), attempts: attempt };
      } catch (error) {
        lastError = error;
        if (!error.retryable || attempt === attempts) throw error;
        await this.sleep(Math.min(1000, 100 * (2 ** (attempt - 1))));
      }
    }
    throw lastError;
  }
}

const defaultSiemExportService = new SiemExportService();

module.exports = {
  CURSOR_ID,
  DEFAULT_BATCH_SIZE,
  MAX_BATCH_SIZE,
  SiemExportService,
  defaultSiemExportService,
  normalizeEndpoint,
  normalizeEvent,
  stableJson
};
