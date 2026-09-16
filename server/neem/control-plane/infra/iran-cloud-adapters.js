// server/neem/control-plane/infra/iran-cloud-adapters.js
'use strict';

const crypto = require('crypto');

class BaseIranCloudAdapter {
  constructor(providerCode) {
    this.providerCode = providerCode;
  }

  async createDnsRecord({ zone, recordType, name, value, ttl = 300 }) {
    throw new Error('Not implemented');
  }

  async checkDnsResolution({ domain, expectedCname }) {
    throw new Error('Not implemented');
  }

  async requestTlsCertificate({ domain, validationMethod = 'dns-01' }) {
    throw new Error('Not implemented');
  }

  async getCertificateStatus({ certId }) {
    throw new Error('Not implemented');
  }
}

/**
 * AbrArvan Cloud Adapter (Simulated / Integration Harness)
 */
class AbrArvanAdapter extends BaseIranCloudAdapter {
  constructor() {
    super('abr_arvan');
    this.dnsRecords = new Map();
    this.certificates = new Map();
  }

  async createDnsRecord({ zone, recordType = 'CNAME', name, value, ttl = 300 }) {
    const recordId = 'arvan_rec_' + crypto.randomUUID().slice(0, 12);
    const key = `${name}.${zone}`.toLowerCase();
    const record = {
      id: recordId,
      zone,
      recordType,
      name,
      value,
      ttl,
      status: 'active',
      createdAt: new Date().toISOString()
    };
    this.dnsRecords.set(key, record);
    return record;
  }

  async checkDnsResolution({ domain, expectedCname }) {
    const key = domain.toLowerCase();
    const record = this.dnsRecords.get(key);

    if (!record) {
      return {
        resolved: false,
        domain,
        currentCname: null,
        expectedCname,
        error: `DNS_RESOLUTION_FAILED: No CNAME record found for '${domain}'. Point your DNS to '${expectedCname}'.`
      };
    }

    const val = record.value.toLowerCase().replace(/\.$/, '');
    const exp = expectedCname.toLowerCase().replace(/\.$/, '');
    const valSlug = val.split('.')[0];
    const expSlug = exp.split('.')[0];
    const matches = (val === exp) || (Boolean(valSlug) && valSlug === expSlug && (val.endsWith('.neem.ir') || val.endsWith('.cells.neem.ir')) && (exp.endsWith('.neem.ir') || exp.endsWith('.cells.neem.ir')));
    return {
      resolved: matches,
      domain,
      currentCname: record.value,
      expectedCname,
      error: matches ? null : `CNAME_MISMATCH: Resolved to '${record.value}', but expected '${expectedCname}'.`
    };
  }

  async requestTlsCertificate({ domain, validationMethod = 'dns-01' }) {
    const certId = 'arvan_cert_' + crypto.randomUUID().slice(0, 16);
    const serial = 'SN_' + crypto.randomBytes(8).toString('hex').toUpperCase();

    const certRecord = {
      certId,
      domain,
      provider: 'abr_arvan',
      serial,
      status: 'issued',
      validFrom: new Date().toISOString(),
      validUntil: new Date(Date.now() + 90 * 86400 * 1000).toISOString() // 90 days ACME
    };

    this.certificates.set(certId, certRecord);
    return certRecord;
  }

  async getCertificateStatus({ certId }) {
    return this.certificates.get(certId) || null;
  }

  reset() {
    this.dnsRecords.clear();
    this.certificates.clear();
  }
}

module.exports = {
  BaseIranCloudAdapter,
  AbrArvanAdapter,
  defaultCloudAdapter: new AbrArvanAdapter()
};
