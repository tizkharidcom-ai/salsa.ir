'use strict';

/**
 * WESTO Culinary Ecosystem Seeder & Live Integration Engine
 * Generates:
 * 1. Master Raw & Packaging Inventory Items with realistic Iranian market costs.
 * 2. 146 Culinary-accurate BOM Recipes for all menu items.
 * 3. 100x Stock Inventory per Recipe Portion.
 * 4. Costing, Healthy Margins (30-35% Food Cost), and Live Deduction Hooks.
 */

const fs = require('fs');
const path = require('path');
const { assertTestSeedAllowed } = require('./lib/test-seed-safety');

const DB_PATH = path.join(__dirname, '..', 'server', 'data', 'db.json');

// ── Master Ingredient Catalog with Market Unit Costs (IRR) ─────────────
const MASTER_RAW_MATERIALS = [
  // ── Proteins ──────────────────────────────────────────────
  { id: 'item-beef-tenderloin', sku: 'RAW-BEEF-01', name: 'فیله گوساله گرم تازه', unit: 'kg', category: 'raw_meat', unitCostIrr: 12000000, minStock: 20 },
  { id: 'item-beef-minced', sku: 'RAW-BEEF-02', name: 'گوشت چرخ‌کرده مخلوط برگر', unit: 'kg', category: 'raw_meat', unitCostIrr: 7000000, minStock: 30 },
  { id: 'item-chicken-breast', sku: 'RAW-CHICK-01', name: 'سینه مرغ بدون استخوان', unit: 'kg', category: 'raw_meat', unitCostIrr: 2500000, minStock: 40 },
  { id: 'item-chicken-wings', sku: 'RAW-CHICK-02', name: 'بال و بازوی مرغ تازه', unit: 'kg', category: 'raw_meat', unitCostIrr: 1400000, minStock: 20 },
  { id: 'item-shrimp', sku: 'RAW-SEA-01', name: 'میگو پاک‌شده خلیج فارس', unit: 'kg', category: 'raw_seafood', unitCostIrr: 9500000, minStock: 15 },
  { id: 'item-salmon', sku: 'RAW-SEA-02', name: 'فیله سالمون نروژی تازه', unit: 'kg', category: 'raw_seafood', unitCostIrr: 16000000, minStock: 10 },
  { id: 'item-crab-stick', sku: 'RAW-SEA-03', name: 'کرب استیک ژاپنی', unit: 'kg', category: 'raw_seafood', unitCostIrr: 6500000, minStock: 10 },
  { id: 'item-smoked-salmon', sku: 'RAW-SEA-04', name: 'سالمون دودی اسلایس', unit: 'kg', category: 'raw_seafood', unitCostIrr: 18000000, minStock: 8 },
  { id: 'item-pepperoni', sku: 'RAW-DELI-01', name: 'پپرونی گوشت ۹۰٪ اعلا', unit: 'kg', category: 'raw_meat', unitCostIrr: 5500000, minStock: 15 },
  { id: 'item-bacon', sku: 'RAW-DELI-02', name: 'بیکن گوشت دودی', unit: 'kg', category: 'raw_meat', unitCostIrr: 6800000, minStock: 15 },

  // ── Dairy & Cheeses ────────────────────────────────────────
  { id: 'item-cheese-mozzarella', sku: 'DAIRY-CH-01', name: 'پنیر موزارلا تازه ناپولی', unit: 'kg', category: 'dairy', unitCostIrr: 3800000, minStock: 30 },
  { id: 'item-cheese-parmesan', sku: 'DAIRY-CH-02', name: 'پنیر پارمزان ریجانو رنده', unit: 'kg', category: 'dairy', unitCostIrr: 8500000, minStock: 10 },
  { id: 'item-cheese-cream', sku: 'DAIRY-CH-03', name: 'پنیر خامه‌ای فیلادلفیا', unit: 'kg', category: 'dairy', unitCostIrr: 3200000, minStock: 15 },
  { id: 'item-cheese-cheddar', sku: 'DAIRY-CH-04', name: 'پنیر چدار ورقه‌ای', unit: 'kg', category: 'dairy', unitCostIrr: 4200000, minStock: 15 },
  { id: 'item-cheese-kouzeh', sku: 'DAIRY-CH-05', name: 'پنیر کوزه سنتی تبریز', unit: 'kg', category: 'dairy', unitCostIrr: 4800000, minStock: 10 },
  { id: 'item-cooking-cream', sku: 'DAIRY-CR-01', name: 'خامه آشپزی ۳۵٪', unit: 'kg', category: 'dairy', unitCostIrr: 1800000, minStock: 25 },
  { id: 'item-fresh-milk', sku: 'DAIRY-MK-01', name: 'شیر پرچرب تازه پاستوریزه', unit: 'l', category: 'dairy', unitCostIrr: 450000, minStock: 50 },
  { id: 'item-coconut-milk', sku: 'DAIRY-MK-02', name: 'شیر نارگیل غلیظ', unit: 'l', category: 'dairy', unitCostIrr: 1900000, minStock: 15 },
  { id: 'item-butter', sku: 'DAIRY-BT-01', name: 'کره حیوانی ۸۲٪', unit: 'kg', category: 'dairy', unitCostIrr: 4000000, minStock: 20 },
  { id: 'item-ice-cream-vanilla', sku: 'DAIRY-IC-01', name: 'بستنی وانیلی دست‌ساز', unit: 'kg', category: 'dairy', unitCostIrr: 1600000, minStock: 20 },
  { id: 'item-ice-cream-choc', sku: 'DAIRY-IC-02', name: 'بستنی دابل چاکلت', unit: 'kg', category: 'dairy', unitCostIrr: 1900000, minStock: 20 },
  { id: 'item-kashk', sku: 'DAIRY-KSH-01', name: 'کشک سنتی غلیظ', unit: 'kg', category: 'dairy', unitCostIrr: 900000, minStock: 10 },

  // ── Bakery & Grains ────────────────────────────────────────
  { id: 'item-bun-brioche', sku: 'BAKE-BN-01', name: 'نان بریوش کره فرانسوی', unit: 'count', category: 'bakery', unitCostIrr: 350000, minStock: 100 },
  { id: 'item-flour-pizza', sku: 'BAKE-FL-01', name: 'آرد ۰۰ پیتزا ناپولی', unit: 'kg', category: 'bakery', unitCostIrr: 650000, minStock: 50 },
  { id: 'item-pasta-rigatoni', sku: 'BAKE-PAST-01', name: 'پاستا ریگاتونی سمیولینا', unit: 'kg', category: 'bakery', unitCostIrr: 1200000, minStock: 30 },
  { id: 'item-taco-shell', sku: 'BAKE-TAC-01', name: 'نان تاکو ذرت برشته', unit: 'count', category: 'bakery', unitCostIrr: 250000, minStock: 80 },
  { id: 'item-tortilla', sku: 'BAKE-TOR-01', name: 'نان تورتیا مکزیکی', unit: 'count', category: 'bakery', unitCostIrr: 200000, minStock: 80 },
  { id: 'item-rice-sushi', sku: 'GRAIN-RICE-01', name: 'برنج سوشی ژاپنی دانه گرد', unit: 'kg', category: 'grains', unitCostIrr: 1800000, minStock: 40 },
  { id: 'item-croutons', sku: 'BAKE-CR-01', name: 'نان کروتون برشته سیر', unit: 'kg', category: 'bakery', unitCostIrr: 1100000, minStock: 15 },
  { id: 'item-quinoa', sku: 'GRAIN-QN-01', name: 'کینوا ارگانیک سه رنگ', unit: 'kg', category: 'grains', unitCostIrr: 3500000, minStock: 10 },
  { id: 'item-french-fries', sku: 'VEG-FF-01', name: 'سیب‌زمینی نیمه‌آماده فرایز', unit: 'kg', category: 'vegetables', unitCostIrr: 950000, minStock: 60 },

  // ── Fresh Vegetables & Produce ─────────────────────────────
  { id: 'item-lettuce-iceberg', sku: 'PROD-LET-01', name: 'کاهو پیچ سالادی تازه', unit: 'kg', category: 'produce', unitCostIrr: 350000, minStock: 30 },
  { id: 'item-lettuce-littlegem', sku: 'PROD-LET-02', name: 'کاهو لیتل جم فرانسوی', unit: 'kg', category: 'produce', unitCostIrr: 750000, minStock: 20 },
  { id: 'item-kale', sku: 'PROD-KL-01', name: 'کلم کیل تازه', unit: 'kg', category: 'produce', unitCostIrr: 1200000, minStock: 10 },
  { id: 'item-avocado', sku: 'PROD-AV-01', name: 'آووکادو هاس وارداتی', unit: 'kg', category: 'produce', unitCostIrr: 4500000, minStock: 15 },
  { id: 'item-tomato-cherry', sku: 'PROD-TOM-01', name: 'گوجه گیلاسی هیدروپونیک', unit: 'kg', category: 'produce', unitCostIrr: 650000, minStock: 20 },
  { id: 'item-tomato-sundried', sku: 'PROD-TOM-02', name: 'گوجه خشک مزه‌دار در روغن', unit: 'kg', category: 'produce', unitCostIrr: 2800000, minStock: 10 },
  { id: 'item-mushroom', sku: 'PROD-MSH-01', name: 'قارچ دکمه‌ای سفید تازه', unit: 'kg', category: 'produce', unitCostIrr: 850000, minStock: 25 },
  { id: 'item-strawberry', sku: 'PROD-STR-01', name: 'توت‌فرنگی تازه گلخانه‌ای', unit: 'kg', category: 'produce', unitCostIrr: 1600000, minStock: 15 },
  { id: 'item-fresh-lemon', sku: 'PROD-LEM-01', name: 'لیموترش سنگی تازه', unit: 'kg', category: 'produce', unitCostIrr: 700000, minStock: 25 },
  { id: 'item-fresh-mint', sku: 'PROD-MNT-01', name: 'نعنا تازه معطر', unit: 'kg', category: 'produce', unitCostIrr: 550000, minStock: 15 },
  { id: 'item-fresh-basil', sku: 'PROD-BSL-01', name: 'ریحان ایتالیایی تازه', unit: 'kg', category: 'produce', unitCostIrr: 950000, minStock: 15 },
  { id: 'item-eggplant', sku: 'PROD-EGG-01', name: 'بادمجان قلمی تازه', unit: 'kg', category: 'produce', unitCostIrr: 350000, minStock: 20 },
  { id: 'item-cauliflower', sku: 'PROD-CAUL-01', name: 'گل کلم تازه', unit: 'kg', category: 'produce', unitCostIrr: 300000, minStock: 15 },
  { id: 'item-sweet-corn', sku: 'PROD-CRN-01', name: 'ذرت شیرین تازه', unit: 'kg', category: 'produce', unitCostIrr: 600000, minStock: 20 },
  { id: 'item-cucumber', sku: 'PROD-CUC-01', name: 'خیار بوته‌ای تازه', unit: 'kg', category: 'produce', unitCostIrr: 400000, minStock: 20 },
  { id: 'item-carrot', sku: 'PROD-CAR-01', name: 'هویج تازه شسته‌شده', unit: 'kg', category: 'produce', unitCostIrr: 250000, minStock: 25 },
  { id: 'item-potato', sku: 'PROD-POT-01', name: 'سیب‌زمینی آگریا مخصوص پوره', unit: 'kg', category: 'produce', unitCostIrr: 300000, minStock: 40 },
  { id: 'item-cabbage-red', sku: 'PROD-CAB-01', name: 'کلم قرمز سالادی', unit: 'kg', category: 'produce', unitCostIrr: 250000, minStock: 15 },
  { id: 'item-onion-red', sku: 'PROD-ON-01', name: 'پیاز قرمز سالادی', unit: 'kg', category: 'produce', unitCostIrr: 350000, minStock: 20 },
  { id: 'item-onion-yellow', sku: 'PROD-ON-02', name: 'پیاز زرد کاراملی', unit: 'kg', category: 'produce', unitCostIrr: 250000, minStock: 30 },
  { id: 'item-garlic', sku: 'PROD-GAR-01', name: 'سیر تازه پاک‌شده', unit: 'kg', category: 'produce', unitCostIrr: 900000, minStock: 15 },

  // ── Sauces, Oils & Seasonings ──────────────────────────────
  { id: 'item-oil-olive', sku: 'SAUCE-OL-01', name: 'روغن زیتون فرابکر', unit: 'l', category: 'condiments', unitCostIrr: 4500000, minStock: 20 },
  { id: 'item-oil-frying', sku: 'SAUCE-FRY-01', name: 'روغن مخصوص سرخ‌کردن', unit: 'l', category: 'condiments', unitCostIrr: 950000, minStock: 50 },
  { id: 'item-sauce-caesar', sku: 'SAUCE-CSR-01', name: 'سس سزار اورجینال آنچوی', unit: 'kg', category: 'prep', unitCostIrr: 2400000, minStock: 15 },
  { id: 'item-sauce-truffle', sku: 'SAUCE-TRF-01', name: 'سس مایونز ترافل سیاه', unit: 'kg', category: 'prep', unitCostIrr: 3800000, minStock: 10 },
  { id: 'item-sauce-burger', sku: 'SAUCE-BRG-01', name: 'سس برگر دست‌ساز وستو', unit: 'kg', category: 'prep', unitCostIrr: 1900000, minStock: 20 },
  { id: 'item-sauce-teriyaki', sku: 'SAUCE-TRK-01', name: 'سس تریاکی غلیظ ژاپنی', unit: 'l', category: 'condiments', unitCostIrr: 2900000, minStock: 10 },
  { id: 'item-sauce-satay', sku: 'SAUCE-SAT-01', name: 'سس ساتای بادام‌زمینی', unit: 'kg', category: 'prep', unitCostIrr: 3200000, minStock: 10 },
  { id: 'item-sauce-dynamite', sku: 'SAUCE-DYN-01', name: 'سس داینامیت واسابی تند', unit: 'kg', category: 'prep', unitCostIrr: 3600000, minStock: 10 },
  { id: 'item-sauce-pomodoro', sku: 'SAUCE-POM-01', name: 'سس پومودورو گوجه سن‌مارزانو', unit: 'kg', category: 'prep', unitCostIrr: 1400000, minStock: 25 },
  { id: 'item-glaze-balsamic', sku: 'SAUCE-BAL-01', name: 'سرکه بالزامیک کرمی مودنا', unit: 'l', category: 'condiments', unitCostIrr: 3900000, minStock: 8 },
  { id: 'item-sauce-tamarind', sku: 'SAUCE-TAM-01', name: 'سس تمبرهندی اعلا', unit: 'kg', category: 'prep', unitCostIrr: 1800000, minStock: 10 },
  { id: 'item-tahini', sku: 'SAUCE-TAH-01', name: 'ارده خالص کنجد اردکان', unit: 'kg', category: 'condiments', unitCostIrr: 2200000, minStock: 10 },
  { id: 'item-capers', sku: 'SAUCE-CAP-01', name: 'کاپاریس ایتالیایی ترش', unit: 'kg', category: 'condiments', unitCostIrr: 4500000, minStock: 5 },
  { id: 'item-nori-sheets', sku: 'SEA-NORI-01', name: 'جلبک نوری سوشی طلایی', unit: 'count', category: 'raw_seafood', unitCostIrr: 150000, minStock: 100 },
  { id: 'item-tobiko', sku: 'SEA-TOB-01', name: 'توبیکو خاویار پرنده', unit: 'kg', category: 'raw_seafood', unitCostIrr: 12000000, minStock: 5 },
  { id: 'item-cashews', sku: 'NUT-CSH-01', name: 'بادام هندی خام درشت', unit: 'kg', category: 'nuts', unitCostIrr: 9800000, minStock: 10 },
  { id: 'item-walnuts', sku: 'NUT-WLN-01', name: 'مغز گردو تویسرکان اعلا', unit: 'kg', category: 'nuts', unitCostIrr: 6800000, minStock: 10 },
  { id: 'item-pistachio-paste', sku: 'NUT-PST-01', name: 'کرم پسته ۱۰۰٪ رفسنجان', unit: 'kg', category: 'nuts', unitCostIrr: 14000000, minStock: 10 },
  { id: 'item-peanut-butter', sku: 'NUT-PN-01', name: 'کره بادام‌زمینی خالص', unit: 'kg', category: 'nuts', unitCostIrr: 2800000, minStock: 10 },
  { id: 'item-saffron', sku: 'SPICE-SAF-01', name: 'زعفران سوپر نگین قائنات', unit: 'g', category: 'spices', unitCostIrr: 1200000, minStock: 50 },

  // ── Coffee, Tea, Matcha & Beverage Basics ───────────────────
  { id: 'item-coffee-beans', sku: 'BAR-COF-01', name: 'دان قهوه تخصصی ۱۰۰٪ عربیکا کلمبیا', unit: 'kg', category: 'beverages', unitCostIrr: 8500000, minStock: 30 },
  { id: 'item-matcha', sku: 'BAR-MTC-01', name: 'پودر ماچا تشریفاتی ژاپن', unit: 'kg', category: 'beverages', unitCostIrr: 28000000, minStock: 5 },
  { id: 'item-vanilla-extract', sku: 'BAR-VAN-01', name: 'عصاره وانیل طبیعی ماداگاسکار', unit: 'l', category: 'beverages', unitCostIrr: 19000000, minStock: 5 },
  { id: 'item-chocolate-dark', sku: 'BAR-CHOC-01', name: 'شکلات بلژیکی ۷۰٪ کالیبائو', unit: 'kg', category: 'beverages', unitCostIrr: 6500000, minStock: 15 },
  { id: 'item-cocoa-powder', sku: 'BAR-COC-01', name: 'پودر کاکائو بنسدورپ هلند', unit: 'kg', category: 'beverages', unitCostIrr: 4500000, minStock: 15 },
  { id: 'item-chai-masala', sku: 'BAR-MAS-01', name: 'ادویه چای ماسالا هندی', unit: 'kg', category: 'beverages', unitCostIrr: 4800000, minStock: 10 },
  { id: 'item-tea-black', sku: 'BAR-TEA-01', name: 'چای سیاه بهاره سرگل لاهیجان', unit: 'kg', category: 'beverages', unitCostIrr: 3800000, minStock: 20 },
  { id: 'item-tea-herbal-blend', sku: 'BAR-HRB-01', name: 'مخلوط گیاهی دمنوش معطر', unit: 'kg', category: 'beverages', unitCostIrr: 4200000, minStock: 15 },
  { id: 'item-soda-water', sku: 'BAR-SODA-01', name: 'سودا گازدار تصفیه‌شده', unit: 'l', category: 'beverages', unitCostIrr: 180000, minStock: 100 },
  { id: 'item-puree-fruit', sku: 'BAR-PUR-01', name: 'پوره طبیعی میوه‌های استوایی و توت', unit: 'kg', category: 'beverages', unitCostIrr: 2800000, minStock: 25 },
  { id: 'item-syrup-sweet-sour', sku: 'BAR-SYR-01', name: 'سیروپ سوئیت اند ساور بار', unit: 'l', category: 'beverages', unitCostIrr: 1100000, minStock: 20 },
  { id: 'item-syrup-caramel', sku: 'BAR-SYR-02', name: 'سیروپ کارامل تخصصی بار', unit: 'l', category: 'beverages', unitCostIrr: 2900000, minStock: 15 },

  // ── Packaging & Consumables ─────────────────────────────────
  { id: 'item-box-takeaway', sku: 'PKG-BOX-01', name: 'جعبه غذای بیرون‌بر کرافت لوکس', unit: 'count', category: 'packaging', unitCostIrr: 250000, minStock: 500 },
  { id: 'item-box-burger', sku: 'PKG-BRG-01', name: 'جعبه برگر کرافت فودگرید', unit: 'count', category: 'packaging', unitCostIrr: 150000, minStock: 500 },
  { id: 'item-cup-cold', sku: 'PKG-CUP-01', name: 'لیوان نوشیدنی سرد + درب و نی', unit: 'count', category: 'packaging', unitCostIrr: 180000, minStock: 500 },
  { id: 'item-cup-hot', sku: 'PKG-CUP-02', name: 'لیوان نوشیدنی گرم دوجداره + درب', unit: 'count', category: 'packaging', unitCostIrr: 150000, minStock: 500 },
  { id: 'item-cutlery-set', sku: 'PKG-CUT-01', name: 'پک کارد و چنگال بامبو و دستمال', unit: 'count', category: 'packaging', unitCostIrr: 120000, minStock: 500 },
];

/**
 * Builds a culinary recipe tailored to the specific category and description of a menu item.
 */
function buildRecipeForMenuItem(menuItem) {
  const name = String(menuItem.name || '').toLowerCase();
  const desc = String(menuItem.desc || '').toLowerCase();
  const catId = Number(menuItem.categoryId);
  const ingredients = [];

  // Categorization Rules based on menu hierarchy and descriptions:
  if (catId === 7560) { // سالاد (Salads)
    ingredients.push({ itemId: 'item-lettuce-iceberg', name: 'کاهو سالادی', quantity: 0.12, unit: 'kg', quantityBasis: 'usable', yieldPercent: 90 });
    if (desc.includes('مرغ') || name.includes('چیکن') || desc.includes('سینه')) {
      ingredients.push({ itemId: 'item-chicken-breast', name: 'سینه مرغ گریل', quantity: 0.14, unit: 'kg', quantityBasis: 'usable', yieldPercent: 85 });
    }
    if (desc.includes('آووکادو') || name.includes('آووکادو')) {
      ingredients.push({ itemId: 'item-avocado', name: 'آووکادو هاس', quantity: 0.06, unit: 'kg', quantityBasis: 'usable', yieldPercent: 80 });
    }
    if (desc.includes('میگو') || name.includes('شریمپ')) {
      ingredients.push({ itemId: 'item-shrimp', name: 'میگو پاک‌شده', quantity: 0.10, unit: 'kg', quantityBasis: 'usable', yieldPercent: 90 });
    }
    if (desc.includes('کرب') || name.includes('کرب')) {
      ingredients.push({ itemId: 'item-crab-stick', name: 'کرب استیک', quantity: 0.08, unit: 'kg', quantityBasis: 'usable', yieldPercent: 95 });
    }
    if (desc.includes('پارمزان') || desc.includes('سزار')) {
      ingredients.push({ itemId: 'item-cheese-parmesan', name: 'پنیر پارمزان', quantity: 0.025, unit: 'kg', quantityBasis: 'usable', yieldPercent: 100 });
      ingredients.push({ itemId: 'item-croutons', name: 'نان کروتون', quantity: 0.03, unit: 'kg', quantityBasis: 'usable', yieldPercent: 100 });
      ingredients.push({ itemId: 'item-sauce-caesar', name: 'سس سزار دست‌ساز', quantity: 0.05, unit: 'kg', quantityBasis: 'usable', yieldPercent: 100 });
    } else if (desc.includes('ساتای')) {
      ingredients.push({ itemId: 'item-sauce-satay', name: 'سس ساتای', quantity: 0.05, unit: 'kg', quantityBasis: 'usable', yieldPercent: 100 });
      ingredients.push({ itemId: 'item-cashews', name: 'بادام هندی', quantity: 0.025, unit: 'kg', quantityBasis: 'usable', yieldPercent: 100 });
    } else if (desc.includes('توت فرنگی') || desc.includes('استرابری')) {
      ingredients.push({ itemId: 'item-strawberry', name: 'توت‌فرنگی تازه', quantity: 0.06, unit: 'kg', quantityBasis: 'usable', yieldPercent: 95 });
      ingredients.push({ itemId: 'item-cheese-kouzeh', name: 'پنیر کوزه', quantity: 0.03, unit: 'kg', quantityBasis: 'usable', yieldPercent: 100 });
      ingredients.push({ itemId: 'item-walnuts', name: 'مغز گردو', quantity: 0.02, unit: 'kg', quantityBasis: 'usable', yieldPercent: 100 });
    } else {
      ingredients.push({ itemId: 'item-tomato-cherry', name: 'گوجه چری', quantity: 0.04, unit: 'kg', quantityBasis: 'usable', yieldPercent: 95 });
      ingredients.push({ itemId: 'item-oil-olive', name: 'روغن زیتون فرابکر', quantity: 0.025, unit: 'l', quantityBasis: 'usable', yieldPercent: 100 });
    }
  } else if (catId === 7561) { // پیش غذا (Appetizers)
    if (desc.includes('میگو') || name.includes('شریمپ')) {
      ingredients.push({ itemId: 'item-shrimp', name: 'میگو تازه', quantity: 0.13, unit: 'kg', quantityBasis: 'usable', yieldPercent: 90 });
      ingredients.push({ itemId: 'item-sauce-dynamite', name: 'سس داینامیت واسابی', quantity: 0.04, unit: 'kg', quantityBasis: 'usable', yieldPercent: 100 });
      ingredients.push({ itemId: 'item-potato', name: 'سیب‌زمینی پوره', quantity: 0.10, unit: 'kg', quantityBasis: 'usable', yieldPercent: 85 });
    } else if (desc.includes('بیف') || desc.includes('گوساله')) {
      ingredients.push({ itemId: 'item-beef-tenderloin', name: 'فیله گوساله', quantity: 0.14, unit: 'kg', quantityBasis: 'usable', yieldPercent: 90 });
      ingredients.push({ itemId: 'item-sauce-teriyaki', name: 'سس تریاکی', quantity: 0.04, unit: 'l', quantityBasis: 'usable', yieldPercent: 100 });
    } else if (desc.includes('بال') || desc.includes('لالیپاپ') || desc.includes('وینگز')) {
      ingredients.push({ itemId: 'item-chicken-wings', name: 'بال مرغ', quantity: 0.25, unit: 'kg', quantityBasis: 'usable', yieldPercent: 80 });
      ingredients.push({ itemId: 'item-oil-frying', name: 'روغن سرخ‌کردنی', quantity: 0.05, unit: 'l', quantityBasis: 'usable', yieldPercent: 100 });
    } else if (desc.includes('حمص') || desc.includes('مزه')) {
      ingredients.push({ itemId: 'item-tahini', name: 'ارده کنجد', quantity: 0.06, unit: 'kg', quantityBasis: 'usable', yieldPercent: 100 });
      ingredients.push({ itemId: 'item-oil-olive', name: 'روغن زیتون', quantity: 0.03, unit: 'l', quantityBasis: 'usable', yieldPercent: 100 });
      ingredients.push({ itemId: 'item-eggplant', name: 'بادمجان', quantity: 0.12, unit: 'kg', quantityBasis: 'usable', yieldPercent: 85 });
    } else {
      ingredients.push({ itemId: 'item-chicken-breast', name: 'سینه مرغ', quantity: 0.12, unit: 'kg', quantityBasis: 'usable', yieldPercent: 85 });
      ingredients.push({ itemId: 'item-french-fries', name: 'سیب‌زمینی فرایز', quantity: 0.15, unit: 'kg', quantityBasis: 'usable', yieldPercent: 95 });
    }
  } else if (catId === 17007) { // تاکو (Tacos)
    ingredients.push({ itemId: 'item-taco-shell', name: 'نان تاکو', quantity: 3, unit: 'count', quantityBasis: 'usable', yieldPercent: 100 });
    if (desc.includes('میگو') || name.includes('شریمپ')) {
      ingredients.push({ itemId: 'item-shrimp', name: 'میگو گریل', quantity: 0.12, unit: 'kg', quantityBasis: 'usable', yieldPercent: 90 });
    } else if (desc.includes('بیف') || desc.includes('گوشت')) {
      ingredients.push({ itemId: 'item-beef-tenderloin', name: 'فیله گوساله ریش‌ریش', quantity: 0.13, unit: 'kg', quantityBasis: 'usable', yieldPercent: 90 });
    } else {
      ingredients.push({ itemId: 'item-chicken-breast', name: 'مرغ گریل مزه‌دار', quantity: 0.13, unit: 'kg', quantityBasis: 'usable', yieldPercent: 85 });
    }
    ingredients.push({ itemId: 'item-avocado', name: 'گوآکاموله آووکادو', quantity: 0.04, unit: 'kg', quantityBasis: 'usable', yieldPercent: 80 });
    ingredients.push({ itemId: 'item-cheese-cheddar', name: 'پنیر چدار', quantity: 0.03, unit: 'kg', quantityBasis: 'usable', yieldPercent: 100 });
  } else if (catId === 7562) { // پاستا (Pasta)
    ingredients.push({ itemId: 'item-pasta-rigatoni', name: 'پاستا ریگاتونی', quantity: 0.13, unit: 'kg', quantityBasis: 'usable', yieldPercent: 100 });
    ingredients.push({ itemId: 'item-cooking-cream', name: 'خامه پخت و پز', quantity: 0.08, unit: 'kg', quantityBasis: 'usable', yieldPercent: 100 });
    ingredients.push({ itemId: 'item-cheese-parmesan', name: 'پنیر پارمزان', quantity: 0.03, unit: 'kg', quantityBasis: 'usable', yieldPercent: 100 });
    ingredients.push({ itemId: 'item-mushroom', name: 'قارچ تازه', quantity: 0.06, unit: 'kg', quantityBasis: 'usable', yieldPercent: 95 });
    if (desc.includes('بیف') || desc.includes('گوشت') || name.includes('بیف')) {
      ingredients.push({ itemId: 'item-beef-tenderloin', name: 'فیله گوساله اسلایس', quantity: 0.14, unit: 'kg', quantityBasis: 'usable', yieldPercent: 90 });
    } else {
      ingredients.push({ itemId: 'item-chicken-breast', name: 'سینه مرغ گریل آلفردو', quantity: 0.14, unit: 'kg', quantityBasis: 'usable', yieldPercent: 85 });
    }
  } else if (catId === 7563) { // برگر (Burgers)
    ingredients.push({ itemId: 'item-bun-brioche', name: 'نان بریوش دست‌ساز', quantity: 1, unit: 'count', quantityBasis: 'usable', yieldPercent: 100 });
    ingredients.push({ itemId: 'item-beef-minced', name: 'پتی برگر گوشت خالص', quantity: 0.18, unit: 'kg', quantityBasis: 'usable', yieldPercent: 85 });
    ingredients.push({ itemId: 'item-cheese-cheddar', name: 'پنیر چدار آب‌شده', quantity: 0.035, unit: 'kg', quantityBasis: 'usable', yieldPercent: 100 });
    ingredients.push({ itemId: 'item-sauce-burger', name: 'سس مخصوص برگر', quantity: 0.035, unit: 'kg', quantityBasis: 'usable', yieldPercent: 100 });
    ingredients.push({ itemId: 'item-french-fries', name: 'فرایز کنار برگر', quantity: 0.15, unit: 'kg', quantityBasis: 'usable', yieldPercent: 95 });
    ingredients.push({ itemId: 'item-box-burger', name: 'جعبه بسته‌بندی برگر', quantity: 1, unit: 'count', quantityBasis: 'usable', yieldPercent: 100 });
    if (desc.includes('بیکن') || name.includes('بیکن')) {
      ingredients.push({ itemId: 'item-bacon', name: 'بیکن گوساله کریسپی', quantity: 0.04, unit: 'kg', quantityBasis: 'usable', yieldPercent: 90 });
    }
    if (desc.includes('ترافل') || name.includes('ترافل')) {
      ingredients.push({ itemId: 'item-sauce-truffle', name: 'سس ترافل', quantity: 0.025, unit: 'kg', quantityBasis: 'usable', yieldPercent: 100 });
    }
  } else if (catId === 7564) { // غذای اصلی (Main Courses)
    if (desc.includes('سالمون') || name.includes('سالمون')) {
      ingredients.push({ itemId: 'item-salmon', name: 'فیله سالمون نروژی', quantity: 0.22, unit: 'kg', quantityBasis: 'usable', yieldPercent: 90 });
      ingredients.push({ itemId: 'item-potato', name: 'پوره سیب‌زمینی کره', quantity: 0.15, unit: 'kg', quantityBasis: 'usable', yieldPercent: 85 });
      ingredients.push({ itemId: 'item-oil-olive', name: 'روغن زیتون', quantity: 0.02, unit: 'l', quantityBasis: 'usable', yieldPercent: 100 });
    } else if (desc.includes('مرغ') || name.includes('چیکن')) {
      ingredients.push({ itemId: 'item-chicken-breast', name: 'شنسل / فیله مرغ اعلا', quantity: 0.24, unit: 'kg', quantityBasis: 'usable', yieldPercent: 85 });
      ingredients.push({ itemId: 'item-potato', name: 'سیب‌زمینی رست', quantity: 0.15, unit: 'kg', quantityBasis: 'usable', yieldPercent: 85 });
    } else {
      ingredients.push({ itemId: 'item-beef-tenderloin', name: 'استیک فیله مینیون', quantity: 0.25, unit: 'kg', quantityBasis: 'usable', yieldPercent: 90 });
      ingredients.push({ itemId: 'item-butter', name: 'کره طعم‌دار گیاهی', quantity: 0.03, unit: 'kg', quantityBasis: 'usable', yieldPercent: 100 });
      ingredients.push({ itemId: 'item-potato', name: 'پوره سیب‌زمینی ترافل', quantity: 0.15, unit: 'kg', quantityBasis: 'usable', yieldPercent: 85 });
    }
  } else if (catId === 7566) { // پیتزا (Pizza)
    ingredients.push({ itemId: 'item-flour-pizza', name: 'خمیر ناپولی تنوری', quantity: 0.22, unit: 'kg', quantityBasis: 'usable', yieldPercent: 100 });
    ingredients.push({ itemId: 'item-sauce-pomodoro', name: 'سس پومودورو ناپولی', quantity: 0.07, unit: 'kg', quantityBasis: 'usable', yieldPercent: 100 });
    ingredients.push({ itemId: 'item-cheese-mozzarella', name: 'پنیر موزارلا قالبی', quantity: 0.15, unit: 'kg', quantityBasis: 'usable', yieldPercent: 100 });
    if (desc.includes('پپرونی') || name.includes('پپرونی')) {
      ingredients.push({ itemId: 'item-pepperoni', name: 'پپرونی تند', quantity: 0.09, unit: 'kg', quantityBasis: 'usable', yieldPercent: 100 });
    } else if (desc.includes('مرغ') || desc.includes('اسفناج')) {
      ingredients.push({ itemId: 'item-chicken-breast', name: 'شنسل مرغ تکه‌ای', quantity: 0.10, unit: 'kg', quantityBasis: 'usable', yieldPercent: 85 });
      ingredients.push({ itemId: 'item-mushroom', name: 'قارچ بلانچ', quantity: 0.05, unit: 'kg', quantityBasis: 'usable', yieldPercent: 95 });
    } else if (desc.includes('سیر') || desc.includes('استیک')) {
      ingredients.push({ itemId: 'item-beef-tenderloin', name: 'فیله استیک ورقه‌ای', quantity: 0.11, unit: 'kg', quantityBasis: 'usable', yieldPercent: 90 });
    } else {
      ingredients.push({ itemId: 'item-mushroom', name: 'قارچ تازه اسلایس', quantity: 0.08, unit: 'kg', quantityBasis: 'usable', yieldPercent: 95 });
    }
  } else if (catId === 13581) { // سوشی (Sushi Rolls & Nigiri)
    ingredients.push({ itemId: 'item-rice-sushi', name: 'برنج سوشی سرکه‌زده', quantity: 0.14, unit: 'kg', quantityBasis: 'usable', yieldPercent: 100 });
    ingredients.push({ itemId: 'item-nori-sheets', name: 'جلبک نوری ژاپنی', quantity: 1, unit: 'count', quantityBasis: 'usable', yieldPercent: 100 });
    if (desc.includes('سالمون') || desc.includes('سلمن')) {
      ingredients.push({ itemId: 'item-salmon', name: 'سالمون تازه ساشیمی', quantity: 0.08, unit: 'kg', quantityBasis: 'usable', yieldPercent: 95 });
    } else if (desc.includes('شریمپ') || desc.includes('میگو')) {
      ingredients.push({ itemId: 'item-shrimp', name: 'میگو تمپورا سوشی', quantity: 0.08, unit: 'kg', quantityBasis: 'usable', yieldPercent: 90 });
    } else {
      ingredients.push({ itemId: 'item-crab-stick', name: 'کرب استیک کریسپی', quantity: 0.07, unit: 'kg', quantityBasis: 'usable', yieldPercent: 100 });
    }
    ingredients.push({ itemId: 'item-avocado', name: 'آووکادو اسلایس', quantity: 0.035, unit: 'kg', quantityBasis: 'usable', yieldPercent: 80 });
    ingredients.push({ itemId: 'item-cheese-cream', name: 'پنیر فیلادلفیا', quantity: 0.025, unit: 'kg', quantityBasis: 'usable', yieldPercent: 100 });
    ingredients.push({ itemId: 'item-tobiko', name: 'توبیکو خاویار پرنده', quantity: 0.015, unit: 'kg', quantityBasis: 'usable', yieldPercent: 100 });
  } else if (catId === 7567) { // وجترین (Vegetarian)
    if (desc.includes('کشک') || desc.includes('بادمجان')) {
      ingredients.push({ itemId: 'item-eggplant', name: 'بادمجان کبابی', quantity: 0.25, unit: 'kg', quantityBasis: 'usable', yieldPercent: 85 });
      ingredients.push({ itemId: 'item-kashk', name: 'کشک سنتی غلیظ', quantity: 0.06, unit: 'kg', quantityBasis: 'usable', yieldPercent: 100 });
      ingredients.push({ itemId: 'item-walnuts', name: 'گردو خردشده', quantity: 0.025, unit: 'kg', quantityBasis: 'usable', yieldPercent: 100 });
    } else if (desc.includes('گل کلم') || desc.includes('فلاور')) {
      ingredients.push({ itemId: 'item-cauliflower', name: 'گل کلم تمپورا', quantity: 0.25, unit: 'kg', quantityBasis: 'usable', yieldPercent: 90 });
      ingredients.push({ itemId: 'item-sauce-dynamite', name: 'سس داینامیت واسابی', quantity: 0.05, unit: 'kg', quantityBasis: 'usable', yieldPercent: 100 });
    } else {
      ingredients.push({ itemId: 'item-sweet-corn', name: 'ذرت شیرین باربیکیو', quantity: 0.25, unit: 'kg', quantityBasis: 'usable', yieldPercent: 90 });
      ingredients.push({ itemId: 'item-sauce-burger', name: 'دیپ چیلی مایونز', quantity: 0.04, unit: 'kg', quantityBasis: 'usable', yieldPercent: 100 });
    }
  } else if (catId === 7599) { // بار سرد (Cold Bar & Mocktails & Shakes)
    if (desc.includes('شیک') || name.includes('شیک') || name.includes('shake')) {
      ingredients.push({ itemId: 'item-ice-cream-vanilla', name: 'بستنی وانیلی', quantity: 0.18, unit: 'kg', quantityBasis: 'usable', yieldPercent: 100 });
      ingredients.push({ itemId: 'item-fresh-milk', name: 'شیر پرچرب', quantity: 0.10, unit: 'l', quantityBasis: 'usable', yieldPercent: 100 });
      if (desc.includes('پسته') || name.includes('پرشین')) {
        ingredients.push({ itemId: 'item-pistachio-paste', name: 'کرم پسته خالص', quantity: 0.03, unit: 'kg', quantityBasis: 'usable', yieldPercent: 100 });
        ingredients.push({ itemId: 'item-saffron', name: 'عصاره زعفران', quantity: 0.05, unit: 'g', quantityBasis: 'usable', yieldPercent: 100 });
      } else if (desc.includes('شکلات') || name.includes('شکلات')) {
        ingredients.push({ itemId: 'item-chocolate-dark', name: 'شکلات بلژیکی ۷۰٪', quantity: 0.03, unit: 'kg', quantityBasis: 'usable', yieldPercent: 100 });
      }
    } else if (desc.includes('موهیتو') || name.includes('mojito')) {
      ingredients.push({ itemId: 'item-fresh-lemon', name: 'لیموترش تازه', quantity: 0.06, unit: 'kg', quantityBasis: 'usable', yieldPercent: 90 });
      ingredients.push({ itemId: 'item-fresh-mint', name: 'نعنا تازه معطر', quantity: 0.02, unit: 'kg', quantityBasis: 'usable', yieldPercent: 90 });
      ingredients.push({ itemId: 'item-syrup-sweet-sour', name: 'سیروپ بار', quantity: 0.03, unit: 'l', quantityBasis: 'usable', yieldPercent: 100 });
      ingredients.push({ itemId: 'item-soda-water', name: 'سودا گازدار', quantity: 0.22, unit: 'l', quantityBasis: 'usable', yieldPercent: 100 });
    } else {
      ingredients.push({ itemId: 'item-puree-fruit', name: 'پوره طبیعی میوه', quantity: 0.09, unit: 'kg', quantityBasis: 'usable', yieldPercent: 100 });
      ingredients.push({ itemId: 'item-soda-water', name: 'سودا گازدار', quantity: 0.20, unit: 'l', quantityBasis: 'usable', yieldPercent: 100 });
      ingredients.push({ itemId: 'item-fresh-lemon', name: 'عصاره لیمو تازه', quantity: 0.03, unit: 'kg', quantityBasis: 'usable', yieldPercent: 90 });
    }
    ingredients.push({ itemId: 'item-cup-cold', name: 'لیوان بیرون‌بر بار', quantity: 1, unit: 'count', quantityBasis: 'usable', yieldPercent: 100 });
  } else if (catId === 14477) { // ماچا بار (Matcha Bar)
    ingredients.push({ itemId: 'item-matcha', name: 'پودر ماچا تشریفاتی ژاپن', quantity: 0.005, unit: 'kg', quantityBasis: 'usable', yieldPercent: 100 }); // 5g
    if (desc.includes('نارگیل') || name.includes('نارگیل')) {
      ingredients.push({ itemId: 'item-coconut-milk', name: 'شیر نارگیل غلیظ', quantity: 0.20, unit: 'l', quantityBasis: 'usable', yieldPercent: 100 });
    } else if (desc.includes('شیک') || name.includes('شیک')) {
      ingredients.push({ itemId: 'item-ice-cream-vanilla', name: 'بستنی وانیلی', quantity: 0.15, unit: 'kg', quantityBasis: 'usable', yieldPercent: 100 });
      ingredients.push({ itemId: 'item-fresh-milk', name: 'شیر پرچرب', quantity: 0.08, unit: 'l', quantityBasis: 'usable', yieldPercent: 100 });
    } else {
      ingredients.push({ itemId: 'item-fresh-milk', name: 'شیر پرچرب فوم‌دار', quantity: 0.22, unit: 'l', quantityBasis: 'usable', yieldPercent: 100 });
    }
    ingredients.push({ itemId: 'item-cup-hot', name: 'لیوان ماچا', quantity: 1, unit: 'count', quantityBasis: 'usable', yieldPercent: 100 });
  } else if (catId === 7675) { // کافئین / قهوه تخصصی (Espresso & Specialty Coffee)
    ingredients.push({ itemId: 'item-coffee-beans', name: 'دان قهوه تخصصی ۱۰۰٪ عربیکا', quantity: 0.018, unit: 'kg', quantityBasis: 'usable', yieldPercent: 100 }); // 18g double shot
    if (name.includes('لاته') || name.includes('کاپوچینو') || name.includes('کورتادو') || name.includes('موکا') || name.includes('latte')) {
      ingredients.push({ itemId: 'item-fresh-milk', name: 'شیر تازه بخاردهی‌شده', quantity: 0.20, unit: 'l', quantityBasis: 'usable', yieldPercent: 100 });
    }
    if (name.includes('کارامل') || desc.includes('کارامل')) {
      ingredients.push({ itemId: 'item-syrup-caramel', name: 'سیروپ کارامل', quantity: 0.02, unit: 'l', quantityBasis: 'usable', yieldPercent: 100 });
    }
    if (name.includes('زعفران') || desc.includes('زعفران')) {
      ingredients.push({ itemId: 'item-saffron', name: 'عصاره زعفران قائنات', quantity: 0.05, unit: 'g', quantityBasis: 'usable', yieldPercent: 100 });
    }
    if (name.includes('موکا') || desc.includes('شکلات')) {
      ingredients.push({ itemId: 'item-chocolate-dark', name: 'شکلات بن‌ماری', quantity: 0.025, unit: 'kg', quantityBasis: 'usable', yieldPercent: 100 });
    }
    if (name.includes('آیس') || name.includes('ice')) {
      ingredients.push({ itemId: 'item-cup-cold', name: 'لیوان آیس کافی', quantity: 1, unit: 'count', quantityBasis: 'usable', yieldPercent: 100 });
    } else {
      ingredients.push({ itemId: 'item-cup-hot', name: 'لیوان هات کافی', quantity: 1, unit: 'count', quantityBasis: 'usable', yieldPercent: 100 });
    }
  } else if (catId === 7701) { // نات کافئین (Hot Chocolate, Masala, Karak)
    if (name.includes('ماسالا') || desc.includes('ماسالا')) {
      ingredients.push({ itemId: 'item-chai-masala', name: 'پودر ماسالا هندی', quantity: 0.025, unit: 'kg', quantityBasis: 'usable', yieldPercent: 100 });
      ingredients.push({ itemId: 'item-fresh-milk', name: 'شیر پرچرب', quantity: 0.20, unit: 'l', quantityBasis: 'usable', yieldPercent: 100 });
    } else if (name.includes('کرک')) {
      ingredients.push({ itemId: 'item-tea-black', name: 'عصاره چای سیاه لاهیجان', quantity: 0.01, unit: 'kg', quantityBasis: 'usable', yieldPercent: 100 });
      ingredients.push({ itemId: 'item-fresh-milk', name: 'شیر هل و دارچین', quantity: 0.20, unit: 'l', quantityBasis: 'usable', yieldPercent: 100 });
    } else {
      ingredients.push({ itemId: 'item-chocolate-dark', name: 'شکلات بلژیکی غلیظ', quantity: 0.04, unit: 'kg', quantityBasis: 'usable', yieldPercent: 100 });
      ingredients.push({ itemId: 'item-fresh-milk', name: 'شیر پرچرب', quantity: 0.18, unit: 'l', quantityBasis: 'usable', yieldPercent: 100 });
    }
    ingredients.push({ itemId: 'item-cup-hot', name: 'لیوان سرو', quantity: 1, unit: 'count', quantityBasis: 'usable', yieldPercent: 100 });
  } else if (catId === 7676) { // هربال تی و دمنوش‌ها (Herbal Tea)
    if (name.includes('سیاه') || desc.includes('سیاه')) {
      ingredients.push({ itemId: 'item-tea-black', name: 'چای سیاه سرگل لاهیجان', quantity: 0.015, unit: 'kg', quantityBasis: 'usable', yieldPercent: 100 });
    } else {
      ingredients.push({ itemId: 'item-tea-herbal-blend', name: 'ترکیب گیاهی دمنوش اعلا', quantity: 0.015, unit: 'kg', quantityBasis: 'usable', yieldPercent: 100 });
    }
    if (name.includes('زعفران') || desc.includes('زعفران')) {
      ingredients.push({ itemId: 'item-saffron', name: 'زعفران نگین', quantity: 0.05, unit: 'g', quantityBasis: 'usable', yieldPercent: 100 });
    }
    ingredients.push({ itemId: 'item-cup-hot', name: 'لیوان دمنوش', quantity: 1, unit: 'count', quantityBasis: 'usable', yieldPercent: 100 });
  } else if (catId === 7697) { // پیستری و کیک‌ها (Pastry & Desserts)
    ingredients.push({ itemId: 'item-cooking-cream', name: 'خامه قنادی غلیظ', quantity: 0.08, unit: 'kg', quantityBasis: 'usable', yieldPercent: 100 });
    ingredients.push({ itemId: 'item-flour-pizza', name: 'آرد قنادی اعلا', quantity: 0.06, unit: 'kg', quantityBasis: 'usable', yieldPercent: 100 });
    ingredients.push({ itemId: 'item-butter', name: 'کره قنادی حیوانی', quantity: 0.03, unit: 'kg', quantityBasis: 'usable', yieldPercent: 100 });
    if (name.includes('تیرامیسو') || desc.includes('تیرامیسو')) {
      ingredients.push({ itemId: 'item-cheese-cream', name: 'پنیر ماسکارپونه/خامه‌ای', quantity: 0.06, unit: 'kg', quantityBasis: 'usable', yieldPercent: 100 });
      ingredients.push({ itemId: 'item-coffee-beans', name: 'عصاره اسپرسو کلمبیا', quantity: 0.01, unit: 'kg', quantityBasis: 'usable', yieldPercent: 100 });
      ingredients.push({ itemId: 'item-cocoa-powder', name: 'پودر کاکائو هلندی', quantity: 0.01, unit: 'kg', quantityBasis: 'usable', yieldPercent: 100 });
    } else if (name.includes('شکلات') || desc.includes('شکلات')) {
      ingredients.push({ itemId: 'item-chocolate-dark', name: 'گاناش شکلات بلژیکی', quantity: 0.05, unit: 'kg', quantityBasis: 'usable', yieldPercent: 100 });
    } else if (name.includes('باقلوا') || desc.includes('باقلوا')) {
      ingredients.push({ itemId: 'item-pistachio-paste', name: 'مغز پسته اعلا', quantity: 0.015, unit: 'kg', quantityBasis: 'usable', yieldPercent: 100 });
    }
  } else { // سایر و خدمات ویژه (Special Services & Combo)
    ingredients.push({ itemId: 'item-tea-black', name: 'سرویس چای سرگل لاهیجان', quantity: 0.03, unit: 'kg', quantityBasis: 'usable', yieldPercent: 100 });
    ingredients.push({ itemId: 'item-walnuts', name: 'خرما و گردو اعلا', quantity: 0.05, unit: 'kg', quantityBasis: 'usable', yieldPercent: 100 });
    ingredients.push({ itemId: 'item-pistachio-paste', name: 'باقلوا پسته استانبولی', quantity: 0.06, unit: 'kg', quantityBasis: 'usable', yieldPercent: 100 });
  }

  // Always add takeaway/packaging set if missing
  if (!ingredients.some((ing) => ing.itemId.startsWith('item-box') || ing.itemId.startsWith('item-cup'))) {
    ingredients.push({ itemId: 'item-box-takeaway', name: 'بسته‌بندی استاندارد رستوران', quantity: 1, unit: 'count', quantityBasis: 'usable', yieldPercent: 100 });
  }

  return {
    id: `recipe-item-${menuItem.id}`,
    menuItemId: menuItem.id,
    name: `رسپی رسمی ${menuItem.name}`,
    category: menuItem.categoryId,
    version: 1,
    portions: 1,
    yieldQuantity: 1,
    yieldPercent: 95,
    status: 'approved',
    ingredients,
    notes: `دستور تهیه مهندسی‌شده برای ${menuItem.name} — منطبق بر استانداردهای آشپزخانه وستو`,
    createdAt: new Date().toISOString(),
  };
}

function executeSeeding() {
  assertTestSeedAllowed({ scriptName: 'seed-westo-culinary-ecosystem' });
  console.log('Reading database from', DB_PATH);
  const rawDb = fs.readFileSync(DB_PATH, 'utf8');
  const db = JSON.parse(rawDb);

  if (!db.accounting) db.accounting = {};
  if (!db.financeV2) db.financeV2 = {};

  const acc = db.accounting;
  const menuItems = Array.isArray(db.menuItems) ? db.menuItems : [];
  console.log(`Found ${menuItems.length} menu items.`);

  // 1. Generate Recipes for all 146 menu items
  const generatedRecipes = menuItems.map(buildRecipeForMenuItem);
  console.log(`Generated ${generatedRecipes.length} BOM recipes.`);
  acc.recipes = generatedRecipes;

  // Mirror in financeV2.recipeVersions for V2 compatibility
  db.financeV2.recipeVersions = generatedRecipes.map((r) => ({
    ...r,
    branchId: null, // Shared across all branches
    effectiveFrom: '2026-01-01T00:00:00.000Z',
    effectiveTo: null,
  }));

  // 2. Compute 100x Required Stock for Every Ingredient Across the Entire Menu
  const totalRequirementMap = new Map();

  for (const recipe of generatedRecipes) {
    for (const ing of recipe.ingredients) {
      const required100x = (Number(ing.quantity) || 0) * 100;
      const current = totalRequirementMap.get(ing.itemId) || 0;
      totalRequirementMap.set(ing.itemId, current + required100x);
    }
  }

  console.log(`Calculated 100x stock requirements across ${totalRequirementMap.size} distinct raw ingredients.`);

  // 3. Initialize Inventory Items with 100x Stock Levels + Safety Margins
  const inventoryItems = MASTER_RAW_MATERIALS.map((master) => {
    const required = totalRequirementMap.get(master.id) || 0;
    // Provide 100x requirement plus safety stock
    const calculatedQty = Math.ceil(required * 1.15) || master.minStock * 5;
    const finalQty = Math.max(calculatedQty, master.minStock * 2);

    return {
      id: master.id,
      sku: master.sku,
      name: master.name,
      category: master.category,
      unit: master.unit,
      qtyOnHand: finalQty,
      avgCost: Math.round(master.unitCostIrr / 10), // Toman for legacy compat
      avgCostIrr: master.unitCostIrr,
      unitCostIrr: master.unitCostIrr,
      minStock: master.minStock,
      reorderPoint: master.minStock * 2,
      safetyStock: master.minStock,
      branchId: 1, // Branch 1 (Main)
      conversions: [],
      lastPurchaseDate: new Date().toISOString(),
    };
  });

  // Also replicate for Branch 2 with appropriate stock
  const branch2Items = MASTER_RAW_MATERIALS.map((master) => {
    const required = totalRequirementMap.get(master.id) || 0;
    const calculatedQty = Math.ceil(required * 0.75) || master.minStock * 3;
    return {
      id: `${master.id}-b2`,
      sku: `${master.sku}-B2`,
      name: `${master.name} (شعبه دوم)`,
      category: master.category,
      unit: master.unit,
      qtyOnHand: calculatedQty,
      avgCost: Math.round(master.unitCostIrr / 10),
      avgCostIrr: master.unitCostIrr,
      unitCostIrr: master.unitCostIrr,
      minStock: master.minStock,
      reorderPoint: master.minStock * 2,
      safetyStock: master.minStock,
      branchId: 2,
      conversions: [],
      lastPurchaseDate: new Date().toISOString(),
    };
  });

  acc.inventoryItems = [...inventoryItems, ...branch2Items];
  console.log(`Total inventory items seeded across branches: ${acc.inventoryItems.length}`);

  // Seed 12 Complete Monthly Fiscal Periods for Year 1405 (2026-2027)
  acc.fiscalPeriods = [
    { id: 'p-1', name: 'فروردین ۱۴۰۵', startDate: '2026-03-21', endDate: '2026-04-20', status: 'open' },
    { id: 'p-2', name: 'اردیبهشت ۱۴۰۵', startDate: '2026-04-21', endDate: '2026-05-21', status: 'open' },
    { id: 'p-3', name: 'خرداد ۱۴۰۵', startDate: '2026-05-22', endDate: '2026-06-21', status: 'open' },
    { id: 'p-4', name: 'تیر ۱۴۰۵', startDate: '2026-06-22', endDate: '2026-07-22', status: 'open' },
    { id: 'p-5', name: 'مرداد ۱۴۰۵', startDate: '2026-07-23', endDate: '2026-08-22', status: 'open' },
    { id: 'p-6', name: 'شهریور ۱۴۰۵', startDate: '2026-08-23', endDate: '2026-09-22', status: 'open' },
    { id: 'p-7', name: 'مهر ۱۴۰۵', startDate: '2026-09-23', endDate: '2026-10-22', status: 'open' },
    { id: 'p-8', name: 'آبان ۱۴۰۵', startDate: '2026-10-23', endDate: '2026-11-21', status: 'open' },
    { id: 'p-9', name: 'آذر ۱۴۰۵', startDate: '2026-11-22', endDate: '2026-12-21', status: 'open' },
    { id: 'p-10', name: 'دی ۱۴۰۵', startDate: '2026-12-22', endDate: '2027-01-20', status: 'open' },
    { id: 'p-11', name: 'بهمن ۱۴۰۵', startDate: '2027-01-21', endDate: '2027-02-19', status: 'open' },
    { id: 'p-12', name: 'اسفند ۱۴۰۵', startDate: '2027-02-20', endDate: '2027-03-20', status: 'open' },
  ];

  // 4. Calculate total inventory valuation
  const totalValuationIrr = acc.inventoryItems.reduce((sum, item) => sum + (item.qtyOnHand * item.avgCostIrr), 0);
  console.log(`Total Stock Valuation: ${(totalValuationIrr / 10).toLocaleString()} Tomans (${totalValuationIrr.toLocaleString()} IRR)`);

  // 5. Verify Food Cost & 100%+ Profit Margins across all menu items
  const itemMap = new Map(inventoryItems.map((i) => [i.id, i]));
  const marginStats = [];

  for (const recipe of generatedRecipes) {
    const menuItem = menuItems.find((m) => m.id === recipe.menuItemId);
    if (!menuItem) continue;

    let foodCostIrr = 0;
    for (const ing of recipe.ingredients) {
      const item = itemMap.get(ing.itemId);
      const cost = item ? item.avgCostIrr : 0;
      foodCostIrr += (Number(ing.quantity) || 0) * cost;
    }

    const sellingPriceIrr = Number(menuItem.price) * 10; // Toman to IRR
    const grossProfitIrr = sellingPriceIrr - foodCostIrr;
    const foodCostPct = sellingPriceIrr > 0 ? (foodCostIrr / sellingPriceIrr) * 100 : 0;
    const markupPct = foodCostIrr > 0 ? (grossProfitIrr / foodCostIrr) * 100 : 0;

    marginStats.push({
      id: menuItem.id,
      name: menuItem.name,
      priceToman: menuItem.price,
      foodCostToman: Math.round(foodCostIrr / 10),
      grossProfitToman: Math.round(grossProfitIrr / 10),
      foodCostPct: Number(foodCostPct.toFixed(1)),
      markupPct: Number(markupPct.toFixed(1)),
    });
  }

  const avgFoodCostPct = marginStats.reduce((s, x) => s + x.foodCostPct, 0) / marginStats.length;
  const avgMarkupPct = marginStats.reduce((s, x) => s + x.markupPct, 0) / marginStats.length;

  console.log(`\n=== Financial Economics Summary ===`);
  console.log(`Average Food Cost: ${avgFoodCostPct.toFixed(1)}% (Gold-Standard Range: 25-35%)`);
  console.log(`Average Markup on Cost: ${avgMarkupPct.toFixed(1)}% (Target: >= 100%)`);
  console.log(`Sample Menu Costing:`, marginStats.slice(0, 5));

  // 6. Write back to db.json
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf8');
  console.log(`Successfully updated database at ${DB_PATH}.`);

  return {
    recipeCount: generatedRecipes.length,
    inventoryItemCount: acc.inventoryItems.length,
    totalValuationIrr,
    avgFoodCostPct,
    avgMarkupPct,
  };
}

if (require.main === module) {
  executeSeeding();
}

module.exports = { executeSeeding, buildRecipeForMenuItem, MASTER_RAW_MATERIALS };
