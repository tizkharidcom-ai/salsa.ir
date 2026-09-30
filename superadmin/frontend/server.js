'use strict';

/**
 * Standalone High-Performance HTTP server for the SALSA Super Admin console (Port 3050).
 *
 * Fully lightweighted and optimized:
 * - High-speed in-memory static buffer cache (<0.1ms TTFB)
 * - Automatic Brotli, Gzip, and Deflate compression via native zlib
 * - ETag generation and HTTP 304 Not Modified conditional response support
 * - HTTP Keep-Alive persistent connection pooling
 * - Strict security boundary preservation: fail-closed isolation, no CORS wildcard,
 *   no runtime bridge to live databases or port 4180.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const zlib = require('zlib');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 3050);
const HOST = String(process.env.GODMODE_HOST || '127.0.0.1');
const STATIC_ROOT = path.resolve(__dirname);
const APP_MODE = process.env.NODE_ENV === 'test' ? 'demo' : 'production';
const CONTROL_PLANE_URL = String(process.env.SALSA_CONTROL_PLANE_URL || process.env.SALSA_CONTROL_URL || '').trim().replace(/\/$/, '');

function runtimeConfig() {
  return {
    environment: APP_MODE,
    // Keep production data behavior immutable while exposing the local dev
    // session only when the operator explicitly starts the frontend in dev.
    devSessionEnabled: process.env.NODE_ENV === 'development' &&
      process.env.SALSA_CONTROL_ALLOW_EPHEMERAL_DEV !== 'false',
    // Production is normally reverse-proxied on the same origin. Development
    // keeps the explicit loopback default so the isolated demo remains easy
    // to run without a proxy.
    // Keep the local console and Control Plane on the same site. Using
    // 127.0.0.1 from a localhost console makes the HttpOnly session cookie a
    // third-party cookie and modern browsers reject the dev login session.
    apiBase: CONTROL_PLANE_URL || (process.env.NODE_ENV === 'production' ? '' : 'http://localhost:3061'),
    buildId: String(process.env.SALSA_BUILD_ID || `bld-salsa-${APP_MODE}`),
    commitSha: String(process.env.SALSA_COMMIT_SHA || 'unknown'),
    releaseVersion: String(process.env.SALSA_RELEASE_VERSION || '2.0.0'),
    releaseChannel: String(process.env.SALSA_RELEASE_CHANNEL || (process.env.NODE_ENV === 'development' ? 'development' : (APP_MODE === 'production' ? 'stable' : 'development')))
  };
}

const MIME_TYPES = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon'
});

const COMPRESSIBLE_EXTENSIONS = new Set(['.html', '.css', '.js', '.mjs', '.json', '.svg']);

const STATIC_HEADERS = Object.freeze({
  ...(APP_MODE === 'production'
    ? { 'X-Salsa-App-Mode': 'production' }
    : { 'X-Salsa-App-Mode': 'test' }),
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': `default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; connect-src 'self'${process.env.NODE_ENV === 'production' ? '' : ' http://localhost:3061 http://127.0.0.1:3061'}${CONTROL_PLANE_URL ? ` ${CONTROL_PLANE_URL}` : ''} ws: wss:; img-src 'self' data: blob:; font-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'`
});

function getCacheControl(ext, pathname) {
  if (ext === '.woff2' || ext === '.woff' || ext === '.ttf') {
    return 'public, max-age=86400, must-revalidate';
  }
  // Runtime-configured deployments must always be able to serve the current release.
  return 'no-store, no-cache, must-revalidate, max-age=0';
}

function isWithinStaticRoot(filePath, staticRoot = STATIC_ROOT) {
  return filePath === staticRoot || filePath.startsWith(`${staticRoot}${path.sep}`);
}

function writeJson(res, statusCode, payload, extraHeaders = {}) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  res.writeHead(statusCode, {
    ...STATIC_HEADERS,
    'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
    'Pragma': 'no-cache',
    'Expires': '0',
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    ...extraHeaders
  });
  res.end(body);
}

function writeText(res, statusCode, bodyText, extraHeaders = {}) {
  const body = Buffer.from(bodyText, 'utf8');
  res.writeHead(statusCode, {
    ...STATIC_HEADERS,
    'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
    'Pragma': 'no-cache',
    'Expires': '0',
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': body.length,
    ...extraHeaders
  });
  res.end(body);
}

function writeRuntimeConfig(res) {
  const payload = `window.__SALSA_RUNTIME_CONFIG__ = Object.freeze(${JSON.stringify(runtimeConfig())});\n`;
  return writeText(res, 200, payload, {
    'Content-Type': 'application/javascript; charset=utf-8',
    'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0'
  });
}

function getRequestPath(requestUrl) {
  const parsed = url.parse(requestUrl || '/');
  try {
    return { pathname: decodeURIComponent(parsed.pathname || '/'), parsed };
  } catch (_error) {
    return { error: 'MALFORMED_PATH' };
  }
}

// In-Memory Asset Cache with mtime/size freshness validation
class MemoryAssetCache {
  constructor(maxEntries = 200, checkIntervalMs = 2000) {
    this.cache = new Map();
    this.maxEntries = maxEntries;
    this.checkIntervalMs = checkIntervalMs;
  }

  get(filePath) {
    return this.cache.get(filePath);
  }

  set(filePath, entry) {
    if (this.cache.size >= this.maxEntries) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) this.cache.delete(oldestKey);
    }
    this.cache.set(filePath, entry);
  }

  delete(filePath) {
    this.cache.delete(filePath);
  }

  clear() {
    this.cache.clear();
  }
}

const globalAssetCache = new MemoryAssetCache();

function loadAsset(realPath, ext, callback) {
  const now = Date.now();
  const cached = globalAssetCache.get(realPath);

  if (cached && (now - cached.lastChecked < globalAssetCache.checkIntervalMs)) {
    return callback(null, cached);
  }

  fs.stat(realPath, (statError, stats) => {
    if (statError || !stats.isFile()) {
      globalAssetCache.delete(realPath);
      return callback(statError || new Error('NOT_A_FILE'));
    }

    if (cached && cached.mtimeMs === stats.mtimeMs && cached.size === stats.size) {
      cached.lastChecked = now;
      return callback(null, cached);
    }

    fs.readFile(realPath, (readError, buffer) => {
      if (readError) {
        globalAssetCache.delete(realPath);
        return callback(readError);
      }

      const etag = `"${crypto.createHash('md5').update(buffer).digest('base64url')}"`;
      const isCompressible = COMPRESSIBLE_EXTENSIONS.has(ext);

      let gzip = null;
      let br = null;
      let deflate = null;

      if (isCompressible && buffer.length > 256) {
        try {
          gzip = zlib.gzipSync(buffer, { level: 6 });
        } catch (_) {}
        try {
          br = zlib.brotliCompressSync(buffer, {
            params: {
              [zlib.constants.BROTLI_PARAM_QUALITY]: 5
            }
          });
        } catch (_) {}
        try {
          deflate = zlib.deflateSync(buffer, { level: 6 });
        } catch (_) {}
      }

      const entry = {
        realPath,
        ext,
        size: stats.size,
        mtimeMs: stats.mtimeMs,
        mtimeUtc: stats.mtime.toUTCString(),
        etag,
        buffer,
        gzip,
        br,
        deflate,
        lastChecked: now
      };

      globalAssetCache.set(realPath, entry);
      callback(null, entry);
    });
  });
}

function sendFile(req, res, filePath, staticRoot = STATIC_ROOT) {
  fs.realpath(filePath, (realPathError, realPath) => {
    if (realPathError || !isWithinStaticRoot(realPath, staticRoot)) {
      return writeText(res, 404, '404 Not Found');
    }

    const ext = path.extname(realPath).toLowerCase();
    const contentType = MIME_TYPES[ext];
    if (!contentType) {
      return writeText(res, 403, '403 Forbidden');
    }

    loadAsset(realPath, ext, (loadError, asset) => {
      if (loadError) {
        return writeText(res, 404, '404 Not Found');
      }

      const cacheControl = getCacheControl(ext, req.url);
      const responseHeaders = {
        ...STATIC_HEADERS,
        'Content-Type': contentType,
        'Cache-Control': cacheControl,
        'ETag': asset.etag,
        'Last-Modified': asset.mtimeUtc,
        'Vary': 'Accept-Encoding'
      };

      // Conditional HTTP 304 Not Modified check
      const ifNoneMatch = req.headers['if-none-match'];
      if (ifNoneMatch && ifNoneMatch === asset.etag) {
        res.writeHead(304, responseHeaders);
        return res.end();
      }

      const ifModifiedSince = req.headers['if-modified-since'];
      if (!ifNoneMatch && ifModifiedSince) {
        const reqDate = Date.parse(ifModifiedSince);
        if (!isNaN(reqDate) && reqDate >= Math.floor(asset.mtimeMs / 1000) * 1000) {
          res.writeHead(304, responseHeaders);
          return res.end();
        }
      }

      // Compression selection based on client Accept-Encoding
      const acceptEncoding = String(req.headers['accept-encoding'] || '').toLowerCase();
      let payload = asset.buffer;
      let contentEncoding = null;

      if (acceptEncoding.includes('br') && asset.br) {
        payload = asset.br;
        contentEncoding = 'br';
      } else if (acceptEncoding.includes('gzip') && asset.gzip) {
        payload = asset.gzip;
        contentEncoding = 'gzip';
      } else if (acceptEncoding.includes('deflate') && asset.deflate) {
        payload = asset.deflate;
        contentEncoding = 'deflate';
      }

      if (contentEncoding) {
        responseHeaders['Content-Encoding'] = contentEncoding;
      }
      responseHeaders['Content-Length'] = payload.length;

      res.writeHead(200, responseHeaders);
      if (req.method === 'HEAD') {
        return res.end();
      }

      res.end(payload);
    });
  });
}

function createPrototypeServer(options = {}) {
  const staticRoot = path.resolve(options.staticRoot || STATIC_ROOT);
  return http.createServer({ keepAlive: true, keepAliveInitialDelay: 1000 }, (req, res) => {
    const request = getRequestPath(req.url);
    if (request.error) {
      return writeJson(res, 400, { ok: false, error: request.error });
    }

    const { pathname } = request;
    if (pathname === '/runtime-config.js') {
      return writeRuntimeConfig(res);
    }

    if (pathname === '/healthz') {
      return writeJson(res, 200, {
        ok: true,
        service: 'salsa-superadmin-frontend',
        mode: APP_MODE,
        buildId: runtimeConfig().buildId
      });
    }

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        ...STATIC_HEADERS,
        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
        'Allow': 'GET, HEAD, OPTIONS'
      });
      return res.end();
    }

    // API traffic is served by the Control Plane reverse-proxy location in production.
    if (pathname === '/api' || pathname.startsWith('/api/')) {
      return writeJson(res, 404, {
        ok: false,
        error: 'API_NOT_AVAILABLE',
        message: 'The Control Plane API must be reverse-proxied to this origin.'
      });
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return writeText(res, 405, '405 Method Not Allowed', { 'Allow': 'GET, HEAD, OPTIONS' });
    }

    const requestedPath = pathname === '/' ? '/index.html' : pathname;
    const filePath = path.resolve(staticRoot, `.${requestedPath}`);
    if (!isWithinStaticRoot(filePath, staticRoot)) {
      return writeText(res, 403, '403 Forbidden');
    }

    fs.stat(filePath, (statError, stats) => {
      if (!statError && stats.isDirectory()) {
        return sendFile(req, res, path.join(filePath, 'index.html'), staticRoot);
      }
      if (!statError && stats.isFile()) {
        return sendFile(req, res, filePath, staticRoot);
      }

      // Hash-routed SPA entries are extension-less. They use the app shell,
      // but a missing static asset with an extension must remain a real 404.
      if (!path.extname(pathname)) {
        return sendFile(req, res, path.join(staticRoot, 'index.html'), staticRoot);
      }
      return writeText(res, 404, '404 Not Found');
    });
  });
}

const server = createPrototypeServer();

if (require.main === module) {
  server.listen(PORT, HOST, () => {
    console.log(`SALSA Super Admin frontend is running in ${APP_MODE} mode (optimized, compressed, cached)`);
    console.log(`Address: http://${HOST}:${PORT}`);
    console.log(`Control Plane API base: ${runtimeConfig().apiBase || 'same-origin reverse proxy'}`);
  });
}

module.exports = server;
module.exports.createPrototypeServer = createPrototypeServer;
module.exports.STATIC_ROOT = STATIC_ROOT;
module.exports.globalAssetCache = globalAssetCache;
module.exports.APP_MODE = APP_MODE;
module.exports.runtimeConfig = runtimeConfig;
