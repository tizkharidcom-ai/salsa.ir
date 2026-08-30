'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const loyaltyEngine = require('../server/finance/loyalty-engine');
const walletEngine = require('../server/finance/wallet-engine');

test('Loyalty Integration: calculateOrderDiscounts calculates tier discount and points redemption accurately', () => {
  const db = {
    loyalty: {
      enabled: true,
      redeemValue: 1000,
      pointsPerToman: 0.01,
      tiers: [
        { id: 'bronze', name: 'برنزی', minPoints: 0, minSpendToman: 0, discountPct: 1, multiplier: 1.0 },
        { id: 'gold', name: 'طلایی', minPoints: 2000, minSpendToman: 10_000_000, discountPct: 5, multiplier: 1.5 },
      ],
    },
    users: [
      { phone: '09121111111', name: 'مشتری طلایی', points: 300, totalSpendToman: 12_000_000 },
      { phone: '09122222222', name: 'مشتری برنزی', points: 50, totalSpendToman: 500_000 },
    ],
  };

  // 1. Gold customer with 5% tier discount + 200 points redemption on a 1,000,000 Toman order
  const goldCalc = loyaltyEngine.calculateOrderDiscounts(db, {
    subtotalToman: 1_000_000,
    phone: '09121111111',
    redeemPoints: 200,
  });

  assert.equal(goldCalc.tier.id, 'gold');
  assert.equal(goldCalc.tierDiscountPct, 5);
  assert.equal(goldCalc.tierDiscountToman, 50_000); // 5% of 1,000,000
  assert.equal(goldCalc.pointsRedeemed, 200);
  assert.equal(goldCalc.pointsDiscountToman, 200_000); // 200 pts * 1000 Toman
  assert.equal(goldCalc.totalDiscountToman, 250_000);
  assert.equal(goldCalc.finalPayable, 750_000);

  // 2. Customer tries to redeem more points than available
  const overRedeem = loyaltyEngine.calculateOrderDiscounts(db, {
    subtotalToman: 1_000_000,
    phone: '09122222222', // only has 50 points
    redeemPoints: 500,
  });

  assert.equal(overRedeem.pointsRedeemed, 50); // Capped to 50
  assert.equal(overRedeem.pointsDiscountToman, 50_000);
  assert.equal(overRedeem.tierDiscountToman, 10_000); // 1% of 1,000,000
  assert.equal(overRedeem.totalDiscountToman, 60_000);
  assert.equal(overRedeem.finalPayable, 940_000);
});

test('Cashier POS & Wallet Integration: Wallet payment tender in settlement', () => {
  const db = {
    users: [
      { phone: '09123333333', name: 'مشتری با کیف پول', walletBalanceToman: 400000 },
    ],
    walletLedger: [],
  };

  const initialBal = walletEngine.getWalletBalance(db, '09123333333');
  assert.equal(initialBal, 400000);

  // Pay 250,000 Toman from wallet
  const payRes = walletEngine.payFromWallet(db, {
    phone: '09123333333',
    amountToman: 250000,
    orderId: 901,
    actor: 'cashier',
  });

  assert.equal(payRes.ok, true);
  assert.equal(payRes.newBalance, 150000);
  assert.equal(walletEngine.getWalletBalance(db, '09123333333'), 150000);
});
