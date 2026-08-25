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
      fa: 'Cafe & Restaurant',
      en: 'Cafe & Restaurant',
      ar: 'Cafe & Restaurant',
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
      fa: 'About Us',
      en: 'About Us',
      ar: 'About Us',
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
    'site.documentTitle': { fa: 'Westo — منوی کافه و رستوران', en: 'WESTO — Café & Restaurant Menu', ar: 'WESTO — قائمة المقهى والمطعم' },
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
    'cart.title': { fa: 'تیبل', en: 'Table', ar: 'الطاولة' },
    'cart.empty': {
      fa: 'تیبل خالی است\nاز منو غذا اضافه کنید',
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
    'cart.remove': { fa: 'حذف از تیبل', en: 'Remove from table', ar: 'إزالة من الطاولة' },
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
    'checkout.emptyCategory': { fa: 'در این دسته آیتم فعالی وجود ندارد.', en: 'No active items in this category.', ar: 'لا توجد عناصر متاحة في هذه الفئة.' },
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
    'profile.documentTitle': { fa: 'پروفایل — Westo', en: 'Profile — WESTO', ar: 'الملف الشخصي — WESTO' },
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
    'feedback.nps': { fa: 'امتیاز NPS (۰–۱۰)', en: 'NPS score (0–10)', ar: 'تقييم NPS (0–10)' },
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
    'cm.add': { fa: 'افزودن به تیبل', en: 'Add to table', ar: 'أضف إلى الطاولة' },
    'cm.added': {
      fa: 'به تیبل اضافه شد',
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
