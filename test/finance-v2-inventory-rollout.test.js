'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const financeV2 = require('../server/finance-v2');

function fixture() {
  return {
    accounting: {
      recipes: [{ id: 'recipe-42', menuItemId: 42, status: 'approved', ingredients: [] }],
    },
    financeV2: {
      rollout: { captureEnabled: true, enabledBranchIds: [1], cutoverBranchIds: [] },
    },
  };
}

test('inventory source follows the Finance V2 branch rollout instead of recipe existence alone', () => {
  const db = fixture();
  assert.equal(financeV2.menuItemUsesInventoryV2(db, 42, 1), true);
  assert.equal(financeV2.menuItemUsesInventoryV2(db, 42, 2), false);

  const outsideRollout = financeV2.menuItemAvailability(db, 42, 2, 1);
  assert.equal(outsideRollout.tracked, false);
  assert.equal(outsideRollout.reason, 'finance_v2_feature_flag_disabled');

  const insideRollout = financeV2.menuItemAvailability(db, 42, 1, 1);
  assert.equal(insideRollout.tracked, true);
  assert.equal(insideRollout.available, false, 'an enabled branch still validates its recipe and ingredient stock');
});

test('globally disabled Finance V2 does not suppress legacy menu-stock consumption', () => {
  const db = fixture();
  db.financeV2.rollout.captureEnabled = false;
  assert.equal(financeV2.menuItemUsesInventoryV2(db, 42, 1), false);
  assert.equal(financeV2.menuItemAvailability(db, 42, 1).tracked, false);
});
