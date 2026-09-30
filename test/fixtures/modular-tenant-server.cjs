'use strict';
const service = require('../../server/server');
const finance = require('../../server/finance-v2');
const { defaultVersions } = require('../../modules/runtime');
const tenants = ['darbar', 'bistro'];
const ownerPhone = '09120000001';
for (const tenantId of tenants) {
  const db = service.tenantRegistry.provisionTenant(tenantId, { name: tenantId, ownerPhone });
  db.branches = [{ id: 1, active: true, name: 'شعبهٔ آزمون' }];
  db.featureEntitlements['orders.pos'] = { active: true, status: 'active' };
  db.featureEntitlements['finance.workspace'] = { active: false, status: 'disabled' };
  if (!db.financeV2.fiscalPeriods?.length) finance.createFiscalPeriod(db, { branchId: 1, name: 'دوره آزمون', startDate: '2026-01-01', endDate: '2026-12-31' }, 'test');
}
service.tenantResolver.controlDataAccess = {
  async findTenantByHost(host) {
    const tenantId = host.split('.')[0];
    return tenants.includes(tenantId) ? { tenantId, status: 'active', databaseName: `tenant_${tenantId}`,
      databaseProvider: 'legacy-json', metadata: { moduleVersions: defaultVersions() } } : null;
  },
};
process.on('message', (message) => {
  try {
    const db = service.tenantRegistry.getTenantDb(message.tenantId);
    let result;
    if (message.type === 'sale') {
      const at = '2026-08-20T10:00:00.000Z';
      const order = { id: message.orderId, orderNo: message.orderId, branchId: 1, total: 1000,
        status: 'paid', paymentStatus: 'paid', paymentMethod: 'cash', createdAt: at, paidAt: at,
        partialPayments: [{ id: `p-${message.orderId}`, tender: 'cash', amount: 1000, at }], items: [] };
      if (!db.orders.find(row => row.id === order.id)) db.orders.push(order);
      const captured = finance.capturePaidOrder(db, order, { actor: 'test-cashier', idempotencyKey: `paid:${message.orderId}` });
      result = { eventId: captured.event?.id, status: captured.journalEntry?.status,
        count: db.financeV2.events.filter(row => row.source === 'order.paid').length };
    }
    if (message.type === 'menu') {
      db.settings.currency = 'IRT'; db.settings.tomanConversionRate = 10;
      db.settings.taxPercent = 0; db.settings.serviceChargePercent = 0; db.settings.packagingFeeIrr = 0;
      db.menuCategories = [{ id: 1, name: 'دسته آزمون', active: true }];
      db.menuItems = [{ id: 1, categoryId: 1, name: 'غذای آزمون دربار', price: 1000, available: true, stock: 100, dayparts: ['all'], modifierGroups: [] }];
      db.accounting.taxSettings = { defaultCategory: 'fixture', categories: [{ code: 'fixture', exempt: false }],
        rules: [{ id: 'fixture-zero', code: 'TEST_ZERO', taxCategory: 'fixture', rate: 0, status: 'active', version: 1, inclusive: true,
          locationId: 1, effectiveFrom: '2026-01-01', effectiveTo: null, legalSource: 'test only' }] };
    }
    if (message.type === 'access') db.featureEntitlements['finance.workspace'] = message.grant;
    if (message.type === 'state') result = { events: db.financeV2.events.length, entries: db.financeV2.journalEntries.length, orders: db.orders.length };
    service.tenantRegistry.saveTenantDb(message.tenantId, { requireDurable: true });
    process.send({ id: message.id, result });
  } catch (error) { process.send({ id: message.id, error: error.message, code: error.code }); }
});
service.startServer().then(server => process.send({ ready: true, port: server.address().port }))
  .catch(error => { process.send({ error: error.message, code: error.code }); process.exitCode = 1; });
