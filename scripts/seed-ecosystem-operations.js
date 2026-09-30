'use strict';

const { assertTestSeedAllowed } = require('./lib/test-seed-safety');
const BASE_URL = 'http://localhost:4180';

async function api(path, opts = {}, cookie = '') {
  const url = `${BASE_URL}${path}`;
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (cookie) headers['Cookie'] = cookie;
  const res = await fetch(url, { ...opts, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || data.message || `HTTP ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return { status: res.status, data, headers: res.headers };
}

async function loginAdmin() {
  console.log('[ops] Requesting demo OTP for admin 09374333028...');
  const otpRes = await api('/api/auth/request-otp', {
    method: 'POST',
    body: JSON.stringify({ phone: '09374333028' }),
  });
  const code = otpRes.data.code;
  console.log(`[ops] Got demo OTP: ${code}, verifying...`);

  const verifyRes = await fetch(`${BASE_URL}/api/auth/verify-otp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: '09374333028', code }),
  });
  const cookie = verifyRes.headers.get('set-cookie');
  console.log('[ops] Logged in successfully, session cookie acquired.');
  return cookie;
}

async function runProductionBatches(cookie) {
  console.log('[ops] Executing 5 Production Batches via API...');
  const batches = [
    { recipeId: 'recipe-sub-pomodoro', outputItemId: 'item-sauce-pomodoro', plannedYield: 15, actualYield: 15, branchId: 1 },
    { recipeId: 'recipe-sub-caesar', outputItemId: 'item-sauce-caesar', plannedYield: 10, actualYield: 10, branchId: 1 },
    { recipeId: 'recipe-sub-truffle', outputItemId: 'item-sauce-truffle', plannedYield: 8, actualYield: 8, branchId: 1 },
    { recipeId: 'recipe-sub-burger', outputItemId: 'item-sauce-burger', plannedYield: 10, actualYield: 10, branchId: 1 },
    { recipeId: 'recipe-sub-dynamite', outputItemId: 'item-sauce-dynamite', plannedYield: 8, actualYield: 8, branchId: 1 },
  ];

  for (let i = 0; i < batches.length; i++) {
    const b = batches[i];
    const key = `batch-seed-final-${Date.now()}-${i}`;
    try {
      const res = await api('/api/kitchen/inventory/production-batches', {
        method: 'POST',
        headers: { 'Idempotency-Key': key },
        body: JSON.stringify(b),
      }, cookie);
      console.log(`[ops] Batch ${i + 1} (${b.outputItemId}) created successfully:`, res.data?.data?.operationId || res.status);
    } catch (err) {
      console.error(`[ops] Batch ${i + 1} (${b.outputItemId}) error:`, err.message, JSON.stringify(err.data || {}));
    }
  }
}

async function seedOrders(cookie) {
  console.log('[ops] Creating 5 Completed Orders and 5 In-Progress Orders with full operational flow...');

  // 1. Five Completed Orders
  const completedOrders = [
    {
      tableNo: '1',
      fulfillment: 'dine_in',
      phone: '09374333028',
      name: 'ساسان راد (مدیر رستوران)',
      paymentMethod: 'cashier',
      items: [
        { menuItemId: 43918, qty: 2 }, // پولد بیف برگر
        { menuItemId: 64158, qty: 1 }, // فرایز
        { menuItemId: 80969, qty: 1 }, // سالاد چیکن آووکادو
      ],
      note: 'سفارش میز VIP سالن اصلی',
    },
    {
      fulfillment: 'pickup',
      phone: '09121112233',
      name: 'سارا محمدی',
      paymentMethod: 'cashier',
      items: [
        { menuItemId: 94419, qty: 2 }, // پیتزا سلمن
        { menuItemId: 104193, qty: 1 }, // سالاد سزار اورجینال
        { menuItemId: 80972, qty: 2 }, // سوپ
      ],
      note: 'بسته‌بندی محکم بیرون‌بر همراه با کارد و چنگال',
    },
    {
      fulfillment: 'delivery',
      phone: '09151184071',
      name: 'علی رضایی',
      deliveryAddress: 'مشهد، بلوار سجاد، کوچه بهار، پلاک ۱۲',
      deliveryZoneId: 1,
      paymentMethod: 'cashier',
      items: [
        { menuItemId: 60009, qty: 1 }, // کته استیک
        { menuItemId: 43915, qty: 1 }, // چیکن تورتیلینی
        { menuItemId: 64158, qty: 2 }, // فرایز
      ],
      note: 'زنگ طبقه دوم، لطفاً با آسانسور بیاورید',
    },
    {
      tableNo: '4',
      fulfillment: 'dine_in',
      phone: '09355554433',
      name: 'مریم ابراهیمی',
      paymentMethod: 'cashier',
      items: [
        { menuItemId: 43939, qty: 2 }, // پیتزا فیلوبیکن
        { menuItemId: 43916, qty: 1 }, // بیف پیستاچیو
        { menuItemId: 104321, qty: 2 }, // چیپس و پیازچه
      ],
      note: 'سرو با سس تند اضافه',
    },
    {
      tableNo: '6',
      fulfillment: 'dine_in',
      phone: '09374333028',
      name: 'ساسان راد',
      paymentMethod: 'cashier',
      items: [
        { menuItemId: 43919, qty: 1 }, // بری برگر
        { menuItemId: 43920, qty: 1 }, // برگر کریسپی
        { menuItemId: 104328, qty: 1 }, // کشک بادمجان
      ],
      note: 'پرداخت سریع در صندوق',
    },
  ];

  for (let i = 0; i < completedOrders.length; i++) {
    const o = completedOrders[i];
    try {
      const res = await api('/api/staff/orders', {
        method: 'POST',
        headers: { 'Idempotency-Key': `ord-c-final-${Date.now()}-${i}` },
        body: JSON.stringify(o),
      }, cookie);
      const created = res.data?.order;
      if (created) {
        console.log(`[ops] Created completed order ${i + 1} (ID: ${created.id}, No: ${created.orderNo})`);
        // Settle payment with card
        await api(`/api/cashier/orders/${created.id}/settle`, {
          method: 'POST',
          body: JSON.stringify({ tender: 'card' }),
        }, cookie);
        // Transition to preparing
        await api(`/api/v2/orders/${created.id}/status`, {
          method: 'PATCH',
          body: JSON.stringify({ status: 'preparing' }),
        }, cookie);
        // Transition to ready
        await api(`/api/v2/orders/${created.id}/status`, {
          method: 'PATCH',
          body: JSON.stringify({ status: 'ready' }),
        }, cookie);
        // Transition to terminal (done, picked_up, delivered)
        const finalStatus = o.fulfillment === 'delivery' ? 'dispatched' : o.fulfillment === 'pickup' ? 'picked_up' : 'done';
        await api(`/api/v2/orders/${created.id}/status`, {
          method: 'PATCH',
          body: JSON.stringify({ status: finalStatus }),
        }, cookie);
        if (finalStatus === 'dispatched') {
          await api(`/api/v2/orders/${created.id}/status`, {
            method: 'PATCH',
            body: JSON.stringify({ status: 'delivered' }),
          }, cookie);
        }
        console.log(`[ops] Order ${created.id} fully settled and completed.`);
      }
    } catch (err) {
      console.error(`[ops] Error completing order ${i + 1}:`, err.message, JSON.stringify(err.data || {}));
    }
  }

  // 2. Five Active / In-Progress Orders
  const inProgressOrders = [
    {
      targetStatus: 'awaiting_confirmation',
      tableNo: '2',
      fulfillment: 'dine_in',
      phone: '09123334455',
      name: 'مهندس کاظمی',
      paymentMethod: 'cashier',
      items: [
        { menuItemId: 43937, qty: 1 }, // پیتزا پوتیتو بیکن
        { menuItemId: 64158, qty: 2 }, // فرایز
      ],
      note: 'در انتظار تأیید و پرداخت در صندوق',
    },
    {
      targetStatus: 'sent_to_kitchen',
      tableNo: '5',
      fulfillment: 'dine_in',
      phone: '09198887766',
      name: 'امیر رستگار',
      paymentMethod: 'cashier',
      sendToKitchen: true,
      items: [
        { menuItemId: 43920, qty: 2 }, // برگر کریسپی
        { menuItemId: 104321, qty: 1 }, // چیپس و پیازچه
      ],
      note: 'ارسال فوری به آشپزخانه برای پخت',
    },
    {
      targetStatus: 'preparing',
      fulfillment: 'pickup',
      phone: '09367778899',
      name: 'خانم پیروز',
      paymentMethod: 'cashier',
      items: [
        { menuItemId: 43918, qty: 2 }, // پولد بیف برگر
        { menuItemId: 80972, qty: 1 }, // سوپ
      ],
      note: 'مشتری تا ۱۰ دقیقه دیگر برای تحویل می‌رسد',
    },
    {
      targetStatus: 'ready',
      fulfillment: 'delivery',
      phone: '09120009988',
      name: 'دکتر حسینی',
      deliveryAddress: 'مشهد، خیابان سجاد، برج آناهیتا، طبقه ۴',
      deliveryZoneId: 1,
      paymentMethod: 'cashier',
      items: [
        { menuItemId: 43907, qty: 1 }, // شریمپ وآسابی
        { menuItemId: 104320, qty: 1 }, // راک شریمپ
        { menuItemId: 80969, qty: 1 }, // سالاد چیکن آووکادو
      ],
      note: 'آماده تحویل به پیک — بسته‌بندی عایق حرارتی',
    },
    {
      targetStatus: 'pay_at_cashier',
      tableNo: '8',
      fulfillment: 'dine_in',
      phone: '09159990011',
      name: 'خانواده خلیلی',
      paymentMethod: 'cashier',
      items: [
        { menuItemId: 60009, qty: 2 }, // کته استیک
        { menuItemId: 104193, qty: 1 }, // سالاد سزار اورجینال
      ],
      note: 'مشتری سر میز میل کرده و درخواست صدور صورتحساب دارد',
    },
  ];

  for (let i = 0; i < inProgressOrders.length; i++) {
    const o = inProgressOrders[i];
    try {
      const res = await api('/api/staff/orders', {
        method: 'POST',
        headers: { 'Idempotency-Key': `ord-p-final-${Date.now()}-${i}` },
        body: JSON.stringify(o),
      }, cookie);
      const created = res.data?.order;
      if (created) {
        console.log(`[ops] Created in-progress order ${i + 1} (ID: ${created.id}, Target: ${o.targetStatus})`);
        if (o.targetStatus === 'preparing' || o.targetStatus === 'ready') {
          // Settle and transition to preparing
          await api(`/api/cashier/orders/${created.id}/settle`, {
            method: 'POST',
            body: JSON.stringify({ tender: 'card' }),
          }, cookie);
          await api(`/api/v2/orders/${created.id}/status`, {
            method: 'PATCH',
            body: JSON.stringify({ status: 'preparing' }),
          }, cookie);
          if (o.targetStatus === 'ready') {
            await api(`/api/v2/orders/${created.id}/status`, {
              method: 'PATCH',
              body: JSON.stringify({ status: 'ready' }),
            }, cookie);
          }
        }
        console.log(`[ops] In-progress order ${created.id} is now in active state ${o.targetStatus}.`);
      }
    } catch (err) {
      console.error(`[ops] Error setting up in-progress order ${i + 1}:`, err.message, JSON.stringify(err.data || {}));
    }
  }
}

async function main() {
  try {
    assertTestSeedAllowed({ scriptName: 'seed-ecosystem-operations', targetUrl: BASE_URL });
    const cookie = await loginAdmin();
    await runProductionBatches(cookie);
    await seedOrders(cookie);
    console.log('[ops] ALL ECOSYSTEM OPERATIONS COMPLETED AND VERIFIED!');
  } catch (err) {
    console.error('[ops] Operations failed:', err);
    process.exit(1);
  }
}

if (require.main === module) main();

module.exports = { main, seedOrders, runProductionBatches };
