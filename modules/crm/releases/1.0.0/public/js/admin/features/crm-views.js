/* Existing WESTO views, separated without changing their markup or behavior. */

/*westo-view:start:club*/
window.WestoAdminModules.defineView('crm', 'club', function(__westoViewContext) {
return {
async club(activeSubTab = 'customers') {
      __westoViewContext.setActiveTab('club');
      const segment = (customer) => customer.tier?.name || (customer.total >= 5000000 ? 'ویژه' : 'وفادار');
      const tierBadge = (cust) => {
        const t = cust.tier || { id: 'bronze', name: 'برنزی', badgeIcon: '🥉' };
        return `<span class="tier-badge tier-badge-${t.id || 'bronze'}">${__westoViewContext.esc(t.badgeIcon || '🥉')} ${__westoViewContext.esc(t.name || segment(cust))}</span>`;
      };

      const renderNav = (subTab) => `
        <nav class="club-nav" aria-label="باشگاه مشتریان">
          <button class="club-nav-item ${subTab === 'customers' ? 'is-active' : ''}" data-club-subtab="customers" type="button">مشتریان</button>
          <button class="club-nav-item ${subTab === 'wallet' ? 'is-active' : ''}" data-club-subtab="wallet" type="button">کیف پول</button>
          <button class="club-nav-item ${subTab === 'campaigns' ? 'is-active' : ''}" data-club-subtab="campaigns" type="button">کمپین‌ها</button>
          <button class="club-nav-item ${subTab === 'sms' ? 'is-active' : ''}" data-club-subtab="sms" type="button">پیامک</button>
          <button class="club-nav-item ${subTab === 'loyalty' ? 'is-active' : ''}" data-club-subtab="loyalty" type="button">سطوح</button>
        </nav>
      `;

      const bindNav = () => {
        __westoViewContext.main.querySelectorAll('[data-club-subtab]').forEach((btn) => {
          btn.addEventListener('click', () => __westoViewContext.tabs.club(btn.dataset.clubSubtab));
        });
      };

      const renderDossierModal = async (phone) => {
        try {
          const [custData, fullLoyalty, walletSummary] = await Promise.all([
            __westoViewContext.api(`/api/loyalty/customer?phone=${encodeURIComponent(phone)}`).catch(() => ({})),
            __westoViewContext.api('/api/admin/loyalty').catch(() => ({})),
            __westoViewContext.api('/api/admin/wallet/summary').catch(() => ({})),
          ]);
          const userPointsLedger = (fullLoyalty.ledger || []).filter((e) => e.phone === phone);
          const userWalletLedger = (walletSummary.recentTransactions || []).filter((e) => e.phone === phone);

          let modalEl = document.getElementById('customer-dossier-modal');
          if (!modalEl) {
            modalEl = document.createElement('div');
            modalEl.id = 'customer-dossier-modal';
            modalEl.className = 'dossier-modal-overlay';
            document.body.appendChild(modalEl);
          }

          const tier = custData.tier || { name: 'برنزی', badgeIcon: '🥉', id: 'bronze', multiplier: 1.0, discountPct: 1 };

          modalEl.innerHTML = `
            <div class="dossier-modal-box" role="dialog" aria-modal="true" aria-labelledby="dossier-title">
              <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid rgba(255,255,255,0.1); padding-bottom:0.6rem; margin-bottom:0.85rem;">
                <div>
                  <h2 id="dossier-title" style="margin:0; font-size:1.05rem;">پرونده: ${__westoViewContext.esc(custData.name || 'مشتری')}</h2>
                  <div class="hint ltr" style="margin-top:0.15rem; font-size:0.8rem;">${__westoViewContext.esc(custData.phone || phone)} · ${__westoViewContext.esc(tier.badgeIcon || '🥉')} ${__westoViewContext.esc(tier.name || 'برنزی')}</div>
                </div>
                <button class="btn btn-sm btn-ghost" id="dossier-close-btn" type="button">✕ بستن</button>
              </div>

              <!-- Quick Communication Action Buttons -->
              <div class="dossier-actions-strip">
                <a class="dossier-comm-btn dossier-comm-btn--call" href="tel:${__westoViewContext.esc(phone)}" title="تماس مستقیم">📞 تماس تلفنی</a>
                <a class="dossier-comm-btn dossier-comm-btn--sms" href="sms:${__westoViewContext.esc(phone)}" title="ارسال پیامک">💬 ارسال پیامک</a>
                <a class="dossier-comm-btn dossier-comm-btn--whatsapp" href="https://wa.me/${__westoViewContext.esc(String(phone).replace(/^0/, '98'))}" target="_blank" rel="noopener" title="گفتگو در واتساپ">📱 پیام واتساپ</a>
              </div>

              <div class="club-kpi-strip" style="margin-bottom:0.85rem;">
                <div class="club-kpi accent"><div class="num">${__westoViewContext.fmtMoney(custData.walletBalanceToman || 0)}</div><div class="lbl">موجودی کیف پول</div></div>
                <div class="club-kpi"><div class="num">${__westoViewContext.fmtNum(custData.points || 0)}</div><div class="lbl">امتیاز باشگاه</div></div>
                <div class="club-kpi"><div class="num">${__westoViewContext.fmtNum(tier.multiplier || 1)}x</div><div class="lbl">ضریب پاداش</div></div>
                <div class="club-kpi"><div class="num">${__westoViewContext.fmtNum(tier.discountPct || 0)}٪</div><div class="lbl">تخفیف فاکتور</div></div>
              </div>

              <div class="grid-2-main" style="gap:0.75rem; margin-bottom:0.85rem;">
                <div class="section-box club-section" style="margin:0; padding:0.75rem;">
                  <h3 style="font-size:0.85rem; margin-bottom:0.4rem;">تعدیل امتیاز</h3>
                  <div class="club-form-row" style="grid-template-columns: 90px 1fr auto; gap:0.4rem;">
                    <input type="number" id="dossier-delta" class="input ltr" placeholder="مقدار" value="50" style="font-size:0.8rem;" />
                    <input type="text" id="dossier-reason" class="input" placeholder="شرح" value="پاداش وفاداری" style="font-size:0.8rem;" />
                    <button class="btn btn-sm" id="dossier-adjust-btn" type="button">ثبت</button>
                  </div>
                </div>

                <div class="section-box club-section" style="margin:0; padding:0.75rem;">
                  <h3 style="font-size:0.85rem; margin-bottom:0.4rem;">شارژ / کسر کیف پول</h3>
                  <div class="club-form-row" style="grid-template-columns: 110px 1fr auto; gap:0.4rem;">
                    <input type="number" id="dossier-wallet-delta" class="input ltr" placeholder="مبلغ (ت)" value="100000" style="font-size:0.8rem;" />
                    <input type="text" id="dossier-wallet-reason" class="input" placeholder="شرح" value="شارژ دستی" style="font-size:0.8rem;" />
                    <button class="btn btn-sm btn-accent" id="dossier-wallet-btn" type="button">اعمال</button>
                  </div>
                  <div class="dossier-wallet-presets">
                    <span style="font-size:0.75rem; color:#94a3b8;">شارژ سریع:</span>
                    <button type="button" class="dossier-preset-chip" data-topup-preset="50000">+۵۰٬۰۰۰</button>
                    <button type="button" class="dossier-preset-chip" data-topup-preset="100000">+۱۰۰٬۰۰۰</button>
                    <button type="button" class="dossier-preset-chip" data-topup-preset="200000">+۲۰۰٬۰۰۰</button>
                    <button type="button" class="dossier-preset-chip" data-topup-preset="500000">+۵۰۰٬۰۰۰</button>
                  </div>
                </div>
              </div>

              <!-- Dietary & Allergy Tags -->
              <div class="section-box club-section" style="margin:0 0 0.85rem 0; padding:0.75rem;">
                <h3 style="font-size:0.85rem; margin-bottom:0.4rem;">🥗 ترجیحات غذایی و آلرژی‌های مهمان</h3>
                <div class="dossier-tags-wrap" id="dossier-tags-container">
                  ${['گیاه‌خوار', 'بدون گلوتن', 'حساسیت به آجیل', 'دیابتی', 'تندپسند', 'بدون پیاز'].map((tag) => {
                    const isSelected = (custData.tags || []).includes(tag);
                    return `<button type="button" class="dossier-tag ${isSelected ? 'dossier-tag--dietary' : ''}" data-dossier-tag="${__westoViewContext.esc(tag)}" style="cursor:pointer; opacity:${isSelected ? '1' : '0.55'};">${isSelected ? '✓ ' : '+ '}${__westoViewContext.esc(tag)}</button>`;
                  }).join('')}
                </div>
              </div>

              <!-- VIP Notes -->
              <div class="section-box club-section" style="margin:0 0 0.85rem 0; padding:0.75rem;">
                <h3 style="font-size:0.85rem; margin-bottom:0.4rem;">⭐ یادداشت اختصاصی تشریفات و پذیرایی (VIP Note)</h3>
                <div class="club-form-row" style="grid-template-columns: 1fr auto; gap:0.4rem;">
                  <input type="text" id="dossier-vip-note" class="input" placeholder="مثلاً: ترجیح میز کنار پنجره، آب بدون یخ، مهمان هیئت مدیره..." value="${__westoViewContext.esc(custData.vipNote || '')}" style="font-size:0.8rem;" />
                  <button class="btn btn-sm btn-ghost" id="dossier-save-vip-btn" type="button">ذخیره یادداشت</button>
                </div>
              </div>

              <!-- Admin Birthdate Override Section -->
              <div class="section-box club-section" style="margin:0 0 0.85rem 0; padding:0.75rem;">
                <h3 style="font-size:0.85rem; margin-bottom:0.4rem;">🎂 تاریخ تولد مشتری (ویرایش ویژه مدیر)</h3>
                <div class="club-form-row" style="grid-template-columns: 1fr auto; gap:0.4rem;">
                  <input type="text" id="dossier-bday" class="input ltr" placeholder="مثلاً: 1370/06/15" value="${__westoViewContext.esc(custData.birthdate || '')}" style="font-size:0.8rem;" />
                  <button class="btn btn-sm" id="dossier-save-bday-btn" type="button">ثبت تاریخ تولد</button>
                </div>
              </div>

              <div>
                <h3 style="font-size:0.85rem; margin-bottom:0.4rem;">آخرین تراکنش‌های کیف پول</h3>
                <div style="overflow-x:auto;">
                  <table class="tbl" style="font-size:0.78rem;">
                    <thead><tr><th>زمان</th><th>نوع</th><th>تغییر (ت)</th><th>شرح</th></tr></thead>
                    <tbody>
                      ${userWalletLedger.slice(0, 5).map((e) => `
                        <tr>
                          <td>${__westoViewContext.fmtDateTime(e.at)}</td>
                          <td><span class="pill">${__westoViewContext.esc(e.type === 'topup' ? 'شارژ' : e.type === 'pay' ? 'خرید' : e.type === 'cashback' ? 'پاداش نقدی' : e.type || 'تراکنش')}</span></td>
                          <td style="color:${e.deltaToman > 0 ? '#10b981' : '#ef4444'}; font-weight:700;">${e.deltaToman > 0 ? '+' : ''}${__westoViewContext.fmtMoney(e.deltaToman)}</td>
                          <td>${__westoViewContext.esc(e.description || '—')}</td>
                        </tr>
                      `).join('') || '<tr><td colspan="4">تراکنشی ثبت نشده است.</td></tr>'}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          `;

          modalEl.querySelector('#dossier-close-btn').addEventListener('click', () => modalEl.remove());
          modalEl.querySelector('#dossier-adjust-btn').addEventListener('click', async () => {
            const delta = Number(modalEl.querySelector('#dossier-delta').value) || 0;
            const reason = modalEl.querySelector('#dossier-reason').value || 'تعدیل دستی';
            await __westoViewContext.api('/api/admin/loyalty/adjust', { method: 'POST', body: JSON.stringify({ phone, delta, reason }) });
            __westoViewContext.showToast('امتیاز با موفقیت اعمال شد'); renderDossierModal(phone);
          });
          modalEl.querySelector('#dossier-wallet-btn').addEventListener('click', async () => {
            const deltaToman = __westoViewContext.parseInputNumber(modalEl.querySelector('#dossier-wallet-delta').value) || 0;
            const reason = modalEl.querySelector('#dossier-wallet-reason').value || 'شارژ دستی';
            const idempotencyKey = window.crypto?.randomUUID?.() || `wallet-adjust-${Date.now()}-${Math.random().toString(16).slice(2)}`;
            try {
              await __westoViewContext.api('/api/admin/wallet/adjust', {
                method: 'POST',
                headers: { 'Idempotency-Key': idempotencyKey },
                body: JSON.stringify({ phone, deltaToman, reason, branchId: __westoViewContext.currentBranchId || 1 }),
              });
              __westoViewContext.showToast('کیف پول با موفقیت به‌روزرسانی شد');
              renderDossierModal(phone);
            } catch (error) {
              __westoViewContext.showToast(error.message || 'ثبت تعدیل کیف پول ناموفق بود', 'error');
            }
          });
          modalEl.querySelectorAll('[data-topup-preset]').forEach((chip) => {
            chip.addEventListener('click', () => {
              const inp = modalEl.querySelector('#dossier-wallet-delta');
              if (inp) {
                inp.value = chip.dataset.topupPreset;
                inp.focus();
              }
            });
          });
          modalEl.querySelectorAll('[data-dossier-tag]').forEach((tagBtn) => {
            tagBtn.addEventListener('click', async () => {
              const tag = tagBtn.dataset.dossierTag;
              const currentTags = custData.tags || [];
              const newTags = currentTags.includes(tag) ? currentTags.filter((t) => t !== tag) : [...currentTags, tag];
              try {
                await __westoViewContext.api(`/api/admin/customers/${encodeURIComponent(phone)}`, { method: 'PATCH', body: JSON.stringify({ tags: newTags }) });
                __westoViewContext.showToast('ترجیحات مشتری ذخیره شد', 'success', 1000);
                renderDossierModal(phone);
              } catch (e) {
                __westoViewContext.showToast(e.message || 'خطا در ذخیره ترجیحات', 'error');
              }
            });
          });
          modalEl.querySelector('#dossier-save-vip-btn')?.addEventListener('click', async () => {
            const vipNote = modalEl.querySelector('#dossier-vip-note')?.value || '';
            try {
              await __westoViewContext.api(`/api/admin/customers/${encodeURIComponent(phone)}`, { method: 'PATCH', body: JSON.stringify({ vipNote }) });
              __westoViewContext.showToast('یادداشت تشریفات ذخیره شد', 'success', 1200);
              renderDossierModal(phone);
            } catch (e) {
              __westoViewContext.showToast(e.message || 'خطا در ذخیره یادداشت', 'error');
            }
          });
          modalEl.querySelector('#dossier-save-bday-btn')?.addEventListener('click', async () => {
            const birthdate = modalEl.querySelector('#dossier-bday').value.trim();
            await __westoViewContext.api(`/api/admin/customers/${encodeURIComponent(phone)}`, { method: 'PATCH', body: JSON.stringify({ birthdate }) });
            __westoViewContext.showToast('تاریخ تولد مشتری با موفقیت توسط مدیر به‌روزرسانی شد'); renderDossierModal(phone);
          });
        } catch (err) {
          __westoViewContext.showToast(err.message || 'خطا در بارگذاری پرونده');
        }
      };

      if (activeSubTab === 'wallet') {
        const [d, pendingData] = await Promise.all([
          __westoViewContext.api('/api/admin/wallet/summary'),
          __westoViewContext.api(`/api/wallet/topup-requests/pending${__westoViewContext.branchQs()}`).catch(() => ({ requests: [] })),
        ]);
        const packages = d.packages || [];
        const pendingReqs = pendingData.requests || [];

        __westoViewContext.main.innerHTML = `
          ${renderNav('wallet')}
          <div class="club-kpi-strip">
            <div class="club-kpi accent"><div class="num">${__westoViewContext.fmtMoney(d.totalLiabilityToman || 0)}</div><div class="lbl">موجودی کل</div></div>
            <div class="club-kpi"><div class="num">${__westoViewContext.fmtNum(d.activeWalletsCount || 0)}</div><div class="lbl">کیف پول فعال</div></div>
          </div>

          <!-- Pending In-Store Topup Requests -->
          ${pendingReqs.length > 0 ? `
            <div class="section-box club-section" style="border-top:3px solid #f59e0b; margin-bottom:1rem;">
              <h2 class="club-section-title" style="color:#f59e0b;">⏳ درخواست‌های شارژ حضوری در انتظار تأیید گارسون / صندوق (${pendingReqs.length})</h2>
              <div style="overflow-x:auto;">
                <table class="tbl" style="font-size:0.8rem;">
                  <thead><tr><th>کد پیگیری</th><th>مشتری</th><th>مبلغ شارژ</th><th>اعتبار کل</th><th>عملیات تأیید</th></tr></thead>
                  <tbody>
                    ${pendingReqs.map(r => `
                      <tr>
                        <td><b class="ltr admin-tracking-code" style="font-size:1.1rem; padding:0.15rem 0.5rem; border-radius:0.35rem;">${__westoViewContext.esc(r.trackingCode)}</b></td>
                        <td>${__westoViewContext.esc(r.customerName || 'مشتری')} <small class="ltr" style="color:var(--text-muted);">(${__westoViewContext.esc(r.phone)})</small></td>
                        <td>${__westoViewContext.fmtMoney(r.amountToman)}</td>
                        <td style="color:#10b981; font-weight:700;">+${__westoViewContext.fmtMoney(r.totalCredit)}</td>
                        <td>
                          <button type="button" class="btn btn-sm btn-accent approve-topup-btn" data-req-id="${__westoViewContext.esc(r.id)}" data-phone="${__westoViewContext.esc(r.phone)}" data-amount="${r.amountToman}" style="padding:0.25rem 0.75rem; font-size:0.75rem;">
                            ✓ تأیید دریافت وجه و شارژ آنی
                          </button>
                        </td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>
            </div>
          ` : ''}

          <div class="section-box club-section">
            <h2 class="club-section-title">بسته‌های شارژ</h2>
            <div class="club-form-row" style="grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));">
              ${packages.map((p) => `
                <div class="section-box wallet-pack-card" data-pack-id="${__westoViewContext.esc(p.id)}" style="margin:0; padding:0.85rem; border-top:3px solid ${p.popular ? '#10b981' : '#7357ce'};">
                  <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.4rem;">
                    <b>${__westoViewContext.esc(p.title)}</b>
                    ${p.popular ? '<span class="pill" style="background:#10b981; color:#fff;">محبوب</span>' : ''}
                  </div>
                  <div class="club-form-row" style="grid-template-columns:1fr 1fr;">
                    <div class="field"><label style="font-size:0.75rem;">مبلغ شارژ (ت)</label><input type="number" class="input ltr pack-amount" value="${p.amountToman || 0}" /></div>
                    <div class="field"><label style="font-size:0.75rem;">اعتبار هدیه (ت)</label><input type="number" class="input ltr pack-bonus" value="${p.bonusToman || 0}" /></div>
                  </div>
                  <div class="field" style="margin-top:0.35rem;"><label style="font-size:0.75rem;">برچسب</label><input type="text" class="input pack-badge" value="${__westoViewContext.esc(p.badge || '')}" /></div>
                </div>
              `).join('')}
            </div>
            <button class="btn btn-sm" id="save-packages-btn" style="margin-top:0.75rem;" type="button">ذخیره بسته‌ها</button>
          </div>

          <div class="grid-2-main">
            <div class="section-box club-section">
              <h2 class="club-section-title">شارژ / کسر دستی</h2>
              <div class="club-form-row">
                ${__westoViewContext.field('شماره موبایل', 'wal_phone', '', { ltr: true })}
                ${__westoViewContext.field('مبلغ (ت)', 'wal_delta', '100000', { ltr: true, type: 'number' })}
                ${__westoViewContext.field('توضیحات', 'wal_reason', 'شارژ دستی')}
              </div>
              <button class="btn btn-sm btn-accent" id="wal-adj-btn" style="margin-top:0.65rem;" type="button">ثبت سند</button>
            </div>

            <div class="section-box club-section">
              <h2 class="club-section-title">آخرین تراکنش‌ها</h2>
              <div style="overflow-x:auto;">
                <table class="tbl">
                  <thead><tr><th>زمان</th><th>مشتری</th><th>نوع</th><th>مبلغ</th><th>مانده</th></tr></thead>
                  <tbody>
                    ${(d.recentTransactions || []).slice(0, 10).map((t) => `
                      <tr>
                        <td>${__westoViewContext.fmtDateTime(t.at)}</td>
                        <td class="ltr">${__westoViewContext.esc(t.phone)}</td>
                        <td><span class="pill ${t.type === 'topup' ? 'is-paid' : t.type === 'cashback' ? 'is-prep' : ''}">${__westoViewContext.esc(t.type === 'topup' ? 'شارژ' : t.type === 'pay' ? 'خرید' : t.type === 'cashback' ? 'پاداش نقدی' : t.type)}</span></td>
                        <td style="color:${t.deltaToman > 0 ? '#10b981' : '#ef4444'}; font-weight:700;">${t.deltaToman > 0 ? '+' : ''}${__westoViewContext.fmtMoney(t.deltaToman)}</td>
                        <td>${__westoViewContext.fmtMoney(t.balanceAfterToman || 0)}</td>
                      </tr>
                    `).join('') || '<tr><td colspan="5">تراکنشی ثبت نشده.</td></tr>'}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        `;
        bindNav();

        __westoViewContext.main.querySelectorAll('.approve-topup-btn').forEach((btn) => {
          btn.addEventListener('click', async () => {
            btn.disabled = true;
            btn.textContent = 'در حال ثبت…';
            const requestId = btn.dataset.reqId;
            try {
              const res = await __westoViewContext.api('/api/wallet/topup/staff-approve', { method: 'POST', body: JSON.stringify({ requestId, paymentTender: 'POS', branchId: __westoViewContext.currentBranchId || 1 }) });
              if (res.ok) {
                __westoViewContext.showToast(`شارژ با موفقیت برای شماره ${res.phone} تأیید شد.`);
                __westoViewContext.tabs.club('wallet');
              } else {
                __westoViewContext.showToast(res.error || 'خطا در تأیید شارژ');
                btn.disabled = false;
              }
            } catch (error) {
              __westoViewContext.showToast(error.message || 'خطا در تأیید شارژ', 'error');
              btn.disabled = false;
            }
          });
        });

        __westoViewContext.main.querySelector('#save-packages-btn')?.addEventListener('click', async () => {
          const updatedPackages = Array.from(__westoViewContext.main.querySelectorAll('.wallet-pack-card')).map((card) => {
            const id = card.dataset.packId;
            const orig = packages.find((p) => p.id === id) || {};
            return {
              ...orig,
              id,
              amountToman: __westoViewContext.parseInputNumber(card.querySelector('.pack-amount').value) || 0,
              bonusToman: __westoViewContext.parseInputNumber(card.querySelector('.pack-bonus').value) || 0,
              badge: card.querySelector('.pack-badge').value.trim(),
            };
          });
          await __westoViewContext.api('/api/admin/wallet/packages', { method: 'PUT', body: JSON.stringify({ packages: updatedPackages }) });
          __westoViewContext.showToast('بسته‌های شارژ با موفقیت ذخیره شدند');
          __westoViewContext.tabs.club('wallet');
        });

        __westoViewContext.main.querySelector('#wal-adj-btn')?.addEventListener('click', async () => {
          const phone = document.getElementById('wal_phone').value.trim();
          const deltaToman = __westoViewContext.parseInputNumber(document.getElementById('wal_delta').value) || 0;
          const reason = document.getElementById('wal_reason').value.trim();
          if (!phone || !deltaToman) return __westoViewContext.showToast('شماره و مبلغ الزامی است');
          const idempotencyKey = window.crypto?.randomUUID?.() || `wallet-adjust-${Date.now()}-${Math.random().toString(16).slice(2)}`;
          try {
            const res = await __westoViewContext.api('/api/admin/wallet/adjust', {
              method: 'POST',
              headers: { 'Idempotency-Key': idempotencyKey },
              body: JSON.stringify({ phone, deltaToman, reason, branchId: __westoViewContext.currentBranchId || 1 }),
            });
            __westoViewContext.showToast(`سند با موفقیت ثبت شد (مانده جدید: ${__westoViewContext.fmtMoney(res.newBalanceToman || 0)})`);
            __westoViewContext.tabs.club('wallet');
          } catch (error) {
            __westoViewContext.showToast(error.message || 'ثبت تعدیل کیف پول ناموفق بود', 'error');
          }
        });
        return;
      }

      if (activeSubTab === 'campaigns') {
        const d = await __westoViewContext.api('/api/admin/campaigns/summary');
        const camp = d.campaigns || {};
        const stats = d.stats || {};
        __westoViewContext.main.innerHTML = `
          ${renderNav('campaigns')}

          <div class="grid-2-main">
            <div class="section-box club-section">
              <h2 class="club-section-title">هدیه تولد</h2>
              <div class="club-form-row">
                <div class="field"><label class="chk"><input type="checkbox" id="cmp_bday_en" ${camp.birthday?.enabled ? 'checked' : ''} /> فعال</label></div>
                ${__westoViewContext.field('هدیه کیف پول (ت)', 'cmp_bday_wallet', String(camp.birthday?.rewardWalletToman ?? 100000), { ltr: true, type: 'number' })}
                ${__westoViewContext.field('امتیاز هدیه', 'cmp_bday_points', String(camp.birthday?.rewardPoints ?? 200), { ltr: true, type: 'number' })}
                ${__westoViewContext.field('مهلت (روز)', 'cmp_bday_days', String(camp.birthday?.validDaysAfter ?? 7), { ltr: true, type: 'number' })}
              </div>
              <button class="btn btn-sm btn-accent" id="save-bday-btn" style="margin-top:0.65rem;" type="button">ذخیره</button>
            </div>

            <div class="section-box club-section">
              <h2 class="club-section-title">معرفی دوستان</h2>
              <div class="club-form-row">
                <div class="field"><label class="chk"><input type="checkbox" id="cmp_ref_en" ${camp.referral?.enabled ? 'checked' : ''} /> فعال</label></div>
                ${__westoViewContext.field('پاداش معرف (ت)', 'cmp_ref_wallet', String(camp.referral?.referrerRewardWalletToman ?? 50000), { ltr: true, type: 'number' })}
                ${__westoViewContext.field('پاداش دوست (ت)', 'cmp_ref_referee_wallet', String(camp.referral?.refereeRewardWalletToman ?? 30000), { ltr: true, type: 'number' })}
                ${__westoViewContext.field('حداقل سفارش (ت)', 'cmp_ref_min_order', String(camp.referral?.minFirstOrderToman ?? 200000), { ltr: true, type: 'number' })}
              </div>
              <button class="btn btn-sm btn-accent" id="save-ref-btn" style="margin-top:0.65rem;" type="button">ذخیره</button>
            </div>
          </div>

          <div class="section-box club-section">
            <h2 class="club-section-title">ساعت شاد ${stats.isHappyHourActive ? '<span class="pill is-paid" style="font-size:0.72rem; margin-right:0.4rem;">فعال</span>' : ''}</h2>
            <div class="club-form-row">
              <div class="field"><label class="chk"><input type="checkbox" id="cmp_hh_en" ${camp.happyHour?.enabled ? 'checked' : ''} /> فعال</label></div>
              ${__westoViewContext.field('تخفیف (٪)', 'cmp_hh_disc', String(camp.happyHour?.discountPct ?? 15), { ltr: true, type: 'number' })}
              ${__westoViewContext.field('شروع', 'cmp_hh_start', String(camp.happyHour?.startHour ?? '14:00'), { ltr: true })}
              ${__westoViewContext.field('پایان', 'cmp_hh_end', String(camp.happyHour?.endHour ?? '18:00'), { ltr: true })}
            </div>
            <button class="btn btn-sm btn-accent" id="save-hh-btn" style="margin-top:0.65rem;" type="button">ذخیره</button>
          </div>
        `;
        bindNav();

        __westoViewContext.main.querySelector('#save-bday-btn')?.addEventListener('click', async () => {
          await __westoViewContext.api('/api/admin/campaigns/settings', {
            method: 'PUT',
            body: JSON.stringify({
              birthday: {
                enabled: document.getElementById('cmp_bday_en').checked,
                rewardWalletToman: Number(document.getElementById('cmp_bday_wallet').value) || 0,
                rewardPoints: Number(document.getElementById('cmp_bday_points').value) || 0,
                validDaysAfter: Number(document.getElementById('cmp_bday_days').value) || 7,
              },
            }),
          });
          __westoViewContext.showToast('تنظیمات کمپین تولد ذخیره شد');
        });

        __westoViewContext.main.querySelector('#save-ref-btn')?.addEventListener('click', async () => {
          await __westoViewContext.api('/api/admin/campaigns/settings', {
            method: 'PUT',
            body: JSON.stringify({
              referral: {
                enabled: document.getElementById('cmp_ref_en').checked,
                referrerRewardWalletToman: Number(document.getElementById('cmp_ref_wallet').value) || 0,
                refereeRewardWalletToman: Number(document.getElementById('cmp_ref_referee_wallet').value) || 0,
                minFirstOrderToman: Number(document.getElementById('cmp_ref_min_order').value) || 0,
              },
            }),
          });
          __westoViewContext.showToast('تنظیمات سیستم معرفی ذخیره شد');
        });

        __westoViewContext.main.querySelector('#save-hh-btn')?.addEventListener('click', async () => {
          await __westoViewContext.api('/api/admin/campaigns/settings', {
            method: 'PUT',
            body: JSON.stringify({
              happyHour: {
                enabled: document.getElementById('cmp_hh_en').checked,
                discountPct: Number(document.getElementById('cmp_hh_disc').value) || 0,
                startHour: document.getElementById('cmp_hh_start').value.trim(),
                endHour: document.getElementById('cmp_hh_end').value.trim(),
              },
            }),
          });
          __westoViewContext.showToast('تنظیمات ساعت شاد ذخیره شد');
        });
        return;
      }

      if (activeSubTab === 'sms') {
        const stats = await __westoViewContext.api('/api/admin/sms/stats');
        const rfm = await __westoViewContext.api('/api/admin/sms/rfm');
        const sets = stats.settings || {};

        __westoViewContext.main.innerHTML = `
          ${renderNav('sms')}

          <div class="section-box club-section">
            <h2 class="club-section-title">بازگرداندن مشتریان</h2>
            <div style="overflow-x:auto;">
              <table class="tbl" style="font-size:0.82rem;">
                <thead><tr><th>گروه</th><th>تعداد</th><th>وضعیت</th></tr></thead>
                <tbody>
                  <tr><td>قهرمانان</td><td><b>${__westoViewContext.fmtNum(rfm.championsCount || 0)}</b></td><td><span class="pill is-paid">عالی</span></td></tr>
                  <tr><td>فعال</td><td><b>${__westoViewContext.fmtNum(rfm.activeCount || 0)}</b></td><td><span class="pill is-paid">پایدار</span></td></tr>
                  <tr><td>در خطر ریزش</td><td><b>${__westoViewContext.fmtNum(rfm.atRiskCount || 0)}</b></td><td><span class="pill" style="background:#f59e0b;color:#fff;">توجه</span></td></tr>
                  <tr><td>خواب‌رفته</td><td><b>${__westoViewContext.fmtNum(rfm.dormantCount || 0)}</b></td><td><span class="pill" style="background:#ef4444;color:#fff;">ریزش</span></td></tr>
                </tbody>
              </table>
            </div>
            <div class="club-form-row" style="margin-top:0.75rem; grid-template-columns: auto 140px auto;">
              <select id="winback_segment" class="input" style="font-size:0.82rem;">
                <option value="at_risk">در خطر (${__westoViewContext.fmtNum(rfm.atRiskCount || 0)})</option>
                <option value="dormant">خواب‌رفته (${__westoViewContext.fmtNum(rfm.dormantCount || 0)})</option>
              </select>
              <input id="winback_reward" class="input ltr" placeholder="هدیه (ت)" value="50000" style="font-size:0.82rem;" />
              <button class="btn btn-sm btn-accent" id="run-winback-btn" type="button">اجرای بازگشت</button>
            </div>
          </div>

          <details class="club-collapsible" open>
            <summary>تنظیمات درگاه پیامک</summary>
            <div class="club-collapse-body">
              <div class="club-form-row">
                <div class="field"><label class="chk"><input type="checkbox" id="sms_en" ${sets.enabled ? 'checked' : ''} /> فعال</label></div>
                <div class="field">
                  <label>ارائه‌دهنده</label>
                  <select id="sms_prov" class="input">
                    <option value="simulator" ${sets.provider === 'simulator' ? 'selected' : ''}>شبیه‌ساز</option>
                    <option value="kavenegar" ${sets.provider === 'kavenegar' ? 'selected' : ''}>کاوه‌نگار</option>
                    <option value="farazsms" ${sets.provider === 'farazsms' ? 'selected' : ''}>فراز اس‌ام‌اس</option>
                    <option value="ghasedak" ${sets.provider === 'ghasedak' ? 'selected' : ''}>قاصدک</option>
                    <option value="melipayamak" ${sets.provider === 'melipayamak' ? 'selected' : ''}>ملی‌پیامک</option>
                  </select>
                </div>
                ${__westoViewContext.field('کلید API', 'sms_key', sets.apiKey || '', { ltr: true })}
                ${__westoViewContext.field('سرشماره', 'sms_sender', sets.senderLine || '', { ltr: true })}
              </div>
              <button class="btn btn-sm btn-accent" id="save-sms-settings-btn" style="margin-top:0.65rem;" type="button">ذخیره</button>
            </div>
          </details>

          <details class="club-collapsible">
            <summary>ارسال پیامک تستی</summary>
            <div class="club-collapse-body">
              <div class="club-form-row">
                ${__westoViewContext.field('شماره گیرنده', 'sms_test_phone', '', { ltr: true })}
                <div class="field">
                  <label>الگو</label>
                  <select id="sms_test_tpl" class="input">
                    <option value="birthday">تبریک تولد</option>
                    <option value="points_earned">دریافت امتیاز</option>
                    <option value="wallet_topup">شارژ کیف پول</option>
                    <option value="winback">بازگشت مشتری</option>
                  </select>
                </div>
              </div>
              <div class="field" style="margin-top:0.4rem;">
                <label>متن دلخواه</label>
                <textarea id="sms_test_msg" class="input" rows="2" placeholder="اختیاری…"></textarea>
              </div>
              <button class="btn btn-sm" id="send-sms-test-btn" style="margin-top:0.5rem;" type="button">ارسال تست</button>
            </div>
          </details>
        `;
        bindNav();

        __westoViewContext.main.querySelector('#save-sms-settings-btn')?.addEventListener('click', async () => {
          try {
            await __westoViewContext.api('/api/admin/sms/settings', {
              method: 'PUT',
              body: JSON.stringify({
                enabled: document.getElementById('sms_en')?.checked,
                provider: document.getElementById('sms_prov')?.value,
                apiKey: document.getElementById('sms_key')?.value.trim(),
                senderLine: normalizeDigits(document.getElementById('sms_sender')?.value || '').trim(),
              }),
            });
            __westoViewContext.showToast('تنظیمات سامانه پیامک ذخیره شد');
          } catch (e) {
            __westoViewContext.showToast(e.message || 'خطا در ذخیره تنظیمات سامانه پیامک', 'error');
          }
        });

        __westoViewContext.main.querySelector('#send-sms-test-btn')?.addEventListener('click', async () => {
          const phone = normalizeDigits(document.getElementById('sms_test_phone')?.value || '').trim();
          const templateKey = document.getElementById('sms_test_tpl')?.value;
          const text = document.getElementById('sms_test_msg')?.value.trim();
          if (!phone) return __westoViewContext.showToast('شماره موبایل الزامی است');
          try {
            const res = await __westoViewContext.api('/api/admin/sms/send-test', { method: 'POST', body: JSON.stringify({ phone, templateKey, text }) });
            __westoViewContext.showToast(res.ok ? 'پیامک تستی ارسال شد' : (res.error || 'خطا در ارسال'));
          } catch (e) {
            __westoViewContext.showToast(e.message || 'خطا در ارسال پیامک تستی', 'error');
          }
        });

        __westoViewContext.main.querySelector('#run-winback-btn')?.addEventListener('click', async () => {
          const segment = document.getElementById('winback_segment')?.value;
          const rewardWalletToman = __westoViewContext.parseInputNumber(document.getElementById('winback_reward')?.value) ?? 50000;
          try {
            const res = await __westoViewContext.api('/api/admin/sms/run-winback', { method: 'POST', body: JSON.stringify({ segment, rewardWalletToman, branchId: __westoViewContext.currentBranchId || 1 }) });
            __westoViewContext.showToast(`کمپین بازگشت اجرا شد (${res.sentCount} پیامک با مجموع هدیه ${__westoViewContext.fmtMoney(res.rewardDisbursedTotalToman || 0)})`);
            __westoViewContext.tabs.club('sms');
          } catch (error) {
            __westoViewContext.showToast(error.message || 'کمپین بازگشت اجرا نشد', 'error');
          }
        });
        return;
      }

      if (activeSubTab === 'loyalty') {
        const d = await __westoViewContext.api('/api/admin/loyalty');
        const L = d.loyalty || {};
        const tiers = Array.isArray(L.tiers) && L.tiers.length ? L.tiers : [];
        const achievements = Array.isArray(d.achievements) ? d.achievements : (Array.isArray(L.achievements) ? L.achievements : []);
        const achievementCategories = Array.isArray(d.menuCategories) ? d.menuCategories : [];
        const achievementMetrics = {
          coffee_units: 'واحدهای قهوه',
          early_orders: 'سفارش پیش از ساعت ۱۰',
          completed_orders: 'سفارش تکمیل‌شده',
          distinct_desserts: 'دسر متفاوت',
          consecutive_months: 'ماه متوالی فعال',
        };
        let tierDraft = tiers.map((tier) => ({ ...tier, perks: Array.isArray(tier.perks) ? [...tier.perks] : [] }));
        const tierColorFallback = (color) => /^#[0-9a-f]{6}$/i.test(String(color || '')) ? color : '#a855f7';
        const renderTierCards = () => {
          const list = __westoViewContext.main.querySelector('#loyalty-tier-list');
          if (!list) return;
          list.innerHTML = tierDraft.map((tier, index) => `
            <article class="tier-config-card" data-tier-id="${__westoViewContext.esc(tier.id)}" style="--tier-color:${tierColorFallback(tier.color)}">
              <header class="tier-config-card__head">
                <span class="tier-config-card__badge" aria-hidden="true">${__westoViewContext.esc(tier.badgeIcon || '🥉')}</span>
                <div><h3>${__westoViewContext.esc(tier.name || `سطح ${index + 1}`)}</h3><small>${index === 0 ? 'سطح پایه' : `سطح ${index + 1} از ${tierDraft.length}`}</small></div>
              </header>
              <div class="tier-config-fields">
                <label class="field"><span>نام سطح</span><input class="input tier-name" type="text" maxlength="40" required value="${__westoViewContext.esc(tier.name || '')}" placeholder="مثلاً نقره‌ای" /></label>
                <label class="field"><span>نشان / ایموجی</span><input class="input tier-icon" type="text" maxlength="12" required value="${__westoViewContext.esc(tier.badgeIcon || '🥉')}" aria-label="نشان سطح ${__westoViewContext.esc(tier.name || '')}" /></label>
                <label class="field"><span>رنگ سطح</span><span class="tier-color-control"><input class="tier-color" type="color" value="${tierColorFallback(tier.color)}" /><input class="input ltr tier-color-hex" type="text" maxlength="7" required pattern="#[0-9a-fA-F]{6}" value="${tierColorFallback(tier.color)}" aria-label="کد رنگ سطح ${__westoViewContext.esc(tier.name || '')}" /></span></label>
                <label class="field"><span>حداقل امتیاز</span><input class="input ltr tier-min-pts" type="number" min="0" max="1000000000" step="1" required value="${__westoViewContext.esc(String(tier.minPoints ?? 0))}" ${index === 0 ? 'disabled title="سطح پایه همیشه از صفر شروع می‌شود"' : ''} /></label>
                <label class="field"><span>حداقل خرید (تومان)</span><input class="input ltr tier-min-spend" type="number" min="0" max="1000000000000" step="1" required value="${__westoViewContext.esc(String(tier.minSpendToman ?? 0))}" ${index === 0 ? 'disabled title="سطح پایه همیشه از صفر شروع می‌شود"' : ''} /></label>
                <label class="field"><span>ضریب امتیاز</span><input class="input ltr tier-mult" type="number" min="1" max="10" step="any" required value="${__westoViewContext.esc(String(tier.multiplier ?? 1))}" /></label>
                <label class="field"><span>تخفیف (%)</span><input class="input ltr tier-disc" type="number" min="0" max="50" step="any" required value="${__westoViewContext.esc(String(tier.discountPct ?? 0))}" /></label>
              </div>
              <label class="field tier-perks-field"><span>مزایای این سطح <small>هر مزیت را در یک خط بنویسید</small></span><textarea class="input tier-perks" rows="3" maxlength="800" placeholder="مثلاً ارسال رایگان در روز تولد">${__westoViewContext.esc((tier.perks || []).join('\n'))}</textarea></label>
            </article>
          `).join('');
        };
        const categoryChoices = (achievement, kind, selected) => `
          <fieldset class="achievement-config-categories"><legend>${kind === 'coffeeCategoryIds' ? 'دسته‌های قهوه' : 'دسته‌های دسر'}</legend>
            ${achievementCategories.map((category) => `
              <label class="achievement-category-choice"><input type="checkbox" data-ach-category="${kind}" value="${__westoViewContext.esc(String(category.id))}" ${selected.includes(Number(category.id)) ? 'checked' : ''} /> <span>${__westoViewContext.esc(category.title)}</span></label>
            `).join('') || '<span class="hint">دسته‌ای در منو تعریف نشده است.</span>'}
          </fieldset>`;
        const relevantCategoryChoices = (achievement) => {
          if (achievement.metric === 'coffee_units') return categoryChoices(achievement, 'coffeeCategoryIds', achievement.coffeeCategoryIds || []);
          if (achievement.metric === 'distinct_desserts') return categoryChoices(achievement, 'dessertCategoryIds', achievement.dessertCategoryIds || []);
          return '<p class="hint">این معیار به دستهٔ محصول نیاز ندارد.</p>';
        };
        const renderAchievementCards = () => {
          const list = __westoViewContext.main.querySelector('#loyalty-achievement-list');
          if (!list) return;
          list.innerHTML = achievements.map((achievement, index) => `
            <article class="achievement-config-card" data-achievement-id="${__westoViewContext.esc(achievement.id)}">
              <header class="achievement-config-card__head"><span class="achievement-config-icon">${__westoViewContext.esc(achievement.icon || '⭐')}</span><div><h3>${__westoViewContext.esc(achievement.name)}</h3><small>هدف رفتاری ${index + 1}</small></div><label class="chk"><input class="achievement-enabled" type="checkbox" ${achievement.enabled !== false ? 'checked' : ''} /> فعال</label></header>
              <div class="achievement-config-fields">
                <label class="field"><span>نام هدف</span><input class="input achievement-name" maxlength="48" required value="${__westoViewContext.esc(achievement.name)}" /></label>
                <label class="field"><span>نشان</span><input class="input achievement-icon" maxlength="12" required value="${__westoViewContext.esc(achievement.icon || '⭐')}" /></label>
                <label class="field"><span>معیار پیشرفت</span><select class="input achievement-metric">${Object.entries(achievementMetrics).map(([value, label]) => `<option value="${value}" ${achievement.metric === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
                <label class="field"><span>مقدار هدف</span><input class="input ltr achievement-target" type="number" min="1" max="1000000" step="1" required value="${__westoViewContext.esc(String(achievement.target))}" /></label>
                <label class="field"><span>جایزهٔ یک‌باره (امتیاز)</span><input class="input ltr achievement-reward" type="number" min="0" max="1000000" step="1" required value="${__westoViewContext.esc(String(achievement.rewardPoints || 0))}" /></label>
              </div>
              <label class="field"><span>توضیح هدف</span><textarea class="input achievement-description" rows="2" maxlength="240" required>${__westoViewContext.esc(achievement.description || '')}</textarea></label>
              <div class="achievement-category-groups">${relevantCategoryChoices(achievement)}</div>
              <p class="hint">${achievement.rewardStartsAt ? `صدور پاداش از ${new Date(achievement.rewardStartsAt).toLocaleDateString('fa-IR')} فعال شده؛ تکمیل‌های قدیمی پاداش نمی‌گیرند.` : 'با تعیین امتیاز مثبت و ذخیره، مبنای پاداش از همین زمان شروع می‌شود.'}</p>
            </article>`).join('');
        };
        const diagnostics = d.diagnostics || {};
        const unlinkedSamples = Array.isArray(diagnostics.unlinkedOrdersSample) ? diagnostics.unlinkedOrdersSample : [];
        const pointsSamples = Array.isArray(diagnostics.membersWithoutOrdersSample) ? diagnostics.membersWithoutOrdersSample : [];
        __westoViewContext.main.innerHTML = `
          ${renderNav('loyalty')}

          <div class="section-box club-section">
            <h2 class="club-section-title">قوانین امتیاز ${L.enabled ? '<span class="pill is-paid" style="font-size:0.72rem; margin-right:0.4rem;">فعال</span>' : '<span class="pill" style="font-size:0.72rem; margin-right:0.4rem;">خاموش</span>'}</h2>
            <div class="club-form-row">
              <div class="field"><label class="chk"><input type="checkbox" id="ly_en" ${L.enabled ? 'checked' : ''} /> فعال</label></div>
              ${__westoViewContext.field('امتیاز هر تومان', 'ly_rate', String(L.pointsPerToman ?? 0.01), { ltr: true, type: 'number' })}
              ${__westoViewContext.field('ارزش هر امتیاز (ت)', 'ly_val', String(L.redeemValue ?? 1000), { ltr: true, type: 'number' })}
              ${__westoViewContext.field('خوش‌آمدگویی', 'ly_welcome', String(L.welcomePoints ?? 50), { ltr: true, type: 'number' })}
            </div>
            <button class="btn btn-sm btn-accent" id="save-loyalty-rules-btn" style="margin-top:0.65rem;" type="button">ذخیره</button>
          </div>

          <div class="section-box club-section">
            <div class="tier-config-toolbar">
              <div><h2 class="club-section-title">سطوح وفاداری</h2><p class="tier-config-hint">نام، نشان، رنگ، شرط ورود، ضریب امتیاز، تخفیف و مزایا را تنظیم کنید. ترتیب از پایه به بالاتر است؛ شرط سطح پایه همیشه صفر می‌ماند.</p></div>
              <button class="btn btn-sm" id="add-loyalty-tier-btn" type="button" ${tiers.length >= 20 ? 'disabled' : ''}>＋ افزودن سطح</button>
            </div>
            <div class="tier-config-list" id="loyalty-tier-list"></div>
            <div class="tier-config-footer"><span class="hint">تغییرات در سیستم وفاداری و محاسبهٔ سطح اعضا اعمال می‌شود.</span><button class="btn btn-sm btn-accent" id="save-tiers-btn" type="button">ذخیره همهٔ سطوح</button></div>
          </div>

          <div class="section-box club-section">
            <div class="tier-config-toolbar"><div><h2 class="club-section-title">مسیر وفاداری و هدف‌های رفتاری</h2><p class="tier-config-hint">پیشرفت از سفارش‌های تکمیل‌شده و محصولات منو محاسبه می‌شود؛ ساعت شعبه استفاده می‌شود و در نبود آن تهران. امتیاز هدف‌ها یک‌بار به دفتر امتیاز افزوده می‌شود و در آستانهٔ سطح‌ها حساب می‌شود، اما تخفیف هر سطح فقط از همان قواعد فعلی می‌آید.</p></div></div>
            <div class="achievement-config-notice">جایزهٔ امتیازی تا وقتی مقدار مثبتی تعیین و ذخیره نشده صادر نمی‌شود. سابقهٔ پیش از فعال‌سازی فقط برای نمایش پیشرفت است و پاداش گذشته نمی‌گیرد.</div>
            <div class="achievement-config-list" id="loyalty-achievement-list"></div>
            <div class="tier-config-footer"><span class="hint">ذخیرهٔ پایدار الزامی است؛ در صورت در دسترس نبودن فضای ذخیره‌سازی، تغییرات اعمال نمی‌شوند.</span><button class="btn btn-sm btn-accent" id="save-achievements-btn" type="button">ذخیرهٔ هدف‌ها</button></div>
          </div>

          <section class="section-box club-section loyalty-reconciliation" aria-label="گزارش پیوند سفارش‌ها">
            <h2 class="club-section-title">بررسی پیوند سفارش‌ها به حساب‌ها</h2>
            <p class="tier-config-hint">این گزارش مغایرت‌ها را فقط نشان می‌دهد؛ هیچ سفارش یا حسابی خودکار به هم متصل نمی‌شود.</p>
            <div class="loyalty-reconciliation__counts"><div><b>${Number(diagnostics.completedOrders || 0).toLocaleString('fa-IR')}</b><span>سفارش تکمیل‌شده</span></div><div><b>${Number(diagnostics.unlinkedCompletedOrders || 0).toLocaleString('fa-IR')}</b><span>سفارش بدون حساب منطبق</span></div><div><b>${Number(diagnostics.membersWithPointsWithoutLinkedCompletedOrders || 0).toLocaleString('fa-IR')}</b><span>عضو امتیازدار بدون سفارش پیوندخورده</span></div></div>
            ${unlinkedSamples.length ? `<h3>نمونهٔ سفارش‌های بدون حساب (۴ رقم پایانی)</h3><ul>${unlinkedSamples.map((row) => `<li>${__westoViewContext.esc(row.orderNo)} · ${__westoViewContext.esc(row.status || '—')} · •••• ${__westoViewContext.esc(row.phoneLast4 || 'نامشخص')}</li>`).join('')}</ul>` : '<p class="hint">سفارش تکمیل‌شدهٔ بدون حساب در این بررسی پیدا نشد.</p>'}
            ${pointsSamples.length ? `<h3>نمونهٔ اعضای امتیازدار بدون سابقهٔ پیوندخورده</h3><ul>${pointsSamples.map((row) => `<li>${__westoViewContext.esc(row.name)} · •••• ${__westoViewContext.esc(row.phoneLast4 || 'نامشخص')} · ${Number(row.points || 0).toLocaleString('fa-IR')} امتیاز</li>`).join('')}</ul>` : ''}
          </section>
        `;
        bindNav();
        renderTierCards();
        renderAchievementCards();
        __westoViewContext.main.querySelector('#loyalty-achievement-list')?.addEventListener('change', (event) => {
          const card = event.target.closest('.achievement-config-card');
          if (!card) return;
          const achievement = achievements.find((item) => item.id === card.dataset.achievementId);
          if (!achievement) return;
          const selectedKind = card.querySelector('[data-ach-category]')?.dataset.achCategory;
          if (selectedKind) {
            achievement[selectedKind] = Array.from(card.querySelectorAll(`[data-ach-category="${selectedKind}"]:checked`)).map((input) => Number(input.value));
          }
          if (event.target.matches('.achievement-metric')) {
            card.querySelector('.achievement-category-groups').innerHTML = relevantCategoryChoices(achievement);
          } else if (event.target.matches('[data-ach-category]')) {
            const kind = event.target.dataset.achCategory;
            achievement[kind] = Array.from(card.querySelectorAll(`[data-ach-category="${kind}"]:checked`)).map((input) => Number(input.value));
          }
        });

        __westoViewContext.main.querySelector('#add-loyalty-tier-btn')?.addEventListener('click', () => {
          const invalidInput = Array.from(__westoViewContext.main.querySelectorAll('.tier-config-card input')).find((input) => !input.checkValidity());
          if (invalidInput) {
            invalidInput.focus();
            return __westoViewContext.showToast('ابتدا مقدارهای نامعتبر را اصلاح کنید، سپس سطح جدید بسازید.', 'warn');
          }
          tierDraft = Array.from(__westoViewContext.main.querySelectorAll('.tier-config-card')).map((card) => {
            const existing = tierDraft.find((item) => item.id === card.dataset.tierId) || {};
            return {
              ...existing,
              name: card.querySelector('.tier-name').value.trim(),
              badgeIcon: card.querySelector('.tier-icon').value.trim(),
              color: card.querySelector('.tier-color-hex').value.trim(),
              minPoints: __westoViewContext.parseInputNumber(card.querySelector('.tier-min-pts').value) ?? 0,
              minSpendToman: __westoViewContext.parseInputNumber(card.querySelector('.tier-min-spend').value) ?? 0,
              multiplier: __westoViewContext.parseInputNumber(card.querySelector('.tier-mult').value) ?? 1,
              discountPct: __westoViewContext.parseInputNumber(card.querySelector('.tier-disc').value) ?? 0,
              perks: card.querySelector('.tier-perks').value.split('\n').map((perk) => perk.trim()).filter(Boolean),
            };
          });
          if (tierDraft.length >= 20) return __westoViewContext.showToast('حداکثر ۲۰ سطح قابل تعریف است.', 'warn');
          const last = tierDraft[tierDraft.length - 1] || {};
          if (Number(last.minPoints || 0) > 1_000_000_000 - 500 || Number(last.minSpendToman || 0) > 1_000_000_000_000 - 2_000_000) {
            return __westoViewContext.showToast('برای افزودن سطح جدید، آستانهٔ سطح آخر به بیشینه رسیده است.', 'warn');
          }
          const names = new Set(tierDraft.map((tier) => String(tier.name || '').trim().toLowerCase()));
          let nameIndex = tierDraft.length + 1;
          while (names.has(`سطح ${nameIndex}`)) nameIndex += 1;
          let id = `custom-${Date.now().toString(36)}`;
          while (tierDraft.some((tier) => tier.id === id)) id = `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
          tierDraft.push({
            id,
            name: `سطح ${nameIndex}`,
            minPoints: (__westoViewContext.parseInputNumber(last.minPoints) ?? 0) + 500,
            minSpendToman: (__westoViewContext.parseInputNumber(last.minSpendToman) ?? 0) + 2_000_000,
            multiplier: Math.min(10, Math.round(((__westoViewContext.parseInputNumber(last.multiplier) ?? 1) + 0.25) * 100) / 100),
            discountPct: Math.min(50, (__westoViewContext.parseInputNumber(last.discountPct) ?? 0) + 1),
            color: '#38bdf8',
            badgeIcon: '🌟',
            perks: [],
          });
          renderTierCards();
          __westoViewContext.main.querySelector(`.tier-config-card[data-tier-id="${id}"] .tier-name`)?.focus();
        });

        __westoViewContext.main.querySelector('#loyalty-tier-list')?.addEventListener('input', (event) => {
          const card = event.target.closest('.tier-config-card');
          if (!card) return;
          const heading = card.querySelector('.tier-config-card__head h3');
          if (event.target.matches('.tier-name') && heading) heading.textContent = event.target.value.trim() || 'سطح بدون نام';
          if (event.target.matches('.tier-icon')) card.querySelector('.tier-config-card__badge').textContent = event.target.value || '🥉';
          if (event.target.matches('.tier-color')) {
            card.querySelector('.tier-color-hex').value = event.target.value;
            card.style.setProperty('--tier-color', event.target.value);
          }
          if (event.target.matches('.tier-color-hex') && /^#[0-9a-f]{6}$/i.test(event.target.value)) {
            card.querySelector('.tier-color').value = event.target.value;
            card.style.setProperty('--tier-color', event.target.value);
          }
        });

        __westoViewContext.main.querySelector('#save-loyalty-rules-btn')?.addEventListener('click', async () => {
          try {
            await __westoViewContext.api('/api/admin/settings', {
              method: 'PUT',
              body: JSON.stringify({
                loyalty: {
                  enabled: document.getElementById('ly_en').checked,
                  pointsPerToman: Number(document.getElementById('ly_rate').value) || 0,
                  redeemValue: Number(document.getElementById('ly_val').value) || 0,
                  welcomePoints: Number(document.getElementById('ly_welcome').value) || 0,
                },
              }),
            });
            __westoViewContext.showToast('قوانین امتیاز ذخیره شد');
          } catch (error) {
            __westoViewContext.showToast(error.message || 'قوانین امتیاز ذخیره نشد', 'error');
          }
        });

        __westoViewContext.main.querySelector('#save-tiers-btn')?.addEventListener('click', async () => {
          const invalidInput = Array.from(__westoViewContext.main.querySelectorAll('.tier-config-card input')).find((input) => !input.checkValidity());
          if (invalidInput) {
            invalidInput.focus();
            return __westoViewContext.showToast('مقادیر مشخص‌شده را بررسی کنید؛ خانه‌های ضروری و بازهٔ مجاز نباید خالی باشند.', 'warn');
          }
          const updatedTiers = Array.from(__westoViewContext.main.querySelectorAll('.tier-config-card')).map((card) => ({
            id: card.dataset.tierId,
            name: card.querySelector('.tier-name').value.trim(),
            badgeIcon: card.querySelector('.tier-icon').value.trim(),
            color: card.querySelector('.tier-color-hex').value.trim(),
            minPoints: __westoViewContext.parseInputNumber(card.querySelector('.tier-min-pts').value) ?? 0,
            minSpendToman: __westoViewContext.parseInputNumber(card.querySelector('.tier-min-spend').value) ?? 0,
            multiplier: __westoViewContext.parseInputNumber(card.querySelector('.tier-mult').value) ?? 1,
            discountPct: __westoViewContext.parseInputNumber(card.querySelector('.tier-disc').value) ?? 0,
            perks: card.querySelector('.tier-perks').value.split('\n').map((perk) => perk.trim()).filter(Boolean),
          }));
          if (updatedTiers[0]?.minPoints !== 0 || updatedTiers[0]?.minSpendToman !== 0) {
            return __westoViewContext.showToast('سطح پایه باید شرط صفر امتیاز و صفر تومان داشته باشد.', 'warn');
          }
          const names = updatedTiers.map((tier) => tier.name.normalize('NFKC').toLowerCase());
          if (updatedTiers.some((tier) => !tier.name || Array.from(tier.name).length > 40)) {
            __westoViewContext.main.querySelector('.tier-name')?.focus();
            return __westoViewContext.showToast('برای هر سطح، نامی بین ۱ تا ۴۰ نویسه وارد کنید.', 'warn');
          }
          if (new Set(names).size !== names.length) return __westoViewContext.showToast('نام سطح‌ها نباید تکراری باشد.', 'warn');
          for (let index = 1; index < updatedTiers.length; index += 1) {
            const previous = updatedTiers[index - 1];
            const current = updatedTiers[index];
            if (current.minPoints < previous.minPoints || current.minSpendToman < previous.minSpendToman
              || (current.minPoints === previous.minPoints && current.minSpendToman === previous.minSpendToman)) {
              __westoViewContext.main.querySelectorAll('.tier-min-pts')[index]?.focus();
              return __westoViewContext.showToast('شرط ورود سطح‌ها باید از پایه به بالاتر، بدون کاهش و تکرار مرتب باشد.', 'warn');
            }
          }
          try {
            const result = await __westoViewContext.api('/api/admin/loyalty/tiers', { method: 'PUT', body: JSON.stringify({ tiers: updatedTiers }) });
            tierDraft = Array.isArray(result.tiers) ? result.tiers : updatedTiers;
            __westoViewContext.showToast('سطوح وفاداری با موفقیت ذخیره شد');
            await __westoViewContext.tabs.club('loyalty');
          } catch (error) {
            __westoViewContext.showToast(error.message || 'سطوح وفاداری ذخیره نشد', 'error');
          }
        });

        __westoViewContext.main.querySelector('#save-achievements-btn')?.addEventListener('click', async () => {
          const cards = Array.from(__westoViewContext.main.querySelectorAll('.achievement-config-card'));
          const invalidInput = cards.flatMap((card) => Array.from(card.querySelectorAll('input:not([type="checkbox"]), select, textarea')))
            .find((input) => !input.checkValidity());
          if (invalidInput) {
            invalidInput.focus();
            return __westoViewContext.showToast('نام، توضیح، معیار و مقدار هدف‌ها را بررسی کنید.', 'warn');
          }
          const updated = cards.map((card) => ({
            id: card.dataset.achievementId,
            name: card.querySelector('.achievement-name').value.trim(),
            description: card.querySelector('.achievement-description').value.trim(),
            icon: card.querySelector('.achievement-icon').value.trim(),
            metric: card.querySelector('.achievement-metric').value,
            target: Number(card.querySelector('.achievement-target').value),
            rewardPoints: Number(card.querySelector('.achievement-reward').value),
            enabled: card.querySelector('.achievement-enabled').checked,
            coffeeCategoryIds: Array.from(card.querySelectorAll('[data-ach-category="coffeeCategoryIds"]:checked')).map((input) => Number(input.value)),
            dessertCategoryIds: Array.from(card.querySelectorAll('[data-ach-category="dessertCategoryIds"]:checked')).map((input) => Number(input.value)),
          }));
          if (updated.some((item) => item.metric === 'coffee_units' && !item.coffeeCategoryIds.length)) return __westoViewContext.showToast('برای معیار قهوه، دست‌کم یک دستهٔ منو انتخاب کنید.', 'warn');
          if (updated.some((item) => item.metric === 'distinct_desserts' && !item.dessertCategoryIds.length)) return __westoViewContext.showToast('برای معیار دسر، دست‌کم یک دستهٔ منو انتخاب کنید.', 'warn');
          try {
            await __westoViewContext.api('/api/admin/loyalty/achievements', { method: 'PUT', body: JSON.stringify({ achievements: updated }) });
            __westoViewContext.showToast('هدف‌های وفاداری به‌صورت پایدار ذخیره شد.');
            await __westoViewContext.tabs.club('loyalty');
          } catch (error) {
            __westoViewContext.showToast(error.message || 'هدف‌ها ذخیره نشدند؛ ذخیرهٔ پایدار را بررسی کنید.', 'error');
          }
        });
        return;
      }

      // Default: 'customers' sub-tab
      let d = {};
      try {
        d = await __westoViewContext.api(__westoViewContext.crmAllBranchesScope && __westoViewContext.hasCapability('owner')
          ? '/api/admin/v2/crm?branchId=all'
          : `/api/admin/v2/crm${__westoViewContext.branchQs()}`);
      } catch (error) {
        __westoViewContext.main.innerHTML = `
          ${renderNav('customers')}
          <section class="section-box club-section" role="alert">
            <h2 class="club-section-title">اطلاعات مشتریان در دسترس نیست</h2>
            <p>داده‌های مشتریان و پرداخت فقط با دسترسی مجاز و در محدودهٔ شعبه نمایش داده می‌شوند.</p>
            <p class="hint">${__westoViewContext.esc(error?.message || 'دریافت اطلاعات با خطا روبه‌رو شد.')}</p>
            <button class="btn btn-sm" id="crm-retry-btn" type="button">تلاش دوباره</button>
          </section>`;
        bindNav();
        __westoViewContext.main.querySelector('#crm-retry-btn')?.addEventListener('click', () => __westoViewContext.tabs.club('customers'));
        return;
      }
      const customers = d.customers || d.members || [];
      const customerDetailsAvailable = d.customerDetailsAvailable !== false;
      const summary = d.summary || {
        customers: customers.length,
        points: d.totals?.pointsIssued || customers.reduce((s, m) => s + (m.points || 0), 0),
        walletTotalToman: 0,
        activeWallets: 0,
        avgLtvToman: 0,
        avgOrderToman: 0,
        atRiskCount: 0,
        championsCount: 0,
        newFeedback: 0,
      };

      __westoViewContext.main.innerHTML = `
        ${renderNav('customers')}

        ${__westoViewContext.hasCapability('owner') ? `<div class="row-actions" style="justify-content:flex-start; margin-bottom:0.75rem;"><button class="btn btn-sm btn-ghost" id="crm-all-branches-btn" type="button">${__westoViewContext.crmAllBranchesScope ? 'بازگشت به شعبهٔ انتخابی' : 'مشاهدهٔ همهٔ شعب'}</button></div>` : ''}

        <div class="crm-kpi-deck">
          <div class="crm-kpi-card is-gold">
            <span class="lbl">اعضای فعال</span>
            <span class="num">${__westoViewContext.fmtNum(summary.customers || 0)}</span>
            <span class="sub">باشگاه مشتریان وستو</span>
          </div>
          <div class="crm-kpi-card is-emerald">
            <span class="lbl">ارزش چرخه مشتری (LTV)</span>
            <span class="num">${__westoViewContext.fmtMoney(summary.avgLtvToman || 0)}</span>
            <span class="sub">میانگین سفارش: ${__westoViewContext.fmtMoney(summary.avgOrderToman || 0)}</span>
          </div>
          <div class="crm-kpi-card is-amber">
            <span class="lbl">در معرض ریزش</span>
            <span class="num">${__westoViewContext.fmtNum(summary.atRiskCount || 0)}</span>
            <span class="sub">بدون سفارش > ۶۰ روز</span>
          </div>
          <div class="crm-kpi-card is-purple">
            <span class="lbl">قهرمانان وفادار</span>
            <span class="num">${__westoViewContext.fmtNum(summary.championsCount || 0)}</span>
            <span class="sub">مشتریان وفادار ویژه</span>
          </div>
          <div class="crm-kpi-card">
            <span class="lbl">موجودی کل کیف پول</span>
            <span class="num" style="color:#10b981;">${summary.walletTotalToman == null ? '—' : __westoViewContext.fmtMoney(summary.walletTotalToman)}</span>
            <span class="sub">${summary.activeWallets == null ? 'در این محدوده نمایش داده نمی‌شود' : `${__westoViewContext.fmtNum(summary.activeWallets)} کیف پول دارای مانده`}</span>
          </div>
        </div>

        <section class="section-box club-section">
          <div style="display:flex; justify-content:space-between; align-items:center; gap:0.75rem; flex-wrap:wrap; margin-bottom:0.85rem;">
            <div class="crm-rfm-filters" id="crm-rfm-bar">
              <button class="crm-rfm-btn is-active" data-rfm-filter="all" type="button">همه (${__westoViewContext.fmtNum(customers.length)})</button>
              <button class="crm-rfm-btn" data-rfm-filter="champion" type="button">قهرمانان 🏆</button>
              <button class="crm-rfm-btn" data-rfm-filter="loyal" type="button">وفادار 💎</button>
              <button class="crm-rfm-btn" data-rfm-filter="potential" type="button">مستعد رشد 🚀</button>
              <button class="crm-rfm-btn" data-rfm-filter="at_risk" type="button">در معرض ریزش ⚠️</button>
              <button class="crm-rfm-btn" data-rfm-filter="new" type="button">جدید 🌱</button>
            </div>
            <input type="text" id="cust-search" class="input ltr" placeholder="جستجوی نام یا تلفن…" style="max-width:220px; font-size:0.82rem;" />
          </div>
          <div style="overflow-x:auto;">
            <table class="tbl" id="customers-tbl">
              <thead>
                <tr>
                  <th>مشتری</th>
                  <th>بخش‌بندی RFM</th>
                  <th>سطح</th>
                  <th>سفارش</th>
                  <th>خرید</th>
                  <th>کیف پول</th>
                  <th>امتیاز</th>
                  ${customerDetailsAvailable ? '<th></th>' : ''}
                </tr>
              </thead>
              <tbody>
                ${customers.slice(0, 100).map((c) => {
                  const rfmSeg = c.rfmSegment || 'new';
                  const rfmBadge = `<span class="rfm-badge rfm-badge--${rfmSeg}">${__westoViewContext.esc(c.rfmLabel || 'مشتری جدید 🌱')}</span>`;
                  const tagsHtml = (c.tags && c.tags.length) ? `<div class="dossier-tags-wrap" style="margin-top:0.25rem;">${c.tags.map((t) => `<span class="dossier-tag dossier-tag--dietary">${__westoViewContext.esc(t)}</span>`).join('')}</div>` : '';
                  const recencyHtml = c.recencyDays != null ? `<div class="hint">${__westoViewContext.fmtNum(c.recencyDays)} روز پیش</div>` : '';
                  return `
                  <tr data-phone="${__westoViewContext.esc(c.phone)}" data-name="${__westoViewContext.esc(c.name || '')}" data-rfm="${rfmSeg}">
                    <td>
                      <b>${__westoViewContext.esc(c.name || 'مهمان')}</b>
                      <div class="hint ltr">${__westoViewContext.esc(c.phone)}</div>
                      ${tagsHtml}
                    </td>
                    <td>${rfmBadge}</td>
                    <td>${c.tier == null ? '—' : tierBadge(c)}</td>
                    <td>
                      <b>${__westoViewContext.fmtNum(c.orders || 0)}</b>
                      ${recencyHtml}
                    </td>
                    <td>${__westoViewContext.fmtMoney(c.total || 0)}</td>
                    <td style="color:#10b981; font-weight:700;">${c.walletBalanceToman == null ? '—' : __westoViewContext.fmtMoney(c.walletBalanceToman)}</td>
                    <td><b>${c.points == null ? '—' : __westoViewContext.fmtNum(c.points)}</b></td>
                    ${customerDetailsAvailable ? `<td><button class="btn btn-sm btn-ghost open-dossier-btn" data-phone="${__westoViewContext.esc(c.phone)}" type="button">پرونده</button></td>` : ''}
                  </tr>
                `;}).join('') || `<tr><td colspan="${customerDetailsAvailable ? 8 : 7}">مشتری ثبت نشده.</td></tr>`}
              </tbody>
            </table>
          </div>
        </section>
      `;
      bindNav();

      __westoViewContext.main.querySelector('#crm-all-branches-btn')?.addEventListener('click', () => {
        __westoViewContext.crmAllBranchesScope = !__westoViewContext.crmAllBranchesScope;
        __westoViewContext.tabs.club('customers');
      });

      __westoViewContext.main.querySelectorAll('.open-dossier-btn').forEach((btn) => {
        btn.addEventListener('click', () => renderDossierModal(btn.dataset.phone));
      });

      let currentRfm = 'all';
      const applyCrmFilters = () => {
        const q = (__westoViewContext.main.querySelector('#cust-search')?.value || '').trim().toLowerCase();
        __westoViewContext.main.querySelectorAll('#customers-tbl tbody tr').forEach((row) => {
          const phone = (row.dataset.phone || '').toLowerCase();
          const name = (row.dataset.name || '').toLowerCase();
          const rfm = row.dataset.rfm || 'new';
          const matchSearch = !q || phone.includes(q) || name.includes(q);
          const matchRfm = currentRfm === 'all' || rfm === currentRfm;
          row.style.display = matchSearch && matchRfm ? '' : 'none';
        });
      };

      __westoViewContext.main.querySelectorAll('.crm-rfm-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          __westoViewContext.main.querySelectorAll('.crm-rfm-btn').forEach((b) => b.classList.remove('is-active'));
          btn.classList.add('is-active');
          currentRfm = btn.dataset.rfmFilter || 'all';
          applyCrmFilters();
        });
      });

      __westoViewContext.main.querySelector('#cust-search')?.addEventListener('input', applyCrmFilters);
    }
}['club'];
});
/*westo-view:end:club*/

/*westo-view:start:wallet*/
window.WestoAdminModules.defineView('crm', 'wallet', function(__westoViewContext) {
return {
async wallet() {
      __westoViewContext.tabs.club('wallet');
    }
}['wallet'];
});
/*westo-view:end:wallet*/

/*westo-view:start:campaigns*/
window.WestoAdminModules.defineView('crm', 'campaigns', function(__westoViewContext) {
return {
async campaigns() {
      __westoViewContext.tabs.club('campaigns');
    }
}['campaigns'];
});
/*westo-view:end:campaigns*/

/*westo-view:start:sms*/
window.WestoAdminModules.defineView('crm', 'sms', function(__westoViewContext) {
return {
async sms() {
      __westoViewContext.tabs.club('sms');
    }
}['sms'];
});
/*westo-view:end:sms*/

/*westo-view:start:loyalty*/
window.WestoAdminModules.defineView('crm', 'loyalty', function(__westoViewContext) {
return {
async loyalty() {
      __westoViewContext.tabs.club('loyalty');
    }
}['loyalty'];
});
/*westo-view:end:loyalty*/

/*westo-view:start:feedback*/
window.WestoAdminModules.defineView('crm', 'feedback', function(__westoViewContext) {
return {
async feedback() {
      __westoViewContext.setActiveTab('feedback');
      const d = await __westoViewContext.api(`/api/admin/feedback${__westoViewContext.branchQs('days=30')}`);
      const st = d.stats || {};
      const s = d.settings || {};
      const bucketLabel = { promoter: 'مروج', passive: 'خنثی', detractor: 'منتقد' };
      const statusLabel = { new: 'جدید', in_progress: 'در دست پیگیری', reviewed: 'بررسی‌شده', resolved: 'حل‌شده', archived: 'بایگانی' };
      const branchName = (id) => __westoViewContext.branchesCache.find((b) => b.id === id)?.name || (id ? `#${id}` : '—');

      const totalCount = st.count || 0;
      const promoterPct = totalCount ? Math.round(((st.promoters || 0) / totalCount) * 100) : 0;
      const passivePct = totalCount ? Math.round(((st.passives || 0) / totalCount) * 100) : 0;
      const detractorPct = totalCount ? Math.max(0, 100 - promoterPct - passivePct) : 0;
      const npsVal = st.nps;
      const npsScoreClass = npsVal == null ? '' : (npsVal >= 50 ? 'is-excellent' : npsVal >= 20 ? 'is-good' : npsVal >= 0 ? 'is-warning' : 'is-danger');

      __westoViewContext.main.innerHTML = `
        <h1>بازخورد و رضایت مهمان</h1>
        <p class="lead">امتیاز احتمال پیشنهاد به دوستان از صفر تا ده — <a href="/feedback" target="_blank" rel="noopener">مشاهده صفحه عمومی بازخورد</a></p>

        <div class="nps-dashboard-grid">
          <div class="nps-meter-card">
            <div style="font-size:0.85rem; font-weight:700; color:var(--v-muted,#94a3b8);">شاخص خالص رضایت مهمانان (NPS)</div>
            <div class="nps-score-big ${npsScoreClass}">${npsVal == null ? '—' : (npsVal > 0 ? '+' : '') + __westoViewContext.fmtNum(npsVal)}</div>
            <div class="nps-segments-bar">
              <div class="nps-seg--promoter" style="width:${promoterPct}%" title="مروج: ${promoterPct}٪"></div>
              <div class="nps-seg--passive" style="width:${passivePct}%" title="خنثی: ${passivePct}٪"></div>
              <div class="nps-seg--detractor" style="width:${detractorPct}%" title="منتقد: ${detractorPct}٪"></div>
            </div>
            <div style="display:flex; justify-content:space-between; width:100%; font-size:0.75rem; color:var(--v-muted,#94a3b8); margin-top:0.35rem;">
              <span>🟢 مروج: ${__westoViewContext.fmtNum(promoterPct)}٪ (${__westoViewContext.fmtNum(st.promoters || 0)})</span>
              <span>🟡 خنثی: ${__westoViewContext.fmtNum(passivePct)}٪ (${__westoViewContext.fmtNum(st.passives || 0)})</span>
              <span>🔴 منتقد: ${__westoViewContext.fmtNum(detractorPct)}٪ (${__westoViewContext.fmtNum(st.detractors || 0)})</span>
            </div>
          </div>
          <div class="nps-meter-card" style="align-items:flex-start; text-align:right;">
            <div style="font-size:0.85rem; font-weight:700; color:var(--v-muted,#94a3b8); margin-bottom:0.6rem;">وضعیت رسیدگی به نظرات</div>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:0.75rem; width:100%;">
              <div>
                <div class="hint">کل نظرات ثبت‌شده</div>
                <b style="font-size:1.3rem;">${__westoViewContext.fmtNum(st.count || 0)}</b>
              </div>
              <div>
                <div class="hint">میانگین امتیاز</div>
                <b style="font-size:1.3rem; color:#38bdf8;">${st.avg == null ? '—' : __westoViewContext.fmtNum(st.avg.toFixed(1))} / ۱۰</b>
              </div>
              <div>
                <div class="hint">نیازمند پیگیری و جبران</div>
                <b style="font-size:1.3rem; color:#ef4444;">${__westoViewContext.fmtNum(st.detractors || 0)}</b>
              </div>
              <div>
                <div class="hint">دوره آماری</div>
                <b style="font-size:1.1rem;">${__westoViewContext.fmtNum(d.days || 30)} روز اخیر</b>
              </div>
            </div>
          </div>
        </div>

        <div class="section-box">
          <h2>تنظیمات</h2>
          <div class="grid-2">
            <label class="chk" style="display:flex;align-items:center;gap:0.4rem;"><input type="checkbox" id="fb_en" ${s.enabled !== false ? 'checked' : ''} /> بازخورد فعال</label>
            <label class="chk" style="display:flex;align-items:center;gap:0.4rem;"><input type="checkbox" id="fb_ord" ${s.askAfterOrder !== false ? 'checked' : ''} /> پیشنهاد پس از سفارش</label>
            ${__westoViewContext.field('عنوان صفحه', 'fb_title', s.title || '')}
            ${__westoViewContext.field('توضیح', 'fb_sub', s.subtitle || '', { textarea: true })}
            ${__westoViewContext.field('پیام تشکر', 'fb_ty', s.thankYou || '')}
          </div>
          <p class="hint" style="margin-top:0.75rem">ذخیره خودکار</p>
        </div>

        <section class="section-box">
          <h2>آخرین بازخوردها</h2>
          <div style="overflow-x:auto;">
            <table class="tbl"><thead><tr><th>#</th><th>امتیاز</th><th>دسته</th><th>نظر و مهمان</th><th>شعبه</th><th>زمان</th><th>وضعیت</th><th>یادداشت پیگیری</th></tr></thead>
            <tbody>
              ${(d.feedback || [])
                .map((f) => {
                  const isDetractor = Number(f.score) <= 6 || f.bucket === 'detractor';
                  const rowClass = isDetractor ? 'fb-recovery-card' : '';
                  const detractorBadge = isDetractor ? '<div style="margin-top:0.2rem;"><span class="fb-alert-pill">⚠️ پیگیری فوری</span></div>' : '';
                  return `
                  <tr class="${rowClass}" data-fbid="${f.id}">
                    <td>${f.id}</td>
                    <td class="ltr"><strong>${f.score}</strong></td>
                    <td>
                      ${bucketLabel[f.bucket] || f.bucket}
                      ${detractorBadge}
                    </td>
                    <td>
                      ${__westoViewContext.esc(f.comment) || '—'}
                      ${f.name ? `<div class="hint">${__westoViewContext.esc(f.name)} · <span class="ltr">${__westoViewContext.esc(f.phone || '')}</span></div>` : ''}
                    </td>
                    <td>${__westoViewContext.esc(branchName(f.branchId))}</td>
                    <td>${__westoViewContext.fmtDateTime(f.createdAt)}</td>
                    <td>
                      <select data-fbstatus="${f.id}">
                        ${Object.keys(statusLabel)
                          .map((k) => `<option value="${k}" ${f.status === k ? 'selected' : ''}>${statusLabel[k]}</option>`)
                          .join('')}
                      </select>
                    </td>
                    <td>
                      <input class="admin-note-input" data-fbnote="${f.id}" value="${__westoViewContext.esc(f.resolutionNote || '')}" placeholder="یادداشت رفع نارضایتی…" style="font-size:0.78rem;" />
                    </td>
                  </tr>`;
                })
                .join('') || '<tr><td colspan="8">هنوز بازخوردی ثبت نشده</td></tr>'}
            </tbody></table>
          </div>
        </section>`;

      const saveFb = async () => {
        try {
          await __westoViewContext.api('/api/admin/feedback/settings', {
            method: 'PUT',
            body: JSON.stringify({
              settings: {
                enabled: document.getElementById('fb_en')?.checked !== false,
                askAfterOrder: document.getElementById('fb_ord')?.checked !== false,
                title: document.getElementById('fb_title')?.value || '',
                subtitle: document.getElementById('fb_sub')?.value || '',
                thankYou: document.getElementById('fb_ty')?.value || '',
              },
            }),
          });
        } catch (e) {
          __westoViewContext.showToast(e.message || 'خطا در ذخیره تنظیمات بازخورد', 'error');
        }
      };
      __westoViewContext.bindAutosave(__westoViewContext.main.querySelector('.section-box'), saveFb);
      __westoViewContext.main.querySelectorAll('[data-fbstatus]').forEach((sel) => {
        sel.addEventListener('change', async () => {
          try {
            await __westoViewContext.api(`/api/admin/feedback/${sel.dataset.fbstatus}`, {
              method: 'PATCH',
              body: JSON.stringify({ status: sel.value }),
            });
            __westoViewContext.showToast('وضعیت بازخورد به‌روز شد', 'success');
          } catch (e) {
            __westoViewContext.showToast(e.message || 'خطا در به‌روزرسانی وضعیت بازخورد', 'error');
            await __westoViewContext.tabs.feedback();
          }
        });
      });
      __westoViewContext.main.querySelectorAll('[data-fbnote]').forEach((input) => {
        const save = __westoViewContext.autosave(() => __westoViewContext.api(`/api/admin/feedback/${input.dataset.fbnote}`, { method: 'PATCH', body: JSON.stringify({ resolutionNote: input.value.trim() }) }), { debounceMs: 500, silent: true });
        input.addEventListener('change', save);
        input.addEventListener('blur', save);
      });
    }
}['feedback'];
});
/*westo-view:end:feedback*/

/*westo-view:start:newsletter*/
window.WestoAdminModules.defineView('crm', 'newsletter', function(__westoViewContext) {
return {
async newsletter() {
      __westoViewContext.setActiveTab('newsletter');
      const d = await __westoViewContext.api('/api/admin/newsletter');
      const list = Array.isArray(d.newsletter) ? d.newsletter : [];
      __westoViewContext.main.innerHTML = `
        <h1>خبرنامه</h1>
        <div class="section-box">
          <h2>${__westoViewContext.fmtNum(list.length)} ایمیل ثبت‌شده <small><a href="#" id="csv-link">دریافت فایل خبرنامه</a></small></h2>
          <table class="tbl"><thead><tr><th>ایمیل</th><th>تاریخ ثبت</th></tr></thead><tbody>
            ${list.map((n) => `<tr><td class="ltr">${__westoViewContext.esc(n.email)}</td><td>${__westoViewContext.fmtDateTime(n.at)}</td></tr>`).join('') || '<tr><td colspan="2">هنوز ایمیلی ثبت نشده است</td></tr>'}
          </tbody></table>
        </div>`;
      document.getElementById('csv-link')?.addEventListener('click', (e) => {
        e.preventDefault();
        if (!list.length) {
          __westoViewContext.showToast('ایمیلی برای دریافت فایل وجود ندارد', 'warn');
          return;
        }
        const csv = 'email,date\n' + list.map((n) => `${n.email},${n.at}`).join('\n');
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
        a.download = 'newsletter.csv';
        a.click();
      });
    }
}['newsletter'];
});
/*westo-view:end:newsletter*/
