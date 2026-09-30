'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.put('/api/menu/:id', __westoModuleContext.requireAdmin, async (req, res) => {
  const targetId = Number(__westoModuleContext.normalizeDigits(String(req.params.id || '')).replace(/\D/g, ''));
  const item = (__westoModuleContext.db.menuItems || []).find((m) => Number(m.id) === targetId);
  if (!item) return res.status(404).json({ error: 'not found' });
  // Simple dirty-lock: reject concurrent price+stock writes with mismatched revisions.
  const clientRev = req.body._rev != null ? Number(req.body._rev) : null;
  const itemRev = Number(item.updatedAt) || 0;
  if (clientRev != null && itemRev && clientRev < itemRev) {
    return res.status(409).json({
      error: 'این غذا هم‌زمان از جای دیگری تغییر کرده — صفحه را تازه کنید',
      item,
    });
  }
  const hasModifierGroupInput = Object.prototype.hasOwnProperty.call(req.body || {}, 'modifierGroups');
  let validatedModifierGroups = null;
  if (hasModifierGroupInput) {
    if (!Array.isArray(req.body.modifierGroups)) {
      return res.status(400).json({
        error: 'modifier_groups_invalid',
        message: 'فهرست گزینه‌های کالا باید به‌صورت آرایه ارسال شود.',
      });
    }
    const validation = __westoModuleContext.validateModifierGroupDefinitions(req.body.modifierGroups);
    if (!validation.ok) {
      return res.status(400).json({
        error: 'modifier_configuration_invalid',
        message: 'تنظیم گزینه‌های این کالا معتبر نیست؛ گروه‌ها و قیمت گزینه‌ها را بررسی کنید.',
        details: validation.errors,
      });
    }
    validatedModifierGroups = validation.groups;
  }
  const parseNum = (v) => {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return isNaN(v) ? null : v;
    const n = Number(__westoModuleContext.normalizeDigits(String(v)).replace(/[,٬_\s]/g, '').trim());
    return isNaN(n) ? null : n;
  };
  if (typeof req.body.name === 'string') item.name = req.body.name.trim().slice(0, 120);
  if (typeof req.body.desc === 'string') item.desc = req.body.desc.trim().slice(0, 500);
  if (typeof req.body.en === 'string') item.en = req.body.en.trim().slice(0, 120);
  if (typeof req.body.descEn === 'string') item.descEn = req.body.descEn.trim().slice(0, 500);
  if (typeof req.body.ar === 'string') item.ar = req.body.ar.trim().slice(0, 120);
  if (typeof req.body.descAr === 'string') item.descAr = req.body.descAr.trim().slice(0, 500);
  if (typeof req.body.img === 'string') {
    const img = __westoModuleContext.sanitizeMenuImg(req.body.img);
    if (img === null) return res.status(400).json({ error: 'مسیر تصویر نامعتبر است' });
    item.img = img;
  }
  if (req.body.categoryId != null) {
    const cid = Number(__westoModuleContext.normalizeDigits(String(req.body.categoryId)).replace(/\D/g, ''));
    if ((__westoModuleContext.db.menuCategories || []).some((c) => Number(c.id) === cid)) item.categoryId = cid;
  }
  const rawPrice = parseNum(req.body.price);
  if (rawPrice != null && rawPrice >= 0) item.price = Math.round(rawPrice);
  if (typeof req.body.available === 'boolean') item.available = req.body.available;
  if (Array.isArray(req.body.allergens)) item.allergens = __westoModuleContext.normalizeAllergens(req.body.allergens);
  if (Array.isArray(req.body.dayparts)) item.dayparts = __westoModuleContext.normalizeDayparts(req.body.dayparts);
  if (hasModifierGroupInput) item.modifierGroups = validatedModifierGroups;
  if (req.body.stock === null || req.body.stock === '') item.stock = null;
  else {
    const rawStock = parseNum(req.body.stock);
    if (rawStock != null && rawStock >= 0) {
      item.stock = Math.round(rawStock);
      if (item.stock === 0) item.available = false;
    }
  }
  const rawLow = parseNum(req.body.lowStockAt);
  if (rawLow != null && rawLow >= 0) {
    item.lowStockAt = Math.round(rawLow);
  }
  if (Array.isArray(req.body.dietary)) {
    item.dietary = req.body.dietary.map((t) => String(t || '').trim()).filter(Boolean).slice(0, 10);
  }
  const rawPrep = parseNum(req.body.prepTime ?? req.body.prepTimeMinutes);
  if (rawPrep != null && rawPrep >= 0) {
    item.prepTime = Math.round(rawPrep);
  }
  item.updatedAt = Date.now();
  if (__westoModuleContext.tenantConnectionManager?.baseUrl && req.tenantDataAccess && req.tenantContext?.databaseProvider === 'postgres') {
    try {
      await __westoModuleContext.tenantMenuRepository.updateMenuItem(req.tenantDataAccess, targetId, item);
    } catch (err) {
      console.error('[Tenant Menu Update Error]', err);
      return res.status(500).json({ ok: false, error: 'menu_persist_failed', message: err.message });
    }
  }
  __westoModuleContext.save({ rebuildProducts: true });
  res.json({ ok: true, item: __westoModuleContext.menuItemForResponse(item) });
});
};
