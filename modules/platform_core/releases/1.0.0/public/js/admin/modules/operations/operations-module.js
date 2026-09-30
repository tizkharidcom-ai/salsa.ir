/* WESTO Admin — live restaurant operations module. */
(() => {
  const registry = window.WestoAdminModules;
  if (!registry) return;

  const tabs = ['dashboard', 'orders', 'kitchen', 'reservations', 'delivery', 'tables'];
  registry.register({
    id: 'operations',
    title: 'عملیات روزانه',
    version: '1.0.0',
    tabs,
    dependencies: ['core'],
    stateKeys: ['content'],
    createTabs(context) {
      return Object.fromEntries(tabs
        .filter((tab) => typeof context.legacyTabs?.[tab] === 'function')
        .map((tab) => [tab, (...args) => context.legacyTabs[tab](...args)]));
    },
  });
})();
