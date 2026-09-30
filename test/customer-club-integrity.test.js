'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const wallet = require('../server/finance/wallet-engine');
const campaigns = require('../server/finance/campaigns-engine');
const loyalty = require('../server/finance/loyalty-engine');
const program = require('../server/finance/club-program');
const sms = require('../server/finance/sms-engine');

test('a zero points rate means zero; disabling redemption prevents spending points', () => {
  const db = { loyalty: { enabled: true, pointsPerToman: 0, redeemValue: 0 }, users: [] };
  assert.equal(loyalty.calculateOrderPointsEarned(db, 100000, { multiplier: 2 }), 0);
  assert.equal(loyalty.calculateOrderDiscounts(db, { subtotalToman: 100000, user: { points: 100 }, redeemPoints: 5 }).pointsRedeemed, 0);
});

test('wallet credit honors the approved bonus snapshot even if packages changed', () => {
  const db = { users: [{ phone: '09121112222', walletBalanceToman: 0 }], walletPackages: [{ id: 'custom', amountToman: 500000, bonusToman: 100000 }] };
  const result = wallet.topupWallet(db, { phone: '09121112222', amountToman: 500000, bonusToman: 20000, paymentMethod: 'cash' });
  assert.equal(result.bonusToman, 20000);
  assert.equal(result.newBalance, 520000);
  const gift = wallet.topupWallet(db, { phone: '09121112222', amountToman: 500000, bonusToman: 0, paymentMethod: 'birthday_gift' });
  assert.equal(gift.bonusToman, 0, 'a campaign journal for 500000 cannot create 600000 wallet liability');
});

test('manual points retain exact deltas, preserve history and reject overdrafts', () => {
  const user = { phone: '09121112222', points: 5 };
  const db = { users: [user], loyaltyLedger: Array.from({ length: 2100 }, (_, id) => ({ id })) };
  assert.throws(() => program.appendPoints(db, user, -6, 'manual'), /کافی/);
  const entry = program.appendPoints(db, user, -3, 'manual', { key: 'adjust-0001' });
  assert.equal(entry.balance, 2);
  assert.equal(db.loyaltyLedger.length, 2101);
  assert.equal(program.appendPoints(db, user, -3, 'manual', { key: 'adjust-0001' }).id, entry.id);
  assert.equal(user.points, 2);
});

test('campaign admin aliases map to the exact engine fields and invalid values fail', () => {
  const db = { campaigns: { birthday: { enabled: false } } };
  const config = campaigns.normalizeCampaignConfig(db, {
    birthday: { enabled: true, rewardWalletToman: 125000, rewardPoints: 15, validDaysAfter: 0 },
    referral: { referrerRewardWalletToman: 123, refereeRewardWalletToman: 456, minFirstOrderToman: 700000 },
    happyHour: { startHour: '16:30', endHour: '18:15' },
  });
  assert.equal(config.birthday.walletBonusToman, 125000);
  assert.equal(config.birthday.pointsBonus, 15);
  assert.equal(config.birthday.windowDaysAfter, 0);
  assert.equal(config.referral.inviterRewardWalletToman, 123);
  assert.equal(config.referral.minOrderToUnlockToman, 700000);
  assert.equal(config.happyHour.startMinute, 30);
  assert.throws(() => campaigns.normalizeCampaignConfig(db, { birthday: { pointsBonus: -1 } }));
});

test('birthday reference and referral codes do not collide for equal last-four digits', () => {
  assert.notEqual(campaigns.generateReferralCode({ phone: '09121112222' }), campaigns.generateReferralCode({ phone: '09351112222' }));
});

test('SMS does not claim delivery without a provider adapter or bill for simulation', async () => {
  const db = { smsConfig: { enabled: true, provider: 'kavenegar', apiKey: 'test-only-not-a-real-key' } };
  const result = await sms.sendSms(db, { phone: '09121112222', customText: 'test' });
  assert.equal(result.ok, false);
  assert.notEqual(result.status, 'sent');
  const simulation = await sms.sendSms({ smsConfig: { enabled: true, provider: 'simulator' } }, { phone: '09121112222', customText: 'test' });
  assert.equal(simulation.status, 'simulated');
  assert.equal(simulation.costToman, 0);
});
