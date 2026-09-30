'use strict';

/**
 * Build a conservative, source-backed queue for routes whose request body is
 * not yet a reviewed contract.  This artifact deliberately records the gap
 * and its next review action; it never invents fields, types, requiredness, or
 * examples for an unreviewed payload.
 */

const fs = require('node:fs');
const path = require('node:path');
const { auditAllRoutes } = require('./audit-salsa-routes');
const { extractControlPlaneRoutes } = require('./extract-salsa-control-plane-routes');

const ROOT = path.resolve(__dirname, '..');
const OPENAPI_PATH = path.join(ROOT, 'docs', 'salsa', 'contracts', 'openapi.json');
const OUTPUT = path.join(ROOT, 'docs', 'salsa', 'inventory', 'body-contract-gaps.json');
const METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace']);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function routeKey(method, operationId) {
  return `${String(method).toUpperCase()} ${operationId}`;
}

function nextActionFor({ surface, method, requestStatus }) {
  if (requestStatus === 'source_observed_body_opaque') return 'review_imported_service_or_domain_helper';
  if (surface === 'control_plane') return 'add_control_plane_payload_contract_or_confirm_no_body';
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return 'confirm_no_body_or_add_source_observation';
  return 'confirm_no_body_or_add_source_observation';
}

function priorityFor({ method, requestStatus }) {
  if (requestStatus === 'source_observed_body_opaque') return 'P1';
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return 'P1';
  return 'P2';
}

function buildBodyGapInventory({ document, dataRoutes, controlRoutes, generatedAt = new Date().toISOString() }) {
  const routeByOperationId = new Map([...dataRoutes, ...controlRoutes].map((route) => [route.id, route]));
  const gaps = [];

  for (const [openApiPath, pathItem] of Object.entries(document.paths || {})) {
    for (const [methodKey, operation] of Object.entries(pathItem || {})) {
      if (!METHODS.has(methodKey)) continue;
      const requestStatus = operation['x-neem-request-schema-status'];
      if (!['source_observed_body_opaque', 'not_defined'].includes(requestStatus)) continue;

      const route = routeByOperationId.get(operation.operationId);
      if (!route) throw new Error(`ROUTE_SOURCE_MISSING:${operation.operationId}`);
      const method = methodKey.toUpperCase();
      const surface = operation['x-neem-surface'] || route.surface || 'westo_data_plane';
      gaps.push({
        operationId: operation.operationId,
        method,
        path: route.path,
        openApiPath,
        surface,
        requestStatus,
        observedBodyUsage: operation['x-neem-observed-body-usage'] || route.observedInputs?.bodyUsage || 'not_observed',
        observedFields: [...(operation['x-neem-observed-request-fields'] || route.observedInputs?.bodyFields || [])].sort(),
        sourceFile: route.sourceFile,
        sourceLine: route.sourceLine,
        targetFeature: route.targetFeature,
        targetPermission: route.targetPermission || null,
        targetScope: route.targetScope,
        authMode: route.authMode || (route.isExempt ? 'public' : 'platform_session'),
        lifecycleStatus: route.lifecycleStatus,
        nextAction: nextActionFor({ surface, method, requestStatus }),
        priority: priorityFor({ method, requestStatus })
      });
    }
  }

  gaps.sort((a, b) => {
    const surfaceOrder = a.surface.localeCompare(b.surface);
    if (surfaceOrder) return surfaceOrder;
    const priorityOrder = a.priority.localeCompare(b.priority);
    if (priorityOrder) return priorityOrder;
    const fileOrder = a.sourceFile.localeCompare(b.sourceFile);
    if (fileOrder) return fileOrder;
    return a.sourceLine - b.sourceLine || a.method.localeCompare(b.method) || a.path.localeCompare(b.path);
  });

  const summary = {
    totalGaps: gaps.length,
    bySurface: {},
    byRequestStatus: {},
    byPriority: {},
    dataPlane: gaps.filter((gap) => gap.surface === 'westo_data_plane').length,
    controlPlane: gaps.filter((gap) => gap.surface === 'control_plane').length
  };
  for (const gap of gaps) {
    summary.bySurface[gap.surface] = (summary.bySurface[gap.surface] || 0) + 1;
    summary.byRequestStatus[gap.requestStatus] = (summary.byRequestStatus[gap.requestStatus] || 0) + 1;
    summary.byPriority[gap.priority] = (summary.byPriority[gap.priority] || 0) + 1;
  }

  return {
    metadata: {
      title: 'NEEM request body contract gap inventory',
      generatedBy: 'scripts/generate-salsa-body-gap-inventory.js',
      contractStatus: 'gap_inventory_only',
      sourceContracts: 'docs/salsa/contracts/openapi.json',
      note: 'This queue is source-backed and conservative. It does not define or imply an API payload schema.',
      generatedAt
    },
    summary,
    gaps
  };
}

function writeBodyGapInventory(outputPath = OUTPUT) {
  const document = readJson(OPENAPI_PATH);
  const { routes: dataRoutes } = auditAllRoutes({ checkOnly: true });
  const controlRoutes = extractControlPlaneRoutes();
  const artifact = buildBodyGapInventory({
    document,
    dataRoutes,
    controlRoutes
  });
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  return { outputPath, artifact };
}

if (require.main === module) {
  const result = writeBodyGapInventory();
  process.stdout.write(JSON.stringify({ ok: true, output: path.relative(ROOT, result.outputPath), ...result.artifact.summary }, null, 2) + '\n');
}

module.exports = { buildBodyGapInventory, writeBodyGapInventory };
