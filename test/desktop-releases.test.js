'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createDesktopReleaseService, __test } = require('../server/desktop-releases');

test('desktop release service exposes only supported installers and safe download URLs', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'westo-desktop-'));
  try {
    fs.mkdirSync(path.join(root, 'dist-desktop'), { recursive: true });
    fs.writeFileSync(path.join(root, 'dist-desktop', 'westo-admin-1.0.0-arm64.dmg'), 'mac-installer');
    fs.writeFileSync(path.join(root, 'dist-desktop', 'westo-admin-1.0.0-x64.exe'), 'windows-installer');
    fs.writeFileSync(path.join(root, 'dist-desktop', 'latest-mac.yml'), 'metadata');

    const service = createDesktopReleaseService({ root, packageVersion: '9.9.9' });
    const result = service.list();

    assert.equal(result.available, true);
    assert.equal(result.artifacts.length, 2);
    assert.deepEqual(result.artifacts.map((item) => item.platform).sort(), ['macos', 'windows']);
    assert.match(result.artifacts[0].downloadUrl, /^\/api\/admin\/v2\/desktop\/releases\//);
    assert.equal(service.resolve('macos', 'arm64', 'dmg').fileName, 'westo-admin-1.0.0-arm64.dmg');
    assert.equal(service.resolve('../dist-desktop', 'arm64', 'dmg'), null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('desktop release helpers keep architecture and version parsing deterministic', () => {
  assert.equal(__test.architectureFromName('westo-admin-1.0.0-arm64.dmg'), 'arm64');
  assert.equal(__test.architectureFromName('westo-admin-1.0.0-x64.exe'), 'x64');
  assert.equal(__test.architectureFromName('westo-admin-1.0.0.dmg'), 'universal');
  assert.equal(__test.safeVersionFromName('westo-admin-1.0.0-arm64.dmg', '0.0.0'), '1.0.0');
  assert.equal(__test.safeVersionFromName('westo-admin-latest.dmg', '2.0.0'), '2.0.0');
});
