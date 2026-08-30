'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const loyaltyEngine = require('../server/finance/loyalty-engine');

test('Loyalty Engine: resolves customer tier based on points or total spend', () => {
  const db = {
    loyalty: {
      enabled: true,
      pointsPerToman: 0.01,
      redeemValue: 1000,
    },
  };

  // 1. Bronze customer (default base)
  const bronze = loyaltyEngine.resolveCustomerTier(db, { points: 100, totalSpendToman: 500000 });
  assert.equal(bronze.tier.id, 'bronze');
  assert.equal(bronze.multiplier, 1.0);
  assert.equal(bronze.discountPct, 1);
  assert.equal(bronze.nextTier.id, 'silver');
  assert.equal(bronze.pointsToNext, 400); // 500 - 100

  // 2. Silver customer by points
  const silverByPoints = loyaltyEngine.resolveCustomerTier(db, { points: 650, totalSpendToman: 1000000 });
  assert.equal(silverByPoints.tier.id, 'silver');
  assert.equal(silverByPoints.multiplier, 1.25);
  assert.equal(silverByPoints.discountPct, 3);
  assert.equal(silverByPoints.nextTier.id, 'gold');

  // 3. Silver customer by spend
  const silverBySpend = loyaltyEngine.resolveCustomerTier(db, { points: 50, totalSpendToman: 3000000 });
  assert.equal(silverBySpend.tier.id, 'silver');

  // 4. Gold customer
  const gold = loyaltyEngine.resolveCustomerTier(db, { points: 2500, totalSpendToman: 12000000 });
  assert.equal(gold.tier.id, 'gold');
  assert.equal(gold.multiplier, 1.5);
  assert.equal(gold.discountPct, 5);
  assert.equal(gold.nextTier.id, 'vip');

  // 5. VIP Diamond customer
  const vip = loyaltyEngine.resolveCustomerTier(db, { points: 6000, totalSpendToman: 30000000 });
  assert.equal(vip.tier.id, 'vip');
  assert.equal(vip.multiplier, 2.0);
  assert.equal(vip.discountPct, 8);
  assert.equal(vip.nextTier, null);
  assert.equal(vip.progressPct, 100);
});

test('Loyalty Engine: calculates multiplied order points and tier discount correctly', () => {
  const db = {
    loyalty: {
      enabled: true,
      pointsPerToman: 0.01,
    },
  };

  const bronzeTier = { id: 'bronze', multiplier: 1.0, discountPct: 1 };
  const goldTier = { id: 'gold', multiplier: 1.5, discountPct: 5 };
  const vipTier = { id: 'vip', multiplier: 2.0, discountPct: 8 };

  // Discount calculations
  assert.equal(loyaltyEngine.calculateOrderLoyaltyDiscount(1_000_000, bronzeTier), 10_000);
  assert.equal(loyaltyEngine.calculateOrderLoyaltyDiscount(1_000_000, goldTier), 50_000);
  assert.equal(loyaltyEngine.calculateOrderLoyaltyDiscount(1_000_000, vipTier), 80_000);

  // Points earned calculation with multiplier (1,000,000 * 0.01 = 10,000 base)
  assert.equal(loyaltyEngine.calculateOrderPointsEarned(db, 1_000_000, bronzeTier), 10_000);
  assert.equal(loyaltyEngine.calculateOrderPointsEarned(db, 1_000_000, goldTier), 15_000);
  assert.equal(loyaltyEngine.calculateOrderPointsEarned(db, 1_000_000, vipTier), 20_000);
});

test('Loyalty Engine: summarizes membership distribution across tiers', () => {
  const db = { loyalty: { enabled: true } };
  const sampleCustomers = [
    { points: 50, total: 100000 },
    { points: 600, total: 2500000 },
    { points: 750, total: 4000000 },
    { points: 3000, total: 15000000 },
    { points: 8000, total: 45000000 },
  ];

  const summary = loyaltyEngine.summarizeTiersMembership(db, sampleCustomers);
  assert.equal(summary.length, 4);

  const bronze = summary.find((t) => t.id === 'bronze');
  const silver = summary.find((t) => t.id === 'silver');
  const gold = summary.find((t) => t.id === 'gold');
  const vip = summary.find((t) => t.id === 'vip');

  assert.equal(bronze.memberCount, 1);
  assert.equal(silver.memberCount, 2);
  assert.equal(gold.memberCount, 1);
  assert.equal(vip.memberCount, 1);
});
