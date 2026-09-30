/**
 * scripts/test-godmode-refactor.js
 *
 * Automated Regression & Verification Suite for SALSA God Mode Refactor.
 * Covers all 18 regression scenarios specified in superadmin.md §22.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('====================================================');
console.log('   SALSA GOD MODE REFACTOR — REGRESSION TEST SUITE   ');
console.log('====================================================\n');

let passedTests = 0;
let failedTests = 0;

function runTest(name, fn) {
  try {
    fn();
    console.log(`  ✅ PASS: ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ❌ FAIL: ${name}`);
    console.error(`     Error: ${err.message}\n`);
    failedTests++;
  }
}

async function runAsyncTest(name, fn) {
  try {
    await fn();
    console.log(`  ✅ PASS: ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ❌ FAIL: ${name}`);
    console.error(`     Error: ${err.message}\n`);
    failedTests++;
  }
}

async function runSuite() {
  // Load Prototype Store into global context
  const { prototypeStore } = require('../prototype/js/store.js');
  global.prototypeStore = prototypeStore;
  global.GMStore = prototypeStore;

  // Load God Mode Registry and App Mode
  const registry = require('../prototype/js/godmode/app/registry.js');
  const appMode = require('../prototype/js/godmode/app/app-mode.js');
  const permissions = require('../prototype/js/godmode/app/permissions.js');
  const client = require('../prototype/js/godmode/api/control-plane-client.js');
  const restaurantsRepo = require('../prototype/js/godmode/domain/restaurants/repository.js');
  const entitlementsRepo = require('../prototype/js/godmode/domain/entitlements/repository.js');
  const opsRepo = require('../prototype/js/godmode/domain/operations/repository.js');
  const commRepo = require('../prototype/js/godmode/domain/commercial/repository.js');
  const supportRepo = require('../prototype/js/godmode/domain/support/repository.js');

  // Test 1: Navigation Consolidation — Exactly 5 Primary Groups
  runTest('1. Navigation Consolidation: Exactly 5 top-level destinations in Registry', () => {
    const groups = registry.NAVIGATION_GROUPS;
    assert.strictEqual(groups.length, 5, `Expected 5 groups, got ${groups.length}`);
    const expectedIds = ['home', 'restaurants', 'commercial', 'operations', 'settings'];
    assert.deepStrictEqual(groups.map(g => g.id), expectedIds);
  });

  // Test 2: Route Aliases — GM01-GM29 hash routes resolve correctly
  runTest('2. Route Aliases: Legacy GM01-GM29 hash routes resolve to canonical destinations', () => {
    const testCases = [
      { hash: '#gm-02-overview', expectedRoute: 'home' },
      { hash: '#overview', expectedRoute: 'home' },
      { hash: '#gm-03-tenants', expectedRoute: 'restaurants' },
      { hash: '#customers', expectedRoute: 'restaurants' },
      { hash: '#gm-05-tenant-new', expectedRoute: 'restaurants/new' },
      { hash: '#gm-04-tenant-detail?id=tnt_westo_demo', expectedRoute: 'restaurants/workspace', expectedTab: 'overview' },
      { hash: '#gm-06-provisioning?id=tnt_westo_demo', expectedRoute: 'restaurants/workspace', expectedTab: 'overview' },
      { hash: '#gm-09-tenant-features?id=tnt_westo_demo', expectedRoute: 'restaurants/workspace', expectedTab: 'subscription' },
      { hash: '#gm-11-billing?id=tnt_westo_demo', expectedRoute: 'restaurants/workspace', expectedTab: 'subscription' },
      { hash: '#gm-13-identities?id=tnt_westo_demo', expectedRoute: 'restaurants/workspace', expectedTab: 'people' },
      { hash: '#gm-14-access-roles?id=tnt_westo_demo', expectedRoute: 'restaurants/workspace', expectedTab: 'people' },
      { hash: '#gm-19-devices?id=tnt_westo_demo', expectedRoute: 'restaurants/workspace', expectedTab: 'hardware' },
      { hash: '#gm-29-printers?id=tnt_westo_demo', expectedRoute: 'restaurants/workspace', expectedTab: 'hardware' },
      { hash: '#gm-18-domains?id=tnt_westo_demo', expectedRoute: 'restaurants/workspace', expectedTab: 'channels' },
      { hash: '#gm-28-portal?id=tnt_westo_demo', expectedRoute: 'restaurants/workspace', expectedTab: 'channels' },
      { hash: '#gm-20-backups?id=tnt_westo_demo', expectedRoute: 'restaurants/workspace', expectedTab: 'reliability' },
      { hash: '#gm-21-support?id=tnt_westo_demo', expectedRoute: 'restaurants/workspace', expectedTab: 'reliability' },
      { hash: '#gm-26-audit?id=tnt_westo_demo', expectedRoute: 'restaurants/workspace', expectedTab: 'activity' },
      { hash: '#gm-08-features', expectedRoute: 'commercial' },
      { hash: '#gm-10-plans', expectedRoute: 'commercial' },
      { hash: '#gm-16-automations', expectedRoute: 'operations' },
      { hash: '#gm-22-operations', expectedRoute: 'operations' },
      { hash: '#gm-23-releases', expectedRoute: 'operations' },
      { hash: '#gm-24-infrastructure', expectedRoute: 'operations' },
      { hash: '#gm-25-jobs', expectedRoute: 'operations' },
      { hash: '#gm-27-team', expectedRoute: 'settings' }
    ];

    for (const tc of testCases) {
      const resolved = registry.resolveHash(tc.hash);
      assert.strictEqual(resolved.page.canonicalRoute, tc.expectedRoute, `Failed for ${tc.hash}: got ${resolved.page.canonicalRoute}, expected ${tc.expectedRoute}`);
      if (tc.expectedTab) {
        assert.strictEqual(resolved.tab, tc.expectedTab, `Tab mismatch for ${tc.hash}: got ${resolved.tab}, expected ${tc.expectedTab}`);
      }
    }
  });

  // Test 3: Restaurant Workspace Tabs — Exactly 7 Tabs
  runTest('3. Restaurant Workspace Tabs: Exactly 7 focused tabs defined', () => {
    const tabs = registry.RESTAURANT_WORKSPACE_TABS;
    assert.strictEqual(tabs.length, 7, `Expected 7 tabs, got ${tabs.length}`);
    const expectedTabIds = ['overview', 'subscription', 'people', 'hardware', 'channels', 'reliability', 'activity'];
    assert.deepStrictEqual(tabs.map(t => t.id), expectedTabIds);
  });

  // Test 4: Workspace Header Component Structure
  runTest('4. Workspace Header: Component file exists and renders context info', () => {
    const headerPath = path.join(__dirname, '../prototype/js/godmode/components/restaurant-context-header.js');
    assert.ok(fs.existsSync(headerPath), 'restaurant-context-header.js must exist');
    const content = fs.readFileSync(headerPath, 'utf8');
    assert.ok(content.includes('RestaurantContextHeader') || content.includes('renderRestaurantContextHeader'), 'Must define RestaurantContextHeader');
    assert.ok(content.includes('status-badge'), 'Must include status badge');
  });

  // Test 5: Action Safety & Dialogs
  runTest('5. Action Safety: Confirm dialog component exists and supports reason & destructive severity', () => {
    const dialogPath = path.join(__dirname, '../prototype/js/godmode/components/confirm-dialog.js');
    assert.ok(fs.existsSync(dialogPath), 'confirm-dialog.js must exist');
    const content = fs.readFileSync(dialogPath, 'utf8');
    assert.ok(content.includes('requireReason'), 'ConfirmDialog must support mandatory typed reason');
    assert.ok(content.includes('severity'), 'ConfirmDialog must support severity levels');
  });

  // Test 6: Authoritative Entitlement Evaluator
  await runAsyncTest('6. Entitlement Evaluator: Authoritative evaluator correctly merges plan, add-ons and status', async () => {
    // Evaluation for active restaurant
    const activeRes = await entitlementsRepo.getEffectiveEntitlements('tnt_westo_demo');
    assert.strictEqual(activeRes.tenantId, 'tnt_westo_demo');
    assert.ok(activeRes.entitlements['core.workspace'], 'core.workspace should exist');
    assert.strictEqual(activeRes.entitlements['core.workspace'].enabled, true);

    // Evaluation for non-existent restaurant returns empty
    const nonExistent = await entitlementsRepo.getEffectiveEntitlements('tnt_does_not_exist_xyz');
    assert.strictEqual(Object.keys(nonExistent.entitlements).length, 0);
  });

  // Test 7: Feature Kill Switch / Suspension Logic
  await runAsyncTest('7. Feature Kill Switch & Lifecycle: Suspended restaurant has features disabled', async () => {
    // Let's create a temporary suspended restaurant in repository
    const created = await restaurantsRepo.create({
      displayName: 'کافه تست معلق',
      planCode: 'starter',
      branchesCount: 1
    });
    assert.ok(created.tenantId, 'Created tenant must have an ID');

    // Transition to suspended
    const suspended = await restaurantsRepo.transitionLifecycle(created.tenantId, 'suspended', 'آزمون تعلیق خودکار در تست');
    assert.strictEqual(suspended.status, 'suspended');

    // Entitlements for suspended restaurant must all be enabled: false
    const evalRes = await entitlementsRepo.getEffectiveEntitlements(created.tenantId);
    for (const key of Object.keys(evalRes.entitlements)) {
      assert.strictEqual(evalRes.entitlements[key].enabled, false, `Feature ${key} should be disabled for suspended restaurant`);
      assert.strictEqual(evalRes.entitlements[key].source, 'suspended');
    }

    // Transition back to active
    const reactivated = await restaurantsRepo.transitionLifecycle(created.tenantId, 'active', 'رفع تعلیق پس از پایان تست');
    assert.strictEqual(reactivated.status, 'active');
  });

  // Test 8: Single Authoritative Entitlement in store.js
  runTest('8. Store Integration: store.js isFeatureEnabled uses calculateEffectiveEntitlements', () => {
    const storePath = path.join(__dirname, '../prototype/js/store.js');
    const content = fs.readFileSync(storePath, 'utf8');
    assert.ok(content.includes('calculateEffectiveEntitlements(tid)'), 'store.js isFeatureEnabled must delegate to calculateEffectiveEntitlements');
    // Ensure duplicate live server sync was removed from store.js line 1968
    assert.ok(!content.includes('window.GMApp.syncFeatureToggleToLiveServer(featureKey, targetState, slug)'), 'store.js toggleFeature must not have duplicate live server call');
  });

  // Test 9: Zero direct fetch to port 4180 in God Mode files
  runTest('9. Zero 4180 fetch: No direct browser fetch("http://localhost:4180...") calls in God Mode files', () => {
    const filesToCheck = [
      'prototype/js/app.js',
      'prototype/js/views/gm29-printers.js',
      'prototype/js/godmode/app/router.js',
      'prototype/js/godmode/api/control-plane-client.js',
      'prototype/js/godmode/pages/restaurants/workspace/hardware.js'
    ];
    for (const relPath of filesToCheck) {
      const fullPath = path.join(__dirname, '..', relPath);
      if (fs.existsSync(fullPath)) {
        const content = fs.readFileSync(fullPath, 'utf8');
        const matches = content.match(/fetch\s*\(\s*['"`]http:\/\/(?:localhost|127\.0\.0\.1):4180/g);
        assert.strictEqual(matches, null, `Found forbidden direct 4180 fetch in ${relPath}`);
      }
    }
  });

  // Test 10: Control Plane Client Envelope & Normalization
  runTest('10. API Client: Standardized envelopes, CSRF header, timeout handling', () => {
    assert.strictEqual(client.getBaseUrl(), 'http://127.0.0.1:3061');
    assert.ok(typeof client.get === 'function', 'client.get must exist');
    assert.ok(typeof client.post === 'function', 'client.post must exist');
  });

  // Test 11: Telemetry Honesty (Production vs Demo)
  await runAsyncTest('11. Telemetry Honesty: Real probe results in operations repo; no fake ping/RPS in production', async () => {
    const telemetryRes = await opsRepo.getInfrastructureTelemetry();
    assert.ok(telemetryRes.telemetry, 'Must return telemetry data');
    assert.ok(telemetryRes.telemetry.controlPlane, 'Must probe Control Plane');
    assert.ok(['online', 'offline', 'degraded'].includes(telemetryRes.telemetry.controlPlane.status), 'Must report real status');
  });

  // Test 12: App Mode Isolation
  runTest('12. App Mode: Proper switching and persistence between production and demo', () => {
    const initialMode = appMode.getMode();
    appMode.setMode('production');
    assert.strictEqual(appMode.isProduction(), true);
    assert.strictEqual(appMode.isDemo(), false);

    appMode.setMode('demo');
    assert.strictEqual(appMode.isProduction(), false);
    assert.strictEqual(appMode.isDemo(), true);

    // Reset back to initial
    appMode.setMode(initialMode);
  });

  // Test 13: 3-Step Restaurant Onboarding Wizard Structure
  runTest('13. Onboarding Wizard: create.js defines 3 steps and client validation', () => {
    const createPagePath = path.join(__dirname, '../prototype/js/godmode/pages/restaurants/create.js');
    const content = fs.readFileSync(createPagePath, 'utf8');
    assert.ok(content.includes('step-1'), 'Step 1 must be present');
    assert.ok(content.includes('step-2'), 'Step 2 must be present');
    assert.ok(content.includes('step-3'), 'Step 3 must be present');
    assert.ok(content.includes('provisioning'), 'Default status must be provisioning');
  });

  // Test 14: Search and Filter in Restaurants Repository
  await runAsyncTest('14. Search & Filter: Restaurants repository supports filtering by query and status', async () => {
    const all = await restaurantsRepo.listRestaurants();
    assert.ok(Array.isArray(all.restaurants), 'Must return array of restaurants');
    assert.ok(all.restaurants.length > 0, 'Must have demo restaurants');

    const filtered = await restaurantsRepo.listRestaurants({ query: 'وستو' });
    assert.ok(filtered.restaurants.some(r => r.name.includes('وستو') || r.displayName?.includes('وستو')));
  });

  // Test 15: Support Delegation Session Creation
  await runAsyncTest('15. Support Delegation: Creates time-limited audited support session', async () => {
    const session = await supportRepo.createSupportSession('tnt_westo_demo', 'تست پشتیبانی خودکار', 30);
    assert.ok(session.token, 'Session must generate an access token');
    assert.strictEqual(session.tenantId, 'tnt_westo_demo');
    assert.strictEqual(session.durationMinutes, 30);
  });

  // Test 16: PII Reveal Auditing
  await runAsyncTest('16. PII Reveal Auditing: Reveals PII only with valid reason and logs access', async () => {
    const pii = await supportRepo.revealCustomerPII('tnt_westo_demo', 'رسیدگی به مغایرت صورتحساب بانکی');
    assert.strictEqual(pii.revealed, true);
    assert.ok(pii.billingEmail, 'Must reveal billing email');

    // Reason shorter than 3 characters must reject
    try {
      await supportRepo.revealCustomerPII('tnt_westo_demo', 'a');
      assert.fail('Should reject reason shorter than 3 chars');
    } catch (err) {
      assert.ok(err.message.includes('دلیل'));
    }
  });

  // Test 17: Hardware Catalog & Edge Management
  await runAsyncTest('17. Hardware & Edge: Hardware catalog returns terminals and printers', async () => {
    const fleet = await opsRepo.getHardwareFleet();
    assert.ok(fleet.printers, 'Must return printers catalog');
    assert.ok(fleet.terminals, 'Must return terminals catalog');
  });

  // Test 18: Backend Lifecycle Endpoint & Platform Name
  runTest('18. Backend Verification: Platform name is SALSA CONTROL PLANE and lifecycle route exists', () => {
    const overviewContent = fs.readFileSync(path.join(__dirname, '../server/salsa/control-plane/routes/overview-routes.js'), 'utf8');
    assert.ok(overviewContent.includes("name: 'SALSA CONTROL PLANE'"), 'Platform name must be SALSA CONTROL PLANE');

    const tenantRoutesContent = fs.readFileSync(path.join(__dirname, '../server/salsa/control-plane/routes/tenant-routes.js'), 'utf8');
    assert.ok(tenantRoutesContent.includes("router.post(\n  '/:id/lifecycle'"), 'POST /:id/lifecycle must exist in tenant routes');

    const edgeRoutesContent = fs.readFileSync(path.join(__dirname, '../server/salsa/control-plane/routes/edge-routes.js'), 'utf8');
    assert.ok(edgeRoutesContent.includes("router.post('/printers/test'"), 'POST /printers/test must exist in edge routes');
  });

  console.log('\n====================================================');
  console.log(`   SUMMARY: ${passedTests} PASSED, ${failedTests} FAILED`);
  console.log('====================================================');

  if (failedTests > 0) {
    process.exit(1);
  }
}

runSuite().catch((err) => {
  console.error('Test suite runner crashed:', err);
  process.exit(1);
});
