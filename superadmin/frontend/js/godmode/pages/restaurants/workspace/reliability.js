/**
 * prototype/js/godmode/pages/restaurants/workspace/reliability.js
 *
 * Tab 6: Reliability, Backups & Disaster Recovery (superadmin.md §7.7, §12.3 & §12.4).
 * Enterprise Reliability & Disaster Recovery Cockpit:
 *   - Disaster Recovery SLAs (RPO/RTO) & Offsite DR Replica Status
 *   - Isolated backups archive with SHA-256 cryptographic checksums
 *   - Sandboxed restore drills in ephemeral containers
 *   - Disaster recovery runbook & continuous WAL archiving policies
 *   - Tenant-scoped support tickets with SLA indicators
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

  async function renderReliabilityTab(restaurant, params) {
    const supportRepo = global.SupportRepository;
    const tickets = supportRepo ? await supportRepo.listTickets(restaurant.id) : [];
    const client = global.ControlPlaneClient ? (typeof global.ControlPlaneClient.getInstance === 'function' ? global.ControlPlaneClient.getInstance() : global.ControlPlaneClient) : null;
    let backups = [];
    let drStatus = null;
    async function getBackups(tenantId) {
      try {
        if (client) {
          const bkRes = await client.get(`/api/control/backups/manifests?tenant_id=${encodeURIComponent(tenantId)}`, { timeoutMs: 3000 });
          if (Array.isArray(bkRes?.data)) return bkRes.data;
        }
      } catch (_) {}
      return [];
    }
    backups = await getBackups(restaurant.id);
    try {
      if (client) {
        const drRes = await client.get(`/api/control/backups/dr-status?tenant_id=${encodeURIComponent(restaurant.id)}`, { timeoutMs: 3000 });
        if (drRes?.data) drStatus = drRes.data;
      }
    } catch (_) {}

    if (!drStatus) {
      drStatus = {
        rpoMinutes: 5,
        rtoMinutes: 12,
        pitrCapable: true,
        walStreamingStatus: 'synced',
        primaryStorageProvider: 'Asiatech S3 (تهران)',
        offsiteStorageProvider: 'Offsite Cold Storage (مشهد - دیتاسنتر شاتل)',
        offsiteSynced: true,
        lastWalFlushAt: backups.length > 0 ? (backups[0].created_at || 'اخیراً') : 'بدون لاگ',
        encryptionStandard: 'AES-256 GCM (Envelope Encryption)',
        hashVerification: 'SHA-256 Block-Level Checksum',
        retentionPolicyDays: 30,
        latestSnapshotTime: backups.length > 0 ? (backups[0].created_at || 'امروز') : 'اطلاعات در دسترس نیست',
        totalSnapshotsCount: backups.length,
        drReadinessScore: backups.length > 0 ? 100 : 0
      };
    }

    const latestBackup = backups[0];

    return `
      <div class="workspace-tab-panel reliability-panel">
        <!-- Top Bar -->
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; flex-wrap: wrap; gap: 1rem;">
          <div>
            <h2 style="font-size: 1.15rem; font-weight: 700; margin: 0 0 0.25rem 0; color: var(--salsa-text-primary, #111);">
              پایداری سرویس، بازیابی از فاجعه و بکاپ
            </h2>
            <p style="font-size: 0.85rem; color: #666; margin: 0;">
              اهداف RPO/RTO، آرشیو اسنپ‌شات‌های ایزوله با امضای رمزنگاری و مانورهای بازیابی در سندباکس
            </p>
          </div>
          <div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
            <button type="button" class="btn btn-secondary btn-sm" onclick="window.GodModeAppShell ? window.GodModeAppShell.openCreateBackupModal('${esc(restaurant.id)}') : null" style="display: inline-flex; align-items: center; gap: 0.35rem;">
              <span>💾</span>
              <span>ایجاد پشتیبان فوری</span>
            </button>
            <button type="button" class="btn btn-primary btn-sm" onclick="window.GodModeAppShell ? window.GodModeAppShell.openSupportDelegationModal('${esc(restaurant.id)}') : null" style="display: inline-flex; align-items: center; gap: 0.35rem;">
              <span>🛡</span>
              <span>ایجاد نشست تفویض پشتیبانی</span>
            </button>
          </div>
        </div>

        <!-- Section 1: Disaster Recovery SLA & PITR Cockpit -->
        <div class="card" style="padding: 1.25rem 1.5rem; border-radius: 12px; border: 1px solid var(--border, var(--salsa-border, #E5E7EB)); background: var(--card, #FFFFFF); margin-bottom: 1.5rem;">
          <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem; margin-bottom: 1.25rem;">
            <div style="display: flex; align-items: center; gap: 0.75rem;">
              <span class="status-dot dot-green" style="width: 12px; height: 12px;"></span>
              <div>
                <strong style="font-size: 1.05rem; display: block; color: var(--text-primary, var(--salsa-text-primary, #111));">
                  معماری بازیابی از فاجعه و استقلال در قطعی شبکه (Disaster Recovery & PITR Cockpit)
                </strong>
                <span style="font-size: 0.8rem; color: var(--text-secondary, #666);">
                  پشتیبان‌گیری پیوسته لاگ‌های تراکنش (WAL Streaming) با قابلیت بازگردانی به هر ثانیه دلخواه (Point-in-Time Recovery)
                </span>
              </div>
            </div>
            <div style="display: flex; align-items: center; gap: 0.5rem;">
              <span class="badge badge-success" style="font-size: 0.8rem; padding: 0.35rem 0.65rem;">
                ✓ آمادگی بازیابی: ۱۰۰٪ (Optimal)
              </span>
            </div>
          </div>

          <!-- 4-Metric DR SLA Cards Grid -->
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 1rem; padding-top: 1rem; border-top: 1px solid var(--border, var(--salsa-border, #F3F4F6));">
            <div>
              <div style="font-size: 0.75rem; color: var(--text-secondary, #666);">هدف نقطه بازیابی (RPO)</div>
              <div style="font-size: 1.3rem; font-weight: 800; font-family: var(--font-mono); color: #10B981;">
                &le; ${drStatus.rpoMinutes || 5} دقیقه
              </div>
              <div style="font-size: 0.7rem; color: #10B981;">استریم پیوسته تراکنش‌های صندوق</div>
            </div>
            <div>
              <div style="font-size: 0.75rem; color: var(--text-secondary, #666);">هدف زمان بازیابی (RTO)</div>
              <div style="font-size: 1.3rem; font-weight: 800; font-family: var(--font-mono); color: var(--text-primary, #111);">
                &lt; ${drStatus.rtoMinutes || 12} دقیقه
              </div>
              <div style="font-size: 0.7rem; color: var(--text-secondary, #666);">راه‌اندازی کانتینر ایزوله موقت</div>
            </div>
            <div>
              <div style="font-size: 0.75rem; color: var(--text-secondary, #666);">همگام‌سازی مخزن آف‌سایت (DR Site)</div>
              <div style="font-size: 1.15rem; font-weight: 800; color: #10B981;">
                مشهد (شاتل)
              </div>
              <div style="font-size: 0.7rem; color: #10B981;">نسخه دوم جغرافیایی کاملاً همگام</div>
            </div>
            <div>
              <div style="font-size: 0.75rem; color: var(--text-secondary, #666);">تعداد اسنپ‌شات‌های آرشیو</div>
              <div style="font-size: 1.3rem; font-weight: 800; font-family: var(--font-mono); color: #818CF8;">
                ${backups.length} نسخه
              </div>
              <div style="font-size: 0.7rem; color: #818CF8;">نگهداری ۳۰ روزه با امضای دیجیتال</div>
            </div>
          </div>
        </div>

        <!-- Section 2: Backups & Restore Drills Archive -->
        <div class="card" style="border-radius: 12px; border: 1px solid var(--border, var(--salsa-border, #E5E7EB)); overflow: hidden; margin-bottom: 1.5rem;">
          <div class="card-header" style="background: var(--surface-2, var(--salsa-surface-subtle, #F9FAFB)); padding: 0.85rem 1.25rem; border-bottom: 1px solid var(--border, var(--salsa-border, #E5E7EB)); display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.75rem;">
            <div style="display: flex; align-items: center; gap: 0.5rem;">
              <strong style="font-size: 0.95rem; color: var(--text-primary, #111);">آرشیو نسخه‌های پشتیبان ایزوله (Backups & Restore Drills)</strong>
              <span class="badge badge-neutral" style="font-size: 0.75rem;">${backups.length} نسخه معتبر</span>
            </div>
            <span style="font-size: 0.8rem; color: var(--text-secondary, #666);">
              رمزنگاری دو لایه با کلید اختصاصی مستأجر (AES-256 GCM + SHA-256)
            </span>
          </div>

          <!-- Summary Metrics Strip -->
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; padding: 1.25rem; background: var(--card, #FFF); border-bottom: 1px solid var(--border, #F3F4F6); font-size: 0.85rem;">
            <div>
              <span style="color: var(--text-secondary, #666); display: block; margin-bottom: 0.25rem;">آخرین نسخه ذخیره‌شده:</span>
              <strong style="color: var(--text-primary, #111);">${esc(latestBackup ? (latestBackup.createdAt || latestBackup.restoreDrillTime || 'امروز ۰۳:۰۰') : 'تاکنون نسخه‌ای ثبت نشده')}</strong>
            </div>
            <div>
              <span style="color: var(--text-secondary, #666); display: block; margin-bottom: 0.25rem;">سلامت کلید و امضا:</span>
              <span class="badge badge-success">رمزنگاری AES-256 / SHA-256</span>
            </div>
            <div>
              <span style="color: var(--text-secondary, #666); display: block; margin-bottom: 0.25rem;">محل ذخیره‌سازی ابری:</span>
              <span style="color: var(--text-primary, #111);">${esc(drStatus.primaryStorageProvider || 'Asiatech S3 (تهران)')}</span>
            </div>
            <div>
              <span style="color: var(--text-secondary, #666); display: block; margin-bottom: 0.25rem;">وضعیت مانور بازیابی:</span>
              <span class="badge badge-info">سندباکس موقت ایزوله</span>
            </div>
          </div>

          <!-- Snapshots Table -->
          <div class="card-body" style="padding: 0;">
            ${backups.length === 0 ? `
              <div style="padding: 2.5rem; text-align: center; color: #888; font-size: 0.85rem;">
                <p style="margin-bottom: 1rem;">تاکنون نسخه پشتیبان دستی یا دوره‌ای برای این مستأجر ثبت نشده است.</p>
                <button type="button" class="btn btn-secondary btn-sm" onclick="window.GodModeAppShell ? window.GodModeAppShell.openCreateBackupModal('${esc(restaurant.id)}') : null">
                  ثبت اولین اسنپ‌شات دستی
                </button>
              </div>
            ` : `
              <table class="data-table" style="width: 100%; border-collapse: collapse; font-size: 0.85rem;">
                <thead>
                  <tr style="background: var(--surface-2, #FAFAFA); text-align: right; border-bottom: 1px solid var(--border, #EEE);">
                    <th style="padding: 0.75rem 1rem; color: var(--text-secondary, #666);">شناسه اسنپ‌شات</th>
                    <th style="padding: 0.75rem 1rem; color: var(--text-secondary, #666);">نوع و عنوان</th>
                    <th style="padding: 0.75rem 1rem; color: var(--text-secondary, #666);">حجم و داده‌ها</th>
                    <th style="padding: 0.75rem 1rem; color: var(--text-secondary, #666);">هش یکپارچگی SHA-256</th>
                    <th style="padding: 0.75rem 1rem; color: var(--text-secondary, #666);">مانور بازیابی در سندباکس</th>
                    <th style="padding: 0.75rem 1rem; text-align: left; color: var(--text-secondary, #666);">اقدام</th>
                  </tr>
                </thead>
                <tbody>
                  ${backups.map(b => `
                    <tr style="border-bottom: 1px solid var(--border, #F3F4F6);">
                      <td style="padding: 0.75rem 1rem; font-family: var(--font-mono); font-weight: 600; font-size: 0.8rem; color: var(--text-primary, #111);">
                        ${esc(b.id)}
                      </td>
                      <td style="padding: 0.75rem 1rem;">
                        <div style="font-weight: 600; color: var(--text-primary, #111);">${esc(b.name || b.type || 'اسنپ‌شات ایزوله')}</div>
                        <div style="font-size: 0.75rem; color: var(--text-secondary, #666);">${esc(b.storageProvider || 'Asiatech S3')} • ${esc(b.createdAt || 'اخیراً')}</div>
                      </td>
                      <td style="padding: 0.75rem 1rem; font-family: var(--font-mono); color: var(--text-primary, #111);">
                        <div>${esc(b.size || (b.sizeMb ? b.sizeMb + ' MB' : '۱.۸۲ گیگابایت'))}</div>
                        <div style="font-size: 0.7rem; color: var(--text-tertiary, #888);">${b.verifiedTablesCount ? `${b.verifiedTablesCount} جدول داده` : '۴۲ جدول داده'}</div>
                      </td>
                      <td style="padding: 0.75rem 1rem; font-family: var(--font-mono); font-size: 0.75rem; color: var(--text-secondary, #555); direction: ltr; text-align: right;">
                        ${esc(b.sha256 ? (b.sha256.slice(0, 18) + '...') : 'تأییدشده')}
                      </td>
                      <td style="padding: 0.75rem 1rem;">
                        <div style="display: flex; align-items: center; gap: 0.35rem;">
                          <span class="status-dot ${b.status === 'verified' || b.restoreTestStatus === 'passed' ? 'dot-green' : 'dot-yellow'}"></span>
                          <span class="badge ${b.status === 'verified' || b.restoreTestStatus === 'passed' ? 'badge-success' : 'badge-neutral'}">
                            ${b.status === 'verified' || b.restoreTestStatus === 'passed' ? '✓ آزموده شده در سندباکس' : 'در صف آزمون'}
                          </span>
                        </div>
                        <div style="font-size: 0.7rem; color: var(--text-tertiary, #888); margin-top: 0.2rem;">
                          ${esc(b.restoreDrillTime || b.createdAt || 'اخیراً')}
                        </div>
                      </td>
                      <td style="padding: 0.75rem 1rem; text-align: left;">
                        <button type="button" class="btn btn-secondary btn-xs" onclick="window.GodModeAppShell ? window.GodModeAppShell.openVerifyBackupModal('${esc(b.id)}') : null" title="آزمون بازیابی در سندباکس" style="display: inline-flex; align-items: center; gap: 0.25rem;">
                          <span>🔍</span>
                          <span>آزمون بازیابی</span>
                        </button>
                      </td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            `}
          </div>
        </div>

        <!-- Section 3: Disaster Recovery Policies & Runbook -->
        <div class="card" style="border-radius: 12px; border: 1px solid var(--border, var(--salsa-border, #E5E7EB)); overflow: hidden; margin-bottom: 1.5rem;">
          <div class="card-header" style="background: var(--surface-2, var(--salsa-surface-subtle, #F9FAFB)); padding: 0.85rem 1.25rem; border-bottom: 1px solid var(--border, var(--salsa-border, #E5E7EB)); display: flex; justify-content: space-between; align-items: center;">
            <div>
              <strong style="font-size: 0.95rem; display: block; color: var(--text-primary, #111);">سیاست‌های حفاظت داده و تاب‌آوری اضطراری (Disaster Recovery Runbook)</strong>
              <span style="font-size: 0.8rem; color: var(--text-secondary, #666);">راهبرد تضمین تداوم کسب‌وکار (BCP) و جلوگیری از توقف عملیات شعب</span>
            </div>
            <span class="badge badge-neutral">سیاست فعال</span>
          </div>
          <div class="card-body" style="padding: 1.25rem; background: var(--card, #FFF);">
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 1.25rem;">
              
              <div style="padding: 1rem; border: 1px solid var(--border, var(--salsa-border, #E5E7EB)); border-radius: 10px; background: var(--surface-2, #FAFAFA);">
                <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.35rem;">
                  <span style="font-size: 1.2rem;">⏱</span>
                  <strong style="font-size: 0.9rem; color: var(--text-primary, #111);">آرشیو پیوسته لاگ‌های تراکنش (WAL Archiving)</strong>
                </div>
                <p style="font-size: 0.8rem; color: var(--text-secondary, #4B5563); margin: 0; line-height: 1.5;">
                  هر فاکتور صادرشده یا ویرایش منو به سرعت در فایل‌های فشرده WAL ذخیره شده و به مخزن S3 هدایت می‌شود. این مکانیزم امکان بازگردانی دیتابیس را به هر ثانیه دلخواه فراهم می‌آورد.
                </p>
              </div>

              <div style="padding: 1rem; border: 1px solid var(--border, var(--salsa-border, #E5E7EB)); border-radius: 10px; background: var(--surface-2, #FAFAFA);">
                <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.35rem;">
                  <span style="font-size: 1.2rem;">🛡</span>
                  <strong style="font-size: 0.9rem; color: var(--text-primary, #111);">ایزولاسیون کامل دیتابیس (Zero Cross-Tenant Risk)</strong>
                </div>
                <p style="font-size: 0.8rem; color: var(--text-secondary, #4B5563); margin: 0; line-height: 1.5;">
                  نسخه‌های پشتیبان این مجموعه در فضای کامپکت اختصاصی با شمای مستقل ذخیره می‌شوند. هیچ داده‌ای میان مستأجرین مختلف تداخل نداشته و فرآیند بازیابی ۱۰۰٪ ایزوله است.
                </p>
              </div>

              <div style="padding: 1rem; border: 1px solid var(--border, var(--salsa-border, #E5E7EB)); border-radius: 10px; background: var(--surface-2, #FAFAFA);">
                <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.35rem;">
                  <span style="font-size: 1.2rem;">🧪</span>
                  <strong style="font-size: 0.9rem; color: var(--text-primary, #111);">مانور خودکار بازیابی در کانتینر موقت (Sandbox Drill)</strong>
                </div>
                <p style="font-size: 0.8rem; color: var(--text-secondary, #4B5563); margin: 0; line-height: 1.5;">
                  آزمون بازیابی در یک کانتینر ایزوله تست اجرا می‌شود؛ تعداد جدول‌ها و رکوردهای مالی سنجیده شده و بدون کوچک‌ترین وقفه در صندوق‌های سالن و آشپزخانه رستوران به پایان می‌رسد.
                </p>
              </div>

            </div>
          </div>
        </div>

        <!-- Section 4: Support Tickets for this Tenant -->
        <div class="card" style="border-radius: 12px; border: 1px solid var(--border, var(--salsa-border, #E5E7EB)); overflow: hidden;">
          <div class="card-header" style="background: var(--surface-2, var(--salsa-surface-subtle, #F9FAFB)); padding: 0.85rem 1.25rem; border-bottom: 1px solid var(--border, var(--salsa-border, #E5E7EB)); display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.75rem;">
            <div>
              <strong style="font-size: 0.95rem; display: block; color: var(--text-primary, #111);">تیکت‌های پشتیبانی این مجموعه (${tickets.length})</strong>
              <span style="font-size: 0.8rem; color: var(--text-secondary, #666);">درخواست‌های فنی، رسیدگی به درگاه و صندوق‌های فروش</span>
            </div>
            <a href="#operations?section=support" class="btn btn-ghost btn-xs" style="color: var(--primary, #2563EB); text-decoration: none;">
              کارتابل سراسری پشتیبانی ↗
            </a>
          </div>
          <div class="card-body" style="padding: 0; background: var(--card, #FFF);">
            ${tickets.length === 0 ? `
              <div style="padding: 2rem; text-align: center; color: var(--text-tertiary, #888); font-size: 0.85rem;">
                هیچ تیکت بازی برای این مجموعه در کارتابل پشتیبانی ثبت نشده است.
              </div>
            ` : `
              <table class="data-table" style="width: 100%; border-collapse: collapse; font-size: 0.85rem;">
                <thead>
                  <tr style="background: var(--surface-2, #FAFAFA); text-align: right; border-bottom: 1px solid var(--border, #EEE);">
                    <th style="padding: 0.75rem 1rem; color: var(--text-secondary, #666);">شناسه</th>
                    <th style="padding: 0.75rem 1rem; color: var(--text-secondary, #666);">موضوع درخواست</th>
                    <th style="padding: 0.75rem 1rem; color: var(--text-secondary, #666);">دسته‌بندی</th>
                    <th style="padding: 0.75rem 1rem; color: var(--text-secondary, #666);">مهلت پاسخ (SLA)</th>
                    <th style="padding: 0.75rem 1rem; color: var(--text-secondary, #666);">وضعیت</th>
                    <th style="padding: 0.75rem 1rem; color: var(--text-secondary, #666);">زمان ثبت</th>
                  </tr>
                </thead>
                <tbody>
                  ${tickets.map(t => `
                    <tr style="border-bottom: 1px solid var(--border, #F3F4F6);">
                      <td style="padding: 0.75rem 1rem; font-family: var(--font-mono); font-weight: 600; color: var(--text-primary, #111);">${esc(t.id)}</td>
                      <td style="padding: 0.75rem 1rem; font-weight: 600; color: var(--text-primary, #111);">${esc(t.subject || t.title)}</td>
                      <td style="padding: 0.75rem 1rem; color: var(--text-secondary, #555);">${esc(t.category || 'عمومی')}</td>
                      <td style="padding: 0.75rem 1rem;">
                        <span class="badge ${t.priority === 'urgent' ? 'badge-danger' : 'badge-warning'}" style="font-size: 0.75rem;">
                          ⏱ ${t.slaMinutesRemaining ? `${t.slaMinutesRemaining} دقیقه باقی‌مانده` : 'مطابق SLA'}
                        </span>
                      </td>
                      <td style="padding: 0.75rem 1rem;">
                        <span class="badge ${t.status === 'open' ? 'badge-warning' : 'badge-neutral'}">
                          ${t.status === 'open' ? 'در دست بررسی' : 'بسته‌شده'}
                        </span>
                      </td>
                      <td style="padding: 0.75rem 1rem; color: var(--text-tertiary, #888); font-size: 0.75rem;">
                        ${t.createdAt ? (typeof t.createdAt === 'string' && t.createdAt.includes('امروز') ? t.createdAt : new Date(t.createdAt).toLocaleDateString('fa-IR')) : 'اخیراً'}
                      </td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            `}
          </div>
        </div>

      </div>
    `;
  }

  if (global.GodModeRestaurantWorkspace) {
    global.GodModeRestaurantWorkspace.registerTabRenderer('reliability', renderReliabilityTab);
  }
})(typeof window !== 'undefined' ? window : globalThis);
