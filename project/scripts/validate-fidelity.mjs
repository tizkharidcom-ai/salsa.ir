import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const pages = JSON.parse(await readFile(new URL('docs/reference-audit/reference-pages.json', root), 'utf8'));
const dialogs = JSON.parse(await readFile(new URL('docs/reference-audit/reference-dialogs.json', root), 'utf8'));
const rowOperations = JSON.parse(await readFile(new URL('docs/reference-audit/reference-row-operations.json', root), 'utf8'));
const fidelitySource = await readFile(new URL('app/fidelity-config.ts', root), 'utf8');
const workspaceSource = await readFile(new URL('app/workspace.tsx', root), 'utf8');

const unique = values => [...new Set(values)];
const referencePaths = unique(pages.map(page => page.href)).sort();
const internalReferencePaths = referencePaths.filter(path => path !== '/panel/');
const configuredPaths = unique([...fidelitySource.matchAll(/referencePath:'([^']+)'/g)].map(match => match[1])).sort();
const missing = internalReferencePaths.filter(path => !configuredPaths.includes(path));
const unexpected = configuredPaths.filter(path => !internalReferencePaths.includes(path));
const duplicateConfiguredPaths = [...fidelitySource.matchAll(/referencePath:'([^']+)'/g)].map(match => match[1]).filter((path, index, all) => all.indexOf(path) !== index);
const modules = Object.entries(Object.groupBy(pages, page => page.moduleName)).map(([name, entries]) => ({ name, count: entries.length }));

const errors = [];
if (referencePaths.length !== 75) errors.push(`تعداد مسیرهای مرجع ${referencePaths.length} است؛ انتظار ۷۵ مسیر بود.`);
if (configuredPaths.length !== 74) errors.push(`تعداد مسیرهای داخلی تعریف‌شده ${configuredPaths.length} است؛ انتظار ۷۴ مسیر بود.`);
if (!workspaceSource.includes("kind:'dashboard'")) errors.push('داشبورد در تنظیمات صفحه تعریف نشده است.');
if (!workspaceSource.includes("key:'recipes'")) errors.push('صفحه تکمیلی رسپی در منوی محصولات تعریف نشده است.');
if (missing.length) errors.push(`مسیرهای جاافتاده: ${missing.join(', ')}`);
if (unexpected.length) errors.push(`مسیرهای ناشناخته: ${unexpected.join(', ')}`);
if (duplicateConfiguredPaths.length) errors.push(`مسیرهای تکراری: ${unique(duplicateConfiguredPaths).join(', ')}`);

const result = {
  status: errors.length ? 'FAILED' : 'PASSED',
  referenceDestinations: referencePaths.length,
  configuredInternalDestinations: configuredPaths.length,
  dashboardDestinations: 1,
  localAdditionalRecipeScreen: 1,
  totalLocalViews: configuredPaths.length + 2,
  capturedDialogs: dialogs.filter(entry => entry.hasDialog).length,
  auditedRowOperationPages: rowOperations.filter(entry => entry.hasDots || entry.ops?.length).length,
  modules,
  missing,
  unexpected,
  errors,
};

console.log(JSON.stringify(result, null, 2));
if (errors.length) process.exitCode = 1;
