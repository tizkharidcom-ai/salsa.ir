# گزارش راستی‌آزمایی ماژول‌های وستو

تاریخ: ۲۰۲۶-۰۹-۳۰. این شواهد اجرای محلی و آزمایشی هستند و اثبات میزبانی عمومی یا آمادگی production نیستند.

## آزمون متمرکز

```sh
node --test test/modular-ecosystem.test.js test/modular-tenant-http.test.js test/order-checkout-http-runtime.test.js test/module-control-production.test.js test/finance-event-replay-integrity.test.js
```

۳۲ آزمون موفق، بدون شکست و بدون skip. سرور HTTP روی پورت آزاد و دادهٔ موقت اجرا شد. Hostهای مشتری به مرجع ثبت آزمایشی متصل شدند؛ ذخیرهٔ تاریخچه در JSON موقت بررسی شد. اتصال PostgreSQL و DNS عمومی در این آزمون‌ها اجرا نشده است. آزمون transaction انتخاب نسخه از adapter SQL آزمایشی با بررسی commit/rollback، receipt و audit استفاده می‌کند.

سناریوهای بسته‌شده:

- ۱۴ ماژول با پیاده‌سازی واقعی، alias نسبی سالم و artifact نسخهٔ ۱ با SHA معتبر.
- ۲۱۸ بدنهٔ HTTP و ۳۷ نمای ادمین با SHA منطقی مطابق پیش از استخراج.
- نسخهٔ ناموجود، مسیر نامعتبر، revision قدیمی، فقدان رسید ذخیره و خطای audit به موفقیت تبدیل نمی‌شوند.
- اضافه‌شدن فایل برای نسخهٔ آینده، artifact موجود را بی‌دلیل نامعتبر نمی‌کند؛ انتشار متفاوت روی همان نسخه مجاز نیست.
- دادهٔ تولیدشدهٔ bootstrap جزو release نیست؛ مشتری خالی منوی وستو را دریافت نمی‌کند.
- دو مشتری خالی از یک کد استفاده می‌کنند، نشست یکی روی دیگری رد می‌شود و Host ناشناخته پذیرفته نمی‌شود.
- API اصلی و قدیمی حسابداری و KDS فاقد اشتراک، حتی برای مالک مشتری، مسدود است.
- فروش تاریخی مرداد، replay بدون تکرار و تسویهٔ واقعی صندوق با حسابداری غیرفعال ثبت می‌شوند. سند مالی در فایل موقت پایدار است.
- پس از فعال‌سازی، تاریخچهٔ قبلی در API حسابداری دیده می‌شود. انقضا همان داده را حفظ و دسترسی را مسدود می‌کند. مشتری دیگر هیچ رویداد فروش دریافت نمی‌کند.
- نمای حسابداری پس از override رجیستری هم اشتراک را رعایت می‌کند؛ داشبورد تحلیل حسابداری را برای مشتری فاقد اشتراک نمی‌سازد.
- منوی خالی با قالب‌بندی فارسی عدد صفر رندر می‌شود. اتصال formatter قدیمی `fa` در adapter نما اصلاح شده است؛ بدنهٔ HTML موجود بازطراحی نشده.
- سرویس‌ورکر کد تازهٔ شبکه را پیش از کش نسخهٔ قبلی می‌دهد و fallback آفلاین را حفظ می‌کند.

## مجموعهٔ عمومی

```sh
node --test test/*.test.js
```

تعداد: 1322؛ موفق: 1301؛ شکست: 19؛ skip: 1؛ todo: 1.

۱۹ شکست با baseline پیش از استخراج برابرند؛ شکست تازه‌ای در مجموعهٔ عمومی ایجاد نشده است. تمام assertionهای آزمون‌های قدیمی حفظ شده‌اند. helper فقط کد اجرایی ماژول‌ها را برای آزمون‌های وابسته به ساختار فایل ترکیب می‌کند؛ snapshot قدیمی جای کد فعلی نیست.

شکست‌های از قبل موجود:

- legacy admin KDS action controls use the linked stylesheet and touch-sized mobile targets
- refund request uses the recoverable server receipt and says no money was transferred
- changing branch invalidates the quote and blocks submit until that branch metadata resolves
- a failed price quote leaves an explicit retry action instead of a dead disabled submit
- an incomplete HTTP 200 quote is rejected and the customer can retry for a complete server quote
- an expired quote is rejected safely, refreshed, and only then submitted with a new intent key
- an explicit different order owner cannot fall through to a colliding phone number
- platform operator identities cannot be promoted or authenticated as tenant owners
- smart-loaded bundles stay byte-for-byte aligned with the standalone cart source
- order completion awards loyalty only to a customer account and ignores async SMS failure
- cashier mobile product names use theme ink on light cards and bust the cached stylesheet
- inactive floor-plan table is visibly unavailable and removed from waiter keyboard order
- inactive tables remain selectable when editing the floor layout
- role panel cache-busts the current waiter mobile-card stylesheet
- waiter order progress uses the canonical staged payment workflow and flags reconciliation
- saved course firing adopts the verified server order state and locks an uncertain response
- waiter mobile course and item controls retain readable text and touch targets
- waiter floor cards and zone filters remain keyboard-operable, named controls
- a confirmed assignment updates the waiter queue even when the follow-up refresh fails

## بررسی ساختار و مرورگر

`npm run modules:verify` برای تمام ماژول‌ها موفق است. بررسی نحوی ۲۹۷ فایل backend/route/runtime بدون خطا بود.

در مرورگر، ورود نمایشی به tenant آزمایشی و صفحهٔ موجود `admin#menu` انجام شد. مدیریت منو، «دسته‌ای نیست» و صفر محصول را نشان داد؛ گزینه‌های حسابداری و KDS مخفی بودند و نمودار حسابداری در داشبورد وجود نداشت. مشکل غلبهٔ CSS بر `hidden` در پوسته اصلاح شد. غذا یا صفحهٔ نمونهٔ تازه ساخته نشد. تصویر محلی در `outputs/modularization/darbar-empty-menu.png` ذخیره شد و جزو بستهٔ source ارسالی نیست.

دادهٔ لایو در آزمون‌های HTTP hash شد و دست‌نخورده باقی ماند؛ listener لایو برای اجرای این آزمون‌ها restart نشد. فعال‌سازی تغییر backend روی سرویس در حال اجرا، استقرار جداگانه است.
