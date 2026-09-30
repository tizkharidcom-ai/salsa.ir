'use strict';

const program = require('./finance/club-program');
const campaigns = require('./finance/campaigns-engine');
const queues = new WeakMap();

function createCustomerClub({ getDb, save, snapshot, restore, creditWallet, parseBranchId, walletEngine, loyaltyEngine, recordAudit }) {
  async function transaction(req, res, operation) {
    const database = getDb();
    const previous = queues.get(database) || Promise.resolve();
    let release;
    const pending = new Promise((resolve) => { release = resolve; });
    queues.set(database, pending);
    await previous.catch(() => {});
    const before = snapshot();
    try {
      const result = operation(database);
      const persisted = await save({ requireDurable: true });
      if (persisted !== true) program.fail('club_persistence_unconfirmed', 'ذخیرهٔ تغییرات تأیید نشد.', 503);
      return res.json({ ok: true, ...result });
    } catch (error) {
      restore(before);
      return res.status(error.status || 400).json({ error: error.code || 'club_mutation_failed', message: error.message });
    } finally {
      release();
      if (queues.get(database) === pending) queues.delete(database);
    }
  }
  const configure = (key, normalize, action) => (req, res) => transaction(req, res, (db) => {
    const value = normalize(req.body, db);
    if (key.startsWith('loyalty.')) {
      db.loyalty ||= {};
      db.loyalty[key.split('.')[1]] = value;
    } else if (key === 'loyalty') db.loyalty = { ...db.loyalty, ...value };
    else db[key] = value;
    recordAudit(req, action, 'customer_club', key, {}, null, { deferAppend: true });
    return { [key.split('.').at(-1)]: value };
  });
  const handlers = {
    rules: configure('loyalty', (body) => program.normalizeRules(body), 'club.rules_updated'),
    rewards: configure('loyalty.rewards', (body) => program.normalizeRewards(body.rewards), 'club.rewards_updated'),
    tiers: configure('loyalty.tiers', (body) => loyaltyEngine.normalizeLoyaltyTiers(body.tiers), 'club.tiers_updated'),
    campaigns: configure('campaigns', (body, db) => campaigns.normalizeCampaignConfig(db, body), 'club.campaigns_updated'),
    packages: configure('walletPackages', (body) => walletEngine.normalizeWalletPackages(body.packages), 'club.wallet_packages_updated'),
    redeem: (req, res) => transaction(req, res, (db) => {
      const user = program.findMember(db, req.user.phone);
      const branchId = parseBranchId(req);
      if (!branchId) program.fail('club_branch_required', 'شعبهٔ دریافت جایزه را مشخص کنید.');
      const redemption = program.redeemReward(db, {
        user, rewardId: String(req.body.rewardId || ''), key: req.get('Idempotency-Key'), branchId,
        creditWallet: (input) => creditWallet(input, branchId, user.phone),
      });
      if (!redemption.replay) recordAudit(req, 'club.reward_redeemed', 'loyalty_redemption', redemption.id, { rewardId: redemption.rewardId, pointsCost: redemption.pointsCost }, branchId, { deferAppend: true });
      return { redemption, points: user.points, walletBalanceToman: walletEngine.getWalletBalance(db, user.phone) };
    }),
    adjust: (req, res) => transaction(req, res, (db) => {
      const user = program.findMember(db, req.body.phone);
      const delta = program.number(req.body.delta, { min: -1e9 });
      const reason = String(req.body.reason || '').trim();
      const key = req.get('Idempotency-Key');
      if (!delta || reason.length < 3 || reason.length > 160) program.fail('club_adjust_invalid', 'مقدار غیرصفر و دلیل تغییر امتیاز الزامی است.');
      if (!/^[a-zA-Z0-9._:-]{8,160}$/.test(key || '')) program.fail('club_idempotency_required', 'شناسهٔ درخواست الزامی است.');
      const entry = program.appendPoints(db, user, delta, 'manual', { key: `adjust:${key}`, reason, actor: req.user.phone });
      return { entry, user: { phone: user.phone, name: user.name, points: user.points } };
    }),
    consent: (req, res) => transaction(req, res, (db) => {
      if (typeof req.body.marketingConsent !== 'boolean') program.fail('club_consent_invalid', 'وضعیت رضایت دریافت پیامک معتبر نیست.');
      const user = program.findMember(db, req.user.phone);
      user.marketingConsent = req.body.marketingConsent;
      user.marketingConsentUpdatedAt = new Date().toISOString();
      return { marketingConsent: user.marketingConsent };
    }),
  };
  function install(app, { requireAuth, requireOwner }) {
    app.put('/api/admin/loyalty/rules', requireOwner, handlers.rules);
    app.put('/api/admin/loyalty/rewards', requireOwner, handlers.rewards);
    app.get('/api/admin/loyalty/rewards', requireOwner, (req, res) => {
      const db = getDb();
      res.json({ rewards: db.loyalty?.rewards || [], redemptions: (db.loyaltyRedemptions || []).slice(0, 100) });
    });
    app.put('/api/loyalty/preferences', requireAuth, handlers.consent);
    app.get('/api/loyalty/history', requireAuth, (req, res) => {
      const db = getDb();
      const user = program.findMember(db, req.user.phone);
      const page = Math.max(1, Math.min(10000, Number(req.query.page) || 1));
      const entries = (db.loyaltyLedger || []).filter((entry) => program.memberKey({ phone: entry.phone }) === program.memberKey({ phone: user.phone }));
      res.json({ entries: entries.slice((page - 1) * 30, page * 30), page, total: entries.length, hasMore: entries.length > page * 30 });
    });
  }
  return { ...handlers, transaction, install };
}
module.exports = { createCustomerClub };
