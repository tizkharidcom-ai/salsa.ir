/* Starts the untouched WESTO public site and the NEEM operations suite together. */
const crypto = require('crypto');
const path = require('path');
const { spawn } = require('child_process');

const root = path.join(__dirname, '..');
const neemRoot = path.join(root, 'neem-project');
const bridgeSecret = process.env.WESTO_NEEM_BRIDGE_SECRET || crypto.randomBytes(32).toString('hex');

const common = {
  ...process.env,
  WESTO_NEEM_BRIDGE_SECRET: bridgeSecret,
  NEEM_BRIDGE_URL: process.env.NEEM_BRIDGE_URL || 'http://127.0.0.1:4300/api/integrations/westo/events',
};

const westo = spawn(process.execPath, ['server/server.js'], {
  cwd: root,
  env: { ...common, PORT: process.env.PORT || '4180' },
  stdio: 'inherit',
});
const neem = spawn('bun', ['run', 'dev'], {
  cwd: neemRoot,
  env: { ...common, PORT: process.env.NEEM_PORT || '4300' },
  stdio: 'inherit',
});

let stopping = false;
function stop(signal) {
  if (stopping) return;
  stopping = true;
  for (const child of [westo, neem]) {
    if (!child.killed) child.kill(signal);
  }
}

process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));
for (const child of [westo, neem]) {
  child.on('exit', (code, signal) => {
    if (!stopping) {
      console.error(`[full-stack] ${child === westo ? 'WESTO' : 'NEEM'} stopped (${signal || code}); stopping the companion service.`);
      stop('SIGTERM');
      process.exitCode = code || 1;
    }
  });
}
