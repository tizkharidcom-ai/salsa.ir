/* WESTO Admin module registry — shared contract for the admin SPA. */
(() => {
  const modules = new Map();
  const listeners = new Map();
  let mountedContext = null;

  const normalize = (definition) => {
    if (!definition || typeof definition !== 'object') throw new TypeError('Admin module definition is required.');
    const id = String(definition.id || '').trim();
    if (!id) throw new TypeError('Admin module id is required.');
    const tabs = Array.isArray(definition.tabs) ? definition.tabs.map((tab) => String(tab).trim()).filter(Boolean) : [];
    return Object.freeze({ ...definition, id, tabs: Object.freeze(tabs) });
  };

  const registry = {
    register(definition) {
      const module = normalize(definition);
      if (modules.has(module.id)) throw new Error(`Admin module already registered: ${module.id}`);
      const ownedTabs = new Set([...modules.values()].flatMap((item) => item.tabs));
      const duplicateTab = module.tabs.find((tab) => ownedTabs.has(tab));
      if (duplicateTab) throw new Error(`Admin tab already owned: ${duplicateTab}`);
      modules.set(module.id, module);
      return module;
    },

    get(id) { return modules.get(String(id || '').trim()) || null; },

    list() { return [...modules.values()]; },

    forTab(tab) {
      const name = String(tab || '').trim();
      return [...modules.values()].find((module) => module.tabs.includes(name)) || null;
    },

    tabOwners() {
      return Object.fromEntries([...modules.values()].flatMap((module) => module.tabs.map((tab) => [tab, module.id])));
    },

    on(eventName, handler) {
      const name = String(eventName || '').trim();
      if (!name || typeof handler !== 'function') return () => {};
      const handlers = listeners.get(name) || new Set();
      handlers.add(handler);
      listeners.set(name, handlers);
      return () => handlers.delete(handler);
    },

    emit(eventName, detail = {}) {
      const handlers = listeners.get(String(eventName || '').trim());
      if (!handlers) return;
      for (const handler of [...handlers]) {
        try { handler(detail); } catch (error) { console.error('[WESTO admin module]', error); }
      }
    },

    mount(context, tabTarget) {
      mountedContext = Object.freeze({ ...context, modules: registry });
      const bindings = {};
      for (const module of modules.values()) {
        try {
          module.mount?.(mountedContext, registry);
          const moduleTabs = module.createTabs?.(mountedContext, registry) || {};
          for (const [tab, handler] of Object.entries(moduleTabs)) {
            if (typeof handler !== 'function' || !module.tabs.includes(tab)) continue;
            const binding = (...args) => {
              registry.emit('admin:tab-opening', { moduleId: module.id, tab });
              return handler(...args);
            };
            bindings[tab] = binding;
            if (tabTarget) tabTarget[tab] = binding;
          }
        } catch (error) {
          console.error(`[WESTO admin module: ${module.id}]`, error);
        }
      }
      registry.emit('admin:modules-mounted', { modules: registry.list(), bindings: Object.keys(bindings) });
      return bindings;
    },

    context() { return mountedContext; },
  };

  window.WestoAdminModules = registry;
})();
