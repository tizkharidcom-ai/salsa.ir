'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const campaignsEngine = require('../server/finance/campaigns-engine');

test('Campaigns Engine: Referral code registration, welcome bonus, and order unlock', () => {
  const db = {
    users: [
      { phone: '09121111111', name: 'سهراب سپهری', referralCode: 'WESTO-1111', points: 0, walletBalanceToman: 0 },
      { phone: '09122222222', name: 'نیما یوشیج', points: 0, walletBalanceToman: 0 },
    ],
    referrals: [],
    walletLedger: [],
  };

  // 1. Self referral must fail
  assert.throws(() => {
    campaignsEngine.applyReferralCode(db, {
      inviteePhone: '09121111111',
      referralCode: 'WESTO-1111',
    });
  }, /نمی‌توانید از کد معرف خودتان استفاده کنید/);

  // 2. Invitee applies referral code of 09121111111
  const applyRes = campaignsEngine.applyReferralCode(db, {
    inviteePhone: '09122222222',
    referralCode: 'WESTO-1111',
  });

  assert.equal(applyRes.ok, true);
  assert.equal(applyRes.inviterPhone, '09121111111');
  assert.equal(applyRes.inviteeRewardWalletToman, 50000);
  assert.equal(applyRes.inviteeRewardPoints, 100);

  // Invitee got welcome bonus in wallet
  const invitee = db.users.find((u) => u.phone === '09122222222');
  assert.equal(invitee.walletBalanceToman, 50000);
  assert.equal(invitee.points, 100);

  // 3. Invitee places an order below minimum threshold (e.g. 100,000 Toman) -> no inviter reward yet
  const smallOrder = { id: 201, phone: '09122222222', total: 100000 };
  const smallRes = campaignsEngine.checkAndRewardReferralOnOrder(db, smallOrder);
  assert.equal(smallRes, null);
  const inviter = db.users.find((u) => u.phone === '09121111111');
  assert.equal(inviter.walletBalanceToman, 0);

  // 4. Invitee places a qualifying order (e.g. 250,000 Toman >= 200,000 min) -> unlocks inviter reward
  const qualOrder = { id: 202, phone: '09122222222', total: 250000 };
  const rewardRes = campaignsEngine.checkAndRewardReferralOnOrder(db, qualOrder);
  assert.ok(rewardRes);
  assert.equal(rewardRes.rewarded, true);
  assert.equal(rewardRes.rewardWalletToman, 75000);
  assert.equal(rewardRes.rewardPoints, 150);

  assert.equal(inviter.walletBalanceToman, 75000);
  assert.equal(inviter.points, 150);
});

test('Campaigns Engine: Birthday eligibility, award, and prevention of double-award', () => {
  const now = new Date('2026-08-29T12:00:00Z'); // Shamsi date: 1405/06/07 (Shahrivar 7)
  const db = {
    users: [
      { phone: '09123333333', name: 'فروغ فرخزاد', birthdate: '1370/06/08', walletBalanceToman: 0, points: 0 },
      { phone: '09124444444', name: 'پروین اعتصامی', birthdate: '1372/10/15', walletBalanceToman: 0, points: 0 },
    ],
    walletLedger: [],
    campaignLog: [],
  };

  // 1. User with birthday tomorrow (06/08) should be eligible (within window)
  const checkEligible = campaignsEngine.checkBirthdayEligibility(db, db.users[0], now);
  assert.equal(checkEligible.eligible, true);
  assert.equal(checkEligible.walletBonusToman, 100000);
  assert.equal(checkEligible.pointsBonus, 200);

  // 2. User with birthday in Dey (10/15) should not be eligible now
  const checkNotEligible = campaignsEngine.checkBirthdayEligibility(db, db.users[1], now);
  assert.equal(checkNotEligible.eligible, false);

  // 3. Grant birthday reward to eligible user
  const grantRes = campaignsEngine.grantBirthdayGift(db, '09123333333', now);
  assert.equal(grantRes.ok, true);
  assert.equal(grantRes.walletBonusToman, 100000);
  assert.equal(grantRes.pointsBonus, 200);

  const user = db.users[0];
  assert.equal(user.walletBalanceToman, 100000);
  assert.equal(user.points, 200);
  assert.equal(user.lastBirthdayRewardYear, 1405);

  // 4. Second attempt in same Shamsi year must throw
  assert.throws(() => {
    campaignsEngine.grantBirthdayGift(db, '09123333333', now);
  }, /هدیه تولد سال 1405 قبلاً دریافت شده است/);
});

test('Campaigns Engine: Happy Hour time calculation and summaries', () => {
  const db = {
    campaigns: {
      happyHour: {
        enabled: true,
        activeDays: [6], // Saturday only
        startHour: 15,
        startMinute: 0,
        endHour: 18,
        endMinute: 0,
        discountPct: 20,
        pointsMultiplier: 2.0,
      },
    },
    referrals: [
      { id: 1, status: 'rewarded', inviterRewardWalletToman: 75000, inviteeRewardWalletToman: 50000 },
    ],
    campaignLog: [
      { id: 1, type: 'birthday', walletBonusToman: 100000, pointsBonus: 200 },
    ],
  };

  // Saturday at 16:30 -> Active
  const satAfternoon = new Date('2026-08-29T16:30:00');
  const activeStatus = campaignsEngine.checkHappyHourStatus(db, satAfternoon);
  assert.equal(activeStatus.active, true);
  assert.equal(activeStatus.discountPct, 20);
  assert.equal(activeStatus.pointsMultiplier, 2.0);

  // Saturday at 19:30 -> Inactive (outside window)
  const satNight = new Date('2026-08-29T19:30:00');
  const inactiveStatus = campaignsEngine.checkHappyHourStatus(db, satNight);
  assert.equal(inactiveStatus.active, false);

  // Summaries
  const summary = campaignsEngine.summarizeCampaigns(db);
  assert.equal(summary.stats.totalReferralsCount, 1);
  assert.equal(summary.stats.rewardedReferralsCount, 1);
  assert.equal(summary.stats.totalReferralRewardsToman, 125000);
  assert.equal(summary.stats.totalBirthdayGiftsCount, 1);
  assert.equal(summary.stats.totalBirthdayGiftsToman, 100000);
});
