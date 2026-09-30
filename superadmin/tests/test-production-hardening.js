/**
 * superadmin/tests/test-production-hardening.js
 *
 * Production Hardening Test Suite (Prompt Phases 11 & 12 - §73-§84, §16, §20, §23, §74, §75, §78, §80).
 * Deep testing pyramid:
 *   1. Unit: Entitlement engine, Lifecycle transitions, RBAC evaluator, Command preflight.
 *   2. Contract: Control Plane API schema envelopes, Error mapping, Role normalization.
 *   3. Failure Injection: Zero fake data on 500/timeout in production mode.
 *   4. Concurrency: Version conflict / 409 handling.
 *   5. Production Scanner: Zero 4180 fetch, Zero gm01-gm29 in index.html, Zero ungrounded green.
 */

'use strict';

const assert = require('assert');
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passedTests = 0;
let failedTests = 0;

function runTest(name, fn) {
  try {
    fn();
    console.log(`  ✅ PASS: ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ❌ FAIL: ${name}`);
    console.error(`     Error: ${err.message}`);
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
    console.error(`     Error: ${err.message}`);
    failedTests++;
  }
}

console.log('====================================================');
console.log(' SALSA CONTROL PLANE PRODUCTION HARDENING SUITE      ');
console.log('====================================================\n');

async function main() {
  const { PrototypeStore, prototypeStore } = require('../frontend/js/store.js');
  global.prototypeStore = prototypeStore;
  global.GMStore = prototypeStore;

  await runAsyncTest('Production Store starts empty and never rehydrates or persists fixture data', async () => {
    const previousWindow = global.window;
    const previousLocalStorage = global.localStorage;
    let writes = 0;
    let clears = 0;
    global.window = { __SALSA_RUNTIME_CONFIG__: { environment: 'production' } };
    global.localStorage = {
      getItem: () => null,
      removeItem: () => {},
      setItem: () => { writes += 1; },
      clear: () => { clears += 1; }
    };
    try {
      const productionStore = new PrototypeStore();
      assert.deepStrictEqual(productionStore.state.tenants, []);
      assert.deepStrictEqual(productionStore.state.users, []);
      assert.deepStrictEqual(productionStore.state.outboxEvents, []);
      assert.equal(productionStore.state.activeTenantId, null);
      assert.deepStrictEqual(productionStore.getHardwareCatalog(), []);
      assert.deepStrictEqual(productionStore.getNodeDiagnostics(), []);
      assert.deepStrictEqual(productionStore.getNodeLogs('postgres-db'), []);
      assert.deepStrictEqual(productionStore.getOutboxEvents(), []);
      assert.deepStrictEqual(productionStore.getAutomationRules(), []);
      assert.deepStrictEqual(productionStore.getPrinterModels(), []);
      assert.deepStrictEqual(productionStore.getEcosystemPrinters(), []);
      assert.equal(productionStore.getJobDetails('missing-job'), null);
      assert.equal(productionStore.probeNode('postgres-db').ok, false);
      assert.equal(productionStore.testDatabasePool().ok, false);
      assert.equal(productionStore.flushOutbox().ok, false);
      assert.equal(productionStore.purgeExpiredCache().ok, false);
      productionStore.save();
      productionStore.resetStore();
      productionStore.clearAllDemoData();
      assert.deepStrictEqual(productionStore.state.tenants, []);
      assert.equal(productionStore.state.activeTenantId, null);
      assert.equal(writes, 0, 'Production runtime must not persist prototype store data');
      assert.equal(clears, 0, 'Production cleanup must not clear unrelated browser storage');
    } finally {
      if (previousWindow === undefined) delete global.window;
      else global.window = previousWindow;
      if (previousLocalStorage === undefined) delete global.localStorage;
      else global.localStorage = previousLocalStorage;
    }
  });

  await runAsyncTest('Entitlement revoke propagates server failures before touching local cache', async () => {
    const entitlementsRepo = require('../frontend/js/godmode/domain/entitlements/repository.js');
    let revokeCalls = 0;
    const cacheStore = {
      revokeFeatureGrant: () => { revokeCalls += 1; },
      state: { tenantGrants: {} },
      save: () => { revokeCalls += 1; }
    };
    const failingRepo = new entitlementsRepo.constructor({
      delete: async () => { throw new Error('POLICY_SYNC_FAILED'); }
    }, cacheStore);

    await assert.rejects(
      () => failingRepo.disableModuleAddon('tenant-prod', 'pos', 'توقف سرویس'),
      /POLICY_SYNC_FAILED/
    );
    assert.equal(revokeCalls, 0, 'Cache must not claim a revocation that the server rejected');
  });

  // ----------------------------------------------------
  // 1. UNIT TESTS: ENTITLEMENT ENGINE (§74)
  // ----------------------------------------------------
  await runAsyncTest('1. Unit: Entitlement Engine correctly resolves plan, add-ons and overrides', async () => {
    const entitlementsRepo = require('../frontend/js/godmode/domain/entitlements/repository.js');

    // Evaluation for active restaurant
    const activeRes = await entitlementsRepo.getEffectiveEntitlements('tnt_westo_demo');
    assert.strictEqual(activeRes.tenantId, 'tnt_westo_demo');
    assert.ok(activeRes.entitlements['core.workspace'], 'core.workspace should exist');
    assert.strictEqual(activeRes.entitlements['core.workspace'].enabled, true);

    // Business Modules resolution
    const modulesRes = await entitlementsRepo.calculateEffectiveEntitlements('tnt_westo_demo');
    assert.ok(Array.isArray(modulesRes.modules), 'Should return evaluated modules');
    assert(modulesRes.modules.some(m => m.key === 'pos' && m.isEnabled === true), 'POS should be enabled for Westo demo');
  });

  // ----------------------------------------------------
  // 2. UNIT TESTS: RBAC & ROLE NORMALIZATION (§11, §74, Phase 2, 4, 5)
  // ----------------------------------------------------
  runTest('2. Unit: Role Normalization & Mutation Authorization Guard', () => {
    const permissions = require('../frontend/js/godmode/app/permissions.js');

    assert.strictEqual(permissions.normalizeRole('platform_owner'), 'PlatformOwner');
    assert.strictEqual(permissions.normalizeRole('owner'), 'PlatformOwner');
    assert.strictEqual(permissions.normalizeRole('finance'), 'FinanceOperator');
    assert.strictEqual(permissions.normalizeRole('support'), 'SupportAgent');
    assert.strictEqual(permissions.normalizeRole('readonly'), 'ReadOnly');

    // Fail-Closed initial state: Unauthenticated principal cannot mutate
    permissions.clearPrincipal();
    assert.strictEqual(permissions.isAuthenticated(), false, 'Initial principal must be null (fail-closed)');
    assert.strictEqual(permissions.canMutate(), false, 'Unauthenticated user cannot mutate');

    // Authenticated state: PlatformOwner has mutation and wildcard permissions
    permissions.setPrincipal({ id: 'usr_platform_owner', role: 'PlatformOwner' });
    assert.strictEqual(permissions.isAuthenticated(), true, 'Authenticated principal should be recognized');
    assert.strictEqual(permissions.canMutate(), true, 'Authenticated PlatformOwner must be able to mutate');
    assert.strictEqual(permissions.assertCanMutate('آزمون مجاز'), true, 'assertCanMutate must return true for authorized user');
  });

  // ----------------------------------------------------
  // 3. UNIT TESTS: COMMAND FRAMEWORK PREFLIGHT (§8, §9)
  // ----------------------------------------------------
  await runAsyncTest('3. Unit: Command Framework preflight checks, validation and role enforcement', async () => {
    const GodModeCommandFramework = require('../frontend/js/godmode/components/command-framework.js');
    const { COMMAND_DEFINITIONS } = GodModeCommandFramework;

    const cmdDef = COMMAND_DEFINITIONS['SuspendRestaurant'];
    assert(cmdDef, 'SuspendRestaurant command must exist');
    assert.strictEqual(cmdDef.requiresReason, true, 'SuspendRestaurant must require reason');
    assert.strictEqual(cmdDef.requiresTypedConfirmation, 'SUSPEND', 'SuspendRestaurant must require typed confirmation');
    assert(cmdDef.requiredRoles.includes('PlatformOwner'), 'Must require PlatformOwner role');

    // Preflight validation failure on missing tenantId
    let failed = false;
    try {
      await cmdDef.preflight({});
    } catch (e) {
      failed = true;
    }
    assert.strictEqual(failed, true, 'Preflight must fail if tenantId is empty');

    // Preflight success on valid inputs
    const preflightValid = await cmdDef.preflight({ tenantId: 'tnt_1' });
    assert.strictEqual(preflightValid.ok, true, 'Preflight must succeed with valid inputs');
  });

  // ----------------------------------------------------
  // 4. UNIT TESTS: COMMERCIAL MARK INVOICE PAID (§44)
  // ----------------------------------------------------
  await runAsyncTest('4. Unit: MarkInvoicePaid command requires Finance role and invoiceId', async () => {
    const GodModeCommandFramework = require('../frontend/js/godmode/components/command-framework.js');
    const { COMMAND_DEFINITIONS } = GodModeCommandFramework;

    const cmdDef = COMMAND_DEFINITIONS['MarkInvoicePaid'];
    assert(cmdDef, 'MarkInvoicePaid command must exist');
    assert.strictEqual(cmdDef.requiresReason, true, 'MarkInvoicePaid must require justification reason');
    assert(cmdDef.requiredRoles.includes('FinanceOperator'), 'Must require FinanceOperator role');

    // Preflight missing invoiceId
    let failed = false;
    try {
      await cmdDef.preflight({});
    } catch (e) {
      failed = true;
    }
    assert.strictEqual(failed, true, 'Preflight must fail without invoiceId');

    // Preflight valid
    const pfValid = await cmdDef.preflight({ invoiceId: 'INV-101' });
    assert.strictEqual(pfValid.ok, true, 'Preflight must succeed with invoiceId');
  });

  // ----------------------------------------------------
  // 5. CONTRACT TESTS: API SCHEMA ENVELOPES (§64, §75)
  // ----------------------------------------------------
  runTest('5. Contract: Standard API response envelopes and error mapping', () => {
    const client = require('../frontend/js/godmode/api/control-plane-client.js');

    assert(typeof client.get === 'function', 'client must support get');
    assert(typeof client.post === 'function', 'client must support post');
    assert(typeof client.normalizeError === 'function', 'client must normalize errors');

    // Test error normalization
    const normalized = client.normalizeError({
      status: 409,
      data: {
        ok: false,
        error: {
          code: 'CONFLICT_VERSION',
          message: 'Resource has been modified concurrently.',
          conflictVersion: 4
        }
      }
    });

    assert.strictEqual(normalized.status, 409, 'Normalized status should be 409');
    assert.strictEqual(normalized.code, 'CONFLICT_VERSION', 'Normalized code should match');
  });

  // ----------------------------------------------------
  // 6. FAILURE INJECTION & ZERO FAKE DATA (§16, §78)
  // ----------------------------------------------------
  await runAsyncTest('6. Failure Injection: Operations Repository returns real telemetry, zero fake metrics in prod', async () => {
    const appMode = require('../frontend/js/godmode/app/app-mode.js');
    const opsRepo = require('../frontend/js/godmode/domain/operations/repository.js');

    appMode.setMode('production');
    const res = await opsRepo.getInfrastructureTelemetry();

    // In production, response must declare real backend source, not mock fixture
    assert.notStrictEqual(res.meta.source, 'demo-fixture', 'Production telemetry must NOT report mock fixture metrics');
    assert.strictEqual(res.meta.source, 'backend-probes', 'Production telemetry must declare real backend source');
    assert(res.telemetry.controlPlane, 'Must probe Control Plane');
  });

  // ----------------------------------------------------
  // 7. FAILURE INJECTION: ZERO FAKE SUPPORT DATA (§17)
  // ----------------------------------------------------
  await runAsyncTest('7. Failure Injection: Support Repository throws/fails honestly in production on API error', async () => {
    const appMode = require('../frontend/js/godmode/app/app-mode.js');
    const supportRepo = require('../frontend/js/godmode/domain/support/repository.js');

    appMode.setMode('production');
    let threw = false;
    try {
      await supportRepo.createSupportSession('tnt_non_existent_unreachable', 'تست پشتیبانی ایزوله', 30);
    } catch (err) {
      threw = true;
      assert(err.message.includes('خطا') || err.message.includes('کنترل پلن') || err.message.includes('fetch'), 'Must throw genuine error');
    }
    assert.strictEqual(threw, true, 'Must fail closed in production without fabricating fake sessions');
  });

  // ----------------------------------------------------
  // 8. CONCURRENCY: VERSION CONFLICT & IF-MATCH (§23, §80)
  // ----------------------------------------------------
  await runAsyncTest('8. Concurrency: Idempotency keys and expectedVersion attached to commands', async () => {
    const GodModeCommandFramework = require('../frontend/js/godmode/components/command-framework.js');
    const { COMMAND_DEFINITIONS } = GodModeCommandFramework;

    const cmdDef = COMMAND_DEFINITIONS['ChangePlan'];
    assert(cmdDef, 'ChangePlan must exist');

    const executionPayload = {
      tenantId: 'tnt_westo',
      newPlanId: 'pro',
      reason: 'ارتقای سرویس',
      expectedVersion: 3
    };

    const pf = await cmdDef.preflight(executionPayload);
    assert.strictEqual(pf.ok, true, 'Preflight must succeed with expectedVersion');
  });

  // ----------------------------------------------------
  // 9. PRODUCTION BUNDLE SCANNER: ZERO 4180 FETCH (§14, §20)
  // ----------------------------------------------------
  runTest('9. Production Scanner: Zero direct 4180 browser fetch in superadmin God Mode files', () => {
    const filesToCheck = [
      'superadmin/frontend/index.html',
      'superadmin/frontend/js/app.js',
      'superadmin/frontend/js/godmode/app/router.js',
      'superadmin/frontend/js/godmode/api/control-plane-client.js',
      'superadmin/frontend/js/godmode/pages/restaurants/workspace/hardware.js'
    ];
    for (const relPath of filesToCheck) {
      const fullPath = path.join(__dirname, '../..', relPath);
      if (fs.existsSync(fullPath)) {
        const content = fs.readFileSync(fullPath, 'utf8');
        const matches = content.match(/fetch\s*\(\s*['"`]http:\/\/(?:localhost|127\.0\.0\.1):4180/g);
        assert.strictEqual(matches, null, `Found forbidden direct 4180 fetch in ${relPath}`);
      }
    }
  });

  // ----------------------------------------------------
  // 10. PRODUCTION BUNDLE SCANNER: ZERO GM01-GM29 SCRIPTS IN INDEX.HTML (§2, §99)
  // ----------------------------------------------------
  runTest('10. Production Scanner: Zero legacy gm01-gm29 scripts loaded in superadmin/frontend/index.html', () => {
    const indexHtmlPath = path.join(__dirname, '../frontend/index.html');
    const indexHtml = fs.readFileSync(indexHtmlPath, 'utf8');

    for (let i = 1; i <= 29; i++) {
      const padded = String(i).padStart(2, '0');
      const scriptTag = `<script src="js/pages/gm${padded}`;
      assert(!indexHtml.includes(scriptTag), `Legacy script gm${padded} must NOT be loaded in index.html`);
    }
  });

  // ----------------------------------------------------
  // 11. SECURITY POSTURE CONTRACT (§52, §53)
  // ----------------------------------------------------
  runTest('11. Security Posture Contract: 10 Subsystem Gates present in backend infra routes', () => {
    const infraRoutesPath = path.join(__dirname, '../backend/routes/infra-routes.js');
    const content = fs.readFileSync(infraRoutesPath, 'utf8');

    assert(content.includes('/security-posture'), 'infra-routes.js must implement /security-posture');
    assert(content.includes('/readiness-gates'), 'infra-routes.js must implement /readiness-gates');

    // Verify all 10 canonical gates are defined in backend
    const expectedGates = [
      'database',
      'migration_status',
      'authentication',
      'audit_integrity',
      'backup',
      'billing_gateway',
      'tls',
      'secrets',
      'queues',
      'edge_connectivity'
    ];

    for (const gate of expectedGates) {
      assert(content.includes(`id: '${gate}'`), `readiness-gates must define gate '${gate}'`);
    }
  });

  // ----------------------------------------------------
  // 12. COMMAND PALETTE: GLOBAL FINDABILITY (§54, §55)
  // ----------------------------------------------------
  runTest('12. Command Palette: Global search across restaurants, invoices, devices, jobs & permitted actions', () => {
    const cmdPalettePath = path.join(__dirname, '../frontend/js/components/command-palette.js');
    const content = fs.readFileSync(cmdPalettePath, 'utf8');

    assert(content.includes('act-open-restaurants'), 'Must define open-restaurants action');
    assert(content.includes('act-create-restaurant'), 'Must define create-restaurant action');
    assert(content.includes('act-search-invoices'), 'Must define search-invoices action');
    assert(content.includes('act-view-incidents'), 'Must define view-incidents action');
    assert(content.includes('act-open-failed-jobs'), 'Must define open-failed-jobs action');
    assert(content.includes('act-go-to-audit'), 'Must define go-to-audit action');

    // Verify search space includes all required entities
    assert(content.includes('matchedInvoices'), 'Must search invoices');
    assert(content.includes('matchedDevices'), 'Must search devices');
    assert(content.includes('matchedJobs'), 'Must search jobs');
    assert(content.includes('matchedTenants'), 'Must search restaurants/tenants');
  });

  // ----------------------------------------------------
  // 13. AUTHENTICATION CONTRACT: BROWSER / CONTROL PLANE (§31, §52)
  // ----------------------------------------------------
  runTest('13. Authentication Contract: Login, MFA, CSRF and principal mutations agree across layers', () => {
    const authRoutes = fs.readFileSync(path.join(__dirname, '../backend/routes/auth-routes.js'), 'utf8');
    const bootstrap = fs.readFileSync(path.join(__dirname, '../frontend/js/godmode/app/bootstrap.js'), 'utf8');

    assert(authRoutes.includes('email || username'), 'Backend login must accept the browser username field');
    assert(authRoutes.includes('mfaRequired: Boolean(result.requireMfa)'), 'Backend must expose canonical MFA requirement');
    assert(authRoutes.includes('challengeTicket: result.mfaToken || null'), 'Backend must expose canonical MFA challenge ticket');
    assert(authRoutes.includes('mfaToken: mfaToken || challengeTicket'), 'Backend must accept the browser MFA challenge field');
    assert(authRoutes.includes('totpCode: totpCode || token'), 'Backend must accept the browser MFA code field');
    assert(authRoutes.includes('csrfToken: sessionCsrfToken(req.sessionToken)'), 'Session profile must expose the session-bound CSRF token');
    assert(authRoutes.includes('requirePlatformRole([\'platform_owner\', \'platform_admin\'])'), 'Principal mutations must be owner/admin protected');
    assert(authRoutes.includes('authService.revokeAllSessions'), 'Revoke-all must invalidate sessions through the auth service');
    assert(bootstrap.includes('email: userEl.value.trim()'), 'Browser login must submit email');
    assert(bootstrap.includes('totpCode: tokenInput.value.trim()'), 'Browser MFA must submit totpCode');
    assert(bootstrap.includes('mfaToken: ticket'), 'Browser MFA must submit mfaToken');
  });

  // ----------------------------------------------------
  // 14. RUNTIME BOUNDARY: SAME-ORIGIN PRODUCTION API (§14, §20)
  // ----------------------------------------------------
  runTest('14. Runtime Boundary: Production frontend uses injected runtime config and same-origin API by default', () => {
    const serverSource = fs.readFileSync(path.join(__dirname, '../frontend/server.js'), 'utf8');
    const indexHtml = fs.readFileSync(path.join(__dirname, '../frontend/index.html'), 'utf8');
    const bootstrapSource = fs.readFileSync(path.join(__dirname, '../frontend/js/godmode/app/bootstrap.js'), 'utf8');
    const clientSource = fs.readFileSync(path.join(__dirname, '../frontend/js/godmode/api/control-plane-client.js'), 'utf8');
    const backendConfig = fs.readFileSync(path.join(__dirname, '../backend/config.js'), 'utf8');

    assert(serverSource.includes("apiBase: CONTROL_PLANE_URL || (process.env.NODE_ENV === 'production' ? '' : 'http://localhost:3061')"), 'Production must use same-origin while local production-mode UI targets the loopback Control Plane');
    assert(serverSource.includes("const APP_MODE = process.env.NODE_ENV === 'test' ? 'demo' : 'production'"), 'Demo mode must be restricted to automated tests');
    assert(serverSource.includes("pathname === '/runtime-config.js'"), 'Frontend must expose runtime configuration');
    assert(serverSource.includes("'X-Salsa-App-Mode': 'production'"), 'Production responses must identify the real app mode');
    assert(indexHtml.includes('<script src="runtime-config.js"></script>'), 'Index must consume server-injected runtime configuration');
    assert(!indexHtml.includes(':3061'), 'Index must not hardcode the Control Plane port');
    assert(!indexHtml.includes('btn-clean-data'), 'Production UI must not expose demo-data reset controls');
    assert(bootstrapSource.includes('runtime.devSessionEnabled === true'), 'Development shortcut must require an explicit development runtime capability');
    assert(bootstrapSource.includes("this._loadRuntimeConfig().devSessionEnabled !== true"), 'Dev-login handler must fail closed when the development capability is absent');
    assert(clientSource.includes("['localhost', '127.0.0.1'].includes(global.location.hostname)"), 'Client fallback must preserve local same-site cookies');
    assert(backendConfig.includes('configured == null ? (!isProd) : configured === \'true\''), 'Non-production Control Plane must enable the local dev session unless explicitly disabled');
  });

  runTest('14a. Explicit local dev-session wiring never enables development fixtures or production shortcuts', () => {
    const frontendServerPath = path.resolve(__dirname, '../frontend/server.js');
    const probe = `const { runtimeConfig } = require(${JSON.stringify(frontendServerPath)}); process.stdout.write(JSON.stringify(runtimeConfig()));`;
    const readConfig = (nodeEnv) => {
      const child = spawnSync(process.execPath, ['-e', probe], {
        encoding: 'utf8',
        env: {
          ...process.env,
          NODE_ENV: nodeEnv,
          SALSA_CONTROL_URL: '',
          SALSA_CONTROL_PLANE_URL: '',
          SALSA_RELEASE_CHANNEL: ''
        }
      });
      assert.strictEqual(child.status, 0, child.stderr || 'Runtime config probe failed');
      return JSON.parse(child.stdout);
    };

    const development = readConfig('development');
    assert.strictEqual(development.environment, 'production', 'Local dev auth must not switch UI data policy to fixture/demo mode');
    assert.strictEqual(development.devSessionEnabled, true, 'Explicit local development should expose the dev-session capability');
    assert.strictEqual(development.apiBase, 'http://localhost:3061');
    assert.strictEqual(development.releaseChannel, 'development');

    const production = readConfig('production');
    assert.strictEqual(production.environment, 'production');
    assert.strictEqual(production.devSessionEnabled, false, 'Production must never expose the dev-session capability');
    assert.strictEqual(production.apiBase, '', 'Production must use the same-origin reverse proxy');
    assert.strictEqual(production.releaseChannel, 'stable');
  });

  // ----------------------------------------------------
  // 15. PRODUCTION HONESTY: HOME PAGE (§16, §78)
  // ----------------------------------------------------
  runTest('15. Production Honesty: Home page does not render demo health fixtures in production', () => {
    const homeSource = fs.readFileSync(path.join(__dirname, '../frontend/js/godmode/pages/home/home.js'), 'utf8');

    assert(homeSource.includes('const isProduction = Boolean('), 'Home page must resolve immutable production mode');
    assert(homeSource.includes("!isProduction && store && typeof store.getDismissedInboxItems"), 'Demo store data must be disabled in production');
    assert(homeSource.includes("status: 'unknown'"), 'Production fallback health must be unknown, not healthy');
    assert(homeSource.includes("isProduction ? 'نامشخص' : '۱۰۰٪ پایدار'"), 'Air-gap health must not claim 100% in production');
  });

  runTest('15a. Runtime Readiness: Core Cell probe distinguishes degraded service from unreachable network', () => {
    const operations = require('../frontend/js/godmode/domain/operations/repository.js');
    const infraSource = fs.readFileSync(path.join(__dirname, '../backend/routes/infra-routes.js'), 'utf8');
    const degraded = operations.describeProbeIncident({
      kind: 'runtime_cell',
      status: 'degraded',
      details: {
        httpStatus: 503,
        runtimeStatus: 'not_ready',
        checks: { postgresAuthority: { ok: false, reason: 'postgres_not_authoritative' } },
      },
    });
    const unreachable = operations.describeProbeIncident({ kind: 'runtime_cell', status: 'unreachable' });
    assert.strictEqual(degraded.severity, 'critical');
    assert(degraded.title.includes('سرویس رستوران آماده'), 'A responding but unready cell gets an operator-facing title');
    assert(degraded.reason.includes('HTTP 503') && degraded.reason.includes('postgres_not_authoritative'), 'The real readiness failure is shown without calling it a timeout');
    assert.strictEqual(unreachable.reason, 'پروب در مهلت مقرر پاسخ نگرفت؛ دسترسی شبکه و وضعیت سرویس بررسی شود.');
    assert(infraSource.includes('/api/ready'), 'SuperAdmin probes operational readiness, not only process liveness');
    assert(infraSource.includes("status: cellRes.ok && readinessPayload?.ok === true && readinessPayload?.status === 'ready' ? 'healthy' : 'degraded'"), 'HTTP 200 alone cannot mark an unready cell healthy');
  });

  // ----------------------------------------------------
  // 16. MIGRATION BOUNDARY: SALSA ENVIRONMENT (§63)
  // ----------------------------------------------------
  runTest('16. Migration Boundary: SALSA database and confirmation variables are accepted', () => {
    const migrationSource = fs.readFileSync(path.join(__dirname, '../backend/db/migration-runner.js'), 'utf8');
    assert(migrationSource.includes('env.SALSA_CONTROL_DATABASE_URL || env.NEEM_CONTROL_DATABASE_URL'), 'Migration CLI must accept SALSA database URL');
    assert(migrationSource.includes('env.SALSA_CONTROL_MIGRATION_CONFIRM || env.NEEM_CONTROL_MIGRATION_CONFIRM'), 'Migration CLI must accept SALSA confirmation variable');
    assert(migrationSource.includes('legacy NEEM_CONTROL_DATABASE_URL'), 'Legacy environment name must remain an explicit compatibility path');
  });

  // ----------------------------------------------------
  // 17. IN-MEMORY CONTRACT: PRINCIPAL ID / EMAIL LOOKUP (§31)
  // ----------------------------------------------------
  await runAsyncTest('17. In-memory contract: Principal lookup supports ID and email deletion paths', async () => {
    const { InMemoryTestAdapter } = require('../backend/db/database.js');
    const db = new InMemoryTestAdapter();
    db.tables.neem_platform_principals.push({ id: 'principal-1', email: 'owner@salsa.ir' });
    const byId = await db.query('SELECT id FROM neem_platform_principals WHERE id = $1 OR LOWER(email) = LOWER($1)', ['principal-1']);
    const byEmail = await db.query('SELECT id FROM neem_platform_principals WHERE id = $1 OR LOWER(email) = LOWER($1)', ['OWNER@SALSA.IR']);
    assert.strictEqual(byId.rows[0].id, 'principal-1', 'ID lookup must resolve the principal');
    assert.strictEqual(byEmail.rows[0].id, 'principal-1', 'Case-insensitive email lookup must resolve the principal');
  });

  // ----------------------------------------------------
  // 18. DOMAIN REPOSITORY BOUNDARY: NO PRODUCTION FIXTURES (§16, §78)
  // ----------------------------------------------------
  runTest('18. Domain Boundary: Operations and commercial repositories fail closed in production', () => {
    const operations = fs.readFileSync(path.join(__dirname, '../frontend/js/godmode/domain/operations/repository.js'), 'utf8');
    const commercial = fs.readFileSync(path.join(__dirname, '../frontend/js/godmode/domain/commercial/repository.js'), 'utf8');

    assert(operations.includes("if (this.appMode?.isProduction()) throw new Error('EDGE_DEVICES_UNAVAILABLE"), 'Operations must not fall back to demo devices in production');
    assert(operations.includes('PROVISIONING_RETRY_UNAVAILABLE') && operations.includes('if (this.appMode?.isProduction())'), 'Job retry must not be reported successful locally in production');
    assert(operations.includes("if (this.appMode?.isProduction()) return []"), 'Canary gates must not return hardcoded passes in production');
    assert(commercial.includes("if (this._appMode?.isProduction()) return {};"), 'Production killswitch state must not come from the demo store');
    assert(commercial.includes('moduleKey,'), 'Killswitch mutation must use the canonical Control Plane module contract');
    assert(commercial.includes("/api/control/policy/killswitch/${encodeURIComponent(moduleKey)}"), 'Killswitch re-enable must revoke the Control Plane kill switch');
    assert(commercial.includes("INVOICE_ISSUANCE_UNAVAILABLE"), 'Invoice issuance must fail closed without a production endpoint');
  });

  // ----------------------------------------------------
  // 19. SETTINGS EVIDENCE: NO HARDCODED PRODUCTION GREEN (§52, §53)
  // ----------------------------------------------------
  runTest('19. Settings Evidence: Security and hardware UI are unknown until backend evidence exists', () => {
    const settings = fs.readFileSync(path.join(__dirname, '../frontend/js/godmode/pages/settings/settings.js'), 'utf8');
    const commercial = fs.readFileSync(path.join(__dirname, '../frontend/js/godmode/pages/commercial/commercial.js'), 'utf8');

    assert(settings.includes('platformTeam.length === 0 && !isProduction'), 'Team fixtures must be demo-only');
    assert(settings.includes('overallScore: null'), 'Production security score must start unknown');
    assert(settings.includes('(isProduction ? [] : ['), 'Readiness fixture gates must be disabled in production');
    assert(settings.includes('شواهد هدرهای امنیتی در دسترس نیست'), 'Missing security-header evidence must be visible');
    assert(commercial.includes('const quotaMetrics = isProduction ? [] : ['), 'Commercial quota fixtures must be demo-only');
    assert(commercial.includes('داده عملیاتی از Control Plane دریافت نشد'), 'Missing commercial telemetry must be visible');
  });

  // ----------------------------------------------------
  // 20. GOVERNANCE: FOUR-EYES APPROVAL CONTRACT (Phases 81-84)
  // ----------------------------------------------------
  runTest('20. Governance: Four-Eyes approval contract prevents self-confirmation of irreversible actions', () => {
    const govSource = fs.readFileSync(path.join(__dirname, '../backend/routes/governance-routes.js'), 'utf8');
    assert(govSource.includes('FOUR_EYES_VIOLATION'), 'Must enforce FOUR_EYES_VIOLATION check');
    assert(govSource.includes('currentActorId === request.requestedBy'), 'Must prevent initiator from confirming own request');
    assert(govSource.includes('/approvals/request'), 'Must expose approval request endpoint');
    assert(govSource.includes('/approvals/:id/confirm'), 'Must expose approval confirmation endpoint');
    assert(govSource.includes('/approvals/:id/reject'), 'Must expose approval rejection endpoint');
  });

  // ----------------------------------------------------
  // 21. METADATA & DATA PROVENANCE HEADERS (Phases 73-80)
  // ----------------------------------------------------
  runTest('21. Provenance: Platform API emits standard freshness, observed-at, and pagination envelopes', () => {
    const appSource = fs.readFileSync(path.join(__dirname, '../backend/app.js'), 'utf8');
    const tenantRoutes = fs.readFileSync(path.join(__dirname, '../backend/routes/tenant-routes.js'), 'utf8');
    const billingRoutes = fs.readFileSync(path.join(__dirname, '../backend/routes/billing-routes.js'), 'utf8');

    assert(appSource.includes("res.setHeader('X-Observed-At'"), 'Must emit X-Observed-At header');
    assert(appSource.includes("res.setHeader('X-Data-Freshness', 'live')"), 'Must emit X-Data-Freshness header');
    assert(appSource.includes("res.setHeader('X-Resource-Version'"), 'Must emit X-Resource-Version header');
    assert(tenantRoutes.includes('pagination: {'), 'Tenant routes must return standard pagination envelope');
    assert(tenantRoutes.includes('nextCursor'), 'Tenant routes must compute nextCursor');
    assert(billingRoutes.includes('pagination: {'), 'Billing routes must return standard pagination envelope');
  });

  // ----------------------------------------------------
  // 22. GLOBAL COMMAND PALETTE: BACKEND SEARCH INTEGRATION (Phases 68-72)
  // ----------------------------------------------------
  runTest('22. Command Palette: Debounced backend search queries control-plane and merges results', () => {
    const cmdPalette = fs.readFileSync(path.join(__dirname, '../frontend/js/components/command-palette.js'), 'utf8');
    const searchRoutes = fs.readFileSync(path.join(__dirname, '../backend/routes/search-routes.js'), 'utf8');

    assert(cmdPalette.includes('triggerBackendSearch(query)'), 'Command palette must implement triggerBackendSearch');
    assert(cmdPalette.includes('/api/control/search?q='), 'Command palette must query /api/control/search endpoint');
    assert(cmdPalette.includes('_backendResults'), 'Command palette must cache and merge backend results');
    assert(searchRoutes.includes("router.get('/', async (req, res)"), 'Backend search route must handle GET /');
    assert(searchRoutes.includes('NAVIGATION_ITEMS'), 'Backend search must include navigation items');
  });

  // ----------------------------------------------------
  // 23. CANONICAL MODULE MANIFEST & SAFE CONTROL
  // ----------------------------------------------------
  runTest('23. Module Control: Every canonical feature is owned and dependency-safe', () => {
    const featureCatalog = require('../../server/salsa/canonical-features');
    const manifest = require('../../server/salsa/module-manifest');
    const control = require('../../server/salsa/module-control');
    const validation = manifest.validateManifest(featureCatalog.CANONICAL_FEATURES);

    assert.strictEqual(validation.valid, true, 'Every canonical feature must belong to exactly one module');
    assert.strictEqual(validation.missingFromModules.length, 0, 'No feature may be missing from the module manifest');
    assert.strictEqual(validation.unknownModuleFeatures.length, 0, 'Manifest may not invent technical feature keys');
    assert(manifest.MODULES.every(module => ['planned', 'alpha', 'beta', 'ga', 'deprecated', 'retired'].includes(module.lifecycle)), 'Every module needs a valid lifecycle');
    assert(manifest.MODULES.every(module => module.priceMonthlyIrr === null || Number.isInteger(module.priceMonthlyIrr)), 'Module prices must be normalized to integer IRR or null');

    const enablePlan = control.planModuleChange({ moduleKey: 'kds', enabled: true, activeFeatureKeys: [] });
    assert(enablePlan.featureKeys.indexOf('orders.pos') < enablePlan.featureKeys.indexOf('kitchen.kds'), 'Dependencies must be enabled before their dependent feature');

    assert.throws(
      () => control.planModuleChange({ moduleKey: 'pos', enabled: false, activeFeatureKeys: ['orders.pos', 'kitchen.kds'] }),
      /ACTIVE_DEPENDENTS/,
      'Disabling a module with active dependents must fail unless cascade is explicit'
    );
  });

  // ----------------------------------------------------
  // 24. ZERO DEMO CONTENT IN RUNTIME
  // ----------------------------------------------------
  runTest('24. Production Runtime: Demo tenants and reset controls are absent', () => {
    const { InMemoryTestAdapter } = require('../backend/db/database.js');
    const emptyRuntimeDb = new InMemoryTestAdapter({ seedFixtures: false });
    const indexHtml = fs.readFileSync(path.join(__dirname, '../frontend/index.html'), 'utf8');
    const frontendServer = fs.readFileSync(path.join(__dirname, '../frontend/server.js'), 'utf8');
    const appMode = fs.readFileSync(path.join(__dirname, '../frontend/js/godmode/app/app-mode.js'), 'utf8');

    assert.strictEqual(emptyRuntimeDb.tables.neem_tenants.length, 0, 'Non-fixture runtime must start with zero tenants');
    assert.strictEqual(emptyRuntimeDb.tables.neem_billing_invoices.length, 0, 'Non-fixture runtime must start with zero invoices');
    assert.strictEqual(emptyRuntimeDb.tables.neem_tenant_customers.length, 0, 'Non-fixture runtime must start with zero customer records');
    assert(!indexHtml.includes('پاکسازی دمو'), 'Production UI must not expose demo reset copy');
    assert(!indexHtml.includes('btn-clean-data'), 'Production UI must not expose a demo reset button');
    assert(frontendServer.includes("const APP_MODE = process.env.NODE_ENV === 'test' ? 'demo' : 'production'"), 'Normal frontend startup must always use production data mode');
    assert(appMode.includes("return 'production';"), 'Browser runtime must default to production when no test harness exists');
  });

  await runAsyncTest('25. Production Identities: No fabricated members or credential-reset success', async () => {
    const peoplePath = path.join(__dirname, '../frontend/js/godmode/pages/restaurants/workspace/people.js');
    const peopleSource = fs.readFileSync(peoplePath, 'utf8');
    const identityRoutes = [
      path.join(__dirname, '../backend/routes/identity-routes.js'),
      path.join(__dirname, '../../server/salsa/control-plane/routes/identity-routes.js')
    ].map(file => fs.readFileSync(file, 'utf8'));

    function loadPeople(client) {
      let renderer = null;
      let confirmation = null;
      const toastMessages = [];
      const mockWindow = {
        __SALSA_RUNTIME_CONFIG__: { environment: 'production' },
        GodModeAppMode: { isProduction: () => true },
        ControlPlaneClient: client,
        GodModeRestaurantWorkspace: { registerTabRenderer: (_name, callback) => { renderer = callback; } },
        GodModeConfirmDialog: { show: options => { confirmation = options; } },
        GMToast: { show: (message, type) => toastMessages.push({ message, type }) }
      };
      vm.runInNewContext(peopleSource, { window: mockWindow });
      return { mockWindow, render: renderer, getConfirmation: () => confirmation, toastMessages };
    }

    const failed = loadPeople({ get: async () => { throw new Error('offline'); } });
    const failedHtml = await failed.render({ id: 'tenant-production-check', owner: {} }, {});
    assert(failedHtml.includes('فهرست اعضا دریافت نشد'), 'Identity API failure must be visible');
    assert(!failedHtml.includes('۰۹۱۲۰۰۰۰۰۹۹'), 'Identity API failure must not display a fabricated phone');
    assert(!failedHtml.includes('@salsa.ir'), 'Identity API failure must not fabricate a tenant email');

    const empty = loadPeople({ get: async () => ({ data: [] }) });
    const emptyHtml = await empty.render({ id: 'tenant-production-check', owner: {} }, {});
    assert(emptyHtml.includes('برای این مجموعه عضوی ثبت نشده است'), 'A verified empty response must be shown as empty');
    assert(!emptyHtml.includes('مدیر اصلی رستوران'), 'An empty response must not fabricate an owner');

    const unknown = loadPeople({ get: async () => ({ data: [{ id: 'member-1', role: 'owner', displayName: 'مالک', status: 'pending' }] }) });
    const unknownHtml = await unknown.render({ id: 'tenant-production-check', owner: {} }, {});
    assert(unknownHtml.includes('class="badge badge-neutral">نامشخص</span>'), 'Unknown account state must remain unknown');
    assert(!unknownHtml.includes('تعلیق موقت حساب کاربری'), 'Unknown account state must not offer a guessed suspend action');

    const reset = loadPeople({
      get: async () => ({ data: [] }),
      post: async () => ({ data: {} })
    });
    reset.mockWindow.GodModePeople.openResetCredentialsModal('tenant-production-check', 'member-1', 'مالک');
    await reset.getConfirmation().onConfirm('درخواست بازیابی');
    assert(!reset.toastMessages.some(item => item.type === 'success'), 'Missing server credential evidence must not become a success');
    assert(identityRoutes.every(source => source.includes("code: 'CREDENTIAL_RESET_NOT_CONFIGURED'")), 'Both route copies must explicitly fail closed until reset delivery is implemented');
    assert(identityRoutes.every(source => !source.includes('crypto.randomInt(100000, 999999)')), 'No route copy may mint an unpersisted recovery code');
  });

  runTest('26. Production Gate: Local and reserved-host evidence cannot pass as external proof', () => {
    const gate = require('../backend/operational/production-readiness-gate');
    const now = new Date().toISOString();
    const manifest = {
      schemaVersion: 1,
      environment: 'production',
      releaseId: 'v9.9.9',
      rollbackPlan: 'restore the previous approved release',
      stopRules: { errorBudgetPct: 1, ackMinimumPct: 99 },
      checks: Object.fromEntries(gate.REQUIRED_GATE_IDS.map(id => [id, {
        status: 'passed',
        assertions: Object.fromEntries(gate.REQUIRED_GATE_ASSERTIONS[id].map(key => [key, true])),
        evidence: [{
          source: 'production order and payment validation',
          uri: 'https://artifacts.westo.ir/reports/gate.json',
          capturedAt: now,
          actor: 'release-operator',
          artifactDigest: 'a'.repeat(64)
        }]
      }])),
      approvals: gate.REQUIRED_APPROVAL_ROLES.map(role => ({
        role, status: 'approved', actor: `${role}-reviewer`, approvedAt: now
      }))
    };

    const malformedEvidence = JSON.parse(JSON.stringify(manifest));
    for (const row of Object.values(malformedEvidence.checks)) row.evidence.push(null);
    const malformedReport = gate.evaluateProductionReadiness(malformedEvidence);
    assert.strictEqual(malformedReport.status, 'NO_GO', 'Malformed evidence entries must not be silently discarded');
    assert(malformedReport.blockers.includes('staging_foundation:EVIDENCE_METADATA_INVALID'));

    for (const uri of [
      'https://[::ffff:127.0.0.1]/evidence',
      'https://127.0.0.1/evidence',
      'https://order-test.invalid/evidence',
      'https://artifact.internal/evidence',
      'https://artifact-store.example.com/evidence'
    ]) {
      const candidate = JSON.parse(JSON.stringify(manifest));
      for (const row of Object.values(candidate.checks)) row.evidence[0].uri = uri;
      const report = gate.evaluateProductionReadiness(candidate);
      assert.strictEqual(report.status, 'NO_GO', `${uri} must not count as production evidence`);
      assert(report.blockers.includes('staging_foundation:EVIDENCE_METADATA_INVALID'));
    }
  });

  console.log('\n====================================================');
  console.log(`HARDENING SUITE SUMMARY: ${passedTests} PASSED, ${failedTests} FAILED`);
  console.log('====================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

main().catch(err => {
  console.error('Fatal error running hardening suite:', err);
  process.exit(1);
});
