'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.put('/api/admin/tables', __westoModuleContext.requireAdmin, async (req, res) => {
  if (!Array.isArray(req.body.tables)) return res.status(400).json({ error: 'tables required' });
  const parseNum = (v, fb = 0) => {
    if (v == null || v === '') return fb;
    if (typeof v === 'number') return isNaN(v) ? fb : v;
    const n = Number(__westoModuleContext.normalizeDigits(String(v)).replace(/[,٬_\s]/g, '').trim());
    return isNaN(n) ? fb : n;
  };
  const bid = Number(__westoModuleContext.parseBranchId(req));
  const requestedIds = req.body.tables.slice(0, 80).map((table, index) => Math.round(parseNum(table.id, index + 1)));
  if (new Set(requestedIds).size !== requestedIds.length) return res.status(400).json({ error: 'table_id_duplicate' });
  const existingMap = new Map((__westoModuleContext.db.tables || []).map((t) => [Number(t.id), t]));
  if (requestedIds.some((id) => existingMap.has(id) && __westoModuleContext.tableBranchId(existingMap.get(id)) !== bid)) {
    return res.status(403).json({ error: 'branch_access_denied', message: 'نمی‌توان میز شعبهٔ دیگری را با این درخواست جابه‌جا کرد.' });
  }
  const before = JSON.parse(JSON.stringify(__westoModuleContext.db.tables || []));
  const others = (__westoModuleContext.db.tables || []).filter((t) => __westoModuleContext.tableBranchId(t) !== bid);
  const updated = req.body.tables.slice(0, 80).map((t, i) => {
    const id = Math.round(parseNum(t.id, i + 1));
    const prev = existingMap.get(id) || {};
    const item = {
      ...prev,
      id,
      label: String(t.label || `میز ${i + 1}`).slice(0, 40),
      seats: Math.max(1, Math.min(24, Math.round(parseNum(t.seats, 4)))),
      zone: String(t.zone || 'سالن').slice(0, 40),
      active: t.active !== false,
      branchId: bid,
    };
    if (typeof t.x === 'number') item.x = Math.max(0, Math.min(100, Math.round(t.x * 10) / 10));
    if (typeof t.y === 'number') item.y = Math.max(0, Math.min(100, Math.round(t.y * 10) / 10));
    if (t.shape) item.shape = String(t.shape).slice(0, 20);
    if (t.chairModel) item.chairModel = String(t.chairModel).slice(0, 25);
    if (typeof t.chairScale === 'number') item.chairScale = Math.max(0.6, Math.min(2.0, Math.round(t.chairScale * 100) / 100));
    if (typeof t.tableScale === 'number') item.tableScale = Math.max(0.6, Math.min(2.5, Math.round(t.tableScale * 100) / 100));
    if (typeof t.rotation === 'number') item.rotation = Math.round(t.rotation) % 360;
    if (t.floorId) item.floorId = String(t.floorId).slice(0, 40);
    if (Array.isArray(t.mergedWith)) item.mergedWith = t.mergedWith.map((x) => Number(x) || String(x));
    if (t.mergedInto !== undefined) item.mergedInto = t.mergedInto ? (Number(t.mergedInto) || String(t.mergedInto)) : null;
    if (Array.isArray(t.tags)) item.tags = t.tags.slice(0, 10).map((x) => String(x).slice(0, 30));
    return item;
  });
  __westoModuleContext.db.tables = [...others, ...updated].sort((a, b) => a.id - b.id);
  try {
    await __westoModuleContext.save({ requireDurable: true });
  } catch (error) {
    __westoModuleContext.db.tables = before;
    return res.status(503).json({ error: 'table_persistence_failed', message: 'ذخیرهٔ تغییرات میز انجام نشد؛ وضعیت قبلی حفظ شد.' });
  }
  res.json({ ok: true, tables: updated });
});
};
