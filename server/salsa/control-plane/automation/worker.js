'use strict';

/**
 * Standalone NEEM automation worker entrypoint.
 *
 * The HTTP Control Plane may run the AutomationRunner in-process, but a
 * production deployment must also be able to run the scheduler/outbox loop as
 * an independently supervised service. This entrypoint keeps the same
 * fail-closed database-readiness contract as server.js and owns graceful
 * shutdown of the runner and its database pool.
 */

const config = require('../config');
const { getDatabase } = require('../db/database');
const { assertControlPlaneDatabaseReady } = require('../db/readiness');

function createKeepAlive() {
  // The runner interval is intentionally unref'ed. A supervised standalone
  // worker still needs one explicit process lifetime handle so it cannot exit
  // silently when a database adapter is configured with no open socket.
  return setInterval(() => {}, 60_000);
}

async function startAutomationWorker({
  runtime = config,
  runner = null,
  database = null,
  readinessCheck = assertControlPlaneDatabaseReady,
  keepAlive = true
} = {}) {
  if (!runtime || typeof runtime.validate !== 'function') {
    throw new Error('AUTOMATION_WORKER_CONFIG_INVALID: runtime config validator is required.');
  }

  runtime.validate();
  if (runtime.automationEnabled === false) {
    const error = new Error('AUTOMATION_WORKER_DISABLED: NEEM_AUTOMATION_ENABLED=false.');
    error.code = 'AUTOMATION_WORKER_DISABLED';
    throw error;
  }

  const effectiveDatabase = database || getDatabase();
  let readiness = null;
  if (!runtime.isTest && !runtime.allowEphemeralDev) {
    try {
      readiness = await readinessCheck(effectiveDatabase);
    } catch (error) {
      if (effectiveDatabase && typeof effectiveDatabase.end === 'function') {
        await effectiveDatabase.end().catch(() => {});
      }
      throw error;
    }
    if (!readiness || readiness.ready !== true) {
      if (effectiveDatabase && typeof effectiveDatabase.end === 'function') {
        await effectiveDatabase.end().catch(() => {});
      }
      const error = new Error('CONTROL_PLANE_SCHEMA_NOT_READY: automation worker refuses to start.');
      error.code = 'CONTROL_PLANE_SCHEMA_NOT_READY';
      error.details = readiness || null;
      throw error;
    }
  }

  const effectiveRunner = runner || require('./automation-runner').defaultAutomationRunner;
  if (!effectiveRunner || typeof effectiveRunner.start !== 'function' || typeof effectiveRunner.stop !== 'function') {
    throw new Error('AUTOMATION_WORKER_RUNNER_INVALID: runner must expose start() and stop().');
  }

  effectiveRunner.start({ immediate: true });
  const keepAliveHandle = keepAlive ? createKeepAlive() : null;
  let stopped = false;

  return {
    runner: effectiveRunner,
    database: effectiveDatabase,
    readiness,
    async stop() {
      if (stopped) return;
      stopped = true;
      if (keepAliveHandle) clearInterval(keepAliveHandle);
      await effectiveRunner.stop();
      if (effectiveDatabase && typeof effectiveDatabase.end === 'function') {
        await effectiveDatabase.end();
      }
    }
  };
}

async function main() {
  const lifecycle = await startAutomationWorker();
  console.log(JSON.stringify({
    ok: true,
    service: 'neem-automation-worker',
    mode: config.env,
    readiness: lifecycle.readiness
  }));

  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[NEEM AUTOMATION WORKER] Received ${signal}; stopping gracefully.`);
    try {
      await lifecycle.stop();
      process.exitCode = 0;
    } catch (error) {
      console.error(`[NEEM AUTOMATION WORKER] Shutdown failed: ${error.message}`);
      process.exitCode = 1;
    }
  };

  process.once('SIGTERM', () => { shutdown('SIGTERM'); });
  process.once('SIGINT', () => { shutdown('SIGINT'); });
}

if (require.main === module) {
  main().catch(async (error) => {
    console.error(`[NEEM AUTOMATION WORKER] Startup aborted [${error.code || 'STARTUP_FAILURE'}]: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { createKeepAlive, startAutomationWorker, main };
