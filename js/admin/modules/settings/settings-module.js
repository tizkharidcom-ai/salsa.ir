/* WESTO Admin — organization, branch, user and appearance settings module. */
(() => {
  const registry = window.WestoAdminModules;
  if (!registry) return;

  const tabs = ['restaurant', 'branches', 'hours', 'theme', 'users'];
  registry.register({
    id: 'settings',
    title: 'تنظیمات مجموعه',
    version: '1.0.0',
    tabs,
    dependencies: ['core'],
    stateKeys: ['settings'],
    createTabs(context) {
      return Object.fromEntries(tabs
        .filter((tab) => typeof context.legacyTabs?.[tab] === 'function')
        .map((tab) => [tab, (...args) => context.legacyTabs[tab](...args)]));
    },
  });
})();
