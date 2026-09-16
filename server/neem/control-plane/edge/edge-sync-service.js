// server/neem/control-plane/edge/edge-sync-service.js
'use strict';

const crypto = require('crypto');
const config = require('../config');
const { getDatabase } = require('../db/database');
const { EdgePairingLeaseService } = require('./edge-pairing-lease-service');
const { SignedPackageRunner } = require('./signed-package-runner');

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

class EdgeSyncService {
  constructor(options = {}) {
    this.db = options.db || getDatabase();
    this.leaseService = options.leaseService || new EdgePairingLeaseService({ db: this.db });
    // Simulated cloud table states and processed order ledger for idempotency
    this.cloudProcessedOrders = new Map();
    this.cloudTableStates = new Map();
    this.blockedUsers = new Set();
    this.publicKey = options.publicKey || config.edgeUpdatePublicKey || null;
    this.packageRunner = options.packageRunner || (
      process.env.NEEM_EDGE_PACKAGE_ARTIFACT_DIR && this.publicKey
        ? new SignedPackageRunner({
          rootDir: process.env.NEEM_EDGE_PACKAGE_ARTIFACT_DIR,
          publicKey: this.publicKey
        })
        : null
    );
  }

  setUpdatePublicKey(pubKey) {
    this.publicKey = pubKey;
  }

  setBlockedUser(userId) {
    this.blockedUsers.add(userId);
  }

  /**
   * Two-Way Sync Batch from Edge Station to Cloud
   */
  async syncBatch({ tenantId, deviceId, leaseToken, batch = [] }) {
    // 1. Verify offline lease & fencing
    const leaseCheck = await this.leaseService.validateLease(leaseToken);
    if (!leaseCheck.valid) {
      const err = new Error(leaseCheck.message || leaseCheck.reason);
      err.code = leaseCheck.reason;
      err.status = 403;
      throw err;
    }

    if (leaseCheck.lease.tenant_id !== tenantId || leaseCheck.lease.device_id !== deviceId) {
      const err = new Error('Lease does not belong to this tenant or device');
      err.code = 'TENANT_DEVICE_MISMATCH';
      err.status = 403;
      throw err;
    }

    const syncedEntityIds = [];
    const quarantinedConflicts = [];
    const duplicateDeduplicated = [];

    for (const item of batch) {
      if (item.entity_kind === 'order') {
        const order = item.payload;
        if (!order || !order.order_id) {
          const err = new Error('INVALID_EDGE_ORDER: order_id is required for durable replay protection.');
          err.code = 'INVALID_EDGE_ORDER';
          err.status = 400;
          throw err;
        }

        // AC-45: the database receipt is authoritative; the Map is only a
        // convenience projection for this harness and must not decide replay.
        const payloadJson = canonicalJson(order);
        const payloadHash = crypto.createHash('sha256').update(payloadJson, 'utf8').digest('hex');
        const inserted = await this.db.query(
          `INSERT INTO neem_edge_order_receipts
             (tenant_id, order_id, device_id, receipt_number, payload_hash, order_payload)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (tenant_id, order_id) DO NOTHING
           RETURNING tenant_id, order_id, payload_hash`,
          [tenantId, order.order_id, deviceId, order.receipt_number || null, payloadHash, payloadJson]
        );

        if (inserted.rows.length === 0) {
          const existing = await this.db.query(
            `SELECT tenant_id, order_id, payload_hash
             FROM neem_edge_order_receipts
             WHERE tenant_id = $1 AND order_id = $2`,
            [tenantId, order.order_id]
          );
          if (existing.rows.length === 0) {
            const err = new Error('EDGE_ORDER_RECEIPT_MISSING_AFTER_CONFLICT: durable replay receipt could not be read.');
            err.code = 'EDGE_ORDER_RECEIPT_MISSING_AFTER_CONFLICT';
            err.status = 503;
            throw err;
          }
          if (existing.rows[0].payload_hash !== payloadHash) {
            const err = new Error('EDGE_ORDER_PAYLOAD_MISMATCH: an existing order_id was replayed with different content.');
            err.code = 'EDGE_ORDER_PAYLOAD_MISMATCH';
            err.status = 409;
            throw err;
          }
          duplicateDeduplicated.push(order.order_id);
          syncedEntityIds.push(order.order_id);
          continue;
        }

        // Project only after the durable receipt has been accepted. Financial
        // application remains downstream of this same idempotent order_id.
        this.cloudProcessedOrders.set(order.order_id, {
          ...order,
          cloud_ingested_at: new Date().toISOString()
        });
        syncedEntityIds.push(order.order_id);
      } else if (item.entity_kind === 'table_status') {
        const update = item.payload;
        const entityId = item.entity_id;

        // AC-47: If updating user was blocked while offline, quarantine without silent drop
        if (update.updated_by && this.blockedUsers.has(update.updated_by)) {
          const conflictId = `conf_${crypto.randomUUID().slice(0, 8)}`;
          const conflictRecord = {
            id: conflictId,
            tenant_id: tenantId,
            device_id: deviceId,
            entity_kind: 'table_status',
            entity_id: entityId,
            conflict_policy: 'quarantine',
            cloud_state: this.cloudTableStates.get(entityId) || { status: 'unknown' },
            edge_state: update,
            reason: 'USER_BLOCKED_DURING_OFFLINE',
            resolution_status: 'open'
          };

          await this.db.query(
            `INSERT INTO neem_edge_sync_conflicts (id, tenant_id, device_id, entity_kind, entity_id, conflict_policy, cloud_state, edge_state, resolution_status, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())`,
            [
              conflictRecord.id,
              conflictRecord.tenant_id,
              conflictRecord.device_id,
              conflictRecord.entity_kind,
              conflictRecord.entity_id,
              conflictRecord.conflict_policy,
              JSON.stringify(conflictRecord.cloud_state),
              JSON.stringify(conflictRecord.edge_state),
              conflictRecord.resolution_status
            ]
          );

          quarantinedConflicts.push(conflictRecord);
          continue;
        }

        // LWW (Last-Write-Wins) resolution for concurrent table status edits
        const currentCloudState = this.cloudTableStates.get(entityId);
        if (!currentCloudState || update.timestamp_ms >= (currentCloudState.timestamp_ms || 0)) {
          this.cloudTableStates.set(entityId, update);
          syncedEntityIds.push(entityId);
        } else {
          // Cloud has newer timestamp, skip or resolve to cloud
          syncedEntityIds.push(entityId);
        }
      }
    }

    return {
      synced_count: syncedEntityIds.length,
      synced_entity_ids: syncedEntityIds,
      duplicate_deduplicated: duplicateDeduplicated,
      quarantined_conflicts: quarantinedConflicts
    };
  }

  /**
   * Signed Update Package Verification (AC-56)
   * Enforces Ed25519 asymmetric public-key signature verification with zero shared secrets.
   */
  async registerSignedPackage({ version, packageUrl, rawContent, signatureHex }) {
    if (!version || !packageUrl || !rawContent || !signatureHex) {
      throw new Error('All package fields (version, packageUrl, rawContent, signatureHex) are required.');
    }

    const pubKey = this.publicKey || config.edgeUpdatePublicKey;
    if (!pubKey) {
      const err = new Error('FAIL-CLOSED: NEEM_EDGE_UPDATE_PUBLIC_KEY is not configured on the Control Plane.');
      err.code = 'MISSING_UPDATE_PUBLIC_KEY';
      err.status = 500;
      throw err;
    }

    // 1. Checksum SHA-256
    const calculatedChecksum = crypto.createHash('sha256').update(rawContent).digest('hex');
    let packageUrlObject;
    try {
      packageUrlObject = new URL(String(packageUrl));
    } catch {
      const err = new Error('INVALID_PACKAGE_URL: packageUrl must be a valid HTTPS URL.');
      err.code = 'INVALID_PACKAGE_URL';
      err.status = 400;
      throw err;
    }
    if (packageUrlObject.protocol !== 'https:') {
      const err = new Error('INVALID_PACKAGE_URL: edge packages must be fetched over HTTPS.');
      err.code = 'INVALID_PACKAGE_URL';
      err.status = 400;
      throw err;
    }
    if (!/^[0-9a-f]{128}$/i.test(String(signatureHex))) {
      const err = new Error('INVALID_PACKAGE_SIGNATURE_FORMAT: Ed25519 signatures must be 64 bytes.');
      err.code = 'INVALID_PACKAGE_SIGNATURE_FORMAT';
      err.status = 400;
      throw err;
    }

    // 2. Ed25519 Public Key Signature verification
    const messageBuffer = Buffer.from(`${version}:${calculatedChecksum}`, 'utf8');
    const signatureBuffer = Buffer.from(signatureHex, 'hex');

    let isSignatureValid = false;
    try {
      isSignatureValid = crypto.verify(null, messageBuffer, pubKey, signatureBuffer);
    } catch (err) {
      isSignatureValid = false;
    }

    if (!isSignatureValid) {
      const err = new Error('INVALID_PACKAGE_SIGNATURE: The edge package failed Ed25519 cryptographic verification.');
      err.code = 'INVALID_PACKAGE_SIGNATURE';
      err.status = 400;
      throw err;
    }

    // 3. Register valid package in database
    let staged = null;
    if (this.packageRunner) {
      staged = await this.packageRunner.stage({
        version,
        packageUrl,
        rawContent,
        signatureHex,
        expectedChecksum: calculatedChecksum
      });
    }

    await this.db.query(
      `INSERT INTO neem_edge_packages (version, package_url, checksum_sha256, signature_hex, release_notes, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())`,
      [version, packageUrl, calculatedChecksum, signatureHex, `Release package ${version}`]
    );

    return {
      version,
      package_url: packageUrl,
      checksum_sha256: calculatedChecksum,
      status: 'verified_and_registered',
      staged
    };
  }
}

module.exports = {
  EdgeSyncService
};
