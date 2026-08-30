'use strict';

/*
 * Small RAW/ESC-POS cashier-printer driver.
 *
 * The browser cannot open a TCP socket to a LAN printer. The WESTO server is
 * therefore the print client: it either opens the configured LAN socket or
 * sends the same raw bytes to an installed macOS/Linux print queue (including
 * a USB queue), without invoking a print dialog.
 */
const net = require('node:net');
const { execFile, spawn } = require('node:child_process');
const iconv = require('iconv-lite');

const DEFAULT_PRINTER_HOST = '192.168.254.4';
const DEFAULT_PRINTER_PORT = 9100;
const PRINTING_CONFIG_VERSION = 5;
const DEFAULT_CODE_PAGE_BY_ENCODING = Object.freeze({
  // BIXOLON SRP-350III uses its own ESC/POS page numbers. On this model
  // page 40 is the Arabic/Windows-1256 table; page 28 is Cyrillic.
  'windows-1256': 40,
  cp1256: 40,
  cp864: 22, // BIXOLON Page 22 - PC864 / Arabic.
  cp437: 0,
  cp850: 2,
});
const DEFAULT_PRINTER_CONFIG = Object.freeze({
  id: 'cashier-main',
  name: 'پرینتر صندوق',
  model: 'bixolon-srp-350iii',
  branchId: 1,
  protocol: 'raw',
  transport: 'network',
  systemPrinterName: '',
  host: DEFAULT_PRINTER_HOST,
  port: DEFAULT_PRINTER_PORT,
  enabled: true,
  paperWidth: 80,
  charsPerLine: 48,
  renderMode: 'raster',
  encoding: 'windows-1256',
  codePage: 40,
  cut: true,
  timeoutMs: 5000,
});

const SUPPORTED_ENCODINGS = new Set(['utf8', 'windows-1256', 'cp1256', 'cp864', 'cp437', 'cp850']);

function printerError(code, message, field = null, cause = null) {
  const error = new Error(message);
  error.code = code;
  error.status = ['printer_config_invalid', 'printer_raster_invalid'].includes(code) ? 400 : 502;
  if (field) error.field = field;
  if (cause) error.cause = cause;
  return error;
}

function ipv4Parts(host) {
  const value = String(host || '').trim();
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(value)) return null;
  const parts = value.split('.').map(Number);
  if (parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return parts;
}

function isLocalNetworkHost(host) {
  const parts = ipv4Parts(host);
  if (!parts) return false;
  const [a, b] = parts;
  return a === 10
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || a === 127
    || (a === 169 && b === 254);
}

function cleanText(value, max = 180) {
  return String(value ?? '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/[\r\n]+/g, ' ')
    .trim()
    .slice(0, max);
}

function asciiDigits(value) {
  return String(value ?? '')
    .replace(/[۰-۹]/g, (digit) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(digit))
    .replace(/[٠-٩]/g, (digit) => '٠١٢٣٤٥٦٧٨٩'.indexOf(digit));
}

function normalizeLegacyArabic(value) {
  // CP1256 contains Arabic ي but not Persian ی. This fallback avoids turning
  // Persian amounts/names into an unreadable string of question marks.
  return asciiDigits(value).replace(/ی/g, 'ي');
}

function normalizePrinterConfig(raw = {}, existing = {}) {
  const source = { ...DEFAULT_PRINTER_CONFIG, ...(existing || {}), ...(raw || {}) };
  const transport = source.transport === 'system' ? 'system' : 'network';
  const systemPrinterName = cleanText(source.systemPrinterName, 127);
  if (transport === 'system' && !/^[A-Za-z0-9._-]{1,127}$/.test(systemPrinterName)) {
    throw printerError('printer_config_invalid', 'برای اتصال USB، یک پرینتر نصب‌شده در سیستم انتخاب کنید.', 'systemPrinterName');
  }
  const host = String(source.host || '').trim();
  if (!isLocalNetworkHost(host)) {
    throw printerError('printer_config_invalid', 'آدرس پرینتر باید یک IPv4 از شبکهٔ محلی باشد.', 'host');
  }
  const port = Number(source.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw printerError('printer_config_invalid', 'پورت پرینتر باید بین ۱ تا ۶۵۵۳۵ باشد.', 'port');
  }
  const encoding = String(source.encoding || DEFAULT_PRINTER_CONFIG.encoding).toLowerCase();
  if (!SUPPORTED_ENCODINGS.has(encoding) || !iconv.encodingExists(encoding === 'utf8' ? 'utf8' : encoding)) {
    throw printerError('printer_config_invalid', 'کدگذاری انتخاب‌شده برای چاپ پشتیبانی نمی‌شود.', 'encoding');
  }
  const paperWidth = Number(source.paperWidth) === 58 ? 58 : 80;
  const renderMode = source.renderMode === 'text' ? 'text' : 'raster';
  const charsPerLine = Math.max(16, Math.min(64, Math.round(Number(source.charsPerLine) || (paperWidth === 58 ? 32 : 48))));
  const defaultCodePage = DEFAULT_CODE_PAGE_BY_ENCODING[encoding] ?? DEFAULT_PRINTER_CONFIG.codePage;
  const hasRawCodePage = Object.prototype.hasOwnProperty.call(raw || {}, 'codePage');
  const hasExistingCodePage = Object.prototype.hasOwnProperty.call(existing || {}, 'codePage');
  const codePageInput = hasRawCodePage ? raw.codePage : hasExistingCodePage ? existing.codePage : defaultCodePage;
  const requestedCodePage = Number(codePageInput);
  const codePage = codePageInput === null || codePageInput === '' || encoding === 'utf8'
    ? null
    : Math.max(0, Math.min(255, Number.isFinite(requestedCodePage)
      ? Math.round(requestedCodePage)
      : defaultCodePage));
  return {
    id: cleanText(source.id || DEFAULT_PRINTER_CONFIG.id, 64).replace(/[^a-zA-Z0-9_-]/g, '-') || DEFAULT_PRINTER_CONFIG.id,
    name: cleanText(source.name || DEFAULT_PRINTER_CONFIG.name, 80) || DEFAULT_PRINTER_CONFIG.name,
    model: cleanText(source.model || DEFAULT_PRINTER_CONFIG.model, 64).toLowerCase() || DEFAULT_PRINTER_CONFIG.model,
    branchId: Number(source.branchId) || DEFAULT_PRINTER_CONFIG.branchId,
    protocol: 'raw',
    transport,
    systemPrinterName,
    host,
    port,
    enabled: source.enabled !== false,
    paperWidth,
    charsPerLine,
    renderMode,
    encoding,
    codePage,
    cut: source.cut !== false,
    timeoutMs: Math.max(1000, Math.min(15000, Math.round(Number(source.timeoutMs) || DEFAULT_PRINTER_CONFIG.timeoutMs))),
  };
}

function ensurePrintingData(data, branchId = 1) {
  const current = data?.printing && typeof data.printing === 'object' ? data.printing : {};
  const legacy = current.host ? [current] : [];
  const candidates = Array.isArray(current.printers) ? current.printers : legacy;
  const printers = [];
  for (const candidate of candidates) {
    try {
      printers.push(normalizePrinterConfig(candidate));
    } catch (_) {
      // A malformed legacy row is ignored; the safe default below keeps the
      // migration recoverable and gives the manager a valid row to edit.
    }
  }
  const primaryBranchId = Number(branchId) || 1;
  if (!printers.some((printer) => Number(printer.branchId) === primaryBranchId)) {
    printers.push(normalizePrinterConfig({ ...DEFAULT_PRINTER_CONFIG, branchId: primaryBranchId }));
  }
  const migratedPrinters = printers.map((printer) => {
    // Versions 1 and 2 used generic/Epson values (28, then 50). Both are
    // wrong for the BIXOLON SRP-350III. Keep an explicitly newer/custom row
    // untouched, but repair the settings created by the previous defaults.
    const shouldMigrateBixolonCodePage = Number(current.version || 0) < PRINTING_CONFIG_VERSION
      && (printer.encoding === 'windows-1256' || printer.encoding === 'cp1256')
      && [28, 50].includes(Number(printer.codePage));
    return shouldMigrateBixolonCodePage
      ? normalizePrinterConfig({ ...printer, model: 'bixolon-srp-350iii', codePage: DEFAULT_CODE_PAGE_BY_ENCODING[printer.encoding] || 40 })
      : printer;
  });
  const defaultPrinterId = migratedPrinters.some((printer) => printer.id === current.defaultPrinterId)
    ? current.defaultPrinterId
    : migratedPrinters.find((printer) => Number(printer.branchId) === primaryBranchId)?.id || migratedPrinters[0].id;
  data.printing = { version: PRINTING_CONFIG_VERSION, defaultPrinterId, printers: migratedPrinters };
  return data.printing;
}

function printerForBranch(data, branchId, printerId = '') {
  ensurePrintingData(data, branchId);
  const wantedBranchId = Number(branchId) || 1;
  const rows = data.printing.printers.filter((printer) => Number(printer.branchId) === wantedBranchId);
  if (printerId) return rows.find((printer) => String(printer.id) === String(printerId)) || null;
  return rows.find((printer) => printer.id === data.printing.defaultPrinterId) || rows[0] || null;
}

function publicPrinterConfig(printer) {
  if (!printer) return null;
  const { id, name, model, branchId, protocol, transport, systemPrinterName, host, port, enabled, paperWidth, charsPerLine, renderMode, encoding, codePage, cut, timeoutMs } = printer;
  return { id, name, model, branchId, protocol, transport, systemPrinterName, host, port, enabled, paperWidth, charsPerLine, renderMode, encoding, codePage, cut, timeoutMs };
}

function parseLpstatOutput(output) {
  const queues = new Map();
  let defaultName = '';
  for (const rawLine of String(output || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    const printerMatch = line.match(/^printer\s+(\S+)\s+(.+)$/i);
    if (printerMatch) {
      const [, name, state] = printerMatch;
      queues.set(name, { ...(queues.get(name) || {}), name, state: cleanText(state, 180) });
      continue;
    }
    const deviceMatch = line.match(/^device for\s+(\S+):\s+(.+)$/i);
    if (deviceMatch) {
      const [, name, device] = deviceMatch;
      queues.set(name, { ...(queues.get(name) || {}), name, device: cleanText(device, 300) });
      continue;
    }
    const defaultMatch = line.match(/^system default destination:\s*(\S+)$/i);
    if (defaultMatch) defaultName = defaultMatch[1];
  }
  return [...queues.values()].map((queue) => {
    const device = queue.device || '';
    const connection = /^usb:/i.test(device)
      ? 'usb'
      : /^(?:socket|ipp|ipps|lpd|dnssd|smb):/i.test(device) ? 'network' : 'system';
    return {
      name: queue.name,
      label: queue.name.replace(/_+/g, ' ').trim() || queue.name,
      connection,
      isDefault: queue.name === defaultName,
      state: queue.state || '',
    };
  }).sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || Number(b.connection === 'usb') - Number(a.connection === 'usb') || a.label.localeCompare(b.label));
}

function listSystemPrinters({ execFileImpl = execFile, platform = process.platform } = {}) {
  if (platform === 'win32') {
    return Promise.resolve({ supported: false, platform, printers: [] });
  }
  const command = platform === 'darwin' ? '/usr/bin/lpstat' : 'lpstat';
  return new Promise((resolve, reject) => {
    execFileImpl(command, ['-p', '-d', '-v'], { timeout: 5000, maxBuffer: 256 * 1024 }, (error, stdout, stderr) => {
      const printers = parseLpstatOutput(stdout);
      if (error && !printers.length && !/no system default destination/i.test(String(stderr || stdout || ''))) {
        return reject(printerError('system_printer_discovery_failed', 'فهرست پرینترهای نصب‌شدهٔ سیستم خوانده نشد.', null, error));
      }
      return resolve({ supported: true, platform, printers });
    });
  });
}

function encode(value, encoding) {
  const text = encoding === 'utf8' ? String(value ?? '') : normalizeLegacyArabic(value);
  return encoding === 'utf8' ? Buffer.from(text, 'utf8') : iconv.encode(text, encoding);
}

function formatAmount(value) {
  return String(Math.max(0, Math.round(Number(value) || 0)))
    .replace(/\B(?=(\d{3})+(?!\d))/g, '٫')
    .replace(/[0-9]/g, (digit) => '۰۱۲۳۴۵۶۷۸۹'[Number(digit)]);
}

function formatReceiptDate(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return `${date.toLocaleDateString('fa-IR-u-nu-latn')} ${date.toLocaleTimeString('fa-IR-u-nu-latn', { hour: '2-digit', minute: '2-digit' })}`;
}

function paymentLabel(order) {
  const tender = String(order?.paymentTender || order?.tender || order?.paymentMethod || '').toLowerCase();
  return {
    cash: 'نقدی',
    card: 'کارت‌خوان',
    online: 'آنلاین',
    wallet: 'کیف پول',
    cashier: 'صندوق',
  }[tender] || '';
}

function receiptLineTotal(line) {
  if (Number.isFinite(Number(line?.lineTotal))) return Number(line.lineTotal);
  const base = (Number(line?.price) || 0) * (Number(line?.qty) || 1);
  const complements = (line?.complements || []).reduce((sum, entry) => sum + (Number(entry.price) || 0) * (Number(entry.qty) || 1), 0);
  return base + complements;
}

function buildReceiptBuffer(order, printer, { restaurantName = 'وستو', test = false } = {}) {
  const config = normalizePrinterConfig(printer);
  const GS = Buffer.from([0x1d]);
  const LF = Buffer.from('\n');
  const chunks = [Buffer.from([0x1b, 0x40])]; // initialize
  if (config.codePage != null) chunks.push(Buffer.from([0x1b, 0x74, config.codePage]));
  const text = (value = '') => chunks.push(encode(value, config.encoding), LF);
  const align = (value) => chunks.push(Buffer.from([0x1b, 0x61, value]));
  const bold = (enabled) => chunks.push(Buffer.from([0x1b, 0x45, enabled ? 1 : 0]));
  const separator = () => text('-'.repeat(config.charsPerLine));

  align(1);
  bold(true);
  text(cleanText(restaurantName, 80) || 'وستو');
  bold(false);
  if (test) {
    text('آزمون چاپ مستقیم شبکه');
    text(`${config.host}:${config.port}`);
  } else {
    const orderNo = cleanText(order?.orderNo || order?.id || '—', 80);
    text(`سفارش ${orderNo}`);
    const location = order?.tableNo ? `میز ${order.tableNo}` : order?.fulfillment === 'delivery' ? 'ارسال' : 'بیرون‌بر';
    text(location);
    const customerName = cleanText(order?.customerName || order?.name, 100);
    const phone = cleanText(order?.phone, 40);
    const createdAt = formatReceiptDate(order?.createdAt || order?.paidAt);
    const tender = paymentLabel(order);
    if (customerName) text(`مهمان: ${customerName}`);
    if (phone) text(`تلفن: ${phone}`);
    if (createdAt) text(`زمان: ${createdAt}`);
    if (tender) text(`پرداخت: ${tender}`);
    if (order?.note) text(`یادداشت: ${cleanText(order.note, 150)}`);
  }
  align(2);
  separator();
  if (!test) {
    for (const line of Array.isArray(order?.items) ? order.items : []) {
      const qty = Math.max(1, Math.round(Number(line.qty) || 1));
      text(`${qty}× ${cleanText(line.name || 'محصول', 120)}`);
      text(`    ${formatAmount(receiptLineTotal(line))} تومان`);
      for (const modifier of line.modifiers || []) text(`    ${cleanText(modifier.name, 80)}`);
      for (const complement of line.complements || []) {
        const complementQty = Math.max(1, Math.round(Number(complement.qty) || 1));
        text(`    + ${complementQty}× ${cleanText(complement.name || 'مکمل', 100)}`);
      }
      if (line.note) text(`    یادداشت: ${cleanText(line.note, 150)}`);
    }
    separator();
    if (order?.subtotal && order?.discount) {
      text(`جمع اقلام: ${formatAmount(order.subtotal)} تومان`);
      if (order.tierDiscountToman) {
        text(`تخفیف باشگاه مشتریان: -${formatAmount(order.tierDiscountToman)} تومان`);
      }
      if (order.pointsDiscountToman) {
        text(`کسر ${order.pointsRedeemed || 0} امتیاز باشگاه: -${formatAmount(order.pointsDiscountToman)} تومان`);
      }
      if (order.deliveryFee) {
        text(`هزینه ارسال: ${formatAmount(order.deliveryFee)} تومان`);
      }
    }
    bold(true);
    text(`مبلغ نهایی فاکتور: ${formatAmount(order?.total)} تومان`);
    bold(false);
    text(order?.paymentStatus === 'paid' ? 'پرداخت‌شده' : 'پیش‌فاکتور');
  }
  align(1);
  text(test ? 'اتصال مستقیم پرینتر فعال است' : 'ممنون از انتخاب شما');
  chunks.push(LF, LF, LF);
  if (config.cut) chunks.push(GS, Buffer.from([0x56, 0x00]));
  return Buffer.concat(chunks);
}

function normalizeRasterPayload(raw, printer) {
  const config = normalizePrinterConfig(printer);
  if (!raw || raw.format !== 'escpos-raster-v1') {
    throw printerError('printer_raster_invalid', 'قالب تصویر رسید معتبر نیست.', 'raster');
  }
  const width = Math.round(Number(raw.width));
  const height = Math.round(Number(raw.height));
  const maxWidth = config.paperWidth === 58 ? 384 : 576;
  if (!Number.isInteger(width) || width < 8 || width > maxWidth || width % 8 !== 0) {
    throw printerError('printer_raster_invalid', `عرض تصویر رسید باید مضربی از ۸ و حداکثر ${maxWidth} نقطه باشد.`, 'raster.width');
  }
  if (!Number.isInteger(height) || height < 1 || height > 4095) {
    throw printerError('printer_raster_invalid', 'ارتفاع تصویر رسید باید بین ۱ تا ۴۰۹۵ نقطه باشد.', 'raster.height');
  }
  const encoded = String(raw.data || '');
  if (!encoded || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    throw printerError('printer_raster_invalid', 'دادهٔ تصویر رسید معتبر نیست.', 'raster.data');
  }
  const data = Buffer.from(encoded, 'base64');
  const rowBytes = width / 8;
  const expectedBytes = rowBytes * height;
  if (data.length !== expectedBytes || data.length > 512 * 1024) {
    throw printerError('printer_raster_invalid', 'اندازهٔ دادهٔ تصویر با ابعاد رسید هماهنگ نیست.', 'raster.data');
  }
  return { width, height, rowBytes, data };
}

function buildRasterReceiptBuffer(raster, printer) {
  const config = normalizePrinterConfig(printer);
  const normalized = normalizeRasterPayload(raster, config);
  const { rowBytes, height, data } = normalized;
  const chunks = [
    Buffer.from([0x1b, 0x40]), // initialize
    Buffer.from([0x1b, 0x61, 0x01]), // centered at the beginning of a line
    Buffer.from([
      0x1d, 0x76, 0x30, 0x00,
      rowBytes & 0xff, (rowBytes >> 8) & 0xff,
      height & 0xff, (height >> 8) & 0xff,
    ]),
    data,
    Buffer.from('\n\n\n'),
  ];
  if (config.cut) chunks.push(Buffer.from([0x1d, 0x56, 0x00]));
  return Buffer.concat(chunks);
}

function sendRaw(printer, payload) {
  const config = normalizePrinterConfig(printer);
  if (!config.enabled) return Promise.reject(printerError('printer_disabled', 'پرینتر صندوق غیرفعال است.'));
  return new Promise((resolve, reject) => {
    let connected = false;
    let settled = false;
    const socket = net.createConnection({ host: config.host, port: config.port });
    const fail = (code, message, cause = null) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(printerError(code, message, null, cause));
    };
    socket.setTimeout(config.timeoutMs);
    socket.once('connect', () => {
      connected = true;
      socket.end(payload, () => {
        if (settled) return;
        settled = true;
        resolve({ ok: true, transport: 'network', host: config.host, port: config.port, bytes: payload.length });
      });
    });
    socket.once('timeout', () => fail('printer_timeout', `پاسخ پرینتر در ${config.timeoutMs} میلی‌ثانیه دریافت نشد.`));
    socket.once('error', (error) => fail(connected ? 'printer_write_failed' : 'printer_unreachable', `اتصال به پرینتر ${config.host}:${config.port} برقرار نشد.`, error));
    socket.once('close', () => {
      if (!settled && !connected) fail('printer_unreachable', `اتصال به پرینتر ${config.host}:${config.port} برقرار نشد.`);
    });
  });
}

function sendSystemRaw(printer, payload, { spawnImpl = spawn, platform = process.platform } = {}) {
  const config = normalizePrinterConfig(printer);
  if (!config.enabled) return Promise.reject(printerError('printer_disabled', 'پرینتر صندوق غیرفعال است.'));
  if (platform === 'win32') return Promise.reject(printerError('system_printer_unsupported', 'چاپ مستقیم USB در این نسخه برای macOS و Linux فعال است.'));
  const command = platform === 'darwin' ? '/usr/bin/lp' : 'lp';
  return new Promise((resolve, reject) => {
    let settled = false;
    let stdout = '';
    let stderr = '';
    const child = spawnImpl(command, ['-d', config.systemPrinterName, '-o', 'raw', '-t', 'WESTO Receipt'], { stdio: ['pipe', 'pipe', 'pipe'] });
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill?.('SIGKILL');
      reject(printerError('printer_timeout', `صف چاپ سیستم در ${config.timeoutMs} میلی‌ثانیه پاسخ نداد.`));
    }, config.timeoutMs);
    const fail = (message, cause = null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(printerError('system_printer_failed', message, null, cause));
    };
    child.stdout?.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr?.on('data', (chunk) => { stderr += String(chunk); });
    child.once('error', (error) => fail('صف چاپ USB/سیستم اجرا نشد.', error));
    child.once('close', (code) => {
      if (settled) return;
      if (code !== 0) return fail(cleanText(stderr, 220) || 'سیستم چاپ، فیش را نپذیرفت.');
      settled = true;
      clearTimeout(timer);
      return resolve({
        ok: true,
        transport: 'system',
        queue: config.systemPrinterName,
        bytes: payload.length,
        job: cleanText(stdout, 180),
      });
    });
    child.stdin.once('error', (error) => fail('ارسال داده به صف چاپ USB/سیستم قطع شد.', error));
    child.stdin.end(payload);
  });
}

function sendPrinterPayload(printer, payload) {
  const config = normalizePrinterConfig(printer);
  return config.transport === 'system' ? sendSystemRaw(config, payload) : sendRaw(config, payload);
}

async function printOrder(order, printer, options = {}) {
  const config = normalizePrinterConfig(printer);
  const payload = buildReceiptBuffer(order, config, options);
  return sendPrinterPayload(config, payload);
}

async function printRasterReceipt(raster, printer) {
  const config = normalizePrinterConfig(printer);
  const normalized = normalizeRasterPayload(raster, config);
  const payload = buildRasterReceiptBuffer(raster, config);
  const result = await sendPrinterPayload(config, payload);
  return { ...result, mode: 'raster', width: normalized.width, height: normalized.height };
}

async function testPrinter(printer) {
  const config = normalizePrinterConfig(printer);
  return sendPrinterPayload(config, buildReceiptBuffer(null, config, { test: true }));
}

module.exports = {
  DEFAULT_PRINTER_CONFIG,
  DEFAULT_PRINTER_HOST,
  DEFAULT_PRINTER_PORT,
  buildRasterReceiptBuffer,
  buildReceiptBuffer,
  ensurePrintingData,
  isLocalNetworkHost,
  listSystemPrinters,
  normalizePrinterConfig,
  parseLpstatOutput,
  printerError,
  printerForBranch,
  printOrder,
  printRasterReceipt,
  publicPrinterConfig,
  sendSystemRaw,
  testPrinter,
};
