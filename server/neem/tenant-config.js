'use strict';

const DEFAULT_TENANT_ID = 'westo';
const DEFAULT_PLATFORM_BASE_DOMAIN = 'neem.ir';

function normalizeTenantId(value, fallback = DEFAULT_TENANT_ID) {
  const clean = String(value || fallback).trim().toLowerCase();
  return /^[a-z][a-z0-9-]{1,62}$/.test(clean) ? clean : fallback;
}

function normalizeHost(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\.$/, '');
}

function hostnameFromHostHeader(value) {
  const host = normalizeHost(value);
  if (!host) return '';
  try {
    return new URL(`http://${host}`).hostname.toLowerCase().replace(/\.$/, '');
  } catch {
    return host.split(':')[0];
  }
}

function csv(value) {
  return [...new Set(String(value || '').split(',').map(normalizeHost).filter(Boolean))];
}

function loadTenantConfig(env = process.env) {
  const tenantId = normalizeTenantId(env.NEEM_TENANT_ID);
  const tenantHosts = csv(env.NEEM_TENANT_HOSTS);
  if (!tenantHosts.length) {
    tenantHosts.push(`${tenantId}.neem.ir`);
    if (tenantId === 'westo') tenantHosts.push('westocoffee.ir');
  }

  return Object.freeze({
    tenantId,
    tenantSlug: normalizeTenantId(env.NEEM_TENANT_SLUG, tenantId),
    displayName: String(env.NEEM_TENANT_NAME || (tenantId === 'westo' ? 'کافه وستو' : tenantId)).trim().slice(0, 160),
    canonicalDomain: normalizeHost(env.NEEM_CANONICAL_DOMAIN || tenantHosts[0]),
    hosts: Object.freeze(tenantHosts),
    cellId: String(env.NEEM_CELL_ID || `${tenantId}-cell-01`).trim().slice(0, 120),
    release: String(env.NEEM_RELEASE || 'local').trim().slice(0, 120),
    mode: env.NEEM_EDGE_MODE === 'true' ? 'edge' : 'cloud',
    enforceHost: env.NEEM_ENFORCE_TENANT_HOST === 'true',
    requireMetadata: env.NEEM_REQUIRE_TENANT_METADATA === 'true',
    multiTenant: env.NEEM_MULTI_TENANT_MODE === 'true',
  });
}

function isDevelopmentHost(hostname) {
  return new Set(['localhost', '127.0.0.1', '::1']).has(hostnameFromHostHeader(hostname));
}

function hostMatchesTenant(hostHeader, config) {
  const full = normalizeHost(hostHeader);
  const hostname = hostnameFromHostHeader(full);
  return config.hosts.some((allowed) => allowed === full || allowed === hostname);
}

/**
 * Classifies an incoming host into platform, default subdomain, or custom domain
 */
function classifyHost(hostHeader, baseDomain = DEFAULT_PLATFORM_BASE_DOMAIN) {
  const full = normalizeHost(hostHeader);
  const hostname = hostnameFromHostHeader(full);

  if (!hostname) {
    return { kind: 'unknown', hostname: '', isPlatform: false, isSubdomain: false, isCustom: false };
  }

  if (isDevelopmentHost(hostname)) {
    return { kind: 'development', hostname, isPlatform: false, isSubdomain: false, isCustom: false, isLocal: true };
  }

  // 1. Platform Root & Admin/API
  const platformHosts = new Set([
    baseDomain,
    `www.${baseDomain}`,
    `admin.${baseDomain}`,
    `api.${baseDomain}`,
    `control.${baseDomain}`,
    `status.${baseDomain}`,
  ]);

  if (platformHosts.has(hostname)) {
    return { kind: 'platform_core', hostname, isPlatform: true, isSubdomain: false, isCustom: false };
  }

  // 2. Default Subdomain: <slug>.neem.ir or <slug>.localhost
  if (hostname.endsWith(`.${baseDomain}`)) {
    const slug = hostname.slice(0, -(baseDomain.length + 1));
    return {
      kind: 'platform_subdomain',
      hostname,
      slug,
      tenantId: slug,
      isPlatform: false,
      isSubdomain: true,
      isCustom: false,
      isWhiteLabel: false,
    };
  }

  if (hostname.endsWith('.localhost')) {
    const slug = hostname.slice(0, -('.localhost'.length));
    if (slug && slug !== 'www') {
      return {
        kind: 'platform_subdomain',
        hostname,
        slug,
        tenantId: slug,
        isPlatform: false,
        isSubdomain: true,
        isCustom: false,
        isWhiteLabel: false,
        isLocal: true,
      };
    }
  }

  // 3. Custom Domain (BYOD / White-label): e.g. order.shandiz.com or westocoffee.ir
  return {
    kind: 'custom_domain',
    hostname,
    isPlatform: false,
    isSubdomain: false,
    isCustom: true,
    isWhiteLabel: true,
  };
}

/**
 * Resolves the tenant slug for any incoming HTTP request.
 * Priority:
 * 1. Query parameter ?tenant=<slug>
 * 2. Header 'x-tenant-id' or 'x-tenant-slug'
 * 3. Host subdomain: <slug>.neem.ir or <slug>.localhost
 * 4. Custom domain or default: 'westo'
 */
function resolveTenantSlugFromRequest(req, { baseDomain = DEFAULT_PLATFORM_BASE_DOMAIN, defaultTenantId = DEFAULT_TENANT_ID } = {}) {
  if (!req) return defaultTenantId;

  // 1. Explicit query param (e.g. ?tenant=shayan)
  if (req.query && req.query.tenant) {
    return normalizeTenantId(req.query.tenant, defaultTenantId);
  }

  // 2. Explicit headers
  if (req.headers) {
    const headerTenant = req.headers['x-tenant-id'] || req.headers['x-tenant-slug'];
    if (headerTenant) {
      return normalizeTenantId(headerTenant, defaultTenantId);
    }
  }

  // 3. Host subdomain
  const rawHost = String(req.headers?.['x-forwarded-host'] || req.headers?.host || '');
  const hostname = hostnameFromHostHeader(rawHost);

  if (hostname) {
    if (hostname.endsWith(`.${baseDomain}`)) {
      const slug = hostname.slice(0, -(baseDomain.length + 1));
      if (slug && !['www', 'admin', 'api', 'control', 'status', 'auth', 'cdn'].includes(slug)) {
        return normalizeTenantId(slug, defaultTenantId);
      }
    }
    if (hostname.endsWith('.localhost')) {
      const slug = hostname.slice(0, -('.localhost'.length));
      if (slug && slug !== 'www') {
        return normalizeTenantId(slug, defaultTenantId);
      }
    }
    if (hostname === 'westocoffee.ir' || hostname === 'www.westocoffee.ir') {
      return 'westo';
    }
  }

  return defaultTenantId;
}

function tenantHostMiddleware(config, { logger = console } = {}) {
  return (req, res, next) => {
    const host = String(req.headers.host || '');
    const allowed = hostMatchesTenant(host, config);
    const local = isDevelopmentHost(host);
    if (config.enforceHost && !allowed && !local) {
      logger.warn?.(`[tenant] rejected host ${host || '<empty>'} for ${config.tenantId}`);
      return res.status(421).json({ ok: false, error: 'tenant_host_mismatch' });
    }
    req.tenant = config;
    req.tenantHostMatched = allowed;
    req.hostClassification = classifyHost(host);
    next();
  };
}

/**
 * Dynamic Tenant Host Middleware for Production VPS Ingress.
 * Dynamically resolves:
 * - neem.ir / admin.neem.ir -> Platform mode
 * - <slug>.neem.ir -> Tenant subdomain mode
 * - <custom-domain> -> Custom domain lookup with white-label isolation
 */
function createDynamicTenantHostMiddleware({ domainRoutingService, baseDomain = DEFAULT_PLATFORM_BASE_DOMAIN, logger = console } = {}) {
  return async (req, res, next) => {
    const rawHost = String(req.headers['x-forwarded-host'] || req.headers.host || '');
    const classification = classifyHost(rawHost, baseDomain);
    req.hostClassification = classification;

    // Platform Core Hub
    if (classification.isPlatform) {
      req.isPlatform = true;
      req.tenantId = 'platform';
      return next();
    }

    // Default Tenant Subdomain: <slug>.neem.ir
    if (classification.isSubdomain) {
      req.isSubdomain = true;
      req.tenantId = classification.slug;
      req.tenantSlug = classification.slug;
      req.isWhiteLabel = false;
      return next();
    }

    // Custom Domain: Lookup in domain routing service / DB
    if (classification.isCustom && domainRoutingService) {
      try {
        const resolved = await domainRoutingService.resolveHostToTenant(rawHost);
        if (resolved && resolved.matched) {
          req.tenantId = resolved.tenantId;
          req.tenantSlug = resolved.tenantSlug;
          req.isCustomDomain = true;
          req.isWhiteLabel = true;
          req.domainContext = resolved;
          return next();
        }
      } catch (err) {
        logger.error?.('[dynamicTenantHostMiddleware] resolution error:', err.message);
      }
    }

    // Fallback if local/dev
    if (classification.isLocal) {
      return next();
    }

    // If unresolved custom domain
    if (classification.isCustom) {
      return res.status(404).json({
        ok: false,
        error: 'UNKNOWN_CUSTOM_DOMAIN',
        message: `The domain '${rawHost}' is not connected to any active restaurant in the NEEM platform.`
      });
    }

    next();
  };
}

function publicTenantContext(config) {
  return {
    tenantId: config.tenantId,
    tenantSlug: config.tenantSlug,
    displayName: config.displayName,
    canonicalDomain: config.canonicalDomain,
    cellId: config.cellId,
    release: config.release,
    mode: config.mode,
  };
}

module.exports = {
  DEFAULT_TENANT_ID,
  DEFAULT_PLATFORM_BASE_DOMAIN,
  normalizeTenantId,
  normalizeHost,
  hostnameFromHostHeader,
  classifyHost,
  loadTenantConfig,
  hostMatchesTenant,
  tenantHostMiddleware,
  createDynamicTenantHostMiddleware,
  publicTenantContext,
  resolveTenantSlugFromRequest,
};
