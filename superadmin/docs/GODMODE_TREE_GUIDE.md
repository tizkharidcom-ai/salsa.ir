# ساختار درختی و نقشه معماری کنترل‌پلین سالسا (SALSA CONTROL PLANE TREE GUIDE)

> **نسخه مستندات**: ۳.۰ (Canonical Tree Architecture - End of Documentation Drift)  
> **نقش سامانه**: کنترل‌پلین مرکزی پلتفرم (Platform Control Plane)  
> **اصل اساسی**: **Simple by default. Deep on demand. Safe always.**  
> **مجموعه مرجع پایلوت**: کافه وستو (WESTO Cafe - Tenant #1)  

---

## ۱. ساختار کلان درختی پلتفرم سالسا (The 5 Canonical Destinations)

در نسخه ۳.۰، ساختارهای قدیمی (۲۹ صفحه پراکنده، ۶ ستون متناقض یا ۱۶ تب گیج‌کننده) به **۵ مقصد کلان با ناوبری ثانویه ساختاریافته** تبدیل شدند:

```text
SALSA CONTROL PLANE
│
├── 1. 🏠 HOME (مرکز توجه و صندوق اقدامات فوری)
│   ├── صندوق اقدامات و رویدادهای نیازمند مداخله (Action Inbox)
│   ├── رخدادهای بحرانی باز (Critical Incidents)
│   ├── تریاژ بدهی‌ها و وصولی‌های فوری مالی (Commercial Collections)
│   ├── پایش سلامت ۵ گره زیرساختی مستقل از اینترنت خارجی
│   └── ردپای ممیزی زنده و هش‌های متوالی رویدادها
│
├── 2. 🏢 RESTAURANTS (شاخص عملیاتی و پرونده ۳۶۰ درجه مجموعه‌ها)
│   ├── شاخص عملیاتی و فیلترهای لایف‌سایکل (Live Filter & Search)
│   ├── نماهای ذخیره‌شده (Saved Views: Needs Attention, Past Due, Trials Ending)
│   ├── ویزارد راه‌اندازی و تحویل پیوسته ۳ مرحله‌ای (Resumable Provisioning Pipeline)
│   │
│   └── 📂 پرونده اختصاصی هر مجموعه (Restaurant Workspace — ۷ تب متمرکز)
│       ├── Tab 1: Overview (معماری ۳ لایه: وضعیت، هویت تجاری، سیگنال‌های عملیاتی)
│       ├── Tab 2: Subscription (پلن، افزونه‌ها، سهمیه‌ها و ارزیاب دسترسی موثر)
│       ├── Tab 3: People (مالکان، مدیران و پرسنل — تفکیک مطلق از مشتریان CRM)
│       ├── Tab 4: Hardware (پایانه‌های POS، KDS، چاپگرها و پروب بدون تماس مستقیم)
│       ├── Tab 5: Channels (دامنه‌های سفارشی، صدور خودکار گواهی ACME و DNS)
│       ├── Tab 6: Reliability (شاخص‌های RPO/RTO، استریم WAL، آرشیو و مانور سندباکس)
│       └── Tab 7: Activity (دفتر کل ممیزی سرور با امضای دیجیتال SHA-256)
│
├── 3. 💳 COMMERCIAL (مرکز کنترل چرخه درآمد، اشتراک و بازرگانی)
│   ├── ▤ Product & Capabilities (کاتالوگ قابلیت‌های تجاری پلتفرم)
│   ├── ▣ Plans & Tiers (سطوح تجاری و پلن‌های نسخه‌بندی‌شده)
│   ├── ◈ Subscriptions (مدیریت اشتراک‌های فعال، تمدیدها و استمهال)
│   ├── 💳 Billing & Invoices (صدور فاکتور رسمی، ثبت وصولی و شناسه تسویه یکتا)
│   ├── ▥ Usage & Quotas (سهمیه‌ها، سقف مصرف و پیش‌بینی اتمام ظرفیت)
│   └── ⚖️ Exception Queue & Reconciliation (صف رفع مغایرت‌های مالی و فعال‌سازی)
│
├── 4. ⚙️ OPERATIONS (مرکز کنترل زیرساخت، رخدادها و استقرار)
│   ├── 🚨 Incidents & Health («پلتفرم سالم است؟»، شاخص‌های SLO، رخدادهای باز)
│   ├── ⏱️ Jobs & Queues (صف وظایف، جاب‌های ناموفق، Outbox و Correlation ID)
│   ├── ⬡ Infrastructure (گره‌های پردازشی، استخر دیتابیس و ارتباطات Edge)
│   ├── ⇄ Releases & Canary (نسخه پایدار، کاندید، دروازه‌های توقف و Rollback)
│   ├── ↯ Automations (موتور قوانین خودکار، زمان‌بندی و لاگ‌های اجرا)
│   └── 🛠️ Diagnostics (ابزارهای پیشرفته پاک‌سازی کش و بنچ‌مارک مجزا)
│
└── 5. 🔒 PLATFORM SETTINGS (تنظیمات کلان، امنیت و حاکمیت پلتفرم)
    ├── 👥 SALSA Team (اعضای تیم پلتفرم، سطوح دسترسی RBAC و وضعیت MFA)
    ├── 🛡️ Cybersecurity Posture (سنجش مبتنی بر شواهد سپرهای دفاعی — بدون سبز ساختگی)
    ├── 🚦 Production Readiness Gates (۱۰ دروازه کلان آمادگی عملیاتی پروداکشن)
    ├── 🔒 Session & TOTP Policies (سیاست‌های نشست اداری و مانور اضطراری قرنطینه)
    ├── ≣ Cryptographic Audit Trail (زنجیره ممیزی ضدجعل SHA-256 و استخراج رسمی)
    └── 🖨️ Certified Hardware Catalog (کاتالوگ پایانه‌ها و چاپگرهای دارای تاییدیه آفلاین)
```

---

## ۲. ره‌نگاشت و نگاشت مسیرهای سازگاری (Compatibility Route Map)

برای جلوگیری از شکست نشانک‌ها (Bookmarks) یا لینک‌های قدیمی، تمام کدهای GM01 تا GM29 بدون لود اسکریپت‌های منسوخ، به مسیرهای کاننیکال مدرن هدایت می‌شوند:

| شناسه قدیمی | هش قدیمی | مسیر استاندارد کاننیکال | بخش / تب مقصد |
| :--- | :--- | :--- | :--- |
| **GM-01** | `#gm-01-login` | `#settings?section=team` | Platform Settings → Team & Auth |
| **GM-02** | `#gm-02-overview` | `#home` | Home Control Center |
| **GM-03** | `#gm-03-tenants` | `#restaurants` | Restaurants Index |
| **GM-04** | `#gm-04-tenant-detail` | `#restaurants/:id/overview` | Restaurant Workspace → Overview |
| **GM-05** | `#gm-05-tenant-new` | `#restaurants/create` | Resumable Onboarding Wizard |
| **GM-06** | `#gm-06-provisioning` | `#restaurants/:id/overview` | Restaurant Workspace → Overview |
| **GM-08** | `#gm-08-features` | `#commercial?section=modules` | Commercial → Product Catalog |
| **GM-09** | `#gm-09-tenant-features` | `#restaurants/:id/subscription` | Restaurant Workspace → Subscription |
| **GM-10** | `#gm-10-plans` | `#commercial?section=plans` | Commercial → Plans |
| **GM-11** | `#gm-11-billing` | `#commercial?section=billing` | Commercial → Billing |
| **GM-12** | `#gm-12-usage` | `#commercial?section=quotas` | Commercial → Quotas |
| **GM-13** | `#gm-13-identities` | `#restaurants/:id/people` | Restaurant Workspace → People |
| **GM-14** | `#gm-14-access-roles` | `#restaurants/:id/people` | Restaurant Workspace → People |
| **GM-16** | `#gm-16-automations` | `#operations?section=automations` | Operations → Automations |
| **GM-18** | `#gm-18-domains` | `#restaurants/:id/channels` | Restaurant Workspace → Channels |
| **GM-19** | `#gm-19-devices` | `#restaurants/:id/hardware` | Restaurant Workspace → Hardware |
| **GM-20** | `#gm-20-backups` | `#restaurants/:id/reliability` | Restaurant Workspace → Reliability |
| **GM-21** | `#gm-21-support` | `#restaurants/:id/reliability` | Restaurant Workspace → Reliability |
| **GM-22** | `#gm-22-operations` | `#operations?section=incidents` | Operations → Incidents & Health |
| **GM-23** | `#gm-23-releases` | `#operations?section=releases` | Operations → Releases & Canary |
| **GM-24** | `#gm-24-infrastructure` | `#operations?section=infrastructure` | Operations → Infrastructure |
| **GM-25** | `#gm-25-jobs` | `#operations?section=jobs` | Operations → Jobs & Queues |
| **GM-26** | `#gm-26-audit` | `#settings?section=audit` | Platform Settings → Audit Trail |
| **GM-27** | `#gm-27-team` | `#settings?section=team` | Platform Settings → Team Members |
| **GM-29** | `#gm-29-printers` | `#settings?section=hardware` | Platform Settings → Hardware Catalog |

---

## ۳. چارچوب فرماندهی و ایمنی جهش‌ها (Command Safety Matrix)

کلیه عملیات حساس و جهش‌های پایگاه‌داده موظف به ثبت و تأیید در `GodModeCommandFramework` هستند:

```
[UI Trigger]
     │
     ▼
[Command Definition]
     ├─ Preflight Validation (تأیید ورودی‌ها و عدم وجود تناقض)
     ├─ Role & Permission Check (اعتبارسنجی نقش بر اساس RBAC)
     ├─ Impact Preview (نمایش تأثیر تغییر بر شعب، تجهیزات و کاربران)
     ├─ Reason Collection (ثبت دلیل الزامی متنی جهت حسابرسی)
     ├─ Typed Confirmation (تایپ کلمه تایید برای عملیات تخریب‌پذیر)
     ├─ Idempotency Key Injection (جلوگیری از اعمال تکراری درخواست)
     └─ Version Check / If-Match (جلوگیری از تداخل همزمانی ۴۰۹)
     │
     ▼
[Control Plane Client] ──(Cookie + CSRF)──► [Authorized Backend Endpoint]
                                                    │
                                                    ▼
                                           [Tamper-Proof Audit Chain]
```

---

## ۴. جمع‌بندی استانداردهای محصولی

1. **مدیریت در مقیاس بالا**: توانایی راهبری بی‌دردسر بیش از ۱۰,۰۰۰ مجموعه و شعبه مستقل با شاخص‌های برخط.
2. **پایداری داده‌ها**: ایزولاسیون کامل فضای ذخیره‌سازی و عدم وابستگی به متغیرهای گلوبال یا پایگاه ساختگی در محیط پروداکشن.
3. **دقت ممیزی**: قابلیت ردیابی هر تغییر به شناسه اپراتور، زمان دقیق، دلیل و شناسه ردیابی (Request / Correlation ID).
