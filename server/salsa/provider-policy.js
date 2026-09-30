'use strict';

/*
 * Runtime provider boundary for the Iranian-only deployment plan.
 *
 * The default is deny. A foreign provider can only be used when an operator
 * explicitly opts in for a local development exception; production planning
 * treats that opt-in as a failed check.
 */
function foreignRuntimeAllowed(env = process.env) {
  return env.NODE_ENV !== 'production'
    && String(env.NEEM_ALLOW_FOREIGN_RUNTIME || '').trim().toLowerCase() === 'true';
}

function translationEngine(env = process.env) {
  return env.OPENAI_API_KEY && foreignRuntimeAllowed(env) ? 'openai' : 'glossary';
}

function runtimeProviderPolicy(env = process.env) {
  return {
    foreignRuntimeAllowed: foreignRuntimeAllowed(env),
    translation: translationEngine(env),
    localOnly: !foreignRuntimeAllowed(env),
  };
}

module.exports = { foreignRuntimeAllowed, translationEngine, runtimeProviderPolicy };
