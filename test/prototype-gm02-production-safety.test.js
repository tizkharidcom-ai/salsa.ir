'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(
  path.join(__dirname, '../prototype/js/views/gm02-overview.js'),
  'utf8'
);

function loadOverview() {
  const notices = [];
  const reads = { tenants: 0, tickets: 0, jobs: 0 };
  const sampleTenant = { id: 'tnt_sample_only', name: 'مجموعه نمونه نباید نمایش داده شود' };
  const store = {
    getTenants: () => { reads.tenants++; return [sampleTenant]; },
    getTickets: () => { reads.tickets++; return [{ id: 'ticket-sample', title: 'تیکت نمونه', status: 'open' }]; },
    getJobs: () => { reads.jobs++; return [{ id: 'job-sample', status: 'running' }]; },
    isLiveConnected: () => false,
    getProvenance: () => ({
      isLive: false,
      sourceKind: 'mock_fixture',
      status: 'mock',
      completeness: 'not_operational'
    })
  };
  const context = {
    prototypeStore: store,
    GMDataState: { getViewState: () => ({ state: 'live' }) },
    showToast: (message, tone) => notices.push({ message, tone })
  };
  context.window = context;
  vm.runInNewContext(source, context, { filename: 'gm02-overview.js' });
  return { context, notices, reads };
}

test('GM-02 hides sample overview data until an operational source is verified', () => {
  const { context, reads } = loadOverview();
  const html = context.renderGM02();

  assert.match(html, /داده عملیاتی داشبورد در دسترس نیست/);
  assert.match(html, /بررسی وضعیت اتصال/);
  assert.doesNotMatch(html, /مجموعه نمونه نباید نمایش داده شود|تیکت نمونه|tnt_sample_only/);
  assert.doesNotMatch(html, /SLA ۹۹\.۹۸٪|btn-gm02-refresh|gm02-hero-command-bar|gm02-data-table/);
  assert.doesNotMatch(html, /GM02\.(?:flushCache|simulateLoad|runDiagnostic|pingService)\(\)/);
  assert.deepEqual(reads, { tenants: 0, tickets: 0, jobs: 0 });
});

test('GM-02 preview controls fail closed and never report simulated success', () => {
  const { context, notices } = loadOverview();
  const actions = [
    () => context.GM02.refreshDashboard(),
    () => context.GM02.pingService(0),
    () => context.GM02.simulateLoad(),
    () => context.GM02.flushCache(),
    () => context.GM02.verifyAudit(),
    () => context.GM02.runDiagnostic()
  ];

  for (const action of actions) assert.equal(action(), false);
  assert.equal(notices.length, actions.length);
  assert.ok(notices.every((notice) => notice.tone === 'warning'));
  assert.ok(notices.every((notice) => /هیچ تغییری|اجرا نشد|تأیید نشد/.test(notice.message)));
  assert.ok(!notices.some((notice) => notice.tone === 'success'));
});
