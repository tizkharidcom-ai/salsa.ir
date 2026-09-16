// server/neem/control-plane/routes/integration-routes.js
'use strict';

const crypto = require('crypto');
const express = require('express');
const config = require('../config');
const { getDatabase } = require('../db/database');
const outboxWorker = require('../automation/outbox-worker');

const router = express.Router();
const MAX_CLOCK_SKEW_MS = Math.max(10_000, Number(process.env.NEEM_BRIDGE_TIMESTAMP_TOLERANCE_MS || 5 * 60 * 1000));

function fail(res, status, code, message) {
  return res.status(status).json({
    success: false,
    error: { code, message }
  });
}

function safeEqualHex(actual, expected) {
  if (!actual || !expected || !/^[0-9a-f]+$/i.test(actual) || !/^[0-9a-f]+$/i.test(expected) || actual.length % 2 !== 0 || expected.length % 2 !== 0 || actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'));
}

function rawRequestBody(req) {
  if (typeof req.rawBody === 'string') return req.rawBody;
  return JSON.stringify(req.body || {});
}

function verifyBridgeSignature(req) {
  const secret = process.env.WESTO_NEEM_BRIDGE_SECRET || '';
  const timestamp = String(req.headers['x-westo-bridge-timestamp'] || '');
  const signature = String(req.headers['x-westo-bridge-signature'] || '').replace(/^sha256=/i, '');
  if (!secret || !timestamp || !signature || !/^\d{10,16}$/.test(timestamp)) {
    return { ok: false, code: 'BRIDGE_AUTH_REQUIRED', message: 'A configured bridge secret, timestamp, and HMAC signature are required.' };
  }

  const timestampMs = Number(timestamp);
  if (!Number.isFinite(timestampMs) || Math.abs(Date.now() - timestampMs) > MAX_CLOCK_SKEW_MS) {
    return { ok: false, code: 'BRIDGE_TIMESTAMP_INVALID', message: 'The bridge request timestamp is outside the allowed clock-skew window.' };
  }

  const raw = rawRequestBody(req);
  const expected = crypto.createHmac('sha256', secret).update(`${timestamp}.${raw}`).digest('hex');
  if (!safeEqualHex(signature, expected)) {
    return { ok: false, code: 'BRIDGE_SIGNATURE_INVALID', message: 'The bridge request signature could not be verified.' };
  }
  return { ok: true, raw };
}

async function registeredTenant(tenantId) {
  const db = getDatabase();
  const result = await db.query('SELECT tenant_id, status, cell_id FROM neem_tenants WHERE tenant_id = $1', [tenantId]);
  return result.rows?.[0] || null;
}

/**
 * WESTO server-to-server integration ingress.
 *
 * This route is intentionally not protected by a platform bearer session: it
 * is a service-to-service boundary. HMAC, timestamp, tenant registration and
 * idempotent transactional outbox enqueue are mandatory instead.
 */
router.post('/events', async (req, res) => {
  const verified = verifyBridgeSignature(req);
  if (!verified.ok) return fail(res, 401, verified.code, verified.message);

  const headerTenantId = String(req.headers['x-neem-tenant-id'] || '').trim().toLowerCase();
  const bodyTenantId = String(req.body?.tenantId || '').trim().toLowerCase();
  if (!headerTenantId || !bodyTenantId || headerTenantId !== bodyTenantId) {
    return fail(res, 400, 'BRIDGE_TENANT_MISMATCH', 'The signed tenant header and event tenantId must match.');
  }

  const tenant = await registeredTenant(headerTenantId);
  if (!tenant) {
    return fail(res, 409, 'BRIDGE_TENANT_NOT_REGISTERED', 'The event tenant is not registered in the NEEM Control Plane.');
  }
  if (tenant.status !== 'active') {
    return fail(res, 409, 'BRIDGE_TENANT_NOT_ACTIVE', 'Events for a non-active tenant are rejected.');
  }

  const payload = req.body && typeof req.body === 'object' ? req.body : {};
  const eventName = String(payload.type || payload.eventName || 'westo.order.upsert').trim();
  const idempotencyKey = String(payload.idempotencyKey || payload.eventId || '').trim();
  if (!idempotencyKey) {
    return fail(res, 400, 'BRIDGE_IDEMPOTENCY_REQUIRED', 'eventId or idempotencyKey is required for durable delivery.');
  }

  try {
    // The production adapter enforces a unique idempotency key in the
    // outbox.  Check first as well so the in-memory/test adapter and the
    // HTTP contract expose the same deterministic already_queued response.
    const existing = await getDatabase().query(
      'SELECT id, status FROM neem_automation_outbox WHERE idempotency_key = $1',
      [idempotencyKey]
    );
    if (existing.rows?.[0]) {
      return res.status(202).json({
        success: true,
        data: {
          status: 'already_queued',
          taskId: existing.rows[0].id || null,
          idempotencyKey,
          tenantId: headerTenantId,
          requestId: req.requestId
        }
      });
    }

    const task = await outboxWorker.enqueueTask({
      tenantId: headerTenantId,
      targetCell: tenant.cell_id || payload.targetCell || 'cell-teh-01',
      eventName,
      payload,
      idempotencyKey
    });
    return res.status(202).json({
      success: true,
      data: {
        status: task.status === 'already_queued' ? 'already_queued' : 'queued',
        taskId: task.id || null,
        idempotencyKey,
        tenantId: headerTenantId,
        requestId: req.requestId
      }
    });
  } catch (err) {
    return fail(res, 500, 'BRIDGE_OUTBOX_ENQUEUE_FAILED', err.message);
  }
});

module.exports = router;
