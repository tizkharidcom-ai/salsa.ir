/* WESTO Smart Load generated bundle: js/westo-app.smart.js
   Sources: js/persian-format.js, js/i18n.js, js/category-theme.js, js/menu-store.js, js/content-overrides.js, js/theme.js, js/westo-entrance.js, js/entrance-promo-deck.js, js/subcategory-kill-switch.js, js/brand-lockup.js, js/language-switch-rescue.js, js/design-logic-v13.js, js/vendor/gsap.min.js, js/vendor/ScrollTrigger.min.js, js/vendor/SplitText.min.js, js/buttons.js, js/table-cart.js, js/animations.js, js/sounds.js, js/westo-production-v12.js, js/westo-v14.3-ultra-fine.js
*/

/* ===== BEGIN js/persian-format.js ===== */
/* WESTO Persian number formatting — one presentation rule for all amounts. */
(function (global) {
  'use strict';

  const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
  const GROUP_SEPARATOR = '٫';
  const MONEY_FIELD_PATTERN = /(amount|price|cost|fee|salary|rent|payroll|utility|utilities|sales|variable|balance|wallet|topup|charge|revenue|profit|capital|deposit|withdraw|payment|purchase|commission|packaging|minorder|minspend|maximum|minimum|مبلغ|قیمت|هزینه|بها|کارمزد|حقوق|اجاره|فروش|درآمد|سود|سرمایه|موجودی|شارژ|خرید|دریافت|پرداخت|تخفیف|مالیات|ارزش)/i;
  const NON_MONEY_FIELD_PATTERN = /(quantity|qty|count|headcount|party|points|percent|percentage|vatpercent|duration|days|hours|minutes|month|year|port|priority|stock|reorder|yield|تعداد|مقدار|نفر|امتیاز|درصد|زمان|روز|ساعت|ماه|سال|پورت|اولویت|موجودی اولیه|نقطه سفارش|بازده)/i;

  function toFaDigits(value) {
    return String(value ?? '').replace(/[0-9]/g, (digit) => FA_DIGITS[Number(digit)]);
  }

  function toNumber(value) {
    if (typeof value === 'number') return value;
    let normalized = String(value ?? '')
      .replace(/[۰-۹]/g, (digit) => String(FA_DIGITS.indexOf(digit)))
      .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
      .replace(/تومان|ریال/g, '')
      .replace(/[٬,]/g, '')
      .trim();
    if (/^-?\d{1,3}(?:٫\d{3})+$/.test(normalized)) normalized = normalized.replace(/٫/g, '');
    else normalized = normalized.replace('٫', '.');
    return Number(normalized);
  }

  function formatMoneyInput(value) {
    if (value === null || value === undefined || String(value).trim() === '') return '';
    const normalized = String(value)
      .replace(/[۰-۹]/g, (digit) => String(FA_DIGITS.indexOf(digit)))
      .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
      .replace(/[^0-9-]/g, '');
    if (!normalized || normalized === '-') return normalized;
    const sign = normalized.startsWith('-') ? '-' : '';
    const digits = normalized.replace(/-/g, '').replace(/^0+(?=\d)/, '') || '0';
    return toFaDigits(Number(`${sign}${digits}`).toLocaleString('en-US'))
      .replace(/,/g, GROUP_SEPARATOR);
  }

  function isMoneyInput(input) {
    if (!input || input.nodeType !== 1 || input.tagName !== 'INPUT') return false;
    if (input.dataset.moneyInput === 'true') return true;
    if (input.dataset.moneyInput === 'false' || input.type === 'date' || input.type === 'time' || input.type === 'tel') return false;
    // The Shamsi picker upgrades native date inputs to text inputs. Keep its
    // Persian date display (slashes) out of money grouping, even when the
    // surrounding label contains words such as «سود» or «هزینه».
    if (input.dataset.nativeDateType || input.dataset.shamsiPicker !== undefined || input.classList.contains('shamsi-date-input')) return false;
    const label = input.closest('label')?.textContent || '';
    const identity = [input.name, input.id, input.className].filter(Boolean).join(' ');
    if (/(vendor|supplier|seller|customer|person|spender|receiver|طرف حساب|فروشنده|تأمین‌کننده|تحویل‌گیرنده)/i.test(identity)) return false;
    const source = [identity, input.getAttribute('data-price'), input.getAttribute('data-me-price'), input.placeholder, input.getAttribute('aria-label'), label].filter(Boolean).join(' ');
    return MONEY_FIELD_PATTERN.test(source) && !NON_MONEY_FIELD_PATTERN.test(source);
  }

  function formatMoneyInputNode(input) {
    if (!isMoneyInput(input)) return;
    input.dataset.moneyInput = 'true';
    input.setAttribute('inputmode', 'numeric');
    if (input.type === 'number') input.type = 'text';
    if (input.value) input.value = formatMoneyInput(input.value);
    if (input.dataset.moneyBound === 'true') return;
    input.dataset.moneyBound = 'true';
    input.addEventListener('input', () => {
      const before = input.value;
      const caret = input.selectionStart ?? before.length;
      const digitsBeforeCaret = before.slice(0, caret).replace(/[^0-9۰-۹٠-٩]/g, '').length;
      const formatted = formatMoneyInput(before);
      // React-controlled fields must see an ASCII value in their onChange handler;
      // the microtask restores the Persian presentation after that handler runs.
      input.value = before.trim() ? String(toNumber(before) || 0) : '';
      queueMicrotask(() => { input.value = formatted; });
      if (document.activeElement === input) {
        let position = 0;
        let seen = 0;
        while (position < formatted.length && seen < digitsBeforeCaret) {
          if (/[0-9۰-۹٠-٩]/.test(formatted[position])) seen += 1;
          position += 1;
        }
        try { input.setSelectionRange(position, position); } catch {}
      }
    });
    input.addEventListener('blur', () => { input.value = formatMoneyInput(input.value); });
  }

  function bindMoneyInputs(root = document) {
    if (!root?.querySelectorAll) return;
    if (root.matches?.('input')) formatMoneyInputNode(root);
    root.querySelectorAll('input').forEach(formatMoneyInputNode);
  }

  function installMoneyInputBinding() {
    if (typeof document === 'undefined' || document.documentElement.dataset.westoMoneyBinding === 'true') return;
    document.documentElement.dataset.westoMoneyBinding = 'true';
    bindMoneyInputs(document);
    new MutationObserver((records) => records.forEach((record) => record.addedNodes.forEach((node) => {
      if (node.nodeType === 1) bindMoneyInputs(node);
    }))).observe(document.documentElement, { childList: true, subtree: true });
    document.addEventListener('formdata', (event) => {
      const form = event.target;
      if (!form?.elements) return;
      [...form.elements].filter(isMoneyInput).forEach((input) => {
        if (input.name) event.formData.set(input.name, String(toNumber(input.value) || 0));
      });
    });
  }

  function isPersianLocale(locale) {
    return /^(fa|fa[-_])/i.test(String(locale || 'fa-IR'));
  }

  function formatNumber(value, options = {}) {
    const numeric = toNumber(value);
    if (!Number.isFinite(numeric)) return options.invalid ?? '—';

    const {
      locale = 'fa-IR',
      invalid: _invalid,
      ...intlOptions
    } = options;
    const formatted = new Intl.NumberFormat(
      isPersianLocale(locale) ? 'en-US' : locale,
      intlOptions,
    ).format(numeric);
    if (!isPersianLocale(locale)) return formatted;
    return toFaDigits(formatted).replace(/,/g, GROUP_SEPARATOR).replace(/\./g, GROUP_SEPARATOR);
  }

  function formatAmount(value, { locale = 'fa-IR', unit = 'تومان', ...options } = {}) {
    const formatted = formatNumber(value, { locale, maximumFractionDigits: 0, ...options });
    return unit ? `${formatted} ${unit}` : formatted;
  }

  global.WestoPersianFormat = Object.freeze({
    number: formatNumber,
    amount: formatAmount,
    parse: toNumber,
    formatMoneyInput,
    bindMoneyInputs,
    toFaDigits,
    groupSeparator: GROUP_SEPARATOR,
  });
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installMoneyInputBinding, { once: true });
    else installMoneyInputBinding();
  }
}(typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : {}));

;/* ===== END js/persian-format.js ===== */

/* ===== BEGIN js/i18n.js ===== */
/* Westo guest i18n — fa | en | ar */
(function (global) {
  const STORAGE_KEY = 'westo_menu_lang';
  // Legacy builds inferred a language from navigator.language and also trusted
  // any old value in STORAGE_KEY. Keep a separate consent marker so a language
  // survives reloads only after the guest has explicitly pressed a language
  // control in this release (or a later one).
  const EXPLICIT_STORAGE_KEY = 'westo_menu_lang_explicit_v1';
  const SUPPORTED = ['fa', 'en', 'ar'];
  const RTL = { fa: true, ar: true, en: false };

  const STRINGS = {
    // Entrance gate
    'eg.tagline': {
      fa: 'کافه و رستوران',
      en: 'Cafe & restaurant',
      ar: 'مقهى ومطعم',
    },
    'eg.taglineLong': {
      fa: 'کافه‌رستوران برای آرامش تو',
      en: 'A café-restaurant for your calm',
      ar: 'مقهى ومطعم لراحتك',
    },
    'eg.subtitleEn': {
      fa: 'کافه و رستوران',
      en: 'Cafe & Restaurant',
      ar: 'مقهى ومطعم',
    },
    'eg.enter': { fa: 'ورود به منو', en: 'Enter the menu', ar: 'الدخول إلى القائمة' },
    'eg.enterWesto': { fa: 'ورود به منو', en: 'Enter the menu', ar: 'الدخول إلى القائمة' },
    'eg.preparing': { fa: 'در حال آماده‌سازی…', en: 'Preparing…', ar: 'جاري التحضير…' },
    'eg.preparingPct': {
      fa: 'آماده‌سازی منو {n}٪',
      en: 'Preparing menu {n}%',
      ar: 'تحضير القائمة {n}٪',
    },
    'eg.entering': { fa: 'ورود به منو…', en: 'Entering the menu…', ar: 'جارٍ الدخول إلى القائمة…' },
    'eg.open': { fa: 'باز است', en: 'Open', ar: 'مفتوح' },
    'eg.closed': { fa: 'بسته است', en: 'Closed', ar: 'مغلق' },
    'eg.statusPreparing': {
      fa: 'در حال آماده‌سازی تجربه…',
      en: 'Preparing experience…',
      ar: 'جاري تجهيز التجربة…',
    },
    'eg.storyLead': {
      fa: 'در حال آماده‌سازی تجربه شما…',
      en: 'Preparing your experience…',
      ar: 'جاري تجهيز تجربتك…',
    },
    'eg.step.brew': {
      fa: 'دم‌کردن قهوه',
      en: 'Brewing Coffee',
      ar: 'تحضير القهوة',
    },
    'eg.step.world': {
      fa: 'بارگذاری دنیای سه‌بعدی',
      en: 'Loading 3D World',
      ar: 'تحميل العالم ثلاثي الأبعاد',
    },
    'eg.step.menu': {
      fa: 'آماده‌سازی منو',
      en: 'Preparing Menu',
      ar: 'تجهيز القائمة',
    },
    'eg.step.table': {
      fa: 'چیدن میز شما',
      en: 'Setting Your Table',
      ar: 'تجهيز طاولتك',
    },
    'eg.feature.digitalMenu': { fa: 'منو دیجیتال', en: 'Digital menu', ar: 'قائمة رقمية' },
    'eg.feature.onlineOrder': { fa: 'سفارش آنلاین', en: 'Online order', ar: 'طلب أونلاين' },
    'eg.feature.reserveTable': { fa: 'رزرو میز', en: 'Reserve table', ar: 'حجز طاولة' },
    'eg.feature.quickEntry': { fa: 'ورود سریع', en: 'Quick entry', ar: 'دخول سريع' },
    'eg.siteMenu': { fa: 'منوی سایت', en: 'Site menu', ar: 'قائمة الموقع' },
    'eg.venueInfo': { fa: 'اطلاعات مجموعه', en: 'Venue info', ar: 'معلومات المكان' },
    'eg.fullMenu': { fa: 'منوی کامل', en: 'Full menu', ar: 'القائمة الكاملة' },
    'eg.categories': {
      fa: 'دسته‌ها',
      en: 'Categories',
      ar: 'الفئات',
    },
    'eg.hoursInfo': {
      fa: 'ساعت کاری و اطلاعات',
      en: 'Hours & info',
      ar: 'ساعات العمل والمعلومات',
    },
    'eg.login': { fa: 'ورود / ثبت‌نام', en: 'Log in / Sign up', ar: 'تسجيل الدخول / إنشاء حساب' },
    'eg.reserve': { fa: 'رزرو', en: 'Reserve', ar: 'حجز' },
    'eg.hours': { fa: 'ساعت کاری', en: 'Hours', ar: 'ساعات العمل' },
    'eg.about': { fa: 'درباره', en: 'About', ar: 'حول' },
    'eg.aboutBody': {
      fa: 'وستو فضایی برای غذا، نوشیدنی و دورهمی است.',
      en: 'Westo is a place for food, drinks, and gathering.',
      ar: 'وستو مساحة للطعام والمشروبات واللقاءات.',
    },
    'eg.contact': { fa: 'تماس', en: 'Contact', ar: 'اتصل' },
    'eg.phone': { fa: 'تماس', en: 'Call', ar: 'اتصال' },
    'eg.map': { fa: 'آدرس', en: 'Location', ar: 'الموقع' },
    'eg.instagram': { fa: 'اینستاگرام', en: 'Instagram', ar: 'إنستغرام' },
    'eg.dock.instagram': { fa: 'اینستاگرام', en: 'Instagram', ar: 'إنستغرام' },
    'eg.dock.phone': { fa: 'تماس با ما', en: 'Contact us', ar: 'اتصل بنا' },
    'eg.dock.map': { fa: 'موقعیت ما', en: 'Our location', ar: 'موقعنا' },
    'eg.dock.reserve': { fa: 'رزرو میز', en: 'Reserve', ar: 'حجز طاولة' },
    'eg.quote': {
      fa: 'هر فنجان قصه‌ای دارد.',
      en: 'Every cup has a story.',
      ar: 'لكل فنجان حكاية.',
    },
    'eg.themeDark': { fa: 'حالت تاریک', en: 'Dark mode', ar: 'الوضع الداكن' },
    'eg.themeLight': { fa: 'حالت روشن', en: 'Light mode', ar: 'الوضع الفاتح' },
    'eg.cityFallback': { fa: 'مشهد', en: 'Mashhad, Iran', ar: 'مشهد' },
    'eg.lang': { fa: 'زبان', en: 'Language', ar: 'اللغة' },
    'eg.aria.login': { fa: 'ورود / ثبت‌نام', en: 'Log in / Sign up', ar: 'تسجيل الدخول' },
    'eg.aria.menu': { fa: 'منوی سایت', en: 'Site menu', ar: 'قائمة الموقع' },
    'eg.aria.lang': { fa: 'انتخاب زبان', en: 'Choose language', ar: 'اختيار اللغة' },
    'eg.address': { fa: 'آدرس', en: 'Address', ar: 'العنوان' },
    'eg.tel': { fa: 'تلفن', en: 'Phone', ar: 'الهاتف' },
    'eg.whatsapp': { fa: 'واتساپ', en: 'WhatsApp', ar: 'واتساب' },
    'eg.website': { fa: 'وب‌سایت', en: 'Website', ar: 'الموقع' },
    'eg.contactSoon': {
      fa: 'اطلاعات تماس به‌زودی تکمیل می‌شود.',
      en: 'Contact details coming soon.',
      ar: 'تفاصيل الاتصال قريبًا.',
    },
    'eg.closedDay': { fa: 'تعطیل', en: 'Closed', ar: 'مغلق' },
    'eg.until': { fa: 'تا {t}', en: 'Until {t}', ar: 'حتى {t}' },
    'eg.fromToday': { fa: 'امروز از {t}', en: 'Today from {t}', ar: 'اليوم من {t}' },

    // Days
    'day.sat': { fa: 'شنبه', en: 'Saturday', ar: 'السبت' },
    'day.sun': { fa: 'یکشنبه', en: 'Sunday', ar: 'الأحد' },
    'day.mon': { fa: 'دوشنبه', en: 'Monday', ar: 'الإثنين' },
    'day.tue': { fa: 'سه‌شنبه', en: 'Tuesday', ar: 'الثلاثاء' },
    'day.wed': { fa: 'چهارشنبه', en: 'Wednesday', ar: 'الأربعاء' },
    'day.thu': { fa: 'پنج‌شنبه', en: 'Thursday', ar: 'الخميس' },
    'day.fri': { fa: 'جمعه', en: 'Friday', ar: 'الجمعة' },

    // Nav / chrome
    'nav.login': { fa: 'ورود', en: 'Log in', ar: 'دخول' },
    'nav.menu': { fa: 'منو', en: 'Menu', ar: 'القائمة' },
    'nav.categories': { fa: 'دسته‌ها', en: 'Categories', ar: 'الفئات' },
    'nav.about': { fa: 'درباره ما', en: 'About Us', ar: 'من نحن' },
    'nav.contact': { fa: 'تماس', en: 'Contact', ar: 'اتصل' },
    'nav.tagline': { fa: 'کافه و رستوران', en: 'Cafe & restaurant', ar: 'مقهى ومطعم' },
    'nav.menuHint': {
      fa: 'فهرست کامل غذاها',
      en: 'Full food menu',
      ar: 'قائمة الطعام الكاملة',
    },
    'nav.categoriesHint': {
      fa: 'مرور دسته‌ها',
      en: 'Browse categories',
      ar: 'تصفح الفئات',
    },
    'nav.aboutHint': {
      fa: 'درباره ما',
      en: 'About Us',
      ar: 'من نحن',
    },
    'nav.loginHint': {
      fa: 'حساب کاربری',
      en: 'Your account',
      ar: 'حسابك',
    },
    'nav.contactWesto': {
      fa: 'تماس با وستو',
      en: 'Contact Westo',
      ar: 'تواصل مع وستو',
    },
    'nav.close': { fa: 'بستن', en: 'Close', ar: 'إغلاق' },
    'nav.theme': { fa: 'تم نمایش', en: 'Display theme', ar: 'مظهر العرض' },
    'nav.themeSystem': { fa: 'سیستم', en: 'System', ar: 'النظام' },
    'nav.themeDark': { fa: 'تیره', en: 'Dark', ar: 'داكن' },
    'nav.themeLight': { fa: 'روشن', en: 'Light', ar: 'فاتح' },
    'nav.reserve': { fa: 'رزرو', en: 'Reserve', ar: 'حجز' },
    'nav.tiktok': { fa: 'تیک‌تاک', en: 'TikTok', ar: 'تيك توك' },
    'nav.instagram': { fa: 'اینستاگرام', en: 'Instagram', ar: 'إنستغرام' },
    'nav.sound': { fa: 'صدا', en: 'Sound', ar: 'الصوت' },
    'nav.sound_on': { fa: 'روشن', en: 'On', ar: 'تشغيل' },
    'nav.sound_off': { fa: 'قطع صدا', en: 'Mute', ar: 'كتم' },
    'nav.sound_play': { fa: 'پخش صدا', en: 'Unmute', ar: 'إلغاء الكتم' },
    'hero.prevCategory': { fa: 'دستهٔ قبلی', en: 'Previous category', ar: 'الفئة السابقة' },
    'hero.nextCategory': { fa: 'دستهٔ بعدی', en: 'Next category', ar: 'الفئة التالية' },
    'pwa.updateReady': {
      fa: 'نسخه جدید برنامه آماده است',
      en: 'A new app version is ready',
      ar: 'يتوفر تحديث جديد للتطبيق',
    },
    'pwa.updateNow': { fa: 'بروزرسانی', en: 'Update', ar: 'تحديث' },
    'pwa.updating': { fa: 'در حال بروزرسانی…', en: 'Updating…', ar: 'جارٍ التحديث…' },
    'pwa.clearing': { fa: 'در حال پاک‌سازی…', en: 'Clearing…', ar: 'جارٍ المسح…' },
    'currency.toman': { fa: 'تومان', en: 'Toman', ar: 'تومان' },
    'site.documentTitle': { fa: 'وستو — منوی کافه و رستوران', en: 'WESTO — Café & Restaurant Menu', ar: 'WESTO — قائمة المقهى والمطعم' },
    'about.documentTitle': { fa: 'درباره ما — وستو', en: 'About Us — WESTO', ar: 'من نحن — WESTO' },
    'legacy.section1': { fa: 'بخش محصول ۱', en: 'Product section 1', ar: 'قسم المنتج 1' },
    'legacy.section2': { fa: 'بخش محصول ۲', en: 'Product section 2', ar: 'قسم المنتج 2' },
    'legacy.section3': { fa: 'بخش محصول ۳', en: 'Product section 3', ar: 'قسم المنتج 3' },
    'legacy.section4': { fa: 'بخش محصول ۴', en: 'Product section 4', ar: 'قسم المنتج 4' },
    'hero.scroll': {
      fa: 'برای دیدن غذاها اسکرول کنید',
      en: 'Scroll to explore dishes',
      ar: 'مرّر لاستكشاف الأطباق',
    },

    // Table / cart
    'cart.title': { fa: 'سبد', en: 'Cart', ar: 'السلة' },
    'cart.empty': {
      fa: 'سبد سفارش خالی است\nاز منو غذا اضافه کنید',
      en: 'Your table is empty\nAdd dishes from the menu',
      ar: 'الطاولة فارغة\nأضف أطباقًا من القائمة',
    },
    'cart.tableNo': { fa: 'شماره میز', en: 'Table number', ar: 'رقم الطاولة' },
    'cart.nameOptional': { fa: 'نام اختیاری', en: 'Name (optional)', ar: 'الاسم (اختياري)' },
    'cart.phone': { fa: 'موبایل', en: 'Mobile', ar: 'الجوال' },
    'cart.pay': { fa: 'روش پرداخت', en: 'Payment', ar: 'طريقة الدفع' },
    'cart.cashier': { fa: 'پرداخت در صندوق', en: 'Pay at counter', ar: 'الدفع عند الصندوق' },
    'cart.online': { fa: 'پرداخت آنلاین', en: 'Pay online', ar: 'دفع إلكتروني' },
    'cart.submit': { fa: 'ثبت سفارش', en: 'Place order', ar: 'تأكيد الطلب' },
    'cart.done': { fa: 'سفارش ثبت شد.', en: 'Order placed.', ar: 'تم تسجيل الطلب.' },
    'cart.add': { fa: 'افزودن', en: 'Add', ar: 'إضافة' },
    'cart.dishesOf': { fa: 'ظروف', en: 'Dishes in', ar: 'أطباق' },
    'cart.dishesHere': {
      fa: 'ظروف این دسته',
      en: 'Dishes in this category',
      ar: 'أطباق هذا القسم',
    },
    'cart.qty': { fa: 'تعداد', en: 'Qty', ar: 'الكمية' },
    'cart.total': { fa: 'جمع', en: 'Total', ar: 'المجموع' },
    'cart.continue': { fa: 'ادامه', en: 'Continue', ar: 'متابعة' },
    'cart.back': { fa: 'بازگشت', en: 'Back', ar: 'رجوع' },
    'cart.callWaiter': { fa: 'فراخوان گارسون', en: 'Call waiter', ar: 'استدعاء النادل' },
    'cart.close': { fa: 'بستن', en: 'Close', ar: 'إغلاق' },
    'cart.name': { fa: 'نام', en: 'Name', ar: 'الاسم' },
    'cart.optional': { fa: 'اختیاری', en: 'optional', ar: 'اختياري' },
    'cart.ph.table': { fa: '۱۲', en: '12', ar: '12' },
    'cart.ph.name': { fa: 'نام شما', en: 'Your name', ar: 'اسمك' },
    'cart.ph.phone': { fa: '0912…', en: '09…', ar: '09…' },
    'cart.dec': { fa: 'کم کردن', en: 'Decrease', ar: 'إنقاص' },
    'cart.inc': { fa: 'زیاد کردن', en: 'Increase', ar: 'زيادة' },
    'cart.remove': { fa: 'حذف از سبد', en: 'Remove from cart', ar: 'إزالة من السلة' },
    'cart.itemsCount': {
      fa: '{n} قلم',
      en: '{n} items',
      ar: '{n} أصناف',
    },
    'cart.product': { fa: 'محصول', en: 'Item', ar: 'صنف' },
    'cart.paymentTitle': { fa: 'پرداخت', en: 'Payment', ar: 'الدفع' },
    'cart.doneTitle': { fa: 'ثبت شد', en: 'Done', ar: 'تم' },
    'cart.needTable': { fa: 'شماره میز را وارد کنید', en: 'Enter your table number', ar: 'أدخل رقم الطاولة' },
    'cart.waiterNote': { fa: 'درخواست حضور گارسون', en: 'Waiter requested', ar: 'طلب حضور النادل' },
    'cart.waiterOk': { fa: 'گارسون خبر شد — کمی صبر کنید.', en: 'The waiter has been notified — please wait a moment.', ar: 'تم إبلاغ النادل — يرجى الانتظار قليلًا.' },
    'cart.waiterFail': { fa: 'فراخوان ثبت نشد', en: 'Could not call the waiter', ar: 'تعذر استدعاء النادل' },
    'cart.submitting': { fa: 'در حال ثبت…', en: 'Placing order…', ar: 'جارٍ تأكيد الطلب…' },
    'cart.submitFail': { fa: 'خطا در ثبت سفارش', en: 'Could not place the order', ar: 'تعذر تسجيل الطلب' },
    'cart.onlineDone': { fa: 'پرداخت آنلاین ثبت شد و سفارش در صف آماده‌سازی است.', en: 'Online payment registered. Your order is now being prepared.', ar: 'تم تسجيل الدفع الإلكتروني والطلب قيد التحضير.' },
    'cart.counterDone': { fa: 'پرداخت در صندوق — هنگام دریافت تسویه کنید.', en: 'Pay at the counter when you collect your order.', ar: 'ادفع عند الصندوق عند استلام طلبك.' },
    'cart.doneKicker': { fa: 'سفارش ثبت شد', en: 'Order placed', ar: 'تم تسجيل الطلب' },
    'cart.tableLabel': { fa: 'میز', en: 'Table', ar: 'الطاولة' },
    'cart.qrContext': { fa: 'سفارش برای میز {n}', en: 'Order for table {n}', ar: 'طلب للطاولة {n}' },
    'cart.qrPrefilled': { fa: 'شماره میز از رمزینه وارد شده است', en: 'Table number was added from the QR code', ar: 'تم إدخال رقم الطاولة من رمز الاستجابة' },
    'cart.feedback': { fa: 'ثبت نظر / NPS', en: 'Leave feedback / NPS', ar: 'أرسل رأيك / NPS' },


    // Online checkout / order workflow
    'checkout.documentTitle': { fa: 'سفارش آنلاین — وستو', en: 'Online Order — WESTO', ar: 'الطلب أونلاين — WESTO' },
    'checkout.backSite': { fa: 'بازگشت به سایت', en: 'Back to site', ar: 'العودة إلى الموقع' },
    'checkout.backMenu': { fa: 'بازگشت به منو', en: 'Back to menu', ar: 'العودة إلى القائمة' },
    'checkout.menuAria': { fa: 'انتخاب غذا', en: 'Choose dishes', ar: 'اختيار الأطباق' },
    'checkout.eyebrow': { fa: 'سفارش آنلاین', en: 'Online order', ar: 'طلب أونلاين' },
    'checkout.chooseFood': { fa: 'انتخاب غذا', en: 'Choose your dishes', ar: 'اختر أطباقك' },
    'checkout.intro': { fa: 'برای داخل مجموعه، تحویل حضوری یا ارسال با پیک.', en: 'Dine in, pick up, or get your order delivered.', ar: 'تناول داخل المكان أو استلام الطلب أو توصيله.' },
    'checkout.categoriesAria': { fa: 'دسته‌های منو', en: 'Menu categories', ar: 'فئات القائمة' },
    'checkout.sideAria': { fa: 'سبد و تکمیل سفارش', en: 'Cart and checkout', ar: 'السلة وإكمال الطلب' },
    'checkout.yourCart': { fa: 'سبد شما', en: 'Your cart', ar: 'سلتك' },
    'checkout.fulfillmentTitle': { fa: 'نحوه دریافت', en: 'Fulfillment', ar: 'طريقة الاستلام' },
    'checkout.ready': { fa: 'آماده', en: 'Ready', ar: 'جاهز' },
    'checkout.fulfillmentAria': { fa: 'نحوه دریافت', en: 'Fulfillment method', ar: 'طريقة الاستلام' },
    'checkout.dineIn': { fa: 'داخل مجموعه', en: 'Dine in', ar: 'داخل المكان' },
    'checkout.pickup': { fa: 'تحویل حضوری', en: 'Pickup', ar: 'استلام' },
    'checkout.delivery': { fa: 'ارسال با پیک', en: 'Delivery', ar: 'توصيل' },
    'checkout.branch': { fa: 'شعبه', en: 'Branch', ar: 'الفرع' },
    'checkout.deliveryZone': { fa: 'محدوده ارسال', en: 'Delivery zone', ar: 'منطقة التوصيل' },
    'checkout.address': { fa: 'آدرس تحویل', en: 'Delivery address', ar: 'عنوان التوصيل' },
    'checkout.instructions': { fa: 'توضیح برای پیک (اختیاری)', en: 'Courier instructions (optional)', ar: 'تعليمات للمندوب (اختياري)' },
    'checkout.paymentMethod': { fa: 'روش پرداخت', en: 'Payment method', ar: 'طريقة الدفع' },
    'checkout.cashierDelivery': { fa: 'پرداخت در صندوق / هنگام تحویل', en: 'Pay at counter / on delivery', ar: 'الدفع عند الصندوق / عند التسليم' },
    'checkout.orderNote': { fa: 'یادداشت سفارش (اختیاری)', en: 'Order note (optional)', ar: 'ملاحظة الطلب (اختياري)' },
    'checkout.initialNote': { fa: 'مبلغ و زمان تحویل با انتخاب روش دریافت به‌روزرسانی می‌شود.', en: 'Price and ETA update with your fulfillment choice.', ar: 'يتم تحديث السعر ووقت الوصول حسب طريقة الاستلام.' },
    'checkout.continuePayment': { fa: 'ادامه به پرداخت', en: 'Continue to payment', ar: 'متابعة إلى الدفع' },
    'checkout.successKicker': { fa: 'سفارش ثبت شد', en: 'Order placed', ar: 'تم تسجيل الطلب' },
    'checkout.pendingPayment': { fa: 'در انتظار پرداخت', en: 'Awaiting payment', ar: 'بانتظار الدفع' },
    'checkout.sandboxConfirm': { fa: 'تکمیل پرداخت آزمایشی', en: 'Complete sandbox payment', ar: 'إكمال الدفع التجريبي' },
    'checkout.emptyCategory': { fa: 'در این دسته محصول فعالی وجود ندارد.', en: 'No active items in this category.', ar: 'لا توجد عناصر متاحة في هذه الفئة.' },
    'checkout.addItem': { fa: 'افزودن {name}', en: 'Add {name}', ar: 'أضف {name}' },
    'checkout.emptyCart': { fa: 'سبد شما هنوز خالی است.', en: 'Your cart is empty.', ar: 'سلتك فارغة.' },
    'checkout.qtyUnit': { fa: 'عدد', en: 'qty', ar: 'عدد' },
    'checkout.subtotal': { fa: 'جمع غذا', en: 'Food subtotal', ar: 'مجموع الطعام' },
    'checkout.deliveryFee': { fa: 'هزینه ارسال', en: 'Delivery fee', ar: 'رسوم التوصيل' },
    'checkout.payable': { fa: 'مبلغ قابل پرداخت', en: 'Amount due', ar: 'المبلغ المستحق' },
    'checkout.minimum': { fa: 'حداقل', en: 'minimum', ar: 'الحد الأدنى' },
    'checkout.noZone': { fa: 'محدوده فعالی وجود ندارد', en: 'No active delivery zone', ar: 'لا توجد منطقة توصيل متاحة' },
    'checkout.calculating': { fa: 'محاسبه…', en: 'Calculating…', ar: 'جارٍ الحساب…' },
    'checkout.eta': { fa: 'حدود {n} دقیقه', en: 'About {n} min', ar: 'حوالي {n} دقيقة' },
    'checkout.deliverySummary': { fa: 'ارسال به {zone}؛ زمان تقریبی حدود {n} دقیقه.', en: 'Delivery to {zone}; ETA about {n} min.', ar: 'التوصيل إلى {zone}؛ الوقت المتوقع حوالي {n} دقيقة.' },
    'checkout.selectedZone': { fa: 'محدوده انتخابی', en: 'selected zone', ar: 'المنطقة المحددة' },
    'checkout.pickupSummary': { fa: 'سفارش برای تحویل حضوری آماده می‌شود.', en: 'Your order will be prepared for pickup.', ar: 'سيتم تجهيز طلبك للاستلام.' },
    'checkout.dineSummary': { fa: 'شماره میز را بررسی کنید؛ سفارش مستقیم به مجموعه می‌رسد.', en: 'Check your table number; the order goes directly to the venue.', ar: 'تحقق من رقم الطاولة؛ سيصل الطلب مباشرة إلى المكان.' },
    'checkout.needsReview': { fa: 'نیاز به بررسی', en: 'Needs review', ar: 'يحتاج إلى مراجعة' },
    'checkout.pendingOnline': { fa: 'در انتظار پرداخت آنلاین', en: 'Awaiting online payment', ar: 'بانتظار الدفع الإلكتروني' },
    'checkout.orderSuccess': { fa: 'سفارش با موفقیت ثبت شد', en: 'Order placed successfully', ar: 'تم تسجيل الطلب بنجاح' },
    'checkout.orderBody': { fa: 'سفارش #{id} با مبلغ {total} ثبت شد.', en: 'Order #{id} was placed for {total}.', ar: 'تم تسجيل الطلب #{id} بمبلغ {total}.' },
    'checkout.deliveryEta': { fa: 'ارسال حدود {n} دقیقه زمان می‌برد.', en: 'Delivery takes about {n} min.', ar: 'يستغرق التوصيل حوالي {n} دقيقة.' },
    'checkout.sandboxSuccess': { fa: 'پرداخت آزمایشی موفق بود', en: 'Sandbox payment successful', ar: 'نجح الدفع التجريبي' },
    'checkout.sandboxBody': { fa: 'پرداخت سفارش #{id} ثبت شد و سفارش وارد صف آماده‌سازی شد.', en: 'Payment for order #{id} was registered and the order entered preparation.', ar: 'تم تسجيل دفع الطلب #{id} وانتقل الطلب إلى التحضير.' },
    'checkout.submitting': { fa: 'در حال ثبت سفارش…', en: 'Placing order…', ar: 'جارٍ تسجيل الطلب…' },
    'checkout.timeout': { fa: 'ارتباط با سرور طولانی شد؛ دوباره تلاش کنید.', en: 'The server took too long. Please try again.', ar: 'استغرق الاتصال بالخادم وقتًا طويلًا. حاول مرة أخرى.' },
    'checkout.loadFail': { fa: 'بارگذاری منو ممکن نشد.', en: 'Could not load the menu.', ar: 'تعذر تحميل القائمة.' },
    'checkout.serverError': { fa: 'خطا در ارتباط با سرور', en: 'Server communication error', ar: 'خطأ في الاتصال بالخادم' },
    'checkout.ph.table': { fa: 'مثلاً ۸', en: 'e.g. 8', ar: 'مثلاً 8' },
    'checkout.ph.address': { fa: 'خیابان، پلاک، طبقه…', en: 'Street, number, floor…', ar: 'الشارع، الرقم، الطابق…' },
    'checkout.ph.instructions': { fa: 'مثلاً تماس قبل از رسیدن', en: 'e.g. call before arrival', ar: 'مثلاً اتصل قبل الوصول' },
    'checkout.ph.note': { fa: 'حساسیت، بدون پیاز، توضیح دیگر…', en: 'Allergy, no onion, other notes…', ar: 'حساسية، بدون بصل، ملاحظات أخرى…' },


    // Authentication
    'auth.documentTitle': { fa: 'ورود — Westo', en: 'Sign in — WESTO', ar: 'تسجيل الدخول — WESTO' },
    'auth.logoAlt': { fa: 'WESTO', en: 'WESTO', ar: 'WESTO' },
    'auth.login': { fa: 'ورود', en: 'Sign in', ar: 'تسجيل الدخول' },
    'auth.phoneIntro': { fa: 'شماره موبایل خود را وارد کنید تا کد تأیید برایتان ارسال شود.', en: 'Enter your mobile number to receive a verification code.', ar: 'أدخل رقم جوالك لتلقي رمز التحقق.' },
    'auth.sendCode': { fa: 'دریافت کد تأیید', en: 'Get verification code', ar: 'إرسال رمز التحقق' },
    'auth.otpTitle': { fa: 'کد تأیید', en: 'Verification code', ar: 'رمز التحقق' },
    'auth.otpBefore': { fa: 'کد ۵ رقمی ارسال‌شده به ', en: 'Enter the 5-digit code sent to ', ar: 'أدخل الرمز المكون من 5 أرقام المرسل إلى ' },
    'auth.otpAfter': { fa: ' را وارد کنید.', en: '.', ar: '.' },
    'auth.demoBefore': { fa: 'حالت دمو — کد شما: ', en: 'Demo mode — your code: ', ar: 'الوضع التجريبي — رمزك: ' },
    'auth.verify': { fa: 'ورود', en: 'Continue', ar: 'متابعة' },
    'auth.resend': { fa: 'ارسال دوباره کد', en: 'Resend code', ar: 'إعادة إرسال الرمز' },
    'auth.changePhone': { fa: 'تغییر شماره', en: 'Change number', ar: 'تغيير الرقم' },
    'auth.backSite': { fa: 'بازگشت به سایت', en: 'Back to site', ar: 'العودة إلى الموقع' },
    'auth.resendIn': { fa: 'ارسال دوباره تا {n} ثانیه دیگر', en: 'Resend in {n} sec', ar: 'إعادة الإرسال خلال {n} ثانية' },
    'auth.invalidPhone': { fa: 'شماره موبایل معتبر نیست (مثال: 09123456789)', en: 'Enter a valid mobile number (e.g. 09123456789).', ar: 'أدخل رقم جوال صالحًا (مثال: 09123456789).' },
    'auth.sendFail': { fa: 'خطا در ارسال کد', en: 'Could not send the code', ar: 'تعذر إرسال الرمز' },
    'auth.networkSend': { fa: 'ارسال کد انجام نشد؛ اتصال اینترنت را بررسی کنید.', en: 'Could not send the code. Check your internet connection.', ar: 'تعذر إرسال الرمز. تحقق من اتصال الإنترنت.' },
    'auth.completeOtp': { fa: 'کد ۵ رقمی را کامل وارد کنید', en: 'Enter the complete 5-digit code.', ar: 'أدخل الرمز الكامل المكون من 5 أرقام.' },
    'auth.reenterPhone': { fa: 'شماره موبایل را دوباره وارد کنید', en: 'Enter your mobile number again.', ar: 'أدخل رقم جوالك مرة أخرى.' },
    'auth.badCode': { fa: 'کد نادرست است', en: 'The code is incorrect.', ar: 'الرمز غير صحيح.' },
    'auth.badLogin': { fa: 'پاسخ ورود نامعتبر است', en: 'Invalid sign-in response.', ar: 'استجابة تسجيل الدخول غير صالحة.' },
    'auth.success': { fa: 'ورود موفق! در حال انتقال…', en: 'Signed in. Redirecting…', ar: 'تم تسجيل الدخول. جارٍ التحويل…' },
    'auth.networkLogin': { fa: 'ورود انجام نشد؛ اتصال اینترنت را بررسی کنید.', en: 'Could not sign in. Check your internet connection.', ar: 'تعذر تسجيل الدخول. تحقق من اتصال الإنترنت.' },
    'auth.otpDigit': { fa: 'رقم {n} کد تأیید', en: 'Verification code digit {n}', ar: 'الرقم {n} من رمز التحقق' },

    // Profile
    'profile.documentTitle': { fa: 'پروفایل — وستو', en: 'Profile — WESTO', ar: 'الملف الشخصي — WESTO' },
    'profile.title': { fa: 'پروفایل من', en: 'My profile', ar: 'ملفي الشخصي' },
    'profile.points': { fa: 'امتیاز باشگاه مشتریان', en: 'Loyalty points', ar: 'نقاط الولاء' },
    'profile.phone': { fa: 'شماره موبایل', en: 'Mobile number', ar: 'رقم الجوال' },
    'profile.name': { fa: 'نام', en: 'Name', ar: 'الاسم' },
    'profile.namePh': { fa: 'نام شما', en: 'Your name', ar: 'اسمك' },
    'profile.email': { fa: 'ایمیل', en: 'Email', ar: 'البريد الإلكتروني' },
    'profile.save': { fa: 'ذخیره تغییرات', en: 'Save changes', ar: 'حفظ التغييرات' },
    'profile.backSite': { fa: 'بازگشت به سایت', en: 'Back to site', ar: 'العودة إلى الموقع' },
    'profile.logout': { fa: 'خروج', en: 'Sign out', ar: 'تسجيل الخروج' },
    'profile.admin': { fa: 'ورود به پنل مدیریت', en: 'Open admin panel', ar: 'فتح لوحة الإدارة' },
    'profile.memberSince': { fa: 'عضو از {date}', en: 'Member since {date}', ar: 'عضو منذ {date}' },
    'profile.loyaltyDesc': { fa: 'هر {per} تومان ≈ ۱ امتیاز · ارزش نمایشی هر امتیاز: {value} تومان', en: 'About 1 point per {per} Toman · display value per point: {value} Toman', ar: 'حوالي نقطة لكل {per} تومان · القيمة المعروضة لكل نقطة: {value} تومان' },
    'profile.loyaltyActive': { fa: 'باشگاه فعال است', en: 'Loyalty program is active', ar: 'برنامج الولاء نشط' },
    'profile.loadFail': { fa: 'خطا در بارگذاری پروفایل؛ اتصال اینترنت را بررسی کنید.', en: 'Could not load your profile. Check your internet connection.', ar: 'تعذر تحميل ملفك. تحقق من اتصال الإنترنت.' },
    'profile.saveFail': { fa: 'خطا در ذخیره', en: 'Could not save', ar: 'تعذر الحفظ' },
    'profile.saved': { fa: 'ذخیره شد.', en: 'Saved.', ar: 'تم الحفظ.' },
    'profile.networkSave': { fa: 'ذخیره انجام نشد؛ اتصال اینترنت را بررسی کنید.', en: 'Could not save. Check your internet connection.', ar: 'تعذر الحفظ. تحقق من اتصال الإنترنت.' },
    'profile.logoutFail': { fa: 'خروج انجام نشد؛ دوباره تلاش کنید.', en: 'Could not sign out. Try again.', ar: 'تعذر تسجيل الخروج. حاول مرة أخرى.' },
    'profile.networkLogout': { fa: 'خروج انجام نشد؛ اتصال اینترنت را بررسی کنید.', en: 'Could not sign out. Check your internet connection.', ar: 'تعذر تسجيل الخروج. تحقق من اتصال الإنترنت.' },

    // Reservation
    'reserve.documentTitle': { fa: 'رزرو میز — وستو', en: 'Table reservation — WESTO', ar: 'حجز طاولة — WESTO' },
    'reserve.title': { fa: 'رزرو میز', en: 'Reserve a table', ar: 'حجز طاولة' },
    'reserve.subtitle': { fa: 'زمان و تعداد نفرات را انتخاب کنید', en: 'Choose a date, time, and party size', ar: 'اختر التاريخ والوقت وعدد الضيوف' },
    'reserve.branch': { fa: 'شعبه', en: 'Branch', ar: 'الفرع' },
    'reserve.date': { fa: 'تاریخ', en: 'Date', ar: 'التاريخ' },
    'reserve.party': { fa: 'تعداد نفرات', en: 'Party size', ar: 'عدد الضيوف' },
    'reserve.time': { fa: 'ساعت', en: 'Time', ar: 'الوقت' },
    'reserve.chooseDate': { fa: 'تاریخ را انتخاب کنید', en: 'Choose a date', ar: 'اختر التاريخ' },
    'reserve.name': { fa: 'نام', en: 'Name', ar: 'الاسم' },
    'reserve.phone': { fa: 'موبایل', en: 'Mobile', ar: 'الجوال' },
    'reserve.note': { fa: 'یادداشت (اختیاری)', en: 'Note (optional)', ar: 'ملاحظة (اختياري)' },
    'reserve.notePh': { fa: 'مثلاً تولد، صندلی کودک…', en: 'e.g. birthday, high chair…', ar: 'مثلاً عيد ميلاد، كرسي طفل…' },
    'reserve.submit': { fa: 'ثبت رزرو', en: 'Reserve table', ar: 'تأكيد الحجز' },
    'reserve.backSite': { fa: 'بازگشت به سایت', en: 'Back to site', ar: 'العودة إلى الموقع' },
    'reserve.done': { fa: 'رزرو ثبت شد', en: 'Reservation placed', ar: 'تم تسجيل الحجز' },
    'reserve.pending': { fa: 'وضعیت: در انتظار تأیید مجموعه', en: 'Status: awaiting venue confirmation', ar: 'الحالة: بانتظار تأكيد المكان' },
    'reserve.back': { fa: 'بازگشت', en: 'Back', ar: 'رجوع' },
    'reserve.serverError': { fa: 'خطا در ارتباط با سرور', en: 'Server communication error', ar: 'خطأ في الاتصال بالخادم' },
    'reserve.disabled': { fa: 'رزرو آنلاین فعلاً غیرفعال است.', en: 'Online reservations are currently unavailable.', ar: 'الحجز أونلاين غير متاح حاليًا.' },
    'reserve.restaurantTitle': { fa: '{name} — رزرو آنلاین', en: '{name} — Online reservations', ar: '{name} — الحجز أونلاين' },
    'reserve.noBranch': { fa: 'شعبه فعالی تعریف نشده', en: 'No active branch is configured', ar: 'لا يوجد فرع نشط' },
    'reserve.loadFail': { fa: 'بارگذاری ناموفق', en: 'Could not load reservations', ar: 'تعذر تحميل الحجز' },
    'reserve.closed': { fa: 'این روز تعطیل است', en: 'Closed on this day', ar: 'مغلق في هذا اليوم' },
    'reserve.noSlots': { fa: 'ساعتی تعریف نشده', en: 'No time slots are available', ar: 'لا توجد أوقات متاحة' },
    'reserve.error': { fa: 'خطا', en: 'Something went wrong', ar: 'حدث خطأ' },
    'reserve.chooseTime': { fa: 'ساعت را انتخاب کنید', en: 'Choose a time', ar: 'اختر الوقت' },
    'reserve.invalidResponse': { fa: 'پاسخ رزرو نامعتبر است', en: 'Invalid reservation response', ar: 'استجابة الحجز غير صالحة' },
    'reserve.people': { fa: '{n} نفر', en: '{n} people', ar: '{n} أشخاص' },
    'reserve.offline': { fa: 'اتصال اینترنت برقرار نیست', en: 'You are offline', ar: 'لا يوجد اتصال بالإنترنت' },

    // Feedback / NPS
    'feedback.documentTitle': { fa: 'بازخورد — وستو', en: 'Feedback — WESTO', ar: 'التقييم — WESTO' },
    'feedback.title': { fa: 'نظر شما', en: 'Your feedback', ar: 'رأيك' },
    'feedback.branch': { fa: 'شعبه', en: 'Branch', ar: 'الفرع' },
    'feedback.nps': { fa: 'احتمال پیشنهاد به دوستان (۰ تا ۱۰)', en: 'NPS score (0–10)', ar: 'تقييم NPS (0–10)' },
    'feedback.low': { fa: '۰ — بعید', en: '0 — Unlikely', ar: '0 — غير محتمل' },
    'feedback.high': { fa: '۱۰ — حتماً', en: '10 — Definitely', ar: '10 — بالتأكيد' },
    'feedback.comment': { fa: 'نظر (اختیاری)', en: 'Comment (optional)', ar: 'تعليق (اختياري)' },
    'feedback.commentPh': { fa: 'چه چیزی خوب بود؟ چه چیزی بهتر شود؟', en: 'What was good? What could be better?', ar: 'ما الذي أعجبك؟ وما الذي يمكن تحسينه؟' },
    'feedback.name': { fa: 'نام (اختیاری)', en: 'Name (optional)', ar: 'الاسم (اختياري)' },
    'feedback.phone': { fa: 'موبایل (اختیاری)', en: 'Mobile (optional)', ar: 'الجوال (اختياري)' },
    'feedback.submit': { fa: 'ارسال بازخورد', en: 'Send feedback', ar: 'إرسال التقييم' },
    'feedback.backSite': { fa: 'بازگشت به سایت', en: 'Back to site', ar: 'العودة إلى الموقع' },
    'feedback.thanks': { fa: 'ممنون', en: 'Thank you', ar: 'شكرًا' },
    'feedback.back': { fa: 'بازگشت', en: 'Back', ar: 'رجوع' },
    'feedback.disabled': { fa: 'بازخورد فعلاً غیرفعال است', en: 'Feedback is currently unavailable', ar: 'التقييم غير متاح حاليًا' },
    'feedback.loadInfoFail': { fa: 'خطا در بارگذاری اطلاعات بازخورد', en: 'Could not load feedback information', ar: 'تعذر تحميل معلومات التقييم' },
    'feedback.loadFail': { fa: 'خطا در بارگذاری', en: 'Could not load', ar: 'تعذر التحميل' },
    'feedback.chooseScore': { fa: 'لطفاً یک امتیاز انتخاب کنید', en: 'Choose a score.', ar: 'اختر تقييمًا.' },
    'feedback.error': { fa: 'خطا', en: 'Something went wrong', ar: 'حدث خطأ' },
    'feedback.sendFail': { fa: 'خطا در ارسال', en: 'Could not send feedback', ar: 'تعذر إرسال التقييم' },
    'feedback.offline': { fa: 'اتصال اینترنت برقرار نیست', en: 'You are offline', ar: 'لا يوجد اتصال بالإنترنت' },

    // Classic menu chrome
    'cm.language': { fa: 'زبان', en: 'Language', ar: 'اللغة' },
    'cm.filter': { fa: 'فیلتر آلرژن', en: 'Allergen filter', ar: 'تصفية مسببات الحساسية' },
    'cm.filterExclude': {
      fa: 'بدون آلرژن',
      en: 'Exclude allergens',
      ar: 'استبعاد مسببات الحساسية',
    },
    'cm.search': { fa: 'جستجو', en: 'Search', ar: 'بحث' },
    'cm.searchPh': {
      fa: 'جستجوی غذا، مواد یا دسته…',
      en: 'Search dishes, ingredients, categories…',
      ar: 'ابحث عن أطباق أو مكونات أو فئات…',
    },
    'cm.all': { fa: 'همه', en: 'All', ar: 'الكل' },
    'cm.experience': {
      fa: 'منوی اصلی',
      en: 'Main menu',
      ar: 'القائمة الرئيسية',
    },
    'cm.add': { fa: 'افزودن به سبد', en: 'Add to cart', ar: 'أضف إلى السلة' },
    'cm.added': {
      fa: 'به سبد اضافه شد',
      en: 'added to table',
      ar: 'أضيف إلى الطاولة',
    },
    'cm.back': { fa: 'بازگشت', en: 'Back', ar: 'رجوع' },
    'cm.drawerTitle': {
      fa: 'منو و فیلترها',
      en: 'Menu & filters',
      ar: 'القائمة والفلاتر',
    },
    'cm.loading': {
      fa: 'در حال بارگذاری…',
      en: 'Loading…',
      ar: 'جاري التحميل…',
    },
    'cm.loadFail': {
      fa: 'بارگذاری ناموفق بود',
      en: 'Failed to load menu',
      ar: 'فشل التحميل',
    },
    'cm.empty': {
      fa: 'موردی پیدا نشد',
      en: 'No items found',
      ar: 'لا توجد عناصر',
    },
    'cm.emptyCat': {
      fa: 'هنوز غذایی در این دسته نیست',
      en: 'No dishes in this category yet',
      ar: 'لا أطباق في هذه الفئة بعد',
    },
    'cm.title': {
      fa: 'منوی کلاسیک — وستو',
      en: 'Classic menu — Westo',
      ar: 'القائمة الكلاسيكية — وستو',
    },
    'dish.empty': {
      fa: 'هنوز غذایی نیست',
      en: 'No dishes yet',
      ar: 'لا أطباق بعد',
    },
    'dish.subcategories': {
      fa: 'زیردسته‌های منو',
      en: 'Menu subcategories',
      ar: 'الفئات الفرعية للقائمة',
    },
  };

  const CAT_EN = {
    سالاد: 'Salad',
    'پیش غذا': 'Appetizers',
    پیش: 'Appetizers',
    تاکو: 'Tacos',
    پاستا: 'Pasta',
    برگر: 'Burgers',
    'غذای اصلی': 'Mains',
    پیتزا: 'Pizza',
    سوشی: 'Sushi',
    'وگن شو / وجترین بمان': 'Vegan / Vegetarian',
    'وگن شو وجترین بمان': 'Vegan / Vegetarian',
    'نات کافئین': 'Non-caffeine',
    'هربال تی': 'Herbal tea',
    پیستری: 'Pastry',
    'سرویس ویژه': 'Special service',
    'بار سرد': 'Cold bar',
    ماچا: 'Matcha',
    'ماچا بار': 'Matcha bar',
    کافئین: 'Caffeine',
    بار: 'Bar',
  };

  const CAT_AR = {
    سالاد: 'سلطة',
    'پیش غذا': 'مقبلات',
    پیش: 'مقبلات',
    تاکو: 'تاكو',
    پاستا: 'باستا',
    برگر: 'برغر',
    'غذای اصلی': 'أطباق رئيسية',
    پیتزا: 'بيتزا',
    سوشی: 'سوشي',
    'وگن شو / وجترین بمان': 'نباتي',
    'وگن شو وجترین بمان': 'نباتي',
    'نات کافئین': 'بدون كافيين',
    'هربال تی': 'شاي أعشاب',
    پیستری: 'معجنات',
    'سرویس ویژه': 'خدمة خاصة',
    'بار سرد': 'بار بارد',
    ماچا: 'ماتشا',
    'ماچا بار': 'بار الماتشا',
    کافئین: 'كافيين',
    بار: 'بار',
  };

  const ALLERGEN_EN = {
    gluten: 'Gluten',
    dairy: 'Dairy',
    egg: 'Egg',
    nuts: 'Tree nuts',
    peanut: 'Peanut',
    soy: 'Soy',
    seafood: 'Seafood',
    sesame: 'Sesame',
    mustard: 'Mustard',
  };

  const ALLERGEN_AR = {
    gluten: 'غلوتين',
    dairy: 'ألبان',
    egg: 'بيض',
    nuts: 'مكسرات',
    peanut: 'فول سوداني',
    soy: 'صويا',
    seafood: 'مأكولات بحرية',
    sesame: 'سمسم',
    mustard: 'خردل',
  };

  function normalize(lang) {
    const l = String(lang || '').toLowerCase().slice(0, 2);
    return SUPPORTED.includes(l) ? l : 'fa';
  }

  function detectLang() {
    try {
      const explicit = localStorage.getItem(EXPLICIT_STORAGE_KEY) === '1';
      const saved = localStorage.getItem(STORAGE_KEY);
      if (explicit && saved && SUPPORTED.includes(normalize(saved))) return normalize(saved);
    } catch (_) {}
    // Persian is the unconditional first-run/default language. Query-string
    // values and the browser locale must never switch the interface by
    // themselves; the language buttons are the only preference writer.
    return 'fa';
  }

  let lang = detectLang();
  let cfg = { guestLangEnabled: true, defaultLang: 'fa', supported: SUPPORTED.slice() };

  function t(key, vars) {
    const row = STRINGS[key];
    let out = row ? row[lang] || row.fa || key : key;
    if (vars && typeof vars === 'object') {
      Object.keys(vars).forEach((k) => {
        out = out.replace(new RegExp('\\{' + k + '\\}', 'g'), String(vars[k]));
      });
    }
    return out;
  }

  function applyDocumentLang(next) {
    const html = document.documentElement;
    html.lang = next;
    // Keep page chrome / WebGL layout LTR for all langs. Text RTL is applied
    // via CSS islands (html[lang=fa|ar] …) — flipping html.dir broke navbar flex.
    html.dir = 'ltr';
    html.classList.toggle('is-lang-en', next === 'en');
    html.classList.toggle('is-lang-ar', next === 'ar');
    html.classList.toggle('is-lang-fa', next === 'fa');
    if (document.body) {
      document.body.lang = next;
      document.body.dir = 'ltr';
    }
  }

  function setLang(next, opts) {
    const normalized = normalize(next);
    if (!cfg.supported.includes(normalized)) return lang;
    const prev = lang;
    lang = normalized;
    if (opts && opts.userInitiated === true) {
      try {
        localStorage.setItem(STORAGE_KEY, lang);
        localStorage.setItem(EXPLICIT_STORAGE_KEY, '1');
      } catch (_) {}
    }
    applyDocumentLang(lang);
    try {
      const url = new URL(location.href);
      url.searchParams.set('lang', lang);
      if (!opts || opts.replaceUrl !== false) {
        history.replaceState(null, '', url.pathname + url.search + url.hash);
      }
    } catch (_) {}
    if (prev !== lang || (opts && opts.force)) {
      paintStaticI18n();
      document.dispatchEvent(
        new CustomEvent('westo:langchange', { detail: { lang, prev } }),
      );
    }
    return lang;
  }

  function pickLocalized(obj, faKey, enKey, arKey) {
    if (!obj) return '';
    if (lang === 'ar') {
      return (
        String(obj[arKey] || '').trim() ||
        String(obj[faKey] || '').trim() ||
        String(obj[enKey] || '').trim()
      );
    }
    if (lang === 'en') {
      return String(obj[enKey] || '').trim() || String(obj[faKey] || '').trim();
    }
    return String(obj[faKey] || '').trim() || String(obj[enKey] || '').trim();
  }
  function cleanEnLabel(s) {
    let t = String(s || '').trim();
    if (!t) return '';
    t = t.replace(/^[&\s]+/, '').trim();
    let m = t.match(/^&&?\s*\(\s*(.+?)\s*\)\s*$/);
    if (m) t = m[1].trim();
    m = t.match(/^\(\s*(.+?)\s*\)\s*$/);
    if (m) t = m[1].trim();
    m = t.match(/^[&\s]*\(\s*(.+?)\s*\)\s*$/);
    if (m) t = m[1].trim();
    t = t
      .replace(/^&\s*/g, '')
      .replace(/\s+&\s*$/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
    return t
      .split(/\s+/)
      .filter((w) => w && w !== '&')
      .join(' ')
      .trim();
  }

  function hasLatinName(s) {
    return cleanEnLabel(s).replace(/[^A-Za-z]/g, '').length >= 2;
  }

  function itemName(m) {
    if (!m) return '';
    if (lang === 'ar') {
      const ar = String(m.ar || '').trim();
      if (ar) return ar;
      if (hasLatinName(m.en)) return cleanEnLabel(m.en);
      return String(m.name || '').trim();
    }
    if (lang === 'en') {
      if (hasLatinName(m.en)) return cleanEnLabel(m.en);
      return String(m.name || '').trim() || cleanEnLabel(m.en);
    }
    return String(m.name || '').trim() || cleanEnLabel(m.en);
  }

  function itemSub(m) {
    if (!m) return '';
    if (lang === 'en') return String(m.name || '');
    if (lang === 'ar') return hasLatinName(m.en) ? cleanEnLabel(m.en) : '';
    return cleanEnLabel(m.en) || String(m.en || '');
  }

  function itemDesc(m) {
    if (!m) return '';
    if (lang === 'ar') {
      return (
        String(m.descAr || '').trim() ||
        cleanEnLabel(m.descEn) ||
        String(m.descEn || '').trim() ||
        String(m.desc || '').trim()
      );
    }
    if (lang === 'en') {
      const en = cleanEnLabel(m.descEn) || String(m.descEn || '').trim();
      return en || String(m.desc || '');
    }
    return String(m.desc || '') || String(m.descEn || '');
  }

  function normalizeCatKey(s) {
    return String(s || '')
      .replace(/[\u200c\u200d\u200e\u200f\ufeff]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function catTitleFromFa(faTitle) {
    return catTitle({ title: normalizeCatKey(faTitle) });
  }

  function writeLocalizedTitle(titleRoot, localized) {
    if (!titleRoot) return;
    const spans = titleRoot.querySelectorAll('[data-anim="chars-mask"]');
    const br = titleRoot.querySelector('br');
    const apply = (el, text) => {
      // Wipe SplitText wrappers so language swaps stay visible (stale GSAP targets
      // are detached; plain text must not stay stuck at yPercent 110).
      el.textContent = text;
      el.style.display = '';
      if (global.gsap) {
        try {
          global.gsap.set(el, { yPercent: 0, clearProps: 'transform' });
        } catch (_) {}
      }
    };
    if (spans[0] && spans[1]) {
      apply(spans[0], localized);
      spans[1].textContent = '';
      spans[1].style.display = 'none';
      if (br) br.style.display = 'none';
    } else if (spans[0]) {
      apply(spans[0], localized);
    } else {
      apply(titleRoot, localized);
    }
  }

  function localizeHeroTitles() {
    document
      .querySelectorAll(
        '.carousel_list.is-hero .carousel_slide, .carousel_list.is-desc .carousel_slide, .carousel_list.is-desc .carousel_desc',
      )
      .forEach((slide) => {
        const fa = slide.getAttribute('data-cat-fa');
        if (!fa) return;
        const localized = catTitleFromFa(fa);
        const titleRoot = slide.querySelector('.heading-style-h2');
        if (titleRoot) writeLocalizedTitle(titleRoot, localized);

        const p = slide.querySelector('p');
        const descFa = slide.getAttribute('data-cat-desc-fa');
        if (descFa && p && lang === 'fa') p.textContent = descFa;
      });
  }

  function paintStaticI18n(root) {
    const scope = root || document;
    // One selector walk instead of three whole-scope scans. This keeps the exact
    // same data-i18n contract while reducing startup selector work on the home
    // page and on every manual language change.
    scope
      .querySelectorAll('[data-i18n], [data-i18n-aria], [data-i18n-placeholder]')
      .forEach((el) => {
        const textKey = el.getAttribute('data-i18n');
        if (textKey) el.textContent = t(textKey);

        const ariaKey = el.getAttribute('data-i18n-aria');
        if (ariaKey) el.setAttribute('aria-label', t(ariaKey));

        const placeholderKey = el.getAttribute('data-i18n-placeholder');
        if (placeholderKey) el.setAttribute('placeholder', t(placeholderKey));
      });
    localizeHeroTitles();
  }

  function catTitle(c) {
    if (!c) return '';
    const title = normalizeCatKey(c.title || c.name || '');
    if (lang === 'en') return CAT_EN[title] || c.titleEn || c.en || title;
    if (lang === 'ar') return CAT_AR[title] || c.titleAr || c.ar || CAT_EN[title] || title;
    return title;
  }

  function allergenLabel(a) {
    if (!a) return '';
    if (lang === 'en') return ALLERGEN_EN[a.id] || a.labelEn || a.label;
    if (lang === 'ar') return ALLERGEN_AR[a.id] || a.labelAr || ALLERGEN_EN[a.id] || a.label;
    return a.label;
  }

  function dayLabel(key) {
    return t('day.' + key);
  }

  function syncFromConfig(i18n) {
    if (!i18n || typeof i18n !== 'object') return;
    cfg = {
      guestLangEnabled: i18n.guestLangEnabled !== false,
      defaultLang: normalize(i18n.defaultLang || 'fa'),
      supported: Array.isArray(i18n.supported) && i18n.supported.length
        ? i18n.supported.map(normalize).filter((l, i, a) => SUPPORTED.includes(l) && a.indexOf(l) === i)
        : SUPPORTED.slice(),
    };
    if (!cfg.supported.includes(lang)) {
      setLang(cfg.defaultLang, { force: true });
    }
  }

  // The shared /api/menu response already carries the exact same i18n config.
  // Reuse that response on the home page instead of opening a second startup
  // request to /api/i18n. A delayed network fallback is kept for static/legacy
  // pages where the shared menu store is absent or never reaches the network.
  let configApplied = false;
  let freshConfigApplied = false;
  let configFallbackScheduled = false;
  let configIdleHandle = 0;
  let configTimer = 0;

  function clearConfigFallback() {
    if (configIdleHandle && typeof global.cancelIdleCallback === 'function') {
      try {
        global.cancelIdleCallback(configIdleHandle);
      } catch (_) {}
    }
    configIdleHandle = 0;
    if (configTimer) global.clearTimeout(configTimer);
    configTimer = 0;
  }

  function applySharedConfig(candidate, { fresh = false } = {}) {
    if (!candidate || typeof candidate !== 'object') return false;
    syncFromConfig(candidate);
    configApplied = true;
    if (fresh) {
      freshConfigApplied = true;
      clearConfigFallback();
      global.removeEventListener('westo:menu-ready', onMenuReadyForConfig);
    }
    return true;
  }

  function onMenuReadyForConfig(event) {
    const shared = event?.detail || global.westoMenuStore || null;
    const data = shared?.data || global.westoMenuStore?.data || null;
    const candidate = data?.i18n || null;
    if (!candidate) return;

    // A local snapshot is useful immediately, but keep listening until the
    // menu store publishes its network-fresh payload. This avoids freezing an
    // old admin language setting just because a local menu snapshot existed.
    applySharedConfig(candidate, { fresh: shared?.fromCache === false });
  }

  function fetchConfigFallback() {
    if (freshConfigApplied) return;
    clearConfigFallback();
    try {
      fetch('/api/i18n', { cache: 'no-cache' })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (d?.i18n) applySharedConfig(d.i18n, { fresh: true });
        })
        .catch(() => {});
    } catch (_) {}
  }

  function scheduleConfigFallback() {
    if (configFallbackScheduled || freshConfigApplied) return;
    configFallbackScheduled = true;

    const schedule = () => {
      if (freshConfigApplied) return;
      if (typeof global.requestIdleCallback === 'function') {
        configIdleHandle = global.requestIdleCallback(fetchConfigFallback, { timeout: 2500 });
      } else {
        configTimer = global.setTimeout(fetchConfigFallback, 1200);
      }
    };

    if (document.readyState === 'complete') schedule();
    else global.addEventListener('load', schedule, { once: true });
  }

  function loadConfig() {
    const shared = global.westoMenuStore || null;
    const existing = shared?.data?.i18n || null;
    if (existing) applySharedConfig(existing, { fresh: shared?.fromCache === false });

    if (!freshConfigApplied) {
      global.addEventListener('westo:menu-ready', onMenuReadyForConfig);
      // If this script is reused on a page where the menu store was created
      // before i18n, its ready promise may resolve without another event.
      if (shared?.ready && typeof shared.ready.then === 'function') {
        shared.ready
          .then((resolved) => {
            const data = resolved?.data || global.westoMenuStore?.data || null;
            if (data?.i18n) applySharedConfig(data.i18n, { fresh: resolved?.fromCache === false });
          })
          .catch(() => {});
      }
      scheduleConfigFallback();
    }
  }

  // Boot
  applyDocumentLang(lang);
  loadConfig();

  const api = {
    STORAGE_KEY,
    EXPLICIT_STORAGE_KEY,
    SUPPORTED,
    get lang() {
      return lang;
    },
    get config() {
      return cfg;
    },
    t,
    setLang,
    detectLang,
    normalize,
    itemName,
    itemSub,
    itemDesc,
    catTitle,
    catTitleFromFa,
    allergenLabel,
    dayLabel,
    pickLocalized,
    syncFromConfig,
    localizeHeroTitles,
    paintStaticI18n,
    isRtl: () => !!RTL[lang],
    applyDocumentLang,
  };

  global.westoI18n = api;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => paintStaticI18n());
  } else {
    paintStaticI18n();
  }
})(typeof window !== 'undefined' ? window : globalThis);

;/* ===== END js/i18n.js ===== */

/* ===== BEGIN js/category-theme.js ===== */
/**
 * Per-category atmosphere themes for the guest site.
 * Keys by stable menu categoryId (not carousel index).
 * Light: wash / surface / accent tokens. Dark: taste colors for WebGL only.
 *
 * Performance note:
 * category-theme is intentionally tiny and synchronous because it is consumed by
 * the hero carousel, dish boards, classic menu, and menu overlay. The important
 * optimization here is not to change its public contract, but to avoid writing
 * identical attributes/CSS custom properties repeatedly when multiple consumers
 * focus the same category in the same interaction window.
 */
(function () {
  'use strict';

  const DEFAULT_ID = 7560;

  /** @type {Record<string, {
   *   slug: string,
   *   tastePrimary: string,
   *   tasteSecondary: string,
   *   wash: string,
   *   surface: string,
   *   accent: string,
   *   accentSoft: string,
   *   glow: string
   * }>} */
  const THEMES = {
    // Fresh / leaf — Salad
    7560: {
      slug: 'salad',
      tastePrimary: '#1C2A1A',
      tasteSecondary: '#B8D48A',
      wash: '#eef3e8',
      surface: '#f6f9f2',
      accent: '#5a7a3e',
      accentSoft: 'rgba(90, 122, 62, 0.16)',
      glow: 'rgba(120, 160, 80, 0.18)',
    },
    // Invite / saffron — Appetizers
    7561: {
      slug: 'appetizers',
      tastePrimary: '#3A2414',
      tasteSecondary: '#F0B46A',
      wash: '#f6eee4',
      surface: '#fbf5ec',
      accent: '#b8893e',
      accentSoft: 'rgba(184, 137, 62, 0.18)',
      glow: 'rgba(240, 180, 106, 0.22)',
    },
    // Corn / lime / chilli — Tacos
    17007: {
      slug: 'tacos',
      tastePrimary: '#2A2010',
      tasteSecondary: '#C9D86A',
      wash: '#f2f2df',
      surface: '#faf8ea',
      accent: '#788d35',
      accentSoft: 'rgba(120, 141, 53, 0.16)',
      glow: 'rgba(201, 216, 106, 0.2)',
    },
    // Comfort carbs — Pasta
    7562: {
      slug: 'pasta',
      tastePrimary: '#4A1E14',
      tasteSecondary: '#F2A070',
      wash: '#f5ebe4',
      surface: '#fbf3ed',
      accent: '#c46a45',
      accentSoft: 'rgba(196, 106, 69, 0.16)',
      glow: 'rgba(242, 160, 112, 0.2)',
    },
    // Fire / grill — Burgers
    7563: {
      slug: 'burgers',
      tastePrimary: '#2A1410',
      tasteSecondary: '#E89058',
      wash: '#f4ebe4',
      surface: '#faf3ec',
      accent: '#c46e3c',
      accentSoft: 'rgba(200, 110, 60, 0.16)',
      glow: 'rgba(232, 144, 88, 0.2)',
    },
    // Fire / roast — Mains
    7564: {
      slug: 'mains',
      tastePrimary: '#2C1C12',
      tasteSecondary: '#D4A86A',
      wash: '#f3ebe3',
      surface: '#f9f2e9',
      accent: '#a67a3c',
      accentSoft: 'rgba(166, 122, 60, 0.16)',
      glow: 'rgba(212, 168, 106, 0.2)',
    },
    // Brick oven — Pizza
    7566: {
      slug: 'pizza',
      tastePrimary: '#4A1C16',
      tasteSecondary: '#E8A888',
      wash: '#f5e9e4',
      surface: '#fbf1ec',
      accent: '#b85a42',
      accentSoft: 'rgba(184, 90, 66, 0.16)',
      glow: 'rgba(232, 168, 136, 0.2)',
    },
    // Garden — Vegan
    7567: {
      slug: 'vegan',
      tastePrimary: '#1A2818',
      tasteSecondary: '#A8D478',
      wash: '#eef4ea',
      surface: '#f5faf1',
      accent: '#4f7a3a',
      accentSoft: 'rgba(79, 122, 58, 0.16)',
      glow: 'rgba(140, 190, 100, 0.18)',
    },
    // Cold bar (hidden) — ocean-lite
    7599: {
      slug: 'cold-bar',
      tastePrimary: '#102028',
      tasteSecondary: '#8EC8D0',
      wash: '#eaf2f4',
      surface: '#f2f8f9',
      accent: '#3d7a82',
      accentSoft: 'rgba(61, 122, 130, 0.16)',
      glow: 'rgba(126, 200, 208, 0.18)',
    },
    // Caffeine — espresso
    7675: {
      slug: 'caffeine',
      tastePrimary: '#1A1410',
      tasteSecondary: '#C4A078',
      wash: '#f0ebe5',
      surface: '#f7f2ec',
      accent: '#6b4a2e',
      accentSoft: 'rgba(107, 74, 46, 0.16)',
      glow: 'rgba(160, 120, 80, 0.18)',
    },
    // Herbal tea — sage
    7676: {
      slug: 'herbal',
      tastePrimary: '#18241C',
      tasteSecondary: '#9EC8A0',
      wash: '#eef3ee',
      surface: '#f5f9f5',
      accent: '#4d7a58',
      accentSoft: 'rgba(77, 122, 88, 0.16)',
      glow: 'rgba(140, 180, 140, 0.18)',
    },
    // Pastry — berry caramel
    7697: {
      slug: 'pastry',
      tastePrimary: '#3A1824',
      tasteSecondary: '#F0B0A0',
      wash: '#f5e9ec',
      surface: '#fbf1f3',
      accent: '#a85a6a',
      accentSoft: 'rgba(168, 90, 106, 0.16)',
      glow: 'rgba(240, 176, 160, 0.2)',
    },
    // Non-caffeine — latte / soft cocoa
    7701: {
      slug: 'non-caffeine',
      tastePrimary: '#2A1C14',
      tasteSecondary: '#D4B090',
      wash: '#f2ebe4',
      surface: '#f8f3ec',
      accent: '#8a6a48',
      accentSoft: 'rgba(138, 106, 72, 0.16)',
      glow: 'rgba(212, 176, 144, 0.18)',
    },
    // Special service — plum
    9478: {
      slug: 'special',
      tastePrimary: '#221828',
      tasteSecondary: '#C8B0E0',
      wash: '#f0eaf2',
      surface: '#f7f2f8',
      accent: '#7a5a8e',
      accentSoft: 'rgba(122, 90, 142, 0.16)',
      glow: 'rgba(180, 150, 200, 0.18)',
    },
    // Ocean / wasabi — Sushi
    13581: {
      slug: 'sushi',
      tastePrimary: '#102428',
      tasteSecondary: '#7EC8B0',
      wash: '#e8f2f0',
      surface: '#f0f8f5',
      accent: '#2f7a6a',
      accentSoft: 'rgba(47, 122, 106, 0.16)',
      glow: 'rgba(126, 200, 176, 0.2)',
    },
    // Matcha bar
    14477: {
      slug: 'matcha',
      tastePrimary: '#1A3220',
      tasteSecondary: '#8FCB7A',
      wash: '#eaf2e6',
      surface: '#f3f8ef',
      accent: '#4a7a3a',
      accentSoft: 'rgba(74, 122, 58, 0.16)',
      glow: 'rgba(143, 203, 122, 0.2)',
    },
  };

  // Keep the exact public theme table and category fallback used by the stable
  // build. CSS property names are stored once so clear/apply never rebuild the
  // mapping on every focus change.
  const LIGHT_VARS = [
    ['--cat-wash', 'wash'],
    ['--cat-surface', 'surface'],
    ['--cat-accent', 'accent'],
    ['--cat-accent-soft', 'accentSoft'],
    ['--cat-glow', 'glow'],
  ];

  const TASTE_PRIMARY_VAR = '--color-scheme-1--taste-primary';
  const TASTE_SECONDARY_VAR = '--color-scheme-1--taste-secondary';

  function get(categoryId) {
    const key = String(categoryId == null ? '' : categoryId);
    return THEMES[key] || THEMES[String(DEFAULT_ID)];
  }

  function isLight() {
    return document.documentElement.getAttribute('data-theme') === 'light';
  }

  function setAttributeIfChanged(root, name, value) {
    const next = String(value);
    if (root.getAttribute(name) !== next) root.setAttribute(name, next);
  }

  function removeAttributeIfPresent(root, name) {
    if (root.hasAttribute(name)) root.removeAttribute(name);
  }

  function setStyleIfChanged(root, name, value) {
    if (root.style.getPropertyValue(name) !== value) {
      root.style.setProperty(name, value);
    }
  }

  function removeStyleIfPresent(root, name) {
    if (root.style.getPropertyValue(name)) root.style.removeProperty(name);
  }

  function clearLightVars(root) {
    for (const [name] of LIGHT_VARS) removeStyleIfPresent(root, name);
    // Chrome --wg-accent / --wg-gold stay brand cyan (never cleared or overridden).
  }

  function applyLightVars(root, theme) {
    for (const [name, key] of LIGHT_VARS) {
      setStyleIfChanged(root, name, theme[key]);
    }
    // Atmosphere only — do not override --wg-gold / --wg-accent.
  }

  function normalizeCategoryId(categoryId) {
    if (categoryId == null || categoryId === '' || categoryId === 'all') return null;
    const id = Number(categoryId);
    return Number.isNaN(id) ? null : id;
  }

  function dispatchThemeEvent(id, theme, light) {
    // Preserve the existing event contract even when the effective DOM values
    // were already correct. External consumers may use apply() as a semantic
    // category-focus signal, so only the redundant style/attribute writes are
    // deduplicated here — not the event itself.
    window.dispatchEvent(
      new CustomEvent('westo:category-theme', {
        detail: { id, slug: theme.slug, theme, light },
      }),
    );
  }

  /**
   * Stamp active category on <html> and apply CSS vars / taste props.
   * @param {string|number|null|undefined} categoryId
   * @param {{ skipTaste?: boolean }} [opts]
   */
  function apply(categoryId, opts) {
    const root = document.documentElement;
    const id = normalizeCategoryId(categoryId);

    // Preserve stable semantics for null / "all" / invalid categories:
    // category attributes and light-atmosphere overrides are removed, while
    // the last taste pair is intentionally left untouched.
    if (id == null) {
      removeAttributeIfPresent(root, 'data-cat-id');
      removeAttributeIfPresent(root, 'data-cat-slug');
      clearLightVars(root);
      return null;
    }

    const theme = get(id);
    const light = isLight();

    setAttributeIfChanged(root, 'data-cat-id', id);
    setAttributeIfChanged(root, 'data-cat-slug', theme.slug);

    if (light) applyLightVars(root, theme);
    else clearLightVars(root);

    if (!opts || !opts.skipTaste) {
      setStyleIfChanged(root, TASTE_PRIMARY_VAR, theme.tastePrimary);
      setStyleIfChanged(root, TASTE_SECONDARY_VAR, theme.tasteSecondary);
    }

    dispatchThemeEvent(id, theme, light);
    return theme;
  }

  function tasteFor(categoryId) {
    const theme = get(categoryId);
    return {
      primary: theme.tastePrimary,
      secondary: theme.tasteSecondary,
      slug: theme.slug,
    };
  }

  function reapply() {
    const root = document.documentElement;
    const id = root.getAttribute('data-cat-id');
    if (id) apply(id, { skipTaste: false });
    else clearLightVars(root);
  }

  // theme.js is loaded later on both the cinematic home page and classic menu.
  // Reapply after its event so a light/dark/system change updates atmosphere
  // without either module needing to know about the other's load order.
  window.addEventListener('westo:theme-change', reapply);

  window.westoCategoryTheme = {
    THEMES,
    get,
    apply,
    tasteFor,
    reapply,
  };
})();

;/* ===== END js/category-theme.js ===== */

/* ===== BEGIN js/menu-store.js ===== */
/* One shared, category-id based menu model for the hero, boards and rail.
   Instant local hydrate → one coalesced network refresh. Offline keeps the
   last good snapshot. Persistence is intentionally moved out of the startup
   hot path so JSON.stringify/localStorage does not compete with Hero boot. */
(function () {
  'use strict';

  const existing = window.westoMenuStore;
  if (existing && existing.ready) return;

  const LOCAL_KEY = 'westo_menu_cache';
  const LOCAL_SOFT_TTL_MS = 6 * 60 * 60 * 1000;
  const PERSIST_IDLE_TIMEOUT_MS = 2500;
  const PERSIST_FALLBACK_DELAY_MS = 900;

  const store = {
    data: null,
    ready: null,
    byCategory: Object.create(null),
    categories: [],
    categoryOrder: [],
    menuRevision: 0,
    fromCache: false,
    updatedAt: 0,
    savedAt: 0,
    lastError: null,
    refresh: null,
    getSnapshot: null,
  };

  // Publish the store before any cached-data event is emitted. Existing
  // consumers primarily use event.detail, but making the global available
  // immediately removes a timing hole for late/legacy consumers.
  window.westoMenuStore = store;

  let cachedSnapshot = null;
  let inFlight = null;
  let persistPayload = null;
  let persistIdleHandle = 0;
  let persistTimer = 0;
  let destroyed = false;

  function isDrinkTexture(path) {
    return /assets\/textures\/westo_texture_/i.test(String(path || ''));
  }

  function hasCover(category) {
    const cover = String(category?.coverImg || '').trim();
    return Boolean(cover) && !isDrinkTexture(cover);
  }

  function safeArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function applyData(data, { fromCache = false, savedAt = 0 } = {}) {
    if (!data || typeof data !== 'object') return store;

    const menuItems = safeArray(data.menuItems);
    const menuCategories = safeArray(data.menuCategories);
    const siteCategories = safeArray(data.siteCategories);
    const byCategory = Object.create(null);

    for (let index = 0; index < menuItems.length; index += 1) {
      const item = menuItems[index];
      if (!item || item.available === false) continue;
      const id = Number(item.categoryId);
      if (!Number.isFinite(id)) continue;
      if (!byCategory[id]) byCategory[id] = [];
      byCategory[id].push(item);
    }

    // Preserve the stable category-selection contract exactly: server
    // siteCategories wins; menuCategories is only the fallback.
    let categories;
    if (siteCategories.length) {
      categories = siteCategories.filter((category) => category && hasCover(category));
    } else {
      categories = menuCategories.filter(
        (category) => category && !category.hiddenOnSite && hasCover(category),
      );
    }

    store.data = data;
    store.byCategory = byCategory;
    store.categories = categories;
    store.categoryOrder = categories.map((category) => Number(category.id));
    store.menuRevision = Number(data.menuRevision) || 0;
    store.fromCache = Boolean(fromCache);
    store.updatedAt = Date.now();
    if (savedAt) store.savedAt = Number(savedAt) || store.savedAt || 0;
    store.lastError = null;

    window.__westoCategoryOrder = store.categoryOrder.slice();
    window.__westoMenuRevision = store.menuRevision;

    window.dispatchEvent(
      new CustomEvent('westo:menu-ready', {
        detail: store,
      }),
    );

    return store;
  }

  function readLocal() {
    try {
      const value = localStorage.getItem(LOCAL_KEY);
      if (!value) return null;
      const parsed = JSON.parse(value);
      if (!parsed || typeof parsed !== 'object' || !parsed.data || typeof parsed.data !== 'object') {
        return null;
      }
      return parsed;
    } catch (_) {
      return null;
    }
  }

  function cancelPersistSchedule() {
    if (persistIdleHandle && typeof window.cancelIdleCallback === 'function') {
      try {
        window.cancelIdleCallback(persistIdleHandle);
      } catch (_) {}
    }
    persistIdleHandle = 0;
    if (persistTimer) window.clearTimeout(persistTimer);
    persistTimer = 0;
  }

  function persistNow() {
    if (!persistPayload) return false;
    const payload = persistPayload;
    persistPayload = null;
    cancelPersistSchedule();

    try {
      localStorage.setItem(LOCAL_KEY, JSON.stringify(payload));
      store.savedAt = Number(payload.savedAt) || Date.now();
      cachedSnapshot = payload;
      return true;
    } catch (_) {
      return false;
    }
  }

  function schedulePersist(data) {
    if (!data || typeof data !== 'object') return;

    persistPayload = {
      savedAt: Date.now(),
      menuRevision: Number(data.menuRevision) || 0,
      data,
    };

    // Coalesce multiple fast refreshes into one persistent write.
    if (persistIdleHandle || persistTimer) return;

    if (typeof window.requestIdleCallback === 'function') {
      persistIdleHandle = window.requestIdleCallback(
        () => {
          persistIdleHandle = 0;
          persistNow();
        },
        { timeout: PERSIST_IDLE_TIMEOUT_MS },
      );
    } else {
      persistTimer = window.setTimeout(() => {
        persistTimer = 0;
        persistNow();
      }, PERSIST_FALLBACK_DELAY_MS);
    }
  }

  function isSyntheticOfflinePayload(data) {
    return Boolean(data && typeof data === 'object' && data.offline === true);
  }

  async function fetchFreshMenu() {
    const response = await fetch('/api/menu', {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-cache',
      headers: {
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`menu request failed (${response.status})`);
    }

    const data = await response.json();
    if (!data || typeof data !== 'object') {
      throw new Error('menu request returned invalid JSON');
    }
    return data;
  }

  function keepOfflineSnapshot(error) {
    store.lastError = error || null;

    if (store.data) {
      // The cached/local snapshot was already painted. Do not re-apply it:
      // re-dispatching menu-ready would make boards/hero rebuild for no gain.
      return store;
    }

    if (cachedSnapshot?.data) {
      try {
        return applyData(cachedSnapshot.data, {
          fromCache: true,
          savedAt: cachedSnapshot.savedAt,
        });
      } catch (_) {}
    }

    // Preserve the old contract: ready still resolves to the store even when
    // no menu is available, so Hero/Table fallbacks can continue normally.
    store.data = {
      menuCategories: [],
      menuItems: [],
      siteCategories: [],
    };
    store.byCategory = Object.create(null);
    store.categories = [];
    store.categoryOrder = [];
    store.menuRevision = 0;
    store.fromCache = true;
    window.__westoCategoryOrder = [];
    window.__westoMenuRevision = 0;
    return store;
  }

  function refresh() {
    if (destroyed) return Promise.resolve(store);
    if (inFlight) return inFlight;

    inFlight = fetchFreshMenu()
      .then((data) => {
        // Legacy offline builds returned { offline:true, ... } only when both the
        // network and SW Cache Storage miss. Never let that synthetic empty
        // payload overwrite a valid localStorage snapshot.
        if (isSyntheticOfflinePayload(data)) {
          const error = new Error('menu offline fallback');
          error.code = 'WESTO_MENU_OFFLINE_FALLBACK';
          return keepOfflineSnapshot(error);
        }

        const result = applyData(data, { fromCache: false });
        // Persist after the critical render work, not inside this promise's
        // immediate continuation. Consumers can paint from the fresh object
        // while storage work waits for idle time.
        schedulePersist(data);
        return result;
      })
      .catch((error) => {
        if (!destroyed) console.warn('[westoMenuStore]', error);
        return keepOfflineSnapshot(error);
      })
      .finally(() => {
        inFlight = null;
      });

    return inFlight;
  }

  store.refresh = refresh;
  store.getSnapshot = () => store;

  // The parser-preloaded content bootstrap now carries the exact current
  // guest-menu payload. Prefer it over localStorage and skip the redundant
  // startup /api/menu request entirely. Older/static deployments keep the
  // original cache -> refresh fallback below.
  const bootMenu = window.__WESTO_CONTENT__?.menu;
  if (bootMenu && typeof bootMenu === 'object') {
    try {
      applyData(bootMenu, { fromCache: false });
      schedulePersist(bootMenu);
      store.ready = Promise.resolve(store);
    } catch (error) {
      store.lastError = error;
    }
  }

  if (!store.ready) {
    // Instant user-first hydrate from the last known good snapshot.
    cachedSnapshot = readLocal();
    if (cachedSnapshot?.data) {
      try {
        applyData(cachedSnapshot.data, {
          fromCache: true,
          savedAt: cachedSnapshot.savedAt,
        });
      } catch (_) {}
    }

    // Compatibility path for static/older servers that do not publish
    // window.__WESTO_CONTENT__.menu.
    store.ready = refresh();

    // Keep the existing soft-TTL signal used by the optional background warmer.
    if (
      cachedSnapshot?.savedAt &&
      Date.now() - Number(cachedSnapshot.savedAt) > LOCAL_SOFT_TTL_MS
    ) {
      try {
        localStorage.removeItem('westo_warm_state');
      } catch (_) {}
    }
  }

  // If initial refresh happened while offline, reconnecting should repair the
  // shared store once. inFlight coalescing prevents an online-event burst from
  // creating parallel /api/menu requests.
  function onOnline() {
    if (store.fromCache || store.lastError) refresh();
  }

  function onPageHide() {
    // A fresh menu that has already painted should not be lost just because
    // the idle callback did not run before navigation/close.
    if (persistPayload) persistNow();
  }

  window.addEventListener('online', onOnline, { passive: true });
  window.addEventListener('pagehide', onPageHide);
})();

;/* ===== END js/menu-store.js ===== */

/* ===== BEGIN js/content-overrides.js ===== */
/* Applies admin-edited content before deferred animation scripts run. The
   normal path is parser-preloaded /api/content-bootstrap.js; sync XHR remains
   only as a compatibility fallback for older static deployments. */
(function () {
  var data = window.__WESTO_CONTENT__;
  if (!data) {
    try {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', '/api/content', false);
      xhr.send();
      if (xhr.status !== 200) return;
      data = JSON.parse(xhr.responseText);
    } catch (e) {
      return;
    }
  }
  var content = data.content || {};
  var products = data.products || [];
  var faq = data.faq || [];

  // Original strings baked into the HTML, keyed like the DB. When the admin
  // changes a value, every text node still holding the default is swapped.
  var DEFAULTS = {
    'nav.login': 'ورود',
    'nav.menu': 'منو',
    'nav.contact': 'تماس',
    'nav.sound_on': 'روشن',
    'nav.link.gamme': 'محصولات',
    'nav.link.benefits': 'مزایا',
    'nav.link.faq': 'سؤالات متداول',
    'nav.link.newsletter': 'خبرنامه',
    'nav.copyright': '© ۲۰۲۶ Westo',
    'hero.scroll_hint': 'برای دیدن غذاها اسکرول کنید',
    'ingredients.sugar.badge': '۱۱ گرم شکر',
    'ingredients.sugar.title1': 'شکر',
    'ingredients.sugar.title2': 'کمتر',
    'ingredients.sugar.desc': 'یک نوشیدنی انرژی‌زا با شکر کمتر، فقط با شکر نیشکر؛ انتخاب‌شده به‌خاطر منشأ گیاهی و طعم خوشایندش.',
    'ingredients.aroma.badge': 'طعم‌دهنده‌های مصنوعی',
    'ingredients.aroma.title1': 'طعم‌دهنده‌های',
    'ingredients.aroma.title2': 'طبیعی',
    'ingredients.aroma.desc': 'برای قدرت عطر و غنای طعم، طعم‌دهنده‌های طبیعی برگرفته از میوه‌ها و گیاهان را با وسواس انتخاب کرده‌ایم.',
    'ingredients.caffeine.badge': 'کافئین مصنوعی',
    'ingredients.caffeine.title': 'کافئین از دانه‌های قهوه',
    'ingredients.caffeine.desc': 'برای انرژی، دانه‌های قهوه را انتخاب کرده‌ایم؛ منبع طبیعی کافئین، در کنار گوارانا که آن هم طبیعی است.',
    'ingredients.stevia.badge': 'آسپارتام، سوکرالوز، آسه‌سولفام K',
    'ingredients.stevia.title': 'استویا',
    'ingredients.stevia.desc': 'برای تکمیل شکر نیشکر و افزودن شیرینی و لذت، یک شیرین‌کننده گیاهی با عصاره استویا اضافه کرده‌ایم.',
    'faq.title1': 'سؤالات',
    'faq.title2': 'متداول',
    'newsletter.title': 'به ما بپیوندید',
    'newsletter.desc': 'به جمع ما بپیوندید تا از اخبار و محصولات تازه Westo زودتر از همه باخبر شوید.',
    'newsletter.email_label': 'آدرس ایمیل شما',
    'newsletter.submit': 'ثبت‌نام',
    'newsletter.consent': 'با ثبت‌نام، شما می‌پذیرید:',
    'newsletter.privacy_link': 'سیاست حریم خصوصی',
    'newsletter.success': 'ثبت‌نام شما تأیید شد.',
    'newsletter.error': 'ثبت‌نام شما تأیید نشد.',
    'footer.copyright': '© ۲۰۲۶ Westo',
    'footer.legal': 'اطلاعات حقوقی',
    'footer.cgu': 'شرایط استفاده',
    'footer.privacy': 'سیاست حریم خصوصی',
    'footer.tiktok': 'تیک‌تاک',
    'footer.instagram': 'اینستاگرام',
    'entrance.tagline': 'کافه‌رستوران برای آرامش تو',
    'entrance.subtitle': 'Cafe & Restaurant',
    'entrance.storyLead': 'در حال آماده‌سازی تجربه شما…',
    'entrance.quote': 'هر فنجان قصه‌ای دارد.',
    'entrance.cta': 'ورود به منو',
    'entrance.step.digitalMenu': 'منو دیجیتال',
    'entrance.step.onlineOrder': 'سفارش آنلاین',
    'entrance.step.reserveTable': 'رزرو میز',
    'entrance.step.quickEntry': 'ورود سریع',
  };

  // --- 1) generic text swaps -------------------------------------------
  // Build one replacement table and walk text nodes once. The baseline used
  // a TreeWalker for admin overrides and then a second whole-body element
  // scan for the legacy scroll hint. Keeping both jobs in one text walk avoids
  // a second startup-wide DOM traversal without changing the resulting copy.
  var byDefault = {
    'برای کشف، اسکرول کنید': 'برای دیدن غذاها اسکرول کنید',
  };
  Object.keys(DEFAULTS).forEach(function (key) {
    var def = DEFAULTS[key];
    var val = content[key];
    if (typeof val === 'string' && val !== '' && val !== def) byDefault[def] = val;
  });
  var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  var node;
  while ((node = walker.nextNode())) {
    var trimmed = node.nodeValue.trim();
    if (trimmed && Object.prototype.hasOwnProperty.call(byDefault, trimmed)) {
      node.nodeValue = node.nodeValue.replace(trimmed, byDefault[trimmed]);
    }
  }

  // --- 2) title / meta ---------------------------------------------------
  var siteTitle = (data.settings && data.settings.siteTitle) || '';
  var siteDescription = (data.settings && data.settings.metaDescription) || '';
  if (!siteTitle || /ciao\s*energy/i.test(siteTitle)) siteTitle = 'وستو — منوی کافه و رستوران';
  if ((document.documentElement.lang || 'fa') === 'fa') siteTitle = siteTitle.replace(/^Westo\b/i, 'وستو');
  if (!siteDescription || /ciao\s*energy/i.test(siteDescription)) {
    siteDescription = 'منوی آنلاین وستو؛ دسته‌ها، جزئیات غذاها و ثبت سفارش از سبد.';
  }
  if ((document.documentElement.lang || 'fa') === 'fa') siteDescription = siteDescription.replace(/تیبل/g, 'سبد سفارش');
  document.title = siteTitle;
  var meta = document.querySelector('meta[name="description"]');
  if (meta) meta.setAttribute('content', siteDescription);
  document.querySelectorAll('meta[property="og:title"], meta[name="twitter:title"]').forEach(function (el) {
    el.setAttribute('content', siteTitle);
  });
  document
    .querySelectorAll('meta[property="og:description"], meta[name="twitter:description"]')
    .forEach(function (el) {
      el.setAttribute('content', siteDescription);
    });
  document.querySelectorAll('h1').forEach(function (heading) {
    if (/ciao\s*energy/i.test(heading.textContent || '')) heading.textContent = siteTitle;
  });

  // --- 3) logos ----------------------------------------------------------
  // Prefer Westo cyan brand wordmark over legacy drink-era / gold logos
  var BRAND_WORDMARK = 'assets/images/brand/westo-wordmark.png?v=brandCyan2';
  function isLegacyLogo(path) {
    var p = String(path || '');
    if (!p) return true;
    if (/ciao/i.test(p)) return true;
    if (/westo-logo\.png/i.test(p)) return true;
    if (/6a0af6aee3ae4c7c923b77ca_westo_logo/i.test(p)) return true;
    if (/westo_logo(?:-black)?\.svg/i.test(p)) return true;
    // Only trust paths under brand/ (or explicitly uploaded media that isn't the old gold asset)
    if (/\/brand\//.test(p) || /assets\/images\/brand\//.test(p)) return false;
    // Old hashed webflow logos / warm assets outside brand/
    if (/assets\/images\/6a0/i.test(p)) return true;
    return false;
  }
  var whiteLogo = content['logo.white'] || '';
  var blackLogo = content['logo.black'] || '';
  if (isLegacyLogo(whiteLogo)) whiteLogo = BRAND_WORDMARK;
  if (isLegacyLogo(blackLogo)) blackLogo = BRAND_WORDMARK;
  content['logo.white'] = whiteLogo;
  content['logo.black'] = blackLogo;

  // The old implementation queried every <img> six separate times. Resolve
  // all legacy aliases in one pass; match against the original src so the
  // replacement order cannot cascade.
  Array.prototype.forEach.call(document.images || [], function (img) {
    var src = img.getAttribute('src') || '';
    var replacement = '';
    if (src.indexOf('Ciao-Energy_logo-black.svg') !== -1) replacement = blackLogo;
    else if (src.indexOf('Ciao-Energy_logo.svg') !== -1) replacement = whiteLogo;
    else if (src.indexOf('westo_logo-black.svg') !== -1) replacement = blackLogo;
    else if (src.indexOf('westo_logo.svg') !== -1) replacement = whiteLogo;
    else if (src.indexOf('6a0af6aee3ae4c7c923b77ca_westo_logo.svg') !== -1) replacement = whiteLogo;
    else if (src.indexOf('westo-logo.png') !== -1) replacement = whiteLogo;
    if (replacement) img.src = replacement;
  });
  var DARK_WORDMARK = 'assets/images/brand/westo-fa-wordmark-dark.png?v=brandDark1';
  var LIGHT_WORDMARK = 'assets/images/brand/westo-fa-wordmark.png?v=brandLight1';
  var ENTRANCE_MARK = content['entrance.logo'] || 'assets/images/brand/westo-mark.png?v=brandCyan2';
  var ENTRANCE_WORDMARK_DARK = content['entrance.wordmark.dark'] || LIGHT_WORDMARK;
  var ENTRANCE_WORDMARK_LIGHT = content['entrance.wordmark.light'] || DARK_WORDMARK;
  function updateBrandWordmarks(theme) {
    // Main header/menu retain the approved theme-aware Persian lockup.
    var src = theme === 'light' ? DARK_WORDMARK : LIGHT_WORDMARK;
    document.querySelectorAll('.navbar_logo, .auth-logo, #brand-logo, .navbar_menu-logo').forEach(function (img) {
      img.src = src;
      img.alt = 'Westo';
    });
    // Entrance media is separately admin-editable for each theme.
    document.querySelectorAll('#westo-entrance .eg-brand-wordmark-img, #westo-entrance [data-admin-media="entrance.wordmark"]').forEach(function (img) {
      img.src = theme === 'light' ? ENTRANCE_WORDMARK_LIGHT : ENTRANCE_WORDMARK_DARK;
      img.alt = 'Westo';
    });
  }
  document.querySelectorAll('#westo-entrance .eg-logo, #westo-entrance .eg-logo-png, #westo-entrance .loader_logo').forEach(function (img) {
    img.src = ENTRANCE_MARK;
    img.alt = 'Westo';
  });
  function applyEntranceContent() {
    document.querySelectorAll('#westo-entrance [data-admin-content]').forEach(function (el) {
      var key = el.getAttribute('data-admin-content');
      var value = content[key];
      var lang = (window.westoI18n && window.westoI18n.lang) || document.documentElement.lang || 'fa';
      if (key === 'entrance.subtitle' && lang === 'fa' && /^cafe\s*&\s*restaurant$/i.test(String(value || '').trim())) value = 'کافه و رستوران';
      if (typeof value === 'string' && value.trim()) el.textContent = value;
    });
  }
  updateBrandWordmarks(document.documentElement.getAttribute('data-theme'));
  applyEntranceContent();
  window.addEventListener('westo:theme-change', function (event) {
    updateBrandWordmarks(event.detail && event.detail.theme);
  });
  // i18n dispatches this event on document (non-bubbling), so listen on the
  // actual owner instead of window; this keeps Admin entrance copy authoritative.
  document.addEventListener('westo:langchange', applyEntranceContent);
  var brandTitle = document.getElementById('eg-brand-wordmark') || document.getElementById('eg-brand-name');
  if (brandTitle && !brandTitle.querySelector('img')) {
    brandTitle.innerHTML = '<img class="eg-brand-wordmark-img" data-admin-media="entrance.wordmark" src="' + ENTRANCE_WORDMARK_DARK + '" alt="Westo" />';
  }
  var navbarMenu = document.querySelector('.navbar_menu');
  if (navbarMenu) {
    var menuTextWalker = document.createTreeWalker(navbarMenu, NodeFilter.SHOW_TEXT);
    var menuTextNode;
    while ((menuTextNode = menuTextWalker.nextNode())) {
      var parent = menuTextNode.parentNode;
      if (parent && parent.childNodes.length === 1) {
        menuTextNode.nodeValue = menuTextNode.nodeValue.replace(/CIAO\s+ENERGY/gi, 'WESTO');
      }
    }
  }

  // --- 4) carousel slides from menu categories (same order as 3D cans) ---
  // Prefer siteCategories (cover + visibility applied server-side).
  function hasCover(c) {
    var cover = String((c && c.coverImg) || '').trim();
    return !!cover && !/assets\/textures\/westo_texture_/i.test(cover);
  }
  function buildCarouselProducts() {
    var siteCats = data.siteCategories;
    if (Array.isArray(siteCats) && siteCats.length) {
      return siteCats.filter(hasCover).map(function (c) {
        var title = String(c.title || '').trim();
        return {
          id: c.id,
          menuCategoryId: c.id,
          title: title,
          name1: title,
          name2: '',
          shortDesc: c.shortDesc || '',
          longDesc: c.longDesc || '',
          coverImg: c.coverImg || '',
        };
      });
    }
    if (Array.isArray(products) && products.length && products[0] && products[0].menuCategoryId != null) {
      return products.map(function (p) {
        var title = String(p.title || p.name1 || '').trim();
        return Object.assign({}, p, { title: title, name1: title, name2: '' });
      });
    }
    return (data.menuCategories || [])
      .filter(function (c) {
        return c && !c.hiddenOnSite && hasCover(c);
      })
      .map(function (c) {
        var title = String(c.title || '').trim();
        return {
          id: c.id,
          menuCategoryId: c.id,
          title: title,
          name1: title,
          name2: '',
          shortDesc: c.shortDesc || '',
          longDesc: c.longDesc || '',
          coverImg: c.coverImg || '',
        };
      });
  }
  products = buildCarouselProducts();
  if (typeof data.menuRevision === 'number') {
    window.__westoMenuRevision = data.menuRevision;
  }
  window.__westoSlideCategoryOrder = products.map(function (p) {
    return Number(p.menuCategoryId);
  });
  // Slides differ per list: hero uses .carousel_slide, the desc lists use
  // .carousel_desc / .carousel_title-b — so walk direct children instead.
  // Each list is grown by cloning so there is one slide per active category.
  // Taste colors are keyed by stable categoryId via westoCategoryTheme.
  document.querySelectorAll('.carousel_list').forEach(function (list) {
    var isHero = list.classList.contains('is-hero');
    if (!list.children.length || !products.length) return;
    while (list.children.length < products.length) {
      list.appendChild(list.children[0].cloneNode(true));
    }
    while (list.children.length > products.length) {
      list.removeChild(list.lastElementChild);
    }
    Array.prototype.forEach.call(list.children, function (slide, i) {
      var p = products[i];
      if (!p) {
        slide.style.display = 'none';
        return;
      }
      slide.style.display = '';
      if (p.menuCategoryId != null) slide.setAttribute('data-menu-cat-id', String(p.menuCategoryId));
      if (p.coverImg) slide.setAttribute('data-cover-img', String(p.coverImg));
      var spans = slide.querySelectorAll('[data-anim="chars-mask"]');
      var faTitle = String(p.title || p.name1 || '')
        .replace(/\s+/g, ' ')
        .trim();
      slide.setAttribute('data-cat-fa', faTitle);
      if (p.shortDesc) slide.setAttribute('data-cat-desc-fa', p.shortDesc);
      if (p.longDesc) slide.setAttribute('data-cat-long-fa', p.longDesc);
      var titleRoot = slide.querySelector('.heading-style-h2') || slide;
      var br = titleRoot.querySelector('br');
      var displayTitle = faTitle;
      if (window.westoI18n && typeof window.westoI18n.catTitleFromFa === 'function') {
        displayTitle = window.westoI18n.catTitleFromFa(faTitle) || faTitle;
      }
      if (spans[0] && spans[1]) {
        spans[0].textContent = displayTitle;
        spans[1].textContent = '';
        spans[1].style.display = 'none';
        if (br) br.style.display = 'none';
      } else if (spans[0]) {
        spans[0].textContent = displayTitle;
      }
      var longDesc = slide.querySelector('.profile_desc p');
      if (longDesc) {
        longDesc.textContent = p.longDesc;
      } else if (isHero) {
        var shortDesc = slide.querySelector('p');
        if (shortDesc) shortDesc.textContent = p.shortDesc;
      }
      var tasteApi = window.westoCategoryTheme;
      var taste = tasteApi && typeof tasteApi.tasteFor === 'function'
        ? tasteApi.tasteFor(p.menuCategoryId)
        : null;
      if (taste) {
        slide.dataset.tastePrimary = taste.primary;
        slide.dataset.tasteSecondary = taste.secondary;
        if (taste.slug) slide.dataset.catSlug = taste.slug;
      }
    });
  });

  if (window.westoI18n && typeof window.westoI18n.localizeHeroTitles === 'function') {
    window.westoI18n.localizeHeroTitles();
  }

  // --- 5) FAQ (rebuild list from API so add/remove/reorder works) --------
  var faqList = document.querySelector('.faq_list');
  if (faqList && faq.length) {
    var items = faqList.querySelectorAll(':scope > .w-dyn-item');
    if (items.length) {
      var template = items[0];
      // grow / shrink to match. Track the count locally instead of
      // re-running a scoped selector after every clone.
      var itemCount = items.length;
      while (itemCount < faq.length) {
        faqList.appendChild(template.cloneNode(true));
        itemCount += 1;
      }
      var current = faqList.querySelectorAll(':scope > .w-dyn-item');
      current.forEach(function (item, i) {
        if (i >= faq.length) { item.remove(); return; }
        var q = item.querySelector('.faq_question .heading-style-h5');
        var a = item.querySelector('.faq_answer p');
        if (q) q.textContent = String(faq[i].q || '').replace(/تیبل/g, 'سبد سفارش');
        if (a) a.textContent = String(faq[i].a || '').replace(/تیبل/g, 'سبد سفارش');
      });
    }
  }


  // --- 5.1) FAQ accordion keyboard + aria-expanded --------------------
  function enhanceFaqA11y() {
    document.querySelectorAll('.section.is-faq .faq_accordion').forEach(function (acc) {
      var q = acc.querySelector('.faq_question');
      var a = acc.querySelector('.faq_answer');
      if (!q || !a || q.dataset.a11yBound) return;
      q.dataset.a11yBound = '1';
      q.setAttribute('role', 'button');
      q.setAttribute('tabindex', '0');
      function sync() {
        var h = a.style.height;
        var open = h && h !== '0px';
        q.setAttribute('aria-expanded', open ? 'true' : 'false');
      }
      sync();
      q.addEventListener('click', function () {
        requestAnimationFrame(function () { setTimeout(sync, 400); });
      });
      q.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          q.click();
        }
      });
    });
  }
  enhanceFaqA11y();

  // Cafe menu story: prefer category wording over drink-era «محصولات»
  document.querySelectorAll('a.navbar_link[href="#gamme"]').forEach(function (a) {
    if ((a.textContent || '').trim() === 'محصولات') a.textContent = 'دسته‌ها';
  });
  function paintGuestChrome() {
    if (!window.westoI18n || !window.westoI18n.t) return;
    if (typeof window.westoI18n.paintStaticI18n === 'function') {
      window.westoI18n.paintStaticI18n();
    }
    var scrollHint = document.querySelector('.scroll_discover');
    if (scrollHint) {
      scrollHint.textContent = window.westoI18n.t('hero.scroll');
      var spread = Math.max(28, (scrollHint.textContent || '').trim().length * 2);
      scrollHint.style.setProperty('--shimmer-spread', spread + 'px');
    }
    document.querySelectorAll('a.navbar_link[href="#gamme"] .navbar_link-label').forEach(function (label) {
      label.textContent = window.westoI18n.t('nav.categories');
    });
    var menuLabel = document.querySelector('.navbar_menu-button .text-block');
    if (menuLabel) menuLabel.textContent = window.westoI18n.t('nav.menu');
    var auth = document.querySelector('#nav-auth-btn div');
    if (auth) auth.textContent = window.westoI18n.t('nav.login');
  }
  paintGuestChrome();
  document.addEventListener('westo:langchange', paintGuestChrome);

  // --- 5.5) dish boards are populated from the shared model in table-cart.js ---

  // --- 6) newsletter form → local API (Brevo removed) --------------------
  document.addEventListener('DOMContentLoaded', function () {
    var form = document.getElementById('sib-form');
    if (!form) return;
    var success = document.getElementById('success-message');
    var error = document.getElementById('error-message');
    function panel(el, show) {
      if (!el) return;
      el.style.display = show ? 'inline-block' : 'none';
      if (show) el.classList.add('sib-form-message-panel--active');
      else el.classList.remove('sib-form-message-panel--active');
    }
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      e.stopImmediatePropagation();
      var email = (form.querySelector('#EMAIL') || {}).value || '';
      fetch('/api/newsletter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      })
        .then(function (r) { return r.ok ? r.json() : Promise.reject(); })
        .then(function () { panel(error, false); panel(success, true); form.reset(); })
        .catch(function () { panel(success, false); panel(error, true); });
    }, true);
  });
})();

;/* ===== END js/content-overrides.js ===== */

/* ===== BEGIN js/theme.js ===== */
/* Sitewide theme preference: dark | light | system.
   Resolved appearance lives on html[data-theme]; preference on html[data-theme-pref]
   and localStorage westo_theme. Manual picks stick; "system" tracks OS.

   Performance/lifecycle notes:
   - the inline <head> bootstrap already paints the initial theme before CSS;
   - this runtime layer therefore avoids rewriting identical attributes/styles;
   - theme controls/meta nodes are cached after first discovery;
   - semantic westo:theme-change events are still emitted on every apply(),
     matching the stable public contract even when the resolved value is unchanged. */
(function () {
  'use strict';

  const IS_ADMIN = /^\/admin\/?$/.test(window.location.pathname);
  const KEY = IS_ADMIN ? 'westo_admin_theme' : 'westo_theme';
  const DEFAULT_PREF = IS_ADMIN ? 'light' : 'system';
  const PREFS = new Set(['dark', 'light', 'system']);
  const THEME_COLOR = Object.freeze({
    dark: '#121416',
    light: IS_ADMIN ? '#f4f5f7' : '#e8e0d4',
  });

  const root = document.documentElement;
  const mq =
    typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-color-scheme: light)')
      : null;

  let themeButtons = null;
  let themeColorMeta = null;
  let buttonsBound = false;
  let destroyed = false;

  function normalizePref(mode) {
    const value = String(mode || '').toLowerCase();
    return PREFS.has(value) ? value : 'system';
  }

  function systemResolved() {
    try {
      return mq && mq.matches ? 'light' : 'dark';
    } catch (_) {
      return 'dark';
    }
  }

  function resolve(pref) {
    const normalized = normalizePref(pref);
    return normalized === 'system' ? systemResolved() : normalized;
  }

  function readStored() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw == null || raw === '') return DEFAULT_PREF;
      return PREFS.has(String(raw).toLowerCase()) ? normalizePref(raw) : DEFAULT_PREF;
    } catch (_) {
      return DEFAULT_PREF;
    }
  }

  function writeStored(pref) {
    try {
      // localStorage is synchronous. Avoid an unnecessary write when a caller
      // reapplies the currently persisted preference.
      if (localStorage.getItem(KEY) !== pref) {
        localStorage.setItem(KEY, pref);
      }
    } catch (_) {}
  }

  function setAttributeIfChanged(node, name, value) {
    if (!node) return false;
    if (node.getAttribute(name) === value) return false;
    node.setAttribute(name, value);
    return true;
  }

  function getThemeButtons() {
    if (
      themeButtons &&
      themeButtons.length &&
      themeButtons.every((button) => button && button.isConnected !== false)
    ) {
      return themeButtons;
    }

    themeButtons = Array.from(document.querySelectorAll('[data-theme-set]'));
    return themeButtons;
  }

  function getThemeColorMeta() {
    if (themeColorMeta && themeColorMeta.isConnected !== false) {
      return themeColorMeta;
    }
    themeColorMeta = document.querySelector('meta[name="theme-color"]');
    return themeColorMeta;
  }

  function syncButtons(pref) {
    const normalized = normalizePref(pref);
    const buttons = getThemeButtons();

    for (const button of buttons) {
      const active = button.getAttribute('data-theme-set') === normalized;
      const pressed = active ? 'true' : 'false';

      setAttributeIfChanged(button, 'aria-pressed', pressed);
      if (button.classList.contains('is-active') !== active) {
        button.classList.toggle('is-active', active);
      }
    }
  }

  function syncThemeColor(resolved) {
    const meta = getThemeColorMeta();
    if (!meta) return;
    setAttributeIfChanged(
      meta,
      'content',
      THEME_COLOR[resolved] || THEME_COLOR.dark,
    );
  }

  function dispatchThemeChange(resolved, pref) {
    window.dispatchEvent(
      new CustomEvent('westo:theme-change', {
        detail: { theme: resolved, pref },
      }),
    );
  }

  function apply(pref, { persist = true } = {}) {
    const nextPref = normalizePref(pref);
    const resolved = resolve(nextPref);

    // The early inline bootstrap normally set both of these already. Keeping
    // identical values out of setAttribute prevents needless style invalidation.
    setAttributeIfChanged(root, 'data-theme-pref', nextPref);
    setAttributeIfChanged(root, 'data-theme', resolved);

    if (persist) writeStored(nextPref);

    syncButtons(nextPref);
    syncThemeColor(resolved);

    // Preserve stable semantics: consumers may use this as an explicit
    // "reapply theme-dependent chrome" signal, not merely as a value change.
    dispatchThemeChange(resolved, nextPref);
    return resolved;
  }

  const api = {
    get() {
      return resolve(root.getAttribute('data-theme-pref') || readStored());
    },

    getPref() {
      return normalizePref(
        root.getAttribute('data-theme-pref') || readStored(),
      );
    },

    set(mode) {
      return apply(mode, { persist: true });
    },

    toggle() {
      const current = api.get();
      return api.set(current === 'light' ? 'dark' : 'light');
    },

    sync() {
      syncButtons(api.getPref());
      syncThemeColor(api.get());
    },
  };

  window.westoTheme = api;

  function onThemeButtonClick(event) {
    const button = event.currentTarget;
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    api.set(button.getAttribute('data-theme-set'));
  }

  function bindButtons() {
    if (destroyed) return;

    const buttons = getThemeButtons();
    for (const button of buttons) {
      if (button.dataset.themeBound === '1') continue;
      button.dataset.themeBound = '1';
      button.addEventListener('click', onThemeButtonClick);
    }

    buttonsBound = buttonsBound || buttons.length > 0;
    syncButtons(api.getPref());
    syncThemeColor(api.get());
  }

  function onSystemChange() {
    if (destroyed || api.getPref() !== 'system') return;
    apply('system', { persist: false });
  }

  function onPageShow(event) {
    if (destroyed || !event || !event.persisted) return;

    // bfcache can restore DOM attributes/classes exactly as they were frozen.
    // If the OS appearance changed while a system-pref page was frozen, use
    // apply() so brand/category consumers receive the same semantic event they
    // would receive from a live matchMedia change. Otherwise a cheap sync is
    // sufficient and avoids redundant downstream work.
    if (api.getPref() === 'system') {
      const resolved = resolve('system');
      if (root.getAttribute('data-theme') !== resolved) {
        apply('system', { persist: false });
        return;
      }
    }

    api.sync();
  }

  // The inline head bootstrap has already resolved first paint. This call
  // establishes the runtime API, controls/meta state and the historical
  // westo:theme-change notification for downstream modules.
  apply(readStored(), { persist: false });

  if (mq) {
    if (typeof mq.addEventListener === 'function') {
      mq.addEventListener('change', onSystemChange);
    } else if (typeof mq.addListener === 'function') {
      mq.addListener(onSystemChange);
    }
  }

  // On index.html this file is defer-loaded, so the DOM is already parsed.
  // On admin.html it is a normal script at the end of <body>. The fallback
  // keeps the module safe if its placement changes in a future build.
  if (document.readyState === 'loading') {
    const existingButtons = document.querySelectorAll('[data-theme-set]');
    if (existingButtons.length) {
      themeButtons = Array.from(existingButtons);
      bindButtons();
    } else {
      document.addEventListener('DOMContentLoaded', bindButtons, { once: true });
    }
  } else {
    bindButtons();
  }

  window.addEventListener('pageshow', onPageShow);

  // Expose no extra public behavior; this is only a lifecycle safety path for
  // real navigations. bfcache pages are preserved and resume through pageshow.
  window.addEventListener('pagehide', (event) => {
    if (event && event.persisted) return;
    destroyed = true;
  });
})();

;/* ===== END js/theme.js ===== */

/* ===== BEGIN js/westo-entrance.js ===== */
/**
 * WESTO Immersive Entrance — visual phases + ambient FX.
 * Gate I/O (sheet, fillGate, enter) stays in animations.js;
 * this module owns brand reveal, story loader, parallax, particles,
 * and cinematic exit hooks.
 */
(function (global) {
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => [...(r || document).querySelectorAll(s)];

  let root = null;
  let gsap = null;
  let reduced = false;
  let particlesRaf = 0;
  let particlesTimer = 0;
  let particlesResizeRaf = 0;
  let particlesLastTime = 0;
  let particleIntervalMs = 1000 / 30;
  let bootTimer = 0;
  let initialized = false;
  let progressTween = null;
  let storyTween = null;
  let parallaxBound = false;
  let steamExpandTl = null;
  let particlesRunning = false;
  let onParticlesVis = null;
  let parallaxMove = null;
  let parallaxLeave = null;
  let parallaxRaf = 0;
  let particlesResize = null;
  let onPerformanceTier = null;
  let onThermalIdle = null;
  let onThermalWake = null;

  const state = {
    progress: 0,
    step: -1,
    ready: false,
    phase: 0,
  };

  function tr(key, vars) {
    return global.westoI18n?.t ? global.westoI18n.t(key, vars) : key;
  }

  const DEFAULT_PATTERN = 'assets/images/entrance/westo-pattern.webp';

  function applyPatternAsset() {
    if (!root) return;
    let src = String(global.__WESTO_CONTENT__?.content?.['entrance.pattern'] || DEFAULT_PATTERN).trim();
    if (!/^(?:\/|assets\/|uploads\/|https?:\/\/)/i.test(src)) src = DEFAULT_PATTERN;
    src = src.replace(/[\"'\n\r\\]/g, '');
    if (!src) src = DEFAULT_PATTERN;
    try { src = new URL(src, document.baseURI).href; } catch (_) {}
    const apply = (resolved) => {
      const asset = String(resolved || src);
      root.style.setProperty('--eg-pattern-image', `url("${asset}")`);
      root.dataset.egPattern = asset;
    };
    const scheduler = global.WestoResources;
    if (!scheduler?.requestImage) {
      apply(src);
      return;
    }
    // Decoration is non-blocking and follows the same WebP-only policy as
    // menu media. The CSS variable is written only after the image resolves.
    scheduler.requestImage(src, {
      priority: scheduler.priorities?.NEAR,
      group: 'entrance-pattern',
      kind: 'image',
    }).then((result) => apply(result?.url)).catch(() => apply(src));
  }

  /* —— Brand logo reveal (PNG + steam) —— */
  function playLogoReveal() {
    const png = $('.eg-logo-png', root);
    const stage = $('[data-eg-logo]', root);
    const title = $('.eg-brand-title', root);
    const tag = $('.eg-tagline', root);
    const sub = $('.eg-subtitle', root);

    if (!gsap) {
      if (png) png.style.opacity = '1';
      root?.classList.add('is-steam-on');
      return;
    }

    gsap.set([stage, title, tag, sub].filter(Boolean), { autoAlpha: 0, y: 16, scale: 0.92 });
    if (stage) gsap.set(stage, { scale: 0.85 });
    if (png) gsap.set(png, { autoAlpha: 0, scale: 0.92 });

    const tl = gsap.timeline({ defaults: { ease: 'power2.out' } });
    tl.to(stage, { autoAlpha: 1, scale: 1, duration: 0.55 }, 0);
    tl.to(
      png,
      {
        autoAlpha: 1,
        scale: 1,
        duration: 0.85,
        ease: 'power2.out',
        onStart: () => root?.classList.add('is-steam-on'),
      },
      0.2,
    );
    tl.to(
      [title, tag, sub].filter(Boolean),
      { autoAlpha: 1, y: 0, duration: 0.7, stagger: 0.08 },
      0.45,
    );

    return tl;
  }

  /* —— Particles (lightweight canvas) —— */
  function stopParticles() {
    particlesRunning = false;
    particlesLastTime = 0;
    if (particlesTimer) {
      clearTimeout(particlesTimer);
      particlesTimer = 0;
    }
    if (particlesRaf) {
      cancelAnimationFrame(particlesRaf);
      particlesRaf = 0;
    }
  }

  function initParticles() {
    const canvas = $('#eg-particles', root);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const isMobile = () => window.innerWidth < 768;
    let parts = [];
    let w = 0;
    let h = 0;

    const resizeNow = () => {
      w = canvas.clientWidth || window.innerWidth;
      h = canvas.clientHeight || window.innerHeight;
      const perf = global.westoPerformance;
      const tier = perf?.tier || 'balanced';
      const maxDpr = Math.min(Number(perf?.quality?.maxDpr) || 1.25, isMobile() ? 1 : 1.25);
      // The old loop painted at 20fps on economy and 30fps otherwise while
      // still waking requestAnimationFrame at display refresh rate. Keep the
      // exact visible cadence, but only wake the canvas when a paint is due.
      particleIntervalMs = tier === 'balanced' ? 1000 / 24 : 1000 / 30;
      const dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const n = reduced
        ? 0
        : tier === 'economy'
          ? 0
          : tier === 'balanced'
            ? isMobile()
              ? 3
              : 6
            : isMobile()
              ? 4
              : 10;
      parts = Array.from({ length: n }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        r: 0.6 + Math.random() * 1.6,
        a: 0.12 + Math.random() * 0.28,
        vy: -0.12 - Math.random() * 0.28,
        vx: (Math.random() - 0.5) * 0.15,
      }));
    };

    particlesResize = () => {
      if (particlesResizeRaf) return;
      particlesResizeRaf = requestAnimationFrame(() => {
        particlesResizeRaf = 0;
        if (!root || root.hidden) return;
        resizeNow();
      });
    };

    const queueNextPaint = () => {
      if (
        !particlesRunning ||
        particlesTimer ||
        particlesRaf ||
        !root ||
        root.hidden ||
        document.visibilityState === 'hidden'
      ) {
        return;
      }
      // Compensate for the average wait until the next display frame so the
      // actual paint cadence remains close to the previous 20/30fps output.
      const timerDelay = Math.max(0, particleIntervalMs - 9);
      particlesTimer = window.setTimeout(() => {
        particlesTimer = 0;
        if (!particlesRunning || !root || root.hidden || document.visibilityState === 'hidden') {
          return;
        }
        particlesRaf = requestAnimationFrame(tick);
      }, timerDelay);
    };

    const tick = (now) => {
      particlesRaf = 0;
      if (!particlesRunning || !root || root.hidden || document.visibilityState === 'hidden') {
        return;
      }

      // Position used to advance on every 60Hz RAF even though only every
      // second/third frame was painted. Scale by elapsed 60Hz frames so the
      // visible drift speed remains the same at the lower wake cadence.
      const elapsed = particlesLastTime ? now - particlesLastTime : particleIntervalMs;
      particlesLastTime = now;
      const step = Math.max(0.5, Math.min(4, elapsed / (1000 / 60)));

      ctx.clearRect(0, 0, w, h);
      const light = document.documentElement.getAttribute('data-theme') === 'light';
      for (let i = 0; i < parts.length; i += 1) {
        const p = parts[i];
        p.x += p.vx * step;
        p.y += p.vy * step;
        if (p.y < -4) {
          p.y = h + 4;
          p.x = Math.random() * w;
        }
        if (p.x < -4) p.x = w + 4;
        if (p.x > w + 4) p.x = -4;
        ctx.beginPath();
        ctx.fillStyle = light
          ? `rgba(42,122,134,${p.a * 0.9})`
          : `rgba(120,208,216,${p.a})`;
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
      queueNextPaint();
    };

    const start = () => {
      if (reduced || !parts.length || particlesRunning || !root || root.hidden) return;
      particlesRunning = true;
      particlesLastTime = 0;
      if (!particlesRaf && !particlesTimer) particlesRaf = requestAnimationFrame(tick);
    };

    resizeNow();
    window.addEventListener('resize', particlesResize, { passive: true });
    onPerformanceTier = () => {
      resizeNow();
      if (global.westoPerformance?.isEconomy) {
        unbindParallax();
        stopParticles();
      } else {
        start();
      }
    };
    window.addEventListener('westo:performance-tier', onPerformanceTier);
    onParticlesVis = () => {
      if (document.visibilityState === 'hidden' || root?.hidden) stopParticles();
      else start();
    };
    document.addEventListener('visibilitychange', onParticlesVis);
    onThermalIdle = () => stopParticles();
    onThermalWake = () => {
      if (!global.westoPerformance?.isEconomy && document.visibilityState !== 'hidden' && !root?.hidden) start();
    };
    window.addEventListener('westo:thermal-idle', onThermalIdle);
    window.addEventListener('westo:thermal-wake', onThermalWake);
    if (document.documentElement.dataset.thermalIdle !== 'true') start();
  }

  function unbindParallax() {
    if (!parallaxBound) return;
    if (parallaxMove) window.removeEventListener('pointermove', parallaxMove);
    if (parallaxLeave) window.removeEventListener('pointerleave', parallaxLeave);
    parallaxMove = null;
    parallaxLeave = null;
    if (parallaxRaf) cancelAnimationFrame(parallaxRaf);
    parallaxRaf = 0;
    parallaxBound = false;
  }

  function destroyFx() {
    stopParticles();
    unbindParallax();
    if (bootTimer) {
      clearTimeout(bootTimer);
      bootTimer = 0;
    }
    if (particlesResizeRaf) {
      cancelAnimationFrame(particlesResizeRaf);
      particlesResizeRaf = 0;
    }
    progressTween?.kill?.();
    storyTween?.kill?.();
    steamExpandTl?.kill?.();
    progressTween = null;
    storyTween = null;
    steamExpandTl = null;
    if (onParticlesVis) {
      document.removeEventListener('visibilitychange', onParticlesVis);
      onParticlesVis = null;
    }
    if (particlesResize) {
      window.removeEventListener('resize', particlesResize);
      particlesResize = null;
    }
    if (onPerformanceTier) {
      window.removeEventListener('westo:performance-tier', onPerformanceTier);
      onPerformanceTier = null;
    }
    if (onThermalIdle) {
      window.removeEventListener('westo:thermal-idle', onThermalIdle);
      onThermalIdle = null;
    }
    if (onThermalWake) {
      window.removeEventListener('westo:thermal-wake', onThermalWake);
      onThermalWake = null;
    }
    root?.classList.add('is-fx-off');
  }

  /* —— Story loader + progress —— */
  function setProgress(pct) {
    const p = Math.max(0, Math.min(100, Math.round(pct)));
    state.progress = p;
    const cta = $('#eg-enter', root);
    const label = $('#eg-progress-pct', root);
    const bar = $('#eg-progress', root);
    if (cta) {
      cta.style.setProperty('--eg-progress', `${p}%`);
      cta.dataset.progress = String(p);
      cta.setAttribute('aria-busy', p < 100 ? 'true' : 'false');
    }
    if (label) label.textContent = `${p}%`;
    if (bar) {
      bar.setAttribute('aria-valuenow', String(p));
      bar.textContent = `${p}%`;
    }
  }

  function setStep(index) {
    state.step = index;
    $$('[data-eg-step]', root).forEach((el) => {
      const i = Number(el.getAttribute('data-eg-step'));
      el.classList.toggle('is-active', i === index);
      el.classList.toggle('is-done', i < index);
    });
    const keys = ['eg.feature.digitalMenu', 'eg.feature.onlineOrder', 'eg.feature.reserveTable', 'eg.feature.quickEntry'];
    $$('.eg-step-icon[data-eg-step]', root).forEach((el) => {
      const i = Number(el.getAttribute('data-eg-step'));
      const key = keys[i];
      if (key) el.setAttribute('aria-label', tr(key));
    });
  }

  function startExperienceLoader() {
    setStep(0);

    // Scene may already be ready (carousel:ready before the ~1.6s delay).
    // Never re-clamp a finished loader back to 92%.
    if (state.ready) {
      setProgress(100);
      setStep(3);
      return;
    }

    setProgress(0);

    if (!gsap || reduced) {
      setProgress(100);
      setStep(3);
      return;
    }

    const proxy = { p: 0 };
    progressTween?.kill?.();
    storyTween?.kill?.();

    progressTween = gsap.to(proxy, {
      p: 92,
      duration: 4.2,
      ease: 'power1.out',
      onUpdate: () => {
        if (state.ready) return;
        setProgress(proxy.p);
      },
    });

    storyTween = gsap.timeline();
    [0, 1, 2, 3].forEach((i) => {
      storyTween.call(
        () => {
          if (!state.ready) setStep(i);
        },
        null,
        i * 0.95,
      );
    });
  }

  function completeExperienceLoader() {
    if (state.ready && state.progress >= 100) {
      setStep(3);
      return;
    }
    state.ready = true;
    root?.classList.add('is-experience-ready');
    progressTween?.kill?.();
    storyTween?.kill?.();
    if (gsap) {
      const proxy = { p: Math.max(state.progress, 0) };
      progressTween = gsap.to(proxy, {
        p: 100,
        duration: 0.45,
        ease: 'power2.out',
        onUpdate: () => setProgress(proxy.p),
        onComplete: () => {
          setProgress(100);
          setStep(3);
        },
      });
    } else {
      setProgress(100);
      setStep(3);
    }
  }

  /* —— Parallax —— */
  function bindParallax() {
    if (parallaxBound || !gsap || reduced) return;
    if (global.westoPerformance?.isEconomy) return;
    const card = $('[data-eg-card]', root);
    const logo = $('[data-eg-logo]', root);
    const reflect = $('.eg-card__reflect', root);
    if (!card) return;
    if (window.matchMedia('(max-width: 767px)').matches) return;

    parallaxBound = true;
    // quickTo/resetTo cannot reset individual 3D transform components in the
    // bundled GSAP build. A tiny damped loop keeps the same soft tilt without
    // warning spam or allocating a tween on every pointer event.
    const setRotX = gsap.quickSetter(card, 'rotationX', 'deg');
    const setRotY = gsap.quickSetter(card, 'rotationY', 'deg');
    const tilt = { x: 0, y: 0, targetX: 0, targetY: 0 };
    const renderTilt = () => {
      parallaxRaf = 0;
      tilt.x += (tilt.targetX - tilt.x) * 0.16;
      tilt.y += (tilt.targetY - tilt.y) * 0.16;
      setRotX(tilt.x);
      setRotY(tilt.y);
      if (Math.abs(tilt.targetX - tilt.x) > 0.01 || Math.abs(tilt.targetY - tilt.y) > 0.01) {
        parallaxRaf = requestAnimationFrame(renderTilt);
      }
    };
    const rotX = (value) => {
      tilt.targetX = value;
      if (!parallaxRaf) parallaxRaf = requestAnimationFrame(renderTilt);
    };
    const rotY = (value) => {
      tilt.targetY = value;
      if (!parallaxRaf) parallaxRaf = requestAnimationFrame(renderTilt);
    };
    const logoX = logo ? gsap.quickTo(logo, 'x', { duration: 0.55, ease: 'power3.out' }) : null;
    const logoY = logo ? gsap.quickTo(logo, 'y', { duration: 0.55, ease: 'power3.out' }) : null;

    parallaxMove = (e) => {
      if (root?.hidden || document.visibilityState === 'hidden') return;
      const nx = (e.clientX / window.innerWidth) * 2 - 1;
      const ny = (e.clientY / window.innerHeight) * 2 - 1;
      rotY(nx * 3);
      rotX(-ny * 2.4);
      logoX?.(nx * 5);
      logoY?.(ny * 4);
      if (reflect) {
        reflect.style.backgroundPosition = `${50 + nx * 18}% ${40 + ny * 12}%`;
      }
    };

    parallaxLeave = () => {
      rotX(0);
      rotY(0);
      logoX?.(0);
      logoY?.(0);
    };

    window.addEventListener('pointermove', parallaxMove, { passive: true });
    window.addEventListener('pointerleave', parallaxLeave, { passive: true });
    gsap.set(card, { transformPerspective: 1100 });
  }

  /* —— Cinematic exit helpers —— */
  function playExitPrelude() {
    // Kill continuous FX before the exit timeline so GPU cools during the handoff.
    destroyFx();
    if (!gsap || !root) return Promise.resolve();
    const card = $('[data-eg-card]', root);
    const steam = $('.eg-steam', root);
    const ambient = $('.eg-ambient', root);
    const logo = $('[data-eg-logo]', root);
    const cup = $('.eg-cup-stage', root);

    steamExpandTl?.kill?.();
    steamExpandTl = gsap.timeline({ defaults: { ease: 'power2.inOut' } });
    if (steam) {
      steamExpandTl.to(steam, { scale: 3.2, autoAlpha: 0, duration: 0.55 }, 0);
    }
    if (cup) {
      steamExpandTl.to(cup, { autoAlpha: 0, x: -40, duration: 0.5 }, 0);
    }
    if (logo) {
      steamExpandTl.to(logo, { y: -36, scale: 0.72, autoAlpha: 0.35, duration: 0.65 }, 0.05);
    }
    if (card) {
      steamExpandTl.to(card, { autoAlpha: 0, y: 28, scale: 0.96, duration: 0.6 }, 0.12);
    }
    if (ambient) {
      steamExpandTl.to(ambient, { autoAlpha: 0, duration: 0.7 }, 0.18);
    }
    return new Promise((resolve) => {
      steamExpandTl.eventCallback('onComplete', resolve);
      if (steamExpandTl.duration() === 0) resolve();
    });
  }

  function applyStatusUi({ open, loading, label, meta, location }) {
    const statusEl = $('[data-eg="status"]', root);
    const statusLabel = $('[data-eg="status-label"]', root);
    const statusMeta = $('[data-eg="status-meta"]', root);
    const statusLoc = $('[data-eg="status-loc"]', root);
    if (!statusEl) return;
    statusEl.classList.toggle('is-loading', !!loading);
    statusEl.classList.toggle('is-open', !loading && !!open);
    statusEl.classList.toggle('is-closed', !loading && !open);
    if (statusLabel && label != null) statusLabel.textContent = label;
    if (statusMeta) statusMeta.textContent = meta || '';
    if (statusLoc) statusLoc.textContent = location || '';
  }

  function bootPhases() {
    state.phase = 1;
    playLogoReveal();
    // Phase 2 status is filled by animations.js fillGate — show loading until then
    applyStatusUi({
      loading: true,
      open: false,
      label: tr('eg.statusPreparing'),
      meta: '',
    });
    if (bootTimer) clearTimeout(bootTimer);
    bootTimer = window.setTimeout(() => {
      bootTimer = 0;
      if (!root || root.hidden) return;
      state.phase = 3;
      startExperienceLoader();
    }, reduced ? 200 : 1600);
  }

  function init(opts = {}) {
    const nextRoot = document.getElementById('westo-entrance') || $('.loader.entrance-gate');
    if (!nextRoot) return null;
    // animations.js is the gate owner. If Webflow or a recovery path asks for
    // init again on the same gate, do not duplicate listeners/RAF/timelines.
    if (initialized && root === nextRoot) return api;
    if (initialized && root !== nextRoot) destroyFx();
    root = nextRoot;
    initialized = true;
    root.classList.remove('is-fx-off');
    gsap = opts.gsap || global.gsap;
    reduced = Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches);
    applyPatternAsset();

    // Initial hide for staged reveal
    if (gsap) {
      gsap.set(['.eg-card', '.eg-top', '.eg-foot', '.eg-experience'], {
        autoAlpha: 0,
      });
      gsap.to(['.eg-top', '.eg-foot'], {
        autoAlpha: 1,
        duration: 0.7,
        stagger: 0.08,
        delay: 0.15,
        ease: 'power3.out',
      });
      gsap.to('.eg-card', {
        autoAlpha: 1,
        duration: 0.85,
        delay: 0.2,
        ease: 'power3.out',
      });
      gsap.to('.eg-experience', {
        autoAlpha: 1,
        duration: 0.6,
        delay: 1.2,
        ease: 'power2.out',
      });
    }

    initParticles();
    bindParallax();
    bootPhases();

    return api;
  }

  const api = {
    init,
    setProgress,
    setStep,
    completeExperienceLoader,
    playExitPrelude,
    destroyFx,
    applyStatusUi,
    getState: () => ({ ...state }),
  };

  global.westoEntrance = api;
})(typeof window !== 'undefined' ? window : globalThis);

;/* ===== END js/westo-entrance.js ===== */

/* ===== BEGIN js/entrance-promo-deck.js ===== */
/* WESTO Entrance Promo Deck v14.4 — tactile fan, drag and circular stack. */
(function () {
  'use strict';

  const entrance = document.getElementById('westo-entrance');
  const experience = entrance?.querySelector('.eg-experience');
  if (!entrance || !experience) return;

  const allSlides = Array.isArray(window.__WESTO_CONTENT__?.promoSlides)
    ? window.__WESTO_CONTENT__.promoSlides
    : [];
  const branchId = Number(window.__WESTO_CONTENT__?.restaurantPayload?.branch?.id || 0) || null;
  const slides = allSlides
    .filter((slide) => slide && ['entrance','both'].includes(String(slide.placement || 'entrance')))
    .filter((slide) => slide.branchId == null || (branchId != null && Number(slide.branchId) === branchId))
    .sort((a,b) => (Number(a.sortOrder)||0) - (Number(b.sortOrder)||0) || Number(a.id)-Number(b.id));

  if (!slides.length) return;

  const scheduler = window.WestoResources || null;
  const P = scheduler?.priorities || { VISIBLE:92, NEAR:76, PREDICT:54 };
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const impressionSent = new Set();

  const root = document.createElement('section');
  root.className = 'eg-promo eg-promo--experience';
  root.id = 'eg-promo';
  root.setAttribute('aria-label', 'پیشنهادها و رویدادهای وستو');

  const deck = document.createElement('div');
  deck.className = 'eg-promo__deck';
  deck.tabIndex = 0;
  deck.setAttribute('role','group');
  deck.setAttribute('aria-roledescription','card deck');
  deck.setAttribute('aria-label','اسلایدر تبلیغاتی؛ کارت را به هر جهت بکشید');
  deck.setAttribute('data-lenis-prevent','');
  deck.setAttribute('data-lenis-prevent-touch','');
  root.appendChild(deck);

  const hint = document.createElement('span');
  hint.className = 'eg-promo__hint';
  hint.textContent = 'بگیر و بکش';
  hint.setAttribute('aria-hidden','true');
  deck.appendChild(hint);

  const pagination = document.createElement('div');
  pagination.className = 'eg-promo__pagination';
  pagination.setAttribute('role','tablist');
  pagination.setAttribute('aria-label','انتخاب بنر');
  root.appendChild(pagination);

  function report(id, kind) {
    if (!id) return;
    try {
      const url = `/api/promo-slides/${encodeURIComponent(id)}/${kind}`;
      if (navigator.sendBeacon) navigator.sendBeacon(url, new Blob([], { type:'application/octet-stream' }));
      else fetch(url,{method:'POST',keepalive:true,credentials:'same-origin'}).catch(()=>{});
    } catch (_) {}
  }

  function runAction(slide) {
    const type = String(slide.actionType || 'none');
    const value = String(slide.actionValue || '').trim();
    if (type === 'none') return;
    report(slide.id,'click');
    if (type === 'category') {
      const categoryId = Number(value);
      if (Number.isFinite(categoryId)) window.westoOpenMenuTarget?.({ categoryId });
      return;
    }
    if (type === 'dish') {
      const dishId = Number(value);
      if (Number.isFinite(dishId)) window.westoOpenMenuTarget?.({ dishId });
      return;
    }
    if (type === 'internal') {
      if (value.startsWith('/')) location.href = value;
      return;
    }
    if ((type === 'instagram' || type === 'url') && /^https?:\/\//i.test(value)) {
      window.open(value,'_blank','noopener,noreferrer');
    }
  }

  function makeShare(slide) {
    if (slide.shareEnabled === false) return null;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'eg-promo__share';
    btn.setAttribute('aria-label','اشتراک‌گذاری');
    btn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="18" cy="5" r="2.4"/><circle cx="6" cy="12" r="2.4"/><circle cx="18" cy="19" r="2.4"/><path d="M8.2 10.8 15.7 6.3M8.2 13.2l7.5 4.5"/></svg>';
    btn.addEventListener('pointerdown',(e)=>e.stopPropagation());
    btn.addEventListener('click',async(e)=>{
      e.stopPropagation();
      report(slide.id,'click');
      const title = String(slide.title || 'WESTO');
      const shareUrl = (() => {
        const type=String(slide.actionType||'none');
        const value=String(slide.actionValue||'').trim();
        if (['url','instagram'].includes(type) && /^https?:\/\//i.test(value)) return value;
        if (type==='internal' && value.startsWith('/')) return new URL(value,location.origin).href;
        return location.href;
      })();
      try {
        if (navigator.share) await navigator.share({title,url:shareUrl});
        else if (navigator.clipboard) await navigator.clipboard.writeText(shareUrl);
      } catch (_) {}
    });
    return btn;
  }

  slides.forEach((slide,index) => {
    const card = document.createElement('article');
    card.className = 'eg-promo__card';
    card.dataset.promoId = String(slide.id || '');
    card.dataset.seq = String(index);
    card.setAttribute('aria-label', String(slide.title || `بنر ${index+1}`));

    if (slide.image) {
      card.classList.add('is-media-pending');
      const placeholder = document.createElement('div');
      placeholder.className = 'eg-promo__placeholder';
      placeholder.setAttribute('aria-hidden','true');
      placeholder.innerHTML = `<span class="eg-promo__placeholder-mark">W</span><span class="eg-promo__placeholder-title">${String(slide.title || 'WESTO').replace(/[&<>"]/g,(ch)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch]))}</span>`;
      card.appendChild(placeholder);

      const img = document.createElement('img');
      img.className='eg-promo__media';
      img.alt=String(slide.title || '');
      img.decoding='async';
      img.loading=index<=1?'eager':'lazy';
      if (index === 0) img.fetchPriority = 'high';
      const markReady = () => { card.classList.remove('is-media-pending','is-media-error'); card.classList.add('is-media-ready'); };
      const markError = () => { card.classList.remove('is-media-pending'); card.classList.add('is-media-error'); };
      img.addEventListener('load', markReady, { once:true });
      img.addEventListener('error', markError, { once:true });
      card.appendChild(img);
      const priority = index===0 ? P.VISIBLE : index===1 ? P.NEAR : P.PREDICT;
      if (index <= 1) scheduler?.requestImage?.(slide.image,{priority,group:'entrance-promo-prime'}).catch(()=>{});
      if (scheduler?.bindImage) {
        scheduler.bindImage(img,slide.image,{priority,group:'entrance-promo',loading:index<=1?'eager':'lazy',decode:true})
          .then(()=>{ if (img.complete && img.naturalWidth) markReady(); })
          .catch(()=>{ if (img.src !== slide.image) img.src=slide.image; });
      } else img.src=slide.image;
    } else {
      const fallback=document.createElement('div');
      fallback.className='eg-promo__fallback';
      fallback.textContent=String(slide.title||'WESTO');
      card.appendChild(fallback);
    }

    const share=makeShare(slide);
    if (share) card.appendChild(share);
    card.__westoPromoSlide = slide;
    deck.appendChild(card);

    const dot=document.createElement('button');
    dot.type='button';
    dot.className='eg-promo__dot';
    dot.setAttribute('role','tab');
    dot.setAttribute('aria-label',String(slide.title||`بنر ${index+1}`));
    dot.dataset.seq=String(index);
    pagination.appendChild(dot);
  });

  const steps = experience.querySelector('.eg-steps-row');
  if (steps) experience.insertBefore(root, steps);
  else experience.appendChild(root);
  entrance.classList.add('has-eg-promo');

  let cards=[...deck.querySelectorAll('.eg-promo__card')];
  const dots=[...pagination.querySelectorAll('.eg-promo__dot')];
  const STACK={
    active:{x:0,y:0,z:0,r:0,s:1},
  };
  const BASE_SHADOW='0 26px 40px rgba(0,0,0,.32), 0 8px 16px rgba(0,0,0,.24)';
  const DRAG_SHADOW='0 34px 50px rgba(0,0,0,.40), 0 0 0 3px color-mix(in srgb,var(--prod-cyan,#31dbe0) 82%,transparent), 0 0 26px color-mix(in srgb,var(--prod-cyan,#31dbe0) 58%,transparent)';
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const tString=(o)=>`translate3d(${o.x}px,${o.y}px,${o.z}px) rotate(${o.r}deg) scale(${o.s})`;
  const runningAnimations=new Set();
  const cssProperty=(name)=>name.replace(/[A-Z]/g,(letter)=>`-${letter.toLowerCase()}`);
  function animateCard(node,keyframes,options={}){
    if (typeof node?.animate==='function') {
      const nativeJob=node.animate(keyframes,options);
      runningAnimations.add(nativeJob);
      nativeJob.finished.then(()=>runningAnimations.delete(nativeJob),()=>runningAnimations.delete(nativeJob));
      return nativeJob;
    }
    const frames=Array.isArray(keyframes)?keyframes:[keyframes];
    const first=frames[0]||{},last=frames[frames.length-1]||{};
    const duration=Math.max(1,Number(options.duration)||1);
    const alternate=options.direction==='alternate'&&Number(options.iterations||1)>1;
    const timers=[];
    let raf=0,settled=false,resolveFinished,rejectFinished;
    const finished=new Promise((resolve,reject)=>{resolveFinished=resolve;rejectFinished=reject;});
    const applyFrame=(frame)=>Object.entries(frame).forEach(([name,value])=>{ node.style[name]=String(value); });
    const cleanup=()=>{ node.style.removeProperty('transition');runningAnimations.delete(job); };
    const finish=()=>{ if(settled)return;settled=true;cleanup();resolveFinished(); };
    const cancel=()=>{
      if(settled)return;
      settled=true;cancelAnimationFrame(raf);timers.forEach(clearTimeout);cleanup();rejectFinished(new Error('Animation cancelled'));
    };
    const job={finished,cancel};
    runningAnimations.add(job);
    applyFrame(first);
    void node.offsetWidth;
    raf=requestAnimationFrame(()=>{
      if(settled)return;
      const properties=Object.keys(last).map(name=>`${cssProperty(name)} ${duration}ms ${options.easing||'ease'}`);
      node.style.transition=properties.join(',');
      applyFrame(last);
      timers.push(setTimeout(()=>{
        if(settled)return;
        if(!alternate){finish();return;}
        applyFrame(first);
        timers.push(setTimeout(finish,duration+24));
      },duration+24));
    });
    return job;
  }
  const compactDeck=()=>matchMedia('(max-width:767px), (pointer:coarse) and (max-width:1024px), (max-width:1024px) and (min-height:800px) and (max-aspect-ratio:4/5)').matches;
  const shortDeck=()=>matchMedia('(max-width:430px) and (max-height:650px) and (orientation:portrait)').matches;
  const stackAt=(depth)=>{
    const t=Math.min(Math.max(depth,0),3);
    const profile=shortDeck()
      ? {x:4,y:-6,r:-1.5,s:.97}
      : compactDeck()
        ? {x:6,y:-10,r:-2,s:.965}
        : {x:8,y:-16,r:-3,s:.95};
    return {x:profile.x*t,y:profile.y*t,z:0,r:profile.r*t,s:1-(1-profile.s)*t};
  };
  const syncDeckDensity=()=>{
    const compact=compactDeck();
    const short=shortDeck();
    root.classList.toggle('eg-promo--compact',compact);
    root.classList.toggle('eg-promo--short',short);
    const experience=root.closest('.eg-experience');
    experience?.classList.toggle('eg-experience--promo-safe',compact);
    experience?.classList.toggle('eg-experience--promo-short',short);
  };

  let pointerId=null,dragging=false,animating=false,moved=false;
  let sx=0,sy=0,dx=0,dy=0,lastX=0,lastY=0,lastT=0,vx=0,vy=0;
  let autoplayTimer=0,idleTimer=0,introTimer=0,manualUntil=0,dragRaf=0,dragRect=null;
  let introComplete=false,isVisible=true,interactionScale=1;

  let densityFrame=0;
  window.addEventListener('resize',()=>{
    cancelAnimationFrame(densityFrame);
    densityFrame=requestAnimationFrame(()=>{
      densityFrame=0;
      syncDeckDensity();
      if (!dragging && !animating) applyRest();
    });
  },{passive:true});

  function activeSlide(){ return cards[0]?.__westoPromoSlide || null; }
  function reportActiveImpression(){
    const slide=activeSlide();
    if (!slide?.id || impressionSent.has(String(slide.id))) return;
    impressionSent.add(String(slide.id));
    report(slide.id,'impression');
  }
  function warmNext(){
    const image=cards[1]?.__westoPromoSlide?.image;
    if (image) scheduler?.requestImage?.(image,{priority:P.NEAR,group:'entrance-promo-intent'}).catch(()=>{});
  }
  function applyRest(){
    cards=[...deck.querySelectorAll('.eg-promo__card')];
    cards.forEach((card,i)=>{
      const layer=i===0?'0':i===1?'1':i===2?'2':'hidden';
      card.dataset.layer=layer;
      card.style.removeProperty('z-index');
      card.style.removeProperty('transform');
      card.style.removeProperty('opacity');
      card.style.removeProperty('box-shadow');
      card.style.pointerEvents=i===0?'auto':'none';
      card.setAttribute('aria-hidden',i===0?'false':'true');
      card.querySelectorAll('button,a,[tabindex]').forEach((control)=>{ control.tabIndex=i===0?0:-1; });
    });
    const seq=cards[0]?.dataset.seq;
    dots.forEach((dot)=>{
      const selected=dot.dataset.seq===seq;
      dot.setAttribute('aria-selected',String(selected));
      dot.tabIndex=selected?0:-1;
    });
    reportActiveImpression();
    warmNext();
    scheduleAutoplay();
    scheduleIdleNudge();
  }

  function dragFrame(){
    if (cards.length<2) return;
    const current=cards[0],next=cards[1],third=cards[2];
    const dist=Math.hypot(dx,dy);
    const p=clamp(dist/150,0,1);
    const rot=clamp(.08*dx,-20,20);
    const scale=Math.min(1.06,1+dist/1700);
    current.style.transform=`translate3d(${dx}px,${dy}px,0) rotate(${rot}deg) scale(${scale})`;
    current.style.opacity='1';
    current.style.boxShadow=dist>commitDistance(dragRect)?DRAG_SHADOW:BASE_SHADOW;
    if (next) {
      next.style.zIndex='25';
      next.style.transform=tString(stackAt(1-.6*p));
      next.style.opacity='1';
    }
    if (third) {
      third.style.zIndex='15';
      third.style.transform=tString(stackAt(2-.6*p));
      third.style.opacity='1';
    }
  }

  function commitDistance(rect){
    const box=rect || deck.getBoundingClientRect();
    return clamp(Math.min(box.width,box.height)*.34,58,88);
  }

  function clearAnimations(){
    [...runningAnimations].forEach(animation=>animation.cancel());
    cards.forEach(card=>card.getAnimations?.().forEach(animation=>animation.cancel()));
  }
  function snapBack(){
    clearAnimations();
    const duration=reduced?1:550;
    const current=cards[0],next=cards[1],third=cards[2];
    const jobs=[];
    if (current) jobs.push(animateCard(current,[
      {transform:current.style.transform||tString(STACK.active),boxShadow:current.style.boxShadow||BASE_SHADOW},
      {transform:tString(STACK.active),opacity:1,boxShadow:BASE_SHADOW}
    ],{duration,easing:'cubic-bezier(.18,1.3,.4,1)',fill:'forwards'}));
    if (next) jobs.push(animateCard(next,[
      {transform:next.style.transform||tString(stackAt(1)),opacity:1},
      {transform:tString(stackAt(1)),opacity:1}
    ],{duration,easing:'cubic-bezier(.18,1.3,.4,1)',fill:'forwards'}));
    if (third) jobs.push(animateCard(third,[
      {transform:third.style.transform||tString(stackAt(2)),opacity:1},
      {transform:tString(stackAt(2)),opacity:1}
    ],{duration,easing:'cubic-bezier(.18,1.3,.4,1)',fill:'forwards'}));
    Promise.allSettled(jobs.map(j=>j.finished)).finally(applyRest);
  }

  function throwCard(vector){
    if (animating || cards.length<2) return;
    animating=true;
    deck.classList.add('is-animating','has-interacted');
    clearTimeout(autoplayTimer);clearTimeout(idleTimer);
    const current=cards[0],next=cards[1],third=cards[2];
    let tx=vector?.x ?? dx, ty=vector?.y ?? dy;
    let velX=vector?.vx ?? vx, velY=vector?.vy ?? vy;
    let dist=Math.hypot(tx,ty);
    if (dist<1) { tx=-120;ty=-40;dist=Math.hypot(tx,ty); }
    const speed=Math.hypot(velX,velY);
    const angle=speed>3.5?Math.atan2(velY,velX):Math.atan2(ty,tx);
    const sign=tx>=0?1:-1;
    const outX=240*Math.cos(angle),outY=240*Math.sin(angle)-46;
    const flight=tString({x:outX,y:outY,z:0,r:26*sign,s:1.07});
    const flightDuration=reduced?1:200;
    const promoteDuration=reduced?1:500;
    const flightJob=animateCard(current,[
      {transform:current.style.transform||tString(STACK.active),opacity:1,boxShadow:current.style.boxShadow||BASE_SHADOW},
      {transform:flight,opacity:1,boxShadow:'0 48px 70px rgba(0,0,0,.45)'}
    ],{duration:flightDuration,easing:'cubic-bezier(.3,.8,.25,1)',fill:'forwards'});
    const promotions=[];
    if (next) promotions.push(animateCard(next,[
      {transform:next.style.transform||tString(stackAt(1)),opacity:1},
      {transform:tString(STACK.active),opacity:1}
    ],{duration:promoteDuration,easing:'cubic-bezier(.34,1.45,.5,1)',fill:'forwards'}));
    if (third) promotions.push(animateCard(third,[
      {transform:third.style.transform||tString(stackAt(2)),opacity:1},
      {transform:tString(stackAt(1)),opacity:1}
    ],{duration:promoteDuration,easing:'cubic-bezier(.34,1.45,.5,1)',fill:'forwards'}));

    flightJob.finished.then(()=>{
      current.style.transform=flight;
      current.style.opacity='1';
      current.style.boxShadow='0 48px 70px rgba(0,0,0,.45)';
      flightJob.cancel();
      deck.appendChild(current);
      cards=[...deck.querySelectorAll('.eg-promo__card')];
      const index=cards.indexOf(current);
      const target=stackAt(index);
      current.style.zIndex='1';
      current.style.pointerEvents='none';
      const returnJob=animateCard(current,[
        {transform:flight,opacity:1,boxShadow:'0 48px 70px rgba(0,0,0,.45)'},
        {transform:tString(target),opacity:index<=2?1:0,boxShadow:BASE_SHADOW}
      ],{duration:reduced?1:460,easing:'cubic-bezier(.34,1.4,.5,1)',fill:'forwards'});
      return Promise.allSettled([...promotions.map(job=>job.finished),returnJob.finished]);
    }).catch(()=>{}).finally(()=>{
      animating=false;
      deck.classList.remove('is-animating');
      applyRest();
    });
  }

  function fanDeck({intro=false}={}){
    if (animating || dragging || cards.length<2 || reduced || !isVisible) {
      if (intro) { introComplete=true;scheduleAutoplay();scheduleIdleNudge(); }
      return;
    }
    animating=true;
    deck.classList.add('is-animating','is-fanning');
    clearTimeout(autoplayTimer);clearTimeout(idleTimer);clearAnimations();
    const visibleCount=Math.min(7,cards.length);
    const compact=compactDeck();
    const deckRect=deck.getBoundingClientRect();
    const spread=compact
      ? clamp(deckRect.width*.075,22,34)
      : clamp(deckRect.width*.17,58,84);
    const rotation=compact
      ? clamp(deckRect.width*.012,3.5,5)
      : clamp(deckRect.width*.07,22,35);
    const lift=compact
      ? clamp(deckRect.height*.04,5,8)
      : clamp(deckRect.height*.12,16,26);
    const opening=cards.map((card,index)=>{
      if (index>=visibleCount) return null;
      const ratio=visibleCount>1?index/(visibleCount-1):.5;
      const arc=lift*(1-Math.abs(ratio-.5)*1.25)+(compact?2:4);
      const fan={x:(ratio-.5)*2*spread,y:-arc,z:0,r:(ratio-.5)*2*rotation,s:1};
      card.style.zIndex=String(cards.length+5-index);
      card.style.opacity='1';
      return animateCard(card,[
        {transform:getComputedStyle(card).transform,opacity:getComputedStyle(card).opacity},
        {transform:tString(fan),opacity:1}
      ],{duration:280,easing:'cubic-bezier(.34,1.5,.5,1)',fill:'forwards'});
    }).filter(Boolean);
    Promise.allSettled(opening.map(job=>job.finished)).then(()=>new Promise(resolve=>setTimeout(resolve,reduced?0:40))).then(()=>{
      if (!isVisible || document.hidden) return [];
      const closing=cards.map((card,index)=>{
        const target=index===0?STACK.active:stackAt(index);
        return animateCard(card,[
          {transform:getComputedStyle(card).transform,opacity:getComputedStyle(card).opacity},
          {transform:tString(target),opacity:index<=2?1:0}
        ],{duration:500,easing:'cubic-bezier(.34,1.45,.5,1)',fill:'forwards'});
      });
      return Promise.allSettled(closing.map(job=>job.finished));
    }).finally(()=>{
      if (intro) introComplete=true;
      animating=false;
      deck.classList.remove('is-animating','is-fanning');
      applyRest();
    });
  }

  function scheduleIdleNudge(){
    clearTimeout(idleTimer);
    if (!introComplete || reduced || document.hidden || !isVisible || dragging || animating || cards.length<2) return;
    idleTimer=setTimeout(()=>{
      if (dragging || animating || !isVisible) return scheduleIdleNudge();
      const current=cards[0];
      if (!current) return;
      const nudge=animateCard(current,[
        {transform:tString(STACK.active)},
        {transform:'translate3d(10px,0,0) rotate(2.5deg) scale(1)'}
      ],{duration:500,easing:'ease-in-out',direction:'alternate',iterations:2});
      nudge.finished.catch(()=>{}).finally(()=>{ current.style.removeProperty('transform');scheduleIdleNudge(); });
    },3000);
  }

  function scheduleAutoplay(){
    clearTimeout(autoplayTimer);
    const configured=Math.max(0,Number(activeSlide()?.autoplayMs)||0);
    const ms=configured||7000;
    if (!introComplete || cards.length<2 || reduced || document.hidden || !isVisible || Date.now()<manualUntil) return;
    autoplayTimer=setTimeout(()=>{
      if (Date.now()<manualUntil) return scheduleAutoplay();
      fanDeck();
    },Math.max(3000,ms*interactionScale));
  }

  deck.addEventListener('pointerdown',(e)=>{
    if (animating || e.target.closest('.eg-promo__share') || cards.length<2) return;
    clearTimeout(autoplayTimer);clearTimeout(idleTimer);clearTimeout(introTimer);manualUntil=Date.now()+8000;
    pointerId=e.pointerId;dragging=true;moved=false;
    sx=lastX=e.clientX;sy=lastY=e.clientY;dx=dy=vx=vy=0;lastT=performance.now();dragRect=deck.getBoundingClientRect();
    clearAnimations();deck.classList.add('is-dragging','has-interacted');
    deck.setPointerCapture?.(pointerId);
  });
  deck.addEventListener('pointermove',(e)=>{
    if (!dragging || e.pointerId!==pointerId) return;
    e.preventDefault();
    const now=performance.now(),dt=Math.max(8,now-lastT);
    dx=e.clientX-sx;dy=e.clientY-sy;vx=((e.clientX-lastX)/dt)*16;vy=((e.clientY-lastY)/dt)*16;
    lastX=e.clientX;lastY=e.clientY;lastT=now;
    if (Math.hypot(dx,dy)>4) moved=true;
    if (!dragRaf) dragRaf=requestAnimationFrame(()=>{ dragRaf=0; if (dragging) dragFrame(); });
  },{passive:false});
  function endPointer(e){
    if (!dragging || (e && e.pointerId!==pointerId)) return;
    dragging=false;deck.classList.remove('is-dragging');
    if (dragRaf) { cancelAnimationFrame(dragRaf); dragRaf=0; dragFrame(); }
    const rect=dragRect || deck.getBoundingClientRect();
    const threshold=commitDistance(rect);
    const distance=Math.hypot(dx,dy),speed=Math.hypot(vx,vy);
    if (e?.type!=='pointercancel' && (distance>threshold || speed>8.5)) {
      interactionScale=2;
      navigator.vibrate?.(14);
      throwCard();
    }
    else {
      const slide=activeSlide();
      snapBack();
      if (!moved && slide) runAction(slide);
    }
    pointerId=null;dx=dy=0;dragRect=null;
  }
  deck.addEventListener('pointerup',endPointer);
  deck.addEventListener('pointercancel',endPointer);

  deck.addEventListener('click',(e)=>{
    if (cards.length !== 1 || e.target.closest('.eg-promo__share')) return;
    const slide=activeSlide();
    if (slide) runAction(slide);
  });

  deck.addEventListener('keydown',(e)=>{
    if (animating) return;
    if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Enter',' '].includes(e.key)) {
      e.preventDefault();manualUntil=Date.now()+8000;interactionScale=2;
      const map={ArrowLeft:{x:-130,y:0},ArrowRight:{x:130,y:0},ArrowUp:{x:0,y:-110},ArrowDown:{x:0,y:110}};
      throwCard(map[e.key]||{x:-120,y:-40});
    }
  });

  function pauseDeck(){
    clearTimeout(autoplayTimer);clearTimeout(idleTimer);clearTimeout(introTimer);
    if (dragRaf) { cancelAnimationFrame(dragRaf); dragRaf=0; }
    if (animating) { clearAnimations();animating=false;deck.classList.remove('is-animating','is-fanning'); }
    if (dragging || deck.classList.contains('is-dragging')) { dragging=false;pointerId=null;dragRect=null;deck.classList.remove('is-dragging'); }
    applyRest();
  }

  document.addEventListener('visibilitychange',()=>{
    if (document.hidden) { pauseDeck(); return; }
    if (!introComplete && !reduced) introTimer=setTimeout(()=>fanDeck({intro:true}),500);
    else { introComplete=true;scheduleAutoplay();scheduleIdleNudge(); }
  });

  if ('IntersectionObserver' in window) {
    const visibilityObserver=new IntersectionObserver((entries)=>{
      isVisible=entries.some(entry=>entry.isIntersecting && entry.intersectionRatio>.1);
      if (!isVisible) { clearTimeout(autoplayTimer);clearTimeout(idleTimer); return; }
      scheduleAutoplay();scheduleIdleNudge();
    },{threshold:[0,.1,.35]});
    visibilityObserver.observe(root);
  }

  dots.forEach((dot)=>dot.addEventListener('click',()=>{
    const wanted=dot.dataset.seq;
    const targetIndex=cards.findIndex(card=>card.dataset.seq===wanted);
    if (targetIndex<=0 || animating) return;
    manualUntil=Date.now()+8000;interactionScale=2;
    // Preserve the physical deck model: advance one card per throw. For a distant dot,
    // reorder only after a short sequence so every promotion remains deterministic.
    const advance=()=>{
      const idx=[...deck.querySelectorAll('.eg-promo__card')].findIndex(card=>card.dataset.seq===wanted);
      if (idx<=0) return;
      throwCard({x:-deck.clientWidth*.24,y:-deck.clientHeight*.05,vx:0,vy:0});
      setTimeout(advance,reduced?20:720);
    };
    advance();
  }));

  syncDeckDensity();
  applyRest();
  if (reduced || cards.length<2) {
    introComplete=true;
    scheduleAutoplay();scheduleIdleNudge();
  } else {
    introTimer=setTimeout(()=>fanDeck({intro:true}),2000);
  }
})();

;/* ===== END js/entrance-promo-deck.js ===== */

/* ===== BEGIN js/subcategory-kill-switch.js ===== */
/* Keeps the retired dish-subcategory strip out of legacy cached builds.
   Current table-cart.js already suppresses this UI internally; this file is
   intentionally a narrow compatibility guard only. It must never observe the
   whole document because menu/board rebuilds generate many unrelated DOM mutations. */
(() => {
  'use strict';

  const ROOT_VAR = '--menu-subbar-h';
  const BAR_ID = 'westo-dish-catbar';
  const SUBBAR_CLASS = 'westo-dish-subbar';
  const ACTIVE_CLASS = 'has-subcategories';

  let observedBar = null;
  let barObserver = null;
  let retryTimer = 0;
  let retryCount = 0;
  const MAX_RETRIES = 8;

  function lockSubbarHeight() {
    const root = document.documentElement;
    if (!root) return;
    if (root.style.getPropertyValue(ROOT_VAR) === '0px') return;
    root.style.setProperty(ROOT_VAR, '0px', 'important');
  }

  function removeDirectSubbars(bar) {
    if (!bar) return false;
    let changed = false;

    // Only direct children belong to the retired secondary strip. Avoid a
    // document-wide selector because dish cards and rails rebuild frequently.
    Array.from(bar.children || []).forEach((child) => {
      if (!child.classList?.contains(SUBBAR_CLASS)) return;
      child.remove();
      changed = true;
    });

    if (bar.classList.contains(ACTIVE_CLASS)) {
      bar.classList.remove(ACTIVE_CLASS);
      changed = true;
    }

    return changed;
  }

  function cleanup(bar = document.getElementById(BAR_ID)) {
    lockSubbarHeight();
    if (bar) removeDirectSubbars(bar);
    return bar;
  }

  function disconnectBarObserver() {
    if (barObserver) {
      try {
        barObserver.disconnect();
      } catch (_) {}
    }
    barObserver = null;
    observedBar = null;
  }

  function observeBar(bar) {
    if (!bar || typeof MutationObserver === 'undefined') return;
    if (observedBar === bar && barObserver) return;

    disconnectBarObserver();
    observedBar = bar;

    barObserver = new MutationObserver((records) => {
      let needsCleanup = false;

      for (const record of records) {
        if (record.type === 'attributes') {
          if (bar.classList.contains(ACTIVE_CLASS)) needsCleanup = true;
          continue;
        }

        if (record.type !== 'childList' || !record.addedNodes?.length) continue;
        for (const node of record.addedNodes) {
          if (node?.nodeType !== 1) continue;
          if (node.classList?.contains(SUBBAR_CLASS)) {
            needsCleanup = true;
            break;
          }
        }
        if (needsCleanup) break;
      }

      if (needsCleanup) cleanup(bar);
    });

    // The compatibility guard watches only the actual Catbar. This preserves
    // protection against an old cached table-cart.js without paying for every
    // child mutation elsewhere on the page.
    barObserver.observe(bar, {
      childList: true,
      attributes: true,
      attributeFilter: ['class'],
    });
  }

  function bindCurrentBar() {
    const bar = cleanup();
    if (!bar) return false;
    observeBar(bar);
    retryCount = MAX_RETRIES;
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = 0;
    }
    return true;
  }

  function scheduleRetry() {
    if (retryTimer || retryCount >= MAX_RETRIES) return;
    retryTimer = window.setTimeout(() => {
      retryTimer = 0;
      retryCount += 1;
      if (!bindCurrentBar()) scheduleRetry();
    }, retryCount < 3 ? 120 : 300);
  }

  function sync() {
    if (!bindCurrentBar()) scheduleRetry();
  }

  function start() {
    lockSubbarHeight();
    sync();

    // These are low-frequency lifecycle points where table/cart state can be
    // rebuilt. They replace the previous document-wide MutationObserver.
    window.addEventListener('westo:menu-ready', sync);
    window.addEventListener('carousel:ready', sync, { once: true });
    window.addEventListener('pageshow', sync);
    document.addEventListener('westo:langchange', sync);
  }

  function stop() {
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = 0;
    }
    disconnectBarObserver();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }

  window.addEventListener('pagehide', stop);
})();

;/* ===== END js/subcategory-kill-switch.js ===== */

/* ===== BEGIN js/brand-lockup.js ===== */
/* Keep the navigation logo on the approved Persian Westo lockup.
   content-overrides.js also owns the broader brand replacement path; this file
   stays as a narrow compatibility guard and avoids repeating identical image
   writes when that primary path has already run. */
(() => {
  'use strict';

  const ROOT = document.documentElement;
  const SELECTOR = '.navbar_logo, .navbar_menu-logo';
  const DARK = 'assets/images/brand/westo-fa-wordmark-dark.png?v=brandDark1';
  const LIGHT = 'assets/images/brand/westo-fa-wordmark.png?v=brandLight1';

  let logos = [];
  let started = false;

  const sourceForTheme = (theme) => (theme === 'light' ? DARK : LIGHT);

  const collectLogos = () => {
    logos = Array.from(document.querySelectorAll(SELECTOR));
    return logos;
  };

  const liveLogos = (forceRefresh = false) => {
    if (
      forceRefresh ||
      !logos.length ||
      logos.some((logo) => !logo || !logo.isConnected)
    ) {
      return collectLogos();
    }
    return logos;
  };

  const writeIfChanged = (logo, src) => {
    if (!logo) return;

    // content-overrides.js is registered earlier on the normal home-page path.
    // If it already applied this exact source, do not trigger another image
    // attribute mutation / source selection cycle.
    if ((logo.getAttribute('src') || '') !== src) {
      logo.setAttribute('src', src);
    }

    if (logo.getAttribute('alt') !== 'Westo') {
      logo.setAttribute('alt', 'Westo');
    }
  };

  const apply = (
    theme = ROOT.getAttribute('data-theme'),
    { refreshNodes = false } = {},
  ) => {
    const src = sourceForTheme(theme);
    liveLogos(refreshNodes).forEach((logo) => writeIfChanged(logo, src));
  };

  const onThemeChange = (event) => {
    apply(event?.detail?.theme);
  };

  const onPageShow = (event) => {
    if (!event.persisted) return;
    apply(ROOT.getAttribute('data-theme'), { refreshNodes: true });
  };

  const start = () => {
    if (started) {
      apply(ROOT.getAttribute('data-theme'), { refreshNodes: true });
      return;
    }
    started = true;

    // The script is defer-loaded on index.html, so the navbar normally exists
    // already. The readyState guard keeps the file safe if it is reused
    // synchronously by an older build.
    apply(ROOT.getAttribute('data-theme'), { refreshNodes: true });

    window.addEventListener('westo:theme-change', onThemeChange);
    window.addEventListener('pageshow', onPageShow);
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();

;/* ===== END js/brand-lockup.js ===== */

/* ===== BEGIN js/language-switch-rescue.js ===== */
/* Restores the full three-language gate switch in legacy cached builds.
   Scoped to the entrance language control so unrelated DOM mutations never
   wake this compatibility guard. */
(() => {
  'use strict';

  const SWITCH_ID = 'eg-lang-switch';
  const ARABIC_ID = 'eg-lang-ar';

  let switcher = null;
  let arabic = null;
  let arabicObserver = null;
  let started = false;

  const getNodes = () => {
    const nextSwitcher = document.getElementById(SWITCH_ID);
    const nextArabic = document.getElementById(ARABIC_ID);

    if (nextSwitcher !== switcher || nextArabic !== arabic) {
      arabicObserver?.disconnect();
      arabicObserver = null;
      switcher = nextSwitcher;
      arabic = nextArabic;
    }

    return { switcher, arabic };
  };

  const restore = () => {
    const nodes = getNodes();

    if (nodes.switcher) {
      if (nodes.switcher.style.minWidth !== '7.6rem') {
        nodes.switcher.style.minWidth = '7.6rem';
      }
      if (nodes.switcher.style.justifyContent !== 'center') {
        nodes.switcher.style.justifyContent = 'center';
      }
      if (nodes.switcher.style.whiteSpace !== 'nowrap') {
        nodes.switcher.style.whiteSpace = 'nowrap';
      }
    }

    if (nodes.arabic) {
      if (nodes.arabic.hidden) nodes.arabic.hidden = false;
      if (nodes.arabic.hasAttribute('hidden')) {
        nodes.arabic.removeAttribute('hidden');
      }

      if (nodes.arabic.style.getPropertyValue('display') !== 'flex' ||
          nodes.arabic.style.getPropertyPriority('display') !== 'important') {
        nodes.arabic.style.setProperty('display', 'flex', 'important');
      }
      nodes.arabic.style.setProperty('align-items', 'center', 'important');
      nodes.arabic.style.setProperty('justify-content', 'center', 'important');
      nodes.arabic.style.setProperty('line-height', '1', 'important');
      nodes.arabic.style.setProperty('padding-block', '0', 'important');
      nodes.arabic.style.setProperty('transform', 'none', 'important');

      if (nodes.arabic.style.getPropertyValue('visibility') !== 'visible' ||
          nodes.arabic.style.getPropertyPriority('visibility') !== 'important') {
        nodes.arabic.style.setProperty('visibility', 'visible', 'important');
      }
    }

    return Boolean(nodes.switcher || nodes.arabic);
  };

  const observeArabic = () => {
    getNodes();
    if (!arabic || arabicObserver) return;

    arabicObserver = new MutationObserver((records) => {
      for (const record of records) {
        if (
          record.type === 'attributes' &&
          record.attributeName === 'hidden' &&
          arabic?.hasAttribute('hidden')
        ) {
          restore();
          break;
        }
      }
    });

    arabicObserver.observe(arabic, {
      attributes: true,
      attributeFilter: ['hidden'],
    });
  };

  const sync = () => {
    restore();
    observeArabic();
  };

  const start = () => {
    if (started) {
      sync();
      return;
    }
    started = true;

    sync();

    // Current animations/i18n code already keeps the AR option visible.
    // These narrow lifecycle hooks only protect bfcache and language rewrites.
    window.addEventListener('pageshow', sync);
    window.addEventListener('westo:langchange', sync);
  };

  const stop = () => {
    arabicObserver?.disconnect();
    arabicObserver = null;
  };

  window.addEventListener('pagehide', stop);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();

;/* ===== END js/language-switch-rescue.js ===== */

/* ===== BEGIN js/design-logic-v13.js ===== */
/* WESTO Design Logic v13
   Human-factor runtime only: accessibility semantics, input modality,
   visualViewport resilience, and defensive link/state hygiene.
   It intentionally owns no menu/cart/carousel/business state. */
(function () {
  'use strict';
  const root = document.documentElement;
  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => Array.from(c.querySelectorAll(s));

  function ensureThemeColor() {
    let meta = $('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'theme-color';
      document.head.appendChild(meta);
    }
    const sync = () => {
      const light = root.getAttribute('data-theme') === 'light';
      meta.content = light ? '#f2f3ef' : '#071012';
    };
    sync();
    window.addEventListener('westo:theme-change', sync);
  }

  function ensureMainSemantics() {
    const main = $('main, [role="main"]');
    if (!main) return;
    if (!main.id) main.id = 'main-content';
    if (!main.hasAttribute('tabindex')) main.setAttribute('tabindex', '-1');
    if (!$('.dl-skip-link')) {
      const skip = document.createElement('a');
      skip.className = 'dl-skip-link';
      skip.href = `#${main.id}`;
      skip.textContent = root.lang === 'en' ? 'Skip to content' : root.lang === 'ar' ? 'تخطي إلى المحتوى' : 'رفتن به محتوای اصلی';
      document.body.prepend(skip);
    }
  }

  function syncLanguageUi() {
    const skip = $('.dl-skip-link');
    if (skip) skip.textContent = root.lang === 'en' ? 'Skip to content' : root.lang === 'ar' ? 'تخطي إلى المحتوى' : 'رفتن به محتوای اصلی';
  }

  function hardenLinks() {
    $$('a[target="_blank"]').forEach((a) => {
      const parts = new Set(String(a.getAttribute('rel') || '').split(/\s+/).filter(Boolean));
      parts.add('noopener');
      a.setAttribute('rel', Array.from(parts).join(' '));
    });
    const here = new URL(location.href);
    $$('a[href]').forEach((a) => {
      if (a.hasAttribute('aria-current') || a.closest('[data-no-auto-current]')) return;
      try {
        const url = new URL(a.getAttribute('href'), here);
        if (url.origin === here.origin && url.pathname === here.pathname && !url.hash) a.setAttribute('aria-current', 'page');
      } catch (_) {}
    });
  }

  function hardenLiveRegions() {
    $$('.msg, [data-dynamic-message]').forEach((el) => {
      if (!el.hasAttribute('role')) el.setAttribute('role', 'status');
      if (!el.hasAttribute('aria-live')) el.setAttribute('aria-live', 'polite');
      if (!el.hasAttribute('aria-atomic')) el.setAttribute('aria-atomic', 'true');
    });
  }

  function syncViewport() {
    const vv = window.visualViewport;
    const layoutH = Math.max(1, Number(window.innerHeight) || 1);
    const layoutW = Math.max(1, Number(window.innerWidth) || 1);
    const visualH = Math.max(1, Number(vv?.height) || layoutH);
    const visualW = Math.max(1, Number(vv?.width) || layoutW);
    const keyboard = !!vv && visualH < layoutH - 80;
    const standalone = root.classList.contains('is-standalone')
      || window.navigator.standalone === true
      || window.matchMedia?.('(display-mode: standalone)').matches === true;
    // Installed iOS apps can report a visual viewport with safe areas already
    // removed. Keep 100vh/innerHeight authoritative unless the keyboard is open.
    const h = standalone && !keyboard ? layoutH : visualH;
    const w = standalone && !keyboard ? layoutW : visualW;
    root.style.setProperty('--dl-vv-height', `${Math.max(1, Math.round(h || 1))}px`);
    root.style.setProperty('--dl-vv-width', `${Math.max(1, Math.round(w || 1))}px`);
    root.classList.toggle('dl-keyboard-open', keyboard);
  }

  function syncDisplayMode() {
    const standalone = window.navigator.standalone === true
      || window.matchMedia?.('(display-mode: standalone)').matches === true;
    root.classList.toggle('is-standalone', standalone);
    root.dataset.displayMode = standalone ? 'standalone' : 'browser';
  }

  function bindInputModality() {
    let keyboard = false;
    const set = (value) => {
      if (root.dataset.inputModality === value) return;
      root.dataset.inputModality = value;
    };
    if (window.matchMedia?.('(pointer: coarse)').matches) set('pointer');
    document.addEventListener('keydown', (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      keyboard = true;
      set('keyboard');
    }, true);
    document.addEventListener('pointerdown', () => {
      keyboard = false;
      set('pointer');
    }, true);
    window.addEventListener('blur', () => { if (!keyboard) set('pointer'); });
  }

  function init() {
    ensureThemeColor();
    ensureMainSemantics();
    syncLanguageUi();
    hardenLinks();
    hardenLiveRegions();
    syncDisplayMode();
    bindInputModality();
    syncViewport();
    const vv = window.visualViewport;
    const displayMode = window.matchMedia?.('(display-mode: standalone)');
    let settleFrame = 0;
    let settleTimer = 0;
    const scheduleViewportSync = () => {
      cancelAnimationFrame(settleFrame);
      clearTimeout(settleTimer);
      settleFrame = requestAnimationFrame(() => requestAnimationFrame(syncViewport));
      settleTimer = window.setTimeout(syncViewport, 420);
    };
    vv?.addEventListener('resize', scheduleViewportSync, { passive: true });
    vv?.addEventListener('scroll', scheduleViewportSync, { passive: true });
    if (displayMode?.addEventListener) displayMode.addEventListener('change', syncDisplayMode);
    else displayMode?.addListener?.(syncDisplayMode);
    window.addEventListener('resize', scheduleViewportSync, { passive: true });
    window.addEventListener('orientationchange', scheduleViewportSync, { passive: true });
    window.addEventListener('pageshow', () => {
      syncDisplayMode();
      if (window.matchMedia?.('(pointer: coarse)').matches
          && document.activeElement?.classList?.contains('dl-skip-link')) {
        document.activeElement.blur();
      }
      scheduleViewportSync();
    }, { passive: true });
    document.addEventListener('westo:langchange', syncLanguageUi);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();

;/* ===== END js/design-logic-v13.js ===== */

/* ===== BEGIN js/vendor/gsap.min.js ===== */
/*!
 * GSAP 3.15.0
 * https://gsap.com
 * 
 * @license Copyright 2026, GreenSock. All rights reserved.
 * Subject to the terms at https://gsap.com/standard-license.
 * @author: Jack Doyle, jack@greensock.com
 */

!function(t,e){"object"==typeof exports&&"undefined"!=typeof module?e(exports):"function"==typeof define&&define.amd?define(["exports"],e):e((t=t||self).window=t.window||{})}(this,function(e){"use strict";function _inheritsLoose(t,e){t.prototype=Object.create(e.prototype),(t.prototype.constructor=t).__proto__=e}function _assertThisInitialized(t){if(void 0===t)throw new ReferenceError("this hasn't been initialised - super() hasn't been called");return t}function r(t){return"string"==typeof t}function s(t){return"function"==typeof t}function t(t){return"number"==typeof t}function u(t){return void 0===t}function v(t){return"object"==typeof t}function w(t){return!1!==t}function x(){return"undefined"!=typeof window}function y(t){return s(t)||r(t)}function R(t){return(i=bt(t,ht))&&Fe}function S(t,e){return console.warn("Invalid property",t,"set to",e,"Missing plugin? gsap.registerPlugin()")}function T(t,e){return!e&&console.warn(t)}function U(t,e){return t&&(ht[t]=e)&&i&&(i[t]=e)||ht}function V(){return 0}function ga(t){var e,r,i=t[0];if(v(i)||s(i)||(t=[t]),!(e=(i._gsap||{}).harness)){for(r=yt.length;r--&&!yt[r].targetTest(i););e=yt[r]}for(r=t.length;r--;)t[r]&&(t[r]._gsap||(t[r]._gsap=new Xt(t[r],e)))||t.splice(r,1);return t}function ha(t){return t._gsap||ga(Pt(t))[0]._gsap}function ia(t,e,r){return(r=t[e])&&s(r)?t[e]():u(r)&&t.getAttribute&&t.getAttribute(e)||r}function ja(t,e){return(t=t.split(",")).forEach(e)||t}function ka(t){return Math.round(1e5*t)/1e5||0}function la(t){return Math.round(1e7*t)/1e7||0}function ma(t,e){var r=e.charAt(0),i=parseFloat(e.substr(2));return t=parseFloat(t),"+"===r?t+i:"-"===r?t-i:"*"===r?t*i:t/i}function na(t,e){for(var r=e.length,i=0;t.indexOf(e[i])<0&&++i<r;);return i<r}function oa(){var t,e,r=pt.length,i=pt.slice(0);for(_t={},t=pt.length=0;t<r;t++)(e=i[t])&&e._lazy&&(e.render(e._lazy[0],e._lazy[1],!0)._lazy=0)}function pa(t){return!!(t._initted||t._startAt||t.add)}function qa(t,e,r,i){pt.length&&!I&&oa(),t.render(e,r,i||!!(I&&e<0&&pa(t))),pt.length&&!I&&oa()}function ra(t){var e=parseFloat(t);return(e||0===e)&&(t+"").match(ot).length<2?e:r(t)?t.trim():t}function sa(t){return t}function ta(t,e){for(var r in e)r in t||(t[r]=e[r]);return t}function wa(t,e){for(var r in e)"__proto__"!==r&&"constructor"!==r&&"prototype"!==r&&(t[r]=v(e[r])?wa(t[r]||(t[r]={}),e[r]):e[r]);return t}function xa(t,e){var r,i={};for(r in t)r in e||(i[r]=t[r]);return i}function ya(t){var e=t.parent||L,r=t.keyframes?function _setKeyframeDefaults(i){return function(t,e){for(var r in e)r in t||"duration"===r&&i||"ease"===r||(t[r]=e[r])}}(K(t.keyframes)):ta;if(w(t.inherit))for(;e;)r(t,e.vars.defaults),e=e.parent||e._dp;return t}function Aa(t,e,r,i,n){void 0===r&&(r="_first"),void 0===i&&(i="_last");var a,s=t[i];if(n)for(a=e[n];s&&s[n]>a;)s=s._prev;return s?(e._next=s._next,s._next=e):(e._next=t[r],t[r]=e),e._next?e._next._prev=e:t[i]=e,e._prev=s,e.parent=e._dp=t,e}function Ba(t,e,r,i){void 0===r&&(r="_first"),void 0===i&&(i="_last");var n=e._prev,a=e._next;n?n._next=a:t[r]===e&&(t[r]=a),a?a._prev=n:t[i]===e&&(t[i]=n),e._next=e._prev=e.parent=null}function Ca(t,e){t.parent&&(!e||t.parent.autoRemoveChildren)&&t.parent.remove&&t.parent.remove(t),t._act=0}function Da(t,e){if(t&&(!e||e._end>t._dur||e._start<0))for(var r=t;r;)r._dirty=1,r=r.parent;return t}function Fa(t,e,r,i){return t._startAt&&(I?t._startAt.revert(ft):t.vars.immediateRender&&!t.vars.autoRevert||t._startAt.render(e,!0,i))}function Ha(t){return t._repeat?wt(t._tTime,t=t.duration()+t._rDelay)*t:0}function Ja(t,e){return(t-e._start)*e._ts+(0<=e._ts?0:e._dirty?e.totalDuration():e._tDur)}function Ka(t){return t._end=la(t._start+(t._tDur/Math.abs(t._ts||t._rts||q)||0))}function La(t,e){var r=t._dp;return r&&r.smoothChildTiming&&t._ts&&(t._start=la(r._time-(0<t._ts?e/t._ts:((t._dirty?t.totalDuration():t._tDur)-e)/-t._ts)),Ka(t),r._dirty||Da(r,t)),t}function Ma(t,e){var r;if((e._time||!e._dur&&e._initted||e._start<t._time&&(e._dur||!e.add))&&(r=Ja(t.rawTime(),e),(!e._dur||Mt(0,e.totalDuration(),r)-e._tTime>q)&&e.render(r,!0)),Da(t,e)._dp&&t._initted&&t._time>=t._dur&&t._ts){if(t._dur<t.duration())for(r=t;r._dp;)0<=r.rawTime()&&r.totalTime(r._tTime),r=r._dp;t._zTime=-q}}function Na(e,r,i,n){return r.parent&&Ca(r),r._start=la((t(i)?i:i||e!==L?Ot(e,i,r):e._time)+r._delay),r._end=la(r._start+(r.totalDuration()/Math.abs(r.timeScale())||0)),Aa(e,r,"_first","_last",e._sort?"_start":0),xt(r)||(e._recent=r),n||Ma(e,r),e._ts<0&&La(e,e._tTime),e}function Oa(t,e){return(ht.ScrollTrigger||S("scrollTrigger",e))&&ht.ScrollTrigger.create(e,t)}function Pa(t,e,r,i,n){return Ht(t,e,n),t._initted?!r&&t._pt&&!I&&(t._dur&&!1!==t.vars.lazy||!t._dur&&t.vars.lazy)&&f!==It.frame?(pt.push(t),t._lazy=[n,i],1):void 0:1}function Ua(t,e,r,i){var n=t._repeat,a=la(e)||0,s=t._tTime/t._tDur;return s&&!i&&(t._time*=a/t._dur),t._dur=a,t._tDur=n?n<0?1e10:la(a*(n+1)+t._rDelay*n):a,0<s&&!i&&La(t,t._tTime=t._tDur*s),t.parent&&Ka(t),r||Da(t.parent,t),t}function Va(t){return t instanceof Gt?Da(t):Ua(t,t._dur)}function Ya(e,r,i){var n,a,s=t(r[1]),o=(s?2:1)+(e<2?0:1),u=r[o];if(s&&(u.duration=r[1]),u.parent=i,e){for(n=u,a=i;a&&!("immediateRender"in n);)n=a.vars.defaults||{},a=w(a.vars.inherit)&&a.parent;u.immediateRender=w(n.immediateRender),e<2?u.runBackwards=1:u.startAt=r[o-1]}return new te(r[0],u,r[1+o])}function Za(t,e){return t||0===t?e(t):e}function _a(t,e){return r(t)&&(e=ut.exec(t))?e[1]:""}function cb(t,e){return t&&v(t)&&"length"in t&&(!e&&!t.length||t.length-1 in t&&v(t[0]))&&!t.nodeType&&t!==h}function fb(r){return r=Pt(r)[0]||T("Invalid scope")||{},function(t){var e=r.current||r.nativeElement||r;return Pt(t,e.querySelectorAll?e:e===r?T("Invalid scope")||a.createElement("div"):r)}}function gb(t){return t.sort(function(){return.5-Math.random()})}function hb(t){if(s(t))return t;var p=v(t)?t:{each:t},_=jt(p.ease),m=p.from||0,g=parseFloat(p.base)||0,y={},e=0<m&&m<1,T=isNaN(m)||e,b=p.axis,w=m,x=m;return r(m)?w=x={center:.5,edges:.5,end:1}[m]||0:!e&&T&&(w=m[0],x=m[1]),function(t,e,r){var i,n,a,s,o,u,h,l,f,c=(r||p).length,d=y[c];if(!d){if(!(f="auto"===p.grid?0:(p.grid||[1,X])[1])){for(h=-X;h<(h=r[f++].getBoundingClientRect().left)&&f<c;);f<c&&f--}for(d=y[c]=[],i=T?Math.min(f,c)*w-.5:m%f,n=f===X?0:T?c*x/f-.5:m/f|0,l=X,u=h=0;u<c;u++)a=u%f-i,s=n-(u/f|0),d[u]=o=b?Math.abs("y"===b?s:a):$(a*a+s*s),h<o&&(h=o),o<l&&(l=o);"random"===m&&gb(d),d.max=h-l,d.min=l,d.v=c=(parseFloat(p.amount)||parseFloat(p.each)*(c<f?c-1:b?"y"===b?c/f:f:Math.max(f,c/f))||0)*("edges"===m?-1:1),d.b=c<0?g-c:g,d.u=_a(p.amount||p.each)||0,_=_&&c<0?Yt(_):_}return c=(d[t]-d.min)/d.max||0,la(d.b+(_?_(c):c)*d.v)+d.u}}function ib(i){var n=Math.pow(10,((i+"").split(".")[1]||"").length);return function(e){var r=la(Math.round(parseFloat(e)/i)*i*n);return(r-r%1)/n+(t(e)?0:_a(e))}}function jb(h,e){var l,f,r=K(h);return!r&&v(h)&&(l=r=h.radius||X,h.values?(h=Pt(h.values),(f=!t(h[0]))&&(l*=l)):h=ib(h.increment)),Za(e,r?s(h)?function(t){return f=h(t),Math.abs(f-t)<=l?f:t}:function(e){for(var r,i,n=parseFloat(f?e.x:e),a=parseFloat(f?e.y:0),s=X,o=0,u=h.length;u--;)(r=f?(r=h[u].x-n)*r+(i=h[u].y-a)*i:Math.abs(h[u]-n))<s&&(s=r,o=u);return o=!l||s<=l?h[o]:e,f||o===e||t(e)?o:o+_a(e)}:ib(h))}function kb(t,e,r,i){return Za(K(t)?!e:!0===r?!!(r=0):!i,function(){return K(t)?t[~~(Math.random()*t.length)]:(r=r||1e-5)&&(i=r<1?Math.pow(10,(r+"").length-2):1)&&Math.floor(Math.round((t-r/2+Math.random()*(e-t+.99*r))/r)*r*i)/i})}function ob(e,r,t){return Za(t,function(t){return e[~~r(t)]})}function rb(t){return t.replace(tt,function(t){var e=t.indexOf("[")+1,r=t.substring(e||7,e?t.indexOf("]"):t.length-1).split(et);return kb(e?r:+r[0],e?0:+r[1],+r[2]||1e-5)})}function ub(t,e,r){var i,n,a,s=t.labels,o=X;for(i in s)(n=s[i]-e)<0==!!r&&n&&o>(n=Math.abs(n))&&(a=i,o=n);return a}function wb(t){return Ca(t),t.scrollTrigger&&t.scrollTrigger.kill(!!I),t.progress()<1&&At(t,"onInterrupt"),t}function zb(t){if(t)if(t=!t.name&&t.default||t,x()||t.headless){var e=t.name,r=s(t),i=e&&!r&&t.init?function(){this._props=[]}:t,n={init:V,render:_e,add:$t,kill:Te,modifier:ve,rawVars:0},a={targetTest:0,get:0,getSetter:ue,aliases:{},register:0};if(Lt(),t!==i){if(mt[e])return;ta(i,ta(xa(t,n),a)),bt(i.prototype,bt(n,xa(t,a))),mt[i.prop=e]=i,t.targetTest&&(yt.push(i),dt[e]=1),e=("css"===e?"CSS":e.charAt(0).toUpperCase()+e.substr(1))+"Plugin"}U(e,i),t.register&&t.register(Fe,i,we)}else Dt.push(t)}function Cb(t,e,r){return(6*(t+=t<0?1:1<t?-1:0)<1?e+(r-e)*t*6:t<.5?r:3*t<2?e+(r-e)*(2/3-t)*6:e)*zt+.5|0}function Db(e,r,i){var n,a,s,o,u,h,l,f,c,d,p=e?t(e)?[e>>16,e>>8&zt,e&zt]:0:Rt.black;if(!p){if(","===e.substr(-1)&&(e=e.substr(0,e.length-1)),Rt[e])p=Rt[e];else if("#"===e.charAt(0)){if(e.length<6&&(e="#"+(n=e.charAt(1))+n+(a=e.charAt(2))+a+(s=e.charAt(3))+s+(5===e.length?e.charAt(4)+e.charAt(4):"")),9===e.length)return[(p=parseInt(e.substr(1,6),16))>>16,p>>8&zt,p&zt,parseInt(e.substr(7),16)/255];p=[(e=parseInt(e.substr(1),16))>>16,e>>8&zt,e&zt]}else if("hsl"===e.substr(0,3))if(p=d=e.match(rt),r){if(~e.indexOf("="))return p=e.match(it),i&&p.length<4&&(p[3]=1),p}else o=+p[0]%360/360,u=p[1]/100,n=2*(h=p[2]/100)-(a=h<=.5?h*(u+1):h+u-h*u),3<p.length&&(p[3]*=1),p[0]=Cb(o+1/3,n,a),p[1]=Cb(o,n,a),p[2]=Cb(o-1/3,n,a);else p=e.match(rt)||Rt.transparent;p=p.map(Number)}return r&&!d&&(n=p[0]/zt,a=p[1]/zt,s=p[2]/zt,h=((l=Math.max(n,a,s))+(f=Math.min(n,a,s)))/2,l===f?o=u=0:(c=l-f,u=.5<h?c/(2-l-f):c/(l+f),o=l===n?(a-s)/c+(a<s?6:0):l===a?(s-n)/c+2:(n-a)/c+4,o*=60),p[0]=~~(o+.5),p[1]=~~(100*u+.5),p[2]=~~(100*h+.5)),i&&p.length<4&&(p[3]=1),p}function Eb(t){var r=[],i=[],n=-1;return t.split(Et).forEach(function(t){var e=t.match(nt)||[];r.push.apply(r,e),i.push(n+=e.length+1)}),r.c=i,r}function Fb(t,e,r){var i,n,a,s,o="",u=(t+o).match(Et),h=e?"hsla(":"rgba(",l=0;if(!u)return t;if(u=u.map(function(t){return(t=Db(t,e,1))&&h+(e?t[0]+","+t[1]+"%,"+t[2]+"%,"+t[3]:t.join(","))+")"}),r&&(a=Eb(t),(i=r.c).join(o)!==a.c.join(o)))for(s=(n=t.replace(Et,"1").split(nt)).length-1;l<s;l++)o+=n[l]+(~i.indexOf(l)?u.shift()||h+"0,0,0,0)":(a.length?a:u.length?u:r).shift());if(!n)for(s=(n=t.split(Et)).length-1;l<s;l++)o+=n[l]+u[l];return o+n[s]}function Ib(t){var e,r=t.join(" ");if(Et.lastIndex=0,Et.test(r))return e=Ft.test(r),t[1]=Fb(t[1],e),t[0]=Fb(t[0],e,Eb(t[1])),!0}function Rb(t){var e=(t+"").split("("),r=Bt[e[0]];return r&&1<e.length&&r.config?r.config.apply(null,~t.indexOf("{")?[function _parseObjectInString(t){for(var e,r,i,n={},a=t.substr(1,t.length-3).split(":"),s=a[0],o=1,u=a.length;o<u;o++)r=a[o],e=o!==u-1?r.lastIndexOf(","):r.length,i=r.substr(0,e),n[s]=isNaN(i)?i.replace(Ut,"").trim():+i,s=r.substr(e+1).trim();return n}(e[1])]:function _valueInParentheses(t){var e=t.indexOf("(")+1,r=t.indexOf(")"),i=t.indexOf("(",e);return t.substring(e,~i&&i<r?t.indexOf(")",r+1):r)}(t).split(",").map(ra)):Bt._CE&&Nt.test(t)?Bt._CE("",t):r}function Ub(t,e,r,i){void 0===r&&(r=function easeOut(t){return 1-e(1-t)}),void 0===i&&(i=function easeInOut(t){return t<.5?e(2*t)/2:1-e(2*(1-t))/2});var n,a={easeIn:e,easeOut:r,easeInOut:i};return ja(t,function(t){for(var e in Bt[t]=ht[t]=a,Bt[n=t.toLowerCase()]=r,a)Bt[n+("easeIn"===e?".in":"easeOut"===e?".out":".inOut")]=Bt[t+"."+e]=a[e]}),a}function Vb(e){return function(t){return t<.5?(1-e(1-2*t))/2:.5+e(2*(t-.5))/2}}function Wb(r,t,e){function Gm(t){return 1===t?1:i*Math.pow(2,-10*t)*Q((t-a)*n)+1}var i=1<=t?t:1,n=(e||(r?.3:.45))/(t<1?t:1),a=n/G*(Math.asin(1/i)||0),s="out"===r?Gm:"in"===r?function(t){return 1-Gm(1-t)}:Vb(Gm);return n=G/n,s.config=function(t,e){return Wb(r,t,e)},s}function Xb(e,r){function Om(t){return t?--t*t*((r+1)*t+r)+1:0}void 0===r&&(r=1.70158);var t="out"===e?Om:"in"===e?function(t){return 1-Om(1-t)}:Vb(Om);return t.config=function(t){return Xb(e,t)},t}var F,I,l,L,h,n,a,i,o,f,c,d,p,_,m,g,b,k,O,M,C,P,A,D,z,E,B,N,Y={autoSleep:120,force3D:"auto",nullTargetWarn:1,units:{lineHeight:""}},j={duration:.5,overwrite:!1,delay:0},X=1e8,q=1/X,G=2*Math.PI,Z=G/4,W=0,$=Math.sqrt,H=Math.cos,Q=Math.sin,J="function"==typeof ArrayBuffer&&ArrayBuffer.isView||function(){},K=Array.isArray,tt=/random\([^)]+\)/g,et=/,\s*/g,rt=/(?:-?\.?\d|\.)+/gi,it=/[-+=.]*\d+[.e\-+]*\d*[e\-+]*\d*/g,nt=/[-+=.]*\d+[.e-]*\d*[a-z%]*/g,at=/[-+=.]*\d+\.?\d*(?:e-|e\+)?\d*/gi,st=/[+-]=-?[.\d]+/,ot=/[^,'"\[\]\s]+/gi,ut=/^[+\-=e\s\d]*\d+[.\d]*([a-z]*|%)\s*$/i,ht={},lt={suppressEvents:!0,isStart:!0,kill:!1},ft={suppressEvents:!0,kill:!1},ct={suppressEvents:!0},dt={},pt=[],_t={},mt={},gt={},vt=30,yt=[],Tt="",bt=function _merge(t,e){for(var r in e)t[r]=e[r];return t},wt=function _animationCycle(t,e){var r=Math.floor(t=la(t/e));return t&&r===t?r-1:r},xt=function _isFromOrFromStart(t){var e=t.data;return"isFromStart"===e||"isStart"===e},kt={_start:0,endTime:V,totalDuration:V},Ot=function _parsePosition(t,e,i){var n,a,s,o=t.labels,u=t._recent||kt,h=t.duration()>=X?u.endTime(!1):t._dur;return r(e)&&(isNaN(e)||e in o)?(a=e.charAt(0),s="%"===e.substr(-1),n=e.indexOf("="),"<"===a||">"===a?(0<=n&&(e=e.replace(/=/,"")),("<"===a?u._start:u.endTime(0<=u._repeat))+(parseFloat(e.substr(1))||0)*(s?(n<0?u:i).totalDuration()/100:1)):n<0?(e in o||(o[e]=h),o[e]):(a=parseFloat(e.charAt(n-1)+e.substr(n+1)),s&&i&&(a=a/100*(K(i)?i[0]:i).totalDuration()),1<n?_parsePosition(t,e.substr(0,n-1),i)+a:h+a)):null==e?h:+e},Mt=function _clamp(t,e,r){return r<t?t:e<r?e:r},Ct=[].slice,Pt=function toArray(t,e,i){return l&&!e&&l.selector?l.selector(t):!r(t)||i||!n&&Lt()?K(t)?function _flatten(t,e,i){return void 0===i&&(i=[]),t.forEach(function(t){return r(t)&&!e||cb(t,1)?i.push.apply(i,Pt(t)):i.push(t)})||i}(t,i):cb(t)?Ct.call(t,0):t?[t]:[]:Ct.call((e||a).querySelectorAll(t),0)},St=function mapRange(e,t,r,i,n){var a=t-e,s=i-r;return Za(n,function(t){return r+((t-e)/a*s||0)})},At=function _callback(t,e,r){var i,n,a,s=t.vars,o=s[e],u=l,h=t._ctx;if(o)return i=s[e+"Params"],n=s.callbackScope||t,r&&pt.length&&oa(),h&&(l=h),a=i?o.apply(n,i):o.call(n),l=u,a},Dt=[],zt=255,Rt={aqua:[0,zt,zt],lime:[0,zt,0],silver:[192,192,192],black:[0,0,0],maroon:[128,0,0],teal:[0,128,128],blue:[0,0,zt],navy:[0,0,128],white:[zt,zt,zt],olive:[128,128,0],yellow:[zt,zt,0],orange:[zt,165,0],gray:[128,128,128],purple:[128,0,128],green:[0,128,0],red:[zt,0,0],pink:[zt,192,203],cyan:[0,zt,zt],transparent:[zt,zt,zt,0]},Et=function(){var t,e="(?:\\b(?:(?:rgb|rgba|hsl|hsla)\\(.+?\\))|\\B#(?:[0-9a-f]{3,4}){1,2}\\b";for(t in Rt)e+="|"+t+"\\b";return new RegExp(e+")","gi")}(),Ft=/hsl[a]?\(/,It=(O=Date.now,M=500,C=33,P=O(),A=P,z=D=1e3/240,g={time:0,frame:0,tick:function tick(){zl(!0)},deltaRatio:function deltaRatio(t){return b/(1e3/(t||60))},wake:function wake(){o&&(!n&&x()&&(h=n=window,a=h.document||{},ht.gsap=Fe,(h.gsapVersions||(h.gsapVersions=[])).push(Fe.version),R(i||h.GreenSockGlobals||!h.gsap&&h||{}),Dt.forEach(zb)),m="undefined"!=typeof requestAnimationFrame&&requestAnimationFrame,p&&g.sleep(),_=m||function(t){return setTimeout(t,z-1e3*g.time+1|0)},d=1,zl(2))},sleep:function sleep(){(m?cancelAnimationFrame:clearTimeout)(p),d=0,_=V},lagSmoothing:function lagSmoothing(t,e){M=t||1/0,C=Math.min(e||33,M)},fps:function fps(t){D=1e3/(t||240),z=1e3*g.time+D},add:function add(n,t,e){var a=t?function(t,e,r,i){n(t,e,r,i),g.remove(a)}:n;return g.remove(n),E[e?"unshift":"push"](a),Lt(),a},remove:function remove(t,e){~(e=E.indexOf(t))&&E.splice(e,1)&&e<=k&&k--},_listeners:E=[]}),Lt=function _wake(){return!d&&It.wake()},Bt={},Nt=/^[\d.\-M][\d.\-,\s]/,Ut=/["']/g,Yt=function _invertEase(e){return function(t){return 1-e(1-t)}},jt=function _parseEase(t,e){return t&&(s(t)?t:Bt[t]||Rb(t))||e};function zl(t){var e,r,i,n,a=O()-A,s=!0===t;if((M<a||a<0)&&(P+=a-C),(0<(e=(i=(A+=a)-P)-z)||s)&&(n=++g.frame,b=i-1e3*g.time,g.time=i/=1e3,z+=e+(D<=e?4:D-e),r=1),s||(p=_(zl)),r)for(k=0;k<E.length;k++)E[k](i,b,n,t)}function dn(t){return t<N?B*t*t:t<.7272727272727273?B*Math.pow(t-1.5/2.75,2)+.75:t<.9090909090909092?B*(t-=2.25/2.75)*t+.9375:B*Math.pow(t-2.625/2.75,2)+.984375}ja("Linear,Quad,Cubic,Quart,Quint,Strong",function(t,e){var r=e<5?e+1:e;Ub(t+",Power"+(r-1),e?function(t){return Math.pow(t,r)}:function(t){return t},function(t){return 1-Math.pow(1-t,r)},function(t){return t<.5?Math.pow(2*t,r)/2:1-Math.pow(2*(1-t),r)/2})}),Bt.Linear.easeNone=Bt.none=Bt.Linear.easeIn,Ub("Elastic",Wb("in"),Wb("out"),Wb()),B=7.5625,N=1/2.75,Ub("Bounce",function(t){return 1-dn(1-t)},dn),Ub("Expo",function(t){return Math.pow(2,10*(t-1))*t+t*t*t*t*t*t*(1-t)}),Ub("Circ",function(t){return-($(1-t*t)-1)}),Ub("Sine",function(t){return 1===t?1:1-H(t*Z)}),Ub("Back",Xb("in"),Xb("out"),Xb()),Bt.SteppedEase=Bt.steps=ht.SteppedEase={config:function config(t,e){void 0===t&&(t=1);var r=1/t,i=t+(e?0:1),n=e?1:0;return function(t){return((i*Mt(0,.99999999,t)|0)+n)*r}}},j.ease=Bt["quad.out"],ja("onComplete,onUpdate,onStart,onRepeat,onReverseComplete,onInterrupt",function(t){return Tt+=t+","+t+"Params,"});var Vt,Xt=function GSCache(t,e){this.id=W++,(t._gsap=this).target=t,this.harness=e,this.get=e?e.get:ia,this.set=e?e.getSetter:ue},qt=((Vt=Animation.prototype).delay=function delay(t){return t||0===t?(this.parent&&this.parent.smoothChildTiming&&this.startTime(this._start+t-this._delay),this._delay=t,this):this._delay},Vt.duration=function duration(t){return arguments.length?this.totalDuration(0<this._repeat?t+(t+this._rDelay)*this._repeat:t):this.totalDuration()&&this._dur},Vt.totalDuration=function totalDuration(t){return arguments.length?(this._dirty=0,Ua(this,this._repeat<0?t:(t-this._repeat*this._rDelay)/(this._repeat+1))):this._tDur},Vt.totalTime=function totalTime(t,e){if(Lt(),!arguments.length)return this._tTime;var r=this._dp;if(r&&r.smoothChildTiming&&this._ts){for(La(this,t),!r._dp||r.parent||Ma(r,this);r&&r.parent;)r.parent._time!==r._start+(0<=r._ts?r._tTime/r._ts:(r.totalDuration()-r._tTime)/-r._ts)&&r.totalTime(r._tTime,!0),r=r.parent;!this.parent&&this._dp.autoRemoveChildren&&(0<this._ts&&t<this._tDur||this._ts<0&&0<t||!this._tDur&&!t)&&Na(this._dp,this,this._start-this._delay)}return(this._tTime!==t||!this._dur&&!e||this._initted&&Math.abs(this._zTime)===q||!this._initted&&this._dur&&t||!t&&!this._initted&&(this.add||this._ptLookup))&&(this._ts||(this._pTime=t),qa(this,t,e)),this},Vt.time=function time(t,e){return arguments.length?this.totalTime(Math.min(this.totalDuration(),t+Ha(this))%(this._dur+this._rDelay)||(t?this._dur:0),e):this._time},Vt.totalProgress=function totalProgress(t,e){return arguments.length?this.totalTime(this.totalDuration()*t,e):this.totalDuration()?Math.min(1,this._tTime/this._tDur):0<=this.rawTime()&&this._initted?1:0},Vt.progress=function progress(t,e){return arguments.length?this.totalTime(this.duration()*(!this._yoyo||1&this.iteration()?t:1-t)+Ha(this),e):this.duration()?Math.min(1,this._time/this._dur):0<this.rawTime()?1:0},Vt.iteration=function iteration(t,e){var r=this.duration()+this._rDelay;return arguments.length?this.totalTime(this._time+(t-1)*r,e):this._repeat?wt(this._tTime,r)+1:1},Vt.timeScale=function timeScale(t,e){if(!arguments.length)return this._rts===-q?0:this._rts;if(this._rts===t)return this;var r=this.parent&&this._ts?Ja(this.parent._time,this):this._tTime;return this._rts=+t||0,this._ts=this._ps||t===-q?0:this._rts,this.totalTime(Mt(-Math.abs(this._delay),this.totalDuration(),r),!1!==e),Ka(this),function _recacheAncestors(t){for(var e=t.parent;e&&e.parent;)e._dirty=1,e.totalDuration(),e=e.parent;return t}(this)},Vt.paused=function paused(t){return arguments.length?(this._ps!==t&&((this._ps=t)?(this._pTime=this._tTime||Math.max(-this._delay,this.rawTime()),this._ts=this._act=0):(Lt(),this._ts=this._rts,this.totalTime(this.parent&&!this.parent.smoothChildTiming?this.rawTime():this._tTime||this._pTime,1===this.progress()&&Math.abs(this._zTime)!==q&&(this._tTime-=q)))),this):this._ps},Vt.startTime=function startTime(t){if(arguments.length){this._start=la(t);var e=this.parent||this._dp;return!e||!e._sort&&this.parent||Na(e,this,this._start-this._delay),this}return this._start},Vt.endTime=function endTime(t){return this._start+(w(t)?this.totalDuration():this.duration())/Math.abs(this._ts||1)},Vt.rawTime=function rawTime(t){var e=this.parent||this._dp;return e?t&&(!this._ts||this._repeat&&this._time&&this.totalProgress()<1)?this._tTime%(this._dur+this._rDelay):this._ts?Ja(e.rawTime(t),this):this._tTime:this._tTime},Vt.revert=function revert(t){void 0===t&&(t=ct);var e=I;return I=t,pa(this)&&(this.timeline&&this.timeline.revert(t),this.totalTime(-.01,t.suppressEvents)),"nested"!==this.data&&!1!==t.kill&&this.kill(),I=e,this},Vt.globalTime=function globalTime(t){for(var e=this,r=arguments.length?t:e.rawTime();e;)r=e._start+r/(Math.abs(e._ts)||1),e=e._dp;return!this.parent&&this._sat?this._sat.globalTime(t):r},Vt.repeat=function repeat(t){return arguments.length?(this._repeat=t===1/0?-2:t,Va(this)):-2===this._repeat?1/0:this._repeat},Vt.repeatDelay=function repeatDelay(t){if(arguments.length){var e=this._time;return this._rDelay=t,Va(this),e?this.time(e):this}return this._rDelay},Vt.yoyo=function yoyo(t){return arguments.length?(this._yoyo=t,this):this._yoyo},Vt.seek=function seek(t,e){return this.totalTime(Ot(this,t),w(e))},Vt.restart=function restart(t,e){return this.play().totalTime(t?-this._delay:0,w(e)),this._dur||(this._zTime=-q),this},Vt.play=function play(t,e){return null!=t&&this.seek(t,e),this.reversed(!1).paused(!1)},Vt.reverse=function reverse(t,e){return null!=t&&this.seek(t||this.totalDuration(),e),this.reversed(!0).paused(!1)},Vt.pause=function pause(t,e){return null!=t&&this.seek(t,e),this.paused(!0)},Vt.resume=function resume(){return this.paused(!1)},Vt.reversed=function reversed(t){return arguments.length?(!!t!==this.reversed()&&this.timeScale(-this._rts||(t?-q:0)),this):this._rts<0},Vt.invalidate=function invalidate(){return this._initted=this._act=0,this._zTime=-q,this},Vt.isActive=function isActive(){var t,e=this.parent||this._dp,r=this._start;return!(e&&!(this._ts&&this._initted&&e.isActive()&&(t=e.rawTime(!0))>=r&&t<this.endTime(!0)-q))},Vt.eventCallback=function eventCallback(t,e,r){var i=this.vars;return 1<arguments.length?(e?(i[t]=e,r&&(i[t+"Params"]=r),"onUpdate"===t&&(this._onUpdate=e)):delete i[t],this):i[t]},Vt.then=function then(t){var i=this,n=i._prom;return new Promise(function(e){function Ao(){var t=i.then;i.then=null,n&&n(),s(r)&&(r=r(i))&&(r.then||r===i)&&(i.then=t),e(r),i.then=t}var r=s(t)?t:sa;i._initted&&1===i.totalProgress()&&0<=i._ts||!i._tTime&&i._ts<0?Ao():i._prom=Ao})},Vt.kill=function kill(){wb(this)},Animation);function Animation(t){this.vars=t,this._delay=+t.delay||0,(this._repeat=t.repeat===1/0?-2:t.repeat||0)&&(this._rDelay=t.repeatDelay||0,this._yoyo=!!t.yoyo||!!t.yoyoEase),this._ts=1,Ua(this,+t.duration,1,1),this.data=t.data,l&&(this._ctx=l).data.push(this),d||It.wake()}ta(qt.prototype,{_time:0,_start:0,_end:0,_tTime:0,_tDur:0,_dirty:0,_repeat:0,_yoyo:!1,parent:null,_initted:!1,_rDelay:0,_ts:1,_dp:0,ratio:0,_zTime:-q,_prom:0,_ps:!1,_rts:1});var Gt=function(i){function Timeline(t,e){var r;return void 0===t&&(t={}),(r=i.call(this,t)||this).labels={},r.smoothChildTiming=!!t.smoothChildTiming,r.autoRemoveChildren=!!t.autoRemoveChildren,r._sort=w(t.sortChildren),L&&Na(t.parent||L,_assertThisInitialized(r),e),t.reversed&&r.reverse(),t.paused&&r.paused(!0),t.scrollTrigger&&Oa(_assertThisInitialized(r),t.scrollTrigger),r}_inheritsLoose(Timeline,i);var e=Timeline.prototype;return e.to=function to(t,e,r){return Ya(0,arguments,this),this},e.from=function from(t,e,r){return Ya(1,arguments,this),this},e.fromTo=function fromTo(t,e,r,i){return Ya(2,arguments,this),this},e.set=function set(t,e,r){return e.duration=0,e.parent=this,ya(e).repeatDelay||(e.repeat=0),e.immediateRender=!!e.immediateRender,new te(t,e,Ot(this,r),1),this},e.call=function call(t,e,r){return Na(this,te.delayedCall(0,t,e),r)},e.staggerTo=function staggerTo(t,e,r,i,n,a,s){return r.duration=e,r.stagger=r.stagger||i,r.onComplete=a,r.onCompleteParams=s,r.parent=this,new te(t,r,Ot(this,n)),this},e.staggerFrom=function staggerFrom(t,e,r,i,n,a,s){return r.runBackwards=1,ya(r).immediateRender=w(r.immediateRender),this.staggerTo(t,e,r,i,n,a,s)},e.staggerFromTo=function staggerFromTo(t,e,r,i,n,a,s,o){return i.startAt=r,ya(i).immediateRender=w(i.immediateRender),this.staggerTo(t,e,i,n,a,s,o)},e.render=function render(t,e,r){var i,n,a,s,o,u,h,l,f,c,d,p,_=this._time,m=this._dirty?this.totalDuration():this._tDur,g=this._dur,v=t<=0?0:la(t),y=this._zTime<0!=t<0&&(this._initted||!g);if(this!==L&&m<v&&0<=t&&(v=m),v!==this._tTime||r||y){if(_!==this._time&&g&&(v+=this._time-_,t+=this._time-_),i=v,f=this._start,u=!(l=this._ts),y&&(g||(_=this._zTime),!t&&e||(this._zTime=t)),this._repeat){if(d=this._yoyo,o=g+this._rDelay,this._repeat<-1&&t<0)return this.totalTime(100*o+t,e,r);if(i=la(v%o),v===m?(s=this._repeat,i=g):((s=~~(c=la(v/o)))&&s===c&&(i=g,s--),g<i&&(i=g)),c=wt(this._tTime,o),!_&&this._tTime&&c!==s&&this._tTime-c*o-this._dur<=0&&(c=s),d&&1&s&&(i=g-i,p=1),s!==c&&!this._lock){var T=d&&1&c,b=T===(d&&1&s);if(s<c&&(T=!T),_=T?0:v%g?g:v,this._lock=1,this.render(_||(p?0:la(s*o)),e,!g)._lock=0,this._tTime=v,!e&&this.parent&&At(this,"onRepeat"),this.vars.repeatRefresh&&!p&&(this.invalidate()._lock=1,c=s),_&&_!==this._time||u!=!this._ts||this.vars.onRepeat&&!this.parent&&!this._act)return this;if(g=this._dur,m=this._tDur,b&&(this._lock=2,_=T?g:-1e-4,this.render(_,!0),this.vars.repeatRefresh&&!p&&this.invalidate()),this._lock=0,!this._ts&&!u)return this}}if(this._hasPause&&!this._forcing&&this._lock<2&&(h=function _findNextPauseTween(t,e,r){var i;if(e<r)for(i=t._first;i&&i._start<=r;){if("isPause"===i.data&&i._start>e)return i;i=i._next}else for(i=t._last;i&&i._start>=r;){if("isPause"===i.data&&i._start<e)return i;i=i._prev}}(this,la(_),la(i)))&&(v-=i-(i=h._start)),this._tTime=v,this._time=i,this._act=!!l,this._initted||(this._onUpdate=this.vars.onUpdate,this._initted=1,this._zTime=t,_=0),!_&&v&&g&&!e&&!c&&(At(this,"onStart"),this._tTime!==v))return this;if(_<=i&&0<=t)for(n=this._first;n;){if(a=n._next,(n._act||i>=n._start)&&n._ts&&h!==n){if(n.parent!==this)return this.render(t,e,r);if(n.render(0<n._ts?(i-n._start)*n._ts:(n._dirty?n.totalDuration():n._tDur)+(i-n._start)*n._ts,e,r),i!==this._time||!this._ts&&!u){h=0,a&&(v+=this._zTime=-q);break}}n=a}else{n=this._last;for(var w=t<0?t:i;n;){if(a=n._prev,(n._act||w<=n._end)&&n._ts&&h!==n){if(n.parent!==this)return this.render(t,e,r);if(n.render(0<n._ts?(w-n._start)*n._ts:(n._dirty?n.totalDuration():n._tDur)+(w-n._start)*n._ts,e,r||I&&pa(n)),i!==this._time||!this._ts&&!u){h=0,a&&(v+=this._zTime=w?-q:q);break}}n=a}}if(h&&!e&&(this.pause(),h.render(_<=i?0:-q)._zTime=_<=i?1:-1,this._ts))return this._start=f,Ka(this),this.render(t,e,r);this._onUpdate&&!e&&At(this,"onUpdate",!0),(v===m&&this._tTime>=this.totalDuration()||!v&&_)&&(f!==this._start&&Math.abs(l)===Math.abs(this._ts)||this._lock||(!t&&g||!(v===m&&0<this._ts||!v&&this._ts<0)||Ca(this,1),e||t<0&&!_||!v&&!_&&m||(At(this,v===m&&0<=t?"onComplete":"onReverseComplete",!0),!this._prom||v<m&&0<this.timeScale()||this._prom())))}return this},e.add=function add(e,i){var n=this;if(t(i)||(i=Ot(this,i,e)),!(e instanceof qt)){if(K(e))return e.forEach(function(t){return n.add(t,i)}),this;if(r(e))return this.addLabel(e,i);if(!s(e))return this;e=te.delayedCall(0,e)}return this!==e?Na(this,e,i):this},e.getChildren=function getChildren(t,e,r,i){void 0===t&&(t=!0),void 0===e&&(e=!0),void 0===r&&(r=!0),void 0===i&&(i=-X);for(var n=[],a=this._first;a;)a._start>=i&&(a instanceof te?e&&n.push(a):(r&&n.push(a),t&&n.push.apply(n,a.getChildren(!0,e,r)))),a=a._next;return n},e.getById=function getById(t){for(var e=this.getChildren(1,1,1),r=e.length;r--;)if(e[r].vars.id===t)return e[r]},e.remove=function remove(t){return r(t)?this.removeLabel(t):s(t)?this.killTweensOf(t):(t.parent===this&&Ba(this,t),t===this._recent&&(this._recent=this._last),Da(this))},e.totalTime=function totalTime(t,e){return arguments.length?(this._forcing=1,!this._dp&&this._ts&&(this._start=la(It.time-(0<this._ts?t/this._ts:(this.totalDuration()-t)/-this._ts))),i.prototype.totalTime.call(this,t,e),this._forcing=0,this):this._tTime},e.addLabel=function addLabel(t,e){return this.labels[t]=Ot(this,e),this},e.removeLabel=function removeLabel(t){return delete this.labels[t],this},e.addPause=function addPause(t,e,r){var i=te.delayedCall(0,e||V,r);return i.data="isPause",this._hasPause=1,Na(this,i,Ot(this,t))},e.removePause=function removePause(t){var e=this._first;for(t=Ot(this,t);e;)e._start===t&&"isPause"===e.data&&Ca(e),e=e._next},e.killTweensOf=function killTweensOf(t,e,r){for(var i=this.getTweensOf(t,r),n=i.length;n--;)Zt!==i[n]&&i[n].kill(t,e);return this},e.getTweensOf=function getTweensOf(e,r){for(var i,n=[],a=Pt(e),s=this._first,o=t(r);s;)s instanceof te?na(s._targets,a)&&(o?(!Zt||s._initted&&s._ts)&&s.globalTime(0)<=r&&s.globalTime(s.totalDuration())>r:!r||s.isActive())&&n.push(s):(i=s.getTweensOf(a,r)).length&&n.push.apply(n,i),s=s._next;return n},e.tweenTo=function tweenTo(t,e){e=e||{};var r,i=this,n=Ot(i,t),a=e.startAt,s=e.onStart,o=e.onStartParams,u=e.immediateRender,h=te.to(i,ta({ease:e.ease||"none",lazy:!1,immediateRender:!1,time:n,overwrite:"auto",duration:e.duration||Math.abs((n-(a&&"time"in a?a.time:i._time))/i.timeScale())||q,onStart:function onStart(){if(i.pause(),!r){var t=e.duration||Math.abs((n-(a&&"time"in a?a.time:i._time))/i.timeScale());h._dur!==t&&Ua(h,t,0,1).render(h._time,!0,!0),r=1}s&&s.apply(h,o||[])}},e));return u?h.render(0):h},e.tweenFromTo=function tweenFromTo(t,e,r){return this.tweenTo(e,ta({startAt:{time:Ot(this,t)}},r))},e.recent=function recent(){return this._recent},e.nextLabel=function nextLabel(t){return void 0===t&&(t=this._time),ub(this,Ot(this,t))},e.previousLabel=function previousLabel(t){return void 0===t&&(t=this._time),ub(this,Ot(this,t),1)},e.currentLabel=function currentLabel(t){return arguments.length?this.seek(t,!0):this.previousLabel(this._time+q)},e.shiftChildren=function shiftChildren(t,e,r){void 0===r&&(r=0);var i,n=this._first,a=this.labels;for(t=la(t);n;)n._start>=r&&(n._start+=t,n._end+=t),n=n._next;if(e)for(i in a)a[i]>=r&&(a[i]+=t);return Da(this)},e.invalidate=function invalidate(t){var e=this._first;for(this._lock=0;e;)e.invalidate(t),e=e._next;return i.prototype.invalidate.call(this,t)},e.clear=function clear(t){void 0===t&&(t=!0);for(var e,r=this._first;r;)e=r._next,this.remove(r),r=e;return this._dp&&(this._time=this._tTime=this._pTime=0),t&&(this.labels={}),Da(this)},e.totalDuration=function totalDuration(t){var e,r,i,n=0,a=this,s=a._last,o=X;if(arguments.length)return a.timeScale((a._repeat<0?a.duration():a.totalDuration())/(a.reversed()?-t:t));if(a._dirty){for(i=a.parent;s;)e=s._prev,s._dirty&&s.totalDuration(),o<(r=s._start)&&a._sort&&s._ts&&!a._lock?(a._lock=1,Na(a,s,r-s._delay,1)._lock=0):o=r,r<0&&s._ts&&(n-=r,(!i&&!a._dp||i&&i.smoothChildTiming)&&(a._start+=la(r/a._ts),a._time-=r,a._tTime-=r),a.shiftChildren(-r,!1,-Infinity),o=0),s._end>n&&s._ts&&(n=s._end),s=e;Ua(a,a===L&&a._time>n?a._time:n,1,1),a._dirty=0}return a._tDur},Timeline.updateRoot=function updateRoot(t){if(L._ts&&(qa(L,Ja(t,L)),f=It.frame),It.frame>=vt){vt+=Y.autoSleep||120;var e=L._first;if((!e||!e._ts)&&Y.autoSleep&&It._listeners.length<2){for(;e&&!e._ts;)e=e._next;e||It.sleep()}}},Timeline}(qt);ta(Gt.prototype,{_lock:0,_hasPause:0,_forcing:0});function cc(t,e,i,n,a,o){var u,h,l,f;if(mt[t]&&!1!==(u=new mt[t]).init(a,u.rawVars?e[t]:function _processVars(t,e,i,n,a){if(s(t)&&(t=Qt(t,a,e,i,n)),!v(t)||t.style&&t.nodeType||K(t)||J(t))return r(t)?Qt(t,a,e,i,n):t;var o,u={};for(o in t)u[o]=Qt(t[o],a,e,i,n);return u}(e[t],n,a,o,i),i,n,o)&&(i._pt=h=new we(i._pt,a,t,0,1,u.render,u,0,u.priority),i!==c))for(l=i._ptLookup[i._targets.indexOf(a)],f=u._props.length;f--;)l[u._props[f]]=h;return u}function ic(t,r,e,i){var n,a,s=r.ease||i||"power1.inOut";if(K(r))a=e[t]||(e[t]=[]),r.forEach(function(t,e){return a.push({t:e/(r.length-1)*100,v:t,e:s})});else for(n in r)a=e[n]||(e[n]=[]),"ease"===n||a.push({t:parseFloat(t),v:r[n],e:s})}var Zt,Wt,$t=function _addPropTween(t,e,i,n,a,o,u,h,l,f){s(n)&&(n=n(a||0,t,o));var c,d=t[e],p="get"!==i?i:s(d)?l?t[e.indexOf("set")||!s(t["get"+e.substr(3)])?e:"get"+e.substr(3)](l):t[e]():d,_=s(d)?l?se:ae:ie;if(r(n)&&(~n.indexOf("random(")&&(n=rb(n)),"="===n.charAt(1)&&(!(c=ma(p,n)+(_a(p)||0))&&0!==c||(n=c))),!f||p!==n||Wt)return isNaN(p*n)||""===n?(d||e in t||S(e,n),function _addComplexStringPropTween(t,e,r,i,n,a,s){var o,u,h,l,f,c,d,p,_=new we(this._pt,t,e,0,1,pe,null,n),m=0,g=0;for(_.b=r,_.e=i,r+="",(d=~(i+="").indexOf("random("))&&(i=rb(i)),a&&(a(p=[r,i],t,e),r=p[0],i=p[1]),u=r.match(at)||[];o=at.exec(i);)l=o[0],f=i.substring(m,o.index),h?h=(h+1)%5:"rgba("===f.substr(-5)&&(h=1),l!==u[g++]&&(c=parseFloat(u[g-1])||0,_._pt={_next:_._pt,p:f||1===g?f:",",s:c,c:"="===l.charAt(1)?ma(c,l)-c:parseFloat(l)-c,m:h&&h<4?Math.round:0},m=at.lastIndex);return _.c=m<i.length?i.substring(m,i.length):"",_.fp=s,(st.test(i)||d)&&(_.e=0),this._pt=_}.call(this,t,e,p,n,_,h||Y.stringFilter,l)):(c=new we(this._pt,t,e,+p||0,n-(p||0),"boolean"==typeof d?de:fe,0,_),l&&(c.fp=l),u&&c.modifier(u,this,t),this._pt=c)},Ht=function _initTween(t,e,r){var i,n,a,s,o,u,h,l,f,c,d,p,_,m=t.vars,g=m.ease,v=m.startAt,y=m.immediateRender,T=m.lazy,b=m.onUpdate,x=m.runBackwards,k=m.yoyoEase,O=m.keyframes,M=m.autoRevert,C=t._dur,P=t._startAt,S=t._targets,A=t.parent,D=A&&"nested"===A.data?A.vars.targets:S,z="auto"===t._overwrite&&!F,R=t.timeline,E=m.easeReverse||k;if(!R||O&&g||(g="none"),t._ease=jt(g,j.ease),t._rEase=E&&(jt(E)||t._ease),t._from=!R&&!!m.runBackwards,t._from&&(t.ratio=1),!R||O&&!m.stagger){if(p=(l=S[0]?ha(S[0]).harness:0)&&m[l.prop],i=xa(m,dt),P&&(P._zTime<0&&P.progress(1),e<0&&x&&y&&!M?P.render(-1,!0):P.revert(x&&C?ft:lt),P._lazy=0),v){if(Ca(t._startAt=te.set(S,ta({data:"isStart",overwrite:!1,parent:A,immediateRender:!0,lazy:!P&&w(T),startAt:null,delay:0,onUpdate:b&&function(){return At(t,"onUpdate")},stagger:0},v))),t._startAt._dp=0,t._startAt._sat=t,e<0&&(I||!y&&!M)&&t._startAt.revert(ft),y&&C&&e<=0&&r<=0)return void(e&&(t._zTime=e))}else if(x&&C&&!P)if(e&&(y=!1),a=ta({overwrite:!1,data:"isFromStart",lazy:y&&!P&&w(T),immediateRender:y,stagger:0,parent:A},i),p&&(a[l.prop]=p),Ca(t._startAt=te.set(S,a)),t._startAt._dp=0,t._startAt._sat=t,e<0&&(I?t._startAt.revert(ft):t._startAt.render(-1,!0)),t._zTime=e,y){if(!e)return}else _initTween(t._startAt,q,q);for(t._pt=t._ptCache=0,T=C&&w(T)||T&&!C,n=0;n<S.length;n++){if(h=(o=S[n])._gsap||ga(S)[n]._gsap,t._ptLookup[n]=c={},_t[h.id]&&pt.length&&oa(),d=D===S?n:D.indexOf(o),l&&!1!==(f=new l).init(o,p||i,t,d,D)&&(t._pt=s=new we(t._pt,o,f.name,0,1,f.render,f,0,f.priority),f._props.forEach(function(t){c[t]=s}),f.priority&&(u=1)),!l||p)for(a in i)mt[a]&&(f=cc(a,i,t,d,o,D))?f.priority&&(u=1):c[a]=s=$t.call(t,o,a,"get",i[a],d,D,0,m.stringFilter);t._op&&t._op[n]&&t.kill(o,t._op[n]),z&&t._pt&&(Zt=t,L.killTweensOf(o,c,t.globalTime(e)),_=!t.parent,Zt=0),t._pt&&T&&(_t[h.id]=1)}u&&be(t),t._onInit&&t._onInit(t)}t._onUpdate=b,t._initted=(!t._op||t._pt)&&!_,O&&e<=0&&R.render(X,!0,!0)},Qt=function _parseFuncOrString(t,e,i,n,a){return s(t)?t.call(e,i,n,a):r(t)&&~t.indexOf("random(")?rb(t):t},Jt=Tt+"repeat,repeatDelay,yoyo,repeatRefresh,yoyoEase,easeReverse,autoRevert",Kt={};ja(Jt+",id,stagger,delay,duration,paused,scrollTrigger",function(t){return Kt[t]=1});var te=function(E){function Tween(e,r,i,n){var a;"number"==typeof r&&(i.duration=r,r=i,i=null);var s,o,u,h,l,f,c,d,p=(a=E.call(this,n?r:ya(r))||this).vars,_=p.duration,m=p.delay,g=p.immediateRender,b=p.stagger,x=p.overwrite,k=p.keyframes,O=p.defaults,M=p.scrollTrigger,C=r.parent||L,P=(K(e)||J(e)?t(e[0]):"length"in r)?[e]:Pt(e);if(a._targets=P.length?ga(P):T("GSAP target "+e+" not found. https://gsap.com",!Y.nullTargetWarn)||[],a._ptLookup=[],a._overwrite=x,k||b||y(_)||y(m)){var S=(r=a.vars).easeReverse||r.yoyoEase;if((s=a.timeline=new Gt({data:"nested",defaults:O||{},targets:C&&"nested"===C.data?C.vars.targets:P})).kill(),s.parent=s._dp=_assertThisInitialized(a),s._start=0,b||y(_)||y(m)){if(h=P.length,c=b&&hb(b),v(b))for(l in b)~Jt.indexOf(l)&&((d=d||{})[l]=b[l]);for(o=0;o<h;o++)(u=xa(r,Kt)).stagger=0,S&&(u.easeReverse=S),d&&bt(u,d),f=P[o],u.duration=+Qt(_,_assertThisInitialized(a),o,f,P),u.delay=(+Qt(m,_assertThisInitialized(a),o,f,P)||0)-a._delay,!b&&1===h&&u.delay&&(a._delay=m=u.delay,a._start+=m,u.delay=0),s.to(f,u,c?c(o,f,P):0),s._ease=Bt.none;s.duration()?_=m=0:a.timeline=0}else if(k){ya(ta(s.vars.defaults,{ease:"none"})),s._ease=jt(k.ease||r.ease||"none");var A,D,z,R=0;if(K(k))k.forEach(function(t){return s.to(P,t,">")}),s.duration();else{for(l in u={},k)"ease"===l||"easeEach"===l||ic(l,k[l],u,k.easeEach);for(l in u)for(A=u[l].sort(function(t,e){return t.t-e.t}),o=R=0;o<A.length;o++)(z={ease:(D=A[o]).e,duration:(D.t-(o?A[o-1].t:0))/100*_})[l]=D.v,s.to(P,z,R),R+=z.duration;s.duration()<_&&s.to({},{duration:_-s.duration()})}}_||a.duration(_=s.duration())}else a.timeline=0;return!0!==x||F||(Zt=_assertThisInitialized(a),L.killTweensOf(P),Zt=0),Na(C,_assertThisInitialized(a),i),r.reversed&&a.reverse(),r.paused&&a.paused(!0),(g||!_&&!k&&a._start===la(C._time)&&w(g)&&function _hasNoPausedAncestors(t){return!t||t._ts&&_hasNoPausedAncestors(t.parent)}(_assertThisInitialized(a))&&"nested"!==C.data)&&(a._tTime=-q,a.render(Math.max(0,-m)||0)),M&&Oa(_assertThisInitialized(a),M),a}_inheritsLoose(Tween,E);var e=Tween.prototype;return e.render=function render(t,e,r){var i,n,a,s,o,u,h,l,f=this._time,c=this._tDur,d=this._dur,p=t<0,_=c-q<t&&!p?c:t<q?0:t;if(d){if(_!==this._tTime||!t||r||!this._initted&&this._tTime||this._startAt&&this._zTime<0!=p||this._lazy){if(i=_,l=this.timeline,this._repeat){if(s=d+this._rDelay,this._repeat<-1&&p)return this.totalTime(100*s+t,e,r);if(i=la(_%s),_===c?(a=this._repeat,i=d):(a=~~(o=la(_/s)))&&a===o?(i=d,a--):d<i&&(i=d),(u=this._yoyo&&1&a)&&(i=d-i),o=wt(this._tTime,s),i===f&&!r&&this._initted&&a===o)return this._tTime=_,this;a!==o&&this.vars.repeatRefresh&&!u&&!this._lock&&i!==s&&this._initted&&(this._lock=r=1,this.render(la(s*a),!0).invalidate()._lock=0)}if(!this._initted){if(Pa(this,p?t:i,r,e,_))return this._tTime=0,this;if(!(f===this._time||r&&this.vars.repeatRefresh&&a!==o))return this;if(d!==this._dur)return this.render(t,e,r)}if(this._rEase){var m=i<f;if(m!==this._inv){var g=m?f:d-f;this._inv=m,this._from&&(this.ratio=1-this.ratio),this._invRatio=this.ratio,this._invTime=f,this._invRecip=g?(m?-1:1)/g:0,this._invScale=m?-this.ratio:1-this.ratio,this._invEase=m?this._rEase:this._ease}this.ratio=h=this._invRatio+this._invScale*this._invEase((i-this._invTime)*this._invRecip)}else this.ratio=h=this._ease(i/d);if(this._from&&(this.ratio=h=1-h),this._tTime=_,this._time=i,!this._act&&this._ts&&(this._act=1,this._lazy=0),!f&&_&&!e&&!o&&(At(this,"onStart"),this._tTime!==_))return this;for(n=this._pt;n;)n.r(h,n.d),n=n._next;l&&l.render(t<0?t:l._dur*l._ease(i/this._dur),e,r)||this._startAt&&(this._zTime=t),this._onUpdate&&!e&&(p&&Fa(this,t,0,r),At(this,"onUpdate")),this._repeat&&a!==o&&this.vars.onRepeat&&!e&&this.parent&&At(this,"onRepeat"),_!==this._tDur&&_||this._tTime!==_||(p&&!this._onUpdate&&Fa(this,t,0,!0),!t&&d||!(_===this._tDur&&0<this._ts||!_&&this._ts<0)||Ca(this,1),e||p&&!f||!(_||f||u)||(At(this,_===c?"onComplete":"onReverseComplete",!0),!this._prom||_<c&&0<this.timeScale()||this._prom()))}}else!function _renderZeroDurationTween(t,e,r,i){var n,a,s,o=t.ratio,u=e<0||!e&&(!t._start&&function _parentPlayheadIsBeforeStart(t){var e=t.parent;return e&&e._ts&&e._initted&&!e._lock&&(e.rawTime()<0||_parentPlayheadIsBeforeStart(e))}(t)&&(t._initted||!xt(t))||(t._ts<0||t._dp._ts<0)&&!xt(t))?0:1,h=t._rDelay,l=0;if(h&&t._repeat&&(l=Mt(0,t._tDur,e),a=wt(l,h),t._yoyo&&1&a&&(u=1-u),a!==wt(t._tTime,h)&&(o=1-u,t.vars.repeatRefresh&&t._initted&&t.invalidate())),u!==o||I||i||t._zTime===q||!e&&t._zTime){if(!t._initted&&Pa(t,e,i,r,l))return;for(s=t._zTime,t._zTime=e||(r?q:0),r=r||e&&!s,t.ratio=u,t._from&&(u=1-u),t._time=0,t._tTime=l,n=t._pt;n;)n.r(u,n.d),n=n._next;e<0&&Fa(t,e,0,!0),t._onUpdate&&!r&&At(t,"onUpdate"),l&&t._repeat&&!r&&t.parent&&At(t,"onRepeat"),(e>=t._tDur||e<0)&&t.ratio===u&&(u&&Ca(t,1),r||I||(At(t,u?"onComplete":"onReverseComplete",!0),t._prom&&t._prom()))}else t._zTime||(t._zTime=e)}(this,t,e,r);return this},e.targets=function targets(){return this._targets},e.invalidate=function invalidate(t){return t&&this.vars.runBackwards||(this._startAt=0),this._pt=this._op=this._onUpdate=this._lazy=this.ratio=0,this._ptLookup=[],this.timeline&&this.timeline.invalidate(t),E.prototype.invalidate.call(this,t)},e.resetTo=function resetTo(t,e,r,i,n){d||It.wake(),this._ts||this.play();var a,s=Math.min(this._dur,(this._dp._time-this._start)*this._ts);return this._initted||Ht(this,s),a=this._ease(s/this._dur),function _updatePropTweens(t,e,r,i,n,a,s,o){var u,h,l,f,c=(t._pt&&t._ptCache||(t._ptCache={}))[e];if(!c)for(c=t._ptCache[e]=[],l=t._ptLookup,f=t._targets.length;f--;){if((u=l[f][e])&&u.d&&u.d._pt)for(u=u.d._pt;u&&u.p!==e&&u.fp!==e;)u=u._next;if(!u)return Wt=1,t.vars[e]="+=0",Ht(t,s),Wt=0,o?T(e+" not eligible for reset. Try splitting into individual properties"):1;c.push(u)}for(f=c.length;f--;)(u=(h=c[f])._pt||h).s=!i&&0!==i||n?u.s+(i||0)+a*u.c:i,u.c=r-u.s,h.e&&(h.e=ka(r)+_a(h.e)),h.b&&(h.b=u.s+_a(h.b))}(this,t,e,r,i,a,s,n)?this.resetTo(t,e,r,i,1):(La(this,0),this.parent||Aa(this._dp,this,"_first","_last",this._dp._sort?"_start":0),this.render(0))},e.kill=function kill(t,e){if(void 0===e&&(e="all"),!(t||e&&"all"!==e))return this._lazy=this._pt=0,this.parent?wb(this):this.scrollTrigger&&this.scrollTrigger.kill(!!I),this;if(this.timeline){var i=this.timeline.totalDuration();return this.timeline.killTweensOf(t,e,Zt&&!0!==Zt.vars.overwrite)._first||wb(this),this.parent&&i!==this.timeline.totalDuration()&&Ua(this,this._dur*this.timeline._tDur/i,0,1),this}var n,a,s,o,u,h,l,f=this._targets,c=t?Pt(t):f,d=this._ptLookup,p=this._pt;if((!e||"all"===e)&&function _arraysMatch(t,e){for(var r=t.length,i=r===e.length;i&&r--&&t[r]===e[r];);return r<0}(f,c))return"all"===e&&(this._pt=0),wb(this);for(n=this._op=this._op||[],"all"!==e&&(r(e)&&(u={},ja(e,function(t){return u[t]=1}),e=u),e=function _addAliasesToVars(t,e){var r,i,n,a,s=t[0]?ha(t[0]).harness:0,o=s&&s.aliases;if(!o)return e;for(i in r=bt({},e),o)if(i in r)for(n=(a=o[i].split(",")).length;n--;)r[a[n]]=r[i];return r}(f,e)),l=f.length;l--;)if(~c.indexOf(f[l]))for(u in a=d[l],"all"===e?(n[l]=e,o=a,s={}):(s=n[l]=n[l]||{},o=e),o)(h=a&&a[u])&&("kill"in h.d&&!0!==h.d.kill(u)||Ba(this,h,"_pt"),delete a[u]),"all"!==s&&(s[u]=1);return this._initted&&!this._pt&&p&&wb(this),this},Tween.to=function to(t,e,r){return new Tween(t,e,r)},Tween.from=function from(t,e){return Ya(1,arguments)},Tween.delayedCall=function delayedCall(t,e,r,i){return new Tween(e,0,{immediateRender:!1,lazy:!1,overwrite:!1,delay:t,onComplete:e,onReverseComplete:e,onCompleteParams:r,onReverseCompleteParams:r,callbackScope:i})},Tween.fromTo=function fromTo(t,e,r){return Ya(2,arguments)},Tween.set=function set(t,e){return e.duration=0,e.repeatDelay||(e.repeat=0),new Tween(t,e)},Tween.killTweensOf=function killTweensOf(t,e,r){return L.killTweensOf(t,e,r)},Tween}(qt);ta(te.prototype,{_targets:[],_lazy:0,_startAt:0,_op:0,_onInit:0}),ja("staggerTo,staggerFrom,staggerFromTo",function(r){te[r]=function(){var t=new Gt,e=Ct.call(arguments,0);return e.splice("staggerFromTo"===r?5:4,0,0),t[r].apply(t,e)}});function qc(t,e,r){return t.setAttribute(e,r)}function yc(t,e,r,i){i.mSet(t,e,i.m.call(i.tween,r,i.mt),i)}var ie=function _setterPlain(t,e,r){return t[e]=r},ae=function _setterFunc(t,e,r){return t[e](r)},se=function _setterFuncWithParam(t,e,r,i){return t[e](i.fp,r)},ue=function _getSetter(t,e){return s(t[e])?ae:u(t[e])&&t.setAttribute?qc:ie},fe=function _renderPlain(t,e){return e.set(e.t,e.p,Math.round(1e6*(e.s+e.c*t))/1e6,e)},de=function _renderBoolean(t,e){return e.set(e.t,e.p,!!(e.s+e.c*t),e)},pe=function _renderComplexString(t,e){var r=e._pt,i="";if(!t&&e.b)i=e.b;else if(1===t&&e.e)i=e.e;else{for(;r;)i=r.p+(r.m?r.m(r.s+r.c*t):Math.round(1e4*(r.s+r.c*t))/1e4)+i,r=r._next;i+=e.c}e.set(e.t,e.p,i,e)},_e=function _renderPropTweens(t,e){for(var r=e._pt;r;)r.r(t,r.d),r=r._next},ve=function _addPluginModifier(t,e,r,i){for(var n,a=this._pt;a;)n=a._next,a.p===i&&a.modifier(t,e,r),a=n},Te=function _killPropTweensOf(t){for(var e,r,i=this._pt;i;)r=i._next,i.p===t&&!i.op||i.op===t?Ba(this,i,"_pt"):i.dep||(e=1),i=r;return!e},be=function _sortPropTweensByPriority(t){for(var e,r,i,n,a=t._pt;a;){for(e=a._next,r=i;r&&r.pr>a.pr;)r=r._next;(a._prev=r?r._prev:n)?a._prev._next=a:i=a,(a._next=r)?r._prev=a:n=a,a=e}t._pt=i},we=(PropTween.prototype.modifier=function modifier(t,e,r){this.mSet=this.mSet||this.set,this.set=yc,this.m=t,this.mt=r,this.tween=e},PropTween);function PropTween(t,e,r,i,n,a,s,o,u){this.t=e,this.s=i,this.c=n,this.p=r,this.r=a||fe,this.d=s||this,this.set=o||ie,this.pr=u||0,(this._next=t)&&(t._prev=this)}ja(Tt+"parent,duration,ease,delay,overwrite,runBackwards,startAt,yoyo,immediateRender,repeat,repeatDelay,data,paused,reversed,lazy,callbackScope,stringFilter,id,yoyoEase,stagger,inherit,repeatRefresh,keyframes,autoRevert,scrollTrigger,easeReverse",function(t){return dt[t]=1}),ht.TweenMax=ht.TweenLite=te,ht.TimelineLite=ht.TimelineMax=Gt,L=new Gt({sortChildren:!1,defaults:j,autoRemoveChildren:!0,id:"root",smoothChildTiming:!0}),Y.stringFilter=Ib;function Gc(t){return(Oe[t]||Me).map(function(t){return t()})}function Hc(){var t=Date.now(),o=[];2<t-Ce&&(Gc("matchMediaInit"),ke.forEach(function(t){var e,r,i,n,a=t.queries,s=t.conditions;for(r in a)(e=h.matchMedia(a[r]).matches)&&(i=1),e!==s[r]&&(s[r]=e,n=1);n&&(t.revert(),i&&o.push(t))}),Gc("matchMediaRevert"),o.forEach(function(e){return e.onMatch(e,function(t){return e.add(null,t)})}),Ce=t,Gc("matchMedia"))}var xe,ke=[],Oe={},Me=[],Ce=0,Pe=0,Se=((xe=Context.prototype).add=function add(t,i,n){function Gw(){var t,e=l,r=a.selector;return e&&e!==a&&e.data.push(a),n&&(a.selector=fb(n)),l=a,t=i.apply(a,arguments),s(t)&&a._r.push(t),l=e,a.selector=r,a.isReverted=!1,t}s(t)&&(n=i,i=t,t=s);var a=this;return a.last=Gw,t===s?Gw(a,function(t){return a.add(null,t)}):t?a[t]=Gw:Gw},xe.ignore=function ignore(t){var e=l;l=null,t(this),l=e},xe.getTweens=function getTweens(){var e=[];return this.data.forEach(function(t){return t instanceof Context?e.push.apply(e,t.getTweens()):t instanceof te&&!(t.parent&&"nested"===t.parent.data)&&e.push(t)}),e},xe.clear=function clear(){this._r.length=this.data.length=0},xe.kill=function kill(i,t){var n=this;if(i?function(){for(var t,e=n.getTweens(),r=n.data.length;r--;)"isFlip"===(t=n.data[r]).data&&(t.revert(),t.getChildren(!0,!0,!1).forEach(function(t){return e.splice(e.indexOf(t),1)}));for(e.map(function(t){return{g:t._dur||t._delay||t._sat&&!t._sat.vars.immediateRender?t.globalTime(0):-1/0,t:t}}).sort(function(t,e){return e.g-t.g||-1/0}).forEach(function(t){return t.t.revert(i)}),r=n.data.length;r--;)(t=n.data[r])instanceof Gt?"nested"!==t.data&&(t.scrollTrigger&&t.scrollTrigger.revert(),t.kill()):t instanceof te||!t.revert||t.revert(i);n._r.forEach(function(t){return t(i,n)}),n.isReverted=!0}():this.data.forEach(function(t){return t.kill&&t.kill()}),this.clear(),t)for(var e=ke.length;e--;)ke[e].id===this.id&&ke.splice(e,1)},xe.revert=function revert(t){this.kill(t||{})},Context);function Context(t,e){this.selector=e&&fb(e),this.data=[],this._r=[],this.isReverted=!1,this.id=Pe++,t&&this.add(t)}var De,Re=((De=MatchMedia.prototype).add=function add(t,e,r){v(t)||(t={matches:t});var i,n,a,s=new Se(0,r||this.scope),o=s.conditions={};for(n in l&&!s.selector&&(s.selector=l.selector),this.contexts.push(s),e=s.add("onMatch",e),s.queries=t)"all"===n?a=1:(i=h.matchMedia(t[n]))&&(ke.indexOf(s)<0&&ke.push(s),(o[n]=i.matches)&&(a=1),i.addListener?i.addListener(Hc):i.addEventListener("change",Hc));return a&&e(s,function(t){return s.add(null,t)}),this},De.revert=function revert(t){this.kill(t||{})},De.kill=function kill(e){this.contexts.forEach(function(t){return t.kill(e,!0)})},MatchMedia);function MatchMedia(t){this.contexts=[],this.scope=t,l&&l.data.push(this)}var Ee={registerPlugin:function registerPlugin(){for(var t=arguments.length,e=new Array(t),r=0;r<t;r++)e[r]=arguments[r];e.forEach(function(t){return zb(t)})},timeline:function timeline(t){return new Gt(t)},getTweensOf:function getTweensOf(t,e){return L.getTweensOf(t,e)},getProperty:function getProperty(i,t,e,n){r(i)&&(i=Pt(i)[0]);var a=ha(i||{}).get,s=e?sa:ra;return"native"===e&&(e=""),i?t?s((mt[t]&&mt[t].get||a)(i,t,e,n)):function(t,e,r){return s((mt[t]&&mt[t].get||a)(i,t,e,r))}:i},quickSetter:function quickSetter(r,e,i){if(1<(r=Pt(r)).length){var n=r.map(function(t){return Fe.quickSetter(t,e,i)}),a=n.length;return function(t){for(var e=a;e--;)n[e](t)}}r=r[0]||{};var s=mt[e],o=ha(r),u=o.harness&&(o.harness.aliases||{})[e]||e,h=s?function(t){var e=new s;c._pt=0,e.init(r,i?t+i:t,c,0,[r]),e.render(1,e),c._pt&&_e(1,c)}:o.set(r,u);return s?h:function(t){return h(r,u,i?t+i:t,o,1)}},quickTo:function quickTo(t,i,e){function $x(t,e,r){return n.resetTo(i,t,e,r)}var r,n=Fe.to(t,ta(((r={})[i]="+=0.1",r.paused=!0,r.stagger=0,r),e||{}));return $x.tween=n,$x},isTweening:function isTweening(t){return 0<L.getTweensOf(t,!0).length},defaults:function defaults(t){return t&&t.ease&&(t.ease=jt(t.ease,j.ease)),wa(j,t||{})},config:function config(t){return wa(Y,t||{})},registerEffect:function registerEffect(t){var i=t.name,n=t.effect,e=t.plugins,a=t.defaults,r=t.extendTimeline;(e||"").split(",").forEach(function(t){return t&&!mt[t]&&!ht[t]&&T(i+" effect requires "+t+" plugin.")}),gt[i]=function(t,e,r){return n(Pt(t),ta(e||{},a),r)},r&&(Gt.prototype[i]=function(t,e,r){return this.add(gt[i](t,v(e)?e:(r=e)&&{},this),r)})},registerEase:function registerEase(t,e){Bt[t]=jt(e)},parseEase:function parseEase(t,e){return arguments.length?jt(t,e):Bt},getById:function getById(t){return L.getById(t)},exportRoot:function exportRoot(t,e){void 0===t&&(t={});var r,i,n=new Gt(t);for(n.smoothChildTiming=w(t.smoothChildTiming),L.remove(n),n._dp=0,n._time=n._tTime=L._time,r=L._first;r;)i=r._next,!e&&!r._dur&&r instanceof te&&r.vars.onComplete===r._targets[0]||Na(n,r,r._start-r._delay),r=i;return Na(L,n,0),n},context:function context(t,e){return t?new Se(t,e):l},matchMedia:function matchMedia(t){return new Re(t)},matchMediaRefresh:function matchMediaRefresh(){return ke.forEach(function(t){var e,r,i=t.conditions;for(r in i)i[r]&&(i[r]=!1,e=1);e&&t.revert()})||Hc()},addEventListener:function addEventListener(t,e){var r=Oe[t]||(Oe[t]=[]);~r.indexOf(e)||r.push(e)},removeEventListener:function removeEventListener(t,e){var r=Oe[t],i=r&&r.indexOf(e);0<=i&&r.splice(i,1)},utils:{wrap:function wrap(e,t,r){var i=t-e;return K(e)?ob(e,wrap(0,e.length),t):Za(r,function(t){return(i+(t-e)%i)%i+e})},wrapYoyo:function wrapYoyo(e,t,r){var i=t-e,n=2*i;return K(e)?ob(e,wrapYoyo(0,e.length-1),t):Za(r,function(t){return e+(i<(t=(n+(t-e)%n)%n||0)?n-t:t)})},distribute:hb,random:kb,snap:jb,normalize:function normalize(t,e,r){return St(t,e,0,1,r)},getUnit:_a,clamp:function clamp(e,r,t){return Za(t,function(t){return Mt(e,r,t)})},splitColor:Db,toArray:Pt,selector:fb,mapRange:St,pipe:function pipe(){for(var t=arguments.length,e=new Array(t),r=0;r<t;r++)e[r]=arguments[r];return function(t){return e.reduce(function(t,e){return e(t)},t)}},unitize:function unitize(e,r){return function(t){return e(parseFloat(t))+(r||_a(t))}},interpolate:function interpolate(e,i,t,n){var a=isNaN(e+i)?0:function(t){return(1-t)*e+t*i};if(!a){var s,o,u,h,l,f=r(e),c={};if(!0===t&&(n=1)&&(t=null),f)e={p:e},i={p:i};else if(K(e)&&!K(i)){for(u=[],h=e.length,l=h-2,o=1;o<h;o++)u.push(interpolate(e[o-1],e[o]));h--,a=function func(t){t*=h;var e=Math.min(l,~~t);return u[e](t-e)},t=i}else n||(e=bt(K(e)?[]:{},e));if(!u){for(s in i)$t.call(c,e,s,"get",i[s]);a=function func(t){return _e(t,c)||(f?e.p:e)}}}return Za(t,a)},shuffle:gb},install:R,effects:gt,ticker:It,updateRoot:Gt.updateRoot,plugins:mt,globalTimeline:L,core:{PropTween:we,globals:U,Tween:te,Timeline:Gt,Animation:qt,getCache:ha,_removeLinkedListItem:Ba,reverting:function reverting(){return I},context:function context(t){return t&&l&&(l.data.push(t),t._ctx=l),l},suppressOverwrites:function suppressOverwrites(t){return F=t}}};ja("to,from,fromTo,delayedCall,set,killTweensOf",function(t){return Ee[t]=te[t]}),It.add(Gt.updateRoot),c=Ee.to({},{duration:0});function Lc(t,e){for(var r=t._pt;r&&r.p!==e&&r.op!==e&&r.fp!==e;)r=r._next;return r}function Nc(t,a){return{name:t,headless:1,rawVars:1,init:function init(t,n,e){e._onInit=function(t){var e,i;if(r(n)&&(e={},ja(n,function(t){return e[t]=1}),n=e),a){for(i in e={},n)e[i]=a(n[i]);n=e}!function _addModifiers(t,e){var r,i,n,a=t._targets;for(r in e)for(i=a.length;i--;)(n=(n=t._ptLookup[i][r])&&n.d)&&(n._pt&&(n=Lc(n,r)),n&&n.modifier&&n.modifier(e[r],t,a[i],r))}(t,n)}}}}var Fe=Ee.registerPlugin({name:"attr",init:function init(t,e,r,i,n){var a,s,o;for(a in this.tween=r,e)o=t.getAttribute(a)||"",(s=this.add(t,"setAttribute",(o||0)+"",e[a],i,n,0,0,a)).op=a,s.b=o,this._props.push(a)},render:function render(t,e){for(var r=e._pt;r;)I?r.set(r.t,r.p,r.b,r):r.r(t,r.d),r=r._next}},{name:"endArray",headless:1,init:function init(t,e){for(var r=e.length;r--;)this.add(t,r,t[r]||0,e[r],0,0,0,0,0,1)}},Nc("roundProps",ib),Nc("modifiers"),Nc("snap",jb))||Ee;te.version=Gt.version=Fe.version="3.15.0",o=1,x()&&Lt();function xd(t,e){return e.set(e.t,e.p,Math.round(1e4*(e.s+e.c*t))/1e4+e.u,e)}function yd(t,e){return e.set(e.t,e.p,1===t?e.e:Math.round(1e4*(e.s+e.c*t))/1e4+e.u,e)}function zd(t,e){return e.set(e.t,e.p,t?Math.round(1e4*(e.s+e.c*t))/1e4+e.u:e.b,e)}function Ad(t,e){return e.set(e.t,e.p,1===t?e.e:t?Math.round(1e4*(e.s+e.c*t))/1e4+e.u:e.b,e)}function Bd(t,e){var r=e.s+e.c*t;e.set(e.t,e.p,~~(r+(r<0?-.5:.5))+e.u,e)}function Cd(t,e){return e.set(e.t,e.p,t?e.e:e.b,e)}function Dd(t,e){return e.set(e.t,e.p,1!==t?e.b:e.e,e)}function Ed(t,e,r){return t.style[e]=r}function Fd(t,e,r){return t.style.setProperty(e,r)}function Gd(t,e,r){return t._gsap[e]=r}function Hd(t,e,r){return t._gsap.scaleX=t._gsap.scaleY=r}function Id(t,e,r,i,n){var a=t._gsap;a.scaleX=a.scaleY=r,a.renderTransform(n,a)}function Jd(t,e,r,i,n){var a=t._gsap;a[e]=r,a.renderTransform(n,a)}function Md(t,e){var r=this,i=this.target,n=i.style,a=i._gsap;if(t in ur&&n){if(this.tfm=this.tfm||{},"transform"===t)return _r.transform.split(",").forEach(function(t){return Md.call(r,t,e)});if(~(t=_r[t]||t).indexOf(",")?t.split(",").forEach(function(t){return r.tfm[t]=wr(i,t)}):this.tfm[t]=a.x?a[t]:wr(i,t),t===gr&&(this.tfm.zOrigin=a.zOrigin),0<=this.props.indexOf(mr))return;a.svg&&(this.svgo=i.getAttribute("data-svg-origin"),this.props.push(gr,e,"")),t=mr}(n||e)&&this.props.push(t,e,n[t])}function Nd(t){t.translate&&(t.removeProperty("translate"),t.removeProperty("scale"),t.removeProperty("rotate"))}function Od(){var t,e,r=this.props,i=this.target,n=i.style,a=i._gsap;for(t=0;t<r.length;t+=3)r[t+1]?2===r[t+1]?i[r[t]](r[t+2]):i[r[t]]=r[t+2]:r[t+2]?n[r[t]]=r[t+2]:n.removeProperty("--"===r[t].substr(0,2)?r[t]:r[t].replace(cr,"-$1").toLowerCase());if(this.tfm){for(e in this.tfm)a[e]=this.tfm[e];a.svg&&(a.renderTransform(),i.setAttribute("data-svg-origin",this.svgo||"")),(t=je())&&t.isStart||n[mr]||(Nd(n),a.zOrigin&&n[gr]&&(n[gr]+=" "+a.zOrigin+"px",a.zOrigin=0,a.renderTransform()),a.uncache=1)}}function Pd(t,e){var r={target:t,props:[],revert:Od,save:Md};return t._gsap||Fe.core.getCache(t),e&&t.style&&t.nodeType&&e.split(",").forEach(function(t){return r.save(t)}),r}function Rd(t,e){var r=Le.createElementNS?Le.createElementNS((e||"http://www.w3.org/1999/xhtml").replace(/^https/,"http"),t):Le.createElement(t);return r&&r.style?r:Le.createElement(t)}function Sd(t,e,r){var i=getComputedStyle(t);return i[e]||i.getPropertyValue(e.replace(cr,"-$1").toLowerCase())||i.getPropertyValue(e)||!r&&Sd(t,yr(e)||e,1)||""}function Vd(){(function _windowExists(){return"undefined"!=typeof window})()&&window.document&&(Ie=window,Le=Ie.document,Be=Le.documentElement,Ue=Rd("div")||{style:{}},Rd("div"),mr=yr(mr),gr=mr+"Origin",Ue.style.cssText="border-width:0;line-height:0;position:absolute;padding:0",Ve=!!yr("perspective"),je=Fe.core.reverting,Ne=1)}function Wd(t){var e,r=t.ownerSVGElement,i=Rd("svg",r&&r.getAttribute("xmlns")||"http://www.w3.org/2000/svg"),n=t.cloneNode(!0);n.style.display="block",i.appendChild(n),Be.appendChild(i);try{e=n.getBBox()}catch(t){}return i.removeChild(n),Be.removeChild(i),e}function Xd(t,e){for(var r=e.length;r--;)if(t.hasAttribute(e[r]))return t.getAttribute(e[r])}function Yd(e){var r,i;try{r=e.getBBox()}catch(t){r=Wd(e),i=1}return r&&(r.width||r.height)||i||(r=Wd(e)),!r||r.width||r.x||r.y?r:{x:+Xd(e,["x","cx","x1"])||0,y:+Xd(e,["y","cy","y1"])||0,width:0,height:0}}function Zd(t){return!(!t.getCTM||t.parentNode&&!t.ownerSVGElement||!Yd(t))}function $d(t,e){if(e){var r,i=t.style;e in ur&&e!==gr&&(e=mr),i.removeProperty?("ms"!==(r=e.substr(0,2))&&"webkit"!==e.substr(0,6)||(e="-"+e),i.removeProperty("--"===r?e:e.replace(cr,"-$1").toLowerCase())):i.removeAttribute(e)}}function _d(t,e,r,i,n,a){var s=new we(t._pt,e,r,0,1,a?Dd:Cd);return(t._pt=s).b=i,s.e=n,t._props.push(r),s}function ce(t,e,r,i){var n,a,s,o,u=parseFloat(r)||0,h=(r+"").trim().substr((u+"").length)||"px",l=Ue.style,f=dr.test(e),c="svg"===t.tagName.toLowerCase(),d=(c?"client":"offset")+(f?"Width":"Height"),p="px"===i,_="%"===i;if(i===h||!u||Tr[i]||Tr[h])return u;if("px"===h||p||(u=ce(t,e,r,"px")),o=t.getCTM&&Zd(t),(_||"%"===h)&&(ur[e]||~e.indexOf("adius")))return n=o?t.getBBox()[f?"width":"height"]:t[d],ka(_?u/n*100:u/100*n);if(l[f?"width":"height"]=100+(p?h:i),a="rem"!==i&&~e.indexOf("adius")||"em"===i&&t.appendChild&&!c?t:t.parentNode,o&&(a=(t.ownerSVGElement||{}).parentNode),a&&a!==Le&&a.appendChild||(a=Le.body),(s=a._gsap)&&_&&s.width&&f&&s.time===It.time&&!s.uncache)return ka(u/s.width*100);if(!_||"height"!==e&&"width"!==e)!_&&"%"!==h||br[Sd(a,"display")]||(l.position=Sd(t,"position")),a===t&&(l.position="static"),a.appendChild(Ue),n=Ue[d],a.removeChild(Ue),l.position="absolute";else{var m=t.style[e];t.style[e]=100+i,n=t[d],m?t.style[e]=m:$d(t,e)}return f&&_&&((s=ha(a)).time=It.time,s.width=a[d]),ka(p?n*u/100:n&&u?100/n*u:0)}function ee(t,e,r,i){if(!r||"none"===r){var n=yr(e,t,1),a=n&&Sd(t,n,1);a&&a!==r?(e=n,r=a):"borderColor"===e&&(r=Sd(t,"borderTopColor"))}var s,o,u,h,l,f,c,d,p,_,m,g=new we(this._pt,t.style,e,0,1,pe),v=0,y=0;if(g.b=r,g.e=i,r+="","var(--"===(i+="").substring(0,6)&&(i=Sd(t,i.substring(4,i.indexOf(")")))),"auto"===i&&(f=t.style[e],t.style[e]=i,i=Sd(t,e)||i,f?t.style[e]=f:$d(t,e)),Ib(s=[r,i]),i=s[1],u=(r=s[0]).match(nt)||[],(i.match(nt)||[]).length){for(;o=nt.exec(i);)c=o[0],p=i.substring(v,o.index),l?l=(l+1)%5:"rgba("!==p.substr(-5)&&"hsla("!==p.substr(-5)||(l=1),c!==(f=u[y++]||"")&&(h=parseFloat(f)||0,m=f.substr((h+"").length),"="===c.charAt(1)&&(c=ma(h,c)+m),d=parseFloat(c),_=c.substr((d+"").length),v=nt.lastIndex-_.length,_||(_=_||Y.units[e]||m,v===i.length&&(i+=_,g.e+=_)),m!==_&&(h=ce(t,e,f,_)||0),g._pt={_next:g._pt,p:p||1===y?p:",",s:h,c:d-h,m:l&&l<4||"zIndex"===e?Math.round:0});g.c=v<i.length?i.substring(v,i.length):""}else g.r="display"===e&&"none"===i?Dd:Cd;return st.test(i)&&(g.e=0),this._pt=g}function ge(t){var e=t.split(" "),r=e[0],i=e[1]||"50%";return"top"!==r&&"bottom"!==r&&"left"!==i&&"right"!==i||(t=r,r=i,i=t),e[0]=xr[r]||r,e[1]=xr[i]||i,e.join(" ")}function he(t,e){if(e.tween&&e.tween._time===e.tween._dur){var r,i,n,a=e.t,s=a.style,o=e.u,u=a._gsap;if("all"===o||!0===o)s.cssText="",i=1;else for(n=(o=o.split(",")).length;-1<--n;)r=o[n],ur[r]&&(i=1,r="transformOrigin"===r?gr:mr),$d(a,r);i&&($d(a,mr),u&&(u.svg&&a.removeAttribute("transform"),s.scale=s.rotate=s.translate="none",Cr(a,1),u.uncache=1,Nd(s)))}}function le(t){return"matrix(1, 0, 0, 1, 0, 0)"===t||"none"===t||!t}function me(t){var e=Sd(t,mr);return le(e)?Or:e.substr(7).match(it).map(ka)}function ne(t,e){var r,i,n,a,s=t._gsap||ha(t),o=t.style,u=me(t);return s.svg&&t.getAttribute("transform")?"1,0,0,1,0,0"===(u=[(n=t.transform.baseVal.consolidate().matrix).a,n.b,n.c,n.d,n.e,n.f]).join(",")?Or:u:(u!==Or||t.offsetParent||t===Be||s.svg||(n=o.display,o.display="block",(r=t.parentNode)&&(t.offsetParent||t.getBoundingClientRect().width)||(a=1,i=t.nextElementSibling,Be.appendChild(t)),u=me(t),n?o.display=n:$d(t,"display"),a&&(i?r.insertBefore(t,i):r?r.appendChild(t):Be.removeChild(t))),e&&6<u.length?[u[0],u[1],u[4],u[5],u[12],u[13]]:u)}function oe(t,e,r,i,n,a){var s,o,u,h=t._gsap,l=n||ne(t,!0),f=h.xOrigin||0,c=h.yOrigin||0,d=h.xOffset||0,p=h.yOffset||0,_=l[0],m=l[1],g=l[2],v=l[3],y=l[4],T=l[5],b=e.split(" "),w=parseFloat(b[0])||0,x=parseFloat(b[1])||0;r?l!==Or&&(o=_*v-m*g)&&(u=w*(-m/o)+x*(_/o)-(_*T-m*y)/o,w=w*(v/o)+x*(-g/o)+(g*T-v*y)/o,x=u):(w=(s=Yd(t)).x+(~b[0].indexOf("%")?w/100*s.width:w),x=s.y+(~(b[1]||b[0]).indexOf("%")?x/100*s.height:x)),i||!1!==i&&h.smooth?(y=w-f,T=x-c,h.xOffset=d+(y*_+T*g)-y,h.yOffset=p+(y*m+T*v)-T):h.xOffset=h.yOffset=0,h.xOrigin=w,h.yOrigin=x,h.smooth=!!i,h.origin=e,h.originIsAbsolute=!!r,t.style[gr]="0px 0px",a&&(_d(a,h,"xOrigin",f,w),_d(a,h,"yOrigin",c,x),_d(a,h,"xOffset",d,h.xOffset),_d(a,h,"yOffset",p,h.yOffset)),t.setAttribute("data-svg-origin",w+" "+x)}function re(t,e,r){var i=_a(e);return ka(parseFloat(e)+parseFloat(ce(t,"x",r+"px",i)))+i}function ye(t,e,i,n,a){var s,o,u=360,h=r(a),l=parseFloat(a)*(h&&~a.indexOf("rad")?hr:1)-n,f=n+l+"deg";return h&&("short"===(s=a.split("_")[1])&&(l%=u)!==l%180&&(l+=l<0?u:-u),"cw"===s&&l<0?l=(l+36e9)%u-~~(l/u)*u:"ccw"===s&&0<l&&(l=(l-36e9)%u-~~(l/u)*u)),t._pt=o=new we(t._pt,e,i,n,l,yd),o.e=f,o.u="deg",t._props.push(i),o}function ze(t,e){for(var r in e)t[r]=e[r];return t}function Ae(t,e,r){var i,n,a,s,o,u,h,l=ze({},r._gsap),f=r.style;for(n in l.svg?(a=r.getAttribute("transform"),r.setAttribute("transform",""),f[mr]=e,i=Cr(r,1),$d(r,mr),r.setAttribute("transform",a)):(a=getComputedStyle(r)[mr],f[mr]=e,i=Cr(r,1),f[mr]=a),ur)(a=l[n])!==(s=i[n])&&"perspective,force3D,transformOrigin,svgOrigin".indexOf(n)<0&&(o=_a(a)!==(h=_a(s))?ce(r,n,a,h):parseFloat(a),u=parseFloat(s),t._pt=new we(t._pt,i,n,o,u-o,xd),t._pt.u=h||0,t._props.push(n));ze(i,l)}var Ie,Le,Be,Ne,Ue,Ye,je,Ve,Xe=Bt.Power0,qe=Bt.Power1,Ge=Bt.Power2,Ze=Bt.Power3,We=Bt.Power4,$e=Bt.Linear,He=Bt.Quad,Qe=Bt.Cubic,Je=Bt.Quart,Ke=Bt.Quint,tr=Bt.Strong,er=Bt.Elastic,rr=Bt.Back,ir=Bt.SteppedEase,nr=Bt.Bounce,ar=Bt.Sine,sr=Bt.Expo,or=Bt.Circ,ur={},hr=180/Math.PI,lr=Math.PI/180,fr=Math.atan2,cr=/([A-Z])/g,dr=/(left|right|width|margin|padding|x)/i,pr=/[\s,\(]\S/,_r={autoAlpha:"opacity,visibility",scale:"scaleX,scaleY",alpha:"opacity"},mr="transform",gr=mr+"Origin",vr="O,Moz,ms,Ms,Webkit".split(","),yr=function _checkPropPrefix(t,e,r){var i=(e||Ue).style,n=5;if(t in i&&!r)return t;for(t=t.charAt(0).toUpperCase()+t.substr(1);n--&&!(vr[n]+t in i););return n<0?null:(3===n?"ms":0<=n?vr[n]:"")+t},Tr={deg:1,rad:1,turn:1},br={grid:1,flex:1},wr=function _get(t,e,r,i){var n;return Ne||Vd(),e in _r&&"transform"!==e&&~(e=_r[e]).indexOf(",")&&(e=e.split(",")[0]),ur[e]&&"transform"!==e?(n=Cr(t,i),n="transformOrigin"!==e?n[e]:n.svg?n.origin:Pr(Sd(t,gr))+" "+n.zOrigin+"px"):(n=t.style[e])&&"auto"!==n&&!i&&!~(n+"").indexOf("calc(")||(n=kr[e]&&kr[e](t,e,r)||Sd(t,e)||ia(t,e)||("opacity"===e?1:0)),r&&!~(n+"").trim().indexOf(" ")?ce(t,e,n,r)+r:n},xr={top:"0%",bottom:"100%",left:"0%",right:"100%",center:"50%"},kr={clearProps:function clearProps(t,e,r,i,n){if("isFromStart"!==n.data){var a=t._pt=new we(t._pt,e,r,0,0,he);return a.u=i,a.pr=-10,a.tween=n,t._props.push(r),1}}},Or=[1,0,0,1,0,0],Mr={},Cr=function _parseTransform(t,e){var r=t._gsap||new Xt(t);if("x"in r&&!e&&!r.uncache)return r;var i,n,a,s,o,u,h,l,f,c,d,p,_,m,g,v,y,T,b,w,x,k,O,M,C,P,S,A,D,z,R,E,F=t.style,I=r.scaleX<0,L="deg",B=getComputedStyle(t),N=Sd(t,gr)||"0";return i=n=a=u=h=l=f=c=d=0,s=o=1,r.svg=!(!t.getCTM||!Zd(t)),B.translate&&("none"===B.translate&&"none"===B.scale&&"none"===B.rotate||(F[mr]=("none"!==B.translate?"translate3d("+(B.translate+" 0 0").split(" ").slice(0,3).join(", ")+") ":"")+("none"!==B.rotate?"rotate("+B.rotate+") ":"")+("none"!==B.scale?"scale("+B.scale.split(" ").join(",")+") ":"")+("none"!==B[mr]?B[mr]:"")),F.scale=F.rotate=F.translate="none"),m=ne(t,r.svg),r.svg&&(M=r.uncache?(C=t.getBBox(),N=r.xOrigin-C.x+"px "+(r.yOrigin-C.y)+"px",""):!e&&t.getAttribute("data-svg-origin"),oe(t,M||N,!!M||r.originIsAbsolute,!1!==r.smooth,m)),p=r.xOrigin||0,_=r.yOrigin||0,m!==Or&&(T=m[0],b=m[1],w=m[2],x=m[3],i=k=m[4],n=O=m[5],6===m.length?(s=Math.sqrt(T*T+b*b),o=Math.sqrt(x*x+w*w),u=T||b?fr(b,T)*hr:0,(f=w||x?fr(w,x)*hr+u:0)&&(o*=Math.abs(Math.cos(f*lr))),r.svg&&(i-=p-(p*T+_*w),n-=_-(p*b+_*x))):(E=m[6],z=m[7],S=m[8],A=m[9],D=m[10],R=m[11],i=m[12],n=m[13],a=m[14],h=(g=fr(E,D))*hr,g&&(M=k*(v=Math.cos(-g))+S*(y=Math.sin(-g)),C=O*v+A*y,P=E*v+D*y,S=k*-y+S*v,A=O*-y+A*v,D=E*-y+D*v,R=z*-y+R*v,k=M,O=C,E=P),l=(g=fr(-w,D))*hr,g&&(v=Math.cos(-g),R=x*(y=Math.sin(-g))+R*v,T=M=T*v-S*y,b=C=b*v-A*y,w=P=w*v-D*y),u=(g=fr(b,T))*hr,g&&(M=T*(v=Math.cos(g))+b*(y=Math.sin(g)),C=k*v+O*y,b=b*v-T*y,O=O*v-k*y,T=M,k=C),h&&359.9<Math.abs(h)+Math.abs(u)&&(h=u=0,l=180-l),s=ka(Math.sqrt(T*T+b*b+w*w)),o=ka(Math.sqrt(O*O+E*E)),g=fr(k,O),f=2e-4<Math.abs(g)?g*hr:0,d=R?1/(R<0?-R:R):0),r.svg&&(M=t.getAttribute("transform"),r.forceCSS=t.setAttribute("transform","")||!le(Sd(t,mr)),M&&t.setAttribute("transform",M))),90<Math.abs(f)&&Math.abs(f)<270&&(I?(s*=-1,f+=u<=0?180:-180,u+=u<=0?180:-180):(o*=-1,f+=f<=0?180:-180)),e=e||r.uncache,r.x=i-((r.xPercent=i&&(!e&&r.xPercent||(Math.round(t.offsetWidth/2)===Math.round(-i)?-50:0)))?t.offsetWidth*r.xPercent/100:0)+"px",r.y=n-((r.yPercent=n&&(!e&&r.yPercent||(Math.round(t.offsetHeight/2)===Math.round(-n)?-50:0)))?t.offsetHeight*r.yPercent/100:0)+"px",r.z=a+"px",r.scaleX=ka(s),r.scaleY=ka(o),r.rotation=ka(u)+L,r.rotationX=ka(h)+L,r.rotationY=ka(l)+L,r.skewX=f+L,r.skewY=c+L,r.transformPerspective=d+"px",(r.zOrigin=parseFloat(N.split(" ")[2])||!e&&r.zOrigin||0)&&(F[gr]=Pr(N)),r.xOffset=r.yOffset=0,r.force3D=Y.force3D,r.renderTransform=r.svg?Er:Ve?Rr:Sr,r.uncache=0,r},Pr=function _firstTwoOnly(t){return(t=t.split(" "))[0]+" "+t[1]},Sr=function _renderNon3DTransforms(t,e){e.z="0px",e.rotationY=e.rotationX="0deg",e.force3D=0,Rr(t,e)},Ar="0deg",Dr="0px",zr=") ",Rr=function _renderCSSTransforms(t,e){var r=e||this,i=r.xPercent,n=r.yPercent,a=r.x,s=r.y,o=r.z,u=r.rotation,h=r.rotationY,l=r.rotationX,f=r.skewX,c=r.skewY,d=r.scaleX,p=r.scaleY,_=r.transformPerspective,m=r.force3D,g=r.target,v=r.zOrigin,y="",T="auto"===m&&t&&1!==t||!0===m;if(v&&(l!==Ar||h!==Ar)){var b,w=parseFloat(h)*lr,x=Math.sin(w),k=Math.cos(w);w=parseFloat(l)*lr,b=Math.cos(w),a=re(g,a,x*b*-v),s=re(g,s,-Math.sin(w)*-v),o=re(g,o,k*b*-v+v)}_!==Dr&&(y+="perspective("+_+zr),(i||n)&&(y+="translate("+i+"%, "+n+"%) "),!T&&a===Dr&&s===Dr&&o===Dr||(y+=o!==Dr||T?"translate3d("+a+", "+s+", "+o+") ":"translate("+a+", "+s+zr),u!==Ar&&(y+="rotate("+u+zr),h!==Ar&&(y+="rotateY("+h+zr),l!==Ar&&(y+="rotateX("+l+zr),f===Ar&&c===Ar||(y+="skew("+f+", "+c+zr),1===d&&1===p||(y+="scale("+d+", "+p+zr),g.style[mr]=y||"translate(0, 0)"},Er=function _renderSVGTransforms(t,e){var r,i,n,a,s,o=e||this,u=o.xPercent,h=o.yPercent,l=o.x,f=o.y,c=o.rotation,d=o.skewX,p=o.skewY,_=o.scaleX,m=o.scaleY,g=o.target,v=o.xOrigin,y=o.yOrigin,T=o.xOffset,b=o.yOffset,w=o.forceCSS,x=parseFloat(l),k=parseFloat(f);c=parseFloat(c),d=parseFloat(d),(p=parseFloat(p))&&(d+=p=parseFloat(p),c+=p),c||d?(c*=lr,d*=lr,r=Math.cos(c)*_,i=Math.sin(c)*_,n=Math.sin(c-d)*-m,a=Math.cos(c-d)*m,d&&(p*=lr,s=Math.tan(d-p),n*=s=Math.sqrt(1+s*s),a*=s,p&&(s=Math.tan(p),r*=s=Math.sqrt(1+s*s),i*=s)),r=ka(r),i=ka(i),n=ka(n),a=ka(a)):(r=_,a=m,i=n=0),(x&&!~(l+"").indexOf("px")||k&&!~(f+"").indexOf("px"))&&(x=ce(g,"x",l,"px"),k=ce(g,"y",f,"px")),(v||y||T||b)&&(x=ka(x+v-(v*r+y*n)+T),k=ka(k+y-(v*i+y*a)+b)),(u||h)&&(s=g.getBBox(),x=ka(x+u/100*s.width),k=ka(k+h/100*s.height)),s="matrix("+r+","+i+","+n+","+a+","+x+","+k+")",g.setAttribute("transform",s),w&&(g.style[mr]=s)};ja("padding,margin,Width,Radius",function(e,r){var t="Right",i="Bottom",n="Left",o=(r<3?["Top",t,i,n]:["Top"+n,"Top"+t,i+t,i+n]).map(function(t){return r<2?e+t:"border"+t+e});kr[1<r?"border"+e:e]=function(e,t,r,i,n){var a,s;if(arguments.length<4)return a=o.map(function(t){return wr(e,t,r)}),5===(s=a.join(" ")).split(a[0]).length?a[0]:s;a=(i+"").split(" "),s={},o.forEach(function(t,e){return s[t]=a[e]=a[e]||a[(e-1)/2|0]}),e.init(t,s,n)}});var Fr,Ir,Lr,Br={name:"css",register:Vd,targetTest:function targetTest(t){return t.style&&t.nodeType},init:function init(t,e,i,n,a){var s,o,u,h,l,f,c,d,p,_,m,g,v,y,T,b,w,x=this._props,k=t.style,O=i.vars.startAt;for(c in Ne||Vd(),this.styles=this.styles||Pd(t),b=this.styles.props,this.tween=i,e)if("autoRound"!==c&&(o=e[c],!mt[c]||!cc(c,e,i,n,t,a)))if(l=typeof o,f=kr[c],"function"===l&&(l=typeof(o=o.call(i,n,t,a))),"string"===l&&~o.indexOf("random(")&&(o=rb(o)),f)f(this,t,c,o,i)&&(T=1);else if("--"===c.substr(0,2))s=(getComputedStyle(t).getPropertyValue(c)+"").trim(),o+="",Et.lastIndex=0,Et.test(s)||(d=_a(s),(p=_a(o))?d!==p&&(s=ce(t,c,s,p)+p):d&&(o+=d)),this.add(k,"setProperty",s,o,n,a,0,0,c),x.push(c),b.push(c,0,k[c]);else if("undefined"!==l){if(O&&c in O?(s="function"==typeof O[c]?O[c].call(i,n,t,a):O[c],r(s)&&~s.indexOf("random(")&&(s=rb(s)),_a(s+"")||"auto"===s||(s+=Y.units[c]||_a(wr(t,c))||""),"="===(s+"").charAt(1)&&(s=wr(t,c))):s=wr(t,c),h=parseFloat(s),(_="string"===l&&"="===o.charAt(1)&&o.substr(0,2))&&(o=o.substr(2)),u=parseFloat(o),c in _r&&("autoAlpha"===c&&(1===h&&"hidden"===wr(t,"visibility")&&u&&(h=0),b.push("visibility",0,k.visibility),_d(this,k,"visibility",h?"inherit":"hidden",u?"inherit":"hidden",!u)),"scale"!==c&&"transform"!==c&&~(c=_r[c]).indexOf(",")&&(c=c.split(",")[0])),m=c in ur){if(this.styles.save(c),w=o,"string"===l&&"var(--"===o.substring(0,6)){if("calc("===(o=Sd(t,o.substring(4,o.indexOf(")")))).substring(0,5)){var M=t.style.perspective;t.style.perspective=o,o=Sd(t,"perspective"),M?t.style.perspective=M:$d(t,"perspective")}u=parseFloat(o)}if(g||((v=t._gsap).renderTransform&&!e.parseTransform||Cr(t,e.parseTransform),y=!1!==e.smoothOrigin&&v.smooth,(g=this._pt=new we(this._pt,k,mr,0,1,v.renderTransform,v,0,-1)).dep=1),"scale"===c)this._pt=new we(this._pt,v,"scaleY",v.scaleY,(_?ma(v.scaleY,_+u):u)-v.scaleY||0,xd),this._pt.u=0,x.push("scaleY",c),c+="X";else{if("transformOrigin"===c){b.push(gr,0,k[gr]),o=ge(o),v.svg?oe(t,o,0,y,0,this):((p=parseFloat(o.split(" ")[2])||0)!==v.zOrigin&&_d(this,v,"zOrigin",v.zOrigin,p),_d(this,k,c,Pr(s),Pr(o)));continue}if("svgOrigin"===c){oe(t,o,1,y,0,this);continue}if(c in Mr){ye(this,v,c,h,_?ma(h,_+o):o);continue}if("smoothOrigin"===c){_d(this,v,"smooth",v.smooth,o);continue}if("force3D"===c){v[c]=o;continue}if("transform"===c){Ae(this,o,t);continue}}}else c in k||(c=yr(c)||c);if(m||(u||0===u)&&(h||0===h)&&!pr.test(o)&&c in k)u=u||0,(d=(s+"").substr((h+"").length))!==(p=_a(o)||(c in Y.units?Y.units[c]:d))&&(h=ce(t,c,s,p)),this._pt=new we(this._pt,m?v:k,c,h,(_?ma(h,_+u):u)-h,m||"px"!==p&&"zIndex"!==c||!1===e.autoRound?xd:Bd),this._pt.u=p||0,m&&w!==o?(this._pt.b=s,this._pt.e=w,this._pt.r=Ad):d!==p&&"%"!==p&&(this._pt.b=s,this._pt.r=zd);else if(c in k)ee.call(this,t,c,s,_?_+o:o);else if(c in t)this.add(t,c,s||t[c],_?_+o:o,n,a);else if("parseTransform"!==c){S(c,o);continue}m||(c in k?b.push(c,0,k[c]):"function"==typeof t[c]?b.push(c,2,t[c]()):b.push(c,1,s||t[c])),x.push(c)}T&&be(this)},render:function render(t,e){if(e.tween._time||!je())for(var r=e._pt;r;)r.r(t,r.d),r=r._next;else e.styles.revert()},get:wr,aliases:_r,getSetter:function getSetter(t,e,r){var i=_r[e];return i&&i.indexOf(",")<0&&(e=i),e in ur&&e!==gr&&(t._gsap.x||wr(t,"x"))?r&&Ye===r?"scale"===e?Hd:Gd:(Ye=r||{})&&("scale"===e?Id:Jd):t.style&&!u(t.style[e])?Ed:~e.indexOf("-")?Fd:ue(t,e)},core:{_removeProperty:$d,_getMatrix:ne}};Fe.utils.checkPrefix=yr,Fe.core.getStyleSaver=Pd,Lr=ja((Fr="x,y,z,scale,scaleX,scaleY,xPercent,yPercent")+","+(Ir="rotation,rotationX,rotationY,skewX,skewY")+",transform,transformOrigin,svgOrigin,force3D,smoothOrigin,transformPerspective",function(t){ur[t]=1}),ja(Ir,function(t){Y.units[t]="deg",Mr[t]=1}),_r[Lr[13]]=Fr+","+Ir,ja("0:translateX,1:translateY,2:translateZ,8:rotate,8:rotationZ,8:rotateZ,9:rotateX,10:rotateY",function(t){var e=t.split(":");_r[e[1]]=Lr[e[0]]}),ja("x,y,z,top,right,bottom,left,width,height,fontSize,padding,margin,perspective",function(t){Y.units[t]="px"}),Fe.registerPlugin(Br);var Nr=Fe.registerPlugin(Br)||Fe,Ur=Nr.core.Tween;e.Back=rr,e.Bounce=nr,e.CSSPlugin=Br,e.Circ=or,e.Cubic=Qe,e.Elastic=er,e.Expo=sr,e.Linear=$e,e.Power0=Xe,e.Power1=qe,e.Power2=Ge,e.Power3=Ze,e.Power4=We,e.Quad=He,e.Quart=Je,e.Quint=Ke,e.Sine=ar,e.SteppedEase=ir,e.Strong=tr,e.TimelineLite=Gt,e.TimelineMax=Gt,e.TweenLite=te,e.TweenMax=Ur,e.default=Nr,e.gsap=Nr;if (typeof(window)==="undefined"||window!==e){Object.defineProperty(e,"__esModule",{value:!0})} else {delete e.default}});


;/* ===== END js/vendor/gsap.min.js ===== */

/* ===== BEGIN js/vendor/ScrollTrigger.min.js ===== */
/*!
 * ScrollTrigger 3.15.0
 * https://gsap.com
 * 
 * @license Copyright 2026, GreenSock. All rights reserved.
 * Subject to the terms at https://gsap.com/standard-license.
 * @author: Jack Doyle, jack@greensock.com
 */

!function(e,t){"object"==typeof exports&&"undefined"!=typeof module?t(exports):"function"==typeof define&&define.amd?define(["exports"],t):t((e=e||self).window=e.window||{})}(this,function(e){"use strict";function _defineProperties(e,t){for(var r=0;r<t.length;r++){var n=t[r];n.enumerable=n.enumerable||!1,n.configurable=!0,"value"in n&&(n.writable=!0),Object.defineProperty(e,n.key,n)}}function r(){return Se||"undefined"!=typeof window&&(Se=window.gsap)&&Se.registerPlugin&&Se}function z(e,t){return~Le.indexOf(e)&&Le[Le.indexOf(e)+1][t]}function A(e){return!!~t.indexOf(e)}function B(e,t,r,n,i){return e.addEventListener(t,r,{passive:!1!==n,capture:!!i})}function C(e,t,r,n){return e.removeEventListener(t,r,!!n)}function F(){return Re&&Re.isPressed||Ie.cache++}function G(r,n){function fd(e){if(e||0===e){i&&(Ce.history.scrollRestoration="manual");var t=Re&&Re.isPressed;e=fd.v=Math.round(e)||(Re&&Re.iOS?1:0),r(e),fd.cacheID=Ie.cache,t&&o("ss",e)}else(n||Ie.cache!==fd.cacheID||o("ref"))&&(fd.cacheID=Ie.cache,fd.v=r());return fd.v+fd.offset}return fd.offset=0,r&&fd}function J(e,t){return(t&&t._ctx&&t._ctx.selector||Se.utils.toArray)(e)[0]||("string"==typeof e&&!1!==Se.config().nullTargetWarn?console.warn("Element not found:",e):null)}function L(t,e){var r=e.s,n=e.sc;A(t)&&(t=Me.scrollingElement||ke);var i=Ie.indexOf(t),o=n===Xe.sc?1:2;~i||(i=Ie.push(t)-1),Ie[i+o]||B(t,"scroll",F);var a=Ie[i+o],s=a||(Ie[i+o]=G(z(t,r),!0)||(A(t)?n:G(function(e){return arguments.length?t[r]=e:t[r]})));return s.target=t,a||(s.smooth="smooth"===Se.getProperty(t,"scrollBehavior")),s}function M(e,t,i){function Hd(e,t){var r=Ye();t||n<r-s?(a=o,o=e,l=s,s=r):i?o+=e:o=a+(e-a)/(r-l)*(s-l)}var o=e,a=e,s=Ye(),l=s,n=t||50,c=Math.max(500,3*n);return{update:Hd,reset:function reset(){a=o=i?0:o,l=s=0},getVelocity:function getVelocity(e){var t=l,r=a,n=Ye();return!e&&0!==e||e===o||Hd(e),s===l||c<n-l?0:(o+(i?r:-r))/((i?n:s)-t)*1e3}}}function N(e,t){return t&&!e._gsapAllow&&!1!==e.cancelable&&e.preventDefault(),e.changedTouches?e.changedTouches[0]:e}function O(e){var t=Math.max.apply(Math,e),r=Math.min.apply(Math,e);return Math.abs(t)>=Math.abs(r)?t:r}function P(){(Ae=Se.core.globals().ScrollTrigger)&&Ae.core&&function _integrate(){var e=Ae.core,r=e.bridge||{},t=e._scrollers,n=e._proxies;t.push.apply(t,Ie),n.push.apply(n,Le),Ie=t,Le=n,o=function _bridge(e,t){return r[e](t)}}()}function Q(e){return Se=e||r(),!Te&&Se&&"undefined"!=typeof document&&document.body&&(Ce=window,ke=(Me=document).documentElement,Ee=Me.body,t=[Ce,Me,ke,Ee],Se.utils.clamp,Be=Se.core.context||function(){},Oe="onpointerenter"in Ee?"pointer":"mouse",Pe=k.isTouch=Ce.matchMedia&&Ce.matchMedia("(hover: none), (pointer: coarse)").matches?1:"ontouchstart"in Ce||0<navigator.maxTouchPoints||0<navigator.msMaxTouchPoints?2:0,De=k.eventTypes=("ontouchstart"in ke?"touchstart,touchmove,touchcancel,touchend":"onpointerdown"in ke?"pointerdown,pointermove,pointercancel,pointerup":"mousedown,mousemove,mouseup,mouseup").split(","),setTimeout(function(){return i=0},500),Te=1),Ae||P(),Te}var Se,Te,Ce,Me,ke,Ee,Pe,Oe,Ae,t,Re,De,Be,i=1,ze=[],Ie=[],Le=[],Ye=Date.now,o=function _bridge(e,t){return t},n="scrollLeft",a="scrollTop",Ne={s:n,p:"left",p2:"Left",os:"right",os2:"Right",d:"width",d2:"Width",a:"x",sc:G(function(e){return arguments.length?Ce.scrollTo(e,Xe.sc()):Ce.pageXOffset||Me[n]||ke[n]||Ee[n]||0})},Xe={s:a,p:"top",p2:"Top",os:"bottom",os2:"Bottom",d:"height",d2:"Height",a:"y",op:Ne,sc:G(function(e){return arguments.length?Ce.scrollTo(Ne.sc(),e):Ce.pageYOffset||Me[a]||ke[a]||Ee[a]||0})};Ne.op=Xe,Ie.cache=0;var k=(Observer.prototype.init=function init(e){Te||Q(Se)||console.warn("Please gsap.registerPlugin(Observer)"),Ae||P();var i=e.tolerance,a=e.dragMinimum,t=e.type,o=e.target,r=e.lineHeight,n=e.debounce,s=e.preventDefault,l=e.onStop,c=e.onStopDelay,u=e.ignore,f=e.wheelSpeed,d=e.event,p=e.onDragStart,g=e.onDragEnd,h=e.onDrag,v=e.onPress,b=e.onRelease,m=e.onRight,y=e.onLeft,x=e.onUp,_=e.onDown,w=e.onChangeX,S=e.onChangeY,T=e.onChange,k=e.onToggleX,E=e.onToggleY,R=e.onHover,D=e.onHoverEnd,z=e.onMove,I=e.ignoreCheck,Y=e.isNormalizer,X=e.onGestureStart,U=e.onGestureEnd,q=e.onWheel,H=e.onEnable,W=e.onDisable,V=e.onClick,G=e.scrollSpeed,j=e.capture,K=e.allowClicks,$=e.lockAxis,Z=e.onLockAxis;function hf(){return xe=Ye()}function jf(e,t){return(se.event=e)&&u&&function _isWithin(e,t){for(var r=t.length;r--;)if(t[r]===e||t[r].contains(e))return!0;return!1}(e.target,u)||t&&he&&"touch"!==e.pointerType||I&&I(e,t)}function lf(){var e=se.deltaX=O(me),t=se.deltaY=O(ye),r=Math.abs(e)>=i,n=Math.abs(t)>=i;T&&(r||n)&&T(se,e,t,me,ye),r&&(m&&0<se.deltaX&&m(se),y&&se.deltaX<0&&y(se),w&&w(se),k&&se.deltaX<0!=le<0&&k(se),le=se.deltaX,me[0]=me[1]=me[2]=0),n&&(_&&0<se.deltaY&&_(se),x&&se.deltaY<0&&x(se),S&&S(se),E&&se.deltaY<0!=ce<0&&E(se),ce=se.deltaY,ye[0]=ye[1]=ye[2]=0),(ne||re)&&(z&&z(se),re&&(p&&1===re&&p(se),h&&h(se),re=0),ne=!1),oe&&!(oe=!1)&&Z&&Z(se),ie&&(q(se),ie=!1),ee=0}function mf(e,t,r){me[r]+=e,ye[r]+=t,se._vx.update(e),se._vy.update(t),n?ee=ee||requestAnimationFrame(lf):lf()}function nf(e,t){$&&!ae&&(se.axis=ae=Math.abs(e)>Math.abs(t)?"x":"y",oe=!0),"y"!==ae&&(me[2]+=e,se._vx.update(e,!0)),"x"!==ae&&(ye[2]+=t,se._vy.update(t,!0)),n?ee=ee||requestAnimationFrame(lf):lf()}function of(e){if(!jf(e,1)){var t=(e=N(e,s)).clientX,r=e.clientY,n=t-se.x,i=r-se.y,o=se.isDragging;se.x=t,se.y=r,(o||(n||i)&&(Math.abs(se.startX-t)>=a||Math.abs(se.startY-r)>=a))&&(re=re||(o?2:1),o||(se.isDragging=!0),nf(n,i))}}function rf(e){return e.touches&&1<e.touches.length&&(se.isGesturing=!0)&&X(e,se.isDragging)}function sf(){return(se.isGesturing=!1)||U(se)}function tf(e){if(!jf(e)){var t=fe(),r=de();mf((t-pe)*G,(r-ge)*G,1),pe=t,ge=r,l&&te.restart(!0)}}function uf(e){if(!jf(e)){e=N(e,s),q&&(ie=!0);var t=(1===e.deltaMode?r:2===e.deltaMode?Ce.innerHeight:1)*f;mf(e.deltaX*t,e.deltaY*t,0),l&&!Y&&te.restart(!0)}}function vf(e){if(!jf(e)){var t=e.clientX,r=e.clientY,n=t-se.x,i=r-se.y;se.x=t,se.y=r,ne=!0,l&&te.restart(!0),(n||i)&&nf(n,i)}}function wf(e){se.event=e,R(se)}function xf(e){se.event=e,D(se)}function yf(e){return jf(e)||N(e,s)&&V(se)}this.target=o=J(o)||ke,this.vars=e,u=u&&Se.utils.toArray(u),i=i||1e-9,a=a||0,f=f||1,G=G||1,t=t||"wheel,touch,pointer",n=!1!==n,r=r||parseFloat(Ce.getComputedStyle(Ee).lineHeight)||22;var ee,te,re,ne,ie,oe,ae,se=this,le=0,ce=0,ue=e.passive||!s&&!1!==e.passive,fe=L(o,Ne),de=L(o,Xe),pe=fe(),ge=de(),he=~t.indexOf("touch")&&!~t.indexOf("pointer")&&"pointerdown"===De[0],ve=A(o),be=o.ownerDocument||Me,me=[0,0,0],ye=[0,0,0],xe=0,_e=se.onPress=function(e){jf(e,1)||e&&e.button||(se.axis=ae=null,te.pause(),se.isPressed=!0,e=N(e),le=ce=0,se.startX=se.x=e.clientX,se.startY=se.y=e.clientY,se._vx.reset(),se._vy.reset(),B(Y?o:be,De[1],of,ue,!0),se.deltaX=se.deltaY=0,v&&v(se))},we=se.onRelease=function(t){if(!jf(t,1)){C(Y?o:be,De[1],of,!0);var e=!isNaN(se.y-se.startY),r=se.isDragging,n=r&&(3<Math.abs(se.x-se.startX)||3<Math.abs(se.y-se.startY)),i=N(t);!n&&e&&(se._vx.reset(),se._vy.reset(),s&&K&&Se.delayedCall(.08,function(){if(300<Ye()-xe&&!t.defaultPrevented)if(t.target.click)t.target.click();else if(be.createEvent){var e=be.createEvent("MouseEvents");e.initMouseEvent("click",!0,!0,Ce,1,i.screenX,i.screenY,i.clientX,i.clientY,!1,!1,!1,!1,0,null),t.target.dispatchEvent(e)}})),se.isDragging=se.isGesturing=se.isPressed=!1,l&&r&&!Y&&te.restart(!0),re&&lf(),g&&r&&g(se),b&&b(se,n)}};te=se._dc=Se.delayedCall(c||.25,function onStopFunc(){se._vx.reset(),se._vy.reset(),te.pause(),l&&l(se)}).pause(),se.deltaX=se.deltaY=0,se._vx=M(0,50,!0),se._vy=M(0,50,!0),se.scrollX=fe,se.scrollY=de,se.isDragging=se.isGesturing=se.isPressed=!1,Be(this),se.enable=function(e){return se.isEnabled||(B(ve?be:o,"scroll",F),0<=t.indexOf("scroll")&&B(ve?be:o,"scroll",tf,ue,j),0<=t.indexOf("wheel")&&B(o,"wheel",uf,ue,j),(0<=t.indexOf("touch")&&Pe||0<=t.indexOf("pointer"))&&(B(o,De[0],_e,ue,j),B(be,De[2],we),B(be,De[3],we),K&&B(o,"click",hf,!0,!0),V&&B(o,"click",yf),X&&B(be,"gesturestart",rf),U&&B(be,"gestureend",sf),R&&B(o,Oe+"enter",wf),D&&B(o,Oe+"leave",xf),z&&B(o,Oe+"move",vf)),se.isEnabled=!0,se.isDragging=se.isGesturing=se.isPressed=ne=re=!1,se._vx.reset(),se._vy.reset(),pe=fe(),ge=de(),e&&e.type&&_e(e),H&&H(se)),se},se.disable=function(){se.isEnabled&&(ze.filter(function(e){return e!==se&&A(e.target)}).length||C(ve?be:o,"scroll",F),se.isPressed&&(se._vx.reset(),se._vy.reset(),C(Y?o:be,De[1],of,!0)),C(ve?be:o,"scroll",tf,j),C(o,"wheel",uf,j),C(o,De[0],_e,j),C(be,De[2],we),C(be,De[3],we),C(o,"click",hf,!0),C(o,"click",yf),C(be,"gesturestart",rf),C(be,"gestureend",sf),C(o,Oe+"enter",wf),C(o,Oe+"leave",xf),C(o,Oe+"move",vf),se.isEnabled=se.isPressed=se.isDragging=!1,W&&W(se))},se.kill=se.revert=function(){se.disable();var e=ze.indexOf(se);0<=e&&ze.splice(e,1),Re===se&&(Re=0)},ze.push(se),Y&&A(o)&&(Re=se),se.enable(d)},function _createClass(e,t,r){return t&&_defineProperties(e.prototype,t),r&&_defineProperties(e,r),e}(Observer,[{key:"velocityX",get:function get(){return this._vx.getVelocity()}},{key:"velocityY",get:function get(){return this._vy.getVelocity()}}]),Observer);function Observer(e){this.init(e)}k.version="3.15.0",k.create=function(e){return new k(e)},k.register=Q,k.getAll=function(){return ze.slice()},k.getById=function(t){return ze.filter(function(e){return e.vars.id===t})[0]},r()&&Se.registerPlugin(k);function Da(e,t,r){var n=ct(e)&&("clamp("===e.substr(0,6)||-1<e.indexOf("max"));return(r["_"+t+"Clamp"]=n)?e.substr(6,e.length-7):e}function Ea(e,t){return!t||ct(e)&&"clamp("===e.substr(0,6)?e:"clamp("+e+")"}function Ga(){return Ke=1}function Ha(){return Ke=0}function Ia(e){return e}function Ja(e){return Math.round(1e5*e)/1e5||0}function Ka(){return"undefined"!=typeof window}function La(){return Fe||Ka()&&(Fe=window.gsap)&&Fe.registerPlugin&&Fe}function Ma(e){return!!~l.indexOf(e)}function Na(e){return("Height"===e?S:Je["inner"+e])||qe["client"+e]||He["client"+e]}function Oa(e){return z(e,"getBoundingClientRect")||(Ma(e)?function(){return Ot.width=Je.innerWidth,Ot.height=S,Ot}:function(){return _t(e)})}function Ra(e,t){var r=t.s,n=t.d2,i=t.d,o=t.a;return Math.max(0,(r="scroll"+n)&&(o=z(e,r))?o()-Oa(e)()[i]:Ma(e)?(qe[r]||He[r])-Na(n):e[r]-e["offset"+n])}function Sa(e,t){for(var r=0;r<g.length;r+=3)t&&!~t.indexOf(g[r+1])||e(g[r],g[r+1],g[r+2])}function Ua(e){return"function"==typeof e}function Va(e){return"number"==typeof e}function Wa(e){return"object"==typeof e}function Xa(e,t,r){return e&&e.progress(t?0:1)&&r&&e.pause()}function Ya(e,t,r){if(e.enabled){var n=e._ctx?e._ctx.add(function(){return t(e,r)}):t(e,r);n&&n.totalTime&&(e.callbackAnimation=n)}}function nb(e){return Je.getComputedStyle(e.nodeType===Node.DOCUMENT_NODE?e.scrollingElement:e)}function pb(e,t){for(var r in t)r in e||(e[r]=t[r]);return e}function rb(e,t){var r=t.d2;return e["offset"+r]||e["client"+r]||0}function sb(e){var t,r=[],n=e.labels,i=e.duration();for(t in n)r.push(n[t]/i);return r}function ub(i){var o=Fe.utils.snap(i),a=Array.isArray(i)&&i.slice(0).sort(function(e,t){return e-t});return a?function(e,t,r){var n;if(void 0===r&&(r=.001),!t)return o(e);if(0<t){for(e-=r,n=0;n<a.length;n++)if(a[n]>=e)return a[n];return a[n-1]}for(n=a.length,e+=r;n--;)if(a[n]<=e)return a[n];return a[0]}:function(e,t,r){void 0===r&&(r=.001);var n=o(e);return!t||Math.abs(n-e)<r||n-e<0==t<0?n:o(t<0?e-i:e+i)}}function wb(t,r,e,n){return e.split(",").forEach(function(e){return t(r,e,n)})}function xb(e,t,r,n,i){return e.addEventListener(t,r,{passive:!n,capture:!!i})}function yb(e,t,r,n){return e.removeEventListener(t,r,!!n)}function zb(e,t,r){(r=r&&r.wheelHandler)&&(e(t,"wheel",r),e(t,"touchmove",r))}function Db(e,t){if(ct(e)){var r=e.indexOf("="),n=~r?(e.charAt(r-1)+1)*parseFloat(e.substr(r+1)):0;~r&&(e.indexOf("%")>r&&(n*=t/100),e=e.substr(0,r-1)),e=n+(e in U?U[e]*t:~e.indexOf("%")?parseFloat(e)*t/100:parseFloat(e)||0)}return e}function Eb(e,t,r,n,i,o,a,s){var l=i.startColor,c=i.endColor,u=i.fontSize,f=i.indent,d=i.fontWeight,p=Ue.createElement("div"),g=Ma(r)||"fixed"===z(r,"pinType"),h=-1!==e.indexOf("scroller"),v=g?He:"IFRAME"===r.tagName?r.contentDocument.body:r,b=-1!==e.indexOf("start"),m=b?l:c,y="border-color:"+m+";font-size:"+u+";color:"+m+";font-weight:"+d+";pointer-events:none;white-space:nowrap;font-family:sans-serif,Arial;z-index:1000;padding:4px 8px;border-width:0;border-style:solid;";return y+="position:"+((h||s)&&g?"fixed;":"absolute;"),!h&&!s&&g||(y+=(n===Xe?I:Y)+":"+(o+parseFloat(f))+"px;"),a&&(y+="box-sizing:border-box;text-align:left;width:"+a.offsetWidth+"px;"),p._isStart=b,p.setAttribute("class","gsap-marker-"+e+(t?" marker-"+t:"")),p.style.cssText=y,p.innerText=t||0===t?e+"-"+t:e,v.children[0]?v.insertBefore(p,v.children[0]):v.appendChild(p),p._offset=p["offset"+n.op.d2],q(p,0,n,b),p}function Jb(){return 34<at()-st&&(R=R||requestAnimationFrame($))}function Kb(){v&&v.isPressed&&!(v.startX>He.clientWidth)||(Ie.cache++,v?R=R||requestAnimationFrame($):$(),st||V("scrollStart"),st=at())}function Lb(){y=Je.innerWidth,m=Je.innerHeight}function Mb(e){Ie.cache++,!0!==e&&(je||h||Ue.fullscreenElement||Ue.webkitFullscreenElement||b&&y===Je.innerWidth&&!(Math.abs(Je.innerHeight-m)>.25*Je.innerHeight))||c.restart(!0)}function Pb(){return yb(ne,"scrollEnd",Pb)||kt(!0)}function Sb(e){for(var t=0;t<j.length;t+=5)(!e||j[t+4]&&j[t+4].query===e)&&(j[t].style.cssText=j[t+1],j[t].getBBox&&j[t].setAttribute("transform",j[t+2]||""),j[t+3].uncache=1)}function Tb(){return Ie.forEach(function(e){return Ua(e)&&++e.cacheID&&(e.rec=e())})}function Ub(e,t){var r;for($e=0;$e<Tt.length;$e++)!(r=Tt[$e])||t&&r._ctx!==t||(e?r.kill(1):r.revert(!0,!0));T=!0,t&&Sb(t),t||V("revert")}function Vb(e,t){Ie.cache++,!t&&rt||Ie.forEach(function(e){return Ua(e)&&e.cacheID++&&(e.rec=0)}),ct(e)&&(Je.history.scrollRestoration=_=e)}function $b(){He.appendChild(w),S=!v&&w.offsetHeight||Je.innerHeight,He.removeChild(w)}function _b(t){return We(".gsap-marker-start, .gsap-marker-end, .gsap-marker-scroller-start, .gsap-marker-scroller-end").forEach(function(e){return e.style.display=t?"none":"block"})}function ic(e,t,r,n){if(!e._gsap.swappedIn){for(var i,o=Z.length,a=t.style,s=e.style;o--;)a[i=Z[o]]=r[i];a.position="absolute"===r.position?"absolute":"relative","inline"===r.display&&(a.display="inline-block"),s[Y]=s[I]="auto",a.flexBasis=r.flexBasis||"auto",a.overflow="visible",a.boxSizing="border-box",a[ft]=rb(e,Ne)+xt,a[dt]=rb(e,Xe)+xt,a[bt]=s[mt]=s.top=s.left="0",Pt(n),s[ft]=s.maxWidth=r[ft],s[dt]=s.maxHeight=r[dt],s[bt]=r[bt],e.parentNode!==t&&(e.parentNode.insertBefore(t,e),t.appendChild(e)),e._gsap.swappedIn=!0}}function lc(e){for(var t=ee.length,r=e.style,n=[],i=0;i<t;i++)n.push(ee[i],r[ee[i]]);return n.t=e,n}function oc(e,t,r,n,i,o,a,s,l,c,u,f,d,p){Ua(e)&&(e=e(s)),ct(e)&&"max"===e.substr(0,3)&&(e=f+("="===e.charAt(4)?Db("0"+e.substr(3),r):0));var g,h,v,b=d?d.time():0;if(d&&d.seek(0),isNaN(e)||(e=+e),Va(e))d&&(e=Fe.utils.mapRange(d.scrollTrigger.start,d.scrollTrigger.end,0,f,e)),a&&q(a,r,n,!0);else{Ua(t)&&(t=t(s));var m,y,x,_,w=(e||"0").split(" ");v=J(t,s)||He,(m=_t(v)||{})&&(m.left||m.top)||"none"!==nb(v).display||(_=v.style.display,v.style.display="block",m=_t(v),_?v.style.display=_:v.style.removeProperty("display")),y=Db(w[0],m[n.d]),x=Db(w[1]||"0",r),e=m[n.p]-l[n.p]-c+y+i-x,a&&q(a,x,n,r-x<20||a._isStart&&20<x),r-=r-x}if(p&&(s[p]=e||-.001,e<0&&(e=0)),o){var S=e+r,T=o._isStart;g="scroll"+n.d2,q(o,S,n,T&&20<S||!T&&(u?Math.max(He[g],qe[g]):o.parentNode[g])<=S+1),u&&(l=_t(a),u&&(o.style[n.op.p]=l[n.op.p]-n.op.m-o._offset+xt))}return d&&v&&(g=_t(v),d.seek(f),h=_t(v),d._caScrollDist=g[n.p]-h[n.p],e=e/d._caScrollDist*f),d&&d.seek(b),d?e:Math.round(e)}function qc(e,t,r,n){if(e.parentNode!==t){var i,o,a=e.style;if(t===He){for(i in e._stOrig=a.cssText,o=nb(e))+i||re.test(i)||!o[i]||"string"!=typeof a[i]||"0"===i||(a[i]=o[i]);a.top=r,a.left=n}else a.cssText=e._stOrig;Fe.core.getCache(e).uncache=1,t.appendChild(e)}}function rc(r,e,n){var i=e,o=i;return function(e){var t=Math.round(r());return t!==i&&t!==o&&3<Math.abs(t-i)&&3<Math.abs(t-o)&&(e=t,n&&n()),o=i,i=Math.round(e)}}function sc(e,t,r){var n={};n[t.p]="+="+r,Fe.set(e,n)}function tc(c,e){function Jk(e,t,r,n,i){var o=Jk.tween,a=t.onComplete,s={};r=r||u();var l=rc(u,r,function(){o.kill(),Jk.tween=0});return i=n&&i||0,n=n||e-r,o&&o.kill(),t[f]=e,t.inherit=!1,(t.modifiers=s)[f]=function(){return l(r+n*o.ratio+i*o.ratio*o.ratio)},t.onUpdate=function(){Ie.cache++,Jk.tween&&$()},t.onComplete=function(){Jk.tween=0,a&&a.call(o)},o=Jk.tween=Fe.to(c,t)}var u=L(c,e),f="_scroll"+e.p2;return(c[f]=u).wheelHandler=function(){return Jk.tween&&Jk.tween.kill()&&(Jk.tween=0)},xb(c,"wheel",u.wheelHandler),ne.isTouch&&xb(c,"touchmove",u.wheelHandler),Jk}var Fe,s,Je,Ue,qe,He,l,c,We,Ve,Ge,u,je,Ke,f,$e,d,p,g,Qe,Ze,h,v,b,m,y,E,x,_,w,S,T,et,tt,R,rt,nt,it,ot=1,at=Date.now,D=at(),st=0,lt=0,ct=function _isString(e){return"string"==typeof e},ut=Math.abs,I="right",Y="bottom",ft="width",dt="height",pt="Right",gt="Left",ht="Top",vt="Bottom",bt="padding",mt="margin",yt="Width",X="Height",xt="px",_t=function _getBounds(e,t){var r=t&&"matrix(1, 0, 0, 1, 0, 0)"!==nb(e)[f]&&Fe.to(e,{x:0,y:0,xPercent:0,yPercent:0,rotation:0,rotationX:0,rotationY:0,scale:1,skewX:0,skewY:0}).progress(1),n=e.getBoundingClientRect?e.getBoundingClientRect():e.scrollingElement.getBoundingClientRect();return r&&r.progress(0).kill(),n},wt={startColor:"green",endColor:"red",indent:0,fontSize:"16px",fontWeight:"normal"},St={toggleActions:"play",anticipatePin:0},U={top:0,left:0,center:.5,bottom:1,right:1},q=function _positionMarker(e,t,r,n){var i={display:"block"},o=r[n?"os2":"p2"],a=r[n?"p2":"os2"];e._isFlipped=n,i[r.a+"Percent"]=n?-100:0,i[r.a]=n?"1px":0,i["border"+o+yt]=1,i["border"+a+yt]=0,i[r.p]=t+"px",Fe.set(e,i)},Tt=[],Ct={},H={},W=[],V=function _dispatch(e){return H[e]&&H[e].map(function(e){return e()})||W},j=[],Mt=0,kt=function _refreshAll(e,t){if(qe=Ue.documentElement,He=Ue.body,l=[Je,Ue,qe,He],!st||e||T){$b(),rt=ne.isRefreshing=!0,T||Tb();var r=V("refreshInit");Qe&&ne.sort(),t||Ub(),Ie.forEach(function(e){Ua(e)&&(e.smooth&&(e.target.style.scrollBehavior="auto"),e(0))}),Tt.slice(0).forEach(function(e){return e.refresh()}),T=!1,Tt.forEach(function(e){if(e._subPinOffset&&e.pin){var t=e.vars.horizontal?"offsetWidth":"offsetHeight",r=e.pin[t];e.revert(!0,1),e.adjustPinSpacing(e.pin[t]-r),e.refresh()}}),et=1,_b(!0),Tt.forEach(function(e){var t=Ra(e.scroller,e._dir),r="max"===e.vars.end||e._endClamp&&e.end>t,n=e._startClamp&&e.start>=t;(r||n)&&e.setPositions(n?t-1:e.start,r?Math.max(n?t:e.start+1,t):e.end,!0)}),_b(!1),et=0,r.forEach(function(e){return e&&e.render&&e.render(-1)}),Ie.forEach(function(e){Ua(e)&&(e.smooth&&requestAnimationFrame(function(){return e.target.style.scrollBehavior="smooth"}),e.rec&&e(e.rec))}),Vb(_,1),c.pause(),Mt++,$(rt=2),Tt.forEach(function(e){return Ua(e.vars.onRefresh)&&e.vars.onRefresh(e)}),rt=ne.isRefreshing=!1,V("refresh")}else xb(ne,"scrollEnd",Pb)},K=0,Et=1,$=function _updateAll(e){if(2===e||!rt&&!T){ne.isUpdating=!0,it&&it.update(0);var t=Tt.length,r=at(),n=50<=r-D,i=t&&Tt[0].scroll();if(Et=i<K?-1:1,rt||(K=i),n&&(st&&!Ke&&200<r-st&&(st=0,V("scrollEnd")),Ge=D,D=r),Et<0){for($e=t;0<$e--;)Tt[$e]&&Tt[$e].update(0,n);Et=1}else for($e=0;$e<t;$e++)Tt[$e]&&Tt[$e].update(0,n);ne.isUpdating=!1}R=0},Z=["left","top",Y,I,mt+vt,mt+pt,mt+ht,mt+gt,"display","flexShrink","float","zIndex","gridColumnStart","gridColumnEnd","gridRowStart","gridRowEnd","gridArea","justifySelf","alignSelf","placeSelf","order"],ee=Z.concat([ft,dt,"boxSizing","max"+yt,"max"+X,"position",mt,bt,bt+ht,bt+pt,bt+vt,bt+gt]),te=/([A-Z])/g,Pt=function _setState(e){if(e){var t,r,n=e.t.style,i=e.length,o=0;for((e.t._gsap||Fe.core.getCache(e.t)).uncache=1;o<i;o+=2)r=e[o+1],t=e[o],r?n[t]=r:n[t]&&n.removeProperty(t.replace(te,"-$1").toLowerCase())}},Ot={left:0,top:0},re=/(webkit|moz|length|cssText|inset)/i,ne=(ScrollTrigger.prototype.init=function init(P,O){if(this.progress=this.start=0,this.vars&&this.kill(!0,!0),lt){var A,n,p,R,D,B,I,Y,N,X,F,e,U,q,H,W,V,G,t,j,b,K,$,m,Q,y,Z,x,r,_,w,ee,i,g,te,re,ne,S,o,T=(P=pb(ct(P)||Va(P)||P.nodeType?{trigger:P}:P,St)).onUpdate,C=P.toggleClass,a=P.id,M=P.onToggle,ie=P.onRefresh,k=P.scrub,oe=P.trigger,ae=P.pin,se=P.pinSpacing,le=P.invalidateOnRefresh,E=P.anticipatePin,s=P.onScrubComplete,h=P.onSnapComplete,ce=P.once,ue=P.snap,fe=P.pinReparent,l=P.pinSpacer,de=P.containerAnimation,pe=P.fastScrollEnd,ge=P.preventOverlaps,he=P.horizontal||P.containerAnimation&&!1!==P.horizontal?Ne:Xe,ve=!k&&0!==k,be=J(P.scroller||Je),c=Fe.core.getCache(be),me=Ma(be),ye="fixed"===("pinType"in P?P.pinType:z(be,"pinType")||me&&"fixed"),xe=[P.onEnter,P.onLeave,P.onEnterBack,P.onLeaveBack],_e=ve&&P.toggleActions.split(" "),we="markers"in P?P.markers:St.markers,Se=me?0:parseFloat(nb(be)["border"+he.p2+yt])||0,Te=this,Ce=P.onRefreshInit&&function(){return P.onRefreshInit(Te)},Me=function _getSizeFunc(e,t,r){var n=r.d,i=r.d2,o=r.a;return(o=z(e,"getBoundingClientRect"))?function(){return o()[n]}:function(){return(t?Na(i):e["client"+i])||0}}(be,me,he),ke=function _getOffsetsFunc(e,t){return!t||~Le.indexOf(e)?Oa(e):function(){return Ot}}(be,me),Ee=0,Pe=0,Oe=0,Ae=L(be,he);if(Te._startClamp=Te._endClamp=!1,Te._dir=he,E*=45,Te.scroller=be,Te.scroll=de?de.time.bind(de):Ae,R=Ae(),Te.vars=P,O=O||P.animation,"refreshPriority"in P&&(Qe=1,-9999===P.refreshPriority&&(it=Te)),c.tweenScroll=c.tweenScroll||{top:tc(be,Xe),left:tc(be,Ne)},Te.tweenTo=A=c.tweenScroll[he.p],Te.scrubDuration=function(e){(i=Va(e)&&e)?ee?ee.duration(e):ee=Fe.to(O,{ease:"expo",totalProgress:"+=0",inherit:!1,duration:i,paused:!0,onComplete:function onComplete(){return s&&s(Te)}}):(ee&&ee.progress(1).kill(),ee=0)},O&&(O.vars.lazy=!1,O._initted&&!Te.isReverted||!1!==O.vars.immediateRender&&!1!==P.immediateRender&&O.duration()&&O.render(0,!0,!0),Te.animation=O.pause(),(O.scrollTrigger=Te).scrubDuration(k),_=0,a=a||O.vars.id),ue&&(Wa(ue)&&!ue.push||(ue={snapTo:ue}),"scrollBehavior"in He.style&&Fe.set(me?[He,qe]:be,{scrollBehavior:"auto"}),Ie.forEach(function(e){return Ua(e)&&e.target===(me?Ue.scrollingElement||qe:be)&&(e.smooth=!1)}),p=Ua(ue.snapTo)?ue.snapTo:"labels"===ue.snapTo?function _getClosestLabel(t){return function(e){return Fe.utils.snap(sb(t),e)}}(O):"labelsDirectional"===ue.snapTo?function _getLabelAtDirection(r){return function(e,t){return ub(sb(r))(e,t.direction)}}(O):!1!==ue.directional?function(e,t){return ub(ue.snapTo)(e,at()-Pe<500?0:t.direction)}:Fe.utils.snap(ue.snapTo),g=ue.duration||{min:.1,max:2},g=Wa(g)?Ve(g.min,g.max):Ve(g,g),te=Fe.delayedCall(ue.delay||i/2||.1,function(){var e=Ae(),t=at()-Pe<500,r=A.tween;if(!(t||Math.abs(Te.getVelocity())<10)||r||Ke||Ee===e)Te.isActive&&Ee!==e&&te.restart(!0);else{var n,i,o=(e-B)/q,a=O&&!ve?O.totalProgress():o,s=t?0:(a-w)/(at()-Ge)*1e3||0,l=Fe.utils.clamp(-o,1-o,ut(s/2)*s/.185),c=o+(!1===ue.inertia?0:l),u=ue.onStart,f=ue.onInterrupt,d=ue.onComplete;if(n=p(c,Te),Va(n)||(n=c),i=Math.max(0,Math.round(B+n*q)),e<=I&&B<=e&&i!==e){if(r&&!r._initted&&r.data<=ut(i-e))return;!1===ue.inertia&&(l=n-o),A(i,{duration:g(ut(.185*Math.max(ut(c-a),ut(n-a))/s/.05||0)),ease:ue.ease||"power3",data:ut(i-e),onInterrupt:function onInterrupt(){return te.restart(!0)&&f&&Ya(Te,f)},onComplete:function onComplete(){Te.update(),Ee=Ae(),O&&!ve&&(ee?ee.resetTo("totalProgress",n,O._tTime/O._tDur):O.progress(n)),_=w=O&&!ve?O.totalProgress():Te.progress,h&&h(Te),d&&Ya(Te,d)}},e,l*q,i-e-l*q),u&&Ya(Te,u,A.tween)}}}).pause()),a&&(Ct[a]=Te),o=(o=(oe=Te.trigger=J(oe||!0!==ae&&ae))&&oe._gsap&&oe._gsap.stRevert)&&o(Te),ae=!0===ae?oe:J(ae),ct(C)&&(C={targets:oe,className:C}),ae&&(!1===se||se===mt||(se=!(!se&&ae.parentNode&&ae.parentNode.style&&"flex"===nb(ae.parentNode).display)&&bt),Te.pin=ae,(n=Fe.core.getCache(ae)).spacer?H=n.pinState:(l&&((l=J(l))&&!l.nodeType&&(l=l.current||l.nativeElement),n.spacerIsNative=!!l,l&&(n.spacerState=lc(l))),n.spacer=G=l||Ue.createElement("div"),G.classList.add("pin-spacer"),a&&G.classList.add("pin-spacer-"+a),n.pinState=H=lc(ae)),!1!==P.force3D&&Fe.set(ae,{force3D:!0}),Te.spacer=G=n.spacer,r=nb(ae),m=r[se+he.os2],j=Fe.getProperty(ae),b=Fe.quickSetter(ae,he.a,xt),ic(ae,G,r),V=lc(ae)),we){e=Wa(we)?pb(we,wt):wt,X=Eb("scroller-start",a,be,he,e,0),F=Eb("scroller-end",a,be,he,e,0,X),t=X["offset"+he.op.d2];var u=J(z(be,"content")||be);Y=this.markerStart=Eb("start",a,u,he,e,t,0,de),N=this.markerEnd=Eb("end",a,u,he,e,t,0,de),de&&(S=Fe.quickSetter([Y,N],he.a,xt)),ye||Le.length&&!0===z(be,"fixedMarkers")||(function _makePositionable(e){var t=nb(e).position;e.style.position="absolute"===t||"fixed"===t?t:"relative"}(me?He:be),Fe.set([X,F],{force3D:!0}),y=Fe.quickSetter(X,he.a,xt),x=Fe.quickSetter(F,he.a,xt))}if(de){var f=de.vars.onUpdate,d=de.vars.onUpdateParams;de.eventCallback("onUpdate",function(){Te.update(0,0,1),f&&f.apply(de,d||[])})}if(Te.previous=function(){return Tt[Tt.indexOf(Te)-1]},Te.next=function(){return Tt[Tt.indexOf(Te)+1]},Te.revert=function(e,t){if(!t)return Te.kill(!0);var r=!1!==e||!Te.enabled,n=je;r!==Te.isReverted&&(r&&(re=Math.max(Ae(),Te.scroll.rec||0),Oe=Te.progress,ne=O&&O.progress()),Y&&[Y,N,X,F].forEach(function(e){return e.style.display=r?"none":"block"}),r&&(je=Te).update(r),!ae||fe&&Te.isActive||(r?function _swapPinOut(e,t,r){Pt(r);var n=e._gsap;if(n.spacerIsNative)Pt(n.spacerState);else if(e._gsap.swappedIn){var i=t.parentNode;i&&(i.insertBefore(e,t),i.removeChild(t))}e._gsap.swappedIn=!1}(ae,G,H):ic(ae,G,nb(ae),Q)),r||Te.update(r),je=n,Te.isReverted=r)},Te.refresh=function(e,t,r,n){if(!je&&Te.enabled||t)if(ae&&e&&st)xb(ScrollTrigger,"scrollEnd",Pb);else{!rt&&Ce&&Ce(Te),je=Te,A.tween&&!r&&(A.tween.kill(),A.tween=0),ee&&ee.pause(),le&&O&&(O.revert({kill:!1}).invalidate(),O.getChildren?O.getChildren(!0,!0,!1).forEach(function(e){return e.vars.immediateRender&&e.render(0,!0,!0)}):O.vars.immediateRender&&O.render(0,!0,!0)),Te.isReverted||Te.revert(!0,!0),Te._subPinOffset=!1;var i,o,a,s,l,c,u,f,d,p,g,h,v,b=Me(),m=ke(),y=de?de.duration():Ra(be,he),x=q<=.01||!q,_=0,w=n||0,S=Wa(r)?r.end:P.end,T=P.endTrigger||oe,C=Wa(r)?r.start:P.start||(0!==P.start&&oe?ae?"0 0":"0 100%":0),M=Te.pinnedContainer=P.pinnedContainer&&J(P.pinnedContainer,Te),k=oe&&Math.max(0,Tt.indexOf(Te))||0,E=k;for(we&&Wa(r)&&(h=Fe.getProperty(X,he.p),v=Fe.getProperty(F,he.p));0<E--;)(c=Tt[E]).end||c.refresh(0,1)||(je=Te),!(u=c.pin)||u!==oe&&u!==ae&&u!==M||c.isReverted||((p=p||[]).unshift(c),c.revert(!0,!0)),c!==Tt[E]&&(k--,E--);for(Ua(C)&&(C=C(Te)),C=Da(C,"start",Te),B=oc(C,oe,b,he,Ae(),Y,X,Te,m,Se,ye,y,de,Te._startClamp&&"_startClamp")||(ae?-.001:0),Ua(S)&&(S=S(Te)),ct(S)&&!S.indexOf("+=")&&(~S.indexOf(" ")?S=(ct(C)?C.split(" ")[0]:"")+S:(_=Db(S.substr(2),b),S=ct(C)?C:(de?Fe.utils.mapRange(0,de.duration(),de.scrollTrigger.start,de.scrollTrigger.end,B):B)+_,T=oe)),S=Da(S,"end",Te),I=Math.max(B,oc(S||(T?"100% 0":y),T,b,he,Ae()+_,N,F,Te,m,Se,ye,y,de,Te._endClamp&&"_endClamp"))||-.001,_=0,E=k;E--;)(u=(c=Tt[E]||{}).pin)&&c.start-c._pinPush<=B&&!de&&0<c.end&&(i=c.end-(Te._startClamp?Math.max(0,c.start):c.start),(u===oe&&c.start-c._pinPush<B||u===M)&&isNaN(C)&&(_+=i*(1-c.progress)),u===ae&&(w+=i));if(B+=_,I+=_,Te._startClamp&&(Te._startClamp+=_),Te._endClamp&&!rt&&(Te._endClamp=I||-.001,I=Math.min(I,Ra(be,he))),q=I-B||(B-=.01)&&.001,x&&(Oe=Fe.utils.clamp(0,1,Fe.utils.normalize(B,I,re))),Te._pinPush=w,Y&&_&&((i={})[he.a]="+="+_,M&&(i[he.p]="-="+Ae()),Fe.set([Y,N],i)),!ae||et&&Te.end>=Ra(be,he)){if(oe&&Ae()&&!de)for(o=oe.parentNode;o&&o!==He;)o._pinOffset&&(B-=o._pinOffset,I-=o._pinOffset),o=o.parentNode}else i=nb(ae),s=he===Xe,a=Ae(),K=parseFloat(j(he.a))+w,!y&&1<I&&(g={style:g=(me?Ue.scrollingElement||qe:be).style,value:g["overflow"+he.a.toUpperCase()]},me&&"scroll"!==nb(He)["overflow"+he.a.toUpperCase()]&&(g.style["overflow"+he.a.toUpperCase()]="scroll")),ic(ae,G,i),V=lc(ae),o=_t(ae,!0),f=ye&&L(be,s?Ne:Xe)(),se?((Q=[se+he.os2,q+w+xt]).t=G,(E=se===bt?rb(ae,he)+q+w:0)&&(Q.push(he.d,E+xt),"auto"!==G.style.flexBasis&&(G.style.flexBasis=E+xt)),Pt(Q),M&&Tt.forEach(function(e){e.pin===M&&!1!==e.vars.pinSpacing&&(e._subPinOffset=!0)}),ye&&Ae(re)):(E=rb(ae,he))&&"auto"!==G.style.flexBasis&&(G.style.flexBasis=E+xt),ye&&((l={top:o.top+(s?a-B:f)+xt,left:o.left+(s?f:a-B)+xt,boxSizing:"border-box",position:"fixed"})[ft]=l.maxWidth=Math.ceil(o.width)+xt,l[dt]=l.maxHeight=Math.ceil(o.height)+xt,l[mt]=l[mt+ht]=l[mt+pt]=l[mt+vt]=l[mt+gt]="0",l[bt]=i[bt],l[bt+ht]=i[bt+ht],l[bt+pt]=i[bt+pt],l[bt+vt]=i[bt+vt],l[bt+gt]=i[bt+gt],W=function _copyState(e,t,r){for(var n,i=[],o=e.length,a=r?8:0;a<o;a+=2)n=e[a],i.push(n,n in t?t[n]:e[a+1]);return i.t=e.t,i}(H,l,fe),rt&&Ae(0)),O?(d=O._initted,Ze(1),O.render(O.duration(),!0,!0),$=j(he.a)-K+q+w,Z=1<Math.abs(q-$),ye&&Z&&W.splice(W.length-2,2),O.render(0,!0,!0),d||O.invalidate(!0),O.parent||O.totalTime(O.totalTime()),Ze(0)):$=q,g&&(g.value?g.style["overflow"+he.a.toUpperCase()]=g.value:g.style.removeProperty("overflow-"+he.a));p&&p.forEach(function(e){return e.revert(!1,!0)}),Te.start=B,Te.end=I,R=D=rt?re:Ae(),de||rt||(R<re&&Ae(re),Te.scroll.rec=0),Te.revert(!1,!0),Pe=at(),te&&(Ee=-1,te.restart(!0)),je=0,O&&ve&&(O._initted||ne)&&O.progress()!==ne&&O.progress(ne||0,!0).render(O.time(),!0,!0),(x||Oe!==Te.progress||de||le||O&&!O._initted)&&(O&&!ve&&(O._initted||Oe||!1!==O.vars.immediateRender)&&O.totalProgress(de&&B<-.001&&!Oe?Fe.utils.normalize(B,I,0):Oe,!0),Te.progress=x||(R-B)/q===Oe?0:Oe),ae&&se&&(G._pinOffset=Math.round(Te.progress*$)),ee&&ee.invalidate(),isNaN(h)||(h-=Fe.getProperty(X,he.p),v-=Fe.getProperty(F,he.p),sc(X,he,h),sc(Y,he,h-(n||0)),sc(F,he,v),sc(N,he,v-(n||0))),x&&!rt&&Te.update(),!ie||rt||U||(U=!0,ie(Te),U=!1)}},Te.getVelocity=function(){return(Ae()-D)/(at()-Ge)*1e3||0},Te.endAnimation=function(){Xa(Te.callbackAnimation),O&&(ee?ee.progress(1):O.paused()?ve||Xa(O,Te.direction<0,1):Xa(O,O.reversed()))},Te.labelToScroll=function(e){return O&&O.labels&&(B||Te.refresh()||B)+O.labels[e]/O.duration()*q||0},Te.getTrailing=function(t){var e=Tt.indexOf(Te),r=0<Te.direction?Tt.slice(0,e).reverse():Tt.slice(e+1);return(ct(t)?r.filter(function(e){return e.vars.preventOverlaps===t}):r).filter(function(e){return 0<Te.direction?e.end<=B:e.start>=I})},Te.update=function(e,t,r){if(!de||r||e){var n,i,o,a,s,l,c,u=!0===rt?re:Te.scroll(),f=e?0:(u-B)/q,d=f<0?0:1<f?1:f||0,p=Te.progress;if(t&&(D=R,R=de?Ae():u,ue&&(w=_,_=O&&!ve?O.totalProgress():d)),E&&ae&&!je&&!ot&&st&&(!d&&B<u+(u-D)/(at()-Ge)*E?d=1e-4:1===d&&I>u+(u-D)/(at()-Ge)*E&&(d=.9999)),d!==p&&Te.enabled){if(a=(s=(n=Te.isActive=!!d&&d<1)!=(!!p&&p<1))||!!d!=!!p,Te.direction=p<d?1:-1,Te.progress=d,a&&!je&&(i=d&&!p?0:1===d?1:1===p?2:3,ve&&(o=!s&&"none"!==_e[i+1]&&_e[i+1]||_e[i],c=O&&("complete"===o||"reset"===o||o in O))),ge&&(s||c)&&(c||k||!O)&&(Ua(ge)?ge(Te):Te.getTrailing(ge).forEach(function(e){return e.endAnimation()})),ve||(!ee||je||ot?O&&O.totalProgress(d,!(!je||!Pe&&!e)):(ee._dp._time-ee._start!==ee._time&&ee.render(ee._dp._time-ee._start),ee.resetTo?ee.resetTo("totalProgress",d,O._tTime/O._tDur):(ee.vars.totalProgress=d,ee.invalidate().restart()))),ae)if(e&&se&&(G.style[se+he.os2]=m),ye){if(a){if(l=!e&&p<d&&u<I+1&&u+1>=Ra(be,he),fe)if(e||!n&&!l)qc(ae,G);else{var g=_t(ae,!0),h=u-B;qc(ae,He,g.top+(he===Xe?h:0)+xt,g.left+(he===Xe?0:h)+xt)}Pt(n||l?W:V),Z&&d<1&&n||b(K+(1!==d||l?0:$))}}else b(Ja(K+$*d));!ue||A.tween||je||ot||te.restart(!0),C&&(s||ce&&d&&(d<1||!tt))&&We(C.targets).forEach(function(e){return e.classList[n||ce?"add":"remove"](C.className)}),!T||ve||e||T(Te),a&&!je?(ve&&(c&&("complete"===o?O.pause().totalProgress(1):"reset"===o?O.restart(!0).pause():"restart"===o?O.restart(!0):O[o]()),T&&T(Te)),!s&&tt||(M&&s&&Ya(Te,M),xe[i]&&Ya(Te,xe[i]),ce&&(1===d?Te.kill(!1,1):xe[i]=0),s||xe[i=1===d?1:3]&&Ya(Te,xe[i])),pe&&!n&&Math.abs(Te.getVelocity())>(Va(pe)?pe:2500)&&(Xa(Te.callbackAnimation),ee?ee.progress(1):Xa(O,"reverse"===o?1:!d,1))):ve&&T&&!je&&T(Te)}if(x){var v=de?u/de.duration()*(de._caScrollDist||0):u;y(v+(X._isFlipped?1:0)),x(v)}S&&S(-u/de.duration()*(de._caScrollDist||0))}},Te.enable=function(e,t){Te.enabled||(Te.enabled=!0,xb(be,"resize",Mb),me||xb(be,"scroll",Kb),Ce&&xb(ScrollTrigger,"refreshInit",Ce),!1!==e&&(Te.progress=Oe=0,R=D=Ee=Ae()),!1!==t&&Te.refresh())},Te.getTween=function(e){return e&&A?A.tween:ee},Te.setPositions=function(e,t,r,n){if(de){var i=de.scrollTrigger,o=de.duration(),a=i.end-i.start;e=i.start+a*e/o,t=i.start+a*t/o}Te.refresh(!1,!1,{start:Ea(e,r&&!!Te._startClamp),end:Ea(t,r&&!!Te._endClamp)},n),Te.update()},Te.adjustPinSpacing=function(e){if(Q&&e){var t=Q.indexOf(he.d)+1;Q[t]=parseFloat(Q[t])+e+xt,Q[1]=parseFloat(Q[1])+e+xt,Pt(Q)}},Te.disable=function(e,t){if(!1!==e&&Te.revert(!0,!0),Te.enabled&&(Te.enabled=Te.isActive=!1,t||ee&&ee.pause(),re=0,n&&(n.uncache=1),Ce&&yb(ScrollTrigger,"refreshInit",Ce),te&&(te.pause(),A.tween&&A.tween.kill()&&(A.tween=0)),!me)){for(var r=Tt.length;r--;)if(Tt[r].scroller===be&&Tt[r]!==Te)return;yb(be,"resize",Mb),me||yb(be,"scroll",Kb)}},Te.kill=function(e,t){Te.disable(e,t),ee&&!t&&ee.kill(),a&&delete Ct[a];var r=Tt.indexOf(Te);0<=r&&Tt.splice(r,1),r===$e&&0<Et&&$e--,r=0,Tt.forEach(function(e){return e.scroller===Te.scroller&&(r=1)}),r||rt||(Te.scroll.rec=0),O&&(O.scrollTrigger=null,e&&O.revert({kill:!1}),t||O.kill()),Y&&[Y,N,X,F].forEach(function(e){return e.parentNode&&e.parentNode.removeChild(e)}),it===Te&&(it=0),ae&&(n&&(n.uncache=1),r=0,Tt.forEach(function(e){return e.pin===ae&&r++}),r||(n.spacer=0)),P.onKill&&P.onKill(Te)},Tt.push(Te),Te.enable(!1,!1),o&&o(Te),O&&O.add&&!q){var v=Te.update;Te.update=function(){Te.update=v,Ie.cache++,B||I||Te.refresh()},Fe.delayedCall(.01,Te.update),q=.01,B=I=0}else Te.refresh();ae&&function _queueRefreshAll(){if(nt!==Mt){var e=nt=Mt;requestAnimationFrame(function(){return e===Mt&&kt(!0)})}}()}else this.update=this.refresh=this.kill=Ia},ScrollTrigger.register=function register(e){return s||(Fe=e||La(),Ka()&&window.document&&ScrollTrigger.enable(),s=lt),s},ScrollTrigger.defaults=function defaults(e){if(e)for(var t in e)St[t]=e[t];return St},ScrollTrigger.disable=function disable(t,r){lt=0,Tt.forEach(function(e){return e[r?"kill":"disable"](t)}),yb(Je,"wheel",Kb),yb(Ue,"scroll",Kb),clearInterval(u),yb(Ue,"touchcancel",Ia),yb(He,"touchstart",Ia),wb(yb,Ue,"pointerdown,touchstart,mousedown",Ga),wb(yb,Ue,"pointerup,touchend,mouseup",Ha),c.kill(),Sa(yb);for(var e=0;e<Ie.length;e+=3)zb(yb,Ie[e],Ie[e+1]),zb(yb,Ie[e],Ie[e+2])},ScrollTrigger.enable=function enable(){if(Je=window,Ue=document,qe=Ue.documentElement,He=Ue.body,Fe)if(We=Fe.utils.toArray,Ve=Fe.utils.clamp,x=Fe.core.context||Ia,Ze=Fe.core.suppressOverwrites||Ia,_=Je.history.scrollRestoration||"auto",K=Je.pageYOffset||0,Fe.core.globals("ScrollTrigger",ScrollTrigger),He){lt=1,(w=document.createElement("div")).style.height="100vh",w.style.position="absolute",$b(),function _rafBugFix(){return lt&&requestAnimationFrame(_rafBugFix)}(),k.register(Fe),ScrollTrigger.isTouch=k.isTouch,E=k.isTouch&&/(iPad|iPhone|iPod|Mac)/g.test(navigator.userAgent),b=1===k.isTouch,xb(Je,"wheel",Kb),l=[Je,Ue,qe,He],Fe.matchMedia?(ScrollTrigger.matchMedia=function(e){var t,r=Fe.matchMedia();for(t in e)r.add(t,e[t]);return r},Fe.addEventListener("matchMediaInit",function(){Tb(),Ub()}),Fe.addEventListener("matchMediaRevert",function(){return Sb()}),Fe.addEventListener("matchMedia",function(){kt(0,1),V("matchMedia")}),Fe.matchMedia().add("(orientation: portrait)",function(){return Lb(),Lb})):console.warn("Requires GSAP 3.11.0 or later"),Lb(),xb(Ue,"scroll",Kb);var e,t,r=He.hasAttribute("style"),n=He.style,i=n.borderTopStyle,o=Fe.core.Animation.prototype;for(o.revert||Object.defineProperty(o,"revert",{value:function value(){return this.time(-.01,!0)}}),n.borderTopStyle="solid",e=_t(He),Xe.m=Math.round(e.top+Xe.sc())||0,Ne.m=Math.round(e.left+Ne.sc())||0,i?n.borderTopStyle=i:n.removeProperty("border-top-style"),r||(He.setAttribute("style",""),He.removeAttribute("style")),u=setInterval(Jb,250),Fe.delayedCall(.5,function(){return ot=0}),xb(Ue,"touchcancel",Ia),xb(He,"touchstart",Ia),wb(xb,Ue,"pointerdown,touchstart,mousedown",Ga),wb(xb,Ue,"pointerup,touchend,mouseup",Ha),f=Fe.utils.checkPrefix("transform"),ee.push(f),s=at(),c=Fe.delayedCall(.2,kt).pause(),g=[Ue,"visibilitychange",function(){var e=Je.innerWidth,t=Je.innerHeight;Ue.hidden?(d=e,p=t):d===e&&p===t||Mb()},Ue,"DOMContentLoaded",kt,Je,"load",kt,Je,"resize",Mb],Sa(xb),Tt.forEach(function(e){return e.enable(0,1)}),t=0;t<Ie.length;t+=3)zb(yb,Ie[t],Ie[t+1]),zb(yb,Ie[t],Ie[t+2])}else Ue&&Ue.addEventListener("DOMContentLoaded",function onLoad(){ScrollTrigger.enable(),Ue.removeEventListener("DOMContentLoaded",onLoad)})},ScrollTrigger.config=function config(e){"limitCallbacks"in e&&(tt=!!e.limitCallbacks);var t=e.syncInterval;t&&clearInterval(u)||(u=t)&&setInterval(Jb,t),"ignoreMobileResize"in e&&(b=1===ScrollTrigger.isTouch&&e.ignoreMobileResize),"autoRefreshEvents"in e&&(Sa(yb)||Sa(xb,e.autoRefreshEvents||"none"),h=-1===(e.autoRefreshEvents+"").indexOf("resize"))},ScrollTrigger.scrollerProxy=function scrollerProxy(e,t){var r=J(e),n=Ie.indexOf(r),i=Ma(r);~n&&Ie.splice(n,i?6:2),t&&(i?Le.unshift(Je,t,He,t,qe,t):Le.unshift(r,t))},ScrollTrigger.clearMatchMedia=function clearMatchMedia(t){Tt.forEach(function(e){return e._ctx&&e._ctx.query===t&&e._ctx.kill(!0,!0)})},ScrollTrigger.isInViewport=function isInViewport(e,t,r){var n=(ct(e)?J(e):e).getBoundingClientRect(),i=n[r?ft:dt]*t||0;return r?0<n.right-i&&n.left+i<Je.innerWidth:0<n.bottom-i&&n.top+i<Je.innerHeight},ScrollTrigger.positionInViewport=function positionInViewport(e,t,r){ct(e)&&(e=J(e));var n=e.getBoundingClientRect(),i=n[r?ft:dt],o=null==t?i/2:t in U?U[t]*i:~t.indexOf("%")?parseFloat(t)*i/100:parseFloat(t)||0;return r?(n.left+o)/Je.innerWidth:(n.top+o)/Je.innerHeight},ScrollTrigger.killAll=function killAll(e){if(Tt.slice(0).forEach(function(e){return"ScrollSmoother"!==e.vars.id&&e.kill()}),!0!==e){var t=H.killAll||[];H={},t.forEach(function(e){return e()})}},ScrollTrigger);function ScrollTrigger(e,t){s||ScrollTrigger.register(Fe)||console.warn("Please gsap.registerPlugin(ScrollTrigger)"),x(this),this.init(e,t)}ne.version="3.15.0",ne.saveStyles=function(e){return e?We(e).forEach(function(e){if(e&&e.style){var t=j.indexOf(e);0<=t&&j.splice(t,5),j.push(e,e.style.cssText,e.getBBox&&e.getAttribute("transform"),Fe.core.getCache(e),x())}}):j},ne.revert=function(e,t){return Ub(!e,t)},ne.create=function(e,t){return new ne(e,t)},ne.refresh=function(e){return e?Mb(!0):(s||ne.register())&&kt(!0)},ne.update=function(e){return++Ie.cache&&$(!0===e?2:0)},ne.clearScrollMemory=Vb,ne.maxScroll=function(e,t){return Ra(e,t?Ne:Xe)},ne.getScrollFunc=function(e,t){return L(J(e),t?Ne:Xe)},ne.getById=function(e){return Ct[e]},ne.getAll=function(){return Tt.filter(function(e){return"ScrollSmoother"!==e.vars.id})},ne.isScrolling=function(){return!!st},ne.snapDirectional=ub,ne.addEventListener=function(e,t){var r=H[e]||(H[e]=[]);~r.indexOf(t)||r.push(t)},ne.removeEventListener=function(e,t){var r=H[e],n=r&&r.indexOf(t);0<=n&&r.splice(n,1)},ne.batch=function(e,t){function Mp(e,t){var r=[],n=[],i=Fe.delayedCall(o,function(){t(r,n),r=[],n=[]}).pause();return function(e){r.length||i.restart(!0),r.push(e.trigger),n.push(e),a<=r.length&&i.progress(1)}}var r,n=[],i={},o=t.interval||.016,a=t.batchMax||1e9;for(r in t)i[r]="on"===r.substr(0,2)&&Ua(t[r])&&"onRefreshInit"!==r?Mp(0,t[r]):t[r];return Ua(a)&&(a=a(),xb(ne,"refresh",function(){return a=t.batchMax()})),We(e).forEach(function(e){var t={};for(r in i)t[r]=i[r];t.trigger=e,n.push(ne.create(t))}),n};function vc(e,t,r,n){return n<t?e(n):t<0&&e(0),n<r?(n-t)/(r-t):r<0?t/(t-r):1}function wc(e,t){!0===t?e.style.removeProperty("touch-action"):e.style.touchAction=!0===t?"auto":t?"pan-"+t+(k.isTouch?" pinch-zoom":""):"none",e===qe&&wc(He,t)}function yc(e){var t,r=e.event,n=e.target,i=e.axis,o=(r.changedTouches?r.changedTouches[0]:r).target,a=o._gsap||Fe.core.getCache(o),s=at();if(!a._isScrollT||2e3<s-a._isScrollT){for(;o&&o!==He&&(o.scrollHeight<=o.clientHeight&&o.scrollWidth<=o.clientWidth||!oe[(t=nb(o)).overflowY]&&!oe[t.overflowX]);)o=o.parentNode;a._isScroll=o&&o!==n&&!Ma(o)&&(oe[(t=nb(o)).overflowY]||oe[t.overflowX]),a._isScrollT=s}!a._isScroll&&"x"!==i||(r.stopPropagation(),r._gsapAllow=!0)}function zc(e,t,r,n){return k.create({target:e,capture:!0,debounce:!1,lockAxis:!0,type:t,onWheel:n=n&&yc,onPress:n,onDrag:n,onScroll:n,onEnable:function onEnable(){return r&&xb(Ue,k.eventTypes[0],se,!1,!0)},onDisable:function onDisable(){return yb(Ue,k.eventTypes[0],se,!0)}})}function Dc(e){function Jq(){return i=!1}function Mq(){o=Ra(p,Xe),C=Ve(E?1:0,o),f&&(T=Ve(0,Ra(p,Ne))),l=Mt}function Nq(){v._gsap.y=Ja(parseFloat(v._gsap.y)+b.offset)+"px",v.style.transform="matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, "+parseFloat(v._gsap.y)+", 0, 1)",b.offset=b.cacheID=0}function Tq(){Mq(),a.isActive()&&a.vars.scrollY>o&&(b()>o?a.progress(1)&&b(o):a.resetTo("scrollY",o))}Wa(e)||(e={}),e.preventDefault=e.isNormalizer=e.allowClicks=!0,e.type||(e.type="wheel,touch"),e.debounce=!!e.debounce,e.id=e.id||"normalizer";var n,o,l,i,a,c,u,s,f=e.normalizeScrollX,t=e.momentum,r=e.allowNestedScroll,d=e.onRelease,p=J(e.target)||qe,g=Fe.core.globals().ScrollSmoother,h=g&&g.get(),v=E&&(e.content&&J(e.content)||h&&!1!==e.content&&!h.smooth()&&h.content()),b=L(p,Xe),m=L(p,Ne),y=1,x=(k.isTouch&&Je.visualViewport?Je.visualViewport.scale*Je.visualViewport.width:Je.outerWidth)/Je.innerWidth,_=0,w=Ua(t)?function(){return t(n)}:function(){return t||2.8},S=zc(p,e.type,!0,r),T=Ia,C=Ia;return v&&Fe.set(v,{y:"+=0"}),e.ignoreCheck=function(e){return E&&"touchmove"===e.type&&function ignoreDrag(){if(i){requestAnimationFrame(Jq);var e=Ja(n.deltaY/2),t=C(b.v-e);if(v&&t!==b.v+b.offset){b.offset=t-b.v;var r=Ja((parseFloat(v&&v._gsap.y)||0)-b.offset);v.style.transform="matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, "+r+", 0, 1)",v._gsap.y=r+"px",b.cacheID=Ie.cache,$()}return!0}b.offset&&Nq(),i=!0}()||1.05<y&&"touchstart"!==e.type||n.isGesturing||e.touches&&1<e.touches.length},e.onPress=function(){i=!1;var e=y;y=Ja((Je.visualViewport&&Je.visualViewport.scale||1)/x),a.pause(),e!==y&&wc(p,1.01<y||!f&&"x"),c=m(),u=b(),Mq(),l=Mt},e.onRelease=e.onGestureStart=function(e,t){if(b.offset&&Nq(),t){Ie.cache++;var r,n,i=w();f&&(n=(r=m())+.05*i*-e.velocityX/.227,i*=vc(m,r,n,Ra(p,Ne)),a.vars.scrollX=T(n)),n=(r=b())+.05*i*-e.velocityY/.227,i*=vc(b,r,n,Ra(p,Xe)),a.vars.scrollY=C(n),a.invalidate().duration(i).play(.01),(E&&a.vars.scrollY>=o||o-1<=r)&&Fe.to({},{onUpdate:Tq,duration:i})}else s.restart(!0);d&&d(e)},e.onWheel=function(){a._ts&&a.pause(),1e3<at()-_&&(l=0,_=at())},e.onChange=function(e,t,r,n,i){if(Mt!==l&&Mq(),t&&f&&m(T(n[2]===t?c+(e.startX-e.x):m()+t-n[1])),r){b.offset&&Nq();var o=i[2]===r,a=o?u+e.startY-e.y:b()+r-i[1],s=C(a);o&&a!==s&&(u+=s-a),b(s)}(r||t)&&$()},e.onEnable=function(){wc(p,!f&&"x"),ne.addEventListener("refresh",Tq),xb(Je,"resize",Tq),b.smooth&&(b.target.style.scrollBehavior="auto",b.smooth=m.smooth=!1),S.enable()},e.onDisable=function(){wc(p,!0),yb(Je,"resize",Tq),ne.removeEventListener("refresh",Tq),S.kill()},e.lockAxis=!1!==e.lockAxis,((n=new k(e)).iOS=E)&&!b()&&b(1),E&&Fe.ticker.add(Ia),s=n._dc,a=Fe.to(n,{ease:"power4",paused:!0,inherit:!1,scrollX:f?"+=0.1":"+=0",scrollY:"+=0.1",modifiers:{scrollY:rc(b,b(),function(){return a.pause()})},onUpdate:$,onComplete:s.vars.onComplete}),n}var ie,oe={auto:1,scroll:1},ae=/(input|label|select|textarea)/i,se=function _captureInputs(e){var t=ae.test(e.target.tagName);(t||ie)&&(e._gsapAllow=!0,ie=t)};ne.sort=function(e){if(Ua(e))return Tt.sort(e);var t=Je.pageYOffset||0;return ne.getAll().forEach(function(e){return e._sortY=e.trigger?t+e.trigger.getBoundingClientRect().top:e.start+Je.innerHeight}),Tt.sort(e||function(e,t){return-1e6*(e.vars.refreshPriority||0)+(e.vars.containerAnimation?1e6:e._sortY)-((t.vars.containerAnimation?1e6:t._sortY)+-1e6*(t.vars.refreshPriority||0))})},ne.observe=function(e){return new k(e)},ne.normalizeScroll=function(e){if(void 0===e)return v;if(!0===e&&v)return v.enable();if(!1===e)return v&&v.kill(),void(v=e);var t=e instanceof k?e:Dc(e);return v&&v.target===t.target&&v.kill(),Ma(t.target)&&(v=t),t},ne.core={_getVelocityProp:M,_inputObserver:zc,_scrollers:Ie,_proxies:Le,bridge:{ss:function ss(){st||V("scrollStart"),st=at()},ref:function ref(){return je}}},La()&&Fe.registerPlugin(ne),e.ScrollTrigger=ne,e.default=ne;if (typeof(window)==="undefined"||window!==e){Object.defineProperty(e,"__esModule",{value:!0})} else {delete e.default}});


;/* ===== END js/vendor/ScrollTrigger.min.js ===== */

/* ===== BEGIN js/vendor/SplitText.min.js ===== */
/*!
 * SplitText 3.15.0
 * https://gsap.com
 *
 * @license Copyright 2026, GreenSock. All rights reserved. Subject to the terms at https://gsap.com/standard-license.
 * @author: Jack Doyle
 */

(function(k,A){typeof exports=="object"&&typeof module!="undefined"?A(exports):typeof define=="function"&&define.amd?define(["exports"],A):(k=typeof globalThis!="undefined"?globalThis:k||self,A(k.window=k.window||{}))})(this,function(k){"use strict";let A,D,Z=typeof Symbol=="function"?Symbol():"_split",K,he=()=>K||Y.register(window.gsap),$=typeof Intl!="undefined"&&"Segmenter"in Intl?new Intl.Segmenter:0,I=e=>e?typeof e=="string"?I(document.querySelectorAll(e)):"length"in e?Array.from(e).reduce((t,i)=>(typeof i=="string"?t.push(...I(i)):t.push(i),t),[]):[e]:[],ee=e=>I(e).filter(t=>t&&t.nodeType===1),Q=[],U=function(){},de={add:e=>e()},pe=/\s+/g,te=new RegExp("\\p{RI}\\p{RI}|\\p{Emoji}(\\p{EMod}|\\u{FE0F}\\u{20E3}?|[\\u{E0020}-\\u{E007E}]+\\u{E007F})?(\\u{200D}\\p{Emoji}(\\p{EMod}|\\u{FE0F}\\u{20E3}?|[\\u{E0020}-\\u{E007E}]+\\u{E007F})?)*|.","gu"),J={left:0,top:0,width:0,height:0},ue=(e,t)=>{for(;++t<e.length&&e[t]===J;);return e[t]||J},ie=({element:e,html:t,ariaL:i,ariaH:n})=>{e.innerHTML=t,i?e.setAttribute("aria-label",i):e.removeAttribute("aria-label"),n?e.setAttribute("aria-hidden",n):e.removeAttribute("aria-hidden")},ne=(e,t)=>{if(t){let i=new Set(e.join("").match(t)||Q),n=e.length,a,c,l,o;if(i.size)for(;--n>-1;){c=e[n];for(l of i)if(l.startsWith(c)&&l.length>c.length){for(a=0,o=c;l.startsWith(o+=e[n+ ++a])&&o.length<l.length;);if(a&&o.length===l.length){e[n]=l,e.splice(n+1,a);break}}}}return e},le=e=>window.getComputedStyle(e).display==="inline"&&(e.style.display="inline-block"),M=(e,t,i)=>t.insertBefore(typeof e=="string"?document.createTextNode(e):e,i),X=(e,t,i)=>{let n=t[e+"sClass"]||"",{tag:a="div",aria:c="auto",propIndex:l=!1}=t,o=e==="line"?"block":"inline-block",d=n.indexOf("++")>-1,_=y=>{let m=document.createElement(a),E=i.length+1;return n&&(m.className=n+(d?" "+n+E:"")),l&&m.style.setProperty("--"+e,E+""),c!=="none"&&m.setAttribute("aria-hidden","true"),a!=="span"&&(m.style.position="relative",m.style.display=o),m.textContent=y,i.push(m),m};return d&&(n=n.replace("++","")),_.collection=i,_},fe=(e,t,i,n)=>{let a=X("line",i,n),c=window.getComputedStyle(e).textAlign||"left";return(l,o)=>{let d=a("");for(d.style.textAlign=c,e.insertBefore(d,t[l]);l<o;l++)d.appendChild(t[l]);d.normalize()}},se=(e,t,i,n,a,c,l,o,d,_)=>{var y;let m=Array.from(e.childNodes),E=0,{wordDelimiter:R,reduceWhiteSpace:B=!0,prepareText:V}=t,G=e.getBoundingClientRect(),j=G,q=!B&&window.getComputedStyle(e).whiteSpace.substring(0,3)==="pre",C=0,b=i.collection,r,f,O,s,g,x,z,h,p,W,S,T,N,F,w,u,L,v;for(typeof R=="object"?(O=R.delimiter||R,f=R.replaceWith||""):f=R===""?"":R||" ",r=f!==" ";E<m.length;E++)if(s=m[E],s.nodeType===3){for(w=s.textContent||"",B?w=w.replace(pe," "):q&&(w=w.replace(/\n/g,f+`
`)),V&&(w=V(w,e)),s.textContent=w,g=f||O?w.split(O||f):w.match(o)||Q,L=g[g.length-1],h=r?L.slice(-1)===" ":!L,L||g.pop(),j=G,z=r?g[0].charAt(0)===" ":!g[0],z&&M(" ",e,s),g[0]||g.shift(),ne(g,d),c&&_||(s.textContent=""),p=1;p<=g.length;p++)if(u=g[p-1],!B&&q&&u.charAt(0)===`
`&&((y=s.previousSibling)==null||y.remove(),M(document.createElement("br"),e,s),u=u.slice(1)),!B&&u==="")M(f,e,s);else if(u===" ")e.insertBefore(document.createTextNode(" "),s);else{if(r&&u.charAt(0)===" "&&M(" ",e,s),C&&p===1&&!z&&b.indexOf(C.parentNode)>-1?(x=b[b.length-1],x.appendChild(document.createTextNode(n?"":u))):(x=i(n?"":u),M(x,e,s),C&&p===1&&!z&&x.insertBefore(C,x.firstChild)),n)for(S=$?ne([...$.segment(u)].map(H=>H.segment),d):u.match(o)||Q,v=0;v<S.length;v++)x.appendChild(S[v]===" "?document.createTextNode(" "):n(S[v]));if(c&&_){if(w=s.textContent=w.substring(u.length+1,w.length),W=x.getBoundingClientRect(),W.top>j.top&&W.left<=j.left){for(T=e.cloneNode(),N=e.childNodes[0];N&&N!==x;)F=N,N=N.nextSibling,T.appendChild(F);e.parentNode.insertBefore(T,e),a&&le(T)}j=W}(p<g.length||h)&&M(p>=g.length?" ":r&&u.slice(-1)===" "?" "+f:f,e,s)}e.removeChild(s),C=0}else s.nodeType===1&&(l&&l.indexOf(s)>-1?(b.indexOf(s.previousSibling)>-1&&b[b.length-1].appendChild(s),C=s):(se(s,t,i,n,a,c,l,o,d,!0),C=0),a&&le(s))};const re=class ae{constructor(t,i){this.isSplit=!1,he(),this.elements=ee(t),this.chars=[],this.words=[],this.lines=[],this.masks=[],this.vars=i,this.elements.forEach(l=>{var o;i.overwrite!==!1&&((o=l[Z])==null||o._data.orig.filter(({element:d})=>d===l).forEach(ie)),l[Z]=this}),this._split=()=>this.isSplit&&this.split(this.vars);let n=[],a,c=()=>{let l=n.length,o;for(;l--;){o=n[l];let d=o.element.offsetWidth;if(d!==o.width){o.width=d,this._split();return}}};this._data={orig:n,obs:typeof ResizeObserver!="undefined"&&new ResizeObserver(()=>{clearTimeout(a),a=setTimeout(c,200)})},U(this),this.split(i)}split(t){return(this._ctx||de).add(()=>{this.isSplit&&this.revert(),this.vars=t=t||this.vars||{};let{type:i="chars,words,lines",aria:n="auto",deepSlice:a=!0,smartWrap:c,onSplit:l,autoSplit:o=!1,specialChars:d,mask:_}=this.vars,y=i.indexOf("lines")>-1,m=i.indexOf("chars")>-1,E=i.indexOf("words")>-1,R=m&&!E&&!y,B=d&&("push"in d?new RegExp("(?:"+d.join("|")+")","gu"):d),V=B?new RegExp(B.source+"|"+te.source,"gu"):te,G=!!t.ignore&&ee(t.ignore),{orig:j,animTime:q,obs:C}=this._data,b;(m||E||y)&&(this.elements.forEach((r,f)=>{j[f]={element:r,html:r.innerHTML,ariaL:r.getAttribute("aria-label"),ariaH:r.getAttribute("aria-hidden")},n==="auto"?r.setAttribute("aria-label",(r.textContent||"").trim()):n==="hidden"&&r.setAttribute("aria-hidden","true");let O=[],s=[],g=[],x=m?X("char",t,O):null,z=X("word",t,s),h,p,W,S;if(se(r,t,z,x,R,a&&(y||R),G,V,B,!1),y){let T=I(r.childNodes),N=fe(r,T,t,g),F,w=[],u=0,L=T.map(P=>P.nodeType===1?P.getBoundingClientRect():J),v=J,H;for(h=0;h<T.length;h++)F=T[h],F.nodeType===1&&(F.nodeName==="BR"?((!h||T[h-1].nodeName!=="BR")&&(w.push(F),N(u,h+1)),u=h+1,v=ue(L,h)):(H=L[h],h&&H.top>v.top&&H.left<v.left+v.width-1&&(N(u,h),u=h),v=H));u<h&&N(u,h),w.forEach(P=>{var oe;return(oe=P.parentNode)==null?void 0:oe.removeChild(P)})}if(!E){for(h=0;h<s.length;h++)if(p=s[h],m||!p.nextSibling||p.nextSibling.nodeType!==3)if(c&&!y){for(W=document.createElement("span"),W.style.whiteSpace="nowrap";p.firstChild;)W.appendChild(p.firstChild);p.replaceWith(W)}else p.replaceWith(...p.childNodes);else S=p.nextSibling,S&&S.nodeType===3&&(S.textContent=(p.textContent||"")+(S.textContent||""),p.remove());s.length=0,r.normalize()}this.lines.push(...g),this.words.push(...s),this.chars.push(...O)}),_&&this[_]&&this.masks.push(...this[_].map(r=>{let f=r.cloneNode();return r.replaceWith(f),f.appendChild(r),r.className&&(f.className=r.className.trim().split(" ").map(O=>O+"-mask").join(" ")),f.style.overflow="clip",f}))),this.isSplit=!0,D&&y&&o&&D.addEventListener("loadingdone",this._split),(b=l&&l(this))&&b.totalTime&&(this._data.anim=q?b.totalTime(q):b),y&&o&&this.elements.forEach((r,f)=>{j[f].width=r.offsetWidth,C&&C.observe(r)})}),this}kill(){let{obs:t}=this._data;t&&t.disconnect(),D==null||D.removeEventListener("loadingdone",this._split)}revert(){var t,i;if(this.isSplit){let{orig:n,anim:a}=this._data;this.kill(),n.forEach(ie),this.chars.length=this.words.length=this.lines.length=n.length=this.masks.length=0,this.isSplit=!1,a&&(this._data.animTime=a.totalTime(),a.revert()),(i=(t=this.vars).onRevert)==null||i.call(t,this)}return this}static create(t,i){return new ae(t,i)}static register(t){A=A||t||window.gsap,A&&(I=A.utils.toArray,U=A.core.context||U),!K&&window.innerWidth>0&&(D=document.fonts,K=!0)}};re.version="3.15.0";let Y=re;k.SplitText=Y,k.default=Y;if (typeof(window)==="undefined"||window!==k){Object.defineProperty(k,"__esModule",{value:!0})} else {delete k.default}});

;/* ===== END js/vendor/SplitText.min.js ===== */

;try { if (window.gsap) window.gsap.registerPlugin(window.ScrollTrigger, window.SplitText); } catch (_) {}

/* ===== BEGIN js/buttons.js ===== */
/* WESTO desktop button hover animation.
   Stable-performance version:
   - keeps the exact two-layer GSAP hover treatment;
   - does not split/duplicate every .button during boot;
   - only enhances a button the first time the user actually hovers it;
   - resolves .char nodes fresh on every animation so auth-nav can safely
     replace the login/profile/admin label after the button was enhanced.
*/
(() => {
  'use strict';

  const DESKTOP_MIN_WIDTH = 992;
  const states = new WeakMap();

  function isEligible(btn) {
    if (!btn || !btn.classList?.contains('button')) return false;
    if (btn.closest('.sib-form')) return false;
    if (btn.classList.contains('menu-add-btn')) return false;
    if (btn.classList.contains('glass-button')) return false;
    if (btn.closest('#table-drawer')) return false;
    if (btn.closest('#qty-modal')) return false;
    return true;
  }

  function isArabicScript(text) {
    return /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/.test(text);
  }

  function splitPieces(text) {
    if (!isArabicScript(text)) return Array.from(text);

    const words = text.split(/\s+/).filter(Boolean);
    return words.map((word, index) => (
      index < words.length - 1 ? `${word} ` : word
    ));
  }

  function makeChar(piece) {
    const span = document.createElement('span');
    span.className = 'char';
    span.style.display = 'inline-block';
    span.textContent = piece === ' ' ? '\u00a0' : piece.replace(/ /g, '\u00a0');
    return span;
  }

  function fillLayer(layer, text) {
    const fragment = document.createDocumentFragment();
    splitPieces(text).forEach((piece) => fragment.appendChild(makeChar(piece)));
    layer.replaceChildren(fragment);
  }

  function createLayers(btn) {
    const icon = btn.querySelector('.button_icon');
    const iconClone = icon?.cloneNode(true) || null;
    icon?.remove();

    const text = btn.textContent.trim();

    const textWrap = document.createElement('div');
    textWrap.className = 'button_text';
    textWrap.style.overflow = 'hidden';
    textWrap.style.display = 'inline-flex';
    textWrap.style.position = 'relative';

    const top = document.createElement('div');
    top.className = 'layer-top';

    const bottom = document.createElement('div');
    bottom.className = 'layer-bottom';
    bottom.style.position = 'absolute';
    bottom.style.top = '0';
    bottom.style.left = '0';

    fillLayer(top, text);
    fillLayer(bottom, text);
    textWrap.append(top, bottom);

    btn.replaceChildren(textWrap);
    if (iconClone) btn.prepend(iconClone);

    return { top, bottom };
  }

  function getLayers(btn) {
    const top = btn.querySelector('.layer-top');
    const bottom = btn.querySelector('.layer-bottom');
    return top && bottom ? { top, bottom } : null;
  }

  function killTimeline(state) {
    if (!state?.timeline) return;
    try {
      state.timeline.kill();
    } catch (_) {}
    state.timeline = null;
  }

  function currentChars(btn) {
    const layers = getLayers(btn);
    if (!layers) return null;

    const top = Array.from(layers.top.querySelectorAll('.char'));
    const bottom = Array.from(layers.bottom.querySelectorAll('.char'));
    if (!top.length || !bottom.length) return null;

    return { ...layers, topChars: top, bottomChars: bottom };
  }

  function setRestingState(btn) {
    const chars = currentChars(btn);
    if (!chars) return false;

    if (window.gsap?.set) {
      window.gsap.set(chars.topChars, { y: '0%' });
      window.gsap.set(chars.bottomChars, { y: '110%' });
    } else {
      chars.topChars.forEach((char) => {
        char.style.transform = 'translateY(0%)';
      });
      chars.bottomChars.forEach((char) => {
        char.style.transform = 'translateY(110%)';
      });
    }
    return true;
  }

  function setHoveredState(btn) {
    const chars = currentChars(btn);
    if (!chars) return false;

    if (window.gsap?.set) {
      window.gsap.set(chars.topChars, { y: '-110%' });
      window.gsap.set(chars.bottomChars, { y: '0%' });
    } else {
      chars.topChars.forEach((char) => {
        char.style.transform = 'translateY(-110%)';
      });
      chars.bottomChars.forEach((char) => {
        char.style.transform = 'translateY(0%)';
      });
    }
    return true;
  }

  function observeDynamicLabel(btn, state) {
    if (btn.id !== 'nav-auth-btn' || state.labelObserver) return;

    state.labelObserver = new MutationObserver(() => {
      // auth-nav replaces the .char children after /api/auth/me resolves.
      // Do not cache NodeLists: reconcile the newly-created characters with
      // the pointer's current visual state instead.
      window.requestAnimationFrame(() => {
        if (!btn.isConnected) {
          state.labelObserver?.disconnect();
          state.labelObserver = null;
          return;
        }
        if (state.hovered) setHoveredState(btn);
        else setRestingState(btn);
      });
    });

    state.labelObserver.observe(btn, {
      childList: true,
      subtree: true,
    });
  }

  function enhance(btn) {
    let state = states.get(btn);
    if (state?.enhanced && currentChars(btn)) return state;

    state ||= {
      enhanced: false,
      hovered: false,
      timeline: null,
      labelObserver: null,
    };

    if (!window.gsap) return state;

    // bfcache / duplicate-script safety: adopt existing layers if another
    // execution already enhanced this button; otherwise build them now.
    if (!getLayers(btn)) createLayers(btn);

    state.enhanced = true;
    states.set(btn, state);
    setRestingState(btn);
    observeDynamicLabel(btn, state);
    return state;
  }

  function animate(btn, entering) {
    const state = enhance(btn);
    if (!state?.enhanced || !window.gsap) return;

    state.hovered = entering;
    killTimeline(state);

    const chars = currentChars(btn);
    if (!chars) return;

    window.gsap.killTweensOf([...chars.topChars, ...chars.bottomChars]);
    const stagger = Math.min(0.025, 0.25 / chars.topChars.length);

    const timeline = window.gsap.timeline();
    state.timeline = timeline;

    if (entering) {
      timeline
        .to(
          chars.topChars,
          { y: '-110%', stagger, duration: 0.4, ease: 'power3.inOut' },
          0,
        )
        .to(
          chars.bottomChars,
          { y: '0%', stagger, duration: 0.4, ease: 'power3.inOut' },
          0,
        );
    } else {
      timeline
        .to(
          chars.bottomChars,
          { y: '110%', stagger, duration: 0.4, ease: 'power3.inOut' },
          0,
        )
        .to(
          chars.topChars,
          { y: '0%', stagger, duration: 0.4, ease: 'power3.inOut' },
          0,
        );
    }
  }

  function bindButton(btn) {
    if (!isEligible(btn) || btn.dataset.westoButtonBound === '1') return;
    btn.dataset.westoButtonBound = '1';

    btn.addEventListener('mouseenter', () => animate(btn, true));
    btn.addEventListener('mouseleave', () => animate(btn, false));
  }

  function start() {
    // Preserve the stable site's original breakpoint semantics: a page that
    // starts at tablet/mobile width does not opt into desktop hover splitting.
    if (window.innerWidth < DESKTOP_MIN_WIDTH) return;

    document.querySelectorAll('.button').forEach(bindButton);
  }

  window.westoButtons = Object.freeze({
    enhance(btn) {
      if (!isEligible(btn)) return false;
      return Boolean(enhance(btn)?.enhanced);
    },
    refresh(btn) {
      if (!btn || !states.has(btn)) return false;
      const state = states.get(btn);
      return state.hovered ? setHoveredState(btn) : setRestingState(btn);
    },
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();

;/* ===== END js/buttons.js ===== */

/* ===== BEGIN js/table-cart.js ===== */
/* Restaurant table cart + sushi menu boards on scroll sections. */
(function () {
  const STORAGE_KEY = 'westo_table';
  const DISH_FAVORITES_KEY = 'westo_dish_favorites_v1';

  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => [...(r || document).querySelectorAll(s)];

  function perfTier() {
    return window.westoPerformance?.tier || 'balanced';
  }

  function perfQuality() {
    return window.westoPerformance?.quality || { eagerBoards: 3, normalizeSize: 512 };
  }


  // WESTO Smart Resource Scheduler bridge. The scheduler owns menu-image bytes,
  // dedupes Board/Rail/Three requests, and keeps low-priority work out of the
  // interaction lane. Native src is only the fallback when the scheduler is absent.
  function resourceScheduler() {
    return window.WestoResources || null;
  }

  function resourcePriority(name, fallback = 76) {
    return Number(resourceScheduler()?.priorities?.[name] ?? fallback);
  }

  function readyManagedSrc(src) {
    const source = String(src || '').trim();
    return resourceScheduler()?.getReadyUrl?.(source) || source;
  }

  function bindManagedImage(img, src, options = {}) {
    if (!img) return Promise.resolve(false);
    const source = String(src || '').trim();
    if (!source) {
      img.removeAttribute('src');
      delete img.dataset.source;
      delete img.dataset.expectedSource;
      delete img.dataset.appliedSource;
      return Promise.resolve(false);
    }
    const scheduler = resourceScheduler();
    if (options.progressive && scheduler?.bindProgressiveImage) {
      return scheduler.bindProgressiveImage(img, source, options);
    }
    if (scheduler?.bindImage) {
      return scheduler.bindImage(img, source, options);
    }
    img.dataset.expectedSource = source;
    img.dataset.appliedSource = source;
    img.dataset.source = source;
    img.src = source;
    return Promise.resolve(true);
  }

  function observeManagedImage(img, src, options = {}) {
    if (!img) return;
    const source = String(src || '').trim();
    if (!source) return;
    const scheduler = resourceScheduler();
    if (scheduler?.observeImage) {
      scheduler.observeImage(img, source, options);
      return;
    }
    img.dataset.expectedSource = source;
    img.dataset.appliedSource = source;
    img.dataset.source = source;
    img.src = source;
  }

  function warmManagedImage(src, options = {}) {
    const source = String(src || '').trim();
    if (!source) return Promise.resolve(null);
    const scheduler = resourceScheduler();
    if (scheduler?.requestImage) return scheduler.requestImage(source, options).catch(() => null);
    const probe = new Image();
    probe.decoding = 'async';
    probe.src = source;
    return Promise.resolve(null);
  }

  function normalizeDigits(str) {
    return String(str)
      .replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d))
      .replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
  }

  function tr(key, vars) {
    return window.westoI18n?.t ? window.westoI18n.t(key, vars) : key;
  }

  function localeTag() {
    const l = window.westoI18n?.lang || 'fa';
    return l === 'en' ? 'en-US' : l === 'ar' ? 'ar' : 'fa-IR';
  }

  function formatUiNumber(value, options = {}) {
    return window.WestoPersianFormat?.number(value, { ...options, locale: localeTag() }) ?? Number(value || 0).toLocaleString(localeTag(), options);
  }

  function formatPrice(n) {
    const unit = window.westoI18n?.t ? window.westoI18n.t('currency.toman') : 'تومان';
    return `${formatUiNumber(n)} ${unit}`;
  }

  const ALLERGEN_META = {
    gluten: { fa: 'گلوتن', en: 'Gluten', ar: 'غلوتين', terms: /گلوتن|نان|خمیر|آرد|پاستا|bread|dough|flour|pasta/i },
    dairy: { fa: 'لبنیات', en: 'Dairy', ar: 'ألبان', terms: /شیر|پنیر|خامه|کره|ماست|بستنی|milk|cheese|cream|butter|yog(?:h)?urt|ice\s*cream/i },
    egg: { fa: 'تخم‌مرغ', en: 'Egg', ar: 'بيض', terms: /تخم[‌\s-]*مرغ|مایونز|egg|mayonnaise/i },
    nuts: { fa: 'آجیل درختی', en: 'Tree nuts', ar: 'مكسرات', terms: /بادام(?![‌\s-]*زمینی)|گردو|فندق|پسته|کاجو|بادام هندی|cashew|almond|walnut|hazelnut|pistachio/i },
    peanut: { fa: 'بادام‌زمینی', en: 'Peanut', ar: 'فول سوداني', terms: /بادام[‌\s-]*زمینی|کره[‌\s-]*بادام[‌\s-]*زمینی|peanut/i },
    soy: { fa: 'سویا', en: 'Soy', ar: 'صويا', terms: /سویا|سویا[‌\s-]*سس|soy/i },
    seafood: { fa: 'دریایی / صدف', en: 'Seafood / shellfish', ar: 'مأكولات بحرية', terms: /میگو|ماهی|سالمون|تن ماهی|صدف|خرچنگ|کرب|crab|shrimp|fish|salmon|tuna|shellfish/i },
    sesame: { fa: 'کنجد', en: 'Sesame', ar: 'سمسم', terms: /کنجد|ارده|تاهینی|sesame|tahini/i },
    mustard: { fa: 'خردل', en: 'Mustard', ar: 'خردل', terms: /خردل|mustard/i },
  };

  const ALLERGEN_COPY = {
    fa: {
      title: 'آلرژن‌ها',
      contains: 'حاوی',
    },
    en: {
      title: 'Allergens',
      contains: 'Contains',
    },
    ar: {
      title: 'مسببات الحساسية',
      contains: 'يحتوي على',
    },
  };

  function activeLang() {
    const lang = window.westoI18n?.lang || document.documentElement.lang || 'fa';
    return ALLERGEN_COPY[lang] ? lang : 'fa';
  }

  function allergenIdsFor(item) {
    const found = new Set(Array.isArray(item?.allergens) ? item.allergens : []);
    const ingredients = [
      item?.name,
      item?.en,
      item?.ar,
      item?.desc,
      item?.description,
      item?.descEn,
      item?.descriptionEn,
      item?.descAr,
      item?.descriptionAr,
    ]
      .filter(Boolean)
      .join(' ');
    Object.entries(ALLERGEN_META).forEach(([id, meta]) => {
      if (meta.terms.test(ingredients)) found.add(id);
    });
    return [...found].filter((id) => ALLERGEN_META[id]);
  }

  function allergenIcon(id) {
    const common = 'fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"';
    const paths = {
      gluten: '<path d="M12 3v18M12 7c-3 0-5-1.5-6-4M12 11c-3 0-5-1.5-6-4M12 15c3 0 5-1.5 6-4M12 19c3 0 5-1.5 6-4"/>',
      dairy: '<path d="M12 3s5.5 6.4 5.5 11A5.5 5.5 0 0 1 6.5 14C6.5 9.4 12 3 12 3Z"/><path d="M9.5 15.5c.8.8 1.8 1.2 3 1.2"/>',
      egg: '<path d="M12 3c3.5 4.5 5.4 7.4 5.4 11a5.4 5.4 0 0 1-10.8 0c0-3.6 1.9-6.5 5.4-11Z"/><path d="M9.5 15c.5 1.1 1.3 1.6 2.5 1.6"/>',
      nuts: '<path d="M9 5c-2.2 1.1-3.6 3.4-3.2 6.1.3 2.1 1.8 3.8 3.8 4.4.5 2.1 2.4 3.6 4.6 3.6 2.6 0 4.8-2.1 4.8-4.8 0-1.6-.8-3-2-3.9.1-2.5-1.9-4.6-4.4-4.6-1.3 0-2.5.5-3.4 1.4"/><path d="M10 10c1 .1 1.8.5 2.5 1.3"/>',
      peanut: '<path d="M10 4.5c-2.7 0-4.5 2.1-4.5 4.6 0 1.5.6 2.8 1.8 3.6A4.5 4.5 0 0 0 12 19.5c2.7 0 4.5-2.1 4.5-4.6 0-1.5-.6-2.8-1.8-3.6A4.5 4.5 0 0 0 10 4.5Z"/><path d="M8 8.2h8M7.4 12h9.2M8 15.8h8"/>',
      soy: '<path d="M8 5.5c3.8-1 7.7 1.3 8.7 5.1 1 3.8-1.3 7.7-5.1 8.7-3.8 1-7.7-1.3-8.7-5.1-1-3.8 1.3-7.7 5.1-8.7Z"/><path d="M7.5 8.5c1.1.4 1.9 1.2 2.4 2.4M12.6 13.1c1.1.4 1.9 1.2 2.4 2.4"/>',
      seafood: '<path d="M4 12c3.3-3.4 7.3-4.5 12-3.2L20 5v14l-4-3.8c-4.7 1.3-8.7.2-12-3.2Z"/><circle cx="10" cy="11" r=".9" fill="currentColor" stroke="none"/>',
      sesame: '<path d="M8 4.5c2 0 3 1.8 3 3.8S10 12 8 12 5 10.2 5 8.3s1-3.8 3-3.8ZM16 12c2 0 3 1.8 3 3.8s-1 3.7-3 3.7-3-1.7-3-3.7 1-3.8 3-3.8ZM8 14c1.6 0 2.5 1.4 2.5 3S9.6 20 8 20s-2.5-1.4-2.5-3S6.4 14 8 14Z"/>',
      mustard: '<path d="M12 20V4M12 8c-2.8 0-4.5-1.4-5.5-3M12 12c2.8 0 4.5-1.4 5.5-3M12 16c-2.8 0-4.5-1.4-5.5-3"/><circle cx="17.5" cy="5" r="1.5"/><circle cx="6.5" cy="13" r="1.5"/>',
      info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 10.5v5.2M12 7.7h.01"/>',
    };
    return `<svg viewBox="0 0 24 24" aria-hidden="true" ${common}>${paths[id] || ''}</svg>`;
  }

  function renderAllergenPanel(item, { compact = false } = {}) {
    const lang = activeLang();
    const copy = ALLERGEN_COPY[lang];
    const ids = allergenIdsFor(item);
    if (!ids.length) return '';
    const chips = ids
      .map((id) => {
        const label = ALLERGEN_META[id][lang] || ALLERGEN_META[id].fa;
        return `<span class="menu-allergen__chip" aria-label="${escapeHtml(`${copy.contains} ${label}`)}">${allergenIcon(id)}<span>${escapeHtml(label)}</span></span>`;
      })
      .join('');
    return `<aside class="menu-allergen${compact ? ' menu-allergen--compact' : ''}" aria-label="${escapeHtml(copy.title)}">
      <div class="menu-allergen__head"><span class="menu-allergen__marker" aria-hidden="true"></span><strong>${escapeHtml(copy.title)}</strong></div>
      <div class="menu-allergen__chips">${chips}</div>
    </aside>`;
  }

  function paintBoardAllergens(sec, item) {
    if (!sec) return;
    let slot = sec.querySelector('.menu-allergen-slot');
    const addButton = sec.querySelector('[data-menu-add]');
    const action =
      addButton?.closest('.max-width-xsmall') || addButton?.closest('.menu-add-wrap');
    if (!item) {
      slot?.remove();
      return;
    }
    const markup = renderAllergenPanel(item);
    if (!markup) {
      slot?.remove();
      return;
    }
    if (!slot) {
      slot = document.createElement('div');
      slot.className = 'menu-allergen-slot';
      if (action?.parentNode) action.parentNode.insertBefore(slot, action);
    }
    if (slot && slot.__westoAllergenMarkup !== markup) {
      slot.innerHTML = markup;
      slot.__westoAllergenMarkup = markup;
    }
  }  // #endregion

  function loadCart() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      // Migrate classic-menu `{ lines: [...] }` shape → flat array
      if (raw && !Array.isArray(raw) && Array.isArray(raw.lines)) return raw.lines;
      return Array.isArray(raw) ? raw : [];
    } catch {
      return [];
    }
  }
  function saveCart(cart) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cart));
    updateBadge();
    renderCart();
    document.dispatchEvent(new CustomEvent('westo:cartchange', { detail: { cart } }));
  }

  let menuByCategory = {};
  let categoryOrder = []; // ordered category ids that actually have items
  let cart = loadCart();

  const badge = $('#table-badge');
  const drawer = $('#table-drawer');
  const linesEl = $('#table-lines');
  const emptyEl = $('#table-empty');
  const totalEl = $('#table-total');
  const checkoutBtn = $('#table-checkout-btn');
  const viewCart = $('#table-view-cart');
  const viewCheckout = $('#table-view-checkout');
  const viewDone = $('#table-view-done');

  function cartCount() {
    return cart.reduce((s, l) => s + l.qty, 0);
  }
  function cartTotal() {
    return cart.reduce((s, l) => s + l.price * l.qty, 0);
  }

  function qrTableNumber() {
    const raw = String(new URLSearchParams(location.search).get('table') || '').trim();
    if (!raw) return '';
    const normalized = normalizeDigits(raw);
    return /^\d+$/.test(normalized)
      ? Number(normalized).toLocaleString(localeTag())
      : raw.slice(0, 40);
  }

  function paintOrderContext() {
    const context = $('#cm-order-context');
    if (!context) return;
    const tableNo = qrTableNumber();
    context.hidden = !tableNo;
    if (!tableNo) return;
    const title = $('#cm-order-context-title');
    const note = $('#cm-order-context-note');
    if (title) title.textContent = tr('cart.qrContext', { n: tableNo });
    if (note) note.textContent = tr('cart.qrPrefilled');
  }

  function updateBadge() {
    if (!badge) return;
    const n = cartCount();
    const prev = Number(badge.dataset.count || 0);
    const shown = n ? n.toLocaleString(localeTag()) : '0';
    badge.textContent = shown;
    badge.dataset.count = String(n);
    badge.hidden = n === 0;
    badge.setAttribute('aria-hidden', n === 0 ? 'true' : 'false');
    badge.setAttribute('aria-live', 'polite');
    const navBtn = $('#nav-table-btn');
    if (navBtn) {
      const label = tr('cart.title');
      const tableNo = qrTableNumber();
      const contextLabel = tableNo ? `${label}، ${tr('cart.qrContext', { n: tableNo })}` : label;
      navBtn.classList.toggle('has-items', n > 0);
      navBtn.setAttribute(
        'aria-label',
        n ? `${contextLabel}، ${shown} قلم` : contextLabel,
      );
      const labelEl =
        navBtn.querySelector('[data-i18n="cart.title"]') ||
        navBtn.querySelector('.cm-table-btn__label') ||
        navBtn.querySelector('.navbar_table__label') ||
        navBtn.querySelector('div:not(.table-badge):not(.icon-embed-xsmall)');
      if (labelEl && !labelEl.classList.contains('table-badge')) {
        labelEl.textContent = label;
      }
    }
    if (n > 0 && n !== prev) {
      badge.classList.remove('is-pop');
      // restart CSS animation
      void badge.offsetWidth;
      badge.classList.add('is-pop');
    }
  }

  function toast(text) {
    let el = $('.toast-add');
    if (!el) {
      el = document.createElement('div');
      el.className = 'toast-add';
      document.body.appendChild(el);
    }
    el.textContent = text;
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 1400);
  }

  // Exposed so classic menu / overlay can add to the same table.
  window.westoTable = {
    add: (item, qty) => (qty > 1 ? addItem(item, qty) : openQtyModal(item)),
    addDirect: (item, qty) => addItem(item, qty),
    open: () => openDrawer(),
    refresh: () => {
      cart = loadCart();
      updateBadge();
      renderCart();
    },
  };

  let addFlyBusy = false;
  let pendingFlyFromEl = null;

  function resolveDishFlySource(item) {
    const active =
      document.querySelector('section.is-benefits.is-dish-active:not([hidden])') ||
      document.querySelector('section.is-benefits:not([hidden])');
    const img = active?.querySelector?.('.dish-board-media img');
    if (img) {
      const r = img.getBoundingClientRect();
      if (r.width > 12 && r.height > 12) return img;
    }
    const src = String(item?.img || item?.image || '').trim();
    if (!src) return null;
    const ghost = document.createElement('img');
    ghost.src = readyManagedSrc(src);
    ghost.alt = '';
    ghost.decoding = 'async';
    return ghost;
  }

  function ensureTableHitRing(basket) {
    if (!basket) return null;
    let ring = basket.querySelector(':scope > .westo-table-hit-ring');
    if (!ring) {
      ring = document.createElement('span');
      ring.className = 'westo-table-hit-ring';
      ring.setAttribute('aria-hidden', 'true');
      basket.appendChild(ring);
    }
    return ring;
  }

  /**
   * Motion-style add-to-basket: dish photo arcs into #nav-table-btn (GSAP).
   * Clone flies — the real plate stays put.
   */
  function playFlyToTable(item, fromEl) {
    const gsap = window.gsap;
    const basket = document.getElementById('nav-table-btn');
    if (!basket || !gsap) return Promise.resolve();
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) {
      return Promise.resolve();
    }
    if (addFlyBusy) return Promise.resolve();

    const source = fromEl || resolveDishFlySource(item);
    const srcUrl = String(
      source?.currentSrc || source?.src || item?.img || item?.image || '',
    ).trim();
    if (!srcUrl) return Promise.resolve();

    let fromRect = source?.getBoundingClientRect?.();
    if (!fromRect || fromRect.width < 8) {
      const vw = window.innerWidth || 1;
      const vh = window.innerHeight || 1;
      fromRect = {
        left: vw * 0.5 - 80,
        top: vh * 0.38 - 80,
        width: 160,
        height: 160,
        right: vw * 0.5 + 80,
        bottom: vh * 0.38 + 80,
      };
    }
    const toRect = basket.getBoundingClientRect();
    if (!toRect.width) return Promise.resolve();

    addFlyBusy = true;

    const fly = document.createElement('div');
    fly.className = 'westo-add-fly';
    fly.setAttribute('aria-hidden', 'true');
    const img = document.createElement('img');
    img.src = readyManagedSrc(srcUrl);
    img.alt = '';
    img.draggable = false;
    fly.appendChild(img);
    document.body.appendChild(fly);

    const startW = Math.min(200, Math.max(72, fromRect.width));
    const startH = Math.min(200, Math.max(72, fromRect.height));
    const fromCx = fromRect.left + fromRect.width / 2;
    const fromCy = fromRect.top + fromRect.height / 2;
    const toCx = toRect.left + toRect.width / 2;
    const toCy = toRect.top + toRect.height / 2;
    const basketBox = Math.max(28, Math.min(toRect.width, toRect.height) * 0.72);
    const flyScale = basketBox / Math.max(startW, startH);

    gsap.set(fly, {
      position: 'fixed',
      left: fromCx,
      top: fromCy,
      width: startW,
      height: startH,
      xPercent: -50,
      yPercent: -50,
      x: 0,
      y: 0,
      scale: 1,
      opacity: 1,
      rotate: 0,
      transformOrigin: '50% 50%',
      zIndex: 12050,
    });

    const dx = toCx - fromCx;
    const dy = toCy - fromCy;
    const dist = Math.hypot(dx, dy) || 1;
    const strength = 0.5;
    const peak = 0.15;
    const bulge = dist * strength;
    const peakX = fromCx + dx * peak;
    const peakY = fromCy + dy * peak;
    // Prefer an upward arc into the navbar table button.
    let side = 1;
    const nX = dy / dist;
    const nY = -dx / dist;
    if (peakY + nY * bulge > Math.min(fromCy, toCy) - 8) side = -1;
    const c1x = peakX + nX * bulge * side;
    const c1y = peakY + nY * bulge * side;

    const proxy = { t: 0 };
    const duration = 0.48;
    const ease = 'power3.inOut';

    const ring = ensureTableHitRing(basket);
    if (ring) gsap.set(ring, { scale: 1, opacity: 0 });

    return new Promise((resolve) => {
      let prevX = fromCx;
      let prevY = fromCy;
      let velX = 0;
      let velY = 0;

      gsap.to(proxy, {
        t: 1,
        duration,
        ease,
        overwrite: true,
        onUpdate: () => {
          const t = proxy.t;
          const u = 1 - t;
          const x = u * u * fromCx + 2 * u * t * c1x + t * t * toCx;
          const y = u * u * fromCy + 2 * u * t * c1y + t * t * toCy;
          velX = (x - prevX) / (1 / 60);
          velY = (y - prevY) / (1 / 60);
          prevX = x;
          prevY = y;
          // Tangent rotate (Motion rotate≈0.9)
          const tx = 2 * u * (c1x - fromCx) + 2 * t * (toCx - c1x);
          const ty = 2 * u * (c1y - fromCy) + 2 * t * (toCy - c1y);
          const ang = (Math.atan2(ty, tx) * 180) / Math.PI;
          const scale = gsap.utils.interpolate(1, flyScale, t);
          const opacity = t < 0.92 ? 1 : gsap.utils.interpolate(1, 0, (t - 0.92) / 0.08);
          gsap.set(fly, {
            left: x,
            top: y,
            scale,
            opacity,
            rotate: ang * 0.9,
          });
        },
        onComplete: () => {
          fly.remove();
          const knock = 0.05;
          gsap.fromTo(
            basket,
            { x: velX * knock, y: velY * knock },
            {
              x: 0,
              y: 0,
              duration: 0.55,
              ease: 'elastic.out(1, 0.45)',
              overwrite: true,
            },
          );
          if (ring) {
            gsap.fromTo(
              ring,
              { scale: 1, opacity: 0.85 },
              {
                scale: 2.15,
                opacity: 0,
                duration: 0.5,
                ease: 'power2.out',
                overwrite: true,
              },
            );
          }
          try {
            window.westoSound?.play?.('click', { volume: 0.7 });
          } catch (_) {}
          addFlyBusy = false;
          resolve();
        },
      });
    });
  }

  function addItem(item, qty, opts = {}) {
    const q = Math.max(1, Math.min(99, Math.round(Number(qty) || 1)));
    const existing = cart.find((l) => l.menuItemId === item.id);
    if (existing) {
      existing.qty += q;
      if (!existing.img && (item.img || item.image)) existing.img = item.img || item.image || '';
      if (!existing.desc && (item.desc || item.description)) {
        existing.desc = item.desc || item.description || '';
      }
      if (
        (!Array.isArray(existing.allergens) || !existing.allergens.length) &&
        Array.isArray(item.allergens)
      ) {
        existing.allergens = item.allergens;
      }
      if (!existing.categoryId && item.categoryId != null) existing.categoryId = item.categoryId;
    } else
      cart.push({
        menuItemId: item.id,
        name: item.name,
        price: item.price,
        qty: q,
        en: item.en,
        ar: item.ar,
        img: item.img || item.image || '',
        desc: item.desc || item.description || '',
        descEn: item.descEn || item.descriptionEn || '',
        descAr: item.descAr || item.descriptionAr || '',
        allergens: Array.isArray(item.allergens) ? item.allergens : [],
        categoryId: item.categoryId ?? null,
      });
    saveCart(cart);
    const displayName = window.westoI18n?.itemName ? window.westoI18n.itemName(item) : item.name;
    toast((q > 1 ? `${q.toLocaleString(localeTag())}× ` : '') + displayName);
    if (!opts.skipFly) {
      playFlyToTable(item, opts.fromEl || pendingFlyFromEl || resolveDishFlySource(item));
    }
    pendingFlyFromEl = null;
  }

  function setQty(id, qty) {
    const line = cart.find((l) => l.menuItemId === id);
    if (!line) return;
    if (qty <= 0) cart = cart.filter((l) => l.menuItemId !== id);
    else line.qty = qty;
    saveCart(cart);
  }

  function lineDisplayName(l) {
    return window.westoI18n?.itemName
      ? window.westoI18n.itemName({ name: l.name, en: l.en, ar: l.ar })
      : l.name;
  }

  function findMenuItem(id) {
    const nid = Number(id);
    for (const list of Object.values(menuByCategory || {})) {
      const hit = (list || []).find((m) => Number(m.id) === nid);
      if (hit) return hit;
    }
    try {
      const store = window.westoMenuStore;
      const items = store?.data?.menuItems || store?.items || [];
      return (items || []).find((m) => Number(m.id) === nid) || null;
    } catch (_) {
      return null;
    }
  }

  function enrichCartLine(l) {
    const item = findMenuItem(l.menuItemId);
    const img = l.img || item?.img || item?.image || '';
    const desc =
      l.desc ||
      item?.desc ||
      item?.description ||
      '';
    const descEn = l.descEn || item?.descEn || item?.descriptionEn || '';
    const descAr = l.descAr || item?.descAr || item?.descriptionAr || '';
    const allergens = Array.isArray(l.allergens)
      ? l.allergens
      : Array.isArray(item?.allergens)
        ? item.allergens
        : [];
    const categoryId = l.categoryId ?? item?.categoryId ?? null;
    // Persist enrichments so offline redraws keep photos
    if (img && !l.img) l.img = img;
    if (desc && !l.desc) l.desc = desc;
    if (descEn && !l.descEn) l.descEn = descEn;
    if (descAr && !l.descAr) l.descAr = descAr;
    if (allergens.length && !Array.isArray(l.allergens)) l.allergens = allergens;
    if (categoryId != null && l.categoryId == null) l.categoryId = categoryId;
    return { ...l, img, desc, descEn, descAr, allergens, categoryId, item };
  }

  function lineDisplayDesc(l) {
    if (window.westoI18n?.itemDesc) {
      return (
        window.westoI18n.itemDesc({
          desc: l.desc,
          descEn: l.descEn,
          descAr: l.descAr,
        }) || ''
      );
    }
    const lang = window.westoI18n?.lang || document.documentElement.lang || 'fa';
    if (lang === 'en' && l.descEn) return l.descEn;
    if (lang === 'ar' && l.descAr) return l.descAr;
    return l.desc || '';
  }

  function categoryLabelForLine(l) {
    const id = l.categoryId;
    if (id == null) return '';
    try {
      if (typeof categoryLabelFor === 'function') return categoryLabelFor(id) || '';
    } catch (_) {}
    return '';
  }

  function renderCart() {
    if (!linesEl) return;
    let enriched = false;
    cart.forEach((l) => {
      const before = `${l.img || ''}|${l.desc || ''}|${l.categoryId ?? ''}`;
      enrichCartLine(l);
      const after = `${l.img || ''}|${l.desc || ''}|${l.categoryId ?? ''}`;
      if (before !== after) enriched = true;
    });
    if (enriched) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(cart));
      } catch (_) {}
    }
    const removeLabel = tr('cart.remove');
    const decLabel = tr('cart.dec');
    const incLabel = tr('cart.inc');
    linesEl.innerHTML = cart
      .map((raw) => {
        const l = enrichCartLine(raw);
        const name = lineDisplayName(l);
        const desc = lineDisplayDesc(l);
        const cat = categoryLabelForLine(l);
        const img = l.img || '';
        const unit = formatPrice(l.price);
        const lineTotal = formatPrice(l.price * l.qty);
        const qtyStr = l.qty.toLocaleString(localeTag());
        const allergenSummary = allergenIdsFor(l.item || l).length
          ? renderAllergenPanel(l.item || l, { compact: true })
          : '';
        const media = img
          ? `<img class="table-line__thumb" src="${escapeHtml(img)}" alt="" loading="lazy" decoding="async" />`
          : `<span class="table-line__thumb table-line__thumb--empty" aria-hidden="true"></span>`;
        return `
      <article class="table-line" data-id="${l.menuItemId}">
        <div class="table-line__media">${media}</div>
        <div class="table-line__body">
          <div class="table-line__top">
            <div class="table-line__titles">
              ${cat ? `<span class="table-line__cat">${escapeHtml(cat)}</span>` : ''}
              <h3 class="table-line__name">${escapeHtml(name)}</h3>
            </div>
            <button type="button" class="table-line__remove" data-rm="${l.menuItemId}" aria-label="${escapeHtml(removeLabel)}" title="${escapeHtml(removeLabel)}">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 7h14M10 7V5h4v2m-6 3v8m4-8v8M7 7l1 12a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2l1-12" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
          </div>
          ${desc ? `<p class="table-line__desc">${escapeHtml(desc)}</p>` : ''}
          ${allergenSummary}
          <div class="table-line__foot">
            <div class="table-line__prices">
              <span class="table-line__unit">${escapeHtml(unit)} × ${qtyStr}</span>
              <strong class="table-line__price">${escapeHtml(lineTotal)}</strong>
            </div>
            <div class="table-line__qty" role="group" aria-label="${escapeHtml(tr('cart.qty'))}">
              <button type="button" data-dec="${l.menuItemId}" aria-label="${escapeHtml(decLabel)}">−</button>
              <span aria-live="polite">${qtyStr}</span>
              <button type="button" data-inc="${l.menuItemId}" aria-label="${escapeHtml(incLabel)}">+</button>
            </div>
          </div>
        </div>
      </article>`;
      })
      .join('');
    if (emptyEl) {
      emptyEl.hidden = cart.length > 0;
      const parts = String(tr('cart.empty')).split('\n');
      emptyEl.innerHTML = `${escapeHtml(parts[0] || '')}${
        parts[1] ? `<br/><span class="table-empty__hint">${escapeHtml(parts[1])}</span>` : ''
      }`;
    }
    if (totalEl) totalEl.textContent = formatPrice(cartTotal());
    if (checkoutBtn) checkoutBtn.disabled = cart.length === 0;
    paintTableChrome();
    const foot = $('.table-cart-foot');
    if (foot) foot.hidden = cart.length === 0;
    const countEl = $('#table-cart-count');
    if (countEl) {
      const n = cartCount();
      countEl.hidden = n === 0;
      countEl.textContent = n
        ? tr('cart.itemsCount', { n: n.toLocaleString(localeTag()) })
        : '';
    }

    linesEl.querySelectorAll('[data-inc]').forEach((b) =>
      b.addEventListener('click', () => {
        const id = Number(b.dataset.inc);
        const line = cart.find((l) => l.menuItemId === id);
        if (line) setQty(id, line.qty + 1);
      }),
    );
    linesEl.querySelectorAll('[data-dec]').forEach((b) =>
      b.addEventListener('click', () => {
        const id = Number(b.dataset.dec);
        const line = cart.find((l) => l.menuItemId === id);
        if (line) setQty(id, line.qty - 1);
      }),
    );
    linesEl.querySelectorAll('[data-rm]').forEach((b) =>
      b.addEventListener('click', () => {
        const id = Number(b.dataset.rm);
        setQty(id, 0);
      }),
    );
  }

  function paintTableChrome() {
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      if (el.closest('#westo-entrance')) return;
      const key = el.getAttribute('data-i18n');
      if (key) el.textContent = tr(key);
    });
    const back = $('#westo-back-categories');
    if (back) {
      back.setAttribute('aria-label', tr('nav.categories'));
      const lab = back.querySelector('.westo-back-categories__label');
      if (lab) lab.textContent = tr('nav.categories');
    }
    const menuLabel = document.querySelector('.navbar_menu-button .text-block');
    if (menuLabel) menuLabel.textContent = tr('nav.menu');
    const auth = $('#nav-auth-btn div');
    if (auth) auth.textContent = tr('nav.login');
    const scrollHint = document.querySelector('.scroll_discover');
    if (scrollHint) {
      scrollHint.textContent = tr('hero.scroll');
      const spread = Math.max(28, (scrollHint.textContent || '').trim().length * 2);
      scrollHint.style.setProperty('--shimmer-spread', `${spread}px`);
    }
    const linkCats = document.querySelector('.navbar_link[href="#gamme"] .navbar_link-label');
    if (linkCats) linkCats.textContent = tr('nav.categories');
    const drawerTitle = $('.table-drawer__head h2');
    if (drawerTitle) drawerTitle.textContent = tr('cart.title');
    const drawerPanel = $('#table-drawer')?.querySelector('.table-drawer__panel');
    if (drawerPanel) drawerPanel.setAttribute('aria-label', tr('cart.title'));
    paintOrderContext();
    updateBadge();
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  let scrollLockDepth = 0;
  let bodyOverflowBeforeLock = '';
  function lockScroll() {
    if (scrollLockDepth === 0) {
      bodyOverflowBeforeLock = document.body.style.overflow || '';
      document.body.style.overflow = 'hidden';
      if (window.lenis && typeof window.lenis.stop === 'function') window.lenis.stop();
    }
    scrollLockDepth += 1;
  }
  function unlockScroll() {
    scrollLockDepth = Math.max(0, scrollLockDepth - 1);
    const qtyOpen = document.getElementById('qty-modal') && !document.getElementById('qty-modal').hidden;
    const drawerOpen = drawer && !drawer.hidden;
    if (qtyOpen || drawerOpen || scrollLockDepth > 0) return;
    document.body.style.overflow = bodyOverflowBeforeLock;
    bodyOverflowBeforeLock = '';
    if (window.lenis && typeof window.lenis.start === 'function') window.lenis.start();
  }

  function focusablesIn(container) {
    if (!container) return [];
    return Array.from(container.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')).filter((el) => !el.hidden && el.getClientRects().length);
  }
  function trapFocus(event, container) {
    if (event.key !== 'Tab' || !container) return false;
    const list = focusablesIn(container);
    if (!list.length) { event.preventDefault(); return true; }
    const first=list[0], last=list[list.length-1];
    if (event.shiftKey && document.activeElement===first) { event.preventDefault(); last.focus({preventScroll:true}); return true; }
    if (!event.shiftKey && document.activeElement===last) { event.preventDefault(); first.focus({preventScroll:true}); return true; }
    return false;
  }

  function syncDrawerViewport() {
    if (!drawer || drawer.hidden) return;
    const vv = window.visualViewport;
    if (!vv) {
      drawer.style.removeProperty('--vv-height');
      drawer.classList.remove('is-keyboard-open');
      return;
    }
    const full = window.innerHeight || 0;
    const keyboardOpen = vv.height < full - 80;
    drawer.classList.toggle('is-keyboard-open', keyboardOpen);
    if (keyboardOpen) {
      drawer.style.setProperty('--vv-height', `${Math.round(vv.height)}px`);
    } else {
      drawer.style.removeProperty('--vv-height');
    }
  }

  function bindDrawerViewport() {
    if (!drawer || bindDrawerViewport._done) return;
    bindDrawerViewport._done = true;
    const sync = () => syncDrawerViewport();
    window.visualViewport?.addEventListener('resize', sync, { passive: true });
    window.visualViewport?.addEventListener('scroll', sync, { passive: true });
    window.addEventListener('resize', sync, { passive: true });
    drawer.addEventListener('focusin', sync);
    drawer.addEventListener('focusout', () => setTimeout(sync, 80));
  }

  function syncQtyViewport() {
    if (!qtyModal || qtyModal.hidden) return;
    const vv = window.visualViewport;
    if (!vv) { qtyModal.style.removeProperty('--vv-height'); qtyModal.classList.remove('is-keyboard-open'); return; }
    const full = window.innerHeight || 0;
    const keyboardOpen = vv.height < full - 80;
    qtyModal.classList.toggle('is-keyboard-open', keyboardOpen);
    if (keyboardOpen) qtyModal.style.setProperty('--vv-height', `${Math.round(vv.height)}px`);
    else qtyModal.style.removeProperty('--vv-height');
  }
  function bindQtyViewport() {
    if (!qtyModal || bindQtyViewport._done) return;
    bindQtyViewport._done = true;
    const sync = () => syncQtyViewport();
    window.visualViewport?.addEventListener('resize', sync, { passive: true });
    window.visualViewport?.addEventListener('scroll', sync, { passive: true });
    window.addEventListener('resize', sync, { passive: true });
  }

  let drawerFocusBeforeOpen = null;

  function openDrawer() {
    if (!drawer) return;
    const wasHidden = drawer.hidden;
    if (wasHidden) drawerFocusBeforeOpen = document.activeElement;
    showView('cart');
    drawer.hidden = false;
    const panel = drawer.querySelector('.table-drawer__panel');
    if (panel) panel.setAttribute('aria-modal', 'true');
    if (wasHidden) lockScroll();
    bindDrawerViewport();
    syncDrawerViewport();
    if (wasHidden) {
      const closeBtn = drawer.querySelector('.table-drawer__close');
      if (closeBtn) closeBtn.focus({ preventScroll: true });
    }
  }
  function closeDrawer() {
    if (!drawer) return;
    drawer.hidden = true;
    drawer.querySelector('.table-drawer__panel')?.removeAttribute('aria-modal');
    drawer.classList.remove('is-keyboard-open');
    drawer.style.removeProperty('--vv-height');
    unlockScroll();
    const back = drawerFocusBeforeOpen;
    drawerFocusBeforeOpen = null;
    if (back?.isConnected && typeof back.focus === 'function') {
      try {
        back.focus({ preventScroll: true });
      } catch (_) {}
    }
  }
  function showView(name) {
    if (viewCart) viewCart.hidden = name !== 'cart';
    if (viewCheckout) viewCheckout.hidden = name !== 'checkout';
    if (viewDone) viewDone.hidden = name !== 'done';
    const head = drawer?.querySelector('.table-drawer__head h2');
    if (head) {
      head.textContent =
        name === 'checkout' ? tr('cart.paymentTitle') : name === 'done' ? tr('cart.doneTitle') : tr('cart.title');
    }
    if (name === 'checkout') {
      const first = $('#order-table');
      if (first) first.focus({ preventScroll: true });
    } else if (name === 'cart') {
      const foot = $('#table-checkout-btn');
      if (foot && !foot.disabled) foot.focus({ preventScroll: true });
    } else if (name === 'done') {
      const close = viewDone?.querySelector('[data-table-close]');
      if (close) close.focus({ preventScroll: true });
    }
  }

  // --- fill scroll boards from menu ---
  // Hero cans = categories; each benefits section = one dish of active category.
  // Live TopMenu categories can grow beyond the old 15-item snapshot (cold
  // bar currently has 25). Keep a corruption guard, not a product-data cap;
  // media beyond the eager budget stays deferred by the performance profile.
  const MAX_DISH_BOARDS = 250;
  let lastVisibleCount = -1;
  let lastFilledCategoryId = null;
  let boardsBuiltFor = null;
  let allDishBoardsCache = null;
  let dishLayoutRefreshRaf = 0;

  const allDishBoards = () => {
    if (!allDishBoardsCache || allDishBoardsCache.some((board) => !board.isConnected)) {
      allDishBoardsCache = $$('section.is-benefits');
    }
    return allDishBoardsCache;
  };

  function setBoardVisibility(sec, visible) {
    if (!sec) return;
    if (visible) {
      if (sec.hasAttribute('hidden')) sec.removeAttribute('hidden');
      if (sec.style.display === 'none') sec.style.display = '';
    } else {
      if (!sec.hasAttribute('hidden')) sec.setAttribute('hidden', '');
      if (sec.style.display !== 'none') sec.style.display = 'none';
    }
  }

  function setTextIfChanged(el, value) {
    if (!el) return;
    const next = value == null ? '' : String(value);
    if (el.textContent !== next) el.textContent = next;
  }

  function setAttrIfChanged(el, name, value) {
    if (!el) return;
    const next = value == null ? '' : String(value);
    if (el.getAttribute(name) !== next) el.setAttribute(name, next);
  }

  function setStyleIfChanged(el, name, value) {
    if (!el) return;
    const next = value == null ? '' : String(value);
    if (el.style[name] !== next) el.style[name] = next;
  }

  function scheduleDishLayoutRefresh() {
    if (dishLayoutRefreshRaf) return;
    dishLayoutRefreshRaf = requestAnimationFrame(() => {
      dishLayoutRefreshRaf = 0;
      dishBoardsCache = null;
      dishBoardMetrics = null;
      if (window.westoRelayout) window.westoRelayout();
      else if (window.ScrollTrigger) window.ScrollTrigger.refresh();
      if (window.westoRefreshBenefits) window.westoRefreshBenefits();
      // Measure once after all writes/ScrollTrigger work has committed. Scroll
      // ticks then use cached absolute geometry instead of N rect reads/frame.
      requestAnimationFrame(() => {
        refreshDishBoardsCache();
        scheduleDishViewportState();
      });
    });
  }

  function ensureDishBoards(count) {
    const n = Math.max(1, Math.min(MAX_DISH_BOARDS, count || 1));
    const main = document.querySelector('main.main-wrapper') || document.querySelector('main');
    const anchor = document.querySelector('.section.is-argument');
    if (!main || !anchor) return;

    // Promote legacy extra divs to sections
    const legacyExtras = $$('.is-benefits-extra');
    legacyExtras.forEach((el) => {
      if (el.tagName === 'DIV') {
        const sec = document.createElement('section');
        sec.className = 'section is-benefits';
        sec.id = el.id || '';
        if (el.dataset.menuSlot != null) sec.dataset.menuSlot = el.dataset.menuSlot;
        sec.innerHTML = el.innerHTML;
        el.replaceWith(sec);
      } else {
        el.classList.add('section', 'is-benefits');
        el.classList.remove('is-benefits-extra');
      }
    });
    if (legacyExtras.length) allDishBoardsCache = null;

    const boards = allDishBoards();
    const template = boards[0];
    if (!template) return;

    if (boards.length < n) {
      const fragment = document.createDocumentFragment();
      const start = boards.length;
      for (let i = start; i < n; i += 1) {
      const clone = template.cloneNode(true);
        clone.id = `benefits-${i + 1}`;
        clone.dataset.menuSlot = String(i);
      // strip w--current from cloned nav links
      clone.querySelectorAll('.w--current, .is-active').forEach((a) => {
        a.classList.remove('w--current', 'is-active');
      });
        fragment.appendChild(clone);
        boards.push(clone);
      }
      main.insertBefore(fragment, anchor);
    }

    boards.forEach((sec, i) => {
      const slot = String(i);
      const id = `benefits-${i + 1}`;
      if (sec.dataset.menuSlot !== slot) sec.dataset.menuSlot = slot;
      if (sec.id !== id) sec.id = id;
      setBoardVisibility(sec, i < n);
    });

    // Sync side nav icons on the shared dish rail
    const rail = hoistDishRail() || dishRailNav();
    if (rail) {
      const icons = $$('.benefits_icon-wrapper', rail);
      const iconTpl = icons[0];
      if (iconTpl) {
        if (icons.length < n) {
          const fragment = document.createDocumentFragment();
          const separatorTemplate = rail.querySelector('.benefits_icon-separator');
          for (let i = icons.length; i < n; i += 1) {
          const a = iconTpl.cloneNode(true);
          a.classList.remove('is-active', 'w--current');
            if (separatorTemplate) fragment.appendChild(separatorTemplate.cloneNode(true));
            fragment.appendChild(a);
            icons.push(a);
          }
          rail.appendChild(fragment);
        }
        icons.forEach((a, i) => {
          const href = `#benefits-${i + 1}`;
          if (a.getAttribute('href') !== href) a.setAttribute('href', href);
          const nextDisplay = i < n ? '' : 'none';
          if (a.style.display !== nextDisplay) a.style.display = nextDisplay;
          a.classList.toggle('is-active', i === 0);
          a.classList.toggle('w--current', i === 0);
          ensureRailAnimatedBorder(a);
        });
      }
    }

    if (boardsBuiltFor !== n) {
      boardsBuiltFor = n;
      scheduleDishLayoutRefresh();
    }
  }

  function reanchorDishScroll() {
    if (!window.lenis) return;
    const vis = dishBoardsCache?.length ? dishBoardsCache : refreshDishBoardsCache();
    if (!vis.length) return;
    const y = window.lenis.scroll;
    const firstTop = dishBoardMetrics?.[0]?.top ?? vis[0].offsetTop;
    if (y < firstTop - window.innerHeight * 0.3) return; // still in hero / profile

    const last = vis[vis.length - 1];
    const lastMetric = dishBoardMetrics?.[dishBoardMetrics.length - 1];
    const lastEnd = lastMetric ? lastMetric.top + lastMetric.height * 0.55 : last.offsetTop + last.offsetHeight * 0.55;
    const active = document.querySelector('section.is-benefits.is-dish-active');
    const activeBad = active && (active.hasAttribute('hidden') || active.style.display === 'none');

    if (y > lastEnd || activeBad) {
      let idx = vis.length - 1;
      if (active && !activeBad) {
        idx = Math.min(Number(active.dataset.menuSlot) || 0, vis.length - 1);
      } else if (activeBad) {
        idx = Math.min(Number(active.dataset.menuSlot) || 0, vis.length - 1);
      }
      window.lenis.scrollTo(vis[idx], { immediate: true, offset: 0 });
    }
  }

  function categoryLabelFor(categoryId) {
    const order = window.__westoCategoryOrder?.length ? window.__westoCategoryOrder : categoryOrder;
    const idx = order.indexOf(categoryId);
    const hero = document.querySelectorAll('.carousel_list.is-hero .carousel_slide')[idx];
    if (!hero) return '';
    const fa = hero.getAttribute('data-cat-fa');
    if (fa && window.westoI18n?.catTitleFromFa) return window.westoI18n.catTitleFromFa(fa);
    const title = hero.querySelector('.heading-style-h2')?.textContent;
    return title ? title.replace(/\s+/g, ' ').trim() : '';
  }

  function clearMediaInlineFx(media) {
    if (!media) return;
    const style = media.style;
    if (!style.opacity && !style.visibility && !style.transform) return;
    style.removeProperty('opacity');
    style.removeProperty('visibility');
    style.removeProperty('transform');
    // GSAP caches transform components. Mark the cache stale without invoking
    // gsap.set(), which was a large self-time/style-recalc source in the trace.
    try {
      const cache = window.gsap?.core?.getCache?.(media);
      if (cache) cache.uncache = 1;
    } catch (_) {}
  }

  function setBoardMedia(sec, imageSrc, options = {}) {
    if (!sec) return;
    const mediaHost = sec.querySelector('.benefits_container');
    let media = sec.querySelector('.dish-board-media');
    if (!imageSrc) {
      delete sec.dataset.boardImageSrc;
      delete sec.dataset.mediaDeferred;
      if (!media) return;
      media.classList.add('is-empty-media');
      media.hidden = true;
      media.setAttribute('hidden', '');
      const image = media.querySelector('img');
      if (image) {
        delete image.dataset.source;
        delete image.dataset.expectedSource;
        delete image.dataset.appliedSource;
        delete image.dataset.imageMode;
        delete image.dataset.decodeWarm;
        image.removeAttribute('src');
        image.classList.remove('is-image-frame', 'is-image-cutout');
      }
      return;
    }
    sec.dataset.boardImageSrc = imageSrc;
    if (options.defer) {
      sec.dataset.mediaDeferred = '1';
      const current = media?.querySelector('img');
      if (media) {
        media.hidden = true;
        media.setAttribute('hidden', '');
        media.classList.add('is-empty-media');
      }
      // Keep the existing decoded <img> parked while off-screen. Clearing and
      // recreating it on every category switch caused avoidable DOM/image churn;
      // the generation token will replace it safely when this slot becomes hot.
      if (current?.dataset.appliedSource === imageSrc || current?.dataset.expectedSource === imageSrc) return;
      return;
    }
    delete sec.dataset.mediaDeferred;
    if (!media && mediaHost) {
      media = document.createElement('figure');
      media.className = 'dish-board-media';
      media.setAttribute('aria-hidden', 'true');
      mediaHost.insertBefore(media, mediaHost.firstChild);
    }
    if (!media) return;
    // Stamp identity before paint so late async applies can reject mismatches.
    const catId = sec.dataset.categoryId || '';
    const itemId = sec.dataset.itemId || '';
    media.classList.remove('is-empty-media');
    media.hidden = false;
    media.removeAttribute('hidden');
    clearMediaInlineFx(media);
    let image = media.querySelector('img');
    if (!image) {
      image = document.createElement('img');
      image.decoding = 'async';
      image.alt = '';
      media.appendChild(image);
    }
    const stillMine = () =>
      (sec.dataset.categoryId || '') === catId && (sec.dataset.itemId || '') === itemId;
    const alreadyApplied = image.dataset.appliedSource === imageSrc && Boolean(image.getAttribute('src'));
    const alreadyPending = image.dataset.expectedSource === imageSrc && image.dataset.appliedSource !== imageSrc;
    if (!alreadyApplied && !alreadyPending) {
      image.dataset.expectedSource = imageSrc;
      image.dataset.imageMode = 'cutout';
      image.classList.remove('is-image-frame');
      image.classList.add('is-image-cutout');
      const slot = Math.max(0, Number(sec.dataset.menuSlot) || 0);
      const priority = slot === activeViewportSlot
        ? resourcePriority('CURRENT', 115)
        : slot === activeViewportSlot + 1
          ? resourcePriority('NEXT', 108)
          : resourcePriority('VISIBLE', 92);
      void bindManagedImage(image, imageSrc, {
        priority,
        group: `cat:${catId || lastFilledCategoryId || 'unknown'}:board`,
        loading: slot <= activeViewportSlot + 1 ? 'eager' : 'lazy',
        decode: true,
        progressive: true,
      }).then((ok) => {
        // Aborts/preemption are allowed, but they must not leave an eternal
        // "pending" stamp that prevents the active media healer from retrying.
        if (!ok && stillMine() && image.dataset.appliedSource !== imageSrc && image.dataset.expectedSource === imageSrc) {
          delete image.dataset.expectedSource;
        }
      }).catch(() => {
        if (stillMine() && image.dataset.appliedSource !== imageSrc && image.dataset.expectedSource === imageSrc) {
          delete image.dataset.expectedSource;
        }
      });
    }
    if (!image.dataset.decodeWarm) {
      image.dataset.decodeWarm = '1';
      image.addEventListener('load', () => {
        if (!stillMine()) return;
        // warmDishImage owns decode scheduling. Do not decode here and then
        // create a second off-DOM probe for the same resource.
        warmDishImage(sec);
      });
    }
  }

  function killDishSwitchTl() {
    if (!dishSwitchTl) return;
    dishSwitchTl.kill();
    dishSwitchTl = null;
    document
      .querySelectorAll('section.is-benefits.is-dish-leaving, section.is-benefits.is-dish-switching, section.is-benefits.is-dish-prewarm')
      .forEach(clearDishFx);
  }

  /** If stamp/src was lost but the board still has an item, repaint the plate. */
  function healActiveBoardMedia(sec, { force = false } = {}) {
    // During photo-fly, orbs own food pixels — never flash dish media underneath.
    if (
      !force &&
      document.documentElement.classList.contains('is-cat-flying')
    ) {
      return;
    }
    if (!sec || sec.dataset.emptyCat === '1') return;
    const itemId = sec.dataset.itemId;
    const catId = sec.dataset.categoryId;
    if (!itemId || catId == null || catId === '') return;
    const items = menuByCategory[catId] || menuByCategory[Number(catId)] || [];
    const item = items.find((m) => String(m.id) === String(itemId)) || items[Number(sec.dataset.menuSlot)];
    const src = item?.img || item?.image || '';
    if (!src) return;
    const media = sec.querySelector('.dish-board-media');
    const img = media?.querySelector('img');
    const missing =
      !media ||
      media.hidden ||
      media.classList.contains('is-empty-media') ||
      !img ||
      (!img.getAttribute('src') && !img.dataset.appliedSource);
    const mismatched = Boolean(img) && img.dataset.appliedSource !== src;
    const pendingCorrectSource = Boolean(img) && img.dataset.expectedSource === src && img.dataset.appliedSource !== src;
    if (missing || (mismatched && !pendingCorrectSource)) setBoardMedia(sec, src);
    else if (!pendingCorrectSource) clearMediaInlineFx(media);
  }

  function fillBoards(categoryId) {
    if (!document.querySelector('section.is-benefits')) return;
    if (window.westoCategoryTheme?.apply && categoryId != null) {
      window.westoCategoryTheme.apply(categoryId);
    }
    try {
      window.dispatchEvent(
        new CustomEvent('westo:category-focus', { detail: { categoryId: Number(categoryId) } }),
      );
    } catch (_) {}
    const items = menuByCategory[categoryId] || [];
    const emptyCat = !items.length;
    ensureDishBoards(emptyCat ? 1 : items.length || 1);
    const catName = categoryLabelFor(categoryId);
    const emptyLabel =
      (window.westoI18n?.t && window.westoI18n.t('dish.empty')) ||
      tr('dish.empty') ||
      'هنوز غذایی نیست';

    const categoryChanged = categoryId != null && categoryId !== lastFilledCategoryId;
    if (categoryChanged && Number(resourceScheduler()?.currentCategory) !== Number(categoryId)) {
      resourceScheduler()?.focusCategory?.(categoryId, { reason: 'fill-boards', slot: 0 });
    }
    if (categoryChanged) {
      const onDishesNow = document.documentElement.classList.contains('is-dish-boards');
      // Cancel at most one active switch timeline. The old path then cleared
      // every board a second time with gsap.set(), even though most boards had
      // no inline FX. Keep existing decoded media until each slot is reassigned.
      if (dishSwitchTl) killDishSwitchTl();
      else {
        document
          .querySelectorAll('section.is-benefits.is-dish-leaving, section.is-benefits.is-dish-switching, section.is-benefits.is-dish-prewarm')
          .forEach(clearDishFx);
      }
      if (onDishesNow) {
        activeViewportSlot = 0;
        syncDishRailActive(0);
      }
    }

    let visible = 0;
    allDishBoards().forEach((sec) => {
      const slot = Number(sec.dataset.menuSlot);
      const item = emptyCat && slot === 0 ? null : items[slot];
      const nameEl = sec.querySelector('[data-menu-name]');
      const descEl = sec.querySelector('[data-menu-desc]');
      const priceEl = sec.querySelector('[data-menu-price]');
      const addBtn = sec.querySelector('[data-menu-add]');

      if (emptyCat && slot === 0) {
        setBoardVisibility(sec, true);
        sec.dataset.emptyCat = '1';
        sec.dataset.categoryId = String(categoryId ?? '');
        delete sec.dataset.itemId;
        visible += 1;
        setTextIfChanged(nameEl, emptyLabel);
        setTextIfChanged(descEl, catName || '');
        setTextIfChanged(priceEl, '');
        if (addBtn) {
          ensureGlassButtonChrome(addBtn.closest('.glass-button-wrap') || addBtn);
          addBtn.disabled = true;
          delete addBtn.dataset.itemId;
          setGlassButtonLabel(addBtn, emptyLabel);
        }
        setBoardMedia(sec, null);
        paintBoardAllergens(sec, null);
        let catEl = sec.querySelector('[data-menu-category]');
        if (!catEl) {
          const host = sec.querySelector('.subhead_wrapper') || sec.querySelector('.benefits_text');
          if (host) {
            catEl = document.createElement('div');
            catEl.className = 'menu-cat-label';
            catEl.setAttribute('data-menu-category', '');
            host.parentNode.insertBefore(catEl, host);
          }
        }
        setTextIfChanged(catEl, catName);
        hoistDishRail();
        const nav = dishRailNav();
        if (nav) {
          nav.setAttribute('aria-label', catName ? `${tr('cart.dishesOf')} ${catName}` : tr('cart.dishesHere'));
          $$('.benefits_icon-wrapper', nav).forEach((a) => {
            a.style.display = 'none';
          });
          $$('.benefits_icon-separator', nav).forEach((sep) => {
            sep.style.display = 'none';
          });
        }
        return;
      }

      if (!item || slot >= MAX_DISH_BOARDS) {
        setBoardVisibility(sec, false);
        delete sec.dataset.emptyCat;
        delete sec.dataset.categoryId;
        delete sec.dataset.itemId;
        setBoardMedia(sec, null);
        paintBoardAllergens(sec, null);
        return;
      }

      setBoardVisibility(sec, true);
      delete sec.dataset.emptyCat;
      sec.dataset.categoryId = String(categoryId ?? '');
      sec.dataset.itemId = String(item.id);
      visible += 1;
      const displayName = window.westoI18n?.itemName ? window.westoI18n.itemName(item) : item.name || '';
      const displayDesc = window.westoI18n?.itemDesc ? window.westoI18n.itemDesc(item) : item.desc || '';
      // Replace SplitText wrappers only when copy actually changed.
      setTextIfChanged(nameEl, displayName);
      setTextIfChanged(descEl, displayDesc);
      paintBoardAllergens(sec, item);
      setTextIfChanged(priceEl, formatPrice(item.price));
      if (addBtn) {
        ensureGlassButtonChrome(addBtn.closest('.glass-button-wrap') || addBtn);
        addBtn.disabled = false;
        addBtn.dataset.itemId = String(item.id);
        const addLabel = tr('cart.add');
        setGlassButtonLabel(addBtn, addLabel);
        setAttrIfChanged(
          addBtn,
          'aria-label',
          `${addLabel} ${window.westoI18n?.itemName ? window.westoI18n.itemName(item) : item.name || ''}`.trim(),
        );
      }

      const imageSrc = item.img || item.image || '';
      const eagerBoards = Math.max(1, Number(perfQuality().eagerBoards) || 3);
      setBoardMedia(sec, imageSrc || null, { defer: slot >= eagerBoards });

      let catEl = sec.querySelector('[data-menu-category]');
      if (!catEl) {
        const host = sec.querySelector('.subhead_wrapper') || sec.querySelector('.benefits_text');
        if (host) {
          catEl = document.createElement('div');
          catEl.className = 'menu-cat-label';
          catEl.setAttribute('data-menu-category', '');
          host.parentNode.insertBefore(catEl, host);
        }
      }
      setTextIfChanged(catEl, catName);

      // Shared dish rail (may be hoisted to body)
      if (slot === 0) {
        hoistDishRail();
        const nav = dishRailNav();
        if (!nav) return;
        setAttrIfChanged(
          nav,
          'aria-label',
          catName ? `${tr('cart.dishesOf')} ${catName}` : tr('cart.dishesHere'),
        );
        const icons = $$('.benefits_icon-wrapper', nav);
        const n = Math.min(items.length, MAX_DISH_BOARDS);
        items.slice(0, MAX_DISH_BOARDS).forEach((dish, i) => {
          const a = icons[i];
          if (!a) return;
          setAttrIfChanged(a, 'href', `#benefits-${i + 1}`);
          const dishLabel = window.westoI18n?.itemName ? window.westoI18n.itemName(dish) : dish.name || '';
          if (a.title !== dishLabel) a.title = dishLabel;
          setAttrIfChanged(a, 'aria-label', dishLabel || `Dish ${i + 1}`);
          setStyleIfChanged(a, 'display', '');
          ensureRailAnimatedBorder(a);
          let img = a.querySelector('img.benefits_dish-thumb');
          const srcImg = dish.img || dish.image || '';
          if (srcImg) {
            if (!img) {
              img = document.createElement('img');
              img.className = 'benefits_dish-thumb';
              img.alt = '';
              img.decoding = 'async';
              img.loading = 'lazy';
              const iconBox = a.querySelector('.benefits_icon') || a;
              iconBox.innerHTML = '';
              iconBox.appendChild(img);
            }
            if (img.dataset.appliedSource !== srcImg) {
              img.dataset.expectedSource = srcImg;
              img.dataset.imageMode = 'cutout';
              img.classList.remove('is-image-frame');
              img.classList.add('is-image-cutout');
              // Rail thumbnails are never allowed to block the active board.
              // Request only when near the rail viewport; the shared scheduler
              // dedupes against the board image if it is already in flight/ready.
              observeManagedImage(img, srcImg, {
                root: nav,
                rootMargin: '240px',
                priority: i <= activeViewportSlot + 2
                  ? resourcePriority('NEAR', 76)
                  : resourcePriority('PREDICT', 54),
                group: `cat:${categoryId}:rail`,
                loading: 'lazy',
                decode: true,
              });
            }
          } else if (img) {
            delete img.dataset.source;
            img.removeAttribute('src');
          }
          // Keep the rail scannable; the card and accessible name retain the full name.
          let label = a.querySelector('.benefits_rail-label');
          if (!label) {
            label = document.createElement('span');
            label.className = 'benefits_rail-label';
            a.appendChild(label);
          }
          const words = String(dishLabel || '')
            .trim()
            .split(/\s+/)
            .filter(Boolean);
          setTextIfChanged(label, words.slice(0, 2).join(' '));
        });
        icons.forEach((a, i) => {
          setStyleIfChanged(a, 'display', i < n ? '' : 'none');
        });
        $$('.benefits_icon-separator', nav).forEach((sep, i) => {
          setStyleIfChanged(sep, 'display', i < n - 1 ? '' : 'none');
        });
        // Single-dish categories don't need a thumb rail
        nav.classList.toggle('is-rail-solo', n <= 1);
        setStyleIfChanged(nav, 'opacity', n <= 1 ? '0' : '');
        setStyleIfChanged(nav, 'visibility', n <= 1 ? 'hidden' : '');
        setStyleIfChanged(nav, 'pointerEvents', n <= 1 ? 'none' : '');
      }
    });

    if (typeof window.westoBoot?.markBoards === 'function') {
      window.westoBoot.markBoards(visible > 0 ? 1 : 0.4);
    }

    if (visible !== lastVisibleCount) {
      lastVisibleCount = visible;
      scheduleDishLayoutRefresh();
    }

    const rail = dishRailNav();
    lastFilledCategoryId = categoryId;
    if (rail && categoryChanged) {
      rail.scrollTop = 0;
    }

    const onDishes = document.documentElement.classList.contains('is-dish-boards');
    if (onDishes && categoryChanged) {
      // New category while reading dishes → start at first dish (clearer than clamping a deep slot)
      const first = document.querySelector(
        'section.is-benefits[data-menu-slot="0"]:not([hidden])',
      );
      if (first && window.lenis) {
        window.lenis.scrollTo(first, { immediate: true, offset: 0 });
      } else if (first) {
        window.scrollTo(0, first.offsetTop);
      }
    } else {
      reanchorDishScroll();
    }

    // Keep the fixed shared card in sync with whatever board is (or will be) active.
    ensureSharedDishCard();
    const live =
      document.querySelector('section.is-benefits.is-dish-active:not([hidden])') ||
      document.querySelector('section.is-benefits[data-menu-slot="0"]:not([hidden])');
    if (live) syncSharedDishCard(live, { animate: false });
    syncDishCatBar();
  }

  function dishRailNav() {
    return (
      document.querySelector('.benefits_nav.is-menu-rail') ||
      document.querySelector('section.is-benefits[data-menu-slot="0"] .benefits_nav') ||
      document.querySelector('.benefits_nav')
    );
  }

  function hoistDishRail() {
    const nav = dishRailNav();
    if (!nav) return null;
    if (!nav.classList.contains('is-menu-rail')) {
      nav.classList.add('is-menu-rail');
      document.body.appendChild(nav);
    }
    prepareDishRailScroll(nav);
    return nav;
  }

  function prepareDishRailScroll(nav) {
    if (!nav) return;
    // Same contract as catbar: Lenis must not steal vertical pan/wheel.
    nav.setAttribute('data-lenis-prevent', '');
    nav.setAttribute('data-lenis-prevent-touch', '');
    nav.setAttribute('data-lenis-prevent-wheel', '');
    nav.setAttribute('data-lenis-prevent-vertical', '');
    if (nav.style.touchAction !== 'pan-y') nav.style.touchAction = 'pan-y';

    const armRailBrowse = () => {
      window.__westoRailBrowsing = true;
      window.clearTimeout(window.__westoRailBrowseTimer);
      const pinned = window.lenis?.scroll ?? window.scrollY ?? 0;
      window.__westoRailPinnedScroll = pinned;
      window.lenis?.stop?.();
    };
    const releaseRailBrowse = () => {
      window.clearTimeout(window.__westoRailBrowseTimer);
      window.__westoRailBrowseTimer = window.setTimeout(() => {
        window.__westoRailBrowsing = false;
        window.__westoRailPinnedScroll = null;
        if (document.documentElement.classList.contains('is-dish-boards')) {
          window.lenis?.start?.();
        }
      }, 100);
    };

    if (nav.dataset.westoRailScrollBound) return;
    nav.dataset.westoRailScrollBound = '1';

    nav.addEventListener(
      'touchstart',
      () => {
        armRailBrowse();
      },
      { passive: true, capture: true },
    );
    nav.addEventListener(
      'touchmove',
      (e) => {
        armRailBrowse();
        // Keep page scroll frozen while the rail is being scrubbed.
        e.stopPropagation();
        const pinned = window.__westoRailPinnedScroll;
        if (pinned != null && window.lenis && Math.abs((window.lenis.scroll || 0) - pinned) > 0.5) {
          window.lenis.scrollTo(pinned, { immediate: true });
        }
      },
      { passive: true, capture: true },
    );
    nav.addEventListener('touchend', releaseRailBrowse, { passive: true, capture: true });
    nav.addEventListener('touchcancel', releaseRailBrowse, { passive: true, capture: true });

    nav.addEventListener(
      'wheel',
      (e) => {
        const ax = Math.abs(e.deltaX);
        const ay = Math.abs(e.deltaY);
        if (ay < 0.35 && ax < 0.35) return;
        // Always claim vertical wheel over the rail — never advance page dishes,
        // even when the rail is already at its scroll edge.
        if (ay >= ax * 0.75) {
          armRailBrowse();
          e.preventDefault();
          e.stopPropagation();
          if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
          if (nav.scrollHeight > nav.clientHeight + 2) {
            const max = nav.scrollHeight - nav.clientHeight;
            nav.scrollTop = Math.max(0, Math.min(max, nav.scrollTop + e.deltaY));
          }
          releaseRailBrowse();
        }
      },
      { passive: false },
    );
  }

  function ensureRailAnimatedBorder(anchor) {
    if (!anchor) return;
    const icon = anchor.querySelector('.benefits_icon') || anchor;
    // v13.4: dish thumbnails deliberately have no cyan/liquid contour. Remove
    // legacy/static hosts too so a cached shader module cannot resurrect it.
    icon.querySelectorAll(':scope > .benefits_rail-border, :scope > .benefits_rail-border--liquid')
      .forEach((node) => node.remove());
    delete icon.dataset.westoRailHost;
    icon.classList.remove('is-liquid-active');
  }

  function syncLiquidRailBorder() {
    // Keep compatibility with a module that may already exist in a long-lived
    // tab, but only clear it. Active identity is owned by the rail card surface.
    try { window.WestoLiquidRail?.clear?.(); } catch (_) {}
  }

  // ---- Dish switch: one fixed card + light plate crossfade -----------------
  // The glass card is a single body-level host so it never resizes or swaps.
  // Only its inner copy changes. Plates do a short opacity fade (no rotate /
  // scale / glow) so the compositor stays cheap.
  let dishSwitchTl = null;
  const dishReducedMotion = window.matchMedia
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : null;

  // Silent dish warm. Keep ownership on the real <img>; creating an extra
  // Image() probe duplicated request/decode work in the performance trace.
  // Only the current dish and its immediate successor are eligible to warm.
  const prewarmWarmed = new Set();
  let prewarmDishBoardsKey = '';

  function warmDishImage(sec) {
    if (!sec || sec.dataset.emptyCat === '1' || sec.hasAttribute('hidden')) return;
    const img = sec.querySelector('.dish-board-media img');
    if (!img) return;
    const src = String(img.currentSrc || img.getAttribute('src') || img.dataset?.source || '').trim();
    if (!src || prewarmWarmed.has(src)) return;
    prewarmWarmed.add(src);
    // Decode only the actual board image. Browser image-cache ownership stays
    // with this element, so there is no duplicate off-DOM fetch/probe.
    if (typeof img.decode === 'function') {
      img.decode().catch(() => {
        // A source change can invalidate an in-flight decode; allow retry.
        prewarmWarmed.delete(src);
      });
    }
  }

  function prewarmDishBoards() {
    const categoryKey = String(lastFilledCategoryId ?? activeCategoryId() ?? '');
    const active =
      document.querySelector('section.is-benefits.is-dish-active:not([hidden])') ||
      document.querySelector('section.is-benefits:not([hidden])');
    if (!active) return;

    const activeSlot = Math.max(0, Number(active.dataset.menuSlot) || 0);
    resourceScheduler()?.focusDish?.(Number(categoryKey), activeSlot, 'dish-viewport');
    const key = `${categoryKey}|${activeSlot}`;
    if (key === prewarmDishBoardsKey) return;

    const boards = $$('section.is-benefits').filter(
      (sec) => !sec.hasAttribute('hidden') && sec.dataset.emptyCat !== '1',
    );
    if (!boards.length) return;

    const current =
      boards.find((sec) => Number(sec.dataset.menuSlot) === activeSlot) || active;
    const next = boards.find((sec) => Number(sec.dataset.menuSlot) === activeSlot + 1) || null;

    warmDishImage(current);
    if (next && next !== current) warmDishImage(next);
    prewarmDishBoardsKey = key;
  }

  function ensureGlassButtonChrome(wrapOrBtn) {
    const wrap =
      wrapOrBtn?.classList?.contains('glass-button-wrap')
        ? wrapOrBtn
        : wrapOrBtn?.closest?.('.glass-button-wrap');
    if (!wrap) return null;
    const cached = wrap.__westoGlassChrome;
    if (cached?.btn?.isConnected && cached?.label?.isConnected) return cached;
    const btn = wrap.querySelector('.glass-button') || wrap.querySelector('button');
    if (!btn) return null;
    let text = btn.querySelector('.glass-button-text');
    if (!text) {
      text = document.createElement('span');
      text.className = 'glass-button-text';
      while (btn.firstChild) text.appendChild(btn.firstChild);
      btn.appendChild(text);
    }
    if (!text.querySelector('.glass-button-label')) {
      const label = document.createElement('span');
      label.className = 'glass-button-label';
      // Move existing text nodes / leftover copy into the label slot.
      const leftovers = [...text.childNodes].filter(
        (n) => !(n.nodeType === 1 && n.classList?.contains('glass-button-icon')),
      );
      leftovers.forEach((n) => label.appendChild(n));
      if (!label.textContent.trim()) label.textContent = 'افزودن';
      text.appendChild(label);
    }
    if (!text.querySelector('.glass-button-icon')) {
      const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      icon.setAttribute('class', 'glass-button-icon');
      icon.setAttribute('viewBox', '0 0 24 24');
      icon.setAttribute('fill', 'none');
      icon.setAttribute('stroke', 'currentColor');
      icon.setAttribute('stroke-width', '2.25');
      icon.setAttribute('stroke-linecap', 'round');
      icon.setAttribute('stroke-linejoin', 'round');
      icon.setAttribute('aria-hidden', 'true');
      icon.innerHTML = '<path d="M12 5v14"/><path d="M5 12h14"/>';
      text.appendChild(icon);
    }
    if (wrap.classList.contains('menu-add-wrap')) {
      wrap.querySelectorAll('.glass-button-shadow').forEach((el) => el.remove());
    } else if (!wrap.querySelector('.glass-button-shadow')) {
      const shadow = document.createElement('div');
      shadow.className = 'glass-button-shadow';
      shadow.setAttribute('aria-hidden', 'true');
      wrap.appendChild(shadow);
    }
    const chrome = { wrap, btn, text, label: text.querySelector('.glass-button-label') };
    wrap.__westoGlassChrome = chrome;
    return chrome;
  }

  function setGlassButtonLabel(btn, labelText) {
    const chrome = ensureGlassButtonChrome(btn);
    if (!chrome) return;
    const next = labelText || '';
    if (chrome.label.textContent !== next) chrome.label.textContent = next;
  }

  function loadDishFavorites() {
    try {
      const value = JSON.parse(localStorage.getItem(DISH_FAVORITES_KEY) || '[]');
      return new Set(Array.isArray(value) ? value.map(String) : []);
    } catch (_) {
      return new Set();
    }
  }

  const dishFavorites = loadDishFavorites();

  function saveDishFavorites() {
    try {
      localStorage.setItem(DISH_FAVORITES_KEY, JSON.stringify([...dishFavorites]));
    } catch (_) {}
  }

  function favoriteCopy(itemName, isFavorite) {
    const lang = activeLang();
    const name = String(itemName || '').trim();
    if (lang === 'en') return `${isFavorite ? 'Remove' : 'Add'} ${name || 'dish'} ${isFavorite ? 'from' : 'to'} favorites`;
    if (lang === 'ar') return `${isFavorite ? 'إزالة' : 'إضافة'} ${name || 'الطبق'} ${isFavorite ? 'من' : 'إلى'} المفضلة`;
    return `${isFavorite ? 'حذف' : 'افزودن'} ${name || 'غذا'} ${isFavorite ? 'از' : 'به'} علاقه‌مندی‌ها`;
  }

  function ensureDishCardPremiumChrome(card) {
    if (!card) return null;
    const title = card.querySelector('[data-menu-name]');
    const titleWrap = title?.closest('.margin-bottom') || title?.parentElement;
    let favorite = card.querySelector('[data-dish-favorite]');
    if (title && titleWrap && !favorite) {
      favorite = document.createElement('button');
      favorite.type = 'button';
      favorite.className = 'dish-favorite-button';
      favorite.dataset.dishFavorite = '';
      favorite.setAttribute('aria-pressed', 'false');
      favorite.innerHTML = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78Z"/></svg>';
      titleWrap.insertBefore(favorite, title);
    }

    const price = card.querySelector('[data-menu-price]');
    const priceWrap = price?.closest('.subhead_text') || price?.parentElement;
    if (price && priceWrap && !priceWrap.querySelector('.dish-price-tag')) {
      const tag = document.createElement('span');
      tag.className = 'dish-price-tag';
      tag.setAttribute('aria-hidden', 'true');
      tag.innerHTML = '<svg viewBox="0 0 24 24" fill="none"><path d="M20.59 13.41 11 3.83V3H4v7h.83l9.58 9.59a2 2 0 0 0 2.82 0l3.36-3.36a2 2 0 0 0 0-2.82Z"/><circle cx="7.5" cy="6.5" r="1"/></svg>';
      priceWrap.insertBefore(tag, price);
    }
    card.dataset.dishCardPremium = 'true';
    return card;
  }

  function syncDishFavoriteButton(card, itemId, itemName) {
    const favorite = ensureDishCardPremiumChrome(card)?.querySelector('[data-dish-favorite]');
    if (!favorite) return;
    const key = itemId == null ? '' : String(itemId);
    const isFavorite = Boolean(key) && dishFavorites.has(key);
    favorite.dataset.itemId = key;
    favorite.dataset.itemName = itemName || '';
    favorite.classList.toggle('is-favorite', isFavorite);
    favorite.setAttribute('aria-pressed', String(isFavorite));
    favorite.setAttribute('aria-label', favoriteCopy(itemName, isFavorite));
    favorite.disabled = !key;
  }

  function toggleDishFavorite(button) {
    const key = String(button?.dataset.itemId || '');
    if (!key) return;
    if (dishFavorites.has(key)) dishFavorites.delete(key);
    else dishFavorites.add(key);
    saveDishFavorites();
    syncDishFavoriteButton(button.closest('#westo-dish-card'), key, button.dataset.itemName);
  }

  function ensureSharedDishCard() {
    let card = document.getElementById('westo-dish-card');
    if (card) return ensureDishCardPremiumChrome(card);
    const source = document.querySelector('section.is-benefits .benefits_text');
    if (!source) return null;
    card = source.cloneNode(true);
    card.id = 'westo-dish-card';
    card.classList.add('is-shared-dish-card');
    card.removeAttribute('style');
    card.querySelectorAll('[data-anim]').forEach((el) => el.removeAttribute('data-anim'));
    const addWrap = card.querySelector('.glass-button-wrap.menu-add-wrap, .menu-add-wrap');
    if (addWrap) ensureGlassButtonChrome(addWrap);
    document.body.appendChild(card);
    return ensureDishCardPremiumChrome(card);
  }

  function syncSharedDishAllergens(card, fromSec) {
    if (!card || !fromSec) return;
    const fromSlot = fromSec.querySelector('.menu-allergen-slot');
    let toSlot = card.querySelector('.menu-allergen-slot');
    if (!fromSlot) {
      toSlot?.remove();
      return;
    }
    if (!toSlot) {
      toSlot = document.createElement('div');
      toSlot.className = 'menu-allergen-slot';
      const addButton = card.querySelector('[data-menu-add]');
      const action =
        addButton?.closest('.max-width-xsmall') || addButton?.closest('.menu-add-wrap');
      if (action?.parentNode) action.parentNode.insertBefore(toSlot, action);
    }
    if (toSlot) toSlot.innerHTML = fromSlot.innerHTML;
  }

  function applySharedDishCardFrom(fromSec) {
    const card = ensureSharedDishCard();
    if (!card || !fromSec) return null;
    const copyText = (sel) => {
      const from = fromSec.querySelector(sel);
      const to = card.querySelector(sel);
      if (from && to) to.textContent = from.textContent;
    };
    copyText('[data-menu-category]');
    copyText('[data-menu-price]');
    copyText('[data-menu-name]');
    copyText('[data-menu-desc]');
    syncSharedDishAllergens(card, fromSec);
    const itemId = fromSec.dataset.itemId || fromSec.querySelector('[data-menu-add]')?.dataset.itemId;
    const itemName = card.querySelector('[data-menu-name]')?.textContent || '';
    syncDishFavoriteButton(card, itemId, itemName);
    const fromBtn = fromSec.querySelector('[data-menu-add]');
    const toBtn = card.querySelector('[data-menu-add]');
    if (fromBtn && toBtn) {
      ensureGlassButtonChrome(toBtn);
      toBtn.disabled = fromBtn.disabled;
      if (fromBtn.dataset.itemId) toBtn.dataset.itemId = fromBtn.dataset.itemId;
      else delete toBtn.dataset.itemId;
      const fromLabel =
        fromBtn.querySelector('.glass-button-label') ||
        fromBtn.querySelector('.glass-button-text') ||
        fromBtn;
      setGlassButtonLabel(toBtn, fromLabel.textContent);
      const aria = fromBtn.getAttribute('aria-label');
      if (aria) toBtn.setAttribute('aria-label', aria);
      else toBtn.removeAttribute('aria-label');
    }
    return card;
  }

  function syncSharedDishCard(fromSec, { animate } = {}) {
    const card = ensureSharedDishCard();
    if (!card || !fromSec) return;
    const body = card.querySelector('.benefits_max-width') || card;
    if (!animate || !window.gsap || (dishReducedMotion && dishReducedMotion.matches)) {
      applySharedDishCardFrom(fromSec);
      body.style.opacity = '1';
      body.style.removeProperty('transform');
      try {
        const cache = window.gsap?.core?.getCache?.(body);
        if (cache) cache.uncache = 1;
      } catch (_) {}
      return;
    }
    const gsap = window.gsap;
    gsap.killTweensOf(body);
    gsap.to(body, {
      opacity: 0,
      duration: 0.1,
      ease: 'power1.in',
      overwrite: true,
      onComplete: () => {
        applySharedDishCardFrom(fromSec);
        gsap.to(body, { opacity: 1, duration: 0.16, ease: 'power1.out', overwrite: true });
      },
    });
  }

  function clearDishFx(sec) {
    if (!sec) return;
    sec.classList.remove('is-dish-leaving');
    sec.classList.remove('is-dish-switching');
    sec.classList.remove('is-dish-prewarm');
    const media = sec.querySelector('.dish-board-media');
    clearMediaInlineFx(media);
  }

  function playDishSwitch(fromSec, toSec) {
    if (!toSec) return;
    const gsap = window.gsap;

    killDishSwitchTl();

    document.querySelectorAll('section.is-benefits.is-dish-leaving').forEach((s) => {
      if (s !== toSec) clearDishFx(s);
    });

    const hasFrom = Boolean(fromSec) && fromSec !== toSec;
    syncSharedDishCard(toSec, { animate: hasFrom });

    const inMedia = toSec.querySelector('.dish-board-media');
    if (!gsap) {
      if (hasFrom) clearDishFx(fromSec);
      return;
    }

    const reduced = Boolean(dishReducedMotion && dishReducedMotion.matches);
    if (reduced) {
      if (hasFrom) clearDishFx(fromSec);
      if (inMedia) {
        clearMediaInlineFx(inMedia);
        inMedia.style.opacity = '1';
        inMedia.style.visibility = 'visible';
      }
      return;
    }

    toSec.classList.add('is-dish-switching');
    const restoreVisible = () => {
      if (hasFrom) clearDishFx(fromSec);
      toSec.classList.remove('is-dish-switching');
      if (inMedia) clearMediaInlineFx(inMedia);
      healActiveBoardMedia(toSec);
      dishSwitchTl = null;
    };
    const tl = gsap.timeline({
      defaults: { overwrite: true },
      onComplete: restoreVisible,
      onInterrupt: restoreVisible,
    });
    dishSwitchTl = tl;

    const fromSlot = hasFrom ? Number(fromSec.dataset.menuSlot) : Number(toSec.dataset.menuSlot);
    const toSlot = Number(toSec.dataset.menuSlot);
    const forward = !hasFrom || !Number.isFinite(fromSlot) || !Number.isFinite(toSlot) ? true : toSlot >= fromSlot;
    const outY = forward ? -11 : 11;
    const inY = forward ? 11 : -11;

    if (hasFrom) {
      fromSec.classList.add('is-dish-leaving');
      const outMedia = fromSec.querySelector('.dish-board-media');
      if (outMedia) {
        tl.to(outMedia, { autoAlpha: 0, yPercent: outY, duration: 0.24, ease: 'power2.in' }, 0);
      }
    }

    if (inMedia) {
      tl.fromTo(
        inMedia,
        { autoAlpha: 0, yPercent: inY },
        { autoAlpha: 1, yPercent: 0, duration: 0.34, ease: 'power2.out' },
        hasFrom ? 0.055 : 0,
      );
    } else {
      const gsap = getGsap();
      if (gsap) gsap.delayedCall(0.016, () => healActiveBoardMedia(toSec));
      else requestAnimationFrame(() => healActiveBoardMedia(toSec));
    }
  }

  function syncDishRailActive(slot) {
    syncDishSubBar(
      lastFilledCategoryId != null ? lastFilledCategoryId : activeCategoryId(),
      slot,
      {
        forceHide:
          !document.documentElement.classList.contains('is-dish-boards') ||
          document.documentElement.classList.contains('is-cat-flying'),
      },
    );
    const nav = dishRailNav();
    if (!nav) return null;
    let activeIcon = null;
    const prevActive = document.querySelector('section.is-benefits.is-dish-active');
    let newActive = null;
    $$('.benefits_icon-wrapper', nav).forEach((a) => {
      const href = a.getAttribute('href') || '';
      const m = href.match(/benefits-(\d+)/);
      const i = m ? Number(m[1]) - 1 : -1;
      const on = i === slot;
      a.classList.toggle('is-active', on);
      a.classList.toggle('w--current', on);
      if (on) activeIcon = a;
    });
    document.querySelectorAll('section.is-benefits').forEach((sec) => {
      const s = Number(sec.dataset.menuSlot);
      const on = s === slot;
      sec.classList.toggle('is-dish-active', on);
      // Write aria only on real changes: each setAttribute invalidates styles,
      // and six of them land in the same frame as the switch.
      const aria = on ? 'false' : 'true';
      if (sec.getAttribute('aria-hidden') !== aria) sec.setAttribute('aria-hidden', aria);
      if (on) newActive = sec;
    });
    if (
      newActive &&
      newActive !== prevActive &&
      document.documentElement.classList.contains('is-dish-boards')
    ) {
      playDishSwitch(prevActive, newActive);
      try {
        const img =
          newActive.querySelector('.dish-board-media img')?.currentSrc ||
          newActive.querySelector('.dish-board-media img')?.src ||
          '';
        window.dispatchEvent(
          new CustomEvent('westo:dish-focus', {
            detail: {
              itemId: newActive.dataset.itemId,
              categoryId: newActive.dataset.categoryId,
              img,
            },
          }),
        );
      } catch (_) {}
    } else if (newActive && document.documentElement.classList.contains('is-dish-boards')) {
      syncSharedDishCard(newActive, { animate: false });
    }
    if (activeIcon) {
      // Measure + scroll the rail next frame: reading offsetTop/scrollHeight
      // right after the class writes above forces a synchronous layout inside
      // the switch frame (this was the visible transition hitch).
      requestAnimationFrame(() => {
        if (!activeIcon.isConnected) return;
        syncLiquidRailBorder(activeIcon);
        window.WestoLiquidRail?.bump?.(1.35, 260);
        if (nav.scrollHeight <= nav.clientHeight + 4) return;
        const top =
          activeIcon.offsetTop - nav.clientHeight * 0.45 + activeIcon.offsetHeight * 0.5;
        nav.scrollTo({
          top: Math.max(0, Math.min(top, nav.scrollHeight - nav.clientHeight)),
          behavior: 'auto',
        });
      });
    } else {
      syncLiquidRailBorder(null);
    }
    return activeIcon;
  }

  function scrollToDishSlot(slot) {
    const el = document.querySelector(`section.is-benefits[data-menu-slot="${slot}"]`);
    if (!el) return;
    window.westoSound?.play?.('benefits');
    window.westoSound?.lockNav?.(1100);
    // Lock scroll-driven rail sync so intermediate dishes don't flash active mid-jump
    window.__westoRailNavLock = { slot };
    syncDishRailActive(slot);
    const duration = 1.05;
    const clearLock = () => {
      if (window.__westoRailNavLock?.slot === slot) window.__westoRailNavLock = null;
    };
    if (window.lenis) {
      window.lenis.scrollTo(el, {
        offset: 0,
        duration,
        lock: true,
        onComplete: clearLock,
      });
      // Safety if onComplete is skipped (interrupt / remount)
      window.clearTimeout(window.__westoRailNavLockTimer);
      window.__westoRailNavLockTimer = window.setTimeout(clearLock, duration * 1000 + 200);
    } else {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      window.clearTimeout(window.__westoRailNavLockTimer);
      window.__westoRailNavLockTimer = window.setTimeout(clearLock, 1200);
    }
  }

  function dishSubcategoryGroups(categoryId) {
    const items = menuByCategory[categoryId] || menuByCategory[Number(categoryId)] || [];
    const seen = new Set();
    const groups = [];
    items.forEach((item, slot) => {
      const id = item?.subcategoryId;
      const title = String(item?.subcategoryTitle || '').trim();
      if (id == null || id === '' || !title || seen.has(String(id))) return;
      seen.add(String(id));
      groups.push({ id: String(id), title, slot });
    });
    return groups;
  }

  function bindDishSubBar(subbar) {
    if (!subbar || subbar.dataset.bound === '1') return;
    subbar.dataset.bound = '1';
    subbar.setAttribute('data-lenis-prevent', '');
    subbar.setAttribute('data-lenis-prevent-touch', '');
    subbar.setAttribute('data-lenis-prevent-wheel', '');

    subbar.addEventListener('click', (event) => {
      const tab = event.target.closest('.westo-dish-subbar__tab');
      if (!tab || !subbar.contains(tab) || tab.disabled) return;
      const slot = Number(tab.dataset.menuSlot);
      if (!Number.isFinite(slot)) return;
      event.preventDefault();
      scrollToDishSlot(slot);
    });

    subbar.addEventListener('keydown', (event) => {
      const tab = event.target.closest('.westo-dish-subbar__tab');
      if (!tab || !subbar.contains(tab)) return;
      const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
      if (!keys.includes(event.key)) return;
      const tabs = [...subbar.querySelectorAll('.westo-dish-subbar__tab')];
      if (!tabs.length) return;
      const current = Math.max(0, tabs.indexOf(tab));
      let next = current;
      if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = tabs.length - 1;
      else if (event.key === 'ArrowRight') next = (current + 1) % tabs.length;
      else next = (current - 1 + tabs.length) % tabs.length;
      event.preventDefault();
      tabs[next].focus({ preventScroll: true });
      tabs[next].click();
    });

    // Mouse wheels over the secondary tabs browse that row instead of leaking
    // a category/dish step into the page-level animation state machine.
    subbar.addEventListener(
      'wheel',
      (event) => {
        const ax = Math.abs(event.deltaX);
        const ay = Math.abs(event.deltaY);
        if (ax < 0.35 && ay < 0.35) return;
        const delta = ax >= ay ? event.deltaX : event.deltaY;
        if (subbar.scrollWidth <= subbar.clientWidth + 2) return;
        event.preventDefault();
        event.stopPropagation();
        subbar.scrollLeft += delta;
      },
      { passive: false },
    );
  }

  function ensureDishSubBar(bar) {
    if (!bar) return null;
    let subbar = bar.querySelector(':scope > .westo-dish-subbar');
    if (!subbar) {
      subbar = document.createElement('div');
      subbar.className = 'westo-dish-subbar';
      subbar.hidden = true;
      subbar.setAttribute('role', 'tablist');
      subbar.setAttribute('aria-hidden', 'true');
      bar.appendChild(subbar);
    }
    subbar.setAttribute('aria-label', tr('dish.subcategories') || 'زیردسته‌های منو');
    bindDishSubBar(subbar);
    return subbar;
  }

  function centerDishSubTab(subbar, tab) {
    if (!subbar || !tab || subbar.scrollWidth <= subbar.clientWidth + 2) return;
    requestAnimationFrame(() => {
      if (!tab.isConnected || subbar.hidden) return;
      const host = subbar.getBoundingClientRect();
      const rect = tab.getBoundingClientRect();
      const target = Math.max(
        0,
        Math.min(
          subbar.scrollWidth - subbar.clientWidth,
          subbar.scrollLeft + rect.left + rect.width / 2 - (host.left + host.width / 2),
        ),
      );
      subbar.scrollTo({
        left: target,
        behavior: dishReducedMotion?.matches ? 'auto' : 'smooth',
      });
    });
  }

  function syncDishSubBar(categoryId, slot = 0, { forceHide = false } = {}) {
    const bar = ensureDishCatBar();
    // Subcategory navigation was deliberately removed from the experience.
    // Keep this guard inside the sync path so it cannot reappear after a
    // category change, wheel gesture, or a rail remount.
    const existingSubbar = bar?.querySelector(':scope > .westo-dish-subbar');
    if (existingSubbar) existingSubbar.remove();
    bar?.classList.remove('has-subcategories');
    return;

    const subbar = ensureDishSubBar(bar);
    if (!subbar) return;
    const groups = dishSubcategoryGroups(categoryId);
    // A lone subgroup is not a useful navigation choice. Its row remains
    // geometrically reserved by CSS, so changing categories never jumps food.
    const shouldShow = !forceHide && groups.length > 1;
    const lang = document.documentElement.getAttribute('lang') || 'fa';
    const signature = `${String(categoryId ?? '')}|${lang}|${groups
      .map((group) => `${group.id}:${group.title}:${group.slot}`)
      .join(',')}`;

    if (subbar.dataset.builtSig !== signature) {
      subbar.replaceChildren();
      groups.forEach((group) => {
        const tab = document.createElement('button');
        tab.type = 'button';
        tab.className = 'westo-dish-subbar__tab';
        tab.dataset.subcategoryId = group.id;
        tab.dataset.menuSlot = String(group.slot);
        tab.setAttribute('role', 'tab');
        tab.setAttribute('aria-controls', `benefits-${group.slot + 1}`);
        tab.setAttribute('dir', 'auto');
        tab.textContent = group.title;
        subbar.appendChild(tab);
      });
      subbar.dataset.builtSig = signature;
      subbar.scrollLeft = 0;
    }

    const items = menuByCategory[categoryId] || menuByCategory[Number(categoryId)] || [];
    const safeSlot = Math.max(0, Math.min(items.length - 1, Number(slot) || 0));
    const activeSubcategory = String(items[safeSlot]?.subcategoryId ?? '');
    let activeTab = null;
    subbar.querySelectorAll('.westo-dish-subbar__tab').forEach((tab, index) => {
      const on = tab.dataset.subcategoryId === activeSubcategory;
      tab.classList.toggle('is-active', on);
      tab.setAttribute('aria-selected', on ? 'true' : 'false');
      tab.tabIndex = on || (!activeSubcategory && index === 0) ? 0 : -1;
      if (on) activeTab = tab;
    });
    subbar.hidden = !shouldShow;
    subbar.setAttribute('aria-hidden', shouldShow ? 'false' : 'true');
    bar.classList.toggle('has-subcategories', shouldShow);
    if (shouldShow && activeTab) centerDishSubTab(subbar, activeTab);
  }

  function bindDishRailClicks() {
    const nav = hoistDishRail();
    if (!nav || nav.dataset.westoRailBound) return;
    nav.dataset.westoRailBound = '1';
    const warmRailIntent = (e, reason) => {
      const a = e.target.closest('a.benefits_icon-wrapper');
      if (!a || !nav.contains(a)) return;
      const href = a.getAttribute('href') || '';
      const m = href.match(/benefits-(\d+)/);
      if (!m) return;
      const slot = Math.max(0, Number(m[1]) - 1);
      const categoryId = Number(lastFilledCategoryId ?? activeCategoryId());
      resourceScheduler()?.focusDish?.(categoryId, slot, reason);
    };
    nav.addEventListener('pointerover', (e) => warmRailIntent(e, 'rail-hover'), { passive: true });
    nav.addEventListener('pointerdown', (e) => warmRailIntent(e, 'rail-pointerdown'), { passive: true });
    nav.addEventListener('touchstart', (e) => warmRailIntent(e, 'rail-touchstart'), { passive: true });
    nav.addEventListener('click', (e) => {
      const a = e.target.closest('a.benefits_icon-wrapper');
      if (!a || !nav.contains(a)) return;
      const href = a.getAttribute('href') || '';
      const m = href.match(/benefits-(\d+)/);
      if (!m) return;
      e.preventDefault();
      e.stopPropagation();
      scrollToDishSlot(Number(m[1]) - 1);
    });
  }

  let dishViewportStateBound = false;
  let dishViewportRaf = 0;
  let activeViewportSlot = -1;
  let dishBoardsCache = null;
  let dishBoardMetrics = null;
  let dishHeroHeight = 0;
  let lastViewportUiKey = '';

  // getComputedStyle per board per scroll frame showed up in CPU profiles —
  // resolve visibility once and reuse until layout actually changes.
  function refreshDishBoardsCache() {
    dishBoardsCache = allDishBoards().filter(
      (section) => section.isConnected && !section.hasAttribute('hidden') && section.style.display !== 'none',
    );
    // Read geometry as one batch, only after a relayout/resize/category commit.
    // Scroll frames consume these absolute coordinates without layout reads.
    const scrollY = window.lenis?.animatedScroll ?? window.lenis?.scroll ?? window.scrollY ?? 0;
    dishBoardMetrics = dishBoardsCache.map((section) => {
      const rect = section.getBoundingClientRect();
      return {
        section,
        top: rect.top + scrollY,
        bottom: rect.bottom + scrollY,
        height: rect.height,
        center: rect.top + scrollY + rect.height * 0.5,
      };
    });
    const heroEl = document.querySelector('section.is-gamme');
    if (heroEl) dishHeroHeight = heroEl.getBoundingClientRect().height || window.innerHeight || 1;
    return dishBoardsCache;
  }

  function updateDishViewportState() {
    dishViewportRaf = 0;
    // Finger is scrubbing the side rail — freeze dish board sync.
    if (window.__westoRailBrowsing) return;
    const root = document.documentElement;

    // The Hero→Dish landing owns the state machine for its final paint.
    // Ignore observer churn during this short atomic handoff; otherwise a
    // resize/scroll tick can re-toggle `is-dish-boards` between the two paints.
    if (root.classList.contains('is-cat-fly-handoff')) {
      syncBackCategoriesBtn();
      return;
    }

    // Reverse Dish→Hero is also an atomic transaction.  `onDishes` is computed
    // later from geometry captured at the start of this callback; without this
    // grace window the same scroll tick can re-add `is-dish-boards` immediately
    // after reverse completion, which is the visible one-frame "tick" seen on
    // return to the category Hero.  Do not pin scroll here — simply let Hero
    // own the visual state until the reverse handoff has settled.
    if (Date.now() < catFlyReverseGraceUntil) {
      root.classList.remove(
        'is-dish-boards',
        'is-cat-flying',
        'is-cat-scroll-fly',
        'is-cat-fly-covered',
        'is-cat-fly-media-under',
        'is-cat-fly-handoff',
        'is-cat-fly-dish-in',
      );
      syncBackCategoriesBtn();
      syncDishCatBar({ skipReveal: true });
      return;
    }

    /* The entrance gate owns scroll until its hand-off timeline completes.
       A very fast wheel/touch gesture used to let this observer activate dish
       mode underneath the fading gate, leaving hero, fly and dish state alive
       at the same time. Keep the state machine at its hero origin and discard
       any native scroll leaked by browser chrome while the gate is locked. */
    if (root.classList.contains('is-entrance-gate')) {
      if (scrollCatFly) cancelScrollCatFly();
      scrollFlyLanded = false;
      catFlyBusy = false;
      pendingDishRevealEl = null;
      root.classList.remove(
        'is-dish-boards',
        'is-cat-flying',
        'is-cat-scroll-fly',
        'is-cat-fly-covered',
        'is-cat-fly-media-under',
        'is-cat-fly-handoff',
        'is-cat-fly-dish-in',
      );
      if ((window.scrollY || window.lenis?.scroll || 0) > 1) {
        window.lenis?.scrollTo?.(0, { immediate: true, force: true });
        window.scrollTo(0, 0);
      }
      syncBackCategoriesBtn();
      syncDishCatBar({ skipReveal: true });
      return;
    }

    const viewportHeight = window.innerHeight || 1;
    let boards = dishBoardsCache;
    if (!boards || !boards.length || !boards[0].isConnected) {
      boards = refreshDishBoardsCache();
    }
    boards = boards.filter((section) => section.isConnected && !section.hasAttribute('hidden'));
    if (!dishBoardMetrics || dishBoardMetrics.length !== boards.length) refreshDishBoardsCache();

    let active = null;
    let bestDistance = Infinity;
    const currentScrollY = window.lenis?.animatedScroll ?? window.lenis?.scroll ?? window.scrollY ?? 0;
    (dishBoardMetrics || []).forEach((metric) => {
      const section = metric.section;
      const rectTop = metric.top - currentScrollY;
      const rectBottom = metric.bottom - currentScrollY;
      const ownsViewport = rectTop <= viewportHeight * 0.58 && rectBottom >= viewportHeight * 0.42;
      if (!ownsViewport) return;
      const distance = Math.abs(metric.center - currentScrollY - viewportHeight * 0.5);
      if (distance < bestDistance) {
        bestDistance = distance;
        active = section;
      }
    });

    const lockedSlot = Number(window.__westoRailNavLock?.slot);
    if (Number.isFinite(lockedSlot)) {
      const locked = boards.find(
        (section) => Number(section.dataset.menuSlot) === lockedSlot,
      );
      if (locked) active = locked;
    }

    const wasOnDishes = root.classList.contains('is-dish-boards');
    // Keep dish mode until the user is clearly back in the hero zone.
    // Otherwise: dish DOM hides (CSS) while WebGL cans are still scaled to ~0
    // → empty black page, then a sudden category jump when plates return.
    const scrollY = currentScrollY;
    const heroH = dishHeroHeight || viewportHeight;
    const inHeroZone = scrollY < heroH * 0.28;
    const firstBoardTop = dishBoardMetrics?.[0]?.top ?? heroH;
    const flyProgress = computeScrollFlyProgress(scrollY, heroH, firstBoardTop);
    const flyEndScroll = Math.min(
      heroH * SCROLL_FLY_END,
      (firstBoardTop || heroH) * 0.82,
    );
    const flyStartScroll = heroH * SCROLL_FLY_START;
    const pastFlyZone = scrollY >= flyEndScroll;
    const inHeroFlyBand = scrollY >= flyStartScroll && scrollY < flyEndScroll;
    const crossingIntoDishes = scrollY >= Math.min(heroH * 0.55, firstBoardTop * 0.85);

    // Back button / programmatic hero return — never re-enter dish mode or fly mid-scroll.
    if (isForcingHeroReturn()) {
      if (scrollCatFly) cancelScrollCatFly();
      scrollFlyLanded = false;
      catFlyBusy = false;
      root.classList.remove(
        'is-dish-boards',
        'is-cat-flying',
        'is-cat-scroll-fly',
        'is-cat-fly-covered',
        'is-cat-fly-media-under',
        'is-cat-fly-handoff',
      );
      if (inHeroZone) {
        forceHeroReturn = false;
        forceHeroReturnUntil = Date.now() + 180;
      } else {
        // Keep pinning until Lenis actually settles in the hero — otherwise
        // the next scroll tick re-adds is-dish-boards and "دسته‌ها" looks dead.
        try {
          if (window.lenis?.scrollTo) {
            window.lenis.scrollTo(0, { immediate: true, force: true, lock: true });
          }
          window.scrollTo(0, 0);
        } catch (_) {}
      }
      syncBackCategoriesBtn();
      syncDishCatBar({ skipReveal: true });
      return;
    }

    const inDishFlow =
      wasOnDishes ||
      catFlyBusy ||
      root.classList.contains('is-cat-flying') ||
      scrollFlyLanded;
    const onDishes =
      Boolean(active) ||
      (scrollFlyLanded && !inHeroZone) ||
      (pastFlyZone && boards.length > 0) ||
      (crossingIntoDishes && !inHeroZone) ||
      (!inHeroZone && boards.length > 0 && inDishFlow) ||
      (inDishFlow && (catFlyBusy || Date.now() < catFlyLandGraceUntil));

    const leavingDishes =
      inDishFlow &&
      !onDishes &&
      !catFlyBusy &&
      !scrollCatFly &&
      Date.now() >= catFlyLandGraceUntil &&
      !isCatStepGuarded();
    if (!onDishes && !scrollCatFly) refreshHeroCatSeatCache();

    // ── Bidirectional scroll fly: hero band ↔ catbar (same path, both directions) ──
    const inReverseMode = scrollFlyLanded || Boolean(scrollCatFly?.reverse);

    // Horizontal category step: keep user pinned in dish boards — never reverse-fly / eject.
    if (isCatStepGuarded() && scrollFlyLanded) {
      const minDishY = Math.max(0, (firstBoardTop || heroH) + 4);
      if (scrollY < minDishY) {
        if (window.lenis?.scrollTo) {
          window.lenis.scrollTo(minDishY, { immediate: true });
        } else {
          window.scrollTo(0, minDishY);
        }
      }
      root.classList.add('is-dish-boards');
      // Skip reverse fly + leave for this frame.
    } else if (inHeroFlyBand) {
      if (inReverseMode) {
        if (catFlyTween?.kill) {
          catFlyTween.kill();
          catFlyTween = null;
        }
        updateScrollCatFly(flyProgress, { reverse: true });
        if (flyProgress <= 0.03) {
          completeScrollReverseFly();
          pendingDishRevealEl = null;
        }
      } else if (!wasOnDishes) {
        if (!lastHeroCatSeats.length) {
          const live = (
            typeof window.__westoCaptureHeroPlates === 'function'
              ? window.__westoCaptureHeroPlates()
              : []
          ).filter(
            (s) => s && s.categoryId && s.cover && Number(s.size) > 90 && Number(s.opacity) >= 0.5,
          );
          if (live.length >= 2 && live.length <= 5) {
            lastHeroCatSeats = live.map((s) => ({ ...s }));
          }
        }
        if (!pendingDishRevealEl) {
          pendingDishRevealEl = active || boards[0] || null;
        }
        boards.forEach(clearDishFx);
        preloadCatFlyCovers(lastHeroCatSeats.length ? lastHeroCatSeats : buildAllCatFlySources());
        updateScrollCatFly(flyProgress, { reverse: false });
        if (flyProgress >= 0.97 && !scrollFlyLanded) {
          completeScrollCatFly(pendingDishRevealEl);
          pendingDishRevealEl = null;
        }
      }
      if (inReverseMode ? flyProgress > 0.08 : flyProgress > 0.15) {
        prewarmDishBoards();
      }
    } else if (flyProgress <= 0.03 && scrollCatFly?.reverse) {
      completeScrollReverseFly();
      pendingDishRevealEl = null;
    } else if (flyProgress <= 0 && scrollCatFly && !scrollCatFly.reverse && !scrollFlyLanded) {
      cancelScrollCatFly();
      root.classList.remove('is-cat-flying');
      pendingDishRevealEl = null;
    } else if (pastFlyZone && scrollCatFly?.reverse) {
      cancelScrollCatFly({ keepLanded: true });
      root.classList.add('is-dish-boards');
    } else if (
      !scrollFlyLanded &&
      !scrollCatFly?.reverse &&
      (pastFlyZone || flyProgress >= 0.97) &&
      (scrollCatFly || catFlyBusy || root.classList.contains('is-cat-flying'))
    ) {
      if (scrollCatFly) {
        completeScrollCatFly(pendingDishRevealEl || active || boards[0] || null);
        pendingDishRevealEl = null;
      } else {
        scrollFlyLanded = true;
        catFlyBusy = false;
        root.classList.remove(
          'is-cat-flying',
          'is-cat-scroll-fly',
          'is-cat-fly-covered',
          'is-cat-fly-media-under',
          'is-cat-fly-handoff',
        );
        root.classList.add('is-dish-boards');
        revealPendingDishBoard();
        syncDishCatBar({ skipReveal: true });
      }
    }

    if (leavingDishes) {
      killDishSwitchTl();
      boards.forEach(clearDishFx);
      if (scrollCatFly?.reverse && flyProgress <= 0.05) {
        completeScrollReverseFly();
      } else if (!inHeroFlyBand && scrollFlyLanded && inHeroZone && !scrollCatFly) {
        scrollFlyLanded = false;
        killCatFly();
        root.classList.remove(
          'is-dish-boards',
          'is-cat-flying',
          'is-cat-scroll-fly',
          'is-cat-fly-covered',
        );
        if (typeof window.__westoHideHeroPlatesForFly === 'function') {
          window.__westoHideHeroPlatesForFly(false);
        }
        if (window.westoRestoreHeroScene) {
          window.westoRestoreHeroScene({ hidden: false });
        }
        if (window.westoRestoreHeroChrome) {
          window.westoRestoreHeroChrome({ force: true });
        }
      }
      fillBoards(activeCategoryId());
    }

    if (!catFlyBusy && !root.classList.contains('is-cat-flying') && !scrollCatFly?.reverse) {
      if (isCatStepGuarded()) {
        root.classList.add('is-dish-boards');
      } else {
        root.classList.toggle('is-dish-boards', onDishes || scrollFlyLanded);
      }
    }

    if (root.classList.contains('is-dish-boards') && !root.classList.contains('is-cat-flying')) {
      if (window.lenis?.isStopped && typeof window.lenis.start === 'function') {
        window.lenis.start();
      }
      document.body.style.overflow = '';
    }

    if (active) {
      const slot = Number(active.dataset.menuSlot) || 0;
      if (slot !== activeViewportSlot || !active.classList.contains('is-dish-active')) {
        activeViewportSlot = slot;
        syncDishRailActive(slot);
      }
    } else if (!onDishes) {
      activeViewportSlot = -1;
      boards.forEach((section) => {
        section.classList.remove('is-dish-active');
        section.setAttribute('aria-hidden', 'true');
      });
    }

    const viewportUiKey = `${onDishes ? 1 : 0}|${activeViewportSlot}|${lastFilledCategoryId ?? ''}|${catFlyBusy ? 1 : 0}`;
    if (viewportUiKey !== lastViewportUiKey) {
      lastViewportUiKey = viewportUiKey;
      syncBackCategoriesBtn();
      if (!scrollCatFly && !root.classList.contains('is-cat-flying')) syncDishCatBar();
    }
  }

  function scheduleDishViewportState() {
    if (dishViewportRaf) return;
    dishViewportRaf = window.requestAnimationFrame(updateDishViewportState);
  }

  function bindDishViewportState() {
    if (dishViewportStateBound) {
      scheduleDishViewportState();
      return;
    }
    dishViewportStateBound = true;
    const invalidateBoardsAndSync = () => {
      dishBoardsCache = null;
      dishBoardMetrics = null;
      dishHeroHeight = 0;
      scheduleDishViewportState();
    };

    // Exactly one canonical scroll producer. Native scroll is the bootstrap
    // fallback; as soon as Lenis exists we unbind native and let Lenis own the
    // viewport-state scheduler. This removes duplicate state commits during
    // transitions and resize settling.
    let nativeBound = false;
    const onNativeScroll = () => scheduleDishViewportState();
    const bindNative = () => {
      if (nativeBound) return;
      nativeBound = true;
      window.addEventListener('scroll', onNativeScroll, { passive: true });
    };
    const unbindNative = () => {
      if (!nativeBound) return;
      nativeBound = false;
      window.removeEventListener('scroll', onNativeScroll);
    };
    const bindLenisScroll = () => {
      if (!window.lenis?.on || window.lenis.__westoDishViewportBound) return false;
      window.lenis.__westoDishViewportBound = true;
      window.lenis.on('scroll', scheduleDishViewportState);
      unbindNative();
      return true;
    };

    if (!bindLenisScroll()) {
      bindNative();
      const wait = () => {
        if (!bindLenisScroll()) window.setTimeout(wait, 80);
      };
      wait();
    }

    // Expensive geometry invalidation is driven by the settled responsive
    // coordinator instead of every intermediate browser resize event.
    document.addEventListener('westo:responsive-settle', invalidateBoardsAndSync);
    document.addEventListener('westo:relayout', invalidateBoardsAndSync);
    scheduleDishViewportState();
  }

  function activeCategoryId() {
    const order = window.__westoCategoryOrder?.length ? window.__westoCategoryOrder : categoryOrder;
    if (!order.length) return null;
    const idx =
      window.carousel && typeof window.carousel.getIndex === 'function'
        ? window.carousel.getIndex(true)
        : window.carousel && typeof window.carousel.index === 'number'
          ? window.carousel.index
          : 0;
    return order[((idx % order.length) + order.length) % order.length];
  }

  function hideStorySection(el) {
    if (!el || el.dataset.westoTailSkipped) return;
    el.dataset.westoTailSkipped = '1';
    el.setAttribute('hidden', '');
    el.style.display = 'none';
    if (window.ScrollTrigger) {
      window.ScrollTrigger.getAll().forEach((st) => {
        if (st.trigger === el) st.kill();
      });
    }
  }

  function skipProfileForMenuStory() {
    const profile = document.querySelector('section.is-profile');
    if (!profile || profile.dataset.westoSkipped) {
      // still trim tail even if profile already skipped
    } else {
      profile.dataset.westoSkipped = '1';
      profile.setAttribute('hidden', '');
      profile.style.display = 'none';
      // Profile long-desc carousels are ciao leftovers — hide fixed overlays
      document.querySelectorAll('.carousel_title-bis-wrapper, .carousel_title-bis-collection').forEach((el) => {
        el.style.display = 'none';
      });
      // Profile ScrollTrigger used to hide .gamme_container on the way to dishes
      // and never restore it (profile height is now 0, so onEnterBack never fires).
      if (window.ScrollTrigger) {
        window.ScrollTrigger.getAll().forEach((st) => {
          if (st.trigger === profile) st.kill();
        });
      }
      if (window.westoRestoreHeroChrome) window.westoRestoreHeroChrome({ force: true });
      else if (window.gsap) {
        window.gsap.set('.gamme_container', { autoAlpha: 1 });
      }
    }
    trimMenuStoryTail();
  }

  /** Drop everything after the last dish board — FAQ, newsletter, full list, etc. */
  function trimMenuStoryTail() {
    if (document.documentElement.dataset.westoTailTrimmed === '1') {
      if (window.westoRelayout) window.westoRelayout();
      else if (window.ScrollTrigger) window.ScrollTrigger.refresh();
      return;
    }
    document.documentElement.dataset.westoTailTrimmed = '1';

    [
      'section.is-argument',
      'section.is-full-gamme',
      'section.is-faq',
      'section.is-last-copy',
      'section.is-last',
      '#newsletter',
      '.newsletter_container',
      '.footer_container',
    ].forEach((sel) => {
      document.querySelectorAll(sel).forEach(hideStorySection);
    });

    // Keep argument in DOM (hidden) as insertBefore anchor for dish clones
    const arg = document.querySelector('section.is-argument');
    if (arg) {
      arg.setAttribute('hidden', '');
      arg.style.display = 'none';
      arg.dataset.westoTailSkipped = '1';
    }

    // Nav links that pointed at removed story tail
    document
      .querySelectorAll(
        'a.navbar_link[href="#FAQ"], a.navbar_link[href="#newsletter"]',
      )
      .forEach((a) => {
        a.setAttribute('hidden', '');
        a.style.display = 'none';
      });

    if (window.westoRelayout) window.westoRelayout();
    else if (window.ScrollTrigger) window.ScrollTrigger.refresh();
  }

  async function loadMenu() {
    const hasBoards = !!document.querySelector('section.is-benefits');
    try {
      const store = window.westoMenuStore
        ? await window.westoMenuStore.ready
        : await fetch('/api/menu')
            .then((r) => {
              if (!r.ok) throw new Error(`menu request failed (${r.status})`);
              return r.json();
            })
            .then((d) => {
              const byCategory = {};
              (d.menuItems || []).forEach((m) => {
                if (m.available === false) return;
                if (!byCategory[m.categoryId]) byCategory[m.categoryId] = [];
                byCategory[m.categoryId].push(m);
              });
              return {
                byCategory,
                categoryOrder: (d.menuCategories || [])
                  .map((c) => Number(c.id))
                  .filter((id) => (byCategory[id] || []).length),
              };
            });
      menuByCategory = store.byCategory || {};
      categoryOrder = (store.categoryOrder || []).slice();
      resourceScheduler()?.registerMenu?.(store.data || store);
      if (!hasBoards) return;
      skipProfileForMenuStory();
      fillBoards(activeCategoryId());
      bindDishRailClicks();
      bindDishViewportState();
      rebuildDishCatBar(true);
      syncDishCatBar({ instantCenter: true });
      // Boards often fill before three-scene exposes westoBoot — keep trying briefly.
      const tryMarkBoards = () => {
        if (!window.westoBoot?.markBoards) return false;
        window.westoBoot.markBoards(1);
        return true;
      };
      if (!tryMarkBoards()) {
        const timer = window.setInterval(() => {
          if (tryMarkBoards()) window.clearInterval(timer);
        }, 200);
        window.setTimeout(() => window.clearInterval(timer), 20000);
      }
    } catch (e) {
      console.warn('menu load failed', e);
    }
  }

  function bindCarousel() {
    if (!document.querySelector('.carousel_list.is-hero') && !window.carousel) return;
    const tryBind = () => {
      if (!window.carousel || !window.carousel.changed) {
        setTimeout(tryBind, 200);
        return;
      }
      window.carousel.changed.connect(({ index }) => {
        // While reading dishes, do not remap boards from leftover carousel drift.
        if (document.documentElement.classList.contains('is-dish-boards')) return;
        const order = window.__westoCategoryOrder?.length ? window.__westoCategoryOrder : categoryOrder;
        if (!order.length) return;
        fillBoards(order[index % order.length]);
        refreshHeroCatSeatCache();
      });
      fillBoards(activeCategoryId());
      bindDishRailClicks();
      refreshHeroCatSeatCache();
      window.setTimeout(refreshHeroCatSeatCache, 400);
      window.setTimeout(refreshHeroCatSeatCache, 1200);    };
    tryBind();
  }

  // --- quantity modal ---
  let pendingItem = null;
  let pendingQty = 1;
  let qtyFocusBeforeOpen = null;
  const qtyModal = $('#qty-modal');
  const qtyName = $('#qty-modal-name');
  const qtyPrice = $('#qty-modal-price');
  const qtyValue = $('#qty-value');

  function openQtyModal(item) {
    qtyFocusBeforeOpen = document.activeElement;
    pendingItem = item;
    pendingQty = 1;
    pendingFlyFromEl = resolveDishFlySource(item);
    if (qtyName) {
      qtyName.textContent = window.westoI18n?.itemName ? window.westoI18n.itemName(item) : item.name;
    }
    if (qtyPrice) qtyPrice.textContent = formatPrice(item.price);
    if (qtyValue) qtyValue.textContent = pendingQty.toLocaleString(localeTag());
    if (qtyModal) {
      const wasHidden = qtyModal.hidden;
      qtyModal.hidden = false;
      qtyModal.setAttribute('aria-modal', 'true');
      qtyModal.setAttribute('role', 'dialog');
      if (wasHidden) lockScroll();
      bindQtyViewport();
      syncQtyViewport();
      if (wasHidden) {
        const closeX = qtyModal.querySelector('.qty-modal__x');
        if (closeX) closeX.focus({ preventScroll: true });
      }
    }
  }
  function closeQtyModal() {
    pendingItem = null;
    pendingFlyFromEl = null;
    if (qtyModal) {
      qtyModal.hidden = true;
      qtyModal.removeAttribute('aria-modal');
      qtyModal.classList.remove('is-keyboard-open');
      qtyModal.style.removeProperty('--vv-height');
    }
    unlockScroll();
    const back = qtyFocusBeforeOpen;
    qtyFocusBeforeOpen = null;
    if (back?.isConnected && typeof back.focus === 'function') {
      try {
        back.focus({ preventScroll: true });
      } catch (_) {}
    }
  }
  function setPendingQty(n) {
    pendingQty = Math.max(1, Math.min(99, n));
    if (qtyValue) qtyValue.textContent = pendingQty.toLocaleString(localeTag());
  }

  document.addEventListener('click', (e) => {
    const favorite = e.target.closest('[data-dish-favorite]');
    if (favorite && !favorite.disabled) {
      e.preventDefault();
      e.stopPropagation();
      toggleDishFavorite(favorite);
      return;
    }

    const add = e.target.closest('[data-menu-add]');
    if (add && !add.disabled && add.dataset.itemId) {
      e.preventDefault();
      e.stopPropagation();
      const id = Number(add.dataset.itemId);
      const items = Object.values(menuByCategory).flat();
      const item = items.find((m) => m.id === id);
      if (item) {
        // Motion-style: photo arcs into #nav-table-btn on the Add press.
        // Qty can still be adjusted from the table drawer.
        const fromEl = resolveDishFlySource(item);
        addItem(item, 1, { fromEl });
      }
      return;
    }

    if (e.target.closest('#qty-inc')) {
      e.preventDefault();
      setPendingQty(pendingQty + 1);
      return;
    }
    if (e.target.closest('#qty-dec')) {
      e.preventDefault();
      setPendingQty(pendingQty - 1);
      return;
    }
    if (e.target.closest('#qty-confirm')) {
      e.preventDefault();
      if (pendingItem) {
        const item = pendingItem;
        const qty = pendingQty;
        const fromEl = pendingFlyFromEl;
        closeQtyModal();
        addItem(item, qty, { fromEl });
      }
      return;
    }
    if (e.target.matches('.qty-modal__backdrop') || e.target.matches('[data-qty-close]')) {
      if (e.target.closest('.qty-modal__card') && !e.target.matches('[data-qty-close]')) return;
      e.preventDefault();
      closeQtyModal();
      return;
    }

    if (e.target.closest('#nav-table-btn')) {
      e.preventDefault();
      openDrawer();
      return;
    }
    if (e.target.matches('.table-drawer__backdrop') || e.target.matches('[data-table-close]')) {
      // Backdrop or explicit close — ignore clicks that bubbled from the panel body
      if (e.target.closest('.table-drawer__panel') && !e.target.matches('[data-table-close]')) return;
      closeDrawer();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (qtyModal && !qtyModal.hidden && trapFocus(e, qtyModal.querySelector('.qty-modal__card'))) return;
    if (drawer && !drawer.hidden && trapFocus(e, drawer.querySelector('.table-drawer__panel'))) return;
    if (e.key !== 'Escape') return;
    if (qtyModal && !qtyModal.hidden) {
      e.preventDefault();
      closeQtyModal();
      return;
    }
    if (drawer && !drawer.hidden) {
      e.preventDefault();
      closeDrawer();
    }
  });

  if (checkoutBtn) {
    checkoutBtn.addEventListener('click', () => showView('checkout'));
  }
  const backBtn = $('#table-back-btn');
  if (backBtn) backBtn.addEventListener('click', () => showView('cart'));

  const callWaiterBtn = $('#table-call-waiter-btn');
  if (callWaiterBtn) {
    callWaiterBtn.addEventListener('click', async () => {
      const msg = $('#order-msg');
      const params = new URLSearchParams(location.search);
      const rawTable = normalizeDigits((($('#order-table') || {}).value || '').trim() || params.get('table') || '');
      const tableNo = rawTable.trim();
      const rawBranch = normalizeDigits(params.get('branch') || params.get('branchId') || '').replace(/\D/g, '');
      const branchId = rawBranch ? Number(rawBranch) : undefined;
      if (!tableNo) {
        if (msg) {
          msg.textContent = tr('cart.needTable');
          msg.className = 'msg error';
        }
        return;
      }
      try {
        callWaiterBtn.disabled = true;
        const r = await fetch('/api/call-waiter', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tableNo, note: tr('cart.waiterNote'), branchId }),
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || 'خطا');
        if (msg) {
          msg.textContent = tr('cart.waiterOk');
          msg.className = 'msg ok';
        }
        window.dispatchEvent(new CustomEvent('westo:waiter-called', { detail: { tableNo, callId: d.call?.id } }));
      } catch (e) {
        if (msg) {
          msg.textContent = e.message || tr('cart.waiterFail');
          msg.className = 'msg error';
        }
      } finally {
        callWaiterBtn.disabled = false;
      }
    });

  }

  // Prefill table from QR link ?table=
  const tableFromQr = new URLSearchParams(location.search).get('table');
  if (tableFromQr && $('#order-table') && !$('#order-table').value) {
    $('#order-table').value = tableFromQr;
  }

  function initFloatingWaiterCall() {
    const params = new URLSearchParams(location.search);
    const rawTable = normalizeDigits(params.get('table') || params.get('t') || (($('#order-table') || {}).value || '')).trim();
    if (rawTable) {
      try { sessionStorage.setItem('westo_active_table', rawTable); } catch(e) {}
    }
    const savedTable = (() => {
      try { return sessionStorage.getItem('westo_active_table') || ''; } catch(e) { return ''; }
    })();
    const tableNo = rawTable || savedTable;
    if (!tableNo) return; // Only show floating call button when table is known from QR

    const rawBranch = normalizeDigits(params.get('branch') || params.get('branchId') || '').replace(/\D/g, '');
    const branchId = rawBranch ? Number(rawBranch) : undefined;

    if ($('#westo-call-fab-wrap')) return;

    const fabWrap = document.createElement('div');
    fabWrap.id = 'westo-call-fab-wrap';
    fabWrap.className = 'westo-call-fab-wrap';
    fabWrap.innerHTML = `
      <button type="button" id="westo-call-fab" class="westo-call-fab" aria-label="فراخوان گارسون" title="فراخوان گارسون برای میز ${tableNo}">
        <span class="fab-icon">🛎️</span>
        <span class="fab-text">فراخوان گارسون</span>
        <span class="fab-table-badge">میز ${tableNo}</span>
      </button>`;
    document.body.appendChild(fabWrap);

    const modal = document.createElement('div');
    modal.id = 'westo-call-modal';
    modal.className = 'westo-call-modal';
    modal.hidden = true;
    modal.innerHTML = `
      <div class="westo-call-sheet" role="dialog" aria-modal="true" aria-labelledby="westo-call-sheet-title">
        <div class="westo-call-sheet__head">
          <div class="sheet-title-group">
            <span class="sheet-icon">🛎️</span>
            <div>
              <h3 id="westo-call-sheet-title">فراخوان گارسون</h3>
              <p>شماره میز شما: <b>${tableNo}</b></p>
            </div>
          </div>
          <button type="button" class="sheet-close-btn" id="westo-call-sheet-close" aria-label="بستن">✕</button>
        </div>

        <div class="westo-call-presets" id="westo-call-presets">
          <button type="button" class="call-preset-btn active" data-note="حضور گارسون در کنار میز">
            <span class="p-icon">🙋‍♂️</span>
            <span class="p-title">حضور گارسون</span>
            <small>درخواست حضور گارسون در کنار میز</small>
          </button>
          <button type="button" class="call-preset-btn" data-note="درخواست صورت‌حساب و فاکتور">
            <span class="p-icon">🧾</span>
            <span class="p-title">صورت‌حساب / فاکتور</span>
            <small>تسویه و آوردن دستگاه کارتخوان</small>
          </button>
          <button type="button" class="call-preset-btn" data-note="درخواست قاشق و چنگال، دستمال یا لیوان">
            <span class="p-icon">🍴</span>
            <span class="p-title">سرویس و ملزومات</span>
            <small>قاشق، چنگال، دستمال، لیوان، آب</small>
          </button>
          <button type="button" class="call-preset-btn" data-note="سفارش مجدد و مشاوره درباره منو">
            <span class="p-icon">💬</span>
            <span class="p-title">سفارش مجدد / راهنمایی</span>
            <small>مشاوره آیتم‌ها یا ثبت سفارش تکمیلی</small>
          </button>
        </div>

        <div class="westo-call-note-field">
          <label for="westo-call-custom-note">توضیح اختیاری برای گارسون</label>
          <input id="westo-call-custom-note" type="text" placeholder="مثلاً: دو لیوان آب یخ لطفاً…" maxlength="100" />
        </div>

        <div class="westo-call-actions">
          <button type="button" class="westo-call-submit-btn" id="westo-call-submit">
            <span>ارسال فراخوان گارسون</span>
            <span>🔔</span>
          </button>
        </div>
      </div>`;
    document.body.appendChild(modal);

    const fab = $('#westo-call-fab');
    const closeBtn = $('#westo-call-sheet-close');
    const submitBtn = $('#westo-call-submit');
    const noteInput = $('#westo-call-custom-note');
    let selectedNote = 'حضور گارسون در کنار میز';
    let activeCallId = null;
    let cooldownTimer = null;

    modal.querySelectorAll('.call-preset-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        modal.querySelectorAll('.call-preset-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        selectedNote = btn.dataset.note || 'حضور گارسون در کنار میز';
      });
    });

    const openModal = () => {
      if (fab.classList.contains('is-calling')) return;
      modal.hidden = false;
      if (noteInput) noteInput.value = '';
    };

    const closeModal = () => {
      modal.hidden = true;
    };

    fab.addEventListener('click', (e) => {
      if (e.target.closest('.fab-cancel-btn')) return;
      openModal();
    });

    closeBtn.addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal();
    });

    const setCallingState = (callId, initialRemaining = 60) => {
      activeCallId = callId;
      fab.classList.add('is-calling');
      let remaining = Math.max(1, Math.min(60, initialRemaining));
      try {
        sessionStorage.setItem('westo_active_call', JSON.stringify({
          tableNo,
          callId,
          startedAt: Date.now() - (60 - remaining) * 1000
        }));
      } catch(e) {}

      const updateFabText = (sec) => {
        const textEl = fab.querySelector('.fab-text');
        if (textEl) textEl.textContent = `گارسون در راه است (${sec}ث)`;
      };

      fab.innerHTML = `
        <span class="fab-icon">✓</span>
        <span class="fab-text">گارسون در راه است (${remaining}ث)</span>
        <button type="button" class="fab-cancel-btn" title="انصراف از درخواست">انصراف</button>
      `;

      if (cooldownTimer) clearInterval(cooldownTimer);
      cooldownTimer = setInterval(() => {
        remaining--;
        if (remaining > 0) {
          updateFabText(remaining);
        } else {
          clearInterval(cooldownTimer);
          resetCallingState();
        }
      }, 1000);

      const bindCancel = () => {
        const cancelBtn = fab.querySelector('.fab-cancel-btn');
        if (cancelBtn) {
          cancelBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            try {
              await fetch('/api/call-waiter/cancel', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tableNo, callId: activeCallId })
              });
            } catch(err) {}
            clearInterval(cooldownTimer);
            resetCallingState();
          });
        }
      };
      bindCancel();
    };

    const resetCallingState = () => {
      try { sessionStorage.removeItem('westo_active_call'); } catch(e) {}
      fab.classList.remove('is-calling');
      activeCallId = null;
      fab.innerHTML = `
        <span class="fab-icon">🛎️</span>
        <span class="fab-text">فراخوان گارسون</span>
        <span class="fab-table-badge">میز ${tableNo}</span>
      `;
    };

    // Restore active cooldown across page navigation or refresh
    try {
      const savedCall = JSON.parse(sessionStorage.getItem('westo_active_call') || 'null');
      if (savedCall && savedCall.startedAt) {
        const elapsed = Math.floor((Date.now() - savedCall.startedAt) / 1000);
        if (elapsed < 60) {
          setCallingState(savedCall.callId, 60 - elapsed);
        } else {
          sessionStorage.removeItem('westo_active_call');
        }
      }
    } catch(e) {}

    // Listen to calls initiated from other UI parts (e.g. cart checkout drawer)
    window.addEventListener('westo:waiter-called', (e) => {
      if (e.detail?.callId) {
        setCallingState(e.detail.callId);
      }
    });


    submitBtn.addEventListener('click', async () => {
      const customNote = (noteInput?.value || '').trim();
      const finalNote = customNote ? `${selectedNote}: ${customNote}` : selectedNote;
      submitBtn.disabled = true;
      submitBtn.textContent = 'در حال ارسال…';

      try {
        const res = await fetch('/api/call-waiter', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tableNo, note: finalNote, branchId })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'خطا در برقراری ارتباط');
        closeModal();
        setCallingState(data.call?.id);
      } catch (err) {
        alert(err.message || 'ثبت فراخوان با خطا مواجه شد. لطفاً دوباره تلاش کنید.');
      } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = `<span>ارسال فراخوان گارسون</span> <span>🔔</span>`;
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initFloatingWaiterCall);
  } else {
    initFloatingWaiterCall();
  }


  const phoneInput = $('#order-phone');
  if (phoneInput) {
    phoneInput.addEventListener('input', () => {
      phoneInput.value = normalizeDigits(phoneInput.value).replace(/\D/g, '').slice(0, 11);
    });
  }

  const submitBtn = $('#table-submit-btn');
  if (submitBtn) {
    submitBtn.addEventListener('click', async () => {
      const msg = $('#order-msg');
      const tableNo = ($('#order-table') || {}).value || '';
      const name = ($('#order-name') || {}).value || '';
      const phone = normalizeDigits(($('#order-phone') || {}).value || '');
      const payEl = document.querySelector('input[name="pay"]:checked');
      const paymentMethod = payEl ? payEl.value : 'cashier';

      if (msg) {
        msg.textContent = '';
        msg.className = 'msg';
      }
      if (!tableNo.trim()) {
        if (msg) {
          msg.textContent = tr('cart.needTable');
          msg.className = 'msg error';
        }
        return;
      }
      if (!/^09\d{9}$/.test(phone)) {
        if (msg) {
          msg.textContent = 'شماره موبایل معتبر نیست';
          msg.className = 'msg error';
        }
        return;
      }

      submitBtn.disabled = true;
      submitBtn.classList.add('is-busy');
      submitBtn.setAttribute('aria-busy', 'true');
      const prevLabel = submitBtn.textContent;
      submitBtn.textContent = tr('cart.submitting');
      try {
        const params = new URLSearchParams(location.search);
        const rawBranch = normalizeDigits(params.get('branch') || params.get('branchId') || '').replace(/\D/g, '');
        const branchId = rawBranch ? Number(rawBranch) : undefined;
        const r = await fetch('/api/orders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tableNo: tableNo.trim(),
            name: name.trim(),
            phone,
            paymentMethod,
            branchId,
            items: cart.map((l) => ({ menuItemId: l.menuItemId, qty: l.qty })),
          }),
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || tr('cart.submitFail'));

        cart = [];
        saveCart(cart);
        const done = $('#table-done-msg');
        if (done) {
          const payLabel =
            paymentMethod === 'online'
              ? tr('cart.onlineDone')
              : tr('cart.counterDone');
          done.innerHTML = `
            <span class="table-done-kicker">${escapeHtml(tr('cart.doneKicker'))}</span>
            <span class="table-done-id" dir="ltr">#${escapeHtml(String(d.order.id))}</span>
            <span class="table-done-meta">${escapeHtml(tr('cart.tableLabel'))} ${escapeHtml(d.order.tableNo)}</span>
            <span class="table-done-pay">${payLabel}</span>
            <span class="table-done-total">${formatPrice(d.order.total)}</span>
            <a class="table-done-feedback" href="/feedback?order=${encodeURIComponent(d.order.id)}${branchId ? `&branch=${branchId}` : ''}&src=order">${escapeHtml(tr('cart.feedback'))}</a>`;
        }
        showView('done');
      } catch (err) {
        if (msg) {
          msg.textContent = err.message;
          msg.className = 'msg error';
        }
      } finally {
        submitBtn.disabled = false;
        submitBtn.classList.remove('is-busy');
        submitBtn.removeAttribute('aria-busy');
        submitBtn.textContent = prevLabel || tr('cart.submit');
      }
    });
  }

  function goToCategories() {
    window.__westoRailNavLock = null;
    window.clearTimeout(window.__westoRailNavLockTimer);
    catStepGuardUntil = 0;
    // Hold dish-mode off until scroll is actually in the hero. Releasing too
    // early lets the scroll sync re-add is-dish-boards while Lenis is mid-page.
    forceHeroReturn = true;
    forceHeroReturnUntil = Date.now() + 2800;
    try {
      killCatFly();
    } catch (_) {}
    try {
      if (typeof cancelScrollCatFly === 'function') cancelScrollCatFly();
    } catch (_) {}
    scrollFlyLanded = false;
    catFlyBusy = false;
    pendingDishRevealEl = null;

    const root = document.documentElement;
    root.classList.remove(
      'is-dish-boards',
      'is-cat-flying',
      'is-cat-scroll-fly',
      'is-cat-fly-covered',
      'is-cat-fly-chrome-in',
      'is-cat-fly-dish-in',
      'is-cat-fly-media-under',
      'is-cat-fly-handoff',
    );

    const hardPinHero = () => {
      try {
        if (window.lenis) {
          if (window.lenis.isStopped && typeof window.lenis.start === 'function') {
            window.lenis.start();
          }
          window.lenis.scrollTo(0, {
            offset: 0,
            immediate: true,
            force: true,
            lock: true,
          });
        }
        window.scrollTo(0, 0);
        document.documentElement.scrollTop = 0;
        document.body.scrollTop = 0;
      } catch (_) {}
    };

    const releaseIfInHero = () => {
      const scrollY = window.lenis?.animatedScroll ?? window.lenis?.scroll ?? window.scrollY ?? 0;
      const heroEl = document.querySelector('section.is-gamme');
      const heroH = heroEl?.offsetHeight || window.innerHeight || 800;
      if (scrollY < heroH * 0.28) {
        forceHeroReturn = false;
        forceHeroReturnUntil = Date.now() + 180;
        return true;
      }
      return false;
    };

    const finish = () => {
      hardPinHero();
      scrollFlyLanded = false;
      catFlyBusy = false;
      root.classList.remove(
        'is-dish-boards',
        'is-cat-flying',
        'is-cat-scroll-fly',
        'is-cat-fly-covered',
        'is-cat-fly-chrome-in',
        'is-cat-fly-dish-in',
        'is-cat-fly-media-under',
        'is-cat-fly-handoff',
      );
      if (window.westoRestoreHeroChrome) window.westoRestoreHeroChrome({ force: true });
      if (window.westoRestoreHeroScene) window.westoRestoreHeroScene({ hidden: false });
      syncBackCategoriesBtn();
      syncDishCatBar({ skipReveal: true });
      releaseIfInHero();
    };

    hardPinHero();
    if (window.westoRestoreHeroChrome) window.westoRestoreHeroChrome({ force: true });
    if (window.westoRestoreHeroScene) window.westoRestoreHeroScene({ hidden: false });
    syncBackCategoriesBtn();
    syncDishCatBar({ skipReveal: true });

    requestAnimationFrame(() => {
      requestAnimationFrame(finish);
    });
    window.setTimeout(finish, 60);
    window.setTimeout(finish, 220);
    window.setTimeout(() => {
      hardPinHero();
      if (!releaseIfInHero()) {
        // Absolute failsafe so horizontal dish steps cannot stay blocked forever.
        forceHeroReturn = false;
        forceHeroReturnUntil = Date.now() + 120;
      }
      syncBackCategoriesBtn();
    }, 2600);
  }

  function syncBackCategoriesBtn() {
    const btn = $('#westo-back-categories');
    if (!btn) return;
    const onDishes = document.documentElement.classList.contains('is-dish-boards');
    btn.hidden = !onDishes;
    btn.setAttribute('aria-hidden', onDishes ? 'false' : 'true');
  }

  function recoverStableDishInteractionState() {
    const root = document.documentElement;
    const stable = root.classList.contains('is-dish-boards') && !root.classList.contains('is-cat-flying');
    if (!stable) return false;
    // State flags are implementation details of the hero→dish fly. They must
    // never leave a visible, settled category bar non-interactive.
    if (catFlyBusy) catFlyBusy = false;
    if (scrollCatFly) scrollCatFly = null;
    return true;
  }

  function selectDishCatChip(chip) {
    const stable = recoverStableDishInteractionState();
    if (!chip || chip.disabled) return;
    if (!stable && (catFlyBusy || scrollCatFly || document.documentElement.classList.contains('is-cat-flying'))) return;
    const idx = Number(chip.dataset.catIndex);
    const id = chip.dataset.categoryId;
    if (!id || !Number.isFinite(idx)) return;    // #endregion
    selectDishCategory(id, idx);
  }

  let catBarChipTap = null;
  let catBarChipTapHandled = false;
  /** Brief guard against ghost click right after track drag-scroll. */
  let catBarIgnoreClickUntil = 0;

  function armCatBarGhostClickGuard(ms = 60) {
    catBarIgnoreClickUntil = Date.now() + ms;
  }

  function bindCatBarChipTap(bar) {
    if (!bar || bar.dataset.chipTapBound === '1') return;
    bar.dataset.chipTapBound = '1';

    bar.addEventListener(
      'pointerover',
      (e) => {
        // Touch browsers synthesize pointerover before a tap. Prefetching here
        // duplicated work with pointerdown intent and could wake the scheduler
        // while the user was simply panning the strip. Hover preview is desktop-only.
        if (e.pointerType === 'touch') return;
        const chip = e.target.closest('.westo-dish-catbar__chip');
        if (!chip || chip.disabled || chip.contains(e.relatedTarget)) return;
        resourceScheduler()?.previewCategory?.(chip.dataset.categoryId, {
          reason: 'catbar-hover',
        });
      },
      { passive: true },
    );

    bar.addEventListener(
      'pointerdown',
      (e) => {
        const chip = e.target.closest('.westo-dish-catbar__chip');
        recoverStableDishInteractionState();
        if (!chip || chip.disabled || catFlyBusy || scrollCatFly || document.documentElement.classList.contains('is-cat-flying')) {
          catBarChipTap = null;
          return;
        }
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        catBarChipTapHandled = false;
        resourceScheduler()?.intentCategory?.(chip.dataset.categoryId, {
          reason: 'catbar-pointerdown',
          slot: 0,
        });
        catBarChipTap = {
          chip,
          pointerId: e.pointerId,
          x: e.clientX,
          y: e.clientY,
          moved: false,
        };
      },
      true,
    );

    bar.addEventListener(
      'pointermove',
      (e) => {
        if (!catBarChipTap || catBarChipTap.pointerId !== e.pointerId) return;
        const dx = e.clientX - catBarChipTap.x;
        const dy = e.clientY - catBarChipTap.y;
        if (Math.hypot(dx, dy) > 8) catBarChipTap.moved = true;
      },
      true,
    );

    const finishChipTap = (e) => {
      if (!catBarChipTap || catBarChipTap.pointerId !== e.pointerId) return;
      const tap = catBarChipTap;
      catBarChipTap = null;
      if (tap.moved || Date.now() < catBarIgnoreClickUntil) return;
      catBarChipTapHandled = true;
      selectDishCatChip(tap.chip);
    };

    bar.addEventListener('pointerup', finishChipTap, true);
    bar.addEventListener('pointercancel', () => {
      catBarChipTap = null;
    }, true);

    // Fallback when pointerup path is skipped (older WebViews).
    bar.addEventListener('click', (e) => {
      if (catBarChipTapHandled) {
        catBarChipTapHandled = false;
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (Date.now() < catBarIgnoreClickUntil) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      const chip = e.target.closest('.westo-dish-catbar__chip');
      if (!chip || chip.disabled) return;
      selectDishCatChip(chip);
    });

    // Roving keyboard focus for the one canonical (middle) loop copy. The two
    // visual clones stay clickable by pointer but never become duplicate tab
    // stops or duplicate announcements for assistive technology.
    bar.addEventListener('keydown', (e) => {
      const chip = e.target.closest('.westo-dish-catbar__chip');
      if (!chip || chip.dataset.loopCopy !== '1') return;
      const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
      if (!keys.includes(e.key)) return;
      const canonical = [
        ...bar.querySelectorAll('.westo-dish-catbar__chip[data-loop-copy="1"]'),
      ];
      if (!canonical.length) return;
      const current = Math.max(0, canonical.indexOf(chip));
      let next = current;
      if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = canonical.length - 1;
      else if (e.key === 'ArrowRight') next = (current + 1) % canonical.length;
      else next = (current - 1 + canonical.length) % canonical.length;
      e.preventDefault();
      canonical[next].focus({ preventScroll: true });
      selectDishCatChip(canonical[next]);
    });
  }

  // Capture-phase safety net: a visible category button must always win over
  // WebGL/page swipe arbitration. Pointer-up is the primary mobile activation
  // path because a horizontal scroller/browser may suppress the synthetic click.
  // The click listener remains only as a keyboard/legacy fallback.
  if (!document.documentElement.dataset.westoDishCatCaptureBound) {
    document.documentElement.dataset.westoDishCatCaptureBound = '1';
    let directPointer = null;
    const directChip = (e, { fromPointer = false } = {}) => {
      const chip = e.target?.closest?.('#westo-dish-catbar .westo-dish-catbar__chip[data-category-id]');
      if (!chip || chip.disabled) return false;
      const root = document.documentElement;
      const bar = chip.closest('#westo-dish-catbar');
      const stable = root.classList.contains('is-dish-boards') &&
        !root.classList.contains('is-cat-flying') && bar && !bar.hidden;
      if (!stable) return false;
      recoverStableDishInteractionState();
      const idx = Number(chip.dataset.catIndex);
      const id = chip.dataset.categoryId;
      if (!id || !Number.isFinite(idx)) return false;
      if (fromPointer && directPointer) {
        const dx = Number(e.clientX || 0) - directPointer.x;
        const dy = Number(e.clientY || 0) - directPointer.y;
        if (Math.hypot(dx, dy) > 10) return false;
      }
      e.preventDefault();
      e.stopPropagation();
      if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
      catBarChipTap = null;
      catBarChipTapHandled = true;
      selectDishCategory(id, idx, { mode: 'click' });
      return true;
    };
    document.addEventListener('pointerdown', (e) => {
      const chip = e.target?.closest?.('#westo-dish-catbar .westo-dish-catbar__chip[data-category-id]');
      if (!chip || (e.pointerType === 'mouse' && e.button !== 0)) { directPointer = null; return; }
      directPointer = { id: e.pointerId, x: e.clientX, y: e.clientY };
    }, true);
    document.addEventListener('pointerup', (e) => {
      if (!directPointer || directPointer.id !== e.pointerId) return;
      const start = directPointer;
      directPointer = start;
      directChip(e, { fromPointer: true });
      directPointer = null;
    }, true);
    document.addEventListener('pointercancel', () => { directPointer = null; }, true);
    document.addEventListener('click', (e) => {
      // Pointer activation was already committed on pointerup. Prevent the
      // follow-up synthetic click from selecting twice.
      if (catBarChipTapHandled) {
        const chip = e.target?.closest?.('#westo-dish-catbar .westo-dish-catbar__chip[data-category-id]');
        if (chip) {
          catBarChipTapHandled = false;
          e.preventDefault();
          e.stopPropagation();
          if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
          return;
        }
      }
      directChip(e);
    }, true);
  }

  function ensureDishCatBar() {
    let bar = $('#westo-dish-catbar');
    if (bar) {
      // Legacy: was nested under .navbar and stole hero swipe/scroll via isUiChromeClick.
      if (bar.parentElement?.classList?.contains('navbar') || bar.tagName === 'NAV') {
        const next = document.createElement('div');
        next.id = bar.id;
        next.className = bar.className;
        next.hidden = bar.hidden;
        next.setAttribute('aria-label', bar.getAttribute('aria-label') || '');
        next.setAttribute('aria-hidden', bar.getAttribute('aria-hidden') || 'true');
        next.innerHTML = bar.innerHTML;
        bar.replaceWith(next);
        bar = next;
      }
      if (bar.parentElement !== document.body) {
        document.body.appendChild(bar);
      }
      bar.setAttribute('role', 'navigation');
      ensureDishSubBar(bar);
      bindCatBarChipTap(bar);
      return bar;
    }
    bar = document.createElement('div');
    bar.id = 'westo-dish-catbar';
    bar.className = 'westo-dish-catbar';
    bar.hidden = true;
    bar.setAttribute('aria-label', tr('nav.categories') || 'دسته‌ها');
    bar.setAttribute('aria-hidden', 'true');
    bar.setAttribute('role', 'navigation');
    bar.innerHTML = '<div class="westo-dish-catbar__track" role="toolbar"></div>';
    ensureDishSubBar(bar);
    // Must NOT live under .navbar — hero swipe treats .navbar hits as chrome.
    document.body.appendChild(bar);
    bindCatBarChipTap(bar);
    return bar;
  }

  /** Prefer middle loop copy so active always has L/R neighbors (infinite strip). */
  function findCatBarChip(bar, categoryId, { preferMiddle = true } = {}) {
    if (!bar || categoryId == null) return null;
    const chips = [
      ...bar.querySelectorAll(`.westo-dish-catbar__chip[data-category-id="${categoryId}"]`),
    ];
    if (!chips.length) return null;
    if (!preferMiddle || chips.length === 1) return chips[0];
    return chips.find((c) => c.dataset.loopCopy === '1') || chips[Math.floor(chips.length / 2)];
  }

  function syncCatBarA11y(bar, categoryId) {
    if (!bar) return;
    const track = bar.querySelector('.westo-dish-catbar__track');
    if (!track) return;
    track.setAttribute('role', 'toolbar');
    track.setAttribute('aria-label', tr('nav.categories') || 'دسته‌ها');
    const activeId = String(categoryId ?? '');
    const infinite = Number(track.dataset.loopLen) >= 2;
    bar.querySelectorAll('.westo-dish-catbar__chip').forEach((chip) => {
      const canonical = !infinite || chip.dataset.loopCopy === '1';
      const on = chip.dataset.categoryId === activeId;
      chip.setAttribute('aria-current', on ? 'true' : 'false');
      chip.tabIndex = canonical && on ? 0 : -1;
      if (canonical) chip.removeAttribute('aria-hidden');
      else chip.setAttribute('aria-hidden', 'true');
    });
  }

  /** Closest on-screen copy — used for navigation (never cross the whole strip). */
  function findNearestCatBarChip(bar, categoryId) {
    if (!bar || categoryId == null) return null;
    const track = bar.querySelector('.westo-dish-catbar__track') || bar;
    const trackRect = track.getBoundingClientRect();
    const midX = trackRect.left + trackRect.width / 2;
    const scroll = track.scrollLeft || 0;
    const chips = [
      ...bar.querySelectorAll(`.westo-dish-catbar__chip[data-category-id="${categoryId}"]`),
    ];
    let best = null;
    let bestDist = Infinity;
    chips.forEach((chip) => {
      const r = chip.getBoundingClientRect();
      if (r.width < 2) return;
      // Prefer screen distance; fall back to scroll-space distance for offscreen copies.
      const screenDist = Math.abs(r.left + r.width / 2 - midX);
      const scrollDist = Math.abs(chip.offsetLeft + r.width / 2 - (scroll + track.clientWidth / 2));
      const dist = Math.min(screenDist, scrollDist);
      if (dist < bestDist) {
        bestDist = dist;
        best = chip;
      }
    });
    return best || findCatBarChip(bar, categoryId, { preferMiddle: false });
  }

  /**
   * Pick a loop copy whose centered scrollLeft is in-range and closest to current.
   * Plain "nearest on screen" fails at scrollLeft≈0: the edge copy wants a negative
   * scroll that clamps, so the strip never moves (tick/theme change, catbar stuck).
   */
  function pickCatBarCenterPlan(bar, categoryId, track) {
    if (!bar || !track || categoryId == null) return null;
    const chips = [
      ...bar.querySelectorAll(`.westo-dish-catbar__chip[data-category-id="${categoryId}"]`),
    ];
    if (!chips.length) return null;
    const setW = measureCatBarLoopSet(track) || Number(track.dataset.loopSetWidth) || 0;
    const cur = track.scrollLeft || 0;
    const maxScroll = Math.max(0, track.scrollWidth - track.clientWidth);
    const trackRect = track.getBoundingClientRect();
    if (!trackRect.width) return null;
    const midX = trackRect.left + trackRect.width / 2;

    let best = null;
    let bestScore = Infinity;
    chips.forEach((chip) => {
      const r = chip.getBoundingClientRect();
      if (r.width < 2) return;
      const delta = r.left + r.width / 2 - midX;
      const raw = cur + delta;
      const candidates = [raw];
      if (setW > 16) {
        for (let k = -2; k <= 2; k += 1) candidates.push(raw + k * setW);
      }
      candidates.forEach((t) => {
        if (t < -0.5 || t > maxScroll + 0.5) return;
        const score = Math.abs(t - cur);
        if (score < bestScore) {
          bestScore = score;
          best = { chip, target: t };
        }
      });
    });

    if (best) return best;

    const fallback =
      chips.find((c) => c.dataset.loopCopy === '1') ||
      findNearestCatBarChip(bar, categoryId) ||
      chips[0];
    const r = fallback.getBoundingClientRect();
    let t = cur + (r.left + r.width / 2 - midX);
    if (setW > 16) {
      while (t < 0) t += setW;
      while (t > maxScroll) t -= setW;
    }
    t = Math.max(0, Math.min(maxScroll, t));
    return { chip: fallback, target: t };
  }

  /** While user scrubs the catbar, sync must not yank scroll back to active. */
  let catBarUserScrubUntil = 0;
  /** User manually offset the strip — keep selection until explicit chip click/step. */
  let catBarBrowsing = false;
  /** Ignore scroll events caused by centering / infinite-loop rebalance. */
  let catBarProgrammaticScroll = false;
  /** Absolute deadline so programmatic flag can never stick forever after a killed tween. */
  let catBarProgrammaticUntil = 0;
  let catBarPageWheelBound = false;
  let catBarScrollTween = null;
  let catBarNativeCenterTimer = 0;
  /**
   * After a page-level horizontal category step, keep the user pinned in dish
   * mode so trackpad residual deltaY cannot eject them into the hero/main menu.
   */
  let catStepGuardUntil = 0;

  function markCatBarUserScrub(ms = 900) {
    catBarUserScrubUntil = Date.now() + ms;
  }

  function markCatBarBrowsing() {
    catBarBrowsing = true;
    markCatBarUserScrub(1800);
  }

  function clearCatBarBrowsing() {
    catBarBrowsing = false;
    catBarUserScrubUntil = 0;
  }

  function beginCatBarProgrammatic(ms = 900) {
    catBarProgrammaticScroll = true;
    catBarProgrammaticUntil = Date.now() + Math.max(120, ms);
  }

  function endCatBarProgrammatic() {
    catBarProgrammaticScroll = false;
    catBarProgrammaticUntil = 0;
  }

  /** True only while a live programmatic scroll is in progress (auto-heals if stuck). */
  function isCatBarProgrammatic() {
    if (!catBarProgrammaticScroll) return false;
    if (Date.now() > catBarProgrammaticUntil) {
      endCatBarProgrammatic();
      return false;
    }
    return true;
  }

  /** Kill centering tween AND clear the programmatic lock (GSAP kill skips onComplete). */
  function killCatBarScrollTween() {
    if (catBarScrollTween?.kill) {
      try {
        catBarScrollTween.kill();
      } catch (_) {}
    }
    catBarScrollTween = null;
    if (catBarNativeCenterTimer) {
      window.clearTimeout(catBarNativeCenterTimer);
      catBarNativeCenterTimer = 0;
    }
    endCatBarProgrammatic();
  }

  function isCatBarUserScrubbing() {
    return catBarBrowsing || Date.now() < catBarUserScrubUntil || catFlyBusy;
  }

  function isCatStepGuarded() {
    return Date.now() < catStepGuardUntil;
  }

  /** Ensure track can scroll whenever we are not mid-fly. */
  function ensureCatBarTrackInteractive(bar) {
    if (!bar) return;
    // If the settled dish UI is visible, transitional flags are stale by
    // definition and must never disable its native controls.
    recoverStableDishInteractionState();
    if (catFlyBusy || scrollCatFly || document.documentElement.classList.contains('is-cat-flying')) {
      return;
    }
    const track = bar.querySelector?.('.westo-dish-catbar__track');
    if (!track) return;
    if (track.style.overflowX === 'hidden') {
      lockCatBarTrack(bar, false);
    }
    if (track.style.touchAction === 'none') {
      track.style.touchAction = 'pan-x';
    }
  }

  function pinScrollToDishBoards({ immediate = true } = {}) {
    if (isForcingHeroReturn()) return null;
    const boards = dishBoardsCache?.length ? dishBoardsCache : refreshDishBoardsCache();
    const first = boards[0];
    if (!first) return null;
    const top = Math.max(0, (dishBoardMetrics?.[0]?.top ?? first.offsetTop ?? 0) + 4);
    document.documentElement.classList.add('is-dish-boards');
    scrollFlyLanded = true;
    if (window.lenis?.scrollTo) {
      window.lenis.scrollTo(top, { immediate: Boolean(immediate), lock: true });
    } else {
      window.scrollTo(0, top);
    }
    return first;
  }  /** Wipe prior catbar scroll handlers (clone) so upgrades aren't stacked. */
  function remountCatBarTrack(track, engine) {
    if (!track?.parentNode) return track;
    if (track.dataset.scrollEngine === engine) return track;
    const sl = track.scrollLeft;
    const fresh = track.cloneNode(true);
    fresh.dataset.scrollEngine = engine;
    delete fresh.dataset.userScrollBound;
    delete fresh.dataset.loopBound;
    track.parentNode.replaceChild(fresh, track);
    fresh.scrollLeft = sl;
    return fresh;
  }

  /**
   * Native-first catbar scroll:
   * - Trackpad horizontal swipe → browser momentum (no preventDefault)
   * - Touch pan → native overflow scrolling
   * - Vertical wheel over strip → mapped to scrollLeft
   * - No snap / settle (those killed soft trackpad feel)
   */
  function bindCatBarUserScroll(track) {
    if (!track || track.dataset.userScrollBound === 'native3') return track;
    track.dataset.userScrollBound = 'native3';

    if (track._catScrollAbort) {
      try {
        track._catScrollAbort.abort();
      } catch (_) {}
    }
    const ac = new AbortController();
    track._catScrollAbort = ac;
    const { signal } = ac;

    track.setAttribute('data-lenis-prevent', '');
    track.setAttribute('data-lenis-prevent-touch', '');
    track.setAttribute('data-lenis-prevent-wheel', '');
    track.style.scrollSnapType = 'none';
    track.style.scrollBehavior = 'auto';
    track.style.webkitOverflowScrolling = 'touch';
    track.style.touchAction = 'pan-x';

    track.addEventListener(
      'wheel',
      (e) => {
        if (catFlyBusy || scrollCatFly || isForcingHeroReturn()) return;
        const ax = Math.abs(e.deltaX);
        const ay = Math.abs(e.deltaY);
        if (ax < 0.5 && ay < 0.5) return;

        // Horizontal trackpad/mouse: native overflow keeps OS inertia.
        if (ax >= ay) {
          killCatBarScrollTween();
          markCatBarBrowsing();
          e.stopPropagation();
          return;
        }

        // Vertical wheel over the strip → horizontal scrub.
        let dy = e.deltaY;
        if (e.deltaMode === 1) dy *= 16;
        else if (e.deltaMode === 2) dy *= Math.max(120, track.clientWidth * 0.35);
        e.preventDefault();
        e.stopPropagation();
        killCatBarScrollTween();
        markCatBarBrowsing();
        track.scrollLeft += dy;
      },
      { passive: false, signal },
    );

    // Mouse/pen drag — 1:1 scrub, light coast, no snap.
    let drag = null;
    track.addEventListener(
      'pointerdown',
      (e) => {
        if (catFlyBusy || scrollCatFly || isForcingHeroReturn()) return;
        if (e.pointerType === 'touch') return;
        if (e.button != null && e.button !== 0) return;
        drag = {
          pointerId: e.pointerId,
          startX: e.clientX,
          startScroll: track.scrollLeft,
          lastX: e.clientX,
          lastT: performance.now(),
          vx: 0,
          moved: false,
        };
        track.classList.add('is-dragging');
        try {
          track.setPointerCapture(e.pointerId);
        } catch (_) {}
      },
      { signal },
    );
    track.addEventListener(
      'pointermove',
      (e) => {
        if (!drag || drag.pointerId !== e.pointerId) return;
        const now = performance.now();
        const delta = e.clientX - drag.startX;
        const dt = Math.max(8, now - drag.lastT);
        const frameDx = e.clientX - drag.lastX;
        drag.vx = drag.vx * 0.55 + (-frameDx / dt) * 16;
        drag.lastX = e.clientX;
        drag.lastT = now;
        if (Math.abs(delta) > 4) drag.moved = true;
        if (!drag.moved) return;
        e.preventDefault();
        markCatBarBrowsing();
        if (catBarChipTap) catBarChipTap.moved = true;
        killCatBarScrollTween();
        track.scrollLeft = drag.startScroll - delta;
      },
      { signal },
    );
    const endDrag = (e) => {
      if (!drag || (e && drag.pointerId !== e.pointerId)) return;
      const moved = drag.moved;
      let vx = drag.vx;
      drag = null;
      track.classList.remove('is-dragging');
      if (!moved) return;
      armCatBarGhostClickGuard();
      markCatBarBrowsing();
      vx = Math.max(-55, Math.min(55, vx * 14));
      if (Math.abs(vx) < 1.2) return;
      let frames = 0;
      const coast = () => {
        if (catFlyBusy || scrollCatFly || Math.abs(vx) < 0.35 || frames > 45) return;
        track.scrollLeft += vx;
        vx *= 0.92;
        frames += 1;
        requestAnimationFrame(coast);
      };
      requestAnimationFrame(coast);
    };
    track.addEventListener('pointerup', endDrag, { signal });
    track.addEventListener('pointercancel', endDrag, { signal });
    track.addEventListener('lostpointercapture', endDrag, { signal });

    let touchMoved = false;
    track.addEventListener(
      'touchstart',
      () => {
        touchMoved = false;
      },
      { passive: true, signal },
    );
    track.addEventListener(
      'touchmove',
      () => {
        touchMoved = true;
        markCatBarBrowsing();
      },
      { passive: true, signal },
    );
    track.addEventListener(
      'touchend',
      () => {
        if (touchMoved) armCatBarGhostClickGuard(80);
      },
      { passive: true, signal },
    );

    track.addEventListener(
      'scroll',
      () => {
        if (catFlyBusy || scrollCatFly || isCatBarProgrammatic()) return;
        markCatBarBrowsing();
      },
      { passive: true, signal },
    );

    return track;
  }

  function bindCatBarPageWheel() {
    if (catBarPageWheelBound) return;
    catBarPageWheelBound = true;

    let stepLockUntil = 0;
    let stepArmAfter = 0;
    let axisAccum = 0;
    let gestureAxis = null; // 'x' | 'y' | null
    let gestureHasStepped = false;
    let quietSince = 0;
    let gestureIdleTimer = 0;
    // One intentional flick → one category. Trackpad inertia must NOT chain
    // a second step — but must ALWAYS re-arm (hard deadline, not quiet-only).
    const STEP_COOLDOWN_MS = 560;
    const STEP_REARM_MS = 920;
    const STEP_THRESHOLD = 42;
    const GUARD_MS = 640;
    const GESTURE_IDLE_MS = 280;
    const QUIET_DELTA = 1.6;
    const QUIET_MS = 110;

    function categoryOrderList() {
      return window.__westoCategoryOrder?.length ? window.__westoCategoryOrder : categoryOrder;
    }

    function resetGestureState() {
      gestureAxis = null;
      axisAccum = 0;
      gestureHasStepped = false;
      quietSince = 0;
    }

    function clearGestureSoon() {
      window.clearTimeout(gestureIdleTimer);
      gestureIdleTimer = window.setTimeout(() => {
        const now = Date.now();
        // Never drop the post-step swallow early — that re-armed mid-inertia
        // and made the 2nd/3rd trackpad flick feel broken or double-skip.
        if (gestureHasStepped && now < stepArmAfter) {
          clearGestureSoon();
          return;
        }
        resetGestureState();
      }, GESTURE_IDLE_MS);
    }

    function stepDishCategory(dir) {
      if (isForcingHeroReturn()) return false;
      if (catFlyBusy || scrollCatFly || document.documentElement.classList.contains('is-cat-flying')) {
        return false;
      }
      const order = categoryOrderList();
      if (!order.length) return false;
      const now = Date.now();
      if (now < stepLockUntil) return false;
      const activeId =
        lastFilledCategoryId != null ? String(lastFilledCategoryId) : String(activeCategoryId() ?? '');
      let idx = order.findIndex((id) => String(id) === String(activeId));
      if (idx < 0) idx = 0;
      const next = (idx + dir + order.length) % order.length;
      stepLockUntil = now + STEP_COOLDOWN_MS;
      stepArmAfter = now + STEP_REARM_MS;
      catStepGuardUntil = now + GUARD_MS;
      axisAccum = 0;
      quietSince = 0;
      if (window.lenis?.scrollTo) {
        const y = window.lenis.animatedScroll ?? window.lenis.scroll ?? 0;
        window.lenis.scrollTo(y, { immediate: true });
      }
      resourceScheduler()?.intentCategory?.(order[next], { reason: 'category-step', slot: 0 });
      selectDishCategory(order[next], next, { mode: 'step' });
      return true;
    }

    function consumeHorizontalStep(dx) {
      if (!dx) return false;
      const now = Date.now();

      // Hard re-arm: never stay dead after trackpad inertia refuses to go quiet.
      if (gestureHasStepped && now >= stepArmAfter) {
        gestureHasStepped = false;
        quietSince = 0;
        axisAccum = 0;
      }

      if (now < stepLockUntil) {
        axisAccum = 0;
        return true;
      }

      // After a step, swallow inertia until quiet — or until hard re-arm above.
      if (gestureHasStepped) {
        if (Math.abs(dx) < QUIET_DELTA) {
          if (!quietSince) quietSince = now;
          if (now - quietSince >= QUIET_MS) {
            gestureHasStepped = false;
            quietSince = 0;
            axisAccum = 0;
          }
        } else {
          quietSince = 0;
          axisAccum = 0;
        }
        if (gestureHasStepped) return true;
      }

      quietSince = 0;
      axisAccum += dx;
      if (Math.abs(axisAccum) < STEP_THRESHOLD) return true;
      const dir = axisAccum > 0 ? 1 : -1;
      axisAccum = 0;
      const ok = stepDishCategory(dir);
      if (ok) gestureHasStepped = true;
      return ok;
    }

    window.addEventListener(
      'wheel',
      (e) => {
        if (isForcingHeroReturn()) return;
        if (!document.documentElement.classList.contains('is-dish-boards')) return;
        if (catFlyBusy || scrollCatFly || document.documentElement.classList.contains('is-cat-flying')) {
          return;
        }
        const bar = document.getElementById('westo-dish-catbar');
        if (!bar || bar.hidden) return;
        ensureCatBarTrackInteractive(bar);
        if (e.target?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
        // Catbar owns its own horizontal scrub; dish rail owns vertical scrub.
        if (e.target?.closest?.('#westo-dish-catbar, .benefits_nav.is-menu-rail')) return;

        const ax = Math.abs(e.deltaX);
        const ay = Math.abs(e.deltaY);
        if (ax < 0.35 && ay < 0.35) return;

        // Lock axis, but allow upgrading to X if horizontal becomes dominant
        // (fixes "sometimes dead" when the first ticks were slightly vertical).
        if (!gestureAxis) {
          gestureAxis = ax >= ay * 0.55 ? 'x' : 'y';
        } else if (gestureAxis === 'y' && ax > ay * 1.15 && ax >= 1.2) {
          gestureAxis = 'x';
          axisAccum = 0;
          gestureHasStepped = false;
          quietSince = 0;
        }
        clearGestureSoon();

        if (gestureAxis === 'x') {
          e.preventDefault();
          e.stopPropagation();
          if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
          if (ax >= 0.35) consumeHorizontalStep(e.deltaX);
          return;
        }

        if (isCatStepGuarded() && e.deltaY < 0) {
          e.preventDefault();
          e.stopPropagation();
          pinScrollToDishBoards({ immediate: true });
        }
      },
      { passive: false, capture: true },
    );

    // The strip itself keeps native pan-x, but a horizontal finger swipe on the
    // dish media/card must also switch category. Axis-lock below leaves vertical
    // gestures to dish paging and commits at most one category per touch sequence.

    let touch = null;
    window.addEventListener(
      'touchstart',
      (e) => {
        if (!document.documentElement.classList.contains('is-dish-boards')) return;
        if (catFlyBusy || scrollCatFly) return;
        if (e.touches?.length !== 1) {
          touch = null;
          return;
        }
        // Only ignore catbar / form fields — do NOT ignore dish add-buttons
        // (that made swipes starting on the card randomly fail).
        if (e.target?.closest?.('#westo-dish-catbar, .benefits_nav.is-menu-rail, input, textarea, select, [contenteditable="true"]')) {
          touch = null;
          return;
        }
        const t = e.changedTouches?.[0];
        if (!t) return;
        touch = {
          x: t.clientX,
          y: t.clientY,
          locked: null,
          stepped: false,
        };
        axisAccum = 0;
        resetGestureState();
      },
      { passive: true, capture: true },
    );
    window.addEventListener(
      'touchmove',
      (e) => {
        if (!touch || touch.stepped) return;
        if (e.touches?.length !== 1) {
          touch = null;
          return;
        }
        const t = e.changedTouches?.[0];
        if (!t) return;
        const dx = t.clientX - touch.x;
        const dy = t.clientY - touch.y;
        if (!touch.locked) {
          if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
          touch.locked = Math.abs(dx) >= Math.abs(dy) * 0.75 ? 'x' : 'y';
        } else if (touch.locked === 'y' && Math.abs(dx) > Math.abs(dy) * 1.2 && Math.abs(dx) > 18) {
          touch.locked = 'x';
        }
        if (touch.locked !== 'x') return;
        if (e.cancelable) e.preventDefault();
        // Exactly one category per finger swipe.
        if (Math.abs(dx) >= 40 && Math.abs(dx) >= Math.abs(dy) * 1.05) {
          const ok = stepDishCategory(dx < 0 ? 1 : -1);
          if (ok) touch.stepped = true;
        }
      },
      { passive: false, capture: true },
    );
    window.addEventListener(
      'touchend',
      (e) => {
        if (!touch) return;
        const start = touch;
        const t = e.changedTouches?.[0];
        touch = null;
        if (start.stepped) return;
        if (!t || !document.documentElement.classList.contains('is-dish-boards')) return;
        if (catFlyBusy || scrollCatFly) return;
        const dx = t.clientX - start.x;
        const dy = t.clientY - start.y;
        if (start.locked === 'y') return;
        if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy) * 1.05) return;
        stepDishCategory(dx < 0 ? 1 : -1);
      },
      { passive: true, capture: true },
    );
    window.addEventListener(
      'touchcancel',
      () => {
        touch = null;
      },
      { passive: true, capture: true },
    );
  }

  function bindCatBarInfiniteScroll(track) {
    if (!track) return track;
    // v13.7: the production strip is a single canonical DOM set. Native overflow
    // scrolling provides momentum on iOS/Android without a per-scroll RAF
    // rebalance loop or duplicated layout measurements. Keep the historical
    // function name so the surrounding state machine contract stays unchanged.
    bindCatBarUserScroll(track);
    bindCatBarPageWheel();
    return track;
  }

  function measureCatBarLoopSet(track) {
    if (!track) return 0;
    const n = Number(track.dataset.loopLen) || 0;
    if (n < 2) return 0;
    const chips = track.querySelectorAll('.westo-dish-catbar__chip');
    if (chips.length < n * 2) return 0;
    // Prefer average of copy0→1 and copy1→2 periods (more stable under subpixel).
    const a = Math.max(0, chips[n].offsetLeft - chips[0].offsetLeft);
    const b =
      chips.length >= n * 3
        ? Math.max(0, chips[n * 2].offsetLeft - chips[n].offsetLeft)
        : 0;
    let setW = a;
    if (a > 8 && b > 8) setW = Math.round((a + b) / 2);
    else if (a > 8) setW = Math.round(a);
    if (setW > 8) track.dataset.loopSetWidth = String(setW);
    return setW;
  }

  function categoryCoverFor(categoryId, index) {
    const labels = window.__westoCanLabels;
    if (Array.isArray(labels) && labels[index]) return String(labels[index]);
    const cats = window.westoMenuStore?.categories || [];
    const cat = cats.find((c) => Number(c.id) === Number(categoryId));
    const cover = String(cat?.coverImg || '').trim();
    if (cover) return cover;
    const items = menuByCategory[categoryId] || menuByCategory[Number(categoryId)] || [];
    const first = items[0];
    return String(first?.img || first?.image || '').trim();
  }

  const CATBAR_LOCAL_THUMB_IDS = new Set([
    7560, 7561, 7562, 7563, 7564, 7566, 7567, 7599,
    7675, 7676, 7697, 7701, 9478, 13581, 14477, 17007,
  ]);

  function categoryThumbFor(categoryId, index) {
    const id = Number(categoryId);
    if (Number.isFinite(id) && CATBAR_LOCAL_THUMB_IDS.has(id)) {
      return `assets/menu/category-thumbs/category-${id}.webp`;
    }
    return categoryCoverFor(categoryId, index);
  }

  function dishCatBarSignature() {
    const order = window.__westoCategoryOrder?.length ? window.__westoCategoryOrder : categoryOrder;
    const lang = document.documentElement.getAttribute('lang') || 'fa';
    return `${lang}|lite1|${order
      .map((id, i) => `${id}:${categoryLabelFor(id)}:${categoryThumbFor(id, i)}`)
      .join(',')}`;
  }

  function rebuildDishCatBar(force) {
    const bar = ensureDishCatBar();
    const track = bar.querySelector('.westo-dish-catbar__track');
    if (!track) return bar;
    track.setAttribute('role', 'toolbar');
    const sig = dishCatBarSignature();
    if (!force && track.dataset.builtSig === sig) return bar;
    const order = window.__westoCategoryOrder?.length ? window.__westoCategoryOrder : categoryOrder;
    track.replaceChildren();
    track.classList.remove('is-infinite');
    track.dataset.loopLen = String(order.length);
    track.dataset.loopCopies = '1';
    const activeId = Number(lastFilledCategoryId ?? activeCategoryId());

    const appendChip = (id, index, copy) => {
      const label = categoryLabelFor(id) || String(id);
      const cover = categoryCoverFor(id, index);
      const thumb = categoryThumbFor(id, index);
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'westo-dish-catbar__chip';
      chip.dataset.categoryId = String(id);
      chip.dataset.catIndex = String(index);
      chip.dataset.loopCopy = String(copy);
      chip.title = label;
      chip.setAttribute('aria-label', label);

      const icon = document.createElement('span');
      icon.className = 'westo-dish-catbar__icon';
      icon.setAttribute('aria-hidden', 'true');
      const img = document.createElement('img');
      img.className = 'westo-dish-catbar__thumb';
      img.alt = '';
      img.width = 128;
      img.height = 128;
      img.decoding = 'async';
      const activeIndex = Math.max(0, order.findIndex((catId) => Number(catId) === activeId));
      const loopDistance = Math.min(
        Math.abs(index - activeIndex),
        Math.max(0, order.length - Math.abs(index - activeIndex)),
      );
      img.loading = loopDistance <= 2 ? 'eager' : 'lazy';
      img.fetchPriority = loopDistance === 0 ? 'high' : 'low';
      // Catbar thumbs are dedicated 128px local assets. Browser-native caching
      // avoids Blob/object-URL bookkeeping and decodes ~1 MB total instead of
      // dozens of 640px surfaces across three cloned strip copies.
      if (thumb) img.src = thumb;
      if (cover && thumb && thumb !== cover) {
        img.addEventListener('error', () => {
          if (img.src.endsWith(thumb)) img.src = cover;
        }, { once: true });
      }
      icon.appendChild(img);

      const lab = document.createElement('span');
      lab.className = 'westo-dish-catbar__label';
      lab.setAttribute('dir', 'auto');
      const words = String(label).trim().split(/\s+/).filter(Boolean);
      lab.textContent = words.slice(0, 2).join(' ');

      chip.appendChild(icon);
      chip.appendChild(lab);
      track.appendChild(chip);
    };

    order.forEach((id, index) => appendChip(id, index, 1));

    syncCatBarA11y(bar, activeId);

    track.dataset.builtSig = sig;
    bindCatBarInfiniteScroll(track);
    return bar;
  }

  let catFlyBusy = false;
  let catFlyTween = null;
  /** Last good hero plate seats (same covers as WebGL) — captured before dish collapse. */
  let lastHeroCatSeats = [];
  /** Exact seats/covers from the last hero→catbar fly — used for symmetric reverse. */
  let lastFlyManifest = [];
  /** Dish board to paint only after forward fly lands (avoids double-image). */
  let pendingDishRevealEl = null;
  /** Defer removing is-dish-boards until reverse orbs own center pixels. */
  let pendingLeaveDishUi = false;
  let pendingLeaveRaf = 0;
  /** Ignore leave-dishes briefly after forward land (prevents f_015 empty). */
  let catFlyLandGraceUntil = 0;
  /** Short ownership window after reverse Dish→Hero commit. Prevents the same
      scroll frame (or elastic scroll bounce) from re-entering dish mode. */
  let catFlyReverseGraceUntil = 0;
  /** Scroll-driven hero→catbar (5 covers, no timed tween). */
  let scrollCatFly = null;
  let scrollFlyLanded = false;
  /** Back-btn / programmatic return to hero — blocks viewport from re-forcing dish mode mid-scroll. */
  let forceHeroReturnUntil = 0;
  let forceHeroReturn = false;

  function isForcingHeroReturn() {
    return forceHeroReturn || Date.now() < forceHeroReturnUntil;
  }

  function computeScrollFlyProgress(scrollY, heroH, firstBoardTop) {
    const h = Math.max(heroH, 1);
    const start = h * SCROLL_FLY_START;
    const end = Math.min(h * SCROLL_FLY_END, (firstBoardTop || h) * 0.82);
    if (scrollY <= start) return 0;
    if (scrollY >= end) return 1;
    return (scrollY - start) / Math.max(1, end - start);
  }

  /** Narrow hero shows one plate — never invent a 3/5 cinema flock. */
  function prefersSinglePlateFly() {
    return window.innerWidth < 992;
  }

  function singleActiveFlySeat(seats) {
    const order = window.__westoCategoryOrder?.length ? window.__westoCategoryOrder : categoryOrder;
    if (!order.length) return [];
    const activeId =
      lastFilledCategoryId != null ? String(lastFilledCategoryId) : String(activeCategoryId() ?? '');
    const activeIdx = Math.max(0, order.findIndex((id) => String(id) === activeId));
    const vw = window.innerWidth || 1;
    const vh = window.innerHeight || 1;
    const byId = new Map((seats || []).map((s) => [String(s.categoryId), { ...s }]));
    const existing =
      byId.get(activeId) ||
      (seats || []).slice().sort((a, b) => Number(b.size) - Number(a.size))[0] ||
      null;
    const id = String(existing?.categoryId || activeId || order[activeIdx] || order[0] || '');
    const oi = Math.max(0, order.findIndex((x) => String(x) === id));
    if (!id) return [];
    if (existing && Number(existing.size) > 48) {
      return [{ ...existing, categoryId: id, opacity: 1, synthetic: false }];
    }
    return [
      {
        categoryId: id,
        cover: categoryCoverFor(id, oi),
        cx: vw * 0.5,
        cy: vh * 0.42,
        size: Math.min(vh * 0.42, 320),
        opacity: 1,
        synthetic: true,
      },
    ].filter((s) => s.categoryId && s.cover);
  }

  /** Exactly 5 categories on wide stage: active ±2. On narrow: active only. */
  function ensureFlockFive(seats) {
    if (prefersSinglePlateFly()) return singleActiveFlySeat(seats);
    const order = window.__westoCategoryOrder?.length ? window.__westoCategoryOrder : categoryOrder;
    if (!order.length) return seats || [];
    const activeId =
      lastFilledCategoryId != null ? String(lastFilledCategoryId) : String(activeCategoryId() ?? '');
    const activeIdx = Math.max(0, order.findIndex((id) => String(id) === activeId));
    const vw = window.innerWidth || 1;
    const vh = window.innerHeight || 1;
    const centerCx = vw * 0.5;
    const centerCy = vh * 0.42;
    const baseSize = Math.min(vh * 0.38, 300);
    const byId = new Map((seats || []).map((s) => [String(s.categoryId), { ...s }]));

    const offsets = [-2, -1, 0, 1, 2];
    const out = offsets.map((off) => {
      const oi = (activeIdx + off + order.length) % order.length;
      const id = String(order[oi]);
      const existing = byId.get(id);
      const spread = baseSize * 1.12;
      const cx = centerCx + off * spread;
      const size =
        off === 0 ? baseSize : Math.max(64, baseSize * (off === -2 || off === 2 ? 0.62 : 0.78));
      if (existing && Number(existing.size) > 48) {
        return { ...existing, opacity: 1 };
      }
      return {
        categoryId: id,
        cover: categoryCoverFor(id, oi),
        cx,
        cy: centerCy + Math.abs(off) * 6,
        size,
        opacity: 1,
        synthetic: !existing,
      };
    });
    return out.filter((s) => s.categoryId && s.cover).sort((a, b) => a.cx - b.cx);
  }

  /**
   * Scroll the catbar track so `chip` sits in the horizontal center.
   * Track is forced LTR so scrollLeft math is stable (chrome pattern).
   * Neighbors soft-settle via is-near / is-far classes.
   */
  function settleDishCatNeighbors() {
    // Visual distance transforms were decorative but forced extra style/composite
    // work across every chip. Active state alone carries hierarchy in v13.7.
  }


  /**
   * Scroll the catbar track so `chip` sits in the horizontal center.
   * Always prefers the nearest DOM copy so we never animate across the whole strip.
   * Track is forced LTR so scrollLeft math is stable (chrome pattern).
   */
  function centerDishCatChip(chip, { instant = false, duration = 0.55, ease = 'power2.out', preferNearest = true } = {}) {
    const track =
      chip?.closest?.('.westo-dish-catbar__track') ||
      document.querySelector('#westo-dish-catbar .westo-dish-catbar__track');
    if (!track || !chip) return;

    const bar = track.closest('#westo-dish-catbar') || track.parentElement;
    const categoryId = chip.dataset.categoryId;

    track.style.direction = 'ltr';

    if (track.dataset.loopCopies === '1' || !track.classList.contains('is-infinite')) {
      const maxScroll = Math.max(0, track.scrollWidth - track.clientWidth);
      const target = Math.max(0, Math.min(
        maxScroll,
        chip.offsetLeft + chip.offsetWidth / 2 - track.clientWidth / 2,
      ));
      if (Math.abs(target - track.scrollLeft) < 0.75) return;
      killCatBarScrollTween();
      beginCatBarProgrammatic(instant ? 140 : 520);
      track.style.scrollBehavior = 'auto';
      if (typeof track.scrollTo === 'function') {
        track.scrollTo({ left: target, top: 0, behavior: instant ? 'auto' : 'smooth' });
      } else {
        track.scrollLeft = target;
      }
      catBarNativeCenterTimer = window.setTimeout(() => {
        catBarNativeCenterTimer = 0;
        endCatBarProgrammatic();
      }, instant ? 80 : 460);
      return;
    }

    measureCatBarLoopSet(track);

    const applyInstant = (value) => {
      beginCatBarProgrammatic(500);
      track.style.scrollBehavior = 'auto';
      if (typeof track.scrollTo === 'function') {
        track.scrollTo({ left: value, top: 0, behavior: 'instant' });
      } else {
        track.scrollLeft = value;
      }
      window.requestAnimationFrame(() => {
        endCatBarProgrammatic();
      });
    };

    const measureAndScroll = () => {
      measureCatBarLoopSet(track);
      let target = null;
      // Prefer an in-range loop copy so we never clamp to a no-op scrollLeft.
      if (preferNearest !== false && categoryId != null) {
        const plan = pickCatBarCenterPlan(bar, categoryId, track);
        if (plan?.chip) {
          chip = plan.chip;
          target = plan.target;
        }
      }
      settleDishCatNeighbors(chip);
      if (target == null) {
        const trackRect = track.getBoundingClientRect();
        const chipRect = chip.getBoundingClientRect();
        if (!trackRect.width || !chipRect.width) return;
        const delta =
          chipRect.left + chipRect.width / 2 - (trackRect.left + trackRect.width / 2);
        const setW = Number(track.dataset.loopSetWidth) || measureCatBarLoopSet(track) || 0;
        const maxScroll = Math.max(0, track.scrollWidth - track.clientWidth);
        let raw = track.scrollLeft + delta;
        if (setW > 16) {
          let best = raw;
          let bestDist = Infinity;
          for (let k = -2; k <= 2; k += 1) {
            const t = raw + k * setW;
            if (t < -0.5 || t > maxScroll + 0.5) continue;
            const d = Math.abs(t - track.scrollLeft);
            if (d < bestDist) {
              bestDist = d;
              best = t;
            }
          }
          raw = best;
        }
        target = Math.max(0, Math.min(maxScroll, raw));
      }
      const chipRect = chip.getBoundingClientRect();
      const travel = Math.abs(target - track.scrollLeft);
      const chipSpan = Math.max((chipRect.width || 56) + 8, 56);      // #endregion

      // Already centered.
      if (travel < 0.75) {
        applyInstant(target);
        return;
      }

      // Long path = wrong copy / wrap — jump, never animate the flyby.
      const useInstant = instant || travel > chipSpan * 1.65;
      killCatBarScrollTween();

      if (useInstant || typeof window.gsap === 'undefined') {
        applyInstant(target);
        return;
      }

      const dur = Math.min(0.42, Math.max(0.2, Number(duration) || 0.32));
      beginCatBarProgrammatic(Math.ceil(dur * 1000) + 200);
      catBarScrollTween = window.gsap.to(track, {
        scrollLeft: target,
        duration: dur,
        ease: ease || 'power3.out',
        overwrite: true,
        onInterrupt: () => {
          catBarScrollTween = null;
          endCatBarProgrammatic();
        },
        onComplete: () => {
          catBarScrollTween = null;
          endCatBarProgrammatic();
        },
      });
    };

    measureAndScroll();
    requestAnimationFrame(measureAndScroll);
  }

  function captureHeroCatSources() {
    // Prefer strict visible plates (what the user actually sees).
    if (typeof window.__westoCaptureHeroPlates === 'function') {
      const strict = window.__westoCaptureHeroPlates();
      if (strict?.length) return strict;
    }
    if (typeof window.__westoSnapshotAllHeroPlates === 'function') {
      const snap = window.__westoSnapshotAllHeroPlates();
      if (snap?.length) return snap;
    }
    // Fallback if three-scene is not ready: approximate seats.
    const cans = typeof window.__westoStageDebug === 'function' ? window.__westoStageDebug() : [];
    const order = window.__westoCategoryOrder?.length ? window.__westoCategoryOrder : categoryOrder;
    const labels = window.__westoCanLabels || [];
    if (!cans.length || !order.length) return [];
    const fov = 34;
    const camZ = 15.5;
    const vw = window.innerWidth || 1;
    const vh = window.innerHeight || 1;
    return cans
      .filter((c) => c && c.visible && c.opacity > 0.2 && c.scale > 0.28)
      .map((c) => {
        const dist = Math.max(0.35, camZ - (Number(c.z) || 0));
        const halfH = Math.tan((fov * Math.PI) / 360) * dist;
        const halfW = halfH * (vw / vh);
        const cx = (((Number(c.x) || 0) / Math.max(0.001, halfW)) * 0.5 + 0.5) * vw;
        const cy = (-((Number(c.y) || 0) / Math.max(0.001, halfH)) * 0.5 + 0.5) * vh;
        const size = ((3.2 * Math.max(0.2, Number(c.scale) || 1)) / (2 * halfH)) * vh;
        return {
          i: c.i,
          categoryId: String(order[c.i] ?? ''),
          cover: String(labels[c.i] || categoryCoverFor(order[c.i], c.i) || '').trim(),
          opacity: Math.max(0.2, Math.min(1, Number(c.opacity) || 1)),
          cx,
          cy,
          size,
        };
      })
      .filter((s) => s.categoryId && s.cover)
      .sort((a, b) => a.cx - b.cx);
  }

  function refreshHeroCatSeatCache() {
    if (document.documentElement.classList.contains('is-dish-boards')) return;
    if (document.documentElement.classList.contains('is-cat-flying')) return;
    // Don't refresh once we've left the deep hero — collapsing cans would
    // overwrite a good multi-plate snapshot with a single shrunk center.
    const scrollY = window.lenis?.animatedScroll ?? window.lenis?.scroll ?? window.scrollY ?? 0;
    const heroH = document.querySelector('section.is-gamme')?.offsetHeight || window.innerHeight || 1;
    if (scrollY > heroH * 0.32 && lastHeroCatSeats.length) return;

    const seats = (
      typeof window.__westoCaptureHeroPlates === 'function'
        ? window.__westoCaptureHeroPlates()
        : captureHeroCatSources()
    ).filter(
      (s) =>
        s &&
        s.categoryId &&
        s.cover &&
        Number(s.size) > 90 &&
        Number(s.opacity) >= 0.5,
    );
    if (!seats.length) return;

    // Narrow: cache the single clearest plate only (no multi flock).
    if (prefersSinglePlateFly()) {
      const best = seats
        .slice()
        .sort((a, b) => Number(b.size) - Number(a.size) || Number(b.opacity) - Number(a.opacity))
        .slice(0, 1)
        .map((s) => ({ ...s }));
      lastHeroCatSeats = best;
      preloadCatFlyCovers(lastHeroCatSeats);
      return;
    }

    // Ignore pre-stage frames that still show a crowd of full-size cans.
    if (seats.length > 5) return;
    const avgSize = (arr) =>
      arr.reduce((n, s) => n + Math.max(0, Number(s.size) || 0), 0) / Math.max(1, arr.length);
    const maxOp = Math.max(...seats.map((s) => Number(s.opacity) || 0));
    if (maxOp < 0.9 && seats.length > 3) return;

    if (!lastHeroCatSeats.length) {
      lastHeroCatSeats = seats.map((s) => ({ ...s }));
      preloadCatFlyCovers(lastHeroCatSeats);
      return;
    }

    const prevAvg = avgSize(lastHeroCatSeats);
    const nextAvg = avgSize(seats);
    const fewer = seats.length < lastHeroCatSeats.length;
    const fewerOrSame = seats.length <= lastHeroCatSeats.length;
    const sharper = nextAvg >= prevAvg * 0.95;
    // Prefer the settled stage view (fewer clear plates) over an early crowd.
    // Never collapse a good 3+ seat cache down to a lone plate.
    if (fewer && nextAvg >= 100) {
      if (seats.length >= 3 || lastHeroCatSeats.length < 3) {
        lastHeroCatSeats = seats.map((s) => ({ ...s }));
        preloadCatFlyCovers(lastHeroCatSeats);
      }
    } else if ((fewerOrSame && sharper) || nextAvg > prevAvg * 1.08) {
      if (!(seats.length < 3 && lastHeroCatSeats.length >= 3)) {
        lastHeroCatSeats = seats.map((s) => ({ ...s }));
        preloadCatFlyCovers(lastHeroCatSeats);
      }
    }
  }
  /**
   * Fly sources = plates the user is looking at.
   * Wide: pad to cinema flock (±2). Narrow: active plate only.
   */
  function buildAllCatFlySources() {
    // Prefer cache from while cans were still at hero size.
    const raw = lastHeroCatSeats.length
      ? lastHeroCatSeats
      : captureHeroCatSources().filter(
          (s) => s && s.categoryId && s.cover && Number(s.size) > 40,
        );
    if (!raw.length) return ensureFlockFive([]);
    // Keep the clearest plates only (usually center + near neighbors).
    const maxKeep = prefersSinglePlateFly() ? 1 : 5;
    const clearest = raw
      .slice()
      .sort((a, b) => Number(b.size) - Number(a.size) || Number(b.opacity) - Number(a.opacity))
      .slice(0, maxKeep)
      .filter((s) => Number(s.size) > 80 && Number(s.opacity) >= 0.45);
    let seats = (clearest.length ? clearest : raw.slice(0, maxKeep)).map((s) => ({
      ...s,
      synthetic: false,
      opacity: 1,
    }));
    seats = ensureFlockFive(seats);
    if (!lastHeroCatSeats.length && seats.length) {
      lastHeroCatSeats = seats.map((s) => ({ ...s }));
    }
    const order = window.__westoCategoryOrder?.length ? window.__westoCategoryOrder : categoryOrder;
    const orderIndex = new Map(order.map((id, i) => [String(id), i]));
    return seats.sort((a, b) => {
      const ia = orderIndex.has(String(a.categoryId)) ? orderIndex.get(String(a.categoryId)) : 999;
      const ib = orderIndex.has(String(b.categoryId)) ? orderIndex.get(String(b.categoryId)) : 999;
      if (ia !== ib) return ia - ib;
      return a.cx - b.cx;
    });
  }

  function preloadCatFlyCovers(list) {
    (list || []).forEach((src) => {
      const url = String(src?.cover || '').trim();
      if (!url) return;
      void warmManagedImage(url, {
        priority: resourcePriority('VISIBLE', 92),
        group: 'category-fly',
        kind: 'image',
      });
    });
  }

  function ensureCatFlyLayer() {
    let layer = document.getElementById('westo-cat-fly');
    if (!layer) {
      layer = document.createElement('div');
      layer.id = 'westo-cat-fly';
      layer.className = 'westo-cat-fly';
      layer.style.direction = 'ltr';
      layer.setAttribute('aria-hidden', 'true');
      document.body.appendChild(layer);
    }
    return layer;
  }

  function lockCatBarTrack(bar, locked) {
    const track = bar?.querySelector('.westo-dish-catbar__track');
    if (!track) return;
    if (locked) {
      track.dataset.prevOverflow = track.style.overflowX || '';
      track.style.overflowX = 'hidden';
      track.style.touchAction = 'none';
    } else {
      track.style.overflowX = track.dataset.prevOverflow || 'auto';
      track.style.touchAction = '';
      delete track.dataset.prevOverflow;
    }
  }

  function killCatFly() {
    cancelScrollCatFly();
    scrollFlyLanded = false;
    if (catFlyTween?.kill) catFlyTween.kill();
    catFlyTween = null;
    killCatBarScrollTween();
    const gsap = getGsap();
    if (typeof gsap?.killDelayedCallsTo === 'function') {
      try {
        gsap.killDelayedCallsTo(commitLeaveDishUiAfterOrbs);
      } catch (_) {}
    }
    if (pendingLeaveRaf) {
      cancelAnimationFrame(pendingLeaveRaf);
      pendingLeaveRaf = 0;
    }
    pendingLeaveDishUi = false;
    pendingDishRevealEl = null;
    document.documentElement.classList.remove(
      'is-cat-flying',
      'is-cat-scroll-fly',
      'is-cat-fly-covered',
      'is-cat-fly-chrome-in',
      'is-cat-fly-dish-in',
      'is-cat-fly-media-under',
      'is-cat-fly-handoff',
    );
    if (typeof window.__westoHideHeroPlatesForFly === 'function') {
      window.__westoHideHeroPlatesForFly(false);
    }
    const layer = document.getElementById('westo-cat-fly');
    if (layer) {
      layer.classList.remove('is-active');
      if (gsap) {
        gsap.killTweensOf(layer);
        gsap.set(layer, { clearProps: 'opacity' });
      } else {
        layer.style.opacity = '';
      }
      layer.replaceChildren();
    }
    const bar = $('#westo-dish-catbar');
    if (bar) {
      lockCatBarTrack(bar, false);
      bar.classList.remove('is-flying-in', 'is-flying-out', 'is-cinema-flock');
      if (gsap) {
        gsap.killTweensOf(bar);
        gsap.set(bar.querySelectorAll('.westo-dish-catbar__icon, .westo-dish-catbar__label'), {
          clearProps: 'opacity,visibility',
        });
      }
      bar.querySelectorAll('.westo-dish-catbar__chip').forEach((chip) => {
        chip.classList.remove('is-fly-seat', 'is-fly-landed');
      });
      if (!gsap) {
        bar.querySelectorAll('.westo-dish-catbar__icon, .westo-dish-catbar__label').forEach((el) => {
          el.style.opacity = '';
          el.style.visibility = '';
        });
      }
    }
    catFlyBusy = false;
  }

  function doubleRaf(fn) {
    const gsap = typeof window.gsap !== 'undefined' ? window.gsap : null;
    if (gsap) {
      gsap.delayedCall(0.032, fn);
      return;
    }
    requestAnimationFrame(() => requestAnimationFrame(fn));
  }

  function getGsap() {
    return typeof window.gsap !== 'undefined' ? window.gsap : null;
  }

  function setCatFlyOrb(el, seat, { opacity = 1 } = {}) {
    if (!el || !seat) return;
    // Transform-only flight path. The previous implementation rewrote
    // left/top/width/height through gsap.set() on every scroll frame, forcing
    // style/layout/paint for each orb. Keep a fixed raster box and animate only
    // compositor-friendly translate3d + scale + opacity.
    let baseSize = Number(el.__westoFlyBaseSize) || 0;
    if (!baseSize) {
      baseSize = Math.max(1, Number(seat.size) || 1);
      el.__westoFlyBaseSize = baseSize;
      el.style.position = 'fixed';
      el.style.left = '0px';
      el.style.top = '0px';
      el.style.width = `${baseSize}px`;
      el.style.height = `${baseSize}px`;
      el.style.transformOrigin = '0 0';
      el.style.setProperty('--orb-size', String(baseSize));
    }
    const size = Math.max(1, Number(seat.size) || baseSize);
    const scale = size / baseSize;
    const tx = (Number(seat.cx) || 0) - size * 0.5;
    const ty = (Number(seat.cy) || 0) - size * 0.5;
    const transform = `translate3d(${tx.toFixed(2)}px,${ty.toFixed(2)}px,0) scale(${scale.toFixed(5)})`;
    if (el.__westoFlyTransform !== transform) {
      el.__westoFlyTransform = transform;
      el.style.transform = transform;
    }
    const nextOpacity = String(opacity);
    if (el.style.opacity !== nextOpacity) el.style.opacity = nextOpacity;
  }

  function setCatFlyBarOpacity(bar, opacity) {
    if (!bar) return;
    const next = String(opacity);
    if (bar.style.opacity !== next) bar.style.opacity = next;
  }

  function setCatFlyElementsOpacity(els, opacity, { visibility } = {}) {
    if (!els?.length) return;
    const nextOpacity = String(opacity);
    els.forEach((el) => {
      if (el.style.opacity !== nextOpacity) el.style.opacity = nextOpacity;
      if (visibility != null && el.style.visibility !== visibility) el.style.visibility = visibility;
    });
  }

  function killScrollFlyGsap(fly) {
    if (!fly) return;
    const gsap = getGsap();
    if (!gsap) return;
    if (fly.scrubTween?.kill) fly.scrubTween.kill();
    fly.scrubTween = null;
    if (fly.scrubState) gsap.killTweensOf(fly.scrubState);
    fly.flights?.forEach((f) => {
      if (f.el) gsap.killTweensOf(f.el);
    });
    if (fly.bar) {
      gsap.killTweensOf(fly.bar);
      gsap.killTweensOf(fly.bar.querySelectorAll('.westo-dish-catbar__icon, .westo-dish-catbar__label'));
    }
    if (fly.landTween?.kill) fly.landTween.kill();
    fly.landTween = null;
  }

  function mountScrollFlyGsap(fly, initialProgress = 0) {
    const gsap = getGsap();
    if (!gsap || !fly) return;
    killScrollFlyGsap(fly);
    fly.scrubState = { progress: initialProgress };
    fly.scrubTween = gsap.to(fly.scrubState, {
      progress: 1,
      duration: 1,
      ease: 'none',
      paused: true,
    });
  }

  function driveScrollFlyGsap(fly, rawT) {
    if (!fly) return;
    const t = Math.max(0, Math.min(1, rawT));
    if (fly.scrubState) fly.scrubState.progress = t;
    if (fly.scrubTween) fly.scrubTween.progress(t);
  }

  const SCROLL_FLY_START = 0.30;
  const SCROLL_FLY_END = 0.76;
  const FLOCK_STAGES = 5;  /** Pitch between the 5 flock seats when docked on the catbar row. */
  const FLOCK_CHIP_PITCH = 56;

  function softstep(u) {
    const x = Math.max(0, Math.min(1, u));
    return x * x * (3 - 2 * x);
  }

  /** 5 visible resize steps along the scroll band.
   *  IMPORTANT: the denominator is FLOCK_STAGES, not FLOCK_STAGES - 1.
   *  The old math reached visual progress=1 at raw progress≈0.8, so the DOM
   *  photos finished their flight while the state machine was still waiting
   *  for the 0.97 landing threshold. That created the reproducible black-gap
   *  / double-commit seen when entering a dish category.
   */
  function stagedProgress(t) {
    const x = Math.max(0, Math.min(1, t));
    if (x >= 1) return 1;
    const scaled = x * FLOCK_STAGES;
    const bucket = Math.min(FLOCK_STAGES - 1, Math.floor(scaled));
    const local = scaled - bucket;
    return (bucket + softstep(local)) / FLOCK_STAGES;
  }

  function lerpSeat(a, b, u) {
    const t = Math.max(0, Math.min(1, u));
    return {
      cx: a.cx + (b.cx - a.cx) * t,
      cy: a.cy + (b.cy - a.cy) * t,
      size: a.size + (b.size - a.size) * t,
      opacity: 1,
    };
  }
  function flockSlotOffset(srcIdx, activeOrderIdx, orderLen) {
    let off = srcIdx - activeOrderIdx;
    if (orderLen > 1) {
      if (off > orderLen / 2) off -= orderLen;
      if (off < -orderLen / 2) off += orderLen;
    }
    return Math.max(-2, Math.min(2, off));
  }
  /** Hero landing seats — always symmetric around viewport center (never stale capture). */
  function buildFlightHeroTarget(_categoryId, slotOffset) {
    const vw = window.innerWidth || 1;
    const vh = window.innerHeight || 1;
    const screenCx = vw * 0.5;
    const screenCy = vh * 0.42;
    const baseSize = Math.min(vh * 0.38, 300);
    const spread = Math.min(baseSize * 0.56, 190);
    return {
      cx: screenCx + slotOffset * spread,
      cy: screenCy + Math.abs(slotOffset) * 5,
      size:
        slotOffset === 0
          ? baseSize
          : Math.max(58, baseSize * (Math.abs(slotOffset) === 2 ? 0.64 : 0.8)),
      opacity: 1,
    };
  }

  /**
   * Forward (t 0→1): hero stage → catbar row.
   * Reverse (t 1→0): catbar row → hero stage (drop from top strip into center).
   * Never B→side-cluster — that looked like photos sliding in from the right.
   */
  function sampleStagedFlockPath(flight, rawT, reverse) {
    const x = Math.max(0, Math.min(1, rawT));
    const A =
      flight.A ||
      buildFlightHeroTarget(flight.categoryId, flight.slotOffset ?? 0);
    const B = flight.B;
    if (reverse) {
      const u = stagedProgress(1 - x);
      return lerpSeat(B, A, u);
    }
    const u = stagedProgress(x);
    return lerpSeat(A, B, u);
  } /** Pitch between catbar chips when seating the 5-orb flock. */
  /**
   * Catbar fly B-row always hangs from the TOP-CENTER of the viewport.
   * Never use the live chip's screen X — if the strip is scrolled, that X sits
   * on the right/left edge and reverse orbs slide in from the side (see screenshot).
   * Only Y + size come from the nearest on-screen chip icon.
   */
  function catBarFlyAnchorSeat(bar, activeId, navH = 74, fallbackSize = 46) {
    const vw = window.innerWidth || 1;
    const chip =
      findNearestCatBarChip(bar, activeId) || findCatBarChip(bar, activeId, { preferMiddle: true });
    const icon = chip?.querySelector('.westo-dish-catbar__icon');
    const rect = icon?.getBoundingClientRect();
    const size = rect?.width > 2 ? Math.max(32, rect.width) : fallbackSize;
    const rootStyle = getComputedStyle(document.documentElement);
    const navTop = Number.parseFloat(rootStyle.getPropertyValue('--menu-nav-h')) || navH;
    const promoH = Number.parseFloat(rootStyle.getPropertyValue('--menu-promo-h')) || 0;
    const promoGap = Number.parseFloat(rootStyle.getPropertyValue('--menu-promo-gap')) || 0;
    const catTop = navTop + promoH + promoGap;
    const catGap =
      Number.parseFloat(rootStyle.getPropertyValue('--menu-catbar-gap')) || 0;
    const catH =
      Number.parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue('--menu-catbar-h'),
      ) || 80;
    // Horizontal: always viewport center (active chip is conceptually centered).
    const cx = vw * 0.5;
    // Vertical: icon center if on-screen, else midline of the catbar band.
    let cy =
      rect?.width > 2 && rect.top > 0 && rect.top < window.innerHeight
        ? rect.top + rect.height / 2
        : catTop + catGap + catH * 0.42;
    const minCy = catTop + catGap + size * 0.35;
    const maxCy = catTop + catGap + catH - size * 0.15;
    cy = Math.max(minCy, Math.min(maxCy, cy));
    return { cx, cy, size, opacity: 1, chip };
  }

  /**
   * Place all B seats as a rigid row around the *visible* active chip center.
   * Never mix live rects from different infinite-strip copies — that was
   * splitting the flock into 3+2 groups drifting left (seen in recording).
   */
  function retargetScrollFlyBSeats(bar, flights, activeId, orderIndex) {
    if (!flights?.length) return;
    const navH =
      Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--menu-nav-h')) ||
      74;
    const anchor = catBarFlyAnchorSeat(bar, activeId, navH, 46);
    const vw = window.innerWidth || 1;

    flights.forEach((f) => {
      const off = Number.isFinite(f.slotOffset) ? f.slotOffset : 0;
      let cx = anchor.cx + off * FLOCK_CHIP_PITCH;
      const pad = Math.max(anchor.size * 0.55, 24);
      cx = Math.max(pad, Math.min(vw - pad, cx));
      f.B.cx = cx;
      f.B.cy = anchor.cy;
      f.B.size = anchor.size;
      f.B.opacity = 1;
    });
  }

  function applyScrollCatFlyFrame(t) {
    if (!scrollCatFly?.flights?.length) return;
    const raw = Math.max(0, Math.min(1, t));
    const isReverse = Boolean(scrollCatFly.reverse);
    const pathT = stagedProgress(isReverse ? 1 - raw : raw);
    driveScrollFlyGsap(scrollCatFly, raw);
    scrollCatFly.flights.forEach((f) => {
      const p = sampleStagedFlockPath(f, raw, isReverse);
      // Forward: keep orbs invisible until plates are covered (no pop over WebGL).
      // Reverse: always opaque — start on catbar chips, never flash dish/hero under them.
      const orbOpacity = !isReverse && raw < 0.03 ? 0 : 1;
      setCatFlyOrb(f.el, p, { opacity: orbOpacity });
    });
    const root = document.documentElement;
    const bar = scrollCatFly.bar;

    // Cover/uncover must follow scroll rawT — NOT inverted pathT.
    // Reverse bug: pathT≈0 at dishes start → premature uncover → normal menu flash,
    // then pathT rises into expand. Keep covered until nearly landed on hero.
    if (isReverse) {
      // Keep WebGL hidden until orbs have dropped into the hero center —
      // uncovering early showed side plates sliding in from the right edge.
      if (raw > 0.02) {
        root.classList.add('is-cat-fly-covered');
        if (typeof window.__westoHideHeroPlatesForFly === 'function') {
          window.__westoHideHeroPlatesForFly(true);
        }
      } else {
        root.classList.remove('is-cat-fly-covered');
        if (typeof window.__westoHideHeroPlatesForFly === 'function') {
          window.__westoHideHeroPlatesForFly(false);
        }
      }
      // Dish UI off for the entire reverse — orbs own the pixels.
      root.classList.remove('is-dish-boards');
    } else if (pathT > 0.04) {
      root.classList.add('is-cat-fly-covered');
      if (typeof window.__westoHideHeroPlatesForFly === 'function') {
        window.__westoHideHeroPlatesForFly(true);
      }
    } else if (pathT <= 0.02) {
      root.classList.remove('is-cat-fly-covered');
      if (typeof window.__westoHideHeroPlatesForFly === 'function') {
        window.__westoHideHeroPlatesForFly(false);
      }
    }

    if (bar) {
      if (isReverse) {
        // raw=1 (dishes) → bar visible; raw=0 (hero) → bar gone
        setCatFlyBarOpacity(bar, Math.max(0, 0.12 + raw * 0.88));
        bar.classList.toggle('is-revealed', raw > 0.35);
      } else {
        setCatFlyBarOpacity(bar, Math.min(1, 0.15 + pathT * 0.85));
        bar.classList.toggle('is-revealed', pathT > 0.55);
      }
    }
  }

  function readChipFlySeat(bar, _categoryId, slotOffset, navH, chipSize) {
    const activeId =
      lastFilledCategoryId != null ? String(lastFilledCategoryId) : String(activeCategoryId() ?? '');
    const anchor = catBarFlyAnchorSeat(bar, activeId, navH, chipSize);
    const vw = window.innerWidth || 1;
    let cx = anchor.cx + slotOffset * FLOCK_CHIP_PITCH;
    const pad = Math.max(anchor.size * 0.55, 24);
    cx = Math.max(pad, Math.min(vw - pad, cx));
    return {
      cx,
      cy: anchor.cy,
      size: anchor.size,
      opacity: 1,
    };
  }

  function beginScrollCatFly({ reverse = false, progress = 0 } = {}) {
    if (scrollCatFly) {
      if (Boolean(scrollCatFly.reverse) === Boolean(reverse)) return scrollCatFly;
      cancelScrollCatFly({ keepLanded: reverse });
    }
    if (catFlyBusy && !reverse) return null;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    if (reduce || typeof window.gsap === 'undefined') return null;

    const list = ensureFlockFive(
      lastFlyManifest.length
        ? lastFlyManifest.map((m) => ({
            categoryId: m.categoryId,
            cover: m.cover,
            cx: m.hero?.cx,
            cy: m.hero?.cy,
            size: m.hero?.size,
            opacity: 1,
          }))
        : buildAllCatFlySources(),
    ).slice(0, prefersSinglePlateFly() ? 1 : 5);
    if (!list.length) return null;

    if (!reverse) scrollFlyLanded = false;
    catFlyBusy = true;
    const root = document.documentElement;
    root.classList.add('is-cat-flying', 'is-cat-scroll-fly');
    if (reverse) {
      // Lock reverse immediately: no dish flash, no WebGL flash before orbs paint.
      root.classList.add('is-cat-fly-covered');
      root.classList.remove('is-dish-boards');
      if (typeof window.__westoHideHeroPlatesForFly === 'function') {
        window.__westoHideHeroPlatesForFly(true);
      }
    }
    if (window.lenis?.isStopped && typeof window.lenis.start === 'function') {
      window.lenis.start();
    }
    document.body.style.overflow = '';

    const bar = rebuildDishCatBar(false);
    bar.hidden = false;
    bar.setAttribute('aria-hidden', 'false');
    if (reverse) {
      bar.classList.add('is-flying-out', 'is-cinema-flock', 'is-revealed');
      bar.classList.remove('is-flying-in');
      setCatFlyBarOpacity(bar, Math.max(0.12, Math.min(1, progress)));
    } else {
      bar.classList.add('is-flying-in', 'is-cinema-flock');
      bar.classList.remove('is-revealed', 'is-flying-out');
      setCatFlyBarOpacity(bar, 0);
    }

    const activeId =
      lastFilledCategoryId != null ? String(lastFilledCategoryId) : String(activeCategoryId() ?? '');
    bar.querySelectorAll('.westo-dish-catbar__chip').forEach((chip) => {
      const on = chip.dataset.categoryId === activeId;
      chip.classList.toggle('is-active', on);
      chip.setAttribute('aria-current', on ? 'true' : 'false');
    });
    const activeChip = findNearestCatBarChip(bar, activeId) || findCatBarChip(bar, activeId);
    if (activeChip) {
      centerDishCatChip(activeChip, { instant: true, preferNearest: true });
    }
    lockCatBarTrack(bar, true);

    const flyIds = new Set(list.map((s) => String(s.categoryId)));
    bar.querySelectorAll('.westo-dish-catbar__chip').forEach((chip) => {
      const id = String(chip.dataset.categoryId || '');
      const flying = flyIds.has(id);
      chip.classList.toggle('is-fly-seat', flying);
      const icon = chip.querySelector('.westo-dish-catbar__icon');
      const lab = chip.querySelector('.westo-dish-catbar__label');
      if (icon) setCatFlyElementsOpacity([icon], flying ? 0 : 1, { visibility: 'visible' });
      if (lab) setCatFlyElementsOpacity([lab], 0, { visibility: 'hidden' });
    });

    const layer = ensureCatFlyLayer();
    layer.replaceChildren();
    const gsap = getGsap();
    if (gsap) gsap.set(layer, { opacity: 1 });
    else layer.style.opacity = '1';
    layer.classList.add('is-active');

    const order = window.__westoCategoryOrder?.length ? window.__westoCategoryOrder : categoryOrder;
    const orderIndex = new Map(order.map((id, i) => [String(id), i]));
    const activeOrderIdx = orderIndex.has(activeId) ? orderIndex.get(activeId) : 0;
    const navH =
      Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--menu-nav-h')) ||
      74;

    const flights = [];
    const manifest = [];
    list.forEach((src) => {
      const coverUrl = String(src.cover || '').trim();
      if (!coverUrl) return;
      const isActive = String(src.categoryId) === activeId;
      const srcIdx = orderIndex.has(String(src.categoryId))
        ? orderIndex.get(String(src.categoryId))
        : 0;
      const slotOffset = flockSlotOffset(srcIdx, activeOrderIdx, order.length);
      const chipSize = 46;

      const el = document.createElement('div');
      el.className = 'westo-cat-fly__orb is-flock';
      el.dataset.categoryId = src.categoryId;
      const img = document.createElement('img');
      img.alt = '';
      img.draggable = false;
      img.decoding = 'sync';
      img.src = readyManagedSrc(coverUrl);
      el.appendChild(img);
      el.classList.toggle('is-active-fly', isActive);
      el.classList.toggle('is-neighbor-fly', !isActive);

      const A = buildFlightHeroTarget(String(src.categoryId), slotOffset);
      // Always provisional rigid seats; retarget locks them to active chip row.
      const B = readChipFlySeat(bar, src.categoryId, slotOffset, navH, chipSize);
      const clampedProgress = Math.max(0, Math.min(1, progress));
      const spawn = sampleStagedFlockPath({ A, B, slotOffset }, clampedProgress, reverse);
      setCatFlyOrb(el, spawn, { opacity: reverse || clampedProgress >= 0.03 ? 1 : 0 });
      el.style.zIndex = String(isActive ? 460 : 430 + srcIdx);
      layer.appendChild(el);
      flights.push({
        el,
        A,
        B,
        isActive,
        categoryId: String(src.categoryId),
        srcIdx,
        slotOffset,
      });
      manifest.push({
        categoryId: String(src.categoryId),
        cover: coverUrl,
        hero: { ...A },
        chip: { cx: B.cx, cy: B.cy, size: B.size },
        isActive,
      });
    });

    if (!flights.length) {
      cancelScrollCatFly();
      return null;
    }

    lastFlyManifest = manifest;
    // Lock B seats to a rigid centered row BEFORE first paint (kills 3+2 split).
    retargetScrollFlyBSeats(bar, flights, activeId, orderIndex);
    flights.forEach((f) => {
      const m = manifest.find((x) => x.categoryId === f.categoryId);
      if (m) m.chip = { cx: f.B.cx, cy: f.B.cy, size: f.B.size };
    });
    scrollCatFly = {
      bar,
      flights,
      activeId,
      layer,
      orderIndex,
      reverse,
      seatsLocked: Boolean(reverse),
    };
    mountScrollFlyGsap(scrollCatFly, reverse ? progress : 0);
    const frameProgress = Math.max(0, Math.min(1, progress));
    applyScrollCatFlyFrame(frameProgress);
    doubleRaf(() => {
      if (!scrollCatFly) return;
      const chip =
        findNearestCatBarChip(bar, activeId) || findCatBarChip(bar, activeId) || activeChip;
      if (chip) centerDishCatChip(chip, { instant: true, preferNearest: true });
      // One refine after layout settle, then lock forever for this fly.
      retargetScrollFlyBSeats(bar, flights, activeId, orderIndex);
      scrollCatFly.seatsLocked = true;
      applyScrollCatFlyFrame(frameProgress);
    });
    return scrollCatFly;
  }

  function updateScrollCatFly(rawT, { reverse = false } = {}) {
    if (scrollCatFly && Boolean(scrollCatFly.reverse) !== Boolean(reverse)) {
      cancelScrollCatFly({ keepLanded: reverse });
    }
    if (!scrollCatFly) beginScrollCatFly({ reverse, progress: rawT });
    if (!scrollCatFly) return;
    scrollCatFly.reverse = Boolean(reverse);
    const pathT = softstep(Math.max(0, Math.min(1, rawT)));
    // Never retarget every frame — that was jittering B seats and splitting the flock.
    if (!scrollCatFly.seatsLocked) {
      retargetScrollFlyBSeats(
        scrollCatFly.bar,
        scrollCatFly.flights,
        scrollCatFly.activeId,
        scrollCatFly.orderIndex,
      );
      scrollCatFly.seatsLocked = true;
    }
    applyScrollCatFlyFrame(rawT);
    const bar = scrollCatFly.bar;
    if (bar && !scrollCatFly.reverse && pathT > 0.5) {
      setCatFlyElementsOpacity(
        [...bar.querySelectorAll('.westo-dish-catbar__label')],
        Math.min(1, (pathT - 0.5) * 2),
        { visibility: 'visible' },
      );
    }
    if (bar && scrollCatFly.reverse && rawT < 0.45) {
      setCatFlyElementsOpacity(
        [...bar.querySelectorAll('.westo-dish-catbar__label')],
        0,
        { visibility: 'hidden' },
      );
    }
  }

  function completeScrollReverseFly() {
    if (!scrollCatFly?.reverse) return false;
    const { bar, layer, activeId } = scrollCatFly;
    // Keep reverse as the sole state owner until Hero has painted underneath
    // the last orb frame.  Previously this flipped catFlyBusy=false here, while
    // updateDishViewportState() was still executing with stale `onDishes=true`,
    // so the same callback could immediately re-add is-dish-boards.
    catFlyBusy = true;
    catFlyReverseGraceUntil = Math.max(catFlyReverseGraceUntil, Date.now() + 260);
    killScrollFlyGsap(scrollCatFly);
    // Final frame at cluster (raw=0) — then hand off to WebGL under orbs.
    applyScrollCatFlyFrame(0);
    scrollFlyLanded = false;
    scrollCatFly = null;
    const root = document.documentElement;
    root.classList.remove(
      'is-dish-boards',
      'is-cat-flying',
      'is-cat-scroll-fly',
      'is-cat-fly-covered',
      'is-cat-fly-media-under',
      'is-cat-fly-handoff',
    );
    // Restore WebGL FIRST (under last orb paint), then clear orbs next tick.
    if (typeof window.__westoHideHeroPlatesForFly === 'function') {
      window.__westoHideHeroPlatesForFly(false);
    }
    if (window.westoRestoreHeroScene) {
      window.westoRestoreHeroScene({ hidden: false });
    }
    try {
      const order = window.__westoCategoryOrder?.length ? window.__westoCategoryOrder : categoryOrder;
      const idx = order.findIndex((id) => String(id) === String(activeId));
      if (idx >= 0 && window.carousel?.goTo) {
        window.carousel.goTo(idx, { immediate: true });
      }
    } catch (_) {}

    const finish = () => {
      if (window.westoRestoreHeroChrome) {
        window.westoRestoreHeroChrome({ force: true });
      }
      if (layer) {
        layer.classList.remove('is-active');
        layer.replaceChildren();
        const gsap = getGsap();
        if (gsap) gsap.set(layer, { clearProps: 'opacity' });
        else layer.style.opacity = '';
      }
      if (bar) {
        lockCatBarTrack(bar, false);
        bar.classList.remove('is-flying-out', 'is-cinema-flock', 'is-revealed');
        const gsap = getGsap();
        if (gsap) {
          gsap.set(bar, { clearProps: 'opacity' });
          gsap.set(bar.querySelectorAll('.westo-dish-catbar__icon, .westo-dish-catbar__label'), {
            clearProps: 'opacity,visibility',
          });
        } else {
          bar.style.opacity = '';
        }
        bar.hidden = true;
        bar.setAttribute('aria-hidden', 'true');
        bar.querySelectorAll('.westo-dish-catbar__chip').forEach((chip) => {
          chip.classList.remove('is-fly-seat', 'is-fly-landed');
        });
        if (!gsap) {
          bar.querySelectorAll('.westo-dish-catbar__icon, .westo-dish-catbar__label').forEach((el) => {
            el.style.opacity = '';
            el.style.visibility = '';
          });
        }
      }
      if (window.lenis?.isStopped && typeof window.lenis.start === 'function') {
        window.lenis.start();
      }
      document.body.style.overflow = '';
      // Release ownership only after two paints: WebGL/hero chrome is now the
      // stable visual source. Keep a short non-pinning grace for trackpad/touch
      // elastic scroll so a tiny rebound cannot immediately start a forward fly.
      catFlyBusy = false;
      catFlyReverseGraceUntil = Math.max(catFlyReverseGraceUntil, Date.now() + 180);
    };

    doubleRaf(finish);
    return true;
  }

  function completeScrollCatFly(pendingReveal) {
    if (!scrollCatFly || scrollFlyLanded || scrollCatFly.reverse) return;
    scrollFlyLanded = true;
    const { bar, flights, activeId, layer } = scrollCatFly;
    const flyIdSet = new Set(flights.map((f) => f.categoryId));
    retargetScrollFlyBSeats(bar, flights, activeId, scrollCatFly.orderIndex);
    lastFlyManifest = flights.map((f) => ({
      categoryId: f.categoryId,
      cover: f.el?.querySelector('img')?.src || '',
      hero: { ...f.A },
      chip: { cx: f.B.cx, cy: f.B.cy, size: f.B.size },
      isActive: f.isActive,
    }));
    applyScrollCatFlyFrame(1);

    const root = document.documentElement;
    lockCatBarTrack(bar, false);
    bar.classList.remove('is-flying-in');
    bar.classList.add('is-revealed', 'is-cinema-flock');
    setCatFlyBarOpacity(bar, 1);
    // Atomic handoff: keep `is-cat-flying` alive while the dish media is
    // painted underneath the landed orbs.  CSS already has the exact
    // `.is-cat-flying.is-cat-fly-media-under` contract for this; the previous
    // implementation removed `is-cat-flying` immediately, bypassing that
    // handoff and exposing a black frame / full-card flash.
    root.classList.add('is-dish-boards', 'is-cat-flying', 'is-cat-fly-media-under', 'is-cat-fly-handoff');
    root.classList.remove('is-cat-scroll-fly', 'is-cat-fly-covered');

    // Keep transition ownership locked until finishLand() commits the final
    // state.  Scroll/viewport observers must not toggle dish mode mid-handoff.
    catFlyBusy = true;

    if (pendingReveal) revealPendingDishBoard(pendingReveal);

    bar.querySelectorAll('.westo-dish-catbar__chip').forEach((chip) => {
      const id = String(chip.dataset.categoryId || '');
      chip.classList.toggle('is-fly-landed', flyIdSet.has(id));
      chip.classList.remove('is-fly-seat');
    });
    setCatFlyElementsOpacity(
      [...bar.querySelectorAll('.westo-dish-catbar__icon')],
      1,
      { visibility: 'visible' },
    );

    const gsap = getGsap();
    const allLabels = [...bar.querySelectorAll('.westo-dish-catbar__label')];
    const allIcons = [...bar.querySelectorAll('.westo-dish-catbar__icon')];
    const finishLand = () => {
      // Arm the dish chrome fade before releasing the flying lock, then switch
      // all state classes in one synchronous commit. Dish media has already
      // painted under the orbs for at least one frame, so there is no empty
      // visual state between Hero and Dish.
      root.classList.add('is-dish-boards', 'is-cat-fly-dish-in');
      root.classList.remove(
        'is-cat-flying',
        'is-cat-scroll-fly',
        'is-cat-fly-covered',
        'is-cat-fly-media-under',
        'is-cat-fly-handoff',
      );
      scrollCatFly = null;
      scrollFlyLanded = true;
      catFlyBusy = false;
      catFlyLandGraceUntil = Date.now() + 320;
      if (window.lenis?.isStopped && typeof window.lenis.start === 'function') {
        window.lenis.start();
      }
      document.body.style.overflow = '';

      // Keep the covering orbs for one additional paint after the class commit.
      // The underlying media is now guaranteed visible; removing the layer in
      // the following frame prevents both a one-frame hole and double-image pop.
      if (layer) {
        requestAnimationFrame(() => {
          layer.classList.remove('is-active');
          layer.replaceChildren();
          if (gsap) gsap.set(layer, { clearProps: 'opacity' });
          else layer.style.opacity = '';
        });
      }
      bar.classList.remove('is-cinema-flock');
      bar.querySelectorAll('.westo-dish-catbar__chip.is-fly-landed').forEach((c) =>
        c.classList.remove('is-fly-landed'),
      );
      if (gsap) {
        gsap.set([...allIcons, ...allLabels], { clearProps: 'opacity,visibility' });
      } else {
        allIcons.forEach((el) => {
          el.style.opacity = '';
          el.style.visibility = '';
        });
        allLabels.forEach((el) => {
          el.style.opacity = '';
          el.style.visibility = '';
        });
      }
      const settled = findCatBarChip(bar, activeId);
      if (settled) centerDishCatChip(settled, { instant: false });
      syncDishCatBar({ skipReveal: true });
    };

    if (gsap) {
      killScrollFlyGsap(scrollCatFly);
      scrollCatFly.landTween = gsap
        .timeline({
          delay: 0.032,
          onComplete: () => root.classList.remove('is-cat-fly-dish-in'),
        })
        .add(finishLand, 0)
        .to(allLabels, {
          opacity: 1,
          visibility: 'visible',
          duration: 0.32,
          stagger: 0.008,
          ease: 'power2.out',
        }, 0)
        .add(() => root.classList.remove('is-cat-fly-dish-in'), 0.42);
    } else {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          finishLand();
          window.setTimeout(() => root.classList.remove('is-cat-fly-dish-in'), 420);
        });
      });
    }
  }

  function cancelScrollCatFly({ keepLanded = false } = {}) {
    if (!scrollCatFly) return;
    const { bar, layer } = scrollCatFly;
    killScrollFlyGsap(scrollCatFly);
    scrollCatFly = null;
    if (!keepLanded) scrollFlyLanded = false;
    catFlyBusy = false;
    document.documentElement.classList.remove(
      'is-cat-flying',
      'is-cat-scroll-fly',
      'is-cat-fly-covered',
      'is-cat-fly-media-under',
      'is-cat-fly-handoff',
    );
    if (typeof window.__westoHideHeroPlatesForFly === 'function') {
      window.__westoHideHeroPlatesForFly(false);
    }
    if (layer) {
      layer.classList.remove('is-active');
      layer.replaceChildren();
      const gsap = getGsap();
      if (gsap) gsap.set(layer, { clearProps: 'opacity' });
      else layer.style.opacity = '';
    }
    if (bar) {
      lockCatBarTrack(bar, false);
      bar.classList.remove('is-flying-in', 'is-cinema-flock', 'is-revealed');
      const gsap = getGsap();
      if (gsap) {
        gsap.set(bar, { clearProps: 'opacity' });
        gsap.set(bar.querySelectorAll('.westo-dish-catbar__icon, .westo-dish-catbar__label'), {
          clearProps: 'opacity,visibility',
        });
      } else {
        bar.style.opacity = '';
      }
      bar.querySelectorAll('.westo-dish-catbar__chip').forEach((chip) => {
        chip.classList.remove('is-fly-seat', 'is-fly-landed');
      });
      if (!gsap) {
        bar.querySelectorAll('.westo-dish-catbar__icon, .westo-dish-catbar__label').forEach((el) => {
          el.style.opacity = '';
          el.style.visibility = '';
        });
      }
    }
  }

  function revealPendingDishBoard(explicitEl = pendingDishRevealEl) {
    const el = explicitEl;
    if (!explicitEl || explicitEl === pendingDishRevealEl) pendingDishRevealEl = null;
    if (!el || !el.isConnected) return;
    // Force heal while fly lock may still be on — preload src before unlock paint.
    healActiveBoardMedia(el, { force: true });
    const img = el.querySelector('.dish-board-media img');
    const sync = () => syncSharedDishCard(el, { animate: false });
    sync();
    if (img?.decode && img.src && !img.complete) {
      img.decode().then(sync).catch(() => {});
    }
  }

  function commitLeaveDishUiAfterOrbs() {
    if (!pendingLeaveDishUi) return;
    pendingLeaveDishUi = false;
    if (pendingLeaveRaf) {
      cancelAnimationFrame(pendingLeaveRaf);
      pendingLeaveRaf = 0;
    }
    document.documentElement.classList.remove('is-dish-boards');
    if (window.westoRestoreHeroScene) {
      window.westoRestoreHeroScene({ hidden: true });
    }
  }

  // v13.7: active underline is local to the active chip. No floating marker
  // needs per-scroll geometry reads, so indicator scheduling is intentionally
  // zero-work. This removes duplicate getBoundingClientRect loops from scroll.
  function updateDishCatBarIndicator() {}
  function scheduleDishCatBarIndicator() {}

  function syncDishCatBar(opts = {}) {
    const bar = rebuildDishCatBar(false);
    if (!bar) return;
    ensureCatBarTrackInteractive(bar);
    const onDishes = document.documentElement.classList.contains('is-dish-boards');
    const activeId =
      lastFilledCategoryId != null ? String(lastFilledCategoryId) : String(activeCategoryId() ?? '');
    const wasHidden = bar.hidden;
    if (opts.forceHide != null) {
      bar.hidden = Boolean(opts.forceHide);
    } else if (catFlyBusy) {
      // Keep the strip mounted while orbs fly (especially reverse after leave).
      bar.hidden = false;
    } else {
      bar.hidden = !onDishes;
    }
    bar.setAttribute('aria-hidden', bar.hidden ? 'true' : 'false');
    bar.setAttribute('aria-label', tr('nav.categories') || 'دسته‌ها');
    syncDishSubBar(activeId, activeViewportSlot < 0 ? 0 : activeViewportSlot, {
      forceHide: bar.hidden || catFlyBusy || document.documentElement.classList.contains('is-cat-flying'),
    });
    if (!onDishes && !catFlyBusy) {
      bar.classList.remove('is-flying-in', 'is-revealed', 'is-flying-out');
      return;
    }
    if (catFlyBusy || opts.skipReveal || bar.classList.contains('is-flying-in')) {
      // Active state only — fly tween owns reveal.
      bar.querySelectorAll('.westo-dish-catbar__chip').forEach((chip) => {
        const on = chip.dataset.categoryId === activeId;
        chip.classList.toggle('is-active', on);
        chip.setAttribute('aria-current', on ? 'true' : 'false');
      });
      syncCatBarA11y(bar, activeId);
      const activeChip = findNearestCatBarChip(bar, activeId) || findCatBarChip(bar, activeId);
      if (activeChip && !opts.skipCenter && !isCatBarUserScrubbing()) {
        centerDishCatChip(activeChip, { instant: true, preferNearest: true });
      } else if (activeChip) {
        settleDishCatNeighbors(activeChip);
      }
      scheduleDishCatBarIndicator(bar, activeId);
      return;
    }

    // Re-play entrance when the strip first appears on dish boards.
    if (wasHidden && onDishes) {
      bar.classList.remove('is-revealed');
      // Do not force style/layout with offsetWidth to restart CSS animations.
      // A frame boundary is enough to create a new transition state.
      requestAnimationFrame(() => bar.isConnected && bar.classList.add('is-revealed'));
    }

    bar.querySelectorAll('.westo-dish-catbar__chip').forEach((chip) => {
      const on = chip.dataset.categoryId === activeId;
      const wasOn = chip.classList.contains('is-active');
      chip.classList.toggle('is-active', on);
      chip.setAttribute('aria-current', on ? 'true' : 'false');
      // Active styling is transition-driven. The old animation restart used a
      // synchronous offsetWidth read and forced layout on every category tap.
    });
    syncCatBarA11y(bar, activeId);
    const activeChip = findNearestCatBarChip(bar, activeId) || findCatBarChip(bar, activeId);
    if (activeChip && !isCatBarUserScrubbing()) {
      centerDishCatChip(activeChip, {
        instant: Boolean(wasHidden || opts.instantCenter),
        preferNearest: true,
      });
    } else if (activeChip) {
      settleDishCatNeighbors(activeChip);
    }
    scheduleDishCatBarIndicator(bar, activeId);
  }

  function selectDishCategory(categoryId, index, opts = {}) {
    const root = document.documentElement;
    const stableDishMode = root.classList.contains('is-dish-boards') && !root.classList.contains('is-cat-flying');
    if (categoryId == null || (!stableDishMode && isForcingHeroReturn())) return;
    if (stableDishMode) recoverStableDishInteractionState();
    const mode = opts.mode || 'click';
    const wasOnDishes = root.classList.contains('is-dish-boards') || scrollFlyLanded;    // #endregion
    clearCatBarBrowsing();
    resourceScheduler()?.focusCategory?.(categoryId, { reason: mode, slot: 0 });
    if (window.carousel && typeof window.carousel.goTo === 'function') {
      // The Three carousel is hidden in dish mode. Snap its logical index so a
      // long category jump cannot emit intermediate indexes while layout is
      // rebuilding (that race previously remapped boards and returned to hero).
      window.carousel.goTo(index, { immediate: wasOnDishes });
    }
    fillBoards(categoryId);
    // Every category control inside dish mode owns a logical menu change, not a
    // page navigation. Keep the scroll anchor hard-pinned across the refresh
    // frame; the dish crossfade supplies the visual transition.
    if (wasOnDishes || mode === 'step') {
      pinScrollToDishBoards({ immediate: true });
      catStepGuardUntil = Math.max(catStepGuardUntil, Date.now() + 1100);
      requestAnimationFrame(() => {
        refreshDishBoardsCache();
        pinScrollToDishBoards({ immediate: true });
      });
    } else {
      const boards = dishBoardsCache?.length ? dishBoardsCache : refreshDishBoardsCache();
      const first = boards[0];
      if (first) {
        if (window.lenis) {
          window.lenis.scrollTo(first, { offset: 0, duration: 0.55 });
        } else {
          first.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }
    }
    syncDishCatBar({ skipReveal: mode === 'step', skipCenter: true });
    requestAnimationFrame(() => {
      const bar = $('#westo-dish-catbar');
      if (!bar) return;
      const chip = findNearestCatBarChip(bar, categoryId);
      if (!chip) return;
      centerDishCatChip(chip, {
        instant: false,
        duration: mode === 'step' ? 0.28 : 0.32,
        ease: 'power3.out',
        preferNearest: true,
      });
    });
  }

  // Public bridge for promo/story cards and other internal deep links. It reuses
  // the authoritative category state machine instead of creating a second menu
  // navigation path. Dish targeting resolves category + logical slot first, then
  // scrolls only after the category DOM has committed.
  window.westoOpenMenuTarget = (target = {}) => {
    let categoryId = Number(target.categoryId);
    let slot = Number.isFinite(Number(target.slot)) ? Math.max(0, Number(target.slot)) : 0;
    const dishId = Number(target.dishId);

    if (Number.isFinite(dishId)) {
      let found = null;
      for (const [rawCategoryId, items] of Object.entries(menuByCategory || {})) {
        const index = (items || []).findIndex((item) => Number(item?.id) === dishId);
        if (index >= 0) {
          found = { categoryId: Number(rawCategoryId), slot: index };
          break;
        }
      }
      if (!found) return false;
      categoryId = found.categoryId;
      slot = found.slot;
    }

    if (!Number.isFinite(categoryId)) return false;
    const order = window.__westoCategoryOrder?.length ? window.__westoCategoryOrder : categoryOrder;
    const categoryIndex = (order || []).findIndex((id) => Number(id) === categoryId);
    if (categoryIndex < 0) return false;

    selectDishCategory(categoryId, categoryIndex, { mode: 'promo' });
    if (Number.isFinite(dishId) || slot > 0) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => scrollToDishSlot(slot));
      });
    }
    return true;
  };

  // Document capture: survives navbar remounts and beats competing chip handlers.
  {
    let lastBackAt = 0;
    document.addEventListener(
      'click',
      (e) => {
        const btn = e.target?.closest?.('#westo-back-categories');
        if (!btn) return;
        const now = Date.now();
        if (now - lastBackAt < 350) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        lastBackAt = now;
        e.preventDefault();
        e.stopPropagation();
        if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
        try {
          goToCategories();
        } catch (err) {
          console.error('[westo] goToCategories failed', err);
        }
      },
      true,
    );
    try {
      window.westoGoToCategories = goToCategories;
    } catch (_) {}
  }
  // Keep back-btn + category strip in sync with dish-board state
  {
    let classSyncRaf = 0;
    const mo = new MutationObserver(() => {
      if (classSyncRaf) return;
      classSyncRaf = requestAnimationFrame(() => {
        classSyncRaf = 0;
        syncBackCategoriesBtn();
        syncDishCatBar();
      });
    });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    syncBackCategoriesBtn();
    syncDishCatBar();
  }

  // Prefer sushi boards on first paint (category 3) until carousel reports.
  updateBadge();
  renderCart();
  paintTableChrome();
  loadMenu();
  bindCarousel();
  skipProfileForMenuStory();

  document.addEventListener('westo:langchange', () => {
    paintTableChrome();
    renderCart();
    try {
      fillBoards(activeCategoryId());
    } catch (_) {}
    rebuildDishCatBar(true);
    syncDishCatBar();
  });

  document.addEventListener('westo:menu-ready', () => {
    try {
      const store = window.westoMenuStore;
      if (store?.byCategory) menuByCategory = store.byCategory;
      if (store?.categoryOrder?.length) categoryOrder = store.categoryOrder.slice();
    } catch (_) {}
    rebuildDishCatBar(true);
    syncDishCatBar({ instantCenter: true });
  });

  document.addEventListener('westo:cartchange', () => {
    cart = loadCart();
    updateBadge();
    renderCart();
  });

  window.westoCatbarDiagnostics = () => {
    const bar = document.getElementById('westo-dish-catbar');
    const track = bar?.querySelector('.westo-dish-catbar__track');
    const style = bar ? getComputedStyle(bar) : null;
    return {
      chips: bar?.querySelectorAll('.westo-dish-catbar__chip').length || 0,
      images: bar?.querySelectorAll('.westo-dish-catbar__thumb').length || 0,
      loopCopies: Number(track?.dataset.loopCopies || 0),
      infinite: Boolean(track?.classList.contains('is-infinite')),
      backdropFilter: style?.backdropFilter || style?.webkitBackdropFilter || 'none',
      width: bar?.getBoundingClientRect().width || 0,
    };
  };
})();

;/* ===== END js/table-cart.js ===== */

/* ===== BEGIN js/animations.js ===== */

  const westOAnimationsBoot = () => {
    // #region Helpers

    const $ = (selector, parent = document) => parent.querySelector(selector);
    const $$ = (selector, parent = document) => parent.querySelectorAll(selector);
    const clamp = (v, min, max) => Math.min(Math.max(v, min), max);

    // Debounce util (mutualisé pour colors / video)
    const debounce = (fn, ms = 150) => {
      let t = null;
      return (...args) => {
        if (t) clearTimeout(t);
        t = setTimeout(() => {
          fn(...args);
          t = null;
        }, ms);
      };
    };

    // Breakpoints

    const bp = {
      mobile: window.matchMedia('(max-width: 991px)'),
      desktop: window.matchMedia('(min-width: 992px)'),
    };

    const isMobile = () => bp.mobile.matches;
    const isDesktop = () => bp.desktop.matches;
    const prefersReducedMotion = () =>
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    /* Weak phones: clip-path + blur + SplitText together hitch hard. */
    const prefersMenuLite = () => {
      if (prefersReducedMotion()) return true;
      if (isMobile()) return true;
      const cores = Number(navigator.hardwareConcurrency) || 0;
      const mem = Number(navigator.deviceMemory) || 0;
      return (cores > 0 && cores <= 4) || (mem > 0 && mem <= 4);
    };

    // SplitText

    const createLinesMask = (el, options = {}) => {
      const { stagger = 0.08, duration = 0.7, ease = 'power3.out' } = options;
      if (!el || !String(el.textContent || '').trim()) {
        return { in: () => {}, out: () => {}, revert: () => {} };
      }

      if (prefersMenuLite() || !window.SplitText) {
        gsap.set(el, { opacity: 0, y: 16 });
        return {
          in: ({ delay = 0 } = {}) =>
            gsap.to(el, {
              opacity: 1,
              y: 0,
              duration: duration * 0.85,
              ease,
              delay,
              overwrite: true,
            }),
          out: ({ delay = 0 } = {}) =>
            gsap.to(el, {
              opacity: 0,
              y: -16,
              duration: duration * 0.85,
              ease: 'power2.in',
              delay,
              overwrite: true,
            }),
          revert: () => {
            gsap.set(el, { clearProps: 'opacity,transform' });
          },
        };
      }

      const split = new SplitText(el, {
        type: 'lines',
        mask: 'lines',
        linesClass: 'line',
      });
      const targets = split.lines;
      if (!targets?.length) {
        return { in: () => {}, out: () => {}, revert: () => split.revert() };
      }

      gsap.set(targets, { yPercent: 110 });

      return {
        in: ({ delay = 0 } = {}) =>
          gsap.to(targets, {
            yPercent: 0,
            duration,
            ease,
            stagger,
            delay,
            overwrite: true,
          }),
        out: ({ delay = 0 } = {}) =>
          gsap.to(targets, {
            yPercent: -110,
            duration,
            ease,
            stagger,
            delay,
            overwrite: true,
          }),
        revert: () => split.revert(),
      };
    };

    const createCharsMask = (el, options = {}) => {
      const { stagger = 0.01, duration = 0.6, ease = 'power3.out' } = options;
      if (!el || !String(el.textContent || '').trim()) {
        return { in: () => {}, out: () => {}, revert: () => {} };
      }

      if (prefersMenuLite() || !window.SplitText) {
        gsap.set(el, { opacity: 0, y: 14 });
        return {
          in: ({ delay = 0 } = {}) =>
            gsap.to(el, {
              opacity: 1,
              y: 0,
              duration: duration * 0.85,
              ease,
              delay,
              overwrite: true,
            }),
          out: ({ delay = 0 } = {}) =>
            gsap.to(el, {
              opacity: 0,
              y: -14,
              duration: duration * 0.85,
              ease: 'power2.in',
              delay,
              overwrite: true,
            }),
          revert: () => {
            gsap.set(el, { clearProps: 'opacity,transform' });
          },
        };
      }

      // Arabic-script letters are joined; splitting per char breaks shaping.
      const isArabicScript = /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/.test(el.textContent);
      const split = new SplitText(el, {
        type: isArabicScript ? 'lines,words' : 'lines,chars',
        mask: 'lines',
        linesClass: 'line',
      });
      const targets = isArabicScript ? split.words : split.chars;
      if (!targets?.length) {
        return { in: () => {}, out: () => {}, revert: () => split.revert() };
      }

      gsap.set(targets, { yPercent: 110 });

      return {
        in: ({ delay = 0 } = {}) =>
          gsap.to(targets, {
            yPercent: 0,
            duration,
            ease,
            stagger,
            delay,
            overwrite: true,
          }),
        out: ({ delay = 0 } = {}) =>
          gsap.to(targets, {
            yPercent: -110,
            duration,
            ease,
            stagger,
            delay,
            overwrite: true,
          }),
        revert: () => split.revert(),
      };
    };

    const initAnimations = (parent = document, excludeSelector = '') => {
      const all = $$('[data-anim]', parent);
      const els = excludeSelector ? [...all].filter((el) => !el.closest(excludeSelector)) : [...all];
      if (!els.length) return null;

      const instances = [];

      els.forEach((el) => {
        const type = el.dataset.anim;
        const stagger = parseFloat(el.dataset.animStagger) || undefined;
        const duration = parseFloat(el.dataset.animDuration) || undefined;
        const ease = el.dataset.animEase || undefined;

        const opts = { stagger, duration, ease };
        let anim = null;

        if (type === 'lines-mask') {
          anim = createLinesMask(el, opts);
        }

        if (type === 'chars-mask') {
          anim = createCharsMask(el, opts);
        }

        if (anim) instances.push(anim);
      });

      if (!instances.length) return null;

      return {
        in: (opts) => instances.forEach((a) => a.in(opts)),
        out: (opts) => instances.forEach((a) => a.out(opts)),
        revert: () => instances.forEach((a) => a.revert()),
      };
    };

    // #region Entrance gate (replaces auto preloader)

    const initLoader = () => {
      const loaderWrapper = $('.loader');
      const gammeContainer = $('.gamme_container');
      const navbar = $('.navbar');
      const hud = $('.hud');
      const hudLeft = $('.hud_left');
      const hudRight = $('.hud_right');
      // Three.js appends WebGL as a direct child of <main>; never pick #eg-particles
      const getSceneCanvas = () => {
        const direct = document.querySelector('main > canvas:not(#eg-particles)');
        if (direct) return direct;
        return (
          [...document.querySelectorAll('canvas')].find(
            (c) => c.id !== 'eg-particles' && !c.classList?.contains('eg-ambient__particles'),
          ) || null
        );
      };
      const enterBtn = $('#eg-enter');
      const enterLabel = $('#eg-cta-label');
      const siteMenuBtn = $('#eg-site-menu');
      const sheet = $('#eg-sheet');
      const sheetScrim = $('#eg-scrim');
      const sheetTitle = $('#eg-sheet-title');
      const siteNav = $('.eg-site-nav', loaderWrapper);
      const infoTabs = $('#eg-info-tabs');
      const sheetCloseBtn = $('[data-eg-sheet-close]', loaderWrapper);
      let sheetFocusReturn = null;

      const focusablesIn = (container) => {
        if (!container) return [];
        return $$('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])', container)
          .filter((el) => !el.hidden && el.getClientRects().length && el.getAttribute('aria-hidden') !== 'true');
      };
      const setSceneAccessibility = (blocked) => {
        const canvas = getSceneCanvas();
        [gammeContainer, navbar, hud, canvas].filter(Boolean).forEach((el) => {
          if (blocked) {
            el.setAttribute('inert', '');
            el.setAttribute('aria-hidden', 'true');
          } else {
            el.removeAttribute('inert');
            el.removeAttribute('aria-hidden');
          }
        });
      };

      if ('scrollRestoration' in history) {
        history.scrollRestoration = 'manual';
      }

      window.scrollTo(0, 0);
      window.lenis?.scrollTo(0, { immediate: true });
      window.addEventListener('load', () => {
        window.scrollTo(0, 0);
        window.lenis?.scrollTo(0, { immediate: true });
      });
      requestAnimationFrame(() => {
        window.scrollTo(0, 0);
        window.lenis?.scrollTo(0, { immediate: true });
      });

      document.documentElement.style.overflow = 'hidden';
      document.body.style.overflow = 'hidden';
      document.documentElement.classList.add('is-entrance-gate');
      window.lenis?.stop();

      const hideSceneChrome = () => {
        const canvas = getSceneCanvas();
        const hideTargets = [gammeContainer, navbar, hud, canvas].filter(Boolean);
        hideTargets.forEach((el) => gsap.set(el, { autoAlpha: 0 }));
      };
      hideSceneChrome();
      setSceneAccessibility(true);
      // Three.js mounts async — re-hide when the WebGL canvas appears
      window.addEventListener(
        'carousel:ready',
        () => {
          const canvas = getSceneCanvas();
          if (canvas) {
            gsap.set(canvas, { autoAlpha: 0 });
            canvas.setAttribute('inert', '');
            canvas.setAttribute('aria-hidden', 'true');
          }
        },
        { once: true },
      );
      gsap.set(document.body, { '--loader-reveal': '100vh' });

      // Immersive doorway FX (logo draw, story loader, parallax, particles)
      try {
        window.westoEntrance?.init?.({ gsap });
      } catch (_) {}

      let sceneReady = false;
      let userRequestedEnter = false;
      let entered = false;

      const i18n = () => window.westoI18n;
      const tr = (key, vars) => (i18n()?.t ? i18n().t(key, vars) : key);
      const localizedAdminCopy = (key, value) => {
        const clean = typeof value === 'string' ? value.trim() : '';
        if (key === 'entrance.subtitle' && i18n()?.lang === 'fa' && /^cafe\s*&\s*restaurant$/i.test(clean)) return tr('eg.subtitleEn');
        return clean;
      };
      const entranceAdminCopy = (key, fallback) => {
        const value = window.__WESTO_CONTENT__?.content?.[key];
        const localized = localizedAdminCopy(key, value);
        return localized || fallback;
      };
      const applyGateAdminCopy = () => {
        if (!loaderWrapper) return;
        $$('[data-admin-content]', loaderWrapper).forEach((el) => {
          const key = el.getAttribute('data-admin-content');
          const value = key ? window.__WESTO_CONTENT__?.content?.[key] : '';
          const localized = localizedAdminCopy(key, value);
          if (localized) el.textContent = localized;
        });
      };
      const entranceCtaCopy = () => entranceAdminCopy('entrance.cta', tr('eg.enterWesto'));

      const setCtaReady = () => {
        if (!enterBtn || !enterLabel) return;
        enterBtn.disabled = false;
        enterLabel.textContent = entranceCtaCopy();
        if (loaderWrapper) loaderWrapper.setAttribute('aria-busy', 'false');
        try {
          window.westoEntrance?.completeExperienceLoader?.();
        } catch (_) {}
      };

      const setCtaPreparing = () => {
        if (!enterLabel || sceneReady) return;
        enterLabel.textContent = entranceCtaCopy();
      };
      setCtaPreparing();

      const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
      const DAY_ORDER = ['sat', 'sun', 'mon', 'tue', 'wed', 'thu', 'fri'];

      let lastGatePayload = null;

      const applyGateChromeI18n = () => {
        if (!loaderWrapper) return;
        $$('[data-i18n]', loaderWrapper).forEach((el) => {
          const key = el.getAttribute('data-i18n');
          if (key) el.textContent = tr(key);
        });
        const loginBtn = $('.eg-top a.eg-glass-btn', loaderWrapper);
        if (loginBtn) loginBtn.setAttribute('aria-label', tr('eg.aria.login'));
        if (siteMenuBtn) siteMenuBtn.setAttribute('aria-label', tr('eg.aria.menu'));
        const lang = i18n()?.lang || 'fa';
        const arSeg = $('#eg-lang-ar', loaderWrapper);
        if (arSeg) arSeg.hidden = false;
        $$('.eg-lang-seg', loaderWrapper).forEach((opt) => {
          opt.classList.toggle('is-active', opt.getAttribute('data-lang') === lang);
        });
        const themeBtn = $('#eg-theme-toggle', loaderWrapper);
        if (themeBtn) {
          const resolved = window.westoTheme?.get?.() || 'dark';
          themeBtn.setAttribute(
            'aria-label',
            resolved === 'light' ? tr('eg.themeLight') : tr('eg.themeDark'),
          );
          const themeLabel = $('.eg-corner__label', themeBtn);
          if (themeLabel) {
            themeLabel.textContent = resolved === 'light' ? tr('eg.themeLight') : tr('eg.themeDark');
          }
        }
        $$('.eg-chip-icon[data-eg-action]', loaderWrapper).forEach((chip) => {
          const action = chip.getAttribute('data-eg-action');
          const map = {
            phone: 'eg.dock.phone',
            map: 'eg.dock.map',
            instagram: 'eg.dock.instagram',
            hours: 'eg.hours',
            reserve: 'eg.dock.reserve',
          };
          if (map[action]) chip.setAttribute('aria-label', tr(map[action]));
        });
        const stepKeys = ['eg.step.brew', 'eg.step.world', 'eg.step.menu', 'eg.step.table'];
        $$('.eg-step-icon[data-eg-step]', loaderWrapper).forEach((el) => {
          const i = Number(el.getAttribute('data-eg-step'));
          if (stepKeys[i]) el.setAttribute('aria-label', tr(stepKeys[i]));
        });
        if (sceneReady) setCtaReady();
        else setCtaPreparing();
        // i18n paints generic locale copy first; entrance-specific Admin copy is
        // the final owner for fields explicitly marked data-admin-content.
        applyGateAdminCopy();
      };

      const parseHm = (s) => {
        const [h, m] = String(s || '0:0').split(':').map((n) => parseInt(n, 10) || 0);
        return h * 60 + m;
      };

      const isOpenNow = (hours) => {
        if (!hours) return { open: false, todayKey: DAY_KEYS[new Date().getDay()] };
        const todayKey = DAY_KEYS[new Date().getDay()];
        const today = hours[todayKey];
        if (!today || today.closed) return { open: false, todayKey, today };
        const now = new Date();
        const mins = now.getHours() * 60 + now.getMinutes();
        const openM = parseHm(today.open);
        let closeM = parseHm(today.close);
        // overnight window (e.g. 10:00 → 00:30)
        if (closeM <= openM) {
          return { open: mins >= openM || mins < closeM, todayKey, today };
        }
        return { open: mins >= openM && mins < closeM, todayKey, today };
      };

      const igUrl = (handle) => {
        if (!handle) return '';
        const h = String(handle).trim();
        if (/^https?:\/\//i.test(h)) return h;
        return `https://instagram.com/${h.replace(/^@/, '')}`;
      };

      const tiktokUrl = (handle) => {
        if (!handle) return '';
        const h = String(handle).trim();
        if (/^https?:\/\//i.test(h)) return h;
        return `https://www.tiktok.com/@${h.replace(/^@/, '')}`;
      };

      const waUrl = (phone) => {
        if (!phone) return '';
        const digits = String(phone).replace(/\D/g, '');
        if (!digits) return '';
        const normalized = digits.startsWith('0') ? `98${digits.slice(1)}` : digits;
        return `https://wa.me/${normalized}`;
      };

      let gateLinks = { phone: '', address: '', instagram: '', maps: '' };

      const setSheetMode = (mode) => {
        const isInfo = mode === 'info';
        if (siteNav) siteNav.hidden = isInfo;
        if (infoTabs) infoTabs.hidden = !isInfo;
        $$('.eg-panel', loaderWrapper).forEach((panel) => {
          if (!isInfo) {
            panel.hidden = true;
            panel.classList.remove('is-active');
            return;
          }
          const on = panel.classList.contains('is-active');
          panel.hidden = !on;
        });
        if (sheetTitle) sheetTitle.textContent = isInfo ? tr('eg.venueInfo') : tr('eg.siteMenu');
      };

      const openSheetTab = (tabId) => {
        setSheetMode('info');
        $$('.eg-tab', loaderWrapper).forEach((t) => {
          const on = t.getAttribute('data-eg-tab') === tabId;
          t.classList.toggle('is-active', on);
          t.setAttribute('aria-selected', on ? 'true' : 'false');
          t.setAttribute('tabindex', on ? '0' : '-1');
        });
        $$('.eg-panel', loaderWrapper).forEach((panel) => {
          const on = panel.getAttribute('data-eg-panel') === tabId;
          panel.classList.toggle('is-active', on);
          panel.hidden = !on;
        });
        setSheetOpen(true);
      };

      const openSiteMenu = () => {
        // Same circular night menu as the main navbar trigger
        if (window.westoNavMenu?.toggle) {
          window.westoNavMenu.toggle(siteMenuBtn);
          return;
        }
        setSheetMode('nav');
        setSheetOpen(true);
      };

      const requestEnter = async () => {
        if (!sceneReady || entered || userRequestedEnter) return;
        userRequestedEnter = true;
        window.dispatchEvent(
          new CustomEvent('westo:enter-intent', {
            detail: { source: 'entrance-cta', at: performance.now() },
          }),
        );
        if (enterBtn) enterBtn.disabled = true;
        // Finish as much progressive menu load as budget allows before the reveal
        // (avoids the heavy first-frame hitch when stubs swap to real plates).
        if (window.westoBoot?.waitForEnter) {
          if (enterLabel) enterLabel.textContent = entranceCtaCopy();
          try {
            await window.westoBoot.waitForEnter(2200);
          } catch (_) {}
        }
        if (enterLabel) enterLabel.textContent = tr('eg.entering');
        enterScene();
      };
      // Public hook for tests / secondary UI that must enter the scene
      window.westoRequestEnter = requestEnter;

      if (
        typeof navigator !== 'undefined' &&
        (navigator.webdriver ||
          /Lighthouse|Chrome-Lighthouse|HeadlessChrome/i.test(navigator.userAgent || ''))
      ) {
        setTimeout(() => {
          try {
            requestEnter();
          } catch (_) {}
        }, 400);
      }

      const fillGate = (payload) => {
        lastGatePayload = payload;
        const restaurant = payload?.restaurant || {};
        const branch = payload?.branch || {};
        const hours = payload?.hours || {};
        const name = restaurant.brandName || restaurant.name || 'WESTO';
        // API tagline/about are FA-authored; use i18n strings for en/ar.
        // Never surface "3D / سه‌بعدی" marketing copy to guests.
        const lang = i18n()?.lang || 'fa';
        const rawTag = lang === 'fa' ? restaurant.tagline : '';
        const tagline =
          (rawTag && !/سه‌?بعدی|3\s*d|ثلاثية/i.test(rawTag) ? rawTag : '') ||
          tr('eg.tagline');
        const about =
          (lang === 'fa' && restaurant.about) ||
          tr('eg.aboutBody');
        const address = branch.address || restaurant.address || '';
        const phone = branch.phone || restaurant.phone || '';
        const whatsapp = branch.whatsapp || restaurant.whatsapp || '';
        const mapUrl = branch.mapUrl || restaurant.mapUrl || '';
        const instagram = restaurant.instagram || '';
        const tiktok = restaurant.tiktok || '';
        const website = restaurant.website || '';

        gateLinks = {
          phone: phone ? `tel:${phone}` : whatsapp ? waUrl(whatsapp) : '',
          address,
          instagram: igUrl(instagram),
          maps: mapUrl || (address
            ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`
            : ''),
        };

        const syncSocial = (kind, url) => {
          $$(`[data-dl-social="${kind}"]`).forEach((link) => {
            if (!url) {
              link.hidden = true;
              link.removeAttribute('href');
              return;
            }
            link.hidden = false;
            link.setAttribute('href', url);
            link.setAttribute('target', '_blank');
            link.setAttribute('rel', 'noopener');
          });
        };
        syncSocial('instagram', gateLinks.instagram);
        syncSocial('tiktok', tiktokUrl(tiktok));
        const instagramChip = $('[data-eg-action="instagram"]', loaderWrapper);
        if (instagramChip) {
          instagramChip.hidden = !gateLinks.instagram;
          instagramChip.toggleAttribute('aria-disabled', !gateLinks.instagram);
        }

        const nameEl = $('[data-eg="name"]', loaderWrapper);
        const tagEl = $('[data-eg="tagline"]', loaderWrapper);
        const aboutEl = $('[data-eg="about"]', loaderWrapper);
        const statusEl = $('[data-eg="status"]', loaderWrapper);
        const statusLabel = $('[data-eg="status-label"]', loaderWrapper);
        const hoursEl = $('[data-eg="hours"]', loaderWrapper);
        const contactEl = $('[data-eg="contact"]', loaderWrapper);
        const englishEl = $('[data-eg="english"]', loaderWrapper);

        if (nameEl) nameEl.textContent = restaurant.name || 'وستو';
        if (englishEl) englishEl.textContent = name;
        if (tagEl) tagEl.textContent = tagline;
        if (aboutEl) aboutEl.textContent = about;

        const { open, todayKey, today } = isOpenNow(hours);
        const cityRaw = String(address || '').trim() || tr('eg.cityFallback');
        const cityShort = cityRaw.length > 28 ? `${cityRaw.slice(0, 26)}…` : cityRaw;
        if (statusEl && statusLabel) {
          const meta =
            open && today
              ? tr('eg.until', { t: today.close })
              : today && !today.closed
                ? tr('eg.fromToday', { t: today.open })
                : '';
          try {
            window.westoEntrance?.applyStatusUi?.({
              loading: false,
              open,
              label: open ? tr('eg.open') : tr('eg.closed'),
              meta,
              location: cityShort,
            });
          } catch (_) {
            statusEl.classList.toggle('is-open', open);
            statusEl.classList.toggle('is-closed', !open);
            statusEl.classList.remove('is-loading');
            statusLabel.textContent = open ? tr('eg.open') : tr('eg.closed');
            const statusMeta = $('[data-eg="status-meta"]', loaderWrapper);
            const statusLoc = $('[data-eg="status-loc"]', loaderWrapper);
            if (statusMeta) statusMeta.textContent = meta;
            if (statusLoc) statusLoc.textContent = cityShort;
          }
          if (open && today) statusEl.title = tr('eg.until', { t: today.close });
          else if (today && !today.closed) statusEl.title = tr('eg.fromToday', { t: today.open });
        }

        if (hoursEl) {
          hoursEl.innerHTML = DAY_ORDER.map((key) => {
            const row = hours[key] || { open: '—', close: '—', closed: true };
            const time = row.closed ? tr('eg.closedDay') : `${row.open} – ${row.close}`;
            const todayClass = key === todayKey ? ' is-today' : '';
            const dayName = i18n()?.dayLabel ? i18n().dayLabel(key) : key;
            return `<li class="${todayClass}"><span class="eg-hours-day">${dayName}</span><span class="eg-hours-time">${time}</span></li>`;
          }).join('');
        }

        if (contactEl) {
          const bits = [];
          if (address) bits.push(`<p><strong>${tr('eg.address')}</strong><br/>${address}</p>`);
          if (phone) bits.push(`<p><strong>${tr('eg.tel')}</strong><br/><a dir="ltr" href="tel:${phone}">${phone}</a></p>`);
          if (whatsapp) {
            bits.push(
              `<p><strong>${tr('eg.whatsapp')}</strong><br/><a dir="ltr" href="${waUrl(whatsapp)}" target="_blank" rel="noopener">${whatsapp}</a></p>`,
            );
          }
          if (website) {
            bits.push(
              `<p><strong>${tr('eg.website')}</strong><br/><a dir="ltr" href="${website}" target="_blank" rel="noopener">${website.replace(/^https?:\/\//, '')}</a></p>`,
            );
          }
          contactEl.innerHTML = bits.join('') || `<p>${tr('eg.contactSoon')}</p>`;
        }

        applyGateChromeI18n();
      };

      const loadRestaurant = () => {
        const bootPayload = window.__WESTO_CONTENT__?.restaurantPayload;
        if (bootPayload) {
          fillGate(bootPayload);
          return Promise.resolve(bootPayload);
        }
        return fetch('/api/restaurant')
          .then((r) => (r.ok ? r.json() : null))
          .then((data) => {
            if (data) fillGate(data);
            return data;
          })
          .catch(() => null);
      };
      Promise.resolve().then(loadRestaurant).catch(() => null);

      // Sheet / site menu / info tabs
      const setSheetOpen = (open) => {
        if (!loaderWrapper) return;
        const wasOpen = loaderWrapper.classList.contains('is-sheet-open');
        if (open && !wasOpen) sheetFocusReturn = document.activeElement;
        loaderWrapper.classList.toggle('is-sheet-open', open);
        siteMenuBtn?.classList.toggle('is-active', open);
        siteMenuBtn?.setAttribute('aria-expanded', open ? 'true' : 'false');
        if (sheet) {
          sheet.hidden = !open;
          sheet.setAttribute('aria-hidden', open ? 'false' : 'true');
          if (open) sheet.removeAttribute('inert');
          else sheet.setAttribute('inert', '');
        }
        if (sheetScrim) sheetScrim.hidden = !open;
        if (open && !wasOpen) {
          requestAnimationFrame(() => {
            const target = sheetCloseBtn || focusablesIn(sheet)[0];
            target?.focus?.({ preventScroll: true });
          });
        } else if (!open && wasOpen) {
          const back = sheetFocusReturn;
          sheetFocusReturn = null;
          requestAnimationFrame(() => {
            if (back?.isConnected && typeof back.focus === 'function') back.focus({ preventScroll: true });
          });
        }
      };

      siteMenuBtn?.addEventListener('click', () => {
        if (window.westoNavMenu?.isOpen?.()) {
          window.westoNavMenu.close();
          return;
        }
        openSiteMenu();
      });
      sheetScrim?.addEventListener('click', () => setSheetOpen(false));
      sheetCloseBtn?.addEventListener('click', () => setSheetOpen(false));

      $$('.eg-tab', loaderWrapper).forEach((tab) => {
        tab.addEventListener('click', () => {
          const id = tab.getAttribute('data-eg-tab');
          openSheetTab(id);
        });
        tab.addEventListener('keydown', (event) => {
          if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
          const tabs = $$('.eg-tab', loaderWrapper).filter((node) => !node.hidden);
          const current = Math.max(0, tabs.indexOf(tab));
          let next = current;
          if (event.key === 'Home') next = 0;
          else if (event.key === 'End') next = tabs.length - 1;
          else if (event.key === 'ArrowRight') next = (current + 1) % tabs.length;
          else next = (current - 1 + tabs.length) % tabs.length;
          event.preventDefault();
          const target = tabs[next];
          openSheetTab(target?.getAttribute('data-eg-tab'));
          target?.focus?.({ preventScroll: true });
        });
      });

      $$('[data-eg-nav]', loaderWrapper).forEach((el) => {
        el.addEventListener('click', () => {
          const action = el.getAttribute('data-eg-nav');
          if (action === 'hours') return openSheetTab('hours');
          if (action === 'enter') {
            setSheetOpen(false);
            requestEnter();
          }
        });
      });

      $$('.eg-chip-icon', loaderWrapper).forEach((chip) => {
        chip.addEventListener('click', async (e) => {
          const action = chip.getAttribute('data-eg-action');
          if (action === 'reserve' && chip.tagName === 'A') {
            // allow native navigation; still mark active
          }
          $$('.eg-chip-icon', loaderWrapper).forEach((c) =>
            c.classList.toggle('is-active', c === chip && action !== 'lang'),
          );
          if (action === 'hours') return openSheetTab('hours');
          if (action === 'phone') {
            e.preventDefault();
            if (gateLinks.phone) window.location.href = gateLinks.phone;
            else openSheetTab('contact');
            return;
          }
          if (action === 'map') {
            e.preventDefault();
            if (gateLinks.maps) window.open(gateLinks.maps, '_blank', 'noopener');
            else openSheetTab('contact');
            return;
          }
          if (action === 'instagram') {
            e.preventDefault();
            if (gateLinks.instagram) window.open(gateLinks.instagram, '_blank', 'noopener');
            else openSheetTab('contact');
            return;
          }
          if (action === 'reserve') {
            // <a href="/reserve"> handles navigation
            return;
          }
        });
      });

      const langSwitch = $('#eg-lang-switch', loaderWrapper);
      langSwitch?.addEventListener('click', (e) => {
        const opt = e.target.closest('[data-lang]');
        if (!opt || !i18n()?.setLang) return;
        i18n().setLang(opt.getAttribute('data-lang'), { userInitiated: true });
      });

      const themeToggle = $('#eg-theme-toggle', loaderWrapper);
      themeToggle?.addEventListener('click', (e) => {
        e.preventDefault();
        try {
          window.westoTheme?.toggle?.();
        } catch (_) {}
        applyGateChromeI18n();
      });
      document.addEventListener('westo:theme-change', () => applyGateChromeI18n());

      document.addEventListener('westo:langchange', () => {
        applyGateChromeI18n();
        if (lastGatePayload) fillGate(lastGatePayload);
        // After i18n rewrites SplitText nodes, force title/desc leaves visible
        requestAnimationFrame(() => {
          $$('.carousel_list.is-hero [data-anim="chars-mask"], .carousel_list.is-desc [data-anim="chars-mask"], [data-menu-name], [data-menu-desc]').forEach(
            (el) => {
              gsap.set(el, { yPercent: 0, clearProps: 'transform' });
              $$(
                '.line, .line > div, .word, .char',
                el,
              ).forEach((leaf) => gsap.set(leaf, { yPercent: 0, clearProps: 'transform' }));
            },
          );
        });
      });
      applyGateChromeI18n();

      const enterScene = async () => {
        if (entered || !userRequestedEnter || !sceneReady) return;
        entered = true;
        setSheetOpen(false);

        try {
          await window.westoEntrance?.playExitPrelude?.();
        } catch (_) {}
        try {
          window.westoEntrance?.destroyFx?.();
        } catch (_) {}
        try {
          window.westoRenderWake?.({ force: true });
        } catch (_) {}

        const tl = gsap.timeline({
          defaults: { ease: 'power3.out' },
          onComplete: () => {
            setSceneAccessibility(false);
            document.documentElement.classList.remove('is-entrance-gate');
            window.dispatchEvent(
              new CustomEvent('westo:entered', {
                detail: { source: 'entrance-transition', at: performance.now() },
              }),
            );
            window.scrollTo(0, 0);
            // Lenis / overflow / swipe unlock are owned by window.loader.play()
            // so horizontal carousel input is not re-locked by this fade timeline.
            if (window.ScrollTrigger) ScrollTrigger.refresh();
          },
        });

        if (hud) tl.set(hud, { autoAlpha: 1 }, 0);

        const sceneCanvas = getSceneCanvas();
        tl.to(
          loaderWrapper,
          {
            autoAlpha: 0,
            duration: 0.55,
            ease: 'power2.inOut',
            onComplete: () => {
              gsap.set(loaderWrapper, { display: 'none', pointerEvents: 'none' });
              if (loaderWrapper) loaderWrapper.setAttribute('hidden', '');
            },
          },
          0,
        );
        if (sceneCanvas) {
          tl.to(sceneCanvas, { autoAlpha: 1, duration: 0.65, ease: 'power2.out' }, 0.05);
        }
        tl.to(document.body, { '--loader-reveal': '0vh', duration: 1, ease: 'power2.out' }, 0.15)
          .fromTo(navbar, { autoAlpha: 0, yPercent: -120 }, { autoAlpha: 1, yPercent: 0, duration: 0.9 }, 0.25);

        if (isMobile()) {
          tl.fromTo(hudLeft, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.9 }, 0.35).fromTo(
            hudRight,
            { autoAlpha: 0 },
            { autoAlpha: 1, duration: 0.9 },
            0.35,
          );
        } else {
          tl.fromTo(hudLeft, { autoAlpha: 0, x: '-10rem' }, { autoAlpha: 1, x: '0rem', duration: 0.9 }, 0.35).fromTo(
            hudRight,
            { autoAlpha: 0, x: '10rem' },
            { autoAlpha: 1, x: '0rem', duration: 0.9 },
            0.35,
          );
        }
        tl.fromTo(gammeContainer, { autoAlpha: 0 }, { autoAlpha: 1, yPercent: 0, duration: 1 }, 0.4);

        if (typeof window.loader?.play === 'function') {
          await window.loader.play();
        }
      };

      const onSceneReady = () => {
        if (sceneReady) return;
        sceneReady = true;
        setCtaReady();
        enterScene();
      };
      window.addEventListener('carousel:ready', onSceneReady);
      if (window.carousel && window.__sceneReady) onSceneReady();

      // Never leave the guest stuck if the 3D boot hangs
      window.setTimeout(() => {
        if (!sceneReady) {
          document.documentElement.dataset.westoBootFallback = '1';
          onSceneReady();
        }
      }, 8000);

      // Bind enter via click on the CTA (and bubbles from the label span)
      const onEnterIntent = (event) => {
        if (enterBtn?.disabled) return;
        if (event?.type === 'keydown' && event.key !== 'Enter' && event.key !== ' ') return;
        if (event?.type === 'keydown') event.preventDefault();
        requestEnter();
      };
      enterBtn?.addEventListener('click', onEnterIntent);
      enterBtn?.addEventListener('keydown', onEnterIntent);
      if (enterBtn) enterBtn.dataset.egBound = '1';

      // Default sheet to site-nav mode (info panels stay hidden until opened)
      setSheetMode('nav');

      document.addEventListener('keydown', (event) => {
        if (loaderWrapper?.classList.contains('is-sheet-open') && event.key === 'Tab') {
          const list = focusablesIn(sheet);
          if (!list.length) {
            event.preventDefault();
            sheetCloseBtn?.focus?.({ preventScroll: true });
            return;
          }
          const first = list[0];
          const last = list[list.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault(); last.focus({ preventScroll: true }); return;
          }
          if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault(); first.focus({ preventScroll: true }); return;
          }
        }
        if (event.key !== 'Escape') return;
        if (loaderWrapper?.classList.contains('is-sheet-open')) {
          event.preventDefault();
          setSheetOpen(false);
        }
      });
    };

    // #region Navbar

    // Sound Button

    const initSoundToggle = () => {
      const sound = $('#nav-sound-btn');
      if (!sound) return;

      const bars = $$('svg rect', sound);
      const label = sound.querySelector('.navbar_menu-sound__label');
      let isMuted = sound.classList.contains('is-muted');
      let playing = false;

      const t = (key, fallback) => {
        try {
          if (window.WestoI18n && typeof window.WestoI18n.t === 'function') {
            return window.WestoI18n.t(key) || fallback;
          }
        } catch (_) {}
        return fallback;
      };

      const syncLabels = () => {
        const aria = isMuted ? t('nav.sound_play', 'پخش صدا') : t('nav.sound_off', 'قطع صدا');
        sound.setAttribute('aria-pressed', isMuted ? 'true' : 'false');
        sound.setAttribute('aria-label', aria);
        sound.setAttribute('title', aria);
        if (label && !label.hasAttribute('data-i18n')) {
          label.textContent = t('nav.sound', 'صدا');
        }
      };

      const animateBar = (bar) => {
        if (!playing) return;
        const h = gsap.utils.random(2, 8, 0.1);
        gsap.to(bar, {
          attr: { height: h, y: (8 - h) / 2 },
          duration: gsap.utils.random(0.2, 0.5),
          ease: 'power1.inOut',
          onComplete: () => animateBar(bar),
        });
      };

      const start = () => {
        playing = true;
        bars.forEach(animateBar);
      };

      const stop = () => {
        playing = false;
        gsap.killTweensOf(bars);
        gsap.to(bars, {
          attr: { height: 2, y: 3 },
          duration: 0.3,
          ease: 'power2.out',
        });
      };

      sound.addEventListener('click', () => {
        isMuted = !isMuted;
        sound.classList.toggle('is-muted', isMuted);
        syncLabels();
        isMuted ? stop() : start();
      });

      syncLabels();
      if (isMuted) stop();
      else start();
    };

    // Scroll Button

    const initScrollIcon = () => {
      const wrappers = $$('.icon-scroll_wrapper');
      if (!wrappers.length) return;
      const entries = [];

      wrappers.forEach((wrapper) => {
        const arrows = $$('svg > g', wrapper);
        if (arrows.length !== 3) return;

        const [first, middle, last] = arrows;

        gsap.set([first, middle, last], { opacity: 0, scale: 0, transformOrigin: '50% 50%' });
        gsap.set(first, { y: 100 });
        gsap.set(last, { y: -100 });

        // This is the only always-repeating decorative timeline in the hero.
        // Keep the exact animation, but do not keep GSAP awake when its icon
        // cannot be seen (below the hero, dish mode, entrance gate, hidden tab).
        const tl = gsap.timeline({ repeat: -1, repeatDelay: 0.3, paused: true });

        tl.to(first, { opacity: 1, scale: 1, y: 0, duration: 0.6, ease: 'power2.out' }).to(middle, { opacity: 1, scale: 1, duration: 0.6, ease: 'power2.out' }, '-=0.4').to(last, { opacity: 1, scale: 1, y: 0, duration: 0.6, ease: 'power2.out' }, '-=0.4').to(
          [first, middle, last],
          {
            opacity: 0,
            duration: 0.4,
            ease: 'power2.in',
            stagger: 0.25,
          },
          '+=0.3',
        );
        entries.push({ wrapper, tl, inView: true });
      });

      const syncScrollIconPlay = () => {
        const globallyHidden =
          document.visibilityState === 'hidden' ||
          document.documentElement.classList.contains('is-entrance-gate') ||
          document.documentElement.classList.contains('is-dish-boards');
        entries.forEach(({ tl, inView }) => {
          const shouldRun = !globallyHidden && inView;
          if (shouldRun) {
            if (tl.paused()) tl.play();
          } else if (!tl.paused() || tl.time() !== 0) {
            tl.pause(0);
          }
        });
      };

      document.addEventListener('visibilitychange', syncScrollIconPlay);
      window.addEventListener('westo:thermal-idle', syncScrollIconPlay);
      window.addEventListener('westo:thermal-wake', syncScrollIconPlay);
      if (typeof MutationObserver !== 'undefined') {
        new MutationObserver(syncScrollIconPlay).observe(document.documentElement, {
          attributes: true,
          attributeFilter: ['class'],
        });
      }

      if (typeof IntersectionObserver !== 'undefined') {
        const byWrapper = new Map(entries.map((entry) => [entry.wrapper, entry]));
        const observer = new IntersectionObserver(
          (changes) => {
            changes.forEach((change) => {
              const entry = byWrapper.get(change.target);
              if (entry) entry.inView = change.isIntersecting && change.intersectionRatio > 0;
            });
            syncScrollIconPlay();
          },
          { root: null, rootMargin: '80px 0px', threshold: 0.01 },
        );
        entries.forEach((entry) => observer.observe(entry.wrapper));
      }

      syncScrollIconPlay();
    };

    // Menu Button

    const initMenuButton = () => {
      if (!isDesktop()) return;

      const button = $('.navbar_menu-button');
      if (!button) return;

      const circles = $$('svg circle', button);
      if (!circles.length) return;

      gsap.set(circles, { transformOrigin: '50% 50%' });

      let tl = null;

      button.addEventListener('mouseenter', () => {
        if (tl) tl.kill();
        gsap.set(circles, { scale: 1 });

        tl = gsap.timeline({ repeat: -1 });
        tl.to(circles, {
          scale: 0.5,
          duration: 0.4,
          ease: 'power2.inOut',
          stagger: { each: 0.1, from: 'start' },
        }).to(circles, {
          scale: 1,
          duration: 0.4,
          ease: 'power2.inOut',
          stagger: { each: 0.1, from: 'start' },
        });
      });

      button.addEventListener('mouseleave', () => {
        if (tl) tl.kill();
        tl = null;
        gsap.to(circles, {
          scale: 1,
          duration: 0.3,
          ease: 'power2.out',
          overwrite: true,
        });
      });
    };

    // Arrow Button

    const initCarouselArrowsHover = () => {
      if (!isDesktop()) return;

      const arrows = $$('.carousel_arrow');
      if (!arrows.length) return;

      arrows.forEach((arrow) => {
        const shapes = $$('svg path, svg rect', arrow);
        if (!shapes.length) return;

        gsap.set(shapes, { transformOrigin: '50% 50%' });

        let tl = null;

        arrow.addEventListener('mouseenter', () => {
          if (tl) tl.kill();
          gsap.set(shapes, { scale: 1 });

          tl = gsap.timeline({ repeat: -1 });
          tl.to(shapes, {
            scale: 0.5,
            duration: 0.4,
            ease: 'power2.inOut',
            stagger: { each: 0.08, from: 'start' },
          }).to(shapes, {
            scale: 1,
            duration: 0.4,
            ease: 'power2.inOut',
            stagger: { each: 0.08, from: 'start' },
          });
        });

        arrow.addEventListener('mouseleave', () => {
          if (tl) tl.kill();
          tl = null;
          gsap.to(shapes, {
            scale: 1,
            duration: 0.3,
            ease: 'power2.out',
            overwrite: true,
          });
        });
      });
    };

    // Menu Open/close — circular night-service reveal from the menu button

    const initMenuToggle = () => {
      const button = $('.navbar_menu-button');
      const menu = $('.navbar_menu');
      if (!button || !menu) return;

      const links = $$('.navbar_link', menu);
      if (!links.length) return;

      if (!menu.id) menu.id = 'westo-navbar-menu';
      button.setAttribute('role', 'button');
      button.setAttribute('tabindex', '0');
      button.setAttribute('aria-label', 'باز کردن منو');
      button.setAttribute('aria-controls', menu.id);
      button.setAttribute('aria-expanded', 'false');
      menu.setAttribute('aria-hidden', 'true');

      let scrim = $('#westo-navbar-scrim');
      if (!scrim) {
        scrim = document.createElement('div');
        scrim.className = 'navbar_menu-scrim';
        scrim.id = 'westo-navbar-scrim';
        scrim.hidden = true;
        scrim.setAttribute('aria-hidden', 'true');
      }

      // Escape navbar stacking context so the stage covers hero chrome
      if (scrim.parentElement !== document.body) document.body.appendChild(scrim);
      if (menu.parentElement !== document.body) document.body.appendChild(menu);

      const topbar = $('.navbar_menu-topbar', menu);
      const prefsBar = $('.navbar_prefs', menu) || $('.navbar_theme', menu);
      const closeBtn = $('.navbar_menu-close', menu);
      const middle = $('.navbar_middle', menu);
      const bottom = $('.navbar_bottom', menu);
      const watermark = $('.navbar_menu-watermark', menu);
      const orbs = $$('.navbar_menu-orb', menu);
      const metas = $$('.navbar_link-meta', menu);
      const arrows = $$('.navbar_link-arrow', menu);
      const labels = $$('.navbar_link-label', menu);
      const gateMenuBtn = $('#eg-site-menu');
      const contentEls = [topbar, prefsBar, middle, bottom].filter(Boolean);

      /* SplitText lines are expensive — only build on capable / desktop path. */
      let linkReveals = [];
      const ensureLinkReveals = () => {
        if (linkReveals.length || prefersMenuLite()) return linkReveals;
        linkReveals = (labels.length ? [...labels] : [...links]).map((el) =>
          createLinesMask(el, { duration: 0.75, stagger: 0.03 }),
        );
        return linkReveals;
      };

      let isOpen = false;
      let animating = false;
      let activeTl = null;
      let orbDrift = null;
      let originEl = button;
      let menuFocusReturn = null;

      const menuFocusables = () =>
        $$('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])', menu)
          .filter((el) => !el.hidden && el.getClientRects().length && el.getAttribute('aria-hidden') !== 'true');
      const restoreMenuFocus = () => {
        const back = menuFocusReturn;
        menuFocusReturn = null;
        requestAnimationFrame(() => {
          if (back?.isConnected && typeof back.focus === 'function') back.focus({ preventScroll: true });
        });
      };

      const circleClip = (r, x, y) => `circle(${Math.max(0, r)}px at ${x}px ${y}px)`;

      const setMenuClip = (r, x, y) => {
        const clip = circleClip(r, x, y);
        menu.style.clipPath = clip;
        menu.style.webkitClipPath = clip;
      };

      const syncTriggers = (open) => {
        [button, gateMenuBtn].filter(Boolean).forEach((el) => {
          el.classList.toggle('is-open', open);
          el.classList.toggle('is-active', open);
          el.setAttribute('aria-expanded', open ? 'true' : 'false');
          el.setAttribute('aria-label', open ? 'بستن منو' : 'باز کردن منو');
        });
      };

      const originFromTrigger = () => {
        const el = originEl?.isConnected ? originEl : button;
        const br = el.getBoundingClientRect();
        const x = br.left + br.width / 2;
        const y = br.top + br.height / 2;
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const maxR = Math.ceil(Math.hypot(Math.max(x, vw - x), Math.max(y, vh - y))) + 48;
        return { x, y, maxR };
      };

      const setScrollLock = (lock) => {
        document.documentElement.classList.toggle('is-nav-menu-open', lock);
        if (window.lenis) {
          if (lock) window.lenis.stop();
          else if (!document.documentElement.classList.contains('is-entrance-gate')) window.lenis.start();
        }
      };

      const setAnimatingClass = (on, lite) => {
        document.documentElement.classList.toggle('is-nav-menu-animating', on);
        document.documentElement.classList.toggle('is-nav-menu-lite', !!lite);
        if (on) menu.style.willChange = 'clip-path';
        else menu.style.willChange = 'auto';
      };

      const stopOrbDrift = () => {
        if (orbDrift) {
          orbDrift.kill();
          orbDrift = null;
        }
      };

      const startOrbDrift = () => {
        stopOrbDrift();
        if (document.documentElement.dataset.thermalIdle === 'true' || !orbs.length || prefersMenuLite() || prefersReducedMotion()) return;
        orbDrift = gsap.timeline({ repeat: -1, yoyo: true });
        orbs.forEach((orb, i) => {
          orbDrift.to(
            orb,
            {
              x: i ? -28 : 34,
              y: i ? 22 : -18,
              duration: 4.8 + i * 0.6,
              ease: 'sine.inOut',
            },
            0,
          );
        });
      };

      window.addEventListener('westo:thermal-idle', stopOrbDrift);
      window.addEventListener('westo:thermal-wake', () => {
        if (document.documentElement.classList.contains('is-nav-menu-open')) startOrbDrift();
      });

      const showContentInstant = () => {
        gsap.set(contentEls, { autoAlpha: 1, y: 0, scale: 1, rotate: 0 });
        gsap.set(metas, { autoAlpha: 1, y: 0 });
        gsap.set(arrows, { autoAlpha: 1, scale: 1 });
        gsap.set(labels, { autoAlpha: 1, y: 0 });
        gsap.set(watermark, { autoAlpha: 1, scale: 1 });
        gsap.set(orbs, { opacity: 0, x: 0, y: 0 });
      };

      const resetContent = () => {
        const { x, y } = originFromTrigger();
        stopOrbDrift();
        setAnimatingClass(false, false);
        gsap.set(contentEls, { autoAlpha: 0, y: 24, scale: 1, rotate: 0 });
        gsap.set(metas, { autoAlpha: 0, y: 14 });
        gsap.set(arrows, { autoAlpha: 0, scale: 0.7 });
        gsap.set(watermark, { autoAlpha: 0, scale: 1.08 });
        gsap.set(orbs, { opacity: 0, x: 0, y: 0 });
        gsap.set(menu, { display: 'none', opacity: 1 });
        setMenuClip(0, x, y);
      };

      gsap.set(scrim, { autoAlpha: 0, display: 'none' });
      resetContent();

      const openLite = (x, y, maxR) => {
        /* One compositor-heavy property only: circular clip. Content is ready. */
        showContentInstant();
        gsap.set(menu, { display: 'flex', opacity: 1 });
        setMenuClip(0, x, y);
        gsap.set(scrim, { display: 'block' });

        const clip = { r: 0 };
        const tl = gsap.timeline({
          onComplete: () => {
            animating = false;
            activeTl = null;
            setAnimatingClass(false, true);
            setMenuClip(maxR, x, y);
          },
        });
        activeTl = tl;

        tl.to(scrim, { autoAlpha: 1, duration: 0.2, ease: 'power2.out' }, 0).to(
          clip,
          {
            r: maxR,
            duration: prefersReducedMotion() ? 0.01 : 0.48,
            ease: 'power3.out',
            onUpdate: () => setMenuClip(clip.r, x, y),
          },
          0,
        );
      };

      const openFull = (x, y, maxR, mobile) => {
        const reveals = ensureLinkReveals();
        gsap.set(menu, { display: 'flex', opacity: 1 });
        setMenuClip(0, x, y);
        gsap.set(scrim, { display: 'block' });

        const clip = { r: 0 };
        const tl = gsap.timeline({
          defaults: { ease: 'power3.out' },
          onComplete: () => {
            animating = false;
            activeTl = null;
            setAnimatingClass(false, false);
            setMenuClip(maxR, x, y);
            startOrbDrift();
          },
        });
        activeTl = tl;

        tl.to(scrim, { autoAlpha: 1, duration: 0.4, ease: 'power2.out' }, 0)
          .to(
            clip,
            {
              r: maxR,
              duration: mobile ? 0.8 : 0.75,
              ease: 'power4.inOut',
              onUpdate: () => setMenuClip(clip.r, x, y),
            },
            0.02,
          )
          .to(orbs, { opacity: 0.55, duration: 0.8, stagger: 0.1 }, 0.2)
          .fromTo(
            watermark,
            { autoAlpha: 0, scale: 1.12 },
            { autoAlpha: 1, scale: 1, duration: 1.1, ease: 'power2.out' },
            0.18,
          )
          .fromTo(topbar, { autoAlpha: 0, y: -16 }, { autoAlpha: 1, y: 0, duration: 0.55 }, 0.32);

        if (prefsBar) {
          tl.fromTo(
            prefsBar,
            { autoAlpha: 0, y: -10 },
            { autoAlpha: 1, y: 0, duration: 0.45 },
            0.4,
          );
        }

        reveals.forEach((reveal, i) => {
          reveal.in({ delay: 0.42 + i * (mobile ? 0.12 : 0.08) });
        });

        tl.fromTo(
          metas,
          { autoAlpha: 0, y: 16 },
          { autoAlpha: 1, y: 0, duration: 0.5, stagger: 0.1 },
          0.48,
        ).fromTo(
          arrows,
          { autoAlpha: 0, scale: 0.65 },
          { autoAlpha: 1, scale: 1, duration: 0.55, stagger: 0.1, ease: 'back.out(1.6)' },
          0.58,
        );

        if (middle) {
          tl.fromTo(
            middle,
            { autoAlpha: 0, y: 20, scale: 0.86, rotate: -8 },
            {
              autoAlpha: 1,
              y: 0,
              scale: 1,
              rotate: 0,
              duration: 0.75,
              ease: 'back.out(1.5)',
            },
            0.7,
          );
        }
        if (bottom) {
          tl.fromTo(bottom, { autoAlpha: 0, y: 40 }, { autoAlpha: 1, y: 0, duration: 0.7 }, 0.78);
        }
      };

      const open = (fromEl) => {
        if (animating || isOpen) return;
        animating = true;
        isOpen = true;
        if (activeTl) activeTl.kill();
        originEl = fromEl || button;
        menuFocusReturn = document.activeElement;

        syncTriggers(true);
        menu.removeAttribute('inert');
        menu.setAttribute('aria-hidden', 'false');
        scrim.hidden = false;
        scrim.setAttribute('aria-hidden', 'false');
        setScrollLock(true);

        const { x, y, maxR } = originFromTrigger();
        const lite = prefersMenuLite();
        setAnimatingClass(true, lite);

        if (lite) openLite(x, y, maxR);
        else openFull(x, y, maxR, isMobile());
        requestAnimationFrame(() => {
          (closeBtn || menuFocusables()[0])?.focus?.({ preventScroll: true });
        });
      };

      const closeLite = (x, y, maxR) => {
        const clip = { r: maxR };
        const tl = gsap.timeline({
          onComplete: () => {
            resetContent();
            gsap.set(scrim, { display: 'none', autoAlpha: 0 });
            scrim.hidden = true;
            setScrollLock(false);
            animating = false;
            activeTl = null;
            restoreMenuFocus();
          },
        });
        activeTl = tl;

        tl.to(
          clip,
          {
            r: 0,
            duration: prefersReducedMotion() ? 0.01 : 0.4,
            ease: 'power3.in',
            onUpdate: () => setMenuClip(clip.r, x, y),
          },
          0,
        ).to(scrim, { autoAlpha: 0, duration: 0.28, ease: 'power2.in' }, 0.08);
      };

      const closeFull = (x, y, maxR, mobile) => {
        const reveals = ensureLinkReveals();
        const circleDur = mobile ? 0.8 : 0.75;
        setMenuClip(maxR, x, y);
        const clip = { r: maxR };

        const tl = gsap.timeline({
          onComplete: () => {
            resetContent();
            gsap.set(scrim, { display: 'none', autoAlpha: 0 });
            scrim.hidden = true;
            setScrollLock(false);
            animating = false;
            activeTl = null;
            restoreMenuFocus();
          },
        });
        activeTl = tl;

        if (bottom) {
          tl.to(bottom, { autoAlpha: 0, y: 36, duration: 0.45, ease: 'power3.in' }, 0);
        }
        if (middle) {
          tl.to(
            middle,
            {
              autoAlpha: 0,
              y: 18,
              scale: 0.86,
              rotate: 8,
              duration: 0.5,
              ease: 'power3.in',
            },
            0.06,
          );
        }

        tl.to(
          arrows,
          { autoAlpha: 0, scale: 0.65, duration: 0.4, stagger: 0.08, ease: 'power2.in' },
          0.1,
        ).to(
          metas,
          { autoAlpha: 0, y: -14, duration: 0.4, stagger: 0.08, ease: 'power2.in' },
          0.14,
        );

        reveals.forEach((reveal, i) => {
          const last = links.length - 1;
          reveal.out({ delay: 0.16 + (last - i) * (mobile ? 0.1 : 0.07) });
        });

        if (prefsBar) {
          tl.to(prefsBar, { autoAlpha: 0, y: -10, duration: 0.35, ease: 'power2.in' }, 0.24);
        }

        tl.to(topbar, { autoAlpha: 0, y: -16, duration: 0.4, ease: 'power2.in' }, 0.28)
          .to(watermark, { autoAlpha: 0, scale: 1.1, duration: 0.5, ease: 'power2.in' }, 0.22)
          .to(orbs, { opacity: 0, duration: 0.45, stagger: 0.06, ease: 'power2.in' }, 0.24)
          .to(
            clip,
            {
              r: 0,
              duration: circleDur,
              ease: 'power4.inOut',
              onUpdate: () => setMenuClip(clip.r, x, y),
            },
            0.38,
          )
          .to(
            scrim,
            { autoAlpha: 0, duration: 0.4, ease: 'power2.in' },
            0.38 + circleDur * 0.35,
          );
      };

      const close = () => {
        if (!isOpen) return;
        // Escape/close is an interrupt, not another animation request. If the
        // reveal is still running, finish closed immediately so focus and
        // scroll ownership are never trapped behind an `animating` guard.
        if (animating) {
          isOpen = false;
          if (activeTl) activeTl.kill();
          activeTl = null;
          stopOrbDrift();
          gsap.killTweensOf([menu, scrim, ...contentEls, ...metas, ...arrows, ...labels, watermark, ...orbs]);
          syncTriggers(false);
          menu.setAttribute('inert', '');
          menu.setAttribute('aria-hidden', 'true');
          scrim.setAttribute('aria-hidden', 'true');
          resetContent();
          gsap.set(scrim, { display: 'none', autoAlpha: 0 });
          scrim.hidden = true;
          setScrollLock(false);
          animating = false;
          restoreMenuFocus();
          return;
        }
        animating = true;
        isOpen = false;
        if (activeTl) activeTl.kill();
        stopOrbDrift();

        syncTriggers(false);
        menu.setAttribute('inert', '');
        menu.setAttribute('aria-hidden', 'true');
        scrim.setAttribute('aria-hidden', 'true');

        const { x, y, maxR } = originFromTrigger();
        const lite = prefersMenuLite();
        setAnimatingClass(true, lite);
        setMenuClip(maxR, x, y);

        if (lite) closeLite(x, y, maxR);
        else closeFull(x, y, maxR, isMobile());
      };

      button.addEventListener('click', () => {
        isOpen ? close() : open();
      });
      button.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        isOpen ? close() : open();
      });
      closeBtn?.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        close();
      });

      links.forEach((link) => {
        link.addEventListener('click', (event) => {
          const href = link.getAttribute('href') || '';
          // In-page anchors: close and let hash / Lenis handlers run.
          if (!href || href === '#' || href.startsWith('#')) {
            close();
            return;
          }
          // Full-page routes (/login, /menu, /about, …): navigate explicitly.
          // The close clip-path animation was swallowing default navigation.
          event.preventDefault();
          event.stopPropagation();
          const url = link.href;
          close();
          window.setTimeout(() => {
            window.location.assign(url);
          }, 220);
        });
      });

      scrim.addEventListener('click', () => {
        if (isOpen) close();
      });

      document.addEventListener('keydown', (event) => {
        if (!isOpen) return;
        if (event.key === 'Tab') {
          const list = menuFocusables();
          if (!list.length) {
            event.preventDefault();
            closeBtn?.focus?.({ preventScroll: true });
            return;
          }
          const first = list[0];
          const last = list[list.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault(); last.focus({ preventScroll: true }); return;
          }
          if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault(); first.focus({ preventScroll: true }); return;
          }
        }
        if (event.key !== 'Escape') return;
        event.preventDefault();
        close();
      });

      bp.mobile.addEventListener('change', () => {
        if (!isOpen) {
          resetContent();
          return;
        }
        const { x, y, maxR } = originFromTrigger();
        gsap.set(menu, { display: 'flex', opacity: 1 });
        setMenuClip(maxR, x, y);
        gsap.set(contentEls, { autoAlpha: 1, y: 0, scale: 1, rotate: 0 });
        gsap.set([metas, arrows], { autoAlpha: 1, y: 0, scale: 1 });
        gsap.set(watermark, { autoAlpha: 1, scale: 1 });
        gsap.set(orbs, { opacity: prefersMenuLite() ? 0 : 0.55 });
      });

      window.westoNavMenu = {
        open: (fromEl) => open(fromEl || button),
        close,
        toggle: (fromEl) => (isOpen ? close() : open(fromEl || button)),
        isOpen: () => isOpen,
      };
    };

    // #region Carousel

    // Carousel Text

    const initCarouselText = () => {
      // Only hero category titles — other .carousel_slide lists (profile leftovers)
      // share indices and were getting faded with the wrong opacity.
      const slides = $$('.carousel_list.is-hero .carousel_slide');
      const descs = $$('.carousel_desc');
      const titles = $$('.carousel_title-b');
      if (!slides.length || !window.carousel) return null;

      const orderOf = () =>
        Array.isArray(window.__westoCategoryOrder) && window.__westoCategoryOrder.length
          ? window.__westoCategoryOrder
          : Array.isArray(window.__westoSlideCategoryOrder)
            ? window.__westoSlideCategoryOrder
            : [];

      const isActiveEl = (el, activeIndex) => {
        const order = orderOf();
        const catId = el.getAttribute?.('data-menu-cat-id');
        if (catId && order.length) return String(order[activeIndex]) === String(catId);
        const list = el.parentElement?.children ? [...el.parentElement.children] : [];
        return list.indexOf(el) === activeIndex;
      };

      const indexInList = (els, carouselIndex) => {
        const order = orderOf();
        const catId = order[carouselIndex];
        if (catId == null) return carouselIndex;
        const found = [...els].findIndex((el) => String(el.getAttribute('data-menu-cat-id')) === String(catId));
        return found >= 0 ? found : carouselIndex;
      };

      // Boot assert: slide ids must match can order or titles will drift.
      const slideIds = [...slides].map((s) => Number(s.getAttribute('data-menu-cat-id')));
      const canIds = orderOf().map(Number);
      if (canIds.length && slideIds.length && slideIds.join(',') !== canIds.join(',')) {
        console.error('[westo] hero title/can id mismatch', { slideIds, canIds });
      }

      const createMultiReveal = (container, selector, factory) => {
        const els = $$(selector, container);
        if (!els.length) return null;

        const instances = [...els].map((el) => factory(el));

        return {
          in: (opts) => instances.forEach((a) => a.in(opts)),
          out: (opts) => instances.forEach((a) => a.out(opts)),
        };
      };

      // SplitText expands the DOM substantially. The old path split every
      // category at boot even though only one category is visible. Preserve the
      // exact reveal factories, but instantiate them only for the active/visited
      // categories. The next category is prepared synchronously before its fade,
      // so the visible motion contract stays unchanged.
      const descReveals = new Array(descs.length);
      const titleReveals = new Array(titles.length);
      const slideReveals = new Array(slides.length);

      const ensureRevealAt = (i) => {
        if (i == null || i < 0) return;

        const desc = descs[i];
        if (desc && !descReveals[i]) {
          const lines = createMultiReveal(desc, '[data-anim="lines-mask"]', (el) => createLinesMask(el));
          const chars = createMultiReveal(desc, '[data-anim="chars-mask"]', (el) => createCharsMask(el));
          descReveals[i] = {
            in: (opts) => {
              lines?.in(opts);
              chars?.in(opts);
            },
            out: (opts) => {
              lines?.out(opts);
              chars?.out(opts);
            },
          };
        }

        const title = titles[i];
        if (title && !titleReveals[i]) {
          titleReveals[i] = createMultiReveal(title, '[data-anim="chars-mask"]', (el) => createCharsMask(el));
        }

        const slide = slides[i];
        if (slide && !slideReveals[i]) {
          slideReveals[i] = createMultiReveal(slide, '[data-anim="chars-mask"]', (el) => createCharsMask(el));
        }
      };

      // Hide inactive slides immediately so a previous category name cannot
      // linger (or crossfade) on top of the active can — that read as "mixed names".
      const fade = (els, activeIndex) => {
        els.forEach((el) => {
          if (isActiveEl(el, activeIndex)) {
            gsap.to(el, {
              autoAlpha: 1,
              duration: 0.4,
              ease: 'power2.out',
              overwrite: true,
            });
          } else {
            gsap.killTweensOf(el);
            gsap.set(el, { autoAlpha: 0 });
          }
        });
      };

      const setInitial = (els) => {
        const idx = window.carousel.index || 0;
        els.forEach((el) => gsap.set(el, { autoAlpha: isActiveEl(el, idx) ? 1 : 0 }));
      };
      setInitial(slides);
      setInitial(descs);
      setInitial(titles);

      window.carousel.changed.connect(({ index, previous }) => {
        const prevI = indexInList(slides, previous);
        const nextI = indexInList(slides, index);
        ensureRevealAt(prevI);
        ensureRevealAt(nextI);

        fade(slides, index);
        fade(descs, index);
        fade(titles, index);

        descReveals[prevI]?.out();
        descReveals[nextI]?.in({ delay: 0.3 });
        titleReveals[prevI]?.out();
        titleReveals[nextI]?.in({ delay: 0.3 });
        slideReveals[prevI]?.out();
        slideReveals[nextI]?.in({ delay: 0.3 });
      });

      const initialI = indexInList(slides, window.carousel.index);
      ensureRevealAt(initialI);
      slideReveals[initialI]?.in({ delay: 0.3 });

      return {
        inActive: (opts) => {
          const i = indexInList(slides, window.carousel.index);
          ensureRevealAt(i);
          descReveals[i]?.in(opts);
          titleReveals[i]?.in(opts);
        },
        outActive: (opts) => {
          const i = indexInList(slides, window.carousel.index);
          ensureRevealAt(i);
          descReveals[i]?.out(opts);
          titleReveals[i]?.out(opts);
        },
      };
    };

    // Carousel Nav

    const initCarouselNav = () => {
      const prev = $('.carousel_arrow.is-prev');
      const next = $('.carousel_arrow.is-next');
      if (!window.carousel) return;

      const go = (fn) => (e) => {
        e.preventDefault();
        e.stopPropagation();
        fn();
      };
      prev?.addEventListener('click', go(() => window.carousel.previous()));
      next?.addEventListener('click', go(() => window.carousel.next()));
    };

    const initCarouselPagination = () => {
      const container = $('.carousel_pagination');
      if (!container || !window.carousel) return;

      const svg = $('svg', container);
      const dot = $('.carousel_pagination-dot', container);
      const slides = $$('.carousel_list.is-hero .carousel_slide');
      const count = slides.length;
      if (!count) return;

      const viewBoxWidth = 1000;
      const padding = 20;
      const usable = viewBoxWidth - padding * 2;

      const indexToX = (i) => padding + (usable / Math.max(count - 1, 1)) * i;
      const xToIndex = (x) => Math.round(((x - padding) / usable) * (count - 1));

      gsap.set(dot, {
        attr: { cx: indexToX(window.carousel.index) },
        transformBox: 'fill-box',
        transformOrigin: '50% 50%',
        x: 0,
      });

      let dotTl = null;

      window.carousel.changed.connect(({ index, previous }) => {
        const delta = index - previous;
        const isWrap = Math.abs(delta) > count / 2;

        if (dotTl) dotTl.kill();
        gsap.killTweensOf(dot);

        if (isWrap) {
          const exitRight = previous > index;
          const slide = 150;
          const exitX = exitRight ? slide : -slide;
          const enterX = exitRight ? -slide : slide;

          dotTl = gsap.timeline();
          dotTl
            .to(dot, { x: exitX, scale: 0, duration: 0.3, ease: 'power2.in' })
            .set(dot, { attr: { cx: indexToX(index) }, x: enterX })
            .to(dot, { x: 0, scale: 1, duration: 0.45, ease: 'power3.out' });
        } else {
          dotTl = gsap.timeline();
          dotTl.to(dot, { attr: { cx: indexToX(index) }, scale: 1, x: 0, duration: 0.6, ease: 'power3.out' });
        }
      });

      const getXFromEvent = (e) => {
        const rect = svg.getBoundingClientRect();
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const ratio = (clientX - rect.left) / rect.width;
        return clamp(ratio * viewBoxWidth, padding, viewBoxWidth - padding);
      };

      let dragging = false;

      const updateFromPointer = (e) => {
        if (document.documentElement.classList.contains('is-dish-boards')) return;
        const x = getXFromEvent(e);
        const targetIndex = clamp(xToIndex(x), 0, count - 1);
        if (targetIndex !== window.carousel.index) {
          window.carousel.goTo(targetIndex);
        }
      };

      container.addEventListener('pointerdown', (e) => {
        if (document.documentElement.classList.contains('is-dish-boards')) return;
        dragging = true;
        container.setPointerCapture(e.pointerId);
        updateFromPointer(e);
      });

      container.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        updateFromPointer(e);
      });

      container.addEventListener('pointerup', () => {
        dragging = false;
      });

      container.addEventListener('pointercancel', () => {
        dragging = false;
      });
    };

    // Carousel Gradient Angulaire

    const initGammeGradient = () => {
      const gradient = $('.gamme_gradient');
      if (!gradient || !window.carousel) return;

      const slides = $$('.carousel_list.is-hero .carousel_slide');
      if (!slides.length) return;

      const step = 360 / slides.length;
      let current = 0;

      gsap.set(gradient, { rotation: 0 });

      window.carousel.changed.connect(({ index, previous }) => {
        let delta = index - previous;
        if (delta > slides.length / 2) delta -= slides.length;
        if (delta < -slides.length / 2) delta += slides.length;

        current -= delta * step;

        gsap.to(gradient, {
          rotation: current,
          duration: 0.8,
          ease: 'power2.inOut',
          overwrite: true,
        });
      });
    };

    // Carousel Color

    const initCarouselColors = () => {
      const slides = $$('.carousel_list.is-hero .carousel_slide');
      if (!slides.length || !window.carousel) return;

      const root = document.documentElement;

      const applyColors = (slide) => {
        if (!slide) return;
        const catId = slide.getAttribute('data-menu-cat-id');
        if (window.westoCategoryTheme?.apply && catId != null) {
          const theme = window.westoCategoryTheme.apply(catId);
          if (theme && window.environment?.setColor) {
            window.environment.setColor(theme.tastePrimary, theme.tasteSecondary);
          }
          return;
        }
        const primary = slide.dataset.tastePrimary;
        const secondary = slide.dataset.tasteSecondary;
        if (primary) root.style.setProperty('--color-scheme-1--taste-primary', primary);
        if (secondary) root.style.setProperty('--color-scheme-1--taste-secondary', secondary);
        if (primary && window.environment?.setColor) {
          window.environment.setColor(primary, secondary);
        }
      };

      applyColors(slides[window.carousel.index]);

      const apply = debounce((index) => applyColors(slides[index]), 150);
      window.carousel.changed.connect(({ index }) => apply(index));
    };

    // Carousel Video

    const initCarouselVideo = () => {
      const section = $('.section.is-argument');
      if (!section || !window.carousel) return;

      const items = [...$$('.argument_video', section)].map((wrapper) => ({ wrapper, video: $('video', wrapper) })).filter((it) => it.video);
      if (!items.length) return;

      let inView = false;

      const activate = (video) => {
        video.setAttribute('autoplay', '');
        if (video.readyState === 0) video.load();

        const tryPlay = () => video.play().catch(() => {});
        if (video.readyState >= 2) tryPlay();
        else video.addEventListener('canplay', tryPlay, { once: true });
      };

      const deactivate = (video) => {
        video.removeAttribute('autoplay');
        video.pause();
      };

      const goTo = (i) => {
        items.forEach(({ wrapper, video }, idx) => {
          if (idx === i) {
            if (inView) activate(video);
            gsap.to(wrapper, { autoAlpha: 1, duration: 0.6, ease: 'power2.inOut', overwrite: true });
          } else {
            gsap.to(wrapper, {
              autoAlpha: 0,
              duration: 0.6,
              ease: 'power2.inOut',
              overwrite: true,
              onComplete: () => deactivate(video),
            });
          }
        });
      };

      items.forEach(({ wrapper }) => gsap.set(wrapper, { autoAlpha: 0 }));

      const apply = debounce((index) => {
        if (inView) goTo(index);
      }, 150);
      window.carousel.changed.connect(({ index }) => apply(index));

      ScrollTrigger.create({
        trigger: section,
        start: 'top bottom',
        end: 'bottom top',
        onToggle: ({ isActive }) => {
          inView = isActive;
          if (isActive && document.visibilityState !== 'hidden') goTo(window.carousel.index);
          else items.forEach(({ video }) => deactivate(video));
        },
      });

      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
          items.forEach(({ video }) => deactivate(video));
        } else if (inView) {
          goTo(window.carousel.index);
        }
      });
    };

    // #region Sections

    // Section Gamme

    const initSectionGamme = () => {
      const section = $('.section.is-gamme');
      if (!section) return;

      const tl = gsap.timeline({
        defaults: { duration: 0.5, ease: 'power2.inOut' },
        scrollTrigger: {
          trigger: section,
          // Mobile hero is ~100svh; `bottom bottom` fires on load and hides hints.
          start: isMobile() ? 'bottom top' : 'bottom bottom',
          toggleActions: 'play none none reverse',
        },
      });

      tl.to('.carousel_pagination, .icon-scroll_wrapper, .westo-scroll-hint--mobile, .westo-scroll-hint--mobile-right, .carousel_arrow.is-prev, .scroll_discover, .gamme_gradient-wrapper', { autoAlpha: 0 });

      if (isDesktop()) {
        tl.to('.carousel_title-collection', { autoAlpha: 0 }, '<');
        tl.to('.carousel_nav', { maxWidth: '55%' }, '<');
      }

      if (isMobile()) {
        tl.to('.carousel_arrow.is-next', { autoAlpha: 0 }, '<');
        tl.to('.carousel_title-collection', { y: '-2.5rem' }, '<');
      }

      // Hero is full-viewport on mobile — undo any immediate hide from ST init.
      requestAnimationFrame(() => syncHeroScrollHints(true));
    };

    let heroHintsApplied = false;
    const syncHeroScrollHints = (force) => {
      const gamme = $('.section.is-gamme');
      if (!gamme || document.documentElement.classList.contains('is-dish-boards')) return;
      const scrollPos = window.lenis?.scroll ?? window.scrollY ?? 0;
      const nearTop = scrollPos < Math.max(window.innerHeight * 0.08, 32);
      if (!force) {
        // Apply once per entry into the top zone — running two gsap.set on
        // every scroll frame at the hero caused constant style writes.
        if (!nearTop) {
          heroHintsApplied = false;
          return;
        }
        if (heroHintsApplied) return;
      }
      heroHintsApplied = nearTop;
      gsap.set('.hud_left, .hud_right', { x: 0, clearProps: 'transform' });
      gsap.set('.icon-scroll_wrapper, .westo-scroll-hint--mobile, .westo-scroll-hint--mobile-right, .scroll_discover, .carousel_pagination', { autoAlpha: 1 });
    };

    const reparentMobileScrollHint = () => {
      if (!isMobile()) return;
      // The original HUD already contains a left and a right animated scroll
      // glyph. Remove legacy mobile clones and let CSS place those two source
      // glyphs at the viewport edges, so the hint remains symmetric at every
      // phone/tablet size without a duplicate centered affordance.
      document.querySelectorAll('.westo-scroll-hint--mobile').forEach((node) => node.remove());
    };

    // Section Profile

    const initSectionProfile = () => {
      const section = $('.section.is-profile');
      if (!section) return;
      // Menu story skips profile — don't bind ST that hide gamme forever
      if (
        section.dataset.westoSkipped ||
        section.hasAttribute('hidden') ||
        getComputedStyle(section).display === 'none'
      ) return;

      const container = $('.profile_container', section);
      if (!container) return;

      const gammeContainer = $('.gamme_container');
      const reveal = initAnimations(section, '.carousel_desc, .carousel_title-b');

      gsap
        .timeline({
          defaults: { duration: 0.5, ease: 'power2.inOut' },
          scrollTrigger: {
            trigger: section,
            start: 'top bottom',
            end: 'bottom bottom',
            toggleActions: 'play reverse play reverse',
            onEnter: () => {
              document.body.classList.add('is-profile-active');
              reveal?.in({ delay: 0 });
              window.carouselText?.inActive({ delay: 0 });
            },
            onEnterBack: () => {
              reveal?.in({ delay: 0 });
              window.carouselText?.inActive({ delay: 0 });
              gsap.to(gammeContainer, { autoAlpha: 1, duration: 0.5, ease: 'power2.inOut' });
            },
            onLeave: () => {
              reveal?.out();
              window.carouselText?.outActive();
              gsap.to(gammeContainer, { autoAlpha: 0, duration: 0.5, ease: 'power2.inOut' });
            },
            onLeaveBack: () => {
              document.body.classList.remove('is-profile-active');
              reveal?.out();
              window.carouselText?.outActive();
            },
          },
        })
        .fromTo(container, { autoAlpha: 0 }, { autoAlpha: 1 })
        .fromTo('.carousel_title-bis-wrapper', { autoAlpha: 0 }, { autoAlpha: 1 }, '<');
    };

    // Restore hero category chrome after leaving dish boards (profile skip path)
    window.westoRestoreHeroChrome = ({ force } = {}) => {
      const onHero =
        force ||
        (!document.documentElement.classList.contains('is-dish-boards') &&
          (window.lenis?.scroll || 0) < (document.querySelector('section.is-benefits')?.offsetTop || 9999) * 0.55);
      if (!onHero && !force) return;
      gsap.killTweensOf(
        '.gamme_container, .carousel_title-collection, .navbar, .gamme_gradient-wrapper, .carousel_pagination, .scroll_component, .scroll_discover, .icon-scroll_wrapper, .westo-scroll-hint--mobile, .westo-scroll-hint--mobile-right, .carousel_arrow',
      );
      gsap.set(
        [
          '.gamme_container',
          '.carousel_title-collection',
          '.navbar',
          '.gamme_gradient-wrapper',
          '.carousel_pagination',
          '.scroll_component',
          '.scroll_discover',
          '.icon-scroll_wrapper',
          '.westo-scroll-hint--mobile',
          '.westo-scroll-hint--mobile-right',
          '.carousel_arrow',
          'main canvas',
        ].join(','),
        { autoAlpha: 1, y: 0, yPercent: 0 },
      );
      // Re-show active hero slide by category id (matches cans), not raw DOM index
      const slides = gsap.utils.toArray('.carousel_list.is-hero .carousel_slide');
      const idx =
        typeof window.carousel?.getIndex === 'function'
          ? window.carousel.getIndex(true)
          : window.carousel?.index ?? 0;
      const order =
        Array.isArray(window.__westoCategoryOrder) && window.__westoCategoryOrder.length
          ? window.__westoCategoryOrder
          : Array.isArray(window.__westoSlideCategoryOrder)
            ? window.__westoSlideCategoryOrder
            : [];
      const activeId = order[idx];
      slides.forEach((el, i) => {
        const catId = el.getAttribute('data-menu-cat-id');
        const on = activeId != null && catId ? String(catId) === String(activeId) : i === idx;
        gsap.set(el, { autoAlpha: on ? 1 : 0 });
        if (on) {
          $$(
            '[data-anim="chars-mask"] .line, [data-anim="chars-mask"] .word, [data-anim="chars-mask"] .char, [data-anim="chars-mask"]',
            el,
          ).forEach((leaf) => gsap.set(leaf, { yPercent: 0, clearProps: 'transform' }));
        }
      });
      window.carouselText?.inActive?.({ delay: 0 });
      document.body.classList.remove('is-profile-active');
      if (window.ScrollTrigger) window.ScrollTrigger.update();
    };

    // Section Benefits

    const initSectionBenefits = () => {
      const sections = $$('.section.is-benefits');
      if (!sections.length) return;
      sections.forEach((section) => {
        if (section.dataset.westoBenefitsBound) return;
        const container = $('.benefits_container', section);
        if (!container) return;
        section.dataset.westoBenefitsBound = '1';

        // Dish boards: SplitText + scroll reveal fights live menu copy + CSS grid
        // and makes the price/name card jump. Keep text stable.
        $$('[data-anim]', section).forEach((el) => el.removeAttribute('data-anim'));
        gsap.set(container, { autoAlpha: 1, clearProps: 'opacity,visibility' });
        gsap.set(section, { '--line': 1, '--benefits-line': 1 });
        $$('.benefits_text, [data-menu-name], [data-menu-desc], [data-menu-price]', section).forEach(
          (el) => gsap.set(el, { autoAlpha: 1, yPercent: 0, clearProps: 'transform' }),
        );
      });
    };

    // Called after table-cart clones dish boards past the initial HTML set
    window.westoRefreshBenefits = () => {
      const before = document.querySelectorAll('section.is-benefits[data-westo-benefits-bound]').length;
      initSectionBenefits();
      const after = document.querySelectorAll('section.is-benefits[data-westo-benefits-bound]').length;
      if (after > before && window.ScrollTrigger) window.ScrollTrigger.refresh();
    };

    const initBenefitsNav = () => {
      const nav = $('.benefits_nav');
      const sections = $$('.section.is-benefits');
      if (!nav || !sections.length) return;
      const profileSection = $('.section.is-profile');
      const startTrigger = profileSection && getComputedStyle(profileSection).display !== 'none' && !profileSection.hasAttribute('hidden')
        ? profileSection
        : sections[0];

      const icons = $$('.benefits_icon-wrapper', nav);

      const tl = gsap.timeline({
        defaults: { duration: 0.5, ease: 'power2.inOut' },
        scrollTrigger: {
          trigger: startTrigger,
          start: 'top bottom',
          endTrigger: sections[sections.length - 1],
          end: 'bottom bottom',
          toggleActions: 'play reverse play reverse',
        },
      });

      tl.fromTo(nav, { autoAlpha: 0 }, { autoAlpha: 1 });

      sections.forEach((section, i) => {
        ScrollTrigger.create({
          trigger: section,
          start: 'top bottom',
          end: 'bottom bottom',
          onToggle: ({ isActive }) => {
            // Menu rail owns single-active highlight via three-scene / table-cart
            if (document.querySelector('.benefits_nav.is-menu-rail')) return;
            icons[i]?.classList.toggle('is-active', isActive);
          },
        });
      });
    };

    // Section Argument

    const initSectionArgument = () => {
      const section = $('.section.is-argument');
      if (
        !section ||
        section.hasAttribute('hidden') ||
        section.dataset.westoTailSkipped ||
        getComputedStyle(section).display === 'none'
      ) return;

      const svgShapes = $$('.argument_svg svg path, .argument_svg svg polygon', section);
      const svgBlur = $('.argument_svg-blur', section);

      gsap.set(svgShapes, { autoAlpha: 0, scale: 0.6, transformOrigin: '50% 50%' });
      if (svgBlur) gsap.set(svgBlur, { autoAlpha: 0 });

      const animateSvgIn = () => {
        gsap.to(svgShapes, {
          autoAlpha: 1,
          scale: 1,
          duration: 0.5,
          ease: 'back.out(2)',
          stagger: 0.04,
          delay: 0.4,
          overwrite: true,
        });
        if (svgBlur) {
          gsap.to(svgBlur, {
            autoAlpha: 1,
            duration: 0.4,
            ease: 'power2.out',
            delay: 1,
            overwrite: true,
          });
        }
      };

      const animateSvgOut = () => {
        gsap.to(svgShapes, {
          autoAlpha: 0,
          scale: 0.6,
          duration: 0.4,
          ease: 'power2.in',
          overwrite: true,
        });
        if (svgBlur) {
          gsap.to(svgBlur, {
            autoAlpha: 0,
            duration: 0.4,
            ease: 'power2.in',
            overwrite: true,
          });
        }
      };

      gsap
        .timeline({
          defaults: { duration: 0.5, ease: 'power2.inOut' },
          scrollTrigger: {
            trigger: section,
            start: 'top bottom',
            end: 'bottom bottom',
            toggleActions: 'play reverse play reverse',
            onEnter: animateSvgIn,
            onEnterBack: animateSvgIn,
            onLeave: animateSvgOut,
            onLeaveBack: animateSvgOut,
          },
        })
        .fromTo('.argument_container', { autoAlpha: 0 }, { autoAlpha: 1 })
        .fromTo('.gradient_overlay', { autoAlpha: 1 }, { autoAlpha: 0 }, '<');
    };

    // Section Full Gamme

    const initSectionFullGamme = () => {
      const section = $('.section.is-full-gamme');
      if (
        !section ||
        section.hasAttribute('hidden') ||
        section.dataset.westoTailSkipped ||
        getComputedStyle(section).display === 'none'
      ) return;

      gsap.timeline({
        defaults: { duration: 0.5, ease: 'power2.inOut' },
        scrollTrigger: {
          trigger: section,
          start: 'top bottom',
          end: 'bottom bottom',
          toggleActions: 'play reverse play reverse',
          onEnter: () => document.body.classList.remove('is-profile-active'),
          onLeaveBack: () => document.body.classList.add('is-profile-active'),
        },
      });
    };

    // Section FAQ (mobile : fade out du HUD)

    const initSectionFaq = () => {
      if (!isMobile()) return;

      const section = $('.section.is-faq');
      if (
        !section ||
        section.hasAttribute('hidden') ||
        section.dataset.westoTailSkipped ||
        getComputedStyle(section).display === 'none'
      ) return;

      gsap.fromTo(
        '.hud_container',
        { autoAlpha: 1 },
        {
          autoAlpha: 0,
          duration: 0.5,
          ease: 'power2.inOut',
          scrollTrigger: {
            trigger: section,
            start: 'top bottom',
            end: 'bottom top',
            toggleActions: 'play reverse play reverse',
          },
        },
      );
    };

    const initLenisHashLinks = () => {
      document.addEventListener('click', (e) => {
        const a = e.target.closest('a[href^="#"]');
        if (!a || a.hasAttribute('data-menu-open')) return;
        const href = a.getAttribute('href') || '';
        if (href.length < 2 || href === '#') return;
        const id = href.slice(1);
        const el = document.getElementById(id) || document.querySelector(href);
        if (!el) return;
        e.preventDefault();
        // Close mobile nav if open
        const menuBtn = $('.navbar_menu-button.is-open');
        if (menuBtn) menuBtn.click();
        if (window.lenis) {
          window.lenis.scrollTo(el, { offset: 0, duration: 1.15 });
        } else {
          el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
        if (history.replaceState) {
          history.replaceState(null, '', href);
        }
      });
    };

    // #region Init

    const initWhenCarousel = (fn) => {
      if (window.carousel) {
        fn();
      } else {
        window.addEventListener('carousel:ready', fn, { once: true });
      }
    };

    const setupCarouselText = () => {
      window.carouselText = initCarouselText();
    };

    initLoader();
    initSoundToggle();
    initMenuButton();
    initMenuToggle();
    initLenisHashLinks();
    reparentMobileScrollHint();
    initScrollIcon();
    initCarouselArrowsHover();
    initWhenCarousel(setupCarouselText);
    initWhenCarousel(initCarouselNav);
    initWhenCarousel(initCarouselPagination);
    initWhenCarousel(initCarouselColors);
    initWhenCarousel(initGammeGradient);
    initWhenCarousel(initCarouselVideo);
    initSectionGamme();
    initWhenCarousel(() => {
      reparentMobileScrollHint();
      syncHeroScrollHints(true);
    });
    window.lenis?.on('scroll', () => syncHeroScrollHints(false));
    initSectionProfile();
    initSectionBenefits();
    initBenefitsNav();
    initSectionArgument();
    initSectionFullGamme();
    initSectionFaq();
    };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', westOAnimationsBoot, { once: true });
  } else {
    westOAnimationsBoot();
  }

;/* ===== END js/animations.js ===== */

/* ===== BEGIN js/sounds.js ===== */
const westOSoundsBoot = () => {
  // WESTO sound runtime.
  // Keep the original public API and sound cues, but keep Web Audio and the
  // audio files completely out of the critical boot path. Nothing is fetched
  // or decoded until the guest has actually interacted with the page.
  const SOUNDS = Object.freeze({
    change: 'assets/audio/westo-ui-scroll.mp3',
    enter: 'assets/audio/westo-ui-enter.mp3',
    benefits: 'assets/audio/westo-ui-transition.mp3',
    click: 'assets/audio/westo-ui-click.mp3',
  });

  const VOLUME = 0.5;
  const MAX_DEFERRED_PLAY_AGE_MS = 900;

  let ctx = null;
  let unlocked = false;
  let destroyed = false;

  const buffers = Object.create(null);
  const bufferPromises = Object.create(null);
  const playGenerations = Object.create(null);

  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;

  const isMuted = () => {
    const btn = document.querySelector('#nav-sound-btn');
    return btn ? btn.classList.contains('is-muted') : false;
  };

  const initCtx = () => {
    if (destroyed || ctx || !AudioContextCtor) return ctx;
    try {
      ctx = new AudioContextCtor();
    } catch (error) {
      console.warn('[westoSound] AudioContext unavailable', error);
      ctx = null;
    }
    return ctx;
  };

  const removeUnlockListeners = () => {
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('touchstart', unlock);
    window.removeEventListener('keydown', unlock);
    window.removeEventListener('wheel', unlock);
  };

  const ensureSound = (name) => {
    if (destroyed || !SOUNDS[name]) return Promise.resolve(null);
    if (buffers[name]) return Promise.resolve(buffers[name]);
    if (bufferPromises[name]) return bufferPromises[name];

    const audioCtx = initCtx();
    if (!audioCtx) return Promise.resolve(null);

    const scheduler = window.WestoResources;
    const bytesPromise = scheduler?.requestAudio
      ? scheduler.requestAudio(
          SOUNDS[name],
          scheduler.priorities?.BACKGROUND || 24,
        ).then((result) => result?.blob?.arrayBuffer?.() || null)
      : fetch(SOUNDS[name], {
          credentials: 'same-origin',
          cache: 'force-cache',
        }).then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.arrayBuffer();
        });

    const task = bytesPromise
      .then((arrayBuffer) => {
        if (!arrayBuffer) throw new Error('audio bytes unavailable');
        return audioCtx.decodeAudioData(arrayBuffer);
      })
      .then((buffer) => {
        if (!destroyed) buffers[name] = buffer;
        return buffer;
      })
      .catch((error) => {
        console.warn('[westoSound] load failed', name, error);
        return null;
      })
      .finally(() => {
        delete bufferPromises[name];
      });

    bufferPromises[name] = task;
    return task;
  };

  // Small, frequently-used cues are prepared after the first real gesture.
  // The two larger transition files remain strictly on-demand.
  const primeFrequentSounds = () => {
    ensureSound('click');
    ensureSound('change');
  };

  async function unlock() {
    if (destroyed || unlocked) return;
    const audioCtx = initCtx();
    if (!audioCtx) {
      removeUnlockListeners();
      return;
    }

    try {
      if (audioCtx.state === 'suspended') await audioCtx.resume();
    } catch (_) {
      // Some browsers reject resume for wheel/touch sequences that are not
      // considered an activation. Keep the listeners so a later click/keydown
      // can unlock the same context.
    }

    if (audioCtx.state !== 'running') return;

    unlocked = true;
    removeUnlockListeners();
    primeFrequentSounds();
  }

  window.addEventListener('pointerdown', unlock, { passive: true });
  window.addEventListener('touchstart', unlock, { passive: true });
  window.addEventListener('keydown', unlock);
  window.addEventListener('wheel', unlock, { passive: true });

  const startBuffer = async (name, volume, rate, requestedAt, generation) => {
    const buffer = buffers[name] || (await ensureSound(name));
    if (
      destroyed ||
      !buffer ||
      !unlocked ||
      isMuted() ||
      document.hidden ||
      playGenerations[name] !== generation ||
      performance.now() - requestedAt > MAX_DEFERRED_PLAY_AGE_MS
    ) {
      return false;
    }

    const audioCtx = ctx;
    if (!audioCtx) return false;

    try {
      if (audioCtx.state === 'suspended') await audioCtx.resume();
    } catch (_) {
      return false;
    }
    if (audioCtx.state !== 'running') return false;

    try {
      const source = audioCtx.createBufferSource();
      const gain = audioCtx.createGain();
      source.buffer = buffer;
      source.playbackRate.value = rate;
      gain.gain.value = VOLUME * volume;
      source.connect(gain).connect(audioCtx.destination);
      source.onended = () => {
        try {
          source.disconnect();
          gain.disconnect();
        } catch (_) {}
      };
      source.start(0);
      return true;
    } catch (error) {
      console.warn('[westoSound] play failed', name, error);
      return false;
    }
  };

  const play = (name, { volume = 1, rate = 1 } = {}) => {
    if (destroyed || !SOUNDS[name] || !unlocked || isMuted() || document.hidden) return false;

    const generation = (playGenerations[name] || 0) + 1;
    playGenerations[name] = generation;
    const requestedAt = performance.now();

    if (buffers[name]) {
      void startBuffer(name, volume, rate, requestedAt, generation);
      return true;
    }

    // Keep only the latest pending cue of a given type while its file is being
    // fetched/decoded. Rapid carousel changes therefore do not burst several
    // delayed sounds once the first decode completes.
    void startBuffer(name, volume, rate, requestedAt, generation);
    return true;
  };

  // Programmatic navigation suppresses scroll-transition cues temporarily.
  const nav = { lock: false, timer: null };
  const lockNav = (ms = 1200) => {
    nav.lock = true;
    if (nav.timer) clearTimeout(nav.timer);
    nav.timer = setTimeout(() => {
      nav.timer = null;
      nav.lock = false;
    }, ms);
  };

  window.westoSound = { play, lockNav };

  // === Carousel change cue ===
  let carouselBound = false;
  const bindCarousel = () => {
    if (carouselBound || !window.carousel || !window.carousel.changed) return false;
    carouselBound = true;
    window.carousel.changed.connect(() => play('change'));
    return true;
  };
  if (!bindCarousel()) {
    window.addEventListener('carousel:ready', bindCarousel, { once: true });
  }

  // === Scroll transition cues ===
  // One Lenis listener owns both the hero-enter and benefits cues. The old
  // implementation registered two independent handlers and rebuilt geometry
  // through monkey-patched globals. Geometry is now cached and refreshed only
  // on actual layout/language changes.
  let lenisBound = false;
  let boundary = 0;
  let sections = [];
  let layoutRaf = 0;
  let inHome = true;
  let lastScroll = 0;
  let lastIdx = 0;
  let lastDishSlot = -1;

  const visibleSection = (el) => {
    if (!el || el.hasAttribute('hidden')) return false;
    if (el.closest('.loader, #westo-entrance, .entrance-gate')) return false;
    return getComputedStyle(el).display !== 'none';
  };

  const activeDishSlot = () => {
    const active = document.querySelector('section.is-benefits.is-dish-active:not([hidden])');
    if (!active || active.style.display === 'none') return -1;
    return Number(active.dataset.menuSlot) || 0;
  };

  const currentIndex = (pos) => {
    if (!sections.length) return 0;
    let best = 0;
    let dist = Infinity;
    for (let i = 0; i < sections.length; i += 1) {
      const d = Math.abs(sections[i].top - pos);
      if (d < dist) {
        dist = d;
        best = i;
      }
    }
    return best;
  };

  const rebuildLayout = () => {
    layoutRaf = 0;
    if (destroyed) return;

    const first =
      document.querySelector('section.section.is-gamme') || document.querySelector('section.section');
    boundary = first ? first.clientHeight : 0;

    let top = 0;
    const nextSections = [];
    document.querySelectorAll('section.section').forEach((el) => {
      if (!visibleSection(el)) return;
      nextSections.push({
        top,
        isBenefits: el.classList.contains('is-benefits'),
      });
      top += el.clientHeight;
    });
    sections = nextSections;

    const pos = window.lenis?.animatedScroll || window.scrollY || 0;
    if (!lenisBound) {
      lastIdx = currentIndex(pos);
      lastDishSlot = activeDishSlot();
    }
  };

  const scheduleLayout = () => {
    if (destroyed || layoutRaf) return;
    layoutRaf = requestAnimationFrame(rebuildLayout);
  };

  const wrap = (value, min, max) => {
    const size = max - min;
    if (size <= 0) return min;
    let out = value % size;
    if (out < 0) out += size;
    return out + min;
  };

  const bindLenis = () => {
    if (lenisBound || !window.lenis) return false;
    lenisBound = true;

    rebuildLayout();
    lastScroll = window.lenis.animatedScroll || 0;
    lastIdx = currentIndex(lastScroll);
    lastDishSlot = activeDishSlot();

    window.lenis.on('scroll', () => {
      if (destroyed) return;

      const cur = window.lenis.animatedScroll || 0;
      const goingDown = cur > lastScroll;
      const threshold = Math.max(boundary * 0.03, 24);

      if (inHome && cur >= threshold) {
        inHome = false;
        if (goingDown && !nav.lock) play('enter');
      } else if (!inHome && cur < threshold) {
        inHome = true;
      }
      lastScroll = cur;

      if (document.documentElement.classList.contains('is-dish-boards')) {
        const slot = activeDishSlot();
        if (slot >= 0 && lastDishSlot >= 0 && slot !== lastDishSlot) {
          if (Math.abs(slot - lastDishSlot) === 1 && !nav.lock) play('benefits');
          lastDishSlot = slot;
        } else if (slot >= 0) {
          lastDishSlot = slot;
        }
        return;
      }

      lastDishSlot = -1;
      const dimensions = window.lenis.dimensions;
      const max = dimensions ? dimensions.scrollHeight - dimensions.height : 0;
      if (max <= 0 || !sections.length) return;

      const pos = wrap(cur, 0, max);
      const idx = currentIndex(pos);
      if (idx === lastIdx) return;

      const adjacent = Math.abs(idx - lastIdx) === 1;
      if (adjacent && sections[idx]?.isBenefits && !nav.lock) play('benefits');
      lastIdx = idx;
    });

    return true;
  };

  if (!bindLenis()) {
    window.addEventListener('carousel:ready', () => {
      bindLenis();
      scheduleLayout();
    }, { once: true });
  }

  window.addEventListener('resize', scheduleLayout, { passive: true });
  document.addEventListener('westo:relayout', scheduleLayout);
  document.addEventListener('westo:langchange', scheduleLayout);
  window.addEventListener('load', scheduleLayout, { once: true });
  if (document.fonts?.ready) {
    document.fonts.ready.then(scheduleLayout).catch(() => {});
  }

  // === Menu / FAQ click cue ===
  // Delegation keeps one listener instead of binding every current link and it
  // also covers FAQ/menu nodes that may be cloned later by content/menu code.
  document.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    if (target.closest('.navbar_menu-button')) {
      play('click');
    }

    if (target.closest('.navbar_link')) {
      play('click');
      lockNav();
    }

    if (target.closest('.faq_question')) {
      play('click');
    }
  });

  const syncVisibility = () => {
    if (!ctx) return;
    if (document.hidden) {
      try {
        void ctx.suspend();
      } catch (_) {}
      return;
    }
    if (unlocked && ctx.state === 'suspended') {
      try {
        void ctx.resume();
      } catch (_) {}
    }
  };

  document.addEventListener('visibilitychange', syncVisibility);

  window.addEventListener('pagehide', () => {
    if (nav.timer) {
      clearTimeout(nav.timer);
      nav.timer = null;
      nav.lock = false;
    }
    if (layoutRaf) {
      cancelAnimationFrame(layoutRaf);
      layoutRaf = 0;
    }
    if (ctx?.state === 'running') {
      try {
        void ctx.suspend();
      } catch (_) {}
    }
  });

  window.addEventListener('pageshow', () => {
    scheduleLayout();
    syncVisibility();
  });
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', westOSoundsBoot, { once: true });
} else {
  westOSoundsBoot();
}


;/* ===== END js/sounds.js ===== */

/* ===== BEGIN js/westo-production-v12.js ===== */
/* WESTO Production UI v12 — presentation bridge only.
   Existing menu/cart/WebGL/scroll state machines remain authoritative. */
(function () {
  'use strict';
  if (window.__WESTO_PRODUCTION_V12__) return;
  window.__WESTO_PRODUCTION_V12__ = true;

  const root = document.documentElement;
  root.classList.add('westo-production-v12');
  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => Array.from(c.querySelectorAll(s));
  const EN = {
    7560:'SALADS',7561:'APPETIZERS',17007:'TACOS',7562:'PASTA',7563:'BURGERS',7564:'MAINS',
    7566:'PIZZA',7567:'VEGETARIAN',7599:'COLD BAR',14477:'MATCHA BAR',7675:'CAFFEINE',
    7701:'NON CAFFEINE',7676:'HERBAL TEA',7697:'PASTRY',9478:'SPECIAL SERVICE',13581:'SUSHI'
  };
  const AR = {
    7560:'سلطة',7561:'مقبلات',17007:'تاكو',7562:'باستا',7563:'برغر',7564:'أطباق رئيسية',
    7566:'بيتزا',7567:'نباتي',7599:'بار بارد',14477:'ماتشا',7675:'كافيين',7701:'بدون كافيين',
    7676:'شاي أعشاب',7697:'معجنات',9478:'خدمة خاصة',13581:'سوشي'
  };
  const DESC_EN = {
    7560:'Fresh, bright and balanced.',7561:'Small plates made for sharing.',17007:'Bold fillings, soft tortillas and fresh finishes.',7562:'Comforting pasta with WESTO character.',7563:'Juicy burgers built with generous layers.',7564:'Signature mains for a complete meal.',7566:'Crisp-edged pizza with balanced toppings.',7567:'Plant-forward dishes with full flavor.',7599:'Cold, refreshing drinks and house blends.',14477:'Matcha prepared smooth, clean and vivid.',7675:'Coffee and caffeine-led favorites.',7701:'Calm, caffeine-free drinks for any hour.',7676:'Aromatic herbal infusions served with care.',7697:'Pastries and sweet bites for the table.',9478:'Limited WESTO specials and seasonal service.',13581:'Fresh sushi with clean, precise flavors.'
  };
  const DESC_AR = {
    7560:'طازجة ومشرقة ومتوازنة.',7561:'أطباق صغيرة مثالية للمشاركة.',17007:'حشوات غنية وتورتيلا طرية ولمسات منعشة.',7562:'باستا مريحة بروح WESTO.',7563:'برغر غني بطبقات سخية.',7564:'أطباق رئيسية مميزة لوجبة متكاملة.',7566:'بيتزا بحواف مقرمشة وإضافات متوازنة.',7567:'أطباق نباتية بنكهة كاملة.',7599:'مشروبات باردة ومنعشة وخلطات خاصة.',14477:'ماتشا ناعمة ونقية وحيوية.',7675:'قهوة ومشروبات مفضلة بالكافيين.',7701:'مشروبات هادئة بلا كافيين لأي وقت.',7676:'منقوعات عشبية عطرية محضّرة بعناية.',7697:'معجنات ولقيمات حلوة للمشاركة.',9478:'اختيارات WESTO المحدودة والموسمية.',13581:'سوشي طازج بنكهات نظيفة ودقيقة.'
  };

  let heroCopy = null;
  let heroTitle = null;
  let heroKicker = null;
  let heroDesc = null;
  let heroScrollCopy = null;
  let heroRail = null;
  let heroCats = null;
  let carouselBound = false;
  let pending = 0;
  let lastId = null;

  function store() { return window.westoMenuStore || null; }
  function categories() {
    const s = store();
    if (Array.isArray(s?.categories) && s.categories.length) return s.categories.filter(Boolean);
    const boot = window.__WESTO_CONTENT__?.menu;
    const fallback = Array.isArray(boot?.siteCategories) && boot.siteCategories.length
      ? boot.siteCategories
      : Array.isArray(boot?.menuCategories) ? boot.menuCategories.filter(c => !c?.hiddenOnSite) : [];
    return fallback.filter(Boolean);
  }
  function order() {
    const ids = window.__westoCategoryOrder;
    return Array.isArray(ids) && ids.length ? ids.map(Number) : categories().map(c => Number(c.id));
  }
  function currentId() {
    const attr = Number(root.dataset.catId);
    if (Number.isFinite(attr)) return attr;
    const ids = order();
    if (!ids.length) return null;
    try {
      const i = Number(window.carousel?.getIndex?.(true));
      if (Number.isFinite(i)) return ids[(i % ids.length + ids.length) % ids.length];
    } catch (_) {}
    const i = Number(window.carousel?.index);
    if (Number.isFinite(i)) return ids[(i % ids.length + ids.length) % ids.length];
    return ids[0];
  }
  function lang() { return String(root.lang || 'fa').toLowerCase(); }
  function catLabel(c) {
    if (!c) return '';
    if (lang() === 'en') return EN[Number(c.id)] || c.title || c.name1 || '';
    if (lang() === 'ar') return AR[Number(c.id)] || c.title || c.name1 || '';
    return c.title || c.name1 || '';
  }
  function catDesc(c) {
    if (!c) return '';
    if (lang() === 'en') return DESC_EN[Number(c.id)] || String(c?.shortDesc || c?.longDesc || '');
    if (lang() === 'ar') return DESC_AR[Number(c.id)] || String(c?.shortDesc || c?.longDesc || '');
    return String(c?.shortDesc || c?.longDesc || '');
  }
  function categoryCover(c) { return String(c?.coverImg || '').trim(); }
  function escapeHtml(v) { return String(v ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])); }

  function mountHeroCopy() {
    if (heroCopy?.isConnected) return true;
    const host = $('#gamme .gamme_container .max-width-medium') || $('#gamme .gamme_container');
    if (!host) return false;
    heroCopy = document.createElement('div');
    heroCopy.className = 'westo-v12-hero-copy';
    heroCopy.setAttribute('aria-live', 'polite');
    heroCopy.innerHTML = `
      <div class="westo-v12-hero-kicker"></div>
      <h2 class="westo-v12-hero-title"></h2>
      <p class="westo-v12-hero-desc"></p>
      <div class="westo-v12-hero-rail" role="toolbar" aria-label="دسترسی سریع به دسته‌ها"></div>`;
    host.appendChild(heroCopy);
    heroKicker = $('.westo-v12-hero-kicker', heroCopy);
    heroTitle = $('.westo-v12-hero-title', heroCopy);
    heroDesc = $('.westo-v12-hero-desc', heroCopy);
    // Keep a single canonical scroll instruction. The legacy .scroll_discover
    // is the original WESTO copy; adopt that exact node into the v12 hero copy
    // instead of rendering a second duplicate hint below the category content.
    heroScrollCopy = $('.scroll_discover');
    if (heroScrollCopy && heroDesc) {
      heroScrollCopy.classList.add('westo-v12-hero-scroll-copy');
      heroDesc.insertAdjacentElement('afterend', heroScrollCopy);
    }
    heroRail = $('.westo-v12-hero-rail', heroCopy);
    if (heroRail && heroRail.dataset.bound !== '1') {
      heroRail.dataset.bound = '1';
      heroRail.addEventListener('click', onRailClick);
      heroRail.addEventListener('keydown', onRailKeydown);
    }
    if (!heroCats || !heroCats.isConnected) {
      heroCats = document.createElement('nav');
      heroCats.className = 'westo-prod-hero-cats';
      heroCats.setAttribute('aria-label', 'دسته‌بندی‌ها');
      heroCats.setAttribute('role', 'toolbar');
      host.appendChild(heroCats);
      heroCats.addEventListener('click', onHeroCategoryClick);
      heroCats.addEventListener('keydown', onHeroCategoryKeydown);
    }
    return true;
  }

  function escapeAttr(v) { return escapeHtml(v).replace(/`/g,'&#96;'); }

  function buildHeroCategories() {
    if (!mountHeroCopy() || !heroCats) return;
    const cats = categories();
    const ids = order();
    if (!cats.length || !ids.length) return;
    const signature = `${lang()}|` + ids.map(id => {
      const c = cats.find(x => Number(x.id) === Number(id));
      return c ? `${c.id}:${c.coverImg || ''}:${c.title || c.name1 || ''}` : String(id);
    }).join('|');
    if (heroCats.dataset.signature === signature) return;
    heroCats.dataset.signature = signature;
    heroCats.innerHTML = ids.map((id,index) => {
      const c = cats.find(x => Number(x.id) === Number(id));
      if (!c) return '';
      return `<button class="westo-prod-hero-cat" type="button" data-category-id="${Number(id)}" data-index="${index}" aria-label="${escapeAttr(catLabel(c))}" tabindex="${Number(id) === Number(currentId()) ? 0 : -1}"><img src="${escapeAttr(categoryCover(c))}" alt="" width="48" height="48" loading="${index < 3 ? 'eager' : 'lazy'}" decoding="async"><span>${escapeHtml(catLabel(c))}</span></button>`;
    }).join('');
  }

  function activateHeroCategory(index, id, { focusSource = null } = {}) {
    if (!Number.isFinite(Number(index)) || !Number.isFinite(Number(id))) return false;
    try {
      if (window.carousel?.goTo) {
        window.carousel.goTo(Number(index));
        // Programmatic category navigation must wake an idle WebGL render loop.
        window.westoRenderWake?.();
      } else {
        window.westoCategoryTheme?.apply?.(Number(id));
      }
    } catch (_) {}
    schedule(Number(id), true);
    if (focusSource?.focus) {
      try { focusSource.focus({ preventScroll: true }); } catch (_) {}
    }
    return true;
  }

  function onHeroCategoryClick(e) {
    const b = e.target.closest('.westo-prod-hero-cat[data-index]');
    if (!b) return;
    const index = Number(b.dataset.index);
    const id = Number(b.dataset.categoryId);
    if (!Number.isFinite(index) || !Number.isFinite(id)) return;
    e.preventDefault();
    e.stopPropagation();
    activateHeroCategory(index, id);
  }

  // Direct category chrome must remain interactive even if a horizontal
  // scroller suppresses the synthetic click or the Three gesture listener is
  // running on window. Pointer-up is the authoritative touch path; movement
  // over 10px stays a native pan instead of becoming an accidental selection.
  if (!root.dataset.westoHeroDirectNavBound) {
    root.dataset.westoHeroDirectNavBound = '1';
    let navPointer = null;
    let suppressClickUntil = 0;
    const isHeroInteractive = () =>
      !root.classList.contains('is-dish-boards') && !root.classList.contains('is-cat-flying');
    const activateFromEvent = (e, fromPointer = false) => {
      if (!isHeroInteractive()) return false;
      const cat = e.target?.closest?.('.westo-prod-hero-cat[data-index]');
      const rail = e.target?.closest?.('.westo-v12-hero-rail');
      if (!cat && (!rail || !heroRail)) return false;
      if (fromPointer && navPointer) {
        const dx = Number(e.clientX || 0) - navPointer.x;
        const dy = Number(e.clientY || 0) - navPointer.y;
        if (Math.hypot(dx, dy) > 10) return false;
      }
      e.preventDefault();
      e.stopPropagation();
      if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
      if (cat) {
        const index = Number(cat.dataset.index);
        const id = Number(cat.dataset.categoryId);
        if (!Number.isFinite(index) || !Number.isFinite(id)) return false;
        activateHeroCategory(index, id);
      } else {
        onRailClick(e);
      }
      suppressClickUntil = Date.now() + 450;
      return true;
    };
    document.addEventListener('pointerdown', (e) => {
      if (!isHeroInteractive()) { navPointer = null; return; }
      const target = e.target?.closest?.('.westo-prod-hero-cat[data-index], .westo-v12-hero-rail');
      if (!target || (e.pointerType === 'mouse' && e.button !== 0)) { navPointer = null; return; }
      navPointer = { id: e.pointerId, x: e.clientX, y: e.clientY };
    }, true);
    document.addEventListener('pointerup', (e) => {
      if (!navPointer || navPointer.id !== e.pointerId) return;
      activateFromEvent(e, true);
      navPointer = null;
    }, true);
    document.addEventListener('pointercancel', () => { navPointer = null; }, true);
    document.addEventListener('click', (e) => {
      const target = e.target?.closest?.('.westo-prod-hero-cat[data-index], .westo-v12-hero-rail');
      if (!target) return;
      if (Date.now() < suppressClickUntil) {
        e.preventDefault();
        e.stopPropagation();
        if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
        return;
      }
      activateFromEvent(e, false);
    }, true);
  }

  function onHeroCategoryKeydown(e) {
    if (!['ArrowLeft','ArrowRight','Home','End'].includes(e.key)) return;
    const buttons = $$('.westo-prod-hero-cat', heroCats);
    if (!buttons.length) return;
    const currentButton = e.target.closest('.westo-prod-hero-cat');
    let index = Math.max(0, buttons.indexOf(currentButton));
    if (e.key === 'Home') index = 0;
    else if (e.key === 'End') index = buttons.length - 1;
    else if (e.key === 'ArrowRight') index = (index + 1) % buttons.length;
    else index = (index - 1 + buttons.length) % buttons.length;
    e.preventDefault();
    const next = buttons[index];
    next?.focus({ preventScroll: true });
    next?.click();
  }

  function buildRail() {
    if (!mountHeroCopy()) return;
    buildHeroCategories();
    const ids = order();
    const sig = `${lang()}|${ids.join(',')}`;
    if (heroRail.dataset.signature === sig) return;
    heroRail.dataset.signature = sig;
    heroRail.style.gridTemplateColumns = `repeat(${Math.max(1, ids.length)},1fr)`;
    const cats = categories();
    const activeId = Number(currentId());
    heroRail.innerHTML = ids.map((id, i) => {
      const c = cats.find(x => Number(x.id) === Number(id));
      const label = catLabel(c) || `Category ${i + 1}`;
      const on = Number(id) === activeId;
      return `<button class="westo-v12-hero-dot${on ? ' is-active' : ''}" type="button" data-v12-cat-index="${i}" data-v12-cat-id="${Number(id)}" aria-label="${escapeAttr(label)}" aria-current="${on ? 'true' : 'false'}" tabindex="${on ? '0' : '-1'}"></button>`;
    }).join('');
  }

  function onRailClick(e) {
    let b = e.target.closest('.westo-v12-hero-dot[data-v12-cat-index]');
    let index = b ? Number(b.dataset.v12CatIndex) : NaN;
    let id = b ? Number(b.dataset.v12CatId) : NaN;
    if (!b && heroRail) {
      // The whole progress line is a scrub target, not only the 5px visual dots.
      const ids = order();
      const rect = heroRail.getBoundingClientRect();
      if (ids.length && rect.width > 0) {
        const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        index = Math.round(ratio * (ids.length - 1));
        id = Number(ids[index]);
      }
    }
    if (!Number.isFinite(index) || !Number.isFinite(id)) return;
    e.preventDefault();
    e.stopPropagation();
    activateHeroCategory(index, id);
  }

  function onRailKeydown(e) {
    if (!['ArrowLeft','ArrowRight','Home','End','Enter',' '].includes(e.key)) return;
    const dots = $$('.westo-v12-hero-dot', heroRail);
    if (!dots.length) return;
    const current = e.target.closest('.westo-v12-hero-dot');
    let index = Math.max(0, dots.indexOf(current));
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      current?.click();
      return;
    }
    if (e.key === 'Home') index = 0;
    else if (e.key === 'End') index = dots.length - 1;
    else if (e.key === 'ArrowRight') index = (index + 1) % dots.length;
    else index = (index - 1 + dots.length) % dots.length;
    e.preventDefault();
    dots[index]?.focus({ preventScroll: true });
    dots[index]?.click();
  }

  function render(id = currentId(), { animate = false } = {}) {
    if (!Number.isFinite(Number(id))) return;
    if (!mountHeroCopy()) return;
    buildRail();
    const cats = categories();
    const ids = order();
    const c = cats.find(x => Number(x.id) === Number(id));
    if (!c) return;
    const idx = Math.max(0, ids.findIndex(x => Number(x) === Number(id)));
    lastId = Number(id);
    applyAtmosphereTheme(lastId);
    if (animate && heroCopy) heroCopy.classList.add('is-changing');
    const doPaint = () => {
      if (heroKicker) heroKicker.textContent = `${String(idx + 1).padStart(2,'0')} / ${String(ids.length).padStart(2,'0')} · ${EN[Number(id)] || ''}`;
      if (heroTitle) heroTitle.textContent = catLabel(c);
      if (heroDesc) heroDesc.textContent = catDesc(c);
      if (heroRail) $$('.westo-v12-hero-dot', heroRail).forEach((d, i) => {
        const on = i === idx;
        d.classList.toggle('is-active', on);
        d.setAttribute('aria-current', on ? 'true' : 'false');
        d.tabIndex = on ? 0 : -1;
      });
      if (heroScrollCopy) heroScrollCopy.textContent = lang() === 'en' ? 'Scroll to explore dishes' : lang() === 'ar' ? 'مرّر لرؤية الأطباق' : 'برای دیدن غذاها اسکرول کنید';
      syncHeroStrip(id);
      requestAnimationFrame(() => heroCopy?.classList.remove('is-changing'));
    };
    if (animate) setTimeout(doPaint, 90); else doPaint();
  }

  function syncHeroStrip(id) {
    buildHeroCategories();
    const strip = heroCats || $('.westo-prod-hero-cats');
    if (!strip) return;
    strip.setAttribute('aria-label', lang() === 'en' ? 'Categories' : lang() === 'ar' ? 'الفئات' : 'دسته‌بندی‌ها');
    if (heroRail) heroRail.setAttribute('aria-label', lang() === 'en' ? 'Quick category navigation' : lang() === 'ar' ? 'تنقل سريع بين الفئات' : 'دسترسی سریع به دسته‌ها');
    const buttons = $$('.westo-prod-hero-cat', strip);
    buttons.forEach(b => {
      const on = Number(b.dataset.categoryId) === Number(id);
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-current', on ? 'true' : 'false');
      b.tabIndex = on ? 0 : -1;
    });
    const active = buttons.find(b => Number(b.dataset.categoryId) === Number(id));
    if (active && !root.classList.contains('is-dish-boards') && !root.classList.contains('is-cat-flying')) {
      requestAnimationFrame(() => {
        try {
          const sr = strip.getBoundingClientRect();
          const ar = active.getBoundingClientRect();
          const outside = ar.left < sr.left + 8 || ar.right > sr.right - 8;
          if (outside) active.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', inline:'center', block:'nearest' });
        } catch (_) {}
      });
    }
  }


  function applyAtmosphereTheme(id) {
    const t = window.westoCategoryTheme?.get?.(Number(id));
    if (!t) return;
    const vars = {
      '--cat-wash':t.wash,'--cat-surface':t.surface,'--cat-accent':t.accent,
      '--cat-accent-soft':t.accentSoft,'--cat-glow':t.glow,
    };
    Object.entries(vars).forEach(([name,value]) => {
      if (value && root.style.getPropertyValue(name) !== value) root.style.setProperty(name,value);
    });
  }

  function syncAdminPattern() {
    const configured = String(window.__WESTO_CONTENT__?.content?.['entrance.pattern'] || '').trim();
    if (!configured) return;
    root.style.setProperty('--prod-cta-pattern', `url("${configured.replace(/"/g,'\\"')}")`);
    deriveMicroPattern(configured).then(dataUrl => {
      if (dataUrl) root.style.setProperty('--prod-pattern-micro', `url("${dataUrl}")`);
    }).catch(() => {});
  }

  function deriveMicroPattern(src) {
    return new Promise(resolve => {
      const img = new Image();
      img.decoding='async';
      img.onload=() => {
        try {
          const sample=document.createElement('canvas'); sample.width=sample.height=64;
          const sctx=sample.getContext('2d',{willReadFrequently:true}); if(!sctx) return resolve('');
          const sw=img.naturalWidth||img.width, sh=img.naturalHeight||img.height;
          const side=Math.max(1,Math.min(sw,sh)*.33), sx=Math.max(0,sw*.50-side*.5), sy=Math.max(0,sh*.24-side*.5);
          sctx.drawImage(img,sx,sy,side,side,0,0,64,64);
          const data=sctx.getImageData(0,0,64,64);
          const out=document.createElement('canvas');out.width=out.height=10;
          const octx=out.getContext('2d');if(!octx)return resolve('');
          const tiny=octx.createImageData(10,10);
          for(let ty=0;ty<10;ty+=1){for(let tx=0;tx<10;tx+=1){
            let energy=0,count=0;const x0=Math.floor(tx/10*63),x1=Math.max(x0+1,Math.floor((tx+1)/10*63));const y0=Math.floor(ty/10*63),y1=Math.max(y0+1,Math.floor((ty+1)/10*63));
            for(let y=y0;y<y1;y+=2){for(let x=x0;x<x1;x+=2){const i=(y*64+x)*4,j=(y*64+Math.min(63,x+1))*4,k=(Math.min(63,y+1)*64+x)*4;const l=(data.data[i]+data.data[i+1]+data.data[i+2])/3,r=(data.data[j]+data.data[j+1]+data.data[j+2])/3,d=(data.data[k]+data.data[k+1]+data.data[k+2])/3;energy+=Math.abs(l-r)+Math.abs(l-d);count+=2;}}
            const a=Math.max(0,Math.min(255,Math.round((energy/Math.max(1,count)-7)*5.4))),oi=(ty*10+tx)*4;tiny.data[oi]=48;tiny.data[oi+1]=220;tiny.data[oi+2]=228;tiny.data[oi+3]=a;
          }}
          octx.putImageData(tiny,0,0);resolve(out.toDataURL('image/png'));
        } catch(_) { resolve(''); }
      };
      img.onerror=()=>resolve(''); img.src=src;
    });
  }

  function bindCarousel() {
    if (carouselBound || !window.carousel?.changed?.connect) return false;
    try {
      window.carousel.changed.connect(({ index }) => {
        const ids = order(); if (!ids.length) return;
        const i = ((Number(index) || 0) % ids.length + ids.length) % ids.length;
        schedule(ids[i], true);
      });
      carouselBound = true;
      return true;
    } catch (_) { return false; }
  }

  function schedule(id, animate = false) {
    if (pending) cancelAnimationFrame(pending);
    const requested = Number(id);
    const nextId = Number.isFinite(requested) ? requested : currentId();
    pending = requestAnimationFrame(() => { pending = 0; render(nextId, { animate }); });
  }

  /* Geometry auditor exposed for QA. It never mutates layout. */
  function rect(sel) {
    const el = $(sel); if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x:+r.x.toFixed(1), y:+r.y.toFixed(1), w:+r.width.toFixed(1), h:+r.height.toFixed(1), right:+r.right.toFixed(1), bottom:+r.bottom.toFixed(1) };
  }
  function intersects(a,b,tolerance=0) {
    if (!a || !b) return false;
    return !(a.right <= b.x + tolerance || b.right <= a.x + tolerance || a.bottom <= b.y + tolerance || b.bottom <= a.y + tolerance);
  }
  function audit() {
    const issues = [];
    const vw = innerWidth, vh = innerHeight;
    const sw = Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth || 0);
    if (sw > vw + 2) issues.push({ code:'horizontal-overflow', value:sw-vw });
    if (!$('#westo-entrance')?.hidden) {
      const status=rect('.eg-status'), exp=rect('.eg-experience'), cta=rect('.eg-cta-wrap'), foot=rect('.eg-foot'), card=rect('.eg-card');
      if (intersects(status, exp, -2)) issues.push({ code:'entrance-status-experience-overlap', status, exp });
      if (intersects(exp, cta, -2)) issues.push({ code:'entrance-experience-cta-overlap', exp, cta });
      if (intersects(cta, foot, -2)) issues.push({ code:'entrance-cta-footer-overlap', cta, foot });
      if (card && card.bottom > vh + 1) issues.push({ code:'entrance-card-outside-viewport', card, vh });
    }
    if (!root.classList.contains('is-dish-boards') && $('#westo-entrance')?.hidden) {
      const copy=rect('.westo-v12-hero-copy'), dock=rect('.westo-prod-hero-cats');
      if (intersects(copy,dock,-2)) issues.push({code:'hero-copy-dock-overlap',copy,dock});
      if (dock && (dock.x < -1 || dock.right > vw + 1)) issues.push({code:'hero-dock-overflow',dock,vw});
      if (copy && copy.bottom > vh - 2) issues.push({code:'hero-copy-outside-viewport',copy,vh});
    }
    if (root.classList.contains('is-dish-boards')) {
      const card=rect('#westo-dish-card'), rail=rect('.benefits_nav.is-menu-rail'), bar=rect('.westo-dish-catbar'), media=rect('section.is-benefits .dish-board-media');
      if (intersects(card, rail, -2)) issues.push({ code:'dish-card-rail-overlap', card, rail });
      if (intersects(card, media, -2) && vw < 992) issues.push({ code:'dish-card-media-overlap', card, media });
      if (bar && (bar.x < -1 || bar.right > vw + 1)) issues.push({ code:'catbar-overflow', bar, vw });
      if (card && (card.x < -1 || card.right > vw + 1 || card.bottom > vh + 1)) issues.push({code:'dish-card-outside-viewport',card,vw,vh});
    }
    return { ok:!issues.length, viewport:{w:vw,h:vh}, issues };
  }

  function onReady() {
    mountHeroCopy();
    buildRail();
    buildHeroCategories();
    syncAdminPattern();
    schedule();
    bindCarousel();
    let tries = 0;
    const timer = setInterval(() => {
      tries += 1; bindCarousel(); mountHeroCopy(); buildRail(); buildHeroCategories(); schedule();
      if ((carouselBound && categories().length) || tries > 80) clearInterval(timer);
    }, 125);
  }

  window.addEventListener('westo:category-theme', e => { const id=Number(e?.detail?.id); if(Number.isFinite(id)){ applyAtmosphereTheme(id); schedule(id,true); } });
  window.addEventListener('westo:dish-focus', e => { const id=Number(e?.detail?.categoryId); if(Number.isFinite(id)) lastId=id; });
  window.addEventListener('westo:theme-change', () => schedule(lastId || currentId()));
  document.addEventListener('westo:menu-ready', () => { buildRail(); schedule(); });
  document.addEventListener('westo:langchange', () => { if (heroCats) delete heroCats.dataset.signature; if (heroRail) delete heroRail.dataset.signature; buildRail(); buildHeroCategories(); schedule(lastId || currentId()); });
  const classObserver = new MutationObserver(() => {
    if (!root.classList.contains('is-dish-boards')) schedule(currentId());
  });
  classObserver.observe(root, { attributes:true, attributeFilter:['class','lang','dir','data-cat-id'] });

  window.westoV12QA = { audit, render:() => render(currentId()), version:'12.8.0' };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', onReady, { once:true }); else onReady();
})();

;/* ===== END js/westo-production-v12.js ===== */

/* ===== BEGIN js/westo-v14.3-ultra-fine.js ===== */
/* WESTO v14.3 Ultra Fine — low-overhead interaction polish / thermal governor. */
(() => {
  'use strict';
  const root = document.documentElement;

  // Give each dish board a different static ambient-light destination. The
  // existing dish active/leaving state machine owns the transition; no scroll RAF.
  document.querySelectorAll('section.is-benefits').forEach((section, index) => {
    section.dataset.westoLightSlot = String(index % 4);
  });

  // Keep active category readable and centered without competing with the
  // category state owner. Native touch/trackpad scrolling remains authoritative.
  document.querySelectorAll('.westo-prod-hero-cats').forEach((rail) => {
    rail.setAttribute('data-lenis-prevent', '');
    rail.setAttribute('data-lenis-prevent-touch', '');
    const center = (target, behavior = 'smooth') => {
      if (!target?.matches?.('.westo-prod-hero-cat')) return;
      const left = target.offsetLeft - (rail.clientWidth - target.offsetWidth) / 2;
      rail.scrollTo({ left: Math.max(0, left), behavior });
    };
    rail.addEventListener('click', (event) => center(event.target.closest('.westo-prod-hero-cat')));
    rail.addEventListener('focusin', (event) => center(event.target.closest('.westo-prod-hero-cat')));
    rail.addEventListener('wheel', (event) => {
      const horizontalIntent = event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY) * 0.45;
      if (!horizontalIntent || rail.scrollWidth <= rail.clientWidth + 2) return;
      event.preventDefault();
      rail.scrollLeft += event.deltaX || event.deltaY;
    }, { passive:false });
  });

  // Thermal governor only pauses decorative CSS animation after real idle.
  // It never changes menu/cart/category state and does not add a frame loop.
  let idleTimer = 0;
  const setIdle = (idle) => {
    root.dataset.thermalIdle = idle ? 'true' : 'false';
    try { window.dispatchEvent(new CustomEvent(idle ? 'westo:thermal-idle' : 'westo:thermal-wake')); } catch (_) {}
  };
  const armIdle = (delay = 4200) => {
    clearTimeout(idleTimer);
    setIdle(false);
    if (document.hidden) return;
    idleTimer = window.setTimeout(() => setIdle(true), delay);
  };
  const wakeEvents = ['pointerdown','wheel','touchstart','keydown'];
  wakeEvents.forEach((name) => window.addEventListener(name, () => armIdle(3600), { passive:true, capture:true }));
  document.addEventListener('visibilitychange', () => {
    clearTimeout(idleTimer);
    if (document.hidden) setIdle(true);
    else armIdle(2400);
  });
  window.addEventListener('eg-entered', () => armIdle(3200), { once:true });
  armIdle(5200);
})();

;/* ===== END js/westo-v14.3-ultra-fine.js ===== */
