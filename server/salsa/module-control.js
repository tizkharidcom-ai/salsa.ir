'use strict';

const { CANONICAL_FEATURES } = require('./canonical-features');
const { getModule, getModuleForFeature } = require('./module-manifest');

const FEATURE_BY_KEY = new Map(CANONICAL_FEATURES.map(feature => [
  feature.key,
  Object.freeze({ ...feature, dependencies: Object.freeze([...(feature.dependencies || [])]) })
]));
const reverseDependencies = new Map();
for (const feature of FEATURE_BY_KEY.values()) {
  for (const dependency of feature.dependencies || []) {
    if (!reverseDependencies.has(dependency)) reverseDependencies.set(dependency, new Set());
    reverseDependencies.get(dependency).add(feature.key);
  }
}

function dependencyClosure(featureKeys) {
  const requestedKeys = validateFeatureKeys(featureKeys, 'DEPENDENCY_FEATURE_KEYS');
  const visited = new Set();
  const ordered = [];
  function visit(key) {
    if (visited.has(key)) return;
    const feature = FEATURE_BY_KEY.get(key);
    if (!feature) throw new Error(`UNKNOWN_FEATURE: ${key}`);
    visited.add(key);
    for (const dependency of feature.dependencies || []) visit(dependency);
    ordered.push(key);
  }
  requestedKeys.forEach(visit);
  return ordered;
}

function dependentClosure(featureKeys, activeKeys) {
  const roots = validateFeatureKeys(featureKeys, 'DEPENDENCY_FEATURE_KEYS');
  if (!(activeKeys instanceof Set)) {
    throw new Error('INVALID_ACTIVE_FEATURE_KEYS: expected a Set of canonical feature keys');
  }
  const active = new Set(validateFeatureKeys([...activeKeys], 'ACTIVE_FEATURE_KEYS'));
  const disabled = new Set(roots);
  const queue = [...roots];
  while (queue.length) {
    const key = queue.shift();
    for (const dependent of reverseDependencies.get(key) || []) {
      if (active.has(dependent) && !disabled.has(dependent)) {
        disabled.add(dependent);
        queue.push(dependent);
      }
    }
  }
  return [...disabled].reverse();
}

function validateFeatureKeys(keys, label) {
  if (!Array.isArray(keys)) {
    throw new Error(`INVALID_${label}: expected an array of canonical feature keys`);
  }
  const validated = [];
  const seen = new Set();
  for (const key of keys) {
    if (typeof key !== 'string' || !FEATURE_BY_KEY.has(key)) {
      const error = typeof key === 'string'
        ? `UNKNOWN_FEATURE: ${key}`
        : `INVALID_${label}: feature keys must be strings`;
      throw new Error(error);
    }
    if (!seen.has(key)) {
      seen.add(key);
      validated.push(key);
    }
  }
  return validated;
}

const PLAN_PROVENANCE = Object.freeze({
  type: 'module_change_plan',
  applied: false,
  tenantEntitlement: 'not_applied',
  pricing: 'not_evaluated'
});

function makePlan(module, enabled, featureKeys, implicitFeatureKeys) {
  return {
    module,
    enabled,
    featureKeys,
    implicitFeatureKeys,
    affectedModules: [...new Set(featureKeys.map(key => getModuleForFeature(key)?.key).filter(Boolean))],
    provenance: PLAN_PROVENANCE
  };
}

function planModuleChange(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('INVALID_MODULE_CHANGE: expected an options object');
  }
  const {
    moduleKey,
    enabled,
    activeFeatureKeys = [],
    cascade = false
  } = input;

  if (typeof moduleKey !== 'string' || !moduleKey) throw new Error('UNKNOWN_MODULE: invalid module key');
  if (typeof enabled !== 'boolean') throw new Error('INVALID_MODULE_STATE: enabled must be a boolean');
  if (typeof cascade !== 'boolean') throw new Error('INVALID_CASCADE: cascade must be a boolean');

  const module = getModule(moduleKey);
  if (!module) throw new Error(`UNKNOWN_MODULE: ${moduleKey}`);
  if (!module.controllable) throw new Error(`MODULE_NOT_CONTROLLABLE: ${moduleKey}`);

  const active = new Set(validateFeatureKeys(activeFeatureKeys, 'ACTIVE_FEATURE_KEYS'));

  if (enabled && !['addon'].includes(module.commercialState)) {
    const reason = module.commercialState === 'quote_only' ? 'QUOTE_REQUIRED' : 'PLAN_CONTROLLED';
    throw new Error(`MODULE_COMMERCIAL_STATE_BLOCKED: ${moduleKey}:${reason}`);
  }
  if (enabled && ['planned', 'retired'].includes(module.lifecycle)) {
    throw new Error(`MODULE_LIFECYCLE_BLOCKED: ${moduleKey}:${module.lifecycle}`);
  }

  if (enabled) {
    const featureKeys = dependencyClosure(module.technicalFeatures);
    return makePlan(
      module,
      true,
      featureKeys,
      featureKeys.filter(key => !module.technicalFeatures.includes(key))
    );
  }

  const allAffected = dependentClosure(module.technicalFeatures, active);
  const externalDependents = allAffected.filter(key => !module.technicalFeatures.includes(key));
  if (externalDependents.length && !cascade) {
    throw new Error(`ACTIVE_DEPENDENTS: ${externalDependents.join(',')}`);
  }
  const featureKeys = cascade ? allAffected : [...module.technicalFeatures].reverse();
  return makePlan(module, false, featureKeys, externalDependents);
}

module.exports = { dependencyClosure, dependentClosure, planModuleChange };
