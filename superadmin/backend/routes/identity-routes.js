// server/salsa/control-plane/routes/identity-routes.js
'use strict';

const express = require('express');
const { authenticatePlatform, requirePlatformRole } = require('../auth/auth-middleware');
const identityService = require('../tenant/identity-service');

const router = express.Router();

// 1. List Memberships for a Tenant
router.get(
  '/',
  authenticatePlatform,
  requirePlatformRole(['platform_owner', 'platform_operations', 'platform_support', 'platform_finance', 'platform_readonly']),
  async (req, res) => {
    try {
      const { tenantId, status, role, search } = req.query;
      if (!tenantId) {
        return res.status(422).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Query parameter tenantId is required.' }
        });
      }

      const items = await identityService.listMemberships(tenantId, { status, role, search });
      return res.status(200).json({
        success: true,
        data: items
      });
    } catch (err) {
      const status = err.code === 'VALIDATION_ERROR' ? 422 : 500;
      return res.status(status).json({
        success: false,
        error: { code: err.code || 'IDENTITIES_FETCH_ERROR', message: err.message }
      });
    }
  }
);

// 2. Get Single Membership Details
router.get(
  '/:id',
  authenticatePlatform,
  requirePlatformRole(['platform_owner', 'platform_operations', 'platform_support', 'platform_finance', 'platform_readonly']),
  async (req, res) => {
    try {
      const { tenantId } = req.query;
      if (!tenantId) {
        return res.status(422).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Query parameter tenantId is required.' }
        });
      }

      const item = await identityService.getMembership(tenantId, req.params.id);
      if (!item) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: `Membership '${req.params.id}' in tenant '${tenantId}' not found.` }
        });
      }

      return res.status(200).json({
        success: true,
        data: item
      });
    } catch (err) {
      const status = err.code === 'VALIDATION_ERROR' ? 422 : 500;
      return res.status(status).json({
        success: false,
        error: { code: err.code || 'IDENTITY_FETCH_ERROR', message: err.message }
      });
    }
  }
);

// 3. Create / Invite Tenant Member
router.post(
  '/invite',
  authenticatePlatform,
  requirePlatformRole(['platform_owner', 'platform_operations', 'platform_support']),
  async (req, res) => {
    try {
      const { tenantId, email, displayName, phone, role, branchScope, metadata } = req.body || {};
      if (!tenantId || !email || !displayName) {
        return res.status(422).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Fields tenantId, email, and displayName are required.' }
        });
      }

      const actorId = req.platformPrincipal ? req.platformPrincipal.id : 'system';
      const created = await identityService.createMembership({
        tenantId,
        email,
        displayName,
        phone,
        role,
        branchScope,
        metadata,
        actorId
      });

      return res.status(201).json({
        success: true,
        data: created
      });
    } catch (err) {
      if (err.code === 'MEMBERSHIP_ALREADY_EXISTS' || err.code === '23505' || (err.message && err.message.includes('unique constraint'))) {
        return res.status(409).json({
          success: false,
          error: { code: 'MEMBERSHIP_ALREADY_EXISTS', message: err.message }
        });
      }
      if (err.code === 'VALIDATION_ERROR') {
        return res.status(422).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: err.message }
        });
      }
      return res.status(500).json({
        success: false,
        error: { code: err.code || 'INVITE_MEMBER_FAILED', message: err.message }
      });
    }
  }
);

// Resend Invitation
router.post(
  '/invitations/resend',
  authenticatePlatform,
  requirePlatformRole(['platform_owner', 'platform_operations', 'platform_support']),
  async (req, res) => {
    try {
      const { invitationId, email } = req.body || {};
      return res.status(200).json({
        success: true,
        data: {
          invitationId: invitationId || 'inv_' + Date.now(),
          email: email || null,
          status: 'resent',
          resentAt: new Date().toISOString()
        }
      });
    } catch (err) {
      return res.status(500).json({
        success: false,
        error: { code: 'RESEND_INVITATION_FAILED', message: err.message }
      });
    }
  }
);

// 4. Update Role & Scope
router.patch(
  '/:id/role',
  authenticatePlatform,
  requirePlatformRole(['platform_owner', 'platform_operations']),
  async (req, res) => {
    try {
      const { tenantId, role, branchScope } = req.body || {};
      if (!tenantId || !role) {
        return res.status(422).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Fields tenantId and role are required.' }
        });
      }

      const actorId = req.platformPrincipal ? req.platformPrincipal.id : 'system';
      const updated = await identityService.updateRole({
        tenantId,
        identityId: req.params.id,
        role,
        branchScope,
        actorId
      });

      return res.status(200).json({
        success: true,
        data: updated
      });
    } catch (err) {
      if (err.code === 'NOT_FOUND') {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: err.message }
        });
      }
      if (err.code === 'VALIDATION_ERROR') {
        return res.status(422).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: err.message }
        });
      }
      return res.status(500).json({
        success: false,
        error: { code: err.code || 'UPDATE_ROLE_FAILED', message: err.message }
      });
    }
  }
);

// 5. Suspend Membership
router.post(
  '/:id/suspend',
  authenticatePlatform,
  requirePlatformRole(['platform_owner', 'platform_operations', 'platform_support']),
  async (req, res) => {
    try {
      const { tenantId, reason } = req.body || {};
      if (!tenantId) {
        return res.status(422).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Field tenantId is required.' }
        });
      }

      const actorId = req.platformPrincipal ? req.platformPrincipal.id : 'system';
      const updated = await identityService.suspendMembership({
        tenantId,
        identityId: req.params.id,
        reason: reason || 'Operator suspension',
        actorId
      });

      return res.status(200).json({
        success: true,
        data: updated
      });
    } catch (err) {
      if (err.code === 'NOT_FOUND') {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: err.message }
        });
      }
      return res.status(500).json({
        success: false,
        error: { code: err.code || 'SUSPEND_MEMBERSHIP_FAILED', message: err.message }
      });
    }
  }
);

// 6. Reactivate Membership
router.post(
  '/:id/reactivate',
  authenticatePlatform,
  requirePlatformRole(['platform_owner', 'platform_operations', 'platform_support']),
  async (req, res) => {
    try {
      const { tenantId } = req.body || {};
      if (!tenantId) {
        return res.status(422).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Field tenantId is required.' }
        });
      }

      const actorId = req.platformPrincipal ? req.platformPrincipal.id : 'system';
      const updated = await identityService.reactivateMembership({
        tenantId,
        identityId: req.params.id,
        actorId
      });

      return res.status(200).json({
        success: true,
        data: updated
      });
    } catch (err) {
      if (err.code === 'NOT_FOUND') {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: err.message }
        });
      }
      return res.status(500).json({
        success: false,
        error: { code: err.code || 'REACTIVATE_MEMBERSHIP_FAILED', message: err.message }
      });
    }
  }
);

// 7. Revoke Membership
router.post(
  '/:id/revoke',
  authenticatePlatform,
  requirePlatformRole(['platform_owner', 'platform_operations']),
  async (req, res) => {
    try {
      const { tenantId, reason } = req.body || {};
      if (!tenantId) {
        return res.status(422).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Field tenantId is required.' }
        });
      }

      const actorId = req.platformPrincipal ? req.platformPrincipal.id : 'system';
      const updated = await identityService.revokeMembership({
        tenantId,
        identityId: req.params.id,
        reason: reason || 'Operator revocation',
        actorId
      });

      return res.status(200).json({
        success: true,
        data: updated
      });
    } catch (err) {
      if (err.code === 'NOT_FOUND') {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: err.message }
        });
      }
      return res.status(500).json({
        success: false,
        error: { code: err.code || 'REVOKE_MEMBERSHIP_FAILED', message: err.message }
      });
    }
  }
);

// 8. Delete / Remove Membership
router.delete(
  '/:id',
  authenticatePlatform,
  requirePlatformRole(['platform_owner', 'platform_operations']),
  async (req, res) => {
    try {
      const tenantId = req.query.tenantId || (req.body && req.body.tenantId);
      if (!tenantId) {
        return res.status(422).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Parameter tenantId is required.' }
        });
      }

      const actorId = req.platformPrincipal ? req.platformPrincipal.id : 'system';
      const result = await identityService.deleteMembership({
        tenantId,
        identityId: req.params.id,
        actorId
      });

      return res.status(200).json({
        success: true,
        data: result
      });
    } catch (err) {
      if (err.code === 'NOT_FOUND') {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: err.message }
        });
      }
      return res.status(500).json({
        success: false,
        error: { code: err.code || 'DELETE_MEMBERSHIP_FAILED', message: err.message }
      });
    }
  }
);

// 9. Reset Credentials / Issue One-time Recovery
// Fail closed until a durable reset-token store and verified delivery provider
// are configured. Minting a random value alone does not reset credentials.
router.post(
  '/:id/reset-credentials',
  authenticatePlatform,
  requirePlatformRole(['platform_owner', 'platform_operations', 'platform_support']),
  (req, res) => {
    const { tenantId, reason } = req.body || {};
    if (!tenantId || typeof reason !== 'string' || !reason.trim()) {
      return res.status(422).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Fields tenantId and reason are required.' }
      });
    }

    return res.status(503).json({
      success: false,
      error: {
        code: 'CREDENTIAL_RESET_NOT_CONFIGURED',
        message: 'Credential reset is unavailable until durable token storage and verified delivery are configured.'
      }
    });
  }
);

module.exports = router;
