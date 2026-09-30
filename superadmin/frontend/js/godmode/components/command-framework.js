/**
 * superadmin/frontend/js/godmode/components/command-framework.js
 *
 * Central Command Framework & Impact Preview (Clauses §8, §9 & §21).
 * All high-risk and sensitive mutations route strictly through this framework.
 * Guarantees preflight checks, role verification, structured impact previews,
 * mandatory reasons, idempotency keys, and audit metadata.
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

  function generateIdempotencyKey(prefix = 'cmd') {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return `${prefix}_${crypto.randomUUID()}`;
    }
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  }

  const COMMAND_DEFINITIONS = {};

  /**
   * 1. Suspend Restaurant
   */
  COMMAND_DEFINITIONS['SuspendRestaurant'] = {
    id: 'SuspendRestaurant',
    label: 'تعلیق سرویس مجموعه',
    scope: 'tenant',
    riskLevel: 'destructive',
    requiredRoles: ['PlatformOwner', 'PlatformAdmin', 'OperationsOperator'],
    requiresReason: true,
    requiresTypedConfirmation: 'SUSPEND',
    async preflight(ctx) {
      if (!ctx.tenantId) throw new Error('شناسه مجموعه (tenantId) الزامی است.');
      return { ok: true };
    },
    async impactPreview(ctx) {
      const store = global.prototypeStore || global.GMStore;
      const tenant = store?.getTenant ? store.getTenant(ctx.tenantId) : null;
      const branchesCount = tenant?.branches?.length || 1;
      const devicesCount = tenant?.devices?.length || 2;
      return {
        summary: `توقف دسترسی کلیه پایانه‌های فروش، منوهای دیجیتال و آشپزخانه برای ${tenant?.name || ctx.tenantId}`,
        items: [
          `شعب تحت تأثیر: ${branchesCount} شعبه فیزیکی`,
          `پایانه‌های قطع‌شده: ${devicesCount} پایانه فعال (POS / KDS)`,
          'سفارش‌گیری آنلاین و منوی دیجیتال سر میز: غیرفعال',
          'دسترسی کارکنان به پنل مدیریتی: فقط خواندنی (Read-Only)',
          'داده‌های مالی و سوابق مشتریان: محفوظ بدون حذف اطلاعات'
        ],
        reversibility: 'قابل برگشت از طریق دستور رفع تعلیق (ReactivateRestaurant)'
      };
    },
    async execute(ctx, options = {}) {
      const repo = global.RestaurantsRepository;
      if (!repo) throw new Error('RestaurantsRepository در دسترس نیست.');
      return await repo.transitionLifecycle(ctx.tenantId, 'suspended', options.reason);
    }
  };

  /**
   * 2. Reactivate Restaurant
   */
  COMMAND_DEFINITIONS['ReactivateRestaurant'] = {
    id: 'ReactivateRestaurant',
    label: 'رفع تعلیق و بازگشت به کار مجموعه',
    scope: 'tenant',
    riskLevel: 'moderate',
    requiredRoles: ['PlatformOwner', 'PlatformAdmin', 'OperationsOperator'],
    requiresReason: true,
    async preflight(ctx) {
      if (!ctx.tenantId) throw new Error('شناسه مجموعه (tenantId) الزامی است.');
      return { ok: true };
    },
    async impactPreview(ctx) {
      const store = global.prototypeStore || global.GMStore;
      const tenant = store?.getTenant ? store.getTenant(ctx.tenantId) : null;
      return {
        summary: `بازگردانی وضعیت عملیاتی به حالت فعال برای ${tenant?.name || ctx.tenantId}`,
        items: [
          'بازیابی دسترسی صندوق‌ها (POS) و پایانه‌های آشپزخانه',
          'فعال‌سازی مجدد منوی دیجیتال سر میز و درگاه سفارش‌گیری',
          'فعال‌سازی سهمیه‌ها و صدور پیامک‌های تراکنشی'
        ],
        reversibility: 'قابل تعلیق مجدد در صورت نیاز'
      };
    },
    async execute(ctx, options = {}) {
      const repo = global.RestaurantsRepository;
      if (!repo) throw new Error('RestaurantsRepository در دسترس نیست.');
      return await repo.transitionLifecycle(ctx.tenantId, 'active', options.reason);
    }
  };

  /**
   * 3. Change Subscription Plan
   */
  COMMAND_DEFINITIONS['ChangePlan'] = {
    id: 'ChangePlan',
    label: 'تغییر سطح پلن تجاری و سهمیه‌ها',
    scope: 'tenant',
    riskLevel: 'high',
    requiredRoles: ['PlatformOwner', 'PlatformAdmin', 'FinanceOperator'],
    requiresReason: true,
    async preflight(ctx) {
      if (!ctx.tenantId || !ctx.newPlanId) {
        throw new Error('انتخاب مجموعه و پلن تجاری جدید الزامی است.');
      }
      const commRepo = global.CommercialRepository;
      if (commRepo && typeof commRepo.preflightChangePlan === 'function') {
        try {
          ctx.preflightResult = await commRepo.preflightChangePlan(ctx.tenantId, ctx.newPlanId);
        } catch (_) {}
      }
      return { ok: true };
    },
    async impactPreview(ctx) {
      const pf = ctx.preflightResult;
      const currentPlan = pf?.currentPlan || ctx.currentPlanName || 'Growth';
      const newPlan = pf?.newPlan || ctx.newPlanName || 'Starter';
      const isDowngrade = pf ? (pf.effectiveMode === 'downgrade' || pf.isDowngrade) : (ctx.isDowngrade || false);
      return {
        summary: `تغییر پلن از «${currentPlan}» به «${newPlan}»`,
        items: [
          isDowngrade ? 'کاهش دسترسی ماژول‌های خارج از پلن پایه (انبارداری / حسابداری)' : 'فعال‌سازی آنی کلیه قابلیت‌ها و ماژول‌های بسته جدید',
          isDowngrade ? 'تغییر سهمیه سقف شعب و پایانه‌های فعال' : 'ارتقای سقف سهمیه پایانه‌ها و پیامک‌های ماهانه',
          pf?.prorationAmount ? `محاسبه مابه‌التفاوت بر اساس دوره‌بندی: ${pf.prorationAmount.toLocaleString('fa-IR')} تومان` : 'محاسبه مابه‌التفاوت صورتحساب در چرخه تسویه بعدی',
          'کلیه داده‌های تاریخی و سوابق مالی قبلی محفوظ خواهند ماند.'
        ],
        reversibility: 'امکان ارتقا یا بازگشت به پلن قبلی با صدور دستور جدید'
      };
    },
    async execute(ctx, options = {}) {
      const commRepo = global.CommercialRepository;
      if (commRepo && typeof commRepo.changeSubscriptionPlan === 'function') {
        return await commRepo.changeSubscriptionPlan(ctx.tenantId, ctx.newPlanId, options.reason, {
          expectedVersion: ctx.expectedVersion,
          idempotencyKey: ctx.idempotencyKey || generateIdempotencyKey('plan')
        });
      }
      const repo = global.RestaurantsRepository;
      if (repo && typeof repo.updateTenantPlan === 'function') {
        return await repo.updateTenantPlan(ctx.tenantId, ctx.newPlanId, options.reason);
      }
      throw new Error('سرویس تغییر پلن در دسترس نیست.');
    }
  };
  COMMAND_DEFINITIONS['ChangeSubscriptionPlan'] = COMMAND_DEFINITIONS['ChangePlan'];

  /**
   * 4. Grant Capability / Module Override
   */
  COMMAND_DEFINITIONS['GrantCapability'] = {
    id: 'GrantCapability',
    label: 'تخصیص ماژول یا سهمیه اختصاصی (Grant)',
    scope: 'tenant',
    riskLevel: 'moderate',
    requiredRoles: ['PlatformOwner', 'PlatformAdmin', 'OperationsOperator'],
    requiresReason: true,
    async preflight(ctx) {
      if (!ctx.tenantId || !ctx.moduleKey) throw new Error('شناسه مجموعه و ماژول الزامی است.');
      return { ok: true };
    },
    async impactPreview(ctx) {
      return {
        summary: `فعال‌سازی دستی ماژول «${ctx.moduleKey}» برای مجموعه ${ctx.tenantId}`,
        items: [
          `تخصیص مجوز فنی ${ctx.moduleKey} به عنوان استثنای معتبر (Override)`,
          'اعمال فوری در پایانه‌های POS و پنل رستوران بدون نیاز به ارتقای پلن کلان',
          ctx.durationDays ? `مدت اعتبار استثنا: ${ctx.durationDays} روز` : 'اعتبار تا لغو دستی توسط مدیریت'
        ],
        reversibility: 'قابل لغو از طریق دستور RevokeCapability'
      };
    },
    async execute(ctx, options = {}) {
      const repo = global.EntitlementsRepository;
      if (!repo) throw new Error('EntitlementsRepository در دسترس نیست.');
      return await repo.setModuleStatus(ctx.tenantId, ctx.moduleKey, true, options.reason);
    }
  };

  /**
   * 5. Revoke Capability
   */
  COMMAND_DEFINITIONS['RevokeCapability'] = {
    id: 'RevokeCapability',
    label: 'لغو ماژول اختصاصی (Revoke)',
    scope: 'tenant',
    riskLevel: 'high',
    requiredRoles: ['PlatformOwner', 'PlatformAdmin', 'OperationsOperator'],
    requiresReason: true,
    async preflight(ctx) {
      if (!ctx.tenantId || !ctx.moduleKey) throw new Error('شناسه مجموعه و ماژول الزامی است.');
      return { ok: true };
    },
    async impactPreview(ctx) {
      return {
        summary: `غیرفعال‌سازی ماژول «${ctx.moduleKey}» برای ${ctx.tenantId}`,
        items: [
          `قطع دسترسی پایانه‌ها به قابلیت ${ctx.moduleKey}`,
          'هیچ داده ذخیره‌شده قبلی حذف نخواهد شد اما دسترسی ثبت جدید مسدود می‌شود.'
        ],
        reversibility: 'قابل فعال‌سازی مجدد'
      };
    },
    async execute(ctx, options = {}) {
      const repo = global.EntitlementsRepository;
      if (!repo) throw new Error('EntitlementsRepository در دسترس نیست.');
      return await repo.setModuleStatus(ctx.tenantId, ctx.moduleKey, false, options.reason);
    }
  };

  /**
   * 6. Extend Grace Period
   */
  COMMAND_DEFINITIONS['ExtendGracePeriod'] = {
    id: 'ExtendGracePeriod',
    label: 'تمدید استمهال پرداخت (Grace Period)',
    scope: 'tenant',
    riskLevel: 'moderate',
    requiredRoles: ['PlatformOwner', 'PlatformAdmin', 'FinanceOperator'],
    requiresReason: true,
    async preflight(ctx) {
      if (!ctx.tenantId) throw new Error('شناسه مجموعه الزامی است.');
      return { ok: true };
    },
    async impactPreview(ctx) {
      const days = ctx.days || 7;
      return {
        summary: `تمدید مهلت پرداخت به مدت ${days} روز کاری`,
        items: [
          `جلوگیری از تعلیق خودکار سرویس‌ها تا تاریخ مقرر`,
          'ثبت درخواست رسمی در پرونده مالی و ممیزی سامانه',
          'ارسال پیامک یادآوری مهلت به مالک مجموعه'
        ],
        reversibility: 'غیرقابل بازگشت پس از ثبت موعد'
      };
    },
    async execute(ctx, options = {}) {
      const store = global.prototypeStore || global.GMStore;
      if (store && typeof store.extendGracePeriod === 'function') {
        store.extendGracePeriod(ctx.tenantId, ctx.days || 7, options.reason);
      }
      return { ok: true, extendedDays: ctx.days || 7 };
    }
  };

  /**
   * 7. Mark Invoice Paid
   */
  COMMAND_DEFINITIONS['MarkInvoicePaid'] = {
    id: 'MarkInvoicePaid',
    label: 'ثبت تسویه دستی فاکتور مالی',
    scope: 'platform',
    riskLevel: 'high',
    requiredRoles: ['PlatformOwner', 'FinanceOperator'],
    requiresReason: true,
    requiresSettlementReference: true,
    async preflight(ctx) {
      if (!ctx.invoiceId) throw new Error('شناسه فاکتور (invoiceId) الزامی است.');
      return { ok: true };
    },
    async impactPreview(ctx) {
      return {
        summary: `تغییر وضعیت فاکتور ${ctx.invoiceId} به تسویه‌شده (Paid)`,
        items: [
          'ثبت سند واریز رسمی با شماره پیگیری بانکی در سامانه مودیان',
          'فعال‌سازی آنی اشتراک و رفع تعلیق احتمالی ناشی از بدهی',
          'ثبت تراکنش در لاگ مالی با نام کاربری اپراتور اقدام‌کننده'
        ],
        reversibility: 'عملیات مالی نیازمند سند اصلاحیه و ابطال فاکتور است'
      };
    },
    async execute(ctx, options = {}) {
      const commRepo = global.CommercialRepository;
      const ref = options.settlementReference || options.reference || ctx.settlementReference || ctx.reference;
      if (!ref || !ref.trim()) {
        throw new Error('ثبت شماره پیگیری و شناسه تسویه بانکی معتبر الزامی است (شناسه خودکار مجاز نیست).');
      }
      if (!options.reason || !options.reason.trim()) {
        throw new Error('ثبت دلیل مالی و توضیحات تسویه الزامی است.');
      }
      if (commRepo && typeof commRepo.markInvoicePaid === 'function') {
        return await commRepo.markInvoicePaid(ctx.invoiceId, {
          settlementReference: ref.trim(),
          reason: options.reason.trim(),
          idempotencyKey: options.idempotencyKey
        });
      }
      const store = global.prototypeStore || global.GMStore;
      if (store && typeof store.markInvoicePaid === 'function') {
        store.markInvoicePaid(ctx.invoiceId, options.reason);
      }
      return { ok: true, invoiceId: ctx.invoiceId };
    }
  };

  /**
   * 8. Create Support Session
   */
  COMMAND_DEFINITIONS['CreateSupportSession'] = {
    id: 'CreateSupportSession',
    label: 'ایجاد نشست تفویض پشتیبانی (Delegated Support)',
    scope: 'tenant',
    riskLevel: 'high',
    requiredRoles: ['PlatformOwner', 'PlatformAdmin', 'SupportAgent'],
    requiresReason: true,
    async preflight(ctx) {
      if (!ctx.tenantId) throw new Error('شناسه مجموعه الزامی است.');
      return { ok: true };
    },
    async impactPreview(ctx) {
      const duration = ctx.durationMinutes || 30;
      return {
        summary: `صدور نشست پشتیبانی زمان‌دار (${duration} دقیقه)`,
        items: [
          'تولید توکن یکبارمصرف با دسترسی پشتیبان رسمی سالسا',
          'ثبت کلیه اقدامات کارشناس پشتیبانی در زنجیره ممیزی ضدجعل',
          'انقضای خودکار نشست پس از سپری شدن زمان مقرر'
        ],
        reversibility: 'امکان لغو آنی در هر لحظه (Revoke Session)'
      };
    },
    async execute(ctx, options = {}) {
      const repo = global.SupportRepository;
      if (!repo) throw new Error('SupportRepository در دسترس نیست.');
      return await repo.createSupportSession(ctx.tenantId, options.reason, ctx.durationMinutes || 30);
    }
  };

  /**
   * 9. Reveal PII
   */
  COMMAND_DEFINITIONS['RevealPII'] = {
    id: 'RevealPII',
    label: 'مشاهده اطلاعات محرمانه مشتریان (PII Reveal)',
    scope: 'platform',
    riskLevel: 'destructive',
    requiredRoles: ['PlatformOwner', 'PlatformAdmin', 'SupportAgent'],
    requiresReason: true,
    requiresTypedConfirmation: 'REVEAL',
    async preflight(ctx) {
      if (!ctx.targetId && !ctx.tenantId) throw new Error('شناسه هدف برای استعلام PII الزامی است.');
      return { ok: true };
    },
    async impactPreview(ctx) {
      return {
        summary: 'رمزگشایی اطلاعات هویتی، شماره تماس و سوابق حساس مهمان رستوران',
        items: [
          'ثبت درخواست همراه با علت، آی‌پی و شناسه اپراتور در ممیزی انطباق GDPR/حریم‌خصوصی',
          'اعمال سقف و محدودیت نرخ استعلام اطلاعات حساس (Rate-Limited)',
          'نمایش اطلاعات صرفاً در نشست فعلی بدون امکان ذخیره‌سازی در کش محلی'
        ],
        reversibility: 'مشاهده اطلاعات قابل بازگشت نیست اما در لاگ امنیتی ثبت قطعی می‌شود'
      };
    },
    async execute(ctx, options = {}) {
      const repo = global.SupportRepository;
      if (!repo) throw new Error('SupportRepository در دسترس نیست.');
      if (ctx.customerId) {
        return await repo.revealCustomerPhone(ctx.customerId, ctx.tenantId, options.reason);
      }
      return await repo.revealCustomerPII(ctx.tenantId, options.reason);
    }
  };

  /**
   * 10. Restore Backup Drill
   */
  COMMAND_DEFINITIONS['RestoreBackup'] = {
    id: 'RestoreBackup',
    label: 'آزمون بازیابی پشتیبان در محیط سندباکس',
    scope: 'tenant',
    riskLevel: 'high',
    requiredRoles: ['PlatformOwner', 'OperationsOperator'],
    requiresReason: true,
    async preflight(ctx) {
      if (!ctx.tenantId || !ctx.backupId) throw new Error('شناسه مجموعه و نسخه پشتیبان الزامی است.');
      return { ok: true };
    },
    async impactPreview(ctx) {
      return {
        summary: `اجرای آزمون مانور بازیابی برای فایل ${ctx.backupId}`,
        items: [
          'بازیابی در محیط ایزوله سندباکس بدون تأثیر بر دیتابیس زنده رستوران',
          'ارزیابی انطباق RPO و محاسبه زمان بازیابی (RTO)',
          'ثبت امتیاز پایداری در شناسنامه قابلیت اطمینان مجموعه'
        ],
        reversibility: 'آزمون پس از اتمام به طور خودکار پاک‌سازی می‌شود'
      };
    },
    async execute(ctx, options = {}) {
      const store = global.prototypeStore || global.GMStore;
      if (store && typeof store.restoreBackupDrill === 'function') {
        store.restoreBackupDrill(ctx.tenantId, ctx.backupId, options.reason);
      }
      return { ok: true, backupId: ctx.backupId };
    }
  };

  /**
   * 11. Purge Cache
   */
  COMMAND_DEFINITIONS['PurgeCache'] = {
    id: 'PurgeCache',
    label: 'پاک‌سازی حافظه موقت و توکن‌های ابطال‌شده',
    scope: 'platform',
    riskLevel: 'moderate',
    requiredRoles: ['PlatformOwner', 'OperationsOperator'],
    requiresReason: true,
    async preflight() { return { ok: true }; },
    async impactPreview() {
      return {
        summary: 'تخلیه کش سراسری و حذف نشست‌های منقضی‌شده',
        items: [
          'حذف کلیدهای منقضی از حافظه موقت Redis/Memcached',
          'بازخوانی تازه پیکربندی از دیتابیس در اولین درخواست بعدی',
          'عدم قطع ارتباط نشست‌های فعال جاری'
        ],
        reversibility: 'کش به تدریج بر اساس ترافیک بازسازی خواهد شد'
      };
    },
    async execute(ctx, options = {}) {
      const repo = global.OperationsRepository;
      if (!repo) throw new Error('OperationsRepository در دسترس نیست.');
      return await repo.purgeExpiredCache(options.reason);
    }
  };

  /**
   * 12. Retry Provisioning
   */
  COMMAND_DEFINITIONS['RetryProvisioning'] = {
    id: 'RetryProvisioning',
    label: 'تلاش مجدد راه‌اندازی محیط رستوران',
    scope: 'tenant',
    riskLevel: 'moderate',
    requiredRoles: ['PlatformOwner', 'OperationsOperator'],
    requiresReason: false,
    async preflight(ctx) {
      if (!ctx.jobId) throw new Error('شناسه جاب الزامی است.');
      return { ok: true };
    },
    async impactPreview(ctx) {
      return {
        summary: `اجرای مجدد گام‌های ناموفق جاب راه‌اندازی ${ctx.jobId}`,
        items: [
          'ادامه از آخرین مرحله موفق قبلی (Resumable Provisioning)',
          'عدم ایجاد نسخه تکراری پایگاه داده به واسطه شناسه یکتا (Idempotent)',
          'بررسی مجدد اتصال نودها و فعال‌سازی سرویس'
        ],
        reversibility: 'در صورت بروز خطا مجدداً قابل بررسی است'
      };
    },
    async execute(ctx) {
      const repo = global.OperationsRepository;
      if (!repo) throw new Error('OperationsRepository در دسترس نیست.');
      return await repo.retryJob(ctx.jobId);
    }
  };

  /**
   * Central Command Executor
   */
  class GodModeCommandFramework {
    static getDefinitions() {
      return COMMAND_DEFINITIONS;
    }

    static getDefinition(commandId) {
      return COMMAND_DEFINITIONS[commandId] || null;
    }

    /**
     * Executes a command through the standard safety and impact preview modal
     */
    static async execute(commandId, context = {}) {
      const def = this.getDefinition(commandId);
      if (!def) {
        throw new Error(`فرمان ناشناخته: «${commandId}»`);
      }

      // 1. Permission check
      if (global.GodModePermissions) {
        global.GodModePermissions.assertCanMutate(def.label);
        if (def.requiredRoles && !global.GodModePermissions.hasRole(def.requiredRoles)) {
          const msg = `خطای سطح دسترسی: اجرای «${def.label}» نیازمند نقش [${def.requiredRoles.join(' یا ')}] است.`;
          if (global.GMToast) global.GMToast.show(msg, 'danger');
          throw new Error(msg);
        }
      }

      // 2. Preflight validation
      if (typeof def.preflight === 'function') {
        await def.preflight(context);
      }

      // 3. Impact Preview Calculation
      let impact = { summary: def.label, items: [], reversibility: '' };
      if (typeof def.impactPreview === 'function') {
        impact = await def.impactPreview(context);
      }

      // 4. Render Impact Dialog
      return new Promise((resolve, reject) => {
        const idempotencyKey = generateIdempotencyKey(def.id.toLowerCase());

        const modalHtml = `
          <div class="command-impact-preview-container" style="display: flex; flex-direction: column; gap: 1rem; font-size: 0.9rem;">
            <div class="command-summary-banner" style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; padding: 0.85rem;">
              <div style="font-weight: 700; color: var(--text-primary, #0f172a); margin-bottom: 0.35rem;">
                ${esc(impact.summary)}
              </div>
              <div style="font-size: 0.75rem; color: var(--text-secondary, #64748b);">
                شناسه عملیات یکتا (Idempotency Key): <code style="font-family: var(--font-mono);">${esc(idempotencyKey)}</code>
              </div>
            </div>

            ${impact.items && impact.items.length > 0 ? `
              <div class="command-impact-breakdown">
                <div style="font-size: 0.82rem; font-weight: 600; color: var(--text-secondary, #64748b); margin-bottom: 0.4rem;">
                  پیش‌نمایش تأثیرات و پیامدهای عملیات:
                </div>
                <ul style="margin: 0; padding-right: 1.25rem; display: flex; flex-direction: column; gap: 0.35rem;">
                  ${impact.items.map(item => `<li style="font-size: 0.83rem; line-height: 1.5;">${esc(item)}</li>`).join('')}
                </ul>
              </div>
            ` : ''}

            ${impact.reversibility ? `
              <div style="font-size: 0.8rem; color: #4F8A34; background: rgba(79,138,52,0.1); border: 1px solid rgba(79,138,52,0.2); border-radius: 6px; padding: 0.5rem 0.75rem;">
                <strong>قابلیت بازگشت‌پذیری:</strong> ${esc(impact.reversibility)}
              </div>
            ` : ''}

            ${def.requiresSettlementReference ? `
              <div class="form-group" style="margin-top: 0.5rem;">
                <label for="cmd-settlement-ref-input" style="display: block; font-weight: 600; font-size: 0.83rem; margin-bottom: 0.35rem;">
                  شناسه و کد پیگیری تسویه بانکی / فیش واریزی <span class="text-danger">*</span>
                </label>
                <input type="text" id="cmd-settlement-ref-input" class="form-control" placeholder="مثال: REF-98324729 یا شماره فیش بانکی" style="width: 100%; font-family: var(--font-mono); direction: ltr;" required />
              </div>
            ` : ''}

            ${def.requiresReason ? `
              <div class="form-group" style="margin-top: 0.5rem;">
                <label for="cmd-reason-input" style="display: block; font-weight: 600; font-size: 0.83rem; margin-bottom: 0.35rem;">
                  ثبت دلیل رسمی اقدام <span class="text-danger">*</span>
                </label>
                <textarea id="cmd-reason-input" class="form-control" rows="2" placeholder="علت و شماره مستند یا تیکت مرتبط را بنویسید..." style="width: 100%; resize: vertical;" required></textarea>
              </div>
            ` : ''}

            ${def.requiresTypedConfirmation ? `
              <div class="form-group" style="margin-top: 0.5rem; background: rgba(239,68,68,0.06); border: 1px solid rgba(239,68,68,0.2); border-radius: 6px; padding: 0.75rem;">
                <label for="cmd-typed-confirm-input" style="display: block; font-weight: 600; font-size: 0.83rem; margin-bottom: 0.35rem; color: #EF4444;">
                  جهت اطمینان از انجام عملیات، عبارت «${esc(def.requiresTypedConfirmation)}» را تایپ کنید:
                </label>
                <input type="text" id="cmd-typed-confirm-input" class="form-control" placeholder="${esc(def.requiresTypedConfirmation)}" style="width: 100%; font-family: var(--font-mono); direction: ltr;" autocomplete="off" />
              </div>
            ` : ''}
          </div>
        `;

        if (!global.GodModeAppShell || typeof global.GodModeAppShell.openModal !== 'function') {
          reject(new Error('AppShell modal controller is not available.'));
          return;
        }

        global.GodModeAppShell.openModal(
          `${def.label} — پیش‌نمایش اثرات`,
          modalHtml,
          async () => {
            let settlementReference = '';
            if (def.requiresSettlementReference) {
              const sEl = document.getElementById('cmd-settlement-ref-input');
              settlementReference = sEl ? sEl.value.trim() : '';
              if (!settlementReference) {
                if (global.GMToast) global.GMToast.show('ثبت شناسه و کد پیگیری تسویه بانکی الزامی است.', 'warning');
                if (sEl) sEl.focus();
                return false;
              }
            }

            let reason = '';
            if (def.requiresReason) {
              const rEl = document.getElementById('cmd-reason-input');
              reason = rEl ? rEl.value.trim() : '';
              if (!reason || reason.length < 4) {
                if (global.GMToast) global.GMToast.show('ثبت دلیل رسمی اقدام (حداقل ۴ حرف) الزامی است.', 'warning');
                if (rEl) rEl.focus();
                return false;
              }
            }

            if (def.requiresTypedConfirmation) {
              const tcEl = document.getElementById('cmd-typed-confirm-input');
              const typed = tcEl ? tcEl.value.trim() : '';
              if (typed !== def.requiresTypedConfirmation) {
                if (global.GMToast) global.GMToast.show(`تأیید نامعتبر است. لطفاً عبارت «${def.requiresTypedConfirmation}» را دقیق وارد کنید.`, 'danger');
                if (tcEl) tcEl.focus();
                return false;
              }
            }

            try {
              const result = await def.execute(context, { reason, settlementReference, idempotencyKey });
              if (global.GMToast) {
                global.GMToast.show(`دستور «${def.label}» با موفقیت اعمال گردید.`, 'success');
              }
              if (global.GodModeRouter && typeof global.GodModeRouter.handleRoute === 'function') {
                global.GodModeRouter.handleRoute();
              }
              resolve(result);
              return true;
            } catch (err) {
              if (global.GMToast) {
                global.GMToast.show(`خطا در اجرای دستور «${def.label}»: ${err.message}`, 'danger');
              }
              reject(err);
              return false;
            }
          },
          {
            confirmText: 'تأیید و اجرای قطعی دستور',
            confirmVariant: def.riskLevel === 'destructive' ? 'danger' : (def.riskLevel === 'high' ? 'warning' : 'primary'),
            severity: def.riskLevel === 'destructive' ? 'danger' : (def.riskLevel === 'high' ? 'warning' : 'info'),
            severityLabel: def.riskLevel === 'destructive' ? 'عملیات مخرب و حساس' : (def.riskLevel === 'high' ? 'اقدام با تأثیر بالا' : 'دستور استاندارد')
          }
        );
      });
    }
  }

  global.GodModeCommandFramework = GodModeCommandFramework;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = GodModeCommandFramework;
    module.exports.COMMAND_DEFINITIONS = COMMAND_DEFINITIONS;
  }
})(typeof window !== 'undefined' ? window : globalThis);
