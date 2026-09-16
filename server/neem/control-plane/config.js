// server/neem/control-plane/config.js
'use strict';

const isTest = process.env.NODE_ENV === 'test' || process.env.NEEM_ENV === 'test';
const isProd = process.env.NODE_ENV === 'production';

function databaseTarget(rawUrl) {
  if (!rawUrl) return null;
  try {
    const parsed = new URL(rawUrl);
    return {
      protocol: parsed.protocol,
      host: parsed.hostname.toLowerCase(),
      port: parsed.port || (parsed.protocol === 'postgresql:' ? '5432' : '5432'),
      database: decodeURIComponent(parsed.pathname.replace(/^\/+/, ''))
    };
  } catch (_error) {
    return null;
  }
}

function databaseUser(rawUrl) {
  if (!rawUrl) return null;
  try {
    const parsed = new URL(rawUrl);
    return parsed.username ? decodeURIComponent(parsed.username) : null;
  } catch (_error) {
    return null;
  }
}

function pointsToSameDatabase(leftUrl, rightUrl) {
  const left = databaseTarget(leftUrl);
  const right = databaseTarget(rightUrl);
  if (!left || !right) return false;
  return left.host === right.host && left.port === right.port && left.database === right.database;
}

function hasValidBackupKeyMaterial(env = process.env) {
  if (/^[0-9a-f]{64}$/i.test(env.NEEM_BACKUP_ENCRYPTION_KEY || '')) return true;
  if (!env.NEEM_BACKUP_KEYRING) return false;
  try {
    const keyring = JSON.parse(env.NEEM_BACKUP_KEYRING);
    return keyring && !Array.isArray(keyring) && Object.keys(keyring).length > 0 &&
      Object.values(keyring).every((key) => /^[0-9a-f]{64}$/i.test(String(key || '')));
  } catch (_error) {
    return false;
  }
}

function hasValidBackupDestination(env = process.env) {
  if (!hasValidBackupKeyMaterial(env)) return false;
  if (env.NEEM_BACKUP_OBJECT_STORAGE_ENDPOINT) {
    try {
      const endpoint = new URL(env.NEEM_BACKUP_OBJECT_STORAGE_ENDPOINT);
      return endpoint.protocol === 'https:' &&
        Boolean(env.NEEM_BACKUP_OBJECT_STORAGE_BUCKET) &&
        Boolean(env.NEEM_BACKUP_OBJECT_STORAGE_ACCESS_KEY) &&
        Boolean(env.NEEM_BACKUP_OBJECT_STORAGE_SECRET_KEY);
    } catch (_error) {
      return false;
    }
  }
  return Boolean(env.NEEM_BACKUP_ARTIFACT_DIR);
}

let parsedKeyring = null;
if (process.env.NEEM_PII_KEYRING) {
  try {
    parsedKeyring = typeof process.env.NEEM_PII_KEYRING === 'string'
      ? JSON.parse(process.env.NEEM_PII_KEYRING)
      : process.env.NEEM_PII_KEYRING;
  } catch (e) {
    parsedKeyring = null;
  }
}

const config = {
  env: process.env.NODE_ENV || 'development',
  isTest,
  isProduction: isProd,
  port: Number(process.env.NEEM_CONTROL_PORT || 3061),
  databaseUrl: process.env.NEEM_CONTROL_DATABASE_URL || null,
  tenantDatabaseUrl: process.env.NEEM_TENANT_DB_POSTGRES_URL || null,
  tenantDatabaseAdminUrl: process.env.NEEM_TENANT_DB_ADMIN_URL || null,
  allowEphemeralDev: process.env.NEEM_CONTROL_ALLOW_EPHEMERAL_DEV === 'true',
  bootstrapSecret: process.env.NEEM_BOOTSTRAP_SECRET || null,
  sessionSecret: process.env.NEEM_SESSION_SECRET || (isTest ? 'neem_test_session_secret_32_bytes_long_entropy' : null),
  sessionTtlHours: Number(process.env.NEEM_SESSION_TTL_HOURS || 12),
  maxLoginAttempts: Number(process.env.NEEM_MAX_LOGIN_ATTEMPTS || 5),
  lockoutMinutes: Number(process.env.NEEM_LOCKOUT_MINUTES || 15),
  piiKeyring: parsedKeyring,
  mfaEncryptionKey: process.env.NEEM_MFA_ENCRYPTION_KEY || (isTest ? '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef' : null),
  edgeUpdatePublicKey: process.env.NEEM_EDGE_UPDATE_PUBLIC_KEY || null,
  gatewayCallbackSecret: process.env.NEEM_GATEWAY_CALLBACK_SECRET || (isTest ? 'test_gateway_callback_secret_32_bytes_long' : null),
  metricsToken: process.env.NEEM_METRICS_TOKEN || (isTest ? 'test_metrics_token_secure_12345' : null),
  inboxAckSecret: process.env.NEEM_INBOX_ACK_SECRET || (isTest ? 'test_ephemeral_inbox_ack_secret' : null),
  automationEnabled: process.env.NEEM_AUTOMATION_ENABLED !== 'false',
  automationIntervalMs: Number(process.env.NEEM_AUTOMATION_INTERVAL_MS || 5000),
  canaryLatencyP95ThresholdMs: Number(process.env.NEEM_CANARY_LATENCY_P95_THRESHOLD_MS || 750),
  trafficControllerUrl: process.env.NEEM_TRAFFIC_CONTROLLER_URL || null,
  trafficControllerToken: process.env.NEEM_TRAFFIC_CONTROLLER_TOKEN || null,

  validate() {
    if (this.isTest) {
      return; // Tests configure ephemeral fixtures
    }

    if (this.automationIntervalMs !== undefined && (this.automationIntervalMs <= 0 || isNaN(this.automationIntervalMs))) {
      throw new Error('FAIL-CLOSED: NEEM_AUTOMATION_INTERVAL_MS must be a positive integer.');
    }
    if (this.canaryLatencyP95ThresholdMs !== undefined && (!Number.isFinite(this.canaryLatencyP95ThresholdMs) || this.canaryLatencyP95ThresholdMs <= 0)) {
      throw new Error('FAIL-CLOSED: NEEM_CANARY_LATENCY_P95_THRESHOLD_MS must be a positive number.');
    }

    if (this.isProduction) {
      if (!this.databaseUrl) {
        throw new Error('FAIL-CLOSED: NEEM_CONTROL_DATABASE_URL is required in production environment.');
      }
      if (process.env.DATABASE_URL && pointsToSameDatabase(this.databaseUrl, process.env.DATABASE_URL)) {
        throw new Error('FAIL-CLOSED: NEEM_CONTROL_DATABASE_URL must point to an independent database, not WESTO Finance DATABASE_URL.');
      }
      if (!this.sessionSecret || this.sessionSecret.length < 32) {
        throw new Error('FAIL-CLOSED: NEEM_SESSION_SECRET must be configured and at least 32 characters long in production.');
      }
      if (!this.bootstrapSecret || this.bootstrapSecret.length < 16) {
        throw new Error('FAIL-CLOSED: NEEM_BOOTSTRAP_SECRET must be configured and at least 16 characters long in production.');
      }
      if (!this.piiKeyring || typeof this.piiKeyring !== 'object' || Object.keys(this.piiKeyring).length === 0) {
        throw new Error('FAIL-CLOSED: NEEM_PII_KEYRING must be configured with versioned 32-byte encryption keys in production.');
      }
      if (!this.mfaEncryptionKey || Buffer.from(this.mfaEncryptionKey, 'hex').length !== 32) {
        throw new Error('FAIL-CLOSED: NEEM_MFA_ENCRYPTION_KEY must be a 32-byte hex string in production.');
      }
      if (!this.edgeUpdatePublicKey) {
        throw new Error('FAIL-CLOSED: NEEM_EDGE_UPDATE_PUBLIC_KEY is required in production.');
      }
      if (!this.gatewayCallbackSecret || this.gatewayCallbackSecret.length < 16) {
        throw new Error('FAIL-CLOSED: NEEM_GATEWAY_CALLBACK_SECRET must be configured with at least 16 characters in production.');
      }
      if (!this.metricsToken || this.metricsToken.length < 16) {
        throw new Error('FAIL-CLOSED: NEEM_METRICS_TOKEN must be configured with at least 16 characters in production.');
      }
      if (!this.inboxAckSecret || this.inboxAckSecret.length < 16) {
        throw new Error('FAIL-CLOSED: NEEM_INBOX_ACK_SECRET must be configured with at least 16 characters in production.');
      }
      if (!this.trafficControllerUrl || !this.trafficControllerToken || this.trafficControllerToken.length < 16) {
        throw new Error('FAIL-CLOSED: NEEM_TRAFFIC_CONTROLLER_URL and a strong NEEM_TRAFFIC_CONTROLLER_TOKEN are required in production.');
      }
      try {
        if (new URL(this.trafficControllerUrl).protocol !== 'https:') throw new Error('not_https');
      } catch (_error) {
        throw new Error('FAIL-CLOSED: NEEM_TRAFFIC_CONTROLLER_URL must be a valid HTTPS endpoint.');
      }
      if (!hasValidBackupDestination(process.env)) {
        throw new Error('FAIL-CLOSED: an HTTPS object-storage destination or artifact directory and a valid 32-byte backup key/keyring are required in production.');
      }
      if (!this.tenantDatabaseUrl) {
        throw new Error('FAIL-CLOSED: NEEM_TENANT_DB_POSTGRES_URL is required in production.');
      }
      if (!this.tenantDatabaseAdminUrl) {
        throw new Error('FAIL-CLOSED: NEEM_TENANT_DB_ADMIN_URL is required in production for tenant database lifecycle operations.');
      }
      const tenantDataUser = databaseUser(this.tenantDatabaseUrl);
      const tenantAdminUser = databaseUser(this.tenantDatabaseAdminUrl);
      if (!tenantDataUser || !tenantAdminUser || tenantDataUser === tenantAdminUser) {
        throw new Error('FAIL-CLOSED: NEEM_TENANT_DB_ADMIN_URL and NEEM_TENANT_DB_POSTGRES_URL must use distinct PostgreSQL roles.');
      }
    } else {
      // Development mode
      if (!this.databaseUrl && !this.allowEphemeralDev) {
        throw new Error('FAIL-CLOSED: PostgreSQL connection string (NEEM_CONTROL_DATABASE_URL) is required in development unless explicit NEEM_CONTROL_ALLOW_EPHEMERAL_DEV=true is provided.');
      }
      if (this.databaseUrl && process.env.DATABASE_URL && pointsToSameDatabase(this.databaseUrl, process.env.DATABASE_URL)) {
        throw new Error('FAIL-CLOSED: NEEM_CONTROL_DATABASE_URL must point to an independent database, not WESTO Finance DATABASE_URL.');
      }
      if (!this.sessionSecret) {
        throw new Error('FAIL-CLOSED: NEEM_SESSION_SECRET is required in development.');
      }
    }
  }
};

module.exports = config;
module.exports.databaseTarget = databaseTarget;
module.exports.databaseUser = databaseUser;
module.exports.pointsToSameDatabase = pointsToSameDatabase;
