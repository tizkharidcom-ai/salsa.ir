'use strict';

const fs = require('fs');
const path = require('path');

const input = process.argv[2];
if (!input) {
  console.error('usage: node scripts/analyze-har.js <file.har> [output.json]');
  process.exit(2);
}
const output = process.argv[3] || '';
const har = JSON.parse(fs.readFileSync(path.resolve(input), 'utf8')).log;
const page = har.pages?.[0];
if (!page) throw new Error('HAR has no pages[0]');
const start = Date.parse(page.startedDateTime);
const dcl = Number(page.pageTimings?.onContentLoad) || 0;
const load = Number(page.pageTimings?.onLoad) || 0;

const startedMs = (entry) => Date.parse(entry.startedDateTime) - start;
const bodyBytes = (entry) => Math.max(0, Number(entry.response?.bodySize) || 0);
const timing = (entry, key) => Math.max(0, Number(entry.timings?.[key]) || 0);
const resourceType = (entry) => entry._resourceType || 'other';
const pathOnly = (entry) => {
  try { return new URL(entry.request.url).pathname; } catch { return entry.request.url; }
};

function summarize(entries) {
  const types = {};
  for (const entry of entries) {
    const type = resourceType(entry);
    const row = types[type] ||= { count: 0, bodyBytes: 0, totalMs: 0, blockedMs: 0, waitMs: 0, receiveMs: 0 };
    row.count += 1;
    row.bodyBytes += bodyBytes(entry);
    row.totalMs += Math.max(0, Number(entry.time) || 0);
    row.blockedMs += timing(entry, 'blocked');
    row.waitMs += timing(entry, 'wait');
    row.receiveMs += timing(entry, 'receive');
  }
  return types;
}

const afterNav = har.entries.filter((entry) => startedMs(entry) >= 0);
const byDcl = afterNav.filter((entry) => startedMs(entry) <= dcl);
const byLoad = afterNav.filter((entry) => startedMs(entry) <= load);
const nonImageDcl = byDcl.filter((entry) => resourceType(entry) !== 'image');
const nonImageLoad = byLoad.filter((entry) => resourceType(entry) !== 'image');
const scriptsDcl = byDcl.filter((entry) => resourceType(entry) === 'script');
const scriptTotalMs = scriptsDcl.reduce((sum, entry) => sum + Math.max(0, Number(entry.time) || 0), 0);
const scriptBlockedMs = scriptsDcl.reduce((sum, entry) => sum + timing(entry, 'blocked'), 0);

const sweep = [];
for (const entry of nonImageLoad) {
  const startMs = startedMs(entry);
  const endMs = startMs + Math.max(0, Number(entry.time) || 0);
  sweep.push([startMs, 1], [endMs, -1]);
}
sweep.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
let active = 0;
let maxConcurrent = 0;
let maxConcurrentAtMs = 0;
for (const [at, delta] of sweep) {
  active += delta;
  if (active > maxConcurrent) {
    maxConcurrent = active;
    maxConcurrentAtMs = at;
  }
}

const exactPathCounts = {};
for (const entry of afterNav) {
  const p = pathOnly(entry);
  exactPathCounts[p] = (exactPathCounts[p] || 0) + 1;
}
const apiCounts = Object.fromEntries(Object.entries(exactPathCounts).filter(([key]) => key.startsWith('/api/')).sort());
const allErrors = afterNav.filter((entry) => Number(entry.response?.status) >= 400 || entry.response?._error);
const errors = allErrors
  .filter((entry) => resourceType(entry) !== 'image')
  .map((entry) => ({ status: entry.response?.status, error: entry.response?._error || '', type: resourceType(entry), url: entry.request.url }));
const imageErrorCount = allErrors.filter((entry) => resourceType(entry) === 'image').length;

const topBlocked = nonImageDcl
  .map((entry) => ({
    blockedMs: timing(entry, 'blocked'),
    totalMs: Math.max(0, Number(entry.time) || 0),
    bodyBytes: bodyBytes(entry),
    type: resourceType(entry),
    priority: entry._priority || '',
    status: entry.response?.status,
    url: entry.request.url,
  }))
  .sort((a, b) => b.blockedMs - a.blockedMs)
  .slice(0, 25);

function countGroup(entries, predicate) {
  const hits = entries.filter((entry) => resourceType(entry) === 'script' && predicate(pathOnly(entry)));
  return {
    count: hits.length,
    bodyBytes: hits.reduce((sum, entry) => sum + bodyBytes(entry), 0),
    blockedMs: hits.reduce((sum, entry) => sum + timing(entry, 'blocked'), 0),
  };
}

const protocols = {};
const connections = new Set();
for (const entry of nonImageLoad) {
  const version = entry.response?.httpVersion || 'unknown';
  protocols[version] = (protocols[version] || 0) + 1;
  if (entry._connectionId) connections.add(entry._connectionId);
}

const result = {
  schema: 'westo-har-network-audit-v1',
  source: path.basename(input),
  page: page.id || '',
  title: page.title || '',
  pageStart: page.startedDateTime,
  dclMs: dcl,
  loadMs: load,
  totalEntries: har.entries.length,
  afterNavigationEntries: afterNav.length,
  requestsByDcl: byDcl.length,
  requestsByLoad: byLoad.length,
  nonImageRequestsByDcl: nonImageDcl.length,
  nonImageRequestsByLoad: nonImageLoad.length,
  scriptsByDcl: scriptsDcl.length,
  scriptBodyBytesByDcl: scriptsDcl.reduce((sum, entry) => sum + bodyBytes(entry), 0),
  scriptBlockedMsByDcl: scriptBlockedMs,
  scriptBlockedSharePct: scriptTotalMs ? (scriptBlockedMs / scriptTotalMs) * 100 : 0,
  maxConcurrentNonImageByLoad: maxConcurrent,
  maxConcurrentNonImageAtMs: maxConcurrentAtMs,
  connectionCountByLoad: connections.size,
  protocols,
  byDcl: summarize(byDcl),
  byLoad: summarize(byLoad),
  groupsByDcl: {
    webflow: countGroup(byDcl, (p) => p.includes('/webflow.')),
    three: countGroup(byDcl, (p) => p.includes('/js/vendor/three/') || p.endsWith('/js/three-scene.js') || p.endsWith('/js/vendor/lenis.mjs')),
    firstPartyJs: countGroup(byDcl, (p) => p.startsWith('/js/') && !p.includes('/vendor/')),
    tableCart: countGroup(byDcl, (p) => p.endsWith('/js/table-cart.js')),
  },
  apiCounts,
  errors,
  imageErrorCount,
  topBlocked,
};

const text = JSON.stringify(result, null, 2) + '\n';
if (output) fs.writeFileSync(path.resolve(output), text);
process.stdout.write(text);
