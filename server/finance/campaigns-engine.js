'use strict';

/**
 * WESTO Automated Campaigns Engine
 *
 * Implements:
 * 1. Birthday celebration gifts (Wallet credit, loyalty points, coupons)
 * 2. Peer-to-peer Referral program (Unique invite codes, two-way rewards)
 * 3. Time-based Happy Hour dynamic discounts & bonus loyalty multipliers
 */

const shamsi = require('./shamsi');
const walletEngine = require('./wallet-engine');

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
  const phone = String(user?.phone || '').trim();
  const digits = phone.slice(-4) || Math.floor(1000 + Math.random() * 9000);
  return `WESTO-${digits}`;
}

function ensureUserReferral(user) {
  if (!user) return '';
  if (!user.referralCode) {
    user.referralCode = generateReferralCode(user);
  }
  return user.referralCode;
}

function applyReferralCode(db, { inviteePhone, referralCode }) {
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
  const inviter = (db.users || []).find((u) => ensureUserReferral(u).toUpperCase() === code);
  if (!inviter) {
    throw Object.assign(new Error('کد معرف وارد شده معتبر نیست.'), { code: 'referral_code_not_found' });
  }

  if (inviter.phone === phone) {
    throw Object.assign(new Error('نمی‌توانید از کد معرف خودتان استفاده کنید.'), { code: 'self_referral_forbidden' });
  }

  db.referrals = db.referrals || [];
  const existing = db.referrals.find((r) => r.inviteePhone === phone);
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

  // Immediately award invitee welcome bonus
  if (config.inviteeRewardWalletToman > 0) {
    walletEngine.topupWallet(db, {
      phone,
      amountToman: config.inviteeRewardWalletToman,
      paymentMethod: 'referral_welcome',
      reference: `REF-WELCOME-${inviter.phone}`,
      actor: 'referral-system',
    });
  }

  const invitee = (db.users || []).find((u) => u.phone === phone);
  if (invitee && config.inviteeRewardPoints > 0) {
    invitee.points = (Number(invitee.points) || 0) + config.inviteeRewardPoints;
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

function checkAndRewardReferralOnOrder(db, order) {
  if (!order || !order.phone || !order.total) return null;
  const config = getCampaignConfig(db).referral;
  if (!config.enabled) return null;

  db.referrals = db.referrals || [];
  const referral = db.referrals.find((r) => r.inviteePhone === order.phone && r.status === 'registered');
  if (!referral) return null;

  const orderTotal = Math.max(0, Math.round(Number(order.total) || 0));
  if (orderTotal < (config.minOrderToUnlockToman || 0)) return null;

  // Unlock inviter reward
  referral.status = 'rewarded';
  referral.unlockedAt = new Date().toISOString();
  referral.qualifyingOrderId = order.id;

  if (config.inviterRewardWalletToman > 0) {
    walletEngine.topupWallet(db, {
      phone: referral.inviterPhone,
      amountToman: config.inviterRewardWalletToman,
      paymentMethod: 'referral_bonus',
      reference: `REF-BONUS-${order.id}`,
      actor: 'referral-system',
    });
  }

  const inviter = (db.users || []).find((u) => u.phone === referral.inviterPhone);
  if (inviter && config.inviterRewardPoints > 0) {
    inviter.points = (Number(inviter.points) || 0) + config.inviterRewardPoints;
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
  const cleanBirth = String(user.birthdate).trim().replace(/-/g, '/');
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

  // Calculate day difference within Shamsi calendar (simple month*30 + day distance)
  const currentDayIndex = (currentShamsiMonth - 1) * 30 + currentShamsiDay;
  const birthDayIndex = (bMonth - 1) * 30 + bDay;
  const diffDays = currentDayIndex - birthDayIndex;

  // Check window: windowDaysBefore <= diff <= windowDaysAfter
  const isWithinWindow = diffDays >= -(config.windowDaysBefore || 3) && diffDays <= (config.windowDaysAfter || 7);

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
    shamsiYear: currentShamsiYear,
    walletBonusToman: config.walletBonusToman,
    pointsBonus: config.pointsBonus,
    discountPct: config.discountPct,
    message: config.messageTemplate,
  };
}

function grantBirthdayGift(db, phone, now = new Date()) {
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
  user.lastBirthdayRewardYear = parts.year;

  // Credit wallet
  let walletResult = null;
  if (check.walletBonusToman > 0) {
    walletResult = walletEngine.topupWallet(db, {
      phone: user.phone,
      amountToman: check.walletBonusToman,
      paymentMethod: 'birthday_gift',
      reference: `HBD-${parts.year}-${user.phone.slice(-4)}`,
      actor: 'birthday-campaign',
    });
  }

  // Credit loyalty points
  if (check.pointsBonus > 0) {
    user.points = (Number(user.points) || 0) + check.pointsBonus;
  }

  // Record campaign log
  db.campaignLog = db.campaignLog || [];
  const logEntry = {
    id: db.campaignLog.length + 1,
    type: 'birthday',
    phone: user.phone,
    year: parts.year,
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

function checkHappyHourStatus(db, now = new Date()) {
  const config = getCampaignConfig(db).happyHour;
  if (!config.enabled) {
    return { active: false, config };
  }

  // Javascript getDay(): 0: Sunday, 1: Monday, 2: Tuesday, 3: Wednesday, 4: Thursday, 5: Friday, 6: Saturday
  const currentWeekday = now.getDay();
  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();
  const currentTotalMinutes = currentHour * 60 + currentMinute;

  const startTotalMinutes = (config.startHour || 0) * 60 + (config.startMinute || 0);
  const endTotalMinutes = (config.endHour || 0) * 60 + (config.endMinute || 0);

  const isDayActive = Array.isArray(config.activeDays) && config.activeDays.includes(currentWeekday);
  const isTimeActive = currentTotalMinutes >= startTotalMinutes && currentTotalMinutes < endTotalMinutes;

  const active = isDayActive && isTimeActive;
  const remainingMinutes = active ? endTotalMinutes - currentTotalMinutes : 0;

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
  generateReferralCode,
  ensureUserReferral,
  applyReferralCode,
  checkAndRewardReferralOnOrder,
  checkBirthdayEligibility,
  grantBirthdayGift,
  checkHappyHourStatus,
  summarizeCampaigns,
};
