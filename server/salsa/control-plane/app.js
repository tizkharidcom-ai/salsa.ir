// server/salsa/control-plane/app.js
'use strict';

const express = require('express');
const crypto = require('crypto');
const path = require('path');
const config = require('./config');

// Execute startup validation (fail-closed outside NODE_ENV=test)
config.validate();

const authRoutes = require('./routes/auth-routes');
const overviewRoutes = require('./routes/overview-routes');
const tenantRoutes = require('./routes/tenant-routes');
const tenantProvisioningRoutes = require('./routes/tenant-provisioning-routes');
const auditRoutes = require('./routes/audit-routes');
const policyRoutes = require('./routes/policy-routes');
const billingRoutes = require('./routes/billing-routes');
const automationRoutes = require('./routes/automation-routes');
const supportRoutes = require('./routes/support-routes');
const infraRoutes = require('./routes/infra-routes');
const edgeRoutes = require('./routes/edge-routes');
const backupRoutes = require('./routes/backup-routes');
const releaseRoutes = require('./routes/release-routes');
const metricsRoutes = require('./routes/metrics-routes');
const identityRoutes = require('./routes/identity-routes');
const integrationRoutes = require('./routes/integration-routes');
const contractRoutes = require('./routes/contract-routes');
const searchRoutes = require('./routes/search-routes');
const governanceRoutes = require('./routes/governance-routes');
const { defaultAutomationRunner } = require('./automation/automation-runner');
const { getDatabase } = require('./db/database');

const app = express();

// 1. Security & Standard Middlewares
app.disable('x-powered-by');
app.use(express.json({
  limit: '1mb',
  verify(req, _res, buffer) {
    req.rawBody = buffer.toString('utf8');
  }
}));
app.use(express.urlencoded({ extended: false }));

function sanitizePrototypeKeys(obj, seen = new WeakSet()) {
  if (!obj || typeof obj !== 'object') return;
  if (seen.has(obj)) return;
  seen.add(obj);
  for (const key of Object.getOwnPropertyNames(obj)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      delete obj[key];
    } else if (typeof obj[key] === 'object' && obj[key] !== null) {
      sanitizePrototypeKeys(obj[key], seen);
    }
  }
}

app.use((req, res, next) => {
  if (req.body) sanitizePrototypeKeys(req.body);
  if (req.query) sanitizePrototypeKeys(req.query);
  if (req.params) sanitizePrototypeKeys(req.params);
  next();
});

// Every mutation route receives one predictable body shape. Express leaves
// `req.body` undefined when a caller omits Content-Type/body, while several
// domain routes destructure fields immediately. Normalizing an absent body
// turns that case into the route's normal 4xx validation path; arrays and
// scalar JSON are rejected once at the boundary instead of producing 500s or
// surprising property lookups in individual handlers.
app.use((req, res, next) => {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  if (req.body == null || req.body === '') {
    req.body = {};
    return next();
  }
  if (typeof req.body !== 'object' || Array.isArray(req.body)) {
    return res.status(400).json({
      success: false,
      error: { code: 'INVALID_REQUEST_BODY', message: 'Request body must be a JSON object.' }
    });
  }
  return next();
});

// Security Headers & Request Correlation ID
app.use((req, res, next) => {
  const reqId = req.headers['x-request-id'] || crypto.randomUUID();
  req.requestId = reqId;
  res.setHeader('X-Request-Id', reqId);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https: blob:; font-src 'self' data: https:; connect-src 'self' https:; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'");
  res.setHeader('X-Platform-Scope', 'SALSA-CONTROL-PLANE');
  res.setHeader('X-Observed-At', new Date().toISOString());
  res.setHeader('X-Data-Freshness', 'live');
  res.setHeader('X-Resource-Version', '1.0');


  const origin = String(req.headers.origin || '');
  if (origin) {
    let host = '';
    try { host = new URL(origin).host; } catch (_) {}
    const isAllowed = !host ||
      host === 'salsa.ir' ||
      host.endsWith('.salsa.ir') ||
      host === 'neem.ir' ||
      host.endsWith('.neem.ir') ||
      host === 'localhost:3050' ||
      host === 'localhost:3061' ||
      host === '127.0.0.1:3050' ||
      host === '127.0.0.1:3061';

    if (isAllowed) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Request-Id, X-CSRF-Token, If-Match, Idempotency-Key, X-Salsa-Cell, X-Salsa-Control-Secret, X-Neem-Cell, X-Neem-Control-Secret');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }
  }

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  next();
});

// Record the response after the platform has made its decision. The exporter
// intentionally exposes only these counters and never derives operational
// health from a fixed fixture value.
app.use((req, res, next) => {
  res.on('finish', () => {
    metricsRoutes.harness?.recordHttpRequest({
      status: res.statusCode,
      cell: req.headers['x-salsa-cell'] || req.headers['x-neem-cell'] || 'cell-teh-01'
    });
  });
  next();
});

// 2. Health & Readiness Endpoint (Sanitized, no leaked environment variables)
app.get('/api/control/health', async (_req, res) => {
  const startedAt = Date.now();
  let database = { status: 'unreachable', latencyMs: null };
  try {
    await getDatabase().query('SELECT 1 AS ok');
    database = { status: 'healthy', latencyMs: Date.now() - startedAt };
  } catch (_error) {
    database = { status: 'unreachable', latencyMs: null };
  }
  const healthy = database.status === 'healthy';
  return res.status(healthy ? 200 : 503).json({
    success: healthy,
    data: {
      service: 'salsa-control-plane',
      status: healthy ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      // The console uses this capability flag before rendering the local
      // shortcut. The route itself remains fail-closed in production.
      devSessionAvailable: !config.isProduction && config.allowEphemeralDev,
      automation: defaultAutomationRunner.getStatus(),
      dependencies: { database }
    }
  });
});

// 2.1 Unified Operator Console (GM-01 to GM-29 unified in GODMODE on port 3050)
const godmodeRedirectUrl = process.env.SALSA_GODMODE_URL || process.env.SALSA_PROTOTYPE_URL || 'http://127.0.0.1:3050';
app.use('/console', (req, res) => {
  res.redirect(302, `${godmodeRedirectUrl}/`);
});


// 3. Mount Platform API Subsystems
app.use(metricsRoutes);
app.use('/api/control/auth', authRoutes);
app.use('/api/control/overview', overviewRoutes);
app.use('/api/control/tenants', tenantRoutes);
app.use('/api/control/provisioning', tenantProvisioningRoutes);
app.use('/api/control', tenantProvisioningRoutes);
app.use('/api/control/audit', auditRoutes);
app.use('/api/control/policy', policyRoutes);
app.use('/api/control/billing', billingRoutes);
app.use('/api/control/automation', automationRoutes);
app.use('/api/control/events', automationRoutes);
app.use('/api/control', automationRoutes);
app.use('/api/control/infra', infraRoutes);
app.use('/api/control/edge', edgeRoutes);
app.use('/api/control/backups', backupRoutes);
app.use('/api/control/identities', identityRoutes);
app.use('/api/control/integrations/westo', integrationRoutes);
app.use('/api/control/support', supportRoutes);
app.use('/api/control/data', supportRoutes);
app.use('/api/control', supportRoutes);
app.use('/api/control', releaseRoutes);
app.use('/api/control', contractRoutes);
app.use('/api/control/search', searchRoutes);
app.use('/api/control', searchRoutes);
app.use('/api/control/governance', governanceRoutes);
app.use('/api/control', governanceRoutes);

// 4. Fallback 404
app.use('/api/control', (req, res) => {
  return res.status(404).json({
    success: false,
    error: {
      code: 'CONTROL_ROUTE_NOT_FOUND',
      message: `The requested control plane route '${req.method} ${req.path}' does not exist.`
    }
  });
});

// 5. Global Error Handler
app.use((err, req, res, next) => {
  if (err?.type === 'entity.parse.failed' || (err instanceof SyntaxError && (err.status === 400 || err.statusCode === 400))) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'INVALID_JSON',
        message: 'Malformed JSON payload.'
      }
    });
  }
  const status = err.status || err.statusCode || 500;
  const error = {
    code: err.code || 'INTERNAL_SERVER_ERROR',
    message: err.message || 'An unexpected error occurred in SALSA Control Plane.'
  };
  // Readiness reports contain gate ids and evidence counts only; exposing them
  // lets an operator repair a blocked promotion without leaking credentials or
  // raw tenant data.
  if (err.readiness && typeof err.readiness === 'object') error.details = err.readiness;
  return res.status(status).json({
    success: false,
    error
  });
});

module.exports = app;
