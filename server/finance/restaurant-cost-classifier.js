'use strict';

// One authoritative classification for restaurant P&L and break-even metrics.
// Keep this dependency-free so both the Finance V2 ledger and the CFO brief
// classify the same posted account lines without drifting silently.
const RESTAURANT_COST_BEHAVIOR = Object.freeze({
  5100: { behavior: 'variable', label: 'مواد اولیه و بهای فروش' },
  5200: { behavior: 'variable', label: 'مواد اولیه نوشیدنی و قهوه' },
  5300: { behavior: 'variable', label: 'ظروف و ملزومات بیرون‌بر' },
  5400: { behavior: 'variable', label: 'ضایعات آشپزخانه' },
  5500: { behavior: 'variable', label: 'کسری و مازاد صندوق' },
  5110: { behavior: 'variable', label: 'ضایعات مواد اولیه' },
  5120: { behavior: 'variable', label: 'کسری شمارش موجودی' },
  5130: { behavior: 'variable', label: 'افت تولید دسته‌ای' },
  6100: { behavior: 'fixed', label: 'حقوق و دستمزد' },
  6110: { behavior: 'fixed', label: 'حقوق آشپزخانه و بار' },
  6120: { behavior: 'fixed', label: 'حقوق سالن و صندوق' },
  6130: { behavior: 'fixed', label: 'اضافه‌کاری، پاداش و عیدی' },
  6140: { behavior: 'fixed', label: 'بیمه سهم کارفرما' },
  6200: { behavior: 'fixed', label: 'اجاره' },
  6300: { behavior: 'fixed', label: 'آب، برق، گاز و اینترنت' },
  6400: { behavior: 'fixed', label: 'تبلیغات و بازاریابی' },
  6500: { behavior: 'fixed', label: 'تعمیرات و نگهداری' },
  6600: { behavior: 'variable', label: 'نظافت و بهداشت' },
  6700: { behavior: 'fixed', label: 'ملزومات اداری' },
  6800: { behavior: 'fixed', label: 'بیمه کسب‌وکار' },
  6900: { behavior: 'fixed', label: 'مجوز و عوارض' },
  6950: { behavior: 'variable', label: 'کارمزد بانکی و کارتخوان' },
  6970: { behavior: 'variable', label: 'کمیسیون پلتفرم فروش' },
  6980: { behavior: 'fixed', label: 'استهلاک' },
});

function classifyRestaurantCost(accountCode) {
  return RESTAURANT_COST_BEHAVIOR[String(accountCode || '').trim()] || null;
}

module.exports = { RESTAURANT_COST_BEHAVIOR, classifyRestaurantCost };
