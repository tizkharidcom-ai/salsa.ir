'use strict';

// Source-based legacy contract tests can inspect the same logical program
// after handlers move to their owning modules. Always read the executable
// handler file; no stale copy or fixture replaces the implementation.
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
const entries = new Map(require('./http-routes.json').routes.map(route => [`${route.moduleKey}:${route.id}`, route]));
const views = new Map(require('./admin-views.json').views.map(view => [`${view.moduleKey}:${view.tab}`, view]));

function viewProperty(moduleKey, tab) {
  const view = views.get(`${moduleKey}:${tab}`);
  if (!view) throw new Error('MODULE_SOURCE_VIEW_UNKNOWN');
  const source = fs.readFileSync(path.join(ROOT, view.path), 'utf8');
  const marker = `window.WestoAdminModules.defineView('${moduleKey}', '${tab}', function(`;
  const start = source.indexOf(marker);
  const bodyMarker = '\nreturn {\n';
  const bodyStart = source.indexOf(bodyMarker, start);
  const end = source.indexOf(`\n}['${tab}'];\n});`, start);
  if (start < 0 || bodyStart < 0 || end < 0) throw new Error('MODULE_SOURCE_VIEW_WRAPPER_INVALID');
  return source.slice(bodyStart + bodyMarker.length, end)
    .replace(/([A-Za-z_$][\w$]*): \/\*westo-module-shorthand\*\/ __westoViewContext\.\1/g, '$1')
    .replace(/__westoViewContext\.([A-Za-z_$][\w$]*)/g, '$1');
}

function routeStatement(moduleKey, id) {
  const route = entries.get(`${moduleKey}:${id}`);
  if (!route) throw new Error('MODULE_SOURCE_ROUTE_UNKNOWN');
  const source = fs.readFileSync(path.join(ROOT, route.path), 'utf8');
  const marker = 'module.exports = function register(__westoModuleContext) {\n';
  const start = source.indexOf(marker);
  if (start < 0 || !source.endsWith('\n};\n')) throw new Error('MODULE_SOURCE_WRAPPER_INVALID');
  return source.slice(start + marker.length, -4)
    .replace(/([A-Za-z_$][\w$]*): \/\*westo-module-shorthand\*\/ __westoModuleContext\.\1/g, '$1')
    .replace(/__westoModuleContext\.([A-Za-z_$][\w$]*)/g, '$1');
}

function readFileSync(file, options) {
  const source = fs.readFileSync(file, options);
  if (typeof source !== 'string') return source;
  const filename = path.resolve(String(file));
  if (filename === path.join(ROOT, 'js/admin.js') || filename === path.join(ROOT, 'modules/platform_core/frontend/js/admin.js')) {
    return source.replace(/(?:async )?([A-Za-z_$][\w$]*)\(\.\.\.args\) \{\n      return window\.WestoAdminModules\.invokeView\('([^']+)', '([^']+)', moduleViewContext, this, args\);\n    \}/g,
      (_match, _name, moduleKey, tab) => viewProperty(moduleKey, tab));
  }
  if (filename !== path.join(ROOT, 'server/server.js')) return source;
  return source.replace(/moduleRuntime\.registerHttpRoute\('([^']+)', '([^']+)', moduleRouteContext\);/g,
    (_match, moduleKey, id) => routeStatement(moduleKey, id));
}

module.exports = { readFileSync, routeStatement, viewProperty };
