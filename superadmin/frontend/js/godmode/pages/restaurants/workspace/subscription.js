/**
 * superadmin/frontend/js/godmode/pages/restaurants/workspace/subscription.js
 *
 * Tab 2: Subscription & Modular Capabilities (superadmin.md §7.3).
 * Bridges commercial Business Modules with technical feature keys in WESTO.
 * Operators can inspect, filter, and toggle any capability with 1-click live synchronization.
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

  async function renderSubscriptionTab(restaurant, params) {
    const entitlementsRepo = global.EntitlementsRepository;
    const commercialRepo = global.CommercialRepository;
    const StatusBadge = global.StatusBadge;

    let evalData = null;
    let invoices = [];
    try {
      if (entitlementsRepo) {
        evalData = await entitlementsRepo.calculateEffectiveEntitlements(restaurant.id);
      }
      if (commercialRepo) {
        invoices = await commercialRepo.getTenantInvoices(restaurant.id);
      }
    } catch (_) {}

    const modules = evalData?.modules || [];
    const activeCount = modules.filter(m => m.isEnabled).length;
    const totalCount = modules.length;

    return `
      <div class="workspace-tab-panel subscription-panel">
        <!-- Top Summary Card: Plan & Billing Details -->
        <div class="card" style="padding: 1.5rem; border-radius: 12px; border: 1px solid var(--border, #E5E7EB); margin-bottom: 1.5rem; background: var(--card, #FFF);">
          <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem; margin-bottom: 1rem;">
            <div>
              <span style="font-size: 0.8rem; color: var(--text-secondary, #666);">پلن اشتراک و معماری ماژولار</span>
              <div style="font-size: 1.4rem; font-weight: 800; color: var(--primary, #E6292A); display: flex; align-items: center; gap: 0.75rem;">
                <span>${esc(restaurant.plan || 'استاندارد')}</span>
                <span class="badge badge-subtle" style="font-size: 0.75rem; font-weight: 600; padding: 3px 8px; border-radius: 6px; background: rgba(230, 41, 42, 0.1); color: var(--primary, #E6292A);">
                  ${activeCount} از ${totalCount} ماژول فعال
                </span>
              </div>
            </div>
            <div style="display: flex; gap: 0.75rem;">
              <button type="button" class="btn btn-secondary btn-sm" onclick="window.GodModeAppShell ? window.GodModeAppShell.openChangePlanModal('${esc(restaurant.id)}') : null">
                تغییر پلن اشتراک
              </button>
            </div>
          </div>

          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 1rem; padding-top: 1rem; border-top: 1px solid var(--border, #EEE); font-size: 0.85rem;">
            <div>
              <span style="color: var(--text-secondary, #666); display: block;">دوره صورتحساب:</span>
              <strong style="color: var(--text-primary, #111);">ماهانه</strong>
            </div>
            <div>
              <span style="color: var(--text-secondary, #666); display: block;">اتصال پلتفرم:</span>
              <strong style="color: #10B981; display: inline-flex; align-items: center; gap: 4px;">
                <span style="width: 8px; height: 8px; border-radius: 50%; background: #10B981; display: inline-block;"></span>
                هسته WESTO (پورت ۴۱۸۰)
              </strong>
            </div>
            <div>
              <span style="color: var(--text-secondary, #666); display: block;">همگام‌سازی کنترل‌پلن:</span>
              <strong style="color: var(--text-primary, #111);">برخط و آنی (Zero-Delay)</strong>
            </div>
            <div>
              <span style="color: var(--text-secondary, #666); display: block;">سقف مجاز پایانه‌ها:</span>
              <strong style="color: var(--text-primary, #111);">۴ پایانه صندوق / شعبه</strong>
            </div>
          </div>
        </div>

        <!-- Section 2: Modular Capabilities Catalog -->
        <div style="margin-bottom: 2rem;">
          <div style="display: flex; justify-content: space-between; align-items: flex-end; flex-wrap: wrap; gap: 1rem; margin-bottom: 1.25rem;">
            <div>
              <h2 style="font-size: 1.15rem; font-weight: 700; margin: 0 0 0.25rem 0; color: var(--text-primary, #111);">
                کاتالوگ ماژول‌ها و قابلیت‌های وستو (WESTO Modules)
              </h2>
              <p style="font-size: 0.85rem; color: var(--text-secondary, #666); margin: 0;">
                مدیریت تفکیکی ماژول‌ها با سوئیچ ۱-کلیک فعال/غیرفعال‌سازی؛ تغییرات بلافاصله به هسته وستو ابلاغ می‌شود.
              </p>
            </div>

            <!-- Category Filter Pills -->
            <div class="category-filters" style="display: flex; flex-wrap: wrap; gap: 0.4rem;">
              <button type="button" class="btn btn-xs cat-filter-btn active" data-cat="all" onclick="window.GodModeSubscription ? window.GodModeSubscription.filterCategory('all') : null" style="border-radius: 20px; padding: 4px 12px;">همه ماژول‌ها</button>
              <button type="button" class="btn btn-xs cat-filter-btn" data-cat="operations" onclick="window.GodModeSubscription ? window.GodModeSubscription.filterCategory('operations') : null" style="border-radius: 20px; padding: 4px 12px;">عملیات و سفارشات</button>
              <button type="button" class="btn btn-xs cat-filter-btn" data-cat="floor" onclick="window.GodModeSubscription ? window.GodModeSubscription.filterCategory('floor') : null" style="border-radius: 20px; padding: 4px 12px;">سالن و گارسون</button>
              <button type="button" class="btn btn-xs cat-filter-btn" data-cat="kitchen" onclick="window.GodModeSubscription ? window.GodModeSubscription.filterCategory('kitchen') : null" style="border-radius: 20px; padding: 4px 12px;">آشپزخانه و KDS</button>
              <button type="button" class="btn btn-xs cat-filter-btn" data-cat="experience" onclick="window.GodModeSubscription ? window.GodModeSubscription.filterCategory('experience') : null" style="border-radius: 20px; padding: 4px 12px;">منو، QR و رزرو</button>
              <button type="button" class="btn btn-xs cat-filter-btn" data-cat="backoffice" onclick="window.GodModeSubscription ? window.GodModeSubscription.filterCategory('backoffice') : null" style="border-radius: 20px; padding: 4px 12px;">مالی و انبارداری</button>
              <button type="button" class="btn btn-xs cat-filter-btn" data-cat="marketing" onclick="window.GodModeSubscription ? window.GodModeSubscription.filterCategory('marketing') : null" style="border-radius: 20px; padding: 4px 12px;">مشتریان و وفاداری</button>
              <button type="button" class="btn btn-xs cat-filter-btn" data-cat="scale_brand" onclick="window.GodModeSubscription ? window.GodModeSubscription.filterCategory('scale_brand') : null" style="border-radius: 20px; padding: 4px 12px;">شعب، برند و تحلیل</button>
            </div>
          </div>

          <!-- Cards Grid -->
          <div class="modules-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 1rem;">
            ${modules.map(mod => {
              const badgeHtml = StatusBadge ? StatusBadge.renderModuleStateBadge(mod.state) : esc(mod.state);
              const filterCat = (mod.category === 'scale' || mod.category === 'brand' || mod.category === 'management') ? 'scale_brand' : mod.category;
              const isChecked = Boolean(mod.isEnabled);

              return `
                <div class="card module-card" data-category="${esc(filterCat)}" data-module="${esc(mod.key)}" style="padding: 1.25rem; border-radius: 12px; border: 1px solid var(--border, #E5E7EB); background: var(--card, #FFF); display: flex; flex-direction: column; justify-content: space-between; transition: box-shadow 0.2s, border-color 0.2s;">
                  <div>
                    <!-- Card Top Bar: Icon, Title, and 1-Click Toggle -->
                    <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.6rem; gap: 0.75rem;">
                      <div style="display: flex; align-items: center; gap: 0.6rem;">
                        <span style="font-size: 1.4rem; line-height: 1;">${esc(mod.icon)}</span>
                        <div>
                          <strong style="font-size: 0.95rem; color: var(--text-primary, #111); display: block;">${esc(mod.nameFa)}</strong>
                          <span style="font-size: 0.75rem; color: var(--text-tertiary, #888); font-family: var(--font-mono);">${esc(mod.key)}</span>
                        </div>
                      </div>

                      <!-- 1-Click iOS Toggle Switch -->
                      <div style="display: flex; align-items: center; gap: 0.5rem;">
                        <label class="switch" title="${isChecked ? 'کلیک کنید تا ماژول برای مشتری غیرفعال شود' : 'کلیک کنید تا ماژول برای مشتری فعال شود'}" style="margin: 0; cursor: pointer;">
                          <input type="checkbox" ${isChecked ? 'checked' : ''} onchange="window.GodModeSubscription ? window.GodModeSubscription.toggleModule('${esc(restaurant.id)}', '${esc(mod.key)}', this.checked, this) : null">
                          <span class="slider"></span>
                        </label>
                      </div>
                    </div>

                    <!-- Status & Reason -->
                    <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.6rem;">
                      ${badgeHtml}
                      <span style="font-size: 0.75rem; color: ${isChecked ? '#10B981' : 'var(--text-tertiary, #888)'}; font-weight: 500;">
                        ${isChecked ? '● فعال و قابل استفاده' : '○ غیرفعال'}
                      </span>
                    </div>

                    <!-- Description Fa -->
                    <p style="font-size: 0.82rem; color: var(--text-secondary, #666); line-height: 1.5; margin: 0 0 0.75rem 0;">
                      ${esc(mod.descriptionFa)}
                    </p>

                    <!-- Technical Sub-Feature Keys -->
                    <div style="margin-bottom: 0.75rem;">
                      <span style="font-size: 0.72rem; color: var(--text-tertiary, #888); display: block; margin-bottom: 0.25rem;">قابلیت‌های فنی متصل در وستو:</span>
                      <div style="display: flex; flex-wrap: wrap; gap: 0.3rem;">
                        ${(mod.technicalFeatures || []).map(feat => `
                          <span class="badge-feature-pill" style="font-family: var(--font-mono); font-size: 0.7rem; background: var(--surface-2, rgba(0,0,0,0.04)); color: var(--text-secondary, #555); border: 1px solid var(--border, #EEE); padding: 1px 6px; border-radius: 4px;">
                            ${esc(feat)}
                          </span>
                        `).join('')}
                      </div>
                    </div>
                  </div>

                  <!-- Footer Actions & Details -->
                  <div style="display: flex; justify-content: space-between; align-items: center; padding-top: 0.75rem; border-top: 1px dashed var(--border, #EEE); font-size: 0.8rem;">
                    <div>
                      ${mod.defaultPriceToman ? `
                        <span style="font-size: 0.75rem; color: var(--text-tertiary, #888);">تعرفه: </span>
                        <strong style="color: var(--text-primary, #111);">${mod.defaultPriceToman.toLocaleString('fa-IR')} ت/ماه</strong>
                      ` : ''}
                    </div>

                    <div style="display: flex; align-items: center; gap: 0.4rem;">
                      <button type="button" class="btn btn-ghost btn-xs" onclick="window.GodModeSubscription ? window.GodModeSubscription.openOverrideModal('${esc(restaurant.id)}', '${esc(mod.key)}') : null" title="ثبت مجوز یا منع اختصاصی خارج از پلن">
                        استثنای اختصاصی…
                      </button>
                    </div>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>

        <!-- Section 3: Recent Invoices for this Restaurant -->
        <div class="card" style="border-radius: 12px; border: 1px solid var(--border, #E5E7EB); overflow: hidden; background: var(--card, #FFF);">
          <div class="card-header" style="background: var(--surface-2, #F9FAFB); padding: 0.85rem 1.25rem; border-bottom: 1px solid var(--border, #E5E7EB); display: flex; justify-content: space-between; align-items: center;">
            <strong style="font-size: 0.95rem; color: var(--text-primary, #111);">صورتحساب‌ها و فاکتورهای اخیر</strong>
            <span style="font-size: 0.75rem; color: var(--text-secondary, #666);">گردش حساب مشتری در سالسا</span>
          </div>
          <div class="card-body" style="padding: 0;">
            ${invoices.length === 0 ? `
              <div style="padding: 2rem; text-align: center; color: var(--text-tertiary, #888); font-size: 0.85rem;">
                فاکتوری برای این مجموعه ثبت نشده است.
              </div>
            ` : `
              <table class="data-table" style="width: 100%; border-collapse: collapse; font-size: 0.85rem;">
                <thead>
                  <tr style="background: var(--surface-2, #FAFAFA); text-align: right; border-bottom: 1px solid var(--border, #EEE);">
                    <th style="padding: 0.75rem 1rem; color: var(--text-secondary, #666);">شماره فاکتور</th>
                    <th style="padding: 0.75rem 1rem; color: var(--text-secondary, #666);">دوره</th>
                    <th style="padding: 0.75rem 1rem; color: var(--text-secondary, #666);">مبلغ</th>
                    <th style="padding: 0.75rem 1rem; color: var(--text-secondary, #666);">وضعیت</th>
                    <th style="padding: 0.75rem 1rem; color: var(--text-secondary, #666);">تاریخ پرداخت</th>
                  </tr>
                </thead>
                <tbody>
                  ${invoices.map(inv => `
                    <tr style="border-bottom: 1px solid var(--border, #F3F4F6);">
                      <td style="padding: 0.75rem 1rem; font-family: var(--font-mono); font-weight: 600; color: var(--text-primary, #111);">${esc(inv.invoiceNumber || inv.id)}</td>
                      <td style="padding: 0.75rem 1rem; color: var(--text-secondary, #555);">${esc(inv.period || 'ماهانه')}</td>
                      <td style="padding: 0.75rem 1rem; font-weight: 700; color: var(--text-primary, #111);">${(inv.amountToman || 0).toLocaleString('fa-IR')} تومان</td>
                      <td style="padding: 0.75rem 1rem;">
                        <span class="badge ${inv.status === 'paid' ? 'badge-success' : 'badge-danger'}">
                          ${inv.status === 'paid' ? 'پرداخت‌شده' : 'معوق'}
                        </span>
                      </td>
                      <td style="padding: 0.75rem 1rem; color: var(--text-secondary, #666);">${inv.paidAt ? new Date(inv.paidAt).toLocaleDateString('fa-IR') : '—'}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            `}
          </div>
        </div>

      </div>
    `;
  }

  const GodModeSubscription = {
    /**
     * 1-Click Toggle for any module or capability
     */
    async toggleModule(tenantId, moduleKey, isChecked, inputEl) {
      if (inputEl) inputEl.disabled = true;
      if (global.GMToast) {
        global.GMToast.show(`در حال ${isChecked ? 'فعال‌سازی' : 'غیرفعال‌سازی'} ماژول «${moduleKey}» و همگام‌سازی با وستو...`, 'info');
      }

      try {
        if (global.EntitlementsRepository) {
          await global.EntitlementsRepository.toggleModuleForTenant(
            tenantId,
            moduleKey,
            isChecked,
            `تغییر وضعیت ۱-کلیک توسط اپراتور به ${isChecked ? 'فعال' : 'غیرفعال'}`
          );

          if (global.GMToast) {
            global.GMToast.show(`ماژول «${moduleKey}» با موفقیت ${isChecked ? 'فعال' : 'غیرفعال'} و در وستو اعمال شد.`, 'success');
          }

          // Rerender current route to refresh cards and indicators
          if (global.GodModeRouter && typeof global.GodModeRouter.handleRoute === 'function') {
            await global.GodModeRouter.handleRoute();
          }
        }
      } catch (err) {
        if (inputEl) {
          inputEl.checked = !isChecked; // Revert checkbox state
          inputEl.disabled = false;
        }
        if (global.GMToast) {
          global.GMToast.show(`خطا در تغییر وضعیت ماژول: ${err.message}`, 'danger');
        }
      }
    },

    /**
     * Category filtering for module cards
     */
    filterCategory(category) {
      const cards = document.querySelectorAll('.module-card');
      const buttons = document.querySelectorAll('.cat-filter-btn');

      buttons.forEach(b => {
        if (b.dataset.cat === category) {
          b.classList.add('active');
          b.style.background = 'var(--primary, #E6292A)';
          b.style.color = '#FFF';
        } else {
          b.classList.remove('active');
          b.style.background = '';
          b.style.color = '';
        }
      });

      cards.forEach(c => {
        if (category === 'all' || c.dataset.category === category) {
          c.style.display = 'flex';
        } else {
          c.style.display = 'none';
        }
      });
    },

    async activateAddon(tenantId, moduleKey) {
      if (!global.GodModeConfirmDialog) return;
      global.GodModeConfirmDialog.show({
        title: `فعال‌سازی افزونه برای ${tenantId}`,
        severity: 'moderate',
        message: `آیا مایل به فعال‌سازی ماژول «${moduleKey}» به عنوان افزونه تجاری برای این رستوران هستید؟`,
        requireReason: false,
        confirmText: 'فعال‌سازی افزونه',
        onConfirm: async () => {
          if (global.EntitlementsRepository) {
            await global.EntitlementsRepository.enableModuleAddon(tenantId, moduleKey, 1);
            if (global.GMToast) global.GMToast.show(`ماژول «${moduleKey}» با موفقیت فعال شد.`, 'success');
            if (global.GodModeRouter) global.GodModeRouter.handleRoute();
          }
        }
      });
    },

    async deactivateAddon(tenantId, moduleKey) {
      if (!global.GodModeConfirmDialog) return;
      global.GodModeConfirmDialog.show({
        title: `لغو افزونه ${moduleKey}`,
        severity: 'destructive',
        message: `آیا از لغو مجوز افزونه تجاری «${moduleKey}» برای این مجموعه اطمینان دارید؟`,
        impactDetails: 'دسترسی به قابلیت‌های این ماژول بلافاصله لغو خواهد شد.',
        requireReason: true,
        reasonPlaceholder: 'علت لغو افزونه (درخواست مشتری، عدم پرداخت و...)',
        confirmText: 'لغو قطعی افزونه',
        onConfirm: async (reason) => {
          if (global.EntitlementsRepository) {
            await global.EntitlementsRepository.disableModuleAddon(tenantId, moduleKey, reason);
            if (global.GMToast) global.GMToast.show(`افزونه «${moduleKey}» با موفقیت لغو شد.`, 'danger');
            if (global.GodModeRouter) global.GodModeRouter.handleRoute();
          }
        }
      });
    },

    openOverrideModal(tenantId, moduleKey) {
      if (!global.GodModeConfirmDialog) return;
      global.GodModeConfirmDialog.show({
        title: `استثنای اختصاصی ماژول ${moduleKey}`,
        severity: 'high',
        message: 'ثبت استثنا مجوزی خارج از پلن است و باید دارای دلیل موجه باشد.',
        requireReason: true,
        reasonPlaceholder: 'دلیل صدور استثنا (مثال: درخواست تست برای نمایشگاه، قرارداد ویژه و...)',
        confirmText: 'اعمال استثنا',
        onConfirm: async (reason) => {
          if (global.EntitlementsRepository) {
            await global.EntitlementsRepository.setModuleOverride(tenantId, moduleKey, 'allow', reason);
            if (global.GMToast) global.GMToast.show(`استثنای اختصاصی برای «${moduleKey}» ثبت شد.`, 'info');
            if (global.GodModeRouter) global.GodModeRouter.handleRoute();
          }
        }
      });
    }
  };

  global.GodModeSubscription = GodModeSubscription;

  if (global.GodModeRestaurantWorkspace) {
    global.GodModeRestaurantWorkspace.registerTabRenderer('subscription', renderSubscriptionTab);
  }
})(typeof window !== 'undefined' ? window : globalThis);
