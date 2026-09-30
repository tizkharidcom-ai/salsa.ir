// server/salsa/control-plane/server.js
'use strict';

const http = require('http');
const config = require('./config');
const app = require('./app');
const { defaultAutomationRunner } = require('./automation/automation-runner');
const { AuthService } = require('./auth/auth-service');
const { getDatabase } = require('./db/database');
const { assertControlPlaneDatabaseReady } = require('./db/readiness');

// 1. Fail-closed Environment Preflight
config.validate();

// 2. Start HTTP Server
const server = http.createServer(app);
const authService = new AuthService();
const sessionCleanupIntervalMs = Math.max(60_000, Number(process.env.SALSA_SESSION_CLEANUP_INTERVAL_MS || process.env.NEEM_SESSION_CLEANUP_INTERVAL_MS || 5 * 60 * 1000));
let sessionCleanupTimer = null;

const PORT = config.port;

async function startServer() {
  // Test and explicitly ephemeral development runs use the in-memory adapter.
  // Every persistent run must prove that the Control Plane schema is ready
  // before accepting a request; a reachable PostgreSQL server alone is not
  // sufficient evidence.
  if (!config.isTest && !config.allowEphemeralDev) {
    const readiness = await assertControlPlaneDatabaseReady(getDatabase());
    console.log(`  🗄️ Control Plane schema ready (${readiness.appliedVersions.length} migrations)`);
  }

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(PORT, '127.0.0.1', resolve);
  });

  console.log('=============================================================');
  console.log(`  🛡️ SALSA Control Plane Service Running`);
  console.log(`  🌐 Address: http://127.0.0.1:${PORT}`);
  console.log(`  🔒 Mode: ${config.env.toUpperCase()} (Fail-Closed Architecture)`);
  console.log(`  🏛️ Healthcheck: http://127.0.0.1:${PORT}/api/control/health`);

  // Start automation runner if enabled
  if (config.automationEnabled) {
    defaultAutomationRunner.start();
    console.log(`  🤖 Automation Runner Started (interval: ${config.automationIntervalMs}ms)`);
  } else {
    console.log(`  🤖 Automation Runner Disabled via config`);
  }

  sessionCleanupTimer = setInterval(() => {
    authService.cleanupExpiredSessions().catch((err) => {
      console.error('Session cleanup failed:', err.message);
    });
  }, sessionCleanupIntervalMs);
  sessionCleanupTimer.unref?.();

  console.log('=============================================================');
}

// 3. Graceful Shutdown
async function handleShutdown(signal) {
  console.log(`\nReceived ${signal}. Shutting down SALSA Control Plane gracefully...`);
  try {
    if (sessionCleanupTimer) {
      clearInterval(sessionCleanupTimer);
      sessionCleanupTimer = null;
    }
    if (defaultAutomationRunner && defaultAutomationRunner.isRunning()) {
      await defaultAutomationRunner.stop();
      console.log('Automation Runner stopped cleanly.');
    }
  } catch (err) {
    console.error('Error stopping automation runner:', err.message);
  }

  server.close(() => {
    console.log('SALSA Control Plane server closed.');
    process.exit(0);
  });
  setTimeout(() => {
    console.error('Forcing shutdown after timeout.');
    process.exit(1);
  }, 5000);
}

process.on('SIGTERM', () => handleShutdown('SIGTERM'));
process.on('SIGINT', () => handleShutdown('SIGINT'));

if (require.main === module) {
  startServer().catch(async (error) => {
    console.error(`[SALSA CONTROL PLANE] Startup aborted [${error.code || 'STARTUP_FAILURE'}]: ${error.message}`);
    try {
      const database = getDatabase();
      if (database && typeof database.end === 'function') await database.end();
    } catch (closeError) {
      console.error(`[SALSA CONTROL PLANE] Database cleanup failed: ${closeError.message}`);
    }
    process.exitCode = 1;
  });
}

module.exports = server;
module.exports.startServer = startServer;
