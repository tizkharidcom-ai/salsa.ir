'use strict';

const { requireTenantId } = require('../../tenant-context');
const provisioningRunner = require('./provisioning-runner');

const MANAGEMENT_ROLES = new Set(['platform_owner', 'platform_operations']);

/**
 * Management-only boundary for tenant provisioning. The pipeline engine stays
 * behind this service so public/restaurant routes cannot invoke provisioning
 * by passing a tenant id or a browser-controlled header.
 */
class ProvisioningService {
  constructor({ runner = provisioningRunner } = {}) {
    this.runner = runner;
  }

  async provisionFromManagement({ principal, request = {} } = {}) {
    const role = String(principal?.role || '').trim().toLowerCase();
    if (!principal?.id || !MANAGEMENT_ROLES.has(role)) {
      const error = new Error('PROVISIONING_MANAGEMENT_AUTH_REQUIRED: provisioning is restricted to platform management roles.');
      error.code = 'PROVISIONING_MANAGEMENT_AUTH_REQUIRED';
      throw error;
    }

    let tenantId;
    try {
      tenantId = requireTenantId(request.tenantId);
    } catch (error) {
      error.code = 'VALIDATION_ERROR';
      throw error;
    }
    const displayName = String(request.displayName || '').trim();
    const ownerEmail = String(request.ownerEmail || '').trim().toLowerCase();
    if (!displayName || !ownerEmail) {
      const error = new Error('VALIDATION_ERROR: tenantId, displayName, and ownerEmail are required.');
      error.code = 'VALIDATION_ERROR';
      throw error;
    }

    return this.runner.startProvisioningJob({
      ...request,
      tenantId,
      displayName,
      ownerEmail,
      initiatedBy: principal.id,
    });
  }
}

const provisioningService = new ProvisioningService();
provisioningService.ProvisioningService = ProvisioningService;
provisioningService.MANAGEMENT_ROLES = MANAGEMENT_ROLES;

module.exports = provisioningService;
