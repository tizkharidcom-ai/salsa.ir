/* Starts the local WESTO stack together.
 *
 * The public/client app, the isolated GODMODE prototype, and the NEEM Control
 * Plane are separate processes with separate ports. Keeping these boundaries
 * explicit prevents mock UI data from being mistaken for live operations.
 */
const crypto = require('crypto');
const path = require('path');
const { spawn } = require('child_process');

const root = path.join(__dirname, '..');

function buildServiceDefinitions(sourceEnv = process.env) {
  const bridgeSecret = sourceEnv.WESTO_NEEM_BRIDGE_SECRET || crypto.randomBytes(32).toString('hex');
  // Keep the local defaults aligned with the smoke gates and GODMODE topology.
  const westoPort = String(sourceEnv.PORT || '4180');
  const godmodePort = String(sourceEnv.GODMODE_PORT || '3050');
  const godmodeHost = String(sourceEnv.GODMODE_HOST || '127.0.0.1');
  const controlPort = String(sourceEnv.NEEM_CONTROL_PORT || '3061');
  const bridgeUrl = sourceEnv.NEEM_BRIDGE_URL
    || `http://127.0.0.1:${controlPort}/api/control/integrations/westo/events`;
  // The ephemeral Control Plane fixture registers `westo-demo`; production
  // deployments must provide their canonical tenant ID explicitly.
  const tenantId = sourceEnv.NEEM_TENANT_ID
    || (sourceEnv.NEEM_CONTROL_ALLOW_EPHEMERAL_DEV === 'true' ? 'westo-demo' : 'westo');
  const common = {
    ...sourceEnv,
    WESTO_NEEM_BRIDGE_SECRET: bridgeSecret,
    NEEM_BRIDGE_URL: bridgeUrl,
    NEEM_TENANT_ID: tenantId,
    // An explicit opt-in is required until the control-plane tenant registry,
    // database, and deployment secrets are configured for the local stack.
    NEEM_BRIDGE_ENABLED: sourceEnv.NEEM_BRIDGE_ENABLED || 'false',
  };

  return [
    {
      name: 'WESTO client',
      args: ['server/server.js'],
      env: { ...common, PORT: westoPort },
    },
    {
      name: 'NEEM GODMODE prototype',
      args: ['prototype/server.js'],
      env: { ...common, PORT: godmodePort, GODMODE_HOST: godmodeHost },
    },
    {
      name: 'NEEM Control Plane',
      args: ['server/neem/control-plane/server.js'],
      env: { ...common, NEEM_CONTROL_PORT: controlPort },
    },
  ];
}

function startStack() {
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
