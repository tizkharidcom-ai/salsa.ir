/* Starts the local WESTO stack together.
 *
 * The public/client app, the current SALSA frontend, and the SALSA Control
 * Plane are separate processes with separate ports. Keeping these boundaries
 * explicit keeps each application on its own port and connects the frontend
 * to the Control Plane API.
 */
const crypto = require('crypto');
const path = require('path');
const { spawn } = require('child_process');

const root = path.join(__dirname, '..');

function buildServiceDefinitions(sourceEnv = process.env) {
  const persistentKeyPath = path.join(__dirname, 'data', 'secret.key');
  let fallbackKey = '';
  try {
    if (require('fs').existsSync(persistentKeyPath)) {
      fallbackKey = require('fs').readFileSync(persistentKeyPath, 'utf8').trim();
    }
  } catch (_) {}
  const bridgeSecret = sourceEnv.WESTO_SALSA_BRIDGE_SECRET || sourceEnv.WESTO_NEEM_BRIDGE_SECRET || fallbackKey || crypto.randomBytes(32).toString('hex');
  // Keep the local defaults aligned with the smoke gates and GODMODE topology.
  const westoPort = String(sourceEnv.PORT || '4180');
  const godmodePort = String(sourceEnv.GODMODE_PORT || '3050');
  const godmodeHost = String(sourceEnv.GODMODE_HOST || '127.0.0.1');
  const controlPort = String(sourceEnv.SALSA_CONTROL_PORT || sourceEnv.NEEM_CONTROL_PORT || '3061');
  const bridgeUrl = sourceEnv.SALSA_BRIDGE_URL || sourceEnv.NEEM_BRIDGE_URL
    || `http://127.0.0.1:${controlPort}/api/control/integrations/westo/events`;
  // Canonical flagship tenant is 'westo'
  const tenantId = sourceEnv.SALSA_TENANT_ID || sourceEnv.NEEM_TENANT_ID || 'westo';
  const piiKey = crypto.randomBytes(32).toString('hex');
  const defaultPiiKeyring = JSON.stringify({ v1: piiKey });
  const defaultMfaKey = crypto.randomBytes(32).toString('hex');
  const common = {
    ...sourceEnv,
    NODE_ENV: sourceEnv.NODE_ENV || 'development',
    SALSA_CONTROL_PLANE_URL: sourceEnv.SALSA_CONTROL_PLANE_URL || sourceEnv.SALSA_CONTROL_URL || `http://127.0.0.1:${controlPort}`,
    WESTO_SALSA_BRIDGE_SECRET: bridgeSecret,
    WESTO_NEEM_BRIDGE_SECRET: bridgeSecret,
    SALSA_CONTROL_SECRET: sourceEnv.SALSA_CONTROL_SECRET || sourceEnv.NEEM_CONTROL_SECRET || bridgeSecret,
    NEEM_CONTROL_SECRET: sourceEnv.NEEM_CONTROL_SECRET || sourceEnv.SALSA_CONTROL_SECRET || bridgeSecret,
    SALSA_BRIDGE_URL: bridgeUrl,
    NEEM_BRIDGE_URL: bridgeUrl,
    SALSA_TENANT_ID: tenantId,
    NEEM_TENANT_ID: tenantId,
    SALSA_SESSION_SECRET: sourceEnv.SALSA_SESSION_SECRET || sourceEnv.NEEM_SESSION_SECRET || bridgeSecret,
    NEEM_SESSION_SECRET: sourceEnv.NEEM_SESSION_SECRET || sourceEnv.SALSA_SESSION_SECRET || bridgeSecret,
    SALSA_PII_KEYRING: sourceEnv.SALSA_PII_KEYRING || sourceEnv.NEEM_PII_KEYRING || defaultPiiKeyring,
    NEEM_PII_KEYRING: sourceEnv.NEEM_PII_KEYRING || sourceEnv.SALSA_PII_KEYRING || defaultPiiKeyring,
    SALSA_MFA_ENCRYPTION_KEY: sourceEnv.SALSA_MFA_ENCRYPTION_KEY || sourceEnv.NEEM_MFA_ENCRYPTION_KEY || defaultMfaKey,
    NEEM_MFA_ENCRYPTION_KEY: sourceEnv.NEEM_MFA_ENCRYPTION_KEY || sourceEnv.SALSA_MFA_ENCRYPTION_KEY || defaultMfaKey,
    SALSA_INBOX_ACK_SECRET: sourceEnv.SALSA_INBOX_ACK_SECRET || sourceEnv.NEEM_INBOX_ACK_SECRET || bridgeSecret,
    NEEM_INBOX_ACK_SECRET: sourceEnv.NEEM_INBOX_ACK_SECRET || sourceEnv.SALSA_INBOX_ACK_SECRET || bridgeSecret,
    SALSA_CONTROL_ALLOW_EPHEMERAL_DEV: sourceEnv.SALSA_CONTROL_ALLOW_EPHEMERAL_DEV || sourceEnv.NEEM_CONTROL_ALLOW_EPHEMERAL_DEV || 'true',
    NEEM_CONTROL_ALLOW_EPHEMERAL_DEV: sourceEnv.NEEM_CONTROL_ALLOW_EPHEMERAL_DEV || sourceEnv.SALSA_CONTROL_ALLOW_EPHEMERAL_DEV || 'true',
    SALSA_BRIDGE_ENABLED: sourceEnv.SALSA_BRIDGE_ENABLED || sourceEnv.NEEM_BRIDGE_ENABLED || 'true',
    NEEM_BRIDGE_ENABLED: sourceEnv.NEEM_BRIDGE_ENABLED || sourceEnv.SALSA_BRIDGE_ENABLED || 'true',
  };

  return [
    {
      name: 'WESTO client',
      args: ['server/server.js'],
      env: { ...common, PORT: westoPort },
    },
    {
      name: 'SALSA GODMODE frontend',
      args: ['superadmin/frontend/server.js'],
      env: { ...common, PORT: godmodePort, GODMODE_HOST: godmodeHost },
    },
    {
      name: 'SALSA Control Plane',
      args: ['server/salsa/control-plane/server.js'],
      env: { ...common, SALSA_CONTROL_PORT: controlPort, NEEM_CONTROL_PORT: controlPort },
    },
  ];
}

function startStack() {
  // Use the same configured database as start:postgres; never quietly start
  // a separate JSON-backed WESTO instance when local PostgreSQL is configured.
  const localEnvPath = path.join(root, '.env.local');
  if (require('fs').existsSync(localEnvPath)) process.loadEnvFile(localEnvPath);
  const services = buildServiceDefinitions();
  const children = services.map((service) => ({
    ...service,
    child: spawn(process.execPath, service.args, {
      cwd: root,
      env: service.env,
      stdio: 'inherit',
    }),
  }));
  let stopping = false;

  function stop(signal = 'SIGTERM') {
    if (stopping) return;
    stopping = true;
    for (const service of children) {
      if (!service.child.killed) service.child.kill(signal);
    }
  }

  process.on('SIGINT', () => stop('SIGINT'));
  process.on('SIGTERM', () => stop('SIGTERM'));
  for (const service of children) {
    service.child.on('error', (error) => {
      if (stopping) return;
      console.error(`[full-stack] ${service.name} failed to start: ${error.message}`);
      stop('SIGTERM');
      process.exitCode = 1;
    });
    service.child.on('exit', (code, signal) => {
      if (stopping) return;
      console.error(`[full-stack] ${service.name} stopped (${signal || code}); stopping the companion services.`);
      stop('SIGTERM');
      process.exitCode = code || 1;
    });
  }
  return { children, stop };
}

if (require.main === module) startStack();

module.exports = { buildServiceDefinitions, startStack };
