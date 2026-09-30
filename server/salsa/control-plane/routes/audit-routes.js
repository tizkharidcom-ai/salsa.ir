// server/salsa/control-plane/routes/audit-routes.js
'use strict';

const express = require('express');
const { authenticatePlatform, requirePlatformRole } = require('../auth/auth-middleware');
const auditService = require('../audit/audit-service');
const { defaultSiemExportService } = require('../audit/siem-export-service');

const router = express.Router();

router.get(
  '/',
  authenticatePlatform,
  requirePlatformRole(['platform_owner', 'platform_operations', 'platform_support']),
  async (req, res) => {
    try {
      const limit = Number(req.query.limit || 50);
      const tenantId = req.query.tenantId || null;
      const events = await auditService.listEvents({ limit, tenantId });

      return res.status(200).json({
        success: true,
        data: events
      });
    } catch (err) {
      return res.status(500).json({
        success: false,
        error: { code: 'AUDIT_FETCH_ERROR', message: err.message }
      });
    }
  }
);

router.post(
  '/siem/export',
  authenticatePlatform,
  requirePlatformRole(['platform_owner', 'platform_operations']),
  async (req, res) => {
    try {
      const result = await defaultSiemExportService.exportPending({
        limit: req.body?.limit,
        maxAttempts: req.body?.maxAttempts
      });
      return res.status(200).json({ success: true, data: result });
    } catch (err) {
      const status = err.code === 'SIEM_EXPORT_NOT_CONFIGURED' || err.code === 'SIEM_EXPORT_ENDPOINT_INSECURE'
        ? 503
        : err.code === 'SIEM_EXPORT_HTTP_ERROR' ? 502 : 500;
      return res.status(status).json({
        success: false,
        error: { code: err.code || 'SIEM_EXPORT_FAILED', message: err.message }
      });
    }
  }
);

module.exports = router;
