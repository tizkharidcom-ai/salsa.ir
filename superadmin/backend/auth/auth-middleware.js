// server/salsa/control-plane/auth/auth-middleware.js
'use strict';

const crypto = require('crypto');
const config = require('../config');
const authService = require('./auth-service');

function extractToken(req) {
  if (!req || !req.headers) return null;
  const authHeader = req.headers.authorization;
  if (authHeader && typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }

  const cookieHeader = req.headers.cookie;
  if (cookieHeader && typeof cookieHeader === 'string') {
    const parts = cookieHeader.split(';');
    for (let i = 0; i < parts.length; i++) {
      const item = parts[i].trim();
      const eq = item.indexOf('=');
      const name = eq > 0 ? item.slice(0, eq).trim() : '';
      if (name === 'salsa_platform_token' || name === 'neem_platform_token') {
        const raw = item.slice(eq + 1).trim();
        try {
          return decodeURIComponent(raw);
        } catch {
          return raw;
        }
      }
    }
  }
  return null;
}

function isCookieAuthenticated(req) {
  return !req.headers.authorization && Boolean((req.headers.cookie || '').match(/(?:salsa|neem)_platform_token=([^;]+)/));
}

function expectedCsrfToken(sessionToken) {
  return crypto.createHmac('sha256', String(config.sessionSecret || ''))
    .update(String(sessionToken || ''))
    .digest('hex');
}

// 1. Strict Authentication Middleware
async function authenticatePlatform(req, res, next) {
  if (req.platformPrincipal) {
    return next();
  }

  // Reject Westo Restaurant identity cookies / headers explicitly
  const rawCookie = req.headers.cookie || '';
  if (rawCookie.includes('westo_session=') && !rawCookie.includes('salsa_platform_token=') && !rawCookie.includes('neem_platform_token=')) {
    return res.status(401).json({
      success: false,
      error: {
        code: 'RESTAURANT_IDENTITY_REJECTED',
        message: 'Restaurant identities (westo_session) are strictly prohibited on the SALSA Control Plane API.'
      }
    });
  }

  const token = extractToken(req);
  if (!token) {
    return res.status(401).json({
      success: false,
      error: {
        code: 'UNAUTHENTICATED',
        message: 'Authentication required. Missing platform bearer token or session cookie.'
      }
    });
  }

  try {
    const sessionContext = await authService.getSession(token);
    if (!sessionContext) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'SESSION_EXPIRED_OR_INVALID',
          message: 'The provided platform session token has expired or been revoked.'
        }
      });
    }

    req.platformSession = sessionContext.session;
    req.platformPrincipal = sessionContext.principal;
    req.sessionToken = token;
    req.platformAuthMode = isCookieAuthenticated(req) ? 'cookie' : 'bearer';

    // SameSite cookies are a useful browser control, but they are not the
    // complete mutation boundary. Cookie-authenticated state changes must also
    // carry a token derived from the current session; bearer integrations are
    // unaffected and remain suitable for service-to-service calls.
    if (req.platformAuthMode === 'cookie' && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const provided = String(req.headers['x-csrf-token'] || '');
      const expected = expectedCsrfToken(token);
      const providedBuf = Buffer.from(provided);
      const expectedBuf = Buffer.from(expected);
      if (providedBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(providedBuf, expectedBuf)) {
        return res.status(403).json({
          success: false,
          error: { code: 'CSRF_PROTECTION_FAILED', message: 'A valid session-bound CSRF token is required for cookie-authenticated mutations.' }
        });
      }
    }
    next();
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: {
        code: 'AUTH_PROCESSING_ERROR',
        message: 'Internal error validating session.'
      }
    });
  }
}

// 2. Strict Role-based Authorization Guard
const ROLE_ALIASES = {
  platform_owner: ['platform_owner', 'PlatformOwner'],
  PlatformOwner: ['platform_owner', 'PlatformOwner'],
  platform_admin: ['platform_admin', 'PlatformAdmin'],
  PlatformAdmin: ['platform_admin', 'PlatformAdmin'],
  platform_operations: ['platform_operations', 'OperationsOperator'],
  OperationsOperator: ['platform_operations', 'OperationsOperator'],
  platform_support: ['platform_support', 'SupportAgent'],
  SupportAgent: ['platform_support', 'SupportAgent'],
  platform_finance: ['platform_finance', 'FinanceOperator'],
  FinanceOperator: ['platform_finance', 'FinanceOperator'],
  platform_security: ['platform_security', 'SecurityAuditor'],
  SecurityAuditor: ['platform_security', 'SecurityAuditor'],
  platform_readonly: ['platform_readonly', 'ReadOnly'],
  ReadOnly: ['platform_readonly', 'ReadOnly']
};

function normalizeRoleKey(role) {
  if (!role) return '';
  const r = String(role).trim();
  if (r.toLowerCase() === 'platform_owner' || r.toLowerCase() === 'owner') return 'platform_owner';
  if (r.toLowerCase() === 'platform_admin' || r.toLowerCase() === 'admin') return 'platform_admin';
  if (r.toLowerCase() === 'platform_operations' || r.toLowerCase() === 'operationsoperator' || r.toLowerCase() === 'operations') return 'platform_operations';
  if (r.toLowerCase() === 'platform_support' || r.toLowerCase() === 'supportagent' || r.toLowerCase() === 'support') return 'platform_support';
  if (r.toLowerCase() === 'platform_finance' || r.toLowerCase() === 'financeoperator' || r.toLowerCase() === 'finance') return 'platform_finance';
  if (r.toLowerCase() === 'platform_security' || r.toLowerCase() === 'securityauditor' || r.toLowerCase() === 'security') return 'platform_security';
  if (r.toLowerCase() === 'platform_readonly' || r.toLowerCase() === 'readonly') return 'platform_readonly';
  return r.toLowerCase();
}

function requirePlatformRole(allowedRoles = []) {
  const normalizedAllowed = new Set(
    (Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles]).map(normalizeRoleKey)
  );

  return (req, res, next) => {
    if (!req.platformPrincipal) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'UNAUTHENTICATED',
          message: 'Authentication required before role verification.'
        }
      });
    }

    const principalRole = normalizeRoleKey(req.platformPrincipal.role);
    // platform_owner has universal access
    if (principalRole === 'platform_owner' || normalizedAllowed.has(principalRole)) {
      return next();
    }

    return res.status(403).json({
      success: false,
      error: {
        code: 'INSUFFICIENT_PLATFORM_PERMISSIONS',
        message: `Role '${req.platformPrincipal.role}' is not authorized for this resource. Requires one of: [${Array.from(normalizedAllowed).join(', ')}].`
      }
    });
  };
}

module.exports = {
  authenticatePlatform,
  requirePlatformRole,
  extractToken,
  expectedCsrfToken
};
