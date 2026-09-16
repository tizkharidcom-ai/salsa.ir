/* WESTO Smart Load generated bundle: js/westo-foundation.smart.js
   Sources: js/persian-format.js, js/i18n.js, js/category-theme.js, js/menu-store.js, js/content-overrides.js, js/theme.js, js/westo-entrance.js, js/entrance-promo-deck.js, js/subcategory-kill-switch.js, js/brand-lockup.js, js/language-switch-rescue.js, js/design-logic-v13.js
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
