/**
 * server/neem/control-plane/index.js
 * 
 * Main Entry Point for NEEM Control Plane Modular Monolith.
 * Exposes the monolith orchestrator, application instance, configuration,
 * database adapter, and workspaces catalog.
 */

'use strict';

const app = require('./app');
const config = require('./config');
const { getDatabase, InMemoryTestAdapter } = require('./db/database');
const { ControlPlaneMonolith, defaultMonolith, MONOLITH_WORKSPACES } = require('./monolith');

module.exports = {
  app,
  config,
  getDatabase,
  InMemoryTestAdapter,
  ControlPlaneMonolith,
  defaultMonolith,
  MONOLITH_WORKSPACES
};
