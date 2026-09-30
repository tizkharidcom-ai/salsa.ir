'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.post('/api/menu', __westoModuleContext.requireAdmin, async (req, res) => {
  const id = Math.max(0, ...(__westoModuleContext.db.menuItems || []).map((m) => Number(m.id) || 0)) + 1;
  const parseNum = (v) => {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return isNaN(v) ? null : v;
    const n = Number(__westoModuleContext.normalizeDigits(String(v)).replace(/[,٬_\s]/g, '').trim());
    return isNaN(n) ? null : n;
  };
  const rawStock = parseNum(req.body.stock);
  const stock = rawStock != null && rawStock >= 0 ? Math.round(rawStock) : null;
  const imgRaw = typeof req.body.img === 'string' ? __westoModuleContext.sanitizeMenuImg(req.body.img) : '';
  if (imgRaw === null) return res.status(400).json({ error: 'مسیر تصویر نامعتبر است' });
  const rawCid = req.body.categoryId != null ? Number(__westoModuleContext.normalizeDigits(String(req.body.categoryId)).replace(/\D/g, '')) : null;
  const rawPrice = parseNum(req.body.price);
  const rawLow = parseNum(req.body.lowStockAt);
  const item = {
    id,
    categoryId: rawCid || (__westoModuleContext.db.menuCategories[0] || {}).id || 0,
    name: String(req.body.name || '').trim().slice(0, 120),
    en: String(req.body.en || '').trim().slice(0, 120),
    ar: String(req.body.ar || '').trim().slice(0, 120),
    desc: String(req.body.desc || '').trim().slice(0, 500),
    descEn: String(req.body.descEn || '').trim().slice(0, 500),
    descAr: String(req.body.descAr || '').trim().slice(0, 500),
    price: Math.max(0, Math.round(rawPrice ?? 0)),
    available: req.body.available !== false && stock !== 0,
    allergens: __westoModuleContext.normalizeAllergens(req.body.allergens),
    dayparts: __westoModuleContext.normalizeDayparts(req.body.dayparts),
    stock,
    lowStockAt: rawLow != null && rawLow >= 0 ? Math.round(rawLow) : 5,
    prepTime: parseNum(req.body.prepTime ?? req.body.prepTimeMinutes) ?? 15,
    dietary: Array.isArray(req.body.dietary) ? req.body.dietary.map((t) => String(t || '').trim()).filter(Boolean).slice(0, 10) : [],
  };
  const hasModifierGroupInput = Object.prototype.hasOwnProperty.call(req.body || {}, 'modifierGroups');
  if (hasModifierGroupInput && !Array.isArray(req.body.modifierGroups)) {
    return res.status(400).json({
      error: 'modifier_groups_invalid',
      message: 'فهرست گزینه‌های کالا باید به‌صورت آرایه ارسال شود.',
    });
  }
  const modifierGroupsInput = hasModifierGroupInput ? req.body.modifierGroups : [];
  const modifierGroupValidation = __westoModuleContext.validateModifierGroupDefinitions(modifierGroupsInput);
  if (!modifierGroupValidation.ok) {
    return res.status(400).json({
      error: 'modifier_configuration_invalid',
      message: 'تنظیم گزینه‌های این کالا معتبر نیست؛ گروه‌ها و قیمت گزینه‌ها را بررسی کنید.',
      details: modifierGroupValidation.errors,
    });
  }
  item.modifierGroups = modifierGroupValidation.groups;
  if (imgRaw) item.img = imgRaw;
  if (!item.name) return res.status(400).json({ error: 'نام را وارد کنید' });
  if (__westoModuleContext.tenantConnectionManager?.baseUrl && req.tenantDataAccess && req.tenantContext?.databaseProvider === 'postgres') {
    try {
      const persisted = await __westoModuleContext.tenantMenuRepository.createMenuItem(req.tenantDataAccess, item);
      if (persisted?.id != null) {
        item.id = persisted.id;
      }
    } catch (err) {
      console.error('[Tenant Menu Save Error]', err);
      return res.status(500).json({ ok: false, error: 'menu_persist_failed', message: err.message });
    }
  }
  __westoModuleContext.db.menuItems.push(item);
  __westoModuleContext.save({ rebuildProducts: true });
  res.json({ ok: true, item: __westoModuleContext.menuItemForResponse(item) });
});
};
