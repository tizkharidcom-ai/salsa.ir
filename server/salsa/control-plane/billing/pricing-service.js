// server/salsa/control-plane/billing/pricing-service.js
'use strict';

const crypto = require('crypto');
const catalogService = require('../policy/catalog-service');
const { getDatabase } = require('../db/database');
const auditService = require('../audit/audit-service');

const VAT_PERCENTAGE = 10;
const ANNUAL_DISCOUNT_PERCENT = 20;
const PLATFORM_PRICING_WRITERS = new Set(['platform_owner', 'platform_operations']);

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function requireSafeInteger(value, field, { min = 0 } = {}) {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < min) {
    throw fail('PRICING_VALIDATION_FAILED', `${field} must be a safe integer >= ${min}.`);
  }
  return normalized;
}

function parseJson(value, fallback) {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'string') {
    try { return JSON.parse(value); } catch { return fallback; }
  }
  return value;
}

function hash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function mapPlanRow(row) {
  if (!row) return null;
  const includedFeatures = parseJson(row.included_features ?? row.features, []);
  const quotas = parseJson(row.quotas, {});
  const price = Number(row.base_price_monthly_rials);
  const version = String(row.version);
  const isCustom = Boolean(row.is_custom);
  return {
    planCode: row.plan_code,
    version,
    isDraft: row.state === 'draft' || Boolean(row.is_draft),
    isCustom,
    customTenantId: row.custom_tenant_id || null,
    nameFa: row.name_fa,
    descriptionFa: row.description_fa || '',
    basePriceMonthlyRials: price,
    basePriceMonthlyToman: Math.round(price / 10),
    basePriceAnnualRials: Math.round(price * 12 * (1 - ANNUAL_DISCOUNT_PERCENT / 100)),
    basePriceAnnualToman: Math.round((price * 12 * (1 - ANNUAL_DISCOUNT_PERCENT / 100)) / 10),
    includedBranches: Number(row.included_branches),
    includedDevices: Number(row.included_devices),
    includedUsers: Number(row.included_users),
    includedFeatures,
    features: includedFeatures,
    quotas,
    publishedAt: row.published_at || null,
    effectiveFrom: row.effective_from || null,
    effectiveTo: row.effective_to || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
    monthlyPriceIrr: price,
    pricingSource: 'postgres_plan_version'
  };
}

class PricingService {
  constructor({ db = getDatabase(), now = () => new Date() } = {}) {
    this.db = db;
    this.now = now;
  }

  _nowIso() {
    const value = this.now();
    const date = value instanceof Date ? value : new Date(value);
    if (!Number.isFinite(date.getTime())) throw fail('PRICING_CLOCK_INVALID', 'Pricing clock returned an invalid date.');
    return date.toISOString();
  }

  _requireActor(actorId, actorRole) {
    if (typeof actorId !== 'string' || !actorId.trim() || !PLATFORM_PRICING_WRITERS.has(actorRole)) {
      throw fail('PLATFORM_ACTOR_REQUIRED', 'Pricing changes require an authenticated Platform Control Plane principal.');
    }
  }

  _validatePlanCode(planCode) {
    if (typeof planCode !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,31}$/i.test(planCode)) {
      throw fail('PRICING_VALIDATION_FAILED', 'planCode must be 1-32 safe characters.');
    }
    return planCode;
  }

  _normalizePlan(input, { custom = false } = {}) {
    const {
      planCode, tenantId, nameFa, descriptionFa = '', basePriceMonthlyRials,
      includedBranches = custom ? 3 : 1,
      includedDevices = custom ? 8 : 2,
      includedUsers = custom ? 20 : 5,
      includedFeatures = [], quotas = {}, version
    } = input;
    this._validatePlanCode(planCode);
    if (!custom && planCode.toLowerCase().startsWith('custom_')) {
      throw fail('PRICING_VALIDATION_FAILED', 'The custom_ namespace is reserved for tenant-scoped contracts.');
    }
    if (typeof nameFa !== 'string' || !nameFa.trim() || nameFa.length > 128) {
      throw fail('PRICING_VALIDATION_FAILED', 'nameFa is required and must not exceed 128 characters.');
    }
    if (typeof descriptionFa !== 'string' || descriptionFa.length > 4000) {
      throw fail('PRICING_VALIDATION_FAILED', 'descriptionFa must be a string no longer than 4000 characters.');
    }
    const price = requireSafeInteger(basePriceMonthlyRials, 'basePriceMonthlyRials');
    const branches = requireSafeInteger(includedBranches, 'includedBranches', { min: 1 });
    const devices = requireSafeInteger(includedDevices, 'includedDevices', { min: 1 });
    const users = requireSafeInteger(includedUsers, 'includedUsers', { min: 1 });
    if (!Array.isArray(includedFeatures) || includedFeatures.some(key => typeof key !== 'string' || !catalogService.getFeature(key))) {
      throw fail('PRICING_VALIDATION_FAILED', 'includedFeatures must contain only canonical feature keys.');
    }
    const cleanFeatures = [...new Set(includedFeatures)];
    if (!quotas || typeof quotas !== 'object' || Array.isArray(quotas)) {
      throw fail('PRICING_VALIDATION_FAILED', 'quotas must be an object.');
    }
    const cleanQuotas = {
      maxBranches: branches,
      maxDevices: devices,
      maxUsers: users,
      maxOrders: custom ? -1 : -1,
      maxStorageMb: custom ? 20000 : 5000,
      maxSms: custom ? 5000 : 1000
    };
    for (const [key, value] of Object.entries(quotas)) {
      if (!/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(key)) {
        throw fail('PRICING_VALIDATION_FAILED', `Unsupported quota key: ${key}.`);
      }
      cleanQuotas[key] = requireSafeInteger(value, `quotas.${key}`, { min: -1 });
    }
    const normalizedVersion = version || (custom ? '1.0.0' : '1.1.0');
    if (typeof normalizedVersion !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._+-]{0,31}$/.test(normalizedVersion)) {
      throw fail('PRICING_VALIDATION_FAILED', 'version must be a 1-32 character version identifier.');
    }
    if (custom && (typeof tenantId !== 'string' || !tenantId.trim() || tenantId.length > 64)) {
      throw fail('PRICING_VALIDATION_FAILED', 'Custom pricing requires a valid tenantId.');
    }
    return {
      planCode, version: normalizedVersion, tenantId: custom ? tenantId : null,
      nameFa: nameFa.trim(), descriptionFa,
      basePriceMonthlyRials: price,
      includedBranches: branches, includedDevices: devices, includedUsers: users,
      includedFeatures: cleanFeatures, quotas: cleanQuotas
    };
  }

  async _query(sql, params = []) {
    if (!this.db || typeof this.db.query !== 'function') {
      throw fail('BILLING_DATABASE_UNAVAILABLE', 'Authoritative pricing database is unavailable.');
    }
    try {
      return await this.db.query(sql, params);
    } catch (error) {
      if (!error.code || String(error.code).startsWith('08') || ['42P01', '42703', '3F000'].includes(error.code)) {
        error.causeCode = error.code || null;
        error.code = 'BILLING_DATABASE_UNAVAILABLE';
      }
      throw error;
    }
  }

  async _transaction(lockScope, callback) {
    if (!this.db || typeof this.db.connect !== 'function') {
      throw fail('BILLING_DATABASE_UNAVAILABLE', 'Persistent pricing requires a PostgreSQL transaction client.');
    }
    let client;
    try {
      client = await this.db.connect();
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`billing-plan:${lockScope}`]);
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      if (client) await client.query('ROLLBACK').catch(() => {});
      if (!error.code || String(error.code).startsWith('08') || ['42P01', '42703', '3F000'].includes(error.code)) {
        error.causeCode = error.code || null;
        error.code = 'BILLING_DATABASE_UNAVAILABLE';
      }
      throw error;
    } finally {
      client?.release?.();
    }
  }

  _idempotencyContext({ actorId, actorRole, operation, idempotencyKey, payload }) {
    if (idempotencyKey === undefined || idempotencyKey === null || idempotencyKey === '') return null;
    if (typeof idempotencyKey !== 'string' || idempotencyKey.length > 128 || idempotencyKey.length < 8) {
      throw fail('IDEMPOTENCY_KEY_INVALID', 'idempotencyKey must contain 8-128 characters.');
    }
    const operationKey = crypto.createHash('sha256').update(`${actorId}\0${idempotencyKey}`).digest('hex');
    return {
      operationKey,
      operation,
      requestHash: hash({ actorId, actorRole, operation, payload })
    };
  }

  async _readReplay(client, context) {
    if (!context) return null;
    const result = await client.query(
      `SELECT operation_type, request_hash, result
         FROM neem_billing_plan_operations
        WHERE operation_key = $1
        FOR UPDATE`,
      [context.operationKey]
    );
    const row = result.rows?.[0];
    if (!row) return null;
    if (row.operation_type !== context.operation || row.request_hash !== context.requestHash) {
      throw fail('IDEMPOTENCY_KEY_REUSED', 'idempotencyKey was already used for a different pricing request.');
    }
    const saved = parseJson(row.result, null);
    if (!saved || typeof saved !== 'object') throw fail('BILLING_IDEMPOTENCY_RECORD_INVALID', 'Stored pricing replay result is invalid.');
    return { ...saved, idempotentReplay: true };
  }

  async _saveReplay(client, context, actorId, result) {
    if (!context) return;
    await client.query(
      `INSERT INTO neem_billing_plan_operations
        (operation_key, operation_type, request_hash, actor_id, result)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [context.operationKey, context.operation, context.requestHash, actorId, JSON.stringify(result)]
    );
  }

  async _audit(client, { actorId, actorRole, action, planCode, tenantId = null, metadata }) {
    return auditService.recordEvent({
      actorId, actorRole, action, targetType: 'billing_plan', targetId: planCode,
      tenantId, metadata, database: client
    });
  }

  async listPlans({ includeDrafts = false, includeCustom = false, tenantId } = {}) {
    if (includeCustom && (typeof tenantId !== 'string' || !tenantId.trim())) {
      throw fail('TENANT_SCOPE_REQUIRED', 'Listing custom plans requires the exact tenantId scope.');
    }
    const now = this._nowIso();
    const result = await this._query(
      `SELECT plan_code, version, state, is_custom, custom_tenant_id, name_fa,
              description_fa, base_price_monthly_rials, included_branches,
              included_devices, included_users, included_features, quotas,
              published_at, effective_from, effective_to, created_at, updated_at
         FROM neem_billing_plan_versions
        WHERE ((state = 'published' AND effective_from <= $4::timestamptz
                  AND (effective_to IS NULL OR effective_to > $4::timestamptz))
               OR ($1::boolean AND state = 'draft'))
          AND (NOT is_custom OR ($2::boolean AND custom_tenant_id = $3))
        ORDER BY is_custom, plan_code, version`,
      [Boolean(includeDrafts), Boolean(includeCustom), tenantId || null, now]
    );
    return (result.rows || []).map(mapPlanRow);
  }

  async getPlan(planCode, { tenantId, version, includeDrafts = false } = {}) {
    this._validatePlanCode(planCode);
    const now = this._nowIso();
    const params = [planCode, tenantId || null, version || null, Boolean(includeDrafts), now];
    const result = await this._query(
      `SELECT plan_code, version, state, is_custom, custom_tenant_id, name_fa,
              description_fa, base_price_monthly_rials, included_branches,
              included_devices, included_users, included_features, quotas,
              published_at, effective_from, effective_to, created_at, updated_at
         FROM neem_billing_plan_versions
        WHERE plan_code = $1
          AND (NOT is_custom OR custom_tenant_id = $2)
          AND ($3::text IS NULL OR version = $3)
          AND (($3::text IS NOT NULL AND (state = 'published' OR ($4::boolean AND state = 'draft')))
               OR ($3::text IS NULL AND ((state = 'published' AND effective_from <= $5::timestamptz
                    AND (effective_to IS NULL OR effective_to > $5::timestamptz))
                  OR ($4::boolean AND state = 'draft'))))
        ORDER BY (state = 'draft') DESC, effective_from DESC, created_at DESC
        LIMIT 1`,
      params
    );
    return mapPlanRow(result.rows?.[0]);
  }

  async getPlanVersions(planCode, { tenantId } = {}) {
    this._validatePlanCode(planCode);
    const result = await this._query(
      `SELECT plan_code, version, state, is_custom, custom_tenant_id, name_fa,
              description_fa, base_price_monthly_rials, included_branches,
              included_devices, included_users, included_features, quotas,
              published_at, effective_from, effective_to, created_at, updated_at
         FROM neem_billing_plan_versions
        WHERE plan_code = $1 AND (NOT is_custom OR custom_tenant_id = $2)
        ORDER BY created_at DESC, version DESC`,
      [planCode, tenantId || null]
    );
    return (result.rows || []).map(mapPlanRow);
  }

  async getPlanMatrix() {
    const plans = await this.listPlans();
    const allFeatures = catalogService.getFeatures();
    return {
      plans,
      featureComparison: allFeatures.map(feature => ({
        key: feature.key,
        nameFa: feature.nameFa,
        category: feature.category,
        plans: Object.fromEntries(plans.map(plan => [plan.planCode, plan.includedFeatures.includes(feature.key)]))
      })),
      vatPercentage: VAT_PERCENTAGE,
      annualDiscountPercent: ANNUAL_DISCOUNT_PERCENT
    };
  }

  async createDraftPlan(input) {
    const { actorId, actorRole = 'platform_owner', idempotencyKey } = input;
    this._requireActor(actorId, actorRole);
    const plan = this._normalizePlan(input);
    const replayContext = this._idempotencyContext({
      actorId, actorRole, operation: 'create_draft', idempotencyKey,
      payload: plan
    });
    return this._transaction(plan.planCode, async client => {
      const replay = await this._readReplay(client, replayContext);
      if (replay) return replay;
      await client.query(
        `INSERT INTO neem_billing_plans
          (plan_code, name_fa, base_price_monthly_rials, included_branches, included_devices,
           features, is_active, description_fa, included_users, quotas, version, is_draft, is_custom)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, false, $7, $8, $9::jsonb, $10, true, false)
         ON CONFLICT (plan_code) DO NOTHING`,
        [plan.planCode, plan.nameFa, plan.basePriceMonthlyRials, plan.includedBranches,
          plan.includedDevices, JSON.stringify(plan.includedFeatures), plan.descriptionFa,
          plan.includedUsers, JSON.stringify(plan.quotas), plan.version]
      );
      const stored = await client.query(
        `INSERT INTO neem_billing_plan_versions
          (plan_code, version, state, is_custom, custom_tenant_id, name_fa, description_fa,
           base_price_monthly_rials, included_branches, included_devices, included_users,
           included_features, quotas, created_by, updated_by)
         VALUES ($1, $2, 'draft', false, NULL, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11, $11)
         ON CONFLICT (plan_code, version) DO UPDATE SET
           name_fa = EXCLUDED.name_fa, description_fa = EXCLUDED.description_fa,
           base_price_monthly_rials = EXCLUDED.base_price_monthly_rials,
           included_branches = EXCLUDED.included_branches,
           included_devices = EXCLUDED.included_devices,
           included_users = EXCLUDED.included_users,
           included_features = EXCLUDED.included_features, quotas = EXCLUDED.quotas,
           updated_by = EXCLUDED.updated_by, updated_at = now()
         WHERE neem_billing_plan_versions.state = 'draft'
           AND neem_billing_plan_versions.is_custom = false
         RETURNING plan_code, version, state, is_custom, custom_tenant_id, name_fa,
                   description_fa, base_price_monthly_rials, included_branches,
                   included_devices, included_users, included_features, quotas,
                   published_at, effective_from, effective_to, created_at, updated_at`,
        [plan.planCode, plan.version, plan.nameFa, plan.descriptionFa,
          plan.basePriceMonthlyRials, plan.includedBranches, plan.includedDevices,
          plan.includedUsers, JSON.stringify(plan.includedFeatures),
          JSON.stringify(plan.quotas), actorId]
      );
      if (!stored.rows?.[0]) throw fail('PLAN_VERSION_CONFLICT', 'That plan version already exists as a published or custom version.');
      const result = mapPlanRow(stored.rows[0]);
      await this._audit(client, {
        actorId, actorRole, action: 'BILLING_PLAN_DRAFT_SAVED', planCode: plan.planCode,
        metadata: { version: plan.version, state: 'draft', pricingSource: 'postgres_plan_version', plan }
      });
      await this._saveReplay(client, replayContext, actorId, result);
      return result;
    });
  }

  async publishPlan(planCode, { effectiveFrom, actorId, actorRole = 'platform_owner', idempotencyKey } = {}) {
    this._requireActor(actorId, actorRole);
    this._validatePlanCode(planCode);
    const now = this._nowIso();
    const requestedEffectiveFrom = effectiveFrom === undefined ? null : effectiveFrom;
    const parsedEffective = effectiveFrom === undefined ? new Date(now) : new Date(effectiveFrom);
    if (!Number.isFinite(parsedEffective.getTime())) {
      throw fail('PRICING_EFFECTIVE_DATE_INVALID', 'effectiveFrom must be a valid timestamp.');
    }
    const effectiveTime = parsedEffective.toISOString();
    if (Date.parse(effectiveTime) < Date.parse(now)) {
      throw fail('PRICING_EFFECTIVE_DATE_INVALID', 'effectiveFrom must be now or a future timestamp; historical repricing is prohibited.');
    }
    const replayContext = this._idempotencyContext({
      actorId, actorRole, operation: 'publish_plan', idempotencyKey,
      payload: { planCode, effectiveFrom: requestedEffectiveFrom }
    });
    return this._transaction(planCode, async client => {
      const replay = await this._readReplay(client, replayContext);
      if (replay) return replay;
      const draftResult = await client.query(
        `SELECT plan_code, version, state, is_custom, custom_tenant_id, name_fa,
                description_fa, base_price_monthly_rials, included_branches,
                included_devices, included_users, included_features, quotas,
                published_at, effective_from, effective_to, created_at, updated_at
           FROM neem_billing_plan_versions
          WHERE plan_code = $1 AND state = 'draft' AND is_custom = false
          ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
        [planCode]
      );
      const draft = draftResult.rows?.[0];
      if (!draft) throw fail('PLAN_DRAFT_NOT_FOUND', `No unpublished draft exists for plan '${planCode}'.`);
      const later = await client.query(
        `SELECT version, effective_from FROM neem_billing_plan_versions
          WHERE plan_code = $1 AND state = 'published' AND effective_from >= $2::timestamptz
          ORDER BY effective_from LIMIT 1 FOR UPDATE`,
        [planCode, effectiveTime]
      );
      if (later.rows?.length) throw fail('PRICING_EFFECTIVE_INTERVAL_CONFLICT', 'A published version already begins at or after this effective date.');
      const impacted = await client.query(
        `SELECT COUNT(*)::int AS count FROM neem_billing_subscriptions
          WHERE plan_code = $1 AND status IN ('trial', 'active', 'past_due', 'grace_period')`,
        [planCode]
      );
      const impactedTenantsCount = Number(impacted.rows?.[0]?.count || 0);
      await client.query(
        `UPDATE neem_billing_plan_versions SET effective_to = $2::timestamptz, updated_at = now()
          WHERE plan_code = $1 AND state = 'published' AND effective_from < $2::timestamptz
            AND (effective_to IS NULL OR effective_to > $2::timestamptz)`,
        [planCode, effectiveTime]
      );
      const publishedResult = await client.query(
        `UPDATE neem_billing_plan_versions SET state = 'published', published_at = $3::timestamptz,
                effective_from = $2::timestamptz, effective_to = NULL, updated_by = $4, updated_at = now()
          WHERE plan_code = $1 AND version = $5 AND state = 'draft'
          RETURNING plan_code, version, state, is_custom, custom_tenant_id, name_fa,
                    description_fa, base_price_monthly_rials, included_branches,
                    included_devices, included_users, included_features, quotas,
                    published_at, effective_from, effective_to, created_at, updated_at`,
        [planCode, effectiveTime, this._nowIso(), actorId, draft.version]
      );
      if (!publishedResult.rows?.[0]) throw fail('PLAN_VERSION_CONFLICT', 'Draft changed while publishing; retry from the current version.');
      const plan = mapPlanRow(publishedResult.rows[0]);
      await client.query(
        `UPDATE neem_billing_plans SET name_fa = $2, base_price_monthly_rials = $3,
                included_branches = $4, included_devices = $5, features = $6::jsonb,
                description_fa = $7, included_users = $8, quotas = $9::jsonb,
                version = $10, is_draft = false, is_custom = false, is_active = true,
                published_at = $11::timestamptz, effective_from = $12::timestamptz
          WHERE plan_code = $1`,
        [planCode, plan.nameFa, plan.basePriceMonthlyRials, plan.includedBranches,
          plan.includedDevices, JSON.stringify(plan.includedFeatures), plan.descriptionFa,
          plan.includedUsers, JSON.stringify(plan.quotas), plan.version,
          plan.publishedAt, plan.effectiveFrom]
      );
      const result = { plan, newVersion: plan.version, effectiveFrom: plan.effectiveFrom, impactedTenantsCount };
      await this._audit(client, {
        actorId, actorRole, action: 'BILLING_PLAN_PUBLISHED', planCode,
        metadata: { version: plan.version, effectiveFrom: plan.effectiveFrom, impactedTenantsCount, pricingSource: plan.pricingSource, plan }
      });
      await this._saveReplay(client, replayContext, actorId, result);
      return result;
    });
  }

  async createCustomPlan(input) {
    const { tenantId, actorId, actorRole = 'platform_owner', idempotencyKey } = input;
    this._requireActor(actorId, actorRole);
    if (typeof tenantId !== 'string' || !tenantId.trim() || tenantId.length > 64) {
      throw fail('CUSTOM_PLAN_ERROR', 'A valid tenantId is required for custom pricing.');
    }
    const planCode = `custom_${crypto.createHash('sha256').update(tenantId).digest('hex').slice(0, 24)}`;
    const versionWasProvided = input.version !== undefined;
    const plan = this._normalizePlan({ ...input, planCode }, { custom: true });
    const replayContext = this._idempotencyContext({
      actorId, actorRole, operation: 'create_custom_plan', idempotencyKey,
      payload: { ...plan, version: versionWasProvided ? plan.version : null }
    });
    return this._transaction(planCode, async client => {
      const replay = await this._readReplay(client, replayContext);
      if (replay) return replay;
      const existing = await client.query(
        `SELECT version FROM neem_billing_plan_versions WHERE plan_code = $1 AND is_custom = true
          AND custom_tenant_id = $2 ORDER BY created_at DESC FOR UPDATE`,
        [planCode, tenantId]
      );
      let customVersion = plan.version;
      if (!versionWasProvided) {
        const versions = (existing.rows || []).map(row => String(row.version).match(/^(\d+)\.(\d+)\.(\d+)$/)).filter(Boolean)
          .map(match => match.slice(1).map(Number)).sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
        const latest = versions.at(-1);
        customVersion = latest ? `${latest[0]}.${latest[1] + 1}.0` : `1.${existing.rows?.length || 0}.0`;
      }
      if ((existing.rows || []).some(row => row.version === customVersion)) {
        throw fail('PLAN_VERSION_CONFLICT', 'Custom plan version already exists; provide a new version identifier.');
      }
      const effectiveFrom = this._nowIso();
      await client.query(
        `UPDATE neem_billing_plan_versions SET effective_to = $3::timestamptz, updated_at = now()
          WHERE plan_code = $1 AND custom_tenant_id = $2 AND is_custom = true
            AND state = 'published' AND effective_from < $3::timestamptz
            AND (effective_to IS NULL OR effective_to > $3::timestamptz)`,
        [planCode, tenantId, effectiveFrom]
      );
      const saved = await client.query(
        `INSERT INTO neem_billing_plans
          (plan_code, name_fa, base_price_monthly_rials, included_branches, included_devices,
           features, is_active, description_fa, included_users, quotas, version, is_draft, is_custom, custom_tenant_id)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, true, $7, $8, $9::jsonb, $10, false, true, $11)
         ON CONFLICT (plan_code) DO UPDATE SET name_fa = EXCLUDED.name_fa,
           base_price_monthly_rials = EXCLUDED.base_price_monthly_rials,
           included_branches = EXCLUDED.included_branches, included_devices = EXCLUDED.included_devices,
           features = EXCLUDED.features, description_fa = EXCLUDED.description_fa,
           included_users = EXCLUDED.included_users, quotas = EXCLUDED.quotas, version = EXCLUDED.version,
           is_active = true, is_draft = false, is_custom = true, custom_tenant_id = EXCLUDED.custom_tenant_id
         WHERE neem_billing_plans.is_custom = true AND neem_billing_plans.custom_tenant_id = EXCLUDED.custom_tenant_id
         RETURNING plan_code`,
        [planCode, plan.nameFa, plan.basePriceMonthlyRials, plan.includedBranches,
          plan.includedDevices, JSON.stringify(plan.includedFeatures), plan.descriptionFa,
          plan.includedUsers, JSON.stringify(plan.quotas), customVersion, tenantId]
      );
      if (!saved.rows?.[0]) throw fail('CUSTOM_PLAN_CONFLICT', 'Opaque custom plan code conflicts with an unrelated standard plan.');
      const inserted = await client.query(
        `INSERT INTO neem_billing_plan_versions
          (plan_code, version, state, is_custom, custom_tenant_id, name_fa, description_fa,
           base_price_monthly_rials, included_branches, included_devices, included_users,
           included_features, quotas, published_at, effective_from, created_by, updated_by)
         VALUES ($1, $2, 'published', true, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb,
                 $12::timestamptz, $12::timestamptz, $13, $13)
         RETURNING plan_code, version, state, is_custom, custom_tenant_id, name_fa,
                   description_fa, base_price_monthly_rials, included_branches,
                   included_devices, included_users, included_features, quotas,
                   published_at, effective_from, effective_to, created_at, updated_at`,
        [planCode, customVersion, tenantId, plan.nameFa, plan.descriptionFa,
          plan.basePriceMonthlyRials, plan.includedBranches, plan.includedDevices,
          plan.includedUsers, JSON.stringify(plan.includedFeatures), JSON.stringify(plan.quotas),
          effectiveFrom, actorId]
      );
      const result = mapPlanRow(inserted.rows?.[0]);
      await this._audit(client, {
        actorId, actorRole, action: 'BILLING_CUSTOM_PLAN_CREATED', planCode, tenantId,
        metadata: { version: customVersion, effectiveFrom, pricingSource: result.pricingSource, plan: result }
      });
      await this._saveReplay(client, replayContext, actorId, result);
      return result;
    });
  }

  async calculateQuote({
    planCode = 'starter', tenantId, addonKeys = [], billingCycle = 'monthly',
    extraBranches = 0, extraDevices = 0, planVersion
  } = {}) {
    if (!['monthly', 'annual'].includes(billingCycle)) {
      throw fail('PRICING_VALIDATION_FAILED', `Billing cycle '${billingCycle}' is not supported.`);
    }
    if (!Array.isArray(addonKeys)) throw fail('PRICING_VALIDATION_FAILED', 'addonKeys must be an array.');
    if (Number(extraBranches) !== 0 || Number(extraDevices) !== 0) {
      throw fail('PRICING_UNSUPPORTED_QUANTITY', 'Extra branch/device pricing is not configured; refusing to issue an underpriced quote.');
    }
    const plan = await this.getPlan(planCode, { tenantId });
    if (!plan || plan.isDraft) throw fail('PRICING_PLAN_UNAVAILABLE', `No effective published price exists for plan '${planCode}'.`);
    if (planVersion && planVersion !== plan.version) {
      throw fail('PRICING_VERSION_STALE', 'The requested plan version is no longer effective; refresh the quote before checkout.');
    }
    if (!Array.isArray(plan.includedFeatures) || plan.includedFeatures.some(key => typeof key !== 'string')) {
      throw fail('PRICING_PLAN_DATA_INVALID', `Published plan '${planCode}' has an invalid included-feature list.`);
    }
    const months = billingCycle === 'annual' ? 12 : 1;
    const monthlyPrice = requireSafeInteger(plan.basePriceMonthlyRials, `plans.${planCode}.basePriceMonthlyRials`);
    const basePlanTotal = monthlyPrice * months;
    if (!Number.isSafeInteger(basePlanTotal)) throw fail('PRICING_OVERFLOW', 'Base plan amount exceeds the safe integer range.');
    const lineItems = [{
      description: `${plan.nameFa} (${billingCycle === 'annual' ? 'سالانه' : 'ماهانـه'})`,
      planCode, planVersion: plan.version, unitPriceRials: monthlyPrice, quantity: months, totalRials: basePlanTotal
    }];
    const requestedAddonKeys = [...new Set(addonKeys)];
    const addonPricingSources = new Set();
    for (const key of requestedAddonKeys) {
      const feature = catalogService.getFeature(key);
      if (!feature) throw fail('PRICING_VALIDATION_FAILED', `Addon feature '${key}' does not exist.`);

      const includedInPlanVersion = plan.includedFeatures.includes(key);
      const includedByCanonicalModule = feature.commercialState === 'included';
      if (!includedInPlanVersion && !includedByCanonicalModule) {
        throw fail(
          'PRICING_ADDON_TARIFF_UNAVAILABLE',
          `No approved, effective versioned add-on tariff exists for '${key}'. Static feature and module catalog prices are not billable sources.`
        );
      }

      const inclusionSource = includedInPlanVersion ? 'postgres_plan_version' : 'canonical_module_manifest';
      addonPricingSources.add(inclusionSource);
      lineItems.push({
        description: `شامل بدون هزینهٔ افزوده: ${feature.nameFa}`,
        featureKey: key, planCode, planVersion: plan.version,
        unitPriceRials: 0, quantity: months, totalRials: 0,
        pricingSource: inclusionSource,
        pricingMeaning: 'included_no_additional_charge'
      });
    }
    const subtotal = basePlanTotal;
    if (!Number.isSafeInteger(subtotal)) throw fail('PRICING_OVERFLOW', 'Subtotal exceeds the safe integer range.');
    const discountAmount = billingCycle === 'annual' ? Math.round(subtotal * ANNUAL_DISCOUNT_PERCENT / 100) : 0;
    const taxableAmount = subtotal - discountAmount;
    const vatAmount = Math.round(taxableAmount * VAT_PERCENTAGE / 100);
    const finalTotal = taxableAmount + vatAmount;
    if (![discountAmount, taxableAmount, vatAmount, finalTotal].every(Number.isSafeInteger)) {
      throw fail('PRICING_OVERFLOW', 'Quoted total exceeds the safe integer range.');
    }
    return {
      planCode, planVersion: plan.version, planEffectiveFrom: plan.effectiveFrom,
      pricingSource: plan.pricingSource,
      addonPricingSource: requestedAddonKeys.length === 0
        ? 'not_requested'
        : addonPricingSources.size === 1 ? [...addonPricingSources][0] : 'included_entitlement_sources',
      billingCycle, months, lineItems, subtotalRials: subtotal,
      discountAmountRials: discountAmount, taxableAmountRials: taxableAmount,
      vatAmountRials: vatAmount, finalTotalRials: finalTotal,
      currency: 'IRR', finalTotalToman: Math.round(finalTotal / 10)
    };
  }
}

const pricingService = new PricingService();
module.exports = pricingService;
module.exports.PricingService = PricingService;
module.exports.mapPlanRow = mapPlanRow;
