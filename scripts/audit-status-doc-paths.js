// scripts/audit-status-doc-paths.js
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const STATUS_DOC = path.join(ROOT, 'docs/salsa/GODMODE-IMPLEMENTATION-STATUS.md');

if (!fs.existsSync(STATUS_DOC)) {
  console.error('Status document not found:', STATUS_DOC);
  process.exit(1);
}

const content = fs.readFileSync(STATUS_DOC, 'utf8');

// Regex to capture file and directory paths in backticks or code blocks
const pathRegex = /`((?:server\/neem|prototype|scripts|docs\/neem|test)[^`]+)`/g;

let match;
const extractedPaths = new Set();

while ((match = pathRegex.exec(content)) !== null) {
  let cleanPath = match[1].trim();
  // Strip trailing punctuation if any
  cleanPath = cleanPath.replace(/[,\s]+$/, '');
  extractedPaths.add(cleanPath);
}

console.log(`Found ${extractedPaths.size} unique paths in GODMODE-IMPLEMENTATION-STATUS.md:`);

let missingCount = 0;
for (const relPath of extractedPaths) {
  const fullPath = path.join(ROOT, relPath);
  if (fs.existsSync(fullPath)) {
    console.log(`  ✓ EXISTS: ${relPath}`);
  } else {
    console.error(`  ✗ MISSING: ${relPath}`);
    missingCount++;
  }
}

if (missingCount > 0) {
  console.error(`\nFAILED: ${missingCount} paths are missing from the filesystem!`);
  process.exit(1);
} else {
  console.log(`\nSUCCESS: All ${extractedPaths.size} paths exist on the filesystem! Zero missing paths.`);
}
