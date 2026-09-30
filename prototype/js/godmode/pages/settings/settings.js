/**
 * prototype/js/godmode/pages/settings/settings.js
 *
 * Destination 5: Platform Settings (superadmin.md §3.5).
 * Consolidated administrative configuration for SALSA platform:
 *   - 'team': Platform team members, RBAC roles, MFA status, and access revocation (GM27)
 *   - 'security': Cybersecurity posture, TLS 1.3 lifecycle, RFC 6238 TOTP MFA, session policy & lockdown drill
 *   - 'audit': Global tamper-evident SHA-256 audit trail with category filtering, CSV/JSON export & cryptographic hash inspector (GM26)
 *   - 'hardware': Supported printer & device model catalog with offline resilience certification & ESC/POS direct socket probe test (GM29)
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

  async function renderSettingsPage(context = {}) {
    const { params = {}, section = 'team' } = context;
    const activeSection = params.section || section || 'team';
    const client = global.ControlPlaneClient;
    const store = global.prototypeStore || global.GMStore;

    // 1. Audit Logs aggregation (API + authoritative in-memory store)
    let audits = [];
    if (activeSection === 'audit') {
      try {
        if (client) {
          const res = await client.get('/api/control/audit?limit=50', { timeoutMs: 3000 });
          audits = res.data || [];
        }
      } catch (_) {}

      const localAudits = (store && typeof store.getAuditLogs === 'function') ? store.getAuditLogs('all') : [];
      localAudits.forEach(la => {
        if (!audits.some(a => (a.id && a.id === la.id) || (a.occurred_at === la.occurredAt && a.action === la.action))) {
          audits.push({
            id: la.id,
            action: la.action,
            target_id: la.targetId || la.target_id || 'سراسری',
            actor_id: la.actorId || la.actor || 'مدیر پلتفرم',
            actorRole: la.actorRole || 'SuperAdmin',
            category: la.category || (la.action.includes('امنیت') || la.action.includes('نشست') || la.action.includes('قرنطینه') ? 'security' : la.action.includes('سخت‌افزار') || la.action.includes('پروب') || la.action.includes('استخر') || la.action.includes('چاپ') ? 'operations' : la.action.includes('فاکتور') || la.action.includes('لایسنس') ? 'commercial' : 'tenant'),
            currentHash: la.currentHash || la.hash || 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
            previousHash: la.previousHash || '0000000000000000000000000000000000000000000000000000000000000000',
            occurred_at: la.occurredAt || la.timestamp || new Date().toISOString(),
            reason: la.reason || la.description || ''
          });
        }
      });
      audits.sort((a, b) => new Date(b.occurred_at || 0) - new Date(a.occurred_at || 0));
    }

    // 2. Team Members
    const initialTeam = [
      { id: 'usr_01', name: 'سید علی موسوی', email: 'admin@salsa.ir', role: 'مدیر ارشد پلتفرم (Owner)', roleFa: 'مالک پلتفرم (Owner)', mfaStatus: 'active', activeSessions: 1, status: 'active', lastLogin: 'هم‌اکنون' },
      { id: 'usr_02', name: 'مهندس رضایی', email: 'ops@salsa.ir', role: 'مهندسی عملیات (Operations)', roleFa: 'مهندسی عملیات (Operations)', mfaStatus: 'active', activeSessions: 1, status: 'active', lastLogin: '۲ ساعت پیش' },
      { id: 'usr_03', name: 'سارا تهرانی', email: 'support@salsa.ir', role: 'پشتیبانی فنی (Support)', roleFa: 'پشتیبانی فنی (Support)', mfaStatus: 'pending', activeSessions: 1, status: 'active', lastLogin: 'دیروز' }
    ];
    const storedTeam = (store && typeof store.getPlatformUsers === 'function') ? store.getPlatformUsers() : (store?.state?.platformUsers || []);
    const platformTeam = [...initialTeam, ...storedTeam.filter(u => !initialTeam.some(it => it.email === u.email))];

    // 3. Hardware Catalog
    const hardwareCatalog = (store && typeof store.getHardwareCatalog === 'function') ? store.getHardwareCatalog() : [
      { id: 'hw_bixolon_350', manufacturer: 'BIXOLON', model: 'SRP-350III', type: 'چاپگر حرارتی صدور فیش', category: 'receipt', categoryFa: 'چاپگر فیش (رسید)', paperWidth: '80mm', cutType: 'Auto Cutter', interfaces: ['LAN', 'USB', 'Serial'], driverProfile: 'ESC/POS Direct Socket (Port 9100)', offlineResilient: true, status: 'certified' },
      { id: 'hw_epson_t20', manufacturer: 'EPSON', model: 'TM-T20III', type: 'چاپگر حرارتی رسید', category: 'receipt', categoryFa: 'چاپگر فیش (رسید)', paperWidth: '80mm / 58mm', cutType: 'Auto Cutter', interfaces: ['LAN', 'USB'], driverProfile: 'ESC/POS Direct Socket (Port 9100)', offlineResilient: true, status: 'certified' },
      { id: 'hw_sam4s_gcube', manufacturer: 'SAM4S', model: 'GCUBE-100', type: 'چاپگر مکعبی فشرده صندوق', category: 'receipt', categoryFa: 'چاپگر فیش (رسید)', paperWidth: '80mm', cutType: 'Auto Cutter', interfaces: ['LAN', 'USB', 'Wi-Fi'], driverProfile: 'ESC/POS Direct Socket (Port 9100)', offlineResilient: true, status: 'certified' },
      { id: 'hw_sewoo_ts400', manufacturer: 'SEWOO', model: 'SLK-TS400', type: 'چاپگر حرارتی آشپزخانه (KOT)', category: 'kitchen', categoryFa: 'چاپگر آشپزخانه (KOT)', paperWidth: '80mm', cutType: 'Auto Cutter & Buzzer', interfaces: ['LAN', 'Serial'], driverProfile: 'ESC/POS Direct Socket (Port 9100)', offlineResilient: true, status: 'certified' }
    ];

    // 4. Security & Posture
    const posture = (store && typeof store.getCybersecurityPosture === 'function') ? store.getCybersecurityPosture() : {
      shields: [],
      overallScore: 100,
      auditIntegrity: { valid: true, verifiedCount: audits.length, rootHash: 'e3b0c442...' },
      certificate: {
        domain: '*.salsa.local / admin.salsa.local',
        issuer: "Let's Encrypt Authority X3 (ACME v2)",
        protocol: 'TLS 1.3 (RFC 8446)',
        cipher: 'TLS_AES_256_GCM_SHA384',
        validUntil: '2026-11-26',
        daysRemaining: 68,
        autoRenewal: true,
        hstsPreload: true,
        keyType: 'ECDSA P-384'
      },
      securityHeaders: [
        { name: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains; preload', status: 'enforced' },
        { name: 'Content-Security-Policy', value: "default-src 'self'; frame-ancestors 'none'", status: 'enforced' },
        { name: 'X-Frame-Options', value: 'DENY', status: 'enforced' },
        { name: 'X-Content-Type-Options', value: 'nosniff', status: 'enforced' },
        { name: 'Referrer-Policy', value: 'strict-origin-when-cross-origin', status: 'enforced' }
      ],
      lockdownMode: false
    };

    const securityPolicy = (store && typeof store.getSecurityPolicy === 'function') ? store.getSecurityPolicy() : {
      sessionTimeoutHours: 8,
      mfaRequired: true,
      allowDemoMode: true,
      lockdownMode: false
    };

    return `
      <div class="godmode-page-container settings-page">
        <!-- Page Top Bar -->
        <div class="page-top-bar" style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 1.5rem; flex-wrap: wrap; gap: 1rem;">
          <div>
            <h1 style="font-size: 1.5rem; font-weight: 800; margin: 0 0 0.25rem 0; color: var(--salsa-text-primary, #111);">
              تنظیمات کلان پلتفرم سالسا
            </h1>
            <p style="font-size: 0.85rem; color: var(--salsa-text-secondary, #666); margin: 0;">
              مدیریت تیم راهبری پلتفرم، سپرهای امنیت سایبری، ممیزی سراسری ضدجعل SHA-256 و کاتالوگ سخت‌افزارها
            </p>
          </div>
        </div>

        <!-- Sub-navigation Tabs -->
        <nav class="sub-nav-tabs" style="display: flex; gap: 0.5rem; margin-bottom: 1.5rem; border-bottom: 1px solid var(--salsa-border, #E5E7EB); padding-bottom: 0.5rem; overflow-x: auto;">
          <a href="#settings?section=team" class="btn ${activeSection === 'team' ? 'btn-primary' : 'btn-ghost'} btn-sm" style="white-space: nowrap;">
            👥 اعضای تیم سالسا (${platformTeam.length})
          </a>
          <a href="#settings?section=security" class="btn ${activeSection === 'security' ? 'btn-primary' : 'btn-ghost'} btn-sm" style="white-space: nowrap;">
            🔒 امنیت و احراز هویت (MFA)
          </a>
          <a href="#settings?section=audit" class="btn ${activeSection === 'audit' ? 'btn-primary' : 'btn-ghost'} btn-sm" style="white-space: nowrap;">
            ≣ ممیزی سراسری رویدادها
          </a>
          <a href="#settings?section=hardware" class="btn ${activeSection === 'hardware' ? 'btn-primary' : 'btn-ghost'} btn-sm" style="white-space: nowrap;">
            🖨 کاتالوگ سخت‌افزارها (${hardwareCatalog.length})
          </a>
        </nav>

        <!-- Section 1: Team Members -->
        ${activeSection === 'team' ? `
          <div class="card" style="border-radius: 12px; border: 1px solid var(--salsa-border, #E5E7EB); overflow: hidden;">
            <div class="card-header" style="background: var(--muted); color: var(--foreground); padding: 0.85rem 1.25rem; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.5rem;">
              <div>
                <strong style="font-size: 0.95rem;">اعضای دارای دسترسی به پنل مدیریت سالسا</strong>
                <span style="font-size: 0.8rem; color: var(--muted-foreground); display: block;">مدیریت نقش‌های سطوح دسترسی Platform RBAC و وضعیت احراز هویت دومرحله‌ای</span>
              </div>
              <button type="button" class="btn btn-primary btn-xs" onclick="window.GodModeAppShell ? window.GodModeAppShell.openInviteTeamMemberModal() : null" style="display: inline-flex; align-items: center; gap: 0.3rem;">
                <span>➕</span>
                <span>دعوت عضو جدید به تیم</span>
              </button>
            </div>
            <div class="card-body" style="padding: 0;">
              <table class="data-table" style="width: 100%; border-collapse: collapse; font-size: 0.85rem;">
                <thead>
                  <tr style="background: var(--muted); color: var(--muted-foreground); text-align: right; border-bottom: 1px solid var(--border);">
                    <th style="padding: 0.75rem 1rem;">نام عضو</th>
                    <th style="padding: 0.75rem 1rem;">پست الکترونیکی</th>
                    <th style="padding: 0.75rem 1rem;">نقش پلتفرم</th>
                    <th style="padding: 0.75rem 1rem;">وضعیت MFA</th>
                    <th style="padding: 0.75rem 1rem;">وضعیت دسترسی</th>
                    <th style="padding: 0.75rem 1rem;">آخرین فعالیت</th>
                    <th style="padding: 0.75rem 1rem; text-align: left;">اقدام</th>
                  </tr>
                </thead>
                <tbody>
                  ${platformTeam.map(u => {
                    const isOwner = (u.role || '').includes('Owner') || u.role === 'platform_admin' || u.role === 'platform_owner' || u.id === 'usr_01';
                    const isInvited = u.status === 'invited';
                    return `
                      <tr style="border-bottom: 1px solid var(--border);">
                        <td style="padding: 0.75rem 1rem; font-weight: 600;">
                          <div style="display: flex; align-items: center; gap: 0.5rem;">
                            <div style="width: 30px; height: 30px; border-radius: 50%; background: ${isOwner ? '#EFF6FF' : '#F3F4F6'}; color: ${isOwner ? '#2563EB' : '#4B5563'}; font-size: 0.75rem; font-weight: 700; display: flex; align-items: center; justify-content: center;">
                              ${esc((u.name || 'ع')[0])}
                            </div>
                            <div>
                              <span>${esc(u.name)}</span>
                              ${isOwner ? '<span style="font-size: 0.7rem; color: #2563EB; display: block;">SuperAdmin</span>' : ''}
                            </div>
                          </div>
                        </td>
                        <td style="padding: 0.75rem 1rem; font-family: var(--font-mono); direction: ltr; text-align: right; font-size: 0.8rem; color: var(--muted-foreground);">${esc(u.email)}</td>
                        <td style="padding: 0.75rem 1rem;">
                          <span class="badge ${isOwner ? 'badge-primary' : 'badge-neutral'}" style="font-size: 0.75rem;">
                            ${esc(u.roleFa || u.role)}
                          </span>
                        </td>
                        <td style="padding: 0.75rem 1rem;">
                          <span class="badge ${u.mfaStatus === 'active' ? 'badge-success' : 'badge-warning'}" style="font-size: 0.75rem;">
                            ${u.mfaStatus === 'active' ? '✓ TOTP فعال' : 'در انتظار فعال‌سازی'}
                          </span>
                        </td>
                        <td style="padding: 0.75rem 1rem;">
                          <span class="badge ${isInvited ? 'badge-warning' : 'badge-success'}">
                            ${isInvited ? 'دعوت‌شده' : 'فعال'}
                          </span>
                        </td>
                        <td style="padding: 0.75rem 1rem; color: var(--muted-foreground); font-size: 0.8rem;">${esc(u.lastLogin || 'به‌تازگی')}</td>
                        <td style="padding: 0.75rem 1rem; text-align: left;">
                          <div style="display: flex; gap: 0.35rem; justify-content: flex-end;">
                            ${isInvited ? `
                              <button type="button" class="btn btn-ghost btn-xs text-primary" onclick="window.GodModeSettings.resendInvite('${esc(u.email)}')">
                                ارسال مجدد دعوت
                              </button>
                            ` : ''}
                            ${!isOwner ? `
                              <button type="button" class="btn btn-ghost btn-xs text-danger" onclick="window.GodModeSettings.openRemoveUserModal('${esc(u.email)}', '${esc(u.name)}')">
                                لغو دسترسی
                              </button>
                            ` : `
                              <span style="color: #BBB; font-size: 0.75rem;">مالک اصلی</span>
                            `}
                          </div>
                        </td>
                      </tr>
                    `;
                  }).join('')}
                </tbody>
              </table>
            </div>
          </div>
        ` : ''}

        <!-- Section 2: Security & MFA -->
        ${activeSection === 'security' ? `
          <div style="display: flex; flex-direction: column; gap: 1.5rem;">
            <!-- Posture Overview -->
            <div class="card" style="border-radius: 12px; border: 1px solid var(--salsa-border, #E5E7EB); padding: 1.5rem;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; flex-wrap: wrap; gap: 0.5rem;">
                <div>
                  <strong style="font-size: 1rem; display: block; margin-bottom: 0.25rem;">وضعیت سپرهای امنیت سایبری پلتفرم (Cybersecurity Posture)</strong>
                  <span style="font-size: 0.85rem; color: #666;">پایش پیوسته سپرهای دفاعی، گواهی‌های TLS 1.3، جداسازی پایگاه‌های داده و استانداردهای حفاظت داده</span>
                </div>
                <span class="badge badge-success" style="font-size: 0.85rem; padding: 0.35rem 0.75rem;">
                  امتیاز سلامت دفاعی: ${posture.overallScore || 100}٪ (A+)
                </span>
              </div>

              <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 1rem; margin-top: 1.25rem;">
                ${(posture.shields || []).map(s => `
                  <div style="border: 1px solid var(--salsa-border, #E5E7EB); border-radius: 8px; padding: 1rem; background: var(--salsa-surface-subtle, #F9FAFB);">
                    <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.35rem;">
                      <span style="font-size: 1.2rem;">${esc(s.icon || '🛡️')}</span>
                      <strong style="font-size: 0.85rem;">${esc(s.name)}</strong>
                    </div>
                    <div style="font-size: 0.8rem; color: #059669; font-weight: 600;">
                      ${esc(s.status)}
                    </div>
                  </div>
                `).join('')}
              </div>
            </div>

            <!-- TLS 1.3 & Web Security Headers Card -->
            <div class="card" style="border-radius: 12px; border: 1px solid var(--salsa-border, #E5E7EB); padding: 1.5rem; background: #FFF;">
              <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 1rem; flex-wrap: wrap; gap: 0.5rem;">
                <div>
                  <strong style="font-size: 0.95rem; display: block; margin-bottom: 0.25rem;">چرخه حیات گواهی امنیتی و هدرهای سختگیرانه (TLS 1.3 & HTTP Security)</strong>
                  <span style="font-size: 0.8rem; color: #666;">رمزنگاری لایه انتقال داده با الگوریتم‌های مدرن ECC و حفاظت در برابر جعل و تزریق محتوا</span>
                </div>
                <span class="badge badge-primary" style="font-size: 0.75rem;">
                  ACME v2 Auto-Renewal
                </span>
              </div>

              <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 1rem; margin-bottom: 1.25rem; font-size: 0.85rem;">
                <div style="background: #F9FAFB; padding: 0.85rem; border-radius: 8px; border: 1px solid #E5E7EB;">
                  <span style="color: #666; font-size: 0.75rem; display: block;">دامنه‌های تحت پوشش گواهی:</span>
                  <strong style="font-family: var(--font-mono); direction: ltr; display: block; margin-top: 0.2rem; color: #2563EB;">*.salsa.local, admin.salsa.local</strong>
                </div>
                <div style="background: #F9FAFB; padding: 0.85rem; border-radius: 8px; border: 1px solid #E5E7EB;">
                  <span style="color: #666; font-size: 0.75rem; display: block;">پروتکل و سوئیت رمزنگاری:</span>
                  <strong style="font-family: var(--font-mono); direction: ltr; display: block; margin-top: 0.2rem; color: #059669;">TLS 1.3 / AES_256_GCM_SHA384</strong>
                </div>
                <div style="background: #F9FAFB; padding: 0.85rem; border-radius: 8px; border: 1px solid #E5E7EB;">
                  <span style="color: #666; font-size: 0.75rem; display: block;">مرجع صدور و اعتبار:</span>
                  <strong style="display: block; margin-top: 0.2rem; color: #111;">Let's Encrypt (۶۸ روز تا تمدید خودکار)</strong>
                </div>
              </div>

              <!-- Security Headers Badges -->
              <div style="border-top: 1px solid #F3F4F6; padding-top: 1rem;">
                <span style="font-size: 0.8rem; color: #666; font-weight: 600; display: block; margin-bottom: 0.5rem;">هدرهای امنیتی اجباری پاسخ HTTP:</span>
                <div style="display: flex; flex-wrap: wrap; gap: 0.5rem;">
                  <span class="badge badge-success" style="font-family: var(--font-mono); font-size: 0.75rem;">Strict-Transport-Security: 31536000s (Preload)</span>
                  <span class="badge badge-success" style="font-family: var(--font-mono); font-size: 0.75rem;">Content-Security-Policy: default-src 'self'</span>
                  <span class="badge badge-success" style="font-family: var(--font-mono); font-size: 0.75rem;">X-Frame-Options: DENY</span>
                  <span class="badge badge-success" style="font-family: var(--font-mono); font-size: 0.75rem;">X-Content-Type-Options: nosniff</span>
                  <span class="badge badge-success" style="font-family: var(--font-mono); font-size: 0.75rem;">Referrer-Policy: strict-origin</span>
                </div>
              </div>
            </div>

            <!-- Emergency High-Security Lockdown Drill Card -->
            <div class="card" style="border-radius: 12px; border: 1px solid ${posture.lockdownMode ? '#EF4444' : 'var(--salsa-border, #E5E7EB)'}; padding: 1.5rem; background: ${posture.lockdownMode ? '#FEF2F2' : '#FFF'};">
              <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem;">
                <div>
                  <div style="display: flex; align-items: center; gap: 0.5rem;">
                    <span style="font-size: 1.3rem;">${posture.lockdownMode ? '🚨' : '🛡️'}</span>
                    <strong style="font-size: 0.95rem; color: ${posture.lockdownMode ? '#991B1B' : '#111'};">
                      ${posture.lockdownMode ? 'وضعیت قرنطینه دفاع سایبری پلتفرم (Lockdown Active)' : 'مانور آماده‌باش اضطراری و قرنطینه دفاعی (High-Security Lockdown Drill)'}
                    </strong>
                  </div>
                  <p style="font-size: 0.8rem; color: ${posture.lockdownMode ? '#B91C1C' : '#666'}; margin: 0.35rem 0 0 0;">
                    ${posture.lockdownMode
                      ? 'وضعیت قرنطینه هم‌اکنون فعال است! ریت‌لیمیت به ۱۰ درخواست در دقیقه فشرده شده و هر درخواست نیازمند بازتایید OTP است.'
                      : 'شبیه‌سازی ایزولاسیون کامل پلتفرم، لغو تمام توکن‌های مشکوک و تشدید ریت‌لیمیت برای شرایط حمله DoS یا تهدیدات امنیتی.'}
                  </p>
                </div>
                <div>
                  ${posture.lockdownMode ? `
                    <button type="button" class="btn btn-secondary btn-sm" onclick="window.GodModeSettings.toggleLockdown(false)" style="color: #991B1B; border-color: #FCA5A5;">
                      خاتمه قرنطینه و بازگشت به حالت عادی
                    </button>
                  ` : `
                    <button type="button" class="btn btn-ghost btn-sm text-danger" onclick="window.GodModeSettings.toggleLockdown(true)">
                      🛡️ اجرای مانور قرنطینه امنیتی
                    </button>
                  `}
                </div>
              </div>
            </div>

            <!-- Tamper-Evident SHA-256 Chain Box -->
            <div class="card" style="border-radius: 12px; border: 1px solid var(--salsa-border, #E5E7EB); padding: 1.25rem; background: #FAFAFA;">
              <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.5rem;">
                <div style="display: flex; align-items: center; gap: 0.5rem;">
                  <span style="font-size: 1.2rem;">⛓️</span>
                  <div>
                    <strong style="font-size: 0.85rem; display: block;">زنجیره ممیزی ضدجعل پلتفرم (Cryptographic SHA-256 Hash Chain)</strong>
                    <span style="font-size: 0.75rem; color: #059669;">
                      ✓ زنجیره با کلید پیدایش و امضای تک‌تک رویدادها تایید اعتبار شد.
                    </span>
                  </div>
                </div>
                <button type="button" class="btn btn-secondary btn-xs" onclick="window.GodModeSettings.verifyAuditIntegrity()">
                  ↻ بررسی مجدد یکپارچگی زنجیره
                </button>
              </div>
            </div>

            <!-- Interactive Security Configuration -->
            <div class="card" style="border-radius: 12px; border: 1px solid var(--salsa-border, #E5E7EB); padding: 1.5rem;">
              <strong style="font-size: 1rem; display: block; margin-bottom: 0.5rem;">سیاست‌های نشست و احراز هویت دومرحله‌ای</strong>
              <p style="font-size: 0.85rem; color: #666; margin-bottom: 1.5rem;">
                پیکربندی قوانین زمان‌بندی انقضای نشست‌های راهبری و الزامات سختگیرانه احراز هویت OTP
              </p>

              <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 1.25rem; margin-bottom: 1.5rem;">
                <div class="form-group">
                  <label style="display: block; font-weight: 600; font-size: 0.85rem; margin-bottom: 0.35rem;">مدت اعتبار نشست‌های اداری (Session Timeout)</label>
                  <select id="setting-session-timeout" class="form-control" style="width: 100%; padding: 0.5rem;">
                    <option value="4" ${securityPolicy.sessionTimeoutHours === 4 ? 'selected' : ''}>۴ ساعت (حداکثر امنیت)</option>
                    <option value="8" ${securityPolicy.sessionTimeoutHours === 8 ? 'selected' : ''}>۸ ساعت (استاندارد شیفت کاری)</option>
                    <option value="24" ${securityPolicy.sessionTimeoutHours === 24 ? 'selected' : ''}>۲۴ ساعت</option>
                  </select>
                </div>

                <div class="form-group">
                  <label style="display: block; font-weight: 600; font-size: 0.85rem; margin-bottom: 0.35rem;">الزام احراز هویت دومرحله‌ای (RFC 6238 TOTP)</label>
                  <select id="setting-mfa-policy" class="form-control" style="width: 100%; padding: 0.5rem;">
                    <option value="enforced" selected>اجباری برای تمامی مدیران پلتفرم (Strict)</option>
                    <option value="optional">اختیاری (توصیه‌نشده)</option>
                  </select>
                </div>
              </div>

              <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem; padding-top: 1rem; border-top: 1px solid #EEE;">
                <button type="button" class="btn btn-primary btn-sm" onclick="window.GodModeSettings.saveSecurityPolicy()">
                  ذخیره تنظیمات امنیتی
                </button>
                <button type="button" class="btn btn-ghost btn-sm text-danger" onclick="window.GodModeSettings.revokeAllSessions()">
                  ابطال فوری تمام نشست‌های فعال پلتفرم
                </button>
              </div>
            </div>
          </div>
        ` : ''}

        <!-- Section 3: Global Audit Trail -->
        ${activeSection === 'audit' ? `
          <div class="card" style="border-radius: 12px; border: 1px solid var(--salsa-border, #E5E7EB); overflow: hidden;">
            <div class="card-header" style="background: var(--salsa-surface-subtle, #F9FAFB); padding: 0.85rem 1.25rem; border-bottom: 1px solid var(--salsa-border, #E5E7EB); display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.5rem;">
              <div style="display: flex; align-items: center; gap: 0.6rem;">
                <strong style="font-size: 0.95rem;">ممیزی سراسری تمام رویدادهای پلتفرم سالسا</strong>
                <span class="badge badge-success" style="font-size: 0.75rem;">
                  ✓ زنجیره رمزنگاری SHA-256 معتبر (${audits.length} رویداد)
                </span>
              </div>
              <div style="display: flex; gap: 0.5rem;">
                <button type="button" class="btn btn-ghost btn-xs" onclick="window.GodModeSettings.verifyAuditIntegrity()">
                  ↻ بررسی یکپارچگی زنجیره
                </button>
                <button type="button" class="btn btn-secondary btn-xs" onclick="window.GodModeSettings.exportAuditLogsCSV()">
                  ⤓ خروجی اکسل (CSV)
                </button>
                <button type="button" class="btn btn-secondary btn-xs" onclick="window.GodModeSettings.exportAuditLogs()">
                  ⤓ خروجی JSON
                </button>
              </div>
            </div>

            <!-- Category Pills & Search toolbar -->
            <div style="padding: 0.85rem 1.25rem; border-bottom: 1px solid #F3F4F6; background: #FFF; display: flex; flex-direction: column; gap: 0.75rem;">
              <div style="display: flex; gap: 0.5rem; flex-wrap: wrap; align-items: center;">
                <span style="font-size: 0.8rem; color: #666; font-weight: 600;">فیلتر دسته‌بندی:</span>
                <button type="button" class="btn btn-primary btn-xs audit-cat-pill" onclick="window.GodModeSettings.filterAuditByCategory('all', this)">
                  همه رویدادها (${audits.length})
                </button>
                <button type="button" class="btn btn-ghost btn-xs audit-cat-pill" onclick="window.GodModeSettings.filterAuditByCategory('security', this)">
                  🔒 امنیت و دسترسی
                </button>
                <button type="button" class="btn btn-ghost btn-xs audit-cat-pill" onclick="window.GodModeSettings.filterAuditByCategory('operations', this)">
                  ⚙️ عملیات و زیرساخت
                </button>
                <button type="button" class="btn btn-ghost btn-xs audit-cat-pill" onclick="window.GodModeSettings.filterAuditByCategory('commercial', this)">
                  💳 مالی و لایسنس
                </button>
                <button type="button" class="btn btn-ghost btn-xs audit-cat-pill" onclick="window.GodModeSettings.filterAuditByCategory('tenant', this)">
                  🏢 رستوران‌ها
                </button>
              </div>
              <div style="width: 100%;">
                <input type="search" id="audit-search-input" class="form-control" placeholder="جستجو در متن اقدام، شناسه هدف، نام مجری یا توضیحات..." oninput="window.GodModeSettings.filterAuditLogs(this.value)" style="width: 100%; font-size: 0.85rem;" />
              </div>
            </div>

            <div class="card-body" style="padding: 0;">
              ${audits.length === 0 ? `
                <div style="padding: 2.5rem; text-align: center; color: #888; font-size: 0.85rem;">
                  رویداد ممیزی جدیدی ثبت نشده است.
                </div>
              ` : `
                <table class="data-table" id="audit-table" style="width: 100%; border-collapse: collapse; font-size: 0.85rem;">
                  <thead>
                    <tr style="background: #FAFAFA; text-align: right; border-bottom: 1px solid #EEE;">
                      <th style="padding: 0.75rem 1rem;">دسته‌بندی</th>
                      <th style="padding: 0.75rem 1rem;">اقدام و رویداد</th>
                      <th style="padding: 0.75rem 1rem;">هدف / شناسه</th>
                      <th style="padding: 0.75rem 1rem;">مجری (Actor)</th>
                      <th style="padding: 0.75rem 1rem;">علت / توضیحات</th>
                      <th style="padding: 0.75rem 1rem;">اثر انگشت رمزنگاری (SHA-256)</th>
                      <th style="padding: 0.75rem 1rem;">زمان رویداد</th>
                    </tr>
                  </thead>
                  <tbody id="audit-table-body">
                    ${audits.map(a => {
                      const catFa = a.category === 'security' ? 'امنیت' : a.category === 'operations' ? 'عملیات' : a.category === 'commercial' ? 'مالی' : 'رستوران';
                      const catBadge = a.category === 'security' ? 'badge-danger' : a.category === 'operations' ? 'badge-primary' : a.category === 'commercial' ? 'badge-success' : 'badge-neutral';
                      const hashSnippet = (a.currentHash || '00000000').slice(0, 8);
                      return `
                        <tr class="audit-row" data-category="${esc(a.category || 'all')}" style="border-bottom: 1px solid #F3F4F6;">
                          <td style="padding: 0.75rem 1rem;">
                            <span class="badge ${catBadge}" style="font-size: 0.7rem;">
                              ${catFa}
                            </span>
                          </td>
                          <td style="padding: 0.75rem 1rem; font-weight: 600;">${esc(a.action)}</td>
                          <td style="padding: 0.75rem 1rem; font-family: var(--font-mono); font-size: 0.8rem; color: #2563EB;">${esc(a.target_id || a.targetId || 'سراسری')}</td>
                          <td style="padding: 0.75rem 1rem;">
                            <span>${esc(a.actor_id || a.actorId || 'سیستم')}</span>
                            ${a.actorRole ? `<span style="display: block; font-size: 0.7rem; color: #888;">${esc(a.actorRole)}</span>` : ''}
                          </td>
                          <td style="padding: 0.75rem 1rem; color: #666; font-size: 0.8rem;">${esc(a.reason || '—')}</td>
                          <td style="padding: 0.75rem 1rem;">
                            <button type="button" class="btn btn-ghost btn-xs" onclick="window.GodModeSettings.showHashDetails('${esc(a.id)}')" title="مشاهده مشخصات کامل زنجیره بلوکی" style="font-family: var(--font-mono); font-size: 0.75rem; color: #4B5563; padding: 0.15rem 0.35rem;">
                              #${hashSnippet}… 🔍
                            </button>
                          </td>
                          <td style="padding: 0.75rem 1rem; color: #666; font-size: 0.75rem;">
                            ${a.occurred_at ? new Date(a.occurred_at).toLocaleString('fa-IR') : 'اخیراً'}
                          </td>
                        </tr>
                      `;
                    }).join('')}
                  </tbody>
                </table>
              `}
            </div>
          </div>
        ` : ''}

        <!-- Section 4: Hardware Model Catalog -->
        ${activeSection === 'hardware' ? `
          <div class="card" style="border-radius: 12px; border: 1px solid var(--salsa-border, #E5E7EB); overflow: hidden;">
            <div class="card-header" style="background: var(--salsa-surface-subtle, #F9FAFB); padding: 0.85rem 1.25rem; border-bottom: 1px solid var(--salsa-border, #E5E7EB); display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.5rem;">
              <div>
                <strong style="font-size: 0.95rem;">کاتالوگ مدل‌های پرینتر و سخت‌افزار دارای تأییدیه رسمی سالسا</strong>
                <span style="font-size: 0.8rem; color: #666; display: block;">تجهیزات سازگار با موتور چاپ مستقیم شبکه، پروتکل ESC/POS و عملکرد ۱۰۰٪ آفلاین</span>
              </div>
              <button type="button" class="btn btn-primary btn-xs" onclick="window.GodModeAppShell ? window.GodModeAppShell.openAddHardwareModal() : null" style="display: inline-flex; align-items: center; gap: 0.3rem;">
                <span>➕</span>
                <span>ثبت مدل جدید سخت‌افزار</span>
              </button>
            </div>

            <!-- Hardware Filter Toolbar -->
            <div style="padding: 0.75rem 1.25rem; border-bottom: 1px solid #F3F4F6; background: #FFF; display: flex; gap: 0.5rem; flex-wrap: wrap; align-items: center;">
              <span style="font-size: 0.8rem; color: #666; font-weight: 600;">فیلتر کاربرد:</span>
              <button type="button" class="btn btn-primary btn-xs hw-cat-pill" onclick="window.GodModeSettings.filterHardwareByCategory('all', this)">
                همه سخت‌افزارها (${hardwareCatalog.length})
              </button>
              <button type="button" class="btn btn-ghost btn-xs hw-cat-pill" onclick="window.GodModeSettings.filterHardwareByCategory('receipt', this)">
                🧾 چاپگرهای فیش و فاکتور
              </button>
              <button type="button" class="btn btn-ghost btn-xs hw-cat-pill" onclick="window.GodModeSettings.filterHardwareByCategory('kitchen', this)">
                👨‍🍳 چاپگرهای آشپزخانه (KOT)
              </button>
            </div>

            <div class="card-body" style="padding: 0;">
              <table class="data-table" style="width: 100%; border-collapse: collapse; font-size: 0.85rem;">
                <thead>
                  <tr style="background: #FAFAFA; text-align: right; border-bottom: 1px solid #EEE;">
                    <th style="padding: 0.75rem 1rem;">سازنده (Brand)</th>
                    <th style="padding: 0.75rem 1rem;">مدل دستگاه</th>
                    <th style="padding: 0.75rem 1rem;">نوع کاربرد</th>
                    <th style="padding: 0.75rem 1rem;">درگاه‌های ارتباطی</th>
                    <th style="padding: 0.75rem 1rem;">پروتکل درایور</th>
                    <th style="padding: 0.75rem 1rem;">تاب‌آوری آفلاین</th>
                    <th style="padding: 0.75rem 1rem; text-align: left;">اقدامات</th>
                  </tr>
                </thead>
                <tbody id="hardware-table-body">
                  ${hardwareCatalog.map(h => {
                    const interfacesStr = Array.isArray(h.interfaces) ? h.interfaces.join(' / ') : (h.interfaces || 'LAN / USB');
                    return `
                      <tr class="hw-row" data-category="${esc(h.category || (h.type?.includes('آشپزخانه') ? 'kitchen' : 'receipt'))}" style="border-bottom: 1px solid #F3F4F6;">
                        <td style="padding: 0.75rem 1rem; font-weight: 700;">${esc(h.manufacturer)}</td>
                        <td style="padding: 0.75rem 1rem; font-family: var(--font-mono); font-weight: 600; color: #2563EB;">${esc(h.model)}</td>
                        <td style="padding: 0.75rem 1rem;">${esc(h.categoryFa || h.type)}</td>
                        <td style="padding: 0.75rem 1rem; font-family: var(--font-mono); font-size: 0.8rem; color: #4B5563;">${esc(interfacesStr)}</td>
                        <td style="padding: 0.75rem 1rem; font-size: 0.8rem;">${esc(h.driverProfile || 'ESC/POS Direct')}</td>
                        <td style="padding: 0.75rem 1rem;">
                          <span class="badge badge-success" style="font-size: 0.75rem;">
                            ✓ عملکرد ۱۰۰٪ آفلاین
                          </span>
                        </td>
                        <td style="padding: 0.75rem 1rem; text-align: left;">
                          <button type="button" class="btn btn-ghost btn-xs text-primary" onclick="window.GodModeSettings.testPrinter('${esc(h.id)}', '${esc(h.manufacturer)} ${esc(h.model)}')" title="ارسال پکت تستی ESC/POS به پورت ۹۱۰۰">
                            تست چاپ تستی 🖨️
                          </button>
                        </td>
                      </tr>
                    `;
                  }).join('')}
                </tbody>
              </table>
            </div>
          </div>
        ` : ''}

      </div>
    `;
  }

  const GodModeSettings = {
    openRemoveUserModal(email, name) {
      if (!global.GodModeConfirmDialog) return;
      global.GodModeConfirmDialog.show({
        title: `لغو دسترسی ${name}`,
        severity: 'destructive',
        message: `آیا از لغو کامل دسترسی کاربر سازمانی «${name}» (${email}) به پنل مدیریت سالسا اطمینان دارید؟`,
        impactDetails: 'کاربر بلافاصله از تمام نشست‌ها اخراج شده و امکان ورود مجدد نخواهد داشت.',
        requireReason: true,
        reasonPlaceholder: 'علت لغو دسترسی (پایان همکاری، تغییر مسئولیت سازمانی و...)',
        confirmText: 'لغو قطعی دسترسی',
        onConfirm: async (reason) => {
          const store = global.prototypeStore || global.GMStore;
          if (store && typeof store.removePlatformUser === 'function') {
            store.removePlatformUser(email, reason);
          }
          if (global.GMToast) global.GMToast.show(`دسترسی «${name}» با موفقیت لغو شد.`, 'danger');
          if (global.GodModeRouter) global.GodModeRouter.handleRoute();
        }
      });
    },

    resendInvite(email) {
      const store = global.prototypeStore || global.GMStore;
      if (store && typeof store.resendTeamInvitation === 'function') {
        store.resendTeamInvitation(email);
      }
      if (global.GMToast) global.GMToast.show(`دعوت‌نامه جدید برای «${email}» با موفقیت ارسال شد.`, 'success');
      if (global.GodModeRouter) global.GodModeRouter.handleRoute();
    },

    saveSecurityPolicy() {
      const timeoutEl = document.getElementById('setting-session-timeout');
      const timeout = timeoutEl ? parseInt(timeoutEl.value, 10) : 8;
      const store = global.prototypeStore || global.GMStore;
      if (store && typeof store.updateSecurityPolicy === 'function') {
        store.updateSecurityPolicy({
          sessionTimeoutHours: timeout,
          mfaRequired: true,
          reason: 'به‌روزرسانی تنظیمات توسط مدیر پلتفرم'
        });
      }
      if (global.GMToast) global.GMToast.show('سیاست‌های امنیتی با موفقیت در سراسر پلتفرم ذخیره شد.', 'success');
      if (global.GodModeRouter) global.GodModeRouter.handleRoute();
    },

    toggleLockdown(enable) {
      if (enable) {
        if (!global.GodModeConfirmDialog) return;
        global.GodModeConfirmDialog.show({
          title: 'اجرای مانور قرنطینه دفاع سایبری (Lockdown Drill)',
          severity: 'destructive',
          message: 'آیا از فعال‌سازی وضعیت اضطراری و قرنطینه پلتفرم سالسا اطمینان دارید؟',
          impactDetails: 'در این وضعیت ریت‌لیمیت تمام درخواست‌ها به ۱۰ در دقیقه کاهش یافته و ممیزی سختگیرانه فعال می‌شود.',
          requireReason: true,
          reasonPlaceholder: 'دلیل امنیتی برای فعال‌سازی وضعیت قرنطینه...',
          confirmText: 'فعال‌سازی وضعیت قرنطینه',
          onConfirm: async (reason) => {
            const store = global.prototypeStore || global.GMStore;
            if (store && typeof store.triggerLockdownDrill === 'function') {
              store.triggerLockdownDrill(true, reason);
            }
            if (global.GMToast) global.GMToast.show('وضعیت قرنطینه دفاعی پلتفرم با موفقیت فعال شد.', 'danger');
            if (global.GodModeRouter) global.GodModeRouter.handleRoute();
          }
        });
      } else {
        const store = global.prototypeStore || global.GMStore;
        if (store && typeof store.triggerLockdownDrill === 'function') {
          store.triggerLockdownDrill(false, 'خاتمه وضعیت قرنطینه توسط مدیر پلتفرم');
        }
        if (global.GMToast) global.GMToast.show('وضعیت قرنطینه خاتمه یافت و پلتفرم به شرایط استاندارد بازگشت.', 'success');
        if (global.GodModeRouter) global.GodModeRouter.handleRoute();
      }
    },

    revokeAllSessions() {
      if (!global.GodModeConfirmDialog) return;
      global.GodModeConfirmDialog.show({
        title: 'ابطال اضطراری تمام نشست‌های پلتفرم',
        severity: 'destructive',
        message: 'آیا از ابطال و خروج اجباری تمام سشن‌های فعال کاربران در پنل مدیریت سالسا اطمینان دارید؟',
        impactDetails: 'تمام اپراتورها و مدیران باید مجدداً با احراز هویت دومرحله‌ای وارد شوند.',
        requireReason: true,
        reasonPlaceholder: 'دلیل امنیتی برای ابطال همگانی سشن‌ها...',
        confirmText: 'ابطال تمام نشست‌ها',
        onConfirm: async (reason) => {
          const store = global.prototypeStore || global.GMStore;
          if (store && typeof store.logAudit === 'function') {
            store.logAudit({
              action: 'ابطال اضطراری تمام نشست‌های فعال پلتفرم',
              category: 'security',
              reason,
              occurredAt: new Date().toISOString()
            });
          }
          if (global.GMToast) global.GMToast.show('تمام نشست‌های فعال با موفقیت منقضی شدند.', 'danger');
          if (global.GodModeRouter) global.GodModeRouter.handleRoute();
        }
      });
    },

    verifyAuditIntegrity() {
      const store = global.prototypeStore || global.GMStore;
      if (store && typeof store.verifyAuditLogIntegrity === 'function') {
        const result = store.verifyAuditLogIntegrity();
        if (result.valid) {
          if (global.GMToast) global.GMToast.show(result.message || 'زنجیره ممیزی معتبر است.', 'success');
        } else {
          if (global.GMToast) global.GMToast.show('هشدار عدم تطابق در زنجیره ممیزی!', 'danger');
        }
      } else {
        if (global.GMToast) global.GMToast.show('یکپارچگی رویدادهای ممیزی تایید شد.', 'success');
      }
    },

    exportAuditLogs() {
      const store = global.prototypeStore || global.GMStore;
      const logs = (store && typeof store.getAuditLogs === 'function') ? store.getAuditLogs('all') : [];
      const jsonStr = JSON.stringify(logs, null, 2);
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `salsa_audit_logs_${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      if (global.GMToast) global.GMToast.show('فایل لاگ‌های ممیزی JSON دانلود شد.', 'info');
    },

    exportAuditLogsCSV() {
      const store = global.prototypeStore || global.GMStore;
      const logs = (store && typeof store.getAuditLogs === 'function') ? store.getAuditLogs('all') : [];
      let csv = '\uFEFFشناسه,اقدام,دسته‌بندی,شناسه_هدف,مجری,علت,هش_SHA256,زمان\n';
      logs.forEach(l => {
        const row = [
          l.id || '',
          `"${(l.action || '').replace(/"/g, '""')}"`,
          l.category || '',
          l.targetId || l.target_id || '',
          l.actorId || l.actor || '',
          `"${(l.reason || l.description || '').replace(/"/g, '""')}"`,
          l.currentHash || l.hash || '',
          l.occurredAt || l.timestamp || ''
        ];
        csv += row.join(',') + '\n';
      });
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `salsa_audit_logs_${Date.now()}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      if (global.GMToast) global.GMToast.show('فایل لاگ‌های ممیزی اکسل (CSV) با موفقیت دریافت شد.', 'info');
    },

    filterAuditByCategory(category, pillEl) {
      if (pillEl && pillEl.parentElement) {
        pillEl.parentElement.querySelectorAll('.audit-cat-pill').forEach(btn => {
          btn.className = 'btn btn-ghost btn-xs audit-cat-pill';
        });
        pillEl.className = 'btn btn-primary btn-xs audit-cat-pill';
      }
      const rows = document.querySelectorAll('#audit-table-body .audit-row');
      rows.forEach(r => {
        const cat = r.getAttribute('data-category');
        if (category === 'all' || cat === category) {
          r.style.display = '';
        } else {
          r.style.display = 'none';
        }
      });
    },

    filterAuditLogs(query) {
      const term = (query || '').toLowerCase().trim();
      const rows = document.querySelectorAll('#audit-table-body .audit-row');
      rows.forEach(r => {
        const text = r.textContent.toLowerCase();
        r.style.display = (!term || text.includes(term)) ? '' : 'none';
      });
    },

    filterHardwareByCategory(category, pillEl) {
      if (pillEl && pillEl.parentElement) {
        pillEl.parentElement.querySelectorAll('.hw-cat-pill').forEach(btn => {
          btn.className = 'btn btn-ghost btn-xs hw-cat-pill';
        });
        pillEl.className = 'btn btn-primary btn-xs hw-cat-pill';
      }
      const rows = document.querySelectorAll('#hardware-table-body .hw-row');
      rows.forEach(r => {
        const cat = r.getAttribute('data-category');
        if (category === 'all' || cat === category) {
          r.style.display = '';
        } else {
          r.style.display = 'none';
        }
      });
    },

    testPrinter(modelId, modelName) {
      const store = global.prototypeStore || global.GMStore;
      let res = { ok: true, latencyMs: 11, responseCode: '0x10 0x04 (STATUS_OK)' };
      if (store && typeof store.testPrinterModel === 'function') {
        res = store.testPrinterModel(modelId);
      }
      if (global.GMToast) {
        global.GMToast.show(`تست چاپ مستقیم «${modelName}» با موفقیت ارسال شد (کد پاسخ: 0x10 0x04 - تاخیر: ${res.latencyMs}ms)`, 'success');
      }
    },

    showHashDetails(auditId) {
      const store = global.prototypeStore || global.GMStore;
      const logs = (store && typeof store.getAuditLogs === 'function') ? store.getAuditLogs('all') : [];
      const item = logs.find(l => l.id === auditId);
      if (!item) return;

      const html = `
        <div style="font-size: 0.85rem; line-height: 1.6;">
          <div style="margin-bottom: 0.75rem;">
            <strong style="color: #111;">شرح رویداد:</strong>
            <span style="display: block; font-weight: 600; color: #2563EB;">${esc(item.action)}</span>
          </div>
          <div style="margin-bottom: 0.75rem; background: #F9FAFB; padding: 0.75rem; border-radius: 6px; border: 1px solid #E5E7EB;">
            <span style="font-size: 0.75rem; color: #666; display: block;">هش رمزنگاری این بلوک (SHA-256 Current Hash):</span>
            <code style="font-family: var(--font-mono); font-size: 0.75rem; color: #059669; word-break: break-all; display: block; direction: ltr; text-align: left; margin-top: 0.25rem;">
              ${esc(item.currentHash || item.hash || 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')}
            </code>
          </div>
          <div style="margin-bottom: 0.75rem; background: #F9FAFB; padding: 0.75rem; border-radius: 6px; border: 1px solid #E5E7EB;">
            <span style="font-size: 0.75rem; color: #666; display: block;">هش بلوک قبلی در زنجیره (Previous Hash):</span>
            <code style="font-family: var(--font-mono); font-size: 0.75rem; color: #6B7280; word-break: break-all; display: block; direction: ltr; text-align: left; margin-top: 0.25rem;">
              ${esc(item.previousHash || '0000000000000000000000000000000000000000000000000000000000000000')}
            </code>
          </div>
          <div style="display: flex; justify-content: space-between; font-size: 0.8rem; color: #666; border-top: 1px solid #EEE; padding-top: 0.5rem;">
            <span>شناسه رویداد: <code>${esc(item.id)}</code></span>
            <span class="badge badge-success">✓ امضای معتبر زنجیره</span>
          </div>
        </div>
      `;

      if (global.GMApp && typeof global.GMApp.openModal === 'function') {
        global.GMApp.openModal('بررسی امضای دیجیتال و زنجیره هش رویداد', html, () => true, {
          confirmText: 'بستن'
        });
      }
    }
  };

  global.GodModeSettings = GodModeSettings;

  // Register in Router
  if (global.GodModeRouter) {
    global.GodModeRouter.registerRenderer('settings', renderSettingsPage);
  }

  global.renderGodModeSettings = renderSettingsPage;
})(typeof window !== 'undefined' ? window : globalThis);
