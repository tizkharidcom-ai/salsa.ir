/* WESTO Admin — accounting and finance module boundary. */
(() => {
  const registry = window.WestoAdminModules;
  if (!registry) return;

  const tabs = ['finance', 'accounting'];
  registry.register({
    id: 'finance',
    title: 'مالی و حسابداری',
    version: '1.0.0',
    tabs,
    dependencies: ['core'],
    stateKeys: ['financeV2'],
    externalWorkspace: 'js/admin-accounting.js',
    createTabs(context) {
      return Object.fromEntries(tabs
        .filter((tab) => typeof context.legacyTabs?.[tab] === 'function')
        .map((tab) => [tab, (...args) => context.legacyTabs[tab](...args)]));
    },
  });
})();
