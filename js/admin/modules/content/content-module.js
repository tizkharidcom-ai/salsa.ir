/* WESTO Admin — website content, CRM and promotion module. */
(() => {
  const registry = window.WestoAdminModules;
  if (!registry) return;

  const tabs = ['club', 'loyalty', 'feedback', 'newsletter', 'promotions', 'promoSlides', 'content', 'media', 'faq'];
  registry.register({
    id: 'content',
    title: 'محتوا، مشتری و بازاریابی',
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
