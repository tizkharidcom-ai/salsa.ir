'use strict';

function cleanId(value, fallback) {
  const id = String(value == null ? '' : value).trim().replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '');
  return id.slice(0, 80) || fallback;
}

const MAX_MODIFIER_GROUPS = 8;
const MAX_MODIFIER_OPTIONS_PER_GROUP = 16;
const MAX_MODIFIER_SELECTIONS = MAX_MODIFIER_GROUPS * MAX_MODIFIER_OPTIONS_PER_GROUP;

function parseModifierPrice(value) {
  if (value == null || value === '') return { ok: true, price: 0 };
  if (typeof value !== 'number' && typeof value !== 'string') return { ok: false, price: 0 };
  if (typeof value === 'string' && value.trim() === '') return { ok: true, price: 0 };
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > Number.MAX_SAFE_INTEGER) {
    return { ok: false, price: 0 };
  }
  const price = Math.round(parsed);
  if (!Number.isSafeInteger(price)) return { ok: false, price: 0 };
  return { ok: true, price };
}

function boundedInteger(value, fallback, min = 0, max = MAX_MODIFIER_OPTIONS_PER_GROUP) {
  if (value == null || value === '') return fallback;
  if (typeof value !== 'number' && typeof value !== 'string') return fallback;
  if (typeof value === 'string' && value.trim() === '') return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

function normalizeModifierGroups(value, fallback = []) {
  if (!Array.isArray(value)) return Array.isArray(fallback) ? normalizeModifierGroups(fallback, []) : [];
  const groups = [];
  const usedGroupIds = new Set();
  for (let groupIndex = 0; groupIndex < Math.min(value.length, MAX_MODIFIER_GROUPS); groupIndex += 1) {
    const raw = value[groupIndex] || {};
    const title = String(raw.title || raw.name || '').trim().slice(0, 100);
    if (!title) continue;
    let id = cleanId(raw.id, `group-${groupIndex + 1}`);
    while (usedGroupIds.has(id)) id = `${id}-${groupIndex + 1}`;
    usedGroupIds.add(id);
    const usedOptionIds = new Set();
    const options = [];
    for (let optionIndex = 0; optionIndex < Math.min(Array.isArray(raw.options) ? raw.options.length : 0, MAX_MODIFIER_OPTIONS_PER_GROUP); optionIndex += 1) {
      const option = raw.options[optionIndex] || {};
      const name = String(option.name || option.title || '').trim().slice(0, 100);
      if (!name) continue;
      let optionId = cleanId(option.id, `${id}-option-${optionIndex + 1}`);
      while (usedOptionIds.has(optionId)) optionId = `${optionId}-${optionIndex + 1}`;
      usedOptionIds.add(optionId);
      const parsedPrice = parseModifierPrice(option.price);
      options.push({
        id: optionId,
        name,
        // A malformed price must never turn into an orderable free option.
        price: parsedPrice.price,
        available: option.available !== false && parsedPrice.ok && (option.available == null || typeof option.available === 'boolean'),
      });
    }
    if (!options.length) continue;
    const selection = raw.selection == null || raw.selection === ''
      ? 'multiple'
      : (raw.selection === 'single' || raw.selection === 'multiple' ? raw.selection : 'single');
    const legacyRequired = raw.required === true;
    const minFallback = legacyRequired ? 1 : 0;
    const minSelections = boundedInteger(raw.minSelections, minFallback);
    const maxFallback = selection === 'single' ? 1 : MAX_MODIFIER_OPTIONS_PER_GROUP;
    const requestedMax = boundedInteger(raw.maxSelections, maxFallback, 1);
    const maxSelections = selection === 'single' ? Math.min(1, requestedMax) : requestedMax;
    groups.push({
      id,
      title,
      selection,
      required: minSelections > 0,
      minSelections,
      maxSelections,
      options,
    });
  }
  return groups;
}

function validateModifierGroupDefinitions(value) {
  const errors = [];
  if (!Array.isArray(value)) {
    return { ok: false, groups: [], errors: [{ code: 'modifier_groups_invalid', path: 'modifierGroups' }] };
  }
  if (value.length > MAX_MODIFIER_GROUPS) {
    errors.push({ code: 'too_many_modifier_groups', path: 'modifierGroups', limit: MAX_MODIFIER_GROUPS });
  }

  const groupIds = new Set();
  for (let groupIndex = 0; groupIndex < value.length; groupIndex += 1) {
    const raw = value[groupIndex];
    const groupPath = `modifierGroups[${groupIndex}]`;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      errors.push({ code: 'modifier_group_invalid', path: groupPath });
      continue;
    }
    const id = cleanId(raw.id, '');
    const title = String(raw.title || raw.name || '').trim();
    if (!id) errors.push({ code: 'modifier_group_id_required', path: `${groupPath}.id` });
    else if (groupIds.has(id)) errors.push({ code: 'duplicate_modifier_group_id', path: `${groupPath}.id`, id });
    else groupIds.add(id);
    if (!title) errors.push({ code: 'modifier_group_title_required', path: `${groupPath}.title` });
    if (raw.selection != null && raw.selection !== '' && !['single', 'multiple'].includes(raw.selection)) {
      errors.push({ code: 'modifier_selection_mode_invalid', path: `${groupPath}.selection` });
    }
    if (raw.required != null && typeof raw.required !== 'boolean') {
      errors.push({ code: 'modifier_required_invalid', path: `${groupPath}.required` });
    }
    if (!Array.isArray(raw.options)) {
      errors.push({ code: 'modifier_options_invalid', path: `${groupPath}.options` });
      continue;
    }
    if (!raw.options.length) errors.push({ code: 'modifier_options_empty', path: `${groupPath}.options` });
    if (raw.options.length > MAX_MODIFIER_OPTIONS_PER_GROUP) {
      errors.push({ code: 'too_many_modifier_options', path: `${groupPath}.options`, limit: MAX_MODIFIER_OPTIONS_PER_GROUP });
    }

    const optionIds = new Set();
    let availableOptions = 0;
    for (let optionIndex = 0; optionIndex < raw.options.length; optionIndex += 1) {
      const option = raw.options[optionIndex];
      const optionPath = `${groupPath}.options[${optionIndex}]`;
      if (!option || typeof option !== 'object' || Array.isArray(option)) {
        errors.push({ code: 'modifier_option_invalid', path: optionPath });
        continue;
      }
      const optionId = cleanId(option.id, '');
      const name = String(option.name || option.title || '').trim();
      if (!optionId) errors.push({ code: 'modifier_option_id_required', path: `${optionPath}.id` });
      else if (optionIds.has(optionId)) errors.push({ code: 'duplicate_modifier_option_id', path: `${optionPath}.id`, id: optionId });
      else optionIds.add(optionId);
      if (!name) errors.push({ code: 'modifier_option_name_required', path: `${optionPath}.name` });
      const price = parseModifierPrice(option.price);
      if (!price.ok) errors.push({ code: 'modifier_option_price_invalid', path: `${optionPath}.price` });
      if (option.available != null && typeof option.available !== 'boolean') {
        errors.push({ code: 'modifier_option_availability_invalid', path: `${optionPath}.available` });
      }
      if (option.available !== false && price.ok && name && optionId) availableOptions += 1;
    }

    const selection = raw.selection === 'single' ? 'single' : 'multiple';
    const requiredMinimum = raw.required === true ? 1 : 0;
    const minSelections = boundedInteger(raw.minSelections, requiredMinimum);
    const maxFallback = selection === 'single' ? 1 : MAX_MODIFIER_OPTIONS_PER_GROUP;
    const maxSelections = boundedInteger(raw.maxSelections, maxFallback, 1);
    const minWasSupplied = raw.minSelections != null && raw.minSelections !== '';
    const maxWasSupplied = raw.maxSelections != null && raw.maxSelections !== '';
    if (minWasSupplied && ((typeof raw.minSelections !== 'number' && typeof raw.minSelections !== 'string') || minSelections !== Number(raw.minSelections))) {
      errors.push({ code: 'modifier_min_selections_invalid', path: `${groupPath}.minSelections` });
    }
    if (maxWasSupplied && ((typeof raw.maxSelections !== 'number' && typeof raw.maxSelections !== 'string') || maxSelections !== Number(raw.maxSelections))) {
      errors.push({ code: 'modifier_max_selections_invalid', path: `${groupPath}.maxSelections` });
    }
    if (selection === 'single' && maxSelections > 1) {
      errors.push({ code: 'single_modifier_group_max_invalid', path: `${groupPath}.maxSelections` });
    }
    if (minSelections > maxSelections) {
      errors.push({ code: 'modifier_cardinality_invalid', path: groupPath });
    }
    if (raw.required === false && raw.minSelections != null && minSelections > 0) {
      errors.push({ code: 'modifier_required_min_conflict', path: groupPath });
    }
    if (raw.required === true && raw.minSelections != null && minSelections === 0) {
      errors.push({ code: 'modifier_required_min_conflict', path: groupPath });
    }
    if (minSelections > availableOptions) {
      errors.push({ code: 'modifier_required_options_unavailable', path: groupPath });
    }
  }

  const groups = normalizeModifierGroups(value, []);
  return { ok: errors.length === 0, groups, errors };
}

/**
 * Route integration contract:
 * 1. On menu create/update, first form the candidate definition (submitted
 *    groups, or the contextual defaults where create semantics require them).
 *    Call validateModifierGroupDefinitions(candidateGroups) BEFORE
 *    normalization. Reject invalid definitions (HTTP 400), then persist only
 *    the returned canonical `groups`.
 * 2. For every submitted order line, resolve the current server-side effective
 *    groups and call validateModifierSelection(groups, line.modifiers). Accept
 *    only `{ groupId, id }` identities; reject every returned error rather than
 *    truncating or silently dropping invalid selections. Ignore client names,
 *    prices, and totals; persist only the returned canonical `modifiers`.
 * 3. Call calculateModifierLinePrice(menuItem.price, validatedQty, groups,
 *    line.modifiers) and use its canonical `modifiers`, `unitPrice`, and
 *    `lineTotal`. Add separately validated complements afterward; never
 *    recalculate modifier value from request fields.
 *
 * This module does not connect routes itself. Until all writers and order
 * creation/update routes follow these steps, the strict contract is not an
 * end-to-end enforcement boundary.
 */
function validateModifierSelection(groups, requestedModifiers) {
  const definitions = validateModifierGroupDefinitions(groups);
  if (!definitions.ok) {
    return { ok: false, errors: [{ code: 'modifier_configuration_invalid', details: definitions.errors }] };
  }
  if (requestedModifiers == null) requestedModifiers = [];
  if (!Array.isArray(requestedModifiers)) {
    return { ok: false, errors: [{ code: 'modifier_selection_invalid', path: 'modifiers' }] };
  }
  if (requestedModifiers.length > MAX_MODIFIER_SELECTIONS) {
    return { ok: false, errors: [{ code: 'too_many_modifier_selections', path: 'modifiers', limit: MAX_MODIFIER_SELECTIONS }] };
  }

  const errors = [];
  const byGroup = new Map(definitions.groups.map((entry) => [entry.id, entry]));
  const selectedByGroup = new Map();
  const seen = new Set();
  const modifiers = [];

  for (let index = 0; index < requestedModifiers.length; index += 1) {
    const requested = requestedModifiers[index];
    const path = `modifiers[${index}]`;
    if (!requested || typeof requested !== 'object' || Array.isArray(requested)) {
      errors.push({ code: 'modifier_selection_invalid', path });
      continue;
    }
    const groupId = String(requested.groupId == null ? '' : requested.groupId).trim();
    const optionId = String(requested.id == null ? '' : requested.id).trim();
    if (!groupId || !optionId) {
      errors.push({ code: 'modifier_selection_identity_required', path });
      continue;
    }
    const groupEntry = byGroup.get(groupId);
    if (!groupEntry) {
      errors.push({ code: 'modifier_group_unknown', path, groupId });
      continue;
    }
    const option = groupEntry.options.find((entry) => entry.id === optionId);
    if (!option) {
      errors.push({ code: 'modifier_option_unknown', path, groupId, optionId });
      continue;
    }
    if (option.available === false) {
      errors.push({ code: 'modifier_option_unavailable', path, groupId, optionId });
      continue;
    }
    const identity = `${groupId}\u0000${optionId}`;
    if (seen.has(identity)) {
      errors.push({ code: 'duplicate_modifier_selection', path, groupId, optionId });
      continue;
    }
    seen.add(identity);
    if (!selectedByGroup.has(groupId)) selectedByGroup.set(groupId, []);
    selectedByGroup.get(groupId).push(option);
    modifiers.push({
      id: option.id,
      groupId: groupEntry.id,
      groupTitle: groupEntry.title,
      name: option.name,
      price: option.price,
    });
  }

  for (const groupEntry of definitions.groups) {
    const selectedCount = (selectedByGroup.get(groupEntry.id) || []).length;
    if (selectedCount < groupEntry.minSelections) {
      errors.push({
        code: 'modifier_selection_below_minimum',
        groupId: groupEntry.id,
        minimum: groupEntry.minSelections,
        selected: selectedCount,
      });
    }
    if (selectedCount > groupEntry.maxSelections) {
      errors.push({
        code: 'modifier_selection_above_maximum',
        groupId: groupEntry.id,
        maximum: groupEntry.maxSelections,
        selected: selectedCount,
      });
    }
  }

  if (errors.length) return { ok: false, errors };
  const modifierTotal = modifiers.reduce((sum, modifier) => sum + modifier.price, 0);
  if (!Number.isSafeInteger(modifierTotal)) {
    return { ok: false, errors: [{ code: 'modifier_total_unsafe', path: 'modifiers' }] };
  }
  return { ok: true, modifiers, modifierTotal, errors: [] };
}

function calculateModifierLinePrice(basePrice, quantity, groups, requestedModifiers) {
  const parsedBasePrice = parseModifierPrice(basePrice);
  const parsedQuantity = Number(quantity);
  if (!parsedBasePrice.ok) return { ok: false, error: 'base_price_invalid' };
  if (!Number.isSafeInteger(parsedQuantity) || parsedQuantity < 1 || parsedQuantity > 99) {
    return { ok: false, error: 'quantity_invalid' };
  }
  const selection = validateModifierSelection(groups, requestedModifiers);
  if (!selection.ok) return { ok: false, errors: selection.errors };
  const unitPrice = parsedBasePrice.price + selection.modifierTotal;
  const lineTotal = unitPrice * parsedQuantity;
  if (!Number.isSafeInteger(unitPrice) || !Number.isSafeInteger(lineTotal)) {
    return { ok: false, error: 'modifier_line_total_unsafe' };
  }
  return {
    ok: true,
    basePrice: parsedBasePrice.price,
    modifiers: selection.modifiers,
    modifierTotal: selection.modifierTotal,
    unitPrice,
    quantity: parsedQuantity,
    lineTotal,
  };
}

function effectiveModifierGroupsForItem(item = {}) {
  if (!Array.isArray(item.modifierGroups)) return [];
  const validation = validateModifierGroupDefinitions(item.modifierGroups);
  if (validation.ok) return validation.groups;

  // Keep malformed persisted definitions visibly non-orderable. Returning a
  // repaired/truncated version here would let the guest build a cart that the
  // order endpoint must later reject against the original definition.
  return [{
    id: '__invalid_configuration__',
    title: '',
    selection: 'single',
    required: true,
    minSelections: 1,
    maxSelections: 1,
    options: [],
  }];
}

module.exports = {
  MAX_MODIFIER_GROUPS,
  MAX_MODIFIER_OPTIONS_PER_GROUP,
  MAX_MODIFIER_SELECTIONS,
  normalizeModifierGroups,
  effectiveModifierGroupsForItem,
  validateModifierGroupDefinitions,
  validateModifierSelection,
  calculateModifierLinePrice,
};
