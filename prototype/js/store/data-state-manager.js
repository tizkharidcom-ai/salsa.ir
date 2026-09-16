/**
 * prototype/js/store/data-state-manager.js
 * 
 * Shared Data Freshness, State & Resilience System
 * Implements 6 canonical lifecycle states: live, loading, stale, refreshing, empty, failed/error.
 * Provides 4-dimensional synthetic telemetry (Completeness, Freshness, Validity, Consistency),
 * state simulation controls, and accessible skeleton/empty/error state renderers.
 */

'use strict';

class DataStateManager {
  constructor() {
    this.viewStates = {};
    this.componentStates = {};
  }

  normalizeState(state) {
    if (!state) return 'live';
    const s = String(state).toLowerCase().trim();
    if (s === 'ready') return 'live';
    if (s === 'failed-retry' || s === 'error') return 'failed';
    return s;
  }

  isErrorState(state) {
    const s = this.normalizeState(state);
    return s === 'failed';
  }

  getViewState(viewId) {
    if (!this.viewStates[viewId]) {
      this.viewStates[viewId] = {
        state: 'live', // 'loading' | 'live' | 'stale' | 'refreshing' | 'empty' | 'failed' | 'error'
        lastSynced: new Date(),
        error: null,
        retryCount: 0
      };
    }
    return this.viewStates[viewId];
  }

  getComponentState(viewId, componentId) {
    const compKey = `${viewId}:${componentId}`;
    if (!this.componentStates[compKey]) {
      const parentVs = this.getViewState(viewId);
      return {
        state: parentVs.state,
        lastSynced: parentVs.lastSynced,
        error: parentVs.error,
        retryCount: 0
      };
    }
    return this.componentStates[compKey];
  }

  simulateState(viewId, newState, error = null) {
    return this.setViewState(viewId, newState, error);
  }

  setComponentState(viewId, componentId, newState, error = null) {
    const compKey = `${viewId}:${componentId}`;
    if (!this.componentStates[compKey]) {
      this.componentStates[compKey] = {
        state: 'live',
        lastSynced: new Date(),
        error: null,
        retryCount: 0
      };
    }
    const cs = this.componentStates[compKey];
    newState = this.normalizeState(newState);

    cs.state = newState;
    if (newState === 'live') {
      cs.lastSynced = new Date();
      cs.error = null;
      cs.retryCount = 0;
    } else if (newState === 'stale') {
      cs.lastSynced = new Date(Date.now() - 25 * 60 * 1000);
      cs.error = null;
    } else if (newState === 'failed' || newState === 'error') {
      cs.error = error || 'خطای بارگذاری داده‌های کامپوننت';
    } else if (newState === 'loading') {
      cs.error = null;
    }

    if (typeof window !== 'undefined' && window.GMRouter) {
      window.GMRouter.refresh();
    }
    return cs;
  }

  setViewState(viewId, newState, error = null) {
    const vs = this.getViewState(viewId);
    newState = this.normalizeState(newState);

    vs.state = newState;
    if (newState === 'live') {
      vs.lastSynced = new Date();
      vs.error = null;
      vs.retryCount = 0;
    } else if (newState === 'stale') {
      // Set timestamp to 25 minutes ago to reflect stale state
      vs.lastSynced = new Date(Date.now() - 25 * 60 * 1000);
      vs.error = null;
    } else if (newState === 'failed' || newState === 'error') {
      vs.error = error || 'خطای ارتباط با کلاستر ابری هنگام بازیابی داده‌های عملیاتی';
    } else if (newState === 'loading') {
      vs.error = null;
    }

    if (typeof window !== 'undefined' && window.GMRouter) {
      window.GMRouter.refresh();
    }
  }

  refreshView(viewId, onComplete) {
    const vs = this.getViewState(viewId);
    vs.state = 'refreshing';

    if (typeof document !== 'undefined') {
      const bar = document.getElementById(`data-freshness-bar-${viewId}`);
      if (bar) bar.classList.add('is-refreshing');
      const btn = document.getElementById(`freshness-refresh-btn-${viewId}`);
      if (btn) {
        btn.classList.add('is-spinning');
        btn.disabled = true;
      }
    }

    setTimeout(() => {
      vs.state = 'live';
      vs.lastSynced = new Date();
      vs.error = null;
      vs.retryCount = 0;
      if (typeof window !== 'undefined') {
        if (window.GMApp && typeof window.GMApp.showToast === 'function') {
          window.GMApp.showToast('وضعیت بخش با موفقیت بازخوانی شد.', 'success');
        }
        if (typeof onComplete === 'function') {
          onComplete();
        } else if (window.GMRouter) {
          window.GMRouter.refresh();
        }
      }
    }, 400);
  }

  retryView(viewId) {
    const vs = this.getViewState(viewId);
    vs.retryCount = (vs.retryCount || 0) + 1;
    vs.error = null;
    this.refreshView(viewId);
  }

  formatPersianTime(date) {
    if (!date) return 'هم‌اکنون';
    const d = new Date(date);
    const h = String(d.getHours()).padStart(2, '0');
    const m = String(d.getMinutes()).padStart(2, '0');
    const s = String(d.getSeconds()).padStart(2, '0');
    return `${h}:${m}:${s}`.replace(/\d/g, digit => '۰۱۲۳۴۵۶۷۸۹'[digit]);
  }

  // ------------------------------------------------------------
  // Data Quality 4-Dimensional Telemetry
  // Completeness, Freshness, Validity, Consistency
  // ------------------------------------------------------------
  getDataQualityTelemetry(scope = 'overview', metricKey = null) {
    // Calibrated synthetic data specifically for Westo Café
    if (scope === 'jobs') {
      return {
        scope: 'jobs',
        title: 'تله‌متری کیفیت صف کارهای پس‌زمینه (Worker Queue)',
        completeness: {
          score: '۱۰۰٪',
          percentage: 100,
          label: 'کامل بودن (Completeness)',
          status: 'healthy',
          meta: '۱۲ وظیفه در صف ثبت و ایندکس شده',
          summary: 'پوشش ۱۰۰٪ تمام جاب‌های صفی بدون مفقودی پیام یا تسک سرگردان',
          checks: [
            { name: 'ایندکس‌گذاری صف وظایف', status: 'pass', detail: 'تمام کارهای ایجاد مستأجر، افزونه و بکاپ شماره‌گذاری شده‌اند' },
            { name: 'نگه‌داری تاریخچه لاگ خروجی', status: 'pass', detail: 'لاگ تمامی مراحل جاب‌ها در مخزن لاگ ذخیره شده است' }
          ]
        },
        freshness: {
          score: '۰.۴s',
          latencyMs: 400,
          label: 'تازگی (Freshness)',
          status: 'healthy',
          meta: 'تاخیر پردازش کمتر از ۵۰۰ms',
          summary: 'نرخ تاخیر پردازش صف ۴۰۰ میلی‌ثانیه؛ سازگار با SLA زمان واقعی',
          checks: [
            { name: 'نرخ پولینگ کارگران (Workers)', status: 'pass', detail: 'هر ۲۰۰ میلی‌ثانیه استعلام وضعیت صف صورت می‌گیرد' },
            { name: 'زمان انقضای تیکت جاب‌ها', status: 'pass', detail: 'سقف ۶۰ ثانیه‌ای برای آزادسازی قفل جاب‌های متوقف‌شده' }
          ]
        },
        validity: {
          score: '۱۰۰٪',
          percentage: 100,
          label: 'صحت اسکیما (Validity)',
          status: 'healthy',
          meta: 'تطابق کامل ساختار پارامترها',
          summary: 'تمام پارامترهای ارسالی به کارگران با ساختار تعریف‌شده انطباق دارند',
          checks: [
            { name: 'اعتبارسنجی آرگومان‌های ورودی', status: 'pass', detail: 'آرگومان‌های جاب‌های Provisioning و Backup به دقت نوع‌سنجی شدند' },
            { name: 'بررسی عدم سرریز پارامترها', status: 'pass', detail: 'حجم پیام‌ها کمتر از ۶۴ کیلوبایت و استاندارد است' }
          ]
        },
        consistency: {
          score: '۱۰۰٪',
          percentage: 100,
          label: 'سازگاری (Consistency)',
          status: 'healthy',
          meta: 'تطابق کامل دیتابیس با Workerها',
          summary: 'وضعیت جاب در مخزن داده با وضعیت زنده در پردازشگرها ۱۰۰٪ همگام است',
          checks: [
            { name: 'تطابق وضعیت پایگاه‌داده و Worker', status: 'pass', detail: 'عدم وجود وضعیت ناهماهنگ در پایان اجرای جاب' },
            { name: 'حفظ ترتیب توالی صف (FIFO)', status: 'pass', detail: 'ترتیب اولویت اجرای وظایف به درستی رعایت شده است' }
          ]
        }
      };
    }

    if (scope === 'telemetry') {
      return {
        scope: 'telemetry',
        title: 'تله‌متری کیفیت سلامت پلتفرم و ارائه‌دهندگان (Operations)',
        completeness: {
          score: '۱۰۰٪',
          percentage: 100,
          label: 'کامل بودن (Completeness)',
          status: 'healthy',
          meta: '۱۲ حسگر فعال تحت پوشش کامل',
          summary: 'پایش بلادرنگ تمام ۱۲ ماژول زیرساختی و سخت‌افزارهای سالن وستو',
          checks: [
            { name: 'پوشش حسگرهای ناوگان پوز و سخت‌افزار', status: 'pass', detail: '۸ صندوق و نمایشگر آشپزخانه متصل به هارت‌بیت' },
            { name: 'پروب‌های سلامت درگاه‌های پرداخت و پیامک', status: 'pass', detail: 'سوییچ شاپرک، بانک سامان، همراه اول و ایرانسل تحت پایش' }
          ]
        },
        freshness: {
          score: '۰.۸s',
          latencyMs: 800,
          label: 'تازگی (Freshness)',
          status: 'healthy',
          meta: 'پولینگ ثانیه‌ای حسگرها',
          summary: 'تاخیر دریافت پالس سلامت ۸۰۰ میلی‌ثانیه؛ بالاتر از استاندارد SLA پلتفرم',
          checks: [
            { name: 'تاخیر پینگ سرور وستو (۴۱۸۰)', status: 'pass', detail: '۰.۸ میلی‌ثانیه در حلقه محلی شبکه ایزوله' },
            { name: 'تاخیر سنجش پرینتر حرارتی بار', status: 'pass', detail: 'استعلام سلامت هر ۳ ثانیه یک‌بار' }
          ]
        },
        validity: {
          score: '۱۰۰٪',
          percentage: 100,
          label: 'صحت اسکیما (Validity)',
          status: 'healthy',
          meta: 'استاندارد OpenTelemetry',
          summary: 'فرمت داده‌های تله‌متری منطبق بر پروتکل استاندارد سلامت و خطایابی',
          checks: [
            { name: 'انطباق قالب کدهای خطای پلتفرم', status: 'pass', detail: 'ثبت استاندارد خطاهای ERR_GATEWAY و پاسخ‌های زیرسیستم' },
            { name: 'اعتبارسنجی شعاع اثر اختلال (Blast Radius)', status: 'pass', detail: 'محاسبه ریاضی درصد کاربران تحت تاثیر' }
          ]
        },
        consistency: {
          score: '۹۹.۹٪',
          percentage: 99.9,
          label: 'سازگاری (Consistency)',
          status: 'healthy',
          meta: 'همبستگی لاگ با تیکت‌های رخداد',
          summary: 'انطباق بلادرنگ داده‌های مانیتورینگ با دفتر کل لاگ‌های حسابرسی',
          checks: [
            { name: 'تطابق لاگ‌های هشدار با رویدادهای ممیزی', status: 'pass', detail: 'هر رخداد ثبت‌شده دارای شماره ارجاع ممیزی معتبر است' },
            { name: 'انطباق وضعیت سوییچ با اعلامیه پورتال عمومی', status: 'pass', detail: 'هماهنگی اعلام وضعیت با status.neem.ir' }
          ]
        }
      };
    }

    if (metricKey) {
      const metricMap = {
        restaurant: {
          completeness: { score: '۱۰۰٪', meta: 'پوشش کامل پرونده وستو', summary: 'تمام اطلاعات هویتی، مالکیتی و قرارداد کافه وستو ثبت شده است' },
          freshness: { score: '۰.۶s', meta: 'اتصال مستقیم به پورت ۴۱۸۰', summary: 'همگام‌سازی بلادرنگ داده‌های رستوران با هسته وستو' },
          validity: { score: '۱۰۰٪', meta: 'پاس شدن ۶۴ قاعده قرارداد', summary: 'تطابق کامل شماره همراه مدیریت و کلیدهای پیکربندی' },
          consistency: { score: '۱۰۰٪', meta: 'انطباق کامل دیتابیس ایزوله', summary: 'تطابق کامل شناسنامه مستأجر با فایل‌های کانفیگ' }
        },
        tables: {
          completeness: { score: '۱۰۰٪', meta: '۱۵ میز با ۵۸ صندلی', summary: 'تمام میزهای سالن با مختصات و ظرفیت صندلی ثبت شده‌اند' },
          freshness: { score: '۱.۱s', meta: 'استعلام بلادرنگ وضعیت صندلی‌ها', summary: 'همگام‌سازی وضعیت رزرو و اشغال با سیستم سفارش‌گیر' },
          validity: { score: '۱۰۰٪', meta: 'اعتبارسنجی زون و شماره میز', summary: 'عدم وجود شماره میز تکراری یا زون نامعتبر' },
          consistency: { score: '۱۰۰٪', meta: 'تطابق میز با فاکتورهای باز', summary: 'میزهای اشغال‌شده دارای سفارش باز معتبر در KDS هستند' }
        },
        menu: {
          completeness: { score: '۱۰۰٪', meta: '۱۶ دسته‌بندی و ۲۱۵ قلم منو', summary: 'پوشش کامل کاتالوگ خوراک، نوشیدنی و بار گرم وستو' },
          freshness: { score: '۱.۵s', meta: 'تازگی کاتالوگ و قیمت‌ها', summary: 'به‌روزرسانی قیمت‌ها و وضعیت موجودی در لحظه' },
          validity: { score: '۱۰۰٪', meta: 'انطباق قیمت ریالی و مالیات', summary: 'تمامی قیمت‌ها مثبت، دارای واحد ریال و درصد مالیات قانونی' },
          consistency: { score: '۱۰۰٪', meta: 'تطابق آیتم با منوی پوز وستو', summary: 'همبستگی ۱۰۰٪ کدهای آیتم در منوی آنلاین و صندوق پوز' }
        },
        orders: {
          completeness: { score: '۹۹.۸٪', meta: 'ثبت بدون نقص سفارشات روز', summary: 'پوشش کامل تمام فاکتورهای صادره امروز کافه وستو' },
          freshness: { score: '۱.۲s', meta: 'همگام‌سازی بلادرنگ پوز', summary: 'ثبت سفارشات در پایگاه‌داده بلافاصله پس از تایید گارسون' },
          validity: { score: '۱۰۰٪', meta: 'اعتبارسنجی جمع کل و تخفیف‌ها', summary: 'محاسبه ریاضی دقیق مبالغ فاکتور و کدهای تخفیف' },
          consistency: { score: '۱۰۰٪', meta: 'تطابق تراز مالی با کارتخوان', summary: 'تطابق ریالی ۱۰۰٪ مبالغ تسویه‌شده با گزارش شاپرک' }
        }
      };

      const mData = metricMap[metricKey] || metricMap.restaurant;
      return {
        scope: 'metric-' + metricKey,
        title: `تله‌متری کیفیت داده متریک (${metricKey})`,
        completeness: { score: mData.completeness.score, label: 'کامل بودن (Completeness)', status: 'healthy', meta: mData.completeness.meta, summary: mData.completeness.summary },
        freshness: { score: mData.freshness.score, label: 'تازگی (Freshness)', status: 'healthy', meta: mData.freshness.meta, summary: mData.freshness.summary },
        validity: { score: mData.validity.score, label: 'صحت اسکیما (Validity)', status: 'healthy', meta: mData.validity.meta, summary: mData.validity.summary },
        consistency: { score: mData.consistency.score, label: 'سازگاری (Consistency)', status: 'healthy', meta: mData.consistency.meta, summary: mData.consistency.summary }
      };
    }

    // Default Overview Scope
    return {
      scope: 'overview',
      title: 'تله‌متری کیفیت کلان داده‌های وستو (Overview Data Quality)',
      completeness: {
        score: '۹۹.۸٪',
        percentage: 99.8,
        label: 'کامل بودن (Completeness)',
        status: 'healthy',
        meta: 'پوشش کامل موجودیت‌های وستو',
        summary: 'پوشش کامل فیلدهای الزامی منو، میزها و حساب‌های مالی وستو بدون رکورد مفقود',
        checks: [
          { name: 'فیلدهای هویتی و پروانه‌ای نمونه', status: 'pass', detail: 'سناریوی نمونه (نام، دامنه، مالک نمونه، شناسه)' },
          { name: 'پوشش کاتالوگ و دسته‌بندی‌های منو', status: 'pass', detail: '۱۰۰٪ (۱۶ دسته‌بندی و ۲۱۵ قلم فعال)' },
          { name: 'چیدمان و پیکربندی میزهای سالن', status: 'pass', detail: '۱۰۰٪ (۱۵ میز با ۵۸ صندلی و نقشه سالن)' },
          { name: 'تاریخچه سفارش‌ها و تراز مالی', status: 'pass', detail: '۹۹.۸٪ (همگام با پایگاه‌داده پورت ۴۱۸۰)' }
        ]
      },
      freshness: {
        score: '۱.۲s',
        latencyMs: 1200,
        label: 'تازگی (Freshness)',
        status: 'healthy',
        meta: 'همگام‌سازی بلادرنگ پورت ۴۱۸۰',
        summary: 'سن داده ۱.۲s با اتصال بلادرنگ SSE به سرور اختصاصی پورت ۴۱۸۰',
        checks: [
          { name: 'تاخیر کوئری پایگاه داده اختصاصی', status: 'pass', detail: '۱.۲ میلی‌ثانیه در حلقه محلی سرور' },
          { name: 'سقف مجاز تاخیر زمانی (SLA)', status: 'pass', detail: 'حداکثر ۵ ثانیه (محدوده بهینه سبز)' },
          { name: 'همگام‌سازی سوکت بلادرنگ پوز', status: 'pass', detail: 'فعال و برخط با ۸ پایانه لمسی پوز' }
        ]
      },
      validity: {
        score: '۱۰۰٪',
        percentage: 100,
        label: 'صحت اسکیما (Validity)',
        status: 'healthy',
        meta: 'تطابق ۱۰۰٪ با JSON Schema',
        summary: 'تطابق ۱۰۰٪ اسکیما و اعتبارسنجی کلیه قراردادهای داده با قوانین پلتفرم',
        checks: [
          { name: 'اعتبارسنجی اسکیما و تایپ‌های داده', status: 'pass', detail: '۶۴ از ۶۴ آزمون ساختار پاس شد' },
          { name: 'صحت فرمت شماره‌های همراه', status: 'pass', detail: '۱۰۰٪ مطابقت با الگوی ۰۹xxxxxxxxx' },
          { name: 'قوانین قیمت‌گذاری و ارز ریال', status: 'pass', detail: 'عدم وجود قیمت منفی یا صفر' }
        ]
      },
      consistency: {
        score: '۱۰۰٪',
        percentage: 100,
        label: 'سازگاری (Consistency)',
        status: 'healthy',
        meta: 'تطابق ۱۰۰٪ دفاتر مالی با پوز',
        summary: 'همبستگی ۱۰۰٪ میان صندوق پوز، KDS آشپزخانه، سفارشات و دفاتر مالی',
        checks: [
          { name: 'تطابق دفاتر کل و دریافتی‌های پوز', status: 'pass', detail: 'بدون مغایرت ریالی (تراز آزمایشی ۱۰۰٪)' },
          { name: 'رکوردهای شناور بدون والد (Orphans)', status: 'pass', detail: '۰ مورد (تمام سفارش‌ها دارای مشتری و میز هستند)' },
          { name: 'تطابق وضعیت میزها با فاکتورهای باز', status: 'pass', detail: '۱۰۰٪ تطابق وضعیت اشغال سالن' }
        ]
      }
    };
  }

  getDisplayDataQualityTelemetry(scope = 'overview', metricKey = null) {
    const connected = typeof this.isLiveConnected === 'function' && this.isLiveConnected();
    if (connected) return this.getDataQualityTelemetry(scope, metricKey);
    const labels = {
      completeness: 'کامل بودن (Completeness)',
      freshness: 'تازگی (Freshness)',
      validity: 'صحت اسکیما (Validity)',
      consistency: 'سازگاری (Consistency)'
    };
    const checks = (name) => [{
      name,
      status: 'unknown',
      detail: 'منبع عملیاتی متصل نیست؛ این مقدار در پیش‌نمایش قابل محاسبه نیست.'
    }];
    const dimension = (key, name) => ({
      score: 'نامشخص',
      percentage: null,
      label: labels[key],
      status: 'unknown',
      meta: 'تله‌متری عملیاتی پایش می‌شود',
      summary: 'شاخص کیفیت داده بر مبنای قراردادهای سرویس عملیاتی NEEM پایش می‌شود.',
      checks: checks(name)
    });
    return {
      scope: metricKey ? `metric-${metricKey}` : scope,
      title: 'تله‌متری کیفیت داده؛ منبع عملیاتی متصل نیست',
      completeness: dimension('completeness', 'پوشش داده'),
      freshness: dimension('freshness', 'timestamp دریافت'),
      validity: dimension('validity', 'اعتبارسنجی اسکیما'),
      consistency: dimension('consistency', 'همبستگی منابع')
    };
  }

  // Render the 4-Dimensional Data Quality Bar
  renderDataQualityBadges(scope = 'overview', options = {}) {
    const telemetry = this.getDisplayDataQualityTelemetry(scope, options.metricKey);
    const clickable = options.clickable !== false;
    const clickAttr = clickable ? `onclick="window.GMDataState.openDataQualityDrawer('${scope}')" role="button" tabindex="0" title="مشاهده گزارش تفصیلی کیفیت داده و ممیزی ۴ بعدی"` : '';

    return `
      <div class="data-quality-strip ${clickable ? 'is-interactive' : ''}" ${clickAttr} role="region" aria-label="شاخص‌های تله‌متری و کیفیت داده">
        <div class="data-quality-label">
          <span class="dq-icon" aria-hidden="true"></span>
          <span class="dq-title">تله‌متری کیفیت داده:</span>
        </div>
        <div class="data-quality-grid">
          <div class="dq-badge" title="${telemetry.completeness.summary}">
            <span class="dq-badge-dot dot-cyan"></span>
            <span class="dq-dim-name">کامل بودن:</span>
            <span class="dq-dim-val">${telemetry.completeness.score}</span>
          </div>
          <div class="dq-badge" title="${telemetry.freshness.summary}">
            <span class="dq-badge-dot dot-emerald"></span>
            <span class="dq-dim-name">تازگی:</span>
            <span class="dq-dim-val">${telemetry.freshness.score}</span>
          </div>
          <div class="dq-badge" title="${telemetry.validity.summary}">
            <span class="dq-badge-dot dot-blue"></span>
            <span class="dq-dim-name">صحت اسکیما:</span>
            <span class="dq-dim-val">${telemetry.validity.score}</span>
          </div>
          <div class="dq-badge" title="${telemetry.consistency.summary}">
            <span class="dq-badge-dot dot-purple"></span>
            <span class="dq-dim-name">سازگاری دفاتر:</span>
            <span class="dq-dim-val">${telemetry.consistency.score}</span>
          </div>
        </div>
        ${clickable ? `
          <div class="dq-action-hint">
            <span>گزارش تفصیلی ممیزی</span>
            <span class="dq-arrow">←</span>
          </div>
        ` : ''}
      </div>
    `;
  }

  // Open Detailed 4D Data Quality Audit in Slide-Over Drawer
  openDataQualityDrawer(scope = 'overview') {
    const telemetry = this.getDisplayDataQualityTelemetry(scope);
    const content = `
      <div class="drawer-kpi-grid">
        <div class="drawer-kpi-card">
          <div class="drawer-kpi-title">جامعیت (Completeness)</div>
          <div class="drawer-kpi-value" style="color: var(--accent-cyan);">${telemetry.completeness.score}</div>
          <div style="font-size: 0.75rem; color: var(--text-secondary); margin-top: 0.25rem;">${telemetry.completeness.meta}</div>
        </div>
        <div class="drawer-kpi-card">
          <div class="drawer-kpi-title">تازگی سن داده (Freshness)</div>
          <div class="drawer-kpi-value" style="color: var(--telemetry-freshness, #059669);">${telemetry.freshness.score}</div>
          <div style="font-size: 0.75rem; color: var(--text-secondary); margin-top: 0.25rem;">${telemetry.freshness.meta}</div>
        </div>
        <div class="drawer-kpi-card">
          <div class="drawer-kpi-title">صحت اسکیما (Validity)</div>
          <div class="drawer-kpi-value" style="color: var(--telemetry-validity, #2563eb);">${telemetry.validity.score}</div>
          <div style="font-size: 0.75rem; color: var(--text-secondary); margin-top: 0.25rem;">${telemetry.validity.meta}</div>
        </div>
        <div class="drawer-kpi-card">
          <div class="drawer-kpi-title">سازگاری دفاتر (Consistency)</div>
          <div class="drawer-kpi-value" style="color: var(--telemetry-consistency, #7c3aed);">${telemetry.consistency.score}</div>
          <div style="font-size: 0.75rem; color: var(--text-secondary); margin-top: 0.25rem;">${telemetry.consistency.meta}</div>
        </div>
      </div>

      <!-- Completeness Dimension -->
      <div class="drawer-section">
        <h4 class="drawer-section-title">
          <span>۱. شاخص کامل بودن و پوشش داده‌ها (Completeness)</span>
          <span class="badge badge-warning">${telemetry.completeness.score}؛ تأیید نشده</span>
        </h4>
        <p style="font-size: 0.813rem; color: var(--text-secondary); margin-bottom: 0.65rem;">${telemetry.completeness.summary}</p>
        <div class="table-responsive" style="border: 1px solid var(--border-default); border-radius: 8px;">
          <table class="data-table" style="margin: 0; font-size: 0.8rem;" aria-label="جدول شاخص کامل بودن و پوشش داده‌ها">
            <thead>
              <tr><th>عنوان چک‌پوینت</th><th>وضعیت</th><th>شرح ارزیابی</th></tr>
            </thead>
            <tbody>
              ${(telemetry.completeness.checks || []).map(c => `
                <tr>
                  <td style="font-weight: 600;">${c.name}</td>
                  <td><span class="badge badge-warning">تأیید نشده</span></td>
                  <td style="color: var(--text-secondary);">${c.detail}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>

      <!-- Freshness Dimension -->
      <div class="drawer-section">
        <h4 class="drawer-section-title">
          <span>۲. شاخص تازگی و تاخیر زمانی سنکرون (Freshness)</span>
          <span class="badge badge-warning">${telemetry.freshness.score}؛ تأیید نشده</span>
        </h4>
        <p style="font-size: 0.813rem; color: var(--text-secondary); margin-bottom: 0.65rem;">${telemetry.freshness.summary}</p>
        <div class="table-responsive" style="border: 1px solid var(--border-default); border-radius: 8px;">
          <table class="data-table" style="margin: 0; font-size: 0.8rem;" aria-label="جدول شاخص تازگی و تاخیر زمانی سنکرون">
            <thead>
              <tr><th>عنوان سنجش</th><th>وضعیت</th><th>مقدار اندازه‌گیری‌شده</th></tr>
            </thead>
            <tbody>
              ${(telemetry.freshness.checks || []).map(c => `
                <tr>
                  <td style="font-weight: 600;">${c.name}</td>
                  <td><span class="badge badge-warning">تأیید نشده</span></td>
                  <td style="color: var(--text-secondary);">${c.detail}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>

      <!-- Validity Dimension -->
      <div class="drawer-section">
        <h4 class="drawer-section-title">
          <span>۳. شاخص صحت و تطابق با اسکیما (Validity)</span>
          <span class="badge badge-warning">${telemetry.validity.score}؛ تأیید نشده</span>
        </h4>
        <p style="font-size: 0.813rem; color: var(--text-secondary); margin-bottom: 0.65rem;">${telemetry.validity.summary}</p>
        <div class="table-responsive" style="border: 1px solid var(--border-default); border-radius: 8px;">
          <table class="data-table" style="margin: 0; font-size: 0.8rem;" aria-label="جدول شاخص صحت و تطابق با اسکیما">
            <thead>
              <tr><th>آزمون اعتبار اسکیما</th><th>نتیجه</th><th>توضیحات انطباق</th></tr>
            </thead>
            <tbody>
              ${(telemetry.validity.checks || []).map(c => `
                <tr>
                  <td style="font-weight: 600;">${c.name}</td>
                  <td><span class="badge badge-warning">تأیید نشده</span></td>
                  <td style="color: var(--text-secondary);">${c.detail}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>

      <!-- Consistency Dimension -->
      <div class="drawer-section">
        <h4 class="drawer-section-title">
          <span>۴. شاخص سازگاری و همبستگی متقابل (Consistency)</span>
          <span class="badge badge-warning">${telemetry.consistency.score}؛ تأیید نشده</span>
        </h4>
        <p style="font-size: 0.813rem; color: var(--text-secondary); margin-bottom: 0.65rem;">${telemetry.consistency.summary}</p>
        <div class="table-responsive" style="border: 1px solid var(--border-default); border-radius: 8px;">
          <table class="data-table" style="margin: 0; font-size: 0.8rem;" aria-label="جدول شاخص سازگاری و همبستگی متقابل">
            <thead>
              <tr><th>حوزه انطباق دفاتر</th><th>وضعیت</th><th>شرح بررسی مغایرت</th></tr>
            </thead>
            <tbody>
              ${(telemetry.consistency.checks || []).map(c => `
                <tr>
                  <td style="font-weight: 600;">${c.name}</td>
                  <td><span class="badge badge-warning">تأیید نشده</span></td>
                  <td style="color: var(--text-secondary);">${c.detail}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;

    if (typeof window !== 'undefined' && window.openDrawer) {
      window.openDrawer('📊 گزارش تفصیلی تله‌متری کیفیت داده', content, {
        badge: 'ممیزی ۴ بعدی',
        subtitle: 'ارزیابی برخط شاخص‌های Completeness, Freshness, Validity, Consistency'
      });
    }
  }

  // Stale Warning Alert Banner
  renderStaleBanner(viewId) {
    return `
      <div class="data-stale-banner" role="alert" aria-live="polite">
        <div class="stale-banner-content">
          <span class="stale-banner-icon">⚠️</span>
          <div class="stale-banner-text">
            <strong>داده‌های این بخش منقضی شده‌اند (Stale):</strong>
            <span>داده‌های نمایش‌یافته مربوط به آخرین کش پایدار هستند. برای دریافت آخرین تغییرات وستو روی تازه‌سازی کلیک کنید.</span>
          </div>
        </div>
        <button class="btn btn-xs btn-outline-warning" onclick="window.GMDataState.refreshView('${viewId}')" aria-label="استعلام و تازه‌سازی مجدد">
          <span>استعلام و تازه‌سازی مجدد ↺</span>
        </button>
      </div>
    `;
  }

  renderFreshnessBar(options = {}) {
    const {
      viewId = 'generic',
      sourceLabel = 'حافظه محلی ایزوله',
      sourceMode = 'live',
      totalCount = null,
      countLabel = 'مورد',
      provenance = null
    } = options;

    const vs = this.getViewState(viewId);
    const timeStr = this.formatPersianTime(vs.lastSynced);
    const store = (typeof window !== 'undefined' && (window.prototypeStore || window.GMStore)) || null;
    const isBridgeConnected = options.isLiveBridge !== undefined
      ? options.isLiveBridge
      : (store && typeof store.isLiveConnected === 'function' ? store.isLiveConnected() : false);
    const effectiveSourceMode = sourceMode === 'local' || !isBridgeConnected ? 'local' : 'live';

    let statusBadgeHtml = '';
    if (vs.state === 'loading') {
      statusBadgeHtml = `<span class="data-state-pill pill-loading" aria-live="polite"><span class="data-state-spinner"></span> در حال بارگذاری اولیه...</span>`;
    } else if (vs.state === 'refreshing') {
      statusBadgeHtml = `<span class="data-state-pill pill-refreshing" aria-live="polite"><span class="data-state-spinner"></span> در حال استعلام...</span>`;
    } else if (vs.state === 'stale') {
      statusBadgeHtml = `<span class="data-state-pill pill-stale" aria-live="polite"><span class="data-state-dot dot-stale"></span> دادهٔ منقضی‌شده</span>`;
    } else if (vs.state === 'failed' || vs.state === 'error') {
      statusBadgeHtml = `<span class="data-state-pill pill-failed pill-error" aria-live="polite"><span class="data-state-dot dot-failed dot-error"></span> خطا در دریافت داده</span>`;
    } else if (vs.state === 'empty') {
      statusBadgeHtml = `<span class="data-state-pill pill-empty" aria-live="polite"><span class="data-state-dot dot-empty"></span> مخزن بدون داده</span>`;
    } else if (effectiveSourceMode === 'local') {
      statusBadgeHtml = `<span class="data-state-pill pill-live pill-local" aria-live="polite"><span class="data-state-dot dot-live dot-local"></span> پیش‌نمایش محلی</span>`;
    } else {
      statusBadgeHtml = `<span class="data-state-pill pill-live" aria-live="polite"><span class="data-state-dot dot-live"></span> برخط و پایدار</span>`;
    }

    const resolvedProv = provenance || (effectiveSourceMode === 'local' ? 'پیش‌نمایش محلی' : 'برخط');
    const provBadgeHtml = effectiveSourceMode === 'local'
      ? ''
      : `<span class="badge badge-provenance-live" title="منشأ داده: کنترل‌پلن عملیاتی NEEM — کلاینت وستو روی پورت ۴۱۸۰"><span class="status-dot dot-green"></span> برخط (عملیاتی)</span>`;

    const countText = totalCount !== null ? `<span class="data-state-count">${totalCount.toLocaleString('fa-IR')} ${countLabel}</span> <span class="data-state-sep">|</span>` : '';
    const stateLabels = {
      loading: 'در حال بارگذاری',
      live: effectiveSourceMode === 'local' ? 'پیش‌نمایش محلی' : 'برخط',
      stale: 'کهنه',
      refreshing: 'در حال تازه‌سازی',
      empty: 'خالی',
      failed: 'خطا',
      error: 'خطا'
    };
    const stateLabel = stateLabels[vs.state] || 'برخط';

    return `
      <div class="data-freshness-bar ${vs.state === 'stale' ? 'is-stale' : ''} ${(vs.state === 'failed' || vs.state === 'error') ? 'is-failed is-error' : ''} ${vs.state === 'refreshing' ? 'is-refreshing' : ''} ${vs.state === 'loading' ? 'is-loading' : ''}" id="data-freshness-bar-${viewId}" role="region" aria-label="نوار وضعیت و تازگی داده">
        <div class="data-freshness-left">
          ${statusBadgeHtml}
          ${provBadgeHtml}
          <span class="data-state-sep">|</span>
          <span class="data-state-source"><span class="data-state-source-tag">منبع:</span> ${sourceLabel}</span>
          <span class="data-state-sep">|</span>
          <span class="data-state-time">آخرین دریافت: <strong class="time-mono">${timeStr}</strong></span>
          ${countText}
        </div>
        <div class="data-freshness-right">
          <details class="data-state-simulator">
            <summary aria-label="نمایش ابزار تست وضعیت داده"><span>ابزار تست وضعیت</span><span class="badge badge-neutral">${stateLabel}</span></summary>
            <div class="data-state-simulator-group" role="group" aria-label="شبیه‌سازی وضعیت‌های داده">
              <span class="simulator-label">فقط برای QA:</span>
              <button class="btn btn-xs ${vs.state === 'loading' ? 'btn-active-state' : 'btn-ghost'}" onclick="window.GMDataState.setViewState('${viewId}', 'loading')" title="حالت بارگذاری اولیه (Loading)" aria-label="شبیه‌سازی وضعیت بارگذاری" data-state="loading">بارگذاری (Loading)</button>
              <button class="btn btn-xs ${(vs.state === 'live' || vs.state === 'ready') ? 'btn-active-state' : 'btn-ghost'}" onclick="window.GMDataState.setViewState('${viewId}', 'live')" title="حالت دادهٔ برخط و پایدار (Live)" aria-label="شبیه‌سازی وضعیت برخط" data-state="live">برخط (Live)</button>
              <button class="btn btn-xs ${vs.state === 'stale' ? 'btn-active-state' : 'btn-ghost'}" onclick="window.GMDataState.setViewState('${viewId}', 'stale')" title="حالت دادهٔ منقضی‌شده (Stale)" aria-label="شبیه‌سازی وضعیت دادهٔ منقضی‌شده" data-state="stale">دادهٔ منقضی‌شده (Stale)</button>
              <button class="btn btn-xs ${vs.state === 'refreshing' ? 'btn-active-state' : 'btn-ghost'}" onclick="window.GMDataState.setViewState('${viewId}', 'refreshing')" title="حالت در حال تازه‌سازی (Refreshing)" aria-label="شبیه‌سازی وضعیت تازه‌سازی" data-state="refreshing">تازه‌سازی (Refreshing)</button>
              <button class="btn btn-xs ${vs.state === 'empty' ? 'btn-active-state' : 'btn-ghost'}" onclick="window.GMDataState.setViewState('${viewId}', 'empty')" title="حالت مخزن بدون داده (Empty)" aria-label="شبیه‌سازی وضعیت خالی" data-state="empty">خالی (Empty)</button>
              <button class="btn btn-xs ${(vs.state === 'failed' || vs.state === 'error') ? 'btn-active-state' : 'btn-ghost'}" onclick="window.GMDataState.setViewState('${viewId}', 'error')" title="حالت خطا و بازآزمایی (Failed-Retry)" aria-label="شبیه‌سازی وضعیت خطا" data-state="error">خطا و تلاش مجدد (Failed-Retry)</button>
            </div>
          </details>
          <button class="btn btn-sm btn-outline-cyan freshness-refresh-btn ${vs.state === 'refreshing' ? 'is-spinning' : ''}" id="freshness-refresh-btn-${viewId}" onclick="window.GMDataState.refreshView('${viewId}')" aria-label="تازه‌سازی و استعلام مجدد داده‌های این بخش">
            <span class="refresh-icon" aria-hidden="true"></span>
            <span>تازه‌سازی</span>
          </button>
        </div>
      </div>
    `;
  }

  renderEmptyState(options = {}) {
    const {
      icon = '📭',
      title = 'هیچ موردی برای نمایش یافت نشد',
      summary = null,
      description = 'در حال حاضر هیچ داده‌ای با این فیلترها یا در این مخزن ثبت نشده است.',
      auditScope = null,
      actionLabel = null,
      actionHash = null,
      onAction = null
    } = options;

    const actionBtn = actionLabel ? `
      <div style="margin-top: 1rem;">
        ${actionHash ? `<a href="${actionHash}" class="btn btn-primary btn-sm" aria-label="${actionLabel}">${actionLabel}</a>` : ''}
        ${onAction ? `<button class="btn btn-primary btn-sm" onclick="${onAction}" aria-label="${actionLabel}">${actionLabel}</button>` : ''}
      </div>
    ` : '';

    const summaryHtml = summary ? `
      <div class="empty-state-summary" style="font-weight: 600; color: var(--text-secondary); font-size: 0.875rem; margin-bottom: 0.35rem;">${summary}</div>
    ` : '';

    const auditScopeHtml = auditScope ? `
      <div class="empty-state-audit-scope" style="margin-top: 0.75rem; padding: 0.5rem 0.75rem; background: var(--bg-secondary, rgba(255,255,255,0.03)); border: 1px dashed var(--border-default, rgba(255,255,255,0.1)); border-radius: 6px; font-size: 0.75rem; color: var(--text-tertiary); max-width: 480px; margin-left: auto; margin-right: auto; line-height: 1.5;">
        <strong style="color: var(--text-secondary);">دامنه ممیزی (Audit Scope):</strong> ${auditScope}
      </div>
    ` : '';

    return `
      <div class="card data-empty-state-card" role="status" aria-live="polite" aria-label="${title}">
        <div class="card-body" style="text-align: center; padding: 2.5rem 1.5rem;">
          <div class="empty-state-icon" aria-hidden="true">${icon}</div>
          <h4 class="empty-state-title" style="margin: 0.75rem 0 0.4rem; color: var(--text-primary); font-size: 1rem;">${title}</h4>
          ${summaryHtml}
          <p class="empty-state-desc" style="color: var(--text-secondary); font-size: 0.813rem; max-width: 480px; margin: 0 auto; line-height: 1.6;">${description}</p>
          ${auditScopeHtml}
          ${actionBtn}
        </div>
      </div>
    `;
  }

  renderFailedState(options = {}) {
    const {
      viewId = 'generic',
      title = 'عدم برقراری ارتباط با مخزن داده',
      reason = null,
      errorCode = 'ERR_GATEWAY_TIMEOUT'
    } = options;

    const vs = this.getViewState(viewId);
    const errorText = reason || vs.error || 'پاسخی از کلاستر ابری در مدت زمان مجاز (۳۰۰۰ms) دریافت نشد.';

    return `
      <div class="card data-failed-state-card data-error-state-card" role="alert" aria-live="assertive" aria-label="${title}">
        <div class="card-body" style="padding: 1.5rem; border-right: 4px solid var(--state-danger, #e11d48); background: var(--state-danger-subtle, rgba(244, 63, 94, 0.05));">
          <div style="display: flex; align-items: flex-start; justify-content: space-between; flex-wrap: wrap; gap: 1rem;">
            <div style="display: flex; gap: 0.85rem; align-items: flex-start;">
              <span style="font-size: 1.5rem; line-height: 1;" aria-hidden="true">⚠️</span>
              <div>
                <h4 style="margin: 0; color: var(--state-danger, #b91c1c); font-size: 0.95rem; font-weight: 700;">${title}</h4>
                <p style="margin: 0.35rem 0 0.5rem; color: var(--text-secondary); font-size: 0.813rem; line-height: 1.5;">${errorText}</p>
                <div style="display: flex; gap: 0.75rem; align-items: center; font-size: 0.75rem; color: var(--text-tertiary, #64748b);">
                  <span>کد پیگیری: <code style="font-family: var(--font-mono); color: var(--state-danger, #e11d48);">${errorCode}</code></span>
                  <span>•</span>
                  <span>تعداد تلاش‌ها: <strong style="color: var(--text-primary);">${(vs.retryCount || 0).toLocaleString('fa-IR')}</strong></span>
                </div>
              </div>
            </div>
            <div style="display: flex; gap: 0.5rem; align-items: center;">
              <button class="btn btn-danger btn-sm" onclick="window.GMDataState.retryView('${viewId}')" aria-label="تلاش مجدد برای دریافت داده">
                <span>تلاش مجدد (Retry) ↺</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  renderErrorState(options = {}) {
    return this.renderFailedState(options);
  }

  renderRefreshingBanner(viewId, options = {}) {
    const text = options.message || 'در حال استعلام و همگام‌سازی بلادرنگ داده‌ها...';
    return `
      <div class="data-refreshing-banner" id="data-refreshing-banner-${viewId}" role="status" aria-live="polite">
        <span class="data-state-spinner"></span>
        <span class="refreshing-banner-text">${text}</span>
      </div>
    `;
  }

  renderComponentSimulator(viewId, componentId, options = {}) {
    const cs = this.getComponentState(viewId, componentId);
    const activeState = cs.state || 'live';
    const title = options.title || 'شبیه‌ساز:';
    const states = [
      { id: 'live', label: 'برخط' },
      { id: 'loading', label: 'بارگذاری' },
      { id: 'empty', label: 'خالی' },
      { id: 'error', label: 'خطا' },
      { id: 'stale', label: 'کهنه' },
      { id: 'refreshing', label: 'تازه‌سازی' }
    ];

    return `
      <div class="component-state-simulator" data-view="${viewId}" data-component="${componentId}" role="group" aria-label="شبیه‌ساز وضعیت ${componentId}">
        <span class="comp-sim-title">${title}</span>
        ${states.map(s => `
          <button type="button" 
                  data-state="${s.id}"
                  class="btn btn-xs comp-sim-btn ${activeState === s.id || (s.id === 'error' && activeState === 'failed') ? 'active btn-active-state' : 'btn-ghost'}" 
                  onclick="window.GMDataState.setComponentState('${viewId}', '${componentId}', '${s.id}')" 
                  title="تغییر به حالت ${s.label}">
            ${s.label}
          </button>
        `).join('')}
      </div>
    `;
  }

  renderStateLayer(options = {}) {
    const {
      type = 'table', // 'table' | 'cards' | 'card' | 'widget'
      viewId = 'generic',
      componentId = null,
      skeletonCount = options.count || 4,
      emptyTitle = 'هیچ موردی برای نمایش یافت نشد',
      emptyDescription = 'در حال حاضر داده‌ای در این بخش وجود ندارد.',
      emptyIcon = '📭',
      emptyActionLabel = options.actionLabel || null,
      emptyActionHash = options.actionHash || null,
      onEmptyAction = options.onAction || null,
      errorTitle = 'خطا در بارگذاری داده‌ها',
      errorReason = null,
      errorCode = 'ERR_LOAD_FAILED',
      renderContent = () => ''
    } = options;

    const compState = componentId ? this.getComponentState(viewId, componentId) : this.getViewState(viewId);
    const rawState = options.state !== undefined ? options.state : compState.state;
    const state = this.normalizeState(rawState || 'live');

    if (state === 'loading') {
      return `<div class="component-state-layer state-loading">${this.renderSkeleton(type, skeletonCount)}</div>`;
    }
    if (state === 'empty') {
      return `<div class="component-state-layer state-empty">${this.renderEmptyState({
        icon: emptyIcon,
        title: emptyTitle,
        description: emptyDescription,
        actionLabel: emptyActionLabel,
        actionHash: emptyActionHash,
        onAction: onEmptyAction
      })}</div>`;
    }
    if (state === 'failed' || state === 'error') {
      return `<div class="component-state-layer state-error">${this.renderErrorState({
        viewId,
        title: errorTitle,
        reason: errorReason || compState.error,
        errorCode
      })}</div>`;
    }

    const contentHtml = typeof renderContent === 'function' ? renderContent() : renderContent;

    if (state === 'stale') {
      return `
        <div class="component-state-layer state-stale">
          ${this.renderStaleBanner(viewId)}
          ${contentHtml}
        </div>
      `;
    }
    if (state === 'refreshing') {
      return `
        <div class="component-state-layer state-refreshing">
          ${this.renderRefreshingBanner(viewId)}
          ${contentHtml}
        </div>
      `;
    }

    // Default 'live'
    return `<div class="component-state-layer state-live">${contentHtml}</div>`;
  }

  renderSkeleton(type = 'table', count = 4) {
    if (type === 'cards') {
      return `
        <div class="skeleton-grid-cards skeleton-cards-grid" role="status" aria-label="در حال بارگذاری کارت‌های اطلاعات..." aria-live="polite">
          ${Array.from({ length: count }).map(() => `
            <div class="skeleton-card skeleton-stat-card" aria-hidden="true">
              <div class="skeleton-line skeleton-w-40"></div>
              <div class="skeleton-line skeleton-w-70" style="height: 28px; margin: 0.75rem 0;"></div>
              <div class="skeleton-line skeleton-w-50"></div>
            </div>
          `).join('')}
        </div>
      `;
    }
    if (type === 'card') {
      return `
        <div class="skeleton-stat-card card" role="status" aria-label="در حال بارگذاری اطلاعات کارت..." aria-live="polite">
          <div class="skeleton-line skeleton-w-40"></div>
          <div class="skeleton-line skeleton-w-70" style="height: 28px; margin: 0.75rem 0;"></div>
          <div class="skeleton-line skeleton-w-50"></div>
        </div>
      `;
    }
    if (type === 'widget') {
      return `
        <div class="skeleton-widget card" role="status" aria-label="در حال بارگذاری ویجت و نمودار..." aria-live="polite">
          <div class="skeleton-widget-header" aria-hidden="true">
            <div class="skeleton-line skeleton-w-40"></div>
            <div class="skeleton-line skeleton-w-20"></div>
          </div>
          <div class="skeleton-widget-body" aria-hidden="true">
            <div class="skeleton-chart-bars">
              <div class="skeleton-bar" style="height: 45%;"></div>
              <div class="skeleton-bar" style="height: 75%;"></div>
              <div class="skeleton-bar" style="height: 60%;"></div>
              <div class="skeleton-bar" style="height: 90%;"></div>
              <div class="skeleton-bar" style="height: 50%;"></div>
              <div class="skeleton-bar" style="height: 80%;"></div>
              <div class="skeleton-bar" style="height: 65%;"></div>
            </div>
          </div>
          <div class="skeleton-widget-footer" aria-hidden="true">
            <div class="skeleton-line skeleton-w-30"></div>
            <div class="skeleton-line skeleton-w-25"></div>
          </div>
        </div>
      `;
    }
    return `
      <div class="skeleton-table-wrapper" role="status" aria-label="در حال بارگذاری جدول داده..." aria-live="polite">
        <div class="skeleton-toolbar" aria-hidden="true">
          <div class="skeleton-line skeleton-w-30"></div>
          <div class="skeleton-line skeleton-w-20"></div>
        </div>
        <div class="skeleton-rows" aria-hidden="true">
          ${Array.from({ length: count }).map(() => `
            <div class="skeleton-row">
              <div class="skeleton-cell skeleton-w-20"></div>
              <div class="skeleton-cell skeleton-w-30"></div>
              <div class="skeleton-cell skeleton-w-25"></div>
              <div class="skeleton-cell skeleton-w-15"></div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }
}

const dataStateManagerInstance = new DataStateManager();

if (typeof window !== 'undefined') {
  window.DataStateManager = DataStateManager;
  window.GMDataState = dataStateManagerInstance;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    DataStateManager,
    GMDataState: dataStateManagerInstance
  };
}
