'use strict';

const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');

function safeVersion(value) {
  const version = String(value || '').trim();
  if (!version || !/^[vV]?[0-9A-Za-z][0-9A-Za-z._+-]{0,63}$/.test(version)) {
    throw new Error('EDGE_PACKAGE_VERSION_INVALID');
  }
  return version;
}

function validatePackageUrl(value) {
  let parsed;
  try {
    parsed = new URL(String(value || ''));
  } catch {
    throw new Error('EDGE_PACKAGE_URL_INVALID');
  }
  if (parsed.protocol !== 'https:' || !parsed.hostname) {
    throw new Error('EDGE_PACKAGE_URL_MUST_USE_HTTPS');
  }
  return parsed.toString();
}

function verifySignature({ version, checksum, signatureHex, publicKey }) {
  if (!/^[0-9a-f]{128}$/i.test(String(signatureHex || ''))) {
    throw new Error('EDGE_PACKAGE_SIGNATURE_INVALID_FORMAT');
  }
  try {
    return crypto.verify(
      null,
      Buffer.from(`${version}:${checksum}`, 'utf8'),
      publicKey,
      Buffer.from(signatureHex, 'hex')
    );
  } catch {
    return false;
  }
}

/**
 * Stages verified edge artifacts without executing untrusted code. The only
 * activation mutation is an atomic active.json pointer; the Edge process is
 * responsible for consuming that pointer under its own sandbox/service unit.
 */
class SignedPackageRunner {
  constructor({ rootDir, publicKey }) {
    if (!rootDir) throw new Error('EDGE_PACKAGE_ARTIFACT_DIR is required.');
    if (!publicKey) throw new Error('EDGE_PACKAGE_PUBLIC_KEY is required.');
    this.rootDir = path.resolve(rootDir);
    this.publicKey = publicKey;
  }

  packageDir(version) {
    return path.join(this.rootDir, safeVersion(version));
  }

  packagePath(version) {
    return path.join(this.packageDir(version), 'package.bin');
  }

  descriptorPath(version) {
    return path.join(this.packageDir(version), 'descriptor.json');
  }

  activePath() {
    return path.join(this.rootDir, 'active.json');
  }

  async stage({ version, packageUrl, rawContent, signatureHex, expectedChecksum = null }) {
    const normalizedVersion = safeVersion(version);
    const normalizedUrl = validatePackageUrl(packageUrl);
    const content = Buffer.isBuffer(rawContent) ? rawContent : Buffer.from(String(rawContent ?? ''), 'utf8');
    if (content.length === 0) throw new Error('EDGE_PACKAGE_CONTENT_EMPTY');
    const checksum = crypto.createHash('sha256').update(content).digest('hex');
    if (expectedChecksum && String(expectedChecksum).toLowerCase() !== checksum) {
      throw new Error('EDGE_PACKAGE_CHECKSUM_MISMATCH');
    }
    if (!verifySignature({ version: normalizedVersion, checksum, signatureHex, publicKey: this.publicKey })) {
      throw new Error('EDGE_PACKAGE_SIGNATURE_INVALID');
    }

    const packageDir = this.packageDir(normalizedVersion);
    const descriptor = {
      version: normalizedVersion,
      package_url: normalizedUrl,
      checksum_sha256: checksum,
      signature_hex: String(signatureHex).toLowerCase(),
      staged_at: new Date().toISOString(),
      status: 'verified_staged'
    };
    await fs.mkdir(packageDir, { recursive: true, mode: 0o700 });
    const packageTemp = `${this.packagePath(normalizedVersion)}.${process.pid}.${crypto.randomUUID()}.tmp`;
    const descriptorTemp = `${this.descriptorPath(normalizedVersion)}.${process.pid}.${crypto.randomUUID()}.tmp`;
    try {
      await fs.writeFile(packageTemp, content, { mode: 0o600, flag: 'wx' });
      await fs.writeFile(descriptorTemp, JSON.stringify(descriptor, null, 2), { mode: 0o600, flag: 'wx' });
      await fs.rename(packageTemp, this.packagePath(normalizedVersion));
      await fs.rename(descriptorTemp, this.descriptorPath(normalizedVersion));
    } catch (err) {
      await fs.rm(packageTemp, { force: true }).catch(() => {});
      await fs.rm(descriptorTemp, { force: true }).catch(() => {});
      throw err;
    }
    return { ...descriptor, package_path: this.packagePath(normalizedVersion) };
  }

  async verifyStaged(version) {
    const normalizedVersion = safeVersion(version);
    let descriptor;
    try {
      descriptor = JSON.parse(await fs.readFile(this.descriptorPath(normalizedVersion), 'utf8'));
    } catch (err) {
      throw new Error(`EDGE_PACKAGE_DESCRIPTOR_READ_FAILED: ${err.message}`);
    }
    const content = await fs.readFile(this.packagePath(normalizedVersion));
    const checksum = crypto.createHash('sha256').update(content).digest('hex');
    if (checksum !== descriptor.checksum_sha256 ||
        !verifySignature({
          version: descriptor.version,
          checksum,
          signatureHex: descriptor.signature_hex,
          publicKey: this.publicKey
        })) {
      throw new Error('EDGE_PACKAGE_STAGED_ARTIFACT_VERIFICATION_FAILED');
    }
    return { ...descriptor, package_path: this.packagePath(normalizedVersion), verified: true };
  }

  async activate(version) {
    const verified = await this.verifyStaged(version);
    const temporary = `${this.activePath()}.${process.pid}.${crypto.randomUUID()}.tmp`;
    await fs.mkdir(this.rootDir, { recursive: true, mode: 0o700 });
    try {
      await fs.writeFile(temporary, JSON.stringify({
        version: verified.version,
        checksum_sha256: verified.checksum_sha256,
        activated_at: new Date().toISOString()
      }, null, 2), { mode: 0o600, flag: 'wx' });
      await fs.rename(temporary, this.activePath());
    } catch (err) {
      await fs.rm(temporary, { force: true }).catch(() => {});
      throw err;
    }
    return { ...verified, activated: true, active_path: this.activePath() };
  }
}

module.exports = {
  SignedPackageRunner,
  safeVersion,
  validatePackageUrl
};
