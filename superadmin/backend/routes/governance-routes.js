// server/salsa/control-plane/routes/governance-routes.js
// Four-Eyes Approval Mechanism & Multi-Operator Confirmation (Phases 81-84)
'use strict';

const express = require('express');
const crypto = require('crypto');
const { authenticatePlatform, requirePlatformRole } = require('../auth/auth-middleware');

const router = express.Router();

// Authenticated Endpoints
router.use(authenticatePlatform);

// In-memory store for platform governance approval requests
const approvalRequests = new Map();

/**
 * 1. Request Four-Eyes Approval for Irreversible Action
 * POST /api/control/governance/approvals/request
 */
router.post(
  '/approvals/request',
  requirePlatformRole(['platform_owner', 'platform_operations', 'platform_finance']),
  async (req, res) => {
    try {
      const { actionType, targetResource, reason, payload, metadata } = req.body || {};

      if (!actionType || !targetResource || !reason) {
        return res.status(400).json({
          ok: false,
          success: false,
          error: {
            code: 'MISSING_MANDATORY_FIELDS',
            message: 'actionType, targetResource, and reason are mandatory for four-eyes approval requests.'
          }
        });
      }

      const id = `appr_${crypto.randomUUID().slice(0, 8)}`;
      const request = {
        id,
        actionType,
        targetResource,
        reason,
        payload: payload || {},
        metadata: metadata || {},
        requestedBy: req.platformPrincipal?.id || 'operator',
        requestedByEmail: req.platformPrincipal?.email || 'operator@salsa.ir',
        requestedAt: new Date().toISOString(),
        status: 'pending',
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        confirmationsRequired: 1,
        confirmations: []
      };

      approvalRequests.set(id, request);

      return res.status(201).json({
        ok: true,
        success: true,
        data: request
      });
    } catch (err) {
      return res.status(500).json({ ok: false, success: false, error: err.message });
    }
  }
);

/**
 * 2. List Approval Requests
 * GET /api/control/governance/approvals
 */
router.get(
  '/approvals',
  requirePlatformRole(['platform_owner', 'platform_operations', 'platform_finance', 'platform_support', 'platform_readonly']),
  async (req, res) => {
    try {
      const statusFilter = req.query.status;
      let all = Array.from(approvalRequests.values());

      if (statusFilter) {
        all = all.filter(r => r.status === statusFilter);
      }

      // Sort newest first
      all.sort((a, b) => new Date(b.requestedAt) - new Date(a.requestedAt));

      const limit = req.query.limit ? parseInt(req.query.limit, 10) : null;
      const offset = req.query.offset ? parseInt(req.query.offset, 10) : (req.query.cursor ? parseInt(req.query.cursor, 10) : 0);
      let paged = all;
      let hasMore = false;
      let nextCursor = null;

      if (limit && Number.isInteger(limit) && limit > 0) {
        paged = all.slice(offset, offset + limit);
        hasMore = offset + limit < all.length;
        nextCursor = hasMore ? String(offset + limit) : null;
      }

      res.setHeader('X-Total-Count', String(all.length));
      if (limit) {
        res.setHeader('X-Has-More', String(hasMore));
        if (nextCursor) res.setHeader('X-Next-Cursor', nextCursor);
      }

      return res.json({
        ok: true,
        success: true,
        data: paged,
        pagination: {
          total: all.length,
          limit: limit || all.length,
          offset: offset || 0,
          cursor: req.query.cursor || null,
          hasMore,
          nextCursor
        }
      });
    } catch (err) {
      return res.status(500).json({ ok: false, success: false, error: err.message });
    }
  }
);

/**
 * 3. Get Single Approval Request
 * GET /api/control/governance/approvals/:id
 */
router.get(
  '/approvals/:id',
  requirePlatformRole(['platform_owner', 'platform_operations', 'platform_finance', 'platform_support', 'platform_readonly']),
  async (req, res) => {
    try {
      const request = approvalRequests.get(req.params.id);
      if (!request) {
        return res.status(404).json({
          ok: false,
          success: false,
          error: { code: 'APPROVAL_NOT_FOUND', message: `Approval request '${req.params.id}' not found.` }
        });
      }
      return res.json({ ok: true, success: true, data: request });
    } catch (err) {
      return res.status(500).json({ ok: false, success: false, error: err.message });
    }
  }
);

/**
 * 4. Confirm / Authorize (Four-Eyes Signature)
 * POST /api/control/governance/approvals/:id/confirm
 */
router.post(
  '/approvals/:id/confirm',
  requirePlatformRole(['platform_owner', 'platform_operations']),
  async (req, res) => {
    try {
      const request = approvalRequests.get(req.params.id);
      if (!request) {
        return res.status(404).json({
          ok: false,
          success: false,
          error: { code: 'APPROVAL_NOT_FOUND', message: `Approval request '${req.params.id}' not found.` }
        });
      }

      if (request.status !== 'pending') {
        return res.status(400).json({
          ok: false,
          success: false,
          error: { code: 'INVALID_STATUS', message: `Cannot confirm request with status '${request.status}'.` }
        });
      }

      if (new Date(request.expiresAt) < new Date()) {
        request.status = 'expired';
        return res.status(410).json({
          ok: false,
          success: false,
          error: { code: 'APPROVAL_EXPIRED', message: 'Approval request has expired.' }
        });
      }

      // STRICT FOUR-EYES PRINCIPLE: The initiator cannot approve their own request
      const currentActorId = req.platformPrincipal?.id;
      if (currentActorId && currentActorId === request.requestedBy) {
        return res.status(403).json({
          ok: false,
          success: false,
          error: {
            code: 'FOUR_EYES_VIOLATION',
            message: 'Strict Four-Eyes violation: The initiator of an irreversible platform action cannot confirm their own request.'
          }
        });
      }

      const confirmation = {
        confirmedBy: currentActorId || 'second_operator',
        confirmedByEmail: req.platformPrincipal?.email || 'security@salsa.ir',
        confirmedAt: new Date().toISOString(),
        note: req.body?.note || 'Four-eyes confirmation granted.'
      };

      request.confirmations.push(confirmation);
      request.status = 'approved';
      request.approvedAt = confirmation.confirmedAt;

      return res.json({
        ok: true,
        success: true,
        data: request
      });
    } catch (err) {
      return res.status(500).json({ ok: false, success: false, error: err.message });
    }
  }
);

/**
 * 5. Reject Approval Request
 * POST /api/control/governance/approvals/:id/reject
 */
router.post(
  '/approvals/:id/reject',
  requirePlatformRole(['platform_owner', 'platform_operations']),
  async (req, res) => {
    try {
      const request = approvalRequests.get(req.params.id);
      if (!request) {
        return res.status(404).json({
          ok: false,
          success: false,
          error: { code: 'APPROVAL_NOT_FOUND', message: `Approval request '${req.params.id}' not found.` }
        });
      }

      if (request.status !== 'pending') {
        return res.status(400).json({
          ok: false,
          success: false,
          error: { code: 'INVALID_STATUS', message: `Cannot reject request with status '${request.status}'.` }
        });
      }

      request.status = 'rejected';
      request.rejectedBy = req.platformPrincipal?.id || 'operator';
      request.rejectedAt = new Date().toISOString();
      request.rejectionReason = req.body?.reason || 'Rejected by operator.';

      return res.json({
        ok: true,
        success: true,
        data: request
      });
    } catch (err) {
      return res.status(500).json({ ok: false, success: false, error: err.message });
    }
  }
);

module.exports = router;
