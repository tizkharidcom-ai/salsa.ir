'use strict';

/**
 * Generate the inventory-derived OpenAPI contract for the NEEM/WESTO routes.
 *
 * This is intentionally derived from the route audit rather than handwritten:
 * it gives every observed route a stable operationId and carries the target
 * capability/scope/guard as vendor extensions. Payload schemas and examples
 * remain a separate contract-hardening step and are never invented here.
 */

const fs = require('node:fs');
const path = require('node:path');
const { auditAllRoutes } = require('./audit-salsa-routes');
const {
  extractControlPlaneRoutes,
  writeControlPlaneInventory
} = require('./extract-salsa-control-plane-routes');
const { getPayloadContract, getNoBodyContract, listPayloadContracts } = require('./salsa-control-plane-payload-contracts');
const { getServiceResponseContract } = require('./salsa-control-plane-service-response-contracts');
const { getParameterContract, getPathParameterContract } = require('./salsa-parameter-contracts');

const ROOT = path.resolve(__dirname, '..');
const OUTPUT = path.join(ROOT, 'docs', 'salsa', 'contracts', 'openapi.json');
const PAYLOAD_OUTPUT = path.join(ROOT, 'docs', 'salsa', 'contracts', 'control-plane-payloads.json');

function toOpenApiPath(routePath) {
  return routePath.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
}

function featureTag(feature) {
  return String(feature || 'unresolved').replace(/[^A-Za-z0-9_.-]+/g, '-');
}

function serviceResponseContracts(route) {
  if (route.surface !== 'control_plane') return [];
  return (route.observedInputs?.responseDataSources || [])
    .filter((source) => source.serviceCall && !source.sourceKind)
    .map((source) => getServiceResponseContract({
      routeSourceFile: route.sourceFile,
      serviceCall: source.serviceCall
    }))
    .filter(Boolean);
}

function observedResponseDataShape(route) {
  if (route.surface !== 'control_plane') {
    const rootFields = [...new Set(route.observedInputs?.responseRootFields || [])].sort();
    const helperFields = [...new Set(route.observedInputs?.responseHelperFields || [])].sort();
    const rootKinds = new Set(route.observedInputs?.responseRootKinds || []);
    const rootEnvelopes = new Set(route.observedInputs?.responseRootEnvelopes || []);
    const responseMode = route.observedInputs?.responseMode || null;
    if (responseMode) return { status: 'source_observed_non_json', kind: 'non_json', mode: responseMode, fields: [] };
    const serviceFields = [...new Set(route.observedInputs?.responseServiceFields || [])].sort();
    const serviceKinds = new Set(route.observedInputs?.responseServiceKinds || []);
    if (rootEnvelopes.has('envelope')) return {
      status: 'source_observed_data_plane_envelope',
      kind: 'object',
      fields: ['data', 'meta', 'error']
    };
    if (rootFields.length) return { status: 'source_observed_data_plane_fields', kind: 'object', fields: rootFields };
    if (helperFields.length) return { status: 'source_observed_data_plane_helper_fields', kind: 'object', fields: helperFields };
    if (serviceFields.length) return { status: 'source_observed_data_plane_service_fields', kind: 'object', fields: serviceFields };
    if (serviceKinds.has('object')) return { status: 'source_observed_data_plane_service_object', kind: 'object', fields: [] };
    if (serviceKinds.has('array')) return { status: 'source_observed_data_plane_service_array', kind: 'array', fields: [] };
    if (rootKinds.has('object')) return { status: 'source_observed_data_plane_object', kind: 'object', fields: [] };
    if (rootKinds.has('array')) return { status: 'source_observed_data_plane_array', kind: 'array', fields: [] };
    return null;
  }
  const explicitFields = route.observedInputs?.responseDataFields || [];
  if (explicitFields.length) {
    return { status: 'source_observed_explicit_fields', kind: 'object', fields: explicitFields };
  }
  const responseSources = route.observedInputs?.responseDataSources || [];
  const directFields = [...new Set(responseSources.flatMap((source) => source.observedFields || []))].sort();
  if (directFields.length) {
    return { status: 'source_observed_direct_fields', kind: 'object', fields: directFields };
  }
  if (responseSources.some((source) => source.observedKind === 'object')) {
    return { status: 'source_observed_direct_object', kind: 'object', fields: [] };
  }
  if (responseSources.some((source) => source.observedKind === 'array')) {
    return { status: 'source_observed_direct_array', kind: 'array', fields: [] };
  }
  const contracts = serviceResponseContracts(route);
  const objectFields = [...new Set(contracts.flatMap((contract) => contract.status === 'source_observed_service_return' && contract.kind === 'object' ? contract.fields : []))].sort();
  if (objectFields.length) {
    return { status: 'source_observed_service_fields', kind: 'object', fields: objectFields };
  }
  const arrayContracts = contracts.filter((contract) => contract.status === 'source_observed_service_return' && contract.kind === 'array');
  if (arrayContracts.length) {
    const itemFields = [...new Set(arrayContracts.flatMap((contract) => contract.itemFields || []))].sort();
    return { status: 'source_observed_service_array', kind: 'array', fields: [], itemFields };
  }
  return null;
}

function directResponseSchema(shape) {
  if (shape.kind === 'array') {
    return {
      type: 'array',
      items: shape.itemFields?.length
        ? {
          type: 'object',
          properties: Object.fromEntries(shape.itemFields.map((field) => [field, {}])),
          additionalProperties: true
        }
        : {}
    };
  }
  return {
    type: 'object',
    ...(shape.fields?.length ? { properties: Object.fromEntries(shape.fields.map((field) => [field, {}])) } : {}),
    additionalProperties: true
  };
}

function responseMap(route) {
  const method = route.method;
  const mutation = !['GET', 'HEAD', 'OPTIONS'].includes(method);
  const observedStatuses = Array.isArray(route.observedInputs?.statusCodes)
    ? route.observedInputs.statusCodes
    : [];
  const statuses = new Set([
    200,
    400,
    401,
    403,
    404,
    ...(mutation ? [409] : []),
    500,
    ...observedStatuses
  ]);
  const isMetrics = route.surface === 'control_plane' && route.path === '/metrics';
  const isControlPlane = route.surface === 'control_plane';
  const observedDataShape = observedResponseDataShape(route);
  const observedNonJson = observedDataShape?.kind === 'non_json';
  const responses = {};

  for (const status of [...statuses].sort((a, b) => a - b)) {
    const successful = status >= 200 && status < 300;
    const response = {
      description: successful
        ? (mutation ? 'Observed successful mutation response.' : 'Observed successful read response.')
        : status === 401
          ? 'Authentication is required or the session is invalid.'
          : status === 403
            ? 'The principal lacks the effective capability or scope.'
            : status === 404
              ? 'The requested resource or route was not found.'
              : status === 409
                ? 'The mutation conflicts with current state or idempotency.'
                : status === 422
                  ? 'The request failed source-observed semantic validation.'
                  : status === 429
                    ? 'The request was rate limited.'
                    : status === 503
                      ? 'The dependency or service is temporarily unavailable.'
                      : 'Observed or contract-defined error response.'
    };

    const responseHasNoBody = observedNonJson
      && ['redirect', 'empty', 'delegated'].includes(observedDataShape.mode)
      && (successful || (status >= 300 && status < 400));
    if (status !== 204 && (!isMetrics || !successful) && !responseHasNoBody) {
      const responseSchema = successful && observedDataShape && !observedNonJson
        ? (isControlPlane ? {
          allOf: [
            { $ref: '#/components/schemas/ObservedControlPlaneSuccessResponse' },
            {
              type: 'object',
              required: ['data'],
              properties: {
                data: {
                  type: observedDataShape.kind,
                  ...(observedDataShape.kind === 'object' ? {
                    properties: Object.fromEntries(observedDataShape.fields.map((field) => [field, {}])),
                    additionalProperties: true
                  } : {
                    items: observedDataShape.itemFields?.length
                      ? {
                        type: 'object',
                        properties: Object.fromEntries(observedDataShape.itemFields.map((field) => [field, {}])),
                        additionalProperties: true
                      }
                      : {}
                  }),
                    description: ['source_observed_service_fields', 'source_observed_data_plane_service_fields'].includes(observedDataShape.status)
                    ? 'Top-level response data fields observed in the called service return expression; nested values remain operation-specific.'
                      : ['source_observed_service_array', 'source_observed_data_plane_service_array'].includes(observedDataShape.status)
                      ? 'Array response kind observed in the called service return expression; item schema remains operation-specific.'
                      : observedDataShape.status === 'source_observed_direct_array'
                        ? 'Array response kind observed directly in the route source; item schema remains operation-specific.'
                      : observedDataShape.status === 'source_observed_direct_object'
                          ? 'Object response kind observed directly in the route source; field schema remains operation-specific.'
                        : observedDataShape.status === 'source_observed_direct_fields'
                          ? 'Top-level response data fields observed through a local route binding; nested values remain operation-specific.'
                      : 'Top-level response data fields observed directly in the route source; nested values remain operation-specific.'
                }
              }
            }
          ]
        } : directResponseSchema(observedDataShape))
        : { $ref: `#/components/schemas/${successful
          ? (isControlPlane ? 'ObservedControlPlaneSuccessResponse' : 'ObservedDataPlaneSuccessResponse')
          : (isControlPlane ? 'ObservedControlPlaneErrorResponse' : 'ObservedDataPlaneErrorResponse')}` };
      if (observedNonJson && successful) {
        const mediaType = observedDataShape.mode === 'event_stream'
          ? 'text/event-stream'
          : observedDataShape.mode === 'javascript' || observedDataShape.mode === 'javascript_file'
            ? 'application/javascript'
            : observedDataShape.mode === 'manifest'
              ? 'application/manifest+json'
              : observedDataShape.mode === 'html_file'
                ? 'text/html'
                : 'text/plain';
        response.content = { [mediaType]: { schema: { type: 'string' } } };
      } else {
        response.content = {
          'application/json': {
            schema: responseSchema
          }
        };
      }
    } else if (isMetrics && successful) {
      response.content = {
        'text/plain': {
          schema: { type: 'string' }
        }
      };
    }

    responses[String(status)] = response;
  }

  return responses;
}

function pathParameters(route) {
  return [...String(route.path).matchAll(/:([A-Za-z0-9_]+)/g)].map((match) => {
    const name = match[1];
    const semantic = getPathParameterContract(route.method, toOpenApiPath(route.path), name);
    return {
      name,
      in: 'path',
      required: true,
      schema: semantic?.schema || { type: 'string' },
      description: semantic?.description || `Path parameter ${name} extracted from the registered route; semantic identifier type remains source/domain review pending.`,
      'x-neem-parameter-status': 'route_derived',
      'x-neem-source-evidence': `${route.sourceFile}:${route.sourceLine}`,
      ...(semantic ? {
        'x-neem-parameter-semantic-status': 'source_reviewed',
        'x-neem-parameter-semantic-type': semantic.semanticType,
        'x-neem-semantic-source-evidence': semantic.sourceEvidence
      } : {})
    };
  });
}

function observedInputParameters(route) {
  const parameters = pathParameters(route);
  const contract = getParameterContract(route.method, toOpenApiPath(route.path));
  const contractParameters = new Map((contract?.parameters || []).map((parameter) => [`${parameter.in}:${parameter.name}`, parameter]));
  const declared = new Set(parameters.map((parameter) => `${parameter.in}:${parameter.name}`));

  function addParameter(location, name) {
    const identity = `${location}:${name}`;
    if (declared.has(identity)) return;
    const reviewed = contractParameters.get(identity);
    if (reviewed) {
      const { sourceEvidence, ...definition } = reviewed;
      parameters.push({
        ...definition,
        'x-neem-parameter-status': 'source_reviewed',
        'x-neem-source-evidence': sourceEvidence
      });
    } else {
      parameters.push({
        name,
        in: location,
        required: false,
        schema: { type: 'string' },
        description: location === 'query'
          ? `Query parameter ${name} observed in the route source; type, cardinality and requiredness remain source-review pending.`
          : `Header ${name} observed in the route source; requiredness and transport policy remain source-review pending.`,
        'x-neem-parameter-status': 'source_observed'
      });
    }
    declared.add(identity);
  }

  const queryFields = [...new Set(route.observedInputs?.queryFields || [])].sort();
  const headerFields = [...new Set(route.observedInputs?.headerFields || [])].sort();
  for (const name of queryFields) addParameter('query', name);
  for (const name of headerFields) addParameter('header', name);
  for (const reviewed of contract?.parameters || []) addParameter(reviewed.in, reviewed.name);
  return parameters;
}

function observedParameterConstraints(route) {
  const contract = getParameterContract(route.method, toOpenApiPath(route.path));
  return contract?.constraints || [];
}

function securityForRoute(route) {
  if (route.authMode === 'metrics_token') return [{ NeemMetricsToken: [] }];
  if (route.authMode === 'bridge_hmac') return [{ NeemBridgeSignature: [] }];
  if (route.authMode === 'gateway_hmac') return [{ NeemGatewaySignature: [] }];
  // OpenAPI security schemes cannot express a token carried in a JSON body.
  // Keep security=[] while exposing the source-derived auth mode below.
  if (route.authMode === 'edge_lease' || route.authMode === 'tenant_approval_token') return [];
  return route.isExempt ? [] : [{ NeemPlatformSession: [] }];
}

function inferredGetNoBodyContract(route) {
  if (String(route.method).toUpperCase() !== 'GET') return null;
  if (route.observedInputs?.bodyUsage !== 'not_observed') return null;
  return {
    status: 'source_reviewed_no_body',
    sourceEvidence: [{
      file: route.sourceFile,
      lines: String(route.sourceLine),
      note: 'GET route and its source-observed local handler/helper code do not access req.body; no JSON requestBody is published.'
    }]
  };
}

function observedRequestSchema(route, payloadContract) {
  if (payloadContract) return null;
  const bodyContract = route.observedInputs?.bodyContract;
  if (bodyContract?.status === 'source_reviewed_form_data') {
    return {
      type: 'object',
      properties: Object.fromEntries((bodyContract.fields || []).map((field) => [field, { type: 'string', format: 'binary' }])),
      additionalProperties: false,
      description: 'Source-reviewed multipart form-data upload fields; MIME type and size limits remain enforced by the route middleware.'
    };
  }
  const fields = route.observedInputs?.bodyFields || [];
  if (!fields.length) return null;
  return {
    type: 'object',
    properties: Object.fromEntries(fields.map((field) => [field, {}])),
    additionalProperties: true,
    description: 'Top-level request body fields observed directly in the route source; types and requiredness remain source-review pending.'
  };
}

function requestSchemaStatus(route, payloadContract, observedRequest, noBodyContract) {
  if (payloadContract) return 'source_reviewed';
  if (route.observedInputs?.bodyContract?.status === 'source_reviewed_form_data') return 'source_reviewed_form_data';
  if (observedRequest) return 'source_observed_fields';
  if (noBodyContract) return 'source_reviewed_no_body';
  if (route.observedInputs?.bodyUsage === 'source_observed_opaque') return 'source_observed_body_opaque';
  return 'not_defined';
}

function generateOpenApi(routes) {
  const paths = {};
  const tags = new Set();
  const schemas = {};

  for (const route of routes) {
    const pathKey = toOpenApiPath(route.path);
    const method = route.method.toLowerCase();
    const tag = featureTag(route.surface === 'control_plane' ? `control-plane.${route.targetFeature}` : route.targetFeature);
    tags.add(tag);
    paths[pathKey] ||= {};
    const payloadContract = getPayloadContract(route.method, pathKey);
    const noBodyContract = route.surface === 'control_plane'
      ? (getNoBodyContract(route.method, pathKey) || inferredGetNoBodyContract(route))
      : (route.observedInputs?.bodyContract?.status === 'source_reviewed_no_body'
        ? route.observedInputs.bodyContract
        : inferredGetNoBodyContract(route));
    const observedRequest = observedRequestSchema(route, payloadContract);
    const responseDataShape = observedResponseDataShape(route);
    if (payloadContract) schemas[payloadContract.name] = payloadContract.schema;
    paths[pathKey][method] = {
      operationId: route.id,
      tags: [tag],
      summary: `${route.method} ${route.path}`,
      ...(observedInputParameters(route).length ? { parameters: observedInputParameters(route) } : {}),
      security: securityForRoute(route),
      'x-neem-contract-status': 'inventory_derived',
      'x-neem-surface': route.surface || 'westo_data_plane',
      'x-neem-source': `${route.sourceFile}:${route.sourceLine}`,
      'x-neem-capability': route.targetFeature,
      'x-neem-permission': route.targetPermission || null,
      'x-neem-scope': route.targetScope,
      'x-neem-observed-guard': route.observedGuard,
      'x-neem-auth-mode': route.authMode || (route.isExempt ? 'public' : 'platform_session'),
      'x-neem-security-note': route.authMode === 'edge_lease'
        ? 'Source requires a valid lease token in the JSON body; OpenAPI has no body-token security scheme.'
        : route.authMode === 'tenant_approval_token'
          ? 'Source requires a one-time tenant approval token in the JSON body; OpenAPI has no body-token security scheme.'
          : undefined,
      'x-neem-allowed-platform-roles': route.allowedPlatformRoles || [],
      'x-neem-observed-inputs': route.observedInputs || null,
      'x-neem-parameter-constraints': observedParameterConstraints(route),
      'x-neem-request-schema-status': requestSchemaStatus(route, payloadContract, observedRequest, noBodyContract),
      'x-neem-request-no-body': noBodyContract || undefined,
      'x-neem-observed-request-fields': route.observedInputs?.bodyFields || [],
      'x-neem-observed-body-usage': route.observedInputs?.bodyUsage || 'not_observed',
      'x-neem-observed-request-contract': route.observedInputs?.bodyContract || null,
      'x-neem-observed-response-root-fields': route.observedInputs?.responseRootFields || [],
      'x-neem-observed-response-helper-fields': route.observedInputs?.responseHelperFields || [],
      'x-neem-observed-response-root-envelopes': route.observedInputs?.responseRootEnvelopes || [],
      'x-neem-observed-response-service-fields': route.observedInputs?.responseServiceFields || [],
      'x-neem-observed-response-service-kinds': route.observedInputs?.responseServiceKinds || [],
      'x-neem-observed-response-mode': route.observedInputs?.responseMode || null,
      'x-neem-response-schema-status': route.surface === 'control_plane'
        ? (route.path === '/metrics' ? 'source_observed_text' : 'source_observed_envelope')
        : (responseDataShape ? (responseDataShape.status === 'source_observed_non_json' ? 'source_observed_non_json' : 'source_observed_json_shape') : 'not_defined'),
      'x-neem-observed-response-statuses': route.observedInputs?.statusCodes || [],
      'x-neem-observed-response-data-fields': route.observedInputs?.responseDataFields || [],
      'x-neem-observed-response-data-sources': route.observedInputs?.responseDataSources || [],
      'x-neem-observed-response-service-contracts': route.surface === 'control_plane'
        ? serviceResponseContracts(route)
        : (route.observedInputs?.responseServiceSources || []),
      'x-neem-response-data-status': route.surface === 'control_plane'
        ? (route.path === '/metrics' ? 'source_observed_text' : (observedResponseDataShape(route)?.status || 'service_result_opaque'))
        : (responseDataShape?.status || 'not_defined'),
      'x-neem-guard-alignment': route.guardAlignment,
      'x-neem-lifecycle-status': route.lifecycleStatus,
      ...((payloadContract || observedRequest) ? {
        requestBody: {
          required: true,
          content: {
            [route.observedInputs?.bodyContract?.status === 'source_reviewed_form_data' ? 'multipart/form-data' : 'application/json']: {
              schema: payloadContract
                ? { $ref: `#/components/schemas/${payloadContract.name}` }
                : observedRequest
            }
          }
        }
      } : {}),
      responses: responseMap(route)
    };
  }

  return {
    openapi: '3.0.3',
    info: {
      title: 'NEEM / WESTO Route Capability Contract',
      version: 'inventory-2026-09-09',
      description: 'Inventory-derived route contract for the WESTO data plane and NEEM Control Plane. It documents observed paths and access metadata; request/response schemas must be added from domain contracts before external publication.',
      'x-neem-contract-status': 'inventory_derived'
    },
    servers: [{ url: '/', description: 'Runtime-relative base URL' }],
    tags: [...tags].sort().map((name) => ({ name })),
    components: {
      schemas: {
        ObservedControlPlaneSuccessResponse: {
          type: 'object',
          title: 'ObservedControlPlaneSuccessResponse',
          description: 'Source-observed Control Plane success envelope. The route-specific data shape remains operation-specific and is intentionally not invented here.',
          properties: {
            success: { type: 'boolean', enum: [true] },
            ok: { type: 'boolean', enum: [true] },
            data: { description: 'Route-specific successful response data; see the source-reviewed operation contract when available.' }
          },
          anyOf: [{ required: ['success'] }, { required: ['ok'] }],
          additionalProperties: true
        },
        ObservedControlPlaneErrorResponse: {
          type: 'object',
          title: 'ObservedControlPlaneErrorResponse',
          description: 'Source-observed Control Plane error envelope. Error details are intentionally permissive until the operation-specific error catalog is source-reviewed.',
          properties: {
            success: { type: 'boolean', enum: [false] },
            ok: { type: 'boolean', enum: [false] },
            error: {
              oneOf: [
                { type: 'string' },
                {
                  type: 'object',
                  properties: {
                    code: { type: 'string' },
                    message: { type: 'string' },
                    details: {}
                  },
                  additionalProperties: true
                }
              ]
            }
          },
          anyOf: [{ required: ['success'] }, { required: ['ok'] }, { required: ['error'] }],
          additionalProperties: true
        },
        ObservedDataPlaneSuccessResponse: {
          type: 'object',
          title: 'ObservedDataPlaneSuccessResponse',
          description: 'Source-observed Data Plane success response without an operation-specific envelope. The shape remains intentionally open until the domain contract is reviewed.',
          additionalProperties: true
        },
        ObservedDataPlaneErrorResponse: {
          type: 'object',
          title: 'ObservedDataPlaneErrorResponse',
          description: 'Data Plane error response placeholder. Error fields remain intentionally open until the domain contract is reviewed.',
          additionalProperties: true
        },
        ...schemas,
      },
      securitySchemes: {
        NeemPlatformSession: {
          type: 'apiKey',
          in: 'cookie',
          name: 'neem_session',
          description: 'Platform session cookie. The route capability and tenant scope are enforced server-side.'
        },
        NeemMetricsToken: {
          type: 'http',
          scheme: 'bearer',
          description: 'Metrics bearer token or equivalent x-metrics-token header; configured out of band.'
        },
        NeemBridgeSignature: {
          type: 'apiKey',
          in: 'header',
          name: 'x-westo-bridge-signature',
          description: 'Service-to-service HMAC signature. The timestamp and tenant headers are required by the bridge contract.'
        },
        NeemGatewaySignature: {
          type: 'apiKey',
          in: 'header',
          name: 'x-neem-gateway-signature',
          description: 'Payment provider callback HMAC signature paired with x-neem-gateway-timestamp.'
        }
      }
    },
    paths
  };
}

function writeOpenApi(outputPath = OUTPUT) {
  const { routes: dataPlaneRoutes, summary } = auditAllRoutes({ checkOnly: true });
  const controlPlaneRoutes = extractControlPlaneRoutes();
  const routes = [...dataPlaneRoutes, ...controlPlaneRoutes];
  writeControlPlaneInventory();
  const payloadCatalog = {
    metadata: {
      title: 'NEEM Control Plane Source-Reviewed Request Payload Contracts',
      generatedBy: 'scripts/generate-salsa-openapi.js',
      contractStatus: 'source_reviewed_subset',
      note: 'Only routes with a source-reviewed request schema are listed; all other routes remain inventory_derived.',
      totalContracts: Object.keys(listPayloadContracts()).length,
      generatedAt: new Date().toISOString()
    },
    contracts: listPayloadContracts()
  };
  fs.writeFileSync(PAYLOAD_OUTPUT, `${JSON.stringify(payloadCatalog, null, 2)}\n`, 'utf8');
  const document = generateOpenApi(routes);
  document['x-neem-route-audit'] = {
    totalRoutes: routes.length,
    totalMapped: summary.totalMapped + controlPlaneRoutes.length,
    dataPlaneRoutes: dataPlaneRoutes.length,
    controlPlaneRoutes: controlPlaneRoutes.length,
    routeCapabilityGate: summary.productionReadinessGate,
    overallProductionReadiness: summary.overallProductionReadiness,
    generatedBy: 'scripts/generate-salsa-openapi.js',
    controlPlaneInventory: 'docs/salsa/inventory/control-plane-routes.json'
  };
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
  return { outputPath, document };
}

if (require.main === module) {
  const result = writeOpenApi();
  const operations = Object.values(result.document.paths).reduce((sum, item) => sum + Object.keys(item).length, 0);
  process.stdout.write(JSON.stringify({
    ok: true,
    output: path.relative(ROOT, result.outputPath),
    paths: Object.keys(result.document.paths).length,
    operations,
    dataPlaneRoutes: result.document['x-neem-route-audit'].dataPlaneRoutes,
    controlPlaneRoutes: result.document['x-neem-route-audit'].controlPlaneRoutes,
    payloadContracts: Object.keys(listPayloadContracts()).length,
    status: result.document.info['x-neem-contract-status']
  }, null, 2) + '\n');
}

module.exports = { generateOpenApi, toOpenApiPath, writeOpenApi };
