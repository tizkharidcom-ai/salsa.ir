/**
 * superadmin/run.js
 *
 * Dedicated runner for SALSA Super Admin & Control Plane.
 * Concurrently boots:
 *   1. Backend Control Plane API (Port 3061)
 *   2. Frontend Super Admin UI (Port 3050)
 */

'use strict';

const { spawn } = require('child_process');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');

const isProduction = process.env.NODE_ENV === 'production';
const bridgeSecret = process.env.SALSA_CONTROL_SECRET || process.env.NEEM_CONTROL_SECRET || (isProduction ? '' : 'salsa_dev_bridge_secret_at_least_32_bytes_entropy_token');
const sessionSecret = process.env.SALSA_SESSION_SECRET || process.env.NEEM_SESSION_SECRET || (isProduction ? '' : 'salsa_dev_session_secret_at_least_32_bytes_entropy_token');
const westoBridgeSecret = process.env.WESTO_SALSA_BRIDGE_SECRET || process.env.WESTO_NEEM_BRIDGE_SECRET || (isProduction ? '' : 'dev_westo_event_bridge_secret_at_least_32_chars');
const inboxAckSecret = process.env.SALSA_INBOX_ACK_SECRET || process.env.NEEM_INBOX_ACK_SECRET || (isProduction ? '' : 'dev_inbox_ack_secret_at_least_32_chars');
const piiKeyring = process.env.SALSA_PII_KEYRING || process.env.NEEM_PII_KEYRING || (isProduction ? '' : JSON.stringify({
  '2026-01': '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
}));
const mfaEncryptionKey = process.env.SALSA_MFA_ENCRYPTION_KEY || process.env.NEEM_MFA_ENCRYPTION_KEY || (isProduction ? '' : '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef');

if (isProduction) {
  const required = [
    ['SALSA_CONTROL_SECRET', bridgeSecret, 32],
    ['SALSA_SESSION_SECRET', sessionSecret, 32],
    ['WESTO_SALSA_BRIDGE_SECRET', westoBridgeSecret, 32],
    ['SALSA_INBOX_ACK_SECRET', inboxAckSecret, 32],
    ['SALSA_PII_KEYRING', piiKeyring, 1],
    ['SALSA_MFA_ENCRYPTION_KEY', mfaEncryptionKey, 1],
  ];
  const missing = required.filter(([, value, minLength]) => String(value || '').trim().length < minLength);
  if (missing.length) {
    throw new Error(`FAIL-CLOSED: production secrets must be explicitly configured: ${missing.map(([name]) => name).join(', ')}`);
  }
  const secrets = [bridgeSecret, sessionSecret, westoBridgeSecret, inboxAckSecret];
  if (new Set(secrets).size !== secrets.length) {
    throw new Error('FAIL-CLOSED: platform session, control bridge, WESTO event bridge, and inbox ACK secrets must all be distinct in production.');
  }
}

const devEnv = {
  ...process.env,
  SALSA_CONTROL_PORT: '3061',
  NEEM_CONTROL_PORT: '3061',
  PORT: '3050',
  SALSA_SESSION_SECRET: sessionSecret,
  NEEM_SESSION_SECRET: process.env.NEEM_SESSION_SECRET || sessionSecret,
  SALSA_CONTROL_SECRET: bridgeSecret,
  NEEM_CONTROL_SECRET: process.env.NEEM_CONTROL_SECRET || bridgeSecret,
  WESTO_SALSA_BRIDGE_SECRET: westoBridgeSecret,
  WESTO_NEEM_BRIDGE_SECRET: process.env.WESTO_NEEM_BRIDGE_SECRET || westoBridgeSecret,
  SALSA_INBOX_ACK_SECRET: inboxAckSecret,
  NEEM_INBOX_ACK_SECRET: process.env.NEEM_INBOX_ACK_SECRET || inboxAckSecret,
  SALSA_PII_KEYRING: piiKeyring,
  NEEM_PII_KEYRING: process.env.NEEM_PII_KEYRING || piiKeyring,
  SALSA_MFA_ENCRYPTION_KEY: mfaEncryptionKey,
  NEEM_MFA_ENCRYPTION_KEY: process.env.NEEM_MFA_ENCRYPTION_KEY || mfaEncryptionKey,
  SALSA_CONTROL_ALLOW_EPHEMERAL_DEV: process.env.SALSA_CONTROL_ALLOW_EPHEMERAL_DEV || 'true',
  NEEM_CONTROL_ALLOW_EPHEMERAL_DEV: process.env.NEEM_CONTROL_ALLOW_EPHEMERAL_DEV || 'true'
};

console.log('=============================================================');
console.log('  🚀 LAUNCHING SALSA SUPER ADMIN & CONTROL PLANE             ');
console.log('=============================================================');

// 1. Launch Backend Control Plane (Port 3061)
const backend = spawn(process.execPath, [path.join(__dirname, 'backend/server.js')], {
  cwd: rootDir,
  env: devEnv,
  stdio: 'inherit'
});

// 2. Launch Frontend Super Admin UI (Port 3050)
const frontend = spawn(process.execPath, [path.join(__dirname, 'frontend/server.js')], {
  cwd: rootDir,
  env: devEnv,
  stdio: 'inherit'
});

function cleanup() {
  console.log('\nStopping SALSA Super Admin processes...');
  try { backend.kill('SIGTERM'); } catch (_) {}
  try { frontend.kill('SIGTERM'); } catch (_) {}
  process.exit(0);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

backend.on('exit', (code) => {
  if (code && code !== 0) {
    console.error(`Backend exited with code ${code}`);
  }
});

frontend.on('exit', (code) => {
  if (code && code !== 0) {
    console.error(`Frontend exited with code ${code}`);
  }
});
