'use strict';
const fs = require('node:fs');
const path = require('node:path');
const runtime = require('../modules/runtime');
function verify() {
  const errors = [], modules = [];
  for (const entry of runtime.catalog()) {
    const definition = runtime.getDefinition(entry.key);
    for (const file of definition.files) {
      const alias = path.join(runtime.ROOT, file.legacyPath);
      const implementation = path.join(runtime.ROOT, 'modules', entry.key, file.path);
      try {
        if (!fs.lstatSync(alias).isSymbolicLink() || fs.realpathSync(alias) !== fs.realpathSync(implementation)) errors.push(`alias:${file.legacyPath}`);
      } catch (_) { errors.push(`missing:${file.legacyPath}`); }
    }
    for (const release of entry.releases) {
      const result = runtime.verifyRelease(entry.key, release.version);
      errors.push(...result.invalid.map(asset => `${entry.key}@${release.version}:${asset}`));
    }
    modules.push({ key: entry.key, files: definition.files.length, routes: (definition.httpRoutes || []).length,
      adminViews: (definition.adminViews || []).length, versions: entry.releases.map(release => release.version) });
  }
  return { valid: errors.length === 0, modules, errors };
}
if (require.main === module) {
  try { const result = verify(); console.log(JSON.stringify(result, null, 2)); if (!result.valid) process.exitCode = 1; }
  catch (error) { console.error(error.code || error.message); process.exitCode = 1; }
}
module.exports = { verify };
