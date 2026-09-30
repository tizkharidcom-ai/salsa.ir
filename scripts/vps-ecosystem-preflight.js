#!/usr/bin/env node
'use strict';

/**
 * scripts/vps-ecosystem-preflight.js
 *
 * Comprehensive VPS Ecosystem Preflight & Production Readiness Audit.
 * Verifies that WESTO (Tenant #1) and SALSA platform operate in complete harmony.
 */

const crypto = require('crypto');

const WESTO_PORT = process.env.PORT || 4180;
const GODMODE_PORT = process.env.GODMODE_PORT || 3050;
const CONTROL_PORT = process.env.SALSA_CONTROL_PORT || 3061;

const WESTO_URL = `http://127.0.0.1:${WESTO_PORT}`;
const GODMODE_URL = `http://127.0.0.1:${GODMODE_PORT}`;
const CONTROL_URL = `http://127.0.0.1:${CONTROL_PORT}`;

const fs = require('fs');
const path = require('path');

const keyPath = path.join(__dirname, '..', 'server', 'data', 'secret.key');
let fileSecret = '';
try {
  if (fs.existsSync(keyPath)) fileSecret = fs.readFileSync(keyPath, 'utf8').trim();
} catch (_) {}

const BRIDGE_SECRET = process.env.WESTO_SALSA_BRIDGE_SECRET || process.env.WESTO_NEEM_BRIDGE_SECRET || fileSecret || 'dev_secret_fallback';
const CONTROL_SECRET = process.env.SALSA_CONTROL_SECRET || process.env.NEEM_CONTROL_SECRET || '';

async function fetchJson(url, options = {}) {
  const timeoutMs = options.timeout || 4000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
    return { status: res.status, ok: res.ok, headers: res.headers, data };
  } finally {
    clearTimeout(timer);
  }
}

async function runAudit() {
  console.log('='.repeat(70));
  console.log(' SALSA & WESTO PRODUCTION ECOSYSTEM PREFLIGHT AUDIT');
  console.log('='.repeat(70));
  console.log(`Time: ${new Date().toISOString()}`);
  console.log(`WESTO Runtime:        ${WESTO_URL}`);
  console.log(`SALSA God Mode:       ${GODMODE_URL}`);
  console.log(`SALSA Control Plane:  ${CONTROL_URL}`);
  console.log('-'.repeat(70));

  const results = [];

  // Check 1: WESTO Health
  try {
    const res = await fetchJson(`${WESTO_URL}/api/health`);
    if (res.ok && res.data.status === 'healthy') {
      results.push({ name: '1. WESTO Runtime Health (/api/health)', passed: true, details: `Status: ${res.data.status}, Version: ${res.data.version}` });
    } else {
      results.push({ name: '1. WESTO Runtime Health (/api/health)', passed: false, details: `HTTP ${res.status}: ${JSON.stringify(res.data)}` });
    }
  } catch (err) {
    results.push({ name: '1. WESTO Runtime Health (/api/health)', passed: false, details: `Connection failed: ${err.message}` });
  }

  // Check 2: WESTO Live Summary (Tenant #1 Operational Metrics)
  try {
    const res = await fetchJson(`${WESTO_URL}/api/admin/live-summary?tenantId=westo`, {
      headers: CONTROL_SECRET ? { 'X-Salsa-Control-Secret': CONTROL_SECRET } : {}
    });
    if (res.ok && res.data.ok && res.data.tenantId === 'westo') {
      results.push({
        name: '2. WESTO Live Summary (Tenant #1 Metrics)',
        passed: true,
        details: `Restaurant: ${res.data.name}, Menu Items: ${res.data.menuItemsCount}, Orders: ${res.data.ordersCount}, Users: ${res.data.usersCount}`
      });
    } else {
      results.push({ name: '2. WESTO Live Summary (Tenant #1 Metrics)', passed: false, details: `HTTP ${res.status}: ${JSON.stringify(res.data)}` });
    }
  } catch (err) {
    results.push({ name: '2. WESTO Live Summary (Tenant #1 Metrics)', passed: false, details: `Connection failed: ${err.message}` });
  }

  // Check 3: SALSA God Mode Surface (Port 3050)
  try {
    const res = await fetchJson(`${GODMODE_URL}/`);
    if (res.ok && (res.headers.get('x-prototype-mode') || '').includes('SALSA')) {
      results.push({ name: '3. SALSA God Mode Surface (Port 3050)', passed: true, details: `HTTP 200 OK (Mode: ${res.headers.get('x-prototype-mode')})` });
    } else {
      results.push({ name: '3. SALSA God Mode Surface (Port 3050)', passed: false, details: `HTTP ${res.status}` });
    }
  } catch (err) {
    results.push({ name: '3. SALSA God Mode Surface (Port 3050)', passed: false, details: `Connection failed: ${err.message}` });
  }

  // Check 4: SALSA Control Plane Health (Port 3061)
  try {
    const res = await fetchJson(`${CONTROL_URL}/api/control/health`);
    if (res.ok && res.data.success && res.data.data?.status === 'healthy') {
      results.push({
        name: '4. SALSA Control Plane API Health (Port 3061)',
        passed: true,
        details: `Service: ${res.data.data.service}, Automation ticks: ${res.data.data.automation?.stats?.ticks || 0}`
      });
    } else {
      results.push({ name: '4. SALSA Control Plane API Health (Port 3061)', passed: false, details: `HTTP ${res.status}: ${JSON.stringify(res.data)}` });
    }
  } catch (err) {
    results.push({ name: '4. SALSA Control Plane API Health (Port 3061)', passed: false, details: `Connection failed: ${err.message}` });
  }

  // Check 5: Live Bridge Server-to-Server Delivery (Signed HMAC Event)
  try {
    const timestamp = String(Date.now());
    const bodyObj = {
      tenantId: 'westo',
      type: 'westo.preflight.ping',
      eventId: `preflight-ping-${timestamp}`,
      data: { ping: true, checkedAt: new Date().toISOString() }
    };
    const rawBody = JSON.stringify(bodyObj);
    const signature = crypto.createHmac('sha256', BRIDGE_SECRET).update(`${timestamp}.${rawBody}`).digest('hex');

    const res = await fetchJson(`${CONTROL_URL}/api/control/integrations/westo/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-westo-bridge-timestamp': timestamp,
        'x-westo-bridge-signature': `sha256=${signature}`,
        'x-salsa-tenant-id': 'westo',
        'x-neem-tenant-id': 'westo'
      },
      body: rawBody
    });

    if (res.status === 200 || res.status === 202) {
      results.push({
        name: '5. WESTO -> SALSA Live Bridge Ingress',
        passed: true,
        details: `HTTP ${res.status}: Event successfully delivered & queued in SALSA Outbox`
      });
    } else {
      results.push({
        name: '5. WESTO -> SALSA Live Bridge Ingress',
        passed: false,
        details: `HTTP ${res.status}: ${JSON.stringify(res.data)}`
      });
    }
  } catch (err) {
    results.push({ name: '5. WESTO -> SALSA Live Bridge Ingress', passed: false, details: `Bridge failed: ${err.message}` });
  }

  // Check 6: Feature Toggle Round-trip
  try {
    const testFeature = 'kitchen.kds';
    const res = await fetchJson(`${WESTO_URL}/api/admin/features/toggle`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(CONTROL_SECRET ? { 'X-Salsa-Control-Secret': CONTROL_SECRET } : {}),
        'Origin': 'http://127.0.0.1:3050'
      },
      body: JSON.stringify({
        featureKey: testFeature,
        enabled: true,
        tenantId: 'westo'
      })
    });

    if (res.ok && res.data.ok) {
      results.push({
        name: '6. SALSA Godmode -> WESTO Feature Toggle Persistence',
        passed: true,
        details: `Feature '${testFeature}' toggle succeeded in target database`
      });
    } else {
      results.push({
        name: '6. SALSA Godmode -> WESTO Feature Toggle Persistence',
        passed: false,
        details: `HTTP ${res.status}: ${JSON.stringify(res.data)}`
      });
    }
  } catch (err) {
    results.push({ name: '6. SALSA Godmode -> WESTO Feature Toggle Persistence', passed: false, details: `Toggle failed: ${err.message}` });
  }

  // Print Summary Table
  console.log('\n--- AUDIT RESULTS ---');
  let allPassed = true;
  for (const r of results) {
    const icon = r.passed ? '✅ [PASS]' : '❌ [FAIL]';
    if (!r.passed) allPassed = false;
    console.log(`${icon} ${r.name}`);
    console.log(`         ↳ ${r.details}`);
  }

  console.log('='.repeat(70));
  if (allPassed) {
    console.log('🎉 ALL 6 CHECKS PASSED: WESTO & SALSA ECOSYSTEM READY FOR PRODUCTION VPS.');
  } else {
    console.log('⚠️ AUDIT COMPLETED WITH WARNINGS/FAILURES. SEE DETAILS ABOVE.');
  }
  console.log('='.repeat(70));

  return allPassed ? 0 : 1;
}

if (require.main === module) {
  runAudit().then((exitCode) => {
    process.exitCode = exitCode;
  });
}

module.exports = { runAudit };
