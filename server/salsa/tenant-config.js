'use strict';

const net = require('node:net');

const DEFAULT_TENANT_ID = 'westo';
const DEFAULT_PLATFORM_BASE_DOMAIN = process.env.SALSA_PLATFORM_BASE_DOMAIN || process.env.NEEM_PLATFORM_BASE_DOMAIN || 'salsa.ir';

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

function parseHostAuthority(value) {
  const authority = String(value ?? '').trim();
  if (!authority || /[\s\u0000-\u001f\u007f,\\/?#@%]/u.test(authority)) return null;

  let rawHostname;
  let rawPort = null;
  if (authority.startsWith('[')) {
    const match = /^\[([^\]]+)\](?::([0-9]+))?$/.exec(authority);
    if (!match || net.isIP(match[1]) !== 6) return null;
    rawHostname = match[1];
    rawPort = match[2] ?? null;
  } else {
    const match = /^([^:[\]]+?)(?::([0-9]+))?$/.exec(authority);
    if (!match) return null;
    rawHostname = match[1];
    rawPort = match[2] ?? null;
  }

  if (rawPort !== null) {
    const port = Number(rawPort);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
    rawPort = String(port);
  }

  let hostname;
  if (net.isIP(rawHostname) === 6) {
    hostname = rawHostname.toLowerCase();
  } else {
    // A single trailing dot is the DNS FQDN spelling of the same host.
    const dnsName = rawHostname.replace(/\.$/, '');
    if (!dnsName || dnsName.endsWith('.')) return null;
    try {
      hostname = new URL(`http://${dnsName}`).hostname.toLowerCase().replace(/\.$/, '');
    } catch {
      return null;
    }

    const ipVersion = net.isIP(hostname);
    if (ipVersion) {
      // Reject URL's legacy shorthand IPv4 forms (for example 127.1).
      if (net.isIP(dnsName) !== ipVersion) return null;
    } else {
      if (hostname.length > 253) return null;
      const labels = hostname.split('.');
      if (labels.some((label) => label.length < 1 || label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))) {
        return null;
      }
    }
  }

  const host = net.isIP(hostname) === 6 ? `[${hostname}]` : hostname;
  return {
    hostname,
    port: rawPort,
    authority: rawPort === null ? host : `${host}:${rawPort}`,
  };
}

function hostnameFromHostHeader(value) {
  return parseHostAuthority(value)?.hostname || '';
}

function csv(value) {
  return [...new Set(String(value || '').split(',').map(normalizeHost).filter(Boolean))];
}

function loadTenantConfig(env = process.env) {
  const tenantId = normalizeTenantId(env.SALSA_TENANT_ID || env.NEEM_TENANT_ID);
  const tenantHosts = csv(env.SALSA_TENANT_HOSTS || env.NEEM_TENANT_HOSTS);
  const baseDomain = env.SALSA_PLATFORM_BASE_DOMAIN || env.NEEM_PLATFORM_BASE_DOMAIN || DEFAULT_PLATFORM_BASE_DOMAIN;
  if (!tenantHosts.length) {
    tenantHosts.push(`${tenantId}.${baseDomain}`);
    if (baseDomain !== 'salsa.ir') tenantHosts.push(`${tenantId}.salsa.ir`);
    if (tenantId === 'westo') tenantHosts.push('westocoffee.ir');
  }

  return Object.freeze({
    tenantId,
    tenantSlug: normalizeTenantId(env.SALSA_TENANT_SLUG || env.NEEM_TENANT_SLUG, tenantId),
    displayName: String(env.SALSA_TENANT_NAME || env.NEEM_TENANT_NAME || (tenantId === 'westo' ? 'کافه وستو' : tenantId)).trim().slice(0, 160),
    canonicalDomain: normalizeHost(env.SALSA_CANONICAL_DOMAIN || env.NEEM_CANONICAL_DOMAIN || tenantHosts[0]),
    hosts: Object.freeze(tenantHosts),
    cellId: String(env.SALSA_CELL_ID || env.NEEM_CELL_ID || `${tenantId}-cell-01`).trim().slice(0, 120),
    release: String(env.SALSA_RELEASE || env.NEEM_RELEASE || 'local').trim().slice(0, 120),
    mode: (env.SALSA_EDGE_MODE || env.NEEM_EDGE_MODE) === 'true' ? 'edge' : 'cloud',
    enforceHost: (env.SALSA_ENFORCE_TENANT_HOST || env.NEEM_ENFORCE_TENANT_HOST) === 'true',
    requireMetadata: (env.SALSA_REQUIRE_TENANT_METADATA || env.NEEM_REQUIRE_TENANT_METADATA) === 'true',
    multiTenant: (env.SALSA_MULTI_TENANT_MODE || env.NEEM_MULTI_TENANT_MODE) === 'true',
  });
}

function isDevelopmentHost(hostname) {
  const localHosts = new Set(['localhost', '127.0.0.1', '::1']);
  const clean = String(hostname || '').trim().toLowerCase();
  return localHosts.has(clean) || localHosts.has(hostnameFromHostHeader(clean));
}

function hostMatchesTenant(hostHeader, config) {
  const incoming = parseHostAuthority(hostHeader);
  if (!incoming) return false;
  return config.hosts.some((allowedHost) => {
    const allowed = parseHostAuthority(allowedHost);
    if (!allowed) return false;
    return allowed.port === null
      ? allowed.hostname === incoming.hostname
      : allowed.authority === incoming.authority;
  });
}

/**
 * Classifies an incoming host into platform, default subdomain, or custom domain
 */
function classifyHost(hostHeader, baseDomain = DEFAULT_PLATFORM_BASE_DOMAIN) {
  const parsedHost = parseHostAuthority(hostHeader);
  const hostname = parsedHost?.hostname || '';

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

  // 2. Default Subdomain: <slug>.salsa.ir or <slug>.localhost
  if (hostname.endsWith(`.${baseDomain}`)) {
    const slug = hostname.slice(0, -(baseDomain.length + 1));
    const tenantSlug = normalizeTenantId(slug, '');
    if (!tenantSlug || tenantSlug !== slug) {
      return { kind: 'unknown', hostname, isPlatform: false, isSubdomain: false, isCustom: false };
    }
    return {
      kind: 'platform_subdomain',
      hostname,
      slug: tenantSlug,
      tenantId: tenantSlug,
      isPlatform: false,
      isSubdomain: true,
      isCustom: false,
      isWhiteLabel: false,
    };
  }

  if (hostname.endsWith('.localhost')) {
    const slug = hostname.slice(0, -('.localhost'.length));
    const tenantSlug = normalizeTenantId(slug, '');
    if (tenantSlug && tenantSlug === slug && slug !== 'www') {
      return {
        kind: 'platform_subdomain',
        hostname,
        slug: tenantSlug,
        tenantId: tenantSlug,
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
 * 3. Host subdomain: <slug>.salsa.ir or <slug>.localhost
 * 4. Custom domain or default: 'westo'
 */
function resolveTenantSlugFromRequest(req, {
  baseDomain = DEFAULT_PLATFORM_BASE_DOMAIN,
  defaultTenantId = DEFAULT_TENANT_ID,
  trustForwardedHost = false,
} = {}) {
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
  const rawHost = trustForwardedHost && req.headers?.['x-forwarded-host']
    ? req.headers['x-forwarded-host']
    : req.headers?.host;
  const parsedHost = parseHostAuthority(rawHost);
  if (!parsedHost) return defaultTenantId;
  const hostname = parsedHost.hostname;

  if (hostname) {
    if (hostname.endsWith(`.${baseDomain}`)) {
      const slug = hostname.slice(0, -(baseDomain.length + 1));
      const tenantSlug = normalizeTenantId(slug, '');
      if (tenantSlug && tenantSlug === slug && !['www', 'admin', 'api', 'control', 'status', 'auth', 'cdn'].includes(slug)) {
        return tenantSlug;
      }
    }
    if (hostname.endsWith('.localhost')) {
      const slug = hostname.slice(0, -('.localhost'.length));
      const tenantSlug = normalizeTenantId(slug, '');
      if (tenantSlug && tenantSlug === slug && slug !== 'www') {
        return tenantSlug;
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
 * - salsa.ir / admin.salsa.ir -> Platform mode
 * - <slug>.salsa.ir -> Tenant subdomain mode
 * - <custom-domain> -> Custom domain lookup with white-label isolation
 */
function createDynamicTenantHostMiddleware({
  domainRoutingService,
  baseDomain = DEFAULT_PLATFORM_BASE_DOMAIN,
  trustForwardedHost = false,
  logger = console,
} = {}) {
  return async (req, res, next) => {
    const rawHost = trustForwardedHost && req.headers?.['x-forwarded-host']
      ? req.headers['x-forwarded-host']
      : req.headers?.host;
    const parsedHost = parseHostAuthority(rawHost);
    if (!parsedHost) {
      return res.status(421).json({ ok: false, error: 'invalid_host_header' });
    }
    const classification = classifyHost(parsedHost.authority, baseDomain);
    req.hostClassification = classification;

    if (classification.kind === 'unknown') {
      return res.status(421).json({ ok: false, error: 'invalid_host_header' });
    }

    // Platform Core Hub
    if (classification.isPlatform) {
      req.isPlatform = true;
      req.tenantId = 'platform';
      return next();
    }

    // Default Tenant Subdomain: <slug>.salsa.ir
    if (classification.isSubdomain) {
      // If tenant has an active primary custom domain with canonicalRedirect enabled, redirect 301
      if (domainRoutingService && typeof domainRoutingService.findPrimaryCustomDomainForTenant === 'function') {
        try {
          const primaryDomain = await domainRoutingService.findPrimaryCustomDomainForTenant(classification.slug);
          if (primaryDomain && primaryDomain.canonicalRedirect && primaryDomain.domain_name) {
            const proto = req.headers['x-forwarded-proto'] || (req.socket && req.socket.encrypted ? 'https' : 'http');
            const targetUrl = `${proto}://${primaryDomain.domain_name}${req.originalUrl || req.url || '/'}`;
            return res.redirect(301, targetUrl);
          }
        } catch (_err) {}
      }

      req.isSubdomain = true;
      req.tenantId = classification.slug;
      req.tenantSlug = classification.slug;
      req.isWhiteLabel = false;
      return next();
    }

    // Custom Domain: Lookup in domain routing service / DB
    if (classification.isCustom && domainRoutingService) {
      try {
        const resolved = await domainRoutingService.resolveHostToTenant(classification.hostname);
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
        message: `The domain '${rawHost}' is not connected to any active restaurant in the SALSA platform.`
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
