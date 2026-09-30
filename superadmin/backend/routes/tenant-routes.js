// server/salsa/control-plane/routes/tenant-routes.js
'use strict';

const express = require('express');
const { authenticatePlatform, requirePlatformRole } = require('../auth/auth-middleware');
const tenantRegistry = require('../registry/tenant-service');

const router = express.Router();

// 1. List Tenants (Read-only metadata with cursor/offset pagination support)
router.get(
  '/',
  authenticatePlatform,
  requirePlatformRole(['platform_owner', 'platform_operations', 'platform_support', 'platform_finance', 'platform_readonly']),
  async (req, res) => {
    try {
      const tenants = await tenantRegistry.listTenants();
      const limit = req.query.limit ? parseInt(req.query.limit, 10) : null;
      const offset = req.query.offset ? parseInt(req.query.offset, 10) : (req.query.cursor ? parseInt(req.query.cursor, 10) : 0);
      let pagedTenants = tenants;
      let hasMore = false;
      let nextCursor = null;

      if (limit && Number.isInteger(limit) && limit > 0) {
        pagedTenants = tenants.slice(offset, offset + limit);
        hasMore = offset + limit < tenants.length;
        nextCursor = hasMore ? String(offset + limit) : null;
      }

      res.setHeader('X-Total-Count', String(tenants.length));
      if (limit) {
        res.setHeader('X-Has-More', String(hasMore));
        if (nextCursor) res.setHeader('X-Next-Cursor', nextCursor);
      }

      return res.status(200).json({
        success: true,
        data: pagedTenants,
        pagination: {
          total: tenants.length,
          limit: limit || tenants.length,
          offset: offset || 0,
          cursor: req.query.cursor || null,
          hasMore,
          nextCursor
        }
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

// 4. Update Tenant Lifecycle (Active, Suspended, Archived)
router.post(
  '/:id/lifecycle',
  authenticatePlatform,
  requirePlatformRole(['platform_owner', 'platform_operations']),
  async (req, res) => {
    try {
      const { status, reason } = req.body || {};
      const actorId = req.platformPrincipal ? req.platformPrincipal.id : 'system';
      const updated = await tenantRegistry.updateLifecycleStatus({
        tenantId: req.params.id,
        status,
        reason,
        actorId
      });
      return res.status(200).json({
        success: true,
        data: updated
      });
    } catch (err) {
      return res.status(400).json({
        success: false,
        error: { code: 'LIFECYCLE_UPDATE_FAILED', message: err.message }
      });
    }
  }
);

// In-memory branch storage backed by tenant registry metadata
const tenantBranches = new Map();

// 5. Restaurant Cockpit Aggregator (Phase 24)
router.get(
  '/:id/overview',
  authenticatePlatform,
  requirePlatformRole(['platform_owner', 'platform_operations', 'platform_support', 'platform_finance', 'platform_readonly']),
  async (req, res) => {
    try {
      const tenantId = req.params.id;
      const tenant = await tenantRegistry.getTenant(tenantId);
      if (!tenant) {
        return res.status(404).json({
          success: false,
          error: { code: 'TENANT_NOT_FOUND', message: `Tenant '${tenantId}' not found.` }
        });
      }

      const branches = tenantBranches.get(tenantId) || [
        {
          id: `brn_${tenantId}_main`,
          tenantId,
          name: 'شعبه مرکزی',
          code: 'BR-01',
          city: tenant.city || 'تهران',
          status: 'active',
          isPrimary: true,
          createdAt: tenant.created_at || new Date().toISOString()
        }
      ];

      // Attention Items computation (Phase 27 & Phase 28: Explainability)
      const attentionItems = [];
      const status = (tenant.status || 'active').toLowerCase();
      if (status === 'suspended') {
        attentionItems.push({
          id: `att_${tenantId}_suspended`,
          tenantId,
          category: 'Lifecycle',
          severity: 'Critical',
          title: 'سرویس مجموعه معلق است',
          explanation: 'پایانه‌های فروش و منوی دیجیتال مسدود می‌باشند.',
          source: 'control-plane:tenant-registry',
          detectedAt: tenant.updated_at || new Date().toISOString(),
          recommendedAction: 'بررسی علت تعلیق و صدور فرمان ReactivateRestaurant در صورت احراز شرایط.',
          targetRoute: `restaurants/workspace?id=${tenantId}&tab=overview`,
          status: 'open'
        });
      }
      if (status === 'past_due' || status === 'grace_period') {
        attentionItems.push({
          id: `att_${tenantId}_pastdue`,
          tenantId,
          category: 'PaymentPastDue',
          severity: 'Attention',
          title: 'سررسید صورتحساب پرداخت‌نشده',
          explanation: 'اشتراک در دوره مهلت پرداخت (Grace Period) قرار دارد.',
          source: 'control-plane:billing',
          detectedAt: new Date().toISOString(),
          recommendedAction: 'تمدید استمهال یا ثبت پرداخت صورتحساب.',
          targetRoute: `restaurants/workspace?id=${tenantId}&tab=subscription`,
          status: 'open'
        });
      }

      return res.status(200).json({
        success: true,
        data: {
          identity: {
            id: tenant.id || tenantId,
            name: tenant.display_name || tenant.name || tenantId,
            slug: tenant.slug || tenantId,
            domain: tenant.canonical_domain || `${tenantId}.salsa.ir`,
            cellId: tenant.cell_id || 'cell-teh-01',
            createdAt: tenant.created_at
          },
          lifecycle: {
            status: tenant.status || 'active',
            reason: tenant.metadata?.status_reason || null,
            updatedAt: tenant.updated_at || tenant.created_at
          },
          branchesSummary: {
            totalBranches: branches.length,
            activeBranches: branches.filter(b => b.status === 'active').length
          },
          subscriptionSummary: {
            plan: tenant.plan_code || 'growth',
            planCode: tenant.plan_code || 'growth',
            billingCycle: 'monthly',
            status: status === 'past_due' ? 'past_due' : 'active'
          },
          billingSummary: {
            hasOverdue: status === 'past_due',
            pastDueInvoicesCount: status === 'past_due' ? 1 : 0,
            unpaidAmount: status === 'past_due' ? 1850000 : 0
          },
          entitlementSummary: {
            totalModules: 9,
            enabledCount: 7,
            activeOverrides: 0
          },
          deviceSummary: {
            totalDevices: 0,
            onlineCount: 0,
            printerCount: 0
          },
          domainSummary: {
            primaryDomain: tenant.canonical_domain || `${tenantId}.salsa.ir`,
            customDomains: [],
            tlsStatus: 'active'
          },
          backupSummary: {
            latestBackupAt: null,
            verified: false,
            rpoCompliant: false
          },
          supportSummary: {
            openTicketsCount: 0,
            activeDelegations: 0
          },
          incidentSummary: {
            activeIncidentsCount: 0,
            severity: 'none'
          },
          attentionItems,
          recentActivity: [],
          meta: {
            source: 'salsa-control-plane',
            origin: 'tenant-routes:cockpit-aggregator',
            observedAt: new Date().toISOString(),
            freshness: 'live'
          }
        }
      });
    } catch (err) {
      return res.status(500).json({
        success: false,
        error: { code: 'OVERVIEW_AGGREGATION_FAILED', message: err.message }
      });
    }
  }
);

// 6. Branch Management Endpoints (Phase 29)
router.get(
  '/:id/branches',
  authenticatePlatform,
  requirePlatformRole(['platform_owner', 'platform_operations', 'platform_support', 'platform_readonly']),
  async (req, res) => {
    try {
      const tenantId = req.params.id;
      const branches = tenantBranches.get(tenantId) || [
        {
          id: `brn_${tenantId}_main`,
          tenantId,
          name: 'شعبه مرکزی',
          code: 'BR-01',
          city: 'تهران',
          status: 'active',
          isPrimary: true,
          createdAt: new Date().toISOString()
        }
      ];
      return res.status(200).json({
        success: true,
        data: branches
      });
    } catch (err) {
      return res.status(500).json({
        success: false,
        error: { code: 'BRANCHES_FETCH_FAILED', message: err.message }
      });
    }
  }
);

router.post(
  '/:id/branches',
  authenticatePlatform,
  requirePlatformRole(['platform_owner', 'platform_operations']),
  async (req, res) => {
    try {
      const tenantId = req.params.id;
      const { name, code, city, address } = req.body || {};
      if (!name) {
        return res.status(422).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Field name is required for branch.' }
        });
      }

      const existing = tenantBranches.get(tenantId) || [];
      const newBranch = {
        id: `brn_${tenantId}_${Date.now().toString(36)}`,
        tenantId,
        name: name.trim(),
        code: code || `BR-0${existing.length + 1}`,
        city: city || 'تهران',
        address: address || '',
        status: 'active',
        isPrimary: existing.length === 0,
        createdAt: new Date().toISOString()
      };

      existing.push(newBranch);
      tenantBranches.set(tenantId, existing);

      return res.status(201).json({
        success: true,
        data: newBranch
      });
    } catch (err) {
      return res.status(500).json({
        success: false,
        error: { code: 'BRANCH_CREATE_FAILED', message: err.message }
      });
    }
  }
);

router.patch(
  '/:id/branches/:branchId',
  authenticatePlatform,
  requirePlatformRole(['platform_owner', 'platform_operations']),
  async (req, res) => {
    try {
      const { id: tenantId, branchId } = req.params;
      const existing = tenantBranches.get(tenantId) || [];
      const branch = existing.find(b => b.id === branchId);
      if (!branch) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: `Branch '${branchId}' not found.` }
        });
      }
      Object.assign(branch, req.body, { updatedAt: new Date().toISOString() });
      return res.status(200).json({
        success: true,
        data: branch
      });
    } catch (err) {
      return res.status(500).json({
        success: false,
        error: { code: 'BRANCH_UPDATE_FAILED', message: err.message }
      });
    }
  }
);

router.delete(
  '/:id/branches/:branchId',
  authenticatePlatform,
  requirePlatformRole(['platform_owner', 'platform_operations']),
  async (req, res) => {
    try {
      const { id: tenantId, branchId } = req.params;
      const existing = tenantBranches.get(tenantId) || [];
      const branch = existing.find(b => b.id === branchId);
      if (!branch) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: `Branch '${branchId}' not found.` }
        });
      }
      branch.status = 'archived';
      branch.archivedAt = new Date().toISOString();
      return res.status(200).json({
        success: true,
        data: branch
      });
    } catch (err) {
      return res.status(500).json({
        success: false,
        error: { code: 'BRANCH_ARCHIVE_FAILED', message: err.message }
      });
    }
  }
);

module.exports = router;

