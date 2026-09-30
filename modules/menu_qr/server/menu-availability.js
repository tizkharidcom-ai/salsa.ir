'use strict';

function positiveId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function menuAvailabilityOverride(db, menuItemId, branchId) {
  const itemId = positiveId(menuItemId);
  const scopedBranchId = positiveId(branchId);
  if (!itemId || !scopedBranchId) return { ok: false, override: null, error: 'menu_availability_scope_invalid' };

  const matches = (Array.isArray(db?.menuAvailabilityOverrides) ? db.menuAvailabilityOverrides : [])
    .filter((entry) => Number(entry?.menuItemId) === itemId && Number(entry?.branchId) === scopedBranchId);
  if (matches.length > 1) return { ok: false, override: null, error: 'menu_availability_override_duplicate' };
  if (!matches.length) return { ok: true, override: null };
  if (typeof matches[0]?.available !== 'boolean') {
    return { ok: false, override: null, error: 'menu_availability_override_invalid' };
  }
  return { ok: true, override: matches[0] };
}

function menuItemAvailableForBranch(db, item, branchId) {
  if (!item || typeof item !== 'object' || Array.isArray(item) || item.available === false) return false;
  const scopedBranchId = positiveId(branchId);
  // Sellability is a branch-level decision. Without a resolved branch we
  // cannot apply branch overrides or inventory policy, so never advertise
  // the catalogue default as an orderable item.
  if (!scopedBranchId) return false;
  const result = menuAvailabilityOverride(db, item.id, scopedBranchId);
  if (!result.ok) return false;
  return result.override ? result.override.available : true;
}

function setMenuAvailabilityOverride(db, { menuItemId, branchId, available, updatedAt = new Date().toISOString() } = {}) {
  const itemId = positiveId(menuItemId);
  const scopedBranchId = positiveId(branchId);
  if (!itemId || !scopedBranchId) return { ok: false, error: 'menu_availability_scope_invalid' };
  if (typeof available !== 'boolean') return { ok: false, error: 'availability_invalid' };

  const list = Array.isArray(db.menuAvailabilityOverrides) ? db.menuAvailabilityOverrides : [];
  const current = menuAvailabilityOverride({ menuAvailabilityOverrides: list }, itemId, scopedBranchId);
  if (!current.ok) return current;
  const record = { menuItemId: itemId, branchId: scopedBranchId, available, updatedAt };
  if (current.override) {
    const index = list.indexOf(current.override);
    list[index] = record;
  } else {
    list.push(record);
  }
  db.menuAvailabilityOverrides = list;
  return { ok: true, override: record };
}

module.exports = {
  menuAvailabilityOverride,
  menuItemAvailableForBranch,
  setMenuAvailabilityOverride,
};
