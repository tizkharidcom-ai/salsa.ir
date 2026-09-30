'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.put('/api/admin/theme', __westoModuleContext.requireAdmin, (req, res) => {
  const t = req.body.theme || {};
  if (!__westoModuleContext.db.theme) __westoModuleContext.db.theme = {};
  const colorKeys = ['accent', 'accentInk', 'surface', 'bg', 'fog', 'printPaper', 'printInk', 'printAccent'];
  const hex = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
  for (const k of colorKeys) {
    if (typeof t[k] === 'string' && hex.test(t[k].trim())) __westoModuleContext.db.theme[k] = t[k].trim();
  }
  if (t.radius != null) {
    const rawRadius = typeof t.radius === 'number'
      ? t.radius
      : Number(__westoModuleContext.normalizeDigits(String(t.radius)).replace(/[,٬_\s]/g, '').trim());
    if (!isNaN(rawRadius)) {
      __westoModuleContext.db.theme.radius = Math.max(0, Math.min(28, Math.round(rawRadius)));
    }
  }
  if (typeof t.fontDisplay === 'string') __westoModuleContext.db.theme.fontDisplay = t.fontDisplay.trim().slice(0, 40) || 'Vazirmatn';
  __westoModuleContext.save();
  res.json({ ok: true, theme: __westoModuleContext.db.theme });
});
};
