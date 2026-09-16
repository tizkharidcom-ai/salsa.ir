// server/neem/control-plane/automation/rule-engine.js
'use strict';

const crypto = require('crypto');
const { getDatabase } = require('../db/database');
const grantService = require('../policy/grant-service');
const auditService = require('../audit/audit-service');

class AutomationRuleEngine {
  constructor() {
    this.db = getDatabase();
  }

  /**
   * Creates or updates a versioned automation rule.
   * Archives a snapshot in neem_automation_rule_versions on every update.
   */
  async createOrUpdateRule({
    id = null,
    name,
    description = '',
    triggerKind,
    conditions = {},
    actionPayload = {},
    scheduleWindow = {},
    scheduleCron = null,
    priority = 10,
    actorId = 'platform_system'
  }) {
    if (!name || !triggerKind) {
      throw new Error('RULE_ERROR: name and triggerKind are required.');
    }

    const validTriggers = ['trial_expiry', 'subscription_renewal', 'payment_overdue', 'schedule_window', 'custom_policy'];
    if (!validTriggers.includes(triggerKind)) {
      throw new Error(`RULE_ERROR: Invalid triggerKind '${triggerKind}'. Must be one of: ${validTriggers.join(', ')}`);
    }

    let ruleId = id;
    let newVersion = 'v1';

    if (ruleId) {
      // Fetch existing rule to compute next version
      const existing = await this.getRuleById(ruleId);
      if (existing) {
        const curVerNum = parseInt((existing.version || 'v1').replace(/^v/, ''), 10) || 1;
        newVersion = `v${curVerNum + 1}`;
      }
    } else {
      ruleId = 'rule_' + crypto.randomUUID().slice(0, 16);
    }

    const sql = `
      INSERT INTO neem_automation_rules
        (id, name, trigger_kind, conditions, action_payload, priority, is_paused, version, description, schedule_window, schedule_cron)
      VALUES ($1, $2, $3, $4, $5, $6, false, $7, $8, $9, $10)
      ON CONFLICT (id) DO UPDATE
        SET name = EXCLUDED.name,
            trigger_kind = EXCLUDED.trigger_kind,
            conditions = EXCLUDED.conditions,
            action_payload = EXCLUDED.action_payload,
            priority = EXCLUDED.priority,
            version = EXCLUDED.version,
            description = EXCLUDED.description,
            schedule_window = EXCLUDED.schedule_window,
            schedule_cron = EXCLUDED.schedule_cron,
            updated_at = now()
      RETURNING *
    `;

    const res = await this.db.query(sql, [
      ruleId,
      name,
      triggerKind,
      JSON.stringify(conditions),
      JSON.stringify(actionPayload),
      priority,
      newVersion,
      description,
      JSON.stringify(scheduleWindow),
      scheduleCron
    ]);

    const savedRule = res.rows[0];

    // Archive rule version snapshot for immutable audit & rollback (GM-16)
    const versionId = 'rv_' + crypto.randomUUID().slice(0, 16);
    await this.db.query(
      `INSERT INTO neem_automation_rule_versions
         (id, rule_id, version, snapshot, created_by)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        versionId,
        ruleId,
        newVersion,
        JSON.stringify({
          name: savedRule.name,
          trigger_kind: savedRule.trigger_kind,
          conditions: savedRule.conditions,
          action_payload: savedRule.action_payload,
          priority: savedRule.priority,
          description: savedRule.description,
          schedule_window: savedRule.schedule_window,
          schedule_cron: savedRule.schedule_cron
        }),
        actorId
      ]
    );

    await auditService.recordEvent({
      actorId,
      action: 'AUTOMATION_RULE_SAVED',
      targetType: 'automation_rule',
      targetId: ruleId,
      metadata: { name, trigger_kind: triggerKind, priority, version: newVersion }
    });

    if (savedRule) {
      savedRule.rule_id = savedRule.id;
    }
    return savedRule;
  }

  async evaluateRule(ruleId, state = {}) {
    const rule = await this.getRuleById(ruleId);
    if (!rule) return { passed: false, reason: 'Rule not found' };
    if (rule.is_paused) return { passed: false, reason: 'Rule is paused' };
    const sim = await this.simulateRule({ ruleId, ...state });
    const passed = Boolean(sim.action_simulated || (sim.results && sim.results[0]?.effectiveDecision === 'TRIGGERED'));
    return { passed, reason: sim.reason || 'Evaluated' };
  }

  async listRules() {
    const sql = 'SELECT * FROM neem_automation_rules ORDER BY priority ASC, created_at DESC';
    const res = await this.db.query(sql);
    return res.rows.map(r => ({ ...r, rule_id: r.id }));
  }

  async getRuleById(ruleId) {
    const sql = 'SELECT * FROM neem_automation_rules WHERE id = $1';
    const res = await this.db.query(sql, [ruleId]);
    const r = res.rows[0] || null;
    if (r) r.rule_id = r.id;
    return r;
  }

  async getRuleVersions(ruleId) {
    const sql = 'SELECT * FROM neem_automation_rule_versions WHERE rule_id = $1 ORDER BY created_at DESC';
    const res = await this.db.query(sql, [ruleId]);
    return res.rows;
  }

  async pauseRuleVersion(ruleId, isPaused = true, actorId = 'platform_system') {
    const sql = 'UPDATE neem_automation_rules SET is_paused = $1, updated_at = now() WHERE id = $2 RETURNING *';
    const res = await this.db.query(sql, [isPaused, ruleId]);
    const updated = res.rows[0] || null;

    if (updated) {
      await auditService.recordEvent({
        actorId,
        action: isPaused ? 'AUTOMATION_RULE_PAUSED' : 'AUTOMATION_RULE_RESUMED',
        targetType: 'automation_rule',
        targetId: ruleId,
        metadata: { is_paused: isPaused, version: updated.version }
      });
    }

    return updated;
  }

  /**
   * Explainable Simulation (GM-16 Preview & Conflict Pre-check):
   * Re-evaluates rule conditions and explains what decision would be made,
   * checking precedence rules without modifying state.
   */
  async simulateRule({
    ruleId,
    tenantId,
    tenantStatus = 'active',
    trialExpired = false,
    hasActivePaidSubscription = false,
    hasPaidGrant = false,
    clock = new Date()
  } = {}) {
    const targetTenantId = tenantId || 'tnt_preview';

    let rule = null;
    if (ruleId) {
      rule = await this.getRuleById(ruleId);
      if (!rule) throw new Error(`RULE_ERROR: Rule '${ruleId}' not found.`);
    }

    const rules = rule ? [rule] : await this.listRules();
    const activeGrants = tenantId ? await grantService.listGrants(tenantId) : [];
    const hasAnyCommercialGrant = activeGrants.some(g => g.grantKind !== 'trial');

    const simulationResults = [];

    for (const r of rules) {
      const conditionChecks = [];
      let triggered = false;
      let conflictPrevented = null;

      if (r.is_paused) {
        simulationResults.push({
          ruleId: r.id,
          ruleName: r.name,
          version: r.version,
          triggerKind: r.trigger_kind,
          effectiveDecision: 'SKIPPED',
          reason: 'قانون متوقف است (Paused)',
          conditionChecks: [{ name: 'is_active', passed: false, details: 'Rule is currently paused' }],
          simulatedAction: null
        });
        continue;
      }

      if (r.trigger_kind === 'trial_expiry') {
        conditionChecks.push({
          name: 'trial_expired',
          passed: Boolean(trialExpired),
          details: `وضعیت انقضای دوره آزمایشی: ${trialExpired ? 'منقضی شده' : 'معتبر'}`
        });

        // Strict Conflict Precedence (AC-15 / AC-22):
        // Expired trial NEVER revokes active commercial/paid entitlements
        const holdsPaidCommercial = hasActivePaidSubscription || hasPaidGrant || hasAnyCommercialGrant;
        conditionChecks.push({
          name: 'no_active_paid_entitlement',
          passed: !holdsPaidCommercial,
          details: holdsPaidCommercial
            ? 'مستأجر دارای اشتراک یا لایسنس تجاری فعال است.'
            : 'هیچ اشتراک تجاری فعالی یافت نشد.'
        });

        if (trialExpired && holdsPaidCommercial) {
          triggered = false;
          conflictPrevented = 'CONFLICT_PREVENTED: Trial expiry suppressed because tenant holds active commercial paid entitlement (مهار تداخل تجاری؛ لغو سلب دسترسی).';
        } else if (trialExpired && !holdsPaidCommercial) {
          triggered = true;
        }
      } else if (r.trigger_kind === 'payment_overdue') {
        const isOverdue = tenantStatus === 'past_due' && !hasActivePaidSubscription;
        conditionChecks.push({
          name: 'subscription_overdue',
          passed: isOverdue,
          details: `وضعیت بدهی مالی: ${isOverdue ? 'معوقه پرداخت‌نشده' : 'تسویه‌شده'}`
        });
        triggered = isOverdue;
      } else if (r.trigger_kind === 'subscription_renewal') {
        conditionChecks.push({
          name: 'has_paid_subscription',
          passed: Boolean(hasActivePaidSubscription),
          details: `وضعیت اشتراک: ${hasActivePaidSubscription ? 'دارای اشتراک فعال' : 'فاقد اشتراک'}`
        });
        triggered = Boolean(hasActivePaidSubscription);
      } else if (r.trigger_kind === 'schedule_window') {
        const window = r.schedule_window || {};
        const currentHour = clock.getHours();
        const inWindow = (!window.start_hour || currentHour >= window.start_hour) &&
                         (!window.end_hour || currentHour < window.end_hour);
        conditionChecks.push({
          name: 'in_schedule_window',
          passed: inWindow,
          details: `بررسی ساعت کاری پلتفرم (${currentHour}:00)`
        });
        triggered = inWindow;
      } else {
        conditionChecks.push({
          name: 'custom_policy_condition',
          passed: true,
          details: 'شرط سفارشی خط‌مشی'
        });
        triggered = true;
      }

      simulationResults.push({
        ruleId: r.id,
        ruleName: r.name,
        version: r.version,
        triggerKind: r.trigger_kind,
        effectiveDecision: conflictPrevented ? 'CONFLICT_PREVENTED' : (triggered ? 'TRIGGERED' : 'SUPPRESSED'),
        conflictPrevented,
        conditionChecks,
        simulatedAction: triggered && !conflictPrevented ? r.action_payload : null
      });
    }

    const firstResult = simulationResults[0] || {};
    const primaryCond = firstResult.conditionChecks
      ? (firstResult.conditionChecks.find(c => c.name === 'trial_expired')?.passed ?? firstResult.conditionChecks.every(c => c.passed))
      : false;

    return {
      tenantId,
      clock: clock.toISOString(),
      simulatedRulesCount: rules.length,
      rule_id: firstResult.ruleId,
      rule_version: firstResult.version,
      condition_met: Boolean(primaryCond),
      conflict_prevented: Boolean(firstResult.conflictPrevented),
      conflict_reason: firstResult.conflictPrevented,
      action_simulated: Boolean(firstResult.simulatedAction),
      reason: firstResult.reason || firstResult.conflictPrevented,
      results: simulationResults
    };
  }

  /**
   * Backwards-compatible evaluateTenantRules method used by existing tests
   */
  async evaluateTenantRules({
    tenantId,
    tenantStatus = 'active',
    trialExpired = false,
    hasActivePaidSubscription = false,
    hasPaidGrant = false
  }) {
    const sim = await this.simulateRule({
      tenantId,
      tenantStatus,
      trialExpired,
      hasActivePaidSubscription,
      hasPaidGrant
    });

    return {
      tenantId,
      evaluatedRulesCount: sim.simulatedRulesCount,
      evaluationResults: sim.results.map(r => ({
        ruleId: r.ruleId,
        ruleName: r.ruleName,
        triggerKind: r.triggerKind,
        triggered: r.effectiveDecision === 'TRIGGERED',
        conflictResolved: r.conflictPrevented,
        actionPayload: r.simulatedAction || {}
      }))
    };
  }
}

module.exports = new AutomationRuleEngine();
