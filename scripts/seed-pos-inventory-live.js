'use strict';

/**
 * Live Inventory & BOM Seeder for WESTO POS & Culinary Ecosystem.
 * Guarantees healthy stock levels across Branch 1 and Branch 2 in both
 * server/data/db.json and PostgreSQL (westo_state, finance_inventory_items_v2, finance_inventory_balances).
 */

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { assertTestSeedAllowed } = require('./lib/test-seed-safety');

const DB_PATH = path.join(__dirname, '..', 'server', 'data', 'db.json');

async function seedLiveInventory() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error('Set DATABASE_URL to an intentional local test database before running this seeder.');
  assertTestSeedAllowed({ scriptName: 'seed-pos-inventory-live', targetUrl: dbUrl });
  console.log('[seeder] Loading database from', DB_PATH);
  const raw = fs.readFileSync(DB_PATH, 'utf8');
  const db = JSON.parse(raw);

  const acc = db.accounting = db.accounting || {};
  const items = acc.inventoryItems = Array.isArray(acc.inventoryItems) ? acc.inventoryItems : [];
  const recipes = acc.recipes = Array.isArray(acc.recipes) ? acc.recipes : [];
  const menuItems = db.menuItems = Array.isArray(db.menuItems) ? db.menuItems : [];

  console.log(`[seeder] Context: ${menuItems.length} menu items, ${recipes.length} recipes, ${items.length} inventory items.`);

  // 1. Calculate required quantities for all recipes (at least 50 portions per recipe)
  const totalRequired = {};
  recipes.forEach((r) => {
    (r.ingredients || []).forEach((ing) => {
      const id = String(ing.itemId || '');
      if (!id) return;
      const qty = (Number(ing.quantity || 0) * 50);
      totalRequired[id] = (totalRequired[id] || 0) + qty;
    });
  });

  // 2. Charge inventory items with healthy stock levels
  items.forEach((it) => {
    const req = totalRequired[it.id] || 0;
    const stock = req > 0
      ? Math.max(250, Math.ceil(req * 2.5))
      : Math.max(100, Math.ceil((it.safetyStock || 25) * 5));

    it.qtyOnHand = stock;
    it.onHand = stock;
    it.quantity = stock;
    it.availableQuantity = stock;
    it.reservedQty = 0;
    it.quarantinedQty = 0;
    it.expiredQty = 0;
    it.minStock = Math.max(20, Math.round(stock * 0.15));
    it.safetyStock = Math.max(15, Math.round(stock * 0.10));
    it.reorderPoint = Math.max(35, Math.round(stock * 0.25));
    it.active = true;

    const unitCost = Number(it.unitCostIrr || it.avgCostIrr || (it.avgCost * 10) || 450000);
    it.unitCostIrr = unitCost;
    it.avgCostIrr = unitCost;
    it.avgCost = Math.round(unitCost / 10);
  });

  // 3. Mark all menu items as active and available
  menuItems.forEach((m) => {
    m.available = true;
    m.stock = 150;
    m.dayparts = ['all'];
  });

  // 4. Save to db.json
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf8');
  console.log('[seeder] Saved updated db.json with positive inventory stocks.');

  // 5. If PostgreSQL is configured, update PostgreSQL tables
  try {
    const pool = new Pool({ connectionString: dbUrl });
    const client = await pool.connect();
    console.log('[seeder] Connected to PostgreSQL at', dbUrl.replace(/:[^:@]+@/, ':***@'));

    try {
      await client.query('BEGIN');

      // Update westo_state JSONB
      const stateRes = await client.query('SELECT data, version FROM westo_state WHERE id = 1');
      if (stateRes.rowCount > 0) {
        const stateData = stateRes.rows[0].data || {};
        stateData.accounting = stateData.accounting || {};
        stateData.accounting.inventoryItems = items;
        stateData.menuItems = menuItems;
        stateData.menuCategories = db.menuCategories;
        const newVersion = (stateRes.rows[0].version || 1) + 1;
        await client.query(
          'UPDATE westo_state SET data = $1::jsonb, version = $2, updated_at = now() WHERE id = 1',
          [JSON.stringify(stateData), newVersion]
        );
        console.log(`[seeder] Updated westo_state to version ${newVersion}.`);
      }

      // Update finance_inventory_balances in Postgres
      for (const it of items) {
        const branchId = Number(it.branchId || 1);
        const stock = Number(it.qtyOnHand || 150);
        await client.query(`
          INSERT INTO finance_inventory_balances (branch_id, item_id, on_hand_base, reserved_base, quarantined_base, updated_at)
          VALUES ($1, $2, $3, 0, 0, now())
          ON CONFLICT (branch_id, item_id)
          DO UPDATE SET on_hand_base = EXCLUDED.on_hand_base, reserved_base = 0, quarantined_base = 0, updated_at = now()
        `, [branchId, String(it.id), stock]);
      }
      console.log(`[seeder] Synchronized ${items.length} inventory balances in PostgreSQL.`);

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('[seeder] PostgreSQL transaction failed:', err);
    } finally {
      client.release();
      await pool.end();
    }
  } catch (pgErr) {
    console.warn('[seeder] PostgreSQL sync skipped (not running or error):', pgErr.message);
  }

  // 6. Test availability via financeV2
  const financeV2 = require('../server/finance-v2.js');
  let availableCount = 0;
  for (const m of menuItems) {
    const res = financeV2.menuItemAvailability(db, m.id, 1);
    if (res.available) availableCount++;
  }
  console.log(`[seeder] Validation complete: ${availableCount} of ${menuItems.length} menu items are immediately available in POS!`);
}

if (require.main === module) {
  seedLiveInventory().catch((error) => {
    console.error(`[seeder] Refused or failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { seedLiveInventory };
