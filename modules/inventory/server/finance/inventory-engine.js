'use strict';

/**
 * WESTO Finance — Inventory, Recipe Costing, Waste & Menu Engineering Engine
 * Compliant with Perpetual Inventory Accounting and Restaurant Cost Control Standards.
 * Implements:
 * 1. Moving Weighted Average Costing (MWA) for stock items
 * 2. Recipe / BOM Costing with Theoretical vs Actual COGS Variance Analysis
 * 3. Kitchen Waste Accounting with balanced Double-Entry GL posting (5130 / 1610)
 * 4. BCG Menu Engineering Matrix (Stars, Plowhorses, Puzzles, Dogs)
 * 5. Periodic Stocktake & Inventory Count Reconciliation
 */

const { toIRR, addMoney, subMoney, formatNumber } = require('../../../platform_core/server/finance/money.js');
const auditEngine = require('../../../platform_core/server/finance/audit-engine.js');
const {
  canonicalUnit,
  convertQuantity,
  effectiveRecipeForSale,
  ingredientRequirement,
  recipeCatalog,
} = require('./restaurant-intelligence.js');

function normalizedBranchId(branchId) {
  const value = Number(branchId);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function optionalBranchId(branchId) {
  if (branchId == null || branchId === '') return null;
  const value = normalizedBranchId(branchId);
  if (value === null) throw new Error('شعبهٔ معتبر برای محدودسازی گزارش یا عملیات انبار الزامی است.');
  return value;
}

function sameBranch(row, branchId) {
  const scope = normalizedBranchId(branchId);
  return scope !== null && row?.branchId != null && Number(row.branchId) === scope;
}

function findInventoryItem(acc, itemId, branchId) {
  const key = String(itemId ?? '').trim();
  const scope = normalizedBranchId(branchId);
  if (!key || scope === null) return null;
  const items = acc.inventoryItems || [];
  const scoped = items.filter((item) => sameBranch(item, scope));
  return scoped.find((item) => String(item.id) === key)
    || scoped.find((item) => String(item.sku || '').trim() === key)
    || null;
}

function findInventoryItemAnyBranch(acc, itemId) {
  const key = String(itemId ?? '').trim();
  return (acc.inventoryItems || []).find((item) => String(item.id) === key || String(item.sku || '').trim() === key) || null;
}

function positiveQuantity(value, label) {
  const quantity = Number(value);
  if (!Number.isFinite(quantity) || quantity <= 0) throw new Error(`${label} باید عددی بزرگتر از صفر باشد.`);
  return quantity;
}

function nonNegativeNumber(value, label) {
  const quantity = Number(value);
  if (!Number.isFinite(quantity) || quantity < 0) throw new Error(`${label} معتبر نیست.`);
  return quantity;
}

function exceedsAvailable(requested, available) {
  // Allow only the rounding noise inherent in IEEE-754 arithmetic, not a
  // fixed stock-sized epsilon that can silently authorize a real overdraw.
  const tolerance = Math.min(
    1e-9,
    Number.EPSILON * Math.max(1, Math.abs(requested), Math.abs(available)) * 4,
  );
  return requested - available > tolerance;
}

function availableInventoryQuantity(item) {
  const onHand = nonNegativeNumber(item?.qtyOnHand ?? item?.onHand ?? item?.quantity, 'موجودی فعلی');
  const controls = [
    ['reservedQty', 'qtyReserved'],
    ['quarantinedQty', 'qtyQuarantined'],
    ['expiredQty', 'qtyExpired'],
  ];
  const unavailable = controls.reduce((sum, [primary, fallback]) => {
    const raw = item?.[primary] ?? item?.[fallback] ?? 0;
    return sum + nonNegativeNumber(raw === '' ? 0 : raw, 'موجودی غیرقابل مصرف');
  }, 0);
  return Math.max(0, onHand - unavailable);
}

function setInventoryOnHand(item, value) {
  if (item?.qtyOnHand !== undefined) item.qtyOnHand = value;
  else if (item?.onHand !== undefined) item.onHand = value;
  else item.quantity = value;
}

function inventoryUnitCost(item, ingredient = {}) {
  const value = item?.avgCostIrr ?? item?.avgCost ?? item?.unitCostIrr ?? item?.unitCost
    ?? ingredient.unitCostIrr ?? ingredient.unitCost;
  const cost = Number(value);
  if (!Number.isFinite(cost) || cost < 0 || !Number.isSafeInteger(Math.round(cost))) return null;
  return Math.round(cost);
}

function resolveRecipeItem(acc, itemRef, branchId) {
  const key = String(itemRef ?? '').trim();
  if (!key) return null;
  const candidates = (acc.inventoryItems || []).filter((item) => {
    if (branchId != null && !sameBranch(item, branchId)) return false;
    return String(item.id) === key || String(item.sku || '').trim() === key;
  });
  if (candidates.length > 1) throw new Error(`مادهٔ اولیهٔ «${key}» در محدودهٔ انتخاب‌شده مبهم است؛ شعبهٔ رسپی را مشخص کنید.`);
  return candidates[0] || null;
}

function recipeIngredientCost(acc, recipe, ingredient, branchId) {
  const item = resolveRecipeItem(acc, ingredient.itemId, branchId);
  if (!item) return { ok: false, code: 'recipe_inventory_item_missing', item: null };
  const normalizedIngredient = {
    ...ingredient,
    quantityBasis: ingredient.quantityBasis ?? ingredient.quantity_basis ?? 'raw',
  };
  const required = ingredientRequirement(normalizedIngredient, recipe, item);
  if (!required.ok) return { ok: false, code: required.code, item };
  const unitCost = inventoryUnitCost(item, ingredient);
  if (unitCost == null) return { ok: false, code: 'recipe_inventory_cost_invalid', item };
  const lineCost = Math.round(required.value * unitCost);
  if (!Number.isSafeInteger(lineCost)) return { ok: false, code: 'recipe_cost_unsafe', item };
  return {
    ok: true,
    item,
    quantityBase: required.value,
    unitCost,
    lineCost,
    baseUnit: canonicalUnit(item.unit) || item.unit || null,
  };
}

function ensureInventory(acc) {
  if (!Array.isArray(acc.inventoryItems)) acc.inventoryItems = [];
  const allowDemoSeed = String(process.env.NODE_ENV || '').trim().toLowerCase() !== 'production'
    && process.env.WESTO_ACCOUNTING_DEMO_SEED === 'true';
  if (allowDemoSeed && acc.inventoryItems.length === 0) {
    acc.inventoryItems = [
      { id: 'inv-1', sku: 'ING-MEAT-01', name: 'راسته گوساله بیات‌شده', category: 'پروتئین', unit: 'کیلوگرم', qtyOnHand: 35, avgCost: 720000, minStock: 10, branchId: 1 },
      { id: 'inv-2', sku: 'ING-CHICK-01', name: 'فیله مرغ پاک‌شده زعفرانی', category: 'پروتئین', unit: 'کیلوگرم', qtyOnHand: 55, avgCost: 380000, minStock: 15, branchId: 1 },
      { id: 'inv-3', sku: 'ING-COFFEE-01', name: 'دان قهوه کلمبیا ۱۰۰٪ عربیکا اسپشیالتی', category: 'بار گرم', unit: 'کیلوگرم', qtyOnHand: 28, avgCost: 950000, minStock: 8, branchId: 1 },
      { id: 'inv-4', sku: 'ING-MILK-01', name: 'شیر پرچرب باریستا کاله', category: 'لبنیات', unit: 'لیتر', qtyOnHand: 120, avgCost: 55000, minStock: 30, branchId: 1 },
      { id: 'inv-5', sku: 'ING-SYRUP-01', name: 'سیروپ وانیل/کارامل فرانسوی', category: 'بار سرد و گرم', unit: 'بطری', qtyOnHand: 18, avgCost: 420000, minStock: 5, branchId: 1 },
      { id: 'inv-6', sku: 'ING-BUN-01', name: 'نان برگر بریوش کره‌ای دست‌ساز', category: 'نان و قنادی', unit: 'عدد', qtyOnHand: 85, avgCost: 35000, minStock: 25, branchId: 1 },
      { id: 'inv-7', sku: 'ING-CHEESE-01', name: 'پنیر چدار و موزارلا ترکیبی', category: 'لبنیات', unit: 'کیلوگرم', qtyOnHand: 40, avgCost: 480000, minStock: 10, branchId: 1 },
      { id: 'inv-8', sku: 'ING-PASTA-01', name: 'پاستا فتوچینی پریمیوم', category: 'خشکبار و پاستا', unit: 'بسته', qtyOnHand: 60, avgCost: 68000, minStock: 15, branchId: 1 },
      { id: 'inv-9', sku: 'ING-CREAM-01', name: 'خامه آشپزی و پخت‌وپز', category: 'لبنیات', unit: 'پاکت', qtyOnHand: 45, avgCost: 110000, minStock: 10, branchId: 1 },
      { id: 'inv-10', sku: 'ING-FRIES-01', name: 'سیب‌زمینی نیمه‌آماده خلال منجمد', category: 'منجمد و سرخ‌کردنی', unit: 'کیلوگرم', qtyOnHand: 90, avgCost: 95000, minStock: 25, branchId: 1 },
      { id: 'inv-11', sku: 'ING-PACK-01', name: 'پک ظروف بیرون‌بر کرافت و لیوان دو جداره', category: 'ملزومات بسته‌بندی', unit: 'بسته', qtyOnHand: 200, avgCost: 42000, minStock: 50, branchId: 1 },
    ];
  }
  if (!Array.isArray(acc.inventoryTransactions)) acc.inventoryTransactions = [];
  if (!Array.isArray(acc.inventoryCounts)) acc.inventoryCounts = [];
  if (!Array.isArray(acc.wasteLog)) acc.wasteLog = [];
  if (!Array.isArray(acc.recipes)) acc.recipes = [];
  if (allowDemoSeed && acc.recipes.length === 0) {
    acc.recipes = [
      {
        id: 'rcp-1',
        menuItemId: 'double_espresso',
        name: 'اسپرسو دوبل شات اسپشیالتی',
        category: 'بار گرم',
        version: '2.1',
        yieldPercent: 96,
        sellingPrice: 85000,
        ingredients: [
          { itemId: 'inv-3', name: 'دان قهوه کلمبیا ۱۰۰٪ عربیکا', qty: 0.020, unit: 'کیلوگرم', unitCost: 950000 },
        ],
        totalCost: 19000,
        foodCostPercent: 22.4,
        status: 'OPTIMAL',
        updatedAt: new Date().toISOString(),
      },
      {
        id: 'rcp-2',
        menuItemId: 'vanilla_latte',
        name: 'وانیلا لاته آرت',
        category: 'بار گرم',
        version: '1.4',
        yieldPercent: 95,
        sellingPrice: 145000,
        ingredients: [
          { itemId: 'inv-3', name: 'دان قهوه کلمبیا ۱۰۰٪ عربیکا', qty: 0.020, unit: 'کیلوگرم', unitCost: 950000 },
          { itemId: 'inv-4', name: 'شیر پرچرب باریستا', qty: 0.22, unit: 'لیتر', unitCost: 55000 },
          { itemId: 'inv-5', name: 'سیروپ وانیل فرانسوی', qty: 0.02, unit: 'بطری', unitCost: 420000 },
        ],
        totalCost: 39500,
        foodCostPercent: 27.2,
        status: 'OPTIMAL',
        updatedAt: new Date().toISOString(),
      },
      {
        id: 'rcp-3',
        menuItemId: 'signature_burger',
        name: 'برگر دست‌ساز وستو با فرایز',
        category: 'غذا و برگر',
        version: '2.0',
        yieldPercent: 94,
        sellingPrice: 380000,
        ingredients: [
          { itemId: 'inv-1', name: 'راسته گوساله بیات‌شده (۱۸۰ گرم)', qty: 0.20, unit: 'کیلوگرم', unitCost: 720000 },
          { itemId: 'inv-6', name: 'نان برگر بریوش کره‌ای', qty: 1, unit: 'عدد', unitCost: 35000 },
          { itemId: 'inv-7', name: 'پنیر چدار و موزارلا', qty: 0.05, unit: 'کیلوگرم', unitCost: 480000 },
          { itemId: 'inv-10', name: 'سیب‌زمینی خلال منجمد', qty: 0.15, unit: 'کیلوگرم', unitCost: 95000 },
        ],
        totalCost: 117250,
        foodCostPercent: 30.8,
        status: 'STANDARD',
        updatedAt: new Date().toISOString(),
      },
      {
        id: 'rcp-4',
        menuItemId: 'chicken_alfredo',
        name: 'پاستا چیکن آلفردو',
        category: 'غذا و پاستا',
        version: '1.2',
        yieldPercent: 96,
        sellingPrice: 340000,
        ingredients: [
          { itemId: 'inv-2', name: 'فیله مرغ زعفرانی', qty: 0.16, unit: 'کیلوگرم', unitCost: 380000 },
          { itemId: 'inv-8', name: 'پاستا فتوچینی', qty: 0.35, unit: 'بسته', unitCost: 68000 },
          { itemId: 'inv-9', name: 'خامه آشپزی', qty: 0.15, unit: 'پاکت', unitCost: 110000 },
          { itemId: 'inv-7', name: 'پنیر چدار و موزارلا', qty: 0.04, unit: 'کیلوگرم', unitCost: 480000 },
        ],
        totalCost: 100300,
        foodCostPercent: 29.5,
        status: 'STANDARD',
        updatedAt: new Date().toISOString(),
      },
    ];
  }
  return acc;
}

/**
 * Receives stock into inventory and updates Moving Weighted Average (MWA) cost.
 */
function receiveStock(acc, { itemId, itemName, qty, unitCost, vendorId, date, branchId }) {
  ensureInventory(acc);
  const targetBranchId = normalizedBranchId(branchId);
  if (targetBranchId === null) throw new Error('شعبهٔ معتبر برای دریافت موجودی الزامی است.');
  const receivedQty = positiveQuantity(qty, 'مقدار دریافت');
  const rawUnitCost = unitCost == null || unitCost === '' ? 0 : Number(unitCost);
  const costPerUnit = toIRR(rawUnitCost);
  if (!Number.isFinite(rawUnitCost) || rawUnitCost < 0 || !Number.isSafeInteger(costPerUnit)) throw new Error('بهای واحد دریافت معتبر نیست.');

  let item = findInventoryItem(acc, itemId, targetBranchId);
  const itemInOtherBranch = item ? null : findInventoryItemAnyBranch(acc, itemId);
  if (!item && itemInOtherBranch) throw new Error('قلم موجودی به شعبهٔ دیگری تعلق دارد.');

  if (!item) {
    item = {
      id: itemId || `inv-${Date.now()}`,
      sku: `SKU-${Date.now().toString().slice(-4)}`,
      name: itemName || itemId,
      unit: 'کیلوگرم',
      qtyOnHand: 0,
      avgCost: 0,
      branchId: targetBranchId,
    };
    acc.inventoryItems.push(item);
  }

  const oldQty = nonNegativeNumber(item.qtyOnHand ?? 0, 'موجودی قبلی');
  const oldCost = nonNegativeNumber(item.avgCostIrr ?? item.avgCost ?? 0, 'بهای میانگین قبلی');
  const oldTotal = oldQty * oldCost;
  const newTotal = receivedQty * costPerUnit;
  const newQty = oldQty + receivedQty;
  if (!Number.isSafeInteger(Math.round(newTotal)) || !Number.isSafeInteger(Math.round(oldTotal + newTotal))) throw new Error('ارزش موجودی از محدودهٔ امن خارج است.');
  item.qtyOnHand = newQty;
  item.avgCost = newQty > 0 ? Math.round((oldTotal + newTotal) / newQty) : costPerUnit;
  if (item.avgCostIrr !== undefined) item.avgCostIrr = item.avgCost;

  const txn = {
    id: `itx-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    itemId: item.id,
    itemName: item.name,
    type: 'PURCHASE',
    qty: receivedQty,
    unitCost: costPerUnit,
    totalCost: Math.round(receivedQty * costPerUnit),
    vendorId,
    date: date || new Date().toISOString(),
    branchId: targetBranchId,
    createdAt: new Date().toISOString(),
  };

  acc.inventoryTransactions.push(txn);
  return { item, txn };
}

/**
 * Consumes stock from inventory (theoretical or actual sales consumption).
 */
function consumeStock(acc, { itemId, qty, reason, orderId, date, branchId }) {
  ensureInventory(acc);
  const targetBranchId = normalizedBranchId(branchId);
  if (targetBranchId === null) return { error: 'شعبهٔ معتبر برای مصرف موجودی الزامی است.' };
  const item = findInventoryItem(acc, itemId, targetBranchId);
  if (!item && findInventoryItemAnyBranch(acc, itemId)) return { error: 'قلم موجودی به شعبهٔ دیگری تعلق دارد.' };
  if (!item) return { error: `آیتم موجودی با شناسه «${itemId}» یافت نشد.` };

  const consumeQty = Number(qty);
  if (!Number.isFinite(consumeQty) || consumeQty <= 0) return { error: 'مقدار مصرف باید عددی بزرگتر از صفر باشد.' };
  let available;
  try {
    available = availableInventoryQuantity(item);
  } catch (error) {
    return { error: error.message };
  }
  if (exceedsAvailable(consumeQty, available)) return { error: 'موجودی کافی برای مصرف وجود ندارد.' };
  const unitCost = inventoryUnitCost(item);
  if (unitCost == null) return { error: 'بهای میانگین موجودی معتبر نیست.' };
  const cogsAmount = Math.round(consumeQty * unitCost);
  if (!Number.isSafeInteger(cogsAmount)) return { error: 'ارزش مصرف از محدودهٔ امن خارج است.' };
  const onHand = Number(item.qtyOnHand ?? item.onHand ?? item.quantity);
  setInventoryOnHand(item, Math.max(0, onHand - consumeQty));

  const txn = {
    id: `itx-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    itemId: item.id,
    itemName: item.name,
    type: 'USAGE_ACTUAL',
    qty: consumeQty,
    unitCost,
    totalCost: cogsAmount,
    reason: reason || 'sales_consumption',
    orderId,
    date: date || new Date().toISOString(),
    branchId: targetBranchId,
    createdAt: new Date().toISOString(),
  };

  acc.inventoryTransactions.push(txn);
  return { item, txn, cogsAmount };
}

/**
 * Records Kitchen Waste / Spoilage with Balanced Double-Entry GL Posting.
 */
function recordWaste(acc, { itemId, qty, reason, date, branchId, createdById }, opts = {}) {
  ensureInventory(acc);
  const { postJournalFn } = opts;

  const targetBranchId = normalizedBranchId(branchId);
  if (targetBranchId === null) throw new Error('شعبهٔ معتبر برای ثبت ضایعات الزامی است.');
  const item = findInventoryItem(acc, itemId, targetBranchId);
  if (!item && findInventoryItemAnyBranch(acc, itemId)) throw new Error('قلم موجودی به شعبهٔ دیگری تعلق دارد.');
  if (!item) throw new Error(`آیتم موجودی «${itemId}» یافت نشد.`);

  const wasteQty = positiveQuantity(qty, 'مقدار ضایعات');
  const onHand = nonNegativeNumber(item.qtyOnHand ?? item.onHand ?? item.quantity, 'موجودی فعلی');
  if (exceedsAvailable(wasteQty, availableInventoryQuantity(item))) throw new Error('موجودی کافی برای ثبت ضایعات وجود ندارد.');

  const unitCost = inventoryUnitCost(item);
  if (unitCost == null) throw new Error('بهای میانگین موجودی معتبر نیست.');
  const wasteAmount = Math.round(wasteQty * unitCost);

  const wasteId = `wst-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const wasteReason = reason || 'ضایعات فرآوری / تاریخ گذشته';
  const wasteDate = date || new Date().toISOString();

  // Determine credit account based on item classification:
  // 1610: Raw Food & Bev, 1620: Packaging, 1630: WIP / Prep
  let creditAccount = opts.creditAccountCode || item.inventoryAccountCode || '1610';
  const itemCategory = String(item.category || item.type || item.subtype || '').toLowerCase();
  if (itemCategory === 'packaging' || item.accountCode === '1620') {
    creditAccount = '1620';
  } else if (itemCategory === 'prep' || itemCategory === 'wip' || item.accountCode === '1630' || item.isSubRecipeOutput) {
    creditAccount = '1630';
  }

  // Balanced Double Entry for Kitchen Waste:
  // DR 5400 (Kitchen Waste & Spoilage / ضایعات و ضایع‌شدگی مواد آشپزخانه)
  // CR 1610 / 1620 / 1630 (Inventory Account)
  const journalLines = [
    {
      accountCode: '5400', // Kitchen Waste & Spoilage
      debit: wasteAmount,
      credit: 0,
      memo: `ثبت ضایعات آشپزخانه: ${item.name} (${wasteQty} ${item.unit}) - ${wasteReason}`,
      branchId: targetBranchId,
    },
    {
      accountCode: creditAccount,
      debit: 0,
      credit: wasteAmount,
      memo: `کاهش موجودی بابت ضایعات ${item.name}`,
      branchId: targetBranchId,
    },
  ];

  let journalEntry = null;
  if (postJournalFn) {
    journalEntry = postJournalFn({
      source: 'kitchen_waste',
      sourceId: wasteId,
      date: wasteDate,
      description: `ثبت حسابداری ضایعات: ${item.name} به ارزش ${formatNumber(wasteAmount)} ریال`,
      lines: journalLines,
      createdById: createdById || 'admin',
    });
  }

  // The journal must succeed before changing physical stock. This keeps the
  // inventory and the accounting entry atomic when the journal adapter fails.
  setInventoryOnHand(item, Math.max(0, onHand - wasteQty));

  const wasteRecord = {
    id: wasteId,
    itemId: item.id,
    itemName: item.name,
    qty: wasteQty,
    unit: item.unit,
    unitCost,
    totalCost: wasteAmount,
    reason: wasteReason,
    date: wasteDate,
    branchId: targetBranchId,
    journalEntryId: journalEntry ? journalEntry.id : null,
    journalNumber: journalEntry ? journalEntry.number : null,
    createdAt: new Date().toISOString(),
  };

  acc.wasteLog.unshift(wasteRecord);

  // Record Transaction
  acc.inventoryTransactions.push({
    id: `itx-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    itemId: item.id,
    itemName: item.name,
    type: 'WASTE',
    qty: wasteQty,
    unitCost,
    totalCost: wasteAmount,
    reason: wasteReason,
    date: wasteDate,
    branchId: targetBranchId,
    createdAt: new Date().toISOString(),
  });

  auditEngine.recordAuditLog(acc, {
    action: 'RECORD_WASTE',
    entityType: 'WasteLog',
    entityId: wasteRecord.id,
    userId: createdById || 'admin',
    message: `ضایعات «${item.name}» به مقدار ${wasteQty} ${item.unit} (ارزش: ${formatNumber(wasteAmount)} ریال) ثبت شد.`,
  });

  return { ok: true, item, waste: wasteRecord, wasteAmount, journalEntry };
}

/**
 * Returns current inventory valuation.
 */
function getInventoryValuation(acc, branchId) {
  const targetBranchId = optionalBranchId(branchId);
  ensureInventory(acc);
  let totalValue = 0;
  const unvaluedItems = [];
  const items = (acc.inventoryItems || [])
    .filter((i) => targetBranchId == null || sameBranch(i, targetBranchId))
    .map((i) => {
      const quantity = Number(i.qtyOnHand ?? i.onHand ?? i.quantity);
      const unitCost = inventoryUnitCost(i);
      if (!Number.isFinite(quantity) || quantity < 0 || unitCost == null) {
        unvaluedItems.push({ itemId: i.id, reason: !Number.isFinite(quantity) || quantity < 0 ? 'quantity_invalid' : 'cost_invalid' });
        return { ...i, totalValue: null, valuationStatus: 'unvalued' };
      }
      const val = Math.round(quantity * unitCost);
      if (!Number.isSafeInteger(val)) {
        unvaluedItems.push({ itemId: i.id, reason: 'value_unsafe' });
        return { ...i, totalValue: null, valuationStatus: 'unvalued' };
      }
      totalValue += val;
      return { ...i, totalValue: val, valuationStatus: 'valued' };
    });
  return { items, totalValue, totalItems: items.length, unvaluedItems, complete: unvaluedItems.length === 0 };
}

/**
 * Calculates Theoretical vs Actual COGS Variance Analysis.
 */
function getCOGSVarianceAnalysis(acc, db, branchId = null, options = {}) {
  const targetBranchId = optionalBranchId(branchId);
  ensureInventory(acc);
  const parseBoundary = (value, endOfDay = false) => {
    if (!value) return null;
    const text = String(value).trim();
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(text);
    const source = dateOnly ? `${text}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z` : value;
    const at = new Date(source).getTime();
    return Number.isFinite(at) ? at : null;
  };
  const fromAt = parseBoundary(options.from, false);
  const toAt = parseBoundary(options.to, true);
  const hasFrom = Number.isFinite(fromAt);
  const hasTo = Number.isFinite(toAt);
  const inRange = (value) => {
    const at = new Date(value || 0).getTime();
    if ((hasFrom || hasTo) && !Number.isFinite(at)) return false;
    return (!hasFrom || at >= fromAt) && (!hasTo || at <= toAt);
  };
  const inBranch = (row) => targetBranchId == null || sameBranch(row, targetBranchId);
  const paidStatuses = new Set(['paid', 'preparing', 'ready', 'dispatched', 'picked_up', 'delivered', 'done']);
  const orders = (db?.orders || []).filter((order) => (
    paidStatuses.has(String(order.status || ''))
    && inBranch(order)
    && inRange(order.paidAt || order.createdAt || order.date)
  ));
  const recipes = recipeCatalog({ accounting: acc, financeV2: db?.financeV2 }, targetBranchId);
  const theoreticalUsage = new Map();
  const coverageIssues = [];
  let totalTheoreticalCOGS = 0;

  // Theoretical COGS is based on the recipe version effective at sale time.
  for (const order of orders) {
    const soldAt = order.paidAt || order.createdAt || order.date;
    for (const line of order.items || []) {
      const menuItemId = line.menuItemId ?? line.id;
      const menuItemCandidates = recipes.filter((candidate) => String(candidate.menuItemId) === String(menuItemId));
      // A name-only compatibility lookup is safe only when there is no recipe
      // history for this menu item. If versioned history exists but no version
      // was effective on the sale date, keep the line incomplete instead of
      // borrowing a later recipe and inventing theoretical COGS.
      const recipe = effectiveRecipeForSale(recipes, menuItemId, soldAt)
        || (!menuItemCandidates.length ? recipes.find((candidate) => candidate.name && candidate.name === line.name) : null);
      const soldQty = Number(line.quantity ?? line.qty ?? 1);
      if (!recipe) {
        coverageIssues.push({ code: 'recipe_missing', orderId: order.id || null, menuItemId: menuItemId || null });
        continue;
      }
      if (!Number.isFinite(soldQty) || soldQty <= 0 || !Array.isArray(recipe.ingredients) || recipe.ingredients.length === 0) {
        coverageIssues.push({ code: 'recipe_line_invalid', orderId: order.id || null, menuItemId: menuItemId || null, recipeId: recipe.id || null });
        continue;
      }
      let lineComplete = true;
      const lineComponents = [];
      for (const ingredient of recipe.ingredients) {
        let component;
        try {
          component = recipeIngredientCost(acc, recipe, ingredient, targetBranchId);
        } catch (error) {
          component = { ok: false, code: 'recipe_inventory_item_ambiguous', item: null, message: error.message };
        }
        if (!component.ok) {
          lineComplete = false;
          coverageIssues.push({ code: component.code, orderId: order.id || null, menuItemId: menuItemId || null, itemId: ingredient.itemId || null, message: component.message });
          continue;
        }
        const quantity = component.quantityBase * soldQty;
        const lineCost = Math.round(quantity * component.unitCost);
        if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isSafeInteger(lineCost)) {
          lineComplete = false;
          coverageIssues.push({ code: 'recipe_cost_unsafe', orderId: order.id || null, itemId: component.item.id });
          continue;
        }
        lineComponents.push({ component, quantity, lineCost, ingredient });
      }
      if (!lineComplete) coverageIssues.push({ code: 'recipe_line_coverage_incomplete', orderId: order.id || null, menuItemId: menuItemId || null });
      else lineComponents.forEach(({ component, quantity, lineCost, ingredient }) => {
        const key = String(component.item.id);
        const existing = theoreticalUsage.get(key) || {
          itemId: component.item.id, name: component.item.name || ingredient.name, unit: component.baseUnit,
          qty: 0, cost: 0,
        };
        existing.qty += quantity;
        existing.cost += lineCost;
        theoreticalUsage.set(key, existing);
        totalTheoreticalCOGS += lineCost;
      });
    }
  }

  const actualUsage = new Map();
  const wasteUsage = new Map();
  const transactionIssues = [];
  let totalActualCOGS = 0;
  let totalWasteCost = 0;
  const v2SaleSources = new Set((db?.financeV2?.inventoryMovements || [])
    .filter((movement) => (
      movement.movementType === 'sale_consumption'
      && inBranch(movement)
      && inRange(movement.occurredAt || movement.createdAt)
    ))
    .map((movement) => movement.sourceId ?? movement.orderId)
    .filter((sourceId) => sourceId != null)
    .map((sourceId) => String(sourceId)));
  for (const transaction of acc.inventoryTransactions || []) {
    if (!inBranch(transaction) || !inRange(transaction.date || transaction.createdAt)) continue;
    const isUsage = transaction.type === 'USAGE_ACTUAL' || transaction.type === 'consume';
    const isWaste = transaction.type === 'WASTE';
    if (!isUsage && !isWaste) continue;
    if (isUsage && transaction.orderId != null && v2SaleSources.has(String(transaction.orderId))) continue;
    const quantity = Number(transaction.qty);
    const cost = Number(transaction.totalCost);
    if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(cost) || cost < 0 || !Number.isSafeInteger(Math.round(cost))) {
      transactionIssues.push({ code: 'inventory_transaction_invalid', transactionId: transaction.id || null, itemId: transaction.itemId || null });
      continue;
    }
    const target = isWaste ? wasteUsage : actualUsage;
    const key = String(transaction.itemId);
    const existing = target.get(key) || { itemId: transaction.itemId, name: transaction.itemName, qty: 0, cost: 0 };
    existing.qty += quantity;
    existing.cost += Math.round(cost);
    target.set(key, existing);
    if (isWaste) totalWasteCost += Math.round(cost);
    else totalActualCOGS += Math.round(cost);
  }

  // Finance V2 keeps shadow sale/waste consumption in immutable movements
  // instead of the legacy transaction list. Include it here so the legacy
  // report endpoint does not silently understate actual COGS during cutover.
  for (const movement of db?.financeV2?.inventoryMovements || []) {
    if (!inBranch(movement) || !inRange(movement.occurredAt || movement.createdAt)) continue;
    const isSaleConsumption = movement.movementType === 'sale_consumption';
    const isWaste = movement.movementType === 'waste';
    if (!isSaleConsumption && !isWaste) continue;
    const quantityBase = Number(movement.quantityBase);
    const cost = Number(movement.totalCostIrr);
    if (!Number.isFinite(quantityBase) || quantityBase >= 0 || !Number.isFinite(cost) || cost < 0 || !Number.isSafeInteger(Math.round(cost))) {
      transactionIssues.push({ code: 'inventory_movement_invalid', movementId: movement.id || null, itemId: movement.itemId || null });
      continue;
    }
    const target = isWaste ? wasteUsage : actualUsage;
    const key = String(movement.itemId);
    const existing = target.get(key) || { itemId: movement.itemId, name: movement.itemName, qty: 0, cost: 0 };
    existing.qty += Math.abs(quantityBase);
    existing.cost += Math.round(cost);
    target.set(key, existing);
    if (isWaste) totalWasteCost += Math.round(cost);
    else totalActualCOGS += Math.round(cost);
  }

  const varianceIrr = totalActualCOGS - totalTheoreticalCOGS;
  const variancePct = totalTheoreticalCOGS > 0 ? (varianceIrr / totalTheoreticalCOGS) * 100 : 0;
  const sufficientHistory = totalTheoreticalCOGS > 0 && actualUsage.size > 0 && coverageIssues.length === 0 && transactionIssues.length === 0;
  return {
    branchId: targetBranchId,
    from: options.from || null,
    to: options.to || null,
    totalTheoreticalCOGS,
    totalActualCOGS,
    totalWasteCost,
    varianceIrr,
    variancePct: Number(variancePct.toFixed(2)),
    status: !sufficientHistory
      ? 'INSUFFICIENT_DATA'
      : variancePct > 8 ? 'WARNING_HIGH_VARIANCE' : variancePct > 3 ? 'ACCEPTABLE' : 'OPTIMAL',
    sufficientHistory,
    coverageIssues,
    transactionIssues,
    theoreticalBreakdown: [...theoreticalUsage.values()],
    actualBreakdown: [...actualUsage.values()],
    wasteBreakdown: [...wasteUsage.values()],
  };
}

/**
 * Computes BCG Menu Engineering Matrix (Stars, Plowhorses, Puzzles, Dogs).
 */
function getMenuEngineeringMatrix(acc, db, branchId = null, options = {}) {
  const targetBranchId = optionalBranchId(branchId);
  ensureInventory(acc);
  const fromAt = options.from ? new Date(options.from).getTime() : null;
  const toAt = options.to ? new Date(options.to).getTime() : null;
  const orders = (db.orders || []).filter((o) => {
    if (targetBranchId != null && Number(o.branchId) !== targetBranchId) return false;
    const occurredAt = new Date(o.paidAt || o.createdAt || o.date || 0).getTime();
    if (Number.isFinite(fromAt) && occurredAt < fromAt) return false;
    if (Number.isFinite(toAt) && occurredAt > toAt) return false;
    return ['paid', 'preparing', 'ready', 'dispatched', 'delivered', 'done'].includes(o.status);
  });

  const salesMap = new Map();
  orders.forEach((ord) => {
    (ord.items || []).forEach((item) => {
      const key = item.id || item.name;
      const ex = salesMap.get(key) || { menuItemId: item.id, name: item.name, price: item.price || 0, qty: 0, revenue: 0 };
      ex.qty += Number(item.quantity || item.qty || 1);
      ex.revenue += Number((item.price || 0) * (item.quantity || item.qty || 1));
      salesMap.set(key, ex);
    });
  });

  const menuItems = Array.from(salesMap.values());
  if (menuItems.length === 0) {
    return { items: [], benchmarks: null, sufficientHistory: false, excludedWithoutRecipe: 0 };
  }

  const recipes = recipeCatalog({ accounting: acc, financeV2: db.financeV2 }, targetBranchId);
  const eligibleMenuItems = menuItems.filter((sale) => recipes.some((recipe) => recipe.menuItemId === sale.menuItemId || recipe.name === sale.name));
  const items = eligibleMenuItems.map((s) => {
    const recipe = recipes.find((r) => r.menuItemId === s.menuItemId || r.name === s.name);
    const unitFoodCost = recipe.totalCost;
    const totalFoodCost = unitFoodCost * s.qty;
    const marginPerUnit = s.price - unitFoodCost;
    const totalMargin = s.revenue - totalFoodCost;
    const foodCostPct = s.revenue > 0 ? (totalFoodCost / s.revenue) * 100 : 0;

    return {
      menuItemId: s.menuItemId,
      name: s.name,
      qty: s.qty,
      price: s.price,
      revenue: s.revenue,
      unitFoodCost,
      totalFoodCost,
      marginPerUnit,
      totalMargin,
      foodCostPct: Number(foodCostPct.toFixed(1)),
    };
  });

  // Calculate Thresholds (Averages)
  const totalVolume = items.reduce((s, x) => s + x.qty, 0);
  const avgVolume = items.length > 0 ? totalVolume / items.length : 0;
  const avgMargin = items.length > 0 ? items.reduce((s, x) => s + x.marginPerUnit, 0) / items.length : 0;

  const categorized = items.map((item) => {
    const highVol = item.qty >= avgVolume;
    const highMargin = item.marginPerUnit >= avgMargin;

    let category = 'dog';
    let recommendation = 'حذف یا بازنگری کامل قیمت و رسپی';

    if (highVol && highMargin) {
      category = 'star';
      recommendation = 'حفظ کیفیت ممتاز و پروموت در صدر منو';
    } else if (highVol && !highMargin) {
      category = 'plowhorse';
      recommendation = 'بهینه‌سازی رسپی و افزایش تدریجی قیمت';
    } else if (!highVol && highMargin) {
      category = 'puzzle';
      recommendation = 'تبلیغات و تخفیف هوشمند جهت افزایش فروش';
    }

    return {
      ...item,
      category, // star | plowhorse | puzzle | dog
      recommendation,
    };
  });

  return {
    items: categorized.sort((a, b) => b.totalMargin - a.totalMargin),
    benchmarks: {
      avgVolume: Math.round(avgVolume),
      avgMargin: Math.round(avgMargin),
      totalVolume,
      totalRevenue: items.reduce((s, x) => s + x.revenue, 0),
      totalMargin: items.reduce((s, x) => s + x.totalMargin, 0),
    },
    sufficientHistory: items.length > 0,
    excludedWithoutRecipe: menuItems.length - eligibleMenuItems.length,
  };
}

/**
 * Saves or updates a Recipe.
 */
function saveRecipe(acc, recipe) {
  const input = recipe || {};
  const branchId = optionalBranchId(input.branchId);
  ensureInventory(acc);
  const ingredients = Array.isArray(input.ingredients) ? input.ingredients : [];
  if (ingredients.length === 0) throw new Error('رسپی باید حداقل یک مادهٔ اولیه داشته باشد.');
  const existingById = (input.id || input.recipeId)
    ? acc.recipes.findIndex((r) => r.id === (input.id || input.recipeId))
    : -1;
  const existingByMenuItem = input.menuItemId
    ? acc.recipes.findIndex((r) => String(r.menuItemId) === String(input.menuItemId))
    : -1;
  const existing = existingById >= 0 ? existingById : existingByMenuItem;
  const id = existing >= 0
    ? acc.recipes[existing].id
    : (input.id || input.recipeId || (input.menuItemId ? `recipe-item-${input.menuItemId}` : `rcp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`));
  const lineCosts = ingredients.map((ingredient) => {
    let result;
    try {
      result = recipeIngredientCost(acc, { ...input, ingredients }, ingredient, branchId);
    } catch (error) {
      throw new Error(`مادهٔ اولیهٔ رسپی معتبر نیست: ${error.message}`);
    }
    if (!result.ok) throw new Error(`مادهٔ اولیهٔ رسپی قابل محاسبه نیست (${result.code}).`);
    return result.lineCost;
  });
  const totalCost = lineCosts.reduce((sum, value) => sum + value, 0);
  if (!Number.isSafeInteger(totalCost)) throw new Error('بهای رسپی از محدودهٔ امن خارج است.');
  const rawSellingPrice = input.sellingPrice == null || input.sellingPrice === '' ? 0 : Number(input.sellingPrice);
  if (!Number.isFinite(rawSellingPrice) || rawSellingPrice < 0) throw new Error('قیمت فروش رسپی معتبر نیست.');
  const sellingPrice = toIRR(rawSellingPrice);
  const rawYield = input.yieldPercent == null || input.yieldPercent === '' ? 95 : Number(input.yieldPercent);
  if (!Number.isFinite(rawYield) || rawYield <= 0 || rawYield > 100) throw new Error('بازده رسپی باید بین صفر و صد باشد.');
  for (const field of ['yieldQuantity', 'portions', 'servings']) {
    if (input[field] != null && (!Number.isFinite(Number(input[field])) || Number(input[field]) <= 0)) {
      throw new Error(`مقدار ${field} رسپی معتبر نیست.`);
    }
  }
  const foodCostPercent = sellingPrice > 0 ? Number(((totalCost / sellingPrice) * 100).toFixed(1)) : 0;

  const rec = {
    ...input,
    id,
    branchId,
    yieldPercent: rawYield,
    totalCost,
    sellingPrice,
    foodCostPercent,
    updatedAt: new Date().toISOString(),
  };

  if (existing >= 0) acc.recipes[existing] = rec;
  else acc.recipes.push(rec);

  return rec;
}

/**
 * Returns rich Recipe Cost Cards with ingredient cost breakdown, margin, and health status.
 */
function getRecipeCostCards(acc) {
  ensureInventory(acc);
  return (acc.recipes || []).map((recipe) => {
    const explicitBranch = recipe.branchId != null && recipe.branchId !== '';
    const branchId = explicitBranch ? normalizedBranchId(recipe.branchId) : null;
    const invalidBranchScope = explicitBranch && branchId === null;
    const issues = [];
    const ingredients = (recipe.ingredients || []).map((ing) => {
      let result;
      try {
        result = invalidBranchScope
          ? { ok: false, code: 'recipe_branch_invalid', item: null, message: 'شعبهٔ رسپی معتبر نیست؛ محاسبهٔ بهای مواد متوقف شد.' }
          : recipeIngredientCost(acc, recipe, ing, branchId);
      } catch (error) {
        result = { ok: false, code: 'recipe_inventory_item_ambiguous', item: null, message: error.message };
      }
      if (!result.ok) {
        issues.push({ code: result.code, itemId: ing.itemId || null, message: result.message });
        return {
          ...ing,
          currentStock: null,
          unit: ing.unit || 'عدد',
          unitCost: null,
          lineCost: null,
          costStatus: 'invalid',
        };
      }
      return {
        ...ing,
        currentStock: Number(result.item.qtyOnHand ?? result.item.onHand ?? result.item.quantity),
        unit: result.baseUnit || ing.unit || 'عدد',
        unitCost: result.unitCost,
        quantityBase: result.quantityBase,
        lineCost: result.lineCost,
        costStatus: 'valued',
      };
    });

    const totalCost = issues.length > 0 ? null : ingredients.reduce((sum, i) => sum + i.lineCost, 0);
    const sellingPrice = Number(recipe.sellingPrice ?? 0);
    if (!Number.isFinite(sellingPrice) || sellingPrice < 0) issues.push({ code: 'recipe_selling_price_invalid' });
    const grossMargin = totalCost == null || !Number.isFinite(sellingPrice) ? null : sellingPrice - totalCost;
    const foodCostPercent = totalCost != null && sellingPrice > 0 ? Number(((totalCost / sellingPrice) * 100).toFixed(1)) : null;

    let healthStatus = issues.length > 0 ? 'INVALID' : 'STANDARD';
    if (healthStatus !== 'INVALID' && foodCostPercent < 28) healthStatus = 'OPTIMAL';
    else if (healthStatus !== 'INVALID' && foodCostPercent > 35) healthStatus = 'HIGH';

    return {
      id: recipe.id,
      name: recipe.name,
      category: recipe.category || 'عمومی',
      version: recipe.version || '1.0',
      branchId,
      yieldPercent: Number(recipe.yieldPercent ?? 95),
      sellingPrice,
      totalCost,
      grossMargin,
      foodCostPercent,
      healthStatus,
      issues,
      ingredients,
      updatedAt: recipe.updatedAt || new Date().toISOString(),
    };
  });
}

module.exports = {
  ensureInventory,
  receiveStock,
  consumeStock,
  recordWaste,
  getInventoryValuation,
  getCOGSVarianceAnalysis,
  getMenuEngineeringMatrix,
  saveRecipe,
  getRecipeCostCards,
};
