/**
 * prototype/js/godmode/app/permissions.js
 *
 * Strict Role and Permission Guard for SALSA God Mode (superadmin.md §11).
 * Strictly separates Platform Realm roles from Tenant Realm roles.
 */

(function (global) {
  'use strict';

  // 1. Platform Roles Catalog (Canonical Superadmin Vocabulary §11)
  const PLATFORM_ROLES = Object.freeze({
    PlatformOwner: {
      key: 'platform_owner',
      canonical: 'PlatformOwner',
      aliases: ['platform_owner', 'PlatformOwner', 'owner'],
      labelFa: 'مالک ارشد پلتفرم',
      descriptionFa: 'اختیار تام بر تمام منابع، عملیات مخرب و پیکربندی کلان پلتفرم',
      level: 100
    },
    PlatformAdmin: {
      key: 'platform_admin',
      canonical: 'PlatformAdmin',
      aliases: ['platform_admin', 'PlatformAdmin', 'admin'],
      labelFa: 'راهبر ارشد پلتفرم',
      descriptionFa: 'مدیریت کاربران، مجموعه‌ها و پیکربندی بدون امکان تخریب ساختاری کلان',
      level: 90
    },
    OperationsOperator: {
      key: 'platform_operations',
      canonical: 'OperationsOperator',
      aliases: ['platform_operations', 'OperationsOperator', 'operations'],
      labelFa: 'اپراتور عملیات و زیرساخت',
      descriptionFa: 'مدیریت استقرار، جاب‌ها، پروب‌ها و پایش تله‌متری',
      level: 80
    },
    SupportAgent: {
      key: 'platform_support',
      canonical: 'SupportAgent',
      aliases: ['platform_support', 'SupportAgent', 'support'],
      labelFa: 'کارشناس پشتیبانی',
      descriptionFa: 'رسیدگی به تیکت‌ها، نشست تفویض دسترسی و دیاگنوستیک مشتریان',
      level: 60
    },
    FinanceOperator: {
      key: 'platform_finance',
      canonical: 'FinanceOperator',
      aliases: ['platform_finance', 'FinanceOperator', 'finance'],
      labelFa: 'اپراتور مالی و بازرگانی',
      descriptionFa: 'صورتحساب‌ها، ثبت تسویه، تمدید استمهال و کاتالوگ پلن‌ها',
      level: 50
    },
    SecurityAuditor: {
      key: 'platform_security',
      canonical: 'SecurityAuditor',
      aliases: ['platform_security', 'SecurityAuditor', 'security_auditor', 'auditor'],
      labelFa: 'ممیز امنیت و انطباق',
      descriptionFa: 'بازرسی ردپای ممیزی، بررسی زنجیره هش و کشف دست‌کاری',
      level: 40
    },
    ReadOnly: {
      key: 'platform_readonly',
      canonical: 'ReadOnly',
      aliases: ['platform_readonly', 'ReadOnly', 'readonly', 'observer'],
      labelFa: 'ناظر و مشاهده‌گر (فقط خواندنی)',
      descriptionFa: 'مشاهده اطلاعات و گزارش‌ها بدون امکان هرگونه تغییر یا ثبت عملیات',
      level: 10
    }
  });

  function normalizeRole(role) {
    if (!role) return 'ReadOnly';
    const r = String(role).trim().toLowerCase();
    for (const def of Object.values(PLATFORM_ROLES)) {
      if (def.aliases.some(a => a.toLowerCase() === r)) {
        return def.canonical;
      }
    }
    return role;
  }

  // 2. Tenant Roles (Customer Organization - NEVER mixed into platform dropdowns)
  const TENANT_ROLES = Object.freeze({
    owner: { key: 'owner', labelFa: 'مالک مجموعه' },
    admin: { key: 'admin', labelFa: 'مدیر ارشد شعبه / مجموعه' },
    manager: { key: 'manager', labelFa: 'مدیر داخلی' },
    cashier: { key: 'cashier', labelFa: 'صندوق‌دار' },
    waiter: { key: 'waiter', labelFa: 'گارسون / سالن‌دار' },
    kitchen: { key: 'kitchen', labelFa: 'پرسنل آشپزخانه' }
  });

  // 1.1 Canonical Platform Capabilities Matrix (Phase 5)
  const PLATFORM_PERMISSIONS = Object.freeze({
    TENANT_READ: 'tenant.read',
    TENANT_CREATE: 'tenant.create',
    TENANT_SUSPEND: 'tenant.lifecycle.suspend',
    TENANT_REACTIVATE: 'tenant.lifecycle.reactivate',
    TENANT_BRANCH_CREATE: 'tenant.branch.create',
    SUBSCRIPTION_READ: 'subscription.read',
    SUBSCRIPTION_PLAN_CHANGE: 'subscription.plan.change',
    BILLING_INVOICE_READ: 'billing.invoice.read',
    BILLING_INVOICE_MARK_PAID: 'billing.invoice.markPaid',
    BILLING_REFUND: 'billing.refund',
    POLICY_ENTITLEMENT_READ: 'policy.entitlement.read',
    POLICY_ENTITLEMENT_OVERRIDE: 'policy.entitlement.override',
    PLATFORM_KILL_SWITCH: 'platform.killSwitch.execute',
    SUPPORT_SESSION_REQUEST: 'support.session.request',
    SUPPORT_PII_REVEAL: 'support.pii.reveal',
    BACKUP_READ: 'backup.read',
    BACKUP_RESTORE: 'backup.restore',
    RELEASE_PROMOTE: 'release.promote',
    RELEASE_ROLLBACK: 'release.rollback',
    SECURITY_POSTURE_READ: 'security.posture.read',
    AUDIT_READ: 'audit.read',
    PLATFORM_TEAM_MANAGE: 'platform.team.manage'
  });

  const ROLE_DEFAULT_CAPABILITIES = Object.freeze({
    PlatformOwner: ['*'],
    PlatformAdmin: [
      'tenant.read', 'tenant.create', 'tenant.lifecycle.suspend', 'tenant.lifecycle.reactivate', 'tenant.branch.create',
      'subscription.read', 'subscription.plan.change', 'billing.invoice.read', 'billing.invoice.markPaid',
      'policy.entitlement.read', 'policy.entitlement.override', 'support.session.request', 'support.pii.reveal',
      'backup.read', 'release.promote', 'security.posture.read', 'audit.read', 'platform.team.manage'
    ],
    OperationsOperator: [
      'tenant.read', 'backup.read', 'backup.restore', 'release.promote', 'release.rollback',
      'security.posture.read', 'audit.read'
    ],
    SupportAgent: [
      'tenant.read', 'subscription.read', 'billing.invoice.read', 'policy.entitlement.read',
      'support.session.request', 'support.pii.reveal'
    ],
    FinanceOperator: [
      'tenant.read', 'subscription.read', 'subscription.plan.change', 'billing.invoice.read',
      'billing.invoice.markPaid', 'billing.refund', 'audit.read'
    ],
    SecurityAuditor: [
      'tenant.read', 'security.posture.read', 'audit.read'
    ],
    ReadOnly: [
      'tenant.read', 'subscription.read', 'billing.invoice.read', 'policy.entitlement.read',
      'security.posture.read', 'audit.read'
    ]
  });

  class PermissionManager {
    constructor() {
      // P0 Phase 2: Initial Principal must be null, never a fake PlatformOwner
      this._currentPrincipal = null;
      this._subscribers = new Set();
    }

    get principal() {
      return this._currentPrincipal;
    }

    isAuthenticated() {
      return this._currentPrincipal !== null && typeof this._currentPrincipal === 'object';
    }

    setPrincipal(principal) {
      if (!principal || !principal.role) {
        this._currentPrincipal = null;
        this._notifySubscribers();
        return;
      }
      const canonicalRole = normalizeRole(principal.role);
      const permissions = Array.isArray(principal.permissions) && principal.permissions.length > 0
        ? principal.permissions
        : (ROLE_DEFAULT_CAPABILITIES[canonicalRole] || ROLE_DEFAULT_CAPABILITIES.ReadOnly);

      this._currentPrincipal = {
        ...principal,
        role: canonicalRole,
        rawRole: principal.role,
        permissions: Object.freeze([...permissions])
      };
      this._notifySubscribers();
    }

    clearPrincipal() {
      this._currentPrincipal = null;
      this._notifySubscribers();
    }

    subscribe(fn) {
      if (typeof fn === 'function') {
        this._subscribers.add(fn);
        return () => this._subscribers.delete(fn);
      }
      return () => {};
    }

    _notifySubscribers() {
      for (const fn of this._subscribers) {
        try { fn(this._currentPrincipal); } catch (e) { console.error(e); }
      }
    }

    getRoleDefinition(role = null) {
      if (!this.isAuthenticated() && !role) return PLATFORM_ROLES.ReadOnly;
      const targetRole = normalizeRole(role || this._currentPrincipal.role);
      return PLATFORM_ROLES[targetRole] || PLATFORM_ROLES.ReadOnly;
    }

    hasPermission(capability) {
      if (!this.isAuthenticated()) return false;
      const perms = this._currentPrincipal.permissions || [];
      if (perms.includes('*')) return true;
      return perms.includes(capability);
    }

    hasRole(requiredRoles) {
      if (!requiredRoles) return true;
      if (!this.isAuthenticated()) return false;

      const allowed = (Array.isArray(requiredRoles) ? requiredRoles : [requiredRoles]).map(normalizeRole);
      if (allowed.length === 0) return true;
      const current = normalizeRole(this._currentPrincipal.role);

      // PlatformOwner has super-privilege
      if (current === 'PlatformOwner') return true;

      return allowed.includes(current);
    }

    isOwner() {
      if (!this.isAuthenticated()) return false;
      return normalizeRole(this._currentPrincipal.role) === 'PlatformOwner';
    }

    isAdminOrHigher() {
      if (!this.isAuthenticated()) return false;
      const def = this.getRoleDefinition();
      return def.level >= 90;
    }

    isOperationsOrHigher() {
      if (!this.isAuthenticated()) return false;
      const def = this.getRoleDefinition();
      return def.level >= 80;
    }

    isSupportOrHigher() {
      if (!this.isAuthenticated()) return false;
      const def = this.getRoleDefinition();
      return def.level >= 60;
    }

    isFinanceOrHigher() {
      if (!this.isAuthenticated()) return false;
      const def = this.getRoleDefinition();
      return def.level >= 50;
    }

    isReadOnly() {
      if (!this.isAuthenticated()) return true;
      return normalizeRole(this._currentPrincipal.role) === 'ReadOnly';
    }

    canMutate(capability = null) {
      if (!this.isAuthenticated()) return false;
      if (this.isReadOnly()) return false;
      if (capability) return this.hasPermission(capability);
      return true;
    }

    assertCanMutate(actionName = 'عملیات', capability = null) {
      if (!this.isAuthenticated()) {
        const msg = `خطای دسترسی: نشست شما معتبر نیست. لطفاً وارد سیستم شوید.`;
        if (global.GMToast) global.GMToast.show(msg, 'error');
        throw new Error(msg);
      }
      if (this.isReadOnly()) {
        const msg = `خطای دسترسی: حساب شما در حالت «فقط‌خواندنی» (ReadOnly) قرار دارد و اجازه انجام «${actionName}» را ندارد.`;
        if (global.GMToast) global.GMToast.show(msg, 'warning');
        throw new Error(msg);
      }
      if (capability && !this.hasPermission(capability)) {
        const msg = `خطای دسترسی: حساب شما فاقد دسترسی «${capability}» برای اجرای «${actionName}» است.`;
        if (global.GMToast) global.GMToast.show(msg, 'warning');
        throw new Error(msg);
      }
      return true;
    }

    getPlatformRolesList() {
      return Object.values(PLATFORM_ROLES);
    }

    getTenantRolesList() {
      return Object.values(TENANT_ROLES);
    }
  }

  const GodModePermissions = new PermissionManager();
  global.GodModePermissions = GodModePermissions;
  global.PLATFORM_ROLES = PLATFORM_ROLES;
  global.PLATFORM_PERMISSIONS = PLATFORM_PERMISSIONS;
  global.ROLE_DEFAULT_CAPABILITIES = ROLE_DEFAULT_CAPABILITIES;
  global.normalizeRole = normalizeRole;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = GodModePermissions;
    module.exports.PLATFORM_ROLES = PLATFORM_ROLES;
    module.exports.normalizeRole = normalizeRole;
  }
})(typeof window !== 'undefined' ? window : globalThis);
