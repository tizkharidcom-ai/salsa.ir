# WESTO — Smart Resource Loader / Clean Runtime

> **Current build:** WESTO v13.1 Recovery Design Logic. The original v13 audit is superseded; see `RECOVERY-NOTES.md` and `docs/design-logic-v13.1-recovery/`.

نسخه فعلی WESTO از Resource Scheduler مرکزی برای اولویت‌بندی کد و تصاویر منو و از یک Service Worker محدود برای پوستهٔ PWA استفاده می‌کند. ناوبری‌ها network-first و مسیرهای `/api/` خارج از کنترل Worker هستند تا دادهٔ منو و سفارش کهنه نشود. فایل `js/disable-service-worker.js` فقط برای سابقه نگه داشته شده و هیچ صفحه‌ای آن را بارگذاری نمی‌کند. Bundleهای `westo-*.smart.js` از sourceهای اصلی توسط `npm run build:smart` تولید می‌شوند؛ sourceها برای نگهداری و build حفظ شده‌اند و bundleها runtime production هستند.

# Westo — Local Mirror of westo.local (نسخه فارسی)

آینه کامل محلی از [westo.local](https://www.westo.local/) به‌عنوان پایه طراحی سایت Westo. تمام HTML/CSS/JS، مدل‌های سه‌بعدی، تکسچرها، ویدیوها، فونت‌ها و صداها به‌صورت محلی ذخیره شده‌اند و سایت بدون اینترنت اجرا می‌شود. تمام متن‌های سایت (صفحه اصلی + سه صفحه حقوقی) به فارسی ترجمه شده‌اند.

## اجرا

```bash
npm install
npm run start
```

سپس [http://localhost:4180](http://localhost:4180) را باز کنید. (`npm start` سرور Express را از `server/server.js` اجرا می‌کند که هم فایل‌های استاتیک و هم API را می‌دهد.)

## ورود، پنل ادمین و پروفایل

- دکمه «ورود» در نوبار به صفحه `/login` می‌رود؛ ورود دومرحله‌ای با OTP است (**حالت دمو**: کد ۵ رقمی روی صفحه و در کنسول سرور نمایش داده می‌شود — برای پیامک واقعی فقط تابع ارسال در `server/server.js` باید عوض شود).
- شماره **09374333028** نقش سوپر ادمین دارد و بعد از ورود به `/admin` می‌رود؛ بقیه شماره‌ها کاربر عادی‌اند و به `/profile` می‌روند.
- پنل ادمین (`/admin`): داشبورد، ویرایش همه متن‌های صفحه اصلی، تعویض لوگوها با آپلود، ویرایش ۶ محصول (آماده تبدیل به منوی کافه وستو)، مدیریت FAQ (افزودن/حذف/ترتیب)، مدیریت کاربران (مسدود/حذف/ارتقا)، لیست خبرنامه با خروجی CSV و تنظیمات (عنوان سایت، متا، شماره‌های ادمین).
- داده‌ها در `server/data/db.json` ذخیره می‌شوند (بدون دیتابیس خارجی). فایل‌های آپلودی در `uploads/`.
- `js/content-overrides.js` قبل از انیمیشن‌ها محتوای ویرایش‌شده را از `/api/content` روی صفحه اعمال می‌کند و فرم خبرنامه به‌جای Brevo به `/api/newsletter` محلی ثبت می‌شود.
- برای ریست کامل محتوا به حالت اولیه: سرور را خاموش کنید، `server/data/db.json` را حذف کنید و دوباره `npm start` بزنید.

## تکنولوژی‌ها

- **Webflow** HTML/CSS + jQuery (خروجی استاتیک)
- **Three.js r161** — صحنه سه‌بعدی Hero (`js/three-scene.js`) با EffectComposer + SMAA و textureهای منوی آماده
- **GSAP 3.15** + ScrollTrigger + SplitText — انیمیشن‌های اسکرول و متن
- **Lenis 1.3.23** — اسکرول نرم

## ساختار

```
index.html                       صفحه اصلی
cgu.html / mentions-legales.html / politique-de-confidentialite.html
css/                             CSS وبفلو + استایل فرم Brevo
js/
  three-scene.js                 صحنه Three.js (ماژول ES)
  animations.js                  انیمیشن‌های GSAP/ScrollTrigger
  sounds.js                      افکت‌های صوتی UI
  buttons.js                     انیمیشن hover دکمه‌ها
  vendor/                        GSAP, ScrollTrigger, SplitText, jQuery, Lenis,
                                 Webflow chunks, Three core + postprocessing sources
assets/
  menu/                          تصاویر بهینه غذای منو و کاور دسته‌ها
  images/                        لوگو، favicon و تصاویر UI
  fonts/                         فونت‌های محلی
  audio/                         افکت‌های صوتی UI
uploads/                         فایل‌های فعال آپلودشده از پنل
```

## فارسی‌سازی

- فونت **Vazirmatn** (`assets/fonts/Vazirmatn-Variable.woff2`) به‌صورت local و self-contained از طریق `css/vazir-system.css` روی رابط عمومی و Command Center اعمال می‌شود؛ فونت Mono فقط برای کد/شناسه‌های فنی حفظ شده است.
- جهت متن پاراگراف‌ها، عنوان‌ها و سؤالات FAQ در همان فایل override به RTL تغییر کرده؛ چیدمان کلی صفحه LTR مانده تا انیمیشن‌های اسکرول و WebGL دست‌نخورده بمانند.
- انیمیشن‌های SplitText و hover دکمه‌ها برای متن فارسی از حالت حرف‌به‌حرف به کلمه‌به‌کلمه تغییر کرده‌اند (در `js/animations.js`، `js/buttons.js` و اسکریپت‌های inline صفحات حقوقی) تا اتصال حروف فارسی از بین نرود.
- برچسب صدا (ON/OFF) به «روشن/خاموش» تغییر کرده و پیام‌های فرم Brevo هم فارسی شده‌اند.

## نکات

- فرم خبرنامه دیگر به Brevo/reCAPTCHA وابسته نیست و ایمیل‌ها محلی (در `db.json`) ذخیره می‌شوند؛ کل سایت کاملاً آفلاین کار می‌کند.
- اسکریپت آنالیتیکس Umami حذف شده است.
- مسیرهای بدون پسوند (`/cgu`، `/login`، `/admin` و…) توسط سرور Express هندل می‌شوند.
- نوشته‌های روی خود قوطی‌های سه‌بعدی داخل تکسچرها (`assets/textures/*.avif`) هستند و از پنل عوض نمی‌شوند؛ تعویض آن‌ها فاز جداگانه‌ای است.

## برندینگ

این نسخه صرفاً مرجع فنی/طراحی است. لوگو، مدل‌های سه‌بعدی، متن‌ها و برند Westo متعلق به صاحب سایت اصلی است و پیش از انتشار عمومی باید با محتوای Westo جایگزین شود (فاز بعدی).
