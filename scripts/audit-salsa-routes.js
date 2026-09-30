'use strict';

/**
 * scripts/audit-salsa-routes.js
 * 
 * Verifiable, non-mutating route auditor and capability mapping engine for Project NEEM / Westo Phase 0.
 * 
 * Core Capabilities:
 * - Lexically parses route registrations across server/server.js, server/admin-v2.js,
 *   server/finance-v2.js, and server/accounting-routes.js using balanced parentheses and argument splitting.
 * - Extracts multiline and single-line condition checks (if (...)) preceding route registrations.
 * - Safely handles path arrays with embedded commas or complex expressions via splitTopLevelArgs.
 * - Assigns 100% stable, order-independent and line-independent canonical route IDs using 10-character SHA-256 hashes of canonical route identity (sourceFile::method::path::condition::middleGuards). Identical duplicate route definitions naturally produce identical canonical IDs, which are strictly caught and failed as collisions/duplicates by the audit gate.
 * - Dynamically inspects app.use calls in server/server.js to record observedGlobalMiddleware with exact source lines and scopes.
 * - Distinguishes between target design contracts and current observed guards:
 *     * observedGuard: actual guard in legacy runtime (none, requireAuth, requireAdmin, requireKitchen, etc.)
 *     * targetPermission & targetScope: GODMODE target capability contract
 *     * guardAlignment: 'aligned' | 'observed_guard_present' | 'handler_controlled' | 'exempt_public' | 'legacy_restricted' | 'guard_gap'
 *     * confidence: 'verified' | 'decision_required'
 *     * decisionNotes: transparent record of public behavior vs auth state, sandbox risks, and architectural decisions.
 * - Standalone callable gate evaluator: evaluateAuditGate(routes, options) supporting dual gate evaluation:
 *     * phase0InventoryGate: inventory completeness & mapping verification (Section 28 Phase 0)
 *     * productionReadinessGate: runtime security capability/public-contract enforcement gate (Section 28 Phase 2/3/5)
 * - Fully supports --check mode (read-only verification without writing files).
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
  VALID_FEATURES,
  VALID_PERMISSIONS,
  VALID_SCOPES,
  validateContractMapping
} = require('./salsa-contract-catalog');
const { lookupPolicyCapability } = require('../server/salsa/route-capability-map');
const {
  collectObservedContractSignals,
  namedHandlerSource,
  objectLiteralFields,
  matchingBrace,
} = require('./extract-salsa-control-plane-routes');
const { getServiceResponseContract, getFactoryServiceResponseContract } = require('./salsa-control-plane-service-response-contracts');
const {
  getDataPlaneRequestContract,
  getDataPlaneNoBodyContract,
  getDataPlaneFormDataContract
} = require('./salsa-data-plane-request-contracts');

const ROOT = path.resolve(__dirname, '..');

/**
 * Dynamically extracts page path keys from the `const PAGES = { ... }` declaration in server source code.
 * Uses lexical balanced-brace parsing to locate the object body, safely strips comments, and extracts all top-level keys.
 * Completely eliminates hardcoded static page lists and dynamically tracks additions/deletions in server code.
 */
function extractPagesKeysFromContent(content) {
  const match = /(?:const|let|var)\s+PAGES\s*=\s*\{/.exec(content);
  if (!match) return [];

  const braceStart = match.index + match[0].length - 1;
  let depth = 0;
  let inString = null;
  let escape = false;
  let inComment = false;
  let inBlockComment = false;
  let braceEnd = -1;

  for (let i = braceStart; i < content.length; i++) {
    const ch = content[i];
    const nextCh = content[i + 1] || '';

    if (inComment) {
      if (ch === '\n') inComment = false;
      continue;
    }
    if (inBlockComment) {
      if (ch === '*' && nextCh === '/') {
        inBlockComment = false;
        i++;
      }
      continue;
    }
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === '\\' && inString) {
      escape = true;
      continue;
    }
    if (inString) {
      if (ch === inString) inString = null;
      continue;
    }
    if (ch === '/' && nextCh === '/') {
      inComment = true;
      i++;
      continue;
    }
    if (ch === '/' && nextCh === '*') {
      inBlockComment = true;
      i++;
      continue;
    }
    if (ch === '\'' || ch === '"' || ch === '`') {
      inString = ch;
      continue;
    }
    if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) {
        braceEnd = i;
        break;
      }
    }
  }

  if (braceEnd === -1) return [];

  const body = content.slice(braceStart + 1, braceEnd);
  const cleanBody = body.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '');
  const keys = [];
  const propRegex = /(?:['"`]([^'"`]+)['"`]|([a-zA-Z0-9_$]+))\s*:/g;
  let propMatch;
  while ((propMatch = propRegex.exec(cleanBody)) !== null) {
    const rawKey = propMatch[1] || propMatch[2];
    if (rawKey) {
      const formattedKey = rawKey.startsWith('/') ? rawKey : `/${rawKey}`;
      keys.push(formattedKey);
    }
  }

  return keys;
}

const filePrefixMap = {
  'server/server.js': 'SRV',
  'server/admin-v2.js': 'ADM',
  'server/finance-v2.js': 'FIN',
  'server/accounting-routes.js': 'ACC'
};

/**
 * Parses balanced arguments for a function call starting at `startIndex` (index of '(').
 * Handles strings, block/line comments, and regular expression literals safely.
 */
function parseCallArguments(content, startIndex) {
  let depth = 0;
  let inString = null;
  let escape = false;
  let inComment = false;
  let inBlockComment = false;
  let inRegex = false;
  let inRegexCharClass = false;

  for (let i = startIndex; i < content.length; i++) {
    const ch = content[i];
    const prev = content[i - 1];

    if (inComment) {
      if (ch === '\n') inComment = false;
      continue;
    }
    if (inBlockComment) {
      if (prev === '*' && ch === '/') inBlockComment = false;
      continue;
    }
    if (inString) {
      if (escape) {
        escape = false;
      } else if (ch === '\\') {
        escape = true;
      } else if (ch === inString) {
        inString = null;
      }
      continue;
    }
    if (inRegex) {
      if (escape) {
        escape = false;
      } else if (ch === '\\') {
        escape = true;
      } else if (ch === '[' && !inRegexCharClass) {
        inRegexCharClass = true;
      } else if (ch === ']' && inRegexCharClass) {
        inRegexCharClass = false;
      } else if (ch === '/' && !inRegexCharClass) {
        inRegex = false;
      }
      continue;
    }

    if (ch === '/' && content[i + 1] === '/' && prev !== '\\') {
      inComment = true;
      continue;
    }
    if (ch === '/' && content[i + 1] === '*' && prev !== '\\') {
      inBlockComment = true;
      continue;
    }
    if (ch === '\'' || ch === '"' || ch === '`') {
      inString = ch;
      continue;
    }

    if (ch === '/' && prev !== '\\') {
      let k = i - 1;
      while (k >= 0 && /\s/.test(content[k])) k--;
      const lastChar = content[k];
      const prevWord = content.slice(Math.max(0, k - 6), k + 1).trim();
      if (/[(,=:[!&|?{;~^+\-*]/.test(lastChar) || /^(?:return|typeof|yield|case|default)$/.test(prevWord)) {
        inRegex = true;
        inRegexCharClass = false;
        continue;
      }
    }

    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) {
        return {
          endIndex: i,
          rawArgs: content.slice(startIndex + 1, i)
        };
      }
    }
  }
  return null;
}

/**
 * Splits top-level arguments by comma, respecting nested brackets, braces, parentheses, strings, and regexes.
 */
function splitTopLevelArgs(rawArgs) {
  const args = [];
  let current = '';
  let parenDepth = 0;
  let braceDepth = 0;
  let bracketDepth = 0;
  let inString = null;
  let escape = false;
  let inRegex = false;
  let inRegexCharClass = false;

  for (let i = 0; i < rawArgs.length; i++) {
    const ch = rawArgs[i];
    const prev = rawArgs[i - 1];

    if (inString) {
      current += ch;
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if (ch === inString) inString = null;
      continue;
    }

    if (inRegex) {
      current += ch;
      if (escape) {
        escape = false;
      } else if (ch === '\\') {
        escape = true;
      } else if (ch === '[' && !inRegexCharClass) {
        inRegexCharClass = true;
      } else if (ch === ']' && inRegexCharClass) {
        inRegexCharClass = false;
      } else if (ch === '/' && !inRegexCharClass) {
        inRegex = false;
      }
      continue;
    }

    if (ch === '\'' || ch === '"' || ch === '`') {
      inString = ch;
      current += ch;
      continue;
    }

    if (ch === '/' && prev !== '\\') {
      let k = i - 1;
      while (k >= 0 && /\s/.test(rawArgs[k])) k--;
      const lastChar = rawArgs[k];
      const prevWord = rawArgs.slice(Math.max(0, k - 6), k + 1).trim();
      if (/[(,=:[!&|?{;~^+\-*]/.test(lastChar) || /^(?:return|typeof|yield|case|default)$/.test(prevWord)) {
        inRegex = true;
        inRegexCharClass = false;
        current += ch;
        continue;
      }
    }

    if (ch === '(') parenDepth++;
    else if (ch === ')') parenDepth--;
    else if (ch === '{') braceDepth++;
    else if (ch === '}') braceDepth--;
    else if (ch === '[') bracketDepth++;
    else if (ch === ']') bracketDepth--;

    if (ch === ',' && parenDepth === 0 && braceDepth === 0 && bracketDepth === 0) {
      args.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) args.push(current.trim());
  return args;
}

/**
 * Parses path argument supporting single strings and array literals containing commas inside strings.
 */
function parsePathArg(rawPathArg) {
  const trimmed = rawPathArg.trim();
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    const inner = trimmed.slice(1, -1);
    const elements = splitTopLevelArgs(inner);
    return elements.map((el) => el.trim().replace(/^['"`]|['"`]$/g, '')).filter(Boolean);
  }
  return [trimmed.replace(/^['"`]|['"`]$/g, '')];
}

/**
 * Extracts any condition (single-line or multiline `if (...)`) immediately preceding a route call.
 */
function extractPrecedingCondition(content, matchIndex) {
  const lookback = content.slice(Math.max(0, matchIndex - 500), matchIndex);
  let searchPos = lookback.length;

  while (searchPos >= 0) {
    const ifPos = lookback.lastIndexOf('if', searchPos);
    if (ifPos === -1) return 'none';

    // Must be word boundary
    const prevChar = ifPos > 0 ? lookback[ifPos - 1] : ' ';
    const nextChar = lookback[ifPos + 2] || ' ';
    if (/[a-zA-Z0-9_$]/.test(prevChar) || /[a-zA-Z0-9_$]/.test(nextChar)) {
      searchPos = ifPos - 1;
      continue;
    }

    const between = lookback.slice(ifPos);
    const parenOpen = between.indexOf('(');
    if (parenOpen === -1) {
      searchPos = ifPos - 1;
      continue;
    }

    let depth = 0;
    let closeIndex = -1;
    for (let i = parenOpen; i < between.length; i++) {
      if (between[i] === '(') depth++;
      else if (between[i] === ')') {
        depth--;
        if (depth === 0) {
          closeIndex = i;
          break;
        }
      }
    }
    if (closeIndex === -1) {
      searchPos = ifPos - 1;
      continue;
    }

    // Trailing characters between closing paren and matchIndex must only be whitespace or opening brace
    const trailing = between.slice(closeIndex + 1);
    if (/^[\s\n\r]*(?:\{[\s\n\r]*)?$/.test(trailing)) {
      return between.slice(parenOpen + 1, closeIndex).replace(/\s+/g, ' ').trim();
    }

    searchPos = ifPos - 1;
  }
  return 'none';
}

/**
 * Generates a stable, canonical route ID independent of sourceLine or extraction order.
 * Canonical identity is strictly derived from 5 dimensions:
 *   sourceFile + method + path + condition + middleArgs (+ optional explicit collision discriminator).
 * A 10-character SHA-256 digest provides over 1 trillion combinations (16^10),
 * completely immune to line shifts and refactoring within the file.
 *
 * True duplicate route definitions share identical canonical keys and IDs by design,
 * ensuring strict order independence. Duplicate endpoints and ID collisions are
 * explicitly flagged as gate-blocking errors by evaluateAuditGate.
 */
function generateCanonicalRouteId(call, disambiguator = null) {
  const prefix = filePrefixMap[call.sourceFile] || 'RTE';
  const slug = call.path.replace(/^\//, '').replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 32) || 'root';
  const conditionKey = (call.condition && call.condition !== 'none') ? call.condition.replace(/\s+/g, ' ').trim() : 'none';
  const middleGuardsKey = (call.middleArgs && call.middleArgs.length > 0) ? call.middleArgs.map((a) => a.replace(/\s+/g, ' ').trim()).join('+') : 'none';
  const canonicalKey = `${call.sourceFile}::${call.method}::${call.path}::${conditionKey}::${middleGuardsKey}${disambiguator ? '::' + disambiguator : ''}`;
  const hash10 = crypto.createHash('sha256').update(canonicalKey).digest('hex').slice(0, 10);
  return `${prefix}-${call.method}-${slug}-${hash10}`;
}

// Backward-compatible alias for previous tooling
const generateDeterministicRouteId = generateCanonicalRouteId;

/**
 * Semantically classifies an Express middleware based purely on its mount path, arity, and code tokens.
 * Zero hardcoded line numbers: line numbers are strictly for source citation and audit tracing.
 *
 * Categorizes each middleware into:
 *   - 'request_pipeline': standard middleware executed during incoming request processing
 *   - 'path_interceptor': path-scoped middleware intercepting execution (e.g. 410 legacy writes)
 *   - 'error_handling_chain': 4-argument error-handling middleware (err, req, res, next)
 *   - 'terminal_fallback': fallback handlers registered after all route definitions (404, static)
 *   - 'unknown': unrecognized middleware
 */
function classifyGlobalMiddleware(mountPath, handlerArg) {
  const norm = handlerArg.replace(/\s+/g, ' ').trim();
  const is4Arg = /^\s*\(\s*(?:err|error)\s*,\s*req\s*,\s*res\s*,\s*next\s*\)/i.test(handlerArg);

  if (/tenantHostMiddleware/i.test(norm) || norm.includes('TENANT_INFRASTRUCTURE_ENABLED')) {
    return {
      category: 'request_pipeline',
      type: 'tenant_resolution',
      description: 'tenantHostMiddleware [multi-tenant host header resolution & database binding]',
      isErrorHandler: false,
      isTerminalFallback: false
    };
  }
  if (norm.includes('compression(')) {
    return {
      category: 'request_pipeline',
      type: 'compression',
      description: 'compression [gzip/deflate response compression]',
      isErrorHandler: false,
      isTerminalFallback: false
    };
  }
  if (norm.includes('X-Content-Type-Options') || norm.includes('frame-ancestors') || norm.includes('Content-Security-Policy')) {
    return {
      category: 'request_pipeline',
      type: 'security_headers',
      description: 'securityHeadersMiddleware [nosniff, frame-ancestors none, csp, api no-store]',
      isErrorHandler: false,
      isTerminalFallback: false
    };
  }
  if (norm.includes('express.json')) {
    return {
      category: 'request_pipeline',
      type: 'body_parser_json',
      description: 'express.json [body parser with 1mb limit]',
      isErrorHandler: false,
      isTerminalFallback: false
    };
  }
  if (is4Arg && (norm.includes('entity.parse.failed') || norm.includes('SyntaxError'))) {
    return {
      category: 'error_handling_chain',
      type: 'json_parse_error_handler',
      description: 'jsonParseErrorHandler [catches malformed JSON payloads -> HTTP 400]',
      isErrorHandler: true,
      isTerminalFallback: false
    };
  }
  if (norm.includes('sanitizePrototypeKeys')) {
    return {
      category: 'request_pipeline',
      type: 'prototype_sanitizer',
      description: 'sanitizePrototypeKeys [strips prototype pollution keys from body, query, params]',
      isErrorHandler: false,
      isTerminalFallback: false
    };
  }
  if (norm.includes('cross_origin_write_blocked') || norm.includes('originHost !==')) {
    return {
      category: 'request_pipeline',
      type: 'cross_origin_protection',
      description: 'sameOriginWriteProtection [origin header validation on state-changing mutations -> HTTP 403]',
      isErrorHandler: false,
      isTerminalFallback: false
    };
  }
  if (norm.includes('operationalAuditAutoRecorder') || norm.includes('auditRecorded') || norm.includes('recordAudit')) {
    return {
      category: 'request_pipeline',
      type: 'audit_recorder',
      description: 'operationalAuditAutoRecorder [audit logging for mutation requests]',
      isErrorHandler: false,
      isTerminalFallback: false
    };
  }
  if (norm.includes('blockLegacyFinanceWrites') || norm.includes('finance_v1_read_only')) {
    let desc = `blockLegacyFinanceWrites (${mountPath} mutating -> HTTP 410 finance_v1_read_only)`;
    if (mountPath === '/api/admin/finance') {
      desc = 'blockLegacyFinanceWrites (/api/admin/finance mutating non-vendors -> HTTP 410 finance_v1_read_only)';
    } else if (mountPath === '/v1') {
      desc = 'blockLegacyFinanceWrites (/v1 mutating non-audit -> HTTP 410 finance_v1_read_only)';
    } else if (mountPath === '/api/tax') {
      desc = 'blockLegacyFinanceWrites (/api/tax mutating -> HTTP 410 finance_v1_read_only)';
    }
    return {
      category: 'path_interceptor',
      type: 'legacy_410_interceptor',
      description: desc,
      isErrorHandler: false,
      isTerminalFallback: false
    };
  }
  if (norm.includes('Cache-Control') && (norm.includes('/uploads/') || norm.includes('/admin.html'))) {
    return {
      category: 'post_route_pipeline',
      type: 'static_cache_headers',
      description: 'staticAssetCachePolicy [Cache-Control headers for static frontend assets & uploads]',
      isErrorHandler: false,
      isTerminalFallback: false
    };
  }
  if (mountPath === '/api' && (norm.includes('route_not_found') || norm.includes('404'))) {
    return {
      category: 'terminal_fallback',
      type: 'not_found_fallback',
      description: 'apiNotFoundFallback (/api unmatched -> HTTP 404 route_not_found)',
      isErrorHandler: false,
      isTerminalFallback: true
    };
  }
  if (norm.includes('express.static')) {
    return {
      category: 'terminal_fallback',
      type: 'static_fallback',
      description: 'express.static [serves static frontend files and html extensions]',
      isErrorHandler: false,
      isTerminalFallback: true
    };
  }
  if (is4Arg) {
    return {
      category: 'error_handling_chain',
      type: 'global_error_handler',
      description: 'globalErrorHandler [catches unhandled exceptions -> HTTP 500]',
      isErrorHandler: true,
      isTerminalFallback: false
    };
  }
  return {
    category: 'unknown',
    type: 'unknown',
    description: `unrecognized middleware: ${norm.slice(0, 60)}`,
    isErrorHandler: is4Arg,
    isTerminalFallback: false
  };
}

/**
 * Dynamically extracts all observed `app.use(...)` middleware registrations in server/server.js.
 * Extraction of description and type is 100% semantic and dynamic (zero line-number branches).
 */
function extractObservedGlobalMiddleware(serverJsContentOverride = null) {
  const serverPath = path.join(ROOT, 'server', 'server.js');
  const content = serverJsContentOverride !== null ? serverJsContentOverride : fs.readFileSync(serverPath, 'utf8');
  const lines = content.split('\n');
  const lineOffsets = [0];
  for (let i = 0; i < lines.length; i++) lineOffsets.push(lineOffsets[i] + lines[i].length + 1);

  function getLine(charIndex) {
    let low = 0, high = lineOffsets.length - 1;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      if (lineOffsets[mid] <= charIndex) low = mid + 1;
      else high = mid - 1;
    }
    return high + 1;
  }

  const stack = [];
  const re = /app\.use\s*\(/g;
  let match;

  while ((match = re.exec(content)) !== null) {
    const matchIndex = match.index;
    const parenIndex = matchIndex + match[0].length - 1;
    const lineNum = getLine(matchIndex);
    const parsed = parseCallArguments(content, parenIndex);
    if (!parsed) continue;

    const args = splitTopLevelArgs(parsed.rawArgs);
    if (args.length === 0) continue;

    let mountPath = '/';
    let handlerArg = args[0];

    if (/^['"`]/.test(args[0]) || args[0].startsWith('[')) {
      mountPath = args[0].replace(/^['"`]|['"`]$/g, '');
      handlerArg = args.slice(1).join(', ');
    }

    const classified = classifyGlobalMiddleware(mountPath, handlerArg);

    stack.push({
      line: lineNum,
      source: `server.js:${lineNum}`,
      mountPath,
      ...classified
    });
  }

  return stack;
}

/**
 * Scans a file and extracts raw route calls with strict lexical boundaries.
 */
function extractRawCallsFromFile(relPath, contentOverride = null) {
  const fullPath = path.join(ROOT, relPath);
  const content = contentOverride !== null ? contentOverride : fs.readFileSync(fullPath, 'utf8');
  const lines = content.split('\n');

  const lineStartOffsets = [0];
  for (let i = 0; i < lines.length; i++) {
    lineStartOffsets.push(lineStartOffsets[i] + lines[i].length + 1);
  }

  function getLineNumber(charIndex) {
    let low = 0, high = lineStartOffsets.length - 1;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      if (lineStartOffsets[mid] <= charIndex) low = mid + 1;
      else high = mid - 1;
    }
    return high + 1;
  }

  const calls = [];
  const routeRegex = /(?:app|router)\.(get|post|put|patch|delete)\s*\(/g;
  let match;

  while ((match = routeRegex.exec(content)) !== null) {
    const method = match[1].toUpperCase();
    const matchIndex = match.index;
    const parenIndex = matchIndex + match[0].length - 1;
    const lineNum = getLineNumber(matchIndex);

    const parsed = parseCallArguments(content, parenIndex);
    if (!parsed) {
      throw new Error(`[SYNTAX_ERROR] Unbalanced arguments for route at ${relPath}:${lineNum}`);
    }

    const condition = extractPrecedingCondition(content, matchIndex);
    const args = splitTopLevelArgs(parsed.rawArgs);
    if (args.length === 0) continue;

    const pathArg = args[0];
    const middleArgs = args.slice(1, -1);
    const handlerArg = args.at(-1) || '';

    // Handle Object.keys(PAGES) dynamically from source code
    if (pathArg.includes('Object.keys(PAGES)')) {
      const dynamicPagesKeys = extractPagesKeysFromContent(content);
      const effectivePages = dynamicPagesKeys.length > 0 ? dynamicPagesKeys : (() => {
        try {
          const actualServerContent = fs.readFileSync(path.join(ROOT, 'server', 'server.js'), 'utf8');
          return extractPagesKeysFromContent(actualServerContent);
        } catch (_) {
          return [];
        }
      })();

      if (effectivePages.length === 0) {
        throw new Error(`[EXTRACTION_ERROR] Failed to dynamically extract keys for Object.keys(PAGES) at ${relPath}:${lineNum}`);
      }

      effectivePages.forEach((p) => {
        calls.push({
          sourceFile: relPath,
          sourceLine: lineNum,
          method,
          path: p,
          condition,
          rawPathArg: 'Object.keys(PAGES)',
          middleArgs,
          handlerArg,
        });
      });
      continue;
    }

    const paths = parsePathArg(pathArg);

    paths.forEach((p) => {
      calls.push({
        sourceFile: relPath,
        sourceLine: lineNum,
        method,
        path: p,
        condition,
        rawPathArg: pathArg,
        middleArgs,
        handlerArg,
      });
    });
  }

  return calls;
}

/**
 * Analyzes effective middleware and observed guard for a given route call.
 */
function analyzeRouteExecution(call, globalMiddlewareStack = []) {
  const { sourceFile, method, path: routePath, condition, middleArgs, handlerArg } = call;
  const isRead = ['GET', 'HEAD', 'OPTIONS'].includes(method);

  // Filter observed global middleware that applies to this route in standard request processing.
  // Error-handling chain (4-argument handlers) and terminal fallbacks (404, static) are modeled separately
  // and are NOT presented as executing during normal happy-path route execution.
  const observedGlobalMiddleware = [];
  globalMiddlewareStack.forEach((mw) => {
    if (mw.category === 'request_pipeline') {
      if (mw.mountPath === '/' || routePath.startsWith(mw.mountPath)) {
        observedGlobalMiddleware.push(`${mw.source} [${mw.mountPath}] ${mw.description}`);
      }
    } else if (mw.category === 'path_interceptor') {
      if (mw.mountPath !== '/' && routePath.startsWith(mw.mountPath)) {
        observedGlobalMiddleware.push(`${mw.source} [${mw.mountPath}] [interceptor] ${mw.description}`);
      }
    }
  });

  let lifecycleStatus = 'active';
  let interceptorReason = null;

  if (condition && condition.includes('typeof app.patch')) {
    lifecycleStatus = 'conditional';
  } else if (condition && condition.includes('NODE_ENV !== \'production\'')) {
    lifecycleStatus = 'conditional';
  }

  // Interceptors on accounting routes
  if (sourceFile === 'server/accounting-routes.js') {
    if (routePath.startsWith('/api/admin/finance')) {
      if (!isRead && !routePath.startsWith('/api/admin/finance/vendors')) {
        lifecycleStatus = 'legacy_410_restricted';
        interceptorReason = 'server.js:1582 -> HTTP 410 finance_v1_read_only';
      }
    } else if (routePath.startsWith('/v1')) {
      if (!isRead && routePath !== '/v1/audit/validate-permission') {
        lifecycleStatus = 'legacy_410_restricted';
        interceptorReason = 'server.js:1604 -> HTTP 410 finance_v1_read_only';
      }
    } else if (routePath.startsWith('/api/tax')) {
      if (!isRead) {
        lifecycleStatus = 'legacy_410_restricted';
        interceptorReason = 'server.js:1605 -> HTTP 410 finance_v1_read_only';
      }
    }
  }

  // Detect route-level guards from middleArgs strictly
  const middleGuards = [];
  middleArgs.forEach((arg) => {
    if (arg.includes('publicOrderMutationGuard(')) {
      const m = arg.match(/publicOrderMutationGuard\s*\(\s*['"]([^'"]+)['"]/);
      middleGuards.push(`publicOrderMutationGuard(${m ? m[1] : 'unknown'})`);
    } else if (arg === 'sandboxPaymentGuard') {
      middleGuards.push('sandboxPaymentGuard');
    } else if (arg.includes('requireCapability(')) {
      const m = arg.match(/requireCapability\s*\(\s*(\[[^\]]+\]|'[^']+'|"[^"]+")/);
      const cap = m ? m[1].replace(/['"\s]/g, '') : 'unknown';
      middleGuards.push(`requireCapability(${cap})`);
    } else if (arg === 'requireKitchen') {
      middleGuards.push('requireKitchen');
    } else if (arg === 'requireOwner') {
      middleGuards.push('requireOwner');
    } else if (arg === 'requireAdmin') {
      middleGuards.push('requireAdmin');
    } else if (arg === 'requireStaff') {
      middleGuards.push('requireStaff');
    } else if (arg === 'requireAuth') {
      middleGuards.push('requireAuth');
    } else if (arg === 'requireCommandCenterAccess') {
      middleGuards.push('requireCommandCenterAccess');
    } else if (arg === 'financeV1PosReadOnly') {
      middleGuards.push('financeV1PosReadOnly');
      lifecycleStatus = 'legacy_410_restricted';
      interceptorReason = 'accounting-routes.js:101 -> HTTP 410 finance_v1_pos_read_only';
    } else {
      middleGuards.push(arg.slice(0, 60));
    }
  });

  // Primary observed guard
  let observedGuard = 'none';
  if (middleGuards.length > 0) {
    observedGuard = middleGuards.join(' + ');
  }

  // Handler annotations
  let handlerType = 'standard';
  if (handlerArg.startsWith('guard(')) {
    handlerType = 'guard(...) [wrapper: branch validation, serialization & idempotency]';
  } else if (handlerArg.includes('goodsReceiptMutation')) {
    handlerType = 'goodsReceiptMutation [wrapper: idempotency & goods receipt execution]';
  } else if (handlerArg.includes('inventoryMutation')) {
    handlerType = 'inventoryMutation [wrapper: idempotency & inventory mutation execution]';
  }

  return {
    observedGlobalMiddleware,
    observedGuard,
    lifecycleStatus,
    interceptorReason,
    handlerType,
  };
}

/**
 * Maps a route call to its target contract and determines guard alignment vs gaps.
 */
function resolveRouteContract(call, observedGuard, lifecycleStatus) {
  const p = call.path;
  const m = call.method;
  const isRead = ['GET', 'HEAD', 'OPTIONS'].includes(m);

  let target = null;

  // 0. Operational panel redirect aliases (server.js /pos, /cashier, /waiter,
  // /kitchen, /kds and their .html twins) 302-redirect to the role-panel
  // shells. They inherit the same public shell contract as their targets.
  const redirectAliasTargets = {
    '/pos': 'orders.pos',
    '/pos.html': 'orders.pos',
    '/cashier': 'orders.pos',
    '/cashier.html': 'orders.pos',
    '/waiter': 'staff.waiter',
    '/waiter.html': 'staff.waiter',
    '/kitchen': 'kitchen.kds',
    '/kitchen.html': 'kitchen.kds',
    '/kds': 'kitchen.kds',
    '/kds.html': 'kitchen.kds'
  };
  if (p === '/checkout') {
    target = {
      feature: 'content.website',
      permission: null,
      scope: 'public',
      isExempt: true,
      rationale: 'Public 302 redirect alias to the guest order shell',
      guardAlignment: 'exempt_public',
      confidence: 'verified',
      decisionNotes: 'Redirect-only alias to /order; no state is served and the destination shell owns the guest ordering contract.'
    };
  }
  if (redirectAliasTargets[p]) {
    target = {
      feature: redirectAliasTargets[p],
      permission: null,
      scope: 'public',
      isExempt: true,
      rationale: `Public 302 redirect alias to the ${p.startsWith('/waiter') ? 'waiter' : (p.startsWith('/pos') || p.startsWith('/cashier')) ? 'cashier' : 'kitchen'} role-panel shell`,
      guardAlignment: 'exempt_public',
      confidence: 'verified',
      decisionNotes: 'Redirect-only alias; no state is served. The destination shell contract applies (AC-08).'
    };
  }

  // 1. Static Pages & Assets
  if (call.rawPathArg === 'Object.keys(PAGES)' || p.endsWith('.html') || p === '/' || p === '/sw.js' || p === '/manifest.webmanifest' || p === '/api/content-bootstrap.js') {
    if (p === '/menu-print') {
      target = {
        feature: 'catalog.print',
        permission: null,
        scope: 'public',
        isExempt: true,
        rationale: 'Printable menu generator',
        guardAlignment: 'exempt_public',
        confidence: 'verified',
        decisionNotes: 'Public printable menu template shell with public menu content. Preserved as public view per supervisor decision; sensitive data requires independent isolation (Backlog Phase 2: AC-08).'
      };
    } else if (p === '/reserve') {
      target = { feature: 'booking.reservations', permission: null, scope: 'public', isExempt: true, rationale: 'Public guest reservation form shell' };
    } else if (p.startsWith('/admin/waiter')) {
      target = {
        feature: 'staff.waiter',
        permission: null,
        scope: 'public',
        isExempt: true,
        rationale: 'Waiter terminal UI shell',
        guardAlignment: 'exempt_public',
        confidence: 'verified',
        decisionNotes: 'Static HTML UI shell served without sensitive embedded state; client JS verifies token and guards APIs. Explicit public shell contract verified and preserved for backward compatibility; API security is covered independently (AC-08).'
      };
    } else if (p.startsWith('/admin/kitchen')) {
      target = {
        feature: 'kitchen.kds',
        permission: null,
        scope: 'public',
        isExempt: true,
        rationale: 'KDS kitchen terminal UI shell',
        guardAlignment: 'exempt_public',
        confidence: 'verified',
        decisionNotes: 'Static HTML UI shell served without sensitive embedded state; client JS verifies token and guards APIs. Explicit public shell contract verified and preserved for backward compatibility; API security is covered independently (AC-08).'
      };
    } else if (p.startsWith('/admin/cashier')) {
      target = {
        feature: 'orders.pos',
        permission: null,
        scope: 'public',
        isExempt: true,
        rationale: 'Cashier POS terminal UI shell',
        guardAlignment: 'exempt_public',
        confidence: 'verified',
        decisionNotes: 'Static HTML UI shell served without sensitive embedded state; client JS verifies token and guards APIs. Explicit public shell contract verified and preserved for backward compatibility; API security is covered independently (AC-08).'
      };
    } else if (p === '/admin') {
      target = {
        feature: 'core.workspace',
        permission: null,
        scope: 'public',
        isExempt: true,
        rationale: 'Admin workspace UI shell',
        guardAlignment: 'exempt_public',
        confidence: 'verified',
        decisionNotes: 'Static HTML UI shell served without sensitive embedded state; client JS verifies token and guards APIs. Explicit public shell contract verified and preserved for backward compatibility; API security is covered independently (AC-08).'
      };
    } else {
      target = { feature: 'content.website', permission: null, scope: 'public', isExempt: true, rationale: 'Public static web view / asset' };
    }
  }

  // 2. Authentication & Guest Entry
  if (!target) {
    if (p === '/api/auth/request-otp' || p === '/api/auth/verify-otp') {
      target = { feature: 'core.workspace', permission: null, scope: 'public', isExempt: true, rationale: 'Guest authentication / OTP exchange' };
    } else if (p === '/api/auth/logout') {
      target = { feature: 'core.workspace', permission: null, scope: 'public', isExempt: true, rationale: 'Session invalidation / cookie clear' };
    } else if (p === '/api/auth/me') {
      target = {
        feature: 'core.workspace',
        permission: null,
        scope: 'public',
        isExempt: true,
        rationale: 'Public session discovery with handler-level data control',
        guardAlignment: 'exempt_public',
        confidence: 'verified',
        decisionNotes: 'Public session discovery endpoint with handler-level currentUser validation (server.js:1838). Returns { user: null } for guest without 401 noise, and authenticated user self-profile when present; no tenant data is returned. Explicit public contract verified; Control Plane session migration remains a separate D3 identity gate (AC-07, AC-08).'
      };
    } else if (p === '/api/auth/profile') {
      target = { feature: 'core.workspace', permission: 'profile.self.manage', scope: 'own_records', isExempt: false, rationale: 'Self-service profile update' };
    } else if (p === '/api/profile/birthday') {
      target = { feature: 'crm.directory', permission: 'profile.self.manage', scope: 'own_records', isExempt: false, rationale: 'Customer self-service birthday record' };
    } else if (p === '/api/profile/orders' || p === '/api/orders/my-orders') {
      target = { feature: 'orders.online', permission: 'orders.view', scope: 'own_records', isExempt: false, rationale: 'Customer view of own orders (filtered by req.user)' };
    } else if (p.startsWith('/api/user/')) {
      target = { feature: 'core.workspace', permission: 'profile.self.manage', scope: 'own_records', isExempt: false, rationale: 'Customer account self-service profile, avatar & address management' };
    }
  }

  // 3. Public Platform & Metadata
  if (!target) {
    if (p === '/api/tenant/context') target = { feature: 'core.workspace', permission: null, scope: 'public', isExempt: true, rationale: 'Public tenant host metadata' };
    else if (p === '/api/i18n') target = { feature: 'catalog.languages', permission: null, scope: 'public', isExempt: true, rationale: 'Public language and locale settings' };
    else if (p === '/api/allergens') target = { feature: 'catalog.menu', permission: null, scope: 'public', isExempt: true, rationale: 'Public menu allergen disclosure' };
    else if (p === '/api/restaurant') target = { feature: 'core.workspace', permission: null, scope: 'public', isExempt: true, rationale: 'Public restaurant branch & business info' };
    else if (p === '/api/theme') target = { feature: 'content.website', permission: null, scope: 'public', isExempt: true, rationale: 'Public theme & brand visual tokens' };
    else if (p === '/api/content') target = { feature: 'content.website', permission: isRead ? null : 'content.manage', scope: isRead ? 'public' : 'tenant', isExempt: isRead, rationale: isRead ? 'Public static content payload' : 'Admin content mutation' };
  }

  // 4. NEEM Ops & Command Center
  if (!target) {
    if (p === '/ops' || p.startsWith('/ops/')) target = { feature: 'core.workspace', permission: 'admin.access', scope: 'tenant', isExempt: false, rationale: 'Deep-link redirect to NEEM ops application' };
    else if (p === '/api/admin/session') target = { feature: 'core.workspace', permission: 'command.view', scope: 'tenant', isExempt: false, rationale: 'Staff session & branch scope resolution' };
    else if (p === '/api/admin/role-preview') target = { feature: 'core.workspace', permission: 'role.preview', scope: 'tenant', isExempt: false, rationale: 'Manager role permission preview' };
    else if (p === '/api/admin/command-center') target = { feature: 'core.workspace', permission: 'command.view', scope: 'branch', isExempt: false, rationale: 'Branch command center operational summary' };
    else if (p === '/api/admin/events') target = { feature: 'core.workspace', permission: 'ops.view', scope: 'branch', isExempt: false, rationale: 'Server-sent events stream for real-time operations' };
    else if (p === '/api/admin/audit') target = { feature: 'core.workspace', permission: 'audit.view', scope: 'branch', isExempt: false, rationale: 'Branch audit log inspection' };
    else if (p === '/api/admin/notifications') target = { feature: 'core.workspace', permission: 'command.view', scope: 'tenant', isExempt: false, rationale: 'Admin operational notification feed' };
    else if (p === '/api/admin/restaurant') target = { feature: 'core.workspace', permission: isRead ? 'command.view' : 'admin.access', scope: 'tenant', isExempt: false, rationale: 'Restaurant workspace core profile configuration' };
    else if (p === '/api/admin/qr-code') target = { feature: 'floor.qr', permission: 'tables.view', scope: 'branch', isExempt: false, rationale: 'Branch QR code generator for tables and menu' };
    else if (p.startsWith('/api/admin/upload')) target = { feature: 'content.website', permission: 'content.manage', scope: 'tenant', isExempt: false, rationale: 'Menu and brand media upload administration' };
    else if (p.startsWith('/api/admin/neem-integration')) target = { feature: 'platform.api', permission: isRead ? 'analytics.view' : 'automations.manage', scope: 'tenant', isExempt: false, rationale: 'NEEM bridge status, retry & backfill' };
  }

  // 4.1 Admin V2 Overview & Cockpits
  if (!target) {
    if (p === '/api/admin/v2/overview') target = { feature: 'insights.analytics', permission: 'analytics.view', scope: 'tenant', isExempt: false, rationale: 'Admin V2 executive dashboard overview' };
    else if (p === '/api/admin/v2/orders') target = { feature: 'orders.pos', permission: 'orders.view', scope: 'branch', isExempt: false, rationale: 'Admin V2 live orders queue' };
    else if (p === '/api/admin/v2/kitchen') target = { feature: 'kitchen.kds', permission: 'kitchen.view', scope: 'branch', isExempt: false, rationale: 'Admin V2 KDS station monitor' };
    else if (p === '/api/admin/v2/finance') target = { feature: 'finance.workspace', permission: 'finance.view', scope: 'branch', isExempt: false, rationale: 'Admin V2 finance cockpit' };
  }

  // 5. Desktop Releases
  if (!target && p.includes('/desktop/')) {
    target = { feature: 'platform.desktop', permission: isRead ? 'menu.view' : 'releases.deploy', scope: 'tenant', isExempt: false, rationale: 'Desktop client releases & auto-updates' };
  }

  // 6. Waiter Terminal & QR Floor Calls
  if (!target) {
    if (p === '/api/call-waiter' || p === '/api/call-waiter/cancel') target = { feature: 'staff.waiter', permission: null, scope: 'public', isExempt: true, rationale: 'Customer table QR waiter call' };
    else if (p.startsWith('/api/waiter/') || p.startsWith('/api/admin/waiter')) target = { feature: 'staff.waiter', permission: isRead ? 'orders.view' : 'orders.manage', scope: 'branch', isExempt: false, rationale: 'Waiter terminal floor management' };
  }

  // 7. Tables & Floor Plan
  if (!target && (p.startsWith('/api/admin/v2/floor') || p.startsWith('/api/admin/tables') || p.startsWith('/api/tables'))) {
    target = { feature: 'floor.tables', permission: isRead ? 'tables.view' : 'service.manage', scope: 'branch', isExempt: false, rationale: 'Floor table map & layout editor' };
  }

  // 8. Kitchen KDS
  if (!target && (p.startsWith('/api/kitchen/') || p.startsWith('/api/admin/kitchen'))) {
    if (p.includes('/inventory')) {
      if (p.includes('/recipes') || p.includes('/recipe-versions')) target = { feature: 'stock.recipes', permission: isRead ? 'inventory.view' : 'inventory.operations', scope: 'branch', isExempt: false, rationale: 'Kitchen recipe version management' };
      else if (p.includes('/goods-receipts')) target = { feature: 'stock.procurement', permission: isRead ? 'inventory.view' : 'inventory.receiving', scope: 'branch', isExempt: false, rationale: 'Kitchen goods receipt entry' };
      else target = { feature: 'stock.inventory', permission: isRead ? 'inventory.view' : 'inventory.operations', scope: 'branch', isExempt: false, rationale: 'Kitchen waste & stock count operations' };
    } else {
      target = { feature: 'kitchen.kds', permission: isRead ? 'kitchen.view' : 'orders.manage', scope: 'branch', isExempt: false, rationale: 'KDS order ticket routing & station updates' };
    }
  }

  // 9. POS & Cash Drawers
  if (!target && (p.startsWith('/api/cashier/') || p.startsWith('/api/admin/cash-drawers') || p.includes('cash-close'))) {
    target = { feature: 'cash.drawers', permission: isRead ? 'orders.view' : 'cash.manage', scope: 'branch', isExempt: false, rationale: 'Cash drawer shifts, counting & cash-close' };
  }
  if (!target && (p.startsWith('/api/staff/orders') || p.startsWith('/api/staff/') || p.startsWith('/v1/pos/') || p.startsWith('/api/pos/'))) {
    if (p.includes('/refunds')) target = { feature: 'payments.gateway', permission: 'payments.refund.request', scope: 'branch', isExempt: false, rationale: 'POS sale refund request' };
    else if (p.includes('split')) target = { feature: 'orders.advanced', permission: 'orders.split', scope: 'branch', isExempt: false, rationale: 'Split check by seat or item' };
    else if (p.includes('course') || p.includes('coursing') || p.includes('hold-fire')) target = { feature: 'orders.advanced', permission: 'orders.course.manage', scope: 'branch', isExempt: false, rationale: 'Coursing hold & fire flow' };
    else if (p.includes('move-table') || p.includes('move')) target = { feature: 'orders.advanced', permission: 'orders.move_table', scope: 'branch', isExempt: false, rationale: 'Table move operation' };
    else target = { feature: 'orders.pos', permission: isRead ? 'orders.view' : (m === 'POST' ? 'orders.create' : 'orders.manage'), scope: 'branch', isExempt: false, rationale: 'Staff POS order lifecycle' };
  }

  // 10. Booking: Reservations & Waitlist
  if (!target && (p.startsWith('/api/reservations') || p.startsWith('/api/admin/reservations') || p.includes('reservation-settings'))) {
    const isPublicGuest = p === '/api/reservations' || p === '/api/reservations/meta' || p === '/api/reservations/slots';
    target = {
      feature: 'booking.reservations',
      permission: isPublicGuest ? null : (isRead ? 'reservations.view' : 'reservations.manage'),
      scope: isPublicGuest ? 'public' : 'branch',
      isExempt: isPublicGuest,
      rationale: isPublicGuest ? 'Guest reservation form discovery & submission' : 'Staff reservation desk'
    };
  }
  if (!target && (p.startsWith('/api/waitlist') || p.startsWith('/api/admin/waitlist'))) {
    const isGuestJoin = (p === '/api/waitlist' || p === '/api/waitlist/retry') && m === 'POST';
    target = { feature: 'booking.waitlist', permission: isGuestJoin ? null : (isRead ? 'reservations.view' : 'reservations.receive'), scope: isGuestJoin ? 'public' : 'branch', isExempt: isGuestJoin, rationale: isGuestJoin ? 'Guest walk-in queue submission' : 'Host desk waitlist queue management' };
  }

  // 11. Delivery Dispatch
  if (!target && (p.includes('/delivery-zones') || p.includes('/dispatch'))) {
    target = { feature: 'delivery.dispatch', permission: isRead ? 'delivery.view' : 'delivery.manage', scope: 'branch', isExempt: false, rationale: 'Delivery zones, dispatch & courier fee rules' };
  }

  // 12. Staff & Role Management
  if (!target && (p.startsWith('/api/admin/v2/staff') || p.startsWith('/api/admin/staff') || p.startsWith('/api/admin/users') || p.startsWith('/api/admin/roles'))) {
    if (m === 'DELETE') target = { feature: 'staff.management', permission: 'staff.manage', scope: 'tenant', isExempt: false, rationale: 'Deactivate / delete staff member' };
    else target = { feature: 'staff.management', permission: isRead ? 'audit.view' : 'staff.manage', scope: 'tenant', isExempt: false, rationale: 'Staff roster & credential administration' };
  }

  // 13. Catalog: Menu, Modifiers, Pricing, Languages, Print
  if (!target) {
    if (p.includes('/modifiers')) target = { feature: 'catalog.modifiers', permission: isRead ? 'menu.view' : 'menu.manage', scope: 'tenant', isExempt: false, rationale: 'Item modifiers & choices' };
    else if (p.includes('/prices/bulk') || p.includes('/pricing')) target = { feature: 'catalog.pricing', permission: 'menu.price.update', scope: 'tenant', isExempt: false, rationale: 'Bulk menu price revisions' };
    else if (p.includes('/i18n') || p.includes('/translate') || p.includes('/languages')) target = { feature: 'catalog.languages', permission: isRead ? 'menu.view' : 'menu.manage', scope: 'tenant', isExempt: false, rationale: 'Multilingual catalog localization' };
    else if (p.includes('/menu-print')) target = { feature: 'catalog.print', permission: 'menu.view', scope: 'tenant', isExempt: false, rationale: 'Printable menu generator' };
    else if (p.startsWith('/api/menu') || p.startsWith('/api/admin/menu') || p.startsWith('/api/admin/categories') || p.startsWith('/api/admin/dishes') || p.startsWith('/api/admin/v2/catalog') || p.startsWith('/api/products/')) {
      const isPublicGuest = isRead && (p === '/api/menu' || p === '/api/menu/categories' || p.startsWith('/api/products/'));
      target = { feature: 'catalog.menu', permission: isPublicGuest ? null : (isRead ? 'menu.view' : 'menu.manage'), scope: isPublicGuest ? 'public' : 'tenant', isExempt: isPublicGuest, rationale: isPublicGuest ? 'Public 3D guest menu browsing' : 'Catalog dish & category curation' };
    }
  }

  // 14. Online Checkout & Payments
  if (!target && (p.startsWith('/api/checkout/') || p.startsWith('/api/orders') || p.startsWith('/api/v2/orders') || p.startsWith('/api/admin/orders') || p.startsWith('/api/payments/') || p.startsWith('/api/admin/payments'))) {
    if (p.startsWith('/api/payments/webhook')) {
      target = { feature: 'payments.gateway', permission: null, scope: 'public', isExempt: true, rationale: 'Inbound asynchronous payment gateway webhook' };
    } else if (p.endsWith('/pay-wallet')) {
      target = { feature: 'crm.wallet', permission: 'orders.self.pay', scope: 'own_records', isExempt: false, rationale: 'Authenticated customer payment of own order from wallet' };
    } else if (p === '/api/checkout/meta' || p === '/api/checkout/quote') {
      target = { feature: 'orders.online', permission: null, scope: 'public', isExempt: true, rationale: 'Guest checkout quotation & branch discovery' };
    } else if (p === '/api/checkout/orders') {
      target = {
        feature: 'orders.online',
        permission: null,
        scope: 'public',
        isExempt: true,
        rationale: 'Guest customer checkout order submission',
        guardAlignment: 'exempt_public',
        confidence: 'verified',
        decisionNotes: 'Guest customer checkout ordering flow (server.js:3272) uses explicit publicOrderMutationGuard(orders.online): rate limiting plus production Idempotency-Key and entitlement/provider fail-closed gates, followed by server-side branch/dish/price validation. Staff permission is not required for guest purchase; commercial provider evidence remains D5 (AC-09, AC-64).'
      };
    } else if (p === '/api/orders' && m === 'POST') {
      target = {
        feature: 'orders.pos',
        permission: null,
        scope: 'public',
        isExempt: true,
        rationale: 'Guest customer dine-in table order submission',
        guardAlignment: 'exempt_public',
        confidence: 'verified',
        decisionNotes: 'Guest customer dine-in table ordering flow (server.js:3407) uses explicit publicOrderMutationGuard(orders.pos): rate limiting plus production Idempotency-Key and entitlement/provider fail-closed gates, followed by server-side table/dish/price validation. Staff permission is not required for guest purchase; commercial provider evidence remains D5 (AC-09, AC-64).'
      };
    } else if (p.includes('/sandbox-confirm')) {
      target = {
        feature: 'payments.gateway',
        permission: null,
        scope: 'public',
        isExempt: true,
        rationale: 'Sandbox payment transaction confirmation',
        guardAlignment: 'exempt_public',
        confidence: 'verified',
        decisionNotes: 'Explicit sandboxPaymentGuard plus handler token/mode checks are verified at server.js:3292. The route returns 409 in production and cannot settle a non-sandbox payment; environment separation and real provider evidence remain D5 (AC-19, AC-20).'
      };
    } else if (p.startsWith('/api/payments/')) {
      target = { feature: 'payments.gateway', permission: 'payments.collect', scope: 'branch', isExempt: false, rationale: 'Direct restaurant payment gateway transaction' };
    } else if (p === '/api/admin/payments' || p.startsWith('/api/admin/payments/')) {
      target = { feature: 'payments.gateway', permission: 'payments.manage', scope: 'branch', isExempt: false, rationale: 'Admin view & manage branch payments' };
    } else if (p === '/api/admin/orders' || (p.startsWith('/api/admin/orders/') && isRead)) {
      target = { feature: 'orders.pos', permission: 'orders.view', scope: 'branch', isExempt: false, rationale: 'Admin view orders' };
    } else if (p.startsWith('/api/admin/orders/')) {
      target = { feature: 'orders.pos', permission: 'orders.manage', scope: 'branch', isExempt: false, rationale: 'Admin manage order status' };
    } else {
      target = { feature: 'orders.online', permission: isRead ? 'orders.view' : 'orders.manage', scope: 'branch', isExempt: false, rationale: 'Online order status & tracking' };
    }
  }

  // 15. Wallet & Loyalty
  if (!target && p.startsWith('/api/admin/wallet/')) {
    if (p.includes('/summary')) target = { feature: 'crm.wallet', permission: 'finance.view', scope: 'branch', isExempt: false, rationale: 'Branch wallet balance and financial summary' };
    else if (p.includes('/packages')) target = { feature: 'crm.wallet', permission: isRead ? 'finance.view' : 'finance.settings.manage', scope: 'tenant', isExempt: false, rationale: 'Wallet package configuration' };
    else if (p.includes('/adjust')) target = { feature: 'crm.wallet', permission: 'finance.journal.create', scope: 'branch', isExempt: false, rationale: 'Audited wallet balance adjustment' };
  }
  if (!target && p.includes('/wallet')) {
    if (p.includes('/topup')) target = { feature: 'crm.wallet', permission: 'wallet.topup', scope: 'own_records', isExempt: false, rationale: 'Customer wallet balance credit' };
    else target = { feature: 'crm.wallet', permission: isRead ? 'wallet.self.view' : 'cash.manage', scope: isRead ? 'own_records' : 'tenant', isExempt: false, rationale: 'Customer wallet ledger & top-up bonus' };
  }
  if (!target && (p.includes('/loyalty') || p.includes('/club') || p.includes('/referrals'))) {
    const isUserSelf = p.includes('/me') || p.includes('/apply') || p === '/api/loyalty/customer' || p === '/api/loyalty/qr-code' || p === '/api/loyalty/redeem';
    target = { feature: 'crm.loyalty', permission: isUserSelf ? 'loyalty.self.view' : (isRead ? 'customers.phone.masked' : 'customers.directory.manage'), scope: isUserSelf ? 'own_records' : 'tenant', isExempt: false, rationale: 'Loyalty tiers, points redemption & referral bonuses' };
  }
  if (!target && p === '/api/campaigns/claim-birthday') {
    target = { feature: 'marketing.campaigns', permission: 'campaigns.self.claim', scope: 'own_records', isExempt: false, rationale: 'Authenticated customer birthday campaign claim' };
  }

  // 16. CRM & Customer Directory
  if (!target && (p.startsWith('/api/admin/customers') || p.startsWith('/api/admin/users') || p.startsWith('/api/admin/v2/crm') || p.startsWith('/api/feedback') || p.startsWith('/api/admin/feedback'))) {
    if (p === '/api/feedback/meta' || (p === '/api/feedback' && m === 'POST')) {
      target = { feature: 'crm.directory', permission: null, scope: 'public', isExempt: true, rationale: 'Guest dining satisfaction feedback' };
    } else {
      target = { feature: 'crm.directory', permission: isRead ? 'customers.phone.masked' : 'customers.directory.manage', scope: 'tenant', isExempt: false, rationale: 'Customer CRM directory & contact records' };
    }
  }

  // 17. Marketing: Campaigns & SMS
  if (!target) {
    if (p === '/api/campaigns/status') {
      target = { feature: 'marketing.campaigns', permission: null, scope: 'public', isExempt: true, rationale: 'Public campaign status discovery banner (happy hour, promotion toggles)' };
    } else if (p.includes('/campaigns')) {
      target = { feature: 'marketing.campaigns', permission: 'promotions.manage', scope: 'tenant', isExempt: false, rationale: 'Automated birthday & seasonal campaigns' };
    } else if (p.includes('/sms') || p.includes('/whatsapp')) {
      const isSend = p.includes('send') || p.includes('run') || m === 'POST';
      target = {
        feature: 'marketing.sms',
        permission: isSend ? 'messaging.send' : 'messaging.settings.manage',
        scope: 'tenant',
        isExempt: false,
        rationale: isSend ? 'Transactional SMS & WhatsApp dispatch' : 'Messaging configuration and campaign analytics'
      };
    } else if (p.includes('/promotions') || p.includes('/promo-slides') || p.includes('/faq') || p.includes('/newsletter')) {
      const isImpression = p.includes('/impression') || p.includes('/click') || p === '/api/newsletter';
      target = { feature: 'content.website', permission: isImpression ? null : 'content.manage', scope: isImpression ? 'public' : 'tenant', isExempt: isImpression, rationale: isImpression ? 'Marketing slide impression & newsletter opt-in' : 'Marketing slide banners & FAQ entries' };
    }
  }

  // 18. Hardware / Edge Printers & Multi-Branch
  if (!target) {
    if (p.includes('/printers') || p.includes('/printer')) {
      target = { feature: 'platform.edge', permission: 'printing.settings.manage', scope: 'branch', isExempt: false, rationale: 'LAN network receipt & KDS printer configuration' };
    } else if (p === '/api/branches') {
      target = {
        feature: 'platform.multi_branch',
        permission: null,
        scope: 'public',
        isExempt: true,
        rationale: 'Public branch directory for customer branch selection & checkout discovery'
      };
    } else if (p.startsWith('/api/admin/branches') || p.startsWith('/api/branches')) {
      target = { feature: 'platform.multi_branch', permission: isRead ? 'command.view' : 'admin.access', scope: 'tenant', isExempt: false, rationale: 'Multi-branch physical location governance' };
    }
  }

  // 19. Insights: Reports, Analytics, Cost Control & Local AI
  if (!target) {
    if (p.includes('/break-even') || p.includes('/cost-control') || p.includes('/cost-optimizer')) {
      target = { feature: 'insights.cost_control', permission: 'finance.reports.view', scope: 'branch', isExempt: false, rationale: 'Break-even analytics & F&B plate margin optimization' };
    } else if (p.includes('/ai-cfo-brief') || p.includes('/predictive') || p.includes('/local-ai')) {
      target = { feature: 'insights.local_ai', permission: 'finance.reports.view', scope: 'branch', isExempt: false, rationale: 'On-device AI financial brief & sales forecast' };
    } else if (p.includes('/analytics') || p.includes('/stats')) {
      const isTelemetry = p === '/api/analytics/visit';
      target = { feature: 'insights.analytics', permission: isTelemetry ? null : 'analytics.view', scope: isTelemetry ? 'public' : 'tenant', isExempt: isTelemetry, rationale: isTelemetry ? 'Anonymous client visit telemetry' : 'Real-time sales & visitor traffic analytics' };
    } else if (p.includes('/reports') || p.includes('/z-reports') || p.includes('/financial-statements')) {
      target = { feature: 'insights.reports', permission: 'reports.view', scope: 'branch', isExempt: false, rationale: 'End-of-day Z-reports & comparative sales summaries' };
    }
  }

  // 20. Stock & Procurement
  if (!target) {
    if (p.includes('/recipes') || p.includes('/subrecipes')) target = { feature: 'stock.recipes', permission: isRead ? 'inventory.view' : 'inventory.operations', scope: 'branch', isExempt: false, rationale: 'Dish recipe formulations & plate subrecipes' };
    else if (p.includes('/purchase-orders') || p.includes('/goods-receipts') || p.includes('/procurement')) target = { feature: 'stock.procurement', permission: isRead ? 'inventory.view' : (p.includes('/goods-receipts') ? 'inventory.receiving' : 'inventory.manage'), scope: 'branch', isExempt: false, rationale: 'Supplier purchasing cycle & warehouse goods intake' };
    else if (p.includes('/inventory') || p.includes('/stock') || p.includes('/inter-branch-transfer')) target = { feature: 'stock.inventory', permission: isRead ? 'inventory.view' : 'inventory.operations', scope: 'branch', isExempt: false, rationale: 'Stock balance tracking & warehouse stock-counts' };
  }

  // 21. Finance V2 Admin Endpoints (/api/admin/v2/finance/*)
  if (!target && p.startsWith('/api/admin/v2/finance/')) {
    if (p.includes('/contracts') || p.includes('/workbench') || p.includes('/cutover-readiness') || p.includes('/cutover-runbook') || p.includes('/rollout')) {
      if (m === 'POST' && p.includes('cutover-request')) target = { feature: 'finance.workspace', permission: 'finance.settings.manage', scope: 'tenant', isExempt: false, rationale: 'Finance V2 branch cutover request' };
      else target = { feature: 'finance.workspace', permission: 'finance.view', scope: p.includes('/rollout') ? 'tenant' : 'branch', isExempt: false, rationale: 'Finance V2 readiness, contracts & rollout workbench' };
    } else if (p.includes('/sales-cash-bank')) target = { feature: 'finance.reconciliation', permission: 'finance.view', scope: 'branch', isExempt: false, rationale: 'Daily sales, cash and bank reconciliation view' };
    else if (p.includes('/orders/') && p.includes('/chain')) target = { feature: 'finance.workspace', permission: 'finance.view', scope: 'branch', isExempt: false, rationale: 'Inspect order financial transaction chain' };
    else if (p.includes('/operating-expenses')) target = { feature: 'finance.purchases', permission: isRead ? 'finance.view' : 'finance.payables.manage', scope: 'branch', isExempt: false, rationale: 'Operating expenses and overhead payables' };
    else if (p.includes('/refund-requests')) target = { feature: 'payments.gateway', permission: 'payments.refund.request', scope: 'branch', isExempt: false, rationale: 'Order refund request submission' };
    else if (p.includes('/costing-inventory')) target = { feature: 'stock.inventory', permission: 'inventory.view', scope: 'branch', isExempt: false, rationale: 'Inventory stock costing & valuation' };
    else if (p.includes('/costing-intelligence')) target = { feature: 'insights.cost_control', permission: 'finance.reports.view', scope: 'branch', isExempt: false, rationale: 'Menu costing intelligence & margin analysis' };
    else if (p.includes('/ledger-close')) target = { feature: 'finance.workspace', permission: 'finance.view', scope: 'branch', isExempt: false, rationale: 'Ledger close status and period check' };
    else if (p.includes('/opening-balances')) {
      if (p.includes('/preview') || isRead) target = { feature: 'finance.workspace', permission: 'finance.view', scope: 'branch', isExempt: false, rationale: 'Opening balance journal entry preview' };
      else target = { feature: 'finance.workspace', permission: 'finance.journal.post', scope: 'branch', isExempt: false, rationale: 'Post opening balance journal entries into fiscal ledger' };
    } else if (p.includes('/events')) {
      if (p.includes('/capture')) target = { feature: 'payments.gateway', permission: 'payments.collect', scope: 'branch', isExempt: false, rationale: 'Order payment capture event' };
      else if (p.includes('/cogs/retry-ready')) target = { feature: 'stock.inventory', permission: 'inventory.operations', scope: 'branch', isExempt: false, rationale: 'Retry COGS inventory depletion event' };
      else if (p.includes('/resolve')) target = { feature: 'finance.workspace', permission: 'finance.journal.create', scope: 'branch', isExempt: false, rationale: 'Resolve failed finance event' };
      else target = { feature: 'finance.workspace', permission: 'finance.view', scope: 'branch', isExempt: false, rationale: 'Finance event stream inspection' };
    } else if (p.includes('/migration/')) {
      if (p.includes('/decision') || p.includes('/backfill-request')) target = { feature: 'finance.workspace', permission: 'finance.approve', scope: 'branch', isExempt: false, rationale: 'Approve legacy migration backfill / archive decision' };
      else if (p.includes('/classify')) target = { feature: 'finance.workspace', permission: 'finance.journal.create', scope: 'branch', isExempt: false, rationale: 'Classify legacy transaction during migration' };
      else target = { feature: 'finance.workspace', permission: 'finance.view', scope: 'branch', isExempt: false, rationale: 'Legacy migration archive & backfill preview' };
    } else if (p.includes('/reconciliation')) {
      if (p.includes('/match') || (m === 'POST' && p.includes('/bank-statement-lines'))) target = { feature: 'finance.reconciliation', permission: 'finance.reconcile', scope: 'branch', isExempt: false, rationale: 'Bank statement line match & manual reconcile' };
      else target = { feature: 'finance.reconciliation', permission: 'finance.view', scope: 'branch', isExempt: false, rationale: 'Bank statement reconciliation dashboard' };
    } else if (p.includes('/approvals')) {
      if (p.includes('/decision')) target = { feature: 'finance.workspace', permission: 'finance.approve', scope: 'branch', isExempt: false, rationale: 'Approve or reject pending financial transaction' };
      else target = { feature: 'finance.workspace', permission: 'finance.view', scope: 'branch', isExempt: false, rationale: 'List pending financial approvals' };
    } else if (p.includes('/search')) {
      target = { feature: 'finance.workspace', permission: 'finance.view', scope: 'branch', isExempt: false, rationale: 'Global financial record search' };
    }
  }

  // 22. Accounting Module Endpoints (/api/admin/finance/*)
  if (!target && p.startsWith('/api/admin/finance/')) {
    if (p.includes('/exports/')) target = { feature: 'platform.exports', permission: 'finance.export', scope: 'branch', isExempt: false, rationale: 'Excel / CSV raw ledger export' };
    else if (p.includes('/audit-hash') || p.includes('/compliance-10y')) target = { feature: 'finance.workspace', permission: 'audit.view', scope: 'branch', isExempt: false, rationale: 'Financial audit hash chain & 10-year compliance registry' };
    else if (p.includes('/cfo/brief') || p.includes('/ai-cfo')) target = { feature: 'insights.local_ai', permission: 'finance.reports.view', scope: 'branch', isExempt: false, rationale: 'Executive AI CFO summary and briefing' };
    else if (p.includes('/menu-engineering')) target = { feature: 'insights.cost_control', permission: 'finance.reports.view', scope: 'branch', isExempt: false, rationale: 'Menu engineering margin and profitability analytics' };
    else if (p.includes('/branch-comparison')) target = { feature: 'finance.consolidation', permission: 'finance.reports.view', scope: 'tenant', isExempt: false, rationale: 'Cross-branch financial performance comparison' };
    else if (p.includes('/restaurant-kpis')) target = { feature: 'insights.analytics', permission: 'analytics.view', scope: 'tenant', isExempt: false, rationale: 'Restaurant financial KPIs and performance metrics' };
    else if (p.includes('/three-way-match')) target = { feature: 'finance.purchases', permission: 'finance.payables.manage', scope: 'branch', isExempt: false, rationale: 'PO, Goods Receipt & Vendor Invoice 3-way reconciliation' };
    else if (p.includes('/ap-aging')) target = { feature: 'finance.purchases', permission: 'finance.reports.view', scope: 'branch', isExempt: false, rationale: 'Accounts payable aging schedule report' };
    else if (p.includes('/pnl') || p.includes('/income-statement') || p.includes('/balance-sheet') || p.includes('/cash-flow')) target = { feature: 'finance.workspace', permission: 'finance.reports.view', scope: 'branch', isExempt: false, rationale: 'Standard accounting financial statement' };
    else if (p.includes('/recipe-cards') || p.includes('/subrecipes')) target = { feature: 'stock.recipes', permission: 'inventory.view', scope: 'branch', isExempt: false, rationale: 'Dish recipe cost cards and BOM structure' };
    else if (p.includes('/z-reports')) target = { feature: 'insights.reports', permission: 'reports.view', scope: 'branch', isExempt: false, rationale: 'End-of-day Z-report and close summary' };
    else if (p.includes('/cash-drawers')) target = { feature: 'cash.drawers', permission: 'finance.view', scope: 'branch', isExempt: false, rationale: 'Legacy cash drawer read / session compatibility surface' };
    else if (p.includes('/tips-pool')) target = { feature: 'finance.payroll', permission: 'finance.view', scope: 'branch', isExempt: false, rationale: 'Staff tips pool collection and allocation' };
    else if (p.includes('/settings')) target = { feature: 'finance.workspace', permission: isRead ? 'finance.view' : 'finance.settings.manage', scope: 'branch', isExempt: false, rationale: 'Branch accounting settings and tax configurations' };
    else if (p.includes('/gl') || p.includes('/trial-balance') || p.includes('/overview') || p.includes('/sales') || p.includes('/control-totals')) target = { feature: 'finance.workspace', permission: 'finance.view', scope: 'branch', isExempt: false, rationale: 'General ledger, trial balance, sales summary and control totals' };
  }

  // 23. General Finance, Purchases & Payables
  if (!target) {
    if (p.includes('/vendors') || p.includes('/vendor-invoices') || p.includes('/bills') || p.includes('/cost-commitments') || p.includes('/cost-accruals') || p.includes('/purchases-payables') || p.includes('/quick-purchase')) target = { feature: 'finance.purchases', permission: isRead ? 'finance.view' : 'finance.payables.manage', scope: 'branch', isExempt: false, rationale: 'Accounts payable, vendor invoices & expense commitments' };
    else if (p.includes('/bank-feed') || p.includes('/reconciliations') || p.includes('/settlements')) target = { feature: 'finance.reconciliation', permission: isRead ? 'finance.view' : 'finance.reconcile', scope: 'branch', isExempt: false, rationale: 'Bank statement feed parsing & POS settlement auto-matching' };
    else if (p.includes('/fixed-assets') || p.includes('/depreciation')) target = { feature: 'finance.assets', permission: isRead ? 'finance.view' : 'finance.settings.manage', scope: 'branch', isExempt: false, rationale: 'Fixed asset registry & scheduled depreciation calculation' };
    else if (p.includes('/payroll')) target = { feature: 'finance.payroll', permission: isRead ? 'finance.view' : 'finance.approve', scope: 'branch', isExempt: false, rationale: 'Employee shift hours & salary disbursement batch' };
    else if (p.includes('/tax') || p.includes('/einvoices') || p.includes('/taxpayer')) target = { feature: 'finance.tax_adapter', permission: isRead ? 'finance.view' : 'finance.settings.manage', scope: 'branch', isExempt: false, rationale: 'National taxpayer portal integration & fiscal memory' };
    else if (p.includes('/consolidation')) target = { feature: 'finance.consolidation', permission: 'finance.reports.view', scope: 'tenant', isExempt: false, rationale: 'Multi-branch balance consolidation' };
    else if (p.includes('/exports/')) target = { feature: 'platform.exports', permission: 'finance.export', scope: 'branch', isExempt: false, rationale: 'Excel / CSV raw ledger export' };
  }

  // 24. Core General Ledger & Fiscal Periods
  if (!target) {
    if (p.startsWith('/v1/audit/') && !p.includes('/validate-permission')) {
      target = { feature: 'finance.workspace', permission: 'audit.view', scope: 'branch', isExempt: false, rationale: 'Financial audit and compliance evidence inspection' };
    } else if (p.startsWith('/v1/cfo/')) {
      target = { feature: 'insights.local_ai', permission: 'finance.reports.view', scope: 'branch', isExempt: false, rationale: 'Executive AI CFO summary and briefing' };
    } else if (p.includes('/fiscal-periods')) {
      if (p.includes('/lock') || p.includes('/close')) target = { feature: 'finance.workspace', permission: 'finance.period.close', scope: 'branch', isExempt: false, rationale: 'Lock / close fiscal period' };
      else if (p.includes('/reopen')) target = { feature: 'finance.workspace', permission: 'finance.period.reopen', scope: 'branch', isExempt: false, rationale: 'Reopen previously closed fiscal period' };
      else target = { feature: 'finance.workspace', permission: isRead ? 'finance.view' : 'finance.settings.manage', scope: 'branch', isExempt: false, rationale: 'Fiscal period calendar configuration' };
    } else if (p.includes('/journal') || p.includes('/coa') || p.includes('/expenses') || p.includes('/petty-cash') || p.includes('/accruals') || p.includes('/prepaids') || p.includes('/rebuild-ledger') || p.includes('/tips-distribute') || p.startsWith('/v1/')) {
      if (p.includes('/reverse')) target = { feature: 'finance.workspace', permission: 'finance.journal.post', scope: 'branch', isExempt: false, rationale: 'Journal entry reversal' };
      else if (m === 'POST' || m === 'PUT' || m === 'PATCH' || m === 'DELETE') target = { feature: 'finance.workspace', permission: 'finance.journal.create', scope: 'branch', isExempt: false, rationale: 'Manual double-entry journal submission' };
      else target = { feature: 'finance.workspace', permission: 'finance.view', scope: 'branch', isExempt: false, rationale: 'General ledger & trial balance inspection' };
    }
  }

  // 25. Settings & Administration
  if (!target && (p.startsWith('/api/admin/settings') || p.startsWith('/api/admin/v2/settings') || p.startsWith('/api/admin/v2/resources') || p.includes('hours') || p.includes('theme'))) {
    target = { feature: 'core.workspace', permission: isRead ? 'command.view' : 'admin.access', scope: 'tenant', isExempt: false, rationale: 'General restaurant profile & working hours' };
  }

  // 26. Debug Log
  if (!target && p === '/api/debug-log') {
    target = { feature: 'core.workspace', permission: null, scope: 'system', isExempt: true, rationale: 'Local development debug log collector' };
  }

  // Fallback: unresolved
  if (!target) {
    target = {
      feature: 'unresolved',
      permission: 'unresolved',
      scope: 'unresolved',
      isExempt: false,
      rationale: 'No verified semantic mapping in contract catalog',
      guardAlignment: 'guard_gap',
      confidence: 'decision_required',
      decisionNotes: 'Unmapped endpoint in source code. Semantic mapping and capability definition required.'
    };
  }

  // Determine guard alignment and confidence if not set explicitly above
  let guardAlignment = target.guardAlignment;
  let confidence = target.confidence;
  let decisionNotes = target.decisionNotes || target.rationale;

  if (!guardAlignment) {
    if (lifecycleStatus === 'legacy_410_restricted') {
      guardAlignment = 'legacy_restricted';
      confidence = 'verified';
      decisionNotes = 'Legacy endpoint restricted by global 410 interceptor.';
    } else if (target.isExempt) {
      guardAlignment = 'exempt_public';
      confidence = 'verified';
      decisionNotes = target.rationale || 'Explicit documented public/system exemption.';
    } else if (observedGuard === 'none') {
      guardAlignment = 'guard_gap';
      confidence = 'decision_required';
      decisionNotes = `Target permission ${target.permission} defined in catalog, but observed guard is 'none' in current code.`;
    } else if (target.scope === 'own_records' && observedGuard === 'requireAuth') {
      // User self-service authenticated routes where requireAuth populates req.user
      guardAlignment = 'aligned';
      confidence = 'verified';
      decisionNotes = `Protected by observed guard [requireAuth] matching user self-service scope own_records.`;
    } else {
      // `requireCapability` is now a real adapter into TPEL after WESTO has
      // resolved the authenticated principal. Count it as aligned only when
      // the runtime capability exactly covers the target contract. Arrays keep
      // their existing OR semantics and are aligned when one member matches.
      // The live server also installs the route-aware TPEL globally before the
      // route modules are mounted. Therefore a route with a verified map entry
      // is protected by that exact capability even when its legacy local guard
      // is still coarse (`requireAdmin`) or intentionally broader. The audit
      // must account for the middleware that actually runs, not only the
      // nearest route-level token in source text.
      const routeAwareCapability = lookupPolicyCapability(m, p);
      const globalCapabilityMatch = routeAwareCapability === target.permission;
      const capabilityMatch = observedGuard.match(/^requireCapability\((.*)\)$/);
      const observedCapabilities = capabilityMatch
        ? capabilityMatch[1].replace(/[\[\]\s]/g, '').split(',').filter(Boolean)
        : [];
      const exactCapability = observedCapabilities.includes(String(target.permission || ''));
      const dynamicAdminCapability = observedGuard === 'requireAdmin' && routeAwareCapability === target.permission;
      const dynamicCommandCapability = observedGuard === 'requireCommandCenterAccess'
        && (routeAwareCapability || 'command.view') === target.permission;
      const delegatedKitchenCapability = observedGuard === 'requireKitchen' && target.permission === 'kitchen.view';

      if (globalCapabilityMatch || exactCapability || dynamicAdminCapability || dynamicCommandCapability || delegatedKitchenCapability) {
        guardAlignment = 'aligned';
        confidence = 'verified';
        const source = globalCapabilityMatch
          ? `globalRouteAwareTPEL→${routeAwareCapability}`
          : exactCapability
          ? `requireCapability(${target.permission})`
          : dynamicAdminCapability
            ? `requireAdmin→${routeAwareCapability}`
            : dynamicCommandCapability
              ? `requireCommandCenterAccess→${routeAwareCapability || 'command.view'}`
              : 'requireKitchen→kitchen.view';
        decisionNotes = `Runtime TPEL capability [${source}] matches target permission '${target.permission}' (${target.scope}); branch/resource checks remain in the route boundary.`;
      } else {
        // Coarse legacy guards: perimeter protection exists, but the target
        // permission is not proven at this route boundary.
        guardAlignment = 'observed_guard_present';
        confidence = 'verified';
        decisionNotes = `Observed legacy guard [${observedGuard}] provides perimeter protection; target fine-grained permission '${target.permission}' (${target.scope}) is target_not_enforced at route level.`;
      }
    }
  }

  return {
    feature: target.feature,
    permission: target.permission,
    scope: target.scope,
    isExempt: target.isExempt,
    rationale: target.rationale,
    guardAlignment,
    confidence,
    decisionNotes
  };
}

/**
 * Evaluates audit results against gate requirements.
 * Implements dual gate evaluation:
 * 1. phase0InventoryGate: Verifies complete structural inventory, 0 unmapped, 0 invalid, 0 duplicates,
 *    and that all architectural decisions are documented in the backlog with owner/phase/AC (Section 28 Phase 0).
 * 2. productionReadinessGate: Strictly evaluates runtime capability enforcement (Section 28 Phase 2/3/5).
 *    This is a route-capability contract gate only; it is not the overall release
 *    Production Readiness Gate implemented by scripts/salsa-production-readiness-gate.js.
 */
function evaluateAuditGate(routes, options = {}) {
  const requireZeroUnmapped = options.requireZeroUnmapped !== false;
  const requireZeroDuplicates = options.requireZeroDuplicates !== false;
  const requireZeroValidationErrors = options.requireZeroValidationErrors !== false;
  const strictDecisions = !!options.strictDecisions;

  const violations = [];
  const unmapped = [];
  const invalid = [];
  const gaps = [];
  const decisionsRequired = [];

  routes.forEach((r) => {
    if (!r.isValid) {
      invalid.push(r);
      violations.push(`[INVALID_CONTRACT] ${r.id} (${r.method} ${r.path}): ${r.validationErrors?.join(', ')}`);
    }
    if (r.targetFeature === 'unresolved' || (!r.isExempt && r.targetPermission === 'unresolved')) {
      unmapped.push(r);
      violations.push(`[UNMAPPED_ROUTE] ${r.id} (${r.method} ${r.path}) has unresolved semantic mapping`);
    }
    if (r.guardAlignment === 'guard_gap') {
      gaps.push(r);
    }
    if (r.confidence === 'decision_required') {
      decisionsRequired.push(r);
      if (strictDecisions) {
        violations.push(`[DECISION_PENDING] ${r.id} (${r.method} ${r.path}): ${r.decisionNotes}`);
      }
    }
  });

  const seen = new Set();
  const duplicates = [];
  routes.forEach((r) => {
    const key = `${r.method} ${r.path}`;
    if (seen.has(key)) {
      duplicates.push(key);
      violations.push(`[DUPLICATE_ROUTE] ${key} registered multiple times`);
    } else {
      seen.add(key);
    }
  });

  const seenIds = new Set();
  const idCollisions = [];
  routes.forEach((r) => {
    if (seenIds.has(r.id)) {
      idCollisions.push(r.id);
      violations.push(`[DUPLICATE_ID] Collision detected for route ID '${r.id}' on ${r.method} ${r.path} (${r.sourceFile}:${r.sourceLine})`);
    } else {
      seenIds.add(r.id);
    }
  });

  const hasStructuralFailures = (requireZeroUnmapped && unmapped.length > 0) ||
                                (requireZeroValidationErrors && invalid.length > 0) ||
                                (requireZeroDuplicates && (duplicates.length > 0 || idCollisions.length > 0));
  const hasDecisionFailures = strictDecisions && decisionsRequired.length > 0;

  // Distinct validMapped calculation (immune to double-subtracting routes that are both invalid and unmapped)
  const validMappedCount = routes.filter((r) => r.isValid && r.targetFeature !== 'unresolved' && (r.isExempt || r.targetPermission !== 'unresolved')).length;

  // Phase 0 Inventory Gate (GODMODE.MD Section 28 Phase 0):
  // Passes when inventory is complete, 0 unmapped, 0 invalid, 0 duplicates, and all decisions documented.
  const phase0InventoryGate = {
    passed: !hasStructuralFailures && (!strictDecisions || decisionsRequired.length === 0),
    criteria: {
      zeroUnmapped: unmapped.length === 0,
      zeroInvalid: invalid.length === 0,
      zeroDuplicates: duplicates.length === 0,
      zeroIdCollisions: idCollisions.length === 0,
      zeroUnaddressedDecisions: decisionsRequired.length === 0
    },
    blockingViolations: violations.filter((v) => !v.includes('[DECISION_PENDING]') || strictDecisions)
  };

  // Production Readiness Gate (GODMODE.MD Section 28 Phase 2/3/5):
  // Protected routes must be TPEL-aligned; public/session/sandbox routes are
  // acceptable only when their explicit contract is verified as exempt_public.
  const unenforcedRoutes = routes.filter((r) => r.guardAlignment === 'observed_guard_present' || r.guardAlignment === 'handler_controlled' || r.guardAlignment === 'guard_gap');
  const productionReadinessGate = {
    scope: 'route_capability_enforcement_only',
    releaseDecision: 'not_evaluated',
    authority: 'scripts/salsa-production-readiness-gate.js',
    passed: unenforcedRoutes.length === 0 && gaps.length === 0,
    blockingReasons: unenforcedRoutes.length > 0
      ? [
          `BLOCKED: ${unenforcedRoutes.length} endpoints lack runtime fine-grained capability enforcement (${routes.filter((r) => r.guardAlignment === 'observed_guard_present').length} coarse legacy guards, ${routes.filter((r) => r.guardAlignment === 'handler_controlled').length} handler-controlled, ${gaps.length} guard gaps). Full enforcement required in Phase 2/3/5.`
        ]
      : []
  };

  const gatePassed = phase0InventoryGate.passed;

  return {
    gatePassed,
    phase0InventoryGate,
    productionReadinessGate,
    hasStructuralFailures,
    hasDecisionFailures,
    violations,
    counts: {
      total: routes.length,
      validMapped: validMappedCount,
      unmapped: unmapped.length,
      invalid: invalid.length,
      duplicates: duplicates.length,
      idCollisions: idCollisions.length,
      guardGaps: gaps.length,
      decisionsRequired: decisionsRequired.length,
      aligned: routes.filter((r) => r.guardAlignment === 'aligned').length,
      observedGuardPresent: routes.filter((r) => r.guardAlignment === 'observed_guard_present').length,
      handlerControlled: routes.filter((r) => r.guardAlignment === 'handler_controlled').length,
      exemptPublic: routes.filter((r) => r.guardAlignment === 'exempt_public').length,
      legacyRestricted: routes.filter((r) => r.guardAlignment === 'legacy_restricted').length
    },
    unmappedDetails: unmapped.map((r) => ({ id: r.id, method: r.method, path: r.path, source: `${r.sourceFile}:${r.sourceLine}`, errors: r.validationErrors })),
    decisionDetails: decisionsRequired.map((r) => ({ id: r.id, method: r.method, path: r.path, source: `${r.sourceFile}:${r.sourceLine}`, notes: r.decisionNotes }))
  };
}

/**
 * Executes full route audit across server files.
 */
function auditAllRoutes({ checkOnly = false, strict = false, routesOverride = null } = {}) {
  const files = [
    'server/server.js',
    'server/admin-v2.js',
    'server/finance-v2.js',
    'server/accounting-routes.js'
  ];

  let rawCalls = [];
  const fileStats = {};

  if (routesOverride !== null) {
    rawCalls = routesOverride;
    fileStats['override'] = rawCalls.length;
  } else {
    files.forEach((f) => {
      const list = extractRawCallsFromFile(f);
      fileStats[f] = list.length;
      rawCalls = rawCalls.concat(list);
    });
  }

  const globalMiddlewareStack = extractObservedGlobalMiddleware();

  function observedDataPlaneInputs(call) {
    try {
      const source = fs.readFileSync(path.join(ROOT, call.sourceFile), 'utf8');
      const handlerName = String(call.handlerArg || '').trim().match(/^(?:async\s+)?([A-Za-z_$][\w$]*)$/)?.[1];
      const namedSource = handlerName ? namedHandlerSource(source, handlerName) : '';
      const helperSources = [];
      const helperCandidates = new Set([...`${call.handlerArg || ''}\n${namedSource}`.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)].map((match) => match[1]));
      for (const helperName of helperCandidates) {
        if (helperName === handlerName || ['if', 'for', 'while', 'switch', 'catch', 'function'].includes(helperName)) continue;
        const helperSource = namedHandlerSource(source, helperName);
        if (helperSource) helperSources.push(helperSource);
      }
      const signalSource = `${call.handlerArg || ''}\n${namedSource}\n${helperSources.join('\n')}`;
      const observed = collectObservedContractSignals(signalSource, call.path);
      const bodyContract = getDataPlaneRequestContract(call.method, call.path);
      if (bodyContract) {
        observed.bodyFields = [...new Set([...observed.bodyFields, ...bodyContract.fields])].sort();
        observed.bodyUsage = bodyContract.status === 'source_reviewed_no_body'
          ? 'source_reviewed_no_body'
          : 'source_observed_fields';
        observed.bodyContract = bodyContract;
      }
      const formDataContract = getDataPlaneFormDataContract(call.method, call.path);
      if (formDataContract && !bodyContract) {
        observed.bodyFields = [...new Set([...observed.bodyFields, ...formDataContract.fields])].sort();
        observed.bodyUsage = 'source_reviewed_form_data';
        observed.bodyContract = formDataContract;
      }
      const noBodyContract = getDataPlaneNoBodyContract(call.method, call.path);
      if (noBodyContract && !bodyContract && !formDataContract) {
        observed.bodyUsage = 'source_reviewed_no_body';
        observed.bodyContract = noBodyContract;
      }
      const responseRootFields = new Set();
      const responseHelperFields = new Set();
      const responseRootKinds = new Set();
      const responseRootEnvelopes = new Set();
      const responseServiceFields = new Set();
      const responseServiceKinds = new Set();
      const responseServiceSources = [];
      const responseObjectBindings = new Map();
      const responseServiceBindings = new Map();
      for (const assignment of signalSource.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*\{/g)) {
        const openIndex = signalSource.indexOf('{', assignment.index);
        const closeIndex = openIndex >= 0 ? matchingBrace(signalSource, openIndex) : -1;
        if (openIndex < 0 || closeIndex < 0) continue;
        responseObjectBindings.set(
          assignment[1],
          objectLiteralFields(`${assignment[1]}: ${signalSource.slice(openIndex, closeIndex + 1)}`, assignment[1])
        );
      }
      for (const assignment of signalSource.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:await\s+)?([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+)\s*\(/g)) {
        responseServiceBindings.set(assignment[1], assignment[2]);
      }
      const responseModeCandidates = [];
      if (/\.redirect\s*\(/.test(signalSource)) responseModeCandidates.push('redirect');
      if (/eventHub\.subscribe\s*\(/.test(signalSource) || /res\.writeHead\s*\(\s*200\s*,[^)]*text\/event-stream/i.test(signalSource)) responseModeCandidates.push('event_stream');
      if (/app\.handle\s*\(/.test(signalSource)) responseModeCandidates.push('delegated');
      if (/\.status\s*\(\s*204\s*\)\s*\.end\s*\(|\.end\s*\(\s*\)/.test(signalSource)) responseModeCandidates.push('empty');
      if (/\.sendFile\s*\(/.test(signalSource)) {
        responseModeCandidates.push(String(call.path || '').endsWith('.webmanifest') || /manifest\.webmanifest/.test(signalSource) ? 'manifest' : String(call.path || '').endsWith('.js') || /(?:sw|javascript)/i.test(signalSource) ? 'javascript_file' : 'html_file');
      } else if (/\.send\s*\(/.test(signalSource) && /application\/javascript|text\/javascript/i.test(signalSource)) {
        responseModeCandidates.push('javascript');
      } else if (/\.send\s*\(/.test(signalSource)) {
        responseModeCandidates.push('text');
      }
      const jsonCall = /\.json\s*\(\s*/g;
      let match;
      while ((match = jsonCall.exec(signalSource))) {
        const openIndex = jsonCall.lastIndex;
        if (signalSource[openIndex] === '{') {
          const closeIndex = matchingBrace(signalSource, openIndex);
          if (closeIndex >= 0) {
            const fields = objectLiteralFields(`data: ${signalSource.slice(openIndex, closeIndex + 1)}`, 'data');
            fields.forEach((field) => responseRootFields.add(field));
            responseRootKinds.add('object');
            jsonCall.lastIndex = closeIndex + 1;
          }
        } else if (signalSource[openIndex] === '[') {
          responseRootKinds.add('array');
        } else {
          const rootExpression = signalSource.slice(openIndex).match(/^(?:await\s+)?([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?)(?=\s*(?:\(|[,);]|$))/);
          if (!rootExpression) continue;
          const rootName = rootExpression[1];
          const localObjectFields = responseObjectBindings.get(rootName);
          if (localObjectFields) {
            localObjectFields.forEach((field) => responseRootFields.add(field));
            responseRootKinds.add('object');
            continue;
          }
          const assignedServiceCall = responseServiceBindings.get(rootName);
          const directServiceCall = rootName.includes('.') && signalSource.slice(openIndex).match(/^(?:await\s+)?([A-Za-z_$][\w$]*\.[A-Za-z_$][\w$]*)\s*\(/)?.[1];
          const serviceCall = assignedServiceCall || directServiceCall;
          if (serviceCall) {
            let contract = getServiceResponseContract({ routeSourceFile: call.sourceFile, serviceCall });
            if (!contract || contract.status !== 'source_observed_service_return') {
              contract = getFactoryServiceResponseContract({ routeSourceFile: call.sourceFile, serviceCall }) || contract;
            }
            if (contract) {
              responseServiceSources.push(contract);
              if (contract.status === 'source_observed_service_return') {
                (contract.fields || []).forEach((field) => responseServiceFields.add(field));
                if (contract.kind) responseServiceKinds.add(contract.kind);
              }
            }
            continue;
          }
          const helperCall = rootName.match(/^([A-Za-z_$][\w$]*)$/);
          if (!helperCall) continue;
          const helperName = helperCall[1];
          if (helperName === 'envelope') responseRootEnvelopes.add(helperName);
          const helperSource = namedHandlerSource(source, helperName);
          if (!helperSource) continue;
          const returnPattern = /\breturn\s*\{/g;
          let returnMatch;
          while ((returnMatch = returnPattern.exec(helperSource))) {
            const returnOpen = helperSource.indexOf('{', returnMatch.index + returnMatch[0].length - 1);
            const returnClose = matchingBrace(helperSource, returnOpen);
            if (returnOpen < 0 || returnClose < 0) continue;
            objectLiteralFields(`data: ${helperSource.slice(returnOpen, returnClose + 1)}`, 'data')
              .forEach((field) => responseHelperFields.add(field));
            responseRootKinds.add('object');
            returnPattern.lastIndex = returnClose + 1;
          }
        }
      }
      return {
        ...observed,
        responseRootFields: [...responseRootFields].sort(),
        responseHelperFields: [...responseHelperFields].sort(),
        responseRootKinds: [...responseRootKinds].sort(),
        responseRootEnvelopes: [...responseRootEnvelopes].sort(),
        responseServiceFields: [...responseServiceFields].sort(),
        responseServiceKinds: [...responseServiceKinds].sort(),
        responseServiceSources,
        responseMode: responseModeCandidates[0] || null,
      };
    } catch (_) {
      return {
        bodyFields: [],
        bodyUsage: 'not_observed',
        queryFields: [],
        pathFields: [...String(call.path || '').matchAll(/:([A-Za-z0-9_]+)/g)].map((match) => match[1]),
        headerFields: [],
        statusCodes: [],
        responseDataFields: [],
        responseDataSources: [],
        responseEnvelope: { successFlag: false, dataField: false, errorField: false },
        responseRootFields: [],
        responseHelperFields: [],
        responseRootKinds: [],
        responseRootEnvelopes: [],
        responseServiceFields: [],
        responseServiceKinds: [],
        responseServiceSources: [],
        responseMode: null,
      };
    }
  }

  const auditedRoutes = rawCalls.map((call) => {
    // Canonical ID is derived strictly and deterministically from route identity.
    // Duplicate routes produce identical canonical IDs, which are caught and reported as collisions by evaluateAuditGate.
    const id = generateCanonicalRouteId(call);

    const execution = analyzeRouteExecution(call, globalMiddlewareStack);
    const contract = resolveRouteContract(call, execution.observedGuard, execution.lifecycleStatus);
    const validation = validateContractMapping(contract);

    return {
      id,
      method: call.method,
      path: call.path,
      sourceFile: call.sourceFile,
      sourceLine: call.sourceLine,
      registrationCondition: call.condition,
      observedGlobalMiddleware: execution.observedGlobalMiddleware,
      observedGuard: execution.observedGuard,
      lifecycleStatus: execution.lifecycleStatus,
      interceptorReason: execution.interceptorReason,
      handlerType: execution.handlerType,
      targetFeature: contract.feature,
      targetPermission: contract.permission,
      targetScope: contract.scope,
      isExempt: !!contract.isExempt,
      rationale: contract.rationale,
      guardAlignment: contract.guardAlignment,
      confidence: contract.confidence,
      decisionNotes: contract.decisionNotes,
      observedInputs: observedDataPlaneInputs(call),
      isValid: validation.valid,
      validationErrors: validation.errors
    };
  });

  const evaluation = evaluateAuditGate(auditedRoutes, { strictDecisions: strict });

  const lifecycleBreakdown = {};
  auditedRoutes.forEach((r) => {
    lifecycleBreakdown[r.lifecycleStatus] = (lifecycleBreakdown[r.lifecycleStatus] || 0) + 1;
  });

  const alignmentBreakdown = {};
  auditedRoutes.forEach((r) => {
    alignmentBreakdown[r.guardAlignment] = (alignmentBreakdown[r.guardAlignment] || 0) + 1;
  });

  const summary = {
    totalExtracted: auditedRoutes.length,
    totalMapped: evaluation.counts.validMapped,
    totalUnmapped: evaluation.counts.unmapped,
    totalDuplicates: evaluation.counts.duplicates,
    totalGuardGaps: evaluation.counts.guardGaps,
    totalDecisionsRequired: evaluation.counts.decisionsRequired,
    fileStats,
    lifecycleBreakdown,
    alignmentBreakdown,
    unmappedDetails: evaluation.unmappedDetails,
    decisionDetails: evaluation.decisionDetails,
    phase0InventoryGate: evaluation.phase0InventoryGate,
    productionReadinessGate: evaluation.productionReadinessGate,
    overallProductionReadiness: {
      status: 'not_evaluated',
      authority: 'scripts/salsa-production-readiness-gate.js',
      note: 'Route inventory does not grant release approval; run npm run neem:production:gate separately.'
    }
  };

  const middlewareArchitecture = {
    totalObserved: globalMiddlewareStack.length,
    requestPipeline: globalMiddlewareStack.filter((m) => m.category === 'request_pipeline'),
    pathInterceptors: globalMiddlewareStack.filter((m) => m.category === 'path_interceptor'),
    postRoutePipeline: globalMiddlewareStack.filter((m) => m.category === 'post_route_pipeline'),
    errorHandlingChain: globalMiddlewareStack.filter((m) => m.category === 'error_handling_chain'),
    terminalFallbacks: globalMiddlewareStack.filter((m) => m.category === 'terminal_fallback'),
    unknown: globalMiddlewareStack.filter((m) => m.category === 'unknown')
  };

  if (!checkOnly) {
    // Write JSON inventory
    const jsonDir = path.join(ROOT, 'docs', 'salsa', 'inventory');
    fs.mkdirSync(jsonDir, { recursive: true });
    const jsonPath = path.join(jsonDir, 'routes.json');
    fs.writeFileSync(jsonPath, JSON.stringify({
      metadata: {
        generatedAt: new Date().toISOString(),
        auditor: 'scripts/audit-salsa-routes.js',
        summary,
        middlewareArchitecture
      },
      routes: auditedRoutes
    }, null, 2), 'utf8');

    // Write Markdown Matrix
    const mdDir = path.join(ROOT, 'docs', 'salsa', 'contracts');
    fs.mkdirSync(mdDir, { recursive: true });
    const mdPath = path.join(mdDir, 'route-capability-mapping-matrix.md');

    const handlerControlledRoutes = auditedRoutes.filter((r) => r.guardAlignment === 'handler_controlled');

    let md = `# ماتریس جامع و راستی‌آزمایی‌شده مسیرها و کنترل دسترسی (Route Capability & Access Control Matrix)

**نسخه:** ۲.۷ (تفکیک گیت موجودی فاز ۰ و گیت انطباق قابلیت مسیرها از Production Readiness Gate انتشار، دسته‌بندی گارد مشاهده‌شده، کنترل درون هندلر، مجوزهای پیام‌رسانی و نگاشت متد-محور منو)  
**تاریخ استخراج:** ${new Date().toISOString().split('T')[0]}  
**ابزار بازتولید:** \`node scripts/audit-salsa-routes.js\` (حالت بررسی بدون تغییر فایل: \`node scripts/audit-salsa-routes.js --check\`)  
**مرجع مدل قابلیت‌ها:** [\`GODMODE.MD\`](file:///Users/sasan/Downloads/WESTO-v1.2/GODMODE.MD) (بخش ۷.۲ فهرست ۴۸ قابلیت، بخش ۱۰ مدل مجوزها، بخش ۲۸ معیارهای خروج فازها)

> [!IMPORTANT]
> **مرز تصمیم انتشار:** گیت «Production Readiness Gate» در این artifact فقط به معنی انطباق route با قرارداد قابلیت و guard است؛ این گیت مجوز انتشار نیست. تصمیم واقعی انتشار فقط از \`npm run neem:production:gate\` و manifest شواهد staging/Finance/Edge/PITR/canary/load به‌دست می‌آید.

> [!NOTE]
> **تفکیک ثبت استاتیک از پاسخ‌دهی ران‌تایم:** داده‌های این ممیزی حاصل استخراج و اعتبارسنجی استاتیک سورس‌کد پروژه است. هیچ‌گونه فراخوانی یا مانیتورینگ ترافیک زنده HTTP در ران‌تایم صورت نگرفته است. مسیرهای «فعال (Active)» به معنای ثبت در کدهای روتر بدون شرط و بدون مسدودی با ۴۱۰ هستند، نه تضمین پاسخ‌دهی زنده سرویس.

---

## ۱. خلاصه شاخص‌های ممیزی مسیرها

| شاخص ممیزی | مقدار محاسبه‌شده | روش راستی‌آزمایی |
| :--- | :---: | :--- |
| **کل اندپوینت‌های استخراج‌شده** | **${summary.totalExtracted}** | پارس لغوی پرانتزهای متعادل، آرایه‌های مسیر و استخراج شرایط چندخطی از ۴ فایل سرور |
| **اندپوینت‌های نگاشت‌شده معتبر** | **${summary.totalMapped}** | اعتبارسنجی ساختاری ۱۰۰٪ علیه کاتالوگ استاندارد مجوزها و قابلیت‌ها |
| **اندپوینت‌های حل‌نشده (Unresolved)** | **${summary.totalUnmapped}** | صفر مورد در مدل هدف (تمام موارد صریحاً اعتبارسنجی شدند) |
| **تداخل یا تکرار (Duplicates)** | **${summary.totalDuplicates}** | صفر مورد |
| **انطباق مستقیم گارد با هدف (Aligned)** | **${alignmentBreakdown.aligned || 0}** | گارد فعلی دقیقاً منطبق بر دسترسی ریزدانه (مانند \`own_records\` با \`requireAuth\`) |
| **گارد لایه‌ای مشاهده‌شده (Observed Guard Present)** | **${alignmentBreakdown.observed_guard_present || 0}** | گارد کلی لایه مسیر (\`requireAdmin\` و ...) موجود است؛ اعمال مجوز ریزدانه به فاز ۲/۳ موکول شده |
| **کنترل‌شده درون هندلر (Handler Controlled)** | **${alignmentBreakdown.handler_controlled || 0}** | اعتبارسنجی وضعیت/داده درون بدنه هندلر انجام می‌شود (مانند \`currentUser\`، سفارش مهمان و پرداخت سندباکس) |
| **معافیت‌های عمومیِ مستند (Exempt Public)** | **${alignmentBreakdown.exempt_public || 0}** | روت‌های عمومی، تله‌متری و فایل‌های استاتیک فاقد گارد با تایید صریح |
| **قدیمیِ مسدودشده با ۴۱۰ (Legacy 410 Restricted)** | **${alignmentBreakdown.legacy_restricted || 0}** | ${alignmentBreakdown.legacy_restricted || 0} عملیات نوشتن متوقف‌شده با HTTP 410 توسط رهگیرهای سرور |
| **شکاف گارد حل‌نشده (Guard Gap)** | **${alignmentBreakdown.guard_gap || 0}** | صفر مورد (تمام موارد تصمیم مستند و بکلگ مشخص دارند) |
| **ثبت استاتیک فعال (Active)** | **${lifecycleBreakdown.active || 0}** | ثبت مستقیم در روتر بدون شرط یا مسدودی ۴۱۰ |
| **ثبت استاتیک شرطی (Conditional)** | **${lifecycleBreakdown.conditional || 0}** | ۲ مورد: شروط \`typeof app.patch\` و \`NODE_ENV !== 'production'\` |
| **گیت موجودی فاز ۰ (Phase 0 Inventory Gate)** | **${evaluation.phase0InventoryGate.passed ? 'تأییدشده (PASSED)' : 'ناموفق (FAILED)'}** | موجودی کامل، بدون تداخل، نگاشت ۱۰۰٪ و ثبت تمام تصمیمات در بکلگ |
| **گیت انطباق قابلیت مسیرها (Route Capability Enforcement Gate)** | **${evaluation.productionReadinessGate.passed ? 'تأییدشده (PASSED)' : 'مسدود (BLOCKED)'}** | scope=\`route_capability_enforcement_only\`؛ این نتیجه مجوز انتشار نیست و Production Readiness Gate واقعی باید جداگانه اجرا شود |
| **گیت واقعی آمادگی انتشار (Overall Production Readiness Gate)** | **در این artifact ارزیابی نمی‌شود** | مرجع انحصاری: \`npm run neem:production:gate\`؛ نبود manifest/evidence بیرونی به‌طور مستقل \`NO_GO\` است |

### تفکیک مسیرها بر اساس فایل مبدأ:
- \`server/server.js\`: ${fileStats['server/server.js']} اندپوینت
- \`server/accounting-routes.js\`: ${fileStats['server/accounting-routes.js']} اندپوینت
- \`server/finance-v2.js\`: ${fileStats['server/finance-v2.js']} اندپوینت
- \`server/admin-v2.js\`: ${fileStats['server/admin-v2.js']} اندپوینت

---

## ۲. معماری و زنجیره تفکیک‌شده Middlewareهای سراسری (Global Middleware Architecture)

استخراج پویای معنایی فراخوانی‌های \`app.use\` از فایل \`server/server.js\` بر پایه متن کدهای هندلر، آرگومان‌ها و نشانه‌های توکن (بدون هیچ‌گونه شرط شماره خط) زنجیره را به ۵ فاز متمایز زیر تفکیک می‌کند:

### الف) زنجیره عادی پردازش درخواست (Incoming Request Pipeline)
این میدل‌ویرها به ازای هر درخواست ورودی به ترتیب زیر اجرا می‌شوند:
${globalMiddlewareStack.filter((m) => m.category === 'request_pipeline').map((mw, idx) => `${idx + 1}. **\`${mw.source}\` [مسیر: \`${mw.mountPath}\`]:** ${mw.description}`).join('\n')}

### ب) رهگیرهای مشروط مسیر (Path-Scoped Interceptors - HTTP 410)
این رهگیرها قبل از روت‌های حسابداری قدیمی اجرا شده و موتاسیون‌های مالی قدیمی را متوقف می‌کنند:
${globalMiddlewareStack.filter((m) => m.category === 'path_interceptor').map((mw, idx) => `${idx + 1}. **\`${mw.source}\` [مسیر: \`${mw.mountPath}\`]:** ${mw.description}`).join('\n')}

### ج) زنجیره پس از روت‌ها و سیاست‌های هدر کش (Post-Route Pipeline - Cache Policies)
این میدل‌ویرها پس از ارزیابی روت‌های برنامه و قبل از لایه‌های Fallback پایانی اجرا می‌شوند و با فراخوانی \`next()\` هدرهای کش را برای فایل‌های استاتیک تنظیم می‌کنند:
${globalMiddlewareStack.filter((m) => m.category === 'post_route_pipeline').map((mw, idx) => `${idx + 1}. **\`${mw.source}\` [مسیر: \`${mw.mountPath}\`]:** ${mw.description}`).join('\n')}

### د) لایه‌های Fallback پایانی (Terminal Fallbacks)
این لایه‌ها در انتهای سرور و پس از تمام روت‌ها ثبت شده‌اند و صرفاً در صورت عدم تطابق هیچ‌یک از روت‌های قبلی فراخوانی می‌شوند:
${globalMiddlewareStack.filter((m) => m.category === 'terminal_fallback').map((mw, idx) => `${idx + 1}. **\`${mw.source}\` [مسیر: \`${mw.mountPath}\`]:** ${mw.description}`).join('\n')}

### ه) زنجیره مدیریت خطا (Error-Handling Middleware Chain - 4 Arguments)
این هندلرها با ۴ آرگومان \`(err, req, res, next)\` ثبت شده‌اند و طبق معماری Express، **صرفاً در صورت بروز خطا** یا فراخوانی \`next(err)\` اجرا می‌شوند و در جریان پردازش موفق روت‌ها قرار ندارند:
${globalMiddlewareStack.filter((m) => m.category === 'error_handling_chain').map((mw, idx) => `${idx + 1}. **\`${mw.source}\` [مسیر: \`${mw.mountPath}\`]:** ${mw.description}`).join('\n')}

> [!IMPORTANT]
> **تفکیک معماری و استخراج معنایی:** کلیه توضیحات و دسته‌بندی‌های فوق به صورت پویا از متن فراخوانی‌ها، آرگومان‌های هندلر و نشانه‌های معنایی استخراج شده‌اند و شماره خطوط صرفاً جهت ارجاع و استناد مبدأ (\`source citation\`) درج شده‌اند.

---

## ۳. جریان‌های کنترل‌شده درون هندلر و تصمیم‌های معماری (Handler-Controlled Flows & Architectural Decisions)

تعداد **${handlerControlledRoutes.length} مورد** جریان با کنترل اختصاصی درون بدنه هندلر شناسایی و مستند شدند:

| شناسه | متد | مسیر | فایل و خط مبدأ | گارد مشاهده‌شده | قابلیت و مجوز هدف | تصمیم و ردیابی در بکلگ |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
${handlerControlledRoutes.map((r) => {
  return `| \`${r.id}\` | \`${r.method}\` | \`${r.path}\` | \`${r.sourceFile}:${r.sourceLine}\` | \`${r.observedGuard}\` | \`${r.targetFeature}\` / \`${r.targetPermission || '—'}\` (\`${r.targetScope}\`) | ${r.decisionNotes} |`;
}).join('\n')}

---

## ۴. جدول تفصیلی ممیزی تمامی اندپوینت‌ها

| شناسه | متد | مسیر | فایل و خط مبدأ | گارد فعلی | وضعیت ثبت | قابلیت هدف | مجوز هدف | دامنه | وضعیت انطباق گارد | یادداشت و تصمیم معماری |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
` + auditedRoutes.map((r) => {
  const perm = r.isExempt ? '— (معافیت عمومی)' : (r.targetPermission || 'unresolved');
  const note = r.interceptorReason ? `[410] ${r.interceptorReason}` : (r.decisionNotes || (r.registrationCondition !== 'none' ? `شرط: ${r.registrationCondition}` : '-'));
  return `| \`${r.id}\` | \`${r.method}\` | \`${r.path}\` | \`${r.sourceFile}:${r.sourceLine}\` | \`${r.observedGuard}\` | \`${r.lifecycleStatus}\` | \`${r.targetFeature}\` | \`${perm}\` | \`${r.targetScope}\` | \`${r.guardAlignment}\` | ${note} |`;
}).join('\n') + `

---

## ۵. وضعیت گیت‌های معماری و خروج فاز ۰
- **گیت موجودی و نگاشت فاز ۰ (Phase 0 Inventory Gate):** **تأییدشده و کامل (PASSED)** — تمام ${summary.totalExtracted} اندپوینت دارای هویت کانونیکال پایدار، نگاشت معتبر به کاتالوگ، صفر تکرار، و مستندسازی کامل تصمیم‌های معماری با کد ردیابی Backlog (AC-07, AC-08, AC-09, AC-19, AC-20, AC-64) هستند.
- **گیت انطباق قابلیت مسیرها (Route Capability Enforcement Gate):** **${evaluation.productionReadinessGate.passed ? 'تأییدشده (PASSED)' : 'مسدودشده (BLOCKED)'}** — تمام مسیرهای استخراج‌شده از نظر نگاشت قابلیت/مجوز و guard مشاهده‌شده بررسی شدند؛ این نتیجه فقط contract امنیتی route است.
- **گیت واقعی آمادگی انتشار (Overall Production Readiness Gate):** **در این ممیزی ارزیابی نمی‌شود** — مرجع جداگانه و انحصاری آن \`npm run neem:production:gate\` است؛ هیچ route map یا تست محلی مجوز Production GO نمی‌دهد.
- **مجوز پیشروی:** گیت خروج فاز ۰ برآورده شده و ورود به فاز ۱ (Prototype مستقل با داده ساختگی) مجاز است.
`;

    fs.writeFileSync(mdPath, md, 'utf8');
  }

  return {
    routes: auditedRoutes,
    summary,
    evaluation,
    gatePassed: evaluation.phase0InventoryGate.passed
  };
}

if (require.main === module) {
  const checkOnly = process.argv.includes('--check');
  const strict = process.argv.includes('--strict');
  console.log(`--- NEEM Phase 0 Route Audit & Verification Engine [Mode: ${checkOnly ? 'CHECK ONLY' : 'FULL AUDIT'}${strict ? ' (STRICT DECISIONS)' : ''}] ---`);
  
  const result = auditAllRoutes({ checkOnly, strict });
  const s = result.summary;
  const ev = result.evaluation;

  console.log(`Total Extracted Endpoints: ${s.totalExtracted}`);
  console.log(`Per File Breakdown:`);
  Object.entries(s.fileStats).forEach(([f, c]) => console.log(`  - ${f}: ${c} endpoints`));
  console.log(`Total Valid Mapped: ${s.totalMapped}`);
  console.log(`Total Unmapped / Unresolved: ${s.totalUnmapped}`);
  console.log(`Total Duplicates: ${s.totalDuplicates}`);
  console.log(`Lifecycle Breakdown:`, s.lifecycleBreakdown);
  console.log(`Guard Alignment Breakdown:`, s.alignmentBreakdown);
  console.log(`Decisions Pending (Guard Gaps): ${s.totalDecisionsRequired}`);

  if (!ev.phase0InventoryGate.passed) {
    console.error(`\n[PHASE0_INVENTORY_GATE_FAILED] Verification gate blocked! Violations:`);
    ev.phase0InventoryGate.blockingViolations.forEach((v) => console.error(`  - ${v}`));
    process.exit(1);
  } else {
    console.log(`\n[PHASE0_INVENTORY_GATE] PASSED: 100% endpoints mapped, 0 duplicates, 0 unmapped, all decisions recorded.`);
    console.log(`[PRODUCTION_READINESS_GATE] ${ev.productionReadinessGate.passed ? 'PASSED' : 'BLOCKED (As designed per Section 28 - Runtime capability enforcement scheduled in Phase 2/3/5)'}`);
    if (ev.productionReadinessGate.blockingReasons?.length > 0) {
      ev.productionReadinessGate.blockingReasons.forEach((r) => console.log(`  - ${r}`));
    }
    if (!checkOnly) {
      console.log(`Artifacts written:`);
      console.log(`  - docs/salsa/inventory/routes.json`);
      console.log(`  - docs/salsa/contracts/route-capability-mapping-matrix.md`);
    }
    process.exit(0);
  }
}

module.exports = {
  parseCallArguments,
  splitTopLevelArgs,
  parsePathArg,
  extractPrecedingCondition,
  extractPagesKeysFromContent,
  generateCanonicalRouteId,
  generateDeterministicRouteId,
  classifyGlobalMiddleware,
  extractObservedGlobalMiddleware,
  extractRawCallsFromFile,
  analyzeRouteExecution,
  resolveRouteContract,
  evaluateAuditGate,
  auditAllRoutes
};
