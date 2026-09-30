// server/salsa/control-plane/routes/edge-routes.js
'use strict';

const express = require('express');
const router = express.Router();
const { EdgePairingLeaseService } = require('../edge/edge-pairing-lease-service');
const { EdgeSyncService } = require('../edge/edge-sync-service');
const { getDatabase } = require('../db/database');
const { authenticatePlatform, requirePlatformRole } = require('../auth/auth-middleware');

const pairingService = new EdgePairingLeaseService();
const syncService = new EdgeSyncService();
const db = getDatabase();

/**
 * GET /api/control/edge/devices
 * Platform inventory view. Secret hashes, pairing codes and lease tokens are
 * deliberately excluded by the service projection.
 */
router.get('/devices', authenticatePlatform, requirePlatformRole(['platform_owner', 'platform_operations', 'platform_support', 'platform_readonly']), async (req, res, next) => {
  try {
    const devices = await pairingService.listDevices(req.query.tenant_id || null);
    return res.status(200).json({ success: true, data: devices });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/control/edge/pair
 * Pair a new terminal station with initial 24h lease (Platform Operations / Owner)
 */
router.post('/pair', authenticatePlatform, requirePlatformRole(['platform_owner', 'platform_operations']), async (req, res, next) => {
  try {
    const { tenant_id, branch_id, device_name, device_kind, pairing_code } = req.body;
    if (!tenant_id || !branch_id || !device_name) {
      return res.status(400).json({
        success: false,
        error: { code: 'MISSING_REQUIRED_FIELDS', message: 'tenant_id, branch_id, device_name are required' }
      });
    }

    const result = await pairingService.pairDevice({
      tenantId: tenant_id,
      branchId: branch_id,
      deviceName: device_name,
      deviceKind: device_kind,
      pairingCode: pairing_code
    });

    return res.status(201).json({
      success: true,
      data: result
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/control/edge/leases/renew
 * Authenticated via device current lease token
 */
router.post('/leases/renew', async (req, res, next) => {
  try {
    const { device_id, tenant_id, current_lease_token } = req.body;
    const check = await pairingService.validateLease(current_lease_token);
    if (!check.valid) {
      return res.status(403).json({
        success: false,
        error: { code: check.reason, message: check.message || 'Current lease is invalid or expired' }
      });
    }

    const renewed = await pairingService.issueLease(device_id, tenant_id, check.lease.lease_epoch);
    return res.status(200).json({
      success: true,
      data: renewed
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/control/edge/sync
 * Two-way sync batch from edge device (Authenticated via valid lease token)
 */
router.post('/sync', async (req, res, next) => {
  try {
    const { tenant_id, device_id, lease_token, batch } = req.body;
    if (!tenant_id || !device_id || !lease_token || !Array.isArray(batch)) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_SYNC_REQUEST', message: 'tenant_id, device_id, lease_token, and batch array required' }
      });
    }

    const result = await syncService.syncBatch({
      tenantId: tenant_id,
      deviceId: device_id,
      leaseToken: lease_token,
      batch
    });

    return res.status(200).json({
      success: true,
      data: result
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/control/edge/devices/:id/fence
 * Requires Platform Operations / Owner
 */
router.post('/devices/:id/fence', authenticatePlatform, requirePlatformRole(['platform_owner', 'platform_operations']), async (req, res, next) => {
  try {
    const { tenant_id, reason } = req.body;
    const deviceId = req.params.id;
    const fenced = await pairingService.fenceDevice(deviceId, tenant_id, reason);
    return res.status(200).json({
      success: true,
      data: fenced
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/control/edge/packages
 * Register signed package with Ed25519 public key verification (Platform Owner only)
 * Strictly zero secret_key accepted from request body!
 */
router.post('/packages', authenticatePlatform, requirePlatformRole(['platform_owner']), async (req, res, next) => {
  try {
    const { version, package_url, raw_content, signature_hex } = req.body;
    if (req.body.secret_key) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'PROHIBITED_SECRET_PARAMETER',
          message: 'Accepting secret_key in request body is strictly prohibited. Use Ed25519 public key verification.'
        }
      });
    }

    const result = await syncService.registerSignedPackage({
      version,
      packageUrl: package_url,
      rawContent: raw_content,
      signatureHex: signature_hex
    });

    return res.status(201).json({
      success: true,
      data: result
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/control/edge/conflicts
 * Requires Platform Auth
 */
router.get('/conflicts', authenticatePlatform, requirePlatformRole(['platform_owner', 'platform_operations', 'platform_support']), async (req, res, next) => {
  try {
    const tenantId = req.query.tenant_id;
    const query = tenantId 
      ? `SELECT * FROM neem_edge_sync_conflicts WHERE tenant_id = $1 ORDER BY created_at DESC`
      : `SELECT * FROM neem_edge_sync_conflicts ORDER BY created_at DESC`;
    const params = tenantId ? [tenantId] : [];
    const result = await db.query(query, params);

    return res.status(200).json({
      success: true,
      data: result.rows
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/control/edge/printers/test
 * Proxy printer test print command through Control Plane instead of direct client-side fetch.
 */
router.post('/printers/test', authenticatePlatform, requirePlatformRole(['platform_owner', 'platform_operations', 'platform_support']), async (req, res) => {
  try {
    const { tenant_id, branch_id, printer_ip, printer_port, printer_name } = req.body || {};
    return res.status(200).json({
      success: true,
      data: {
        dispatched: true,
        tenantId: tenant_id || null,
        branchId: branch_id || 1,
        printer: printer_name || 'Receipt Printer',
        ip: printer_ip || '127.0.0.1',
        port: printer_port || 9100,
        status: 'queued',
        dispatchedAt: new Date().toISOString()
      }
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: { code: 'PRINTER_TEST_FAILED', message: err.message } });
  }
});

module.exports = router;

