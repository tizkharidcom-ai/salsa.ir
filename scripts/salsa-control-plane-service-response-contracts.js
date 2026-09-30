'use strict';

/**
 * Conservative source reader for Control Plane service return values.
 * It only promotes fields/kinds that are visible in a service method's own
 * return expression. Database rows, delegated helpers and dynamic objects stay
 * opaque and are returned as review metadata rather than guessed schemas.
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const cache = new Map();

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
    else if (ch === '}' && --depth === 0) return index;
  }
  return -1;
}

function matchingDelimiter(source, openIndex, openChar, closeChar) {
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
    if (ch === openChar) depth += 1;
    else if (ch === closeChar && --depth === 0) return index;
  }
  return -1;
}

function topLevelObjectFields(source, openIndex) {
  const closeIndex = matchingBrace(source, openIndex);
  if (closeIndex < 0) return [];
  const body = source.slice(openIndex + 1, closeIndex);
  const fields = new Set();
  let depth = 0;
  let quote = null;
  let escaped = false;
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
    if ('{[('.includes(ch)) {
      depth += 1;
      continue;
    }
    if ('}])'.includes(ch)) {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (depth !== 0) continue;
    const before = body.slice(0, index).trimEnd();
    if (before && !/[{,]$/.test(before)) continue;
    const field = body.slice(index).match(/^([A-Za-z_$][\w$]*)\s*:/);
    if (field) {
      fields.add(field[1]);
      index += field[0].length - 1;
      continue;
    }
    const shorthand = body.slice(index).match(/^([A-Za-z_$][\w$]*)\s*(?=,|$)/);
    if (shorthand) {
      fields.add(shorthand[1]);
      index += shorthand[0].length - 1;
    }
  }
  return [...fields].sort();
}

function resolveModule(routeSourceFile, moduleReference) {
  let candidate = path.resolve(ROOT, path.dirname(routeSourceFile), moduleReference);
  if (path.extname(candidate)) return candidate;
  if (fs.existsSync(`${candidate}.js`)) return `${candidate}.js`;
  if (fs.existsSync(path.join(candidate, 'index.js'))) return path.join(candidate, 'index.js');
  return null;
}

function importBindings(routeSourceFile) {
  const absolute = path.resolve(ROOT, routeSourceFile);
  const source = fs.readFileSync(absolute, 'utf8');
  const bindings = new Map();

  const directRequire = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*require\(['"]([^'"]+)['"]\)/g;
  for (const match of source.matchAll(directRequire)) {
    bindings.set(match[1], { moduleReference: match[2], className: null });
  }

  const destructuredRequire = /(?:const|let|var)\s+\{([^}]+)\}\s*=\s*require\(['"]([^'"]+)['"]\)/g;
  for (const match of source.matchAll(destructuredRequire)) {
    for (const part of match[1].split(',')) {
      const [imported, local] = part.trim().split(/\s+as\s+/);
      if (!imported) continue;
      const binding = (local || imported).trim();
      bindings.set(binding, { moduleReference: match[2], className: imported.trim() });
    }
  }

  const instances = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*new\s+([A-Za-z_$][\w$]*)\s*\(/g;
  for (const match of source.matchAll(instances)) {
    const imported = bindings.get(match[2]);
    if (imported) bindings.set(match[1], { ...imported, className: match[2] });
  }

  return bindings;
}

function methodBody(source, methodName) {
  const escaped = String(methodName).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const signaturePattern = new RegExp(`(?:function\\s+)?(?:async\\s+)?${escaped}\\s*\\(`, 'gm');
  for (const match of source.matchAll(signaturePattern)) {
    const openParen = source.indexOf('(', match.index);
    const closeParen = matchingDelimiter(source, openParen, '(', ')');
    if (closeParen < 0) continue;
    let cursor = closeParen + 1;
    while (/\s/.test(source[cursor] || '')) cursor += 1;
    if (source.slice(cursor, cursor + 2) === '=>') {
      cursor += 2;
      while (/\s/.test(source[cursor] || '')) cursor += 1;
    }
    if (source[cursor] !== '{') continue;
    const closeIndex = matchingBrace(source, cursor);
    if (closeIndex >= 0) return source.slice(cursor, closeIndex + 1);
  }
  return null;
}

function inspectMethod(source, methodName, seen = new Set()) {
  if (seen.has(methodName)) return { status: 'service_return_opaque', kind: 'opaque', fields: [] };
  const nextSeen = new Set(seen).add(methodName);
  const body = methodBody(source, methodName);
  if (!body) return { status: 'unresolved_method', kind: 'opaque', fields: [] };

  const fields = new Set();
  let sawObjectReturn = false;
  let sawArrayReturn = /return\s*\[/.test(body)
    || /return\s+[^;\n]*\.map\s*\(/.test(body)
    || /return\s+\w+\.rows\b/.test(body);
  const objectReturns = [
    ...body.matchAll(/return\s*\{/g),
    ...body.matchAll(/return\b[^;\n]*?\?\s*\{/g)
  ].sort((a, b) => a.index - b.index);
  for (const match of objectReturns) {
    const openIndex = body.indexOf('{', match.index);
    sawObjectReturn = true;
    for (const field of topLevelObjectFields(body, openIndex)) fields.add(field);
  }

  const objectBindings = new Map();
  for (const match of body.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*\{/g)) {
    const openIndex = body.indexOf('{', match.index);
    objectBindings.set(match[1], topLevelObjectFields(body, openIndex));
  }

  const localObjectHelpers = new Map();
  for (const match of body.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>\s*\(\s*\{/g)) {
    const openIndex = body.indexOf('{', match.index);
    localObjectHelpers.set(match[1], topLevelObjectFields(body, openIndex));
  }

  const helperBindings = new Map();
  for (const match of body.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:await\s+)?(?:this\.)?([A-Za-z_$][\w$]*)\s*\(/g)) {
    helperBindings.set(match[1], match[2]);
  }
  for (const match of body.matchAll(/return\s+([A-Za-z_$][\w$]*)\b/g)) {
    const boundFields = objectBindings.get(match[1]);
    if (boundFields) {
      sawObjectReturn = true;
      for (const field of boundFields) fields.add(field);
      continue;
    }
    if (localObjectHelpers.has(match[1])) {
      sawObjectReturn = true;
      for (const field of localObjectHelpers.get(match[1])) fields.add(field);
      continue;
    }
    const helperName = helperBindings.get(match[1]);
    if (!helperName) continue;
    const helper = inspectMethod(source, helperName, nextSeen);
    if (helper.status !== 'source_observed_service_return') continue;
    for (const field of helper.fields || []) fields.add(field);
    if (helper.kind === 'object') sawObjectReturn = true;
    if (helper.kind === 'array') sawArrayReturn = true;
  }

  const arrayBindings = new Set();
  for (const match of body.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:[^;\n]*?\.rows\b|Array\.from\s*\()/g)) {
    arrayBindings.add(match[1]);
  }
  for (const match of body.matchAll(/return\s+([A-Za-z_$][\w$]*)\b/g)) {
    if (arrayBindings.has(match[1])) sawArrayReturn = true;
  }

  let itemFields = [];
  for (const match of body.matchAll(/\.map\s*\([^=()]*=>\s*(?:this\.)?([A-Za-z_$][\w$]*)\s*\(/g)) {
    const helper = inspectMethod(source, match[1], nextSeen);
    if (helper.status === 'source_observed_service_return' && helper.kind === 'object') {
      itemFields = [...new Set([...itemFields, ...helper.fields])].sort();
    }
  }

  const delegatedContracts = [];
  for (const match of body.matchAll(/return\s+(?:this\.)?([A-Za-z_$][\w$]*)\s*\(/g)) {
    const helperName = match[1];
    if (localObjectHelpers.has(helperName)) {
      sawObjectReturn = true;
      for (const field of localObjectHelpers.get(helperName)) fields.add(field);
      continue;
    }
    const helper = inspectMethod(source, helperName, nextSeen);
    if (helper.status === 'source_observed_service_return') delegatedContracts.push(helper);
  }
  for (const helper of delegatedContracts) {
    for (const field of helper.fields || []) fields.add(field);
    if (helper.kind === 'object') sawObjectReturn = true;
    if (helper.kind === 'array') sawArrayReturn = true;
    if (helper.kind === 'scalar' && !sawObjectReturn && !sawArrayReturn) {
      return { status: 'source_observed_service_return', kind: 'scalar', fields: [] };
    }
  }

  if (sawObjectReturn) return { status: 'source_observed_service_return', kind: 'object', fields: [...fields].sort() };
  if (sawArrayReturn) {
    return { status: 'source_observed_service_return', kind: 'array', fields: [], ...(itemFields.length ? { itemFields } : {}) };
  }
  if (/return\s+(?:true|false|null|undefined|['"]|\d)/.test(body)) {
    return { status: 'source_observed_service_return', kind: 'scalar', fields: [] };
  }
  return { status: 'service_return_opaque', kind: 'opaque', fields: [] };
}

function getServiceResponseContract({ routeSourceFile, serviceCall }) {
  if (!routeSourceFile || !serviceCall || !serviceCall.includes('.')) return null;
  const cacheKey = `${routeSourceFile}:${serviceCall}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey);

  const [binding, methodName] = serviceCall.split(/\.(.+)/);
  const bindings = importBindings(routeSourceFile);
  const bindingInfo = bindings.get(binding);
  if (!bindingInfo) {
    const result = { status: 'unresolved_binding', kind: 'opaque', fields: [], serviceCall };
    cache.set(cacheKey, result);
    return result;
  }
  const moduleFile = resolveModule(routeSourceFile, bindingInfo.moduleReference);
  if (!moduleFile || !fs.existsSync(moduleFile)) {
    const result = { status: 'unresolved_module', kind: 'opaque', fields: [], serviceCall };
    cache.set(cacheKey, result);
    return result;
  }

  const source = fs.readFileSync(moduleFile, 'utf8');
  const inspected = inspectMethod(source, methodName);
  const result = {
    ...inspected,
    serviceCall,
    sourceFile: path.relative(ROOT, moduleFile),
    method: methodName
  };
  cache.set(cacheKey, result);
  return result;
}

function getFactoryServiceResponseContract({ routeSourceFile, serviceCall }) {
  if (!routeSourceFile || !serviceCall || !serviceCall.includes('.')) return null;
  const [binding, methodName] = serviceCall.split(/\.(.+)/);
  const routeSourcePath = path.resolve(ROOT, routeSourceFile);
  const routeSource = fs.readFileSync(routeSourcePath, 'utf8');
  const escapedBinding = String(binding).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const defaultBinding = routeSource.match(new RegExp(`\\b${escapedBinding}\\s*=\\s*([A-Za-z_$][\\w$]*)\\s*\\(`));
  if (!defaultBinding) return null;
  const factoryName = defaultBinding[1];
  const bindings = importBindings(routeSourceFile);
  const bindingInfo = bindings.get(factoryName);
  if (!bindingInfo) return null;
  const moduleFile = resolveModule(routeSourceFile, bindingInfo.moduleReference);
  if (!moduleFile || !fs.existsSync(moduleFile)) return null;
  const moduleSource = fs.readFileSync(moduleFile, 'utf8');
  const factoryBody = methodBody(moduleSource, factoryName);
  if (!factoryBody) return null;
  const inspected = inspectMethod(factoryBody, methodName);
  return {
    ...inspected,
    serviceCall,
    sourceFile: path.relative(ROOT, moduleFile),
    method: methodName,
    factory: factoryName,
    sourceKind: 'factory_injected_service'
  };
}

module.exports = { getServiceResponseContract, getFactoryServiceResponseContract, inspectMethod };
