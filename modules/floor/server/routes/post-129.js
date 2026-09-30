'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.post('/api/admin/tables', __westoModuleContext.requireAdmin, async (req, res) => {
  const parseNum = (v, fb = 0) => {
    if (v == null || v === '') return fb;
    if (typeof v === 'number') return isNaN(v) ? fb : v;
    const n = Number(__westoModuleContext.normalizeDigits(String(v)).replace(/[,٬_\s]/g, '').trim());
    return isNaN(n) ? fb : n;
  };
  const id = Math.max(0, ...__westoModuleContext.db.tables.map((t) => Number(t.id) || 0), 0) + 1;
  const branchId = Number(__westoModuleContext.parseBranchId(req));
  const table = {
    id,
    label: String(req.body.label || `میز ${id}`).slice(0, 40),
    seats: Math.max(1, Math.min(24, Math.round(parseNum(req.body.seats, 4)))),
    zone: String(req.body.zone || 'سالن').slice(0, 40),
    active: true,
    branchId,
  };
  if (typeof req.body.x === 'number') table.x = Math.max(0, Math.min(100, Math.round(req.body.x * 10) / 10));
  if (typeof req.body.y === 'number') table.y = Math.max(0, Math.min(100, Math.round(req.body.y * 10) / 10));
  if (req.body.shape) table.shape = String(req.body.shape).slice(0, 20);
  if (req.body.chairModel) table.chairModel = String(req.body.chairModel).slice(0, 25);
  if (typeof req.body.chairScale === 'number') table.chairScale = Math.max(0.6, Math.min(2.0, Math.round(req.body.chairScale * 100) / 100));
  if (typeof req.body.tableScale === 'number') table.tableScale = Math.max(0.6, Math.min(2.5, Math.round(req.body.tableScale * 100) / 100));
  if (typeof req.body.rotation === 'number') table.rotation = Math.round(req.body.rotation) % 360;
  if (req.body.floorId) table.floorId = String(req.body.floorId).slice(0, 40);
  if (Array.isArray(req.body.tags)) table.tags = req.body.tags.slice(0, 10).map((x) => String(x).slice(0, 30));
  const before = JSON.parse(JSON.stringify(__westoModuleContext.db.tables || []));
  __westoModuleContext.db.tables.push(table);
  try {
    await __westoModuleContext.save({ requireDurable: true });
  } catch (error) {
    __westoModuleContext.db.tables = before;
    return res.status(503).json({ error: 'table_persistence_failed', message: 'ذخیرهٔ میز انجام نشد؛ وضعیت قبلی حفظ شد.' });
  }
  res.json({ ok: true, table });
});
};
