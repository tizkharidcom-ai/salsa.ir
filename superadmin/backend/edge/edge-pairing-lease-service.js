// server/salsa/control-plane/edge/edge-pairing-lease-service.js
'use strict';

const crypto = require('crypto');
const { sha256 } = require('../auth/crypto-util');
const { getDatabase } = require('../db/database');

class EdgePairingLeaseService {
  constructor(options = {}) {
    this.db = options.db || getDatabase();
  }

  /**
   * Generates a 6-character random pairing code for a branch
   */
  generatePairingCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(crypto.randomInt(0, chars.length));
    }
    return `${code.slice(0, 3)}-${code.slice(3)}`;
  }

  /**
   * Registers/pairs a new edge device
   */
  async pairDevice({ tenantId, branchId, deviceName, deviceKind = 'pos_station', pairingCode }) {
    const deviceId = `dev_${crypto.randomUUID().slice(0, 8)}`;
    const rawSecret = crypto.randomBytes(32).toString('hex');
    const secretHash = sha256(rawSecret);

    const res = await this.db.query(
      `INSERT INTO neem_edge_devices (id, tenant_id, branch_id, device_name, device_kind, pairing_code, device_secret_hash, status, fencing_epoch, last_seen_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'paired', 1, NOW())
       RETURNING *`,
      [deviceId, tenantId, branchId, deviceName, deviceKind, pairingCode, secretHash]
    );

    const device = res.rows[0];

    // Issue initial 24h lease
    const lease = await this.issueLease(device.id, tenantId, device.fencing_epoch);

    return {
      device: {
        id: device.id,
        tenant_id: device.tenant_id,
        branch_id: device.branch_id,
        device_name: device.device_name,
        device_kind: device.device_kind,
        status: device.status,
        fencing_epoch: device.fencing_epoch
      },
      device_secret: rawSecret,
      lease
    };
  }

  /**
   * Issues a signed 24h offline lease for a valid device
   */
  async issueLease(deviceId, tenantId, fencingEpoch = 1) {
    const leaseId = `lease_${crypto.randomUUID().slice(0, 8)}`;
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = sha256(rawToken);
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    await this.db.query(
      `INSERT INTO neem_edge_leases (id, device_id, tenant_id, lease_token_hash, lease_epoch, expires_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       RETURNING *`,
      [leaseId, deviceId, tenantId, tokenHash, fencingEpoch, expiresAt]
    );

    return {
      lease_id: leaseId,
      lease_token: rawToken,
      expires_at: expiresAt.toISOString(),
      lease_epoch: fencingEpoch
    };
  }

  /**
   * Validates an edge lease token and its fencing epoch
   */
  async validateLease(rawLeaseToken) {
    if (!rawLeaseToken) {
      return { valid: false, reason: 'MISSING_LEASE_TOKEN' };
    }

    const tokenHash = sha256(rawLeaseToken);
    const leaseRes = await this.db.query(
      `SELECT l.*, d.status as device_status, d.fencing_epoch as device_fencing_epoch
       FROM neem_edge_leases l
       JOIN neem_edge_devices d ON l.device_id = d.id
       WHERE l.lease_token_hash = $1`,
      [tokenHash]
    );

    if (leaseRes.rows.length === 0) {
      return { valid: false, reason: 'INVALID_LEASE_TOKEN' };
    }

    const lease = leaseRes.rows[0];

    if (lease.revoked_at) {
      return { valid: false, reason: 'LEASE_REVOKED' };
    }

    if (new Date() > new Date(lease.expires_at)) {
      return { valid: false, reason: 'OFFLINE_LEASE_EXPIRED', expires_at: lease.expires_at };
    }

    if (lease.device_status === 'fenced' || lease.device_status === 'decommissioned') {
      return { valid: false, reason: 'FENCED_DEVICE_REJECTED' };
    }

    // AC-46 Generation Fencing check
    if (lease.lease_epoch < lease.device_fencing_epoch) {
      return { 
        valid: false, 
        reason: 'STALE_GENERATION_FENCED', 
        message: 'This device lease epoch is stale; an updated edge station took ownership.'
      };
    }

    return {
      valid: true,
      lease: {
        id: lease.id,
        device_id: lease.device_id,
        tenant_id: lease.tenant_id,
        lease_epoch: lease.lease_epoch,
        expires_at: lease.expires_at
      }
    };
  }

  /**
   * Fences an existing edge device (e.g. decommission or replace terminal)
   */
  async fenceDevice(deviceId, tenantId, reason = 'device_replaced') {
    const res = await this.db.query(
      `UPDATE neem_edge_devices
       SET status = 'fenced', fencing_epoch = fencing_epoch + 1
       WHERE id = $1 AND tenant_id = $2
       RETURNING *`,
      [deviceId, tenantId]
    );

    if (res.rows.length === 0) {
      throw new Error(`Device ${deviceId} not found for tenant ${tenantId}`);
    }

    return res.rows[0];
  }

  /**
   * Lists device inventory without returning pairing material or secret hashes.
   * The optional tenant filter is applied in SQL so callers cannot accidentally
   * build a cross-tenant inventory from an unscoped result set.
   */
  async listDevices(tenantId = null) {
    const query = tenantId
      ? `SELECT id, tenant_id, branch_id, device_name, device_kind, status, fencing_epoch, last_seen_at, created_at
         FROM neem_edge_devices WHERE tenant_id = $1 ORDER BY created_at DESC`
      : `SELECT id, tenant_id, branch_id, device_name, device_kind, status, fencing_epoch, last_seen_at, created_at
         FROM neem_edge_devices ORDER BY created_at DESC`;
    const result = await this.db.query(query, tenantId ? [tenantId] : []);
    return result.rows.map((device) => ({
      id: device.id,
      tenant_id: device.tenant_id,
      branch_id: device.branch_id,
      device_name: device.device_name,
      device_kind: device.device_kind,
      status: device.status,
      fencing_epoch: device.fencing_epoch,
      last_seen_at: device.last_seen_at,
      created_at: device.created_at
    }));
  }
}

module.exports = {
  EdgePairingLeaseService
};
