/* Menu FA→EN / FA→AR translation: local glossary by default; an explicit
   operator opt-in is required before any foreign hosted API is contacted. */

const { foreignRuntimeAllowed } = require('./salsa/provider-policy');

const GLOSSARY = {
  سالاد: 'Salad',
  مرغ: 'Chicken',
  گریل: 'Grilled',
  گوشت: 'Beef',
  گوساله: 'Veal',
  بره: 'Lamb',
  میگو: 'Shrimp',
  ماهی: 'Fish',
  سالمون: 'Salmon',
  استیک: 'Steak',
  برگر: 'Burger',
  پاستا: 'Pasta',
  پیتزا: 'Pizza',
  سوپ: 'Soup',
  سیب: 'Apple',
  زمینی: 'Potato',
  سیب‌زمینی: 'Potato',
  سیبزمینی: 'Potato',
  فرنچ: 'French',
  فرایز: 'Fries',
  بال: 'Wings',
  تاکو: 'Taco',
  املت: 'Omelette',
  صبحانه: 'Breakfast',
  نوشیدنی: 'Drink',
  قهوه: 'Coffee',
  اسپرسو: 'Espresso',
  لاته: 'Latte',
  کاپوچینو: 'Cappuccino',
  چای: 'Tea',
  آبمیوه: 'Juice',
  شیک: 'Shake',
  اسموتی: 'Smoothie',
  دسر: 'Dessert',
  کیک: 'Cake',
  بستنی: 'Ice Cream',
  شکلات: 'Chocolate',
  وانیل: 'Vanilla',
  کارامل: 'Caramel',
  آووکادو: 'Avocado',
  اسفناج: 'Spinach',
  کاهو: 'Lettuce',
  گوجه: 'Tomato',
  خیار: 'Cucumber',
  پیاز: 'Onion',
  سیر: 'Garlic',
  قارچ: 'Mushroom',
  پنیر: 'Cheese',
  پارمسان: 'Parmesan',
  موزارلا: 'Mozzarella',
  سس: 'Sauce',
  تند: 'Spicy',
  ویژه: 'Special',
  کلاسیک: 'Classic',
  دوبل: 'Double',
  مینی: 'Mini',
  اسلایدر: 'Slider',
  ریب‌آی: 'Ribeye',
  ریبای: 'Ribeye',
  فیله: 'Fillet',
  کباب: 'Kebab',
  جوجه: 'Chicken',
  بریانی: 'Biryani',
  کته: 'Kateh',
  برنج: 'Rice',
  نودل: 'Noodle',
  وگان: 'Vegan',
  گیاهی: 'Vegetarian',
  وگی: 'Veggie',
  هوموس: 'Hummus',
  حمص: 'Hummus',
  ادماامه: 'Edamame',
  ادامامه: 'Edamame',
  واسابی: 'Wasabi',
  پسته: 'Pistachio',
  پسته‌ای: 'Pistachio',
  پیستاچیو: 'Pistachio',
  کره: 'Butter',
  اورینتال: 'Oriental',
  تکزاس: 'Tex-Mex',
  مکزیکی: 'Mexican',
  ایتالیایی: 'Italian',
  آسیایی: 'Asian',
  دودی: 'Smoked',
  'سرخ‌شده': 'Fried',
  'سرخ شده': 'Fried',
  پخته: 'Baked',
  کبابی: 'Grilled',
  کره‌ای: 'Korean',
  ژاپنی: 'Japanese',
  حاوی: 'with',
  با: 'with',
  و: 'and',
  از: 'of',
  تازه: 'Fresh',
  خانگی: 'Homemade',
  پیشنهادی: 'Chef Special',
  پیشنهاد: 'Special',
  روز: 'of the Day',
  'پیش‌غذا': 'Appetizer',
  'پیش غذا': 'Appetizer',
  'غذای‌اصلی': 'Main',
  'غذای اصلی': 'Main Course',
  کنار: 'Side',
  میکس: 'Mixed',
  مغز: '',
  پرتقال: 'Orange',
  تورتیلا: 'Tortilla',
  تورتیلای: 'Tortilla',
  کریسپی: 'Crispy',
  خشک: 'Dried',
  درسینگ: 'Dressing',
  مزه: 'Seasoned',
  'مزه دار': 'Seasoned',
  'مزه‌دار': 'Seasoned',
  'مزه دار شده': 'Seasoned',
  بیبی: 'Baby',
  کلم: 'Cabbage',
  قرمز: 'Red',
  فرانسوی: 'French',
  پینات: 'Peanut',
  باتر: 'Butter',
  انتروکوت: 'Entrecote',
  تارگون: 'Tarragon',
  اسپرینگ: 'Spring',
  رول: 'Roll',
  سبزیجات: 'Vegetables',
  شریمپ: 'Shrimp',
  دیپ: 'Dip',
  وگاس: 'Vegas',
  چیکن: 'Chicken',
  تورتیلینی: 'Tortellini',
  آلفردو: 'Alfredo',
  فونگی: 'Fungi',
  لم: 'Lamb',
  بری: 'Berry',
  وین: 'Wien',
  پاپ: 'Pop',
  گرین: 'Green',
  تکس: 'Tex',
  مکس: 'Mex',
  اسپایسی: 'Spicy',
  بیف: 'Beef',
  کرنبری: 'Cranberry',
  شرت: 'Short',
  ریبز: 'Ribs',
  اسیشیال: 'Special',
  اسپیشیال: 'Special',
  گارلیک: 'Garlic',
  ادمامه: 'Edamame',
  ادامامه: 'Edamame',
  سالسیجا: 'Salsiccia',
  سیگنیچر: 'Signature',
  کرک: 'Crack',
  ترسلچز: 'Truffle Cheese',
  اوریو: 'Oreo',
  موکا: 'Mocha',
  کاراملایز: 'Caramelized',
  ماستارد: 'Mustard',
};

/** Persian → Arabic menu glossary (guest AR UI). */
const GLOSSARY_AR = {
  سالاد: 'سلطة',
  مرغ: 'دجاج',
  گریل: 'مشوي',
  گوشت: 'لحم',
  گوساله: 'عجل',
  بره: 'خروف',
  میگو: 'روبيان',
  ماهی: 'سمك',
  سالمون: 'سلمون',
  استیک: 'ستيك',
  برگر: 'برغر',
  پاستا: 'باستا',
  پیتزا: 'بيتزا',
  سوپ: 'شوربة',
  فرایز: 'بطاطس مقلية',
  'سیب زمینی': 'بطاطس',
  سیب‌زمینی: 'بطاطس',
  تاکو: 'تاكو',
  قهوه: 'قهوة',
  چای: 'شاي',
  دسر: 'حلوى',
  کیک: 'كعكة',
  شکلات: 'شوكولاتة',
  آووکادو: 'أفوكادو',
  اسفناج: 'سبانخ',
  کاهو: 'خس',
  گوجه: 'طماطم',
  خیار: 'خيار',
  پیاز: 'بصل',
  سیر: 'ثوم',
  قارچ: 'فطر',
  پنیر: 'جبن',
  سس: 'صلصة',
  تند: 'حار',
  ویژه: 'خاص',
  کلاسیک: 'كلاسيك',
  فیله: 'فيليه',
  کباب: 'كباب',
  برنج: 'أرز',
  نودل: 'نودلز',
  وگان: 'نباتي',
  گیاهی: 'نباتي',
  هوموس: 'حمص',
  حمص: 'حمص',
  واسابی: 'واسابي',
  پسته: 'فستق',
  پیستاچیو: 'فستق',
  کره: 'زبدة',
  با: 'مع',
  و: 'و',
  میکس: 'مشكل',
  پرتقال: 'برتقال',
  تورتیلا: 'تورتيلا',
  کریسپی: 'مقرمش',
  درسینگ: 'دريسنج',
  'مزه دار شده': 'متبل',
  'مزه‌دار': 'متبل',
  انتروکوت: 'أنتريكوت',
  تارگون: 'طرخون',
  اسپرینگ: 'سبرينج',
  رول: 'رول',
  سبزیجات: 'خضار',
  شریمپ: 'روبيان',
  چیکن: 'دجاج',
  آلفردو: 'ألفريدو',
  بیف: 'لحم بقر',
  گارلیک: 'ثوم',
  اسپایسی: 'حار',
  گرین: 'أخضر',
  ادمامه: 'إدامامي',
  ادامامه: 'إدامامي',
  سیگنیچر: 'سيغنتشر',
  'پیش غذا': 'مقبلات',
  'غذای اصلی': 'طبق رئيسي',
};

function titleCase(s) {
  return String(s || '')
    .trim()
    .replace(/\s+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((w) => {
      const low = w.toLowerCase();
      if (low === '&' || low === 'and' || low === 'with' || low === 'of' || low === 'the') {
        return low === '&' ? '&' : low;
      }
      if (/^[A-Z0-9]+$/.test(w) && w.length <= 4) return w;
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    })
    .join(' ')
    .replace(/\s+&\s+/g, ' & ')
    .replace(/\s+/g, ' ')
    .trim();
}

const GLOSSARY_KEYS = Object.keys(GLOSSARY).sort((a, b) => b.length - a.length);
const GLOSSARY_AR_KEYS = Object.keys(GLOSSARY_AR).sort((a, b) => b.length - a.length);

function glossaryKeys(glossary) {
  if (glossary === GLOSSARY) return GLOSSARY_KEYS;
  if (glossary === GLOSSARY_AR) return GLOSSARY_AR_KEYS;
  return Object.keys(glossary).sort((a, b) => b.length - a.length);
}

function applyGlossary(text, glossary) {
  if (!text || !String(text).trim()) return '';
  let out = String(text);
  for (const k of glossaryKeys(glossary)) {
    const rep = glossary[k];
    if (rep === '') out = out.split(k).join(' ');
    else out = out.split(k).join(` ${rep} `);
  }
  return out;
}

function cleanEnLabel(s) {
  let t = String(s || '').trim();
  if (!t) return '';
  t = t.replace(/^[&\s]+/, '').trim();
  let m = t.match(/^&&?\s*\(\s*(.+?)\s*\)\s*$/);
  if (m) t = m[1].trim();
  m = t.match(/^\(\s*(.+?)\s*\)\s*$/);
  if (m) t = m[1].trim();
  m = t.match(/^[&\s]*\(\s*(.+?)\s*\)\s*$/);
  if (m) t = m[1].trim();
  t = t
    .replace(/^&\s*/g, '')
    .replace(/\s+&\s*$/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')')
    .replace(/\s*,\s*/g, ', ')
    .trim();
  t = t
    .split(/\s+/)
    .filter((w) => w && w !== '&')
    .join(' ')
    .replace(/\s+and\s+and/gi, ' and ')
    .trim();
  return t;
}

function isBrokenEn(s) {
  const t = cleanEnLabel(s);
  if (!t) return true;
  const letters = t.replace(/[^A-Za-z]/g, '');
  if (letters.length < 2) return true;
  const raw = String(s || '').trim();
  if (/^[&(/]/.test(raw)) return true;
  if (/^\s*&\s*$/.test(raw)) return true;
  if (letters.length < raw.replace(/\s/g, '').length * 0.4 && letters.length < 6) return true;
  return false;
}

function glossaryTranslate(text) {
  let out = applyGlossary(text, GLOSSARY);
  out = out
    .replace(/[\u0600-\u06FF]+/g, ' ')
    .replace(/[،؛]/g, ',')
    .replace(/\s*,\s*/g, ', ')
    .replace(/\(\s*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleanEnLabel(titleCase(out));
}

function glossaryTranslateAr(text, { allowPartial = true } = {}) {
  let out = applyGlossary(text, GLOSSARY_AR);
  out = out
    .replace(/[پچژگکی]/g, ' ')
    .replace(/[،؛]/g, '،')
    .replace(/\(\s*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!allowPartial) {
    const letters = (out.match(/[\u0600-\u06FFa-zA-Z]/g) || []).length;
    const persianLeft = (out.match(/[\u0600-\u06FF]/g) || []).length;
    // Descriptions that stay mostly unmapped Persian are worse than empty (EN fallback).
    if (letters && persianLeft / letters > 0.55) return '';
  }
  return out;
}

function envInt(name, fallback, min, max) {
  const parsed = Number.parseInt(process.env[name] || '', 10);
  const value = Number.isFinite(parsed) ? parsed : fallback;
  return Math.max(min, Math.min(max, value));
}

const OPENAI_TRANSLATE_TIMEOUT_MS = envInt(
  'OPENAI_TRANSLATE_TIMEOUT_MS',
  7000,
  500,
  20000,
);
const OPENAI_TRANSLATE_CONCURRENCY = envInt(
  'OPENAI_TRANSLATE_CONCURRENCY',
  2,
  1,
  4,
);
const OPENAI_TRANSLATE_CACHE_MAX = envInt(
  'OPENAI_TRANSLATE_CACHE_MAX',
  256,
  0,
  1024,
);

const openaiCache = new Map();
const openaiInflight = new Map();
const openaiQueue = [];
let openaiActive = 0;

function cacheTouch(key, value) {
  if (!OPENAI_TRANSLATE_CACHE_MAX) return;
  openaiCache.delete(key);
  openaiCache.set(key, value);
  while (openaiCache.size > OPENAI_TRANSLATE_CACHE_MAX) {
    const oldest = openaiCache.keys().next().value;
    if (oldest == null) break;
    openaiCache.delete(oldest);
  }
}

function runOpenAiLimited(task) {
  return new Promise((resolve, reject) => {
    openaiQueue.push({ task, resolve, reject });
    pumpOpenAiQueue();
  });
}

function pumpOpenAiQueue() {
  while (openaiActive < OPENAI_TRANSLATE_CONCURRENCY && openaiQueue.length) {
    const entry = openaiQueue.shift();
    openaiActive += 1;
    Promise.resolve()
      .then(entry.task)
      .then(entry.resolve, entry.reject)
      .finally(() => {
        openaiActive = Math.max(0, openaiActive - 1);
        pumpOpenAiQueue();
      });
  }
}

function openaiCacheKey(text, field, lang) {
  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  return `${model}\u0000${lang}\u0000${field}\u0000${text}`;
}

async function fetchOpenAiTranslation(text, field, lang, key) {
  const to = lang === 'ar' ? 'Arabic' : 'English';
  const prompt =
    field === 'name'
      ? `Translate this Persian cafe/restaurant dish name to natural concise ${to} menu language. Return ONLY the ${to} name, no quotes:\n${text}`
      : `Translate this Persian dish description to natural concise ${to} for a restaurant menu. Return ONLY the ${to} text:\n${text}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OPENAI_TRANSLATE_TIMEOUT_MS);

  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        temperature: 0.2,
        max_tokens: field === 'name' ? 40 : 160,
        messages: [
          {
            role: 'system',
            content: `You translate Persian restaurant menus to polished ${to}.`,
          },
          { role: 'user', content: prompt },
        ],
      }),
      signal: controller.signal,
    });
    if (!r.ok) return null;
    const data = await r.json();
    const raw = data?.choices?.[0]?.message?.content || '';
    return String(raw)
      .trim()
      .replace(/^["']|["']$/g, '')
      .slice(0, field === 'name' ? 120 : 500);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function openaiTranslate(text, field, lang, { cache = true } = {}) {
  const key = process.env.OPENAI_API_KEY;
  if (!key || !text || !foreignRuntimeAllowed()) return null;

  const cacheKey = openaiCacheKey(text, field, lang);
  if (cache && openaiCache.has(cacheKey)) {
    const value = openaiCache.get(cacheKey);
    cacheTouch(cacheKey, value);
    return value;
  }

  const shared = openaiInflight.get(cacheKey);
  if (shared) return shared;

  const job = runOpenAiLimited(() => fetchOpenAiTranslation(text, field, lang, key));
  openaiInflight.set(cacheKey, job);

  try {
    const translated = await job;
    if (translated && cache) cacheTouch(cacheKey, translated);
    return translated;
  } finally {
    if (openaiInflight.get(cacheKey) === job) openaiInflight.delete(cacheKey);
  }
}

async function translateField(text, field, lang = 'en', options = {}) {
  const cleaned = String(text || '').trim();
  if (!cleaned) return { text: '', engine: 'empty' };
  const ai = await openaiTranslate(cleaned, field, lang, options);
  if (ai) {
    return {
      text: lang === 'en' ? cleanEnLabel(ai) : String(ai).trim(),
      engine: 'openai',
    };
  }
  if (lang === 'ar') {
    // Glossary is reliable for short dish names; long descriptions become
    // mangled — leave empty so the guest UI falls back to cleaned English.
    if (field === 'desc') return { text: '', engine: 'skip-glossary-desc' };
    const ar = glossaryTranslateAr(cleaned, { allowPartial: true });
    if (ar) return { text: ar, engine: 'glossary' };
    return { text: cleaned, engine: 'passthrough' };
  }
  const en = glossaryTranslate(cleaned);
  if (!en || !en.replace(/[^A-Za-z]/g, '')) {
    const salvage = cleanEnLabel(cleaned.replace(/[\u0600-\u06FF]+/g, ' '));
    return { text: salvage || cleaned, engine: salvage ? 'salvage' : 'passthrough' };
  }
  return { text: en, engine: 'glossary' };
}

async function translateMenuItem(item, { force = false, langs = ['en', 'ar'] } = {}) {
  const result = {
    id: item.id,
    name: item.name,
    en: item.en || '',
    descEn: item.descEn || '',
    ar: item.ar || '',
    descAr: item.descAr || '',
    engine: {},
  };

  const needEn = force || !String(item.en || '').trim() || isBrokenEn(item.en);
  const needDescEn =
    force || (item.desc && (!String(item.descEn || '').trim() || isBrokenEn(item.descEn)));
  const needAr =
    force ||
    !String(item.ar || '').trim() ||
    String(item.ar || '').trim() === String(item.name || '').trim() ||
    /[پچژگکی]/.test(String(item.ar || ''));
  const needDescAr =
    force ||
    (item.desc &&
      (!String(item.descAr || '').trim() ||
        String(item.descAr || '').trim() === String(item.desc || '').trim() ||
        /[پچژگکی]/.test(String(item.descAr || '')) ||
        // mangled glossary leftovers (too many isolated Arabic letters / spaces)
        (String(item.descAr || '').split(/\s+/).length > 8 &&
          (String(item.descAr || '').match(/[\u0600-\u06FF]/g) || []).length >
            String(item.descAr || '').length * 0.5 &&
          /[پچژگکیآأإ]/.test(String(item.desc || '')))));

  const pending = [];
  const translationOptions = { cache: !force };

  if (langs.includes('en')) {
    if (needEn) {
      pending.push(
        translateField(item.name, 'name', 'en', translationOptions).then((r) => {
          result.en = r.text;
          result.engine.name = r.engine;
        }),
      );
    } else {
      result.en = cleanEnLabel(item.en) || item.en;
      result.engine.name = 'kept';
    }

    if (needDescEn) {
      if (item.desc) {
        pending.push(
          translateField(item.desc, 'desc', 'en', translationOptions).then((r) => {
            result.descEn = r.text;
            result.engine.desc = r.engine;
          }),
        );
      } else {
        result.descEn = '';
        result.engine.desc = 'empty';
      }
    } else {
      result.descEn = cleanEnLabel(item.descEn) || item.descEn;
      result.engine.desc = 'kept';
    }
  }

  if (langs.includes('ar')) {
    if (needAr) {
      pending.push(
        translateField(item.name, 'name', 'ar', translationOptions).then((r) => {
          result.ar = r.text;
          result.engine.nameAr = r.engine;
        }),
      );
    } else {
      result.engine.nameAr = 'kept';
    }

    if (needDescAr) {
      if (item.desc) {
        pending.push(
          translateField(item.desc, 'desc', 'ar', translationOptions).then((r) => {
            result.descAr = r.text;
            result.engine.descAr = r.engine;
          }),
        );
      } else {
        result.descAr = '';
        result.engine.descAr = 'empty';
      }
    } else {
      result.engine.descAr = 'kept';
    }
  }

  if (pending.length) await Promise.all(pending);
  return result;
}

module.exports = {
  translateField,
  translateMenuItem,
  glossaryTranslate,
  glossaryTranslateAr,
  cleanEnLabel,
  isBrokenEn,
};
