'use strict';

function taxRuleInputError(code, message, status = 400) {
  return Object.assign(new Error(message), { code, status });
}

function validDateOnly(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function checkoutTaxCategoriesPatch(input, settings) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw taxRuleInputError('tax_matrix_patch_invalid', 'تنظیمات گروه مالیاتی معتبر نیست.');
  }
  const patch = {};
  const categories = Array.isArray(settings?.categories) ? settings.categories : [];
  for (const key of ['defaultCategory', 'deliveryFeeTaxCategory']) {
    if (!Object.prototype.hasOwnProperty.call(input, key)) continue;
    const value = input[key] == null ? '' : String(input[key]).trim();
    if (!value && key === 'deliveryFeeTaxCategory') {
      patch.deliveryFeeTaxCategory = '';
      continue;
    }
    const category = categories.find((item) => String(item?.code || '') === value);
    if (!category || category.exempt === true) {
      throw taxRuleInputError('tax_category_invalid', `گروه مالیاتی «${key}» معتبر یا قابل استفاده برای سفارش نیست.`);
    }
    patch[key] = value;
  }
  if (!Object.keys(patch).length) {
    throw taxRuleInputError('tax_matrix_patch_empty', 'گروه پیش‌فرض یا گروه مالیاتی هزینهٔ ارسال را مشخص کنید.');
  }
  return patch;
}

function prepareBranchTaxRule(input, settings, branches, allowedBranchIds = null) {
  const body = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const categories = Array.isArray(settings?.categories) ? settings.categories : [];
  const rules = Array.isArray(settings?.rules) ? settings.rules : [];
  const taxCategory = String(body.taxCategory || '').trim();
  const category = categories.find((item) => String(item?.code || '') === taxCategory);
  if (!category || category.exempt === true) {
    throw taxRuleInputError('tax_category_invalid', 'گروه مالیاتی کالا یا خدمت معتبر نیست.');
  }

  const rawBranchId = body.locationId ?? body.branchId;
  const digits = String(rawBranchId ?? '').trim()
    .replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
    .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)));
  const branchId = Number(digits);
  if (!/^\d+$/.test(digits) || !Number.isSafeInteger(branchId) || branchId <= 0
      || !(Array.isArray(branches) ? branches : []).some((branch) => Number(branch?.id) === branchId)) {
    throw taxRuleInputError('tax_branch_required', 'برای قاعدهٔ سفارش، یک شعبهٔ ثبت‌شده را انتخاب کنید.');
  }
  if (Array.isArray(allowedBranchIds)
      && !allowedBranchIds.map(Number).includes(branchId)) {
    throw taxRuleInputError('tax_branch_forbidden', 'اجازهٔ تغییر قواعد مالیاتی این شعبه را ندارید.', 403);
  }

  const rate = typeof body.rate === 'number' ? body.rate : Number(String(body.rate ?? '').trim());
  if (body.rate === undefined || body.rate === null || String(body.rate).trim() === ''
      || !Number.isFinite(rate) || rate < 0 || rate > 1) {
    throw taxRuleInputError('tax_rate_required', 'نرخ تأییدشده را صریحاً بین صفر تا یک وارد کنید؛ نرخ پیش‌فرض اعمال نمی‌شود.');
  }
  if (typeof body.inclusive !== 'boolean') {
    throw taxRuleInputError('tax_inclusive_required', 'مشخص کنید قیمت شامل مالیات است یا مالیات جداگانه محاسبه می‌شود.');
  }
  const code = String(body.code || '').trim();
  const name = String(body.name || '').trim();
  const legalSource = String(body.legalSource || '').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{1,79}$/.test(code)
      || !name || name.length > 120 || !legalSource || legalSource.length > 500) {
    throw taxRuleInputError('tax_rule_evidence_required', 'کد پایدار، عنوان و مأخذ قانونی قاعده را کامل کنید.');
  }
  if (!validDateOnly(body.effectiveFrom)) {
    throw taxRuleInputError('tax_effective_date_required', 'تاریخ شروع اثر قاعده باید به شکل YYYY-MM-DD مشخص شود.');
  }
  const effectiveTo = body.effectiveTo == null || String(body.effectiveTo).trim() === ''
    ? null : String(body.effectiveTo).trim();
  if ((effectiveTo && !validDateOnly(effectiveTo)) || (effectiveTo && effectiveTo < body.effectiveFrom)) {
    throw taxRuleInputError('tax_effective_period_invalid', 'بازهٔ اثر قاعدهٔ مالیاتی معتبر نیست.');
  }
  const fulfillmentType = body.fulfillmentType == null || body.fulfillmentType === ''
    ? null : String(body.fulfillmentType).trim().toLowerCase();
  if (fulfillmentType != null && !['dine_in', 'pickup', 'delivery'].includes(fulfillmentType)) {
    throw taxRuleInputError('tax_fulfillment_invalid', 'روش دریافت برای قاعدهٔ مالیاتی معتبر نیست.');
  }

  const sameScope = (rule) => String(rule?.taxCategory || '') === taxCategory
    && String(rule?.locationId ?? '') === String(branchId)
    && String(rule?.fulfillmentType || '') === String(fulfillmentType || '');
  const overlaps = (rule) => String(rule?.status || 'active').toLowerCase() === 'active' && sameScope(rule)
    && (!rule.effectiveTo || String(rule.effectiveTo).slice(0, 10) >= body.effectiveFrom)
    && (!effectiveTo || !rule.effectiveFrom || String(rule.effectiveFrom).slice(0, 10) <= effectiveTo);
  if (rules.some((rule) => overlaps(rule) && String(rule.code || '') !== code)) {
    throw taxRuleInputError('tax_rule_scope_conflict', 'برای همین بازه، شعبه و روش دریافت یک کد مالیاتی فعال دیگر وجود دارد.');
  }

  const priorVersions = rules.filter((rule) => sameScope(rule) && String(rule?.code || '') === code)
    .map((rule) => Number(rule.version)).filter((version) => Number.isSafeInteger(version) && version > 0);
  const version = priorVersions.length ? Math.max(...priorVersions) + 1 : 1;
  return {
    id: `tax-${branchId}-${code}-${version}`,
    code,
    name,
    taxCategory,
    rate,
    inclusive: body.inclusive,
    fulfillmentType,
    locationId: branchId,
    status: 'active',
    version,
    effectiveFrom: body.effectiveFrom,
    effectiveTo,
    legalSource,
  };
}

module.exports = { checkoutTaxCategoriesPatch, prepareBranchTaxRule, validDateOnly };
