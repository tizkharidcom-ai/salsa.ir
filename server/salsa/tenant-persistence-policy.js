'use strict';

/**
 * This server still routes non-WESTO application state through tenant JSON
 * snapshots. Those snapshots are not a safe production authority when more
 * than one process can serve a tenant. Keep production access closed until
 * the tenant-scoped PostgreSQL repository is wired into every state path.
 */
function legacyTenantPersistenceError({ nodeEnv = process.env.NODE_ENV, tenantId } = {}) {
  const tenant = String(tenantId || '').trim().toLowerCase();
  if (nodeEnv !== 'production') return null;

  // Never let an unresolved tenant identity fall through to APIs whose
  // default argument is the shared WESTO database (for example
  // tenantRegistry.getTenantDb(undefined)).
  if (!tenant) {
    return Object.assign(
      new Error('شناسهٔ مستأجر برای نوشتن دادهٔ پایدار مشخص نیست؛ عملیات متوقف شد.'),
      { code: 'tenant_identity_required', status: 503 },
    );
  }
  if (tenant === 'westo') return null;

  return Object.assign(
    new Error('ذخیره‌سازی پایدار این مستأجر در این نسخه به PostgreSQL متصل نیست؛ عملیات تا آماده‌شدن مخزن tenant متوقف شد.'),
    { code: 'tenant_postgres_state_adapter_required', status: 503 },
  );
}

module.exports = { legacyTenantPersistenceError };
