/**
 * prototype/js/views/gm24-infrastructure.js
 * 
 * GM-24: پایش سرور اختصاصی و زیرساخت متمرکز VPS (/infrastructure)
 * مرکز مانیتورینگ گرافیکی، بصری و ساختارمند پلتفرم سالسا و سرور وستو
 * پایش زنده پورت‌ها (۳۰۵۰، ۳۰۶۱، ۴۱۸۰، ۵۴۳۳)، دیتابیس متمرکز PostgreSQL 16 و منابع سخت‌افزاری
 */

window.renderGM24 = function() {
  const store = window.prototypeStore || window.GMStore;
  const cells = store && store.getInfrastructureCells ? store.getInfrastructureCells() : [];
  const infrastructureSource = cells.length ? 'مرکز مدیریت زیرساخت عملیاتی WESTO VPS' : 'بدون سرور قابل مشاهده';
  const activeTab = window._activeGM24Tab || 'visual';

  setTimeout(() => {
    if (window.GMViews && window.GMViews.GM24) {
      window.GMViews.GM24.init();
    }
  }, 50);

  return `
    <div class="page-header gm24-page">
      <div class="page-title-group">
        <nav class="breadcrumb-nav" aria-label="مسیر راهبری">
          <a href="#gm-02-overview" class="breadcrumb-link">پیشخوان</a>
          <span class="breadcrumb-separator">/</span>
          <span class="breadcrumb-current" aria-current="page">مانیتورینگ گرافیکی سرور و پورت‌ها</span>
        </nav>
        <div style="display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap;">
          <h1 style="margin: 0; font-size: 1.35rem; font-weight: 800; color: var(--text-primary);">
            پایش سرور و زیرساخت اختصاصی VPS
          </h1>
          <span class="badge badge-scope-global"><span class="status-dot dot-purple"></span> کلان پلتفرم</span>
          <span class="page-code-badge">GM-24</span>
          <span class="badge badge-success" style="display: inline-flex; align-items: center; gap: 0.35rem; padding: 0.25rem 0.65rem;">
            <span class="status-dot dot-green" style="animation: pulse-ring 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;"></span>
            <span>۱۰۰٪ پایدار و عملیاتی</span>
          </span>
        </div>
        <p style="margin-top: 0.35rem; color: var(--text-secondary); font-size: 0.813rem;">
          داشبورد بصری، مانیتورینگ زنده سرویس‌ها، بار پردازشی سرور متمرکز VPS و ابزارهای نگهداری تک‌کلیک
        </p>
      </div>
      <div class="header-actions" style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
        <button class="btn btn-primary btn-sm" onclick="window.GMViews.GM24.runLivePing()" style="display: inline-flex; align-items: center; gap: 0.4rem;">
          <span aria-hidden="true">🩺</span>
          <span>تست پینگ و سلامت لحظه‌ای</span>
        </button>
        <button class="btn btn-secondary btn-sm" onclick="window.GMViews.GM24.copyHealthReport()" style="display: inline-flex; align-items: center; gap: 0.4rem;">
          <span aria-hidden="true">📋</span>
          <span>کپی گزارش وضعیت</span>
        </button>
        <button class="btn btn-secondary btn-sm" onclick="window.GMDataState ? window.GMDataState.refreshView('GM24') : (window.GMApp ? window.GMApp.showToast('پایش سلامت سرورها بازخوانی شد', 'info') : null)">
          <span aria-hidden="true">🔄</span>
          <span>تازه‌سازی</span>
        </button>
      </div>
    </div>

    ${window.GMDataState ? window.GMDataState.renderFreshnessBar({
      viewId: 'GM24',
      sourceLabel: 'سرویس‌های هاست VPS، وب‌سرور Nginx و کارگزار پایگاه داده',
      sourceMode: 'local',
      totalCount: cells.length,
      countLabel: 'محیط سرور'
    }) : ''}

    ${(() => {
      const dataState = window.GMDataState ? window.GMDataState.getViewState('GM24') : { state: 'live' };
      if (dataState.state === 'failed' || dataState.state === 'error') {
        return window.GMDataState.renderFailedState({
          viewId: 'GM24',
          title: 'خطا در ارتباط با سرور VPS',
          reason: 'پاسخی از کارگزار محلی زیرساخت دریافت نشد.',
          errorCode: 'ERR_INFRASTRUCTURE_UNREACHABLE'
        });
      }
      if (dataState.state === 'empty') {
        return window.GMDataState.renderEmptyState({
          title: 'هیچ محیط سروری یافت نشد',
          description: 'هیچ سرور یا محیطی برای این پلتفرم ثبت نشده است.',
          actionLabel: 'پایش مجدد شبکه',
          onAction: "window.GMApp ? window.GMApp.showToast('آزمایش سرور آغاز شد', 'info') : null"
        });
      }
      if (dataState.state === 'loading') {
        return window.GMDataState.renderSkeleton('cards', 3);
      }
      if (dataState.state === 'stale') {
        return window.GMDataState.renderStaleBanner('GM24');
      }
      if (dataState.state === 'refreshing') {
        return window.GMDataState.renderRefreshingBanner ? window.GMDataState.renderRefreshingBanner('GM24') : '';
      }
      return '';
    })()}

    <!-- Tab Selector -->
    <div class="gm-tabs-nav" role="tablist" style="display: flex; gap: 0.5rem; margin-bottom: 1.25rem; border-bottom: 1px solid var(--border-default); padding-bottom: 0.5rem;">
      <button class="btn btn-sm ${activeTab === 'visual' ? 'btn-primary' : 'btn-secondary'}" onclick="window.GMViews.GM24.switchTab('visual')" role="tab" aria-selected="${activeTab === 'visual'}">
        📊 داشبورد گرافیکی مانیتورینگ
      </button>
      <button class="btn btn-sm ${activeTab === 'specs' ? 'btn-primary' : 'btn-secondary'}" onclick="window.GMViews.GM24.switchTab('specs')" role="tab" aria-selected="${activeTab === 'specs'}">
        🖥️ مشخصات سرور و محیط‌های هاست (${cells.length})
      </button>
    </div>

    <!-- TAB 1: VISUAL GRAPHICAL DASHBOARD -->
    <div id="gm24-tab-visual" style="${activeTab === 'visual' ? '' : 'display: none;'}">
      
      <!-- Top Health Hero Card -->
      <div class="card" style="margin-bottom: 1.25rem; background: linear-gradient(135deg, rgba(16, 185, 129, 0.08) 0%, rgba(14, 165, 233, 0.05) 50%, var(--bg-surface) 100%); border: 1px solid rgba(16, 185, 129, 0.3); border-radius: 12px; padding: 1.25rem;">
        <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem;">
          <div style="display: flex; align-items: center; gap: 1rem;">
            <div style="width: 52px; height: 52px; border-radius: 50%; background: rgba(16, 185, 129, 0.15); border: 2px solid #10b981; display: flex; align-items: center; justify-content: center; font-size: 1.5rem; position: relative;">
              🟢
              <span style="position: absolute; width: 100%; height: 100%; border-radius: 50%; border: 2px solid #10b981; animation: ping 2s cubic-bezier(0, 0, 0.2, 1) infinite; opacity: 0.75;"></span>
            </div>
            <div>
              <div style="font-size: 1.15rem; font-weight: 800; color: var(--text-primary); display: flex; align-items: center; gap: 0.5rem;">
                سلامت کلان سرور: ۱۰۰٪ پایدار و بدون خطا
                <span class="badge badge-success" style="font-size: 0.7rem;">Active Production</span>
              </div>
              <div style="font-size: 0.813rem; color: var(--text-secondary); margin-top: 0.25rem;">
                میزبان: سرور ابری اختصاصی وستو | سرعت پاسخگویی درون‌شبکه‌ای: کمتر از ۱ میلی‌ثانیه | پایداری ماهانه: ۹۹.۹۸٪
              </div>
            </div>
          </div>
          <div style="display: flex; gap: 0.6rem; flex-wrap: wrap;">
            <div style="text-align: center; background: var(--bg-surface); padding: 0.4rem 0.8rem; border-radius: 8px; border: 1px solid var(--border-default);">
              <div style="font-size: 0.68rem; color: var(--text-secondary);">سرویس‌های برخط</div>
              <div style="font-size: 1rem; font-weight: 800; color: #10b981;">۵ از ۵</div>
            </div>
            <div style="text-align: center; background: var(--bg-surface); padding: 0.4rem 0.8rem; border-radius: 8px; border: 1px solid var(--border-default);">
              <div style="font-size: 0.68rem; color: var(--text-secondary);">تاخیر داخلی</div>
              <div style="font-size: 1rem; font-weight: 800; color: #0284c7;">۱ms</div>
            </div>
            <div style="text-align: center; background: var(--bg-surface); padding: 0.4rem 0.8rem; border-radius: 8px; border: 1px solid var(--border-default);">
              <div style="font-size: 0.68rem; color: var(--text-secondary);">وضعیت بکاپ</div>
              <div style="font-size: 1rem; font-weight: 800; color: #8b5cf6;">تأییدشده</div>
            </div>
          </div>
        </div>
      </div>

      <!-- 4 Visual Resource Gauges -->
      <div class="grid-cols-4" style="gap: 1rem; margin-bottom: 1.25rem;">
        <!-- CPU Gauge -->
        <div class="card" style="padding: 1rem; border-radius: 10px; text-align: center; position: relative; overflow: hidden;">
          <div style="font-size: 0.75rem; font-weight: 700; color: var(--text-secondary); margin-bottom: 0.5rem; display: flex; justify-content: space-between; align-items: center;">
            <span>بار پردازنده (CPU)</span>
            <span class="badge badge-success" style="font-size: 0.65rem;">نرمال</span>
          </div>
          <div style="position: relative; width: 110px; height: 110px; margin: 0 auto;">
            <svg viewBox="0 0 36 36" style="width: 100%; height: 100%; transform: rotate(-90deg);">
              <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="var(--border-subtle, #e2e8f0)" stroke-width="3" />
              <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="#10b981" stroke-width="3" stroke-dasharray="14, 100" stroke-linecap="round" />
            </svg>
            <div style="position: absolute; top: 0; left: 0; right: 0; bottom: 0; display: flex; flex-direction: column; align-items: center; justify-content: center;">
              <span style="font-size: 1.25rem; font-weight: 800; color: var(--text-primary); font-family: var(--font-mono);">۱۴٪</span>
              <span style="font-size: 0.65rem; color: var(--text-secondary);">۴ هسته</span>
            </div>
          </div>
          <div style="font-size: 0.72rem; color: var(--text-secondary); margin-top: 0.5rem;">
            پردازش روان و بدون فشار
          </div>
        </div>

        <!-- RAM Gauge -->
        <div class="card" style="padding: 1rem; border-radius: 10px; text-align: center; position: relative; overflow: hidden;">
          <div style="font-size: 0.75rem; font-weight: 700; color: var(--text-secondary); margin-bottom: 0.5rem; display: flex; justify-content: space-between; align-items: center;">
            <span>حافظه موقت (RAM)</span>
            <span class="badge badge-success" style="font-size: 0.65rem;">بهینه</span>
          </div>
          <div style="position: relative; width: 110px; height: 110px; margin: 0 auto;">
            <svg viewBox="0 0 36 36" style="width: 100%; height: 100%; transform: rotate(-90deg);">
              <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="var(--border-subtle, #e2e8f0)" stroke-width="3" />
              <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="#0284c7" stroke-width="3" stroke-dasharray="28, 100" stroke-linecap="round" />
            </svg>
            <div style="position: absolute; top: 0; left: 0; right: 0; bottom: 0; display: flex; flex-direction: column; align-items: center; justify-content: center;">
              <span style="font-size: 1.25rem; font-weight: 800; color: var(--text-primary); font-family: var(--font-mono);">۲۸٪</span>
              <span style="font-size: 0.65rem; color: var(--text-secondary);">۲.۲ / ۸ GB</span>
            </div>
          </div>
          <div style="font-size: 0.72rem; color: var(--text-secondary); margin-top: 0.5rem;">
            ۵.۸ گیگابایت فضای آزاد بافر
          </div>
        </div>

        <!-- NVMe Storage Gauge -->
        <div class="card" style="padding: 1rem; border-radius: 10px; text-align: center; position: relative; overflow: hidden;">
          <div style="font-size: 0.75rem; font-weight: 700; color: var(--text-secondary); margin-bottom: 0.5rem; display: flex; justify-content: space-between; align-items: center;">
            <span>دیسک پرسرعت (NVMe)</span>
            <span class="badge badge-success" style="font-size: 0.65rem;">آزاد</span>
          </div>
          <div style="position: relative; width: 110px; height: 110px; margin: 0 auto;">
            <svg viewBox="0 0 36 36" style="width: 100%; height: 100%; transform: rotate(-90deg);">
              <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="var(--border-subtle, #e2e8f0)" stroke-width="3" />
              <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="#8b5cf6" stroke-width="3" stroke-dasharray="18, 100" stroke-linecap="round" />
            </svg>
            <div style="position: absolute; top: 0; left: 0; right: 0; bottom: 0; display: flex; flex-direction: column; align-items: center; justify-content: center;">
              <span style="font-size: 1.25rem; font-weight: 800; color: var(--text-primary); font-family: var(--font-mono);">۱۸٪</span>
              <span style="font-size: 0.65rem; color: var(--text-secondary);">۱۸ / ۱۰۰ GB</span>
            </div>
          </div>
          <div style="font-size: 0.72rem; color: var(--text-secondary); margin-top: 0.5rem;">
            ۸۲ گیگابایت فضای خالی SSD
          </div>
        </div>

        <!-- Latency Gauge -->
        <div class="card" style="padding: 1rem; border-radius: 10px; text-align: center; position: relative; overflow: hidden;">
          <div style="font-size: 0.75rem; font-weight: 700; color: var(--text-secondary); margin-bottom: 0.5rem; display: flex; justify-content: space-between; align-items: center;">
            <span>پینگ و تاخیر شبکه</span>
            <span class="badge badge-success" style="font-size: 0.65rem;">فوق‌سریع</span>
          </div>
          <div style="position: relative; width: 110px; height: 110px; margin: 0 auto;">
            <svg viewBox="0 0 36 36" style="width: 100%; height: 100%; transform: rotate(-90deg);">
              <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="var(--border-subtle, #e2e8f0)" stroke-width="3" />
              <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="#06b6d4" stroke-width="3" stroke-dasharray="98, 100" stroke-linecap="round" />
            </svg>
            <div style="position: absolute; top: 0; left: 0; right: 0; bottom: 0; display: flex; flex-direction: column; align-items: center; justify-content: center;">
              <span style="font-size: 1.25rem; font-weight: 800; color: var(--text-primary); font-family: var(--font-mono);">&lt; ۱ms</span>
              <span style="font-size: 0.65rem; color: var(--text-secondary);">Local Loop</span>
            </div>
          </div>
          <div style="font-size: 0.72rem; color: var(--text-secondary); margin-top: 0.5rem;">
            ارتباط فوق‌سریع درونی هاست
          </div>
        </div>
      </div>

      <!-- Graphical Visual Architecture Flowchart -->
      <div class="card" style="margin-bottom: 1.25rem; border: 1px solid var(--border-default); border-radius: 12px; padding: 1.25rem;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; border-bottom: 1px solid var(--border-default); padding-bottom: 0.65rem;">
          <div>
            <h3 style="margin: 0; font-size: 0.95rem; font-weight: 700; color: var(--text-primary); display: flex; align-items: center; gap: 0.4rem;">
              <span>🗺️</span>
              <span>نقشه گرافیکی جریان داده و ارتباط سرویس‌های اکوسیستم</span>
            </h3>
            <p style="margin: 0.2rem 0 0; font-size: 0.75rem; color: var(--text-secondary);">
              نمودار زنده مسیر درخواست‌ها از کلاینت‌های رستوران‌ها تا پایگاه داده روی سرور اختصاصی VPS
            </p>
          </div>
          <span class="badge badge-success">اتصال بلادرنگ فعال</span>
        </div>

        <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.75rem; padding: 0.5rem 0;">
          
          <!-- Node 1: Client Restaurant Apps (Port 4180 / Dynamic Ports) -->
          <div style="flex: 1; min-width: 180px; background: var(--bg-surface-subtle); border: 2px solid rgba(2, 132, 199, 0.4); border-radius: 10px; padding: 0.85rem; text-align: center; box-shadow: 0 2px 6px rgba(0,0,0,0.05);">
            <div style="font-size: 1.5rem; margin-bottom: 0.25rem;">🍽️</div>
            <div style="font-weight: 700; font-size: 0.85rem; color: var(--text-primary);">کلاینت و اپلیکیشن رستوران‌ها</div>
            <div class="cell-mono font-bold" style="color: #0284c7; font-size: 0.85rem; margin: 0.2rem 0;">پورت ۴۱۸۰</div>
            <div style="font-size: 0.7rem; color: var(--text-secondary);">صندوق POS، سفارش سالن، KDS و شعب</div>
            <div style="margin-top: 0.5rem;"><span class="badge badge-success" style="font-size: 0.65rem;">🟢 برخط و متصل</span></div>
          </div>

          <!-- Arrow 1 -->
          <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 0 0.5rem;">
            <div style="font-size: 0.7rem; color: var(--text-secondary); margin-bottom: 0.2rem; font-family: var(--font-mono);">HTTP / WS</div>
            <div style="font-size: 1.25rem; color: #10b981;">➔</div>
          </div>

          <!-- Node 2: Nginx Proxy (Ports 80/443) -->
          <div style="flex: 1; min-width: 180px; background: var(--bg-surface-subtle); border: 2px solid rgba(16, 185, 129, 0.4); border-radius: 10px; padding: 0.85rem; text-align: center; box-shadow: 0 2px 6px rgba(0,0,0,0.05);">
            <div style="font-size: 1.5rem; margin-bottom: 0.25rem;">🌐</div>
            <div style="font-weight: 700; font-size: 0.85rem; color: var(--text-primary);">پروکسی معکوس Nginx</div>
            <div class="cell-mono font-bold" style="color: #10b981; font-size: 0.85rem; margin: 0.2rem 0;">پورت ۸۰ / ۴۴۳</div>
            <div style="font-size: 0.7rem; color: var(--text-secondary);">توزیع ترافیک، SSL و فایروال</div>
            <div style="margin-top: 0.5rem;"><span class="badge badge-success" style="font-size: 0.65rem;">🟢 فعال و ایمن</span></div>
          </div>

          <!-- Arrow 2 -->
          <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 0 0.5rem;">
            <div style="font-size: 0.7rem; color: var(--text-secondary); margin-bottom: 0.2rem; font-family: var(--font-mono);">ProxyPass</div>
            <div style="font-size: 1.25rem; color: #10b981;">➔</div>
          </div>

          <!-- Node 3: SALSA Engine (Ports 3050 & 3061) -->
          <div style="flex: 1; min-width: 180px; background: var(--bg-surface-subtle); border: 2px solid rgba(139, 92, 246, 0.4); border-radius: 10px; padding: 0.85rem; text-align: center; box-shadow: 0 2px 6px rgba(0,0,0,0.05);">
            <div style="font-size: 1.5rem; margin-bottom: 0.25rem;">⚡</div>
            <div style="font-weight: 700; font-size: 0.85rem; color: var(--text-primary);">گادمود و کنترل‌پلن</div>
            <div class="cell-mono font-bold" style="color: #8b5cf6; font-size: 0.85rem; margin: 0.2rem 0;">پورت ۳۰۵۰ / ۳۰۶۱</div>
            <div style="font-size: 0.7rem; color: var(--text-secondary);">فرماندهی، لاگ و اتوماسیون</div>
            <div style="margin-top: 0.5rem;"><span class="badge badge-success" style="font-size: 0.65rem;">🟢 آماده مدیریت</span></div>
          </div>

          <!-- Arrow 3 -->
          <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 0 0.5rem;">
            <div style="font-size: 0.7rem; color: var(--text-secondary); margin-bottom: 0.2rem; font-family: var(--font-mono);">TCP 0ms</div>
            <div style="font-size: 1.25rem; color: #10b981;">➔</div>
          </div>

          <!-- Node 4: PostgreSQL 16 (Port 5433) -->
          <div style="flex: 1; min-width: 180px; background: var(--bg-surface-subtle); border: 2px solid rgba(16, 185, 129, 0.4); border-radius: 10px; padding: 0.85rem; text-align: center; box-shadow: 0 2px 6px rgba(0,0,0,0.05);">
            <div style="font-size: 1.5rem; margin-bottom: 0.25rem;">🗄️</div>
            <div style="font-weight: 700; font-size: 0.85rem; color: var(--text-primary);">پایگاه داده PostgreSQL 16</div>
            <div class="cell-mono font-bold" style="color: #10b981; font-size: 0.85rem; margin: 0.2rem 0;">پورت ۵۴۳۳</div>
            <div style="font-size: 0.7rem; color: var(--text-secondary);">ایزولاسیون شِما و صف Outbox</div>
            <div style="margin-top: 0.5rem;"><span class="badge badge-success" style="font-size: 0.65rem;">🟢 همگام و پایدار</span></div>
          </div>

        </div>
      </div>

      <!-- Real Production Services & Port Topology Grid -->
      <div class="card" style="margin-bottom: 1.25rem; border: 1px solid var(--border-default); border-radius: 12px; padding: 1.25rem;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; border-bottom: 1px solid var(--border-default); padding-bottom: 0.65rem;">
          <div>
            <h3 style="margin: 0; font-size: 0.95rem; font-weight: 700; color: var(--text-primary);">
              📡 وضعیت پورت‌های عملیاتی سرور VPS (Host Services & Port Topology)
            </h3>
            <p style="margin: 0.2rem 0 0; font-size: 0.75rem; color: var(--text-secondary);">
              پایش بلادرنگ سرویس‌های فعال بر روی سرور اختصاصی وستو در محیط پروداکشن
            </p>
          </div>
          <span class="badge badge-success"><span class="status-dot dot-green"></span> سرور متمرکز VPS</span>
        </div>

        <div class="grid-cols-4" style="gap: 0.85rem;">
          <!-- Port 3050 -->
          <div style="background: var(--bg-surface-subtle); border: 1px solid var(--border-default); border-radius: 8px; padding: 0.85rem; transition: transform 0.2s;" onmouseenter="this.style.transform='translateY(-2px)'" onmouseleave="this.style.transform='translateY(0)'">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <span class="cell-mono font-bold" style="color: var(--accent-cyan); font-size: 1rem;">پورت ۳۰۵۰</span>
              <span class="badge badge-success" style="font-size: 10px;">فعال</span>
            </div>
            <div style="font-weight: 600; font-size: 0.813rem; color: var(--text-primary); margin-top: 0.35rem;">رابط کاربری گادمود (Godmode UI)</div>
            <div style="font-size: 0.72rem; color: var(--text-secondary); margin-top: 0.2rem;">داشبورد کنترل‌پلن، ابزارهای اپراتور و مدیریت مشتریان</div>
          </div>

          <!-- Port 3061 -->
          <div style="background: var(--bg-surface-subtle); border: 1px solid var(--border-default); border-radius: 8px; padding: 0.85rem; transition: transform 0.2s;" onmouseenter="this.style.transform='translateY(-2px)'" onmouseleave="this.style.transform='translateY(0)'">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <span class="cell-mono font-bold" style="color: var(--accent-cyan); font-size: 1rem;">پورت ۳۰۶۱</span>
              <span class="badge badge-success" style="font-size: 10px;">فعال</span>
            </div>
            <div style="font-weight: 600; font-size: 0.813rem; color: var(--text-primary); margin-top: 0.35rem;">سرویس API کنترل‌پلن (Control Plane API)</div>
            <div style="font-size: 0.72rem; color: var(--text-secondary); margin-top: 0.2rem;">ماشین وضعیت مشتریان، مجوزها، لاگ ممیزی و هماهنگی</div>
          </div>

          <!-- Port 4180 -->
          <div style="background: var(--bg-surface-subtle); border: 1px solid var(--border-default); border-radius: 8px; padding: 0.85rem; transition: transform 0.2s;" onmouseenter="this.style.transform='translateY(-2px)'" onmouseleave="this.style.transform='translateY(0)'">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <span class="cell-mono font-bold" style="color: var(--accent-cyan); font-size: 1rem;">پورت ۴۱۸۰</span>
              <span class="badge badge-success" style="font-size: 10px;">متصل</span>
            </div>
            <div style="font-weight: 600; font-size: 0.813rem; color: var(--text-primary); margin-top: 0.35rem;">کلاینت‌های مشتریان</div>
            <div style="font-size: 0.72rem; color: var(--text-secondary); margin-top: 0.2rem;">سامانه رستورانی، صندوق POS، منوی مشتری، سالن و KDS</div>
          </div>

          <!-- Port 5433 -->
          <div style="background: var(--bg-surface-subtle); border: 1px solid var(--border-default); border-radius: 8px; padding: 0.85rem; transition: transform 0.2s;" onmouseenter="this.style.transform='translateY(-2px)'" onmouseleave="this.style.transform='translateY(0)'">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <span class="cell-mono font-bold" style="color: var(--accent-cyan); font-size: 1rem;">پورت ۵۴۳۳</span>
              <span class="badge badge-success" style="font-size: 10px;">پایدار</span>
            </div>
            <div style="font-weight: 600; font-size: 0.813rem; color: var(--text-primary); margin-top: 0.35rem;">پایگاه داده متمرکز (PostgreSQL 16)</div>
            <div style="font-size: 0.72rem; color: var(--text-secondary); margin-top: 0.2rem;">ایزولاسیون کامل شِما برای هر مشتری با تأخیر شبکه صفر</div>
          </div>
        </div>
      </div>

      <!-- One-Click Quick Actions Toolbar -->
      <div class="card" style="margin-bottom: 1.25rem; border: 1px solid var(--border-default); border-radius: 12px; padding: 1.25rem; background: var(--bg-surface);">
        <div style="font-size: 0.95rem; font-weight: 700; color: var(--text-primary); margin-bottom: 0.35rem; display: flex; align-items: center; gap: 0.4rem;">
          <span>🛠️</span>
          <span>مرکز ابزارهای نگهداری سریع (One-Click Quick Operations)</span>
        </div>
        <p style="font-size: 0.75rem; color: var(--text-secondary); margin-bottom: 1rem;">
          عملیات متداول نگهداری و تست سرور با یک کلیک ساده و بدون نیاز به ورود به ترمینال لینوکس
        </p>
        <div style="display: flex; gap: 0.75rem; flex-wrap: wrap;">
          <button class="btn btn-secondary btn-sm" onclick="window.GMViews.GM24.runLivePing()" style="display: inline-flex; align-items: center; gap: 0.4rem; padding: 0.5rem 0.85rem;">
            <span>🩺</span>
            <span>آزمون تست پینگ تمام پورت‌ها</span>
          </button>
          <button class="btn btn-secondary btn-sm" onclick="window.GMViews.GM24.optimizeMemory()" style="display: inline-flex; align-items: center; gap: 0.4rem; padding: 0.5rem 0.85rem;">
            <span>🧹</span>
            <span>آزادسازی کش و رم موقت</span>
          </button>
          <button class="btn btn-secondary btn-sm" onclick="window.GMViews.GM24.instantBackup()" style="display: inline-flex; align-items: center; gap: 0.4rem; padding: 0.5rem 0.85rem;">
            <span>💾</span>
            <span>ایجاد بکاپ فوری سرور</span>
          </button>
          <button class="btn btn-secondary btn-sm" onclick="window.GMViews.GM24.copyHealthReport()" style="display: inline-flex; align-items: center; gap: 0.4rem; padding: 0.5rem 0.85rem;">
            <span>📋</span>
            <span>کپی گزارش سلامت برای پشتیبانی</span>
          </button>
        </div>
      </div>

    </div>

    <!-- TAB 2: SERVER SPECS & HOST DETAILS (Preserves all automated tests) -->
    <div id="gm24-tab-specs" style="${activeTab === 'specs' ? '' : 'display: none;'}">

      <!-- Standardized Operational Guidance Banner -->
      <div class="op-context-banner op-context-info" role="region" aria-label="راهنمای معماری تک‌سرور VPS">
        <div class="op-context-header">
          <span>معماری متمرکز تک‌سرور ابری (Single VPS Server Architecture)</span>
          <span class="badge badge-cyan">استقرار متمرکز و یکپارچه</span>
        </div>
        <div class="op-context-grid">
          <div class="op-context-item">
            <span class="op-context-label">وضعیت جاری:</span>
            <span class="op-context-desc">کل سامانه وستو (UI گادمود، API کنترل‌پلن، اپلیکیشن مشتریان و دیتابیس) بر روی یک سرور واحد VPS مستقر هستند. تفکیک مشتریان با شِماهای ایزوله انجام می‌گیرد.</span>
          </div>
          <div class="op-context-item">
            <span class="op-context-label">تعهد معماری و عملکرد:</span>
            <span class="op-context-desc">بهره‌مندی از حداکثر کارایی با تأخیر شبکه صفر (Zero Latency) میان سرویس‌ها و پایگاه‌داده بدون پیچیدگی کلاسترهای توزیع‌شده یا هزینه‌های نگهداری چندسلولی.</span>
          </div>
          <div class="op-context-item">
            <span class="op-context-label">اقدام استاندارد بعدی:</span>
            <span class="op-context-desc">پایش پیوسته مصرف حافظه رم (RAM)، بار پردازنده (CPU) و فضای دیسک NVMe سرور اصلی.</span>
          </div>
        </div>
      </div>

      <div class="data-quality-strip" role="status" aria-label="وضعیت داده‌های زیرساخت" style="margin-bottom: 1.25rem;">
        <div class="data-quality-label"><span class="dq-badge-dot dot-cyan"></span><span>وضعیت هاست VPS</span></div>
        <div class="data-quality-grid">
          <span class="dq-badge"><span class="dq-badge-dot ${cells.length ? 'dot-blue' : 'dot-purple'}"></span><span class="dq-dim-name">منبع</span><span class="dq-dim-val">${infrastructureSource}</span></span>
          <span class="dq-badge"><span class="dq-badge-dot dot-blue"></span><span class="dq-dim-name">سرور فعال</span><span class="dq-dim-val">${cells.length.toLocaleString('fa-IR')} محیط</span></span>
          <span class="dq-badge"><span class="dq-badge-dot dot-emerald"></span><span class="dq-dim-name">اعتبار</span><span class="dq-dim-val">عملیاتی و برخط</span></span>
        </div>
        <span class="dq-action-hint"><span>زیرساخت متمرکز VPS با سلامت عملیاتی و پایش پیوسته در دسترس است.</span></span>
      </div>

      <!-- Toolbar with Region Filters and Search -->
      <div class="table-wrapper" style="margin-bottom: 1rem;">
        <div class="table-toolbar">
          <div class="table-filters" id="cellRegionFilters" role="group" aria-label="فیلتر محیط‌های سرور">
            <button class="filter-chip active" aria-pressed="true" onclick="window.GMViews.GM24.setRegionFilter('all', this)">همه محیط‌ها (${cells.length})</button>
            <button class="filter-chip" aria-pressed="false" onclick="window.GMViews.GM24.setRegionFilter('tehran', this)">سرور اصلی (Production)</button>
            <button class="filter-chip" aria-pressed="false" onclick="window.GMViews.GM24.setRegionFilter('isfahan', this)">محیط‌های تست و بکاپ</button>
          </div>
          <div class="table-search-group">
            <span id="cellsFilterCount" class="filter-count-badge">نمایش ${cells.length.toLocaleString('fa-IR')} از ${cells.length.toLocaleString('fa-IR')} سرور و محیط</span>
            <div class="search-input-wrapper" id="cellSearchWrapper">
              <input type="text" id="cellSearchInput" class="form-control" placeholder="جست‌وجو در شناسه، نام یا محیط سرور..." aria-label="جست‌وجو در سرورها" style="width: 220px; padding: 0.35rem 0.75rem;" oninput="window.GMViews.GM24.setQuery(this.value)" />
              <button class="search-clear-btn" onclick="window.GMViews.GM24.clearSearch()" aria-label="پاکسازی جستجو">✕</button>
            </div>
          </div>
        </div>
      </div>

      <div id="cells-empty-message" style="display: none; text-align: center; padding: 2.5rem; background: var(--bg-surface-subtle); border-radius: 8px; border: 1px dashed var(--border-subtle); margin-bottom: 1.25rem;">
        <p style="color: var(--text-muted); margin-bottom: 0.5rem;">هیچ سرور یا محیطی منطبق با فیلتر یا جست‌وجوی واردشده یافت نشد.</p>
        <button class="btn btn-xs btn-secondary" onclick="window.GMViews.GM24.resetAll()">پاکسازی فیلترها</button>
      </div>

      <!-- Server Hosts Grid -->
      <div class="grid-cols-3" id="cellsGridContainer" style="margin-bottom: 1.25rem;">
        ${cells.map(c => {
          const isPrimary = c.id === 'cell-teh-01';
          return `
            <div class="card cell-card" data-id="${c.id}" data-region="${c.region}" data-search="${(c.id + ' ' + c.name + ' ' + c.region).toLowerCase()}">
              <div class="card-header">
                <div class="card-title-group">
                  <details class="row-disclosure infrastructure-technical-details">
                    <summary>شناسه سرور</summary>
                    <code class="cell-mono" style="color: var(--accent-cyan); font-size: 0.75rem;">${c.id}</code>
                  </details>
                  <h3 class="card-title" style="font-size: 0.875rem;">${c.name}</h3>
                  <p class="card-subtitle">
                    ${isPrimary ? 'سرور متمرکز عملیاتی (Production VPS)' : c.id === 'cell-teh-02' ? 'محیط پیش‌نمایش و تست (Staging VPS)' : 'ذخیره‌سازی پشتیبان آف‌سایت (Backup)'}
                  </p>
                </div>
                <div class="card-actions">
                  <span class="badge badge-success"><span class="badge-dot"></span> عملیاتی و برخط</span>
                </div>
              </div>

              <div class="card-body">
                <div style="display: flex; flex-direction: column; gap: 0.75rem; margin-bottom: 1rem;">
                  ${c.specs ? `
                  <div style="font-size: 0.75rem; color: var(--text-secondary); background: var(--bg-surface-subtle); padding: 0.4rem 0.6rem; border-radius: 6px; border: 1px solid var(--border-subtle);">
                    <div><strong>سخت‌افزار:</strong> <span class="cell-mono">${c.specs}</span></div>
                    ${c.os ? `<div style="margin-top: 0.2rem;"><strong>سیستم‌عامل:</strong> <span class="cell-mono">${c.os}</span></div>` : ''}
                  </div>` : ''}

                  <!-- Tenant Capacity Meter -->
                  <div class="metric-meter" role="status" aria-label="ظرفیت میزبانی مجموعه در سرور ${c.id}; ۴۲٪ پایدار">
                    <div class="metric-meter-header">
                      <span class="metric-meter-label">ظرفیت میزبانی مجموعه:</span>
                      <span class="metric-meter-val text-success">${c.tenantsAssigned} از ${c.tenantsCapacity} مجموعه</span>
                    </div>
                    <div class="metric-meter-track">
                      <div class="metric-meter-fill success" style="width: ${Math.round((c.tenantsAssigned / c.tenantsCapacity) * 100) || 10}%;"></div>
                    </div>
                  </div>

                  <!-- CPU Load Meter -->
                  <div class="metric-meter" role="status" aria-label="بار پردازنده سرور ${c.id}; ${c.cpuPercent}٪ نرمال">
                    <div class="metric-meter-header">
                      <span class="metric-meter-label">بار پردازنده (CPU):</span>
                      <span class="metric-meter-val text-success">${c.cpuPercent}٪ (نرمال)</span>
                    </div>
                    <div class="metric-meter-track">
                      <div class="metric-meter-fill success" style="width: ${c.cpuPercent}%;"></div>
                    </div>
                  </div>

                  <!-- RAM Load Meter -->
                  <div class="metric-meter" role="status" aria-label="مصرف حافظه رم سرور ${c.id}; ${c.memoryPercent}٪ بهینه">
                    <div class="metric-meter-header">
                      <span class="metric-meter-label">حافظه مصرفی (RAM):</span>
                      <span class="metric-meter-val text-success">${c.memoryPercent}٪ (بهینه)</span>
                    </div>
                    <div class="metric-meter-track">
                      <div class="metric-meter-fill success" style="width: ${c.memoryPercent}%;"></div>
                    </div>
                  </div>

                  <!-- Disk Space Info -->
                  <div style="display: flex; justify-content: space-between; font-size: 0.75rem; padding-top: 0.25rem; border-top: 1px solid rgba(255, 255, 255, 0.05);">
                    <span style="color: var(--text-secondary);">فضای ذخیره‌سازی:</span>
                    <span class="cell-mono font-bold text-success">${c.storageGb || 'آزاد'}</span>
                  </div>
                </div>

                <button class="btn btn-secondary btn-sm" style="width: 100%; justify-content: center;" onclick="window.GMApp ? window.GMApp.showToast('ارتباط با سرویس‌های سرور ${c.id} برقرار و پایدار است (تاخیر ۱ میلی‌ثانیه محلی).', 'success') : null">
                  آزمون ارتباط سرویس‌های سرور
                </button>
              </div>
            </div>
          `;
        }).join('')}
      </div>

    </div>
  `;
};

window.GMViews = window.GMViews || {};
window.GMViews.GM24 = {
  regionFilter: 'all',
  query: '',

  init() {
    this.applyFilters();
  },

  switchTab(tab) {
    window._activeGM24Tab = tab;
    const visualTab = document.getElementById('gm24-tab-visual');
    const specsTab = document.getElementById('gm24-tab-specs');
    if (visualTab && specsTab) {
      visualTab.style.display = (tab === 'visual') ? '' : 'none';
      specsTab.style.display = (tab === 'specs') ? '' : 'none';
      const btns = document.querySelectorAll('.gm-tabs-nav button');
      if (btns && btns.length >= 2) {
        btns[0].className = `btn btn-sm ${tab === 'visual' ? 'btn-primary' : 'btn-secondary'}`;
        btns[1].className = `btn btn-sm ${tab === 'specs' ? 'btn-primary' : 'btn-secondary'}`;
      }
    }
  },

  runLivePing() {
    if (window.GMApp && window.GMApp.showToast) {
      window.GMApp.showToast('پینگ تمامی پورت‌ها (۴۱۸۰، ۳۰۵۰، ۳۰۶۱، ۵۴۳۳) موفقیت‌آمیز بود (تاخیر میانگین: ۱.۱ میلی‌ثانیه).', 'success', 4000);
    }
  },

  optimizeMemory() {
    if (window.GMApp && window.GMApp.showToast) {
      window.GMApp.showToast('کش موقت پاکسازی و ۱۸۴ مگابایت حافظه رم سرور با موفقیت آزاد شد.', 'success', 3500);
    }
  },

  instantBackup() {
    if (window.GMApp && window.GMApp.showToast) {
      window.GMApp.showToast('پشتیبان‌گیری فوری سرور با موفقیت ثبت شد (هش SHA-256 تأیید گردید).', 'success', 4000);
    }
  },

  copyHealthReport() {
    const report = [
      '📊 گزارش سلامت و زیرساخت پلتفرم چندمستأجری سالسا (SALSA Cloud Platform):',
      '• پایداری کلان: ۱۰۰٪ عملیاتی و آنلاین',
      '• سرویس‌های کلاینت رستوران‌ها (Port 4180 / Domains): فعال و متصل',
      '• داشبورد گادمود (Port 3050): فعال',
      '• کنترل‌پلن سالسا (Port 3061): فعال',
      '• پایگاه‌داده PostgreSQL 16 (Port 5433): متصل و پایدار',
      '• مصرف رم: ۲.۲ از ۸ گیگابایت (۲۸٪)',
      '• بار پردازنده: ۱۴٪ (نرمال)',
      '• وضعیت بکاپ: تأییدشده',
      '• زمان گزارش: ' + new Date().toLocaleString('fa-IR')
    ].join('\n');

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(report).then(() => {
        if (window.GMApp && window.GMApp.showToast) {
          window.GMApp.showToast('گزارش وضعیت مانیتورینگ در حافظه کلیپ‌بورد کپی شد.', 'info');
        }
      }).catch(() => {
        if (window.GMApp && window.GMApp.showToast) {
          window.GMApp.showToast('امکان دسترسی به کلیپ‌بورد وجود ندارد.', 'warning');
        }
      });
    } else if (window.GMApp && window.GMApp.showToast) {
      window.GMApp.showToast('گزارش وضعیت در کنسول آماده است.', 'info');
    }
  },

  applyFilters() {
    const cards = document.querySelectorAll('#cellsGridContainer .cell-card');
    let visibleCount = 0;
    const totalCount = cards.length;

    cards.forEach(card => {
      const region = (card.getAttribute('data-region') || '').toLowerCase();
      const searchData = card.getAttribute('data-search') || '';

      let matchFilter = true;
      if (this.regionFilter === 'tehran' || this.regionFilter === 'production') {
        matchFilter = region.includes('tehran-core') || card.getAttribute('data-id') === 'cell-teh-01';
      } else if (this.regionFilter === 'isfahan' || this.regionFilter === 'staging-backup') {
        matchFilter = !region.includes('tehran-core');
      }

      const matchQuery = !this.query || searchData.includes(this.query);

      if (matchFilter && matchQuery) {
        card.style.display = '';
        visibleCount++;
      } else {
        card.style.display = 'none';
      }
    });

    const emptyMsg = document.getElementById('cells-empty-message');
    if (emptyMsg) {
      emptyMsg.style.display = (visibleCount === 0 && totalCount > 0) ? '' : 'none';
    }

    const countBadge = document.getElementById('cellsFilterCount');
    if (countBadge) {
      countBadge.textContent = `نمایش ${visibleCount.toLocaleString('fa-IR')} از ${totalCount.toLocaleString('fa-IR')} سرور و محیط`;
    }

    const wrapper = document.getElementById('cellSearchWrapper');
    if (wrapper) {
      if (this.query) wrapper.classList.add('has-value');
      else wrapper.classList.remove('has-value');
    }
  },

  setRegionFilter(region, btn) {
    this.regionFilter = region;
    document.querySelectorAll('#cellRegionFilters .filter-chip').forEach(el => {
      el.classList.remove('active');
      el.setAttribute('aria-pressed', 'false');
    });
    if (btn) {
      btn.classList.add('active');
      btn.setAttribute('aria-pressed', 'true');
    }
    this.applyFilters();
  },

  setQuery(q) {
    this.query = (q || '').trim().toLowerCase();
    this.applyFilters();
  },

  clearSearch() {
    const input = document.getElementById('cellSearchInput');
    if (input) input.value = '';
    this.setQuery('');
  },

  resetAll() {
    this.regionFilter = 'all';
    const firstChip = document.querySelector('#cellRegionFilters .filter-chip');
    if (firstChip) {
      document.querySelectorAll('#cellRegionFilters .filter-chip').forEach(el => {
        el.classList.remove('active');
        el.setAttribute('aria-pressed', 'false');
      });
      firstChip.classList.add('active');
      firstChip.setAttribute('aria-pressed', 'true');
    }
    this.clearSearch();
  }
};
