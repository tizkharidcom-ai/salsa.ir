'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ROOT = path.resolve(__dirname, '..');
const sources = [
  'js/vendor/three/addons/postprocessing/Pass.js',
  'js/vendor/three/addons/shaders/CopyShader.js',
  'js/vendor/three/addons/postprocessing/ShaderPass.js',
  'js/vendor/three/addons/postprocessing/MaskPass.js',
  'js/vendor/three/addons/postprocessing/EffectComposer.js',
  'js/vendor/three/addons/postprocessing/RenderPass.js',
  'js/vendor/three/addons/shaders/SMAAShader.js',
  'js/vendor/three/addons/postprocessing/SMAAPass.js',
  'js/vendor/three/addons/shaders/OutputShader.js',
  'js/vendor/three/addons/postprocessing/OutputPass.js',
];
const threeNames = new Set();
const bodies = [];
for (const rel of sources) {
  let text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  text = text.replace(/import\s*\{([\s\S]*?)\}\s*from\s*['\"]three['\"]\s*;/g, (_, names) => {
    names.split(',').map((x) => x.trim()).filter(Boolean).forEach((x) => threeNames.add(x));
    return '';
  });
  text = text.replace(/import\s*\{[\s\S]*?\}\s*from\s*['\"][^'\"]+['\"]\s*;/g, '');
  text = text.replace(/export\s*\{[\s\S]*?\}\s*;/g, '');
  bodies.push(`\n/* BEGIN ${rel} */\n${text.trim()}\n/* END ${rel} */\n`);
}
const output = [
  '/* WESTO generated Three postprocessing bundle v2. Do not edit directly. */',
  `import { ${Array.from(threeNames).sort().join(', ')} } from './three.module.js';`,
  ...bodies,
  'export { EffectComposer, RenderPass, SMAAPass, OutputPass };',
  '',
].join('\n');
const outRel = 'js/vendor/three/westo-postprocessing.bundle.mjs';
fs.writeFileSync(path.join(ROOT, outRel), output);
const sha256 = crypto.createHash('sha256').update(output).digest('hex');
console.log(JSON.stringify({ outRel, bytes: Buffer.byteLength(output), sha256, sources }, null, 2));
