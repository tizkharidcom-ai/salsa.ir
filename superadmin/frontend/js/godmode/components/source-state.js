/**
 * prototype/js/godmode/components/source-state.js
 *
 * Data Provenance Component (superadmin.md §14.2 & §14.3).
 * Renders data source truth: Live, Stale, Demo, or Unknown.
 */

(function (global) {
  'use strict';

  function formatRelativeTime(isoString) {
    if (!isoString) return 'نامشخص';
    try {
      const diffMs = Date.now() - new Date(isoString).getTime();
      const diffMin = Math.floor(diffMs / 60000);
      if (diffMin < 1) return 'چند لحظه پیش';
      if (diffMin < 60) return `${diffMin} دقیقه پیش`;
      const diffHours = Math.floor(diffMin / 60);
      if (diffHours < 24) return `${diffHours} ساعت پیش`;
      return `${Math.floor(diffHours / 24)} روز پیش`;
    } catch (_) {
      return 'نامشخص';
    }
  }

  function renderSourceBadge(meta = {}) {
    const status = String(meta.status || 'live').toLowerCase();
    const observedAt = meta.observedAt || meta.lastObservedAt;
    const timeText = observedAt ? formatRelativeTime(observedAt) : '';

    if (status === 'demo') {
      return `<span class="badge badge-warning" title="داده نمایشی محلی"><span class="status-dot dot-yellow" aria-hidden="true"></span>داده دمو</span>`;
    }
    if (status === 'stale') {
      return `<span class="badge badge-warning" title="آخرین مشاهده: ${timeText}"><span class="status-dot dot-yellow" aria-hidden="true"></span>تله‌متری کهنه (${timeText})</span>`;
    }
    if (status === 'failed' || status === 'unknown') {
      return `<span class="badge badge-neutral" title="داده زنده از سرور دریافت نشد"><span class="status-dot dot-gray" aria-hidden="true"></span>داده دریافت نشد</span>`;
    }
    // Live
    return `<span class="badge badge-success" title="داده زنده — دریافت ${timeText}"><span class="status-dot dot-green" aria-hidden="true"></span>زنده (${timeText})</span>`;
  }

  global.SourceState = Object.freeze({
    renderSourceBadge,
    formatRelativeTime
  });
})(typeof window !== 'undefined' ? window : globalThis);
