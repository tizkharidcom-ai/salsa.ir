/**
 * prototype/js/godmode/components/status-badge.js
 *
 * Status Badge Component with Strict Taxonomy (superadmin.md §19.2).
 * Strictly separates Lifecycle from Operational Health.
 * Never relies on color alone; includes text and semantic icons.
 */

(function (global) {
  'use strict';

  function renderLifecycleBadge(status) {
    const s = String(status || 'active').toLowerCase();
    switch (s) {
      case 'active':
        return '<span class="badge badge-success" title="چرخه عمر: فعال"><span class="status-dot dot-green" aria-hidden="true"></span>فعال</span>';
      case 'trial':
        return '<span class="badge badge-info" title="چرخه عمر: آزمایشی"><span class="status-dot dot-cyan" aria-hidden="true"></span>آزمایشی</span>';
      case 'provisioning':
      case 'setting_up':
        return '<span class="badge badge-warning" title="چرخه عمر: در حال راه‌اندازی"><span class="status-dot dot-yellow" aria-hidden="true"></span>در حال راه‌اندازی</span>';
      case 'grace_period':
      case 'past_due':
        return '<span class="badge badge-warning" title="چرخه عمر: مهلت پرداخت (Grace Period)"><span class="status-dot dot-yellow" aria-hidden="true"></span>مهلت پرداخت</span>';
      case 'suspended':
        return '<span class="badge badge-danger" title="چرخه عمر: معلق شده"><span class="status-dot dot-red" aria-hidden="true"></span>معلق</span>';
      case 'cancelled':
      case 'archived':
        return '<span class="badge badge-neutral" title="چرخه عمر: لغو شده"><span class="status-dot dot-gray" aria-hidden="true"></span>بایگانی</span>';
      default:
        return `<span class="badge badge-neutral"><span class="status-dot dot-gray" aria-hidden="true"></span>${s}</span>`;
    }
  }

  function renderHealthBadge(health) {
    const h = String(health || 'healthy').toLowerCase();
    switch (h) {
      case 'healthy':
        return '<span class="badge badge-success" title="سلامت پلتفرم: پایدار"><span class="status-dot dot-green" aria-hidden="true"></span>پایدار</span>';
      case 'attention':
        return '<span class="badge badge-warning" title="سلامت پلتفرم: نیازمند توجه"><span class="status-dot dot-yellow" aria-hidden="true"></span>نیازمند توجه</span>';
      case 'incident':
      case 'failed':
      case 'degraded':
        return '<span class="badge badge-danger" title="سلامت پلتفرم: دارای رخداد فعال"><span class="status-dot dot-red" aria-hidden="true"></span>رخداد فعال</span>';
      case 'unknown':
      default:
        return '<span class="badge badge-neutral" title="سلامت پلتفرم: داده دریافت نشد"><span class="status-dot dot-gray" aria-hidden="true"></span>نامشخص</span>';
    }
  }

  function renderModuleStateBadge(state) {
    const st = String(state || 'not_purchased').toLowerCase();
    switch (st) {
      case 'included':
        return '<span class="badge badge-success" title="شامل پلن اشتراک"><span class="status-dot dot-green" aria-hidden="true"></span>شامل پلن</span>';
      case 'addon':
        return '<span class="badge badge-info" title="افزونه خریداری‌شده"><span class="status-dot dot-cyan" aria-hidden="true"></span>افزونه تجاری</span>';
      case 'override':
      case 'trial':
        return '<span class="badge badge-warning" title="استثنای اختصاصی موقت"><span class="status-dot dot-yellow" aria-hidden="true"></span>استثنای موقت</span>';
      case 'globally_disabled':
        return '<span class="badge badge-danger" title="توقف اضطراری سراسری"><span class="status-dot dot-red" aria-hidden="true"></span>توقف سراسری</span>';
      case 'suspended':
        return '<span class="badge badge-danger" title="مسدود به دلیل تعلیق سرویس"><span class="status-dot dot-red" aria-hidden="true"></span>مسدود</span>';
      case 'not_purchased':
      default:
        return '<span class="badge badge-neutral" title="خریداری نشده"><span class="status-dot dot-gray" aria-hidden="true"></span>خریداری نشده</span>';
    }
  }

  global.StatusBadge = Object.freeze({
    renderLifecycleBadge,
    renderHealthBadge,
    renderModuleStateBadge
  });
})(typeof window !== 'undefined' ? window : globalThis);
