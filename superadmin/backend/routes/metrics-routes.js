// server/salsa/control-plane/routes/metrics-routes.js
'use strict';

const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const config = require('../config');
const { authenticatePlatform, requirePlatformRole } = require('../auth/auth-middleware');
const { CapacityObservabilityHarness } = require('../observability/capacity-harness');

const harness = new CapacityObservabilityHarness();

function modelOnlyProvenance() {
  return {
    status: 'model_only',
    live: false,
    source: 'CapacityObservabilityHarness',
    captured_at: new Date().toISOString(),
    note: 'این خروجی مدل ظرفیت است و جایگزین telemetry بار زنده، SLA یا هزینهٔ واقعی نیست.'
  };
}

function verifyMetricsToken(req, res, next) {
  const configuredToken = config.metricsToken;
  if (!configuredToken) {
    return res.status(401).json({
      success: false,
      error: { code: 'METRICS_TOKEN_UNCONFIGURED', message: 'Metrics endpoint is secured and requires NEEM_METRICS_TOKEN.' }
    });
  }

  let providedToken = null;
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    providedToken = authHeader.slice(7).trim();
  } else if (req.headers['x-metrics-token']) {
    providedToken = String(req.headers['x-metrics-token']).trim();
  }

  if (!providedToken) {
    return res.status(401).json({
      success: false,
      error: { code: 'UNAUTHORIZED_METRICS_ACCESS', message: 'Valid metrics token required.' }
    });
  }

  const expectedBuf = Buffer.from(configuredToken);
  const providedBuf = Buffer.from(providedToken);
  if (expectedBuf.length !== providedBuf.length || !crypto.timingSafeEqual(expectedBuf, providedBuf)) {
    return res.status(401).json({
      success: false,
      error: { code: 'UNAUTHORIZED_METRICS_ACCESS', message: 'Invalid metrics token.' }
    });
  }

  next();
}

/**
 * GET /metrics
 * Standard Prometheus telemetry endpoint guarded by metrics token
 */
router.get('/metrics', verifyMetricsToken, (req, res) => {
  res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
  return res.status(200).send(harness.exportPrometheusMetrics());
});

/**
 * GET /api/control/capacity/topology
 * Guarded by platform_owner, platform_operations
 */
router.get(
  '/api/control/capacity/topology',
  authenticatePlatform,
  requirePlatformRole(['platform_owner', 'platform_operations']),
  (req, res) => {
    const count = parseInt(req.query.tenants || '900', 10);
    const result = harness.simulateTopologyPlacement(count);
    return res.status(200).json({
      success: true,
      data: { ...result, provenance: modelOnlyProvenance() }
    });
  }
);

/**
 * POST /api/control/capacity/evaluate-bulkhead
 * Guarded by platform_owner, platform_operations
 */
router.post(
  '/api/control/capacity/evaluate-bulkhead',
  authenticatePlatform,
  requirePlatformRole(['platform_owner', 'platform_operations']),
  (req, res) => {
    const { cell_id, normal_tenant_rps, noisy_tenant_rps, cell_max_connections } = req.body || {};
    const result = harness.evaluateNoisyNeighbourIsolation({
      cellId: cell_id || 'cell-teh-01',
      normalTenantRps: normal_tenant_rps || 10,
      noisyTenantRps: noisy_tenant_rps || 200,
      cellMaxConnections: cell_max_connections || 50
    });

    return res.status(200).json({
      success: true,
      data: { ...result, provenance: modelOnlyProvenance() }
    });
  }
);

module.exports = router;
module.exports.harness = harness;
