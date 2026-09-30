'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const finance = require('../server/finance-v2');
const accounting = require('../server/accounting-engine');

const context = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../js/admin/modules/finance/accounting-experience.js'), 'utf8'), context);
const experience = context.window.WestoAccountingExperience;
const plain = value => JSON.parse(JSON.stringify(value));
const accounts = [{ code: '1110', isPostingAccount: true }, { code: '4110', isPostingAccount: true }, { code: '1000', isPostingAccount: false }, { code: '6990', isPostingAccount: true, active: false }];
const rows = () => [{ account: '۱۱۱۰ · صندوق', debit: '۱٬۲۵۰', credit: '', memo: 'شرح فارسی حفظ می‌شود' }, { account: '4110', debit: '', credit: '1,250', memo: '' }];

test('all accounting destinations resolve to existing workspaces, including close/opening/migration', () => {
  const allowed = new Set(['workbench', 'sales_bank', 'purchases', 'costing', 'ledger_close']);
  for (const view of experience.views) {
    for (const tab of view.tabs.length ? view.tabs : [['', '']]) {
      assert.ok(allowed.has(experience.routeFor(view, tab[0]).workspace));
      assert.equal(experience.tabFor(view, tab[0]), tab[0]);
    }
  }
  assert.equal(experience.views.filter(view => !view.utility).length, 10);
  assert.deepEqual(plain(experience.routeFor(experience.resolve('periods'), 'opening')), { workspace: 'ledger_close', operation: 'periods' });
  assert.deepEqual(plain(experience.routeFor(experience.resolve('settings'), 'migration')), { workspace: 'workbench', operation: 'events' });
  assert.equal(experience.resolve('', 'workbench', 'approvals').id, 'approvals');
});

test('journal amounts normalize Persian and Arabic digits and convert integer tomans exactly', () => {
  const input = rows(); input[1].credit = '١٬٢٥٠';
  const result = experience.journalLines(input, 4, accounts);
  assert.equal(result.debitIrr, 12500);
  assert.equal(result.creditIrr, 12500);
  assert.deepEqual(plain(result.lines.map(line => [line.branchId, line.costCenter])), [[4, 'branch:4'], [4, 'branch:4']]);
  assert.equal(result.lines[0].memo, 'شرح فارسی حفظ می‌شود');
});

test('invalid, negative, fractional, unsafe and conflicting amounts cannot become a journal', () => {
  for (const value of ['-5', '1.5', '1٫000', '1,25', '12abc', '۱/۲', '900719925474100']) {
    const input = rows(); input[0].debit = value;
    assert.throws(() => experience.journalLines(input, 4, accounts), undefined, value);
  }
  const both = rows(); both[0].credit = '1';
  assert.throws(() => experience.journalLines(both, 4, accounts), /یک مبلغ/);
  const zero = rows(); zero[0].debit = '';
  assert.throws(() => experience.journalLines(zero, 4, accounts), /یک مبلغ/);
  const many = [{ account: '1110', debit: '500000000000000' }, { account: '1110', debit: '500000000000000' }, { account: '4110', credit: '500000000000000' }, { account: '4110', credit: '500000000000000' }];
  assert.throws(() => experience.journalLines(many, 4, accounts), /جمع سند/);
});

test('unknown, parent and inactive accounts, missing branch and unbalanced journals fail closed', () => {
  for (const code of ['9999', '1000', '6990']) {
    const input = rows(); input[0].account = code;
    assert.throws(() => experience.journalLines(input, 4, accounts), /حساب/);
  }
  for (const branch of [0, null, -1, 1.5, 'invalid']) assert.throws(() => experience.journalLines(rows(), branch, accounts), /شعبه/);
  const unbalanced = rows(); unbalanced[1].credit = '1000';
  assert.throws(() => experience.journalLines(unbalanced, 4, accounts), /تراز/);
  const totals = experience.journalLines(unbalanced, 4, accounts, { allowUnbalanced: true });
  assert.equal(totals.debitIrr - totals.creditIrr, 2500);
  assert.throws(() => experience.journalLines([rows()[0]], 4, accounts), /دو/);
});

test('a multi-line UI payload creates only a balanced draft in an isolated real engine fixture', () => {
  const db = {}; const chart = accounting.ensureAccountingData(db).accounts;
  const result = experience.journalLines([
    { account: '1110', debit: '700', memo: 'نقد' },
    { account: '1210', debit: '550', memo: 'بانک' },
    { account: '4110', credit: '1250', memo: 'فروش' },
  ], 4, chart);
  const entry = finance.createDraft(db, { branchId: 4, date: '2026-09-30T12:00:00.000Z', description: 'سند تست جدا از اطلاعات واقعی', lines: plain(result.lines) }, 'test-accountant');
  assert.equal(entry.status, 'draft');
  assert.equal(entry.lines.length, 3);
  assert.equal(entry.debitIrr, 12500);
  assert.equal(entry.creditIrr, 12500);
  assert.equal(entry.postedAt, null);
  assert.equal(db.financeV2.approvals.length, 0);
  assert.equal(db.financeV2.journalEntries.length, 1);
});

test('a daily expense UI payload preserves Persian description and creates an independent approval', () => {
  const db = { financeV2: { fiscalPeriods: [{ id: 'test-open', branchId: 4, startDate: '2026-01-01', endDate: '2026-12-31', status: 'open' }] } };
  accounting.ensureAccountingData(db);
  const result = finance.createOperatingExpenseV2(db, {
    branchId: 4, subject: 'قبض برق آزمایشی', category: 'utilities', date: '2026-09-30', paymentMethod: 'bank',
    amountIrr: experience.tomanToIrr('۱٬۲۵۰'), reference: 'fixture-only',
  }, 'test-accountant');
  assert.equal(result.expense.subject, 'قبض برق آزمایشی');
  assert.equal(result.expense.amountIrr, 12500);
  assert.equal(result.expense.status, 'pending_approval');
  assert.equal(result.journalEntry.status, 'pending_approval');
  assert.equal(result.journalEntry.postedAt, null);
  assert.equal(result.approval.createdBy, 'test-accountant');
  assert.equal(result.approval.decidedBy, null);
  assert.ok(result.journalEntry.lines.every(line => line.branchId === 4));
});

test('local search, status and account category combine instead of overwriting one another', () => {
  const row = { text: '۱۱۱۰ صندوق شعبه يك', statuses: ['بدهکار'], accountCode: '۱۱۱۰ صندوق' };
  assert.equal(experience.rowMatches(row, '1110', 'بدهکار', '1'), true);
  assert.equal(experience.rowMatches(row, 'یک', '', '1'), true);
  assert.equal(experience.rowMatches(row, 'صندوق', 'بستانکار', '1'), false);
  assert.equal(experience.rowMatches(row, 'صندوق', 'بدهکار', '6'), false);
  assert.equal(experience.rowMatches(row, 'فروش', 'بدهکار', '1'), false);
  assert.equal(experience.rowMatches(row, '', '', 'all'), true);
});

test('aging selection filters invoice rows without hiding unrelated payment tables', () => {
  const invoice = { text: 'فاکتور تأمین‌کننده', agingBucket: 'days90Plus' };
  assert.equal(experience.rowMatches(invoice, '', '', 'all', 'days90Plus'), true);
  assert.equal(experience.rowMatches(invoice, '', '', 'all', 'current'), false);
  assert.equal(experience.rowMatches({ text: 'درخواست پرداخت' }, '', '', 'all', 'current'), true);
  assert.equal(experience.rowMatches(invoice, 'حقوق', '', 'all', 'days90Plus'), false);
});

test('filter count and empty state follow the actual combined visible rows and reset', () => {
  const makeRow = (text, status, code) => ({ textContent: text, style: { display: '' }, dataset: {}, hidden: false,
    querySelectorAll: selector => selector === '.fin-badge' ? [{ textContent: status }] : [],
    querySelector: selector => selector === 'td' ? { textContent: code } : null });
  const rows = [makeRow('1110 صندوق', 'بدهکار', '1110'), makeRow('4110 فروش', 'بستانکار', '4110')];
  const count = {}; const empty = {}; const clear = {};
  const content = {
    querySelectorAll: selector => selector === '[data-fin-clear-list]' ? [clear] : rows,
    querySelector: selector => ({ '[data-fin-visible-count]': count, '[data-fin-filter-empty]': empty }[selector]),
  };
  assert.deepEqual(plain(experience.filterList(content, 'صندوق', 'بدهکار', '1')), { visible: 1, total: 2 });
  assert.equal(rows[0].hidden, false); assert.equal(rows[1].hidden, true); assert.equal(empty.hidden, true);
  assert.deepEqual(plain(experience.filterList(content, 'صندوق', 'بدهکار', '6')), { visible: 0, total: 2 });
  assert.equal(count.textContent, '۰ از ۲ مورد این صفحه'); assert.equal(empty.hidden, false); assert.equal(clear.hidden, false);
  assert.deepEqual(plain(experience.filterList(content, '', '', 'all')), { visible: 2, total: 2 });
  assert.equal(empty.hidden, true); assert.equal(clear.hidden, true);
});

test('quick ranges contain exactly 7 or 30 calendar dates, including leap days and year boundaries', () => {
  assert.deepEqual(plain(experience.dateRange('7d', '2026-01-03')), { from: '2025-12-28', to: '2026-01-03' });
  assert.deepEqual(plain(experience.dateRange('30d', '2024-03-01')), { from: '2024-02-01', to: '2024-03-01' });
  for (const today of ['2026-09-30', '2026-03-09', '2026-11-02']) {
    for (const [preset, days] of [['7d', 7], ['30d', 30]]) {
      const range = experience.dateRange(preset, today);
      assert.equal((Date.parse(range.to) - Date.parse(range.from)) / 86400000 + 1, days);
      assert.equal(experience.datePreset(range, today), preset);
    }
  }
  assert.equal(experience.datePreset({ from: '2026-08-31', to: '2026-09-30' }, '2026-09-30'), 'custom');
  assert.equal(experience.datePreset({}, '2026-09-30'), 'all');
});

test('review includes explicit yes/no choices, selected labels and escapes user descriptions', () => {
  const field = (name, type, value, title, checked = false) => ({ name, type, value, checked, tagName: 'INPUT',
    closest: selector => selector === 'label' ? { querySelector: () => ({ textContent: title }) } : null });
  const description = field('subject', 'text', '<img onerror="unsafe">', 'شرح');
  const checkbox = field('confirm', 'checkbox', 'on', 'تأیید مستقل', false);
  const select = field('method', 'select-one', 'bank', 'روش پرداخت'); select.tagName = 'SELECT'; select.selectedOptions = [{ textContent: 'بانک' }];
  const hidden = field('branchId', 'hidden', '4', 'شعبه');
  const form = { id: 'fin-operating-expense-form', querySelectorAll: selector => selector === '[data-fin-journal-row]' ? [] : [description, checkbox, select, hidden], querySelector: () => null };
  const html = experience.reviewMarkup(form, 4);
  assert.ok(html.includes('&lt;img onerror=&quot;unsafe&quot;&gt;'));
  assert.ok(html.includes('<dd>خیر</dd>')); assert.ok(html.includes('<dd>بانک</dd>'));
  assert.ok(!html.includes('<img')); assert.ok(!html.includes('<dt>شعبه</dt>'));
});

test('accounting text, status and action color pairs retain readable contrast in both themes', () => {
  const css = fs.readFileSync(path.join(__dirname, '../css/admin-accounting-experience.css'), 'utf8');
  const blocks = [css.match(/\.finance-v2\.fin-experience\s*\{([\s\S]*?)\}/)[1], css.match(/html\[data-theme='dark'\] \.finance-v2\.fin-experience\s*\{([\s\S]*?)\}/)[1]];
  const luminance = hex => {
    const full = hex.length === 4 ? '#' + [...hex.slice(1)].map(c => c+c).join('') : hex;
    const channels = full.slice(1).match(/../g).map(c => parseInt(c, 16) / 255).map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4);
    return channels[0]*.2126 + channels[1]*.7152 + channels[2]*.0722;
  };
  const contrast = (a,b) => (Math.max(luminance(a),luminance(b))+.05)/(Math.min(luminance(a),luminance(b))+.05);
  blocks.forEach((block, theme) => {
    const colors = Object.fromEntries([...block.matchAll(/--fin-([\w-]+):\s*(#[a-f\d]+);/g)].map(match => [match[1],match[2]]));
    for (const foreground of ['text','muted']) for (const background of ['surface','surface-2','bg']) assert.ok(contrast(colors[foreground],colors[background]) >= 4.5, `${theme} ${foreground}/${background}`);
    for (const tone of ['primary','success','warning','danger']) assert.ok(contrast(colors[tone],colors[`${tone}-soft`]) >= 4.5, `${theme} ${tone}`);
    assert.ok(contrast(theme ? '#111a29' : '#fff', colors.primary) >= 4.5);
  });
});
