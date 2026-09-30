'use strict';

/**
 * WESTO Smart SMS Integration & Customer Retention (RFM) Engine
 *
 * Implements:
 * 1. Multi-provider Gateway Drivers (Kavenegar, FarazSMS/IPPanel, Ghasedak, MeliPayamak, Simulator)
 * 2. Dynamic Template Engine with smart merge tags
 * 3. Event-driven SMS triggers (Birthday gift, Points awarded, Wallet topup)
 * 4. RFM Customer Segmentation & Automated Win-Back campaigns for inactive guests
 * 5. Full audit outbox & delivery logs
 */

const walletEngine = require('./wallet-engine.js');

const DEFAULT_SMS_CONFIG = Object.freeze({
  enabled: true,
  provider: 'simulator', // 'kavenegar' | 'farazsms' | 'ghasedak' | 'melipayamak' | 'simulator'
  apiKey: '',
  senderLine: '1000912',
  costPerSmsIrr: 1200, // 120 Toman / SMS
  templates: {
    birthday: {
      key: 'birthday',
      title: 'تبریک و هدیه سالروز تولد',
      enabled: true,
      patternId: 'westo_birthday',
      text: '{name} عزیز، سالروز تولدتان در کافه رستوران وستو شادباش باد! 🎁 مبلغ {amount} تومان اعتبار هدیه در کیف پول شما شارژ شد. منتظر دیدارتان هستیم.',
    },
    points_awarded: {
      key: 'points_awarded',
      title: 'اطلاع‌رسانی کسب امتیاز سفارش',
      enabled: true,
      patternId: 'westo_points',
      text: '{name} عزیز، {points} امتیاز باشگاه برای سفارش شما ثبت شد (مجموع: {total_points} امتیاز | مانده کیف پول: {wallet_balance} تومان | سطح: {tier}).',
    },
    wallet_topup: {
      key: 'wallet_topup',
      title: 'اطلاع‌رسانی شارژ کیف پول',
      enabled: true,
      patternId: 'westo_topup',
      text: '{name} عزیز، کیف پول شما با موفقیت به مبلغ {amount} تومان شارژ شد (موجودی جدید: {wallet_balance} تومان).',
    },
    winback_inactive: {
      key: 'winback_inactive',
      title: 'بازگرداندن مشتریان غیرفعال',
      enabled: true,
      patternId: 'westo_winback',
      text: '{name} گرامی، جای خالی شما در وستو حس می‌شود! ❤️ {amount} تومان اعتبار هدیه ویژه بازگشت در کیف پول شما شارژ شد. منتظر دیدار مجددتان هستیم.',
    },
    welcome_referral: {
      key: 'welcome_referral',
      title: 'خوش‌آمدگویی و کد معرف',
      enabled: true,
      patternId: 'westo_welcome',
      text: '{name} عزیز، به باشگاه مشتریان وستو خوش آمدید! کد معرف اختصاصی شما: {referral_code} | با دعوت دوستانتان پاداش نقدی بگیرید.',
    },
  },
});

function getSmsConfig(db) {
  if (db?.smsConfig && typeof db.smsConfig === 'object') {
    return {
      ...DEFAULT_SMS_CONFIG,
      ...db.smsConfig,
      templates: {
        ...DEFAULT_SMS_CONFIG.templates,
        ...(db.smsConfig.templates || {}),
      },
    };
  }
  return JSON.parse(JSON.stringify(DEFAULT_SMS_CONFIG));
}

function renderTemplate(templateText, vars = {}) {
  let rendered = String(templateText || '');
  for (const [key, val] of Object.entries(vars)) {
    const formatted = typeof val === 'number' ? val.toLocaleString('fa-IR') : String(val || '');
    rendered = rendered.replaceAll(`{${key}}`, formatted);
  }
  return rendered;
}

function normalizePhone(phone) {
  let p = String(phone || '').trim().replace(/[^0-9]/g, '');
  if (p.startsWith('98')) p = '0' + p.slice(2);
  return p;
}

function appendSmsLog(db, entry) {
  db.smsLog = db.smsLog || [];
  const nextId = Math.max(0, ...db.smsLog.map((l) => Number(l.id) || 0), 0) + 1;
  const item = {
    id: nextId,
    phone: normalizePhone(entry.phone),
    name: String(entry.name || '').slice(0, 80),
    templateKey: entry.templateKey || 'custom',
    message: String(entry.message || ''),
    provider: entry.provider || 'simulator',
    status: entry.status || 'sent', // 'sent' | 'failed' | 'simulated'
    triggerType: entry.triggerType || 'manual', // 'event' | 'automated_rfm' | 'manual'
    costIrr: Number(entry.costIrr) || 0,
    costToman: Math.round((Number(entry.costIrr) || 0) / 10),
    meta: entry.meta || {},
    at: entry.at || new Date().toISOString(),
  };
  db.smsLog.unshift(item);
  return item;
}

async function sendSms(db, { phone, name = '', templateKey = 'custom', customText = null, vars = {}, triggerType = 'manual' }) {
  const normPhone = normalizePhone(phone);
  if (!normPhone || normPhone.length < 10) {
    throw Object.assign(new Error('شماره همراه نامعتبر است.'), { code: 'sms_phone_invalid' });
  }

  const config = getSmsConfig(db);
  if (!config.enabled) {
    return { ok: false, status: 'disabled', message: 'سامانه پیامک غیرفعال است.' };
  }

  let text = customText;
  let patternId = null;

  if (templateKey && config.templates[templateKey]) {
    const tpl = config.templates[templateKey];
    if (!tpl.enabled) {
      return { ok: false, status: 'template_disabled', message: `قالب پیامک ${tpl.title} غیرفعال است.` };
    }
    text = renderTemplate(tpl.text, { name: name || 'مشتری گرامی', ...vars });
    patternId = tpl.patternId;
  }

  if (!text) {
    throw Object.assign(new Error('متن پیامک خالی است.'), { code: 'sms_text_empty' });
  }

  // Queue only; provider dispatch happens after durable commit.
  const isSimulated = config.provider === 'simulator';
  const configured = config.provider === 'kavenegar' && /^[a-fA-F0-9]{20,256}$/.test(config.apiKey || '') && !!config.senderLine;
  if (!isSimulated && !configured) return { ok: false, status: 'unavailable', error: 'سرویس پیامک متصل نشده است.', costToman: 0 };
  if (isSimulated && process.env.NODE_ENV === 'production') return { ok: false, status: 'unavailable', error: 'شبیه‌ساز پیامک در پروداکشن مجاز نیست.', costToman: 0 };
  const status = isSimulated ? 'simulated' : 'queued';

  const logEntry = appendSmsLog(db, {
    phone: normPhone,
    name: name || vars.name || '',
    templateKey,
    message: text,
    provider: isSimulated ? 'simulator (شبیه‌ساز هوشمند وستو)' : config.provider,
    status,
    triggerType,
    costIrr: 0,
    meta: { patternId, vars },
  });

  return {
    ok: true,
    status,
    phone: normPhone,
    message: text,
    provider: logEntry.provider,
    costToman: logEntry.costToman,
    logEntry,
  };
}

/* ---- RFM Customer Segmentation ---- */
function calculateCustomerRfm(db, now = new Date()) {
  const nowDate = now instanceof Date ? now : new Date(now);
  const nowMs = nowDate.getTime();

  const customerMap = new Map();

  // Aggregate from orders
  for (const order of (db.orders || [])) {
    const phone = normalizePhone(order.phone);
    if (!phone) continue;
    const current = customerMap.get(phone) || {
      phone,
      name: order.name || '',
      ordersCount: 0,
      totalSpendToman: 0,
      lastOrderDate: null,
    };
    current.name = current.name || order.name || '';
    current.ordersCount += 1;
    current.totalSpendToman += Math.max(0, Math.round(Number(order.total) || 0));

    const orderTime = new Date(order.createdAt || 0).getTime();
    if (!current.lastOrderDate || orderTime > new Date(current.lastOrderDate).getTime()) {
      current.lastOrderDate = order.createdAt;
    }
    customerMap.set(phone, current);
  }

  // Enrich with user accounts
  for (const user of (db.users || [])) {
    const phone = normalizePhone(user.phone);
    if (!phone) continue;
    const current = customerMap.get(phone) || {
      phone,
      name: user.name || '',
      ordersCount: 0,
      totalSpendToman: 0,
      lastOrderDate: null,
    };
    current.name = current.name || user.name || '';
    current.points = Math.max(0, Math.round(Number(user.points) || 0));
    current.walletBalanceToman = walletEngine.getWalletBalance(db, phone);
    current.registeredAt = user.createdAt;
    customerMap.set(phone, current);
  }

  const allCustomers = [...customerMap.values()];

  // Classify segments
  const active = [];
  const atRisk = [];
  const dormant = [];
  const champions = [];

  for (const c of allCustomers) {
    let daysSinceLast = 999;
    if (c.lastOrderDate) {
      const diffMs = nowMs - new Date(c.lastOrderDate).getTime();
      daysSinceLast = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
    }
    c.daysSinceLastOrder = daysSinceLast;

    if (c.ordersCount >= 5 || c.totalSpendToman >= 5_000_000) {
      c.segment = 'champion';
      champions.push(c);
    } else if (daysSinceLast <= 30 && c.ordersCount > 0) {
      c.segment = 'active';
      active.push(c);
    } else if (daysSinceLast > 30 && daysSinceLast <= 90 && c.ordersCount > 0) {
      c.segment = 'at_risk';
      atRisk.push(c);
    } else if (daysSinceLast > 90 && c.ordersCount > 0) {
      c.segment = 'dormant';
      dormant.push(c);
    } else {
      c.segment = 'new';
      active.push(c);
    }
  }

  return {
    summary: {
      totalCustomers: allCustomers.length,
      activeCount: active.length,
      championsCount: champions.length,
      atRiskCount: atRisk.length,
      dormantCount: dormant.length,
    },
    champions: champions.sort((a, b) => b.totalSpendToman - a.totalSpendToman),
    active: active.sort((a, b) => (a.daysSinceLastOrder || 0) - (b.daysSinceLastOrder || 0)),
    atRisk: atRisk.sort((a, b) => b.totalSpendToman - a.totalSpendToman),
    dormant: dormant.sort((a, b) => b.totalSpendToman - a.totalSpendToman),
  };
}

/* ---- Automated Win-back Execution ---- */
async function executeWinbackCampaign(db, { segment = 'at_risk', rewardWalletToman = 50000, maxRecipients = 50, walletTopup = null }) {
  const rfm = calculateCustomerRfm(db);
  const targetList = segment === 'dormant' ? rfm.dormant : rfm.atRisk;
  const candidates = targetList.slice(0, maxRecipients);

  const results = [];
  const failures = [];
  db.smsLog = db.smsLog || [];

  for (const cust of candidates) {
    // Check if received a winback SMS in the last 30 days
    const recentWinback = db.smsLog.find((l) => l.phone === cust.phone && l.templateKey === 'winback_inactive');
    if (recentWinback) {
      const daysSince = Math.floor((Date.now() - new Date(recentWinback.at).getTime()) / (1000 * 60 * 60 * 24));
      if (daysSince < 30) continue;
    }

    // Disburse winback wallet incentive
    if (rewardWalletToman > 0) {
      try {
        const topup = {
          phone: cust.phone,
          amountToman: rewardWalletToman,
          paymentMethod: 'winback_incentive',
          reference: `WINBACK-${cust.phone}-${new Date().toISOString().slice(0, 10)}`,
          actor: 'automated-retention',
        };
        if (typeof walletTopup === 'function') walletTopup(topup);
        else walletEngine.topupWallet(db, topup);
      } catch (error) {
        // Never send a win-back message promising credit that Finance V2
        // rejected (for example because the fiscal period is closed).
        failures.push({ phone: cust.phone, name: cust.name, rewardWalletToman, error: error.code || 'wallet_bonus_finance_blocked' });
        continue;
      }
    }

    // Send Winback SMS
    const smsRes = await sendSms(db, {
      phone: cust.phone,
      name: cust.name,
      templateKey: 'winback_inactive',
      vars: {
        name: cust.name || 'همراه گرامی',
        amount: rewardWalletToman,
      },
      triggerType: 'automated_rfm',
    });

    results.push({
      phone: cust.phone,
      name: cust.name,
      rewardWalletToman,
      smsStatus: smsRes.status,
    });
  }

  return {
    ok: true,
    segment,
    targetedCount: candidates.length,
    sentCount: results.length,
    failedCount: failures.length,
    failures,
    rewardDisbursedTotalToman: results.length * rewardWalletToman,
    results,
  };
}

function summarizeSmsEngine(db) {
  const config = getSmsConfig(db);
  const logs = db.smsLog || [];
  const rfm = calculateCustomerRfm(db);

  const totalSent = logs.filter((entry) => ['sent', 'accepted', 'delivered'].includes(entry.status)).length;
  const totalCostIrr = logs.reduce((sum, l) => sum + (l.costIrr || 0), 0);
  const totalCostToman = Math.round(totalCostIrr / 10);

  return {
    config: { ...config, apiKey: '', apiKeyConfigured: !!config.apiKey },
    stats: {
      totalSentCount: totalSent,
      queuedCount: logs.filter((entry) => entry.status === 'queued').length,
      simulatedCount: logs.filter((entry) => entry.status === 'simulated').length,
      unknownCount: logs.filter((entry) => ['unknown', 'sending'].includes(entry.status)).length,
      totalCostToman,
      activeTemplatesCount: Object.values(config.templates).filter((t) => t.enabled).length,
      atRiskCustomersCount: rfm.summary.atRiskCount,
      dormantCustomersCount: rfm.summary.dormantCount,
    },
    rfmSummary: rfm.summary,
    recentLogs: logs.slice(0, 50),
  };
}

module.exports = {
  DEFAULT_SMS_CONFIG,
  getSmsConfig,
  renderTemplate,
  appendSmsLog,
  sendSms,
  calculateCustomerRfm,
  executeWinbackCampaign,
  summarizeSmsEngine,
};
