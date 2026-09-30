'use strict';

/**
 * Fail-closed validator for the generated NEEM/WESTO OpenAPI inventory.
 * It validates the generated artifact and its source inventories only; it does
 * not grant production readiness and never starts the application.
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const OPENAPI_PATH = path.join(ROOT, 'docs', 'salsa', 'contracts', 'openapi.json');
const DATA_INVENTORY_PATH = path.join(ROOT, 'docs', 'salsa', 'inventory', 'routes.json');
const CONTROL_INVENTORY_PATH = path.join(ROOT, 'docs', 'salsa', 'inventory', 'control-plane-routes.json');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function operationsOf(document) {
  const methods = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace']);
  return Object.entries(document.paths).flatMap(([pathKey, pathItem]) => Object.entries(pathItem)
    .filter(([method]) => methods.has(method))
    .map(([method, operation]) => ({ pathKey, method, operation })));
}

function validateOpenApi({ document, dataInventory, controlInventory }) {
  const errors = [];
  const operations = operationsOf(document);
  const operationIds = new Set();

  if (document.openapi !== '3.0.3') errors.push(`OPENAPI_VERSION_UNEXPECTED:${document.openapi}`);
  if (document.info?.['x-neem-contract-status'] !== 'inventory_derived') errors.push('CONTRACT_STATUS_MUST_BE_INVENTORY_DERIVED');
  if (document['x-neem-route-audit']?.overallProductionReadiness?.status !== 'not_evaluated') {
    errors.push('OPENAPI_MUST_NOT_EVALUATE_PRODUCTION_READINESS');
  }

  const expectedData = dataInventory.metadata?.totalExtracted || dataInventory.routes?.length || 0;
  const expectedControl = controlInventory.metadata?.totalRoutes || controlInventory.routes?.length || 0;
  const audit = document['x-neem-route-audit'] || {};
  if (audit.dataPlaneRoutes !== expectedData) errors.push(`DATA_PLANE_COUNT_MISMATCH:${audit.dataPlaneRoutes}:${expectedData}`);
  if (audit.controlPlaneRoutes !== expectedControl) errors.push(`CONTROL_PLANE_COUNT_MISMATCH:${audit.controlPlaneRoutes}:${expectedControl}`);
  if (audit.totalRoutes !== expectedData + expectedControl) errors.push(`TOTAL_ROUTE_COUNT_MISMATCH:${audit.totalRoutes}:${expectedData + expectedControl}`);

  for (const { pathKey, method, operation } of operations) {
    if (!operation.operationId) errors.push(`OPERATION_ID_MISSING:${method.toUpperCase()} ${pathKey}`);
    else if (operationIds.has(operation.operationId)) errors.push(`OPERATION_ID_DUPLICATE:${operation.operationId}`);
    else operationIds.add(operation.operationId);

    const parameters = Array.isArray(operation.parameters) ? operation.parameters : [];
    const declaredParams = new Set(parameters.filter((parameter) => parameter.in === 'path').map((parameter) => parameter.name));
    for (const match of pathKey.matchAll(/\{([^}]+)\}/g)) {
      if (!declaredParams.has(match[1])) errors.push(`PATH_PARAMETER_UNDECLARED:${method.toUpperCase()} ${pathKey}:${match[1]}`);
    }
    for (const parameter of parameters.filter((entry) => entry.in === 'path')) {
      if (parameter['x-neem-parameter-status'] !== 'route_derived') {
        errors.push(`PATH_PARAMETER_PROVENANCE_MISSING:${method.toUpperCase()} ${pathKey}:${parameter.name}`);
      }
      if (parameter.required !== true || parameter.schema?.type !== 'string') {
        errors.push(`PATH_PARAMETER_TRANSPORT_CONTRACT_INVALID:${method.toUpperCase()} ${pathKey}:${parameter.name}`);
      }
      if (!parameter['x-neem-source-evidence']) {
        errors.push(`PATH_PARAMETER_EVIDENCE_MISSING:${method.toUpperCase()} ${pathKey}:${parameter.name}`);
      }
      if (parameter['x-neem-parameter-semantic-status']) {
        if (parameter['x-neem-parameter-semantic-status'] !== 'source_reviewed') {
          errors.push(`PATH_PARAMETER_SEMANTIC_PROVENANCE_INVALID:${method.toUpperCase()} ${pathKey}:${parameter.name}`);
        }
        if (typeof parameter['x-neem-parameter-semantic-type'] !== 'string' || !parameter['x-neem-parameter-semantic-type']) {
          errors.push(`PATH_PARAMETER_SEMANTIC_TYPE_MISSING:${method.toUpperCase()} ${pathKey}:${parameter.name}`);
        }
        if (!parameter['x-neem-semantic-source-evidence']) {
          errors.push(`PATH_PARAMETER_SEMANTIC_EVIDENCE_MISSING:${method.toUpperCase()} ${pathKey}:${parameter.name}`);
        }
      }
    }

    const observedInputs = operation['x-neem-observed-inputs'] || {};
    for (const parameterKind of ['query', 'header']) {
      const expected = [...new Set(Array.isArray(observedInputs[`${parameterKind}Fields`]) ? observedInputs[`${parameterKind}Fields`] : [])];
      const declared = parameters.filter((parameter) => parameter.in === parameterKind);
      const declaredNames = new Set(declared.map((parameter) => parameter.name));
      for (const name of expected) {
        if (!declaredNames.has(name)) {
          errors.push(`${parameterKind.toUpperCase()}_PARAMETER_UNDECLARED:${method.toUpperCase()} ${pathKey}:${name}`);
          continue;
        }
        const parameter = declared.find((entry) => entry.name === name);
        if (!['source_observed', 'source_reviewed'].includes(parameter?.['x-neem-parameter-status'])) {
          errors.push(`${parameterKind.toUpperCase()}_PARAMETER_PROVENANCE_MISSING:${method.toUpperCase()} ${pathKey}:${name}`);
        }
      }
    }

    for (const parameter of parameters) {
      if (parameter['x-neem-parameter-status'] !== 'source_reviewed') continue;
      if (typeof parameter.required !== 'boolean') {
        errors.push(`SOURCE_REVIEWED_PARAMETER_REQUIRED_FLAG_MISSING:${method.toUpperCase()} ${pathKey}:${parameter.in}:${parameter.name}`);
      }
      if (!parameter.schema || typeof parameter.schema !== 'object' || !parameter.schema.type) {
        errors.push(`SOURCE_REVIEWED_PARAMETER_SCHEMA_MISSING:${method.toUpperCase()} ${pathKey}:${parameter.in}:${parameter.name}`);
      }
      if (!parameter['x-neem-source-evidence']) {
        errors.push(`SOURCE_REVIEWED_PARAMETER_EVIDENCE_MISSING:${method.toUpperCase()} ${pathKey}:${parameter.in}:${parameter.name}`);
      }
    }

    for (const constraint of operation['x-neem-parameter-constraints'] || []) {
      const names = Array.isArray(constraint.names) ? constraint.names : [];
      const location = constraint.location || 'query';
      const declaredNames = new Set(parameters.filter((parameter) => parameter.in === location).map((parameter) => parameter.name));
      if (constraint.rule !== 'at_least_one' || names.length < 2 || names.some((name) => !declaredNames.has(name))) {
        errors.push(`PARAMETER_CONSTRAINT_INVALID:${method.toUpperCase()} ${pathKey}`);
      }
    }

    const schemaStatus = operation['x-neem-request-schema-status'];
    if (schemaStatus === 'source_reviewed') {
      const ref = operation.requestBody?.content?.['application/json']?.schema?.$ref;
      if (!ref || !ref.startsWith('#/components/schemas/')) errors.push(`REQUEST_SCHEMA_REF_MISSING:${method.toUpperCase()} ${pathKey}`);
      else if (!document.components?.schemas?.[ref.slice('#/components/schemas/'.length)]) errors.push(`REQUEST_SCHEMA_REF_UNRESOLVED:${ref}`);
    }
    if (schemaStatus === 'source_observed_fields') {
      const fields = operation['x-neem-observed-request-fields'];
      const properties = operation.requestBody?.content?.['application/json']?.schema?.properties;
      if (!Array.isArray(fields) || !fields.length) errors.push(`OBSERVED_REQUEST_FIELDS_MISSING:${method.toUpperCase()} ${pathKey}`);
      else if (!properties || fields.some((field) => !Object.prototype.hasOwnProperty.call(properties, field))) {
        errors.push(`OBSERVED_REQUEST_SCHEMA_FIELDS_MISSING:${method.toUpperCase()} ${pathKey}`);
      }
    }
    if (schemaStatus === 'source_observed_body_opaque') {
      if (operation['x-neem-observed-body-usage'] !== 'source_observed_opaque') {
        errors.push(`OBSERVED_BODY_USAGE_MISSING:${method.toUpperCase()} ${pathKey}`);
      }
      if (operation.requestBody) errors.push(`OPAQUE_REQUEST_BODY_MUST_NOT_HAVE_SCHEMA:${method.toUpperCase()} ${pathKey}`);
    }
    if (schemaStatus === 'not_defined' && operation.requestBody) errors.push(`UNDECLARED_REQUEST_BODY:${method.toUpperCase()} ${pathKey}`);
    if (!operation['x-neem-surface']) errors.push(`SURFACE_MISSING:${method.toUpperCase()} ${pathKey}`);

    const responseStatus = operation['x-neem-response-schema-status'];
    if (operation['x-neem-surface'] === 'control_plane' && pathKey === '/metrics') {
      if (responseStatus !== 'source_observed_text') errors.push(`METRICS_RESPONSE_STATUS_MISSING:${method.toUpperCase()} ${pathKey}`);
      if (operation.responses?.['200']?.content?.['text/plain']?.schema?.type !== 'string') {
        errors.push(`METRICS_CONTENT_TYPE_MISSING:${method.toUpperCase()} ${pathKey}`);
      }
    } else if (operation['x-neem-surface'] === 'control_plane') {
      if (responseStatus !== 'source_observed_envelope') errors.push(`RESPONSE_SCHEMA_STATUS_MISSING:${method.toUpperCase()} ${pathKey}`);
      const responseDataStatus = operation['x-neem-response-data-status'];
      const responseDataSources = operation['x-neem-observed-response-data-sources'];
      const responseServiceContracts = operation['x-neem-observed-response-service-contracts'];
      if (responseDataStatus === 'service_result_opaque' && !Array.isArray(responseDataSources)) {
        errors.push(`RESPONSE_DATA_SOURCES_MISSING:${method.toUpperCase()} ${pathKey}`);
      }
      if (responseDataStatus === 'source_observed_direct_object' && !responseDataSources.some((source) => source?.observedKind === 'object')) {
        errors.push(`DIRECT_RESPONSE_OBJECT_SOURCE_MISSING:${method.toUpperCase()} ${pathKey}`);
      }
      if (responseDataStatus === 'source_observed_direct_array' && !responseDataSources.some((source) => source?.observedKind === 'array')) {
        errors.push(`DIRECT_RESPONSE_ARRAY_SOURCE_MISSING:${method.toUpperCase()} ${pathKey}`);
      }
      if (responseDataStatus === 'source_observed_direct_fields') {
        const fields = operation['x-neem-observed-response-data-fields'];
        const sourceFields = responseDataSources.flatMap((source) => source?.observedFields || []);
        const schema = operation.responses?.['200']?.content?.['application/json']?.schema;
        const dataProperties = schema?.allOf?.[1]?.properties?.data?.properties;
        if (!Array.isArray(fields)) {
          errors.push(`DIRECT_RESPONSE_FIELDS_EXTENSION_UNEXPECTED:${method.toUpperCase()} ${pathKey}`);
        }
        if (!sourceFields.length || !dataProperties || sourceFields.some((field) => !Object.prototype.hasOwnProperty.call(dataProperties, field))) {
          errors.push(`DIRECT_RESPONSE_FIELDS_SOURCE_MISSING:${method.toUpperCase()} ${pathKey}`);
        }
      }
      if (responseDataStatus === 'source_observed_service_fields' || responseDataStatus === 'source_observed_service_array') {
        const expectedKind = responseDataStatus === 'source_observed_service_fields' ? 'object' : 'array';
        if (!Array.isArray(responseServiceContracts) || !responseServiceContracts.some((contract) => contract.status === 'source_observed_service_return' && contract.kind === expectedKind)) {
          errors.push(`SERVICE_RESPONSE_CONTRACT_MISSING:${method.toUpperCase()} ${pathKey}:${expectedKind}`);
        }
      }
      for (const [status, response] of Object.entries(operation.responses || {})) {
        if (status === '204') continue;
        const schema = response.content?.['application/json']?.schema;
        const refs = [
          schema?.$ref,
          ...(Array.isArray(schema?.allOf) ? schema.allOf.map((part) => part?.$ref) : [])
        ].filter(Boolean);
        const hasResolvedRef = refs.some((schemaRef) => document.components?.schemas?.[schemaRef.replace('#/components/schemas/', '')]);
        if (!hasResolvedRef) {
          errors.push(`RESPONSE_SCHEMA_REF_MISSING:${method.toUpperCase()} ${pathKey}:${status}`);
        }
      }
    } else if (operation['x-neem-surface'] === 'westo_data_plane' && responseStatus === 'source_observed_json_shape') {
      const observedStatuses = Object.entries(operation.responses || {})
        .filter(([status]) => Number(status) >= 200 && Number(status) < 300 && status !== '204');
      if (!observedStatuses.length) {
        errors.push(`DATA_PLANE_RESPONSE_SCHEMA_MISSING:${method.toUpperCase()} ${pathKey}`);
      }
      const responseDataStatus = operation['x-neem-response-data-status'];
      const rootFields = operation['x-neem-observed-response-root-fields'];
      const helperFields = operation['x-neem-observed-response-helper-fields'];
      for (const [status, response] of observedStatuses) {
        const schema = response.content?.['application/json']?.schema;
        if (!schema) {
          errors.push(`DATA_PLANE_RESPONSE_CONTENT_MISSING:${method.toUpperCase()} ${pathKey}:${status}`);
          continue;
        }
        if (responseDataStatus === 'source_observed_data_plane_fields' || responseDataStatus === 'source_observed_data_plane_helper_fields' || responseDataStatus === 'source_observed_data_plane_envelope' || responseDataStatus === 'source_observed_data_plane_service_fields') {
          const properties = schema.properties || {};
          const expectedFields = responseDataStatus === 'source_observed_data_plane_fields'
            ? rootFields
            : responseDataStatus === 'source_observed_data_plane_helper_fields'
              ? helperFields
              : responseDataStatus === 'source_observed_data_plane_service_fields'
                ? operation['x-neem-observed-response-service-fields']
                : ['data', 'meta', 'error'];
          if (!Array.isArray(expectedFields) || !expectedFields.length || expectedFields.some((field) => !Object.prototype.hasOwnProperty.call(properties, field))) {
          errors.push(`DATA_PLANE_RESPONSE_FIELDS_MISSING:${method.toUpperCase()} ${pathKey}:${status}`);
        }
        } else if (responseDataStatus === 'source_observed_data_plane_array' && schema.type !== 'array') {
          errors.push(`DATA_PLANE_RESPONSE_ARRAY_SHAPE_MISSING:${method.toUpperCase()} ${pathKey}:${status}`);
        } else if (responseDataStatus === 'source_observed_data_plane_object' && schema.type !== 'object') {
          errors.push(`DATA_PLANE_RESPONSE_OBJECT_SHAPE_MISSING:${method.toUpperCase()} ${pathKey}:${status}`);
        }
      }
    } else if (operation['x-neem-surface'] === 'westo_data_plane' && responseStatus === 'source_observed_non_json') {
      const mode = operation['x-neem-observed-response-mode'];
      const validModes = new Set(['redirect', 'event_stream', 'delegated', 'empty', 'manifest', 'javascript', 'javascript_file', 'html_file', 'text']);
      if (!validModes.has(mode)) errors.push(`DATA_PLANE_RESPONSE_MODE_INVALID:${method.toUpperCase()} ${pathKey}:${mode}`);
      const expectedContentType = mode === 'event_stream'
        ? 'text/event-stream'
        : mode === 'javascript' || mode === 'javascript_file'
          ? 'application/javascript'
          : mode === 'manifest'
            ? 'application/manifest+json'
            : mode === 'html_file'
              ? 'text/html'
              : mode === 'text'
                ? 'text/plain'
                : null;
      for (const [status, response] of Object.entries(operation.responses || {})) {
        const successful = Number(status) >= 200 && Number(status) < 300;
        if (!successful || status === '204' || ['redirect', 'empty', 'delegated'].includes(mode)) continue;
        if (!response.content?.[expectedContentType]?.schema || response.content[expectedContentType].schema.type !== 'string') {
          errors.push(`DATA_PLANE_NON_JSON_CONTENT_MISSING:${method.toUpperCase()} ${pathKey}:${status}:${expectedContentType}`);
        }
      }
    }
  }

  for (const scheme of ['NeemPlatformSession', 'NeemMetricsToken', 'NeemBridgeSignature', 'NeemGatewaySignature']) {
    if (!document.components?.securitySchemes?.[scheme]) errors.push(`SECURITY_SCHEME_MISSING:${scheme}`);
  }

  return {
    ok: errors.length === 0,
    errors,
    operations: operations.length,
    paths: Object.keys(document.paths).length,
    dataPlaneRoutes: expectedData,
    controlPlaneRoutes: expectedControl,
    sourceReviewedRequestContracts: operations.filter(({ operation }) => operation['x-neem-request-schema-status'] === 'source_reviewed').length
  };
}

function main() {
  const result = validateOpenApi({
    document: readJson(OPENAPI_PATH),
    dataInventory: readJson(DATA_INVENTORY_PATH),
    controlInventory: readJson(CONTROL_INVENTORY_PATH)
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ok) process.exitCode = 1;
}

if (require.main === module) main();

module.exports = { validateOpenApi, operationsOf };
