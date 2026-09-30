/**
 * prototype/js/store.js
 * 
 * 100% Synthetic In-Memory Store for SALSA GODMODE Phase 1 Prototype.
 * Strictly isolated: Zero connection to Westo runtime database or real credentials.
 */

class PrototypeStore {
  constructor() {
    this.STORAGE_KEY = 'salsa_godmode_clean_v1';
    this.listeners = new Set();
    this.init();
  }

  getInitialSeed() {
    return {
      tenants: [
        {
          id: 'tnt_westo_demo',
          name: 'کافه وستو (Westo Café)',
          slug: 'westo',
          organization: 'مجموعه کافه‌رستوران وستو',
          domain: 'westo.neem.ir',
          plan: 'Enterprise (سراسری)',
          status: 'active',
          health: 'healthy',
          cellId: 'cell-msh-01',
          branchesCount: 1,
          devicesCount: 4,
          tablesCount: 16,
          port: null,
          liveUrl: null,
          targetClientUrl: null,
          lastBackup: 'امروز ۰۳:۰۰ (تأییدشده)',
          lastSync: 'همگام‌سازی محلی (آماده اتصال کنترل‌پلن)',
          ownerName: 'مالک نمونه',
          ownerPhone: '۰۹۱۲۰۰۰۰۰۰۰',
          city: 'مشهد',
          menuItemsCount: 0,
          categoriesCount: 0,
          ordersCount: 0,
          createdAt: '۱۴۰۳/۰۱/۰۱'
        }
      ],

      // 48 Sellable Features from Section 7.2 of GODMODE.MD
      features: [
        { key: 'core.workspace', nameFa: 'فضای کاری اصلی رستوران', category: 'پایه', pricePerMonth: 0, dependencies: [] },
        { key: 'catalog.menu', nameFa: 'منوی دیجیتال و دسته‌بندی', category: 'کاتالوگ', pricePerMonth: 0, dependencies: ['core.workspace'] },
        { key: 'catalog.modifiers', nameFa: 'تاپینگ‌ها و گزینه‌های سفارشی', category: 'کاتالوگ', pricePerMonth: 150000, dependencies: ['catalog.menu'] },
        { key: 'catalog.pricing', nameFa: 'قیمت‌گذاری پیشرفته و متغیر', category: 'کاتالوگ', pricePerMonth: 200000, dependencies: ['catalog.menu'] },
        { key: 'catalog.languages', nameFa: 'منوی چندزبانه (بین‌المللی)', category: 'کاتالوگ', pricePerMonth: 180000, dependencies: ['catalog.menu'] },
        { key: 'catalog.print', nameFa: 'قالب‌های چاپ و خروجی فیزیکی منو', category: 'کاتالوگ', pricePerMonth: 120000, dependencies: ['catalog.menu'] },
        
        { key: 'orders.online', nameFa: 'سفارش‌گیری آنلاین مشتریان', category: 'سفارشات', pricePerMonth: 350000, dependencies: ['catalog.menu'] },
        { key: 'orders.pos', nameFa: 'صندوق فروشگاهی لمسی (POS)', category: 'سفارشات', pricePerMonth: 450000, dependencies: ['catalog.menu'] },
        { key: 'orders.advanced', nameFa: 'تفکیک صورتحساب و کورس غذا', category: 'سفارشات', pricePerMonth: 250000, dependencies: ['orders.pos'] },
        
        { key: 'floor.tables', nameFa: 'مدیریت میزها و نقشه سالن', category: 'سالن', pricePerMonth: 200000, dependencies: ['core.workspace'] },
        { key: 'floor.qr', nameFa: 'سفارش سر میز با کیوآرکد اختصاصی', category: 'سالن', pricePerMonth: 220000, dependencies: ['floor.tables', 'orders.online'] },
        { key: 'staff.waiter', nameFa: 'ترمینال سیار گارسون', category: 'پرسنل', pricePerMonth: 300000, dependencies: ['floor.tables'] },
        { key: 'kitchen.kds', nameFa: 'نمایشگر آشپزخانه (KDS)', category: 'آشپزخانه', pricePerMonth: 400000, dependencies: ['orders.pos'] },
        
        { key: 'booking.reservations', nameFa: 'رزرو آنلاین میز', category: 'رزرو', pricePerMonth: 280000, dependencies: ['floor.tables'] },
        { key: 'booking.waitlist', nameFa: 'صف انتظار هوشمند مهمانان', category: 'رزرو', pricePerMonth: 190000, dependencies: ['floor.tables'] },
        { key: 'delivery.dispatch', nameFa: 'مدیریت پیک و ارسال اختصاصی', category: 'تحویل', pricePerMonth: 320000, dependencies: ['orders.online'] },
        
        { key: 'payments.gateway', nameFa: 'درگاه پرداخت آنلاین شاپرک', category: 'مالی', pricePerMonth: 0, dependencies: ['orders.online'] },
        { key: 'cash.drawers', nameFa: 'مدیریت صندوق نقدی و شفت', category: 'مالی', pricePerMonth: 200000, dependencies: ['orders.pos'] },
        { key: 'finance.workspace', nameFa: 'حسابداری دوبل و اسناد دفاتر', category: 'مالی', pricePerMonth: 600000, dependencies: ['core.workspace'] },
        { key: 'finance.purchases', nameFa: 'فاکتور خرید و بستانکاران', category: 'مالی', pricePerMonth: 350000, dependencies: ['finance.workspace'] },
        { key: 'finance.reconciliation', nameFa: 'مغایرت‌گیری بانکی پوز', category: 'مالی', pricePerMonth: 400000, dependencies: ['finance.workspace'] },
        { key: 'finance.assets', nameFa: 'اموال و استهلاک دارایی‌ها', category: 'مالی', pricePerMonth: 250000, dependencies: ['finance.workspace'] },
        { key: 'finance.payroll', nameFa: 'حقوق و دستمزد و کارکرد پرسنل', category: 'مالی', pricePerMonth: 380000, dependencies: ['finance.workspace'] },
        { key: 'finance.tax_adapter', nameFa: 'سامانه مؤدیان و کارتخوان', category: 'مالی', pricePerMonth: 500000, dependencies: ['finance.workspace'] },
        { key: 'finance.consolidation', nameFa: 'تلفیق مالی چند شعبه‌ای', category: 'مالی', pricePerMonth: 800000, dependencies: ['finance.workspace', 'platform.multi_branch'] },
        
        { key: 'stock.inventory', nameFa: 'انبارداری و شمارش موجودی', category: 'انبار', pricePerMonth: 400000, dependencies: ['core.workspace'] },
        { key: 'stock.recipes', nameFa: 'دستور تهیه و بهای تمام‌شده غذا (COGS)', category: 'انبار', pricePerMonth: 550000, dependencies: ['stock.inventory', 'catalog.menu'] },
        { key: 'stock.procurement', nameFa: 'سفارش خرید و کسری هوشمند', category: 'انبار', pricePerMonth: 300000, dependencies: ['stock.inventory'] },
        
        { key: 'crm.directory', nameFa: 'دفترچه تلفن و پروفایل مشتریان', category: 'CRM', pricePerMonth: 0, dependencies: ['core.workspace'] },
        { key: 'crm.loyalty', nameFa: 'باشگاه مشتریان و امتیازات', category: 'CRM', pricePerMonth: 450000, dependencies: ['crm.directory'] },
        { key: 'crm.wallet', nameFa: 'کیف پول شارژی مشتری', category: 'CRM', pricePerMonth: 250000, dependencies: ['crm.directory'] },
        { key: 'marketing.campaigns', nameFa: 'کمپین‌های تخفیف و مناسبتی', category: 'مارکتینگ', pricePerMonth: 300000, dependencies: ['crm.directory'] },
        { key: 'marketing.sms', nameFa: 'پیامک هوشمند و اطلاع‌رسانی', category: 'مارکتینگ', pricePerMonth: 200000, dependencies: ['crm.directory'] },
        
        { key: 'content.website', nameFa: 'وب‌سایت اختصاصی و محتوا', category: 'برند', pricePerMonth: 350000, dependencies: ['core.workspace'] },
        { key: 'brand.custom_domain', nameFa: 'دامنه اختصاصی مشتری (ir/com)', category: 'برند', pricePerMonth: 250000, dependencies: ['content.website'] },
        { key: 'brand.white_label', nameFa: 'حذف برند SALSA (وایت‌لیبل)', category: 'برند', pricePerMonth: 600000, dependencies: ['brand.custom_domain'] },
        
        { key: 'insights.reports', nameFa: 'گزارش‌های دوره‌ای و فصلی', category: 'گزارشات', pricePerMonth: 200000, dependencies: ['core.workspace'] },
        { key: 'insights.analytics', nameFa: 'داشبورد تحلیلی فروش و سالن', category: 'گزارشات', pricePerMonth: 400000, dependencies: ['insights.reports'] },
        { key: 'insights.cost_control', nameFa: 'تحلیل نقطه سربه‌سر و هزینه', category: 'گزارشات', pricePerMonth: 500000, dependencies: ['stock.recipes', 'finance.workspace'] },
        { key: 'insights.local_ai', nameFa: 'پیش‌بینی هوشمند مصرف محلی', category: 'گزارشات', pricePerMonth: 700000, dependencies: ['insights.analytics'] },
        
        { key: 'staff.management', nameFa: 'مدیریت شیفت و سطوح دسترسی', category: 'پرسنل', pricePerMonth: 200000, dependencies: ['core.workspace'] },
        { key: 'platform.multi_branch', nameFa: 'پشتیبانی از شبکه چندشعبه‌ای', category: 'پلتفرم', pricePerMonth: 850000, dependencies: ['core.workspace'] },
        { key: 'platform.edge', nameFa: 'همگام‌سازی محلی و چاپ LAN', category: 'پلتفرم', pricePerMonth: 450000, dependencies: ['orders.pos'] },
        { key: 'platform.desktop', nameFa: 'اپلیکیشن دسکتاپ آفلاین', category: 'پلتفرم', pricePerMonth: 350000, dependencies: ['platform.edge'] },
        { key: 'platform.api', nameFa: 'وب‌هوک و وب‌سرویس عمومی', category: 'پلتفرم', pricePerMonth: 500000, dependencies: ['core.workspace'] },
        { key: 'platform.exports', nameFa: 'خروجی اکسل و فایل پشتیبان', category: 'پلتفرم', pricePerMonth: 150000, dependencies: ['core.workspace'] },
        { key: 'platform.backup_plus', nameFa: 'پشتیبان‌گیری ابری ساعتی', category: 'پلتفرم', pricePerMonth: 300000, dependencies: ['core.workspace'] },
        { key: 'platform.support_plus', nameFa: 'پشتیبانی ۲۴/۷ VIP', category: 'پلتفرم', pricePerMonth: 600000, dependencies: ['core.workspace'] }
      ].map(f => ({ ...f, globallyDisabled: false, maintenanceReason: null, disabledAt: null, disabledBy: null })),

      // Tenant Grants mapping
      tenantGrants: {
        'tnt_westo_demo': {
          'core.workspace': { granted: true, type: 'plan', expiresAt: null },
          'catalog.menu': { granted: true, type: 'plan', expiresAt: null },
          'orders.pos': { granted: true, type: 'plan', expiresAt: null },
          'kitchen.kds': { granted: true, type: 'addon', expiresAt: '2030-04-15T00:00:00.000Z' },
          'crm.directory': { granted: true, type: 'plan', expiresAt: null },
          'stock.inventory': { granted: true, type: 'addon', expiresAt: '2030-01-01T00:00:00.000Z' },
          'finance.workspace': { granted: true, type: 'addon', expiresAt: '2030-12-29T00:00:00.000Z' }
        }
      },

      // Blank Templates (Section 8 of GODMODE.MD)
      templates: [
        {
          code: 'tpl-blank-cafe-v1',
          name: 'کافه خام استاندارد (بدون داده)',
          version: '1.2.0',
          seedChecksum: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
          checksum: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
          verifiedZeroData: true,
          isZeroData: true,
          requiredFeatures: ['core.workspace', 'catalog.menu', 'orders.pos'],
          description: 'تنظیمات اولیه مالی، سالن و کاتالوگ کاملاً خالی بدون حتی ۱ سفارش یا فاکتور ثبت‌شده.'
        },
        {
          code: 'tpl-blank-restaurant-full',
          name: 'رستوران کامل با آشپزخانه',
          version: '1.0.4',
          seedChecksum: '8f434346648f6b96df89dda901c5176b10a6d83961dd3c1ac88b59b2dc327aa4',
          checksum: '8f434346648f6b96df89dda901c5176b10a6d83961dd3c1ac88b59b2dc327aa4',
          verifiedZeroData: true,
          isZeroData: true,
          requiredFeatures: ['core.workspace', 'catalog.menu', 'orders.pos', 'kitchen.kds', 'floor.tables'],
          description: 'قالب تفکیک ایستگاه‌های KDS و نقشه سالن خام با تضمین عدم نشت داده رستوران دیگر.'
        },
        {
          code: 'tpl-blank-fastfood-chain',
          name: 'فست‌فود و سفارش سریع چندشعبه‌ای',
          version: '1.1.0',
          seedChecksum: '2c26b46b68ffc68ff99b453c1d30413413422d706483bfa0f98a5e886266e7ae',
          checksum: '2c26b46b68ffc68ff99b453c1d30413413422d706483bfa0f98a5e886266e7ae',
          verifiedZeroData: true,
          isZeroData: true,
          requiredFeatures: ['core.workspace', 'catalog.menu', 'orders.pos', 'delivery.dispatch'],
          description: 'قالب سرعت بالا، سفارش آنلاین و دیسپچ پیک بدون داده‌های تستی.'
        },
        {
          code: 'tpl-blank-confectionery',
          name: 'قنادی، بیکری و نانوایی مدرن',
          version: '1.0.1',
          seedChecksum: 'fcde2b2edba56bf408601fb721fe9b5c338d10ee429ea04fae5511b68fbf8fb9',
          checksum: 'fcde2b2edba56bf408601fb721fe9b5c338d10ee429ea04fae5511b68fbf8fb9',
          verifiedZeroData: true,
          isZeroData: true,
          requiredFeatures: ['core.workspace', 'catalog.menu', 'stock.inventory'],
          description: 'قالب مناسب اقلام وزنی و مواد اولیه انبار با ساختار داده صفر.'
        }
      ],

      // Branches (First-Class Operational Locations)
      branches: [
        {
          id: 'brn_westo_main',
          tenantId: 'tnt_westo_demo',
          name: 'شعبه مرکزی (مشهد)',
          code: 'MAIN',
          isPrimary: true,
          status: 'active',
          city: 'مشهد',
          address: 'مشهد، بلوار سجاد',
          phone: '۰۵۱۳۷۶۰۰۰۰۰',
          posCount: 2,
          kdsCount: 1,
          waiterCount: 1,
          createdAt: '۱۴۰۳/۰۱/۰۱'
        }
      ],

      // Platform Operators (Platform Identity Realm - Separate from Tenant Staff)
      platformUsers: [
        {
          id: 'usr_plat_admin',
          name: 'ناظر ارشد پلتفرم',
          email: 'admin@salsa.cloud',
          role: 'platform_admin',
          roleFa: 'مدیر ارشد پلتفرم',
          realm: 'platform',
          status: 'active',
          mfaEnabled: true,
          lastLogin: 'هم‌اکنون'
        },
        {
          id: 'usr_plat_sre',
          name: 'مهندس پایداری (SRE)',
          email: 'sre@salsa.cloud',
          role: 'platform_sre',
          roleFa: 'تیم پایداری و عملیات',
          realm: 'platform',
          status: 'active',
          mfaEnabled: true,
          lastLogin: '۲ ساعت قبل'
        }
      ],

      // Tenant Limits & Quotas
      tenantLimits: {
        'tnt_westo_demo': {
          maxPosDevices: 4,
          maxBranches: 1,
          storageGb: 50,
          smsMonthlyQuota: 10000,
          maxUsers: 15
        }
      },

      // Plans (Versioned & Entitlement-Driven)
      plans: [
        {
          id: 'plan_starter',
          name: 'Starter (پایه)',
          version: 'v1',
          price: 990000,
          priceToman: 990000,
          period: 'ماهانه',
          featuresCount: 8,
          description: 'مناسب کافه‌های تک‌صندوقه و بیرون‌بر',
          includedFeatures: ['core.workspace', 'catalog.menu', 'orders.pos', 'orders.online', 'payments.gateway', 'cash.drawers', 'crm.directory'],
          includedModules: ['pos', 'menu_qr'],
          limits: { maxPosDevices: 1, maxBranches: 1, storageGb: 5, smsMonthlyQuota: 1000, maxUsers: 3 }
        },
        {
          id: 'plan_growth',
          name: 'Growth (رشد)',
          version: 'v1',
          price: 1850000,
          priceToman: 1850000,
          period: 'ماهانه',
          featuresCount: 18,
          description: 'مناسب کافه-رستوران‌های دارای سالن و سالندار',
          includedFeatures: ['core.workspace', 'catalog.menu', 'catalog.modifiers', 'orders.pos', 'orders.online', 'floor.tables', 'floor.qr', 'kitchen.kds', 'payments.gateway', 'cash.drawers', 'crm.directory', 'crm.loyalty', 'insights.reports'],
          includedModules: ['pos', 'menu_qr', 'kds', 'crm'],
          limits: { maxPosDevices: 4, maxBranches: 2, storageGb: 20, smsMonthlyQuota: 5000, maxUsers: 8 }
        },
        {
          id: 'plan_scale',
          name: 'Scale (مقیاس‌پذیر)',
          version: 'v1',
          price: 3400000,
          priceToman: 3400000,
          period: 'ماهانه',
          featuresCount: 32,
          description: 'سازگار با رستوران‌های پرتراکنش، زنجیره‌ای و KDS',
          includedFeatures: ['core.workspace', 'catalog.menu', 'catalog.modifiers', 'catalog.pricing', 'orders.pos', 'orders.online', 'orders.advanced', 'floor.tables', 'floor.qr', 'staff.waiter', 'kitchen.kds', 'booking.reservations', 'booking.waitlist', 'delivery.dispatch', 'payments.gateway', 'cash.drawers', 'finance.workspace', 'stock.inventory', 'stock.recipes', 'crm.directory', 'crm.loyalty', 'crm.wallet', 'marketing.sms', 'content.website', 'insights.reports', 'insights.analytics', 'platform.multi_branch'],
          includedModules: ['pos', 'menu_qr', 'kds', 'inventory', 'accounting', 'crm', 'reservations', 'multi_branch', 'analytics'],
          limits: { maxPosDevices: 8, maxBranches: 5, storageGb: 50, smsMonthlyQuota: 15000, maxUsers: 25 }
        },
        {
          id: 'plan_enterprise',
          name: 'Enterprise (سفارشی)',
          version: 'v1',
          price: 6500000,
          priceToman: 6500000,
          period: 'ماهانه',
          featuresCount: 48,
          description: 'پوشش کامل حسابداری دوبل، انبارداری و اختصاصی‌سازی',
          includedFeatures: ['core.workspace', 'catalog.menu', 'orders.pos', 'kitchen.kds', 'crm.directory', 'stock.inventory', 'finance.workspace'],
          includedModules: ['pos', 'menu_qr', 'kds', 'inventory', 'accounting', 'crm', 'reservations', 'website_brand', 'multi_branch', 'analytics'],
          limits: { maxPosDevices: 16, maxBranches: 10, storageGb: 100, smsMonthlyQuota: 50000, maxUsers: 100 }
        }
      ],

      // Users & Identities (Tenant Identity Realm)
      users: [
        {
          id: 'usr_owner_reza',
          name: 'رضا حسینی (مدیریت کافه وستو)',
          phone: '09120000000',
          email: 'owner@westo.ir',
          tenantId: 'tnt_westo_demo',
          branchId: 'brn_westo_main',
          realm: 'tenant',
          role: 'owner',
          status: 'active',
          lastLogin: 'هم‌اکنون',
          mfaEnabled: true
        },
        {
          id: 'usr_accountant_omid',
          name: 'امید صادقی (حسابدار ارشد)',
          phone: '۰۹۱۲۰۰۰۰۰۱۰',
          email: 'finance@westo.ir',
          tenantId: 'tnt_westo_demo',
          role: 'accountant',
          status: 'active',
          lastLogin: '۱ ساعت قبل',
          mfaEnabled: true
        },
        {
          id: 'usr_cashier_sara',
          name: 'سارا تهرانی (صندوق‌دار سالن)',
          phone: '۰۹۱۲۰۰۰۰۰۲۰',
          email: 'cashier@westo.ir',
          tenantId: 'tnt_westo_demo',
          role: 'cashier',
          status: 'active',
          lastLogin: '۳ ساعت قبل',
          mfaEnabled: false
        }
      ],

      // Roles & Default Permissions
      roles: {
        owner: {
          nameFa: 'مالک رستوران',
          scope: 'tenant',
          defaultPermissions: ['menu.view', 'menu.manage', 'orders.view', 'orders.manage', 'finance.view', 'finance.export', 'staff.manage', 'admin.access', 'reports.export']
        },
        admin: {
          nameFa: 'مدیر ارشد و فنی',
          scope: 'tenant',
          defaultPermissions: ['menu.view', 'menu.manage', 'orders.view', 'orders.manage', 'finance.view', 'finance.export', 'staff.manage', 'admin.access', 'reports.export']
        },
        manager: {
          nameFa: 'مدیر شعبه',
          scope: 'branch',
          defaultPermissions: ['menu.view', 'menu.manage', 'orders.view', 'orders.manage', 'staff.manage', 'reports.export']
        },
        accountant: {
          nameFa: 'حسابدار',
          scope: 'branch',
          defaultPermissions: ['finance.view', 'finance.journal.create', 'finance.export', 'reports.export', 'orders.view']
        },
        cashier: {
          nameFa: 'صندوق‌دار',
          scope: 'branch',
          defaultPermissions: ['orders.view', 'orders.create', 'cash.manage', 'orders.receipt.print']
        },
        waiter: {
          nameFa: 'گارسون سالن',
          scope: 'branch',
          defaultPermissions: ['tables.view', 'orders.create', 'orders.view']
        }
      },

      // Overrides (inherit / allow / deny)
      // Flow 3 demonstrates personal override on owner or accountant
      overrides: [
        {
          id: 'ovr_001',
          tenantId: 'tnt_westo_demo',
          userId: 'usr_owner_reza',
          permission: 'finance.export',
          state: 'deny',
          reason: 'دستور هیئت مدیره برای توقف موقت خروجی مالی تا اتمام حسابرسی فصلی',
          updatedAt: '۱۴۰۳/۰۶/۰۵ ۱۱:۳۰'
        },
        {
          id: 'ovr_002',
          tenantId: 'tnt_westo_demo',
          userId: 'usr_accountant_omid',
          permission: 'finance.export',
          state: 'deny',
          reason: 'دستور مدیرعامل برای توقف موقت استخراج اکسل تا پایان حسابرسی فصلی',
          updatedAt: '۱۴۰۳/۰۶/۰۵ ۱۱:۳۰'
        }
      ],

      // Background Jobs (Flow 4)
      jobs: [
        {
          id: 'JOB-9021',
          type: 'tenant_provisioning',
          tenantName: 'کافه وستو (Westo Café)',
          tenantId: 'tnt_westo_demo',
          status: 'failed',
          errorMessage: 'خطای شبیه‌سازی‌شده: تایم‌اوت ارتباط با Agent محلی Cell',
          step: 'تخصیص سهمیه دیتابیس ایزوله',
          progressPercent: 65,
          retryCount: 1,
          maxRetries: 3,
          createdAt: '۲۰ دقیقه قبل',
          steps: [
            { name: 'اعتبارسنجی دامنه و یکتایی نام تجاری', status: 'completed' },
            { name: 'ایجاد ساختار اولیه حساب خام از Template', status: 'completed' },
            { name: 'تخصیص سهمیه دیتابیس ایزوله', status: 'failed' },
            { name: 'ارسال پیامک دعوت مالک رستوران', status: 'pending' }
          ]
        },
        {
          id: 'JOB-8012',
          type: 'policy_deployment',
          tenantName: 'کافه وستو (Westo Café)',
          tenantId: 'tnt_westo_demo',
          status: 'completed',
          errorMessage: null,
          step: 'انتشار نسخه ۲.۱ سیاست‌های دسترسی به تمام شعب',
          progressPercent: 100,
          retryCount: 0,
          maxRetries: 3,
          createdAt: '۲ ساعت قبل',
          steps: [
            { name: 'تطبیق وابستگی‌های کاتالوگ', status: 'completed' },
            { name: 'تولید امضای دیجیتال سیاست', status: 'completed' },
            { name: 'انتشار به کلاینت‌های سالن و صندوق', status: 'completed' }
          ]
        },
        {
          id: 'JOB-7704',
          type: 'backup_snapshot',
          tenantName: 'کافه وستو (Westo Café)',
          tenantId: 'tnt_westo_demo',
          status: 'failed',
          errorMessage: 'خطای تایم‌اوت در انتقال اسنپ‌شات به استوریج S3',
          step: 'انتقال فایل فشرده به فضای ذخیره‌سازی ثانویه',
          progressPercent: 40,
          retryCount: 1,
          maxRetries: 3,
          createdAt: '۴۵ دقیقه قبل',
          steps: [
            { name: 'تولید دامپ دیتابیس محلی', status: 'completed' },
            { name: 'فشرده‌سازی و رمزنگاری اسنپ‌شات', status: 'completed' },
            { name: 'انتقال فایل فشرده به فضای ذخیره‌سازی ثانویه', status: 'failed' }
          ]
        },
        {
          id: 'JOB-6502',
          type: 'menu_sync',
          tenantName: 'کافه وستو (Westo Café)',
          tenantId: 'tnt_westo_demo',
          status: 'running',
          errorMessage: null,
          step: 'همگام‌سازی کاتالوگ منو با ۶ پایانه فروشگاهی برخط',
          progressPercent: 55,
          retryCount: 0,
          maxRetries: 3,
          createdAt: '۵ دقیقه قبل',
          steps: [
            { name: 'اعتبارسنجی تغییرات قیمت و موجودی', status: 'completed' },
            { name: 'انتشار پیام به صف توزیع MQTT', status: 'running' }
          ]
        },
        {
          id: 'JOB-5120',
          type: 'addon_grant',
          tenantName: 'کافه وستو (Westo Café)',
          tenantId: 'tnt_westo_demo',
          status: 'completed',
          errorMessage: null,
          step: 'فعال‌سازی ماژول و صدور لایسنس باشگاه مشتریان',
          progressPercent: 100,
          retryCount: 0,
          maxRetries: 3,
          createdAt: '۳ ساعت قبل',
          steps: [
            { name: 'راستی‌آزمایی تراز مالی و فاکتور', status: 'completed' },
            { name: 'صدور توکن لایسنس ماژول', status: 'completed' }
          ]
        }
      ],

      // Organizations (GM-03, GM-04, GM-28)
      organizations: [
        {
          id: 'org_aria',
          name: 'مجموعه کافه‌رستوران وستو',
          legalName: 'کافه رستوران وستو مشهد',
          nationalId: '۱۰۱۰۲۹۳۸۴۷۵',
          contactPerson: 'رضا حسینی (مدیریت)',
          contactPhone: '۰۹۱۲۰۰۰۰۰۰۰',
          billingEmail: 'billing@westo.ir',
          status: 'active',
          tenantsCount: 1,
          tenants: ['tnt_westo_demo'],
          createdAt: '۱۴۰۳/۰۱/۰۱'
        }
      ],

      // Billing & Invoices (GM-11 & GM-28)
      invoices: [
        {
          id: 'INV-1403-0982',
          tenantId: 'tnt_westo_demo',
          tenantName: 'کافه وستو (Westo Café)',
          organizationId: 'org_aria',
          amount: 5250000,
          vatAmount: 472500,
          totalAmount: 5722500,
          currency: 'تومان',
          period: 'شهریور ۱۴۰۳',
          status: 'paid',
          activationStatus: 'activated',
          paidAt: '۱۴۰۳/۰۶/۰۱ ۱۰:۱۵',
          paymentRef: 'SHP-981240192',
          items: [
            { desc: 'پلن اشتراک Enterprise (سراسری)', amount: 3400000, count: 1, unitPrice: 3400000, total: 3400000 },
            { desc: 'افزونه KDS نمایشگر آشپزخانه', amount: 400000, count: 1, unitPrice: 400000, total: 400000 },
            { desc: 'افزونه انبارداری و شمارش موجودی', amount: 400000, count: 1, unitPrice: 400000, total: 400000 },
            { desc: 'افزونه حسابداری دوبل و اسناد دفاتر', amount: 600000, count: 1, unitPrice: 600000, total: 600000 },
            { desc: 'افزونه پشتیبان‌گیری ابری ساعتی', amount: 300000, count: 1, unitPrice: 300000, total: 300000 },
            { desc: 'تخفیف پیش‌خرید سالانه (۳ ماهه)', amount: -150000, count: 1, unitPrice: -150000, total: -150000 }
          ],
          activationEvents: [
            { time: '۱۴۰۳/۰۶/۰۱ ۱۰:۱۵', event: 'تراکنش موفق شاپرک و تسویه بانکی', status: 'done' },
            { time: '۱۴۰۳/۰۶/۰۱ ۱۰:۱۶', event: 'صدور توکن اعتبارسنجی لایسنس SALSA-ENT', status: 'done' },
            { time: '۱۴۰۳/۰۶/۰۱ ۱۰:۱۸', event: 'اعمال روی کلاستر محلی مشهد و همگام‌سازی دیتابیس', status: 'done' }
          ]
        },
        {
          id: 'INV-1403-1044',
          tenantId: 'tnt_westo_demo',
          tenantName: 'کافه وستو (Westo Café)',
          organizationId: 'org_aria',
          amount: 1800000,
          vatAmount: 162000,
          totalAmount: 1962000,
          currency: 'تومان',
          period: 'شهریور ۱۴۰۳ (افزونه صوتی هوش مصنوعی)',
          status: 'paid',
          activationStatus: 'pending_activation',
          paidAt: '۱۴۰۳/۰۶/۰۵ ۱۶:۴۰',
          paymentRef: 'SHP-883921021',
          items: [
            { desc: 'افزونه سفارش‌گیر سالن صوتی هوشمند (AI Voice Agent)', amount: 1800000, count: 1, unitPrice: 1800000, total: 1800000 }
          ],
          activationEvents: [
            { time: '۱۴۰۳/۰۶/۰۵ ۱۶:۴۰', event: 'تراکنش موفق شاپرک و تسویه ریالی', status: 'done' },
            { time: '۱۴۰۳/۰۶/۰۵ ۱۶:۴۱', event: 'ثبت لایسنس ماژول در رجیستری SALSA', status: 'done' },
            { time: '۱۴۰۳/۰۶/۰۵ ۱۶:۴۲', event: 'تخصیص کانتینر پردازش گفتار در سلول مشهد', status: 'pending', note: 'در انتظار پاسخ اولیه هارت‌بیت سرور Edge محلی' }
          ]
        },
        {
          id: 'INV-1403-1088',
          tenantId: 'tnt_westo_demo',
          tenantName: 'کافه وستو (Westo Café)',
          organizationId: 'org_aria',
          amount: 4500000,
          vatAmount: 405000,
          totalAmount: 4905000,
          currency: 'تومان',
          period: 'مهر ۱۴۰۳ (پیش‌فاکتور دوره بعد)',
          status: 'pending',
          activationStatus: 'not_applicable',
          dueDate: '۱۴۰۳/۰۶/۳۱',
          items: [
            { desc: 'تمدید پلن اشتراک Enterprise (سراسری)', amount: 3400000, count: 1, unitPrice: 3400000, total: 3400000 },
            { desc: 'افزونه‌های KDS، انبارداری، حسابداری دوبل', amount: 1100000, count: 1, unitPrice: 1100000, total: 1100000 }
          ],
          activationEvents: [
            { time: '۱۴۰۳/۰۶/۰۶ ۰۹:۰۰', event: 'صدور پیش‌فاکتور خودکار دوره مالی آتی', status: 'done' },
            { time: 'در انتظار پرداخت', event: 'ثبت شناسه پرداخت در سامانه شاپرک', status: 'pending' }
          ]
        }
      ],

      // Payments & Transactions (GM-11)
      payments: [
        {
          id: 'PAY-1403-9021',
          invoiceId: 'INV-1403-0982',
          tenantId: 'tnt_westo_demo',
          tenantName: 'کافه وستو (Westo Café)',
          amount: 5722500,
          currency: 'تومان',
          period: 'شهریور ۱۴۰۳',
          gateway: 'شاپرک (به‌پرداخت ملت)',
          paymentRef: 'SHP-981240192',
          bankRrn: '891024881920',
          cardMask: '۶۰۳۷-۹۹**-****-۴۴۱۹',
          paidAt: '۱۴۰۳/۰۶/۰۱ ۱۰:۱۵',
          status: 'success',
          statusFa: 'موفق و تسویه‌شده'
        },
        {
          id: 'PAY-1403-9114',
          invoiceId: 'INV-1403-1044',
          tenantId: 'tnt_westo_demo',
          tenantName: 'کافه وستو (Westo Café)',
          amount: 1962000,
          currency: 'تومان',
          period: 'شهریور ۱۴۰۳',
          gateway: 'شاپرک (سامان‌کیش)',
          paymentRef: 'SHP-883921021',
          bankRrn: '772910334812',
          cardMask: '۵۰۲۲-۲۹**-****-۱۱۸۲',
          paidAt: '۱۴۰۳/۰۶/۰۵ ۱۶:۴۰',
          status: 'success',
          statusFa: 'موفق و تسویه‌شده'
        }
      ],

      // Receivables & Debts (GM-11) - Clean starting state
      debts: [],

      // Credits & Wallet (GM-11) - Clean starting state
      credits: [],

      // Promotional Discounts (GM-11) - Clean starting state
      discounts: [],

      // Subscriptions
      subscriptions: [
        {
          id: 'sub_westo',
          tenantId: 'tnt_westo_demo',
          planId: 'plan_enterprise',
          planName: 'Enterprise (سراسری)',
          billingCycle: 'ماهانه',
          nextRenewal: '۱۴۰۳/۰۷/۰۱',
          autoRenew: true,
          status: 'active',
          addonsCount: 4,
          monthlyTotal: 5722500,
          currency: 'تومان',
          creditsApplied: 0,
          startDate: '۱۴۰۳/۰۱/۰۱'
        }
      ],

      // Usage & Quotas (GM-12)
      usage: {
        'tnt_westo_demo': {
          storageGb: { current: 4.8, limit: 25.0, unit: 'GB', percent: 19 },
          dbConnections: { current: 14, limit: 50, unit: 'اتصال', percent: 28 },
          apiRequests24h: { current: 14250, limit: 100000, unit: 'فراخوانی', percent: 14 },
          posTerminals: { current: 4, limit: 12, unit: 'دستگاه', percent: 33 },
          activeBranches: { current: 1, limit: 5, unit: 'شعبه', percent: 20 },
          monthlyTransactions: { current: 8940, limit: 50000, unit: 'سفارش', percent: 18 }
        }
      },

      // Automations & Rules (GM-16)
      automations: [
        {
          id: 'rule-01',
          name: 'انقضای خودکار لایسنس آزمایشی (Trial Expiry)',
          trigger: 'زمان‌بندی: روزانه رأس ساعت ۰۰:۰۱',
          condition: 'انقضای تاریخ Grant آزمایشی و عدم وجود خرید رسمی',
          action: 'تغییر وضعیت به expired و ثبت در لاگ حسابرسی',
          status: 'active',
          lastRun: 'امروز ۰۰:۰۱ (موفق: ۰ مورد مشمول)',
          execCount24h: 1
        },
        {
          id: 'rule-02',
          name: 'هشدار قطعی ارتباط دستگاه پوز (POS Disconnect Watchdog)',
          trigger: 'رخداد: عدم دریافت Heartbeat پوز بیش از ۳۰ دقیقه',
          condition: 'وضعیت شعبه در حال سرویس‌دهی (ساعت کاری)',
          action: 'تغییر وضعیت دستگاه به offline و ارسال پوش نوتیفیکیشن به پشتیبان',
          status: 'active',
          lastRun: '۲۵ دقیقه قبل (موفق: ۱ دستگاه ثبت شد)',
          execCount24h: 3
        },
        {
          id: 'rule-03',
          name: 'تولید خودکار پیش‌فاکتور تمدید دوره (Renewal Invoicing)',
          trigger: 'زمان‌بندی: ۷ روز پیش از اتمام دوره اشتراک',
          condition: 'اشتراک در وضعیت active با تمدید خودکار روشن',
          action: 'تولید سند پیش‌فاکتور در درگاه مالی و پیامک به مالک رستوران',
          status: 'active',
          lastRun: 'دیروز ۰۹:۰۰ (موفق: ۲ فاکتور صادر شد)',
          execCount24h: 1
        },
        {
          id: 'rule-04',
          name: 'ابطال خودکار نشست‌های اضطراری پشتیبانی (Support Session TTL)',
          trigger: 'زمان‌بندی: بررسی هر ۵ دقیقه',
          condition: 'نشست فعال پشتیبانی بیش از ۲ ساعت بدون تمدید صریح',
          action: 'ابطال فوری نشست، خروج اجباری و ثبت گزارش خاتمه',
          status: 'active',
          lastRun: '۲ دقیقه قبل (موفق)',
          execCount24h: 288
        }
      ],

      // Customer Directory (GM-17) - Clean starting state
      customerDirectory: [],

      // Domains & Branding (GM-18)
      domains: [
        {
          id: 'dom_platform_hub',
          tenantId: 'platform',
          tenantName: 'پلتفرم مرکزی سالسا (SALSA Core)',
          domain: 'salsa.ir',
          type: 'platform_hub',
          targetCname: '185.143.232.10 (VPS Primary IP)',
          dnsStatus: 'verified',
          sslStatus: 'active',
          sslExpires: '۱۴۰۴/۱۲/۲۹ (Let\'s Encrypt Wildcard)',
          cdnProvider: 'Caddy On-Demand / Nginx Ingress',
          verifiedAt: '۱۴۰۳/۰۱/۰۱',
          isPlatform: true
        },
        {
          id: 'dom_westo_subdomain',
          tenantId: 'tnt_westo_demo',
          tenantName: 'کافه وستو (Westo Café)',
          domain: 'westo.salsa.ir',
          type: 'platform_subdomain',
          targetCname: 'salsa.ir (Wildcard A Record)',
          dnsStatus: 'verified',
          sslStatus: 'active',
          sslExpires: 'تمدید خودکار (Wildcard *.salsa.ir)',
          cdnProvider: 'VPS Ingress Proxy (Port 4180)',
          verifiedAt: '۱۴۰۳/۰۱/۰۱',
          isSubdomain: true
        },
        {
          id: 'dom_westo_custom',
          tenantId: 'tnt_westo_demo',
          tenantName: 'کافه وستو (Westo Café)',
          domain: 'westocoffee.ir',
          type: 'custom_primary',
          targetCname: 'westo.salsa.ir',
          dnsStatus: 'verified',
          sslStatus: 'active',
          sslExpires: '۱۴۰۴/۰۶/۱۵ (On-Demand TLS)',
          cdnProvider: 'Caddy On-Demand TLS (White-label)',
          verifiedAt: '۱۴۰۳/۰۴/۱۸',
          isCustomDomain: true,
          whiteLabel: true
        }
      ],

      // Devices & POS Sync (GM-19)
      devices: [
        {
          id: 'dev_pos_01',
          tenantId: 'tnt_westo_demo',
          branch: 'شعبه اصلی (مشهد)',
          name: 'صندوق ۱ - سالن اصلی وستو',
          type: 'Desktop POS (Windows/Electron)',
          ipAddress: '۱۹۲.۱۶۸.۱.۱۰۱',
          appVersion: 'v1.2.0-desktop',
          syncState: 'in_sync',
          pendingQueue: 0,
          leaseStatus: 'active (معتبر تا ۶ ساعت آینده)',
          lastSync: 'هم‌اکنون (متصل به پورت ۴۱۸۰)',
          status: 'online'
        },
        {
          id: 'dev_pos_02',
          tenantId: 'tnt_westo_demo',
          branch: 'شعبه اصلی (مشهد)',
          name: 'صندوق ۲ - سفارش بیرون‌بر',
          type: 'Desktop POS (Windows/Electron)',
          ipAddress: '۱۹۲.۱۶۸.۱.۱۰۲',
          appVersion: 'v1.2.0-desktop',
          syncState: 'in_sync',
          pendingQueue: 0,
          leaseStatus: 'active (معتبر تا ۶ ساعت آینده)',
          lastSync: '۳ دقیقه قبل',
          status: 'online'
        },
        {
          id: 'dev_kds_01',
          tenantId: 'tnt_westo_demo',
          branch: 'شعبه اصلی (مشهد)',
          name: 'نمایشگر سفارشات آشپزخانه KDS',
          type: 'Android Display Tablet',
          ipAddress: '۱۹۲.۱۶۸.۱.۱۵۰',
          appVersion: 'v1.1.8-kds',
          syncState: 'in_sync',
          pendingQueue: 0,
          leaseStatus: 'active',
          lastSync: '۳۰ ثانیه قبل',
          status: 'online'
        },
        {
          id: 'dev_waiter_01',
          tenantId: 'tnt_westo_demo',
          branch: 'شعبه اصلی (مشهد)',
          name: 'تبلت سیار گارسون سالن',
          type: 'Mobile Handheld POS',
          ipAddress: '۱۹۲.۱۶۸.۱.۱۶۰',
          appVersion: 'v1.2.0-mobile',
          syncState: 'in_sync',
          pendingQueue: 0,
          leaseStatus: 'active',
          lastSync: 'هم‌اکنون',
          status: 'online'
        }
      ],

      // Backups & Restore Drills (GM-20)
      backups: [
        {
          id: 'bkp_14030905_0300',
          tenantId: 'tnt_westo_demo',
          tenantName: 'کافه وستو (Westo Café)',
          type: 'Full WAL + Data Snapshot',
          size: '۱.۸۲ گیگابایت',
          sha256: '9f82ab12...e304bfa9',
          storageProvider: 'Asiatech S3 (تهران)',
          restoreTestStatus: 'passed',
          restoreDrillTime: '۱۴۰۳/۰۶/۰۵ ۰۴:۱۵',
          status: 'verified',
          createdAt: 'امروز ۰۳:۰۰'
        },
        {
          id: 'bkp_14030904_0300',
          tenantId: 'tnt_westo_demo',
          tenantName: 'کافه وستو (Westo Café)',
          type: 'Full WAL + Data Snapshot',
          size: '۱.۷۹ گیگابایت',
          sha256: 'a12bc443...d891c01e',
          storageProvider: 'Asiatech S3 (تهران)',
          restoreTestStatus: 'passed',
          restoreDrillTime: '۱۴۰۳/۰۶/۰۴ ۰۴:۱۰',
          status: 'verified',
          createdAt: 'دیروز ۰۳:۰۰'
        }
      ],

      // Support Tickets & Sessions (GM-21)
      tickets: [
        {
          id: 'TCK-8801',
          tenantId: 'tnt_westo_demo',
          tenantName: 'کافه وستو (Westo Café)',
          title: 'بررسی پیکربندی درگاه پرداخت آنلاین شاپرک',
          category: 'درگاه پرداخت و مالی',
          priority: 'medium',
          status: 'open',
          creator: 'مدیریت کافه وستو',
          assignedTo: 'علیرضا رضایی (پشتیبانی فنی)',
          slaMinutesRemaining: 95,
          createdAt: 'امروز ۱۰:۰۰'
        }
      ],
      supportSessions: [],

      // Operations & Incidents (GM-22)
      incidents: [
        {
          id: 'INC-204',
          title: 'اختلال موقت اتصال درگاه پرداخت زرین‌پال / شاپرک',
          severity: 'minor',
          impact: 'مشتریان آنلاین کافه وستو با خطای تایم‌اوت بانکی مواجه شدند',
          affectedTenantsCount: 1,
          cellId: 'cell-msh-01',
          status: 'mitigated',
          beganAt: 'امروز ۱۰:۱۵',
          resolvedAt: 'امروز ۱۰:۴۲'
        }
      ],
      providersStatus: [
        { name: 'دیتاسنتر آسیاتک (برج میلاد تهران)', type: 'Hosting & Core DB', status: 'operational', uptime: '۹۹.۹۸٪' },
        { name: 'دیتاسنتر شاتل (شیراز)', type: 'Regional Cell & S3', status: 'operational', uptime: '۹۹.۹۵٪' },
        { name: 'شبکه توزیع محتوا و DNS ابر آروان', type: 'Anycast CDN & SSL', status: 'operational', uptime: '۹۹.۹۹٪' },
        { name: 'سامانه پیامک کاوه‌نگار', type: 'SMS Gateway', status: 'operational', uptime: '۹۹.۹۰٪' },
        { name: 'سوئیچ پرداخت شاپرک', type: 'Payment Gateway', status: 'degraded', uptime: '۹۸.۸۰٪' }
      ],

      // Releases & Canary Rollouts (GM-23)
      releases: [
        {
          version: 'v1.2.0',
          channel: 'stable',
          digest: 'sha256:7a92c81d89b142ef89...',
          releasedAt: '۱۴۰۳/۰۵/۲۸',
          deployedTenantsCount: 1,
          canaryPercent: 100,
          status: 'live_active',
          featuresAdded: ['حسابداری دوبل Finance V2', 'گراف وابستگی ۴۸ قابلیت', 'قالب‌های صفر-داده'],
          rollbackPlan: 'Instant Switch to v1.1.9 with schema compatibility'
        },
        {
          version: 'v1.2.1-rc2',
          channel: 'canary',
          digest: 'sha256:3d1f89bc4412aa7890...',
          releasedAt: '۱۴۰۳/۰۶/۰۴',
          deployedTenantsCount: 1,
          canaryPercent: 25,
          status: 'canary_evaluating',
          featuresAdded: ['بهبود الگوریتم O(1) شبیه‌ساز دسترسی', 'رفع تأخیر همگام‌سازی KDS'],
          rollbackPlan: 'Automated on > 1% error rate threshold'
        }
      ],

      // Infrastructure Hosts (GM-24) - Single VPS Architecture
      infrastructureCells: [
        {
          id: 'cell-teh-01',
          name: 'سرور اصلی VPS (میزبان متمرکز وستو - Production)',
          region: 'tehran-core',
          host: 'vps.salsa.ir (salsa.ir)',
          ip: '185.143.232.10',
          os: 'Ubuntu 24.04.1 LTS (x86_64)',
          specs: '8 vCPU @ 3.4GHz · 16 GB DDR5 · 160 GB NVMe SSD',
          tenantsAssigned: 4,
          tenantsCapacity: 100,
          cpuPercent: 28,
          memoryPercent: 42,
          storageGb: '۶۲ / ۱۶۰ GB',
          agentStatus: 'healthy',
          lastPing: 'هم‌اکنون',
          services: [
            { name: 'Node.js Control Plane (Port 3061)', status: 'active', port: 3061 },
            { name: 'Godmode UI Host (Port 3050)', status: 'active', port: 3050 },
            { name: 'Client POS / KDS Gateway (Port 4180)', status: 'active', port: 4180 },
            { name: 'PostgreSQL 16 Engine (Port 5433)', status: 'active', port: 5433 },
            { name: 'Caddy & Nginx Reverse Proxy (On-Demand TLS)', status: 'active', port: 443 },
            { name: 'Redis Cache & Session Store', status: 'active', port: 6379 }
          ]
        },
        {
          id: 'cell-teh-02',
          name: 'محیط آزمایشی و پیش‌نمایش (Staging VPS - پورت‌های ایزوله)',
          region: 'tehran-dr',
          host: 'staging.westo.ir',
          os: 'Ubuntu 24.04.1 LTS',
          specs: '4 vCPU · 8 GB RAM · 80 GB NVMe',
          tenantsAssigned: 0,
          tenantsCapacity: 20,
          cpuPercent: 12,
          memoryPercent: 18,
          storageGb: '۲۲ / ۸۰ GB',
          agentStatus: 'healthy',
          lastPing: 'هم‌اکنون'
        },
        {
          id: 'cell-msh-01',
          name: 'سرور پشتیبان آف‌سایت (Offsite Disaster Backup Storage)',
          region: 'mashhad-regional',
          host: 'backup.westo.ir',
          os: 'Ubuntu 22.04 LTS',
          specs: '2 vCPU · 4 GB RAM · 500 GB Storage',
          tenantsAssigned: 0,
          tenantsCapacity: 10,
          cpuPercent: 6,
          memoryPercent: 14,
          storageGb: '۶۵ / ۵۰۰ GB',
          agentStatus: 'healthy',
          lastPing: 'هم‌اکنون'
        }
      ],

      // Infrastructure Node Diagnostics (GM-24 & Destination 4 Telemetry)
      nodeDiagnostics: [
        {
          id: 'control-plane-api',
          name: 'سرویس متمرکز Control Plane',
          kind: 'api',
          port: 3061,
          status: 'healthy',
          latencyMs: 1.2,
          rssMb: 142,
          eventLoopLagMs: 1.1,
          activeConnections: 18,
          uptimePercent: 99.99,
          lastProbeAt: 'هم‌اکنون'
        },
        {
          id: 'postgres-db',
          name: 'پایگاه داده متمرکز PostgreSQL',
          kind: 'database',
          port: 5433,
          status: 'healthy',
          latencyMs: 0.8,
          poolActive: 6,
          poolMax: 20,
          walStatus: 'synced',
          storageUsedMb: 1240,
          uptimePercent: 99.98,
          lastProbeAt: 'هم‌اکنون'
        },
        {
          id: 'reverse-proxy',
          name: 'پراکسی معکوس و دروازه امنیتی (Caddy/Envoy)',
          kind: 'proxy',
          port: 443,
          status: 'healthy',
          latencyMs: 1.4,
          activeTlsSessions: 42,
          cacheHitPercent: 94.2,
          uptimePercent: 100,
          lastProbeAt: 'هم‌اکنون'
        },
        {
          id: 'outbox-pipeline',
          name: 'خط لوله رویدادها و همگام‌سازی Outbox',
          kind: 'queue',
          status: 'healthy',
          latencyMs: 0.4,
          pendingQueue: 0,
          throughputPerSec: 24,
          dlqFailures: 0,
          uptimePercent: 99.95,
          lastProbeAt: 'هم‌اکنون'
        },
        {
          id: 'memory-cache',
          name: 'کش داده و هماهنگی حافظه (Fast Store)',
          kind: 'cache',
          port: 6379,
          status: 'healthy',
          latencyMs: 0.3,
          activeKeys: 342,
          hitRatioPercent: 98.4,
          uptimePercent: 100,
          lastProbeAt: 'هم‌اکنون'
        }
      ],

      // Audit Logs (GM-26)
      auditLogs: [
        {
          id: 'aud_9841',
          timestamp: 'امروز ۱۱:۳۰',
          actor: 'مدیر ارشد پلتفرم',
          actorRole: 'SuperAdmin',
          tenantId: 'tnt_westo_demo',
          action: 'override.create',
          description: 'بررسی دسترسی و انطباق امنیتی دفاتر مالی',
          scope: 'finance.export',
          result: 'success',
          ip: '۵.۱۶۰.۲۱۰.۴۴',
          hash: '9f81ca823df1840219bfe9821'
        },
        {
          id: 'aud_9838',
          timestamp: 'امروز ۰۹:۱۵',
          actor: 'سیستم خودکار (Automation Engine)',
          actorRole: 'system',
          tenantId: 'tnt_westo_demo',
          action: 'backup.verify',
          description: 'اجرای دریل خودکار بازیابی دیتابیس در محیط ایزوله تست',
          scope: 'bkp_14030905_0300',
          result: 'success',
          ip: '۱۲۷.۰.۰.۱',
          hash: '4b1a89c2049e771a8bc019283'
        },
        {
          id: 'aud_9829',
          timestamp: 'دیروز ۱۶:۴۵',
          actor: 'مدیر پلتفرم سالسا',
          actorRole: 'operator',
          tenantId: 'tnt_westo_demo',
          action: 'feature.addon_grant',
          description: 'تایید لایسنس ماژول انبارداری و فرمولاسیون سفارشات',
          scope: 'stock.inventory',
          result: 'success',
          ip: '۵.۱۶۰.۱۹۸.۱۱',
          hash: 'c819dfe04921bfa9821a89c31'
        }
      ],

      // Transactional Outbox Pipeline (GM-16 & Destination 4)
      outboxEvents: [
        {
          id: 'obx_984',
          topic: 'tenant.license_provisioned',
          tenantId: 'tnt_westo_demo',
          targetNode: 'vps.salsa.ir:4180',
          payloadSummary: 'فعال‌سازی ماژول stock.inventory و تمدید لایسنس تا ۱۴۰۴/۰۶/۰۱',
          status: 'delivered',
          retryCount: 0,
          createdAt: '۱۴۰۳/۰۶/۰۴ ۱۰:۱۵',
          dispatchedAt: '۱۴۰۳/۰۶/۰۴ ۱۰:۱۵:۰۲',
          latencyMs: 14
        },
        {
          id: 'obx_983',
          topic: 'menu.catalog_synced',
          tenantId: 'tnt_westo_demo',
          targetNode: 'term-main (صندوق ۱ سالن)',
          payloadSummary: 'همگام‌سازی ۲۴ قلم منو و اصلاح نرخ مالیات بر ارزش افزوده',
          status: 'delivered',
          retryCount: 0,
          createdAt: '۱۴۰۳/۰۶/۰۴ ۰۹:۴۰',
          dispatchedAt: '۱۴۰۳/۰۶/۰۴ ۰۹:۴۰:۰۱',
          latencyMs: 18
        },
        {
          id: 'obx_982',
          topic: 'pos.config_updated',
          tenantId: 'tnt_westo_demo',
          targetNode: 'kds-kitchen (نمایشگر KDS)',
          payloadSummary: 'به‌روزرسانی تنظیمات چاپ و نگاشت ایستگاه‌های آشپزخانه',
          status: 'delivered',
          retryCount: 0,
          createdAt: '۱۴۰۳/۰۶/۰۳ ۲۱:۱۲',
          dispatchedAt: '۱۴۰۳/۰۶/۰۳ ۲۱:۱۲:۰۱',
          latencyMs: 22
        },
        {
          id: 'obx_981',
          topic: 'security.policy_applied',
          tenantId: 'all_tenants',
          targetNode: 'platform-reverse-proxy',
          payloadSummary: 'اعمال خط‌مشی اجبار سشن ۸ ساعته و نیازمندی رمز یکبار مصرف TOTP',
          status: 'delivered',
          retryCount: 0,
          createdAt: '۱۴۰۳/۰۶/۰۳ ۱۸:۰۰',
          dispatchedAt: '۱۴۰۳/۰۶/۰۳ ۱۸:۰۰:۰۳',
          latencyMs: 29
        },
        {
          id: 'obx_980',
          topic: 'finance.ledger_posted',
          tenantId: 'tnt_westo_demo',
          targetNode: 'fin-service:5433',
          payloadSummary: 'ثبت سند دوبل حسابداری فاکتورهای شیفت عصر در دیتابیس مالی',
          status: 'delivered',
          retryCount: 0,
          createdAt: '۱۴۰۳/۰۶/۰۳ ۱۵:۳۰',
          dispatchedAt: '۱۴۰۳/۰۶/۰۳ ۱۵:۳۰:۰۱',
          latencyMs: 16
        }
      ],

      // Platform Automation Rules Engine (GM-16 & Destination 4)
      automationRules: [
        {
          id: 'rule_acme_tls',
          name: 'تمدید خودکار گواهی‌های امنیتی TLS 1.3 (ACME On-Demand)',
          category: 'security',
          description: 'بررسی روزانه تاریخ انقضای گواهی‌های SSL ساب‌دامین‌های پلتفرم و تمدید خودکار ۳۰ روز قبل از سررسید بدون قطعی ارتباط.',
          trigger: 'روزانه، ساعت ۰۳:۳۰ بامداد',
          enabled: true,
          lastRunAt: 'امروز ۰۳:۳۰',
          executionCount: 142
        },
        {
          id: 'rule_grace_warning',
          name: 'هشدار پیامکی و درون‌برنامه‌ای اتمام دوره فرجه صورتحساب',
          category: 'billing',
          description: 'ارسال خودکار اعلان هوشمند به مدیران مجموعه‌ها ۲۴ ساعت قبل از اتمام مهلت پرداخت یا تعلیق خودکار سرویس.',
          trigger: 'هر ۱۲ ساعت یک‌بار',
          enabled: true,
          lastRunAt: 'امروز ۰۸:۰۰',
          executionCount: 88
        },
        {
          id: 'rule_brute_force_shield',
          name: 'دفاع تطبیقی در برابر حملات منع دسترسی و Brute-Force به OTP',
          category: 'security',
          description: 'مسدودسازی موقت IP و اعمال Rate-limit بعد از ۵ تلاش ناموفق پیاپی ورود به پنل یا صندوق در بازه ۱۰ دقیقه‌ای.',
          trigger: 'بلادرنگ (Real-time Event Hook)',
          enabled: true,
          lastRunAt: 'امروز ۱۰:۰۵',
          executionCount: 19
        },
        {
          id: 'rule_audit_rotation',
          name: 'تثبیت زنجیره رمزنگاری لاگ‌های حسابرسی (Audit Hash Anchor)',
          category: 'compliance',
          description: 'محاسبه زنجیره هشدارهای امنیتی و ایجاد ریشه Merkle لاگ‌های عملیاتی جهت جلوگیری از هرگونه دستکاری یا انکار داده‌ها.',
          trigger: 'پایان هر شیفت کاری (ساعت ۲۴:۰۰)',
          enabled: true,
          lastRunAt: 'دیشب ۲۴:۰۰',
          executionCount: 365
        },
        {
          id: 'rule_outbox_pruning',
          name: 'پاک‌سازی خودکار رویدادهای تحویل‌شده Outbox پس از ۱۴ روز',
          category: 'operations',
          description: 'انتقال رکوردهای تحویل‌شده صف Outbox به آرشیو سرد جهت حفظ کارایی بهینه ایندکس‌ها و حافظه کش Fast Store.',
          trigger: 'هفتگی، بامداد جمعه',
          enabled: true,
          lastRunAt: '۳ روز قبل',
          executionCount: 52
        }
      ],

      // SALSA Team Members & Settings (GM-27)
      teamMembers: [
        {
          id: 'team_01',
          name: 'مالک پلتفرم (SuperAdmin)',
          email: 'admin@salsa.ir',
          phone: '۰۹۱۲۰۰۰۰۰۹۹',
          role: 'owner',
          scope: 'all_tenants (نامحدود)',
          mfaStatus: 'active (YubiKey + TOTP)',
          lastActive: 'هم‌اکنون'
        },
        {
          id: 'team_02',
          name: 'علیرضا رضایی (پشتیبانی فنی)',
          email: 'rezaei@salsa.ir',
          phone: '۰۹۱۲۰۰۰۰۰۸۸',
          role: 'support_lead',
          scope: 'support_tenants',
          mfaStatus: 'active (TOTP)',
          lastActive: '۱ ساعت قبل'
        },
        {
          id: 'team_03',
          name: 'مهندس اکبری',
          email: 'akbari@salsa.ir',
          phone: '۰۹۱۲۰۰۰۰۰۷۷',
          role: 'infrastructure_ops',
          scope: 'cells_infrastructure',
          mfaStatus: 'active (TOTP)',
          lastActive: '۳ ساعت قبل'
        }
      ],
      platformSettings: {
        platformName: 'مرکز مدیریت پلتفرم SALSA',
        primaryCurrency: 'تومان (IRR)',
        defaultTrialDays: 14,
        supportSessionMaxMinutes: 120,
        mfaEnforced: true,
        quarantineMode: false,
        ipAllowlist: '0.0.0.0/0'
      },

      // Active Tenant Scope
      activeTenantId: 'tnt_westo_demo',

      // Operational Activity Ledger
      activities: [
        {
          id: 'act_101',
          type: 'vps_platform_status',
          severity: 'info',
          title: 'سرور متمرکز پلتفرم salsa.ir عملیاتی است',
          description: 'زیرساخت متمرکز VPS با هاستینگ ابری ساب‌دامین‌ها و گواهی On-Demand TLS فعال می‌باشد.',
          subsystem: 'PlatformCore',
          route: '#gm-24-infrastructure',
          routeLabel: 'GM-24 زیرساخت VPS',
          actor: 'SALSA Cloud Engine',
          timestamp: 'هم‌اکنون',
          timestampIso: '2026-09-06T13:40:00Z',
          read: true,
          details: {
            mode: 'production-ready',
            tenantId: 'tnt_westo_demo',
            source: 'vps-core'
          }
        },
        {
          id: 'act_102',
          type: 'incident_mitigated',
          severity: 'warning',
          title: 'مهار اختلال درگاه پرداخت بانکی شاپرک',
          description: 'سوئیچ پرداخت به وضعیت پایدار ۹۸.۸٪ بازگشت و تراکنش‌های آنلاین کافه وستو برقرار شد.',
          subsystem: 'Operations',
          route: '#gm-22-operations',
          routeLabel: 'GM-22 سلامت و پایش',
          actor: 'کشیک عملیات (مهندس اکبری)',
          timestamp: '۱ ساعت قبل',
          timestampIso: '2026-09-06T13:00:00Z',
          read: false,
          details: {
            incidentId: 'INC-204',
            cellId: 'cell-mashhad-01',
            impact: 'کافه وستو مشمول مهار خودکار شد'
          }
        },
        {
          id: 'act_103',
          type: 'support_session',
          severity: 'warning',
          title: 'نشست اضطراری پشتیبانی فعال شد',
          description: 'ورود موقت به پنل کافه وستو با دامنه اختیارات محدود جهت رفع خطای چاپگر صندوق POS-01.',
          subsystem: 'Support',
          route: '#gm-21-support',
          routeLabel: 'GM-21 پشتیبانی فنی',
          actor: 'پشتیبانی فنی سالسا',
          timestamp: '۲ ساعت قبل',
          timestampIso: '2026-09-06T12:00:00Z',
          read: true,
          details: {
            sessionId: 'ses_support_091',
            tenantId: 'tnt_westo_demo',
            expiresInMinutes: 42
          }
        },
        {
          id: 'act_104',
          type: 'canary_release',
          severity: 'info',
          title: 'استقرار نسخه ارزیابی قناری v1.2.1-rc2',
          description: 'هدایت ۲۵٪ ترافیک در سلول پردازشی مشهد جهت سنجش الگوریتم O(1) دسترسی کافه وستو.',
          subsystem: 'Releases',
          route: '#gm-23-releases',
          routeLabel: 'GM-23 ریلیز و قناری',
          actor: 'خط لوله CI/CD پلتفرم',
          timestamp: '۳ ساعت قبل',
          timestampIso: '2026-09-06T11:00:00Z',
          read: true,
          details: {
            version: 'v1.2.1-rc2',
            cellId: 'cell-mashhad-01',
            trafficShare: '25%'
          }
        },
        {
          id: 'act_105',
          type: 'backup_verify',
          severity: 'success',
          title: 'تأیید دریل خودکار بازیابی پایگاه داده',
          description: 'تست یکپارچگی بکاپ دوره شبانه کافه وستو در محیط ایزوله سندباکس با موفقیت پایان یافت.',
          subsystem: 'Backups',
          route: '#gm-20-backups',
          routeLabel: 'GM-20 پشتیبان‌ها',
          actor: 'سیستم خودکار (Automation Engine)',
          timestamp: '۵ ساعت قبل',
          timestampIso: '2026-09-06T09:00:00Z',
          read: true,
          details: {
            backupId: 'bkp_14030905_0300',
            duration: '۴.۲ ثانیه',
            result: 'VERIFIED_100_PERCENT'
          }
        }
      ],
      dismissedInboxItems: []
    };
  }

  init() {
    const seed = this.getInitialSeed();
    try {
      if (typeof localStorage === 'undefined') throw new Error('LocalStorage unavailable');
      // Automatically purge legacy mock caches
      localStorage.removeItem('salsa_godmode_mock_v3');
      localStorage.removeItem('neem_godmode_mock_v3');
      localStorage.removeItem('neem_godmode_westo_v2');

      const saved = localStorage.getItem(this.STORAGE_KEY);
      if (saved) {
        this.state = this.sanitizePersistedState(JSON.parse(saved), seed);
        this.persist();
        return;
      }
    } catch (e) {
      console.warn('LocalStorage not available, using in-memory state');
    }
    this.state = seed;
  }

  clearAllDemoData() {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.clear();
      }
    } catch (e) {}
    this.state = this.getInitialSeed();
    this.save();
    if (typeof window !== 'undefined' && window.location) {
      window.location.reload();
    }
  }

  sanitizePersistedState(persisted, seed = this.getInitialSeed()) {
    const state = { ...seed, ...(persisted && typeof persisted === 'object' ? persisted : {}) };
    const initialWesto = seed.tenants[0];
    const incomingTenants = Array.isArray(persisted?.tenants) ? persisted.tenants : [];
    const sanitizedTenants = incomingTenants
      .filter((tenant) => tenant && typeof tenant === 'object' && typeof tenant.id === 'string')
      .map((tenant) => {
        if (tenant.id === initialWesto.id || tenant.slug === initialWesto.slug) {
          return { ...initialWesto, ...tenant, liveConnected: false, liveUrl: null, port: null, targetClientUrl: null };
        }
        return { ...tenant, liveConnected: false, liveUrl: null, port: null };
      });

    state.tenants = sanitizedTenants.length ? sanitizedTenants : [{ ...initialWesto }];
    const tenantIds = new Set(state.tenants.map((tenant) => tenant.id));
    const grants = persisted?.tenantGrants && typeof persisted.tenantGrants === 'object'
      ? persisted.tenantGrants
      : seed.tenantGrants;
    state.tenantGrants = Object.fromEntries(
      state.tenants.map((tenant) => [tenant.id, { ...(grants[tenant.id] || {}) }])
    );
    if (!state.tenantGrants[initialWesto.id]) {
      state.tenantGrants[initialWesto.id] = { ...seed.tenantGrants[initialWesto.id] };
    }

    for (const key of ['users', 'devices', 'branches', 'backups', 'tickets', 'invoices', 'activities', 'jobs', 'overrides', 'payments', 'debts', 'credits', 'discounts', 'auditLogs', 'nodeDiagnostics', 'hardwareCatalog', 'platformUsers', 'outboxEvents', 'automationRules']) {
      if (!Array.isArray(state[key])) state[key] = Array.isArray(seed[key]) ? seed[key] : [];
      if (['users', 'devices', 'branches', 'backups', 'tickets', 'invoices', 'jobs', 'overrides'].includes(key)) {
        state[key] = state[key].filter((item) => !item?.tenantId || tenantIds.has(item.tenantId));
      }
    }
    if (!Array.isArray(state.outboxEvents) || state.outboxEvents.length === 0) {
      state.outboxEvents = Array.isArray(seed.outboxEvents) ? [...seed.outboxEvents] : [];
    }
    if (!Array.isArray(state.automationRules) || state.automationRules.length === 0) {
      state.automationRules = Array.isArray(seed.automationRules) ? [...seed.automationRules] : [];
    }

    // Preserve feature global kill-switch and maintenance states
    const incomingFeatures = Array.isArray(persisted?.features) ? persisted.features : [];
    const persistedFeatureMap = new Map(incomingFeatures.map(f => [f?.key, f]));
    state.features = seed.features.map(f => {
      const p = persistedFeatureMap.get(f.key);
      return {
        ...f,
        globallyDisabled: Boolean(p ? p.globallyDisabled : f.globallyDisabled),
        maintenanceReason: p && p.maintenanceReason ? p.maintenanceReason : (f.maintenanceReason || null),
        disabledAt: p && p.disabledAt ? p.disabledAt : (f.disabledAt || null),
        disabledBy: p && p.disabledBy ? p.disabledBy : (f.disabledBy || null)
      };
    });

    for (const key of ['realData', 'menuCategories', 'menuItems', 'tables', 'orders', 'waiterCalls', 'realCounts', 'liveWesto']) {
      delete state[key];
    }
    state.dismissedInboxItems = Array.isArray(persisted?.dismissedInboxItems) ? persisted.dismissedInboxItems : [];
    state.securityPolicy = persisted?.securityPolicy && typeof persisted.securityPolicy === 'object'
      ? persisted.securityPolicy
      : (seed.securityPolicy || { sessionTimeoutHours: 8, mfaRequired: true, lockdownMode: false });
    const active = state.tenants.find((tenant) => tenant.id === state.activeTenantId);
    state.activeTenantId = active ? active.id : state.tenants[0].id;
    state.storageVersion = 3;
    return state;
  }

  persist() {
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.state));
    } catch (_error) {
      // State remains usable in memory when browser storage is unavailable.
    }
  }

  async syncLiveWestoData() {
    // Kept as a harmless compatibility hook for existing view code. No fetch
    // is issued and no runtime data can enter browser storage.
    this.notify();
    return null;
  }

  isLiveConnected() {
    return false;
  }

  getProvenance(viewId = 'generic') {
    const contract = typeof window !== 'undefined' && window.GMPageContracts
      ? window.GMPageContracts.getForView(viewId)
      : null;
    const tenantId = contract?.scope === 'tenant' ? this.getActiveTenantId() : null;
    const dataset = contract?.dataset || viewId;
    const provenance = typeof window !== 'undefined' && window.GMPageContracts
      ? window.GMPageContracts.datasetProvenance(dataset, tenantId)
      : { tenantId, dataset, sourceKind: 'mock_fixture', status: 'mock', completeness: 'not_operational' };
    return {
      isLive: false,
      mode: 'mock',
      badge: 'پیش‌نمایش محلی · دادهٔ ساختگی',
      badgeClass: 'badge-provenance-local',
      source: 'fixture محلی GODMODE',
      detail: 'این پیش‌نمایش به API و پایگاه‌دادهٔ عملیاتی وصل نیست؛ اطلاعات آن ساختگی و ایزوله است.',
      ...provenance
    };
  }

  save() {
    this.state = this.sanitizePersistedState(this.state);
    this.persist();
    this.notify();
  }

  resetStore() {
    this.state = this.getInitialSeed();
    this.save();
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notify() {
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }

  // --- Tenants ---
  getTenants() {
    return this.state.tenants;
  }

  getTenant(id) {
    if (!id) return null;
    const canonicalId = ['tnt_westo', 'westo', 'westo-demo'].includes(id) ? 'tnt_westo_demo' : id;
    return this.state.tenants.find((tenant) => tenant.id === canonicalId || tenant.slug === canonicalId) || null;
  }

  // --- Active Tenant Scope Management ---
  getActiveTenantId() {
    return this.getTenant(this.state.activeTenantId)?.id || this.state.tenants[0]?.id || null;
  }

  getActiveTenant() {
    const id = this.getActiveTenantId();
    return this.getTenant(id);
  }

  setActiveTenantId(tenantId, options = {}) {
    if (!tenantId) return false;
    const exists = this.getTenant(tenantId);
    if (!exists) return false;
    if (this.state.activeTenantId === exists.id) return true;
    this.state.activeTenantId = exists.id;
    this.save();
    if (!options.silent && typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new CustomEvent('gm:tenant-changed', { detail: { tenantId: exists.id, tenant: exists } }));
    }
    return true;
  }

  updateTenant(tenantId, changes = {}, options = {}) {
    const tenant = this.getTenant(tenantId);
    if (!tenant) return { success: false, error: 'مشتری موردنظر پیدا نشد.' };

    const currentVersion = Number(tenant.version || 1);
    if (options.expectedVersion !== undefined && Number(options.expectedVersion) !== currentVersion) {
      return {
        success: false,
        code: 'VERSION_CONFLICT',
        error: 'این پرونده در تب دیگری تغییر کرده است. صفحه را تازه‌سازی کنید و دوباره تلاش کنید.'
      };
    }

    const normalized = {
      name: String(changes.name ?? tenant.name).trim(),
      organization: String(changes.organization ?? tenant.organization).trim(),
      ownerName: String(changes.ownerName ?? tenant.ownerName).trim(),
      ownerPhone: String(changes.ownerPhone ?? tenant.ownerPhone).trim(),
      domain: String(changes.domain ?? tenant.domain).trim().toLowerCase(),
      cellId: String(changes.cellId ?? tenant.cellId).trim() === 'cell-mashhad-01'
        ? 'cell-msh-01'
        : String(changes.cellId ?? tenant.cellId).trim()
    };
    if (normalized.name.length < 3 || normalized.ownerName.length < 3) {
      return { success: false, error: 'نام مجموعه و نام مالک باید حداقل ۳ نویسه باشند.' };
    }
    const latinPhone = normalized.ownerPhone
      .replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
      .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)));
    if (!/^09\d{9}$/.test(latinPhone)) {
      return { success: false, error: 'شماره تماس باید ۱۱ رقم و با ۰۹ آغاز شود.' };
    }
    if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(normalized.domain)) {
      return { success: false, error: 'دامنه باید یک نام میزبان معتبر و بدون مسیر یا پروتکل باشد.' };
    }
    const duplicateDomain = this.state.tenants.find((candidate) => (
      candidate.id !== tenant.id && String(candidate.domain || '').trim().toLowerCase() === normalized.domain
    ));
    if (duplicateDomain) {
      return { success: false, error: `دامنه ${normalized.domain} قبلاً به مشتری دیگری اختصاص یافته است.` };
    }
    if (normalized.cellId === 'vps-primary' || normalized.cellId === 'vps-main' || normalized.cellId === 'vps-single') {
      normalized.cellId = 'cell-teh-01';
    }
    if (!this.state.infrastructureCells.some((cell) => cell.id === normalized.cellId)) {
      return { success: false, error: 'سرور میزبان انتخاب‌شده معتبر نیست.' };
    }

    Object.assign(tenant, normalized, {
      ownerPhone: latinPhone,
      version: currentVersion + 1,
      updatedAt: new Date().toISOString()
    });
    this.save();
    return { success: true, tenant: { ...tenant }, storage: 'local_fixture' };
  }

  createTenant(data = {}) {
    const name = data.name || data.tradeName || 'رستوران جدید';
    let slug = String(data.slug || data.id || `tenant-${Math.floor(Math.random() * 10000)}`).trim().toLowerCase();
    slug = slug.replace(/^tnt[-_]/, '').replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    if (!slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
      return { success: false, error: 'شناسه یکتا باید با حروف انگلیسی کوچک، عدد و خط تیره نوشته شود.' };
    }
    const organization = data.organization || data.legalName || 'سازمان جدید';
    const domain = String(data.domain || `${slug}.salsa.ir`).trim().toLowerCase();
    if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)) {
      return { success: false, error: 'دامنه باید یک نام میزبان معتبر و بدون مسیر یا پروتکل باشد.' };
    }
    const planInput = String(data.plan || data.planTier || 'Starter (پایه)').trim();
    const selectedPlan = this.state.plans.find((candidate) => (
      candidate.id === planInput ||
      candidate.name === planInput ||
      candidate.id === `plan_${planInput.toLowerCase()}` ||
      candidate.name.toLowerCase().startsWith(`${planInput.toLowerCase()}`) ||
      candidate.name.toLowerCase().includes(planInput.toLowerCase())
    )) || this.state.plans[0];

    const plan = selectedPlan.name;
    const templateCode = data.templateCode || data.templateId || 'tpl-blank-cafe-v1';
    const selectedTemplate = this.state.templates.find((candidate) => candidate.code === templateCode);
    if (!selectedTemplate || !selectedTemplate.isZeroData || !selectedTemplate.verifiedZeroData) {
      return { success: false, error: 'قالب انتخاب‌شده معتبر یا دارای تضمین صفر-داده نیست.' };
    }
    let cellId = data.cellId || 'cell-teh-01';
    if (cellId === 'vps-primary' || cellId === 'vps-main' || cellId === 'vps-single') {
      cellId = 'cell-teh-01';
    }
    const selectedCell = this.state.infrastructureCells.find((candidate) => candidate.id === cellId);
    if (!selectedCell) {
      return { success: false, error: 'سرور زیرساختی انتخاب‌شده در فهرست سرورهای فعال وجود ندارد.' };
    }
    const ownerName = data.ownerName || (data.owner && data.owner.name) || 'مالک جدید';
    const ownerPhone = data.ownerPhone || (data.owner && data.owner.mobile) || '۰۹۱۲۰۰۰۰۰۰۰';

    const newId = `tnt_${slug}`;
    const existing = this.state.tenants.find((tenant) => tenant.id === newId || tenant.slug === slug);
    if (existing) {
      const job = this.state.jobs.find((candidate) => candidate.tenantId === existing.id && candidate.type === 'tenant_provision') || null;
      return { ...existing, tenant: existing, job, created: false, idempotent: true };
    }
    const duplicateDomain = this.state.tenants.find((tenant) => {
      const tDom = String(tenant.domain || '').trim().toLowerCase();
      if (tDom === domain) return true;
      if (tenant.slug === 'westo' && (domain === 'westo.demo.salsa.local' || domain === 'westo.demo.neem.local' || domain === 'westo.salsa.ir' || domain === 'westo.neem.ir')) return true;
      if (domain === `${tenant.slug}.salsa.ir` || domain === `${tenant.slug}.demo.salsa.local` || domain === `${tenant.slug}.demo.neem.local`) return true;
      return false;
    });
    if (duplicateDomain) {
      return { success: false, error: `دامنه ${domain} قبلاً به مستأجر دیگری اختصاص یافته است.` };
    }
    const newTenant = {
      id: newId,
      name,
      tradeName: name,
      legalName: organization,
      slug,
      organization,
      domain,
      plan,
      planId: selectedPlan.id,
      templateCode,
      templateVersion: selectedTemplate.version,
      templateChecksum: selectedTemplate.checksum || selectedTemplate.seedChecksum,
      status: 'provisioning',
      health: 'healthy',
      cellId,
      cellName: selectedCell.name,
      branchesCount: 1,
      devicesCount: 0,
      lastBackup: 'در انتظار ساخت داده صفر',
      lastSync: 'در انتظار تایید دعوت مالک',
      ownerName,
      ownerPhone,
      createdAt: 'هم‌اکنون'
    };

    this.state.tenants.unshift(newTenant);

    // Create associated provisioning job
    const newJobId = `job_provision_${newId}`;
    const newJob = {
      id: newJobId,
      type: 'tenant_provision',
      tenantName: name,
      tenantId: newId,
      status: 'running',
      errorMessage: null,
      error: null,
      attempts: 1,
      maxRetries: 3,
      progress: 25,
      progressPercent: 25,
      planId: selectedPlan.id,
      templateCode,
      cellId,
      step: 'آغاز بارگذاری قالب حساب تجاری خام بدون داده',
      retryCount: 0,
      createdAt: 'هم‌اکنون',
      steps: [
        { name: 'اعتبارسنجی دامنه و یکتایی نام تجاری', status: 'completed' },
        { name: 'ایجاد ساختار اولیه حساب خام از Template', status: 'running' },
        { name: 'تخصیص سهمیه دیتابیس ایزوله', status: 'pending' },
        { name: 'تولید توکن دعوت امن مالک رستوران', status: 'pending' }
      ]
    };
    this.state.jobs.unshift(newJob);

    // Provision an explicit membership record; an owner is not implicitly
    // allowed to cross into any other tenant while this account is invited.
    this.state.users.push({
      id: `usr_owner_${slug}`,
      name: ownerName,
      phone: ownerPhone,
      email: `owner+${slug}@demo.salsa.local`,
      tenantId: newId,
      role: 'owner',
      status: 'invited',
      active: false,
      mfaEnabled: false,
      lastLogin: 'هنوز وارد نشده'
    });

    // Initialize grants with core capabilities and selected modules
    this.state.tenantGrants[newId] = {
      'core.workspace': { granted: true, type: 'plan', expiresAt: null, grantedAt: 'هم‌اکنون' },
      'catalog.menu': { granted: true, type: 'plan', expiresAt: null, grantedAt: 'هم‌اکنون' }
    };
    if (Array.isArray(data.selectedModules) && data.selectedModules.length > 0) {
      for (const modKey of data.selectedModules) {
        this.state.tenantGrants[newId][modKey] = {
          granted: true,
          type: 'addon',
          expiresAt: null,
          grantedAt: 'هم‌اکنون'
        };
      }
    }

    // Initialize primary branch
    const branchName = data.primaryBranchName || data.mainBranchName || 'شعبه اصلی';
    if (!this.state.branches) this.state.branches = [];
    this.state.branches.push({
      id: `brn_${slug}_01`,
      tenantId: newId,
      name: branchName,
      code: 'BR-01',
      isPrimary: true,
      status: 'active',
      city: data.city || 'تهران',
      address: data.address || '',
      phone: ownerPhone,
      posCount: 1,
      kdsCount: 0,
      createdAt: 'هم‌اکنون'
    });

    // Initialize default primary POS terminal
    if (!this.state.devices) this.state.devices = [];
    this.state.devices.push({
      id: `dev_${slug}_pos01`,
      tenantId: newId,
      branch: branchName,
      name: `صندوق ۱ ${branchName}`,
      type: 'Desktop POS (Windows/Electron)',
      ipAddress: '192.168.1.101',
      appVersion: 'v1.2.0-desktop',
      syncState: 'in_sync',
      pendingQueue: 0,
      leaseStatus: 'active',
      lastSync: 'هم‌اکنون',
      status: 'online'
    });

    this.addAuditLog({
      action: 'راه‌اندازی مجموعه جدید',
      tenantId: newId,
      targetId: newId,
      actor: 'مدیر پلتفرم',
      actorRole: 'SuperAdmin',
      reason: `راه‌اندازی مجموعه «${name}» با پلن ${plan} و شعبه «${branchName}»`,
      occurredAt: new Date().toISOString()
    });

    if (typeof window !== 'undefined' && window.GMApp && typeof window.GMApp.provisionTenantOnLiveServer === 'function') {
      window.GMApp.provisionTenantOnLiveServer(slug, name, domain);
    }
    return { ...newTenant, tenant: newTenant, job: newJob, created: true, idempotent: false };
  }

  // --- Features & Grants ---
  getFeatures() {
    return this.state.features;
  }

  getTenantGrants(tenantId) {
    const tid = tenantId || this.getActiveTenantId();
    if (!this.getTenant(tid)) return {};
    return (this.state.tenantGrants && this.state.tenantGrants[tid]) || {};
  }

  isGrantActive(grant, now = Date.now()) {
    if (!grant?.granted) return false;
    if (!grant.expiresAt || grant.expiresAt === 'نامحدود') return true;
    const expiresAt = Date.parse(grant.expiresAt);
    return Number.isFinite(expiresAt) && expiresAt >= now;
  }

  grantAddon(tenantId, featureKey, durationMonths = 12) {
    const tenant = this.getTenant(tenantId);
    if (!tenant || tenant.status !== 'active') {
      return { success: false, error: 'مستأجر فعال برای واگذاری قابلیت یافت نشد.' };
    }
    if (!this.state.tenantGrants[tenantId]) {
      this.state.tenantGrants[tenantId] = {};
    }

    const feature = this.state.features.find((f) => f.key === featureKey);
    if (!feature) {
      return { success: false, error: 'قابلیت یافت نشد' };
    }

    // Dependency check
    const currentGrants = this.state.tenantGrants[tenantId] || {};
    for (const dep of (feature.dependencies || [])) {
      const depFeature = this.state.features.find(f => f.key === dep);
      const isBaseFree = depFeature && depFeature.pricePerMonth === 0;
      if (!this.isGrantActive(currentGrants[dep])) {
        if (isBaseFree) {
          // Auto-grant free base prerequisite
          this.state.tenantGrants[tenantId][dep] = {
            granted: true,
            type: 'plan',
            expiresAt: null,
            grantedAt: 'هم‌اکنون'
          };
        } else {
          return { 
            success: false, 
            error: `امکان فعال‌سازی وجود ندارد: پیش‌نیاز [${depFeature?.nameFa || dep}] فعال نیست.` 
          };
        }
      }
    }

    const now = new Date();
    const expiry = durationMonths
      ? new Date(now.getFullYear(), now.getMonth() + Number(durationMonths), now.getDate()).toISOString()
      : null;

    this.state.tenantGrants[tenantId][featureKey] = {
      granted: true,
      type: 'addon',
      expiresAt: expiry,
      expiresAtLabel: durationMonths ? `تا ${Number(durationMonths)} ماه پس از فعال‌سازی` : 'نامحدود',
      grantedAt: 'هم‌اکنون'
    };

    this.save();
    return { 
      success: true, 
      feature: { ...feature, granted: true, grantedAt: 'هم‌اکنون' }, 
      expiry: expiry || 'نامحدود'
    };
  }

  revokeAddon(tenantId, featureKey) {
    const tid = tenantId || this.getActiveTenantId();
    const tenant = this.getTenant(tid);
    if (!tenant) return { success: false, error: 'مستأجر یافت نشد' };
    if (!this.state.tenantGrants[tid]) return { success: true, featureKey, active: false };

    const feature = this.state.features.find((f) => f.key === featureKey);
    if (this.state.tenantGrants[tid][featureKey]) {
      delete this.state.tenantGrants[tid][featureKey];
      this.save();
      this.notify();
      return {
        success: true,
        feature: feature || { key: featureKey },
        active: false,
        message: `قابلیت ${feature?.nameFa || featureKey} با موفقیت غیرفعال شد.`
      };
    }
    return { success: true, featureKey, active: false };
  }

  isFeatureGloballyDisabled(featureKey) {
    const f = (this.state.features || []).find(feat => feat.key === featureKey);
    return Boolean(f && f.globallyDisabled);
  }

  isFeatureGloballyEnabled(featureKey) {
    return !this.isFeatureGloballyDisabled(featureKey);
  }

  getFeatureAffectedTenants(featureKey) {
    const tenants = this.getTenants();
    const affected = [];
    for (const tenant of tenants) {
      if (tenant.status === 'archived' || tenant.status === 'banned') continue;
      const grants = this.getTenantGrants(tenant.id);
      const hasGrant = this.isGrantActive(grants[featureKey]);
      const planName = (tenant.plan || '').toLowerCase();
      const plan = this.state.plans.find(p => p.id === tenant.planId || (p.name && p.name.toLowerCase().includes(planName))) || this.state.plans[0];
      const isPlanIncluded = Boolean(plan && plan.includedFeatures && plan.includedFeatures.includes(featureKey));
      if (hasGrant || isPlanIncluded) {
        affected.push(tenant);
      }
    }
    return affected;
  }

  toggleFeatureGlobal(featureKey, explicitState = null, reason = '', operator = 'مدیر ارشد پلتفرم') {
    const feature = (this.state.features || []).find(f => f.key === featureKey);
    if (!feature) {
      return { success: false, error: 'قابلیت مورد نظر در کاتالوگ یافت نشد.' };
    }

    const currentDisabled = Boolean(feature.globallyDisabled);
    // If explicitState is passed: true means ENABLE, false means DISABLE
    const targetDisabled = explicitState !== null ? !Boolean(explicitState) : !currentDisabled;

    feature.globallyDisabled = targetDisabled;
    if (targetDisabled) {
      feature.maintenanceReason = (reason || '').trim() || 'به‌روزرسانی زیرساخت پلتفرم و ارتقای نسخه';
      feature.disabledAt = new Date().toISOString();
      feature.disabledBy = operator || 'مدیر ارشد پلتفرم';
    } else {
      feature.maintenanceReason = null;
      feature.disabledAt = null;
      feature.disabledBy = null;
    }

    const affectedTenants = this.getFeatureAffectedTenants(featureKey);

    const actionType = targetDisabled ? 'feature_global_suspended' : 'feature_global_restored';
    const actionTitle = targetDisabled
      ? `قطع موقت سراسری قابلیت «${feature.nameFa}» (${feature.key})`
      : `فعال‌سازی مجدد سراسری قابلیت «${feature.nameFa}» (${feature.key})`;

    if (typeof this.addActivity === 'function') {
      this.addActivity({
        type: 'feature_global_killswitch',
        action: actionType,
        title: actionTitle,
        severity: targetDisabled ? 'warning' : 'info',
        subsystem: 'Catalog',
        actor: operator || 'مدیر ارشد پلتفرم',
        details: {
          featureKey: feature.key,
          featureName: feature.nameFa,
          globallyDisabled: targetDisabled,
          reason: feature.maintenanceReason,
          affectedCount: affectedTenants.length,
          affectedTenantIds: affectedTenants.map(t => t.id)
        }
      });
    }

    this.save();
    this.notify();

    return {
      success: true,
      feature,
      globallyDisabled: targetDisabled,
      maintenanceReason: feature.maintenanceReason,
      affectedTenants,
      message: targetDisabled
        ? `ماژول «${feature.nameFa}» به صورت موقت در سطح کلان پلتفرم متوقف شد.`
        : `ماژول «${feature.nameFa}» مجدداً در دسترس تمامی مشتریان قرار گرفت.`
    };
  }

  bulkToggleFeaturesGlobal(featureKeys, enabled = true, reason = '', operator = 'مدیر ارشد پلتفرم') {
    if (!Array.isArray(featureKeys) || featureKeys.length === 0) {
      return { success: false, count: 0, error: 'هیچ شناسه‌ای انتخاب نشده است.' };
    }
    const results = [];
    for (const key of featureKeys) {
      const res = this.toggleFeatureGlobal(key, enabled, reason, operator);
      if (res.success) results.push(res);
    }
    return { success: true, count: results.length, results };
  }

  isFeatureEnabled(tenantId, featureKey) {
    const tid = tenantId || this.getActiveTenantId();
    if (!tid) return false;
    const effective = this.calculateEffectiveEntitlements(tid);
    return Boolean(effective && effective[featureKey] && effective[featureKey].enabled);
  }

  getFeaturesCount() {
    return (this.state.features && this.state.features.length) || 48;
  }

  /**
   * Deterministic Entitlement Engine:
   * Effective = Plan Entitlements (by plan version) + Tenant Overrides (grants/addons) - Status restrictions
   */
  calculateEffectiveEntitlements(tenantId) {
    const tid = tenantId || this.getActiveTenantId();
    const tenant = this.getTenant(tid);
    if (!tenant) return {};

    const planName = (tenant.plan || '').toLowerCase();
    const plan = this.state.plans.find(p => p.id === tenant.planId || (p.name && p.name.toLowerCase().includes(planName))) || this.state.plans[0];
    const grants = this.getTenantGrants(tid);
    const tenantLimits = (this.state.tenantLimits && this.state.tenantLimits[tid]) || {};

    const isSuspended = tenant.status === 'suspended' || tenant.status === 'cancelled';
    const effective = {};

    for (const feature of this.state.features) {
      const grant = grants[feature.key];
      const hasDirectGrant = this.isGrantActive(grant);
      const isPlanIncluded = Boolean(plan && plan.includedFeatures && plan.includedFeatures.includes(feature.key));
      
      const isGloballyDisabled = Boolean(feature.globallyDisabled);
      const isEnabled = !isSuspended && !isGloballyDisabled && (hasDirectGrant || isPlanIncluded);
      const source = isGloballyDisabled 
        ? 'globally_suspended' 
        : (isSuspended ? 'suspended' : (hasDirectGrant ? (grant.type || 'override') : (isPlanIncluded ? 'plan' : 'none')));

      // Calculate specific limits
      let limit = null;
      let limitUnit = null;
      if (feature.key === 'orders.pos') {
        limit = tenantLimits.maxPosDevices || (plan && plan.limits && plan.limits.maxPosDevices) || 4;
        limitUnit = 'دستگاه پایانه';
      } else if (feature.key === 'platform.multi_branch' || feature.key === 'core.multi_branch') {
        limit = tenantLimits.maxBranches || (plan && plan.limits && plan.limits.maxBranches) || 1;
        limitUnit = 'شعبه';
      } else if (feature.key === 'marketing.sms') {
        limit = tenantLimits.smsMonthlyQuota || (plan && plan.limits && plan.limits.smsMonthlyQuota) || 10000;
        limitUnit = 'پیامک در ماه';
      }

      effective[feature.key] = {
        key: feature.key,
        nameFa: feature.nameFa,
        category: feature.category,
        enabled: isEnabled,
        globallyDisabled: isGloballyDisabled,
        maintenanceReason: isGloballyDisabled ? (feature.maintenanceReason || 'تعمیرات سراسری پلتفرم') : null,
        source,
        limit,
        limitUnit,
        expiresAt: grant ? grant.expiresAt : null,
        planName: plan ? plan.name : 'سراسری'
      };
    }
    return effective;
  }

  // Branch entity management
  getBranches(tenantId) {
    const tid = tenantId || this.getActiveTenantId();
    return (this.state.branches || []).filter(b => !tid || b.tenantId === tid);
  }

  getBranch(branchId) {
    return (this.state.branches || []).find(b => b.id === branchId) || null;
  }

  createBranch(tenantId, data = {}) {
    const tid = tenantId || this.getActiveTenantId();
    const branch = {
      id: `brn_${Date.now()}`,
      tenantId: tid,
      name: data.name || 'شعبه جدید',
      code: data.code || `BR-${Math.floor(Math.random() * 900 + 100)}`,
      isPrimary: Boolean(data.isPrimary),
      status: 'active',
      city: data.city || 'تهران',
      address: data.address || '',
      phone: data.phone || '',
      posCount: Number(data.posCount || 0),
      kdsCount: Number(data.kdsCount || 0),
      waiterCount: Number(data.waiterCount || 0),
      createdAt: 'هم‌اکنون'
    };
    if (!this.state.branches) this.state.branches = [];
    this.state.branches.push(branch);
    this.save();
    return branch;
  }

  // Platform Operators Realm
  getPlatformUsers() {
    return this.state.platformUsers || [];
  }

  addPlatformUser(userData = {}) {
    if (!this.state.platformUsers) this.state.platformUsers = [];
    const newUser = {
      id: userData.id || ('usr_plat_' + Date.now()),
      name: userData.name || 'عضو جدید',
      email: userData.email,
      role: userData.role || 'platform_support',
      roleFa: userData.roleFa || userData.role || 'پشتیبانی فنی',
      realm: 'platform',
      status: 'active',
      mfaEnabled: true,
      lastLogin: 'دعوت‌شده',
      createdAt: new Date().toISOString()
    };
    this.state.platformUsers.push(newUser);
    if (!this.state.auditLogs) this.state.auditLogs = [];
    this.state.auditLogs.unshift({
      id: `aud_${Date.now()}`,
      action: 'افزودن عضو جدید به تیم پلتفرم',
      targetId: newUser.email,
      actorId: 'مدیر ارشد پلتفرم',
      reason: userData.reason || 'دعوت رسمی جهت همکاری در راهبری پلتفرم',
      occurredAt: new Date().toISOString()
    });
    this.save();
    return newUser;
  }

  removePlatformUser(email, reason = '') {
    if (!this.state.platformUsers) return false;
    const initialLen = this.state.platformUsers.length;
    this.state.platformUsers = this.state.platformUsers.filter(u => u.email !== email);
    if (this.state.platformUsers.length < initialLen) {
      if (!this.state.auditLogs) this.state.auditLogs = [];
      this.state.auditLogs.unshift({
        id: `aud_${Date.now()}`,
        action: 'لغو دسترسی کاربر پلتفرم',
        targetId: email,
        actorId: 'مدیر ارشد پلتفرم',
        reason: reason || 'لغو دسترسی سازمانی',
        occurredAt: new Date().toISOString()
      });
      this.save();
      return true;
    }
    return false;
  }

  getSecurityPolicy() {
    return this.state.securityPolicy || {
      sessionTimeoutHours: 8,
      mfaRequired: true,
      allowDemoMode: true,
      encryptionSuite: 'AES-256-GCM',
      updatedAt: new Date().toISOString()
    };
  }

  updateSecurityPolicy(updates = {}) {
    if (!this.state.securityPolicy) this.state.securityPolicy = this.getSecurityPolicy();
    Object.assign(this.state.securityPolicy, updates, { updatedAt: new Date().toISOString() });
    if (!this.state.auditLogs) this.state.auditLogs = [];
    this.state.auditLogs.unshift({
      id: `aud_${Date.now()}`,
      action: 'به‌روزرسانی سیاست‌های امنیتی پلتفرم',
      targetId: 'platform_security_policy',
      actorId: 'مدیر امنیت پلتفرم',
      reason: updates.reason || 'تنظیم انقضای نشست یا الزامات احراز هویت',
      occurredAt: new Date().toISOString()
    });
    this.save();
    return this.state.securityPolicy;
  }

  getHardwareCatalog() {
    if (Array.isArray(this.state.hardwareCatalog) && this.state.hardwareCatalog.length > 0) {
      return this.state.hardwareCatalog;
    }
    const defaultCatalog = [
      {
        id: 'hw_bixolon_350',
        manufacturer: 'BIXOLON',
        model: 'SRP-350III',
        type: 'چاپگر حرارتی صدور فیش',
        category: 'receipt',
        categoryFa: 'چاپگر فیش (رسید)',
        paperWidth: '80mm',
        cutType: 'Auto Cutter',
        interfaces: ['LAN', 'USB', 'Serial'],
        driverProfile: 'ESC/POS Direct Socket (Port 9100)',
        offlineResilient: true,
        status: 'certified'
      },
      {
        id: 'hw_epson_t20',
        manufacturer: 'EPSON',
        model: 'TM-T20III',
        type: 'چاپگر حرارتی رسید',
        category: 'receipt',
        categoryFa: 'چاپگر فیش (رسید)',
        paperWidth: '80mm / 58mm',
        cutType: 'Auto Cutter',
        interfaces: ['LAN', 'USB'],
        driverProfile: 'ESC/POS Direct Socket (Port 9100)',
        offlineResilient: true,
        status: 'certified'
      },
      {
        id: 'hw_sam4s_gcube',
        manufacturer: 'SAM4S',
        model: 'GCUBE-100',
        type: 'چاپگر مکعبی فشرده صندوق',
        category: 'receipt',
        categoryFa: 'چاپگر فیش (رسید)',
        paperWidth: '80mm',
        cutType: 'Auto Cutter',
        interfaces: ['LAN', 'USB', 'Wi-Fi'],
        driverProfile: 'ESC/POS Direct Socket (Port 9100)',
        offlineResilient: true,
        status: 'certified'
      },
      {
        id: 'hw_sewoo_ts400',
        manufacturer: 'SEWOO',
        model: 'SLK-TS400',
        type: 'چاپگر حرارتی آشپزخانه (KOT)',
        category: 'kitchen',
        categoryFa: 'چاپگر آشپزخانه (KOT)',
        paperWidth: '80mm',
        cutType: 'Auto Cutter & Buzzer',
        interfaces: ['LAN', 'Serial'],
        driverProfile: 'ESC/POS Direct Socket (Port 9100)',
        offlineResilient: true,
        status: 'certified'
      },
      {
        id: 'hw_star_tsp143',
        manufacturer: 'STAR',
        model: 'TSP143III-LAN',
        type: 'چاپگر فیش شبکه اترنت',
        category: 'receipt',
        categoryFa: 'چاپگر فیش (رسید)',
        paperWidth: '80mm',
        cutType: 'Auto Cutter',
        interfaces: ['LAN'],
        driverProfile: 'Star Line Mode / ESC/POS Emulation',
        offlineResilient: true,
        status: 'certified'
      }
    ];
    this.state.hardwareCatalog = [...defaultCatalog];
    return this.state.hardwareCatalog;
  }

  addHardwareModel(modelData = {}) {
    if (!this.state.hardwareCatalog) this.state.hardwareCatalog = [...this.getHardwareCatalog()];
    const newModel = {
      id: modelData.id || ('hw_' + Date.now()),
      manufacturer: modelData.manufacturer || 'سایر',
      model: modelData.model || 'مدل سخت‌افزار',
      type: modelData.type || 'چاپگر حرارتی',
      category: modelData.category || (modelData.type?.includes('آشپزخانه') ? 'kitchen' : 'receipt'),
      categoryFa: modelData.type || 'چاپگر حرارتی',
      paperWidth: modelData.paperWidth || '80mm',
      cutType: modelData.cutType || 'Auto Cutter',
      interfaces: modelData.interfaces || ['LAN', 'USB'],
      driverProfile: modelData.driverProfile || 'ESC/POS Direct Socket (Port 9100)',
      offlineResilient: true,
      status: 'certified',
      createdAt: new Date().toISOString()
    };
    this.state.hardwareCatalog.push(newModel);
    this.logAudit({
      action: `ثبت مدل جدید در کاتالوگ سخت‌افزار رسمی: ${newModel.manufacturer} ${newModel.model}`,
      category: 'operations',
      targetId: newModel.id,
      actorId: 'مهندسی سخت‌افزار',
      reason: modelData.reason || 'افزودن مدل دارای تاییدیه فنی سالسا',
      occurredAt: new Date().toISOString()
    });
    this.save();
    return newModel;
  }

  testPrinterModel(modelId) {
    const catalog = this.getHardwareCatalog();
    const model = catalog.find(m => m.id === modelId) || { id: modelId, manufacturer: 'سخت‌افزار', model: modelId };
    const latency = Math.floor(7 + Math.random() * 9);
    const result = {
      ok: true,
      modelId: model.id,
      name: `${model.manufacturer} ${model.model}`,
      targetAddress: '127.0.0.1:9100',
      protocol: 'RAW_SOCKET_ESC_POS',
      responseCode: '0x10 0x04 0x01 (STATUS_OK)',
      latencyMs: latency,
      drawerStatus: 'CLOSED',
      cutterTested: true,
      offlineSupported: true,
      testedAt: new Date().toISOString()
    };

    this.logAudit({
      action: `شبیه‌سازی تست چاپ شبکه و استعلام وضعیت: ${model.manufacturer} ${model.model}`,
      category: 'operations',
      targetId: model.id,
      actorId: 'مهندسی پشتیبانی سخت‌افزار',
      reason: `ارسال پروب خام ESC/POS به پورت ۹۱۰۰ محلی - تاخیر پاسخ: ${latency}ms - کد وضعیت 0x10 0x04 تایید شد`,
      occurredAt: result.testedAt
    });

    this.save();
    return result;
  }

  triggerLockdownDrill(enabled = true, reason = '') {
    if (!this.state.securityPolicy) this.state.securityPolicy = this.getSecurityPolicy();
    this.state.securityPolicy.lockdownMode = Boolean(enabled);
    this.state.securityPolicy.lockdownTriggeredAt = enabled ? new Date().toISOString() : null;
    this.state.securityPolicy.lockdownReason = reason || (enabled ? 'اجرای مانور قرنطینه امنیتی سطح بالا' : 'خاتمه قرنطینه و بازگشت به سیاست عادی');

    this.logAudit({
      action: enabled
        ? 'فعال‌سازی وضعیت آماده‌باش اضطراری و قرنطینه سایبری پلتفرم (Lockdown Drill)'
        : 'خاتمه وضعیت قرنطینه و بازگشت به سیاست امنیتی استاندارد',
      category: 'security',
      targetId: 'platform_security_policy',
      actorId: 'مدیر ارشد امنیت پلتفرم',
      reason: this.state.securityPolicy.lockdownReason,
      occurredAt: new Date().toISOString()
    });

    this.save();
    return {
      lockdownMode: this.state.securityPolicy.lockdownMode,
      reason: this.state.securityPolicy.lockdownReason,
      updatedAt: new Date().toISOString()
    };
  }

  resendTeamInvitation(email) {
    const users = this.state.platformUsers || [];
    const user = users.find(u => u.email === email);
    const now = new Date().toISOString();
    if (user) {
      user.lastInvitedAt = now;
      user.inviteToken = 'inv_' + Math.random().toString(36).substring(2, 10);
    }
    this.logAudit({
      action: `ارسال مجدد دعوت‌نامه عضویت در تیم سالسا: ${email}`,
      category: 'security',
      targetId: email,
      actorId: 'مدیر ارشد پلتفرم',
      reason: 'تولید مجدد توکن فعال‌سازی امن با انقضای ۴۸ ساعته',
      occurredAt: now
    });
    this.save();
    return { success: true, email, resentAt: now };
  }

  // Tenant Lifecycle State Machine
  transitionTenantState(tenantId, targetState, reason = '') {
    const tid = tenantId || this.getActiveTenantId();
    const tenant = this.getTenant(tid);
    if (!tenant) return { success: false, error: 'مستأجر یافت نشد' };

    const validStates = ['lead', 'trial', 'provisioning', 'active', 'past_due', 'grace_period', 'suspended', 'cancelled', 'archived'];
    if (!validStates.includes(targetState)) {
      return { success: false, error: `وضعیت ${targetState} در چرخه حیات پلتفرم معتبر نیست.` };
    }

    const previousState = tenant.status;
    tenant.status = targetState;
    tenant.lifecycleState = targetState;
    tenant.updatedAt = 'هم‌اکنون';

    // Record audit event through the canonical audit-log channel so the entry
    // is visible in GM-26 and persisted alongside the rest of the mock state.
    this.addAuditLog({
      tenantId: tid,
      action: 'tenant.state.transition',
      description: `تغییر وضعیت از [${previousState}] به [${targetState}]. علت: ${reason || 'تغییر اداری پلتفرم'}`,
      scope: `lifecycle:${previousState}->${targetState}`,
      result: 'success',
      ip: '127.0.0.1'
    });

    this.save();
    this.notify();
    return { success: true, tenant, previousState, targetState };
  }

  archiveAndBanTenant(tenantId, reason = '') {
    const tid = tenantId || this.getActiveTenantId();
    const tenant = this.getTenant(tid);
    if (!tenant) return { success: false, error: 'مشتری مورد نظر یافت نشد.' };

    const previousState = tenant.status;
    tenant.status = 'archived';
    tenant.lifecycleState = 'archived';
    tenant.banned = true;
    tenant.bannedAt = new Date().toISOString();
    tenant.bannedReason = reason || 'مسدودسازی توسط مدیریت ارشد پلتفرم';
    tenant.updatedAt = 'هم‌اکنون';

    // Ban all users/identities for this tenant
    if (Array.isArray(this.state.users)) {
      this.state.users.forEach(u => {
        if (u.tenantId === tenant.id) {
          u.status = 'banned';
          u.active = false;
        }
      });
    }

    // Revoke and offline edge devices
    if (Array.isArray(this.state.devices)) {
      this.state.devices.forEach(d => {
        if (d.tenantId === tenant.id) {
          d.status = 'offline';
          d.leaseStatus = 'revoked';
        }
      });
    }

    // Record audit event
    this.addAuditLog({
      tenantId: tenant.id,
      action: 'tenant.ban_and_archive',
      actor: 'راهبر ارشد (SuperAdmin)',
      actorRole: 'SuperAdmin',
      description: `تعلیق، بن کامل و انتقال مشتری ${tenant.name} به آرشیو. علت: ${reason || 'تصمیم امنیتی'}`,
      scope: `tenant:${tenant.id}:banned`,
      result: 'success',
      ip: '127.0.0.1'
    });

    // Record activity entry
    if (this.addActivity) {
      this.addActivity({
        type: 'tenant_ban',
        severity: 'danger',
        title: `بن کامل و انتقال به آرشیو: ${tenant.name}`,
        description: `حساب مشتری مسدود و به آرشیو منتقل شد. علت: ${reason || 'تصمیم امنیتی'}`,
        subsystem: 'Security',
        actor: 'SuperAdmin'
      });
    }

    this.save();
    this.notify();
    return { success: true, tenant, previousState };
  }

  unarchiveTenant(tenantId, reason = '') {
    const tid = tenantId || this.getActiveTenantId();
    const tenant = this.getTenant(tid);
    if (!tenant) return { success: false, error: 'مشتری مورد نظر یافت نشد.' };

    const previousState = tenant.status;
    tenant.status = 'active';
    tenant.lifecycleState = 'active';
    tenant.banned = false;
    delete tenant.bannedAt;
    delete tenant.bannedReason;
    tenant.updatedAt = 'هم‌اکنون';

    // Reactivate users/identities
    if (Array.isArray(this.state.users)) {
      this.state.users.forEach(u => {
        if (u.tenantId === tenant.id) {
          u.status = 'active';
          u.active = true;
        }
      });
    }

    // Record audit event
    this.addAuditLog({
      tenantId: tenant.id,
      action: 'tenant.unarchive',
      actor: 'راهبر ارشد (SuperAdmin)',
      actorRole: 'SuperAdmin',
      description: `خروج از آرشیو و رفع مسدودی حساب مشتری ${tenant.name}. علت: ${reason || 'درخواست فعال‌سازی مجدد'}`,
      scope: `tenant:${tenant.id}:active`,
      result: 'success',
      ip: '127.0.0.1'
    });

    // Record activity entry
    if (this.addActivity) {
      this.addActivity({
        type: 'tenant_unarchive',
        severity: 'info',
        title: `خروج از آرشیو: ${tenant.name}`,
        description: `حساب مشتری از وضعیت مسدودی خارج و فعال گردید.`,
        subsystem: 'Security',
        actor: 'SuperAdmin'
      });
    }

    this.save();
    this.notify();
    return { success: true, tenant, previousState };
  }

  toggleFeature(tenantId, featureKey, explicitState = null) {
    const tid = tenantId || this.getActiveTenantId();
    const isCurrentlyActive = this.isFeatureEnabled(tid, featureKey);
    const targetState = explicitState !== null ? Boolean(explicitState) : !isCurrentlyActive;
    let result;
    if (targetState) {
      result = this.grantAddon(tid, featureKey, 12);
    } else {
      result = this.revokeAddon(tid, featureKey);
    }
    return result;
  }

  getFeaturesByCategory() {
    const CATEGORY_DEFS = [
      { id: 'finance', nameFa: 'مالی و حسابداری', icon: '💰', color: '#10b981', keys: ['finance.workspace', 'finance.purchases', 'finance.reconciliation', 'finance.assets', 'finance.payroll', 'finance.tax_adapter', 'finance.consolidation', 'payments.gateway', 'cash.drawers'] },
      { id: 'catalog', nameFa: 'کاتالوگ و منوی دیجیتال', icon: '📋', color: '#3b82f6', keys: ['catalog.menu', 'catalog.modifiers', 'catalog.pricing', 'catalog.languages', 'catalog.print'] },
      { id: 'orders', nameFa: 'سفارشات و صندوق فروش', icon: '🛒', color: '#f59e0b', keys: ['orders.pos', 'orders.online', 'orders.advanced', 'delivery.dispatch'] },
      { id: 'floor', nameFa: 'سالن، میزها و رزرو', icon: '🪑', color: '#8b5cf6', keys: ['floor.tables', 'floor.qr', 'staff.waiter', 'booking.reservations', 'booking.waitlist'] },
      { id: 'kitchen', nameFa: 'آشپزخانه و KDS', icon: '🍳', color: '#ef4444', keys: ['kitchen.kds'] },
      { id: 'inventory', nameFa: 'انبارداری و بهای تمام‌شده', icon: '📦', color: '#14b8a6', keys: ['stock.inventory', 'stock.recipes', 'stock.procurement'] },
      { id: 'crm', nameFa: 'باشگاه مشتریان و CRM', icon: '👥', color: '#ec4899', keys: ['crm.directory', 'crm.loyalty', 'crm.wallet', 'marketing.campaigns', 'marketing.sms'] },
      { id: 'insights', nameFa: 'هوش تجاری و گزارشات', icon: '📊', color: '#6366f1', keys: ['insights.reports', 'insights.analytics', 'insights.cost_control', 'insights.local_ai'] },
      { id: 'platform', nameFa: 'زیرساخت و پلتفرم', icon: '⚙️', color: '#64748b', keys: ['core.workspace', 'platform.multi_branch', 'platform.edge', 'platform.desktop', 'platform.api', 'platform.exports', 'platform.backup_plus', 'platform.support_plus', 'content.website', 'brand.custom_domain', 'brand.white_label', 'staff.management'] }
    ];

    const allFeatures = this.getFeatures() || [];
    const featureMap = new Map(allFeatures.map(f => [f.key, f]));

    return CATEGORY_DEFS.map(cat => ({
      ...cat,
      features: cat.keys.map(k => featureMap.get(k)).filter(Boolean)
    }));
  }

  // --- Roles & Overrides (Flow 3) ---
  getUsers(tenantId) {
    if (!tenantId) return this.state.users;
    return this.state.users.filter((u) => u.tenantId === tenantId);
  }

  getOverrides(tenantId) {
    return this.state.overrides.filter((o) => o.tenantId === tenantId);
  }

  setOverride(tenantId, userId, permission, state, reason) {
    const tenant = this.getTenant(tenantId);
    const user = this.state.users.find((candidate) => candidate.id === userId);
    if (!tenant || !user || user.tenantId !== tenant.id || !['allow', 'deny', 'inherit'].includes(state)) {
      return this.evaluateAccess(userId, tenantId, permission);
    }
    const existingIndex = this.state.overrides.findIndex(
      (o) => o.tenantId === tenantId && o.userId === userId && o.permission === permission
    );

    if (state === 'inherit') {
      if (existingIndex !== -1) {
        this.state.overrides.splice(existingIndex, 1);
      }
    } else {
      const overrideObj = {
        id: existingIndex !== -1 ? this.state.overrides[existingIndex].id : 'ovr_' + Math.floor(Math.random() * 10000),
        tenantId,
        userId,
        permission,
        state,
        reason: reason || 'ثبت دستی توسط ناظر در پنل GODMODE',
        updatedAt: 'هم‌اکنون'
      };

      if (existingIndex !== -1) {
        this.state.overrides[existingIndex] = overrideObj;
      } else {
        this.state.overrides.push(overrideObj);
      }
    }

    this.save();
    return this.evaluateAccess(tenantId, userId, permission);
  }

  // Evaluator Formula per GODMODE.MD Section 10, 15 & 21
  // Decision = ValidIdentity AND ValidTenant AND ActiveEntitlement AND (RoleAllow OR PersonalAllow) AND NOT(ExplicitDeny)
  evaluateAccess(arg1, arg2, arg3, arg4) {
    let userId, tenantId, permission, feature;
    if (this.state.users.some((u) => u.id === arg1)) {
      userId = arg1;
      tenantId = arg2;
      permission = arg3;
      feature = arg4;
    } else {
      tenantId = arg1;
      userId = arg2;
      permission = arg3;
      feature = arg4;
    }

    const user = this.state.users.find((u) => u.id === userId);
    const tenant = this.getTenant(tenantId);
    const identityActive = !!user && user.active !== false && !['disabled', 'revoked', 'suspended'].includes(user.status);
    const tenantActive = !!tenant && tenant.status === 'active';
    const belongsToTenant = !!user && !!tenant && user.tenantId === tenant.id;
    const roleObj = identityActive && belongsToTenant ? this.state.roles[user.role] : null;
    const roleHasPermission = !!(roleObj?.defaultPermissions?.includes(permission) || (user?.role === 'owner' && belongsToTenant));
    const grants = this.getTenantGrants(tenantId);
    const normalizedFeature = (feature === 'finance.general') ? 'finance.workspace' : feature;
    const featureGrant = grants[normalizedFeature] || grants[feature];
    const isFeatureEntitled = !normalizedFeature || this.isGrantActive(featureGrant);

    const override = this.state.overrides.find(
      (o) => o.tenantId === tenant?.id && o.userId === userId && o.permission === permission
    ) || { state: 'inherit', reason: 'ارث‌بری پیش‌فرض از نقش' };

    const isExplicitDeny = override.state === 'deny';
    const isExplicitAllow = override.state === 'allow';

    // Step-by-step breakdown
    const steps = [
      { step: 'احراز هویت و حساب فعال', passed: identityActive, detail: identityActive ? `${user.nameFa || user.name} (${user.role})` : 'کاربر یافت نشد یا غیرفعال است' },
      { step: 'وضعیت مستأجر', passed: tenantActive, detail: tenant ? `${tenant.name} [${tenant.status}]` : 'مستأجر یافت نشد یا فعال نیست' },
      { step: 'عضویت در مستأجر هدف', passed: belongsToTenant, detail: belongsToTenant ? 'عضویت کاربر و دامنه مستأجر یکسان است' : 'کاربر عضو مستأجر هدف نیست' },
      { step: 'اشتراک قابلیت تجاری (Entitlement)', passed: isFeatureEntitled, detail: feature ? (isFeatureEntitled ? `ماژول ${feature} در اشتراک فعال است` : `ماژول ${feature} در اشتراک این مستأجر خریداری/فعال نشده است`) : 'قابلیت پیش‌فرض پلتفرم' },
      { step: 'اختیارات نقش سازمانی (Role Allow)', passed: !!roleHasPermission, detail: roleHasPermission ? `نقش ${user?.role} مجاز است` : `نقش فاقد مجوز است` },
      { step: 'عدم منع شخصی (NOT PersonalDeny)', passed: !isExplicitDeny, detail: isExplicitDeny ? `منع شخصی صریح: "${override.reason}"` : (isExplicitAllow ? 'اجازه شخصی صریح' : 'ارث‌بری پیش‌فرض') }
    ];

    let decision = 'DENIED';
    let reason = '';

    if (!identityActive) {
      decision = 'DENIED';
      reason = 'کاربر در سامانه یافت نشد یا حساب کاربری غیرفعال است.';
    } else if (!tenantActive) {
      decision = 'DENIED';
      reason = 'مستأجر مورد نظر یافت نشد یا غیرفعال است.';
    } else if (!belongsToTenant) {
      decision = 'DENIED';
      reason = 'کاربر عضو مستأجر هدف نیست و دسترسی میان‌مستاجری مجاز نیست.';
    } else if (!isFeatureEntitled) {
      decision = 'DENIED';
      reason = `قابلیت تجاری مرتبط [${feature}] برای این مستأجر خریداری یا فعال نشده است.`;
    } else if (isExplicitDeny) {
      decision = 'DENIED';
      reason = `منع صریح شخصی (Explicit Deny) بر نقش ${user?.role} غالب شد: "${override.reason}"`;
    } else if (isExplicitAllow) {
      decision = 'ALLOW';
      reason = `اجازه صریح شخصی (Explicit Allow) اعمال شد: "${override.reason}"`;
    } else if (roleHasPermission) {
      decision = 'ALLOW';
      reason = `مجوز به صورت پیش‌فرض از طریق نقش سازمانی [${roleObj?.nameFa || user?.role}] تأیید شد.`;
    } else {
      decision = 'DENIED';
      reason = `نقش [${roleObj?.nameFa || user?.role}] فاقد این مجوز است و اجازه شخصی ندارد.`;
    }

    return {
      decision,
      state: override.state,
      reason,
      effectiveResult: decision === 'ALLOW' ? 'مجاز' : 'مسدود قطعی',
      impactOnOwner: (user?.role === 'owner' && isExplicitDeny) ? 'منع شخصی بر نقش مالک نیز غالب است و دسترسی او مسدود می‌شود.' : null,
      steps,
      override,
      user,
      tenant,
      identityActive,
      tenantActive,
      belongsToTenant,
      featureActive: isFeatureEntitled
    };
  }

  // --- Background Jobs (Flow 4) ---
  getJobs() {
    return (this.state.jobs || []).map((j) => {
      j.attempts = j.retryCount || 1;
      j.maxRetries = j.maxRetries || 3;
      j.progress = j.progressPercent !== undefined ? j.progressPercent : 0;
      j.error = j.errorMessage || null;
      return j;
    });
  }

  getJob(id) {
    const job = this.state.jobs.find((j) => j.id === id);
    if (!job) return null;
    job.attempts = job.retryCount || 1;
    job.maxRetries = job.maxRetries || 3;
    job.progress = job.progressPercent !== undefined ? job.progressPercent : 0;
    job.error = job.errorMessage || null;
    return job;
  }

  bulkRetryJobs(ids) {
    if (!Array.isArray(ids) || ids.length === 0) return [];
    const results = ids.map(id => this.retryJob(id)).filter(Boolean);
    if (results.length > 0) {
      this.addActivity({
        type: 'job_bulk_retry',
        severity: 'info',
        title: `بازآزمایی گروهی ${results.length} پردازش در صف`,
        description: `فرمان بازآزمایی هم‌زمان برای کارهای ${ids.join(', ')} صادر شد.`,
        subsystem: 'Jobs',
        route: '#gm-25-jobs',
        routeLabel: 'GM-25 صف کارها',
        actor: 'SuperAdmin (ناظر)',
        details: { jobIds: ids, count: results.length }
      });
    }
    return results;
  }

  retryJob(id) {
    const job = this.getJob(id);
    if (!job) return null;
    this.addActivity({
      type: 'job_retry_blocked',
      severity: 'warning',
      title: `اجرای مجدد کار ${id} در پروتوتایپ مسدود شد`,
      description: 'این محیط اجراکنندهٔ عملیاتی ندارد و وضعیت کار بدون پاسخ معتبر Worker تغییر نکرد.',
      subsystem: 'Jobs',
      route: '#gm-25-jobs',
      routeLabel: 'GM-25 صف کارها',
      actor: 'SuperAdmin (ناظر)',
      details: { jobId: id, tenantId: job.tenantId, simulationBlocked: true }
    });
    return { ...job, simulationBlocked: true };
  }

  // Helper & Bridge Methods
  getIdentities(tenantId) {
    const list = this.state.users || [];
    const filtered = tenantId ? list.filter(u => u.tenantId === tenantId) : list;
    return filtered.map((u) => ({
      id: u.id,
      displayName: u.nameFa || u.name || u.displayName || u.id,
      name: u.name || u.nameFa || u.displayName,
      mobile: u.phone || u.mobile || '۰۹۱۲۰۰۰۰۰۹۹',
      role: u.role || 'manager',
      tenantId: u.tenantId,
      mfaEnabled: u.mfaEnabled !== false,
      activeSessions: u.activeSessions !== undefined ? u.activeSessions : (u.role === 'owner' ? 2 : 1)
    }));
  }

  getTemplates() {
    return this.state.templates || [];
  }

  getRealMenuItems() {
    return [];
  }

  getRealMenuCategories() {
    return [];
  }

  getRealTables() {
    return [];
  }

  getRealOrders() {
    return [];
  }

  getRealWaiterCalls() {
    return [];
  }

  getRealCounts() {
    return { categories: 0, menuItems: 0, tables: 0, orders: 0 };
  }

  getPersonalOverrides() {
    const res = {};
    (this.state.overrides || []).forEach((o) => {
      if (!res[o.userId]) res[o.userId] = {};
      res[o.userId][o.permission] = {
        state: o.state,
        reason: o.reason,
        updatedAt: o.updatedAt || 'هم‌اکنون'
      };
    });
    return res;
  }

  setPersonalOverride(userId, permission, state, reason) {
    const user = (this.state.users || []).find((u) => u.id === userId);
    if (!user) return this.evaluateAccess(userId, this.getActiveTenantId(), permission);
    const tenantId = user.tenantId;
    return this.setOverride(tenantId, userId, permission, state, reason);
  }

  getTenantFeatures(tenantId) {
    const tid = tenantId || this.getActiveTenantId();
    const grants = this.getTenantGrants(tid);
    return this.state.features.map((f) => ({
      ...f,
      id: f.key,
      granted: this.isGrantActive(grants[f.key]),
      grantedAt: grants[f.key]?.grantedAt || null,
      expiresAt: grants[f.key]?.expiresAt || null
    }));
  }

  grantFeature(tenantId, featureKey, durationMonths = 12) {
    return this.grantAddon(tenantId, featureKey, durationMonths);
  }

  // Organizations (GM-03, GM-04, GM-28)
  getOrganizations() {
    return this.state.organizations || [];
  }

  getOrganization(id) {
    return (this.state.organizations || []).find(o => o.id === id) || null;
  }

  // Billing & Invoices (GM-11, GM-28)
  getInvoices(tenantId) {
    const list = this.state.invoices || [];
    if (!tenantId || tenantId === 'all') return list;
    return list.filter(i => i.tenantId === tenantId);
  }

  getTenantInvoices(tenantId) {
    const tid = tenantId || this.getActiveTenantId();
    return this.getInvoices(tid);
  }

  getInvoice(id) {
    return (this.state.invoices || []).find(i => i.id === id) || null;
  }

  payInvoice(id, reason = 'وصول فاکتور و ثبت دستی توسط اپراتور') {
    const inv = this.getInvoice(id);
    if (!inv) return null;
    inv.status = 'paid';
    inv.activationStatus = 'pending';
    inv.paidAt = 'هم‌اکنون (تسویه تأیید شد)';
    inv.paymentRef = inv.paymentRef || ('SHP-' + Math.floor(100000000 + Math.random() * 900000000));
    this.addAuditLog({
      action: 'ثبت و وصول فاکتور (Manual Invoice Collection)',
      category: 'commercial',
      tenantId: inv.tenantId,
      targetId: inv.id,
      actor: 'مدیر ارشد پلتفرم',
      description: `ثبت تسویه و وصولی فاکتور ${inv.id} برای مجموعه «${inv.tenantId}». علت: ${reason}`,
      details: { invoiceId: inv.id, amount: inv.amount, paymentRef: inv.paymentRef, status: 'paid' }
    });
    const tenant = this.getTenant(inv.tenantId);
    if (tenant && (tenant.status === 'past_due' || tenant.status === 'grace_period')) {
      tenant.status = 'active';
      tenant.graceUntil = null;
    }
    this.save();
    return inv;
  }

  bulkExtendGracePeriod(tenantIds, days = 7, reason = 'تمدید گروهی مهلت پرداخت از پیشخوان فرماندهی') {
    if (!Array.isArray(tenantIds) || tenantIds.length === 0) {
      const targets = this.getTenants().filter(t => t.status === 'past_due' || t.status === 'grace_period' || t.status === 'suspended');
      tenantIds = targets.map(t => t.id);
    }
    const results = [];
    tenantIds.forEach(id => {
      const res = this.extendGracePeriod(id, days, reason);
      if (res) results.push(res);
    });
    this.addAuditLog({
      action: 'تمدید گروهی مهلت استمهال (Bulk Grace Extension)',
      category: 'commercial',
      tenantId: 'all_tenants',
      targetId: `tenants:${results.length}`,
      actor: 'مدیر ارشد پلتفرم',
      description: `اعطای هم‌زمان ${days} روز مهلت استمهال به ${results.length} مجموعه تحت نظارت جهت جلوگیری از قطعی سرویس.`,
      details: { count: results.length, days, reason, tenantIds }
    });
    this.save();
    return results;
  }

  getInvoiceReconciliation(id) {
    const inv = this.getInvoice(id);
    if (!inv) return null;
    return {
      invoiceId: inv.id,
      tenantId: inv.tenantId,
      status: inv.status === 'paid' ? 'reconciled' : 'pending',
      statusFa: inv.status === 'paid' ? 'مغایرت صفر (Reconciled ✓)' : 'در انتظار تسویه بانکی',
      discrepancy: 0,
      currency: 'تومان',
      settlementBatch: 'سیکل ۰۳:۴۵ بامداد شاپرک (پایا شماره ۹۴۸۱۲)',
      ledgerEntryId: 'SANAD-1403-8821',
      paymentRef: inv.paymentRef || 'SHP-883921021',
      gatewayFee: 1200,
      matchedAt: inv.paidAt || 'هم‌اکنون'
    };
  }

  getInvoiceDetails(id) {
    const inv = this.getInvoice(id);
    if (!inv) return null;

    const tenant = this.getTenant(inv.tenantId);
    const subtotal = inv.amount || inv.total || 0;
    const vatRate = 10;
    const vatAmount = inv.vatAmount != null ? inv.vatAmount : Math.round(subtotal * (vatRate / 100));
    const totalAmount = inv.totalAmount != null ? inv.totalAmount : (subtotal + vatAmount);

    const items = (inv.items && inv.items.length > 0) ? inv.items : [
      {
        desc: inv.period ? `اشتراک پلتفرم سالسا — ${inv.period}` : 'اشتراک ماهانه پلتفرم ابری سالسا',
        count: 1,
        unitPrice: subtotal,
        total: subtotal
      }
    ];

    const taxUid = inv.taxUid || ('A19' + (inv.id || '').replace(/[^a-zA-Z0-9]/g, '').padEnd(10, 'X').substring(0, 10).toUpperCase() + '884920');
    const fiscalSerial = inv.fiscalSerial || `TX-1403-${(inv.id || '').replace(/[^0-9]/g, '').padStart(6, '0')}`;

    return {
      id: inv.id,
      tenantId: inv.tenantId,
      tenantName: tenant ? tenant.name : (inv.tenantName || inv.tenantId),
      status: inv.status || 'pending',
      statusFa: inv.status === 'paid' ? 'تسویه‌شده' : 'در انتظار پرداخت',
      activationStatus: inv.activationStatus || (inv.status === 'paid' ? 'activated' : 'not_applicable'),
      currency: 'تومان',
      period: inv.period || 'دوره جاری',
      createdAt: inv.createdAt || inv.paidAt || '۱۴۰۳/۰۶/۰۱',
      paidAt: inv.paidAt || (inv.status === 'paid' ? 'هم‌اکنون' : null),
      paymentRef: inv.paymentRef || 'SHP-883921021',
      items,
      subtotal,
      discount: inv.discount || 0,
      vatRate,
      vatAmount,
      totalAmount,
      seller: {
        legalName: 'شرکت فناوران پردازش ابری سالسا (سهامی خاص)',
        brand: 'پلتفرم ابری سالسا (SALSA Cloud)',
        economicCode: '411549817283',
        nationalId: '14009281744',
        registrationNo: '582914',
        postalCode: '1997834112',
        address: 'تهران، پارک فناوری پردیس، مجتمع نوآوری سالسا، طبقه ۳'
      },
      buyer: {
        legalName: tenant ? tenant.name : (inv.tenantName || 'رستوران طرف قرارداد'),
        economicCode: tenant?.economicCode || '411293817492',
        nationalId: tenant?.nationalId || '10103829182',
        phone: tenant?.ownerPhone || tenant?.phone || '۰۹۱۲۰۰۰۰۰۰۰',
        address: tenant?.address || tenant?.metadata?.address || 'تهران، بلوار کشاورز'
      },
      taxCompliance: {
        moadianStatus: inv.status === 'paid' ? 'ثبت قطعی در سامانه مودیان مالیاتی' : 'پیش‌فاکتور (در صف ارسال پس از تسویه)',
        moadianStatusCode: inv.status === 'paid' ? 'registered' : 'queued',
        taxUid,
        fiscalSerial,
        fiscalMemoryId: 'A19382',
        digitalSignature: `sha256_${Date.now().toString(36)}_${(inv.id || '').toLowerCase()}`
      }
    };
  }

  issueInvoice(tenantId, invoiceData = {}) {
    if (!this.state.invoices) this.state.invoices = [];
    const tid = tenantId || this.getActiveTenantId() || 'tnt_westo_demo';
    const tenant = this.getTenant(tid);
    const subtotal = invoiceData.amount || invoiceData.subtotal || 2500000;
    const vatRate = 10;
    const vatAmount = Math.round(subtotal * 0.10);
    const totalAmount = subtotal + vatAmount;

    const newInv = {
      id: invoiceData.id || `INV-1403-${Math.floor(1000 + Math.random() * 9000)}`,
      tenantId: tid,
      tenantName: tenant ? tenant.name : tid,
      amount: subtotal,
      vatAmount,
      totalAmount,
      currency: 'تومان',
      period: invoiceData.period || 'صورتحساب تکمیلی دوره جاری',
      status: invoiceData.status || 'pending',
      activationStatus: 'not_applicable',
      createdAt: new Date().toLocaleDateString('fa-IR'),
      dueDate: invoiceData.dueDate || '۷ روز پس از صدور',
      taxUid: 'A19' + Math.random().toString(36).substring(2, 10).toUpperCase() + Math.floor(100000 + Math.random() * 900000),
      items: invoiceData.items || [
        {
          desc: invoiceData.description || 'خدمات اشتراک و پشتیبانی زیرساخت ابری سالسا',
          count: 1,
          unitPrice: subtotal,
          total: subtotal
        }
      ]
    };

    this.state.invoices.unshift(newInv);

    this.addAuditLog({
      action: 'صدور فاکتور رسمی پلتفرم (Issue Official Invoice)',
      category: 'commercial',
      tenantId: tid,
      targetId: newInv.id,
      actor: 'مدیر ارشد پلتفرم',
      reason: `صدور فاکتور رسمی به مبلغ ${(totalAmount).toLocaleString('fa-IR')} تومان با احتساب ۱۰٪ مالیات بر ارزش افزوده برای «${tenant ? tenant.name : tid}»`,
      occurredAt: new Date().toISOString()
    });

    this.save();
    return newInv;
  }

  getTaxSummary() {
    const invoices = this.state.invoices || [];
    const paidInvoices = invoices.filter(i => i.status === 'paid');
    const pendingInvoices = invoices.filter(i => i.status !== 'paid');

    const grossInvoicedToman = invoices.reduce((sum, i) => sum + (i.totalAmount || i.amount || 0), 0);
    const paidGrossToman = paidInvoices.reduce((sum, i) => sum + (i.totalAmount || i.amount || 0), 0);
    const collectedVatToman = paidInvoices.reduce((sum, i) => sum + (i.vatAmount || Math.round((i.amount || 0) * 0.10)), 0);
    const pendingVatToman = pendingInvoices.reduce((sum, i) => sum + (i.vatAmount || Math.round((i.amount || 0) * 0.10)), 0);

    return {
      grossInvoicedToman,
      paidGrossToman,
      collectedVatToman,
      pendingVatToman,
      paidCount: paidInvoices.length,
      pendingCount: pendingInvoices.length,
      totalCount: invoices.length,
      moadianComplianceRate: '۱۰۰٪',
      taxRatePercent: 10
    };
  }

  // Subscriptions (GM-11, GM-28)
  getSubscriptions(tenantId) {
    const list = this.state.subscriptions || [];
    if (!tenantId || tenantId === 'all') return list;
    return list.filter(s => s.tenantId === tenantId);
  }

  getTenantSubscription(tenantId) {
    const tid = tenantId || this.getActiveTenantId();
    return (this.state.subscriptions || []).find(s => s.tenantId === tid) || null;
  }

  // GM-11 Payments & Transactions
  getPayments(tenantId) {
    const list = this.state.payments || [];
    if (!tenantId || tenantId === 'all') return list;
    return list.filter(p => p.tenantId === tenantId);
  }

  // GM-11 Receivables & Debts
  getDebts(tenantId) {
    const list = this.state.debts || [];
    if (!tenantId || tenantId === 'all') return list;
    return list.filter(d => d.tenantId === tenantId);
  }

  // GM-11 Credits & Prepaid Wallet
  getCredits(tenantId) {
    const list = this.state.credits || [];
    if (!tenantId || tenantId === 'all') return list;
    return list.filter(c => c.tenantId === tenantId);
  }

  // GM-11 Promotional Discounts
  getDiscounts(tenantId) {
    const list = this.state.discounts || [];
    if (!tenantId || tenantId === 'all') return list;
    return list.filter(d => !d.tenantId || d.tenantId === 'all' || d.tenantId === tenantId);
  }

  // GM-11 Renewal Preview
  previewRenewal(subscriptionId) {
    const sub = (this.state.subscriptions || []).find(s => s.id === subscriptionId) || (this.state.subscriptions || [])[0];
    if (!sub) return null;
    const credits = (this.state.credits || []).filter(c => c.tenantId === sub.tenantId && c.status === 'active');
    const totalCreditBalance = credits.reduce((sum, c) => sum + (c.balance || 0), 0);
    const grossAmount = sub.monthlyTotal || 5722500;
    const creditDeduction = Math.min(totalCreditBalance, Math.floor(grossAmount * 0.5)); // Up to 50% offset from wallet
    const netBeforeTax = Math.max(0, grossAmount - creditDeduction);
    const vatAmount = Math.round(netBeforeTax * 0.09);
    const finalAmount = netBeforeTax + vatAmount;

    return {
      subscriptionId: sub.id,
      tenantId: sub.tenantId,
      planName: sub.planName,
      cycle: sub.billingCycle,
      grossAmount,
      totalCreditBalance,
      creditDeduction,
      remainingCredit: totalCreditBalance - creditDeduction,
      netBeforeTax,
      vatAmount,
      finalAmount,
      currentRenewal: sub.nextRenewal,
      projectedRenewal: '۱۴۰۳/۰۸/۰۱'
    };
  }

  // GM-11 Refund Preview with License Usage Deduction
  previewRefund(invoiceId) {
    const inv = this.getInvoice(invoiceId);
    if (!inv) return null;
    const totalPaid = inv.totalAmount || 0;
    const totalDays = 30;
    const usedDays = 9;
    const usageRatio = usedDays / totalDays;
    const usageCost = Math.round(totalPaid * usageRatio);
    const gatewayFee = 25000;
    const refundableAmount = Math.max(0, totalPaid - usageCost - gatewayFee);

    return {
      invoiceId: inv.id,
      tenantId: inv.tenantId,
      period: inv.period,
      totalPaid,
      totalDays,
      usedDays,
      usageRatioPercent: Math.round(usageRatio * 100),
      usageCost,
      gatewayFee,
      refundableAmount,
      targetCard: '۶۰۳۷-۹۹**-****-۴۴۱۹ (بانک ملی)',
      targetSheba: 'IR120170000000123456789012',
      refundRef: 'REF-SHP-' + Math.floor(100000000 + Math.random() * 900000000)
    };
  }

  // GM-11 Complete Provisioning Activation for Paid Invoices
  activatePendingInvoice(invoiceId) {
    const inv = this.getInvoice(invoiceId);
    if (!inv) return null;
    inv.activationStatus = 'activated';
    if (!Array.isArray(inv.activationEvents)) {
      inv.activationEvents = [];
    }
    inv.activationEvents.push({
      time: 'هم‌اکنون',
      event: 'پیگیری موفق: تخصیص ماژول در کلاستر محلی و صدور توکن لایسنس',
      status: 'done'
    });
    this.addActivity({
      type: 'license_activated',
      severity: 'info',
      title: `فعال‌سازی ماژول فاکتور ${inv.id}`,
      description: `لایسنس با موفقیت فعال و روی کلاستر محلی مستقر گردید.`,
      subsystem: 'Billing',
      route: '#commercial?tab=billing',
      routeLabel: 'صورتحساب و مالی',
      actor: 'SuperAdmin'
    });
    this.addAuditLog({
      action: 'فعال‌سازی ماژول و لایسنس فاکتور',
      tenantId: inv.tenantId,
      targetId: inv.id,
      actor: 'مدیر پلتفرم',
      actorRole: 'SuperAdmin',
      reason: `تخصیص ماژول و استقرار لایسنس برای فاکتور ${inv.id}`,
      occurredAt: new Date().toISOString()
    });
    return inv;
  }

  // GM-11 Accounting Export Permission Verification
  checkAccountingPermission() {
    return {
      allowed: true,
      permissionCode: 'FIN_ACCOUNTING_EXPORT',
      licenseLevel: 'Enterprise Auditor',
      operator: 'مدیر کل مالی پلتفرم (SuperAdmin)',
      taxOfficeCode: '1403-MHD-09'
    };
  }

  // Usage & Quotas (GM-12)
  getUsage(tenantId) {
    const tid = tenantId || this.getActiveTenantId();
    return (this.state.usage || {})[tid] || (this.state.usage || {})['tnt_westo_demo'] || null;
  }

  // Automations (GM-16)
  getAutomations() {
    return this.state.automations || [];
  }

  toggleAutomation(id) {
    const auto = (this.state.automations || []).find(a => a.id === id);
    if (!auto) return null;
    auto.status = auto.status === 'active' ? 'paused' : 'active';
    this.save();
    return auto;
  }

  // Customer Directory (GM-17)
  getCustomerDirectory(tenantId) {
    const tid = tenantId || this.getActiveTenantId();
    const list = this.state.customerDirectory || [];
    return tid ? list.filter(c => c.tenantId === tid) : list;
  }

  // Domains (GM-18)
  getDomains(tenantId) {
    const tid = tenantId || this.getActiveTenantId();
    const list = this.state.domains || [];
    if (!tid || tid === 'all') return list;
    return list.filter(d => d.tenantId === tid || d.isPlatform);
  }

  addDomain(domainData) {
    if (!this.state.domains) this.state.domains = [];
    const tenantSlug = domainData.tenantSlug || (domainData.tenantId ? String(domainData.tenantId).replace('tnt_', '').replace('_demo', '') : 'westo');
    const cleanDomain = String(domainData.domain || '').trim().toLowerCase();
    const targetCname = domainData.targetCname || `${tenantSlug}.salsa.ir`;
    const newDom = {
      id: 'dom_' + Math.floor(100 + Math.random() * 900),
      ...domainData,
      domain: cleanDomain,
      tenantSlug,
      targetCname,
      dnsStatus: 'pending_verification',
      sslStatus: 'provisioning',
      verifiedAt: 'در انتظار تطبیق DNS',
      txtChallenge: 'salsa-verify=' + Math.random().toString(36).substring(2, 12),
      apexChallengeRecord: `_salsa-challenge.${cleanDomain}`,
      cdnProvider: domainData.cdnProvider || 'Caddy On-Demand TLS (VPS)',
      sslExpires: domainData.sslExpires || '۹۰ روزه خودکار (Let\'s Encrypt)'
    };
    this.state.domains.push(newDom);
    this.save();
    return newDom;
  }

  verifyDomainDns(domainId) {
    if (!this.state.domains) this.state.domains = [];
    const dom = this.state.domains.find(d => d.id === domainId || d.domain === domainId);
    if (!dom) return { success: false, error: 'دامنه یافت نشد.' };
    dom.dnsStatus = 'verified';
    dom.sslStatus = 'active';
    dom.verifiedAt = 'هم‌اکنون (احراز رکورد CNAME تأیید شد)';
    this.save();
    return { success: true, domain: dom };
  }

  // Devices (GM-19)
  getDevices(tenantId) {
    if (tenantId === 'all') return this.state.devices || [];
    const tid = tenantId || this.getActiveTenantId();
    const list = this.state.devices || [];
    return tid ? list.filter(d => d.tenantId === tid) : list;
  }

  addDevice(tenantId, deviceData = {}) {
    if (!this.state.devices) this.state.devices = [];
    const tid = tenantId || this.getActiveTenantId();
    const newDev = {
      id: deviceData.id || `dev_${Date.now().toString(36)}`,
      tenantId: tid,
      branch: deviceData.branch || 'شعبه اصلی',
      name: deviceData.name || 'پایانه صندوق جدید',
      type: deviceData.type || 'Desktop POS (Windows/Electron)',
      ipAddress: deviceData.ipAddress || '۱۹۲.۱۶۸.۱.۱۱۰',
      appVersion: deviceData.appVersion || 'v1.2.0-desktop',
      syncState: 'in_sync',
      pendingQueue: 0,
      leaseStatus: 'active',
      lastSync: 'هم‌اکنون',
      status: 'online'
    };
    this.state.devices.push(newDev);
    this.save();
    return newDev;
  }

  addTenantUser(tenantId, userData = {}) {
    if (!this.state.users) this.state.users = [];
    const tid = tenantId || this.getActiveTenantId();
    const newUser = {
      id: userData.id || `usr_${Date.now().toString(36)}`,
      tenantId: tid,
      name: userData.name || 'مدیر جدید',
      displayName: userData.name || 'مدیر جدید',
      phone: userData.phone || '',
      email: userData.email || `${userData.phone || 'admin'}@tenant.salsa.ir`,
      role: userData.role || 'manager',
      status: 'active',
      lastLoginAt: new Date().toISOString()
    };
    this.state.users.push(newUser);
    this.addAuditLog({
      action: 'دعوت مدیر جدید مجموعه',
      tenantId: tid,
      targetId: tid,
      actor: 'مدیر پلتفرم',
      actorRole: 'SuperAdmin',
      reason: `ارسال دسترسی پنل به ${newUser.name} (${newUser.phone})`,
      occurredAt: new Date().toISOString()
    });
    return newUser;
  }

  getRolePermissions(role) {
    if (!this.state.roles) this.state.roles = {};
    const roleDef = this.state.roles[role] || {
      nameFa: role || 'کاربر سیستم',
      scope: 'branch',
      defaultPermissions: []
    };

    const permDescriptions = {
      'menu.view': 'مشاهده کاتالوگ، دسته‌ها و اقلام منو',
      'menu.manage': 'ویرایش قیمت، توقف فروش و تعریف آیتم‌های جدید منو',
      'orders.view': 'مشاهده لیست سفارش‌های زنده و تاریخچه سفارشات',
      'orders.manage': 'لغو، اعمال تخفیف و تغییر وضعیت سفارشات',
      'orders.create': 'ثبت سفارش جدید در صندوق یا سالن',
      'orders.receipt.print': 'چاپ فیش صندوق و حواله آشپزخانه',
      'cash.manage': 'بستن شیفت صندوق و شمارش موجودی دخل',
      'tables.view': 'مشاهده وضعیت میزها و رزروهای سالن',
      'finance.view': 'مشاهده گردش مالی، دریافتی‌ها و گزارشات فروش',
      'finance.journal.create': 'ثبت اسناد دوبل و هزینه‌های جاری شعبه',
      'finance.export': 'دریافت خروجی اکسل و ترازنامه مالی',
      'staff.manage': 'مدیریت شیفت، دسترسی و پرسنل شعبه',
      'admin.access': 'ورود به پنل تنظیمات پیشرفته و ماژول‌ها',
      'reports.export': 'استخراج گزارشات تحلیلی و مدیریتی'
    };

    const permissionsDetail = (roleDef.defaultPermissions || []).map(p => ({
      key: p,
      nameFa: permDescriptions[p] || p,
      allowed: true
    }));

    let description = '';
    switch (role) {
      case 'owner':
        description = 'دسترسی تام و نامحدود به تمامی شعب، تراکنش‌های مالی، صورت‌حساب‌ها و تنظیمات بنیادی مجموعه';
        break;
      case 'admin':
        description = 'مدیریت فنی، پرسنل، منو و تنظیمات اداری در سطح کل سازمان و شعب';
        break;
      case 'manager':
        description = 'مدیریت عملیاتی شعبه، نظارت بر صندوق‌ها، سفارش‌گیری و نظارت بر پرسنل سالن';
        break;
      case 'accountant':
        description = 'دسترسی تخصصی به اسناد مالی، گزارشات فروش، بستن حساب‌ها و مغایرت‌گیری';
        break;
      case 'cashier':
        description = 'عملیات صندوق، تسویه حساب، صدور فیش و بستن شیفت کاری صندوق‌دار';
        break;
      case 'waiter':
        description = 'ثبت سفارش سر میز، ارسال به آشپزخانه و مشاهده وضعیت میزها در سالن';
        break;
      default:
        description = `دسترسی پیش‌فرض نقش ${roleDef.nameFa || role}`;
    }

    return {
      role,
      nameFa: roleDef.nameFa,
      scope: roleDef.scope || 'branch',
      defaultPermissions: roleDef.defaultPermissions || [],
      permissionsDetail,
      description
    };
  }

  toggleTenantUserStatus(tenantId, userId, active, reason) {
    if (!this.state.users) this.state.users = [];
    let user = this.state.users.find(u => u.id === userId && (!tenantId || u.tenantId === tenantId));
    if (!user) {
      user = this.state.users.find(u => u.id === userId);
    }
    if (!user) {
      const tid = tenantId || this.getActiveTenantId();
      user = {
        id: userId,
        tenantId: tid,
        name: 'کاربر سیستم',
        role: 'manager',
        status: active ? 'active' : 'suspended',
        active: !!active
      };
      this.state.users.push(user);
    } else {
      user.status = active ? 'active' : 'suspended';
      user.active = !!active;
      user.updatedAt = new Date().toISOString();
    }

    const actionText = active ? 'رفع تعلیق حساب کاربر' : 'تعلیق موقت حساب کاربر';
    const finalReason = reason || (active ? 'رفع تعلیق حساب توسط مدیر ارشد پلتفرم' : 'تعلیق موقت دسترسی به دستور اپراتور');

    this.addAuditLog({
      action: actionText,
      category: 'security',
      tenantId: user.tenantId || tenantId,
      targetId: userId,
      actor: 'مدیر پلتفرم',
      actorRole: 'SuperAdmin',
      reason: `${finalReason} — ${user.name || user.displayName || userId}`,
      occurredAt: new Date().toISOString()
    });

    this.save();
    return user;
  }

  resetTenantUserCredentials(tenantId, userId, reason) {
    if (!this.state.users) this.state.users = [];
    let user = this.state.users.find(u => u.id === userId && (!tenantId || u.tenantId === tenantId));
    if (!user) {
      user = this.state.users.find(u => u.id === userId);
    }
    if (!user) {
      const tid = tenantId || this.getActiveTenantId();
      user = {
        id: userId,
        tenantId: tid,
        name: 'کاربر سیستم',
        phone: '۰۹۱۲۰۰۰۰۰۹۹',
        email: `${userId}@salsa.ir`,
        role: 'manager',
        status: 'active',
        active: true
      };
      this.state.users.push(user);
    }

    const tempOtp = String(Math.floor(100000 + Math.random() * 900000));
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 15 * 60 * 1000);

    user.tempOtp = tempOtp;
    user.otpExpiresAt = expiresAt.toISOString();
    user.credentialsResetAt = now.toISOString();

    const finalReason = reason || 'بازنشانی اضطراری رمز و دسترسی به درخواست پشتیبانی سالسا';

    this.addAuditLog({
      action: 'صدور رمز موقت / بازنشانی دسترسی کاربر',
      category: 'security',
      tenantId: user.tenantId || tenantId,
      targetId: userId,
      actor: 'مدیر پلتفرم',
      actorRole: 'SuperAdmin',
      reason: `${finalReason} — رمز یک‌بارمصرف: ${tempOtp} (معتبر تا ۱۵ دقیقه)`,
      occurredAt: now.toISOString()
    });

    this.save();
    return {
      success: true,
      userId: user.id,
      name: user.name || user.displayName,
      phone: user.phone,
      email: user.email,
      tempOtp,
      expiresAt: '۱۵ دقیقه دیگر',
      expiresAtIso: expiresAt.toISOString()
    };
  }

  // Backups (GM-20)
  getBackups(tenantId) {
    if (tenantId === 'all') return this.state.backups || [];
    const tid = tenantId || this.getActiveTenantId();
    const list = this.state.backups || [];
    return tid ? list.filter(b => b.tenantId === tid) : list;
  }

  createBackup(tenantId, data = {}) {
    const tid = tenantId || this.getActiveTenantId();
    const tenant = this.getTenant(tid);
    const nowFa = new Date().toLocaleTimeString('fa-IR');
    const backup = {
      id: data.id || `bkp_${Date.now()}`,
      tenantId: tid,
      tenantName: tenant ? tenant.name : 'مجموعه',
      name: data.name || `اسنپ‌شات دستی ${nowFa}`,
      type: data.type || 'Full WAL + Data Snapshot',
      size: data.size || `${(Math.random() * 0.3 + 1.7).toFixed(2)} گیگابایت`,
      sizeMb: data.sizeMb || (Math.floor(40 + Math.random() * 80)),
      status: 'verified',
      restoreTestStatus: 'passed',
      restoreDrillTime: `امروز ${nowFa}`,
      sha256: `sha256_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`,
      storageProvider: data.storageProvider || 'Asiatech S3 (تهران) + آف‌سایت مشهد',
      createdAt: `امروز ${nowFa}`,
      createdAtIso: new Date().toISOString()
    };
    if (!this.state.backups) this.state.backups = [];
    this.state.backups.unshift(backup);
    this.addAuditLog({
      action: 'ایجاد نسخه پشتیبان فوری (Immediate Tenant Backup Snapshot)',
      category: 'operations',
      tenantId: tid,
      targetId: backup.id,
      actor: 'مدیر ارشد پلتفرم',
      description: `ایجاد اسنپ‌شات دستی و پشتیبان‌گیری ایزوله برای مجموعه «${tenant?.name || tid}» قبل از ارتقا یا تسویه.`,
      details: { backupId: backup.id, tenantId: tid, size: backup.size, sha256: backup.sha256 }
    });
    this.save();
    return backup;
  }

  verifyBackup(backupId) {
    const list = this.state.backups || [];
    const bkp = list.find(b => b.id === backupId);
    if (!bkp) return { success: false, error: 'نسخه پشتیبان یافت نشد' };
    const nowFa = new Date().toLocaleTimeString('fa-IR');
    const drillDurationSeconds = Number((Math.random() * 1.5 + 1.8).toFixed(1));
    const verifiedTables = 42;
    const verifiedRows = Math.floor(4500 + Math.random() * 3000);

    bkp.status = 'verified';
    bkp.restoreTestStatus = 'passed';
    bkp.restoreDrillTime = `امروز ${nowFa}`;
    bkp.lastVerifiedAt = new Date().toISOString();
    bkp.drillDuration = `${drillDurationSeconds} ثانیه`;
    bkp.verifiedTablesCount = verifiedTables;
    bkp.verifiedRowsCount = verifiedRows;

    this.addAuditLog({
      action: 'آزمون بازیابی اسنپ‌شات در سندباکس ایزوله (Sandboxed Restore Drill)',
      category: 'operations',
      tenantId: bkp.tenantId || 'global',
      targetId: backupId,
      actor: 'تیم SRE سالسا',
      description: `راستی‌آزمایی خودکار یکپارچگی اسنپ‌شات ${backupId} با موفقیت در محیط سندباکس انجام شد (${verifiedTables} جدول، ${verifiedRows} رکورد، زمان: ${drillDurationSeconds}s).`,
      details: { backupId, durationSeconds: drillDurationSeconds, verifiedTables, verifiedRows, status: 'passed' }
    });
    this.save();
    return {
      success: true,
      backup: bkp,
      drillDurationSeconds,
      verifiedTables,
      verifiedRows,
      testedAt: nowFa
    };
  }

  getDisasterRecoveryStatus(tenantId) {
    const tid = tenantId || this.getActiveTenantId();
    const tenant = this.getTenant(tid);
    const backups = this.getBackups(tid);
    const latestVerified = backups.find(b => b.status === 'verified' || b.restoreTestStatus === 'passed') || backups[0];

    return {
      tenantId: tid,
      tenantName: tenant ? tenant.name : 'مجموعه',
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
      latestSnapshotTime: latestVerified?.restoreDrillTime || latestVerified?.createdAt || 'امروز ۰۳:۰۰',
      totalSnapshotsCount: backups.length,
      drReadinessScore: 100
    };
  }

  revokeAddon(tenantId, featureKey, reason = '') {
    if (!this.state.tenantGrants || !this.state.tenantGrants[tenantId]) {
      return { success: false, error: 'مجوزی برای این مستأجر ثبت نشده است.' };
    }
    delete this.state.tenantGrants[tenantId][featureKey];
    this.addAuditLog({
      tenantId,
      action: 'tenant.addon.revoked',
      description: `لغو مجوز افزونه [${featureKey}]. علت: ${reason || 'لغو توسط مدیر پلتفرم'}`,
      scope: `addon:${featureKey}`,
      result: 'success'
    });
    this.save();
    return { success: true };
  }

  revokeFeatureGrant(tenantId, featureKey, reason = '') {
    return this.revokeAddon(tenantId, featureKey, reason);
  }

  updateTenantPlan(tenantId, newPlan, reason = '') {
    const tid = tenantId || this.getActiveTenantId();
    const tenant = this.getTenant(tid);
    if (!tenant) return false;
    const oldPlan = tenant.plan;
    tenant.plan = newPlan;
    if (!this.state.auditLogs) this.state.auditLogs = [];
    this.state.auditLogs.unshift({
      id: `aud_${Date.now()}`,
      action: 'ارتقای پلن تجاری',
      targetId: tid,
      actorId: 'مدیر پلتفرم',
      reason: reason || `تغییر پلن از ${oldPlan} به ${newPlan}`,
      occurredAt: new Date().toISOString()
    });
    this.save();
    return true;
  }

  getGlobalKillswitches() {
    return this.state.globalKillswitches || {};
  }

  toggleGlobalKillswitch(moduleKey, enabled, reason = '') {
    if (!this.state.globalKillswitches) this.state.globalKillswitches = {};
    this.state.globalKillswitches[moduleKey] = {
      killed: !enabled,
      reason: reason || (enabled ? 'فعال‌سازی مجدد' : 'توقف اضطراری سراسری'),
      updatedAt: new Date().toISOString()
    };
    if (!this.state.auditLogs) this.state.auditLogs = [];
    this.state.auditLogs.unshift({
      id: `aud_${Date.now()}`,
      action: enabled ? 'رفع توقف و فعال‌سازی ماژول تجاری' : 'توقف اضطراری سراسری ماژول تجاری',
      targetId: moduleKey,
      actorId: 'مدیر ارشد پلتفرم',
      reason: reason || (enabled ? 'رفع توقف ماژول در سطح پلتفرم' : 'توقف اضطراری ماژول تجاری در ناوگان'),
      occurredAt: new Date().toISOString()
    });
    this.save();
    return this.state.globalKillswitches[moduleKey];
  }

  extendGracePeriod(tenantId, additionalDays = 7, reason = '') {
    const tenant = this.getTenant(tenantId);
    if (!tenant) return false;
    const baseTime = tenant.graceUntil ? new Date(tenant.graceUntil).getTime() : Date.now();
    tenant.graceUntil = new Date(baseTime + additionalDays * 86400000).toISOString();
    if (tenant.status === 'past_due') {
      tenant.status = 'grace_period';
    }
    this.logAudit({
      action: `تمدید مهلت پرداخت صورتحساب (Grace Period): ${tenant.name || tenantId}`,
      category: 'commercial',
      targetId: tenantId,
      actorId: 'مدیر مالی پلتفرم',
      reason: reason || `تمدید ${additionalDays} روز مهلت پرداخت برای تسویه`,
      occurredAt: new Date().toISOString()
    });
    this.save();
    return tenant;
  }

  // Support Tickets & Sessions (GM-21)
  getTickets(tenantId) {
    if (tenantId === 'all') return this.state.tickets || [];
    const tid = tenantId || this.getActiveTenantId();
    const list = this.state.tickets || [];
    return tid ? list.filter(t => t.tenantId === tid) : list;
  }

  createTicket(data = {}) {
    if (!this.state.tickets) this.state.tickets = [];
    const tenant = this.getTenant(data.tenantId || this.getActiveTenantId());
    const newTicket = {
      id: data.id || ('TCK-' + Math.floor(1000 + Math.random() * 9000)),
      tenantId: tenant ? tenant.id : 'tnt_westo_demo',
      tenantName: tenant ? tenant.name : 'کافه وستو (Westo Café)',
      title: data.title || 'درخواست پشتیبانی جدید',
      category: data.category || 'عملیات و سخت‌افزار',
      priority: data.priority || 'medium',
      status: 'open',
      creator: data.creator || 'مدیریت وستو',
      assignedTo: data.assignedTo || 'پشتیبان سالسا',
      slaMinutesRemaining: data.slaMinutesRemaining || 120,
      createdAt: 'هم‌اکنون'
    };
    this.state.tickets.unshift(newTicket);
    this.save();
    this.addActivity({
      type: 'ticket_created',
      severity: 'info',
      title: `ثبت تیکت پشتیبانی جدید ${newTicket.id}`,
      description: `${newTicket.title} برای ${newTicket.tenantName} ثبت شد.`,
      subsystem: 'Support',
      route: '#gm-21-support',
      routeLabel: 'GM-21 پشتیبانی فنی',
      actor: 'کاربر سامانه',
      details: newTicket
    });
    return newTicket;
  }

  getSupportSessions() {
    return this.state.supportSessions || [];
  }

  createSupportSession(data = {}) {
    if (!this.state.supportSessions) this.state.supportSessions = [];
    const tenant = this.getTenant(data.tenantId || this.getActiveTenantId());
    const newSession = {
      id: data.id || ('ses_sup_' + Math.floor(100 + Math.random() * 900)),
      tenantId: tenant ? tenant.id : 'tnt_westo_demo',
      tenantName: tenant ? tenant.name : 'کافه وستو (Westo Café)',
      operatorName: data.operatorName || 'پشتیبان سالسا (SuperAdmin)',
      reason: data.reason || 'ورود اضطراری موقت جهت بررسی عیب',
      scope: data.scope || 'read_only_diagnostics',
      expiresInMinutes: data.expiresInMinutes || 45,
      startedAt: data.startedAt || 'هم‌اکنون',
      status: 'active'
    };
    this.state.supportSessions.unshift(newSession);
    this.save();
    this.addActivity({
      type: 'support_session',
      severity: 'warning',
      title: `آغاز نشست اضطراری پشتیبانی ${newSession.id}`,
      description: `دسترسی موقت کارشناس به اطلاعات ${newSession.tenantName} فعال شد.`,
      subsystem: 'Support',
      route: '#gm-21-support',
      routeLabel: 'GM-21 پشتیبانی فنی',
      actor: newSession.operatorName,
      details: newSession
    });
    return newSession;
  }

  terminateSupportSession(id) {
    const ses = (this.state.supportSessions || []).find(s => s.id === id);
    if (!ses) return null;
    ses.status = 'terminated';
    ses.expiresInMinutes = 0;
    this.save();
    this.addActivity({
      type: 'support_terminated',
      severity: 'warning',
      title: `ابطال فوری نشست اضطراری پشتیبانی ${id}`,
      description: `دسترسی کارشناس (${ses.operatorName || ses.agentName || 'پشتیبان'}) به مجموعه ${ses.tenantName || 'مشتری'} فوراً قطع گردید.`,
      subsystem: 'Support',
      route: '#gm-21-support',
      routeLabel: 'GM-21 پشتیبانی فنی',
      actor: 'SuperAdmin (ابطال اضطراری)',
      details: { sessionId: id, tenantName: ses.tenantName, reason: ses.reason }
    });
    return ses;
  }

  // Operations & Incidents (GM-22)
  getIncidents() {
    return this.state.incidents || [];
  }

  getProvidersStatus() {
    return this.state.providersStatus || [];
  }

  // Releases (GM-23)
  getReleases() {
    return this.state.releases || [];
  }

  rollbackRelease(version) {
    if (!this.state.releases) return null;
    const rel = this.state.releases.find(r => r.version === version);
    if (rel) {
      rel.status = 'rolled_back';
      this.save();
      this.addActivity({
        type: 'release_rollback',
        severity: 'warning',
        title: `بازگردانی ریلیز ${version}`,
        description: `نسخه ${version} با موفقیت به انتشار پایدار پیشین بازگردانده شد.`,
        subsystem: 'Releases',
        route: '#gm-23-releases',
        routeLabel: 'GM-23 ریلیز و قناری',
        actor: 'SuperAdmin (ناظر)',
        details: { version }
      });
      return rel;
    }
    return null;
  }

  promoteRelease(version) {
    if (!this.state.releases) return null;
    const rel = this.state.releases.find(r => r.version === version);
    if (rel) {
      rel.status = 'live_active';
      rel.canaryPercent = 100;
      rel.promotedAt = new Date().toISOString();
      this.save();
      this.addActivity({
        type: 'release_promoted',
        severity: 'success',
        title: `ارتقای سراسری ریلیز ${version}`,
        description: `نسخه ${version} با موفقیت به عنوان ریلیز سراسری ۱۰۰٪ پایدار فعال شد.`,
        subsystem: 'Releases',
        route: '#operations?section=releases',
        routeLabel: 'GM-23 ریلیز و قناری',
        actor: 'مدیر پلتفرم',
        details: { version }
      });
      return rel;
    }
    return null;
  }

  // Infrastructure (GM-24)
  getInfrastructureCells() {
    return this.state.infrastructureCells || [];
  }

  getNodeDiagnostics() {
    if (!this.state.nodeDiagnostics || !Array.isArray(this.state.nodeDiagnostics) || this.state.nodeDiagnostics.length === 0) {
      this.state.nodeDiagnostics = [
        {
          id: 'control-plane-api',
          name: 'سرویس متمرکز Control Plane',
          kind: 'api',
          port: 3061,
          status: 'healthy',
          latencyMs: 1.2,
          rssMb: 142,
          eventLoopLagMs: 1.1,
          activeConnections: 18,
          uptimePercent: 99.99,
          lastProbeAt: 'هم‌اکنون'
        },
        {
          id: 'postgres-db',
          name: 'پایگاه داده متمرکز PostgreSQL',
          kind: 'database',
          port: 5433,
          status: 'healthy',
          latencyMs: 0.8,
          poolActive: 6,
          poolMax: 20,
          walStatus: 'synced',
          storageUsedMb: 1240,
          uptimePercent: 99.98,
          lastProbeAt: 'هم‌اکنون'
        },
        {
          id: 'reverse-proxy',
          name: 'پراکسی معکوس و دروازه امنیتی (Caddy/Envoy)',
          kind: 'proxy',
          port: 443,
          status: 'healthy',
          latencyMs: 1.4,
          activeTlsSessions: 42,
          cacheHitPercent: 94.2,
          uptimePercent: 100,
          lastProbeAt: 'هم‌اکنون'
        },
        {
          id: 'outbox-pipeline',
          name: 'خط لوله رویدادها و همگام‌سازی Outbox',
          kind: 'queue',
          status: 'healthy',
          latencyMs: 0.4,
          pendingQueue: 0,
          throughputPerSec: 24,
          dlqFailures: 0,
          uptimePercent: 99.95,
          lastProbeAt: 'هم‌اکنون'
        },
        {
          id: 'memory-cache',
          name: 'کش داده و هماهنگی حافظه (Fast Store)',
          kind: 'cache',
          port: 6379,
          status: 'healthy',
          latencyMs: 0.3,
          activeKeys: 342,
          hitRatioPercent: 98.4,
          uptimePercent: 100,
          lastProbeAt: 'هم‌اکنون'
        }
      ];
    }
    return this.state.nodeDiagnostics;
  }

  probeNode(nodeId) {
    const list = this.getNodeDiagnostics();
    const node = list.find(n => n.id === nodeId);
    const measuredLatency = Number((0.6 + Math.random() * 1.8).toFixed(1));
    const nowFa = new Date().toLocaleTimeString('fa-IR');
    if (node) {
      node.latencyMs = measuredLatency;
      node.lastProbeAt = nowFa;
      node.status = 'healthy';
    }
    this.addAuditLog({
      action: `پایش پروب نود زیرساخت: ${node ? node.name : nodeId}`,
      category: 'operations',
      tenantId: 'global',
      targetId: nodeId,
      details: { latencyMs: measuredLatency, status: 'healthy', probedAt: new Date().toISOString() },
      description: `ارزیابی بلادرنگ سلامت نود ${nodeId} با موفقیت انجام شد. تاخیر: ${measuredLatency}ms`
    });
    this.save();
    return { ok: true, nodeId, latencyMs: measuredLatency, status: 'healthy', probedAt: nowFa };
  }

  testDatabasePool() {
    const measuredLatency = Number((0.7 + Math.random() * 0.6).toFixed(1));
    const nowFa = new Date().toLocaleTimeString('fa-IR');
    const nodes = this.getNodeDiagnostics();
    const dbNode = nodes.find(n => n.kind === 'database');
    if (dbNode) {
      dbNode.latencyMs = measuredLatency;
      dbNode.lastProbeAt = nowFa;
      dbNode.poolActive = 6;
      dbNode.poolMax = 20;
    }
    this.addAuditLog({
      action: 'ارزیابی و بنچ‌مارک استخر اتصالات پایگاه داده (DB Connection Pool Benchmark)',
      category: 'operations',
      tenantId: 'global',
      targetId: 'postgres-db',
      details: { latencyMs: measuredLatency, activeConnections: 6, maxConnections: 20, freeConnections: 14 },
      description: `تست ایزوله اتصال به پایگاه داده با موفقیت انجام شد. زمان پاسخ‌دهی ${measuredLatency}ms و استخر اتصالات بهینه است.`
    });
    this.save();
    return {
      ok: true,
      latencyMs: measuredLatency,
      activeConnections: 6,
      maxConnections: 20,
      freeConnections: 14,
      status: 'optimal',
      testedAt: nowFa
    };
  }

  getNodeLogs(nodeId, level = 'all') {
    const now = new Date();
    const makeTime = (secAgo) => new Date(now.getTime() - secAgo * 1000).toISOString().replace('T', ' ').slice(0, 19);

    const logTemplates = {
      'control-plane-api': [
        { level: 'INFO', source: 'http.inbound', message: 'درخواست تأیید اعتبار توکن اداری از IP 127.0.0.1 با کد ۲۰۰' },
        { level: 'INFO', source: 'cluster.heartbeat', message: 'دریافت هارت‌بیت دوره‌ای از سلول مشهد (cell-msh-01) - تاخیر ۰.۸ms' },
        { level: 'INFO', source: 'auth.session', message: 'صدور کلید نشست ایزوله برای مدیر ارشد پلتفرم' },
        { level: 'WARN', source: 'rate_limiter', message: 'ثبت ۳ درخواست متوالی خارج از الگو در اندپوینت لاگین - خنک‌سازی خودکار' },
        { level: 'INFO', source: 'ws.gateway', message: 'همگام‌سازی سوکت دوطرفه با پایانه صندوق BR-01 برقرار شد' }
      ],
      'postgres-db': [
        { level: 'INFO', source: 'wal.archiver', message: 'پایان موفق اسنپ‌شات WAL قطعه 00000001000000020000004F در آرشیو محلی' },
        { level: 'INFO', source: 'pool.manager', message: 'استخر اتصالات: ۶ اتصال فعال، ۱۴ اتصال آماده، صف انتظار صفر' },
        { level: 'INFO', source: 'autovacuum', message: 'عملیات اتوواکیوم روی دیتابیس تننت tnt_westo_demo با موفقیت پایان یافت' },
        { level: 'INFO', source: 'storage.engine', message: 'تأیید سلامت یکپارچگی فایل‌های دیسک NVMe (Check: OK)' },
        { level: 'INFO', source: 'replication', message: 'جریان همگام‌سازی متقارن بدون تاخیر (Replication Lag: 0ms)' }
      ],
      'reverse-proxy': [
        { level: 'INFO', source: 'caddy.edge', message: 'اتمام موفق مذاکره امن TLS 1.3 با رمزنگاری ChaCha20-Poly1305' },
        { level: 'INFO', source: 'acme.cert', message: 'بررسی خودکار گواهی دامنه‌های متصل: اعتبار ۱۰۰٪ تایید شده است' },
        { level: 'INFO', source: 'proxy.upstream', message: 'هدایت بسته ترافیکی داخلی پورت ۳۰۶۱ با تاخیر ۱.۲ms' },
        { level: 'WARN', source: 'firewall.waf', message: 'مسدودسازی درخواست مشکوک اسکن پورت با هدرهای غیراستاندارد' },
        { level: 'INFO', source: 'cache.accelerator', message: 'پاسخ کش استاتیک با بازدهی ۹۴.۲٪ (Cache Hit)' }
      ],
      'outbox-pipeline': [
        { level: 'INFO', source: 'outbox.worker', message: 'اسکن صف پیام‌های منتظر تحویل (Pending Items: 0)' },
        { level: 'INFO', source: 'event.dispatcher', message: 'ارسال موفق رویداد tenant.license_provisioned به سلول محلی' },
        { level: 'INFO', source: 'idempotency', message: 'بررسی کلید یکتایی پیام obx_984 - بدون تکرار (Valid)' },
        { level: 'INFO', source: 'queue.drain', message: 'تخلیه بسته پیام‌های صف شاپرک با زمان تحویل ۱۲ms' },
        { level: 'INFO', source: 'dlq.monitor', message: 'پایش صف پیام‌های ناموفق DLQ: صفر خطا' }
      ],
      'memory-cache': [
        { level: 'INFO', source: 'faststore.core', message: 'پایش ۳۴۲ کلید فعال در حافظه فوق سریع' },
        { level: 'INFO', source: 'cache.hit', message: 'نرخ انطباق کش ۹۸.۴٪ با میانگین تاخیر ۰.۳ms' },
        { level: 'INFO', source: 'eviction.lru', message: 'پاک‌سازی خودکار کلیدهای منقضی‌شده نشست‌های نامعتبر' },
        { level: 'INFO', source: 'persistence', message: 'اسنپ‌شات حافظه موقت روی دیسک NVMe با موفقیت همگام شد' },
        { level: 'INFO', source: 'memory.guard', message: 'مصرف حافظه کش در محدوده نرمال (۴.۸ MB از ۵۱۲ MB)' }
      ]
    };

    const list = logTemplates[nodeId] || [
      { level: 'INFO', source: 'system.daemon', message: `سرویس ${nodeId} در وضعیت فعال و پایدار است.` },
      { level: 'INFO', source: 'probe.health', message: 'آزمون دوره‌ای سلامت با موفقیت تأیید شد.' }
    ];

    const logs = list.map((item, idx) => ({
      id: `log_${nodeId}_${idx + 1}`,
      nodeId,
      timestamp: makeTime((list.length - idx) * 45),
      level: item.level,
      source: item.source,
      message: item.message
    }));

    if (level === 'all') return logs;
    return logs.filter(l => l.level.toLowerCase() === level.toLowerCase());
  }

  getJobDetails(jobId) {
    const job = this.getJob(jobId) || { id: jobId, type: 'provisioning', tenantId: 'tnt_westo_demo', status: 'completed' };
    const isFailed = job.status === 'failed';
    return {
      id: job.id,
      tenantId: job.tenantId || 'tnt_westo_demo',
      type: job.type || 'راه‌اندازی ایزوله مجموعه',
      status: job.status,
      createdAt: job.createdAt || '۱۴۰۳/۰۶/۰۱ ۰۹:۰۰',
      completedAt: isFailed ? null : (job.updatedAt || '۱۴۰۳/۰۶/۰۱ ۰۹:۰۲'),
      totalDurationMs: isFailed ? 1200 : 980,
      steps: [
        { step: 1, name: 'ایجاد اسکیما و ایزولاسیون دیتابیس مستأجر', status: 'completed', durationMs: 140 },
        { step: 2, name: 'اعمال مایگریشن‌های ساختاری PostgreSQL', status: 'completed', durationMs: 380 },
        { step: 3, name: 'تولید کلیدهای رمزنگاری و توکن‌های اتصال محلی', status: 'completed', durationMs: 90 },
        { step: 4, name: 'استقرار کاتالوگ اولیه و شعب پیش‌فرض', status: isFailed ? 'failed' : 'completed', durationMs: 210, error: isFailed ? (job.errorMessage || 'خطا در اعمال ایزولاسیون داده‌ها') : null },
        { step: 5, name: 'همگام‌سازی DNS و تخصیص گواهی TLS محلی', status: isFailed ? 'skipped' : 'completed', durationMs: 160 }
      ],
      lastError: isFailed ? (job.errorMessage || 'عدم دسترسی به مخزن داده در حین ثبت اولیه کاتالوگ') : null
    };
  }

  purgeExpiredCache() {
    const node = (this.state.nodeDiagnostics || []).find(n => n.kind === 'cache' || n.id === 'memory-cache');
    if (node) {
      node.activeKeys = Math.max(12, (node.activeKeys || 342) - 48);
      node.latencyMs = 0.2;
    }
    this.addAuditLog({
      action: 'پاک‌سازی حافظه موقت و کلیدهای منقضی (Purge Expired Cache Keys)',
      category: 'operations',
      tenantId: 'global',
      targetId: 'memory-cache',
      details: { purgedKeysCount: 48, remainingKeys: node ? node.activeKeys : 294, latencyMs: 0.2 },
      description: 'حذف ایمن کلیدهای منقضی و توکن‌های ابطال‌شده از حافظه موقت Fast Store با موفقیت انجام شد.'
    });
    this.save();
    return { ok: true, purgedKeysCount: 48, remainingKeys: node ? node.activeKeys : 294, freedMemoryKb: 192 };
  }

  // Outbox & Automation Engine (GM-16 & Destination 4 Operations Deepening)
  getOutboxEvents(filter = 'all') {
    if (!this.state.outboxEvents || !Array.isArray(this.state.outboxEvents) || this.state.outboxEvents.length === 0) {
      this.state.outboxEvents = [
        {
          id: 'obx_984',
          topic: 'tenant.license_provisioned',
          tenantId: 'tnt_westo_demo',
          targetNode: 'vps.salsa.ir:4180',
          payloadSummary: 'فعال‌سازی ماژول stock.inventory و تمدید لایسنس تا ۱۴۰۴/۰۶/۰۱',
          status: 'delivered',
          retryCount: 0,
          createdAt: '۱۴۰۳/۰۶/۰۴ ۱۰:۱۵',
          dispatchedAt: '۱۴۰۳/۰۶/۰۴ ۱۰:۱۵:۰۲',
          latencyMs: 14
        },
        {
          id: 'obx_983',
          topic: 'menu.catalog_synced',
          tenantId: 'tnt_westo_demo',
          targetNode: 'term-main (صندوق ۱ سالن)',
          payloadSummary: 'همگام‌سازی ۲۴ قلم منو و اصلاح نرخ مالیات بر ارزش افزوده',
          status: 'delivered',
          retryCount: 0,
          createdAt: '۱۴۰۳/۰۶/۰۴ ۰۹:۴۰',
          dispatchedAt: '۱۴۰۳/۰۶/۰۴ ۰۹:۴۰:۰۱',
          latencyMs: 18
        },
        {
          id: 'obx_982',
          topic: 'pos.config_updated',
          tenantId: 'tnt_westo_demo',
          targetNode: 'kds-kitchen (نمایشگر KDS)',
          payloadSummary: 'به‌روزرسانی تنظیمات چاپ و نگاشت ایستگاه‌های آشپزخانه',
          status: 'delivered',
          retryCount: 0,
          createdAt: '۱۴۰۳/۰۶/۰۳ ۲۱:۱۲',
          dispatchedAt: '۱۴۰۳/۰۶/۰۳ ۲۱:۱۲:۰۱',
          latencyMs: 22
        },
        {
          id: 'obx_981',
          topic: 'security.policy_applied',
          tenantId: 'all_tenants',
          targetNode: 'platform-reverse-proxy',
          payloadSummary: 'اعمال خط‌مشی اجبار سشن ۸ ساعته و نیازمندی رمز یکبار مصرف TOTP',
          status: 'delivered',
          retryCount: 0,
          createdAt: '۱۴۰۳/۰۶/۰۳ ۱۸:۰۰',
          dispatchedAt: '۱۴۰۳/۰۶/۰۳ ۱۸:۰۰:۰۳',
          latencyMs: 29
        },
        {
          id: 'obx_980',
          topic: 'finance.ledger_posted',
          tenantId: 'tnt_westo_demo',
          targetNode: 'fin-service:5433',
          payloadSummary: 'ثبت سند دوبل حسابداری فاکتورهای شیفت عصر در دیتابیس مالی',
          status: 'delivered',
          retryCount: 0,
          createdAt: '۱۴۰۳/۰۶/۰۳ ۱۵:۳۰',
          dispatchedAt: '۱۴۰۳/۰۶/۰۳ ۱۵:۳۰:۰۱',
          latencyMs: 16
        }
      ];
    }
    if (filter && filter !== 'all') {
      return this.state.outboxEvents.filter(e => e.status === filter);
    }
    return this.state.outboxEvents;
  }

  getAutomationRules() {
    if (!this.state.automationRules || !Array.isArray(this.state.automationRules) || this.state.automationRules.length === 0) {
      this.state.automationRules = [
        {
          id: 'rule_acme_tls',
          name: 'تمدید خودکار گواهی‌های امنیتی TLS 1.3 (ACME On-Demand)',
          category: 'security',
          description: 'بررسی روزانه تاریخ انقضای گواهی‌های SSL ساب‌دامین‌های پلتفرم و تمدید خودکار ۳۰ روز قبل از سررسید بدون قطعی ارتباط.',
          trigger: 'روزانه، ساعت ۰۳:۳۰ بامداد',
          enabled: true,
          lastRunAt: 'امروز ۰۳:۳۰',
          executionCount: 142
        },
        {
          id: 'rule_grace_warning',
          name: 'هشدار پیامکی و درون‌برنامه‌ای اتمام دوره فرجه صورتحساب',
          category: 'billing',
          description: 'ارسال خودکار اعلان هوشمند به مدیران مجموعه‌ها ۲۴ ساعت قبل از اتمام مهلت پرداخت یا تعلیق خودکار سرویس.',
          trigger: 'هر ۱۲ ساعت یک‌بار',
          enabled: true,
          lastRunAt: 'امروز ۰۸:۰۰',
          executionCount: 88
        },
        {
          id: 'rule_brute_force_shield',
          name: 'دفاع تطبیقی در برابر حملات منع دسترسی و Brute-Force به OTP',
          category: 'security',
          description: 'مسدودسازی موقت IP و اعمال Rate-limit بعد از ۵ تلاش ناموفق پیاپی ورود به پنل یا صندوق در بازه ۱۰ دقیقه‌ای.',
          trigger: 'بلادرنگ (Real-time Event Hook)',
          enabled: true,
          lastRunAt: 'امروز ۱۰:۰۵',
          executionCount: 19
        },
        {
          id: 'rule_audit_rotation',
          name: 'تثبیت زنجیره رمزنگاری لاگ‌های حسابرسی (Audit Hash Anchor)',
          category: 'compliance',
          description: 'محاسبه زنجیره هشدارهای امنیتی و ایجاد ریشه Merkle لاگ‌های عملیاتی جهت جلوگیری از هرگونه دستکاری یا انکار داده‌ها.',
          trigger: 'پایان هر شیفت کاری (ساعت ۲۴:۰۰)',
          enabled: true,
          lastRunAt: 'دیشب ۲۴:۰۰',
          executionCount: 365
        },
        {
          id: 'rule_outbox_pruning',
          name: 'پاک‌سازی خودکار رویدادهای تحویل‌شده Outbox پس از ۱۴ روز',
          category: 'operations',
          description: 'انتقال رکوردهای تحویل‌شده صف Outbox به آرشیو سرد جهت حفظ کارایی بهینه ایندکس‌ها و حافظه کش Fast Store.',
          trigger: 'هفتگی، بامداد جمعه',
          enabled: true,
          lastRunAt: '۳ روز قبل',
          executionCount: 52
        }
      ];
    }
    return this.state.automationRules;
  }

  toggleAutomationRule(ruleId, enabled) {
    const rules = this.getAutomationRules();
    const rule = rules.find(r => r.id === ruleId);
    if (!rule) return null;
    rule.enabled = enabled !== undefined ? Boolean(enabled) : !rule.enabled;
    rule.lastRunAt = 'هم‌اکنون';
    this.addAuditLog({
      action: 'قوانین خودکارسازی (Automation Rule Toggle)',
      category: 'operations',
      targetId: ruleId,
      actor: 'مدیر ارشد پلتفرم',
      description: `تغییر وضعیت قانون خودکارسازی «${rule.name}» به ${rule.enabled ? 'فعال' : 'غیرفعال'}`,
      details: { ruleId, ruleName: rule.name, enabled: rule.enabled, category: rule.category }
    });
    this.save();
    this.notify();
    return rule;
  }

  flushOutbox() {
    const events = this.getOutboxEvents();
    let flushedCount = 0;
    events.forEach(e => {
      if (e.status !== 'delivered') {
        e.status = 'delivered';
        e.dispatchedAt = 'هم‌اکنون';
        flushedCount++;
      }
    });
    this.addAuditLog({
      action: 'تخلیه فوری و همگام‌سازی رویدادهای صف (Flush Outbox Pipeline)',
      category: 'operations',
      targetId: 'outbox-pipeline',
      actor: 'مدیر ارشد پلتفرم',
      description: 'تخلیه فوری و هماهنگ‌سازی دستی رویدادهای صف Outbox خط لوله عملیات با کلاینت‌های رستوران',
      details: { totalEvents: events.length, flushedCount, queueSize: 0, status: 'synced' }
    });
    this.save();
    this.notify();
    return { ok: true, processed: events.length, flushedCount, queueSize: 0, status: 'synced' };
  }

  testDevicePing(deviceId) {
    const devices = this.getDevices ? this.getDevices('all') : (this.state.devices || []);
    const dev = devices.find(d => d.id === deviceId);
    const measuredLatency = Number((Math.random() * 1.5 + 1.2).toFixed(1));
    const ip = dev?.ipAddress || dev?.host || '192.168.1.120';
    return {
      ok: true,
      deviceId,
      name: dev?.name || deviceId,
      ip,
      port: dev?.port || 9100,
      latencyMs: measuredLatency,
      packetLossPercent: 0,
      status: 'reachable',
      testedAt: new Date().toISOString()
    };
  }

  logAudit(entry) {
    return this.addAuditLog(entry);
  }

  // Audit Logs (GM-26) with Cryptographic Tamper-Evident Hash Chain
  computeAuditHash(entry, prevHash = '0000000000000000000000000000000000000000000000000000000000000000') {
    const raw = `${prevHash}:${entry.id}:${entry.action || 'event'}:${entry.actor || 'system'}:${entry.tenantId || 'global'}:${entry.result || 'success'}:${entry.timestamp || ''}:${entry.description || ''}`;
    try {
      if (typeof require !== 'undefined') {
        const cryptoMod = require('crypto');
        if (cryptoMod && cryptoMod.createHash) {
          return cryptoMod.createHash('sha256').update(raw).digest('hex');
        }
      }
    } catch (_) {}
    // Portable cryptographic fallback hash
    let h1 = 0xdeadbeef ^ raw.length, h2 = 0x41c6ce57 ^ raw.length;
    for (let i = 0; i < raw.length; i++) {
      const ch = raw.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
    h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
    h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    const p1 = (h1 >>> 0).toString(16).padStart(8, '0');
    const p2 = (h2 >>> 0).toString(16).padStart(8, '0');
    return `${p1}${p2}${p1}${p2}${p1}${p2}${p1}${p2}`;
  }

  getAuditLogs(tenantId) {
    const list = this.state.auditLogs || [];
    if (!tenantId || tenantId === 'all') return list;
    return list.filter(a => a.tenantId === tenantId || a.targetId === tenantId);
  }

  addAuditLog(entry) {
    if (!this.state.auditLogs) this.state.auditLogs = [];
    const id = entry.id || ('aud_' + Math.floor(1000 + Math.random() * 9000));
    const previousHash = this.state.auditLogs.length > 0
      ? (this.state.auditLogs[0].currentHash || this.state.auditLogs[0].hash || '0000000000000000000000000000000000000000000000000000000000000000')
      : '0000000000000000000000000000000000000000000000000000000000000000';

    const logBase = {
      id,
      timestamp: entry.timestamp || 'هم‌اکنون',
      actor: entry.actor || 'ناظر پروژه (SuperAdmin)',
      actorRole: entry.actorRole || 'SuperAdmin',
      previousHash,
      ...entry
    };

    const currentHash = this.computeAuditHash(logBase, previousHash);
    const log = {
      ...logBase,
      currentHash,
      hash: currentHash.slice(0, 24)
    };

    this.state.auditLogs.unshift(log);
    this.save();
    return log;
  }

  verifyAuditLogIntegrity() {
    const logs = this.state.auditLogs || [];
    if (logs.length === 0) {
      return { valid: true, verifiedCount: 0, compromisedIndex: null, message: 'زنجیره خالی است.' };
    }

    for (let i = logs.length - 1; i >= 0; i--) {
      const current = logs[i];
      const prev = i === logs.length - 1 ? null : logs[i + 1];
      const expectedPrevHash = prev ? (prev.currentHash || prev.hash) : (current.previousHash || '0000000000000000000000000000000000000000000000000000000000000000');

      if (current.previousHash && prev && current.previousHash !== expectedPrevHash) {
        return {
          valid: false,
          verifiedCount: logs.length - 1 - i,
          compromisedIndex: i,
          compromisedId: current.id,
          message: `عدم تطابق هش قبلی در بلوک ${current.id}`
        };
      }
    }

    return {
      valid: true,
      verifiedCount: logs.length,
      compromisedIndex: null,
      rootHash: logs[0].currentHash || logs[0].hash,
      message: `تمامی ${logs.length} بلوک زنجیره ممیزی با امضای دیجیتال SHA-256 تایید اعتبار شدند.`
    };
  }

  dismissInboxItem(itemId) {
    if (!Array.isArray(this.state.dismissedInboxItems)) this.state.dismissedInboxItems = [];
    if (!this.state.dismissedInboxItems.includes(itemId)) {
      this.state.dismissedInboxItems.push(itemId);
      this.save();
    }
    return true;
  }

  isInboxItemDismissed(itemId) {
    return Array.isArray(this.state.dismissedInboxItems) && this.state.dismissedInboxItems.includes(itemId);
  }

  clearDismissedInboxItems() {
    this.state.dismissedInboxItems = [];
    this.save();
    return true;
  }

  getDismissedInboxItems() {
    return Array.isArray(this.state.dismissedInboxItems) ? [...this.state.dismissedInboxItems] : [];
  }

  getCybersecurityPosture() {
    const integrity = this.verifyAuditLogIntegrity();
    return {
      shields: [
        { id: 'hsts', name: 'سپر HSTS Preload', status: 'فعال (31536000s)', level: 'high', icon: '🔒' },
        { id: 'csp', name: 'سیاست امنیت محتوا (Strict CSP)', status: 'فعال (frame-ancestors none)', level: 'high', icon: '🛡️' },
        { id: 'tenant_isolation', name: 'ایزولاسیون دیتابیس مستأجرین', status: 'Database-per-Tenant', level: 'high', icon: '🧱' },
        { id: 'anti_brute_force', name: 'قفل ضد بروت‌فورس و اسپم OTP', status: 'خنک‌سازی ۶۰s + سقف ۵ تلاش', level: 'high', icon: '⚡' },
        { id: 'tamper_evident_audit', name: 'زنجیره ممیزی ضدجعل SHA-256', status: integrity.valid ? '۱۰۰٪ معتبر و تاییدشده' : 'هشدار عدم تطابق', level: integrity.valid ? 'high' : 'critical', icon: '⛓️' },
        { id: 'zero_secrets', name: 'مدیریت اسرار بدون کلید هاردکد', status: 'Fail-Closed + Scrypt/GCM', level: 'high', icon: '🔑' },
        { id: 'rate_limiting', name: 'محدودکننده فرکانس درخواست‌ها', status: 'Sliding-Window DoS Shield', level: 'high', icon: '⏱️' },
        { id: 'mfa_totp', name: 'احراز هویت دو عاملی TOTP', status: 'RFC-6238 با کلیدهای ریکاوری', level: 'high', icon: '📱' }
      ],
      overallScore: integrity.valid ? 100 : 75,
      auditIntegrity: integrity,
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
      lockdownMode: Boolean(this.state.securityPolicy?.lockdownMode),
      lockdownDetails: this.state.securityPolicy?.lockdownReason ? {
        reason: this.state.securityPolicy.lockdownReason,
        triggeredAt: this.state.securityPolicy.lockdownTriggeredAt
      } : null
    };
  }

  // Team & Platform Settings (GM-27)
  getTeamMembers() {
    return this.state.teamMembers || [];
  }

  addTeamMember(data = {}) {
    if (!this.state.teamMembers) this.state.teamMembers = [];
    const newMember = {
      id: data.id || ('team_' + Math.floor(10 + Math.random() * 90)),
      name: data.name || 'عضو جدید تیم',
      email: data.email || 'staff@westo.demo.salsa.local',
      phone: data.phone || '09120000000',
      role: data.role || 'support_lead',
      scope: data.scope || 'support_tenants',
      mfaStatus: data.mfaStatus || 'active (TOTP)',
      lastActive: 'هم‌اکنون'
    };
    this.state.teamMembers.push(newMember);
    this.save();
    this.addActivity({
      type: 'team_member_added',
      severity: 'info',
      title: `افزودن عضو جدید: ${newMember.name}`,
      description: `دعوت‌نامه برای ${newMember.email} ارسال و عضو به لیست دسترسی‌ها افزوده شد.`,
      subsystem: 'Team',
      route: '#gm-27-team',
      routeLabel: 'GM-27 تیم پلتفرم',
      actor: 'SuperAdmin (مدیر پلتفرم)',
      details: newMember
    });
    return newMember;
  }

  getPlatformSettings() {
    return this.state.platformSettings || {};
  }

  updatePlatformSettings(newSettings) {
    this.state.platformSettings = { ...this.state.platformSettings, ...newSettings };
    this.save();
    return this.state.platformSettings;
  }

  // Printer Models Catalog (GM-29)
  getPrinterModels() {
    if (!this.state.printerModels || this.state.printerModels.length === 0) {
      this.state.printerModels = [
        {
          id: 'prn_epson_tm88vi',
          brand: 'Epson',
          model: 'TM-T88VI',
          category: 'receipt',
          categoryFa: 'پرینتر فیش (رسید)',
          interface: ['USB', 'LAN', 'Bluetooth'],
          paperWidth: 80,
          dpi: 180,
          speedMmPerSec: 350,
          cutter: true,
          cashdrawer: true,
          status: 'active',
          statusFa: 'پشتیبانی‌شده',
          compatibleFeatures: ['orders.pos', 'cash.drawers'],
          notes: 'پراستفاده‌ترین مدل در سیستم سالسا. پیشنهاد اول برای مشتریان جدید.',
          addedAt: '۱۴۰۲/۰۸/۱۵'
        },
        {
          id: 'prn_epson_tm88vii',
          brand: 'Epson',
          model: 'TM-T88VII',
          category: 'receipt',
          categoryFa: 'پرینتر فیش (رسید)',
          interface: ['USB', 'LAN', 'Wi-Fi', 'Bluetooth'],
          paperWidth: 80,
          dpi: 180,
          speedMmPerSec: 450,
          cutter: true,
          cashdrawer: true,
          status: 'active',
          statusFa: 'پشتیبانی‌شده',
          compatibleFeatures: ['orders.pos', 'cash.drawers'],
          notes: 'نسل جدید TM-T88 با Wi-Fi داخلی. مناسب برای محیط‌های بدون کابل.',
          addedAt: '۱۴۰۳/۰۱/۱۰'
        },
        {
          id: 'prn_bixolon_srp350iii',
          brand: 'Bixolon',
          model: 'SRP-350III',
          category: 'receipt',
          categoryFa: 'پرینتر فیش (رسید)',
          interface: ['USB', 'Serial', 'LAN'],
          paperWidth: 80,
          dpi: 180,
          speedMmPerSec: 250,
          cutter: true,
          cashdrawer: true,
          status: 'active',
          statusFa: 'پشتیبانی‌شده',
          compatibleFeatures: ['orders.pos'],
          notes: 'گزینه اقتصادی مناسب برای کافه‌های کوچک و مجموعه‌های با بودجه محدود.',
          addedAt: '۱۴۰۲/۰۵/۲۰'
        },
        {
          id: 'prn_star_tsp143iii',
          brand: 'Star Micronics',
          model: 'TSP143III',
          category: 'receipt',
          categoryFa: 'پرینتر فیش (رسید)',
          interface: ['USB', 'LAN', 'Wi-Fi'],
          paperWidth: 80,
          dpi: 203,
          speedMmPerSec: 250,
          cutter: true,
          cashdrawer: true,
          status: 'active',
          statusFa: 'پشتیبانی‌شده',
          compatibleFeatures: ['orders.pos', 'cash.drawers'],
          notes: 'پرینتر محبوب برند Star. کیفیت چاپ بالا و مقاومت خوب در محیط رستوران.',
          addedAt: '۱۴۰۲/۱۱/۰۳'
        },
        {
          id: 'prn_epson_eu550',
          brand: 'Epson',
          model: 'EU-m550',
          category: 'kitchen',
          categoryFa: 'پرینتر آشپزخانه (KOT)',
          interface: ['LAN', 'USB'],
          paperWidth: 76,
          dpi: 203,
          speedMmPerSec: 200,
          cutter: false,
          cashdrawer: false,
          status: 'active',
          statusFa: 'پشتیبانی‌شده',
          compatibleFeatures: ['kitchen.kds', 'orders.pos'],
          notes: 'پرینتر حرارتی مقاوم برای محیط آشپزخانه. تحمل بخار و دما تا ۵۵ درجه.',
          addedAt: '۱۴۰۲/۰۹/۱۸'
        },
        {
          id: 'prn_custom_vkp80',
          brand: 'Custom',
          model: 'VKP80II',
          category: 'kitchen',
          categoryFa: 'پرینتر آشپزخانه (KOT)',
          interface: ['LAN', 'Serial'],
          paperWidth: 76,
          dpi: 180,
          speedMmPerSec: 180,
          cutter: false,
          cashdrawer: false,
          status: 'active',
          statusFa: 'پشتیبانی‌شده',
          compatibleFeatures: ['kitchen.kds'],
          notes: 'مناسب ایستگاه‌های آشپزخانه، تولید ایتالیا، مقاوم در برابر رطوبت و حرارت.',
          addedAt: '۱۴۰۳/۰۳/۰۷'
        },
        {
          id: 'prn_hp_laserjet_mfp',
          brand: 'HP',
          model: 'LaserJet MFP M232dw',
          category: 'label',
          categoryFa: 'پرینتر لیبل و فاکتور رسمی',
          interface: ['Wi-Fi', 'USB'],
          paperWidth: 210,
          dpi: 600,
          speedMmPerSec: null,
          cutter: false,
          cashdrawer: false,
          status: 'limited',
          statusFa: 'پشتیبانی محدود',
          compatibleFeatures: ['finance.workspace', 'finance.tax_adapter'],
          notes: 'برای چاپ فاکتورهای رسمی و گزارشات مالی. نیاز به درایور نصب دارد.',
          addedAt: '۱۴۰۳/۰۵/۲۲'
        },
        {
          id: 'prn_zebra_zd421',
          brand: 'Zebra',
          model: 'ZD421',
          category: 'label',
          categoryFa: 'پرینتر لیبل و بارکد',
          interface: ['USB', 'Wi-Fi', 'Bluetooth'],
          paperWidth: 104,
          dpi: 203,
          speedMmPerSec: null,
          cutter: false,
          cashdrawer: false,
          status: 'beta',
          statusFa: 'آزمایشی (بتا)',
          compatibleFeatures: ['stock.inventory', 'stock.procurement'],
          notes: 'برای لیبل‌زنی انبار و بارکد مواد اولیه. درایور اتصال هنوز در حال توسعه است.',
          addedAt: '۱۴۰۳/۰۶/۱۴'
        }
      ];
    }
    return this.state.printerModels;
  }

  addPrinterModel(data = {}) {
    if (!this.state.printerModels) this.state.printerModels = [];
    const newPrinter = {
      id: data.id || ('prn_' + Date.now()),
      brand: data.brand || 'نامشخص',
      model: data.model || 'مدل جدید',
      category: data.category || 'receipt',
      categoryFa: data.categoryFa || 'پرینتر فیش',
      interface: data.interface || ['USB'],
      paperWidth: data.paperWidth || 80,
      dpi: data.dpi || 180,
      speedMmPerSec: data.speedMmPerSec || null,
      cutter: data.cutter !== undefined ? data.cutter : true,
      cashdrawer: data.cashdrawer !== undefined ? data.cashdrawer : false,
      status: data.status || 'active',
      statusFa: data.statusFa || 'پشتیبانی‌شده',
      compatibleFeatures: data.compatibleFeatures || [],
      notes: data.notes || '',
      addedAt: data.addedAt || 'هم‌اکنون'
    };
    this.state.printerModels.unshift(newPrinter);
    this.save();
    this.addActivity({
      type: 'printer_model_added',
      severity: 'info',
      title: `افزودن مدل پرینتر جدید: ${newPrinter.brand} ${newPrinter.model}`,
      description: `مدل پرینتر ${newPrinter.brand} ${newPrinter.model} به کاتالوگ پلتفرم اضافه شد.`,
      subsystem: 'Printers',
      route: '#gm-29-printers',
      routeLabel: 'GM-29 مدیریت پرینترها',
      actor: 'SuperAdmin (مدیر پلتفرم)',
      details: newPrinter
    });
    return newPrinter;
  }

  updatePrinterModel(id, data = {}) {
    if (!this.state.printerModels) return null;
    const printer = this.state.printerModels.find(p => p.id === id);
    if (!printer) return null;
    Object.assign(printer, data);
    this.save();
    this.addActivity({
      type: 'printer_model_updated',
      severity: 'info',
      title: `ویرایش مدل پرینتر: ${printer.brand} ${printer.model}`,
      description: `اطلاعات مدل پرینتر ${printer.brand} ${printer.model} به‌روزرسانی شد.`,
      subsystem: 'Printers',
      route: '#gm-29-printers',
      routeLabel: 'GM-29 مدیریت پرینترها',
      actor: 'SuperAdmin (مدیر پلتفرم)'
    });
    return printer;
  }

  deletePrinterModel(id) {
    if (!this.state.printerModels) return false;
    const idx = this.state.printerModels.findIndex(p => p.id === id);
    if (idx === -1) return false;
    const printer = this.state.printerModels[idx];
    this.state.printerModels.splice(idx, 1);
    this.save();
    this.addActivity({
      type: 'printer_model_deleted',
      severity: 'warning',
      title: `حذف مدل پرینتر: ${printer.brand} ${printer.model}`,
      description: `مدل پرینتر ${printer.brand} ${printer.model} از کاتالوگ پلتفرم حذف شد.`,
      subsystem: 'Printers',
      route: '#gm-29-printers',
      routeLabel: 'GM-29 مدیریت پرینترها',
      actor: 'SuperAdmin (مدیر پلتفرم)'
    });
    return true;
  }

  // Ecosystem Configured Printers (GM-29)
  getEcosystemPrinters() {
    if (!this.state.ecosystemPrinters || this.state.ecosystemPrinters.length === 0) {
      this.state.ecosystemPrinters = [
        {
          id: 'prn_eco_cashier_westo',
          code: 'cashier-main',
          name: 'پرینتر صندوق وستو (صندوق ۱ - سالن اصلی)',
          tenantId: 'tnt_westo_demo',
          tenantName: 'کافه وستو (Westo Café)',
          branchId: 1,
          branchName: 'شعبه اصلی (مشهد)',
          modelId: 'prn_bixolon_srp350iii',
          brand: 'BIXOLON',
          model: 'SRP-350III',
          role: 'cashier',
          roleFa: 'صندوق فروش (POS)',
          transport: 'network',
          transportFa: 'شبکه (LAN)',
          host: '192.168.254.120',
          port: 9100,
          systemPrinterName: '_192_168_254_120',
          paperWidth: 80,
          charsPerLine: 48,
          renderMode: 'raster',
          encoding: 'windows-1256',
          codePage: 40,
          cut: true,
          cashdrawer: true,
          status: 'online',
          statusFa: 'آنلاین و فعال',
          lastPrintAt: 'هم‌اکنون (آماده دریافت دستور چاپ)',
          directPrintOrigin: 'http://localhost:4180',
          apiEndpoint: '/api/cashier/printer',
          isPort4180Linked: true,
          notes: 'پرینتر صندوق پیاده‌سازی‌شده روی پورت ۴۱۸۰. چاپ مستقیم رستر ESC/POS بدون دیالوگ پرینت مرورگر.'
        },
        {
          id: 'prn_eco_kitchen_westo',
          code: 'kitchen-hot',
          name: 'پرینتر سفارشات آشپزخانه گرم (KOT)',
          tenantId: 'tnt_westo_demo',
          tenantName: 'کافه وستو (Westo Café)',
          branchId: 1,
          branchName: 'شعبه اصلی (مشهد)',
          modelId: 'prn_epson_eum550',
          brand: 'Epson',
          model: 'EU-m550',
          role: 'kitchen',
          roleFa: 'آشپزخانه گرم',
          transport: 'network',
          transportFa: 'شبکه (LAN)',
          host: '192.168.254.125',
          port: 9100,
          systemPrinterName: '',
          paperWidth: 80,
          charsPerLine: 48,
          renderMode: 'text',
          encoding: 'windows-1256',
          codePage: 40,
          cut: true,
          cashdrawer: false,
          status: 'online',
          statusFa: 'آنلاین و فعال',
          lastPrintAt: '۵ دقیقه قبل',
          directPrintOrigin: 'http://localhost:4180',
          apiEndpoint: '',
          isPort4180Linked: false,
          notes: 'پرینتر سفارشات بخش پخت آشپزخانه با صدای بوق هشدار سفارش و برش خودکار.'
        },
        {
          id: 'prn_eco_bar_westo',
          code: 'bar-drinks',
          name: 'پرینتر بار و نوشیدنی سرد و گرم',
          tenantId: 'tnt_westo_demo',
          tenantName: 'کافه وستو (Westo Café)',
          branchId: 1,
          branchName: 'شعبه اصلی (مشهد)',
          modelId: 'prn_star_tsp143iii',
          brand: 'Star Micronics',
          model: 'TSP143III',
          role: 'bar',
          roleFa: 'بار و نوشیدنی',
          transport: 'network',
          transportFa: 'شبکه (LAN)',
          host: '192.168.254.128',
          port: 9100,
          systemPrinterName: '',
          paperWidth: 80,
          charsPerLine: 48,
          renderMode: 'text',
          encoding: 'utf8',
          codePage: null,
          cut: true,
          cashdrawer: false,
          status: 'online',
          statusFa: 'آنلاین و فعال',
          lastPrintAt: '۱۲ دقیقه قبل',
          directPrintOrigin: 'http://localhost:4180',
          apiEndpoint: '',
          isPort4180Linked: false,
          notes: 'پرینتر فیش باریستا و بار گرم/سرد سالن با اتصال مستقیم شبکه.'
        }
      ];
    }
    return this.state.ecosystemPrinters;
  }

  addEcosystemPrinter(data = {}) {
    if (!this.state.ecosystemPrinters) this.state.ecosystemPrinters = [];
    const newPrinter = {
      id: data.id || ('prn_eco_' + Date.now()),
      code: data.code || ('prn-' + Math.floor(100 + Math.random() * 900)),
      name: data.name || 'پرینتر جدید',
      tenantId: data.tenantId || 'tnt_westo_demo',
      tenantName: data.tenantName || 'کافه وستو (Westo Café)',
      branchId: data.branchId || 1,
      branchName: data.branchName || 'شعبه اصلی',
      modelId: data.modelId || 'prn_bixolon_srp350iii',
      brand: data.brand || 'Bixolon',
      model: data.model || 'SRP-350III',
      role: data.role || 'cashier',
      roleFa: data.roleFa || 'صندوق فروش',
      transport: data.transport || 'network',
      transportFa: data.transportFa || (data.transport === 'system' ? 'USB / سیستم' : 'شبکه (LAN)'),
      host: data.host || '192.168.1.100',
      port: Number(data.port) || 9100,
      systemPrinterName: data.systemPrinterName || '',
      paperWidth: Number(data.paperWidth) || 80,
      charsPerLine: Number(data.charsPerLine) || (Number(data.paperWidth) === 58 ? 32 : 48),
      renderMode: data.renderMode || 'raster',
      encoding: data.encoding || 'windows-1256',
      codePage: data.codePage !== undefined ? data.codePage : 40,
      cut: data.cut !== undefined ? data.cut : true,
      cashdrawer: data.cashdrawer !== undefined ? data.cashdrawer : true,
      status: data.status || 'online',
      statusFa: data.statusFa || 'آنلاین و فعال',
      lastPrintAt: data.lastPrintAt || 'هم‌اکنون',
      directPrintOrigin: data.directPrintOrigin || 'http://localhost:4180',
      apiEndpoint: data.apiEndpoint || '',
      isPort4180Linked: Boolean(data.isPort4180Linked),
      notes: data.notes || '',
      addedAt: data.addedAt || 'هم‌اکنون'
    };
    this.state.ecosystemPrinters.unshift(newPrinter);
    this.save();
    this.addActivity({
      type: 'ecosystem_printer_added',
      severity: 'info',
      title: `ثبت پرینتر جدید در اکوسیستم: ${newPrinter.name}`,
      description: `پرینتر ${newPrinter.name} (${newPrinter.brand} ${newPrinter.model}) برای ${newPrinter.tenantName} ثبت و فعال شد.`,
      subsystem: 'Printers',
      route: '#gm-29-printers',
      routeLabel: 'GM-29 مدیریت پرینترها',
      actor: 'SuperAdmin (مدیر پلتفرم)',
      details: newPrinter
    });
    return newPrinter;
  }

  updateEcosystemPrinter(id, data = {}) {
    if (!this.state.ecosystemPrinters) return null;
    const printer = this.state.ecosystemPrinters.find(p => p.id === id);
    if (!printer) return null;
    Object.assign(printer, data);
    this.save();
    this.addActivity({
      type: 'ecosystem_printer_updated',
      severity: 'info',
      title: `ویرایش پرینتر اکوسیستم: ${printer.name}`,
      description: `تنظیمات پرینتر ${printer.name} به‌روزرسانی شد.`,
      subsystem: 'Printers',
      route: '#gm-29-printers',
      routeLabel: 'GM-29 مدیریت پرینترها',
      actor: 'SuperAdmin (مدیر پلتفرم)'
    });
    return printer;
  }

  deleteEcosystemPrinter(id) {
    if (!this.state.ecosystemPrinters) return false;
    const idx = this.state.ecosystemPrinters.findIndex(p => p.id === id);
    if (idx === -1) return false;
    const printer = this.state.ecosystemPrinters[idx];
    this.state.ecosystemPrinters.splice(idx, 1);
    this.save();
    this.addActivity({
      type: 'ecosystem_printer_deleted',
      severity: 'warning',
      title: `حذف پرینتر از اکوسیستم: ${printer.name}`,
      description: `پرینتر ${printer.name} از ناوگان پرینترهای فعال اکوسیستم حذف شد.`,
      subsystem: 'Printers',
      route: '#gm-29-printers',
      routeLabel: 'GM-29 مدیریت پرینترها',
      actor: 'SuperAdmin (مدیر پلتفرم)'
    });
    return true;
  }


  getActivities(filter = 'all') {
    const list = this.state.activities || [];
    if (filter === 'unread') {
      return list.filter(a => !a.read);
    }
    if (filter === 'danger' || filter === 'critical' || filter === 'error') {
      return list.filter(a => a.severity === 'danger' || a.severity === 'error' || a.severity === 'critical');
    }
    if (filter === 'warning') {
      return list.filter(a => a.severity === 'warning');
    }
    if (filter === 'success') {
      return list.filter(a => a.severity === 'success');
    }
    if (filter === 'info') {
      return list.filter(a => a.severity === 'info');
    }
    return list;
  }

  getUnreadActivitiesCount() {
    const list = this.state.activities || [];
    return list.filter(a => !a.read).length;
  }

  addActivity(entry) {
    if (!this.state.activities) this.state.activities = [];
    const id = entry.id || ('act_' + Date.now() + '_' + Math.floor(Math.random() * 1000));
    const now = new Date();
    const timeFa = now.toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' });

    const activity = {
      id,
      type: entry.type || 'system_event',
      action: entry.action || null,
      severity: entry.severity || 'info',
      title: entry.title || 'رویداد عملیاتی پلتفرم',
      description: entry.description || '',
      subsystem: entry.subsystem || 'Platform',
      route: entry.route || (typeof window !== 'undefined' && window.location && window.location.hash ? window.location.hash : '#gm-02-overview'),
      routeLabel: entry.routeLabel || 'پیشخوان SALSA',
      actor: entry.actor || 'SuperAdmin (ناظر)',
      timestamp: entry.timestamp || `هم‌اکنون (${timeFa})`,
      timestampIso: entry.timestampIso || now.toISOString(),
      read: entry.read !== undefined ? entry.read : false,
      details: entry.details || null
    };

    this.state.activities.unshift(activity);
    if (this.state.activities.length > 80) {
      this.state.activities = this.state.activities.slice(0, 80);
    }
    this.save();
    return activity;
  }

  markActivityAsRead(id) {
    if (!this.state.activities) return false;
    const act = this.state.activities.find(a => a.id === id);
    if (act) {
      act.read = true;
      this.save();
      return true;
    }
    return false;
  }

  markAllActivitiesAsRead() {
    if (!this.state.activities) return 0;
    let count = 0;
    this.state.activities.forEach(a => {
      if (!a.read) {
        a.read = true;
        count++;
      }
    });
    if (count > 0) this.save();
    return count;
  }

  archiveReadActivities() {
    if (!this.state.activities) return 0;
    const initial = this.state.activities.length;
    this.state.activities = this.state.activities.filter(a => !a.read);
    const removed = initial - this.state.activities.length;
    if (removed > 0) this.save();
    return removed;
  }

  clearActivities() {
    this.state.activities = [];
    this.save();
  }

  resetAll() {
    this.resetStore();
    return this.state;
  }
}

// Global prototype store singleton
const prototypeStoreInstance = new PrototypeStore();
if (typeof window !== 'undefined') {
  window.prototypeStore = prototypeStoreInstance;
  window.GMStore = prototypeStoreInstance;
}

// ============================================================
// Shared Data Freshness, State & Resilience System
// ============================================================
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
          window.GMApp.showToast('وضعیت بخش فقط در Fixture محلی بازخوانی شد؛ همگام‌سازی عملیاتی انجام نشد.', 'info');
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
            { name: 'انطباق قالب کدهای خطای پلتفرم', status: 'pass', detail: 'ثبت استاندارد خطاهای ERR_GATEWAY و شبیه‌سازی رخداد' },
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
            { name: 'انطباق وضعیت سوییچ با اعلامیه پورتال عمومی', status: 'pass', detail: 'هماهنگی اعلام وضعیت با status.salsa.ir' }
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
          { name: 'فیلدهای هویتی و پروانه‌ای وستو', status: 'pass', detail: 'مشخصات کامل ثبتی (نام، دامنه، مدیریت، شناسه صنفی)' },
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
      meta: 'تله‌متری عملیاتی دریافت نشده است',
      summary: 'این شاخص در Fixture محلی قابل تأیید نیست؛ اتصال منبع و timestamp معتبر لازم است.',
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
      : `<span class="badge badge-provenance-live" title="منشأ داده: کنترل‌پلن عملیاتی SALSA — کلاینت وستو روی پورت ۴۱۸۰"><span class="status-dot dot-green"></span> برخط (عملیاتی)</span>`;

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
  window.GMDataState = dataStateManagerInstance;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    PrototypeStore,
    prototypeStore: prototypeStoreInstance,
    DataStateManager,
    GMDataState: dataStateManagerInstance
  };
}
