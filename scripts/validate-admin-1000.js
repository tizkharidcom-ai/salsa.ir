'use strict';
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root,p),'utf8');
const exists = (p) => fs.existsSync(path.join(root,p));
const admin = read('admin.html');
const js = read('js/admin.js');
const css = read('css/admin-operations-v3.css');
const server = read('server/server.js');
const otpPolicy = read('server/otp-policy.js');
const contract = JSON.parse(read('docs/admin-1000/BASELINE-CONTRACT.json'));
const audit = JSON.parse(read('docs/admin-1000/ADMIN-1000-AUDIT.json'));
const checks=[];
const ok=(name,pass)=>checks.push({name,pass:!!pass});
const tabs = (s)=>[...s.matchAll(/data-tab="([^"]+)"/g)].map(m=>m[1]);
const settingsDestinations = (s) => [
  ...[...s.matchAll(/data-settings-tab="([^"]+)"/g)].map((match) => match[1]),
  ...[...s.matchAll(/(?:tab|secondaryTab):\s*'([^']+)'/g)].map((match) => match[1]),
];
// Express accepts either one path or an array of paths.  Keep the baseline
// route check semantic instead of silently missing grouped routes such as
// `/api/admin/users/:phone` when they are declared in an array.
const routes = (s) => [...s.matchAll(/app\.(get|post|put|patch|delete)\(\s*(\[[^\]]+\]|['"][^'"]+['"])/g)]
  .flatMap((match) => [...match[2].matchAll(/['"]([^'"]+)['"]/g)].map((pathMatch) => `${match[1].toUpperCase()} ${pathMatch[1]}`));
const unique=(a)=>[...new Set(a)].sort();
const diff=(a,b)=>a.filter(x=>!b.includes(x));

ok('additional audit has exactly 1000 parameters', audit.count === 1000 && Array.isArray(audit.items) && audit.items.length === 1000);
ok('audit IDs are unique', new Set(audit.items.map(x=>x.id)).size === 1000);
ok('audit covers 20 domains', Number(audit.domains) === 20 || (Array.isArray(audit.domains) && audit.domains.length === 20));
ok('audit status accounting reconciles', Object.values(audit.statusCounts||{}).reduce((a,b)=>a+Number(b||0),0) === 1000);
ok('operations v3 css loaded', /admin-operations-v3\.css\?v=[^"']+/.test(admin));
ok('admin js asset has a cache-busting version', /js\/admin\.js\?v=[^"']+/.test(admin));
const approvedSupersededTabs = ['feedback', 'loyalty', 'newsletter'];
const approvedUnifiedTabs = ['club', 'costControl', 'finance', 'complements', 'accounting', 'expenses'];
const retainedBaselineTabs = contract.tabs.filter((tab) => !approvedSupersededTabs.includes(tab));
// Settings destinations are intentionally cards, not sidebar tabs; count
// those explicit links as retained destinations without inflating the visible
// navigation contract.
const adminDestinations = unique([...tabs(admin), ...settingsDestinations(admin), ...settingsDestinations(js)]);
ok('no retained top-level admin tab removed', diff(retainedBaselineTabs, adminDestinations).length === 0);
ok('only approved unified admin tabs added', diff(unique(tabs(admin)), [...retainedBaselineTabs, ...approvedUnifiedTabs]).length === 0);
ok('no existing server route removed', diff(contract.routes, unique(routes(server))).length === 0);
ok('OTP requests retain a runtime cooldown and Retry-After response', /const enforceCooldown = !IS_NODE_TEST_RUNTIME/.test(server) && /now - lastRequested < OTP_COOLDOWN_MS/.test(server) && /Retry-After/.test(server));
ok('OTP verification limits wrong-code attempts', /const MAX_OTP_ATTEMPTS = [1-9]\d*/.test(server) && /entry\.attempts = \(entry\.attempts \|\| 0\) \+ 1/.test(server) && /if \(entry\.attempts > MAX_OTP_ATTEMPTS\)/.test(server));
ok('OTP demo is forcibly disabled in production, including with an explicit demo flag', /isOtpDemoMode\(process\.env\)/.test(server) && /if \(nodeEnv === 'production'\) return false/.test(otpPolicy));
ok('OTP request tracks expiry and bounded-verification metadata', /otps\.set\(phone, \{[\s\S]{0,180}code,[\s\S]{0,180}expiresAt:[\s\S]{0,180}attempts: 0/.test(server));
ok('OTP wrong code is rejected before authentication and reports remaining attempts', /if \(entry\.code !== code\) \{[\s\S]{0,320}return res\.status\(400\)\.json/.test(server) && server.indexOf('if (entry.code !== code)') < server.indexOf("let user = db.users.find((u) => u.phone === phone)", server.indexOf("app.post('/api/auth/verify-otp'")));
ok('session cookie hardening remains', /SameSite=Lax/.test(server) && /secureCookie/.test(server));
ok('order list returns server time', /\/api\/admin\/orders[\s\S]{0,3500}serverTime/.test(server));
ok('orders are operationally sorted', /const terminal = new Set[\s\S]{0,1100}aClosed[\s\S]{0,1100}oldest actionable first/.test(server));
ok('order status transition is idempotent', /idempotent: true, order/.test(server));
ok('kitchen exposes age seconds', /ageSec/.test(server));
ok('kitchen exposes delay summary', /oldestAgeSec/.test(server) && /itemUnits/.test(server) && /delayed/.test(server));
ok('kitchen status update is idempotent', /api\/kitchen\/orders\/:id[\s\S]{0,5000}(?:idempotent: true|kdsIdempotent\()/.test(server));
ok('reservation response includes slot load', /slotLoad/.test(server) && /maxCoversPerSlot/.test(server));
ok('reservation summary includes shift signals', /todayCovers/.test(server) && /noShowToday/.test(server));
ok('inventory has status filters', /data-inv-filter/.test(js));
ok('kitchen has aggregate prep pressure', /topPrep/.test(js) && /kds-prep-chips/.test(js));
ok('reservations expose slot capacity UI', /reservation-slot-load/.test(js));
ok('orders expose a primary next action', /data-onext/.test(js) && /primaryNextStatus/.test(js));
ok('destructive reservation states require confirmation', /no_show/.test(js) && /confirm\(/.test(js));
ok('busy action guard exists', /aria-busy/.test(js) && /runBusy/.test(js));
ok('operations CSS has responsive rules', /@media \(max-width:(?:900|640|420)px\)/.test(css));
ok('operations CSS has critical ticket state', /is-critical/.test(css));
ok('operations CSS has reservation capacity bar', /reservation-slot__bar/.test(css));
ok('research notes exist', exists('docs/admin-1000/RESEARCH-BENCHMARKS.md'));
ok('OTP supersession note exists', exists('docs/admin-1000/SECURITY-OTP-NOTE.md'));

const failed=checks.filter(x=>!x.pass);
for (const c of checks) console.log(`${c.pass?'PASS':'FAIL'} ${c.name}`);
console.log(`\n${checks.length-failed.length}/${checks.length} admin-1000 checks passed`);
if(failed.length) process.exit(1);
