/**
 * scripts/test-godmode-evolution.js
 *
 * Automated Verification Suite for SALSA God Mode Port 3050 Engineering Evolution.
 * Verifies:
 * 1. Zero raw alert() calls across all godmode files.
 * 2. Complete interactive modal handlers in App Shell.
 * 3. Store methods for Branch creation, Plan updates, and Backup snapshots.
 * 4. Router delegation and harmonization.
 * 5. In-place live search and filter mechanics.
 * 6. Onboarding wizard dynamic pricing and validation.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('====================================================');
console.log(' SALSA GOD MODE (PORT 3050) EVOLUTION TEST SUITE  ');
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

// 1. Zero alert() calls in godmode code
runTest('1. Zero raw alert() in prototype/js/godmode files', () => {
  const godmodeDir = path.resolve(__dirname, '../frontend/js/godmode');
  function scanDir(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        scanDir(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.js')) {
        const content = fs.readFileSync(fullPath, 'utf8');
        assert(!content.includes('alert('), `File ${entry.name} still contains raw alert() call!`);
      }
    }
  }
  scanDir(godmodeDir);
});

// 2. AppShell Modal Handlers exist
runTest('2. Complete modal methods in GodModeAppShell', () => {
  const appShell = require('../frontend/js/godmode/components/app-shell.js');
  const requiredMethods = [
    'openAddBranchModal',
    'openChangePlanModal',
    'openAddDomainModal',
    'openRevokeSessionsModal',
    'openCreateBackupModal',
    'openInviteTeamMemberModal',
    'openInviteTenantAdminModal',
    'openSuspendModal',
    'openReactivateModal',
    'openSupportDelegationModal'
  ];
  for (const m of requiredMethods) {
    assert(typeof appShell[m] === 'function', `Expected appShell.${m} to be a function`);
  }
});

// 3. Store Branch, Plan, and Backup methods
runTest('3. Store operations: createBranch, updateTenantPlan, and createBackup', () => {
  const { prototypeStore } = require('../frontend/js/store.js');
  const tenantId = 'tnt_westo_demo';

  // Test createBranch
  const branch = prototypeStore.createBranch(tenantId, {
    name: 'شعبه تست تکامل',
    code: 'BR-EVO-01',
    city: 'تهران'
  });
  assert(branch && branch.name === 'شعبه تست تکامل', 'Branch creation failed');
  const branches = prototypeStore.getBranches(tenantId);
  assert(branches.some(b => b.code === 'BR-EVO-01'), 'Created branch not found in store');

  // Test updateTenantPlan
  const planOk = prototypeStore.updateTenantPlan(tenantId, 'Scale', 'ارتقا برای آزمایش');
  assert(planOk, 'updateTenantPlan failed');
  const tenant = prototypeStore.getTenant(tenantId);
  assert.strictEqual(tenant.plan, 'Scale', 'Tenant plan was not updated to Scale');

  // Test createBackup
  const backup = prototypeStore.createBackup(tenantId, {
    name: 'اسنپ‌شات تست خودکار',
    reason: 'ارزیابی خودکار یکپارچگی'
  });
  assert(backup && backup.status === 'verified', 'Backup creation failed');
  const backups = prototypeStore.getBackups(tenantId);
  assert(backups.some(b => b.id === backup.id), 'Created backup not found in store');
});

// 4. In-place live search and filter mechanics in list.js
runTest('4. In-place live search & filter in list.js', () => {
  const listContent = fs.readFileSync(path.join(__dirname, '../frontend/js/godmode/pages/restaurants/list.js'), 'utf8');
  assert(listContent.includes('applyFiltersInPlace'), 'list.js must implement applyFiltersInPlace');
  assert(listContent.includes('data-tenant-row'), 'list.js rows must have data-tenant-row');
  assert(listContent.includes('restaurants-empty-search-row'), 'list.js must define empty search row');
});

// 5. Onboarding wizard dynamic pricing and validation
runTest('5. Onboarding wizard dynamic price calculation and mobile regex in create.js', () => {
  const createContent = fs.readFileSync(path.join(__dirname, '../frontend/js/godmode/pages/restaurants/create.js'), 'utf8');
  assert(createContent.includes('/^09\\d{9}$/'), 'create.js must enforce Iranian mobile number format 09...');
  assert(createContent.includes('برآورد تعرفه ماهانه اشتراک'), 'create.js must display dynamic price summary');
});

// 6. Router delegation from GMRouter to GodModeRouter
runTest('6. GMRouter delegation to modern GodModeRouter', () => {
  const routerContent = fs.readFileSync(path.join(__dirname, '../frontend/js/router.js'), 'utf8');
  assert(routerContent.includes('window.GodModeRouter.handleRoute()'), 'router.js must delegate to GodModeRouter when available');
});

// 7. Operations interactive mechanics: retryJob, flushOutbox, and probe refresh
runTest('7. Operations interactive mechanics in operations repo & operations.js', () => {
  const opsContent = fs.readFileSync(path.join(__dirname, '../frontend/js/godmode/pages/operations/operations.js'), 'utf8');
  assert(opsContent.includes('window.GodModeOperations.retryJob'), 'operations.js must wire retryJob action for failed jobs');
  assert(opsContent.includes('window.GodModeOperations.flushOutbox'), 'operations.js must wire flushOutbox action');
  assert(opsContent.includes('window.GodModeOperations.refreshProbes'), 'operations.js must wire refreshProbes action');

  const repoContent = fs.readFileSync(path.join(__dirname, '../frontend/js/godmode/domain/operations/repository.js'), 'utf8');
  assert(repoContent.includes('retryJob(jobId'), 'repository.js must implement retryJob');
  assert(repoContent.includes('flushOutbox()'), 'repository.js must implement flushOutbox');
});

// 8. Commercial interactive mechanics: killswitches, grace extension, and plan counts
runTest('8. Commercial interactive mechanics in commercial repo, store, and commercial.js', () => {
  const commContent = fs.readFileSync(path.join(__dirname, '../frontend/js/godmode/pages/commercial/commercial.js'), 'utf8');
  assert(commContent.includes('window.GodModeCommercial.openGlobalKillSwitchModal'), 'commercial.js must have killswitch modal');
  assert(commContent.includes('window.GodModeCommercial.openRestoreModuleModal'), 'commercial.js must have restore modal');
  assert(commContent.includes('window.GodModeCommercial.openExtendGraceModal'), 'commercial.js must have extend grace modal');
  assert(commContent.includes('مجموعه فعال'), 'commercial.js must display active tenant counts per plan');

  // Test Store methods
  const { PrototypeStore } = require('../frontend/js/store.js');
  const store = new PrototypeStore();
  const killRes = store.toggleGlobalKillswitch('kds', false, 'آزمایش تست خودکار');
  assert(killRes && killRes.killed === true, 'toggleGlobalKillswitch failed to kill module');
  const killswitches = store.getGlobalKillswitches();
  assert(killswitches.kds && killswitches.kds.killed === true, 'getGlobalKillswitches did not return killed kds');

  // Test restore
  const restoreRes = store.toggleGlobalKillswitch('kds', true, 'آزمایش بازگردانی');
  assert(restoreRes && restoreRes.killed === false, 'toggleGlobalKillswitch failed to restore module');

  // Test extendGracePeriod
  const tenants = store.getTenants();
  const tId = tenants[0].id;
  const tenantBefore = store.getTenant(tId);
  const updatedTenant = store.extendGracePeriod(tId, 7, 'تست تمدید');
  assert(updatedTenant && updatedTenant.graceUntil, 'extendGracePeriod failed to set graceUntil');
});

// 9. Platform Settings & Security interactive mechanics
runTest('9. Platform Settings & Audit interactive mechanics in store, app-shell, and settings.js', () => {
  const settingsContent = fs.readFileSync(path.join(__dirname, '../frontend/js/godmode/pages/settings/settings.js'), 'utf8');
  assert(settingsContent.includes('window.GodModeSettings.openRemoveUserModal'), 'settings.js must have user removal modal');
  assert(settingsContent.includes('window.GodModeSettings.saveSecurityPolicy'), 'settings.js must have security policy saver');
  assert(settingsContent.includes('window.GodModeSettings.verifyAuditIntegrity'), 'settings.js must have audit integrity verifier');
  assert(settingsContent.includes('filterAuditLogs'), 'settings.js must have audit logs in-place filter');

  const appShellContent = fs.readFileSync(path.join(__dirname, '../frontend/js/godmode/components/app-shell.js'), 'utf8');
  assert(appShellContent.includes('openAddHardwareModal()'), 'app-shell.js must define openAddHardwareModal');

  const { PrototypeStore } = require('../frontend/js/store.js');
  const store = new PrototypeStore();

  // Test add and remove platform user
  const addedUser = store.addPlatformUser({ name: 'کارشناس تست', email: 'test_sec@salsa.ir', role: 'platform_support' });
  assert(addedUser && addedUser.email === 'test_sec@salsa.ir', 'store.addPlatformUser failed');
  const removeOk = store.removePlatformUser('test_sec@salsa.ir', 'تست حذف');
  assert(removeOk, 'store.removePlatformUser failed');

  // Test security policy
  const policy = store.updateSecurityPolicy({ sessionTimeoutHours: 4, mfaRequired: true });
  assert.strictEqual(policy.sessionTimeoutHours, 4, 'store.updateSecurityPolicy failed');

  // Test hardware model
  const hw = store.addHardwareModel({ manufacturer: 'SEWOO', model: 'SLK-TS400', type: 'چاپگر حرارتی' });
  assert(hw && hw.model === 'SLK-TS400', 'store.addHardwareModel failed');
  const catalog = store.getHardwareCatalog();
  assert(catalog.some(m => m.model === 'SLK-TS400'), 'Added hardware not found in catalog');
});

runTest('10. Tenant Workspace Evolution (addon deactivation, backup restore drill, domains aggregation)', () => {
  const subContent = fs.readFileSync(path.join(__dirname, '../frontend/js/godmode/pages/restaurants/workspace/subscription.js'), 'utf8');
  assert(subContent.includes('deactivateAddon'), 'subscription.js must define deactivateAddon handler');
  assert(subContent.includes('لغو افزونه'), 'subscription.js must render addon deactivation button');

  const relContent = fs.readFileSync(path.join(__dirname, '../frontend/js/godmode/pages/restaurants/workspace/reliability.js'), 'utf8');
  assert(relContent.includes('openVerifyBackupModal'), 'reliability.js must invoke openVerifyBackupModal');
  assert(relContent.includes('getBackups'), 'reliability.js must query getBackups');

  const chanContent = fs.readFileSync(path.join(__dirname, '../frontend/js/godmode/pages/restaurants/workspace/channels.js'), 'utf8');
  assert(chanContent.includes('customDomains'), 'channels.js must aggregate customDomains');

  const appShellContent = fs.readFileSync(path.join(__dirname, '../frontend/js/godmode/components/app-shell.js'), 'utf8');
  assert(appShellContent.includes('openVerifyBackupModal(backupId)'), 'app-shell.js must define openVerifyBackupModal');

  const { PrototypeStore } = require('../frontend/js/store.js');
  const store = new PrototypeStore();

  // Test backup creation and verification
  const backup = store.createBackup('tnt_westo_demo', { name: 'تست بکاپ ایزوله' });
  assert(backup && backup.id, 'store.createBackup failed');
  const verifyRes = store.verifyBackup(backup.id);
  assert(verifyRes.success, 'store.verifyBackup failed');
  assert.strictEqual(verifyRes.backup.status, 'verified', 'store.verifyBackup status should be verified');

  // Test addon grant and revoke
  store.grantFeature('tnt_westo_demo', 'kds', { enabled: true, source: 'addon' });
  const revokeRes = store.revokeAddon('tnt_westo_demo', 'kds', 'لغو آزمایشی');
  assert(revokeRes.success, 'store.revokeAddon failed');
});

runTest('11. Home & Action Inbox Evolution (metrics pulse, in-place filters, item dismissal, live audit merge)', () => {
  const homeContent = fs.readFileSync(path.join(__dirname, '../frontend/js/godmode/pages/home/home.js'), 'utf8');
  assert(homeContent.includes('metrics-grid'), 'home.js must include platform pulse metrics grid');
  assert(homeContent.includes('inbox-filter-btn'), 'home.js must include in-place filter buttons');
  assert(homeContent.includes('filterInbox'), 'home.js must implement filterInbox method');
  assert(homeContent.includes('dismissItem'), 'home.js must implement dismissItem method');
  assert(homeContent.includes('refreshTelemetry'), 'home.js must implement refreshTelemetry method');
  assert(homeContent.includes('getAuditLogs'), 'home.js must merge getAuditLogs');

  const opsRepoContent = fs.readFileSync(path.join(__dirname, '../frontend/js/godmode/domain/operations/repository.js'), 'utf8');
  assert(opsRepoContent.includes('isInboxItemDismissed'), 'operations repository must check isInboxItemDismissed');

  const { PrototypeStore } = require('../frontend/js/store.js');
  const store = new PrototypeStore();

  // Test inbox item dismissal
  assert.strictEqual(store.isInboxItemDismissed('alert_test_99'), false, 'Should not be dismissed initially');
  store.dismissInboxItem('alert_test_99');
  assert.strictEqual(store.isInboxItemDismissed('alert_test_99'), true, 'Should be dismissed after calling dismissInboxItem');
  store.clearDismissedInboxItems();
  assert.strictEqual(store.isInboxItemDismissed('alert_test_99'), false, 'Should be cleared after clearDismissedInboxItems');
});

runTest('12. Releases, Canary Rollout & Edge Fleet (Destination 4 - Releases)', () => {
  const opsContent = fs.readFileSync(path.join(__dirname, '../frontend/js/godmode/pages/operations/operations.js'), 'utf8');
  assert(opsContent.includes('promoteRelease'), 'operations.js must implement promoteRelease');
  assert(opsContent.includes('rollbackRelease'), 'operations.js must implement rollbackRelease');
  assert(opsContent.includes('انتشار و استقرار اج'), 'operations.js must render updated releases sub-nav tab');
  assert(opsContent.includes('Edge Terminals & Hardware'), 'operations.js must render edge devices fleet table');

  const opsRepoContent = fs.readFileSync(path.join(__dirname, '../frontend/js/godmode/domain/operations/repository.js'), 'utf8');
  assert(opsRepoContent.includes('getReleases'), 'operations repository must expose getReleases');
  assert(opsRepoContent.includes('promoteRelease'), 'operations repository must expose promoteRelease');
  assert(opsRepoContent.includes('rollbackRelease'), 'operations repository must expose rollbackRelease');

  const { PrototypeStore } = require('../frontend/js/store.js');
  const store = new PrototypeStore();

  const releases = store.getReleases();
  assert(Array.isArray(releases) && releases.length > 0, 'store.getReleases must return initial releases');

  // Test release promotion
  const canaryRel = releases.find(r => r.status === 'canary_evaluating');
  if (canaryRel) {
    const promoted = store.promoteRelease(canaryRel.version);
    assert(promoted && promoted.status === 'live_active', 'store.promoteRelease failed');
    assert.strictEqual(promoted.canaryPercent, 100, 'Promoted release must have 100% canary traffic');
  }

  // Test release rollback
  const rolled = store.rollbackRelease('v1.2.0');
  assert(rolled && rolled.status === 'rolled_back', 'store.rollbackRelease failed');

  // Test devices query
  const devices = store.getDevices('all');
  assert(Array.isArray(devices) && devices.length > 0, 'store.getDevices must return edge devices');
});

runTest('13. Restaurant Workspace Deepening (Device registration, Tenant User invitation, Dynamic Overview synchronization)', () => {
  const overviewContent = fs.readFileSync(path.join(__dirname, '../frontend/js/godmode/pages/restaurants/workspace/overview.js'), 'utf8');
  assert(overviewContent.includes('getDevices'), 'overview.js must query getDevices');
  assert(overviewContent.includes('getBackups'), 'overview.js must query getBackups');

  const hwContent = fs.readFileSync(path.join(__dirname, '../frontend/js/godmode/pages/restaurants/workspace/hardware.js'), 'utf8');
  assert(hwContent.includes('openAddDeviceModal'), 'hardware.js must include openAddDeviceModal triggers');
  assert(hwContent.includes('getDevices'), 'hardware.js must query getDevices');

  const peopleContent = fs.readFileSync(path.join(__dirname, '../frontend/js/godmode/pages/restaurants/workspace/people.js'), 'utf8');
  assert(peopleContent.includes('getUsers'), 'people.js must query getUsers');

  const shellContent = fs.readFileSync(path.join(__dirname, '../frontend/js/godmode/components/app-shell.js'), 'utf8');
  assert(shellContent.includes('openAddDeviceModal(tenantId)'), 'app-shell.js must implement openAddDeviceModal');
  assert(shellContent.includes('addTenantUser'), 'app-shell.js must call addTenantUser');

  const { PrototypeStore } = require('../frontend/js/store.js');
  const store = new PrototypeStore();

  // Test adding device to tenant
  const initialDevs = store.getDevices('tnt_westo_demo').length;
  const newDev = store.addDevice('tnt_westo_demo', {
    name: 'صندوق تست بار',
    type: 'Desktop POS (Windows/Electron)',
    branch: 'شعبه اصلی',
    ipAddress: '192.168.1.155'
  });
  assert(newDev && newDev.id, 'store.addDevice must return a valid device object');
  const updatedDevs = store.getDevices('tnt_westo_demo');
  assert.strictEqual(updatedDevs.length, initialDevs + 1, 'Device count must increase by 1');
  assert(updatedDevs.some(d => d.id === newDev.id), 'New device must be in store.getDevices list');

  // Test adding tenant user
  const initialUsers = store.getUsers('tnt_westo_demo').length;
  const newUser = store.addTenantUser('tnt_westo_demo', {
    name: 'مهندس حسینی',
    phone: '۰۹۱۲۹۹۹۸۸۷۷',
    role: 'manager'
  });
  assert(newUser && newUser.id, 'store.addTenantUser must return a valid user object');
  const updatedUsers = store.getUsers('tnt_westo_demo');
  assert.strictEqual(updatedUsers.length, initialUsers + 1, 'User count must increase by 1');
  assert(updatedUsers.some(u => u.phone === '۰۹۱۲۹۹۹۸۸۷۷'), 'New user phone must match');

  // Check audit log generation
  const auditLogs = store.getAuditLogs('all');
  assert(auditLogs.some(l => l.action.includes('دعوت مدیر جدید')), 'Audit log must record new user invitation');
});

runTest('14. Onboarding & Provisioning Pipeline Deepening (Selected modules, initial branch & POS terminal auto-generation)', () => {
  const createContent = fs.readFileSync(path.join(__dirname, '../frontend/js/godmode/pages/restaurants/create.js'), 'utf8');
  assert(createContent.includes('selectedModules: wizardState.selectedModules'), 'create.js must pass selectedModules to repo');
  assert(createContent.includes('reset()'), 'create.js must define wizard reset method');

  const repoContent = fs.readFileSync(path.join(__dirname, '../frontend/js/godmode/domain/restaurants/repository.js'), 'utf8');
  assert(repoContent.includes('selectedModules: Array.isArray(data.selectedModules)'), 'repository.js must accept selectedModules');

  const { PrototypeStore } = require('../frontend/js/store.js');
  const store = new PrototypeStore();

  const testSlug = `new-bistro-${Date.now().toString(36)}`;
  const created = store.createTenant({
    name: 'بیسترو فرانسوی جدید',
    slug: testSlug,
    primaryBranchName: 'شعبه زعفرانیه',
    plan: 'Growth (رشد)',
    selectedModules: ['pos', 'menu_qr', 'kds'],
    ownerName: 'سامان فلاح',
    ownerPhone: '۰۹۱۲۴۴۴۳۳۲۲'
  });

  assert(created && created.id, 'store.createTenant must return a valid tenant');
  const tenantId = created.id;

  // Verify primary branch auto-generation
  const branches = store.getBranches(tenantId);
  assert(branches.length > 0, 'Initial primary branch must be created');
  assert.strictEqual(branches[0].name, 'شعبه زعفرانیه', 'Primary branch name must match input');
  assert.strictEqual(branches[0].isPrimary, true, 'Branch must be marked as primary');

  // Verify default POS device auto-generation
  const devices = store.getDevices(tenantId);
  assert(devices.length > 0, 'Initial primary POS terminal must be generated');
  assert(devices[0].name.includes('شعبه زعفرانیه'), 'POS terminal name must reflect branch');

  // Verify initial selected modules grants
  const grants = store.getTenantGrants(tenantId);
  assert(grants['kds'] && grants['kds'].granted, 'Selected module kds must be granted');
  assert(grants['pos'] && grants['pos'].granted, 'Selected module pos must be granted');

  // Verify audit log
  const logs = store.getAuditLogs(tenantId);
  assert(logs.some(l => l.action.includes('راه‌اندازی مجموعه جدید')), 'Must record provisioning in audit trail');
});

runTest('15. Home Action Inbox Deepening (Dismissed alerts tracking & recovery, invoice activation, audit hash snippets)', () => {
  const homeContent = fs.readFileSync(path.join(__dirname, '../frontend/js/godmode/pages/home/home.js'), 'utf8');
  assert(homeContent.includes('restoreDismissed'), 'home.js must implement restoreDismissed');
  assert(homeContent.includes('getDismissedInboxItems'), 'home.js must query getDismissedInboxItems');
  assert(homeContent.includes('currentHash'), 'home.js must display cryptographic hash in audit table');

  const repoContent = fs.readFileSync(path.join(__dirname, '../frontend/js/godmode/domain/operations/repository.js'), 'utf8');
  assert(repoContent.includes('billing_activation'), 'operations repository must include billing_activation checks');

  const { PrototypeStore } = require('../frontend/js/store.js');
  const store = new PrototypeStore();

  // Test getDismissedInboxItems
  assert(Array.isArray(store.getDismissedInboxItems()), 'store.getDismissedInboxItems must return array');
  store.dismissInboxItem('item_alert_test_15');
  assert(store.getDismissedInboxItems().includes('item_alert_test_15'), 'item must be present in dismissed list');
  store.clearDismissedInboxItems();
  assert.strictEqual(store.getDismissedInboxItems().length, 0, 'dismissed list must be empty after clear');

  // Test activatePendingInvoice
  const invoices = store.getInvoices('all');
  if (invoices.length > 0) {
    const inv = invoices[0];
    const activated = store.activatePendingInvoice(inv.id);
    assert(activated && activated.activationStatus === 'activated', 'Invoice must be activated');
    const logs = store.getAuditLogs(inv.tenantId);
    assert(logs.some(l => l.action.includes('فعال‌سازی ماژول و لایسنس فاکتور')), 'Audit log must be recorded for activation');
  }
});

runTest('16. Operations Telemetry & Deep Infrastructure Diagnostics (Destination 4 - Infra)', () => {
  const opsContent = fs.readFileSync(path.join(__dirname, '../frontend/js/godmode/pages/operations/operations.js'), 'utf8');
  assert(opsContent.includes('window.GodModeOperations.probeNode'), 'operations.js must wire probeNode action');
  assert(opsContent.includes('window.GodModeOperations.testDatabasePool'), 'operations.js must wire testDatabasePool action');
  assert(opsContent.includes('تاب‌آوری شبکه داخلی'), 'operations.js must render intranet resilience banner');
  assert(opsContent.includes('استخر اتصالات'), 'operations.js must render database connection pool metric');

  const repoContent = fs.readFileSync(path.join(__dirname, '../frontend/js/godmode/domain/operations/repository.js'), 'utf8');
  assert(repoContent.includes('getNodeDiagnostics'), 'repository.js must implement getNodeDiagnostics');
  assert(repoContent.includes('probeNode('), 'repository.js must implement probeNode');
  assert(repoContent.includes('testDatabasePool()'), 'repository.js must implement testDatabasePool');

  const { PrototypeStore } = require('../frontend/js/store.js');
  const store = new PrototypeStore();

  // Test getNodeDiagnostics
  const nodes = store.getNodeDiagnostics();
  assert(Array.isArray(nodes) && nodes.length >= 5, 'store.getNodeDiagnostics must return at least 5 subsystem nodes');
  assert(nodes.some(n => n.id === 'control-plane-api'), 'Must include control-plane-api node');
  assert(nodes.some(n => n.id === 'postgres-db'), 'Must include postgres-db node');

  // Test probeNode
  const probeRes = store.probeNode('control-plane-api');
  assert(probeRes && probeRes.ok, 'store.probeNode failed');
  assert(typeof probeRes.latencyMs === 'number' && probeRes.latencyMs > 0, 'probeNode must return positive latencyMs');

  // Test testDatabasePool
  const poolRes = store.testDatabasePool();
  assert(poolRes && poolRes.ok && poolRes.status === 'optimal', 'store.testDatabasePool failed');
  assert.strictEqual(poolRes.activeConnections, 6, 'testDatabasePool must report active connections');
  assert(poolRes.freeConnections > 0, 'testDatabasePool must report free connections');

  // Verify Audit Log records
  const auditLogs = store.getAuditLogs('all');
  assert(auditLogs.some(l => l.action.includes('پایش پروب نود زیرساخت:')), 'Must record node probe in audit log');
  assert(auditLogs.some(l => l.action.includes('استخر اتصالات پایگاه داده')), 'Must record db pool test in audit log');
  const latestLog = auditLogs[0];
  assert(latestLog.currentHash && latestLog.currentHash.length >= 32, 'Latest audit log must have cryptographic SHA-256 hash');
});

runTest('17. Commercial & Subscription Plans Deepening (Destination 3 - Pulse, Quotas, License Provisioning)', () => {
  const commContent = fs.readFileSync(path.join(__dirname, '../frontend/js/godmode/pages/commercial/commercial.js'), 'utf8');
  assert(commContent.includes('window.GodModeCommercial.activateInvoiceLicense'), 'commercial.js must wire activateInvoiceLicense');
  assert(commContent.includes('درآمد ماهانه تکرارشونده (MRR)'), 'commercial.js must render MRR pulse metric');
  assert(commContent.includes('سقف تعداد شعب مجاز:'), 'commercial.js must render plan branch limits');
  assert(commContent.includes('فاکتورهای تسویه‌شده در انتظار تخصیص'), 'commercial.js must render pending license queue');

  const repoContent = fs.readFileSync(path.join(__dirname, '../frontend/js/godmode/domain/commercial/repository.js'), 'utf8');
  assert(repoContent.includes('getCommercialPulseMetrics'), 'repository.js must implement getCommercialPulseMetrics');
  assert(repoContent.includes('getPendingActivationInvoices'), 'repository.js must implement getPendingActivationInvoices');
  assert(repoContent.includes('activateInvoiceLicense'), 'repository.js must implement activateInvoiceLicense');

  const { PrototypeStore } = require('../frontend/js/store.js');
  const store = new PrototypeStore();

  // Test Plans structure
  const plans = store.state.plans;
  assert(Array.isArray(plans) && plans.length >= 3, 'store must define at least 3 plans');
  const starter = plans.find(p => p.id === 'plan_starter');
  assert(starter && starter.limits && starter.limits.maxPosDevices === 1, 'Starter plan must enforce maxPosDevices: 1');
  assert(starter.priceToman === 990000, 'Starter plan must define priceToman');
  assert(Array.isArray(starter.includedModules), 'Starter plan must define includedModules');

  // Test pending invoices query
  const pendingInvs = store.getInvoices('all').filter(i => i.status === 'paid' && i.activationStatus === 'pending');
  if (pendingInvs.length > 0) {
    const targetInv = pendingInvs[0];
    const activated = store.activatePendingInvoice(targetInv.id);
    assert(activated && activated.activationStatus === 'activated', 'activatePendingInvoice failed');
    const logs = store.getAuditLogs('all');
    assert(logs.some(l => l.action.includes('فعال‌سازی ماژول و لایسنس فاکتور')), 'Must record activation in audit logs');
  }
});

runTest('18. Platform Settings & Cybersecurity Posture Deepening (Destination 5 - TLS 1.3, Lockdown Drill, Category Filters, Printer Probes, Hash Inspector)', () => {
  const settingsContent = fs.readFileSync(path.join(__dirname, '../frontend/js/godmode/pages/settings/settings.js'), 'utf8');
  assert(settingsContent.includes('window.GodModeSettings.toggleLockdown'), 'settings.js must wire toggleLockdown');
  assert(settingsContent.includes('window.GodModeSettings.exportAuditLogsCSV'), 'settings.js must wire exportAuditLogsCSV');
  assert(settingsContent.includes('window.GodModeSettings.filterAuditByCategory'), 'settings.js must implement filterAuditByCategory');
  assert(settingsContent.includes('window.GodModeSettings.filterHardwareByCategory'), 'settings.js must implement filterHardwareByCategory');
  assert(settingsContent.includes('window.GodModeSettings.testPrinter'), 'settings.js must implement testPrinter');
  assert(settingsContent.includes('window.GodModeSettings.showHashDetails'), 'settings.js must implement showHashDetails');
  assert(settingsContent.includes('window.GodModeSettings.resendInvite'), 'settings.js must implement resendInvite');
  assert(settingsContent.includes('TLS 1.3 / AES_256_GCM_SHA384'), 'settings.js must render TLS 1.3 cipher details');
  assert(settingsContent.includes('Strict-Transport-Security'), 'settings.js must render HSTS Preload header');
  assert(settingsContent.includes('عملکرد ۱۰۰٪ آفلاین'), 'settings.js must render offline resilience tag');

  const { PrototypeStore } = require('../frontend/js/store.js');
  const store = new PrototypeStore();

  // 1. Test Cybersecurity Posture & Certificate Lifecycle
  const posture = store.getCybersecurityPosture();
  assert(posture && posture.overallScore === 100, 'getCybersecurityPosture overallScore must be 100');
  assert(posture.certificate && posture.certificate.protocol === 'TLS 1.3 (RFC 8446)', 'Certificate must report TLS 1.3');
  assert(posture.certificate.autoRenewal === true, 'Certificate must have autoRenewal enabled');
  assert(Array.isArray(posture.securityHeaders) && posture.securityHeaders.length >= 4, 'Must report at least 4 security headers');

  // 2. Test Lockdown Drill
  const drillOn = store.triggerLockdownDrill(true, 'آزمایش مانور امنیتی');
  assert(drillOn && drillOn.lockdownMode === true, 'triggerLockdownDrill failed to enable lockdown');
  const postureDrill = store.getCybersecurityPosture();
  assert(postureDrill.lockdownMode === true, 'Posture must reflect active lockdown mode');
  const drillOff = store.triggerLockdownDrill(false, 'پایان مانور');
  assert(drillOff && drillOff.lockdownMode === false, 'triggerLockdownDrill failed to disable lockdown');

  // 3. Test Hardware Catalog & ESC/POS direct socket probe test
  const hwList = store.getHardwareCatalog();
  assert(Array.isArray(hwList) && hwList.length >= 3, 'store.getHardwareCatalog must return certified hardware models');
  const bixolon = hwList.find(h => h.id === 'hw_bixolon_350');
  assert(bixolon && bixolon.offlineResilient === true, 'Bixolon printer must be certified for offline resilience');
  assert(bixolon.driverProfile.includes('ESC/POS'), 'Bixolon printer must specify ESC/POS driver profile');

  const testReport = store.testPrinterModel('hw_bixolon_350');
  assert(testReport && testReport.ok === true, 'store.testPrinterModel failed');
  assert(typeof testReport.latencyMs === 'number' && testReport.latencyMs > 0, 'testPrinterModel must report positive latency');
  assert(testReport.responseCode.includes('0x10 0x04'), 'testPrinterModel must return standard ESC/POS status code 0x10 0x04');

  // 4. Test Team Invitation Resend
  const inviteRes = store.resendTeamInvitation('ops@salsa.ir');
  assert(inviteRes && inviteRes.success === true, 'store.resendTeamInvitation failed');

  // 5. Verify Cryptographic Chained Audit Logs
  const auditLogs = store.getAuditLogs('all');
  assert(auditLogs.some(l => l.action.includes('قرنطینه سایبری پلتفرم')), 'Audit logs must record lockdown drill');
  assert(auditLogs.some(l => l.action.includes('شبیه‌سازی تست چاپ شبکه')), 'Audit logs must record printer probe test');
  assert(auditLogs.some(l => l.action.includes('ارسال مجدد دعوت‌نامه')), 'Audit logs must record team invite resend');
  const latestLog = auditLogs[0];
  assert(latestLog.currentHash && latestLog.currentHash.length >= 32, 'Latest audit log must have cryptographic SHA-256 hash');
});

runTest('19. Home Command Center & Action Inbox Deepening (Destination 1 - Quick License Allocation, Job Retries, Triage Selector, 5-Node Health Cockpit)', () => {
  const homeContent = fs.readFileSync(path.join(__dirname, '../frontend/js/godmode/pages/home/home.js'), 'utf8');
  assert(homeContent.includes('window.GodModeHome.quickActivateInvoice'), 'home.js must wire quickActivateInvoice');
  assert(homeContent.includes('window.GodModeHome.quickRetryJob'), 'home.js must wire quickRetryJob');
  assert(homeContent.includes('window.GodModeHome.extendTenantGrace'), 'home.js must wire extendTenantGrace');
  assert(homeContent.includes('window.GodModeHome.showAuditHash'), 'home.js must wire showAuditHash');
  assert(homeContent.includes('window.GodModeHome.searchInbox'), 'home.js must implement searchInbox');
  assert(homeContent.includes('window.GodModeHome.filterAttentionRestaurants'), 'home.js must implement filterAttentionRestaurants');
  assert(homeContent.includes('تاب‌آوری شبکه محلی Air-gap'), 'home.js must render Air-gap resilience pulse card');
  assert(homeContent.includes('Air-gap Ready'), 'home.js must render Air-gap tag in health cockpit');

  const { PrototypeStore } = require('../frontend/js/store.js');
  const store = new PrototypeStore();

  // 1. Test Quick Grace Extension from Home
  const tenants = store.getTenants();
  const targetTenant = tenants[0];
  targetTenant.status = 'past_due';
  const extended = store.extendGracePeriod(targetTenant.id, 7, 'تست استمهال از پیشخوان مرکزی');
  assert(extended && extended.status === 'grace_period', 'store.extendGracePeriod failed to set grace_period status');
  assert(extended && extended.graceUntil, 'store.extendGracePeriod must set graceUntil');

  // 2. Test Quick Invoice License Activation
  const invoices = store.getInvoices('all');
  const pendingInv = invoices.find(i => i.status === 'paid' && i.activationStatus === 'pending');
  if (pendingInv) {
    const act = store.activatePendingInvoice(pendingInv.id);
    assert(act && act.activationStatus === 'activated', 'store.activatePendingInvoice failed');
  }

  // 3. Test Operations Job Retry from Action Inbox
  const opsRepo = require('../frontend/js/godmode/domain/operations/repository.js');
  assert(typeof opsRepo.retryJob === 'function', 'OperationsRepository must implement retryJob');

  // 4. Verify Chained Audit Log
  const logs = store.getAuditLogs('all');
  assert(logs.some(l => l.action.includes('تمدید مهلت پرداخت')), 'Audit log must record grace extension');
  const latestLog = logs[0];
  assert(latestLog.currentHash && latestLog.currentHash.length >= 32, 'Latest audit log must have cryptographic SHA-256 hash');
});

runTest('20. Operations Automation Rules Engine & Transactional Outbox Pipeline Deepening (Destination 4 - Outbox, Rules, LAN Ping)', () => {
  const opsContent = fs.readFileSync(path.join(__dirname, '../frontend/js/godmode/pages/operations/operations.js'), 'utf8');
  assert(opsContent.includes('Transactional Outbox Engine'), 'operations.js must render Transactional Outbox Engine title');
  assert(opsContent.includes('Transactional Outbox Ledger'), 'operations.js must render Outbox Ledger table');
  assert(opsContent.includes('موتور قوانین خودکارسازی زیرساخت و عملیات'), 'operations.js must render Automation Rules Engine title');
  assert(opsContent.includes('window.GodModeOperations.toggleRule'), 'operations.js must wire toggleRule');
  assert(opsContent.includes('window.GodModeOperations.pingDevice'), 'operations.js must wire pingDevice');
  assert(opsContent.includes('window.GodModeOperations.flushOutbox'), 'operations.js must wire flushOutbox');
  assert(opsContent.includes('پینگ LAN'), 'operations.js must render LAN ping button in devices table');

  const { PrototypeStore } = require('../frontend/js/store.js');
  const store = new PrototypeStore();

  // 1. Outbox Events Ledger Verification
  const events = store.getOutboxEvents('all');
  assert(Array.isArray(events) && events.length >= 5, 'store.getOutboxEvents must return at least 5 outbox events');
  const delivered = store.getOutboxEvents('delivered');
  assert(Array.isArray(delivered) && delivered.every(e => e.status === 'delivered'), 'store.getOutboxEvents(delivered) filtering failed');

  // 2. Platform Automation Rules Verification
  const rules = store.getAutomationRules();
  assert(Array.isArray(rules) && rules.length >= 5, 'store.getAutomationRules must return at least 5 automated platform rules');
  const tlsRule = rules.find(r => r.id === 'rule_acme_tls');
  assert(tlsRule && tlsRule.category === 'security', 'ACME TLS rule must have security category');

  // 3. Toggle Automation Rule with Cryptographic Audit
  const toggledOff = store.toggleAutomationRule('rule_acme_tls', false);
  assert(toggledOff && toggledOff.enabled === false, 'store.toggleAutomationRule failed to disable rule');
  const toggledOn = store.toggleAutomationRule('rule_acme_tls', true);
  assert(toggledOn && toggledOn.enabled === true, 'store.toggleAutomationRule failed to re-enable rule');

  // 4. Flush Outbox Execution
  const flushRes = store.flushOutbox();
  assert(flushRes && flushRes.ok === true && flushRes.status === 'synced', 'store.flushOutbox failed');

  // 5. Device LAN Socket Ping Probe
  const pingRes = store.testDevicePing('term-main');
  assert(pingRes && pingRes.ok === true && pingRes.status === 'reachable', 'store.testDevicePing failed');
  assert(typeof pingRes.latencyMs === 'number' && pingRes.latencyMs > 0, 'testDevicePing must return positive latencyMs');

  // 6. OperationsRepository Integration
  const opsRepo = require('../frontend/js/godmode/domain/operations/repository.js');
  assert(typeof opsRepo.getOutboxEvents === 'function', 'OperationsRepository must implement getOutboxEvents');
  assert(typeof opsRepo.getAutomationRules === 'function', 'OperationsRepository must implement getAutomationRules');
  assert(typeof opsRepo.toggleAutomationRule === 'function', 'OperationsRepository must implement toggleAutomationRule');
  assert(typeof opsRepo.testDevicePing === 'function', 'OperationsRepository must implement testDevicePing');

  // 7. Audit Trail Integrity
  const auditLogs = store.getAuditLogs('all');
  assert(auditLogs.some(l => l.action.includes('قوانین خودکارسازی')), 'Audit logs must record automation rule toggle');
  assert(auditLogs.some(l => l.action.includes('تخلیه فوری')), 'Audit logs must record outbox flush');
  const latestLog = auditLogs[0];
  assert(latestLog.currentHash && latestLog.currentHash.length >= 32, 'Latest audit log must have cryptographic SHA-256 hash');
});

runTest('21. Restaurant Workspace Reliability, Sandbox Drills & Disaster Recovery (Destination 2 - Reliability)', () => {
  const relContent = fs.readFileSync(path.join(__dirname, '../frontend/js/godmode/pages/restaurants/workspace/reliability.js'), 'utf8');
  assert(relContent.includes('معماری بازیابی از فاجعه'), 'reliability.js must render DR Cockpit title');
  assert(relContent.includes('هدف نقطه بازیابی (RPO)'), 'reliability.js must render RPO metric');
  assert(relContent.includes('هدف زمان بازیابی (RTO)'), 'reliability.js must render RTO metric');
  assert(relContent.includes('آرشیو پیوسته لاگ‌های تراکنش (WAL Archiving)'), 'reliability.js must render WAL runbook');
  assert(relContent.includes('openCreateBackupModal'), 'reliability.js must wire openCreateBackupModal');
  assert(relContent.includes('openVerifyBackupModal'), 'reliability.js must wire openVerifyBackupModal');

  const { PrototypeStore } = require('../frontend/js/store.js');
  const store = new PrototypeStore();

  // 1. Disaster Recovery Status
  const dr = store.getDisasterRecoveryStatus('tnt_westo_demo');
  assert(dr && dr.rpoMinutes === 5, 'store.getDisasterRecoveryStatus must report RPO 5 min');
  assert(dr.rtoMinutes === 12, 'store.getDisasterRecoveryStatus must report RTO 12 min');
  assert(dr.pitrCapable === true, 'store.getDisasterRecoveryStatus must report PITR capability');
  assert(dr.offsiteSynced === true, 'store.getDisasterRecoveryStatus must report offsite sync');
  assert(dr.drReadinessScore === 100, 'store.getDisasterRecoveryStatus must report 100% readiness');

  // 2. Create Immediate Backup
  const newBkp = store.createBackup('tnt_westo_demo', { name: 'اسنپ‌شات قبل از ارتقا' });
  assert(newBkp && newBkp.id.startsWith('bkp_'), 'store.createBackup must generate backup ID');
  assert(newBkp.status === 'verified', 'store.createBackup must set verified status');
  assert(newBkp.sha256 && newBkp.sha256.startsWith('sha256_'), 'store.createBackup must generate sha256 checksum');

  // 3. Sandboxed Restore Drill
  const drillRes = store.verifyBackup(newBkp.id);
  assert(drillRes && drillRes.success === true, 'store.verifyBackup restore drill failed');
  assert(drillRes.verifiedTables === 42, 'verifyBackup must verify 42 database tables');
  assert(typeof drillRes.drillDurationSeconds === 'number' && drillRes.drillDurationSeconds > 0, 'verifyBackup must report duration');

  // 4. Cryptographic Chained Audit Logs
  const auditLogs = store.getAuditLogs('all');
  assert(auditLogs.some(l => l.action.includes('ایجاد نسخه پشتیبان فوری')), 'Audit logs must record immediate backup creation');
  assert(auditLogs.some(l => l.action.includes('آزمون بازیابی اسنپ‌شات در سندباکس ایزوله')), 'Audit logs must record sandboxed restore drill');
  const latestLog = auditLogs[0];
  assert(latestLog.currentHash && latestLog.currentHash.length >= 32, 'Latest audit log must have cryptographic SHA-256 hash');
});

runTest('22. Home Command Center, Commercial Collections & Triage Deepening (Destination 1 - Collections, Bulk Grace, Node Probes, Hash Chain Verification)', () => {
  const homeContent = fs.readFileSync(path.join(__dirname, '../frontend/js/godmode/pages/home/home.js'), 'utf8');
  assert(homeContent.includes('window.GodModeHome.quickMarkInvoicePaid'), 'home.js must wire quickMarkInvoicePaid');
  assert(homeContent.includes('window.GodModeHome.bulkExtendGrace'), 'home.js must wire bulkExtendGrace');
  assert(homeContent.includes('window.GodModeHome.probeNode'), 'home.js must wire probeNode');
  assert(homeContent.includes('window.GodModeHome.verifyAuditChain'), 'home.js must wire verifyAuditChain');
  assert(homeContent.includes('window.GodModeHome.searchAttentionRestaurants'), 'home.js must implement searchAttentionRestaurants');
  assert(homeContent.includes('ثبت تسویه / وصولی'), 'home.js must render invoice collection button in action inbox');
  assert(homeContent.includes('تمدید گروهی ۷ روزه استمهال'), 'home.js must render bulk grace extension button');
  assert(homeContent.includes('پایش نود'), 'home.js must render individual node probe button');
  assert(homeContent.includes('بررسی یکپارچگی زنجیره هش'), 'home.js must render audit chain verification button');

  const repoContent = fs.readFileSync(path.join(__dirname, '../frontend/js/godmode/domain/operations/repository.js'), 'utf8');
  assert(repoContent.includes('billing_collection'), 'repository.js must detect billing_collection inbox items');

  const { PrototypeStore } = require('../frontend/js/store.js');
  const store = new PrototypeStore();

  // 1. Test Invoice Collection & License Queue Feeding
  const invoices = store.getInvoices('all');
  const targetInv = invoices.find(i => i.status === 'pending') || invoices[0];
  const paidRes = store.payInvoice(targetInv.id, 'تسویه دستی آزمایشی از پیشخوان فرماندهی');
  assert(paidRes && paidRes.status === 'paid', 'store.payInvoice failed to set status to paid');
  assert(paidRes && paidRes.activationStatus === 'pending', 'store.payInvoice must set activationStatus to pending for license provisioning');

  // 2. Test Bulk Grace Period Extension
  const tenants = store.getTenants();
  tenants[0].status = 'past_due';
  const bulkRes = store.bulkExtendGracePeriod([tenants[0].id], 7, 'تمدید گروهی تست');
  assert(Array.isArray(bulkRes) && bulkRes.length >= 1, 'store.bulkExtendGracePeriod failed');
  assert(tenants[0].status === 'grace_period', 'bulkExtendGracePeriod must set tenant status to grace_period');

  // 3. Test Node Telemetry Probing
  const probeRes = store.probeNode('control-plane-api');
  assert(probeRes && probeRes.ok === true, 'store.probeNode failed');
  assert(typeof probeRes.latencyMs === 'number' && probeRes.latencyMs > 0, 'probeNode must return positive latencyMs');

  // 4. Test Audit Log Integrity Verification
  const integrity = store.verifyAuditLogIntegrity();
  assert(integrity && integrity.valid === true, 'store.verifyAuditLogIntegrity must validate SHA-256 chain');
  assert(integrity.verifiedCount > 0, 'verifiedCount must be greater than 0');
  assert(integrity.rootHash && integrity.rootHash.length >= 32, 'rootHash must be a valid SHA-256 hash');

  // 5. Verify Chained Audit Log
  const auditLogs = store.getAuditLogs('all');
  assert(auditLogs.some(l => l.action.includes('ثبت و وصول فاکتور')), 'Audit logs must record payInvoice');
  assert(auditLogs.some(l => l.action.includes('تمدید گروهی مهلت استمهال')), 'Audit logs must record bulk grace extension');
  assert(auditLogs.some(l => l.action.includes('پایش پروب نود زیرساخت')), 'Audit logs must record node probe');
  const latestLog = auditLogs[0];
  assert(latestLog.currentHash && latestLog.currentHash.length >= 32, 'Latest audit log must have cryptographic SHA-256 hash');
});

runTest('23. Operations Deep Diagnostics, Container Logs Stream & Database Pool Benchmark (Destination 4 - Logs, Pool Modal, Job Inspection, Cache Purge)', () => {
  const opsContent = fs.readFileSync(path.join(__dirname, '../frontend/js/godmode/pages/operations/operations.js'), 'utf8');
  assert(opsContent.includes('window.GodModeOperations.viewNodeLogs'), 'operations.js must wire viewNodeLogs');
  assert(opsContent.includes('window.GodModeOperations.viewJobDetails'), 'operations.js must wire viewJobDetails');
  assert(opsContent.includes('window.GodModeOperations.openDatabasePoolModal'), 'operations.js must wire openDatabasePoolModal');
  assert(opsContent.includes('window.GodModeOperations.purgeCache'), 'operations.js must wire purgeCache');
  assert(opsContent.includes('window.GodModeOperations.searchJobs'), 'operations.js must implement searchJobs');
  assert(opsContent.includes('window.GodModeOperations.filterJobs'), 'operations.js must implement filterJobs');
  assert(opsContent.includes('📋 مشاهده لاگ‌ها'), 'operations.js must render node logs button');
  assert(opsContent.includes('🔍 جزئیات مراحل'), 'operations.js must render job execution pipeline details button');
  assert(opsContent.includes('🧹 پاک‌سازی کش'), 'operations.js must render cache purge button');
  assert(opsContent.includes('⚡ بنچ‌مارک استخر دیتابیس'), 'operations.js must render DB pool benchmark modal button');

  const repo = require('../frontend/js/godmode/domain/operations/repository.js');
  assert(typeof repo.getNodeLogs === 'function', 'OperationsRepository must implement getNodeLogs');
  assert(typeof repo.getJobDetails === 'function', 'OperationsRepository must implement getJobDetails');
  assert(typeof repo.purgeExpiredCache === 'function', 'OperationsRepository must implement purgeExpiredCache');

  const { PrototypeStore } = require('../frontend/js/store.js');
  const store = new PrototypeStore();

  // 1. Service Container Logs Stream
  const pgLogs = store.getNodeLogs('postgres-db');
  assert(Array.isArray(pgLogs) && pgLogs.length >= 3, 'store.getNodeLogs(postgres-db) must return log entries');
  assert(pgLogs[0].timestamp && pgLogs[0].level && pgLogs[0].message, 'Log entry must have timestamp, level, and message');
  const warnLogs = store.getNodeLogs('control-plane-api', 'WARN');
  assert(Array.isArray(warnLogs) && warnLogs.every(l => l.level === 'WARN'), 'Level filtering in getNodeLogs failed');

  // 2. Step-by-Step Provisioning Job Inspection
  const jobDetails = store.getJobDetails('job_prov_101');
  assert(jobDetails && jobDetails.id === 'job_prov_101', 'store.getJobDetails failed to return job');
  assert(Array.isArray(jobDetails.steps) && jobDetails.steps.length === 5, 'Job details must contain 5 pipeline execution steps');
  assert(jobDetails.steps[0].durationMs > 0, 'Job steps must report durationMs');

  // 3. Fast Store Memory Cache Purge
  const purgeRes = store.purgeExpiredCache();
  assert(purgeRes && purgeRes.ok === true, 'store.purgeExpiredCache failed');
  assert(purgeRes.purgedKeysCount > 0, 'purgeExpiredCache must return positive purgedKeysCount');

  // 4. Database Connection Pool Benchmark
  const dbPool = store.testDatabasePool();
  assert(dbPool && dbPool.ok === true, 'store.testDatabasePool failed');
  assert(dbPool.activeConnections === 6 && dbPool.maxConnections === 20, 'testDatabasePool must report active and max connections');
  assert(typeof dbPool.latencyMs === 'number' && dbPool.latencyMs > 0, 'testDatabasePool must report positive latencyMs');

  // 5. Chained Cryptographic Audit Integrity
  const auditLogs = store.getAuditLogs('all');
  assert(auditLogs.some(l => l.action.includes('پاک‌سازی حافظه موقت')), 'Audit logs must record purgeExpiredCache');
  assert(auditLogs.some(l => l.action.includes('استخر اتصالات')), 'Audit logs must record testDatabasePool');
  const latestLog = auditLogs[0];
  assert(latestLog.currentHash && latestLog.currentHash.length >= 32, 'Latest audit log must have cryptographic SHA-256 hash');
});

// 24. Restaurant Workspace People & Roles Permissions (Destination 2 - Tab 5)
runTest('24. Restaurant Workspace People & Roles Permissions (Destination 2 - Tab 5)', () => {
  const peoplePath = path.resolve(__dirname, '../frontend/js/godmode/pages/restaurants/workspace/people.js');
  const peopleContent = fs.readFileSync(peoplePath, 'utf8');

  // 1. Zero raw alert and UI elements verification
  assert(!peopleContent.includes('alert('), 'people.js must not contain raw alert() calls');
  assert(peopleContent.includes('viewRolePermissions'), 'people.js must implement viewRolePermissions');
  assert(peopleContent.includes('openResetCredentialsModal'), 'people.js must implement openResetCredentialsModal');
  assert(peopleContent.includes('openToggleStatusModal'), 'people.js must implement openToggleStatusModal');
  assert(peopleContent.includes('people-search-input'), 'people.js must render people search input');
  assert(peopleContent.includes('people-role-btn'), 'people.js must render role filter buttons');
  assert(peopleContent.includes('people-status-btn'), 'people.js must render status filter buttons');
  assert(peopleContent.includes('🔑 رمز موقت'), 'people.js must render temporary OTP credential button');
  assert(peopleContent.includes('🛡 اختیارات'), 'people.js must render role permissions inspection button');

  // 2. Domain Repository interface
  const repo = require('../frontend/js/godmode/domain/restaurants/repository.js');
  assert(typeof repo.getRolePermissions === 'function', 'RestaurantsRepository must implement getRolePermissions');
  assert(typeof repo.toggleTenantUserStatus === 'function', 'RestaurantsRepository must implement toggleTenantUserStatus');
  assert(typeof repo.resetTenantUserCredentials === 'function', 'RestaurantsRepository must implement resetTenantUserCredentials');

  const { PrototypeStore } = require('../frontend/js/store.js');
  const store = new PrototypeStore();

  // 3. Store Role Permissions Definition & Inspection
  const ownerRole = store.getRolePermissions('owner');
  assert(ownerRole && ownerRole.role === 'owner', 'store.getRolePermissions(owner) failed');
  assert(ownerRole.scope === 'tenant', 'Owner role must have tenant-wide scope');
  assert(Array.isArray(ownerRole.permissionsDetail) && ownerRole.permissionsDetail.length > 5, 'Owner role must have rich permissionsDetail');
  assert(typeof ownerRole.description === 'string' && ownerRole.description.length > 10, 'Role must have descriptive summary');

  const managerRole = store.getRolePermissions('manager');
  assert(managerRole && managerRole.role === 'manager', 'store.getRolePermissions(manager) failed');
  assert(managerRole.nameFa === 'مدیر شعبه' && managerRole.scope === 'branch', 'Manager role must be branch-scoped');

  const accountantRole = store.getRolePermissions('accountant');
  assert(accountantRole.defaultPermissions.includes('finance.view'), 'Accountant role must include finance.view');

  // 4. User Status Toggle & Chained Audit Logs
  const suspendResult = store.toggleTenantUserStatus('tnt_westo_demo', 'usr_cashier_sara', false, 'بررسی مغایرت دخل صندوق');
  assert(suspendResult && suspendResult.status === 'suspended' && suspendResult.active === false, 'Suspending tenant user failed');
  
  const restoreResult = store.toggleTenantUserStatus('tnt_westo_demo', 'usr_cashier_sara', true, 'رفع مغایرت و فعال‌سازی مجدد');
  assert(restoreResult && restoreResult.status === 'active' && restoreResult.active === true, 'Restoring tenant user failed');

  // 5. Time-Limited OTP Credential Generation
  const resetResult = store.resetTenantUserCredentials('tnt_westo_demo', 'usr_accountant_omid', 'درخواست بازنشانی دسترسی');
  assert(resetResult && resetResult.success === true, 'store.resetTenantUserCredentials failed');
  assert(/^\d{6}$/.test(resetResult.tempOtp), 'Temporary OTP must be a 6-digit numeric string');
  assert(resetResult.expiresAt && resetResult.expiresAtIso, 'resetTenantUserCredentials must report expiration');

  // 6. SHA-256 Chained Audit Trail Verification
  const auditLogs = store.getAuditLogs('all');
  assert(auditLogs.some(l => l.action.includes('تعلیق موقت حساب کاربر')), 'Audit logs must record user suspension');
  assert(auditLogs.some(l => l.action.includes('رفع تعلیق حساب کاربر')), 'Audit logs must record user reactivation');
  assert(auditLogs.some(l => l.action.includes('صدور رمز موقت')), 'Audit logs must record OTP credential reset');
  const latestLog = auditLogs[0];
  assert(latestLog.currentHash && latestLog.currentHash.length >= 32, 'Latest user action audit log must have cryptographic SHA-256 hash');
});

// 25. Commercial Billing, Tax Compliance & Official Invoicing (Destination 3 - Billing)
runTest('25. Commercial Billing, Tax Compliance & Official Invoicing (Destination 3 - Billing)', () => {
  const commPath = path.resolve(__dirname, '../frontend/js/godmode/pages/commercial/commercial.js');
  const commContent = fs.readFileSync(commPath, 'utf8');

  // 1. Zero raw alert and UI elements verification
  assert(!commContent.includes('alert('), 'commercial.js must not contain raw alert() calls');
  assert(commContent.includes('viewInvoiceDetails'), 'commercial.js must implement viewInvoiceDetails');
  assert(commContent.includes('openIssueInvoiceModal'), 'commercial.js must implement openIssueInvoiceModal');
  assert(commContent.includes('filterInvoices'), 'commercial.js must implement filterInvoices');
  assert(commContent.includes('setInvoiceStatusFilter'), 'commercial.js must implement setInvoiceStatusFilter');
  assert(commContent.includes('commercial-invoice-search'), 'commercial.js must render invoice search input');
  assert(commContent.includes('commercial-inv-status-btn'), 'commercial.js must render invoice status filter buttons');
  assert(commContent.includes('📄 جزئیات سند'), 'commercial.js must render the invoice document details action without claiming tax issuance');
  assert(commContent.includes('➕ صدور صورتحساب دستی'), 'commercial.js must render manual invoice issuance button');

  // 2. Domain Repository interface
  const repo = require('../frontend/js/godmode/domain/commercial/repository.js');
  assert(typeof repo.getInvoiceDetails === 'function', 'CommercialRepository must implement getInvoiceDetails');
  assert(typeof repo.issueInvoice === 'function', 'CommercialRepository must implement issueInvoice');
  assert(typeof repo.getTaxSummary === 'function', 'CommercialRepository must implement getTaxSummary');

  const { PrototypeStore } = require('../frontend/js/store.js');
  const store = new PrototypeStore();

  // 3. Official Tax Invoice Details & Moadian Breakdown
  const invDetails = store.getInvoiceDetails('INV-1403-0982');
  assert(invDetails && invDetails.id === 'INV-1403-0982', 'store.getInvoiceDetails failed');
  assert(invDetails.seller && invDetails.seller.economicCode === '411549817283', 'Seller must have valid economicCode');
  assert(invDetails.buyer && invDetails.buyer.legalName, 'Buyer must have valid legalName');
  assert(invDetails.vatRate === 10, 'VAT rate must be 10 percent');
  assert(typeof invDetails.vatAmount === 'number' && invDetails.vatAmount > 0, 'vatAmount must be positive number');
  assert(invDetails.totalAmount === (invDetails.subtotal + invDetails.vatAmount), 'totalAmount must equal subtotal plus vatAmount');
  assert(invDetails.taxCompliance && invDetails.taxCompliance.taxUid, 'Invoice must report Moadian taxUid');
  assert(invDetails.taxCompliance.digitalSignature.startsWith('sha256_'), 'Tax compliance must include SHA-256 digital signature');

  // 4. Issue Official Manual Invoice with Chained SHA-256 Audit Log
  const newInv = store.issueInvoice('tnt_westo_demo', {
    description: 'اشتراک سالانه پلتفرم و بسته‌های توسعه اختصاصی',
    amount: 6000000
  });
  assert(newInv && newInv.id.startsWith('INV-1403-'), 'store.issueInvoice failed to create invoice');
  assert(newInv.amount === 6000000, 'Invoice subtotal amount must match');
  assert(newInv.vatAmount === 600000, '10% VAT must be 600,000 Toman');
  assert(newInv.totalAmount === 6600000, 'Total with VAT must be 6,600,000 Toman');
  assert(newInv.status === 'pending', 'Newly issued invoice must default to pending');

  // 5. Tax & VAT Ledger Summary
  const taxSummary = store.getTaxSummary();
  assert(taxSummary && typeof taxSummary.grossInvoicedToman === 'number', 'store.getTaxSummary failed');
  assert(taxSummary.collectedVatToman > 0, 'collectedVatToman must be positive');
  assert(taxSummary.moadianComplianceRate === '۱۰۰٪', 'Moadian compliance rate must be 100%');
  assert(taxSummary.taxRatePercent === 10, 'Tax rate must be 10%');

  // 6. SHA-256 Chained Audit Trail Verification
  const auditLogs = store.getAuditLogs('all');
  assert(auditLogs.some(l => l.action.includes('صدور فاکتور رسمی پلتفرم')), 'Audit logs must record issueInvoice');
  const latestLog = auditLogs[0];
  assert(latestLog.currentHash && latestLog.currentHash.length >= 32, 'Latest commercial audit log must have cryptographic SHA-256 hash');
});

console.log('\n====================================================');
console.log(`   EVOLUTION SUMMARY: ${passedTests} PASSED, ${failedTests} FAILED`);
console.log('====================================================\n');

if (failedTests > 0) {
  process.exit(1);
}
