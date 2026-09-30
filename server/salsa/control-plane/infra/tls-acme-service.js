// server/salsa/control-plane/infra/tls-acme-service.js
'use strict';

const crypto = require('crypto');
const { getDatabase } = require('../db/database');
const { defaultCloudAdapter } = require('./iran-cloud-adapters');
const auditService = require('../audit/audit-service');

class TlsAcmeService {
  constructor() {
    this.db = getDatabase();
    this.cloudAdapter = defaultCloudAdapter;
  }

  async requestTlsCertificate(domainId, actorId = 'platform_system') {
    const fetchSql = 'SELECT * FROM neem_infrastructure_domains WHERE id = $1';
    const fetchRes = await this.db.query(fetchSql, [domainId]);
    const domain = fetchRes.rows[0];

    if (!domain) {
      throw new Error(`DOMAIN_NOT_FOUND: Domain '${domainId}' does not exist.`);
    }

    // Pre-flight check: DNS must be verified
    if (domain.dns_verification_status !== 'verified') {
      const errorMsg = `TLS_PREFLIGHT_FAILED: Cannot issue TLS certificate for '${domain.domain_name}' before DNS CNAME verification. Point CNAME to '${domain.expected_cname}' and verify DNS first.`;
      await this.db.query(
        `UPDATE neem_infrastructure_domains SET tls_status = 'failed', tls_error_reason = $1, updated_at = now() WHERE id = $2`,
        [errorMsg, domainId]
      );
      return {
        success: false,
        retryable: true,
        tlsStatus: 'failed',
        error: errorMsg
      };
    }

    // Request from Cloud ACME Provider
    const cert = await this.cloudAdapter.requestTlsCertificate({
      domain: domain.domain_name
    });

    const certId = 'cert_' + crypto.randomUUID().slice(0, 16);
    await this.db.query(
      `INSERT INTO neem_infrastructure_certificates
        (id, domain_id, provider, certificate_serial, valid_from, valid_until, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'active')`,
      [certId, domainId, cert.provider, cert.serial, cert.validFrom, cert.validUntil]
    );

    // Update domain status
    await this.db.query(
      `UPDATE neem_infrastructure_domains 
       SET tls_status = 'issued', tls_error_reason = null, updated_at = now() 
       WHERE id = $1`,
      [domainId]
    );

    await auditService.recordEvent({
      actorId,
      action: 'TLS_CERTIFICATE_ISSUED',
      targetType: 'domain',
      targetId: domainId,
      tenantId: domain.tenant_id,
      metadata: { serial: cert.serial, provider: cert.provider }
    });

    return {
      success: true,
      tlsStatus: 'issued',
      certificateSerial: cert.serial,
      validUntil: cert.validUntil
    };
  }
}

module.exports = new TlsAcmeService();
