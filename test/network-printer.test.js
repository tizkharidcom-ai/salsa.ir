'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const net = require('node:net');
const test = require('node:test');
const {
  DEFAULT_PRINTER_CONFIG,
  buildRasterReceiptBuffer,
  buildReceiptBuffer,
  ensurePrintingData,
  isLocalNetworkHost,
  listSystemPrinters,
  normalizePrinterConfig,
  parseLpstatOutput,
  printOrder,
  printRasterReceipt,
  sendSystemRaw,
} = require('../server/network-printer');

test('network printer defaults to the configured LAN printer and rejects public hosts', () => {
  const data = {};
  ensurePrintingData(data, 1);
  assert.equal(data.printing.printers[0].host, '192.168.254.4');
  assert.equal(data.printing.printers[0].port, 9100);
  assert.equal(data.printing.printers[0].model, 'bixolon-srp-350iii');
  assert.equal(data.printing.printers[0].codePage, 40);
  assert.equal(data.printing.printers[0].renderMode, 'raster');
  assert.equal(data.printing.printers[0].transport, 'network');
  assert.equal(data.printing.version, 5);
  assert.equal(DEFAULT_PRINTER_CONFIG.host, '192.168.254.4');
  assert.equal(normalizePrinterConfig({ encoding: 'cp864' }).codePage, 22);
  assert.equal(isLocalNetworkHost('192.168.254.4'), true);
  assert.equal(isLocalNetworkHost('8.8.8.8'), false);
  assert.throws(() => normalizePrinterConfig({ host: '8.8.8.8' }), /IPv4/);
});

test('legacy printer settings migrate away from Bixolon code pages 28 and 50', () => {
  const data = {
    printing: {
      version: 1,
      defaultPrinterId: 'cashier-main',
      printers: [{ ...DEFAULT_PRINTER_CONFIG, codePage: 28 }],
    },
  };
  ensurePrintingData(data, 1);
  assert.equal(data.printing.version, 5);
  assert.equal(data.printing.printers[0].model, 'bixolon-srp-350iii');
  assert.equal(data.printing.printers[0].codePage, 40);

  const previousAttempt = {
    printing: {
      version: 2,
      defaultPrinterId: 'cashier-main',
      printers: [{ ...DEFAULT_PRINTER_CONFIG, codePage: 50 }],
    },
  };
  ensurePrintingData(previousAttempt, 1);
  assert.equal(previousAttempt.printing.printers[0].codePage, 40);
});

test('system printer discovery identifies USB and network queues', async () => {
  const output = [
    'printer BIXOLON_SRP_350III is idle. enabled since today',
    'printer _192_168_254_4 is idle. enabled since today',
    'system default destination: BIXOLON_SRP_350III',
    'device for BIXOLON_SRP_350III: usb://BIXOLON/SRP-350III',
    'device for _192_168_254_4: socket://192.168.254.4/',
  ].join('\n');
  const parsed = parseLpstatOutput(output);
  assert.deepEqual(parsed.map(({ name, connection, isDefault }) => ({ name, connection, isDefault })), [
    { name: 'BIXOLON_SRP_350III', connection: 'usb', isDefault: true },
    { name: '_192_168_254_4', connection: 'network', isDefault: false },
  ]);

  const result = await listSystemPrinters({
    platform: 'darwin',
    execFileImpl(command, args, options, callback) {
      assert.equal(command, '/usr/bin/lpstat');
      assert.deepEqual(args, ['-p', '-d', '-v']);
      callback(null, output, '');
    },
  });
  assert.equal(result.supported, true);
  assert.equal(result.printers[0].connection, 'usb');
});

test('USB/system mode sends the same raw receipt bytes to the selected CUPS queue', async () => {
  let command = '';
  let args = [];
  let payload = null;
  const spawnImpl = (nextCommand, nextArgs) => {
    command = nextCommand;
    args = nextArgs;
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = new EventEmitter();
    child.kill = () => {};
    child.stdin.end = (bytes) => {
      payload = Buffer.from(bytes);
      queueMicrotask(() => {
        child.stdout.emit('data', 'request id is BIXOLON_SRP_350III-12');
        child.emit('close', 0);
      });
    };
    return child;
  };
  const printer = normalizePrinterConfig({ transport: 'system', systemPrinterName: 'BIXOLON_SRP_350III' });
  const bytes = Buffer.from([0x1b, 0x40, 0x1d, 0x56, 0]);
  const result = await sendSystemRaw(printer, bytes, { spawnImpl, platform: 'darwin' });
  assert.equal(command, '/usr/bin/lp');
  assert.deepEqual(args, ['-d', 'BIXOLON_SRP_350III', '-o', 'raw', '-t', 'WESTO Receipt']);
  assert.deepEqual(payload, bytes);
  assert.equal(result.transport, 'system');
  assert.equal(result.queue, 'BIXOLON_SRP_350III');
  assert.match(result.job, /BIXOLON_SRP_350III-12/);
  assert.throws(() => normalizePrinterConfig({ transport: 'system', systemPrinterName: '../bad queue' }), /پرینتر نصب‌شده/);
});

test('Bixolon raster receipt uses the full 80mm width and official GS v 0 framing', async (t) => {
  let payload = null;
  const originalCreateConnection = net.createConnection;
  t.after(() => { net.createConnection = originalCreateConnection; });
  net.createConnection = () => {
    const socket = new EventEmitter();
    socket.setTimeout = () => {};
    socket.destroy = () => {};
    socket.end = (bytes, callback) => { payload = Buffer.from(bytes); callback?.(); };
    queueMicrotask(() => socket.emit('connect'));
    return socket;
  };

  const rows = Buffer.alloc(72 * 2, 0);
  rows[0] = 0xaa;
  rows[72] = 0x55;
  const raster = { format: 'escpos-raster-v1', width: 576, height: 2, data: rows.toString('base64') };
  const expected = buildRasterReceiptBuffer(raster, DEFAULT_PRINTER_CONFIG);
  const result = await printRasterReceipt(raster, DEFAULT_PRINTER_CONFIG);

  assert.equal(result.ok, true);
  assert.equal(result.mode, 'raster');
  assert.equal(result.width, 576);
  assert.equal(result.height, 2);
  assert.deepEqual(payload, expected);
  assert.deepEqual([...payload.subarray(0, 5)], [0x1b, 0x40, 0x1b, 0x61, 0x01]);
  assert.deepEqual([...payload.subarray(5, 13)], [0x1d, 0x76, 0x30, 0x00, 72, 0, 2, 0]);
  assert.equal(payload[13], 0xaa);
  assert.equal(payload[13 + 72], 0x55);
  assert.deepEqual([...payload.subarray(-3)], [0x1d, 0x56, 0x00]);

  assert.throws(
    () => buildRasterReceiptBuffer({ ...raster, width: 575 }, DEFAULT_PRINTER_CONFIG),
    /مضربی از ۸/,
  );
  assert.throws(
    () => buildRasterReceiptBuffer({ ...raster, data: Buffer.alloc(3).toString('base64') }, DEFAULT_PRINTER_CONFIG),
    /هماهنگ نیست/,
  );
});

test('network printer sends an ESC/POS receipt over TCP without an OS print dialog', async (t) => {
  let payload = null;
  const originalCreateConnection = net.createConnection;
  t.after(() => { net.createConnection = originalCreateConnection; });
  net.createConnection = () => {
    const socket = new EventEmitter();
    socket.setTimeout = () => {};
    socket.destroy = () => {};
    socket.end = (bytes, callback) => { payload = Buffer.from(bytes); callback?.(); };
    queueMicrotask(() => socket.emit('connect'));
    return socket;
  };

  const printer = normalizePrinterConfig({
    id: 'test-printer', host: '127.0.0.1', port: 9100, encoding: 'utf8', codePage: null,
  });
  const result = await printOrder({
    id: 42, orderNo: 'TEST-42', tableNo: '7', fulfillment: 'dine_in', customerName: 'مهمان تست', phone: '09120000000',
    paymentStatus: 'paid', paymentTender: 'card', createdAt: '2026-08-28T10:30:00.000Z', total: 125000,
    items: [{ name: 'Test item', qty: 1, price: 125000, lineTotal: 125000 }],
  }, printer, { restaurantName: 'WESTO TEST' });

  assert.equal(result.ok, true);
  assert.equal(result.bytes, payload.length);
  assert.match(payload.toString('utf8'), /TEST-42/);
  assert.match(payload.toString('utf8'), /Test item/);
  assert.match(payload.toString('utf8'), /مهمان تست/);
  assert.match(payload.toString('utf8'), /09120000000/);
  assert.match(payload.toString('utf8'), /۱۲۵٫۰۰۰ تومان/);
  assert.deepEqual([...payload.subarray(0, 2)], [0x1b, 0x40]);
  assert.deepEqual([...payload.subarray(-3)], [0x1d, 0x56, 0x00]);

  const arabicPayload = buildReceiptBuffer({ orderNo: 'آزمون', items: [] }, DEFAULT_PRINTER_CONFIG);
  assert.deepEqual([...arabicPayload.subarray(2, 5)], [0x1b, 0x74, 40]);
});
