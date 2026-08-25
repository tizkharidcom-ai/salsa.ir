/*
 * One-way, idempotent import of verified WESTO operational history into the
 * normalized PostgreSQL foundation for the unified admin.  It deliberately
 * does not read NEEM's demo SQLite database: that data must be audited and
 * approved before a separate importer is allowed to copy it.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const root = path.join(__dirname, '..');
const dbPath = process.env.WESTO_DB_PATH || path.join(__dirname, 'data', 'db.json');
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error('DATABASE_URL is required. No migration was attempted.');
  process.exitCode = 2;
  return;
}

const source = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
const pool = new Pool({ connectionString, ssl: process.env.DATABASE_SSL === 'false' ? false : undefined });
const now = () => new Date().toISOString();
const paidStatuses = new Set(['paid', 'preparing', 'ready', 'dispatched', 'picked_up', 'delivered', 'done']);
const amount = (value) => Math.max(0, Math.round(Number(value) || 0));

async function schema(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS unified_branches (
      id BIGINT PRIMARY KEY, slug TEXT UNIQUE, name TEXT NOT NULL, address TEXT, phone TEXT, active BOOLEAN NOT NULL DEFAULT true, data JSONB NOT NULL DEFAULT '{}'::jsonb
    );
    CREATE TABLE IF NOT EXISTS unified_menu_items (
      id BIGINT PRIMARY KEY, category_id BIGINT, name TEXT NOT NULL, price BIGINT NOT NULL DEFAULT 0, available BOOLEAN NOT NULL DEFAULT true, data JSONB NOT NULL DEFAULT '{}'::jsonb
    );
    CREATE TABLE IF NOT EXISTS unified_tables (
      id BIGINT PRIMARY KEY, branch_id BIGINT REFERENCES unified_branches(id), label TEXT NOT NULL, seats INTEGER NOT NULL DEFAULT 0, zone TEXT, active BOOLEAN NOT NULL DEFAULT true, data JSONB NOT NULL DEFAULT '{}'::jsonb
    );
    CREATE TABLE IF NOT EXISTS unified_customers (
      phone TEXT PRIMARY KEY, name TEXT, points BIGINT NOT NULL DEFAULT 0, first_seen_at TIMESTAMPTZ, last_seen_at TIMESTAMPTZ, data JSONB NOT NULL DEFAULT '{}'::jsonb
    );
    CREATE TABLE IF NOT EXISTS unified_orders (
      id BIGINT PRIMARY KEY, order_no TEXT UNIQUE, branch_id BIGINT REFERENCES unified_branches(id), customer_phone TEXT REFERENCES unified_customers(phone), table_no TEXT, fulfillment TEXT, payment_method TEXT, payment_status TEXT, status TEXT NOT NULL, total BIGINT NOT NULL DEFAULT 0, created_at TIMESTAMPTZ, data JSONB NOT NULL DEFAULT '{}'::jsonb
    );
    CREATE TABLE IF NOT EXISTS unified_order_items (
      order_id BIGINT REFERENCES unified_orders(id) ON DELETE CASCADE, line_no INTEGER NOT NULL, menu_item_id BIGINT, name TEXT NOT NULL, quantity INTEGER NOT NULL DEFAULT 1, unit_price BIGINT NOT NULL DEFAULT 0, total BIGINT NOT NULL DEFAULT 0, PRIMARY KEY(order_id, line_no)
    );
    CREATE TABLE IF NOT EXISTS unified_journal_entries (
      id TEXT PRIMARY KEY, source_order_id BIGINT UNIQUE REFERENCES unified_orders(id), entry_at TIMESTAMPTZ NOT NULL, reference TEXT NOT NULL, debit BIGINT NOT NULL, credit BIGINT NOT NULL, status TEXT NOT NULL DEFAULT 'posted', CHECK (debit = credit)
    );
    CREATE TABLE IF NOT EXISTS unified_settings (
      category TEXT PRIMARY KEY, value JSONB NOT NULL DEFAULT '{}'::jsonb, updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS unified_orders_branch_created_idx ON unified_orders(branch_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS unified_journal_entries_at_idx ON unified_journal_entries(entry_at DESC);
  `);
}

async function importData(client) {
  for (const branch of source.branches || []) {
    await client.query(`INSERT INTO unified_branches(id,slug,name,address,phone,active,data) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)
      ON CONFLICT(id) DO UPDATE SET slug=EXCLUDED.slug,name=EXCLUDED.name,address=EXCLUDED.address,phone=EXCLUDED.phone,active=EXCLUDED.active,data=EXCLUDED.data`, [branch.id, branch.slug || null, branch.name || `شعبه ${branch.id}`, branch.address || null, branch.phone || null, branch.active !== false, JSON.stringify(branch)]);
  }
  for (const item of source.menuItems || []) {
    await client.query(`INSERT INTO unified_menu_items(id,category_id,name,price,available,data) VALUES($1,$2,$3,$4,$5,$6::jsonb)
      ON CONFLICT(id) DO UPDATE SET category_id=EXCLUDED.category_id,name=EXCLUDED.name,price=EXCLUDED.price,available=EXCLUDED.available,data=EXCLUDED.data`, [item.id, item.categoryId || null, item.name || `آیتم ${item.id}`, amount(item.price), item.available !== false, JSON.stringify(item)]);
  }
  for (const table of source.tables || []) {
    await client.query(`INSERT INTO unified_tables(id,branch_id,label,seats,zone,active,data) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)
      ON CONFLICT(id) DO UPDATE SET branch_id=EXCLUDED.branch_id,label=EXCLUDED.label,seats=EXCLUDED.seats,zone=EXCLUDED.zone,active=EXCLUDED.active,data=EXCLUDED.data`, [table.id, table.branchId || null, table.label || `میز ${table.id}`, amount(table.seats), table.zone || null, table.active !== false, JSON.stringify(table)]);
  }
  const customers = new Map();
  for (const order of source.orders || []) {
    const phone = String(order.phone || '').trim(); if (!phone) continue;
    const current = customers.get(phone) || { phone, name: order.name || '', first: order.createdAt || null, last: order.createdAt || null, points: 0 };
    current.name = current.name || order.name || ''; current.first = !current.first || new Date(order.createdAt || 0) < new Date(current.first) ? order.createdAt : current.first; current.last = !current.last || new Date(order.createdAt || 0) > new Date(current.last) ? order.createdAt : current.last; customers.set(phone, current);
  }
  for (const entry of source.loyaltyLedger || []) { const customer = customers.get(String(entry.phone || '').trim()); if (customer) customer.points = amount(entry.balance); }
  for (const customer of customers.values()) await client.query(`INSERT INTO unified_customers(phone,name,points,first_seen_at,last_seen_at,data) VALUES($1,$2,$3,$4,$5,$6::jsonb)
    ON CONFLICT(phone) DO UPDATE SET name=EXCLUDED.name,points=EXCLUDED.points,first_seen_at=EXCLUDED.first_seen_at,last_seen_at=EXCLUDED.last_seen_at,data=EXCLUDED.data`, [customer.phone, customer.name || null, customer.points, customer.first || null, customer.last || null, JSON.stringify(customer)]);
  for (const order of source.orders || []) {
    const phone = String(order.phone || '').trim() || null;
    await client.query(`INSERT INTO unified_orders(id,order_no,branch_id,customer_phone,table_no,fulfillment,payment_method,payment_status,status,total,created_at,data) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)
      ON CONFLICT(id) DO UPDATE SET order_no=EXCLUDED.order_no,branch_id=EXCLUDED.branch_id,customer_phone=EXCLUDED.customer_phone,table_no=EXCLUDED.table_no,fulfillment=EXCLUDED.fulfillment,payment_method=EXCLUDED.payment_method,payment_status=EXCLUDED.payment_status,status=EXCLUDED.status,total=EXCLUDED.total,created_at=EXCLUDED.created_at,data=EXCLUDED.data`, [order.id, order.orderNo || `WSTO-${order.id}`, order.branchId || null, phone, order.tableNo || null, order.fulfillment || null, order.paymentMethod || null, order.paymentStatus || null, order.status || 'unknown', amount(order.total), order.createdAt || now(), JSON.stringify(order)]);
    for (const [lineNo, item] of (order.items || []).entries()) await client.query(`INSERT INTO unified_order_items(order_id,line_no,menu_item_id,name,quantity,unit_price,total) VALUES($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT(order_id,line_no) DO UPDATE SET menu_item_id=EXCLUDED.menu_item_id,name=EXCLUDED.name,quantity=EXCLUDED.quantity,unit_price=EXCLUDED.unit_price,total=EXCLUDED.total`, [order.id, lineNo, item.menuItemId || null, item.name || 'آیتم', amount(item.qty) || 1, amount(item.price), amount(item.lineTotal)]);
    if (paidStatuses.has(order.status) || order.paymentStatus === 'paid') await client.query(`INSERT INTO unified_journal_entries(id,source_order_id,entry_at,reference,debit,credit,status) VALUES($1,$2,$3,$4,$5,$6,'posted') ON CONFLICT(id) DO UPDATE SET entry_at=EXCLUDED.entry_at,reference=EXCLUDED.reference,debit=EXCLUDED.debit,credit=EXCLUDED.credit,status=EXCLUDED.status`, [`sale-${order.id}`, order.id, order.createdAt || now(), `فروش ${order.orderNo || order.id}`, amount(order.total), amount(order.total)]);
  }
  const settingRows = { settings: source.settings || {}, restaurant: source.restaurant || {}, theme: source.theme || {}, adminV2Settings: source.adminV2Settings || {} };
  for (const [category, value] of Object.entries(settingRows)) await client.query(`INSERT INTO unified_settings(category,value,updated_at) VALUES($1,$2::jsonb,now()) ON CONFLICT(category) DO UPDATE SET value=EXCLUDED.value,updated_at=EXCLUDED.updated_at`, [category, JSON.stringify(value)]);
}

(async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN'); await schema(client); await importData(client); await client.query('COMMIT');
    console.log(JSON.stringify({ ok: true, source: dbPath, orders: (source.orders || []).length, tables: (source.tables || []).length, migratedAt: now() }));
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {}); console.error(error.stack || error.message); process.exitCode = 1;
  } finally { client.release(); await pool.end(); }
})();
