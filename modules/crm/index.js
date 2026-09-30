'use strict';

const definition = require('./module.json');

module.exports = {
  definition,
  loadServerComponent(legacyPath) {
    const file = definition.files.find(file => file.layer === 'server' && file.legacyPath === legacyPath);
    if (!file) throw new Error('MODULE_COMPONENT_NOT_FOUND: ' + definition.key + ':' + legacyPath);
    return require('./' + file.path);
  },
};
