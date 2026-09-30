// server/salsa/control-plane/routes/governance-routes.js
'use strict';

const express = require('express');
const { authenticatePlatform, requirePlatformRole } = require('../auth/auth-middleware');
const approvalService = require('../governance/governance-approval-service');

function sendApprovalError(res, error) {
  const status = Number.isInteger(error?.httpStatus) ? error.httpStatus : 503;
  return res.status(status).json({
    ok: false,
    success: false,
    error: {
      code: error?.code || 'APPROVAL_STORAGE_UNAVAILABLE',
      message: status >= 500
        ? 'ذخیرهٔ پایدار تأیید ممکن نیست؛ تغییری ثبت نشده است. پس از بررسی اتصال دوباره وضعیت را بخوانید.'
        : error.message,
    },
  });
}

function createGovernanceRouter({ service = approvalService, authenticate = authenticatePlatform, requireRole = requirePlatformRole } = {}) {
  const router = express.Router();
  router.use(authenticate);

  router.post(
    '/approvals/request',
    requireRole(['platform_owner', 'platform_operations', 'platform_finance']),
    async (req, res) => {
      try {
        const { actionType, targetResource, reason, payload, metadata, expiresAt } = req.body || {};
        if (!actionType || !targetResource || !reason) {
          return res.status(400).json({
            ok: false,
            success: false,
            error: { code: 'MISSING_MANDATORY_FIELDS', message: 'actionType, targetResource, and reason are required.' },
          });
        }
        const request = await service.create({
          actionType,
          targetResource,
          reason,
          payload: payload === undefined ? {} : payload,
          metadata: metadata === undefined ? {} : metadata,
          expiresAt,
          actorId: req.platformPrincipal?.id,
          actorRole: req.platformPrincipal?.role,
          requestId: req.requestId || null,
        });
        return res.status(201).json({ ok: true, success: true, data: request });
      } catch (error) {
        return sendApprovalError(res, error);
      }
    },
  );

  router.get(
    '/approvals',
    requireRole(['platform_owner', 'platform_operations', 'platform_finance', 'platform_support', 'platform_readonly']),
    async (req, res) => {
      try {
        const result = await service.list({
          status: req.query.status || null,
          limit: req.query.limit === undefined ? 50 : Number(req.query.limit),
          offset: req.query.offset === undefined ? 0 : Number(req.query.offset),
          actorId: req.platformPrincipal?.id,
          actorRole: req.platformPrincipal?.role,
          requestId: req.requestId || null,
        });
        res.setHeader('X-Total-Count', String(result.total));
        res.setHeader('X-Has-More', String(result.hasMore));
        if (result.hasMore) res.setHeader('X-Next-Offset', String(result.offset + result.items.length));
        return res.json({ ok: true, success: true, data: result.items, pagination: result });
      } catch (error) {
        return sendApprovalError(res, error);
      }
    },
  );

  router.get(
    '/approvals/:id',
    requireRole(['platform_owner', 'platform_operations', 'platform_finance', 'platform_support', 'platform_readonly']),
    async (req, res) => {
      try {
        const request = await service.get({
          id: req.params.id,
          actorId: req.platformPrincipal?.id,
          actorRole: req.platformPrincipal?.role,
          requestId: req.requestId || null,
        });
        return res.json({ ok: true, success: true, data: request });
      } catch (error) {
        return sendApprovalError(res, error);
      }
    },
  );

  router.post(
    '/approvals/:id/confirm',
    requireRole(['platform_owner', 'platform_operations']),
    async (req, res) => {
      try {
        const request = await service.decide({
          id: req.params.id,
          decision: 'confirm',
          note: req.body?.note || '',
          actorId: req.platformPrincipal?.id,
          actorRole: req.platformPrincipal?.role,
          requestId: req.requestId || null,
        });
        return res.json({ ok: true, success: true, data: request });
      } catch (error) {
        return sendApprovalError(res, error);
      }
    },
  );

  router.post(
    '/approvals/:id/reject',
    requireRole(['platform_owner', 'platform_operations']),
    async (req, res) => {
      try {
        const request = await service.decide({
          id: req.params.id,
          decision: 'reject',
          note: req.body?.reason || '',
          actorId: req.platformPrincipal?.id,
          actorRole: req.platformPrincipal?.role,
          requestId: req.requestId || null,
        });
        return res.json({ ok: true, success: true, data: request });
      } catch (error) {
        return sendApprovalError(res, error);
      }
    },
  );

  return router;
}

module.exports = createGovernanceRouter();
module.exports.createGovernanceRouter = createGovernanceRouter;
module.exports.sendApprovalError = sendApprovalError;
