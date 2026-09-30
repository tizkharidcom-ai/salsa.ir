// server/salsa/control-plane/policy/evaluator-service.js
'use strict';

const grantService = require('./grant-service');
const overrideService = require('./override-service');
const catalogService = require('./catalog-service');
const { ROLE_CAPABILITIES } = require('../../../command-center');

const PLATFORM_PRINCIPAL_ROLES = new Set([
  'platform_admin',
  'platform_owner',
  'platform_superadmin',
  'platform_super_admin',
  'super_admin',
  'superadmin',
]);

function isPlatformPrincipal(identity) {
  if (!identity) return false;
  const role = String(identity.role || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  const principalType = String(identity.principalType || '').trim().toLowerCase();
  const identityType = String(identity.identityType || '').trim().toLowerCase();
  const scope = String(identity.scope || '').trim().toLowerCase();
  return identity.isPlatformPrincipal === true
    || identity.kind === 'platform'
    || principalType === 'platform'
    || identityType === 'platform'
    || scope === 'platform'
    || PLATFORM_PRINCIPAL_ROLES.has(role);
}

// The live WESTO server and the Control Plane must evaluate the same role
// contract. The former duplicated this table with different permission keys
// (for example `pii.view` vs the server's manager grant), which made a valid
// operator fail the TPEL check even though the route middleware allowed them.
const ROLE_LABELS = Object.freeze({
  owner: 'مالک رستوران',
  manager: 'مدیر شعبه',
  accountant: 'حسابدار',
  cashier: 'صندوق‌دار',
  kitchen: 'پرسنل آشپزخانه',
  waiter: 'گارسون سالن',
  guest: 'مهمان',
});

const ROLE_PERMISSIONS = Object.freeze(
  Object.fromEntries(
    Object.entries(ROLE_CAPABILITIES).map(([role, permissions]) => [role, {
      nameFa: ROLE_LABELS[role] || role,
      scope: role === 'owner' ? 'tenant' : role === 'guest' ? 'own_records' : 'branch',
      permissions,
    }]),
  ),
);

class PolicyEvaluatorService {
  /**
   * Evaluates access decision using the canonical 5-clause formula:
   * Decision = IdentityActive AND TenantActive AND FeatureEntitled AND (RoleAllow OR PersonalAllow) AND NOT(PersonalDeny)
   */
  async evaluateAccess({
    identity,
    tenant,
    permissionKey,
    featureKey = null
  }) {
    const startTime = process.hrtime.bigint();

    // 1. Identity Check
    const isPlatformIdentity = isPlatformPrincipal(identity);
    const isIdentityActive = !!identity && identity.status === 'active' && !isPlatformIdentity;
    const step1 = {
      step: 'احراز هویت و حساب فعال کاربر (IdentityActive)',
      passed: isIdentityActive,
      detail: isPlatformIdentity
        ? 'حساب Platform SuperAdmin از هویت مالک یا کاربر رستوران جداست و در این مسیر پذیرفته نمی‌شود'
        : identity ? `${identity.name || identity.email} (${identity.role}) [${identity.status}]` : 'کاربر نامعتبر یا یافت نشد'
    };

    // 2. Tenant Status Check
    const isTenantActive = !!tenant && (tenant.status === 'active' || tenant.status === 'provisioning');
    const step2 = {
      step: 'وضعیت فعال مستأجر (TenantActive)',
      passed: isTenantActive,
      detail: tenant ? `${tenant.displayName || tenant.id} [${tenant.status}]` : 'مستأجر نامعتبر یا تعلیق‌شده'
    };

    // 3. Feature Entitlement Check
    let isFeatureEntitled = true;
    let featDetail = 'قابلیت پایه و پیش‌فرض پلتفرم';
    if (featureKey) {
      const feature = catalogService.getFeature(featureKey);
      if (!tenant || !feature) {
        isFeatureEntitled = false;
      } else {
        const grants = await grantService.listGrants(tenant.id);
        const matchingGrant = grants.find(g => g.featureKey === featureKey && g.isActive === true);
        const isBaseFree = feature.priceMonthly === 0;
        isFeatureEntitled = !!matchingGrant || isBaseFree;
      }
      featDetail = isFeatureEntitled
        ? `ماژول '${featureKey}' دارای لایسنس فعال است`
        : `ماژول '${featureKey}' ناشناخته است یا entitlement فعال و قابل‌تأیید ندارد`;
    }
    const step3 = {
      step: 'اشتراک تجاری و لایسنس قابلیت (FeatureEntitled)',
      passed: isFeatureEntitled,
      detail: featDetail
    };

    // 4. Role Allow & Personal Allow Check
    const roleDef = identity && !isPlatformIdentity ? ROLE_PERMISSIONS[identity.role] : null;
    const isRoleAllowed = !!(roleDef && (roleDef.permissions.includes('*') || roleDef.permissions.includes(permissionKey)))
      || (!isPlatformIdentity && identity?.role === 'owner');

    // Check personal override
    let personalOverride = { state: 'inherit', decisionReason: 'ارث‌بری پیش‌فرض از نقش' };
    if (tenant && identity && !isPlatformIdentity) {
      const overrides = await overrideService.listOverrides(tenant.id, identity.id);
      const found = overrides.find(o => o.permissionKey === permissionKey);
      if (found) personalOverride = found;
    }

    const isExplicitAllow = personalOverride.state === 'allow';
    const isExplicitDeny = personalOverride.state === 'deny';
    const step4 = {
      step: 'اختیارات نقش سازمانی (RoleAllow) یا اجازه صریح (PersonalAllow)',
      passed: isRoleAllowed || isExplicitAllow,
      detail: isExplicitAllow
        ? `اجازه صریح شخصی اعطا شده: "${personalOverride.decisionReason}"`
        : (isRoleAllowed ? `مجاز در نقش سازمانی [${roleDef?.nameFa || identity?.role}]` : `نقش فاقد این مجوز است`)
    };

    // 5. Explicit Deny Check (NOT PersonalDeny)
    const step5 = {
      step: 'عدم وجود حکم منع شخصی (NOT PersonalDeny)',
      passed: !isExplicitDeny,
      detail: isExplicitDeny
        ? `حکم منع شخصی فعال است: "${personalOverride.decisionReason}"`
        : 'هیچ منع شخصی فعالی ثبت نشده است'
    };

    const steps = [step1, step2, step3, step4, step5];
    const allPassed = steps.every(s => s.passed);

    const endTime = process.hrtime.bigint();
    const latencyMs = Number(endTime - startTime) / 1e6;

    let decision = allPassed ? 'ALLOW' : 'DENY';
    let reason = '';
    let isOwnerOverridden = false;

    if (isExplicitDeny) {
      decision = 'DENY';
      reason = `منع صریح شخصی (Explicit Deny) بر اختیارات نقش سازمانی غالب شد: "${personalOverride.decisionReason}"`;
      if (identity?.role === 'owner') {
        isOwnerOverridden = true;
      }
    } else if (!isIdentityActive) {
      reason = isPlatformIdentity
        ? 'هویت Platform SuperAdmin متعلق به دامنهٔ دسترسی رستوران نیست.'
        : 'احراز هویت انجام نشد یا حساب کاربر در حالت تعلیق است.';
    } else if (!isTenantActive) {
      reason = 'سازمان یا رستوران در حالت فعال قرار ندارد.';
    } else if (!isFeatureEntitled) {
      reason = `حق استفاده از قابلیت '${featureKey}' در اشتراک این مجموعه خریداری یا فعال نشده است.`;
    } else if (!isRoleAllowed && !isExplicitAllow) {
      reason = `نقش سازمانی [${roleDef?.nameFa || identity?.role}] فاقد مجوز '${permissionKey}' است و اجازه شخصی صادر نشده است.`;
    } else {
      reason = 'تمام شروط پنج‌گانه سیاست امنیتی با موفقیت احراز شدند.';
    }

    return {
      decision,
      effectiveResult: decision === 'ALLOW' ? 'مجاز' : 'مسدود قطعی (DENIED)',
      reason,
      isOwnerOverridden,
      impactOnOwner: isOwnerOverridden
        ? 'اخطار امنیتی: این حکم منع شخصی مستقیماً اختیارات مالک رستوران را نیز مسدود کرده است.'
        : null,
      overrideState: personalOverride.state,
      decisionReason: personalOverride.decisionReason,
      latencyMs: Number(latencyMs.toFixed(3)),
      steps
    };
  }
}

module.exports = new PolicyEvaluatorService();
