'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const viewPaths = [
  path.join(root, 'prototype/js/views/gm22-operations.js'),
  path.join(root, 'superadmin/frontend/js/views/gm22-operations.js')
];
const sources = viewPaths.map(file => fs.readFileSync(file, 'utf8'));

function loadView(source, state = 'live') {
  const notices = [];
  const calls = { refresh: 0, request: 0 };
  const context = {
    prototypeStore: {
      getIncidents: () => [{ title: 'fixture incident', impact: 'fixture impact' }],
      getProvidersStatus: () => [{ name: 'fixture provider', type: 'SMS Gateway', status: 'operational' }],
      getTenants: () => []
    },
    GMApp: { showToast: (message, tone) => notices.push({ message, tone }) },
    GMDataState: {
      renderFreshnessBar: () => { throw new Error('GM22 must not use the local-success freshness refresh control'); },
      renderDataQualityBadges: () => '',
      getViewState: () => ({ state }),
      renderFailedState: () => '<div>failed</div>',
      renderEmptyState: options => {
        context.emptyAction = options.onAction;
        return '<div>empty</div>';
      },
      renderSkeleton: () => '<div>loading</div>',
      renderStaleBanner: () => '<div>stale</div>',
      renderRefreshingBanner: () => '<div>refreshing</div>'
    },
    setTimeout: () => 1,
    ControlPlaneClient: { request: () => { calls.request++; throw new Error('unexpected request'); } },
    fetch: () => { calls.request++; throw new Error('unexpected request'); }
  };
  context.window = context;
  vm.runInNewContext(source, context, { filename: 'gm22-operations.js' });
  const html = context.renderGM22();
  return { context, html, notices, calls };
}

test('paired GM-22 views keep parity and unsupported controls never claim operational success', () => {
  assert.equal(sources[0], sources[1], 'prototype and superadmin GM-22 views must remain paired');

  for (const source of sources) {
    const { context, html, notices, calls } = loadView(source);
    assert.match(html, /پایش برخط \(غیرفعال\)/);
    assert.match(html, /showUnavailable\('گزارش تفصیلی RCA'\)/);
    assert.match(html, /پیش‌نمایش محلی/);
    assert.match(html, /تازه‌سازی عملیاتی در دسترس نیست/);
    assert.doesNotMatch(html, /GMDataState\.refreshView\('GM22'\)|هارت‌بیت فعال و تأخیر پاسخ .* سنجش شد|لاگ کامل رخداد در سیستم ممیزی درج شده است/);

    for (const action of ['پایش برخط ارتباط', 'گزارش تفصیلی RCA']) {
      assert.equal(context.GMViews.GM22.showUnavailable(action), false);
    }
    assert.equal(calls.request, 0, 'unavailable actions must not call fetch or ControlPlaneClient');
    assert.equal(notices.length, 2);
    assert.ok(notices.every(notice => notice.tone === 'warning'));
    assert.ok(notices.every(notice => /هیچ درخواستی ارسال یا ممیزی ثبت نشد/.test(notice.message)));
  }
});

test('GM-22 empty-state refresh shows a non-success warning instead of locally marking data live', () => {
  for (const source of sources) {
    const { context, html, notices } = loadView(source, 'empty');
    assert.match(html, /empty/);
    assert.match(context.emptyAction, /showUnavailable\('پایش مجدد'\)/);
    vm.runInNewContext(context.emptyAction, context);
    assert.equal(notices.length, 1);
    assert.equal(notices[0].tone, 'warning');
    assert.match(notices[0].message, /هیچ درخواستی ارسال یا ممیزی ثبت نشد/);
  }
});
