'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.get('/api/loyalty/qr-code', __westoModuleContext.requireAuth, async (req, res) => {
  try {
    const phone = req.user.phone;
    // Build the cashier look-up URL (same origin, so relative path works on LAN)
    const protocol = req.protocol;
    const host = req.get('host');
    const payload = `${protocol}://${host}/api/loyalty/customer?phone=${encodeURIComponent(phone)}`;

    const png = await __westoModuleContext.QRCode.toBuffer(payload, {
      type: 'png',
      width: 400,
      margin: 2,
      errorCorrectionLevel: 'M',
      color: { dark: '#151817', light: '#ffffff' },
    });

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'private, max-age=300'); // 5-min cache
    res.setHeader('X-Westo-Phone', phone.slice(-4));         // last 4 digits hint
    return res.send(png);
  } catch (err) {
    return res.status(500).json({ error: 'ساخت QR ممکن نشد' });
  }
});
};
