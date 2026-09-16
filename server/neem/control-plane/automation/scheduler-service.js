// server/neem/control-plane/automation/scheduler-service.js
'use strict';

const crypto = require('crypto');
const { getDatabase } = require('../db/database');
const ruleEngine = require('./rule-engine');
const outboxWorker = require('./outbox-worker');
const tenantService = require('../registry/tenant-service');
const grantService = require('../policy/grant-service');
const paymentService = require('../billing/payment-service');
const auditService = require('../audit/audit-service');

class AutomationSchedulerService {
  constructor() {
    this.db = getDatabase();
  }

  /**
   * Executes a scheduler tick with an injectable clock.
   * Re-reads the real, current state of tenants, subscriptions, and grants
   * right before executing any state mutation (AC-15, AC-22, AC-23).
   */
  async evaluateRules(options = {}) {
    const res = await this.runSchedulerTick(options);
    return { ok: true, ...res };
  }

  async runSchedulerTick({
    clock = new Date(),
    targetTenantId = null,
    dryRun = false,
    actorId = 'platform_scheduler'
  } = {}) {
    const rawClock = typeof clock === 'function' ? clock() : clock;
    const effectiveTime = rawClock instanceof Date ? rawClock : new Date(rawClock);
    const rules = await ruleEngine.listRules();
    const activeRules = rules.filter(r => !r.is_paused);

    // Identify target tenants
    let tenants = [];
    if (targetTenantId) {
      const t = await tenantService.getTenant(targetTenantId);
      if (t) tenants = [t];
    } else {
      tenants = await tenantService.listTenants();
    }

    const executedActions = [];

    for (const rule of activeRules) {
      for (const tenant of tenants) {
        const tenantId = tenant.tenant_id || tenant.id;

        // 1. RE-READ real, current state of tenant, subscriptions, and paid grants (AC-23)
        const currentTenant = await tenantService.getTenant(tenantId) || tenant;
        const subscriptions = await paymentService.listSubscriptions(tenantId);
        const grants = await grantService.listGrants(tenantId);

        // Check entitlement state
        const hasActivePaidSub = subscriptions.some(s => s.status === 'active' && (s.planCode || s.plan_code) !== 'trial');
        const isPastDue = subscriptions.some(s => s.status === 'past_due');
        const hasCommercialGrant = grants.some(g => g.isActive && g.grantKind !== 'trial');
        const trialGrants = grants.filter(g => g.isActive && g.grantKind === 'trial');

        // Check trial expiry
        let trialExpired = false;
        const rawTenantRes = await this.db.query('SELECT metadata FROM neem_tenants WHERE tenant_id = $1', [tenantId]);
        const rawTenantRow = rawTenantRes?.rows?.[0] || {};
        let rawMeta = {};
        try {
          rawMeta = typeof rawTenantRow.metadata === 'string' ? JSON.parse(rawTenantRow.metadata) : (rawTenantRow.metadata || {});
        } catch {
          rawMeta = {};
        }
        const trialEndsAtStr = rawMeta.trial_ends_at || rawMeta.trialEndsAt || currentTenant.metadata?.trial_ends_at || currentTenant.metadata?.trialEndsAt;
        if (trialEndsAtStr) {
          trialExpired = new Date(trialEndsAtStr).getTime() <= effectiveTime.getTime();
        } else if (trialGrants.length > 0 && trialGrants.some(g => g.expiresAt && new Date(g.expiresAt).getTime() <= effectiveTime.getTime())) {
          trialExpired = true;
        }

        let shouldTrigger = false;
        let conflictPrevented = null;
        let skipReason = null;

        // 2. Evaluate condition based on trigger kind
        if (rule.trigger_kind === 'trial_expiry') {
          if (trialExpired) {
            // Strict Precedence Rule (AC-15 / AC-22):
            // An expired trial must NEVER deactivate an active commercial paid subscription or grant!
            if (hasActivePaidSub || hasCommercialGrant) {
              shouldTrigger = false;
              conflictPrevented = 'CONFLICT_PREVENTED: Trial expiry suppressed because tenant holds active commercial paid entitlement.';
            } else {
              shouldTrigger = true;
            }
          } else {
            skipReason = 'Trial has not expired yet.';
          }
        } else if (rule.trigger_kind === 'payment_overdue') {
          // Re-read condition: If tenant paid between job scheduling and execution, DO NOT suspend (AC-23)
          if (isPastDue && !hasActivePaidSub) {
            shouldTrigger = true;
          } else {
            skipReason = 'Tenant is not in overdue state or has active paid subscription.';
          }
        } else if (rule.trigger_kind === 'subscription_renewal') {
          shouldTrigger = hasActivePaidSub;
        } else if (rule.trigger_kind === 'schedule_window') {
          const window = rule.schedule_window || {};
          const currentHour = effectiveTime.getHours();
          const startHour = window.start_hour !== undefined ? window.start_hour : (window.start_time ? parseInt(window.start_time.split(':')[0], 10) : null);
          const endHour = window.end_hour !== undefined ? window.end_hour : (window.end_time ? parseInt(window.end_time.split(':')[0], 10) : null);
          const inWindow = (startHour === null || currentHour >= startHour) &&
                           (endHour === null || currentHour < endHour);
          if (inWindow) {
            shouldTrigger = true;
          } else {
            skipReason = `Current time (${currentHour}:00) is outside schedule window (${startHour ?? 0}:00 - ${endHour ?? 24}:00).`;
          }
        } else if (rule.trigger_kind === 'custom_policy') {
          shouldTrigger = true;
        }

        // 3. Execution Idempotency Guard (AC-28)
        // Group by hour bucket to prevent re-executing same rule for tenant in the same cycle
        const hourBucket = effectiveTime.toISOString().slice(0, 13);
        const idempotencyKey = `exec_${rule.id}_${tenantId}_${rule.version}_${hourBucket}`;

        const executionId = 'exec_' + crypto.randomUUID().slice(0, 16);
        const conditionsSnapshot = {
          trialExpired,
          hasActivePaidSub,
          hasCommercialGrant,
          isPastDue,
          clock: effectiveTime.toISOString()
        };

        if (conflictPrevented) {
          // Record Conflict Prevention Event in Execution Log
          if (!dryRun) {
            await this.db.query(
              `INSERT INTO neem_automation_executions
                 (id, rule_id, rule_version, tenant_id, trigger_kind, status, conditions_snapshot, action_payload, action_result, conflict_resolution, error_message, executed_at, completed_at, idempotency_key)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now(), now(), $12)
               ON CONFLICT (idempotency_key) DO NOTHING`,
              [
                executionId,
                rule.id,
                rule.version,
                tenantId,
                rule.trigger_kind,
                'conflict_prevented',
                JSON.stringify(conditionsSnapshot),
                JSON.stringify(rule.action_payload),
                JSON.stringify({ prevented: true }),
                conflictPrevented,
                null,
                idempotencyKey
              ]
            );
          }

          executedActions.push({
            ruleId: rule.id,
            ruleName: rule.name,
            tenantId,
            status: 'conflict_prevented',
            conflictPrevented
          });
          continue;
        }

        if (!shouldTrigger) {
          if (skipReason && !dryRun) {
            await this.db.query(
              `INSERT INTO neem_automation_executions
                 (id, rule_id, rule_version, tenant_id, trigger_kind, status, conditions_snapshot, action_payload, action_result, conflict_resolution, error_message, executed_at, completed_at, idempotency_key)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now(), now(), $12)
               ON CONFLICT (idempotency_key) DO NOTHING`,
              [
                executionId,
                rule.id,
                rule.version,
                tenantId,
                rule.trigger_kind,
                'skipped',
                JSON.stringify(conditionsSnapshot),
                JSON.stringify(rule.action_payload),
                null,
                skipReason,
                null,
                idempotencyKey
              ]
            );
          }
          continue;
        }

        // Check if already executed in this cycle
        const existingExec = await this.db.query(
          'SELECT id FROM neem_automation_executions WHERE idempotency_key = $1',
          [idempotencyKey]
        );
        if (existingExec.rows && existingExec.rows.length > 0) {
          executedActions.push({
            ruleId: rule.id,
            ruleName: rule.name,
            tenantId,
            status: 'skipped_already_executed',
            idempotencyKey
          });
          continue;
        }

        if (dryRun) {
          executedActions.push({
            ruleId: rule.id,
            ruleName: rule.name,
            tenantId,
            status: 'dry_run_ready',
            actionPayload: rule.action_payload
          });
          continue;
        }

        // 4. DISPATCH ACTION to real services
        let actionResult = {};
        let executionError = null;

        try {
          const actionKind = rule.action_payload?.action || 'noop';

          if (actionKind === 'revoke_trial_grants') {
            const revoked = [];
            for (const tg of trialGrants) {
              await grantService.revokeGrant(
                tg.id,
                actorId,
                `لغو خودکار به دلیل انقضای آزمایشی طبق قانون ${rule.name} (نسخه ${rule.version})`
              );
              revoked.push(tg.featureKey);
            }
            actionResult = { revokedGrants: revoked };
          } else if (actionKind === 'grant_feature') {
            const { featureKey, grantKind = 'commercial', durationMonths = 1 } = rule.action_payload;
            const newGrant = await grantService.issueGrant({
              tenantId,
              featureKey,
              grantKind,
              durationMonths,
              actorId,
              metadata: { ruleId: rule.id, ruleVersion: rule.version }
            });
            actionResult = { issuedGrantId: newGrant.id, featureKey };
          } else if (actionKind === 'enqueue_outbox') {
            const { eventName = 'automation.rule.triggered', targetCell = currentTenant.cell_id || 'cell-teh-01', payload = {} } = rule.action_payload;
            const task = await outboxWorker.enqueueTask({
              tenantId,
              targetCell,
              eventName,
              payload: { ...payload, ruleId: rule.id, ruleVersion: rule.version, executionId },
              idempotencyKey: `task_${executionId}`
            });
            actionResult = { outboxTaskId: task.id };
          } else if (actionKind === 'suspend_tenant') {
            await this.db.query(
              "UPDATE neem_tenants SET status = 'suspended', updated_at = now() WHERE tenant_id = $1",
              [tenantId]
            );
            actionResult = { tenantStatus: 'suspended' };
          } else {
            actionResult = { executed: true, payload: rule.action_payload };
          }
        } catch (err) {
          executionError = err.message;
        }

        const finalStatus = executionError ? 'failed' : 'executed';

        // 5. Record Execution Log & Audit Event
        await this.db.query(
          `INSERT INTO neem_automation_executions
             (id, rule_id, rule_version, tenant_id, trigger_kind, status, conditions_snapshot, action_payload, action_result, conflict_resolution, error_message, executed_at, completed_at, idempotency_key)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now(), now(), $12)`,
          [
            executionId,
            rule.id,
            rule.version,
            tenantId,
            rule.trigger_kind,
            finalStatus,
            JSON.stringify(conditionsSnapshot),
            JSON.stringify(rule.action_payload),
            JSON.stringify(actionResult),
            null,
            executionError,
            idempotencyKey
          ]
        );

        // Bump rule execution metrics
        await this.db.query(
          `UPDATE neem_automation_rules
           SET execution_count = execution_count + 1,
               ${executionError ? 'failure_count = failure_count + 1,' : ''}
               last_executed_at = now()
           WHERE id = $1`,
          [rule.id]
        );

        await auditService.recordEvent({
          actorId,
          action: 'AUTOMATION_RULE_EXECUTED',
          targetType: 'automation_execution',
          targetId: executionId,
          tenantId,
          metadata: {
            ruleId: rule.id,
            ruleVersion: rule.version,
            status: finalStatus,
            error: executionError
          }
        });

        executedActions.push({
          executionId,
          ruleId: rule.id,
          ruleName: rule.name,
          tenantId,
          status: finalStatus,
          actionResult,
          error: executionError
        });
      }
    }

    return {
      clock: effectiveTime.toISOString(),
      activeRulesCount: activeRules.length,
      evaluatedTenantsCount: tenants.length,
      evaluated_tenants: tenants.length,
      actionsCount: executedActions.length,
      actions: executedActions
    };
  }

  async runScheduler(opts) {
    return this.runSchedulerTick(opts);
  }

  async listExecutions({ tenantId = null, ruleId = null, status = null, limit = 50 } = {}) {
    let sql = 'SELECT * FROM neem_automation_executions';
    const params = [];
    const conditions = [];

    if (tenantId) {
      params.push(tenantId);
      conditions.push(`tenant_id = $${params.length}`);
    }
    if (ruleId) {
      params.push(ruleId);
      conditions.push(`rule_id = $${params.length}`);
    }
    if (status) {
      params.push(status);
      conditions.push(`status = $${params.length}`);
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }

    sql += ' ORDER BY executed_at DESC';
    if (limit) {
      params.push(limit);
      sql += ` LIMIT $${params.length}`;
    }

    const res = await this.db.query(sql, params);
    return res.rows;
  }
}

module.exports = new AutomationSchedulerService();
