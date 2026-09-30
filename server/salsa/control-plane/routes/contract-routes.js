'use strict';

const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const { authenticatePlatform, requirePlatformRole } = require('../auth/auth-middleware');

const router = express.Router();
const DEFAULT_OPENAPI_PATH = path.resolve(__dirname, '../../../../docs/salsa/contracts/openapi.json');
const READ_ROLES = ['platform_owner', 'platform_operations', 'platform_support', 'platform_finance', 'platform_readonly'];

function openApiPath() {
  const configured = process.env.NEEM_OPENAPI_CONTRACT_PATH;
  if (!configured) return DEFAULT_OPENAPI_PATH;
  return path.isAbsolute(configured) ? configured : path.resolve(process.cwd(), configured);
}

function sendOpenApi(_req, res) {
  try {
    const document = JSON.parse(fs.readFileSync(openApiPath(), 'utf8'));
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-NEEM-Contract-Status', document.info?.['x-neem-contract-status'] || 'unknown');
    return res.status(200).json({
      success: true,
      data: document
    });
  } catch (error) {
    return res.status(503).json({
      success: false,
      error: {
        code: 'OPENAPI_CONTRACT_UNAVAILABLE',
        message: 'The inventory-derived API contract is not available on this Control Plane instance.'
      }
    });
  }
}

router.get('/openapi.json', authenticatePlatform, requirePlatformRole(READ_ROLES), sendOpenApi);
router.get('/openapi', authenticatePlatform, requirePlatformRole(READ_ROLES), sendOpenApi);

module.exports = router;
