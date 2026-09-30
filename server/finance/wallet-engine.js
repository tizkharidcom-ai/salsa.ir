'use strict';

/**
 * WESTO Customer Wallet & Cashback Engine
 *
 * Implements customer credit top-ups, bonus gifts, order payments from wallet,
 * cashbacks, refunds, and immutable double-entry ledger tracking.
 */

const DEFAULT_WALLET_PACKAGES = Object.freeze([
  {
    id: 'pack-500k',
    title: 'بسته پایه برنزی',
    amountToman: 500_000,
    priceToman: 500_000,
    bonusToman: 50_000,
    bonusPct: 10,
    totalCreditToman: 550_000,
    popular: false,
    badge: '۱۰٪ هدیه',
    description: 'شارژ ۵۰۰ هزار تومان + ۵۰ هزار تومان اعتبار هدیه',
  },
  {
    id: 'pack-1m',
    title: 'بسته نقره‌ای محبوب',
    amountToman: 1_000_000,
    priceToman: 1_000_000,
    bonusToman: 150_000,
    bonusPct: 15,
    totalCreditToman: 1_150_000,
    popular: true,
    badge: '۱۵٪ هدیه ویژه',
    description: 'شارژ ۱ میلیون تومان + ۱۵۰ هزار تومان اعتبار هدیه',
  },
  {
    id: 'pack-2m',
    title: 'بسته طلایی ویژه',
    amountToman: 2_000_000,
    priceToman: 2_000_000,
    bonusToman: 400_000,
    bonusPct: 20,
    totalCreditToman: 2_400_000,
    popular: false,
    badge: '۲۰٪ هدیه اعتباری',
    description: 'شارژ ۲ میلیون تومان + ۴۰۰ هزار تومان اعتبار هدیه',
  },
  {
    id: 'pack-5m',
    title: 'بسته الماس VIP',
    amountToman: 5_000_000,
    priceToman: 5_000_000,
    bonusToman: 1_250_000,
    bonusPct: 25,
    totalCreditToman: 6_250_000,
    popular: false,
    badge: '۲۵٪ هدیه اختصاصی',
    description: 'شارژ ۵ میلیون تومان + ۱٫۲۵ میلیون تومان هدیه VIP',
  },
]);

function getWalletPackages(db) {
  if (Array.isArray(db?.walletPackages) && db.walletPackages.length > 0) {
    return db.walletPackages;
  }
  return DEFAULT_WALLET_PACKAGES.map((p) => ({ ...p }));
}

function calculateTopupBonus(amountToman, packages = DEFAULT_WALLET_PACKAGES) {
  const amount = Math.max(0, Math.round(Number(amountToman) || 0));
  if (!amount) return { bonusToman: 0, bonusPct: 0, totalCreditToman: 0 };

  // Check if matches an exact package
  const matchedPack = packages.find((p) => p.amountToman === amount);
  if (matchedPack) {
    return {
      bonusToman: matchedPack.bonusToman || 0,
      bonusPct: matchedPack.bonusPct || 0,
      totalCreditToman: amount + (matchedPack.bonusToman || 0),
      packageId: matchedPack.id,
    };
  }

  // Dynamic tiers
  let bonusPct = 0;
  if (amount >= 5_000_000) bonusPct = 25;
  else if (amount >= 2_000_000) bonusPct = 20;
  else if (amount >= 1_000_000) bonusPct = 15;
  else if (amount >= 500_000) bonusPct = 10;
  else if (amount >= 200_000) bonusPct = 5;

  const bonusToman = Math.round((amount * bonusPct) / 100);
  return {
    bonusToman,
    bonusPct,
    totalCreditToman: amount + bonusToman,
    packageId: null,
  };
}

function findOrCreateUser(db, phone) {
  const normalizedPhone = String(phone || '').trim();
  if (!normalizedPhone) return null;
  let user = (db.users || []).find((u) => u.phone === normalizedPhone);
  if (!user) {
    user = {
      phone: normalizedPhone,
      name: '',
      email: '',
      role: 'user',
      points: 0,
      walletBalanceToman: 0,
      createdAt: new Date().toISOString(),
      blocked: false,
    };
    db.users = db.users || [];
    db.users.push(user);
  }
  if (typeof user.walletBalanceToman !== 'number') {
    user.walletBalanceToman = Math.max(0, Math.round(Number(user.walletBalance) || 0));
  }
  return user;
}

function getWalletBalance(db, phone) {
  const user = (db.users || []).find((u) => u.phone === String(phone || '').trim());
  return Math.max(0, Math.round(Number(user?.walletBalanceToman ?? user?.walletBalance) || 0));
}

function appendWalletLedger(db, entry) {
  db.walletLedger = db.walletLedger || [];
  const nextId = Math.max(0, ...db.walletLedger.map((e) => Number(e.id) || 0), 0) + 1;
  const ledgerItem = {
    id: nextId,
    phone: String(entry.phone || '').trim(),
    delta: Math.round(Number(entry.delta) || 0),
    balance: Math.max(0, Math.round(Number(entry.balance) || 0)),
    type: String(entry.type || 'adjustment').trim(),
    orderId: entry.orderId ? Number(entry.orderId) : null,
    description: String(entry.description || '').slice(0, 160),
    meta: entry.meta || {},
    at: entry.at || new Date().toISOString(),
  };
  db.walletLedger.unshift(ledgerItem);
  db.walletLedger = db.walletLedger.slice(0, 5000);
  return ledgerItem;
}

function topupWallet(db, { phone, amountToman, packageId = null, paymentMethod = 'online', reference = null, actor = 'customer', bonusToman }) {
  const amount = Math.max(0, Math.round(Number(amountToman) || 0));
  if (!amount || !phone) {
    throw Object.assign(new Error('مبلغ شارژ و شماره موبایل الزامی است.'), { code: 'wallet_topup_invalid' });
  }

  const user = findOrCreateUser(db, phone);
  if (!user) {
    throw Object.assign(new Error('کاربر یافت نشد.'), { code: 'user_not_found' });
  }

  const packages = getWalletPackages(db);
  const bonusInfo = bonusToman === undefined ? calculateTopupBonus(amount, packages) : {
    bonusToman: Number(bonusToman), bonusPct: Number(bonusToman) * 100 / amount,
    totalCreditToman: amount + Number(bonusToman),
  };
  if (!Number.isSafeInteger(bonusInfo.bonusToman) || bonusInfo.bonusToman < 0 || !Number.isSafeInteger(bonusInfo.totalCreditToman)) {
    throw Object.assign(new Error('پاداش شارژ تأییدشده معتبر نیست.'), { code: 'wallet_bonus_invalid' });
  }
  const totalCredit = bonusInfo.totalCreditToman;

  user.walletBalanceToman = (user.walletBalanceToman || 0) + totalCredit;

  // Record Topup entry
  const topupEntry = appendWalletLedger(db, {
    phone,
    delta: amount,
    balance: user.walletBalanceToman - bonusInfo.bonusToman,
    type: 'topup',
    description: `شارژ آنلاین کیف پول ${packageId ? `(${packageId})` : ''}`,
    meta: { paymentMethod, reference, packageId, actor },
  });

  // Record Bonus entry if applicable
  let bonusEntry = null;
  if (bonusInfo.bonusToman > 0) {
    bonusEntry = appendWalletLedger(db, {
      phone,
      delta: bonusInfo.bonusToman,
      balance: user.walletBalanceToman,
      type: 'bonus',
      description: `اعتبار هدیه شارژ (${bonusInfo.bonusPct}٪)`,
      meta: { packageId, baseTopupId: topupEntry.id, bonusPct: bonusInfo.bonusPct },
    });
  }

  return {
    ok: true,
    phone,
    amountTopup: amount,
    bonusToman: bonusInfo.bonusToman,
    bonusPct: bonusInfo.bonusPct,
    totalCredit,
    newBalance: user.walletBalanceToman,
    topupEntry,
    bonusEntry,
  };
}

function payFromWallet(db, { phone, amountToman, orderId, orderNo = null, actor = 'customer' }) {
  const amount = Math.max(0, Math.round(Number(amountToman) || 0));
  if (!amount || !phone) {
    throw Object.assign(new Error('مبلغ پرداخت و شماره همراه الزامی است.'), { code: 'wallet_payment_invalid' });
  }

  const user = findOrCreateUser(db, phone);
  const currentBalance = user?.walletBalanceToman || 0;

  if (currentBalance < amount) {
    const shortage = amount - currentBalance;
    throw Object.assign(
      new Error(`موجودی کیف پول کافی نیست. موجودی: ${currentBalance.toLocaleString('fa-IR')} تومان (کسری: ${shortage.toLocaleString('fa-IR')} تومان)`),
      { code: 'wallet_insufficient_funds', currentBalance, shortage, required: amount }
    );
  }

  user.walletBalanceToman = currentBalance - amount;

  const paymentEntry = appendWalletLedger(db, {
    phone,
    delta: -amount,
    balance: user.walletBalanceToman,
    type: 'payment',
    orderId,
    description: `پرداخت سفارش ${orderNo || orderId || ''}`,
    meta: { orderId, orderNo, actor },
  });

  return {
    ok: true,
    phone,
    amountPaid: amount,
    newBalance: user.walletBalanceToman,
    paymentEntry,
  };
}

function refundToWallet(db, { phone, amountToman, orderId, reason = 'مرجوعی سفارش', actor = 'admin' }) {
  const amount = Math.max(0, Math.round(Number(amountToman) || 0));
  if (!amount || !phone) return null;

  const user = findOrCreateUser(db, phone);
  user.walletBalanceToman = (user.walletBalanceToman || 0) + amount;

  const refundEntry = appendWalletLedger(db, {
    phone,
    delta: amount,
    balance: user.walletBalanceToman,
    type: 'refund',
    orderId,
    description: `استرداد وجه سفارش: ${reason}`,
    meta: { orderId, reason, actor },
  });

  return {
    ok: true,
    phone,
    amountRefunded: amount,
    newBalance: user.walletBalanceToman,
    refundEntry,
  };
}

function awardWalletCashback(db, { phone, amountToman, orderId, cashbackPct = 3, actor = 'system' }) {
  const amount = Math.max(0, Math.round(Number(amountToman) || 0));
  if (!amount || !phone) return null;

  const user = findOrCreateUser(db, phone);
  user.walletBalanceToman = (user.walletBalanceToman || 0) + amount;

  const cashbackEntry = appendWalletLedger(db, {
    phone,
    delta: amount,
    balance: user.walletBalanceToman,
    type: 'cashback',
    orderId,
    description: `پاداش نقدی سفارش (${cashbackPct}٪)`,
    meta: { orderId, cashbackPct, actor },
  });

  return {
    ok: true,
    phone,
    amountCashback: amount,
    newBalance: user.walletBalanceToman,
    cashbackEntry,
  };
}

function adjustWallet(db, { phone, deltaToman, reason = 'تعدیل دستی مدیریت', actor = 'admin' }) {
  const delta = Math.round(Number(deltaToman) || 0);
  if (!delta || !phone) {
    throw Object.assign(new Error('مبلغ تغییر و شماره مشتری الزامی است.'), { code: 'wallet_adjust_invalid' });
  }

  const user = findOrCreateUser(db, phone);
  const nextBalance = Math.max(0, (user.walletBalanceToman || 0) + delta);
  const actualDelta = nextBalance - (user.walletBalanceToman || 0);

  user.walletBalanceToman = nextBalance;

  const adjustEntry = appendWalletLedger(db, {
    phone,
    delta: actualDelta,
    balance: user.walletBalanceToman,
    type: 'adjustment',
    description: String(reason || 'تعدیل دستی').slice(0, 120),
    meta: { actor },
  });

  return {
    ok: true,
    phone,
    delta: actualDelta,
    newBalance: user.walletBalanceToman,
    adjustEntry,
  };
}

function summarizeWallet(db) {
  const users = (db.users || []).map((u) => ({
    phone: u.phone,
    name: u.name || '',
    balance: Math.max(0, Math.round(Number(u.walletBalanceToman ?? u.walletBalance) || 0)),
  }));

  const membersWithBalance = users.filter((u) => u.balance > 0);
  const totalLiability = membersWithBalance.reduce((s, u) => s + u.balance, 0);

  const ledger = (db.walletLedger || []).slice(0, 100);
  const topups = (db.walletLedger || []).filter((e) => e.type === 'topup' || e.type === 'bonus');
  const payments = (db.walletLedger || []).filter((e) => e.type === 'payment');

  return {
    totalLiabilityToman: totalLiability,
    activeWalletsCount: membersWithBalance.length,
    totalTopupsVolumeToman: topups.reduce((s, e) => s + (e.delta > 0 ? e.delta : 0), 0),
    totalPaymentsVolumeToman: payments.reduce((s, e) => s + Math.abs(e.delta), 0),
    packages: getWalletPackages(db),
    membersWithBalance: membersWithBalance.sort((a, b) => b.balance - a.balance).slice(0, 50),
    recentLedger: ledger,
  };
}

module.exports = {
  DEFAULT_WALLET_PACKAGES,
  getWalletPackages,
  calculateTopupBonus,
  findOrCreateUser,
  getWalletBalance,
  topupWallet,
  payFromWallet,
  refundToWallet,
  awardWalletCashback,
  adjustWallet,
  summarizeWallet,
};
