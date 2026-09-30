'use strict';

function menuItemBelongsToBranch(item, branchId) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
  if (item.branchId == null || item.branchId === '') return true;
  const itemBranchId = Number(item.branchId);
  const requestedBranchId = Number(branchId);
  return Number.isSafeInteger(itemBranchId) && itemBranchId > 0
    && Number.isSafeInteger(requestedBranchId) && requestedBranchId > 0
    && itemBranchId === requestedBranchId;
}

module.exports = { menuItemBelongsToBranch };
