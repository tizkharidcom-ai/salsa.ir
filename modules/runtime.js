'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { MODULES } = require('../server/salsa/module-manifest');
const ROOT = path.resolve(__dirname, '..');
const API_VERSION = 'westo-v1';
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const definitions = new Map(MODULES.map(module => {
  const definition = require(`./${module.key}/module.json`);
  if (definition.key !== module.key || definition.runtimeApiVersion !== API_VERSION) {
    throw new Error(`MODULE_DEFINITION_INVALID: ${module.key}`);
  }
  return [module.key, definition];
}));
const assets = new Map();
const routes = new Map(require('./http-routes.json').routes.map(route => [`${route.moduleKey}:${route.id}`, route]));
const isReleaseAsset = file => file.layer === 'frontend' && file.delivery !== 'tenant-data-bootstrap'
  && !file.legacyPath.split('/').some(segment => segment.startsWith('.'));
for (const definition of definitions.values()) {
  for (const file of definition.files.filter(isReleaseAsset)) {
    if (assets.has(file.legacyPath)) throw new Error(`MODULE_ASSET_DUPLICATE: ${file.legacyPath}`);
    assets.set(file.legacyPath, { moduleKey: definition.key, file });
  }
}

function moduleError(code, message, status = 422) {
  return Object.assign(new Error(message || code), { code, status });
}

function registerHttpRoute(moduleKey, id, context) {
  const route = routes.get(`${moduleKey}:${id}`);
  if (!route) throw moduleError('module_http_route_unknown');
  return require(path.join(ROOT, route.path))(context);
}

function getDefinition(moduleKey) {
  const definition = definitions.get(moduleKey);
  if (!definition) throw moduleError('module_unknown', `ماژول «${moduleKey}» معتبر نیست.`);
  return definition;
}

function releaseDirectory(moduleKey, version) {
  getDefinition(moduleKey);
  if (typeof version !== 'string' || !VERSION.test(version)) throw moduleError('module_version_invalid');
  return path.join(__dirname, moduleKey, 'releases', version);
}

function getRelease(moduleKey, version) {
  const directory = releaseDirectory(moduleKey, version);
  let release;
  try { release = JSON.parse(fs.readFileSync(path.join(directory, 'release.json'), 'utf8')); }
  catch (_) { throw moduleError('module_release_unavailable', 'این نسخهٔ ماژول منتشر نشده است.', 409); }
  if (release.moduleKey !== moduleKey || release.version !== version || release.runtimeApiVersion !== API_VERSION) {
    throw moduleError('module_release_incompatible', 'نسخهٔ ماژول با قرارداد این سرور سازگار نیست.', 409);
  }
  const owned = new Set(getDefinition(moduleKey).files.filter(isReleaseAsset).map(file => file.legacyPath));
  if (!Array.isArray(release.assets) || release.assets.some(asset => !owned.has(asset.legacyPath)
    || !/^[a-f0-9]{64}$/.test(asset.sha256))
    || new Set(release.assets.map(asset => asset.legacyPath)).size !== release.assets.length) {
    throw moduleError('module_release_manifest_invalid', undefined, 503);
  }
  const digest = crypto.createHash('sha256').update(JSON.stringify({ moduleKey, version,
    runtimeApiVersion: release.runtimeApiVersion, assets: release.assets })).digest('hex');
  if (digest !== release.digest) throw moduleError('module_release_integrity_failed', undefined, 503);
  return release;
}

function listReleases(moduleKey) {
  getDefinition(moduleKey);
  const directory = path.join(__dirname, moduleKey, 'releases');
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory).filter(version => VERSION.test(version)).map(version => {
    const release = getRelease(moduleKey, version);
    return { version, labelFa: release.labelFa, runtimeApiVersion: release.runtimeApiVersion,
      digest: release.digest, publishedAt: release.publishedAt, changesFa: release.changesFa };
  }).sort((a, b) => {
    const left = a.version.split('.').map(Number), right = b.version.split('.').map(Number);
    return right[0] - left[0] || right[1] - left[1] || right[2] - left[2];
  });
}

function defaultVersions() {
  return Object.fromEntries([...definitions.values()].map(definition => [definition.key, definition.version]));
}

function validateSelections(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw moduleError('module_versions_invalid');
  const selections = {};
  for (const [key, version] of Object.entries(input)) {
    getRelease(key, version);
    selections[key] = version;
  }
  return Object.freeze(selections);
}

function catalog(selections = {}) {
  return [...definitions.values()].map(definition => ({
    key: definition.key, nameFa: definition.nameFa, currentVersion: selections[definition.key] || definition.version,
    runtimeApiVersion: API_VERSION, dependencies: [...definition.dependencies],
    releases: listReleases(definition.key),
    dataRetention: 'preserved_when_access_disabled',
    financialCapture: 'independent_of_accounting_subscription',
  }));
}

function resolveFrontendAsset(relative, selections = {}) {
  const owner = assets.get(relative);
  if (!owner) return null;
  const version = selections[owner.moduleKey];
  if (!version) return null; // Unpinned local WESTO keeps its current authoring files.
  const release = getRelease(owner.moduleKey, version);
  const artifact = release.assets.find(asset => asset.legacyPath === relative);
  if (!artifact) throw moduleError('module_release_asset_missing', undefined, 503);
  const directory = path.join(releaseDirectory(owner.moduleKey, version), 'public');
  const absolute = path.resolve(directory, artifact.legacyPath);
  if (!absolute.startsWith(directory + path.sep)) throw moduleError('module_asset_path_invalid', undefined, 503);
  return { absolute, moduleKey: owner.moduleKey, version, sha256: artifact.sha256 };
}

function verifyRelease(moduleKey, version) {
  const release = getRelease(moduleKey, version);
  const invalid = [];
  for (const artifact of release.assets) {
    const resolved = resolveFrontendAsset(artifact.legacyPath, { [moduleKey]: version });
    try {
      const digest = crypto.createHash('sha256').update(fs.readFileSync(resolved.absolute)).digest('hex');
      if (digest !== artifact.sha256) invalid.push(artifact.legacyPath);
    } catch (_) { invalid.push(artifact.legacyPath); }
  }
  return { valid: invalid.length === 0, invalid };
}

module.exports = { ROOT, API_VERSION, VERSION, getDefinition, getRelease, listReleases,
  defaultVersions, validateSelections, catalog, resolveFrontendAsset, verifyRelease, registerHttpRoute, isReleaseAsset };
