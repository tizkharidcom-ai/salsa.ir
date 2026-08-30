'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const smsEngine = require('../server/finance/sms-engine');

test('SMS Engine: Dynamic Template Rendering with Smart Merge Tags', () => {
  const tpl = '{name} عزیز، سالروز تولدتان مبارک! 🎁 مبلغ {amount} تومان شارژ شدید. موجودی: {wallet_balance} تومان.';
  const rendered = smsEngine.renderTemplate(tpl, {
    name: 'سهراب سپهری',
    amount: 100000,
    wallet_balance: 250000,
  });

  assert.ok(rendered.includes('سهراب سپهری'));
  assert.ok(rendered.includes('مبلغ ۱۰۰٬۰۰۰ تومان'));
  assert.ok(rendered.includes('موجودی: ۲۵۰٬۰۰۰ تومان'));
});

test('SMS Engine: Message validation, multi-provider simulation, and log persistence', async () => {
  const db = {
    smsConfig: {
      enabled: true,
      provider: 'simulator',
      costPerSmsIrr: 1200,
    },
    smsLog: [],
  };

  // 1. Invalid phone number rejection
  await assert.rejects(
    async () => {
      await smsEngine.sendSms(db, { phone: '123', customText: 'تست' });
    },
    { code: 'sms_phone_invalid' }
  );

  // 2. Valid simulated send
  const sendRes = await smsEngine.sendSms(db, {
    phone: '09121234567',
    name: 'نیما یوشیج',
    templateKey: 'birthday',
    vars: { amount: 100000 },
    triggerType: 'event',
  });

  assert.equal(sendRes.ok, true);
  assert.equal(sendRes.status, 'simulated');
  assert.equal(sendRes.phone, '09121234567');
  assert.equal(db.smsLog.length, 1);
  assert.equal(db.smsLog[0].templateKey, 'birthday');
  assert.equal(db.smsLog[0].costToman, 120);
});

test('SMS Engine: RFM Customer Segmentation & Automated Win-Back Execution', async () => {
  const now = new Date('2026-08-29T12:00:00Z');
  const d35DaysAgo = new Date('2026-07-25T12:00:00Z').toISOString();
  const d100DaysAgo = new Date('2026-05-20T12:00:00Z').toISOString();
  const d5DaysAgo = new Date('2026-08-24T12:00:00Z').toISOString();

  const db = {
    users: [
      { phone: '09121111111', name: 'مشتری فعال', walletBalanceToman: 0, points: 50 },
      { phone: '09122222222', name: 'مشتری در خطر ریزش', walletBalanceToman: 0, points: 10 },
      { phone: '09123333333', name: 'مشتری خواب‌رفته', walletBalanceToman: 0, points: 0 },
    ],
    orders: [
      { id: 1, phone: '09121111111', total: 400000, createdAt: d5DaysAgo },
      { id: 2, phone: '09122222222', total: 300000, createdAt: d35DaysAgo },
      { id: 3, phone: '09123333333', total: 200000, createdAt: d100DaysAgo },
    ],
    walletLedger: [],
    smsLog: [],
  };

  // 1. Calculate RFM Segmentation
  const rfm = smsEngine.calculateCustomerRfm(db, now);
  assert.equal(rfm.summary.totalCustomers, 3);
  assert.equal(rfm.atRisk.length, 1);
  assert.equal(rfm.atRisk[0].phone, '09122222222');
  assert.equal(rfm.dormant.length, 1);
  assert.equal(rfm.dormant[0].phone, '09123333333');

  // 2. Execute Win-back Campaign for At-Risk customers with 50,000 Toman wallet incentive
  const winbackRes = await smsEngine.executeWinbackCampaign(db, {
    segment: 'at_risk',
    rewardWalletToman: 50000,
    maxRecipients: 10,
  });

  assert.equal(winbackRes.ok, true);
  assert.equal(winbackRes.sentCount, 1);
  assert.equal(winbackRes.rewardDisbursedTotalToman, 50000);

  // User received wallet credit
  const atRiskUser = db.users.find((u) => u.phone === '09122222222');
  assert.equal(atRiskUser.walletBalanceToman, 50000);

  // SMS log created for winback
  assert.equal(db.smsLog.length, 1);
  assert.equal(db.smsLog[0].templateKey, 'winback_inactive');
  assert.equal(db.smsLog[0].triggerType, 'automated_rfm');

  // 3. Summarize engine stats
  const summary = smsEngine.summarizeSmsEngine(db);
  assert.equal(summary.stats.totalSentCount, 1);
  assert.equal(summary.stats.totalCostToman, 120);
});
