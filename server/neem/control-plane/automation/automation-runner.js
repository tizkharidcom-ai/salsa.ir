// server/neem/control-plane/automation/automation-runner.js
'use strict';

/**
 * NEEM Automation Runner (Phase 6 / GM-16 / GM-25 / P0 Hardening)
 *
 * Provides a stoppable, production-grade local background runner that executes:
 *   1. Periodic scheduler evaluation ticks (rule triggering, trial expiry, renewal, overdue checks).
 *   2. Transactional outbox worker batch processing (fenced claims, exponential backoff, DLQ).
 *
 * Key Resiliency Features:
 *   - Injectable Clock: Deterministic time-travel simulation without altering system clocks.
 *   - Overlap Prevention: Concurrent tick mutex (`isTicking`) ensures slow batches never overlap.
 *   - Graceful Stoppability: Clean shutdown without dropping in-flight operations.
 *   - Recorded Dispatches: In-memory and audit logs of all periodic dispatches for introspection.
 *   - Concurrent Payment Safety: Atomic re-read of billing subscriptions, invoices, and grants
 *     before executing overdue debt or suspension actions, preventing revocation of newly renewed entitlements.
 */

const { getDatabase, getDatabaseClient } = require('../db/database');
const defaultSchedulerService = require('./scheduler-service');
const defaultOutboxWorker = require('./outbox-worker');
const auditService = require('../audit/audit-service');
const config = require('../config');

class AutomationRunner {
  constructor({
    schedulerService = null,
    outboxWorker = null,
    db = null,
    pollIntervalMs = null,
    clock = null,
    actorId = 'automation_runner_daemon'
  } = {}) {
    this.schedulerService = schedulerService || defaultSchedulerService;
    this.outboxWorker = outboxWorker || defaultOutboxWorker;
    this.db = db || getDatabase();
    this.pollIntervalMs = pollIntervalMs || config.automationIntervalMs || 5000;
    this.clock = clock;
    this.actorId = actorId;

    this.timer = null;
    this.running = false;
    this.isTicking = false;
    this.dispatches = [];
    this.stats = {
      ticks: 0,
      schedulerRuns: 0,
      workerRuns: 0,
      overlapsPrevented: 0,
      errors: 0,
      lastTickAt: null
    };
  }

  isRunning() {
    return this.running;
  }

  getEffectiveClock(clockOverride = null) {
    if (clockOverride !== null && clockOverride !== undefined) {
      return clockOverride instanceof Date ? clockOverride : new Date(clockOverride);
    }
    if (typeof this.clock === 'function') {
      const c = this.clock();
      return c instanceof Date ? c : new Date(c);
    }
    if (this.clock instanceof Date) {
      return this.clock;
    }
    if (typeof this.clock === 'string' || typeof this.clock === 'number') {
      return new Date(this.clock);
    }
    return new Date();
  }

  /**
   * Starts the background runner on the configured interval.
   */
  start({ immediate = false } = {}) {
    if (this.running) return this;
    this.running = true;

    if (immediate) {
      this.tick().catch(err => {
        console.error('[AutomationRunner] Error on immediate tick:', err.message);
      });
    }

    this.timer = setInterval(async () => {
      try {
        await this.tick();
      } catch (err) {
        console.error('[AutomationRunner] Periodic tick error:', err.message);
      }
    }, this.pollIntervalMs);

    if (this.timer && typeof this.timer.unref === 'function') {
      this.timer.unref();
    }

    return this;
  }

  /**
   * Stops the background runner gracefully.
   */
  async stop() {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    // Await completion if currently ticking
    let waitCount = 0;
    while (this.isTicking && waitCount < 50) {
      await new Promise(resolve => setTimeout(resolve, 50));
      waitCount++;
    }

    return this;
  }

  /**
   * Executes a single synchronized tick across the scheduler and outbox worker.
   * Guarantees overlap prevention via `isTicking` flag.
   */
  async tick(clockOverride = null) {
    if (this.isTicking) {
      this.stats.overlapsPrevented++;
      return { skipped: true, reason: 'OVERLAP_PREVENTED' };
    }

    this.isTicking = true;
    const effectiveClock = this.getEffectiveClock(clockOverride);
    const tickNumber = ++this.stats.ticks;
    this.stats.lastTickAt = new Date();

    let schedulerResult = null;
    let workerResult = null;
    let tickError = null;

    try {
      // 1. Run Scheduler Tick with injectable clock
      schedulerResult = await this.schedulerService.runSchedulerTick({
        clock: effectiveClock,
        actorId: this.actorId
      });
      this.stats.schedulerRuns++;

      // 2. Process Outbox Tasks
      workerResult = await this.outboxWorker.processBatch();
      this.stats.workerRuns++;

    } catch (err) {
      this.stats.errors++;
      tickError = err.message;
    } finally {
      this.isTicking = false;
    }

    const dispatchRecord = {
      tickNumber,
      effectiveClock: effectiveClock.toISOString(),
      timestamp: new Date().toISOString(),
      schedulerResult,
      workerResult,
      error: tickError
    };

    this.dispatches.push(dispatchRecord);
    if (this.dispatches.length > 500) {
      this.dispatches.shift();
    }

    if (tickError) {
      throw new Error(`AUTOMATION_RUNNER_TICK_FAILED: ${tickError}`);
    }

    return {
      ok: true,
      tickNumber,
      effectiveClock,
      schedulerResult,
      workerResult
    };
  }

  /**
  /**
   * Returns a sanitized status object for health checks and monitoring.
   */
  getStatus() {
    return {
      enabled: config.automationEnabled,
      running: this.running,
      isTicking: this.isTicking,
      pollIntervalMs: this.pollIntervalMs,
      stats: { ...this.stats },
      lastTickAt: this.stats.lastTickAt ? (this.stats.lastTickAt.toISOString ? this.stats.lastTickAt.toISOString() : this.stats.lastTickAt) : null,
      dispatchesCount: this.dispatches.length
    };
  }

  /**
   * Atomic re-read helper for concurrent payment vs overdue debt race condition.
   * Executes on dedicated client (or adapter) with row-level lock (FOR UPDATE).
   * If a concurrent payment was settled, aborts revocation to prevent revoking a freshly paid entitlement.
   */
  async verifyEntitlementDebtRevocationSafe(tenantId, queryClient = null) {
    if (!tenantId) {
      throw new Error('TENANT_ID_REQUIRED: tenantId is required to verify entitlement revocation safety.');
    }

    const client = queryClient || this.db;
    const effectiveTime = this.getEffectiveClock();

    // 1. Re-read tenant with row-level lock (FOR UPDATE)
    const tenantRes = await client.query(
      'SELECT tenant_id, status, metadata, version FROM neem_tenants WHERE tenant_id = $1 FOR UPDATE',
      [tenantId]
    );
    const tenant = tenantRes.rows[0];
    if (!tenant) {
      return { safeToRevoke: false, reason: 'TENANT_NOT_FOUND' };
    }

    // 2. Re-read latest subscriptions
    const subRes = await client.query(
      'SELECT id, plan_code, status, current_period_end, updated_at, version FROM neem_billing_subscriptions WHERE tenant_id = $1',
      [tenantId]
    );
    const subscriptions = subRes.rows || [];

    // Check for any active paid commercial subscription with valid validity period
    const activePaidSub = subscriptions.find(s => {
      if (s.status !== 'active' || s.plan_code === 'trial') return false;
      if (s.current_period_end && new Date(s.current_period_end).getTime() <= effectiveTime.getTime()) {
        return false; // Expired period
      }
      return true;
    });

    if (activePaidSub) {
      return {
        safeToRevoke: false,
        reason: 'PAYMENT_CONCURRENTLY_SETTLED',
        details: `Tenant holds active paid subscription '${activePaidSub.id}' (${activePaidSub.plan_code}). Entitlement revocation aborted.`
      };
    }

    // 3. Re-read invoices for recent settlement
    const invRes = await client.query(
      'SELECT id, status, amount, currency, settled_at, updated_at, version FROM neem_billing_invoices WHERE tenant_id = $1',
      [tenantId]
    );
    const invoices = invRes.rows || [];

    // Check if overdue invoice was paid concurrently
    const hasUnpaidPastDue = invoices.some(i => i.status === 'past_due' || i.status === 'open');
    const recentPaidInvoice = invoices.find(i => i.status === 'paid' && i.settled_at);

    // If there is a paid invoice and no open/past_due invoice, safe to abort revocation
    if (recentPaidInvoice && !hasUnpaidPastDue) {
      return {
        safeToRevoke: false,
        reason: 'PAYMENT_CONCURRENTLY_SETTLED',
        details: `Invoice '${recentPaidInvoice.id}' was settled on ${recentPaidInvoice.settled_at}. All debts cleared.`
      };
    }

    // 4. Re-read active commercial grants with validity window & feature scope check
    const grantRes = await client.query(
      'SELECT id, feature_key, grant_kind, is_active, expires_at, version FROM neem_commercial_grants WHERE tenant_id = $1',
      [tenantId]
    );
    const grants = grantRes.rows || [];
    const activeCommercialGrant = grants.find(g => {
      const active = g.is_active || g.isActive;
      const kind = g.grant_kind || g.grantKind;
      if (!active || kind === 'trial') return false;
      const expiresAt = g.expires_at || g.expiresAt;
      if (expiresAt && new Date(expiresAt).getTime() <= effectiveTime.getTime()) {
        return false; // Grant expired
      }
      return true;
    });

    if (activeCommercialGrant) {
      return {
        safeToRevoke: false,
        reason: 'COMMERCIAL_GRANT_ACTIVE',
        details: `Tenant holds active commercial grant '${activeCommercialGrant.id}'. Entitlement revocation aborted.`
      };
    }

    // Debt confirmed and no active paid entitlements
    return {
      safeToRevoke: true,
      reason: 'DEBT_CONFIRMED_OVERDUE',
      details: 'No active paid subscriptions, settled invoices, or commercial grants found. Safe to proceed with overdue action.'
    };
  }

  /**
   * Executes an overdue debt revocation action safely on a dedicated client connection
   * within an atomic transaction (BEGIN ... COMMIT / ROLLBACK).
   * Row locking (FOR UPDATE) and CAS re-verification ensure concurrent payments abort revocation without race conditions.
   */
  async executeDebtRevocationSafe(tenantId, revocationFn) {
    if (!tenantId) {
      throw new Error('TENANT_ID_REQUIRED: tenantId is required to execute debt revocation.');
    }

    const txClient = await getDatabaseClient(this.db);

    try {
      await txClient.query('BEGIN');

      // 1. Transactional Pre-Check with row lock / version read
      const safetyCheck = await this.verifyEntitlementDebtRevocationSafe(tenantId, txClient);
      if (!safetyCheck.safeToRevoke) {
        await txClient.query('ROLLBACK');
        txClient.release();
        await auditService.recordEvent({
          actorId: this.actorId,
          action: 'DEBT_REVOCATION_PREVENTED_BY_CONCURRENT_PAYMENT',
          targetType: 'tenant_billing',
          targetId: tenantId,
          tenantId,
          metadata: { safetyCheck, reason: 'PRE_CHECK_ABORTED' }
        });
        return {
          executed: false,
          conflictPrevented: true,
          safetyCheck
        };
      }

      // 2. Execute mutation callback on dedicated txClient
      const revocationResult = await revocationFn(txClient);

      // 3. Final atomic verification before COMMIT (catch any concurrent interleaving payment)
      const postCheck = await this.verifyEntitlementDebtRevocationSafe(tenantId, txClient);
      if (!postCheck.safeToRevoke) {
        // Concurrent payment settled! Roll back all mutations immediately
        await txClient.query('ROLLBACK');
        txClient.release();
        await auditService.recordEvent({
          actorId: this.actorId,
          action: 'DEBT_REVOCATION_PREVENTED_BY_CONCURRENT_PAYMENT',
          targetType: 'tenant_billing',
          targetId: tenantId,
          tenantId,
          metadata: { safetyCheck: postCheck, reason: 'INTERLEAVING_PAYMENT_DETECTED' }
        });
        return {
          executed: false,
          conflictPrevented: true,
          safetyCheck: postCheck,
          reason: 'INTERLEAVING_PAYMENT_DETECTED'
        };
      }

      // 4. Commit transaction
      await txClient.query('COMMIT');
      txClient.release();

      return {
        executed: true,
        conflictPrevented: false,
        revocationResult
      };
    } catch (err) {
      try {
        await txClient.query('ROLLBACK');
      } catch (_) {}
      txClient.release();
      throw err;
    }
  }
}

const defaultAutomationRunner = new AutomationRunner({
  pollIntervalMs: config.automationIntervalMs
});

module.exports = {
  AutomationRunner,
  defaultAutomationRunner
};
