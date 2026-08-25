const PAGES = {
  '/': '/index.html',
  '/login': '/login.html',
  '/admin': '/admin.html',
  '/admin/cashier': '/role-panel.html',
  '/admin/waiter': '/role-panel.html',
  '/admin/kitchen': '/role-panel.html',
  '/profile': '/profile.html',
  '/menu': '/menu.html',
  '/order': '/order.html',
  '/menu-print': '/menu-print.html',
  '/reserve': '/reserve.html',
  '/about': '/about.html',
  '/feedback': '/feedback.html',
  '/cgu': '/cgu.html',
  '/mentions-legales': '/mentions-legales.html',
  '/politique-de-confidentialite': '/politique-de-confidentialite.html',
};

let publicContentPromise;

function assetRequest(request, pathname) {
  const url = new URL(request.url);
  url.pathname = pathname;
  url.search = '';
  return new Request(url.toString(), request);
}

async function publicContent(env, request) {
  if (!publicContentPromise) {
    publicContentPromise = env.ASSETS.fetch(assetRequest(request, '/js/content-bootstrap.static.js'))
      .then((response) => response.text())
      .then((source) => {
        const match = source.match(/window\.__WESTO_STATIC_CONTENT__=(.*);\s*$/s);
        if (!match) throw new Error('Public menu snapshot is invalid');
        return JSON.parse(match[1]);
      });
  }
  return publicContentPromise;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-cache',
    },
  });
}

function unavailable() {
  return json({
    error: 'این قابلیت عملیاتی فقط در سرور اصلی وستو فعال است.',
  }, 503);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const pathname = url.pathname.replace(/\/$/, '') || '/';

    if (request.method === 'GET' || request.method === 'HEAD') {
      if (pathname === '/api/content-bootstrap.js') {
        return env.ASSETS.fetch(assetRequest(request, '/js/content-bootstrap.static.js'));
      }

      if (pathname === '/api/content' || pathname === '/api/menu' || pathname === '/api/allergens' || pathname === '/api/branches' || pathname === '/api/checkout/meta') {
        const snapshot = await publicContent(env, request);
        if (pathname === '/api/menu') return json(snapshot.menu || {});
        if (pathname === '/api/allergens') return json({ allergens: snapshot.menu?.allergens || [] });
        if (pathname === '/api/branches') return json({ branches: snapshot.restaurantPayload?.branches || [] });
        if (pathname === '/api/checkout/meta') {
          return json({
            payment: { mode: 'local_only', provider: 'local_only', onlineEnabled: false },
            branches: snapshot.restaurantPayload?.branches || [],
            deliveryZones: [],
          });
        }
        return json(snapshot);
      }

      if (pathname.startsWith('/api/')) return unavailable();
      const page = PAGES[pathname];
      if (page) return env.ASSETS.fetch(assetRequest(request, page));
    }

    if (pathname.startsWith('/api/')) return unavailable();
    return env.ASSETS.fetch(request);
  },
};
