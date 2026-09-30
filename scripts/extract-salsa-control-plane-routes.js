'use strict';

/**
 * Deterministically inventory the routes mounted by the NEEM Control Plane.
 *
 * The main WESTO route audit intentionally covers the data-plane files. This
 * companion inventory closes the other half of the contract: routes mounted by
 * server/salsa/control-plane/app.js and their source-level auth evidence.
 * It is static and non-mutating; it never imports the application or starts a
 * database connection.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
const CONTROL_ROOT = path.join(ROOT, 'server', 'salsa', 'control-plane');
const APP_FILE = path.join(CONTROL_ROOT, 'app.js');

const FEATURE_BY_MODULE = {
  auth: 'core.workspace',
  overview: 'platform.api',
  tenant: 'platform.multi_branch',
  'tenant-provisioning': 'platform.multi_branch',
  audit: 'platform.api',
  policy: 'platform.api',
  billing: 'finance.workspace',
  automation: 'platform.api',
  infra: 'brand.custom_domain',
  edge: 'platform.edge',
  backup: 'platform.backup_plus',
  identity: 'staff.management',
  integration: 'platform.api',
  metrics: 'insights.analytics',
  release: 'platform.desktop',
  support: 'platform.support_plus',
  contract: 'platform.api'
};

const GLOBAL_SESSION_FILES = new Set([
  'automation',
  'backup',
  'infra',
  'policy',
  'release',
  'support'
]);

function lineNumber(source, offset) {
  return source.slice(0, offset).split('\n').length;
}

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, ' '))
    .replace(/(^|\s)\/\/.*$/gm, (match) => match.replace(/[^\n]/g, ' '));
}

function findMatchingParen(source, openIndex) {
  let depth = 0;
  let quote = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let i = openIndex; i < source.length; i += 1) {
    const ch = source[i];
    const next = source[i + 1];

    if (lineComment) {
      if (ch === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (ch === '*' && next === '/') {
        blockComment = false;
        i += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === '/' && next === '/') {
      lineComment = true;
      i += 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      blockComment = true;
      i += 1;
      continue;
    }
    if (ch === '\'' || ch === '"' || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '(') depth += 1;
    if (ch === ')') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function splitFirstArgument(argumentText) {
  let parens = 0;
  let brackets = 0;
  let braces = 0;
  let quote = null;
  let escaped = false;

  for (let i = 0; i < argumentText.length; i += 1) {
    const ch = argumentText[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '\'' || ch === '"' || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '(') parens += 1;
    else if (ch === ')') parens -= 1;
    else if (ch === '[') brackets += 1;
    else if (ch === ']') brackets -= 1;
    else if (ch === '{') braces += 1;
    else if (ch === '}') braces -= 1;
    else if (ch === ',' && parens === 0 && brackets === 0 && braces === 0) {
      return {
        first: argumentText.slice(0, i).trim(),
        rest: argumentText.slice(i + 1).trim()
      };
    }
  }
  return { first: argumentText.trim(), rest: '' };
}

function parsePathLiterals(firstArgument) {
  const source = firstArgument.trim();
  if (!source.startsWith('[') && !/^['"]/.test(source)) return [];
  const paths = [];
  const literalPattern = /(['"])(.*?)\1/g;
  let match;
  while ((match = literalPattern.exec(source))) {
    paths.push(match[2]);
  }
  return paths;
}

function extractRegistrations(source, relativeFile) {
  const sanitized = stripComments(source);
  const registrations = [];
  const pattern = /(?:^|\n)\s*(router|app)\.(get|post|put|patch|delete)\s*\(/g;
  let match;

  while ((match = pattern.exec(sanitized))) {
    const openIndex = sanitized.indexOf('(', match.index + match[0].length - 1);
    const closeIndex = findMatchingParen(sanitized, openIndex);
    if (openIndex < 0 || closeIndex < 0) continue;
    const args = sanitized.slice(openIndex + 1, closeIndex);
    const { first, rest } = splitFirstArgument(args);
    const paths = parsePathLiterals(first);
    for (const routePath of paths) {
      registrations.push({
        method: match[2].toUpperCase(),
        routePath,
        sourceFile: relativeFile,
        sourceLine: lineNumber(source, match.index + match[0].length - 1),
        snippet: rest
      });
    }
    pattern.lastIndex = closeIndex + 1;
  }

  return registrations;
}

function extractRequiredRoles(snippet) {
  const roleMatch = snippet.match(/requirePlatformRole\s*\(\s*\[([^\]]*)\]/s);
  if (!roleMatch && /requirePlatformRole\s*\(\s*READ_ROLES\s*\)/.test(snippet)) {
    return ['platform_owner', 'platform_operations', 'platform_support', 'platform_finance', 'platform_readonly'];
  }
  if (!roleMatch) return [];
  return [...roleMatch[1].matchAll(/['"]([^'"]+)['"]/g)].map((match) => match[1]);
}

function joinMount(mount, routePath) {
  if (!mount) return routePath || '/';
  const left = mount.replace(/\/$/, '');
  const right = routePath === '/' ? '' : `/${routePath.replace(/^\//, '')}`;
  return `${left}${right}` || '/';
}

function operationId(method, routePath, sourceFile) {
  const digest = crypto.createHash('sha1').update(`${method} ${routePath} ${sourceFile}`).digest('hex').slice(0, 10);
  const slug = routePath
    .replace(/:([A-Za-z0-9_]+)/g, '$1')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'root';
  return `CP_${method}_${slug}_${digest}`;
}

function moduleNameFromFile(file) {
  return path.basename(file, '.js').replace(/-routes$/, '');
}

function authMetadata(route, moduleName, globalSession) {
  const snippet = route.snippet || '';
  const roles = extractRequiredRoles(snippet);
  // support-routes intentionally registers tenant approval before the router
  // wide authenticatePlatform middleware. The one-time token in the JSON body
  // is the out-of-band tenant proof for this route, so it must not inherit the
  // file-level platform session guard or be mislabelled as unauthenticated.
  if (moduleName === 'support' && route.routePath === '/sessions/tenant-approval') {
    return { guard: 'tenantApprovalToken', authMode: 'tenant_approval_token', roles };
  }
  if (snippet.includes('verifyMetricsToken')) {
    return { guard: 'verifyMetricsToken', authMode: 'metrics_token', roles };
  }
  if (snippet.includes('verifyGatewayCallbackSignature')) {
    return { guard: 'verifyGatewayCallbackSignature', authMode: 'gateway_hmac', roles };
  }
  if (snippet.includes('verifyBridgeSignature') || moduleName === 'integration') {
    return { guard: 'verifyBridgeSignature', authMode: 'bridge_hmac', roles };
  }
  if (moduleName === 'edge' && (route.routePath === '/leases/renew' || route.routePath === '/sync')) {
    return { guard: 'validateEdgeLease', authMode: 'edge_lease', roles };
  }
  if (snippet.includes('platformGuard')) {
    return { guard: 'platformGuard', authMode: 'platform_session', roles };
  }
  if (snippet.includes('authenticatePlatform') || globalSession) {
    return { guard: 'authenticatePlatform', authMode: 'platform_session', roles };
  }
  if (snippet.includes('requirePlatformRole')) {
    return { guard: 'requirePlatformRole', authMode: 'platform_session', roles };
  }
  return { guard: 'public', authMode: 'public', roles };
}

function targetPermission(route, moduleName) {
  const action = ['GET', 'HEAD', 'OPTIONS'].includes(route.method) ? 'read' : 'manage';
  const normalized = route.routePath
    .replace(/^\/+/, '')
    .replace(/:[A-Za-z0-9_]+/g, 'id')
    .replace(/[^A-Za-z0-9]+/g, '.')
    .replace(/^\.|\.$/g, '') || 'root';
  return `control.${moduleName}.${normalized}:${action}`;
}

function collectDestructuredFields(snippet, sourceName) {
  const fields = new Set();
  const destructure = new RegExp(`(?:const|let|var)\\s*\\{([^}]+)\\}\\s*=\\s*req\\.${sourceName}`, 'g');
  for (const match of snippet.matchAll(destructure)) {
    for (const part of match[1].split(',')) {
      const field = part.trim().split(/\s*[:=]\s*/)[0].replace(/\.\.\./, '').trim();
      if (/^[A-Za-z_$][\w$]*$/.test(field)) fields.add(field);
    }
  }
  const propertyPattern = new RegExp(`req\\.${sourceName}(?:\\?|)\\.([A-Za-z_$][\\w$]*)`, 'g');
  for (const match of snippet.matchAll(propertyPattern)) fields.add(match[1]);
  const bracketPattern = new RegExp(`req\\.${sourceName}(?:\\?|)\\[\\s*['"]([^'"]+)['"]\\s*\\]`, 'g');
  for (const match of snippet.matchAll(bracketPattern)) fields.add(match[1]);
  return [...fields].sort();
}

function collectAliasedBodyFields(snippet) {
  const fields = new Set();
  const splitArguments = (raw) => {
    const args = [];
    let current = '';
    let parenDepth = 0;
    let braceDepth = 0;
    let bracketDepth = 0;
    let quote = null;
    let escaped = false;
    for (const ch of raw) {
      if (quote) {
        current += ch;
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === quote) quote = null;
        continue;
      }
      if (ch === '\'' || ch === '"' || ch === '`') {
        quote = ch;
        current += ch;
        continue;
      }
      if (ch === '(') parenDepth += 1;
      else if (ch === ')') parenDepth -= 1;
      else if (ch === '{') braceDepth += 1;
      else if (ch === '}') braceDepth -= 1;
      else if (ch === '[') bracketDepth += 1;
      else if (ch === ']') bracketDepth -= 1;
      if (ch === ',' && parenDepth === 0 && braceDepth === 0 && bracketDepth === 0) {
        args.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    if (current.trim() || raw.trim().endsWith(',')) args.push(current.trim());
    return args;
  };
  const calls = [...snippet.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)];
  for (const call of calls) {
    const helperName = call[1];
    const openIndex = snippet.indexOf('(', call.index);
    const closeIndex = openIndex >= 0 ? findMatchingParen(snippet, openIndex) : -1;
    if (openIndex < 0 || closeIndex < 0) continue;
    const callArgs = splitArguments(snippet.slice(openIndex + 1, closeIndex));
    const bodyArgumentIndex = callArgs.findIndex((argument) => /\breq\.body\b/.test(argument));
    if (bodyArgumentIndex < 0) continue;
    const declaration = new RegExp(`(?:async\\s+)?function\\s+${helperName}\\s*\\(([^)]*)\\)`);
    const arrow = new RegExp(`(?:const|let|var)\\s+${helperName}\\s*=\\s*(?:async\\s*)?\\(([^)]*)\\)\\s*=>`);
    const match = declaration.exec(snippet) || arrow.exec(snippet);
    if (!match) continue;
    const parameters = splitArguments(match[1]);
    const targetParameter = String(parameters[bodyArgumentIndex] || '').trim();
    if (!targetParameter || targetParameter.startsWith('{')) continue;
    const escapedParameter = targetParameter.replace(/\s*=.*$/, '').trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const bodyStart = snippet.indexOf('{', match.index + match[0].length);
    const bodyEnd = bodyStart >= 0 ? matchingBrace(snippet, bodyStart) : -1;
    const helperBody = bodyStart >= 0 && bodyEnd >= 0 ? snippet.slice(bodyStart, bodyEnd + 1) : snippet;
    const propertyPattern = new RegExp(`\\b${escapedParameter}(?:\\?|)\\.([A-Za-z_$][\\w$]*)`, 'g');
    for (const property of helperBody.matchAll(propertyPattern)) fields.add(property[1]);
    const bracketPattern = new RegExp(`\\b${escapedParameter}(?:\\?|)\\[\\s*['\"]([^'\"]+)['\"]\\s*\\]`, 'g');
    for (const property of helperBody.matchAll(bracketPattern)) fields.add(property[1]);
  }
  return [...fields].sort();
}

function collectHeaderFields(snippet) {
  const fields = new Set();
  for (const match of snippet.matchAll(/req\.headers\[['"]([^'"]+)['"]\]/g)) fields.add(match[1].toLowerCase());
  for (const match of snippet.matchAll(/req\.headers\.([A-Za-z_$][\w$]*)/g)) fields.add(match[1].toLowerCase());
  return [...fields].sort();
}

function matchingBrace(source, openIndex) {
  let depth = 0;
  let quote = null;
  let escaped = false;

  for (let index = openIndex; index < source.length; index += 1) {
    const ch = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '\'' || ch === '"' || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function objectLiteralFields(source, propertyName) {
  const fields = new Set();
  const propertyPattern = new RegExp(`\\b${propertyName}\\s*:\\s*\\{`, 'g');
  let match;

  while ((match = propertyPattern.exec(source))) {
    const openIndex = source.indexOf('{', match.index + match[0].length - 1);
    const closeIndex = matchingBrace(source, openIndex);
    if (openIndex < 0 || closeIndex < 0) continue;

    let depth = 0;
    let quote = null;
    let escaped = false;
    const body = source.slice(openIndex + 1, closeIndex);
    for (let index = 0; index < body.length; index += 1) {
      const ch = body[index];
      if (quote) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === quote) quote = null;
        continue;
      }
      if (ch === '\'' || ch === '"' || ch === '`') {
        quote = ch;
        continue;
      }
      if (ch === '{' || ch === '[' || ch === '(') {
        depth += 1;
        continue;
      }
      if (ch === '}' || ch === ']' || ch === ')') {
        depth = Math.max(0, depth - 1);
        continue;
      }
      if (depth !== 0) continue;
      const before = body.slice(0, index).trimEnd();
      if (before && !/[{,]$/.test(before)) continue;
      const fieldMatch = body.slice(index).match(/^([A-Za-z_$][\w$]*)\s*:/);
      if (fieldMatch) {
        fields.add(fieldMatch[1]);
        index += fieldMatch[0].length - 1;
        continue;
      }
      const shorthandMatch = body.slice(index).match(/^([A-Za-z_$][\w$]*)\s*(?=,|$)/);
      if (shorthandMatch) {
        fields.add(shorthandMatch[1]);
        index += shorthandMatch[0].length - 1;
      }
    }
    propertyPattern.lastIndex = closeIndex + 1;
  }

  return [...fields].sort();
}

function collectResponseDataSources(source) {
  const assignments = new Map();
  const objectAssignments = new Set();
  const objectAssignmentFields = new Map();
  const arrayAssignments = new Set();
  const assignmentPattern = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:await\s+)?([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+)\s*\(/g;
  for (const match of source.matchAll(assignmentPattern)) {
    assignments.set(match[1], match[2]);
    if (/^(?:JSON\.parse|Object\.fromEntries|structuredClone)$/.test(match[2])) objectAssignments.add(match[1]);
  }
  for (const match of source.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*\{/g)) {
    const openIndex = source.indexOf('{', match.index);
    const fields = objectLiteralFields(`${match[1]}: ${source.slice(openIndex)}`, match[1]);
    objectAssignments.add(match[1]);
    objectAssignmentFields.set(match[1], fields);
  }
  for (const match of source.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*[^;\n]*\.rows\b/g)) {
    arrayAssignments.add(match[1]);
  }

  const sources = [];
  const dataPattern = /\bdata\s*:\s*([^,}\n]+)/g;
  for (const match of source.matchAll(dataPattern)) {
    const expression = match[1].trim();
    if (!expression || expression.startsWith('{') || expression.startsWith('[')) continue;
    const rowsExpression = expression.match(/^([A-Za-z_$][\w$]*)\.rows\b/);
    if (rowsExpression) {
      sources.push({ expression, serviceCall: null, observedKind: 'array', sourceKind: 'query_rows' });
      continue;
    }
    const identifier = expression.match(/^([A-Za-z_$][\w$]*)$/)?.[1];
    const directCall = expression.match(/^(?:await\s+)?([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+)\s*\(/)?.[1];
    if (!identifier && !directCall) continue;
    const serviceCall = directCall || (identifier && !objectAssignments.has(identifier) && !arrayAssignments.has(identifier) ? assignments.get(identifier) : null);
    sources.push({
      expression,
      serviceCall,
      ...(identifier && objectAssignments.has(identifier) ? {
        observedKind: 'object',
        sourceKind: 'local_binding',
        ...(objectAssignmentFields.get(identifier)?.length ? { observedFields: objectAssignmentFields.get(identifier) } : {})
      } : {}),
      ...(identifier && arrayAssignments.has(identifier) ? { observedKind: 'array', sourceKind: 'query_rows' } : {})
    });
  }

  const unique = new Map();
  for (const source of sources) {
    const key = `${source.expression}:${source.serviceCall || ''}`;
    if (!unique.has(key)) unique.set(key, source);
  }
  return [...unique.values()];
}

function namedHandlerSource(source, snippet) {
  const finalName = String(snippet || '').trim().match(/([A-Za-z_$][\w$]*)\s*$/)?.[1];
  const names = finalName ? new Set([finalName]) : new Set();
  const bodies = [];
  for (const name of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const declaration = source.match(new RegExp(`function\\s+${escaped}\\s*\\(`, 'm'));
    if (declaration) {
      const openParen = source.indexOf('(', declaration.index);
      const closeParen = findMatchingParen(source, openParen);
      if (closeParen < 0) continue;
      const openBrace = source.indexOf('{', closeParen + 1);
      const closeBrace = openBrace < 0 ? -1 : matchingBrace(source, openBrace);
      if (closeBrace >= 0) bodies.push(source.slice(declaration.index, closeBrace + 1));
      continue;
    }

    const arrow = source.match(new RegExp(`(?:const|let|var)\\s+${escaped}\\s*=\\s*(?:async\\s+)?(?:\\([^)]*\\)|[A-Za-z_$][\\w$]*)\\s*=>`, 'm'));
    if (!arrow) continue;
    const bodyStart = arrow.index + arrow[0].length;
    let depth = 0;
    let quote = null;
    let escapedQuote = false;
    let end = source.length;
    for (let index = bodyStart; index < source.length; index += 1) {
      const ch = source[index];
      if (quote) {
        if (escapedQuote) escapedQuote = false;
        else if (ch === '\\') escapedQuote = true;
        else if (ch === quote) quote = null;
        continue;
      }
      if (ch === '\'' || ch === '"' || ch === '`') {
        quote = ch;
        continue;
      }
      if (ch === '(' || ch === '[' || ch === '{') {
        depth += 1;
        continue;
      }
      if (ch === ')' || ch === ']' || ch === '}') {
        depth = Math.max(0, depth - 1);
        continue;
      }
      if (depth === 0 && ch === ';') {
        end = index;
        break;
      }
    }
    bodies.push(source.slice(arrow.index, end));
  }
  return bodies.join('\n');
}

function collectObservedContractSignals(snippet, routePath) {
  const bodyFields = [...new Set([
    ...collectDestructuredFields(snippet, 'body'),
    ...collectAliasedBodyFields(snippet)
  ])].sort();
  const statusCodes = [...new Set([
    ...[...snippet.matchAll(/res\.status\(\s*(\d{3})\s*\)/g)].map((match) => Number(match[1])),
    ...[...snippet.matchAll(/res\.redirect\(\s*(\d{3})\s*,/g)].map((match) => Number(match[1]))
  ])].sort((a, b) => a - b);
  const responseEnvelope = {
    successFlag: /success\s*:\s*(?:true|false)/.test(snippet),
    dataField: /\bdata\s*:/.test(snippet),
    errorField: /\berror\s*:/.test(snippet)
  };
  return {
    bodyFields,
    bodyUsage: bodyFields.length ? 'source_observed_fields' : (/\breq\.body\b/.test(snippet) ? 'source_observed_opaque' : 'not_observed'),
    queryFields: collectDestructuredFields(snippet, 'query'),
    pathFields: [...String(routePath).matchAll(/:([A-Za-z0-9_]+)/g)].map((match) => match[1]),
    headerFields: collectHeaderFields(snippet),
    statusCodes,
    responseDataFields: objectLiteralFields(snippet, 'data'),
    responseDataSources: collectResponseDataSources(snippet),
    responseEnvelope
  };
}

function readMounts(appSource) {
  const modules = new Map();
  const requirePattern = /const\s+(\w+)\s*=\s*require\(['"]\.\/routes\/([^'"]+)['"]\)/g;
  let match;
  while ((match = requirePattern.exec(appSource))) {
    modules.set(match[1], match[2].replace(/\.js$/, '').replace(/-routes$/, ''));
  }

  const mounts = [];
  const usePattern = /app\.use\(\s*(?:(['"])(.*?)\1\s*,\s*)?(\w+)\s*\)/g;
  while ((match = usePattern.exec(appSource))) {
    const variable = match[3];
    const moduleName = modules.get(variable);
    if (!moduleName) continue;
    mounts.push({ moduleName, mount: match[2] || '', globalSession: GLOBAL_SESSION_FILES.has(moduleName) });
  }
  return mounts;
}

function buildRoute(route, mount, moduleName) {
  const auth = authMetadata(route, moduleName, mount.globalSession);
  const fullPath = joinMount(mount.mount, route.routePath);
  const sourceFile = route.sourceFile;
  const source = fs.readFileSync(path.resolve(ROOT, sourceFile), 'utf8');
  const signalSource = `${route.snippet || ''}\n${namedHandlerSource(source, route.snippet || '')}`;
  const observedInputs = collectObservedContractSignals(signalSource, route.routePath);
  return {
    id: operationId(route.method, fullPath, sourceFile),
    method: route.method,
    path: fullPath,
    sourceFile,
    sourceLine: route.sourceLine,
    registrationCondition: 'none',
    observedGuard: auth.guard,
    authMode: auth.authMode,
    allowedPlatformRoles: auth.roles,
    lifecycleStatus: 'active',
    targetFeature: FEATURE_BY_MODULE[moduleName] || 'platform.api',
    targetPermission: targetPermission(route, moduleName),
    targetScope: 'platform',
    isExempt: auth.authMode === 'public',
    rationale: `Control Plane ${moduleName} route mounted at ${mount.mount || '/'}; auth evidence extracted from source.`,
    guardAlignment: 'aligned',
    confidence: 'verified',
    decisionNotes: 'Static route registration and guard metadata are source-derived; payload schema remains a separate contract.',
    observedInputs,
    surface: 'control_plane'
  };
}

function extractControlPlaneRoutes() {
  const appSource = fs.readFileSync(APP_FILE, 'utf8');
  const mounts = readMounts(appSource);
  const routes = [];

  for (const mount of mounts) {
    const fileName = `${mount.moduleName}-routes.js`;
    const fullFile = path.join(CONTROL_ROOT, 'routes', fileName);
    if (!fs.existsSync(fullFile)) continue;
    const relativeFile = path.relative(ROOT, fullFile);
    const source = fs.readFileSync(fullFile, 'utf8');
    const moduleName = moduleNameFromFile(fileName);
    for (const route of extractRegistrations(source, relativeFile)) {
      routes.push(buildRoute(route, mount, moduleName));
    }
  }

  const appRelative = path.relative(ROOT, APP_FILE);
  for (const route of extractRegistrations(appSource, appRelative)) {
    if (!route.routePath.startsWith('/api/control')) continue;
    routes.push({
      id: operationId(route.method, route.routePath, appRelative),
      method: route.method,
      path: route.routePath,
      sourceFile: appRelative,
      sourceLine: route.sourceLine,
      registrationCondition: 'none',
      observedGuard: 'public',
      authMode: 'public',
      allowedPlatformRoles: [],
      lifecycleStatus: 'active',
      targetFeature: 'platform.api',
      targetPermission: `control.health:${route.method === 'GET' ? 'read' : 'manage'}`,
      targetScope: 'platform',
      isExempt: true,
      rationale: 'Control Plane health endpoint is intentionally unauthenticated.',
      guardAlignment: 'aligned',
      confidence: 'verified',
      decisionNotes: 'Static app-level route registration.',
      observedInputs: collectObservedContractSignals(route.snippet || '', route.routePath),
      surface: 'control_plane'
    });
  }

  const unique = new Map();
  for (const route of routes) {
    // A router can be mounted under both a canonical prefix and a compatibility
    // alias. Express resolves the first registration; OpenAPI must expose one
    // effective operation, not duplicate operations with the same method/path.
    const key = `${route.method} ${route.path}`;
    if (!unique.has(key)) unique.set(key, route);
  }
  return [...unique.values()].sort((a, b) => `${a.path} ${a.method}`.localeCompare(`${b.path} ${b.method}`));
}

function writeControlPlaneInventory(outputPath = path.join(ROOT, 'docs', 'salsa', 'inventory', 'control-plane-routes.json')) {
  const routes = extractControlPlaneRoutes();
  const document = {
    metadata: {
      title: 'SALSA Control Plane Route Inventory',
      generatedBy: 'scripts/extract-salsa-control-plane-routes.js',
      sourceOfTruth: 'server/salsa/control-plane/app.js and server/salsa/control-plane/routes/*.js',
      contractStatus: 'inventory_derived',
      totalRoutes: routes.length,
      generatedAt: new Date().toISOString()
    },
    routes
  };
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
  return { outputPath, routes, document };
}

if (require.main === module) {
  const result = writeControlPlaneInventory();
  process.stdout.write(JSON.stringify({
    ok: true,
    output: path.relative(ROOT, result.outputPath),
    routes: result.routes.length
  }, null, 2) + '\n');
}

module.exports = {
  extractControlPlaneRoutes,
  writeControlPlaneInventory,
  extractRegistrations,
  readMounts,
  parsePathLiterals,
  splitFirstArgument,
  objectLiteralFields,
  collectResponseDataSources,
  collectObservedContractSignals,
  namedHandlerSource,
  matchingBrace,
  findMatchingParen
};
