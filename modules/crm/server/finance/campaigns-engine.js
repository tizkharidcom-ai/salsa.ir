'use strict';

/**
 * WESTO Automated Campaigns Engine
 *
 * Implements:
 * 1. Birthday celebration gifts (Wallet credit, loyalty points, coupons)
 * 2. Peer-to-peer Referral program (Unique invite codes, two-way rewards)
 * 3. Time-based Happy Hour dynamic discounts & bonus loyalty multipliers
 */

const shamsi = require('../../../platform_core/server/finance/shamsi.js');
const walletEngine = require('./wallet-engine.js');
const crypto = require('node:crypto');
const program = require('./club-program.js');
const { normalizePhoneKey, isValidCompletedOrder, orderBelongsToMember } = require('./loyalty-achievements.js');

function normalizeCampaignConfig(db, input) {
  const config = getCampaignConfig(db);
  const aliases = {
    birthday: { rewardWalletToman: 'walletBonusToman', rewardPoints: 'pointsBonus', validDaysAfter: 'windowDaysAfter' },
    referral: { referrerRewardWalletToman: 'inviterRewardWalletToman', refereeRewardWalletToman: 'inviteeRewardWalletToman', minFirstOrderToman: 'minOrderToUnlockToman' },
  };
  for (const section of ['birthday', 'referral', 'happyHour']) {
    if (input[section] === undefined) continue;
    if (!input[section] || typeof input[section] !== 'object' || Array.isArray(input[section])) program.fail('campaign_config_invalid', 'تنظیمات کمپین معتبر نیست.');
    for (const [rawKey, rawValue] of Object.entries(input[section])) {
      const key = aliases[section]?.[rawKey] || rawKey;
      if (!(key in DEFAULT_CAMPAIGN_CONFIG[section])) program.fail('campaign_field_invalid', `گزینهٔ ${rawKey} پشتیبانی نمی‌شود.`);
      let value = rawValue;
      if (key === 'enabled') {
        if (typeof value !== 'boolean') program.fail('campaign_enabled_invalid', 'وضعیت کمپین معتبر نیست.');
      } else if (['title', 'bannerText', 'messageTemplate'].includes(key)) {
        value = String(value || '').trim().slice(0, 500);
      } else if (['activeDays', 'categoryFilter'].includes(key)) {
        if (!Array.isArray(value) || value.length > 100) program.fail('campaign_list_invalid', 'فهرست کمپین معتبر نیست.');
        value = [...new Set(value.map((v) => program.number(v, { max: key === 'activeDays' ? 6 : 1e9 })))];
      } else if (['startHour', 'endHour'].includes(key) && typeof value === 'string' && value.includes(':')) {
        if (!/^\d{1,2}:\d{2}$/.test(value)) program.fail('campaign_time_invalid', 'ساعت باید به شکل ۱۶:۳۰ باشد.');
        const [hour, minute] = value.split(':');
        config[section][key.replace('Hour', 'Minute')] = program.number(minute, { max: 59 });
        value = program.number(hour, { max: 23 });
      } else {
        const max = key.endsWith('Hour') ? 23 : key.endsWith('Minute') ? 59 : key.endsWith('Pct') ? 100 : key.startsWith('windowDays') ? 30 : key === 'pointsMultiplier' ? 10 : 1e8;
        value = program.number(value, { min: key === 'pointsMultiplier' ? 1 : 0, max, integer: key !== 'pointsMultiplier' });
      }
      config[section][key] = value;
    }
  }
  return config;
}

const DEFAULT_CAMPAIGN_CONFIG = Object.freeze({
  birthday: {
    enabled: true,
    title: 'هدیه سالروز تولد',
    walletBonusToman: 100_000,
    pointsBonus: 200,
    discountPct: 15,
    windowDaysBefore: 3,
    windowDaysAfter: 7,
    messageTemplate: 'تولدتان در وستو مبارک! ۱۰۰ هزار تومان هدیه نقدی در کیف پول شما شارژ شد.',
  },
  referral: {
    enabled: true,
    title: 'پاداش معرفی و دعوت از دوستان',
    inviterRewardWalletToman: 75_000,
    inviterRewardPoints: 150,
    inviteeRewardWalletToman: 50_000,
    inviteeRewardPoints: 100,
    inviteeDiscountPct: 10,
    minOrderToUnlockToman: 200_000,
  },
  happyHour: {
    enabled: true,
    title: 'ساعت شاد وستو (Happy Hour)',
    // 0: Sunday, 1: Monday, 2: Tuesday, 3: Wednesday, 4: Thursday, 5: Friday, 6: Saturday
    activeDays: [6, 0, 1, 2, 3], // Saturday to Wednesday
    startHour: 16,
    startMinute: 0,
    endHour: 19,
    endMinute: 0,
    discountPct: 20,
    pointsMultiplier: 2.0,
    bannerText: '⚡ هم‌اکنون ساعت شاد وستو: ۲۰٪ تخفیف روی منو و ۲ برابر امتیاز!',
    categoryFilter: [],
  },
});

function getCampaignConfig(db) {
  if (db?.campaigns && typeof db.campaigns === 'object') {
    return {
      birthday: { ...DEFAULT_CAMPAIGN_CONFIG.birthday, ...(db.campaigns.birthday || {}) },
      referral: { ...DEFAULT_CAMPAIGN_CONFIG.referral, ...(db.campaigns.referral || {}) },
      happyHour: { ...DEFAULT_CAMPAIGN_CONFIG.happyHour, ...(db.campaigns.happyHour || {}) },
    };
  }
  return JSON.parse(JSON.stringify(DEFAULT_CAMPAIGN_CONFIG));
}

function generateReferralCode(user) {
  return `WESTO-${crypto.createHash('sha256').update(`club-referral:${user?.id ?? normalizePhoneKey(user?.phone)}`).digest('hex').slice(0, 16).toUpperCase()}`;
}

function ensureUserReferral(user) {
  if (!user) return '';
  if (!user.referralCode) {
    user.referralCode = generateReferralCode(user);
  }
  return user.referralCode;
}

function applyReferralCode(db, { inviteePhone, referralCode, walletTopup = null }) {
  const code = String(referralCode || '').trim().toUpperCase();
  const phone = String(inviteePhone || '').trim();
  if (!code || !phone) {
    throw Object.assign(new Error('کد معرف و شماره همراه الزامی است.'), { code: 'referral_input_invalid' });
  }

  const config = getCampaignConfig(db).referral;
  if (!config.enabled) {
    throw Object.assign(new Error('سیستم دعوت از دوستان در حال حاضر غیرفعال است.'), { code: 'referral_disabled' });
  }

  // Find inviter
  const inviters = (db.users || []).filter((u) => !u.blocked && ensureUserReferral(u).toUpperCase() === code);
  if (inviters.length > 1) program.fail('referral_code_ambiguous', 'کد قدیمی معرف تکراری است؛ از معرف کد جدید بخواهید.', 409);
  const inviter = inviters[0];
  if (!inviter) {
    throw Object.assign(new Error('کد معرف وارد شده معتبر نیست.'), { code: 'referral_code_not_found' });
  }

  if (normalizePhoneKey(inviter.phone) === normalizePhoneKey(phone)) {
    throw Object.assign(new Error('نمی‌توانید از کد معرف خودتان استفاده کنید.'), { code: 'self_referral_forbidden' });
  }

  db.referrals = db.referrals || [];
  const existing = db.referrals.find((r) => normalizePhoneKey(r.inviteePhone) === normalizePhoneKey(phone));
  if (existing) {
    throw Object.assign(new Error('برای این حساب کاربری قبلاً کد معرف ثبت شده است.'), { code: 'referral_already_applied' });
  }

  // Record referral linkage
  const nextId = Math.max(0, ...db.referrals.map((r) => Number(r.id) || 0), 0) + 1;
  const referralRecord = {
    id: nextId,
    inviterPhone: inviter.phone,
    inviterName: inviter.name || '',
    inviteePhone: phone,
    code,
    status: 'registered', // 'registered' -> 'rewarded' once 1st order meets threshold
    inviteeRewardWalletToman: config.inviteeRewardWalletToman,
    inviteeRewardPoints: config.inviteeRewardPoints,
    inviterRewardWalletToman: config.inviterRewardWalletToman,
    inviterRewardPoints: config.inviterRewardPoints,
    at: new Date().toISOString(),
  };

  db.referrals.unshift(referralRecord);

  // Immediately award invitee welcome bonus. In production the injected
  // callback posts the marketing-funded liability journal before crediting.
  if (config.inviteeRewardWalletToman > 0) {
    const topup = {
      phone,
      amountToman: config.inviteeRewardWalletToman,
      paymentMethod: 'referral_welcome',
      // The inviter is not a sufficient idempotency boundary: one inviter
      // may welcome multiple invitees. Include the beneficiary phone so a
      // second legitimate referral cannot replay the first person's event.
      reference: `REF-WELCOME-${inviter.phone}-${phone}`,
      actor: 'referral-system',
    };
    if (typeof walletTopup === 'function') walletTopup(topup);
    else walletEngine.topupWallet(db, topup);
  }

  const invitee = (db.users || []).find((u) => u.phone === phone);
  if (invitee && config.inviteeRewardPoints > 0) {
    program.appendPoints(db, invitee, config.inviteeRewardPoints, 'referral_welcome', { key: `referral-welcome:${referralRecord.id}` });
  }

  return {
    ok: true,
    inviterName: inviter.name || 'کاربر وستو',
    inviterPhone: inviter.phone,
    inviteeRewardWalletToman: config.inviteeRewardWalletToman,
    inviteeRewardPoints: config.inviteeRewardPoints,
    inviteeDiscountPct: config.inviteeDiscountPct,
    referralRecord,
  };
}

function checkAndRewardReferralOnOrder(db, order, { walletTopup = null } = {}) {
  if (!order || !order.phone || !order.total || !isValidCompletedOrder(order)) return null;
  const config = getCampaignConfig(db).referral;
  if (!config.enabled) return null;

  db.referrals = db.referrals || [];
  const referral = db.referrals.find((r) => normalizePhoneKey(r.inviteePhone) === normalizePhoneKey(order.phone) && r.status === 'registered');
  if (!referral) return null;

  const orderTotal = Math.max(0, Math.round(Number(order.total) || 0));
  if (orderTotal < (referral.minOrderToUnlockToman ?? config.minOrderToUnlockToman ?? 0)) return null;

  // Unlock inviter reward only after the wallet journal/credit succeeds.
  if (config.inviterRewardWalletToman > 0) {
    const topup = {
      phone: referral.inviterPhone,
      amountToman: config.inviterRewardWalletToman,
      paymentMethod: 'referral_bonus',
      reference: `REF-BONUS-${order.id}`,
      actor: 'referral-system',
    };
    if (typeof walletTopup === 'function') walletTopup(topup);
    else walletEngine.topupWallet(db, topup);
  }

  referral.status = 'rewarded';
  referral.unlockedAt = new Date().toISOString();
  referral.qualifyingOrderId = order.id;

  const inviter = (db.users || []).find((u) => u.phone === referral.inviterPhone);
  if (inviter && config.inviterRewardPoints > 0) {
    program.appendPoints(db, inviter, config.inviterRewardPoints, 'referral_bonus', { key: `referral-bonus:${referral.id}`, orderId: order.id });
  }

  return {
    rewarded: true,
    inviterPhone: referral.inviterPhone,
    rewardWalletToman: config.inviterRewardWalletToman,
    rewardPoints: config.inviterRewardPoints,
  };
}

function checkBirthdayEligibility(db, user, now = new Date()) {
  if (!user || !user.birthdate) {
    return { eligible: false, reason: 'تاریخ تولد در حساب ثبت نشده است.' };
  }

  const config = getCampaignConfig(db).birthday;
  if (!config.enabled) {
    return { eligible: false, reason: 'کمپین سالروز تولد در حال حاضر غیرفعال است.' };
  }

  const parts = shamsi.toShamsiParts(now);
  const currentShamsiYear = parts.year;
  const currentShamsiMonth = parts.month;
  const currentShamsiDay = parts.day;

  // Already rewarded this Shamsi year?
  if (user.lastBirthdayRewardYear && Number(user.lastBirthdayRewardYear) >= currentShamsiYear) {
    return {
      eligible: false,
      alreadyRewarded: true,
      rewardYear: user.lastBirthdayRewardYear,
      reason: `هدیه تولد سال ${user.lastBirthdayRewardYear} قبلاً دریافت شده است.`,
    };
  }

  // Parse birthdate (supports formats: '1370/06/15', '1370-06-15', '06/15')
  const cleanBirth = shamsi.toEnDigits(String(user.birthdate)).trim().replace(/-/g, '/');
  const bParts = cleanBirth.split('/').map((n) => parseInt(n, 10));
  let bMonth = 0;
  let bDay = 0;

  if (bParts.length === 3) {
    bMonth = bParts[1];
    bDay = bParts[2];
  } else if (bParts.length === 2) {
    bMonth = bParts[0];
    bDay = bParts[1];
  }

  if (!bMonth || !bDay || bMonth < 1 || bMonth > 12 || bDay < 1 || bDay > 31) {
    return { eligible: false, reason: 'قالب تاریخ تولد نامعتبر است.' };
  }

  const today = shamsi.jalaliToGregorian(currentShamsiYear, currentShamsiMonth, currentShamsiDay);
  const todayMs = Date.UTC(today.gy, today.gm - 1, today.gd);
  const anniversaries = [currentShamsiYear - 1, currentShamsiYear, currentShamsiYear + 1].map((year) => {
    const day = bMonth === 12 && bDay === 30 && !shamsi.isJalaliLeapYear(year) ? 29 : bDay;
    const date = shamsi.jalaliToGregorian(year, bMonth, day);
    return { year, diff: Math.round((todayMs - Date.UTC(date.gy, date.gm - 1, date.gd)) / 86400000) };
  }).sort((a, b) => Math.abs(a.diff) - Math.abs(b.diff));
  const { year: rewardYear, diff: diffDays } = anniversaries[0];
  if ((db.campaignLog || []).some((entry) => entry.type === 'birthday' && normalizePhoneKey(entry.phone) === normalizePhoneKey(user.phone) && Number(entry.year) === rewardYear)) {
    return { eligible: false, alreadyRewarded: true, reason: 'هدیهٔ این سالروز قبلاً دریافت شده است.' };
  }

  // Check window: windowDaysBefore <= diff <= windowDaysAfter
  const isWithinWindow = diffDays >= -(config.windowDaysBefore ?? 3) && diffDays <= (config.windowDaysAfter ?? 7);

  if (!isWithinWindow) {
    return {
      eligible: false,
      daysDifference: diffDays,
      birthMonth: bMonth,
      birthDay: bDay,
      reason: 'هنوز به سالروز تولد شما نرسیده‌ایم یا از بازه هفتگی آن گذشته است.',
    };
  }

  return {
    eligible: true,
    shamsiYear: rewardYear,
    walletBonusToman: config.walletBonusToman,
    pointsBonus: config.pointsBonus,
    discountPct: config.discountPct,
    message: config.messageTemplate,
  };
}

function grantBirthdayGift(db, phone, now = new Date(), { walletTopup = null } = {}) {
  const normalizedPhone = String(phone || '').trim();
  const user = (db.users || []).find((u) => u.phone === normalizedPhone);
  if (!user) {
    throw Object.assign(new Error('کاربر یافت نشد.'), { code: 'user_not_found' });
  }

  const check = checkBirthdayEligibility(db, user, now);
  if (!check.eligible) {
    throw Object.assign(new Error(check.reason || 'شرایط دریافت هدیه تولد احراز نشد.'), { code: 'birthday_not_eligible' });
  }

  const parts = shamsi.toShamsiParts(now);
  // Credit wallet
  let walletResult = null;
  if (check.walletBonusToman > 0) {
    const topup = {
      phone: user.phone,
      amountToman: check.walletBonusToman,
      paymentMethod: 'birthday_gift',
      reference: `HBD-${check.shamsiYear}-${normalizePhoneKey(user.phone)}`,
      actor: 'birthday-campaign',
    };
    walletResult = typeof walletTopup === 'function' ? walletTopup(topup) : walletEngine.topupWallet(db, topup);
  }

  user.lastBirthdayRewardYear = check.shamsiYear;

  // Credit loyalty points
  if (check.pointsBonus > 0) {
    program.appendPoints(db, user, check.pointsBonus, 'birthday', { key: `birthday:${check.shamsiYear}` });
  }

  // Record campaign log
  db.campaignLog = db.campaignLog || [];
  const logEntry = {
    id: db.campaignLog.length + 1,
    type: 'birthday',
    phone: user.phone,
    year: check.shamsiYear,
    walletBonusToman: check.walletBonusToman,
    pointsBonus: check.pointsBonus,
    at: new Date().toISOString(),
  };
  db.campaignLog.unshift(logEntry);

  return {
    ok: true,
    phone: user.phone,
    shamsiYear: parts.year,
    walletBonusToman: check.walletBonusToman,
    pointsBonus: check.pointsBonus,
    newWalletBalance: user.walletBalanceToman,
    newPoints: user.points,
    message: check.message,
    logEntry,
  };
}

function checkHappyHourStatus(db, now = new Date(), branchId = null) {
  const config = getCampaignConfig(db).happyHour;
  if (!config.enabled) {
    return { active: false, config };
  }

  // Javascript getDay(): 0: Sunday, 1: Monday, 2: Tuesday, 3: Wednesday, 4: Thursday, 5: Friday, 6: Saturday
  const branch = (db.branches || []).find((item) => String(item.id) === String(branchId));
  let timeZone = branch?.timeZone || branch?.timezone || db.settings?.businessTimeZone || 'Asia/Tehran';
  try { new Intl.DateTimeFormat('en-US', { timeZone }); } catch (_) { timeZone = 'Asia/Tehran'; }
  if (!Number.isFinite(now.getTime())) return { active: false, config };
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short' }).formatToParts(now).map((part) => [part.type, part.value]));
  const currentWeekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday);
  const currentHour = Number(parts.hour);
  const currentMinute = Number(parts.minute);
  const currentTotalMinutes = currentHour * 60 + currentMinute;

  const startTotalMinutes = (config.startHour || 0) * 60 + (config.startMinute || 0);
  const endTotalMinutes = (config.endHour || 0) * 60 + (config.endMinute || 0);

  const overnight = endTotalMinutes < startTotalMinutes;
  const campaignDay = overnight && currentTotalMinutes < endTotalMinutes ? (currentWeekday + 6) % 7 : currentWeekday;
  const isDayActive = Array.isArray(config.activeDays) && config.activeDays.includes(campaignDay);
  const isTimeActive = overnight ? currentTotalMinutes >= startTotalMinutes || currentTotalMinutes < endTotalMinutes : currentTotalMinutes >= startTotalMinutes && currentTotalMinutes < endTotalMinutes;

  const active = isDayActive && isTimeActive;
  const remainingMinutes = active ? (endTotalMinutes - currentTotalMinutes + 1440) % 1440 : 0;

  return {
    active,
    title: config.title,
    discountPct: config.discountPct || 0,
    pointsMultiplier: config.pointsMultiplier || 1.0,
    bannerText: config.bannerText || 'ساعت شاد وستو هم‌اکنون فعال است.',
    remainingMinutes,
    config,
  };
}

function summarizeCampaigns(db) {
  const config = getCampaignConfig(db);
  const referrals = db.referrals || [];
  const logs = db.campaignLog || [];

  const rewardedReferrals = referrals.filter((r) => r.status === 'rewarded');
  const totalReferralRewardsToman = rewardedReferrals.reduce((sum, r) => sum + (Number(r.inviterRewardWalletToman) || 0) + (Number(r.inviteeRewardWalletToman) || 0), 0);

  const birthdayLogs = logs.filter((l) => l.type === 'birthday');
  const totalBirthdayGiftsToman = birthdayLogs.reduce((sum, l) => sum + (Number(l.walletBonusToman) || 0), 0);

  return {
    config,
    happyHourStatus: checkHappyHourStatus(db),
    stats: {
      totalReferralsCount: referrals.length,
      rewardedReferralsCount: rewardedReferrals.length,
      totalReferralRewardsToman,
      totalBirthdayGiftsCount: birthdayLogs.length,
      totalBirthdayGiftsToman,
    },
    recentReferrals: referrals.slice(0, 20),
    recentBirthdayLogs: birthdayLogs.slice(0, 20),
  };
}

module.exports = {
  DEFAULT_CAMPAIGN_CONFIG,
  getCampaignConfig,
  normalizeCampaignConfig,
  generateReferralCode,
  ensureUserReferral,
  applyReferralCode,
  checkAndRewardReferralOnOrder,
  checkBirthdayEligibility,
  grantBirthdayGift,
  checkHappyHourStatus,
  summarizeCampaigns,
};
