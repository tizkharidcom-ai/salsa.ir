'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.post('/api/admin/sms/send-bulk', __westoModuleContext.requireAdmin, async (req, res) => {
  const audience = String(req.body.audience || 'همه مشتریان').trim();
  const text = String(req.body.text || req.body.message || '').trim().slice(0, 1200);
  const allowedAudiences = new Set(['همه مشتریان', 'VIP', 'مشتریان جدید']);
  if (!allowedAudiences.has(audience)) return res.status(400).json({ error: 'گروه گیرندگان پیامک معتبر نیست.' });
  if (!text) return res.status(400).json({ error: 'متن پیامک خالی است.' });

  const rfm = __westoModuleContext.smsEngine.calculateCustomerRfm(__westoModuleContext.db);
  const candidates = audience === 'VIP'
    ? rfm.champions
    : audience === 'مشتریان جدید'
      ? rfm.active.filter((customer) => customer.segment === 'new')
      : [...rfm.champions, ...rfm.active, ...rfm.atRisk, ...rfm.dormant];
  const recipients = [...new Map(candidates
    .map((customer) => [String(customer.phone || '').trim(), customer])
    .filter(([phone]) => __westoModuleContext.PHONE_RE.test(phone)))
    .values()];
  const maxRecipients = 500;
  const batch = recipients.slice(0, maxRecipients);
  if (!batch.length) return res.status(409).json({ error: 'در این گروه گیرندهٔ معتبر پیدا نشد.' });

  const results = [];
  for (const customer of batch) {
    try {
      results.push(await __westoModuleContext.smsEngine.sendSms(__westoModuleContext.db, {
        phone: customer.phone,
        name: customer.name || '',
        customText: text,
        templateKey: 'custom',
        vars: { name: customer.name || 'مشتری گرامی' },
        triggerType: 'manual',
      }));
    } catch (error) {
      results.push({ ok: false, phone: customer.phone, error: error.message });
    }
  }
  const campaignId = `bulk-${Date.now()}`;
  const sent = results.filter((result) => result.ok).length;
  const failed = results.length - sent;
  __westoModuleContext.recordAudit(req, 'sms.bulk_sent', 'sms_campaign', campaignId, { audience, attempted: results.length, sent, failed, truncated: recipients.length > batch.length });
  __westoModuleContext.save();
  res.json({ ok: true, campaignId, audience, attempted: results.length, sent, failed, truncated: recipients.length > batch.length, totalCostToman: results.reduce((sum, result) => sum + (Number(result.costToman) || 0), 0) });
});
};
