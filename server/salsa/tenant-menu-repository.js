'use strict';

/**
 * Tenant Menu Repository
 * Handles relational persistence of Menu Items and Categories in dedicated tenant PostgreSQL databases.
 * Uses tenantDataAccess to ensure all operations run strictly within the authenticated tenant's boundary.
 */

function normalizeJsonField(value, fallback = []) {
  if (value == null) return fallback;
  if (Array.isArray(value) || (typeof value === 'object' && value !== null)) return value;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }
  return fallback;
}

function mapRowToMenuItem(row) {
  if (!row) return null;
  const rawId = row.id;
  const numId = Number(rawId);
  const id = Number.isFinite(numId) ? numId : rawId;

  const rawCid = row.category_id;
  const numCid = Number(rawCid);
  const categoryId = Number.isFinite(numCid) ? numCid : (rawCid || 0);

  const name = row.name || row.title || '';
  const price = Number(row.price ?? row.price_cents ?? 0);
  const isAvailable = row.available !== false && row.is_available !== false;

  return {
    id,
    branchId: row.branch_id || null,
    categoryId,
    name,
    title: row.title || name,
    en: row.en || '',
    ar: row.ar || '',
    desc: row.description || '',
    descEn: row.desc_en || '',
    descAr: row.desc_ar || '',
    price,
    priceCents: Number(row.price_cents ?? price),
    available: isAvailable,
    allergens: normalizeJsonField(row.allergens, []),
    dayparts: normalizeJsonField(row.dayparts, ['all']),
    modifierGroups: normalizeJsonField(row.modifier_groups, []),
    stock: row.stock != null ? Number(row.stock) : null,
    lowStockAt: row.low_stock_at != null ? Number(row.low_stock_at) : 5,
    img: row.img || '',
    createdAt: row.created_at || new Date().toISOString(),
    updatedAt: row.updated_at || row.created_at || new Date().toISOString(),
  };
}

class TenantMenuRepository {
  async listMenuItems(tenantDataAccess, query = {}) {
    if (!tenantDataAccess) return [];
    const conditions = [];
    const params = [];

    if (query.categoryId != null && query.categoryId !== '') {
      params.push(String(query.categoryId));
      conditions.push(`(category_id = $${params.length} OR category_id::text = $${params.length})`);
    }

    if (query.availableOnly) {
      conditions.push(`(is_available = true AND (available IS NULL OR available = true))`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const sql = `
      SELECT id, branch_id, category_id, title, price_cents, is_available,
             name, price, en, ar, description, desc_en, desc_ar, img,
             available, stock, low_stock_at, allergens, dayparts, modifier_groups,
             created_at, updated_at
      FROM tenant_menu_items
      ${whereClause}
      ORDER BY id ASC
    `;

    try {
      const res = await tenantDataAccess.query(sql, params);
      return (res.rows || []).map(mapRowToMenuItem);
    } catch (err) {
      // Graceful fallback if rich columns are not present yet
      if (err.message && (err.message.includes('column "name" does not exist') || err.message.includes('does not exist'))) {
        const fallbackSql = `
          SELECT id, branch_id, category_id, title, price_cents, is_available, created_at
          FROM tenant_menu_items
          ORDER BY id ASC
        `;
        const res = await tenantDataAccess.query(fallbackSql, []);
        return (res.rows || []).map(mapRowToMenuItem);
      }
      throw err;
    }
  }

  async getMenuItemById(tenantDataAccess, id) {
    if (!tenantDataAccess || id == null) return null;
    const strId = String(id);
    const sql = `
      SELECT id, branch_id, category_id, title, price_cents, is_available,
             name, price, en, ar, description, desc_en, desc_ar, img,
             available, stock, low_stock_at, allergens, dayparts, modifier_groups,
             created_at, updated_at
      FROM tenant_menu_items
      WHERE id = $1
      LIMIT 1
    `;
    const res = await tenantDataAccess.query(sql, [strId]);
    return res.rows?.[0] ? mapRowToMenuItem(res.rows[0]) : null;
  }

  async createMenuItem(tenantDataAccess, item) {
    if (!tenantDataAccess) {
      throw new Error('TENANT_DATA_ACCESS_REQUIRED: cannot create menu item without tenant database connection.');
    }
    const id = String(item.id);
    const title = String(item.name || item.title || '').trim();
    const price = Math.max(0, Math.round(Number(item.price ?? item.priceCents ?? 0)));
    const branchId = item.branchId ? String(item.branchId) : null;
    const categoryId = item.categoryId != null ? String(item.categoryId) : null;
    const available = item.available !== false;
    const allergens = JSON.stringify(Array.isArray(item.allergens) ? item.allergens : []);
    const dayparts = JSON.stringify(Array.isArray(item.dayparts) ? item.dayparts : ['all']);
    const modifierGroups = JSON.stringify(Array.isArray(item.modifierGroups) ? item.modifierGroups : []);

    const sql = `
      INSERT INTO tenant_menu_items (
        id, branch_id, category_id, title, price_cents, is_available,
        name, price, en, ar, description, desc_en, desc_ar, img,
        available, stock, low_stock_at, allergens, dayparts, modifier_groups,
        created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, $8, $9, $10, $11, $12, $13, $14,
        $15, $16, $17, $18, $19, $20,
        now(), now()
      )
      ON CONFLICT (id) DO UPDATE SET
        branch_id = EXCLUDED.branch_id,
        category_id = EXCLUDED.category_id,
        title = EXCLUDED.title,
        price_cents = EXCLUDED.price_cents,
        is_available = EXCLUDED.is_available,
        name = EXCLUDED.name,
        price = EXCLUDED.price,
        en = EXCLUDED.en,
        ar = EXCLUDED.ar,
        description = EXCLUDED.description,
        desc_en = EXCLUDED.desc_en,
        desc_ar = EXCLUDED.desc_ar,
        img = EXCLUDED.img,
        available = EXCLUDED.available,
        stock = EXCLUDED.stock,
        low_stock_at = EXCLUDED.low_stock_at,
        allergens = EXCLUDED.allergens,
        dayparts = EXCLUDED.dayparts,
        modifier_groups = EXCLUDED.modifier_groups,
        updated_at = now()
      RETURNING *
    `;

    const params = [
      id,
      branchId,
      categoryId,
      title,
      price,
      available,
      title,
      price,
      String(item.en || '').trim(),
      String(item.ar || '').trim(),
      String(item.desc || item.description || '').trim(),
      String(item.descEn || '').trim(),
      String(item.descAr || '').trim(),
      String(item.img || ''),
      available,
      item.stock != null ? Math.round(Number(item.stock)) : null,
      item.lowStockAt != null ? Math.round(Number(item.lowStockAt)) : 5,
      allergens,
      dayparts,
      modifierGroups,
    ];

    try {
      const res = await tenantDataAccess.query(sql, params);
      return mapRowToMenuItem(res.rows[0]);
    } catch (err) {
      // Fallback for minimal canonical schema if rich columns do not exist
      if (err.message && err.message.includes('does not exist')) {
        const canonicalSql = `
          INSERT INTO tenant_menu_items (id, branch_id, category_id, title, price_cents, is_available, created_at)
          VALUES ($1, $2, $3, $4, $5, $6, now())
          ON CONFLICT (id) DO UPDATE SET
            branch_id = EXCLUDED.branch_id,
            category_id = EXCLUDED.category_id,
            title = EXCLUDED.title,
            price_cents = EXCLUDED.price_cents,
            is_available = EXCLUDED.is_available
          RETURNING *
        `;
        const res = await tenantDataAccess.query(canonicalSql, [id, branchId, categoryId, title, price, available]);
        return mapRowToMenuItem(res.rows[0]);
      }
      throw err;
    }
  }

  async updateMenuItem(tenantDataAccess, id, item) {
    if (!tenantDataAccess) return null;
    const strId = String(id);
    const existing = await this.getMenuItemById(tenantDataAccess, strId);
    if (!existing) return null;

    const merged = { ...existing, ...item, id: strId };
    return this.createMenuItem(tenantDataAccess, merged);
  }

  async deleteMenuItem(tenantDataAccess, id) {
    if (!tenantDataAccess || id == null) return false;
    const strId = String(id);
    const res = await tenantDataAccess.query('DELETE FROM tenant_menu_items WHERE id = $1', [strId]);
    return (res.rowCount || 0) > 0;
  }

  async listCategories(tenantDataAccess) {
    if (!tenantDataAccess) return [];
    try {
      const res = await tenantDataAccess.query(`
        SELECT id, name, title, display_order, created_at
        FROM tenant_menu_categories
        ORDER BY display_order ASC, id ASC
      `);
      return (res.rows || []).map((r) => ({
        id: Number(r.id) || r.id,
        name: r.name || r.title || '',
        title: r.title || r.name || '',
        order: r.display_order || 0,
      }));
    } catch {
      return [];
    }
  }

  async createCategory(tenantDataAccess, category) {
    if (!tenantDataAccess) return null;
    const id = String(category.id);
    const name = String(category.name || category.title || '').trim();
    const order = Number(category.order || 0);

    try {
      await tenantDataAccess.query(`
        INSERT INTO tenant_menu_categories (id, name, title, display_order, created_at)
        VALUES ($1, $2, $3, $4, now())
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          title = EXCLUDED.title,
          display_order = EXCLUDED.display_order
      `, [id, name, name, order]);
      return { id: Number(id) || id, name, title: name, order };
    } catch {
      return null;
    }
  }
}

const tenantMenuRepository = new TenantMenuRepository();

module.exports = {
  TenantMenuRepository,
  tenantMenuRepository,
};
