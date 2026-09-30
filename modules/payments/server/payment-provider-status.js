'use strict';

function paymentProviderPublicStatus(config = {}, { nodeEnv, providerReady = false } = {}) {
  const configuredMode = String(config?.mode || 'sandbox').trim().toLowerCase();
  const configuredProvider = String(config?.provider || (configuredMode === 'sandbox' ? 'sandbox' : '')).trim().toLowerCase();
  if (configuredMode === 'disabled') return { mode: 'disabled', provider: null, enabled: false };
  // Persisted configuration is untrusted input: strings such as "false" and
  // numeric values must never opt a payment provider into service.
  const enabled = config?.enabled === true;
  const isProduction = String(nodeEnv || '').trim().toLowerCase() === 'production';

  if (configuredMode === 'sandbox') {
    if (isProduction || configuredProvider !== 'sandbox') {
      return { mode: 'unavailable', provider: null, enabled: false };
    }
    return { mode: 'sandbox', provider: 'sandbox', enabled };
  }

  // A sandbox identity must never be presented as a live provider. For a
  // real provider, readiness is an explicit adapter/verifier assertion from
  // the caller; provider names in settings alone are not evidence of it.
  if (!isProduction || configuredMode !== 'live' || !configuredProvider
    || configuredProvider === 'sandbox' || providerReady !== true) {
    return { mode: 'unavailable', provider: null, enabled: false };
  }

  return {
    mode: configuredMode,
    provider: configuredProvider,
    enabled,
  };
}

module.exports = { paymentProviderPublicStatus };
