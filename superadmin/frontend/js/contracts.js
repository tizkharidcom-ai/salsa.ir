// Canonical UI contract for the GODMODE prototype.
//
// Each page owns its route, scope, read permission and dataset declaration in
// one place. Mock data intentionally carries the same provenance shape as a
(function registerGodmodeContracts(global) {
  const platformPillars = Object.freeze([
    { key: 'overview', label: 'مرکز فرماندهی', purpose: 'سلامت، رخدادها و کارهای فوری' },
    { key: 'customers', label: 'مشتریان', purpose: 'از ایجاد مجموعه تا قرارداد و پشتیبانی' },
    { key: 'billing', label: 'محصول و درآمد', purpose: 'امکانات، پلن‌ها، مصرف و وصول' },
    { key: 'security', label: 'هویت و دسترسی', purpose: 'کاربران، نقش‌ها و سیاست‌های امنیتی' },
    { key: 'infrastructure', label: 'زیرساخت و تداوم', purpose: 'سرور متمرکز VPS، خودکارسازی، انتشار و بازیابی' },
    { key: 'platform', label: 'حاکمیت پلتفرم', purpose: 'ممیزی و مدیریت تیم راهبر' }
  ]);

  // Tenant-owned surfaces all descend from the selected customer dossier.
  // Keeping this relation in the page contract prevents navigation drift
  // between the sidebar, deep links and the dossier tabs.
  const dossierParents = Object.freeze({
    GM04: 'gm-03-tenants',
    GM05: 'gm-03-tenants',
    GM06: 'gm-04-tenant-detail',
    GM09: 'gm-04-tenant-detail',
    GM11: 'gm-04-tenant-detail',
    GM12: 'gm-04-tenant-detail',
    GM13: 'gm-04-tenant-detail',
    GM14: 'gm-04-tenant-detail',
    GM15: 'gm-04-tenant-detail',
    GM17: 'gm-04-tenant-detail',
    GM18: 'gm-04-tenant-detail',
    GM19: 'gm-04-tenant-detail',
    GM20: 'gm-04-tenant-detail',
    GM21: 'gm-04-tenant-detail',
    GM28: 'gm-04-tenant-detail'
  });

  const pages = [
    ['GM01', 'gm-01-login', 'login', ['me/security', 'gm-01-auth', 'auth'], 'security', 'platform', 'platform.session.read', 'platform.session'],
    ['GM02', 'gm-02-overview', 'overview', [], 'overview', 'platform', 'platform.overview.read', 'platform.overview'],
    ['GM03', 'gm-03-tenants', 'customers', ['tenants'], 'customers', 'platform', 'tenant.registry.read', 'tenant.registry'],
    ['GM04', 'gm-04-tenant-detail', 'customer', ['tenants/detail'], 'customers', 'tenant', 'tenant.metadata.read', 'tenant.metadata'],
    ['GM05', 'gm-05-tenant-new', 'customer/new', ['tenants/new'], 'customers', 'platform', 'tenant.provision.create', 'tenant.provisioning'],
    ['GM06', 'gm-06-provisioning', 'customer/provisioning', ['provisioning'], 'customers', 'tenant', 'tenant.provision.read', 'tenant.provisioning'],
    ['GM08', 'gm-08-features', 'catalog', ['features'], 'billing', 'platform', 'feature.catalog.read', 'feature.catalog'],
    ['GM09', 'gm-09-tenant-features', 'customer/features', ['tenant-features'], 'customers', 'tenant', 'feature.grant.read', 'tenant.entitlements'],
    ['GM10', 'gm-10-plans', 'plans', [], 'billing', 'platform', 'billing.plan.read', 'billing.plans'],
    ['GM11', 'gm-11-billing', 'customer/billing', ['billing'], 'billing', 'tenant', 'billing.invoice.read', 'billing.invoices'],
    ['GM12', 'gm-12-usage', 'customer/usage', ['usage'], 'customers', 'tenant', 'billing.usage.read', 'billing.usage'],
    ['GM13', 'gm-13-identities', 'customer/users', ['identities'], 'customers', 'tenant', 'identity.membership.read', 'tenant.identities'],
    ['GM14', 'gm-14-access-roles', 'customer/access', ['access/roles', 'roles'], 'customers', 'tenant', 'policy.read', 'tenant.policy'],
    ['GM15', 'gm-15-simulator', 'customer/simulator', ['access/simulator', 'simulator'], 'customers', 'tenant', 'policy.evaluate', 'tenant.policy'],
    ['GM16', 'gm-16-automations', 'automations', [], 'infrastructure', 'platform', 'automation.read', 'platform.automation'],
    ['GM17', 'gm-17-customers', 'customer/guests', ['data/customers'], 'customers', 'tenant', 'customer.directory.read', 'tenant.customerDirectory'],
    ['GM18', 'gm-18-domains', 'customer/domains', ['domains'], 'customers', 'tenant', 'domain.read', 'tenant.domains'],
    ['GM19', 'gm-19-devices', 'customer/devices', ['devices'], 'customers', 'tenant', 'edge.device.read', 'tenant.devices'],
    ['GM20', 'gm-20-backups', 'customer/backups', ['backups'], 'customers', 'tenant', 'backup.read', 'tenant.backups'],
    ['GM21', 'gm-21-support', 'customer/support', ['support', 'support/sessions'], 'customers', 'tenant', 'support.ticket.read', 'tenant.support'],
    ['GM22', 'gm-22-operations', 'operations', ['operations', 'incidents'], 'overview', 'platform', 'observability.read', 'platform.observability'],
    ['GM23', 'gm-23-releases', 'releases', [], 'infrastructure', 'platform', 'release.read', 'platform.releases'],
    ['GM24', 'gm-24-infrastructure', 'infrastructure', ['cells'], 'infrastructure', 'platform', 'infrastructure.read', 'platform.infrastructure'],
    ['GM25', 'gm-25-jobs', 'jobs', [], 'overview', 'platform', 'job.read', 'platform.jobs'],
    ['GM26', 'gm-26-audit', 'audit', [], 'platform', 'platform', 'audit.read', 'platform.audit'],
    ['GM27', 'gm-27-team', 'team', ['settings'], 'platform', 'platform', 'platform.team.read', 'platform.team'],
    ['GM28', 'gm-28-portal', 'customer/portal', ['portal', 'account'], 'customers', 'tenant', 'portal.contract.read', 'tenant.portal'],
    ['GM29', 'gm-29-printers', 'printers', ['settings/printers'], 'platform', 'platform', 'platform.settings.read', 'platform.printerCatalog']
  ].map(([id, route, shortRoute, aliases, module, scope, permission, dataset]) => ({
    id, route, shortRoute, aliases, module, scope, permission, dataset,
    tier: scope === 'tenant' ? 'tenant_workspace' : 'platform_fleet',
    pillar: module,
    parentRoute: dossierParents[id] || null,
    apiNamespace: '/api/control',
    apiVersion: 'v1'
  }));

  const pageById = Object.fromEntries(pages.map((page) => [page.id, page]));
  const pageByRoute = Object.fromEntries(pages.flatMap((page) => [page.route, page.shortRoute, ...page.aliases].map((route) => [route, page])));

  // These query parameters are only cache/render controls. They make copied
  // operator URLs noisy and do not describe the page state, so they are
  // removed from the canonical address while all meaningful parameters (id,
  // tab, plan, jobId, ...) remain untouched and in their original encoding.
  const transientQueryKeys = new Set(['cache', 't', 'ts', '_ts', '_cache', 'timestamp']);

  function stripTransientQuery(query) {
    if (!query) return '';
    return query.split('&').filter((part) => {
      if (!part) return false;
      const rawKey = part.split('=')[0] || '';
      let key = rawKey;
      try { key = decodeURIComponent(rawKey.replace(/\+/g, ' ')); } catch (_error) {}
      return !transientQueryKeys.has(key);
    }).join('&');
  }

  // Convert any internal hash link to the compact, operator-facing route.
  // Legacy GM routes and their query strings remain valid, but are never
  // rendered back into the UI as the canonical address.
  function compactHash(hash) {
    if (typeof hash !== 'string' || !hash.startsWith('#')) return hash;
    const raw = hash.slice(1);
    const separator = raw.indexOf('?');
    const route = separator === -1 ? raw : raw.slice(0, separator);
    const query = separator === -1 ? '' : stripTransientQuery(raw.slice(separator + 1));
    const page = pageByRoute[route];
    if (!page) return hash;
    return `#${page.shortRoute}${query ? `?${query}` : ''}`;
  }

  function datasetProvenance(dataset, tenantId = null) {
    return {
      tenantId,
      dataset,
      sourceKind: 'mock_fixture',
      sourceId: 'prototype-local-v3',
      observedAt: null,
      lastSuccessAt: null,
      schemaVersion: 'mock-v3',
      status: 'mock',
      completeness: 'not_operational',
      period: null,
      unit: null
    };
  }

  // Live client links are explicit configuration points. GODMODE remains a
  // mock-only surface, but operators can deploy it beside WESTO on another
  // host by setting `window.__WESTO_CLIENT_ORIGIN__` or a meta tag without
  // editing every view that opens a POS, KDS or customer portal page.
  function resolveWestoClientOrigin() {
    const fallback = 'http://localhost:4180';
    let configured = global.__WESTO_CLIENT_ORIGIN__ || '';
    if (!configured && global.document && typeof global.document.querySelector === 'function') {
      configured = global.document.querySelector('meta[name="westo-client-origin"]')?.getAttribute('content') || '';
    }
    let origin = fallback;
    try {
      const parsed = new URL(String(configured || fallback), fallback);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        origin = `${parsed.protocol}//${parsed.host}`;
      }
    } catch (_error) {
      origin = fallback;
    }
    return Object.freeze({
      origin,
      page(relativePath = '/') {
        const path = String(relativePath || '/');
        return `${origin}${path.startsWith('/') ? path : `/${path}`}`;
      },
    });
  }

  // Canonical HTML-escaping helper for every GODMODE view. All mock-sourced
  // strings interpolated into innerHTML must pass through this function so a
  // crafted tenant/feature/user value can never inject markup.
  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // Safe JSON literal for inline event-handler arguments. The JSON quoting
  // protects JavaScript syntax and HTML escaping prevents attribute breakout.
  function inlineJson(value) {
    return escapeHtml(JSON.stringify(String(value == null ? '' : value))
      .replace(/\u2028/g, '\\u2028')
      .replace(/\u2029/g, '\\u2029'));
  }

  global.GMPageContracts = Object.freeze({
    apiNamespace: '/api/control',
    escapeHtml,
    inlineJson,
    pages: Object.freeze(pages),
    pageById: Object.freeze(pageById),
    getForRoute(route) { return pageByRoute[route] || null; },
    getForView(viewId) { return pageById[viewId] || null; },
    compactHash,
    stripTransientQuery,
    westoClientOrigin: resolveWestoClientOrigin(),
    buildRouteMap() { return Object.fromEntries(Object.entries(pageByRoute).map(([route, page]) => [route, page.id])); },
    buildModuleMap() { return Object.fromEntries(Object.entries(pageByRoute).map(([route, page]) => [route, page.module])); },
    tenantScopedViews() { return pages.filter((page) => page.scope === 'tenant').map((page) => page.id); },
    getPlatformPillars() { return platformPillars; },
    datasetProvenance
  });
})(window);
