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
    const store = global.prototypeStore || global.GMStore;
    const backups = store && typeof store.getBackups === 'function' ? store.getBackups(restaurant.id) : [];
    const drStatus = store && typeof store.getDisasterRecoveryStatus === 'function'
      ? store.getDisasterRecoveryStatus(restaurant.id)
      : {
          rpoMinutes: 5,
          rtoMinutes: 12,
          pitrCapable: true,
          walStreamingStatus: 'synced',
          primaryStorageProvider: 'Asiatech S3 (تهران)',
          offsiteStorageProvider: 'Offsite Cold Storage (مشهد - دیتاسنتر شاتل)',
          offsiteSynced: true,
          lastWalFlushAt: '۱ دقیقه قبل',
          encryptionStandard: 'AES-256 GCM (Envelope Encryption)',
          hashVerification: 'SHA-256 Block-Level Checksum',
          retentionPolicyDays: 30,
          latestSnapshotTime: 'امروز ۰۳:۰۰',
          totalSnapshotsCount: backups.length,
          drReadinessScore: 100
        };

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
        <div class="card" style="padding: 1.25rem 1.5rem; border-radius: 12px; border: 1px solid var(--salsa-border, #E5E7EB); background: linear-gradient(135deg, #F9FAFB 0%, #FFFFFF 100%); margin-bottom: 1.5rem;">
          <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem; margin-bottom: 1.25rem;">
            <div style="display: flex; align-items: center; gap: 0.75rem;">
              <span class="status-dot dot-green" style="width: 12px; height: 12px;"></span>
              <div>
                <strong style="font-size: 1.05rem; display: block; color: var(--salsa-text-primary, #111);">
                  معماری بازیابی از فاجعه و استقلال در قطعی شبکه (Disaster Recovery & PITR Cockpit)
                </strong>
                <span style="font-size: 0.8rem; color: #666;">
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
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 1rem; padding-top: 1rem; border-top: 1px solid var(--salsa-border, #F3F4F6);">
            <div>
              <div style="font-size: 0.75rem; color: #666;">هدف نقطه بازیابی (RPO)</div>
              <div style="font-size: 1.3rem; font-weight: 800; font-family: var(--font-mono); color: #10B981;">
                &le; ${drStatus.rpoMinutes || 5} دقیقه
              </div>
              <div style="font-size: 0.7rem; color: #10B981;">استریم پیوسته تراکنش‌های صندوق</div>
            </div>
            <div>
              <div style="font-size: 0.75rem; color: #666;">هدف زمان بازیابی (RTO)</div>
              <div style="font-size: 1.3rem; font-weight: 800; font-family: var(--font-mono); color: #111;">
                &lt; ${drStatus.rtoMinutes || 12} دقیقه
              </div>
              <div style="font-size: 0.7rem; color: #666;">راه‌اندازی کانتینر ایزوله موقت</div>
            </div>
            <div>
              <div style="font-size: 0.75rem; color: #666;">همگام‌سازی مخزن آف‌سایت (DR Site)</div>
              <div style="font-size: 1.15rem; font-weight: 800; color: #10B981;">
                مشهد (شاتل)
              </div>
              <div style="font-size: 0.7rem; color: #10B981;">نسخه دوم جغرافیایی کاملاً همگام</div>
            </div>
            <div>
              <div style="font-size: 0.75rem; color: #666;">تعداد اسنپ‌شات‌های آرشیو</div>
              <div style="font-size: 1.3rem; font-weight: 800; font-family: var(--font-mono); color: #4F46E5;">
                ${backups.length} نسخه
              </div>
              <div style="font-size: 0.7rem; color: #4F46E5;">نگهداری ۳۰ روزه با امضای دیجیتال</div>
            </div>
          </div>
        </div>

        <!-- Section 2: Backups & Restore Drills Archive -->
        <div class="card" style="border-radius: 12px; border: 1px solid var(--salsa-border, #E5E7EB); overflow: hidden; margin-bottom: 1.5rem;">
          <div class="card-header" style="background: var(--salsa-surface-subtle, #F9FAFB); padding: 0.85rem 1.25rem; border-bottom: 1px solid var(--salsa-border, #E5E7EB); display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.75rem;">
            <div style="display: flex; align-items: center; gap: 0.5rem;">
              <strong style="font-size: 0.95rem;">آرشیو نسخه‌های پشتیبان ایزوله (Backups & Restore Drills)</strong>
              <span class="badge badge-neutral" style="font-size: 0.75rem;">${backups.length} نسخه معتبر</span>
            </div>
            <span style="font-size: 0.8rem; color: #666;">
              رمزنگاری دو لایه با کلید اختصاصی مستأجر (AES-256 GCM + SHA-256)
            </span>
          </div>

          <!-- Summary Metrics Strip -->
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; padding: 1.25rem; background: #FFF; border-bottom: 1px solid #F3F4F6; font-size: 0.85rem;">
            <div>
              <span style="color: #666; display: block; margin-bottom: 0.25rem;">آخرین نسخه ذخیره‌شده:</span>
              <strong style="color: #111;">${esc(latestBackup ? (latestBackup.createdAt || latestBackup.restoreDrillTime || 'امروز ۰۳:۰۰') : 'تاکنون نسخه‌ای ثبت نشده')}</strong>
            </div>
            <div>
              <span style="color: #666; display: block; margin-bottom: 0.25rem;">سلامت کلید و امضا:</span>
              <span class="badge badge-success">رمزنگاری AES-256 / SHA-256</span>
            </div>
            <div>
              <span style="color: #666; display: block; margin-bottom: 0.25rem;">محل ذخیره‌سازی ابری:</span>
              <span>${esc(drStatus.primaryStorageProvider || 'Asiatech S3 (تهران)')}</span>
            </div>
            <div>
              <span style="color: #666; display: block; margin-bottom: 0.25rem;">وضعیت مانور بازیابی:</span>
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
                  <tr style="background: #FAFAFA; text-align: right; border-bottom: 1px solid #EEE;">
                    <th style="padding: 0.75rem 1rem;">شناسه اسنپ‌شات</th>
                    <th style="padding: 0.75rem 1rem;">نوع و عنوان</th>
                    <th style="padding: 0.75rem 1rem;">حجم و داده‌ها</th>
                    <th style="padding: 0.75rem 1rem;">هش یکپارچگی SHA-256</th>
                    <th style="padding: 0.75rem 1rem;">مانور بازیابی در سندباکس</th>
                    <th style="padding: 0.75rem 1rem; text-align: left;">اقدام</th>
                  </tr>
                </thead>
                <tbody>
                  ${backups.map(b => `
                    <tr style="border-bottom: 1px solid #F3F4F6;">
                      <td style="padding: 0.75rem 1rem; font-family: var(--font-mono); font-weight: 600; font-size: 0.8rem;">
                        ${esc(b.id)}
                      </td>
                      <td style="padding: 0.75rem 1rem;">
                        <div style="font-weight: 600; color: #111;">${esc(b.name || b.type || 'اسنپ‌شات ایزوله')}</div>
                        <div style="font-size: 0.75rem; color: #666;">${esc(b.storageProvider || 'Asiatech S3')} • ${esc(b.createdAt || 'اخیراً')}</div>
                      </td>
                      <td style="padding: 0.75rem 1rem; font-family: var(--font-mono);">
                        <div>${esc(b.size || (b.sizeMb ? b.sizeMb + ' MB' : '۱.۸۲ گیگابایت'))}</div>
                        <div style="font-size: 0.7rem; color: #888;">${b.verifiedTablesCount ? `${b.verifiedTablesCount} جدول داده` : '۴۲ جدول داده'}</div>
                      </td>
                      <td style="padding: 0.75rem 1rem; font-family: var(--font-mono); font-size: 0.75rem; color: #555; direction: ltr; text-align: right;">
                        ${esc(b.sha256 ? (b.sha256.slice(0, 18) + '...') : 'تأییدشده')}
                      </td>
                      <td style="padding: 0.75rem 1rem;">
                        <div style="display: flex; align-items: center; gap: 0.35rem;">
                          <span class="status-dot ${b.status === 'verified' || b.restoreTestStatus === 'passed' ? 'dot-green' : 'dot-yellow'}"></span>
                          <span class="badge ${b.status === 'verified' || b.restoreTestStatus === 'passed' ? 'badge-success' : 'badge-neutral'}">
                            ${b.status === 'verified' || b.restoreTestStatus === 'passed' ? '✓ آزموده شده در سندباکس' : 'در صف آزمون'}
                          </span>
                        </div>
                        <div style="font-size: 0.7rem; color: #888; margin-top: 0.2rem;">
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
        <div class="card" style="border-radius: 12px; border: 1px solid var(--salsa-border, #E5E7EB); overflow: hidden; margin-bottom: 1.5rem;">
          <div class="card-header" style="background: var(--salsa-surface-subtle, #F9FAFB); padding: 0.85rem 1.25rem; border-bottom: 1px solid var(--salsa-border, #E5E7EB); display: flex; justify-content: space-between; align-items: center;">
            <div>
              <strong style="font-size: 0.95rem; display: block;">سیاست‌های حفاظت داده و تاب‌آوری اضطراری (Disaster Recovery Runbook)</strong>
              <span style="font-size: 0.8rem; color: #666;">راهبرد تضمین تداوم کسب‌وکار (BCP) و جلوگیری از توقف عملیات شعب</span>
            </div>
            <span class="badge badge-neutral">سیاست فعال</span>
          </div>
          <div class="card-body" style="padding: 1.25rem;">
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 1.25rem;">
              
              <div style="padding: 1rem; border: 1px solid var(--salsa-border, #E5E7EB); border-radius: 10px; background: #FAFAFA;">
                <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.35rem;">
                  <span style="font-size: 1.2rem;">⏱</span>
                  <strong style="font-size: 0.9rem; color: #111;">آرشیو پیوسته لاگ‌های تراکنش (WAL Archiving)</strong>
                </div>
                <p style="font-size: 0.8rem; color: #4B5563; margin: 0; line-height: 1.5;">
                  هر فاکتور صادرشده یا ویرایش منو به سرعت در فایل‌های فشرده WAL ذخیره شده و به مخزن S3 هدایت می‌شود. این مکانیزم امکان بازگردانی دیتابیس را به هر ثانیه دلخواه فراهم می‌آورد.
                </p>
              </div>

              <div style="padding: 1rem; border: 1px solid var(--salsa-border, #E5E7EB); border-radius: 10px; background: #FAFAFA;">
                <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.35rem;">
                  <span style="font-size: 1.2rem;">🛡</span>
                  <strong style="font-size: 0.9rem; color: #111;">ایزولاسیون کامل دیتابیس (Zero Cross-Tenant Risk)</strong>
                </div>
                <p style="font-size: 0.8rem; color: #4B5563; margin: 0; line-height: 1.5;">
                  نسخه‌های پشتیبان این مجموعه در فضای کامپکت اختصاصی با شمای مستقل ذخیره می‌شوند. هیچ داده‌ای میان مستأجرین مختلف تداخل نداشته و فرآیند بازیابی ۱۰۰٪ ایزوله است.
                </p>
              </div>

              <div style="padding: 1rem; border: 1px solid var(--salsa-border, #E5E7EB); border-radius: 10px; background: #FAFAFA;">
                <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.35rem;">
                  <span style="font-size: 1.2rem;">🧪</span>
                  <strong style="font-size: 0.9rem; color: #111;">مانور خودکار بازیابی در کانتینر موقت (Sandbox Drill)</strong>
                </div>
                <p style="font-size: 0.8rem; color: #4B5563; margin: 0; line-height: 1.5;">
                  آزمون بازیابی در یک کانتینر ایزوله تست اجرا می‌شود؛ تعداد جدول‌ها و رکوردهای مالی سنجیده شده و بدون کوچک‌ترین وقفه در صندوق‌های سالن و آشپزخانه رستوران به پایان می‌رسد.
                </p>
              </div>

            </div>
          </div>
        </div>

        <!-- Section 4: Support Tickets for this Tenant -->
        <div class="card" style="border-radius: 12px; border: 1px solid var(--salsa-border, #E5E7EB); overflow: hidden;">
          <div class="card-header" style="background: var(--salsa-surface-subtle, #F9FAFB); padding: 0.85rem 1.25rem; border-bottom: 1px solid var(--salsa-border, #E5E7EB); display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.75rem;">
            <div>
              <strong style="font-size: 0.95rem; display: block;">تیکت‌های پشتیبانی این مجموعه (${tickets.length})</strong>
              <span style="font-size: 0.8rem; color: #666;">درخواست‌های فنی، رسیدگی به درگاه و صندوق‌های فروش</span>
            </div>
            <a href="#operations?section=support" class="btn btn-ghost btn-xs" style="color: #2563EB; text-decoration: none;">
              کارتابل سراسری پشتیبانی ↗
            </a>
          </div>
          <div class="card-body" style="padding: 0;">
            ${tickets.length === 0 ? `
              <div style="padding: 2rem; text-align: center; color: #888; font-size: 0.85rem;">
                هیچ تیکت بازی برای این مجموعه در کارتابل پشتیبانی ثبت نشده است.
              </div>
            ` : `
              <table class="data-table" style="width: 100%; border-collapse: collapse; font-size: 0.85rem;">
                <thead>
                  <tr style="background: #FAFAFA; text-align: right; border-bottom: 1px solid #EEE;">
                    <th style="padding: 0.75rem 1rem;">شناسه</th>
                    <th style="padding: 0.75rem 1rem;">موضوع درخواست</th>
                    <th style="padding: 0.75rem 1rem;">دسته‌بندی</th>
                    <th style="padding: 0.75rem 1rem;">مهلت پاسخ (SLA)</th>
                    <th style="padding: 0.75rem 1rem;">وضعیت</th>
                    <th style="padding: 0.75rem 1rem;">زمان ثبت</th>
                  </tr>
                </thead>
                <tbody>
                  ${tickets.map(t => `
                    <tr style="border-bottom: 1px solid #F3F4F6;">
                      <td style="padding: 0.75rem 1rem; font-family: var(--font-mono); font-weight: 600;">${esc(t.id)}</td>
                      <td style="padding: 0.75rem 1rem; font-weight: 600; color: #111;">${esc(t.subject || t.title)}</td>
                      <td style="padding: 0.75rem 1rem; color: #555;">${esc(t.category || 'عمومی')}</td>
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
                      <td style="padding: 0.75rem 1rem; color: #888; font-size: 0.75rem;">
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
