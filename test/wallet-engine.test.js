'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const walletEngine = require('../server/finance/wallet-engine');

test('Wallet Engine: calculates topup bonuses correctly for packages and custom amounts', () => {
  const packages = walletEngine.DEFAULT_WALLET_PACKAGES;

  // Package 500k -> 50k bonus (10%)
  const bonus500k = walletEngine.calculateTopupBonus(500000, packages);
  assert.equal(bonus500k.bonusToman, 50000);
  assert.equal(bonus500k.bonusPct, 10);
  assert.equal(bonus500k.totalCreditToman, 550000);

  // Package 1M -> 150k bonus (15%)
  const bonus1M = walletEngine.calculateTopupBonus(1000000, packages);
  assert.equal(bonus1M.bonusToman, 150000);
  assert.equal(bonus1M.bonusPct, 15);
  assert.equal(bonus1M.totalCreditToman, 1150000);

  // Package 2M -> 400k bonus (20%)
  const bonus2M = walletEngine.calculateTopupBonus(2000000, packages);
  assert.equal(bonus2M.bonusToman, 400000);
  assert.equal(bonus2M.bonusPct, 20);
  assert.equal(bonus2M.totalCreditToman, 2400000);

  // Custom amount 3,000,000 -> 20% tier
  const custom3M = walletEngine.calculateTopupBonus(3000000, packages);
  assert.equal(custom3M.bonusToman, 600000);
  assert.equal(custom3M.bonusPct, 20);
  assert.equal(custom3M.totalCreditToman, 3600000);

  // Zero / low amount
  const zero = walletEngine.calculateTopupBonus(0, packages);
  assert.equal(zero.totalCreditToman, 0);
});

test('Wallet Engine: topup, pay, cashback and ledger operations work accurately', () => {
  const db = {
    users: [
      { phone: '09121111111', name: 'علی رضایی', walletBalanceToman: 0 },
    ],
    walletLedger: [],
  };

  // 1. Topup 1,000,000 Toman (should get +150,000 bonus = 1,150,000 total balance)
  const topupRes = walletEngine.topupWallet(db, {
    phone: '09121111111',
    amountToman: 1000000,
    packageId: 'pack-1m',
  });

  assert.equal(topupRes.ok, true);
  assert.equal(topupRes.totalCredit, 1150000);
  assert.equal(topupRes.newBalance, 1150000);
  assert.equal(walletEngine.getWalletBalance(db, '09121111111'), 1150000);
  assert.equal(db.walletLedger.length, 2); // 1 topup + 1 bonus

  // 2. Pay 350,000 Toman for an order
  const payRes = walletEngine.payFromWallet(db, {
    phone: '09121111111',
    amountToman: 350000,
    orderId: 101,
    orderNo: 'ORD-101',
  });

  assert.equal(payRes.ok, true);
  assert.equal(payRes.amountPaid, 350000);
  assert.equal(payRes.newBalance, 800000);
  assert.equal(walletEngine.getWalletBalance(db, '09121111111'), 800000);

  // 3. Award 5% Cashback on the 350,000 Toman order (+17,500)
  const cashbackRes = walletEngine.awardWalletCashback(db, {
    phone: '09121111111',
    amountToman: 17500,
    orderId: 101,
    cashbackPct: 5,
  });

  assert.equal(cashbackRes.ok, true);
  assert.equal(cashbackRes.amountCashback, 17500);
  assert.equal(cashbackRes.newBalance, 817500);
  assert.equal(walletEngine.getWalletBalance(db, '09121111111'), 817500);

  // 4. Overdraft attempt must throw
  assert.throws(() => {
    walletEngine.payFromWallet(db, {
      phone: '09121111111',
      amountToman: 900000,
      orderId: 102,
    });
  }, /موجودی کیف پول کافی نیست/);

  // 5. Admin manual adjustment (+50,000)
  const adjRes = walletEngine.adjustWallet(db, {
    phone: '09121111111',
    deltaToman: 50000,
    reason: 'پاداش وفاداری ویژه',
  });
  assert.equal(adjRes.newBalance, 867500);
  assert.equal(walletEngine.getWalletBalance(db, '09121111111'), 867500);
});

test('Wallet Engine: summarizes wallet totals and active balances', () => {
  const db = {
    users: [
      { phone: '09121111111', walletBalanceToman: 500000 },
      { phone: '09122222222', walletBalanceToman: 1200000 },
      { phone: '09123333333', walletBalanceToman: 0 },
    ],
    walletLedger: [
      { id: 1, phone: '09121111111', delta: 500000, balance: 500000, type: 'topup', at: '2026-08-29T10:00:00Z' },
      { id: 2, phone: '09122222222', delta: 1000000, balance: 1000000, type: 'topup', at: '2026-08-29T10:00:00Z' },
      { id: 3, phone: '09122222222', delta: 200000, balance: 1200000, type: 'bonus', at: '2026-08-29T10:00:00Z' },
      { id: 4, phone: '09121111111', delta: -100000, balance: 400000, type: 'payment', at: '2026-08-29T11:00:00Z' },
    ],
  };

  const summary = walletEngine.summarizeWallet(db);
  assert.equal(summary.totalLiabilityToman, 1700000);
  assert.equal(summary.activeWalletsCount, 2);
  assert.equal(summary.totalTopupsVolumeToman, 1700000);
  assert.equal(summary.totalPaymentsVolumeToman, 100000);
  assert.equal(summary.membersWithBalance.length, 2);
});
