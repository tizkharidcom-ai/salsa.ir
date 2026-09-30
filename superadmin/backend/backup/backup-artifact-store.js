'use strict';

const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const { sha256 } = require('../auth/crypto-util');

const MAGIC = 'NEEM_BACKUP_ARTIFACT_V1';

function safePart(value, label) {
  const clean = String(value || '').trim();
  if (!clean || clean === '.' || clean === '..' || clean.includes('..') || !/^[a-zA-Z0-9._-]+$/.test(clean)) {
    throw new Error(`BACKUP_ARTIFACT_INVALID_${label.toUpperCase()}`);
  }
  return clean;
}

function resolveKey(value) {
  if (Buffer.isBuffer(value) && value.length === 32) return value;
  if (typeof value === 'string' && /^[0-9a-f]{64}$/i.test(value)) return Buffer.from(value, 'hex');
  throw new Error('BACKUP_ARTIFACT_ENCRYPTION_KEY must be a 32-byte Buffer or 64-character hex string.');
}

function normalizeKeyring({ encryptionKey, encryptionKeyring, activeKeyId }) {
  const source = encryptionKeyring && typeof encryptionKeyring === 'object'
    ? encryptionKeyring
    : (encryptionKey ? { legacy: encryptionKey } : null);
  if (!source || Array.isArray(source) || Object.keys(source).length === 0) {
    throw new Error('BACKUP_ARTIFACT_ENCRYPTION_KEYRING or BACKUP_ARTIFACT_ENCRYPTION_KEY is required.');
  }

  const keys = new Map();
  for (const [keyId, value] of Object.entries(source)) {
    if (!/^[a-zA-Z0-9._-]{1,64}$/.test(keyId)) {
      throw new Error(`BACKUP_ARTIFACT_INVALID_KEY_ID: ${keyId}`);
    }
    keys.set(keyId, resolveKey(value));
  }

  const selectedKeyId = activeKeyId || (keys.has('legacy') ? 'legacy' : keys.keys().next().value);
  if (!keys.has(selectedKeyId)) {
    throw new Error(`BACKUP_ARTIFACT_ACTIVE_KEY_NOT_FOUND: ${selectedKeyId}`);
  }
  return { keys, activeKeyId: selectedKeyId };
}

/**
 * Small encrypted artifact repository used by the control plane backup
 * workflow. The envelope contains only nonce, tag and ciphertext; plaintext
 * backup data never lands on disk. Production deployments should point rootDir
 * at an encrypted volume/object-store gateway and inject the key from a secret
 * manager rather than committing it to the environment file.
 */
class BackupArtifactStore {
  constructor({ rootDir, encryptionKey, encryptionKeyring, activeKeyId }) {
    if (!rootDir) throw new Error('BACKUP_ARTIFACT_ROOT_DIR is required.');
    this.rootDir = path.resolve(rootDir);
    const keyring = normalizeKeyring({ encryptionKey, encryptionKeyring, activeKeyId });
    this.keys = keyring.keys;
    this.activeKeyId = keyring.activeKeyId;
  }

  getKeyringStatus() {
    return {
      active_key_id: this.activeKeyId,
      key_ids: [...this.keys.keys()]
    };
  }

  assertKeyAvailable(keyId) {
    const selectedKeyId = keyId || this.activeKeyId;
    if (!this.keys.has(selectedKeyId)) {
      throw new Error(`BACKUP_ARTIFACT_KEY_UNAVAILABLE: ${selectedKeyId}`);
    }
    return selectedKeyId;
  }

  artifactPath({ tenantId, manifestId, kind }) {
    const tenant = safePart(tenantId, 'tenant_id');
    const manifest = safePart(manifestId, 'manifest_id');
    const normalizedKind = kind === 'db' ? 'database.sql.enc' : (kind === 'files' ? 'storage_assets.tar.gz.enc' : null);
    if (!normalizedKind) throw new Error('BACKUP_ARTIFACT_KIND must be db or files.');
    const fullPath = path.resolve(this.rootDir, tenant, manifest, normalizedKind);
    if (!fullPath.startsWith(this.rootDir + path.sep) && fullPath !== this.rootDir) {
      throw new Error('BACKUP_ARTIFACT_PATH_TRAVERSAL_DETECTED');
    }
    return fullPath;
  }

  ref({ tenantId, manifestId, kind }) {
    const name = kind === 'db' ? 'database.sql.enc' : 'storage_assets.tar.gz.enc';
    return `artifact://neem-backups/${encodeURIComponent(safePart(tenantId, 'tenant_id'))}/${encodeURIComponent(safePart(manifestId, 'manifest_id'))}/${name}`;
  }

  async put({ tenantId, manifestId, kind, content, keyId, allowReplace = false }) {
    const target = this.artifactPath({ tenantId, manifestId, kind });
    const plaintext = Buffer.isBuffer(content) ? content : Buffer.from(String(content ?? ''), 'utf8');
    const selectedKeyId = this.assertKeyAvailable(keyId);
    if (!allowReplace && await this.exists({ tenantId, manifestId, kind })) {
      throw new Error('BACKUP_ARTIFACT_IMMUTABLE: an existing backup artifact cannot be overwritten.');
    }
    const encryptionKey = this.keys.get(selectedKeyId);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const envelope = Buffer.from(JSON.stringify({
      magic: MAGIC,
      algorithm: 'aes-256-gcm',
      key_id: selectedKeyId,
      iv: iv.toString('hex'),
      tag: cipher.getAuthTag().toString('hex'),
      ciphertext: ciphertext.toString('base64')
    }), 'utf8');

    await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    const temporary = `${target}.${process.pid}.${crypto.randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporary, envelope, { mode: 0o600, flag: 'wx' });
      if (allowReplace) await fs.rename(temporary, target);
      else {
        // Hard-linking the fully written temporary file is an atomic
        // no-clobber commit: a concurrent writer receives EEXIST instead of
        // replacing an already verified artifact.
        await fs.link(temporary, target);
        await fs.unlink(temporary);
      }
    } catch (err) {
      await fs.rm(temporary, { force: true }).catch(() => {});
      throw err;
    }

    return {
      artifact_ref: this.ref({ tenantId, manifestId, kind }),
      size_bytes: plaintext.length,
      checksum_sha256: sha256(plaintext),
      encryption_key_id: selectedKeyId
    };
  }

  async readEnvelope({ tenantId, manifestId, kind }) {
    const target = this.artifactPath({ tenantId, manifestId, kind });
    let envelope;
    try {
      envelope = JSON.parse(await fs.readFile(target, 'utf8'));
    } catch (err) {
      throw new Error(`BACKUP_ARTIFACT_ENVELOPE_READ_FAILED: ${err.message}`);
    }
    if (envelope.magic !== MAGIC || envelope.algorithm !== 'aes-256-gcm') {
      throw new Error('BACKUP_ARTIFACT_INVALID_ENVELOPE');
    }
    return envelope;
  }

  async read({ tenantId, manifestId, kind }) {
    const envelope = await this.readEnvelope({ tenantId, manifestId, kind });
    // Envelopes created before key rotation had no key_id and used the single
    // configured key. Keep that compatibility path explicit and auditable.
    const selectedKeyId = envelope.key_id || this.activeKeyId;
    const encryptionKey = this.keys.get(selectedKeyId);
    if (!encryptionKey) {
      throw new Error(`BACKUP_ARTIFACT_KEY_UNAVAILABLE: ${selectedKeyId}`);
    }
    const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey, Buffer.from(envelope.iv, 'hex'));
    decipher.setAuthTag(Buffer.from(envelope.tag, 'hex'));
    return Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
      decipher.final()
    ]);
  }

  async checksum({ tenantId, manifestId, kind }) {
    const content = await this.read({ tenantId, manifestId, kind });
    // Database dumps are binary custom-format artifacts. Hash the exact bytes;
    // converting them to UTF-8 would replace invalid sequences and invalidate
    // a manifest even when authenticated decryption succeeded.
    return sha256(content);
  }

  async keyId({ tenantId, manifestId, kind }) {
    const envelope = await this.readEnvelope({ tenantId, manifestId, kind });
    return envelope.key_id || this.activeKeyId;
  }

  async rotate({ tenantId, manifestId, kind, newKeyId }) {
    const content = await this.read({ tenantId, manifestId, kind });
    return this.put({ tenantId, manifestId, kind, content, keyId: newKeyId, allowReplace: true });
  }

  async exists({ tenantId, manifestId, kind }) {
    try {
      await fs.access(this.artifactPath({ tenantId, manifestId, kind }));
      return true;
    } catch {
      return false;
    }
  }
}

function awsPercentEncode(value) {
  return encodeURIComponent(String(value)).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

function hmacSha256(key, value, encoding = undefined) {
  const digest = crypto.createHmac('sha256', key).update(value).digest();
  return encoding ? digest.toString(encoding) : digest;
}

function sha256Buffer(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

/**
 * S3-compatible encrypted artifact repository. It uses path-style requests so
 * the same contract works with an Iranian object-storage gateway, MinIO, or a
 * managed S3-compatible provider. The object store receives only the
 * authenticated encrypted envelope, never plaintext backup bytes.
 */
class S3CompatibleBackupArtifactStore {
  constructor({
    endpoint,
    bucket,
    accessKeyId,
    secretAccessKey,
    region = 'us-east-1',
    prefix = 'neem-backups',
    encryptionKey,
    encryptionKeyring,
    activeKeyId,
    fetchImpl = globalThis.fetch,
    allowInsecureLocalhost = false
  }) {
    if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
      throw new Error('BACKUP_OBJECT_STORAGE_ENDPOINT, BUCKET, ACCESS_KEY and SECRET_KEY are required.');
    }
    if (typeof fetchImpl !== 'function') throw new Error('BACKUP_OBJECT_STORAGE_FETCH_UNAVAILABLE');
    this.endpoint = new URL(endpoint);
    if (this.endpoint.search || this.endpoint.hash) throw new Error('BACKUP_OBJECT_STORAGE_ENDPOINT_MUST_NOT_HAVE_QUERY_OR_HASH');
    const isLocalhost = ['127.0.0.1', 'localhost', '::1'].includes(this.endpoint.hostname);
    if (this.endpoint.protocol !== 'https:' && !(allowInsecureLocalhost && isLocalhost)) {
      throw new Error('BACKUP_OBJECT_STORAGE_ENDPOINT_MUST_USE_HTTPS');
    }
    this.bucket = safePart(bucket, 'bucket');
    this.accessKeyId = String(accessKeyId);
    this.secretAccessKey = String(secretAccessKey);
    this.region = String(region || 'us-east-1');
    this.prefix = String(prefix || 'neem-backups').split('/').filter(Boolean).map((part) => safePart(part, 'prefix')).join('/');
    if (!this.prefix) throw new Error('BACKUP_OBJECT_STORAGE_PREFIX_INVALID');
    const keyring = normalizeKeyring({ encryptionKey, encryptionKeyring, activeKeyId });
    this.keys = keyring.keys;
    this.activeKeyId = keyring.activeKeyId;
    this.fetchImpl = fetchImpl;
  }

  getKeyringStatus() {
    return { active_key_id: this.activeKeyId, key_ids: [...this.keys.keys()] };
  }

  assertKeyAvailable(keyId) {
    const selectedKeyId = keyId || this.activeKeyId;
    if (!this.keys.has(selectedKeyId)) throw new Error(`BACKUP_ARTIFACT_KEY_UNAVAILABLE: ${selectedKeyId}`);
    return selectedKeyId;
  }

  objectKey({ tenantId, manifestId, kind }) {
    const tenant = safePart(tenantId, 'tenant_id');
    const manifest = safePart(manifestId, 'manifest_id');
    const filename = kind === 'db' ? 'database.sql.enc' : (kind === 'files' ? 'storage_assets.tar.gz.enc' : null);
    if (!filename) throw new Error('BACKUP_ARTIFACT_KIND must be db or files.');
    return `${this.prefix}/${tenant}/${manifest}/${filename}`;
  }

  ref({ tenantId, manifestId, kind }) {
    return `s3://${this.bucket}/${this.objectKey({ tenantId, manifestId, kind })}`;
  }

  requestPath(key) {
    const base = this.endpoint.pathname.replace(/\/+$/, '');
    return `${base}/${awsPercentEncode(this.bucket)}/${key.split('/').map(awsPercentEncode).join('/')}` || '/';
  }

  async request(method, key, body = null, additionalHeaders = {}) {
    const payload = body ? (Buffer.isBuffer(body) ? body : Buffer.from(body)) : Buffer.alloc(0);
    const payloadHash = sha256Buffer(payload);
    const now = new Date();
    const amzDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
    const dateStamp = amzDate.slice(0, 8);
    const requestPath = this.requestPath(key);
    const headers = {
      host: this.endpoint.host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
      ...Object.fromEntries(Object.entries(additionalHeaders).map(([name, value]) => [String(name).toLowerCase(), String(value)]))
    };
    if (payload.length) headers['content-type'] = 'application/octet-stream';
    const signedHeaders = Object.keys(headers).sort().join(';');
    const canonicalHeaders = Object.keys(headers).sort().map((name) => `${name}:${String(headers[name]).trim()}\n`).join('');
    const canonicalRequest = [method, requestPath, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
    const scope = `${dateStamp}/${this.region}/s3/aws4_request`;
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      scope,
      sha256Buffer(canonicalRequest)
    ].join('\n');
    const dateKey = hmacSha256(`AWS4${this.secretAccessKey}`, dateStamp);
    const regionKey = hmacSha256(dateKey, this.region);
    const serviceKey = hmacSha256(regionKey, 's3');
    const signingKey = hmacSha256(serviceKey, 'aws4_request');
    const signature = hmacSha256(signingKey, stringToSign, 'hex');
    headers.authorization = `AWS4-HMAC-SHA256 Credential=${this.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

    const response = await this.fetchImpl(`${this.endpoint.protocol}//${this.endpoint.host}${requestPath}`, {
      method,
      headers,
      body: method === 'GET' || method === 'HEAD' ? undefined : payload
    });
    if (!response.ok) {
      const details = await response.text().catch(() => '');
      const error = new Error(`BACKUP_OBJECT_STORAGE_${method}_FAILED: HTTP ${response.status}${details ? ` ${details.slice(0, 240)}` : ''}`);
      error.status = response.status;
      throw error;
    }
    return response;
  }

  async put({ tenantId, manifestId, kind, content, keyId, allowReplace = false }) {
    const plaintext = Buffer.isBuffer(content) ? content : Buffer.from(String(content ?? ''), 'utf8');
    const selectedKeyId = this.assertKeyAvailable(keyId);
    if (!allowReplace && await this.exists({ tenantId, manifestId, kind })) {
      throw new Error('BACKUP_ARTIFACT_IMMUTABLE: an existing backup artifact cannot be overwritten.');
    }
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.keys.get(selectedKeyId), iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const envelope = Buffer.from(JSON.stringify({
      magic: MAGIC,
      algorithm: 'aes-256-gcm',
      key_id: selectedKeyId,
      iv: iv.toString('hex'),
      tag: cipher.getAuthTag().toString('hex'),
      ciphertext: ciphertext.toString('base64')
    }), 'utf8');
    try {
      // HEAD-before-PUT makes the common path readable, while this conditional
      // write closes the check-then-write race between concurrent creators.
      await this.request(
        'PUT',
        this.objectKey({ tenantId, manifestId, kind }),
        envelope,
        allowReplace ? {} : { 'if-none-match': '*' }
      );
    } catch (err) {
      if (!allowReplace && (err.status === 409 || err.status === 412)) {
        throw new Error('BACKUP_ARTIFACT_IMMUTABLE: an existing backup artifact cannot be overwritten.');
      }
      throw err;
    }
    return {
      artifact_ref: this.ref({ tenantId, manifestId, kind }),
      size_bytes: plaintext.length,
      checksum_sha256: sha256(plaintext),
      encryption_key_id: selectedKeyId
    };
  }

  async readEnvelope({ tenantId, manifestId, kind }) {
    const response = await this.request('GET', this.objectKey({ tenantId, manifestId, kind }));
    let envelope;
    try {
      envelope = JSON.parse(Buffer.from(await response.arrayBuffer()).toString('utf8'));
    } catch (err) {
      throw new Error(`BACKUP_ARTIFACT_ENVELOPE_READ_FAILED: ${err.message}`);
    }
    if (envelope.magic !== MAGIC || envelope.algorithm !== 'aes-256-gcm') throw new Error('BACKUP_ARTIFACT_INVALID_ENVELOPE');
    return envelope;
  }

  async read({ tenantId, manifestId, kind }) {
    const envelope = await this.readEnvelope({ tenantId, manifestId, kind });
    const selectedKeyId = envelope.key_id || this.activeKeyId;
    const key = this.keys.get(selectedKeyId);
    if (!key) throw new Error(`BACKUP_ARTIFACT_KEY_UNAVAILABLE: ${selectedKeyId}`);
    try {
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'hex'));
      decipher.setAuthTag(Buffer.from(envelope.tag, 'hex'));
      return Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, 'base64')), decipher.final()]);
    } catch (err) {
      throw new Error(`BACKUP_ARTIFACT_DECRYPT_FAILED: ${err.message}`);
    }
  }

  async checksum({ tenantId, manifestId, kind }) {
    return sha256(await this.read({ tenantId, manifestId, kind }));
  }

  async keyId({ tenantId, manifestId, kind }) {
    const envelope = await this.readEnvelope({ tenantId, manifestId, kind });
    return envelope.key_id || this.activeKeyId;
  }

  async rotate({ tenantId, manifestId, kind, newKeyId }) {
    const content = await this.read({ tenantId, manifestId, kind });
    return this.put({ tenantId, manifestId, kind, content, keyId: newKeyId, allowReplace: true });
  }

  async exists({ tenantId, manifestId, kind }) {
    try {
      await this.request('HEAD', this.objectKey({ tenantId, manifestId, kind }));
      return true;
    } catch {
      return false;
    }
  }
}

function createArtifactStoreFromEnvironment(env = process.env) {
  let encryptionKeyring = null;
  if (env.NEEM_BACKUP_KEYRING) {
    try {
      encryptionKeyring = JSON.parse(env.NEEM_BACKUP_KEYRING);
    } catch (err) {
      throw new Error(`BACKUP_ARTIFACT_KEYRING_INVALID_JSON: ${err.message}`);
    }
  }
  const keyMaterial = {
    encryptionKey: env.NEEM_BACKUP_ENCRYPTION_KEY,
    encryptionKeyring,
    activeKeyId: env.NEEM_BACKUP_ACTIVE_KEY_ID
  };
  if (env.NEEM_BACKUP_OBJECT_STORAGE_ENDPOINT) {
    if (!env.NEEM_BACKUP_OBJECT_STORAGE_BUCKET || !env.NEEM_BACKUP_OBJECT_STORAGE_ACCESS_KEY || !env.NEEM_BACKUP_OBJECT_STORAGE_SECRET_KEY) {
      throw new Error('BACKUP_OBJECT_STORAGE_CONFIGURATION_INCOMPLETE');
    }
    return new S3CompatibleBackupArtifactStore({
      endpoint: env.NEEM_BACKUP_OBJECT_STORAGE_ENDPOINT,
      bucket: env.NEEM_BACKUP_OBJECT_STORAGE_BUCKET,
      accessKeyId: env.NEEM_BACKUP_OBJECT_STORAGE_ACCESS_KEY,
      secretAccessKey: env.NEEM_BACKUP_OBJECT_STORAGE_SECRET_KEY,
      region: env.NEEM_BACKUP_OBJECT_STORAGE_REGION,
      prefix: env.NEEM_BACKUP_OBJECT_STORAGE_PREFIX,
      allowInsecureLocalhost: env.NEEM_BACKUP_OBJECT_STORAGE_ALLOW_INSECURE_LOCALHOST === 'true',
      ...keyMaterial
    });
  }
  if (!env.NEEM_BACKUP_ARTIFACT_DIR || (!env.NEEM_BACKUP_ENCRYPTION_KEY && !env.NEEM_BACKUP_KEYRING)) return null;
  return new BackupArtifactStore({
    rootDir: env.NEEM_BACKUP_ARTIFACT_DIR,
    ...keyMaterial
  });
}

module.exports = {
  BackupArtifactStore,
  S3CompatibleBackupArtifactStore,
  createArtifactStoreFromEnvironment
};
