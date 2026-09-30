'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const loyaltyEngine = require('../server/finance/loyalty-engine');

const customTiers = () => loyaltyEngine.DEFAULT_LOYALTY_TIERS.map((tier) => ({ ...tier, perks: [...tier.perks] }));

test('normalizes editable loyalty tier identity, color, thresholds, rewards, and perks', () => {
  const tiers = customTiers();
  tiers[1] = {
    ...tiers[1],
    name: '  نقره‌ای   پلاس  ',
    badgeIcon: '🌙',
    color: '#12aBcD',
    minPoints: '600',
    minSpendToman: '2500000',
    multiplier: '1.4',
    discountPct: '3.5',
    perks: [' ارسال رایگان ', '', 'هدیه تولد'],
  };

  const normalized = loyaltyEngine.normalizeLoyaltyTiers(tiers);
  assert.deepEqual(normalized[1], {
    id: 'silver',
    name: 'نقره‌ای پلاس',
    badgeIcon: '🌙',
    color: '#12aBcD',
    minPoints: 600,
    minSpendToman: 2_500_000,
    multiplier: 1.4,
    discountPct: 3.5,
    perks: ['ارسال رایگان', 'هدیه تولد'],
  });
});

test('rejects ambiguous tier names, IDs, and non-progressive thresholds', () => {
  const duplicateName = customTiers();
  duplicateName[1].name = duplicateName[0].name;
  assert.throws(() => loyaltyEngine.normalizeLoyaltyTiers(duplicateName), { code: 'duplicate_tier_name' });

  const duplicateId = customTiers();
  duplicateId[1].id = duplicateId[0].id;
  assert.throws(() => loyaltyEngine.normalizeLoyaltyTiers(duplicateId), { code: 'duplicate_tier_id' });

  const descending = customTiers();
  descending[2].minSpendToman = 1_000_000;
  assert.throws(() => loyaltyEngine.normalizeLoyaltyTiers(descending), { code: 'tier_thresholds_out_of_order' });

  const noBase = customTiers();
  noBase[0].minPoints = 1;
  assert.throws(() => loyaltyEngine.normalizeLoyaltyTiers(noBase), { code: 'base_tier_threshold_required' });
});

test('custom tier order consistently drives member level and next-level progress', () => {
  const tiers = loyaltyEngine.normalizeLoyaltyTiers([
    { id: 'base', name: 'پایه', minPoints: 0, minSpendToman: 0, color: '#8b5cf6', badgeIcon: '🌱' },
    { id: 'regular', name: 'همراه', minPoints: 250, minSpendToman: 1_000_000, multiplier: 1.2, discountPct: 2, color: '#0ea5e9', badgeIcon: '🌊' },
    { id: 'elite', name: 'ویژه پلاس', minPoints: 900, minSpendToman: 5_000_000, multiplier: 1.8, discountPct: 6, color: '#f59e0b', badgeIcon: '⭐' },
  ]);
  const db = { loyalty: { tiers } };

  const member = loyaltyEngine.resolveCustomerTier(db, { points: 400, totalSpendToman: 1_500_000 });
  assert.equal(member.tier.name, 'همراه');
  assert.equal(member.nextTier.name, 'ویژه پلاس');
  assert.equal(member.multiplier, 1.2);
  assert.equal(member.discountPct, 2);

  assert.equal(loyaltyEngine.resolveCustomerTier(db, { points: 1_000, totalSpendToman: 0 }).tier.name, 'ویژه پلاس');
  assert.equal(loyaltyEngine.resolveCustomerTier(db, { points: 0, totalSpendToman: 6_000_000 }).tier.name, 'ویژه پلاس');
});
