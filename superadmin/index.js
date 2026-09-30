/**
 * superadmin/index.js
 *
 * Unified Module Entry Point for SALSA Super Admin / Control Plane.
 */

'use strict';

module.exports = {
  app: require('./backend/app'),
  server: require('./backend/server'),
  config: require('./backend/config'),
  database: require('./backend/db/database'),
  migrationRunner: require('./backend/db/migration-runner')
};
