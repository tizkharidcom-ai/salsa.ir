const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('catalogue redesign loads after legacy production styles', () => {
  const html = read('menu.html');
  const production = html.indexOf('css/westo-production-v12.css');
  const catalogue = html.indexOf('css/classic-menu-catalogue-v2.css?v=menuBrand7');

  assert.ok(production >= 0);
  assert.ok(catalogue > production);
  assert.match(html, /id="cm-detail-more"[^>]+aria-expanded="false"/);
  assert.match(html, /id="cm-detail-scroll"[^>]+tabindex="0"/);
});

test('catalogue header keeps the logo contained and removes search and language controls', () => {
  const html = read('menu.html');
  const css = read('css/classic-menu-catalogue-v2.css');

  assert.doesNotMatch(html, /id="cm-search-toggle"|id="cm-search-panel"|id="cm-lang-btn"|id="cm-lang"/);
  assert.match(html, /westo-fa-wordmark-dark\.png\?v=menuCatalogue3/);
  assert.match(css, /\.cm-logo \{ overflow: hidden !important; \}/);
  assert.match(css, /grid-template-columns: minmax\(2\.45rem, 1fr\) auto minmax\(2\.45rem, 1fr\) !important/);
});

test('catalogue navigation and section kicker use the WESTO cyan brand system', () => {
  const css = read('css/classic-menu-catalogue-v2.css');

  assert.match(css, /--cm-brand-cyan: #78d0d8/);
  assert.match(css, /--cm-brand-cyan-deep: #50c0d0/);
  assert.match(css, /\.cm-cats[\s\S]*linear-gradient\(135deg, #b8e8ec 0%, var\(--cm-brand-cyan\) 52%, var\(--cm-brand-cyan-deep\) 100%\)/);
  assert.match(css, /\.cm-section-kicker[\s\S]*color: var\(--cm-brand-ink\)/);
});

test('catalogue brand engineering defines semantic color roles for every surface', () => {
  const css = read('css/classic-menu-catalogue-v2.css');

  for (const token of ['--cm-page:', '--cm-surface:', '--cm-surface-raised:', '--cm-ink:', '--cm-muted:', '--cm-accent:', '--cm-danger:']) {
    assert.ok(css.includes(token), `missing semantic token ${token}`);
  }
  assert.match(css, /--cm-surface: #f8f4ed !important/);
  assert.match(css, /--cm-ink: #1a1714 !important/);
  assert.match(css, /Brand engineering — semantic palette/);
  assert.match(css, /\.cm-item\.is-unavailable[\s\S]*opacity: 1 !important/);
  assert.match(css, /\.table-drawer__panel[\s\S]*var\(--cm-surface-raised\)/);
  assert.match(css, /\.qty-modal__card[\s\S]*var\(--cm-surface-raised\)/);
});

test('catalogue cards and product details keep responsive and scroll guards', () => {
  const css = read('css/classic-menu-catalogue-v2.css');

  assert.match(css, /html body\.classic-menu \.cm-grid[\s\S]*repeat\(3, minmax\(0, 1fr\)\) !important/);
  assert.match(css, /html body\.classic-menu \.cm-item[\s\S]*grid-template-areas: 'body media' !important/);
  assert.match(css, /\.cm-detail\.is-expanded \.cm-detail__scroll[\s\S]*overflow-y: auto/);
  assert.match(css, /@media \(max-width: 559px\)[\s\S]*\.cm-grid \{ grid-template-columns: 1fr !important/);
  assert.match(css, /max-width: 100% !important;[\s\S]*max-height: 100dvh !important/);
});

test('catalogue interactions preserve item ids and use the existing cart owner', () => {
  const js = read('js/classic-menu.js');

  assert.match(js, /window\.westoTable\?\.addDirect/);
  assert.match(js, /data-id="\$\{m\.id\}" role="button" tabindex="0"/);
  assert.match(js, /function setDetailExpanded\(expanded\)/);
  assert.match(js, /url\.searchParams\.set\('item', String\(detailItem\.id\)\)/);
  assert.match(js, /event\.target\.matches\('\.cm-item\[data-id\]'\)/);
});

test('Persian catalogue uses genuine RTL flow and a readable currency label', () => {
  const html = read('menu.html');
  const js = read('js/classic-menu.js');

  assert.match(html, /<html lang="fa" dir="rtl"/);
  assert.match(html, /<body class="classic-menu" lang="fa" dir="rtl">/);
  assert.match(js, /document\.documentElement\.dir = textDir/);
  assert.match(js, /document\.body\.dir = textDir/);
  assert.doesNotMatch(js, /<small>IRT<\/small>/);
  assert.match(js, /<small>.*تومان.*<\/small>/);
});
