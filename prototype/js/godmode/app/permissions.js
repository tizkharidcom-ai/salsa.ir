/**
 * prototype/js/godmode/app/permissions.js
 *
 * Strict Role and Permission Guard for SALSA God Mode (superadmin.md §11).
 * Strictly separates Platform Realm roles from Tenant Realm roles.
 */

(function (global) {
  'use strict';

  // 1. Platform Roles (SALSA Internal Team)
  const PLATFORM_ROLES = Object.freeze({
    platform_owner: {
      key: 'platform_owner',
      labelFa: 'مدیر ارشد پلتفرم',
      descriptionFa: 'دسترسی کامل به تمام منابع، تغییرات مخرب و پیکربندی کلان',
      level: 100
    },
    platform_operations: {
      key: 'platform_operations',
      labelFa: 'عملیات و زیرساخت',
      descriptionFa: 'مدیریت استقرار، جاب‌ها، راه‌اندازی و پایش سیستم',
      level: 80
    },
    platform_support: {
      key: 'platform_support',
      labelFa: 'پشتیبانی فنی',
      descriptionFa: 'رسیدگی به تیکت‌ها، جلسات تفویض دسترسی و دیاگنوستیک',
      level: 60
    },
    platform_finance: {
      key: 'platform_finance',
      labelFa: 'مدیریت مالی و اشتراک',
      descriptionFa: 'صورتحساب‌ها، پلن‌ها، فاکتورها و بازپرداخت‌ها',
      level: 50
    },
    platform_readonly: {
      key: 'platform_readonly',
      labelFa: 'ناظر و مشاهده‌گر',
      descriptionFa: 'فقط خواندن بدون امکان ثبت یا تغییر در اطلاعات',
      level: 10
    }
  });

  // 2. Tenant Roles (Customer Organization - NEVER mixed into platform dropdowns)
  const TENANT_ROLES = Object.freeze({
    owner: { key: 'owner', labelFa: 'مالک مجموعه' },
    admin: { key: 'admin', labelFa: 'مدیر ارشد شعبه / مجموعه' },
    manager: { key: 'manager', labelFa: 'مدیر داخلی' },
    cashier: { key: 'cashier', labelFa: 'صندوق‌دار' },
    waiter: { key: 'waiter', labelFa: 'گارسون / سالن‌دار' },
    kitchen: { key: 'kitchen', labelFa: 'پرسنل آشپزخانه' }
  });

  class PermissionManager {
    constructor() {
      this._currentPrincipal = {
        id: 'usr_platform_owner',
        email: 'admin@salsa.ir',
        fullName: 'مدیر ارشد پلتفرم سالسا',
        role: 'platform_owner'
      };
    }

    get principal() {
      return this._currentPrincipal;
    }

    setPrincipal(principal) {
      if (!principal || !principal.role) {
        throw new Error('Principal must include a valid role.');
      }
      this._currentPrincipal = { ...principal };
    }

    hasRole(requiredRoles) {
      if (!requiredRoles) return true;
      const allowed = Array.isArray(requiredRoles) ? requiredRoles : [requiredRoles];
      if (allowed.length === 0) return true;
      return allowed.includes(this._currentPrincipal.role);
    }

    isOwner() {
      return this._currentPrincipal.role === 'platform_owner';
    }

    isOperationsOrHigher() {
      const role = PLATFORM_ROLES[this._currentPrincipal.role];
      return Boolean(role && role.level >= 80);
    }

    isSupportOrHigher() {
      const role = PLATFORM_ROLES[this._currentPrincipal.role];
      return Boolean(role && role.level >= 60);
    }

    isReadOnly() {
      return this._currentPrincipal.role === 'platform_readonly';
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

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = GodModePermissions;
  }
})(typeof window !== 'undefined' ? window : globalThis);
