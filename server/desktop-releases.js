'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const SUPPORTED = new Map([
  ['.dmg', { platform: 'macos', format: 'dmg', installer: true }],
  ['.zip', { platform: 'macos', format: 'zip', installer: false }],
  ['.exe', { platform: 'windows', format: 'exe', installer: true }],
]);

function safeVersionFromName(name, fallback) {
  const match = String(name).match(/(?:^|[-_])v?(\d+\.\d+\.\d+)(?:[-_.]|$)/);
  return match?.[1] || fallback;
}

function architectureFromName(name) {
  const value = String(name).toLowerCase();
  if (value.includes('arm64') || value.includes('aarch64')) return 'arm64';
  if (value.includes('x64') || value.includes('amd64')) return 'x64';
  return 'universal';
}

function versionSort(a, b) {
  const parse = (value) => String(value || '0').split(/[.+-]/).slice(0, 3).map((part) => Number(part) || 0);
  const left = parse(a);
  const right = parse(b);
  return (right[0] - left[0]) || (right[1] - left[1]) || (right[2] - left[2]);
}

function hashFile(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function createDesktopReleaseService({ root, packageVersion = '0.0.0' } = {}) {
  const projectRoot = path.resolve(root || path.join(__dirname, '..'));
  const releaseDirectories = [
    path.join(projectRoot, 'dist-desktop'),
    path.join(projectRoot, 'desktop', 'releases'),
  ];
  const hashCache = new Map();

  function artifacts() {
    const found = [];
    const seen = new Set();
    for (const directory of releaseDirectories) {
      let entries = [];
      try { entries = fs.readdirSync(directory, { withFileTypes: true }); } catch { continue; }
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        const extension = path.extname(entry.name).toLowerCase();
        const type = SUPPORTED.get(extension);
        if (!type) continue;
        const absolutePath = path.join(directory, entry.name);
        const realPath = path.resolve(absolutePath);
        if (seen.has(realPath)) continue;
        seen.add(realPath);
        const stat = fs.statSync(realPath);
        const cacheKey = `${realPath}:${stat.size}:${stat.mtimeMs}`;
        const sha256 = hashCache.get(cacheKey) || hashFile(realPath);
        hashCache.set(cacheKey, sha256);
        found.push({
          fileName: entry.name,
          absolutePath: realPath,
          platform: type.platform,
          format: type.format,
          installer: type.installer,
          arch: architectureFromName(entry.name),
          version: safeVersionFromName(entry.name, packageVersion),
          size: stat.size,
          sha256,
        });
      }
    }
    return found.sort((a, b) => versionSort(a.version, b.version) || Number(b.installer) - Number(a.installer) || a.platform.localeCompare(b.platform) || a.arch.localeCompare(b.arch) || a.fileName.localeCompare(b.fileName));
  }

  function list() {
    const items = artifacts();
    const latestVersion = items[0]?.version || null;
    return {
      available: items.length > 0,
      version: latestVersion,
      generatedAt: new Date().toISOString(),
      artifacts: items.map((item) => ({
        fileName: item.fileName,
        platform: item.platform,
        arch: item.arch,
        format: item.format,
        installer: item.installer,
        version: item.version,
        size: item.size,
        sha256: item.sha256,
        downloadUrl: `/api/admin/v2/desktop/releases/${encodeURIComponent(item.platform)}/${encodeURIComponent(item.arch)}/${encodeURIComponent(item.format)}/download`,
      })),
      message: items.length ? 'نسخه‌های آمادهٔ نصب در دسترس هستند.' : 'هنوز فایل نصب‌کننده‌ای روی سرور منتشر نشده است.',
    };
  }

  function resolve(platform, arch, format) {
    const normalizedPlatform = String(platform || '').toLowerCase();
    const normalizedArch = String(arch || '').toLowerCase();
    const normalizedFormat = String(format || '').toLowerCase();
    return artifacts().find((item) => item.platform === normalizedPlatform && item.arch === normalizedArch && item.format === normalizedFormat) || null;
  }

  return { list, resolve, __test: { artifacts, releaseDirectories } };
}

module.exports = { createDesktopReleaseService, __test: { architectureFromName, safeVersionFromName, versionSort } };
