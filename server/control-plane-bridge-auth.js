'use strict';

const crypto = require('node:crypto');

function configuredControlSecret(env = process.env) {
  const secret = String(env.SALSA_CONTROL_SECRET || env.NEEM_CONTROL_SECRET || '').trim();
  return secret.length >= 32 ? secret : null;
}

function hasControlPlaneBridgeCredential(req, env = process.env) {
  const expected = configuredControlSecret(env);
  if (!expected || !req?.headers) return false;
  const authorization = String(req.headers.authorization || '');
  const bearer = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
  const candidates = [
    req.headers['x-salsa-control-secret'],
    req.headers['x-neem-control-secret'],
    bearer,
  ];
  return candidates.some((value) => {
    if (typeof value !== 'string') return false;
    const candidate = Buffer.from(value.trim());
    const expectedBytes = Buffer.from(expected);
    return candidate.length === expectedBytes.length && crypto.timingSafeEqual(candidate, expectedBytes);
  });
}

function isTrustedLocalControlPlaneOrigin(req, env = process.env) {
  if (String(env.NODE_ENV || '').toLowerCase() === 'production') return false;
  let origin;
  try {
    origin = new URL(String(req?.headers?.origin || ''));
  } catch {
    return false;
  }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname.toLowerCase());
  return origin.protocol === 'http:' && loopback && ['3050', '3061'].includes(origin.port);
}

module.exports = {
  configuredControlSecret,
  hasControlPlaneBridgeCredential,
  isTrustedLocalControlPlaneOrigin,
};
