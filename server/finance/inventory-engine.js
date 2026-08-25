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

const { toIRR, addMoney, subMoney } = require('./money');
const auditEngine = require('./audit-engine');

function ensureInventory(acc) {
  if (!Array.isArray(acc.inventoryItems)) acc.inventoryItems = [];
  if (process.env.WESTO_ACCOUNTING_DEMO_SEED === 'true' && acc.inventoryItems.length === 0) {
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
  if (process.env.WESTO_ACCOUNTING_DEMO_SEED === 'true' && acc.recipes.length === 0) {
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
  let item = acc.inventoryItems.find((i) => i.id === itemId || i.sku === itemId);
  const receivedQty = Number(qty || 0);
  const costPerUnit = toIRR(unitCost || 0);

  if (!item) {
    item = {
      id: itemId || `inv-${Date.now()}`,
      sku: `SKU-${Date.now().toString().slice(-4)}`,
      name: itemName || itemId,
      unit: 'کیلوگرم',
      qtyOnHand: 0,
      avgCost: 0,
      branchId: branchId || 1,
    };
    acc.inventoryItems.push(item);
  }

  const oldTotal = item.qtyOnHand * item.avgCost;
  const newTotal = receivedQty * costPerUnit;
  item.qtyOnHand += receivedQty;
  item.avgCost = item.qtyOnHand > 0 ? Math.round((oldTotal + newTotal) / item.qtyOnHand) : costPerUnit;

  const txn = {
    id: `itx-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    itemId: item.id,
    itemName: item.name,
    type: 'PURCHASE',
    qty: receivedQty,
    unitCost: costPerUnit,
    totalCost: receivedQty * costPerUnit,
    vendorId,
    date: date || new Date().toISOString(),
    branchId: branchId || 1,
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
  const item = acc.inventoryItems.find((i) => i.id === itemId || i.sku === itemId);
  if (!item) return { error: `آیتم موجودی با شناسه «${itemId}» یافت نشد.` };

  const consumeQty = Number(qty || 0);
  const cogsAmount = Math.round(consumeQty * item.avgCost);
  item.qtyOnHand = Math.max(0, item.qtyOnHand - consumeQty);

  const txn = {
    id: `itx-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    itemId: item.id,
    itemName: item.name,
    type: 'USAGE_ACTUAL',
    qty: consumeQty,
    unitCost: item.avgCost,
    totalCost: cogsAmount,
    reason: reason || 'sales_consumption',
    orderId,
    date: date || new Date().toISOString(),
    branchId: branchId || 1,
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

  const item = acc.inventoryItems.find((i) => i.id === itemId || i.sku === itemId);
  if (!item) throw new Error(`آیتم موجودی «${itemId}» یافت نشد.`);

  const wasteQty = Number(qty || 0);
  if (wasteQty <= 0) throw new Error('مقدار ضایعات باید بزرگتر از صفر باشد.');

  const wasteAmount = Math.round(wasteQty * item.avgCost);
  item.qtyOnHand = Math.max(0, item.qtyOnHand - wasteQty);

  const wasteId = `wst-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const wasteReason = reason || 'ضایعات فرآوری / تاریخ گذشته';
  const wasteDate = date || new Date().toISOString();

  // Balanced Double Entry for Kitchen Waste:
  // DR 5400 (Kitchen Waste & Spoilage / ضایعات و ضایع‌شدگی مواد آشپزخانه)
  // CR 1610 (Raw Food & Beverage Inventory / موجودی مواد اولیه)
  const journalLines = [
    {
      accountCode: '5400', // Kitchen Waste & Spoilage
      debit: wasteAmount,
      credit: 0,
      memo: `ثبت ضایعات آشپزخانه: ${item.name} (${wasteQty} ${item.unit}) - ${wasteReason}`,
      branchId: branchId || 1,
    },
    {
      accountCode: '1610', // Raw Food & Beverage Inventory
      debit: 0,
      credit: wasteAmount,
      memo: `کاهش موجودی بابت ضایعات ${item.name}`,
      branchId: branchId || 1,
    },
  ];

  let journalEntry = null;
  if (postJournalFn) {
    journalEntry = postJournalFn({
      source: 'kitchen_waste',
      sourceId: wasteId,
      date: wasteDate,
      description: `ثبت حسابداری ضایعات: ${item.name} به ارزش ${wasteAmount.toLocaleString('fa-IR')} ریال`,
      lines: journalLines,
      createdById: createdById || 'admin',
    });
  }

  const wasteRecord = {
    id: wasteId,
    itemId: item.id,
    itemName: item.name,
    qty: wasteQty,
    unit: item.unit,
    unitCost: item.avgCost,
    totalCost: wasteAmount,
    reason: wasteReason,
    date: wasteDate,
    branchId: branchId || 1,
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
    unitCost: item.avgCost,
    totalCost: wasteAmount,
    reason: wasteReason,
    date: wasteDate,
    branchId: branchId || 1,
    createdAt: new Date().toISOString(),
  });

  auditEngine.recordAuditLog(acc, {
    action: 'RECORD_WASTE',
    entityType: 'WasteLog',
    entityId: wasteRecord.id,
    userId: createdById || 'admin',
    message: `ضایعات «${item.name}» به مقدار ${wasteQty} ${item.unit} (ارزش: ${wasteAmount.toLocaleString('fa-IR')} ریال) ثبت شد.`,
  });

  return { ok: true, item, waste: wasteRecord, wasteAmount, journalEntry };
}

/**
 * Returns current inventory valuation.
 */
function getInventoryValuation(acc, branchId) {
  ensureInventory(acc);
  let totalValue = 0;
  const items = (acc.inventoryItems || [])
    .filter((i) => !branchId || i.branchId == branchId)
    .map((i) => {
      const val = Math.round(i.qtyOnHand * i.avgCost);
      totalValue += val;
      return { ...i, totalValue: val };
    });
  return { items, totalValue, totalItems: items.length };
}

/**
 * Calculates Theoretical vs Actual COGS Variance Analysis.
 */
function getCOGSVarianceAnalysis(acc, db) {
  ensureInventory(acc);
  const orders = (db.orders || []).filter((o) => ['paid', 'preparing', 'ready', 'dispatched', 'delivered', 'done'].includes(o.status));

  // 1. Calculate Theoretical Usage from POS Order Items & Active Recipes
  const theoreticalUsage = {};
  let totalTheoreticalCOGS = 0;

  orders.forEach((ord) => {
    (ord.items || []).forEach((item) => {
      const recipe = (acc.recipes || []).find((r) => r.menuItemId === item.id || r.name === item.name);
      const soldQty = Number(item.quantity || item.qty || 1);

      if (recipe) {
        (recipe.ingredients || []).forEach((ing) => {
          if (!theoreticalUsage[ing.itemId]) {
            theoreticalUsage[ing.itemId] = { itemId: ing.itemId, name: ing.name, qty: 0, cost: 0 };
          }
          const componentQty = ing.qty * soldQty;
          const invItem = acc.inventoryItems.find((i) => i.id === ing.itemId);
          const unitCost = invItem ? invItem.avgCost : ing.unitCost;
          const lineCost = Math.round(componentQty * unitCost);

          theoreticalUsage[ing.itemId].qty += componentQty;
          theoreticalUsage[ing.itemId].cost += lineCost;
          totalTheoreticalCOGS += lineCost;
        });
      }
    });
  });

  // 2. Calculate Actual COGS from transactions
  const actualUsage = {};
  let totalActualCOGS = 0;

  (acc.inventoryTransactions || []).filter((t) => t.type === 'USAGE_ACTUAL' || t.type === 'consume' || t.type === 'WASTE').forEach((t) => {
    if (!actualUsage[t.itemId]) actualUsage[t.itemId] = { itemId: t.itemId, name: t.itemName, qty: 0, cost: 0 };
    actualUsage[t.itemId].qty += t.qty;
    actualUsage[t.itemId].cost += t.totalCost;
    totalActualCOGS += t.totalCost;
  });

  const varianceIrr = totalActualCOGS - totalTheoreticalCOGS;
  const variancePct = totalTheoreticalCOGS > 0 ? (varianceIrr / totalTheoreticalCOGS) * 100 : 0;

  return {
    totalTheoreticalCOGS,
    totalActualCOGS,
    varianceIrr,
    variancePct: Number(variancePct.toFixed(2)),
    status: totalTheoreticalCOGS <= 0 || Object.keys(actualUsage).length === 0
      ? 'INSUFFICIENT_DATA'
      : variancePct > 8 ? 'WARNING_HIGH_VARIANCE' : variancePct > 3 ? 'ACCEPTABLE' : 'OPTIMAL',
    sufficientHistory: totalTheoreticalCOGS > 0 && Object.keys(actualUsage).length > 0,
    theoreticalBreakdown: Object.values(theoreticalUsage),
    actualBreakdown: Object.values(actualUsage),
  };
}

/**
 * Computes BCG Menu Engineering Matrix (Stars, Plowhorses, Puzzles, Dogs).
 */
function getMenuEngineeringMatrix(acc, db) {
  ensureInventory(acc);
  const orders = (db.orders || []).filter((o) => ['paid', 'preparing', 'ready', 'dispatched', 'delivered', 'done'].includes(o.status));

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

  const eligibleMenuItems = menuItems.filter((sale) => (acc.recipes || []).some((recipe) => recipe.menuItemId === sale.menuItemId || recipe.name === sale.name));
  const items = eligibleMenuItems.map((s) => {
    const recipe = (acc.recipes || []).find((r) => r.menuItemId === s.menuItemId || r.name === s.name);
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
  ensureInventory(acc);
  const id = recipe.id || `rcp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const existing = acc.recipes.findIndex((r) => r.id === id);

  const totalCost = (recipe.ingredients || []).reduce((sum, ing) => {
    const item = acc.inventoryItems.find((i) => i.id === ing.itemId || i.sku === ing.itemId);
    const cost = item ? item.avgCost : toIRR(ing.unitCost || 0);
    return sum + Math.round(cost * Number(ing.qty || 0));
  }, 0);

  const sellingPrice = toIRR(recipe.sellingPrice || 0);
  const foodCostPercent = sellingPrice > 0 ? Number(((totalCost / sellingPrice) * 100).toFixed(1)) : 0;

  const rec = {
    ...recipe,
    id,
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
    const ingredients = (recipe.ingredients || []).map((ing) => {
      const invItem = acc.inventoryItems.find((i) => i.id === ing.itemId || i.sku === ing.itemId);
      const unitCost = invItem ? invItem.avgCost : Number(ing.unitCost || 0);
      const lineCost = Math.round(unitCost * Number(ing.qty || 0));
      return {
        ...ing,
        currentStock: invItem ? invItem.qtyOnHand : 0,
        unit: ing.unit || invItem?.unit || 'عدد',
        unitCost,
        lineCost,
      };
    });

    const totalCost = ingredients.reduce((sum, i) => sum + i.lineCost, 0);
    const sellingPrice = Number(recipe.sellingPrice || 0);
    const grossMargin = Math.max(0, sellingPrice - totalCost);
    const foodCostPercent = sellingPrice > 0 ? Number(((totalCost / sellingPrice) * 100).toFixed(1)) : 0;

    let healthStatus = 'STANDARD';
    if (foodCostPercent < 28) healthStatus = 'OPTIMAL';
    else if (foodCostPercent > 35) healthStatus = 'HIGH';

    return {
      id: recipe.id,
      name: recipe.name,
      category: recipe.category || 'عمومی',
      version: recipe.version || '1.0',
      yieldPercent: Number(recipe.yieldPercent || 95),
      sellingPrice,
      totalCost,
      grossMargin,
      foodCostPercent,
      healthStatus,
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
