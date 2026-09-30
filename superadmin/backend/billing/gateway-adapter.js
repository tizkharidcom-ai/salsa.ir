// server/salsa/control-plane/billing/gateway-adapter.js
'use strict';

const crypto = require('crypto');
const config = require('../config');

function verifyGatewayCallbackSignature({ rawBody, timestamp, signature, secret, now = Date.now(), maxClockSkewMs = 5 * 60 * 1000 } = {}) {
  const body = String(rawBody || '');
  const rawTimestamp = String(timestamp || '');
  const normalizedSignature = String(signature || '').replace(/^sha256=/i, '').toLowerCase();
  if (!body || !/^\d{10,16}$/.test(rawTimestamp) || !secret || !/^[0-9a-f]{64}$/i.test(normalizedSignature)) {
    return { ok: false, reason: 'callback_signature_required' };
  }
  const timestampMs = Number(rawTimestamp) < 1e12 ? Number(rawTimestamp) * 1000 : Number(rawTimestamp);
  if (!Number.isSafeInteger(Number(rawTimestamp)) || !Number.isFinite(timestampMs) || Math.abs(Number(now) - timestampMs) > maxClockSkewMs) {
    return { ok: false, reason: 'callback_signature_expired' };
  }
  const expected = crypto.createHmac('sha256', secret)
    .update(`${rawTimestamp}.${body}`)
    .digest('hex');
  const left = Buffer.from(normalizedSignature, 'hex');
  const right = Buffer.from(expected, 'hex');
  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) {
    return { ok: false, reason: 'callback_signature_invalid' };
  }
  return { ok: true };
}

/**
 * Base Iranian Payment Gateway Adapter Contract
 * Standardizes payment initiation, callback verification, and refund interfaces.
 */
class BaseIranGatewayAdapter {
  constructor(providerCode) {
    this.providerCode = providerCode;
  }

  async requestPayment({ invoiceId, amountRials, callbackUrl, description }) {
    throw new Error('METHOD_NOT_IMPLEMENTED: requestPayment must be implemented by gateway adapter.');
  }

  async verifyPayment({ authority, amountRials, traceNumber }) {
    throw new Error('METHOD_NOT_IMPLEMENTED: verifyPayment must be implemented by gateway adapter.');
  }

  async refundPayment({ transactionId, amountRials, reason }) {
    throw new Error('METHOD_NOT_IMPLEMENTED: refundPayment must be implemented by gateway adapter.');
  }
}

/**
 * Configured HTTP provider adapter.
 *
 * Provider-specific Iranian gateways expose different field names, so the
 * control plane uses a small normalized JSON contract at this boundary:
 * request -> { authority, paymentUrl }, verify -> { traceNumber, amountRials },
 * refund -> { refundReference }. A provider gateway/adapter can translate its
 * native protocol into this contract without letting the billing service fake a
 * successful payment.
 */
class HttpIranGatewayAdapter extends BaseIranGatewayAdapter {
  constructor(providerCode, {
    baseUrl,
    requestPath = '/request',
    verifyPath = '/verify',
    refundPath = '/refund',
    credentialField = null,
    credentialValue = null,
    headers = {},
    timeoutMs = 15000
  } = {}) {
    super(providerCode);
    if (!baseUrl) {
      throw new Error(`FAIL-CLOSED: ${providerCode} gateway endpoint is required.`);
    }
    let parsed;
    try {
      parsed = new URL(baseUrl);
    } catch {
      throw new Error(`FAIL-CLOSED: ${providerCode} gateway endpoint is invalid.`);
    }
    if (!['https:', 'http:'].includes(parsed.protocol)) {
      throw new Error(`FAIL-CLOSED: ${providerCode} gateway endpoint must use HTTP(S).`);
    }
    if (config.isProduction && parsed.protocol !== 'https:') {
      throw new Error(`FAIL-CLOSED: ${providerCode} gateway endpoint must use HTTPS in production.`);
    }
    if (!Number.isInteger(Number(timeoutMs)) || Number(timeoutMs) <= 0 || Number(timeoutMs) > 120000) {
      throw new Error(`FAIL-CLOSED: ${providerCode} gateway timeout must be between 1 and 120000 ms.`);
    }
    this.baseUrl = parsed.toString().replace(/\/$/, '');
    this.requestPath = requestPath;
    this.verifyPath = verifyPath;
    this.refundPath = refundPath;
    this.credentialField = credentialField;
    this.credentialValue = credentialValue;
    this.headers = { ...headers };
    this.timeoutMs = Number(timeoutMs);
  }

  _withCredential(payload) {
    if (!this.credentialField || !this.credentialValue) return payload;
    return { ...payload, [this.credentialField]: this.credentialValue };
  }

  async _post(pathname, payload) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(new URL(pathname, `${this.baseUrl}/`), {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...this.headers },
        body: JSON.stringify(this._withCredential(payload)),
        signal: controller.signal
      });
      const raw = await response.text();
      let body = null;
      try {
        body = raw ? JSON.parse(raw) : null;
      } catch {
        body = null;
      }
      if (!response.ok) {
        throw new Error(`GATEWAY_HTTP_ERROR: ${this.providerCode} returned HTTP ${response.status}.`);
      }
      if (!body || body.success === false || body.ok === false || body.data?.success === false) {
        throw new Error(`GATEWAY_PROVIDER_REJECTED: ${this.providerCode} rejected the request.`);
      }
      const result = body.data && typeof body.data === 'object' ? body.data : body;
      return result;
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new Error(`GATEWAY_TIMEOUT: ${this.providerCode} did not respond within ${this.timeoutMs} ms.`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  async requestPayment({ invoiceId, amountRials, callbackUrl, description }) {
    if (!invoiceId || !Number.isSafeInteger(Number(amountRials)) || Number(amountRials) <= 0 || !callbackUrl) {
      throw new Error('GATEWAY_ERROR: invoiceId, positive integer amountRials, and callbackUrl are required.');
    }
    const result = await this._post(this.requestPath, {
      invoiceId,
      amountRials: Number(amountRials),
      callbackUrl,
      description: String(description || '')
    });
    const authority = result.authority || result.token || result.refId || result.ref_id;
    const paymentUrl = result.paymentUrl || result.payment_url || result.url;
    if (!authority || !paymentUrl) {
      throw new Error(`GATEWAY_RESPONSE_INVALID: ${this.providerCode} did not return an authority and payment URL.`);
    }
    return { success: true, provider: this.providerCode, authority: String(authority), paymentUrl: String(paymentUrl) };
  }

  async verifyPayment({ authority, amountRials, traceNumber = null }) {
    if (!authority || !Number.isSafeInteger(Number(amountRials)) || Number(amountRials) <= 0) {
      throw new Error('GATEWAY_ERROR: authority and positive integer amountRials are required.');
    }
    const result = await this._post(this.verifyPath, {
      authority: String(authority),
      amountRials: Number(amountRials),
      traceNumber: traceNumber || undefined
    });
    const verifiedAmount = Number(result.amountRials ?? result.amount ?? amountRials);
    const returnedTrace = result.traceNumber || result.trace_number || result.refId || result.ref_id;
    if (verifiedAmount !== Number(amountRials)) {
      throw new Error('GATEWAY_AMOUNT_MISMATCH: Verified amount does not match requested invoice amount.');
    }
    if (!returnedTrace) {
      throw new Error(`GATEWAY_RESPONSE_INVALID: ${this.providerCode} did not return a settlement trace.`);
    }
    return {
      success: true,
      provider: this.providerCode,
      authority: String(authority),
      traceNumber: String(returnedTrace),
      amountRials: verifiedAmount,
      verifiedAt: new Date().toISOString()
    };
  }

  async refundPayment({ transactionId, amountRials, reason }) {
    if (!transactionId || !Number.isSafeInteger(Number(amountRials)) || Number(amountRials) <= 0) {
      throw new Error('REFUND_ERROR: transactionId and positive integer amountRials are required.');
    }
    const result = await this._post(this.refundPath, {
      transactionId: String(transactionId),
      amountRials: Number(amountRials),
      reason: String(reason || '')
    });
    const refundReference = result.refundReference || result.refund_reference || result.reference || result.refId;
    if (!refundReference) {
      throw new Error(`GATEWAY_RESPONSE_INVALID: ${this.providerCode} did not return a refund reference.`);
    }
    return {
      success: true,
      provider: this.providerCode,
      refundReference: String(refundReference),
      refundedAmountRials: Number(amountRials),
      refundedAt: new Date().toISOString()
    };
  }
}

/**
 * Zarinpal Iranian Payment Gateway Adapter
 */
class ZarinpalAdapter extends BaseIranGatewayAdapter {
  constructor(merchantId = null) {
    super('zarinpal');
    this.merchantId = merchantId;
  }

  async requestPayment({ invoiceId, amountRials, callbackUrl, description }) {
    throw new Error('FAIL-CLOSED: ZarinpalAdapter legacy class cannot synthesize a payment authority; use getGatewayAdapter with a configured HTTP endpoint.');
  }

  async verifyPayment({ authority, amountRials }) {
    throw new Error('LIVE_VALIDATION_PENDING: Live banking settlement requires configured Iranian merchant token.');
  }
}

/**
 * Saman SEP Iranian Payment Gateway Adapter
 */
class SamanSepAdapter extends BaseIranGatewayAdapter {
  constructor(terminalId = null) {
    super('saman_sep');
    this.terminalId = terminalId;
  }

  async requestPayment({ invoiceId, amountRials, callbackUrl, description }) {
    throw new Error('FAIL-CLOSED: SamanSepAdapter legacy class cannot synthesize a payment authority; use getGatewayAdapter with a configured HTTP endpoint.');
  }

  async verifyPayment({ authority, amountRials }) {
    throw new Error('LIVE_VALIDATION_PENDING: Live banking settlement requires configured Iranian merchant token.');
  }
}

/**
 * Sadad Iranian Payment Gateway Adapter
 */
class SadadAdapter extends BaseIranGatewayAdapter {
  constructor(terminalId = null) {
    super('sadad');
    this.terminalId = terminalId;
  }

  async requestPayment({ invoiceId, amountRials, callbackUrl, description }) {
    throw new Error('FAIL-CLOSED: SadadAdapter legacy class cannot synthesize a payment authority; use getGatewayAdapter with a configured HTTP endpoint.');
  }

  async verifyPayment({ authority, amountRials }) {
    throw new Error('LIVE_VALIDATION_PENDING: Live banking settlement requires configured Iranian merchant token.');
  }
}

/**
 * Mellat Behpardakht Iranian Payment Gateway Adapter
 */
class MellatBehpardakhtAdapter extends BaseIranGatewayAdapter {
  constructor(terminalId = null) {
    super('mellat_behpardakht');
    this.terminalId = terminalId;
  }

  async requestPayment({ invoiceId, amountRials, callbackUrl, description }) {
    throw new Error('FAIL-CLOSED: MellatBehpardakhtAdapter legacy class cannot synthesize a payment authority; use getGatewayAdapter with a configured HTTP endpoint.');
  }

  async verifyPayment({ authority, amountRials }) {
    throw new Error('LIVE_VALIDATION_PENDING: Live banking settlement requires configured Iranian merchant token.');
  }
}

/**
 * Mock Iranian Payment Gateway (Strictly for Test Mode & Local Harness)
 * Generates local sandbox test URLs only.
 */
class MockIranGatewayAdapter extends BaseIranGatewayAdapter {
  constructor(providerCode = 'mock_saman') {
    super(providerCode);
    this.isTestMock = true;
    this.pendingAuthorities = new Map();
  }

  async requestPayment({ invoiceId, amountRials, callbackUrl, description }) {
    if (!invoiceId || !amountRials || amountRials <= 0) {
      throw new Error('GATEWAY_ERROR: Invalid invoiceId or amount.');
    }

    const authority = 'AUTH_TEST_' + crypto.randomUUID().replace(/-/g, '').slice(0, 20);
    // Clearly marked test URL
    const controlPort = String(process.env.NEEM_CONTROL_PORT || '3061');
    const paymentUrl = `http://127.0.0.1:${controlPort}/test/mock-gateway?authority=${authority}&mode=test_sandbox`;

    this.pendingAuthorities.set(authority, {
      invoiceId,
      amountRials,
      callbackUrl,
      description,
      status: 'pending',
      createdAt: new Date().toISOString()
    });

    return {
      success: true,
      provider: this.providerCode,
      isTestMock: true,
      authority,
      paymentUrl
    };
  }

  async verifyPayment({ authority, amountRials, traceNumber = null }) {
    if (!authority || !this.pendingAuthorities.has(authority)) {
      return {
        success: false,
        error: 'GATEWAY_VERIFICATION_FAILED: Authority not found or invalid.'
      };
    }

    const item = this.pendingAuthorities.get(authority);
    if (item.amountRials !== amountRials) {
      return {
        success: false,
        error: 'GATEWAY_AMOUNT_MISMATCH: Verified amount does not match requested invoice amount.'
      };
    }

    const generatedTrace = traceNumber || 'TRC_TEST_' + Math.floor(10000000 + Math.random() * 90000000);
    item.status = 'verified';
    item.traceNumber = generatedTrace;

    return {
      success: true,
      provider: this.providerCode,
      isTestMock: true,
      authority,
      traceNumber: generatedTrace,
      amountRials,
      verifiedAt: new Date().toISOString()
    };
  }

  async refundPayment({ transactionId, amountRials, reason = 'Test customer refund' }) {
    if (!transactionId) {
      throw new Error('REFUND_ERROR: transactionId is required.');
    }
    const refundRef = 'REF_TEST_' + crypto.randomUUID().slice(0, 12);
    return {
      success: true,
      isTestMock: true,
      refundReference: refundRef,
      refundedAmountRials: amountRials,
      reason,
      refundedAt: new Date().toISOString()
    };
  }

  reset() {
    this.pendingAuthorities.clear();
  }
}

/**
 * Payment Gateway Factory
 * Fail-closed: production requires verified provider configuration;
 * mock is only permitted in test mode or with explicit local test harness.
 */
function getGatewayAdapter(providerCode = 'saman_sep', options = {}) {
  if (options.forceMock || config.isTest) {
    return new MockIranGatewayAdapter(providerCode);
  }

  if (config.isProduction) {
    const providerConfig = {
      zarinpal: {
        prefix: 'NEEM_GATEWAY_ZARINPAL',
        credentialField: 'merchantId',
        credential: options.merchantId || process.env.NEEM_GATEWAY_ZARINPAL_MERCHANT
      },
      saman_sep: {
        prefix: 'NEEM_GATEWAY_SAMAN',
        credentialField: 'terminalId',
        credential: options.terminalId || process.env.NEEM_GATEWAY_SAMAN_TERMINAL
      },
      sadad: {
        prefix: 'NEEM_GATEWAY_SADAD',
        credentialField: 'terminalId',
        credential: options.terminalId || process.env.NEEM_GATEWAY_SADAD_TERMINAL
      },
      mellat_behpardakht: {
        prefix: 'NEEM_GATEWAY_MELLAT',
        credentialField: 'terminalId',
        credential: options.terminalId || process.env.NEEM_GATEWAY_MELLAT_TERMINAL
      }
    }[providerCode];
    if (!providerConfig) {
      throw new Error(`FAIL-CLOSED: Unsupported or unconfigured payment gateway '${providerCode}' in production.`);
    }
    if (!providerConfig.credential) {
      throw new Error(`FAIL-CLOSED: ${providerCode} credential configuration missing in production.`);
    }
    const endpointPrefix = providerConfig.prefix;
    const baseUrl = options.baseUrl || process.env[`${endpointPrefix}_BASE_URL`];
    if (!baseUrl) {
      throw new Error(`FAIL-CLOSED: ${providerCode} gateway endpoint configuration missing in production.`);
    }
    return new HttpIranGatewayAdapter(providerCode, {
      baseUrl,
      credentialField: providerConfig.credentialField,
      credentialValue: providerConfig.credential,
      requestPath: options.requestPath || process.env[`${endpointPrefix}_REQUEST_PATH`] || '/request',
      verifyPath: options.verifyPath || process.env[`${endpointPrefix}_VERIFY_PATH`] || '/verify',
      refundPath: options.refundPath || process.env[`${endpointPrefix}_REFUND_PATH`] || '/refund',
      timeoutMs: options.timeoutMs || process.env.NEEM_GATEWAY_TIMEOUT_MS || 15000,
      headers: options.headers || {}
    });
  }

  // Non-production (development)
  if (config.allowEphemeralDev) {
    return new MockIranGatewayAdapter(providerCode);
  }

  throw new Error('FAIL-CLOSED: Gateway adapter required in development unless explicit NEEM_CONTROL_ALLOW_EPHEMERAL_DEV=true is enabled.');
}

// Only available in test mode for testing harness
const defaultTestGateway = config.isTest ? new MockIranGatewayAdapter('saman_sep') : null;

module.exports = {
  BaseIranGatewayAdapter,
  HttpIranGatewayAdapter,
  verifyGatewayCallbackSignature,
  MockIranGatewayAdapter,
  ZarinpalAdapter,
  SamanSepAdapter,
  SadadAdapter,
  MellatBehpardakhtAdapter,
  getGatewayAdapter,
  defaultGateway: defaultTestGateway
};
