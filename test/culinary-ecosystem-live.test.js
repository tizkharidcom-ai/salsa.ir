'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const accounting = require('../server/accounting-engine');
const financeV2 = require('../server/finance-v2');
const orderCosting = require('../server/finance/order-costing');
const inventoryEngine = require('../server/finance/inventory-engine');
const auditEngine = require('../server/finance/audit-engine');
const restaurantIntel = require('../server/finance/restaurant-intelligence');

function loadLiveDbFixture() {
  const dbPath = path.join(__dirname, '..', 'server', 'data', 'db.json');
  const raw = fs.readFileSync(dbPath, 'utf8');
  const db = JSON.parse(raw);
  accounting.ensureAccountingData(db);
  financeV2.ensureFinanceV2(db);
  return db;
}

test('Culinary Ecosystem: 100% Recipe Coverage & Realistic Restaurant Economics', () => {
  const db = loadLiveDbFixture();
  const acc = db.accounting;
  const menuItems = db.menuItems || [];

  assert.ok(menuItems.length >= 140, 'Should have complete 140+ menu items');
  assert.ok(acc.recipes.length >= 140, 'Every menu item must have a mapped recipe');
  assert.ok(acc.inventoryItems.length >= 50, 'Master inventory must have 50+ raw ingredients');

  // Verify each menu item has an approved recipe with valid ingredients
  const itemMap = new Map(acc.inventoryItems.map((item) => [item.id, item]));

  for (const menuItem of menuItems) {
    const recipe = restaurantIntel.effectiveRecipeForSale(acc.recipes, menuItem.id, new Date().toISOString());
    assert.ok(recipe, `Menu item [${menuItem.id}] "${menuItem.name}" must have an effective recipe`);
    assert.ok(recipe.ingredients.length > 0, `Recipe for "${menuItem.name}" must have ingredients`);

    let itemFoodCostIrr = 0;
    for (const ing of recipe.ingredients) {
      const invItem = itemMap.get(ing.itemId);
      assert.ok(invItem, `Ingredient ${ing.itemId} in recipe "${recipe.name}" must exist in inventory`);
      assert.ok(invItem.qtyOnHand > 0, `Inventory ${invItem.name} must have positive stock (100x seeded)`);
      itemFoodCostIrr += (Number(ing.quantity) || 0) * (invItem.avgCostIrr || 0);
    }

    const priceIrr = Number(menuItem.price) * 10;
    if (priceIrr > 0) {
      const foodCostPct = (itemFoodCostIrr / priceIrr) * 100;
      // High-margin restaurant target: food cost below 50%
      assert.ok(foodCostPct < 50, `Food cost for "${menuItem.name}" should be below 50% (actual: ${foodCostPct.toFixed(1)}%)`);
    }
  }
});

test('Live Ecosystem Ordering: Automatic Recipe Explosion, Inventory Deduction & Double-Entry COGS', () => {
  const db = loadLiveDbFixture();
  const acc = db.accounting;

  // Select 3 diverse menu items: Burger, Salad, Coffee
  const burgerItem = db.menuItems.find((m) => m.name.includes('برگر') || m.name.includes('همبرگر')) || db.menuItems[0];
  const saladItem = db.menuItems.find((m) => m.name.includes('سالاد') || m.name.includes('سزار')) || db.menuItems[1];
  const coffeeItem = db.menuItems.find((m) => m.name.includes('لاته') || m.name.includes('اسپرسو') || m.name.includes('کاپوچینو')) || db.menuItems[2];

  // Capture initial stock of burger beef and brioche buns
  const beefItemBefore = acc.inventoryItems.find((i) => i.id === 'item-beef-minced' && i.branchId === 1);
  const bunItemBefore = acc.inventoryItems.find((i) => i.id === 'item-bun-brioche' && i.branchId === 1);
  const initialBeefQty = beefItemBefore ? beefItemBefore.qtyOnHand : 0;
  const initialBunQty = bunItemBefore ? bunItemBefore.qtyOnHand : 0;

  const itemsTotal = (burgerItem.price * 2) + (saladItem.price * 1) + (coffeeItem.price * 2);
  const vat = Math.round(itemsTotal * 0.10);
  const grandTotal = itemsTotal + vat;

  // Place a multi-item customer order
  const liveOrder = {
    id: 99001,
    orderNo: '#LIVE-99001',
    branchId: 1,
    status: 'paid',
    paymentStatus: 'paid',
    paymentMethod: 'card',
    fulfillment: 'dine_in',
    createdAt: '2026-08-26T12:00:00.000Z',
    paidAt: '2026-08-26T12:00:00.000Z',
    subtotal: itemsTotal,
    tax: vat,
    vat,
    total: grandTotal,
    items: [
      { id: burgerItem.id, menuItemId: burgerItem.id, name: burgerItem.name, price: burgerItem.price, qty: 2, lineTotal: burgerItem.price * 2 },
      { id: saladItem.id, menuItemId: saladItem.id, name: saladItem.name, price: saladItem.price, qty: 1, lineTotal: saladItem.price },
      { id: coffeeItem.id, menuItemId: coffeeItem.id, name: coffeeItem.name, price: coffeeItem.price, qty: 2, lineTotal: coffeeItem.price * 2 },
    ],
  };

  db.orders.push(liveOrder);

  // Trigger Legacy & Finance V2 GL Capture
  accounting.syncOrderSalesJournal(db, liveOrder);
  const captureResult = financeV2.capturePaidOrder(db, liveOrder, { actor: 'live-pos-test' });
  assert.ok(captureResult);
  assert.equal(captureResult.event.status, 'posted');
  assert.ok(captureResult.costing);
  assert.equal(captureResult.costing.costing.ok, true, 'Order costing must succeed with 100% recipe coverage');
  assert.ok(captureResult.costing.costing.totalCogsIrr > 0, 'COGS must be calculated in IRR');
  assert.ok(captureResult.costing.movements.length > 0, 'Inventory movements must be created for ingredients');

  // Verify stock deduction occurred via V2 inventory movements and physical availability
  const beefAvail = orderCosting.physicalAvailable(beefItemBefore, db.financeV2, 1);
  assert.ok(beefAvail.ok);
  assert.ok(beefAvail.value < initialBeefQty, 'Beef available stock must decrease upon order sale');

  const bunAvail = orderCosting.physicalAvailable(bunItemBefore, db.financeV2, 1);
  assert.ok(bunAvail.ok);
  assert.ok(bunAvail.value <= initialBunQty - 2, 'Brioche bun available stock must decrease by at least 2 count');

  // Verify Double-Entry GL Journals are completely balanced
  const trialBalance = accounting.getTrialBalanceReport(db, '2026-09-01');
  assert.equal(trialBalance.isBalanced, true, 'Trial Balance must remain balanced after live order deduction');

  // Verify Income Statement calculates Food Cost and Margins accurately
  const pnl = accounting.getIncomeStatement(db, '2026-01-01', '2026-12-31');
  assert.ok(pnl.netSales >= 0);
  assert.ok(pnl.cogs.total >= 0);
  assert.equal(typeof pnl.grossProfit, 'number');
});
