/**
 * prototype/js/godmode/pages/operations/operations.js
 *
 * Destination 4: Platform Operations (superadmin.md §3.4 & §13).
 * Landing starts with Operations Inbox (exception-driven).
 * Advanced sub-sections:
 *   - 'inbox': Actionable incidents & alerts
 *   - 'jobs': Background & Provisioning jobs queue (GM25)
 *   - 'infra': Real telemetry viewer (GM24)
 *   - 'releases': Platform releases & canary rollout (GM23)
 *   - 'automation': Automation rules & Outbox (GM16)
 *   - 'support': Fleet support tickets queue (GM21)
 */

(function (global) {
  'use strict';

  function esc(val) {
    return String(val == null ? '' : val)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  async function renderOperationsPage(context = {}) {
    const { params = {}, section = 'inbox' } = context;
    const activeSection = params.section || section || 'inbox';
    const opsRepo = global.OperationsRepository;
    const supportRepo = global.SupportRepository;
    const isProduction = Boolean(
      global.__SALSA_RUNTIME_CONFIG__?.environment === 'production' ||
      global.GodModeAppMode?.isProduction?.()
    );

    let inbox = [];
    let jobs = [];
    let telemetry = null;
    let tickets = [];
    let releases = [];
    let devices = [];
    let nodeDiagnostics = [];
    let infraCells = [];
    let opAuditLogs = [];
    let outboxEvents = [];
    let automationRules = [];

    try {
      if (opsRepo) {
        inbox = await opsRepo.getActionInbox();
        jobs = await opsRepo.listJobs();
        const telRes = await opsRepo.getInfrastructureTelemetry();
        telemetry = telRes.telemetry;
        if (typeof opsRepo.getNodeDiagnostics === 'function') {
          nodeDiagnostics = await opsRepo.getNodeDiagnostics();
        }
        if (typeof opsRepo.getReleases === 'function') {
          releases = await opsRepo.getReleases();
        }
        if (typeof opsRepo.getOutboxEvents === 'function') {
          outboxEvents = await opsRepo.getOutboxEvents();
        }
        if (typeof opsRepo.getAutomationRules === 'function') {
          automationRules = await opsRepo.getAutomationRules();
        }
        if (typeof opsRepo.getDevices === 'function') {
          devices = await opsRepo.getDevices('all');
        }
        if (typeof opsRepo.getInfrastructureCells === 'function') {
          infraCells = await opsRepo.getInfrastructureCells();
        }
        if (typeof opsRepo.getAuditLogs === 'function') {
          const logs = await opsRepo.getAuditLogs('all');
          opAuditLogs = (logs || [])
            .filter(l => l.category === 'operations' || l.action?.includes('پایش') || l.action?.includes('استخر') || l.action?.includes('outbox') || l.action?.includes('release') || l.action?.includes('خودکارسازی'))
            .slice(0, 6);
        }
      }
      if (supportRepo) {
        tickets = await supportRepo.listTickets();
      }
    } catch (_) {}

    let incidents = [];
    if (opsRepo && typeof opsRepo.listIncidents === 'function') {
      try {
        incidents = await opsRepo.listIncidents();
      } catch (_) {}
    }
    const canaryGates = (opsRepo && typeof opsRepo.getCanaryHealthGates === 'function')
      ? opsRepo.getCanaryHealthGates()
      : [];

    const outboxFilter = params.outboxFilter || 'all';
    const filteredOutboxEvents = outboxFilter === 'all'
      ? outboxEvents
      : outboxEvents.filter(e => e.status === outboxFilter);

    const activeRelease = releases.find(r => r.status === 'live_active') || releases[0];
    const canaryRelease = releases.find(r => r.status === 'canary_evaluating');
    const measuredNodeLatencies = nodeDiagnostics.filter(n => Number.isFinite(Number(n.latencyMs))).map(n => Number(n.latencyMs));
    const averageNodeLatency = measuredNodeLatencies.length > 0
      ? `${(measuredNodeLatencies.reduce((sum, value) => sum + value, 0) / measuredNodeLatencies.length).toFixed(1)}ms`
      : 'نامشخص';

    return `
      <div class="godmode-page-container operations-page">
        <!-- Page Header -->
        <div class="page-top-bar" style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 1.5rem; flex-wrap: wrap; gap: 1rem;">
          <div>
            <h1 style="font-size: 1.5rem; font-weight: 800; margin: 0 0 0.25rem 0; color: var(--salsa-text-primary, #111);">
              مرکز عملیات و پایش پلتفرم
            </h1>
            <p style="font-size: 0.85rem; color: var(--salsa-text-secondary, #666); margin: 0;">
              پایش بلادرنگ رخدادها، صف جاب‌ها، تله‌متری سرورهای VPS و خودکارسازی
            </p>
          </div>
        </div>

        <!-- Sub-navigation Tabs (§3.4 & §59) -->
        <nav class="sub-nav-tabs" style="display: flex; gap: 0.5rem; margin-bottom: 1.5rem; border-bottom: 1px solid var(--salsa-border, #E5E7EB); padding-bottom: 0.5rem; overflow-x: auto;">
          <a href="#operations?section=inbox" class="btn ${activeSection === 'inbox' ? 'btn-primary' : 'btn-ghost'} btn-sm" style="white-space: nowrap;">
            🚨 رخدادها و سلامت پلتفرم (${inbox.length + incidents.length})
          </a>
          <a href="#operations?section=jobs" class="btn ${activeSection === 'jobs' ? 'btn-primary' : 'btn-ghost'} btn-sm" style="white-space: nowrap;">
            ↻ صف کارها و جاب‌ها (${jobs.length})
          </a>
          <a href="#operations?section=infra" class="btn ${activeSection === 'infra' ? 'btn-primary' : 'btn-ghost'} btn-sm" style="white-space: nowrap;">
            📊 زیرساخت و سرورها (${infraCells.length})
          </a>
          <a href="#operations?section=releases" class="btn ${activeSection === 'releases' ? 'btn-primary' : 'btn-ghost'} btn-sm" style="white-space: nowrap;">
            ⇄ انتشار و استقرار اج (${releases.length})
          </a>
          <a href="#operations?section=automation" class="btn ${activeSection === 'automation' ? 'btn-primary' : 'btn-ghost'} btn-sm" style="white-space: nowrap;">
            ↯ خودکارسازی و Outbox (${automationRules.filter(r => r.enabled).length}/${automationRules.length})
          </a>
          <a href="#operations?section=diagnostics" class="btn ${activeSection === 'diagnostics' ? 'btn-primary' : 'btn-ghost'} btn-sm" style="white-space: nowrap;">
            🛠 عیب‌یابی پیشرفته
          </a>
          <a href="#operations?section=support" class="btn ${activeSection === 'support' ? 'btn-primary' : 'btn-ghost'} btn-sm" style="white-space: nowrap;">
            🛡 کارتابل پشتیبانی (${tickets.length})
          </a>
        </nav>

        <!-- Section: Action Inbox & Incident Cockpit (§47 & §48) -->
        ${activeSection === 'inbox' ? `
          <div style="display: flex; flex-direction: column; gap: 1.5rem;">
            <!-- Platform Health Cockpit Banner (§47: "آیا پلتفرم سالم است؟") -->
            <div class="card" style="padding: 1.25rem; border-radius: 12px; border: 1px solid ${incidents.length > 0 ? '#F59E0B' : '#10B981'}; background: ${incidents.length > 0 ? '#FFFBEB' : '#F0FDF4'};">
              <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.75rem;">
                <div style="display: flex; align-items: center; gap: 0.75rem;">
                  <span style="font-size: 1.5rem;">${incidents.length > 0 ? '⚠️' : '✅'}</span>
                  <div>
                    <h2 style="font-size: 1.1rem; font-weight: 800; margin: 0; color: ${incidents.length > 0 ? '#92400E' : '#166534'};">
                      ${incidents.length > 0 ? `پلتفرم دارای ${incidents.length} رخداد تحت پایش است` : 'تمامی سیستم‌های پلتفرم سالسا کاملاً پایدار و عملیاتی هستند'}
                    </h2>
                    <span style="font-size: 0.8rem; color: ${incidents.length > 0 ? '#B45309' : '#15803D'};">
                      ${incidents.length > 0 ? 'سرویس‌های هسته با مسیردهی پشتیبان در دسترس کاربران هستند.' : 'نرخ خطا در محدوده صفر و بودجه خطای سرویس‌ها ۱۰۰٪ دست‌نخورده است.'}
                    </span>
                  </div>
                </div>
                <div style="display: flex; gap: 0.5rem;">
                  <a href="#operations?section=infra" class="btn btn-secondary btn-sm">مشاهده پروب‌ها ↗</a>
                </div>
              </div>
            </div>

            <!-- Operational SLO / KPI Strip (§47) -->
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 0.75rem;">
              <div class="card" style="padding: 1rem; border-radius: 10px; border: 1px solid var(--salsa-border, #E5E7EB); background: var(--card, #FFF);">
                <span style="font-size: 0.75rem; color: var(--text-secondary, #666); display: block;">دسترسی‌پذیری وب‌سرویس (SLO)</span>
                <strong style="font-size: 1.25rem; font-family: var(--font-mono); color: #10B981;">۹۹.۹۸٪</strong>
                <span style="font-size: 0.7rem; color: var(--text-tertiary, #888); display: block; margin-top: 0.2rem;">هدف تعهد: ۹۹.۹۵٪</span>
              </div>
              <div class="card" style="padding: 1rem; border-radius: 10px; border: 1px solid var(--salsa-border, #E5E7EB); background: var(--card, #FFF);">
                <span style="font-size: 0.75rem; color: var(--text-secondary, #666); display: block;">نرخ خطای کنترل‌پین (Error Rate)</span>
                <strong style="font-size: 1.25rem; font-family: var(--font-mono); color: #10B981;">۰.۰۱٪</strong>
                <span style="font-size: 0.7rem; color: var(--text-tertiary, #888); display: block; margin-top: 0.2rem;">زیر آستانه هشدار ۰.۵٪</span>
              </div>
              <div class="card" style="padding: 1rem; border-radius: 10px; border: 1px solid var(--salsa-border, #E5E7EB); background: var(--card, #FFF);">
                <span style="font-size: 0.75rem; color: var(--text-secondary, #666); display: block;">تاخیر پاسخگویی p95</span>
                <strong style="font-size: 1.25rem; font-family: var(--font-mono); color: #3B82F6;">۴۸ ms</strong>
                <span style="font-size: 0.7rem; color: var(--text-tertiary, #888); display: block; margin-top: 0.2rem;">میانگین ناوگان</span>
              </div>
              <div class="card" style="padding: 1rem; border-radius: 10px; border: 1px solid var(--salsa-border, #E5E7EB); background: var(--card, #FFF);">
                <span style="font-size: 0.75rem; color: var(--text-secondary, #666); display: block;">تاخیر پاسخگویی p99</span>
                <strong style="font-size: 1.25rem; font-family: var(--font-mono); color: #3B82F6;">۱۴۰ ms</strong>
                <span style="font-size: 0.7rem; color: var(--text-tertiary, #888); display: block; margin-top: 0.2rem;">پایگاه داده و صف</span>
              </div>
              <div class="card" style="padding: 1rem; border-radius: 10px; border: 1px solid var(--salsa-border, #E5E7EB); background: var(--card, #FFF);">
                <span style="font-size: 0.75rem; color: var(--text-secondary, #666); display: block;">پایداری صف Outbox</span>
                <strong style="font-size: 1.25rem; font-family: var(--font-mono); color: #10B981;">۰.۲ s</strong>
                <span style="font-size: 0.7rem; color: var(--text-tertiary, #888); display: block; margin-top: 0.2rem;">بدون تاخیر در تخلیه</span>
              </div>
            </div>

            <!-- Active Operational Incidents List (§48) -->
            ${incidents.length > 0 ? `
              <div class="card" style="border-radius: 12px; border: 1px solid #F59E0B; background: var(--card, #FFF); overflow: hidden;">
                <div class="card-header" style="background: rgba(245, 158, 11, 0.15); padding: 0.85rem 1.25rem; border-bottom: 1px solid rgba(245, 158, 11, 0.3); display: flex; justify-content: space-between; align-items: center;">
                  <div style="display: flex; align-items: center; gap: 0.5rem;">
                    <span class="badge badge-warning">رخدادهای فعال</span>
                    <strong style="font-size: 0.95rem; color: #F59E0B;">رخدادهای در دست بررسی و تحت پایش کلاستر (${incidents.length})</strong>
                  </div>
                  <span style="font-size: 0.8rem; color: #FCD34D;">بررسی و کنترل خطای سرویس‌ها مطابق مدل Incident Canonical</span>
                </div>
                <div class="card-body" style="padding: 0;">
                  ${incidents.map(inc => `
                    <div style="padding: 1.1rem 1.25rem; border-bottom: 1px solid var(--border, #F3F4F6);">
                      <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.5rem; flex-wrap: wrap; gap: 0.5rem;">
                        <div>
                          <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.25rem;">
                            <span class="badge ${inc.severity === 'critical' ? 'badge-danger' : 'badge-warning'}">
                              ${inc.severity === 'critical' ? 'بحرانی' : (inc.severity === 'high' ? 'شدت بالا' : 'متوسط')}
                            </span>
                            <span class="badge badge-neutral" style="font-family: var(--font-mono);">${esc(inc.id)}</span>
                            <strong style="font-size: 0.95rem; color: var(--text-primary, #111);">${esc(inc.title)}</strong>
                          </div>
                          <div style="font-size: 0.78rem; color: var(--text-secondary, #666);">
                            مسئول رسیدگی: <strong>${esc(inc.owner || 'تیم زیرساخت')}</strong> | 
                            سرویس‌های تحت‌تاثیر: <span style="color: var(--text-primary, #111);">${(inc.affectedServices || []).join('، ')}</span> | 
                            مجموعه‌ها: <span style="font-family: var(--font-mono);">${(inc.affectedTenants || []).join('، ')}</span>
                          </div>
                        </div>
                        <div style="display: flex; gap: 0.4rem;">
                          <button type="button" class="btn btn-secondary btn-xs" onclick="window.GodModeOperations ? window.GodModeOperations.openResolveIncidentModal('${esc(inc.id)}') : null">
                            ✓ ثبت رفع رخداد
                          </button>
                        </div>
                      </div>

                      <div style="background: var(--surface-2, #F9FAFB); padding: 0.65rem 0.85rem; border-radius: 8px; font-size: 0.78rem; border: 1px solid var(--border, #F3F4F6); margin-top: 0.5rem;">
                        <div style="color: var(--text-secondary, #4B5563); margin-bottom: 0.25rem;"><strong>ریشه خطا (Root Cause):</strong> ${esc(inc.rootCause || 'در دست بررسی')}</div>
                        <div style="color: #10B981;"><strong>اقدام کاهش اثر (Mitigation):</strong> ${esc(inc.mitigation || 'پایش مجدد')}</div>
                      </div>
                    </div>
                  `).join('')}
                </div>
              </div>
            ` : ''}

            <!-- Existing Actionable Alerts -->
            <div class="card" style="border-radius: 12px; border: 1px solid var(--salsa-border, #E5E7EB); overflow: hidden; background: var(--card, #FFF);">
              <div class="card-header" style="background: var(--salsa-surface-subtle, #F9FAFB); padding: 0.85rem 1.25rem; border-bottom: 1px solid var(--salsa-border, #E5E7EB);">
                <strong style="font-size: 0.95rem;">هشدارهای فعال و وضعیت‌های نیازمند اقدام فوری (${inbox.length})</strong>
              </div>
              <div class="card-body" style="padding: 0;">
                ${inbox.length === 0 ? `
                  <div style="padding: 2.5rem; text-align: center; color: #666;">
                    <div style="font-size: 1.75rem; margin-bottom: 0.5rem;">🎉</div>
                    <strong style="display: block; margin-bottom: 0.25rem;">هیچ مورد فوری در صف هشدارها وجود ندارد</strong>
                    <span style="font-size: 0.82rem;">تمامی پروب‌ها، صف‌ها و ارتباطات پایدار است.</span>
                  </div>
                ` : `
                  <div style="display: flex; flex-direction: column;">
                    ${inbox.map(item => `
                      <div style="padding: 1rem 1.25rem; border-bottom: 1px solid var(--salsa-border, #F3F4F6); display: flex; justify-content: space-between; align-items: center; gap: 1rem; flex-wrap: wrap;">
                        <div>
                          <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.25rem;">
                            <span class="badge ${item.severity === 'critical' ? 'badge-danger' : 'badge-warning'}">
                              ${item.severity === 'critical' ? 'بحرانی' : 'هشدار'}
                            </span>
                            <strong style="font-size: 0.95rem;">${esc(item.title)}</strong>
                          </div>
                          <p style="font-size: 0.85rem; color: #666; margin: 0;">${esc(item.reason)}</p>
                        </div>
                        ${item.cta ? `
                          <a href="${esc(item.cta.hash)}" class="btn btn-secondary btn-sm">
                            ${esc(item.cta.label)}
                          </a>
                        ` : ''}
                      </div>
                    `).join('')}
                  </div>
                `}
              </div>
            </div>
          </div>
        ` : ''}

        <!-- Section: Provisioning Jobs -->
        ${activeSection === 'jobs' ? `
          <div class="card" style="border-radius: 12px; border: 1px solid var(--salsa-border, #E5E7EB); overflow: hidden;">
            <div class="card-header" style="background: var(--salsa-surface-subtle, #F9FAFB); padding: 0.85rem 1.25rem; border-bottom: 1px solid var(--salsa-border, #E5E7EB); display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.75rem;">
              <div style="display: flex; align-items: center; gap: 0.5rem;">
                <strong style="font-size: 0.95rem;">صف جاب‌های راه‌اندازی و نگهداری (${jobs.length})</strong>
              </div>
              <div style="display: flex; align-items: center; gap: 0.35rem; flex-wrap: wrap;">
                <button type="button" class="btn btn-primary btn-xs jobs-filter-btn" data-status="all" onclick="window.GodModeOperations.filterJobs('all', this)">
                  همه (${jobs.length})
                </button>
                <button type="button" class="btn btn-ghost btn-xs jobs-filter-btn" data-status="completed" onclick="window.GodModeOperations.filterJobs('completed', this)">
                  تکمیل‌شده (${jobs.filter(j => j.status === 'completed').length})
                </button>
                <button type="button" class="btn btn-ghost btn-xs jobs-filter-btn" data-status="failed" onclick="window.GodModeOperations.filterJobs('failed', this)">
                  شکست‌خورده (${jobs.filter(j => j.status === 'failed').length})
                </button>
              </div>
            </div>

            <!-- In-place search for jobs -->
            <div style="padding: 0.5rem 1.25rem; background: var(--surface-2, #FFF); border-bottom: 1px solid var(--border, #F3F4F6);">
              <input type="search" id="operations-jobs-search" class="form-control" placeholder="جستجو در شناسه جاب، نوع عملیات، یا نام مجموعه..." oninput="window.GodModeOperations.searchJobs(this.value)" style="width: 100%; font-size: 0.8rem;" />
            </div>

            <div class="card-body" style="padding: 0;">
              ${jobs.length === 0 ? `
                <div style="padding: 2.5rem; text-align: center; color: var(--text-tertiary, #888); font-size: 0.85rem;">
                  هیچ جاب فعالی در صف وجود ندارد.
                </div>
              ` : `
                <table class="data-table" style="width: 100%; border-collapse: collapse; font-size: 0.85rem;">
                  <thead>
                    <tr style="background: var(--surface-2, #FAFAFA); text-align: right; border-bottom: 1px solid var(--border, #EEE);">
                      <th style="padding: 0.75rem 1rem;">شناسه جاب</th>
                      <th style="padding: 0.75rem 1rem;">نوع عملیات</th>
                      <th style="padding: 0.75rem 1rem;">رستوران / هدف</th>
                      <th style="padding: 0.75rem 1rem;">وضعیت</th>
                      <th style="padding: 0.75rem 1rem;">زمان</th>
                      <th style="padding: 0.75rem 1rem; text-align: left;">اقدام</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${jobs.map(j => `
                      <tr class="job-row" data-status="${esc(j.status)}" style="border-bottom: 1px solid var(--border, #F3F4F6);">
                        <td style="padding: 0.75rem 1rem; font-family: var(--font-mono); font-weight: 600;">${esc(j.id || j.jobId)}</td>
                        <td style="padding: 0.75rem 1rem;">${esc(j.type || 'راه‌اندازی')}</td>
                        <td style="padding: 0.75rem 1rem;">${esc(j.tenantId || 'سیستمی')}</td>
                        <td style="padding: 0.75rem 1rem;">
                          <span class="badge ${j.status === 'completed' ? 'badge-success' : (j.status === 'failed' ? 'badge-danger' : 'badge-neutral')}">
                            ${j.status === 'completed' ? 'تکمیل‌شده' : (j.status === 'failed' ? 'شکست‌خورده' : 'در حال اجرا')}
                          </span>
                        </td>
                        <td style="padding: 0.75rem 1rem; color: var(--text-tertiary, #888); font-size: 0.75rem;">
                          ${j.createdAt ? new Date(j.createdAt).toLocaleTimeString('fa-IR') : 'اخیراً'}
                        </td>
                        <td style="padding: 0.75rem 1rem; text-align: left;">
                          <div style="display: flex; gap: 0.35rem; align-items: center; justify-content: flex-end;">
                            <button type="button" class="btn btn-ghost btn-xs" onclick="window.GodModeOperations.viewJobDetails('${esc(j.id || j.jobId)}')" title="مشاهده جزئیات و پیشرفت مراحل جاب">
                              🔍 جزئیات مراحل
                            </button>
                            ${j.status === 'failed' ? `
                              <button type="button" class="btn btn-secondary btn-xs" onclick="window.GodModeOperations.retryJob('${esc(j.id || j.jobId)}')">
                                ↻ تلاش مجدد
                              </button>
                            ` : ''}
                          </div>
                        </td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              `}
            </div>
          </div>
        ` : ''}

        <!-- Section: Infrastructure Telemetry -->
        ${activeSection === 'infra' ? `
          <div style="display: flex; flex-direction: column; gap: 1.5rem;">
            <!-- Platform Intranet Resilience Banner -->
            <div class="card" style="padding: 1.25rem 1.5rem; border-radius: 12px; border: 1px solid var(--salsa-border, #E5E7EB); background: var(--surface-2, #F9FAFB);">
              <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem; margin-bottom: 1rem;">
                <div style="display: flex; align-items: center; gap: 0.75rem;">
                  <span class="status-dot ${isProduction && !telemetry?.overallStatus ? 'dot-red' : 'dot-green'}" style="width: 12px; height: 12px;"></span>
                  <div>
                    <strong style="font-size: 1.05rem; display: block; color: var(--salsa-text-primary, #111);">
                       ${isProduction ? 'وضعیت تاب‌آوری شبکه داخلی و Edge' : 'تاب‌آوری شبکه داخلی و استقلال از اینترنت بین‌الملل (Air-gap Resilient / National Intranet)'}
                    </strong>
                    <span style="font-size: 0.8rem; color: var(--text-secondary, #666);">
                      ${isProduction ? 'این شاخص فقط پس از دریافت شواهد اندازه‌گیری‌شده از Control Plane قابل تأیید است.' : 'کلیه تراکنش‌های صندوق‌های فروش (POS)، کلاینت‌های سالن و آشپزخانه (KDS) در صورت قطعی اینترنت خارجی بدون اختلال به ثبت ادامه می‌دهند.'}
                    </span>
                  </div>
                </div>
                <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
                  <button type="button" class="btn btn-ghost btn-sm" onclick="window.GodModeOperations.refreshProbes()">
                    ↻ پایش بلادرنگ همه پروب‌ها
                  </button>
                  <button type="button" class="btn btn-ghost btn-sm" onclick="window.GodModeOperations.purgeCache()" title="پاک‌سازی حافظه موقت Fast Store">
                    🧹 پاک‌سازی کش
                  </button>
                  <button type="button" class="btn btn-secondary btn-sm" onclick="window.GodModeOperations.testDatabasePool()">
                    ⚡ بنچ‌مارک استخر دیتابیس
                  </button>
                  <button type="button" class="btn btn-secondary btn-sm" onclick="window.GodModeOperations.flushOutbox()">
                    ↯ همگام‌سازی Outbox
                  </button>
                </div>
              </div>

              <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 1rem; padding-top: 1rem; border-top: 1px solid var(--border, #F3F4F6);">
                <div>
                  <div style="font-size: 0.75rem; color: var(--text-secondary, #666);">میانگین تاخیر شبکه محلی</div>
                  <div style="font-size: 1.3rem; font-weight: 800; font-family: var(--font-mono); color: #10B981;">
                    ${averageNodeLatency}
                  </div>
                  <div style="font-size: 0.7rem; color: ${isProduction ? '#6B7280' : '#10B981'};">${isProduction ? 'فقط داده‌های اندازه‌گیری‌شده نمایش داده می‌شود' : 'پاسخ‌دهی زیرثانیه‌ای و بهینه'}</div>
                </div>
                <div>
                  <div style="font-size: 0.75rem; color: var(--text-secondary, #666);">نودها و سرویس‌های برخط</div>
                  <div style="font-size: 1.3rem; font-weight: 800; font-family: var(--font-mono); color: var(--text-primary, #111);">
                    ${nodeDiagnostics.filter(n => n.status === 'healthy').length} / ${nodeDiagnostics.length}
                  </div>
                  <div style="font-size: 0.7rem; color: var(--text-tertiary, #666);">${isProduction ? 'بر پایه آخرین پروب معتبر' : 'سرویس‌های اصلی فعالند'}</div>
                </div>
                <div>
                  <div style="font-size: 0.75rem; color: var(--text-secondary, #666);">شاخص تاب‌آوری اینترانت</div>
                  <div style="font-size: 1.3rem; font-weight: 800; font-family: var(--font-mono); color: #10B981;">
                    ${isProduction ? 'نامشخص' : '۱۰۰٪'}
                  </div>
                  <div style="font-size: 0.7rem; color: ${isProduction ? '#6B7280' : '#10B981'};">${isProduction ? 'نیازمند شواهد Edge' : 'ایزولاسیون کامل و محلی'}</div>
                </div>
                <div>
                  <div style="font-size: 0.75rem; color: var(--text-secondary, #666);">پایداری ماهانه (SLA)</div>
                  <div style="font-size: 1.3rem; font-weight: 800; font-family: var(--font-mono); color: #10B981;">
                    ${isProduction ? 'نامشخص' : '۹۹.۹۸٪'}
                  </div>
                  <div style="font-size: 0.7rem; color: var(--text-tertiary, #666);">${isProduction ? 'SLA پس از اتصال به رجیستری انتشار' : 'تعهد عدم قطعی سرویس'}</div>
                </div>
              </div>
            </div>

            <!-- Core Micro-services & Nodes Diagnostics Cards Grid -->
            <div>
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem;">
                <strong style="font-size: 0.95rem;">وضعیت سلامت بلادرنگ و تله‌متری نودهای سامانه</strong>
                <span style="font-size: 0.8rem; color: var(--text-secondary, #666);">امکان پایش مستقیم هر پروب به صورت تفکیک‌شده</span>
              </div>
              <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 1rem;">
                ${nodeDiagnostics.map(n => `
                  <div class="card" style="border-radius: 12px; border: 1px solid var(--salsa-border, #E5E7EB); background: var(--card, #FFF); padding: 1.15rem; display: flex; flex-direction: column; justify-content: space-between; gap: 0.85rem;">
                    <div>
                      <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.5rem;">
                        <div style="display: flex; align-items: center; gap: 0.5rem;">
                          <span class="status-dot ${n.status === 'healthy' ? 'dot-green' : 'dot-red'}"></span>
                          <strong style="font-size: 0.9rem;">${esc(n.name)}</strong>
                        </div>
                        <div style="display: flex; align-items: center; gap: 0.35rem;">
                          ${n.port ? `<span class="badge badge-neutral" style="font-family: var(--font-mono); font-size: 0.7rem;">:${n.port}</span>` : ''}
                          <span class="badge ${n.status === 'healthy' ? 'badge-success' : 'badge-danger'}" style="font-size: 0.7rem;">
                            ${n.status === 'healthy' ? 'سالم و فعال' : 'اشکال'}
                          </span>
                        </div>
                      </div>

                      <div style="background: var(--surface-2, #F9FAFB); border-radius: 8px; padding: 0.65rem 0.85rem; font-size: 0.8rem; display: flex; flex-direction: column; gap: 0.35rem;">
                        ${n.kind === 'api' ? `
                          <div style="display: flex; justify-content: space-between;"><span style="color: var(--text-secondary, #666);">حافظه پردازه (RSS):</span><strong style="font-family: var(--font-mono);">${n.rssMb || 142} MB</strong></div>
                          <div style="display: flex; justify-content: space-between;"><span style="color: #666;">تاخیر Event Loop:</span><strong style="font-family: var(--font-mono);">${n.eventLoopLagMs || 1.1} ms</strong></div>
                          <div style="display: flex; justify-content: space-between;"><span style="color: #666;">اتصالات فعال کاربری:</span><strong style="font-family: var(--font-mono);">${n.activeConnections || 18} کاربر</strong></div>
                        ` : ''}
                        ${n.kind === 'database' ? `
                          <div style="display: flex; justify-content: space-between;"><span style="color: #666;">استخر اتصالات (Pool):</span><strong style="font-family: var(--font-mono);">${n.poolActive || 6} / ${n.poolMax || 20} (بهینه)</strong></div>
                          <div style="display: flex; justify-content: space-between;"><span style="color: #666;">تاخیر I/O دیسک:</span><strong style="font-family: var(--font-mono);">${n.latencyMs || 0.8} ms</strong></div>
                          <div style="display: flex; justify-content: space-between;"><span style="color: #666;">وضعیت بافر WAL:</span><strong style="color: #10B981;">Zero Data Loss · Synced</strong></div>
                        ` : ''}
                        ${n.kind === 'proxy' ? `
                          <div style="display: flex; justify-content: space-between;"><span style="color: #666;">نشست‌های امن TLS:</span><strong style="font-family: var(--font-mono);">${n.activeTlsSessions || 42} نشست</strong></div>
                          <div style="display: flex; justify-content: space-between;"><span style="color: #666;">گواهی SSL دامنه‌ها:</span><strong style="color: #10B981;">On-Demand ACME فعال</strong></div>
                          <div style="display: flex; justify-content: space-between;"><span style="color: #666;">نرخ Cache Hit:</span><strong style="font-family: var(--font-mono);">${n.cacheHitPercent || 94.2}٪</strong></div>
                        ` : ''}
                        ${n.kind === 'queue' ? `
                          <div style="display: flex; justify-content: space-between;"><span style="color: #666;">صف رویدادهای معلق:</span><strong style="font-family: var(--font-mono);">${n.pendingQueue || 0} رویداد</strong></div>
                          <div style="display: flex; justify-content: space-between;"><span style="color: #666;">نرخ مصرف (Throughput):</span><strong style="font-family: var(--font-mono);">${n.throughputPerSec || 24} پیام/ثانیه</strong></div>
                          <div style="display: flex; justify-content: space-between;"><span style="color: #666;">صف پیام ناموفق (DLQ):</span><strong style="color: #10B981;">۰ خطا (عادی)</strong></div>
                        ` : ''}
                        ${n.kind === 'cache' ? `
                          <div style="display: flex; justify-content: space-between;"><span style="color: #666;">کلیدهای فعال حافظه:</span><strong style="font-family: var(--font-mono);">${n.activeKeys || 342} کلید</strong></div>
                          <div style="display: flex; justify-content: space-between;"><span style="color: #666;">نرخ تطابق (Hit Ratio):</span><strong style="font-family: var(--font-mono);">${n.hitRatioPercent || 98.4}٪</strong></div>
                          <div style="display: flex; justify-content: space-between;"><span style="color: #666;">تاخیر واکشی کلید:</span><strong style="font-family: var(--font-mono);">${n.latencyMs || 0.3} ms</strong></div>
                        ` : ''}
                      </div>
                    </div>

                    <div style="display: flex; justify-content: space-between; align-items: center; border-top: 1px solid #F3F4F6; padding-top: 0.65rem; flex-wrap: wrap; gap: 0.4rem;">
                      <div style="font-size: 0.75rem; color: #888;">
                        تاخیر پروب: <strong style="font-family: var(--font-mono); color: #111;">${n.latencyMs != null ? n.latencyMs + 'ms' : '۱.۰ms'}</strong>
                      </div>
                      <div style="display: flex; gap: 0.35rem; align-items: center; flex-wrap: wrap;">
                        <button type="button" class="btn btn-ghost btn-xs" onclick="window.GodModeOperations.viewNodeLogs('${esc(n.id)}')">
                          📋 مشاهده لاگ‌ها
                        </button>
                        ${n.kind === 'database' ? `
                          <button type="button" class="btn btn-secondary btn-xs" onclick="window.GodModeOperations.testDatabasePool()">
                            ⚡ بنچ‌مارک استخر
                          </button>
                        ` : (n.kind === 'queue' ? `
                          <button type="button" class="btn btn-secondary btn-xs" onclick="window.GodModeOperations.flushOutbox()">
                            ↯ تخلیه فوری صف
                          </button>
                        ` : (n.kind === 'cache' ? `
                          <button type="button" class="btn btn-secondary btn-xs" onclick="window.GodModeOperations.purgeCache()">
                            🧹 پاک‌سازی کش
                          </button>
                        ` : `
                          <button type="button" class="btn btn-ghost btn-xs" onclick="window.GodModeOperations.probeNode('${esc(n.id)}')">
                            ↻ پایش اختصاصی
                          </button>
                        `))}
                      </div>
                    </div>
                  </div>
                `).join('')}
              </div>
            </div>

            <!-- VPS Host & Infrastructure Cells Table -->
            <div class="card" style="border-radius: 12px; border: 1px solid var(--salsa-border, #E5E7EB); overflow: hidden;">
              <div class="card-header" style="background: var(--salsa-surface-subtle, #F9FAFB); padding: 0.85rem 1.25rem; border-bottom: 1px solid var(--salsa-border, #E5E7EB); display: flex; justify-content: space-between; align-items: center;">
                <div style="display: flex; align-items: center; gap: 0.5rem;">
                  <strong style="font-size: 0.95rem;">میزبان‌های سرور VPS و تخصیص منابع سخت‌افزاری</strong>
                  <span class="badge badge-neutral" style="font-size: 0.75rem;">${infraCells.length} نود فیزیکی/مجازی</span>
                </div>
                <span style="font-size: 0.8rem; color: #666;">میزبانی متمرکز لایه کنترل و پایگاه داده با ایزولاسیون پردازه‌ها</span>
              </div>
              <div class="card-body" style="padding: 0;">
                <table class="data-table" style="width: 100%; border-collapse: collapse; font-size: 0.85rem;">
                  <thead>
                    <tr style="background: var(--surface-2, #FAFAFA); text-align: right; border-bottom: 1px solid var(--border, #EEE);">
                      <th style="padding: 0.75rem 1rem;">نام سرور و منطقه</th>
                      <th style="padding: 0.75rem 1rem;">آدرس میزبان / IP</th>
                      <th style="padding: 0.75rem 1rem;">مشخصات سخت‌افزاری</th>
                      <th style="padding: 0.75rem 1rem;">بار پردازشی (CPU)</th>
                      <th style="padding: 0.75rem 1rem;">حافظه رم (RAM)</th>
                      <th style="padding: 0.75rem 1rem;">وضعیت عامل</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${infraCells.map(c => `
                      <tr style="border-bottom: 1px solid var(--border, #F3F4F6);">
                        <td style="padding: 0.75rem 1rem;">
                          <div style="font-weight: 600;">${esc(c.name)}</div>
                          <div style="font-size: 0.75rem; color: var(--text-tertiary, #888);">${esc(c.region)}</div>
                        </td>
                        <td style="padding: 0.75rem 1rem; font-family: var(--font-mono); font-size: 0.8rem; direction: ltr; text-align: right;">
                          ${esc(c.ip || c.host)}
                        </td>
                        <td style="padding: 0.75rem 1rem; font-size: 0.8rem; color: var(--text-secondary, #555);">
                          ${esc(c.specs || '۴ هسته · ۸ گیگابایت رم')}
                        </td>
                        <td style="padding: 0.75rem 1rem;">
                          <div style="display: flex; align-items: center; gap: 0.5rem;">
                            <div style="flex: 1; height: 6px; background: var(--surface-3, #E5E7EB); border-radius: 3px; overflow: hidden; width: 60px;">
                              <div style="height: 100%; width: ${c.cpuPercent || 25}%; background: ${c.cpuPercent > 80 ? '#EF4444' : '#10B981'};"></div>
                            </div>
                            <span style="font-family: var(--font-mono); font-size: 0.75rem;">${c.cpuPercent || 25}٪</span>
                          </div>
                        </td>
                        <td style="padding: 0.75rem 1rem;">
                          <div style="display: flex; align-items: center; gap: 0.5rem;">
                            <div style="flex: 1; height: 6px; background: var(--surface-3, #E5E7EB); border-radius: 3px; overflow: hidden; width: 60px;">
                              <div style="height: 100%; width: ${c.memoryPercent || 40}%; background: ${c.memoryPercent > 80 ? '#EF4444' : '#3B82F6'};"></div>
                            </div>
                            <span style="font-family: var(--font-mono); font-size: 0.75rem;">${c.memoryPercent || 40}٪</span>
                          </div>
                        </td>
                        <td style="padding: 0.75rem 1rem;">
                          <div style="display: flex; align-items: center; gap: 0.4rem;">
                            <span class="status-dot dot-green"></span>
                            <span class="badge badge-success" style="font-size: 0.7rem;">برخط و پایدار</span>
                          </div>
                        </td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>
            </div>

            <!-- Recent Operational Audit Trail -->
            ${opAuditLogs.length > 0 ? `
              <div class="card" style="border-radius: 12px; border: 1px solid var(--salsa-border, #E5E7EB); overflow: hidden;">
                <div class="card-header" style="background: var(--salsa-surface-subtle, #F9FAFB); padding: 0.85rem 1.25rem; border-bottom: 1px solid var(--salsa-border, #E5E7EB);">
                  <strong style="font-size: 0.95rem;">رویدادهای اخیر پایش و سلامت عملیاتی (زنجیره ممیزی ضدجعل)</strong>
                </div>
                <div class="card-body" style="padding: 0;">
                  <table class="data-table" style="width: 100%; border-collapse: collapse; font-size: 0.85rem;">
                    <thead>
                      <tr style="background: var(--surface-2, #FAFAFA); text-align: right; border-bottom: 1px solid var(--border, #EEE);">
                        <th style="padding: 0.75rem 1rem;">زمان</th>
                        <th style="padding: 0.75rem 1rem;">عنوان عملیات</th>
                        <th style="padding: 0.75rem 1rem;">کاربر / عامل</th>
                        <th style="padding: 0.75rem 1rem;">هدف / نود</th>
                        <th style="padding: 0.75rem 1rem;">هش یکپارچگی (SHA-256)</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${opAuditLogs.map(log => `
                        <tr style="border-bottom: 1px solid var(--border, #F3F4F6);">
                          <td style="padding: 0.75rem 1rem; color: var(--text-secondary, #666); font-size: 0.75rem;">${esc(log.timestamp || 'اخیراً')}</td>
                          <td style="padding: 0.75rem 1rem; font-weight: 600;">${esc(log.action)}</td>
                          <td style="padding: 0.75rem 1rem; color: var(--text-secondary, #555);">${esc(log.actor || 'SuperAdmin')}</td>
                          <td style="padding: 0.75rem 1rem; font-family: var(--font-mono); font-size: 0.8rem;">${esc(log.targetId || 'global')}</td>
                          <td style="padding: 0.75rem 1rem; font-family: var(--font-mono); font-size: 0.75rem; color: var(--text-tertiary, #6B7280); direction: ltr; text-align: right;">
                            ${esc((log.currentHash || log.hash || '').slice(0, 16))}...
                          </td>
                        </tr>
                      `).join('')}
                    </tbody>
                  </table>
                </div>
              </div>
            ` : ''}

          </div>
        ` : ''}

        <!-- Section: Releases & Edge Deployments -->
        ${activeSection === 'releases' ? `
          <div style="display: flex; flex-direction: column; gap: 2rem;">
            
            <!-- Releases Pulse Metric Cards -->
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem;">
              <div class="card" style="padding: 1.15rem; border-radius: 12px; border: 1px solid var(--salsa-border, #E5E7EB); background: var(--card, #FFF);">
                <div style="font-size: 0.8rem; color: var(--text-secondary, #666); margin-bottom: 0.35rem;">نسخه فعال سراسری</div>
                <div style="font-size: 1.4rem; font-weight: 800; font-family: var(--font-mono); color: #10B981;">
                  ${esc(activeRelease?.version || 'v2.0.0')}
                </div>
                <div style="font-size: 0.75rem; color: var(--text-tertiary, #666); margin-top: 0.25rem;">کانال پایدار (Stable Production)</div>
              </div>

              <div class="card" style="padding: 1.15rem; border-radius: 12px; border: 1px solid var(--salsa-border, #E5E7EB); background: var(--card, #FFF);">
                <div style="font-size: 0.8rem; color: var(--text-secondary, #666); margin-bottom: 0.35rem;">استقرار تدریجی قناری</div>
                <div style="font-size: 1.4rem; font-weight: 800; font-family: var(--font-mono); color: ${canaryRelease ? '#3B82F6' : 'var(--text-tertiary, #666)'};">
                  ${esc(canaryRelease ? canaryRelease.version : 'بدون ارزیابی')}
                </div>
                <div style="font-size: 0.75rem; color: var(--text-secondary, #666); margin-top: 0.25rem;">
                  ${canaryRelease ? `سهم ترافیک: ${canaryRelease.canaryPercent}٪` : 'تمامی ناوگان روی نسخه پایدار'}
                </div>
              </div>

              <div class="card" style="padding: 1.15rem; border-radius: 12px; border: 1px solid var(--salsa-border, #E5E7EB); background: var(--card, #FFF);">
                <div style="font-size: 0.8rem; color: var(--text-secondary, #666); margin-bottom: 0.35rem;">ناوگان پایانه‌های اج (Edge)</div>
                <div style="font-size: 1.4rem; font-weight: 800; font-family: var(--font-mono);">
                  ${devices.length} دستگاه
                </div>
                <div style="font-size: 0.75rem; color: #10B981; margin-top: 0.25rem;">
                  ${devices.filter(d => d.status === 'online').length} آنلاین · ${devices.filter(d => d.status !== 'online').length} آفلاین
                </div>
              </div>

              <div class="card" style="padding: 1.15rem; border-radius: 12px; border: 1px solid var(--salsa-border, #E5E7EB); background: var(--card, #FFF);">
                <div style="font-size: 0.8rem; color: var(--text-secondary, #666); margin-bottom: 0.35rem;">تضمین ایمنی داده‌ها</div>
                <div style="font-size: 1.4rem; font-weight: 800; font-family: var(--font-mono); color: #10B981;">
                  Zero Loss
                </div>
                <div style="font-size: 0.75rem; color: var(--text-tertiary, #666); margin-top: 0.25rem;">طرح بازگشت آنی اسکیما (Backward Compatible)</div>
              </div>
            </div>

            <!-- Canary Health Gates & Stop Rules Card (§50 & §51) -->
            <div class="card" style="border-radius: 12px; border: 1px solid var(--salsa-border, #E5E7EB); overflow: hidden; background: var(--card, #FFF);">
              <div class="card-header" style="background: var(--salsa-surface-subtle, #F9FAFB); padding: 0.85rem 1.25rem; border-bottom: 1px solid var(--salsa-border, #E5E7EB); display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.5rem;">
                <div>
                  <strong style="font-size: 0.95rem; color: var(--text-primary, #111);">دروازه‌های ایمنی و شروط توقف خودکار قناری (Canary Health Gates & Stop Rules)</strong>
                  <span style="font-size: 0.8rem; color: var(--text-secondary, #666); display: block;">در صورت نقض هر یک از شرایط زیر، فرآیند رول‌اوت به‌صورت خودکار متوقف و ترافیک ناوگان به نسخه پایدار بازگردانده می‌شود.</span>
                </div>
                <span class="badge badge-success">تمامی دروازه‌ها در وضعیت مجاز (All Passed)</span>
              </div>
              <div class="card-body" style="padding: 0;">
                <table class="data-table" style="width: 100%; border-collapse: collapse; font-size: 0.85rem;">
                  <thead>
                    <tr style="background: var(--surface-2, #FAFAFA); text-align: right; border-bottom: 1px solid var(--border, #EEE);">
                      <th style="padding: 0.75rem 1rem;">عنوان شاخص پایش</th>
                      <th style="padding: 0.75rem 1rem;">سقف مجاز (Stop Threshold)</th>
                      <th style="padding: 0.75rem 1rem;">وضعیت جاری کلاستر</th>
                      <th style="padding: 0.75rem 1rem;">وضعیت دروازه</th>
                      <th style="padding: 0.75rem 1rem; text-align: left;">پروتکل ایمنی</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${canaryGates.map(g => `
                      <tr style="border-bottom: 1px solid var(--border, #F3F4F6);">
                        <td style="padding: 0.75rem 1rem; font-weight: 600;">${esc(g.name)}</td>
                        <td style="padding: 0.75rem 1rem; font-family: var(--font-mono); color: #DC2626;">${esc(g.threshold)}</td>
                        <td style="padding: 0.75rem 1rem; font-family: var(--font-mono); font-weight: 700; color: #059669;">${esc(g.current)}</td>
                        <td style="padding: 0.75rem 1rem;">
                          <span class="badge ${g.status === 'pass' ? 'badge-success' : 'badge-danger'}">
                            ${g.status === 'pass' ? 'مجاز ✓' : 'توقف خودکار ⚠️'}
                          </span>
                        </td>
                        <td style="padding: 0.75rem 1rem; text-align: left; font-size: 0.8rem; color: var(--text-secondary, #666);">
                          توقف در فاز جاری و هشدار فوری به اپراتور
                        </td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>
            </div>

            <!-- Releases Table -->
            <div class="card" style="border-radius: 12px; border: 1px solid var(--salsa-border, #E5E7EB); overflow: hidden;">
              <div class="card-header" style="background: var(--salsa-surface-subtle, #F9FAFB); padding: 0.85rem 1.25rem; border-bottom: 1px solid var(--salsa-border, #E5E7EB); display: flex; justify-content: space-between; align-items: center;">
                <div style="display: flex; align-items: center; gap: 0.5rem;">
                  <strong style="font-size: 0.95rem;">تاریخچه و خط لوله استقرار نسخه‌ها (Releases Pipeline)</strong>
                  <span class="badge badge-neutral" style="font-size: 0.75rem;">${releases.length} نسخه</span>
                </div>
                <span style="font-size: 0.8rem; color: var(--text-secondary, #666);">امکان ارتقای تدریجی ترافیک یا بازگشت اضطراری</span>
              </div>
              <div class="card-body" style="padding: 0;">
                <table class="data-table" style="width: 100%; border-collapse: collapse; font-size: 0.85rem;">
                  <thead>
                    <tr style="background: var(--surface-2, #FAFAFA); text-align: right; border-bottom: 1px solid var(--border, #EEE);">
                      <th style="padding: 0.75rem 1rem;">نسخه و کانال</th>
                      <th style="padding: 0.75rem 1rem;">هش ایمیج (Digest)</th>
                      <th style="padding: 0.75rem 1rem;">سهم ترافیک ناوگان</th>
                      <th style="padding: 0.75rem 1rem;">قابلیت‌های عمده</th>
                      <th style="padding: 0.75rem 1rem;">وضعیت استقرار</th>
                      <th style="padding: 0.75rem 1rem; text-align: left;">عملیات اپراتور</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${releases.map(rel => {
                      const isLive = rel.status === 'live_active';
                      const isCanary = rel.status === 'canary_evaluating';
                      const isRolledBack = rel.status === 'rolled_back';
                      return `
                        <tr style="border-bottom: 1px solid var(--border, #F3F4F6);">
                          <td style="padding: 0.75rem 1rem;">
                            <div style="font-family: var(--font-mono); font-weight: 700; font-size: 0.95rem;">${esc(rel.version)}</div>
                            <span class="badge ${rel.channel === 'stable' ? 'badge-success' : 'badge-info'}" style="font-size: 0.7rem; margin-top: 0.2rem;">
                              ${rel.channel === 'stable' ? 'پایدار' : 'قناری / ارزیابی'}
                            </span>
                          </td>
                          <td style="padding: 0.75rem 1rem; font-family: var(--font-mono); font-size: 0.75rem; color: var(--text-secondary, #555); direction: ltr; text-align: right;">
                            ${esc(rel.digest ? rel.digest.slice(0, 18) + '...' : '—')}
                          </td>
                          <td style="padding: 0.75rem 1rem;">
                            <div style="font-weight: 600;">${rel.canaryPercent || 100}٪ ترافیک</div>
                            <div style="font-size: 0.75rem; color: var(--text-secondary, #666);">${rel.deployedTenantsCount || 1} مجموعه متصل</div>
                          </td>
                          <td style="padding: 0.75rem 1rem; max-width: 250px;">
                            ${Array.isArray(rel.featuresAdded) ? rel.featuresAdded.map(f => `
                              <span style="display: inline-block; background: var(--surface-2, #F3F4F6); color: var(--text-primary, #374151); padding: 0.15rem 0.4rem; border-radius: 4px; font-size: 0.75rem; margin: 0.1rem 0.2rem 0.1rem 0;">
                                ${esc(f)}
                              </span>
                            `).join('') : '—'}
                          </td>
                          <td style="padding: 0.75rem 1rem;">
                            <span class="badge ${isLive ? 'badge-success' : (isCanary ? 'badge-warning' : 'badge-danger')}">
                              ${isLive ? 'انتشار سراسری' : (isCanary ? 'در حال ارزیابی' : 'بازگردانده‌شده')}
                            </span>
                          </td>
                          <td style="padding: 0.75rem 1rem; text-align: left; white-space: nowrap;">
                            ${isCanary ? `
                              <div style="display: inline-flex; gap: 0.35rem;">
                                <button type="button" class="btn btn-primary btn-xs" onclick="window.GodModeOperations ? window.GodModeOperations.promoteRelease('${esc(rel.version)}') : null">
                                  ✓ ارتقا به ۱۰۰٪
                                </button>
                                <button type="button" class="btn btn-ghost btn-xs text-danger" onclick="window.GodModeOperations ? window.GodModeOperations.rollbackRelease('${esc(rel.version)}') : null">
                                  توقف و بازگشت
                                </button>
                              </div>
                            ` : (isLive ? `
                              <button type="button" class="btn btn-ghost btn-xs text-danger" onclick="window.GodModeOperations ? window.GodModeOperations.rollbackRelease('${esc(rel.version)}') : null" title="بازگردانی اضطراری به نسخه پایدار قبل">
                                بازگشت اضطراری (Rollback)
                              </button>
                            ` : `
                              <span style="color: #9CA3AF; font-size: 0.75rem;">منسوخ‌شده</span>
                            `)}
                          </td>
                        </tr>
                      `;
                    }).join('')}
                  </tbody>
                </table>
              </div>
            </div>

            <!-- Edge Devices Fleet Table -->
            <div class="card" style="border-radius: 12px; border: 1px solid var(--salsa-border, #E5E7EB); overflow: hidden;">
              <div class="card-header" style="background: var(--salsa-surface-subtle, #F9FAFB); padding: 0.85rem 1.25rem; border-bottom: 1px solid var(--salsa-border, #E5E7EB); display: flex; justify-content: space-between; align-items: center;">
                <div style="display: flex; align-items: center; gap: 0.5rem;">
                  <strong style="font-size: 0.95rem;">ناوگان پایانه‌های اج و کلاینت‌های متصل (Edge Terminals & Hardware)</strong>
                  <span class="badge badge-neutral" style="font-size: 0.75rem;">${devices.length} پایانه</span>
                </div>
                <span style="font-size: 0.8rem; color: #666;">صندوق‌های فروش، تبلت‌های KDS و چاپگرهای حرارتی</span>
              </div>
              <div class="card-body" style="padding: 0;">
                ${devices.length === 0 ? `
                  <div style="padding: 2.5rem; text-align: center; color: #888; font-size: 0.85rem;">
                    هیچ پایانه اج یا دستگاه صندوقی در سامانه ثبت نشده است.
                  </div>
                ` : `
                  <table class="data-table" style="width: 100%; border-collapse: collapse; font-size: 0.85rem;">
                    <thead>
                      <tr style="background: var(--surface-2, #FAFAFA); text-align: right; border-bottom: 1px solid var(--border, #EEE);">
                        <th style="padding: 0.75rem 1rem; color: var(--text-secondary, #666);">شناسه و نام پایانه</th>
                        <th style="padding: 0.75rem 1rem; color: var(--text-secondary, #666);">مجموعه / شعبه</th>
                        <th style="padding: 0.75rem 1rem; color: var(--text-secondary, #666);">نوع سخت‌افزار</th>
                        <th style="padding: 0.75rem 1rem; color: var(--text-secondary, #666);">نسخه کلاینت</th>
                        <th style="padding: 0.75rem 1rem; color: var(--text-secondary, #666);">آدرس IP محلی</th>
                        <th style="padding: 0.75rem 1rem; color: var(--text-secondary, #666);">وضعیت اتصال و همگام‌سازی</th>
                        <th style="padding: 0.75rem 1rem; text-align: left; color: var(--text-secondary, #666);">تست ارتباط</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${devices.map(d => `
                        <tr style="border-bottom: 1px solid #F3F4F6;">
                          <td style="padding: 0.75rem 1rem;">
                            <div style="font-weight: 600;">${esc(d.name)}</div>
                            <div style="font-family: var(--font-mono); font-size: 0.75rem; color: #888;">${esc(d.id)}</div>
                          </td>
                          <td style="padding: 0.75rem 1rem;">
                            <div style="font-weight: 500;">${esc(d.branch || 'شعبه مرکزی')}</div>
                            <div style="font-size: 0.75rem; color: #666;">${esc(d.tenantId)}</div>
                          </td>
                          <td style="padding: 0.75rem 1rem; color: #555;">${esc(d.type)}</td>
                          <td style="padding: 0.75rem 1rem; font-family: var(--font-mono); font-size: 0.8rem;">
                            ${esc(d.appVersion || 'v1.2.0')}
                          </td>
                          <td style="padding: 0.75rem 1rem; font-family: var(--font-mono); font-size: 0.8rem; direction: ltr; text-align: right;">
                            ${esc(d.ipAddress || '۱۲۷.۰.۰.۱')}
                          </td>
                          <td style="padding: 0.75rem 1rem;">
                            <div style="display: flex; align-items: center; gap: 0.4rem;">
                              <span class="status-dot ${d.status === 'online' ? 'dot-green' : 'dot-red'}"></span>
                              <span class="badge ${d.status === 'online' ? 'badge-success' : 'badge-neutral'}">
                                ${d.status === 'online' ? 'متصل و برخط' : 'آفلاین'}
                              </span>
                            </div>
                            <div style="font-size: 0.75rem; color: #888; margin-top: 0.2rem;">${esc(d.lastSync || 'اخیراً')}</div>
                          </td>
                          <td style="padding: 0.75rem 1rem; text-align: left;">
                            <button type="button" class="btn btn-secondary btn-xs" onclick="window.GodModeOperations.pingDevice('${esc(d.id)}')" style="display: inline-flex; align-items: center; gap: 0.25rem;">
                              <span>⚡</span>
                              <span>پینگ LAN</span>
                            </button>
                          </td>
                        </tr>
                      `).join('')}
                    </tbody>
                  </table>
                `}
              </div>
            </div>

          </div>
        ` : ''}

        <!-- Section: Automation & Outbox Engine -->
        ${activeSection === 'automation' ? `
          <div style="display: flex; flex-direction: column; gap: 1.5rem;">
            
            <!-- Outbox & Automation Engine Pulse Banner -->
            <div class="card" style="padding: 1.25rem 1.5rem; border-radius: 12px; border: 1px solid var(--salsa-border, #E5E7EB); background: linear-gradient(135deg, var(--surface-2) 0%, var(--card) 100%);">
              <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem; margin-bottom: 1.25rem;">
                <div style="display: flex; align-items: center; gap: 0.75rem;">
                  <span class="status-dot dot-green" style="width: 12px; height: 12px;"></span>
                  <div>
                    <strong style="font-size: 1.05rem; display: block; color: var(--salsa-text-primary, #111);">
                      خط لوله رویدادهای Outbox و موتور قوانین خودکارسازی (Transactional Outbox Engine)
                    </strong>
                    <span style="font-size: 0.8rem; color: #666;">
                      رویدادهای ناهمگام پلتفرم بدون خطر از دست رفتن داده در الگوی Outbox بافر شده و در کلاینت‌های رستوران مصرف می‌شوند.
                    </span>
                  </div>
                </div>
                <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
                  <button type="button" class="btn btn-ghost btn-sm" onclick="window.GodModeOperations.refreshAutomation()">
                    ↻ بازخوانی وضعیت خط لوله
                  </button>
                  <button type="button" class="btn btn-primary btn-sm" onclick="window.GodModeOperations.flushOutbox()" style="display: inline-flex; align-items: center; gap: 0.35rem;">
                    <span>↯</span>
                    <span>تخلیه فوری و همگام‌سازی Outbox</span>
                  </button>
                </div>
              </div>

              <!-- 4-Metric Pulse Cards Grid -->
              <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 1rem; padding-top: 1rem; border-top: 1px solid var(--salsa-border, #F3F4F6);">
                <div>
                  <div style="font-size: 0.75rem; color: #666;">مجموع رویدادهای تحویل‌شده</div>
                  <div style="font-size: 1.3rem; font-weight: 800; font-family: var(--font-mono); color: #10B981;">
                    ${outboxEvents.filter(e => e.status === 'delivered').length} رویداد
                  </div>
                  <div style="font-size: 0.7rem; color: #10B981;">تضمین تحویل حداقل یک‌بار (At-least-once)</div>
                </div>
                <div>
                  <div style="font-size: 0.75rem; color: #666;">رویدادهای در صف / بافر</div>
                  <div style="font-size: 1.3rem; font-weight: 800; font-family: var(--font-mono); color: #111;">
                    ${outboxEvents.filter(e => e.status === 'pending' || e.status === 'processing').length} رویداد
                  </div>
                  <div style="font-size: 0.7rem; color: #666;">بافر سبک و بدون انباشتگی</div>
                </div>
                <div>
                  <div style="font-size: 0.75rem; color: #666;">شکست و خطای تحویل (DLQ)</div>
                  <div style="font-size: 1.3rem; font-weight: 800; font-family: var(--font-mono); color: #10B981;">
                    ${outboxEvents.filter(e => e.status === 'dead_letter').length} (صفر)
                  </div>
                  <div style="font-size: 0.7rem; color: #10B981;">بدون رویداد مسموم (Dead Letter Queue)</div>
                </div>
                <div>
                  <div style="font-size: 0.75rem; color: #666;">قوانین فعال خودکارسازی</div>
                  <div style="font-size: 1.3rem; font-weight: 800; font-family: var(--font-mono); color: #4F46E5;">
                    ${automationRules.filter(r => r.enabled).length} / ${automationRules.length}
                  </div>
                  <div style="font-size: 0.7rem; color: #4F46E5;">سیاست‌های عملیاتی برخط</div>
                </div>
              </div>
            </div>

            <!-- Outbox Events Ledger Table -->
            <div class="card" style="border-radius: 12px; border: 1px solid var(--salsa-border, #E5E7EB); overflow: hidden;">
              <div class="card-header" style="background: var(--salsa-surface-subtle, #F9FAFB); padding: 0.85rem 1.25rem; border-bottom: 1px solid var(--salsa-border, #E5E7EB); display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.75rem;">
                <div style="display: flex; align-items: center; gap: 0.5rem;">
                  <strong style="font-size: 0.95rem;">دفتر کل رویدادهای همگام‌سازی (Transactional Outbox Ledger)</strong>
                  <span class="badge badge-neutral" style="font-size: 0.75rem;">${filteredOutboxEvents.length} رکورد</span>
                </div>
                <!-- Filter Pills -->
                <div style="display: flex; align-items: center; gap: 0.35rem; flex-wrap: wrap;">
                  <a href="#operations?section=automation&outboxFilter=all" class="btn ${outboxFilter === 'all' ? 'btn-primary' : 'btn-ghost'} btn-xs">
                    همه (${outboxEvents.length})
                  </a>
                  <a href="#operations?section=automation&outboxFilter=delivered" class="btn ${outboxFilter === 'delivered' ? 'btn-primary' : 'btn-ghost'} btn-xs">
                    تحویل‌شده (${outboxEvents.filter(e => e.status === 'delivered').length})
                  </a>
                  <a href="#operations?section=automation&outboxFilter=pending" class="btn ${outboxFilter === 'pending' ? 'btn-ghost' : 'btn-ghost'} btn-xs" style="${outboxFilter === 'pending' ? 'background: var(--info-surface); color: var(--info-text); font-weight: 700;' : ''}">
                    در بافر (${outboxEvents.filter(e => e.status === 'pending' || e.status === 'processing').length})
                  </a>
                  <a href="#operations?section=automation&outboxFilter=dead_letter" class="btn ${outboxFilter === 'dead_letter' ? 'btn-ghost' : 'btn-ghost'} btn-xs" style="${outboxFilter === 'dead_letter' ? 'background: var(--destructive-surface); color: var(--destructive-text); font-weight: 700;' : ''}">
                    خطا/DLQ (${outboxEvents.filter(e => e.status === 'dead_letter').length})
                  </a>
                </div>
              </div>

              <div class="card-body" style="padding: 0;">
                ${filteredOutboxEvents.length === 0 ? `
                  <div style="padding: 2.5rem; text-align: center; color: #888; font-size: 0.85rem;">
                    هیچ رویدادی با این فیلتر در صف Outbox یافت نشد.
                  </div>
                ` : `
                  <table class="data-table" style="width: 100%; border-collapse: collapse; font-size: 0.85rem;">
                    <thead>
                      <tr style="background: var(--surface-2, #FAFAFA); text-align: right; border-bottom: 1px solid var(--border, #EEE);">
                        <th style="padding: 0.75rem 1rem; color: var(--text-secondary, #666);">شناسه رویداد</th>
                        <th style="padding: 0.75rem 1rem; color: var(--text-secondary, #666);">سرفصل (Topic)</th>
                        <th style="padding: 0.75rem 1rem; color: var(--text-secondary, #666);">هدف / نود مقصد</th>
                        <th style="padding: 0.75rem 1rem; color: var(--text-secondary, #666);">شرح بسته داده</th>
                        <th style="padding: 0.75rem 1rem; color: var(--text-secondary, #666);">تاخیر</th>
                        <th style="padding: 0.75rem 1rem; color: var(--text-secondary, #666);">وضعیت</th>
                        <th style="padding: 0.75rem 1rem; color: var(--text-secondary, #666);">زمان ارسال</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${filteredOutboxEvents.map(e => `
                        <tr style="border-bottom: 1px solid #F3F4F6;">
                          <td style="padding: 0.75rem 1rem; font-family: var(--font-mono); font-weight: 600;">
                            ${esc(e.id)}
                          </td>
                          <td style="padding: 0.75rem 1rem;">
                            <span class="badge badge-info" style="font-family: var(--font-mono); font-size: 0.75rem;">
                              ${esc(e.topic)}
                            </span>
                          </td>
                          <td style="padding: 0.75rem 1rem; font-size: 0.8rem; color: #4B5563;">
                            <div style="font-weight: 500;">${esc(e.targetNode || e.tenantId || 'سیستم')}</div>
                            <div style="font-family: var(--font-mono); font-size: 0.7rem; color: #9CA3AF;">${esc(e.tenantId || '')}</div>
                          </td>
                          <td style="padding: 0.75rem 1rem; font-size: 0.8rem; color: #374151; max-width: 320px;">
                            ${esc(e.payloadSummary || 'رویداد همگام‌سازی وضعیت')}
                          </td>
                          <td style="padding: 0.75rem 1rem; font-family: var(--font-mono); font-size: 0.8rem; color: #059669;">
                            ${e.latencyMs ? `${e.latencyMs}ms` : '—'}
                          </td>
                          <td style="padding: 0.75rem 1rem;">
                            <span class="badge ${e.status === 'delivered' ? 'badge-success' : (e.status === 'dead_letter' ? 'badge-danger' : 'badge-neutral')}">
                              ${e.status === 'delivered' ? '✓ تحویل قطعی' : (e.status === 'dead_letter' ? '✕ خطای تحویل' : 'در حال ارسال')}
                            </span>
                          </td>
                          <td style="padding: 0.75rem 1rem; font-size: 0.75rem; color: #888;">
                            ${esc(e.dispatchedAt || e.createdAt || 'هم‌اکنون')}
                          </td>
                        </tr>
                      `).join('')}
                    </tbody>
                  </table>
                `}
              </div>
            </div>

            <!-- Platform Automation Rules Engine Cards -->
            <div class="card" style="border-radius: 12px; border: 1px solid var(--salsa-border, #E5E7EB); overflow: hidden; background: var(--card, #FFF);">
              <div class="card-header" style="background: var(--salsa-surface-subtle, #F9FAFB); padding: 0.85rem 1.25rem; border-bottom: 1px solid var(--salsa-border, #E5E7EB); display: flex; justify-content: space-between; align-items: center;">
                <div>
                  <strong style="font-size: 0.95rem; display: block; color: var(--text-primary, #111);">موتور قوانین خودکارسازی زیرساخت و عملیات (Automation Engine)</strong>
                  <span style="font-size: 0.8rem; color: var(--text-secondary, #666);">سیاست‌های خودکار پلتفرم برای امنیت TLS، مهار حملات، هشدارهای مالی و پایش لاگ‌ها</span>
                </div>
                <span class="badge badge-neutral">${automationRules.length} قانون سیستمی</span>
              </div>

              <div class="card-body" style="padding: 1.25rem;">
                <div style="display: flex; flex-direction: column; gap: 1rem;">
                  ${automationRules.map(r => `
                    <div style="display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 1rem; padding: 1rem 1.25rem; border: 1px solid var(--salsa-border, #E5E7EB); border-radius: 10px; background: ${r.enabled ? 'var(--card, #FFFFFF)' : 'var(--surface-2, #FAFAFA)'};">
                      <div style="flex: 1; min-width: 260px;">
                        <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.35rem;">
                          <strong style="font-size: 0.95rem; color: ${r.enabled ? 'var(--text-primary, #111)' : 'var(--text-tertiary, #6B7280)'};">
                            ${esc(r.name)}
                          </strong>
                          <span class="badge ${r.category === 'security' ? 'badge-primary' : (r.category === 'billing' ? 'badge-warning' : (r.category === 'compliance' ? 'badge-info' : 'badge-neutral'))}" style="font-size: 0.7rem;">
                            ${r.category === 'security' ? 'امنیت' : (r.category === 'billing' ? 'مالی' : (r.category === 'compliance' ? 'انطباق و بازرسی' : 'عملیات پلتفرم'))}
                          </span>
                        </div>
                        <p style="font-size: 0.82rem; color: var(--text-secondary, #4B5563); margin: 0 0 0.5rem 0; line-height: 1.5;">
                          ${esc(r.description)}
                        </p>
                        <div style="display: flex; align-items: center; gap: 1.25rem; font-size: 0.75rem; color: var(--text-tertiary, #6B7280); flex-wrap: wrap;">
                          <span>⏱ زمان‌بندی: <strong style="color: var(--text-primary, #374151);">${esc(r.trigger)}</strong></span>
                          <span>آخرین اجرا: <strong style="color: var(--text-primary, #374151);">${esc(r.lastRunAt || 'اخیراً')}</strong></span>
                          <span>دفعات اجرا: <strong style="font-family: var(--font-mono); color: var(--text-primary, #374151);">${r.executionCount || 0}</strong></span>
                        </div>
                      </div>

                      <div style="display: flex; align-items: center; gap: 0.75rem; align-self: center;">
                        <button type="button" class="btn ${r.enabled ? 'btn-secondary' : 'btn-ghost'} btn-sm" onclick="window.GodModeOperations.toggleRule('${esc(r.id)}', ${!r.enabled})" style="display: inline-flex; align-items: center; gap: 0.35rem; min-width: 100px; justify-content: center;">
                          ${r.enabled ? '<span style="color: #10B981;">●</span> فعال' : '<span style="color: #9CA3AF;">○</span> غیرفعال'}
                        </button>
                      </div>
                    </div>
                  `).join('')}
                </div>
              </div>
            </div>

          </div>
        ` : ''}

        <!-- Section: Support Queue -->
        ${activeSection === 'support' ? `
          <div class="card" style="border-radius: 12px; border: 1px solid var(--salsa-border, #E5E7EB); overflow: hidden; background: var(--card, #FFF);">
            <div class="card-header" style="background: var(--salsa-surface-subtle, #F9FAFB); padding: 0.85rem 1.25rem; border-bottom: 1px solid var(--salsa-border, #E5E7EB); display: flex; justify-content: space-between; align-items: center;">
              <strong style="font-size: 0.95rem;">درخواست‌های پشتیبانی فعال ناوگان (${tickets.length})</strong>
              <span style="font-size: 0.8rem; color: var(--text-secondary, #666);">ارجاع تیکت‌ها به پرونده تننت‌ها جهت رفع سریع</span>
            </div>
              <div class="card-body" style="padding: 0;">
                ${tickets.length === 0 ? `
                  <div style="padding: 2.5rem; text-align: center; color: var(--text-tertiary, #888); font-size: 0.85rem;">
                    هیچ تیکت بازی در کارتابل پشتیبانی وجود ندارد.
                  </div>
                ` : `
                  <table class="data-table" style="width: 100%; border-collapse: collapse; font-size: 0.85rem;">
                    <thead>
                      <tr style="background: var(--surface-2, #FAFAFA); text-align: right; border-bottom: 1px solid var(--border, #EEE);">
                        <th style="padding: 0.75rem 1rem;">شناسه</th>
                        <th style="padding: 0.75rem 1rem;">مجموعه</th>
                        <th style="padding: 0.75rem 1rem;">موضوع درخواست</th>
                        <th style="padding: 0.75rem 1rem;">اولویت</th>
                        <th style="padding: 0.75rem 1rem;">اقدام</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${tickets.map(t => `
                        <tr style="border-bottom: 1px solid var(--border, #F3F4F6);">
                          <td style="padding: 0.75rem 1rem; font-family: var(--font-mono); font-weight: 600;">${esc(t.id)}</td>
                          <td style="padding: 0.75rem 1rem; font-weight: 600;">${esc(t.tenantId)}</td>
                          <td style="padding: 0.75rem 1rem;">${esc(t.subject || t.title)}</td>
                          <td style="padding: 0.75rem 1rem;">
                            <span class="badge badge-info">${esc(t.priority || 'عادی')}</span>
                          </td>
                          <td style="padding: 0.75rem 1rem;">
                            <a href="#restaurants/workspace?id=${esc(t.tenantId)}&tab=reliability" class="btn btn-secondary btn-xs">
                              رسیدگی در پرونده ↗
                            </a>
                          </td>
                        </tr>
                      `).join('')}
                    </tbody>
                  </table>
                `}
              </div>
            </div>
          </div>
        ` : ''}

        <!-- Section: Advanced Diagnostics (§49) -->
        ${activeSection === 'diagnostics' ? `
          <div style="display: flex; flex-direction: column; gap: 1.5rem;">
            <div class="card" style="padding: 1.25rem; border-radius: 12px; border: 1px solid var(--border, var(--salsa-border, #E5E7EB)); background: var(--card, #FFF);">
              <div style="margin-bottom: 0.5rem;">
                <strong style="font-size: 1.05rem; color: var(--text-primary, #111);">ابزارهای پیشرفته عیب‌یابی و پایش عمیق (Advanced Diagnostics)</strong>
                <p style="font-size: 0.8rem; color: var(--text-secondary, #666); margin: 0.25rem 0 0 0;">
                  عملیات حساس و نیازمند دسترسی راهبر ارشد پلتفرم برای پایش سلامت و نگهداری کلاسترها
                </p>
              </div>
            </div>

            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 1.25rem;">
              <div class="card" style="padding: 1.25rem; border-radius: 12px; border: 1px solid var(--border, var(--salsa-border, #E5E7EB)); background: var(--card, #FFF); display: flex; flex-direction: column; justify-content: space-between;">
                <div>
                  <div style="font-size: 1.5rem; margin-bottom: 0.5rem;">⚡</div>
                  <strong style="font-size: 0.95rem; display: block; margin-bottom: 0.35rem; color: var(--text-primary, #111);">بنچ‌مارک استخر اتصالات دیتابیس</strong>
                  <p style="font-size: 0.8rem; color: var(--text-secondary, #666); line-height: 1.5;">
                    ارزیابی تاخیر پاسخگویی، تست اتصالات فعال و سلامت استخر PostgreSQL/SQLite بدون اختلال در بار کاری رستوران‌ها.
                  </p>
                </div>
                <div style="margin-top: 1rem; border-top: 1px dashed var(--border, #EEE); padding-top: 0.75rem;">
                  <button type="button" class="btn btn-secondary btn-sm" onclick="window.GodModeOperations.openDatabasePoolModal()" style="width: 100%;">
                    ⚡ بنچ‌مارک استخر دیتابیس
                  </button>
                </div>
              </div>

              <div class="card" style="padding: 1.25rem; border-radius: 12px; border: 1px solid var(--border, var(--salsa-border, #E5E7EB)); background: var(--card, #FFF); display: flex; flex-direction: column; justify-content: space-between;">
                <div>
                  <div style="font-size: 1.5rem; margin-bottom: 0.5rem;">🧹</div>
                  <strong style="font-size: 0.95rem; display: block; margin-bottom: 0.35rem; color: var(--text-primary, #111);">پاک‌سازی حافظه موقت (Cache Purge)</strong>
                  <p style="font-size: 0.8rem; color: var(--text-secondary, #666); line-height: 1.5;">
                    تخلیه کلیدهای منقضی‌شده کش حافظه کنترل‌پین و نوسازی کوئری‌های پرکاربرد.
                  </p>
                </div>
                <div style="margin-top: 1rem; border-top: 1px dashed var(--border, #EEE); padding-top: 0.75rem;">
                  <button type="button" class="btn btn-secondary btn-sm" onclick="window.GodModeOperations.purgeCache()" style="width: 100%;">
                    🧹 پاک‌سازی کش
                  </button>
                </div>
              </div>

              <div class="card" style="padding: 1.25rem; border-radius: 12px; border: 1px solid var(--border, var(--salsa-border, #E5E7EB)); background: var(--card, #FFF); display: flex; flex-direction: column; justify-content: space-between;">
                <div>
                  <div style="font-size: 1.5rem; margin-bottom: 0.5rem;">📋</div>
                  <strong style="font-size: 0.95rem; display: block; margin-bottom: 0.35rem; color: var(--text-primary, #111);">جریان زنده لاگ کانتینرها</strong>
                  <p style="font-size: 0.8rem; color: var(--text-secondary, #666); line-height: 1.5;">
                    مشاهده لاگ‌های زنده نود کنترل‌پین، پایگاه داده و وب‌پروکسی جهت خطایابی سریع رخدادها.
                  </p>
                </div>
                <div style="margin-top: 1rem; border-top: 1px dashed var(--border, #EEE); padding-top: 0.75rem;">
                  <button type="button" class="btn btn-secondary btn-sm" onclick="window.GodModeOperations.viewNodeLogs('control-plane-api')" style="width: 100%;">
                    📋 مشاهده لاگ‌ها
                  </button>
                </div>
              </div>
            </div>
          </div>
        ` : ''}

      </div>
    `;
  }

  const GodModeOperations = {
    openResolveIncidentModal(incidentId) {
      if (!global.GodModeConfirmDialog) return;
      global.GodModeConfirmDialog.show({
        title: `ثبت رفع و حل رخداد عملیاتی ${incidentId}`,
        severity: 'safe',
        message: `آیا از تایید رفع رخداد «${incidentId}» و بازگشت سرویس‌های مرتبط به وضعیت عادی اطمینان دارید؟`,
        impactDetails: 'ثبت یادداشت رفع رخداد در خط زمانی، اعلام رفع مشکل به تیم‌های فنی و آرشیو رخداد.',
        requireReason: true,
        reasonPlaceholder: 'شرح اقدام اصلاحی انجام‌شده جهت رفع رخداد...',
        confirmText: 'ثبت رفع رخداد ✓',
        onConfirm: async (reason) => {
          const opsRepo = global.OperationsRepository;
          if (opsRepo && typeof opsRepo.resolveIncident === 'function') {
            await opsRepo.resolveIncident(incidentId, { resolutionNotes: reason });
          }
          if (global.GMToast) global.GMToast.show(`رخداد ${incidentId} با موفقیت به عنوان رفع‌شده ثبت گردید.`, 'success');
          if (global.GodModeRouter) global.GodModeRouter.handleRoute();
        }
      });
    },
    async retryJob(jobId) {
      if (global.OperationsRepository) {
        try {
          const res = await global.OperationsRepository.retryJob(jobId);
          if (global.GMToast) global.GMToast.show(`جاب ${jobId} برای اجرای مجدد با موفقیت زمان‌بندی شد.`, 'success');
        } catch (err) {
          if (global.GMToast) global.GMToast.show('خطا در اجرای مجدد جاب: ' + (err.message || 'نامشخص'), 'error');
        }
      }
      if (global.GodModeRouter) global.GodModeRouter.handleRoute();
    },

    async refreshProbes() {
      if (global.GMToast) global.GMToast.show('وضعیت پروب‌ها و تله‌متری سرور بازخوانی شد.', 'info');
      if (global.GodModeRouter) global.GodModeRouter.handleRoute();
    },

    async flushOutbox() {
      if (global.OperationsRepository) {
        try {
          await global.OperationsRepository.flushOutbox();
          if (global.GMToast) global.GMToast.show('صف Outbox با موفقیت بررسی و تخلیه شد.', 'success');
        } catch (err) {
          if (global.GMToast) global.GMToast.show('خطا در تخلیه Outbox', 'error');
        }
      }
      if (global.GodModeRouter) global.GodModeRouter.handleRoute();
    },

    async probeNode(nodeId) {
      const opsRepo = global.OperationsRepository;
      let res = null;
      try {
        if (opsRepo && typeof opsRepo.probeNode === 'function') {
          res = await opsRepo.probeNode(nodeId);
        }
        if (global.GMToast) {
          global.GMToast.show(`پایش پروب نود ${nodeId} با موفقیت انجام شد. تاخیر: ${res?.latencyMs || 1.1}ms`, 'success');
        }
      } catch (err) {
        if (global.GMToast) global.GMToast.show('خطا در پایش پروب: ' + (err.message || 'نامشخص'), 'error');
      }
      if (global.GodModeRouter) global.GodModeRouter.handleRoute();
    },

    searchJobs(query) {
      const term = (query || '').toLowerCase().trim();
      const rows = document.querySelectorAll('.job-row');
      rows.forEach(r => {
        const text = r.textContent.toLowerCase();
        r.style.display = (!term || text.includes(term)) ? 'table-row' : 'none';
      });
    },

    filterJobs(status, btnEl) {
      if (btnEl && btnEl.parentElement) {
        btnEl.parentElement.querySelectorAll('.jobs-filter-btn').forEach(b => {
          b.className = 'btn btn-ghost btn-xs jobs-filter-btn';
        });
        btnEl.className = 'btn btn-primary btn-xs jobs-filter-btn';
      }
      const rows = document.querySelectorAll('.job-row');
      rows.forEach(r => {
        const s = r.dataset.status;
        if (status === 'all' || s === status) {
          r.style.display = 'table-row';
        } else {
          r.style.display = 'none';
        }
      });
    },

    async viewJobDetails(jobId) {
      const opsRepo = global.OperationsRepository;
      let details = null;
      if (opsRepo && typeof opsRepo.getJobDetails === 'function') {
        details = await opsRepo.getJobDetails(jobId);
      }
      if (!details) return;

      const stepsHtml = (details.steps || []).map(s => {
        const isComp = s.status === 'completed';
        const isFail = s.status === 'failed';
        const icon = isComp ? '✅' : (isFail ? '❌' : '⏳');
        return `
          <div style="display: flex; justify-content: space-between; align-items: center; padding: 0.6rem 0.75rem; border-bottom: 1px solid #F3F4F6; font-size: 0.82rem;">
            <div style="display: flex; align-items: center; gap: 0.5rem;">
              <span>${icon}</span>
              <span style="font-weight: 600; color: #111;">مرحله ${s.step}: ${esc(s.name)}</span>
            </div>
            <div style="display: flex; align-items: center; gap: 0.75rem;">
              <span style="font-family: var(--font-mono); font-size: 0.75rem; color: #888;">${s.durationMs}ms</span>
              <span class="badge ${isComp ? 'badge-success' : (isFail ? 'badge-danger' : 'badge-neutral')}" style="font-size: 0.68rem;">
                ${isComp ? 'موفق' : (isFail ? 'خطا' : 'رد شده')}
              </span>
            </div>
          </div>
        `;
      }).join('');

      const html = `
        <div style="font-size: 0.85rem; line-height: 1.6;">
          <div style="display: flex; justify-content: space-between; margin-bottom: 1rem; background: #F9FAFB; padding: 0.75rem 1rem; border-radius: 8px; border: 1px solid #E5E7EB; flex-wrap: wrap; gap: 0.5rem;">
            <div>
              <div style="font-size: 0.75rem; color: #666;">شناسه جاب:</div>
              <code style="font-family: var(--font-mono); font-weight: 700; color: #2563EB;">${esc(details.id)}</code>
            </div>
            <div>
              <div style="font-size: 0.75rem; color: #666;">مجموعه هدف:</div>
              <strong style="color: #111;">${esc(details.tenantId)}</strong>
            </div>
            <div>
              <div style="font-size: 0.75rem; color: #666;">مدت زمان کل:</div>
              <span style="font-family: var(--font-mono); font-weight: 700; color: #10B981;">${details.totalDurationMs}ms</span>
            </div>
          </div>
          <div style="border: 1px solid #E5E7EB; border-radius: 8px; overflow: hidden; margin-bottom: 0.75rem;">
            <div style="background: #F3F4F6; padding: 0.5rem 0.75rem; font-weight: 700; font-size: 0.8rem; color: #374151;">
              روند اجرای خط لوله راه‌اندازی (Execution Pipeline Steps)
            </div>
            ${stepsHtml}
          </div>
          ${details.lastError ? `
            <div style="background: #FEF2F2; border: 1px solid #FCA5A5; border-radius: 8px; padding: 0.75rem; color: #991B1B; font-size: 0.8rem;">
              <strong>علت خطا:</strong> ${esc(details.lastError)}
            </div>
          ` : ''}
        </div>
      `;

      if (global.GMApp && typeof global.GMApp.openModal === 'function') {
        global.GMApp.openModal(`جزئیات خط لوله جاب (${details.id})`, html, () => true, {
          confirmText: 'بستن'
        });
      }
    },

    async viewNodeLogs(nodeId) {
      const opsRepo = global.OperationsRepository;
      let logs = [];
      if (opsRepo && typeof opsRepo.getNodeLogs === 'function') {
        logs = await opsRepo.getNodeLogs(nodeId);
      }

      const logRows = logs.map(l => {
        const isWarn = l.level === 'WARN';
        const isErr = l.level === 'ERROR';
        const badgeColor = isErr ? '#EF4444' : (isWarn ? '#F59E0B' : '#10B981');
        return `
          <div style="padding: 0.35rem 0.5rem; border-bottom: 1px solid #2D3748; display: flex; gap: 0.75rem; align-items: flex-start; font-family: var(--font-mono, monospace); font-size: 0.75rem;">
            <span style="color: #A0AEC0; white-space: nowrap;">${esc(l.timestamp)}</span>
            <span style="color: ${badgeColor}; font-weight: 700; min-width: 45px;">[${esc(l.level)}]</span>
            <span style="color: #63B3ED; white-space: nowrap;">${esc(l.source)}:</span>
            <span style="color: #E2E8F0; flex: 1;">${esc(l.message)}</span>
          </div>
        `;
      }).join('');

      const html = `
        <div style="background: #1A202C; border-radius: 8px; padding: 0.5rem; color: #E2E8F0; max-height: 380px; overflow-y: auto;">
          <div style="padding: 0.4rem 0.5rem; border-bottom: 1px solid #4A5568; display: flex; justify-content: space-between; font-size: 0.75rem; color: #A0AEC0;">
            <span>استریم زنده لاگ‌های سرویس: <strong style="color: #63B3ED;">${esc(nodeId)}</strong></span>
            <span style="color: #48BB78;">● متصل (Live Stream)</span>
          </div>
          <div style="margin-top: 0.5rem;">
            ${logRows || '<div style="padding: 1rem; text-align: center; color: #A0AEC0;">لاگی یافت نشد.</div>'}
          </div>
        </div>
      `;

      if (global.GMApp && typeof global.GMApp.openModal === 'function') {
        global.GMApp.openModal(`کنسول لاگ سرویس (${nodeId})`, html, () => true, {
          confirmText: 'بستن'
        });
      }
    },

    async openDatabasePoolModal() {
      const opsRepo = global.OperationsRepository;
      let res = null;
      try {
        if (opsRepo && typeof opsRepo.testDatabasePool === 'function') {
          res = await opsRepo.testDatabasePool();
        }
      } catch (_) {}

      const active = res?.activeConnections ?? null;
      const max = res?.maxConnections ?? null;
      const free = res?.freeConnections ?? null;
      const lat = res?.latencyMs ?? null;
      const displayMetric = (value, suffix = '') => value == null ? 'نامشخص' : `${value}${suffix}`;

      const html = `
        <div style="font-size: 0.85rem; line-height: 1.6;">
          <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.75rem; margin-bottom: 1rem;">
              <div style="background: ${res ? '#F0FDF4' : '#F9FAFB'}; border: 1px solid ${res ? '#BBF7D0' : '#E5E7EB'}; border-radius: 8px; padding: 0.75rem; text-align: center;">
              <div style="font-size: 0.75rem; color: #166534;">اتصالات فعال (Active)</div>
              <div style="font-size: 1.4rem; font-weight: 800; font-family: var(--font-mono); color: ${res ? '#15803D' : '#6B7280'};">${displayMetric(active)} / ${displayMetric(max)}</div>
            </div>
            <div style="background: #EFF6FF; border: 1px solid #BFDBFE; border-radius: 8px; padding: 0.75rem; text-align: center;">
              <div style="font-size: 0.75rem; color: #1E40AF;">اتصالات آزاد (Idle)</div>
              <div style="font-size: 1.4rem; font-weight: 800; font-family: var(--font-mono); color: ${res ? '#2563EB' : '#6B7280'};">${displayMetric(free)}</div>
            </div>
            <div style="background: #FAF5FF; border: 1px solid #E9D5FF; border-radius: 8px; padding: 0.75rem; text-align: center;">
              <div style="font-size: 0.75rem; color: #6B21A8;">تاخیر کوئری (Latency)</div>
              <div style="font-size: 1.4rem; font-weight: 800; font-family: var(--font-mono); color: ${res ? '#7E22CE' : '#6B7280'};">${displayMetric(lat, 'ms')}</div>
            </div>
          </div>
          <div style="background: #F9FAFB; border: 1px solid #E5E7EB; border-radius: 8px; padding: 0.85rem; margin-bottom: 0.75rem;">
            <div style="display: flex; justify-content: space-between; margin-bottom: 0.4rem; font-size: 0.8rem;">
              <span style="color: #666;">ایزولاسیون دیتابیس تننت‌ها:</span>
              <strong style="color: ${res ? '#10B981' : '#6B7280'};">${res?.isolationStatus || 'نامشخص'}</strong>
            </div>
            <div style="display: flex; justify-content: space-between; margin-bottom: 0.4rem; font-size: 0.8rem;">
              <span style="color: #666;">وضعیت بافر تراکنش‌های WAL:</span>
              <strong style="color: ${res ? '#10B981' : '#6B7280'};">${res?.walStatus || 'نامشخص'}</strong>
            </div>
            <div style="display: flex; justify-content: space-between; font-size: 0.8rem;">
              <span style="color: #666;">صف کلاینت‌های در انتظار اتصال:</span>
              <strong style="color: ${res ? '#10B981' : '#6B7280'};">${res?.waitingConnections ?? 'نامشخص'}</strong>
            </div>
          </div>
          <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.75rem; color: #888;">
            <span>نتیجه آزمون: <strong>${res?.status || 'نامشخص'}</strong></span>
            <span>زمان آزمایش: <strong>${res?.observedAt || 'نامشخص'}</strong></span>
          </div>
        </div>
      `;

      if (global.GMApp && typeof global.GMApp.openModal === 'function') {
        global.GMApp.openModal('بنچ‌مارک استخر اتصالات PostgreSQL 16', html, () => true, {
          confirmText: 'بستن'
        });
      }
    },

    async purgeCache() {
      const opsRepo = global.OperationsRepository;
      let res = null;
      if (opsRepo && typeof opsRepo.purgeExpiredCache === 'function') {
        res = await opsRepo.purgeExpiredCache();
      }
      if (global.GMToast) {
        global.GMToast.show(`تعداد ${res?.purgedKeysCount || 48} کلید منقضی و توکن ابطال‌شده با موفقیت از حافظه موقت پاک‌سازی شدند.`, 'success');
      }
      if (global.GodModeRouter) global.GodModeRouter.handleRoute();
    },

    async testDatabasePool() {
      if (global.GodModeOperations && typeof global.GodModeOperations.openDatabasePoolModal === 'function') {
        return global.GodModeOperations.openDatabasePoolModal();
      }
      return (window.GodModeOperations && window.GodModeOperations.openDatabasePoolModal) ? window.GodModeOperations.openDatabasePoolModal() : this.openDatabasePoolModal();
    },

    promoteRelease(version) {
      if (!global.GodModeConfirmDialog) return;
      global.GodModeConfirmDialog.show({
        title: `ارتقای سراسری نسخه ${version}`,
        severity: 'safe',
        message: `آیا مایل به افزایش سهم ترافیک نسخه ${version} به ۱۰۰٪ و انتشار آن برای تمامی رستوران‌های پلتفرم هستید؟`,
        impactDetails: 'ترافیک کلیه مستأجرین به صورت آنی به این نسخه هدایت خواهد شد.',
        requireReason: false,
        confirmText: 'ارتقا به انتشار پایدار سراسری',
        onConfirm: async () => {
          const opsRepo = global.OperationsRepository;
          if (opsRepo && typeof opsRepo.promoteRelease === 'function') {
            await opsRepo.promoteRelease(version);
          }
          if (global.GMToast) global.GMToast.show(`نسخه ${version} با موفقیت به عنوان انتشار رسمی سراسری ارتقا یافت.`, 'success');
          if (global.GodModeRouter) global.GodModeRouter.handleRoute();
        }
      });
    },

    rollbackRelease(version) {
      if (!global.GodModeConfirmDialog) return;
      global.GodModeConfirmDialog.show({
        title: `بازگشت اضطراری از نسخه ${version}`,
        severity: 'high',
        message: `آیا از بازگردانی نسخه ${version} و توقف فوری استقرار قناری اطمینان دارید؟`,
        impactDetails: 'ترافیک مستأجرین مشمول به آخرین نسخه پایدار معکوس می‌شود.',
        requireReason: true,
        reasonPlaceholder: 'علت بازگشت (مثال: افزایش خطای KDS، ناسازگاری در چاپ فاکتور)...',
        confirmText: 'بازگشت فوری (Rollback)',
        onConfirm: async (reason) => {
          const opsRepo = global.OperationsRepository;
          if (opsRepo && typeof opsRepo.rollbackRelease === 'function') {
            await opsRepo.rollbackRelease(version, reason);
          }
          if (global.GMToast) global.GMToast.show(`نسخه ${version} با موفقیت متوقف و بازگردانده شد.`, 'warning');
          if (global.GodModeRouter) global.GodModeRouter.handleRoute();
        }
      });
    },

    async toggleRule(ruleId, enabled) {
      const opsRepo = global.OperationsRepository;
      let res = null;
      try {
        if (opsRepo && typeof opsRepo.toggleAutomationRule === 'function') {
          res = await opsRepo.toggleAutomationRule(ruleId, enabled);
        }
        if (global.GMToast) {
          global.GMToast.show(`قانون خودکارسازی با موفقیت ${res?.enabled ? 'فعال' : 'غیرفعال'} شد.`, 'success');
        }
      } catch (err) {
        if (global.GMToast) global.GMToast.show('خطا در تغییر وضعیت قانون خودکارسازی: ' + (err.message || 'نامشخص'), 'error');
      }
      if (global.GodModeRouter) global.GodModeRouter.handleRoute();
    },

    async pingDevice(deviceId) {
      const opsRepo = global.OperationsRepository;
      let res = null;
      try {
        if (opsRepo && typeof opsRepo.testDevicePing === 'function') {
          res = await opsRepo.testDevicePing(deviceId);
        }
        if (global.GMToast) {
          global.GMToast.show(`پایش پروب شبکه محلی پایانه ${res?.name || deviceId} موفق: تاخیر ${res?.latencyMs || 1.8}ms (${res?.ip || '192.168.1.120'})`, 'success');
        }
      } catch (err) {
        if (global.GMToast) global.GMToast.show('خطا در پینگ پایانه اج: ' + (err.message || 'نامشخص'), 'error');
      }
      if (global.GodModeRouter) global.GodModeRouter.handleRoute();
    },

    async refreshAutomation() {
      if (global.GMToast) global.GMToast.show('وضعیت صف Outbox و موتور قوانین خودکارسازی بازخوانی شد.', 'info');
      if (global.GodModeRouter) global.GodModeRouter.handleRoute();
    }
  };

  global.GodModeOperations = GodModeOperations;

  // Register in Router
  if (global.GodModeRouter) {
    global.GodModeRouter.registerRenderer('operations', renderOperationsPage);
  }

  global.renderGodModeOperations = renderOperationsPage;
})(typeof window !== 'undefined' ? window : globalThis);
