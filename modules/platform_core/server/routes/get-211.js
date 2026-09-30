'use strict';

// Existing handler; request data is supplied by the shared tenant context.
module.exports = function register(__westoModuleContext) {
__westoModuleContext.app.get('/', (req, res, next) => {
  // Old overlay deep-links → classic menu page
  if (req.query.menu != null || req.query.item != null) {
    const q = new URLSearchParams();
    if (req.query.cat != null) q.set('cat', String(req.query.cat));
    if (req.query.item != null) q.set('item', String(req.query.item));
    if (req.query.lang != null) q.set('lang', String(req.query.lang));
    if (req.query.q != null) q.set('q', String(req.query.q));
    if (req.query.exclude != null) q.set('exclude', String(req.query.exclude));
    const qs = q.toString();
    return res.redirect(302, '/menu' + (qs ? `?${qs}` : ''));
  }

  // Conservative 103 Early Hints: only resources that are unconditionally
  // needed by the root experience. No speculative menu images are hinted here;
  // the in-page resource scheduler owns those so user intent can preempt them.
  if (typeof res.writeEarlyHints === 'function') {
    try {
      res.writeEarlyHints({
        link: [
          '</css/westo-critical.smart.css?v=release14uf1d31-order-staged-quote>; rel=preload; as=style',
          '</js/westo-smart-loader.js?v=release14uf1d31-order-staged-quote>; rel=preload; as=script',
          '</js/westo-app.smart.js?v=release14uf1d31-order-staged-quote>; rel=preload; as=script',
          '</api/content-bootstrap.js>; rel=preload; as=script',
          '</assets/fonts/Vazirmatn-Variable.woff2>; rel=preload; as=font; type=font/woff2; crossorigin',
        ],
      });
    } catch (_) {}
  }
  next();
});
};
