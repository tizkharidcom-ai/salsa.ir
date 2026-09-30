/* WESTO Admin — catalog, products and 3D menu integration module. */
(() => {
  const registry = window.WestoAdminModules;
  if (!registry) return;

  const tabs = ['menu', 'products', 'prices', 'complements', 'translate', 'printmenu'];

  registry.register({
    id: 'catalog',
    title: 'کاتالوگ، محصولات و منوی سه‌بعدی',
    version: '1.0.0',
    tabs,
    dependencies: ['core'],
    publicSurfaces: ['/menu', '/menu.html', '/order'],
    stateKeys: ['products', 'menuItems', 'content'],

    mount(context, modules) {
      modules.on('admin:mutation', ({ method, url }) => {
        if (!/^(POST|PUT|PATCH|DELETE)$/i.test(method || '')) return;
        if (/\/api\/(menu|admin\/menu|admin\/menu-|admin\/prices|admin\/upload)/i.test(url || '')) {
          modules.emit('catalog:changed', { method, url, source: 'admin' });
        }
      });
      modules.emit('catalog:ready', {
        tabs,
        publicSurfaces: this.publicSurfaces,
        threeDMenu: 'js/three-scene.js',
      });
    },

    // The existing, battle-tested renderers stay as the compatibility layer
    // until each view is extracted into its own file. The module owns their
    // navigation now, so extraction does not change URLs or user behavior.
    createTabs(context) {
      return Object.fromEntries(tabs
        .filter((tab) => typeof context.legacyTabs?.[tab] === 'function')
        .map((tab) => [tab, (...args) => context.legacyTabs[tab](...args)]));
    },
  });
})();
