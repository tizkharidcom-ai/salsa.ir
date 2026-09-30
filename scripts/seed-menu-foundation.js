'use strict';

/**
 * Rebuild the menu's culinary foundation without creating financial history.
 *
 * This is deliberately separate from seed-westo-culinary-ecosystem.js. The
 * older demo seeder creates a second branch and replaces fiscal periods; this
 * command only uses active branches, preserves all transactional collections,
 * and marks opening quantities/costs as estimates for testing.
 */

const fs = require('fs');
const path = require('path');
const { assertTestSeedAllowed } = require('./lib/test-seed-safety');
const {
  buildRecipeForMenuItem,
  MASTER_RAW_MATERIALS,
} = require('./seed-westo-culinary-ecosystem');

const DB_PATH = path.join(__dirname, '..', 'server', 'data', 'db.json');
const FOUNDATION_VERSION = 'menu-foundation-v2';
const ESTIMATE_NOTE = 'برآورد پایه برای تست؛ پس از ثبت فاکتور خرید با بهای واقعی جایگزین شود.';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function activeBranches(db) {
  return (Array.isArray(db.branches) ? db.branches : [])
    .filter((branch) => branch && branch.active !== false && Number.isSafeInteger(Number(branch.id)))
    .map((branch) => ({ ...branch, id: Number(branch.id) }));
}

function descriptionFor(item) {
  const name = String(item.name || '').trim();
  const normalized = name.toLowerCase();
  const categoryId = Number(item.categoryId);

  if (categoryId === 7561) return `${name}؛ پیش‌غذای تازهٔ وستو برای سرو اشتراکی و تک‌نفره.`;
  if (categoryId === 7599) {
    if (normalized.includes('soda')) return 'سودای گازدار خنک و تازه برای سرو سرد.';
    if (normalized.includes('ice cream')) return 'بستنی خنک و خامه‌ای برای پایان شیرین غذا.';
    return `${name}؛ نوشیدنی خنک و تازهٔ بار سرد وستو.`;
  }
  if (categoryId === 7675) {
    if (name === 'اسپرسو') return 'شات اسپرسو با دانهٔ قهوهٔ تازه‌آسیاب‌شده.';
    if (name === 'امریکنو') return 'اسپرسو با آب داغ؛ سبک و متعادل.';
    if (name === 'کورتادو') return 'اسپرسو با مقدار متعادل شیر گرم و بافت نرم.';
    if (name === 'کاپوچینو') return 'اسپرسو با شیر بخارداده‌شده و فوم لطیف.';
    if (name.includes('لاته')) return 'اسپرسو با شیر بخارداده‌شده و بافت خامه‌ای.';
    if (name.includes('موکا')) return 'ترکیب اسپرسو، شیر و شکلات تلخ با طعم متعادل.';
    if (name.includes('افوگاتو')) return 'بستنی وانیلی با شات اسپرسوی تازه.';
    if (name.includes('آیس')) return 'قهوهٔ سرد و تازه برای سرو روی یخ.';
    return `${name}؛ نوشیدنی قهوهٔ تازه‌دم بار وستو.`;
  }
  if (categoryId === 7701) {
    if (name.includes('ماسالا')) return 'چای ماسالا با شیر گرم و ادویه‌های معطر.';
    if (name.includes('شکلات')) return 'شکلات داغ غلیظ با شیر گرم و طعم شکلاتی.';
    if (name.includes('کرک')) return 'چای کرک با شیر گرم و عطر ادویه‌های ملایم.';
    return `${name}؛ نوشیدنی گرم بدون قهوهٔ بار وستو.`;
  }
  if (categoryId === 7676) {
    if (name.includes('دارچین')) return 'دمنوش گرم دارچین با عطر طبیعی و سرو تازه.';
    if (name.includes('زعفران')) return 'چای گرم زعفران و گل رز با عطر ملایم.';
    if (name.includes('سماغ')) return 'چای گرم سماق، آلبالو و عسل با طعم ملس.';
    if (name.includes('سیاه')) return 'چای سیاه ایرانی با دم‌آوری تازه.';
    return `${name}؛ دمنوش گرم و معطر با ترکیب اختصاصی وستو.`;
  }
  if (categoryId === 7697) return `${name}؛ دسر تازهٔ قنادی وستو با سرو مناسب همان روز.`;
  return `${name}؛ انتخابی از منوی وستو با مواد اولیهٔ ثبت‌شده و رسپی متصل.`;
}

function curateMenuDescriptions(menuItems) {
  let curatedCount = 0;
  for (const item of menuItems) {
    if (String(item.desc || '').trim()) continue;
    item.desc = descriptionFor(item);
    item.descriptionSource = 'curated-foundation-v1';
    curatedCount += 1;
  }
  return curatedCount;
}

function requirementForIngredient(ingredient, recipe) {
  const quantity = number(ingredient.quantity ?? ingredient.qty, 0);
  const portions = Math.max(number(recipe.portions ?? recipe.servings ?? 1, 1), 1);
  const yieldPercent = number(ingredient.yieldPercent ?? recipe.yieldPercent ?? 100, 100);
  if (quantity <= 0 || yieldPercent <= 0) return 0;
  const usableFactor = String(ingredient.quantityBasis || 'usable') === 'usable'
    ? yieldPercent / 100
    : 1;
  return quantity / portions / usableFactor;
}

function estimateRecipeCost(recipe, itemMap) {
  const totalCostIrr = recipe.ingredients.reduce((sum, ingredient) => {
    const item = itemMap.get(String(ingredient.itemId));
    if (!item) return sum;
    return sum + requirementForIngredient(ingredient, recipe) * number(item.unitCostIrr, 0);
  }, 0);
  return Math.max(0, Math.round(totalCostIrr));
}

function addQuarantineRecords(acc, orphanItems, asOf) {
  const existing = Array.isArray(acc.inventoryQuarantine) ? acc.inventoryQuarantine : [];
  const known = new Set(existing.map((entry) => `${entry.sourceId}:${entry.sourceBranchId}`));
  const additions = orphanItems
    .filter((item) => !known.has(`${item.id}:${item.branchId}`))
    .map((item) => ({
      id: `inventory-quarantine-${item.id}-${item.branchId}`,
      source: 'inventoryItems',
      sourceId: item.id,
      sourceBranchId: item.branchId,
      reason: 'branch_not_active',
      quarantinedAt: asOf,
      note: 'رکورد شعبهٔ غیرفعال/تعریف‌نشده؛ برای جلوگیری از اختلاط شعبه‌ها از موجودی فعال جدا شد.',
      record: clone(item),
    }));
  acc.inventoryQuarantine = [...existing, ...additions];
  return additions.length;
}

function prepareFoundation(inputDb, { asOf = new Date().toISOString() } = {}) {
  const db = clone(inputDb || {});
  if (!db.accounting || typeof db.accounting !== 'object') db.accounting = {};
  if (!db.financeV2 || typeof db.financeV2 !== 'object') db.financeV2 = {};

  const branches = activeBranches(db);
  if (!branches.length) throw new Error('برای آماده‌سازی منو حداقل یک شعبهٔ فعال لازم است.');
  const activeBranchIds = new Set(branches.map((branch) => branch.id));
  const targetBranchId = activeBranchIds.has(1) ? 1 : branches[0].id;
  const menuItems = Array.isArray(db.menuItems) ? db.menuItems : [];
  if (!menuItems.length) throw new Error('هیچ محصولی در منوی سایت پیدا نشد.');

  const curatedDescriptionCount = curateMenuDescriptions(menuItems);
  const recipes = menuItems.map((item) => buildRecipeForMenuItem(item));
  const requirements = new Map();
  for (const recipe of recipes) {
    for (const ingredient of recipe.ingredients) {
      const required = requirementForIngredient(ingredient, recipe);
      requirements.set(ingredient.itemId, (requirements.get(ingredient.itemId) || 0) + required * 100);
    }
  }

  const oldInventory = Array.isArray(db.accounting.inventoryItems) ? db.accounting.inventoryItems : [];
  const orphanItems = oldInventory.filter((item) => item.branchId != null && Number(item.branchId) !== Number(targetBranchId));
  const activeExistingItems = oldInventory.filter((item) => item.branchId == null || Number(item.branchId) === Number(targetBranchId));
  const generatedInventory = MASTER_RAW_MATERIALS.map((master) => {
    const required = requirements.get(master.id) || 0;
    const openingQuantity = Math.max(1, Math.ceil(required * 1.15), number(master.minStock) * 2);
    return {
      id: master.id,
      sku: master.sku,
      name: master.name,
      category: master.category,
      unit: master.unit,
      qtyOnHand: openingQuantity,
      avgCost: Math.round(master.unitCostIrr / 10),
      avgCostIrr: master.unitCostIrr,
      unitCostIrr: master.unitCostIrr,
      minStock: master.minStock,
      reorderPoint: master.minStock * 2,
      safetyStock: master.minStock,
      branchId: targetBranchId,
      conversions: [],
      costStatus: 'estimated',
      costSource: 'foundation-estimate-v1',
      costNote: ESTIMATE_NOTE,
      openingBalanceStatus: 'test_seed',
      openingBalanceNote: 'موجودی اولیهٔ تستی است و تا زمان ثبت خرید واقعی اثر مالی ندارد.',
      updatedAt: asOf,
    };
  });
  const masterIds = new Set(MASTER_RAW_MATERIALS.map((item) => item.id));
  const activeExtras = activeExistingItems.filter((item) => !masterIds.has(String(item.id)));
  const quarantineCount = addQuarantineRecords(db.accounting, orphanItems, asOf);
  db.accounting.inventoryItems = [...generatedInventory, ...activeExtras];

  const itemMap = new Map(generatedInventory.map((item) => [item.id, item]));
  const enrichedRecipes = recipes.map((recipe) => {
    const estimatedCostIrr = estimateRecipeCost(recipe, itemMap);
    return {
      ...recipe,
      costStatus: 'estimated',
      costSource: 'foundation-estimate-v1',
      estimatedCostIrr,
      estimatedCostToman: Math.round(estimatedCostIrr / 10),
      costNote: ESTIMATE_NOTE,
      effectiveFrom: '2026-01-01T00:00:00.000Z',
    };
  });

  db.accounting.recipes = enrichedRecipes;
  db.financeV2.recipeVersions = enrichedRecipes.map((recipe) => ({
    ...recipe,
    branchId: null,
    effectiveTo: null,
  }));
  db.menuRevision = Math.max(Date.now(), number(db.menuRevision, 0) + 1);
  db.menuFoundation = {
    version: FOUNDATION_VERSION,
    preparedAt: asOf,
    activeBranchIds: [...activeBranchIds],
    targetBranchId,
    menuItemCount: menuItems.length,
    recipeCount: enrichedRecipes.length,
    masterInventoryCount: generatedInventory.length,
    estimatedCostCount: generatedInventory.length,
    curatedDescriptionCount,
    quarantinedInventoryCount: quarantineCount,
    transactionalDataPreserved: true,
    financialEventsCreated: 0,
    note: 'این داده‌ها برای تست منو و اتصال رسپی/انبار هستند؛ تا زمان ثبت عملیات واقعی، سند مالی قطعی ساخته نمی‌شود.',
  };

  return {
    db,
    summary: {
      targetBranchId,
      activeBranchIds: [...activeBranchIds],
      menuItemCount: menuItems.length,
      recipeCount: enrichedRecipes.length,
      inventoryItemCount: generatedInventory.length,
      curatedDescriptionCount,
      quarantinedInventoryCount: quarantineCount,
      financialEventsCreated: 0,
    },
  };
}

function execute() {
  assertTestSeedAllowed({ scriptName: 'seed-menu-foundation' });
  const before = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  const backupPath = `${DB_PATH}.before-menu-foundation`;
  if (!fs.existsSync(backupPath)) fs.copyFileSync(DB_PATH, backupPath);
  const { db, summary } = prepareFoundation(before);
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf8');
  console.log(JSON.stringify({ dbPath: DB_PATH, backupPath, ...summary }, null, 2));
  return summary;
}

if (require.main === module) execute();

module.exports = {
  DB_PATH,
  ESTIMATE_NOTE,
  FOUNDATION_VERSION,
  curateMenuDescriptions,
  estimateRecipeCost,
  prepareFoundation,
};
