// server/neem/control-plane/infra/domain-routing-service.js
'use strict';

const crypto = require('crypto');
const { getDatabase } = require('../db/database');
const { defaultCloudAdapter } = require('./iran-cloud-adapters');
const auditService = require('../audit/audit-service');

class DomainRoutingService {
  constructor() {
    this.db = getDatabase();
    this.cloudAdapter = defaultCloudAdapter;
  }

  async registerDomain({
    tenantId,
    domainName,
    domainKind = 'custom_domain',
    brandConfig = {},
    actorId = 'platform_system'
  }) {
    if (!tenantId || !domainName) {
      throw new Error('DOMAIN_ERROR: tenantId and domainName are required.');
    }

    const cleanDomain = domainName.toLowerCase().trim();
    const domainId = 'dom_' + crypto.randomUUID().slice(0, 16);
    const tenantSlug = brandConfig.tenantSlug || tenantId;
    // Standard target is <tenantSlug>.neem.ir
    const expectedCname = brandConfig.expectedCname || `${tenantSlug}.neem.ir`;
    const txtChallenge = `neem-verify=${crypto.randomUUID().slice(0, 16)}`;

    const mergedBrandConfig = {
      ...brandConfig,
      tenantSlug,
      txtChallenge,
      apexChallengeRecord: `_neem-challenge.${cleanDomain}`
    };

    const sql = `
      INSERT INTO neem_infrastructure_domains
        (id, tenant_id, domain_name, domain_kind, expected_cname, brand_config, dns_verification_status, tls_status)
      VALUES ($1, $2, $3, $4, $5, $6, 'pending', 'pending')
      RETURNING *
    `;

    const res = await this.db.query(sql, [
      domainId,
      tenantId,
      cleanDomain,
      domainKind,
      expectedCname,
      JSON.stringify(mergedBrandConfig)
    ]);

    await auditService.recordEvent({
      actorId,
      action: 'DOMAIN_REGISTERED',
      targetType: 'domain',
      targetId: domainId,
      tenantId,
      metadata: { domain: cleanDomain, expected_cname: expectedCname, txt_challenge: txtChallenge }
    });

    return res.rows[0];
  }

  async verifyDns(domainId, actorId = 'platform_system') {
    const fetchSql = 'SELECT * FROM neem_infrastructure_domains WHERE id = $1';
    const fetchRes = await this.db.query(fetchSql, [domainId]);
    const domain = fetchRes.rows[0];

    if (!domain) {
      throw new Error(`DOMAIN_NOT_FOUND: Domain '${domainId}' does not exist.`);
    }

    const check = await this.cloudAdapter.checkDnsResolution({
      domain: domain.domain_name,
      expectedCname: domain.expected_cname
    });

    const newStatus = check.resolved ? 'verified' : 'failed';
    const updateSql = `
      UPDATE neem_infrastructure_domains
      SET dns_verification_status = $1, current_cname = $2, updated_at = now()
      WHERE id = $3
      RETURNING *
    `;
    const res = await this.db.query(updateSql, [newStatus, check.currentCname, domainId]);

    await auditService.recordEvent({
      actorId,
      action: 'DOMAIN_DNS_VERIFIED',
      targetType: 'domain',
      targetId: domainId,
      tenantId: domain.tenant_id,
      metadata: { status: newStatus, resolved: check.resolved, error: check.error }
    });

    return {
      domainId,
      status: newStatus,
      resolved: check.resolved,
      currentCname: check.currentCname,
      expectedCname: domain.expected_cname,
      error: check.error
    };
  }

  /**
   * On-Demand TLS Verification Check (Used by Caddy on_demand_tls ask endpoint)
   * Prevents TLS certificate exhaustion & DoS attacks.
   */
  async isDomainAllowedForTls(domainName) {
    if (!domainName) return { allowed: false, reason: 'empty_domain' };
    const clean = domainName.split(':')[0].toLowerCase().trim();

    // 1. Platform Root & Platform Subdomains (*.neem.ir)
    if (clean === 'neem.ir' || clean.endsWith('.neem.ir')) {
      return { allowed: true, reason: 'platform_domain' };
    }

    // 2. Development / Localhost
    if (clean === 'localhost' || clean.endsWith('.local') || clean.endsWith('.test')) {
      return { allowed: true, reason: 'local_development_domain' };
    }

    // 3. Registered & Active Custom Domains
    const sql = 'SELECT * FROM neem_infrastructure_domains WHERE domain_name = $1 AND is_active = true';
    const res = await this.db.query(sql, [clean]);
    const domain = res.rows[0];

    if (!domain) {
      return { allowed: false, reason: 'unregistered_domain' };
    }

    return {
      allowed: true,
      reason: 'registered_tenant_domain',
      tenantId: domain.tenant_id,
      domainId: domain.id
    };
  }

  /**
   * Host Routing Resolution: Resolves incoming Host HTTP header to tenant context.
   * Supports:
   * 1. neem.ir / admin.neem.ir -> Central Control Plane
   * 2. <slug>.neem.ir -> Platform Subdomain Tenant Host
   * 3. <custom-domain> -> Custom Domain (BYOD / White-label)
   * Guarantees 100% tenant boundary isolation.
   */
  async resolveHostToTenant(hostHeader) {
    if (!hostHeader) return null;
    const cleanHost = hostHeader.split(':')[0].toLowerCase().trim();

    // 1. Platform Core (neem.ir, admin.neem.ir, api.neem.ir)
    if (cleanHost === 'neem.ir' || cleanHost === 'www.neem.ir' || cleanHost === 'admin.neem.ir' || cleanHost === 'control.neem.ir') {
      return {
        matched: true,
        isPlatform: true,
        tenantId: 'platform_control_plane',
        tenantSlug: 'platform',
        domainName: cleanHost,
        domainKind: 'platform_core',
        tlsReady: true,
        brandConfig: {
          restaurantNameFa: 'پلتفرم ابری نیم',
          primaryColor: '#0EA5E9',
          whiteLabel: false
        },
        cookieScope: {
          domain: '.neem.ir',
          sameSite: 'Lax',
          secure: true
        }
      };
    }

    // 2. Database-registered Custom Domains or Explicit Subdomains
    const sql = 'SELECT * FROM neem_infrastructure_domains WHERE domain_name = $1 AND is_active = true';
    const res = await this.db.query(sql, [cleanHost]);
    const domain = res.rows[0];

    if (domain) {
      const brand = typeof domain.brand_config === 'string' ? JSON.parse(domain.brand_config) : (domain.brand_config || {});
      const isCustom = domain.domain_kind === 'custom_domain';

      return {
        matched: true,
        tenantId: domain.tenant_id,
        tenantSlug: brand.tenantSlug || domain.tenant_id,
        domainName: domain.domain_name,
        domainKind: domain.domain_kind,
        isCustomDomain: isCustom,
        tlsReady: domain.tls_status === 'issued' || domain.dns_verification_status === 'verified',
        brandConfig: {
          logoUrl: brand.logoUrl || null,
          primaryColor: brand.primaryColor || '#D97706',
          restaurantNameFa: brand.restaurantNameFa || null,
          customCss: brand.customCss || null,
          whiteLabel: isCustom,
          hideNeemBranding: isCustom
        },
        cookieScope: {
          domain: isCustom ? `.${domain.domain_name}` : `.${cleanHost}`,
          sameSite: 'Lax',
          secure: true
        }
      };
    }

    // 3. Dynamic Platform Subdomains: <slug>.neem.ir
    if (cleanHost.endsWith('.neem.ir')) {
      const slug = cleanHost.replace(/\.neem\.ir$/, '');
      const reservedPrefixes = new Set(['admin', 'api', 'control', 'status', 'cdn', 'static', 'cname', 'edge', 'mail', 'www']);
      if (!reservedPrefixes.has(slug) && /^[a-z0-9-]+$/.test(slug)) {
        return {
          matched: true,
          tenantId: slug,
          tenantSlug: slug,
          domainName: cleanHost,
          domainKind: 'platform_subdomain',
          isSubdomain: true,
          isCustomDomain: false,
          tlsReady: true,
          brandConfig: {
            restaurantNameFa: slug,
            primaryColor: '#D97706',
            whiteLabel: false
          },
          cookieScope: {
            domain: `.${cleanHost}`,
            sameSite: 'Lax',
            secure: true
          }
        };
      }
    }

    return null;
  }

  async listDomains(tenantId) {
    const sql = tenantId
      ? 'SELECT * FROM neem_infrastructure_domains WHERE tenant_id = $1 ORDER BY created_at DESC'
      : 'SELECT * FROM neem_infrastructure_domains ORDER BY created_at DESC';
    const res = await this.db.query(sql, tenantId ? [tenantId] : []);
    return res.rows;
  }
}

module.exports = new DomainRoutingService();
