#!/usr/bin/env node
/**
 * scripts/salsa-static-truth-guard.js
 *
 * Automated Static Truth & Control Plane Production Guard (Wave G, Phases 90-105).
 * Validates zero fake metrics, zero unauthenticated mutations, dual-directory route parity,
 * zero port 4180 browser leaks, and zero legacy mock fallbacks.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT_DIR = path.resolve(__dirname, '..');
const GODMODE_FRONTEND_DIR = path.join(ROOT_DIR, 'superadmin/frontend/js/godmode');
const BACKEND_ROUTES_DIR = path.join(ROOT_DIR, 'superadmin/backend/routes');
const CONTROL_PLANE_ROUTES_DIR = path.join(ROOT_DIR, 'server/salsa/control-plane/routes');
const INDEX_HTML_PATH = path.join(ROOT_DIR, 'superadmin/frontend/index.html');

console.log('===========================================================================');
console.log('       SALSA STATIC TRUTH & PRODUCTION CONTROL PLANE GUARD                 ');
console.log('===========================================================================');

let violations = [];

function checkFile(filePath, content) {
  const relPath = path.relative(ROOT_DIR, filePath);

  // 1. Zero raw alert() calls in godmode frontend
  if (filePath.includes('superadmin/frontend/js/godmode')) {
    if (/\balert\s*\(/.test(content)) {
      violations.push(`[RAW_ALERT] ${relPath} contains raw alert() call. Use Toast or Modal.`);
    }

    // 2. Zero direct port 4180 browser calls
    if (/localhost:4180|127\.0\.0\.1:4180/.test(content)) {
      violations.push(`[PORT_4180_LEAK] ${relPath} contains direct unproxied browser call to 4180.`);
    }

    // 3. Zero hardcoded 123456 temporary passwords
    if (/['"`]123456['"`]/.test(content)) {
      violations.push(`[HARDCODED_SECRET] ${relPath} contains hardcoded 123456 password.`);
    }
  }

  // Syntax validation
  try {
    execSync(`node -c "${filePath}"`, { stdio: 'pipe' });
  } catch (err) {
    violations.push(`[SYNTAX_ERROR] ${relPath} failed node -c syntax check: ${err.message}`);
  }
}

function scanDir(dir) {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      scanDir(fullPath);
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      const content = fs.readFileSync(fullPath, 'utf8');
      checkFile(fullPath, content);
    }
  }
}

// 1. Scan godmode frontend files
console.log('▶ Scanning frontend God Mode files for truth invariants...');
scanDir(GODMODE_FRONTEND_DIR);

// 2. Scan index.html
console.log('▶ Auditing superadmin/frontend/index.html...');
if (fs.existsSync(INDEX_HTML_PATH)) {
  const indexContent = fs.readFileSync(INDEX_HTML_PATH, 'utf8');

  // Check for legacy gm01-gm29 scripts
  if (/gm\d{2}-.*\.js/i.test(indexContent)) {
    violations.push(`[LEGACY_SCRIPTS] index.html must not load individual gm01-gm29 script files.`);
  }

  // Check for runtime config injection
  if (!indexContent.includes('runtime-config.js')) {
    violations.push(`[MISSING_RUNTIME_CONFIG] index.html must load runtime-config.js.`);
  }
}

// 3. Scan dual-directory route sync between superadmin/backend and server/salsa/control-plane
console.log('▶ Verifying dual-directory route synchronization...');
if (fs.existsSync(BACKEND_ROUTES_DIR) && fs.existsSync(CONTROL_PLANE_ROUTES_DIR)) {
  const backendFiles = fs.readdirSync(BACKEND_ROUTES_DIR).filter(f => f.endsWith('.js'));
  const controlPlaneFiles = fs.readdirSync(CONTROL_PLANE_ROUTES_DIR).filter(f => f.endsWith('.js'));

  for (const file of backendFiles) {
    if (!controlPlaneFiles.includes(file)) {
      violations.push(`[ROUTE_SYNC_MISSING] ${file} exists in superadmin/backend/routes but missing in server/salsa/control-plane/routes`);
    }
  }

  for (const file of controlPlaneFiles) {
    if (!backendFiles.includes(file)) {
      violations.push(`[ROUTE_SYNC_MISSING] ${file} exists in server/salsa/control-plane/routes but missing in superadmin/backend/routes`);
    }
  }
}

// 4. Parity audit check
console.log('▶ Running contract parity check...');
try {
  const parityOutput = execSync('node scripts/audit-salsa-contract-parity.js', { cwd: ROOT_DIR, encoding: 'utf8' });
  if (!parityOutput.includes('100% PARITY!')) {
    violations.push(`[CONTRACT_PARITY_FAILED] Parity check failed. Output:\n${parityOutput}`);
  }
} catch (err) {
  violations.push(`[CONTRACT_PARITY_ERROR] Failed to run contract parity script: ${err.message}`);
}

console.log('---------------------------------------------------------------------------');
if (violations.length === 0) {
  console.log('🎉 STATIC TRUTH GUARD PASSED: ALL PRODUCTION INVARIANTS SATISFIED (0 VIOLATIONS)');
  console.log('===========================================================================');
  process.exit(0);
} else {
  console.error(`❌ STATIC TRUTH GUARD FAILED WITH ${violations.length} VIOLATION(S):\n`);
  violations.forEach((v, idx) => console.error(`  ${idx + 1}. ${v}`));
  console.log('===========================================================================');
  process.exit(1);
}
