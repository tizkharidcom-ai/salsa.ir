// server/salsa/control-plane/edge/edge-local-store.js
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

/**
 * EdgeLocalStore represents the resilient local transactional store
 * on an offline POS terminal or in-store Edge station. When storagePath is
 * provided, every state transition is atomically persisted before it returns;
 * the default remains an isolated in-memory harness for unit tests.
 */
class EdgeLocalStore {
  constructor(options = {}) {
    const isTest = process.env.NODE_ENV === 'test' || process.env.NEEM_ENV === 'test';
    if (!isTest && (!options.deviceId || !options.tenantId || !options.branchCode)) {
      throw new Error('EDGE_IDENTITY_REQUIRED: tenantId, branchCode and deviceId are mandatory outside tests.');
    }
    this.deviceId = options.deviceId || 'test-device';
    this.tenantId = options.tenantId || 'test-tenant';
    this.branchCode = options.branchCode || 'TEST';
    this.storagePath = options.storagePath ? path.resolve(options.storagePath) : null;
    this.sequenceCounter = 0;
    this.lastRecordedTimestamp = 0;

    // Local tables. A durable snapshot is used when storagePath is configured;
    // the shape intentionally remains portable to a future SQLite adapter.
    this.orders = [];
    this.tableStatuses = {};
    this.outbox = [];
    this.cachedMenu = options.initialMenu || [];

    const loaded = this._loadPersistentState();
    if (this.storagePath && !loaded) this._persist();
  }

  _snapshot() {
    return {
      schema_version: 1,
      tenant_id: this.tenantId,
      branch_code: this.branchCode,
      device_id: this.deviceId,
      sequence_counter: this.sequenceCounter,
      last_recorded_timestamp: this.lastRecordedTimestamp,
      orders: this.orders,
      table_statuses: this.tableStatuses,
      outbox: this.outbox,
      cached_menu: this.cachedMenu
    };
  }

  _loadPersistentState() {
    if (!this.storagePath || !fs.existsSync(this.storagePath)) return false;
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(this.storagePath, 'utf8'));
    } catch (error) {
      const err = new Error(`EDGE_LOCAL_STORE_CORRUPT: cannot read ${this.storagePath}.`);
      err.cause = error;
      throw err;
    }
    if (parsed.schema_version !== 1 || parsed.tenant_id !== this.tenantId ||
      parsed.branch_code !== this.branchCode || parsed.device_id !== this.deviceId) {
      throw new Error('EDGE_LOCAL_STORE_SCOPE_MISMATCH: durable state belongs to another edge identity.');
    }
    if (!Number.isSafeInteger(parsed.sequence_counter) || parsed.sequence_counter < 0 ||
      !Number.isFinite(parsed.last_recorded_timestamp) || !Array.isArray(parsed.orders) ||
      !Array.isArray(parsed.outbox) || !parsed.table_statuses || typeof parsed.table_statuses !== 'object') {
      throw new Error('EDGE_LOCAL_STORE_CORRUPT: durable state shape is invalid.');
    }
    this.sequenceCounter = parsed.sequence_counter;
    this.lastRecordedTimestamp = parsed.last_recorded_timestamp;
    this.orders = parsed.orders;
    this.tableStatuses = parsed.table_statuses;
    this.outbox = parsed.outbox;
    this.cachedMenu = Array.isArray(parsed.cached_menu) ? parsed.cached_menu : this.cachedMenu;
    return true;
  }

  _persist() {
    if (!this.storagePath) return;
    const directory = path.dirname(this.storagePath);
    fs.mkdirSync(directory, { recursive: true });
    const temporaryPath = `${this.storagePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
    let descriptor;
    try {
      fs.writeFileSync(temporaryPath, JSON.stringify(this._snapshot()), { encoding: 'utf8', mode: 0o600 });
      descriptor = fs.openSync(temporaryPath, 'r');
      fs.fsyncSync(descriptor);
      fs.closeSync(descriptor);
      descriptor = undefined;
      fs.renameSync(temporaryPath, this.storagePath);
    } catch (error) {
      if (descriptor !== undefined) fs.closeSync(descriptor);
      try { fs.unlinkSync(temporaryPath); } catch {}
      throw new Error(`EDGE_LOCAL_STORE_PERSIST_FAILED: ${error.message}`);
    }
  }

  /**
   * Monotonic wall clock check (AC-43 clock tampering defense)
   */
  assertMonotonicClock(nowMs = Date.now()) {
    if (nowMs < this.lastRecordedTimestamp) {
      const skewMs = this.lastRecordedTimestamp - nowMs;
      throw new Error(`CLOCK_TAMPER_DETECTED: System clock moved backwards by ${skewMs}ms.`);
    }
    this.lastRecordedTimestamp = nowMs;
    return true;
  }

  /**
   * Generates a collision-free local receipt number
   * Format: {BRANCH}-{DEVICE}-{DATE}-{SEQ}
   */
  generateReceiptNumber(now = new Date()) {
    this.assertMonotonicClock(now.getTime());
    this.sequenceCounter += 1;
    const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
    const seqStr = String(this.sequenceCounter).padStart(5, '0');
    return `${this.branchCode}-${this.deviceId}-${dateStr}-${seqStr}`;
  }

  /**
   * Creates an order locally while completely offline
   */
  createOfflineOrder(orderData, now = new Date()) {
    this.assertMonotonicClock(now.getTime());
    const receiptNumber = this.generateReceiptNumber(now);
    const orderId = orderData.order_id || crypto.randomUUID();

    let subtotal = 0;
    for (const item of (orderData.items || [])) {
      subtotal += (item.unit_price_rials || 0) * (item.quantity || 1);
    }
    const taxRials = Math.round(subtotal * 0.10); // 10% Iranian VAT
    const totalRials = subtotal + taxRials;

    const order = {
      order_id: orderId,
      receipt_number: receiptNumber,
      tenant_id: this.tenantId,
      branch_code: this.branchCode,
      device_id: this.deviceId,
      table_number: orderData.table_number || null,
      items: orderData.items || [],
      subtotal_rials: subtotal,
      tax_rials: taxRials,
      total_rials: totalRials,
      status: 'completed',
      created_at: now.toISOString()
    };

    this.orders.push(order);

    // Queue in local outbox for cloud sync
    this.outbox.push({
      outbox_id: crypto.randomUUID(),
      entity_kind: 'order',
      entity_id: orderId,
      payload: order,
      status: 'pending_sync',
      attempts: 0,
      created_at: now.toISOString()
    });

    this._persist();

    return order;
  }

  /**
   * Updates table occupancy status locally
   */
  updateTableStatus(tableNumber, status, updatedBy = 'waiter-local', now = new Date()) {
    this.assertMonotonicClock(now.getTime());
    const prev = this.tableStatuses[tableNumber];
    const update = {
      table_number: tableNumber,
      status,
      updated_by: updatedBy,
      updated_at: now.toISOString(),
      timestamp_ms: now.getTime()
    };
    this.tableStatuses[tableNumber] = update;

    this.outbox.push({
      outbox_id: crypto.randomUUID(),
      entity_kind: 'table_status',
      entity_id: `table_${tableNumber}`,
      payload: update,
      status: 'pending_sync',
      attempts: 0,
      created_at: now.toISOString()
    });

    this._persist();

    return update;
  }

  /**
   * Gets pending items from outbox to sync with cloud
   */
  getPendingOutboxItems() {
    return this.outbox.filter(i => i.status === 'pending_sync');
  }

  /**
   * Acknowledges successfully synced outbox items
   */
  acknowledgeSync(syncedEntityIds = []) {
    const idSet = new Set(syncedEntityIds);
    for (const item of this.outbox) {
      if (idSet.has(item.entity_id)) {
        item.status = 'synced';
        item.synced_at = new Date().toISOString();
      }
    }
    this._persist();
  }

  getOrders() {
    return [...this.orders];
  }

  getTableStatus(tableNumber) {
    return this.tableStatuses[tableNumber] || null;
  }
}

module.exports = {
  EdgeLocalStore
};
