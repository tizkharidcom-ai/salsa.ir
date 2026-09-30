// scripts/capture-admin-visual.js
const { chromium } = require('playwright');
const http = require('http');
const path = require('path');
const fs = require('fs');

// We can require the server directly or spawn it
const { spawn } = require('child_process');

async function main() {
  console.log('Starting Westo server on port 4180...');
  const serverProc = spawn('node', ['server/server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: '4180', NODE_ENV: 'test' },
    stdio: 'inherit'
  });

  // Wait for server to listen
  let retries = 40;
  while (retries > 0) {
    try {
      await new Promise((resolve, reject) => {
        const req = http.get('http://localhost:4180/api/theme', (res) => {
          if (res.statusCode === 200) resolve();
          else reject();
        });
        req.on('error', reject);
        req.end();
      });
      break;
    } catch (_) {
      await new Promise(r => setTimeout(r, 250));
      retries--;
    }
  }

  console.log('Server is responsive. Launching Playwright browser...');
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });

  const crypto = require('crypto');
  const SECRET_PATH = path.join(__dirname, '../server/data/secret.key');
  const SECRET = fs.readFileSync(SECRET_PATH, 'utf8').trim();
  const payload = Buffer.from(JSON.stringify({ phone: '09374333028', ts: Date.now() })).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  const sessionToken = `${payload}.${sig}`;

  await context.addCookies([{
    name: 'westo_session',
    value: sessionToken,
    domain: 'localhost',
    path: '/'
  }]);

  const page = await context.newPage();

  try {
    await page.goto('http://localhost:4180/admin.html');
    await page.waitForTimeout(800);

    // Click shortcuts button in topbar
    const btn = page.locator('#admin-shortcuts-btn');
    await btn.waitFor({ state: 'visible', timeout: 5000 });
    await btn.click();
    await page.waitForTimeout(400);

    await page.screenshot({ path: 'prototype/visual_admin_shortcuts.png' });
    console.log('Successfully captured prototype/visual_admin_shortcuts.png');
  } catch (err) {
    console.error('Error during capture:', err);
  } finally {
    await browser.close();
    serverProc.kill('SIGTERM');
    console.log('Cleaned up server.');
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
