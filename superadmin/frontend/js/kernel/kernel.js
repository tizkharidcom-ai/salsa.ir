/**
 * prototype/js/kernel/kernel.js
 * 
 * Central Modular Monolith Kernel (GMKernel) for GODMODE Control Plane.
 * 
 * Provides:
 * 1. Monolith Module Registry covering all 6 workspaces and 28 views
 * 2. Strict Blast-Radius Containment & Fault-Isolation Boundaries
 * 3. Circuit Breaker to prevent infinite crash loops
 * 4. Standalone Mount & Execution API for every individual view
 * 5. Automated Audit Reporting for unhandled view faults
 * 6. Health Probing and Diagnostic drawer
 */

(function registerKernel(global) {
  'use strict';

  const WORKSPACES_MAP = {
    overview: { id: 'overview', titleFa: 'مرکز فرماندهی', icon: '◫' },
    customers: { id: 'customers', titleFa: 'مشتریان و مجموعه‌ها', icon: '👥' },
    billing: { id: 'billing', titleFa: 'مالی و اشتراک', icon: '💳' },
    security: { id: 'security', titleFa: 'امنیت و هویت', icon: '🔒' },
    infra: { id: 'infra', titleFa: 'زیرساخت و تداوم', icon: '⚙️' },
    governance: { id: 'governance', titleFa: 'حاکمیت و ممیزی', icon: '🏛️' }
  };

  const CANONICAL_MODULES = [
    // 1. Overview Workspace
    { id: 'GM02', route: 'gm-02-overview', workspaceId: 'overview', titleFa: 'مرکز فرماندهی · داشبورد کنترل‌پلن', scope: 'platform' },
    { id: 'GM22', route: 'gm-22-operations', workspaceId: 'overview', titleFa: 'سلامت، رخدادها و هشدارها', scope: 'platform' },
    { id: 'GM25', route: 'gm-25-jobs', workspaceId: 'overview', titleFa: 'صف اجرا و کارهای پس‌زمینه', scope: 'platform' },

    // 2. Customers Workspace
    { id: 'GM03', route: 'gm-03-tenants', workspaceId: 'customers', titleFa: 'رجیستری مجموعه‌ها', scope: 'platform' },
    { id: 'GM04', route: 'gm-04-tenant-detail', workspaceId: 'customers', titleFa: 'شناسنامه و پرونده مشتری', scope: 'tenant' },
    { id: 'GM05', route: 'gm-05-tenant-new', workspaceId: 'customers', titleFa: 'ویزارد ایجاد مشتری جدید', scope: 'platform' },
    { id: 'GM06', route: 'gm-06-provisioning', workspaceId: 'customers', titleFa: 'راه‌اندازی و تحویل سرویس', scope: 'tenant' },
    { id: 'GM07', route: 'gm-07-templates', workspaceId: 'customers', titleFa: 'الگوهای آماده راه‌اندازی', scope: 'platform' },
    { id: 'GM09', route: 'gm-09-tenant-features', workspaceId: 'customers', titleFa: 'امکانات و ماژول‌های مشتری', scope: 'tenant' },
    { id: 'GM13', route: 'gm-13-identities', workspaceId: 'customers', titleFa: 'کاربران و پرسنل مجموعه', scope: 'tenant' },
    { id: 'GM14', route: 'gm-14-access-roles', workspaceId: 'customers', titleFa: 'نقش‌ها و ماتریس دسترسی', scope: 'tenant' },
    { id: 'GM15', route: 'gm-15-simulator', workspaceId: 'customers', titleFa: 'شبیه‌ساز ارزیابی دسترسی', scope: 'tenant' },
    { id: 'GM17', route: 'gm-17-customers', workspaceId: 'customers', titleFa: 'باشگاه مشتریان و اعضا', scope: 'tenant' },
    { id: 'GM18', route: 'gm-18-domains', workspaceId: 'customers', titleFa: 'دامنه‌ها و برندینگ وایت‌لیبل', scope: 'tenant' },
    { id: 'GM19', route: 'gm-19-devices', workspaceId: 'customers', titleFa: 'پایانه‌های پوز و دستگاه‌ها', scope: 'tenant' },
    { id: 'GM20', route: 'gm-20-backups', workspaceId: 'customers', titleFa: 'پشتیبان‌گیری و بازیابی داده', scope: 'tenant' },
    { id: 'GM21', route: 'gm-21-support', workspaceId: 'customers', titleFa: 'تیکت‌ها و نشست پشتیبانی', scope: 'tenant' },
    { id: 'GM28', route: 'gm-28-portal', workspaceId: 'customers', titleFa: 'قرارداد و پورتال اختصاصی', scope: 'tenant' },

    // 3. Billing Workspace
    { id: 'GM08', route: 'gm-08-features', workspaceId: 'billing', titleFa: 'کاتالوگ قابلیت‌ها و Kill-Switch', scope: 'platform' },
    { id: 'GM10', route: 'gm-10-plans', workspaceId: 'billing', titleFa: 'پلن‌های اشتراک سازمانی', scope: 'platform' },
    { id: 'GM11', route: 'gm-11-billing', workspaceId: 'billing', titleFa: 'مالی، فاکتورها و تسویه', scope: 'tenant' },
    { id: 'GM12', route: 'gm-12-usage', workspaceId: 'billing', titleFa: 'سهمیه‌ها و مصرف منابع', scope: 'tenant' },

    // 4. Security Workspace
    { id: 'GM01', route: 'gm-01-login', workspaceId: 'security', titleFa: 'احراز هویت و ورود مدیران', scope: 'platform' },

    // 5. Infrastructure Workspace
    { id: 'GM16', route: 'gm-16-automations', workspaceId: 'infra', titleFa: 'اتوماسیون و سناریوهای خودکار', scope: 'platform' },
    { id: 'GM23', route: 'gm-23-releases', workspaceId: 'infra', titleFa: 'انتشار نسخه و قناری', scope: 'platform' },
    { id: 'GM24', route: 'gm-24-infrastructure', workspaceId: 'infra', titleFa: 'کلاسترها، سرورها و شبکه', scope: 'platform' },

    // 6. Governance Workspace
    { id: 'GM26', route: 'gm-26-audit', workspaceId: 'governance', titleFa: 'دفتر کل ممیزی زنجیره SHA-256', scope: 'platform' },
    { id: 'GM27', route: 'gm-27-team', workspaceId: 'governance', titleFa: 'تیم داخلی و ساختار پلتفرم', scope: 'platform' }
  ];

  class GMKernel {
    constructor() {
      this.workspaces = WORKSPACES_MAP;
      this.modules = new Map();
      this.circuitThreshold = 3; // trip after 3 errors
      this.initModules();
    }

    initModules() {
      CANONICAL_MODULES.forEach((meta) => {
        this.modules.set(meta.id, {
          ...meta,
          status: 'healthy',
          errorCount: 0,
          lastError: null,
          lastRenderedAt: null,
          renderDurationMs: 0,
          circuitTripped: false,
          safeMode: false
        });
      });
    }

    getModule(id) {
      return this.modules.get(id) || null;
    }

    getAllModules() {
      return Array.from(this.modules.values());
    }

    getWorkspaceModules(workspaceId) {
      return this.getAllModules().filter((m) => m.workspaceId === workspaceId);
    }

    /**
     * Resets a module's error state and trips.
     */
    retryModule(moduleId) {
      const mod = this.getModule(moduleId);
      if (mod) {
        mod.status = 'recovering';
        mod.errorCount = 0;
        mod.circuitTripped = false;
        mod.lastError = null;
      }
      // If DataStateManager is present, reset view state as well
      if (global.GMDataState && typeof global.GMDataState.retryView === 'function') {
        global.GMDataState.retryView(moduleId);
      }
      // Re-trigger routing if on this route
      if (global.GMRouter && typeof global.GMRouter.handleRoute === 'function') {
        global.GMRouter.handleRoute();
      }
    }

    /**
     * Enables safe-mode for a module and re-renders.
     */
    safeModeRender(moduleId) {
      const mod = this.getModule(moduleId);
      if (mod) {
        mod.safeMode = true;
        mod.status = 'degraded';
      }
      if (global.GMRouter && typeof global.GMRouter.handleRoute === 'function') {
        global.GMRouter.handleRoute();
      }
    }

    /**
     * Resolves the view object and render function safely.
     */
    resolveRenderFn(viewKey) {
      const viewObj = global.GMViews && global.GMViews[viewKey];
      if (viewObj && typeof viewObj.render === 'function') {
        return {
          render: (params) => viewObj.render(params),
          afterRender: typeof viewObj.afterRender === 'function' ? (params) => viewObj.afterRender(params) : null
        };
      }
      const fn = global['render' + viewKey];
      if (typeof fn === 'function') {
        return {
          render: (params) => fn(params),
          afterRender: null
        };
      }
      return null;
    }

    /**
     * Renders an enterprise fault isolation card when a view fails.
     */
    renderFaultBoundary(moduleId, err, params = {}) {
      const mod = this.getModule(moduleId) || { titleFa: moduleId, workspaceId: 'system' };
      const ws = this.workspaces[mod.workspaceId] || { titleFa: 'فضای کاری', icon: '◫' };
      const safeMessage = String(err?.message || 'خطای نامشخص در اجرای ماژول');
      const safeStack = String(err?.stack || '');
      const timestamp = new Date().toLocaleTimeString('fa-IR');

      return `
        <div class="gm-fault-boundary" role="alert" aria-live="assertive" aria-labelledby="fault-title-${moduleId}" style="padding: 1.5rem; max-width: 900px; margin: 2rem auto; font-family: inherit;">
          <div style="background: var(--gm-surface, #fff); border: 1px solid rgba(240,68,56,0.3); border-top: 4px solid #f04438; border-radius: 12px; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.08); overflow: hidden;">
            <div style="padding: 1.25rem 1.5rem; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--gm-border, #f1f5f9); background: rgba(240,68,56,0.02);">
              <div style="display: flex; align-items: center; gap: 0.75rem;">
                <span style="font-size: 1.6rem;">🛡️</span>
                <div>
                  <div style="display: flex; align-items: center; gap: 0.5rem;">
                    <h2 id="fault-title-${moduleId}" style="margin: 0; font-size: 1.05rem; color: #b42318; font-weight: 700;">
                      مهار و ایزولاسیون خطای ماژول: ${mod.titleFa}
                    </h2>
                    <span style="font-size: 0.7rem; font-weight: bold; background: rgba(230,41,42,0.1); color: #E6292A; padding: 0.15rem 0.5rem; border-radius: 10px;">
                      ${ws.icon} ${ws.titleFa}
                    </span>
                  </div>
                  <p style="margin: 0.2rem 0 0; font-size: 0.75rem; color: var(--gm-muted, #8D8F94);">
                    شناسه سیستمی: <code style="font-family: monospace;">${moduleId}</code> · زمان ثبت خطا: ${timestamp}
                  </p>
                </div>
              </div>
              <span style="display: inline-flex; align-items: center; gap: 0.35rem; font-size: 0.72rem; font-weight: 700; color: #4F8A34; background: rgba(79,138,52,0.1); padding: 0.25rem 0.65rem; border-radius: 20px;">
                <span style="width: 7px; height: 7px; border-radius: 50%; background: #4F8A34;"></span>
                سایر بخش‌های پلتفرم کاملاً فعال و پایدار هستند
              </span>
            </div>

            <div style="padding: 1.5rem;">
              <div style="background: rgba(240,68,56,0.04); border: 1px solid rgba(240,68,56,0.15); border-radius: 8px; padding: 1rem; margin-bottom: 1.25rem;">
                <div style="font-weight: 700; color: #991b1b; font-size: 0.85rem; margin-bottom: 0.3rem;">
                  علت بروز خطا:
                </div>
                <div style="font-size: 0.8rem; color: #7f1d1d; line-height: 1.5; font-family: var(--gm-font-mono, monospace);">
                  ${safeMessage}
                </div>
              </div>

              <div style="display: flex; flex-wrap: wrap; gap: 0.65rem; margin-bottom: 1.5rem;">
                <button type="button" class="btn btn-primary btn-sm" onclick="window.GMKernel ? window.GMKernel.retryModule('${moduleId}') : location.reload()" style="display: inline-flex; align-items: center; gap: 0.35rem;">
                  <span>🔄 تلاش مجدد و بارگذاری ماژول</span>
                </button>
                <button type="button" class="btn btn-outline-secondary btn-sm" onclick="window.GMKernel ? window.GMKernel.safeModeRender('${moduleId}') : null">
                  <span>🛡️ راه‌اندازی در حالت امن (Safe-Mode)</span>
                </button>
                <a href="#gm-02-overview" class="btn btn-secondary btn-sm" style="display: inline-flex; align-items: center; gap: 0.35rem;">
                  <span>◫ بازگشت به مرکز فرماندهی</span>
                </a>
                <button type="button" class="btn btn-outline-secondary btn-sm" onclick="navigator.clipboard && navigator.clipboard.writeText(JSON.stringify({ module: '${moduleId}', error: '${safeMessage.replace(/'/g, "\\'")}', time: new Date().toISOString() })); window.GMToast && window.GMToast.show('گزارش فنی خطا در حافظه موقت کپی شد.', 'info');">
                  <span>📋 کپی گزارش فنی خطا</span>
                </button>
              </div>

              <details style="border-top: 1px solid var(--gm-border, #e2e8f0); padding-top: 0.85rem;">
                <summary style="font-size: 0.75rem; font-weight: 700; color: var(--gm-muted, #64748b); cursor: pointer;">
                  مشاهده جزئیات ردگیری استک و وضعیت سیستم (Technical Diagnostics)
                </summary>
                <pre style="margin-top: 0.75rem; padding: 0.85rem; background: var(--gm-bg-subtle, #f8fafc); border: 1px solid var(--gm-border, #e2e8f0); border-radius: 6px; font-size: 0.7rem; color: #475569; overflow-x: auto; font-family: monospace; white-space: pre-wrap; line-height: 1.4;">${safeStack || 'ردگیری استک در این محیط ضبط نشده است.'}</pre>
              </details>
            </div>
          </div>
        </div>
      `;
    }

    /**
     * Executes a view inside the kernel's fault-isolated sandbox.
     * Guaranteed to never throw unhandled exceptions to the caller.
     */
    executeView(viewKey, params = {}, container = null) {
      const startTime = Date.now();
      const mod = this.getModule(viewKey) || { id: viewKey, titleFa: viewKey, status: 'healthy', errorCount: 0 };
      const renderers = this.resolveRenderFn(viewKey);

      if (!renderers) {
        const notFoundHtml = `
          <div class="card" style="margin: 32px;" role="region" aria-label="صفحه یافت نشد">
            <div class="card-body" style="text-align: center; padding: 48px 24px;">
              <h1 class="page-title">صفحه یافت نشد (۴۰۴)</h1>
              <p style="color: var(--color-slate-400); margin: 12px 0 24px;">ماژول درخواستی «${viewKey}» ثبت نشده یا تابع رندر آن موجود نیست.</p>
              <a href="#gm-02-overview" class="btn btn-primary" aria-label="بازگشت به پیشخوان راهبری">بازگشت به پیشخوان</a>
            </div>
          </div>
        `;
        if (container) container.innerHTML = notFoundHtml;
        return { success: false, html: notFoundHtml, error: new Error(`View not found: ${viewKey}`) };
      }

      // Check Circuit Breaker
      if (mod.circuitTripped && !mod.safeMode) {
        const boundaryHtml = this.renderFaultBoundary(viewKey, new Error(`مدارشکن ماژول «${mod.titleFa}» به علت خطاهای مکرر فعال شد و ماژول ایزوله است.`), params);
        if (container) container.innerHTML = boundaryHtml;
        return { success: false, html: boundaryHtml, circuitTripped: true };
      }

      try {
        const html = renderers.render(params);
        if (container) {
          container.innerHTML = html;
        }

        // Execute afterRender safely
        if (typeof renderers.afterRender === 'function') {
          try {
            renderers.afterRender(params);
          } catch (afterErr) {
            console.error(`[GMKernel] Non-fatal error in afterRender of ${viewKey}:`, afterErr);
          }
        }

        // Mark module healthy
        mod.status = 'healthy';
        mod.lastRenderedAt = Date.now();
        mod.renderDurationMs = Date.now() - startTime;

        return { success: true, html, durationMs: mod.renderDurationMs };
      } catch (err) {
        console.error(`[GMKernel] Blast-radius contained: View "${viewKey}" crashed during render:`, err);
        
        // Update module fault metrics
        mod.errorCount = (mod.errorCount || 0) + 1;
        mod.lastError = {
          message: err.message,
          stack: err.stack,
          timestamp: Date.now()
        };
        mod.status = 'isolated';

        if (mod.errorCount >= this.circuitThreshold) {
          mod.circuitTripped = true;
        }

        // Record incident to Cryptographic Audit Ledger
        this.logFaultToAudit(viewKey, err);

        // Render Fault-Isolation boundary
        const faultHtml = this.renderFaultBoundary(viewKey, err, params);
        if (container) {
          container.innerHTML = faultHtml;
        }

        return { success: false, html: faultHtml, error: err };
      }
    }

    /**
     * Standalone Mounting API: Mount any view into any arbitrary DOM element.
     */
    mount(viewKey, container, params = {}) {
      if (!container) return { success: false, error: new Error('Container required') };
      return this.executeView(viewKey, params, container);
    }

    /**
     * Standalone Unmounting API: Clean up an isolated container.
     */
    unmount(viewKey, container) {
      if (container) {
        container.innerHTML = '';
      }
      return { success: true };
    }

    /**
     * Logs isolated faults into the platform's audit chain.
     */
    logFaultToAudit(viewKey, err) {
      const store = global.prototypeStore || global.GMStore;
      if (store && typeof store.addActivity === 'function') {
        try {
          store.addActivity({
            type: 'module_fault_isolated',
            severity: 'danger',
            title: `مهار خطای ماژول: ${viewKey}`,
            description: `خطای رندر در ماژول رخ داد و توسط هسته مونولیت ایزوله شد: ${err.message}`,
            subsystem: 'ModularMonolithKernel',
            route: `#${this.getModule(viewKey)?.route || 'gm-02-overview'}`,
            routeLabel: viewKey,
            actor: 'GMKernel (حصار مهار خطا)',
            details: {
              moduleId: viewKey,
              errorMessage: err.message,
              stackSnippet: err.stack ? err.stack.slice(0, 300) : ''
            }
          });
        } catch (auditErr) {
          console.error('[GMKernel] Failed to record fault in audit ledger:', auditErr);
        }
      }
    }

    /**
     * Run full health probe across all 28 modules.
     */
    runFullProbe() {
      const results = [];
      for (const mod of this.getAllModules()) {
        const renderers = this.resolveRenderFn(mod.id);
        const hasRenderer = Boolean(renderers);
        let renderSuccess = false;
        let errMsg = null;

        if (hasRenderer) {
          try {
            const html = renderers.render({});
            renderSuccess = typeof html === 'string' && html.length > 0;
          } catch (e) {
            renderSuccess = false;
            errMsg = e.message;
          }
        }

        results.push({
          id: mod.id,
          titleFa: mod.titleFa,
          workspaceId: mod.workspaceId,
          hasRenderer,
          renderSuccess,
          status: renderSuccess ? 'healthy' : (hasRenderer ? 'failing' : 'missing'),
          errorMessage: errMsg
        });
      }

      const healthyCount = results.filter((r) => r.status === 'healthy').length;
      return {
        total: results.length,
        healthy: healthyCount,
        percent: Math.round((healthyCount / results.length) * 100),
        modules: results
      };
    }
  }

  const kernelInstance = new GMKernel();
  global.GMKernel = kernelInstance;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { GMKernel, defaultKernel: kernelInstance, CANONICAL_MODULES, WORKSPACES_MAP };
  }
})(typeof window !== 'undefined' ? window : global);
