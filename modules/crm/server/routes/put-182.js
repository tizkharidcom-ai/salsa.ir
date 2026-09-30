'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.put('/api/admin/wallet/packages', __westoModuleContext.requireOwner, (req, res) => {
  if (!Array.isArray(req.body.packages) || !req.body.packages.length) {
    return res.status(400).json({ error: 'packages_array_required' });
  }
  const toNum = (v, fb = 0) => {
    if (v == null || v === '') return fb;
    if (typeof v === 'number') return isNaN(v) ? fb : v;
    const n = Number(__westoModuleContext.normalizeDigits(String(v)).replace(/[,٬_\s]/g, '').trim());
    return isNaN(n) ? fb : n;
  };
  __westoModuleContext.db.walletPackages = req.body.packages.map((p, idx) => {
    const amountToman = Math.max(0, Math.round(toNum(p.amountToman ?? p.amount, 0)));
    const priceToman = Math.max(0, Math.round(toNum(p.priceToman ?? p.price ?? amountToman, amountToman)));
    const bonusToman = Math.max(0, Math.round(toNum(p.bonusToman ?? p.bonus, 0)));
    const bonusPct = Math.max(0, Math.min(100, toNum(p.bonusPct, 0)));
    const totalCreditToman = Math.max(0, Math.round(toNum(p.totalCreditToman, amountToman + bonusToman)));
    return {
      id: String(p.id || `pack-${idx + 1}`).trim(),
      title: String(p.title || `بسته ${idx + 1}`).trim(),
      amountToman,
      priceToman,
      bonusToman,
      bonusPct,
      totalCreditToman,
      popular: !!p.popular,
      badge: String(p.badge || '').trim(),
      description: String(p.description || '').trim(),
    };
  });
  __westoModuleContext.save();
  res.json({ ok: true, packages: __westoModuleContext.db.walletPackages });
});
};
