// server/neem/control-plane/routes/tenant-routes.js
'use strict';

const express = require('express');
const { authenticatePlatform, requirePlatformRole } = require('../auth/auth-middleware');
const tenantRegistry = require('../registry/tenant-service');

const router = express.Router();

// 1. List Tenants (Read-only metadata)
router.get(
  '/',
  authenticatePlatform,
  requirePlatformRole(['platform_owner', 'platform_operations', 'platform_support', 'platform_finance', 'platform_readonly']),
  async (req, res) => {
    try {
      const tenants = await tenantRegistry.listTenants();
      return res.status(200).json({
        success: true,
        data: tenants
      });
    } catch (err) {
      return res.status(500).json({
        success: false,
        error: { code: 'TENANTS_FETCH_ERROR', message: err.message }
      });
    }
  }
);

// 2. Get Single Tenant Detail
router.get(
  '/:id',
  authenticatePlatform,
  requirePlatformRole(['platform_owner', 'platform_operations', 'platform_support', 'platform_finance', 'platform_readonly']),
  async (req, res) => {
    try {
      const tenant = await tenantRegistry.getTenant(req.params.id);
      if (!tenant) {
        return res.status(404).json({
          success: false,
          error: { code: 'TENANT_NOT_FOUND', message: `Tenant '${req.params.id}' not found.` }
        });
      }
      return res.status(200).json({
        success: true,
        data: tenant
      });
    } catch (err) {
      return res.status(500).json({
        success: false,
        error: { code: 'TENANT_FETCH_ERROR', message: err.message }
      });
    }
  }
);

// 3. Register Draft Tenant (Metadata Only, No Live DB / Provisioning)
router.post(
  '/',
  authenticatePlatform,
  requirePlatformRole(['platform_owner', 'platform_operations']),
  async (req, res) => {
    try {
      const { tenantId, displayName, planCode, cellId, canonicalDomain, metadata } = req.body || {};
      const actorId = req.platformPrincipal.id;

      const created = await tenantRegistry.createDraftTenant({
        tenantId,
        displayName,
        planCode,
        cellId,
        canonicalDomain,
        metadata,
        actorId
      });

      return res.status(201).json({
        success: true,
        data: created
      });
    } catch (err) {
      return res.status(400).json({
        success: false,
        error: { code: 'TENANT_CREATION_FAILED', message: err.message }
      });
    }
  }
);

module.exports = router;
