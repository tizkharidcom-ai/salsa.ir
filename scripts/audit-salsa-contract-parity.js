#!/usr/bin/env node
'use strict';

/**
 * scripts/audit-salsa-contract-parity.js
 *
 * Scans all frontend God Mode files (superadmin/frontend/js/godmode/**) for /api/control/... calls,
 * compares against docs/salsa/inventory/control-plane-routes.json, and checks contract parity.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const FRONTEND_DIR = path.join(ROOT, 'superadmin', 'frontend', 'js', 'godmode');
const INVENTORY_FILE = path.join(ROOT, 'docs', 'salsa', 'inventory', 'control-plane-routes.json');

// Ensure inventory is fresh
try {
  execSync('node scripts/extract-salsa-control-plane-routes.js', { cwd: ROOT, stdio: 'pipe' });
} catch (e) {
  console.error('Warning: could not re-run extract-salsa-control-plane-routes.js:', e.message);
}

if (!fs.existsSync(INVENTORY_FILE)) {
  console.error('Error: route inventory file not found at', INVENTORY_FILE);
  process.exit(1);
}

const inventoryData = JSON.parse(fs.readFileSync(INVENTORY_FILE, 'utf8'));
const backendRoutes = inventoryData.routes || [];

function collectFiles(dir, ext = '.js') {
  let files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files = files.concat(collectFiles(full, ext));
    } else if (entry.isFile() && entry.name.endsWith(ext)) {
      files.push(full);
    }
  }
  return files;
}

const feFiles = collectFiles(FRONTEND_DIR);
const feEndpoints = new Map(); // endpoint -> { methods: Set, sources: Set }

const URL_REGEX = /['"`](\/api\/control\/[a-zA-Z0-9_\-\/:${}]+)['"`]/g;

for (const file of feFiles) {
  const content = fs.readFileSync(file, 'utf8');
  let match;
  while ((match = URL_REGEX.exec(content)) !== null) {
    let rawEndpoint = match[1];
    let normalized = rawEndpoint
      .replace(/\$\{[^}]+\}/g, ':param')
      .replace(/\/\d+/g, '/:id');
    normalized = normalized.split('?')[0];

    if (!feEndpoints.has(normalized)) {
      feEndpoints.set(normalized, { sources: new Set() });
    }
    const rel = path.relative(ROOT, file);
    feEndpoints.get(normalized).sources.add(rel);
  }
}

function matchRoute(fePath, bePath) {
  const feSegments = fePath.split('/').filter(Boolean);
  const beSegments = bePath.split('/').filter(Boolean);
  if (feSegments.length !== beSegments.length) return false;
  for (let i = 0; i < feSegments.length; i++) {
    const feSeg = feSegments[i];
    const beSeg = beSegments[i];
    if (beSeg.startsWith(':') || feSeg.startsWith(':')) continue;
    if (beSeg !== feSeg) return false;
  }
  return true;
}

const matched = [];
const missing = [];

for (const [endpoint, info] of feEndpoints.entries()) {
  const matchingBeRoute = backendRoutes.find(r => matchRoute(endpoint, r.path));
  if (matchingBeRoute) {
    matched.push({ endpoint, bePath: matchingBeRoute.path, method: matchingBeRoute.method });
  } else {
    missing.push({ endpoint, sources: Array.from(info.sources) });
  }
}

console.log('='.repeat(75));
console.log('  SALSA CONTROL PLANE: FRONTEND / BACKEND CONTRACT PARITY AUDIT');
console.log('='.repeat(75));
console.log(`Frontend Files Scanned: ${feFiles.length}`);
console.log(`Frontend Endpoints Detected: ${feEndpoints.size}`);
console.log(`Backend Routes in Inventory: ${backendRoutes.length}`);
console.log(`Matched: ${matched.length} | Missing: ${missing.length}`);
console.log('-'.repeat(75));

if (missing.length === 0) {
  console.log('🎉 100% PARITY! ALL FRONTEND ENDPOINTS HAVE MOUNTED BACKEND ROUTES.');
} else {
  console.log(`⚠️ MISSING BACKEND ROUTES (${missing.length}):`);
  for (const item of missing) {
    console.log(`  ✗ ${item.endpoint}`);
    item.sources.slice(0, 2).forEach(src => console.log(`      ↳ ${src}`));
  }
}
console.log('='.repeat(75));

if (missing.length > 0) {
  process.exitCode = 1;
}
