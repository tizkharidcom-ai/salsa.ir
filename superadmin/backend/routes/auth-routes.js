// server/salsa/control-plane/routes/auth-routes.js
'use strict';

const express = require('express');
const crypto = require('crypto');
const authService = require('../auth/auth-service');
const { authenticatePlatform, requirePlatformRole } = require('../auth/auth-middleware');
const config = require('../config');

const router = express.Router();

function getClientIp(req) {
  return req.ip || req.socket?.remoteAddress || req.connection?.remoteAddress || '127.0.0.1';
}

// Helper to set secure platform session cookie
function setSessionCookie(res, token) {
  const isSecure = config.isProduction;
  const salsaCookieOpts = [
    `salsa_platform_token=${encodeURIComponent(token)}`,
    'HttpOnly',
    'SameSite=Strict',
    'Path=/api/control',
    `Max-Age=${config.sessionTtlHours * 3600}`
  ];
  const neemCookieOpts = [
    `neem_platform_token=${encodeURIComponent(token)}`,
    'HttpOnly',
    'SameSite=Strict',
    'Path=/api/control',
    `Max-Age=${config.sessionTtlHours * 3600}`
  ];
  if (isSecure) {
    salsaCookieOpts.push('Secure');
    neemCookieOpts.push('Secure');
  }
  const csrfToken = crypto.createHmac('sha256', String(config.sessionSecret || ''))
    .update(String(token))
    .digest('hex');
  res.setHeader('Set-Cookie', [
    salsaCookieOpts.join('; '),
    neemCookieOpts.join('; '),
    `salsa_platform_csrf=${csrfToken}; SameSite=Strict; Path=/${isSecure ? '; Secure' : ''}`,
    `neem_platform_csrf=${csrfToken}; SameSite=Strict; Path=/${isSecure ? '; Secure' : ''}`
  ]);
}

function sessionCsrfToken(token) {
  return crypto.createHmac('sha256', String(config.sessionSecret || ''))
    .update(String(token || ''))
    .digest('hex');
}

// Browser production sessions are cookie-only. Returning the bearer secret in
// JSON would expose it to any script running in the console origin and defeat
// the HttpOnly boundary. Tests and explicit non-production integrations keep
// the legacy token field for compatibility.
function publicSessionResult(result) {
  if (!config.isProduction) return result;
  const { sessionToken: _secret, ...safeResult } = result;
  if (result.sessionToken) safeResult.csrfToken = sessionCsrfToken(result.sessionToken);
  return safeResult;
}

// 1. One-time Owner Bootstrap
router.post('/bootstrap-owner', async (req, res) => {
  try {
    const { email, fullName, password, bootstrapSecret } = req.body || {};
    const clientIp = getClientIp(req);
    const userAgent = req.headers['user-agent'];

    const result = await authService.bootstrapOwner({
      email,
      fullName,
      password,
      bootstrapSecret,
      clientIp,
      userAgent
    });

    return res.status(201).json({
      success: true,
      data: {
        message: 'Platform owner successfully bootstrapped.',
        principalId: result.principalId,
        email: result.email,
        totpSecret: result.totpSecret,
        recoveryCodes: result.recoveryCodes
      }
    });
  } catch (err) {
    const status = err.message.includes('FORBIDDEN') ? 403 : 400;
    return res.status(status).json({
      success: false,
      error: { code: 'BOOTSTRAP_ERROR', message: err.message }
    });
  }
});

// 2. Platform Login (Step 1: Credentials -> MFA Challenge)
router.post('/login', async (req, res) => {
  try {
    const { email, username, password } = req.body || {};
    const clientIp = getClientIp(req);
    const userAgent = req.headers['user-agent'];
    const requestId = req.headers['x-request-id'] || null;

    const result = await authService.login({
      email: email || username,
      password,
      clientIp,
      userAgent,
      requestId
    });

    return res.status(200).json({
      success: true,
      data: {
        ...publicSessionResult(result),
        // Canonical browser contract. Keep the legacy names during the
        // transition so service clients do not break during deployment.
        mfaRequired: Boolean(result.requireMfa),
        challengeTicket: result.mfaToken || null
      }
    });
  } catch (err) {
    return res.status(401).json({
      success: false,
      error: { code: 'AUTHENTICATION_FAILED', message: err.message }
    });
  }
});

// 3. MFA Verification (Step 2: TOTP Code -> Session Token)
router.post('/mfa/verify', async (req, res) => {
  try {
    const { mfaToken, challengeTicket, totpCode, token } = req.body || {};
    const clientIp = getClientIp(req);
    const userAgent = req.headers['user-agent'];
    const requestId = req.headers['x-request-id'] || null;

    const result = await authService.verifyMfa({
      mfaToken: mfaToken || challengeTicket,
      totpCode: totpCode || token,
      clientIp,
      userAgent,
      requestId
    });

    setSessionCookie(res, result.sessionToken);

    return res.status(200).json({
      success: true,
      data: publicSessionResult(result)
    });
  } catch (err) {
    return res.status(401).json({
      success: false,
      error: { code: 'MFA_FAILED', message: err.message }
    });
  }
});

// 4. MFA Recovery Code Usage
router.post('/mfa/recovery', async (req, res) => {
  try {
    const { mfaToken, recoveryCode } = req.body || {};
    const clientIp = getClientIp(req);
    const userAgent = req.headers['user-agent'];
    const requestId = req.headers['x-request-id'] || null;

    const result = await authService.useRecoveryCode({
      mfaToken,
      recoveryCode,
      clientIp,
      userAgent,
      requestId
    });

    setSessionCookie(res, result.sessionToken);

    return res.status(200).json({
      success: true,
      data: publicSessionResult(result)
    });
  } catch (err) {
    return res.status(401).json({
      success: false,
      error: { code: 'RECOVERY_FAILED', message: err.message }
    });
  }
});

// 5. Current Session Profile (Protected)
router.get('/session', authenticatePlatform, (req, res) => {
  const { password_hash, ...safePrincipal } = req.platformPrincipal || {};
  return res.status(200).json({
    success: true,
    data: {
      principal: safePrincipal,
      session: {
        id: req.platformSession.id,
        expiresAt: req.platformSession.expires_at,
        csrfToken: sessionCsrfToken(req.sessionToken)
      }
    }
  });
});

// 6. Logout / Session Revocation (Protected)
router.post('/logout', authenticatePlatform, async (req, res) => {
  try {
    await authService.logout(req.sessionToken, req.ip, req.headers['user-agent']);

    // Clear session cookie
    res.setHeader('Set-Cookie', [
      'salsa_platform_token=; HttpOnly; SameSite=Strict; Path=/api/control; Max-Age=0',
      'neem_platform_token=; HttpOnly; SameSite=Strict; Path=/api/control; Max-Age=0',
      'salsa_platform_csrf=; SameSite=Strict; Path=/; Max-Age=0',
      'neem_platform_csrf=; SameSite=Strict; Path=/; Max-Age=0'
    ]);

    return res.status(200).json({
      success: true,
      data: { message: 'Platform session revoked successfully.' }
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: { code: 'LOGOUT_ERROR', message: err.message }
    });
  }
});

// 7. Ephemeral Dev/Test Session Fixture (Strictly disabled in Production)
router.post('/dev-session', async (req, res) => {
  if (config.isProduction || !config.allowEphemeralDev) {
    return res.status(404).json({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Dev session fixture is disabled in production.' }
    });
  }

  try {
    const result = await authService.createDevSession({
      clientIp: getClientIp(req),
      userAgent: req.headers['user-agent']
    });

    setSessionCookie(res, result.sessionToken);

    return res.status(200).json({
      success: true,
      data: result
    });
  } catch (err) {
    return res.status(403).json({
      success: false,
      error: { code: 'DEV_SESSION_ERROR', message: err.message }
    });
  }
});

// 8. Revoke all active sessions (Emergency security action)
router.post('/sessions/revoke-all', authenticatePlatform, requirePlatformRole(['platform_owner', 'platform_admin']), async (req, res) => {
  try {
    const actor = req.platformPrincipal?.id || 'operator';
    const revokedCount = await authService.revokeAllSessions({
      actorId: actor,
      clientIp: getClientIp(req),
      userAgent: req.headers['user-agent'],
      requestId: req.headers['x-request-id'] || null
    });
    return res.status(200).json({
      success: true,
      data: {
        revokedBy: actor,
        revokedAt: new Date().toISOString(),
        revokedCount,
        message: 'All active platform operator sessions have been invalidated.'
      }
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: { code: 'REVOKE_SESSIONS_FAILED', message: err.message }
    });
  }
});

// 9. List Platform Principals (Protected)
router.get('/principals', authenticatePlatform, requirePlatformRole(['platform_owner', 'platform_admin']), async (req, res) => {
  try {
    const principals = await authService.listPrincipals();
    return res.status(200).json({
      success: true,
      data: principals
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: { code: 'LIST_PRINCIPALS_FAILED', message: err.message }
    });
  }
});

// 10. Create / Invite Platform Principal
router.post('/principals', authenticatePlatform, requirePlatformRole(['platform_owner', 'platform_admin']), async (req, res) => {
  try {
    const { email, fullName, role, password } = req.body || {};
    const created = await authService.createPrincipal({ email, fullName, role, password });
    return res.status(201).json({
      success: true,
      data: created
    });
  } catch (err) {
    const status = err.message.includes('EXISTS') ? 409 : 400;
    return res.status(status).json({
      success: false,
      error: { code: 'CREATE_PRINCIPAL_FAILED', message: err.message }
    });
  }
});

// 11. Update Platform Principal (Role / Status)
router.patch('/principals/:id', authenticatePlatform, requirePlatformRole(['platform_owner', 'platform_admin']), async (req, res) => {
  try {
    const { role, status } = req.body || {};
    const updated = await authService.updatePrincipal(req.params.id, { role, status });
    if (!updated) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Principal not found' }
      });
    }
    return res.status(200).json({
      success: true,
      data: updated
    });
  } catch (err) {
    return res.status(400).json({
      success: false,
      error: { code: 'UPDATE_PRINCIPAL_FAILED', message: err.message }
    });
  }
});

// 12. Delete / Revoke Platform Principal
router.delete('/principals/:id', authenticatePlatform, requirePlatformRole(['platform_owner', 'platform_admin']), async (req, res) => {
  try {
    const target = String(req.params.id || '').toLowerCase();
    const current = String(req.platformPrincipal?.id || '').toLowerCase();
    const currentEmail = String(req.platformPrincipal?.email || '').toLowerCase();
    if (target && (target === current || target === currentEmail)) {
      return res.status(409).json({ success: false, error: { code: 'SELF_PRINCIPAL_MUTATION', message: 'The current platform principal cannot delete itself.' } });
    }
    const result = await authService.deletePrincipal(req.params.id);
    return res.status(200).json({
      success: true,
      data: result
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: { code: 'DELETE_PRINCIPAL_FAILED', message: err.message }
    });
  }
});

// 13. Revoke Principal Access by ID or Email
router.post('/principals/:id/revoke', authenticatePlatform, requirePlatformRole(['platform_owner', 'platform_admin']), async (req, res) => {
  try {
    const target = String(req.params.id || '').toLowerCase();
    const current = String(req.platformPrincipal?.id || '').toLowerCase();
    const currentEmail = String(req.platformPrincipal?.email || '').toLowerCase();
    if (target && (target === current || target === currentEmail)) {
      return res.status(409).json({ success: false, error: { code: 'SELF_PRINCIPAL_MUTATION', message: 'The current platform principal cannot revoke itself.' } });
    }
    const result = await authService.deletePrincipal(req.params.id);
    return res.status(200).json({
      success: true,
      data: result
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: { code: 'REVOKE_PRINCIPAL_FAILED', message: err.message }
    });
  }
});

// 14. Resend Invite to Platform Principal
router.post('/principals/:id/resend-invite', authenticatePlatform, requirePlatformRole(['platform_owner', 'platform_admin']), async (req, res) => {
  return res.status(200).json({
    success: true,
    data: { message: 'Invitation resent successfully.', principalId: req.params.id }
  });
});

module.exports = router;
