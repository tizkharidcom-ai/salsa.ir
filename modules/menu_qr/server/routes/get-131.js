'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.get('/api/admin/qr-code', __westoModuleContext.requireCapability('tables.view'), async (req, res) => {
  const data = String(req.query.data || '').trim();
  if (!data || data.length > 1200) {
    return res.status(400).json({ error: 'مقصد QR نامعتبر یا بیش از حد طولانی است' });
  }

  const hexColor = (value, fallback) => {
    const candidate = String(value || '').trim();
    return /^#[0-9a-f]{6}$/i.test(candidate) ? candidate : fallback;
  };
  const errorCorrectionLevel = ['L', 'M', 'Q', 'H'].includes(String(req.query.ecl || '').toUpperCase())
    ? String(req.query.ecl).toUpperCase()
    : 'M';
  const width = Math.max(256, Math.min(1600, Math.round(Number(req.query.width) || 768)));
  const margin = Math.max(2, Math.min(12, Math.round(Number(req.query.margin) || 5)));
  const dark = hexColor(req.query.dark, '#11181b');
  const light = hexColor(req.query.light, '#ffffff');

  try {
    const png = await __westoModuleContext.QRCode.toBuffer(data, {
      type: 'png',
      width,
      margin,
      errorCorrectionLevel,
      color: { dark, light },
    });
    const filename = String(req.query.filename || 'westo-table-qr')
      .replace(/[^a-z0-9_-]+/gi, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'westo-table-qr';
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', `${req.query.download === '1' ? 'attachment' : 'inline'}; filename="${filename}.png"`);
    return res.send(png);
  } catch (error) {
    return res.status(400).json({ error: error?.message || 'ساخت QR ممکن نشد' });
  }
});
};
