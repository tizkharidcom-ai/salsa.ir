'use strict';

const fs = require('node:fs');
const { readFileSync } = require('../../modules/source-view');
module.exports = { ...fs, readFileSync };
