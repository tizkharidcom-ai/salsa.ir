'use strict';

// Seal the existing browser implementation. Releases are immutable; publish
// a new version rather than silently changing an assigned customer's files.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { ROOT, VERSION, catalog, getDefinition, isReleaseAsset } = require('../modules/runtime');
const releaseDirectory = (key, version) => path.join(ROOT, 'modules', key, 'releases', version);
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function buildRelease(moduleKey, version = '1.0.0') {
  const definition = getDefinition(moduleKey);
  if (!VERSION.test(version)) throw new Error('MODULE_VERSION_INVALID');
  const directory = releaseDirectory(moduleKey, version);
  const assets = definition.files.filter(isReleaseAsset).map(file => ({
    legacyPath: file.legacyPath,
    sha256: sha256(fs.readFileSync(path.join(ROOT, 'modules', moduleKey, file.path))),
  }));
  const digest = sha256(JSON.stringify({ moduleKey, version, runtimeApiVersion: definition.runtimeApiVersion, assets }));
  const manifestPath = path.join(directory, 'release.json');
  if (fs.existsSync(manifestPath)) {
    const existing = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (existing.digest !== digest) throw new Error(`IMMUTABLE_MODULE_RELEASE: ${moduleKey}@${version}`);
    return { moduleKey, version, unchanged: true, assets: assets.length };
  }
  fs.mkdirSync(directory, { recursive: true });
  for (const asset of assets) {
    const target = path.join(directory, 'public', asset.legacyPath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(ROOT, asset.legacyPath), target);
  }
  fs.writeFileSync(manifestPath, JSON.stringify({ schemaVersion: 1, moduleKey, version,
    labelFa: version === '1.0.0' ? 'نسخهٔ فعلی وستو' : `نسخهٔ ${version}`,
    runtimeApiVersion: definition.runtimeApiVersion,
    publishedAt: new Date().toISOString(), changesFa: ['همان رابط و رفتار موجود؛ بدون بازطراحی'],
    digest, assets,
  }, null, 2) + '\n');
  return { moduleKey, version, assets: assets.length, digest };
}

if (require.main === module) {
  const selected = process.argv[2];
  const keys = selected ? [selected] : catalog().map(module => module.key);
  console.log(JSON.stringify(keys.map(key => buildRelease(key, process.argv[3] || '1.0.0')), null, 2));
}
module.exports = { buildRelease };
