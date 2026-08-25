'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');

const bundles = {
  'css/westo-critical.smart.css': [
    'css/mobile-forms.css',
    'css/westo.webflow.shared.min.css',
    'css/fa-override.css',
    'css/i18n-dir.css',
    'css/entrance-gate.css',
    'css/entrance-gate-redesign.css',
    'css/table.css',
    'css/responsive-shell.css',
    'css/menu-story.css',
    // Keep glass once at the final cascade position; the earlier identical copy was redundant.
    'css/westo-glass.css',
    // Global local typography must remain inside the single critical stylesheet on /
    // so Smart Loading keeps exactly one parser-blocking CSS request.
    'css/vazir-system.css',
    // Production design system override stays inside the single critical stylesheet.
    'css/westo-production-v12.css',
    // Entrance promo deck is mounted inside the experience block.
    'css/entrance-promo-deck.css',
    'css/westo-v14.1-experience-polish.css',
    'css/westo-v14.3-ultra-fine.css',
    'css/westo-ultra-fine-v1.2.css',
    // Dish detail card visual ownership stays isolated from page chrome/media.
    'css/westo-dish-card-premium.css',
    // Installed-app geometry must be the final cascade owner.
    'css/westo-pwa.css',
    // Final orientation-only reconciliation for the three mobile landscape scenes.
    'css/westo-landscape-recovery.css',
  ],
  'js/westo-foundation.smart.js': [
    'js/i18n.js',
    'js/category-theme.js',
    'js/menu-store.js',
    'js/content-overrides.js',
    'js/theme.js',
    'js/westo-entrance.js',
    'js/entrance-promo-deck.js',
    'js/subcategory-kill-switch.js',
    'js/brand-lockup.js',
    'js/language-switch-rescue.js',
    'js/design-logic-v13.js',
  ],
  'js/westo-motion.smart.js': [
    'js/vendor/gsap.min.js',
    'js/vendor/ScrollTrigger.min.js',
    'js/vendor/SplitText.min.js',
  ],
  'js/westo-hero.smart.js': [
    'js/animations.js',
    'js/sounds.js',
  ],
  'js/westo-menu.smart.js': [
    'js/buttons.js',
    'js/table-cart.js',
  ],
  'js/westo-background.smart.js': [
    'js/auth-nav.js',
    'js/analytics-beacon.js',
  ],
  // Critical app runtime in dependency order. Keeping this as a single parser
  // request removes two high-latency request/execute barriers on mobile links
  // while preserving the smaller source bundles for debugging and validation.
  'js/westo-app.smart.js': [
    'js/i18n.js',
    'js/category-theme.js',
    'js/menu-store.js',
    'js/content-overrides.js',
    'js/theme.js',
    'js/westo-entrance.js',
    'js/entrance-promo-deck.js',
    'js/subcategory-kill-switch.js',
    'js/brand-lockup.js',
    'js/language-switch-rescue.js',
    'js/design-logic-v13.js',
    'js/vendor/gsap.min.js',
    'js/vendor/ScrollTrigger.min.js',
    'js/vendor/SplitText.min.js',
    'js/buttons.js',
    'js/table-cart.js',
    'js/animations.js',
    'js/sounds.js',
    // Presentation enhancer only; original state machines remain authoritative.
    'js/westo-production-v12.js',
    'js/westo-v14.3-ultra-fine.js',
  ],
};

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function writeBundle(outRel, sources) {
  const isCss = outRel.endsWith('.css');
  const chunks = [
    `/* WESTO Smart Load generated bundle: ${outRel}\n   Sources: ${sources.join(', ')}\n*/\n`,
  ];
  for (const rel of sources) {
    chunks.push(`\n/* ===== BEGIN ${rel} ===== */\n`);
    chunks.push(read(rel));
    chunks.push(isCss ? `\n/* ===== END ${rel} ===== */\n` : `\n;/* ===== END ${rel} ===== */\n`);
    // Menu/hero code may use ScrollTrigger during module initialization, so
    // register motion plugins immediately after the motion vendor trio rather
    // than waiting until the end of the combined app bundle.
    if (!isCss && rel === 'js/vendor/SplitText.min.js') {
      chunks.push('\n;try { if (window.gsap) window.gsap.registerPlugin(window.ScrollTrigger, window.SplitText); } catch (_) {}\n');
    }
  }
  const output = chunks.join('');
  fs.writeFileSync(path.join(ROOT, outRel), output);
  return {
    file: outRel,
    bytes: Buffer.byteLength(output),
    gzipEstimate: null,
    sha256: crypto.createHash('sha256').update(output).digest('hex'),
    sources,
  };
}

const manifest = {
  schema: 'westo-smart-load-bundles-v1',
  generatedAt: new Date().toISOString(),
  bundles: Object.entries(bundles).map(([outRel, sources]) => writeBundle(outRel, sources)),
};

fs.writeFileSync(path.join(ROOT, 'smart-load-bundles.json'), JSON.stringify(manifest, null, 2) + '\n');
for (const item of manifest.bundles) console.log(`${item.file}\t${item.bytes}\t${item.sha256}`);
