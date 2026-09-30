'use strict';

const fs = require('fs');
const path = require('path');
const { assertTestSeedAllowed } = require('./lib/test-seed-safety');

const DB_PATH = path.join(__dirname, '..', 'server', 'data', 'db.json');

function seedEcosystemMaster() {
  assertTestSeedAllowed({ scriptName: 'seed-ecosystem-master' });
  console.log('[seed] Loading db.json from', DB_PATH);
  const raw = fs.readFileSync(DB_PATH, 'utf8');
  const db = JSON.parse(raw);

  const acc = db.accounting = db.accounting || {};
  const items = acc.inventoryItems = acc.inventoryItems || [];
  const recipes = acc.recipes = acc.recipes || [];
  const menuItems = db.menuItems = db.menuItems || [];

  console.log(`[seed] Found ${menuItems.length} menu items, ${recipes.length} recipes, ${items.length} inventory items.`);

  // 1. Calculate required quantities for at least 20 portions of every recipe
  const totalRequired = {};
  recipes.forEach((r) => {
    (r.ingredients || []).forEach((ing) => {
      const id = String(ing.itemId || '');
      if (!id) return;
      const qty = (Number(ing.quantity || 0) * 20);
      totalRequired[id] = (totalRequired[id] || 0) + qty;
    });
  });

  console.log(`[seed] ${Object.keys(totalRequired).length} unique raw materials are consumed by recipes.`);

  // 2. Charge inventory stock (qtyOnHand) to comfortably exceed 20 portions
  let totalStockValuationIrr = 0;
  items.forEach((it) => {
    const req = totalRequired[it.id] || 0;
    const stock = req > 0
      ? Math.max(150, Math.ceil(req * 3))
      : Math.max(80, Math.ceil((it.safetyStock || 20) * 4));

    it.qtyOnHand = stock;
    it.onHand = stock;
    it.quantity = stock;
    it.availableQuantity = stock;
    it.minStock = Math.max(15, Math.round(stock * 0.15));
    it.safetyStock = Math.max(10, Math.round(stock * 0.10));
    it.reorderPoint = Math.max(25, Math.round(stock * 0.25));
    it.active = true;

    const unitCost = Number(it.unitCostIrr || it.avgCostIrr || (it.avgCost * 10) || 500000);
    it.unitCostIrr = unitCost;
    it.avgCostIrr = unitCost;
    it.avgCost = Math.round(unitCost / 10);
    totalStockValuationIrr += (stock * unitCost);
  });

  console.log(`[seed] Total inventory stock value: ${Math.round(totalStockValuationIrr / 10).toLocaleString('fa-IR')} Toman.`);

  // 3. Make sure all menu items have stock and are available
  menuItems.forEach((m) => {
    m.stock = 100;
    m.available = true;
    m.status = 'active';
  });

  // 4. Map and group all inventory items by category
  const itemsByCat = {};
  items.forEach((it) => {
    const cat = it.category || 'other';
    itemsByCat[cat] = itemsByCat[cat] || [];
    itemsByCat[cat].push(it.id);
  });

  // 5. Define 9 Comprehensive & Specialized Vendors
  const now = new Date().toISOString();
  const definedVendors = [
    {
      id: 'vendor-spot',
      name: 'خرید آزاد / بازار روز',
      nameFa: 'خرید آزاد / بازار روز',
      phone: '09121110000',
      contactPerson: 'مسئول خرید روزانه',
      category: 'آزاد',
      termsDays: 0,
      branchId: null,
      isSpot: true,
      balance: 0,
      notes: 'خریدهای نقدی و متفرقه روزانه از تره‌بار، سوپرمارکت و بازار محلی',
      active: true,
      createdAt: now,
      itemIds: [
        'item-fresh-milk',
        'item-cooking-cream',
        'item-lettuce-iceberg',
        'item-tomato-cherry',
        'item-onion-red',
        'item-fresh-lemon',
        'item-fresh-mint',
        'item-garlic',
        'item-potato',
        'item-butter',
      ].filter((id) => items.some((i) => i.id === id)),
    },
    {
      id: 'v-dairy',
      name: 'شرکت لبنیات پگاه و میهن',
      nameFa: 'شرکت لبنیات پگاه و میهن',
      phone: '02188776655',
      contactPerson: 'مهندس کمالی (نماینده پخش)',
      category: 'لبنیات',
      termsDays: 30,
      branchId: 1,
      isSpot: false,
      balance: 45000000,
      notes: 'ارسال شنبه‌ها و سه‌شنبه‌ها ساعت ۷ صبح با ماشین یخچال‌دار',
      active: true,
      createdAt: now,
      itemIds: itemsByCat['dairy'] || [],
    },
    {
      id: 'v-meat',
      name: 'مجتمع پروتئینی مهیا و سامین',
      nameFa: 'مجتمع پروتئینی مهیا و سامین',
      phone: '02166554433',
      contactPerson: 'حاج رضا تقوی',
      category: 'گوشت و پروتئین',
      termsDays: 15,
      branchId: 1,
      isSpot: false,
      balance: 120000000,
      notes: 'گوشت گرم کشتار روز با فاکتور رسمی و دامپزشکی',
      active: true,
      createdAt: now,
      itemIds: itemsByCat['raw_meat'] || [],
    },
    {
      id: 'v-seafood',
      name: 'بازرگانی شیلات خلیج فارس',
      nameFa: 'بازرگانی شیلات خلیج فارس',
      phone: '07633221100',
      contactPerson: 'ناخدا احمدی',
      category: 'گوشت و پروتئین',
      termsDays: 7,
      branchId: 1,
      isSpot: false,
      balance: 38000000,
      notes: 'صید روز بندرعباس، بسته‌بندی در یخ خشک',
      active: true,
      createdAt: now,
      itemIds: itemsByCat['raw_seafood'] || [],
    },
    {
      id: 'v-bakery',
      name: 'نان و شیرینی ارگانیک فرانسه',
      nameFa: 'نان و شیرینی ارگانیک فرانسه',
      phone: '02122334455',
      contactPerson: 'خانم رضوانی',
      category: 'نان و آرد',
      termsDays: 15,
      branchId: 1,
      isSpot: false,
      balance: 18500000,
      notes: 'نان‌های بریوش، خمیر پیتزا ناپولی و نان تست روزانه',
      active: true,
      createdAt: now,
      itemIds: [...(itemsByCat['bakery'] || []), ...(itemsByCat['grains'] || [])],
    },
    {
      id: 'v-produce',
      name: 'میدان مرکزی میوه و تره‌بار صبا',
      nameFa: 'میدان مرکزی میوه و تره‌بار صبا',
      phone: '02155443322',
      contactPerson: 'آقای صبوری (غرفه ۲۴)',
      category: 'سبزیجات و میوه',
      termsDays: 10,
      branchId: 1,
      isSpot: false,
      balance: 24000000,
      notes: 'سبزیجات دست‌چین، آووکادو، گوجه گیلاسی و قارچ دکمه‌ای',
      active: true,
      createdAt: now,
      itemIds: [...(itemsByCat['produce'] || []), ...(itemsByCat['vegetables'] || [])],
    },
    {
      id: 'v-beverage',
      name: 'بازرگانی دانه‌گستر قهوه و بار سرد',
      nameFa: 'بازرگانی دانه‌گستر قهوه و بار سرد',
      phone: '02188990011',
      contactPerson: 'مهندس پرهام آریا',
      category: 'خشکبار و قهوه',
      termsDays: 30,
      branchId: 1,
      isSpot: false,
      balance: 62000000,
      notes: 'دانه‌های تخصصی ۱۰۰٪ عربیکا کلمبیا و اتیوپی، سیروپ‌های فرانسوی',
      active: true,
      createdAt: now,
      itemIds: [...(itemsByCat['beverages'] || []), ...(itemsByCat['nuts'] || [])],
    },
    {
      id: 'v-packaging',
      name: 'صنایع بسته‌بندی کرافت نوین',
      nameFa: 'صنایع بسته‌بندی کرافت نوین',
      phone: '02144556677',
      contactPerson: 'آقای شریفی',
      category: 'بسته‌بندی و مصرفی',
      termsDays: 45,
      branchId: 1,
      isSpot: false,
      balance: 29000000,
      notes: 'جعبه‌های فودگرید بهداشتی، لیوان‌های دوجداره بیرون‌بر',
      active: true,
      createdAt: now,
      itemIds: itemsByCat['packaging'] || [],
    },
    {
      id: 'v-condiments',
      name: 'بازرگانی ادویه و چاشنی پارس',
      nameFa: 'بازرگانی ادویه و چاشنی پارس',
      phone: '02133445566',
      contactPerson: 'حاج محمود کریمی',
      category: 'عمومی',
      termsDays: 30,
      branchId: 1,
      isSpot: false,
      balance: 14000000,
      notes: 'روغن زیتون فرابکر، بالزامیک مودنا، ادویه‌جات ارگانیک',
      active: true,
      createdAt: now,
      itemIds: [...(itemsByCat['condiments'] || []), ...(itemsByCat['spices'] || []), ...(itemsByCat['prep'] || [])],
    },
  ];

  acc.vendors = definedVendors;
  const allCovered = new Set(acc.vendors.flatMap((v) => v.itemIds || []));
  const spotVendor = acc.vendors.find((v) => v.id === 'vendor-spot' || v.isSpot);
  if (spotVendor) {
    items.forEach((it) => {
      if (!allCovered.has(it.id)) {
        spotVendor.itemIds.push(it.id);
        allCovered.add(it.id);
      }
    });
  }
  console.log(`[seed] Configured ${acc.vendors.length} vendors with 100% item coverage.`);

  // 6. Sub-recipes for 5 Production Batches (linking valid ingredient IDs to output prep items)
  const subRecipes = [
    {
      id: 'recipe-sub-pomodoro',
      name: 'دستور تهیه پخت دسته سس پومودورو گوجه سن‌مارزانو',
      outputItemId: 'item-sauce-pomodoro',
      status: 'approved',
      version: 1,
      branchId: null,
      yieldQuantity: 15,
      yieldPercent: 95,
      portions: 15,
      ingredients: [
        { itemId: 'item-tomato-cherry', name: 'گوجه تازه پخته‌شده', quantity: 0.8, unit: 'kg', yieldPercent: 90 },
        { itemId: 'item-oil-olive', name: 'روغن زیتون فرابکر', quantity: 0.1, unit: 'l', yieldPercent: 100 },
        { itemId: 'item-onion-red', name: 'پیاز کاراملی تفت‌خورده', quantity: 0.06, unit: 'kg', yieldPercent: 85 },
        { itemId: 'item-garlic', name: 'سیر تازه داغ‌شده', quantity: 0.03, unit: 'kg', yieldPercent: 90 },
      ],
    },
    {
      id: 'recipe-sub-caesar',
      name: 'دستور تهیه تولید دسته سس سزار اورجینال آنچوی',
      outputItemId: 'item-sauce-caesar',
      status: 'approved',
      version: 1,
      branchId: null,
      yieldQuantity: 10,
      yieldPercent: 100,
      portions: 10,
      ingredients: [
        { itemId: 'item-oil-olive', name: 'روغن زیتون فرابکر', quantity: 0.35, unit: 'l', yieldPercent: 100 },
        { itemId: 'item-cheese-parmesan', name: 'پنیر پارمزان رنده', quantity: 0.2, unit: 'kg', yieldPercent: 100 },
        { itemId: 'item-fresh-lemon', name: 'آب لیمو ترش تازه', quantity: 0.15, unit: 'kg', yieldPercent: 95 },
        { itemId: 'item-garlic', name: 'سیر تازه رنده‌شده', quantity: 0.1, unit: 'kg', yieldPercent: 90 },
      ],
    },
    {
      id: 'recipe-sub-truffle',
      name: 'دستور تهیه ترکیب دسته سس مایونز ترافل سیاه',
      outputItemId: 'item-sauce-truffle',
      status: 'approved',
      version: 1,
      branchId: null,
      yieldQuantity: 8,
      yieldPercent: 100,
      portions: 8,
      ingredients: [
        { itemId: 'item-cooking-cream', name: 'خامه آشپزی ۳۵٪', quantity: 0.6, unit: 'kg', yieldPercent: 100 },
        { itemId: 'item-oil-olive', name: 'روغن زیتون معطر', quantity: 0.1, unit: 'l', yieldPercent: 100 },
        { itemId: 'item-butter', name: 'کره حیوانی ۸۲٪', quantity: 0.1, unit: 'kg', yieldPercent: 100 },
        { itemId: 'item-garlic', name: 'سیر تازه داغ‌شده', quantity: 0.05, unit: 'kg', yieldPercent: 90 },
      ],
    },
    {
      id: 'recipe-sub-burger',
      name: 'دستور تهیه تولید دسته سس برگر دست‌ساز وستو',
      outputItemId: 'item-sauce-burger',
      status: 'approved',
      version: 1,
      branchId: null,
      yieldQuantity: 10,
      yieldPercent: 100,
      portions: 10,
      ingredients: [
        { itemId: 'item-cooking-cream', name: 'خامه آشپزی', quantity: 0.5, unit: 'kg', yieldPercent: 100 },
        { itemId: 'item-glaze-balsamic', name: 'سرکه بالزامیک کرمی', quantity: 0.1, unit: 'l', yieldPercent: 100 },
        { itemId: 'item-cucumber', name: 'خیار بوته‌ای رنده‌شده', quantity: 0.15, unit: 'kg', yieldPercent: 90 },
        { itemId: 'item-onion-red', name: 'پیاز قرمز ریز', quantity: 0.1, unit: 'kg', yieldPercent: 90 },
      ],
    },
    {
      id: 'recipe-sub-dynamite',
      name: 'دستور تهیه تولید دسته سس داینامیت واسابی تند',
      outputItemId: 'item-sauce-dynamite',
      status: 'approved',
      version: 1,
      branchId: null,
      yieldQuantity: 8,
      yieldPercent: 100,
      portions: 8,
      ingredients: [
        { itemId: 'item-cooking-cream', name: 'خامه آشپزی', quantity: 0.6, unit: 'kg', yieldPercent: 100 },
        { itemId: 'item-sauce-teriyaki', name: 'سس تریاکی ژاپنی', quantity: 0.15, unit: 'l', yieldPercent: 100 },
        { itemId: 'item-fresh-lemon', name: 'لیموترش سنگی', quantity: 0.1, unit: 'kg', yieldPercent: 95 },
      ],
    },
  ];

  // Ensure an open fiscal period exists in Finance V2 for current dates
  const f2 = db.financeV2 = db.financeV2 || {};
  f2.fiscalPeriods = f2.fiscalPeriods || [];
  if (f2.fiscalPeriods.length > 0) {
    f2.fiscalPeriods[0].status = 'open';
    delete f2.fiscalPeriods[0].closedAt;
    delete f2.fiscalPeriods[0].closedBy;
  } else {
    f2.fiscalPeriods.push({
      id: 'foundation-2026-08-31',
      name: 'دورهٔ افتتاحیه',
      status: 'open',
      startDate: '2026-08-31',
      endDate: '2026-09-30',
      createdAt: now,
      createdBy: 'system:foundation-reset',
    });
  }
  // Seed pristine 10-order lifecycle dataset and 5 production batches
  db.posSales = [];
  db.paymentAttempts = [];

  const sampleItems = [
    { id: 80969, name: 'سالاد چیکن آووکادو', price: 990000, quantity: 1, total: 990000 },
  ];

  db.orders = [
    // 5 Completed orders (all paymentStatus: 'paid')
    {
      id: 1001,
      orderNo: 'W-1001',
      branchId: 1,
      tableNo: '12',
      phone: '09374333028',
      type: 'dine_in',
      status: 'done',
      paymentStatus: 'paid',
      paymentTender: 'card',
      subtotal: 990000,
      total: 990000,
      amountPaid: 990000,
      items: sampleItems,
      createdAt: '2026-08-31T12:00:00.000Z',
      paidAt: '2026-08-31T12:05:00.000Z',
    },
    {
      id: 1002,
      orderNo: 'W-1002',
      branchId: 1,
      tableNo: '4',
      phone: '09120000000',
      type: 'dine_in',
      status: 'done',
      paymentStatus: 'paid',
      paymentTender: 'cash',
      subtotal: 990000,
      total: 990000,
      amountPaid: 990000,
      items: sampleItems,
      createdAt: '2026-08-31T12:30:00.000Z',
      paidAt: '2026-08-31T12:32:00.000Z',
    },
    {
      id: 1003,
      orderNo: 'W-1003',
      branchId: 1,
      phone: '09123334455',
      type: 'takeaway',
      status: 'picked_up',
      paymentStatus: 'paid',
      paymentTender: 'card',
      subtotal: 990000,
      total: 990000,
      amountPaid: 990000,
      items: sampleItems,
      createdAt: '2026-08-31T13:00:00.000Z',
      paidAt: '2026-08-31T13:02:00.000Z',
    },
    {
      id: 1004,
      orderNo: 'W-1004',
      branchId: 1,
      phone: '09123334455',
      type: 'delivery',
      status: 'delivered',
      paymentStatus: 'paid',
      paymentTender: 'online',
      subtotal: 990000,
      total: 990000,
      amountPaid: 990000,
      items: sampleItems,
      createdAt: '2026-08-31T13:30:00.000Z',
      paidAt: '2026-08-31T13:31:00.000Z',
    },
    {
      id: 1005,
      orderNo: 'W-1005',
      branchId: 1,
      tableNo: '7',
      phone: '09374333028',
      type: 'dine_in',
      status: 'done',
      paymentStatus: 'paid',
      paymentTender: 'card',
      subtotal: 990000,
      total: 990000,
      amountPaid: 990000,
      items: sampleItems,
      createdAt: '2026-08-31T14:00:00.000Z',
      paidAt: '2026-08-31T14:05:00.000Z',
    },

    // 5 In-Progress orders
    {
      id: 1006,
      orderNo: 'W-1006',
      branchId: 1,
      tableNo: '15',
      phone: '09120000000',
      type: 'dine_in',
      status: 'pay_at_cashier',
      paymentStatus: 'pending',
      subtotal: 990000,
      total: 990000,
      amountPaid: 0,
      items: sampleItems,
      createdAt: '2026-08-31T14:10:00.000Z',
    },
    {
      id: 1007,
      orderNo: 'W-1007',
      branchId: 1,
      phone: '09123334455',
      type: 'delivery',
      status: 'awaiting_confirmation',
      paymentStatus: 'pending',
      subtotal: 990000,
      total: 990000,
      amountPaid: 0,
      items: sampleItems,
      createdAt: '2026-08-31T14:15:00.000Z',
    },
    {
      id: 1008,
      orderNo: 'W-1008',
      branchId: 1,
      tableNo: '2',
      phone: '09374333028',
      type: 'dine_in',
      status: 'sent_to_kitchen',
      paymentStatus: 'paid',
      paymentTender: 'card',
      subtotal: 990000,
      total: 990000,
      amountPaid: 990000,
      items: sampleItems,
      createdAt: '2026-08-31T14:20:00.000Z',
    },
    {
      id: 1009,
      orderNo: 'W-1009',
      branchId: 1,
      tableNo: '9',
      phone: '09120000000',
      type: 'dine_in',
      status: 'preparing',
      paymentStatus: 'paid',
      paymentTender: 'card',
      subtotal: 990000,
      total: 990000,
      amountPaid: 990000,
      items: sampleItems,
      createdAt: '2026-08-31T14:25:00.000Z',
    },
    {
      id: 1010,
      orderNo: 'W-1010',
      branchId: 1,
      phone: '09374333028',
      type: 'takeaway',
      status: 'ready',
      paymentStatus: 'paid',
      paymentTender: 'online',
      subtotal: 990000,
      total: 990000,
      amountPaid: 990000,
      items: sampleItems,
      createdAt: '2026-08-31T14:30:00.000Z',
    },
  ];

  f2.productionBatches = [
    {
      id: 'batch-pomodoro-01',
      branchId: 1,
      recipeVersionId: 'recipe-sub-pomodoro',
      outputItemId: 'item-sauce-pomodoro',
      plannedYield: 15,
      actualYield: 15,
      status: 'completed',
      producedAt: '2026-08-31T09:00:00.000Z',
      createdBy: 'chef-farhad',
      createdAt: '2026-08-31T09:00:00.000Z',
    },
    {
      id: 'batch-caesar-01',
      branchId: 1,
      recipeVersionId: 'recipe-sub-caesar',
      outputItemId: 'item-sauce-caesar',
      plannedYield: 10,
      actualYield: 10,
      status: 'completed',
      producedAt: '2026-08-31T09:30:00.000Z',
      createdBy: 'chef-farhad',
      createdAt: '2026-08-31T09:30:00.000Z',
    },
    {
      id: 'batch-truffle-01',
      branchId: 1,
      recipeVersionId: 'recipe-sub-truffle',
      outputItemId: 'item-sauce-truffle',
      plannedYield: 8,
      actualYield: 8,
      status: 'completed',
      producedAt: '2026-08-31T10:00:00.000Z',
      createdBy: 'chef-farhad',
      createdAt: '2026-08-31T10:00:00.000Z',
    },
    {
      id: 'batch-burger-01',
      branchId: 1,
      recipeVersionId: 'recipe-sub-burger',
      outputItemId: 'item-sauce-burger',
      plannedYield: 10,
      actualYield: 10,
      status: 'completed',
      producedAt: '2026-08-31T10:30:00.000Z',
      createdBy: 'chef-farhad',
      createdAt: '2026-08-31T10:30:00.000Z',
    },
    {
      id: 'batch-dynamite-01',
      branchId: 1,
      recipeVersionId: 'recipe-sub-dynamite',
      outputItemId: 'item-sauce-dynamite',
      plannedYield: 8,
      actualYield: 8,
      status: 'completed',
      producedAt: '2026-08-31T11:00:00.000Z',
      createdBy: 'chef-farhad',
      createdAt: '2026-08-31T11:00:00.000Z',
    },
  ];


  subRecipes.forEach((sr) => {
    const idx = recipes.findIndex((r) => r.id === sr.id);
    if (idx >= 0) recipes[idx] = sr;
    else recipes.push(sr);
  });
  console.log(`[seed] Injected ${subRecipes.length} production sub-recipes with valid ingredient links.`);

  // 7. Create realistic Purchase Bills & Accounts Payable records
  acc.vendorBills = [
    {
      id: 'bill-101',
      billNumber: 'BILL-1405-01',
      vendorId: 'v-dairy',
      branchId: 1,
      issueDate: '2026-08-25',
      dueDate: '2026-09-24',
      subtotalIrr: 450000000,
      taxIrr: 40500000,
      totalIrr: 490500000,
      paidIrr: 0,
      balanceIrr: 490500000,
      status: 'posted',
      lines: [
        { itemId: 'item-cheese-mozzarella', description: 'پنیر موزارلا ناپولی', quantity: 50, unitCostIrr: 3800000, totalCostIrr: 190000000 },
        { itemId: 'item-fresh-milk', description: 'شیر پرچرب باریستا', quantity: 200, unitCostIrr: 450000, totalCostIrr: 90000000 },
        { itemId: 'item-cooking-cream', description: 'خامه پخت و پز', quantity: 60, unitCostIrr: 1800000, totalCostIrr: 108000000 },
        { itemId: 'item-butter', description: 'کره حیوانی ۸۲٪', quantity: 15, unitCostIrr: 4000000, totalCostIrr: 60000000 },
      ],
      createdAt: '2026-08-25T08:30:00.000Z',
    },
    {
      id: 'bill-102',
      billNumber: 'BILL-1405-02',
      vendorId: 'v-meat',
      branchId: 1,
      issueDate: '2026-08-28',
      dueDate: '2026-09-12',
      subtotalIrr: 850000000,
      taxIrr: 0,
      totalIrr: 850000000,
      paidIrr: 200000000,
      balanceIrr: 650000000,
      status: 'partial',
      lines: [
        { itemId: 'item-beef-tenderloin', description: 'فیله گوساله گرم تازه', quantity: 40, unitCostIrr: 12000000, totalCostIrr: 480000000 },
        { itemId: 'item-beef-minced', description: 'گوشت چرخ‌کرده برگر', quantity: 50, unitCostIrr: 7000000, totalCostIrr: 350000000 },
      ],
      createdAt: '2026-08-28T09:15:00.000Z',
    },
    {
      id: 'bill-103',
      billNumber: 'BILL-1405-03',
      vendorId: 'v-produce',
      branchId: 1,
      issueDate: '2026-08-30',
      dueDate: '2026-09-09',
      subtotalIrr: 125000000,
      taxIrr: 0,
      totalIrr: 125000000,
      paidIrr: 0,
      balanceIrr: 125000000,
      status: 'posted',
      lines: [
        { itemId: 'item-lettuce-iceberg', description: 'کاهو سالادی پیچ تازه', quantity: 100, unitCostIrr: 450000, totalCostIrr: 45000000 },
        { itemId: 'item-tomato-cherry', description: 'گوجه چری گلخانه‌ای', quantity: 50, unitCostIrr: 900000, totalCostIrr: 45000000 },
        { itemId: 'item-avocado', description: 'آووکادو هاس وارداتی', quantity: 20, unitCostIrr: 1750000, totalCostIrr: 35000000 },
      ],
      createdAt: '2026-08-30T07:00:00.000Z',
    },
    {
      id: 'bill-104',
      billNumber: 'BILL-1405-04',
      vendorId: 'v-packaging',
      branchId: 1,
      issueDate: '2026-08-20',
      dueDate: '2026-10-04',
      subtotalIrr: 320000000,
      taxIrr: 28800000,
      totalIrr: 348800000,
      paidIrr: 348800000,
      balanceIrr: 0,
      status: 'paid',
      lines: [
        { itemId: 'item-box-takeaway', description: 'جعبه غذای بیرون‌بر کرافت لوکس', quantity: 2000, unitCostIrr: 95000, totalCostIrr: 190000000 },
        { itemId: 'item-cup-hot', description: 'لیوان نوشیدنی گرم دوجداره', quantity: 1000, unitCostIrr: 65000, totalCostIrr: 65000000 },
        { itemId: 'item-cup-cold', description: 'لیوان نوشیدنی سرد + نی', quantity: 1000, unitCostIrr: 65000, totalCostIrr: 65000000 },
      ],
      createdAt: '2026-08-20T11:00:00.000Z',
    },
  ];

  console.log(`[seed] Seeded ${acc.vendorBills.length} realistic AP vendor bills.`);

  // Write back to db.json
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf8');
  console.log('[seed] Successfully saved master data to db.json!');
}

if (require.main === module) {
  seedEcosystemMaster();
}

module.exports = { seedEcosystemMaster };
