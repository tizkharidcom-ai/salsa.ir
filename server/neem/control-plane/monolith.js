/**
 * server/neem/control-plane/monolith.js
 * 
 * NEEM Control Plane Modular Monolith Kernel.
 * Unifies all 6 domains and 17 service subsystems into a cohesive,
 * fail-closed, observable modular architecture with lifecycle controls.
 */

'use strict';

const http = require('http');
const config = require('./config');
const { getDatabase } = require('./db/database');
const { assertControlPlaneDatabaseReady } = require('./db/readiness');
const { defaultAutomationRunner } = require('./automation/automation-runner');
const { AuthService } = require('./auth/auth-service');

// Subsystem Routers
const authRoutes = require('./routes/auth-routes');
const overviewRoutes = require('./routes/overview-routes');
const tenantRoutes = require('./routes/tenant-routes');
const tenantProvisioningRoutes = require('./routes/tenant-provisioning-routes');
const auditRoutes = require('./routes/audit-routes');
const policyRoutes = require('./routes/policy-routes');
const billingRoutes = require('./routes/billing-routes');
const automationRoutes = require('./routes/automation-routes');
const supportRoutes = require('./routes/support-routes');
const infraRoutes = require('./routes/infra-routes');
const edgeRoutes = require('./routes/edge-routes');
const backupRoutes = require('./routes/backup-routes');
const releaseRoutes = require('./routes/release-routes');
const metricsRoutes = require('./routes/metrics-routes');
const identityRoutes = require('./routes/identity-routes');
const integrationRoutes = require('./routes/integration-routes');
const contractRoutes = require('./routes/contract-routes');

/**
 * Domain Workspaces Definition for the Modular Monolith
 */
const MONOLITH_WORKSPACES = [
  {
    id: 'commandCenter',
    nameFa: 'مرکز فرماندهی',
    purposeFa: 'پایش وضعیت پلتفرم، متریک‌های سیستم و اتصالات سراسری',
    routes: [
      { path: '/api/control/overview', router: overviewRoutes, description: 'Overview & Platform Health' },
      { path: '/metrics', router: metricsRoutes, description: 'Prometheus Observability Exporter' },
      { path: '/api/control/integrations/westo', router: integrationRoutes, description: 'Westo Integration Bridge' }
    ]
  },
  {
    id: 'customers',
    nameFa: 'مشتریان و مجموعه‌ها',
    purposeFa: 'چرخه حیات مستأجران، راه‌اندازی، سخت‌افزار، لبه و پشتیبانی',
    routes: [
      { path: '/api/control/tenants', router: tenantRoutes, description: 'Tenants Management' },
      { path: '/api/control/provisioning', router: tenantProvisioningRoutes, description: 'Provisioning Engine' },
      { path: '/api/control/edge', router: edgeRoutes, description: 'Edge Fleet & Sync' },
      { path: '/api/control/support', router: supportRoutes, description: 'Customer Support & SLA' },
      { path: '/api/control', router: contractRoutes, description: 'Contracts & Declarations' }
    ]
  },
  {
    id: 'billing',
    nameFa: 'مالی و اشتراک',
    purposeFa: 'مدیریت پلن‌ها، فاکتورها، درگاه‌های پرداخت و سهمیه‌های مصرف',
    routes: [
      { path: '/api/control/billing', router: billingRoutes, description: 'Billing, Invoicing & Gateways' }
    ]
  },
  {
    id: 'security',
    nameFa: 'امنیت و هویت',
    purposeFa: 'احراز هویت دو مرحله‌ای، سیاست‌های RBAC و مدیریت کاربران سامانه',
    routes: [
      { path: '/api/control/auth', router: authRoutes, description: 'Operator Authentication & MFA' },
      { path: '/api/control/policy', router: policyRoutes, description: 'RBAC Policy Engine & Grants' },
      { path: '/api/control/identities', router: identityRoutes, description: 'Operator Identities & Sessions' }
    ]
  },
  {
    id: 'infrastructure',
    nameFa: 'زیرساخت و تداوم',
    purposeFa: 'کلاسترها، بکاپ‌ها، خط‌مشی‌های اتوماسیون و استقرار قناری',
    routes: [
      { path: '/api/control/infra', router: infraRoutes, description: 'Cloud Infrastructure & Nodes' },
      { path: '/api/control/backups', router: backupRoutes, description: 'Backup Vault & DR' },
      { path: '/api/control', router: releaseRoutes, description: 'Canary Releases & Rollback' },
      { path: '/api/control/automation', router: automationRoutes, description: 'Automation Rules & Outbox' }
    ]
  },
  {
    id: 'governance',
    nameFa: 'حاکمیت و ممیزی',
    purposeFa: 'دفتر کل رویدادهای غیرقابل تغییر و ممیزی سیستم',
    routes: [
      { path: '/api/control/audit', router: auditRoutes, description: 'Tamper-Proof Audit Ledger' }
    ]
  }
];

class ControlPlaneMonolith {
  constructor(options = {}) {
    this.config = options.config || config;
    this.authService = options.authService || new AuthService();
    this.automationRunner = options.automationRunner || defaultAutomationRunner;
    this.workspaces = MONOLITH_WORKSPACES;
    this.server = null;
    this.sessionCleanupTimer = null;
    this.isStarted = false;
  }

  /**
   * Mounts all domain workspaces and routes onto an Express application instance.
   */
  mountRoutes(app) {
    // Mount root metrics
    app.use(metricsRoutes);

    // Mount all workspaces
    for (const ws of this.workspaces) {
      for (const entry of ws.routes) {
        if (entry.path === '/metrics') continue; // already mounted
        app.use(entry.path, entry.router);
      }
    }
  }

  /**
   * Returns metadata manifest for all workspaces and capabilities.
   */
  getManifest() {
    return {
      service: 'neem-control-plane',
      architecture: 'modular-monolith',
      version: '1.2.5',
      environment: this.config.env,
      workspaces: this.workspaces.map(ws => ({
        id: ws.id,
        nameFa: ws.nameFa,
        purposeFa: ws.purposeFa,
        routeCount: ws.routes.length,
        endpoints: ws.routes.map(r => r.path)
      }))
    };
  }

  /**
   * Aggregated health check across all monolith subsystems.
   */
  async getHealth() {
    let dbStatus = 'healthy';
    let dbLatencyMs = null;
    try {
      const startedAt = Date.now();
      const db = getDatabase();
      if (db && typeof db.query === 'function') {
        await db.query('SELECT 1');
        dbLatencyMs = Date.now() - startedAt;
      } else {
        dbStatus = 'unreachable';
      }
    } catch (e) {
      dbStatus = 'unreachable';
    }

    return {
      service: 'neem-control-plane',
      status: dbStatus === 'healthy' ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      devSessionAvailable: !this.config.isProduction && this.config.allowEphemeralDev,
      automation: this.automationRunner ? this.automationRunner.getStatus() : { isRunning: false },
      subsystems: {
        database: { status: dbStatus, latencyMs: dbLatencyMs },
        automation: this.automationRunner && this.automationRunner.isRunning() ? 'running' : 'idle',
        auth: dbStatus === 'healthy' ? 'available' : 'degraded',
        workspaces: this.workspaces.length
      }
    };
  }

  /**
   * Lifecycle: Start the control plane server and background runners
   */
  async start(app, customPort = null) {
    if (this.isStarted) return this.server;
    const port = customPort || this.config.port;

    // Fail-closed database readiness verification in persistent modes
    if (!this.config.isTest && !this.config.allowEphemeralDev) {
      const readiness = await assertControlPlaneDatabaseReady(getDatabase());
      console.log(`  🗄️ Control Plane schema ready (${readiness.appliedVersions.length} migrations)`);
    }

    this.server = http.createServer(app);

    await new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(port, '127.0.0.1', resolve);
    });

    this.isStarted = true;

    // Start automation runner if enabled
    if (this.config.automationEnabled && this.automationRunner) {
      this.automationRunner.start();
    }

    // Start session cleanup interval
    const sessionCleanupIntervalMs = Math.max(60_000, Number(process.env.NEEM_SESSION_CLEANUP_INTERVAL_MS || 5 * 60 * 1000));
    this.sessionCleanupTimer = setInterval(() => {
      this.authService.cleanupExpiredSessions().catch((err) => {
        console.error('Session cleanup failed:', err.message);
      });
    }, sessionCleanupIntervalMs);
    this.sessionCleanupTimer.unref?.();

    return this.server;
  }

  /**
   * Lifecycle: Gracefully stop all monolith services, timers, and sockets
   */
  async stop() {
    if (this.sessionCleanupTimer) {
      clearInterval(this.sessionCleanupTimer);
      this.sessionCleanupTimer = null;
    }

    if (this.automationRunner && typeof this.automationRunner.stop === 'function' && this.automationRunner.isRunning()) {
      await this.automationRunner.stop();
    }

    if (this.server) {
      await new Promise((resolve) => {
        this.server.close(() => resolve());
      });
      this.server = null;
    }

    this.isStarted = false;
  }
}

const defaultMonolith = new ControlPlaneMonolith();

module.exports = {
  ControlPlaneMonolith,
  defaultMonolith,
  MONOLITH_WORKSPACES
};
