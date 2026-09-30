// server/salsa/control-plane/auth/auth-service.js
'use strict';

const crypto = require('crypto');
const config = require('../config');
const { getDatabase, getDatabaseClient } = require('../db/database');
const auditService = require('../audit/audit-service');
const {
  hashPassword,
  verifyPassword,
  generateTotpSecret,
  verifyTotpCode,
  generateSecureToken,
  sha256,
  generateRecoveryCodes
} = require('./crypto-util');

function getMfaKeyBuffer() {
  const keyHex = config.mfaEncryptionKey;
  if (!keyHex) {
    if (config.isTest) {
      return crypto.createHash('sha256').update('test_mfa_ephemeral_key_seed').digest();
    }
    throw new Error('FAIL-CLOSED: NEEM_MFA_ENCRYPTION_KEY is required and must be configured in environment.');
  }
  const buf = Buffer.from(keyHex, 'hex');
  if (buf.length !== 32) {
    throw new Error('FAIL-CLOSED: NEEM_MFA_ENCRYPTION_KEY must be a valid 32-byte hex string.');
  }
  return buf;
}

function encryptMfaSecret(plainSecret) {
  const keyBuf = getMfaKeyBuffer();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyBuf, iv);
  const enc = Buffer.concat([cipher.update(plainSecret, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:totp:v1:${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
}

function decryptMfaSecret(payload) {
  if (!payload || typeof payload !== 'string' || !payload.startsWith('enc:totp:v1:')) {
    return payload; // Fallback for raw legacy secrets if any
  }
  try {
    const parts = payload.split(':');
    if (parts.length < 6) return null;
    const [, , , ivHex, tagHex, dataHex] = parts;
    if (!ivHex || !tagHex || !dataHex) return null;
    const keyBuf = getMfaKeyBuffer();
    const decipher = crypto.createDecipheriv('aes-256-gcm', keyBuf, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    const dec = Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]);
    return dec.toString('utf8');
  } catch (err) {
    console.error('[MFA_DECRYPT_FAIL] Unable to decrypt MFA secret:', err.message);
    return null;
  }
}

class AuthService {
  constructor() {
    this.db = getDatabase();
  }

  // 1. One-time Platform Owner Bootstrap (Transactional & Timing-Safe)
  async bootstrapOwner({ email, fullName, password, bootstrapSecret, clientIp = null, userAgent = null }) {
    if (!email || !fullName || !password) {
      throw new Error('Bootstrap Error: email, fullName, and password are required.');
    }

    // Bootstrap secret check: mandatory outside NODE_ENV === 'test'
    if (!config.isTest) {
      const provided = Buffer.from(String(bootstrapSecret || ''), 'utf8');
      const expected = Buffer.from(String(config.bootstrapSecret || ''), 'utf8');
      if (provided.length === 0 || provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
        throw new Error('FAIL-CLOSED: Valid NEEM_BOOTSTRAP_SECRET is required to initialize platform owner.');
      }
    } else if (config.bootstrapSecret && bootstrapSecret) {
      const provided = Buffer.from(String(bootstrapSecret), 'utf8');
      const expected = Buffer.from(String(config.bootstrapSecret), 'utf8');
      if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
        throw new Error('FAIL-CLOSED: Valid NEEM_BOOTSTRAP_SECRET is required to initialize platform owner.');
      }
    }

    const client = await getDatabaseClient(this.db);
    try {
      await client.query('BEGIN');

      const countRes = await client.query(
        "SELECT COUNT(*) FROM neem_platform_principals WHERE role = 'platform_owner'"
      );
      const existingCount = Number(countRes.rows[0]?.count || 0);
      if (existingCount > 0) {
        throw new Error('FORBIDDEN: Platform owner has already been initialized.');
      }

      const principalId = crypto.randomUUID();
      const passHash = hashPassword(password);
      const totpSecret = generateTotpSecret(20);
      const encryptedTotp = encryptMfaSecret(totpSecret);
      const { plainCodes, hashedCodes } = generateRecoveryCodes(8);

      // Insert Principal
      await client.query(
        `INSERT INTO neem_platform_principals 
          (id, email, full_name, role, password_hash, status)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [principalId, email.toLowerCase().trim(), fullName.trim(), 'platform_owner', passHash, 'active']
      );

      // Insert MFA Factor (active) with AES-256-GCM encrypted secret
      const factorId = crypto.randomUUID();
      await client.query(
        `INSERT INTO neem_platform_mfa_factors 
          (id, principal_id, factor_kind, secret_ciphertext, status)
         VALUES ($1, $2, $3, $4, $5)`,
        [factorId, principalId, 'totp', encryptedTotp, 'active']
      );

      // Insert Recovery Codes
      for (const h of hashedCodes) {
        const recId = crypto.randomUUID();
        await client.query(
          `INSERT INTO neem_platform_recovery_codes (id, principal_id, code_hash) VALUES ($1, $2, $3)`,
          [recId, principalId, h]
        );
      }

      // Audit Event
      await auditService.recordEvent({
        actorId: principalId,
        actorRole: 'platform_owner',
        action: 'PLATFORM_OWNER_BOOTSTRAPPED',
        targetType: 'platform_principal',
        targetId: principalId,
        clientIp,
        userAgent,
        metadata: { email: email.toLowerCase().trim(), role: 'platform_owner' }
      });

      await client.query('COMMIT');

      return {
        principalId,
        email: email.toLowerCase().trim(),
        totpSecret,
        recoveryCodes: plainCodes
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  // 2. Platform Principal Login (Step 1: Password -> Persistent MFA Challenge)
  async login({ email, password, clientIp = null, userAgent = null, requestId = null }) {
    if (!email || !password) {
      throw new Error('Validation Error: email and password are required.');
    }

    const cleanEmail = email.toLowerCase().trim();
    const res = await this.db.query(
      'SELECT * FROM neem_platform_principals WHERE LOWER(email) = $1',
      [cleanEmail]
    );

    const principal = res.rows[0];
    if (!principal) {
      throw new Error('Invalid email or credentials.');
    }

    // Check Lockout
    if (principal.locked_until && new Date(principal.locked_until) > new Date()) {
      throw new Error('Account is temporarily locked due to repeated failed login attempts.');
    }

    // Verify Password
    const isMatch = verifyPassword(password, principal.password_hash);
    if (!isMatch) {
      await this.db.query(
        `UPDATE neem_platform_principals 
         SET failed_login_attempts = failed_login_attempts + 1,
             locked_until = CASE
               WHEN failed_login_attempts + 1 >= $2 THEN NOW() + ($3 || ' minutes')::INTERVAL
               ELSE locked_until
             END
         WHERE id = $1`,
        [principal.id, config.maxLoginAttempts, config.lockoutMinutes]
      );
      await auditService.recordEvent({
        actorId: principal.id,
        actorRole: principal.role,
        action: 'PLATFORM_LOGIN_FAILED',
        targetType: 'platform_principal',
        targetId: principal.id,
        clientIp,
        userAgent,
        requestId,
        metadata: { reason: 'bad_password' }
      });
      throw new Error('Invalid email or credentials.');
    }

    // Password valid -> Reset failed attempts
    await this.db.query(
      'UPDATE neem_platform_principals SET failed_login_attempts = 0 WHERE id = $1',
      [principal.id]
    );

    // Issue Persistent MFA Challenge Token (5 min TTL)
    const mfaToken = generateSecureToken(32);
    const tokenHash = sha256(mfaToken);
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    await this.db.query(
      `INSERT INTO neem_platform_mfa_challenges (id, principal_id, token_hash, expires_at, is_used, created_at)
       VALUES ($1, $2, $3, $4, FALSE, NOW())`,
      [crypto.randomUUID(), principal.id, tokenHash, expiresAt]
    );

    return {
      requireMfa: true,
      mfaToken,
      expiresInSeconds: 300
    };
  }

  // 3. Verify MFA (Step 2: TOTP Code -> Session Token)
  async verifyMfa({ mfaToken, totpCode, clientIp = null, userAgent = null, requestId = null }) {
    if (!mfaToken || !totpCode) {
      throw new Error('Validation Error: mfaToken and totpCode are required.');
    }

    const tokenHash = sha256(mfaToken);
    const chRes = await this.db.query(
      `SELECT * FROM neem_platform_mfa_challenges WHERE token_hash = $1 AND is_used = FALSE`,
      [tokenHash]
    );
    const challenge = chRes.rows[0];

    if (!challenge || new Date(challenge.expires_at) < new Date()) {
      await this.db.query(
        `UPDATE neem_platform_mfa_challenges SET is_used = TRUE WHERE token_hash = $1`,
        [tokenHash]
      );
      throw new Error('MFA session expired or invalid. Please login again.');
    }
    if (challenge.locked_until && new Date(challenge.locked_until) > new Date()) {
      throw new Error('MFA challenge is temporarily locked due to repeated failed attempts. Please login again later.');
    }

    const principalId = challenge.principal_id;
    const factorRes = await this.db.query(
      "SELECT * FROM neem_platform_mfa_factors WHERE principal_id = $1 AND factor_kind = 'totp' AND status = 'active'",
      [principalId]
    );
    const factor = factorRes.rows[0];
    if (!factor) {
      throw new Error('Active TOTP factor not found for principal.');
    }

    // Decrypt TOTP secret before verification
    const rawSecret = decryptMfaSecret(factor.secret_ciphertext);
    const isValidCode = Boolean(rawSecret) && verifyTotpCode(rawSecret, totpCode);
    if (!isValidCode) {
      await this.db.query(
        `UPDATE neem_platform_mfa_challenges
         SET failed_attempts = failed_attempts + 1,
             locked_until = CASE
               WHEN failed_attempts + 1 >= $2 THEN NOW() + ($3 || ' minutes')::INTERVAL
               ELSE locked_until
             END
         WHERE id = $1 AND is_used = FALSE
         RETURNING id, failed_attempts, locked_until`,
        [challenge.id, config.maxLoginAttempts, config.lockoutMinutes]
      );
      await auditService.recordEvent({
        actorId: principalId,
        actorRole: 'unknown',
        action: 'PLATFORM_MFA_FAILED',
        targetType: 'platform_mfa_factor',
        targetId: factor.id,
        clientIp,
        userAgent,
        requestId,
        metadata: { factor_kind: 'totp' }
      });
      throw new Error('Invalid TOTP verification code.');
    }

    // Code verified -> Consume MFA Challenge persistently
    const consumeChallenge = await this.db.query(
      `UPDATE neem_platform_mfa_challenges
       SET is_used = TRUE, used_at = NOW()
       WHERE id = $1 AND is_used = FALSE AND expires_at >= NOW()
         AND (locked_until IS NULL OR locked_until <= NOW())
       RETURNING id`,
      [challenge.id]
    );
    if (!consumeChallenge.rows?.length) {
      throw new Error('MFA session expired, locked, or already consumed. Please login again.');
    }

    // Create Platform Session
    const sessionToken = generateSecureToken(32);
    const sessTokenHash = sha256(sessionToken);
    const expiresAt = new Date(Date.now() + config.sessionTtlHours * 3600 * 1000);
    const sessionId = crypto.randomUUID();

    await this.db.query(
      `INSERT INTO neem_platform_sessions 
        (id, principal_id, token_hash, client_ip, user_agent, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [sessionId, principalId, sessTokenHash, clientIp, userAgent, expiresAt]
    );

    const princRes = await this.db.query(
      'SELECT id, email, full_name, role, status FROM neem_platform_principals WHERE id = $1',
      [principalId]
    );
    const principal = princRes.rows[0];

    await auditService.recordEvent({
      actorId: principal.id,
      actorRole: principal.role,
      action: 'PLATFORM_SESSION_CREATED',
      targetType: 'platform_session',
      targetId: sessionId,
      clientIp,
      userAgent,
      requestId,
      metadata: { role: principal.role }
    });

    return {
      sessionToken,
      expiresAt,
      principal: {
        id: principal.id,
        email: principal.email,
        fullName: principal.full_name,
        role: principal.role
      }
    };
  }

  // 4. Verify Single-use Recovery Code
  async useRecoveryCode({ mfaToken, recoveryCode, clientIp = null, userAgent = null, requestId = null }) {
    if (!mfaToken || !recoveryCode) {
      throw new Error('Validation Error: mfaToken and recoveryCode are required.');
    }

    let principalId = null;
    let challenge = null;

    const challengeTokenHash = sha256(mfaToken);
    const chRes = await this.db.query(
      'SELECT * FROM neem_platform_mfa_challenges WHERE token_hash = $1 AND is_used = FALSE',
      [challengeTokenHash]
    );
    challenge = chRes.rows[0];
    if (!challenge || new Date(challenge.expires_at) < new Date() ||
        (challenge.locked_until && new Date(challenge.locked_until) > new Date())) {
      if (challenge) {
        await this.db.query('UPDATE neem_platform_mfa_challenges SET is_used = TRUE, used_at = NOW() WHERE id = $1 AND is_used = FALSE', [challenge.id]);
      }
      throw new Error('MFA session expired, locked, or invalid. Please login again.');
    }
    principalId = challenge.principal_id;

    const princRes = await this.db.query(
      'SELECT id, email, full_name, role, status FROM neem_platform_principals WHERE id = $1',
      [principalId]
    );
    const principal = princRes.rows[0];
    if (!principal || principal.status !== 'active') {
      throw new Error('Active principal not found.');
    }

    const codeHash = sha256(recoveryCode.trim());
    const codeRes = await this.db.query(
      'SELECT * FROM neem_platform_recovery_codes WHERE principal_id = $1 AND code_hash = $2',
      [principal.id, codeHash]
    );
    const record = codeRes.rows[0];

    if (!record) {
      await auditService.recordEvent({
        actorId: principal.id,
        actorRole: principal.role,
        action: 'PLATFORM_RECOVERY_CODE_REJECTED',
        targetType: 'platform_principal',
        targetId: principal.id,
        clientIp,
        userAgent,
        requestId,
        metadata: { reason: 'invalid_code' }
      });
      throw new Error('Invalid recovery code.');
    }

    if (record.is_used) {
      await auditService.recordEvent({
        actorId: principal.id,
        actorRole: principal.role,
        action: 'PLATFORM_RECOVERY_CODE_REJECTED',
        targetType: 'platform_principal',
        targetId: principal.id,
        clientIp,
        userAgent,
        requestId,
        metadata: { reason: 'already_consumed' }
      });
      throw new Error('Recovery code has already consumed and cannot be reused.');
    }

    // Burn the recovery code, consume the challenge and create the session in
    // one transaction. If any conditional claim loses a race, every prior
    // mutation is rolled back and no half-consumed recovery credential remains.
    const sessionToken = generateSecureToken(32);
    const tokenHash = sha256(sessionToken);
    const expiresAt = new Date(Date.now() + config.sessionTtlHours * 3600 * 1000);
    const sessionId = crypto.randomUUID();
    const client = await getDatabaseClient(this.db);
    try {
      await client.query('BEGIN');
      const consumedCode = await client.query(
        `UPDATE neem_platform_recovery_codes SET is_used = TRUE, used_at = NOW()
         WHERE id = $1 AND is_used = FALSE
         RETURNING id`,
        [record.id]
      );
      if (!consumedCode.rows?.length) {
        throw new Error('Recovery code has already been consumed and cannot be reused.');
      }
      const consumedChallenge = await client.query(
        `UPDATE neem_platform_mfa_challenges SET is_used = TRUE, used_at = NOW()
         WHERE id = $1 AND is_used = FALSE AND expires_at >= NOW()
           AND (locked_until IS NULL OR locked_until <= NOW())
         RETURNING id`,
        [challenge.id]
      );
      if (!consumedChallenge.rows?.length) {
        throw new Error('MFA session has already been consumed. Please login again.');
      }
      await client.query(
        `INSERT INTO neem_platform_sessions
          (id, principal_id, token_hash, client_ip, user_agent, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [sessionId, principal.id, tokenHash, clientIp, userAgent, expiresAt]
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      if (typeof client.release === 'function') client.release();
    }

    await auditService.recordEvent({
      actorId: principal.id,
      actorRole: principal.role,
      action: 'PLATFORM_RECOVERY_CODE_USED',
      targetType: 'platform_principal',
      targetId: principal.id,
      clientIp,
      userAgent,
      requestId,
      metadata: { recovery_code_id: record.id }
    });

    return {
      sessionToken,
      expiresAt,
      principal: {
        id: principal.id,
        email: principal.email,
        fullName: principal.full_name,
        role: principal.role
      }
    };
  }

  async verifyRecoveryCode(args) {
    return this.useRecoveryCode(args);
  }

  // 5. Session Validation & Fetching
  async getSession(sessionToken) {
    if (!sessionToken) return null;
    const tokenHash = sha256(sessionToken);

    const sessRes = await this.db.query(
      'SELECT * FROM neem_platform_sessions WHERE token_hash = $1',
      [tokenHash]
    );
    const session = sessRes.rows[0];
    if (!session) return null;

    if (session.revoked_at) return null;
    if (new Date(session.expires_at) <= new Date()) return null;

    const princRes = await this.db.query(
      'SELECT id, email, full_name, role, status FROM neem_platform_principals WHERE id = $1',
      [session.principal_id]
    );
    const principal = princRes.rows[0];
    if (!principal || principal.status !== 'active') return null;

    return { session, principal };
  }

  // 6. Session Logout / Revocation
  async logout(sessionToken, clientIp = null, userAgent = null) {
    if (!sessionToken) return false;
    const tokenHash = sha256(sessionToken);

    const sessRes = await this.db.query(
      'SELECT * FROM neem_platform_sessions WHERE token_hash = $1',
      [tokenHash]
    );
    const session = sessRes.rows[0];
    if (!session) return false;

    await this.db.query(
      'UPDATE neem_platform_sessions SET revoked_at = NOW() WHERE id = $1',
      [session.id]
    );

    await auditService.recordEvent({
      actorId: session.principal_id,
      actorRole: 'unknown',
      action: 'PLATFORM_SESSION_REVOKED',
      targetType: 'platform_session',
      targetId: session.id,
      clientIp,
      userAgent,
      metadata: { reason: 'user_logout' }
    });

    return true;
  }

  async revokeAllSessions({ actorId = 'operator', clientIp = null, userAgent = null, requestId = null } = {}) {
    const active = await this.db.query(
      'SELECT id FROM neem_platform_sessions WHERE revoked_at IS NULL AND expires_at > NOW()'
    );
    let revokedCount = 0;
    for (const session of active.rows || []) {
      const result = await this.db.query(
        'UPDATE neem_platform_sessions SET revoked_at = NOW() WHERE id = $1 AND revoked_at IS NULL RETURNING id',
        [session.id]
      );
      revokedCount += result.rows?.length || result.rowCount || 0;
    }

    await auditService.recordEvent({
      actorId,
      actorRole: 'platform_operator',
      action: 'PLATFORM_SESSIONS_REVOKED_ALL',
      targetType: 'platform_sessions',
      targetId: 'all',
      clientIp,
      userAgent,
      requestId,
      metadata: { revokedCount }
    });

    return revokedCount;
  }

  /**
   * Removes only revoked or expired platform sessions. Keeping this operation
   * explicit and scheduled prevents the session table from becoming an
   * unbounded source of stale credentials while preserving active sessions.
   */
  async cleanupExpiredSessions({ now = new Date() } = {}) {
    const result = await this.db.query(
      `DELETE FROM neem_platform_sessions
       WHERE revoked_at IS NOT NULL OR expires_at <= $1
       RETURNING id`,
      [now]
    );
    return Number(result.rowCount ?? result.rows?.length ?? 0);
  }

  // Ephemeral dev / test fixture session creation (Fail-closed in production)
  async createDevSession({ clientIp = '127.0.0.1', userAgent = 'Dev-Console' } = {}) {
    if (config.isProduction || !config.allowEphemeralDev) {
      throw new Error('DEV_SESSION_FORBIDDEN: Dev sessions are disabled in production.');
    }

    const devEmail = 'dev_owner@neem.internal';
    let princRes = await this.db.query(
      'SELECT id, email, full_name, role, status FROM neem_platform_principals WHERE email = $1',
      [devEmail]
    );

    let principal = princRes.rows[0];
    if (!principal) {
      const id = crypto.randomUUID();
      await this.db.query(
        `INSERT INTO neem_platform_principals 
          (id, email, full_name, role, status, mfa_enabled, failed_login_attempts)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [id, devEmail, 'Local Dev Owner', 'platform_owner', 'active', false, 0]
      );
      principal = { id, email: devEmail, full_name: 'Local Dev Owner', role: 'platform_owner', status: 'active' };
    }

    const sessionToken = generateSecureToken(32);
    const sessTokenHash = sha256(sessionToken);
    const expiresAt = new Date(Date.now() + config.sessionTtlHours * 3600 * 1000);
    const sessionId = crypto.randomUUID();

    await this.db.query(
      `INSERT INTO neem_platform_sessions 
        (id, principal_id, token_hash, client_ip, user_agent, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [sessionId, principal.id, sessTokenHash, clientIp, userAgent, expiresAt]
    );

    return {
      sessionToken,
      expiresAt,
      principal: {
        id: principal.id,
        email: principal.email,
        fullName: principal.full_name || 'Local Dev Owner',
        role: principal.role
      }
    };
  }

  // 8. Principal Management (Platform Team)
  async listPrincipals() {
    const res = await this.db.query(
      'SELECT id, email, full_name, role, status, mfa_enabled, last_login_at, created_at FROM neem_platform_principals ORDER BY created_at ASC'
    );
    let sessionCounts = {};
    try {
      const sessRes = await this.db.query(
        'SELECT principal_id, COUNT(*) as count FROM neem_platform_sessions WHERE expires_at > NOW() GROUP BY principal_id'
      );
      for (const r of (sessRes.rows || [])) {
        sessionCounts[r.principal_id] = Number(r.count || 0);
      }
    } catch (_) {}

    return (res.rows || []).map(p => ({
      id: p.id,
      name: p.full_name || p.name || 'اپراتور سیستم',
      fullName: p.full_name || p.name || 'اپراتور سیستم',
      email: p.email,
      role: p.role,
      roleFa: p.role === 'platform_owner' ? 'مالک پلتفرم (Owner)' : (p.role === 'platform_operations' ? 'مهندسی عملیات (Operations)' : (p.role === 'platform_support' ? 'پشتیبانی فنی (Support)' : p.role)),
      status: p.status || 'active',
      mfaStatus: p.mfa_enabled ? 'active' : 'pending',
      activeSessions: sessionCounts[p.id] || 0,
      lastLogin: p.last_login_at ? new Date(p.last_login_at).toISOString() : null,
      createdAt: p.created_at ? new Date(p.created_at).toISOString() : null
    }));
  }

  async createPrincipal({ email, fullName, role = 'platform_support', password = null }) {
    if (!email || !fullName) {
      throw new Error('PRINCIPAL_ERROR: email and fullName are required.');
    }
    const existing = await this.db.query(
      'SELECT id FROM neem_platform_principals WHERE LOWER(email) = LOWER($1)',
      [email]
    );
    if (existing.rows && existing.rows.length > 0) {
      throw new Error('PRINCIPAL_EXISTS: A principal with this email already exists.');
    }
    const id = crypto.randomUUID();
    const tempPassword = password || crypto.randomBytes(12).toString('base64url');
    const pwdHash = await hashPassword(tempPassword);

    await this.db.query(
      `INSERT INTO neem_platform_principals 
        (id, email, full_name, role, password_hash, status, mfa_enabled, failed_login_attempts)
       VALUES ($1, LOWER($2), $3, $4, $5, 'active', false, 0)`,
      [id, email, fullName, role, pwdHash]
    );

    return {
      id,
      email: email.toLowerCase(),
      fullName,
      role,
      status: 'active',
      tempPassword
    };
  }

  async updatePrincipal(id, { role, status }) {
    const fields = [];
    const values = [];
    let idx = 1;
    if (role) {
      fields.push(`role = $${idx++}`);
      values.push(role);
    }
    if (status) {
      fields.push(`status = $${idx++}`);
      values.push(status);
    }
    if (fields.length === 0) return null;
    values.push(id);
    const sql = `UPDATE neem_platform_principals SET ${fields.join(', ')} WHERE id = $${idx} RETURNING id, email, full_name, role, status`;
    const res = await this.db.query(sql, values);
    return res.rows[0] || null;
  }

  async deletePrincipal(idOrEmail) {
    const lookup = await this.db.query(
      'SELECT id FROM neem_platform_principals WHERE id = $1 OR LOWER(email) = LOWER($1)',
      [idOrEmail]
    );
    const principalId = lookup.rows[0]?.id;
    if (!principalId) return { deleted: false };
    try {
      await this.db.query('DELETE FROM neem_platform_sessions WHERE principal_id = $1', [principalId]);
    } catch (_) {}
    const res = await this.db.query('DELETE FROM neem_platform_principals WHERE id = $1 RETURNING id', [principalId]);
    return { deleted: (res.rowCount || res.rows?.length || 0) > 0 };
  }
}

const authService = new AuthService();
// Keep the historical singleton export used by routes while exposing the
// class for lifecycle-owned services such as the server session janitor.
module.exports = authService;
module.exports.AuthService = AuthService;
