'use strict';

const {
  createTenantContext,
  normalizeHost,
  normalizeTenantId,
} = require('./tenant-context');

const RESERVED_PLATFORM_HOSTS = new Set([
  'salsa.ir',
  'www.salsa.ir',
  'admin.salsa.ir',
  'api.salsa.ir',
  'control.salsa.ir',
  'status.salsa.ir',
  'neem.ir',
  'www.neem.ir',
  'admin.neem.ir',
  'api.neem.ir',
  'control.neem.ir',
  'status.neem.ir',
]);

function hostnameFromHostHeader(value) {
  const host = normalizeHost(value);
  if (!host) return '';
  try {
    return new URL(`http://${host}`).hostname.toLowerCase().replace(/\.$/, '');
  } catch (_error) {
    return host.split(':')[0];
  }
}

function isLocalHost(hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

function isTenantDatabaseRegistration(registration) {
  return Boolean(
    registration &&
    normalizeTenantId(registration.tenantId || registration.tenant_id) &&
    (registration.databaseName || registration.database_name)
  );
}

function toRegistrationContext(registration, host) {
  const tenantId = registration.tenantId || registration.tenant_id;
  return createTenantContext({
    tenantId,
    tenantSlug: registration.tenantSlug || registration.tenant_slug || tenantId,
    domain: host,
    databaseName: registration.databaseName || registration.database_name,
    databaseProvider: registration.databaseProvider || registration.database_provider || 'postgres',
    cellId: registration.cellId || registration.cell_id || null,
    release: registration.release || null,
    status: registration.status || 'active',
    source: registration.source || 'control-db',
  });
}

/**
 * Resolve only registered hosts. A syntactically valid subdomain is not
 * enough: the control data access must return an active tenant registration.
 */
class TenantResolver {
  constructor({
    controlDataAccess = null,
    baseDomain = 'salsa.ir',
    defaultTenant = null,
    defaultHosts = [],
    localHostTenant = null,
    allowLocalDevelopment = true,
    trustForwardedHost = false,
    logger = console,
  } = {}) {
    this.controlDataAccess = controlDataAccess;
    this.baseDomain = normalizeHost(baseDomain);
    this.defaultTenant = defaultTenant;
    this.defaultHosts = new Set(defaultHosts.map(hostnameFromHostHeader).filter(Boolean));
    this.localHostTenant = localHostTenant;
    this.allowLocalDevelopment = allowLocalDevelopment;
    this.trustForwardedHost = trustForwardedHost;
    this.logger = logger;
  }

  async resolveHost(rawHost) {
    const hostname = hostnameFromHostHeader(rawHost);
    if (!hostname) return null;
    if (RESERVED_PLATFORM_HOSTS.has(hostname)) return null;

    if (isLocalHost(hostname)) {
      return this.resolveConfiguredTenant(this.localHostTenant || this.defaultTenant, hostname);
    }

    const direct = await this.lookupRegisteredHost(hostname);
    if (direct) return direct;

    const suffix = `.${this.baseDomain}`;
    if (hostname.endsWith(suffix)) {
      // The subdomain must itself be registered in Control DB. Never derive
      // an id from DNS syntax and treat it as an existing tenant.
      return null;
    }

    if (hostname.endsWith('.localhost') && this.allowLocalDevelopment) {
      return null;
    }

    return null;
  }

  async lookupRegisteredHost(hostname) {
    if (this.controlDataAccess?.findTenantByHost) {
      const registration = await this.controlDataAccess.findTenantByHost(hostname);
      if (registration && this.isActiveRegistration(registration)) {
        return toRegistrationContext({ ...registration, source: 'control-db' }, hostname);
      }
      return null;
    }

    if (this.defaultHosts.has(hostname)) {
      return this.resolveConfiguredTenant(this.defaultTenant, hostname);
    }
    return null;
  }

  async lookupRegisteredTenant(tenantId, hostname) {
    if (this.controlDataAccess?.findTenantById) {
      const registration = await this.controlDataAccess.findTenantById(tenantId);
      if (registration && this.isActiveRegistration(registration)) {
        return toRegistrationContext({ ...registration, source: 'control-db' }, hostname);
      }
      return null;
    }

    if (tenantId === normalizeTenantId(this.defaultTenant)) {
      return this.resolveConfiguredTenant(tenantId, hostname);
    }
    return null;
  }

  async resolveConfiguredTenant(tenantId, hostname) {
    const cleanId = normalizeTenantId(tenantId);
    if (!cleanId) return null;
    if (this.controlDataAccess?.findTenantById) {
      const registration = await this.controlDataAccess.findTenantById(cleanId);
      if (registration && this.isActiveRegistration(registration)) {
        return toRegistrationContext({ ...registration, source: 'control-db' }, hostname);
      }
      return null;
    }
    return null;
  }

  isActiveRegistration(registration) {
    return isTenantDatabaseRegistration(registration) &&
      (!registration.status || String(registration.status).trim().toLowerCase() === 'active');
  }

  middleware() {
    return async (req, res, next) => {
      const rawHost = this.trustForwardedHost && req.headers['x-forwarded-host']
        ? req.headers['x-forwarded-host']
        : req.headers.host || '';
      try {
        const context = await this.resolveHost(rawHost);
        if (!context) {
          return res.status(404).json({
            ok: false,
            error: 'unknown_tenant_host',
            message: 'این دامنه به یک tenant فعال و ثبت‌شده متصل نیست.',
          });
        }
        req.tenantContext = context;
        req.tenantId = context.tenantId;
        req.tenantSlug = context.tenantSlug;
        req.tenantHostMatched = true;
        return next();
      } catch (error) {
        this.logger.error?.('[tenant-resolver] resolution failed:', error.message);
        return res.status(503).json({
          ok: false,
          error: 'tenant_resolution_unavailable',
          message: 'امکان تشخیص tenant در حال حاضر وجود ندارد.',
        });
      }
    };
  }
}

module.exports = {
  RESERVED_PLATFORM_HOSTS,
  hostnameFromHostHeader,
  isLocalHost,
  isTenantDatabaseRegistration,
  toRegistrationContext,
  TenantResolver,
};
